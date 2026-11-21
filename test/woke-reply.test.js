// @ts-check
// A reply the agent ended its turn on, before Filament woke it within the same turn, stands outside the work once the
// turn settles (the owner's of 11-05: "those final reports that usually arrive as end turn in other agents ... are now
// inside a running transcript"). One turn of 376 rounds held four such reports — one per wait on a reviewer or for the
// person's message — and each folded away with the work around it. Now each stands between the folds, the message or the
// reports that woke the agent beside it, and the work after it folds under "Worked for …" with its own figures.
// (fails before: yes — every reply but the last folded away with the work, and the turn's fold counted the whole turn)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents, foldParts, wokeReplies, partSpans, partWords } from "../src/ui/harness/lib/labels.js";
import { createAgentRun } from "../src/app/agent-run.js";

const T0 = 1_800_000_000_000;
const tool = (/** @type {number} */ round, /** @type {string} */ id) => [
  { type: "tool-start", round, name: "bash", args: "npm test", id, input: { command: "npm test" } },
  { type: "tool-end", round, name: "bash", ok: true, ms: 40, id, chars: 2, preview: "ok" },
];

/**
 * A coding agent's turn: round 1 ran a command; round 2 said its report and ended its turn; the run waited, the person's
 * message came, and Filament woke the agent with it; round 3 ran a command; round 4 answered.
 * @param {Record<string, unknown>} woke  how the wake's turn-state says it
 */
const wokeEvents = (woke = { woke: true }) => [
  { type: "run-start", kind: "coding-agent", meta: { agent: "Claude Code" }, ts: T0 },
  { type: "round-start", round: 1, blocksBefore: 0, ts: T0 + 1_000 },
  { type: "round-text", round: 1, text: "Running the tests." },
  ...tool(1, "t1"),
  { type: "round-start", round: 2, blocksBefore: 1, ts: T0 + 60_000 },
  { type: "round-text", round: 2, text: "Committed; the review runs." },
  { type: "turn-state", from: "planning", to: "waiting", why: "waiting for its sub-agent to report", ts: T0 + 120_000 },
  { type: "steer", id: "s1", kind: "note", text: "explain these to me", at: 1 },
  { type: "steer-read", ids: ["s1"], after: true },
  { type: "turn-state", from: "waiting", to: "planning", why: "Filament's words to the agent", ...woke, ts: T0 + 300_000 },
  { type: "round-start", round: 3, blocksBefore: 2, ts: T0 + 301_000 },
  { type: "round-text", round: 3, text: "Reading them." },
  ...tool(3, "t3"),
  { type: "round-start", round: 4, blocksBefore: 3, ts: T0 + 400_000 },
  { type: "round-text", round: 4, text: "Here they are." },
];

