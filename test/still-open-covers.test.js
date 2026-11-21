// @ts-check
// Still open covers every change the person's Changes shows waiting (Fable52's of 11-10, on the owner's screenshot of
// 11-10: Changes showed 35 files waiting for Apply while the Plan's card said nothing waits). One test of a change that
// waits, the Changes tab's (`waitsInChanges`), and every change it passes is on the card — but the developer's own kept
// aside, one that started by itself, an attempt another won, and one its graph task is at work on still, which the graph
// beside the card shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { changesOf, createStillOpen, openList, waitsInChanges } from "../src/app/agent/still-open.js";
import { changesModel } from "../src/ui/harness/panes/changes-places.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const SIG = "aaaaaaaaaaaa:bbbbbbbbbbbb";
/** A sub-agent's work, `pending` files of it waiting. @param {number} pending */
const work = (pending) => ({ pending, sig: SIG });

/** A chat's meta as the archive keeps it, in memory: `mergeMeta` with undefined takes a key away. */
const archiveOf = () => {
  /** @type {Map<string, Record<string, any>>} */
  const metas = new Map();
  return {
    metaOf: (/** @type {string} */ id, /** @type {readonly string[]} */ keys) => {
      const m = metas.get(id) || {};
      return Object.fromEntries(keys.filter((k) => k in m).map((k) => [k, structuredClone(m[k])]));
    },
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => {
      const m = { ...(metas.get(id) || {}) };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete m[k];
      else m[k] = structuredClone(v);
      metas.set(id, m);
    },
    getCompactions: () => [],
  };
};

