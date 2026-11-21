// @ts-check
// team_v2_plan §10 O2, the mock of 10-19: a working team's live board on the Teams tab — where its lead is, read off its
// running turn (core/run-work.js `leadNow`), the words of each frame, the lead's state and the board's foot, the room on
// every model (lib/boards.js), the store that follows the working teams' own chats, and the board drawn on the fake DOM
// (views/board.js), in place of a card, in the Teams tab's list (views/beside.js).
// (fails before: yes — a working team showed as a card with "2 at work · 1 waits for a slot" and nothing of its workers)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LEAD_WORDS_CHARS, leadNow } from "../src/core/run-work.js";
import { boardFoot, createBoardStore, crewWord, doingWord, frameOf, framesOf, leadState, numbersOf, orderLines, roomStrip } from "../src/ui/harness/lib/boards.js";
import { createBoards } from "../src/ui/harness/views/board.js";
import { createBesideView } from "../src/ui/harness/views/beside.js";
import { prettyModel } from "../src/ui/harness/lib/families.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** The nodes under `n` wearing a class. @param {any} n @param {string} cls */
const every = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** The first node under `n` wearing a class. @param {any} n @param {string} cls */
const one = (n, cls) => every(n, cls)[0];
/** The button under `n` whose words are these. @param {any} n @param {string} words */
const btn = (n, words) => /** @type {any} */ (buttonsOf(n).find((b) => textOf(b) === words));
/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);
const settle = () => new Promise((r) => setImmediate(r));

const NOW = 1_800_000_000_000;
/** A run's events, numbered as the run log numbers them. @param {any[]} list */
const numbered = (list) => list.map((e, i) => ({ n: i + 1, ...e }));

/** A team chat's worker as its list answers it: a Hunter reading. @param {any} [o] @returns {any} */
const sub = (o = {}) => ({
  id: "sa_1", status: "running", startedAt: NOW - 60_000, model: "m-2", description: "P0 every tool", may: "read",
  team: { key: "bug-hunter", name: "Bug Hunter", role: "hunter", card: "reviewer", seat: "Hunter", place: "reviewer" }, card: { tag: "reviewer", name: "Reviewer" },
  waiting: null,
  progress: { round: 2, tool: { name: "read", args: "src/index.js" }, words: "Reading P0: the first pass over its files.", context: { tokens: 50_000, window: 200_000 }, asking: null, spent: 0.01 },
  exchanges: [{ startedAt: NOW - 60_000, endedAt: null, status: "running" }],
  ...o,
});
const ASKS = { id: "sa_4", startedAt: NOW - 30_000, description: "P3 cards", progress: { round: 3, tool: { name: "bash", args: "npm test" }, words: "Found one.", context: null, asking: { tool: "bash", args: "npm test", command: "npm test", runs: "npm test", reason: "Proving it with a test", offer: { itemId: 3, tool: "bash", shape: "npm test *" } } } };
const ASKS_LEAD = { id: "sa_5", startedAt: NOW - 20_000, description: "P4 two teams", progress: { round: 1, tool: null, words: "", context: null, asking: { to: "lead", n: 1, question: "Which file holds the cards?" } } };
const WAITS = { id: "sa_6", startedAt: NOW - 10_000, description: "P5 the team tool", waiting: { since: NOW - 10_000, words: "m-2, 4 of 4 busy" }, progress: { round: 0, tool: null, words: "", context: null, asking: null } };
const DONE = { id: "sa_2", startedAt: NOW - 50_000, status: "done", description: "P1 the Teams tab", progress: null, exchanges: [{ startedAt: NOW - 50_000, endedAt: NOW - 5_000, rounds: 7, report: "HUNTER REPORT: Found 1 — beside.js:3.", spentUsd: 0.03 }] };
const FAILED = { id: "sa_3", startedAt: NOW - 40_000, status: "failed", description: "P2 slots", progress: null, exchanges: [{ startedAt: NOW - 40_000, endedAt: NOW - 1_000, rounds: 2, error: "the model refused" }] };
/** A team on the side as the beside list answers it. @param {any} [o] @returns {any} */
const team = (o = {}) => ({
  id: "t1", main: "c1", team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "find bugs in the last six phases", firedBy: "you", at: NOW - 2 * 60_000, model: "m-1", title: "",
  state: "working", workers: { running: 3, waiting: 1, total: 6 }, verify: false, notify: true, of: null, verifiedBy: null, result: null, notified: null, cut: false, readOnly: true,
  on: { lead: "m-1", workers: ["m-2"], from: "team", fell: [] }, ...o,
});
const LEAD = { id: "t1", running: true, rounds: 4, words: "All six are out; four at work, two wait for a slot.", calls: [{ name: "wait", subject: "wait", open: true }], startedAt: NOW - 2 * 60_000, usd: 0.13 };

