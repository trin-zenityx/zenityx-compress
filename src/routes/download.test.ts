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
    q.update("j2", { state: "done", progress: 100, outputSize: 17 });

    const res = await app.inject({ method: "GET", url: "/api/download/j2", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/video\/mp4/);
    const disp = String(res.headers["content-disposition"]);
    expect(disp).toMatch(/filename\*=UTF-8''/);
    expect(disp).toMatch(/%E0%B8%8A/);
    expect(res.body).toBe("hello-video-bytes");
  });
});
