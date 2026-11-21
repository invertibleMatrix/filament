// @ts-check
// A model's tuning, end to end (HarnessV3 §15 item 92): what Filament knows about a family's effort levels, fast mode
// and windows (core/model-traits.js), the catalogue folded into families with their parameters
// (core/model-families.js), and the three settings reaching the wire from a harness turn — model.effort (which the
// loop's wrap used to drop), model.fast and model.window — plus a provider's own suffixed id travelling whole, fast
// mode priced at its multiplier, a retired rule default moving on, and the settings boundary said in words.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";

import { traitsOf, builtinEffortsOf } from "../src/core/model-traits.js";
import { parseVariant, buildFamilies, sessionWindowFor, effortOffer, windowOptionsFor } from "../src/core/model-families.js";
import { allowedEffortsFor, mergeRules } from "../src/core/shaping.js";
import { priceCard, estimateCost } from "../src/core/pricing.js";
import { listedWhole, listedParse } from "../src/core/routing.js";
import { defaultsOf, RULES } from "../src/core/schema.js";
import { normalizeConfig, validateConfig } from "../src/services/config/store.js";
import { familyName, planWrite } from "../src/ui/harness/lib/families.js";
import { createModelSelect, familyFacts } from "../src/ui/harness/composer/model.js";
import { createEffortControl } from "../src/ui/harness/composer/effort.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { settingsChangeOfLine } from "../src/app/sessions/service.js";
import { withEffort } from "../src/core/routing.js";
import { settingChangeWords } from "../src/ui/harness/lib/labels.js";
import { fakeUpstream, anthropicReply, openaiReply, startApp } from "./helpers/app.js";

const rules = () => mergeRules();

describe("model traits: what a family takes", () => {
  test("Claude, Grok and GPT families carry their levels, defaults and windows", () => {
    assert.deepEqual(builtinEffortsOf("claude-opus-5-5"), ["low", "medium", "high", "xhigh", "max"]);
    assert.equal(traitsOf("claude-opus-5-5")?.effortDefault, "high");
    assert.deepEqual(traitsOf("claude-opus-5-5")?.windows, [200_000, 1_000_000]);
    assert.deepEqual(builtinEffortsOf("claude-sonnet-4-6"), ["low", "medium", "high", "max"], "Sonnet 4.6 has no xhigh");
    assert.deepEqual(builtinEffortsOf("anthropic/claude-haiku-4-5-20251001"), [], "a dated Haiku takes no effort field");
    assert.deepEqual(builtinEffortsOf("grok-4.6"), ["low", "medium", "high"]);
    assert.deepEqual(builtinEffortsOf("grok-4.20-0309-non-reasoning"), []);
    assert.deepEqual(builtinEffortsOf("gpt-5.5"), ["low", "medium", "high", "xhigh"]);
    assert.deepEqual(builtinEffortsOf("gpt-5.6-sol"), ["low", "medium", "high", "xhigh", "max"]);
    assert.deepEqual(builtinEffortsOf("opus[1m]"), ["low", "medium", "high", "xhigh", "max"], "Claude Code's alias");
    assert.equal(builtinEffortsOf("glm-5.3"), null, "an unknown family is unknown, not everything");
    assert.equal(traitsOf("claude-fable-5")?.windows, undefined, "Fable 5 has one window; 5.1 has two");
    assert.deepEqual(traitsOf("claude-fable-5-1")?.windows, [200_000, 1_000_000]);
  });

  test("the wire narrows by the traits unless the operator's caps name the family", () => {
    assert.deepEqual([...allowedEffortsFor("grok-4.6", rules())].sort(), ["high", "low", "medium"], "max is never sent to a Grok");
    const own = mergeRules({ effort: { modelCaps: [{ match: "grok", allowed: ["low", "max"] }] } });
    assert.deepEqual([...allowedEffortsFor("grok-4.6", own)].sort(), ["low", "max"], "the operator's word wins for a family it names");
    assert.equal(allowedEffortsFor("glm-5.3", rules()).size, 5, "a family nobody knows keeps every allowed level");
  });

  test("the picker's effort offer: known levels, never a guess", () => {
    assert.deepEqual(effortOffer("claude-opus-5-5", rules()), { via: "setting", levels: ["low", "medium", "high", "xhigh", "max"], default: "high" });
    assert.equal(effortOffer("glm-5.3", rules()), null);
    assert.equal(effortOffer("claude-haiku-4-5", rules()), null, "no levels: nothing to offer");
    const noMax = mergeRules({ effort: { suffixes: ["low", "medium", "high", "xhigh"] } });
    assert.deepEqual(effortOffer("claude-opus-5-5", noMax)?.levels, ["low", "medium", "high", "xhigh"], "only levels the suffix can carry");
  });
});

