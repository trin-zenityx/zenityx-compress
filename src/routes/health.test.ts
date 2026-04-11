import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoute } from "./health.js";

describe("GET /api/health", () => {
  let app: FastifyInstance;
  afterEach(async () => { await app.close(); });

  it("returns ok, version, uptime, and queueDepth", async () => {
    app = Fastify();
    await registerHealthRoute(app, { version: "0.1.0", queueDepth: () => 3 });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe("0.1.0");
    expect(typeof body.uptime).toBe("number");
    expect(body.queueDepth).toBe(3);
  });
});
