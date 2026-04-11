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
    expect(res.body).toContain('x-data="compressApp"');
    expect(res.body).toContain("ZenityX Media Compressor");
  });

  it("serves /app.js registering Alpine data component in alpine:init", async () => {
    const js = await server.app.inject({ method: "GET", url: "/app.js" });
    expect(js.statusCode).toBe(200);
    // Must register via official Alpine.data() pattern inside alpine:init,
    // not as a global function — global pattern races with defer script order.
    expect(js.body).toContain('addEventListener("alpine:init"');
    expect(js.body).toContain('Alpine.data("compressApp"');
    const css = await server.app.inject({ method: "GET", url: "/styles.css" });
    expect(css.statusCode).toBe(200);
    expect(css.body).toContain("--zx-red");
  });
});