describe("where the agent was woken", () => {
  test("the round its reply ended is marked, with when it ended and when the work went on", () => {
    const al = alignEvents(wokeEvents());
    assert.deepEqual(al.byRound.get(2).woke, { ended: T0 + 120_000, at: T0 + 300_000 }, "the wait began as the reply ended");
    assert.equal([...al.byRound.values()].filter((c) => c.woke).length, 1);
    // A run from before `woke` was said: its words say it — a coding agent's next prompt, the loop's rounds for what woke it.
    assert.deepEqual(alignEvents(wokeEvents({})).byRound.get(2).woke, { ended: T0 + 120_000, at: T0 + 300_000 });
    for (const why of ["sub-agent reports", "the developer's message", "errors the language server found late", "sealed envelopes", "the task's report", "turn-end hook"]) {
      const al2 = alignEvents([{ type: "round-start", round: 1, blocksBefore: 0 }, { type: "round-text", round: 1, text: "Done." }, { type: "turn-state", from: "planning", to: "acting", why, ts: T0 }]);
      assert.deepEqual(al2.byRound.get(1).woke, { ended: T0, at: T0 }, `${why}: no wait, it went on at once`);
    }
    // A model call's wait for its retry or a slot is no reply's end; a round that called tools is never woken.
    const al3 = alignEvents([
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "turn-state", from: "sent", to: "waiting", why: "a retry", retry: { waitMs: 1000 }, ts: T0 },
      { type: "turn-state", from: "waiting", to: "acting", why: "1 tool call", ts: T0 + 5 },
    ]);
    assert.equal(al3.byRound.get(1).woke, undefined);
  });

  // (fails before: yes — the review's find: a message queued at Claude Code that ran as its next prompt, its turn having
  // ended first, marked nothing, and the reply it ended on stayed folded away)
  test("a message queued at a coding agent that ran as its next prompt woke it too", () => {
    const queued = [
      { type: "run-start", kind: "coding-agent", meta: { agent: "Claude Code", steer: "queued" } },
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "round-text", round: 1, text: "Committed; the review runs." },
      { type: "steer", id: "s1", kind: "note", text: "explain these", at: 1 },
      { type: "steer-read", ids: ["s1"], after: true, ts: T0 },
      { type: "round-start", round: 2, blocksBefore: 1 },
    ];
    assert.deepEqual(alignEvents(queued).byRound.get(1).woke, { ended: T0, at: T0 }, "a run from before the agent run said it");
    assert.equal(alignEvents(queued.map((e) => (e.type === "steer-read" ? { ...e, after: false } : e))).byRound.get(1).woke, undefined, "one taken into the running turn woke nothing");
    // The agent run says it now, for the person's words and for Filament's reports alike.
    const events = /** @type {any[]} */ ([]);
    const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 } });
    run.take({ type: "text", text: "Committed; the review runs." });
    run.steered("into the running turn");
    assert.equal(events.filter((e) => e.woke).length, 0);
    run.steered("explain these", [], true);
    assert.equal(events.filter((e) => e.type === "turn-state" && e.woke).length, 1);
  });

  test("a coding agent's next prompt says it woke the agent, even where its state stands", () => {
    const events = /** @type {any[]} */ ([]);
    const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 } });
    run.take({ type: "text", text: "Committed; the review runs." });
    run.prompted("[Filament: the review reported]");
    run.prompted("[Filament: another came]");
    const woke = events.filter((e) => e.type === "turn-state" && e.woke);
    assert.equal(woke.length, 2, "each wake is said, the second while the state stands at planning");
    assert.equal(woke[0].to, "planning");
  });
});

describe("the split", () => {
  const seg = (/** @type {string} */ n, /** @type {Record<string, unknown>} */ more = {}) => ({ kind: "block", block: { type: "text" }, n, ...more });
  test("each reply the agent ended on is found among the turn's blocks, at the end of its round", () => {
    const al = alignEvents(wokeEvents());
    const [a, b, c, d] = [seg("a"), seg("b"), seg("c"), seg("d")];
    const box1 = { kind: "cards", round: 1, last: 1 };
    const box3 = { kind: "cards", round: 3, last: 3 };
    const segments = [a, box1, b, c, box3, d];
    assert.deepEqual([...wokeReplies(segments, al.byRound)], [[b, 2]]);
    // A round that ended its turn without words has no reply to stand.
    assert.equal(wokeReplies(segments, alignEvents(wokeEvents().filter((e) => !(e.type === "round-text" && e.round === 2))).byRound).size, 0);
  });

  test("a reply's line takes its round's box beside it, and the work after it folds apart", () => {
    const [a, b, c] = [seg("a"), seg("b"), seg("c")];
    const box1 = { kind: "cards", round: 1, last: 1 };
    const box2 = { kind: "cards", round: 2, last: 2 };
    const box3 = { kind: "cards", round: 3, last: 3 };
    const replies = new Map([[b, 2]]);
    assert.deepEqual(foldParts([a, box1, b, box2, c, box3], replies), { before: [], head: [a, box1], after: [{ line: b, round: 2, with: [box2], segs: [c, box3] }] });
    assert.deepEqual(foldParts([a, box1, b, c, box3], replies), { before: [], head: [a, box1], after: [{ line: b, round: 2, with: [], segs: [c, box3] }] }, "woken with nothing to draw: the reply alone");
    const both = { kind: "cards", round: 2, last: 3 };
    assert.deepEqual(foldParts([a, box1, b, both, c], replies), { before: [], head: [a, box1], after: [{ line: b, round: 2, with: [], segs: [both, c] }] }, "a box that holds the next round's calls folds with them");
    assert.deepEqual(foldParts([b, box2, c, box3], replies), { before: [b, box2], head: [c, box3], after: [] }, "a reply before any work stands above the turn's fold");
    const line = { kind: "compacted", round: 3 };
    assert.deepEqual(foldParts([a, b, box2, c, line, box3], replies), { before: [], head: [a], after: [{ line: b, round: 2, with: [box2], segs: [c] }, { line, segs: [box3] }] }, "with a compaction after it");
    assert.deepEqual(foldParts([a, b, box2, c]), { before: [], head: [a, b, box2, c], after: [] }, "none found: the turn's fold as it was");
  });

  test("each fold's time: from the turn's start or its line to the next line, the last to the turn's end", () => {
    const byRound = alignEvents(wokeEvents()).byRound;
    const turn = { startedAt: T0, endedAt: T0 + 420_000 };
    assert.deepEqual(partSpans(turn, [{ line: {}, round: 2 }], byRound), [120_000, 120_000], "up to the reply's end; from the wake to the turn's end");
    const compaction = { line: { kind: "compacted", at: T0 + 360_000, ms: 30_000 } };
    assert.deepEqual(partSpans(turn, [{ line: {}, round: 2 }, compaction], byRound), [120_000, 30_000, 60_000], "a compaction stands from its start to its end");
    const begun = { line: { ...compaction.line, began: T0 + 320_000 } };
    assert.deepEqual(partSpans(turn, [{ line: {}, round: 2 }, begun], byRound), [120_000, 20_000, 60_000], "from when it began, where that was said");
    const compacted = alignEvents([{ type: "round-start", round: 1 }, { type: "compacting", round: 1, own: true, ts: T0 }, { type: "compaction", round: 1, own: true, ms: 5, ts: T0 + 9_000 }]);
    assert.equal(compacted.byRound.get(1).compactions[0].began, T0, "the alignment keeps when it began");
    assert.deepEqual(partSpans(turn, [], byRound, 2), [120_000], "a reply above the turn's fold: its fold from the wake");
    assert.deepEqual(partSpans({ startedAt: T0 }, [{ line: {}, round: 2 }], byRound), [120_000, null], "an end not known: no time");
    assert.equal(partWords(125_000), "Worked for 2m 5s");
    assert.equal(partWords(null), "Worked");
    assert.equal(partWords(125_000, true), "Stopped after 2m 5s");
  });
});

