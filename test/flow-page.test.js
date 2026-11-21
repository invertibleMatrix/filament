// @ts-check
// A flow on the page (HarnessV4_Flow_Plan F5, F6; HarnessV4_OneAgent_Plan OA3): the words its cards, its row and the
// header's line say (lib/flow.js); `/flow` read off a message; a box moved up or down a step; the list the page
// follows; its card over the box and on the Agents tab — a draft's Start, the one press that runs it, Discard, which
// puts the words back, each box's Move up, Move down and Remove, what it needs and a need that does not hold, each
// step's why; a gate's Send back, Go on anyway and Stop; your review's Go on, Send back and Stop; a restart's Go on; a
// held box's Retry and Skip; a box picked, with what it was handed (views/flow.js); a box's sheet and what it needs
// (views/flow-sheet.js); a flow's row and badge on the Agents tab (lib/side.js); a team box's hand-off folded in its
// chat (history.js); a /flow message's mark on its row (conversation/turn.js).
// (fails before: yes — the page had no flows)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BOX_BADGE, DRAWN_WORDS, FLOW_HOME, FLOW_USAGE, MOMENT_MS, backOffers, boxBadge, boxLine, changesOf, createFlowList, endWords, flowFig, flowItem, flowOfItem, flowRow, flowRoutes,
  flowWordsOf, moveBox, needsWords, needsYou, placeNote, statusOf, stepsBody, sumLine, worksWords, writeTip,
} from "../src/ui/harness/lib/flow.js";
import * as flowViews from "../src/ui/harness/views/flow.js";
import { newBox, openBoxSheet, withBox, withoutBox } from "../src/ui/harness/views/flow-sheet.js";
import { agentsBadge, mineAtWork, withTeams } from "../src/ui/harness/lib/side.js";
import { FLOW_GO_ON as PAGE_GO_ON, transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { deliveredWords } from "../src/ui/harness/conversation/turn.js";
import { FLOW_BACK_HEAD, FLOW_GO_ON, FLOW_NOTE_HEAD, backAsk, isFlowSaid } from "../src/core/flow.js";
import { FLOW_BACK_WORDS, FLOW_ON_WORDS } from "../src/ui/harness/lib/labels.js";
import { createViews } from "../src/ui/harness/views/host.js";
import { readFileSync } from "node:fs";
import { cardTone } from "../src/ui/harness/lib/agent-cards.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { sideIO, sideSeams } from "./helpers/side-view.js";
import { modelSelects, teamIO } from "./helpers/team-view.js";
import { FLOW_BEATS, playFlowMoves } from "../src/ui/harness/views/flow-moves.js";
import { stubDocument } from "./helpers/dom-stub.js";

const { createFlowCards, createFlowDock, createFlowPane, createFlowStatus } = flowViews;

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** The first node under `n` wearing a class. @param {any} n @param {string} cls */
const one = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls))[0];
/** The button under `n` whose words are these. @param {any} n @param {string} words */
const btn = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
/** The button under `n` whose tip begins so. @param {any} n @param {string} tip */
const tipped = (n, tip) => buttonsOf(n).find((b) => String(b.attrs?.title || "").startsWith(tip));
/** A box on a card by its id. @param {any} el @param {string} id */
const boxAt = (el, id) => all(el, (x) => x.attrs?.["data-box"] === id)[0];
/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);
const settle = () => new Promise((r) => setImmediate(r));

const NOW = 1_800_000_000_000;
/** A box as the list route answers it. @param {any} [o] @returns {any} */
const box = (o = {}) => ({
  id: "b1", kind: "agent", agent: "pm", name: "PM", words: "plan the parser", needs: [], gate: false, readOnly: false, model: null, sees: null,
  state: "waits", run: null, result: null, verdict: null, goneOn: false, sentBack: 0, error: null, usd: 0, startedAt: null, endedAt: null, past: [],
  words_: "Waits", writes: false, needsOf: [], broken: [], waiting: null, ...o,
});
/** A flow as the list route answers it. @param {any} [o] @returns {any} */
const flow = (o = {}) => ({
  id: "fl-1", chainId: "c1", title: "Plan, check, hunt", goal: "hey pm plan it, then the skeptic checks, then the bug hunter hunts", state: "draft",
  steps: [
    { why: "The plan first.", boxes: [box()] },
    { why: "Nothing is hunted before the plan holds.", boxes: [box({ id: "b2", agent: "skeptic", name: "Skeptic", words: "check the plan", gate: true, needs: ["b1"], needsOf: [{ id: "b1", name: "PM" }] })] },
    { why: "", boxes: [box({ id: "b3", kind: "team", agent: "bug-hunter", name: "Bug Hunter", words: "hunt for bugs", writes: false, needs: ["b2"], needsOf: [{ id: "b2", name: "Skeptic" }] })] },
  ],
  tell: true, hold: null, end: null, drawn: "agent", at: 0, startedAt: null, endedAt: null, sentBack: 0, line: "Flow · drawn, not started",
  problem: null, seats: 1, usd: 0, ...o,
});
const CARDS = [{ tag: "pm", name: "PM", kind: "lead" }, { tag: "skeptic", name: "Skeptic", kind: "lead" }, { tag: "helper", name: "Helper", kind: "worker" }];
const TEAMS = [{ key: "bug-hunter", name: "Bug Hunter", readOnly: true }, { key: "tenx", name: "10x Engineer" }];

/**
 * A flow's cards on the fake DOM, every press recorded as the route it called.
 * @param {any[]} flows @param {any} [extra] @param {any} [made]  the flow a press answers with, else the first listed
 */
const world = (flows, extra = {}, made = null) => {
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const opened = [];
  /** @type {string[]} */
  const putBack = [];
  const routes = new Proxy({}, { get: (_, name) => (/** @type {any[]} */ ...args) => { calls.push([name, ...args]); return Promise.resolve({ ok: true, flow: made || flows[0] }); } });
  /** @type {any} */
  const io = {
    rows: () => flows,
    cards: () => CARDS,
    teams: () => TEAMS,
    seats: () => 4,
    press: (/** @type {any} */ fn) => fn(routes),
    editBox: (/** @type {any} */ f, /** @type {number} */ step, /** @type {number | null} */ index) => opened.push(["edit", f.id, step, index]),
    save: (/** @type {any} */ f) => opened.push(["save", f.id]),
    openThread: (/** @type {string} */ id) => opened.push(["thread", id]),
    openTeam: (/** @type {string} */ id) => opened.push(["team", id]),
    openFlow: (/** @type {string} */ id) => opened.push(["flow", id]),
    putBack: (/** @type {string} */ w) => putBack.push(w),
    saved: () => [{ key: "plan-check-build-hunt", name: "Plan, check, build, hunt", shipped: true, steps: [{ boxes: [{ kind: "agent", agent: "pm", words: "plan" }] }, { boxes: [{ kind: "agent", agent: "skeptic", words: "check", gate: true }] }, { boxes: [{ kind: "review", agent: "", words: "" }] }] }],
    created: (/** @type {any} */ f) => opened.push(["created", f.id]),
    now: () => NOW,
    ...extra,
  };
  const cards = createFlowCards(io, { h: fakeH, place });
  return { io, cards, calls, opened, putBack };
};

