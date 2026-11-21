// @ts-check
// A model's capabilities at a provider (HarnessV3 §15 item 93): one resolver (core/model-caps.js) answers what a
// model takes — reasoning levels, fast mode and what it costs, extended thinking, context windows, the output
// ceiling — from its row on the Upstreams page, then its provider's own listing, then the rules, then the built-ins,
// each answer naming its source. The picker offers that answer, the wire is shaped by it (effort clamped to the
// levels, fast mode as Anthropic's `speed` or a provider's own `service_tier`), and a fast request bills fast only
// when the reply names the tier it asked for.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";

import { modelCapsFor, withoutOperatorCaps, CAP_FIELDS } from "../src/core/model-caps.js";
import { buildFamilies, effortOffer, sessionWindowFor } from "../src/core/model-families.js";
import { mergeRules, shapeAnthropic, shapeOpenAI, shapeResponses, parseModelSuffix } from "../src/core/shaping.js";
import { priceCard, priceSourceOf, fastMultiplierFor, maxOutputWithSource, rowFieldFor } from "../src/core/pricing.js";
import { wireDiscoveredCaps, maxOutputForModel } from "../src/core/routing.js";
import { chatToResponsesRequest } from "../src/core/wire/responses.js";
import { usageAndCost } from "../src/core/usage-cost.js";
import { fetchUpstreamModels, discoveredCaps, discoveredWindows, seedModelCache, dumpModelCache } from "../src/adapters/providers/http.js";
import { defaultsOf, RULES } from "../src/core/schema.js";
import { normalizeConfig, validateConfig } from "../src/services/config/store.js";
import { dryRunWith } from "../src/app/plan.js";
import { fakeUpstream, openaiReply, openaiStream, startApp } from "./helpers/app.js";

const rules = () => mergeRules();
const XAI_FAST = { fast: true, fastParams: { service_tier: "priority" }, fastMultiplier: 2 };

/** A config with an Anthropic upstream, an xAI-style OpenAI-compatible one and a coding agent. @param {Record<string, any>} [spacex] @param {Record<string, any>} [anth] */
const cfgWith = (spacex = {}, anth = {}) => ({
  rules: defaultsOf(RULES),
  upstreams: [
    { id: "a", type: "anthropic", enabled: true, pricing: anth },
    { id: "x", type: "openai-compatible", enabled: true, baseUrl: "http://x", pricing: spacex },
    { id: "cur", type: "acp", enabled: true, acp: { command: "agent" }, pricing: {} },
  ],
  routes: [
    { match: "claude-*", upstream: "a", upstreamModel: "{model}" },
    { match: "grok-*", upstream: "x", upstreamModel: "{model}" },
    { match: "x/*", upstream: "x", upstreamModel: "{1}" },
    { match: "cursor/*", upstream: "cur", upstreamModel: "{1}" },
  ],
});
const upOf = (/** @type {any} */ cfg, /** @type {string} */ id) => cfg.upstreams.find((/** @type {any} */ u) => u.id === id);

