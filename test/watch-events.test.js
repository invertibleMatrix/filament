// @ts-check
// Filament's own events as watchers' triggers (the plan of 11-11, its w2): each source says what happened, typed — a
// chat's turn ended with the files its rounds wrote and the tasks it marked done, a task of a graph done, failed or
// blocked from a diff of its keeps, a question waiting past a watcher's minutes, a command failed, a sub-agent's report
// —, and a watcher's filter picks them with no model and none of the person's words.
// (fails before: yes — no source said any event, nothing picked one for a watcher, and a turn trigger's `every` was
// never counted)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { graphChanges, heardOf, picks, watchEventOf } from "../src/core/watchers.js";
import { routineFields } from "../src/core/routines.js";
import * as tg from "../src/core/task-graph.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createWatchEvents } from "../src/app/watchers/events.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { onShellFailed, startCommandShell, stopShell } from "../src/adapters/tools/hands.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-watch-events-${tag}-`));
  made.push(d);
  return d;
};

const T = 1_800_000_000_000;
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Lead", c2: "Build the login flow", c3: "Docs" });
/** @param {string} c */
const nameOf = (c) => NAMES[c] || "an untitled chat";
/** A trigger, as core checks it. @param {any} t @returns {any} */
const trig = (t) => {
  const f = routineFields({ title: "W", text: "Read it.", trigger: t }, { create: true });
  assert.ok(f.ok, JSON.stringify(f));
  return f.fields.trigger;
};
/** A graph change the agent's tasks tool made. @param {any} g @param {any} input @param {number} [at] @returns {any} */
const apply = (g, input, at = T) => {
  const r = tg.applyTasks(g, input, { at, crew: "agent" });
  assert.ok(r.ok, JSON.stringify(r));
  return r.graph;
};
/** Two tasks, both running. */
const twoRunning = () => apply(apply(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "One" }, { id: "t2", name: "Two" }] }), { action: "start", ids: ["t1", "t2"] });
/** @param {any} o @returns {any} */
const turnEv = (o = {}) => ({ kind: "turn", chain: "c2", at: T, turn: 4, failed: false, stopped: false, files: 0, tree: false, done: [], ...o });

