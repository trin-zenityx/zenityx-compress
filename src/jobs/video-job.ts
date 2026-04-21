import ffmpeg from "fluent-ffmpeg";
import { rm, stat } from "node:fs/promises";
import { join, dirname, parse } from "node:path";
import { calcVideoBitrate } from "../utils/bitrate.js";
import { probeMedia } from "../utils/probe.js";

export class VideoJobError extends Error {
  constructor(
    public readonly code:
      | "PROBE_FAILED"
      | "FFMPEG_PASS1_FAILED"
      | "FFMPEG_PASS2_FAILED"
      | "VIDEO_TOO_LONG_FOR_TARGET"
      | "CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "VideoJobError";
  }
}

export type VideoProgressState = "probing" | "pass1" | "pass2";

export interface VideoJobInput {
  inputPath: string;
  outputPath: string;
  targetMB: number;
  audioKbps?: number;
  onProgress: (state: VideoProgressState, progress: number) => void;
  signal?: AbortSignal;
}

export interface VideoJobResult {
  outputSize: number;
  videoBitrateKbps: number;
}

interface PassContext {
  inputPath: string;
  outputPath: string;
  videoBitrateKbps: number;
  audioKbps: number;
  passLogPrefix: string;
  fps: number;
  signal: AbortSignal | undefined;
  onProgress: (percent: number) => void;
}

function runPass(kind: "pass1" | "pass2", ctx: PassContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const baseOpts = [
      "-c:v", "libx264",
      "-preset", "slow",
      "-b:v", `${ctx.videoBitrateKbps}k`,
      "-pass", kind === "pass1" ? "1" : "2",
      "-passlogfile", ctx.passLogPrefix,
      "-pix_fmt", "yuv420p",
      "-profile:v", "high",
      "-level", "4.1",
      "-g", `${Math.round(ctx.fps * 2)}`,
    ];

    const pass1Opts = [...baseOpts, "-an"];
    const pass2Opts = [
      ...baseOpts,
      "-c:a", "aac",
      "-b:a", `${ctx.audioKbps}k`,
      "-ac", "2",
      "-movflags", "+faststart",
    ];

    const opts = kind === "pass1" ? pass1Opts : pass2Opts;
    const cmd = ffmpeg(ctx.inputPath)
      // Pass options as variadic args so fluent-ffmpeg sets doSplit=false,
      // preventing paths with spaces from being split on whitespace.
      .outputOptions(...opts)
      .on("progress", (p) => {
        if (typeof p.percent === "number") {
          ctx.onProgress(Math.min(100, Math.max(0, Math.floor(p.percent))));
        }
      })
      .on("end", () => {
        detach();
        resolve();
      })
      .on("error", (err) => {
        detach();
        if (ctx.signal?.aborted) {
          reject(new VideoJobError("CANCELLED", "video job cancelled"));
          return;
        }
        const code = kind === "pass1" ? "FFMPEG_PASS1_FAILED" : "FFMPEG_PASS2_FAILED";
        reject(new VideoJobError(code, err.message));
      });

    const abortHandler = () => {
      cmd.kill("SIGTERM");
    };
    const detach = () => {
      ctx.signal?.removeEventListener("abort", abortHandler);
    };
    if (ctx.signal) {
      if (ctx.signal.aborted) {
        cmd.kill("SIGTERM");
      } else {
        ctx.signal.addEventListener("abort", abortHandler);
      }
    }

    if (kind === "pass1") {
      cmd.format("null").output("-").run();
    } else {
      cmd.save(ctx.outputPath);
    }
  });
}

async function cleanupPassLogs(prefix: string): Promise<void> {
  await Promise.all(
    [
      `${prefix}-0.log`,
      `${prefix}-0.log.mbtree`,
      `${prefix}.log`,
      `${prefix}.log.mbtree`,
    ].map((p) => rm(p, { force: true })),
  );
}

export async function runVideoJob(input: VideoJobInput): Promise<VideoJobResult> {
  input.onProgress("probing", 0);

  let probe;
  try {
    probe = await probeMedia(input.inputPath);
  } catch (err) {
    throw new VideoJobError("PROBE_FAILED", (err as Error).message);
  }

  const audioKbps = input.audioKbps ?? 128;
  let videoBitrateKbps: number;
  try {
    videoBitrateKbps = calcVideoBitrate(probe.durationSec, input.targetMB, audioKbps);
  } catch (err) {
    throw new VideoJobError("VIDEO_TOO_LONG_FOR_TARGET", (err as Error).message);
  }

  const passLogPrefix = join(
    dirname(input.outputPath),
    `pass-${parse(input.outputPath).name}`,
  );

  try {
    await runPass("pass1", {
      inputPath: input.inputPath,
      outputPath: input.outputPath,
      videoBitrateKbps,
      audioKbps,
      passLogPrefix,
      fps: probe.fps,
      signal: input.signal,
      onProgress: (p) => input.onProgress("pass1", p),
    });
    await runPass("pass2", {
      inputPath: input.inputPath,
      outputPath: input.outputPath,
      videoBitrateKbps,
      audioKbps,
      passLogPrefix,
      fps: probe.fps,
      signal: input.signal,
      onProgress: (p) => input.onProgress("pass2", p),
    });
  } finally {
    await cleanupPassLogs(passLogPrefix);
  }

  const { size } = await stat(input.outputPath);
  return { outputSize: size, videoBitrateKbps };
}