// (fails before: yes — Fable52's of 11-10: a change an earlier try at a task left, a failed task's, and one whose task id
// a graph with no startedAt reused were listed nowhere — the registry's list leaves a task's change to its graph, and
// the graph's read skipped each)
test("an earlier try's change, a failed task's, a done one's and a reused task id with no time to tell each wait in Still open, with their ways out", () => {
  const subs = [
    { id: "sa_old", status: "done", task: "t1", description: "parser, first try", endedAt: NOW - 30 * MIN, work: work(4) },
    { id: "sa_new", status: "running", task: "t1", work: work(1) },
    { id: "sa_f", status: "failed", task: "t2", description: "lexer", endedAt: NOW - 10 * MIN, work: work(2) },
    { id: "sa_d", status: "done", task: "t3", endedAt: NOW - 5 * MIN, work: work(1) },
    { id: "sa_r", status: "done", task: "t4", work: work(3) },
  ];
  const graph = {
    startedAt: NOW - 60 * MIN,
    tasks: [
      { id: "t1", name: "parser", state: "running", agent: "sa_new" },
      { id: "t2", name: "lexer", state: "failed", agent: "sa_f" },
      { id: "t3", name: "docs", state: "done", agent: "sa_d" },
      // Its sub-agent kept no end (given back after a restart), and the task waits for a new one.
      { id: "t4", name: "other", state: "waiting", agent: null },
    ],
  };
  const changes = changesOf(subs, graph);
  assert.deepEqual(changes, [
    { kind: "try", task: "t1", description: "parser, first try", id: "sa_old", files: 4, mark: SIG, since: NOW - 30 * MIN },
    { kind: "ended", task: "t2", title: "lexer", state: "failed", id: "sa_f", files: 2, mark: SIG, since: NOW - 10 * MIN },
    { kind: "ended", task: "t3", title: "docs", state: "done", id: "sa_d", files: 1, mark: SIG, since: NOW - 5 * MIN },
    { kind: "try", task: "t4", description: "", id: "sa_r", files: 3, mark: SIG, since: null },
  ]);
  // A graph with no startedAt that reused the id: no time tells whose graph it was, and the change waits all the same.
  const reused = { id: "sa_9", status: "done", task: "c1", description: "c1: The switch", endedAt: NOW - 16 * 60 * MIN, work: work(35) };
  assert.deepEqual(changesOf([reused], { tasks: [{ id: "c1", state: "merging", step: "yours", agent: "sa_other" }] }), [
    { kind: "try", task: "c1", description: "c1: The switch", id: "sa_9", files: 35, mark: SIG, since: NOW - 16 * 60 * MIN },
  ]);

  const o = openList({ shells: [], agent: null, changes, now: NOW });
  assert.deepEqual(o.keys, ["graph:t2:failed", "graph:t3:done", "agent:sa_old:waits", "agent:sa_r:waits"]);
  const ways = "apply_changes: true to apply it, mark_applied: true where it came into your folder another way, or leave it";
  assert.equal(o.lines[0], `- task t2 of your task graph ("lexer"), failed: 2 files of sub-agent sa_f's change still wait in its copy (for 10 min) — agent with agent_id "sa_f" and ${ways} [graph:t2:failed]`);
  assert.equal(o.lines[1], `- task t3 of your task graph ("docs"), done: 1 file of sub-agent sa_d's change still waits in its copy (for 5 min) — agent with agent_id "sa_d" and ${ways} [graph:t3:done]`);
  assert.equal(o.lines[2], `- sub-agent sa_old ("parser, first try"), an earlier try at task t1 of your task graph: 4 files of its change still wait in its copy (for 30 min) — agent with agent_id "sa_old" and ${ways} [agent:sa_old:waits]`);
  assert.equal(o.lines[3], `- sub-agent sa_r, an earlier try at task t4 of your task graph: 3 files of its change still wait in its copy — agent with agent_id "sa_r" and ${ways} [agent:sa_r:waits]`);
  assert.deepEqual(o.rows.map((r) => r.view), [
    { group: "waiting", tone: "wait", title: "Task t2: lexer", detail: "Failed task · 2 files of its change still to apply · waiting 10 min", act: "review", agent: "sa_f" },
    { group: "waiting", tone: "wait", title: "Task t3: docs", detail: "Done task · 1 file of its change still to apply · waiting 5 min", act: "review", agent: "sa_d" },
    { group: "waiting", tone: "wait", title: "parser, first try", detail: "An earlier try at task t1 · 4 files of its change still to apply · waiting 30 min", act: "review", agent: "sa_old" },
    { group: "waiting", tone: "wait", title: "Sub-agent sa_r", detail: "An earlier try at task t4 · 3 files of its change still to apply", act: "review", agent: "sa_r" },
  ]);
  // A dismissal of one says it still waits in the person's Changes.
  const so = createStillOpen({ archive: () => archiveOf(), changes: () => changes, now: () => NOW });
  assert.deepEqual(so.dismiss("c1", ["graph:t2:failed", "agent:sa_old:waits"]), { dismissed: ["graph:t2:failed", "agent:sa_old:waits"], unknown: [], waits: ["sa_f", "sa_old"] });
});

