import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { probeMedia, ProbeError } from "./probe.js";

const execFileP = promisify(execFile);

describe("probeMedia", () => {
  let fixtureDir: string;
  let videoPath: string;
  let notAMedia: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "zx-probe-"));
    videoPath = join(fixtureDir, "tiny.mp4");
    notAMedia = join(fixtureDir, "not-a-media.mp4");

    // Generate a 2-second 320x240 test pattern video with silent audio.
    await execFileP("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:d=2:r=30",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-shortest",
      "-c:v", "libx264", "-preset", "ultrafast",
      "-c:a", "aac",
      videoPath,
    ]);

    // A file with .mp4 extension but garbage bytes inside.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(notAMedia, "not a real media file");
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("returns typed metadata for a valid video", async () => {
    const result = await probeMedia(videoPath);
    expect(result.hasVideo).toBe(true);
    expect(result.hasAudio).toBe(true);
    expect(result.durationSec).toBeGreaterThan(1.8);
    expect(result.durationSec).toBeLessThan(2.2);
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.fps).toBeGreaterThan(29);
    expect(result.fps).toBeLessThan(31);
    expect(result.videoCodec).toBe("h264");
  });

  it("throws ProbeError on invalid media", async () => {
    await expect(probeMedia(notAMedia)).rejects.toThrow(ProbeError);
  });

  it("throws ProbeError on a path that does not exist", async () => {
    await expect(probeMedia("/nope/does-not-exist.mp4")).rejects.toThrow(ProbeError);
  });
});
