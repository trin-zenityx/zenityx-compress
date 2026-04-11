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
    const sharp = (await import("sharp")).default;
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.hasAlpha).toBe(false);
  });

  it("emits progress updates that end at 100 and never exceed bounds", async () => {
    const out = join(fixtureDir, "noisy-progress.jpg");
    const events: number[] = [];
    await compressImage(noisyPng, out, 40_000, (p) => events.push(p));
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]).toBe(100);
    for (const p of events) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("downscales when quality loop cannot meet the target at full resolution", async () => {
    const out = join(fixtureDir, "noisy-down.jpg");
    const tinyLimit = 15_000;
    const result = await compressImage(noisyPng, out, tinyLimit, () => {});
    expect(result.scale).toBeLessThan(1);
    expect(result.outputSize).toBeLessThanOrEqual(tinyLimit);
  });

  it("throws ImageJobError when no combination of quality and scale fits", async () => {
    const out = join(fixtureDir, "impossible.jpg");
    await expect(compressImage(noisyPng, out, 300, () => {})).rejects.toThrow(ImageJobError);
  });

  it("throws ImageJobError when the input is not a readable image", async () => {
    const out = join(fixtureDir, "bad-out.jpg");
    await expect(compressImage(invalid, out, 5 * 1024 * 1024, () => {})).rejects.toThrow(ImageJobError);
  });
});
