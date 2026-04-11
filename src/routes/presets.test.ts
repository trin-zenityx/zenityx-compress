import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSession } from "../auth/session.js";
import { registerAuthRoutes } from "../auth/login-route.js";
import { registerPresetRoutes } from "./presets.js";
import { hashPassword } from "../auth/password.js";

const SECRET = "a".repeat(64);

describe("GET /api/presets", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    const hash = await hashPassword("pw");
    app = Fastify();
    await registerSession(app, SECRET);
    await registerAuthRoutes(app, { passwordHash: hash, loginRateLimit: 100, loginRateWindowMs: 60_000 });
    await registerPresetRoutes(app);
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
    cookie = login.headers["set-cookie"] as string;
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 401 when not logged in", async () => {
    const res = await app.inject({ method: "GET", url: "/api/presets" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the manychat preset when logged in", async () => {
    const res = await app.inject({ method: "GET", url: "/api/presets", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { presets: Array<{ id: string; videoMaxMB: number; imageMaxMB: number; default?: boolean }> };
    expect(body.presets).toHaveLength(1);
    expect(body.presets[0]).toMatchObject({ id: "manychat", videoMaxMB: 25, imageMaxMB: 5, default: true });
  });
});
