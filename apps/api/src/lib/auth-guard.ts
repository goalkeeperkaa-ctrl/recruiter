import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "../types/auth.js";

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const payload = await request.jwtVerify<{
      sub: string;
      tenantId: string;
      tenantSlug: string;
      role: UserRole;
    }>();

    request.auth = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      role: payload.role,
    };
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
}

export function requireRole(allowed: UserRole[]) {
  return async function checkRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.auth || !allowed.includes(request.auth.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
}
