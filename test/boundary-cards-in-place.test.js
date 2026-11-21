// @ts-check
// A finished agent's card between turns keeps its Hide under a resting pointer (the owner's of 11-02: "when the sub
// agent that i spawned would finish i could see a Hide button in the transcript, hovering over Hide button would cause
// it to blink"). The card painted its Hide anew each time the agents' list moved, and the turn's rows between turns were
// made anew whole — every card with its Hide — at each mark heard of any agent of the chat, and at each draw of the
// agents asked before a chat's first turn: a new element under the pointer, its hover started over and a press on it
// lost. Each card now stands while what it is drawn from holds, and paints its own buttons in place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";
import { createTimeline } from "../src/ui/harness/conversation/timeline.js";

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

/** An agent you asked between turns, by its tag. @param {string} id */
const markOf = (id) => ({ type: "subagent", event: "dispatch", agentId: id, exchange: 0, at: 1_000, afterTurn: 1, card: { tag: "hunter", name: `Hunter ${id}` }, asked: true, question: `Hunt ${id}` });

/** The page's store of the chat's agents, as the cards read it: each done, and a list that moves as one tells it. */
function store() {
  /** @type {Set<() => void>} */
  const heard = new Set();
  /** @type {string[]} */
  const closed = [];
  const KEYS = /** @type {const} */ (["cardMarks", "subagentRow", "subagentsKnown", "cardClosed", "watchSubagents"]);
  Object.assign(chipActions, {
    cardMarks: (/** @type {string} */ id) => ({ dispatch: markOf(id) }),
    subagentRow: (/** @type {string} */ id) => ({ id, status: "done", exchanges: [{ status: "done", startedAt: 1_000, endedAt: 9_000, report: `Nothing found by ${id}.` }] }),
    subagentsKnown: () => true,
    cardClosed: { has: () => false, close: (/** @type {string} */ id) => closed.push(id) },
    watchSubagents: (/** @type {() => void} */ fn) => (heard.add(fn), () => heard.delete(fn)),
  });
  return {
    closed,
    /** The list moved: every card that follows it paints. */
    moved: () => { for (const fn of [...heard]) fn(); },
    restore: () => { for (const k of KEYS) /** @type {any} */ (chipActions)[k] = null; },
  };
}

/** The Hide of the card of `id`, under `host`. @param {any} host @param {string} id @returns {any} */
const hideOf = (host, id) => host.querySelector(`.ask-card[data-agent='${id}']`)?.querySelector(".ask-card-hide") || null;

// (fails before: yes — the card made its Hide anew at each move of the agents' list, and the rows between turns were
// made anew whole at each mark heard)
test("a finished agent's card after its turn keeps its Hide as the agents' list moves and as another agent's mark comes in", async () => {
  const dom = stubDocument();
  const restore = pageGlobals();
  const s = store();
  try {
    const host = /** @type {any} */ (document.createElement("div"));
    document.body.append(host);
    const tl = createTimeline(host, /** @type {any} */ ({}));
    const turn = { n: 1, status: "done", past: false, blocks: [{ type: "text", text: "Done." }], steers: [], segments: [], boundaries: [], boundariesAfter: [markOf("sa_1")], startedAt: Date.now() };
    tl.render({ turns: [turn], live: null });
    await new Promise((r) => queueMicrotask(() => r(null)));
    const hide = hideOf(host, "sa_1");
    const card = host.querySelector(".ask-card[data-agent='sa_1']");
    assert.ok(hide && card, "its card, with its Hide");
    const slot = card.closest(".boundaries");
    let left = 0;
    const removeChild = slot.removeChild;
    slot.removeChild = function (/** @type {any} */ n) {
      if (n.contains?.(card)) left++;
      return removeChild.call(this, n);
    };
    // The agents' list moves: the card paints.
    s.moved();
    assert.equal(hideOf(host, "sa_1"), hide, "its Hide stands as the list moves");
    // Another agent asked meanwhile: its mark lands after the same turn, and the turn's rows are drawn (app.js placeMark).
    turn.boundariesAfter = [...turn.boundariesAfter, markOf("sa_2")];
    tl.drawBoundaries(turn);
    slot.removeChild = removeChild;
    assert.equal(host.querySelector(".ask-card[data-agent='sa_1']"), card, "its card stands as another's comes in");
    assert.equal(hideOf(host, "sa_1"), hide, "and its Hide");
    assert.equal(left, 0, "never taken off the page");
    assert.ok(hideOf(host, "sa_2"), "the other's card, drawn");
    hide.dispatch("click");
    assert.deepEqual(s.closed, ["sa_1"], "its Hide acts");
  } finally {
    s.restore();
    restore();
    dom.restore();
  }
});

// (fails before: yes — the agents asked before a chat's first turn were drawn anew whole at each mark heard)
test("a finished agent's card asked before the chat's first turn keeps its Hide as another agent is asked", async () => {
  const dom = stubDocument();
  const restore = pageGlobals();
  const s = store();
  try {
    const host = /** @type {any} */ (document.createElement("div"));
    document.body.append(host);
    const tl = createTimeline(host, /** @type {any} */ ({}));
    const chat = { turns: [], live: null, asked: [{ ...markOf("sa_1"), afterTurn: 0 }] };
    tl.render(chat);
    tl.drawAsked(chat);
    await new Promise((r) => queueMicrotask(() => r(null)));
    const hide = hideOf(host, "sa_1");
    assert.ok(hide, "its card's Hide");
    s.moved();
    chat.asked = [...chat.asked, { ...markOf("sa_2"), afterTurn: 0 }];
    tl.drawAsked(chat);
    assert.equal(hideOf(host, "sa_1"), hide, "its Hide stands as another agent is asked");
    assert.ok(hideOf(host, "sa_2"), "the other's card, drawn");
  } finally {
    s.restore();
    restore();
    dom.restore();
  }
});
