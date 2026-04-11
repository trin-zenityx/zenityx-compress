import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default("127.0.0.1"),

  AUTH_PASSWORD_HASH: z
    .string()
    .min(1, "AUTH_PASSWORD_HASH is required")
    .refine((v) => v.startsWith("$2b$") || v.startsWith("$2a$"), {
      message: "AUTH_PASSWORD_HASH must be a bcrypt hash",
    }),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),

  UPLOAD_DIR: z.string().min(1),
  OUTPUT_DIR: z.string().min(1),
  RETENTION_HOURS: z.coerce.number().positive().default(1),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  QUEUE_MAX: z.coerce.number().int().positive().default(20),

  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  authPasswordHash: string;
  sessionSecret: string;
  uploadDir: string;
  outputDir: string;
  retentionHours: number;
  maxUploadMB: number;
  workerConcurrency: number;
  workerTimeoutMs: number;
  queueMax: number;
  loginRateLimit: number;
  loginRateWindowMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  const parsed = envSchema.parse(env);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    authPasswordHash: parsed.AUTH_PASSWORD_HASH,
    sessionSecret: parsed.SESSION_SECRET,
    uploadDir: parsed.UPLOAD_DIR,
    outputDir: parsed.OUTPUT_DIR,
    retentionHours: parsed.RETENTION_HOURS,
    maxUploadMB: parsed.MAX_UPLOAD_MB,
    workerConcurrency: parsed.WORKER_CONCURRENCY,
    workerTimeoutMs: parsed.WORKER_TIMEOUT_MS,
    queueMax: parsed.QUEUE_MAX,
    loginRateLimit: parsed.LOGIN_RATE_LIMIT,
    loginRateWindowMs: parsed.LOGIN_RATE_WINDOW_MS,
  };
}
