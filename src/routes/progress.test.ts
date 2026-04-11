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
