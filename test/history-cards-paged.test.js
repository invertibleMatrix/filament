// @ts-check
// A finished turn's cards come from its whole run, however long (the Hunters' pass of 10-27 over the transcript). The
// page read a past turn's run once, its first 5,000 events: a long turn's newest rounds — its last work, the files it
// changed — were never drawn. The real timeline reads here, on the stub document, from a run served a page at a time.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
const g = /** @type {any} */ (globalThis);
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
const fetchWas = g.fetch;

// A run of 6,000 events: rounds 1 and 2 fill the first 5,000, round 3 is in the rest.
/** @type {any[]} */
const RUN = [];
for (let n = 1; RUN.length < 6000; n++) {
  const round = n < 2500 ? 1 : n < 5200 ? 2 : 3;
  RUN.push({ n, type: "tool-start", round, name: "read", id: `c${n}`, args: "a.txt" });
}
/** The URLs the page asked for. @type {string[]} */
const asked = [];

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
  // The server's read: the events after `since`, at most `limit` of them (services/runs.js).
  g.fetch = async (/** @type {string} */ url) => {
    asked.push(url);
    const m = /\/runs\/[^/]+\/events\?since=(\d+)&limit=(\d+)/.exec(url);
    const events = m ? RUN.filter((e) => e.n > Number(m[1])).slice(0, Number(m[2])) : [];
    return { ok: true, status: 200, json: async () => ({ events }) };
  };
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  tl = createTimeline(document.createElement("div"), /** @type {any} */ ({}));
});
after(() => {
  g.fetch = fetchWas;
  for (const k of ADDED) delete g[k];
  dom.restore();
});

// (fails before: yes — one read of 5,000: the turn's newest round was 2)
test("a past turn whose run is longer than a page is read to its end: its newest round's cards are there", async () => {
  const turn = /** @type {any} */ ({ n: 1, status: "done", past: false, history: true, runId: "r-long", blocks: [{ type: "text", text: "done" }], steers: [], segments: [], startedAt: Date.now() });
  tl.render({ turns: [turn], live: null });
  await tl.loadRun(turn);
  assert.equal(turn.aligned?.maxRound, 3, "the last page's round is the turn's");
  assert.equal(asked.filter((u) => u.includes("/runs/r-long/events")).length, 2, "two reads: a full page, then the rest");
});
