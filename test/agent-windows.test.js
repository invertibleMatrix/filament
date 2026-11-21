// @ts-check
// The account-switch fix (filament-agent worktree plan, 2b-A, D1–D2; 2026-10-09). A chat moved from one Claude account
// to another was weighed against 200,000 tokens, compose's guess for a window nobody named, though the agent had named
// 1,000,000 at the end of every turn: 184,561 tokens went past the 85% line, memory's model summarized the chat for 4
// minutes, and the fresh session started from a 4,081-token summary. The window a coding agent names is now Filament's
// for its model, below the operator's row; an account that has run no turn yet borrows its agent's other accounts'.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelCache } from "../src/app/models.js";
import { contextWindowWithSource } from "../src/core/pricing.js";
import { sessionWindowFor } from "../src/core/model-families.js";
import { aggregateModels } from "../src/core/routing.js";
import { agentWindowWords } from "../src/ui/harness/lib/labels.js";
import { contextWidget } from "../src/ui/harness/widgets/context.js";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";

test("a window's tiers: the operator's row, then the window the agent named, then the provider's list", () => {
  const row = { "fake-agent-model": { contextTokens: 300_000 } };
  const listed = { "fake-agent-model": 500_000 };
  assert.deepEqual(contextWindowWithSource("fake-agent-model", row, listed, 1_000_000), { tokens: 300_000, source: "operator" });
  assert.deepEqual(contextWindowWithSource("fake-agent-model", null, listed, 1_000_000), { tokens: 1_000_000, source: "agent" });
  assert.deepEqual(contextWindowWithSource("fake-agent-model", null, listed, null), { tokens: 500_000, source: "endpoint" });
  assert.deepEqual(contextWindowWithSource("fake-agent-model", null, null, 999), { tokens: null, source: null }, "no window under 1,000 tokens");
});

// (fails before: yes — `claude-fable-5-2[1m]` took the 200,000 of the built-in row its name starts with, and an id no
// row knows, `some-new-model[1m]`, had no window at all, though Claude Code runs every `[1m]` id in 1M)
test("an id that names its window in brackets has that window, ahead of the built-in rows and behind everyone's word", () => {
  assert.deepEqual(contextWindowWithSource("claude-fable-5-2[1m]", null, null), { tokens: 1_000_000, source: "builtin" });
  assert.deepEqual(contextWindowWithSource("claude-fable-5-1[1m]", null, null), { tokens: 1_000_000, source: "builtin" }, "ahead of the row its name starts with");
  assert.deepEqual(contextWindowWithSource("some-new-model[1M]", null, null), { tokens: 1_000_000, source: "builtin" }, "in any case, a model no row knows too");
  assert.deepEqual(contextWindowWithSource("cc/opus[200k]", null, null), { tokens: 200_000, source: "builtin" });
  assert.deepEqual(contextWindowWithSource("opus[1.5m]", null, null), { tokens: 1_500_000, source: "builtin" });
  // The operator's row, the agent's own word and the provider's listing still come first.
  assert.deepEqual(contextWindowWithSource("claude-fable-5-2[1m]", { "claude-fable-5-2[1m]": { contextTokens: 500_000 } }, null), { tokens: 500_000, source: "operator" });
  assert.deepEqual(contextWindowWithSource("claude-fable-5-2[1m]", null, { "claude-fable-5-2[1m]": 400_000 }, 200_000), { tokens: 200_000, source: "agent" });
  assert.deepEqual(contextWindowWithSource("claude-fable-5-2[1m]", null, { "claude-fable-5-2[1m]": 400_000 }), { tokens: 400_000, source: "endpoint" });
  // Brackets at the id's end only: a hyphen form is a name (the tables and the listing speak for it), and so are
  // brackets that name no window.
  assert.deepEqual(contextWindowWithSource("unknown-model-32k", null, null), { tokens: null, source: null });
  assert.deepEqual(contextWindowWithSource("unknown[1m]-model", null, null), { tokens: null, source: null });
  assert.deepEqual(contextWindowWithSource("unknown-model[beta]", null, null), { tokens: null, source: null });
  assert.equal(contextWindowWithSource("claude-fable-5-2", null, null).tokens, contextWindowWithSource("claude-fable-5-1", null, null).tokens, "the plain id keeps its row's");
});

