// @ts-check
// proposal_ux §4.14, U5 phase 8 v1 to v3: a project's Space on Filament's side. Its words and checks (core/space.js), the
// store that keeps one per project (services/spaces.js) with the Record keeper's weekly line, the agents' `space` tool
// on both engines (app/agent/space.js, agent-tools.js, the MCP server's words), the sync runner (app/space-sync.js) over
// a stand-in for the chats it reaches, the admin routes the page reads and writes through (http/admin/spaces.js), and
// What happened filling itself on a turn's end (app/space-news.js, HarnessV4_Space_Plan S1) over stand-in places.
// (fails before: yes — the Space kept nothing; its page drew lanes alone; S1: claims, no line of Filament's own)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SPACE_LIMITS,
  SYNC_HEAD,
  SYNC_NEWS_MAX,
  FOLD_MS,
  boardWords,
  draftsWords,
  emptySpace,
  entryText,
  finishedWords,
  isSyncMessage,
  logWords,
  momentWords,
  needsWords,
  noteFinished,
  placeFacts,
  placesNews,
  readerNames,
  reproFields,
  spaceMarkdown,
  spanWords,
  syncMessage,
  taskFields,
  weekStart,
  weekWords,
} from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { routineFields, routinesWords } from "../src/core/routines.js";
import { grantOf } from "../src/core/dashboard-sources.js";
import { READ_LINES, SPACE_OFF, SPACE_SWITCHED_OFF, SPACE_TOOL, spaceCall, spaceProjectOf } from "../src/app/agent/space.js";
import { SYNC_LANES_MAX, createSpaceSync } from "../src/app/space-sync.js";
import { createSpaceNews } from "../src/app/space-news.js";
import { LOG_SHOWN, spaceRoutes } from "../src/http/admin/spaces.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createRouter } from "../src/http/router.js";
import { serverInstructions } from "../src/http/mcp.js";
import { boardColumns } from "../src/ui/harness/lib/space-view.js";

/** Moments in the week of Monday 12 October 2026, on this machine's clock. */
const MON = new Date(2026, 9, 12, 0, 0).getTime();
const WED = new Date(2026, 9, 14, 10, 0).getTime();
const THU = new Date(2026, 9, 15, 16, 0).getTime();
const NEXT_MON = new Date(2026, 9, 19, 9, 0).getTime();
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Wire the lanes", c2: "Settings move", c3: "Docs" });
const nameOf = (/** @type {string} */ c) => NAMES[c] || "an untitled chat";

/** A clock a test moves by hand. @param {number} at */
const clockAt = (at) => {
  const c = { at, now: () => c.at };
  return c;
};
/** A store in memory, with its events heard. @param {number} [at] */
const memoryStore = (at = WED) => {
  const clock = clockAt(at);
  /** @type {any[]} */
  const heard = [];
  const store = createSpaceStore({ dir: null, events: { publish: (topic, p) => heard.push([topic, p]) }, now: clock.now });
  return { store, clock, heard };
};
/** @param {() => any} fn */
const refusalOf = (fn) => {
  try {
    fn();
  } catch (/** @type {any} */ e) {
    return [e.status, e.message];
  }
  assert.fail("refused");
};

describe("a Space's words and checks", () => {
  test("a task's fields: a new one's all, Planned unless it says; a change's those given; each checked in words", () => {
    assert.deepEqual(taskFields({ title: "  Fix   the\nredirect " }, { create: true }), {
      ok: true,
      fields: { title: "Fix the redirect", line: "", column: "planned", parked: false, chain: null, place: null },
    });
    assert.deepEqual(taskFields({ line: "now with tests", column: "Done" }, { create: false }), { ok: true, fields: { line: "now with tests", column: "done" } });
    assert.deepEqual(taskFields({ to: "waits" }, { create: false }), { ok: true, fields: { column: "waits" } }, "`to` as the tool says it");
    assert.match(/** @type {any} */ (taskFields({ title: " " }, { create: true })).error, /needs a title/);
    assert.match(/** @type {any} */ (taskFields({ title: "x".repeat(SPACE_LIMITS.title + 1) }, { create: true })).error, /120 characters at most; this one is 121/);
    assert.match(/** @type {any} */ (taskFields({ title: "t", column: "later" }, { create: true })).error, /planned, doing, waits, done; "later" is none of them/);
    assert.match(/** @type {any} */ (taskFields({ parked: "yes" }, { create: false })).error, /parked is true or false/);
    assert.match(/** @type {any} */ (taskFields([], { create: true })).error, /a JSON object/);
  });

  test("a logbook line: tidied, refused when empty or too long", () => {
    assert.deepEqual(entryText(" did  it\r\n\n\n\nnext "), { ok: true, text: "did it\n\nnext" });
    assert.match(/** @type {any} */ (entryText("  ")).error, /needs words/);
    assert.match(/** @type {any} */ (entryText("x".repeat(SPACE_LIMITS.text + 1))).error, /say it shorter/);
  });

  test("Filament's line on a chat's turns: what its place holds; one chat's lines within the hour grow into one, moved to the end", () => {
    const place = (/** @type {any} */ o) => ({ ok: true, path: "/r-wt", name: "r-wt", main: false, branch: "feat/login", base: "main", onBase: false, ahead: 0, uncommitted: { files: 0 }, ...o });
    assert.deepEqual(
      [placeFacts(place({ uncommitted: { files: 2 } })), placeFacts(place({ ahead: 1 })), placeFacts(place({ uncommitted: { files: 1 }, ahead: 3 })), placeFacts(place({})), placeFacts(place({ main: true, onBase: true })), placeFacts(place({ ok: false })), placeFacts(place({ missing: true }))],
      ["2 files changed, not committed", "1 commit not on main", "1 file changed, not committed, 3 commits not on main", "merged into main", "nothing uncommitted", null, null],
    );
    assert.equal(placeFacts(place({ fresh: true })), "nothing of its own yet", "a lane made a moment ago: not merged (seen live on S7)");
    assert.equal(finishedWords({ name: "login", turns: 1, since: WED, place: "feat/login", facts: "2 files changed, not committed" }), "“login” finished a turn in feat/login: 2 files changed, not committed");
    assert.equal(finishedWords({ name: "login", turns: 3, since: WED, place: null, facts: null }), "“login” finished 3 turns since 10:00");
    const doc = emptySpace();
    doc.log.push({ id: "e1", at: WED - 1, by: { kind: "you" }, text: "a note", task: null });
    const a = noteFinished(doc, { chain: "c1", name: "login", place: "feat/login", facts: null }, WED, "e2");
    noteFinished(doc, { chain: "c2", name: "docs", place: null, facts: null }, WED + 60_000, "e3");
    const b2 = noteFinished(doc, { chain: "c1", name: "login", place: "feat/login", facts: "1 commit not on main" }, WED + 20 * 60_000, "e4");
    assert.deepEqual([a.id, b2.id, b2.turns, b2.since, b2.by], ["e2", "e2", 2, WED, { kind: "filament", chain: "c1" }], "the same line, grown");
    assert.deepEqual(doc.log.map((e) => [e.id, e.text]), [
      ["e1", "a note"],
      ["e3", "“docs” finished a turn"],
      ["e2", "“login” finished 2 turns since 10:00 in feat/login: 1 commit not on main"],
    ]);
    const later = noteFinished(doc, { chain: "c1", name: "login", place: null, facts: null }, WED + FOLD_MS, "e5");
    assert.deepEqual([later.id, later.turns, doc.log.length], ["e5", 1, 4], "an hour after its first turn: a new line");
  });

  // (fails before: yes — d-send's two sentences: the lines said "A new lane", "The lane … was removed" of every worktree,
  // a chat's or not)
  test("what the worktrees did, from two reads of the places: made, removed, merged — never said a lane; the first read only learns", () => {
    const at = (/** @type {string} */ path, /** @type {any} */ o) => ({ ok: true, path, name: path.split("/").at(-1), main: false, branch: null, base: "main", onBase: false, ahead: 0, ...o });
    const first = placesNews(null, [at("/R", { main: true, branch: "main", onBase: true }), at("/r-login", { branch: "feat/login", ahead: 2 }), at("/r-docs", { branch: "docs", ahead: 1 })]);
    assert.deepEqual(first.lines, [], "the first read only learns");
    assert.deepEqual(first.seen["/r-login"], { branch: "feat/login", base: "main", ahead: 2, main: false });
    assert.deepEqual(Object.keys(first.seen), ["/r", "/r-login", "/r-docs"], "a folder by any spelling of it");
    const next = placesNews(first.seen, [
      at("/r", { main: true, branch: "main", onBase: true }),
      at("/r-login", { branch: "feat/login", ahead: 0 }),
      at("/r-new", { branch: "feat/new" }),
      at("/r-gone", { branch: "x", missing: true }),
    ]);
    assert.deepEqual(next.lines, ["feat/login was merged into main", "A new worktree: feat/new", "The worktree docs was removed"]);
    assert.deepEqual(placesNews(next.seen, [at("/r", { main: true, branch: "main" }), at("/r-login", { branch: "feat/login", ahead: 0 }), at("/r-new", { branch: "feat/new", ok: false })]).lines, [], "git that could not read a place keeps what was seen");
  });

  test("weeks and spans: a week begins Monday 00:00 here; a span in hours, then days", () => {
    assert.equal(weekStart(WED), MON);
    assert.equal(weekStart(MON), MON);
    assert.equal(weekStart(MON - 1), new Date(2026, 9, 5).getTime(), "Sunday night is the week before");
    assert.deepEqual([spanWords(20 * 60_000), spanWords(3_600_000), spanWords(30 * 3_600_000), spanWords(50 * 3_600_000)], ["under an hour", "1 hour", "30 hours", "2 days"]);
    assert.equal(momentWords(WED), "2026-10-14 10:00");
  });

  test("the Record keeper's line: what was done, what waits, what is parked, the longest; nothing for a quiet week", () => {
    const doc = emptySpace();
    const task = (/** @type {any} */ t) => ({ id: "t", title: "", line: "", column: "planned", parked: false, chain: null, place: null, by: { kind: "you" }, at: MON, movedAt: MON, startedAt: null, doneAt: null, ...t });
    doc.tasks.push(
      task({ id: "t1", title: "Wire the board", column: "done", startedAt: WED, doneAt: THU }),
      task({ id: "t2", title: "Quick one", column: "done", startedAt: THU, doneAt: THU + 3_600_000 }),
      task({ id: "t3", title: "Ask", column: "waits" }),
      task({ id: "t4", title: "Later", parked: true }),
      task({ id: "t5", title: "Old", column: "done", doneAt: MON - 1 }),
    );
    assert.equal(weekWords(doc, MON, MON + 7 * 86_400_000), "Last week: 2 tasks done · 1 waits for you · 1 parked. The longest: Wire the board (30 hours).");
    assert.equal(weekWords(emptySpace(), MON, MON + 7 * 86_400_000), null);
    const wrote = emptySpace();
    wrote.log.push({ id: "e1", at: WED, by: { kind: "you" }, text: "planned", task: null });
    assert.equal(weekWords(wrote, MON, MON + 7 * 86_400_000), "Last week: 0 tasks done · 0 wait for you · 0 parked.");
  });

  test("the board as an agent reads it: its columns counted, whose each task is — yours said so —, Done only this week's", () => {
    const { store } = memoryStore();
    store.addTask("p1", { title: "Wire the board", line: "lanes first", column: "doing", chain: "c1" }, { kind: "you" });
    store.addTask("p1", { title: "Docs", place: "/r-docs" }, { kind: "you" });
    store.addTask("p1", { title: "Snapshots", column: "waits", chain: "c2", parked: true }, { kind: "you" });
    const old = store.addTask("p1", { title: "Old", column: "done" }, { kind: "you" });
    const doc = structuredClone(store.get("p1"));
    /** @type {any} */ (doc.tasks.find((t) => t.id === old.id)).doneAt = MON - 1;
    assert.equal(
      boardWords(doc, { nameOf, now: WED, self: "c1" }),
      [
        "The board (Planned 1 · Doing 1 · Waits for you 1 · Done this week 0):",
        "Planned:",
        '- t2 "Docs" — planned for /r-docs',
        "Doing:",
        '- t1 "Wire the board" — you have it. lanes first',
        "Waits for you:",
        '- t3 "Snapshots" (parked) — Settings move has it',
      ].join("\n"),
    );
    assert.equal(boardWords(emptySpace(), { nameOf, now: WED }), "The board (Planned 0 · Doing 0 · Waits for you 0 · Done this week 0): no tasks yet.");
    // (fails before: yes — the agent read a board without the cards its dashboards put there: the Hunter on S4c)
    const fed = {
      tasks: [
        { title: "Issues", task: "Login loops", line: "bug", column: "doing", stale: false },
        { title: "Issues", task: "Retry", line: "", column: "planned", stale: true },
      ],
      counts: [{ title: "Issues", more: 3 }, { title: "CI", more: 0, error: "gh exited 4: not logged in" }],
    };
    assert.equal(
      boardWords(doc, { nameOf, now: WED, self: "c1", fed }),
      [
        "The board (Planned 1 + 1 from dashboards · Doing 1 + 1 from dashboards · Waits for you 1 · Done this week 0):",
        "Planned:",
        '- t2 "Docs" — planned for /r-docs',
        '- from Issues: "Retry" (as last read: its read since failed)',
        "Doing:",
        '- t1 "Wire the board" — you have it. lanes first',
        '- from Issues: "Login loops". bug',
        "Waits for you:",
        '- t3 "Snapshots" (parked) — Settings move has it',
        "A card from a dashboard is a row of its service, as Filament read it: it moves in that service, not with take or move.",
        "Issues has 3 more open rows than the board shows.",
        "CI read nothing yet: gh exited 4: not logged in",
      ].join("\n"),
    );
  });

  test("a sync's message: the board, the others' lines since this chat's last sync, the person's words; drawn as Filament's", () => {
    const doc = emptySpace();
    const line = (/** @type {number} */ at, /** @type {any} */ by, /** @type {string} */ text) => doc.log.push({ id: `e${doc.log.length}`, at, by, text, task: null });
    line(MON + 1000, { kind: "agent", chain: "c2" }, "before the last sync");
    line(WED - 60_000, { kind: "agent", chain: "c2" }, "moved Settings");
    line(WED - 50_000, { kind: "agent", chain: "c1" }, "my own line");
    line(WED - 40_000, { kind: "sync" }, "Ran a sync to 2 lanes");
    line(WED - 30_000, { kind: "you" }, "keep the header");
    line(WED + 60_000, { kind: "you" }, "after the sync was built");
    const text = syncMessage({ doc, chain: "c1", since: MON + 5000, also: "Merge main first.", at: WED, nameOf });
    assert.ok(text.startsWith(`${SYNC_HEAD}, which the person ran at 2026-10-14 10:00. It says what changed since this chat's last sync, at 2026-10-12 00:00.`));
    assert.match(text, /The other chats and the person wrote in the logbook:\n- 2026-10-14 09:59 Settings move: moved Settings\n- 2026-10-14 09:59 the person: keep the header\n/);
    assert.ok(!/before the last sync|my own line|Ran a sync|after the sync/.test(text), "nothing before its last sync, its own, a sync's, or after");
    assert.match(text, /\nThe person adds: Merge main first\.\n/);
    assert.ok(text.endsWith("Then go on with your work.]"));
    assert.equal(isSyncMessage({ role: "user", content: text }), true);
    assert.equal(isSyncMessage({ role: "user", content: [{ type: "image" }, { type: "text", text }] }), true);
    assert.equal(isSyncMessage({ role: "user", content: [{ type: "text", text }, { type: "text", text: "and mine" }] }), false, "the person's words after it");
    assert.equal(isSyncMessage({ role: "user", content: "[Filament: something else]" }), false);
    // The first sync says so; past the newest 40, how many earlier ones the tool reads.
    const many = emptySpace();
    for (let i = 0; i < SYNC_NEWS_MAX + 3; i++) many.log.push({ id: `e${i}`, at: MON + i * 60_000, by: { kind: "you" }, text: `line ${i}`, task: null });
    const first = syncMessage({ doc: many, chain: "c1", since: null, also: "", at: WED, nameOf });
    assert.match(first, /It says what changed since the Space began\./);
    assert.match(first, /\(the newest 40; 3 earlier lines your space tool reads with "since"\)/);
    assert.ok(!first.includes(": line 2\n") && first.includes(": line 3\n"));
    assert.match(syncMessage({ doc: emptySpace(), chain: "c1", since: null, also: "", at: WED, nameOf }), /Nothing new in the logbook from the other chats\./);
  });

  test("the week's page: the board's columns, then this week's logbook, as Markdown", () => {
    const { store } = memoryStore();
    store.addTask("p1", { title: "Wire the board", line: "lanes first", column: "doing", chain: "c1" }, { kind: "you" });
    store.write("p1", "Started on\nthe board", { kind: "agent", chain: "c1" });
    assert.equal(
      spaceMarkdown(store.get("p1"), { name: "filament", nameOf, now: WED }),
      [
        "# filament — its Space",
        "",
        "The week of 2026-10-12, as of 2026-10-14 10:00.",
        "",
        "## Planned\n\n_None._",
        "",
        "## Doing\n\n- **Wire the board** — Wire the lanes: lanes first",
        "",
        "## Waits for you\n\n_None._",
        "",
        "## Done this week\n\n_None._",
        "",
        "## The logbook this week",
        "",
        "- 2026-10-14 10:00 · Wire the lanes: Started on the board",
        "",
      ].join("\n"),
    );
  });
});

