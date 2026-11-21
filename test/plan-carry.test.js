// @ts-check
// A plan carried into a new chat (the owner's plan mode of 11-06, piece E): the Plan's Continue in a new chat forks the
// chat at its newest turn and the fork takes its open plan — its tasks with their ids, what ran of the planner's own
// paused, the notes and files kept behind it copied — while the plan closes in the chat it left, saying where it went
// on. Nothing of it may be at work in the chat it leaves. Its planner hears where it came from while it stands as it came.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createTaskNotes } from "../src/services/task-notes.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { renderPlan } from "../src/ui/harness/views/plan.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const T0 = Date.UTC(2026, 10, 6, 12, 0);
const AGENT = /** @type {const} */ ("agent");
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} g @param {string} id @returns {any} */
const task = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);
/** A graph after these calls, a minute apart. @param {any[]} calls */
const after_ = (calls) => calls.reduce((g, c, i) => ok(tg.applyTasks(g, c, { at: T0 + i * 60_000, crew: AGENT })).graph, /** @type {any} */ (null));
const PLAN = { action: "add", goal: "Ship the parser", tasks: [{ id: "lexer", name: "Write the lexer" }, { id: "parser", name: "Write the parser", needs: ["lexer"] }, { id: "docs", name: "The docs", by: "sub-agent", goal: "docs", steps: ["write"], acceptance: "written", writes: ["README.md"] }] };

