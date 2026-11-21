// @ts-check
// The Space Apps plan of 10-29, decision 7: Pull from… — Linear, GitHub or Jira on a Space's board through a connector
// of the project's. A pull's core (the column a state goes to, its checks, the guesses Read once starts from, the cards
// a service's answer puts on the board and a move here standing until the service says another state, a move's args);
// the store keeping pulls (set up, changed, moved, Always for this board, taken off, read back from its file); the
// runner (a read as the board is shown, a move on the board only or back to the service, a failed move moving nothing);
// the page's arithmetic (the move's ask, a pull's chip); the agents' board read with pulled cards; and end to end over a
// stand-in Linear server: presets, its tools, Read once, a pull kept, its cards, a move back, a move here only, the
// service winning, taken off.
// (fails before: yes — there were no pulls)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PULL_CARDS_MAX, PULL_PRESETS, backArgs, guessColumn, keyWords, laneOfKey, movedKept, pullCards, pullFault, pullGuess, pullKept, pullRows, toState } from "../src/core/space-pulls.js";
import { boardWords } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createPulls } from "../src/app/space-pulls.js";
import { moveAsk, pullChipWords } from "../src/ui/harness/lib/space-view.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-issues-server.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** A folder of the test's own. @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-pulls-${tag}-`));
  made.push(d);
  return d;
};

/** Thursday 29 October 2026, noon. */
const T = Date.UTC(2026, 9, 29, 12);

/** Linear's issues, as its list_issues answers them. */
const LINEAR = [
  { id: "a1", identifier: "LIN-42", title: "Login redirect loops", status: "In Progress", url: "https://linear.example.invalid/acme/issue/LIN-42", assignee: { name: "Sara" } },
  { id: "a2", identifier: "LIN-43", title: "Retry the flaky upload", status: "Todo", url: "https://linear.example.invalid/acme/issue/LIN-43", assignee: { name: "Ken" } },
  { id: "a3", identifier: "LIN-44", title: "Review the docs", status: "In Review", url: "https://linear.example.invalid/acme/issue/LIN-44", assignee: null },
  { id: "a4", identifier: "LIN-40", title: "An old one", status: "Done", url: "https://linear.example.invalid/acme/issue/LIN-40", assignee: null },
];

/** A Linear pull as the sheet sends it. @param {any} [o] */
const linearPull = (o = {}) => ({
  service: "linear",
  title: "Linear",
  connection: "linear",
  tool: "list_issues",
  args: { assignee: "me" },
  rows: "",
  key: "identifier",
  name: "title",
  state: "status",
  url: "url",
  line: "assignee.name",
  columns: { Todo: "planned", "In Progress": "doing", "In Review": "waits", Done: "done", Canceled: "done" },
  back: { tool: "update_issue", args: { id: "{key}", state: "{state}" } },
  ...o,
});
/** A pull as a Space keeps it. @param {any} [o] */
const kept = (o = {}) => /** @type {import("../src/core/space-pulls.js").SpacePull} */ (pullKept({ id: "p1", at: T, ...linearPull(o) }));