describe("the store", () => {
  const dirs = /** @type {string[]} */ ([]);
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "filament-spaces-"));
    dirs.push(d);
    return d;
  };

  test("each change counted, written whole and said on the stream; a new store reads it back", () => {
    const dir = tmp();
    const clock = clockAt(WED);
    /** @type {any[]} */
    const heard = [];
    const store = createSpaceStore({ dir, events: { publish: (topic, p) => heard.push([topic, p]) }, now: clock.now });
    const t = store.addTask("p1", { title: "Wire the board", column: "doing", chain: "c1" }, { kind: "you" });
    assert.deepEqual([t.id, t.column, t.chain, t.startedAt, t.doneAt, t.by], ["t1", "doing", "c1", WED, null, { kind: "you" }]);
    clock.at = THU;
    const done = store.changeTask("p1", "t1", { column: "done", line: "merged" });
    assert.deepEqual([done.column, done.line, done.startedAt, done.doneAt, done.movedAt], ["done", "merged", WED, THU, THU]);
    const back = store.changeTask("p1", "t1", { column: "doing" });
    assert.deepEqual([back.startedAt, back.doneAt], [WED, null], "Doing again keeps when it first began");
    const e = store.write("p1", "merged it", { kind: "agent", chain: "c1", name: "Builder" }, "t1");
    assert.deepEqual([e.id, e.task, e.by], ["e4", "t1", { kind: "agent", chain: "c1", name: "Builder" }]);
    assert.deepEqual(heard, [1, 2, 3, 4].map((seq) => ["space", { type: "space", project: "p1", seq }]));
    const file = join(dir, "p1.json");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).seq, 4);
    assert.deepEqual(createSpaceStore({ dir, now: clock.now }).get("p1"), store.get("p1"), "read back as it was");
    assert.equal(existsSync(`${file}.${process.pid}.tmp`), false);
  });

  // (fails before: yes — the owner's of 11-02, "the kanban inside space should be more powerful": a task had no place in
  // its column the person gave it, and a write naming one was taken as nothing)
  test("a task's place in its column: an order written ranks that column's tasks, read back from disk; a move to another column without one lets it go; Done keeps none; a bad order is refused", () => {
    const dir = tmp();
    const clock = clockAt(WED);
    const store = createSpaceStore({ dir, now: clock.now });
    for (const title of ["One", "Two", "Three"]) store.addTask("p1", { title }, { kind: "you" });
    store.addTask("p1", { title: "Wired", column: "doing" }, { kind: "you" });
    const ranks = () => Object.fromEntries(store.get("p1").tasks.map((t) => [t.id, t.rank ?? null]));
    clock.at = THU;
    // Another column's task and one that is gone are no part of Planned's order.
    const t = store.changeTask("p1", "t1", { order: ["t3", "t1", "t2", "t4", "t9"] });
    assert.deepEqual([t.column, t.movedAt], ["planned", WED], "placed, not moved");
    assert.deepEqual(ranks(), { t1: 1 - THU, t2: 2 - THU, t3: -THU, t4: null });
    assert.deepEqual(createSpaceStore({ dir, now: clock.now }).get("p1"), store.get("p1"), "read back as it was");
    clock.at = THU + 1000;
    store.changeTask("p1", "t2", { column: "doing", order: ["t2", "t4"] });
    assert.deepEqual(ranks(), { t1: 1 - THU, t2: -(THU + 1000), t3: -THU, t4: 1 - (THU + 1000) });
    store.changeTask("p1", "t2", { column: "waits" });
    store.changeTask("p1", "t3", { column: "done", order: ["t3"] });
    assert.deepEqual(ranks(), { t1: 1 - THU, t2: null, t3: null, t4: 1 - (THU + 1000) }, "moved on without a place; Done by when each was done");
    const said = `order is the ids of the column's tasks, top to bottom, "t1" among them`;
    assert.deepEqual(refusalOf(() => store.changeTask("p1", "t1", { order: ["t2"] })), [400, said]);
    assert.deepEqual(refusalOf(() => store.changeTask("p1", "t1", { order: "t1" })), [400, said]);
    assert.deepEqual(refusalOf(() => store.changeTask("p1", "t1", { order: ["t1", 2] })), [400, said]);
  });

  // (fails before: yes — the bug hunt of 11-02 on the board's drag: an order from a board drawn before a task came in
  // ranked only the ids it held, so the task that came in on top fell below them all)
  test("an order from a board drawn before a task came in keeps that task where it stood among them: on top where it came in on top, below the one it stood below", () => {
    const clock = clockAt(WED);
    const store = createSpaceStore({ dir: null, now: clock.now });
    for (const title of ["A", "B", "C"]) store.addTask("p1", { title, column: "doing" }, { kind: "you" });
    store.addTask("p1", { title: "D" }, { kind: "you" });
    /** Doing as the page's board shows it. */
    const doing = () => boardColumns(/** @type {any} */ (store.get("p1").tasks), WED)[1].tasks.map((t) => t.id);
    clock.at = WED + 60_000;
    store.changeTask("p1", "t1", { order: ["t1", "t2", "t3"] });
    // Another chat moves D into Doing: on top. The person's board, drawn before, moves C to the top of A, B, C.
    clock.at = WED + 120_000;
    store.changeTask("p1", "t4", { column: "doing" });
    assert.deepEqual(doing(), ["t4", "t1", "t2", "t3"]);
    clock.at = WED + 180_000;
    store.changeTask("p1", "t3", { order: ["t3", "t1", "t2"] });
    assert.deepEqual(doing(), ["t4", "t3", "t1", "t2"], "D stays on top");
    // Put between C and A from a fresh board; then a board drawn before that moves B to the top: D stays below C.
    clock.at = WED + 240_000;
    store.changeTask("p1", "t4", { order: ["t3", "t4", "t1", "t2"] });
    clock.at = WED + 300_000;
    store.changeTask("p1", "t2", { order: ["t2", "t3", "t1"] });
    assert.deepEqual(doing(), ["t2", "t3", "t4", "t1"], "D below C");
    // One moved in from another column at its place, from a board that never saw D: D keeps its place, the task placed
    // no mark for it.
    const e = store.addTask("p1", { title: "E" }, { kind: "you" }).id;
    clock.at = WED + 360_000;
    store.changeTask("p1", e, { column: "doing", order: ["t2", "t3", e, "t1"] });
    assert.deepEqual(doing(), ["t2", "t3", "t4", e, "t1"]);
  });

  // (fails before: yes — round 5's lead 1 of the 11-02 privacy round: the line said the chat's own words to the reader for
  // whom it is apart, `- 2026-10-14 10:00 Filament: “osprey numbers” finished a turn in feat/osprey: 2 files changed, not
  // committed`)
  test("Filament's line on a chat's turns keeps its place and facts, read back from disk; a reader for whom the chat is apart reads it under the name it reads", () => {
    const dir = tmp();
    const clock = clockAt(WED);
    const store = createSpaceStore({ dir, now: clock.now });
    store.happened("p1", { finished: [{ chain: "c2", name: "osprey numbers", place: "feat/osprey", facts: "2 files changed, not committed" }] });
    const log = createSpaceStore({ dir, now: clock.now }).get("p1").log;
    assert.equal(log[0].text, "“osprey numbers” finished a turn in feat/osprey: 2 files changed, not committed", "the person's page reads the chat's words");
    const c1 = readerNames({ nameOf, apart: (c) => c === "c2" }, "c1");
    assert.equal(logWords(log, c1.nameOf, c1.apart), "- 2026-10-14 10:00 Filament: “an untitled chat” finished a turn in feat/osprey: 2 files changed, not committed");
    const c2 = readerNames({ nameOf, apart: (c) => c === "c2" }, "c2");
    assert.equal(logWords(log, c2.nameOf, c2.apart), `- 2026-10-14 10:00 Filament: ${log[0].text}`, "its own chat reads its own words");
  });

  // (fails before: yes — round 7's lead 2 of the 11-02 privacy round: the store refused c2 naming c1 by its name then —
  // "r1 is Wire the lanes's routine: …", "n2 is Wire the lanes's ask: …" (twice), "n3 is done already, by Wire the
  // lanes: …", "“Brief” is paused already, by Wire the lanes: …", "Pause all is on already, …, by Wire the lanes: …")
  test("a refusal to a chat's agent names another chat whose words are none of its as an untitled chat; that chat's own agent, its own name", () => {
    const clock = clockAt(WED);
    const store = createSpaceStore({ dir: null, now: clock.now, apart: (c) => c === "c1" });
    const c1 = { chain: "c1", byName: "Wire the lanes" };
    const c2 = { chain: "c2", byName: "Settings move" };
    const r = store.routinePropose("p1", { title: "Brief", when: "weekdays 09:00", task: "Read CI.", writes: false }, { ...c1, model: "m" });
    const ask = store.askWrite("p1", { what: "tell", ...c1, why: "the API moved", chats: [{ chain: "c3", name: "Docs" }] }, "Tell Docs");
    store.routineOn("p1", r.id);
    store.routineStarted("p1", r.id, { at: WED, chain: "run1", by: "time" });
    store.routineEnded("p1", r.id, { at: WED, chain: "run1", by: "time", state: "failed", why: "401" });
    const failed = /** @type {any} */ (store.get("p1").needs.find((n) => n.kind === "routine"));
    store.needDoneBy("p1", failed.id, { ...c1, line: "fixed the key" });
    store.routinePause("p1", r.id, true, { ...c1, line: "CI is red" });
    store.pauseAll(true, { ...c1, line: "deploy freeze" });
    try {
      const said = [
        refusalOf(() => store.routinePropose("p1", { title: "Brief", when: "weekdays 09:00", task: "Read CI.", writes: false }, { ...c2, model: "m" }, r.id))[1],
        refusalOf(() => store.needDoneBy("p1", ask.id, { ...c2, line: "told" }))[1],
        refusalOf(() => store.askTakeBack("p1", ask.id, { chain: "c2" }))[1],
        refusalOf(() => store.needDoneBy("p1", failed.id, { ...c2, line: "again" }))[1],
        refusalOf(() => store.routinePause("p1", r.id, true, { ...c2, line: "again" }))[1],
        refusalOf(() => store.pauseAll(true, { ...c2, line: "again" }))[1],
      ];
      assert.deepEqual(said, [
        `${r.id} is an untitled chat's routine: propose one of your own.`,
        `${ask.id} is an untitled chat's ask: the person answers it, or an untitled chat takes it back.`,
        `${ask.id} is an untitled chat's ask: the person answers it, or an untitled chat takes it back.`,
        `${failed.id} is done already, by an untitled chat: fixed the key.`,
        "“Brief” is paused already, by an untitled chat: CI is red.",
        "Pause all is on already, since 10:00, by an untitled chat: deploy freeze.",
      ]);
      // A third chat, for which c1 is no other's: its name.
      const store3 = createSpaceStore({ dir: null, now: clock.now, apart: () => false });
      const r3 = store3.routinePropose("p1", { title: "Brief", when: "weekdays 09:00", task: "Read CI.", writes: false }, { ...c1, model: "m" });
      assert.equal(refusalOf(() => store3.routinePropose("p1", { title: "Brief", when: "weekdays 09:00", task: "Read CI.", writes: false }, { ...c2, model: "m" }, r3.id))[1], `${r3.id} is Wire the lanes's routine: propose one of your own.`);
    } finally {
      store.pauseAll(false);
    }
  });

  // (fails before: yes — round 8 of the 11-02 privacy round: each line was kept as its words alone, and the reader for
  // whom c1 is apart read c1's name in all eight: "Asks you to tell Wire the lanes and Docs: …", "You turned down Wire the
  // lanes's ask: …", "Wire the lanes's ask to switch on “Brief” went by itself: …", "Took back its ask to tell Wire the
  // lanes and Docs.", "You resumed “CI”, which Wire the lanes had paused: …", "Brought back “…”, which Wire the lanes had
  // marked done.", "Wire the lanes reproduced “PLAY-91 …”: …", "You resumed the routine “Brief”, which Wire the lanes had
  // paused: …")
  test("each line that names a chat keeps its parts, read back from disk: a reader for whom the chat is apart reads it as an untitled chat; the person's page and its own chat, by its name", () => {
    const dir = tmp();
    const clock = clockAt(WED);
    const store = createSpaceStore({ dir, now: clock.now });
    const c1 = { chain: "c1", byName: "Wire the lanes" };
    const c3 = { chain: "c3", byName: "Settings move" };
    const lanes = { chain: "c1", name: "Wire the lanes" };
    const tell = store.askWrite("p1", { what: "tell", ...c3, why: "the API moved", chats: [lanes, { chain: "c4", name: "Docs" }] }, "");
    const own = store.askWrite("p1", { what: "tell", ...c1, why: "the API moved", chats: [{ chain: "c4", name: "Docs" }] }, "");
    store.needChange("p1", own.id, { turnDown: true });
    store.askWrite("p1", { what: "on", ...c1, why: "it reads CI", routine: "r9" }, "Brief");
    store.asksSettle("p1");
    store.askTakeBack("p1", tell.id, { chain: "c3" });
    store.keepDashboard("p1", { name: "ci-ab12", v: 1, grant: grantOf({ sources: { runs: { command: ["gh", "run", "list"], key: "id" } } }), title: "CI" });
    store.dashboardChange("p1", "ci-ab12", { paused: true, title: "CI", by: { ...c1, line: "its key expired" } });
    store.dashboardChange("p1", "ci-ab12", { paused: false, title: "CI" });
    const r = store.routinePropose("p1", { title: "Brief", when: "weekdays 09:00", task: "Read CI.", writes: false }, { ...c1, model: "m" });
    store.routineOn("p1", r.id);
    store.routineStarted("p1", r.id, { at: WED, chain: "run1", by: "time" });
    store.routineEnded("p1", r.id, { at: WED, chain: "run1", by: "time", state: "failed", why: "401" });
    const failed = /** @type {any} */ (store.get("p1").needs.find((n) => n.kind === "routine"));
    store.needDoneBy("p1", failed.id, { ...c1, line: "fixed the key" });
    store.needChange("p1", failed.id, { back: true });
    store.writeRepro("p1", /** @type {any} */ (reproFields({ title: "PLAY-91 Sign-in loops", reproduced: true, test: "t.spec.ts", run: "npx playwright test t" })).fields, { ...c1, cwd: "/r" });
    store.routinePause("p1", r.id, true, { ...c1, line: "CI is red" });
    store.routinePause("p1", r.id, false);
    const log = createSpaceStore({ dir, now: clock.now }).get("p1").log;
    const NAMED = /Wire the lanes/;
    const lines = log.filter((e) => NAMED.test(e.text));
    assert.equal(lines.length, 8, lines.map((e) => e.text).join("\n"));
    const c2 = readerNames({ nameOf, apart: (c) => c === "c1" }, "c2");
    const read = logWords(lines, c2.nameOf, c2.apart);
    assert.doesNotMatch(read, NAMED, read);
    for (const said of [
      "Asks you to tell an untitled chat and Docs: “the API moved”",
      "You turned down an untitled chat's ask: tell Docs.",
      "An untitled chat's ask to switch on “Brief” went by itself: it was removed.",
      "Took back its ask to tell an untitled chat and Docs.",
      "You resumed “CI”, which an untitled chat had paused: its key expired",
      "which an untitled chat had marked done.",
      "An untitled chat reproduced “PLAY-91 Sign-in loops”",
      "You resumed the routine “Brief”, which an untitled chat had paused: CI is red",
    ])
      assert.ok(read.includes(said), `${said}\n---\n${read}`);
    const self = readerNames({ nameOf, apart: (c) => c === "c1" }, "c1");
    assert.equal(logWords(lines, self.nameOf, self.apart), logWords(lines, nameOf), "its own chat, and a reader with none apart, read the words as kept");
  });

  test("refusals: no such task 404, a done task taken 409, a bad project's id or none 400 — nothing changed by any", () => {
    const { store, heard } = memoryStore();
    store.addTask("p1", { title: "Done one", column: "done" }, { kind: "you" });
    assert.deepEqual(refusalOf(() => store.changeTask("p1", "t9", { column: "done" })), [404, 'There is no task "t9" on the board: read the board for the ids.']);
    assert.deepEqual(refusalOf(() => store.takeTask("p1", "t1", "c1")), [409, '"Done one" is done; add a task for what is left.']);
    assert.deepEqual(refusalOf(() => store.write("p1", "about it", { kind: "you" }, "t7"))[0], 404, "a line about a task the board lacks");
    assert.deepEqual(refusalOf(() => store.get("none")), [400, '"none" is no project\'s id']);
    assert.deepEqual(refusalOf(() => store.get("../etc")), [400, '"../etc" is no project\'s id']);
    assert.deepEqual(refusalOf(() => store.addTask("p1", { title: "" }, { kind: "you" })), [400, "a task needs a title: a few words that say what it is"]);
    assert.equal(heard.length, 1, "the first add alone was said");
    assert.equal(store.get("p1").seq, 1);
  });

  test("a chat takes a task: its own, in Doing, unparked; removing is the person's", () => {
    const { store } = memoryStore();
    store.addTask("p1", { title: "Docs", place: "/r-docs", parked: true }, { kind: "you" });
    const t = store.takeTask("p1", "t1", "c2");
    assert.deepEqual([t.chain, t.place, t.parked, t.column, t.startedAt], ["c2", null, false, "doing", WED]);
    store.removeTask("p1", "t1");
    assert.deepEqual(store.get("p1").tasks, []);
  });

  test("what happened, written by Filament: the chats that finished, the lanes' lines, the places seen; nothing new, nothing written", () => {
    const { store, clock, heard } = memoryStore();
    const seen = { "/r": { branch: "main", base: null, ahead: null, main: true } };
    assert.deepEqual(store.happened("p1", { finished: [], lines: [], seen: null }), []);
    assert.equal(heard.length, 0, "nothing to write");
    const out = store.happened("p1", { finished: [{ chain: "c1", name: "login", place: "main", facts: null }, { chain: "c2", name: "docs", place: null, facts: null }], lines: ["A new lane: feat/x", " "], seen });
    assert.deepEqual(out.map((e) => [e.id, e.by.kind, e.text]), [
      ["e1", "filament", "“login” finished a turn in main"],
      ["e2", "filament", "“docs” finished a turn"],
      ["e3", "filament", "A new lane: feat/x"],
    ], "each line its own id; a line with no words is let go");
    assert.deepEqual(store.get("p1").seen, seen);
    assert.equal(heard.length, 1, "one change");
    assert.deepEqual(store.happened("p1", { seen: { ...seen } }), [], "the places as before: nothing written");
    clock.at = WED + 60_000;
    const grown = store.happened("p1", { finished: [{ chain: "c1", name: "login", place: "main", facts: null }] });
    assert.deepEqual([grown[0].id, grown[0].turns, store.get("p1").log.map((e) => e.id)], ["e1", 2, ["e2", "e3", "e1"]]);
    const t = store.addTask("p1", { title: "after" }, { kind: "you" });
    assert.equal(t.id, `t${store.get("p1").seq}`, "the count goes on past the lines' ids");
    assert.ok(!store.get("p1").log.some((e, i, all) => all.findIndex((x) => x.id === e.id) !== i), "no id twice");
  });

  // (fails before: yes, at 07965b7dd's parent — a turn's end said a second time, by a client's retry that went on with a
  // turn whose request had failed, was counted as a turn more: one turn read "finished 2 turns", or a second line once the
  // hour had passed. Since 3e39c9cd9 the first end says it failed; the rule for one that did not is the test after this)
  test("a failed turn's end said again is its line again, counted once — after a restart, and past the hour; another turn's grows it", () => {
    const dir = tmp();
    const clock = clockAt(WED);
    const finished = (/** @type {number} */ turn, /** @type {string | null} */ facts = null, failed = false) => ({ chain: "c1", name: "login", place: "main", facts, turn, failed });
    createSpaceStore({ dir, now: clock.now }).happened("p1", { finished: [finished(4, null, true)] });
    // Read back from its file by a store of a later run
    const store = createSpaceStore({ dir, now: clock.now });
    clock.at = WED + 60_000;
    const [again] = store.happened("p1", { finished: [finished(4, "1 file changed, not committed")] });
    assert.deepEqual([again.id, again.turns, again.at, again.text], ["e1", 1, WED + 60_000, "“login” finished a turn in main: 1 file changed, not committed"], "the same line, its turn counted once, its words as now");
    clock.at = WED + 2 * 60_000;
    const [next] = store.happened("p1", { finished: [finished(5, null, true)] });
    assert.deepEqual([next.id, next.turns], ["e1", 2], "the chat's next turn grows the line");
    clock.at = WED + FOLD_MS + 60_000;
    const [late] = store.happened("p1", { finished: [finished(5)] });
    assert.deepEqual([late.id, late.turns, store.get("p1").log.length], ["e1", 2, 1], "its end said again past the hour: still its line, counted once");
    clock.at = WED + FOLD_MS + 2 * 60_000;
    const [later] = store.happened("p1", { finished: [finished(6)] });
    assert.deepEqual([later.id === "e1", later.turns, store.get("p1").log.length], [false, 1, 2], "a turn more past the hour: a line of its own");
  });

  // (fails before: yes — the review of the client-retry commits: any end said again under the number the line counted
  // last was counted once, but the archive files a client's next message of the same words in a turn it keeps open after a
  // reply — a muted chat's streamed one —, so two turns finished read "finished a turn")
  test("a turn's number said again after an end that did not fail is a turn more; a failure under it then a retry is one more", () => {
    const store = createSpaceStore({ dir: tmp(), now: clockAt(WED).now });
    const finished = (/** @type {number} */ turn, failed = false) => ({ chain: "c1", name: "login", place: "main", facts: null, turn, failed });
    const said = [finished(7), finished(7), finished(7, true), finished(7, true), finished(7)].map((f) => store.happened("p1", { finished: [f] })[0]);
    assert.deepEqual(
      said.map((e) => [e.id, e.turns, e.failedTurn ?? null]),
      [
        ["e1", 1, null],
        ["e1", 2, null],
        ["e1", 3, 7],
        ["e1", 3, 7],
        ["e1", 3, null],
      ],
      "a reply's end, its number's next end, that one's failure as a turn more, a retry that failed again, and the retry gone on with them: three turns",
    );
  });

  test("a file that does not read is set aside as .broken and said; rows that do not read are dropped, the rest kept", () => {
    const dir = tmp();
    // A folder this Filament began on already: the Spaces of before were set aside (10-29), so these files are its own.
    createSpaceStore({ dir });
    writeFileSync(join(dir, "p1.json"), "{ not json");
    writeFileSync(join(dir, "p2.json"), JSON.stringify({ version: 1, seq: 7, tasks: [{ id: "t1", title: "kept", column: "doing" }, { id: "t2", column: "doing" }, { id: "t3", title: "x", column: "someday" }], log: [{ id: "e1", text: "kept", at: 5 }, { text: "no id" }, { id: "e2", text: "grown", at: 9, by: { kind: "filament", chain: "c1" }, key: "finished:c1", since: 6, turns: 2 }], syncs: [{ id: "s1", at: 1, lanes: [{ chain: "c1", when: "later", state: "lost" }, {}] }], extra: [{ path: "a", chain: "c1" }], seen: { "/r": { branch: "main", ahead: 1.5, main: true }, bad: 3 } }));
    /** @type {string[]} */
    const said = [];
    const store = createSpaceStore({ dir, log: (level, msg) => said.push(`${level} ${msg}`), now: () => WED });
    assert.deepEqual(store.get("p1").tasks, []);
    assert.equal(existsSync(join(dir, "p1.json.broken")), true);
    assert.match(said[0], /^warn spaces: p1\.json could not be read .*kept beside it as \.broken$/);
    const p2 = store.get("p2");
    assert.deepEqual([p2.seq, p2.tasks.map((t) => t.title), p2.log.map((e) => e.text)], [7, ["kept"], ["kept", "grown"]]);
    assert.deepEqual(p2.log[1], { id: "e2", at: 9, by: { kind: "filament", chain: "c1" }, text: "grown", task: null, key: "finished:c1", since: 6, turns: 2 });
    assert.equal("extra" in p2, false, "a part the store does not know is let go");
    assert.deepEqual(p2.seen, { "/r": { branch: "main", base: null, ahead: null, main: true } });
    assert.deepEqual(p2.syncs[0].lanes, [{ chain: "c1", when: "now", state: "refused" }]);
  });

  test("kept bounded: open tasks stay, the oldest done ones go first; the newest logbook lines stay", () => {
    const { store, clock } = memoryStore();
    for (let i = 0; i < 3; i++) store.addTask("p1", { title: `open ${i}` }, { kind: "you" });
    for (let i = 0; i < SPACE_LIMITS.tasks; i++) {
      clock.at = WED + i;
      store.addTask("p1", { title: `done ${i}`, column: "done" }, { kind: "you" });
    }
    const titles = store.get("p1").tasks.map((t) => t.title);
    assert.equal(titles.length, SPACE_LIMITS.tasks);
    assert.deepEqual(titles.slice(0, 4), ["open 0", "open 1", "open 2", "done 3"], "the three oldest done went");
  });

  test("the Record keeper: once the week turns, the first read writes last week's line; once; a quiet week no line", () => {
    const { store, clock, heard } = memoryStore(WED);
    store.addTask("p1", { title: "Wire the board", column: "doing" }, { kind: "you" });
    store.addTask("p1", { title: "Ask about snapshots", column: "waits" }, { kind: "you" });
    clock.at = THU;
    store.changeTask("p1", "t1", { column: "done" });
    assert.equal(store.get("p1").log.length, 0, "the same week: nothing to keep");
    clock.at = NEXT_MON;
    const doc = store.get("p1");
    assert.deepEqual(doc.log.map((e) => [e.by, e.text]), [[{ kind: "keeper" }, "Last week: 1 task done · 1 waits for you · 0 parked. The longest: Wire the board (30 hours)."]]);
    assert.equal(doc.keptWeek, weekStart(NEXT_MON));
    assert.equal(heard.at(-1)[1].seq, doc.seq);
    store.get("p1");
    assert.equal(store.get("p1").log.length, 1, "once");
    // A week with nothing done or written: kept, no line.
    clock.at = NEXT_MON + 7 * 86_400_000;
    const quiet = store.get("p1");
    assert.deepEqual([quiet.log.length, quiet.keptWeek], [1, weekStart(clock.at)]);
  });

  test("each project's open tasks for the left bar, files on disk counted; a restart's waiting lanes refused with why", () => {
    const dir = tmp();
    const store = createSpaceStore({ dir, now: () => WED });
    store.addTask("p1", { title: "a" }, { kind: "you" });
    store.addTask("p1", { title: "b", parked: true }, { kind: "you" });
    store.addTask("p2", { title: "c", column: "done" }, { kind: "you" });
    store.startSync("p1", { lanes: [{ chain: "c1", when: "after" }, { chain: "c2", when: "now" }], also: "" });
    const again = createSpaceStore({ dir, now: () => WED });
    assert.deepEqual(again.openCounts(), { p1: 1, p2: 0 });
    assert.equal(again.dropWaiting("Filament started again before its turn ended"), 2);
    assert.deepEqual(again.get("p1").syncs[0].lanes.map((l) => [l.state, l.error]), [
      ["refused", "Filament started again before its turn ended"],
      ["refused", "Filament started again before its turn ended"],
    ]);
    assert.equal(again.dropWaiting("again"), 0);
  });
});

