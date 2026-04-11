import { describe, it, expect } from "vitest";
import { calcVideoBitrate, BitrateError } from "./bitrate.js";

describe("calcVideoBitrate", () => {
  it("returns a positive integer kbps for a typical 60s / 25MB request", () => {
    const kbps = calcVideoBitrate(60, 25);
    expect(Number.isInteger(kbps)).toBe(true);
    expect(kbps).toBeGreaterThan(500);
    expect(kbps).toBeLessThan(4000);
  });

  it("applies the 93% safety margin", () => {
    // 60s, 25MB:
    // targetBits = 25 * 1024 * 1024 * 8 = 209,715,200
    // *0.93 = 195,035,136
    // /60 = 3,250,585 bits/s
    // /1000 = 3250.585 kbps total
    // - 128 (audio) = 3122.585 → floor → 3122
    const kbps = calcVideoBitrate(60, 25, 128);
    expect(kbps).toBe(3122);
  });

  it("uses default audio bitrate of 128 when not specified", () => {
    expect(calcVideoBitrate(60, 25)).toBe(calcVideoBitrate(60, 25, 128));
  });

  it("throws BitrateError when resulting video bitrate < 500", () => {
    // 600s (10min) @ 5MB → very low bitrate
    expect(() => calcVideoBitrate(600, 5)).toThrow(BitrateError);
  });

  it("throws with duration zero or negative", () => {
    expect(() => calcVideoBitrate(0, 25)).toThrow(BitrateError);
    expect(() => calcVideoBitrate(-1, 25)).toThrow(BitrateError);
  });

  it("throws with targetMB zero or negative", () => {
    expect(() => calcVideoBitrate(60, 0)).toThrow(BitrateError);
    expect(() => calcVideoBitrate(60, -10)).toThrow(BitrateError);
  });

  it("BitrateError has code VIDEO_TOO_LONG_FOR_TARGET when too long", () => {
    try {
      calcVideoBitrate(600, 5);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BitrateError);
      expect((err as BitrateError).code).toBe("VIDEO_TOO_LONG_FOR_TARGET");
    }
  });
});