describe("where a team's lead is, off its running turn (leadNow)", () => {
  test("its rounds, its newest words — their end — and its newest round's calls, a call with no end still running", () => {
    const log = numbered([
      { type: "run-start" },
      { type: "round-start", round: 1 },
      { type: "round-text", round: 1, text: "Six slices, one per phase." },
      { type: "tool-start", round: 1, id: "c1", name: "agent", args: "hunter: P0 every tool" },
      { type: "tool-end", round: 1, id: "c1", name: "agent", ok: true, preview: "Launched hunter sa_1" },
      { type: "tool-start", round: 1, id: "c2", name: "agent", args: "hunter: P1 the Teams tab" },
      { type: "tool-end", round: 1, id: "c2", name: "agent", ok: true, preview: "Launched hunter sa_2" },
      { type: "round-start", round: 2 },
      { type: "round-text", round: 2, text: "Both are out." },
      { type: "tool-start", round: 2, id: "c3", name: "wait", args: "120" },
    ]);
    assert.deepEqual(leadNow(log), { rounds: 2, words: "Both are out.", calls: [{ name: "wait", subject: "120", open: true }] });
    // A round begun and silent (its model call in flight): the words and calls are the newest that had any.
    const thinking = leadNow([...log, { n: 11, type: "tool-end", round: 2, id: "c3", name: "wait", ok: true, preview: "" }, { n: 12, type: "round-start", round: 3 }]);
    assert.deepEqual(thinking, { rounds: 3, words: "Both are out.", calls: [{ name: "wait", subject: "120", open: false }] });
    const long = "x".repeat(LEAD_WORDS_CHARS + 50);
    assert.equal(leadNow(numbered([{ type: "run-start" }, { type: "round-start", round: 1 }, { type: "round-text", round: 1, text: `start ${long}` }])).words, `…${long.slice(-LEAD_WORDS_CHARS)}`, "their end");
    assert.deepEqual(leadNow([]), { rounds: 0, words: "", calls: [] });
  });
});

