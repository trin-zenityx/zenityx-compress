// tests/fixtures/generate.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const execFileP = promisify(execFile);

/**
 * Creates a short video with complex (mandelbrot) content and silent audio
 * at the given path. Default: 2 seconds, 320x240, 30fps, H.264. Mandelbrot
 * content is used instead of a solid color so that re-encoding with
 * preset=slow takes long enough for cancellation tests to reliably fire
 * their AbortSignal during pass1/pass2 instead of after the encoder exits.
 * The `color` option is ignored but kept for backward compatibility.
 */
export async function makeTinyVideo(
  outputPath: string,
  opts: { durationSec?: number; width?: number; height?: number; color?: string } = {},
): Promise<void> {
  const { durationSec = 2, width = 320, height = 240 } = opts;
  await execFileP("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", `mandelbrot=s=${width}x${height}:rate=30`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-shortest",
    "-t", String(durationSec),
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    outputPath,
  ]);
}

/**
 * Creates a PNG image of the given size with a solid color fill and optional
 * alpha channel, written to outputPath. Solid-color images compress extremely
 * well — use makeNoisyPng for tests that need to force downscaling.
 */
export async function makePng(
  outputPath: string,
  opts: { width: number; height: number; withAlpha?: boolean; color?: { r: number; g: number; b: number } } = {
    width: 100,
    height: 100,
  },
): Promise<void> {
  const {
    width,
    height,
    withAlpha = false,
    color = { r: 200, g: 50, b: 50 },
  } = opts;
  await sharp({
    create: {
      width,
      height,
      channels: withAlpha ? 4 : 3,
      background: withAlpha ? { ...color, alpha: 0.5 } : color,
    },
  })
    .png()
    .toFile(outputPath);
}

/**
 * Creates a PNG filled with pseudo-random noise — does NOT compress well
 * with JPEG, so tests can reliably force a downscale or an unreachable
 * target. Uses a deterministic LCG so fixtures are stable across runs.
 */
export async function makeNoisyPng(
  outputPath: string,
  opts: { width: number; height: number } = { width: 500, height: 500 },
): Promise<void> {
  const { width, height } = opts;
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  let seed = 0xc0ffee;
  for (let i = 0; i < buf.length; i++) {
    // Linear congruential generator — cheap, deterministic, non-crypto.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = seed & 0xff;
  }
  await sharp(buf, { raw: { width, height, channels } }).png().toFile(outputPath);
}

/**
 * Creates a JPEG image by first making a PNG and then converting, so the size
 * is deterministic for tests asserting "before" sizes.
 */
export async function makeJpeg(
  outputPath: string,
  opts: { width: number; height: number; quality?: number } = { width: 100, height: 100 },
): Promise<void> {
  const { width, height, quality = 85 } = opts;
  await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .jpeg({ quality })
    .toFile(outputPath);
}

/** Write arbitrary bytes — used to make intentionally invalid files. */
export async function makeInvalidFile(outputPath: string, contents: string = "not media"): Promise<void> {
  await writeFile(outputPath, contents);
}
