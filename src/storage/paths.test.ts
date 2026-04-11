import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newJobId,
  uploadPathFor,
  outputPathFor,
  ensureJobUploadDir,
  ensureJobOutputDir,
  removeJobUploadDir,
  removeJobOutputDir,
  outputFilenameFor,
} from "./paths.js";

describe("paths", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "zx-test-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("newJobId returns a 10-char nanoid string", () => {
    const id = newJobId();
    expect(id).toHaveLength(10);
    expect(/^[A-Za-z0-9_-]{10}$/.test(id)).toBe(true);
  });

  it("uploadPathFor composes dir, jobId, and filename", () => {
    const p = uploadPathFor(base, "abc123xyz0", "clip.mp4");
    expect(p).toBe(join(base, "abc123xyz0", "clip.mp4"));
  });

  it("outputPathFor composes dir, jobId, and filename", () => {
    const p = outputPathFor(base, "abc123xyz0", "clip.ready-for-manychat.mp4");
    expect(p).toBe(join(base, "abc123xyz0", "clip.ready-for-manychat.mp4"));
  });

  it("ensureJobUploadDir creates the job directory", async () => {
    const dir = await ensureJobUploadDir(base, "job1");
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
  });

  it("removeJobUploadDir deletes the directory recursively", async () => {
    const dir = await ensureJobUploadDir(base, "job2");
    await removeJobUploadDir(base, "job2");
    await expect(stat(dir)).rejects.toThrow();
  });

  it("ensureJobOutputDir creates the output job directory", async () => {
    const dir = await ensureJobOutputDir(base, "job3");
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
  });

  it("removeJobOutputDir deletes the output directory recursively", async () => {
    const dir = await ensureJobOutputDir(base, "job4");
    await removeJobOutputDir(base, "job4");
    await expect(stat(dir)).rejects.toThrow();
  });

  it("outputFilenameFor inserts preset id as suffix before extension", () => {
    expect(outputFilenameFor("clip.mp4", "manychat")).toBe("clip.ready-for-manychat.mp4");
    expect(outputFilenameFor("image.PNG", "manychat")).toBe("image.ready-for-manychat.jpg");
    expect(outputFilenameFor("ชื่อไทย.mp4", "manychat")).toBe("ชื่อไทย.ready-for-manychat.mp4");
    expect(outputFilenameFor("no-ext", "manychat")).toBe("no-ext.ready-for-manychat");
  });

  it("outputFilenameFor uses custom-<MB> when preset is custom", () => {
    expect(outputFilenameFor("clip.mp4", "custom", 24)).toBe("clip.ready-for-24mb.mp4");
  });

  it("outputFilenameFor converts PNG/WebP/HEIC source to .jpg", () => {
    expect(outputFilenameFor("logo.png", "manychat")).toBe("logo.ready-for-manychat.jpg");
    expect(outputFilenameFor("photo.webp", "manychat")).toBe("photo.ready-for-manychat.jpg");
    expect(outputFilenameFor("pic.jpeg", "manychat")).toBe("pic.ready-for-manychat.jpg");
    expect(outputFilenameFor("shot.heic", "manychat")).toBe("shot.ready-for-manychat.jpg");
    expect(outputFilenameFor("shot.HEIF", "manychat")).toBe("shot.ready-for-manychat.jpg");
  });
});