describe("an event picked and said (core)", () => {
  test("picks: a trigger's kind, its chat and its filter — no model, no words", () => {
    const changed = trig({ kind: "turn", chat: "c2" });
    assert.equal(picks(changed, turnEv(), T), false, "a turn that changed nothing");
    assert.equal(picks(changed, turnEv({ files: 2 }), T), true);
    assert.equal(picks(changed, turnEv({ tree: true }), T), true, "a command changed its folder");
    assert.equal(picks(changed, turnEv({ done: ["t1"] }), T), true, "it marked a task done");
    assert.equal(picks(changed, turnEv({ chain: "c3", files: 2 }), T), false, "another chat's");
    assert.equal(picks(trig({ kind: "turn", chat: "c2", turns: "all" }), turnEv(), T), true);
    /** @type {any} */
    const task = { kind: "task", chain: "c2", at: T, graph: 1, task: "t1", name: "x", why: "" };
    assert.equal(picks(trig({ kind: "task" }), { ...task, state: "done" }, T), true, "any chat's, none named");
    assert.equal(picks(trig({ kind: "task", on: ["blocked"] }), { ...task, state: "done" }, T), false);
    assert.equal(picks(trig({ kind: "task", on: ["blocked"] }), { ...task, state: "failed" }, T), true, "failed is blocked to a watcher");
    assert.equal(picks(trig({ kind: "task", chat: "c3" }), { ...task, state: "done" }, T), false);
    const ask = { kind: "ask", chain: "c2", at: T, ask: "q1", words: "May it push?" };
    assert.equal(picks(trig({ kind: "ask", afterMin: 5 }), /** @type {any} */ (ask), T + 4 * 60_000), false, "not yet its minutes");
    assert.equal(picks(trig({ kind: "ask", afterMin: 5 }), /** @type {any} */ (ask), T + 5 * 60_000), true);
    assert.equal(picks(trig({ kind: "shell", chat: "c2" }), { kind: "shell", chain: "c2", at: T, id: "x", command: "npm test", exit: 1 }, T), true);
    assert.equal(picks(trig({ kind: "subagent" }), { kind: "subagent", chain: "c2", at: T, agent: "sa_1", exchange: 0, description: "Map", ok: true, status: "done", report: "" }, T), true);
    assert.equal(picks(trig({ kind: "commit", branch: "main" }), turnEv({ files: 1 }), T), false, "a commit is w3's, never a turn");
    assert.equal(picks(trig({ kind: "shell" }), turnEv({ files: 1 }), T), false, "another kind");
  });

  test("watchEventOf: each kind's id, moment and words, the chat by its name now; a question at the moment it had waited", () => {
    const t = trig({ kind: "turn", chat: "c2" });
    assert.deepEqual(watchEventOf(turnEv({ files: 3, done: ["t2", "t4"] }), t, nameOf), { id: `turn:c2:4:${T}`, kind: "turn", at: T, chain: "c2", summary: "Turn 4 of Build the login flow ended: 3 files changed, t2 and t4 done", ref: "turn 4", of: { turn: 4 } });
    assert.notEqual(watchEventOf(turnEv({ at: T + 9 }), t, nameOf).id, watchEventOf(turnEv(), t, nameOf).id, "a failed try and its retry under one number: two ends, each heard");
    assert.equal(watchEventOf(turnEv({ tree: true, failed: true }), t, nameOf).summary, "Turn 4 of Build the login flow failed: its folder changed");
    assert.equal(watchEventOf(turnEv({ stopped: true, files: 1 }), t, nameOf).summary, "Turn 4 of Build the login flow was stopped: 1 file changed");
    assert.equal(watchEventOf(turnEv({ turn: null }), t, nameOf).summary, "A turn of Build the login flow ended: nothing changed");
    const done = watchEventOf({ kind: "task", chain: "c2", at: T, graph: 77, task: "t1", name: "Write the tests", state: "done", why: "6 pass" }, trig({ kind: "task" }), nameOf);
    assert.deepEqual([done.id, done.summary, done.ref], [`task:c2:77:t1:done:${T}`, 't1 "Write the tests" of Build the login flow\'s graph is done: 6 pass', "t1"]);
    assert.equal(watchEventOf({ kind: "task", chain: "c2", at: T, graph: 77, task: "t1", name: "x", state: "blocked", why: "its checklist item says blocked" }, trig({ kind: "task" }), nameOf).summary, 't1 "x" of Build the login flow\'s graph is blocked: its checklist item says blocked');
    const ask = watchEventOf({ kind: "ask", chain: "c2", at: T, ask: "run-1:q1", words: "May it push to main?" }, trig({ kind: "ask", afterMin: 12 }), nameOf);
    assert.deepEqual([ask.id, ask.at, ask.summary], ["ask:c2:run-1:q1", T + 12 * 60_000, 'A question of Build the login flow has waited 12 min for you: "May it push to main?"']);
    assert.equal(watchEventOf({ kind: "shell", chain: "c2", at: T, id: "run-1:u3", command: "npm test", exit: 1 }, trig({ kind: "shell" }), nameOf).summary, 'A command of Build the login flow failed with exit 1: "npm test"');
    assert.equal(watchEventOf({ kind: "shell", chain: "c2", at: T, id: "run-1:u3", command: "npm test", exit: null }, trig({ kind: "shell" }), nameOf).summary, 'A command of Build the login flow failed: "npm test"', "a coding agent that said no exit");
    const sa = watchEventOf({ kind: "subagent", chain: "c2", at: T, agent: "sa_1", exchange: 2, description: "Map the hooks", ok: true, status: "done", report: "Two hook points.\nOne each." }, trig({ kind: "subagent" }), nameOf);
    assert.deepEqual([sa.id, sa.summary], ["subagent:sa_1:2", 'Sub-agent "Map the hooks" of Build the login flow reported: Two hook points. One each.']);
    assert.equal(watchEventOf({ kind: "subagent", chain: "c2", at: T, agent: "sa_1", exchange: 0, description: "Map", ok: false, status: "budget-stopped", report: "" }, trig({ kind: "subagent" }), nameOf).summary, 'Sub-agent "Map" of Build the login flow ended budget-stopped');
  });

  test("graphChanges: a keep's tasks done, failed or blocked; those marked done — checking on the way counts once; another graph from none", () => {
    const g0 = apply(apply(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "One" }, { id: "t2", name: "Two", check: ["npm test"] }, { id: "t3", name: "Three" }] }), { action: "start", ids: ["t1", "t2", "t3"] });
    const g1 = apply(g0, { action: "done", tasks: [{ id: "t1", summary: "Read it" }, { id: "t2", summary: "Wrote it" }] });
    const ch = graphChanges(g0, g1);
    assert.deepEqual(ch.tasks.map((t) => [t.task, t.state]), [["t1", "done"]], "t2 is checking, not done yet");
    assert.deepEqual(ch.marked, ["t1", "t2"]);
    const g2 = structuredClone(g1);
    Object.assign(g2.tasks[1], { state: "done" });
    Object.assign(g2.tasks[2], { state: "failed", why: "its check failed" });
    const ch2 = graphChanges(g1, g2);
    assert.deepEqual(ch2.tasks.map((t) => [t.task, t.state, t.why]), [["t2", "done", "Wrote it"], ["t3", "failed", "its check failed"]]);
    assert.deepEqual(ch2.marked, [], "t2 was marked as it went checking");
    const g3 = structuredClone(g0);
    g3.tasks[2].blocked = true;
    assert.deepEqual(graphChanges(g0, g3).tasks.map((t) => [t.task, t.state]), [["t3", "blocked"]]);
    assert.deepEqual(graphChanges(g3, g3).tasks, [], "blocked already: nothing new");
    const other = { ...g1, startedAt: g1.startedAt + 1 };
    assert.deepEqual(graphChanges(g1, other).tasks.map((t) => t.task), ["t1"], "a new graph: what is done in it, from none");
    assert.deepEqual(graphChanges(g1, null), { tasks: [], marked: [] });
  });

  test("heardOf with every: each nth new event waits, the others seen and counted on the cursor", () => {
    const seen = { from: T, at: null, ids: [] };
    /** @param {number} i */
    const ev = (i) => ({ id: `turn:c2:${i}`, kind: "turn", at: T + i, chain: "c2", summary: `Turn ${i}` });
    const a = heardOf(seen, null, [ev(1), ev(2)], 3);
    assert.deepEqual([a.heard, a.took, a.pending, a.seen.n], [2, 0, null, 2]);
    const b = heardOf(a.seen, a.pending, [ev(2), ev(3), ev(4)], 3);
    assert.deepEqual([b.heard, b.took, b.pending?.events.map((e) => e.id), b.seen.n], [2, 1, ["turn:c2:3"], 1], "the third waits; the second was seen");
    const one = heardOf(seen, null, [ev(1), ev(2)]);
    assert.deepEqual([one.took, "n" in one.seen], [2, false], "every 1: each waits, no count kept");
  });
});

