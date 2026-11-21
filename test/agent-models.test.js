// @ts-check
// The owner's words of 10-19: "assign each specialized agent a model as a priority list, with fallback when a slot isn't
// free or the model fails". A card names its models first choice first (services/agent-cards.js); a launch takes the
// first that can run and has room now, and says the ones it passed; a run its provider failed goes on to the next with
// the same message — never one that was stopped, nor a card of one model — and its row says which model failed and why.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";

const root = tmpdir();
const SECURITY = { tag: "security", name: "Security", goodFor: "What an attacker would try first", thinks: "You think as an attacker." };
const ASK = { origin: /** @type {const} */ ("owner"), chainId: "c1", prompt: "where would you break in?", as: "security" };

/**
 * A registry over the real card store whose host answers each model as `script` says: done, its provider's failure, or
 * held until `release` once (a run that takes a seat meanwhile). Models whose name starts with "bad" cannot run an agent;
 * every other lands at one source, where `slots` sets its number across your chats.
 * `brief`: memory's for the task (a function: written for the task it is given); `leftOut`: why Memory settings leave the sub-agent out on a model (none: never);
 * `store`: where the session keeps its sub-agents' threads across a restart (`threadStore`).
 * `gave`: its earlier exchanges gave way to a fresh session's seed before its provider failed it (acp-turn.js
 *   `exchangesGiveWay`), which its end names (`start`). `calls`: the tools a model's run called before its provider
 *   failed it, each relayed as its start and its end (the end's own fields beside its name: `refused`, `reads`, `card`).
 * `main`: the main agent's own `model` settings (its effort); `efforts`: each model's levels read as asked — the level
 *   wanted, as a model that takes every one would think at it; `hosts`: each run's host read as turn.js reads it, for
 *   whether a 429 on its first call is its answer (`quick`).
 * @param {{ models: (string | { model: string, effort?: string })[], pool?: any[], slots?: any[], script?: Record<string, "out" | "busy" | "hold" | "stop" | "gave">, calls?: Record<string, Record<string, any>[]>, byCard?: Record<string, any[]>, may?: string, coders?: boolean, chat?: { model: string }, brief?: string | ((task: string) => string) | null, leftOut?: (chainId: string, model: string) => string | null, store?: ReturnType<typeof threadStore>, main?: Record<string, unknown> | null, efforts?: boolean, hosts?: boolean }} o
 */
