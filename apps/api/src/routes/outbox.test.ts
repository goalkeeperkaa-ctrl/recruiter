import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../server.js";
import { MemoryAuthRepo, MemoryJobsRepo } from "../repos/memory-repos.js";
import { MemoryFlowRunnerRepo } from "../repos/memory-flow-runner-repo.js";
import { MemoryOutboxRepo } from "../repos/memory-outbox-repo.js";

test("outbox dispatch sends due events and marks them sent", async () => {
  const jobs = new MemoryJobsRepo();
  const app = await buildApp({
    env: {
      NODE_ENV: "test",
      PORT: 8080,
      JWT_SECRET: "test-secret-123",
      WEBHOOK_SECRET: "test-webhook-secret",
      WEBHOOK_TARGET_URL: "https://example.test/webhook",
      CRON_DISPATCH_SECRET: "test-cron-secret",
      DATABASE_URL: undefined,
    },
    repos: {
      auth: new MemoryAuthRepo(),
      jobs,
      flowRunner: new MemoryFlowRunnerRepo(jobs),
      outbox: new MemoryOutboxRepo(),
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const bootstrap = await app.inject({
      method: "POST",
      url: "/auth/bootstrap",
      payload: {
        tenantName: "Acme",
        tenantSlug: "acme",
        email: "owner@acme.test",
        fullName: "Owner",
        password: "password123",
      },
    });

    const token = (bootstrap.json() as { token: string }).token;

    await app.inject({
      method: "POST",
      url: "/jobs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Оператор",
        status: "active",
        workFormat: "remote",
        employmentType: "full_time",
        publicSlug: "operator",
      },
    });

    const start = await app.inject({
      method: "POST",
      url: "/public/acme/jobs/operator/flow/start",
      payload: { candidate: { fullName: "Иван" } },
    });
    const appId = (start.json() as { applicationId: string }).applicationId;

    await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/save`,
      payload: {
        nodeKey: "screening",
        answers: [{ questionId: "q_city", questionText: "Город", value: "MSK" }],
      },
    });

    await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/save`,
      payload: {
        nodeKey: "form",
        answers: [
          { questionId: "full_name", questionText: "Имя", value: "Иван Иванов" },
          { questionId: "phone", questionText: "Телефон", value: "+79990000000" },
        ],
      },
    });

    await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/save`,
      payload: {
        nodeKey: "consent",
        answers: [{ questionId: "consent_accepted", questionText: "Согласие", value: true }],
      },
    });

    const submit = await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/submit`,
    });
    assert.equal(submit.statusCode, 200);

    const pendingBefore = await app.inject({
      method: "GET",
      url: "/internal/outbox/pending",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(pendingBefore.statusCode, 200);
    assert.equal((pendingBefore.json() as { items: unknown[] }).items.length, 1);

    const dispatch = await app.inject({
      method: "POST",
      url: "/internal/outbox/dispatch",
      headers: { "x-cron-secret": "test-cron-secret" },
    });
    assert.equal(dispatch.statusCode, 200);
    const dispatchPayload = dispatch.json() as { sent: number };
    assert.equal(dispatchPayload.sent, 1);

    const pendingAfter = await app.inject({
      method: "GET",
      url: "/internal/outbox/pending",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(pendingAfter.statusCode, 200);
    assert.equal((pendingAfter.json() as { items: unknown[] }).items.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
