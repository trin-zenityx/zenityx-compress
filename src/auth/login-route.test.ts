import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSession } from "./session.js";
import { registerAuthRoutes } from "./login-route.js";
import { hashPassword } from "./password.js";

const SECRET = "a".repeat(64);

async function buildApp(hash: string): Promise<FastifyInstance> {
  const app = Fastify();
  await registerSession(app, SECRET);
  await registerAuthRoutes(app, {
    passwordHash: hash,
    loginRateLimit: 100,
    loginRateWindowMs: 60_000,
  });
  return app;
}

describe("auth routes", () => {
  let app: FastifyInstance;
  let hash: string;

  beforeEach(async () => {
    hash = await hashPassword("hunter2");
    app = await buildApp(hash);
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /api/login with correct password returns 200 + sets cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "hunter2" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("POST /api/login with wrong password returns 401 invalid_password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "invalid_password" });
  });

  it("POST /api/login with missing password returns 400 bad_request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_request" });
  });

  it("POST /api/logout clears the session cookie", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "hunter2" },
    });
    const cookie = login.headers["set-cookie"] as string;

    const res = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers["set-cookie"]).toBeDefined();
  });
});

describe("login rate limit", () => {
  let rlApp: FastifyInstance;

  beforeEach(async () => {
    const h = await hashPassword("hunter2");
    rlApp = Fastify();
    await registerSession(rlApp, SECRET);
    await registerAuthRoutes(rlApp, {
      passwordHash: h,
      loginRateLimit: 3,      // tiny limit for test
      loginRateWindowMs: 60_000,
    });
  });

  afterEach(async () => {
    await rlApp.close();
  });

  it("returns 429 rate_limited with retryAfterSec after exceeding limit", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await rlApp.inject({
        method: "POST",
        url: "/api/login",
        payload: { password: "wrong" },
        remoteAddress: "10.0.0.1",
      });
      expect(r.statusCode).toBe(401);
    }

    const blocked = await rlApp.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "wrong" },
      remoteAddress: "10.0.0.1",
    });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json();
    expect(body.error).toBe("rate_limited");
    expect(typeof body.retryAfterSec).toBe("number");
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(body.retryAfterSec).toBeLessThanOrEqual(60);
  });
});
