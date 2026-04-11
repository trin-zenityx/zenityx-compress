import type { FastifyInstance } from "fastify";

export interface HealthOptions {
  version: string;
  queueDepth: () => number;
}

export async function registerHealthRoute(app: FastifyInstance, opts: HealthOptions): Promise<void> {
  app.get("/api/health", async () => ({
    ok: true,
    version: opts.version,
    uptime: Math.floor(process.uptime()),
    queueDepth: opts.queueDepth(),
  }));
}