describe("the resolver: the first tier that speaks wins, and says it spoke", () => {
  test("reasoning levels: the model's row, then the rules' caps, then the built-ins; [] is 'takes none'", () => {
    const plain = cfgWith();
    assert.deepEqual(modelCapsFor(plain, "grok-4.7")?.effort, { levels: ["low", "medium", "high"], source: "builtin", default: "high", defaultSource: "builtin" });
    assert.deepEqual(modelCapsFor(plain, "claude-opus-4-6")?.effort.levels, ["low", "medium", "high", "max"]);
    assert.equal(modelCapsFor(plain, "claude-opus-4-6")?.effort.source, "rules", "the Rules page's modelCaps names Opus 4.6");
    assert.deepEqual(modelCapsFor(plain, "x/glm-5.3")?.effort, { levels: null, source: null, default: null, defaultSource: null }, "nobody knows: no guess");
    const own = cfgWith({ "grok-4.7": { efforts: ["high", "LOW"], effortDefault: "low" }, "glm-5.3": { efforts: [] } });
    assert.deepEqual(modelCapsFor(own, "grok-4.7")?.effort, { levels: ["low", "high"], source: "operator", default: "low", defaultSource: "operator" }, "in Filament's order, whatever the row wrote");
    assert.deepEqual(modelCapsFor(own, "x/glm-5.3")?.effort.levels, [], "an empty list: the model takes no effort field");
    const rowBeatsRules = cfgWith({}, { "claude-opus-4-6": { efforts: ["low", "medium", "high", "xhigh", "max"] } });
    assert.equal(modelCapsFor(rowBeatsRules, "claude-opus-4-6")?.effort.source, "operator", "one model at one provider beats a family rule");
  });

  test("the provider's own listing sits between the row and the rules", () => {
    const table = { a: { "claude-opus-4-6": { efforts: ["low", "high"], thinking: false, maxOutput: 64000 }, "claude-opus-5-5-20260101": { efforts: ["low", "medium", "high", "xhigh", "max"] } } };
    wireDiscoveredCaps((/** @type {string} */ id) => /** @type {any} */ (table)[id] || null);
    try {
      const cfg = cfgWith();
      const caps = modelCapsFor(cfg, "claude-opus-4-6");
      assert.deepEqual({ levels: caps?.effort.levels, source: caps?.effort.source }, { levels: ["low", "high"], source: "endpoint" });
      assert.deepEqual(caps?.thinking, { available: false, source: "endpoint" });
      assert.deepEqual(caps?.maxOutput, { tokens: 64000, source: "endpoint" });
      assert.equal(modelCapsFor(cfg, "claude-opus-5-5")?.effort.source, "endpoint", "a dated listing id is the same model");
      assert.equal(modelCapsFor(cfg, "claude-opus-5")?.effort.source, "builtin", "a claim about opus-5-5 says nothing about opus-5");
      const own = cfgWith({}, { "claude-opus-4-6": { efforts: ["max"], thinking: true, maxOutputTokens: 32000 } });
      const mine = modelCapsFor(own, "claude-opus-4-6");
      assert.deepEqual([mine?.effort.source, mine?.thinking.source, mine?.maxOutput.source], ["operator", "operator", "operator"], "the row beats the listing, field by field");
      assert.equal(maxOutputForModel(cfg, "claude-opus-4-6"), 64000, "sessions without max_tokens read the listing's ceiling");
    } finally {
      wireDiscoveredCaps(() => null);
    }
  });

  test("fast mode: Anthropic's by the rules, a provider's own by its row — and only with the fields that ask for it", () => {
    const plain = cfgWith();
    assert.deepEqual(modelCapsFor(plain, "claude-opus-5-5")?.fast, { available: true, declared: true, source: "rules", multiplier: 2, multiplierSource: "builtin", params: null });
    assert.equal(modelCapsFor(plain, "claude-sonnet-5")?.fast.available, false);
    assert.equal(modelCapsFor(plain, "grok-4.7")?.fast.available, false, "an OpenAI-format wire has no fast mode until its row declares one");
    const off = cfgWith({}, { "claude-opus-5-5": { fast: false } });
    assert.deepEqual([modelCapsFor(off, "claude-opus-5-5")?.fast.available, modelCapsFor(off, "claude-opus-5-5")?.fast.source], [false, "operator"], "the row turns it off for this provider");
    const bare = cfgWith({ "grok-4.7": { fast: true } });
    assert.deepEqual([modelCapsFor(bare, "grok-4.7")?.fast.available, modelCapsFor(bare, "grok-4.7")?.fast.missing], [false, "params"], "declared with nothing to send: not a fast mode Filament can ask for");
    const xai = cfgWith({ "grok-4.7": { input: 0, output: 0, ...XAI_FAST } });
    assert.deepEqual(modelCapsFor(xai, "grok-4.7")?.fast, { available: true, declared: true, source: "operator", multiplier: 2, multiplierSource: "operator", params: { service_tier: "priority" } });
    assert.equal(modelCapsFor(cfgWith(), "cursor/claude-opus-5-5")?.fast.available, false, "a coding agent's speed is its own");
  });

  test("a prefix row speaks for every model under it; the longest row that names a field decides that field", () => {
    const cfg = cfgWith({ "grok-4": { ...XAI_FAST }, "grok-4.7": { input: 1, output: 3 }, "grok-4.6": { input: 1, output: 3, fast: false } });
    assert.equal(modelCapsFor(cfg, "grok-4.7")?.fast.available, true, "a price-only row does not hide the prefix's fast mode");
    assert.equal(modelCapsFor(cfg, "grok-4.6")?.fast.available, false, "an exact row's word beats the prefix's");
    assert.deepEqual(rowFieldFor("grok-4.7", upOf(cfg, "x").pricing, "fastParams"), { key: "grok-4", value: { service_tier: "priority" } });
    assert.deepEqual(fastMultiplierFor("grok-4.7", upOf(cfg, "x").pricing), { value: 2, source: "operator" });
  });

  test("thinking: Claude on the Anthropic wire by the built-ins, never on an OpenAI-format wire; the row decides", () => {
    assert.deepEqual(modelCapsFor(cfgWith(), "claude-sonnet-5")?.thinking, { available: true, source: "builtin" });
    assert.deepEqual(modelCapsFor(cfgWith({ "grok-4.7": { thinking: true } }), "grok-4.7")?.thinking, { available: false, source: null }, "only the Anthropic wire carries it");
    assert.deepEqual(modelCapsFor(cfgWith({}, { "claude-sonnet-5": { thinking: false } }), "claude-sonnet-5")?.thinking, { available: false, source: "operator" });
  });

  test("windows: the standard one and the others it offers; the row adds or removes choices", () => {
    const opus = modelCapsFor(cfgWith(), "claude-opus-5-5")?.window;
    assert.deepEqual(opus, { standard: 200_000, standardSource: "builtin", options: [200_000, 1_000_000], source: "builtin" });
    const grok = cfgWith({ "grok-4.7": { contextTokens: 500_000, windows: ["256000", 1_000_000] } });
    assert.deepEqual(modelCapsFor(grok, "grok-4.7")?.window, { standard: 500_000, standardSource: "operator", options: [256_000, 500_000, 1_000_000], source: "operator" }, "text from a form reads as numbers");
    const one = cfgWith({}, { "claude-opus-5-5": { windows: [] } });
    assert.deepEqual(modelCapsFor(one, "claude-opus-5-5")?.window.options, [], "an empty list: the standard window only");
    assert.equal(sessionWindowFor(grok, "grok-4.7", 1_000_000).tokens, 1_000_000, "a session may choose a window the row offers");
    assert.equal(sessionWindowFor(one, "claude-opus-5-5", 1_000_000).tokens, 200_000, "and not one it took away");
  });

  test("the output ceiling and the fast multiplier keep their tier order", () => {
    assert.deepEqual(maxOutputWithSource("claude-haiku-4-5", null, 64000), { tokens: 64000, source: "endpoint" });
    assert.deepEqual(maxOutputWithSource("claude-haiku-4-5", { "claude-haiku-4-5": { maxOutputTokens: 8000 } }, 64000), { tokens: 8000, source: "operator" });
    assert.deepEqual(maxOutputWithSource("claude-haiku-4-5", null, "not a number"), { tokens: null, source: null });
    assert.deepEqual(fastMultiplierFor("claude-opus-5-5", null), { value: 2, source: "builtin" });
    assert.deepEqual(fastMultiplierFor("claude-opus-5-5", { "claude-opus-5-5": { input: 3, output: 15, fastMultiplier: 6 } }), { value: 6, source: "operator" });
    assert.equal(priceCard("claude-opus-5-5", { "claude-opus-5-5": { input: 3, output: 15, fastMultiplier: 6 } }, { fast: true })?.output, 90);
    assert.equal(fastMultiplierFor("glm-5.3", null), null);
  });

  test("without the operator's word: every capability field off the rows, the prices kept", () => {
    const up = { id: "x", pricing: { "grok-4.7": { input: 1, output: 3, ...XAI_FAST, efforts: ["low"], windows: [1_000_000], contextTokens: 500_000, maxOutputTokens: 9000, thinking: true, effortDefault: "low" } } };
    assert.deepEqual(withoutOperatorCaps(up).pricing, { "grok-4.7": { input: 1, output: 3 } });
    assert.equal(up.pricing["grok-4.7"].fast, true, "the upstream itself is untouched");
    assert.ok(CAP_FIELDS.includes("fastParams") && !CAP_FIELDS.includes("input"));
  });
});

