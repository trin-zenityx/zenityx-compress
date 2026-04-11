import { describe, it, expect } from "vitest";
import { isVideoState, isImageState, isTerminalState, JOB_STATES } from "./types.js";

describe("job state helpers", () => {
  it("JOB_STATES exports the full list", () => {
    expect(JOB_STATES).toContain("queued");
    expect(JOB_STATES).toContain("probing");
    expect(JOB_STATES).toContain("pass1");
    expect(JOB_STATES).toContain("pass2");
    expect(JOB_STATES).toContain("encoding");
    expect(JOB_STATES).toContain("done");
    expect(JOB_STATES).toContain("error");
  });

  it("isVideoState is true for pass1, pass2, and shared probing/queued", () => {
    expect(isVideoState("pass1")).toBe(true);
    expect(isVideoState("pass2")).toBe(true);
    expect(isVideoState("probing")).toBe(true);
    expect(isVideoState("queued")).toBe(true);
    expect(isVideoState("encoding")).toBe(false);
  });

  it("isImageState is true for encoding and shared probing/queued", () => {
    expect(isImageState("encoding")).toBe(true);
    expect(isImageState("probing")).toBe(true);
    expect(isImageState("queued")).toBe(true);
    expect(isImageState("pass1")).toBe(false);
    expect(isImageState("pass2")).toBe(false);
  });

  it("isTerminalState is true for done and error only", () => {
    expect(isTerminalState("done")).toBe(true);
    expect(isTerminalState("error")).toBe(true);
    expect(isTerminalState("pass1")).toBe(false);
    expect(isTerminalState("queued")).toBe(false);
  });
});