describe("the timeline", () => {
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
    tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {} }));
  });
  after(() => {
    for (const k of ADDED) delete g[k];
    dom.restore();
  });

  /**
   * A turn drawn as it ran, then settled as the app keeps it: its folds' headers, in order.
   * @param {any[]} events @param {string[]} texts @param {"done" | "stopped"} status
   */
  const settle = async (events, texts, status) => {
    const turn = /** @type {any} */ ({ n: 1, status: "streaming", past: false, blocks: [], steers: [], segments: [], runId: `r-${status}`, startedAt: T0 });
    turn.aligned = alignEvents(events);
    turn.steers = [...turn.aligned.steers.values()];
    const blocks = texts.map((text) => ({ type: "text", text }));
    const live = /** @type {any} */ ({ turn, reply: { blocks, tailClosed: false }, blockHandles: [] });
    const chat = /** @type {any} */ ({ turns: [turn], live });
    live.chat = chat;
    tl.render(chat);
    tl.startLive(live);
    tl.drawBlocks(live);
    await tl.finish(live, status);
    turn.endedAt = T0 + 420_000;
    turn.blocks = blocks;
    chat.live = null;
    tl.render(chat);
    const turnEl = host.querySelectorAll(".assistant-turn").at(-1);
    return turnEl.querySelectorAll("details.work-fold").map((/** @type {any} */ f) => [f.querySelector(".work-label").textContent, f.querySelector(".work-label").title || ""]);
  };
  const compaction = [
    { type: "compacting", round: 3, own: true, by: "Claude Code", ts: T0 + 350_000 },
    { type: "compaction", round: 3, own: true, by: "Claude Code", ms: 10_000, summary: "what came before", ts: T0 + 360_000 },
  ];

  // (fails before: yes — the review's finds: a turn split only where its agent compacted lost its whole time, its fold
  // saying only the time to the first compaction; and the stop's word stood on the fold before a compaction)
  test("the stop's word stands on the last fold; a turn split only where its agent compacted says its whole time", async () => {
    // After the compaction, round 4 runs a command, and round 5 answers.
    const tail = [{ type: "round-start", round: 4, blocksBefore: 3 }, ...tool(4, "t4"), { type: "round-start", round: 5, blocksBefore: 3 }, { type: "round-text", round: 5, text: "Here they are." }];
    const texts = ["Running the tests.", "Committed; the review runs.", "Reading them.", "Here they are."];
    const stopped = await settle([...wokeEvents().slice(0, 15), ...compaction, ...tail], texts, "stopped");
    assert.deepEqual(stopped.map(([w]) => w), ["Worked for 2m · 1 tool call", "Worked for 50s · 1 tool call", "Stopped after 1m · 1 tool call"], "the reply's fold to the compaction's start; the stop on the fold it ended");
    assert.deepEqual(stopped.map(([, title]) => !!title), [false, false, false], "the turn's own fold no longer says who stopped it: the stop is not its");
    const unwoken = wokeEvents().slice(0, 15).filter((e) => !(e.type === "turn-state" && e.to === "planning") && !String(e.type).startsWith("steer"));
    const compacted = await settle([...unwoken, ...compaction, ...tail], texts, "done");
    assert.deepEqual(compacted.map(([w]) => w), ["Worked for 7m · 3 tool calls", "The work after it · 1 tool call"], "the turn's fold says the whole turn, as before; the fold after the compaction its own calls");
  });

  test("settled, the reply stands between the folds with the message that woke the agent, and each fold says its own part", async () => {
    const turn = /** @type {any} */ ({ n: 1, status: "streaming", past: false, blocks: [], steers: [], segments: [], runId: "r1", startedAt: T0 });
    turn.aligned = alignEvents(wokeEvents());
    turn.steers = [...turn.aligned.steers.values()];
    const blocks = ["Running the tests.", "Committed; the review runs.", "Reading them.", "Here they are."].map((text) => ({ type: "text", text }));
    const live = /** @type {any} */ ({ turn, reply: { blocks, tailClosed: false }, blockHandles: [] });
    const chat = /** @type {any} */ ({ turns: [turn], live });
    live.chat = chat;
    tl.render(chat);
    tl.startLive(live);
    tl.drawBlocks(live);
    await tl.finish(live, "done");
    turn.endedAt = T0 + 420_000;
    // Settled, the turn is drawn from its reply's blocks, as the app keeps them.
    turn.blocks = blocks;
    chat.live = null;
    tl.render(chat);
    const turnEl = host.querySelectorAll(".assistant-turn").at(-1);
    const folds = turnEl.querySelectorAll("details.work-fold");
    assert.equal(folds.length, 2, "the work before the reply, and the work after it");
    const [own, afterIt] = folds;
    const kids = [...turnEl.children];
    // The stub draws no markdown: each block is known by its segment.
    const elOf = (/** @type {string} */ text) => turn.segments.find((/** @type {any} */ x) => x.block?.text === text)?.el;
    const report = elOf("Committed; the review runs.");
    assert.ok(kids.includes(report), "the reply stands outside every fold, a child of the turn itself");
    assert.ok(kids.indexOf(own) < kids.indexOf(report) && kids.indexOf(report) < kids.indexOf(afterIt), "between the work before it and the work after it");
    const message = kids.find((n) => n.querySelector?.(".steer-text"));
    assert.equal(message?.querySelector(".steer-text").textContent, "explain these to me", "the message that woke the agent beside it");
    assert.ok(kids.indexOf(report) < kids.indexOf(message) && kids.indexOf(message) < kids.indexOf(afterIt));
    /** Every node under `n`. @param {any} n @returns {any[]} */
    const walk = (n) => [n, ...[...(n.children || [])].flatMap(walk)];
    const inside = (/** @type {any} */ f, /** @type {any} */ el) => walk(f).includes(el);
    assert.equal(inside(own, elOf("Running the tests.")) && inside(afterIt, elOf("Reading them.")), true, "the work on either side, each in its fold");
    // Each fold says its own part: its time and its calls.
    assert.equal(own.querySelector(".work-label").textContent, "Worked for 2m · 1 tool call");
    assert.equal(afterIt.querySelector(".work-label").textContent, "Worked for 2m · 1 tool call");
    assert.equal(afterIt.querySelector(".work-counts").title.startsWith("After its reply: 1 tool call"), true);
    // The message stands in view beside the reply: its copy in the box under the work never shows, however the folds stand.
    const copy = turnEl.querySelector(".a-final .steers .steer");
    for (const open of [false, true]) {
      for (const f of folds) {
        f.open = open;
        f.dispatch("toggle");
      }
      assert.equal(copy?.classList.contains("is-shown"), false, `folds ${open ? "open" : "closed"}: no second copy`);
    }
    // The answer stays the turn's last word, under every fold.
    const answer = kids.find((n) => n.classList?.contains("a-final"));
    assert.ok(kids.indexOf(afterIt) < kids.indexOf(answer) && inside(answer, elOf("Here they are.")));
  });
});