describe("a pull's core", () => {
  test("a state's column by its words: Todo Planned, In Progress Doing, In Review Waits, Done and Canceled Done", () => {
    assert.deepEqual(
      ["Todo", "Backlog", "In Progress", "Started", "In Review", "Blocked", "Done", "Canceled", "closed", "OPEN"].map(guessColumn),
      ["planned", "planned", "doing", "doing", "waits", "waits", "done", "done", "done", "planned"],
    );
  });

  test("its checks name the part: a key, a title, a column that is one, a move back that names the card", () => {
    assert.equal(pullFault(linearPull()), "");
    assert.match(pullFault(linearPull({ key: "" })), /needs a key/);
    assert.match(pullFault(linearPull({ name: " " })), /needs a name/);
    assert.match(pullFault(linearPull({ columns: { Todo: "later" } })), /"Todo" goes to "later", which is no column/);
    assert.match(pullFault(linearPull({ back: { tool: "update_issue", args: { state: "{state}" } } })), /names the card nowhere/);
    assert.match(pullFault(linearPull({ service: "trello" })), /service is one of linear, github, jira, other/);
    assert.match(pullFault(linearPull({ connection: "" })), /connector/);
    assert.equal(pullFault(linearPull({ back: null })), "", "a pull with no move back: its moves stay on the board");
    assert.equal(kept({ back: null, always: true }).always, false, "no move back, no Always");
  });

  test("Read once's guess: Linear's list itself, its paths; Jira's at issues, its fields; GitHub's numbers", () => {
    const linear = pullGuess(JSON.stringify(LINEAR), PULL_PRESETS[0]);
    assert.ok(linear.ok);
    assert.deepEqual(
      [linear.rows, linear.count, linear.key, linear.name, linear.state, linear.url, linear.line, linear.states],
      ["", 4, "identifier", "title", "status", "url", "assignee.name", ["In Progress", "Todo", "In Review", "Done"]],
    );
    assert.deepEqual(linear.columns, { "In Progress": "doing", Todo: "planned", "In Review": "waits", Done: "done" });
    const jira = pullGuess(JSON.stringify({ total: 1, issues: [{ key: "PLAY-88", fields: { summary: "Retry", status: { name: "To Do" }, assignee: { displayName: "Ana" } } }] }), PULL_PRESETS[2]);
    assert.ok(jira.ok);
    assert.deepEqual([jira.rows, jira.key, jira.name, jira.state, jira.line, jira.states], ["issues", "key", "fields.summary", "fields.status.name", "fields.assignee.displayName", ["To Do"]]);
    // A preset's path the answer lacks is guessed again from what it has.
    const gh = pullGuess(JSON.stringify({ items: [{ number: 12, title: "Crash", state: "open", url: "https://github.example.invalid/o/r/issues/12" }] }), PULL_PRESETS[1]);
    assert.ok(gh.ok);
    assert.deepEqual([gh.rows, gh.key, gh.state, gh.url], ["items", "number", "state", "url"]);
    assert.deepEqual(pullGuess("not json"), { ok: false, error: "it answered words, not JSON" });
    assert.deepEqual(pullGuess(JSON.stringify({ count: 3 })), { ok: false, error: "its answer holds no list of items: is this the tool that lists them?" });
  });

  test("its cards: each in its state's column, Done kept off, a link only where it is one", () => {
    const p = kept();
    const r = pullRows(p, JSON.stringify([...LINEAR, { identifier: "LIN-45", title: "", status: "Todo" }, { identifier: "LIN-46", title: "Bad link", status: "Todo", url: "javascript:alert(1)" }]));
    assert.ok(r.ok);
    const { cards, more, done } = pullCards(p, r.rows, T);
    assert.deepEqual(cards.map((c) => [c.key, c.column, c.line, c.moved]), [["LIN-42", "doing", "Sara", false], ["LIN-43", "planned", "Ken", false], ["LIN-44", "waits", "", false], ["LIN-46", "planned", "", false]]);
    assert.deepEqual([more, done, cards.at(-1)?.url], [0, 1, ""], "a row with no title is no card; javascript: is no link");
    assert.deepEqual(pullRows(p, "{}"), { ok: false, error: "it answered no list: name where its list is in its sheet" });
    const many = Array.from({ length: PULL_CARDS_MAX + 3 }, (_, i) => ({ key: `LIN-${i}`, title: "x", state: "Todo", url: "", line: "" }));
    assert.equal(pullCards(p, many, T).more, 3);
  });

  test("a card moved here stands while the service says the state it had; once it says another, the service wins", () => {
    const rows = [{ key: "LIN-43", title: "Retry", state: "Todo", url: "", line: "" }];
    const p = kept({ moved: { "LIN-43": { column: "waits", from: "Todo", at: T } } });
    assert.deepEqual(pullCards(p, rows, T).cards.map((c) => [c.column, c.moved]), [["waits", true]]);
    const later = [{ ...rows[0], state: "In Progress" }];
    assert.deepEqual(pullCards(p, later, T).cards.map((c) => [c.column, c.moved]), [["doing", false]]);
    assert.deepEqual(movedKept(p, later, T), {}, "its move goes with the next write");
    assert.deepEqual(Object.keys(movedKept(p, [], T)), ["LIN-43"], "a row gone from the answer keeps its move: it may come back");
    // Moved to Done this week: it stays in Done while the service says Done.
    const done = kept({ moved: { "LIN-43": { column: "done", from: "Done", at: T } } });
    assert.deepEqual(pullCards(done, [{ ...rows[0], state: "Done" }], T).cards.map((c) => c.column), ["done"]);
    assert.deepEqual(pullCards(done, [{ ...rows[0], state: "Done" }], T + 7 * 86_400_000).cards, [], "a week on, it is off the board");
  });

  test("a move's state and args: Done before Canceled, {key}, {state} and the pull's own args filled", () => {
    const p = kept();
    assert.deepEqual([toState(p, "done"), toState(p, "doing"), toState(kept({ columns: { Todo: "planned" } }), "waits")], ["Done", "In Progress", null]);
    assert.deepEqual(backArgs(p, "LIN-42", "Done"), { id: "LIN-42", state: "Done" });
    const gh = kept({ service: "github", args: { owner: "acme", repo: "app", state: "OPEN" }, back: { tool: "update_issue", args: { owner: "{owner}", repo: "{repo}", issue_number: "{key}", state: "{state}", note: "{nothing}" } } });
    assert.deepEqual(backArgs(gh, "12", "closed"), { owner: "acme", repo: "app", issue_number: "12", state: "closed", note: "{nothing}" });
    assert.deepEqual([keyWords(gh, "12"), laneOfKey(gh, "12"), keyWords(p, "LIN-42"), laneOfKey(p, "LIN-42"), laneOfKey(p, "PLAY_88 x")], ["#12", "issue-12", "LIN-42", "lin-42", "play-88-x"]);
  });

  test("the agents' board read names a pulled card by its key, and says it is the person's to move", () => {
    const doc = createSpaceStore({ dir: null, now: () => T }).get("p1");
    const words = boardWords(doc, { nameOf: (c) => c, now: T, fed: { tasks: [{ title: "Linear", task: "Login redirect loops", key: "LIN-42", line: "Sara", column: "doing", stale: false, pulled: true }], counts: [] } });
    assert.match(words, /Doing 0 \+ 1 pulled/);
    assert.match(words, /- from Linear: LIN-42 "Login redirect loops"\. Sara/);
    assert.match(words, /A pulled card is an issue of its service, as Filament read it, by its key: the person moves it on the board, and in its service when they say so — not you, with take or move\./);
    assert.doesNotMatch(words, /A card from a dashboard/);
  });
});