describe("the agents' space tool", () => {
  /** @param {ReturnType<typeof createSpaceStore>} store @param {Partial<import("../src/app/agent/space.js").SpaceAt>} [o] */
  const atOf = (store, o = {}) => ({ store, project: "p1", chain: "c1", name: null, nameOf, ...o });

  // (fails before: yes — the bug hunt of 11-02 on the board's drag: the agent's read, a sync's message and the week's page
  // said each column as the Space's file holds its tasks — t1, t2, t3 — while the board shows t3, t1, t2 as the person
  // put them)
  test("the board an agent reads, a sync carries and the week's page says is in the board's order: where the person put each task, else the newest on top; Planned's parked last; Done the newest done first", () => {
    const { store, clock } = memoryStore(MON + 3_600_000);
    /** @param {string} title @param {any} [o] */
    const add = (title, o = {}) => {
      store.addTask("p1", { title, ...o }, { kind: "you" });
      clock.at += 60_000;
    };
    for (const title of ["One", "Two", "Three"]) add(title);
    add("Later", { parked: true });
    for (const title of ["Wired", "Lanes"]) add(title, { column: "doing" });
    for (const title of ["Shipped", "Merged"]) add(title, { column: "done" });
    store.changeTask("p1", "t3", { order: ["t3", "t1", "t2"] });
    store.changeTask("p1", "t5", { order: ["t5", "t6"] });
    const doc = store.get("p1");
    const ids = (/** @type {string} */ text) => [...text.matchAll(/^- (t\d) "/gm)].map((m) => m[1]);
    const board = ["t3", "t1", "t2", "t4", "t5", "t6", "t8", "t7"];
    assert.deepEqual(ids(boardWords(doc, { nameOf, now: WED })), board, "the board's words");
    assert.deepEqual(ids(/** @type {any} */ (spaceCall({ action: "read" }, atOf(store), WED)).text), board, "the space tool's read");
    assert.deepEqual(ids(syncMessage({ doc, chain: "c1", since: null, also: "", at: WED, nameOf })), board, "a sync's message");
    const page = spaceMarkdown(doc, { name: "filament", nameOf, now: WED });
    assert.deepEqual([...page.matchAll(/^- \*\*(\w+)\*\*/gm)].map((m) => m[1]), ["Three", "One", "Two", "Later", "Wired", "Lanes", "Merged", "Shipped"], "the week's page");
  });

  test("read: the board, the newest lines or those since a moment; a moment it cannot read is refused", () => {
    const { store, clock } = memoryStore();
    store.addTask("p1", { title: "Wire the board", column: "doing", chain: "c1" }, { kind: "you" });
    for (let i = 0; i < READ_LINES + 2; i++) {
      clock.at = WED + i * 60_000;
      store.write("p1", `line ${i}`, { kind: "agent", chain: "c2" });
    }
    store.happened("p1", { finished: [{ chain: "c2", name: "Settings move", place: null, facts: null }] });
    const r = /** @type {any} */ (spaceCall({ action: "read" }, atOf(store), WED + 3_600_000));
    assert.equal(r.ok, true);
    assert.ok(r.text.startsWith('This project\'s Space, as of 2026-10-14 11:00. Your chat is "Wire the lanes".\n\nThe board (Planned 0 · Doing 1'));
    assert.match(r.text, /The logbook, its newest 20 of 23 lines \("since" gives more\):\n- 2026-10-14 10:03 Settings move: line 3\n/);
    assert.match(r.text, /- 2026-10-14 10:21 Filament: “Settings move” finished a turn$/, "Filament's own line, the last");
    assert.ok(!/claim/.test(r.text));
    const since = /** @type {any} */ (spaceCall({ action: "read", since: "2026-10-14 10:20" }, atOf(store), WED + 3_600_000));
    assert.match(since.text, /The logbook since 2026-10-14 10:20:\n- 2026-10-14 10:20 Settings move: line 20\n- 2026-10-14 10:21 Settings move: line 21\n- 2026-10-14 10:21 Filament: “Settings move” finished a turn$/);
    assert.deepEqual(spaceCall({ action: "read", since: "last week" }, atOf(store)), { ok: false, error: '"last week" is no moment: give it as YYYY-MM-DD HH:MM.' });
    // A day or a time no calendar has is refused too, never read as the one it rolls over to (the Hunter on E39).
    // (fails before: yes — "2026-02-30 09:00" read the logbook since 2026-03-02 09:00)
    for (const bad of ["2026-02-30 09:00", "2026-13-01", "2026-10-19 24:99", "2026-10-19 10:60", "2026-00-10"])
      assert.deepEqual(spaceCall({ action: "read", since: bad }, atOf(store)), { ok: false, error: `"${bad}" is no moment: give it as YYYY-MM-DD HH:MM.` }, bad);
    assert.equal(/** @type {any} */ (spaceCall({ action: "read", since: "2024-02-29 23:59" }, atOf(store))).ok, true, "a leap day is one");
    // The cards the project's dashboards put on the board, as the Space draws them (the Hunter on S4c); a failed read of
    // them leaves the board as Filament keeps it.
    // (fails before: yes — the agent read a board without them)
    /** @type {string[]} */
    const asked = [];
    const fed = (/** @type {string} */ p) => (asked.push(p), { tasks: [{ title: "Issues", task: "Login loops", line: "", column: "planned", stale: false }], counts: [] });
    const withFed = /** @type {any} */ (spaceCall({ action: "read" }, atOf(store, { fed }), WED + 3_600_000));
    assert.match(withFed.text, /The board \(Planned 0 \+ 1 from dashboards · Doing 1 ·[^\n]*\nPlanned:\n- from Issues: "Login loops"\n/);
    assert.deepEqual(asked, ["p1"]);
    const broke = /** @type {any} */ (spaceCall({ action: "read" }, atOf(store, { fed: () => { throw new Error("no"); } }), WED + 3_600_000));
    assert.equal(broke.text, r.text);
  });

  test("add, take, move, log: as the chat's — a helper by its name —, with what the person should know in the answer", () => {
    const { store } = memoryStore();
    assert.deepEqual(spaceCall({ action: "add", title: "Docs", line: "the guide" }, atOf(store)), { ok: true, text: 'Added t1 "Docs" to Planned.' });
    assert.deepEqual(spaceCall({ action: "add", title: "Mine", to: "doing" }, atOf(store)), { ok: true, text: 'Added t2 "Mine" to Doing, as yours.' });
    assert.equal(store.get("p1").tasks[1].chain, "c1");
    assert.deepEqual(spaceCall({ action: "take", id: "t2" }, atOf(store, { chain: "c2" })), { ok: true, text: 't2 "Mine" is yours now, in Doing. It was Wire the lanes\'s: say in the logbook that you took it.' });
    assert.deepEqual(spaceCall({ action: "move", id: "t2", to: "waits", line: "needs a yes" }, atOf(store)), { ok: true, text: 't2 "Mine" is in Waits for you.' });
    assert.deepEqual(spaceCall({ action: "move", id: "t1", parked: true }, atOf(store)), { ok: true, text: 't1 "Docs" is in Planned, parked.' });
    assert.match(/** @type {any} */ (spaceCall({ action: "move", id: "t1" }, atOf(store))).error, /^say where it goes/);
    assert.match(/** @type {any} */ (spaceCall({ action: "move", id: "t1", to: "soon" }, atOf(store))).error, /"soon" is none of them/);
    assert.deepEqual(spaceCall({ action: "log", text: "the guide has its page", task: "t1" }, atOf(store, { name: "Builder" })), { ok: true, text: "Written in the logbook at 2026-10-14 10:00." });
    assert.deepEqual(store.get("p1").log[0].by, { kind: "agent", chain: "c1", name: "Builder" });
    assert.deepEqual(spaceCall({ action: "take", id: "t9" }, atOf(store)), { ok: false, error: 'There is no task "t9" on the board: read the board for the ids.' }, "the store's refusal in its words");
  });

  test("claim and release are gone (SG-D5), as an unknown action is; a switched-off tool: refused in words", () => {
    const { store } = memoryStore();
    const none = (/** @type {string} */ a) => `space takes an action: read, add, take, move, log, guide, needs, dashboard, app, lanes, draft, routine, repro; ${a} is none of them. {"action":"guide"} says what each does.`;
    assert.deepEqual(spaceCall({ action: "claim", paths: ["src/ui/sidebar.js"] }, atOf(store)), { ok: false, error: none("claim") });
    assert.deepEqual(spaceCall({ action: "release" }, atOf(store)), { ok: false, error: none("release") });
    assert.deepEqual(spaceCall({ action: "delete", id: "t1" }, atOf(store)), { ok: false, error: none("delete") });
    assert.ok(!JSON.stringify(SPACE_TOOL).includes("claim"), "the tool's words name no claim");
    assert.deepEqual(spaceCall({ action: "read" }, atOf(store, { on: () => false })), { ok: false, error: SPACE_SWITCHED_OFF });
  });

  // Every tool from the first message (team_v2_plan TV2-D7): every chat of a project is offered its Space's tool from
  // its first turn, whether anyone wrote to the Space yet or not, so its tools never change under its cache. A chat of
  // no project has none.
  // (fails before: yes — the tool waited until the project's Space was in use)
  test("offered to every chat of a project from its first message: the same rule for the loop and a coding agent", () => {
    const { store } = memoryStore();
    const deps = { store, projectOf: (/** @type {string} */ c) => (c === "c1" ? "p1" : null), nameOf, on: () => true };
    assert.equal(spaceProjectOf(deps, "c1"), "p1", "a Space nobody wrote to yet");
    assert.equal(spaceProjectOf(deps, "c9"), null, "no project");
    assert.equal(spaceProjectOf({ ...deps, projectOf: () => "none" }, "c1"), null, "the chats of no project");
  });

  test("a coding agent's: listed for a chat of a project from the first message, the switch on; refused in words otherwise; the MCP server's words say it", async () => {
    const { store } = memoryStore();
    let on = true;
    const tools = createAgentTools({
      memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null,
      space: { store, projectOf: (c) => (c === "c1" || c === "c2" ? "p1" : null), nameOf, on: () => on },
    });
    const ctx = /** @type {any} */ ({ cwd: "/r", chain: "c1" });
    assert.deepEqual(tools.list(ctx).map((t) => [t.name, t.inputSchema]), [["space", SPACE_TOOL.input_schema]], "listed before anyone wrote to the Space");
    assert.deepEqual(tools.list({ ...ctx, chain: "c9" }), [], "a chat of no project");
    assert.deepEqual(await tools.call("space", { action: "add", title: "From Claude Code" }, ctx), { text: 'Added t1 "From Claude Code" to Planned.' });
    await tools.call("space", { action: "log", text: "a helper's line" }, { ...ctx, by: { id: "sa-1", exchange: 1 } });
    assert.deepEqual(store.get("p1").log.at(-1)?.by, { kind: "agent", chain: "c1", name: "a helper" });
    // A helper by its card's name (found by the Hunter on S5c). (fails before: yes — always "a helper")
    await tools.call("space", { action: "log", text: "Scout's line" }, { ...ctx, by: { id: "sa-2", exchange: 1, name: "Scout" } });
    assert.deepEqual(store.get("p1").log.at(-1)?.by, { kind: "agent", chain: "c1", name: "Scout" });
    assert.deepEqual(await tools.call("space", { action: "read" }, { ...ctx, chain: "c9" }), { text: SPACE_OFF, isError: true });
    // (fails before: yes — HarnessV4_ShippedAgents_Plan SA2: an agent whose card goes without the Space had it)
    assert.deepEqual(tools.list({ ...ctx, space: false }), [], "an agent whose card goes without it");
    assert.deepEqual(await tools.call("space", { action: "read" }, { ...ctx, space: false }), { text: SPACE_OFF, isError: true });
    on = false;
    assert.deepEqual(tools.list(ctx), [], "switched off: not listed");
    assert.deepEqual(await tools.call("space", { action: "read" }, ctx), { text: SPACE_SWITCHED_OFF, isError: true }, "a call made after");
    assert.match(serverInstructions({ cwd: "/r", space: true }), / Its `space` reads and writes this project's Space, which the person and the project's other chats share: the board of tasks, What happened \(its logbook\), and routines \(work an agent does by itself at a time, or as a watcher when something happens\)\. The project folder is \/r\.$/);
    assert.ok(!serverInstructions({ cwd: "/r" }).includes("`space`"));
  });
});

describe("a sync", () => {
  /** A stand-in for the chats a sync reaches. */
  const reachOf = () => {
    const busy = new Set();
    /** @type {[string, string][]} */
    const posts = [];
    /** @type {[string, string][]} */
    const steers = [];
    const r = {
      busy,
      posts,
      steers,
      steerOk: true,
      /** @type {(chain: string) => { status: number, body: any }} */
      answer: () => ({ status: 200, body: { ok: true } }),
      reach: {
        busy: (/** @type {string} */ c) => busy.has(c),
        post: async (/** @type {string} */ c, /** @type {string} */ t) => {
          posts.push([c, t]);
          return r.answer(c);
        },
        steer: (/** @type {string} */ c, /** @type {string} */ t) => {
          steers.push([c, t]);
          return r.steerOk ? { ok: true } : { ok: false, error: "it takes no words while it works" };
        },
      },
    };
    return r;
  };
  const settle = () => new Promise((r) => setTimeout(r, 15));
  const projectOf = (/** @type {string} */ c) => (["c1", "c2", "c3"].includes(c) ? "p1" : "p2");
  /** @param {ReturnType<typeof reachOf>} r @param {ReturnType<typeof memoryStore>} m */
  const runnerOf = (r, m) => createSpaceSync({ store: m.store, reach: r.reach, projectOf, nameOf, settleMs: 1, now: m.clock.now });
  /** @param {ReturnType<typeof memoryStore>} m */
  const lanesOf = (m) => m.store.get("p1").syncs.at(-1)?.lanes.map((l) => [l.chain, l.when, l.state, l.error ?? ""]);

  // (fails before: yes — d-send's two sentences: the refusals said lane of what the card ticks, a chat)
  test("what it takes: a chat of this project per lane, one chat at least and 20 at most, the person's words bounded", () => {
    const m = memoryStore();
    const run = runnerOf(reachOf(), m);
    assert.deepEqual(run.run("p1", { lanes: [{ chain: "c1" }, { chain: "c9" }] }), { ok: false, error: '"an untitled chat" is no chat of this project' });
    assert.deepEqual(run.run("p1", { lanes: [] }), { ok: false, error: "a sync reaches one chat at least: pick the chats it goes to" });
    const many = Array.from({ length: SYNC_LANES_MAX + 1 }, (_, i) => ({ chain: `x${i}` }));
    assert.equal(/** @type {any} */ (createSpaceSync({ store: m.store, reach: reachOf().reach, projectOf: () => "p1", nameOf }).run("p1", { lanes: many })).error, "a sync reaches 20 chats at most");
    assert.match(/** @type {any} */ (run.run("p1", { lanes: [{ chain: "c1" }], also: "x".repeat(SPACE_LIMITS.also + 1) })).error, /2000 characters at most/);
    assert.equal(m.store.get("p1").syncs.length, 0, "nothing kept for a refused sync");
  });

  test("a chat at rest: one message of its own, appended — the sync kept, each lane's outcome, a logbook line by Sync", async () => {
    const m = memoryStore();
    const r = reachOf();
    m.store.write("p1", "moved Settings", { kind: "agent", chain: "c2" });
    const out = runnerOf(r, m).run("p1", { lanes: [{ chain: "c1", when: "now" }, { chain: "c2", when: "after" }, { chain: "c1" }], also: "  Merge main first. " });
    assert.equal(out.ok, true);
    await settle();
    assert.deepEqual(r.posts.map(([c]) => c), ["c1", "c2"], "each chat once");
    assert.ok(r.posts[0][1].startsWith(SYNC_HEAD) && r.posts[0][1].includes("- 2026-10-14 10:00 Settings move: moved Settings"));
    assert.ok(!r.posts[1][1].includes("moved Settings"), "a chat's own lines are not news to it");
    assert.match(r.posts[0][1], /The person adds: Merge main first\./);
    assert.deepEqual(lanesOf(m), [["c1", "now", "sent", ""], ["c2", "after", "sent", ""]]);
    const line = m.store.get("p1").log.at(-1);
    assert.deepEqual(line?.by, { kind: "sync" });
    assert.equal(line?.text, "Told 2 chats: Wire the lanes, Settings move. The person added: Merge main first.");
  });

  // (fails before: yes — round 5's lead 2 of the 11-02 privacy round: c1's message named the chat whose words are none of
  // its agent's to read by its title, "Settings move has it" on the board and "Settings move: moved Settings" in the
  // logbook)
  test("each lane's message names a chat whose words are none of its agent's to read as an untitled chat; that chat's own lane reads its own name", async () => {
    const m = memoryStore();
    const r = reachOf();
    m.store.write("p1", "moved Settings", { kind: "agent", chain: "c2" });
    m.store.addTask("p1", { title: "Move the settings", column: "doing", chain: "c2" }, { kind: "agent", chain: "c2" });
    const run = createSpaceSync({ store: m.store, reach: r.reach, projectOf, nameOf, apart: (c) => c === "c2", settleMs: 1, now: m.clock.now });
    assert.equal(run.run("p1", { lanes: [{ chain: "c1" }, { chain: "c2" }] }).ok, true);
    await settle();
    const [[, toC1], [, toC2]] = r.posts;
    assert.doesNotMatch(toC1, /Settings move/, toC1);
    assert.match(toC1, /an untitled chat has it/);
    assert.match(toC1, /- 2026-10-14 10:00 an untitled chat: moved Settings/);
    assert.match(toC2, /you have it/, "its own lane reads it as its own");
    assert.equal(m.store.get("p1").log.at(-1)?.text, "Told 2 chats: Wire the lanes, Settings move.", "the person's own line names it");
  });

  // (fails before: yes — round 6's lead 2 of the 11-02 privacy round: each row kept who wrote it as their title then, and
  // the reader for whom c2 is apart read it so: "n1 · Osprey ledger's draft…", "n2 · Osprey ledger's repro", "n3 ·
  // Osprey ledger's ask", "(why: a routine of this Space, run by Osprey ledger's Run now at 08:00)", "n5 …, by Osprey
  // ledger: shipped it", "taken back by Osprey ledger", "(by Osprey ledger)", "Osprey ledger asked that you be told",
  // "by Osprey ledger", "paused by Osprey ledger", "started by Osprey ledger")
  test("rows a chat whose words are none of the reader's wrote name it as an untitled chat to that reader — a draft, a repro, an ask, a routine's failed run, a done mark, an ask taken back, a sync's ask, a routine's maker, pauser and starter —; its own agent reads them as its own", () => {
    const OSPREY = "Osprey ledger";
    const by = { chain: "c2", byName: OSPREY };
    const draft = /** @type {any} */ ({ ...by, connection: "slack", tool: "post", answers: null, from: [], account: "" });
    /** @type {any[]} */
    const needs = [
      { id: "n1", kind: "draft", text: "Post the notes", why: "", dashboard: "", title: "", at: WED, state: "open", draft },
      { id: "n2", kind: "repro", text: "Reproduced: it 500s", why: "", dashboard: "", title: "Login", at: WED, state: "open", repro: { ...by } },
      { id: "n3", kind: "ask", text: "Tell Docs?", why: "", dashboard: "", title: "", at: WED, state: "open", ask: { what: "tell", ...by, why: "the API moved" } },
      { id: "n4", kind: "routine", text: "“Brief” failed: 401", why: `a routine of this Space, run by ${OSPREY}'s Run now at 08:00`, dashboard: "", title: "Brief", at: WED, state: "open", routine: { id: "r1", chain: "run1", startedBy: by, clock: "08:00" } },
      { id: "n5", kind: "watch", text: "CI failed", why: "", dashboard: "d", title: "CI", at: WED, state: "done", doneAt: WED, doneBy: { ...by, line: "shipped it" } },
      { id: "n6", kind: "ask", text: "Keep v2?", why: "", dashboard: "d", title: "CI", at: WED, state: "done", doneAt: WED, ask: { what: "keep", ...by, why: "x", ended: "taken back" } },
    ];
    const routine = /** @type {any} */ ({ id: "r1", title: "Brief", when: "weekdays 09:00", task: "t", writes: false, state: "on", paused: true, madeIn: "c2", madeBy: OSPREY, pausedBy: { ...by, line: "CI is red" }, last: { at: WED, chain: "run1", by: "agent", startedBy: by, state: "done" } });
    const c1 = readerNames({ nameOf, apart: (c) => c === "c2" }, "c1");
    const read = [
      needsWords(needs, { ...c1, now: WED, self: "c1" }),
      draftsWords(needs, { ...c1, now: WED, self: "c1" }),
      syncMessage({ doc: emptySpace(), chain: "c1", since: null, also: "", at: WED, ...c1, asked: [{ ...by, words: "the API moved" }] }),
      routinesWords([routine], { ...c1, now: WED, self: "c1" }),
    ].join("\n");
    assert.doesNotMatch(read, /Osprey/, read);
    for (const said of ["n1 · an untitled chat's draft", "n2 · an untitled chat's repro", "n3 · an untitled chat's ask", "(why: a routine of this Space, run by an untitled chat's Run now at 08:00)", "by an untitled chat: shipped it", "taken back by an untitled chat", "(by an untitled chat)", "An untitled chat asked that you be told: the API moved", "(by an untitled chat)", "paused by an untitled chat: CI is red", "started by an untitled chat"])
      assert.ok(read.includes(said), `${said}\n---\n${read}`);
    const c2 = readerNames({ nameOf, apart: (c) => c === "c2" }, "c2");
    const own = [needsWords(needs, { ...c2, now: WED, self: "c2" }), routinesWords([routine], { ...c2, now: WED, self: "c2" })].join("\n");
    for (const said of ["n1 · your draft", "n3 · your ask", "by you: shipped it", "taken back by you", "(yours)", "paused by you"]) assert.ok(own.includes(said), `${said}\n---\n${own}`);
    // The others' rows as ever: kept by their name then.
    const c3 = readerNames({ nameOf, apart: () => false }, "c3");
    assert.ok(needsWords(needs, { ...c3, now: WED, self: "c3" }).includes("n1 · Osprey ledger's draft"));
  });

  // (fails before: yes — round 7's lead 3 of the 11-02 privacy round: a Tell's row kept the chats to tell by their names
  // at asking, and the reader for whom c1 had come to be apart read it so: "n1 · … : Tell Wire the lanes and Docs? (the
  // words: the API moved)", and "n2 “Tell Wire the lanes?”" among those done)
  test("a Tell's chats to tell are named for the reader: one whose words are none of its, an untitled chat; the person's page as asked", () => {
    const tell = /** @type {any} */ ({ what: "tell", chain: "c3", byName: "Docs", why: "the API moved", chats: [{ chain: "c1", name: "Wire the lanes" }, { chain: "c4", name: "Docs" }] });
    /** @type {any[]} */
    const needs = [
      { id: "n1", kind: "ask", text: "Tell Wire the lanes and Docs?", why: "", dashboard: "", title: "", at: WED, state: "open", ask: tell },
      { id: "n2", kind: "ask", text: "Tell Wire the lanes?", why: "", dashboard: "", title: "", at: WED, state: "done", doneAt: WED, ask: { ...tell, chats: [tell.chats[0]], ended: "told" } },
    ];
    const c2 = readerNames({ nameOf, apart: (c) => c === "c1" }, "c2");
    const read = needsWords(needs, { ...c2, now: WED, self: "c2" });
    assert.doesNotMatch(read, /Wire the lanes/, read);
    assert.ok(read.includes(": Tell an untitled chat and Docs? (the words: the API moved)"), read);
    assert.ok(read.includes("n2 “Tell an untitled chat?”"), read);
    const c1 = readerNames({ nameOf, apart: (c) => c === "c1" }, "c1");
    assert.ok(needsWords(needs, { ...c1, now: WED, self: "c1" }).includes(": Tell Wire the lanes and Docs?"), "its own chat reads its own name");
  });

  // (fails before: yes — round 6's lead 1 of the 11-02 privacy round: the logbook line by Sync was kept as its words alone,
  // and every chat's agent read it so: "- 2026-10-14 10:00 Sync: Told 2 chats: Wire the lanes, Settings move, with
  // Settings move's words: the API moved. The person added: Merge main first.")
  test("the line by Sync keeps the chats it told and the asks it carried: a reader for whom one is apart reads it by the name it reads; the person's page by their titles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-spaces-told-"));
    try {
      const clock = clockAt(WED);
      const store = createSpaceStore({ dir, now: clock.now });
      const asks = [store.askWrite("p1", { what: "tell", chain: "c2", byName: "Settings move", why: "the API moved", chats: [{ chain: "c1", name: "Wire the lanes" }] }, "Tell Wire the lanes").id];
      const r = reachOf();
      const run = createSpaceSync({ store, reach: r.reach, projectOf, nameOf, apart: (c) => c === "c2", settleMs: 1, now: clock.now });
      assert.equal(run.run("p1", { lanes: [{ chain: "c1" }, { chain: "c2" }], also: "Merge main first.", asks }).ok, true);
      await settle();
      const log = createSpaceStore({ dir, now: clock.now }).get("p1").log;
      const told = /** @type {any} */ (log.findLast((e) => e.by.kind === "sync"));
      assert.equal(told.text, "Told 2 chats: Wire the lanes, Settings move, with Settings move's words: the API moved. The person added: Merge main first.", "the person's page reads their titles");
      const c3 = readerNames({ nameOf, apart: (c) => c === "c2" }, "c3");
      assert.equal(logWords([told], c3.nameOf, c3.apart), "- 2026-10-14 10:00 Sync: Told 2 chats: Wire the lanes, an untitled chat, with an untitled chat's words: the API moved. The person added: Merge main first.");
      const c2 = readerNames({ nameOf, apart: (c) => c === "c2" }, "c2");
      assert.equal(logWords([told], c2.nameOf, c2.apart), `- 2026-10-14 10:00 Sync: ${told.text}`, "its own chat reads its own name");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a chat at work: now goes into its turn where it takes words, else waits; after waits; each goes as its turn ends", async () => {
    const m = memoryStore();
    const r = reachOf();
    const run = runnerOf(r, m);
    r.busy.add("c1").add("c2").add("c3");
    r.steerOk = true;
    run.run("p1", { lanes: [{ chain: "c1", when: "now" }, { chain: "c2", when: "after" }] });
    assert.deepEqual(r.steers.map(([c]) => c), ["c1"]);
    assert.deepEqual(lanesOf(m), [["c1", "now", "steered", ""], ["c2", "after", "waiting", ""]]);
    r.steerOk = false;
    run.run("p1", { lanes: [{ chain: "c3", when: "now" }] });
    assert.deepEqual(lanesOf(m), [["c3", "now", "waiting", ""]], "it takes no words while it works: it waits");
    assert.deepEqual([...run.waitingFor().keys()], ["c2", "c3"]);
    run.released("c2");
    await settle();
    assert.equal(r.posts.length, 0, "its turn still holds it: nothing sent");
    r.busy.delete("c2");
    run.released("c2");
    await settle();
    assert.deepEqual(r.posts.map(([c]) => c), ["c2"]);
    assert.deepEqual(m.store.get("p1").syncs[0].lanes.map((l) => l.state), ["steered", "sent"]);
    assert.deepEqual([...run.waitingFor().keys()], ["c3"]);
  });

  test("a newer sync takes a waiting one's place; a question waiting for the person waits for its answer's turn; a refusal is said", async () => {
    const m = memoryStore();
    const r = reachOf();
    const run = runnerOf(r, m);
    r.busy.add("c1");
    const first = /** @type {any} */ (run.run("p1", { lanes: [{ chain: "c1", when: "after" }] })).sync.id;
    m.clock.at += 60_000;
    const second = /** @type {any} */ (run.run("p1", { lanes: [{ chain: "c1", when: "after" }] })).sync.id;
    const syncs = m.store.get("p1").syncs;
    assert.deepEqual(syncs.map((s) => [s.id, s.lanes[0].state, s.lanes[0].error ?? ""]), [
      [first, "refused", "a newer sync took its place: it carries the board as it stands"],
      [second, "waiting", ""],
    ]);
    // Paused on a question: the route answers 409 asking; it goes once a turn — the answer's — lets go.
    r.busy.delete("c1");
    r.answer = () => ({ status: 409, body: { error: "a question waits", sync: "asking" } });
    run.released("c1");
    await settle();
    assert.equal(r.posts.length, 1);
    assert.equal(lanesOf(m)?.[0][2], "waiting");
    r.answer = () => ({ status: 200, body: {} });
    run.released("c1");
    await settle();
    assert.deepEqual([r.posts.length, lanesOf(m)?.[0][2], run.waitingFor().size], [2, "sent", 0]);
    // Refused by the route, or not sent at all: said, and not tried again.
    r.answer = () => ({ status: 400, body: { error: "the chat is archived" } });
    run.run("p1", { lanes: [{ chain: "c2" }] });
    await settle();
    assert.deepEqual(lanesOf(m), [["c2", "now", "refused", "the chat is archived"]]);
    r.reach.post = async () => {
      throw new Error("connection refused");
    };
    run.run("p1", { lanes: [{ chain: "c3" }] });
    await settle();
    assert.deepEqual(lanesOf(m), [["c3", "now", "refused", "Filament could not send it (connection refused)"]]);
  });

  test("each lane's news is since its own last sync that reached it", async () => {
    const m = memoryStore();
    const r = reachOf();
    const run = runnerOf(r, m);
    m.store.write("p1", "first news", { kind: "you" });
    m.clock.at += 60_000;
    run.run("p1", { lanes: [{ chain: "c1" }] });
    await settle();
    m.clock.at += 60_000;
    m.store.write("p1", "second news", { kind: "you" });
    m.clock.at += 60_000;
    run.run("p1", { lanes: [{ chain: "c1" }, { chain: "c2" }] });
    await settle();
    const [, toC1, toC2] = r.posts.map(([, t]) => t);
    assert.match(toC1, /since this chat's last sync, at 2026-10-14 10:01\./);
    assert.ok(toC1.includes("second news") && !toC1.includes("first news"));
    assert.match(toC2, /since the Space began\./);
    assert.ok(toC2.includes("first news") && toC2.includes("second news"));
  });
});

describe("the admin routes", () => {
  /**
   * One row through the real router with a minimal request: its status, its headers and its body (JSON where it is).
   * @param {any[]} rows @param {string} method @param {string} path @param {{ json?: any, query?: string }} [o]
   */
  async function call(rows, method, path, o = {}) {
    const m = createRouter(rows)(method, path);
    assert.ok(m, `${method} ${path} matched a row`);
    const got = { status: 0, headers: /** @type {any} */ ({}), body: /** @type {any} */ (null), text: "" };
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead: (/** @type {number} */ s, /** @type {any} */ h) => Object.assign(got, { status: s, headers: h }),
      end: (/** @type {string} */ b) => {
        got.text = String(b);
        try {
          got.body = JSON.parse(got.text);
        } catch {}
      },
    };
    await m.handler({ res, url: new URL(`http://localhost/api${path}${o.query || ""}`), params: m.params, json: async () => o.json }, {});
    return got;
  }
  /** The routes over a store in memory, a project p1 the archive knows, and a sync runner over a stand-in. */
  const routesOf = (o = /** @type {{ spaces?: any, sync?: boolean }} */ ({})) => {
    const m = memoryStore();
    /** @type {[string, string][]} */
    const posts = [];
    const spaceSync = createSpaceSync({
      store: m.store,
      reach: { busy: () => false, post: async (c, t) => (posts.push([c, t]), { status: 200, body: {} }), steer: () => ({ ok: false }) },
      projectOf: (c) => (c.startsWith("c") ? "p1" : null),
      nameOf,
    });
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "filament", cwd: "/r" } : null) } },
      spaces: o.spaces === undefined ? m.store : o.spaces,
      spaceSync: o.sync === false ? null : spaceSync,
      spaceNames: nameOf,
    });
    return { rows, ...m, posts };
  };

  test("the page's reads: each project's open tasks; a Space with its chats named; 404 for a project the archive lacks; 503 unwired", async () => {
    const { rows, store } = routesOf();
    store.addTask("p1", { title: "Wire the board", column: "doing", chain: "c1" }, { kind: "you" });
    store.write("p1", "line", { kind: "agent", chain: "c2" });
    // (`watchers`: the plan of 11-11, its w8 — a Space's Watchers row in the left bar, beside Routines.)
    assert.deepEqual((await call(rows, "GET", "/spaces")).body, { open: { p1: 1 }, needs: {}, extended: false, next: null, own: [], back: {}, apps: {}, routines: {}, watchers: {} },"no Needs you rows, no kept dashboard, no Space of your own, none deleted: no Home (S5b)");
    const got = await call(rows, "GET", "/space/p1");
    assert.equal(got.status, 200);
    assert.deepEqual(Object.keys(got.body), ["project", "seq", "tasks", "log", "logMore", "syncs", "names", "waiting", "dashboards", "gone", "feeds", "needs", "runs", "settings", "runsOn"]);
    // What its agents run on (11-04): no model of its own, none in Settings › Space; an app's ask asks first.
    assert.deepEqual([got.body.settings, got.body.runsOn], [{}, { model: "", effort: "", from: "", asks: "ask", asksFrom: "" }]);
    assert.deepEqual([got.body.dashboards, got.body.gone, got.body.needs], [[], [], []], "none where no runner is wired; no row in Needs you yet");
    // What runs by itself (S6): nothing yet, so no head; no watcher, so none said to listen.
    assert.deepEqual(got.body.runs, { head: "", listening: "", pausedSince: null, pausedBy: null, routines: [], watches: [] });
    // (fails before: yes — the owner's idea of 10-29: the left bar's Routines row under a Space read nothing) A routine
    // proposed: the Space is named under routines, no run failed.
    store.routinePropose("p1", { title: "Morning brief", when: "weekdays 09:00", task: "Read what came in." }, { chain: "c1", byName: "on main", model: "m" });
    assert.deepEqual((await call(rows, "GET", "/spaces")).body.routines, { p1: { failed: false } });
    assert.deepEqual([got.body.seq, got.body.logMore, got.body.names], [2, 0, { c1: "Wire the lanes", c2: "Settings move" }]);
    assert.deepEqual(await call(rows, "GET", "/space/p9").then((r) => [r.status, r.body]), [404, { error: "no such project" }]);
    const bare = routesOf({ spaces: null }).rows;
    assert.deepEqual(await call(bare, "GET", "/space/p1").then((r) => [r.status, r.body]), [503, { error: "the Spaces are not wired in this Filament" }]);
  });

  // (fails before: yes — the bar's `failed` read the last run alone: it stayed true for one paused or proposed again,
  // which runs nothing, so the dot could not be put out but by a run that went well)
  test("the left bar's dot is of what fails now: a failed last run counts while its routine or watcher is on, not once it is paused or proposed again", async () => {
    const { rows, store } = routesOf();
    const made = { chain: "c1", byName: "on main", model: "m" };
    const timed = store.routinePropose("p1", { title: "Morning brief", when: "weekdays 09:00", task: "Read what came in." }, made);
    const f = routineFields({ title: "Supervisor", text: "Read its turn.", trigger: { kind: "turn", chat: "c2", turns: "all" } }, { create: true });
    assert.ok(f.ok, JSON.stringify(f));
    const woken = store.routinePropose("p1", f.fields, made);
    const bar = async () => { const b = (await call(rows, "GET", "/spaces")).body; return [b.routines.p1, b.watchers.p1]; };
    assert.deepEqual(await bar(), [{ failed: false }, { failed: false }], "proposed, nothing run");
    for (const [r, by] of /** @type {[any, "time" | "event"][]} */ ([[timed, "time"], [woken, "event"]])) {
      store.routineOn("p1", r.id);
      store.routineStarted("p1", r.id, { at: WED, chain: `run-${r.id}`, by });
      store.routineEnded("p1", r.id, { at: WED, chain: `run-${r.id}`, by, state: "failed", why: "401" });
    }
    assert.deepEqual(await bar(), [{ failed: true }, { failed: true }], "each is on, and its last run failed");
    for (const r of [timed, woken]) store.routinePause("p1", r.id, true);
    assert.deepEqual(await bar(), [{ failed: false }, { failed: false }], "paused: nothing of it fails now");
    for (const r of [timed, woken]) store.routinePause("p1", r.id, false);
    assert.deepEqual(await bar(), [{ failed: true }, { failed: true }], "resumed: its last run still failed");
    // Switched off by Filament, it is proposed again: a press that waits (its row in Needs you), not a failure.
    assert.equal(store.watchUnapproved("p1", woken.id, "its script changed since you switched it on (scripts/feed.mjs)"), true);
    assert.deepEqual(await bar(), [{ failed: true }, { failed: false }]);
  });

  test("the person's writes: a task added, changed, removed; a logbook line; each answers the Space; refusals in their words", async () => {
    const { rows, store } = routesOf();
    const added = await call(rows, "POST", "/space/p1/tasks", { json: { title: "Docs", line: "the guide" } });
    assert.deepEqual([added.status, added.body.task.id, added.body.task.by, added.body.space.tasks.length], [200, "t1", { kind: "you" }, 1]);
    const moved = await call(rows, "PATCH", "/space/p1/tasks/t1", { json: { column: "doing", chain: "c1" } });
    assert.deepEqual([moved.body.task.column, moved.body.task.chain, moved.body.space.seq], ["doing", "c1", 2]);
    assert.deepEqual(await call(rows, "PATCH", "/space/p1/tasks/t9", { json: { column: "done" } }).then((r) => [r.status, r.body.error]), [404, 'There is no task "t9" on the board: read the board for the ids.']);
    assert.deepEqual(await call(rows, "POST", "/space/p1/tasks", { json: [] }).then((r) => [r.status, r.body.error]), [400, "a JSON object is required: { title, line?, column?, parked?, chain?, place? }"]);
    const wrote = await call(rows, "POST", "/space/p1/log", { json: { text: "Keep the header as it is.", task: "t1" } });
    assert.deepEqual([wrote.body.entry.by, wrote.body.entry.task, wrote.body.space.log.length], [{ kind: "you" }, "t1", 1]);
    assert.deepEqual(await call(rows, "POST", "/space/p1/log", { json: { text: " " } }).then((r) => r.status), 400);
    const gone = await call(rows, "DELETE", "/space/p1/tasks/t1");
    assert.deepEqual([gone.status, gone.body.space.tasks], [200, []]);
    assert.equal(store.get("p1").tasks.length, 0);
  });

  test("Run sync: the lanes reached and the Space answered; a bad lane 400; unwired 503", async () => {
    const { rows, posts } = routesOf();
    const ran = await call(rows, "POST", "/space/p1/sync", { json: { lanes: [{ chain: "c1", when: "now" }], also: "" } });
    assert.deepEqual([ran.status, ran.body.sync.lanes.map((/** @type {any} */ l) => l.chain), ran.body.space.syncs.length], [200, ["c1"], 1]);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(posts.map(([c]) => c), ["c1"]);
    assert.deepEqual(await call(rows, "POST", "/space/p1/sync", { json: { lanes: [{ chain: "x1" }] } }).then((r) => [r.status, r.body.error]), [400, '"an untitled chat" is no chat of this project']);
    assert.deepEqual(await call(routesOf({ sync: false }).rows, "POST", "/space/p1/sync", { json: { lanes: [] } }).then((r) => r.status), 503);
  });

  test("the week's page as Markdown; a lane's files read only in a folder Filament may read", async () => {
    const { rows, store } = routesOf();
    store.addTask("p1", { title: "Docs" }, { kind: "you" });
    const week = await call(rows, "GET", "/space/p1/week.md");
    assert.equal(week.headers["content-type"], "text/markdown; charset=utf-8");
    assert.match(week.text, /^# filament — its Space\n[\s\S]*## Planned\n\n- \*\*Docs\*\*\n/);
    const outside = process.platform === "win32" ? "Z:\\nowhere-filament" : "/nowhere-filament";
    const files = await call(rows, "GET", "/space/p1/files", { query: `?place=${encodeURIComponent(outside)}` });
    assert.equal(files.status, 200);
    assert.deepEqual(files.body.places.map((/** @type {any} */ p) => [p.path, p.ok, p.files]), [[outside, false, []]]);
    const tooMany = await call(rows, "GET", "/space/p1/files", { query: `?${Array.from({ length: 21 }, (_, i) => `place=f${i}`).join("&")}` });
    // (fails before: yes — "20 places", the code's word for a folder or worktree: the page's Compare… shows this refusal)
    assert.deepEqual([tooMany.status, tooMany.body.error], [400, "one read takes 20 folders at most"]);
    assert.equal(LOG_SHOWN, 300);
  });
});

