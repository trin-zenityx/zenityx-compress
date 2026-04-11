import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerSession } from "./session.js";
import { registerAuthRoutes } from "./login-route.js";
import { requireLogin } from "./require-login.js";
import { hashPassword } from "./password.js";

const SECRET = "a".repeat(64);

describe("requireLogin", () => {
  it("returns 401 when there is no session", async () => {
    const app = Fastify();
    await registerSession(app, SECRET);
    app.get("/secret", { preHandler: requireLogin }, async () => ({ ok: true }));

    const res = await app.inject({ method: "GET", url: "/secret" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "auth_required" });
    await app.close();
  });

  it("passes through when a userId is set on the session", async () => {
    const hash = await hashPassword("hunter2");
    const app = Fastify();
    await registerSession(app, SECRET);
    await registerAuthRoutes(app, {
      passwordHash: hash,
      loginRateLimit: 100,
      loginRateWindowMs: 60_000,
    });
    app.get("/secret", { preHandler: requireLogin }, async () => ({ ok: true }));

    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { password: "hunter2" },
    });
    const cookie = login.headers["set-cookie"] as string;

    const res = await app.inject({
      method: "GET",
      url: "/secret",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
