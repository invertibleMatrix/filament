// @ts-check
// The flex tier as a request setting (Providers P5): a provider's cheaper, slower processing (OpenAI's
// `service_tier: "flex"`), declared on a model's row with the fields that ask for it. The session's model.flex rides
// the name as Filament's `-flex` suffix, read only on a model that declares flex — a provider's own `-flex` id stays
// that id — and a flex request bills at the row's flexMultiplier only when the reply says it was served there.
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";

import { modelCapsFor, flexParse, withFlex } from "../src/core/model-caps.js";
import { buildFamilies } from "../src/core/model-families.js";
import { mergeRules, shapeOpenAI, shapeResponses, shapeAnthropic, parseModelSuffix } from "../src/core/shaping.js";
import { priceCard, flexMultiplierFor, estimateCost } from "../src/core/pricing.js";
import { usageAndCost } from "../src/core/usage-cost.js";
import { defaultsOf, RULES } from "../src/core/schema.js";
import { normalizeConfig, validateConfig } from "../src/services/config/store.js";
import { dryRunWith } from "../src/app/plan.js";
import { withEffort } from "../src/core/routing.js";
import { planWrite, tuningOf, flexWords, speedCaption, heldFlat, TUNING_PATHS } from "../src/ui/harness/lib/families.js";
import { fakeUpstream, openaiReply, startApp } from "./helpers/app.js";

const FLEX = { flex: true, flexParams: { service_tier: "flex" }, flexMultiplier: 0.5 };

/** An OpenAI-format upstream and an Anthropic one, each model routed by its name. @param {Record<string, any>} [x] @param {Record<string, any>} [a] */
const cfgWith = (x = {}, a = {}) => ({
  rules: defaultsOf(RULES),
  upstreams: [
    { id: "x", type: "openai-compatible", enabled: true, baseUrl: "http://x", pricing: x },
    { id: "a", type: "anthropic", enabled: true, pricing: a },
  ],
  routes: [
    { match: "gpt-*", upstream: "x", upstreamModel: "{model}" },
    { match: "o5*", upstream: "x", upstreamModel: "{model}" },
    { match: "claude-*", upstream: "a", upstreamModel: "{model}" },
  ],
});
const row = (/** @type {string} */ id, /** @type {string} */ upstream) => ({ id, upstream, source: "discovered" });
const requestedOf = (/** @type {any} */ cfg, /** @type {string} */ name) => flexParse(cfg, parseModelSuffix(name, cfg.rules));

