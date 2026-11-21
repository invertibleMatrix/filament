// @ts-check
// A team's surfaces drawn again at each pulse of its workers keep the elements under the pointer (the owner's of 11-01:
// "when i hover over my mouse over some interactive elements like buttons then those are just suppose to highlight only
// once they quite a lot of time they start blinking … and during that sometimes the clicks even don't pass through so i
// have to press more than once"). A working team's board was made anew whenever what it says moved — at every pulse of
// its workers —, its Stop, its switches and each worker's frame with it; the Teams tab's head at every paint, Send a
// team… moved into it; a folded row and the room strip's link at every paint. Drawn in place (dom.js `morphChildren`),
// each is the element that stood, its words and its handler the newest draw's; a worker's question bar, kept while its
// call waits, stays itself.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/views/board.js")} */
let board;
/** @type {typeof import("../src/ui/harness/views/beside.js")} */
let beside;
const g = /** @type {any} */ (globalThis);
before(async () => {
  doc = stubDocument();
  // The page's document hears its own events (md.js's, as it loads), and the window keeps its clocks; never holding
  // the run open.
  const page = /** @type {any} */ (doc.document);
  page.addEventListener ||= () => {};
  page.removeEventListener ||= () => {};
  g.window.setInterval ||= (/** @type {() => void} */ fn, /** @type {number} */ ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; };
  g.window.clearInterval ||= clearInterval;
  board = await import("../src/ui/harness/views/board.js");
  beside = await import("../src/ui/harness/views/beside.js");
});
after(() => doc.restore());

const NOW = 1_800_000_000_000;
/** The same element, never compared by its shape. @param {any} now @param {any} was @param {string} what */
const same = (now, was, what) => assert.ok(now != null && now === was, `${what}: the element that stood`);
/** A button by its words. @param {any} at @param {string} label @returns {any} */
const button = (at, label) => at.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent.trim() === label) || null;
/** A team chat's worker at work, at its round with its words. @param {Record<string, any>} [o] @returns {any} */
const worker = (o = {}) => ({
  id: "sa_1", status: "running", startedAt: NOW - 60_000, model: "m-2", description: "P0 every tool", may: "read",
  team: { key: "bug-hunter", name: "Bug Hunter", role: "hunter", place: "hunter" }, card: { tag: "hunter", name: "Hunter", kind: "worker" },
  waiting: null,
  progress: { round: 2, tool: { name: "read", args: "src/index.js" }, words: "Reading the first pass.", context: { tokens: 50_000, window: 200_000 }, asking: null, spent: 0.01 },
  exchanges: [{ startedAt: NOW - 60_000, endedAt: null, status: "running" }],
  ...o,
});
/** A worker whose call waits for your answer. */
const ASKS = { id: "sa_4", startedAt: NOW - 30_000, description: "P3 cards", progress: { round: 3, tool: { name: "bash", args: "npm test" }, words: "Found one.", context: null, asking: { tool: "bash", args: "npm test", command: "npm test", runs: "npm test", reason: "Proving it with a test", offer: { itemId: 3, tool: "bash", shape: "npm test *" } } } };
/** A team on the side as the beside list answers it. @param {Record<string, any>} [o] @returns {any} */
const team = (o = {}) => ({
  id: "t1", main: "c1", team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "find bugs in the last six phases", firedBy: "you", at: NOW - 2 * 60_000, model: "m-1", title: "",
  state: "working", workers: { running: 2, waiting: 0, total: 2 }, verify: false, notify: true, of: null, verifiedBy: null, result: null, notified: null, cut: false, readOnly: true,
  on: { lead: "m-1", workers: ["m-2"], from: "team", fell: [] }, ...o,
});
const LEAD = { id: "t1", running: true, rounds: 4, words: "Two are out.", calls: [{ name: "wait", subject: "wait", open: true }], startedAt: NOW - 2 * 60_000, usd: 0.13 };