describe("a board's words (lib/boards.js)", () => {
  test("a worker's state in a word; its number among its kind; its frame in each state, in their order", () => {
    assert.deepEqual(["read", "grep", "bash", "edit", "web_fetch", "", "think"].map(doingWord), ["Reading", "Searching", "Running a command", "Editing", "On the web", "Thinking", "At work"]);
    const rows = [sub(ASKS), sub(), sub(DONE), sub(WAITS), sub(FAILED), sub(ASKS_LEAD), sub({ id: "sa_9", startedAt: NOW, card: { name: "Checker" }, team: { role: "checker", place: null } })];
    assert.deepEqual([...numbersOf(rows)], [["sa_1", 1], ["sa_2", 2], ["sa_3", 3], ["sa_4", 4], ["sa_5", 5], ["sa_6", 6], ["sa_9", 1]], "the first launched first, each kind its own count");
    assert.deepEqual(frameOf(sub(), 1, NOW), {
      id: "sa_1", look: { icon: "eye", tone: "blue" }, name: "Hunter", n: 1, state: "Reading", tone: "work", tool: { name: "read", args: "src/index.js" },
      words: "Reading P0: the first pass over its files.", slice: "P0 every tool", rounds: 2, fill: 0.25, wait: "", model: "m-2",
    });
    const f = framesOf(rows, NOW);
    assert.deepEqual(f.map((x) => [x.name, x.n, x.state, x.tone]), [
      ["Hunter", 4, "Asks you", "asks"],
      ["Hunter", 5, "Asked its lead", "lead"],
      ["Checker", 1, "Reading", "work"],
      ["Hunter", 1, "Reading", "work"],
      ["Hunter", 6, "Waits for a slot", "wait"],
      ["Hunter", 2, "Reported", "done"],
      ["Hunter", 3, "Failed", "failed"],
    ], "the ones that ask you first, then by name and number");
    const by = Object.fromEntries(f.map((x) => [x.id, x]));
    assert.equal(by.sa_5.words, 'Asks its lead (ask 1): "Which file holds the cards?"');
    assert.deepEqual([by.sa_6.tool, by.sa_6.words, by.sa_6.wait], [null, "", "m-2, 4 of 4 busy"], "a waiting one does nothing yet: its frame says why");
    assert.deepEqual([by.sa_2.words, by.sa_2.rounds, by.sa_2.fill, by.sa_2.tool], ["HUNTER REPORT: Found 1 — beside.js:3.", 7, null, null], "an ended one: its report, its rounds");
    assert.equal(by.sa_3.words, "the model refused");
    assert.equal(sub({ status: "aborted" }).status, "aborted");
    assert.equal(frameOf(sub({ status: "stopped", progress: null, exchanges: [{}] }), 1, NOW).tone, "stopped");
  });

  test("the lead's state, this round's calls, the board's foot and the room on every model", () => {
    const f = framesOf([sub(), sub({ ...WAITS })], NOW);
    assert.deepEqual([crewWord(f), crewWord(framesOf([sub(), sub({ id: "x", card: { name: "Checker" }, team: { role: "checker" } })], NOW))], ["hunters", "workers"]);
    assert.deepEqual(leadState(team(), LEAD, f), { words: "Waits on its hunters", tone: "work" }, "its wait runs while they work");
    assert.deepEqual(leadState(team(), { ...LEAD, calls: [{ name: "read", subject: "a.js", open: true }] }, f), { words: "Works", tone: "work" });
    assert.deepEqual(leadState(team(), LEAD, framesOf([sub(DONE)], NOW)), { words: "Works", tone: "work" }, "none of them busy: it works on their reports");
    assert.deepEqual(leadState(team(), { ...LEAD, rounds: 0, calls: [] }, []), { words: "Reads this chat", tone: "work" });
    assert.deepEqual(leadState(team({ state: "asking" }), LEAD, f), { words: "Asks you", tone: "asks" });
    assert.deepEqual(leadState(team({ state: "done" }), null, f), { words: "Gave its result", tone: "done" });
    // (fails before: a wait read "wait wait" under This round)
    assert.deepEqual(orderLines({ ...LEAD, calls: [
      { name: "agent", subject: "hunter: P3 cards", open: false },
      { name: "worker", subject: "sa_4", open: true },
      { name: "wait", subject: "wait", open: true },
      { name: "wait", subject: "wait", open: false },
      { name: "read", subject: "a.js", open: false },
      { name: "agent", subject: "", open: false },
    ] }), [
      { words: "Sent hunter: P3 cards", open: false, icon: "arrowRight" },
      { words: "To its worker: sa_4", open: true, icon: "messageSquare" },
      { words: "Waits for word from its workers", open: true, icon: "hourglass" },
      { words: "Waited for word from its workers", open: false, icon: "hourglass" },
      { words: "read a.js", open: false, icon: "wrench" },
      { words: "Sent a worker", open: false, icon: "arrowRight" },
    ]);
    // (fails before: yes — a word to a worker named it by its id, "To its worker: sa_4: stop it")
    assert.deepEqual(orderLines({ ...LEAD, calls: [
      { name: "worker", subject: "sa_4: stop it", open: false },
      { name: "worker", subject: "sa_4", open: true },
      { name: "worker", subject: "sa_44: stop it", open: false },
      { name: "worker", subject: "every worker running now: stop them", open: false },
    ] }, framesOf([sub(), sub(ASKS)], NOW)), [
      { words: "To Hunter 2: stop it", tip: "sa_4", open: false, icon: "messageSquare" },
      { words: "To Hunter 2", tip: "sa_4", open: true, icon: "messageSquare" },
      { words: "To its worker: sa_44: stop it", open: false, icon: "messageSquare" },
      { words: "To its worker: every worker running now: stop them", open: false, icon: "messageSquare" },
    ], "a worker on the board by its frame's name, its id the line's tip; one the board does not hold, as its call says it");
    assert.deepEqual(orderLines(null), []);
    const all7 = framesOf([sub(ASKS), sub(), sub(DONE), sub(WAITS), sub(FAILED), sub(ASKS_LEAD)], NOW);
    assert.deepEqual(boardFoot(all7, LEAD, (n) => `$${n.toFixed(2)}`), {
      pips: ["asks", "lead", "work", "wait", "done", "failed"],
      words: "2 at work · 1 asks you · 1 reported · 1 waits for a slot · 19 rounds · $0.13 so far",
    }, "the lead's rounds and its workers'");
    assert.equal(boardFoot([], null, String).words, "");
    // (fails before: yes — the foot under a lead in its first round said "1 rounds")
    assert.equal(boardFoot([], { ...LEAD, rounds: 1, usd: 0 }, String).words, "1 round");
    assert.equal(boardFoot(framesOf([sub({ progress: { ...sub().progress, round: 1 } })], NOW), { ...LEAD, rounds: 1, usd: 0 }, String).words, "1 at work · 2 rounds");
    assert.deepEqual(roomStrip({ rows: [
      { name: "m-1", running: 1, waiting: 0, cap: 4 },
      { name: "m-2", running: 4, waiting: 2, cap: 4 },
      { name: "m-3", running: 0, waiting: 0, cap: 4 },
      { name: "m-4", running: 2, waiting: 1, cap: 2 },
    ] }), [
      { name: prettyModel("m-2"), words: "4 of 4 busy · 2 wait", full: true, waits: 2 },
      { name: prettyModel("m-4"), words: "2 of 2 busy · 1 waits", full: true, waits: 1 },
      { name: prettyModel("m-1"), words: "1 of 4 busy", full: false, waits: 0 },
    ], "the models with an agent on them, the busiest first");
    assert.deepEqual(roomStrip(null), []);
  });
});

