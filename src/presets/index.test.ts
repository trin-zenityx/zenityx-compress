import { describe, it, expect } from "vitest";
import {
  PRESETS,
  getPreset,
  resolveTargetMB,
  customPresetSchema,
  UnknownPresetError,
} from "./index.js";

describe("presets", () => {
  it("PRESETS includes manychat as the default", () => {
    expect(PRESETS.manychat).toBeDefined();
    expect(PRESETS.manychat.name).toBe("ManyChat");
    expect(PRESETS.manychat.videoMaxMB).toBe(25);
    expect(PRESETS.manychat.imageMaxMB).toBe(5);
  });

  it("getPreset returns the manychat preset by id", () => {
    const p = getPreset("manychat");
    expect(p.id).toBe("manychat");
  });

  it("getPreset throws UnknownPresetError on unknown id", () => {
    expect(() => getPreset("unknown")).toThrow(UnknownPresetError);
  });

  it("resolveTargetMB returns video limit for video type", () => {
    const p = getPreset("manychat");
    expect(resolveTargetMB(p, "video")).toBe(25);
  });

  it("resolveTargetMB returns image limit for image type", () => {
    const p = getPreset("manychat");
    expect(resolveTargetMB(p, "image")).toBe(5);
  });

  it("customPresetSchema accepts a valid MB value", () => {
    expect(customPresetSchema.parse({ targetMB: 24 })).toEqual({ targetMB: 24 });
  });

  it("customPresetSchema rejects values outside 1..500", () => {
    expect(() => customPresetSchema.parse({ targetMB: 0 })).toThrow();
    expect(() => customPresetSchema.parse({ targetMB: 501 })).toThrow();
    expect(() => customPresetSchema.parse({ targetMB: -5 })).toThrow();
  });

  it("customPresetSchema coerces string numbers", () => {
    expect(customPresetSchema.parse({ targetMB: "24" })).toEqual({ targetMB: 24 });
  });
});
