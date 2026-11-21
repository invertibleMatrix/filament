// @ts-check
// A message the person sent into a running turn stays where it joined once the turn settles (the owner's report of
// 10-29: at the turn's end, three steered messages jumped below the agent's long report, which had come after two of
// them). While the turn ran, a read message stood in the work after the round that read it; settled, it was drawn only
// in one box between the work and the reply. Now it keeps its place in the work, and its copy stands between the folds
// where the work splits at it, shown only while the work over it is folded away (harness.css) — a copy kept in the box
// above the reply drew every message of a long turn below hours of later work (the owner's of 11-05). The real timeline
// is drawn here, on the stub document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
/** @type {typeof import("../src/ui/harness/lib/labels.js").alignEvents} */
let alignEvents;
/** @type {typeof import("../src/ui/harness/lib/labels.js")} */
let labels;
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
  labels = await import("../src/ui/harness/lib/labels.js");
  ({ alignEvents } = labels);
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  host = document.createElement("div");
  tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {} }));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

const T0 = 1_800_000_000_000;

/** A turn whose first round ran a command and read the person's message, and whose second round answered. */
const steeredTurn = () => {
  const turn = /** @type {any} */ ({ n: 1, status: "streaming", past: false, blocks: [], steers: [], segments: [], runId: "r1", startedAt: Date.now() });
  turn.aligned = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "tool-start", round: 1, name: "bash", args: "npm test", id: "t1", input: { command: "npm test" } },
    { type: "steer", id: "s1", kind: "note", text: "and fix the docs too", at: 1 },
    { type: "tool-end", round: 1, name: "bash", ok: true, ms: 40, id: "t1", chars: 2, preview: "ok" },
    { type: "steer-read", ids: ["s1"] },
    { type: "round-start", round: 2, blocksBefore: 1 },
  ]);
  turn.steers = [...turn.aligned.steers.values()];
  return turn;
};

/**
 * A turn whose first round read the person's message, whose coding agent compacted its context after round 2, and
 * whose third round worked on and read a second message: settled, its work folds on either side of the compaction's line.
 */
const compactedTurn = () => {
  const turn = /** @type {any} */ ({ n: 1, status: "streaming", past: false, blocks: [], steers: [], segments: [], runId: "r2", startedAt: T0 });
  const tool = (/** @type {number} */ round, /** @type {string} */ id) => [
    { type: "tool-start", round, name: "bash", args: "npm test", id, input: { command: "npm test" } },
    { type: "tool-end", round, name: "bash", ok: true, ms: 40, id, chars: 2, preview: "ok" },
  ];
  turn.aligned = alignEvents([
    { type: "run-start", kind: "coding-agent", meta: { agent: "Claude Code" } },
    { type: "round-start", round: 1, blocksBefore: 0 },
    ...tool(1, "t1"),
    { type: "steer", id: "s1", kind: "note", text: "and fix the docs too", at: 1 },
    { type: "steer-read", ids: ["s1"], ts: T0 + 60_000 },
    { type: "round-start", round: 2, blocksBefore: 1 },
    ...tool(2, "t2"),
    { type: "compacting", round: 2, own: true, by: "Claude Code", ts: T0 + 180_000 },
    { type: "compaction", round: 2, own: true, by: "Claude Code", summary: "what came before", ts: T0 + 200_000 },
    { type: "round-start", round: 3, blocksBefore: 2 },
    ...tool(3, "t3"),
    { type: "steer", id: "s2", kind: "note", text: "and the changelog", at: 2 },
    { type: "steer-read", ids: ["s2"], ts: T0 + 320_000 },
    { type: "round-start", round: 4, blocksBefore: 3 },
  ]);
  turn.steers = [...turn.aligned.steers.values()];
  return turn;
};

/** Every node under `n`, in document order. @param {any} n @returns {any[]} */
const walk = (n) => [n, ...[...(n.children || [])].flatMap(walk)];