// (fails before: yes — FabeleHelper's of 11-10 on 98d0c37a5, and the hunt of a-next, sa_16f6bbd4: a done counted what else
// is open past three and said the next turn's start names it, which nothing made that start do; and it marked the rest
// said, so a later done of the turn counted it "as said before")
test("what a done counts and never names, the next turn's start says whole, once; a later done of the turn names it as new", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const six = ids.map((x, i) => ({ kind: /** @type {const} */ ("try"), task: `t${i + 1}`, description: `try ${x}`, id: `sa_${x}`, files: 1, mark: SIG, since: NOW - MIN }));
  const arch = archiveOf();
  const so = createStillOpen({ archive: () => arch, changes: () => six, now: () => NOW });
  /** @type {Set<string>} */
  const said = new Set();
  assert.match(so.also("c1", new Set(), said), /^Also still open, beside your graph: sub-agent sa_a .*; and 3 more, which Still open names at your next turn's start\.$/);
  assert.deepEqual([...said], ["agent:sa_a:waits", "agent:sa_b:waits", "agent:sa_c:waits"], "only what it named is said");
  so.ended("c1", false);
  const start = so.due("c1");
  assert.equal(start?.why, "more");
  assert.match(String(start?.text), /^\[Filament: Your answers in your last turn named a part of what else is still open, and counted the rest: here it is whole\./);
  for (const x of ids) assert.ok(String(start?.text).includes(`[agent:sa_${x}:waits]`), String(start?.text));
  so.ended("c1", true);
  assert.equal(so.due("c1"), null, "said once");

  // A later done of the same turn names what the first counted, as new: nothing is owed.
  /** @type {Set<string>} */
  const two = new Set();
  so.also("c2", new Set(), two);
  const second = so.also("c2", new Set(), two);
  assert.match(second, /^Also still open, beside your graph: sub-agent sa_d .*\(new\).*; 3 as said before\.$/);
  assert.doesNotMatch(second, /more/);
  so.ended("c2", false);
  assert.equal(so.due("c2"), null);

  // The turn whose start said the list whole heard each line of it: its answers name none again and count nothing, so
  // the start after it says no list (the re-read of 11-11: this pinned the opposite — the turn's first done counted the
  // rest again and owed the next start the whole list, turn after turn, for as long as more than three things were open).
  so.also("c3", new Set(), new Set());
  so.ended("c3", false);
  const whole = so.due("c3");
  assert.equal(whole?.why, "more");
  so.begin("c3");
  so.startSaid("c3", whole?.keys || []);
  assert.equal(so.also("c3", new Set(), new Set()), "", "its start said each: nothing to name, nothing to count");
  so.ended("c3", true);
  so.over("c3");
  assert.equal(so.due("c3"), null, "nothing owed to the next start");
  // A start whose list never reached the agent said nothing: the turn's answers count as before, and the next start owes it.
  so.also("c4", new Set(), new Set());
  so.ended("c4", false);
  assert.equal(so.due("c4")?.why, "more");
  so.begin("c4");
  so.also("c4", new Set(), new Set());
  so.over("c4");
  assert.equal(so.due("c4")?.why, "more", "the list is still owed");
});

/**
 * How a graph task stands, and whether its own sub-agent's change that waits is the card's — not where the task is at
 * work on it still: it waits to start again, runs, is paused, checked, reviewed, or merged now.
 * @type {readonly [string, string | null, boolean][]}
 */
const STATES = [
  ["waiting", null, false],
  ["running", null, false],
  ["paused", null, false],
  ["checking", null, false],
  ["review", "reading", false],
  ["merging", "back", false],
  ["merging", null, false],
  ["merging", "yours", true],
  ["done", null, true],
  ["failed", null, true],
  ["dropped", null, true],
];

// (fails before: yes — an earlier try's change, a failed or done task's, and a reused id's waited in Changes and on no
// line of the card)
test("the card covers every change Changes shows waiting, by the one test of both: it leaves out only the developer's own, one that started by itself, an attempt another won and one its task is at work on — and names none Changes does not show", () => {
  /** @type {any[]} */
  const subs = [];
  /** @type {any[]} */
  const tasks = [];
  /** Why a change Changes shows waiting is no line of the card's, by its sub-agent. @type {Map<string, string>} */
  const elsewhere = new Map();
  STATES.forEach(([state, step, card], i) => {
    const id = `t${i}`;
    tasks.push({ id, name: `task ${i}`, state, step, agent: `sa_${i}_own` });
    // The task's own sub-agent, its change waiting; and an earlier try at it, which another took since.
    subs.push({ id: `sa_${i}_own`, status: state === "failed" ? "failed" : "done", task: id, endedAt: NOW - MIN, work: work(1 + i) });
    subs.push({ id: `sa_${i}_try`, status: "done", task: id, description: `try at ${id}`, endedAt: NOW - 2 * MIN, work: work(2) });
    if (!card) elsewhere.set(`sa_${i}_own`, `its task ${id} is ${state}${step ? ` (${step})` : ""}: the graph beside the card shows it`);
  });
  // A task sent back to the sub-agent that goes on with it, which waits to start again.
  tasks.push({ id: "tb", name: "sent back", state: "waiting", step: null, agent: "sa_back", resume: "sa_back" });
  subs.push({ id: "sa_back", status: "done", task: "tb", endedAt: NOW - MIN, work: work(2) });
  elsewhere.set("sa_back", "its task tb waits to start again, its sub-agent to go on with it");
  subs.push(
    // An earlier graph's: its id gone, or a graph begun after it ended; a reused id with no end to tell by.
    { id: "sa_gone", status: "done", task: "tx", endedAt: NOW - 90 * MIN, work: work(3) },
    { id: "sa_before", status: "done", task: "t7", endedAt: NOW - 90 * MIN, work: work(1) },
    { id: "sa_noend", status: "done", task: "t7", work: work(1) },
    // A team's worker, and a sub-agent of no task nor team, which the registry lists.
    { id: "sa_w", status: "done", team: { key: "builders" }, description: "tests", endedAt: NOW - MIN, work: work(2) },
    { id: "sa_plain", status: "done", description: "add export", endedAt: NOW - MIN, work: work(5) },
    // Changes shows these waiting, and they are not the agent's to hear of.
    { id: "sa_aside", status: "done", aside: true, endedAt: NOW - MIN, work: work(1) },
    { id: "sa_self", status: "done", origin: "self", endedAt: NOW - MIN, work: work(1) },
    { id: "sa_lost", status: "done", team: { key: "builders" }, attempt: { dropped: "sa_w" }, endedAt: NOW - MIN, work: work(2) },
    // Changes shows none of these waiting: one at work, one whose rebase is due, one with nothing.
    { id: "sa_run", status: "running", task: "t1", work: work(2) },
    { id: "sa_rebase", status: "done", task: "t9", rebaseDue: true, endedAt: NOW - MIN, work: work(2) },
    { id: "sa_none", status: "done", task: "t8", endedAt: NOW - MIN, work: work(0) },
  );
  elsewhere.set("sa_aside", "the developer's own, kept aside");
  elsewhere.set("sa_self", "it started by itself");
  elsewhere.set("sa_lost", "an attempt another won: its work goes");
  const graph = { startedAt: NOW - 60 * MIN, tasks };
  // The registry's own list (subagents.js `openWork`): a sub-agent of no graph task — a team's worker too —, not the
  // developer's own, nor one that started by itself, nor an attempt another won.
  const registry = {
    openWork: () =>
      subs
        .filter((s) => !s.task && !s.aside && s.origin !== "self" && !s.attempt?.dropped && s.status !== "running" && s.work.pending > 0)
        .map((s) => ({ id: s.id, description: s.description || "", running: false, files: s.work.pending })),
    get: (/** @type {string} */ id) => subs.find((s) => s.id === id) || null,
  };

  // Changes, as its tab draws it: each sub-agent's copy, and what waits in it for the person's Apply.
  const answer = { ok: true, places: [{ kind: "folder", place: "/r", ok: true, files: [] }, ...subs.map((s) => ({ kind: "copy", sub: s.id, place: `/c/${s.id}`, ok: true, files: [] }))] };
  const model = changesModel(answer, { chain: "c1", live: false, model: "m", subs, clock: () => "" });
  const waits = new Set(model.mine.filter((b) => b.kind === "copy" && b.waits > 0).map((b) => String(b.sub?.id)));
  for (const s of subs) assert.equal(waitsInChanges(s), waits.has(s.id), `${s.id}: Changes and Still open tell alike whether its change waits`);
  assert.ok(model.waits, "Changes says files wait");

  const open = createStillOpen({ registry, archive: () => archiveOf(), changes: () => changesOf(subs, graph), now: () => NOW });
  const card = open.shown("c1").items.filter((i) => i.view.group === "waiting" && i.view.act === "review");
  const named = new Set(card.map((i) => String(i.view.agent)));
  for (const id of waits) {
    if (elsewhere.has(id)) assert.ok(!named.has(id), `${id}: ${elsewhere.get(id)}`);
    else assert.ok(named.has(id), `${id}: its change waits in Changes, and the card names it`);
  }
  assert.deepEqual([...waits].filter((id) => !named.has(id)).sort(), [...elsewhere.keys()].sort(), "none left out but those named");
  for (const id of named) assert.ok(waits.has(id), `${id}: the card names no change Changes does not show waiting`);
  assert.equal(card.length, named.size, "each change once");
});
