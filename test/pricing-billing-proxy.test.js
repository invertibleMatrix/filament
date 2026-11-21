// @ts-check
// Providers P4 (HarnessV3-Providers §4 P4, D7/D8), through the proxy: a request's record says how its model is billed
// at the upstream that answered it, and carries both figures — paid and at list price. The upstream's own billing, a
// pricing row's override, and the default meet one fake provider here.
// (fails before: yes — every request was "paid" at the card, a subscription's included)
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fakeUpstream, openaiReply, startApp } from "./helpers/app.js";

describe("a request's billing, through the proxy", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  before(async () => {
    up = await fakeUpstream(async (call) => (call.kind === "openai" ? openaiReply("ok", { model: call.body?.model, usage: { prompt_tokens: 500_000, completion_tokens: 100_000, total_tokens: 600_000 } }) : undefined));
    shim = await startApp({
      configure: (cfg) => {
        const zeta = { input: 2, output: 8 };
        cfg.upstreams = [
          { id: "sub", name: "On a plan", type: "openai-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, models: ["zeta-5"], billing: "plan", pricing: { "zeta-5": zeta } },
          // per token, but one model of it rides a plan (the row says so)
          { id: "meter", name: "Per token", type: "openai-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, models: ["zeta-6", "zeta-6-plan"], pricing: { "zeta-6": zeta, "zeta-6-plan": { ...zeta, billing: "plan" } } },
        ];
        cfg.routes = [
          { match: "zeta-5", upstream: "sub", upstreamModel: "{model}", enabled: true },
          { match: "zeta-6*", upstream: "meter", upstreamModel: "{model}", enabled: true },
        ];
        // `/cost` and `/status` are asked on the loop's name: an outside client's go to its model as typed.
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, roots: [], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });
  /** @param {string} model */
  const ask = async (model) => {
    const r = await shim.post("/v1/chat/completions", { model, messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
    const rec = (await shim.records(20)).find((/** @type {any} */ x) => x.model === model && x.status === "ok");
    assert.ok(rec, `a record for ${model}`);
    return rec;
  };

  test("a plan upstream pays nothing and lists the card", async () => {
    const r = await ask("zeta-5");
    assert.deepEqual([r.billing, r.cost, r.listCost], ["plan", 0, 1.8], "500K in at $2 + 100K out at $8 = $1.80 at list, $0 paid");
  });

  test("a metered upstream pays the card; a row billed as a plan beside it pays nothing", async () => {
    const m = await ask("zeta-6");
    assert.deepEqual([m.billing, m.cost, m.listCost], ["metered", 1.8, 1.8]);
    const p = await ask("zeta-6-plan");
    assert.deepEqual([p.billing, p.cost, p.listCost], ["plan", 0, 1.8], "the row's billing beats its upstream's");
  });

  // (fails before: yes — Providers P4 4c: /cost said "$1.8000" for three requests worth $5.40, two of them on a plan)
  test("/cost and /status: what was paid, and beside it the list figure and what plans saved", async () => {
    const said = async (/** @type {string} */ cmd) => {
      const r = await shim.house("/v1/messages", { model: "agent/zeta-5", max_tokens: 64, messages: [{ role: "user", content: cmd }] });
      assert.equal(r.status, 200);
      return ((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
    };
    const cost = await said("/cost");
    assert.match(cost, /Total cost:\s+\$1\.8000/, cost);
    assert.match(cost, /At list price:\s+\$5\.4000/, cost);
    assert.match(cost, /Saved by plans:\s+\$3\.6000/, cost);
    assert.match(cost, /zeta-5:.*\(\$0\.0000 paid · \$1\.8000 at list, 1 request\)/, cost);
    assert.match(cost, /zeta-6:.*\(\$1\.8000, 1 request\)/, "a model paid at the card says one figure");
    assert.match(cost, /\$0 on a subscription plan/);
    const status = await said("/status");
    assert.match(status, /\$1\.8000 paid · \$5\.4000 at list price/, status);
  });
});

describe("an agent turn on a plan, through the proxy", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  before(async () => {
    up = await fakeUpstream(async (call) => (call.kind === "openai" ? openaiReply("done", { model: call.body?.model, usage: { prompt_tokens: 500_000, completion_tokens: 100_000, total_tokens: 600_000 } }) : undefined));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "sub", name: "On a plan", type: "openai-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, models: ["zeta-5"], billing: "plan", pricing: { "zeta-5": { input: 2, output: 8 } } }];
        cfg.routes = [{ match: "zeta-5", upstream: "sub", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [process.cwd()] };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  // (fails before: yes — the turn said what it paid ($0) and nothing of what its rounds were worth)
  test("the turn's record, its Details report and its facts carry the list figure of its rounds", async () => {
    const id = (await (await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "zeta-5", title: "plan" } })).json()).id;
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hi", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
    const recs = await shim.records(20);
    const shell = recs.find((/** @type {any} */ x) => x.agent && x.agent.spentUsd != null);
    assert.ok(shell, JSON.stringify(recs.map((/** @type {any} */ x) => [x.id, x.model, !!x.agent])));
    assert.deepEqual([shell.agent.spentUsd, shell.agent.listUsd], [0, 1.8], "one round on the plan: paid $0, $1.80 at list");
    const report = await (await shim.api(`/api/requests/${shell.id}/composition`)).json();
    assert.deepEqual([report.costUsd, report.listUsd], [0, 1.8], JSON.stringify({ cost: report.costUsd, list: report.listUsd }));
    const tx = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const facts = (tx.turns || []).map((/** @type {any} */ t) => t.facts).find(Boolean);
    assert.deepEqual([facts?.costUsd, facts?.listUsd], [0, 1.8], JSON.stringify(facts));
  });
});
