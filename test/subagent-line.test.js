// @ts-check
// The owner's of 11-04: a background reviewer's card read "33 tool uses · in the background", and at each of its reads —
// a few milliseconds each — "Read src/app/agent/subagents.js · in the background" for a frame or two, the line swapping
// back and forth. A sub-agent's call is named on its card's line only once it has run a moment (labels.js
// CALL_NAMED_AFTER_MS): a quick one leaves the count standing; a long one is named, at once where it has run that long
// by the time the card is drawn, else when its wait is out, though no event comes to draw the card again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { askedState } from "../src/ui/harness/conversation/agent-card.js";
import * as labels from "../src/ui/harness/lib/labels.js";

const { alignEvents, alignOnto } = labels;
// Read off the module, so the test runs on code that has no such moment and fails on what its card shows.
const CALL_NAMED_AFTER_MS = labels.CALL_NAMED_AFTER_MS ?? 1000;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** A read of the sub-agent's own, begun `ago` ms back by the run's clock. @param {string} id @param {string} file @param {number} ago */
const reads = (id, file, ago) => ({ type: "subagent-tool-start", round: 1, parent: "a1", id, name: "read", args: file, card: { kind: "read", title: "Read", subject: file }, ts: Date.now() - ago });
/** @param {string} id @param {string} file */
const ends = (id, file) => ({ type: "subagent-tool-end", round: 1, parent: "a1", id, name: "read", ok: true, ms: 3, preview: file });

// (fails before: yes — a call that had just begun was named at once: "Read d.js · in the background", then back to the count)
test("a sub-agent's line keeps its count while a quick call runs, and names one that has run a moment, when its wait is out too", async () => {
  const doc = stubDocument();
  try {
    /** @type {any[]} */
    const events = [
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, id: "a1", name: "agent", args: { description: "Map it" } },
      { type: "subagent-start", round: 1, parent: "a1", agentId: "sa1", description: "Map it", model: "m-1", background: true },
      reads("s1", "a.js", 5000),
      ends("s1", "a.js"),
    ];
    /** @type {Map<string, { sig: string, row: HTMLElement }>} */
    const drawn = new Map();
    const cache = {};
    /** The card's line as the page shows it, the events so far drawn. @param {any[]} [more] */
    const lineNow = (more = []) => {
      events.push(...more);
      const rows = roundRows(alignOnto(cache, events).byRound.get(1), { drawn, runId: "run-1" });
      const card = /** @type {any} */ (rows.find((el) => String(el.textContent || "").includes("Map it")));
      return () => String(card.querySelector(".tool-secondary")?.textContent || "");
    };
    assert.equal(lineNow()(), "1 tool use · in the background");
    // A quick read: begun, and over before its moment — the count stands through it.
    assert.equal(lineNow([reads("s2", "b.js", 0)])(), "2 tool uses · in the background", "a call just begun is not named");
    assert.equal(lineNow([ends("s2", "b.js")])(), "2 tool uses · in the background");
    // One that has run past its moment by the time the card is drawn: named at once.
    assert.equal(lineNow([reads("s3", "c.js", CALL_NAMED_AFTER_MS + 500)])(), "Read c.js · in the background");
    // One drawn just before its moment: named when the wait is out, with no event to draw the card again.
    const shown = lineNow([ends("s3", "c.js"), reads("s4", "d.js", CALL_NAMED_AFTER_MS - 60)]);
    assert.equal(shown(), "4 tool uses · in the background");
    await sleep(200);
    assert.equal(shown(), "Read d.js · in the background", "its wait out, it is named");
    // One that ends before its wait is out: the card drawn for its end keeps the count, whatever the wait does after.
    const quick = lineNow([ends("s4", "d.js"), reads("s5", "e.js", CALL_NAMED_AFTER_MS - 60)]);
    lineNow([ends("s5", "e.js")]);
    await sleep(200);
    assert.equal(quick(), "5 tool uses · in the background", "a call that ended is never named after it");
  } finally {
    doc.restore();
  }
});

// (fails before: yes — the card of an agent the main agent asked read "Read b.js" for a read just begun, then "Thinking…")
test("an asked agent's card names its call only once it has run a moment, its words its own events' while the list has none", () => {
  const told = (/** @type {any[]} */ more) =>
    alignEvents([{ type: "tool-start", round: 1, id: "a1", name: "agent", args: "Q" }, { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", exchange: 0, description: "Q", prompt: "Q", card: { tag: "pm", name: "PM" }, asked: true }, ...more]).byRound.get(1).tools.get("a1").sub;
  const at = { running: true, listed: false, row: null };
  assert.equal(askedState(told([reads("s1", "b.js", 0)]), at).live, "Thinking…", "a read just begun");
  assert.equal(askedState(told([reads("s1", "b.js", CALL_NAMED_AFTER_MS + 500)]), at).live, "Read b.js", "a read that has run a moment");
});
