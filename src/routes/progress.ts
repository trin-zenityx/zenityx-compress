import type { FastifyInstance } from "fastify";
import { requireLogin } from "../auth/require-login.js";
import type { JobQueue } from "../jobs/queue.js";
import type { JobEvent } from "../jobs/types.js";
import { isTerminalState } from "../jobs/types.js";
import { registerTestSeam } from "./test-seam.js";

export interface ProgressRouteOptions {
  queue: JobQueue;
  heartbeatMs?: number;
}

function pickEventName(state: string): string {
  if (state === "done") return "done";
  if (state === "error") return "failed";
  return "progress";
}

export async function registerProgressRoute(
  app: FastifyInstance,
  opts: ProgressRouteOptions,
): Promise<void> {
  registerTestSeam(app);
  const heartbeatMs = opts.heartbeatMs ?? 15_000;

  app.get<{ Params: { jobId: string } }>(
    "/api/progress/:jobId",
    { preHandler: requireLogin },
    async (req, reply) => {
      const sessionId = req.session.get("userId")!;
      const { jobId } = req.params;
      const job = opts.queue.get(jobId);
      if (!job) return reply.code(404).send({ error: "job_not_found" });
      if (job.sessionId !== sessionId) {
        return reply.code(403).send({ error: "forbidden" });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const write = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const heartbeat = setInterval(() => {
        reply.raw.write(`: ping\n\n`);
      }, heartbeatMs);

      write(pickEventName(job.state), {
        jobId,
        state: job.state,
        progress: job.progress,
        outputSize: job.outputSize,
        downloadUrl: job.state === "done" ? `/api/download/${jobId}` : undefined,
        error: job.error,
      });

      const unsubscribe = opts.queue.subscribe(jobId, (ev: JobEvent) => {
        write(pickEventName(ev.state), ev);
        if (isTerminalState(ev.state)) {
          clearInterval(heartbeat);
          unsubscribe();
          reply.raw.end();
        }
      });

      req.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );
}
