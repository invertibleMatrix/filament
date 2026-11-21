// @ts-check
// A.21: the admin API's body reader answered a malformed body with 400 AND returned null, and eight routes carried on
// with `{}` — POST /api/failover saved `failover: true` on a body it had just refused, DELETE /api/memory/canonical
// would have forgotten with an empty filter, POST /api/memory/backfill started a job. The reader now ends the handler
// (BodyRefused), one answer goes out, nothing acts; and a body over the cap gets its 413 instead of "invalid JSON".
import { test } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers/app.js";

test("a malformed admin body is refused once and no route acts on it", async () => {
  const t = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.rules.resilience = { ...(cfg.rules.resilience || {}), failover: false };
    },
  });
  try {
    const failover = await t.api("/api/failover", { method: "POST", body: "{not json" });
    assert.equal(failover.status, 400);
    assert.deepEqual(await failover.json(), { error: "invalid JSON body" });
    assert.equal(t.app.config.rules.resilience.failover, false, "the refused body did not flip failover");

    const jobsBefore = (await (await t.api("/api/jobs")).json()).jobs.length;
    const backfill = await t.api("/api/memory/backfill", { method: "POST", body: "[unterminated" });
    assert.equal(backfill.status, 400, "the memory area's guard lets the refusal through, not a 500");
    assert.deepEqual(await backfill.json(), { error: "invalid JSON body" });
    assert.equal(
      (await (await t.api("/api/jobs")).json()).jobs.length,
      jobsBefore,
      "no backfill job was started",
    );

    const config = await t.api("/api/config", { method: "PUT", body: "{" });
    assert.equal(config.status, 400);
    assert.deepEqual(
      await config.json(),
      { error: "invalid JSON body" },
      "one answer, the reader's — not the handler's second one",
    );

    const ok = await t.api("/api/failover", { method: "POST", body: { enabled: true } });
    assert.equal(ok.status, 200, "a well-formed body still reaches the route");
    assert.equal(t.app.config.rules.resilience.failover, true);
  } finally {
    await t.stop();
  }
});

test("an admin body over server.maxBodyBytes gets a 413 that says so", async () => {
  const t = await startApp({
    configure: (cfg) => {
      cfg.server.maxBodyBytes = 2048;
    },
  });
  try {
    const r = await t.api("/api/dry-run", {
      method: "POST",
      body: { body: { model: "x", filler: "y".repeat(4096) } },
    });
    assert.equal(r.status, 413);
    assert.deepEqual(await r.json(), { error: "request body too large" });
    const small = await t.api("/api/dry-run", {
      method: "POST",
      body: { body: { model: "claude-3-5-sonnet", messages: [] } },
    });
    assert.notEqual(small.status, 413, "the cap is a cap, not a lock");
  } finally {
    await t.stop();
  }
});
