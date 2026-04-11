import type { FastifyInstance } from "fastify";
import "@fastify/multipart";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { requireLogin } from "../auth/require-login.js";
import { JobQueue, QueueFullError } from "../jobs/queue.js";
import type { Job } from "../jobs/types.js";
import { getPreset, resolveTargetMB, UnknownPresetError, customPresetSchema } from "../presets/index.js";
import { calcVideoBitrate, BitrateError } from "../utils/bitrate.js";
import { probeMedia } from "../utils/probe.js";
import {
  newJobId,
  ensureJobUploadDir,
  uploadPathFor,
  outputPathFor,
  ensureJobOutputDir,
  outputFilenameFor,
  removeJobUploadDir,
} from "../storage/paths.js";
import { logger } from "../utils/logger.js";

export interface UploadRouteOptions {
  queue: JobQueue;
  uploadDir: string;
  outputDir?: string;
  maxUploadMB: number;
}

const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"]);
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function registerUploadRoute(
  app: FastifyInstance,
  opts: UploadRouteOptions,
): Promise<void> {
  const outputDir = opts.outputDir ?? opts.uploadDir.replace(/uploads$/, "outputs");

  app.post("/api/upload", { preHandler: requireLogin }, async (req, reply) => {
    const sessionId = req.session.get("userId")!;
    const parts = req.parts();

    let presetId: string | undefined;
    let customTargetMB: number | undefined;
    let jobId: string | undefined;
    let savedPath: string | undefined;
    let originalName: string | undefined;

    try {
      for await (const part of parts) {
        if (part.type === "field") {
          if (part.fieldname === "preset") presetId = String(part.value);
          if (part.fieldname === "customTargetMB") {
            customTargetMB = customPresetSchema.parse({ targetMB: String(part.value) }).targetMB;
          }
        } else if (part.type === "file") {
          if (!part.filename) continue;
          const newId = newJobId();
          const name = part.filename;
          jobId = newId;
          originalName = name;
          await ensureJobUploadDir(opts.uploadDir, newId);
          const path = uploadPathFor(opts.uploadDir, newId, name);
          savedPath = path;
          await pipeline(part.file, createWriteStream(path));
          if (part.file.truncated) {
            await removeJobUploadDir(opts.uploadDir, newId);
            return reply.code(413).send({ error: "file_too_large" });
          }
        }
      }

      if (!jobId || !savedPath || !originalName) {
        return reply.code(400).send({ error: "file_missing" });
      }

      const preset = getPreset(presetId ?? "manychat");

      const headBuf = await readFile(savedPath);
      const ft = await fileTypeFromBuffer(headBuf);
      if (!ft) {
        await removeJobUploadDir(opts.uploadDir, jobId);
        return reply.code(415).send({ error: "unsupported_media_type" });
      }
      let type: "video" | "image";
      if (VIDEO_MIMES.has(ft.mime)) type = "video";
      else if (IMAGE_MIMES.has(ft.mime)) type = "image";
      else {
        await removeJobUploadDir(opts.uploadDir, jobId);
        return reply.code(415).send({ error: "unsupported_media_type" });
      }

      const { size: inputSize } = await stat(savedPath);
      const targetMB = customTargetMB ?? resolveTargetMB(preset, type);

      let probeInfo: { durationSec: number; width: number; height: number; fps: number } | undefined;
      let targetVideoBitrateKbps: number | undefined;
      let estimatedDurationSeconds: number | undefined;

      if (type === "video") {
        const probe = await probeMedia(savedPath);
        if (!probe.hasVideo) {
          await removeJobUploadDir(opts.uploadDir, jobId);
          return reply.code(415).send({ error: "no_video_stream" });
        }
        probeInfo = {
          durationSec: probe.durationSec,
          width: probe.width,
          height: probe.height,
          fps: probe.fps,
        };
        targetVideoBitrateKbps = calcVideoBitrate(probe.durationSec, targetMB);
        estimatedDurationSeconds = Math.ceil(probe.durationSec * 2.5);
      }

      await ensureJobOutputDir(outputDir, jobId);
      const outputName = outputFilenameFor(originalName, preset.id, customTargetMB);
      const outputPath = outputPathFor(outputDir, jobId, outputName);

      const job: Job = {
        id: jobId,
        sessionId,
        type,
        originalName,
        inputPath: savedPath,
        outputPath,
        preset,
        customTargetMB,
        createdAt: Date.now(),
        state: "queued",
        progress: 0,
        inputSize,
      };

      opts.queue.enqueue(job);

      return reply.code(200).send({
        jobId,
        type,
        originalName,
        inputSize,
        probe: probeInfo,
        targetVideoBitrateKbps,
        estimatedDurationSeconds,
      });
    } catch (err) {
      if (jobId) await removeJobUploadDir(opts.uploadDir, jobId).catch(() => {});
      if (err instanceof UnknownPresetError) {
        return reply.code(400).send({ error: "unknown_preset" });
      }
      if (err instanceof BitrateError) {
        return reply.code(422).send({ error: "video_too_long_for_target", message: err.message });
      }
      if (err instanceof QueueFullError) {
        return reply.code(503).send({
          error: "queue_full",
          queueDepth: opts.queue.liveJobCount(),
          queueMax: err.queueMax,
        });
      }
      logger.error({ err }, "upload failed");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
}