describe("the price's source, in priceCard's own order", () => {
  test("this upstream's row, then the built-in rates; a capability row is no price", () => {
    assert.equal(priceSourceOf("claude-opus-5-5", { "claude-opus-5-5": { input: 3, output: 4 } }), "upstream");
    assert.equal(priceSourceOf("claude-opus-5-5", { "claude-opus-5-5": { fast: true } }), "builtin", "a row that tunes fast mode prices nothing");
    assert.equal(priceSourceOf("claude-opus-5-5", {}), "builtin");
    assert.equal(priceSourceOf("grok-4.7", { "grok-4.7": { efforts: ["low"] } }), null);
    assert.equal(priceCard("claude-opus-5-5", { "claude-opus-5-5": { fast: true } })?.input, priceCard("claude-opus-5-5", null)?.input, "and priceCard agrees");
  });
});

describe("discovery: what a provider's listing states is kept, and nothing it did not state", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  before(async () => {
    up = await fakeUpstream((call) => {
      if (call.kind !== "models") return undefined;
      return {
        json: {
          data: [
            {
              id: "claude-opus-5-5", type: "model", max_input_tokens: 1_000_000, max_tokens: 128_000,
              capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } }, thinking: { supported: true, types: { adaptive: { supported: true } } } },
            },
            { id: "claude-haiku-4-5-20251001", type: "model", max_input_tokens: 200_000, max_tokens: 64_000, capabilities: { effort: { supported: false }, thinking: { supported: true } } },
            { id: "gateway-model", max_tokens: 4096 },
            { id: "openrouter/model", context_length: 131072, top_provider: { max_completion_tokens: 16384 } },
            { id: "names-only" },
          ],
        },
      };
    });
  });
  after(async () => {
    await up?.close();
  });

  test("Anthropic's capabilities and output ceiling are captured beside the window; absence claims nothing", async () => {
    const r = await fetchUpstreamModels({ id: "disc-a", type: "anthropic", baseUrl: up.url, apiKey: "k", discoverModels: true }, { force: true });
    assert.equal(r.source, "discovered");
    const caps = /** @type {any} */ (discoveredCaps("disc-a"));
    assert.deepEqual(caps["claude-opus-5-5"], { efforts: ["low", "medium", "high", "xhigh", "max"], thinking: true, maxOutput: 128_000 });
    assert.deepEqual(caps["claude-haiku-4-5-20251001"], { efforts: [], thinking: true, maxOutput: 64_000 }, "supported: false is a word — no effort field");
    assert.equal(caps["gateway-model"], undefined, "max_tokens without max_input_tokens is not read as an output ceiling");
    assert.deepEqual(caps["openrouter/model"], { maxOutput: 16384 });
    assert.equal(caps["names-only"], undefined);
    assert.equal(/** @type {any} */ (discoveredWindows("disc-a"))["claude-opus-5-5"], 1_000_000);
  });

  test("the cache round-trip keeps only what Filament reads", () => {
    seedModelCache({ "disc-b": { at: 1, names: ["m"], windows: { m: 200_000 }, caps: { m: { efforts: ["high", "bogus"], thinking: "yes", maxOutput: 12 }, n: { junk: 1 } } } });
    assert.deepEqual(discoveredCaps("disc-b"), { m: { efforts: ["high"] } });
    const dumped = /** @type {any} */ (dumpModelCache())["disc-b"];
    assert.deepEqual(dumped.caps, { m: { efforts: ["high"] } });
  });
});

