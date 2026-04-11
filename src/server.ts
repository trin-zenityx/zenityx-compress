import Fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Config } from "./config.js";
import { loadConfig } from "./config.js";
import { registerSession } from "./auth/session.js";
import { registerAuthRoutes } from "./auth/login-route.js";
import { registerPresetRoutes } from "./routes/presets.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerUploadRoute } from "./routes/upload.js";
import { registerProgressRoute } from "./routes/progress.js";
import { registerDownloadRoute } from "./routes/download.js";
import { registerJobsRoutes } from "./routes/jobs.js";
import { JobQueue } from "./jobs/queue.js";
import { startWorker, type WorkerHandle } from "./jobs/worker.js";
import { startCleanupCron, type CleanupJob } from "./storage/cleanup.js";
import { logger } from "./utils/logger.js";

export interface ServerHandle {
  app: FastifyInstance;
  queue: JobQueue;
  worker: WorkerHandle;
  cleanup: CleanupJob;
  listening: boolean;
  listen(): Promise<string>;
  close(): Promise<void>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildServer(config: Config): Promise<ServerHandle> {
  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
    bodyLimit: config.maxUploadMB * 1024 * 1024,
  });

  const queue = new JobQueue({ queueMax: config.queueMax });
  const worker = startWorker({
    queue,
    concurrency: config.workerConcurrency,
    timeoutMs: config.workerTimeoutMs,
  });
  const cleanup = startCleanupCron({
    uploadsDir: config.uploadDir,
    outputsDir: config.outputDir,
    retentionHours: config.retentionHours,
    orphanUploadsMinutes: 30,
  });

  await registerSession(app, config.sessionSecret);
  await app.register(fastifyMultipart, {
    limits: { fileSize: config.maxUploadMB * 1024 * 1024, files: 1 },
  });

  const publicDir = resolve(__dirname, "..", "public");
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, prefix: "/" });
  }

  await registerAuthRoutes(app, {
    passwordHash: config.authPasswordHash,
    loginRateLimit: config.loginRateLimit,
    loginRateWindowMs: config.loginRateWindowMs,
  });

  await registerPresetRoutes(app);
  await registerHealthRoute(app, {
    version: process.env.npm_package_version ?? "0.0.0",
    queueDepth: () => queue.liveJobCount(),
  });
  await registerUploadRoute(app, {
    queue,
    uploadDir: config.uploadDir,
    outputDir: config.outputDir,
    maxUploadMB: config.maxUploadMB,
  });
  await registerProgressRoute(app, { queue });
  await registerDownloadRoute(app, { queue });
  await registerJobsRoutes(app, {
    queue,
    worker,
    retentionHours: config.retentionHours,
  });

  app.setErrorHandler((err, req, reply) => {
    logger.error({ err, reqId: req.id, url: req.url }, "unhandled error");
    if (!reply.sent) {
      reply.code(500).send({ error: "internal_error" });
    }
  });

  const handle: ServerHandle = {
    app,
    queue,
    worker,
    cleanup,
    listening: false,
    async listen() {
      const addr = await app.listen({ port: config.port, host: config.host });
      handle.listening = true;
      logger.info({ addr }, "zenityx-compress listening");
      return addr;
    },
    async close() {
      try {
        await app.close();
      } finally {
        await worker.stop();
        cleanup.stop();
      }
    },
  };
  return handle;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig(process.env);
  buildServer(config)
    .then(async (handle) => {
      let shuttingDown = false;
      const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info({ signal }, "shutting down");
        try {
          await handle.close();
          process.exit(0);
        } catch (err) {
          logger.error({ err }, "shutdown failed");
          process.exit(1);
        }
      };
      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      await handle.listen();
    })
    .catch((err) => {
      logger.error({ err }, "failed to start server");
      process.exit(1);
    });
}
