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
