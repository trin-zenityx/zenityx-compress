export class BitrateError extends Error {
  constructor(
    public readonly code:
      | "VIDEO_TOO_LONG_FOR_TARGET"
      | "INVALID_DURATION"
      | "INVALID_TARGET",
    message: string,
  ) {
    super(message);
    this.name = "BitrateError";
  }
}

const SAFETY_MARGIN = 0.93;
const MIN_VIDEO_KBPS = 500;

/**
 * Compute the video bitrate (kbps) that will produce an output file of
 * roughly targetMB when encoded with the given audio bitrate. Uses a
 * 93% safety margin because ffmpeg 2-pass typically lands within ±3%
 * of target; the extra 4% keeps us under the ceiling.
 */
export function calcVideoBitrate(
  durationSec: number,
  targetMB: number,
  audioKbps: number = 128,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new BitrateError("INVALID_DURATION", `Invalid duration: ${durationSec}`);
  }
  if (!Number.isFinite(targetMB) || targetMB <= 0) {
    throw new BitrateError("INVALID_TARGET", `Invalid target: ${targetMB}`);
  }

  const targetBits = targetMB * 1024 * 1024 * 8;
  const totalKbps = Math.floor((targetBits * SAFETY_MARGIN) / durationSec / 1000);
  const videoKbps = totalKbps - audioKbps;

  if (videoKbps < MIN_VIDEO_KBPS) {
    throw new BitrateError(
      "VIDEO_TOO_LONG_FOR_TARGET",
      `วีดีโอยาว ${durationSec.toFixed(1)}s เกินไปสำหรับเป้า ${targetMB}MB (ได้ ${videoKbps} kbps, ต้องการอย่างน้อย ${MIN_VIDEO_KBPS})`,
    );
  }

  return videoKbps;
}