describe("the wire: shaped by the same answer the picker offers", () => {
  const req = (/** @type {string} */ model, /** @type {any} */ c) => ({ requested: (c ? parseModelSuffix(model, c.rules) : parseModelSuffix(model)), rules: mergeRules() });

  test("a provider's own fast mode goes out as the fields its row declares, and says so", () => {
    const cfg = cfgWith({ "grok-4.7": { ...XAI_FAST } });
    const caps = modelCapsFor(cfg, "grok-4.7");
    const { requested, rules: r } = req("grok-4.7-high-fast", cfg);
    const out = shapeOpenAI({ body: { model: "grok-4.7-high-fast", messages: [{ role: "user", content: "hi" }], service_tier: "flex" }, rules: r, requested, upstreamModel: "grok-4.7", caps });
    assert.equal(out.body.service_tier, "priority");
    assert.equal(out.body.reasoning_effort, "high");
    assert.equal(out.fast, true);
    assert.ok(out.changes.some((c) => c === 'fast mode: service_tier "flex" -> "priority" (from the -fast suffix)'), out.changes.join(" | "));
    const res = shapeResponses({ body: { model: "grok-4.7-fast", input: "hi" }, rules: r, requested: parseModelSuffix("grok-4.7-fast"), upstreamModel: "grok-4.7", caps });
    assert.deepEqual([res.body.service_tier, res.fast], ["priority", true], "the Responses passthrough too");
  });

  test("without a declared fast mode the suffix is ignored and said why; never is never", () => {
    const plain = modelCapsFor(cfgWith(), "grok-4.7");
    const a = shapeOpenAI({ body: { model: "grok-4.7-fast", messages: [] }, rules: mergeRules(), requested: parseModelSuffix("grok-4.7-fast"), upstreamModel: "grok-4.7", caps: plain });
    assert.equal(a.body.service_tier, undefined);
    assert.equal(a.fast, false);
    assert.match(a.changes.join("|"), /-fast suffix ignored: grok-4\.7 has no fast mode on this wire/);
    const bare = modelCapsFor(cfgWith({ "grok-4.7": { fast: true } }), "grok-4.7");
    const b = shapeOpenAI({ body: { model: "grok-4.7-fast", messages: [] }, rules: mergeRules(), requested: parseModelSuffix("grok-4.7-fast"), upstreamModel: "grok-4.7", caps: bare });
    assert.match(b.changes.join("|"), /marked fast on its Upstreams page row, but the row has no request fields to ask with — add fastParams/);
    const never = mergeRules({ speed: { mode: "never" } });
    const xai = modelCapsFor(cfgWith({ "grok-4.7": { ...XAI_FAST } }), "grok-4.7");
    const c = shapeOpenAI({ body: { model: "grok-4.7-fast", messages: [] }, rules: never, requested: parseModelSuffix("grok-4.7-fast"), upstreamModel: "grok-4.7", caps: xai });
    assert.deepEqual([c.body.service_tier, c.fast], [undefined, false]);
    assert.match(c.changes.join("|"), /rule: never/);
    const always = mergeRules({ speed: { mode: "always" } });
    const d = shapeOpenAI({ body: { model: "grok-4.7", messages: [] }, rules: always, requested: parseModelSuffix("grok-4.7"), upstreamModel: "grok-4.7", caps: xai });
    assert.deepEqual([d.body.service_tier, d.fast], ["priority", true], "always: every request to a model that has one");
  });

  test("Anthropic: the row turns fast mode off (or adds a gateway's fields), and a row without thinking loses the field", () => {
    const off = modelCapsFor(cfgWith({}, { "claude-opus-5-5": { fast: false, thinking: false } }), "claude-opus-5-5");
    const out = shapeAnthropic({ body: { model: "claude-opus-5-5-fast", max_tokens: 100, messages: [], thinking: { type: "adaptive" } }, rules: mergeRules(), requested: parseModelSuffix("claude-opus-5-5-fast"), upstreamModel: "claude-opus-5-5", caps: off });
    assert.equal(out.body.speed, undefined);
    assert.equal(out.fast, false);
    assert.equal(out.body.thinking, undefined);
    assert.match(out.changes.join("|"), /fast mode not available on claude-opus-5-5 \(its row on the Upstreams page says it has none\)/);
    assert.match(out.changes.join("|"), /thinking removed \(claude-opus-5-5 takes no extended thinking: its row on the Upstreams page says so\)/);
    const on = modelCapsFor(cfgWith({}, { "claude-opus-5-5": { fastParams: { gateway_lane: "fast" } } }), "claude-opus-5-5");
    const g = shapeAnthropic({ body: { model: "claude-opus-5-5-fast", max_tokens: 100, messages: [] }, rules: mergeRules(), requested: parseModelSuffix("claude-opus-5-5-fast"), upstreamModel: "claude-opus-5-5", caps: on });
    assert.deepEqual([g.body.speed, g.body.gateway_lane, g.fast, g.extraBetas], ["fast", "fast", true, ["fast-mode-2026-02-01"]]);
  });

  test("effort is clamped to the levels the row declares, and the change says where they came from", () => {
    const caps = modelCapsFor(cfgWith({ "grok-4.7": { efforts: ["low", "medium"] } }), "grok-4.7");
    const out = shapeOpenAI({ body: { model: "grok-4.7-high", messages: [] }, rules: mergeRules(), requested: parseModelSuffix("grok-4.7-high", mergeRules()), upstreamModel: "grok-4.7", caps });
    assert.equal(out.body.reasoning_effort, "medium");
    assert.ok(out.changes.includes('effort "high" not allowed for grok-4.7 (levels from its Upstreams page row), clamped to "medium"'), out.changes.join(" | "));
    const none = modelCapsFor(cfgWith({ "grok-4.7": { efforts: [] } }), "grok-4.7");
    const n = shapeOpenAI({ body: { model: "grok-4.7-high", messages: [] }, rules: mergeRules(), requested: parseModelSuffix("grok-4.7-high", mergeRules()), upstreamModel: "grok-4.7", caps: none });
    assert.equal(n.body.reasoning_effort, undefined);
  });

  test("rule: always on a model with no fast mode here is said, not silent", () => {
    const plain = modelCapsFor(cfgWith(), "grok-4.7");
    const out = shapeOpenAI({ body: { model: "grok-4.7", messages: [] }, rules: mergeRules({ speed: { mode: "always" } }), requested: parseModelSuffix("grok-4.7", mergeRules()), upstreamModel: "grok-4.7", caps: plain });
    assert.equal(out.fast, false);
    assert.ok(out.changes.some((c) => c.startsWith("fast mode (rule: always) not sent: grok-4.7 has no fast mode on this wire")), out.changes.join(" | "));
  });

  test("the dry run reads a provider's own suffixed id as the pipeline does, and shows the caps it planned with", () => {
    const cfg = cfgWith({ "qwen3-max": { efforts: ["low", "high"] } });
    upOf(cfg, "x").models = ["qwen3", "qwen3-max"];
    const r = /** @type {any} */ (dryRunWith(() => cfg, () => null, { body: { model: "x/qwen3-max", messages: [{ role: "user", content: "hi" }] }, format: "openai" }, cfg));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.body.model, "qwen3-max", "not qwen3 at max effort");
    assert.equal(r.body.reasoning_effort, undefined);
    assert.deepEqual([r.caps?.sent, r.caps?.effort?.source], ["qwen3-max", "operator"]);
  });

  test("a client's own service tier crosses into the Responses shape", () => {
    assert.equal(/** @type {any} */ (chatToResponsesRequest({ model: "m", messages: [], service_tier: "priority" })).service_tier, "priority");
  });
});