// What happened, filling itself (HarnessV4_Space_Plan SG-D4): a turn that ends has its project's places read and
// Filament's lines written; the ends close together read once; a helper's, an archived or a no-project chat writes
// nothing; git that cannot read still has the chat's line.
// (fails before: yes — nothing wrote what a chat finished)
describe("What happened on a turn's end", () => {
  /** A stand-in world: chats, a project's folder, its places as git reads them, whose chat is where. */
  const worldOf = () => {
    const w = {
      chats: /** @type {Record<string, { project: string | null, name: string, listed: boolean }>} */ ({
        c1: { project: "p1", name: "login", listed: true },
        c2: { project: "p1", name: "docs", listed: true },
        h1: { project: "p1", name: "a helper", listed: false },
        n1: { project: null, name: "loose", listed: true },
      }),
      places: /** @type {any[] | null} */ ([
        { ok: true, path: "/r", name: "r", main: true, branch: "main", base: null, onBase: true, ahead: null, uncommitted: { files: 0 } },
        { ok: true, path: "/r-login", name: "r-login", main: false, branch: "feat/login", base: "main", onBase: false, ahead: 1, uncommitted: { files: 2 } },
      ]),
      reads: 0,
    };
    return w;
  };
  /** @param {ReturnType<typeof worldOf>} w @param {ReturnType<typeof memoryStore>} m */
  const newsOf = (w, m) =>
    createSpaceNews({
      store: m.store,
      chat: (c) => w.chats[c] || null,
      folderOf: (p) => (p === "p1" ? "/r" : null),
      places: async () => {
        w.reads++;
        return w.places ? { ok: true, places: w.places } : { ok: false, error: "not in a git repository" };
      },
      chatsIn: (folders) => new Map(folders.map((f) => [f, f === "/r-login" ? [{ id: "c1", name: "login", home: true }] : f === "/r" ? [{ id: "c2", name: "docs", home: true }, { id: "c1", name: "login", home: false }] : []])),
      settleMs: 0,
    });

  test("a chat's turn ends: its line with its place, the places learned; ends close together read once; the lanes' news next time", async () => {
    const w = worldOf();
    const m = memoryStore();
    const news = newsOf(w, m);
    news.ended("c1");
    news.ended("c2");
    news.ended("c1");
    await news.settled();
    assert.equal(w.reads, 1, "one read for the ends close together");
    // (fails before: yes — the review of 80c691cd2: every end inside the settle window counted a turn, and a lock's
    // release names none — a move's or a pause's request's let go as a turn's does, each read as a turn more)
    assert.deepEqual(m.store.get("p1").log.map((e) => [e.by, e.text]), [
      [{ kind: "filament", chain: "c1" }, "“login” finished a turn in feat/login: 2 files changed, not committed, 1 commit not on main"],
      [{ kind: "filament", chain: "c2" }, "“docs” finished a turn in main: nothing uncommitted"],
    ]);
    assert.deepEqual(Object.keys(m.store.get("p1").seen || {}), ["/r", "/r-login"]);
    // The branch's commits land on main; a new worktree is made.
    w.places = [{ ...w.places?.[0] }, { ...w.places?.[1], ahead: 0, uncommitted: { files: 0 } }, { ok: true, path: "/r-new", name: "r-new", main: false, branch: "feat/new", base: "main", onBase: false, ahead: 0, uncommitted: { files: 0 } }];
    m.clock.at = WED + 5 * 60_000;
    news.ended("c2");
    await news.settled();
    assert.deepEqual(m.store.get("p1").log.map((e) => e.text), [
      "“login” finished a turn in feat/login: 2 files changed, not committed, 1 commit not on main",
      "“docs” finished 2 turns since 10:00 in main: nothing uncommitted",
      "feat/login was merged into main",
      "A new worktree: feat/new",
    ]);
  });

  // (fails before: yes — Hunter sa_bfb456b6: the read kept a chat's last end alone — a client's turn 1 and turn 2 ended
  // together read as one turn)
  test("a client's ends close together: each a turn, a failed end and its retry's one turn", async () => {
    const w = worldOf();
    const m = memoryStore();
    const news = newsOf(w, m);
    news.ended("c1", 1, false);
    news.ended("c1", 2, true);
    news.ended("c1", 2, false);
    news.ended("c2", 5, true);
    news.ended("c2", 5, false);
    await news.settled();
    assert.equal(w.reads, 1);
    assert.deepEqual(m.store.get("p1").log.map((e) => e.text), [
      "“login” finished 2 turns since 10:00 in feat/login: 2 files changed, not committed, 1 commit not on main",
      "“docs” finished a turn in main: nothing uncommitted",
    ]);
  });

  test("a helper's, a no-project or an unknown chat: nothing read, nothing written; git that cannot read: the line with no place", async () => {
    const w = worldOf();
    const m = memoryStore();
    const news = newsOf(w, m);
    news.ended("h1");
    news.ended("n1");
    news.ended("zz");
    await news.settled();
    assert.deepEqual([w.reads, m.store.get("p1").log.length], [0, 0]);
    w.places = null;
    news.ended("c1");
    await news.settled();
    assert.deepEqual(m.store.get("p1").log.map((e) => e.text), ["“login” finished a turn"]);
    assert.equal(m.store.get("p1").seen, null, "nothing learned of the places");
  });
});