// (fails before: yes — nothing kept what an agent named: `claude-code/opus-max` had no window at all)
test("the window an agent named is its model's: its account's word, else the smallest its other accounts named; kept across a restart; gone with its account", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-windows-"));
  try {
    const claude = (/** @type {string} */ id, /** @type {string} */ account) => ({ id, type: "acp", enabled: true, acp: { command: "claude-agent-acp", ...(account ? { account } : {}) } });
    const route = (/** @type {string} */ id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true });
    /** @type {any} */
    let cfg = {
      upstreams: [
        claude("cc", ""),
        claude("cc-work", "Work"),
        claude("cc-home", "Home"),
        { id: "cur", type: "acp", enabled: true, acp: { command: "cursor-agent" } },
        { id: "api", type: "anthropic", enabled: true, baseUrl: "http://127.0.0.1:9" },
      ],
      routes: ["cc", "cc-work", "cc-home", "cur", "api"].map(route),
      rules: {},
    };
    /** @type {((c: any) => void)[]} */
    const hooks = [];
    const make = () => createModelCache({ dataDir: dir, config: { get: () => cfg, onChange: (/** @type {any} */ fn) => hooks.push(fn) }, log: () => {}, destinationFor: () => null });
    const one = make();
    assert.deepEqual(sessionWindowFor(cfg, "cc/opus-max", null), { tokens: null, source: null }, "nobody named it yet");
    one.noteAgentWindow("cc", "opus-max", 1_000_000);
    assert.deepEqual(sessionWindowFor(cfg, "cc/opus-max", null), { tokens: 1_000_000, source: "agent" });
    assert.deepEqual(sessionWindowFor(cfg, "cc/opus", null), { tokens: 1_000_000, source: "agent" }, "its effort aside, the same model");
    assert.deepEqual(sessionWindowFor(cfg, "cc-work/opus-max", null), { tokens: 1_000_000, source: "agent" }, "an account that ran no turn yet borrows it");
    one.noteAgentWindow("cc-home", "opus", 200_000);
    assert.equal(sessionWindowFor(cfg, "cc-work/opus", null).tokens, 200_000, "the smallest any other account named");
    assert.equal(sessionWindowFor(cfg, "cc/opus", null).tokens, 1_000_000, "an account's own word before the others'");
    assert.equal(sessionWindowFor(cfg, "cur/opus", null).tokens, null, "another agent's account borrows nothing");
    assert.equal(sessionWindowFor(cfg, "cc/sonnet", null).tokens, null, "nor another model");
    one.noteAgentWindow("api", "opus", 1_000_000);
    assert.equal(sessionWindowFor(cfg, "api/opus", null).tokens, null, "a provider's model is no agent's");
    one.noteAgentWindow("cc", "opus", 999);
    assert.equal(sessionWindowFor(cfg, "cc/opus", null).tokens, 1_000_000, "no window under 1,000 tokens");
    one.close();
    const two = make();
    assert.equal(sessionWindowFor(cfg, "cc/opus", null).tokens, 1_000_000, "read back from models-cache.json");
    assert.equal(sessionWindowFor(cfg, "cc-work/opus", null).tokens, 200_000);
    cfg = { ...cfg, upstreams: cfg.upstreams.filter((/** @type {any} */ u) => u.id !== "cc-home") };
    for (const fn of hooks) fn(cfg);
    assert.equal(sessionWindowFor(cfg, "cc-work/opus", null).tokens, 1_000_000, "a removed account's word goes with it");
    two.close();
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "models-cache.json"), "utf8")).agentWindows, { cc: { opus: 1_000_000 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the owner's of 11-10: Fable 5.2 tuned to 1M on its Claude Code card, the picker said 1M while
// Claude Code ran it in 200K, its own count, and nothing on the list or the Context card said the two differ)
test("a coding agent's own window, where it differs from the one said for the model: the list says it, with the name that runs it in 1M on Claude Code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-window-differs-"));
  try {
    const route = (/** @type {string} */ id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true });
    /** @type {any} */
    const cfg = {
      upstreams: [
        { id: "cc", type: "acp", enabled: true, models: ["claude-fable-5-2", "claude-fable-5-2[1m]", "sonnet"], pricing: { "claude-fable-5-2": { contextTokens: 1_000_000 } }, acp: { command: "claude-agent-acp" } },
        { id: "cc2", type: "acp", enabled: true, models: ["claude-fable-5-2"], pricing: { "claude-fable-5-2": { contextTokens: 1_000_000 } }, acp: { command: "claude-agent-acp" } },
        { id: "cur", type: "acp", enabled: true, models: ["grok-5"], pricing: { "grok-5": { contextTokens: 1_000_000 } }, acp: { command: "cursor-agent" } },
      ],
      routes: ["cc", "cc2", "cur"].map(route),
      rules: {},
    };
    const cache = createModelCache({ dataDir: dir, config: { get: () => cfg, onChange: () => {} }, log: () => {}, destinationFor: () => null });
    cache.noteAgentWindow("cc", "claude-fable-5-2", 200_000);
    cache.noteAgentWindow("cc", "sonnet", 200_000);
    cache.noteAgentWindow("cc2", "claude-fable-5-2", 200_000);
    cache.noteAgentWindow("cur", "grok-5", 256_000);
    const { models } = await aggregateModels(cfg);
    const of = (/** @type {string} */ id) => models.find((m) => m.id === id);
    assert.deepEqual([of("cc/claude-fable-5-2")?.context_window, of("cc/claude-fable-5-2")?.agent_window, of("cc/claude-fable-5-2")?.agent_window_add], [1_000_000, 200_000, undefined], "its card holds the [1m] name already: nothing to add");
    assert.deepEqual([of("cc2/claude-fable-5-2")?.context_window, of("cc2/claude-fable-5-2")?.agent_window, of("cc2/claude-fable-5-2")?.agent_window_add], [1_000_000, 200_000, "claude-fable-5-2[1m]"], "a card without it is told the name");
    assert.equal(of("cc/claude-fable-5-2[1m]")?.agent_window, undefined, "its [1m] id names its own window, which nobody contradicts");
    assert.equal(of("cc/claude-fable-5-2[1m]")?.context_window, 1_000_000);
    assert.equal(of("cc/sonnet")?.agent_window, undefined, "the agent's word is the window: nothing differs");
    assert.deepEqual([of("cur/grok-5")?.agent_window, of("cur/grok-5")?.agent_window_add], [256_000, undefined], "another agent's says it, with no name of Claude's");
    cache.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — finding 16 of the re-read: the name was offered for any model said to be 1M, one with no 1M form
// too: Claude Code lists `haiku` and no `haiku[1m]`, and the list said "Add haiku[1m] by name on its card")
test("the name that runs a model in 1M is offered only where the model has a 1M form and its card does not hold it: none for a name Claude Code lists itself", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-window-form-"));
  try {
    // Claude Code's own list, as its last Refresh kept it: `opus` with its 1M form, `haiku` and `default` with none.
    writeFileSync(join(dir, "models-cache.json"), JSON.stringify({ local: { cc: { names: ["default", "opus", "opus[1m]", "haiku"], at: 1 } } }));
    const said = { contextTokens: 1_000_000 };
    /** @type {any} */
    const cfg = {
      upstreams: [{ id: "cc", type: "acp", enabled: true, models: ["claude-fable-5-2"], pricing: { default: said, opus: said, haiku: said, "claude-fable-5-2": said }, acp: { command: "claude-agent-acp" } }],
      routes: [{ match: "cc/*", upstream: "cc", upstreamModel: "{1}", enabled: true }],
      rules: {},
    };
    const cache = createModelCache({ dataDir: dir, config: { get: () => cfg, onChange: () => {} }, log: () => {}, destinationFor: () => null });
    for (const name of ["default", "opus", "haiku", "claude-fable-5-2"]) cache.noteAgentWindow("cc", name, 200_000);
    // The list as the page asks for it: the card's typed names with the ones Claude Code listed.
    const { models } = await aggregateModels(await cache.cfgForModels(false));
    const of = (/** @type {string} */ id) => models.find((m) => m.id === id);
    const told = (/** @type {string} */ id) => [of(id)?.context_window, of(id)?.agent_window, of(id)?.agent_window_add];
    assert.deepEqual(told("cc/haiku"), [1_000_000, 200_000, undefined], "Claude Code lists haiku and no haiku[1m]: it has no 1M form, so there is no name to add");
    assert.deepEqual(told("cc/default"), [1_000_000, 200_000, undefined], "nor has its default");
    assert.deepEqual(told("cc/opus"), [1_000_000, 200_000, undefined], "opus[1m] is on its list already: nothing to add");
    assert.deepEqual(told("cc/claude-fable-5-2"), [1_000_000, 200_000, "claude-fable-5-2[1m]"], "a name typed on the card, which Claude Code's list says nothing of, is told its name");
    cache.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the words for an agent's own window: who runs the model in what, that the window said doesn't reach it, and the name to add", () => {
  assert.equal(
    agentWindowWords({ who: "Claude Code", model: "claude-fable-5-2", runs: 200_000, set: 1_000_000, add: "claude-fable-5-2[1m]" }),
    "Claude Code runs claude-fable-5-2 in 200K, its own count: the 1M said for it here doesn't reach Claude Code. Add claude-fable-5-2[1m] by name on its card to run it in 1M.",
  );
  assert.equal(agentWindowWords({ who: "Cursor", model: "grok-5", runs: 256_000, set: 1_000_000 }), "Cursor runs grok-5 in 256K, its own count: the 1M said for it here doesn't reach Cursor.");
  assert.equal(agentWindowWords({ who: "Claude Code", model: "sonnet", runs: 200_000, set: 200_000 }), null, "they agree");
  assert.equal(agentWindowWords({ who: "Claude Code", model: "sonnet", runs: null, set: 200_000 }), null, "the agent named none");
});

// (fails before: yes — the owner's of 11-10: the Context card drew Claude Code's 200K under a model the picker said was
// 1M, and nothing on it said why; and finding 16 of the re-read: the card worked the name to add out itself, by a rule
// of its own that never asked what the card holds, so it said "Add claude-fable-5-2[1m]" to a card that held it)
test("the Context card says a coding agent's own window where it differs from the one said for its model, with the name to add as the window answer gives it and none of its own", () => {
  /** @param {{ agent: string, agentName: string, runs: number, set: number, ranOn?: string, add?: string }} o */
  const card = (o) => {
    const view = { settings: { window: { tokens: o.set, source: "operator", model: "claude-fable-5-2", sent: "claude-fable-5-2", settable: true, own: true, ...(o.add ? { add: o.add } : {}) }, flat: { "context.compaction.thresholdPercent": 40, "context.compaction.mode": "auto" } }, facts: null, windows: [] };
    const live = { rec: null, usage: null, liveOut: 0, estimate: 0, streaming: false, agent: true, facts: { held: 60_000, model: o.ranOn ?? "claude-fable-5-2", context: { held: 60_000, window: o.runs, source: "agent", usable: null, verdict: null } } };
    const ctx = {
      view: () => view, hasSession: () => true, live: () => live, turns: () => [], write: () => {}, openPane: () => {}, summon: () => {}, openHow: () => {},
      stopAndCompact: () => {}, dryRun: () => {}, preview: async () => null, scrollToTurn: () => true, toast: () => {},
      accounts: { session: () => ({ agent: o.agent, agentName: o.agentName }) }, models: () => [],
    };
    const spec = contextWidget(/** @type {any} */ (ctx), { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn });
    return textOf(/** @type {any} */ (spec.panel?.(fakeH, () => {}, () => {})));
  };
  assert.ok(
    card({ agent: "claude-code", agentName: "Claude Code", runs: 200_000, set: 1_000_000, add: "claude-fable-5-2[1m]" }).includes("Claude Code runs claude-fable-5-2 in 200K, its own count: the 1M said for it here doesn't reach Claude Code. Add claude-fable-5-2[1m] by name on its card to run it in 1M."),
    "Claude Code's, with the name the window answer gives",
  );
  const held = card({ agent: "claude-code", agentName: "Claude Code", runs: 200_000, set: 1_000_000 });
  assert.ok(held.includes("Claude Code runs claude-fable-5-2 in 200K, its own count: the 1M said for it here doesn't reach Claude Code."), "an answer that gives no name still says the two differ");
  assert.ok(!held.includes("by name on its card"), "and names none: its card holds the name already, or the model has no 1M form");
  const codex = card({ agent: "codex", agentName: "Codex", runs: 272_000, set: 1_000_000 });
  assert.ok(codex.includes("Codex runs claude-fable-5-2 in 272K, its own count: the 1M said for it here doesn't reach Codex."), "another agent's says it");
  assert.ok(!codex.includes("by name on its card"), "with no name of Claude's");
  assert.ok(!card({ agent: "claude-code", agentName: "Claude Code", runs: 200_000, set: 200_000 }).includes("its own count"), "nothing where they agree");
  assert.ok(!card({ agent: "claude-code", agentName: "Claude Code", runs: 200_000, set: 1_000_000, ranOn: "sonnet" }).includes("its own count"), "nor where the count is of the model before a switch");
});
