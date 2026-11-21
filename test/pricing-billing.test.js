// @ts-check
// Providers P4 (HarnessV3-Providers §4 P4, D7/D8): how a model is billed, and the request's two figures — what was
// paid (`cost`) and what the same tokens cost at list price (`listCost`). Spend is analytics: on a plan a request pays
// nothing by itself, and its card is its list price.
// (fails before: yes — there was no billing anywhere: a subscription's requests were "paid" at the card, an unstated
// cache price billed cached tokens at $0, and a record carried one figure)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { billingOf, billingFor, priceCard, estimateCost, BILLINGS, exactRowKey, contextWindowFor } from "../src/core/pricing.js";
import { usageFromAnthropic, usageFromOpenAI } from "../src/core/wire/usage.js";
import { totalUsageOf } from "../src/app/memory-tools.js";
import { UsageStore } from "../src/services/records.js";
import { normalizeConfig, validateConfig } from "../src/services/config/store.js";
import { billingForModel } from "../src/core/routing.js";
import { DailyUsage } from "../src/services/daily-usage.js";

const ZAI_CODING = "https://api.z.ai/api/coding/paas/v4";

describe("billingOf: who says how a model is billed", () => {
  test("a coding agent is a plan; a row beats the upstream; the upstream beats the catalogue; the catalogue's plan by address; else metered", () => {
    assert.deepEqual(BILLINGS, ["metered", "plan"]);
    assert.deepEqual(billingOf("any", { type: "acp", billing: "metered" }), { billing: "plan", source: "agent" }, "an agent's subscription pays, whatever the field says");
    assert.deepEqual(billingOf("any", { type: "cursor-sdk" }), { billing: "plan", source: "agent" });
    // SpaceX-style: per-token grok-4.6 beside a zero-priced grok-4.7 on the same upstream
    const spacex = { type: "openai-compatible", baseUrl: "https://api.x.ai/v1", billing: "metered", pricing: { "grok-4.7": { billing: "plan" }, "grok-4.6": { input: 3, output: 15 } } };
    assert.deepEqual(billingOf("grok-4.7-fast", spacex), { billing: "plan", source: "row" }, "the row covers the ids it starts");
    assert.deepEqual(billingOf("grok-4.6", spacex), { billing: "metered", source: "upstream" });
    assert.deepEqual(billingOf("glm-5", { type: "openai-compatible", baseUrl: ZAI_CODING }), { billing: "plan", source: "catalogue" }, "the Z.AI coding plan's address is a plan");
    assert.deepEqual(billingOf("glm-5", { type: "openai-compatible", baseUrl: ZAI_CODING, billing: "metered" }), { billing: "metered", source: "upstream" }, "a stated billing wins over the catalogue");
    assert.deepEqual(billingOf("glm-5", { type: "openai-compatible", baseUrl: "https://api.z.ai/api/paas/v4" }), { billing: "metered", source: "catalogue" });
    assert.deepEqual(billingOf("m", { type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1" }), { billing: "metered", source: "default" });
    assert.deepEqual(billingOf("m", null), { billing: "metered", source: "default" });
    assert.equal(billingFor("glm-5", { type: "openai-compatible", baseUrl: ZAI_CODING, pricing: { glm: { billing: "metered" } } }), "metered", "a row beats the catalogue too");
  });

  test("the config: billing is absent unless set (so the catalogue can speak), and only metered or plan pass", () => {
    const cfg = normalizeConfig({ upstreams: [{ id: "z", type: "openai-compatible", baseUrl: ZAI_CODING }] });
    assert.equal(cfg.upstreams[0].billing, null, "nothing filled in: the catalogue decides");
    const bad = validateConfig({ ...cfg, upstreams: [{ ...cfg.upstreams[0], billing: "free", pricing: { "glm-5": { billing: "prepaid" } } }] }).errors;
    assert.ok(bad.includes("upstreams[0].billing must be metered or plan (empty follows the catalogue, else metered)"), bad.join(" | "));
    assert.ok(bad.includes('upstreams[0].pricing["glm-5"].billing must be metered or plan (empty follows the upstream)'), bad.join(" | "));
    const good = validateConfig({ ...cfg, upstreams: [{ ...cfg.upstreams[0], billing: "plan", pricing: { "glm-5": { billing: "metered" } } }] }).errors;
    assert.equal(good.some((e) => /billing/.test(e)), false, good.join(" | "));
  });
});

describe("billingForModel: a harness name to how it bills, through its route", () => {
  test("the route's upstream and the name it sends: a row's billing under the renamed model, the upstream's, else metered", () => {
    const cfg = {
      rules: {},
      upstreams: [{ id: "u", type: "openai-compatible", baseUrl: "http://x", pricing: { "real-x": { billing: "plan" } } }, { id: "s", type: "openai-compatible", baseUrl: "http://y", billing: "plan" }],
      routes: [{ match: "alias", upstream: "u", upstreamModel: "real-x" }, { match: "other", upstream: "u" }, { match: "sub-*", upstream: "s" }],
    };
    assert.equal(billingForModel(cfg, "alias"), "plan", "the row under the name the route sends");
    assert.equal(billingForModel(cfg, "other"), "metered", "the same upstream, no row: metered");
    assert.equal(billingForModel(cfg, "sub-1"), "plan", "the upstream says it");
    assert.equal(billingForModel(cfg, "nowhere"), "metered", "no route");
    assert.equal(billingForModel(cfg, ""), "metered");
  });
});

describe("a model's own name", () => {
  // (fails before: yes — the bug hunt of 10-30: the pricing key dropped a trailing effort word from every name and
  // every row, so `qwen3-max` and `qwen3` were one key and whichever row came first priced both, and a listing's
  // window for the one was the other's)
  test("a model whose name ends in an effort word is priced as itself; a name that carries an effort lane finds its model's row", () => {
    const card = (/** @type {number} */ input) => ({ input, output: input * 5 });
    for (const table of [{ qwen3: card(0.2), "qwen3-max": card(1.2) }, { "qwen3-max": card(1.2), qwen3: card(0.2) }]) {
      assert.equal(priceCard("qwen3-max", table)?.input, 1.2, "qwen3-max at its own row, whichever row comes first");
      assert.equal(priceCard("dashscope/qwen3", table)?.input, 0.2, "qwen3 at its own");
    }
    assert.equal(priceCard("qwen3", { "qwen3-max": card(1.2) }), null, "a row for qwen3-max prices no other model");
    assert.equal(priceCard("gpt-5.1-codex-max", { "gpt-5.1-codex": card(1.25), "gpt-5.1-codex-max": card(2) })?.input, 2);
    assert.equal(priceCard("claude-opus-4-5-high", { "claude-opus-4-5": card(5) })?.input, 5, "an effort lane is priced as its model");
    assert.equal(exactRowKey("qwen3-max", { qwen3: card(0.2), "qwen3-max": card(1.2) }), "qwen3-max", "the row that names it");
    assert.equal(exactRowKey("qwen3", { "qwen3-max": card(1.2) }), null, "no row names qwen3");
    assert.equal(contextWindowFor("qwen3-max", null, { qwen3: 128_000, "qwen3-max": 256_000 }), 256_000, "the window its listing states for it");
    assert.equal(contextWindowFor("qwen3", null, { "qwen3-max": 256_000, qwen3: 128_000 }), 128_000);
  });
});

describe("the card: an unstated cache price", () => {
  // (fails before: yes — a row naming only in and out billed every cached token at $0, found at Providers P2)
  test("a cache price the row leaves out is the input price; a stated one (0 included) stands", () => {
    const table = { "zeta-5": { input: 2, output: 8 }, "free-cache": { input: 2, output: 8, cacheRead: 0, cacheWrite: 2.5 } };
    assert.deepEqual(priceCard("zeta-5", table), { input: 2, output: 8, cacheRead: 2, cacheWrite: 2 }, "no discount assumed");
    assert.deepEqual(priceCard("free-cache", table), { input: 2, output: 8, cacheRead: 0, cacheWrite: 2.5 });
    assert.equal(estimateCost("zeta-5", { input: 1_000_000, cacheRead: 1_000_000, output: 0 }, table), 4);
  });

  // (fails before: yes — the owner's words of 10-29: every cache write was billed at the five-minute price, and the
  // Anthropic usage's split of its writes by lifetime was dropped)
  test("an hour's cache writes: the usage's split is kept, and those writes cost twice the input price, the rest the card's write price", () => {
    const u = usageFromAnthropic({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 3_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 2_000_000 } });
    assert.deepEqual([u.cacheWrite, u.cacheWrite1h], [3_000_000, 2_000_000]);
    const table = { "opus-x": { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 } };
    assert.equal(estimateCost("opus-x", { cacheWrite: 3_000_000, cacheWrite1h: 2_000_000 }, table), 5 + 2 * 8, "1M at the 5-minute $5, 2M at the hour's $8");
    assert.equal(estimateCost("opus-x", { cacheWrite: 1_000_000 }, table), 5, "no split said: the five-minute price, as before");
    assert.equal(estimateCost("opus-x", { cacheWrite: 1_000_000, cacheWrite1h: 9_000_000 }, table), 8, "a split never counts more than the writes");
    assert.deepEqual(totalUsageOf("anthropic", [{ input_tokens: 1, cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 100 } }, { input_tokens: 1, cache_creation_input_tokens: 40, cache_creation: { ephemeral_1h_input_tokens: 30 } }]), { input: 2, output: 0, cacheRead: 0, cacheWrite: 140, cacheWrite1h: 130 }, "a reply of several rounds sums the split too");
  });

  // (fails before: yes — the bug hunt of 10-30, WIRE-6: a usage that named its cache hits and not its misses counted the
  // hits twice, in the input and again as read from the cache)
  test("an OpenAI-style usage's cache hits said without its misses come out of the input", () => {
    assert.deepEqual(usageFromOpenAI({ prompt_tokens: 1000, completion_tokens: 5, prompt_cache_hit_tokens: 800 }), { input: 200, output: 5, cacheRead: 800 });
    assert.deepEqual(usageFromOpenAI({ prompt_tokens: 1000, completion_tokens: 5, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200 }), { input: 200, output: 5, cacheRead: 800 }, "DeepSeek's two counts");
    assert.deepEqual(usageFromOpenAI({ prompt_tokens: 1000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 800 }, prompt_cache_hit_tokens: 800 }), { input: 200, output: 5, cacheRead: 800 }, "both spellings of the hits, counted once");
    const table = { "zeta-5": { input: 2, output: 8, cacheRead: 0.2 } };
    assert.equal(estimateCost("zeta-5", usageFromOpenAI({ prompt_tokens: 1_000_000, completion_tokens: 0, prompt_cache_hit_tokens: 1_000_000 }), table), 0.2, "a prompt read whole from the cache costs the cache's price alone");
  });
});

