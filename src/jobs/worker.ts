import type { JobQueue } from "./queue.js";
import type { Job } from "./types.js";
import { resolveTargetMB } from "../presets/index.js";
import { compressImage, ImageJobError } from "./image-job.js";
import { runVideoJob, VideoJobError } from "./video-job.js";
import { logger } from "../utils/logger.js";

export interface WorkerOptions {
  queue: JobQueue;
  concurrency: number;
  timeoutMs: number;
}

export interface WorkerHandle {
  cancel(jobId: string): boolean;
  stop(): Promise<void>;
}

export function startWorker(opts: WorkerOptions): WorkerHandle {
  let running = true;
  const controllers = new Map<string, AbortController>();

  async function loop(loopId: number): Promise<void> {
    while (running) {
      const job = opts.queue.nextWaiting();
      if (!job) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      await processJob(job).catch((err) => {
        logger.error({ err, jobId: job.id, loopId }, "worker loop error");
      });
    }
  }

  async function processJob(job: Job): Promise<void> {
    const targetMB =
      job.customTargetMB ?? resolveTargetMB(job.preset, job.type);

    const controller = new AbortController();
    controllers.set(job.id, controller);

    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, opts.timeoutMs);

    try {
      if (job.type === "image") {
        opts.queue.update(job.id, { state: "encoding", progress: 0 });
        const result = await compressImage(
          job.inputPath,
          job.outputPath,
          targetMB * 1024 * 1024,
          (p) => opts.queue.update(job.id, { state: "encoding", progress: p }),
          { signal: controller.signal },
        );
        opts.queue.update(job.id, {
          state: "done",
          progress: 100,
          outputSize: result.outputSize,
        });
      } else {
        opts.queue.update(job.id, { state: "probing", progress: 0 });
        const result = await runVideoJob({
          inputPath: job.inputPath,
          outputPath: job.outputPath,
          targetMB,
          signal: controller.signal,
          onProgress: (state, progress) =>
            opts.queue.update(job.id, { state, progress }),
        });
        opts.queue.update(job.id, {
          state: "done",
          progress: 100,
          outputSize: result.outputSize,
        });
      }
    } catch (err) {
      const code =
        err instanceof ImageJobError || err instanceof VideoJobError
          ? err.code
          : "UNEXPECTED";
      opts.queue.update(job.id, {
        state: "error",
        progress: job.progress,
        error: `${code}: ${(err as Error).message}`,
      });
    } finally {
      clearTimeout(timeoutHandle);
      controllers.delete(job.id);
    }
  }

  const loops: Array<Promise<void>> = [];
  for (let i = 0; i < opts.concurrency; i++) {
    loops.push(loop(i));
  }

  return {
    cancel(jobId: string): boolean {
      const c = controllers.get(jobId);
      if (!c) return false;
      c.abort();
      return true;
    },
    async stop() {
      running = false;
      for (const c of controllers.values()) c.abort();
      await Promise.all(loops);
    },
  };
}
