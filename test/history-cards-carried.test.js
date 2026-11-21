// @ts-check
// A turn's run log read once (the chat-open audit of 10-29). A running turn the page follows was read twice from its
// start — by its follow, and again by the timeline as a past turn's cards — and once it ended, a third time, when the
// transcript was read for its final words and made the turn anew. The real timeline reads here, on the stub document:
// a turn its follow reads is not read again; a turn whose whole log came with it from the reading before draws its cards
// from that log, the same cards, with no read; a log is kept with its turn only once the turn has ended.
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

/** A short run: two rounds of reads. */
const RUN = [
  { n: 1, type: "round-start", round: 1 },
  { n: 2, type: "tool-start", round: 1, name: "read", id: "c1", args: "a.txt" },
  { n: 3, type: "tool-end", round: 1, id: "c1", ok: true },
  { n: 4, type: "round-start", round: 2 },
  { n: 5, type: "tool-start", round: 2, name: "read", id: "c2", args: "b.txt" },
  { n: 6, type: "tool-end", round: 2, id: "c2", ok: true },
];
/** The URLs the page asked for. @type {string[]} */
const asked = [];
const runReads = () => asked.filter((u) => u.includes("/runs/"));

before(async () => {
  dom = stubDocument();
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  // Every row is near the screen as it is drawn: its loads run at once.
  g.IntersectionObserver ||= class {
    /** @param {(entries: any[]) => void} cb */
    constructor(cb) { this.cb = cb; }
    /** @param {any} el */
    observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
    unobserve() {}
    disconnect() {}
  };
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
    const m = /\/runs\/[^/]+\/events\?since=(\d+)&limit=(\d+)/.exec(url);
    // Run `rgap`'s first three events would not read: its pages say the gap.
    const holed = url.includes("/runs/rgap/") && !!m && Number(m[1]) < 3;
    const events = m ? RUN.filter((e) => e.n > Math.max(Number(m[1]), holed ? 3 : 0)).slice(0, Number(m[2])) : [];
    return { ok: true, status: 200, json: async () => ({ events, totals: { files: 0 }, ...(holed ? { gap: { requested: Number(m?.[1]), firstAvailable: 4 } } : {}) }) };
  };
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  tl = createTimeline(document.createElement("div"), /** @type {any} */ ({}));
});
after(() => {
  g.fetch = fetchWas;
  for (const k of ADDED) delete g[k];
  dom.restore();
});

const settle = () => new Promise((r) => setTimeout(r, 20));
/** @param {Record<string, any>} more */
const turnOf = (more) => /** @type {any} */ ({ n: 1, turnId: "t1", past: true, history: true, runId: "r1", blocks: [{ type: "text", text: "done" }], steers: [], segments: [], startedAt: 1, ...more });

// (fails before: no — the timeline honoured a read mark already; the page never set one for a followed turn, which
// chat-open-path pins. This pins the timeline's half: the mark is all it takes.)
test("a running turn its follow reads is not read again as a past turn's cards", async () => {
  asked.length = 0;
  const turn = turnOf({ status: "streaming", runRead: Promise.resolve() });
  tl.render({ turns: [turn], live: null });
  await settle();
  assert.deepEqual(runReads(), []);
});

/**
 * The arrays reachable from `root` through its plain data — objects, arrays, Maps and Sets — that hold the run's events
 * in its order, by identity: what keeps the log itself alive. @param {any} root
 */
function logsIn(root) {
  /** @type {any[][]} */
  const found = [];
  const seen = new Set();
  /** @param {any} v */
  const walk = (v) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v) && v.length === RUN.length && v.every((e, i) => e === RUN[i])) found.push(v);
    const kids = v instanceof Map ? [...v.keys(), ...v.values()] : v instanceof Set ? [...v] : Object.values(v);
    for (const k of kids) walk(k);
  };
  walk(root);
  return found;
}

// (fails before: yes — the turn the reading made anew read its whole log again. Since 11-15 its alignment comes with it,
// not the log: lib/turn-reads.js)
test("an ended turn whose alignment came with it draws the same cards, with no read", async () => {
  const { withReadRuns } = await import("../src/ui/harness/lib/turn-reads.js");
  asked.length = 0;
  const read = turnOf({ status: "done" });
  tl.render({ turns: [read], live: null });
  await settle();
  await tl.loadRun(read);
  assert.equal(runReads().length, 1, "read once");

  asked.length = 0;
  const [carried] = withReadRuns([turnOf({ status: "done" })], [read]);
  tl.render({ turns: [carried], live: null });
  await settle();
  await tl.loadRun(carried);
  assert.deepEqual(runReads(), [], "no read");
  assert.equal(carried.aligned?.maxRound, read.aligned?.maxRound);
  assert.deepEqual([...carried.aligned.byRound.keys()], [...read.aligned.byRound.keys()], "the same rounds");
  assert.deepEqual([...carried.aligned.byRound.values()].map((c) => [...c.tools.keys()]), [...read.aligned.byRound.values()].map((c) => [...c.tools.keys()]), "the same calls");
  assert.deepEqual(logsIn(carried), [], "and no log");
});

// The owner's of 11-15, the page's process at 1.4 GB after three days: an ended turn kept its run's whole log (`runLog`,
// and its alignment's cache the same array), up to 40 MB of JSON for one heavy turn, for every turn the page drew.
// (fails before: yes — the turn held its log twice: `runLog` and `alignCache.list`)
test("an ended turn keeps its log's alignment and lets go of the log", async () => {
  asked.length = 0;
  const ended = turnOf({ status: "done", turnId: "t3", runId: "r3" });
  tl.render({ turns: [ended], live: null });
  await settle();
  await tl.loadRun(ended);
  assert.equal(runReads().length, 1);
  assert.deepEqual(logsIn(ended), [], "nothing on the turn holds its log");
  assert.equal(ended.alignCache?.whole, true, "its alignment holds all of it");
  assert.equal(ended.aligned?.maxRound, 2, "and its cards are drawn from that");
  assert.deepEqual([...ended.aligned.byRound.get(2).tools.keys()], ["c2"]);
});

// (fails before: yes — a log read with a gap in it was let go of as whole, and the reading after carried its alignment:
// the turn's missing cards stayed missing until the page was loaded again)
test("an ended turn whose log came with a gap keeps it, and the reading after reads it again", async () => {
  const { withReadRuns } = await import("../src/ui/harness/lib/turn-reads.js");
  asked.length = 0;
  const holed = turnOf({ status: "done", turnId: "t4", runId: "rgap" });
  tl.render({ turns: [holed], live: null });
  await settle();
  await tl.loadRun(holed);
  assert.equal(runReads().length, 1);
  assert.equal(holed.alignCache?.whole, false, "not let go of: it is not the whole log");
  asked.length = 0;
  const [again] = withReadRuns([turnOf({ status: "done", turnId: "t4", runId: "rgap" })], [holed]);
  tl.render({ turns: [again], live: null });
  await settle();
  await tl.loadRun(again);
  assert.equal(runReads().length, 1, "read again");
});

test("a turn still open keeps its log: what it read is not the whole of it", async () => {
  asked.length = 0;
  const open = turnOf({ status: "open", turnId: "t2", runId: "r2" });
  tl.render({ turns: [open], live: null });
  await settle();
  await tl.loadRun(open);
  assert.equal(runReads().length, 1);
  assert.equal(open.alignCache?.whole, false, "not let go of");
  assert.equal(logsIn(open).length, 1, "its alignment folds on from it");
});