// (fails before: yes — a settled turn drew its read messages only in the box under the work, below every later word)
test("a message read while the turn ran keeps its place in the work once the turn settles; its copy stands under that work", async () => {
  const turn = steeredTurn();
  const live = /** @type {any} */ ({ turn, reply: { blocks: [{ type: "text", text: "Ran the tests." }, { type: "text", text: "Docs fixed too." }], tailClosed: false }, blockHandles: [] });
  const chat = /** @type {any} */ ({ turns: [turn], live });
  live.chat = chat;
  tl.render(chat);
  tl.startLive(live);
  await tl.finish(live, "done");
  chat.live = null;
  tl.render(chat);
  const fold = host.querySelector("details.work-fold");
  const inFold = fold.querySelectorAll(".steer");
  assert.equal(inFold.length, 1, "the message stands in the work, where it joined");
  const order = walk(fold);
  const tool = order.findIndex((n) => n.classList?.contains("tool-row"));
  assert.ok(tool >= 0 && order.indexOf(inFold[0]) > tool, "after the round's command that it came in beside");
  assert.equal(host.querySelectorAll(".a-final .steers .steer").length, 0, "none in the box above the reply");
  const copies = host.querySelectorAll(".steers.is-heard .steer");
  assert.equal(copies.length, 1, "a copy where the work splits at it, for when the work is folded away");
  assert.equal(copies[0].classList.contains("is-inline"), true, "marked as drawn in the work too, so the page shows it only while the work is folded");
  const kids = [...fold.parentNode.children];
  assert.equal(kids.indexOf(copies[0].parentNode), kids.indexOf(fold) + 1, "right under the work that read it");
});

// (fails before: yes — the box's copy showed wherever a fold before it was closed: with the work's own fold open on the
// message, a closed fold after the agent's compaction showed the copy too, and the message stood twice — once where it
// joined, once above the reply; the owner's of 11-05. And then: every copy stood in that box, above the reply, under work
// done long after the message; a turn of 1,125 rounds drew two messages read at rounds 50 and 100 after its last report)
test("each message stands between the folds where the agent read it, shown while the fold that holds it is closed", async () => {
  const turn = compactedTurn();
  const live = /** @type {any} */ ({ turn, reply: { blocks: [{ type: "text", text: "Ran the tests." }, { type: "text", text: "Ran them again." }, { type: "text", text: "Compacted, and ran them once more." }, { type: "text", text: "Docs fixed too." }], tailClosed: false }, blockHandles: [] });
  const chat = /** @type {any} */ ({ turns: [turn], live });
  live.chat = chat;
  tl.render(chat);
  tl.startLive(live);
  await tl.finish(live, "done");
  turn.endedAt = T0 + 400_000;
  chat.live = null;
  tl.render(chat);
  const turnEl = host.querySelectorAll(".assistant-turn").at(-1);
  const folds = turnEl.querySelectorAll("details.work-fold");
  assert.equal(folds.length, 3, "the work up to the first message, the work after it, and the work after the compaction");
  const [own, afterIt, afterCompaction] = folds;
  assert.deepEqual([own, afterIt, afterCompaction].map((f) => f.querySelectorAll(".steer .steer-text").map((/** @type {any} */ s) => s.textContent).join("|")), ["and fix the docs too", "", "and the changelog"], "each message stands at the foot of the fold of the work that read it");
  assert.equal(turnEl.querySelectorAll(".a-final .steers .steer").length, 0, "none above the reply");
  const boxes = turnEl.querySelectorAll(".steers.is-heard");
  const [copy, later] = boxes.map((/** @type {any} */ b) => b.querySelector(".steer"));
  assert.deepEqual([copy, later].map((c) => c?.querySelector(".steer-text").textContent), ["and fix the docs too", "and the changelog"]);
  assert.equal(copy.classList.contains("is-inline") && later.classList.contains("is-inline"), true);
  // In the order it happened: the work, the message, the work after it, the compaction, the work after that, the message, the reply.
  const kids = [...turnEl.children];
  const line = kids.find((n) => n.classList?.contains("is-compaction"));
  const answer = kids.find((n) => n.classList?.contains("a-final"));
  const at = [own, boxes[0], afterIt, line, afterCompaction, boxes[1], answer].map((n) => kids.indexOf(n));
  assert.ok(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), `in order: ${at.join(",")}`);
  // Each fold says its own part: to the message, from it to the compaction's start, from its end to the second message.
  assert.deepEqual(folds.map((f) => f.querySelector(".work-label").textContent), ["Worked for 1m · 1 tool call", "Worked for 2m · 1 tool call", "Worked for 2m · 1 tool call"]);
  assert.equal(afterIt.querySelector(".work-counts").title.startsWith("After the message: 1 tool call"), true);
  const toggle = (/** @type {any} */ f, /** @type {boolean} */ open) => {
    f.open = open;
    f.dispatch("toggle");
  };
  const shown = () => [copy, later].map((c) => c.classList.contains("is-shown"));
  const boxShown = () => boxes.map((/** @type {any} */ b) => !b.classList.contains("hidden"));
  for (const f of folds) toggle(f, false);
  assert.deepEqual(shown(), [true, true], "all folded: the copies keep the messages in view");
  assert.deepEqual(boxShown(), [true, true]);
  toggle(own, true);
  assert.deepEqual(shown(), [false, true], "the work's own fold open on the first: its copy steps aside, the fold after the compaction closed on the second");
  assert.deepEqual(boxShown(), [false, true], "its box with it");
  toggle(afterIt, true);
  assert.deepEqual(shown(), [false, true], "the fold after the first message holds neither");
  toggle(afterCompaction, true);
  assert.deepEqual(shown(), [false, false], "all open: no copy");
  toggle(own, false);
  assert.deepEqual(shown(), [true, false], "the work's own fold closed again: its copy is back, whatever the folds after it do");
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  assert.match(css, /\.assistant-turn > \.a-final \.steer\.is-inline:not\(\.is-shown\), \.assistant-turn > \.steers\.is-heard \.steer:not\(\.is-shown\) \{ display: none; \}/);
  assert.doesNotMatch(css, /work-fold:not\(\[open\]\) ~ \.a-final \.steer\.is-inline/, "no rule shows a copy by any fold before it");
});

