import type { Preset, MediaType } from "../presets/index.js";

export type JobState =
  | "queued"
  | "probing"
  | "pass1"    // video only
  | "pass2"    // video only
  | "encoding" // image only
  | "done"
  | "error";

export const JOB_STATES: readonly JobState[] = [
  "queued",
  "probing",
  "pass1",
  "pass2",
  "encoding",
  "done",
  "error",
] as const;

export interface Job {
  id: string;
  sessionId: string;
  type: MediaType;
  originalName: string;
  inputPath: string;
  outputPath: string;
  preset: Preset;
  customTargetMB?: number;
  createdAt: number;
  state: JobState;
  progress: number;       // 0..100
  error?: string;
  inputSize?: number;
  outputSize?: number;
}

export interface JobEvent {
  jobId: string;
  state: JobState;
  progress: number;
  outputSize?: number;
  downloadUrl?: string;
  error?: string;
  etaSeconds?: number;
  message?: string;
}

export function isVideoState(s: JobState): boolean {
  return s === "queued" || s === "probing" || s === "pass1" || s === "pass2";
}

export function isImageState(s: JobState): boolean {
  return s === "queued" || s === "probing" || s === "encoding";
}

export function isTerminalState(s: JobState): boolean {
  return s === "done" || s === "error";
}