describe("the store hears a turn trigger's every", () => {
  test("every 2: the cursor counts across hearings and a restart; only each second wakes", () => {
    const dir = fresh("store");
    const clock = { at: T };
    const store = createSpaceStore({ dir, now: () => clock.at });
    const f = routineFields({ title: "Supervisor", text: "Read its turn.", trigger: { kind: "turn", chat: "c2", every: 2 } }, { create: true });
    assert.ok(f.ok);
    store.routinePropose("p1", f.fields, { chain: "c1", byName: "Lead", model: "m", nameOf });
    store.routineOn("p1", "r1");
    /** @param {number} i */
    const ev = (i) => ({ id: `turn:c2:${i}`, kind: "turn", at: T + i, chain: "c2", summary: `Turn ${i}` });
    assert.equal(store.watchHeard("p1", "r1", [ev(1)]), 0, "the first of two: none waits");
    assert.equal(store.get("p1").routines[0].seen?.n, 1, "counted, and kept");
    const again = createSpaceStore({ dir, now: () => clock.at });
    assert.equal(again.watchHeard("p1", "r1", [ev(2)]), 1, "the second, after a restart: it waits");
    assert.deepEqual(again.get("p1").routines[0].pending?.events.map((e) => e.id), ["turn:c2:2"]);
    assert.equal(again.get("p1").routines[0].seen?.n, undefined);
  });
});

/** A Space store with one watcher of p1 switched on, and the events module over it, what it hears kept. @param {any} trigger @param {any} [o] */
const rig = (trigger, o = {}) => {
  const clock = { at: T };
  const store = createSpaceStore({ dir: null, now: () => clock.at });
  const f = routineFields({ title: "Supervisor", text: "Read it.", trigger }, { create: true });
  assert.ok(f.ok, JSON.stringify(f));
  store.routinePropose("p1", f.fields, { chain: "c1", byName: "Lead", model: "m", nameOf });
  store.routineOn("p1", "r1");
  /** @type {{ project: string, id: string, events: any[] }[]} */
  const woke = [];
  /** @type {Record<string, { project: string | null } | null>} */
  const chats = { c1: { project: "p1" }, c2: { project: "p1" }, c3: { project: "p1" }, other: { project: "p2" }, run: null, ...(o.chats || {}) };
  const ev = createWatchEvents({
    store,
    heard: (project, id, events) => {
      const n = store.watchHeard(project, id, events);
      if (n) woke.push({ project, id, events: [...events] });
      return n;
    },
    chatOf: (c) => chats[c] ?? null,
    nameOf,
    roundsOf: o.roundsOf || (() => []),
    ...(o.hosted ? { hosted: o.hosted } : {}),
    now: () => clock.at,
    askCheckMs: 10,
  });
  return { clock, store, ev, woke, chats };
};

