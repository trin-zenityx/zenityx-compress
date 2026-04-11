import { describe, it, expect } from "vitest";
import { logger } from "./logger.js";

describe("logger", () => {
  it("exports a pino instance with info level", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("creates child loggers with bindings", () => {
    const child = logger.child({ reqId: "abc" });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });
});
