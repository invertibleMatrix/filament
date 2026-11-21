// @ts-check
// The owner's of 11-19 (TinyQuest's chat, 11-18): "when i explicitly already setup an order along with account and
// effort then why the id was even needed and passed". An agent's launch keeps to the list the person set for the card it
// launches — this chat's rows for the card, the card's own models, else the chat's list from this chat, its project or
// Settings: a model it names picks that list's rows alone, in their order, at their efforts, and falls back down them; a
// model off the list, or another effort, is refused in words that say the list. Filament's own default (the main
// agent's model alone) binds nothing, nor does the person's own /subagent. The matching itself: test/model-choice.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { chooseModel } from "../src/core/model-choice.js";
import { buildFamilies } from "../src/core/model-families.js";
import { defaultsOf, RULES } from "../src/core/schema.js";

const root = tmpdir();
const MAIN = "claude-code-northwind/opus";
const CREDITS = "claude-code-northwindcredits/opus";

/** Anthropic's key, the chat's two Claude Code accounts and Kimi, as the picker has them. @returns {any} */
const cfg = () => ({
  rules: defaultsOf(RULES),
  upstreams: [
    { id: "kimi", name: "Kimi (Moonshot)", type: "openai-compatible", enabled: true, baseUrl: "https://api.moonshot.ai/v1" },
    { id: "anthropic", name: "Anthropic", type: "anthropic", enabled: true },
    { id: "claude-code-northwind", name: "Claude Code · Northwind", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
    { id: "claude-code-northwindcredits", name: "Claude Code · NorthwindCredits", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
  ],
  routes: [
    { match: "kimi/*", upstream: "kimi", upstreamModel: "{1}" },
    { match: "claude-code-northwind/*", upstream: "claude-code-northwind", upstreamModel: "{1}" },
    { match: "claude-code-northwindcredits/*", upstream: "claude-code-northwindcredits", upstreamModel: "{1}" },
    { match: "claude-*", upstream: "anthropic", upstreamModel: "{model}" },
  ],
});
const row = (/** @type {string} */ id, /** @type {string} */ upstream, extra = {}) => ({ id, upstream, source: "discovered", ...extra });
const PICKER = [row("kimi/kimi-k3", "kimi"), row("claude-opus-5-5", "anthropic"), row(MAIN, "claude-code-northwind", { codingAgent: true, label: "Opus 5.5" }), row(CREDITS, "claude-code-northwindcredits", { codingAgent: true, label: "Opus 5.5" })];
/** TinyQuest's own list: Opus 5.5 on NorthwindCredits, then the chat's model, both at Extra high. */
const THEIRS = [{ model: CREDITS, effort: "xhigh" }, { model: "", effort: "xhigh" }];
const LIST = `this chat's list for agents, which the person set: ${CREDITS} at xhigh, then ${MAIN} at xhigh`;

/**
 * A registry over TinyQuest's chat: its list, where that list comes from, its rows for a card, and each model's
 * number across Filament. Each launch's request waits until the test lets it go, as one at work does.
 * `ask`: the saved agents the chat names. `down`: the models that cannot run now, and why.
 * @param {{ pool?: any, from?: string | null, byCard?: any, slots?: Record<string, number>, cards?: ReturnType<typeof createAgentCardStore>, ask?: string[], down?: Record<string, string> }} [o]
 */
function world({ pool = THEIRS, from = "session", byCard = undefined, slots = {}, cards = createAgentCardStore({ dataDir: null }), ask = [], down = {} } = {}) {
  const c = cfg();
  const problem = (/** @type {string} */ m) => down[m] || null;
  const book = { cfg: c, families: buildFamilies(c, PICKER), problem, now: 0 };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  let registry;
  let n = 0;
  registry = createSubagentRegistry({
    now: () => 0,
    config: () => ({ agentLoop: { subagents: { slots: Object.entries(slots).map(([model, k]) => ({ upstream: "u", model, n: k })) } } }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool, ask, ...(byCard ? { byCard } : {}) }, loop: { permissions: "edit" } }),
      ...(from === undefined ? {} : { settingFrom: () => from }),
      session: () => ({ cwd: root, model: MAIN, projectId: "p1" }),
      view: async () => ({ text: "User: fix the menus", turns: 1 }),
      brief: async () => null,
      modelProblem: problem,
      modelFacts: (name) => ({ problem: problem(name), limit: null, at: { upstream: "u", model: name } }),
      agentOf: () => null,
      chooseModel: async (name, provider, prefer = null, within = null) => chooseModel(name, provider, book, { prefer, within }),
      effortOf: (model, wanted) => ({ level: wanted, wire: model, levels: ["low", "medium", "high", "xhigh", "max"], spelled: false }),
      mark: (_chainId, m) => ({ ...m, afterTurn: 1 }),
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      await new Promise(() => {});
      return /** @type {any} */ ({ ok: true, status: 200, json: { content: [] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null, body });
    },
  });
  const d = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: "edit", model: MAIN, thinking: null, fork: null });
  let k = 0;
  /** One `agent` call of the turn, a reviewer's unless it says. @param {Record<string, any>} input */
  const call = (input) => d.subagents.run({ id: `tu-${++k}`, input: { description: "Map the UI", prompt: "map the UI feedback points", run_in_background: true, subagent_type: "reviewer", ...input }, emit: () => {}, signal: null });
  /** The launched one's model, its effort and the rows it falls back down. @param {Record<string, any>} input */
  const launched = async (input) => {
    const r = await call(input);
    const id = /sa_[0-9a-f]{8}/.exec(r.text)?.[0] || assert.fail(r.text);
    const sa = /** @type {any} */ (registry.get(id));
    return { model: sa?.model, effort: sa?.effort ?? null, rows: sa?.models?.list ?? null };
  };
  return { registry, call, launched };
}

