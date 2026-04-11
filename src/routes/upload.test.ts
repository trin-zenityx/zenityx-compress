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