function scripted({ models, pool = [{ model: "m-sub", seats: 4 }], slots = [], script = {}, calls = {}, byCard = undefined, may = undefined, coders = false, chat = { model: "m" }, brief = null, leftOut = undefined, store = undefined, main = null, efforts = false, hosts = false }) {
  const cards = createAgentCardStore({ dataDir: null });
  cards.create({ ...SECURITY, models, ...(may ? { may } : {}) });
  /** @type {any[]} */
  const posts = [];
  /** Each request's messages, in order. @type {any[][]} */
  const bodies = [];
  /** @type {any[]} */
  const marks = [];
  /** Whether each run, as its host read it, would take a 429 on its first call as its answer. @type {boolean[]} */
  const quick = [];
  /** @type {(() => void)[]} */
  const held = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: { subagents: { slots } } }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool, ...(byCard ? { byCard } : {}) }, loop: { permissions: "edit" }, ...(main ? { model: main } : {}) }),
      ...(efforts ? { effortOf: (/** @type {string} */ model, /** @type {string | null} */ wanted) => ({ level: wanted, wire: model, levels: ["low", "medium", "high", "xhigh", "max"], spelled: false }) } : {}),
      session: () => ({ cwd: root, model: chat.model, projectId: "p1" }),
      view: async () => ({ text: "", turns: 0 }),
      brief: async (o) => (brief ? { text: typeof brief === "function" ? brief(o.task) : brief, count: 1 } : null),
      ...(leftOut ? { leftOut } : {}),
      ...(store ? { saveThread: store.saveThread, loadThreads: store.loadThreads } : {}),
      modelProblem: (name) => (name.startsWith("bad") ? "no route matches it" : null),
      modelFacts: (name) => (name.startsWith("bad") ? { problem: "no route matches it", limit: null } : { problem: null, limit: null, at: { upstream: "u", model: name, name: "Zai Cloud" }, seen: null }),
      agentOf: () => (coders ? /** @type {any} */ ({ name: "Cursor" }) : null),
      mark: (chainId, m) => {
        const stored = { ...m, afterTurn: 1 };
        marks.push({ chainId, ...stored });
        return stored;
      },
    },
    call: async ({ body, headers = {} }) => {
      posts.push(body.model);
      bodies.push(body.messages);
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      if (hosts) quick.push(registry.hostOf(id)?.rateMovesOn === true);
      registry.attach(id, runId);
      const model = String(body.model).replace(/^agent\//, "");
      const how = script[model];
      // Held once: the next run on the model is answered at once.
      if (how === "hold") {
        delete script[model];
        await new Promise((/** @type {any} */ go) => held.push(go));
      }
      for (const [i, c] of (calls[model] || []).entries()) {
        registry.relay(id, { type: "tool-start", id: `toolu_${i}`, name: c.name, args: c.args ?? "" });
        registry.relay(id, { type: "tool-end", id: `toolu_${i}`, ok: true, ...c });
      }
      if (how === "out" || how === "busy" || how === "gave") {
        const failure = { what: "round 1's model call", where: model, said: how !== "busy" && how !== "gave" ? "Insufficient balance" : "The engine is overloaded", code: null, status: how !== "busy" && how !== "gave" ? 402 : 529, tries: how === "busy" ? 3 : null, began: null, at: Date.now(), streamed: null, kept: null, next: null, cause: { kind: how === "gave" || how === "busy" ? "busy" : "out", provider: "zai", resets: null } };
        const start = how === "gave" ? [{ role: "user", content: [{ type: "text", text: `SEED from ${model}` }] }] : null;
        registry.finish(id, { status: "failed", error: failure.said, report: "", convo: start || body.messages, rounds: 1, toolCalls: 0, tokensIn: 0, tokensOut: 0, spentUsd: 0, roundIds: [runId], failure, ...(start ? { start } : {}) });
        return { ok: true, status: 200, json: { content: [] }, id: runId, upstream: model, retryAfter: null, shouldRetry: null };
      }
      if (how === "stop") {
        registry.finish(id, { status: "stopped", error: "stopped", report: "", convo: body.messages, rounds: 1, toolCalls: 0, tokensIn: 0, tokensOut: 0, spentUsd: 0, roundIds: [runId], stoppedBy: "developer", failure: { what: "x", where: model, said: "busy", code: null, status: 529, tries: null, began: null, at: Date.now(), streamed: null, kept: null, next: null, cause: { kind: "busy", provider: "zai", resets: null } } });
        return { ok: true, status: 200, json: { content: [] }, id: runId, upstream: model, retryAfter: null, shouldRetry: null };
      }
      const report = `The login form. (${model})`;
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 0, tokensIn: 100, tokensOut: 10, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }] }, id: runId, upstream: model, retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, posts, bodies, marks, quick, release: () => held.splice(0).forEach((go) => go()), fail: (/** @type {string} */ model) => { script[model] = "out"; } };
}

/** A session's store of its sub-agents' threads across a "restart" (BW-10), each cloned as the archive would. */
function threadStore() {
  /** @type {Map<string, any[]>} */
  const threads = new Map();
  return {
    threads,
    saveThread: (/** @type {string} */ c, /** @type {any} */ t) => {
      const kept = threads.get(c) || [];
      const at = kept.findIndex((x) => x.id === t.id);
      const next = structuredClone(t);
      threads.set(c, at < 0 ? [...kept, next] : kept.map((x, i) => (i === at ? next : x)));
    },
    loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
  };
}