describe("the store that follows the working teams' chats", () => {
  test("a team followed is read at once; its lead again every few seconds while the tab shows, its list every fourth time; the bus keeps it live", async () => {
    /** @type {string[]} */
    const calls = [];
    /** @type {[Function, number][]} */
    const timers = [];
    let shown = true;
    let lead = LEAD;
    let rows = [sub()];
    const store = createBoardStore({
      list: async (tid) => (calls.push(`list ${tid}`), { subagents: rows.map((r) => ({ ...r })) }),
      lead: async (main, tid) => (calls.push(`lead ${main} ${tid}`), lead),
      slots: async () => (calls.push("slots"), { rows: [{ name: "m-2", running: 1, waiting: 0, cap: 4 }] }),
      shown: () => shown,
      later: (fn, ms) => (timers.push([fn, ms]), timers.length),
      clear: () => {},
    });
    let changes = 0;
    store.onChange(() => changes++);
    assert.deepEqual([store.rows("t1"), store.known("t1"), store.lead("t1"), store.room()], [[], false, null, null]);
    store.follow("c1", ["t1"]);
    await settle();
    assert.deepEqual(calls, ["list t1", "lead c1 t1", "slots"]);
    assert.deepEqual([store.rows("t1").map((r) => r.id), store.known("t1"), store.lead("t1")?.rounds, store.room()?.rows?.length], [["sa_1"], true, 4, 1]);
    assert.ok(changes >= 3);
    assert.deepEqual(timers.map(([, ms]) => ms), [4000]);
    // Ticks: the lead each time; the room every second; the list every fourth.
    calls.length = 0;
    for (let i = 0; i < 4; i++) timers[timers.length - 1][0]();
    await settle();
    assert.deepEqual(calls.filter((c) => c.startsWith("lead")).length, 4);
    assert.deepEqual(calls.filter((c) => c === "slots").length, 2);
    assert.deepEqual(calls.filter((c) => c.startsWith("list")).length, 1);
    // Hidden: nothing read, the timer kept.
    calls.length = 0;
    shown = false;
    timers[timers.length - 1][0]();
    await settle();
    assert.deepEqual(calls, []);
    assert.equal(timers.length, 6, "armed again");
    // The same lead read again is no change.
    shown = true;
    const before = changes;
    await store.refresh("t1");
    assert.equal(store.lead("t1")?.rounds, 4);
    lead = { ...LEAD, rounds: 5 };
    await store.refresh("t1");
    assert.equal(store.lead("t1")?.rounds, 5);
    assert.ok(changes > before);
    // A worker's progress off the bus, merged at once; another chat's is not this board's.
    const moved = { ...sub().progress, tool: { name: "bash", args: "npm test" } };
    store.heard({ type: "subagent-progress", chainId: "t1", id: "sa_1", progress: moved });
    assert.equal(store.rows("t1")[0].progress.tool.name, "bash");
    store.heard({ type: "subagent-progress", chainId: "t9", id: "sa_1", progress: null });
    // A worker launched or ended: its list and lead read once a burst settles.
    calls.length = 0;
    rows = [sub(), sub(WAITS)];
    store.heard({ type: "subagent", chainId: "t1" });
    store.heard({ type: "subagent", chainId: "t1" });
    assert.deepEqual(timers.at(-1)?.[1], 300, "a burst is one read");
    const settleFn = /** @type {Function} */ (timers.at(-1)?.[0]);
    settleFn();
    await settle();
    assert.deepEqual(calls, ["list t1", "lead c1 t1"]);
    assert.deepEqual(store.rows("t1").map((r) => r.id), ["sa_1", "sa_6"]);
    // Another chat: its boards start empty; none followed: nothing kept.
    store.follow("c2", []);
    assert.deepEqual([store.rows("t1"), store.lead("t1")], [[], null]);
  });

  // (fails before: yes — the performance audit of 10-29: every worker launched or ended read its team's list and lead
  // again, and a team that started working read its board, the Agents tab shown or not)
  test("while the tab is hidden nothing is read for a move: the board is read once, as the tab shows it", async () => {
    /** @type {string[]} */
    const calls = [];
    /** @type {[Function, number][]} */
    const timers = [];
    let shown = false;
    const store = createBoardStore({
      list: async (tid) => (calls.push(`list ${tid}`), { subagents: [sub()] }),
      lead: async (main, tid) => (calls.push(`lead ${main} ${tid}`), LEAD),
      slots: async () => (calls.push("slots"), { rows: [] }),
      shown: () => shown,
      later: (fn, ms) => (timers.push([fn, ms]), timers.length),
      clear: () => {},
    });
    store.follow("c1", ["t1"]);
    for (let i = 0; i < 3; i++) store.heard({ type: "subagent", chainId: "t1" });
    await settle();
    assert.deepEqual(calls, [], "hidden: a team that starts, and its moves, read nothing");
    assert.equal(timers.filter(([, ms]) => ms === 300).length, 0, "nor wait to");
    assert.deepEqual(store.rows("t1"), [], "asked while hidden, it reads nothing either");
    shown = true;
    assert.deepEqual([store.rows("t1"), store.lead("t1"), store.room()], [[], null, null], "shown: the board as last read, while it is read");
    await settle();
    assert.deepEqual(calls.sort(), ["lead c1 t1", "list t1", "slots"], "read once, as the tab shows it");
    assert.deepEqual(store.rows("t1").map((r) => r.id), ["sa_1"]);
    calls.length = 0;
    store.rows("t1");
    store.lead("t1");
    store.room();
    await settle();
    assert.deepEqual(calls, [], "and once only");
  });
});

