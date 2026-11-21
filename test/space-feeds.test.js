// @ts-check
// What a kept dashboard feeds into its Space (HarnessV4_Space_Plan S4c): a line on the lane whose branch a row names,
// a card on the board for each row of another source. The checks a publish meets, the forms kept, and the lines and
// cards drawn from rows Filament already reads.
import test from "node:test";
import assert from "node:assert/strict";
import { FED_TASKS_MAX, LANE_LINES_MAX, feedWords, feedsFault, laneFeedOf, laneLines, taskCards, taskFeedOf } from "../src/core/space-feeds.js";
import { ROW_KEY } from "../src/core/dashboard-sources.js";
import { FED_TASKS_MAX as PAGE_MAX, feedShows } from "../src/ui/harness/lib/space-dashboards.js";
import { LANE_FED_SHOWN, fedCountWords } from "../src/ui/harness/lib/space-view.js";

const SOURCES = {
  prs: { run: ["gh", "pr", "list"], columns: { number: "number", title: "title", branch: "headRefName", checks: "checks" } },
  issues: { run: ["gh", "issue", "list"], fields: ["id", "title", "labels", "state"] },
  loose: { run: ["cat", "rows.json"] },
};
const TABLES = { loose: [{ name: "a", where: "b" }] };

test("feedsFault: lanes and tasks read one of the dashboard's sources, by its columns", () => {
  assert.equal(feedsFault({}, SOURCES, TABLES), "", "neither: nothing to say");
  const lanes = { from: "prs", branch: "branch", words: "PR #{number} {title} · checks {checks}", bad: { checks: "failing" }, good: { checks: "passing" } };
  const tasks = { from: "issues", title: "title", line: "labels", column: "state", doing: ["In Progress"], done: ["Done"] };
  assert.equal(feedsFault({ lanes, tasks }, SOURCES, TABLES), "");
  assert.match(feedsFault({ lanes: [] }, SOURCES, TABLES), /^lanes is no object: \{"from":"prs"/);
  assert.equal(feedsFault({ lanes: { ...lanes, from: "nope" } }, SOURCES, TABLES), 'lanes reads "nope": from names one of its sources (prs, issues, loose)');
  assert.equal(feedsFault({ tasks: { ...tasks, from: undefined } }, {}, {}), "tasks reads nothing: from names one of its sources, and it has none");
  assert.equal(feedsFault({ lanes: { ...lanes, branch: "" } }, SOURCES, TABLES), "lanes has no branch: the column of prs that holds a branch's name");
  assert.equal(feedsFault({ lanes: { ...lanes, branch: "head" } }, SOURCES, TABLES), 'lanes has branch "head", which prs does not have: its columns are number, title, branch, checks');
  assert.match(feedsFault({ lanes: { ...lanes, words: " " } }, SOURCES, TABLES), /^lanes has no words: the line a lane shows, 200 characters at most/);
  assert.match(feedsFault({ lanes: { ...lanes, words: "x".repeat(201) } }, SOURCES, TABLES), /^lanes has no words/);
  assert.equal(feedsFault({ lanes: { ...lanes, words: "PR {nr}" } }, SOURCES, TABLES), 'lanes has in its words "{nr}", which prs does not have: its columns are number, title, branch, checks');
  assert.equal(feedsFault({ lanes: { ...lanes, bad: { checks: ["failing"] } } }, SOURCES, TABLES), 'lanes has bad that is no object of a column and its value: {"checks":"failing"}');
  assert.equal(feedsFault({ lanes: { ...lanes, good: {} } }, SOURCES, TABLES), 'lanes has good that is no object of a column and its value: {"checks":"failing"}');
  assert.equal(feedsFault({ lanes: { ...lanes, bad: { state: "red" } } }, SOURCES, TABLES), 'lanes has bad on "state", which prs does not have: its columns are number, title, branch, checks');
  // Tasks: by the source's fields; a list of values needs the column it reads.
  assert.equal(feedsFault({ tasks: { ...tasks, title: 7 } }, SOURCES, TABLES), "tasks has no title: the column of issues a card is titled by");
  assert.equal(feedsFault({ tasks: { ...tasks, line: "body" } }, SOURCES, TABLES), 'tasks has line "body", which issues does not have: its columns are id, title, labels, state');
  assert.equal(feedsFault({ tasks: { ...tasks, column: "status" } }, SOURCES, TABLES), 'tasks has column "status", which issues does not have: its columns are id, title, labels, state');
  assert.equal(feedsFault({ tasks: { from: "issues", title: "title", doing: ["x"], done: ["y"] } }, SOURCES, TABLES), "tasks has doing and done but no column: the column of issues whose value says where a card stands");
  assert.equal(feedsFault({ tasks: { ...tasks, waits: [] } }, SOURCES, TABLES), "tasks has waits that is no list of the values that put a card in Waits");
  assert.equal(feedsFault({ tasks: { ...tasks, done: [{}] } }, SOURCES, TABLES), "tasks has done that is no list of the values that put a card in Done");
  // (fails before: yes — found by the Hunter on S4c: an empty value matched each row of no state, which Done took off
  // the board unsaid)
  assert.equal(feedsFault({ tasks: { ...tasks, done: ["Done", " "] } }, SOURCES, TABLES), "tasks has done with an empty value: each is a value of state that puts a card in Done");
  assert.equal(feedsFault({ tasks: { ...tasks, doing: [""] } }, SOURCES, TABLES), "tasks has doing with an empty value: each is a value of state that puts a card in Doing");
  // A source that names no columns is checked by its sample rows, and one with neither is not checked.
  assert.equal(feedsFault({ tasks: { from: "loose", title: "name", line: "where" } }, SOURCES, TABLES), "");
  assert.equal(feedsFault({ tasks: { from: "loose", title: "label" } }, SOURCES, TABLES), 'tasks has title "label", which loose does not have: its columns are name, where');
  assert.equal(feedsFault({ tasks: { from: "loose", title: "anything" } }, SOURCES, {}), "", "no columns named, no sample rows: its rows say their own");
});

test("the forms kept: what is not one is none; lists of values as words", () => {
  assert.deepEqual(laneFeedOf({ from: "prs", branch: "branch", words: "{title}", bad: { checks: "failing" }, good: [] }), { from: "prs", branch: "branch", words: "{title}", bad: { checks: "failing" }, good: null });
  assert.equal(laneFeedOf({ from: "prs", branch: "branch" }), null);
  assert.equal(laneFeedOf(null), null);
  assert.deepEqual(taskFeedOf({ from: "issues", title: "title", column: "state", doing: ["In Progress", 2] }), { from: "issues", title: "title", line: null, column: "state", doing: ["In Progress", "2"], waits: [], done: [] });
  assert.equal(taskFeedOf({ from: "issues" }), null);
});

test("feedWords: a row's values for its {column}s, an empty one a dash, a long one cut at 80", () => {
  assert.equal(feedWords("PR #{number} {title} · {checks}", { number: 412, title: "Fix login", checks: null }), "PR #412 Fix login · —");
  assert.equal(feedWords("{t}", { t: "x".repeat(90) }), `${"x".repeat(79)}…`);
  assert.equal(feedWords("no columns", {}), "no columns");
});

test("laneLines: the first row of each branch, red where bad matches and green where good does; a row with no branch is none", () => {
  const f = /** @type {any} */ (laneFeedOf({ from: "prs", branch: "branch", words: "PR #{number} · checks {checks}", bad: { checks: "failing" }, good: { checks: "passing" } }));
  const rows = [
    { number: 412, branch: "fix-login", checks: "failing", [ROW_KEY]: "412" },
    { number: 409, branch: "fix-login", checks: "passing", [ROW_KEY]: "409" },
    { number: 400, branch: " retry ", checks: "passing", [ROW_KEY]: "400" },
    { number: 399, branch: "", checks: "failing" },
    { number: 398, branch: null, checks: "failing" },
    { number: 397, branch: "docs", checks: "pending", [ROW_KEY]: "397" },
  ];
  assert.deepEqual(laneLines(f, rows), [
    { branch: "fix-login", words: "PR #412 · checks failing", tone: "bad", key: "412" },
    { branch: "retry", words: "PR #400 · checks passing", tone: "good", key: "400" },
    { branch: "docs", words: "PR #397 · checks pending", tone: "", key: "397" },
  ]);
  // A value read as a number matches its words; no bad and no good, no tone.
  assert.equal(laneLines(/** @type {any} */ ({ ...f, bad: { checks: 1 } }), [{ branch: "a", checks: "1" }])[0].tone, "bad");
  assert.equal(laneLines(/** @type {any} */ ({ ...f, bad: null, good: null }), [{ branch: "a", checks: "failing" }])[0].tone, "");
});

test("taskCards: a card per titled row, in the column its value names — Planned where none does — 50 at most, and how many more", () => {
  const f = /** @type {any} */ (taskFeedOf({ from: "issues", title: "title", line: "labels", column: "state", doing: ["In Progress"], waits: ["Blocked"], done: ["Done", 3] }));
  const got = taskCards(f, [
    { id: 1, title: " Login loops ", labels: "bug", state: "In Progress", [ROW_KEY]: "1" },
    { id: 2, title: "Retry", labels: null, state: "Blocked", [ROW_KEY]: "2" },
    { id: 3, title: "Docs", labels: "docs", state: 3, [ROW_KEY]: "3" },
    { id: 4, title: "New", labels: "", state: "Todo", [ROW_KEY]: "4" },
    { id: 5, title: "  ", state: "Done" },
    { id: 6, title: null, state: "Done" },
  ]);
  assert.deepEqual([got.more, got.done], [0, 1]);
  assert.deepEqual(got.cards.map((c) => [c.key, c.title, c.line, c.column]), [["1", "Login loops", "bug", "doing"], ["2", "Retry", "", "waits"], ["4", "New", "", "planned"]], "a row its value marks done is no card");
  assert.equal(got.cards[0].row.id, 1, "the row goes with its card: which buttons fit it");
  // No column: each Planned. Past FED_TASKS_MAX: the rest counted.
  const many = Array.from({ length: FED_TASKS_MAX + 7 }, (_, i) => ({ title: `T${i}`, [ROW_KEY]: String(i) }));
  const cut = taskCards(/** @type {any} */ (taskFeedOf({ from: "issues", title: "title" })), many);
  assert.deepEqual([cut.cards.length, cut.more, cut.done, cut.cards.every((c) => c.column === "planned")], [FED_TASKS_MAX, 7, 0, true]);
  assert.equal(taskCards(f, [{ title: "x".repeat(250) }]).cards[0].title.length, 200);
});

// (fails before: yes — closed rows filled "Done this week" and, first in the source's order, took the 50 cards from the
// open ones; a value with a space at its end stood in Planned)
test("taskCards (the Hunter on S4c): done rows are no cards and take none of the most; a value and the lists compare trimmed", () => {
  const f = /** @type {any} */ (taskFeedOf({ from: "issues", title: "title", column: "state", doing: [" In Progress"], done: ["closed"] }));
  const rows = [
    ...Array.from({ length: FED_TASKS_MAX + 10 }, (_, i) => ({ title: `Old ${i}`, state: "closed", [ROW_KEY]: `c${i}` })),
    { title: "Login loops", state: "In Progress ", [ROW_KEY]: "o1" },
    { title: "Retry", state: "open", [ROW_KEY]: "o2" },
    { title: "Shut", state: " closed", [ROW_KEY]: "o3" },
  ];
  const got = taskCards(f, rows);
  assert.deepEqual(got.cards.map((c) => [c.key, c.column]), [["o1", "doing"], ["o2", "planned"]], "the open rows, behind 60 closed ones");
  assert.deepEqual([got.more, got.done], [0, FED_TASKS_MAX + 11]);
});

// (fails before: yes — a source that never read said nothing in the Tasks head, as if it had no rows)
test("the Tasks head: each dashboard's open rows, those past the most too; one that never read says so", () => {
  assert.equal(
    fedCountWords([
      { dashboard: "a", title: "Issues", count: 50, more: 4, done: 12 },
      { dashboard: "b", title: "Bugs", count: 0, more: 0, done: 3 },
      { dashboard: "c", title: "CI", count: 0, more: 0, done: 0, error: "gh exited 4: not logged in" },
    ]),
    "+ 54 from Issues · CI read nothing yet: its tab says why",
  );
  assert.equal(fedCountWords([]), "");
});

// (fails before: yes — the Keep sheet's Shows said only its tab)
test("the Keep sheet's Shows: each feed's words, its red and green, where its cards go; the page's count is core's", () => {
  assert.deepEqual([PAGE_MAX, LANE_FED_SHOWN], [FED_TASKS_MAX, LANE_LINES_MAX]);
  assert.deepEqual(feedShows(null, undefined), []);
  assert.deepEqual(feedShows({ from: "prs", branch: "branch", words: "PR #{number} {title}", bad: { checks: "failing" }, good: { checks: "passing" } }, { from: "issues", title: "title", line: "labels", column: "state", doing: ["In Progress"], waits: [], done: ["Done", "Closed"] }), [
    { words: "A line on the lane of each branch a row of prs names (its branch): “PR #{number} {title}”", more: "its first row for the branch · red where checks is failing · green where checks is passing" },
    { words: "A card on the board for each row of issues, titled by its title", more: `its labels under it · Doing where state is In Progress · Done where state is Done or Closed · Planned otherwise · ${FED_TASKS_MAX} at most · they are its, not the board's: they go when it does` },
  ]);
  assert.deepEqual(feedShows({ from: "prs", branch: "branch", words: "{title}" }, { from: "issues", title: "title" }).map((x) => x.more), [
    "its first row for the branch",
    `each in Planned · ${FED_TASKS_MAX} at most · they are its, not the board's: they go when it does`,
  ], "no tone, no column");
  assert.deepEqual(feedShows({ from: "prs", branch: "branch" }, { from: "issues" }), [], "what is not a feed says none");
});