// (fails before: yes — a card named one model, and a launch took it or was refused)
describe("a launch takes the first of its card's models that can run and has room", () => {
  test("one that cannot run is passed, with why, and the row says so", async () => {
    const { registry, posts } = scripted({ models: ["bad-1", "m-2", "m-3"] });
    const r = /** @type {any} */ (registry.launch(ASK));
    assert.equal(r.ok, true, r.error);
    await r.done;
    const sa = registry.get(r.id);
    assert.deepEqual([sa?.model, posts, sa?.models?.list, sa?.models?.passed, sa?.models?.failed], ["m-2", ["agent/m-2"], ["bad-1", "m-2", "m-3"], [{ model: "bad-1", why: "no route matches it" }], []]);
    // (fails before: yes — the owner's plan of 11-05: the launch's answer named the model it ran on, never the rows it
    // passed for it)
    assert.equal(registry.launchWords(r.id).chose, " It runs on m-2: bad-1 could not take it — no route matches it.");
    // (fails before: yes — the review of e5e7a75a0: a follow-up's result said again the rows its launch passed)
    const f = /** @type {any} */ (registry.followUp(r.id, { prompt: "and the README?", chainId: "c1" }));
    assert.equal(f.ok, true, f.error);
    await f.done;
    assert.equal(registry.launchWords(r.id).chose, "", "a follow-up: its launch's words are its launch's");
  });

  // (U13-D15 of 10-20: a model's room is its number across your chats; a row of the list holds no count of its own)
  test("one whose room is taken is passed for the next; once it has room again, the next launch takes it", async () => {
    const { registry, posts, release } = scripted({ models: ["m-1", "m-2"], slots: [{ upstream: "u", model: "m-1", n: 1 }], script: { "m-1": "hold" } });
    const first = /** @type {any} */ (registry.launch(ASK));
    assert.equal(first.ok, true, first.error);
    const second = /** @type {any} */ (registry.launch(ASK));
    assert.equal(second.ok, true, second.error);
    await second.done;
    const sa = registry.get(second.id);
    assert.equal(sa?.model, "m-2");
    assert.deepEqual(sa?.models?.passed.map((p) => p.model), ["m-1"]);
    assert.match(String(sa?.models?.passed[0].why), /1 of 1 busy/);
    release();
    await first.done;
    const third = /** @type {any} */ (registry.launch(ASK));
    await third.done;
    assert.deepEqual([registry.get(third.id)?.model, posts], ["m-1", ["agent/m-1", "agent/m-2", "agent/m-1"]]);
  });

  test("none of them can take it: the refusal says each one's why, in order", () => {
    const { registry } = scripted({ models: ["bad-1", "bad-2"] });
    const r = /** @type {any} */ (registry.launch(ASK));
    assert.equal(r.ok, false);
    assert.equal(r.error, "Security runs on bad-1 and bad-2, first choice first, and none of them can take it now: bad-1 — no route matches it; bad-2 — no route matches it.");
  });

  test("a model the launch names wins over the card's list", async () => {
    const { registry } = scripted({ models: ["bad-1", "m-2"] });
    const r = /** @type {any} */ (registry.launch({ ...ASK, model: "m-other" }));
    await r.done;
    assert.deepEqual([registry.get(r.id)?.model, registry.get(r.id)?.models], ["m-other", null]);
  });

  // (fails before: yes — an agent's header named its model alone, never the provider that runs it)
  test("its row names the provider its model runs on, by the Providers page's name (the owner's words of 10-26)", async () => {
    const { registry } = scripted({ models: ["m-2"] });
    const r = /** @type {any} */ (registry.launch(ASK));
    await r.done;
    assert.equal(registry.get(r.id)?.provider, "Zai Cloud");
  });
});

