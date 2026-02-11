import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../lib/auth-guard.js";
import { hmacSha256Hex } from "../lib/hmac.js";

const writeRoles = ["owner", "admin_hr", "recruiter"] as const;

interface OutboxRouteDeps {
  webhookTargetUrl?: string;
  webhookSecret: string;
  cronDispatchSecret?: string;
}

export async function registerOutboxRoutes(app: FastifyInstance, deps: OutboxRouteDeps): Promise<void> {
  app.get("/internal/outbox/pending", { preHandler: [requireAuth, requireRole([...writeRoles])] }, async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 100);
    const items = await app.repos.outbox.listPending(Number.isNaN(limit) ? 100 : limit);
    return { items };
  });

  app.post("/internal/outbox/dispatch", async (request, reply) => {
    const cronSecretHeader = request.headers["x-cron-secret"];
    const cronAuthorized =
      typeof cronSecretHeader === "string" &&
      !!deps.cronDispatchSecret &&
      cronSecretHeader === deps.cronDispatchSecret;

    if (!cronAuthorized) {
      await requireAuth(request, reply);
      if (reply.sent) {
        return;
      }

      const roleGuard = requireRole([...writeRoles]);
      await roleGuard(request, reply);
      if (reply.sent) {
        return;
      }
    }

    if (!deps.webhookTargetUrl) {
      return reply.code(503).send({ error: "webhook_target_not_configured" });
    }

    const due = await app.repos.outbox.listDue(new Date(), 20);
    let sent = 0;
    let retried = 0;

    for (const item of due) {
      const body = JSON.stringify({
        event_id: item.id,
        event_type: item.eventType,
        occurred_at: new Date().toISOString(),
        data: item.payload,
      });

      const signature = hmacSha256Hex(deps.webhookSecret, body);

      try {
        const response = await fetch(deps.webhookTargetUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-event-id": item.id,
            "x-signature": signature,
          },
          body,
        });

        if (response.ok) {
          await app.repos.outbox.markSent(item.id);
          sent += 1;
        } else {
          await app.repos.outbox.markRetry(item.id, `http_${response.status}`);
          retried += 1;
        }
      } catch (error) {
        await app.repos.outbox.markRetry(item.id, error instanceof Error ? error.message : "dispatch_failed");
        retried += 1;
      }
    }

    return {
      due: due.length,
      sent,
      retried,
    };
  });
}