// (fails before: yes — the split knew only compactions and replies)
test("the split: the work folds apart after the box of each round that read a message, which says when", () => {
  const { foldParts, heardRounds, partSpans } = labels;
  const seg = (/** @type {string} */ n) => ({ kind: "block", block: { type: "text" }, n });
  const [a, b, c] = [seg("a"), seg("b"), seg("c")];
  const box1 = { kind: "cards", round: 1, last: 1 };
  const box23 = { kind: "cards", round: 2, last: 3 };
  const heard = new Map([[3, T0 + 90_000]]);
  assert.deepEqual(foldParts([a, box1, b, box23, c], null, heard), { before: [], head: [a, box1, b, box23], after: [{ line: null, round: 3, heard: T0 + 90_000, segs: [c] }] }, "after the box that ends on the round that read it");
  assert.deepEqual(foldParts([a, box1, b, box23], null, heard).after, [{ line: null, round: 3, heard: T0 + 90_000, segs: [] }], "read last: the message stands over the reply, no fold under it");
  assert.deepEqual(foldParts([a, box1, b, box23, c], null, new Map([[2, T0]])).after, [], "a round inside a box ends none");
  // A message beside a reply - it woke the agent - stands there already: no split.
  const replies = new Map([[b, 1]]);
  const box2 = { kind: "cards", round: 1, last: 1 };
  assert.deepEqual(foldParts([a, b, box2, c], replies, new Map([[1, T0]])).after, [{ line: b, round: 1, with: [box2], segs: [c] }]);
  const al = alignEvents([
    { type: "round-start", round: 1 },
    { type: "steer", id: "s1", kind: "note", text: "x", at: 1 },
    { type: "steer-read", ids: ["s1"], ts: T0 + 5 },
    { type: "steer", id: "s2", kind: "note", text: "waits", at: 1 },
  ]);
  assert.deepEqual([...heardRounds(al.byRound)], [[1, T0 + 5]], "a message still waiting splits nothing");
  assert.deepEqual(partSpans({ startedAt: T0, endedAt: T0 + 100_000 }, [{ line: null, round: 1, heard: T0 + 40_000 }], al.byRound), [40_000, 60_000], "to when the agent had it, and from then");
  assert.deepEqual(partSpans({ startedAt: T0, endedAt: T0 + 100_000 }, [{ line: null, round: 1, heard: 0 }], al.byRound), [null, null], "a read the run never timed: no time");
});