describe("the store keeps pulls", () => {
  test("set up, changed, moved, Always, taken off — each the person's line in What happened; read back from its file", () => {
    const dir = fresh("store");
    const store = createSpaceStore({ dir, now: () => T });
    const p = store.pullSave("p1", linearPull());
    assert.equal(p.id, "p1");
    assert.equal(store.get("p1").log.at(-1)?.text, "You pulled Linear's issues onto the board, read through linear › list_issues.");
    const rows = [{ key: "LIN-43", title: "Retry", state: "Todo", url: "", line: "" }];
    store.pullMoved("p1", p.id, "LIN-43", { column: "waits", from: "Todo" }, rows);
    assert.deepEqual(store.get("p1").pulls?.[0].moved, { "LIN-43": { column: "waits", from: "Todo", at: T } });
    // Changed in its sheet, reading the same: its moves stay; reading another tool: they go.
    store.pullSave("p1", { ...linearPull({ title: "Linear (mine)" }), id: p.id });
    assert.deepEqual(Object.keys(store.get("p1").pulls?.[0].moved || {}), ["LIN-43"]);
    store.pullMoved("p1", p.id, "LIN-43", { column: "doing", from: "In Progress", went: "In Progress", always: true }, [{ ...rows[0], state: "In Progress" }]);
    const log = store.get("p1").log.map((e) => e.text);
    assert.deepEqual(log.slice(-2), ["You moved LIN-43 to In Progress in Linear (mine).", "Moves of Linear (mine)'s cards on this board go back to Linear (mine) without asking you."]);
    assert.equal(new Set(store.get("p1").log.map((e) => e.id)).size, store.get("p1").log.length, "each line its own id");
    // Read back by a store that starts again: as kept.
    const again = createSpaceStore({ dir, now: () => T }).get("p1").pulls?.[0];
    assert.deepEqual([again?.title, again?.always, again?.moved["LIN-43"]], ["Linear (mine)", true, { column: "doing", from: "In Progress", at: T }]);
    store.pullSave("p1", { ...linearPull({ tool: "search_issues", title: "Linear (mine)", always: true }), id: p.id });
    assert.deepEqual(store.get("p1").pulls?.[0].moved, {}, "another tool: its moves start again");
    store.pullAlways("p1", p.id, false);
    assert.equal(store.get("p1").log.at(-1)?.text, "Moves of Linear (mine)'s cards on this board ask you again before they go back to Linear (mine).");
    // Always from its sheet's save is the same word, said the same way: on, off, and with a pull that is new.
    // (fails before: yes — the re-read of 11-11: a save set Always past the switch, and What happened said nothing)
    const said = () => store.get("p1").log.map((e) => e.text);
    let lines = said().length;
    store.pullSave("p1", { ...linearPull({ tool: "search_issues", title: "Linear (mine)", always: true }), id: p.id });
    assert.deepEqual([store.get("p1").pulls?.[0].always, said().slice(lines)], [true, ["Moves of Linear (mine)'s cards on this board go back to Linear (mine) without asking you."]]);
    lines = said().length;
    store.pullSave("p1", { ...linearPull({ tool: "search_issues", title: "Linear (mine)", always: true }), id: p.id });
    assert.deepEqual(said().slice(lines), [], "as it was: nothing more to say");
    store.pullSave("p1", { ...linearPull({ tool: "search_issues", title: "Linear (mine)" }), id: p.id });
    assert.deepEqual([store.get("p1").pulls?.[0].always, said().slice(lines)], [false, ["Moves of Linear (mine)'s cards on this board ask you again before they go back to Linear (mine)."]]);
    lines = said().length;
    const second = store.pullSave("p1", linearPull({ title: "Jira", always: true }));
    assert.deepEqual(said().slice(lines), ["You pulled Jira's issues onto the board, read through linear › list_issues.", "Moves of Jira's cards on this board go back to Jira without asking you."]);
    assert.equal(new Set(store.get("p1").log.map((e) => e.id)).size, store.get("p1").log.length, "each line its own id");
    assert.throws(() => store.pullSave("p1", { ...linearPull({ title: "Jira", back: null, always: true }), id: second.id }), /has no way to move a card back/, "Always with no way back is refused, as its switch refuses it");
    store.pullRemove("p1", second.id);
    store.pullRemove("p1", p.id);
    assert.equal(store.get("p1").pulls, undefined);
    assert.equal(store.get("p1").log.at(-1)?.text, "You took Linear (mine)'s pull off the board: its cards went from it, and nothing changed in Linear (mine).");
    // Filament's lines on what the person did, as "You made this Space." is (found by the drive: written as the
    // person's, What happened drew each as a note they typed, in quotes).
    assert.deepEqual([...new Set(store.get("p1").log.map((e) => e.by.kind))], ["filament"]);
  });

  test("its refusals: a pull that is none, one past the most, one of no id, Always with no move back", () => {
    const store = createSpaceStore({ dir: null, now: () => T });
    assert.throws(() => store.pullSave("p1", linearPull({ key: "" })), /needs a key/);
    for (let i = 0; i < 6; i++) store.pullSave("p1", linearPull({ title: `Linear ${i}` }));
    assert.throws(() => store.pullSave("p1", linearPull()), /pulls from 6 services at most/);
    assert.throws(() => store.pullSave("p1", { ...linearPull(), id: "p999" }), /There is no pull "p999"/);
    const jira = createSpaceStore({ dir: null, now: () => T });
    const j = jira.pullSave("p1", linearPull({ service: "jira", title: "Jira", back: null }));
    assert.throws(() => jira.pullAlways("p1", j.id, true), /no way to move a card back/);
  });

  test("a file's pull that does not read as one goes; the rest stay", () => {
    const dir = fresh("file");
    // A Space of this Filament's: the Spaces of before were set aside already.
    writeFileSync(join(dir, "_set-aside.json"), "{}");
    writeFileSync(join(dir, "p1.json"), JSON.stringify({ version: 1, seq: 3, tasks: [], log: [], pulls: [{ id: "p1", ...linearPull() }, { id: "p2", ...linearPull({ key: "" }) }, { id: "p1", ...linearPull({ title: "Twice" }) }] }));
    const doc = createSpaceStore({ dir, now: () => T }).get("p1");
    assert.deepEqual(doc.pulls?.map((p) => [p.id, p.title]), [["p1", "Linear"]]);
  });
});