describe("a request's two figures", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-billing-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new UsageStore({ dataDir: dir, options: { broadcast: false } });
  const card = { "zeta-5": { input: 2, output: 8 } };
  const tokens = { input: 500_000, output: 100_000, cacheRead: 0, cacheWrite: 0, thinking: 0 };
  /** @param {any} meta @param {any} patch @param {any} [opts] */
  const close = (meta, patch, opts) => {
    const rec = store.start({ model: "zeta-5", upstream: "z", ...meta });
    store.finish(rec, { status: "ok", tokens: { ...tokens }, ...patch }, card, opts);
    return /** @type {any} */ (rec);
  };

  test("metered pays the list figure; a plan pays 0 and lists the card", () => {
    const metered = close({}, {}, { billing: "metered" });
    assert.deepEqual([metered.billing, metered.cost, metered.listCost], ["metered", 1.8, 1.8]);
    const plan = close({}, {}, { billing: "plan" });
    assert.deepEqual([plan.billing, plan.cost, plan.listCost], ["plan", 0, 1.8], "paid nothing; $1.80 at list price");
    const unsaid = close({}, {});
    assert.equal(unsaid.billing, "metered", "metered when nobody says");
  });

  test("unpriced: metered is null and null; a plan is paid 0 with no list figure", () => {
    const m = close({ model: "nobody-prices-this" }, {}, { billing: "metered" });
    assert.deepEqual([m.cost, m.listCost], [null, null]);
    const p = close({ model: "nobody-prices-this" }, {}, { billing: "plan" });
    assert.deepEqual([p.cost, p.listCost], [0, null]);
  });

  test("a provider's stated charge stays the paid figure, with the card as the list figure", () => {
    const r = close({}, { cost: 0.42, costSource: "provider" }, { billing: "metered" });
    assert.deepEqual([r.cost, r.listCost, r.costSource], [0.42, 1.8, "provider"]);
  });

  test("an agent turn: paid stays null (its tokens are estimates); the list figure only from the operator's card", () => {
    const priced = close({ estimatedTokens: true }, {}, { billing: "plan" });
    assert.deepEqual([priced.cost, priced.listCost], [null, 1.8], "the operator priced zeta-5 on this upstream");
    const builtin = close({ estimatedTokens: true, model: "claude-opus-5-5" }, {}, { billing: "plan" });
    assert.deepEqual([builtin.cost, builtin.listCost], [null, null], "a built-in rate on estimated tokens would be a guess");
    const reported = close({ estimatedTokens: true }, { cost: 0.07, costSource: "agent" }, { billing: "plan" });
    assert.equal(reported.cost, 0.07, "an agent that said what it cost is believed");
  });

  // (fails before: yes — 4c: the Home page's 24 hours carried the paid figure only)
  test("the 24-hour summary carries the list figure beside the paid one, in all and per model", () => {
    const sum = /** @type {any} */ (store.summary());
    const zeta = sum.byModel["zeta-5"];
    assert.ok(sum.listCostN >= 1 && zeta.listCostN >= 1);
    // every closed record above: the list figures that exist, summed
    const listed = store.records.filter((/** @type {any} */ r) => typeof r.listCost === "number");
    assert.equal(sum.listCostN, listed.length);
    assert.equal(sum.listCost, Math.round(listed.reduce((/** @type {number} */ n, /** @type {any} */ r) => n + r.listCost, 0) * 1e4) / 1e4);
    assert.ok(sum.listCost > sum.cost, "plans paid less than the cards say");
  });
});