// (fails before: yes — TinyQuest's of 11-18: `claude-opus-5-5` ran on the Anthropic key, out of credit, then on
// Cursor's free plan, its list of NorthwindCredits and Northwind at Extra high aside)
describe("an agent's launch in a chat whose list the person set", () => {
  test("a model it names runs on the list's first row that serves it, at that row's effort, the next row behind it", async () => {
    const w = world();
    assert.deepEqual(await w.launched({ model: "claude-opus-5-5" }), { model: CREDITS, effort: "xhigh", rows: [CREDITS, MAIN] });
    assert.deepEqual(await w.launched({ model: "Opus 5.5" }), { model: CREDITS, effort: "xhigh", rows: [CREDITS, MAIN] }, "as said");
    assert.deepEqual(await w.launched({ model: MAIN }), { model: MAIN, effort: "xhigh", rows: null }, "a row as it is written: that row alone");
    assert.deepEqual(await w.launched({ model: "Opus 5.5", provider: "Claude Code · Northwind" }), { model: MAIN, effort: "xhigh", rows: null }, "its provider named");
    assert.deepEqual(await w.launched({}), { model: CREDITS, effort: "xhigh", rows: [CREDITS, MAIN] }, "left out: the list, as ever");
  });

  test("a model off the list, or an effort that is not its rows', is refused in words that say the list", async () => {
    const w = world();
    await assert.rejects(w.call({ model: "Kimi K3" }), { message: `"Kimi K3" is not on ${LIST}. Leave model out to run on it; a model off the list is the person's to add` });
    await assert.rejects(w.call({ model: "claude-opus-5-5", provider: "Anthropic" }), { message: `"claude-opus-5-5" isn't at Anthropic on the list: ${CREDITS} (Claude Code · NorthwindCredits), ${MAIN} (Claude Code · Northwind) serve it` });
    await assert.rejects(w.call({ model: "claude-opus-5-5", effort: "high" }), { message: `effort high is not the person's: ${LIST}. Leave effort out` });
    await assert.rejects(w.call({ effort: "high" }), { message: `effort high is not the person's: ${LIST}. Leave effort out` }, "a launch that names no model runs on the list too");
    assert.deepEqual(await w.launched({ model: "claude-opus-5-5", effort: "xhigh" }), { model: CREDITS, effort: "xhigh", rows: [CREDITS, MAIN] }, "the rows' own effort, named");
    const plain = world({ pool: [{ model: CREDITS }, { model: "" }] });
    assert.deepEqual(await plain.launched({ model: "claude-opus-5-5", effort: "high" }), { model: CREDITS, effort: "high", rows: [CREDITS, MAIN] }, "rows that set no effort leave it the agent's");
  });

  test("a row at its limit passes the launch to the next row that serves the model", async () => {
    const w = world({ slots: { [CREDITS]: 1 } });
    assert.equal((await w.launched({ model: "claude-opus-5-5" })).model, CREDITS);
    assert.equal((await w.launched({ model: "claude-opus-5-5" })).model, MAIN, "NorthwindCredits is full: Northwind, the list's next");
  });

  // (fails before: yes — the review of 11-19: the rows were kept in the list's order, the one that cannot run first)
  test("a row that cannot run now goes behind those that can", async () => {
    const w = world({ down: { [CREDITS]: "its plan is spent" } });
    assert.deepEqual(await w.launched({ model: "claude-opus-5-5" }), { model: MAIN, effort: "xhigh", rows: [MAIN, CREDITS] });
  });

  // (fails before: yes — the review of 11-19: an effort named that one row set rode the rows that set none, and one of
  // a list whose rows set two was refused as not the person's)
  test("an effort the person set is theirs: named as one row sets it, it says nothing; where rows set two, it is refused", async () => {
    const half = world({ pool: [{ model: CREDITS, effort: "xhigh" }, { model: "" }], slots: { [CREDITS]: 1 } });
    const own = await half.launched({ model: MAIN });
    assert.equal((await half.launched({ model: "claude-opus-5-5", effort: "xhigh" })).effort, "xhigh");
    const next = await half.launched({ model: "claude-opus-5-5", effort: "xhigh" });
    assert.deepEqual([next.model, next.effort], [MAIN, own.effort], "NorthwindCredits full: Northwind at what its row says, not the effort named");
    assert.notEqual(own.effort, "xhigh");
    const two = world({ pool: [{ model: CREDITS, effort: "xhigh" }, { model: "", effort: "high" }] });
    await assert.rejects(two.call({ model: "claude-opus-5-5", effort: "xhigh" }), { message: `each row runs at the effort the person set for it: this chat's list for agents, which the person set: ${CREDITS} at xhigh, then ${MAIN} at high. Leave effort out` });
    assert.deepEqual(await two.launched({ model: MAIN, effort: "high" }), { model: MAIN, effort: "high", rows: null }, "a row named alone: its own effort");
  });

  test("a list set in Settings or the project binds; this chat's rows for the card bind, before the chat's list", async () => {
    for (const from of ["global", "project"]) await assert.rejects(world({ from }).call({ model: "Kimi K3" }), { message: `"Kimi K3" is not on ${LIST}. Leave model out to run on it; a model off the list is the person's to add` }, from);
    const rows = { reviewer: [{ model: "kimi/kimi-k3", effort: "high" }] };
    const w = world({ from: "default", pool: [{ model: "" }], byCard: rows });
    await assert.rejects(w.call({ model: "claude-opus-5-5" }), { message: `"claude-opus-5-5" is not on this chat's models for Reviewer, which the person set: kimi/kimi-k3 at high. Leave model out to run on it; a model off the list is the person's to add` });
    assert.deepEqual(await w.launched({ model: "kimi" }), { model: "kimi/kimi-k3", effort: "high", rows: null });
    const cards = createAgentCardStore({ dataDir: null });
    cards.create({ tag: "translator", name: "Translator", goodFor: "Puts strings into German", thinks: "You translate.", may: "read", models: ["kimi/kimi-k3"] });
    const card = world({ from: "default", pool: [{ model: "" }], cards, ask: ["translator"] });
    await assert.rejects(card.call({ subagent_type: "translator", model: "claude-opus-5-5" }), { message: `"claude-opus-5-5" is not on Translator's card, which the person set: kimi/kimi-k3. Leave model out to run on it; a model off the list is the person's to add` }, "a card's own models");
  });
});