describe("the words a flow's card, its row and its line say", () => {
  test("a box's badge — a gate's verdict among them — and its line by its state", () => {
    assert.deepEqual(boxBadge(box({ state: "working" })), BOX_BADGE.working);
    assert.deepEqual(boxBadge(box({ gate: true, state: "done", verdict: { go: true, why: "" } })), { cls: "is-done", words: "Go" });
    assert.deepEqual(boxBadge(box({ gate: true, state: "done", verdict: { go: false, why: "two files do not exist" } })), { cls: "is-asking", words: "Not yet" });
    assert.deepEqual(boxBadge(box({ gate: true, state: "done", verdict: null })), { cls: "is-asking", words: "No verdict" });
    assert.deepEqual(boxBadge(box({ gate: true, state: "done", verdict: { go: false, why: "" }, goneOn: true })), { cls: "is-done", words: "Gone on past it" });
    const running = flow({ state: "running", at: 1 });
    assert.equal(boxLine(box(), 0, flow(), NOW), "plan the parser", "a draft's box says what it is asked");
    assert.equal(boxLine(box({ state: "waits" }), 2, running, NOW), "waits for step 2");
    assert.equal(boxLine(box({ state: "seat", waiting: "a seat on GLM 5.3" }), 1, running, NOW), "waits for a seat on GLM 5.3");
    assert.equal(boxLine(box({ state: "working", startedAt: NOW - 180_000 }), 1, running, NOW), "at work · 3 min");
    assert.equal(boxLine(box({ kind: "team", state: "working", startedAt: NOW - 60_000, sentBack: 1 }), 1, running, NOW), "sent back · its lead and its workers at work · 1 min");
    assert.equal(boxLine(box({ state: "done", usd: 0.31, startedAt: NOW - 180_000, endedAt: NOW, result: { text: "x", at: NOW, made: [{ title: "Mock", address: "/a/1" }, { title: "Mock 2", address: "/a/2" }] } }), 0, running, NOW), "2 artifacts · $0.31 · 3 min");
    assert.equal(boxLine(box({ state: "done", usd: 0.2, result: { text: "x", at: NOW, wrote: true } }), 0, running, NOW), "changes in its own copy · $0.20");
    // HarnessV4_DesignPass_Plan, case 13: the pictures it drew, counted as its artifacts are.
    assert.equal(boxLine(box({ state: "done", usd: 0.2, result: { text: "x", at: NOW, made: [{ title: "Mock", address: "/a/1" }], drew: [{ title: "a", bytes: 1 }, { title: "b", bytes: 2 }] } }), 0, running, NOW), "1 artifact · 2 pictures · $0.20");
    assert.equal(boxLine(box({ gate: true, state: "done", verdict: { go: false, why: "two files it names do not exist" }, usd: 0.48 }), 1, running, NOW), "Verdict: not yet — two files it names do not exist · $0.48");
    assert.equal(boxLine(box({ state: "skipped" }), 0, running, NOW), "skipped: it hands on nothing");
    assert.equal(boxLine(box({ state: "failed", error: "its key is out" }), 0, running, NOW), "its key is out");
    // Your review.
    assert.equal(boxLine(box({ kind: "review", state: "asking" }), 1, running, NOW), "waits for you: go on, or send a box back");
    assert.equal(boxLine(box({ kind: "review", state: "done", result: { text: "x", at: NOW } }), 1, running, NOW), "you went on");
  });

  test("where a flow stands, a draft in a line, and what a gate's or your review's Send back offers: the boxes it needs", () => {
    assert.deepEqual(flowFig(flow()), { words: "drawn by your agent", tone: "", at: 0, n: 3 });
    assert.deepEqual(flowFig(flow({ drawn: "hand" })), { words: DRAWN_WORDS.hand, tone: "", at: 0, n: 3 });
    assert.deepEqual(flowFig(flow({ drawn: "saved" })), { words: "from a saved flow", tone: "", at: 0, n: 3 });
    assert.deepEqual(flowFig(flow({ state: "running", at: 1, usd: 0.65 })), { words: "step 2 of 3 · $0.65", tone: "", at: 2, n: 3 }, "the step it is at, the digit the head rolls");
    assert.deepEqual(flowFig(flow({ state: "holds", at: 1, hold: { kind: "gate", box: "b2" } })), { words: "step 2 of 3 · asks you", tone: "warn", at: 2, n: 3 });
    assert.deepEqual(flowFig(flow({ state: "cut", at: 2 })), { words: "step 3 of 3 · stopped by a restart", tone: "gray", at: 3, n: 3 });
    assert.deepEqual(flowFig(flow({ state: "done", at: -1, usd: 4.22 })), { words: "done · 3 boxes · $4.22", tone: "done", at: 0, n: 3 });
    assert.equal(sumLine(flow(), 4), "3 steps · 3 boxes · 1 gate · at most 1 of your 4 seats");
    const writes = flow({ steps: [{ boxes: [box(), box({ id: "b4", kind: "team", agent: "tenx", name: "10x Engineer", writes: true })] }, { boxes: [box({ id: "b2", name: "Skeptic", gate: true, needs: ["b1", "b4"] }), box({ id: "b6", kind: "review", agent: "", name: "Your review", needs: ["b4"] })] }] });
    assert.equal(sumLine(writes, null), "2 steps · 4 boxes · 1 writes · 1 gate · your review · at most 1 seat");
    assert.deepEqual(backOffers(writes, "b2").map((x) => x.label), ["Send back to PM", "Send back to 10x Engineer"]);
    assert.match(backOffers(writes, "b2")[1].title, /the gate's answer and your line: 10x Engineer's changes stay, and it goes on from them; then the gate reads again/);
    assert.deepEqual(backOffers(writes, "b6").map((x) => [x.label, x.title]), [["Send back to 10x Engineer", "A new turn in its chat with your line: 10x Engineer's changes stay, and it goes on from them; then you review again"]]);
    assert.deepEqual(backOffers(writes, "b1"), [], "a box that needs nothing has nothing to send back to");
  });

  test("what needs you, where its end went, and the header's line: the one that waits for you first, a writing team named", () => {
    assert.equal(needsYou(flow()), true, "a draft waits for Start");
    assert.equal(needsYou(flow({ state: "running" })), false);
    assert.equal(needsYou(flow({ state: "running", steps: [{ boxes: [box({ state: "asking" })] }] })), true);
    assert.equal(needsYou(flow({ state: "running", steps: [{ boxes: [box({ kind: "review", state: "asking" })] }] })), true, "your review waits for you");
    assert.equal(needsYou(flow({ state: "cut" })), true);
    assert.equal(needsYou(flow({ state: "done", end: { text: "", sent: { at: NOW, how: "sent" }, missed: null, waits: false, lost: false } })), false);
    assert.deepEqual(endWords(flow({ state: "done", end: { text: "", sent: null, missed: "the chat refused it", waits: false, lost: false } })), { words: "Its end did not reach your agent: the chat refused it", tone: "warn", send: true });
    assert.deepEqual(endWords(flow({ state: "done", end: { text: "", sent: null, missed: null, waits: true, lost: false } })), { words: "Its end goes to your agent once your chat's turn ends", tone: "wait", send: false });
    assert.equal(statusOf([flow()]), null, "a draft is not in the header");
    const runs = flow({ id: "fl-2", state: "running", line: "Flow · step 1 of 3", steps: [{ boxes: [box({ kind: "team", name: "10x Engineer", writes: true, state: "working" })] }] });
    const holds = flow({ id: "fl-3", state: "holds", line: "Flow · step 2 of 3 · Skeptic asks you", hold: { kind: "gate", box: "b2" } });
    const s = statusOf([runs, holds]);
    assert.deepEqual([s?.id, s?.words, s?.tone], ["fl-3", "Flow · step 2 of 3 · Skeptic asks you · +1", "warn"]);
    assert.match(String(statusOf([runs])?.title), /10x Engineer is writing in this folder/);
    // (OA5) In the flow's own worktree it is not writing here: the tip says where.
    const tree = { kind: "worktree", name: "flow-x", branch: "flow-x", folder: "H:/repo-flow-x", cwd: "H:/repo-flow-x" };
    const inTree = flow({ id: "fl-4", state: "running", line: "Flow · step 1 of 3", place: tree, steps: [{ boxes: [box({ kind: "team", name: "10x Engineer", writes: true, state: "working", place: tree })] }] });
    assert.match(String(statusOf([inTree])?.title), /10x Engineer is writing on branch flow-x, not in this folder/);
  });

  test("where a flow works (OA5): its own worktree and branch, or your folder outside git; a writing box's tip and its sheet's line", () => {
    const tree = { kind: "worktree", name: "flow-x", branch: "flow-x", folder: "H:/repo-flow-x", cwd: "H:/repo-flow-x" };
    const outside = { kind: "folder", folder: "H:/plain", why: "it is not in a git repository" };
    assert.equal(worksWords(flow()), null, "nothing before a team that writes started");
    assert.deepEqual(worksWords(flow({ place: tree })), { words: "Works in its own worktree · branch flow-x", title: "H:/repo-flow-x\nMade from your folder's last commit when its first team that writes started; every box after it works there, never in your folder. Nothing is merged: the branch is yours to merge, or to let go", worktree: true });
    assert.deepEqual(worksWords(flow({ place: outside })), { words: "Works in your folder", title: "It is not in a git repository: its teams that write change your folder's files", worktree: false });
    assert.equal(writeTip(box({})), "Writes: in a git project, in a worktree of the flow's own, never in your folder; else in your folder");
    assert.equal(writeTip(box({ place: tree })), "Writes on branch flow-x, in the flow's own worktree: never in your folder");
    assert.equal(writeTip(box({ place: outside })), "Writes in your folder: it is not a git repository");
    assert.equal(placeNote(box({ writes: true })), null);
    assert.equal(placeNote(box({ writes: true, place: tree })), "Its changes are on branch flow-x, in the worktree H:/repo-flow-x. Nothing is merged into your folder.");
    assert.equal(placeNote(box({ writes: false, place: tree })), null, "a box that reads only changed nothing");
    // On its card: the line under its head, the writing box's tip, its sheet's line.
    const builder = box({ id: "b3", kind: "team", agent: "tenx", name: "10x Engineer", words: "build it", writes: true, state: "done", place: tree, result: { text: "BUILT", at: NOW }, endedAt: NOW, startedAt: NOW - 60_000 });
    const f = flow({ state: "running", place: tree, steps: [{ why: "", boxes: [builder] }] });
    const w = world([f]);
    const el = w.cards.card(f, "pane");
    const works = one(el, "fl-works");
    assert.equal(textOf(works), "Works in its own worktree · branch flow-x");
    assert.match(String(works.attrs.title), /^H:\/repo-flow-x\nMade from your folder's last commit/);
    const tag = all(boxAt(el, "b3"), (x) => String(x.attrs?.class || "").includes("is-write"))[0];
    assert.equal(tag.attrs.title, "Writes on branch flow-x, in the flow's own worktree: never in your folder");
    boxAt(el, "b3").attrs.onclick();
    assert.match(textOf(w.cards.card(f, "pane")), /Its changes are on branch flow-x, in the worktree H:\/repo-flow-x\. Nothing is merged into your folder\./);
    const outsideEl = w.cards.card(flow({ state: "running", place: outside }), "pane");
    assert.equal(one(outsideEl, "fl-works").attrs.class, "fl-works is-folder");
  });

  test("a flow as a row of the Agents tab: by what it needs of you, its boxes at work under it, its sub-agents leaving the list", () => {
    const f = flow({ state: "running", steps: [{ boxes: [box({ state: "working", run: { sub: "s1" } }), box({ id: "b9", kind: "team", name: "Bug Hunter", state: "working", run: { team: "t1" } })] }, { boxes: [box({ id: "b2", run: { sub: "s0" }, state: "waits" })] }] });
    const r = flowRow(f, NOW);
    assert.deepEqual([r.id, r.way, r.group, r.name, r.task, r.look?.icon, r.look?.tone], ["team:flow:fl-1", "flow", "works", "Flow", "Plan, check, hunt", "waypoints", "cyan"]);
    assert.deepEqual(r.crew.map((c) => [c.id, c.name, c.thread]), [["s1", "PM", true], ["team:flow:fl-1", "Bug Hunter", false]]);
    assert.deepEqual(r.crewIds, ["s1", "s0"]);
    // A gate asked again: its first sub-agent's thread stays under the flow too.
    assert.deepEqual(flowRow(flow({ steps: [{ boxes: [box({ id: "b2", gate: true, run: { sub: "s5" }, ran: ["s4"] })] }] }), NOW).crewIds, ["s5", "s4"]);
    assert.equal(flowRow(flow(), NOW).group, "needs");
    assert.equal(flowRow(flow(), NOW).fact, "waits for your Start");
    assert.equal(flowRow(flow({ state: "holds", hold: { kind: "gate", box: "b2" } }), NOW).look?.tone, "orange");
    // Your review asking: under the flow, with your face.
    const review = flowRow(flow({ state: "running", steps: [{ boxes: [box({ state: "done" })] }, { boxes: [box({ id: "b2", kind: "review", agent: "", name: "Your review", state: "asking" })] }] }), NOW);
    assert.deepEqual(review.crew.map((c) => [c.name, c.icon, c.tone]), [["Your review", "user", "asks"]]);
    // In the list: a flow at the head of its part, its sub-agents gone from the rows, under it.
    const groups = withTeams([{ id: "works", title: "Working", rows: [{ id: "s1" }, { id: "s7" }] }], [r], (x) => String(/** @type {any} */ (x).id));
    assert.deepEqual(groups.map((g) => [g.id, g.items.map((x) => x.id), g.rows.map((x) => /** @type {any} */ (x).id)]), [["works", ["team:flow:fl-1"], ["s7"]]]);
    assert.equal(flowOfItem(flowItem("fl-9")), "fl-9");
    assert.equal(flowOfItem(FLOW_HOME), null);
  });

  // (fails before: yes — the flow's own sub-agents counted beside it: one flow with one box at work said 2)
  test("a flow's box at work is its flow's, not one more of your agents: it counts while it asks you", () => {
    const rows = [{ id: "s1", status: "running", origin: "flow" }, { id: "s2", status: "running", origin: "owner" }, { id: "s3", status: "running", origin: "flow", progress: { asking: { kind: "question", question: "Which file?" } } }];
    assert.deepEqual(mineAtWork(rows), { works: 2, asks: 1 });
  });

  test("the Agents tab's badge counts a flow that runs, and one that waits for you wears the orange dot", () => {
    assert.equal(agentsBadge(null, null, [], { works: 0, asks: 0 }), null);
    assert.deepEqual(agentsBadge(null, null, [], { works: 0, asks: 0 }, { works: 1, asks: 0 }), { text: "1", dot: "works", words: "a flow runs" });
    assert.deepEqual(agentsBadge(null, null, [], { works: 0, asks: 0 }, { works: 0, asks: 2 }), { text: "2", dot: "asks", words: "2 flows wait for you" });
  });

  // (OA3, OA-D6: the chip above Send is gone; /flow is how a message asks for a flow)
  test("/flow read off a message: its words, the word alone, or no /flow at all", () => {
    assert.equal(flowWordsOf("/flow plan the game engine"), "plan the game engine");
    assert.equal(flowWordsOf("  /FLOW   plan it\nthen build it  "), "plan it\nthen build it");
    assert.equal(flowWordsOf("/flow"), "");
    assert.equal(flowWordsOf("/flow   "), "");
    assert.equal(flowWordsOf("/flowchart it"), null);
    assert.equal(flowWordsOf("plan it with /flow"), null);
    assert.equal(flowWordsOf(""), null);
    assert.match(FLOW_USAGE, /^\/flow needs your words after it/);
    assert.equal("createFlowChip" in flowViews, false, "the chip is gone");
  });

  test("an edit sends each step's why, each box's own fields — its id and needs — none of its run", () => {
    const f = flow({ steps: [{ why: "first", boxes: [box({ state: "done", run: { sub: "s1" }, result: { text: "x", at: 1 }, model: "m-1", needs: ["b0"], needsOf: [{ id: "b0", name: "X" }] })] }] });
    assert.deepEqual(stepsBody(f), [{ why: "first", boxes: [{ id: "b1", kind: "agent", agent: "pm", words: "plan the parser", needs: ["b0"], gate: false, readOnly: false, model: "m-1", sees: null }] }]);
  });

  test("a box moved up or down a step: into the step there, or a step of its own past either end; a step it leaves empty goes", () => {
    const f = flow();
    const ids = (/** @type {any} */ steps) => steps.map((/** @type {any} */ s) => s.boxes.map((/** @type {any} */ b) => b.id));
    assert.deepEqual(ids(moveBox(f, 1, 0, -1)), [["b1", "b2"], ["b3"]], "up into step 1: step 2 goes");
    assert.deepEqual(ids(moveBox(f, 0, 0, 1)), [["b2", "b1"], ["b3"]], "down into step 2: step 1 goes");
    assert.equal(moveBox(f, 0, 0, -1), null, "alone in the first step, it cannot go up");
    assert.equal(moveBox(f, 2, 0, 1), null, "alone in the last, it cannot go down");
    const two = flow({ steps: [{ why: "w", boxes: [box(), box({ id: "b5" })] }, { why: "", boxes: [box({ id: "b2", needs: ["b1"] })] }] });
    assert.deepEqual(ids(moveBox(two, 0, 1, -1)), [["b5"], ["b1"], ["b2"]], "a step of its own before the first");
    assert.equal(moveBox(two, 1, 0, 1), null, "alone in the last step");
    const moved = /** @type {any} */ (moveBox(two, 0, 0, 1));
    assert.deepEqual(ids(moved), [["b5"], ["b2", "b1"]]);
    assert.deepEqual(moved[1].boxes[0].needs, ["b1"], "its needs stay as they were: the page shows the one that no longer holds");
    assert.equal(moved[0].why, "w");
  });

  test("a box's needs in words", () => {
    assert.equal(needsWords(box()), "needs nothing");
    assert.equal(needsWords(box({ needsOf: [{ id: "a", name: "PM" }] })), "needs PM");
    assert.equal(needsWords(box({ needsOf: [{ id: "a", name: "PM" }, { id: "b", name: "Designer" }] })), "needs PM and Designer");
    assert.equal(needsWords(box({ needsOf: [{ id: "a", name: "PM" }, { id: "b", name: "Designer" }, { id: "c", name: "Engineer" }] })), "needs PM, Designer and Engineer");
  });

  test("a /flow message's row: its mark, and Filament's line not counted as a message from agents", () => {
    assert.equal(deliveredWords({ deliveries: 1, flow: true }), "");
    assert.equal(deliveredWords({ deliveries: 2, flow: true }), "with 1 message from agents");
    const turns = transcriptTurns({ turns: [{ n: 1, flow: true, deliveries: 1, final: { role: "assistant", content: [{ type: "text", text: "Drawn." }] }, user: { role: "user", content: [{ type: "text", text: "[Filament: the developer typed /flow: …]" }, { type: "text", text: "plan it" }] } }] });
    assert.equal(/** @type {any} */ (turns[0]).flow, true);
  });
});

describe("the list of a chat's flows the page follows", () => {
  test("read when the chat changes, again once for a burst of the feed's flow events, a press's flow standing at once", async () => {
    /** @type {string[]} */
    const asked = [];
    /** @type {(() => void)[]} */
    const timers = [];
    const list = createFlowList({
      call: async (/** @type {string} */ path) => { asked.push(path); return { flows: [flow()] }; },
      later: (fn) => { timers.push(fn); return timers.length; },
      clear: () => {},
    });
    let changed = 0;
    list.onChange(() => { changed += 1; });
    list.setChain("c1");
    await settle();
    assert.deepEqual(asked, ["/sessions/c1/flows"], "a draft with no team that writes makes no worktree: no count to ask");
    assert.equal(list.rows().length, 1);
    list.heard({ type: "flow", chainId: "c1", id: "fl-1", state: "running" });
    list.heard({ type: "flow", chainId: "c1", id: "fl-1", state: "running" });
    list.heard({ type: "flow", chainId: "c9", id: "fl-x", state: "running" });
    list.heard({ type: "beside", main: "c1" });
    assert.equal(timers.length, 1, "one read for a burst, none for another chat's or a team's");
    timers[0]();
    await settle();
    assert.deepEqual(asked.slice(1), ["/sessions/c1/flows"], "the draft as it was: nothing more asked");
    list.put(flow({ id: "fl-2", title: "Another" }));
    assert.deepEqual(list.rows().map((f) => f.id), ["fl-2", "fl-1"]);
    list.put(flow({ id: "fl-x", chainId: "c9" }));
    assert.equal(list.rows().length, 2, "another chat's flow is not this list's");
    list.drop("fl-2");
    assert.deepEqual(list.rows().map((f) => f.id), ["fl-1"]);
    assert.ok(changed >= 4);
  });

  test("the routes: a review decided by its box; the chip's routes gone", async () => {
    /** @type {any[]} */
    const seen = [];
    const r = flowRoutes("c 1", async (path, o) => { seen.push([path, o?.method || "GET", o?.body ?? null]); return {}; });
    await r.decide("fl-1", { action: "back", to: "b1", line: "keep the tray out" });
    await r.decide("fl-1", { action: "on", box: "b4", line: "" });
    await r.act("fl-1", "b2", "hand-on");
    await r.saved();
    assert.deepEqual(seen, [
      ["/sessions/c%201/flows/fl-1/decide", "POST", { action: "back", to: "b1", line: "keep the tray out" }],
      ["/sessions/c%201/flows/fl-1/decide", "POST", { action: "on", box: "b4", line: "" }],
      ["/sessions/c%201/flows/fl-1/boxes/b2/hand-on", "POST", {}],
      ["/flows/saved", "GET", null],
    ]);
    assert.deepEqual(["names" in r, "draw" in r], [false, false]);
  });
});

describe("a flow's card", () => {
  test("a draft over the box: its steps top to bottom with their why, what each box needs, Start — the one press that runs it — and Discard, which puts the words back", async () => {
    const f = flow();
    const w = world([f]);
    const el = w.cards.card(f, "dock");
    const t = textOf(el);
    assert.match(t, /Flow\|drawn by your agent/);
    assert.match(t, /“Plan, check, hunt”/);
    assert.match(t, /3 steps · 3 boxes · 1 gate · at most 1 of your 4 seats/);
    assert.match(t, /Nothing runs until you press Start: beside your chat, your agent is told the flow as it stands; In place \(Start ▾\), your agent drives it in a turn of its own/);
    assert.match(t, /Nothing is hunted before the plan holds\./, "a step's why");
    assert.equal(all(el, (x) => String(x.attrs?.class || "") === "fl-why").length, 2, "a step with no why says none");
    assert.equal(all(el, (x) => x.attrs?.["data-box"]).length, 3);
    assert.equal(all(el, (x) => String(x.attrs?.class || "").includes("fl-num is-gate")).length, 1, "the gate's step wears its shield");
    assert.ok(textOf(el).includes("reads only"), "a team that changes no file says so");
    assert.equal(textOf(one(boxAt(el, "b1"), "fl-box-open")).includes("needs"), false, "the first step's box that needs nothing says nothing of it");
    assert.match(textOf(boxAt(el, "b2")), /needs PM/);
    assert.match(textOf(boxAt(el, "b3")), /needs Skeptic/);
    assert.equal(w.calls.length, 0, "drawing it ran nothing");
    btn(el, "Start").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1), ["start", "fl-1"]);
    btn(el, "Discard").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1), ["remove", "fl-1"]);
    assert.deepEqual(w.putBack, [f.goal]);
    // A box of a draft opens its sheet; Save as a flow… its own.
    one(boxAt(el, "b2"), "fl-box-open").dispatch("click");
    btn(el, "Save as a flow…").dispatch("click");
    assert.deepEqual(w.opened, [["edit", "fl-1", 1, 0], ["save", "fl-1"]]);
  });

  // (OA3 case 5, L38: "move down" — and a box moved below one it needs says so)
  test("a draft's box: Move up, Move down and Remove, each an edit of the steps; none where it cannot go", async () => {
    const f = flow();
    const w = world([f]);
    const el = w.cards.card(f, "dock");
    const up = tipped(boxAt(el, "b1"), "PM is alone in the first step");
    assert.ok(up && "disabled" in up.attrs);
    up.dispatch("click");
    assert.equal(w.calls.length, 0);
    tipped(boxAt(el, "b2"), "Move Skeptic down: into step 3").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1), ["edit", "fl-1", { steps: moveBox(f, 1, 0, 1) }]);
    tipped(boxAt(el, "b3"), "Move Bug Hunter up: into step 2").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1)[2].steps.map((/** @type {any} */ s) => s.boxes.map((/** @type {any} */ b) => b.id)), [["b1"], ["b2", "b3"]]);
    tipped(boxAt(el, "b2"), "Remove Skeptic").dispatch("click");
    await settle();
    const left = w.calls.at(-1)[2].steps;
    assert.deepEqual(left.map((/** @type {any} */ s) => s.boxes.map((/** @type {any} */ b) => [b.id, b.needs])), [[["b1", []]], [["b3", ["b1"]]]], "the hunt needs what the Skeptic needed");
  });

  test("a box whose need is not before it says so in orange; the draft cannot start, in its words", () => {
    const f = flow({
      problem: "Skeptic (step 2) needs Bug Hunter (step 2): a box reads only the results of the steps before its own — move Bug Hunter up, or Skeptic down",
      steps: [{ boxes: [box()] }, { boxes: [box({ id: "b2", name: "Skeptic", needs: ["b3"], needsOf: [{ id: "b3", name: "Bug Hunter" }], broken: ["Bug Hunter"] }), box({ id: "b3", kind: "team", agent: "bug-hunter", name: "Bug Hunter" })] }],
    });
    const w = world([f]);
    const el = w.cards.card(f, "dock");
    const b2 = boxAt(el, "b2");
    assert.ok(String(b2.attrs.class).includes("is-broken"));
    assert.match(textOf(one(b2, "is-broken")), /Bug Hunter is not before it/);
    assert.match(textOf(el), /It cannot start yet: Skeptic \(step 2\) needs Bug Hunter \(step 2\)/);
    const start = btn(el, "Start");
    assert.ok("disabled" in start.attrs);
    start.dispatch("click");
    assert.equal(w.calls.length, 0);
  });

  test("Edit…: the name and the words as fields, Add a box at each step's end and Add a step under them", () => {
    const f = flow();
    const w = world([f]);
    let el = w.cards.card(f, "dock");
    btn(el, "Edit…").dispatch("click");
    el = w.cards.card(f, "dock");
    assert.ok(one(el, "fl-fields"), "its name and words");
    assert.equal(buttonsOf(el).filter((b) => textOf(b) === "Add a box").length, 3);
    btn(el, "Add a step").dispatch("click");
    btn(el, "Add a box").dispatch("click");
    assert.deepEqual(w.opened, [["edit", "fl-1", 3, null], ["edit", "fl-1", 0, null]]);
    assert.ok(btn(el, "Done"), "Edit… turns to Done");
  });

  test("a gate that did not say go: its verdict and why, a line of yours, Send back to each box it needs, Go on anyway, Stop the flow", async () => {
    const f = flow({
      state: "holds", at: 1, hold: { kind: "gate", box: "b2" },
      steps: [
        { boxes: [box({ state: "done", result: { text: "THE PLAN", at: NOW } }), box({ id: "b5", agent: "helper", name: "Helper", state: "done" })] },
        { boxes: [box({ id: "b2", agent: "skeptic", name: "Skeptic", gate: true, needs: ["b1", "b5"], state: "done", verdict: { go: false, why: "two files it names do not exist" }, result: { text: "Verdict: not yet — two files it names do not exist", at: NOW }, sends: 1 })] },
      ],
    });
    const w = world([f]);
    const el = w.cards.card(f, "dock");
    const gate = one(el, "fl-gate");
    assert.match(textOf(gate), /Skeptic — not yet/);
    assert.match(textOf(gate), /the flow's gate, step 2 · the steps after it wait · sent back once/);
    assert.match(textOf(gate), /two files it names do not exist/);
    assert.deepEqual(buttonsOf(gate).map(textOf), ["Send back to PM", "Send back to Helper", "Go on anyway", "Stop the flow"]);
    const input = all(gate, (x) => x.tag === "input")[0];
    input.value = "name only files that exist";
    btn(gate, "Send back to Helper").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1), ["decide", "fl-1", { action: "back", to: "b5", line: "name only files that exist" }]);
    assert.equal(input.value, "", "the line goes with the send-back");
    btn(gate, "Go on anyway").dispatch("click");
    btn(gate, "Stop the flow").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.slice(-2), [["decide", "fl-1", { action: "on" }], ["decide", "fl-1", { action: "stop" }]]);
    assert.ok(btn(el, "Open its steps"), "over the box, its steps are on the Agents tab");
    assert.equal(one(el, "fl-steps"), undefined, "the dock shows what it waits for, not its steps");
  });

  // (OA-D10: the person's own review holds the flow until they go on)
  test("your review: what you look at, each result it needs to read, a line of yours, Go on, Send back to a box it needs, Stop the flow", async () => {
    const f = flow({
      state: "running", at: 1,
      steps: [
        { boxes: [box({ state: "done", result: { text: "THE PLAN", at: NOW } })] },
        { why: "You look before the hunt.", boxes: [box({ id: "b2", kind: "review", agent: "", name: "Your review", words: "Is the plan right?", needs: ["b1"], needsOf: [{ id: "b1", name: "PM" }], state: "asking", sends: 2 })] },
        { boxes: [box({ id: "b3", kind: "team", agent: "bug-hunter", name: "Bug Hunter", needs: ["b1", "b2"] })] },
      ],
    });
    const w = world([f]);
    const el = w.cards.card(f, "dock");
    const r = one(el, "is-review");
    assert.ok(r, "its card stands over the box");
    // (and how many times you sent a box back from it: its own count, as the server keeps it)
    assert.match(textOf(r), /Your review\|step 2 · the steps after it wait for you · you sent back 2 times\|Waits for you/);
    assert.match(textOf(r), /Is the plan right\?/);
    assert.match(textOf(r), /Read PM's answer\|THE PLAN/);
    assert.deepEqual(buttonsOf(r).map(textOf), ["Go on", "Send back to PM", "Stop the flow"]);
    const input = all(r, (x) => x.tag === "input")[0];
    input.value = "keep it small";
    btn(r, "Go on").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1), ["decide", "fl-1", { action: "on", box: "b2", line: "keep it small" }]);
    assert.equal(input.value, "");
    btn(r, "Send back to PM").dispatch("click");
    btn(r, "Stop the flow").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.slice(-2), [["decide", "fl-1", { action: "back", box: "b2", to: "b1", line: "" }], ["decide", "fl-1", { action: "stop", box: "b2" }]]);
    const dock = createFlowDock(w.io, w.cards, { h: fakeH, place });
    dock.paint({ chainId: "c1" });
    assert.equal(dock.el.kids.length, 1, "a flow whose review waits stands over the box");
  });

  // (fails before: yes — one input for both places: the card built last took it, and the other's gate had no field)
  test("the gate over the box and on the Agents tab: each its own field for the line, what is typed in one shown in the other", async () => {
    const f = flow({
      state: "holds", at: 1, hold: { kind: "gate", box: "b2" },
      steps: [{ boxes: [box({ state: "done" })] }, { boxes: [box({ id: "b2", agent: "skeptic", name: "Skeptic", gate: true, needs: ["b1"], state: "done", verdict: { go: false, why: "no" } })] }],
    });
    const w = world([f]);
    const inputOf = (/** @type {any} */ el) => all(one(el, "fl-gate"), (x) => x.tag === "input")[0];
    const pane = w.cards.card(f, "pane");
    const dock = w.cards.card(f, "dock");
    assert.ok(inputOf(pane) && inputOf(dock), "a field in each");
    assert.notEqual(inputOf(pane), inputOf(dock));
    inputOf(pane).value = "keep the tray out";
    inputOf(pane).dispatch("input");
    assert.equal(w.cards.card(f, "dock"), dock, "the same card");
    assert.equal(inputOf(dock).value, "keep the tray out", "typed on the Agents tab, there over the box");
    btn(dock, "Send back to PM").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1), ["decide", "fl-1", { action: "back", to: "b1", line: "keep the tray out" }]);
    assert.deepEqual([inputOf(pane).value, inputOf(dock).value], ["", ""], "sent: gone from both");
  });

  test("after a restart: Stopped by a restart, and Go on — the one press that goes on", async () => {
    const f = flow({ state: "cut", at: 2, steps: [{ boxes: [box({ state: "done" })] }, { boxes: [box({ id: "b2", gate: true, state: "done", verdict: { go: true, why: "" } })] }, { boxes: [box({ id: "b3", kind: "team", name: "10x Engineer", state: "cut", run: { team: "t1" } })] }] });
    const w = world([f]);
    const el = w.cards.card(f, "pane");
    assert.match(textOf(el), /Stopped by a restart/);
    assert.match(textOf(el), /Filament restarted while step 3 ran\. Nothing goes on by itself/);
    btn(el, "Go on").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1), ["goOn", "fl-1"]);
  });

  test("a box that failed holds the flow: Retry, Skip, Stop the flow", async () => {
    const f = flow({ state: "holds", at: 0, hold: { kind: "box", box: "b1" }, steps: [{ boxes: [box({ state: "failed", error: "its key is out" })] }, { boxes: [box({ id: "b2" })] }] });
    const w = world([f]);
    const el = w.cards.card(f, "dock");
    const hold = one(el, "fl-gate");
    assert.match(textOf(hold), /PM failed/);
    assert.match(textOf(hold), /Its key is out/);
    btn(hold, "Retry").dispatch("click");
    btn(hold, "Skip").dispatch("click");
    await settle();
    assert.deepEqual(w.calls, [["act", "fl-1", "b1", "retry"], ["act", "fl-1", "b1", "skip"]]);
  });

  test("on the Agents tab a box picked shows what it was asked, what it was handed — the boxes it needs — and its answer, read whole on a press", async () => {
    const f = flow({
      state: "running", at: 1,
      steps: [
        { boxes: [box({ state: "done", result: { text: "THE PLAN", at: NOW }, run: { sub: "s1" } }), box({ id: "b5", agent: "helper", name: "Helper", state: "skipped" }), box({ id: "b6", agent: "skeptic", name: "Skeptic", state: "done" })] },
        { boxes: [box({ id: "b2", agent: "skeptic", name: "Skeptic", words: "check the plan", needs: ["b1", "b5"], needsOf: [{ id: "b1", name: "PM" }, { id: "b5", name: "Helper" }], state: "working", run: { sub: "s2" }, startedAt: NOW - 60_000 })] },
        { boxes: [box({ id: "b3", kind: "team", agent: "tenx", name: "10x Engineer", state: "done", run: { team: "t1" }, result: { text: "Built.", at: NOW, more: true, chars: 9000 } })] },
      ],
    });
    /** @type {any} */
    let painted = 0;
    const w = world([f]);
    w.cards.onStale(() => { painted += 1; });
    let el = w.cards.card(f, "pane");
    assert.equal(one(el, "fl-detail"), undefined, "nothing picked, nothing asks you");
    boxAt(el, "b2").dispatch("click");
    assert.equal(painted, 1, "a pick paints again");
    el = w.cards.card(f, "pane");
    const d = one(el, "fl-detail");
    assert.match(textOf(d), /Skeptic/);
    assert.match(textOf(d), /an agent at its card's level · step 2/);
    assert.match(textOf(d), /check the plan/);
    assert.deepEqual(all(one(d, "fl-handed"), (x) => String(x.attrs?.class || "").startsWith("fl-hchip")).map(textOf), ["your words", "PM's answer", "Helper: skipped"], "only what it needs");
    assert.deepEqual(buttonsOf(one(d, "fl-foot")).map(textOf), ["Open its thread", "Stop", "Skip"]);
    btn(d, "Open its thread").dispatch("click");
    assert.deepEqual(w.opened.at(-1), ["thread", "s2"]);
    // A team box's reply read whole.
    boxAt(el, "b3").dispatch("click");
    el = w.cards.card(f, "pane");
    const d3 = one(el, "fl-detail");
    assert.match(textOf(d3), /The reply it ended on/);
    btn(d3, "Read it whole: 9,000 characters").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1), ["result", "fl-1", "b3"]);
    assert.ok(btn(d3, "Open its chat"));
  });

  test("an ended flow: where its end went, Send its end where it did not go, Remove", async () => {
    const f = flow({ state: "done", at: -1, end: { text: "x", sent: null, missed: null, waits: false, lost: true }, steps: [{ boxes: [box({ state: "done" })] }] });
    const w = world([f]);
    const el = w.cards.card(f, "pane");
    assert.match(textOf(el), /Filament stopped before its end went to your agent/);
    btn(el, "Send its end").dispatch("click");
    btn(el, "Remove").dispatch("click");
    await settle();
    assert.deepEqual(w.calls, [["send", "fl-1"], ["remove", "fl-1"]]);
  });

  test("a running flow on the Agents tab says the agent was told at its start", () => {
    const f = flow({ state: "running", at: 0 });
    const w = world([f]);
    assert.match(textOf(w.cards.card(f, "pane")), /your agent was told the flow at its start, and hears its end/);
  });

  test("built again only when what it shows changes", () => {
    const f = flow();
    const w = world([f]);
    assert.equal(w.cards.card(f, "dock"), w.cards.card(f, "dock"));
    assert.notEqual(w.cards.card(f, "dock"), w.cards.card({ ...f, tell: false }, "dock"));
  });
});

