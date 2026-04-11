import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashPassword returns a bcrypt hash starting with $2b$", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash.startsWith("$2b$")).toBe(true);
    expect(hash.length).toBeGreaterThan(50);
  });

  it("verifyPassword returns true for matching password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("verifyPassword returns false for non-matching password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("verifyPassword returns false for malformed hash without throwing", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});
