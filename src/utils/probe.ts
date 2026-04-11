import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface ProbeResult {
  hasVideo: boolean;
  hasAudio: boolean;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

export class ProbeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ProbeError";
  }
}

interface FFProbeOutput {
  streams: Array<{
    codec_type: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
  }>;
  format: {
    duration?: string;
  };
}

function parseFrameRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split("/").map(Number);
  if (!den) return num ?? 0;
  return num / den;
}

export async function probeMedia(inputPath: string): Promise<ProbeResult> {
  let raw: string;
  try {
    const result = await execFileP("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      inputPath,
    ]);
    raw = result.stdout;
  } catch (err) {
    throw new ProbeError(`ffprobe failed for ${inputPath}`, err);
  }

  let parsed: FFProbeOutput;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ProbeError(`ffprobe returned invalid JSON for ${inputPath}`, err);
  }

  const videoStream = parsed.streams.find((s) => s.codec_type === "video");
  const audioStream = parsed.streams.find((s) => s.codec_type === "audio");

  if (!videoStream && !audioStream) {
    throw new ProbeError(`no video or audio streams in ${inputPath}`);
  }

  const durationSec = Number.parseFloat(parsed.format.duration ?? "0");
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new ProbeError(`invalid duration in ${inputPath}`);
  }

  const fps = parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate);
  if (videoStream && (fps <= 0 || !Number.isFinite(fps))) {
    throw new ProbeError(`invalid frame rate in ${inputPath}`);
  }

  return {
    hasVideo: !!videoStream,
    hasAudio: !!audioStream,
    durationSec,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
  };
}
