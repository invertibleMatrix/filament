// @ts-check
// An ended turn's log, read by the page, carries its last task graph alone (services/runs.js `graphs: "last"`,
// timeline.js `runEventsOf`; the owner's of 11-17: one heavy turn's log re-sent its graph whole 252 times, 17.7 MB the
// page read, parsed and kept in the turn's alignment for one graph it shows). Each graph event is the whole graph as it
// stood, and what reads them of a turn reads its newest (plan.js `planOf`): the rest come without it, every event still
// there and numbered as it was — today's read, its older graphs left out, and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp } from "./helpers/app.js";

const scratch = () => mkdtempSync(join(tmpdir(), "filament-graphs-last-"));
/** @param {{ persist?: boolean }} [o] */
const knobs = (o = {}) => () => ({ observability: { runEvents: { persist: o.persist ?? true, retentionDays: 7, maxPerRun: 20000, keepRuns: 50 } } });
/** A graph as the runner sends it: `pad` makes one too large for a line (kept beside the file). @param {number} rev @param {number} [pad] */
const graphAt = (rev, pad = 0) => ({ rev, counts: { done: rev, total: 9, dropped: 0 }, tasks: [{ id: `t${rev}`, name: `task ${rev}`, state: "done" }], ...(pad ? { pad: "g".repeat(pad) } : {}) });

/** A loop-shaped turn: rounds, calls, a checklist, and graphs — some too large for a line, the last of them too. @param {(evt: any) => void} pub */
function turnInto(pub) {
  pub({ type: "round-start", round: 1, blocksBefore: 0 });
  pub({ type: "tool-start", round: 1, id: "c1", name: "read", args: "a.txt" });
  pub({ type: "tool-end", round: 1, id: "c1", ok: true, result: "a" });
  pub({ type: "graph", round: 1, graph: graphAt(1) });
  pub({ type: "plan", round: 1, items: [{ text: "one", status: "doing" }] });
  pub({ type: "round-start", round: 2, blocksBefore: 1 });
  pub({ type: "graph", round: 2, graph: graphAt(2, 300_000) });
  pub({ type: "tool-start", round: 2, id: "c2", name: "bash", args: "ls" });
  pub({ type: "graph", round: 2, graph: graphAt(3) });
  pub({ type: "tool-end", round: 2, id: "c2", ok: true, result: "b" });
  pub({ type: "round-start", round: 3, blocksBefore: 2 });
  pub({ type: "graph", round: 3, graph: graphAt(4, 300_000) });
  pub({ type: "plan", round: 3, items: [{ text: "one", status: "done" }] });
  pub({ type: "round-text", round: 3, text: "done" });
}

/** Today's read with its older graphs left out: the oracle. @param {any[]} all */
const olderLeftOut = (all) => {
  const last = all.filter((e) => e.type === "graph" && e.graph !== undefined).at(-1)?.n ?? 0;
  return all.map((e) => {
    if (e.type !== "graph" || e.n >= last || e.graph === undefined) return e;
    const { graph, ...rest } = e;
    return rest;
  });
};
/** A whole run read the page's way, a page of `limit` at a time. @param {any} runs @param {string} id @param {number} limit @param {"all" | "last"} graphs */
const paged = (runs, id, limit, graphs) => {
  /** @type {any[]} */
  const all = [];
  for (let since = 0; ;) {
    const events = runs.events(id, { since, limit, graphs }).events;
    all.push(...events);
    const last = Number(events.at(-1)?.n) || 0;
    if (events.length < limit || last <= since) return all;
    since = last;
  }
};

// (fails before: yes — every graph came whole: four, two of them 300 KB)
test("an ended run's graphs but its last come without their graph: every event there, numbered as it was, from memory, from the file alone, and a page at a time", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "r", kind: "agent-turn" });
  turnInto((e) => bus.publish("run:r", e));
  // Still running: its next graph may come, and nothing goes without.
  assert.deepEqual(runs.events("r", { since: 0, graphs: "last" })?.events, runs.events("r", { since: 0 })?.events, "a running run is read whole");
  runs.endRun("r", { status: "done" });
  const all = /** @type {any} */ (runs.events("r", { since: 0 })).events;
  assert.equal(all.filter((/** @type {any} */ e) => e.graph).length, 4, "today: each graph whole");
  const got = /** @type {any} */ (runs.events("r", { since: 0, graphs: "last" })).events;
  assert.deepEqual(got, olderLeftOut(all), "today's read, its older graphs left out");
  assert.deepEqual(got.filter((/** @type {any} */ e) => e.graph).map((/** @type {any} */ e) => e.graph), [graphAt(4, 300_000)], "the last alone, from its body");
  assert.deepEqual(got.filter((/** @type {any} */ e) => e.type === "graph").map((/** @type {any} */ e) => e.round), [1, 2, 2, 3], "each in its round");
  assert.ok(JSON.stringify(got).length < JSON.stringify(all).length - 290_000, "the older large one is not sent");
  assert.deepEqual(paged(runs, "r", 3, "last"), got, "a page at a time: the same, to its end");
  assert.deepEqual(runs.events("r", { since: 0, graphs: "all" })?.events, all, "graphs: all is today's");
  runs.close();
  // What the disk alone says, its index built from the file.
  const fresh = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs() });
  assert.deepEqual(fresh.events("r", { since: 0, graphs: "last" })?.events, got);
  assert.deepEqual(paged(fresh, "r", 2, "last"), got);
  fresh.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — the older graphs came whole)
