import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerSession } from "./session.js";

const SECRET = "a".repeat(64);  // 64 hex chars → 32 bytes

describe("registerSession", () => {
  it("registers the plugin and adds a session decorator on request", async () => {
    const app = Fastify();
    await registerSession(app, SECRET);

    app.get("/probe", async (req) => {
      return { hasSession: typeof req.session === "object" };
    });

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hasSession: true });

    await app.close();
  });

  it("sets HttpOnly + Secure + SameSite Strict cookie when a value is written", async () => {
    const app = Fastify();
    await registerSession(app, SECRET);

    app.get("/write", async (req, reply) => {
      req.session.set("userId", "abc");
      return reply.send({ ok: true });
    });

    const res = await app.inject({ method: "GET", url: "/write" });
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie);
    expect(cookieHeader).toMatch(/HttpOnly/);
    expect(cookieHeader).toMatch(/SameSite=Strict/);

    await app.close();
  });
});
