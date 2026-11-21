// @ts-check
// A sub-agent's model as a person names it (HarnessV4_Tasks E23, E23.5): core/model-choice.js — matched against the
// picker's models at the provider named, why it cannot run in words a person acts on, the effort it runs at, and the
// list a launcher reads.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { chatEffortOf, chooseModel, effortOf, modelList } from "../src/core/model-choice.js";
import { buildFamilies } from "../src/core/model-families.js";
import { defaultsOf, RULES } from "../src/core/schema.js";

/** Two providers serving Kimi K3, one switched off, Anthropic with two models hidden, and three coding agents. @returns {any} */
const cfg = () => ({
  rules: defaultsOf(RULES),
  upstreams: [
    { id: "openrouter", name: "OpenRouter", type: "openai-compatible", enabled: true, baseUrl: "https://openrouter.ai/api/v1" },
    { id: "kimi", name: "Kimi (Moonshot)", type: "openai-compatible", enabled: true, baseUrl: "https://api.moonshot.ai/v1", pricing: { "kimi-k3": { input: 0.6, output: 2.5, efforts: ["low", "medium", "high"] } } },
    { id: "zai", name: "Z.AI (GLM)", type: "openai-compatible", enabled: false, baseUrl: "https://api.z.ai/api/coding/paas/v4" },
    { id: "anthropic", name: "Anthropic", type: "anthropic", enabled: true, hiddenModels: ["claude-opus-4-1", "claude-sonnet-4-6"] },
    { id: "codex", name: "Codex", type: "codex", enabled: true, acp: { command: "codex", args: ["app-server"] } },
    { id: "cc", name: "Claude Code", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
    { id: "cur", name: "Cursor", type: "acp", enabled: true, acp: { command: "agent" } },
  ],
  routes: [
    { match: "openrouter/*", upstream: "openrouter", upstreamModel: "{1}" },
    { match: "kimi/*", upstream: "kimi", upstreamModel: "{1}" },
    { match: "zai/*", upstream: "zai", upstreamModel: "{1}" },
    { match: "codex/*", upstream: "codex", upstreamModel: "{1}" },
    { match: "claude-code/*", upstream: "cc", upstreamModel: "{1}" },
    { match: "cursor/*", upstream: "cur", upstreamModel: "{1}" },
    { match: "claude-*", upstream: "anthropic", upstreamModel: "{model}" },
  ],
});
const row = (/** @type {string} */ id, /** @type {string} */ upstream, extra = {}) => ({ id, upstream, source: "discovered", ...extra });
/** The picker's rows, in its order. */
const rows = () => [
  row("openrouter/moonshotai/kimi-k3", "openrouter"),
  row("openrouter/openai/gpt-5.6-sol", "openrouter"),
  row("openrouter/qwen/qwen3", "openrouter"),
  row("openrouter/qwen/qwen3-max", "openrouter"),
  row("kimi/kimi-k3", "kimi"),
  row("claude-opus-5-5", "anthropic"),
  row("codex/gpt-5.6-sol", "codex", { codingAgent: true, label: "GPT Sol" }),
  row("claude-code/opus", "cc", { codingAgent: true, label: "Opus" }),
  ...["", "-low", "-high"].map((s) => row(`cursor/grok-4.7${s}`, "cur", { codingAgent: true })),
];
/**
 * @param {{ c?: any, list?: any[], problems?: Record<string, string>, accounts?: Record<string, any>,
 *   agents?: import("../src/core/model-choice.js").AgentEntry[], reading?: boolean }} [o]
 * @returns {import("../src/core/model-choice.js").Book}
 */
const bookOf = ({ c = cfg(), list = rows(), problems = {}, accounts = {}, agents = [], reading = false } = {}) => ({
  cfg: c,
  families: reading ? [] : buildFamilies(c, list),
  reading,
  problem: (m) => problems[m] || null,
  account: (id) => accounts[id] || null,
  agents: () => agents,
  now: 1_000_000,
});
const error = (/** @type {import("../src/core/model-choice.js").Choice} */ x) => (x.ok ? assert.fail(`chose ${x.model}`) : x.error);
const chosen = (/** @type {import("../src/core/model-choice.js").Choice} */ x) => (x.ok ? x.model : assert.fail(x.error));

describe("a sub-agent's model as a person names it", () => {
  test("a model two providers serve runs on the first that can, the other named; provider chooses", () => {
    const b = bookOf();
    assert.deepEqual(chooseModel("Kimi K3", null, b), { ok: true, model: "openrouter/moonshotai/kimi-k3", upstream: "openrouter", note: "Kimi (Moonshot) serves it too: name its provider to choose." });
    assert.deepEqual(chooseModel("Kimi K3", "Moonshot", b), { ok: true, model: "kimi/kimi-k3", upstream: "kimi", note: "" });
    assert.deepEqual(chooseModel("kimi-k3", "kimi", b), { ok: true, model: "kimi/kimi-k3", upstream: "kimi", note: "" }, "the provider by its id");
    const down = bookOf({ problems: { "openrouter/moonshotai/kimi-k3": "OpenRouter has no key" } });
    assert.deepEqual(chooseModel("Kimi K3", null, down), { ok: true, model: "kimi/kimi-k3", upstream: "kimi", note: "OpenRouter's openrouter/moonshotai/kimi-k3 can't run now (OpenRouter has no key)." });
    const none = bookOf({ problems: { "openrouter/moonshotai/kimi-k3": "no key", "kimi/kimi-k3": "switched off" } });
    assert.equal(error(chooseModel("Kimi K3", null, none)), `"Kimi K3" can't run now at any of its 2 providers: OpenRouter's openrouter/moonshotai/kimi-k3: no key; Kimi (Moonshot)'s kimi/kimi-k3: switched off`);
    assert.equal(error(chooseModel("Kimi K3", "Codex", b)), `"Kimi K3" isn't at Codex: openrouter/moonshotai/kimi-k3 (OpenRouter), kimi/kimi-k3 (Kimi (Moonshot)) serve it`);
  });

  test("a coding agent's model by its own name; the same model at a provider and an agent", () => {
    const b = bookOf();
    assert.deepEqual(chooseModel("GPT Sol", null, b), { ok: true, model: "codex/gpt-5.6-sol", upstream: "codex", note: "" });
    assert.deepEqual(chooseModel("gpt sol", "Codex", b), { ok: true, model: "codex/gpt-5.6-sol", upstream: "codex", note: "" });
    assert.deepEqual(chooseModel("gpt 5.6 sol", null, b), { ok: true, model: "openrouter/openai/gpt-5.6-sol", upstream: "openrouter", note: "Codex serves it too: name its provider to choose." });
    assert.equal(chosen(chooseModel("opus", "Claude Code", b)), "claude-code/opus");
  });

  test("a coding agent that can't serve says why: signed out, plan used up, not connected, turned off, not here, no models", () => {
    const signedOut = bookOf({ accounts: { codex: { signedOut: true, spent: false, freeAt: null } } });
    assert.equal(error(chooseModel("GPT Sol", "Codex", signedOut)), "codex/gpt-5.6-sol can't run now: Codex is signed out: sign in on its account widget, or in Settings › Coding agents");
    const spent = bookOf({ accounts: { codex: { signedOut: false, spent: true, freeAt: 1_000_000 + 25 * 60_000 } } });
    assert.equal(error(chooseModel("GPT Sol", null, spent)), "codex/gpt-5.6-sol can't run now: Codex's plan is used up: it is free again in 25 min");
    const gone = cfg();
    gone.upstreams = gone.upstreams.filter((u) => u.id !== "codex");
    const noCodex = rows().filter((r) => r.upstream !== "codex");
    const ready = bookOf({ c: gone, list: noCodex, agents: [{ id: "codex", name: "Codex", state: "ready" }] });
    assert.equal(error(chooseModel("GPT Sol", "Codex", ready)), "Codex isn't connected. It is installed here: Connect it in Settings › Coding agents");
    assert.equal(
      error(chooseModel("GPT Sol", null, ready)),
      `no model like "GPT Sol" in your list of models. The nearest: openrouter/openai/gpt-5.6-sol (OpenRouter). Coding agents whose models aren't in it: Codex isn't connected. It is installed here: Connect it in Settings › Coding agents. To see them all, call with list_models.`,
    );
    const missing = bookOf({ c: gone, list: noCodex, agents: [{ id: "codex", name: "Codex", state: "missing" }] });
    assert.equal(error(chooseModel("GPT Sol", "Codex", missing)), "Codex isn't on this computer: install it from Settings › Coding agents, then Connect it");
    const off = cfg();
    off.upstreams = off.upstreams.map((u) => (u.id === "codex" ? { ...u, enabled: false, acp: { ...u.acp, turnedOff: true } } : u));
    assert.equal(error(chooseModel("GPT Sol", "Codex", bookOf({ c: off, list: noCodex, agents: [{ id: "codex", name: "Codex", state: "off" }] }))), "Codex is turned off: turn it on in Settings › Coding agents");
    const empty = bookOf({ list: noCodex, agents: [{ id: "codex", name: "Codex", state: "connected" }] });
    assert.equal(error(chooseModel("GPT Sol", "Codex", empty)), "Codex lists no models yet: ask for its models again with ↻ on its card in Settings › Coding agents");
  });

  // (fails before: yes — the route's first account alone was said, with its own reset time though the other's plan was
  // free sooner: the E23 drive)
  test("a route of two accounts: each said in the route's order, a used-up plan with when it is free; one heard nothing of runs", () => {
    const c = cfg();
    c.upstreams.push({ id: "codex-home", name: "Codex · Home", type: "codex", enabled: true, acp: { command: "codex", args: ["app-server"] } });
    c.routes = c.routes.map((/** @type {any} */ r) => (r.upstream === "codex" ? { ...r, fallbacks: ["codex-home"] } : r));
    c.rules.resilience.failover = true; // off until switched on (the owner's of 11-09)
    const spentFor = (/** @type {number} */ min) => ({ signedOut: false, spent: true, freeAt: 1_000_000 + min * 60_000 });
    const both = bookOf({ c, accounts: { codex: spentFor(180), "codex-home": spentFor(25) } });
    assert.equal(error(chooseModel("GPT Sol", "Codex", both)), "codex/gpt-5.6-sol can't run now: Codex's plan is used up: it is free again in 3 h; Codex · Home's plan is used up: it is free again in 25 min");
    const mixed = bookOf({ c, accounts: { codex: { signedOut: true, spent: false, freeAt: null }, "codex-home": spentFor(25) } });
    assert.equal(error(chooseModel("GPT Sol", "Codex", mixed)), "codex/gpt-5.6-sol can't run now: Codex is signed out: sign in on its account widget, or in Settings › Coding agents; Codex · Home's plan is used up: it is free again in 25 min");
    assert.equal(chosen(chooseModel("GPT Sol", "Codex", bookOf({ c, accounts: { codex: spentFor(180) } }))), "codex/gpt-5.6-sol", "the route fails over to the account it has heard nothing of");
  });

  // (fails before: yes — `claude-code-workcredits` reached every account of Claude Code, its id holding the agent's, and
  // the first in the picker's order ran: the owner's of 11-06)
  test("an account of a coding agent named by its own id or name is that one alone; the agent's name, each of them", () => {
    const c = cfg();
    c.upstreams.push(
      { id: "claude-code-work", name: "Claude Code · Work", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
      { id: "claude-code-workcredits", name: "Claude Code · WorkCredits", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
    );
    const list = [...rows(), row("claude-code-work/opus", "claude-code-work", { codingAgent: true, label: "Opus" }), row("claude-code-workcredits/opus", "claude-code-workcredits", { codingAgent: true, label: "Opus" })];
    const b = bookOf({ c, list });
    assert.equal(chosen(chooseModel("Opus", "claude-code-workcredits", b)), "claude-code-workcredits/opus");
    assert.equal(chosen(chooseModel("Opus", "Claude Code · WorkCredits", b)), "claude-code-workcredits/opus", "by its name");
    assert.equal(chosen(chooseModel("Opus", "claude-code-work", b)), "claude-code-work/opus", "not the one whose id holds its own");
    assert.equal(chosen(chooseModel("Opus", "Claude Code", b)), "claude-code/opus", "the agent's name: each account, the first in the picker's order");
    // (fails before: yes — the owner's of 11-06: a model named alone ran on the first account in the picker's order, not
    // the one the chat's agent runs on)
    assert.deepEqual(chooseModel("Opus", null, b, { prefer: "claude-code-workcredits" }), { ok: true, model: "claude-code-workcredits/opus", upstream: "claude-code-workcredits", note: "Claude Code, Claude Code · Work serve it too: name its provider to choose." }, "the chat's own account first");
    assert.equal(chosen(chooseModel("Opus", "claude-code-work", b, { prefer: "claude-code-workcredits" })), "claude-code-work/opus", "a provider named wins");
    assert.equal(chosen(chooseModel("Kimi K3", null, b, { prefer: "claude-code-workcredits" })), "openrouter/moonshotai/kimi-k3", "one it does not serve: the picker's order");
  });

  // (fails before: yes — TinyQuest's of 11-18: `claude-opus-5-5` ran on the Anthropic key, then on Cursor, never on
  // the chat's own Claude Code account, which lists the model as `opus`, "Opus 5.5", and was never named among those
  // that serve it)
  test("a model's full id reaches a coding agent's model in the agent's own words; the chat's account first", () => {
    const c = cfg();
    c.upstreams.push(
      { id: "claude-code-northwind", name: "Claude Code · Northwind", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
      { id: "claude-code-old", name: "Claude Code · Old", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
    );
    const list = [...rows(), row("claude-code-northwind/opus", "claude-code-northwind", { codingAgent: true, label: "Opus 5.5" }), row("claude-code-old/opus", "claude-code-old", { codingAgent: true, label: "Opus 5" })];
    const b = bookOf({ c, list });
    const prefer = "claude-code-northwind";
    assert.deepEqual(chooseModel("claude-opus-5-5", null, b, { prefer }), { ok: true, model: "claude-code-northwind/opus", upstream: "claude-code-northwind", note: "Anthropic serves it too: name its provider to choose." });
    assert.deepEqual(chooseModel("claude-opus-5-5", null, b), { ok: true, model: "claude-opus-5-5", upstream: "anthropic", note: "Claude Code · Northwind serves it too: name its provider to choose." }, "no account preferred: the picker's order, the agent among the others");
    assert.equal(chosen(chooseModel("Claude Opus 5.5", null, b, { prefer })), "claude-code-northwind/opus", "as said");
    assert.equal(chosen(chooseModel("claude-opus-5-5", "Claude Code · Northwind", b)), "claude-code-northwind/opus", "its provider named");
    assert.equal(chosen(chooseModel("claude-opus-5-5", null, b, { prefer: "claude-code-old" })), "claude-opus-5-5", "another version is another model: the preferred account does not serve it");
    assert.equal(error(chooseModel("claude-opus-5-5", "claude-code-old", b)), `"claude-opus-5-5" isn't at claude-code-old: claude-opus-5-5 (Anthropic), claude-code-northwind/opus (Claude Code · Northwind) serve it`);
    assert.equal(chosen(chooseModel("Opus 5.5", null, b)), "claude-code-northwind/opus", "its words whole, as before");
    const plain = bookOf({ c, list: list.filter((r) => r.upstream !== "anthropic") });
    assert.equal(chosen(chooseModel("claude-opus-5-5", null, plain)), "claude-code-northwind/opus", "the only one that serves it");
    assert.match(modelList({ model: "claude-opus-5-5" }, b), /claude-code-northwind\/opus "Opus 5\.5"/, "the list narrowed by its id names it");
    assert.doesNotMatch(modelList({ model: "claude-opus-5-5" }, b), /claude-code-old/);
  });

  // (fails before: yes — the owner's of 11-19: a model an agent named ran wherever the picker had it first, the list the
  // person set for the chat, its accounts and its order, aside)
  test("within a list the person set: its rows alone, in its order; a model off it refused as off", () => {
    const c = cfg();
    c.upstreams.push(
      { id: "claude-code-northwind", name: "Claude Code · Northwind", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
      { id: "claude-code-northwindcredits", name: "Claude Code · NorthwindCredits", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
    );
    const list = [...rows(), ...["claude-code-northwind", "claude-code-northwindcredits"].map((u) => row(`${u}/opus`, u, { codingAgent: true, label: "Opus 5.5" }))];
    const within = ["claude-code-northwindcredits/opus", "claude-code-northwind/opus"];
    const b = bookOf({ c, list });
    const both = { ok: true, model: "claude-code-northwindcredits/opus", upstream: "claude-code-northwindcredits", note: "", rows: within };
    assert.deepEqual(chooseModel("claude-opus-5-5", null, b, { within }), both, "TinyQuest's launch: the list's first row, the other behind it — never the Anthropic key");
    assert.deepEqual(chooseModel("Opus 5.5", null, b, { within, prefer: "claude-code-northwind" }), both, "the list's order before the chat's account");
    assert.deepEqual(chooseModel("claude-code-northwind/opus", null, b, { within }), { ok: true, model: "claude-code-northwind/opus", upstream: "claude-code-northwind", note: "", rows: ["claude-code-northwind/opus"] }, "a row as it is written: that row");
    assert.deepEqual(chooseModel("claude-opus-5-5", "Claude Code · Northwind", b, { within }), { ok: true, model: "claude-code-northwind/opus", upstream: "claude-code-northwind", note: "", rows: ["claude-code-northwind/opus"] }, "its provider named");
    assert.deepEqual(chooseModel("", "Claude Code · Northwind", b, { within }), { ok: true, model: "claude-code-northwind/opus", upstream: "claude-code-northwind", note: "", rows: ["claude-code-northwind/opus"] }, "a provider alone: its rows");
    const spent = bookOf({ c, list, problems: { "claude-code-northwindcredits/opus": "its plan is used up" } });
    // (fails before: yes — the review of 11-19: a row that could not run at the launch was gone from its fallback)
    assert.deepEqual(chooseModel("claude-opus-5-5", null, spent, { within }), { ok: true, model: "claude-code-northwind/opus", upstream: "claude-code-northwind", note: "Claude Code · NorthwindCredits's claude-code-northwindcredits/opus can't run now (its plan is used up).", rows: ["claude-code-northwind/opus", "claude-code-northwindcredits/opus"] }, "the one that cannot run now kept behind, for the launch's fallback");
    assert.deepEqual(chooseModel("Kimi K3", null, b, { within }), { ok: false, error: `"Kimi K3" is none of the list's models`, off: true }, "a model the list does not hold, though the picker has it");
    assert.deepEqual(chooseModel("", "Moonshot", b, { within }), { ok: false, error: "Moonshot serves none of the list's models", off: true });
    assert.equal(error(chooseModel("claude-opus-5-5", "Anthropic", b, { within })), `"claude-opus-5-5" isn't at Anthropic on the list: claude-code-northwindcredits/opus (Claude Code · NorthwindCredits), claude-code-northwind/opus (Claude Code · Northwind) serve it`);
    const none = bookOf({ c, list, problems: Object.fromEntries(within.map((m) => [m, "signed out"])) });
    assert.equal(error(chooseModel("claude-opus-5-5", null, none, { within })), `"claude-opus-5-5" can't run now on any of its 2 rows: claude-code-northwindcredits/opus: signed out; claude-code-northwind/opus: signed out`);
    const two = ["kimi/kimi-k3", "claude-code-northwind/opus"];
    assert.deepEqual(chooseModel("kimi", null, b, { within: two }), { ok: true, model: "kimi/kimi-k3", upstream: "kimi", note: "", rows: ["kimi/kimi-k3"] }, "of a list of two models, the one named");
    assert.equal(error(chooseModel("k", null, b, { within: two })), `"k" is none of the list's models`, "a word too short names nothing");
    // (fails before: yes — the review of 11-19: a name the picker matched whole elsewhere ran a row it was only a part of,
    // and a row with Filament's effort suffix was reached only letter for letter)
    const turbo = bookOf({ c, list: [...list, row("kimi/kimi-k3-turbo", "kimi")] });
    assert.deepEqual(chooseModel("kimi-k3", null, turbo, { within: ["kimi/kimi-k3-turbo"] }), { ok: false, error: `"kimi-k3" is none of the list's models`, off: true }, "Kimi K3 whole is another model than the row's");
    assert.equal(chosen(chooseModel("turbo", null, turbo, { within: ["kimi/kimi-k3-turbo"] })), "kimi/kimi-k3-turbo", "a part of a row's, where nothing is named whole");
    assert.deepEqual(chooseModel("claude-opus-5-5", null, b, { within: ["claude-opus-5-5-xhigh"] }), { ok: true, model: "claude-opus-5-5-xhigh", upstream: "anthropic", note: "", rows: ["claude-opus-5-5-xhigh"] }, "a row with its effort suffix, run as written");
    assert.equal(chosen(chooseModel("agent/claude-opus-5-5", null, b, { within: ["claude-opus-5-5-xhigh"] })), "claude-opus-5-5-xhigh", "a name with Filament's agent/ prefix");
  });

  test("a provider switched off, or none by that name", () => {
    const b = bookOf();
    assert.equal(error(chooseModel("GLM 5.3", "zai", b)), "Z.AI (GLM) is switched off: switch it on in Settings › Providers");
    assert.equal(error(chooseModel("Kimi K3", "Mistral", b)), `no provider or coding agent is called "Mistral". Yours: OpenRouter, Kimi (Moonshot), Anthropic, Codex, Claude Code, Cursor`);
    assert.equal(error(chooseModel("", "Codex", b)), "name the model too: Codex has codex/gpt-5.6-sol (Codex)", "a provider alone: its models, never a guess");
  });

  test("never a guess: two models alike are refused and named; a whole name beats a part of one", () => {
    const b = bookOf();
    assert.equal(chosen(chooseModel("qwen3", null, b)), "openrouter/qwen/qwen3", "qwen3 whole, not qwen3-max");
    assert.equal(error(chooseModel("qwen", null, b)), `"qwen" matches 2 models: openrouter/qwen/qwen3 (OpenRouter), openrouter/qwen/qwen3-max (OpenRouter). Name one, or its provider.`);
    assert.match(error(chooseModel("claude-made-up-9", null, b)), /^no model like "claude-made-up-9" in your list of models\. The nearest: claude-opus-5-5 \(Anthropic\)\./);
    // (fails before: yes — a misspelt word shared no start with any model's, so a typo was told no names at all: the E23
    // drive's "Kimmy K9")
    assert.equal(error(chooseModel("Kimmy K9", null, b)), `no model like "Kimmy K9" in your list of models. The nearest: openrouter/moonshotai/kimi-k3 (OpenRouter), kimi/kimi-k3 (Kimi (Moonshot)). To see them all, call with list_models.`);
    assert.match(error(chooseModel("Opua", null, b)), /\. The nearest: claude-opus-5-5 \(Anthropic\), claude-code\/opus \(Claude Code\)\. /, "a word of four letters, one off");
    assert.match(error(chooseModel("glm", null, b)), /^no model like "glm" in your list of models\. To see them all/, "a short word is never stretched to another");
  });

  test("a name as Filament lists it, one hidden from the picker, a path read as its provider, a catch-all never", () => {
    const b = bookOf();
    assert.equal(chosen(chooseModel("kimi/kimi-k3", null, b)), "kimi/kimi-k3");
    assert.deepEqual(chooseModel("openrouter/kimi-k3", null, b), { ok: true, model: "openrouter/moonshotai/kimi-k3", upstream: "openrouter", note: "" });
    assert.deepEqual(chooseModel("claude-opus-4-1", null, b), { ok: true, model: "claude-opus-4-1", upstream: "anthropic", note: "" }, "hidden: runs as named");
    assert.deepEqual(chooseModel("openrouter/vendor/unlisted-model", null, b), { ok: true, model: "openrouter/vendor/unlisted-model", upstream: "openrouter", note: "" }, "spelled with its path: runs as named");
    assert.match(error(chooseModel("openrouter/vendor/unlisted-model", null, bookOf({ problems: { "openrouter/vendor/unlisted-model": "no key" } }))), /can't run now: no key$/);
    const all = cfg();
    all.routes.push({ match: "*", upstream: "openrouter", upstreamModel: "{model}" });
    assert.match(error(chooseModel("made-up", null, bookOf({ c: all }))), /^no model like "made-up"/, "a catch-all takes any word: never as named");
    const reading = bookOf({ reading: true });
    assert.match(error(chooseModel("Kimi K3", null, reading)), /still reading your list of models/);
    assert.equal(chooseModel("kimi/kimi-k3", null, reading).ok, true, "a spelled name needs no list");
  });
});

describe("the effort a sub-agent runs at", () => {
  const c = cfg();
  const book = { cfg: c, families: buildFamilies(c, rows()) };
  test("a setting: the highest level the model takes at or below the one asked, on the name's ending", () => {
    assert.deepEqual(effortOf("kimi/kimi-k3", "max", book), { level: "high", wire: "kimi/kimi-k3-high", levels: ["low", "medium", "high"], spelled: false });
    assert.deepEqual(effortOf("kimi/kimi-k3", "low", book), { level: "low", wire: "kimi/kimi-k3-low", levels: ["low", "medium", "high"], spelled: false });
    assert.deepEqual(effortOf("kimi/kimi-k3", null, book), { level: null, wire: "kimi/kimi-k3", levels: ["low", "medium", "high"], spelled: false }, "none asked: the model's own");
    assert.deepEqual(effortOf("kimi/kimi-k3-low", "max", book, { asked: false }), { level: "low", wire: "kimi/kimi-k3-low", levels: ["low", "medium", "high"], spelled: true }, "Filament's suffix on its name: kept where none was asked");
    assert.deepEqual(effortOf("kimi/kimi-k3-low", "max", book).wire, "kimi/kimi-k3-high", "asked: the name's level goes");
    assert.deepEqual(effortOf("codex/gpt-5.6-sol", "max", book).wire, "codex/gpt-5.6-sol-max", "a coding agent's: its suffix the bridge reads");
    assert.deepEqual(effortOf("claude-sonnet-4-6", "xhigh", book), { level: "high", wire: "claude-sonnet-4-6-high", levels: ["low", "medium", "high", "max"], spelled: false }, "hidden from the picker: read for its name alone; no xhigh there, so high");
  });

  test("ids that spell their efforts: the member at that level; a name's own kept unless one is asked; none where it takes none", () => {
    assert.deepEqual(effortOf("cursor/grok-4.7", "max", book), { level: "high", wire: "cursor/grok-4.7-high", levels: ["low", "high"], spelled: false });
    assert.deepEqual(effortOf("cursor/grok-4.7", "medium", book), { level: "low", wire: "cursor/grok-4.7-low", levels: ["low", "high"], spelled: false });
    assert.deepEqual(effortOf("cursor/grok-4.7-low", "max", book, { asked: false }), { level: "low", wire: "cursor/grok-4.7-low", levels: ["low", "high"], spelled: true });
    assert.deepEqual(effortOf("cursor/grok-4.7-low", "max", book), { level: "high", wire: "cursor/grok-4.7-high", levels: ["low", "high"], spelled: false });
    assert.deepEqual(effortOf("openrouter/qwen/qwen3-max", "max", book), { level: null, wire: "openrouter/qwen/qwen3-max", levels: null, spelled: false });
  });

  test("a chat made at an effort (a Space's runs, 11-04): its level beside its name where it is a setting, its member where its ids spell it, none where it takes none", () => {
    assert.deepEqual(chatEffortOf("kimi/kimi-k3", "max", book), { name: "kimi/kimi-k3", effort: "high" }, "the nearest it takes, in model.effort");
    assert.deepEqual(chatEffortOf("cursor/grok-4.7", "max", book), { name: "cursor/grok-4.7-high", effort: null }, "its member at that level");
    assert.deepEqual(chatEffortOf("openrouter/qwen/qwen3-max", "max", book), { name: "openrouter/qwen/qwen3-max", effort: null }, "it takes none");
    assert.deepEqual(chatEffortOf("kimi/kimi-k3", null, book), { name: "kimi/kimi-k3", effort: null }, "none asked");
  });

  // (fails before: yes — the review of 11-05: a team beside a chat made its lead's chat at the main agent's effort as
  // asked, over the level its model's name spells)
  test("a chat made at an effort it inherits, not asked: a level its model's name spells is kept", () => {
    assert.deepEqual(chatEffortOf("cursor/grok-4.7-high", "low", book, { asked: false }), { name: "cursor/grok-4.7-high", effort: null }, "its member's level");
    assert.deepEqual(chatEffortOf("cursor/grok-4.7-high", "low", book), { name: "cursor/grok-4.7-low", effort: null }, "asked, the level asked");
    assert.deepEqual(chatEffortOf("kimi/kimi-k3", "max", book, { asked: false }), { name: "kimi/kimi-k3", effort: "high" }, "a name that spells none takes it");
  });
});

describe("the list a launcher reads", () => {
  test("by who serves them, each with whether it can run, its efforts, its price or plan, and its seats", () => {
    const b = bookOf({ accounts: { codex: { signedOut: true, spent: false, freeAt: null } }, agents: [{ id: "gemini", name: "Gemini CLI", state: "ready" }] });
    const text = modelList({}, b, { seats: (m) => (m === "kimi/kimi-k3" ? "2 seats on the side" : "") });
    assert.match(text, /^Models a sub-agent can run on/);
    // (fails before: yes — the owner's of 11-19: its first line asked the agent to name one, and TinyQuest's agent
    // named the first model listed, off the list the person set)
    assert.doesNotMatch(text, /Name one/);
    assert.match(text.split("\n")[0], /Leave model out to run on the chat's list .*unless the person asks for a model.* Where the person set that list, only its rows can be named\.$/);
    assert.match(text, /\nKimi \(Moonshot\), 1 model:\n- kimi\/kimi-k3 · can run · effort low to high · \$0\.60 in, \$2\.50 out per million tokens · 2 seats on the side\n/);
    assert.match(text, /\nCodex \(coding agent\), 1 model:\n- codex\/gpt-5\.6-sol "GPT Sol" · can't run now: Codex is signed out: sign in on its account widget, or in Settings › Coding agents · effort low to max · your plan\n/);
    assert.match(text, /\n- cursor\/grok-4\.7 · can run · effort low to high · your plan/);
    assert.match(text, /\nNot in the list: Gemini CLI isn't connected\. It is installed here: Connect it in Settings › Coding agents\.$/);
    const kimi = modelList({ model: "kimi" }, b);
    assert.deepEqual(kimi.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.split(" · ")[0]), ["- openrouter/moonshotai/kimi-k3", "- kimi/kimi-k3"]);
    assert.equal(modelList({ provider: "Mistral" }, b), `Nothing to list: no provider or coding agent is called "Mistral". Yours: OpenRouter, Kimi (Moonshot), Anthropic, Codex, Claude Code, Cursor.`);
    assert.match(modelList({ model: "zzz" }, b), /^No model like "zzz" in your list of models\.$/);
    assert.match(modelList({}, bookOf({ reading: true })), /still reading/);
  });

  test("a list longer than a screen lists a provider's models only where they are few", () => {
    const many = [...Array.from({ length: 70 }, (_, i) => row(`openrouter/vendor/model-${i}`, "openrouter")), row("kimi/kimi-k3", "kimi")];
    const text = modelList({}, bookOf({ list: many }));
    assert.match(text, /\nOpenRouter, 70 models: too many to list here — call again with provider "OpenRouter" and a word of the model's name in model\n/);
    assert.match(text, /\n- kimi\/kimi-k3 · can run/);
    assert.ok(text.length < 1500, `bounded: ${text.length} characters`);
    assert.match(modelList({ provider: "OpenRouter" }, bookOf({ list: many })), /\nOpenRouter, 70 models: too many to list here — call again with a word of the model's name in model$/, "the provider named already: a word narrows it");
    assert.equal(modelList({ provider: "OpenRouter", model: "model-1" }, bookOf({ list: many })).split("\n").filter((l) => l.startsWith("- ")).length, 11, "model-1 and model-10 to model-19");
  });
});
