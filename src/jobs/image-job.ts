import sharp from "sharp";
import { stat } from "node:fs/promises";

export class ImageJobError extends Error {
  constructor(
    public readonly code: "SHARP_FAILED" | "IMAGE_TOO_LARGE_AT_Q50" | "CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "ImageJobError";
  }
}

export interface CompressImageResult {
  outputSize: number;
  quality: number;
  scale: number;
}

export interface CompressImageOptions {
  signal?: AbortSignal;
}

const SCALES: readonly number[] = [1.0, 0.85, 0.7, 0.55, 0.4, 0.25];
const QUALITIES: readonly number[] = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50];

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ImageJobError("CANCELLED", "image job cancelled");
  }
}

export async function compressImage(
  inputPath: string,
  outputPath: string,
  maxBytes: number,
  onProgress: (percent: number) => void,
  opts: CompressImageOptions = {},
): Promise<CompressImageResult> {
  throwIfAborted(opts.signal);

  let width: number;
  let height: number;
  try {
    const meta = await sharp(inputPath).metadata();
    if (!meta.width || !meta.height) {
      throw new Error("missing dimensions");
    }
    width = meta.width;
    height = meta.height;
  } catch (err) {
    throw new ImageJobError("SHARP_FAILED", `cannot read image: ${(err as Error).message}`);
  }

  const total = SCALES.length * QUALITIES.length;
  let attempt = 0;

  for (const scale of SCALES) {
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    for (const quality of QUALITIES) {
      throwIfAborted(opts.signal);
      attempt += 1;
      onProgress(Math.floor((attempt / total) * 100));

      try {
        await sharp(inputPath)
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .resize(targetW, targetH, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality, mozjpeg: true })
          .toFile(outputPath);
      } catch (err) {
        throw new ImageJobError("SHARP_FAILED", `encode failed: ${(err as Error).message}`);
      }

      const { size } = await stat(outputPath);
      if (size <= maxBytes) {
        onProgress(100);
        return { outputSize: size, quality, scale };
      }
    }
  }

  throw new ImageJobError(
    "IMAGE_TOO_LARGE_AT_Q50",
    `cannot reduce ${inputPath} to ${maxBytes} bytes even at min quality and scale`,
  );
}