describe("the events, to the watchers that pick them (app/watchers/events.js)", () => {
  test("a turn's end: the files its rounds wrote, its folder, the tasks marked done since it began; another project's, a run's, an off watcher's none", async () => {
    /** @type {Record<string, any[]>} */
    const rounds = { "c2:4": [{ own: ["a.js", "b.js"], before: "s1", after: "s2" }, { own: ["a.js"], before: "s2", after: "s3" }], "c2:5": [{ own: [], before: "s3", after: "s4" }], "c2:6": [] };
    const r = rig({ kind: "turn", chat: "c2" }, { roundsOf: (/** @type {string} */ c, /** @type {number} */ n) => rounds[`${c}:${n}`] || [] });
    assert.equal(r.ev.turnEnded("c2", { turn: 4, since: T - 1000 }), 1);
    await r.ev.settled();
    assert.deepEqual(r.woke.map((w) => w.events[0].summary), ["Turn 4 of Build the login flow ended: 2 files changed"]);
    r.ev.turnEnded("c2", { turn: 5, since: T });
    await r.ev.settled();
    assert.equal(r.woke.at(-1)?.events[0].summary, "Turn 5 of Build the login flow ended: its folder changed");
    // Tasks marked done in the turn, by the graph's keeps: one before its start is none of its.
    const g0 = twoRunning();
    const g1 = apply(g0, { action: "done", id: "t1", summary: "x" });
    r.clock.at = T + 10;
    r.ev.graphKept("c2", g0, g1);
    const g2 = apply(g1, { action: "done", id: "t2", summary: "y" }, T + 20);
    r.clock.at = T + 20;
    r.ev.graphKept("c2", g1, g2);
    r.clock.at = T + 30;
    assert.equal(r.ev.turnEnded("c2", { turn: 6, since: T + 15 }), 1);
    await r.ev.settled();
    assert.equal(r.woke.at(-1)?.events[0].summary, "Turn 6 of Build the login flow ended: t2 done");
    assert.equal(r.ev.turnEnded("c2", { turn: 7, since: T + 25 }), 0, "nothing changed: not picked");
    assert.equal(r.ev.turnEnded("c3", { turn: 1, since: T, failed: true }), 0, "another chat");
    // A chat of no watcher's project, or a routine's run, wakes none — nor does a watcher that is paused.
    const all = rig({ kind: "turn", chat: "other", turns: "all" });
    assert.equal(all.ev.turnEnded("other", { turn: 1 }), 0, "of p2, where no watcher is");
    const runs = rig({ kind: "turn", chat: "run", turns: "all" });
    assert.equal(runs.ev.turnEnded("run", { turn: 1 }), 0, "a run wakes no watcher");
    const paused = rig({ kind: "turn", chat: "c2", turns: "all" });
    paused.store.routinePause("p1", "r1", true);
    assert.equal(paused.ev.turnEnded("c2", { turn: 1 }), 0, "paused");
  });

  test("a graph kept: a task done, failed or blocked, each to a task trigger that picks it", async () => {
    const r = rig({ kind: "task", on: ["blocked"] });
    const g0 = twoRunning();
    const g1 = structuredClone(g0);
    g1.tasks[0].state = "done";
    g1.tasks[1].blocked = true;
    r.clock.at = T + 5;
    r.ev.graphKept("c2", g0, g1);
    await r.ev.settled();
    assert.deepEqual(r.woke.map((w) => w.events[0].summary), ['t2 "Two" of Build the login flow\'s graph is blocked: its checklist item says blocked'], "done is not among its on");
  });

  // (fails before: yes — the review of w2: each task of one keep was heard in a hearing of its own: the first started
  // the watcher's run with one event, and the others waited for a second run)
  test("one keep that marks several tasks: its watcher hears them together, in one hearing", async () => {
    const r = rig({ kind: "task" });
    const g0 = twoRunning();
    const g1 = apply(g0, { action: "done", tasks: [{ id: "t1", summary: "x" }, { id: "t2", summary: "y" }] });
    r.ev.graphKept("c2", g0, g1);
    await r.ev.settled();
    assert.deepEqual(r.woke.map((w) => w.events.map((e) => e.ref)), [["t1", "t2"]]);
  });

  // (fails before: yes — the review of w2: every turn's end of every chat read its rounds from the archive, whether or
  // not a watcher of turns could pick it)
  test("a turn's rounds are read only where a watcher of turns could pick the chat's: none for a watcher of tasks, of another chat, a paused one, nor for a watcher's own turn", async () => {
    let reads = 0;
    const roundsOf = () => (reads++, []);
    rig({ kind: "task" }, { roundsOf }).ev.turnEnded("c2", { turn: 4 });
    rig({ kind: "turn", chat: "c3", turns: "all" }, { roundsOf }).ev.turnEnded("c2", { turn: 4 });
    const paused = rig({ kind: "turn", chat: "c2", turns: "all" }, { roundsOf });
    paused.store.routinePause("p1", "r1", true);
    paused.ev.turnEnded("c2", { turn: 4 });
    // A chat while a watcher's turn is at work in it wakes none (app/routines.js `hostOf`): nothing of it is read.
    const hosted = rig({ kind: "turn", chat: "c2", turns: "all" }, { roundsOf, hosted: (/** @type {string} */ c) => c === "c2" });
    assert.equal(hosted.ev.turnEnded("c2", { turn: 4 }), 0);
    assert.equal(hosted.ev.shellFailed({ chain: "c2", id: "s1", command: "npm test", exit: 1 }), 0);
    assert.equal(reads, 0);
    const watched = rig({ kind: "turn", chat: "c2", turns: "all" }, { roundsOf });
    assert.equal(watched.ev.turnEnded("c2", { turn: 4 }), 1);
    assert.equal(reads, 1);
  });

  // (fails before: yes — the review of w2: a question of a chat deleted or archived since waited for good, and at 200
  // of them every new question was refused)
  test("a question whose chat wakes no watcher any more — deleted, archived — waits no longer", async () => {
    const r = rig({ kind: "ask", chat: "c2", afterMin: 5 });
    r.ev.runEvent("run-1", { type: "run-start", meta: { chain: "c2" } }, T);
    r.ev.runEvent("run-1", { type: "ask", kind: "question", question: "Which branch?" }, T);
    r.ev.runEvent("run-1", { type: "run-end", status: "paused" }, T + 1);
    assert.equal(r.ev.waiting().length, 1);
    r.chats.c2 = null;
    r.clock.at = T + 6 * 60_000;
    r.ev.check();
    await r.ev.settled();
    assert.deepEqual([r.ev.waiting().length, r.woke.length], [0, 0]);
    r.ev.stop();
  });

  test("a question waits: heard once it waited the trigger's minutes, never once answered; a coding agent's by its id, the loop's pause until the chat's next turn; a helper's run none", async () => {
    const r = rig({ kind: "ask", chat: "c2", afterMin: 5 });
    r.ev.runEvent("run-1", { type: "run-start", meta: { chain: "c2" } }, T);
    r.ev.runEvent("run-1", { type: "ask", kind: "question", tool: "ask", question: "Which branch?" }, T);
    r.ev.runEvent("run-1", { type: "run-end", status: "paused" }, T + 1);
    assert.equal(r.ev.waiting().length, 1, "the loop's pause outlives its run");
    r.clock.at = T + 4 * 60_000;
    r.ev.check();
    await r.ev.settled();
    assert.equal(r.woke.length, 0, "not yet");
    r.clock.at = T + 5 * 60_000;
    r.ev.check();
    r.ev.check();
    await r.ev.settled();
    assert.deepEqual(r.woke.map((w) => w.events[0].summary), ['A question of Build the login flow has waited 5 min for you: "Which branch?"'], "heard once");
    r.ev.turnBegan("c2");
    assert.equal(r.ev.waiting().length, 0, "the chat's next turn: answered, or passed by");
    // A coding agent's: by its id, over at its end or the run's.
    r.ev.runEvent("run-2", { type: "run-start", meta: { chain: "c2", engine: "acp" } }, T);
    r.ev.runEvent("run-2", { type: "ask", kind: "question", id: "q1", question: "Push?", waits: true }, T);
    r.ev.runEvent("run-2", { type: "ask", kind: "permission", id: "q2", question: "Run rm?", waits: true }, T);
    r.ev.runEvent("run-2", { type: "ask-end", id: "q1", outcome: "answered" }, T + 1);
    assert.deepEqual(r.ev.waiting().map((a) => a.words), ["Run rm?"]);
    r.ev.runEvent("run-2", { type: "run-end", status: "done" }, T + 2);
    assert.equal(r.ev.waiting().length, 0);
    // A team's question to its lead waits on no person; a helper's run says nothing here.
    r.ev.runEvent("run-3", { type: "run-start", meta: { chain: "c2" } }, T);
    r.ev.runEvent("run-3", { type: "ask", kind: "lead", question: "Which file?", waits: true }, T);
    r.ev.runEvent("run-4", { type: "run-start", meta: { chain: "c2" }, parentId: "run-1", brief: { agentId: "sa_1" } }, T);
    r.ev.runEvent("run-4", { type: "ask", kind: "question", question: "x" }, T);
    assert.equal(r.ev.waiting().length, 0);
    // A sub-agent's, on its parent's run, by its agent and number.
    r.ev.runEvent("run-3", { type: "subagent-ask", agentId: "sa_2", ask: 1, question: "May it write?" }, T);
    assert.equal(r.ev.waiting().length, 1);
    r.ev.runEvent("run-3", { type: "subagent-ask-end", agentId: "sa_2", answered: true }, T + 1);
    assert.equal(r.ev.waiting().length, 0, "its end names no number: the worker's question is over");
    // A permission on another machine says its words in its form; a chat whose events wake no watcher keeps none waiting.
    r.ev.runEvent("run-3", { type: "ask", kind: "permission", id: "there-1", form: { title: "Run npm test on Mac?" }, waits: true }, T);
    assert.deepEqual(r.ev.waiting().map((a) => a.words), ["Run npm test on Mac?"]);
    r.ev.runEvent("run-5", { type: "run-start", meta: { chain: "run" } }, T);
    r.ev.runEvent("run-5", { type: "ask", kind: "question", question: "Which?" }, T);
    assert.equal(r.ev.waiting().length, 1, "a routine's run: none");
    r.ev.stop();
  });

  test("a command failed: the turn's own Run that exited non-zero, or a coding agent's failed with no exit said; never a stop, a refusal, the background, a read, the loop's that never ran; a background shell's", async () => {
    const r = rig({ kind: "shell", chat: "c2" });
    r.ev.runEvent("run-1", { type: "run-start", meta: { chain: "c2" } }, T);
    const run = { kind: "shell", title: "Run", subject: "npm test" };
    r.ev.runEvent("run-1", { type: "tool-end", id: "u1", ok: false, exitCode: 1, card: run }, T + 1);
    r.ev.runEvent("run-1", { type: "tool-end", id: "u2", ok: true, exitCode: 0, card: run }, T + 2);
    r.ev.runEvent("run-1", { type: "tool-end", id: "u3", ok: false, exitCode: null, stopped: true, card: run }, T + 3);
    r.ev.runEvent("run-1", { type: "tool-end", id: "u4", ok: false, refused: true, card: run }, T + 4);
    r.ev.runEvent("run-1", { type: "tool-end", id: "u5", ok: true, background: true, card: run }, T + 5);
    r.ev.runEvent("run-1", { type: "tool-end", id: "u6", ok: false, card: { kind: "shell", title: "Read output", subject: "bg_1" } }, T + 6);
    r.ev.runEvent("run-1", { type: "tool-end", id: "u7", ok: false, card: run }, T + 7);
    // A coding agent's command may fail with no exit said; Filament's own loop says each, so u7 above never ran.
    r.ev.runEvent("run-2", { type: "run-start", meta: { chain: "c2", engine: "acp" } }, T);
    r.ev.runEvent("run-2", { type: "tool-end", id: "c1", ok: false, card: run }, T + 7);
    r.ev.runEvent("run-1", { type: "tool-end", id: "u8", ok: false, card: { kind: "edit", title: "Edit", subject: "a.js" } }, T + 8);
    r.ev.shellFailed({ chain: "c2", id: "bg_3", command: "npm run build", exit: 2 });
    await r.ev.settled();
    assert.deepEqual(r.woke.map((w) => [w.events[0].id, w.events[0].summary]), [
      ["shell:c2:run-1:u1", 'A command of Build the login flow failed with exit 1: "npm test"'],
      ["shell:c2:run-2:c1", 'A command of Build the login flow failed: "npm test"'],
      ["shell:c2:bg:bg_3", 'A command of Build the login flow failed with exit 2: "npm run build"'],
    ]);
  });

  test("a sub-agent's end: its report heard; a helper's — a second look, a fork weighing a message — none", async () => {
    const r = rig({ kind: "subagent" });
    assert.equal(r.ev.subagentEnded({ chain: "c2", agent: "sa_1", exchange: 0, description: "Map the hooks", ok: true, status: "done", report: "Found two." }), 1);
    assert.equal(r.ev.subagentEnded({ chain: "c2", agent: "sa_2", exchange: 0, description: "Second look", ok: true, status: "done", report: "Fine.", helper: true }), 0);
    await r.ev.settled();
    assert.deepEqual(r.woke.map((w) => w.events[0].summary), ['Sub-agent "Map the hooks" of Build the login flow reported: Found two.']);
  });

  test("the bus: run events by their topic, the turns' lock taken, a question over", () => {
    const r = rig({ kind: "ask", chat: "c2" });
    /** @type {((p: any, e: any) => void)[]} */
    const subs = [];
    const stop = r.ev.listen({ subscribe: (topic, fn) => (assert.equal(topic, "*"), subs.push(fn), () => subs.splice(0)) });
    /** @param {string} topic @param {any} p */
    const pub = (topic, p) => subs.forEach((fn) => fn(p, { topic, ts: T }));
    pub("run:run-1", { type: "run-start", meta: { chain: "c2" } });
    pub("run:run-1", { type: "ask", kind: "question", question: "Which?" });
    assert.equal(r.ev.waiting().length, 1);
    pub("turns", { type: "turn", chainId: "c2", holder: null });
    assert.equal(r.ev.waiting().length, 1, "its turn letting go is no answer");
    pub("compactions", { type: "question-over", chainId: "c2", why: "lapsed" });
    assert.equal(r.ev.waiting().length, 0);
    pub("run:run-1", { type: "ask", kind: "question", question: "Again?" });
    pub("turns", { type: "turn", chainId: "c2", holder: { kind: "turn" } });
    assert.equal(r.ev.waiting().length, 0, "the next turn took the chat");
    stop();
    r.ev.stop();
  });
});

