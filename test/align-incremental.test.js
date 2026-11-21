// @ts-check
// The performance Hunter's find of 10-25, confirmed: a live turn's page aligned the run's whole event log again at
// every frame (`alignEvents`), each command's 4,000-character tail rebuilt from all its output, so a frame's work grew
// with the turn's length and a long turn's page lagged — typing included. The timeline now folds only the events that
// landed since its last frame (`alignOnto`), onto the alignment it keeps; whatever it is handed, the result is the one
// the whole log aligns to. Checked here on random logs of every kind of event that moves state, prefix by prefix.
// (fails before: yes — there was no alignOnto)
import { test } from "node:test";
import assert from "node:assert/strict";
import { alignEvents, alignOnto, letGoOfLog } from "../src/ui/harness/lib/labels.js";

/** A seeded random, so a failure names its log. @param {number} seed */
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/** The alignment as plain data, Maps and Sets in order, so two can be compared whole. @param {any} v @returns {any} */
const plain = (v) =>
  v instanceof Map ? { map: [...v.entries()].map(([k, x]) => [k, plain(x)]) } : v instanceof Set ? { set: [...v].map(plain) } : Array.isArray(v) ? v.map(plain) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;

/** A log a run could write: rounds, calls with output, sub-agents and theirs, the person's messages, asks, compactions. @param {number} seed */
function randomLog(seed) {
  const r = rng(seed);
  const pick = (/** @type {any[]} */ a) => a[Math.floor(r() * a.length)];
  /** @type {any[]} */
  const events = [{ type: "run-start", kind: r() < 0.3 ? "coding-agent" : "agent-turn", meta: { agent: "Claude Code", holds: r() < 0.5 } }];
  let round = 0;
  /** @type {string[]} */ const open = [];
  /** @type {string[]} */ const agents = [];
  /** @type {string[]} */ const steers = [];
  let n = 0;
  for (let i = 0; i < 260; i++) {
    const k = r();
    if (k < 0.08) events.push({ type: "round-start", round: ++round, blocksBefore: round });
    else if (k < 0.25) {
      const id = `c${++n}`;
      open.push(id);
      events.push({ type: "tool-start", round, id, name: pick(["read", "bash", "edit", "grep"]), args: { path: `f${n}.js` } });
    } else if (k < 0.33 && open.length) events.push({ type: "tool-output", round, id: pick(open), text: `line ${i} `.repeat(1 + Math.floor(r() * 300)) });
    else if (k < 0.45 && open.length) {
      const id = open.splice(Math.floor(r() * open.length), 1)[0];
      events.push({ type: "tool-end", round, id, name: "read", ok: r() < 0.85, ms: i, preview: `result ${i}` });
    } else if (k < 0.5) {
      const parent = `ag${++n}`;
      events.push({ type: "tool-start", round, id: parent, name: "agent", args: { description: `slice ${n}` } });
      events.push({ type: "subagent-start", round, parent, agentId: `sa${n}`, description: `slice ${n}`, model: "m-1" });
      agents.push(parent);
    } else if (k < 0.62 && agents.length) {
      const parent = pick(agents);
      const id = `${parent}-t${i}`;
      events.push({ type: "subagent-tool-start", round, parent, id, name: "read", args: {} });
      if (r() < 0.8) events.push({ type: "subagent-tool-end", round, parent, id, name: "read", ok: true, ms: 3 });
    } else if (k < 0.66 && agents.length) {
      const parent = agents.splice(Math.floor(r() * agents.length), 1)[0];
      events.push({ type: "subagent-end", round, parent, ok: r() < 0.8, status: pick(["done", "failed", "stopped"]), report: `## report ${i}`, ms: 9 });
      events.push({ type: "tool-end", round, id: parent, name: "agent", ok: true, ms: 9 });
    } else if (k < 0.7) {
      const id = `st${++n}`;
      steers.push(id);
      events.push({ type: "steer", id, kind: "note", text: `note ${i}`, at: i, round, from: r() < 0.2 ? "lead" : "developer" });
    } else if (k < 0.74 && steers.length) events.push({ type: pick(["steer-read", "steer-unread", "steer-sent", "steer-drop"]), round, ids: [pick(steers)], after: r() < 0.5 });
    else if (k < 0.76 && steers.length) events.push({ type: "steer-edit", id: pick(steers), text: `edited ${i}` });
    else if (k < 0.78) events.push({ type: "compacting", round });
    else if (k < 0.8) events.push({ type: "compaction", round, fromRound: 1, toRound: round, by: "m-1" });
    else if (k < 0.82) events.push({ type: "ask", round, id: `q${++n}`, waits: true, form: { q: 1 }, call: open[0] });
    else if (k < 0.84) events.push({ type: "ask-end", round, id: `q${n}`, words: ["yes"] });
    else if (k < 0.86) events.push({ type: "plan", round, items: [{ text: `step ${i}`, status: pick(["done", "pending"]) }] });
    else if (k < 0.88) events.push({ type: "turn-state", round, to: pick(["sent", "thinking", "calling"]), why: "", ts: i + 1 });
    else if (k < 0.9) events.push({ type: "notice", round, kind: "stop", text: `n${i}` });
    else if (k < 0.92) events.push({ type: "visual-writing", round, id: `v${i}`, title: "a picture", chars: i });
    else if (k < 0.94) events.push({ type: "subagent-dispatch", round, agentId: `sa${n}`, exchange: 0, description: "x" });
    else if (k < 0.96) events.push({ type: "subagent-report", round, agentId: `sa${n}`, description: "x" });
    else if (k < 0.97) events.push({ type: "agent-notice", round, severity: "info", title: `t${i}` });
  }
  if (r() < 0.7) events.push({ type: "run-end", status: pick(["done", "paused", "failed"]) });
  return events;
}