describe("the core", () => {
  // (fails before: yes — there was no carry)
  test("a plan carries only while it is open and nothing of it is at work in the chat it leaves", () => {
    const g = after_([PLAN, { action: "start", ids: ["lexer"] }]);
    assert.equal(tg.carryRefusal(null), "this chat has no open plan to carry");
    assert.equal(tg.carryRefusal(g), null);
    const working = tg.launched(g, "docs", "sa-1", T0, "sub-agent");
    assert.match(String(tg.carryRefusal(working)), /^docs is still at work in this chat — on a sub-agent, in review or merging: carry the plan once it ends, or stop it first$/);
    assert.equal(tg.carryRefusal({ ...g, closed: { at: T0, reason: "done" } }), "this chat has no open plan to carry");
    // (fails before: yes — the review of 58cfe9b31: a change that waited for its Apply, or a rebase, was carried away
    // from the chat whose Changes holds it)
    const failedMerge = { ...g, tasks: g.tasks.map((t) => (t.id === "docs" ? { ...t, state: "failed", agent: "sa-1", failures: { cause: "merge", n: 1 } } : t)) };
    assert.match(String(tg.carryRefusal(failedMerge)), /^docs's change still waits in this chat — for an Apply that did not merge, or a rebase: apply it or let it go first, then carry the plan$/);
    const rebasing = { ...g, tasks: g.tasks.map((t) => (t.id === "docs" ? { ...t, state: "waiting", resume: "sa-1", earlier: { agent: "sa-1", ranAs: "sub-agent", report: null, why: "", reviews: [], rebased: true } } : t)) };
    assert.match(String(tg.carryRefusal(rebasing)), /^docs's change still waits in this chat/);
  });

  test("the new chat takes it as it stood — ids, goal, start —, the planner's running work paused, what was this chat's left behind; the old one closes, saying where", () => {
    const g = after_([PLAN, { action: "start", ids: ["lexer"] }]);
    const ran = { ...g, tasks: g.tasks.map((t) => (t.id === "lexer" ? { ...t, base: { head: "abc", files: [] } } : t)) };
    const was = { ...ran, held: { at: T0 }, told: ["line"], offer: { ids: ["x"], at: T0, turn: 1 } };
    const next = tg.carriedGraph(/** @type {any} */ (was), { at: T0 + 1, from: { chain: "c1", title: "The parser" } });
    assert.deepEqual(next.tasks.map((t) => t.id), ["lexer", "parser", "docs"]);
    // (fails before: yes — the review of 58cfe9b31: the stop stayed behind, and the new chat's first turn started its
    // sub-agents' tasks unasked; the task kept where the old chat's folder stood)
    assert.deepEqual([task(next, "lexer").state, next.goal, next.startedAt, next.rev, next.held, next.told, next.offer, task(next, "lexer").base], ["paused", g.goal, g.startedAt, 0, { at: T0 }, undefined, undefined, null]);
    assert.deepEqual(next.from, { chain: "c1", title: "The parser", at: T0 + 1 });
    const away = tg.carriedAway(g, { at: T0 + 1, to: "c2", title: "The parser (2)" });
    assert.deepEqual(away.closed, { at: T0 + 1, reason: 'carried on in a new chat, "The parser (2)": its tasks, and the notes and files kept behind them, went with it', to: "c2" });
    // (fails before: yes — the review of 58cfe9b31: the closed plan kept its open tasks, and the old chat started its
    // sub-agent's ready task as the new one did)
    assert.deepEqual(away.tasks.map((t) => [t.id, t.state, t.why]), [["lexer", "dropped", 'carried on in a new chat, "The parser (2)"'], ["parser", "dropped", 'carried on in a new chat, "The parser (2)"'], ["docs", "dropped", 'carried on in a new chat, "The parser (2)"']]);
    assert.deepEqual(tg.jobs(away), []);
    assert.deepEqual(tg.jobs({ ...g, closed: { at: T0, reason: "x" } }), [], "no closed graph starts anything");
  });

  // (fails before: yes — the review of 58cfe9b31: the line was said while the graph stood as it came, and anything that
  // kept it before the first turn — an Approve, work that started — took it away for good)
  test("its planner hears where it came from at the new chat's first turn, whatever kept the graph before it, and then no more", () => {
    /** @type {Map<string, any>} */
    const meta = new Map([["c2", {}]]);
    const archive = {
      /** @param {string} id @param {readonly string[]} keys */
      metaOf: (id, keys) => Object.fromEntries(keys.filter((k) => meta.get(id)?.[k] !== undefined).map((k) => [k, meta.get(id)[k]])),
      /** @param {string} id @param {Record<string, any>} patch */
      mergeMeta: (id, patch) => (meta.set(id, structuredClone({ ...meta.get(id), ...patch })), meta.get(id)),
      openGraphs: () => [],
    };
    const registry = { launch: () => ({ ok: false, error: "none" }), slots: () => 4, tell: () => {}, stop: () => ({ ok: true }), resumable: () => null, checkProblem: () => null, guard: () => {} };
    const runner = createGraphRunner({ archive: /** @type {any} */ (archive), registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => AGENT, log: () => {}, now: () => T0 });
    const next = tg.carriedGraph(after_([PLAN]), { at: T0, from: { chain: "c1", title: "The parser" } });
    meta.get("c2").graph = { ...next, rev: 5 };
    const line = /\n- Carried over from the chat "The parser": the notes and files kept behind its tasks came with it, and what ran of yours there is paused here — start it to go on\./;
    assert.match(String(runner.begin("c2", AGENT)), line, "kept five times before its first turn, and said there");
    assert.doesNotMatch(String(runner.begin("c2", AGENT)), line, "said once");
    assert.equal(tg.fromHeard(meta.get("c2").graph), null);
  });
});

describe("the notes and files kept behind it", () => {
  // (fails before: yes — nothing copied what a chat kept)
  test("copied to the new chat under the same graph, each chat's keeps its own after", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-carry-notes-"));
    try {
      const notes = createTaskNotes({ dir, now: () => T0 });
      ok(notes.keepNote("c1", T0, null, { title: "Plan", text: "# The plan", by: "agent" }));
      ok(notes.keepNote("c1", T0, "lexer", { title: "Where", text: "half done", by: "agent" }));
      assert.equal(notes.list("c2", T0, null).notes.length, 0, "read before the copy");
      assert.equal(notes.copy("c1", "c2", T0), 4, "two notes, two indexes");
      assert.equal(notes.note("c2", T0, null, "Plan")?.text, "# The plan");
      assert.equal(notes.note("c2", T0, "lexer", "Where")?.text, "half done");
      ok(notes.keepNote("c2", T0, null, { title: "Plan", text: "# The plan, changed", by: "agent" }));
      assert.equal(notes.note("c1", T0, null, "Plan")?.text, "# The plan", "the old chat's stays its own");
      assert.equal(notes.copy("c1", "c3", T0 + 1), 0, "a graph that kept nothing copies nothing");
    } finally {
      void removeDirs(dir);
    }
  });
});

describe("the page", () => {
  // (fails before: yes — a closed plan said where it went with no way there, and the Plan had no Continue in a new chat)
  test("the Plan offers Continue in a new chat while the plan is open and nothing runs; a carried plan's close opens the chat it went on in", async () => {
    const g = after_([PLAN]);
    /** @type {any[]} */
    const asked = [];
    const chat = { id: "a", chainId: "chain-a", title: "a", turns: [], live: null, view: { settings: {} }, graphLive: tg.graphView(g) };
    const body = fakeH("div");
    renderPlan(body, { chat, carry: (n) => asked.push(n) }, { h: fakeH, api: async () => null, now: () => T0 }).paint();
    await new Promise((r) => setImmediate(r));
    const btn = buttonsOf(body).find((b) => textOf(b) === "Continue in a new chat");
    assert.ok(btn, textOf(body).slice(0, 300));
    btn.attrs.onclick();
    assert.deepEqual(asked, [3]);
    // (fails before: yes — the review of 58cfe9b31: offered while a sub-agent worked on a task, which the session refuses)
    const atWork = { ...chat, graphLive: tg.graphView(tg.launched(g, "docs", "sa-1", T0, "sub-agent")) };
    const busy = fakeH("div");
    renderPlan(busy, { chat: atWork, carry: () => {} }, { h: fakeH, api: async () => null, now: () => T0 }).paint();
    await new Promise((r) => setImmediate(r));
    assert.equal(buttonsOf(busy).some((b) => textOf(b) === "Continue in a new chat"), false);
    /** @type {string[]} */
    const opened = [];
    const away = drawGraph(tg.graphView(tg.carriedAway(g, { at: T0, to: "c2", title: "Next" })), { h: fakeH, now: T0, onOpenChain: (id) => opened.push(id) }).el;
    const link = buttonsOf(away).find((b) => textOf(b) === "Open that chat") || null;
    assert.ok(link, textOf(away).slice(0, 300));
    link.attrs.onclick();
    assert.deepEqual(opened, ["c2"]);
  });
});

describe("end to end: Continue in a new chat through a real Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** A request's newest tool result's text, by its call's id. @param {any} body @param {string} id */
  const resultOf = (body, id) => {
    const b = (body?.messages?.at(-1)?.content || []).find?.((/** @type {any} */ x) => x?.type === "tool_result" && x.tool_use_id === id);
    return b ? (typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => x.text || "").join("")) : null;
  };
  /** @param {any[]} blocks @param {string} [stop] */
  const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-plan-carry-"));
    up = await fakeUpstream(async (c) => {
      if (c.kind !== "anthropic") return undefined;
      const body = c.body || {};
      if (!(body.tools || []).length) return anthropicReply("A title", { model: "brain-model" });
      if (resultOf(body, "start") !== null) return reply([{ type: "text", text: "On it." }]);
      if (resultOf(body, "keep") !== null) return reply([{ type: "tool_use", id: "start", name: "tasks", input: { action: "start", ids: ["lexer"] } }], "tool_use");
      if (resultOf(body, "add") !== null) return reply([{ type: "tool_use", id: "keep", name: "tasks", input: { action: "keep", title: "Plan", text: "# The plan" } }], "tool_use");
      if (JSON.stringify(body.messages.at(-1)).includes("Plan the parser")) return reply([{ type: "tool_use", id: "add", name: "tasks", input: { ...PLAN, tasks: PLAN.tasks.slice(0, 2) } }], "tool_use");
      return reply([{ type: "text", text: "ok" }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });
  /** @param {string} id */
  const graphOf = async (id) => /** @type {any} */ ((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).inForce?.graph ?? null);

  // (fails before: yes — the fork took no plan: its graph was empty, and the plan stayed open in the old chat)
  test("the fork takes the plan with its notes, the old chat's closes saying where; refused at an older turn", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    const id = String((await created.json()).id);
    const path = `/api/sessions/${encodeURIComponent(id)}`;
    for (const content of ["Plan the parser", "Thanks"]) assert.equal((await shim.api(`${path}/turns`, { method: "POST", body: { stream: false, content } })).status, 200);
    const older = await shim.api(`${path}/fork`, { method: "POST", body: { atTurn: 1, plan: true } });
    assert.equal(older.status, 409);
    assert.match(await older.text(), /fork at the chat's newest turn to carry it/);
    const r = await shim.api(`${path}/fork`, { method: "POST", body: { atTurn: 2, plan: true } });
    assert.equal(r.status, 200, await r.clone().text());
    const fork = await r.json();
    assert.deepEqual(fork.plan, { ok: true, tasks: 2, files: 2 });
    const taken = await graphOf(fork.chainId);
    assert.deepEqual([taken.tasks.map((/** @type {any} */ t) => [t.id, t.state]), taken.from?.chain, taken.closed], [[["lexer", "paused"], ["parser", "waiting"]], id, null]);
    const left = await graphOf(id);
    assert.equal(left.closed?.to, fork.chainId);
    const note = await (await shim.api(`/api/sessions/${encodeURIComponent(fork.chainId)}/graph/kept?note=Plan`)).json();
    assert.equal(note?.note?.text, "# The plan");
    // Its planner hears where it came from, in the fork's next turn.
    up.reset();
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(fork.chainId)}/turns`, { method: "POST", body: { stream: false, content: "Go on" } })).status, 200);
    const asked = up.received.find((c) => (c.body?.tools || []).length && JSON.stringify(c.body.messages.at(-1)).includes("Go on"));
    assert.match(JSON.stringify(asked?.body.messages.at(-1)), /Carried over from the chat/);
    const again = await shim.api(`${path}/fork`, { method: "POST", body: { atTurn: 2, plan: true } });
    assert.equal(again.status, 409, "the plan went: nothing open to carry");
  });
});