describe("the ledgers (Providers P4 4b)", () => {
  // (fails before: yes — the rollup carried the paid figure only; a goal books nothing since the owner's of 11-05)
  test("the daily rollup: paid and at list per row and day, the part a plan paid instead", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-daily-list-"));
    const d = new DailyUsage({ dataDir: dir });
    try {
      const ts = new Date().toISOString();
      const rec = (/** @type {any} */ o) => ({ id: String(Math.random()), ts, status: "ok", upstream: "z", model: "glm-5", tokens: { input: 10, output: 1 }, ...o });
      d.add(rec({ cost: 0, listCost: 1.5, billing: "plan" }));
      d.add(rec({ cost: 0, listCost: 0.5, billing: "plan" }));
      d.add(rec({ cost: 0.25, listCost: 0.25, billing: "metered", model: "grok-4.6" }));
      d.add(rec({ cost: 0, listCost: null, billing: "plan", model: "unpriced" }));
      const agg = d.aggregate();
      assert.deepEqual([agg.cost, agg.listCost, agg.listCostN, agg.planListCost], [0.25, 2.25, 3, 2]);
      const row = (/** @type {string} */ m) => agg.rows.find((r) => r.model === m);
      assert.deepEqual([row("glm-5").cost, row("glm-5").listCost, row("glm-5").listCostN, row("glm-5").planListCost], [0, 2, 2, 2]);
      assert.deepEqual([row("grok-4.6").listCost, row("grok-4.6").planListCost], [0.25, 0]);
      assert.deepEqual([row("unpriced").listCostN, row("unpriced").listCost, row("unpriced").costN], [0, 0, 1], "a plan paid $0 with no list figure: no count, so the page says –, never $0");
      const csv = d.csv().split("\n");
      assert.match(csv[0], /,list_cost_usd,plan_list_cost_usd$/);
      assert.ok(csv.some((l) => l.includes("glm-5") && l.endsWith(",2.000000,2.000000")), csv.join(" | "));
    } finally {
      await d.flush(); // the adds scheduled a write, which would otherwise make the folder again once it is gone
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