describe("the caps: a flex tier is the row's word, with the fields that ask for it", () => {
  test("declared with fields on an OpenAI-format wire; without fields it is said; Anthropic has none; nothing built in", () => {
    const cfg = cfgWith({ "gpt-6": { input: 2, output: 8, ...FLEX }, "gpt-lite": { flex: true } }, { "claude-opus-5-5": { ...FLEX } });
    assert.deepEqual(modelCapsFor(cfg, "gpt-6")?.flex, { available: true, declared: true, source: "operator", multiplier: 0.5, multiplierSource: "operator", params: { service_tier: "flex" } });
    assert.deepEqual(modelCapsFor(cfg, "gpt-lite")?.flex, { available: false, declared: true, source: "operator", multiplier: null, multiplierSource: null, params: null, missing: "params" });
    assert.equal(modelCapsFor(cfg, "claude-opus-5-5")?.flex.available, false, "no flex tier on the Anthropic wire");
    assert.deepEqual(modelCapsFor(cfg, "gpt-5")?.flex, { available: false, declared: null, source: null, multiplier: null, multiplierSource: null, params: null }, "nobody declared one: none");
  });

  test("the multiplier: above 0 and at most 1, the priced row's own, else the longest row that states one", () => {
    const up = { "gpt-6": { input: 2, output: 8, flexMultiplier: 0.25 }, gpt: { flexMultiplier: 0.5 } };
    assert.deepEqual(flexMultiplierFor("gpt-6", up), { value: 0.25, source: "operator" });
    assert.deepEqual(flexMultiplierFor("gpt-5", up), { value: 0.5, source: "operator" });
    assert.equal(flexMultiplierFor("gpt-6", { "gpt-6": { input: 2, flexMultiplier: 1.5 } }), null, "above 1 is not a flex price");
    assert.equal(flexMultiplierFor("gpt-6", { "gpt-6": { input: 2, flexMultiplier: 0 } }), null);
    // The price it multiplies is the priced row's, so that row's own multiplier beats a longer, unpriced one.
    assert.deepEqual(flexMultiplierFor("gpt-6-mini", { "gpt-6": { input: 2, flexMultiplier: 0.5 }, "gpt-6-mini": { flexMultiplier: 0.25 } }), { value: 0.5, source: "operator" });
    assert.deepEqual(flexMultiplierFor("gpt-6-mini", { "gpt-6": { input: 2 }, "gpt-6-mini": { flexMultiplier: 0.25 } }), { value: 0.25, source: "operator" }, "none on the priced row: the longest that states one");
    assert.deepEqual(priceCard("gpt-6", up, { flex: true }), { input: 0.5, output: 2, cacheRead: 0.5, cacheWrite: 0.5 }, "the card times the multiplier");
    assert.equal(estimateCost("gpt-6", { input: 1e6 }, { "gpt-6": { input: 2, output: 8 } }, { flex: true }), 2, "none stated: the standard price");
  });

  test("the config: flex is true or false, flexMultiplier above 0 and at most 1, flexParams an object", () => {
    const errs = (/** @type {any} */ r) => validateConfig(normalizeConfig({ upstreams: [{ id: "x", type: "openai-compatible", baseUrl: "http://x", pricing: { "gpt-6": r } }] })).errors.filter((e) => /pricing/.test(e));
    assert.deepEqual(errs({ ...FLEX }), []);
    assert.equal(errs({ flexMultiplier: 1.5 }).length, 1);
    assert.equal(errs({ flexMultiplier: 0 }).length, 1);
    assert.equal(errs({ flexParams: ["flex"] }).length, 1);
  });
});

describe("the name: Filament's -flex is read only where the model declares a flex tier", () => {
  const cfg = cfgWith({ "gpt-6": { input: 2, output: 8, ...FLEX } });
  test("read on a flex model, after the effort; a name that declares nothing stays itself; the suffix switch turns it off", () => {
    assert.deepEqual(requestedOf(cfg, "gpt-6-flex"), { base: "gpt-6", suffixEffort: null, suffixFast: false, original: "gpt-6-flex", suffixFlex: true });
    const high = requestedOf(cfg, "gpt-6-flex-high");
    assert.deepEqual([high.base, high.suffixEffort, high.suffixFlex], ["gpt-6", "high", true]);
    assert.deepEqual([requestedOf(cfg, "gpt-5-flex").base, requestedOf(cfg, "gpt-5-flex").suffixFlex], ["gpt-5-flex", false], "gpt-5 declares no flex: gpt-5-flex is a name of its own");
    assert.equal(requestedOf(cfg, "gpt-6").suffixFlex, false);
    const off = { ...cfg, rules: { ...cfg.rules, speed: { ...cfg.rules.speed, suffix: false } } };
    assert.equal(requestedOf(off, "gpt-6-flex").suffixFlex, false);
  });

  test("the session's model.flex on its name: before the effort, only where flex is declared, once", () => {
    assert.equal(withFlex("gpt-6", cfg, true), "gpt-6-flex");
    assert.equal(withFlex("gpt-6-high", cfg, true), "gpt-6-flex-high");
    assert.equal(withFlex("gpt-6-flex", cfg, true), "gpt-6-flex", "already on flex");
    assert.equal(withFlex("gpt-5", cfg, true), "gpt-5", "no flex tier: the name is not touched (gpt-5-flex would name another model)");
    assert.equal(withFlex("gpt-6", cfg, false), "gpt-6");
    const sent = withEffort(withFlex("gpt-6", cfg, true), "low", cfg, false);
    assert.equal(sent, "gpt-6-flex-low");
    const back = requestedOf(cfg, sent);
    assert.deepEqual([back.base, back.suffixEffort, back.suffixFlex], ["gpt-6", "low", true], "the parse reads back what the harness wrote");
  });
});

