import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const baseEnv = {
  NODE_ENV: "test",
  PORT: "4100",
  HOST: "127.0.0.1",
  AUTH_PASSWORD_HASH: "$2b$12$dummyhashdummyhashdummyhashdummyhashdumm",
  SESSION_SECRET: "a".repeat(64),
  UPLOAD_DIR: "/tmp/test-uploads",
  OUTPUT_DIR: "/tmp/test-outputs",
  RETENTION_HOURS: "1",
  MAX_UPLOAD_MB: "500",
  WORKER_CONCURRENCY: "2",
  WORKER_TIMEOUT_MS: "900000",
  QUEUE_MAX: "20",
  LOGIN_RATE_LIMIT: "10",
  LOGIN_RATE_WINDOW_MS: "900000",
};

describe("loadConfig", () => {
  it("parses a valid env into a typed config", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.port).toBe(4100);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.sessionSecret).toHaveLength(64);
    expect(cfg.retentionHours).toBe(1);
    expect(cfg.maxUploadMB).toBe(500);
    expect(cfg.workerConcurrency).toBe(2);
    expect(cfg.queueMax).toBe(20);
  });

  it("throws when SESSION_SECRET is too short", () => {
    const bad = { ...baseEnv, SESSION_SECRET: "short" };
    expect(() => loadConfig(bad)).toThrow(/SESSION_SECRET/);
  });

  it("throws when AUTH_PASSWORD_HASH is empty", () => {
    const bad = { ...baseEnv, AUTH_PASSWORD_HASH: "" };
    expect(() => loadConfig(bad)).toThrow(/AUTH_PASSWORD_HASH/);
  });

  it("coerces numeric fields from strings", () => {
    const cfg = loadConfig({ ...baseEnv, PORT: "8080" });
    expect(cfg.port).toBe(8080);
    expect(typeof cfg.port).toBe("number");
  });
});
