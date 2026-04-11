import { mkdir, rm } from "node:fs/promises";
import { join, parse } from "node:path";
import { customAlphabet } from "nanoid";

const nanoid10 = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",
  10,
);

export function newJobId(): string {
  return nanoid10();
}

export function uploadPathFor(uploadDir: string, jobId: string, filename: string): string {
  return join(uploadDir, jobId, filename);
}

export function outputPathFor(outputDir: string, jobId: string, filename: string): string {
  return join(outputDir, jobId, filename);
}

export async function ensureJobUploadDir(uploadDir: string, jobId: string): Promise<string> {
  const dir = join(uploadDir, jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureJobOutputDir(outputDir: string, jobId: string): Promise<string> {
  const dir = join(outputDir, jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeJobUploadDir(uploadDir: string, jobId: string): Promise<void> {
  await rm(join(uploadDir, jobId), { recursive: true, force: true });
}

export async function removeJobOutputDir(outputDir: string, jobId: string): Promise<void> {
  await rm(join(outputDir, jobId), { recursive: true, force: true });
}

/**
 * Builds the download filename:
 *   clip.mp4  +  "manychat"        → clip.ready-for-manychat.mp4
 *   logo.png  +  "manychat"        → logo.ready-for-manychat.jpg  (images normalize to .jpg)
 *   clip.mp4  +  "custom" + 24     → clip.ready-for-24mb.mp4
 */
export function outputFilenameFor(
  originalName: string,
  presetId: string,
  customTargetMB?: number,
): string {
  const parsed = parse(originalName);
  const ext = parsed.ext.toLowerCase();
  const isImageExt = [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"].includes(ext);
  const finalExt = isImageExt ? ".jpg" : ext;

  const suffix =
    presetId === "custom" && customTargetMB !== undefined
      ? `ready-for-${customTargetMB}mb`
      : `ready-for-${presetId}`;

  return `${parsed.name}.${suffix}${finalExt}`;
}