test("the last graph is the last that carries one: an envelope whose body could not be kept passes as it is, and the graph before it keeps its own", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "lost", kind: "agent-turn" });
  bus.publish("run:lost", { type: "graph", round: 1, graph: graphAt(1) });
  bus.publish("run:lost", { type: "graph", round: 2, graph: graphAt(2) });
  // Where its body would go is a file: the body is not kept, and its line says only its size.
  mkdirSync(join(dir, "runs", "bodies"), { recursive: true });
  writeFileSync(join(dir, "runs", "bodies", "lost"), "");
  bus.publish("run:lost", { type: "graph", round: 3, graph: graphAt(3, 300_000) });
  // A graph event with no graph carries none either.
  bus.publish("run:lost", { type: "graph", round: 4, graph: null });
  runs.endRun("lost", { status: "done" });
  const all = /** @type {any} */ (runs.events("lost", { since: 0 })).events.filter((/** @type {any} */ e) => e.type === "graph");
  assert.deepEqual(all.map((/** @type {any} */ e) => [e.graph?.rev, e.truncated > 0, e.body]), [[1, false, undefined], [2, false, undefined], [undefined, true, undefined], [undefined, false, undefined]], "today: two whole, an envelope with no body, one with none");
  const got = /** @type {any} */ (runs.events("lost", { since: 0, graphs: "last" })).events.filter((/** @type {any} */ e) => e.type === "graph");
  assert.deepEqual(got.map((/** @type {any} */ e) => [e.graph?.rev, e.truncated > 0]), [[undefined, false], [2, false], [undefined, true], [undefined, false]]);
  assert.equal(got[3].graph, null, "passes as it is");
  runs.close();
  const fresh = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs() });
  assert.deepEqual(fresh.events("lost", { since: 0, graphs: "last" })?.events.filter((/** @type {any} */ e) => e.type === "graph"), got, "from the file alone the same");
  fresh.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: no — a guard: where the last's body is gone, the graph before it must not be left out)
test("none goes without where the last graph's body, kept beside the file, is gone, nor where a run's file missed events", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "gone", kind: "agent-turn" });
  bus.publish("run:gone", { type: "graph", round: 1, graph: graphAt(1) });
  bus.publish("run:gone", { type: "graph", round: 2, graph: graphAt(2, 300_000) });
  runs.endRun("gone", { status: "done" });
  unlinkSync(join(dir, "runs", "bodies", "gone", "3.json"));
  assert.deepEqual(runs.events("gone", { since: 0, graphs: "last" })?.events, runs.events("gone", { since: 0 })?.events);
  runs.close();
  // A run whose file missed events (persistence off for a while) keeps its ring at its end: file and ring each hold some.
  const dir2 = scratch();
  const bus2 = createEventBus();
  let persist = true;
  const mixed = createRunLog({ events: bus2, dataDir: dir2, config: () => knobs({ persist })() });
  mixed.startRun({ id: "m", kind: "agent-turn" });
  bus2.publish("run:m", { type: "graph", round: 1, graph: graphAt(1) });
  persist = false;
  bus2.publish("run:m", { type: "graph", round: 2, graph: graphAt(2) });
  persist = true;
  bus2.publish("run:m", { type: "graph", round: 3, graph: graphAt(3) });
  mixed.endRun("m", { status: "done" });
  assert.deepEqual(mixed.events("m", { since: 0, graphs: "last" })?.events, mixed.events("m", { since: 0 })?.events);
  mixed.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(dir2, { recursive: true, force: true });
});