describe("the bill: a fast request bills fast only when the reply names the tier it asked for", () => {
  test("served as asked, served otherwise, and a reply that names no tier", () => {
    const rec = { tokens: {}, speed: "fast", fastTier: "priority", changes: ["x"] };
    assert.deepEqual(usageAndCost(rec, { input: 10, output: 5, tier: "priority" }), { tokens: { input: 10, output: 5 }, servedTier: "priority" });
    const down = usageAndCost(rec, { input: 10, output: 5, tier: "default" });
    assert.equal("speed" in down && down.speed, undefined);
    assert.ok("speed" in down, "the patch clears the fast mark");
    assert.deepEqual(down.changes, ["x", 'fast mode requested the "priority" tier; the provider served "default" — billed at the standard price']);
    assert.deepEqual(usageAndCost(rec, { input: 1 }), { tokens: { input: 1 } }, "no tier named: the request stands as sent");
    assert.deepEqual(usageAndCost({ tokens: {}, speed: "fast" }, { input: 1, tier: "default" }), { tokens: { input: 1 }, servedTier: "default" }, "Anthropic's fast asks for no tier");
  });
});

describe("the picker: families offer what the resolver answers", () => {
  const row = (/** @type {string} */ id, /** @type {string} */ upstream, extra = {}) => ({ id, upstream, source: "discovered", ...extra });

  test("a provider's declared fast mode, levels and windows become the model's settings; the row's no removes one", () => {
    const cfg = cfgWith({ "grok-4.7": { input: 0, output: 0, ...XAI_FAST, efforts: ["low", "high"], effortDefault: "low", contextTokens: 500_000, windows: [1_000_000] } }, { "claude-opus-5-5": { fast: false } });
    const fams = new Map(buildFamilies(cfg, [row("grok-4.7", "x"), row("claude-opus-5-5", "a"), row("grok-4.6", "x")]).map((f) => [f.id, f]));
    const grok = fams.get("grok-4.7");
    assert.deepEqual(grok?.speed, { via: "setting", options: ["standard", "fast"], multiplier: 2, wire: "openai" }, "the multiplier is said even when the plan's price is $0 — it is the quota");
    assert.deepEqual(grok?.effort, { via: "setting", levels: ["low", "high"], default: "low" });
    assert.deepEqual(grok?.window, { via: "setting", options: [500_000, 1_000_000], standard: 500_000 });
    assert.equal(grok?.thinking, null);
    assert.equal(fams.get("claude-opus-5-5")?.speed, null, "turned off on the Upstreams page");
    assert.equal(fams.get("grok-4.6")?.speed, null);
    assert.deepEqual(effortOffer("grok-4.7", mergeRules(), modelCapsFor(cfg, "grok-4.7")), { via: "setting", levels: ["low", "high"], default: "low" });
  });

  test("a fast rule the harness cannot ride leaves nothing to offer", () => {
    const cfg = { ...cfgWith({ "grok-4.7": { ...XAI_FAST } }), rules: { ...defaultsOf(RULES), speed: { ...defaultsOf(RULES).speed, suffix: false } } };
    const f = buildFamilies(cfg, [row("grok-4.7", "x")])[0];
    assert.equal(f.speed, null, "no -fast suffix to carry the setting");
  });

  test("a family of fast ids says what they cost: the operator's word, else their own prices apart", () => {
    const rows = ["", "-fast"].map((s) => row(`cursor/grok-4.7${s}`, "cur", { codingAgent: true }));
    assert.equal(buildFamilies(cfgWith(), rows)[0].speed?.multiplier, undefined, "nobody said: nothing is guessed");
    const said = cfgWith();
    upOf(said, "cur").pricing = { "grok-4.7-fast": { fastMultiplier: 2 } };
    assert.equal(buildFamilies(said, rows)[0].speed?.multiplier, 2, "a quota multiplier set on the agent's row");
    const priced = cfgWith({ "kimi-k3": { input: 1, output: 4 }, "kimi-k3-fast": { input: 2, output: 8 } });
    priced.upstreams[1].models = ["kimi-k3", "kimi-k3-fast"];
    const fam = buildFamilies(priced, [row("x/kimi-k3", "x"), row("x/kimi-k3-fast", "x")])[0];
    assert.equal(fam.speed?.multiplier, 2);
  });
});

