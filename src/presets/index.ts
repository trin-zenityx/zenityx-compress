import { z } from "zod";

export type MediaType = "video" | "image";

export interface Preset {
  id: string;
  name: string;
  videoMaxMB: number;
  imageMaxMB: number;
  default?: boolean;
}

export const PRESETS: Record<string, Preset> = {
  manychat: {
    id: "manychat",
    name: "ManyChat",
    videoMaxMB: 25,
    imageMaxMB: 5,
    default: true,
  },
};

export class UnknownPresetError extends Error {
  constructor(presetId: string) {
    super(`Unknown preset: ${presetId}`);
    this.name = "UnknownPresetError";
  }
}

export function getPreset(presetId: string): Preset {
  const preset = PRESETS[presetId];
  if (!preset) {
    throw new UnknownPresetError(presetId);
  }
  return preset;
}

export function resolveTargetMB(preset: Preset, type: MediaType): number {
  return type === "video" ? preset.videoMaxMB : preset.imageMaxMB;
}

export const customPresetSchema = z.object({
  targetMB: z.coerce.number().int().min(1).max(500),
});

export type CustomPresetInput = z.infer<typeof customPresetSchema>;
