// @ts-check
// A chat whose turn has run for hours, shown again (the owner's of 10-31: "when i go to another chat thread and then
// open this thread back. two issues. it takes about 6 or 7 seconds to open this thread. second issue you will see in
// the screen some empty space above composer", and two closed agents' cards that showed as working for a moment).
// The page draws the running turn whole on the switch back, and each of its commands' outputs was put at its end there
// and then: its height read, in a row still closed, laid that row out on its own — a turn of 940 rounds and 2,174
// outputs, every one in a closed row, took 4.0 s to draw in Chromium, and the scroll each set fired 2.2 s more in the
// frame after. An output in a closed row now goes to its end as its row opens: the same turn, drawn again, takes half a
// second. A card you closed took its row's padding with it nowhere: the row stood, an empty space under the turn's work.
// And an agent's answer heard while the chat was not shown never reached it: its card waited on the agents' list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { lift } from "./helpers/app-lift.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";
import { placeBoundary } from "../src/ui/harness/conversation/history.js";
import { keepOutputs, createTimeline } from "../src/ui/harness/conversation/timeline.js";

/** A round of two commands that ended, with what they printed. */
const events = [
  { type: "round-start", round: 1, n: 1 },
  { type: "tool-start", id: "b1", name: "bash", args: { command: "npm test" }, n: 2 },
  { type: "tool-end", id: "b1", ok: true, preview: "pass 1\npass 2\npass 3", exitCode: 0, n: 3 },
  { type: "tool-start", id: "b2", name: "bash", args: { command: "npm run lint" }, n: 4 },
  { type: "tool-end", id: "b2", ok: true, preview: "clean", exitCode: 0, n: 5 },
].map((e) => ({ round: 1, ...e }));

// (fails before: yes — every output's height was read as the cards were placed, the ones in closed rows too)
test("a command's output in a closed row is not measured as its turn is drawn: it goes to its end as its row opens", () => {
  const dom = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const hadFrame = "requestAnimationFrame" in g;
  /** @type {(() => void)[]} */
  const frames = [];
  g.requestAnimationFrame = (/** @type {() => void} */ fn) => frames.push(fn);
  const make = dom.document.createElement;
  /** Each output's height read, by the output. @type {Map<any, number>} */
  const reads = new Map();
  dom.document.createElement = (/** @type {string} */ tag) => {
    const el = /** @type {any} */ (make(tag));
    if (tag === "pre") Object.defineProperty(el, "scrollHeight", { get: () => (reads.set(el, (reads.get(el) || 0) + 1), 900) });
    return el;
  };
  try {
    const root = /** @type {any} */ (document.createElement("section"));
    document.body.append(root);
    root.append(...roundRows(alignEvents(events).byRound.get(1), { drawn: new Map(), runId: "run-1" }));
    const outs = root.querySelectorAll("pre.term-out");
    assert.equal(outs.length, 2, "both commands drew their output");
    const rows = outs.map((/** @type {any} */ p) => p.closest("details"));
    assert.ok(rows.every((/** @type {any} */ d) => d && !d.open), "each in its row, closed as a row is drawn");
    // The cards placed (timeline.js placeCards), then the frame after.
    keepOutputs([], root);
    for (const fn of frames.splice(0)) fn();
    assert.equal(reads.size, 0, "no output in a closed row is measured");
    assert.ok(outs.every((/** @type {any} */ p) => !p.hasAttribute("data-end")), "each is seen to once, not at every placing of its turn's cards");
    // Its row opened — the row first, its group's after, as a reader opens them: the output stands at its end, read once.
    for (let d = rows[0]; d; d = d.parentNode?.closest?.("details")) {
      d.open = true;
      d.dispatch("toggle");
    }
    assert.equal(outs[0].scrollTop, 900, "opened: at its end");
    assert.equal(reads.get(outs[0]), 1, "measured once, as it showed");
    assert.equal(reads.get(outs[1]) ?? 0, 0, "the other, its row still closed, is not measured");
    // Folded and opened again, it stays where its reader left it.
    outs[0].scrollTop = 120;
    rows[0].open = false;
    rows[0].dispatch("toggle");
    rows[0].open = true;
    rows[0].dispatch("toggle");
    assert.equal(outs[0].scrollTop, 120, "opened again: where you left it");
  } finally {
    dom.document.createElement = make;
    if (!hadFrame) delete g.requestAnimationFrame;
    dom.restore();
  }
});

test("an output in an open row is at its end in the frame its cards are placed, as before", () => {
  const dom = stubDocument();
  try {
    const root = /** @type {any} */ (document.createElement("section"));
    document.body.append(root);
    const row = /** @type {any} */ (document.createElement("details"));
    row.open = true;
    const p = /** @type {any} */ (document.createElement("pre"));
    p.className = "term-out";
    p.setAttribute("data-end", "");
    p.scrollHeight = 900;
    row.append(p);
    root.append(row);
    keepOutputs([], root);
    assert.deepEqual([p.scrollTop, p.hasAttribute("data-end")], [900, false]);
  } finally {
    dom.restore();
  }
});