// (fails before: yes — the review of 11-05: a run that went on to its card's next model kept the effort of the first,
// its row's — and a run on the chat's list, or on a team's rows, ended failed whatever the list named next)
describe("a run its provider failed goes on down its list's rows, each at its own effort", () => {
  test("on its card's next model: that row's effort, else the main agent's; the launch's own over both", async () => {
    const low = scripted({ models: [{ model: "m-out", effort: "low" }, "m-3"], main: { effort: "high" }, efforts: true, script: { "m-out": "out" } });
    const a = /** @type {any} */ (low.registry.launch(ASK));
    await a.done;
    assert.deepEqual([low.posts, low.registry.get(a.id)?.model, low.registry.get(a.id)?.effort], [["agent/m-out", "agent/m-3"], "m-3", "high"], "a row that says none: the main agent's");
    const max = scripted({ models: ["m-out", { model: "m-3", effort: "max" }], main: { effort: "high" }, efforts: true, script: { "m-out": "out" } });
    const b = /** @type {any} */ (max.registry.launch(ASK));
    await b.done;
    assert.deepEqual([max.registry.get(b.id)?.model, max.registry.get(b.id)?.effort], ["m-3", "max"], "its own row's");
    const asked = scripted({ models: [{ model: "m-out", effort: "low" }, { model: "m-3", effort: "max" }], main: { effort: "high" }, efforts: true, script: { "m-out": "out" } });
    const c = /** @type {any} */ (asked.registry.launch({ ...ASK, effort: "medium" }));
    await c.done;
    assert.deepEqual([asked.registry.get(c.id)?.model, asked.registry.get(c.id)?.effort], ["m-3", "medium"], "the launch's own");
  });

  test("on the chat's list: the next row that can run, at its effort; a model the launch names stays its own", async () => {
    const s = scripted({ models: [], pool: [{ model: "m-out", effort: "low" }, { model: "m-3" }], main: { effort: "high" }, efforts: true, hosts: true, script: { "m-out": "out" } });
    const r = /** @type {any} */ (s.registry.launch(ASK));
    assert.equal(r.ok, true, r.error);
    const o = await r.done;
    const sa = s.registry.get(r.id);
    assert.deepEqual([o.ok, s.posts, sa?.model, sa?.effort, sa?.models?.failed.map((f) => f.model)], [true, ["agent/m-out", "agent/m-3"], "m-3", "high", ["m-out"]]);
    assert.deepEqual(s.quick, [true, false], "a 429 on its first call goes on while a row is left to go on to");
    const named = scripted({ models: [], pool: [{ model: "m-out" }, { model: "m-3" }], efforts: true, hosts: true, script: { "m-out": "out" } });
    const n = /** @type {any} */ (named.registry.launch({ ...ASK, model: "m-out" }));
    const no = await n.done;
    assert.deepEqual([no.ok, named.posts, named.quick], [false, ["agent/m-out"], [false]], "named: no other");
  });

  // (fails before: yes — the review of e5e7a75a0: a run given back after a restart kept its list without the rows'
  // efforts, so it moved at the effort of the row it left)
  test("after a restart too: the next row's effort", async () => {
    const store = threadStore();
    const pool = [{ model: "m-out", effort: "low" }, { model: "m-3", effort: "max" }];
    const first = scripted({ models: [], pool, efforts: true, store });
    const r = /** @type {any} */ (first.registry.launch(ASK));
    assert.equal(r.ok, true, r.error);
    await r.done;
    const after = scripted({ models: [], pool, efforts: true, store, script: { "m-out": "out" } });
    after.registry.list("c1");
    const f = /** @type {any} */ (after.registry.followUp(r.id, { prompt: "and the README?", chainId: "c1" }));
    assert.equal(f.ok, true, f.error);
    await f.done;
    assert.deepEqual([after.posts, after.registry.get(r.id)?.model, after.registry.get(r.id)?.effort], [["agent/m-out", "agent/m-3"], "m-3", "max"]);
  });

  // (fails before: yes — the review of e5e7a75a0: a 429 on its first call went untried where its next row had no room,
  // so it moved nowhere and failed at once)
  test("a 429 on its first call is tried again where its next row has no room: it would go on nowhere", async () => {
    const s = scripted({ models: [], pool: [{ model: "m-3" }, { model: "m-out" }], slots: [{ upstream: "u", model: "m-3", n: 1 }], hosts: true, script: { "m-3": "hold", "m-out": "out" } });
    const a = /** @type {any} */ (s.registry.launch(ASK));
    const b = /** @type {any} */ (s.registry.launch(ASK));
    assert.equal(b.ok, true, b.error);
    const no = await b.done;
    assert.deepEqual([s.registry.get(b.id)?.model, no.ok, s.quick], ["m-out", false, [true, false]], "the one on m-3 may go on to m-out; the one on m-out has nowhere to go");
    s.release();
    await a.done;
  });

  // (fails before: yes — the owner's of 11-06: a coding agent's helper never went on to the chat's row that is the main
  // agent's model, AG-238, though the card said "Same as the main agent")
  test("a coding agent's helper goes on down the chat's rows as the loop's does: the nameless one is the agent's own model", async () => {
    const s = scripted({ models: [], pool: [{ model: "m-out" }, { model: "" }], script: { "m-out": "out" } });
    // As the coding agent's tool once marked its launch, a mark the registry reads no more.
    const r = /** @type {any} */ (s.registry.launch(/** @type {any} */ ({ ...ASK, coder: true })));
    assert.equal(r.ok, true, r.error);
    const o = await r.done;
    assert.deepEqual([o.ok, s.posts], [true, ["agent/m-out", "agent/m"]]);
  });

  // (fails before: yes — the review of e5e7a75a0: a run that had called a tool that acts was sent anew on the next row,
  // which would act again)
  test("a run that called a tool that acts goes on to no row; one that only read goes on", async () => {
    const acted = scripted({ models: ["m-out", "m-3"], script: { "m-out": "out" }, calls: { "m-out": [{ name: "mcp__github__add_issue_comment" }] } });
    const a = /** @type {any} */ (acted.registry.launch(ASK));
    const no = await a.done;
    assert.deepEqual([no.ok, acted.posts], [false, ["agent/m-out"]], "it acted: its message sent anew would act twice");
    const looked = scripted({ models: ["m-out", "m-3"], script: { "m-out": "out" }, calls: { "m-out": [{ name: "grep" }] } });
    const b = /** @type {any} */ (looked.registry.launch(ASK));
    const yes = await b.done;
    assert.deepEqual([yes.ok, looked.posts], [true, ["agent/m-out", "agent/m-3"]], "it only read");
  });

  // (fails before: yes — the review of 3664a7358: a call counted as acting where it began, so one refused or declined,
  // its own checklist, a skill, an MCP tool its server vouches for as read-only, a coding agent's Read, and a read-only
  // agent's commands each kept its run from going on)
  test("a call that never ran, and one that acts on nothing, keep no run from going on", async () => {
    const quiet = [
      { name: "mcp__github__add_issue_comment", ok: false, refused: true },
      { name: "edit", ok: false, declined: true },
      { name: "write", ok: false, vetoed: true },
      { name: "mcp__github__create_issue", ok: false, notRun: true, stopped: true },
      { name: "plan" },
      { name: "skill" },
      { name: "mcp__github__get_issue", reads: true },
      { name: "Read" },
      { name: "Grep" },
      { name: "Glob" },
      { name: "TodoWrite" },
      { name: "bash", args: "git log -3", exitCode: 0 },
      { name: "filament_memory_search" },
      { name: "filament_recall" },
    ];
    const s = scripted({ models: ["m-out", "m-3"], script: { "m-out": "out" }, calls: { "m-out": quiet } });
    const r = /** @type {any} */ (s.registry.launch(ASK));
    const o = await r.done;
    assert.deepEqual([o.ok, s.posts], [true, ["agent/m-out", "agent/m-3"]], "a read-only agent: its command looked");
    for (const [acts, may] of /** @type {[Record<string, any>, string?][]} */ ([[{ name: "Edit" }], [{ name: "Bash", args: "rm -rf build" }, "edit"], [{ name: "bash", args: "rm -rf build", ok: false, exitCode: 1 }, "edit"], [{ name: "mcp__github__create_issue", ok: false }], [{ name: "tasks" }]])) {
      const a = scripted({ models: ["m-out", "m-3"], script: { "m-out": "out" }, calls: { "m-out": [acts] }, may });
      const no = await /** @type {any} */ (a.registry.launch(ASK)).done;
      assert.deepEqual([no.ok, a.posts], [false, ["agent/m-out"]], `${acts.name} may have acted`);
    }
  });

  // (fails before: yes — the review of 46a624ab4: a coding agent's write by a name of its own — Claude's Edit, an MCP
  // server's write_file — changed nothing its run knew of, so its lead's round kept no snapshot of it)
  test("a coding agent's call that says it writes: its run changed something, and goes on to no row", async () => {
    const s = scripted({ models: ["m-out", "m-3"], script: { "m-out": "out" }, calls: { "m-out": [{ name: "mcp__fs__write_file", writes: true }] }, coders: true });
    const o = await /** @type {any} */ (s.registry.launch(ASK)).done;
    assert.deepEqual([o.ok, o.wrote, s.posts], [false, true, ["m-out"]]);
  });

  // (fails before: yes — the review of 7cd60efc5: a read-only coding agent's command counted as looking, though its
  // coding agent, not Filament's gate, says what it may run)
  test("a read-only coding agent's command keeps its run from going on: its coding agent says what it may run", async () => {
    const coder = scripted({ models: ["m-out", "m-3"], script: { "m-out": "out" }, calls: { "m-out": [{ name: "Bash", args: "git push", exitCode: 0 }] }, coders: true });
    const pushed = await /** @type {any} */ (coder.registry.launch(ASK)).done;
    assert.deepEqual([pushed.ok, coder.posts], [false, ["m-out"]]);
  });

  // (fails before: yes — the review of 3664a7358: a worker's next row was read with the chat's model for the nameless
  // row, where its launch had read its lead's, so its seat still said a row named its model)
  test("a worker whose list's nameless row is its lead's model goes on to it, its seat that row's", async () => {
    const s = scripted({ models: [], pool: [{ model: "m-out" }, { model: "" }], script: { "m-out": "out" } });
    const r = /** @type {any} */ (s.registry.launch({ ...ASK, parentModel: "m-lead" }));
    assert.equal(r.ok, true, r.error);
    const o = await r.done;
    assert.deepEqual([o.ok, s.posts, s.registry.get(r.id)?.seat?.named], [true, ["agent/m-out", "agent/m-lead"], false]);
    // (fails before: yes — the review of 7cd60efc5: a launch its lead named no model for kept none, so a follow-up's move
    // read the nameless row as the chat's model as it stood then: its seat still said a row named its model)
    const chat = { model: "m" };
    const c = scripted({ models: [], pool: [{ model: "m-out" }, { model: "" }], chat });
    const first = /** @type {any} */ (c.registry.launch(ASK));
    await first.done;
    chat.model = "m-new";
    c.posts.length = 0;
    c.fail("m-out");
    const f = /** @type {any} */ (c.registry.followUp(first.id, { prompt: "and the README?", chainId: "c1" }));
    assert.equal(f.ok, true, f.error);
    await f.done;
    assert.deepEqual([c.posts, c.registry.get(first.id)?.seat?.named], [["agent/m-out", "agent/m"], false]);
  });

  // (fails before: yes — the review of 3664a7358: a team's worker given back after a restart lost its team's rows, so a
  // follow-up its provider failed read its next row on the chat's list: its seat still said a row named its model)
  test("a team's worker goes on down its team's rows after a restart too", async () => {
    const store = threadStore();
    const rows = [{ model: "m-x" }, { model: "" }];
    const WORKER = { origin: /** @type {const} */ ("agent"), chainId: "c1", prompt: "fix the lexer", team: { key: "squad", name: "Squad", role: "security", words: "", card: "security" }, rows };
    const first = scripted({ models: [], store });
    const r = /** @type {any} */ (first.registry.launch(WORKER));
    assert.equal(r.ok, true, r.error);
    await r.done;
    assert.equal(first.posts[0], "agent/m-x");
    const after = scripted({ models: [], store, script: { "m-x": "out" } });
    after.registry.list("c1");
    const f = /** @type {any} */ (after.registry.followUp(r.id, { prompt: "and the parser?", chainId: "c1" }));
    assert.equal(f.ok, true, f.error);
    await f.done;
    assert.deepEqual([after.posts, after.registry.get(r.id)?.model, after.registry.get(r.id)?.seat?.named], [["agent/m-x", "agent/m"], "m", false]);
  });

  // (fails before: yes — the owner's of 11-06: this chat's row for a card that names no model was skipped for a coding
  // agent's helper, AG-238; it is the coding agent's own model, as "Same as the main agent" says)
  test("a coding agent's helper takes this chat's row for its card that names no model: the agent's own model", async () => {
    const s = scripted({ models: [], byCard: { security: [{ model: "" }, { model: "m-3" }] } });
    const r = /** @type {any} */ (s.registry.launch(/** @type {any} */ ({ ...ASK, coder: true, parentModel: "m-coder" })));
    assert.equal(r.ok, true, r.error);
    await r.done;
    assert.deepEqual(s.posts, ["agent/m-coder"]);
  });
});

