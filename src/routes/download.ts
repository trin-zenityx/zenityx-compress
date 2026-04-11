import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { requireLogin } from "../auth/require-login.js";
import type { JobQueue } from "../jobs/queue.js";
import { outputFilenameFor } from "../storage/paths.js";
import { registerTestSeam } from "./test-seam.js";

export interface DownloadRouteOptions {
  queue: JobQueue;
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function registerDownloadRoute(
  app: FastifyInstance,
  opts: DownloadRouteOptions,
): Promise<void> {
  registerTestSeam(app);

  app.get<{ Params: { jobId: string } }>(
    "/api/download/:jobId",
    { preHandler: requireLogin },
    async (req, reply) => {
      const sessionId = req.session.get("userId")!;
      const { jobId } = req.params;
      const job = opts.queue.get(jobId);
      if (!job) return reply.code(404).send({ error: "not_found" });
      if (job.sessionId !== sessionId) return reply.code(403).send({ error: "forbidden" });
      if (job.state !== "done") return reply.code(409).send({ error: "not_ready", state: job.state });

      let size: number;
      try {
        const s = await stat(job.outputPath);
        size = s.size;
      } catch {
        return reply.code(404).send({ error: "file_missing" });
      }

      const downloadName = outputFilenameFor(job.originalName, job.preset.id, job.customTargetMB);
      const ext = extname(downloadName).toLowerCase();
      const mime = MIME[ext] ?? "application/octet-stream";
      const encoded = encodeURIComponent(downloadName);

      reply
        .header("Content-Type", mime)
        .header("Content-Length", String(size))
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encoded}`,
        );
      return reply.send(createReadStream(job.outputPath));
    },
  );
}
