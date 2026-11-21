// @ts-check
// Your agent's work pane drawn again keeps the boxes under the pointer (the owner's of 11-01: "when i hover over my
// mouse over some interactive elements like buttons then those are just suppose to highlight only once they quite a
// lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have to press
// more than once"). The pane was built again whole whenever its key moved — each pulse of a run that moved an agent,
// each 30 s of the clock that turned a box's figures —: a box, Earlier steps and Open its thread new elements under a
// resting pointer, whose hover started over and where a press that began on the old one never clicked. Drawn in place
// (dom.js `morphChildren`), each step, box and part keyed by what it is, they are the elements that stood.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { NOW, agentRow } from "./helpers/side-view.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/views/agent-work.js")} */
let pane;
/** @type {typeof import("../src/ui/harness/lib/agent-work.js")} */
let lib;
before(async () => {
  doc = stubDocument();
  pane = await import("../src/ui/harness/views/agent-work.js");
  lib = await import("../src/ui/harness/lib/agent-work.js");
});
after(() => doc.restore());

const S = 1000;
/** An ask your agent made. @param {number} start  seconds before NOW @param {number | null} end  null while it runs @param {Record<string, any>} [o] */
const ask = (start, end, o = {}) => ({
  prompt: `PROMPT ${start}`, description: `Task ${start}`, by: "agent", runId: null, status: end == null ? "running" : "done", startedAt: NOW - start * S,
  endedAt: end == null ? null : NOW - end * S, delivery: "tool", report: end == null ? undefined : `ANSWER ${start}`, spentUsd: 0.01, ...o,
});
/** A thread of your agent's. @param {string} id @param {string} name @param {any[]} exchanges */
const thread = (id, name, exchanges) =>
  agentRow(id, { origin: "agent", card: { tag: name.toLowerCase(), name }, model: "zai/glm-5.3-flash", status: exchanges.some((x) => x.status === "running") ? "running" : "done", exchanges });
/** @param {string} run @param {number} round */
const sent = (run, round) => ({ sentIn: { run, round } });
const TURNS = [{ runId: "turn-1", n: 1, userText: "fix the parser and add tests" }];

/** The pane over rows the test moves, on a clock it turns. @param {any[]} rows */
const paneOf = (rows) => {
  /** @type {string[]} */
  const opened = [];
  const at = { rows, t: NOW };
  const p = pane.createWorkPane({ work: () => lib.workOf({ rows: at.rows, turns: TURNS }), cards: () => [], openThread: (id) => void opened.push(id), now: () => at.t });
  const el = /** @type {any} */ (p.el);
  doc.document.body.append(el);
  const chat = { chainId: "c1" };
  p.paint(chat);
  return { el, opened, at, paint: () => p.paint(chat) };
};
/** A box by its id. @param {any} el @param {string} id @returns {any} */
const box = (el, id) => el.querySelector(`[data-box="${id}"]`);
/** A button by its words. @param {any} at @param {RegExp} words @returns {any} */
const button = (at, words) => at.querySelectorAll("button").find((/** @type {any} */ b) => words.test(b.textContent)) || null;

// (fails before: yes — the pane was placed anew whole at each draw whose key moved, the clock's 30 s among them)
test("drawn again as the clock turns and an agent ends, the boxes stand, and a press on one shows its detail, whose Open its thread stands too", () => {
  const v = paneOf([
    thread("s1", "Scout", [ask(100, 60, sent("turn-1", 3))]),
    thread("h1", "Helper", [ask(99.9, null, sent("turn-1", 3))]),
    thread("b1", "Builder", [ask(50, 10, sent("turn-1", 5))]),
  ]);
  try {
    const s1 = box(v.el, "s1#0");
    const h1 = box(v.el, "h1#0");
    const b1 = box(v.el, "b1#0");
    assert.ok(s1 && h1 && b1, "a box for each agent");
    const figures = h1.querySelector(".fl-box-needs").textContent;
    // Half a minute on: Helper's figures move, in the box that stood.
    v.at.t += 30_000;
    v.paint();
    assert.equal(box(v.el, "h1#0"), h1, "Helper's box is the element it was");
    assert.equal(box(v.el, "s1#0"), s1);
    assert.equal(box(v.el, "b1#0"), b1);
    assert.notEqual(h1.querySelector(".fl-box-needs").textContent, figures, "its figures say how long it has worked now");
    // Helper ends: its box stands, done.
    v.at.rows = [v.at.rows[0], thread("h1", "Helper", [ask(99.9, 20, sent("turn-1", 3))]), v.at.rows[2]];
    v.paint();
    assert.equal(box(v.el, "h1#0"), h1, "ended, it is still the box that stood");
    assert.ok(h1.classList.contains("st-done"), h1.className);
    assert.ok(!v.el.querySelector(".fl-card").classList.contains("is-running"));
    // A press on it opens its detail; the clock turns; Open its thread is the button it was, and opens the thread.
    h1.dispatch("click");
    assert.equal(h1.getAttribute("aria-pressed"), "true");
    const open = button(v.el, /^Open its thread$/);
    assert.ok(open, "its detail, with Open its thread");
    v.at.t += 30_000;
    v.paint();
    assert.equal(button(v.el, /^Open its thread$/), open);
    assert.equal(box(v.el, "h1#0"), h1);
    open.dispatch("click");
    assert.deepEqual(v.opened, ["h1"]);
    // Pressed again, the box that stood folds its detail.
    h1.dispatch("click");
    assert.equal(h1.getAttribute("aria-pressed"), "false");
    assert.equal(v.el.querySelector(".fl-detail"), null);
  } finally {
    v.el.remove();
  }
});

// (fails before: yes — Earlier steps was a new button at each draw)
test("Earlier steps stands as the clock turns, and its press shows the steps before", () => {
  const many = Array.from({ length: lib.STEPS_SHOWN + 3 }, (_, i) => thread(`a${i}`, `Agent${i}`, [ask(1000 - i * 10, 995 - i * 10, sent("turn-1", i + 1))]));
  const v = paneOf(many);
  try {
    const earlier = button(v.el, /^Earlier steps · 3$/);
    assert.ok(earlier);
    assert.equal(v.el.querySelectorAll(".fl-step").length, lib.STEPS_SHOWN);
    v.at.t += 30_000;
    v.paint();
    assert.equal(button(v.el, /^Earlier steps · 3$/), earlier, "the button that stood");
    earlier.dispatch("click");
    assert.equal(v.el.querySelectorAll(".fl-step").length, lib.STEPS_SHOWN + 3);
    assert.equal(button(v.el, /^Earlier steps/), null);
  } finally {
    v.el.remove();
  }
});