describe("the sources say their events", () => {
  test("the graph runner: each keep, with the graph before it (onGraphKept)", () => {
    /** @type {Map<string, any>} */
    const chains = new Map([["c1", { id: "c1", meta: {} }]]);
    /** @type {any[]} */
    const kept = [];
    const archive = {
      /** @param {string} id @param {readonly string[]} keys */
      metaOf: (id, keys) => {
        const c = chains.get(id);
        return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
      },
      /** @param {string} id @param {Record<string, any>} patch */
      mergeMeta: (id, patch) => {
        const c = chains.get(id);
        if (!c) return null;
        c.meta = structuredClone({ ...c.meta, ...patch });
        return c.meta;
      },
      openGraphs: () => [],
    };
    const registry = { launch: () => ({ ok: false }), slots: () => 4, tell: () => {}, stop: () => ({ ok: true }), resumable: () => null, checkProblem: () => null, runProblem: () => null, guard: () => {} };
    const state = { t: T };
    const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => state.t++, onGraphKept: (c, was, next) => kept.push({ c, was, next }) });
    runner.attach("c1", { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: null });
    assert.ok(runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "One" }] }, { crew: "agent" }).ok);
    assert.ok(runner.apply("c1", { action: "start", ids: ["t1"] }, { crew: "agent" }).ok);
    assert.ok(runner.apply("c1", { action: "done", id: "t1", summary: "Did it" }, { crew: "agent" }).ok);
    assert.equal(kept[0].was, null, "the first keep: no graph before it");
    const last = kept.at(-1);
    assert.deepEqual(graphChanges(last.was, last.next).tasks.map((t) => [t.task, t.state]), [["t1", "done"]]);
  });

  test("a background shell of a chat's main agent that fails on its own; not one that exits 0, a sub-agent's, nor one stopped", async () => {
    const dir = fresh("shells");
    /** @type {any[]} */
    const failed = [];
    const off = onShellFailed((e) => failed.push(e));
    try {
      const node = `"${process.execPath}"`;
      const bad = startCommandShell(`${node} -e "process.exit(3)"`, dir, { session: "c-shell", agent: null }, { onEnd: () => {} });
      startCommandShell(`${node} -e "process.exit(0)"`, dir, { session: "c-shell", agent: null }, { onEnd: () => {} });
      startCommandShell(`${node} -e "process.exit(4)"`, dir, { session: "c-shell", agent: "sa_1" }, { onEnd: () => {} });
      const long = startCommandShell(`${node} -e "setTimeout(()=>process.exit(5),60000)"`, dir, { session: "c-shell", agent: null }, { onEnd: () => {} });
      await until(() => failed.length >= 1 || null, "the failing shell's end", { timeoutMs: 20_000 });
      await stopShell(long.id, { session: "c-shell", agent: null });
      await new Promise((r) => setTimeout(r, 500));
      assert.deepEqual(failed.map((f) => [f.session, f.id, f.code]), [["c-shell", bad.id, 3]]);
      assert.match(failed[0].command, /process\.exit\(3\)/);
    } finally {
      off();
    }
  });

  test("a sub-agent's exchange end says how it ended, for the watchers", async () => {
    const dir = fresh("subagent");
    writeFileSync(join(dir, "a.txt"), "x");
    /** @type {any[]} */
    const ends = [];
    /** @type {ReturnType<typeof createSubagentRegistry>} */
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: {
        settings: () => ({ subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: [] } }),
        session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
        view: async () => null,
        brief: async () => null,
        modelProblem: () => null,
        mark: () => null,
        folderProblem: () => null,
        exchangeEnded: (/** @type {any} */ e) => ends.push(e),
      },
      call: async ({ body, headers = {} }) => {
        const id = String(headers["x-filament-subagent"]);
        registry.attach(id, "run-1");
        registry.finish(id, { status: "done", error: null, report: "Found two hook points.", stoppedBy: null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Found two hook points." }] }], rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: ["run-1"] });
        return { ok: true, status: 200, json: { content: [{ type: "text", text: "Found two hook points." }] }, id: "run-1", upstream: "m", retryAfter: null, shouldRetry: null };
      },
    });
    const l = registry.launch({ origin: "agent", chainId: "c1", prompt: "Map the hooks.", description: "Map the hooks", background: true, cwd: dir, mode: null, parentModel: "m", thinking: null, requestId: "turn-1", may: "read" });
    assert.ok(l.ok, JSON.stringify(l));
    await until(() => ends.length === 1 || null, "its end", { timeoutMs: 20_000 });
    assert.deepEqual(ends[0].ended, { exchange: 0, description: "Map the hooks", ok: true, status: "done", report: "Found two hook points.", helper: false });
  });
});

