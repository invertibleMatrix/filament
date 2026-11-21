// @ts-check
// The performance Hunter's finds of 10-25, confirmed and fixed: a live turn's frame did work that grew with the turn.
// A round's tool calls were grouped again from each call on (`groupRuns(tools.slice(i))`, quadratic in a sub-agent's
// hundreds of calls), and every sub-agent's card was built anew at every frame — its calls' rows, its report's markdown
// — whether or not anything it shows had moved. The groups are now found once, and a sub-agent's card is kept while its
// run's events said nothing new of it and the session's list says the same of its end. A row is kept by how often its
// call's events moved it (labels.js `callRev`), not by reading its whole record again at every frame; read again from
// its head, the log's unchanged rows are kept by what they are drawn from. A row drawn again is drawn into the one that
// stands (render.js `drawInto`, the owner's of 11-01): a mark on it that only a drawing takes off says it was drawn.
// (fails before: yes — the card was a new element at every placement)
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { groupRuns, roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { alignEvents, alignOnto } from "../src/ui/harness/lib/labels.js";

/** A mark on a row's own element, which a drawing of it takes off: whether it was drawn since. @param {any} el */
const mark = (el) => el.setAttribute("data-unchanged", "");
/** @param {any} el */
const drawnSince = (el) => !el.hasAttribute("data-unchanged");

/** A seeded random, so a failure names its sequence. @param {number} seed */
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

test("a round's groups found once are the ones found again from each call on", () => {
  const NAMES = ["read", "grep", "glob", "edit", "write", "bash", "web_fetch", "mcp__gh__issues", "tasks", "plan", "some_tool", "filament_memory_search"];
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const tools = Array.from({ length: 2 + Math.floor(r() * 40) }, (_, i) => ({
      id: `c${i}`,
      name: NAMES[Math.floor(r() * NAMES.length)],
      state: r() < 0.1 ? "running" : r() < 0.15 ? "cut" : r() < 0.25 ? "failed" : "done",
      ...(r() < 0.05 ? { images: [{ ref: "x" }] } : {}),
    }));
    const toggles = { explore: r() < 0.8, changes: r() < 0.8, terminal: r() < 0.8 };
    /** The walk the rows took before: the groups found again at each step. */
    const before = [];
    for (let i = 0; i < tools.length; ) {
      const g = groupRuns(tools.slice(i), toggles).find((x) => x.start === 0);
      before.push(g ? [i, g.length, g.family] : [i, 1, null]);
      i += g ? g.length : 1;
    }
    const at = new Map(groupRuns(tools, toggles).map((g) => [g.start, g]));
    const after = [];
    for (let i = 0; i < tools.length; ) {
      const g = at.get(i);
      after.push(g ? [i, g.length, g.family] : [i, 1, null]);
      i += g ? g.length : 1;
    }
    assert.deepEqual(after, before, `seed ${seed}`);
  }
});

test("a sub-agent's card is kept while nothing it shows moved, and drawn again when its run or its end does", () => {
  const doc = stubDocument();
  try {
    /** @type {any[]} */
    const events = [
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, id: "a1", name: "agent", args: { description: "Slice one" } },
      { type: "subagent-start", round: 1, parent: "a1", agentId: "sa1", description: "Slice one", model: "m-1" },
      { type: "subagent-tool-start", round: 1, parent: "a1", id: "s1", name: "read", args: { path: "a.js" } },
      { type: "subagent-tool-end", round: 1, parent: "a1", id: "s1", name: "read", ok: true, ms: 2, preview: "x" },
      { type: "tool-start", round: 1, id: "r1", name: "read", args: { path: "b.js" } },
    ];
    /** @type {Map<string, { sig: string, row: HTMLElement }>} */
    const drawn = new Map();
    // The live turn's log as the page holds it: one array, grown, aligned onto what was aligned of it (timeline.js).
    const cache = {};
    const rowsOf = (/** @type {any[]} */ more = []) => {
      events.push(...more);
      return roundRows(alignOnto(cache, events).byRound.get(1), { drawn, runId: "run-1" });
    };
    const card = (/** @type {any[]} */ rows) => rows.find((el) => String(el.textContent || "").includes("Slice one"));
    const read = (/** @type {any[]} */ rows) => rows.find((el) => String(el.textContent || "").includes("b.js"));
    /** The card's row: the helper's card stands with the lines of what it drew under it. @param {any[]} rows */
    const cardRow = (rows) => card(rows).children[0];
    const first = rowsOf();
    mark(cardRow(first));
    // Another event of the turn, none of the sub-agent's: its card stays as it was drawn.
    const second = rowsOf([{ type: "tool-end", round: 1, id: "r1", name: "read", ok: true, ms: 1, preview: "y" }]);
    assert.ok(card(first), "the sub-agent's card is drawn");
    assert.equal(card(second), card(first), "kept: nothing of it moved");
    assert.equal(drawnSince(cardRow(second)), false, "nor drawn again");
    assert.notEqual(read(second), read(first), "the call that ended is drawn again");
    mark(read(second));
    // Its run moved: a call of its own. Drawn again, in the card that stands; the call beside it, which did not move, is kept.
    const third = rowsOf([{ type: "subagent-tool-start", round: 1, parent: "a1", id: "s2", name: "grep", args: { pattern: "q" } }]);
    assert.equal(drawnSince(cardRow(third)), true, "its own call moved it");
    assert.equal(card(third), card(first), "in the card that stood");
    assert.equal(read(third), read(second));
    assert.equal(drawnSince(read(third)), false);
    // Its end, as its run says it: drawn again with its report.
    const before = String(card(third).textContent);
    mark(cardRow(third));
    const fourth = rowsOf([{ type: "subagent-end", round: 1, parent: "a1", ok: true, status: "done", report: "REPORT WORDS", ms: 9 }]);
    assert.equal(drawnSince(cardRow(fourth)), true);
    assert.match(String(card(fourth).textContent), /Report$/, "its report section, its markdown drawn as HTML");
    assert.doesNotMatch(before, /Report$/);
  } finally {
    doc.restore();
  }
});

test("the log read again from its head keeps the rows of calls that did not change", () => {
  const doc = stubDocument();
  try {
    const log = [
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, id: "r1", name: "read", args: { path: "a.js" } },
      { type: "tool-end", round: 1, id: "r1", name: "read", ok: true, ms: 1, preview: "x" },
      { type: "tool-start", round: 1, id: "r2", name: "bash", args: { command: "npm test" } },
    ];
    /** @type {Map<string, { sig: string, row: HTMLElement }>} */
    const drawn = new Map();
    const rowsOf = (/** @type {any[]} */ l) => roundRows(alignEvents(l).byRound.get(1), { drawn, runId: "run-1" });
    // Each call's own row, as the round keeps it (the two ended fold into one group's row, which holds them).
    const row = (/** @type {string} */ id) => drawn.get(`call:${id}`)?.row;
    rowsOf(log);
    const [read, ran] = [row("r1"), row("r2")];
    assert.ok(read && ran);
    mark(read);
    mark(ran);
    // The turn's end: its log as the run kept it, aligned afresh, its last call ended.
    rowsOf([...log, { type: "tool-end", round: 1, id: "r2", name: "bash", ok: true, ms: 5, preview: "ok" }]);
    assert.deepEqual([row("r1"), drawnSince(read)], [read, false], "kept: its call is the same");
    assert.equal(drawnSince(/** @type {any} */ (row("r2"))), true, "drawn again: it ended");
  } finally {
    doc.restore();
  }
});
