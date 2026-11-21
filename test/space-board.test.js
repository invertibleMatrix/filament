// @ts-check
// proposal_ux §4.14, U5 phase 8 v1 to v3; HarnessV4_Space_Plan S1: the parts of a project's Space the page draws under
// its lanes. The pure reading of the Space (lib/space-view.js) — a card's age, the board's columns, the lane a task or
// a line is in, what each lane changes and the files two lanes both change (Overlaps, git alone), the merge order,
// Where you left off —, then each panel on the stub document: the board with its editor in place and its one line when
// empty, What happened and the person's note, the Tell the chats card (only Tell them sends), and what each lane
// changes. (fails before: yes — the Space had lanes alone; S1: claims, Sync…, a logbook that did not fill itself)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { gate, until } from "./helpers/wait.js";
import {
  DONE_SHOWN,
  ageWords,
  boardColumns,
  happenedTag,
  laneNews,
  laneOfTask,
  laneTask,
  leftOff,
  lookWords,
  mergeOrder,
  overlapWords,
  ownersOf,
  pathLabel,
  placeKey,
  syncBetween,
  syncLaneWords,
  whenWords,
} from "../src/ui/harness/lib/space-view.js";
import * as page from "../src/ui/harness/lib/space-view.js";
import * as server from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { boardPanel } from "../src/ui/harness/space/board.js";
import { logbookPanel } from "../src/ui/harness/space/logbook.js";
import { syncCard } from "../src/ui/harness/space/sync-card.js";
import { ownersPanel } from "../src/ui/harness/space/owners.js";
import { syncRow } from "../src/ui/harness/conversation/turn.js";
import { SYNCED_WORDS } from "../src/ui/harness/lib/labels.js";

const g = /** @type {any} */ (globalThis);
const HOUR = 3_600_000;
/** Wednesday 14 October 2026, 11:00 here; its week began Monday the 12th. */
const NOW = new Date(2026, 9, 14, 11, 0).getTime();
const MON = new Date(2026, 9, 12).getTime();
const now = () => NOW;

/** @typedef {import("../src/ui/harness/lib/space-view.js").SpaceTask} SpaceTask @typedef {import("../src/ui/harness/lib/space-view.js").LaneRef} LaneRef */
/** @param {Partial<SpaceTask>} t @returns {SpaceTask} */
const task = (t) => ({ id: "t", title: "", line: "", column: "planned", parked: false, chain: null, place: null, by: { kind: "you" }, at: NOW - HOUR, movedAt: NOW - HOUR, startedAt: null, doneAt: null, ...t });
/** @type {LaneRef} */
const MAIN = { path: "H:\\filament", chip: "main", main: true, chains: ["c1"] };
/** @type {LaneRef} */
const UX = { path: "H:/filament-ux/", chip: "ux-overhaul", main: false, chains: ["c2", "c3"] };
/** @type {LaneRef} */
const DOCS = { path: "H:/filament-docs", chip: "docs", main: false, chains: ["c4"] };
const NAMES = /** @type {Record<string, string>} */ ({ c1: "opus55", c2: "HarnessV3_Impl", c3: "a side chat", c4: "Docs" });
const nameOf = (/** @type {string} */ c) => NAMES[c] || "an untitled chat";
/** A place's changed files, as the files read answers them. @param {string} path @param {string[]} files @param {any} [o] */
const filesOf = (path, files, o = {}) => ({ path, ok: true, error: null, branch: "b", base: "main", ahead: 2, commits: 2, files: files.map((f) => ({ path: f, committed: true, uncommitted: false })), more: 0, ...o });

describe("the Space as the page reads it", () => {
  test("a card's age, and a moment in the logbook's margin: today's time, this week's day, else its date", () => {
    assert.deepEqual([ageWords(NOW - 20_000, NOW), ageWords(NOW - 40 * 60_000, NOW), ageWords(NOW - 2 * HOUR, NOW), ageWords(NOW - 12 * 24 * HOUR, NOW)], ["now", "40m", "2h", "12d"]);
    assert.equal(ageWords(NOW + HOUR, NOW), "now", "a moment ahead of this clock");
    assert.equal(ageWords(MON + 10 * HOUR, NOW, { day: true }), "Mon", "a done task of this week, by its day");
    assert.equal(ageWords(NOW - 2 * HOUR, NOW, { day: true }), "2h", "today's by its age");
    assert.deepEqual([whenWords(NOW - 2 * HOUR, NOW), whenWords(MON + HOUR, NOW), whenWords(MON - 3 * 24 * HOUR, NOW)], ["09:00", "Mon", "9 Oct"]);
  });

  test("the board's columns: Planned's open before its parked, Doing and Waits the newest move first, Done this week's newest first", () => {
    const cols = boardColumns(
      [
        task({ id: "p1", parked: true, at: NOW }),
        task({ id: "p2", at: NOW - 2 * HOUR }),
        task({ id: "d1", column: "doing", movedAt: NOW - 3 * HOUR }),
        task({ id: "d2", column: "doing", movedAt: NOW - HOUR }),
        task({ id: "w1", column: "waits" }),
        task({ id: "x1", column: "done", doneAt: MON + HOUR }),
        task({ id: "x2", column: "done", doneAt: NOW - HOUR }),
        task({ id: "x0", column: "done", doneAt: MON - HOUR }),
      ],
      NOW,
    );
    assert.deepEqual(cols.map((c) => [c.head, c.tasks.map((t) => t.id)]), [
      ["Planned", ["p2", "p1"]],
      ["Doing", ["d2", "d1"]],
      ["Waits for you", ["w1"]],
      ["Done this week", ["x2", "x1"]],
    ]);
  });

  // (fails before: yes — the owner's of 11-02, "the kanban inside space should be more powerful": a column ordered its
  // tasks by time alone, so none had a place the person gave it)
  test("where the person put a task stands in its column — Planned's open and parked each, Doing, Waits —; one made or moved in after comes in on top; Done by when each was done", () => {
    // Ranked two hours ago (core/space.js rankTasks): the ranks count up from that moment below zero.
    const T = NOW - 2 * HOUR;
    const cols = boardColumns(
      [
        task({ id: "a", at: NOW - 5 * HOUR, rank: 1 - T }),
        task({ id: "b", at: NOW - 6 * HOUR, rank: -T }),
        task({ id: "c", at: NOW - HOUR }),
        task({ id: "e", at: NOW - 20 * HOUR }),
        task({ id: "p", parked: true, at: NOW, rank: -T }),
        task({ id: "q", parked: true, at: NOW - 30 * HOUR }),
        task({ id: "d1", column: "doing", movedAt: NOW - 5 * HOUR, rank: 1 - T }),
        task({ id: "d2", column: "doing", movedAt: NOW - 6 * HOUR, rank: -T }),
        task({ id: "d3", column: "doing", movedAt: NOW - HOUR / 2 }),
        task({ id: "w1", column: "waits", movedAt: NOW - HOUR }),
        task({ id: "w2", column: "waits", movedAt: NOW - 3 * HOUR, rank: -T }),
        task({ id: "x1", column: "done", doneAt: NOW - HOUR, rank: 5 }),
        task({ id: "x2", column: "done", doneAt: NOW - 2 * HOUR, rank: -T }),
      ],
      NOW,
    );
    assert.deepEqual(cols.map((c) => [c.head, c.tasks.map((t) => t.id)]), [
      ["Planned", ["c", "b", "a", "e", "p", "q"]],
      ["Doing", ["d3", "d2", "d1"]],
      ["Waits for you", ["w1", "w2"]],
      ["Done this week", ["x1", "x2"]],
    ]);
  });

  test("which lane: a task's chat's, else the folder it is planned for; a lane's newest line, its task, the sync two lanes had", () => {
    const lanes = [MAIN, UX];
    assert.equal(laneOfTask(task({ chain: "c3" }), lanes), UX);
    assert.equal(laneOfTask(task({ place: "h:\\FILAMENT-ux" }), lanes), UX, "a folder by any spelling of it");
    assert.equal(laneOfTask(task({ chain: "c9" }), lanes), null);
    assert.equal(placeKey("H:\\filament-ux\\"), "h:/filament-ux");
    const log = [
      { id: "e1", at: 1, by: { kind: "agent", chain: "c2" }, text: "older", task: null },
      { id: "e2", at: 2, by: { kind: "agent", chain: "c3" }, text: "newest of ux", task: null },
      { id: "e3", at: 3, by: { kind: "you" }, text: "mine", task: null },
    ];
    assert.equal(laneNews(log, UX)?.text, "newest of ux");
    assert.equal(laneNews(log, MAIN), null, "the person's line is no lane's");
    const tasks = [task({ id: "a", chain: "c2", column: "waits", movedAt: 9 }), task({ id: "b", chain: "c3", column: "doing", movedAt: 1 }), task({ id: "c", chain: "c2", column: "done" })];
    assert.equal(laneTask(tasks, UX)?.id, "b", "Doing before Waits");
    assert.equal(laneTask(tasks.slice(0, 1), UX)?.id, "a");
    assert.equal(laneTask(tasks, MAIN), null);
    const syncs = [
      { id: "s1", at: 1, also: "", lanes: [{ chain: "c1", when: "now", state: "sent" }, { chain: "c2", when: "now", state: "sent" }] },
      { id: "s2", at: 2, also: "", lanes: [{ chain: "c1", when: "now", state: "sent" }, { chain: "c3", when: "now", state: "refused" }] },
    ];
    assert.equal(syncBetween(syncs, MAIN, UX)?.id, "s1", "a refused lane was not reached");
    assert.equal(syncBetween(syncs, MAIN, DOCS), null);
    assert.deepEqual(
      [syncLaneWords({ state: "sent", when: "now" }, false), syncLaneWords({ state: "steered", when: "now" }, false), syncLaneWords({ state: "waiting", when: "after" }, true), syncLaneWords({ state: "refused", when: "now", error: "the chat is archived" }, false)],
      ["sent as a turn of its own", "sent into its running turn", "waits for its turn to end", "not sent: the chat is archived"],
    );
  });

  // (fails before: yes — the bug hunt of 11-02 on the board's drag: a lane's Has: was its newest move in Doing, while the
  // board shows each column as the person put it, so a reorder there left Has: on the card below)
  test("a lane's Has: is the card the board shows on top of its chats' in Doing — where the person put it —, else in Waits", () => {
    // Ranked an hour ago (core/space.js rankTasks): A over B, though B moved in after.
    const T = NOW - HOUR;
    const tasks = [
      task({ id: "a", chain: "c2", column: "doing", movedAt: NOW - 3 * HOUR, rank: -T }),
      task({ id: "b", chain: "c3", column: "doing", movedAt: NOW - 2 * HOUR, rank: 1 - T }),
      task({ id: "w1", chain: "c2", column: "waits", movedAt: NOW - 3 * HOUR, rank: -T }),
      task({ id: "w2", chain: "c3", column: "waits", movedAt: NOW - 1.5 * HOUR }),
      task({ id: "w3", chain: "c2", column: "waits", movedAt: NOW - 2 * HOUR }),
    ];
    assert.deepEqual(boardColumns(tasks, NOW).slice(1, 3).map((c) => c.tasks.map((t) => t.id)), [["a", "b"], ["w1", "w2", "w3"]], "the board");
    assert.equal(laneTask(tasks, UX)?.id, "a");
    assert.equal(laneTask(tasks.filter((t) => t.column === "waits"), UX)?.id, "w1", "Waits as the board shows it");
    assert.equal(laneTask(tasks.filter((t) => t.id !== "w1" && t.column === "waits"), UX)?.id, "w2", "none placed: the newest move on top");
  });

  // (fails before: yes — the same hunt: an agent's read of the board, a sync's message and the week's page said a column's
  // tasks as the Space's file holds them, while the board shows them as the person put them)
  test("the board's order and a move's place are the server's, word for word: the layers keep the page and the server apart, so each has its own", () => {
    for (const name of /** @type {const} */ (["boardOrder", "placedAmong"])) {
      assert.equal(typeof page[name], "function", `the page's ${name}`);
      assert.equal(String(page[name]), String(server[name]), name);
    }
  });

  // (fails before: yes — the same hunt: a second drop before the first's answer was drawn was put among the cards as they
  // stood before the first; the board draws a move at once, as the Space will make it, so the next builds on it)
  test("a move drawn before the Space answers is the one the Space makes: its column, its times, the places of those it stands among — one moved in since the board was drawn kept where it stood", () => {
    const clock = { at: NOW - 5 * HOUR };
    const store = createSpaceStore({ dir: null, now: () => clock.at });
    for (const [title, column] of [["A", "planned"], ["B", "planned"], ["C", "planned"], ["W", "doing"], ["X", "doing"]]) {
      store.addTask("p1", { title, column }, { kind: "you" });
      clock.at += HOUR / 2;
    }
    /** @type {{ id: string, column: SpaceTask["column"], order: string[] | null }[]} */
    const moves = [
      { id: "t1", column: "planned", order: ["t1", "t3", "t2"] },
      { id: "t2", column: "doing", order: ["t5", "t2", "t4"] },
      { id: "t1", column: "doing", order: null },
      // Drawn before A moved in: A stays on top.
      { id: "t4", column: "doing", order: ["t4", "t5", "t2"] },
      { id: "t3", column: "done", order: null },
      { id: "t5", column: "planned", order: ["t5"] },
    ];
    let drawn = structuredClone(store.get("p1").tasks);
    const byId = (/** @type {SpaceTask[]} */ ts) => [...ts].sort((a, b) => a.id.localeCompare(b.id));
    for (const m of moves) {
      clock.at += 60_000;
      store.changeTask("p1", m.id, { column: m.column, ...(m.order ? { order: m.order } : {}) });
      drawn = page.movedTasks(drawn, { ...m, at: clock.at });
      const served = structuredClone(store.get("p1").tasks);
      const shown = (/** @type {SpaceTask[]} */ ts) => boardColumns(ts, clock.at).map((c) => c.tasks.map((t) => t.id));
      assert.deepEqual(shown(drawn), shown(served), `${m.id} to ${m.column}: the columns`);
      assert.deepEqual(byId(drawn), byId(served), `${m.id} to ${m.column}: each task`);
    }
    assert.deepEqual(boardColumns(drawn, clock.at).slice(0, 2).map((c) => c.tasks.map((t) => t.id)), [["t5"], ["t1", "t4", "t2"]]);
    assert.deepEqual(page.movedTasks(drawn, { id: "t9", column: "doing", order: ["t9"], at: clock.at }), drawn, "a task gone since: no move");
  });

  test("what each lane changes and the files two lanes both change, from git alone; Overlaps' words; a path as a chip says it", () => {
    assert.deepEqual([pathLabel("src/ui/harness/sidebar.js"), pathLabel("src/ui/panes/*"), pathLabel("docs/")], ["sidebar.js", "panes/*", "docs"]);
    const files = new Map([
      [placeKey(MAIN.path), filesOf(MAIN.path, ["src/ui/sidebar.js", "src/ui/harness.css", "src/ui/panes/a.js"])],
      [placeKey(UX.path), filesOf(UX.path, ["src/ui/settings/x.js", "src/ui/harness.css"])],
    ]);
    const o = ownersOf([MAIN, UX], files);
    assert.deepEqual(o.own.map((x) => [x.lane.chip, x.paths]), [
      ["main", ["src/ui/sidebar.js", "src/ui/panes/a.js"]],
      ["ux-overhaul", ["src/ui/settings/x.js"]],
    ], "a lane's own list leaves out what it shares");
    assert.deepEqual(o.shared.map((s) => [s.path, s.lanes.map((l) => l.chip)]), [["src/ui/harness.css", ["main", "ux-overhaul"]]]);
    assert.deepEqual(overlapWords(o.shared), { head: "Overlap", line: "main and ux-overhaul both change src/ui/harness.css." });
    files.set(placeKey(DOCS.path), filesOf(DOCS.path, ["src/ui/harness.css", "a.js", "b.js", "c.js"]));
    files.set(placeKey(UX.path), filesOf(UX.path, ["a.js", "b.js", "c.js", "src/ui/harness.css"]));
    const many = ownersOf([MAIN, UX, DOCS], files).shared;
    assert.deepEqual(many.map((s) => [s.path, s.lanes.length]), [["a.js", 2], ["b.js", 2], ["c.js", 2], ["src/ui/harness.css", 3]]);
    // One of them three lanes change: "or more"; one file three lanes change: not "both".
    // (fails before: yes — found by the Hunter on S1: the banner said "two lanes" and "3 lanes both change")
    assert.deepEqual(overlapWords(many), { head: "Overlaps", line: "4 files are changed by two lanes or more: a.js, b.js, c.js and 1 more." });
    assert.deepEqual(overlapWords(many.slice(0, 3)), { head: "Overlaps", line: "3 files are changed by two lanes: a.js, b.js, c.js." });
    assert.deepEqual(overlapWords(many.slice(3)), { head: "Overlap", line: "3 lanes change src/ui/harness.css." });
    assert.equal(overlapWords([]), null, "none: no banner");
    assert.deepEqual(ownersOf([MAIN], new Map()), { own: [], shared: [] });
  });

  test("Where you left off: since your last look, not your own lines, the newest first; after 8 h, where work stood; else nothing", () => {
    const line = (/** @type {string} */ id, /** @type {number} */ at, /** @type {any} */ by, text = id) => ({ id, at, by, text, task: null });
    const log = [
      line("e1", NOW - 5 * HOUR, { kind: "agent", chain: "c1" }),
      line("e2", NOW - 3 * HOUR, { kind: "you" }),
      line("e3", NOW - 2 * HOUR, { kind: "filament", chain: "c2" }),
      line("e4", NOW - HOUR, { kind: "sync" }),
      line("e5", NOW - 50 * 60_000, { kind: "filament" }),
      line("e6", NOW - 40 * 60_000, { kind: "keeper" }),
      line("e7", NOW - 30 * 60_000, { kind: "agent", chain: "c4" }),
    ];
    const asks = [{ chain: "c2", name: "HarnessV3_Impl", fact: "asks: which branch?" }];
    const newest = { chain: "c1", name: "opus55", chip: "main", facts: "2 files changed, not committed" };
    assert.equal(leftOff({ last: null, now: NOW, log, asks, newest }), null, "a first look: nothing to compare with");
    const c = leftOff({ last: NOW - 4 * HOUR, now: NOW, log, asks, newest });
    assert.deepEqual(c && [c.lines.map((e) => e.id), c.more, c.stood, c.go], [["e7", "e5", "e4"], 1, null, "c2"], "the asking chat first");
    assert.equal(leftOff({ last: NOW - 20 * 60_000, now: NOW, log, asks, newest }), null, "nothing since, and not long away");
    const away = leftOff({ last: NOW - 9 * HOUR, now: NOW, log: [], asks: [], newest });
    assert.deepEqual(away && [away.lines, away.stood, away.go], [[], newest, "c1"], "away 8 h and more: where work stood");
    assert.equal(leftOff({ last: NOW - 9 * HOUR, now: NOW, log: [], asks: [], newest: null }), null);
    const ownOnly = leftOff({ last: NOW - 4 * HOUR, now: NOW, log: [line("x", NOW - HOUR, { kind: "you" })], asks: [], newest });
    assert.equal(ownOnly, null, "your own note is no news to you");
    assert.deepEqual([lookWords(NOW - HOUR, NOW), lookWords(NOW - 20 * HOUR, NOW), lookWords(MON - 2 * HOUR, NOW), lookWords(NOW - 9 * 24 * HOUR, NOW)], ["today 10:00", "yesterday 15:00", "Sun 22:00", "5 Oct 11:00"]);
    assert.deepEqual(["you", "agent", "filament", "sync", "keeper"].map((kind) => happenedTag(line("x", 1, { kind }))), ["note", "agent", "filament", "told", "week"]);
  });

  test("the merge order: worktrees with commits, those meeting no other lane first, then fewest meetings, fewest commits", () => {
    const files = new Map([
      [placeKey(MAIN.path), filesOf(MAIN.path, ["a.js"])],
      [placeKey(UX.path), filesOf(UX.path, ["a.js", "b.js"], { ahead: 1 })],
      [placeKey(DOCS.path), filesOf(DOCS.path, ["docs/guide.md"], { ahead: 5 })],
    ]);
    const order = mergeOrder([MAIN, UX, DOCS], files);
    assert.deepEqual(order.map((m) => [m.lane.chip, m.commits, m.base, m.meets.map((x) => `${x.path}@${x.lane.chip}`)]), [
      ["docs", 5, "main", []],
      ["ux-overhaul", 1, "main", ["a.js@main"]],
    ], "the main folder merges nothing");
    assert.deepEqual(mergeOrder([UX], new Map([[placeKey(UX.path), filesOf(UX.path, ["a.js"], { ahead: 0, commits: 0 })]])), [], "nothing ahead");
  });
});

