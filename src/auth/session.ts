import type { FastifyInstance } from "fastify";
import fastifySecureSession from "@fastify/secure-session";

/**
 * Registers @fastify/secure-session on the given Fastify instance.
 * Call once at startup.
 *
 * Key derivation: session secret is a 64-character hex string (32 bytes).
 * We decode it and pass the Buffer as the key option.
 */
export async function registerSession(app: FastifyInstance, sessionSecret: string): Promise<void> {
  const key = Buffer.from(sessionSecret, "hex");
  if (key.length < 32) {
    throw new Error("sessionSecret must decode to at least 32 bytes (64 hex chars)");
  }

  await app.register(fastifySecureSession, {
    key,
    cookieName: "zx_session",
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      // Secure is set automatically when served over HTTPS;
      // during local dev (http://localhost) Secure would break the cookie.
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24,  // 24 hours, in seconds
    },
  });
}

/**
 * Type helper — augments FastifyRequest session shape.
 * Consumers access req.session.get("userId") / .set("userId", "...")
 */
declare module "@fastify/secure-session" {
  interface SessionData {
    userId: string;      // we use a nanoid stored on login
    loggedInAt: number;  // unix seconds
  }
}