// (fails before: yes — the review of cf313a1ae: a message typed on the page is the POST's object, with no round on it;
// its copy took round 0, stayed in the box over the answer, and showed by the first fold whatever fold held it)
test("a message typed on the page stands where the run read it, its round the run's own", async () => {
  const turn = compactedTurn();
  // As app.js keeps one it sent: its words and its state, no round; the log's read is copied onto it (FROM_LOG).
  turn.steers = [
    { id: "s1", kind: "note", text: "and fix the docs too", read: true, unread: false },
    { id: "s2", kind: "note", text: "and the changelog", read: true, unread: false },
  ];
  const live = /** @type {any} */ ({ turn, reply: { blocks: [{ type: "text", text: "Ran the tests." }, { type: "text", text: "Ran them again." }, { type: "text", text: "Compacted, and ran them once more." }, { type: "text", text: "Docs fixed too." }], tailClosed: false }, blockHandles: [] });
  const chat = /** @type {any} */ ({ turns: [turn], live });
  live.chat = chat;
  tl.render(chat);
  tl.startLive(live);
  await tl.finish(live, "done");
  turn.endedAt = T0 + 400_000;
  chat.live = null;
  tl.render(chat);
  const turnEl = host.querySelectorAll(".assistant-turn").at(-1);
  assert.equal(turnEl.querySelectorAll(".a-final .steers .steer").length, 0, "none over the answer");
  const boxes = turnEl.querySelectorAll(".steers.is-heard");
  assert.deepEqual(boxes.map((/** @type {any} */ b) => b.querySelector(".steer-text")?.textContent), ["and fix the docs too", "and the changelog"], "each in its split");
  const [, , afterCompaction] = turnEl.querySelectorAll("details.work-fold");
  const later = boxes[1].querySelector(".steer");
  for (const f of turnEl.querySelectorAll("details.work-fold")) {
    f.open = f !== afterCompaction;
    f.dispatch("toggle");
  }
  assert.equal(later.classList.contains("is-shown"), true, "shown by the fold that holds it, closed, whatever the first does");
  afterCompaction.open = true;
  afterCompaction.dispatch("toggle");
  assert.equal(later.classList.contains("is-shown"), false);
});

// (fails before: yes — the review of cf313a1ae: every message read split the work, Filament's own notes too)
test("only the person's messages split the work: Filament's note, a lead's or an agent's stands in it alone", () => {
  const al = alignEvents([
    { type: "round-start", round: 1 },
    { type: "steer", id: "f1", kind: "note", text: "refused: outside the folder", from: "filament", at: 1 },
    { type: "steer-read", ids: ["f1"], ts: T0 + 1 },
    { type: "round-start", round: 2 },
    { type: "steer", id: "d1", kind: "note", text: "yes, go on", from: "developer", at: 2 },
    { type: "steer-read", ids: ["d1"], ts: T0 + 2 },
    { type: "round-start", round: 3 },
    { type: "steer", id: "p1", kind: "note", text: "and the docs", at: 3 },
    { type: "steer-read", ids: ["p1"], ts: T0 + 3 },
  ]);
  assert.deepEqual([...labels.heardRounds(al.byRound)], [[2, T0 + 2], [3, T0 + 3]], "the person's answer relayed, and what they typed");
});
