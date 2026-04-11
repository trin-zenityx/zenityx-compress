import type { FastifyInstance } from "fastify";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { requireLogin } from "../auth/require-login.js";
import type { JobQueue } from "../jobs/queue.js";
import type { WorkerHandle } from "../jobs/worker.js";
import { isTerminalState } from "../jobs/types.js";
import { registerTestSeam } from "./test-seam.js";

export interface JobsRoutesOptions {
  queue: JobQueue;
  worker?: WorkerHandle;
  retentionHours?: number;
}

async function waitForTerminal(
  queue: JobQueue,
  jobId: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = queue.get(jobId);
    if (!j || isTerminalState(j.state)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function registerJobsRoutes(
  app: FastifyInstance,
  opts: JobsRoutesOptions,
): Promise<void> {
  registerTestSeam(app);
  const retentionHours = opts.retentionHours ?? 1;

  app.get("/api/jobs", { preHandler: requireLogin }, async (req, reply) => {
    const sessionId = req.session.get("userId")!;
    const jobs = opts.queue.listBySession(sessionId).map((job) => ({
      id: job.id,
      type: job.type,
      originalName: job.originalName,
      state: job.state,
      progress: job.progress,
      inputSize: job.inputSize,
      outputSize: job.outputSize,
      createdAt: job.createdAt,
      expiresAt: job.createdAt + retentionHours * 3600 * 1000,
      downloadUrl: job.state === "done" ? `/api/download/${job.id}` : undefined,
      error: job.error,
    }));
    return reply.send({ jobs });
  });

  app.delete<{ Params: { jobId: string } }>(
    "/api/jobs/:jobId",
    { preHandler: requireLogin },
    async (req, reply) => {
      const sessionId = req.session.get("userId")!;
      const { jobId } = req.params;
      const job = opts.queue.get(jobId);
      if (!job) return reply.code(404).send({ error: "not_found" });
      if (job.sessionId !== sessionId) {
        return reply.code(403).send({ error: "forbidden" });
      }

      if (!isTerminalState(job.state)) {
        const cancelled = opts.worker?.cancel(jobId) ?? false;
        if (cancelled) {
          await waitForTerminal(opts.queue, jobId, 5000);
        } else {
          opts.queue.update(jobId, {
            state: "error",
            error: "CANCELLED: cancelled_by_user",
          });
        }
      }

      if (job.outputPath) {
        await rm(dirname(job.outputPath), { recursive: true, force: true }).catch(() => {});
      }
      opts.queue.remove(jobId);
      return reply.send({ ok: true });
    },
  );
}
