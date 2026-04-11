import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Fastify preHandler that rejects requests without a logged-in session.
 *
 * Contract: if there is no userId on the session, this calls reply.send()
 * with a 401 body and returns. Fastify short-circuits further handlers
 * once a reply has been sent, so callers never run if this rejects.
 */
export async function requireLogin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = req.session.get("userId");
  if (!userId) {
    await reply.code(401).send({ error: "auth_required" });
    return;
  }
}