describe("the runner", () => {
  /**
   * A Space with a Linear pull, and the runner over stand-in tools: its list answers `issues`; a move calls `act`.
   * @param {{ act?: (args: any) => any }} [o]
   */
  const setup = (o = {}) => {
    let now = T;
    const store = createSpaceStore({ dir: null, now: () => now });
    const p = store.pullSave("p1", linearPull());
    let issues = structuredClone(LINEAR);
    /** @type {any[]} */
    const calls = [];
    /** @type {any[]} */
    const said = [];
    const pulls = createPulls({
      spaces: store,
      now: () => now,
      events: { publish: (topic, data) => said.push([topic, data]) },
      tools: () => ({
        read: async (_p, t) => (calls.push(["read", t.name, t.args]), { ok: true, out: JSON.stringify(issues) }),
        act: async (_p, t, args) => (calls.push(["act", t.name, args]), o.act ? o.act(args) : { ok: true, said: "Moved." }),
        toolsOf: async () => ({ ok: true, tools: [] }),
      }),
    });
    return { store, p, pulls, calls, said, set: (/** @type {any[]} */ x) => (issues = x), later: (/** @type {number} */ ms) => (now += ms) };
  };

  test("the board shown reads it: its first read says it reads, then its cards come, an open Space told", async () => {
    const { pulls, p, calls, said } = setup();
    assert.deepEqual(pulls.cards("p1"), { tasks: [], counts: [{ pull: p.id, title: "Linear", count: 0, more: 0, done: 0, reading: true }] });
    await pulls.readNow("p1", p.id);
    const { tasks, counts } = pulls.cards("p1");
    assert.deepEqual(tasks.map((c) => [c.keyWords, c.column, c.lane, c.stale]), [["LIN-42", "doing", "lin-42", false], ["LIN-43", "planned", "lin-43", false], ["LIN-44", "waits", "lin-44", false]]);
    assert.deepEqual(counts, [{ pull: p.id, title: "Linear", count: 3, more: 0, done: 1 }]);
    assert.deepEqual(calls, [["read", "list_issues", { assignee: "me" }]], "one read: a second ask while it reads waits for it");
    assert.deepEqual(said, [["space", { type: "space", project: "p1", pull: p.id }]]);
    assert.deepEqual(pulls.shown("p1")[0].backStates, { planned: "Todo", doing: "In Progress", waits: "In Review", done: "Done" });
  });

  test("a move back calls its tool with the card's key and its column's state, then stands; What happened says so", async () => {
    const { pulls, p, store, calls } = setup();
    await pulls.readNow("p1", p.id);
    const out = await pulls.move("p1", p.id, { key: "LIN-43", column: "doing", back: true });
    assert.deepEqual(out, { ok: true, went: "In Progress" });
    assert.deepEqual(calls.at(-1), ["act", "update_issue", { id: "LIN-43", state: "In Progress" }]);
    assert.equal(store.get("p1").log.at(-1)?.text, "You moved LIN-43 to In Progress in Linear.");
    assert.deepEqual(pulls.cards("p1").tasks.find((c) => c.key === "LIN-43")?.column, "doing");
  });

  test("a move whose tool fails moves nothing and says why; one to a column no state goes to is refused", async () => {
    const { pulls, p, store } = setup({ act: () => ({ ok: false, error: "the tool said it failed: Nope is no state", said: "" }) });
    await pulls.readNow("p1", p.id);
    const before = store.get("p1").seq;
    assert.deepEqual(await pulls.move("p1", p.id, { key: "LIN-43", column: "done", back: true }), { ok: false, error: "Linear did not move LIN-43: the tool said it failed: Nope is no state" });
    assert.equal(store.get("p1").seq, before, "nothing written");
    assert.equal(pulls.cards("p1").tasks.find((c) => c.key === "LIN-43")?.column, "planned");
    store.pullSave("p1", { ...linearPull({ columns: { Todo: "planned", "In Progress": "doing" } }), id: p.id });
    await assert.rejects(pulls.move("p1", p.id, { key: "LIN-43", column: "waits", back: true }), /No state of Linear goes to Waits for you in this pull's columns: it moves on this board only\./);
    await assert.rejects(pulls.move("p1", p.id, { key: "LIN-99", column: "doing" }), /LIN-99 is not among what Linear answered last: read it again\./);
  });

  test("a move here only stands until the service says another state, then the service wins", async () => {
    const { pulls, p, calls, set, later } = setup();
    await pulls.readNow("p1", p.id);
    assert.deepEqual(await pulls.move("p1", p.id, { key: "LIN-42", column: "waits" }), { ok: true, went: null });
    assert.equal(calls.filter((c) => c[0] === "act").length, 0, "nothing sent");
    assert.deepEqual(pulls.cards("p1").tasks.filter((c) => c.key === "LIN-42").map((c) => [c.column, c.moved]), [["waits", true]]);
    later(300_000);
    set(LINEAR.map((x) => (x.identifier === "LIN-42" ? { ...x, status: "In Review" } : x)));
    pulls.cards("p1");
    await pulls.readNow("p1", p.id);
    assert.deepEqual(pulls.cards("p1").tasks.filter((c) => c.key === "LIN-42").map((c) => [c.column, c.moved]), [["waits", false]], "the service's own state now");
    set(LINEAR.map((x) => (x.identifier === "LIN-42" ? { ...x, status: "Todo" } : x)));
    later(300_000);
    await pulls.readNow("p1", p.id);
    assert.equal(pulls.cards("p1").tasks.find((c) => c.key === "LIN-42")?.column, "planned", "the service wins");
  });

  test("a read that fails keeps what it read, faint, and says why in its count", async () => {
    const { pulls, p, store } = setup();
    await pulls.readNow("p1", p.id);
    store.pullSave("p1", { ...linearPull(), id: p.id });
    const bad = createPulls({ spaces: store, now: () => T, tools: () => ({ read: async () => ({ ok: false, error: "linear could not be reached" }), act: async () => ({ ok: true, said: "" }), toolsOf: async () => ({ ok: true, tools: [] }) }) });
    assert.deepEqual(await bad.readNow("p1", p.id), { ok: false, error: "linear › list_issues: linear could not be reached" });
    assert.deepEqual(bad.cards("p1").counts, [{ pull: p.id, title: "Linear", count: 0, more: 0, done: 0, error: "linear › list_issues: linear could not be reached" }]);
    assert.equal(pullChipWords(bad.cards("p1").counts[0]), "Linear: its read failed");
  });
});

describe("the page's arithmetic", () => {
  const card = { pull: "p1", service: "linear", title: "Linear", key: "LIN-43", keyWords: "LIN-43", task: "Retry", line: "", column: /** @type {const} */ ("planned"), state: "Todo", url: "", lane: "lin-43", moved: false, at: T, stale: false };
  const shown = { id: "p1", service: "linear", title: "Linear", connection: "linear", tool: "list_issues", args: {}, rows: "", key: "identifier", name: "title", state: "status", url: "url", line: "", columns: {}, back: { tool: "update_issue", args: {} }, always: false, at: T, backStates: { planned: "Todo", doing: "In Progress", waits: null, done: "Done" }, readAt: T, error: null, reading: false };

  test("the move asks “Move LIN-43 to In Progress in Linear too?”; on the board only where it cannot go back", () => {
    assert.deepEqual(moveAsk(card, shown, "doing"), { back: true, ask: "Move LIN-43 to In Progress in Linear too?", state: "In Progress" });
    assert.deepEqual(moveAsk(card, shown, "waits"), { back: false, why: "No state of Linear goes to Waits for you in this pull's columns: it moves on this board only." });
    assert.deepEqual(moveAsk(card, shown, "planned"), { back: false, why: "Linear says Todo already." });
    assert.deepEqual(moveAsk(card, { ...shown, back: null }, "doing"), { back: false, why: "Linear's pull has no way to move a card back: it moves on this board only." });
  });

  test("a pull's chip: its cards, reading, its read failed", () => {
    assert.deepEqual(
      [pullChipWords({ pull: "p1", title: "Linear", count: 3, more: 2, done: 1 }), pullChipWords({ pull: "p1", title: "Linear", count: 0, more: 0, done: 0, reading: true }), pullChipWords({ pull: "p1", title: "Linear", count: 3, more: 0, done: 0, error: "x" })],
      ["Linear 5", "Linear reading…", "Linear 3"],
    );
  });
});

describe("end to end over a stand-in Linear", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = fresh("e2e");
  const log = join(root, "calls.log");
  /** What the space tool's read told the chat's agent. */
  let told = "";
  before(async () => {
    writeFileSync(log, "");
    // The chat's agent reads the board with its space tool, once.
    up = await fakeUpstream(async (call) => {
      const body = call.body || {};
      if (!body.tools?.length) return anthropicReply("A title", { model: "brain-model" });
      const last = body.messages?.at(-1);
      const parts = Array.isArray(last?.content) ? last.content : [];
      const result = parts.find((/** @type {any} */ p) => p?.type === "tool_result");
      if (result) {
        told = JSON.stringify(result.content);
        return anthropicReply("Read it.", { model: "brain-model" });
      }
      return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "space", input: { action: "read" } }] });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  test("Pull from… Linear: Read once, kept, its cards, a move back, a move here only, taken off", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", title: "issues", settings: { loop: { permissions: "auto" } } } });
    assert.equal(s.status, 200, await s.clone().text());
    const chat = String((await s.json()).id);
    const { projectId } = await (await shim.api(`/api/sessions/${encodeURIComponent(chat)}/settings`)).json();
    const base = `/api/space/${encodeURIComponent(projectId)}`;
    assert.equal((await shim.api(base, { method: "POST" })).status, 200);
    const linear = { name: "linear", command: process.execPath, args: [FIXTURE], env: { MCP_FIXTURE_LOG: log } };
    assert.equal((await shim.api(`/api/projects/${encodeURIComponent(projectId)}/settings`, { method: "POST", body: { patch: { plugins: { mcp: [linear] } } } })).status, 200);
    const presets = (await (await shim.api(`${base}/pulls/presets`)).json()).presets;
    assert.deepEqual(presets.map((/** @type {any} */ p) => p.service), ["linear", "github", "jira", "other"]);
    const tools = await (await shim.api(`${base}/pulls/tools?connection=linear`)).json();
    assert.deepEqual(tools.tools.map((/** @type {any} */ t) => [t.name, t.readOnly]), [["list_issues", true], ["update_issue", false]]);
    const g = await (await shim.api(`${base}/pulls/try`, { method: "POST", body: { service: "linear", connection: "linear", tool: "list_issues", args: { assignee: "me" } } })).json();
    assert.deepEqual([g.ok, g.count, g.key, g.name, g.state, g.url, g.line], [true, 4, "identifier", "title", "status", "url", "assignee.name"]);
    assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1, "Read once read once");
    const refused = await shim.api(`${base}/pulls/try`, { method: "POST", body: { service: "linear", connection: "linear", tool: "update_issue", args: {} } });
    assert.match((await refused.json()).error, /does not say update_issue only reads/);
    const saved = await shim.api(`${base}/pulls`, { method: "POST", body: { ...linearPull(), rows: g.rows, columns: g.columns } });
    assert.equal(saved.status, 200, await saved.clone().text());
    const { pull, space: first } = await saved.json();
    assert.equal(first.log.at(-1).text, "You pulled Linear's issues onto the board, read through linear › list_issues.");
    const space = async () => (await shim.api(base)).json();
    const cards = await until(async () => {
      const sp = await space();
      return sp.pulled?.tasks?.length ? sp.pulled.tasks : null;
    }, "its cards on the board");
    assert.deepEqual(cards.map((/** @type {any} */ c) => [c.keyWords, c.column, c.lane, c.url]), [
      ["LIN-42", "doing", "lin-42", "https://linear.example.invalid/acme/issue/LIN-42"],
      ["LIN-43", "planned", "lin-43", "https://linear.example.invalid/acme/issue/LIN-43"],
      ["LIN-44", "waits", "lin-44", "https://linear.example.invalid/acme/issue/LIN-44"],
    ]);
    // The chat's agent reads them with the board, by their key, and that they are the person's to move.
    const turn = await shim.api(`/api/sessions/${encodeURIComponent(chat)}/turns`, { method: "POST", body: { content: "what is on the board?", stream: false } });
    assert.equal(turn.status, 200, await turn.clone().text());
    assert.match(told, /from Linear: LIN-42 \\"Login redirect loops\\". Sara/);
    assert.match(told, /A pulled card is an issue of its service/);
    const at = `${base}/pulls/${encodeURIComponent(pull.id)}`;
    writeFileSync(log, "");
    const back = await (await shim.api(`${at}/move`, { method: "POST", body: { key: "LIN-43", column: "doing", back: true } })).json();
    assert.deepEqual([back.ok, back.went], [true, "In Progress"]);
    assert.deepEqual(JSON.parse(readFileSync(log, "utf8").trim()), { tool: "update_issue", args: { id: "LIN-43", state: "In Progress" } });
    assert.equal(back.space.log.at(-1).text, "You moved LIN-43 to In Progress in Linear.");
    assert.equal(back.space.pulled.tasks.find((/** @type {any} */ c) => c.key === "LIN-43").column, "doing");
    writeFileSync(log, "");
    const here = await (await shim.api(`${at}/move`, { method: "POST", body: { key: "LIN-42", column: "waits" } })).json();
    assert.deepEqual([here.ok, here.went, readFileSync(log, "utf8")], [true, null, ""], "here only: nothing sent");
    assert.deepEqual(here.space.pulled.tasks.filter((/** @type {any} */ c) => c.key === "LIN-42").map((/** @type {any} */ c) => [c.column, c.moved]), [["waits", true]]);
    // Read again: Linear still says In Progress, so it stands; moved to Done there, it is Done here this week.
    const again = await (await shim.api(`${at}/read`, { method: "POST" })).json();
    assert.equal(again.ok, true);
    assert.equal(again.space.pulled.tasks.find((/** @type {any} */ c) => c.key === "LIN-42").column, "waits");
    const done = await (await shim.api(`${at}/move`, { method: "POST", body: { key: "LIN-42", column: "done", back: true, always: true } })).json();
    assert.deepEqual([done.ok, done.went], [true, "Done"]);
    assert.deepEqual(done.space.log.slice(-2).map((/** @type {any} */ e) => e.text), ["You moved LIN-42 to Done in Linear.", "Moves of Linear's cards on this board go back to Linear without asking you."]);
    const read = await (await shim.api(`${at}/read`, { method: "POST" })).json();
    assert.deepEqual(read.space.pulled.tasks.find((/** @type {any} */ c) => c.key === "LIN-42")?.column, "done", "Linear says Done: in Done this week");
    assert.equal(read.space.pulls[0].always, true);
    const off = await (await shim.api(at, { method: "DELETE" })).json();
    assert.deepEqual([off.space.pulled, off.space.pulls], [{ tasks: [], counts: [] }, []]);
    assert.equal((await shim.api(`${at}/move`, { method: "POST", body: { key: "LIN-43", column: "done" } })).status, 404);
  });
});
