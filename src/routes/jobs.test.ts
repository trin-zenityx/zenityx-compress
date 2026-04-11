import { describe, it, expect, afterEach } from "vitest";
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
