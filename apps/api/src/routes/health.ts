import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "recruitflow-api",
      ts: new Date().toISOString(),
    };
  });

  app.get("/ready", async () => {
    return {
      status: "ready",
      checks: {
        api: true,
      },
    };
  });
}