describe("the wire: the flex fields go out, and fast wins", () => {
  const cfg = cfgWith({ "gpt-6": { input: 2, output: 8, ...FLEX, fast: true, fastParams: { service_tier: "priority" } } });
  const caps = modelCapsFor(cfg, "gpt-6");
  const r = mergeRules(cfg.rules);
  test("Chat Completions and Responses take the row's fields; the change says so", () => {
    const out = shapeOpenAI({ body: { model: "gpt-6-flex", messages: [{ role: "user", content: "hi" }] }, rules: r, requested: requestedOf(cfg, "gpt-6-flex"), upstreamModel: "gpt-6", caps });
    assert.deepEqual([out.body.service_tier, out.body.model, out.flex, out.fast], ["flex", "gpt-6", true, false]);
    assert.ok(out.changes.includes('flex tier: service_tier = "flex" (from the -flex suffix)'), out.changes.join(" | "));
    const res = shapeResponses({ body: { model: "gpt-6-flex", input: "hi" }, rules: r, requested: requestedOf(cfg, "gpt-6-flex"), upstreamModel: "gpt-6", caps });
    assert.deepEqual([res.body.service_tier, res.flex], ["flex", true]);
    const plain = shapeOpenAI({ body: { model: "gpt-6", messages: [] }, rules: r, requested: requestedOf(cfg, "gpt-6"), upstreamModel: "gpt-6", caps });
    assert.deepEqual([plain.body.service_tier, plain.flex], [undefined, false]);
  });

  test("asked for fast and flex at once, fast goes out and the change says flex was not sent", () => {
    const both = { ...requestedOf(cfg, "gpt-6-flex-fast"), suffixFlex: true };
    const out = shapeOpenAI({ body: { model: "gpt-6-flex-fast", messages: [] }, rules: r, requested: both, upstreamModel: "gpt-6", caps });
    assert.deepEqual([out.body.service_tier, out.fast, out.flex], ["priority", true, false]);
    assert.ok(out.changes.includes("flex tier not sent: fast mode was asked for too, and wins"));
  });

  test("the planner reads the suffix too (a dry run of gpt-6-flex goes out on flex to gpt-6)", () => {
    const p = /** @type {any} */ (dryRunWith(() => cfg, () => null, { body: { model: "gpt-6-flex", messages: [{ role: "user", content: "hi" }] }, format: "openai" }, cfg));
    assert.equal(p.ok, true, JSON.stringify(p).slice(0, 300));
    assert.deepEqual([p.shaped?.body?.model ?? p.body?.model, p.shaped?.body?.service_tier ?? p.body?.service_tier], ["gpt-6", "flex"]);
  });

  test("the Anthropic shaper never sees a flex suffix it could act on", () => {
    const acfg = cfgWith({}, { "claude-opus-5-5": { ...FLEX } });
    assert.equal(requestedOf(acfg, "claude-opus-5-5-flex").suffixFlex, false, "no flex on that wire, so the name stays itself");
    const out = shapeAnthropic({ body: { model: "claude-opus-5-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }, rules: mergeRules(acfg.rules), requested: requestedOf(acfg, "claude-opus-5-5"), upstreamModel: "claude-opus-5-5", caps: modelCapsFor(acfg, "claude-opus-5-5") });
    assert.equal(out.body.service_tier, undefined);
  });
});

describe("the bill: flex at its price only when the reply says it was served there", () => {
  test("served as flex; another tier; no tier named; fields that name no tier", () => {
    const rec = { tokens: {}, speed: "flex", flexTier: "flex", changes: ["x"] };
    assert.deepEqual(usageAndCost(rec, { input: 10, tier: "flex" }), { tokens: { input: 10 }, servedTier: "flex" });
    const other = usageAndCost(rec, { input: 10, tier: "default" });
    assert.ok("speed" in other && other.speed === undefined, "the flex mark is cleared");
    assert.deepEqual(other.changes, ["x", 'the flex tier requested "flex"; the provider served "default" — billed at the standard price']);
    const none = usageAndCost(rec, { input: 10 });
    assert.ok("speed" in none && none.speed === undefined, "unconfirmed: the standard price (flex is the cheaper side)");
    assert.deepEqual(none.changes, ["x", 'the flex tier requested "flex"; the reply did not say which tier served it — billed at the standard price']);
    const blind = usageAndCost({ tokens: {}, speed: "flex", changes: [] }, { input: 1, tier: "flex" });
    assert.deepEqual(blind.changes, ["the flex tier's fields name no service_tier, so the reply cannot confirm it — billed at the standard price"]);
    assert.deepEqual(usageAndCost({ tokens: {}, changes: [] }, { input: 1, tier: "flex" }), { tokens: { input: 1 }, servedTier: "flex" }, "a request not sent on flex is not touched");
  });
});

describe("the picker: flex is a speed setting where the row declares it", () => {
  test("a model alone offers it beside fast, with its multiplier; ids that spell -flex keep choosing the id", () => {
    const cfg = cfgWith({ "gpt-6": { input: 2, output: 8, ...FLEX }, "gpt-7": { input: 2, output: 8, ...FLEX, fast: true, fastParams: { service_tier: "priority" }, fastMultiplier: 2 } });
    const fams = new Map(buildFamilies(cfg, [row("gpt-6", "x"), row("gpt-7", "x"), row("o5", "x"), row("o5-flex", "x"), row("gpt-5", "x")]).map((f) => [f.id, f]));
    assert.deepEqual(fams.get("gpt-6")?.speed, { via: "setting", options: ["standard", "flex"], flexMultiplier: 0.5, wire: "openai" });
    assert.deepEqual(fams.get("gpt-7")?.speed, { via: "setting", options: ["standard", "fast", "flex"], multiplier: 2, flexMultiplier: 0.5, wire: "openai" });
    assert.equal(fams.get("gpt-5")?.speed, null);
    const o5 = fams.get("o5");
    assert.deepEqual([o5?.kind, o5?.speed?.via, o5?.speed?.options], ["variants", "name", ["standard", "flex"]], "a provider's own -flex id is still a member");
  });

  test("the choice writes model.flex beside model.fast, one on and the other off; the tuning reads it back", () => {
    const f = /** @type {any} */ ({ id: "gpt-7", upstream: "x", kind: "model", members: [{ id: "gpt-7", effort: null, speed: null, thinking: null, window: null }], effort: null, speed: { via: "setting", options: ["standard", "fast", "flex"], flexMultiplier: 0.5 }, thinking: null, window: null });
    const want = (/** @type {string} */ speed) => /** @type {any} */ ({ effort: null, speed, thinking: "off", window: 0 });
    assert.deepEqual(planWrite(f, want("flex"), { eff: { name: "gpt-7" } }).patch, { model: { flex: true } });
    assert.deepEqual(planWrite(f, want("fast"), { eff: { name: "gpt-7", flex: true } }).patch, { model: { fast: true, flex: false } });
    assert.deepEqual(planWrite(f, want("standard"), { eff: { name: "gpt-7", flex: true } }).patch, { model: { flex: false } });
    const at = { family: f, member: f.members[0], fromName: {} };
    assert.equal(tuningOf(at, { flex: true }).speed, "flex");
    assert.equal(tuningOf(at, { flex: true, fast: true }).speed, "fast", "fast wins, as on the server");
    assert.equal(tuningOf({ ...at, family: { ...f, speed: { via: "setting", options: ["standard", "fast"] } } }, { flex: true }).speed, "standard", "a model without flex reads standard");
    assert.ok(TUNING_PATHS.includes("model.flex"), "Use the defaults unsets it too");
    assert.equal(flexWords(f), "the provider's cheaper tier, slower when it is busy, billed at 0.5× the price when it is served there");
    assert.equal(flexWords({ ...f, billing: "plan" }), "the provider's cheaper tier, slower when it is busy, 0.5× your plan's usage when it is served there");
    assert.equal(flexWords({ ...f, speed: { via: "setting", options: ["standard", "flex"] } }), "the provider's cheaper tier, slower when it is busy, at a lower price when it is served there");
  });

  test("a new chat's held choice: Flex rides the create call as model.flex, as Fast does as model.fast", () => {
    const f = /** @type {any} */ ({ id: "gpt-6", speed: { via: "setting", options: ["standard", "fast", "flex"] }, window: null, thinking: null });
    const t = /** @type {any} */ ({ effort: null, speed: "flex", window: null, thinking: "off" });
    assert.deepEqual(heldFlat(f, t), { "model.flex": true });
    assert.deepEqual(heldFlat(f, { ...t, speed: "fast" }), { "model.fast": true });
    assert.deepEqual(heldFlat(f, { ...t, speed: "standard" }), {});
    assert.deepEqual(heldFlat({ ...f, speed: { via: "name", options: ["standard", "flex"] } }, t), {}, "an id of its own: the name says it");
  });

  test("the Speed caption: on Standard it names every other tier the model has; on one, that tier's words", () => {
    const both = /** @type {any} */ ({ id: "gpt-6", vendor: "openai", price: { input: 2, output: 8 }, speed: { via: "setting", options: ["standard", "fast", "flex"], multiplier: 2, flexMultiplier: 0.5, wire: "openai" } });
    const std = speedCaption(both, "standard");
    assert.match(std, /^The model's normal speed and price\. Fast is .+ 2× the price .+\. Flex is the provider's cheaper tier, .+ 0\.5× the price when it is served there\.$/);
    assert.equal(speedCaption(both, "flex"), `Flex: ${flexWords(both)}.`);
    assert.match(speedCaption(both, "fast"), /^Fast: /);
    const flexOnly = { ...both, speed: { ...both.speed, options: ["standard", "flex"] } };
    assert.doesNotMatch(speedCaption(flexOnly, "standard"), /Fast/);
    assert.match(speedCaption({ ...both, speed: { via: "name", options: ["standard", "flex"] } }, "flex"), /^Flex: the provider's cheaper tier, slower when it is busy\.$/, "an id of its own: no price said");
  });
});

describe("through the proxy: a -flex request goes out on flex and bills by the tier the reply names", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let app;
  after(async () => { await app?.stop(); await up?.close(); });
  test("served as flex at half the price; served as default at the full price, and the record says why", async () => {
    let tier = "flex";
    up = await fakeUpstream((/** @type {any} */ call) => {
      if (call.method === "GET") return { json: { object: "list", data: [{ id: "gpt-6", object: "model" }] } };
      const r = /** @type {any} */ (openaiReply("ok", { model: call.body?.model, usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 } }));
      return { ...r, json: { ...r.json, service_tier: tier } };
    });
    app = await startApp({
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "x", name: "X", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: "k", enabled: true, pricing: { "gpt-6": { input: 2, output: 8, ...FLEX } } }];
        cfg.routes = [{ match: "gpt-*", upstream: "x", upstreamModel: "{model}", enabled: true }];
      },
    });
    const H = { "content-type": "application/json", authorization: `Bearer ${app.key}`, "x-api-key": app.key };
    const ask = async () => {
      const r = await fetch(`${app.url}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "gpt-6-flex", messages: [{ role: "user", content: "hi" }] }) });
      assert.equal(r.status, 200);
      await r.json();
    };
    await ask();
    const sent = up.received.filter((/** @type {any} */ c) => c.method === "POST").at(-1);
    assert.deepEqual([sent.body.model, sent.body.service_tier], ["gpt-6", "flex"], "the base model, on the flex tier");
    tier = "default";
    await ask();
    const recs = (await (await fetch(`${app.url}/api/requests?limit=5`, { headers: H })).json()).requests;
    const [late, first] = recs;
    assert.deepEqual([first.speed, first.servedTier, first.cost], ["flex", "flex", 1], "1M in at $2, served on flex at 0.5×");
    assert.deepEqual([late.speed ?? null, late.servedTier, late.cost], [null, "default", 2], "served on the default tier: the standard price");
    assert.ok((late.changes || []).some((/** @type {string} */ c) => /the provider served "default" — billed at the standard price/.test(c)), JSON.stringify(late.changes));
  });
});