test("folding the events as they land gives what the whole log gives, at every frame", () => {
  for (const seed of [1, 7, 42, 99, 1234, 31337]) {
    const log = randomLog(seed);
    /** @type {any[]} */
    const live = [];
    const cache = {};
    let i = 0;
    while (i < log.length) {
      // A frame takes what landed since the last: one event, or a burst.
      const burst = 1 + (i % 7);
      live.push(...log.slice(i, i + burst));
      i += burst;
      assert.deepEqual(plain(alignOnto(cache, live)), plain(alignEvents(live)), `seed ${seed}, after ${live.length} events`);
    }
  }
});

test("a log it was not folding, or one rewritten under it, is aligned whole again", () => {
  const log = randomLog(5);
  const cache = {};
  const first = log.slice(0, 120);
  alignOnto(cache, first);
  // The record's own log at the turn's end: another array.
  assert.deepEqual(plain(alignOnto(cache, log)), plain(alignEvents(log)));
  // The same array cut shorter than what was folded, or its newest event replaced: aligned whole.
  const again = log.slice();
  alignOnto(cache, again);
  again.length = 200;
  again[199] = { type: "tool-start", round: 0, id: "swapped", name: "read", args: {} };
  assert.deepEqual(plain(alignOnto(cache, again)), plain(alignEvents(again)));
  again.length = 50;
  assert.deepEqual(plain(alignOnto(cache, again)), plain(alignEvents(again)));
  again[49] = { type: "plan", round: 0, items: [{ text: "other", status: "pending" }] };
  assert.deepEqual(plain(alignOnto(cache, again)), plain(alignEvents(again)));
});

// The owner's of 11-15, the page's process at 1.4 GB after three days: a cache kept the whole log it aligned (`list`),
// up to 40 MB of JSON for one heavy turn, for every ended turn the page drew. Once it holds all of a run that is over,
// it keeps the alignment alone.
// (fails before: yes — there was no letGoOfLog, and a cache handed no log aligned nothing)
test("a log aligned whole is let go of, its alignment read as it stands", () => {
  for (const seed of [3, 42]) {
    const log = randomLog(seed);
    const cache = /** @type {any} */ ({});
    const want = plain(alignOnto(cache, log));
    assert.equal(letGoOfLog(cache, log), true);
    assert.equal(cache.list, null, "no reference to the log");
    assert.equal(cache.last, null, "nor to its newest event");
    assert.deepEqual(plain(alignOnto(cache, null)), want, "handed no log, what it holds");
    assert.deepEqual(plain(alignOnto(cache, null)), want, "and again: nothing folds twice");
    // Handed a log again, even the same array, it cannot know what of it is folded: it aligns it from its head.
    assert.deepEqual(plain(alignOnto(cache, log)), want);
    assert.equal(cache.whole, false);
    assert.equal(cache.list, log);
  }
});

test("a cache that holds less of the log than it has, or another log, keeps it", () => {
  const log = randomLog(8);
  const cache = /** @type {any} */ ({});
  const part = log.slice(0, 40);
  alignOnto(cache, part);
  part.push(...log.slice(40));
  assert.equal(letGoOfLog(cache, part), false, "events past what it folded");
  assert.equal(cache.list, part);
  assert.equal(letGoOfLog(cache, log), false, "another array");
  assert.equal(letGoOfLog({}, log), false, "nothing aligned");
  assert.deepEqual(plain(alignOnto(cache, part)), plain(alignEvents(part)), "and goes on folding it");
});