describe("the panels", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    HTMLElement: class {},
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    g.window.setTimeout = () => 0;
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
  });
  /** @param {any} root @param {string} sel */
  const texts = (root, sel) => root.querySelectorAll(sel).map((/** @type {any} */ e) => e.textContent);
  /** @param {any} root @param {string} label */
  const button = (root, label) => {
    const b = root.querySelectorAll("button").find((/** @type {any} */ x) => x.textContent === label);
    assert.ok(b, `the button ${label}`);
    return b;
  };

  /**
   * The board on the page, with what it did. `answer`: each write's, or how it answers one; `attached`: what an attach
   * answers. @param {SpaceTask[]} tasks
   * @param {{ asks?: string[], answer?: any, lanes?: LaneRef[], plain?: boolean, attached?: (t: SpaceTask, files: File[]) => any, moved?: () => void, report?: (err: unknown) => void }} [o]
   */
  const mountBoard = (tasks, o = {}) => {
    const did = { writes: /** @type {any[]} */ ([]), opened: /** @type {string[]} */ ([]), started: /** @type {string[]} */ ([]), repro: /** @type {string[]} */ ([]), sent: /** @type {string[][]} */ ([]), fed: /** @type {string[]} */ ([]), attached: /** @type {any[]} */ ([]), startedWith: /** @type {SpaceTask[]} */ ([]) };
    const b = boardPanel({
      lanes: () => o.lanes || [MAIN, UX],
      nameOf,
      asks: (c) => (o.asks || []).includes(c),
      openChat: (c) => void did.opened.push(c),
      write: async (method, path, body) => (did.writes.push([method, path, body]), typeof o.answer === "function" ? o.answer(method, path, body) : o.answer === undefined ? { ok: true } : o.answer),
      startOn: (t) => void (did.started.push(t.id), did.startedWith.push(t)),
      sendTo: (t, c) => void did.sent.push([t.id, c]),
      reproduce: (t) => void did.repro.push(t.id),
      fedMenu: (f) => void did.fed.push(f.key),
      attach: async (t, files) => (did.attached.push([t.id, files.map((f) => f.name)]), o.attached ? o.attached(t, files) : null),
      fileUrl: (t, f) => `/f/${t.id}/${f.id}`,
      plain: () => o.plain === true,
      ...(o.moved ? { moved: o.moved } : {}),
      ...(o.report ? { report: o.report } : {}),
      now,
    });
    doc.document.body.append(b.el);
    b.paint(tasks);
    return { b, did };
  };
  /** Each card as it reads: its title, its line, its foot. @param {any} el */
  const cards = (el) => el.querySelectorAll("article.sb-card").map((/** @type {any} */ a) => [a.getAttribute("data-task"), a.querySelector(".sb-t").textContent, a.querySelector(".sb-d")?.textContent || "", a.querySelector(".sb-f").textContent]);

  test("the board: each column's head and count, its cards — line, parked, lane, chat, age — and the way to a chat that asks", () => {
    const { b, did } = mountBoard([
      task({ id: "t1", title: "The agent's browser pane", line: "Watch it, take over.", parked: true, at: NOW - 12 * 24 * HOUR, movedAt: NOW - 12 * 24 * HOUR }),
      task({ id: "t2", title: "The left bar", line: "Rows say why.", column: "doing", chain: "c1", movedAt: NOW - 2 * HOUR }),
      task({ id: "t3", title: "Delete 3 old snapshots?", line: "Builder needs your yes.", column: "waits", chain: "c2", movedAt: NOW - 40 * 60_000 }),
      task({ id: "t4", title: "Review: Overview widgets", column: "waits", chain: "c1", movedAt: NOW - HOUR }),
      task({ id: "t5", title: "Planned for docs", place: "H:/filament-ux", movedAt: NOW - HOUR }),
    ], { asks: ["c2"] });
    assert.deepEqual(texts(b.el, ".sb-head-name"), ["Planned", "Doing", "Waits for you", "Done this week"]);
    assert.deepEqual(texts(b.el, ".sb-count"), ["2", "1", "2", "0"]);
    assert.deepEqual(cards(b.el), [
      ["t5", "Planned for docs", "", "ux-overhaul1h"],
      ["t1", "The agent's browser pane", "Watch it, take over.", "parked12d"],
      ["t2", "The left bar", "Rows say why.", "mainopus552h"],
      ["t3", "Delete 3 old snapshots?", "Builder needs your yes.", "ux-overhaulOpen the ask ›"],
      ["t4", "Review: Overview widgets", "", "mainOpen ›"],
    ]);
    assert.deepEqual(texts(b.el, ".sb-col.is-done p"), [], "an empty column says nothing: its head's 0 does");
    assert.deepEqual(b.el.querySelectorAll("article.sb-card.is-ask").map((/** @type {any} */ a) => a.getAttribute("data-task")), ["t3", "t4"], "what waits for you, marked");
    assert.equal(b.el.getAttribute("class"), "sb-board", "tasks to show: the columns");
    b.el.querySelector('[data-task="t3"] .sb-go').dispatch("click");
    b.el.querySelector('[data-task="t4"] .sb-go').dispatch("click");
    assert.deepEqual([did.opened, did.writes], [["c2", "c1"], []], "they open the chats; nothing is written");
  });

  test("a card opened in place: its words, column and parked saved; Escape and Cancel change nothing; Remove asks once more", async () => {
    const { b, did } = mountBoard([task({ id: "t1", title: "Docs", line: "the guide", parked: true })]);
    b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
    const ed = b.el.querySelector("form.sb-editor");
    assert.equal(ed.getAttribute("data-task"), "t1");
    assert.deepEqual([ed.querySelector("input.sb-in").getAttribute("value"), ed.querySelector("textarea").value, ed.querySelector("input[type='checkbox']").hasAttribute("checked")], ["Docs", "the guide", true]);
    // Another change to the Space while the person types: the open card is not drawn over.
    b.paint([task({ id: "t1", title: "Docs, renamed elsewhere" }), task({ id: "t2", title: "New" })]);
    assert.equal(b.el.querySelector("form.sb-editor"), ed);
    ed.dispatch("keydown", { key: "Escape" });
    assert.equal(b.el.querySelector("form.sb-editor"), null);
    assert.deepEqual(cards(b.el).map((c) => c[1]), ["Docs, renamed elsewhere", "New"], "closed: drawn as the Space now is");
    b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
    const form = b.el.querySelector("form.sb-editor");
    form.querySelector("input.sb-in").value = "Docs page";
    form.querySelector("textarea").value = "with pictures";
    form.querySelector("select").value = "doing";
    form.querySelector("input[type='checkbox']").checked = false;
    form.dispatch("submit");
    await until(() => did.writes.length === 1, "the save");
    assert.deepEqual(did.writes[0], ["PATCH", "/tasks/t1", { title: "Docs page", line: "with pictures", column: "doing", parked: false }]);
    await until(() => !b.el.querySelector("form.sb-editor"), "closed once saved");
    // Remove: once asks, twice removes.
    b.el.querySelector('[data-task="t2"] .sb-face').dispatch("click");
    const remove = b.el.querySelector(".sb-remove");
    remove.dispatch("click");
    assert.deepEqual([remove.textContent, did.writes.length], ["Remove for good?", 1]);
    remove.dispatch("click");
    await until(() => did.writes.length === 2, "the remove");
    assert.deepEqual(did.writes[1], ["DELETE", "/tasks/t2", undefined]);
  });

  test("+ adds on Planned, a title needed first; a task no chat has starts a chat — the Start filled, nothing written", async () => {
    const { b, did } = mountBoard([task({ id: "t1", title: "Docs" }), task({ id: "t2", title: "Mine", column: "doing", chain: "c1" })]);
    b.el.querySelector(".sb-add").dispatch("click");
    const form = b.el.querySelector("form[data-new]");
    form.dispatch("submit");
    assert.deepEqual([form.querySelector(".sb-said").textContent, did.writes], ["A task needs a title", []]);
    form.querySelector("input.sb-in").value = "Fix the redirect";
    form.querySelector("select").value = "planned";
    form.querySelector("input[type='checkbox']").checked = false;
    form.dispatch("submit");
    await until(() => did.writes.length === 1, "the add");
    assert.deepEqual(did.writes[0], ["POST", "/tasks", { title: "Fix the redirect", line: "", column: "planned", parked: false }]);
    b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
    button(b.el, "Start a chat on this…").dispatch("click");
    assert.deepEqual([did.started, did.writes.length], [["t1"], 1]);
    // Reproduce… (HarnessV4_Space_Plan S7-D1) beside it: the Tester's Start, nothing written.
    // (fails before: yes — there was no Reproduce…)
    b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
    button(b.el, "Reproduce…").dispatch("click");
    assert.deepEqual([did.repro, did.writes.length], [["t1"], 1]);
    b.el.querySelector('[data-task="t2"] .sb-face').dispatch("click");
    assert.equal(b.el.querySelector(".sb-start"), null, "a task a chat has: no Start");
    assert.equal(b.el.querySelector(".sb-repro"), null, "nor Reproduce…");
    button(b.el, "Open opus55").dispatch("click");
    assert.deepEqual(did.opened, ["c1"]);
  });

  test("a board with nothing to show is one line; New task… opens it with a new card, Cancel folds it again", () => {
    const { b, did } = mountBoard([task({ id: "old", column: "done", doneAt: MON - 3 * 24 * HOUR })]);
    assert.deepEqual([b.el.getAttribute("class"), texts(b.el, ".sb-none")], ["sb-board is-empty", ["No tasks yet. New task… adds one; the chats here add theirs as they work."]], "last week's done task is not this week's board");
    assert.equal(b.el.querySelector(".sb-col"), null);
    b.add();
    assert.equal(b.el.getAttribute("class"), "sb-board");
    assert.ok(b.el.querySelector("form[data-new]"), "the new card on Planned");
    button(b.el, "Cancel").dispatch("click");
    assert.deepEqual([b.el.getAttribute("class"), did.writes], ["sb-board is-empty", []]);
  });

  // (fails before: yes — a new card opened wherever Planned stood, under the page's fold on a long page: New task…
  // pressed in the section's head, and nothing seemed to happen)
  test("New task… and a column's +: the new card is scrolled into view once it is on the page; a card opened to change is not", () => {
    const proto = Object.getPrototypeOf(doc.document.body);
    const was = proto.scrollIntoView;
    /** @type {any[]} */
    const scrolled = [];
    proto.scrollIntoView = function (/** @type {any} */ o) {
      scrolled.push([this.hasAttribute("data-new"), this.isConnected, o]);
    };
    try {
      const { b } = mountBoard([task({ id: "t1", title: "Docs" })]);
      b.add();
      assert.deepEqual(scrolled, [[true, true, { block: "nearest" }]], "New task…: the new card, on the page, by the least move");
      button(b.el, "Cancel").dispatch("click");
      b.el.querySelector(".sb-add").dispatch("click");
      assert.deepEqual(scrolled.slice(1), [[true, true, { block: "nearest" }]], "a column's + too");
      button(b.el, "Cancel").dispatch("click");
      b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
      assert.equal(scrolled.length, 2, "a card opened in place stands where the press was");
    } finally {
      proto.scrollIntoView = was;
    }
  });

  // (fails before: yes — two by two under 995px of the section: beside the left bar, a laptop's board was never one row)
  test("the board's columns by the section's own width: four in a row down to 720px, two by two under that, one under 499", () => {
    const css = readFileSync(new URL("../src/ui/harness/space/space.css", import.meta.url), "utf8");
    assert.match(css, /\n\.sb-board \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    assert.match(css, /\n@container sp-tasks \(max-width: 719px\) \{ \.sb-board \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}\n@container sp-tasks \(max-width: 499px\) \{ \.sb-board \{ grid-template-columns: minmax\(0, 1fr\); \} \}\n/);
    assert.doesNotMatch(css, /@container sp-tasks \(max-width: 995px\)/);
  });

  // (fails before: yes — found by the Designer walking a first Space of your own, 10-29: its empty board spoke of "the
  // project's agents", in a Space that is no project's; on its second walk, it said so until the Space was read)
  test("an empty board names the chats here, in a Space of your own as in a project's", () => {
    const { b } = mountBoard([], { plain: true });
    assert.deepEqual(texts(b.el, ".sb-none"), ["No tasks yet. New task… adds one; the chats here add theirs as they work."]);
  });

  test("a Space with one lane: no lane chip on a card; a dashboard's card in Waits for you marked as a task there is (the owner's of 10-27)", () => {
    // (fails before: yes — every card said its one lane, and a dashboard's card in Waits for you was not marked)
    const { b } = mountBoard([task({ id: "t1", title: "Docs", chain: "c1", column: "doing" })], { lanes: [MAIN] });
    assert.deepEqual(cards(b.el), [["t1", "Docs", "", "opus551h"]]);
    b.paint([], { fed: [{ dashboard: "issues", source: "issues", key: "7", title: "Issues", task: "Fix login", line: "", column: "waits", at: NOW, stale: false, presses: [] }] });
    assert.equal(b.el.querySelector("article.sb-card.is-fed").getAttribute("class"), "sb-card is-fed is-ask has-dots");
  });

  test("Doing's mark in its head stands still: a status, not a chat at work (the owner's of 10-27)", () => {
    // (fails before: yes — the mark was is-still, but no rule stopped the spinner's animation it shares)
    const { b } = mountBoard([task({ id: "t1", title: "Docs", column: "doing" })]);
    assert.equal(b.el.querySelector(".sb-col.is-doing .sb-mark").getAttribute("class"), "sb-mark sp-spin is-still");
    assert.match(readFileSync(new URL("../src/ui/harness/space/space.css", import.meta.url), "utf8"), /\.sb-mark\.sp-spin\.is-still svg \{ animation: none; \}/);
  });

  test("a refused save keeps the card open; Done shows the week's newest three, + N more the rest", async () => {
    const { b, did } = mountBoard([task({ id: "t1", title: "Docs" })], { answer: null });
    b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
    b.el.querySelector("form.sb-editor input.sb-in").value = "Docs";
    b.el.querySelector("form.sb-editor").dispatch("submit");
    await until(() => did.writes.length === 1, "the save");
    await new Promise((r) => setImmediate(r));
    assert.ok(b.el.querySelector("form.sb-editor"), "still open: the page said why in a toast");
    const done = Array.from({ length: DONE_SHOWN + 2 }, (_, i) => task({ id: `d${i}`, title: `done ${i}`, column: "done", doneAt: NOW - i * HOUR }));
    b.paint(done, { force: true });
    assert.deepEqual(texts(b.el, ".is-done .sb-t"), ["done 0", "done 1", "done 2"]);
    button(b.el, "+ 2 more").dispatch("click");
    assert.equal(texts(b.el, ".is-done .sb-t").length, 5);
    button(b.el, "Show fewer").dispatch("click");
    assert.equal(texts(b.el, ".is-done .sb-t").length, 3);
  });

  // (fails before: yes — the Designer's walk of 10-29: Home life, a Space with no repository, offered Reproduce… on a task,
  // which asks the Tester for a failing test on a new lane)
  test("a Space with no repository: a task offers no Reproduce…", () => {
    const { b } = mountBoard([task({ id: "t1", title: "Plan the week's meals" })], { plain: true });
    b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
    assert.ok(button(b.el, "Start a chat on this…"));
    assert.equal(b.el.querySelector(".sb-repro"), null);
  });

  /** The newest menu on the page, its rows by their words. */
  const menuRows = () => {
    const m = /** @type {any} */ (doc.document.body.querySelectorAll(".zc-menu").at(-1));
    return m.querySelectorAll(".zc-menu-item").map((/** @type {any} */ r) => ({ row: r, label: (r.querySelector(".zc-menu-label-line") || r.querySelector(".zc-menu-text")).textContent, note: r.querySelector(".zc-menu-note")?.textContent || "" }));
  };
  /** A card's ⋯ pressed: its menu's rows. @param {any} b @param {string} id */
  const dotsOf = async (b, id) => {
    const had = doc.document.body.querySelectorAll(".zc-menu").length;
    b.el.querySelector(`[data-task="${id}"] .sb-dots`).dispatch("click");
    await until(() => doc.document.body.querySelectorAll(".zc-menu").length > had, "its menu");
    return menuRows();
  };
  /** @param {{ row: any, label: string }[]} rows @param {string} label */
  const press = (rows, label) => {
    const r = rows.find((x) => x.label === label);
    assert.ok(r, `the row ${label}`);
    r.row.dispatch("click");
  };

  // (fails before: yes — the owner's of 11-02: "i need three dot menu on each task card where i could do operations like
  // send it to a lane, and it will simply put that task into the composer and move that task into Doing state … three dot
  // menu could also contain start into a new chat": a card's press opened its editor, and nothing sent it to a chat)
  test("a card's ⋯: Move to each other column; Send to a lane, each lane's chats — the chat its own, the card in Doing, the task in its box —; Start a chat on this…; Open its chat; Change…; Remove… asked once more", async () => {
    const { b, did } = mountBoard([task({ id: "t1", title: "Docs", line: "the guide" }), task({ id: "t2", title: "Mine", column: "doing", chain: "c1" })]);
    let rows = await dotsOf(b, "t1");
    assert.deepEqual(rows.map((r) => r.label), ["Move to Doing", "Move to Waits for you", "Move to Done", "Send to a lane", "Start a chat on this…", "Reproduce…", "Attach files…", "Change…", "Remove…"]);
    press(rows, "Move to Done");
    await until(() => did.writes.length === 1, "the move");
    assert.deepEqual(did.writes[0], ["PATCH", "/tasks/t1", { column: "done" }]);
    press(await dotsOf(b, "t1"), "Send to a lane");
    await until(() => menuRows().some((r) => r.label === "a side chat"), "its chats");
    rows = menuRows();
    assert.deepEqual(rows.map((r) => [r.label, r.note]), [["opus55", "main"], ["HarnessV3_Impl", "ux-overhaul"], ["a side chat", "ux-overhaul"]]);
    press(rows, "a side chat");
    await until(() => did.sent.length === 1, "the send");
    assert.deepEqual([did.writes[1], did.sent], [["PATCH", "/tasks/t1", { chain: "c3", column: "doing", parked: false, place: null }], [["t1", "c3"]]]);
    assert.equal(doc.document.body.querySelectorAll(".zc-menu").length, 0, "the menus closed");
    press(await dotsOf(b, "t1"), "Start a chat on this…");
    assert.deepEqual([did.started, did.writes.length], [["t1"], 2], "the Start filled, nothing written");
    // A task a chat has: no Reproduce…, its chat to open.
    rows = await dotsOf(b, "t2");
    assert.deepEqual(rows.map((r) => r.label), ["Move to Planned", "Move to Waits for you", "Move to Done", "Send to a lane", "Start a chat on this…", "Open opus55", "Attach files…", "Change…", "Remove…"]);
    press(rows, "Open opus55");
    assert.deepEqual(did.opened, ["c1"]);
    press(await dotsOf(b, "t2"), "Change…");
    assert.equal(b.el.querySelector("form.sb-editor")?.getAttribute("data-task"), "t2");
    b.el.querySelector("form.sb-editor").dispatch("keydown", { key: "Escape" });
    press(await dotsOf(b, "t2"), "Remove…");
    const sure = /** @type {any} */ (await until(() => doc.document.body.querySelectorAll(".zc-dialog-foot button").find((/** @type {any} */ x) => x.textContent === "Remove"), "Remove, asked once more"));
    assert.equal(did.writes.length, 2, "asked first");
    sure.dispatch("click");
    await until(() => did.writes.length === 3, "the remove");
    assert.deepEqual(did.writes[2], ["DELETE", "/tasks/t2", undefined]);
  });

  test("a Space with no repository sends to a chat, no lane's chip; a dashboard's card has its ⋯ too, which opens its own menu", async () => {
    const { b, did } = mountBoard([task({ id: "t1", title: "Meals" })], { plain: true, lanes: [{ path: "H:/home", chip: "Home life", main: true, chains: ["c1", "c4"] }] });
    const rows = await dotsOf(b, "t1");
    assert.ok(!rows.some((r) => r.label === "Reproduce…"));
    press(rows, "Send to a chat");
    await until(() => menuRows().some((r) => r.label === "Docs"), "its chats");
    assert.deepEqual(menuRows().map((r) => [r.label, r.note]), [["opus55", ""], ["Docs", ""]]);
    press(menuRows(), "Docs");
    b.paint([], { fed: [{ dashboard: "issues", source: "issues", key: "7", title: "Issues", task: "Fix login", line: "", column: "planned", at: NOW, stale: false, presses: [] }] });
    b.el.querySelector("article.sb-card.is-fed .sb-dots").dispatch("click");
    assert.deepEqual(did.fed, ["7"]);
  });

  // (fails before: yes — a Hunter's of 11-02: Send to a lane left a parked task parked and planned for its folder, and
  // filled the chat's box though the move was refused)
  test("Send to a lane takes a task as a chat's taking does — out of park, off its folder —, and a move refused opens no chat", async () => {
    const { b, did } = mountBoard([task({ id: "t1", title: "Docs", parked: true, place: "H:/filament-docs" })], { answer: null });
    press(await dotsOf(b, "t1"), "Send to a lane");
    await until(() => menuRows().some((r) => r.label === "opus55"), "its chats");
    press(menuRows(), "opus55");
    await until(() => did.writes.length === 1, "the move");
    assert.deepEqual(did.writes[0], ["PATCH", "/tasks/t1", { chain: "c1", column: "doing", parked: false, place: null }]);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(did.sent, [], "refused: no chat opened");
  });

  /** A drag's data as the page hands it on: what the card set, the kinds it carries. */
  const dragData = () => {
    /** @type {Record<string, string>} */
    const data = {};
    return { data, types: /** @type {string[]} */ ([]), effectAllowed: "", dropEffect: "", setData(/** @type {string} */ k, /** @type {string} */ v) { this.types.push(k); data[k] = v; } };
  };
  /** Cards laid out as the page measures them: each 40 high, 8 apart, from 100 down. @param {any} b @param {string[]} ids */
  const layOut = (b, ids) =>
    ids.forEach((id, i) => {
      b.el.querySelector(`[data-task="${id}"]`).getBoundingClientRect = () => ({ top: 100 + i * 48, bottom: 140 + i * 48, height: 40, left: 0, right: 200, width: 200 });
    });
  /** The drag's marks on the board, by the card or column each is on. @param {any} b */
  const marks = (b) =>
    ["is-over", "is-before", "is-after", "is-dragged"].flatMap((k) => b.el.querySelectorAll(`.${k}`).map((/** @type {any} */ x) => `${k} ${x.getAttribute("data-task") || x.getAttribute("data-key")}`));

  // (fails before: yes — the owner's of 11-02, "the kanban inside space should be more powerful … fix what you already
  // made": a card could not be dragged, to another column or to another place in its own)
  test("a card dragged: within its column, put where it is dropped; to another, moved there at its place; a line marks where it goes; Done keeps its order; nothing written where it stays", async () => {
    const { b, did } = mountBoard([
      task({ id: "t1", title: "One", at: NOW - HOUR }),
      task({ id: "t2", title: "Two", at: NOW - 2 * HOUR }),
      task({ id: "t3", title: "Three", at: NOW - 3 * HOUR }),
      task({ id: "t4", title: "Wired", column: "doing", chain: "c1" }),
      task({ id: "t5", title: "Shipped", column: "done", doneAt: NOW - HOUR }),
    ]);
    const col = (/** @type {string} */ key) => b.el.querySelector(`section.is-${key}`);
    const card = (/** @type {string} */ id) => b.el.querySelector(`[data-task="${id}"]`);
    // The stand-in Space answers each move without the board: answered, the board is drawn as the Space last said it.
    const answered = () => new Promise((r) => setImmediate(r));
    layOut(b, ["t1", "t2", "t3"]);
    layOut(b, ["t4"]);
    assert.equal(card("t1").getAttribute("draggable"), "true");
    // Three, to the top of Planned: drawn there at once.
    let dt = dragData();
    card("t3").dispatch("dragstart", { dataTransfer: dt });
    assert.deepEqual([dt.data["application/x-filament-board-card"], dt.effectAllowed], ["t3", "move"]);
    col("planned").dispatch("dragover", { dataTransfer: dt, clientY: 105 });
    assert.deepEqual(marks(b), ["is-over col:planned", "is-before t1", "is-dragged t3"], "the line above One");
    col("planned").dispatch("drop", { dataTransfer: dt, clientY: 105 });
    assert.deepEqual(did.writes, [["PATCH", "/tasks/t3", { order: ["t3", "t1", "t2"] }]]);
    assert.deepEqual(cards(b.el).map((c) => c[0]).slice(0, 3), ["t3", "t1", "t2"], "drawn where it was dropped before the Space answers");
    card("t3").dispatch("dragend", { dataTransfer: dt });
    assert.deepEqual(marks(b), [], "the marks gone");
    await answered();
    // One, between Two and Three; then below them all.
    dt = dragData();
    card("t1").dispatch("dragstart", { dataTransfer: dt });
    col("planned").dispatch("dragover", { dataTransfer: dt, clientY: 178 });
    assert.deepEqual(marks(b), ["is-over col:planned", "is-before t3", "is-dragged t1"]);
    col("planned").dispatch("dragover", { dataTransfer: dt, clientY: 400 });
    assert.deepEqual(marks(b), ["is-over col:planned", "is-after t3", "is-dragged t1"], "below the last");
    col("planned").dispatch("drop", { dataTransfer: dt, clientY: 400 });
    assert.deepEqual(did.writes[1], ["PATCH", "/tasks/t1", { order: ["t2", "t3", "t1"] }]);
    card("t1").dispatch("dragend", { dataTransfer: dt });
    await answered();
    // Dropped where it stands: nothing written.
    dt = dragData();
    card("t1").dispatch("dragstart", { dataTransfer: dt });
    col("planned").dispatch("drop", { dataTransfer: dt, clientY: 110 });
    card("t1").dispatch("dragend", { dataTransfer: dt });
    assert.equal(did.writes.length, 2, "One stays at the top");
    // Two, to Doing below Wired.
    dt = dragData();
    card("t2").dispatch("dragstart", { dataTransfer: dt });
    col("doing").dispatch("dragover", { dataTransfer: dt, clientY: 150 });
    assert.deepEqual(marks(b), ["is-over col:doing", "is-after t4", "is-dragged t2"]);
    col("doing").dispatch("drop", { dataTransfer: dt, clientY: 150 });
    card("t2").dispatch("dragend", { dataTransfer: dt });
    assert.deepEqual(did.writes[2], ["PATCH", "/tasks/t2", { column: "doing", order: ["t4", "t2"] }]);
    await answered();
    // To Done: moved, no place — Done keeps the order its tasks were done in; within Done, nothing.
    dt = dragData();
    card("t3").dispatch("dragstart", { dataTransfer: dt });
    col("done").dispatch("dragover", { dataTransfer: dt, clientY: 100 });
    assert.deepEqual(marks(b), ["is-over col:done", "is-dragged t3"], "no line in Done");
    col("done").dispatch("drop", { dataTransfer: dt, clientY: 100 });
    card("t3").dispatch("dragend", { dataTransfer: dt });
    assert.deepEqual(did.writes[3], ["PATCH", "/tasks/t3", { column: "done" }]);
    await answered();
    dt = dragData();
    card("t5").dispatch("dragstart", { dataTransfer: dt });
    col("done").dispatch("drop", { dataTransfer: dt, clientY: 300 });
    assert.equal(did.writes.length, 4);
    card("t5").dispatch("dragend", { dataTransfer: dt });
    // Files from the computer are a card's, never the column's; a drag that ended drops nothing.
    col("doing").dispatch("dragover", { dataTransfer: { types: ["Files"], files: [] }, clientY: 100 });
    col("doing").dispatch("drop", { dataTransfer: { types: ["Files"], files: [] }, clientY: 100 });
    col("doing").dispatch("drop", { dataTransfer: { types: ["application/x-filament-board-card"] }, clientY: 100 });
    assert.deepEqual([marks(b), did.writes.length], [[], 4]);
    // A dashboard's card stays where its source puts it; while a card is open in place, none is dragged.
    b.paint([task({ id: "t1", title: "One" }), task({ id: "t2", title: "Two" })], { fed: [{ dashboard: "issues", source: "issues", key: "7", title: "Issues", task: "Fix login", line: "", column: "planned", at: NOW, stale: false, presses: [] }] });
    assert.equal(b.el.querySelector("article.is-fed").getAttribute("draggable"), null);
    card("t1").querySelector(".sb-face").dispatch("click");
    assert.equal(card("t2").getAttribute("draggable"), null, "a card open in place: none dragged");
  });

  // (fails before: yes — the same: a card's place, by the keyboard too)
  test("a card's ⋯ moves it up or down among those it stands with — Planned's open apart from its parked —; none in Done", async () => {
    const { b, did } = mountBoard([
      task({ id: "t1", at: NOW - HOUR }),
      task({ id: "t2", at: NOW - 2 * HOUR }),
      task({ id: "t3", parked: true, at: NOW }),
      task({ id: "t5", column: "done", doneAt: NOW - HOUR }),
      task({ id: "t6", column: "done", doneAt: NOW - 2 * HOUR }),
    ]);
    const moves = (/** @type {{ label: string }[]} */ rows) => rows.map((r) => r.label).filter((l) => /^Move (up|down)$/.test(l));
    let rows = await dotsOf(b, "t1");
    assert.deepEqual(moves(rows), ["Move down"]);
    assert.deepEqual(rows.slice(0, 4).map((r) => r.label), ["Move to Doing", "Move to Waits for you", "Move to Done", "Move down"]);
    press(rows, "Move down");
    assert.deepEqual(did.writes, [["PATCH", "/tasks/t1", { order: ["t2", "t1"] }]]);
    // The stand-in Space answers without the board: answered, the board is drawn as the Space last said it.
    await new Promise((r) => setImmediate(r));
    rows = await dotsOf(b, "t2");
    assert.deepEqual(moves(rows), ["Move up"]);
    press(rows, "Move up");
    assert.deepEqual(did.writes[1], ["PATCH", "/tasks/t2", { order: ["t2", "t1"] }]);
    assert.deepEqual(moves(await dotsOf(b, "t3")), [], "alone among the parked");
    assert.deepEqual(moves(await dotsOf(b, "t5")), [], "Done keeps its order");
  });

  // (fails before: yes — the bug hunt of 11-02 on the board's drag: a second drop before the first's answer was drawn was
  // put among the cards as they stood before the first, and its write, sent alongside, put the first move back)
  test("two drops before the Space answers the first: each drawn at once, the second built on the first and written once the first is answered — both kept; a move refused goes back as the Space has it", async () => {
    const clock = { at: NOW - 3 * HOUR };
    const store = createSpaceStore({ dir: null, now: () => clock.at });
    for (const title of ["A", "B", "C"]) {
      store.addTask("p1", { title }, { kind: "you" });
      clock.at += HOUR;
    }
    // Each write held until the test lets it go, then answered as the page answers one: the Space as it stands, drawn.
    /** @type {ReturnType<typeof gate>[]} */
    const held = [];
    let refuse = false;
    const { b, did } = mountBoard(structuredClone(store.get("p1").tasks), {
      answer: async (/** @type {string} */ _m, /** @type {string} */ path, /** @type {any} */ body) => {
        const go = gate();
        held.push(go);
        await go.promise;
        if (refuse) return null;
        store.changeTask("p1", decodeURIComponent(path.split("/")[2]), body);
        const space = { tasks: structuredClone(store.get("p1").tasks) };
        b.paint(space.tasks);
        return { ok: true, space };
      },
    });
    const ids = () => cards(b.el).map((c) => c[0]);
    /** A card dropped on the top of Planned, the cards laid out as the board draws them then. @param {string} id */
    const toTop = (id) => {
      layOut(b, ids());
      const dt = dragData();
      b.el.querySelector(`[data-task="${id}"]`).dispatch("dragstart", { dataTransfer: dt });
      b.el.querySelector("section.is-planned").dispatch("drop", { dataTransfer: dt, clientY: 101 });
      b.el.querySelector(`[data-task="${id}"]`).dispatch("dragend", { dataTransfer: dt });
    };
    assert.deepEqual(ids(), ["t3", "t2", "t1"], "C, B, A: the newest on top");
    toTop("t1");
    toTop("t2");
    assert.deepEqual(ids(), ["t2", "t1", "t3"], "both drawn at once, the second over the first");
    assert.deepEqual(did.writes, [["PATCH", "/tasks/t1", { order: ["t1", "t3", "t2"] }]], "one written at a time");
    await until(() => held.length === 1, "the first write in flight");
    held[0].open();
    await until(() => did.writes.length === 2, "the second, once the first is answered");
    assert.deepEqual(did.writes[1], ["PATCH", "/tasks/t2", { order: ["t2", "t1", "t3"] }], "built on the first");
    assert.deepEqual(ids(), ["t2", "t1", "t3"], "the first's answer drawn with the second over it");
    held[1].open();
    await until(() => held.length === 2 && JSON.stringify(boardColumns(store.get("p1").tasks, NOW)[0].tasks.map((t) => t.id)) === '["t2","t1","t3"]', "the Space has both");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(ids(), ["t2", "t1", "t3"]);
    // Refused: the page says why, and the board goes back as the Space has it.
    refuse = true;
    toTop("t3");
    assert.deepEqual(ids(), ["t3", "t2", "t1"]);
    await until(() => held.length === 3, "the refused write in flight");
    held[2].open();
    await until(() => ids()[0] === "t2", "drawn back");
    assert.deepEqual([ids(), did.writes.length], [["t2", "t1", "t3"], 3]);
  });

  /**
   * The board over a Space the test keeps (services/spaces.js's store), its tasks made oldest first, an hour apart: each
   * write held until the test lets it go, then answered as the page answers one — refused, null, where `refuse` says so
   * of the nth write; else made on the Space, a minute on, and the Space as it stands drawn.
   * @param {string[]} titles @param {{ refuse?: (n: number) => boolean, moved?: () => void, report?: (err: unknown) => void }} [o]
   */
  const heldSpace = (titles, o = {}) => {
    const clock = { at: NOW - titles.length * HOUR };
    const store = createSpaceStore({ dir: null, now: () => clock.at });
    for (const title of titles) {
      store.addTask("p1", { title }, { kind: "you" });
      clock.at += HOUR;
    }
    /** @type {ReturnType<typeof gate>[]} */
    const held = [];
    const { b, did } = mountBoard(structuredClone(store.get("p1").tasks), {
      ...(o.moved ? { moved: o.moved } : {}),
      ...(o.report ? { report: o.report } : {}),
      answer: async (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ body) => {
        const n = held.length;
        const go = gate();
        held.push(go);
        await go.promise;
        if (o.refuse?.(n)) return null;
        clock.at += 60_000;
        const id = decodeURIComponent(path.split("/")[2]);
        if (method === "DELETE") store.removeTask("p1", id);
        else store.changeTask("p1", id, body);
        const space = { tasks: structuredClone(store.get("p1").tasks) };
        b.paint(space.tasks);
        return { ok: true, space };
      },
    });
    /** The board's cards top to bottom, a column's or all. @param {string} [column] */
    const ids = (column) => (column ? b.el.querySelectorAll(`section.is-${column} [data-task]`).map((/** @type {any} */ x) => x.getAttribute("data-task")) : cards(b.el).map((c) => c[0]));
    /** A column as the Space has it. @param {number} [i] */
    const stored = (i = 0) => boardColumns(store.get("p1").tasks, NOW)[i].tasks.map((t) => t.id);
    /**
     * A card dropped on a column at a height, the column's cards laid out as the board draws them then.
     * @param {string} id @param {number} y @param {string} [column]
     */
    const dropAt = (id, y, column = "planned") => {
      layOut(b, ids(column));
      const dt = dragData();
      b.el.querySelector(`[data-task="${id}"]`).dispatch("dragstart", { dataTransfer: dt });
      b.el.querySelector(`section.is-${column}`).dispatch("drop", { dataTransfer: dt, clientY: y });
      b.el.querySelector(`[data-task="${id}"]`).dispatch("dragend", { dataTransfer: dt });
    };
    /** A card's editor opened, its words typed and its select as the page shows it, Saved. @param {string} id @param {string} title @param {string} column */
    const saveAs = (id, title, column) => {
      b.el.querySelector(`[data-task="${id}"] .sb-face`).dispatch("click");
      const form = b.el.querySelector(`form.sb-editor[data-task="${id}"]`);
      form.querySelector("input.sb-in").value = title;
      form.querySelector("select").value = column;
      form.querySelector("input[type='checkbox']").checked = false;
      form.dispatch("submit");
      return form;
    };
    return { b, did, held, store, ids, stored, dropAt, saveAs };
  };

  // (fails before: yes — the bug hunt of 11-03 on the board's queue of moves: each move's write was built as it was
  // dropped, on the board with the moves before it drawn, so the write after a refused one still carried the refused
  // card where the refused move put it)
  test("two drops in flight, the first refused: the second is written as the person placed it among the cards whose places stand, the refused card where the Space has it among them — never with the refused order", async () => {
    // The first of each pair refused, as the page answers one: null.
    const { did, held, ids, stored, dropAt } = heldSpace(["A", "B", "C", "D"], { refuse: (n) => n % 2 === 0 });
    /**
     * Two drops, the first's write refused: what the second wrote, what the board drew before the Space answered it, and
     * what the Space and the board have once it did. @param {[string, number]} first @param {[string, number]} second
     */
    const pair = async ([a, ya], [c, yc]) => {
      const n = held.length;
      dropAt(a, ya);
      dropAt(c, yc);
      assert.equal(did.writes.length, n + 1, "one written at a time");
      await until(() => held.length === n + 1, "the first write in flight");
      held[n].open();
      await until(() => did.writes.length === n + 2, "the second, once the first is refused");
      const drawn = ids();
      await until(() => held.length === n + 2, "the second write in flight");
      held[n + 1].open();
      await until(() => JSON.stringify(stored()) === JSON.stringify(did.writes[n + 1][2].order), "the Space has the second");
      await new Promise((r) => setImmediate(r));
      return { wrote: did.writes[n + 1], drawn, after: ids() };
    };
    assert.deepEqual(ids(), ["t4", "t3", "t2", "t1"], "D, C, B, A: the newest on top");
    // A, then B, to the top; A's refused. B on top of the cards whose places stand; A at the foot, where the Space has it.
    let got = await pair(["t1", 101], ["t2", 101]);
    assert.deepEqual(did.writes[0], ["PATCH", "/tasks/t1", { order: ["t1", "t4", "t3", "t2"] }]);
    assert.deepEqual(got, { wrote: ["PATCH", "/tasks/t2", { order: ["t2", "t4", "t3", "t1"] }], drawn: ["t2", "t4", "t3", "t1"], after: ["t2", "t4", "t3", "t1"] });
    // B, then D, to the foot; B's refused. D below the cards whose places stand; B on top, where the Space has it.
    got = await pair(["t2", 400], ["t4", 400]);
    assert.deepEqual(did.writes[2], ["PATCH", "/tasks/t2", { order: ["t4", "t3", "t1", "t2"] }]);
    assert.deepEqual(got, { wrote: ["PATCH", "/tasks/t4", { order: ["t2", "t3", "t1", "t4"] }], drawn: ["t2", "t3", "t1", "t4"], after: ["t2", "t3", "t1", "t4"] });
    // A between B and C; then D between A and C; A's refused. Among the cards whose places stand D was dropped below B
    // and above C, so it goes between them; A below C, the one it stood below in the Space.
    got = await pair(["t1", 150], ["t4", 200]);
    assert.deepEqual(did.writes[4], ["PATCH", "/tasks/t1", { order: ["t2", "t1", "t3", "t4"] }]);
    assert.deepEqual(got, { wrote: ["PATCH", "/tasks/t4", { order: ["t2", "t4", "t3", "t1"] }], drawn: ["t2", "t4", "t3", "t1"], after: ["t2", "t4", "t3", "t1"] });
    assert.equal(did.writes.length, 6);
  });

  // (fails before: yes — the same hunt: Move to…, Send to a lane, Save and Remove wrote at once, beside a drag's move still
  // on its way, so whichever landed last won)
  test("a card's menu and its editor write in their turn: after a drag's move on its way — Move to… drawn at once, as a drag's move is —, so the Space takes them in the order they were made", async () => {
    const { b, did, held, store, ids, dropAt, saveAs } = heldSpace(["A", "B", "C", "D"]);
    const column = (/** @type {string} */ id) => b.el.querySelector(`[data-task="${id}"]`)?.closest("section")?.getAttribute("data-key");
    const settled = () => new Promise((r) => setImmediate(r));
    dropAt("t1", 101);
    assert.deepEqual(did.writes, [["PATCH", "/tasks/t1", { order: ["t1", "t4", "t3", "t2"] }]]);
    // Move to Doing, while the drag's move is on its way: drawn at once, written once it is answered.
    press(await dotsOf(b, "t1"), "Move to Doing");
    assert.deepEqual([column("t1"), ids("planned")], ["col:doing", ["t4", "t3", "t2"]], "drawn in Doing at once");
    // Send to a lane of another, after it.
    press(await dotsOf(b, "t2"), "Send to a lane");
    await until(() => menuRows().some((r) => r.label === "opus55"), "its chats");
    press(menuRows(), "opus55");
    await settled();
    assert.deepEqual([did.writes.length, did.sent], [1, []], "nothing written beside the drag's move");
    held[0].open();
    await until(() => did.writes.length === 2, "Move to…, once the drag's move is answered");
    assert.deepEqual(did.writes[1], ["PATCH", "/tasks/t1", { column: "doing" }]);
    await until(() => held.length === 2, "Move to… in flight");
    held[1].open();
    await until(() => did.writes.length === 3, "Send to a lane, after it");
    assert.deepEqual(did.writes[2], ["PATCH", "/tasks/t2", { chain: "c1", column: "doing", parked: false, place: null }]);
    await until(() => held.length === 3, "Send in flight");
    assert.deepEqual(did.sent, [], "the chat opens once its move is answered");
    held[2].open();
    await until(() => did.sent.length === 1, "the chat opened");
    assert.deepEqual([ids("planned"), ids("doing")], [["t4", "t3"], ["t2", "t1"]], "drawn as the Space has it");
    // A drag, then Remove… from another card's ⋯: the remove after the drag's move.
    dropAt("t3", 101);
    assert.deepEqual(did.writes[3], ["PATCH", "/tasks/t3", { order: ["t3", "t4"] }]);
    press(await dotsOf(b, "t4"), "Remove…");
    const sure = /** @type {any} */ (await until(() => doc.document.body.querySelectorAll(".zc-dialog-foot button").filter((/** @type {any} */ x) => x.textContent === "Remove").at(-1), "Remove, asked once more"));
    sure.dispatch("click");
    await settled();
    assert.equal(did.writes.length, 4, "the remove waits for the drag's move");
    held[3].open();
    await until(() => did.writes.length === 5, "the remove, after it");
    assert.deepEqual(did.writes[4], ["DELETE", "/tasks/t4", undefined]);
    await until(() => held.length === 5, "the remove in flight");
    held[4].open();
    await until(() => !b.el.querySelector('[data-task="t4"]'), "removed");
    // A drag, then a card's Save: the Save after it, said to wait until it is written; its column, not changed, not
    // written.
    dropAt("t1", 101, "doing");
    assert.deepEqual(did.writes[5], ["PATCH", "/tasks/t1", { order: ["t1", "t2"] }]);
    const form = saveAs("t1", "A, renamed", "doing");
    const saveBtn = form.querySelector("button.primary");
    await settled();
    assert.deepEqual([did.writes.length, saveBtn.textContent, saveBtn.disabled, form.querySelector(".sb-said").textContent], [6, "Saving…", true, "Waits for the moves before it"]);
    held[5].open();
    await until(() => did.writes.length === 7, "the Save, after it");
    assert.deepEqual(did.writes[6], ["PATCH", "/tasks/t1", { title: "A, renamed", line: "", parked: false }]);
    assert.deepEqual([saveBtn.textContent, form.querySelector(".sb-said").textContent], ["Saving…", ""], "written: it waits no more");
    await until(() => held.length === 7, "the Save in flight");
    held[6].open();
    await until(() => !b.el.querySelector("form.sb-editor"), "saved: the card closed");
    assert.equal(store.get("p1").tasks.find((t) => t.id === "t1")?.title, "A, renamed");
    // A drag, then the editor's Remove: the remove after it, pressed once.
    dropAt("t2", 101, "doing");
    assert.deepEqual(did.writes[7], ["PATCH", "/tasks/t2", { order: ["t2", "t1"] }]);
    b.el.querySelector('[data-task="t2"] .sb-face').dispatch("click");
    const remove = b.el.querySelector("form.sb-editor .sb-remove");
    remove.dispatch("click");
    remove.dispatch("click");
    remove.dispatch("click");
    await settled();
    assert.deepEqual([did.writes.length, remove.textContent, remove.disabled], [8, "Removing…", true]);
    held[7].open();
    await until(() => did.writes.length === 9, "the remove, after it");
    assert.deepEqual(did.writes[8], ["DELETE", "/tasks/t2", undefined]);
    await until(() => held.length === 9, "the remove in flight");
    held[8].open();
    await until(() => !b.el.querySelector("form.sb-editor"), "removed: the card closed");
    assert.deepEqual([ids("planned"), ids("doing"), did.writes.length], [["t3"], ["t1"], 9]);
  });

  // (fails before: yes — the review of 11-03: `unplaced` stops at the refused card's own next move, which no test made)
  test("a card dropped again after its refused move stands where that drop put it: the drops after it see it there", async () => {
    const { did, held, ids, stored, dropAt } = heldSpace(["A", "B", "C", "D"], { refuse: (n) => n === 0 });
    // A to the top (refused); A again, below D; then B between D and A.
    dropAt("t1", 101);
    dropAt("t1", 190);
    dropAt("t2", 150);
    assert.deepEqual([ids(), did.writes.length], [["t4", "t2", "t1", "t3"], 1]);
    held[0].open();
    await until(() => did.writes.length === 2, "A's second drop, once the first is refused");
    assert.deepEqual(did.writes[1], ["PATCH", "/tasks/t1", { order: ["t4", "t1", "t3", "t2"] }]);
    assert.deepEqual(ids(), ["t4", "t2", "t1", "t3"], "nothing moves: A's own drop places it again");
    await until(() => held.length === 2, "A's second drop in flight");
    held[1].open();
    await until(() => did.writes.length === 3, "B's drop");
    assert.deepEqual(did.writes[2], ["PATCH", "/tasks/t2", { order: ["t4", "t2", "t1", "t3"] }], "B above A, as it was dropped");
    await until(() => held.length === 3, "B's drop in flight");
    held[2].open();
    await until(() => JSON.stringify(stored()) === '["t4","t2","t1","t3"]', "the Space has it");
  });

  // (fails before: yes — the review of 11-03: a Save answered closed whatever card was open in place then, and a second
  // press of Save wrote it twice)
  test("a Save waiting its turn: pressed once, it says so; answered, it closes its own card, never another opened since", async () => {
    const { b, did, held, dropAt, saveAs } = heldSpace(["A", "B", "C"]);
    dropAt("t1", 101);
    const x = saveAs("t2", "B, renamed", "planned");
    const xSave = x.querySelector("button.primary");
    const shownWaiting = [xSave.textContent, xSave.disabled, x.querySelector(".sb-said").textContent];
    x.dispatch("submit");
    // Another card opened, and typed in, while that Save waits.
    b.el.querySelector('[data-task="t3"] .sb-face').dispatch("click");
    const y = b.el.querySelector('form.sb-editor[data-task="t3"]');
    y.querySelector("input.sb-in").value = "C, typed";
    held[0].open();
    await until(() => did.writes.length >= 2, "the Save, once the move is answered");
    await until(() => held.length === 2, "the Save in flight");
    held[1].open();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([b.el.querySelector("form.sb-editor") === y, y.querySelector("input.sb-in").value, did.writes.length], [true, "C, typed", 2], "the card opened since stays open, its words kept; one Save written for two presses");
    assert.deepEqual(did.writes[1], ["PATCH", "/tasks/t2", { title: "B, renamed", line: "", parked: false }]);
    assert.deepEqual(shownWaiting, ["Saving…", true, "Waits for the moves before it"], "pressed, it said it waits");
    y.querySelector("select").value = "planned";
    y.querySelector("input[type='checkbox']").checked = false;
    y.dispatch("submit");
    await until(() => did.writes.length === 3, "its own Save");
    assert.deepEqual(did.writes[2], ["PATCH", "/tasks/t3", { title: "C, typed", line: "", parked: false }]);
    await until(() => held.length === 3, "in flight");
    held[2].open();
    await until(() => !b.el.querySelector("form.sb-editor"), "saved: its own card closed");
  });

  // (fails before: yes — the review of 11-03: a move's column was written wherever the Space had the card in another column
  // as it was sent, so a reorder within Planned put back an agent's move to Doing made meanwhile)
  test("a move within a column writes no column: an agent's move to another column made while it waits stands, and its place there is no move", async () => {
    const { b, did, held, store, ids, stored, dropAt } = heldSpace(["A", "B", "C"]);
    dropAt("t1", 101);
    dropAt("t2", 101);
    assert.deepEqual(ids(), ["t2", "t1", "t3"]);
    // An agent moves B to Doing meanwhile; the page reads it.
    store.changeTask("p1", "t2", { column: "doing" });
    b.paint(structuredClone(store.get("p1").tasks));
    assert.deepEqual([ids("planned"), ids("doing")], [["t1", "t3"], ["t2"]], "the agent's move drawn; B's place in Planned is no move");
    held[0].open();
    await until(() => JSON.stringify(stored()) === '["t1","t3"]', "the first answered");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([did.writes.length, stored(1), ids("planned"), ids("doing")], [1, ["t2"], ["t1", "t3"], ["t2"]], "nothing written for B: it stays in Doing");
  });

  // (fails before: yes — the same review: a card's Save wrote the column its select showed, so a Save after a refused move
  // made that move again)
  test("a card's Save writes its column only where the person changed it: after a refused move, the card stays where the Space has it", async () => {
    const { did, held, store, ids, dropAt, saveAs } = heldSpace(["A", "B"], { refuse: (n) => n === 0 });
    dropAt("t1", 101, "doing");
    assert.deepEqual([did.writes[0], ids("doing")], [["PATCH", "/tasks/t1", { column: "doing", order: ["t1"] }], ["t1"]]);
    // Opened while the move is on its way, its select shows Doing, as the board draws it.
    saveAs("t1", "A, renamed", "doing");
    held[0].open();
    await until(() => did.writes.length === 2, "the Save, once the move is refused");
    assert.deepEqual(did.writes[1], ["PATCH", "/tasks/t1", { title: "A, renamed", line: "", parked: false }]);
    await until(() => held.length === 2, "the Save in flight");
    held[1].open();
    await until(() => store.get("p1").tasks.find((t) => t.id === "t1")?.title === "A, renamed", "saved");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([store.get("p1").tasks.find((t) => t.id === "t1")?.column, ids("planned"), ids("doing")], ["planned", ["t2", "t1"], []]);
  });

  // (fails before: yes — the same review: a failure drawing what reads the board, after a write was answered, kept the next
  // write from starting, and the queue stalled for good)
  test("what reads the board failing to draw: reported, and every move still written in its turn", async () => {
    /** @type {string[]} */
    const reported = [];
    let breaking = false;
    const { did, held, ids, stored, dropAt } = heldSpace(["A", "B", "C"], {
      moved: () => {
        if (breaking) throw new Error("the lanes drawn wrong");
      },
      report: (err) => void reported.push(String(err)),
    });
    dropAt("t1", 101);
    dropAt("t2", 101);
    breaking = true;
    held[0].open();
    await until(() => did.writes.length === 2, "the second written, though what reads the board failed");
    dropAt("t1", 400);
    assert.deepEqual(ids(), ["t2", "t3", "t1"], "a drop drawn, though what reads the board fails");
    await until(() => held.length === 2, "the second in flight");
    held[1].open();
    await until(() => did.writes.length === 3, "the third");
    assert.deepEqual(did.writes[2], ["PATCH", "/tasks/t1", { order: ["t2", "t3", "t1"] }]);
    await until(() => held.length === 3, "the third in flight");
    held[2].open();
    await until(() => JSON.stringify(stored()) === '["t2","t3","t1"]', "the Space has all three");
    assert.ok(reported.length >= 3 && reported.every((r) => r === "Error: the lanes drawn wrong"), reported.join("; "));
  });

  // (fails before: yes — test/css-has.test.js: the title kept clear of the ⋯ by `.sb-card:has(> .sb-dots)`, a :has()
  // before a combinator, which the page's rule keeps out for what it costs)
  test("a card with its ⋯ says so in its class, which keeps its title clear of it: a task's always, a pull's or a dashboard's where its menu is", () => {
    const { b } = mountBoard([task({ id: "t1", title: "Docs" })]);
    /** @type {import("../src/ui/harness/lib/space-view.js").PulledTask} */
    const issue = { pull: "lin", service: "linear", title: "Linear", key: "LIN-42", keyWords: "LIN-42", task: "Login loops", line: "", column: "planned", state: "Todo", url: "", lane: "", moved: false, at: NOW, stale: false };
    b.paint([task({ id: "t1", title: "Docs" })], { fed: [{ dashboard: "issues", source: "issues", key: "7", title: "Issues", task: "Fix login", line: "", column: "planned", at: NOW, stale: false, presses: [] }], pulled: [issue] });
    const has = (/** @type {string} */ sel) => [!!b.el.querySelector(`${sel} .sb-dots`), b.el.querySelector(sel).classList.contains("has-dots")];
    assert.deepEqual([has('[data-task="t1"]'), has("article[data-fed]"), has("article[data-pulled]")], [[true, true], [true, true], [false, false]]);
    assert.match(readFileSync(new URL("../src/ui/harness/space/space.css", import.meta.url), "utf8"), /\n\.sb-card\.has-dots \.sb-t \{ padding-right: 20px; \}\n/);
  });

  // (fails before: yes — seen in the page, 11-12: Reproduce… stood centred under Attach files… and Start a chat on
  // this…, its bug against its words: the rule that draws an editor's act named the other three)
  test("an editor's acts are drawn alike: Reproduce… at the form's left, its icon a gap from its words, as Attach files… and Start a chat on this… are", () => {
    const css = readFileSync(new URL("../src/ui/harness/space/space.css", import.meta.url), "utf8");
    const rule = /\n([^\n{}]*\.sb-attach[^\n{}]*) \{ align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; \}/.exec(css);
    assert.ok(rule, "the acts' rule");
    assert.deepEqual(rule[1].split(", ").sort(), [".sb-attach", ".sb-open", ".sb-repro", ".sb-start"]);
  });

  /** The page's file picker as the board opens it: the input it clicks, held. */
  const picker = () => {
    const proto = Object.getPrototypeOf(doc.document.createElement("input"));
    const got = { input: /** @type {any} */ (null), done: () => void delete proto.click };
    proto.click = function () {
      got.input = this;
    };
    return got;
  };
  /** @param {string} id @param {string} name @param {string} kind @param {number} bytes */
  const fileOf = (id, name, kind, bytes) => ({ id, name, kind: /** @type {any} */ (kind), type: "", bytes, at: NOW });

  // (fails before: yes — the owner's of 11-02: "i should be able to attach files on any task … attach files and pictures
  // in the task to store information that i want": a task held words alone)
  test("a task's files on its card: its first three pictures, the paperclip's count, their names on it; files dropped on a card attached to its task", () => {
    const files = [fileOf("p1", "p1.png", "image", 9), fileOf("fd", "spec.pdf", "pdf", 9), fileOf("p2", "p2.png", "image", 9), fileOf("p3", "p3.png", "image", 9), fileOf("p4", "p4.png", "image", 9)];
    const { b, did } = mountBoard([task({ id: "t1", title: "Logo", files }), task({ id: "t2", title: "Plain" })]);
    const card = b.el.querySelector('[data-task="t1"]');
    assert.deepEqual(card.querySelectorAll(".sb-face .sb-pic").map((/** @type {any} */ i) => [i.getAttribute("src"), i.getAttribute("alt")]), [["/f/t1/p1", "p1.png"], ["/f/t1/p2", "p2.png"], ["/f/t1/p3", "p3.png"]]);
    assert.equal(card.querySelector(".sb-clip").textContent, "5");
    assert.equal(card.querySelector(".sb-clip").getAttribute("title"), "p1.png\nspec.pdf\np2.png\np3.png\np4.png");
    assert.deepEqual([b.el.querySelector('[data-task="t2"] .sb-clip'), b.el.querySelector('[data-task="t2"] .sb-pics')], [null, null]);
    const plain = b.el.querySelector('[data-task="t2"]');
    plain.dispatch("dragover", { dataTransfer: { types: ["text/plain"], files: [] } });
    assert.equal(plain.classList.contains("is-drop"), false, "words dragged are no files");
    plain.dispatch("dragover", { dataTransfer: { types: ["Files"], files: [] } });
    assert.ok(plain.classList.contains("is-drop"), "marked while files are over it");
    plain.dispatch("drop", { dataTransfer: { types: ["Files"], files: [new File(["x"], "shot.png", { type: "image/png" })] } });
    assert.equal(plain.classList.contains("is-drop"), false);
    assert.deepEqual(did.attached, [["t2", ["shot.png"]]]);
  });

  test("Attach files… on a card's ⋯: the computer's picker, several at once, what it picks attached to the task", async () => {
    const { b, did } = mountBoard([task({ id: "t1", title: "Logo" })]);
    const pick = picker();
    try {
      press(await dotsOf(b, "t1"), "Attach files…");
      await until(() => pick.input, "the picker");
    } finally {
      pick.done();
    }
    assert.deepEqual([pick.input.getAttribute("type"), pick.input.getAttribute("multiple")], ["file", ""]);
    pick.input.files = [new File(["a"], "a.txt"), new File(["b"], "b.md")];
    pick.input.onchange();
    assert.deepEqual(did.attached, [["t1", ["a.txt", "b.md"]]]);
  });

  test("a card opened in place lists its files — a picture and text open in a tab, any other kind downloads —; a picture pasted attached; one removed asked once more", async () => {
    const files = [fileOf("fa", "logo.png", "image", 2048), fileOf("fb", "data.zip", "file", 5 * 1048576)];
    const { b, did } = mountBoard([task({ id: "t1", title: "Logo", files })], {
      answer: (/** @type {string} */ m) => (m === "DELETE" ? { ok: true, space: { tasks: [task({ id: "t1", title: "Logo", files: [files[1]] })] } } : { ok: true }),
      attached: (t, picked) => ({ ...t, files: [...files, fileOf("fc", picked[0].name, "image", 1)] }),
    });
    b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
    const form = b.el.querySelector("form.sb-editor");
    const rows = () => form.querySelectorAll(".sb-file").map((/** @type {any} */ r) => [r.querySelector(".sb-file-name").textContent, r.querySelector(".sb-file-size").textContent]);
    assert.deepEqual(rows(), [["logo.png", "2 KB"], ["data.zip", "5 MB"]]);
    assert.deepEqual(form.querySelectorAll("a.sb-file-name").map((/** @type {any} */ a) => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("download")]), [["/f/t1/fa", "_blank", null], ["/f/t1/fb", "_blank", "data.zip"]]);
    assert.equal(form.querySelector("img.sb-file-pic").getAttribute("src"), "/f/t1/fa");
    form.dispatch("paste", { clipboardData: { files: [new File(["p"], "image.png", { type: "image/png" })], getData: () => "" } });
    await until(() => did.attached.length === 1, "the paste attached");
    assert.match(did.attached[0][1][0], /^screenshot-\d+-1\.png$/, "a picture copied, named by the moment");
    await until(() => rows().length === 3, "drawn again from the answer");
    const had = doc.document.body.querySelectorAll(".zc-dialog-foot button").length;
    form.querySelector('[data-file="fa"] .sb-file-x').dispatch("click");
    const sure = /** @type {any} */ (await until(() => doc.document.body.querySelectorAll(".zc-dialog-foot button").length > had && doc.document.body.querySelectorAll(".zc-dialog-foot button").filter((/** @type {any} */ x) => x.textContent === "Remove").at(-1), "asked once more"));
    assert.equal(did.writes.length, 0, "asked first");
    sure.dispatch("click");
    await until(() => did.writes.length === 1, "the remove");
    assert.deepEqual(did.writes[0], ["DELETE", "/tasks/t1/files/fa", undefined]);
    await until(() => rows().length === 1, "drawn again");
    assert.equal(b.el.querySelector("form.sb-editor"), form, "the card stays open");
  });

  // (fails before: yes — a Hunter's of 11-02: Start a chat on this… handed on the task as its card was drawn, so a file
  // attached to it open in place, or since its card was drawn, never reached the chat's box)
  test("Start a chat on this… hands on the task as it stands: a file just attached to it open in place, or since its card was drawn, goes along", async () => {
    const shot = fileOf("fa", "shot.png", "image", 2048);
    const { b, did } = mountBoard([task({ id: "t1", title: "Logo" }), task({ id: "t2", title: "Copy", at: NOW - 2 * HOUR })], { attached: (t) => ({ ...t, files: [shot] }) });
    b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
    const form = b.el.querySelector("form.sb-editor");
    form.dispatch("drop", { dataTransfer: { types: ["Files"], files: [new File(["p"], "shot.png", { type: "image/png" })] } });
    await until(() => form.querySelectorAll(".sb-file").length === 1, "the file listed");
    button(form, "Start a chat on this…").dispatch("click");
    assert.deepEqual(did.startedWith.map((t) => [t.id, (t.files || []).map((f) => f.name)]), [["t1", ["shot.png"]]]);
    // Another card's ⋯, drawn before the Space moved while a card was open in place, hands on the task as it is now.
    b.el.querySelector('[data-task="t1"] .sb-face').dispatch("click");
    b.paint([task({ id: "t1", title: "Logo", files: [shot] }), task({ id: "t2", title: "Copy", at: NOW - 2 * HOUR, files: [fileOf("fb", "notes.md", "text", 30)] })]);
    press(await dotsOf(b, "t2"), "Start a chat on this…");
    assert.deepEqual(did.startedWith.map((t) => [t.id, (t.files || []).map((f) => f.name)]).at(-1), ["t2", ["notes.md"]]);
  });

  // (fails before: yes — a Hunter's of 11-02: a file from the computer dropped on the board off a card was the browser's
  // to open, in Filament's place)
  test("files dropped on the board but on no card are refused, not opened in the page's place; a card's own drop stays its", () => {
    const { b, did } = mountBoard([task({ id: "t1", title: "Logo" })]);
    /** A drag's event over the board, `taken` where a card took it first; `stopped`, its default refused. @param {string} type @param {boolean} taken @param {string} [kind] */
    const heard = (type, taken, kind = "Files") => {
      const said = { stopped: 0, dataTransfer: { types: [kind], files: [new File(["p"], "a.png")], dropEffect: "copy" } };
      b.el.dispatch(type, { dataTransfer: said.dataTransfer, defaultPrevented: taken, preventDefault: () => void (said.stopped += 1) });
      return said;
    };
    const over = heard("dragover", false);
    assert.deepEqual([over.stopped, over.dataTransfer.dropEffect], [1, "none"], "the drag says no drop here");
    assert.equal(heard("drop", false).stopped, 1, "the browser does not open it");
    const taken = heard("dragover", true);
    assert.deepEqual([taken.stopped, taken.dataTransfer.dropEffect], [0, "copy"], "a card took it first: left as the card set it");
    assert.equal(heard("dragover", false, "text/plain").stopped, 0, "words dragged are no files");
    assert.deepEqual(did.attached, []);
  });

  test("a new task's files picked before it is: listed, one left out, the rest attached once Add makes it", async () => {
    const { b, did } = mountBoard([], { answer: (/** @type {string} */ m) => (m === "POST" ? { ok: true, task: task({ id: "t9", title: "Menu" }) } : { ok: true }) });
    b.add();
    const form = b.el.querySelector("form.sb-editor");
    form.querySelector("input.sb-in").value = "Menu";
    const pick = picker();
    try {
      button(form, "Attach files…").dispatch("click");
    } finally {
      pick.done();
    }
    pick.input.files = [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.txt")];
    pick.input.onchange();
    assert.deepEqual(form.querySelectorAll(".sb-file.is-picked .sb-file-name").map((/** @type {any} */ e) => e.textContent), ["a.png", "b.txt"]);
    assert.deepEqual(did.attached, [], "nothing attached before the task is made");
    form.querySelector(".sb-file.is-picked .sb-file-x").dispatch("click");
    form.dispatch("submit");
    await until(() => did.attached.length === 1, "attached once added");
    assert.deepEqual([did.writes[0][0], did.attached[0]], ["POST", ["t9", ["b.txt"]]]);
  });

  /** What happened on the page, with what it did. @param {{ write?: (text: string) => any, lanes?: LaneRef[], card?: any }} [o] */
  const mountLog = (o = {}) => {
    const did = { wrote: /** @type {string[]} */ ([]), copied: 0, told: 0, opened: /** @type {string[]} */ ([]) };
    const l = logbookPanel({
      lanes: () => o.lanes || [MAIN, UX],
      ...(o.card ? { card: o.card } : {}),
      nameOf,
      laneOf: (c) => [MAIN, UX].find((x) => x.chains.includes(c)) || null,
      write: async (text) => (did.wrote.push(text), o.write ? o.write(text) : { ok: true }),
      copyWeek: () => void did.copied++,
      tell: () => void did.told++,
      openChat: (c) => void did.opened.push(c),
      now,
    });
    doc.document.body.append(l.el);
    return { l, did };
  };
  const LOG = [
    { id: "e1", at: MON - 5 * 24 * HOUR, by: { kind: "keeper" }, text: "Last week: 4 tasks done · 1 waits for you · 2 parked.", task: null },
    { id: "e2", at: NOW - 2 * HOUR, by: { kind: "agent", chain: "c1" }, text: "Now list built.", task: null },
    { id: "e3", at: NOW - HOUR, by: { kind: "sync" }, text: "Told 2 chats: opus55, HarnessV3_Impl.", task: null },
    { id: "e4", at: NOW - 30 * 60_000, by: { kind: "agent", chain: "c2", name: "Builder" }, text: "May I delete 3 old snapshots?", task: null },
    { id: "e5", at: NOW - 20 * 60_000, by: { kind: "filament", chain: "c3" }, text: "“a side chat” finished 2 turns since 10:20 in ux-overhaul: 1 file changed, not committed", task: null, key: "finished:c3", since: NOW - 40 * 60_000, turns: 2 },
    { id: "e6", at: NOW - 10 * 60_000, by: { kind: "you" }, text: "Keep the header.", task: null },
  ];

  test("What happened: newest first — when, the words, where each came from — an agent's after its chat; one lane's alone; this week copied", async () => {
    const { l, did } = mountLog();
    l.paint(LOG, 4);
    const rows = () => l.el.querySelectorAll("article.sl-entry").map((/** @type {any} */ a) => [a.querySelector(".sl-when").textContent, a.getAttribute("class"), a.querySelector(".sl-text").textContent, a.querySelector(".sl-tag").textContent]);
    assert.deepEqual(rows(), [
      ["10:50", "sl-entry is-note", "You: “Keep the header.”", "note"],
      // A line with no name before it is Filament's: its tag says no word, its lane's chip alone.
      ["10:40", "sl-entry is-filament", "“a side chat” finished 2 turns since 10:20 in ux-overhaul: 1 file changed, not committed", "ux-overhaul"],
      ["10:30", "sl-entry is-agent", "Builder · for HarnessV3_Impl: May I delete 3 old snapshots?", "ux-overhaul"],
      ["10:00", "sl-entry is-told", "Told 2 chats: opus55, HarnessV3_Impl.", "told"],
      ["09:00", "sl-entry is-agent", "opus55: Now list built.", "main"],
      ["7 Oct", "sl-entry is-week", "Last week: 4 tasks done · 1 waits for you · 2 parked.", "week"],
    ]);
    assert.equal(l.el.querySelector(".sl-today").textContent, "today 5");
    assert.deepEqual(texts(l.el, ".sl-older"), ["4 older lines kept; the agents can still read them."]);
    l.el.querySelector('[data-entry="e2"] button.sl-who').dispatch("click");
    assert.deepEqual(did.opened, ["c1"], "a chat's name opens it");
    l.el.querySelector(".sl-menu").dispatch("click");
    await until(() => doc.document.body.querySelector(".zc-menu"), "the menu");
    const items = doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item");
    assert.deepEqual(items.map((/** @type {any} */ i) => i.textContent.trim()).slice(1, 4), ["All lanes", "main", "ux-overhaul"]);
    items[3].dispatch("click");
    assert.deepEqual(rows().map((r) => r[2].slice(0, 12)), ["“a side chat", "Builder · fo"], "one lane's chats alone");
    assert.equal(l.el.querySelector(".sl-only").textContent, "ux-overhaul");
    l.el.querySelector(".sl-menu").dispatch("click");
    await until(() => doc.document.body.querySelector(".zc-menu"), "the menu again");
    const copy = /** @type {any} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item").find((/** @type {any} */ i) => /Copy this week/.test(i.textContent)));
    copy.dispatch("click");
    assert.equal(did.copied, 1);
  });

  // (fails before: yes — Tell the chats… was a button of the head, as heavy there as Add a note…)
  test("Tell the chats… is the first row of What happened's ⋯, with what its card does; Add a note… stays in the head", async () => {
    const { l, did } = mountLog();
    l.paint(LOG, 0);
    assert.deepEqual(l.el.querySelector(".sl-acts").querySelectorAll("button").map((/** @type {any} */ b) => b.getAttribute("class")), ["ghost sm sl-note", "ghost icon sl-menu"], "Add a note… and ⋯");
    assert.equal(l.el.querySelector(".sl-tell"), null, "no button of its own");
    assert.equal(l.el.querySelector(".sl-menu").getAttribute("aria-label"), "More: tell the chats, one lane's lines, or copy this week");
    l.el.querySelector(".sl-menu").dispatch("click");
    await until(() => doc.document.body.querySelector(".zc-menu"), "the menu");
    const items = /** @type {any} */ (doc.document.body.querySelectorAll(".zc-menu").at(-1)).querySelectorAll(".zc-menu-item");
    assert.deepEqual([items[0].querySelector(".zc-menu-label-line").textContent, items[0].querySelector(".zc-menu-desc").textContent],
      ["Tell the chats…", "Each agent reads the board and what the others wrote, then writes what changes for it: nothing is sent until you press Tell them"]);
    assert.deepEqual(items.slice(1).map((/** @type {any} */ i) => (i.querySelector(".zc-menu-label-line") || i).textContent.trim()), ["All lanes", "main", "ux-overhaul", "Copy this week"]);
    items[0].dispatch("click");
    assert.equal(did.told, 1, "it opens the card; nothing is sent");
  });

  // (fails before: yes — every line was cut at four, Filament's own as long as a chat's, and none opened)
  test("What happened's lines are short: Filament's own one line, every other two; a press on a line's words opens it whole, a second closes it — Enter and Space too —; a chat's name inside still opens its chat", () => {
    const { l, did } = mountLog();
    l.paint(LOG, 0);
    /** @param {string} id @returns {any} */
    const entry = (id) => l.el.querySelector(`[data-entry="${id}"]`);
    /** @param {string} id @returns {any} */
    const words = (id) => entry(id).querySelector(".sl-text");
    assert.deepEqual([words("e5").getAttribute("role"), words("e5").getAttribute("tabindex"), words("e5").getAttribute("aria-expanded"), words("e5").getAttribute("title")], ["button", "0", "false", LOG[4].text],
      "its words a button, closed; the tip keeps the whole text");
    words("e5").dispatch("click");
    assert.deepEqual([entry("e5").getAttribute("class"), words("e5").getAttribute("aria-expanded")], ["sl-entry is-filament is-open", "true"]);
    assert.equal(entry("e4").getAttribute("class"), "sl-entry is-agent", "the others stand as they were");
    words("e5").dispatch("click");
    assert.deepEqual([entry("e5").getAttribute("class"), words("e5").getAttribute("aria-expanded")], ["sl-entry is-filament", "false"], "a second press closes it");
    // From the keyboard: Enter and Space, which scrolls nothing; another key does nothing.
    let prevented = 0;
    const key = (/** @type {string} */ k) => words("e2").dispatch("keydown", { key: k, preventDefault: () => void prevented++ });
    key("Enter");
    assert.equal(entry("e2").classList.contains("is-open"), true);
    key(" ");
    assert.equal(entry("e2").classList.contains("is-open"), false);
    key("a");
    assert.deepEqual([entry("e2").classList.contains("is-open"), prevented], [false, 2]);
    // A chat's name inside opens its chat and toggles nothing: its press and its key reach the words too, as a page's do.
    const who = entry("e2").querySelector("button.sl-who");
    who.dispatch("click");
    words("e2").dispatch("click", { target: who });
    words("e2").dispatch("keydown", { key: "Enter", target: who });
    assert.deepEqual([did.opened, entry("e2").classList.contains("is-open")], [["c1"], false]);
    // A press that ends a selection of a line's words — dragged over, to copy them — is no press on them.
    const hadSel = g.getSelection;
    g.getSelection = () => ({ toString: () => "finished 2 turns" });
    try {
      words("e5").dispatch("click");
      assert.equal(entry("e5").classList.contains("is-open"), false, "the line stands as it was under a selection");
    } finally {
      if (hadSel === undefined) delete g.getSelection;
      else g.getSelection = hadSel;
    }
    words("e5").dispatch("click");
    assert.equal(entry("e5").classList.contains("is-open"), true, "no selection: it opens");
    words("e5").dispatch("click");
    // A line that lands leaves an open one open.
    words("e4").dispatch("click");
    l.paint([...LOG, { id: "e7", at: NOW - 60_000, by: { kind: "you" }, text: "Later.", task: null }], 0);
    assert.deepEqual([entry("e4").classList.contains("is-open"), words("e4").getAttribute("aria-expanded")], [true, "true"]);
    // The sheet cuts a line by who wrote it — its entry's class —, never by what it says.
    const css = readFileSync(new URL("../src/ui/harness/space/space.css", import.meta.url), "utf8");
    assert.match(css, /\n\.sl-text \{[^}]*-webkit-line-clamp: 2;[^}]*\}/);
    assert.match(css, /\n\.sl-entry\.is-filament \.sl-text \{ -webkit-line-clamp: 1; \}\n/);
    assert.match(css, /\n\.sl-entry\.is-open \.sl-text \{ -webkit-line-clamp: unset; \}\n/);
  });

  // (fails before: yes — its lines said "Filament" at their right, a word on most lines of a Space at work)
  test("a line's tag: none on Filament's own nor on a chat's — a lane's chip where there are two —; a note, a telling, the week and another machine say theirs", () => {
    const { l } = mountLog();
    l.paint([...LOG, { id: "e8", at: NOW - 5 * 60_000, by: { kind: "machine", name: "Studio", who: "Builder" }, text: "Merged the login flow.", task: null },
      { id: "e9", at: NOW - 4 * 60_000, by: { kind: "filament", name: "Deploys" }, text: "CI failed on main.", task: null }], 0);
    const tags = Object.fromEntries(l.el.querySelectorAll("article.sl-entry").map((/** @type {any} */ a) => [a.getAttribute("data-entry"), a.querySelector(".sl-tag").textContent]));
    assert.deepEqual(tags, { e1: "week", e2: "main", e3: "told", e4: "ux-overhaul", e5: "ux-overhaul", e6: "note", e8: "another machine", e9: "" });
  });

  // (fails before: yes — the list held every line the Space sent, in a scroller of its own inside the page's)
  test("What happened holds the newest 12, then Show all N — all of them while the page is open — and Show the newest 12 back; one lane's lines counted alone; one scroller, the page's", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, at: NOW - (40 - i) * 60_000, by: { kind: "agent", chain: i % 3 ? "c1" : "c2" }, text: `line ${i}`, task: null }));
    const { l } = mountLog();
    l.paint(many, 4);
    const ids = () => l.el.querySelectorAll("article.sl-entry").map((/** @type {any} */ a) => a.getAttribute("data-entry"));
    /** @returns {any} */
    const more = () => l.el.querySelector(".sl-more");
    assert.deepEqual([ids().length, ids()[0], ids().at(-1), more().textContent, more().tagName], [12, "m29", "m18", "Show all 30", "BUTTON"]);
    assert.deepEqual(texts(l.el, ".sl-older"), [], "the word on older lines waits for the whole list");
    const was = more();
    was.dispatch("click");
    assert.deepEqual([ids().length, ids().at(-1), more().textContent, more() === was], [30, "m0", "Show the newest 12", true], "all of them, the button the one that stood");
    assert.deepEqual(texts(l.el, ".sl-older"), ["4 older lines kept; the agents can still read them."]);
    // A line lands: all of them still, for as long as the page is open.
    l.paint([...many, { id: "m30", at: NOW - 60_000, by: { kind: "agent", chain: "c1" }, text: "line 30", task: null }], 4);
    assert.deepEqual([ids().length, ids()[0]], [31, "m30"]);
    more().dispatch("click");
    assert.deepEqual([ids().length, more().textContent], [12, "Show all 31"], "and back");
    // Narrowed to one lane: that lane's lines counted; twelve or fewer, no button.
    const pick = async (/** @type {string} */ label) => {
      l.el.querySelector(".sl-menu").dispatch("click");
      await until(() => doc.document.body.querySelector(".zc-menu"), "the menu");
      /** @type {any} */ (doc.document.body.querySelectorAll(".zc-menu").at(-1)).querySelectorAll(".zc-menu-item").find((/** @type {any} */ i) => i.textContent.trim() === label).dispatch("click");
    };
    await pick("main");
    assert.deepEqual([ids().length, more().textContent], [12, "Show all 21"], "main's 21 lines");
    await pick("ux-overhaul");
    assert.deepEqual([ids().length, more()], [10, null], "ux-overhaul's 10: all there, no button");
    const css = readFileSync(new URL("../src/ui/harness/space/space.css", import.meta.url), "utf8");
    assert.doesNotMatch(css, /\n\.sl-list \{[^}]*(?:max-height|overflow: auto)/, "no scroller of its own");
  });

  test("What happened under the board: the Tell the chats card under its head; with one lane, no lane's chip on a line (the owner's of 10-27)", () => {
    // (fails before: yes — the card stood under the board, above the button that opens it, and every line said its one lane)
    const card = doc.document.createElement("div");
    card.setAttribute("class", "sy-card");
    const { l } = mountLog({ lanes: [MAIN], card });
    assert.deepEqual(l.el.children.map((/** @type {any} */ c) => c.getAttribute("class")), ["sl-head", "sy-card", "sl-write", "sl-list"]);
    l.paint(LOG.filter((e) => e.id === "e2"), 0);
    assert.equal(l.el.querySelector(".sl-tag").textContent, "", "main, said on every line, is left out");
  });

  test("Add a note…: the field opens; Enter writes it, Shift+Enter does not, Escape lets it go; a refused one stays, said", async () => {
    let answer = /** @type {any} */ ({ ok: true });
    const { l, did } = mountLog({ write: () => answer });
    l.paint([], 0);
    assert.match(l.el.querySelector(".sl-empty").textContent, /^Nothing yet\. As the chats here finish their turns, Filament says so here/);
    assert.equal(l.el.querySelector(".sl-write").hasAttribute("hidden"), true, "folded until Add a note…");
    button(l.el, "Add a note…").dispatch("click");
    assert.equal(l.el.querySelector(".sl-write").hidden, false);
    const field = l.el.querySelector("textarea.sl-field");
    field.value = "Merge ux first.";
    field.dispatch("keydown", { key: "Enter", shiftKey: true });
    field.dispatch("keydown", { key: "Enter" });
    await until(() => field.value === "", "written and cleared");
    assert.deepEqual([did.wrote, l.el.querySelector(".sl-write").hidden], [["Merge ux first."], true]);
    button(l.el, "Add a note…").dispatch("click");
    answer = null;
    field.value = "Again";
    field.dispatch("keydown", { key: "Enter" });
    await until(() => l.el.querySelector(".sl-said").textContent === "Not written", "said");
    assert.equal(field.value, "Again");
    field.dispatch("keydown", { key: "Escape" });
    assert.deepEqual([l.el.querySelector(".sl-write").hidden, field.value, did.wrote.length], [true, "", 2]);
  });

  // (fails before: yes — the bug hunt of 10-30, UIC-5: the note was written on the Enter that ends an input method's word
  // where the browser says it by keyCode 229 alone, as Windows' IMEs do — the chat's own box never sends on it)
  test("Add a note…: the Enter that ends an input method's word writes nothing; the next Enter writes it", async () => {
    const { l, did } = mountLog({ write: () => ({ ok: true }) });
    l.paint([], 0);
    button(l.el, "Add a note…").dispatch("click");
    const field = l.el.querySelector("textarea.sl-field");
    field.value = "日本語で";
    field.dispatch("keydown", { key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(did.wrote, [], "the word ended; nothing written");
    field.dispatch("keydown", { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 });
    await until(() => field.value === "", "written and cleared");
    assert.deepEqual(did.wrote, ["日本語で"]);
  });

  /** The Sync card on the page, with what it did. @param {any[]} chats @param {{ run?: (body: any) => any, plain?: boolean }} [o] */
  const mountSync = (chats, o = {}) => {
    const did = { runs: /** @type {any[]} */ ([]) };
    const s = syncCard({
      chats: () => chats,
      plain: () => o.plain === true,
      last: () => ({ id: "s0", at: NOW - 2 * HOUR, also: "", lanes: [] }),
      run: async (body) => (did.runs.push(body), o.run ? o.run(body) : null),
      nameOf,
      now,
    });
    doc.document.body.append(s.el);
    return { s, did };
  };
  const CHATS = [
    { chain: "c1", name: "opus55", chip: "main", main: true, works: true, lead: true },
    { chain: "c2", name: "HarnessV3_Impl's lead", chip: "ux-overhaul", main: false, works: false, lead: true },
    { chain: "c3", name: "a side chat", chip: "ux-overhaul", main: false, works: false, lead: false },
  ];

  // (fails before: yes — the Designer's walk of 10-29: Home life said "what the other lanes wrote… Adds one message to each
  // lane's chat — their cache stays warm", each chat with its folder's chip, and What happened's ⋯ offered "All lanes")
  test("a Space with no repository says chats, not lanes: Tell the chats, with no chip or cache; What happened's ⋯ offers no lane, only Tell the chats… and the week's copy", () => {
    const { s } = mountSync([{ chain: "c1", name: "Plan the week", chip: "Home life", main: true, works: false, lead: true }], { plain: true });
    s.open();
    assert.match(s.el.querySelector(".sy-line").textContent, /^Each agent reads the board and what the other chats wrote since /);
    assert.deepEqual(texts(s.el, ".sy-words .sp-quiet").slice(-1), ["Adds one message to each chat you tick."]);
    assert.equal(s.el.querySelector(".sy-row .sp-branch"), null, "no folder's chip");
    const { l } = mountLog({ lanes: [MAIN] });
    l.el.querySelector(".sl-menu").dispatch("click");
    const items = /** @type {any} */ (doc.document.body.querySelectorAll(".zc-menu").at(-1)).querySelectorAll(".zc-menu-item").map((/** @type {any} */ i) => i.textContent.trim());
    assert.ok(!items.includes("All lanes"), "one place: no lane to pick");
    assert.deepEqual(items.map((/** @type {string} */ t) => t.slice(0, 14)), ["Tell the chats", "Copy this week"]);
    // (fails before: yes — the reviewer, 10-29: a lane picked while there were two stayed picked once one went, with no
    // All lanes left to undo it)
    const lanes = [MAIN, UX];
    const two = mountLog({ lanes });
    two.l.paint(LOG.map((e) => ({ ...e })), 0);
    two.l.el.querySelector(".sl-menu").dispatch("click");
    /** @type {any} */ (doc.document.body.querySelectorAll(".zc-menu").at(-1)).querySelectorAll(".zc-menu-item").find((/** @type {any} */ i) => i.textContent.trim() === "main").dispatch("click");
    assert.equal(two.l.el.querySelector(".sl-only").hidden, false, "one lane's lines");
    lanes.pop();
    two.l.tick();
    assert.equal(two.l.el.querySelector(".sl-only").hidden, true, "one lane left: all its lines again");
    assert.ok(items.some((/** @type {string} */ t) => t.startsWith("Copy this week")));
  });

  test("Tell the chats… opens the card and nothing is sent: each lane's chat ticked, when it hears it, the others under More chats", async () => {
    const { s, did } = mountSync(CHATS);
    assert.equal(s.el.hasAttribute("hidden"), true, "hidden until Tell the chats…");
    s.open();
    assert.equal(s.el.hidden, false);
    assert.deepEqual(did.runs, [], "opening runs nothing");
    assert.match(s.el.querySelector(".sy-line").textContent, /what the other lanes wrote since 09:00, then writes what changes for it\. Nothing else is touched\.$/);
    assert.equal(s.el.querySelector(".sy-title b").textContent, "Tell the chats");
    const rows = () => s.el.querySelectorAll("label.sy-row").map((/** @type {any} */ r) => [r.getAttribute("data-chain"), r.querySelector("input").hasAttribute("checked"), r.querySelector(".sy-name").textContent, r.querySelector("select")?.querySelector("option[selected]")?.textContent || r.lastElementChild.textContent]);
    assert.deepEqual(rows(), [["c1", true, "opus55", "after its turn ends"], ["c2", true, "HarnessV3_Impl's lead", "now"]]);
    button(s.el, "More chats (1)").dispatch("click");
    assert.deepEqual(rows().map((r) => [r[0], r[1]]), [["c1", true], ["c2", true], ["c3", false]]);
    // The person's choices: c2 unticked, c3 ticked, c1 now; then Tell them.
    const box = (/** @type {string} */ c) => s.el.querySelector(`label[data-chain='${c}']`).querySelector("input");
    box("c2").checked = false;
    box("c2").dispatch("change");
    box("c3").checked = true;
    box("c3").dispatch("change");
    const when = s.el.querySelector("label[data-chain='c1']").querySelector("select");
    when.value = "now";
    when.dispatch("change");
    s.el.querySelector("input.sy-also").value = "  Merge main first. ";
    button(s.el, "Tell them").dispatch("click");
    await until(() => did.runs.length === 1, "the run");
    assert.deepEqual(did.runs[0], { lanes: [{ chain: "c1", when: "now" }, { chain: "c3", when: "now" }], also: "Merge main first." });
    assert.equal(s.el.querySelector(".sy-said").textContent, "", "refused: said by the page's toast, the card still asks");
    assert.ok(s.el.querySelector(".sy-run"));
    button(s.el, "Cancel").dispatch("click");
    assert.equal(s.el.hidden, true);
  });

  test("once sent, the card says how each chat's went as the Space hears it; nothing ticked, Tell them is off", async () => {
    const sync = { id: "s1", at: NOW, also: "", lanes: [{ chain: "c1", when: "after", state: "waiting" }, { chain: "c2", when: "now", state: "sent" }] };
    /** @type {any} */
    const space = { project: "p1", seq: 3, tasks: [], log: [], logMore: 0, syncs: [sync], names: {}, waiting: ["c1"] };
    const { s, did } = mountSync(CHATS, { run: () => ({ ok: true, sync, space }) });
    s.open();
    button(s.el, "Tell them").dispatch("click");
    await until(() => s.el.querySelector(".sy-out"), "the outcome");
    const outs = () => s.el.querySelectorAll(".sy-row").map((/** @type {any} */ r) => [r.querySelector(".sy-name").textContent, r.querySelector(".sy-out").textContent]);
    assert.deepEqual(outs(), [["opus55", "waits for its turn to end"], ["HarnessV3_Impl", "sent as a turn of its own"]]);
    s.paint({ ...space, syncs: [{ ...sync, lanes: [{ ...sync.lanes[0], state: "sent" }, sync.lanes[1]] }], waiting: [] });
    assert.deepEqual(outs()[0], ["opus55", "sent as a turn of its own"], "followed as the Space moves");
    button(s.el, "Close").dispatch("click");
    assert.equal(s.el.hidden, true);
    assert.equal(did.runs.length, 1);
    const none = mountSync([{ ...CHATS[2] }]);
    none.s.open();
    assert.equal(none.s.el.querySelector(".sy-run").hasAttribute("disabled"), true);
    assert.deepEqual(texts(none.s.el, ".sy-none"), ["No chat works here yet."]);
  });

  test("what each lane changes (Compare…'s sheet): a file two lanes change first, in orange; each lane's by name; the merge order, read-only", () => {
    const o = ownersPanel();
    doc.document.body.append(o.el);
    o.paint([MAIN, UX], new Map(), false);
    assert.deepEqual(texts(o.el, ".so-list .sp-quiet"), ["Reading what each lane changed…"]);
    assert.equal(o.el.querySelector(".so-merge").hidden, true);
    const files = new Map([
      [placeKey(MAIN.path), filesOf(MAIN.path, ["src/ui/sidebar.js", "src/ui/header.js", "src/ui/harness.css"], { ahead: 0, commits: 0 })],
      [placeKey(UX.path), filesOf(UX.path, ["src/ui/settings/a.js", "src/ui/harness.css"], { ahead: 3 })],
    ]);
    o.paint([MAIN, UX], files, true);
    assert.deepEqual(o.el.querySelectorAll(".so-own").map((/** @type {any} */ x) => [x.getAttribute("class"), x.textContent]), [
      ["so-own is-shared", "harness.cssmain and ux-overhaul both change it"],
      ["so-own", "sidebar.js · header.jsmain"],
      ["so-own", "a.jsux-overhaul"],
    ]);
    assert.equal(o.el.querySelector(".so-merge").hidden, false);
    assert.deepEqual(texts(o.el, ".so-step"), ["ux-overhaul3 commits not on mainmeets 1 file another lane changed: harness.css"]);
    o.paint([MAIN, UX], new Map([[placeKey(MAIN.path), filesOf(MAIN.path, [])]]), true);
    assert.deepEqual(texts(o.el, ".so-list .sp-quiet"), ["No lane has changed a file yet."]);
  });

  test("a sync in the chat: Filament's capsule, what the agent read folded under it", () => {
    const row = syncRow({ syncText: "[Filament: a sync from this project's Space, which the person ran at 2026-10-14 10:00.\n\nThe board …]" });
    assert.equal(row.querySelector(".boundary-label").textContent, SYNCED_WORDS);
    assert.equal(row.querySelector("summary").textContent, "What the agent read");
    assert.equal(row.querySelector(".sync-text").textContent, "a sync from this project's Space, which the person ran at 2026-10-14 10:00.\n\nThe board …");
    assert.equal(syncRow({}).querySelector("details"), null);
  });
});
