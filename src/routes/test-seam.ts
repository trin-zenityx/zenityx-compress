import type { FastifyInstance } from "fastify";
import { requireLogin } from "../auth/require-login.js";

/**
 * Registers `POST /__test/whoami` (returns the current session's userId)
 * only when NODE_ENV === "test". Safe to call multiple times — guards
 * against re-registration.
 */
export function registerTestSeam(app: FastifyInstance): void {
  if (process.env.NODE_ENV !== "test") return;
  if (app.hasRoute({ method: "POST", url: "/__test/whoami" })) return;
  app.post("/__test/whoami", { preHandler: requireLogin }, async (req) => ({
    userId: req.session.get("userId"),
  }));
}