// (fails before: yes — a run its provider failed ended failed, whatever its card named next)
describe("a run its provider failed goes on to its card's next model", () => {
  test("the same message, sent anew on the next: it answers there, and its row and its end say which model failed and why", async () => {
    const { registry, posts, marks } = scripted({ models: ["m-out", "m-busy", "m-3"], script: { "m-out": "out", "m-busy": "busy" } });
    const r = /** @type {any} */ (registry.launch(ASK));
    assert.equal(r.ok, true, r.error);
    const o = await r.done;
    const sa = registry.get(r.id);
    assert.deepEqual([o.ok, o.report, posts], [true, "The login form. (m-3)", ["agent/m-out", "agent/m-busy", "agent/m-3"]]);
    assert.equal(sa?.exchanges.length, 1, "one exchange: the question was asked once");
    assert.deepEqual(sa?.models?.failed.map((f) => [f.model, f.exchange]), [["m-out", 0], ["m-busy", 0]]);
    assert.match(String(sa?.models?.failed[0].why), /^zai says this account's allowance is used up — "Insufficient balance" \(HTTP 402\)$/);
    assert.match(String(sa?.models?.failed[1].why), /^zai was busy or failing for everyone/);
    const arrival = marks.find((m) => m.event === "arrival");
    assert.deepEqual([arrival?.model, arrival?.status, sa?.model], ["m-3", "done", "m-3"], "its answer says the model it gave it on");
    assert.deepEqual(sa?.exchanges[0].moved?.map((m) => [m.model, m.runId]), [["m-out", "run-1"], ["m-busy", "run-2"]], "the exchange keeps each failed run");
    assert.equal(sa?.exchanges[0].runId, "run-3", "its run is the one that answered");
  });

  // (fails before: yes — the review of 149af7f76: the brief was written once, for the model the run started on, and the
  // same first message went to the card's next model whatever Memory settings said of it — the user's rules and the
  // dossier sent to a model they exclude, every round)
  test("one that goes on to a model Memory settings exclude sends it the same message without the brief; one they take in gets it whole", async () => {
    const BRIEF = "Memory for your task (Filament): - [i3 rule · user said] Never push without the owner's word.";
    const asked = /** @type {string[]} */ ([]);
    const leftOut = (/** @type {string} */ _chain, /** @type {string} */ model) => (asked.push(model), model === "agent/m-private" ? 'model "agent/m-private" is excluded in Memory settings' : null);
    const { registry, posts, bodies } = scripted({ models: ["m-out", "m-private", "m-3"], script: { "m-out": "out", "m-private": "busy" }, brief: BRIEF, leftOut });
    const r = /** @type {any} */ (registry.launch(ASK));
    assert.equal(r.ok, true, r.error);
    await r.done;
    assert.deepEqual(posts, ["agent/m-out", "agent/m-private", "agent/m-3"]);
    const texts = bodies.map((messages) => messages[0].content.map((/** @type {any} */ b) => b.text));
    assert.deepEqual(texts[0], [`<memory>\n${BRIEF}\n</memory>`, ASK.prompt], "the model it was written for: the brief, then the task");
    assert.deepEqual(texts[1], [ASK.prompt], "the excluded model: the task alone");
    assert.deepEqual(texts[2], texts[0], "a model memory takes in: the message whole again");
    assert.deepEqual(asked, ["agent/m-private", "agent/m-3"], "asked only of a model the brief was not written for");
  });

  // (fails before: yes — the review of 9f9be41b7: a thread given back after a restart kept its brief's size alone, so a
  // follow-up that went on to a model Memory settings exclude sent it the kept conversation with the brief; and one given
  // back without its conversation wrote a new brief that no model it went on to was sent without)
  test("after a restart too: a follow-up that goes on to an excluded model sends it the thread without the brief — its kept conversation, or one started afresh", async () => {
    // Written for its task, as memory's is: a thread started afresh opens with another than its launch's.
    const BRIEF = (/** @type {string} */ task) => `Memory for your task (Filament), "${task}": - [i3 rule · user said] Never push without the owner's word.`;
    const leftOut = (/** @type {string} */ _chain, /** @type {string} */ model) => (model === "agent/m-private" ? 'model "agent/m-private" is excluded in Memory settings' : null);
    for (const kept of [true, false]) {
      const store = threadStore();
      const first = scripted({ models: ["m-1", "m-private"], brief: BRIEF, leftOut, store });
      const r = /** @type {any} */ (first.registry.launch(ASK));
      assert.equal(r.ok, true, r.error);
      await r.done;
      if (!kept) for (const t of store.threads.get("c1") || []) delete t.convo;
      const after = scripted({ models: ["m-1", "m-private"], script: { "m-1": "out" }, brief: BRIEF, leftOut, store });
      after.registry.list("c1");
      const f = /** @type {any} */ (after.registry.followUp(r.id, { prompt: "and the README?", chainId: "c1" }));
      assert.equal(f.ok, true, f.error);
      await f.done;
      const how = kept ? "its kept conversation" : "started afresh";
      assert.deepEqual(after.posts, ["agent/m-1", "agent/m-private"], how);
      const opened = after.bodies.map((messages) => JSON.stringify(messages[0]));
      assert.ok(opened[0].includes("Memory for your task"), `${how}: the model it was written for reads the brief`);
      assert.ok(!opened[1].includes("Memory for your task"), `${how}: the excluded model does not`);
    }
  });

  // (fails before: no — a guard for the review of c7f132f19's fix: the brief a fresh start opened with is kept as that
  // exchange's, with its words and its model, beside the launch's kept by its size alone)
  test("a thread started afresh, then restarted again: a follow-up that goes on to an excluded model is sent the conversation the fresh start opened without its brief", async () => {
    const BRIEF = (/** @type {string} */ task) => `Memory for your task (Filament), "${task}": - [i3 rule · user said] Never push without the owner's word.`;
    const leftOut = (/** @type {string} */ _chain, /** @type {string} */ model) => (model === "agent/m-private" ? 'model "agent/m-private" is excluded in Memory settings' : null);
    const store = threadStore();
    const first = scripted({ models: ["m-1", "m-private"], brief: BRIEF, leftOut, store });
    const r = /** @type {any} */ (first.registry.launch(ASK));
    assert.equal(r.ok, true, r.error);
    await r.done;
    for (const t of store.threads.get("c1") || []) delete t.convo;
    const second = scripted({ models: ["m-1", "m-private"], brief: BRIEF, leftOut, store });
    second.registry.list("c1");
    const f = /** @type {any} */ (second.registry.followUp(r.id, { prompt: "and the README?", chainId: "c1" }));
    assert.equal(f.ok, true, f.error);
    await f.done;
    const fresh = `<memory>\n${BRIEF("and the README?")}\n</memory>`;
    assert.deepEqual([second.posts, second.bodies[0][0].content.some((/** @type {any} */ b) => b.text === fresh)], [["agent/m-1"], true], "started afresh on the model its brief was written for");
    const third = scripted({ models: ["m-1", "m-private"], script: { "m-1": "out" }, brief: BRIEF, leftOut, store });
    third.registry.list("c1");
    const g = /** @type {any} */ (third.registry.followUp(r.id, { prompt: "and the tests?", chainId: "c1" }));
    assert.equal(g.ok, true, g.error);
    await g.done;
    assert.deepEqual(third.posts, ["agent/m-1", "agent/m-private"]);
    assert.ok(third.bodies[0][0].content.some((/** @type {any} */ b) => b.text === fresh), "the model it was written for reads the conversation the fresh start opened, whole");
    assert.ok(!JSON.stringify(third.bodies[1]).includes("Memory for your task"), "the excluded model reads it without the brief");
  });

  test("every model failed: it ends failed on the last, each tried once", async () => {
    const { registry, posts } = scripted({ models: ["m-out", "m-out2"], script: { "m-out": "out", "m-out2": "out" } });
    const r = /** @type {any} */ (registry.launch(ASK));
    const o = await r.done;
    assert.deepEqual([o.ok, o.status, posts], [false, "failed", ["agent/m-out", "agent/m-out2"]]);
    assert.deepEqual(registry.get(r.id)?.models?.failed.map((f) => f.model), ["m-out"], "the last one's failure is the run's own end");
  });

  test("a card of one model, and a run that was stopped, go nowhere else", async () => {
    const one = scripted({ models: ["m-out"], script: { "m-out": "out" } });
    const r1 = /** @type {any} */ (one.registry.launch(ASK));
    assert.deepEqual([(await r1.done).ok, one.posts], [false, ["agent/m-out"]]);
    const stopped = scripted({ models: ["m-stop", "m-2"], script: { "m-stop": "stop" } });
    const r2 = /** @type {any} */ (stopped.registry.launch(ASK));
    assert.deepEqual([(await r2.done).status, stopped.posts], ["stopped", ["agent/m-stop"]]);
  });

  // A coding agent's earlier exchanges give way to a fresh session's seed, its old session let go of, and its provider
  // fails it then: the next model goes on from that seed, and makes no second summary of the conversation before it.
  // (fails before: yes — the next model was sent the conversation from before the give-way, past the line again)
  test("one whose earlier exchanges gave way before its provider failed it: the next model goes on from the seed they left", async () => {
    const { registry, posts, bodies } = scripted({ models: ["m-gave", "m-3"], script: { "m-gave": "gave" } });
    const r = /** @type {any} */ (registry.launch(ASK));
    const o = await r.done;
    assert.deepEqual([o.ok, posts], [true, ["agent/m-gave", "agent/m-3"]]);
    assert.deepEqual(bodies[1], [{ role: "user", content: [{ type: "text", text: "SEED from m-gave" }] }]);
    // Its conversation goes on from there, the seed and the answer.
    const again = /** @type {any} */ (registry.followUp(r.id, { prompt: "and then?", chainId: "c1" }));
    assert.equal(again.ok, true, again.error);
    await again.done;
    assert.deepEqual(bodies[2].map((/** @type {any} */ m) => m.content.map((/** @type {any} */ b) => b.text).join("|")), ["SEED from m-gave", "The login form. (m-3)", "and then?"]);
  });
});