test("a working team's board drawn again as its workers move keeps its Stop, its switches and each worker's frame; its question bar stays itself", () => {
  /** @type {string[]} */
  const did = [];
  const state = { rows: [worker(ASKS), worker()], lead: LEAD };
  const b = board.createBoards(/** @type {any} */ ({
    rows: () => state.rows, known: () => true, lead: () => state.lead,
    set: (/** @type {string} */ id, /** @type {any} */ p) => did.push(`set ${JSON.stringify(p)}`), stop: (/** @type {string} */ id) => did.push(`stop ${id}`),
    open: () => {}, openWorker: (/** @type {string} */ tid, /** @type {string} */ id) => did.push(`worker ${id}`),
    answer: async () => true, always: async () => true, now: () => NOW,
  }));
  const el = b.boardOf(team());
  /** @type {any} */ (doc.document.body).replaceChildren(el);
  const stop = button(el, "Stop");
  const notify = el.querySelector(".bd-switch button");
  const frame = el.querySelector(".bd-fr[data-id='sa_1']") || el.querySelectorAll(".bd-fr").find((/** @type {any} */ f) => f.getAttribute("data-id") === "sa_1");
  const ask = el.querySelector(".bd-ask");
  assert.ok(stop && notify && frame && ask, "its Stop, a switch, a worker's frame, a question bar");
  // A pulse: the worker's words move, and the lead's rounds.
  state.rows = [worker(ASKS), worker({ progress: { ...worker().progress, round: 3, words: "Writing the second pass." } })];
  state.lead = { ...LEAD, rounds: 5 };
  same(b.boardOf(team()), el, "the board");
  same(button(el, "Stop"), stop, "Stop");
  same(el.querySelector(".bd-switch button"), notify, "its switch");
  same(el.querySelectorAll(".bd-fr").find((/** @type {any} */ f) => f.getAttribute("data-id") === "sa_1"), frame, "the worker's frame");
  same(el.querySelector(".bd-ask"), ask, "the question bar");
  assert.ok(frame.textContent.includes("Writing the second pass."), "its words the newest");
  stop.dispatch("click");
  frame.dispatch("click");
  assert.deepEqual(did, ["stop t1", "worker sa_1"]);
});

// (fails before: yes — the developer's reviewer of 11-02: a question bar new to a board that stood was drawn over its
// grid by tag, its parts moved into the grid and the grid made anew, and the next pulse drew the bar kept, now empty,
// over the one on the page: the person could not answer from the board)
test("a worker that comes to ask on a board that stands gets its question bar beside the grid, whole at every pulse after", () => {
  /** @type {string[]} */
  const did = [];
  const state = { rows: [worker({ id: "sa_4" }), worker()], at: NOW };
  const b = board.createBoards(/** @type {any} */ ({
    rows: () => state.rows, known: () => true, lead: () => LEAD, set: () => {}, stop: () => {}, open: () => {}, openWorker: () => {},
    answer: async (/** @type {string} */ tid, /** @type {string} */ id, /** @type {any} */ words) => (did.push(`${id} ${JSON.stringify(words)}`), true),
    always: async () => true, now: () => state.at,
  }));
  const el = b.boardOf(team());
  /** @type {any} */ (doc.document.body).replaceChildren(el);
  const grid = el.querySelector(".bd-grid");
  const frame = el.querySelectorAll(".bd-fr").find((/** @type {any} */ f) => f.getAttribute("data-id") === "sa_1");
  assert.ok(grid && frame && !el.querySelector(".bd-ask"), "the grid with its frames, no question yet");
  // Its worker comes to ask; then two pulses — its words move, the minute ticks.
  state.rows = [worker(ASKS), worker()];
  b.boardOf(team());
  const ask = el.querySelector(".bd-ask");
  assert.ok(ask, "its question bar");
  same(el.querySelector(".bd-grid"), grid, "the grid");
  same(el.querySelectorAll(".bd-fr").find((/** @type {any} */ f) => f.getAttribute("data-id") === "sa_1"), frame, "the other worker's frame");
  assert.equal(grid.querySelector(".bd-ask-q"), null, "nothing of the bar in the grid");
  for (const step of [() => { state.rows = [worker(ASKS), worker({ progress: { ...worker().progress, words: "Writing the second pass." } })]; }, () => { state.at += 60_000; }]) {
    step();
    b.boardOf(team());
    same(el.querySelector(".bd-ask"), ask, "the question bar");
    assert.ok(ask.textContent.includes("asks you") && ask.textContent.includes("npm test"), "its question whole");
    assert.ok(button(ask, "Allow"), "its Allow");
  }
  button(ask, "Allow").dispatch("click");
  assert.equal(did.length, 1, "answered from the board");
});

