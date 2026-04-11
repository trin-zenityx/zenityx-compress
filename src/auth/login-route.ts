import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyPassword } from "./password.js";
import { nanoid } from "nanoid";
import fastifyRateLimit from "@fastify/rate-limit";

const loginBodySchema = z.object({
  password: z.string().min(1),
});

export interface AuthRoutesOptions {
  passwordHash: string;
  loginRateLimit: number;
  loginRateWindowMs: number;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  opts: AuthRoutesOptions,
): Promise<void> {
  // Register rate-limit plugin but don't apply it globally.
  await app.register(fastifyRateLimit, { global: false });

  app.post(
    "/api/login",
    {
      config: {
        rateLimit: {
          max: opts.loginRateLimit,
          timeWindow: opts.loginRateWindowMs,
          // Spec §8: 429 body shape = { error: "rate_limited", retryAfterSec: N }
          errorResponseBuilder: (_req: FastifyRequest, context: { after: string; ttl: number }) => ({
            statusCode: 429,
            error: "rate_limited",
            retryAfterSec: Math.ceil(context.ttl / 1000),
          }),
        },
      },
    },
    async (req, reply) => {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request" });
      }
      const { password } = parsed.data;

      const ok = await verifyPassword(password, opts.passwordHash);
      if (!ok) {
        return reply.code(401).send({ error: "invalid_password" });
      }

      req.session.set("userId", nanoid(12));
      req.session.set("loggedInAt", Math.floor(Date.now() / 1000));
      return reply.code(200).send({ ok: true });
    },
  );

  app.post("/api/logout", async (req, reply) => {
    req.session.delete();
    return reply.code(200).send({ ok: true });
  });
}