describe("where nobody set a list, and the person's own launches", () => {
  test("Filament's own default, or a source not known: a model named runs as it did, the picker's first that can", async () => {
    for (const from of ["default", null]) {
      const w = world({ from, pool: [{ model: "" }] });
      assert.deepEqual(await w.launched({ model: "claude-opus-5-5", effort: "high" }), { model: "claude-opus-5-5", effort: "high", rows: null }, String(from));
    }
    // (fails before: yes — the review of 11-19: the list's editor can write Filament's own default as the chat's)
    const kept = world({ pool: [{ model: "" }] });
    assert.deepEqual(await kept.launched({ model: "claude-opus-5-5", effort: "high" }), { model: "claude-opus-5-5", effort: "high", rows: null }, "the default kept as the chat's");
    await assert.rejects(world({ pool: [{ model: "", effort: "xhigh" }] }).call({ model: "Kimi K3" }), { message: `"Kimi K3" is not on this chat's list for agents, which the person set: ${MAIN} at xhigh. Leave model out to run on it; a model off the list is the person's to add` }, "the main agent's model at an effort of the person's binds");
  });

  test("the person's /subagent names any model, whatever the list", async () => {
    const w = world();
    const c = await w.registry.choice({ model: "Kimi K3", effort: "high" }, { chainId: "c1" });
    assert.deepEqual(c, { ok: true, fields: { effort: "high", model: "kimi/kimi-k3", chose: "" } });
  });
});
