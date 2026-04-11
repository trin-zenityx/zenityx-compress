import { readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import cron from "node-cron";
import { logger } from "../utils/logger.js";

export interface SweepOptions {
  uploadsDir: string;
  outputsDir: string;
  retentionHours: number;
  orphanUploadsMinutes: number;
}

async function listDirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function sweepDir(dir: string, maxAgeMs: number): Promise<number> {
  const entries = await listDirSafe(dir);
  const now = Date.now();
  let removed = 0;
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const s = await stat(full);
      if (now - s.mtimeMs > maxAgeMs) {
        await rm(full, { recursive: true, force: true });
        removed += 1;
      }
    } catch (err) {
      logger.warn({ err, path: full }, "cleanup entry failed");
    }
  }
  return removed;
}

export async function sweepExpired(opts: SweepOptions): Promise<{ outputs: number; uploads: number }> {
  const outputs = await sweepDir(opts.outputsDir, opts.retentionHours * 3600 * 1000);
  const uploads = await sweepDir(opts.uploadsDir, opts.orphanUploadsMinutes * 60 * 1000);
  if (outputs > 0 || uploads > 0) {
    logger.info({ outputs, uploads }, "cleanup swept expired job directories");
  }
  return { outputs, uploads };
}

export interface CleanupJob {
  stop(): void;
}

export function startCleanupCron(opts: SweepOptions): CleanupJob {
  const task = cron.schedule("*/10 * * * *", () => {
    sweepExpired(opts).catch((err) => logger.error({ err }, "cleanup cron failed"));
  });
  return {
    stop() {
      task.stop();
    },
  };
}