describe("the config: a model card's capability fields are typed and checked", () => {
  const withRow = (/** @type {any} */ r) => normalizeConfig({ upstreams: [{ id: "x", type: "openai-compatible", baseUrl: "http://x", pricing: { "grok-4.7": r } }] });

  test("text from a form takes the declared type", () => {
    const cfg = withRow({ fast: "true", fastMultiplier: "2", fastParams: '{"service_tier":"priority"}', efforts: "low, high", windows: "256000, 1000000", thinking: "no" });
    assert.deepEqual(cfg.upstreams[0].pricing["grok-4.7"], { fast: true, fastMultiplier: 2, fastParams: { service_tier: "priority" }, efforts: ["low", "high"], windows: ["256000", "1000000"], thinking: false });
    assert.equal(validateConfig(cfg).ok, true, validateConfig(cfg).errors.join("; "));
    assert.deepEqual(modelCapsFor({ ...cfg, routes: [{ match: "grok-*", upstream: "x", upstreamModel: "{model}" }] }, "grok-4.7")?.window.options.slice(-2), [256_000, 1_000_000]);
  });

  test("nonsense is refused with the row named", () => {
    const v = validateConfig(withRow({ efforts: ["ultra"], effortDefault: "loud", fast: "sometimes", fastMultiplier: 0.5, fastParams: [1], windows: [10] }));
    assert.equal(v.ok, false);
    const text = v.errors.join("\n");
    for (const f of ["efforts", "effortDefault", "fast must be true or false", "fastMultiplier", "fastParams", "windows"]) assert.ok(text.includes(f), `${f}: ${text}`);
    const nums = validateConfig(withRow({ contextTokens: "lots", maxOutputTokens: -1, effortDefault: "High" })).errors.join("\n");
    assert.match(nums, /contextTokens must be a number/);
    assert.match(nums, /maxOutputTokens must be a number/);
    assert.doesNotMatch(nums, /effortDefault/, "a level in capitals is still a level");
    assert.ok(text.includes('upstreams[0].pricing["grok-4.7"]'));
  });

  test("an upstream's own price is never negative (it would bill as a refund)", () => {
    const prices = validateConfig(withRow({ input: -1, output: 3, cacheRead: -0.5 })).errors.join("\n");
    assert.match(prices, /pricing\["grok-4\.7"\]\.input must be a number of at least 0/);
    assert.match(prices, /cacheRead must be a number of at least 0/);
    assert.doesNotMatch(prices, /\.output must/);
    assert.equal(validateConfig(withRow({ input: 0, output: 0 })).ok, true, "free is a price");
  });
});

