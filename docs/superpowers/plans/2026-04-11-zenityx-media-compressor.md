# ZenityX Media Compressor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal web tool that lets the ZenityX admin team drop videos or images in a browser, watch live 2-pass ffmpeg encoding progress, and download results sized to a preset (ManyChat = video ≤25 MB, image ≤5 MB) — hosted on the existing VPS at `compress.zenityx.com`.

**Architecture:** Single Node.js 22 + TypeScript + Fastify process that owns HTTP, BullMQ in-memory queue, and two worker handlers (video via fluent-ffmpeg 2-pass, image via sharp quality-loop). Frontend is a single static HTML page with Alpine.js and Tailwind CDN, using Server-Sent Events for live progress. Deployment is Caddy (reverse proxy + Let's Encrypt) + systemd on the existing Ubuntu 24.04 VPS.

**Tech Stack:** Node.js 22, TypeScript, Fastify, @fastify/secure-session, @fastify/multipart, @fastify/rate-limit, BullMQ, fluent-ffmpeg, sharp, pino, node-cron, zod, bcrypt, nanoid, Alpine.js, Tailwind CDN, Vitest, Caddy 2, systemd.

**Spec:** `docs/superpowers/specs/2026-04-11-zenityx-media-compressor-design.md`

---

## Conventions used throughout this plan

- **TDD:** every code task writes a failing test first, verifies failure, implements, verifies pass, commits.
- **Commits:** small and frequent — one commit per passing task, using Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`, `fix:`).
- **File paths:** all absolute from the project root `/Users/trin/Projects/zenityx-compress/`. Commands assume CWD is the project root unless stated otherwise.
- **Test runner:** `npm test` runs Vitest once; `npm run test:watch` runs in watch mode.
- **Code style:** TypeScript strict mode, no `any` without comment, prefer named exports, 2-space indent, ESM modules (`"type": "module"` in package.json).
- **Imports:** use `.js` extensions in relative imports (ESM requirement even when source is `.ts`).
- **Logging:** never `console.log` in `src/` — use the pino logger from `src/utils/logger.ts`.
- **Errors:** throw typed errors with a `code` string; routes map `code` to HTTP status.

## Execution order

Chunks are sequential — do not start chunk N+1 until chunk N is committed and passing. Inside a chunk, tasks are also sequential.

---

## Chunk 1: Scaffolding and core primitives

This chunk sets up the project skeleton, test runner, and the pure functions that later chunks depend on. After this chunk, there is no running server yet — just a tested library.

**Chunk 1 produces:**
- Installable Node project (`npm install` works).
- `npm test` runs and passes.
- Typed env config loader.
- Pino logger.
- Path helpers for uploads and outputs.
- Bitrate calculator.
- Preset registry (ManyChat + custom schema).

### Task 1.1: Initialize package.json and TypeScript

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "zenityx-compress",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "hash-password": "tsx scripts/hash-password.ts"
  },
  "dependencies": {
    "@fastify/multipart": "^9.0.1",
    "@fastify/rate-limit": "^10.2.1",
    "@fastify/secure-session": "^8.1.1",
    "@fastify/static": "^8.0.3",
    "bcrypt": "^5.1.1",
    "bullmq": "^5.28.0",
    "fastify": "^5.1.0",
    "file-type": "^19.6.0",
    "fluent-ffmpeg": "^2.1.3",
    "nanoid": "^5.0.9",
    "node-cron": "^3.0.3",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "sharp": "^0.33.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/fluent-ffmpeg": "^2.1.27",
    "@types/node": "^22.9.0",
    "@types/node-cron": "^3.0.11",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    globals: false,
  },
});
```

- [ ] **Step 4: Write `.env.example`**

```
NODE_ENV=development
PORT=4100
HOST=127.0.0.1
LOG_LEVEL=info

# Auth — generate with `npm run hash-password`
AUTH_PASSWORD_HASH=
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=

# Storage
UPLOAD_DIR=/var/compress/uploads
OUTPUT_DIR=/var/compress/outputs
RETENTION_HOURS=1
MAX_UPLOAD_MB=500

# Queue
WORKER_CONCURRENCY=2
WORKER_TIMEOUT_MS=900000
QUEUE_MAX=20

# Login rate limit
LOGIN_RATE_LIMIT=10
LOGIN_RATE_WINDOW_MS=900000
```

- [ ] **Step 5: Install dependencies**

Run: `cd /Users/trin/Projects/zenityx-compress && npm install`
Expected: installs without errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 6: Verify typecheck and test run (empty)**

Run: `npm run typecheck`
Expected: passes with no files (or error about no inputs — acceptable at this stage).

Run: `npm test`
Expected: Vitest reports "No test files found" — acceptable.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example
git commit -m "chore: scaffold Node + TypeScript + Vitest project"
```

---

### Task 1.2: Logger (`src/utils/logger.ts`)

**Files:**
- Create: `src/utils/logger.ts`
- Create: `src/utils/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/logger.test.ts
import { describe, it, expect } from "vitest";
import { logger } from "./logger.js";

describe("logger", () => {
  it("exports a pino instance with info level", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("creates child loggers with bindings", () => {
    const child = logger.child({ reqId: "abc" });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/logger.test.ts`
Expected: FAIL — module `./logger.js` not found.

- [ ] **Step 3: Implement `src/utils/logger.ts`**

```typescript
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/logger.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger.ts src/utils/logger.test.ts
git commit -m "feat: pino logger with dev pretty-print"
```

---

### Task 1.3: Config loader (`src/config.ts`)

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";

const baseEnv = {
  NODE_ENV: "test",
  PORT: "4100",
  HOST: "127.0.0.1",
  AUTH_PASSWORD_HASH: "$2b$12$dummyhashdummyhashdummyhashdummyhashdumm",
  SESSION_SECRET: "a".repeat(64),
  UPLOAD_DIR: "/tmp/test-uploads",
  OUTPUT_DIR: "/tmp/test-outputs",
  RETENTION_HOURS: "1",
  MAX_UPLOAD_MB: "500",
  WORKER_CONCURRENCY: "2",
  WORKER_TIMEOUT_MS: "900000",
  QUEUE_MAX: "20",
  LOGIN_RATE_LIMIT: "10",
  LOGIN_RATE_WINDOW_MS: "900000",
};

describe("loadConfig", () => {
  it("parses a valid env into a typed config", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.port).toBe(4100);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.sessionSecret).toHaveLength(64);
    expect(cfg.retentionHours).toBe(1);
    expect(cfg.maxUploadMB).toBe(500);
    expect(cfg.workerConcurrency).toBe(2);
    expect(cfg.queueMax).toBe(20);
  });

  it("throws when SESSION_SECRET is too short", () => {
    const bad = { ...baseEnv, SESSION_SECRET: "short" };
    expect(() => loadConfig(bad)).toThrow(/SESSION_SECRET/);
  });

  it("throws when AUTH_PASSWORD_HASH is empty", () => {
    const bad = { ...baseEnv, AUTH_PASSWORD_HASH: "" };
    expect(() => loadConfig(bad)).toThrow(/AUTH_PASSWORD_HASH/);
  });

  it("coerces numeric fields from strings", () => {
    const cfg = loadConfig({ ...baseEnv, PORT: "8080" });
    expect(cfg.port).toBe(8080);
    expect(typeof cfg.port).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/config.test.ts`
Expected: FAIL — module `./config.js` not found.

- [ ] **Step 3: Implement `src/config.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/config.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: typed env config loader with zod validation"
```

---

### Task 1.4: Storage paths (`src/storage/paths.ts`)

**Files:**
- Create: `src/storage/paths.ts`
- Create: `src/storage/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/storage/paths.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newJobId,
  uploadPathFor,
  outputPathFor,
  ensureJobUploadDir,
  ensureJobOutputDir,
  removeJobUploadDir,
  removeJobOutputDir,
  outputFilenameFor,
} from "./paths.js";

describe("paths", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "zx-test-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("newJobId returns a 10-char nanoid string", () => {
    const id = newJobId();
    expect(id).toHaveLength(10);
    expect(/^[A-Za-z0-9_-]{10}$/.test(id)).toBe(true);
  });

  it("uploadPathFor composes dir, jobId, and filename", () => {
    const p = uploadPathFor(base, "abc123xyz0", "clip.mp4");
    expect(p).toBe(join(base, "abc123xyz0", "clip.mp4"));
  });

  it("outputPathFor composes dir, jobId, and filename", () => {
    const p = outputPathFor(base, "abc123xyz0", "clip.ready-for-manychat.mp4");
    expect(p).toBe(join(base, "abc123xyz0", "clip.ready-for-manychat.mp4"));
  });

  it("ensureJobUploadDir creates the job directory", async () => {
    const dir = await ensureJobUploadDir(base, "job1");
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
  });

  it("removeJobUploadDir deletes the directory recursively", async () => {
    const dir = await ensureJobUploadDir(base, "job2");
    await removeJobUploadDir(base, "job2");
    await expect(stat(dir)).rejects.toThrow();
  });

  it("ensureJobOutputDir creates the output job directory", async () => {
    const dir = await ensureJobOutputDir(base, "job3");
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
  });

  it("removeJobOutputDir deletes the output directory recursively", async () => {
    const dir = await ensureJobOutputDir(base, "job4");
    await removeJobOutputDir(base, "job4");
    await expect(stat(dir)).rejects.toThrow();
  });

  it("outputFilenameFor inserts preset id as suffix before extension", () => {
    expect(outputFilenameFor("clip.mp4", "manychat")).toBe("clip.ready-for-manychat.mp4");
    expect(outputFilenameFor("image.PNG", "manychat")).toBe("image.ready-for-manychat.jpg");
    expect(outputFilenameFor("ชื่อไทย.mp4", "manychat")).toBe("ชื่อไทย.ready-for-manychat.mp4");
    expect(outputFilenameFor("no-ext", "manychat")).toBe("no-ext.ready-for-manychat");
  });

  it("outputFilenameFor uses custom-<MB> when preset is custom", () => {
    expect(outputFilenameFor("clip.mp4", "custom", 24)).toBe("clip.ready-for-24mb.mp4");
  });

  it("outputFilenameFor converts PNG/WebP/HEIC source to .jpg", () => {
    expect(outputFilenameFor("logo.png", "manychat")).toBe("logo.ready-for-manychat.jpg");
    expect(outputFilenameFor("photo.webp", "manychat")).toBe("photo.ready-for-manychat.jpg");
    expect(outputFilenameFor("pic.jpeg", "manychat")).toBe("pic.ready-for-manychat.jpg");
    expect(outputFilenameFor("shot.heic", "manychat")).toBe("shot.ready-for-manychat.jpg");
    expect(outputFilenameFor("shot.HEIF", "manychat")).toBe("shot.ready-for-manychat.jpg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/storage/paths.test.ts`
Expected: FAIL — module `./paths.js` not found.

- [ ] **Step 3: Implement `src/storage/paths.ts`**

```typescript
import { mkdir, rm } from "node:fs/promises";
import { join, parse } from "node:path";
import { customAlphabet } from "nanoid";

const nanoid10 = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",
  10,
);

export function newJobId(): string {
  return nanoid10();
}

export function uploadPathFor(uploadDir: string, jobId: string, filename: string): string {
  return join(uploadDir, jobId, filename);
}

export function outputPathFor(outputDir: string, jobId: string, filename: string): string {
  return join(outputDir, jobId, filename);
}

export async function ensureJobUploadDir(uploadDir: string, jobId: string): Promise<string> {
  const dir = join(uploadDir, jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureJobOutputDir(outputDir: string, jobId: string): Promise<string> {
  const dir = join(outputDir, jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeJobUploadDir(uploadDir: string, jobId: string): Promise<void> {
  await rm(join(uploadDir, jobId), { recursive: true, force: true });
}

export async function removeJobOutputDir(outputDir: string, jobId: string): Promise<void> {
  await rm(join(outputDir, jobId), { recursive: true, force: true });
}

/**
 * Builds the download filename:
 *   clip.mp4  +  "manychat"        → clip.ready-for-manychat.mp4
 *   logo.png  +  "manychat"        → logo.ready-for-manychat.jpg  (images normalize to .jpg)
 *   clip.mp4  +  "custom" + 24     → clip.ready-for-24mb.mp4
 */
export function outputFilenameFor(
  originalName: string,
  presetId: string,
  customTargetMB?: number,
): string {
  const parsed = parse(originalName);
  const ext = parsed.ext.toLowerCase();
  const isImageExt = [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"].includes(ext);
  const finalExt = isImageExt ? ".jpg" : ext;

  const suffix =
    presetId === "custom" && customTargetMB !== undefined
      ? `ready-for-${customTargetMB}mb`
      : `ready-for-${presetId}`;

  return `${parsed.name}.${suffix}${finalExt}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/storage/paths.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/storage/paths.ts src/storage/paths.test.ts
git commit -m "feat: storage path helpers and output filename builder"
```

---

### Task 1.5: Bitrate calculator (`src/utils/bitrate.ts`)

**Files:**
- Create: `src/utils/bitrate.ts`
- Create: `src/utils/bitrate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/bitrate.test.ts
import { describe, it, expect } from "vitest";
import { calcVideoBitrate, BitrateError } from "./bitrate.js";

describe("calcVideoBitrate", () => {
  it("returns a positive integer kbps for a typical 60s / 25MB request", () => {
    const kbps = calcVideoBitrate(60, 25);
    expect(Number.isInteger(kbps)).toBe(true);
    expect(kbps).toBeGreaterThan(500);
    expect(kbps).toBeLessThan(4000);
  });

  it("applies the 93% safety margin", () => {
    // 60s, 25MB:
    // targetBits = 25 * 1024 * 1024 * 8 = 209,715,200
    // *0.93 = 195,035,136
    // /60 = 3,250,585 bits/s
    // /1000 = 3250.585 kbps total
    // - 128 (audio) = 3122.585 → floor → 3122
    const kbps = calcVideoBitrate(60, 25, 128);
    expect(kbps).toBe(3122);
  });

  it("uses default audio bitrate of 128 when not specified", () => {
    expect(calcVideoBitrate(60, 25)).toBe(calcVideoBitrate(60, 25, 128));
  });

  it("throws BitrateError when resulting video bitrate < 500", () => {
    // 600s (10min) @ 5MB → very low bitrate
    expect(() => calcVideoBitrate(600, 5)).toThrow(BitrateError);
  });

  it("throws with duration zero or negative", () => {
    expect(() => calcVideoBitrate(0, 25)).toThrow(BitrateError);
    expect(() => calcVideoBitrate(-1, 25)).toThrow(BitrateError);
  });

  it("throws with targetMB zero or negative", () => {
    expect(() => calcVideoBitrate(60, 0)).toThrow(BitrateError);
    expect(() => calcVideoBitrate(60, -10)).toThrow(BitrateError);
  });

  it("BitrateError has code VIDEO_TOO_LONG_FOR_TARGET when too long", () => {
    try {
      calcVideoBitrate(600, 5);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BitrateError);
      expect((err as BitrateError).code).toBe("VIDEO_TOO_LONG_FOR_TARGET");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/bitrate.test.ts`
Expected: FAIL — module `./bitrate.js` not found.

- [ ] **Step 3: Implement `src/utils/bitrate.ts`**

```typescript
export class BitrateError extends Error {
  constructor(
    public readonly code:
      | "VIDEO_TOO_LONG_FOR_TARGET"
      | "INVALID_DURATION"
      | "INVALID_TARGET",
    message: string,
  ) {
    super(message);
    this.name = "BitrateError";
  }
}

const SAFETY_MARGIN = 0.93;
const MIN_VIDEO_KBPS = 500;

/**
 * Compute the video bitrate (kbps) that will produce an output file of
 * roughly targetMB when encoded with the given audio bitrate. Uses a
 * 93% safety margin because ffmpeg 2-pass typically lands within ±3%
 * of target; the extra 4% keeps us under the ceiling.
 */
export function calcVideoBitrate(
  durationSec: number,
  targetMB: number,
  audioKbps: number = 128,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new BitrateError("INVALID_DURATION", `Invalid duration: ${durationSec}`);
  }
  if (!Number.isFinite(targetMB) || targetMB <= 0) {
    throw new BitrateError("INVALID_TARGET", `Invalid target: ${targetMB}`);
  }

  const targetBits = targetMB * 1024 * 1024 * 8;
  const totalKbps = Math.floor((targetBits * SAFETY_MARGIN) / durationSec / 1000);
  const videoKbps = totalKbps - audioKbps;

  if (videoKbps < MIN_VIDEO_KBPS) {
    throw new BitrateError(
      "VIDEO_TOO_LONG_FOR_TARGET",
      `วีดีโอยาว ${durationSec.toFixed(1)}s เกินไปสำหรับเป้า ${targetMB}MB (ได้ ${videoKbps} kbps, ต้องการอย่างน้อย ${MIN_VIDEO_KBPS})`,
    );
  }

  return videoKbps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/bitrate.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/bitrate.ts src/utils/bitrate.test.ts
git commit -m "feat: video bitrate calculator with 93% safety margin"
```

---

### Task 1.6: Presets (`src/presets/index.ts`)

**Files:**
- Create: `src/presets/index.ts`
- Create: `src/presets/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/presets/index.test.ts
import { describe, it, expect } from "vitest";
import {
  PRESETS,
  getPreset,
  resolveTargetMB,
  customPresetSchema,
  UnknownPresetError,
} from "./index.js";

describe("presets", () => {
  it("PRESETS includes manychat as the default", () => {
    expect(PRESETS.manychat).toBeDefined();
    expect(PRESETS.manychat.name).toBe("ManyChat");
    expect(PRESETS.manychat.videoMaxMB).toBe(25);
    expect(PRESETS.manychat.imageMaxMB).toBe(5);
  });

  it("getPreset returns the manychat preset by id", () => {
    const p = getPreset("manychat");
    expect(p.id).toBe("manychat");
  });

  it("getPreset throws UnknownPresetError on unknown id", () => {
    expect(() => getPreset("unknown")).toThrow(UnknownPresetError);
  });

  it("resolveTargetMB returns video limit for video type", () => {
    const p = getPreset("manychat");
    expect(resolveTargetMB(p, "video")).toBe(25);
  });

  it("resolveTargetMB returns image limit for image type", () => {
    const p = getPreset("manychat");
    expect(resolveTargetMB(p, "image")).toBe(5);
  });

  it("customPresetSchema accepts a valid MB value", () => {
    expect(customPresetSchema.parse({ targetMB: 24 })).toEqual({ targetMB: 24 });
  });

  it("customPresetSchema rejects values outside 1..500", () => {
    expect(() => customPresetSchema.parse({ targetMB: 0 })).toThrow();
    expect(() => customPresetSchema.parse({ targetMB: 501 })).toThrow();
    expect(() => customPresetSchema.parse({ targetMB: -5 })).toThrow();
  });

  it("customPresetSchema coerces string numbers", () => {
    expect(customPresetSchema.parse({ targetMB: "24" })).toEqual({ targetMB: 24 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/presets/index.test.ts`
Expected: FAIL — module `./index.js` not found.

- [ ] **Step 3: Implement `src/presets/index.ts`**

```typescript
import { z } from "zod";

export type MediaType = "video" | "image";

export interface Preset {
  id: string;
  name: string;
  videoMaxMB: number;
  imageMaxMB: number;
  default?: boolean;
}

export const PRESETS: Record<string, Preset> = {
  manychat: {
    id: "manychat",
    name: "ManyChat",
    videoMaxMB: 25,
    imageMaxMB: 5,
    default: true,
  },
};

export class UnknownPresetError extends Error {
  constructor(presetId: string) {
    super(`Unknown preset: ${presetId}`);
    this.name = "UnknownPresetError";
  }
}

export function getPreset(presetId: string): Preset {
  const preset = PRESETS[presetId];
  if (!preset) {
    throw new UnknownPresetError(presetId);
  }
  return preset;
}

export function resolveTargetMB(preset: Preset, type: MediaType): number {
  return type === "video" ? preset.videoMaxMB : preset.imageMaxMB;
}

export const customPresetSchema = z.object({
  targetMB: z.coerce.number().int().min(1).max(500),
});

export type CustomPresetInput = z.infer<typeof customPresetSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/presets/index.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/presets/index.ts src/presets/index.test.ts
git commit -m "feat: preset registry with ManyChat and custom schema"
```

---

### Task 1.7: Full chunk 1 verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass — logger, config, paths, bitrate, presets (5 test files, ~30 assertions).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no type errors.

- [ ] **Step 3: Verify chunk 1 git history**

Run: `git log --oneline`
Expected: at least 7 commits since the brainstorming commits, all lowercase Conventional Commit messages.

- [ ] **Step 4: Push progress if desired**

(Manual — user decides when to push to GitHub.)

---

**End of Chunk 1.** Next: Chunk 2 (auth, session, probe).

---

## Chunk 2: Auth, session, and ffprobe wrapper

This chunk adds everything needed to gate access to the app and read video metadata from uploaded files. After this chunk, we still don't have a running server — auth helpers are pure functions tested in isolation, and `probe.ts` is tested against a tiny fixture video.

**Chunk 2 produces:**
- Bcrypt-backed password verification.
- `scripts/hash-password.ts` CLI for generating hashes.
- Session plugin registration function (tested structurally).
- Login route handler (tested via Fastify inject — no real server).
- Rate-limited login.
- `ffprobe` wrapper that returns structured metadata.

**External tooling required before chunk 2:**
- `ffmpeg` and `ffprobe` binaries on `PATH`. The dev machine already has them from Homebrew. Verify with `ffprobe -version`.
- A tiny MP4 test fixture. We generate it in the first probe task rather than checking a binary into git.

### Task 2.1: Password hashing helper

**Files:**
- Create: `src/auth/password.ts`
- Create: `src/auth/password.test.ts`
- Create: `scripts/hash-password.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/auth/password.test.ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashPassword returns a bcrypt hash starting with $2b$", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash.startsWith("$2b$")).toBe(true);
    expect(hash.length).toBeGreaterThan(50);
  });

  it("verifyPassword returns true for matching password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("verifyPassword returns false for non-matching password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("verifyPassword returns false for malformed hash without throwing", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/auth/password.test.ts`
Expected: FAIL — module `./password.js` not found.

- [ ] **Step 3: Implement `src/auth/password.ts`**

```typescript
import bcrypt from "bcrypt";

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    // Malformed hashes throw — treat as mismatch rather than crash.
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/auth/password.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Implement `scripts/hash-password.ts`**

```typescript
// scripts/hash-password.ts
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword } from "../src/auth/password.js";

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const password = await rl.question("Enter new password: ");
  rl.close();
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  console.log("");
  console.log("Copy this into .env as AUTH_PASSWORD_HASH:");
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Smoke test the CLI**

Run: `echo "testpassword" | npm run hash-password`
Expected: prints a `$2b$12$...` hash to stdout.

- [ ] **Step 7: Commit**

```bash
git add src/auth/password.ts src/auth/password.test.ts scripts/hash-password.ts
git commit -m "feat: bcrypt password hashing + hash-password CLI"
```

---

### Task 2.2: Session plugin registration

**Files:**
- Create: `src/auth/session.ts`
- Create: `src/auth/session.test.ts`

`@fastify/secure-session` reads the key from a Buffer. For production the key comes from `config.sessionSecret` (already 32+ chars); we pass it as a `key` option after hex-decoding.

- [ ] **Step 1: Write the failing test**

```typescript
// src/auth/session.test.ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerSession } from "./session.js";

const SECRET = "a".repeat(64);  // 64 hex chars → 32 bytes

describe("registerSession", () => {
  it("registers the plugin and adds a session decorator on request", async () => {
    const app = Fastify();
    await registerSession(app, SECRET);

    app.get("/probe", async (req) => {
      return { hasSession: typeof req.session === "object" };
    });

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hasSession: true });

    await app.close();
  });

  it("sets HttpOnly + Secure + SameSite Strict cookie when a value is written", async () => {
    const app = Fastify();
    await registerSession(app, SECRET);

    app.get("/write", async (req, reply) => {
      req.session.set("userId", "abc");
      return reply.send({ ok: true });
    });

    const res = await app.inject({ method: "GET", url: "/write" });
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie);
    expect(cookieHeader).toMatch(/HttpOnly/);
    expect(cookieHeader).toMatch(/SameSite=Strict/);

    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/auth/session.test.ts`
Expected: FAIL — module `./session.js` not found.

- [ ] **Step 3: Implement `src/auth/session.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import fastifySecureSession from "@fastify/secure-session";

/**
 * Registers @fastify/secure-session on the given Fastify instance.
 * Call once at startup.
 *
 * Key derivation: session secret is a 64-character hex string (32 bytes).
 * We decode it and pass the Buffer as the key option.
 */
export async function registerSession(app: FastifyInstance, sessionSecret: string): Promise<void> {
  const key = Buffer.from(sessionSecret, "hex");
  if (key.length < 32) {
    throw new Error("sessionSecret must decode to at least 32 bytes (64 hex chars)");
  }

  await app.register(fastifySecureSession, {
    key,
    cookieName: "zx_session",
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      // Secure is set automatically when served over HTTPS;
      // during local dev (http://localhost) Secure would break the cookie.
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24,  // 24 hours, in seconds
    },
  });
}

/**
 * Type helper — augments FastifyRequest session shape.
 * Consumers access req.session.get("userId") / .set("userId", "...")
 */
declare module "@fastify/secure-session" {
  interface SessionData {
    userId: string;      // we use a nanoid stored on login
    loggedInAt: number;  // unix seconds
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/auth/session.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/session.ts src/auth/session.test.ts
git commit -m "feat: fastify secure-session plugin registration"
```

---

### Task 2.3: Login and logout routes

**Files:**
- Create: `src/auth/login-route.ts`
- Create: `src/auth/login-route.test.ts`

The route plugin here does not set up rate limiting — that gets added in the next task as a separate concern so we can test business logic without rate-limit timing.

- [ ] **Step 1: Write the failing test**

```typescript
// src/auth/login-route.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSession } from "./session.js";
import { registerAuthRoutes } from "./login-route.js";
import { hashPassword } from "./password.js";

const SECRET = "a".repeat(64);

async function buildApp(hash: string): Promise<FastifyInstance> {
  const app = Fastify();
  await registerSession(app, SECRET);
  await registerAuthRoutes(app, {
    passwordHash: hash,
    loginRateLimit: 100,
    loginRateWindowMs: 60_000,
  });
  return app;
}

describe("auth routes", () => {
  let app: FastifyInstance;
  let hash: string;

  beforeEach(async () => {
    hash = await hashPassword("hunter2");
    app = await buildApp(hash);
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /api/login with correct password returns 200 + sets cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "hunter2" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("POST /api/login with wrong password returns 401 invalid_password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "invalid_password" });
  });

  it("POST /api/login with missing password returns 400 bad_request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_request" });
  });

  it("POST /api/logout clears the session cookie", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "hunter2" },
    });
    const cookie = login.headers["set-cookie"] as string;

    const res = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers["set-cookie"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/auth/login-route.test.ts`
Expected: FAIL — module `./login-route.js` not found.

- [ ] **Step 3: Implement `src/auth/login-route.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyPassword } from "./password.js";
import { nanoid } from "nanoid";

const loginBodySchema = z.object({
  password: z.string().min(1),
});

export interface AuthRoutesOptions {
  passwordHash: string;
  loginRateLimit: number;      // max attempts per window
  loginRateWindowMs: number;   // window size
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  opts: AuthRoutesOptions,
): Promise<void> {
  app.post("/api/login", async (req, reply) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request" });
    }
    const { password } = parsed.data;

    const ok = await verifyPassword(password, opts.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_password" });
    }

    req.session.set("userId", nanoid(12));
    req.session.set("loggedInAt", Math.floor(Date.now() / 1000));
    return reply.code(200).send({ ok: true });
  });

  app.post("/api/logout", async (req, reply) => {
    req.session.delete();
    return reply.code(200).send({ ok: true });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/auth/login-route.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/login-route.ts src/auth/login-route.test.ts
git commit -m "feat: POST /api/login and /api/logout routes"
```

---

### Task 2.4: Login rate limiting

`@fastify/rate-limit` lets us scope a limiter to a single route and key by IP. We register it but only enforce on `/api/login`.

**Files:**
- Modify: `src/auth/login-route.ts` — add rate-limit config
- Modify: `src/auth/login-route.test.ts` — add one rate-limit test

- [ ] **Step 1: Extend the test with a rate-limit scenario**

Append to `src/auth/login-route.test.ts`:

```typescript
describe("login rate limit", () => {
  let rlApp: FastifyInstance;

  beforeEach(async () => {
    const h = await hashPassword("hunter2");
    rlApp = Fastify();
    await registerSession(rlApp, SECRET);
    await registerAuthRoutes(rlApp, {
      passwordHash: h,
      loginRateLimit: 3,      // tiny limit for test
      loginRateWindowMs: 60_000,
    });
  });

  afterEach(async () => {
    await rlApp.close();
  });

  it("returns 429 rate_limited with retryAfterSec after exceeding limit", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await rlApp.inject({
        method: "POST",
        url: "/api/login",
        payload: { password: "wrong" },
        remoteAddress: "10.0.0.1",
      });
      expect(r.statusCode).toBe(401);
    }

    const blocked = await rlApp.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "wrong" },
      remoteAddress: "10.0.0.1",
    });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json();
    expect(body.error).toBe("rate_limited");
    expect(typeof body.retryAfterSec).toBe("number");
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(body.retryAfterSec).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/auth/login-route.test.ts`
Expected: last test FAILS (4 passing attempts now return 401 instead of 429).

- [ ] **Step 3: Update `src/auth/login-route.ts` to register `@fastify/rate-limit` scoped to `/api/login` with spec-compliant 429 body**

Replace the implementation with:

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyPassword } from "./password.js";
import { nanoid } from "nanoid";
import fastifyRateLimit from "@fastify/rate-limit";

const loginBodySchema = z.object({
  password: z.string().min(1),
});

export interface AuthRoutesOptions {
  passwordHash: string;
  loginRateLimit: number;
  loginRateWindowMs: number;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  opts: AuthRoutesOptions,
): Promise<void> {
  // Register rate-limit plugin but don't apply it globally.
  await app.register(fastifyRateLimit, { global: false });

  app.post(
    "/api/login",
    {
      config: {
        rateLimit: {
          max: opts.loginRateLimit,
          timeWindow: opts.loginRateWindowMs,
          // Spec §8: 429 body shape = { error: "rate_limited", retryAfterSec: N }
          errorResponseBuilder: (_req: FastifyRequest, context: { after: string; ttl: number }) => ({
            statusCode: 429,
            error: "rate_limited",
            retryAfterSec: Math.ceil(context.ttl / 1000),
          }),
        },
      },
    },
    async (req, reply) => {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request" });
      }
      const { password } = parsed.data;

      const ok = await verifyPassword(password, opts.passwordHash);
      if (!ok) {
        return reply.code(401).send({ error: "invalid_password" });
      }

      req.session.set("userId", nanoid(12));
      req.session.set("loggedInAt", Math.floor(Date.now() / 1000));
      return reply.code(200).send({ ok: true });
    },
  );

  app.post("/api/logout", async (req, reply) => {
    req.session.delete();
    return reply.code(200).send({ ok: true });
  });
}
```

Note: `@fastify/rate-limit`'s `errorResponseBuilder` receives a context with `ttl` in milliseconds (time remaining in the current window). We convert to seconds for `retryAfterSec`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/auth/login-route.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/login-route.ts src/auth/login-route.test.ts
git commit -m "feat: rate-limit /api/login to N attempts per window per IP"
```

---

### Task 2.5: Require-login helper

This decorator wraps route handlers that should reject unauthenticated requests. Used by every authenticated route added in chunk 4.

**Files:**
- Create: `src/auth/require-login.ts`
- Create: `src/auth/require-login.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/auth/require-login.test.ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerSession } from "./session.js";
import { registerAuthRoutes } from "./login-route.js";
import { requireLogin } from "./require-login.js";
import { hashPassword } from "./password.js";

const SECRET = "a".repeat(64);

describe("requireLogin", () => {
  it("returns 401 when there is no session", async () => {
    const app = Fastify();
    await registerSession(app, SECRET);
    app.get("/secret", { preHandler: requireLogin }, async () => ({ ok: true }));

    const res = await app.inject({ method: "GET", url: "/secret" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "auth_required" });
    await app.close();
  });

  it("passes through when a userId is set on the session", async () => {
    const hash = await hashPassword("hunter2");
    const app = Fastify();
    await registerSession(app, SECRET);
    await registerAuthRoutes(app, {
      passwordHash: hash,
      loginRateLimit: 100,
      loginRateWindowMs: 60_000,
    });
    app.get("/secret", { preHandler: requireLogin }, async () => ({ ok: true }));

    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "hunter2" },
    });
    const cookie = login.headers["set-cookie"] as string;

    const res = await app.inject({
      method: "GET",
      url: "/secret",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/auth/require-login.test.ts`
Expected: FAIL — module `./require-login.js` not found.

- [ ] **Step 3: Implement `src/auth/require-login.ts`**

```typescript
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Fastify preHandler that rejects requests without a logged-in session.
 *
 * Contract: if there is no userId on the session, this calls reply.send()
 * with a 401 body and returns. Fastify short-circuits further handlers
 * once a reply has been sent, so callers never run if this rejects.
 */
export async function requireLogin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = req.session.get("userId");
  if (!userId) {
    await reply.code(401).send({ error: "auth_required" });
    return;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/auth/require-login.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/require-login.ts src/auth/require-login.test.ts
git commit -m "feat: requireLogin preHandler for authenticated routes"
```

---

### Task 2.6: ffprobe wrapper

`src/utils/probe.ts` shells out to the `ffprobe` binary and returns a typed result. We test against a tiny MP4 that we generate on the fly with `ffmpeg` so there's no binary blob in git.

**Files:**
- Create: `src/utils/probe.ts`
- Create: `src/utils/probe.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/probe.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { probeMedia, ProbeError } from "./probe.js";

const execFileP = promisify(execFile);

describe("probeMedia", () => {
  let fixtureDir: string;
  let videoPath: string;
  let notAMedia: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "zx-probe-"));
    videoPath = join(fixtureDir, "tiny.mp4");
    notAMedia = join(fixtureDir, "not-a-media.mp4");

    // Generate a 2-second 320x240 test pattern video with silent audio.
    await execFileP("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:d=2:r=30",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-shortest",
      "-c:v", "libx264", "-preset", "ultrafast",
      "-c:a", "aac",
      videoPath,
    ]);

    // A file with .mp4 extension but garbage bytes inside.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(notAMedia, "not a real media file");
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("returns typed metadata for a valid video", async () => {
    const result = await probeMedia(videoPath);
    expect(result.hasVideo).toBe(true);
    expect(result.hasAudio).toBe(true);
    expect(result.durationSec).toBeGreaterThan(1.8);
    expect(result.durationSec).toBeLessThan(2.2);
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.fps).toBeGreaterThan(29);
    expect(result.fps).toBeLessThan(31);
    expect(result.videoCodec).toBe("h264");
  });

  it("throws ProbeError on invalid media", async () => {
    await expect(probeMedia(notAMedia)).rejects.toThrow(ProbeError);
  });

  it("throws ProbeError on a path that does not exist", async () => {
    await expect(probeMedia("/nope/does-not-exist.mp4")).rejects.toThrow(ProbeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/probe.test.ts`
Expected: FAIL — module `./probe.js` not found.

- [ ] **Step 3: Implement `src/utils/probe.ts`**

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface ProbeResult {
  hasVideo: boolean;
  hasAudio: boolean;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

export class ProbeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ProbeError";
  }
}

interface FFProbeOutput {
  streams: Array<{
    codec_type: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
  }>;
  format: {
    duration?: string;
  };
}

function parseFrameRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split("/").map(Number);
  if (!den) return num ?? 0;
  return num / den;
}

export async function probeMedia(inputPath: string): Promise<ProbeResult> {
  let raw: string;
  try {
    const result = await execFileP("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      inputPath,
    ]);
    raw = result.stdout;
  } catch (err) {
    throw new ProbeError(`ffprobe failed for ${inputPath}`, err);
  }

  let parsed: FFProbeOutput;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ProbeError(`ffprobe returned invalid JSON for ${inputPath}`, err);
  }

  const videoStream = parsed.streams.find((s) => s.codec_type === "video");
  const audioStream = parsed.streams.find((s) => s.codec_type === "audio");

  if (!videoStream && !audioStream) {
    throw new ProbeError(`no video or audio streams in ${inputPath}`);
  }

  const durationSec = Number.parseFloat(parsed.format.duration ?? "0");
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new ProbeError(`invalid duration in ${inputPath}`);
  }

  const fps = parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate);
  if (videoStream && (fps <= 0 || !Number.isFinite(fps))) {
    throw new ProbeError(`invalid frame rate in ${inputPath}`);
  }

  return {
    hasVideo: !!videoStream,
    hasAudio: !!audioStream,
    durationSec,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/probe.test.ts`
Expected: 3 passed. Takes ~3 seconds because it generates a fixture video with ffmpeg.

If ffmpeg is not on PATH, the test aborts in `beforeAll` with a clear error. That is acceptable — ffmpeg is a hard dependency.

- [ ] **Step 5: Commit**

```bash
git add src/utils/probe.ts src/utils/probe.test.ts
git commit -m "feat: ffprobe wrapper returning typed ProbeResult"
```

---

### Task 2.7: Full chunk 2 verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests from chunk 1 + chunk 2 pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Verify commit count**

Run: `git log --oneline | head -20`
Expected: 7 chunk-1 commits + 6 chunk-2 commits (password, session, login-route, rate-limit, require-login, probe).

---

**End of Chunk 2.** Next: Chunk 3 (queue, job types, image-job, video-job, worker).

---

## Chunk 3: Fixtures, job types, queue, image handler

This chunk starts building the media-processing engine. After this chunk we have everything except the video handler and the worker dispatcher — those are chunk 4.

**Chunk 3 produces:**
- Shared test fixture generators (videos and images created on demand).
- Typed `Job` / `ProgressEvent` shared types with predicates.
- An in-memory job store keyed by jobId with progress event emission.
- Image job handler: sharp loop with alpha-flatten, quality step-down, and downscale fallback.

**Decision: replace BullMQ with a hand-rolled in-memory queue.**

The spec initially listed BullMQ. After deeper review, BullMQ's in-memory mode still requires a Redis-compatible backend (`ioredis-mock` or similar) and pulls a large dependency just to serialize a single-process FIFO. A ~100-line hand-rolled queue with the same interface gives us:
- Zero extra runtime dependency.
- Typed in-process event emission (no JSON round-trip).
- Direct child-process handles for SIGTERM on cancel.

This deviates from spec §4 and §5. Record the deviation in the plan; update the spec after chunk 3 passes review.

**Fixtures:**
- `tests/fixtures/generate.ts` — small helper that uses ffmpeg and sharp to create test inputs at runtime. Shared between chunks 3, 4, 5. No binary blobs in git.

### Task 3.1: Shared fixture generator

**Files:**
- Create: `tests/fixtures/generate.ts`

- [ ] **Step 1: Implement the fixture helper**

```typescript
// tests/fixtures/generate.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const execFileP = promisify(execFile);

/**
 * Creates a short colored video with silent audio at the given path.
 * Default: 2 seconds, 320x240, 30fps, H.264.
 */
export async function makeTinyVideo(
  outputPath: string,
  opts: { durationSec?: number; width?: number; height?: number; color?: string } = {},
): Promise<void> {
  const { durationSec = 2, width = 320, height = 240, color = "red" } = opts;
  await execFileP("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}:d=${durationSec}:r=30`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-shortest",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    outputPath,
  ]);
}

/**
 * Creates a PNG image of the given size with a solid color fill and optional
 * alpha channel, written to outputPath. Solid-color images compress extremely
 * well — use makeNoisyPng for tests that need to force downscaling.
 */
export async function makePng(
  outputPath: string,
  opts: { width: number; height: number; withAlpha?: boolean; color?: { r: number; g: number; b: number } } = {
    width: 100,
    height: 100,
  },
): Promise<void> {
  const {
    width,
    height,
    withAlpha = false,
    color = { r: 200, g: 50, b: 50 },
  } = opts;
  await sharp({
    create: {
      width,
      height,
      channels: withAlpha ? 4 : 3,
      background: withAlpha ? { ...color, alpha: 0.5 } : color,
    },
  })
    .png()
    .toFile(outputPath);
}

/**
 * Creates a PNG filled with pseudo-random noise — does NOT compress well
 * with JPEG, so tests can reliably force a downscale or an unreachable
 * target. Uses a deterministic LCG so fixtures are stable across runs.
 */
export async function makeNoisyPng(
  outputPath: string,
  opts: { width: number; height: number } = { width: 500, height: 500 },
): Promise<void> {
  const { width, height } = opts;
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  let seed = 0xc0ffee;
  for (let i = 0; i < buf.length; i++) {
    // Linear congruential generator — cheap, deterministic, non-crypto.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = seed & 0xff;
  }
  await sharp(buf, { raw: { width, height, channels } }).png().toFile(outputPath);
}

/**
 * Creates a JPEG image by first making a PNG and then converting, so the size
 * is deterministic for tests asserting "before" sizes.
 */
export async function makeJpeg(
  outputPath: string,
  opts: { width: number; height: number; quality?: number } = { width: 100, height: 100 },
): Promise<void> {
  const { width, height, quality = 85 } = opts;
  await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .jpeg({ quality })
    .toFile(outputPath);
}

/** Write arbitrary bytes — used to make intentionally invalid files. */
export async function makeInvalidFile(outputPath: string, contents: string = "not media"): Promise<void> {
  await writeFile(outputPath, contents);
}
```

- [ ] **Step 2: Commit (no test — this file is a test utility)**

```bash
git add tests/fixtures/generate.ts
git commit -m "test: shared fixture generators for videos and images"
```

---

### Task 3.2: Job types

**Files:**
- Create: `src/jobs/types.ts`
- Create: `src/jobs/types.test.ts`

Types live in their own file so they can be imported by tests and handlers without circular dependencies.

- [ ] **Step 1: Write the failing test**

```typescript
// src/jobs/types.test.ts
import { describe, it, expect } from "vitest";
import { isVideoState, isImageState, isTerminalState, JOB_STATES } from "./types.js";

describe("job state helpers", () => {
  it("JOB_STATES exports the full list", () => {
    expect(JOB_STATES).toContain("queued");
    expect(JOB_STATES).toContain("probing");
    expect(JOB_STATES).toContain("pass1");
    expect(JOB_STATES).toContain("pass2");
    expect(JOB_STATES).toContain("encoding");
    expect(JOB_STATES).toContain("done");
    expect(JOB_STATES).toContain("error");
  });

  it("isVideoState is true for pass1, pass2, and shared probing/queued", () => {
    expect(isVideoState("pass1")).toBe(true);
    expect(isVideoState("pass2")).toBe(true);
    expect(isVideoState("probing")).toBe(true);
    expect(isVideoState("queued")).toBe(true);
    expect(isVideoState("encoding")).toBe(false);
  });

  it("isImageState is true for encoding and shared probing/queued", () => {
    expect(isImageState("encoding")).toBe(true);
    expect(isImageState("probing")).toBe(true);
    expect(isImageState("queued")).toBe(true);
    expect(isImageState("pass1")).toBe(false);
    expect(isImageState("pass2")).toBe(false);
  });

  it("isTerminalState is true for done and error only", () => {
    expect(isTerminalState("done")).toBe(true);
    expect(isTerminalState("error")).toBe(true);
    expect(isTerminalState("pass1")).toBe(false);
    expect(isTerminalState("queued")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/jobs/types.test.ts`
Expected: FAIL — module `./types.js` not found.

- [ ] **Step 3: Implement `src/jobs/types.ts`**

```typescript
import type { Preset, MediaType } from "../presets/index.js";

export type JobState =
  | "queued"
  | "probing"
  | "pass1"    // video only
  | "pass2"    // video only
  | "encoding" // image only
  | "done"
  | "error";

export const JOB_STATES: readonly JobState[] = [
  "queued",
  "probing",
  "pass1",
  "pass2",
  "encoding",
  "done",
  "error",
] as const;

export interface Job {
  id: string;
  sessionId: string;
  type: MediaType;
  originalName: string;
  inputPath: string;
  outputPath: string;
  preset: Preset;
  customTargetMB?: number;
  createdAt: number;
  state: JobState;
  progress: number;       // 0..100
  error?: string;
  inputSize?: number;
  outputSize?: number;
}

/**
 * Uniform event shape emitted by JobQueue.update().
 * All fields are present on every event so SSE consumers don't have to
 * discriminate at runtime. The SSE route layer decides which named event
 * ("progress" | "done" | "error") to emit based on `state`.
 *
 * `etaSeconds` and `message` are populated starting in chunk 4 (video-job).
 */
export interface JobEvent {
  jobId: string;
  state: JobState;
  progress: number;          // always 0..100; 100 on done, last value on error
  outputSize?: number;       // set on "done"
  downloadUrl?: string;      // set on "done"
  error?: string;            // set on "error"
  etaSeconds?: number;       // optional, set by video-job when available
  message?: string;          // optional human-readable note
}

export function isVideoState(s: JobState): boolean {
  return s === "queued" || s === "probing" || s === "pass1" || s === "pass2";
}

export function isImageState(s: JobState): boolean {
  return s === "queued" || s === "probing" || s === "encoding";
}

export function isTerminalState(s: JobState): boolean {
  return s === "done" || s === "error";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/jobs/types.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/types.ts src/jobs/types.test.ts
git commit -m "feat: job state types and predicates"
```

---

### Task 3.3: In-memory job queue with event emission

**Files:**
- Create: `src/jobs/queue.ts`
- Create: `src/jobs/queue.test.ts`

The queue is the orchestration layer between routes and handlers. It:
- Stores jobs by id in a `Map`.
- Appends new jobs to a FIFO waiting list.
- Emits events per job via an internal `EventEmitter` so SSE routes can subscribe.
- Enforces `queueMax` at enqueue time.
- Scopes lookups by `sessionId` so a session can only see its own jobs.

Actual worker dispatch is driven externally by `src/jobs/worker.ts` (next task).

- [ ] **Step 1: Write the failing test**

```typescript
// src/jobs/queue.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { JobQueue, QueueFullError } from "./queue.js";
import type { Job } from "./types.js";
import { getPreset } from "../presets/index.js";

function makeJob(id: string, sessionId: string = "sess1"): Job {
  return {
    id,
    sessionId,
    type: "video",
    originalName: `${id}.mp4`,
    inputPath: `/tmp/in/${id}.mp4`,
    outputPath: `/tmp/out/${id}.mp4`,
    preset: getPreset("manychat"),
    createdAt: Date.now(),
    state: "queued",
    progress: 0,
  };
}

describe("JobQueue", () => {
  let q: JobQueue;

  beforeEach(() => {
    q = new JobQueue({ queueMax: 3 });
  });

  it("enqueue stores the job and returns it", () => {
    const job = makeJob("a");
    q.enqueue(job);
    expect(q.get("a")?.id).toBe("a");
  });

  it("enqueue rejects when queue is full", () => {
    q.enqueue(makeJob("a"));
    q.enqueue(makeJob("b"));
    q.enqueue(makeJob("c"));
    expect(() => q.enqueue(makeJob("d"))).toThrow(QueueFullError);
  });

  it("completed jobs do not count toward queueMax", () => {
    q.enqueue(makeJob("a"));
    q.enqueue(makeJob("b"));
    q.enqueue(makeJob("c"));
    q.update("a", { state: "done", progress: 100 });
    // "a" is done so the live queue is at 2 → can enqueue one more
    q.enqueue(makeJob("d"));
    expect(q.get("d")?.id).toBe("d");
  });

  it("listBySession returns only jobs in that session", () => {
    q.enqueue(makeJob("a", "sess1"));
    q.enqueue(makeJob("b", "sess2"));
    q.enqueue(makeJob("c", "sess1"));
    const list = q.listBySession("sess1");
    expect(list.map((j) => j.id).sort()).toEqual(["a", "c"]);
  });

  it("update merges partial state and keeps id/sessionId stable", () => {
    q.enqueue(makeJob("a"));
    q.update("a", { state: "pass1", progress: 45 });
    const j = q.get("a")!;
    expect(j.state).toBe("pass1");
    expect(j.progress).toBe(45);
    expect(j.id).toBe("a");
  });

  it("update on unknown id is a no-op", () => {
    q.update("nope", { state: "done", progress: 100 });
    expect(q.get("nope")).toBeUndefined();
  });

  it("subscribe receives events for the given jobId", async () => {
    q.enqueue(makeJob("a"));
    const events: Array<{ state: string; progress: number }> = [];
    const unsubscribe = q.subscribe("a", (ev) => {
      events.push({ state: ev.state, progress: ev.progress });
    });
    q.update("a", { state: "pass1", progress: 10 });
    q.update("a", { state: "pass1", progress: 50 });
    q.update("a", { state: "done", progress: 100, outputSize: 1000 });
    unsubscribe();
    q.update("a", { state: "done", progress: 100 }); // should not be received
    expect(events).toEqual([
      { state: "pass1", progress: 10 },
      { state: "pass1", progress: 50 },
      { state: "done", progress: 100 },
    ]);
  });

  it("nextWaiting returns the oldest queued job and drops it from the waiting list", () => {
    q.enqueue(makeJob("a"));
    q.enqueue(makeJob("b"));
    expect(q.nextWaiting()?.id).toBe("a");
    expect(q.nextWaiting()?.id).toBe("b");
    expect(q.nextWaiting()).toBeUndefined();
  });

  it("remove unlinks a job by id", () => {
    q.enqueue(makeJob("a"));
    q.remove("a");
    expect(q.get("a")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/jobs/queue.test.ts`
Expected: FAIL — module `./queue.js` not found.

- [ ] **Step 3: Implement `src/jobs/queue.ts`**

```typescript
import { EventEmitter } from "node:events";
import type { Job, JobEvent } from "./types.js";
import { isTerminalState } from "./types.js";

export class QueueFullError extends Error {
  constructor(public readonly queueMax: number) {
    super(`queue is full (max ${queueMax})`);
    this.name = "QueueFullError";
  }
}

export interface JobQueueOptions {
  queueMax: number;
}

interface StoredJob {
  job: Job;
}

/**
 * In-memory job store and event bus.
 *
 * Responsibilities:
 *  - Track all jobs by id until they are removed or expire.
 *  - Maintain a FIFO of jobs waiting to be processed (state === "queued").
 *  - Emit events per jobId so SSE routes can subscribe.
 *  - Enforce queueMax over the count of *non-terminal* jobs.
 *
 * Does NOT:
 *  - Run handlers. The worker loop pulls nextWaiting() and invokes
 *    handlers itself, calling update() as progress happens.
 */
export class JobQueue {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly waiting: string[] = [];
  private readonly emitter = new EventEmitter();
  private readonly queueMax: number;

  constructor(opts: JobQueueOptions) {
    this.queueMax = opts.queueMax;
    // Prevent "max listeners exceeded" warnings during load tests.
    this.emitter.setMaxListeners(0);
  }

  enqueue(job: Job): void {
    const liveCount = this.liveJobCount();
    if (liveCount >= this.queueMax) {
      throw new QueueFullError(this.queueMax);
    }
    this.jobs.set(job.id, { job });
    this.waiting.push(job.id);
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId)?.job;
  }

  listBySession(sessionId: string): Job[] {
    const out: Job[] = [];
    for (const { job } of this.jobs.values()) {
      if (job.sessionId === sessionId) out.push(job);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Merge a partial patch into a job and emit a JobEvent. Callers cannot
   * change `id` or `sessionId` via this path — those are frozen at enqueue.
   */
  update(jobId: string, patch: Partial<Omit<Job, "id" | "sessionId">>): void {
    const stored = this.jobs.get(jobId);
    if (!stored) return;
    stored.job = { ...stored.job, ...patch };
    const job = stored.job;

    const event: JobEvent = {
      jobId,
      state: job.state,
      progress: job.progress,
    };
    if (job.state === "done") {
      event.outputSize = job.outputSize;
      event.downloadUrl = `/api/download/${jobId}`;
    }
    if (job.state === "error") {
      event.error = job.error;
    }
    this.emitter.emit(`job:${jobId}`, event);
  }

  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
    const key = `job:${jobId}`;
    this.emitter.on(key, listener);
    return () => {
      this.emitter.off(key, listener);
    };
  }

  nextWaiting(): Job | undefined {
    while (this.waiting.length) {
      const id = this.waiting.shift()!;
      const stored = this.jobs.get(id);
      if (stored && stored.job.state === "queued") {
        return stored.job;
      }
      // dropped jobs and already-promoted ones are skipped
    }
    return undefined;
  }

  remove(jobId: string): void {
    this.jobs.delete(jobId);
    const idx = this.waiting.indexOf(jobId);
    if (idx !== -1) this.waiting.splice(idx, 1);
  }

  /** Count of jobs that have not reached a terminal state. */
  liveJobCount(): number {
    let n = 0;
    for (const { job } of this.jobs.values()) {
      if (!isTerminalState(job.state)) n += 1;
    }
    return n;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/jobs/queue.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/queue.ts src/jobs/queue.test.ts
git commit -m "feat: in-memory JobQueue with FIFO, event bus, and session scoping"
```

---

### Task 3.4: Image job handler

**Files:**
- Create: `src/jobs/image-job.ts`
- Create: `src/jobs/image-job.test.ts`

Handler signature is `(input, output, maxBytes, onProgress) → Promise<{outputSize}>`. It does not touch the queue directly — the worker does that. This keeps the handler fully testable without mocking.

- [ ] **Step 1: Write the failing test**

```typescript
// src/jobs/image-job.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressImage, ImageJobError } from "./image-job.js";
import {
  makePng,
  makeNoisyPng,
  makeJpeg,
  makeInvalidFile,
} from "../../tests/fixtures/generate.js";

describe("compressImage", () => {
  let fixtureDir: string;
  let smallJpeg: string;
  let noisyPng: string;
  let pngWithAlpha: string;
  let invalid: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "zx-img-"));
    smallJpeg = join(fixtureDir, "small.jpg");
    noisyPng = join(fixtureDir, "noisy.png");
    pngWithAlpha = join(fixtureDir, "alpha.png");
    invalid = join(fixtureDir, "invalid.png");
    await makeJpeg(smallJpeg, { width: 200, height: 200 });
    // 800x800 random noise PNG → JPEG @ q95 ≈ 700KB, does NOT compress below
    // 40KB even at q50 full-res, forcing the downscale path.
    await makeNoisyPng(noisyPng, { width: 800, height: 800 });
    await makePng(pngWithAlpha, { width: 300, height: 300, withAlpha: true });
    await makeInvalidFile(invalid, "not a png");
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("produces output under the byte limit at quality 95 for a small image", async () => {
    const out = join(fixtureDir, "small-out.jpg");
    const limit = 5 * 1024 * 1024;
    const result = await compressImage(smallJpeg, out, limit, () => {});
    const { size } = await stat(out);
    expect(size).toBeLessThanOrEqual(limit);
    expect(result.outputSize).toBe(size);
    expect(result.quality).toBe(95);
    expect(result.scale).toBe(1);
  });

  it("flattens PNG alpha onto white background", async () => {
    const out = join(fixtureDir, "alpha-out.jpg");
    await compressImage(pngWithAlpha, out, 5 * 1024 * 1024, () => {});
    // Output must exist and be a valid JPEG (no alpha channel).
    const sharp = (await import("sharp")).default;
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.hasAlpha).toBe(false);
  });

  it("emits progress updates that end at 100 and never exceed bounds", async () => {
    const out = join(fixtureDir, "noisy-progress.jpg");
    const events: number[] = [];
    await compressImage(noisyPng, out, 40_000, (p) => events.push(p));
    // Must see at least one intermediate update plus a final 100.
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]).toBe(100);
    for (const p of events) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("downscales when quality loop cannot meet the target at full resolution", async () => {
    const out = join(fixtureDir, "noisy-down.jpg");
    // Noisy 800x800 won't compress under 15KB at full resolution even at q50,
    // so the loop must descend into the scale dimension.
    const tinyLimit = 15_000;
    const result = await compressImage(noisyPng, out, tinyLimit, () => {});
    expect(result.scale).toBeLessThan(1);
    expect(result.outputSize).toBeLessThanOrEqual(tinyLimit);
  });

  it("throws ImageJobError when no combination of quality and scale fits", async () => {
    const out = join(fixtureDir, "impossible.jpg");
    // 300 bytes is below even JPEG's minimum header size for any usable image.
    await expect(compressImage(noisyPng, out, 300, () => {})).rejects.toThrow(ImageJobError);
  });

  it("throws ImageJobError when the input is not a readable image", async () => {
    const out = join(fixtureDir, "bad-out.jpg");
    await expect(compressImage(invalid, out, 5 * 1024 * 1024, () => {})).rejects.toThrow(ImageJobError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/jobs/image-job.test.ts`
Expected: FAIL — module `./image-job.js` not found.

- [ ] **Step 3: Implement `src/jobs/image-job.ts`**

```typescript
import sharp from "sharp";
import { stat } from "node:fs/promises";

export class ImageJobError extends Error {
  constructor(
    public readonly code: "SHARP_FAILED" | "IMAGE_TOO_LARGE_AT_Q50" | "CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "ImageJobError";
  }
}

export interface CompressImageResult {
  outputSize: number;
  quality: number;
  scale: number;
}

export interface CompressImageOptions {
  signal?: AbortSignal;
}

const SCALES: readonly number[] = [1.0, 0.85, 0.7, 0.55, 0.4, 0.25];
const QUALITIES: readonly number[] = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50];

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ImageJobError("CANCELLED", "image job cancelled");
  }
}

/**
 * Compress an image to fit under `maxBytes`, iterating over quality then
 * scale. Honors `opts.signal` between attempts so callers can cancel a
 * long-running compression (worker timeout, user cancel).
 */
export async function compressImage(
  inputPath: string,
  outputPath: string,
  maxBytes: number,
  onProgress: (percent: number) => void,
  opts: CompressImageOptions = {},
): Promise<CompressImageResult> {
  throwIfAborted(opts.signal);

  let width: number;
  let height: number;
  try {
    const meta = await sharp(inputPath).metadata();
    if (!meta.width || !meta.height) {
      throw new Error("missing dimensions");
    }
    width = meta.width;
    height = meta.height;
  } catch (err) {
    throw new ImageJobError("SHARP_FAILED", `cannot read image: ${(err as Error).message}`);
  }

  const total = SCALES.length * QUALITIES.length;
  let attempt = 0;

  for (const scale of SCALES) {
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    for (const quality of QUALITIES) {
      throwIfAborted(opts.signal);
      attempt += 1;
      onProgress(Math.floor((attempt / total) * 100));

      try {
        await sharp(inputPath)
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .resize(targetW, targetH, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality, mozjpeg: true })
          .toFile(outputPath);
      } catch (err) {
        throw new ImageJobError("SHARP_FAILED", `encode failed: ${(err as Error).message}`);
      }

      const { size } = await stat(outputPath);
      if (size <= maxBytes) {
        onProgress(100);
        return { outputSize: size, quality, scale };
      }
    }
  }

  throw new ImageJobError(
    "IMAGE_TOO_LARGE_AT_Q50",
    `cannot reduce ${inputPath} to ${maxBytes} bytes even at min quality and scale`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/jobs/image-job.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/image-job.ts src/jobs/image-job.test.ts
git commit -m "feat: compressImage with quality loop, downscale fallback, alpha flatten"
```

---

### Task 3.5: Full chunk 3 verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: chunks 1, 2, and 3 all pass. Image-job tests take ~2-4 seconds due to real sharp encoding.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Verify commit count**

Run: `git log --oneline | wc -l`
Expected: 7 (chunk 1) + 6 (chunk 2) + 4 (chunk 3: fixtures, types, queue, image-job) = 17 new commits on top of the brainstorming commits.

---

**End of Chunk 3.** Next: Chunk 4 (video-job + worker).

---

## Chunk 4: Video job handler and worker dispatcher

This chunk finishes the media-processing engine. After this chunk, calling `startWorker()` + `queue.enqueue(job)` produces a finished output file on disk with live progress events — the full offline pipeline, ready for HTTP routes in chunk 5.

**Chunk 4 produces:**
- Video job handler: 2-pass libx264 with live progress parsing, cancellation via `AbortSignal`, error mapping, and pass-log cleanup.
- Worker dispatcher: concurrent loops, per-job AbortController, `WORKER_TIMEOUT_MS` enforcement, error mapping, graceful stop.

**Platform note:** the happy-path implementation uses `-f null` instead of saving pass-1 to `/dev/null`. This keeps the code cross-platform (works on Windows/macOS/Linux). Production target is Ubuntu but CI or dev on other OSes should still pass.

### Task 4.1: Video job handler

**Files:**
- Create: `src/jobs/video-job.ts`
- Create: `src/jobs/video-job.test.ts`

This task implements the final form of the video job handler in a single step: happy path, probe failure, cancellation, and pass-log cleanup. Tests cover all three paths before implementation.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/jobs/video-job.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVideoJob, VideoJobError } from "./video-job.js";
import { makeTinyVideo, makeInvalidFile } from "../../tests/fixtures/generate.js";

describe("runVideoJob — happy path", () => {
  let dir: string;
  let input: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zx-vid-"));
    input = join(dir, "in.mp4");
    // 3 seconds at 320x240 — small enough to encode in <10s on dev machine.
    await makeTinyVideo(input, { durationSec: 3, width: 320, height: 240 });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("produces an output under the target size", async () => {
    const output = join(dir, "out.mp4");
    const events: Array<{ state: string; progress: number }> = [];

    const result = await runVideoJob({
      inputPath: input,
      outputPath: output,
      targetMB: 1,
      onProgress: (state, progress) => events.push({ state, progress }),
    });

    const { size } = await stat(output);
    expect(size).toBeLessThanOrEqual(1024 * 1024);
    expect(result.outputSize).toBe(size);
    expect(result.videoBitrateKbps).toBeGreaterThan(0);

    const states = events.map((e) => e.state);
    expect(states).toContain("pass1");
    expect(states).toContain("pass2");
  }, 30_000);

  it("cleans up ffmpeg 2-pass log files after success", async () => {
    const output = join(dir, "out2.mp4");
    await runVideoJob({
      inputPath: input,
      outputPath: output,
      targetMB: 1,
      onProgress: () => {},
    });
    const remaining = (await readdir(dir)).filter(
      (f) => f.includes("pass-") && (f.endsWith(".log") || f.endsWith(".log.mbtree")),
    );
    expect(remaining).toEqual([]);
  }, 30_000);
});

describe("runVideoJob — errors and cancellation", () => {
  let dir: string;
  let longVideo: string;
  let invalid: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zx-vid-err-"));
    longVideo = join(dir, "long.mp4");
    invalid = join(dir, "invalid.mp4");
    // 20s video — long enough that we can abort mid-encode reliably.
    await makeTinyVideo(longVideo, { durationSec: 20, width: 640, height: 360 });
    await makeInvalidFile(invalid, "not a real mp4");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects with VideoJobError PROBE_FAILED on invalid input", async () => {
    await expect(
      runVideoJob({
        inputPath: invalid,
        outputPath: join(dir, "out-invalid.mp4"),
        targetMB: 25,
        onProgress: () => {},
      }),
    ).rejects.toMatchObject({ name: "VideoJobError", code: "PROBE_FAILED" });
  });

  it("rejects with VideoJobError CANCELLED when AbortSignal fires mid-encode", async () => {
    const ac = new AbortController();
    // Abort 500ms in, while pass-1 is still running.
    setTimeout(() => ac.abort(), 500);

    await expect(
      runVideoJob({
        inputPath: longVideo,
        outputPath: join(dir, "out-cancelled.mp4"),
        targetMB: 25,
        signal: ac.signal,
        onProgress: () => {},
      }),
    ).rejects.toMatchObject({ name: "VideoJobError", code: "CANCELLED" });
  }, 30_000);

  it("cleans up pass log files even after cancellation", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 500);
    try {
      await runVideoJob({
        inputPath: longVideo,
        outputPath: join(dir, "out-cancel-cleanup.mp4"),
        targetMB: 25,
        signal: ac.signal,
        onProgress: () => {},
      });
    } catch {
      // expected
    }
    const remaining = (await readdir(dir)).filter(
      (f) => f.includes("pass-out-cancel-cleanup") && (f.endsWith(".log") || f.endsWith(".log.mbtree")),
    );
    expect(remaining).toEqual([]);
  }, 30_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/jobs/video-job.test.ts`
Expected: FAIL — module `./video-job.js` not found.

- [ ] **Step 3: Implement `src/jobs/video-job.ts`**

Create the full file. Note: `-f null` + `-y /dev/null` is replaced with the cross-platform `.output("-").format("null")` pattern so pass-1 writes its encoded frames to a discarded null muxer instead of a platform-specific path.

```typescript
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
      "-c:v libx264",
      "-preset slow",
      `-b:v ${ctx.videoBitrateKbps}k`,
      `-pass ${kind === "pass1" ? 1 : 2}`,
      `-passlogfile ${ctx.passLogPrefix}`,
      "-pix_fmt yuv420p",
      "-profile:v high",
      "-level 4.1",
      `-g ${Math.round(ctx.fps * 2)}`,
    ];

    const pass1Opts = [...baseOpts, "-an"];
    const pass2Opts = [
      ...baseOpts,
      "-c:a aac",
      `-b:a ${ctx.audioKbps}k`,
      "-ac 2",
      "-movflags +faststart",
    ];

    const cmd = ffmpeg(ctx.inputPath)
      .outputOptions(kind === "pass1" ? pass1Opts : pass2Opts)
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
      // Cross-platform null sink: write to the "null" muxer on stdout-less path.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/jobs/video-job.test.ts`
Expected: 5 passed. Total ~40 seconds (real 2-pass encoding + cancellation timing).

- [ ] **Step 5: Commit**

```bash
git add src/jobs/video-job.ts src/jobs/video-job.test.ts
git commit -m "feat: runVideoJob with libx264 2-pass, AbortSignal cancel, and pass-log cleanup"
```

---

### Task 4.2: Worker dispatcher

**Files:**
- Create: `src/jobs/worker.ts`
- Create: `src/jobs/worker.test.ts`

The worker ties the queue to the handlers. It runs continuous loops (one per concurrency slot): pull `nextWaiting()` → pick a handler → run it → update job state → repeat. Per-job `AbortController` enforces `WORKER_TIMEOUT_MS` and also handles explicit cancel from `stop()` or a later `DELETE /api/jobs/:id`. Both image and video handlers receive the abort signal.

- [ ] **Step 1: Write the failing test**

```typescript
// src/jobs/worker.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobQueue } from "./queue.js";
import { startWorker } from "./worker.js";
import { getPreset } from "../presets/index.js";
import { makeJpeg, makeTinyVideo } from "../../tests/fixtures/generate.js";
import type { Job } from "./types.js";

function makeImageJob(id: string, input: string, output: string): Job {
  return {
    id,
    sessionId: "sess1",
    type: "image",
    originalName: "in.jpg",
    inputPath: input,
    outputPath: output,
    preset: getPreset("manychat"),
    createdAt: Date.now(),
    state: "queued",
    progress: 0,
  };
}

function makeVideoJob(id: string, input: string, output: string): Job {
  return {
    id,
    sessionId: "sess1",
    type: "video",
    originalName: "in.mp4",
    inputPath: input,
    outputPath: output,
    preset: getPreset("manychat"),
    createdAt: Date.now(),
    state: "queued",
    progress: 0,
  };
}

describe("startWorker", () => {
  let dir: string;
  let jpg: string;
  let mp4: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zx-worker-"));
    jpg = join(dir, "tiny.jpg");
    mp4 = join(dir, "tiny.mp4");
    await makeJpeg(jpg, { width: 200, height: 200 });
    await makeTinyVideo(mp4, { durationSec: 2, width: 320, height: 240 });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("processes an image job to done", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const worker = startWorker({ queue: q, concurrency: 1, timeoutMs: 30_000 });
    const out = join(dir, "img-out.jpg");
    q.enqueue(makeImageJob("j1", jpg, out));

    await waitForState(q, "j1", "done", 15_000);
    const job = q.get("j1")!;
    expect(job.state).toBe("done");
    expect(job.outputSize).toBeGreaterThan(0);
    await worker.stop();
  });

  it("processes a video job to done", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const worker = startWorker({ queue: q, concurrency: 1, timeoutMs: 60_000 });
    const out = join(dir, "vid-out.mp4");
    q.enqueue(makeVideoJob("j2", mp4, out));

    await waitForState(q, "j2", "done", 30_000);
    const job = q.get("j2")!;
    expect(job.state).toBe("done");
    expect(job.outputSize).toBeGreaterThan(0);
    await worker.stop();
  }, 45_000);

  it("marks a job as error when the handler throws", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const worker = startWorker({ queue: q, concurrency: 1, timeoutMs: 10_000 });
    const out = join(dir, "bad-out.jpg");
    q.enqueue(makeImageJob("j3", "/nope/does-not-exist.jpg", out));

    await waitForState(q, "j3", "error", 15_000);
    const job = q.get("j3")!;
    expect(job.state).toBe("error");
    expect(job.error).toBeDefined();
    await worker.stop();
  });

  it("times out a video job that exceeds timeoutMs", async () => {
    // 30s of video encoded 2-pass with preset slow is well over 2s on any
    // machine; timing out at 2s should hit CANCELLED before completion.
    const longVid = join(dir, "long-for-timeout.mp4");
    await makeTinyVideo(longVid, { durationSec: 30, width: 640, height: 360 });

    const q = new JobQueue({ queueMax: 10 });
    const worker = startWorker({ queue: q, concurrency: 1, timeoutMs: 2_000 });
    q.enqueue(makeVideoJob("j4", longVid, join(dir, "timeout-out.mp4")));

    await waitForState(q, "j4", "error", 30_000);
    const job = q.get("j4")!;
    expect(job.state).toBe("error");
    expect(job.error).toMatch(/CANCELLED/);
    await worker.stop();
  }, 60_000);

  it("stop() cancels an in-flight job and resolves", async () => {
    const longVid = join(dir, "long-for-stop.mp4");
    await makeTinyVideo(longVid, { durationSec: 30, width: 640, height: 360 });

    const q = new JobQueue({ queueMax: 10 });
    const worker = startWorker({ queue: q, concurrency: 1, timeoutMs: 120_000 });
    q.enqueue(makeVideoJob("j5", longVid, join(dir, "stop-out.mp4")));

    // Let the worker start processing, then stop.
    await new Promise((r) => setTimeout(r, 800));
    await worker.stop();

    const job = q.get("j5")!;
    expect(job.state).toBe("error");
    expect(job.error).toMatch(/CANCELLED/);
  }, 60_000);

  it("cancel(jobId) aborts a specific in-flight job", async () => {
    const longVid = join(dir, "long-for-cancel.mp4");
    await makeTinyVideo(longVid, { durationSec: 30, width: 640, height: 360 });

    const q = new JobQueue({ queueMax: 10 });
    const worker = startWorker({ queue: q, concurrency: 1, timeoutMs: 120_000 });
    q.enqueue(makeVideoJob("j6", longVid, join(dir, "cancel-out.mp4")));

    // Let pass1 start, then cancel just this job (not stop the worker).
    await new Promise((r) => setTimeout(r, 800));
    expect(worker.cancel("j6")).toBe(true);
    // Cancelling a job that is not running returns false.
    expect(worker.cancel("nope")).toBe(false);

    await waitForState(q, "j6", "error", 30_000);
    const job = q.get("j6")!;
    expect(job.state).toBe("error");
    expect(job.error).toMatch(/CANCELLED/);
    await worker.stop();
  }, 60_000);
});

async function waitForState(
  q: JobQueue,
  jobId: string,
  target: "done" | "error",
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = q.get(jobId);
    if (j && (j.state === target || j.state === "error")) {
      if (j.state === target) return;
      if (target !== "error") throw new Error(`job ${jobId} errored: ${j.error}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for ${jobId} to reach ${target}`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/jobs/worker.test.ts`
Expected: FAIL — module `./worker.js` not found.

- [ ] **Step 3: Implement `src/jobs/worker.ts`**

```typescript
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
  /** Cancel an in-flight job by id. Returns true if a running job was aborted. */
  cancel(jobId: string): boolean;
  /** Stop all loops; aborts every running job and resolves when loops exit. */
  stop(): Promise<void>;
}

export function startWorker(opts: WorkerOptions): WorkerHandle {
  let running = true;
  // Per-job AbortControllers so DELETE /api/jobs/:id can cancel a specific job.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/jobs/worker.test.ts`
Expected: 6 passed (image happy path, video happy path, handler error, timeout, graceful stop, per-job cancel). Total ~90 seconds because video tests run real ffmpeg and the timeout/stop/cancel tests each encode a 30 s fixture before being aborted.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/worker.ts src/jobs/worker.test.ts
git commit -m "feat: worker dispatcher with concurrency, timeout, and abort wiring"
```

---

### Task 4.3: Full chunk 4 verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: chunks 1-4 all pass. Total test time ~120 seconds due to real ffmpeg 2-pass encoding and cancellation tests.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Verify commit count**

Run: `git log --oneline | wc -l`
Expected: 7 (chunk 1) + 6 (chunk 2) + 4 (chunk 3) + 2 (chunk 4: video-job, worker) = 19 commits on top of the brainstorming commits.

---

**End of Chunk 4.** Next: Chunk 5 (HTTP routes — upload, progress SSE, download, jobs list/delete, presets, health).

---

## Chunk 5: Simple routes and upload

This chunk adds the read-only routes and the upload route from spec §8. Tests use `app.inject()` — no real server yet. Progress SSE, download, and jobs list/delete come in chunk 6.

**Chunk 5 produces:**
- `routes/presets.ts` — list presets
- `routes/health.ts` — `/api/health`
- `routes/upload.ts` — multipart upload, magic-byte validation, enqueue, queue-full handling

All authenticated routes use the `requireLogin` preHandler from chunk 2.

### Task 5.1: Presets and health routes

**Files:**
- Create: `src/routes/presets.ts`
- Create: `src/routes/presets.test.ts`
- Create: `src/routes/health.ts`
- Create: `src/routes/health.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/routes/presets.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSession } from "../auth/session.js";
import { registerAuthRoutes } from "../auth/login-route.js";
import { registerPresetRoutes } from "./presets.js";
import { hashPassword } from "../auth/password.js";

const SECRET = "a".repeat(64);

describe("GET /api/presets", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    const hash = await hashPassword("pw");
    app = Fastify();
    await registerSession(app, SECRET);
    await registerAuthRoutes(app, { passwordHash: hash, loginRateLimit: 100, loginRateWindowMs: 60_000 });
    await registerPresetRoutes(app);
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
    cookie = login.headers["set-cookie"] as string;
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 401 when not logged in", async () => {
    const res = await app.inject({ method: "GET", url: "/api/presets" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the manychat preset when logged in", async () => {
    const res = await app.inject({ method: "GET", url: "/api/presets", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { presets: Array<{ id: string; videoMaxMB: number; imageMaxMB: number; default?: boolean }> };
    expect(body.presets).toHaveLength(1);
    expect(body.presets[0]).toMatchObject({ id: "manychat", videoMaxMB: 25, imageMaxMB: 5, default: true });
  });
});
```

```typescript
// src/routes/health.test.ts
import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoute } from "./health.js";

describe("GET /api/health", () => {
  let app: FastifyInstance;
  afterEach(async () => { await app.close(); });

  it("returns ok, version, uptime, and queueDepth", async () => {
    app = Fastify();
    await registerHealthRoute(app, { version: "0.1.0", queueDepth: () => 3 });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe("0.1.0");
    expect(typeof body.uptime).toBe("number");
    expect(body.queueDepth).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/routes/presets.test.ts src/routes/health.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the routes**

```typescript
// src/routes/presets.ts
import type { FastifyInstance } from "fastify";
import { requireLogin } from "../auth/require-login.js";
import { PRESETS } from "../presets/index.js";

export async function registerPresetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/presets", { preHandler: requireLogin }, async () => {
    return { presets: Object.values(PRESETS) };
  });
}
```

```typescript
// src/routes/health.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/routes/presets.test.ts src/routes/health.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/presets.ts src/routes/presets.test.ts src/routes/health.ts src/routes/health.test.ts
git commit -m "feat: GET /api/presets and /api/health routes"
```

---

### Task 5.2: Upload route

**Files:**
- Create: `src/routes/upload.ts`
- Create: `src/routes/upload.test.ts`

The upload route is the most complex in this chunk. It must:
1. Require login.
2. Accept `multipart/form-data` with `file`, `preset`, and optional `customTargetMB`.
3. Enforce the 500 MB size cap via `@fastify/multipart` limits.
4. Stream the file to `uploads/<jobId>/<originalName>` (no buffering).
5. Detect media type from magic bytes (not the client-supplied `type`).
6. Probe the file (videos only).
7. Compute target bitrate for videos.
8. Build a `Job` record and enqueue it.
9. Return 503 queue_full when `QueueFullError` fires.
10. Clean up the uploaded file on any error path.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/routes/upload.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FormData from "form-data";
import { registerSession } from "../auth/session.js";
import { registerAuthRoutes } from "../auth/login-route.js";
import { registerUploadRoute } from "./upload.js";
import { hashPassword } from "../auth/password.js";
import { JobQueue } from "../jobs/queue.js";
import { makeTinyVideo, makeJpeg, makeInvalidFile } from "../../tests/fixtures/generate.js";

const SECRET = "a".repeat(64);

async function buildApp(queue: JobQueue, uploadDir: string) {
  const hash = await hashPassword("pw");
  const app = Fastify();
  await registerSession(app, SECRET);
  await app.register(fastifyMultipart, { limits: { fileSize: 500 * 1024 * 1024 } });
  await registerAuthRoutes(app, { passwordHash: hash, loginRateLimit: 100, loginRateWindowMs: 60_000 });
  await registerUploadRoute(app, { queue, uploadDir, maxUploadMB: 500 });
  const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
  return { app, cookie: login.headers["set-cookie"] as string };
}

describe("POST /api/upload", () => {
  let dir: string;
  let videoPath: string;
  let jpegPath: string;
  let invalidPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zx-upload-"));
    videoPath = join(dir, "in.mp4");
    jpegPath = join(dir, "in.jpg");
    invalidPath = join(dir, "in.exe");
    await makeTinyVideo(videoPath, { durationSec: 2, width: 320, height: 240 });
    await makeJpeg(jpegPath, { width: 200, height: 200 });
    await makeInvalidFile(invalidPath, "MZ\x90\x00");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function postMultipart(app: FastifyInstance, cookie: string, filePath: string, fields: Record<string, string>) {
    const form = new FormData();
    form.append("file", await readFile(filePath), { filename: filePath.split("/").pop() });
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return app.inject({
      method: "POST",
      url: "/api/upload",
      payload: form,
      headers: { ...form.getHeaders(), cookie },
    });
  }

  it("returns 401 when not logged in", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const uploadDir = join(dir, "uploads");
    const { app } = await buildApp(q, uploadDir);
    const res = await app.inject({ method: "POST", url: "/api/upload" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("accepts a video and returns jobId + probe + targetVideoBitrateKbps", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const uploadDir = join(dir, "uploads");
    const { app, cookie } = await buildApp(q, uploadDir);
    const res = await postMultipart(app, cookie, videoPath, { preset: "manychat" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobId).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(body.type).toBe("video");
    expect(body.originalName).toBe("in.mp4");
    expect(body.probe.durationSec).toBeGreaterThan(1.5);
    expect(body.probe.width).toBe(320);
    expect(body.targetVideoBitrateKbps).toBeGreaterThan(0);
    expect(q.get(body.jobId)?.state).toBe("queued");
    await app.close();
  });

  it("accepts an image and returns type=image without probe bitrate", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const uploadDir = join(dir, "uploads");
    const { app, cookie } = await buildApp(q, uploadDir);
    const res = await postMultipart(app, cookie, jpegPath, { preset: "manychat" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe("image");
    expect(body.targetVideoBitrateKbps).toBeUndefined();
    expect(q.get(body.jobId)?.type).toBe("image");
    await app.close();
  });

  it("rejects unknown file type with 415", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const uploadDir = join(dir, "uploads");
    const { app, cookie } = await buildApp(q, uploadDir);
    const res = await postMultipart(app, cookie, invalidPath, { preset: "manychat" });
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe("unsupported_media_type");
    await app.close();
  });

  it("rejects unknown preset with 400", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const uploadDir = join(dir, "uploads");
    const { app, cookie } = await buildApp(q, uploadDir);
    const res = await postMultipart(app, cookie, videoPath, { preset: "nope" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 503 queue_full with body shape when queue is at capacity", async () => {
    const q = new JobQueue({ queueMax: 1 });
    // Pre-fill queue
    const pre = {
      id: "pre",
      sessionId: "someone",
      type: "video" as const,
      originalName: "pre.mp4",
      inputPath: "/tmp/pre.mp4",
      outputPath: "/tmp/pre-out.mp4",
      preset: { id: "manychat", name: "ManyChat", videoMaxMB: 25, imageMaxMB: 5 },
      createdAt: Date.now(),
      state: "queued" as const,
      progress: 0,
    };
    q.enqueue(pre);

    const uploadDir = join(dir, "uploads");
    const { app, cookie } = await buildApp(q, uploadDir);
    const res = await postMultipart(app, cookie, videoPath, { preset: "manychat" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error).toBe("queue_full");
    expect(body.queueDepth).toBe(1);
    expect(body.queueMax).toBe(1);
    await app.close();
  });
});
```

- [ ] **Step 2: Install `form-data` dev dep**

Run: `npm install --save-dev form-data`
Expected: adds `form-data` under devDependencies.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- src/routes/upload.test.ts`
Expected: FAIL — module `./upload.js` not found.

- [ ] **Step 4: Implement `src/routes/upload.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { pipeline } from "node:stream/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { stat, rm } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
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
  outputDir?: string; // defaults to uploadDir's sibling "outputs" when omitted
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
          jobId = newJobId();
          originalName = part.filename;
          await ensureJobUploadDir(opts.uploadDir, jobId);
          savedPath = uploadPathFor(opts.uploadDir, jobId, originalName);
          await pipeline(part.file, createWriteStream(savedPath));
          if (part.file.truncated) {
            await removeJobUploadDir(opts.uploadDir, jobId);
            return reply.code(413).send({ error: "file_too_large" });
          }
        }
      }

      if (!jobId || !savedPath || !originalName) {
        return reply.code(400).send({ error: "file_missing" });
      }

      const preset = getPreset(presetId ?? "manychat");

      // Detect media type from magic bytes, not from client hint.
      const ft = await fileTypeFromFile(savedPath);
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
        // Rough heuristic: preset slow = ~1.5× realtime on this VPS for 1080p.
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/routes/upload.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/routes/upload.ts src/routes/upload.test.ts package.json package-lock.json
git commit -m "feat: POST /api/upload with multipart, magic-byte validation, and enqueue"
```

---

### Task 5.3: Full chunk 5 verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: chunks 1-5 all pass. Total ~2 minutes.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Verify commit count**

Run: `git log --oneline | wc -l`
Expected: 19 (chunks 1-4) + 2 (chunk 5: presets+health, upload) = 21 commits on top of the brainstorming commits.

---

**End of Chunk 5.** Next: Chunk 6 (progress SSE, download, jobs list/delete).

---

## Chunk 6: SSE progress, download, and jobs routes

This chunk adds the remaining HTTP routes from spec §8: the Server-Sent Events progress stream, the download endpoint, and the jobs list/delete endpoints. Together with chunk 5 this finishes every route the spec §8 API contract defines.

**Chunk 6 produces:**
- `src/routes/test-seam.ts` — shared helper that registers `POST /__test/whoami` once, NODE_ENV-gated.
- `routes/progress.ts` — SSE stream with 15 s heartbeat, uses `reply.hijack()` for raw socket takeover.
- `routes/download.ts` — stream output with RFC 5987 UTF-8 filename header.
- `routes/jobs.ts` — list jobs in session; DELETE that calls `WorkerHandle.cancel()` for in-flight jobs (wiring introduced in chunk 4).

SSE is tested via a real listening Fastify instance because `fastify.inject` does not stream.

### Task 6.1: Test seam helper

**Files:**
- Create: `src/routes/test-seam.ts`

This tiny helper factors the `/__test/whoami` route out of the individual route files so the NODE_ENV guard lives in one place and route files stay focused on production concerns.

- [ ] **Step 1: Implement**

```typescript
// src/routes/test-seam.ts
import type { FastifyInstance } from "fastify";
import { requireLogin } from "../auth/require-login.js";

/**
 * Registers `POST /__test/whoami` (returns the current session's userId)
 * only when NODE_ENV === "test". Safe to call multiple times — guards
 * against re-registration.
 */
export function registerTestSeam(app: FastifyInstance): void {
  if (process.env.NODE_ENV !== "test") return;
  if (app.hasRoute({ method: "POST", url: "/__test/whoami" })) return;
  app.post("/__test/whoami", { preHandler: requireLogin }, async (req) => ({
    userId: req.session.get("userId"),
  }));
}
```

- [ ] **Step 2: Commit (no dedicated test — exercised via downstream route tests)**

```bash
git add src/routes/test-seam.ts
git commit -m "feat: shared NODE_ENV-gated test seam for routes"
```

---

### Task 6.2: Progress SSE route

**Files:**
- Create: `src/routes/progress.ts`
- Create: `src/routes/progress.test.ts`

SSE in Fastify: call `reply.hijack()` so Fastify stops managing the response, then write `event:`/`data:` lines directly to `reply.raw`. Heartbeat keeps the connection alive across proxies. The test opens a real listening Fastify instance with `app.listen({ port: 0 })` and uses `node:http` to read the first chunk — `fastify.inject` does not stream.

- [ ] **Step 1: Write the failing test**

```typescript
// src/routes/progress.test.ts
import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import { registerSession } from "../auth/session.js";
import { registerAuthRoutes } from "../auth/login-route.js";
import { registerProgressRoute } from "./progress.js";
import { hashPassword } from "../auth/password.js";
import { JobQueue } from "../jobs/queue.js";
import { getPreset } from "../presets/index.js";
import type { Job } from "../jobs/types.js";

const SECRET = "a".repeat(64);

function makeJob(id: string, sessionId: string): Job {
  return {
    id,
    sessionId,
    type: "video",
    originalName: "v.mp4",
    inputPath: "/tmp/in",
    outputPath: "/tmp/out",
    preset: getPreset("manychat"),
    createdAt: Date.now(),
    state: "queued",
    progress: 0,
  };
}

async function buildApp(queue: JobQueue) {
  const hash = await hashPassword("pw");
  const app = Fastify();
  await registerSession(app, SECRET);
  await registerAuthRoutes(app, { passwordHash: hash, loginRateLimit: 100, loginRateWindowMs: 60_000 });
  await registerProgressRoute(app, { queue });
  const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
  const cookie = login.headers["set-cookie"] as string;
  const who = await app.inject({ method: "POST", url: "/__test/whoami", headers: { cookie } });
  return { app, cookie, userId: who.json().userId as string };
}

async function readFirstSSEChunk(url: string, cookie: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { cookie } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`status ${res.statusCode}`));
        return;
      }
      let buf = "";
      res.on("data", (c: Buffer) => {
        buf += c.toString();
        if (buf.includes("\n\n")) {
          req.destroy();
          resolve(buf);
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    setTimeout(() => {
      req.destroy();
      reject(new Error("timeout waiting for first SSE chunk"));
    }, timeoutMs);
  });
}

describe("GET /api/progress/:jobId", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 401 without a session", async () => {
    const q = new JobQueue({ queueMax: 10 });
    ({ app } = await buildApp(q));
    const res = await app.inject({ method: "GET", url: "/api/progress/abc" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for an unknown jobId", async () => {
    const q = new JobQueue({ queueMax: 10 });
    let cookie: string;
    ({ app, cookie } = await buildApp(q));
    const res = await app.inject({ method: "GET", url: "/api/progress/nope", headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when jobId belongs to another session", async () => {
    const q = new JobQueue({ queueMax: 10 });
    q.enqueue(makeJob("foreign", "not-my-session"));
    let cookie: string;
    ({ app, cookie } = await buildApp(q));
    const res = await app.inject({ method: "GET", url: "/api/progress/foreign", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("emits an initial snapshot event immediately on subscribe", async () => {
    const q = new JobQueue({ queueMax: 10 });
    let cookie: string;
    let userId: string;
    ({ app, cookie, userId } = await buildApp(q));
    q.enqueue(makeJob("mine", userId));
    q.update("mine", { state: "pass1", progress: 17 });

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const raw = await readFirstSSEChunk(`${address}/api/progress/mine`, cookie);
    expect(raw).toMatch(/event:\s*progress/);
    expect(raw).toMatch(/"state":"pass1"/);
    expect(raw).toMatch(/"progress":17/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/routes/progress.test.ts`
Expected: FAIL — module `./progress.js` not found.

- [ ] **Step 3: Implement `src/routes/progress.ts`**

```typescript
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  // Use "failed" (not "error") because an EventSource listener attached to
  // "error" also fires on transport disconnect — the collision makes it
  // impossible for the client to distinguish server-emitted job failures
  // from the browser's own reconnect-triggering disconnects.
  if (state === "error") return "failed";
  return "progress";
}

export async function registerProgressRoute(
  app: FastifyInstance,
  opts: ProgressRouteOptions,
): Promise<void> {
  registerTestSeam(app);
  const heartbeatMs = opts.heartbeatMs ?? 15_000;

  app.get(
    "/api/progress/:jobId",
    { preHandler: requireLogin },
    async (
      req: FastifyRequest<{ Params: { jobId: string } }>,
      reply: FastifyReply,
    ) => {
      const sessionId = req.session.get("userId")!;
      const { jobId } = req.params;
      const job = opts.queue.get(jobId);
      if (!job) return reply.code(404).send({ error: "job_not_found" });
      if (job.sessionId !== sessionId) {
        return reply.code(403).send({ error: "forbidden" });
      }

      // Take over the raw response — Fastify will not touch reply after hijack.
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

      // Declare heartbeat BEFORE subscribe so the terminal-state branch can
      // clear it without hitting a temporal-dead-zone ReferenceError.
      const heartbeat = setInterval(() => {
        reply.raw.write(`: ping\n\n`);
      }, heartbeatMs);

      // Initial snapshot so the client sees current state immediately.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/routes/progress.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/progress.ts src/routes/progress.test.ts
git commit -m "feat: GET /api/progress/:jobId SSE stream with hijack + heartbeat"
```

---

### Task 6.3: Download route

**Files:**
- Create: `src/routes/download.ts`
- Create: `src/routes/download.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/routes/download.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSession } from "../auth/session.js";
import { registerAuthRoutes } from "../auth/login-route.js";
import { registerDownloadRoute } from "./download.js";
import { hashPassword } from "../auth/password.js";
import { JobQueue } from "../jobs/queue.js";
import { getPreset } from "../presets/index.js";
import type { Job } from "../jobs/types.js";

const SECRET = "a".repeat(64);

async function buildApp(queue: JobQueue) {
  const hash = await hashPassword("pw");
  const app = Fastify();
  await registerSession(app, SECRET);
  await registerAuthRoutes(app, { passwordHash: hash, loginRateLimit: 100, loginRateWindowMs: 60_000 });
  await registerDownloadRoute(app, { queue });
  const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
  // Read our sessionId via a tiny helper route registered in test mode by download-route:
  const who = await app.inject({
    method: "POST",
    url: "/__test/whoami",
    headers: { cookie: login.headers["set-cookie"] as string },
  });
  return {
    app,
    cookie: login.headers["set-cookie"] as string,
    userId: who.json().userId as string,
  };
}

function makeDoneJob(id: string, sessionId: string, outputPath: string, originalName: string): Job {
  return {
    id,
    sessionId,
    type: "video",
    originalName,
    inputPath: "/tmp/in",
    outputPath,
    preset: getPreset("manychat"),
    createdAt: Date.now(),
    state: "done",
    progress: 100,
    outputSize: 100,
  };
}

describe("GET /api/download/:jobId", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zx-dl-"));
  });

  afterEach(async () => {
    if (app) await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns 404 for unknown jobId", async () => {
    const q = new JobQueue({ queueMax: 10 });
    let cookie: string;
    ({ app, cookie } = await buildApp(q));
    const res = await app.inject({ method: "GET", url: "/api/download/nope", headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when job belongs to another session", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const out = join(dir, "out.mp4");
    await writeFile(out, "fake mp4 bytes");
    q.enqueue(makeDoneJob("j1", "other-session", out, "in.mp4"));
    let cookie: string;
    ({ app, cookie } = await buildApp(q));
    const res = await app.inject({ method: "GET", url: "/api/download/j1", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("streams file with UTF-8 filename header preserving Thai characters", async () => {
    const q = new JobQueue({ queueMax: 10 });
    let cookie: string;
    let userId: string;
    ({ app, cookie, userId } = await buildApp(q));
    const out = join(dir, "out.mp4");
    await writeFile(out, "hello-video-bytes");
    q.enqueue(makeDoneJob("j2", userId, out, "ชื่อไทย.mp4"));
    // Mutate state so it registers as "done"
    q.update("j2", { state: "done", progress: 100, outputSize: 17 });

    const res = await app.inject({ method: "GET", url: "/api/download/j2", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/video\/mp4/);
    const disp = String(res.headers["content-disposition"]);
    expect(disp).toMatch(/filename\*=UTF-8''/);
    expect(disp).toMatch(/%E0%B8%8A/); // 'ช' encoded
    expect(res.body).toBe("hello-video-bytes");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/routes/download.test.ts`
Expected: FAIL — module `./download.js` not found.

- [ ] **Step 3: Implement `src/routes/download.ts`**

```typescript
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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

  app.get(
    "/api/download/:jobId",
    { preHandler: requireLogin },
    async (req: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/routes/download.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/download.ts src/routes/download.test.ts
git commit -m "feat: GET /api/download/:jobId with RFC 5987 filename header"
```

---

### Task 6.4: Jobs list and delete routes

**Files:**
- Create: `src/routes/jobs.ts`
- Create: `src/routes/jobs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/routes/jobs.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSession } from "../auth/session.js";
import { registerAuthRoutes } from "../auth/login-route.js";
import { registerJobsRoutes } from "./jobs.js";
import { hashPassword } from "../auth/password.js";
import { JobQueue } from "../jobs/queue.js";
import { getPreset } from "../presets/index.js";
import type { Job } from "../jobs/types.js";

const SECRET = "a".repeat(64);

function makeJob(id: string, sessionId: string, state: Job["state"] = "queued"): Job {
  return {
    id,
    sessionId,
    type: "video",
    originalName: `${id}.mp4`,
    inputPath: `/tmp/${id}-in`,
    outputPath: `/tmp/${id}-out`,
    preset: getPreset("manychat"),
    createdAt: Date.now(),
    state,
    progress: state === "done" ? 100 : 0,
  };
}

function makeFakeWorker() {
  const cancelled: string[] = [];
  return {
    handle: {
      cancel(jobId: string) {
        cancelled.push(jobId);
        return true;
      },
      stop: async () => {},
    },
    cancelled,
  };
}

async function buildApp(queue: JobQueue, worker?: ReturnType<typeof makeFakeWorker>["handle"]) {
  const hash = await hashPassword("pw");
  const app = Fastify();
  await registerSession(app, SECRET);
  await registerAuthRoutes(app, { passwordHash: hash, loginRateLimit: 100, loginRateWindowMs: 60_000 });
  await registerJobsRoutes(app, { queue, worker });
  const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
  const cookie = login.headers["set-cookie"] as string;
  const who = await app.inject({ method: "POST", url: "/__test/whoami", headers: { cookie } });
  return { app, cookie, userId: who.json().userId as string };
}

describe("GET /api/jobs", () => {
  let app: FastifyInstance;
  afterEach(async () => { if (app) await app.close(); });

  it("returns only jobs owned by this session", async () => {
    const q = new JobQueue({ queueMax: 10 });
    let cookie: string; let userId: string;
    ({ app, cookie, userId } = await buildApp(q));
    q.enqueue(makeJob("mine1", userId));
    q.enqueue(makeJob("theirs", "other"));
    q.enqueue(makeJob("mine2", userId, "done"));
    const res = await app.inject({ method: "GET", url: "/api/jobs", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const ids = res.json().jobs.map((j: { id: string }) => j.id).sort();
    expect(ids).toEqual(["mine1", "mine2"]);
  });
});

describe("DELETE /api/jobs/:jobId", () => {
  let app: FastifyInstance;
  afterEach(async () => { if (app) await app.close(); });

  it("removes a queued job without calling worker.cancel", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const w = makeFakeWorker();
    // No worker handle — queued jobs should still delete cleanly.
    let cookie: string; let userId: string;
    ({ app, cookie, userId } = await buildApp(q));
    q.enqueue(makeJob("j1", userId, "queued"));
    const res = await app.inject({ method: "DELETE", url: "/api/jobs/j1", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(q.get("j1")).toBeUndefined();
    expect(w.cancelled).toEqual([]);
  });

  it("calls worker.cancel for an in-flight job", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const w = makeFakeWorker();
    let cookie: string; let userId: string;
    ({ app, cookie, userId } = await buildApp(q, w.handle));
    q.enqueue(makeJob("jflight", userId, "pass1"));
    // Simulate the worker reacting to the abort by moving the job to error
    // on a 100ms delay (like the real catch-block would do).
    setTimeout(() => {
      q.update("jflight", { state: "error", error: "CANCELLED: cancelled_by_user" });
    }, 100);
    const res = await app.inject({ method: "DELETE", url: "/api/jobs/jflight", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(w.cancelled).toEqual(["jflight"]);
    expect(q.get("jflight")).toBeUndefined();
  });

  it("removes a completed job and unlinks output file", async () => {
    const q = new JobQueue({ queueMax: 10 });
    const { mkdtemp, writeFile, rm, stat } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "zx-jobs-done-"));
    const outDir = join(dir, "jdone");
    await (await import("node:fs/promises")).mkdir(outDir, { recursive: true });
    const outPath = join(outDir, "out.mp4");
    await writeFile(outPath, "done bytes");

    let cookie: string; let userId: string;
    ({ app, cookie, userId } = await buildApp(q));
    const doneJob = makeJob("jdone", userId, "done");
    doneJob.outputPath = outPath;
    q.enqueue(doneJob);

    const res = await app.inject({ method: "DELETE", url: "/api/jobs/jdone", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    await expect(stat(outPath)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it("removes an already-errored job cleanly", async () => {
    const q = new JobQueue({ queueMax: 10 });
    let cookie: string; let userId: string;
    ({ app, cookie, userId } = await buildApp(q));
    const erroredJob = makeJob("jerr", userId, "error");
    q.enqueue(erroredJob);
    const res = await app.inject({ method: "DELETE", url: "/api/jobs/jerr", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(q.get("jerr")).toBeUndefined();
  });

  it("returns 403 when deleting another session's job", async () => {
    const q = new JobQueue({ queueMax: 10 });
    let cookie: string;
    ({ app, cookie } = await buildApp(q));
    q.enqueue(makeJob("j2", "other"));
    const res = await app.inject({ method: "DELETE", url: "/api/jobs/j2", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for unknown jobId", async () => {
    const q = new JobQueue({ queueMax: 10 });
    let cookie: string;
    ({ app, cookie } = await buildApp(q));
    const res = await app.inject({ method: "DELETE", url: "/api/jobs/nope", headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/routes/jobs.test.ts`
Expected: FAIL — module `./jobs.js` not found.

- [ ] **Step 3: Implement `src/routes/jobs.ts`**

```typescript
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { requireLogin } from "../auth/require-login.js";
import type { JobQueue } from "../jobs/queue.js";
import type { WorkerHandle } from "../jobs/worker.js";
import { isTerminalState } from "../jobs/types.js";
import { registerTestSeam } from "./test-seam.js";

export interface JobsRoutesOptions {
  queue: JobQueue;
  /**
   * Worker handle is optional in tests that never start a worker. In
   * production it is always provided so in-flight cancel works.
   */
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

  app.delete(
    "/api/jobs/:jobId",
    { preHandler: requireLogin },
    async (
      req: FastifyRequest<{ Params: { jobId: string } }>,
      reply: FastifyReply,
    ) => {
      const sessionId = req.session.get("userId")!;
      const { jobId } = req.params;
      const job = opts.queue.get(jobId);
      if (!job) return reply.code(404).send({ error: "not_found" });
      if (job.sessionId !== sessionId) {
        return reply.code(403).send({ error: "forbidden" });
      }

      // In-flight jobs must be cancelled via the worker so the ffmpeg/sharp
      // child receives SIGTERM. After requesting the cancel we wait up to
      // 5s for the worker to transition the job to a terminal state (its
      // catch block sets state=error with a CANCELLED message) before
      // cleaning up files — this avoids the race where a half-written output
      // lands on disk after we rm'd the directory.
      if (!isTerminalState(job.state)) {
        const cancelled = opts.worker?.cancel(jobId) ?? false;
        if (cancelled) {
          await waitForTerminal(opts.queue, jobId, 5000);
        } else {
          // Queued but not yet picked up by any worker loop — mark error
          // directly so listBySession reflects the cancellation.
          opts.queue.update(jobId, {
            state: "error",
            error: "CANCELLED: cancelled_by_user",
          });
        }
      }

      // Clean up the job-specific output directory only (dirname of the
      // output path is `<outputDir>/<jobId>/` per storage/paths.ts).
      if (job.outputPath) {
        await rm(dirname(job.outputPath), { recursive: true, force: true }).catch(() => {});
      }
      opts.queue.remove(jobId);
      return reply.send({ ok: true });
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/routes/jobs.test.ts`
Expected: 7 passed (list, queued delete, in-flight cancel, done delete w/ unlink, errored delete, 403, 404).

- [ ] **Step 5: Commit**

```bash
git add src/routes/jobs.ts src/routes/jobs.test.ts
git commit -m "feat: GET /api/jobs list and DELETE /api/jobs/:id cancel/remove"
```

---

### Task 6.5: Full chunk 6 verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: chunks 1-6 all pass. Total ~2.5 minutes.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Verify commit count**

Run: `git log --oneline | wc -l`
Expected: 21 (chunks 1-5) + 4 (chunk 6: test-seam, progress, download, jobs) = 25 commits on top of the brainstorming commits.

---

**End of Chunk 6.** Next: Chunk 7 (server bootstrap, storage cleanup cron, end-to-end integration test).

---

## Chunk 7: Server bootstrap, storage cleanup, end-to-end integration test

This chunk wires every module from chunks 1-6 into a single runnable Fastify server and adds the cron that enforces retention. The climax is an end-to-end integration test that drives a real job through upload → SSE → download → delete against a live in-process server.

**Chunk 7 produces:**
- `src/storage/cleanup.ts` — node-cron sweep: unlinks orphaned `uploads/<jobId>` older than 30 min and `outputs/<jobId>` older than `retentionHours`.
- `src/server.ts` — Fastify bootstrap: loads config, registers session, multipart, all routes, starts worker, starts cleanup cron, binds to port.
- `tests/integration/e2e.test.ts` — full flow test: POST /api/login → POST /api/upload → SSE progress → GET /api/download → DELETE /api/jobs.

After this chunk, `npm run dev` starts a fully working backend. Frontend lands in chunk 8.

### Task 7.1: Storage cleanup cron

**Files:**
- Create: `src/storage/cleanup.ts`
- Create: `src/storage/cleanup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/storage/cleanup.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, stat, utimes, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepExpired } from "./cleanup.js";

describe("sweepExpired", () => {
  let root: string;
  let uploads: string;
  let outputs: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "zx-cleanup-"));
    uploads = join(root, "uploads");
    outputs = join(root, "outputs");
    await mkdir(uploads, { recursive: true });
    await mkdir(outputs, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function makeJobDir(parent: string, id: string, ageMs: number): Promise<string> {
    const dir = join(parent, id);
    await mkdir(dir);
    await writeFile(join(dir, "file.dat"), "bytes");
    const when = new Date(Date.now() - ageMs);
    await utimes(dir, when, when);
    await utimes(join(dir, "file.dat"), when, when);
    return dir;
  }

  it("unlinks outputs older than retentionHours", async () => {
    await makeJobDir(outputs, "old", 2 * 3600 * 1000);      // 2h old
    await makeJobDir(outputs, "fresh", 10 * 60 * 1000);     // 10m old
    await sweepExpired({ uploadsDir: uploads, outputsDir: outputs, retentionHours: 1, orphanUploadsMinutes: 30 });
    const remaining = await readdir(outputs);
    expect(remaining).toEqual(["fresh"]);
  });

  it("unlinks uploads older than orphanUploadsMinutes", async () => {
    await makeJobDir(uploads, "abandoned", 60 * 60 * 1000); // 60m old
    await makeJobDir(uploads, "recent", 5 * 60 * 1000);     // 5m old
    await sweepExpired({ uploadsDir: uploads, outputsDir: outputs, retentionHours: 1, orphanUploadsMinutes: 30 });
    const remaining = await readdir(uploads);
    expect(remaining).toEqual(["recent"]);
  });

  it("is a no-op when directories are empty", async () => {
    await sweepExpired({ uploadsDir: uploads, outputsDir: outputs, retentionHours: 1, orphanUploadsMinutes: 30 });
    expect(await readdir(uploads)).toEqual([]);
    expect(await readdir(outputs)).toEqual([]);
  });

  it("ignores missing directories without throwing", async () => {
    await sweepExpired({
      uploadsDir: join(root, "nope-uploads"),
      outputsDir: join(root, "nope-outputs"),
      retentionHours: 1,
      orphanUploadsMinutes: 30,
    });
    // No throw = pass.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/storage/cleanup.test.ts`
Expected: FAIL — module `./cleanup.js` not found.

- [ ] **Step 3: Implement `src/storage/cleanup.ts`**

```typescript
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

/**
 * Schedules a cron job that runs sweepExpired every 10 minutes.
 * Returns a handle whose stop() cancels the schedule (used by tests
 * and graceful shutdown).
 */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/storage/cleanup.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/storage/cleanup.ts src/storage/cleanup.test.ts
git commit -m "feat: storage cleanup sweep for expired uploads and outputs"
```

---

### Task 7.2: Server bootstrap

**Files:**
- Create: `src/server.ts`
- Create: `src/server.test.ts`

The bootstrap function creates the Fastify instance, registers every plugin and route, starts the worker, starts the cleanup cron, and returns a `Server` handle whose `close()` shuts everything down. Tests exercise the factory against a temp directory with the full stack wired up.

- [ ] **Step 1: Write the failing test**

```typescript
// src/server.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, type ServerHandle } from "./server.js";
import { hashPassword } from "./auth/password.js";

describe("buildServer", () => {
  let root: string;
  let server: ServerHandle;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "zx-server-"));
    await mkdir(join(root, "uploads"));
    await mkdir(join(root, "outputs"));
    server = await buildServer({
      nodeEnv: "test",
      port: 0,
      host: "127.0.0.1",
      authPasswordHash: await hashPassword("pw"),
      sessionSecret: "a".repeat(64),
      uploadDir: join(root, "uploads"),
      outputDir: join(root, "outputs"),
      retentionHours: 1,
      maxUploadMB: 500,
      workerConcurrency: 1,
      workerTimeoutMs: 60_000,
      queueMax: 10,
      loginRateLimit: 100,
      loginRateWindowMs: 60_000,
    });
  });

  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  it("responds to GET /api/health without auth", async () => {
    const res = await server.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().queueDepth).toBe(0);
  });

  it("requires auth for /api/presets", async () => {
    const res = await server.app.inject({ method: "GET", url: "/api/presets" });
    expect(res.statusCode).toBe(401);
  });

  it("serves /api/presets after login", async () => {
    const login = await server.app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "pw" },
    });
    const cookie = login.headers["set-cookie"] as string;
    const res = await server.app.inject({
      method: "GET",
      url: "/api/presets",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().presets[0].id).toBe("manychat");
  });

  it("exposes the underlying queue and worker handles on the server", () => {
    expect(server.queue).toBeDefined();
    expect(server.worker).toBeDefined();
    expect(typeof server.worker.cancel).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server.test.ts`
Expected: FAIL — module `./server.js` not found.

- [ ] **Step 3: Implement `src/server.ts`**

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Config } from "./config.js";
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
    logger: false, // we log via pino directly in handlers
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

  // Static assets — the frontend lands here in chunk 8. We only register
  // the plugin if the directory actually exists, so chunk-7 test runs
  // (and clean-checkout dev runs before chunk 8) do not fail.
  const publicDir = resolve(__dirname, "..", "public");
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, prefix: "/" });
  }

  // Auth routes (login, logout, rate limit)
  await registerAuthRoutes(app, {
    passwordHash: config.authPasswordHash,
    loginRateLimit: config.loginRateLimit,
    loginRateWindowMs: config.loginRateWindowMs,
  });

  // Data routes
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
      // Drain HTTP first so in-flight handlers (including SSE streams)
      // finish before their underlying worker/queue goes away. The
      // try/finally guarantees the worker and cron stop even if the
      // HTTP drain throws — otherwise the timer leaks on test teardown.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/server.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Add an entry point that reads env and starts the server**

Append a `main` block at the bottom of `src/server.ts`. It uses the ESM-idiomatic `import.meta.url === pathToFileURL(process.argv[1]).href` check so Vitest workers and non-entry imports never trigger it, and registers SIGINT/SIGTERM handlers for graceful shutdown under systemd (chunk 9) or manual Ctrl+C.

```typescript
import { loadConfig } from "./config.js";

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig(process.env);
  buildServer(config)
    .then(async (handle) => {
      let shuttingDown = false;
      const shutdown = async (signal: string) => {
        if (shuttingDown) return;   // idempotent — ignore second Ctrl+C
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
      // Register before listen() so a SIGTERM during startup is still caught.
      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      await handle.listen();
    })
    .catch((err) => {
      logger.error({ err }, "failed to start server");
      process.exit(1);
    });
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: buildServer bootstrap wiring config, session, routes, worker, cleanup"
```

---

### Task 7.3: End-to-end integration test

**Files:**
- Create: `tests/integration/e2e.test.ts`

A single test that drives the full flow against a live in-process server listening on a random port, using a tiny video fixture from chunk 3.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import FormData from "form-data";
import { buildServer, type ServerHandle } from "../../src/server.js";
import { hashPassword } from "../../src/auth/password.js";
import { makeTinyVideo } from "../fixtures/generate.js";

describe("end-to-end flow", () => {
  let root: string;
  let server: ServerHandle;
  let address: string;
  let videoPath: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "zx-e2e-"));
    await mkdir(join(root, "uploads"));
    await mkdir(join(root, "outputs"));
    videoPath = join(root, "in.mp4");
    // 2s 320x240 encodes 2-pass in ~5 seconds on dev machine.
    await makeTinyVideo(videoPath, { durationSec: 2, width: 320, height: 240 });

    server = await buildServer({
      nodeEnv: "test",
      port: 0,
      host: "127.0.0.1",
      authPasswordHash: await hashPassword("e2e-pass"),
      sessionSecret: "a".repeat(64),
      uploadDir: join(root, "uploads"),
      outputDir: join(root, "outputs"),
      retentionHours: 1,
      maxUploadMB: 500,
      workerConcurrency: 1,
      workerTimeoutMs: 120_000,
      queueMax: 10,
      loginRateLimit: 100,
      loginRateWindowMs: 60_000,
    });
    address = await server.listen();
  }, 30_000);

  afterAll(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  async function request(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: Buffer | string },
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, address);
      const req = http.request(
        url,
        { method: init.method, headers: init.headers ?? {} },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      if (init.body) req.write(init.body);
      req.end();
    });
  }

  it("login → upload → SSE progress → download → delete", async () => {
    // 1. Login
    const loginRes = await request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "e2e-pass" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = (loginRes.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    expect(cookie).toMatch(/^zx_session=/);

    // 2. Upload
    const form = new FormData();
    form.append("file", await readFile(videoPath), { filename: "in.mp4" });
    form.append("preset", "manychat");
    const uploadBody = form.getBuffer();
    const uploadHeaders: Record<string, string> = {
      cookie,
      ...(form.getHeaders() as Record<string, string>),
      "content-length": String(uploadBody.length),
    };
    const uploadRes = await request("/api/upload", {
      method: "POST",
      headers: uploadHeaders,
      body: uploadBody,
    });
    expect(uploadRes.status).toBe(200);
    const uploadJson = JSON.parse(uploadRes.body);
    const jobId = uploadJson.jobId as string;
    expect(jobId).toBeTruthy();

    // 3. Open SSE and collect events until "done"
    const events: Array<{ event: string; data: string }> = [];
    await new Promise<void>((resolve, reject) => {
      const url = new URL(`/api/progress/${jobId}`, address);
      const req = http.get(url, { headers: { cookie } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE status ${res.statusCode}`));
          return;
        }
        let buf = "";
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const eventMatch = block.match(/^event:\s*(\w+)/m);
            const dataMatch = block.match(/^data:\s*(.*)$/m);
            if (eventMatch && dataMatch) {
              events.push({ event: eventMatch[1]!, data: dataMatch[1]! });
              if (eventMatch[1] === "done" || eventMatch[1] === "failed") {
                req.destroy();
                resolve();
                return;
              }
            }
          }
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      setTimeout(() => {
        req.destroy();
        reject(new Error("SSE timeout"));
      }, 60_000);
    });

    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
    const donePayload = JSON.parse(doneEvent!.data);
    expect(donePayload.state).toBe("done");
    expect(donePayload.downloadUrl).toBe(`/api/download/${jobId}`);

    // 4. Download
    const dlRes = await request(`/api/download/${jobId}`, {
      method: "GET",
      headers: { cookie },
    });
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers["content-type"]).toMatch(/video\/mp4/);
    expect(dlRes.headers["content-disposition"]).toMatch(/filename\*=UTF-8''/);
    expect(dlRes.body.length).toBeGreaterThan(0);

    // 5. Delete
    const delRes = await request(`/api/jobs/${jobId}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(delRes.status).toBe(200);

    // Subsequent download attempt should 404.
    const dl2 = await request(`/api/download/${jobId}`, {
      method: "GET",
      headers: { cookie },
    });
    expect(dl2.status).toBe(404);
  }, 120_000);
});
```

- [ ] **Step 2: Run the integration test**

Run: `npm test -- tests/integration/e2e.test.ts`
Expected: 1 passed. Takes ~10 seconds (real ffmpeg encoding a 2s fixture).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/e2e.test.ts
git commit -m "test: end-to-end flow (login, upload, SSE, download, delete)"
```

---

### Task 7.4: Full chunk 7 verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: chunks 1-7 all pass. Total ~3 minutes.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Smoke test the dev server manually**

Run:
```bash
cp .env.example .env
npm run hash-password   # enter a password, copy hash to .env
# edit .env: UPLOAD_DIR=/tmp/zx-uploads, OUTPUT_DIR=/tmp/zx-outputs, SESSION_SECRET=<64 hex>
mkdir -p /tmp/zx-uploads /tmp/zx-outputs
npm run dev
```

Expected: log line "zenityx-compress listening" with an address like `http://127.0.0.1:4100`.
In another terminal: `curl http://127.0.0.1:4100/api/health` → returns `{"ok":true,...}`.

Stop the dev server with Ctrl+C. Worker and cleanup should shut down cleanly.

- [ ] **Step 4: Verify commit count**

Run: `git log --oneline | wc -l`
Expected: 25 (chunks 1-6) + 3 (chunk 7: cleanup, server, e2e) = 28 commits on top of the brainstorming commits.

---

**End of Chunk 7.** Next: Chunk 8 (frontend — index.html, Alpine.js, SSE client).

---

## Chunk 8: Frontend

This chunk adds the static HTML frontend: login screen, dropzone with preset selector, timeline cards with live SSE-driven progress, and download/cancel actions. Stack is vanilla HTML + Alpine.js from CDN + Tailwind CDN — no build step. All icons are inline SVG in Lucide style (no emoji).

**Chunk 8 produces:**
- `public/index.html` — full SPA shell with login and main app blocks, switched via Alpine.js `x-show`.
- `public/app.js` — Alpine component: state machine (`unauth` → `auth`), dropzone handlers, SSE per job, timeline rendering, preset selection, logout, error toasts.
- `public/styles.css` — minimal CSS custom properties for the ZenityX red palette; rest is Tailwind utility classes.
- `public/assets/logo.png` — copied from `/Users/trin/Logo/zenityX Logo2.png`.
- `public/assets/favicon.png` — copied from `/Users/trin/icon ZenityX-Final.png`.
- Test: a Playwright-free smoke test that hits `/` on the live server and asserts the HTML skeleton renders.

**Design decisions baked in (see spec §4 and chunk 7 mockups):**
- No build step — Alpine + Tailwind are loaded from CDN so deploy is `rsync public/ compress.zenityx.com:/opt/compress/public/`.
- Single HTML file. Alpine handles auth gate via `x-show`.
- Colors: CSS custom properties `--zx-red: #E50914` and `--zx-red-dark: #C40812`.
- Mobile-first layout: max-width 720px, stacks dropzone and timeline vertically on all widths.
- Output filename pattern: the server already sets `Content-Disposition`, so the frontend just triggers download via `<a href download>`.

### Task 8.1: Static HTML shell

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`

The HTML file contains both the login block and the main app block, gated by an Alpine component. No JavaScript logic yet — just the skeleton.

- [ ] **Step 1: Create `public/index.html`**

```html
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ZenityX Media Compressor</title>
  <link rel="icon" type="image/png" href="/assets/favicon.png" />
  <link rel="stylesheet" href="/styles.css" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
  <script defer src="/app.js"></script>
</head>
<body class="bg-zinc-100 text-zinc-900 font-sans antialiased">
  <div x-data="compressApp()" x-cloak class="min-h-screen flex flex-col">

    <!-- Top bar -->
    <header class="bg-white border-b border-zinc-200 px-4 md:px-6 py-3 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <img src="/assets/logo.png" alt="zenityX" class="h-7 md:h-8 w-auto" />
        <span class="hidden md:inline text-zinc-400">|</span>
        <span class="hidden md:inline text-sm font-medium text-zinc-600">Media Compressor</span>
      </div>
      <div class="flex items-center gap-3" x-show="authed">
        <span class="text-xs text-zinc-500" x-text="todayCount + ' งานในชั่วโมงนี้'"></span>
        <button @click="logout()" class="text-xs border border-zinc-200 rounded-md px-3 py-1 hover:bg-zinc-50">Logout</button>
      </div>
    </header>

    <!-- Login -->
    <main x-show="!authed" class="flex-1 flex items-center justify-center p-6">
      <form @submit.prevent="login()" class="w-full max-w-sm bg-white rounded-xl shadow-sm border border-zinc-200 p-6 space-y-4">
        <h1 class="text-lg font-bold">เข้าสู่ระบบ</h1>
        <p class="text-xs text-zinc-500">รหัสผ่านของทีมแอดมิน</p>
        <input
          type="password"
          x-model="passwordInput"
          :disabled="loggingIn"
          class="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--zx-red)]"
          placeholder="Password"
          autofocus
        />
        <button
          type="submit"
          :disabled="loggingIn || !passwordInput"
          class="w-full rounded-md bg-[color:var(--zx-red)] text-white py-2 text-sm font-semibold shadow hover:bg-[color:var(--zx-red-dark)] disabled:opacity-50"
          x-text="loggingIn ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'"
        ></button>
        <p class="text-xs text-red-600" x-show="loginError" x-text="loginError"></p>
      </form>
    </main>

    <!-- Main app -->
    <main x-show="authed" class="flex-1 w-full max-w-[720px] mx-auto p-4 md:p-6 space-y-4">
      <!-- Preset selector -->
      <div class="flex items-center gap-2">
        <template x-for="p in presets" :key="p.id">
          <button
            @click="selectedPreset = p.id"
            :class="selectedPreset === p.id ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 border border-zinc-200'"
            class="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
            <span x-text="p.name"></span>
          </button>
        </template>
        <button
          @click="openCustom()"
          :class="selectedPreset === 'custom' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 border border-zinc-200'"
          class="px-4 py-2 rounded-lg text-sm flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/></svg>
          Custom
        </button>
        <div class="ml-auto text-xs text-zinc-400 hidden md:flex items-center gap-1">
          <span>Video ≤25MB</span><span>·</span><span>Image ≤5MB</span>
        </div>
      </div>

      <!-- Custom target input -->
      <div x-show="selectedPreset === 'custom'" class="bg-white border border-zinc-200 rounded-lg p-3 flex items-center gap-2">
        <label class="text-xs text-zinc-500">Target size (MB)</label>
        <input
          type="number"
          min="1" max="500"
          x-model.number="customTargetMB"
          class="w-24 border border-zinc-200 rounded-md px-2 py-1 text-sm"
        />
      </div>

      <!-- Dropzone -->
      <div
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="handleDrop($event)"
        :class="dragging ? 'border-[color:var(--zx-red)] bg-red-50' : 'border-zinc-400 bg-white'"
        class="border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer"
        @click="$refs.filePicker.click()"
      >
        <input type="file" x-ref="filePicker" class="hidden" multiple @change="handlePicked($event)" />
        <div class="flex justify-center mb-2 text-zinc-500">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </div>
        <div class="text-base font-semibold">ลากไฟล์มาวางตรงนี้</div>
        <div class="text-xs text-zinc-500 mt-1">หรือ <span class="text-[color:var(--zx-red)] font-semibold underline">คลิกเพื่อเลือกไฟล์</span> · รองรับหลายไฟล์พร้อมกัน</div>
        <div class="text-[11px] text-zinc-400 mt-2">วีดีโอ (mp4, mov, mkv, webm) · รูป (jpg, png, webp, heic) · สูงสุด 500MB</div>
      </div>

      <!-- Timeline -->
      <div x-show="jobs.length > 0" class="space-y-2">
        <div class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <span x-text="'Today — ' + jobs.length + ' files'"></span>
          <span>auto-delete 1 hour after completion</span>
        </div>
        <template x-for="job in jobs" :key="job.id">
          <div
            :class="job.state === 'error' ? 'border-red-400' : (isActive(job) ? 'border-[color:var(--zx-red)] ring-4 ring-red-500/10' : 'border-zinc-200')"
            class="bg-white border rounded-xl p-3 md:p-4"
            x-data
          >
            <div class="flex items-center gap-3">
              <!-- type icon -->
              <div :class="job.type === 'video' ? (job.state === 'done' ? 'bg-green-100 text-green-600' : (job.state === 'error' ? 'bg-red-100 text-red-600' : 'bg-red-100 text-[color:var(--zx-red)]')) : 'bg-zinc-100 text-zinc-500'" class="w-9 h-9 rounded-xl flex items-center justify-center">
                <template x-if="job.type === 'video'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                </template>
                <template x-if="job.type === 'image'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </template>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[13px] font-semibold truncate" x-text="job.originalName"></div>
                <div class="text-[11px]" :class="job.state === 'error' ? 'text-red-600' : (isActive(job) ? 'text-[color:var(--zx-red)] font-semibold' : 'text-zinc-500')" x-text="jobSubtitle(job)"></div>
              </div>
              <template x-if="job.state === 'done'">
                <a :href="job.downloadUrl" :download="job.originalName" class="bg-[color:var(--zx-red)] text-white px-4 py-2 rounded-lg text-xs font-semibold shadow flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download
                </a>
              </template>
              <template x-if="isActive(job)">
                <button @click="cancelJob(job)" class="text-xs border border-zinc-200 rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-50">ยกเลิก</button>
              </template>
            </div>
            <template x-if="isActive(job)">
              <div class="mt-3 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div class="h-full bg-gradient-to-r from-[color:var(--zx-red)] to-[color:var(--zx-red-dark)] transition-all" :style="'width: ' + job.progress + '%'"></div>
              </div>
            </template>
          </div>
        </template>
      </div>
    </main>

    <!-- Toasts -->
    <div class="fixed bottom-4 right-4 space-y-2 z-50">
      <template x-for="t in toasts" :key="t.id">
        <div
          class="bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg max-w-sm"
          x-text="t.message"
        ></div>
      </template>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 2: Create `public/styles.css`**

```css
:root {
  --zx-red: #e50914;
  --zx-red-dark: #c40812;
}

[x-cloak] { display: none !important; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Thai", sans-serif;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "feat(frontend): HTML shell with login gate, dropzone, and timeline skeleton"
```

---

### Task 8.2: Alpine.js app logic

**Files:**
- Create: `public/app.js`

- [ ] **Step 1: Implement the Alpine component**

```javascript
// public/app.js — no build step, runs straight in the browser.
/* global Alpine */
function compressApp() {
  return {
    // --- state ---
    authed: false,
    passwordInput: "",
    loggingIn: false,
    loginError: "",

    presets: [],
    selectedPreset: "manychat",
    customTargetMB: 24,

    jobs: [],           // newest first
    sseByJob: {},       // jobId → EventSource
    dragging: false,
    toasts: [],
    nextToastId: 1,

    // --- lifecycle ---
    async init() {
      // Try to restore session on load; if /api/presets returns 200 we're authed.
      try {
        const res = await fetch("/api/presets", { credentials: "same-origin" });
        if (res.ok) {
          const body = await res.json();
          this.presets = body.presets;
          this.authed = true;
          await this.refreshJobs();
        }
      } catch {
        // network error — stay on login
      }
    },

    get todayCount() {
      return this.jobs.length;
    },

    isActive(job) {
      return ["probing", "pass1", "pass2", "encoding", "queued"].includes(job.state);
    },

    jobSubtitle(job) {
      if (job.state === "queued") return "รออยู่ในคิว";
      if (job.state === "probing") return "กำลังวิเคราะห์ไฟล์...";
      if (job.state === "pass1") return `Pass 1/2 · ${job.progress}%`;
      if (job.state === "pass2") return `Pass 2/2 · ${job.progress}%`;
      if (job.state === "encoding") return `บีบอัด · ${job.progress}%`;
      if (job.state === "done") {
        const before = fmtMB(job.inputSize);
        const after = fmtMB(job.outputSize);
        const pct = job.inputSize ? Math.round(100 - (job.outputSize * 100) / job.inputSize) : 0;
        return `${before} → ${after} · ลด ${pct}%`;
      }
      if (job.state === "error") return job.error || "เกิดข้อผิดพลาด";
      return job.state;
    },

    // --- auth ---
    async login() {
      this.loggingIn = true;
      this.loginError = "";
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: this.passwordInput }),
        });
        if (res.ok) {
          this.authed = true;
          this.passwordInput = "";
          const presetsRes = await fetch("/api/presets", { credentials: "same-origin" });
          this.presets = (await presetsRes.json()).presets;
          await this.refreshJobs();
        } else if (res.status === 429) {
          const body = await res.json().catch(() => ({}));
          this.loginError = `ลองใหม่ในอีก ${body.retryAfterSec ?? 60} วินาที`;
        } else {
          this.loginError = "รหัสผ่านไม่ถูกต้อง";
        }
      } catch (err) {
        this.loginError = "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง";
      } finally {
        this.loggingIn = false;
      }
    },

    async logout() {
      for (const jobId of Object.keys(this.sseByJob)) {
        this.sseByJob[jobId].close();
      }
      this.sseByJob = {};
      await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
      this.authed = false;
      this.jobs = [];
    },

    // --- preset UI ---
    openCustom() {
      this.selectedPreset = "custom";
    },

    // --- job list ---
    async refreshJobs() {
      const res = await fetch("/api/jobs", { credentials: "same-origin" });
      if (!res.ok) return;
      const body = await res.json();
      this.jobs = body.jobs;
      // Re-subscribe SSE for any non-terminal job we picked up.
      for (const job of this.jobs) {
        if (this.isActive(job) && !this.sseByJob[job.id]) {
          this.subscribeJob(job.id);
        }
      }
    },

    // --- upload ---
    handleDrop(ev) {
      this.dragging = false;
      const files = ev.dataTransfer?.files;
      if (files) this.uploadAll(files);
    },
    handlePicked(ev) {
      const files = ev.target.files;
      if (files) this.uploadAll(files);
      ev.target.value = "";
    },
    async uploadAll(files) {
      // Sequential to avoid saturating uplink. Queue handles parallelism server-side.
      for (const file of files) {
        await this.uploadOne(file);
      }
    },
    async uploadOne(file) {
      const form = new FormData();
      form.append("file", file);
      // Send whichever preset the user selected — supports future presets
      // beyond "manychat" without client changes.
      form.append("preset", this.selectedPreset);
      if (this.selectedPreset === "custom") {
        form.append("customTargetMB", String(this.customTargetMB));
      }
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "unknown" }));
          this.toast(uploadErrorMessage(res.status, err));
          return;
        }
        const body = await res.json();
        const job = {
          id: body.jobId,
          type: body.type,
          originalName: body.originalName,
          state: "queued",
          progress: 0,
          inputSize: body.inputSize,
          createdAt: Date.now(),
        };
        this.jobs = [job, ...this.jobs];
        this.subscribeJob(body.jobId);
      } catch (err) {
        this.toast("อัปโหลดไม่สำเร็จ — ลองใหม่");
      }
    },

    // --- SSE ---
    // The server emits three named events: "progress" (non-terminal updates),
    // "done" (success, connection closed by server), "failed" (error, connection
    // closed by server). We deliberately do NOT listen on "error" because that
    // name is reserved by EventSource for transport disconnects — collisions
    // are the classic SSE footgun. Transport disconnects trigger browser-native
    // auto-reconnect and we let that happen unless the stream is permanently
    // closed (readyState === CLOSED).
    subscribeJob(jobId) {
      if (this.sseByJob[jobId]) return;
      const es = new EventSource(`/api/progress/${jobId}`);
      this.sseByJob[jobId] = es;
      const apply = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          this.updateJob(jobId, payload);
        } catch {}
      };
      const finish = () => {
        es.close();
        delete this.sseByJob[jobId];
      };
      es.addEventListener("progress", apply);
      es.addEventListener("done", (ev) => { apply(ev); finish(); });
      es.addEventListener("failed", (ev) => { apply(ev); finish(); });
      es.onerror = () => {
        // Transport disconnect. If the browser gave up (readyState CLOSED),
        // remove the subscription so we don't leak it. Otherwise EventSource
        // will attempt to reconnect on its own — nothing to do here.
        if (es.readyState === EventSource.CLOSED) {
          delete this.sseByJob[jobId];
        }
      };
    },

    updateJob(jobId, patch) {
      const idx = this.jobs.findIndex((j) => j.id === jobId);
      if (idx === -1) return;
      this.jobs[idx] = { ...this.jobs[idx], ...patch };
    },

    // --- cancel ---
    async cancelJob(job) {
      if (this.sseByJob[job.id]) {
        this.sseByJob[job.id].close();
        delete this.sseByJob[job.id];
      }
      await fetch(`/api/jobs/${job.id}`, { method: "DELETE", credentials: "same-origin" });
      this.jobs = this.jobs.filter((j) => j.id !== job.id);
    },

    // --- toasts ---
    toast(message) {
      const id = this.nextToastId++;
      this.toasts.push({ id, message });
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, 5000);
    },
  };
}

function fmtMB(bytes) {
  if (bytes == null) return "?";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function uploadErrorMessage(status, body) {
  if (status === 413) return "ไฟล์ใหญ่เกิน 500MB";
  if (status === 415) return "ไม่รองรับไฟล์ประเภทนี้";
  if (status === 422) return body.message ?? "วีดีโอยาวเกินไปสำหรับ target ที่ตั้งไว้";
  if (status === 503) return `ระบบยุ่งอยู่ — มีงาน ${body.queueDepth ?? "?"} ในคิว`;
  if (status === 401) return "เซสชั่นหมดอายุ กรุณาเข้าสู่ระบบใหม่";
  return body?.error ?? "อัปโหลดไม่สำเร็จ";
}

window.compressApp = compressApp;
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat(frontend): Alpine.js app logic — auth, upload, SSE, cancel, toasts"
```

---

### Task 8.3: Logo asset + smoke test

**Files:**
- Create: `public/assets/logo.png`
- Create: `public/assets/favicon.png`
- Create: `src/routes/index-html.test.ts`

> **Note on paths:** the `cp` commands below read from `/Users/trin/Logo/...` and `/Users/trin/...` which are specific to the author's Mac. They only run on the first execution; the copied files are committed to the repo so fresh clones, VPS deployments, and future contributors always get the committed versions under `public/assets/`.

- [ ] **Step 1: Copy assets**

```bash
mkdir -p public/assets
cp "/Users/trin/Logo/zenityX Logo2.png" public/assets/logo.png
cp "/Users/trin/icon ZenityX-Final.png" public/assets/favicon.png
```

- [ ] **Step 2: Write the smoke test**

```typescript
// src/routes/index-html.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, type ServerHandle } from "../server.js";
import { hashPassword } from "../auth/password.js";

describe("static index.html", () => {
  let root: string;
  let server: ServerHandle;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "zx-html-"));
    await mkdir(join(root, "uploads"));
    await mkdir(join(root, "outputs"));
    server = await buildServer({
      nodeEnv: "test",
      port: 0, host: "127.0.0.1",
      authPasswordHash: await hashPassword("pw"),
      sessionSecret: "a".repeat(64),
      uploadDir: join(root, "uploads"),
      outputDir: join(root, "outputs"),
      retentionHours: 1, maxUploadMB: 500,
      workerConcurrency: 1, workerTimeoutMs: 60_000, queueMax: 10,
      loginRateLimit: 100, loginRateWindowMs: 60_000,
    });
  });

  afterAll(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  it("serves / with the Alpine component entry", async () => {
    const res = await server.app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.body).toContain('x-data="compressApp()"');
    expect(res.body).toContain("ZenityX Media Compressor");
  });

  it("serves /app.js and /styles.css", async () => {
    const js = await server.app.inject({ method: "GET", url: "/app.js" });
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain("compressApp");
    const css = await server.app.inject({ method: "GET", url: "/styles.css" });
    expect(css.statusCode).toBe(200);
    expect(css.body).toContain("--zx-red");
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- src/routes/index-html.test.ts`
Expected: 2 passed. (The fastifyStatic registration in `buildServer` now activates because `public/` exists.)

- [ ] **Step 4: Commit**

```bash
git add public/assets src/routes/index-html.test.ts
git commit -m "feat(frontend): logo and favicon assets, static serve smoke test"
```

---

### Task 8.4: Full chunk 8 verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: chunks 1-8 all pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Manual smoke test**

Run `npm run dev` and open `http://127.0.0.1:4100`. Expected:
- Login screen renders with logo, red focus ring on the input.
- Submit wrong password → "รหัสผ่านไม่ถูกต้อง" error appears.
- Submit correct password → main app loads, preset selector shows ManyChat highlighted, dropzone visible.
- Drop a small video → card appears in timeline, progress bar animates red, download button appears on completion.
- Refresh the page mid-encode → card reappears (via `/api/jobs`) and SSE reconnects.
- Click Logout → back to login screen.

- [ ] **Step 4: Verify commit count**

Run: `git log --oneline | wc -l`
Expected: 28 (chunks 1-7) + 3 (chunk 8: html+css, app.js, assets+smoke) = 31 commits on top of the brainstorming commits.

---

**End of Chunk 8.** Next: Chunk 9 (deployment — VPS setup, Caddy, systemd, DNS, Let's Encrypt).

---

## Chunk 9: Deployment to VPS

This chunk puts everything live at `https://compress.zenityx.com`. Unlike earlier chunks, many steps run over SSH on the VPS (`194.233.69.204`), and the DNS change is done by the human in their registrar dashboard. Tests are replaced by smoke checks because this stage is infrastructure, not code.

**Chunk 9 produces:**
- VPS user `compress` with `/opt/compress/` code directory and `/var/compress/{uploads,outputs}` data directories.
- Installed ffmpeg, Node 22, Caddy on the VPS.
- DNS A record `compress.zenityx.com → 194.233.69.204`.
- Caddyfile reverse-proxying `compress.zenityx.com` → `127.0.0.1:4100` with automatic Let's Encrypt.
- systemd unit `compress.service` running the app on boot.
- `.env` on the VPS with a real bcrypt hash and a 64-hex session secret.
- End-to-end smoke test from a laptop: login, upload, progress, download over HTTPS.

**Prerequisites the human must handle (the plan will pause for them):**
- SSH access to `root@194.233.69.204`.
- Write access to zenityx.com DNS.
- A laptop browser to exercise the live URL.

### Task 9.1: VPS prep — user, directories, Node, ffmpeg

All commands in this task run on the VPS as `root` unless otherwise noted.

- [ ] **Step 1: SSH in and update apt**

```bash
ssh root@194.233.69.204
apt update && apt -y upgrade
```

- [ ] **Step 2: Create the `compress` system user**

```bash
adduser --system --group --home /opt/compress --shell /usr/sbin/nologin compress
```

Expected: creates `/opt/compress/` owned by `compress:compress`, no login shell.

- [ ] **Step 3: Install ffmpeg and build tools needed by `sharp`**

```bash
apt -y install ffmpeg build-essential libvips libvips-tools libheif1
ffmpeg -version | head -1
```

Expected: ffmpeg 6.x or newer reports its version.

- [ ] **Step 4: Install Node.js 22**

The VPS already has Node 22 per chunk 0 VPS inspection (`node --version → v22.22.1`). Verify:

```bash
node --version
npm --version
```

Expected: `v22.x` and a current npm version. If missing, install via nvm under the `compress` user or apt's nodesource repo.

- [ ] **Step 5: Create data directories with correct ownership**

```bash
mkdir -p /var/compress/uploads /var/compress/outputs /var/log/compress
chown -R compress:compress /var/compress /var/log/compress
chmod 750 /var/compress /var/log/compress
```

Expected: all directories exist and are owned by `compress:compress`.

- [ ] **Step 6: Open firewall for HTTP/HTTPS**

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw status
```

Expected: UFW lists rules for 22 (already existing), 80, 443.

No commit for this task — it only mutates the VPS.

---

### Task 9.2: DNS A record (human-in-the-loop)

This step runs in the zenityx.com DNS registrar dashboard, not on the VPS.

- [ ] **Step 1: Add A record**

In the DNS manager for `zenityx.com`:
- **Type:** A
- **Name / Host:** `compress`
- **Value / IPv4:** `194.233.69.204`
- **TTL:** 300 (5 minutes, keeps retries cheap if we mis-type anything)

- [ ] **Step 2: Verify propagation**

On the laptop:
```bash
dig +short compress.zenityx.com
```

Expected output: `194.233.69.204` (possibly after a short delay).

If the first `dig` returns nothing, wait 60 s and retry. Do NOT proceed to Task 9.3 until DNS resolves — Caddy's Let's Encrypt challenge needs it.

---

### Task 9.3: Install and configure Caddy

All commands run on the VPS as `root`.

- [ ] **Step 1: Install Caddy via the official apt repo**

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
caddy version
```

Expected: Caddy 2.8 or newer.

- [ ] **Step 2: Write `/etc/caddy/Caddyfile`**

```caddy
compress.zenityx.com {
    reverse_proxy 127.0.0.1:4100 {
        flush_interval -1
        transport http {
            read_timeout 30m
            write_timeout 30m
        }
    }

    request_body {
        max_size 500MB
    }

    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    encode gzip zstd
}
```

- [ ] **Step 3: Validate and reload**

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
systemctl status caddy --no-pager | head -15
```

Expected: `validate` prints `Valid configuration`. `reload` exits zero. `status` shows `active (running)`.

- [ ] **Step 4: Verify Let's Encrypt certificate issuance**

```bash
journalctl -u caddy --since "5 minutes ago" | grep -i "certificate\|obtain\|acme" | tail -20
```

Expected: lines showing Caddy obtained a certificate for `compress.zenityx.com`.

If you see rate-limit errors from Let's Encrypt, **do not retry in a loop** — Caddy does NOT automatically fall back to the staging CA. Options:
- Wait out the rate-limit window (typically 1 hour for "duplicate certificate", up to 168 hours for "certificates per name per week").
- Temporarily switch to the Let's Encrypt staging CA for testing by adding `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` inside the Caddyfile site block, reload Caddy, then remove it before going live (staging certs are untrusted by browsers).

From the laptop:
```bash
curl -v https://compress.zenityx.com 2>&1 | grep -E "SSL|subject|issuer"
```

Expected: valid TLS handshake, issuer `Let's Encrypt`, subject `compress.zenityx.com`.

The response body at this stage will be 502 — the Node app is not yet running. That is expected and gets fixed in the next task.

---

### Task 9.4: Deploy the Node app and create `.env`

> **Path layout note:** the plan uses `/opt/compress/app` for the app checkout and `/opt/compress/app/.env` for the env file, while spec §10 names `/opt/compress` + `/opt/compress/.env`. This is a deliberate refinement: keeping the repo inside a nested `app/` directory means `.git`, `node_modules`, and future throwaway checkouts don't collide with sibling files. The systemd unit in Task 9.5 reflects this updated layout. Update spec §10 after chunk 9 completes so the two documents agree.

- [ ] **Step 1: Deliver the code to the VPS**

Use whichever option you prefer. Option A is simplest if the repo is already on GitHub.

**Option A — clone from GitHub (recommended):**
```bash
ssh root@194.233.69.204
sudo -u compress git clone https://github.com/<your-org>/zenityx-compress.git /opt/compress/app
```

**Option B — push from laptop via a bare repo owned by root:**
```bash
# On the VPS (root, because compress user has nologin shell and cannot accept ssh pushes)
ssh root@194.233.69.204 'git init --bare /opt/compress/repo.git && chown -R root:root /opt/compress/repo.git'

# On the laptop
git remote add vps root@194.233.69.204:/opt/compress/repo.git
git push vps main

# Back on the VPS: clone the bare repo into /opt/compress/app owned by compress.
ssh root@194.233.69.204 'sudo -u compress git clone /opt/compress/repo.git /opt/compress/app'
```

Either option leaves `/opt/compress/app/` owned by `compress:compress` with the full working tree.

- [ ] **Step 2: Install production deps and build**

```bash
ssh root@194.233.69.204
sudo -u compress bash <<'EOF'
cd /opt/compress/app
npm ci --omit=dev
npm run build
ls -la dist/server.js
EOF
```

Expected: `dist/server.js` exists, `node_modules/` populated with production-only deps.

- [ ] **Step 3: Generate the bcrypt password hash**

```bash
sudo -u compress bash -c 'cd /opt/compress/app && npm run hash-password'
```

Enter the team password at the prompt. Copy the `$2b$12$...` hash — you need it in the next step. Do NOT paste it into chat or logs.

- [ ] **Step 4: Generate a 64-hex session secret**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the 64-character hex string.

- [ ] **Step 5: Create `/opt/compress/app/.env`**

```bash
sudo -u compress tee /opt/compress/app/.env > /dev/null <<ENV
NODE_ENV=production
PORT=4100
HOST=127.0.0.1
LOG_LEVEL=info

AUTH_PASSWORD_HASH=<paste bcrypt hash from Step 3>
SESSION_SECRET=<paste 64-hex secret from Step 4>

UPLOAD_DIR=/var/compress/uploads
OUTPUT_DIR=/var/compress/outputs
RETENTION_HOURS=1
MAX_UPLOAD_MB=500

WORKER_CONCURRENCY=2
WORKER_TIMEOUT_MS=900000
QUEUE_MAX=20

LOGIN_RATE_LIMIT=10
LOGIN_RATE_WINDOW_MS=900000
ENV
chmod 600 /opt/compress/app/.env
chown compress:compress /opt/compress/app/.env
```

Expected: `.env` exists, mode 0600, owned by `compress:compress`.

- [ ] **Step 6: Smoke test the binary manually**

Capture the PID explicitly so we can kill it after — `kill %1` does not work across the `sudo` subshell boundary and would otherwise leave port 4100 occupied, making `systemctl start` fail with EADDRINUSE in Task 9.5.

```bash
sudo -u compress bash -c 'cd /opt/compress/app && nohup node dist/server.js >/tmp/zx-smoke.log 2>&1 & echo $!' > /tmp/zx-smoke.pid
sleep 2
curl -s http://127.0.0.1:4100/api/health
kill "$(cat /tmp/zx-smoke.pid)"
sleep 1
# Confirm port is free
ss -tlnp | grep :4100 || echo "port 4100 clear"
```

Expected: `{"ok":true,"version":"0.1.0","uptime":2,"queueDepth":0}` then `port 4100 clear`.

If this fails, do NOT proceed — inspect `/tmp/zx-smoke.log` and fix (most failures are missing `.env` values) before moving on.

---

### Task 9.5: systemd service

- [ ] **Step 1: Write `/etc/systemd/system/compress.service`**

```ini
[Unit]
Description=ZenityX Media Compressor
After=network.target

[Service]
Type=simple
User=compress
Group=compress
WorkingDirectory=/opt/compress/app
EnvironmentFile=/opt/compress/app/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/compress/app.log
StandardError=append:/var/log/compress/app.log

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/compress /var/log/compress
MemoryMax=4G

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Enable and start**

```bash
systemctl daemon-reload
systemctl enable compress
systemctl start compress
sleep 2
systemctl status compress --no-pager | head -15
```

Expected: `active (running)` with `Main PID` set.

**Rollback if it fails:** `systemctl status compress` shows `failed`:
1. `journalctl -u compress -n 100 --no-pager` — read the last 100 log lines.
2. `tail -100 /var/log/compress/app.log` — read the pino output.
3. Fix the issue (typically `.env` typo, missing upload dir, or bad `AUTH_PASSWORD_HASH`).
4. `systemctl stop compress` (if still trying to start) then `systemctl start compress` after the fix.
Caddy will return HTTP 502 to visitors during this window — acceptable because no real traffic is on the site yet.

- [ ] **Step 3: Verify health over HTTPS**

From the laptop:
```bash
curl -s https://compress.zenityx.com/api/health
```

Expected: `{"ok":true,...}`. If this returns 502 the service is down — go back to Step 2. If TLS fails, Caddy did not get a cert — return to Task 9.3 Step 4.

- [ ] **Step 4: Install log rotation**

Write `/etc/logrotate.d/compress`:

```
/var/log/compress/app.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    postrotate
        systemctl kill -s HUP compress.service 2>/dev/null || true
    endscript
}
```

Run a dry-run to verify:
```bash
logrotate -d /etc/logrotate.d/compress
```

Expected: logrotate reports planned rotations without errors.

- [ ] **Step 5: Commit the systemd unit to the repo**

The canonical source of the unit is the plan (Task 9.5 Step 1), not the VPS. Write it directly into the repo — do not `scp` from the VPS because the `compress` user has `nologin` and cannot accept scp, and root-owned files shouldn't be pulled from production as a source of truth.

From the laptop, in the project directory, create `systemd/compress.service` with the exact contents shown in Task 9.5 Step 1, then:

```bash
git add systemd/compress.service
git commit -m "chore(deploy): capture production systemd unit in repo"
```

Future redeploys can copy this file to `/etc/systemd/system/` via:
```bash
scp systemd/compress.service root@194.233.69.204:/etc/systemd/system/compress.service
ssh root@194.233.69.204 'systemctl daemon-reload && systemctl restart compress'
```

---

### Task 9.6: End-to-end live smoke test

From the laptop, using a browser (not curl) so cookies and SSE work naturally.

- [ ] **Step 1: Open the site**

Navigate to `https://compress.zenityx.com`. Expected:
- Login screen renders with the red ZenityX logo.
- No mixed-content or certificate warnings in the browser console.

- [ ] **Step 2: Login**

Enter the password set in Task 9.4 Step 3. Expected: main app appears, preset selector visible, dropzone ready.

- [ ] **Step 3: Upload a small video**

Drag a ~10MB MP4 (under 25s) into the dropzone with ManyChat preset selected. Expected:
- Card appears in the timeline with state `queued` → `probing` → `pass1` → `pass2` → `done`.
- Progress bar animates smoothly red.
- Download button appears on completion.

- [ ] **Step 4: Download**

Click Download. Expected: browser saves the file as `<original>.ready-for-manychat.mp4`, size ≤25MB. Open it and verify it plays.

- [ ] **Step 5: Refresh mid-encode**

Upload another video. Before it finishes, hit Ctrl+R / Cmd+R. Expected: the card reappears and progress continues updating — `/api/jobs` repopulates state, SSE reconnects.

- [ ] **Step 6: Verify retention sweep**

Wait 65 minutes, then run from the VPS:
```bash
ls /var/compress/outputs/
```

Expected: the finished job directory from Step 4 is gone. If this still lists the directory, check `journalctl -u compress | grep cleanup` to confirm the cron ran.

- [ ] **Step 7: Rotate the VPS credentials**

Since the root password was shared in chat during the brainstorming session, the earlier security note recommended changing it. After all the above works, on the VPS:
```bash
passwd root
```

Set a new password.

**Before disabling password auth, confirm your SSH public key is installed:**
```bash
cat /root/.ssh/authorized_keys
```
If this file is empty or missing, STOP — install your laptop's public key first:
```bash
# On the laptop:
ssh-copy-id root@194.233.69.204
# OR manually:
cat ~/.ssh/id_ed25519.pub | ssh root@194.233.69.204 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Test key-based login in a second terminal (`ssh root@194.233.69.204`) and confirm it succeeds without a password prompt. Only then disable password auth:
```bash
sed -i 's/#\?PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

Keep the current SSH session open until you have independently verified key-based login works — if the sed or restart goes wrong, you still have a route back in.

- [ ] **Step 8: Final commit**

```bash
git commit --allow-empty -m "chore(deploy): zenityx-compress live at https://compress.zenityx.com"
```

---

### Task 9.7: Full chunk 9 verification

- [ ] **Step 1: Health check**

From anywhere on the internet:
```bash
curl https://compress.zenityx.com/api/health
```

Expected: `{"ok":true,...}` over HTTPS.

- [ ] **Step 2: Service stability check**

```bash
ssh root@194.233.69.204 'systemctl status compress --no-pager | head -5'
```

Expected: `active (running)` with no restart in the last 5 minutes. (`ssh compress@...` does not work — the `compress` user has a `nologin` shell by design.)

- [ ] **Step 3: Summary**

At this point the full system is live:
- Admins browse to `https://compress.zenityx.com`.
- They log in with the shared password.
- They drop files, watch real-time progress, and download the compressed results.
- Files auto-delete after 1 hour.
- The service auto-restarts on crash via systemd and comes back on VPS reboot.

---

**End of Chunk 9.** All chunks complete. Implementation is live in production.
