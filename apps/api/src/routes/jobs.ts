import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { requireAuth, requireRole } from "../lib/auth-guard.js";
import { parseCreateJobInput, parseUpdateJobInput } from "../repos/jobs-repo.js";

const writeRoles = ["owner", "admin_hr", "recruiter"] as const;

export async function registerJobsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/jobs", { preHandler: [requireAuth] }, async (request, reply) => {
    const jobs = await app.repos.jobs.list(request.auth!.tenantId);
    return reply.send({ items: jobs });
  });

  app.post(
    "/jobs",
    { preHandler: [requireAuth, requireRole([...writeRoles])] },
    async (request, reply) => {
      try {
        const input = parseCreateJobInput(request.body);
        const created = await app.repos.jobs.create(request.auth!.tenantId, request.auth!.userId, input);
        return reply.code(201).send(created);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send({ error: "validation_error", details: error.flatten() });
        }

        return reply.code(409).send({ error: "job_create_failed" });
      }
    },
  );

  app.get("/jobs/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = request.params as { id: string };
    const job = await app.repos.jobs.findById(request.auth!.tenantId, params.id);

    if (!job) {
      return reply.code(404).send({ error: "not_found" });
    }

    return reply.send(job);
  });

  app.patch(
    "/jobs/:id",
    { preHandler: [requireAuth, requireRole([...writeRoles])] },
    async (request, reply) => {
      try {
        const params = request.params as { id: string };
        const patch = parseUpdateJobInput(request.body);
        const job = await app.repos.jobs.update(request.auth!.tenantId, params.id, patch);

        if (!job) {
          return reply.code(404).send({ error: "not_found" });
        }

        return reply.send(job);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send({ error: "validation_error", details: error.flatten() });
        }

        return reply.code(500).send({ error: "job_update_failed" });
      }
    },
  );

  app.get("/public/:tenantSlug/jobs/:publicSlug", async (request, reply) => {
    const params = request.params as { tenantSlug: string; publicSlug: string };
    const job = await app.repos.jobs.findPublic(params.tenantSlug, params.publicSlug);

    if (!job || job.status !== "active") {
      return reply.code(404).send({ error: "not_found" });
    }

    return reply.send({
      tenantSlug: job.tenantSlug,
      publicSlug: job.publicSlug,
      title: job.title,
      descriptionShort: job.descriptionShort,
      status: job.status,
    });
  });
}
