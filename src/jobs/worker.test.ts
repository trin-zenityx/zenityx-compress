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

    await new Promise((r) => setTimeout(r, 800));
    expect(worker.cancel("j6")).toBe(true);
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