// (fails before: yes — the developer's reviewer of 11-02: the team's own chat drew its grid over the main chat's head,
// which came back without Send a team…, and a board made again was drawn over the stale one, its workers' frames kept)
test("a round trip through a side team's own chat: the head comes back with Send a team…, another team's board follows its workers, and the team's own board stays on the page at its pulses", () => {
  /** @type {string[]} */
  const did = [];
  let inTeam = false;
  const words = { t1: "Reading the first pass.", t3: "Hunting in the parser." };
  const rowsOf = (/** @type {string} */ tid) => [worker({ id: `${tid}_w`, progress: { ...worker().progress, words: words[/** @type {"t1" | "t3"} */ (tid)] } })];
  const teams = [team(), team({ id: "t3", team: { key: "bug-hunter", name: "Second Hunter" } })];
  const v = beside.createBesideView(/** @type {any} */ ({
    rows: () => teams, brief: () => did.push("brief"), set: () => {}, notify: () => {}, verify: () => {}, stop: () => {}, open: () => {}, resume: () => {}, now: () => NOW,
    main: () => (inTeam ? "c1" : null), self: () => (inTeam ? teams[0] : null),
    board: {
      rows: rowsOf, known: () => true, lead: () => LEAD, set: () => {}, stop: () => {}, open: () => {}, openWorker: () => {},
      answer: async () => true, always: async () => true, now: () => NOW,
    },
  }));
  /** @type {any} */ (doc.document.body).replaceChildren(v.el);
  const el = /** @type {any} */ (v.el);
  const frameOf = (/** @type {string} */ id) => el.querySelectorAll(".bd-fr").find((/** @type {any} */ f) => f.getAttribute("data-id") === id) || null;
  v.paint({ chainId: "c1" });
  assert.ok(button(el, "Send a team…") && frameOf("t1_w") && frameOf("t3_w"), "the head, both teams' boards");
  // The first team's own chat, at two pulses of its workers.
  inTeam = true;
  v.paint({ chainId: "t1chat" });
  const own = el.querySelector(".bd");
  assert.ok(own && frameOf("t1_w"), "its own board");
  // Its holder hears every time the board is taken out of it.
  const holder = own.parentNode;
  let left = 0;
  const removeChild = holder.removeChild;
  holder.removeChild = function (/** @type {any} */ n) {
    if (n === own) left++;
    return removeChild.call(this, n);
  };
  words.t1 = "Writing the second pass.";
  v.paint({ chainId: "t1chat" });
  holder.removeChild = removeChild;
  assert.equal(el.querySelector(".bd"), own, "the board that stood");
  assert.equal(left, 0, "never taken off the page at a pulse");
  assert.ok(frameOf("t1_w").textContent.includes("Writing the second pass."));
  // Back in the main chat: the head as it was, and the second team's board follows its workers.
  inTeam = false;
  v.paint({ chainId: "c1" });
  const send = button(el, "Send a team…");
  assert.ok(send, "Send a team… back");
  assert.ok(send.parentNode.classList.contains("bes-head"), "in its head");
  words.t3 = "Found one in the lexer.";
  v.paint({ chainId: "c1" });
  assert.ok(frameOf("t3_w")?.textContent.includes("Found one in the lexer."), "the second team's worker says its newest words");
  assert.equal(el.querySelectorAll(".bd").length, 2, "one board each");
  send.dispatch("click");
  assert.deepEqual(did, ["brief"]);
});

test("the Teams tab's head keeps Send a team… itself; a folded row and the room strip's link stay at each paint", () => {
  /** @type {string[]} */
  const did = [];
  let at = NOW;
  const ended = team({ id: "t2", state: "done", workers: { running: 0, waiting: 0, total: 2 }, result: { n: 1, text: "Found one.", more: false, at: NOW }, notified: { n: 1, at: NOW, how: "you" } });
  const v = beside.createBesideView(/** @type {any} */ ({
    rows: () => [team(), ended], brief: () => did.push("brief"), set: () => {}, notify: () => {}, verify: () => {}, stop: () => {},
    open: (/** @type {string} */ id) => did.push(`open ${id}`), resume: () => {}, now: () => at,
    room: () => ({ rows: [{ name: "m-2", running: 4, waiting: 2, cap: 4 }] }), openSlots: () => did.push("slots"),
  }));
  /** @type {any} */ (doc.document.body).replaceChildren(v.el);
  v.paint({ chainId: "c1" });
  const el = /** @type {any} */ (v.el);
  const send = button(el, "Send a team…");
  // Moved into a head made anew, it left the page and came back: its hover gone, a press on it lost.
  const head = send.parentNode;
  const row = el.querySelector(".bes-row");
  const ask = row && button(row, "Ask its lead");
  const slots = button(el, "Each model's limit…");
  assert.ok(send && ask && slots, "Send a team…, a folded row's Ask its lead, the room strip's link");
  at += 5_000;
  v.paint({ chainId: "c1" });
  same(button(el, "Send a team…"), send, "Send a team…");
  same(send.parentNode, head, "the head it stands in");
  same(el.querySelector(".bes-row"), row, "the folded row");
  same(button(row, "Ask its lead"), ask, "its Ask its lead");
  same(button(el, "Each model's limit…"), slots, "the room strip's link");
  ask.dispatch("click");
  send.dispatch("click");
  assert.deepEqual(did, ["open t2", "brief"]);
});
