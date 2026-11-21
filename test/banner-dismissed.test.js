// @ts-check
// A banner dismissed stays dismissed (the Hunters' pass of 10-27 over the transcript). Dismiss took the error banner off
// the page and left it the turn's, so the next lay-out of the turn — a run event, a card placed, the chat drawn again —
// put it back. And a table's Download CSV lets its file's address go. The real timeline is drawn here, on the stub
// document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
const g = /** @type {any} */ (globalThis);
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));

before(async () => {
  dom = stubDocument();
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
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  host = document.createElement("div");
  tl = createTimeline(host, /** @type {any} */ ({ onRetry() {} }));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

/** The Dismiss buttons drawn. */
const dismissButtons = () => host.querySelectorAll("button").filter((/** @type {any} */ b) => b.textContent === "Dismiss");

// (fails before: yes — the banner was back after the next lay-out, and after the chat was drawn again)
test("an error banner dismissed stays away when the turn is laid out again and when the chat is drawn again", () => {
  const turn = /** @type {any} */ ({ n: 1, status: "error", error: "the provider refused the request", errorDetail: "", past: false, blocks: [], steers: [], segments: [], startedAt: Date.now() });
  const chat = { turns: [turn], live: null };
  tl.render(chat);
  const [button] = dismissButtons();
  assert.ok(button, "the banner is drawn, with its Dismiss");
  button.dispatch("click");
  assert.equal(dismissButtons().length, 0, "dismissed");
  tl.placeCards(turn);
  assert.equal(dismissButtons().length, 0, "the next lay-out leaves it away");
  tl.render(chat);
  assert.equal(dismissButtons().length, 0, "the chat drawn again leaves it away");
});

// (fails before: yes — the bug hunt of 10-30, a Low: each press of a table's Download CSV made a file's address that was
// never let go, its table held for the page's life)
test("a table's Download CSV downloads its rows, and lets the file's address go once the download has it", async () => {
  const d = /** @type {any} */ (dom.document);
  const row = (/** @type {string} */ tag, /** @type {string[]} */ cells) => {
    const tr = d.createElement("tr");
    tr.append(...cells.map((x) => { const c = d.createElement(tag); c.textContent = x; return c; }));
    return tr;
  };
  const table = d.createElement("table");
  table.append(row("th", ["a", "b"]), row("td", ["1", 'say "hi"']));
  const button = d.createElement("button");
  button.className = "table-csv";
  const wrap = d.createElement("div");
  wrap.className = "table-wrap";
  wrap.append(button, table);
  const scroller = host.querySelector(".transcript");
  scroller.append(wrap);
  /** @type {Blob[]} */
  const made = [];
  /** @type {string[]} */
  const clicked = [];
  /** @type {string[]} */
  const revoked = [];
  /** @type {{ fn: () => void, ms: number }[]} */
  const later = [];
  const had = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, element: d.createElement, setTimeout: g.setTimeout };
  URL.createObjectURL = (/** @type {Blob} */ b) => (made.push(b), `blob:csv-${made.length}`);
  URL.revokeObjectURL = (/** @type {string} */ u) => void revoked.push(u);
  d.createElement = (/** @type {string} */ tag) => {
    const el = had.element(tag);
    if (tag === "a") el.click = () => void clicked.push(el.getAttribute("href"));
    return el;
  };
  g.setTimeout = (/** @type {() => void} */ fn, /** @type {number} */ ms) => (later.push({ fn, ms }), 0);
  try {
    scroller.dispatch("click", { target: button });
  } finally {
    URL.createObjectURL = had.create;
    d.createElement = had.element;
    g.setTimeout = had.setTimeout;
  }
  try {
    assert.deepEqual(clicked, ["blob:csv-1"], "downloaded");
    assert.equal(await made[0].text(), '"a","b"\n"1","say ""hi"""');
    assert.deepEqual([revoked, later.map((l) => l.ms)], [[], [10_000]], "kept while the download takes it");
    for (const l of later) l.fn();
    assert.deepEqual(revoked, ["blob:csv-1"], "then let go");
  } finally {
    URL.revokeObjectURL = had.revoke;
    wrap.remove();
  }
});
