import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../server.js";

test("GET /health returns ok", async () => {
  const app = await buildApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);

    const payload = response.json();
    assert.equal(payload.status, "ok");
    assert.equal(payload.service, "recruitflow-api");
  } finally {
    await app.close();
  }
});
