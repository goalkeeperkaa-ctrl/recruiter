import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../server.js";
import { MemoryAuthRepo, MemoryJobsRepo } from "../repos/memory-repos.js";
import { MemoryFlowRunnerRepo } from "../repos/memory-flow-runner-repo.js";
import { MemoryOutboxRepo } from "../repos/memory-outbox-repo.js";

test("auth and jobs flow works", async () => {
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

    assert.equal(bootstrap.statusCode, 200);
    const bootstrapPayload = bootstrap.json();
    assert.ok(bootstrapPayload.token);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        tenantSlug: "acme",
        email: "owner@acme.test",
        password: "password123",
      },
    });

    assert.equal(login.statusCode, 200);
    const { token } = login.json() as { token: string };
    assert.ok(token);

    const createJob = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        title: "Оператор",
        status: "active",
        workFormat: "remote",
        employmentType: "full_time",
        publicSlug: "operator",
      },
    });

    assert.equal(createJob.statusCode, 201);

    const listJobs = await app.inject({
      method: "GET",
      url: "/jobs",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.equal(listJobs.statusCode, 200);
    const jobsPayload = listJobs.json() as { items: Array<{ publicSlug: string }> };
    assert.equal(jobsPayload.items.length, 1);
    assert.equal(jobsPayload.items[0].publicSlug, "operator");

    const publicJob = await app.inject({
      method: "GET",
      url: "/public/acme/jobs/operator",
    });

    assert.equal(publicJob.statusCode, 200);
    const publicPayload = publicJob.json() as { title: string };
    assert.equal(publicPayload.title, "Оператор");
  } finally {
    await app.close();
  }
});