describe("end to end: a SpaceX-style provider's fast mode from the dashboard's row to the bill", () => {
  /** @type {any[]} */
  const seen = [];
  let tier = "priority";
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "openai") return undefined;
      seen.push({ model: call.body?.model, tier: call.body?.service_tier ?? null, effort: call.body?.reasoning_effort ?? null, stream: call.body?.stream === true });
      const usage = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 };
      if (call.body?.stream === true) {
        // Every chunk names the tier it was served at, as xAI's and OpenAI's streams do.
        const st = openaiStream("ok", { model: call.body?.model, usage });
        return { sse: st.sse.map((/** @type {any} */ c) => (typeof c === "object" ? { data: { ...c.data, service_tier: tier } } : c)) };
      }
      const r = openaiReply("ok", { model: call.body?.model, usage });
      return { ...r, json: { ...r.json, service_tier: tier } };
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "spacex", name: "SpaceX", type: "openai-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, models: ["grok-4.7"], pricing: { "grok-4.7": { input: 2, output: 6, cacheRead: 0.5, ...XAI_FAST } } },
          // The same provider streamed: the served tier is read off the chunks.
          { id: "spacex-s", name: "SpaceX streamed", type: "openai-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, models: ["grok-4.6"], pricing: { "grok-4.6": { input: 2, output: 6, ...XAI_FAST } }, rules: { params: { forceStream: "on" } } },
        ];
        cfg.routes = [
          { match: "grok-4.6", upstream: "spacex-s", upstreamModel: "{model}", enabled: true },
          { match: "grok-*", upstream: "spacex", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [process.cwd()] };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });
  const session = async (model = "grok-4.7") => (await (await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model, title: "fast" } })).json()).id;
  const turn = async (/** @type {string} */ id) => {
    seen.length = 0;
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hi", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
    return seen.slice();
  };
  const tickOf = async (model = "grok-4.7") => (await shim.records(20)).find((/** @type {any} */ r) => r.upstreamModel === model && r.tokens?.output === 100);

  test("the catalogue offers fast mode on the provider's model, with what it costs", async () => {
    const j = await (await shim.api("/api/models?all=1")).json();
    const f = (j.families || []).find((/** @type {any} */ x) => x.id === "grok-4.7");
    assert.deepEqual(f?.speed, { via: "setting", options: ["standard", "fast"], multiplier: 2, wire: "openai" });
  });

  test("model.fast goes out as service_tier: priority, and a reply that confirms it bills double", async () => {
    tier = "priority";
    const id = await session();
    await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { fast: true, effort: "high" } } } });
    const calls = await turn(id);
    assert.deepEqual([calls[0].model, calls[0].tier, calls[0].effort], ["grok-4.7", "priority", "high"]);
    const tick = await tickOf();
    assert.equal(tick?.speed, "fast");
    assert.equal(tick?.fastTier, "priority");
    assert.equal(tick?.servedTier, "priority");
    assert.equal(tick?.cost, (1000 * 2 + 100 * 6) * 2 / 1e6);
  });

  test("a reply that names the default tier bills standard, and the record says why", async () => {
    tier = "default";
    const id = await session();
    await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { fast: true } } } });
    const calls = await turn(id);
    assert.equal(calls[0].tier, "priority");
    const tick = await tickOf();
    assert.equal(tick?.speed, undefined);
    assert.equal(tick?.cost, (1000 * 2 + 100 * 6) / 1e6);
    assert.ok((tick?.changes || []).some((/** @type {string} */ c) => c.includes('the provider served "default"')), JSON.stringify(tick?.changes));
  });

  test("a streamed reply's tier decides the same way", async () => {
    tier = "default";
    const id = await session("grok-4.6");
    await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { fast: true } } } });
    const calls = await turn(id);
    assert.deepEqual([calls[0].tier, calls[0].stream], ["priority", true]);
    const down = await tickOf("grok-4.6");
    assert.deepEqual([down?.speed, down?.servedTier], [undefined, "default"], JSON.stringify(down?.changes));
    tier = "priority";
    await turn(id);
    const kept = await tickOf("grok-4.6");
    assert.deepEqual([kept?.speed, kept?.servedTier, kept?.cost], ["fast", "priority", (1000 * 2 + 100 * 6) * 2 / 1e6]);
  });

  test("the Tune sheet's preview answers from the draft row, with the fallback, the offer and the draft's problems", async () => {
    const saved = (await (await shim.api("/api/state")).json()).config.upstreams.find((/** @type {any} */ u) => u.id === "spacex");
    const draft = { ...saved, pricing: { "grok-4.7": { input: 2, output: 6, ...XAI_FAST, efforts: ["low"], windows: [1_000_000], contextTokens: 256_000 } } };
    const r = await (await shim.api("/api/models/caps", { method: "POST", body: { upstream: draft, names: ["grok-4.7"] } })).json();
    assert.equal(r.models.length, 1, JSON.stringify(r));
    const m = r.models[0];
    assert.deepEqual([m.caps.effort.levels, m.caps.effort.source], [["low"], "operator"]);
    assert.deepEqual([m.fallback.effort.levels, m.fallback.effort.source], [["low", "medium", "high"], "builtin"], "what clearing the row falls back to");
    assert.deepEqual([m.fallback.fast.available, m.fallback.window.standard], [false, null], "without the row: no fast mode on this wire, no window anyone knows");
    assert.deepEqual(m.offer?.effort?.levels, ["low"]);
    assert.deepEqual(m.offer?.window?.options, [256_000, 1_000_000]);
    assert.deepEqual(m.offer?.speed, { via: "setting", options: ["standard", "fast"], multiplier: 2, wire: "openai" });
    assert.ok(m.offer?.members?.includes(m.id), "the family's members, so the sheet can tell its own variants from other models a row covers");
    // (fails before: yes — an unstated cache price was $0; Providers P4: it is the input price, and the answer says which prices the row states)
    assert.deepEqual(m.price, { input: 2, output: 6, cacheRead: 2, cacheWrite: 2, source: "upstream", stated: ["input", "output"] }, "the price as the server reads it, which table said it, and what that row states itself");
    assert.deepEqual(r.errors, []);
    // (fails before: yes — the answer had no billing; Providers P4: the sheet's "Like the provider" reads it)
    assert.deepEqual(m.billing, { billing: "metered", source: "default", provider: "metered" });
    const planRow = await (await shim.api("/api/models/caps", { method: "POST", body: { upstream: { ...saved, billing: "metered", pricing: { "grok-4.7": { input: 2, output: 6, billing: "plan" } } }, names: ["grok-4.7"] } })).json();
    assert.deepEqual(planRow.models[0].billing, { billing: "plan", source: "row", provider: "metered" }, "the row's say, and its provider's way without it");
    // A row that only tunes what the model can do is no price: with no rate anywhere else, the model is unpriced — never $0.
    const capsOnly = await (await shim.api("/api/models/caps", { method: "POST", body: { upstream: { ...saved, pricing: { "grok-4.7": { efforts: ["low"] } } }, names: ["grok-4.7"] } })).json();
    assert.equal(capsOnly.models[0].price, null, JSON.stringify(capsOnly.models[0].price));
    const bad = await (await shim.api("/api/models/caps", { method: "POST", body: { upstream: { ...saved, pricing: { "grok-4.7": { efforts: ["ultra"] } } } } })).json();
    assert.ok(bad.errors.some((/** @type {string} */ e) => e.startsWith('pricing["grok-4.7"].efforts')), JSON.stringify(bad.errors));
    assert.equal((await shim.api("/api/models/caps", { method: "POST", body: { upstream: { id: "nope" } } })).status, 404);
  });

  test("the session's price card is the fast one while its requests go out fast", async () => {
    const id = await session();
    const on = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { fast: true } } } })).json();
    assert.deepEqual([on.price?.input, on.price?.output], [4, 12], "the harness's Spend splits a fast session's dollars at the fast rate");
    const off = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { fast: false } } } })).json();
    assert.deepEqual([off.price?.input, off.price?.output], [2, 6]);
  });
});