describe("where a flow shows", () => {
  test("over the box: a draft and a flow that waits for you, nothing for one that runs", () => {
    const flows = [flow(), flow({ id: "fl-2", state: "running" }), flow({ id: "fl-3", state: "holds", hold: { kind: "gate", box: "b2" }, steps: [{ boxes: [box()] }, { boxes: [box({ id: "b2", gate: true, state: "done", verdict: null })] }] })];
    const w = world(flows);
    const dock = createFlowDock(w.io, w.cards, { h: fakeH, place });
    dock.paint({ chainId: "c1" });
    assert.deepEqual(dock.el.kids.map((/** @type {any} */ k) => k.attrs["data-flow"]), ["fl-1", "fl-3"]);
    assert.equal(dock.el.classList.contains("is-empty"), false);
    dock.paint(null);
    assert.equal(dock.el.classList.contains("is-empty"), true);
  });

  // (fails before: yes — the Hunter of 10-28: with Motion Off the dock's card still rang, its ring a shadow no animation
  // rule stills)
  test("a flow come to wait for you in the chat you are in rings its card once; with Motion Off, never", () => {
    const { document, restore } = stubDocument();
    const doc = /** @type {any} */ (document);
    try {
      const holds = (/** @type {string} */ id) => flow({ id, state: "holds", hold: { kind: "gate", box: "b2" }, steps: [{ boxes: [box()] }, { boxes: [box({ id: "b2", gate: true, state: "done", verdict: null })] }] });
      for (const [motion, rings] of /** @type {[string, boolean][]} */ ([["full", true], ["off", false]])) {
        doc.documentElement.dataset.motion = motion;
        /** @type {any[]} */
        const flows = [];
        const w = world(flows);
        const dock = createFlowDock(w.io, w.cards, { h: fakeH, place });
        dock.paint({ chainId: "c1" });
        flows.push(holds(`fl-${motion}`));
        dock.paint({ chainId: "c1" });
        const card = dock.el.kids.find((/** @type {any} */ k) => k.attrs["data-flow"] === `fl-${motion}`);
        assert.ok(card, motion);
        assert.equal(card.classList.contains("is-flash"), rings, `Motion ${motion}`);
      }
    } finally {
      delete doc.documentElement.dataset.motion;
      restore();
    }
  });

  test("the header's line: hidden while none runs; a press opens the flow", () => {
    /** @type {string[]} */
    const opened = [];
    const s = createFlowStatus({ open: (id) => opened.push(id) }, { h: fakeH });
    s.paint([flow()]);
    assert.equal(s.el.classList.contains("hidden"), true);
    s.paint([flow({ state: "holds", line: "Flow · step 2 of 3 · Skeptic asks you", hold: { kind: "gate", box: "b2" } })]);
    assert.equal(s.el.classList.contains("hidden"), false);
    assert.equal(s.el.classList.contains("is-warn"), true);
    assert.match(textOf(s.el), /Flow · step 2 of 3 · Skeptic asks you/);
    s.el.dispatch("click");
    assert.deepEqual(opened, ["fl-1"]);
  });

  test("the Flows row's pane: What is it for, Start from Nothing or a saved flow, New flow — a draft, nothing runs; /flow named", async () => {
    const w = world([], {}, flow({ steps: [] }));
    const pane = createFlowPane(w.io, w.cards, { h: fakeH, place, drawIn: fakeDrawIn });
    pane.paint({ chainId: "c1" }, FLOW_HOME);
    assert.match(textOf(pane.el), /Flows/);
    assert.match(textOf(pane.el), /type \/flow and your words in the message box: your agent designs it for you/);
    assert.match(textOf(pane.el), /Plan, check, build, hunt\|PM → Skeptic ⛉ → Your review\|Filament's/);
    const make = btn(pane.el, "New flow");
    assert.ok("disabled" in make.attrs, "it says what the flow is for first");
    const goal = all(pane.el, (x) => x.tag === "textarea")[0];
    goal.value = "plan the desktop app";
    goal.dispatch("input");
    all(pane.el, (x) => x.attrs?.role === "radio")[1].dispatch("click");
    btn(pane.el, "New flow").dispatch("click");
    await settle();
    assert.deepEqual(w.calls.at(-1), ["create", { saved: "plan-check-build-hunt", goal: "plan the desktop app" }]);
    assert.deepEqual(w.opened.at(-1), ["created", "fl-1"]);
  });

  test("a flow's row's pane: that flow whole; one no longer listed says so", () => {
    const w = world([flow({ state: "running" })]);
    const pane = createFlowPane(w.io, w.cards, { h: fakeH, place, drawIn: fakeDrawIn });
    pane.paint({ chainId: "c1" }, flowItem("fl-1"));
    assert.ok(one(pane.el, "fl-steps"));
    pane.paint({ chainId: "c1" }, flowItem("fl-gone"));
    assert.match(textOf(pane.el), /no longer on this chat's list/);
  });
});

describe("a box's face", () => {
  // (fails before: yes — the Skeptic's tone, red, had no colour: its face had no tile, white on white in light)
  test("every shipped agent's tone gives its face a colour", () => {
    const css = readFileSync(new URL("../src/ui/harness/views/teams.css", import.meta.url), "utf8");
    const tags = ["helper", "scout", "builder", "tester", "reviewer", "pm", "designer", "enduser", "engineer", "skeptic", "tenx", "methodical", "architect", "oneshot", "explainer", "watcher"];
    const missing = [...new Set(tags.map((tag) => cardTone({ tag })))].filter((t) => !new RegExp(`\\.t-${t} \\{ --pf:`).test(css));
    assert.deepEqual(missing, []);
  });
});

describe("a box's sheet", () => {
  /** @param {any} o @returns {any} */
  const at = (o) => ({ id: "", kind: "agent", agent: "a", words: "w", needs: [], gate: false, readOnly: false, model: null, sees: null, ...o });
  const fakeDialog = /** @type {any} */ (() => ({ close: () => {} }));

  test("a new box needs the step before's; its place in the steps; a box taken out — a step it leaves empty goes, and a box that needed it needs what it needed", () => {
    assert.deepEqual(newBox(CARDS, TEAMS), { id: "", kind: "agent", agent: "pm", words: "", needs: [], gate: false, readOnly: false, model: null, sees: null });
    assert.deepEqual(newBox(CARDS, TEAMS, ["b1"]).needs, ["b1"]);
    assert.equal(newBox([], TEAMS).kind, "team");
    const a = at({ id: "a" }), b = at({ id: "b", needs: ["a"] }), c = at({ id: "c", needs: ["b"] });
    const steps = [{ why: "first", boxes: [a] }, { why: "second", boxes: [b] }];
    assert.deepEqual(withBox(steps, 1, null, c).map((s) => [s.why, s.boxes.map((x) => x.id)]), [["first", ["a"]], ["second", ["b", "c"]]]);
    assert.deepEqual(withBox(steps, 2, null, c).map((s) => [s.why, s.boxes.map((x) => x.id)]), [["first", ["a"]], ["second", ["b"]], ["", ["c"]]]);
    assert.deepEqual(withBox(steps, 0, 0, c).map((s) => s.boxes.map((x) => x.id)), [["c"], ["b"]]);
    const three = [{ why: "", boxes: [a] }, { why: "w", boxes: [b] }, { why: "", boxes: [c] }];
    const out = withoutBox(three, 1, 0);
    assert.deepEqual(out.map((s) => [s.why, s.boxes.map((x) => [x.id, x.needs])]), [["", [["a", []]]], ["", [["c", ["a"]]]]]);
    assert.deepEqual(three[2].boxes[0].needs, ["b"], "the steps it was given stay as they were");
  });

  test("Done says what is missing, else writes the steps with the box, needing what came before; Remove writes them without it", async () => {
    /** @type {any[]} */
    const writes = [];
    const f = flow();
    const s = openBoxSheet({ flow: f, step: 3, index: null, cards: () => CARDS, teams: () => TEAMS, models: () => ["m-1"], write: async (steps) => { writes.push(steps); return true; } }, { h: fakeH, dialog: fakeDialog, menu: /** @type {any} */ (() => {}), modelSelect: /** @type {any} */ (modelSelects().make) });
    await s.done();
    assert.equal(writes.length, 0);
    assert.match(textOf(s.body), /Say what this box is asked/);
    const words = all(s.body, (x) => x.tag === "textarea")[0];
    words.value = "review the plan for the tray";
    await s.done();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].length, 4, "a step of its own after the last");
    assert.deepEqual(writes[0][3], { why: "", boxes: [{ id: "", kind: "agent", agent: "pm", words: "review the plan for the tray", needs: ["b3"], gate: false, readOnly: false, model: null, sees: null }] });
    assert.equal(writes[0][1].why, "Nothing is hunted before the plan holds.", "each step keeps its why");
    const r = openBoxSheet({ flow: f, step: 0, index: 0, cards: () => CARDS, teams: () => TEAMS, models: () => [], write: async (steps) => { writes.push(steps); return true; } }, { h: fakeH, dialog: fakeDialog, menu: /** @type {any} */ (() => {}), modelSelect: /** @type {any} */ (modelSelects().make) });
    assert.match(textOf(r.body), /Remove the box/);
    assert.match(textOf(r.body), /Nothing: the first step is handed your words alone\./);
    await r.remove();
    assert.deepEqual(writes[1].map((/** @type {any} */ st) => st.boxes.map((/** @type {any} */ x) => [x.agent, x.needs])), [[["skeptic", []]], [["bug-hunter", ["b2"]]]]);
  });

  test("It needs: the boxes before it, each ticked or not; one not before it shown in orange to untick", async () => {
    /** @type {any[]} */
    const writes = [];
    const f = flow({ steps: [...flow().steps.slice(0, 2), { boxes: [box({ id: "b3", kind: "team", agent: "bug-hunter", name: "Bug Hunter", words: "hunt", needs: ["b2", "b9"] })] }] });
    const s = openBoxSheet({ flow: f, step: 2, index: 0, cards: () => CARDS, teams: () => TEAMS, models: () => [], write: async (steps) => { writes.push(steps); return true; } }, { h: fakeH, dialog: fakeDialog, menu: /** @type {any} */ (() => {}), modelSelect: /** @type {any} */ (modelSelects().make) });
    const ticks = () => all(s.body, (x) => x.attrs?.type === "checkbox");
    assert.deepEqual(ticks().map((x) => [x.attrs["aria-label"], "checked" in x.attrs]), [["Needs PM", false], ["Needs Skeptic", true], ["Needs b9", true]]);
    assert.ok(one(s.body, "is-broken"), "the need that is no box before it");
    assert.match(textOf(s.body), /not before it: untick it, or move a box/);
    ticks()[0].dispatch("change");
    ticks()[2].dispatch("change");
    await s.done();
    assert.deepEqual(writes[0][2].boxes[0].needs, ["b2", "b1"]);
  });

  test("Who: your agents, your teams, or your review — which needs what it looks at, and no words", async () => {
    /** @type {any[]} */
    const writes = [];
    /** @type {any[]} */
    let items = [];
    const f = flow();
    const s = openBoxSheet({ flow: f, step: 1, index: null, cards: () => CARDS, teams: () => TEAMS, models: () => [], write: async (steps) => { writes.push(steps); return true; } }, { h: fakeH, dialog: fakeDialog, menu: /** @type {any} */ ((/** @type {any[]} */ list) => { items = list; }), modelSelect: /** @type {any} */ (modelSelects().make) });
    buttonsOf(s.body).find((b) => String(b.attrs?.class) === "fl-popup")?.dispatch("click");
    assert.deepEqual(items.filter((x) => x.type === "label").map((x) => x.label), ["Your agents", "Your teams: a lead and its workers", "You"]);
    items.find((x) => x.label === "Your review").onClick();
    assert.match(textOf(s.body), /Your review/);
    assert.match(textOf(s.body), /What you look at/);
    assert.equal(all(s.body, (x) => String(x.attrs?.class || "") === "fl-srow").filter((x) => /It sees|Runs on|A gate|Reads only/.test(textOf(x))).length, 0, "a review has no level, model, view or gate");
    await s.done();
    assert.deepEqual(writes[0][1].boxes.at(-1), { id: "", kind: "review", agent: "", words: "", needs: ["b1"], gate: false, readOnly: false, model: null, sees: null });
  });

  // (fails before: yes — Runs on was a plain menu of the first 40 model names; the owner's of 10-28: "anywhere in the
  // harness where model picker is used, have it use our standard model picker")
  test("Runs on is the composer's model picker, given the catalogue as the page has it; Use the default goes back to its card's or its team's", async () => {
    /** @type {any[]} */
    const writes = [];
    /** @type {any[]} */
    let items = [];
    const pickers = modelSelects();
    const MODELS = [{ id: "claude-opus-5-5", upstream: "anthropic" }, { id: "glm-5.3", upstream: "zai" }];
    const FAMILIES = [{ id: "claude-opus-5-5", members: [] }];
    const ACCOUNTS = [{ agent: "claude-code" }];
    const s = openBoxSheet({ flow: flow(), step: 1, index: null, cards: () => CARDS, teams: () => TEAMS, models: () => MODELS, families: () => FAMILIES, accounts: () => ACCOUNTS, write: async (steps) => { writes.push(steps); return true; } }, { h: fakeH, dialog: fakeDialog, menu: /** @type {any} */ ((/** @type {any[]} */ list) => { items = list; }), modelSelect: /** @type {any} */ (pickers.make) });
    const agent = pickers.made[0];
    assert.ok(agent, "the picker, not a menu of names");
    assert.deepEqual([agent.models, agent.families, agent.accounts], [MODELS, FAMILIES, ACCOUNTS], "by provider and family, each coding agent's tab with its plan");
    assert.equal(agent.o.blank, "Its card's model", "unpicked, it says what runs");
    assert.equal(agent.name, "");
    const rowOf = () => all(s.body, (x) => String(x.attrs?.class || "") === "fl-srow").find((x) => /Runs on/.test(textOf(x)));
    assert.ok(rowOf()?.kids?.includes(agent.el), "the chip stands in the Runs on row");
    agent.o.onChange("glm-5.3");
    assert.equal(agent.name, "glm-5.3", "picked, it shows the model");
    agent.o.onUseDefault();
    assert.equal(agent.name, "", "Use the default: its card's model again");
    agent.o.onChange("claude-opus-5-5");
    // A team's box says its own default, in a picker of its own.
    buttonsOf(s.body).find((b) => String(b.attrs?.class) === "fl-popup")?.dispatch("click");
    items.find((x) => x.label === "Bug Hunter").onClick();
    const team = pickers.made[1];
    assert.equal(team?.o.blank, "Its team's models");
    assert.equal(team?.name, "", "a box made a team goes back to its team's models");
    team.o.onChange("glm-5.3");
    all(s.body, (x) => x.tag === "textarea")[0].value = "hunt the tray's bugs";
    await s.done();
    assert.equal(writes[0][1].boxes.at(-1).model, "glm-5.3");
    assert.equal(writes[0][1].boxes.at(-1).kind, "team");
  });

  // (fails before: yes — the review of 4f02eeb86, the owner's word of 11-05 "include reasoning effort across every model
  // picker": a box's Runs on had a model and no effort)
  test("Runs on says how hard it thinks beside its model; a level picked goes with the box, the default sends none", async () => {
    /** @type {any[]} */
    const writes = [];
    /** @type {any[]} */
    let items = [];
    const pickers = modelSelects();
    const s = openBoxSheet({ flow: flow(), step: 1, index: null, cards: () => CARDS, teams: () => TEAMS, models: () => [], write: async (steps) => { writes.push(steps); return true; } }, { h: fakeH, dialog: fakeDialog, menu: /** @type {any} */ ((/** @type {any[]} */ list) => { items = list; }), modelSelect: /** @type {any} */ (pickers.make) });
    const chip = () => buttonsOf(s.body).find((b) => b.attrs?.["aria-label"] === "How hard it thinks");
    const rowOf = () => all(s.body, (x) => String(x.attrs?.class || "") === "fl-srow").find((x) => /Runs on/.test(textOf(x)));
    assert.ok(rowOf()?.kids?.includes(chip()), "the chip stands in the Runs on row");
    assert.equal(chip().querySelector(".ec-words").textContent, "As its card says");
    chip().dispatch("click");
    items.find((x) => x.label === "High").onClick();
    all(s.body, (x) => x.tag === "textarea")[0].value = "plan it";
    await s.done();
    assert.equal(writes[0][1].boxes.at(-1).effort, "high");
  });

  // (fails before: yes — the review of a8e034ded: a box made a team kept the effort picked for its agent, its model gone)
  test("a box made a team takes its effort with its model: its chip says its default, and the box goes with none", async () => {
    /** @type {any[]} */
    const writes = [];
    /** @type {any[]} */
    let items = [];
    const pickers = modelSelects();
    const s = openBoxSheet({ flow: flow(), step: 1, index: null, cards: () => CARDS, teams: () => TEAMS, models: () => [], write: async (steps) => { writes.push(steps); return true; } }, { h: fakeH, dialog: fakeDialog, menu: /** @type {any} */ ((/** @type {any[]} */ x) => { items = x; }), modelSelect: /** @type {any} */ (pickers.make) });
    const chip = () => buttonsOf(s.body).find((b) => b.attrs?.["aria-label"] === "How hard it thinks");
    chip().dispatch("click");
    items.find((x) => x.label === "High").onClick();
    assert.equal(chip().querySelector(".ec-words").textContent, "High");
    buttonsOf(s.body).find((b) => String(b.attrs?.class) === "fl-popup")?.dispatch("click");
    items.find((x) => x.label === "Bug Hunter").onClick();
    // (fails before: yes — the look of 11-05: a team box's chip said its card's, its model's picker its team's)
    assert.equal(chip().querySelector(".ec-words").textContent, "As its team says");
    all(s.body, (x) => x.tag === "textarea")[0].value = "hunt the tray's bugs";
    await s.done();
    assert.deepEqual([writes[0][1].boxes.at(-1).kind, "effort" in writes[0][1].boxes.at(-1)], ["team", false]);
  });
});

