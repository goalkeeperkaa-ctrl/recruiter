import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { parseBootstrapInput, parseLoginInput } from "../repos/auth-repo.js";
import { verifyPassword } from "../lib/password.js";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/bootstrap", async (request, reply) => {
    try {
      const input = parseBootstrapInput(request.body);
      const result = await app.repos.auth.bootstrapTenantOwner(input);

      const token = await reply.jwtSign({
        sub: result.user.id,
        tenantId: result.user.tenantId,
        tenantSlug: result.user.tenantSlug,
        role: result.user.role,
      });

      return {
        token,
        tenant: result.tenant,
        user: {
          id: result.user.id,
          email: result.user.email,
          fullName: result.user.fullName,
          role: result.user.role,
        },
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "validation_error", details: error.flatten() });
      }

      return reply.code(409).send({ error: "bootstrap_failed" });
    }
  });

  app.post("/auth/login", async (request, reply) => {
    try {
      const input = parseLoginInput(request.body);
      const user = await app.repos.auth.findByCredentials(input);
      if (!user || !user.passwordHash) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      if (!user.isActive) {
        return reply.code(403).send({ error: "user_inactive" });
      }

      const token = await reply.jwtSign({
        sub: user.id,
        tenantId: user.tenantId,
        tenantSlug: user.tenantSlug,
        role: user.role,
      });

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "validation_error", details: error.flatten() });
      }

      return reply.code(500).send({ error: "login_failed" });
    }
  });
}
