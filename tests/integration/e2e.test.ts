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
    const loginRes = await request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "e2e-pass" }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = (loginRes.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    expect(cookie).toMatch(/^zx_session=/);

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

    const dlRes = await request(`/api/download/${jobId}`, {
      method: "GET",
      headers: { cookie },
    });
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers["content-type"]).toMatch(/video\/mp4/);
    expect(dlRes.headers["content-disposition"]).toMatch(/filename\*=UTF-8''/);
    expect(dlRes.body.length).toBeGreaterThan(0);

    const delRes = await request(`/api/jobs/${jobId}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(delRes.status).toBe(200);

    const dl2 = await request(`/api/download/${jobId}`, {
      method: "GET",
      headers: { cookie },
    });
    expect(dl2.status).toBe(404);
  }, 120_000);
});
