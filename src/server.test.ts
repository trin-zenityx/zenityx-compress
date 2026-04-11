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