describe("a team box's chat", () => {
  test("its first message folds the flow's hand-off as it folds the main chat's record; the box's own part shows", () => {
    const turns = transcriptTurns({
      turns: [{
        n: 1, record: true, handoff: true, final: { role: "assistant", content: [{ type: "text", text: "Hunting." }] },
        user: { role: "user", content: [{ type: "text", text: "<main-chat title=\"x\" turns=\"1\">…</main-chat>" }, { type: "text", text: "[Filament: you are one box of a flow the person started beside their chat …]\n\n<flow-goal>…</flow-goal>" }, { type: "text", text: "Your part: hunt for bugs" }] },
      }],
    });
    const t = /** @type {any} */ (turns[0]);
    assert.equal(t.userText, "Your part: hunt for bugs");
    assert.match(t.recordText, /^<main-chat/);
    assert.match(t.handoffText, /^\[Filament: you are one box of a flow/);
  });

  // (fails before: yes — Go on after a restart was Filament's own resume, drawn as "Filament went on by itself", and the
  // flow's lines to a team box were drawn as if the person had typed them)
  test("the flow's own word to it — go on, or its part sent back — is drawn as the flow's, not as the person's message", () => {
    assert.equal(PAGE_GO_ON, FLOW_GO_ON, "the page's copy of the line is the runner's");
    assert.ok(FLOW_NOTE_HEAD.startsWith("[Filament:"));
    const back = backAsk(/** @type {any} */ ({ kind: "team", words: "hunt for bugs" }), { gate: "Skeptic", answer: "Verdict: not yet — no tests", line: "run them" });
    assert.ok(back.startsWith(FLOW_BACK_HEAD) && isFlowSaid({ type: "text", text: back }) && isFlowSaid({ type: "text", text: FLOW_GO_ON }));
    assert.equal(isFlowSaid({ type: "text", text: "go on please" }), false);
    const turns = transcriptTurns({
      turns: [
        { n: 2, flowSaid: true, final: { role: "assistant", content: [{ type: "text", text: "Found it." }] }, user: { role: "user", content: [{ type: "text", text: FLOW_GO_ON }] } },
        { n: 3, flowSaid: true, final: { role: "assistant", content: [{ type: "text", text: "Ran them." }] }, user: { role: "user", content: [{ type: "text", text: back }] } },
      ],
    });
    assert.deepEqual(turns.map((/** @type {any} */ t) => [t.flowSaid, t.flowText.slice(0, 22)]), [["on", FLOW_GO_ON.slice(0, 22)], ["back", back.slice(0, 22)]]);
    assert.match(FLOW_ON_WORDS, /you pressed Go on/);
    assert.match(FLOW_BACK_WORDS, /sent its part back/);
  });
});

describe("the host: a flow on the Agents tab", () => {
  /** A team beside the chat, as its store lists it; a flow's team box has `flow`. @param {Record<string, any>} [o] @returns {any} */
  const besideRow = (o = {}) => ({
    id: "t1", main: "c1", team: { key: "verifier", name: "Verifier" }, ask: "check it", firedBy: "you", at: NOW - 60_000, model: "m-1", title: "",
    state: "working", workers: { running: 1, waiting: 0, total: 1 }, verify: false, notify: false, of: null, verifiedBy: null, result: null, notified: null, cut: false, readOnly: true,
    on: { lead: "m-1", workers: [], from: "team", fell: [] }, flow: null, ...o,
  });

  test("its row in the list, its team box's chat no row of its own, its row's pane the flow pane's, and the badge counting it", () => {
    const frame = fakeH("div", { class: "conv-frame" });
    const slot = fakeH("div", { class: "view-tabs-slot" });
    /** @type {string[]} */
    const painted = [];
    const pane = { el: fakeH("div", { class: "fl-test-pane" }), paint: (/** @type {any} */ _c, /** @type {string} */ id) => { painted.push(id); } };
    const running = flow({ state: "running", at: 0, steps: [{ boxes: [box({ kind: "team", name: "Bug Hunter", state: "working", run: { team: "t2" } })] }] });
    const rows = [besideRow(), besideRow({ id: "t2", team: { key: "bug-hunter", name: "Bug Hunter" }, flow: { id: "fl-1", box: "b1" } })];
    const beside = { rows: () => rows, brief: () => {}, set: () => {}, notify: () => {}, verify: () => {}, stop: () => {}, open: () => {}, resume: () => {}, now: () => NOW };
    const views = createViews({
      frame, slot,
      overview: { el: fakeH("div", {}), setShown: () => {}, paint: () => {} },
      mk: fakeH, api: async () => null, openAgent: () => {}, openRunLog: () => {},
      onShow: () => {}, loadRun: () => Promise.resolve(), later: () => {},
      team: teamIO({ beside, flows: () => [running], flow: pane }),
      side: /** @type {any} */ (sideIO({ rows: () => [] })),
      sideSeams: sideSeams().seams,
      drawIn: fakeDrawIn, place: (p, k) => p.replaceChildren(...k),
      modelSelect: modelSelects().make,
    });
    views.setChat(/** @type {any} */ ({ id: "chat-1", chainId: "c1", sessionId: "s1", turns: [], viewTab: "chat", view: { settings: { effective: {}, engine: { mode: "agent" } } } }));
    views.side.open(flowItem("fl-1"));
    views.show("side");
    const ids = all(frame, (x) => !!x.attrs?.["data-id"]).map((x) => x.attrs["data-id"]);
    assert.ok(ids.includes("team:flow:fl-1"), "the flow's row");
    assert.ok(ids.includes("team:side:t1"), "a team of yours beside the chat");
    assert.ok(!ids.includes("team:side:t2"), "the flow's team box is the flow's row's, not a row of its own");
    assert.ok(ids.includes(FLOW_HOME), "the Flows row at the list's foot");
    assert.deepEqual(painted.at(-1), "team:flow:fl-1", "its pane is the flow pane's");
    assert.ok(all(frame, (x) => x === pane.el).length === 1, "the flow pane stands in the Agents tab's pane");
    const tab = all(slot, (x) => x.attrs?.["data-view"] === "side")[0];
    assert.match(String(tab.attrs["aria-label"]), /a flow runs/);
    views.side.open(FLOW_HOME);
    views.draw();
    assert.equal(painted.at(-1), FLOW_HOME, "the Flows row: the flow pane's home");
  });
});

// (fails before: yes — the owner's of 10-28: "when we run flow it feels so static, no animations whatsoever"; the
// Designer's design of 10-28: a box at work says what it does now over a sliding bar, and what changed since the last
// read plays once on the card drawn after it)
describe("a flow that moves (the Designer's of 10-28)", () => {
  /** A running flow at step 2: PM done, Skeptic and the 10x Engineer at work, the Hunter to come. @param {any} [o] */
  const moving = (o = {}) => flow({
    state: "running", at: 1, startedAt: NOW - 300_000, line: "Flow · step 2 of 3",
    steps: [
      { why: "", boxes: [box({ state: "done", startedAt: NOW - 300_000, endedAt: NOW - 200_000 })] },
      { why: "", boxes: [box({ id: "b2", agent: "skeptic", name: "Skeptic", state: "working", run: { sub: "s2" }, startedAt: NOW - 72_000 }), box({ id: "b3", kind: "team", agent: "tenx", name: "10x Engineer", state: "working", run: { team: "t1" }, startedAt: NOW - 190_000 })] },
      { why: "", boxes: [box({ id: "b4", agent: "helper", name: "Hunter", state: "waits" })] },
    ],
    ...o,
  });

  test("what changed between two reads: a start, a box ended and the step passed, a gate come to ask you, the end; nothing, null", () => {
    const draft = flow();
    const started = flow({ state: "running", at: 0, steps: draft.steps.map((/** @type {any} */ s, /** @type {number} */ i) => ({ ...s, boxes: s.boxes.map((/** @type {any} */ b) => ({ ...b, state: i === 0 ? "working" : "waits" })) })) });
    assert.deepEqual(changesOf(draft, started, 5), { at: 5, started: true, ended: null, step: { from: -1, to: 0 }, boxes: { b1: { from: "waits", to: "working" } }, asked: null });
    const passed = flow({ state: "running", at: 1, steps: started.steps.map((/** @type {any} */ s, /** @type {number} */ i) => ({ ...s, boxes: s.boxes.map((/** @type {any} */ b) => ({ ...b, state: i === 0 ? "done" : i === 1 ? "working" : "waits" })) })) });
    assert.deepEqual(changesOf(started, passed, 6), { at: 6, started: false, ended: null, step: { from: 0, to: 1 }, boxes: { b1: { from: "working", to: "done" }, b2: { from: "waits", to: "working" } }, asked: null });
    const held = flow({ state: "holds", at: 1, hold: { kind: "gate", box: "b2" }, steps: passed.steps.map((/** @type {any} */ s, /** @type {number} */ i) => ({ ...s, boxes: s.boxes.map((/** @type {any} */ b) => ({ ...b, state: i <= 1 ? "done" : "waits" })) })) });
    assert.deepEqual(changesOf(passed, held, 7)?.asked, "b2", "the gate that said not yet asks you");
    const done = flow({ state: "done", at: -1, steps: held.steps.map((/** @type {any} */ s) => ({ ...s, boxes: s.boxes.map((/** @type {any} */ b) => ({ ...b, state: "done" })) })) });
    assert.equal(changesOf(held, done, 8)?.ended, "done");
    assert.deepEqual([changesOf(passed, passed, 9), changesOf(null, draft, 9)], [null, null], "nothing moved; a draft plays nothing");
    // (fails before: yes — the Hunter of 10-28: a hold of no box, its driver's turn ended, and a restart's cut asked you
    // with nothing rising in; the box's id was "", read as none)
    const driven = flow({ ...passed, state: "holds", hold: { kind: "driver", box: "" } });
    assert.equal(changesOf(passed, driven, 10)?.asked, "hold", "the driver's hold asks you");
    assert.equal(changesOf(passed, flow({ ...passed, state: "cut" }), 11)?.asked, "cut", "so does a restart's cut");
    assert.equal(changesOf(driven, driven, 12), null, "and once only");
  });

  test("the list keeps a moment of what changed between two reads of the same chat, never on its first read, for a moment", async () => {
    let clock = NOW;
    /** @type {any[]} */
    const answers = [];
    const list = createFlowList({ call: async () => answers.shift(), later: () => null, clear: () => {}, now: () => clock });
    const first = moving({ at: 0, steps: moving().steps.map((/** @type {any} */ s, /** @type {number} */ i) => ({ ...s, boxes: s.boxes.map((/** @type {any} */ b) => ({ ...b, state: i === 0 ? "working" : "waits" })) })) });
    answers.push({ flows: [first] });
    list.setChain("c1");
    await settle();
    assert.deepEqual(list.changes("fl-1"), [], "a card opened plays nothing");
    answers.push({ flows: [moving()] });
    await list.refresh();
    assert.deepEqual(list.changes("fl-1").map((m) => [m.at, m.step]), [[NOW, { from: 0, to: 1 }]]);
    clock += MOMENT_MS;
    assert.deepEqual(list.changes("fl-1"), [], "gone after its moment");
    // A write the server answered is a change the page saw too.
    list.put(moving({ state: "stopped", steps: moving().steps.map((/** @type {any} */ s) => ({ ...s, boxes: s.boxes.map((/** @type {any} */ b) => ({ ...b, state: b.state === "working" ? "stopped" : b.state })) })) }));
    assert.deepEqual(list.changes("fl-1").map((m) => [m.ended, Object.keys(m.boxes)]), [["stopped", ["b2", "b3"]]]);
    list.setChain("c2");
    assert.deepEqual(list.changes("fl-1"), [], "another chat keeps none");
  });

  test("a box at work says what it does now over a sliding bar — its round, its tool, how long; a team's workers — said again in place, the card not drawn again as the clock moves", () => {
    let clock = NOW;
    /** @type {any} */
    let said = { round: 4, tool: { name: "edit", args: "src/lib/now.js" }, words: "" };
    const running = moving();
    const { cards } = world([running], { now: () => clock, live: (/** @type {any} */ b) => (b.run?.sub ? said : b.run?.team ? { team: "2 at work · 1 waits for a slot" } : null) });
    const el = cards.card(running, "pane");
    const b2 = boxAt(el, "b2");
    assert.deepEqual([textOf(one(b2, "fl-live")), textOf(one(b2, "fl-tool")), one(b2, "fl-tool").classList.contains("hidden")], ["at work · round 4 · 1m 12s", "edit| src/lib/now.js", false]);
    assert.equal(one(b2, "tg-node-bar-fill").attrs.style, `animation-delay:-${NOW % 1600}ms`, "its bar slides as if never drawn again");
    const b3 = boxAt(el, "b3");
    assert.deepEqual([textOf(one(b3, "fl-live")), one(b3, "fl-tool").classList.contains("hidden")], ["its lead · 2 at work · 1 waits for a slot · 3m 10s", true]);
    assert.equal(one(boxAt(el, "b1"), "tg-node-bar"), undefined, "a box done has no bar");
    assert.deepEqual(all(el, (x) => String(x.attrs?.class || "").split(/\s+/).includes("fl-step")).map((x) => x.attrs["data-step"]), ["0", "1", "2"]);
    assert.deepEqual([textOf(one(el, "fl-fig")), textOf(one(el, "fl-fig-n"))], ["step |2| of 3", "2"], "the head's digit in a span of its own, which rolls");
    // A minute on, the same card; its live lines said again in place.
    clock = NOW + 60_000;
    said = { round: 5, tool: null, words: "" };
    assert.equal(cards.card(running, "pane"), el, "no clock in its key");
    cards.live();
    assert.deepEqual([textOf(one(b2, "fl-live")), textOf(one(b2, "fl-tool"))], ["at work · round 5 · 2m 12s", "Thinking…"]);
    said = { round: 5, tool: null, words: "Reading the plan.\nIt holds so far." };
    cards.live();
    assert.equal(textOf(one(b2, "fl-tool")), "It holds so far.", "its newest words between tools");
  });

  test("the header's line shimmers while its flow runs and nothing asks you; a line come or changed in the same chat moves once, another chat's does not", () => {
    const st = createFlowStatus({ open: () => {} }, { h: fakeH });
    const words = () => one(st.el, "fl-status-w");
    st.paint([moving()], "c1");
    assert.deepEqual([st.el.classList.contains("is-running"), st.el.classList.contains("is-new-now")], [true, false], "the chat opened: no move");
    st.paint([moving({ state: "holds", hold: { kind: "gate", box: "b2" }, line: "Flow · step 2 of 3 · Skeptic asks you" })], "c1");
    assert.deepEqual([st.el.classList.contains("is-running"), words().classList.contains("is-said")], [false, true], "it asks you: still, its words rise in");
    const other = createFlowStatus({ open: () => {} }, { h: fakeH });
    other.paint([moving()], "c1");
    other.paint([moving({ line: "Flow · step 3 of 3" })], "c2");
    assert.equal(one(other.el, "fl-status-w").classList.contains("is-said"), false, "another chat's line does not move");
  });

  test("the moves: a box that ended closes its bar, the step passes down its rail, the next number arrives as the digit rolls, its boxes wake; mid-moment it goes on; Reduced fades, Off is still; a gate blooms", () => {
    const { document, restore } = stubDocument();
    const doc = /** @type {any} */ (document);
    /** A card drawn with the page's own h on the stub document. @param {any} f @returns {any} */
    const drawn = (f) => {
      const el = createFlowCards({ ...world([f]).io, live: () => null }).card(f, "pane");
      doc.body.append(el);
      return el;
    };
    /** @param {any} root @param {string} sel @param {string} attr @param {string} v */
    const by = (root, sel, attr, v) => root.querySelectorAll(sel).find((/** @type {any} */ x) => x.getAttribute(attr) === v);
    try {
      const running = moving();
      const m = /** @type {any} */ ({ at: NOW, started: false, ended: null, step: { from: 0, to: 1 }, boxes: { b1: { from: "working", to: "done" }, b2: { from: "waits", to: "working" }, b3: { from: "waits", to: "working" } }, asked: null });
      const el = drawn(running);
      playFlowMoves(el, [m], NOW + 100);
      const b1 = by(el, "[data-box]", "data-box", "b1");
      assert.ok(b1.classList.contains("is-ended-now"));
      assert.deepEqual(b1.querySelectorAll(".fl-close").map((/** @type {any} */ x) => x.className), ["fl-close"], "done: its bar closes in green");
      const step0 = by(el, ".fl-step[data-step]", "data-step", "0");
      const step1 = by(el, ".fl-step[data-step]", "data-step", "1");
      assert.deepEqual([step0.classList.contains("is-passing"), step0.style["--fl-rd"]], [true, `${FLOW_BEATS.rail - 100}ms`]);
      assert.deepEqual([step1.classList.contains("is-arrived"), step1.style["--fl-d"]], [true, `${FLOW_BEATS.arrive - 100}ms`]);
      const woke = ["b2", "b3"].map((id) => by(el, "[data-box]", "data-box", id));
      assert.deepEqual(woke.map((x) => [x.classList.contains("is-waking"), x.style["--i"], x.style["--fl-d"]]), [[true, "0", `${FLOW_BEATS.wake - 100}ms`], [true, "1", `${FLOW_BEATS.wake - 100}ms`]], "one after the other");
      const digit = el.querySelector(".fl-fig-n");
      // (fails before: yes — the Hunter of 10-28: the old digit rolled out inside the new one's moving part, their moves
      // added up and its fade hid the old one)
      const rolled = digit.querySelector(".fl-fig-now");
      const was = digit.querySelectorAll(".fl-fig-was");
      assert.deepEqual([rolled?.classList.contains("is-rolled"), rolled?.textContent, digit.classList.contains("is-rolled"), digit.style["--fl-dir"], was.map((/** @type {any} */ x) => x.textContent)], [true, "2", false, "1", ["1"]], "the new digit rolls in on its own part, the old one out beside it");
      assert.ok(was.every((/** @type {any} */ x) => x.parentNode === digit && !rolled.contains(x)), "never inside the part that moves in");
      // Drawn again in mid-moment: each wait less the time gone, negative once under way.
      const again = drawn(running);
      playFlowMoves(again, [m], NOW + 600);
      assert.equal(by(again, ".fl-step[data-step]", "data-step", "1").style["--fl-d"], `${FLOW_BEATS.arrive - 600}ms`);
      // Reduced: what arrives fades, nothing travels, nothing waits; Off: nothing.
      doc.documentElement.dataset.motion = "reduced";
      const calm = drawn(running);
      playFlowMoves(calm, [m], NOW + 100);
      assert.deepEqual([calm.querySelectorAll(".fl-close").length, calm.querySelectorAll(".fl-fig-was").length, by(calm, ".fl-step[data-step]", "data-step", "1").style["--fl-d"]], [0, 0, "0ms"]);
      doc.documentElement.dataset.motion = "off";
      const still = drawn(running);
      playFlowMoves(still, [m], NOW + 100);
      assert.equal(still.querySelectorAll(".is-waking, .is-ended-now, .is-arrived").length, 0);
      delete doc.documentElement.dataset.motion;
      // A gate come to ask you: one bloom on its box, its card rising in.
      const held = moving({ state: "holds", hold: { kind: "gate", box: "b2" }, steps: moving().steps.map((/** @type {any} */ s) => ({ ...s, boxes: s.boxes.map((/** @type {any} */ b) => (b.id === "b2" ? { ...b, state: "done", gate: true, verdict: { go: false, why: "two files do not exist" } } : b)) })) });
      const asks = drawn(held);
      playFlowMoves(asks, [/** @type {any} */ ({ at: NOW, started: false, ended: null, step: null, boxes: { b2: { from: "working", to: "done" } }, asked: "b2" })], NOW);
      assert.ok(by(asks, "[data-box]", "data-box", "b2").classList.contains("is-asked-now"));
      assert.ok(asks.querySelector(".fl-gate").classList.contains("is-new-now"));
    } finally {
      restore();
    }
  });
});