describe("a working team's board (views/board.js)", () => {
  /** @param {{ rows?: any[], lead?: any, known?: boolean }} [o] */
  const make = (o = {}) => {
    const rec = { sets: /** @type {any[]} */ ([]), stops: /** @type {string[]} */ ([]), opens: /** @type {string[]} */ ([]), workers: /** @type {any[]} */ ([]), answers: /** @type {any[]} */ ([]), always: /** @type {any[]} */ ([]) };
    const state = { rows: o.rows ?? [sub(ASKS), sub(), sub(DONE), sub(WAITS)], lead: o.lead === undefined ? LEAD : o.lead, known: o.known ?? true };
    const io = {
      rows: () => state.rows,
      known: () => state.known,
      lead: () => state.lead,
      set: (/** @type {string} */ id, /** @type {any} */ p) => { rec.sets.push([id, p]); },
      stop: (/** @type {string} */ id) => { rec.stops.push(id); },
      open: (/** @type {string} */ id) => { rec.opens.push(id); },
      openWorker: (/** @type {string} */ tid, /** @type {string} */ id) => { rec.workers.push([tid, id]); },
      answer: async (/** @type {string} */ tid, /** @type {string} */ id, /** @type {any} */ words) => (rec.answers.push([tid, id, words]), true),
      always: async (/** @type {string} */ tid, /** @type {string} */ id, /** @type {any} */ offer) => (rec.always.push([tid, id, offer.shape]), true),
      now: () => NOW,
    };
    return { b: createBoards(io, { h: fakeH, place, drawIn: fakeDrawIn }), rec, state };
  };

  test("its head, its lead's frame, a frame per worker, the question bar and the foot; each press goes to the host", async () => {
    const { b, rec } = make();
    const el = b.boardOf(team());
    assert.equal(el.attrs["aria-label"], "Bug Hunter team at work on the side of this chat");
    assert.match(textOf(one(el, "bd-head")), /^Bug Hunter\|On the side\|sent by you · 2 min ago\|“find bugs in the last six phases”\|when done:\|Check it with BugHunters first\|Hand its result to your agent\|Open its chat\|Stop$/);
    const lead = one(el, "bd-lead");
    assert.equal(textOf(one(lead, "br-chip-model")), prettyModel("m-1"));
    assert.equal(textOf(one(lead, "bd-lead-state")), "Waits on its hunters");
    assert.equal(textOf(one(lead, "bd-lead-words")), "All six are out; four at work, two wait for a slot.");
    assert.equal(textOf(one(lead, "bd-round")), "This round|Waits for word from its workers");
    assert.match(textOf(one(lead, "bd-lead-foot")), /^4 rounds · \$0\.13\|Open its chat/);
    const frames = every(el, "bd-fr");
    assert.deepEqual(frames.map((f) => [f.attrs["data-id"], f.attrs.class]), [["sa_4", "bd-fr is-asks"], ["sa_1", "bd-fr is-work"], ["sa_6", "bd-fr is-wait"], ["sa_2", "bd-fr is-done"]]);
    assert.match(textOf(frames[1]), /^1\|Hunter 1\|Reading\|read\| src\/index\.js\|Reading P0: the first pass over its files\.\|P0 every tool · 2 rounds$/);
    assert.equal(one(frames[1], "bd-fr-bar").kids[0].attrs.style, "width:25%");
    assert.equal(textOf(frames[2]), "4|Hunter 4|Waits for a slot|m-2, 4 of 4 busy|Its slice: P5 the team tool|starts by itself once a slot frees");
    assert.match(textOf(frames[3]), /Hunter 2\|Reported\|HUNTER REPORT/);
    const ask = one(el, "bd-ask");
    assert.equal(ask.attrs["aria-label"], "Hunter 3 asks you", "numbered by when each started");
    assert.match(textOf(ask), /^3\|Hunter 3 asks you:\| may it run\|npm test\|Proving it with a test\|Deny\|Always allow\|Allow$/);
    assert.equal(textOf(one(el, "bd-foot-words")), "1 at work · 1 asks you · 1 reported · 1 waits for a slot · 16 rounds · $0.13 so far");
    assert.deepEqual(every(one(el, "bd-pips"), "is-asks").length, 1);
    // Presses.
    btn(ask, "Allow").attrs.onclick();
    await settle();
    assert.deepEqual(rec.answers, [["t1", "sa_4", { allow: true, words: "" }]], "answered in its team's chat");
    frames[1].attrs.onclick();
    assert.deepEqual(rec.workers, [["t1", "sa_1"]], "a frame opens its worker's thread");
    all(el, (x) => x.attrs?.role === "switch" && x.attrs["aria-label"] === "Check it with BugHunters first")[0].attrs.onclick();
    assert.deepEqual(rec.sets, [["t1", { verify: true }]]);
    btn(one(el, "bd-head"), "Open its chat").attrs.onclick();
    btn(one(lead, "bd-lead-foot"), "Open its chat").attrs.onclick();
    // (fails before: yes — the owner's word of 10-22: a worker's frame opened its thread, its lead's face nothing)
    const face = one(lead, "bd-lead-top");
    assert.deepEqual([face.tag, face.attrs.title], ["button", "Open its chat: its lead's conversation, with every worker it sent"]);
    face.attrs.onclick();
    btn(el, "Stop").attrs.onclick();
    assert.deepEqual([rec.opens, rec.stops], [["t1", "t1", "t1"], ["t1"]]);
  });

  test("in the team's own chat its lead's face is no button: that chat is its conversation already", () => {
    const { rec } = make();
    const b = createBoards({ rows: () => [], known: () => true, lead: () => LEAD, set: () => {}, stop: () => {}, open: (/** @type {string} */ id) => { rec.opens.push(id); }, here: () => true, openWorker: () => {}, answer: async () => true, always: async () => true, now: () => NOW }, { h: fakeH, place, drawIn: fakeDrawIn });
    const face = one(one(b.boardOf(team()), "bd-lead"), "bd-lead-top");
    assert.deepEqual([face.tag, face.attrs.onclick], ["div", undefined]);
  });

  // (fails before: yes — the bug hunt of 5d57bbe8a: a worker whose agent offers only to always allow its call showed
  // the project's Always allow and a plain Allow on the board, "Run it, this once")
  test("a worker whose agent offers only to always allow: Allow always on its question bar, no rule of the project's offered", async () => {
    const asks = { ...ASKS, progress: { ...ASKS.progress, asking: { ...ASKS.progress.asking, always: true } } };
    const { b, rec } = make({ rows: [sub(asks), sub()] });
    const ask = one(b.boardOf(team()), "bd-ask");
    assert.deepEqual(buttonsOf(ask).map((x) => textOf(x)), ["Deny", "Allow always"]);
    btn(ask, "Allow always").attrs.onclick();
    await settle();
    assert.deepEqual([rec.answers, rec.always], [[["t1", "sa_4", { allow: true, words: "" }]], []], "a yes, never the project's rule");
  });

  test("Always allow; painted again, in place, only when what it says changes; its question bar kept while the same call waits; no workers yet", async () => {
    const { b, rec, state } = make();
    const first = b.boardOf(team());
    assert.equal(b.boardOf(team()), first, "nothing moved: the same board");
    const ask = one(first, "bd-ask");
    btn(ask, "Always allow").attrs.onclick();
    await settle();
    assert.deepEqual(rec.always, [["t1", "sa_4", "npm test *"]]);
    state.lead = { ...LEAD, rounds: 5 };
    const second = b.boardOf(team());
    // Drawn again in place (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost): the board that
    // stood, saying the newest.
    assert.equal(second, first, "what it says moved: the same board, drawn again");
    assert.match(textOf(one(second, "bd-lead-foot")), /^5 rounds/);
    assert.equal(one(second, "bd-ask"), ask, "the same call waits: its bar (and a half-typed why) kept");
    state.rows = [sub()];
    assert.equal(one(b.boardOf(team()), "bd-ask"), undefined, "answered: its bar goes");
    state.rows = [];
    state.known = false;
    assert.equal(textOf(one(b.boardOf(team()), "bd-none")), "Reading its workers…");
    state.known = true;
    state.lead = { ...LEAD, rounds: 0, calls: [], words: "" };
    const none = b.boardOf(team());
    assert.equal(textOf(one(none, "bd-none")), "Its lead has sent no worker yet: they show here as it does.");
    assert.equal(textOf(one(none, "bd-lead-state")), "Reads this chat");
    assert.equal(one(none, "bd-foot-hint"), undefined);
    // BugHunters' own board has no switch for a check of itself.
    const v = b.boardOf(team({ id: "t2", team: { key: "bughunters", name: "BugHunters" }, checked: true }));
    assert.match(textOf(one(v, "bd-switches")), /^when done:\|Hand its result to your agent$/);
  });
});

