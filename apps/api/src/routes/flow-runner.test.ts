import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../server.js";
import { MemoryAuthRepo, MemoryJobsRepo } from "../repos/memory-repos.js";
import { MemoryFlowRunnerRepo } from "../repos/memory-flow-runner-repo.js";
import { MemoryOutboxRepo } from "../repos/memory-outbox-repo.js";

test("flow runner start/save/submit validates required and finalizes", async () => {
  const jobs = new MemoryJobsRepo();
  const app = await buildApp({
    env: {
      NODE_ENV: "test",
      PORT: 8080,
      JWT_SECRET: "test-secret-123",
      WEBHOOK_SECRET: "test-webhook-secret",
      DATABASE_URL: undefined,
    },
    repos: {
      auth: new MemoryAuthRepo(),
      jobs,
      flowRunner: new MemoryFlowRunnerRepo(jobs),
      outbox: new MemoryOutboxRepo(),
    },
  });

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
      payload: {
        candidate: {
          fullName: "Иван",
          phoneE164: "+79990000000",
          email: "ivan@example.com",
        },
      },
    });

    assert.equal(start.statusCode, 201);
    const appId = (start.json() as { applicationId: string }).applicationId;

    const failSubmit = await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/submit`,
    });

    assert.equal(failSubmit.statusCode, 422);
    const failPayload = failSubmit.json() as { missingRequired: string[] };
    assert.ok(failPayload.missingRequired.includes("consent_accepted"));

    await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/save`,
      payload: {
        nodeKey: "screening",
        answers: [
          {
            questionId: "q_city",
            questionText: "Ваш город/часовой пояс?",
            value: "MSK",
          },
        ],
      },
    });

    const formSave = await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/save`,
      payload: {
        nodeKey: "form",
        answers: [
          {
            questionId: "full_name",
            questionText: "Имя и фамилия",
            value: "Иван Иванов",
          },
          {
            questionId: "phone",
            questionText: "Телефон",
            value: "+79990000000",
          },
        ],
      },
    });
    assert.equal(formSave.statusCode, 200);
    const formPayload = formSave.json() as {
      currentNodeKey: string;
      currentNode: { key: string; type: string };
      nextNodeKey: string;
      nextNode: { key: string; type: string };
      currentStep: number;
      totalSteps: number;
    };
    assert.equal(formPayload.currentNodeKey, "form");
    assert.equal(formPayload.currentNode.key, "form");
    assert.equal(formPayload.nextNodeKey, "consent");
    assert.equal(formPayload.nextNode.key, "consent");
    assert.equal(formPayload.nextNode.type, "consent");
    assert.ok(formPayload.currentStep >= 1);
    assert.ok(formPayload.totalSteps >= formPayload.currentStep);

    const nextFromConsent = await app.inject({
      method: "GET",
      url: `/public/acme/jobs/operator/flow/${appId}/next/consent`,
    });
    assert.equal(nextFromConsent.statusCode, 200);
    const nextPayload = nextFromConsent.json() as {
      currentNodeKey: string;
      currentNode: { key: string; type: string };
      nextNodeKey: string;
      nextNode: { key: string; type: string };
      currentStep: number;
      totalSteps: number;
    };
    assert.equal(nextPayload.currentNodeKey, "consent");
    assert.equal(nextPayload.currentNode.key, "consent");
    assert.equal(nextPayload.nextNodeKey, "end_reject");
    assert.equal(nextPayload.nextNode.key, "end_reject");
    assert.equal(nextPayload.nextNode.type, "end");
    assert.ok(nextPayload.currentStep >= 1);
    assert.ok(nextPayload.totalSteps >= nextPayload.currentStep);

    const consentSave = await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/save`,
      payload: {
        nodeKey: "consent",
        answers: [
          {
            questionId: "consent_accepted",
            questionText: "Согласие",
            value: true,
          },
        ],
      },
    });
    assert.equal(consentSave.statusCode, 200);
    const consentPayload = consentSave.json() as {
      currentNodeKey: string;
      currentNode: { key: string; type: string };
      nextNodeKey: string;
      nextNode: { key: string; type: string };
      currentStep: number;
      totalSteps: number;
    };
    assert.equal(consentPayload.currentNodeKey, "consent");
    assert.equal(consentPayload.currentNode.key, "consent");
    assert.equal(consentPayload.nextNodeKey, "end_reject");
    assert.equal(consentPayload.nextNode.key, "end_reject");
    assert.ok(consentPayload.currentStep >= 1);
    assert.ok(consentPayload.totalSteps >= consentPayload.currentStep);

    const issueLink = await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/magic-link`,
      payload: {
        ttlDays: 7,
      },
    });

    assert.equal(issueLink.statusCode, 201);
    const linkPayload = issueLink.json() as { token: string; expiresAt: string };
    assert.ok(linkPayload.token);
    assert.ok(linkPayload.expiresAt);

    const resume = await app.inject({
      method: "GET",
      url: `/public/flow/resume/${linkPayload.token}`,
    });

    assert.equal(resume.statusCode, 200);
    const resumed = resume.json() as { applicationId: string };
    assert.equal(resumed.applicationId, appId);

    const submit = await app.inject({
      method: "POST",
      url: `/public/acme/jobs/operator/flow/${appId}/submit`,
    });

    assert.equal(submit.statusCode, 200);
    const payload = submit.json() as { submittedAt: string; scoreTotal: number; finalizedNow: boolean };
    assert.ok(payload.submittedAt);
    assert.equal(payload.scoreTotal, 5);
    assert.equal(payload.finalizedNow, true);

    const outboxPending = await app.inject({
      method: "GET",
      url: "/internal/outbox/pending",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(outboxPending.statusCode, 200);
    const outboxPayload = outboxPending.json() as {
      items: Array<{ eventType: string; payload: { application_id: string } }>;
    };
    assert.equal(outboxPayload.items.length, 1);
    assert.equal(outboxPayload.items[0].eventType, "application_submitted");
    assert.equal(outboxPayload.items[0].payload.application_id, appId);
  } finally {
    await app.close();
  }
});