// (fails before: yes — every graph came whole)
test("a run kept in memory alone (persistence off) is read from its ring the same way", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist: false }) });
  runs.startRun({ id: "mem", kind: "agent-turn" });
  turnInto((e) => bus.publish("run:mem", e));
  runs.endRun("mem", { status: "done" });
  const all = /** @type {any} */ (runs.events("mem", { since: 0 })).events;
  const got = runs.events("mem", { since: 0, graphs: "last" })?.events;
  assert.deepEqual(got, olderLeftOut(all));
  assert.equal(got?.filter((/** @type {any} */ e) => e.graph).length, 1);
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — the route read no `graphs`)
test("GET /api/runs/:id/events takes graphs=last as JSON; its stream and a read without it are today's", async () => {
  const t = await startApp();
  try {
    const { app, api } = t;
    const runs = /** @type {any} */ (app).runs;
    runs.startRun({ id: "req_g", kind: "agent-turn", title: "t" });
    turnInto((e) => app.events.publish("run:req_g", e));
    runs.endRun("req_g", { status: "done" });
    const whole = await (await api("/api/runs/req_g/events?since=0")).json();
    const last = await (await api("/api/runs/req_g/events?since=0&graphs=last")).json();
    assert.deepEqual(last.events, olderLeftOut(whole.events));
    assert.equal(last.events.filter((/** @type {any} */ e) => e.graph).length, 1);
    assert.equal(whole.events.filter((/** @type {any} */ e) => e.graph).length, 4);
    const stream = await (await api("/api/runs/req_g/events?since=0&stream=1&graphs=last")).text();
    assert.equal((stream.match(/"type":"graph","graph"|"graph":\{"rev"/g) || []).length, 4, "the stream replays each whole");
  } finally {
    await t.stop();
  }
});

/** An element tree as text, to compare two drawings. @param {any} n @returns {any} */
const tree = (n) => (n.nodeType === 3 ? n.data : [n.tagName, n.className, [...n.attrs].sort(), n.childNodes.map(tree)]);

// (fails before: yes — the page asked for every graph, and its alignment kept one a round; what holds the change to
// today: the page draws the turn and its plan the same)
test("the page's ended turn, read with its last graph alone, draws as read whole, and its Plan is the same graph", async () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "turn-1", kind: "agent-turn" });
  turnInto((e) => bus.publish("run:turn-1", e));
  runs.endRun("turn-1", { status: "done" });
  const dom = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const added = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
  const fetchWas = g.fetch;
  /** Whether the server reads `graphs`, as now, or not, as before. */
  let honours = false;
  /** @type {string[]} */
  const asked = [];
  try {
    g.requestAnimationFrame ||= () => 0;
    g.cancelAnimationFrame ||= () => {};
    g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
    g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
    g.getComputedStyle ||= () => ({});
    g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
    g.sessionStorage ||= g.localStorage;
    Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
    const d = /** @type {any} */ (dom.document);
    d.addEventListener ||= () => {};
    d.removeEventListener ||= () => {};
    g.fetch = async (/** @type {string} */ url) => {
      asked.push(url);
      const u = new URL(url, "http://x");
      const id = decodeURIComponent(/\/runs\/([^/]+)\/events/.exec(u.pathname)?.[1] || "");
      const graphs = honours && u.searchParams.get("graphs") === "last" ? "last" : "all";
      const page = runs.events(id, { since: Number(u.searchParams.get("since")) || 0, limit: Number(u.searchParams.get("limit")) || undefined, graphs });
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(page)) };
    };
    const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
    const { planOf } = await import("../src/ui/harness/views/plan.js");
    const drawn = async () => {
      const root = document.createElement("div");
      const tl = createTimeline(root, /** @type {any} */ ({}));
      const turn = /** @type {any} */ ({ n: 1, status: "done", past: false, history: true, runId: "turn-1", blocks: [{ type: "text", text: "done" }], steers: [], segments: [], startedAt: 1_700_000_000_000 });
      tl.render({ turns: [turn], live: null });
      await tl.loadRun(turn);
      return { root, turn };
    };
    const before = await drawn();
    honours = true;
    const now = await drawn();
    assert.ok(asked.every((u) => u.includes("graphs=last")), "the page asks for its last graph alone");
    assert.deepEqual(tree(now.root), tree(before.root), "the turn drawn the same");
    const was = planOf({ turns: [before.turn], live: null }, null);
    const is = planOf({ turns: [now.turn], live: null }, null);
    assert.deepEqual(is, was, "its plan, its graph and which it planned with last");
    assert.equal(is.graph?.rev, 4);
    assert.deepEqual([...now.turn.aligned.byRound.values()].filter((/** @type {any} */ c) => c.graph).map((/** @type {any} */ c) => c.round), [3], "the alignment keeps one graph");
    assert.equal([...before.turn.aligned.byRound.values()].filter((/** @type {any} */ c) => c.graph).length, 3, "where it kept one a round");
  } finally {
    g.fetch = fetchWas;
    for (const k of added) delete g[k];
    dom.restore();
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