describe("the catalogue as families", () => {
  test("parseVariant takes an id apart from its end, in any order", () => {
    assert.deepEqual(parseVariant("cursor/claude-opus-5-thinking-high-fast"), { base: "cursor/claude-opus-5", effort: "high", speed: "fast", thinking: "on", window: null });
    assert.deepEqual(parseVariant("cursor/gpt-5.5-extra-high"), { base: "cursor/gpt-5.5", effort: "xhigh", speed: null, thinking: null, window: null });
    assert.deepEqual(parseVariant("kimi-cn/k3-256k"), { base: "kimi-cn/k3", effort: null, speed: null, thinking: null, window: 256_000 });
    assert.deepEqual(parseVariant("claude-code/opus[1m]"), { base: "claude-code/opus", effort: null, speed: null, thinking: null, window: 1_000_000 });
    assert.deepEqual(parseVariant("grok-4.20-0309-non-reasoning"), { base: "grok-4.20-0309", effort: null, speed: null, thinking: "off", window: null });
    assert.equal(parseVariant("nw/glm-5.3-flash").base, "nw/glm-5.3-flash", "flash is a model, not a speed");
    assert.equal(parseVariant("nw/kimi-for-coding-highspeed").speed, "fast");
  });

  const cfg = () => ({
    rules: defaultsOf(RULES),
    upstreams: [
      { id: "a", type: "anthropic", enabled: true },
      { id: "x", type: "openai-compatible", enabled: true, baseUrl: "http://x" },
      { id: "cur", type: "acp", enabled: true, acp: { command: "agent" } },
      { id: "cc", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
    ],
    routes: [
      { match: "claude-*", upstream: "a", upstreamModel: "{model}" },
      { match: "grok-*", upstream: "x", upstreamModel: "{model}" },
      { match: "x/*", upstream: "x", upstreamModel: "{1}" },
      { match: "cursor/*", upstream: "cur", upstreamModel: "{1}" },
      { match: "cc/*", upstream: "cc", upstreamModel: "{1}" },
    ],
  });
  const row = (/** @type {string} */ id, /** @type {string} */ upstream, extra = {}) => ({ id, upstream, source: "discovered", ...extra });

  test("variant ids fold into one family; each axis needs two values to be one", () => {
    const rows = [
      ...["", "-low", "-high", "-low-fast", "-high-fast", "-fast"].map((s) => row(`cursor/grok-4.7${s}`, "cur", { codingAgent: true })),
      row("x/kimi-k3", "x"), row("x/kimi-k3-fast", "x"), row("x/kimi-k3-flex", "x"),
      row("x/qwen3", "x"), row("x/qwen3-max", "x"),
      row("cc/opus", "cc"), row("cc/opus[1m]", "cc"),
    ];
    const fams = buildFamilies(cfg(), rows);
    const byId = new Map(fams.map((f) => [f.id, f]));
    const grok = byId.get("cursor/grok-4.7");
    assert.equal(grok?.kind, "variants");
    assert.deepEqual(grok?.effort, { via: "name", levels: ["low", "high"], plain: true, default: "high" });
    assert.deepEqual(grok?.speed, { via: "name", options: ["standard", "fast"] });
    assert.equal(grok?.members.length, 6);
    assert.deepEqual(byId.get("x/kimi-k3")?.speed?.options, ["standard", "fast", "flex"]);
    assert.ok(byId.has("x/qwen3") && byId.has("x/qwen3-max"), "a lone effort word is two models, not a level");
    assert.equal(byId.get("x/qwen3-max")?.kind, "model");
    assert.deepEqual(byId.get("cc/opus")?.window?.options, [0, 1_000_000], "Claude Code's [1m] is the window axis");
    assert.equal(fams.findIndex((f) => f.id === "cursor/grok-4.7"), 0, "a family sits where its first member did");
  });

  test("a plain model's parameters are settings Filament applies — only where it takes them", () => {
    const fams = buildFamilies(cfg(), [row("claude-opus-5-5", "a"), row("claude-haiku-4-5", "a"), row("grok-4.6", "x"), row("cc/sonnet", "cc"), row("cursor/gpt-5.2", "cur")]);
    const byId = new Map(fams.map((f) => [f.id, f]));
    const opus = byId.get("claude-opus-5-5");
    assert.deepEqual(opus?.effort?.levels, ["low", "medium", "high", "xhigh", "max"]);
    assert.equal(opus?.effort?.via, "setting");
    assert.deepEqual(opus?.speed, { via: "setting", options: ["standard", "fast"], multiplier: 2, wire: "anthropic" }, "Opus 5.5 has fast mode on the Anthropic wire, at the pricing row's fastMultiplier");
    assert.deepEqual(opus?.window?.options, [200_000, 1_000_000]);
    assert.equal(byId.get("claude-haiku-4-5")?.effort, null);
    assert.equal(byId.get("claude-haiku-4-5")?.speed, null);
    assert.deepEqual(byId.get("grok-4.6")?.effort?.levels, ["low", "medium", "high"]);
    assert.equal(byId.get("grok-4.6")?.speed, null, "no fast mode on an OpenAI-format wire");
    assert.deepEqual(byId.get("cc/sonnet")?.effort?.levels, ["low", "medium", "high", "xhigh", "max"], "Claude Code takes effort as a session option");
    assert.equal(byId.get("cursor/gpt-5.2")?.effort, null, "Cursor's effort lives in its ids, never a setting");
  });

  test("a coding agent's own words name its families (HarnessV3-ACP AF2): the plain member's, never a member's that names its setting", () => {
    const words = (/** @type {string} */ label, note = "") => ({ codingAgent: true, label, ...(note ? { note } : {}) });
    const fams = buildFamilies(cfg(), [
      row("cc/opus[1m]", "cc", words("Opus (1M context)", "Opus 5 with 1M context · Best for everyday, complex tasks")),
      // Claude Code's `opus` comes as "Opus", which only spells its id: its listing keeps the description alone.
      row("cc/opus", "cc", { codingAgent: true, note: "Opus 5 · Best for everyday, complex tasks" }),
      row("cc/haiku", "cc", words("Haiku 4.5", "Haiku 4.5 · Fastest for quick answers")),
      row("cursor/grok-4.5-high", "cur", words("Grok 4.5")),
      row("cursor/grok-4.5-low", "cur", words("Grok 4.5 Low")),
      row("cursor/gpt-5.3-codex-low", "cur", words("Codex 5.3 Low")),
      row("cursor/gpt-5.3-codex", "cur", words("Codex 5.3")),
      row("cursor/gpt-5.3-codex-high", "cur", words("Codex 5.3 High")),
      row("cursor/auto", "cur", { codingAgent: true }),
    ]);
    const byId = new Map(fams.map((f) => [f.id, /** @type {any} */ (f)]));
    assert.deepEqual([byId.get("cc/opus")?.kind, "label" in byId.get("cc/opus"), byId.get("cc/opus")?.note], ["variants", false, "Opus 5 · Best for everyday, complex tasks"], "the plain member's words, none of opus[1m]'s");
    assert.deepEqual([byId.get("cc/haiku")?.kind, byId.get("cc/haiku")?.label], ["model", "Haiku 4.5"]);
    assert.deepEqual([byId.get("cursor/gpt-5.3-codex")?.kind, byId.get("cursor/gpt-5.3-codex")?.label], ["variants", "Codex 5.3"]);
    assert.equal(byId.get("cursor/grok-4.5")?.kind, "variants");
    assert.equal("label" in byId.get("cursor/grok-4.5"), false, "no plain member: no name, rather than one that says its setting");
    assert.equal("label" in byId.get("cursor/auto"), false);
    // The picker's row: the agent's name, and which model it means where its description names it first.
    const opus = byId.get("cc/opus");
    assert.equal(familyName(opus), "Opus");
    assert.deepEqual(familyFacts(opus)[0], { text: "Opus 5", title: "Opus 5 · Best for everyday, complex tasks" });
    assert.ok(!familyFacts(byId.get("cc/haiku")).some((c) => c.text === "Haiku 4.5"), "a description that names it as its name does adds nothing");
    assert.equal(familyName(byId.get("cursor/grok-4.5")), "Grok 4.5", "no name of its own: its id made readable");
    assert.ok(!familyFacts({ ...opus, note: "Latest frontier agentic coding model." }).some((c) => c.text.startsWith("Latest")), "a description in one piece is the title's, not a fact");
  });

  /** Kimi's coding plan as the owner has it (2026-09-30): k3 at 1M, k3-256k at 256K, tuned on the family's row. @param {any} [pricing] */
  const kimi = (pricing = {}) => ({
    ...cfg(),
    upstreams: [...cfg().upstreams, { id: "kc", type: "openai-compatible", enabled: true, baseUrl: "http://kc", pricing: {
      k3: { input: 0, output: 0, contextTokens: 1_000_000, efforts: ["low", "medium", "high", "xhigh", "max"], effortDefault: "max" },
      "k3-256k": { input: 0, output: 0, contextTokens: 256_000 },
      ...pricing,
    } }],
    routes: [...cfg().routes, { match: "kc/*", upstream: "kc", upstreamModel: "{1}" }],
  });
  const kimiRows = () => [row("kc/k3", "kc", { context_window: 1_000_000 }), row("kc/k3-256k", "kc", { context_window: 256_000 })];

  // (fails before: yes — a family folded by its window ids offered no effort: the picker showed 1M · 256K and no reasoning)
  test("a family folded by its window ids keeps the settings every member takes: Kimi's k3 and k3-256k both take model.effort", () => {
    const [f] = buildFamilies(kimi(), kimiRows());
    assert.equal(f.kind, "variants");
    assert.deepEqual(f.effort, { via: "setting", levels: ["low", "medium", "high", "xhigh", "max"], default: "max" });
    assert.deepEqual(f.window, { via: "name", options: [0, 256_000], standard: 1_000_000 });
    const narrower = buildFamilies(kimi({ "k3-256k": { input: 0, output: 0, contextTokens: 256_000, efforts: ["low", "high"] } }), kimiRows())[0];
    assert.deepEqual(narrower.effort, { via: "setting", levels: ["low", "high"], default: null }, "the levels all members take; the plain member's default only when they all take it");
    const one = buildFamilies(kimi({ "k3-256k": { input: 0, output: 0, contextTokens: 256_000, efforts: [] } }), kimiRows())[0];
    assert.equal(one.effort, null, "a member that takes no effort: none to offer the family");
    const x = cfg();
    x.upstreams[1] = { ...x.upstreams[1], pricing: { "kimi-k3": { efforts: ["low", "high"] } } };
    const speed = buildFamilies(x, [row("x/kimi-k3", "x"), row("x/kimi-k3-fast", "x")])[0];
    assert.deepEqual(speed.effort?.levels, ["low", "high"], "a family folded by its speed ids too");
    assert.deepEqual(speed.speed?.via, "name");
    const grok = buildFamilies(cfg(), ["", "-low", "-high"].map((x) => row(`cursor/grok-4.7${x}`, "cur", { codingAgent: true })))[0];
    assert.equal(grok.effort?.via, "name", "a family whose ids spell the levels keeps them as ids");
    // Ids that spell the levels on a model that also takes the setting: the ids are the choice, never both.
    const spelled = cfg();
    spelled.upstreams[1] = { ...spelled.upstreams[1], pricing: { m7: { efforts: ["low", "medium", "high"] } } };
    const m7 = buildFamilies(spelled, ["", "-low", "-high"].map((x) => row(`x/m7${x}`, "x")))[0];
    assert.deepEqual(m7.effort, { via: "name", levels: ["low", "high"], plain: true, default: null });
    const plainNone = buildFamilies(kimi({ k3: { input: 0, output: 0, contextTokens: 1_000_000, efforts: [] }, "k3-256k": { input: 0, output: 0, contextTokens: 256_000, efforts: ["low", "high"] } }), kimiRows())[0];
    assert.equal(plainNone.effort, null, "the plain member takes none: the family offers none, whatever its variant takes");
  });

  test("picking a window of such a family picks its name, and the effort rides as the setting", () => {
    const [f] = buildFamilies(kimi(), kimiRows());
    const w = planWrite(/** @type {any} */ (f), { effort: "high", speed: "standard", thinking: "off", window: 256_000 }, { eff: { name: "kc/k3", effort: null } });
    assert.deepEqual(w, { name: "kc/k3-256k", patch: { model: { name: "kc/k3-256k", effort: "high" } } });
    const back = planWrite(/** @type {any} */ (f), { effort: "high", speed: "standard", thinking: "off", window: 0 }, { eff: { name: "kc/k3-256k", effort: "high" } });
    assert.deepEqual(back, { name: "kc/k3", patch: { model: { name: "kc/k3" } } }, "the effort already stands; only the name moves");
  });

  // (fails before: yes — a plan's window that costs twice had nowhere to say it)
  test("what each window costs against the cheapest: the family row's windowMultipliers, else their own prices", () => {
    const stated = buildFamilies(kimi({ k3: { input: 0, output: 0, contextTokens: 1_000_000, windowMultipliers: { "1000000": 2 } } }), kimiRows())[0];
    assert.deepEqual(stated.window?.multipliers, { "0": 2 }, "the plain member's standard window, twice the 256K one");
    const priced = buildFamilies(kimi({ k3: { input: 2, output: 10, contextTokens: 1_000_000 }, "k3-256k": { input: 1, output: 5, contextTokens: 256_000 } }), kimiRows())[0];
    assert.deepEqual(priced.window?.multipliers, { "0": 2 }, "priced apart: the ratio of their output prices");
    assert.equal(buildFamilies(kimi(), kimiRows())[0].window?.multipliers, undefined, "nobody says: nothing shown");
    const dearVariant = buildFamilies(kimi({ k3: { input: 0, output: 0, contextTokens: 1_000_000, windowMultipliers: { "256000": 1.5 } } }), kimiRows())[0];
    assert.deepEqual(dearVariant.window?.multipliers, { "256000": 1.5 }, "the dearer window may be the variant's own name");
    const junk = buildFamilies(kimi({ k3: { input: 0, output: 0, contextTokens: 1_000_000, windowMultipliers: { "1000000": 2, "256000": 0.5, "12": 3 } } }), kimiRows())[0];
    assert.deepEqual(junk.window?.multipliers, { "0": 2 }, "an entry under 1 or not a window is never read (the save refuses them too)");
    assert.equal(familyFacts(stated)[0].text, "256K–1M", "the facts line spans the family's windows");
  });

  test("a family on a subscription plan says so (Providers P4): billing on the variants family and on a model alone, never on a metered one", () => {
    const sub = (/** @type {any} */ pricing = {}) => { const c = kimi(pricing); c.upstreams = c.upstreams.map((u) => (u.id === "kc" ? { ...u, billing: "plan" } : u)); return c; };
    const [f] = buildFamilies(sub({ k3: { input: 2, output: 10, contextTokens: 1_000_000 } }), kimiRows());
    assert.deepEqual([f.kind, f.billing], ["variants", "plan"]);
    assert.equal(buildFamilies(kimi(), kimiRows())[0].billing, undefined, "metered: nothing");
    const [alone] = buildFamilies(sub(), [row("kc/k3", "kc", { context_window: 1_000_000 })]);
    assert.deepEqual([alone.kind, alone.billing], ["model", "plan"]);
    const priced = familyFacts(/** @type {any} */ ({ ...f, price: { input: 2, output: 10 } })).find((c) => c.text === "$2.00 · $10.00" || /\$2/.test(c.text));
    assert.match(String(priced?.title), /^On your plan: paid \$0, the plan's usage instead\. At list price: /);
    assert.ok(familyFacts(/** @type {any} */ ({ ...f, price: null })).some((c) => c.text === "On your plan"), "unpriced: the plan said on its own");
    assert.ok(!familyFacts(/** @type {any} */ ({ ...f, billing: undefined, price: null })).some((c) => c.text === "On your plan"));
  });

  test("windowMultipliers is validated like the other tune fields", () => {
    const bad = (/** @type {any} */ m) => validateConfig(normalizeConfig({ ...kimi(), upstreams: [{ id: "kc", type: "openai-compatible", baseUrl: "http://kc", pricing: { k3: { windowMultipliers: m } } }] })).errors.filter((e) => /windowMultipliers/.test(e));
    assert.equal(bad({ "1000000": 2 }).length, 0);
    assert.equal(bad({ "1000000": 0.5 }).length, 1, "under 1: the cheapest is 1");
    assert.equal(bad({ "12": 2 }).length, 1, "not a window");
    assert.equal(bad([2]).length, 1);
  });

  test("the window a session works in: its choice when the model offers it", () => {
    const c = { ...cfg(), pricing: {} };
    assert.deepEqual(windowOptionsFor(c, "claude-opus-5-5"), [200_000, 1_000_000]);
    assert.deepEqual(sessionWindowFor(c, "claude-opus-5-5", 1_000_000), { tokens: 1_000_000, source: "session" });
    assert.equal(sessionWindowFor(c, "claude-opus-5-5", null).tokens, 200_000);
    assert.equal(sessionWindowFor(c, "claude-haiku-4-5", 1_000_000).tokens, 200_000, "a window the model does not offer is ignored");
    assert.equal(sessionWindowFor(c, "claude-opus-5-5", 777_000).tokens, 200_000);
  });

  test("a provider's own suffixed id travels whole when its upstream lists it", () => {
    const c = { ...cfg(), upstreams: [...cfg().upstreams.slice(0, 1), { id: "x", type: "openai-compatible", enabled: true, baseUrl: "http://x", models: ["kimi-k3", "kimi-k3-fast"] }] };
    assert.equal(listedWhole(c, "x/kimi-k3-fast"), true);
    assert.equal(listedWhole(c, "x/kimi-k3-high"), false, "a suffix on a listed base is still Filament's");
    assert.equal(listedWhole(c, "claude-opus-5-5-high"), false);
    assert.equal(listedWhole(c, "x/Kimi-K3-Fast"), true, "the list is read without case");
    const shouty = { ...c, upstreams: [c.upstreams[0], { ...c.upstreams[1], models: ["Kimi-K3", "Kimi-K3-Fast"] }] };
    assert.equal(listedWhole(shouty, "x/kimi-k3-fast"), true, "a gateway that lists its ids in capitals");
  });

  test("a level rides a provider's own id after it, and only the words after it are read", () => {
    const c = { ...cfg(), upstreams: [...cfg().upstreams.slice(0, 1), { id: "x", type: "openai-compatible", enabled: true, baseUrl: "http://x", models: ["kimi-k3", "kimi-k3-fast", "qwen3", "qwen3-max"] }] };
    assert.equal(withEffort("x/kimi-k3-fast", "high", c), "x/kimi-k3-fast-high", "re-joined from its parse it would be kimi-k3 in fast mode");
    assert.equal(withEffort("x/qwen3-max", "high", c), "x/qwen3-max-high");
    assert.equal(withEffort("x/qwen3-max", "max", c), "x/qwen3-max-max");
    assert.deepEqual(listedParse(c, "x/kimi-k3-fast-high"), { base: "x/kimi-k3-fast", suffixEffort: "high", suffixFast: false, original: "x/kimi-k3-fast-high" });
    assert.deepEqual(listedParse(c, "x/qwen3-max-fast"), { base: "x/qwen3-max", suffixEffort: null, suffixFast: true, original: "x/qwen3-max-fast" });
    assert.deepEqual(listedParse(c, "x/kimi-k3-fast"), { base: "x/kimi-k3-fast", suffixEffort: null, suffixFast: false, original: "x/kimi-k3-fast" });
    assert.equal(listedParse(c, "x/kimi-k3"), null, "nothing to peel");
    assert.equal(listedParse(c, "claude-opus-5-5-high"), null, "no listed start: the plain parse stands");
  });

  test("fast mode rides a provider's id that ends in its own -fast: the parse stage's reading decides, not the plain one", () => {
    const c = { ...cfg(), upstreams: [...cfg().upstreams.slice(0, 1), { id: "x", type: "openai-compatible", enabled: true, baseUrl: "http://x", models: ["kimi-k3", "kimi-k3-fast"] }] };
    assert.equal(withEffort("x/kimi-k3-fast", null, c, true), "x/kimi-k3-fast-fast", "the id's own -fast is its name, not fast mode");
    assert.deepEqual(listedParse(c, "x/kimi-k3-fast-fast"), { base: "x/kimi-k3-fast", suffixEffort: null, suffixFast: true, original: "x/kimi-k3-fast-fast" });
    assert.equal(withEffort("x/kimi-k3-fast", "high", c, true), "x/kimi-k3-fast-high-fast");
    assert.deepEqual(listedParse(c, "x/kimi-k3-fast-high-fast"), { base: "x/kimi-k3-fast", suffixEffort: "high", suffixFast: true, original: "x/kimi-k3-fast-high-fast" });
    assert.equal(withEffort("x/kimi-k3-fast", "high", c), "x/kimi-k3-fast-high", "no fast asked: none added");
    assert.equal(withEffort("claude-opus-5-5-fast", null, cfg(), true), "claude-opus-5-5-fast", "Filament's own -fast is not doubled");
    assert.equal(withEffort("claude-opus-5-5", "high", cfg(), true), "claude-opus-5-5-high-fast");
  });
});

describe("the picker names a coding agent's models in its own words (HarnessV3-ACP AF2)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  /** A coding agent's model alone, as `/api/models` folds one. @param {Record<string, any>} o @returns {any} */
  const fam = (o) => ({ upstream: "cc", kind: "model", members: [{ id: o.id, effort: null, speed: null, thinking: null, window: null }], effort: null, speed: null, thinking: null, window: null, codingAgent: true, ...o });
  const haiku = fam({ id: "cc/haiku", label: "Haiku 4.5", note: "Haiku 4.5 · Fastest for quick answers" });
  const opus = fam({ id: "cc/opus", note: "Opus 5 · Best for everyday, complex tasks" });

  test("the chip, the rows, a row's facts and title, and the footer say its name; a search finds its words", () => {
    const body = /** @type {any} */ (doc.document.body);
    body.replaceChildren();
    const s = /** @type {any} */ (createModelSelect({ onPick: () => {} }));
    s.setFamilies([haiku, opus]);
    s.set("cc/haiku");
    assert.equal(s.el.querySelector(".model-name").textContent, "Haiku 4.5");
    s.el.onclick({ stopPropagation() {} });
    const rows = body.querySelectorAll(".mp-row");
    assert.deepEqual(rows.map((/** @type {any} */ r) => r.querySelector(".mp-row-name").textContent), ["Haiku 4.5", "Opus"]);
    assert.equal(rows[1].getAttribute("title"), "cc/opus\nOpus 5 · Best for everyday, complex tasks");
    assert.equal(rows[1].querySelector(".mp-fact").textContent, "Opus 5", "which Opus, first");
    assert.equal(body.querySelector(".mp-foot-note").textContent, "Haiku 4.5");
    const search = body.querySelector(".mp-search-input");
    search.value = "opus 5";
    search.oninput();
    assert.deepEqual(body.querySelectorAll(".mp-row-name").map((/** @type {any} */ r) => r.textContent), ["Opus"]);
  });

  test("the tuning popover's title is the agent's name for its model", () => {
    const body = /** @type {any} */ (doc.document.body);
    body.replaceChildren();
    const c = createEffortControl();
    c.setFamily({ ...haiku, effort: { via: "setting", levels: ["low", "high"], default: null } }, null);
    c.open();
    assert.equal(body.querySelector(".inst-title").textContent, "Haiku 4.5");
  });
});

describe("the wire names and the bill", () => {
  const c = { rules: defaultsOf(RULES) };
  test("withEffort joins fast mode as the -fast suffix, once", () => {
    assert.equal(withEffort("claude-opus-5-5", "high", c, true), "claude-opus-5-5-high-fast");
    assert.equal(withEffort("claude-opus-5-5", null, c, true), "claude-opus-5-5-fast");
    assert.equal(withEffort("claude-opus-5-5-fast", "low", c, true), "claude-opus-5-5-low-fast");
    assert.equal(withEffort("claude-opus-5-5", "high", c, false), "claude-opus-5-5-high");
    const noFast = { rules: { ...defaultsOf(RULES), speed: { ...defaultsOf(RULES).speed, suffix: false } } };
    assert.equal(withEffort("claude-opus-5-5", null, noFast, true), "claude-opus-5-5", "no suffix to carry it: nothing appended");
  });

  test("a fast request is priced at the row's multiplier", () => {
    assert.deepEqual(priceCard("claude-opus-5-5", null, { fast: true }), { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10 });
    assert.deepEqual(priceCard("claude-sonnet-5", null, { fast: true }), priceCard("claude-sonnet-5", null), "no multiplier: the standard price");
    const own = { "claude-opus-5-5": { input: 3, output: 15 } };
    assert.equal(priceCard("claude-opus-5-5", own, { fast: true })?.input, 6, "an operator's card keeps the built-in multiplier");
    assert.equal(estimateCost("claude-opus-5-5", { input: 1e6, output: 0 }, null, { fast: true }), 8);
  });

  // (fails before: yes — a line whose value is not JSON, which no writer makes, was read as a change to that text,
  // and a one-time move's lines were singled out by their "(moved)" ending; HarnessV3-AtHome AH-C1)
  test("a settings line reads as its change, and a line no writer makes as none", () => {
    assert.deepEqual(settingsChangeOfLine('model.effort: "low"'), { path: "model.effort", to: "low" });
    assert.deepEqual(settingsChangeOfLine("model.effort: inherits again"), { path: "model.effort" });
    assert.deepEqual(settingsChangeOfLine('display.title: "Refactor (moved)"'), { path: "display.title", to: "Refactor (moved)" });
    assert.equal(settingsChangeOfLine("model.effort: raised for the review"), null);
    assert.equal(settingsChangeOfLine("no separator"), null);
  });

  test("a settings change reads in words, never a path and JSON", () => {
    assert.equal(settingChangeWords("model.effort", "xhigh"), "Effort: Extra high");
    assert.equal(settingChangeWords("model.effort"), "Effort: the model's default");
    assert.equal(settingChangeWords("model.fast", true), "Fast mode on");
    assert.equal(settingChangeWords("model.window", 1_000_000), "Context window: 1M");
    assert.equal(settingChangeWords("loop.permissions", "ask"), "Permissions: Ask before changes");
    assert.equal(settingChangeWords("context.view.stubChars", 200), "view.stubChars: 200");
  });
});

describe("a harness turn carries the tuning to the wire", () => {
  /** @type {any[]} */
  const seen = [];
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    up = await fakeUpstream(async (call) => {
      if (call.kind === "anthropic") {
        seen.push({ kind: "anthropic", model: call.body?.model, effort: call.body?.output_config?.effort ?? null, thinking: call.body?.thinking?.type ?? null, speed: call.body?.speed ?? null, beta: call.headers?.["anthropic-beta"] ?? "" });
        return anthropicReply("ok", { model: call.body?.model, usage: { input_tokens: 1000, output_tokens: 100 } });
      }
      if (call.kind === "openai") {
        seen.push({ kind: "openai", model: call.body?.model, effort: call.body?.reasoning_effort ?? null });
        return openaiReply("ok", { model: call.body?.model });
      }
      return undefined;
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "a", name: "Anthropic", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, models: ["claude-opus-5-5"] },
          { id: "x", name: "X", type: "openai-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, models: ["kimi-k3", "kimi-k3-fast"] },
        ];
        cfg.routes = [
          { match: "claude-*", upstream: "a", upstreamModel: "{model}", enabled: true },
          { match: "x/*", upstream: "x", upstreamModel: "{1}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [process.cwd()] };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });
  const session = async (/** @type {string} */ model) => (await (await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model, title: "tuning" } })).json()).id;
  const patch = (/** @type {string} */ id, /** @type {any} */ body) => shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body });
  const turn = async (/** @type {string} */ id, text = "hi") => {
    seen.length = 0;
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: text, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
    return seen.slice();
  };

  test("model.effort reaches the wire (the loop's wrap used to drop it); max needs thinking", async () => {
    const id = await session("claude-opus-5-5");
    await patch(id, { patch: { model: { effort: "max" } } });
    let calls = await turn(id);
    assert.equal(calls[0].effort, "high", "thinking off: the rules cap max at high (Opus rejects it otherwise)");
    await patch(id, { patch: { model: { thinking: { budget: 16000 } } } });
    calls = await turn(id);
    assert.equal(calls[0].effort, "max");
    assert.equal(calls[0].thinking, "adaptive");
  });

  test("model.fast sends fast mode with its beta, and the record bills it double", async () => {
    const id = await session("claude-opus-5-5");
    await patch(id, { patch: { model: { fast: true } } });
    const calls = await turn(id);
    assert.equal(calls[0].speed, "fast");
    assert.match(calls[0].beta, /fast-mode-2026-02-01/);
    const recs = await shim.records(20);
    const tick = recs.find((/** @type {any} */ r) => r.upstreamModel === "claude-opus-5-5" && r.speed === "fast");
    assert.ok(tick, "the tick's record says it went out fast");
    assert.equal(tick.cost, estimateCost("claude-opus-5-5", tick.tokens, null, { fast: true }));
  });

  test("model.window moves the session's window, said as its choice", async () => {
    const id = await session("claude-opus-5-5");
    let s = await (await patch(id, { patch: { model: { window: 1_000_000 } } })).json();
    assert.deepEqual({ tokens: s.window?.tokens, source: s.window?.source }, { tokens: 1_000_000, source: "session" });
    s = await (await patch(id, { patch: { model: { window: 64_000 } } })).json();
    assert.equal(s.window?.tokens, 200_000, "a window the model does not offer leaves the standard one");
  });

  test("a provider's own -fast id is sent whole", async () => {
    const id = await session("x/kimi-k3-fast");
    let calls = await turn(id);
    assert.equal(calls[0].model, "kimi-k3-fast");
    await patch(id, { patch: { model: { effort: "high" } } });
    calls = await turn(id);
    assert.deepEqual({ model: calls[0].model, effort: calls[0].effort }, { model: "kimi-k3-fast", effort: "high" }, "the session's level rides the provider's id, which stays whole");
  });

  test("the catalogue answers with its families", async () => {
    const j = await (await shim.api("/api/models?all=1")).json();
    const opus = (j.families || []).find((/** @type {any} */ f) => f.id === "claude-opus-5-5");
    assert.ok(opus, JSON.stringify((j.families || []).map((/** @type {any} */ f) => f.id)));
    assert.equal(opus.speed?.via, "setting");
    const kimi = (j.families || []).find((/** @type {any} */ f) => f.id === "x/kimi-k3");
    assert.deepEqual(kimi?.speed?.options, ["standard", "fast"]);
  });

  test("a settings boundary carries what moved, for the row's words", async () => {
    const id = await session("claude-opus-5-5");
    await turn(id, "one");
    await patch(id, { patch: { model: { effort: "low" } } });
    await turn(id, "two");
    const t = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    const b = (t.boundaries || []).find((/** @type {any} */ x) => x.type === "settings");
    assert.ok(b, JSON.stringify(t.boundaries));
    assert.deepEqual(b.changes, [{ path: "model.effort", to: "low" }]);
  });
});