describe("the Teams tab: a board while a team works, a card once it ended, the room under them", () => {
  test("working and asking teams as boards, a done one as its card; the room on every model while one works, and Each model's limit…", () => {
    let rows = [team(), team({ id: "t2", state: "done", workers: { running: 0, waiting: 0, total: 6 }, result: { n: 1, text: "Found 6.", more: false, at: NOW } })];
    let slotsOpened = 0;
    const board = {
      rows: () => [sub()], known: () => true, lead: () => LEAD,
      set: () => {}, stop: () => {}, open: () => {}, openWorker: () => {}, answer: async () => true, always: async () => true,
    };
    const v = createBesideView(/** @type {any} */ ({
      rows: () => rows, brief: () => {}, set: () => {}, notify: () => {}, verify: () => {}, stop: () => {}, open: () => {}, resume: () => {},
      board, room: () => ({ rows: [{ name: "m-2", running: 4, waiting: 2, cap: 4 }] }), openSlots: () => { slotsOpened++; }, now: () => NOW,
    }), { h: fakeH, place, drawIn: fakeDrawIn });
    v.paint({ chainId: "c1" });
    assert.deepEqual(all(v.el, (x) => x.tag === "section" && String(x.attrs?.class || "").startsWith("bd ")).map((x) => x.attrs["data-board"]), ["t1"]);
    assert.ok(all(v.el, (x) => x.attrs?.["data-beside"] === "t2").length, "the ended one is its card");
    const room = one(v.el, "bes-room");
    assert.match(textOf(room), new RegExp(`${prettyModel("m-2")}\\| 4 of 4 busy · 2 wait\\|Each model's limit…`));
    btn(room, "Each model's limit…").attrs.onclick();
    assert.equal(slotsOpened, 1);
    rows = [rows[1]];
    v.paint({ chainId: "c1" });
    assert.equal(all(v.el, (x) => String(x.attrs?.class || "").startsWith("bd ")).length, 0);
    assert.equal(one(v.el, "bes-room"), undefined, "none works: no room strip");
  });
});