describe("a chat's turn wakes its watcher, on a real Filament", () => {
  test("a turn that writes a file: the watcher of its chat hears it, and its run starts with the event", async () => {
    const root = fresh("app");
    let calls = 0;
    /** @type {string[]} */
    const firsts = [];
    const up = await fakeUpstream(async (/** @type {any} */ call) => {
      calls++;
      const msgs = call.body.messages;
      const first = msgs[0]?.content;
      const text = typeof first === "string" ? first : Array.isArray(first) ? first.map((/** @type {any} */ b) => b?.text || "").join("\n") : "";
      const last = msgs.at(-1);
      const answered = Array.isArray(last?.content) && last.content.some((/** @type {any} */ c) => c?.type === "tool_result");
      if (text.includes("What happened, as Filament heard it")) {
        firsts.push(text);
        return anthropicReply("Read it: nothing drifted.", { model: "brain-model" });
      }
      if (!answered) return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "w1", name: "write", input: { path: "made.txt", content: "made" } }], usage: { input_tokens: 30, output_tokens: 7 } });
      return anthropicReply("Wrote it.", { model: "brain-model" });
    });
    const shim = await startApp({
      memory: true,
      keep: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    try {
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
      assert.equal(r.status, 200, await r.clone().text());
      const id = String((await r.json()).id);
      const project = String(shim.app.memory.archive?.getChain(id)?.project_id || "");
      assert.ok(project, "the chat is of a project");
      const spaces = shim.app.spaces;
      spaces.make(project);
      const f = routineFields({ title: "Supervisor", text: "Read its turn.", trigger: { kind: "turn", chat: id }, model: "agent/brain-model" }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const w = spaces.routinePropose(project, f.fields, { chain: id, byName: "Lead", model: "agent/brain-model", nameOf: () => "Lead" });
      spaces.routineOn(project, w.id);
      const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "Make the file.", stream: false } });
      assert.equal(t.status, 200, await t.clone().text());
      await until(() => spaces.get(project).routines.find((x) => x.id === w.id)?.last?.by === "event" || null, "the watcher's run", { timeoutMs: 30_000 });
      const ran = spaces.get(project).routines.find((x) => x.id === w.id);
      assert.equal(ran?.last?.events, 1);
      await until(() => firsts.length > 0 || null, "the run's first message", { timeoutMs: 30_000 });
      assert.match(firsts[0], /Turn 1 of .+ ended: 1 file changed/);
      assert.ok(calls >= 3);
    } finally {
      await shim.stop();
      await up.close();
    }
  });
});
