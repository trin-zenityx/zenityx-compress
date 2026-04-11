import type { FastifyInstance } from "fastify";
import { requireLogin } from "../auth/require-login.js";
import { PRESETS } from "../presets/index.js";

export async function registerPresetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/presets", { preHandler: requireLogin }, async () => {
    return { presets: Object.values(PRESETS) };
  });
}
