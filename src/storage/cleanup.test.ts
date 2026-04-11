import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, utimes, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepExpired } from "./cleanup.js";

describe("sweepExpired", () => {
  let root: string;
  let uploads: string;
  let outputs: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "zx-cleanup-"));
    uploads = join(root, "uploads");
    outputs = join(root, "outputs");
    await mkdir(uploads, { recursive: true });
    await mkdir(outputs, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function makeJobDir(parent: string, id: string, ageMs: number): Promise<string> {
    const dir = join(parent, id);
    await mkdir(dir);
    await writeFile(join(dir, "file.dat"), "bytes");
    const when = new Date(Date.now() - ageMs);
    await utimes(dir, when, when);
    await utimes(join(dir, "file.dat"), when, when);
    return dir;
  }

  it("unlinks outputs older than retentionHours", async () => {
    await makeJobDir(outputs, "old", 2 * 3600 * 1000);
    await makeJobDir(outputs, "fresh", 10 * 60 * 1000);
    await sweepExpired({ uploadsDir: uploads, outputsDir: outputs, retentionHours: 1, orphanUploadsMinutes: 30 });
    const remaining = await readdir(outputs);
    expect(remaining).toEqual(["fresh"]);
  });

  it("unlinks uploads older than orphanUploadsMinutes", async () => {
    await makeJobDir(uploads, "abandoned", 60 * 60 * 1000);
    await makeJobDir(uploads, "recent", 5 * 60 * 1000);
    await sweepExpired({ uploadsDir: uploads, outputsDir: outputs, retentionHours: 1, orphanUploadsMinutes: 30 });
    const remaining = await readdir(uploads);
    expect(remaining).toEqual(["recent"]);
  });

  it("is a no-op when directories are empty", async () => {
    await sweepExpired({ uploadsDir: uploads, outputsDir: outputs, retentionHours: 1, orphanUploadsMinutes: 30 });
    expect(await readdir(uploads)).toEqual([]);
    expect(await readdir(outputs)).toEqual([]);
  });

  it("ignores missing directories without throwing", async () => {
    await sweepExpired({
      uploadsDir: join(root, "nope-uploads"),
      outputsDir: join(root, "nope-outputs"),
      retentionHours: 1,
      orphanUploadsMinutes: 30,
    });
    expect(true).toBe(true);
  });
});