/** The globals a drawn timeline reads that node lacks, put in for one test and taken out after. @returns {() => void} */
function pageGlobals() {
  const g = /** @type {any} */ (globalThis);
  const added = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.getComputedStyle ||= () => ({});
  g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage ||= g.localStorage;
  Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
  const d = /** @type {any} */ (document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
  return () => { for (const k of added) delete g[k]; };
}

// (fails before: yes — the row a closed card stood in stayed: its padding an empty space under the turn's work)
test("a card you closed takes its row with it; brought back, its row comes with it", () => {
  const dom = stubDocument();
  const restore = pageGlobals();
  const mark = { type: "subagent", event: "dispatch", agentId: "sa_1", exchange: 0, at: 1_000, afterTurn: 1, card: { tag: "hunter", name: "Hunter" }, asked: true, question: "Hunt the change" };
  let isClosed = true;
  const KEYS = /** @type {const} */ (["cardMarks", "subagentRow", "subagentsKnown", "cardClosed"]);
  Object.assign(chipActions, {
    cardMarks: () => ({ dispatch: mark }),
    subagentRow: () => ({ id: "sa_1", status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 9_000, report: "Nothing found." }] }),
    subagentsKnown: () => true,
    cardClosed: { has: () => isClosed, close: () => {} },
  });
  try {
    const host = document.createElement("div");
    const tl = createTimeline(host, /** @type {any} */ ({}));
    const turn = () => ({ n: 1, status: "done", past: false, blocks: [{ type: "text", text: "Done." }], steers: [], segments: [], boundaries: [], boundariesAfter: [mark], startedAt: Date.now() });
    tl.render({ turns: [turn()], live: null });
    const wrap = /** @type {any} */ (host.querySelector(".boundary-row"));
    assert.ok(wrap?.parentNode?.classList.contains("boundaries"), "the card's row, in the slot after its turn");
    assert.ok(wrap.querySelector(".ask-card").classList.contains("hidden"), "the card closed");
    assert.ok(wrap.classList.contains("hidden"), "its row goes with it");
    isClosed = false;
    tl.render({ turns: [turn()], live: null });
    assert.equal(/** @type {any} */ (host.querySelector(".boundary-row")).classList.contains("hidden"), false, "brought back: its row with it");
    // A slot whose rows all stand closed takes no room either: the turn's gap went with an empty slot alone.
    assert.match(readFileSync("src/ui/harness.css", "utf8"), /\n\.boundaries:not\(:has\(> :not\(\.hidden\)\)\) \{ display: none; \}/);
    assert.match(readFileSync("src/ui/harness/aqua.css", "utf8"), /\n\.turn > \.boundaries:not\(:has\(> :not\(\.hidden\)\)\) \{ display: none; \}/);
  } finally {
    for (const k of KEYS) /** @type {any} */ (chipActions)[k] = null;
    restore();
    dom.restore();
  }
});

// (fails before: yes — the mark was placed only on the chat on screen, so a chat whose turn ran on, never read again
// until it ended, showed the agent's card short of its answer at each showing)
test("an agent's answer heard while its chat is not shown lands on that chat, once", () => {
  const turnOf = (/** @type {number} */ n) => ({ n, boundaries: /** @type {any[]} */ ([]), boundariesAfter: /** @type {any[]} */ ([]) });
  const kept = { id: "c1", chainId: "s1", turns: [turnOf(1), turnOf(2)] };
  const shown = { id: "c2", chainId: "s2", turns: [turnOf(1)] };
  const chats = new Map([["c1", kept], ["c2", shown]]);
  /** @type {any[]} */
  const drawn = [];
  const { markHeard } = lift(["markHeard", "chatByChain"], {
    state: { chats, currentId: "c2" },
    chatOf: (/** @type {string} */ id) => chats.get(id) || null,
    placeBoundary,
    transcript: { drawBoundaries: (/** @type {any} */ t) => drawn.push(t), drawAsked: () => {} },
    subagentStore: { touch: () => {} },
  });
  const heard = { type: "subagent-mark", chainId: "s1", mark: { event: "arrival", agentId: "sa_1", exchange: 0, afterTurn: 2, asked: true, status: "done", answer: "Nothing found." } };
  markHeard(heard);
  markHeard(heard);
  const marks = (/** @type {any} */ c) => c.turns.flatMap((/** @type {any} */ t) => [...t.boundaries, ...t.boundariesAfter]);
  assert.deepEqual(marks(kept).map((/** @type {any} */ b) => [b.type, b.event, b.agentId]), [["subagent", "arrival", "sa_1"]], "on its own chat, once");
  assert.deepEqual(marks(shown), [], "not on the chat shown");
  assert.deepEqual(drawn, [kept.turns[1]], "handed to the transcript, which draws only the chat it shows");
});
