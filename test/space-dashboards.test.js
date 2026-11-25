// @ts-check
// HarnessV4_Space_Plan S2: a Space's dashboards that read by themselves, with no AI. What a dashboard reads and watches,
// checked in words that name the part (core/dashboard-sources.js, artifact-content.js); the grant a Keep promises; a
// command's output read into rows; a watch's news, its first look only learning. The Space's record of them
// (services/spaces.js); the runner over a stand-in for the command (services/dashboard-runner.js) — drafts shown,
// Keep, a source read at its every, a failure keeping its rows and stopping after three, a version that changes only
// tiles live at once and one that changes a command a draft again, Pause, Remove and its way back, the watches across a
// restart —; a real command run; the dashboard's address answering its kept sources alone (http/artifacts.js); the
// admin routes the page writes through; the Space's words of them (ui/harness/lib/space-dashboards.js); and the page's
// own words for a status tile. S3a: a dashboard's buttons — checked, in the grant, filled from the row Filament read, its
// sheet, its run (one at a time, Stop), its command run with no clock, its routes.
// (fails before: yes — a dashboard drew only the tables the agent wrote and Filament's numbers; nothing ran by itself)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  EVERY_MIN_MS,
  FAILS_TO_STOP,
  ROW_KEY,
  actionKept,
  actionOnRow,
  argvWords,
  everyMs,
  everyWords,
  fillAction,
  filled,
  grantOf,
  rowsFrom,
  sameGrant,
  sourceKept,
  sourcesOf,
  watchKept,
  watchNews,
} from "../src/core/dashboard-sources.js";
import { dashboardOf } from "../src/core/artifact-content.js";
import { checkWords } from "../src/core/second-look.js";
import { momentOf as coreMomentOf } from "../src/core/space-feeds.js";
import { TYPE_MODULES, joinModules } from "../src/core/artifacts.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { runActionCommand, runCommand } from "../src/adapters/tools/source-command.js";
import { createArtifactsHandler } from "../src/http/artifacts.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createRouter } from "../src/http/router.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { backOf, barOf, commandWords, faultsOf, footOf, keepLines, pressWords, readsNow, ruleWords, tabOf } from "../src/ui/harness/lib/space-dashboards.js";
import { changeWords, fixWords } from "../src/ui/harness/space/dashboards.js";
import { agoWords as ysAgoWords, asOfWords as ysAsOfWords } from "../src/ui/harness/lib/your-space.js";
import { until } from "./helpers/wait.js";

const MIN = 60_000;
const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = (/** @type {string} */ tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-sd-${tag}-`));
  dirs.push(d);
  return d;
};

/** The Designer's Deploys, as an agent publishes it: two sources, a status tile each, a watch on CI. */
const DEPLOYS = {
  tiles: [
    { kind: "status", title: "Live now", from: "deploys", field: "version", words: "{message}", age: "when" },
    { kind: "number", title: "Deploys", from: "deploys", of: "count" },
    { kind: "status", title: "CI on main", from: "runs", field: "status", bad: { status: "failure" }, good: { status: "success" } },
    { kind: "table", title: "Recent deploys", from: "deploys", columns: ["when", "version", "message"] },
  ],
  tables: { deploys: [{ when: "2026-10-24T12:00:00Z", version: "7c1e", message: "Fix login" }], runs: [{ run: 8812, status: "failure" }] },
  sources: {
    deploys: {
      command: ["npx", "wrangler", "deployments", "list", "--json"],
      key: "id",
      order: "-when",
      every: "2m",
      columns: { when: "created_on", version: "versions.0.version_id", message: "annotations.workers/message" },
    },
    runs: { command: ["gh", "run", "list", "--json", "databaseId,conclusion"], key: "databaseId", columns: { run: "databaseId", status: "conclusion" } },
  },
  watch: [{ from: "runs", new: true, match: { status: "failure" }, says: "CI failed on main: run {row.run}", every: "10m" }],
};
/** What wrangler says. */
const WRANGLER = JSON.stringify([
  { id: "a", created_on: "2026-10-23T10:00:00Z", versions: [{ version_id: "3f2a" }], annotations: { "workers/message": "Add retry" } },
  { id: "b", created_on: "2026-10-24T12:00:00Z", versions: [{ version_id: "7c1e" }], annotations: {} },
]);
/** @param {{ id: number, c: string }[]} runs */
const ghRuns = (runs) => JSON.stringify(runs.map((r) => ({ databaseId: r.id, conclusion: r.c })));

describe("what a dashboard reads and watches, checked", () => {
  // (fails before: yes — a dashboard had no sources)
  test("how often, in words: 90s, 2m, 1h; a minute at least", () => {
    assert.deepEqual(["90s", "2m", "2 m", "1h", "2d", "5", null].map(everyMs), [90_000, 120_000, 120_000, 3_600_000, null, null, null]);
    assert.deepEqual([everyWords(120_000), everyWords(3_600_000), everyWords(90_000)], ["2 min", "1 h", "90 s"]);
    assert.equal(EVERY_MIN_MS, MIN);
  });

  // (fails before: yes — the same)
  test("each wrong part refused in words that name it", () => {
    /** @param {any} input */
    const no = (input) => {
      const r = sourcesOf(input);
      return r.ok ? "" : r.error;
    };
    const d = (/** @type {any} */ s) => ({ sources: { d: { command: ["x"], ...s } } });
    assert.equal(no({ sources: { d: { command: [] } } }), 'the source d has no command: a list of the program and its arguments, ["gh","pr","list","--json","number,title"] — no shell runs it — or a tool of a connection, a fetch, a folder, filament or python');
    assert.equal(no({ sources: { d: { command: ["x", 3] } } }), "the source d has a command whose part 2 is no line of text (1000 characters at most)");
    assert.equal(no({ sources: { d: { command: ["x\ny"] } } }), "the source d has a command whose part 1 is no line of text (1000 characters at most)");
    assert.equal(no(d({ every: "30s" })), "the source d reads every 30 s: a minute at least");
    assert.equal(no(d({ every: "often" })), 'the source d has every "often": give it as "90s", "2m" or "1h"');
    assert.equal(no({ sources: { d: { tool: "list_runs" } } }), 'the source d has a tool that is no object: {"connection":"github","name":"list_workflow_runs","args":{"owner":"o","repo":"app"}}', "a connection's tool is S4a's (space-tools.test.js)");
    assert.equal(no(d({ columns: { a: "x.y" }, order: "-b" })), "the source d is ordered by b, which is none of its columns (a)");
    assert.equal(no(d({ fields: ["a"], columns: { a: "x" } })), "the source d has fields — tab-separated lines — and columns or rows, which read JSON: give one or the other");
    // (fails before: yes — found by the Hunter on S3a: a line's key was read as a path no line has)
    assert.equal(no(d({ fields: ["a", "b"], key: "c" })), "the source d is keyed by c, which is none of its fields (a, b): a line's key is one of its fields");
    assert.equal(no({ sources: { "a b": { command: ["x"] } } }), 'the source "a b" needs a name of letters, digits, - and _ (40 at most)');
    const w = (/** @type {any} */ x) => ({ ...d({ columns: { a: "p" } }), watch: [{ from: "d", new: true, says: "s", ...x }] });
    assert.equal(no(w({ new: false })), 'watch 1 has no rule, or two: give "new": true (rows not seen before) or "changes": a column of its first row');
    assert.equal(no(w({ changes: "a" })), 'watch 1 has no rule, or two: give "new": true (rows not seen before) or "changes": a column of its first row');
    assert.equal(no(w({ from: "nope" })), "watch 1 reads nope: it watches one of the sources (d)");
    assert.equal(no(w({ match: { zz: 1 } })), "watch 1 matches zz, which d does not have (a)");
    assert.equal(no(w({ every: "30s" })), "watch 1 looks every 30 s: a minute at least");
    assert.equal(no(w({ says: "" })), 'watch 1 has no says: the line it writes, 200 characters at most, with {row.<column>} for a value ("CI failed on main: run {row.run}")');
    // S5a: Needs you's own list is here, so a watch may write a row in it.
    assert.equal(no(w({ to: "inbox" })), 'watch 1 goes to "inbox": a watch writes in what-happened, or a row in needs-you');
    assert.equal(no(w({ to: "needs-you" })), "");
    assert.equal(no({ watch: [{ from: "d", new: true, says: "s" }] }), "watch 1 reads d: it watches one of the sources, and there are none");
    // Two watches of one source, rule and match would share what they saw: one would never write.
    // (fails before: yes — found by the Hunter on S2: the second watch of the same identity never ran)
    const two = (/** @type {any} */ x) => ({ ...d({ columns: { a: "p" } }), watch: [{ from: "d", new: true, says: "s", to: "needs-you" }, { from: "d", new: true, says: "t", ...x }] });
    assert.equal(no(two({})), "watch 2 is watch 1 again — the same source, rule and match —: make them one watch, or tell them apart by match");
    assert.equal(no(two({ match: { a: 1 } })), "", "told apart by match");
    assert.equal(no(two({ new: undefined, changes: "a" })), "", "another rule");
  });

  // (fails before: yes — the same)
  test("a dashboard with sources: kept as given; its tiles read a source's columns and its sample rows; a status tile checked", () => {
    const d = dashboardOf(DEPLOYS);
    assert.equal(d.ok, true);
    assert.deepEqual(d.ok && d.content, { tiles: DEPLOYS.tiles, tables: DEPLOYS.tables, sources: DEPLOYS.sources, watch: DEPLOYS.watch });
    /** @param {any} tile @param {any} [more] */
    const tile = (tile, more = {}) => {
      const r = dashboardOf({ ...DEPLOYS, tiles: [tile], ...more });
      return r.ok ? "" : r.error;
    };
    assert.equal(tile({ kind: "status", title: "S", from: "deploys", field: "nope" }), 'tile 1 (S) shows the field "nope", which deploys does not have: its columns are when, version, message');
    assert.match(tile({ kind: "status", title: "S", from: "deploys", field: "version", row: "middle" }), /^tile 1 \(S\) reads the row "middle": give first or last$/);
    assert.equal(tile({ kind: "status", title: "S", from: "deploys", field: "version", bad: "red" }), 'tile 1 (S) has bad that is no object of a column and its value: {"status":"failure"}');
    assert.equal(tile({ kind: "status", title: "S", from: "deploys", field: "version", good: { when: 1, nope: 2 } }), 'tile 1 (S) has good on "nope", which deploys does not have: its columns are when, version, message');
    assert.equal(tile({ kind: "status", title: "S", from: "deploys", field: "version", age: "at" }), 'tile 1 (S) takes its age from "at", which deploys does not have: its columns are when, version, message');
    assert.equal(tile({ kind: "status", title: "S", from: "deploys" }), "tile 1 (S) has no field: the column of deploys whose value it shows (when, version, message)");
    assert.equal(tile({ kind: "number", title: "N", from: "deploys", field: "version" }, { tables: {} }), "", "a source with no sample rows reads none, and its columns are its own");
    assert.match(tile({ kind: "number", title: "N", from: "weeks", field: "n" }), /^tile 1 \(N\) reads weeks, which is none of its sources \(deploys, runs\), Filament's numbers/);
    const named = dashboardOf({ ...DEPLOYS, sources: { "calls-now": { command: ["x"] } }, watch: undefined });
    assert.deepEqual(named, { ok: false, error: "the source calls-now has the name of one of Filament's numbers: name it otherwise" });
  });

  // (fails before: yes — nothing granted a dashboard anything)
  test("the grant a Keep promises: each command and how often, each watch's rule; tiles, words and paths are not in it", () => {
    const g = grantOf(DEPLOYS);
    assert.deepEqual(g, {
      sources: { deploys: { command: ["npx", "wrangler", "deployments", "list", "--json"], every: 2 * MIN }, runs: { command: ["gh", "run", "list", "--json", "databaseId,conclusion"], every: 2 * MIN } },
      watch: [{ from: "runs", rule: "new", column: "", match: { status: "failure" }, to: "what-happened", every: 10 * MIN }],
      actions: {},
    });
    const words ={ ...DEPLOYS, tiles: DEPLOYS.tiles.slice(1), sources: { ...DEPLOYS.sources, deploys: { ...DEPLOYS.sources.deploys, columns: { when: "x" } } }, watch: [{ ...DEPLOYS.watch[0], says: "other words" }] };
    assert.equal(sameGrant(grantOf(words), g), true, "tiles, paths and a watch's words change nothing it may do");
    assert.equal(sameGrant(grantOf({ ...DEPLOYS, sources: { ...DEPLOYS.sources, runs: { ...DEPLOYS.sources.runs, every: "5m" } } }), g), false);
    assert.equal(sameGrant(grantOf({ ...DEPLOYS, sources: { ...DEPLOYS.sources, runs: { ...DEPLOYS.sources.runs, command: ["gh", "run", "rerun"] } } }), g), false);
    assert.equal(sameGrant(grantOf({ ...DEPLOYS, watch: [] }), g), false);
    assert.equal(sameGrant(null, g), false);
  });

  // (fails before: yes — nothing read a command's output)
  test("a command's output into rows: its list, each column at its path, named by its key, in its order; tab-separated lines; or why not", () => {
    const s = sourceKept(DEPLOYS.sources.deploys);
    assert.deepEqual(rowsFrom(WRANGLER, s), {
      ok: true,
      rows: [
        { when: "2026-10-24T12:00:00Z", version: "7c1e", message: null, [ROW_KEY]: "b" },
        { when: "2026-10-23T10:00:00Z", version: "3f2a", message: "Add retry", [ROW_KEY]: "a" },
      ],
    });
    assert.deepEqual(rowsFrom(JSON.stringify({ result: [{ n: 2, o: { a: 1 } }, { n: 10 }] }), sourceKept({ command: ["x"], rows: "result", order: "-n" })), {
      ok: true,
      rows: [{ n: 10 }, { n: 2, o: '{"a":1}' }],
    }, "its own fields where it names no columns; a number ordered as a number; an object as JSON");
    assert.deepEqual(rowsFrom("1\tok\n\n2\tfail\n", sourceKept({ command: ["x"], fields: ["n", "s", "t"] })), { ok: true, rows: [{ n: "1", s: "ok", t: null }, { n: "2", s: "fail", t: null }] });
    // Keyed by one of its fields: a button and a watch name a line's row by it, as a JSON row's.
    // (fails before: yes — found by the Hunter on S3a: a tab-separated row had no key, so every button on it stayed off)
    assert.deepEqual(/** @type {any} */ (rowsFrom("main\tabc\nfeat/x\tdef\n", sourceKept({ command: ["git"], fields: ["name", "head"], key: "name" }))).rows, [
      { name: "main", head: "abc", [ROW_KEY]: "main" },
      { name: "feat/x", head: "def", [ROW_KEY]: "feat/x" },
    ]);
    assert.deepEqual(rowsFrom("You are not signed in", s), { ok: false, error: "it said words, not JSON: “You are not signed in”" });
    assert.deepEqual(rowsFrom("  ", s), { ok: false, error: "it said nothing" });
    assert.deepEqual(rowsFrom('{"a":1}', sourceKept({ command: ["x"] })), { ok: false, error: "it said no list: name where the list is by rows" });
    assert.deepEqual(rowsFrom('{"a":1}', sourceKept({ command: ["x"], rows: "a" })), { ok: false, error: "its rows (a) are no list" });
    const many = /** @type {any} */ (rowsFrom(JSON.stringify(Array.from({ length: 600 }, (_, i) => i)), sourceKept({ command: ["x"] })));
    assert.deepEqual([many.rows.length, many.rows[0]], [500, { value: 0 }], "500 rows at most; an item that is no object, its value");
  });

  // (fails before: yes — nothing watched)
  test("a watch's news: its first look only learns; then a line a new matching row, five at most and how many more; a first row's column moved", () => {
    const w = watchKept(DEPLOYS.watch[0]);
    const row = (/** @type {number} */ run, /** @type {string} */ status) => ({ run, status, [ROW_KEY]: String(run) });
    const first = watchNews(null, [row(1, "failure"), row(2, "success")], w, 5);
    assert.deepEqual(first, { lines: [], seen: { keys: ["1", "2"], at: 5 }, more: 0 });
    const next = watchNews(first.seen, [row(3, "failure"), row(4, "success"), row(1, "failure"), row(2, "success")], w, 6);
    assert.deepEqual(next, { lines: ["CI failed on main: run 3"], seen: { keys: ["3", "4", "1", "2"], at: 6 }, more: 0 });
    const many = watchNews(next.seen, [10, 11, 12, 13, 14, 15, 16].map((n) => row(n, "failure")), w, 7);
    assert.deepEqual(many.lines, ["CI failed on main: run 10", "CI failed on main: run 11", "CI failed on main: run 12", "CI failed on main: run 13", "CI failed on main: run 14", "… and 2 more like it"]);
    // S5a: how many past its lines, for a row in Needs you to say.
    assert.equal(many.more, 2);
    const c = watchKept({ from: "deploys", changes: "version", says: "Production is now {row.version}: {row.message}" });
    const v1 = watchNews(null, [{ version: "7c1e", message: "Fix" }], c, 1);
    assert.deepEqual(v1.lines, []);
    assert.deepEqual(watchNews(v1.seen, [{ version: "7c1e", message: "Fix" }], c, 2).lines, []);
    assert.deepEqual(watchNews(v1.seen, [{ version: "9b04", message: "Ship" }], c, 3).lines, ["Production is now 9b04: Ship"]);
    assert.equal(filled("{row.nope} {row.key} {row.long}", { [ROW_KEY]: "k", long: "x".repeat(100) }), `— k ${"x".repeat(79)}…`);
  });
});

describe("the Space keeps its dashboards", () => {
  const grant = grantOf(DEPLOYS);
  // (fails before: yes — a Space kept no dashboard)
  test("kept, paused, resumed, taken out; each said in What happened; a watch's lines under the dashboard's name", () => {
    const store = createSpaceStore({ dir: null, now: () => 1000 });
    const d = store.keepDashboard("p1", { name: "deploys-ab12", v: 1, grant, title: "Deploys" });
    assert.deepEqual(d, { name: "deploys-ab12", state: "kept", v: 1, grant, scripts: {}, at: 1000, paused: false, seen: {} });
    assert.throws(() => store.keepDashboard("p2", { name: "deploys-ab12", v: 1, grant, title: "Deploys" }), { status: 409, message: "Deploys is kept in another project's Space; take it out there first." });
    store.dashboardChange("p1", "deploys-ab12", { paused: true, title: "Deploys" });
    store.dashboardChange("p1", "deploys-ab12", { paused: true, title: "Deploys" });
    store.dashboardChange("p1", "deploys-ab12", { paused: false, title: "Deploys" });
    store.watchSaw("p1", "deploys-ab12", "k", { keys: ["1"], at: 5 }, ["CI failed on main: run 1", "CI failed on main: run 2"], "Deploys");
    // Kept again, its watch keeps what it saw where the watch is the same.
    store.keepDashboard("p1", { name: "deploys-ab12", v: 2, grant, title: "Deploys" });
    assert.deepEqual(store.get("p1").dashboards[0].seen, {}, "a key the grant does not name is let go");
    store.dashboardChange("p1", "deploys-ab12", { removed: true, title: "Deploys", v: 3 });
    const keptAs = { v: 2, grant, scripts: {}, at: 1000, paused: false, seen: {} };
    assert.deepEqual(store.get("p1").dashboards, [{ name: "deploys-ab12", state: "removed", v: 3, grant: null, at: 1000, paused: false, seen: {}, was: keptAs }]);
    assert.deepEqual(store.keptDashboards(), []);
    assert.throws(() => store.dashboardChange("p1", "deploys-ab12", { paused: true, title: "Deploys" }), { status: 409, message: "Deploys is not kept in this Space: keep it first." });
    store.watchSaw("p1", "deploys-ab12", "k", { at: 9 }, ["late"], "Deploys");
    assert.deepEqual(store.get("p1").log.map((e) => [e.by, e.text]), [
      [{ kind: "filament" }, "You kept “Deploys” in this Space: it runs 2 commands and 1 watch by itself."],
      [{ kind: "filament" }, "You paused “Deploys”: nothing of it runs until you resume it."],
      [{ kind: "filament" }, "You resumed “Deploys”."],
      [{ kind: "filament", name: "Deploys" }, "CI failed on main: run 1"],
      [{ kind: "filament", name: "Deploys" }, "CI failed on main: run 2"],
      [{ kind: "filament" }, "You kept “Deploys” in this Space: it runs 2 commands and 1 watch by itself."],
      [{ kind: "filament" }, "You took “Deploys” out of this Space: nothing of it runs."],
    ], "nothing written once it is out");
    assert.equal(new Set(store.get("p1").log.map((e) => e.id)).size, 7, "each line its own id");
    // Its way back: put back as it was kept — the version, the grant, nothing more — and said; refused where it is not out.
    assert.deepEqual(store.dashboardBack("p1", "deploys-ab12", "Deploys"), { name: "deploys-ab12", state: "kept", ...keptAs });
    assert.equal(store.get("p1").log.at(-1)?.text, "You put “Deploys” back in this Space: it runs 2 commands and 1 watch by itself.");
    assert.throws(() => store.dashboardBack("p1", "deploys-ab12", "Deploys"), { status: 409, message: "Deploys is not taken out of this Space." });
    // Paused when it went, paused when it comes back; out again, what it was kept as stays with it.
    store.dashboardChange("p1", "deploys-ab12", { paused: true, title: "Deploys" });
    store.dashboardChange("p1", "deploys-ab12", { removed: true, title: "Deploys", v: 3 });
    store.dashboardChange("p1", "deploys-ab12", { removed: true, title: "Deploys", v: 3 });
    assert.deepEqual(store.get("p1").dashboards[0].was, { ...keptAs, paused: true });
    store.keepDashboard("p2", { name: "deploys-ab12", v: 3, grant, title: "Deploys" });
    assert.throws(() => store.dashboardBack("p1", "deploys-ab12", "Deploys"), { status: 409, message: "Deploys is kept in another project's Space; take it out there first." });
    store.dashboardChange("p2", "deploys-ab12", { removed: true, title: "Deploys", v: 3 });
    assert.equal(store.dashboardBack("p1", "deploys-ab12", "Deploys")?.paused, true);
    assert.equal(store.get("p1").log.at(-1)?.text, "You put “Deploys” back in this Space, paused as it was.");
    // A draft taken out comes back a draft: nothing kept of it.
    store.dashboardChange("p1", "notes-x", { removed: true, title: "Notes", v: 1 });
    assert.equal(store.dashboardBack("p1", "notes-x", "Notes"), null);
    assert.deepEqual(store.get("p1").dashboards.map((d) => d.name), ["deploys-ab12"]);
  });

  // (fails before: yes — the same)
  test("read back from its file as it was; a kept one with no grant is dropped", () => {
    const dir = fresh("store");
    const store = createSpaceStore({ dir, now: () => 1000 });
    store.keepDashboard("p1", { name: "deploys-ab12", v: 1, grant, title: "Deploys" });
    assert.deepEqual(createSpaceStore({ dir, now: () => 1000 }).get("p1").dashboards, store.get("p1").dashboards);
    const file = join(dir, "p1.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.dashboards.push({ name: "broken-x1", state: "kept", v: 1, grant: null, at: 1, paused: false, seen: {} });
    doc.dashboards.push({ name: "out-x2", state: "removed", v: 2, grant: null, at: 1, paused: false, seen: {}, was: { v: 1, grant, at: 1, paused: true, seen: { k: { at: 1 } } } });
    doc.dashboards.push({ name: "out-x3", state: "removed", v: 2, grant: null, at: 1, paused: false, seen: {}, was: { v: 1, grant: null } });
    writeFileSync(file, JSON.stringify(doc));
    const back = createSpaceStore({ dir, now: () => 1000 }).get("p1").dashboards;
    assert.deepEqual(back.map((d) => [d.name, d.was === undefined ? "-" : d.was?.v ?? null]), [["deploys-ab12", "-"], ["out-x2", 1], ["out-x3", null]], "what it was kept as, read back where it reads");
    assert.deepEqual(back[1].was, { v: 1, grant, at: 1, paused: true, seen: { k: { at: 1 } } });
  });
});

/**
 * A world for the runner: an artifact store, a Space store, a clock, and stand-ins for the commands — each program's
 * answer by its name, every run counted; a button's command held until it is stopped, where `hold.on`.
 */
function worldOf() {
  const clock = { at: Date.UTC(2026, 9, 24, 14, 0) };
  const now = () => clock.at;
  const artifacts = createArtifactStore({ dataDir: fresh("art"), log: () => {}, now, four: (() => { const f = ["ab12", "cd34", "ef56"]; return () => f.shift() || "zzzz"; })() });
  /** @type {any[]} */
  const heard = [];
  const spaces = createSpaceStore({ dir: null, now, events: { publish: (t, p) => heard.push([t, p]) } });
  /** @type {[string, string][]} */
  const ran = [];
  /** @type {Record<string, import("../src/core/dashboard-sources.js").CommandOut>} */
  const answers = { npx: { ok: true, out: WRANGLER }, gh: { ok: true, out: ghRuns([{ id: 1, c: "failure" }, { id: 2, c: "success" }]) } };
  /** @type {import("../src/core/dashboard-sources.js").RunCommand} */
  const run = async (argv, cwd) => {
    ran.push([argv.join(" "), cwd]);
    return answers[argv[0]] || { ok: false, error: `${argv[0]} was not found on this computer` };
  };
  /** @type {[string[], string][]} */
  const acted = [];
  /** How a button's command ends, by its program. @type {Record<string, import("../src/core/dashboard-sources.js").ActionOut>} */
  const ends = { npx: { ok: true, said: "Rolling back…\nRolled back to 3f2a\n" } };
  /** `on`: a button's command runs until it is stopped. */
  const hold = { on: false };
  /** @type {import("../src/core/dashboard-sources.js").RunAction} */
  const act = async (argv, cwd, signal) => {
    acted.push([argv, cwd]);
    if (hold.on) {
      await new Promise((done) => signal?.addEventListener("abort", done, { once: true }));
      return { ok: false, error: "you stopped it", said: "Rolling back…\n" };
    }
    return ends[argv[0]] || { ok: false, error: `${argv[0]} was not found on this computer`, said: "" };
  };
  const deps = {
    spaces,
    artifacts,
    folderOf: (/** @type {string} */ p) => (p === "p1" ? "/work/app" : p === "p2" ? "/work/other" : null),
    projectOfChain: (/** @type {string} */ c) => (c.startsWith("c") ? "p1" : c.startsWith("o") ? "p2" : null),
    events: { publish: (/** @type {string} */ t, /** @type {any} */ p) => void heard.push([t, p]) },
    now,
    run,
    act,
  };
  const runner = createDashboardRunner(deps);
  /** A version published by a chat. @param {any} input @param {string} [chain] */
  const publish = (input, chain = "c1") => {
    const r = artifactCall({ action: "publish", ...input }, { who: chain, by: { chain, model: "m-1", folder: "/work/app", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 }, artifacts);
    assert.ok(r.ok, r.ok ? "" : r.error);
  };
  return { clock, artifacts, spaces, heard, ran, answers, acted, ends, hold, runner, deps, publish };
}

describe("the runner: drafts, Keep, reads and watches", () => {
  // (fails before: yes — nothing ran a dashboard's command)
  test("a project's chat publishes one: a draft in its Space, reading nothing; kept, its sources read in its folder at their every", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    w.publish({ type: "dashboard", title: "Plain", tiles: [{ kind: "number", title: "N", value: 1 }] });
    w.publish({ type: "dashboard", title: "Theirs", ...DEPLOYS }, "o1");
    const name = "deploys-ab12";
    const [draft] = w.runner.shown("p1");
    assert.equal(w.runner.shown("p1").length, 1, "one that reads nothing by itself is no draft of a Space; another project's is its own");
    assert.deepEqual(
      { ...draft, updatedAt: 0 },
      { name, title: "Deploys", type: "dashboard", v: 1, state: "draft", keptV: null, liveV: null, from: null, liveFrom: null, draft: true, paused: false, pausedBy: null, running: null, keptAt: null, grant: null, newest: grantOf(DEPLOYS),
        reads: { sources: DEPLOYS.sources, watch: DEPLOYS.watch, actions: {}, lanes: null, tasks: null }, fed: null, looks: [null], sources: {}, updatedAt: 0, glance: false, statuses: 0, allowed: [], changed: [] },
    );
    assert.deepEqual(w.runner.shown("p2").map((d) => d.title), ["Theirs"]);
    assert.deepEqual(await w.runner.read(name, 1, "deploys"), { ok: false, error: "it is not kept in a Space: nothing reads until it is" });
    assert.deepEqual(w.ran, [], "a draft runs nothing");
    assert.deepEqual(w.runner.keep("p1", name, 2), { ok: false, status: 409, error: "Deploys has a newer version (v1) than the one you looked at: look at it, then keep it." });
    assert.deepEqual(w.runner.keep("p1", "plain-cd34", 1), { ok: false, status: 400, error: "Plain reads nothing by itself: there is nothing to keep." });
    assert.deepEqual(w.runner.keep("p1", "nope-zz99", 1), { ok: false, status: 404, error: "There is no dashboard or app nope-zz99." });
    const kept = w.runner.keep("p1", name, 1);
    assert.equal(kept.ok, true);
    assert.deepEqual(w.ran, [], "a Keep runs nothing yet");
    const [shown] = w.runner.shown("p1");
    assert.deepEqual([shown.state, shown.draft, shown.keptV, shown.liveV, shown.grant, shown.sources], ["kept", false, 1, 1, grantOf(DEPLOYS), { deploys: null, runs: null }]);
    const read = await w.runner.read(name, 1, "deploys");
    const rows = /** @type {any} */ (rowsFrom(WRANGLER, sourceKept(DEPLOYS.sources.deploys))).rows;
    assert.deepEqual(read, { ok: true, state: { rows, at: w.clock.at, error: null, errorAt: 0, fails: 0, stopped: false } });
    assert.deepEqual(w.ran, [["npx wrangler deployments list --json", "/work/app"]], "its exact command, in its project's folder");
    assert.deepEqual(w.heard.filter(([t]) => t === "space").at(-1), ["space", { type: "space", project: "p1", dashboard: name }], "said on the bus");
    // Younger than its every: as last read. Older: read again.
    await w.runner.read(name, 1, "deploys");
    w.clock.at += MIN;
    await w.runner.read(name, 1, "deploys");
    assert.equal(w.ran.length, 1);
    w.clock.at += MIN;
    await w.runner.read(name, 1, "deploys");
    assert.equal(w.ran.length, 2);
    // Two asks at once share one run.
    w.clock.at += 3 * MIN;
    await Promise.all([w.runner.read(name, 1, "deploys"), w.runner.read(name, 1, "deploys")]);
    assert.equal(w.ran.length, 3);
    assert.deepEqual(await w.runner.read(name, 1, "nope"), { ok: false, error: "v1 has no source nope" });
    const [after] = w.runner.shown("p1");
    assert.deepEqual(after.sources, { deploys: { at: w.clock.at, error: null, errorAt: 0, fails: 0, stopped: false, rows: 2 }, runs: null });
  });

  // HarnessV4_Space_Plan S4c: what a kept dashboard feeds into its Space — lines on lanes, cards on the board — from the
  // rows Filament read itself; a draft and a paused one feed nothing; a failed read keeps its lines, stale.
  // (fails before: yes — a dashboard fed nothing into its Space)
  test("a kept one's rows feed its Space: a line on each lane a row's branch names, a card per row with the buttons that fit it", async () => {
    const w = worldOf();
    const PRS = {
      tiles: [{ kind: "table", title: "Open PRs", from: "prs", columns: ["number", "title", "branch", "checks"], actions: ["close"] }],
      tables: { prs: [{ number: 1, title: "x", branch: "b", checks: "passing" }] },
      sources: { prs: { command: ["gh", "pr", "list", "--json", "number,title,headRefName,checks"], key: "number", every: "2m", columns: { number: "number", title: "title", branch: "headRefName", checks: "checks" } } },
      lanes: { from: "prs", branch: "branch", words: "PR #{number} · checks {checks}", bad: { checks: "failing" }, good: { checks: "passing" } },
      tasks: { from: "prs", title: "title", column: "checks", doing: ["pending"], done: ["passing"] },
      actions: { close: { label: "Close it…", on: "prs", only: { checks: "failing" }, command: ["gh", "pr", "close", "{row.number}"], check: { "row.number": "^[0-9]+$" }, says: "Close PR #{row.number}?" } },
    };
    assert.equal(dashboardOf(PRS).ok, true);
    // Refused at the publish where it reads what it has not.
    const bad = dashboardOf({ ...PRS, lanes: { ...PRS.lanes, branch: "head" } });
    assert.deepEqual(bad, { ok: false, error: 'lanes has branch "head", which prs does not have: its columns are number, title, branch, checks' });
    assert.deepEqual(dashboardOf({ ...PRS, tasks: { ...PRS.tasks, from: "issues" } }), { ok: false, error: 'tasks reads "issues": from names one of its sources (prs)' });
    w.answers.gh = { ok: true, out: JSON.stringify([
      { number: 412, title: "Fix login", headRefName: "fix-login", checks: "failing" },
      { number: 409, title: "Retry", headRefName: "retry", checks: "pending" },
      { number: 400, title: "Docs", headRefName: "docs", checks: "passing" },
    ]) };
    w.publish({ type: "dashboard", title: "PRs", ...PRS });
    const name = "prs-ab12";
    assert.deepEqual(w.runner.feeds("p1"), { lanes: [], tasks: [], counts: [] }, "a draft feeds nothing");
    assert.deepEqual(w.ran, [], "and reads nothing for it");
    w.runner.keep("p1", name, 1);
    assert.deepEqual(w.runner.feeds("p1"), { lanes: [], tasks: [], counts: [] }, "kept, not read yet: nothing, and a read asked for");
    await until(() => w.runner.feeds("p1").lanes.length > 0, "its lines");
    const at = w.clock.at;
    const fed = w.runner.feeds("p1");
    assert.deepEqual(fed.lanes, [
      { dashboard: name, title: "PRs", branch: "fix-login", words: "PR #412 · checks failing", tone: "bad", at, stale: false },
      { dashboard: name, title: "PRs", branch: "retry", words: "PR #409 · checks pending", tone: "", at, stale: false },
      { dashboard: name, title: "PRs", branch: "docs", words: "PR #400 · checks passing", tone: "good", at, stale: false },
    ]);
    assert.deepEqual(fed.tasks.map((t) => [t.source, t.key, t.task, t.column, t.presses]), [
      ["prs", "412", "Fix login", "planned", [{ name: "close", label: "Close it…" }]],
      ["prs", "409", "Retry", "doing", []],
    ], "a card's buttons are those whose rows it is; a row its value marks done is none");
    assert.deepEqual(fed.counts, [{ dashboard: name, title: "PRs", count: 2, more: 0, done: 1 }]);
    assert.equal(w.ran.length, 1, "read once, as its every says");
    // A failed read after its every: what it read last stands, stale — its cards with no button (the Hunter on S4c:
    // pressed, the button was refused "Read it again first").
    w.answers.gh = { ok: false, error: "gh exited 4: not logged in" };
    w.clock.at += 3 * MIN;
    w.runner.feeds("p1");
    await until(() => w.runner.feeds("p1").lanes[0]?.stale === true, "stale");
    assert.deepEqual(w.runner.feeds("p1").lanes.map((l) => [l.branch, l.at, l.stale]), [["fix-login", at, true], ["retry", at, true], ["docs", at, true]]);
    assert.deepEqual(w.runner.feeds("p1").tasks.map((t) => [t.key, t.stale, t.presses]), [["412", true, []], ["409", true, []]]);
    // Paused: nothing.
    w.runner.change("p1", name, { paused: true });
    assert.deepEqual(w.runner.feeds("p1"), { lanes: [], tasks: [], counts: [] }, "a paused one feeds nothing");
    assert.deepEqual(w.runner.feeds("p2"), { lanes: [], tasks: [], counts: [] }, "another project's Space: none of it");
    // Its Keep sheet says what it feeds; What it may do says the version that reads.
    w.runner.change("p1", name, { paused: false });
    const [shown] = w.runner.shown("p1");
    assert.deepEqual([shown.reads.lanes, shown.fed?.tasks], [PRS.lanes, PRS.tasks]);
    assert.deepEqual(keepLines(shown, "/work/app").shows.map((s) => s.words), [
      "A line on the lane of each branch a row of prs names (its branch): “PR #{number} · checks {checks}”",
      "A card on the board for each row of prs, titled by its title",
    ]);
  });

  // (fails before: yes — a task source that never read put nothing on the board and said nothing: the Hunter on S4c)
  test("a task source whose first read fails says why in its count; read again, its open rows are cards", async () => {
    const w = worldOf();
    const ISSUES = {
      tiles: [{ kind: "table", title: "Issues", from: "issues", columns: ["number", "title", "state"] }],
      tables: { issues: [{ number: 1, title: "x", state: "open" }] },
      sources: { issues: { command: ["gh", "issue", "list", "--json", "number,title,state"], key: "number", every: "2m" } },
      tasks: { from: "issues", title: "title", column: "state", done: ["closed"] },
    };
    assert.equal(dashboardOf(ISSUES).ok, true);
    w.answers.gh = { ok: false, error: "gh exited 4: not logged in" };
    w.publish({ type: "dashboard", title: "Issues", ...ISSUES });
    const name = "issues-ab12";
    w.runner.keep("p1", name, 1);
    w.runner.feeds("p1");
    await until(() => w.runner.feeds("p1").counts.length > 0, "its count");
    assert.deepEqual(w.runner.feeds("p1"), { lanes: [], tasks: [], counts: [{ dashboard: name, title: "Issues", count: 0, more: 0, done: 0, error: "gh exited 4: not logged in" }] });
    w.answers.gh = { ok: true, out: JSON.stringify([{ number: 7, title: "Login loops", state: "open" }, { number: 6, title: "Old", state: "closed" }]) };
    await w.runner.read(name, 1, "issues", { force: true });
    const fed = w.runner.feeds("p1");
    assert.deepEqual(fed.tasks.map((t) => [t.key, t.task, t.column, t.stale]), [["7", "Login loops", "planned", false]]);
    assert.deepEqual(fed.counts, [{ dashboard: name, title: "Issues", count: 1, more: 0, done: 1 }]);
  });

  // (fails before: yes — the same)
  test("a source that fails keeps its last rows and is tried at its every, not at each ask; after three in a row it stops until Read again", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    const name = "deploys-ab12";
    w.runner.keep("p1", name, 1);
    await w.runner.read(name, 1, "deploys");
    const goodAt = w.clock.at;
    w.answers.npx = { ok: false, error: "npx exited 1: You are not authenticated. Please run `wrangler login`." };
    /** @param {boolean} [force] */
    const again = async (force = false) => /** @type {any} */ (await w.runner.read(name, 1, "deploys", { force })).state;
    w.clock.at += 3 * MIN;
    let s = await again();
    assert.deepEqual([s.rows.length, s.at, s.error, s.fails, s.stopped], [2, goodAt, "npx exited 1: You are not authenticated. Please run `wrangler login`.", 1, false]);
    const runs = w.ran.length;
    await again();
    w.clock.at += MIN;
    await again();
    assert.equal(w.ran.length, runs, "a page that asks again within its every runs nothing: no retry in a loop");
    w.clock.at += 2 * MIN;
    s = await again();
    w.clock.at += 2 * MIN;
    s = await again();
    assert.deepEqual([s.fails, s.stopped, s.rows.length], [FAILS_TO_STOP, true, 2]);
    const stoppedAt = w.ran.length;
    w.clock.at += 10 * MIN;
    s = await again();
    assert.equal(w.ran.length, stoppedAt, "stopped: no read runs it");
    w.answers.npx = { ok: true, out: WRANGLER };
    s = await again(true);
    assert.deepEqual([w.ran.length, s.fails, s.stopped, s.error], [stoppedAt + 1, 0, false, null], "Read again runs it, and it goes on");
    // Rows that do not read are a failure too, in words.
    w.answers.gh = { ok: true, out: "Welcome to GitHub CLI" };
    const runsRead = /** @type {any} */ (await w.runner.read(name, 1, "runs")).state;
    assert.equal(runsRead.error, "it said words, not JSON: “Welcome to GitHub CLI”");
    const [shown] = w.runner.shown("p1");
    assert.deepEqual(shown.sources.runs, { at: 0, error: "it said words, not JSON: “Welcome to GitHub CLI”", errorAt: w.clock.at, fails: 1, stopped: false, rows: 0 });
  });

  // (fails before: yes — every version was what it was)
  test("a version that changes only tiles is live at once; one that changes a command is a draft again, the kept one reading on; Pause runs nothing", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    const name = "deploys-ab12";
    w.runner.keep("p1", name, 1);
    w.publish({ id: name, ...DEPLOYS, tiles: DEPLOYS.tiles.slice(0, 2) });
    let [d] = w.runner.shown("p1");
    assert.deepEqual([d.v, d.liveV, d.draft], [2, 2, false], "live at once");
    assert.equal(w.runner.mayRead(name, 2).ok, true);
    w.publish({ id: name, ...DEPLOYS, sources: { ...DEPLOYS.sources, deploys: { ...DEPLOYS.sources.deploys, command: ["npx", "wrangler", "deployments", "list", "--json", "--name", "app-api"] } } });
    [d] = w.runner.shown("p1");
    assert.deepEqual([d.v, d.liveV, d.keptV, d.draft, d.state], [3, 2, 1, true, "kept"]);
    assert.deepEqual(w.runner.mayRead(name, 3), { ok: false, error: "v3 is a draft: nothing it names reads until it is kept", off: "draft" });
    assert.equal((await w.runner.read(name, 2, "deploys")).ok, true, "the kept version reads on");
    assert.deepEqual(w.ran.at(-1), ["npx wrangler deployments list --json", "/work/app"]);
    w.runner.keep("p1", name, 3);
    [d] = w.runner.shown("p1");
    assert.deepEqual([d.liveV, d.keptV, d.draft], [3, 3, false]);
    w.runner.change("p1", name, { paused: true });
    assert.deepEqual(w.runner.mayRead(name, 3), { ok: false, error: "it is paused", off: "paused" });
    assert.deepEqual(await w.runner.read(name, 3, "deploys"), { ok: false, error: "it is paused" });
    w.runner.change("p1", name, { paused: false });
    assert.equal(w.runner.mayRead(name, 3).ok, true);
  });

  // (fails before: yes — nothing watched)
  test("a kept watch looks by itself: its first look learns; across a restart what it saw is kept, so only a new row writes a line", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    const name = "deploys-ab12";
    w.runner.keep("p1", name, 1);
    const one = createDashboardRunner({ ...w.deps, firstMs: 1 });
    one.start();
    await until(() => Object.keys(w.spaces.get("p1").dashboards[0].seen).length === 1, "the first look");
    one.stop();
    const before = w.spaces.get("p1").log.length;
    assert.ok(w.spaces.get("p1").log.every((e) => e.by.name !== "Deploys"), "the first look writes nothing");
    assert.deepEqual(w.runner.shown("p1")[0].looks, [w.clock.at]);
    w.answers.gh = { ok: true, out: ghRuns([{ id: 9001, c: "failure" }, { id: 9000, c: "success" }, { id: 1, c: "failure" }, { id: 2, c: "success" }]) };
    const two = createDashboardRunner({ ...w.deps, firstMs: 1 });
    two.start();
    await until(() => w.spaces.get("p1").log.length > before, "the look after the restart");
    two.stop();
    assert.deepEqual(w.spaces.get("p1").log.slice(before).map((e) => [e.by, e.text]), [[{ kind: "filament", name: "Deploys" }, "CI failed on main: run 9001"]]);
    // Paused, no watch looks.
    w.runner.change("p1", name, { paused: true });
    const ran = w.ran.length;
    const three = createDashboardRunner({ ...w.deps, firstMs: 1 });
    three.start();
    await new Promise((r) => setTimeout(r, 30));
    three.stop();
    assert.equal(w.ran.length, ran);
  });

  // (fails before: yes — there was no Pause all, and no list of the watches)
  test("Pause all (HarnessV4_Space_Plan S6-D4): no watch looks while it is on, and the list of watches has no next look; off, they look again", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    const name = "deploys-ab12";
    w.runner.keep("p1", name, 1);
    const one = createDashboardRunner({ ...w.deps, firstMs: 1 });
    one.start();
    await until(() => Object.keys(w.spaces.get("p1").dashboards[0].seen).length === 1, "the first look");
    assert.deepEqual(one.watches("p1").map((x) => [x.project, x.title, x.rule, x.to, x.every, x.last, x.nextAt]), [["p1", "Deploys", "a new row of runs where status is failure", "What happened", "10 min", w.clock.at, w.clock.at + 600_000]]);
    assert.deepEqual(one.watches("p2"), [], "a project's own");
    assert.equal(one.pauseAll(true), w.clock.at);
    assert.equal(one.watches(null)[0].nextAt, null, "paused, no next look");
    const ran = w.ran.length;
    const two = createDashboardRunner({ ...w.deps, firstMs: 1 });
    two.start();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(w.ran.length, ran, "no watch looks while Pause all is on, a restart included");
    assert.equal(two.pauseAll(false), null);
    w.answers.gh = { ok: true, out: ghRuns([{ id: 9002, c: "failure" }, { id: 1, c: "failure" }, { id: 2, c: "success" }]) };
    await until(() => w.spaces.get("p1").log.some((e) => e.text === "CI failed on main: run 9002"), "a look once it is off");
    one.stop();
    two.stop();
  });

  // Found by the Hunter on S2, each.
  test("a watch looks at the rows last read well when its read fails; Keep is this Space's; Pause stops a read under way; kept again while paused, it says so", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    const name = "deploys-ab12";
    // Another project's Space keeps none of p1's: what it runs would run in p2's folder.
    // (fails before: yes — any Space kept it)
    assert.deepEqual(w.runner.keep("p2", name, 1), { ok: false, status: 404, error: "Deploys is no dashboard of this Space: a chat of this project publishes one." });
    w.runner.keep("p1", name, 1);
    // A watch's first look learns runs 1 and 2; a page's read then brings run 9001, which the watch has not seen; the
    // next read fails: the watch looks at the rows the tab still shows, and says 9001.
    // (fails before: yes — a failed read was nothing to look at, so 9001 was never said)
    const one = createDashboardRunner({ ...w.deps, firstMs: 1 });
    one.start();
    await until(() => Object.keys(w.spaces.get("p1").dashboards[0].seen).length === 1, "the first look");
    one.stop();
    w.answers.gh = { ok: true, out: ghRuns([{ id: 9001, c: "failure" }, { id: 1, c: "failure" }, { id: 2, c: "success" }]) };
    await one.read(name, 1, "runs", { force: true });
    w.answers.gh = { ok: false, error: "gh exited 1: HTTP 401" };
    w.clock.at += 11 * MIN;
    const before = w.spaces.get("p1").log.length;
    one.start();
    await until(() => w.spaces.get("p1").log.length > before, "the look after the failure");
    one.stop();
    assert.equal(one.shown("p1")[0].sources.runs.error, "gh exited 1: HTTP 401", "it failed");
    assert.deepEqual(w.spaces.get("p1").log.slice(before).map((e) => e.text), ["CI failed on main: run 9001"]);
    // Paused while its command runs: the command is stopped, and what it read is let be — no failure, no rows.
    // (fails before: yes — the command ran on, and its rows were kept)
    /** @type {AbortSignal[]} */
    const signals = [];
    const held = createDashboardRunner({ ...w.deps, run: (_argv, _cwd, signal) => new Promise((done) => {
      if (signal) signals.push(signal);
      signal?.addEventListener("abort", () => done({ ok: false, error: "it was stopped" }), { once: true });
    }) });
    const going = held.read(name, 1, "deploys");
    await until(() => signals.length === 1, "its command runs");
    held.change("p1", name, { paused: true });
    assert.equal(signals[0].aborted, true, "stopped");
    assert.deepEqual(await going, { ok: true, state: { rows: [], at: 0, error: null, errorAt: 0, fails: 0, stopped: false } });
    assert.equal(held.shown("p1")[0].sources.deploys, null, "nothing kept of it");
    // Kept again while paused: it stays paused, and its line says so.
    // (fails before: yes — the line said it runs by itself)
    w.publish({ id: name, ...DEPLOYS, sources: { ...DEPLOYS.sources, deploys: { ...DEPLOYS.sources.deploys, every: "5m" } } });
    held.keep("p1", name, 2);
    assert.equal(w.spaces.get("p1").dashboards[0].paused, true);
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "You kept “Deploys” in this Space: it stays paused: once you resume it, it runs 2 commands and 1 watch by itself.");
  });

  // (fails before: yes — the same)
  test("taken out: gone from the Space and nothing of it runs; a later version from a chat shows it again, a draft", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    const name = "deploys-ab12";
    w.runner.change("p1", name, { removed: true });
    assert.deepEqual(w.runner.shown("p1"), [], "a draft taken out");
    w.publish({ id: name, ...DEPLOYS });
    assert.deepEqual(w.runner.shown("p1").map((d) => [d.state, d.v]), [["draft", 2]], "its way back");
    w.runner.keep("p1", name, 2);
    w.runner.change("p1", name, { removed: true });
    assert.deepEqual([w.runner.shown("p1"), w.spaces.keptDashboards()], [[], []]);
    assert.deepEqual(await w.runner.read(name, 2, "deploys"), { ok: false, error: "it is not kept in a Space: nothing reads until it is" });
    // Its way back: Add to this Space… lists it; put back, it is kept as it was and reads again.
    assert.deepEqual(w.runner.gone("p1"), [{ name, title: "Deploys", keptV: 2, at: w.clock.at }]);
    w.runner.putBack("p1", name);
    assert.deepEqual([w.runner.gone("p1"), w.runner.shown("p1").map((d) => [d.state, d.keptV, d.draft])], [[], [["kept", 2, false]]]);
    assert.equal((await w.runner.read(name, 2, "deploys")).ok, true);
    // Out again, then a later version: shown as a draft, so not offered to put back.
    w.runner.change("p1", name, { removed: true });
    w.publish({ id: name, ...DEPLOYS });
    assert.deepEqual([w.runner.gone("p1"), w.runner.shown("p1").map((d) => [d.state, d.v])], [[], [["draft", 3]]]);
  });
});

describe("a command run as a source", () => {
  const dir = fresh("cmd");
  writeFileSync(join(dir, "ok.mjs"), 'console.log(JSON.stringify([{ a: 1 }, { a: 2 }]));\n');
  writeFileSync(join(dir, "fail.mjs"), 'console.error("first"); console.error("You are not signed in"); process.exit(2);\n');
  writeFileSync(join(dir, "big.mjs"), 'process.stdout.write("x".repeat(1_200_000));\n');
  writeFileSync(join(dir, "cwd.mjs"), "console.log(JSON.stringify([{ at: process.cwd() }]));\n");
  // (fails before: yes — nothing ran one)
  test("its output, in its folder, no shell; a failure in words: its exit and last lines, not found, too much", async () => {
    assert.deepEqual(await runCommand([process.execPath, "ok.mjs"], dir), { ok: true, out: '[{"a":1},{"a":2}]\n' });
    const cwd = await runCommand([process.execPath, "cwd.mjs"], dir);
    assert.ok(cwd.ok && JSON.parse(cwd.out)[0].at.toLowerCase() === dir.toLowerCase(), "run in the folder given");
    const fail = await runCommand([process.execPath, "fail.mjs"], dir);
    assert.deepEqual(fail, { ok: false, error: `${process.execPath} exited 2: first · You are not signed in` });
    assert.deepEqual(await runCommand(["filament-no-such-program-x9"], dir), { ok: false, error: "filament-no-such-program-x9 was not found on this computer" });
    assert.deepEqual(await runCommand([process.execPath, "big.mjs"], dir), { ok: false, error: "it said more than 1 MB" });
    const shell = await runCommand([process.execPath, "ok.mjs", "&&", "echo", "hi"], dir);
    assert.ok(shell.ok && !shell.out.includes("hi"), "&& is an argument, not a shell's");
  });

  // Its dashboard paused, taken out or kept again while it runs: stopped, its tree killed.
  // (fails before: yes — found by the Hunter on S2: nothing could stop a source's command before its 60 s)
  test("stopped by its signal: its processes ended, said so", async () => {
    writeFileSync(join(dir, "slow.mjs"), "setTimeout(() => console.log('[]'), 30_000);\n");
    const stop = new AbortController();
    const from = Date.now();
    const going = runCommand([process.execPath, "slow.mjs"], dir, stop.signal);
    await new Promise((r) => setTimeout(r, 200));
    stop.abort();
    assert.deepEqual(await going, { ok: false, error: "it was stopped" });
    assert.ok(Date.now() - from < 20_000, "ended at once, not when it finished");
    assert.deepEqual(await runCommand([process.execPath, "ok.mjs"], dir, AbortSignal.abort()), { ok: false, error: "it was stopped" }, "stopped before it ran");
  });
});

/** A button on Deploys' rows (the Designer's): roll back to a version that is not serving, why asked. */
const ROLLBACK = {
  label: "Roll back to this…",
  on: "deploys",
  except: { version: "7c1e" },
  command: ["npx", "wrangler", "rollback", "{row.version}", "--message", "{ask.why}", "--yes"],
  check: { "row.version": "^[0-9a-f]{4}$" },
  ask: [{ name: "why", label: "Why (goes in the deploy's message)", required: true }],
  says: "Roll back app-api to {row.version} ({row.message})? Production serves it at once.",
};
/** Deploys with the button on its table. */
const WITH_BUTTON = {
  ...DEPLOYS,
  tiles: DEPLOYS.tiles.map((t) => (t.kind === "table" ? { ...t, actions: ["rollback"] } : t)),
  actions: { rollback: ROLLBACK },
};
/** Deploys' rows as Filament reads them from WRANGLER: a, then b, which serves now. */
const ROW_A = { when: "2026-10-23T10:00:00Z", version: "3f2a", message: "Add retry", [ROW_KEY]: "a" };
const ROLLED = ["npx", "wrangler", "rollback", "3f2a", "--message", "the login broke", "--yes"];

describe("a dashboard's buttons, checked (S3a)", () => {
  // (fails before: yes — a dashboard had no buttons)
  test("each wrong part of a button refused in words that name it; a table tile names buttons on its own rows", () => {
    /** @param {any} a @param {any} [more] */
    const no = (a, more = {}) => {
      const r = sourcesOf({ sources: DEPLOYS.sources, actions: { b: a }, ...more });
      return r.ok ? "" : r.error;
    };
    const b = (/** @type {any} */ x) => no({ ...ROLLBACK, ...x });
    assert.equal(b({}), "");
    assert.equal(no(3), 'the button b is no object: a button is {"label":"Roll back to this…","on":"deploys","command":["npx","wrangler","rollback","{row.version}"]}');
    assert.equal(b({ label: " " }), "the button b has no label: the button's words, 60 characters at most");
    assert.equal(b({ on: "nope" }), "the button b acts on nope: it acts on the rows of one of the sources (deploys, runs)");
    assert.equal(b({ on: undefined }), "the button b has no on: it acts on the rows of one of the sources (deploys, runs)");
    assert.equal(no(ROLLBACK, { sources: { deploys: { ...DEPLOYS.sources.deploys, key: undefined } } }),
      "the button b acts on deploys, whose rows have no key: give deploys a key — the path that names a row — so a press names its row");
    assert.equal(b({ tool: { connection: "github", name: "rerun" } }), "the button b has a command and a tool: a button runs one of them", "a tool's button is S4a's (space-tools.test.js)");
    assert.equal(b({ command: ["{row.version}"] }), "the button b has a command with no program first: the program is written out, never a placeholder");
    assert.equal(b({ except: { traffic: 100 } }), "the button b has except on traffic, which deploys does not have (when, version, message)");
    assert.equal(b({ only: {} }), 'the button b has only that is no object of a column and its value: {"status":"failure"}');
    assert.equal(b({ ask: [{ name: "why", label: "Why" }, { name: "why", label: "Again" }] }), "the button b has two fields named why");
    assert.equal(b({ ask: [{ name: "why", label: "Why", choices: ["a"], from: { source: "runs", column: "run" } }] }), "the button b has field 1 (why) with choices and from: give one or the other");
    assert.equal(b({ ask: [{ name: "why", label: "Why", from: { source: "runs", column: "zz" } }] }), "the button b has field 1 (why) whose from reads zz, which runs does not have (run, status)");
    assert.equal(b({ command: ["npx", "wrangler", "rollback", "{row.colour}"] }), "the button b has {row.colour}, a column deploys does not have (when, version, message)");
    assert.equal(b({ ask: [] }), "the button b has {ask.why}, a field its ask does not have");
    assert.equal(b({ check: { "row.when": "x" } }), "the button b checks row.when, which its command does not use (row.version, ask.why)");
    assert.equal(b({ check: { "row.version": "(" } }), 'the button b checks row.version with "(", which is no pattern');
    assert.equal(b({ says: "" }), 'the button b has no says: the sheet\'s sentence, 300 characters at most, with {row.<column>} for a value ("Roll back to {row.version}?")');
    assert.equal(b({ secondLook: "yes" }), "the button b has secondLook that is neither true nor false");
    assert.equal(no(ROLLBACK, { actions: { "a b": ROLLBACK } }), 'the button "a b" needs a name of letters, digits, - and _ (40 at most)');
    assert.match(no(null, { actions: [] }), /^actions is an object of named buttons: /);
    /** @param {any[]} tiles */
    const tiles = (tiles) => {
      const r = dashboardOf({ ...WITH_BUTTON, tiles });
      return r.ok ? "" : r.error;
    };
    assert.equal(tiles(WITH_BUTTON.tiles), "");
    assert.deepEqual(/** @type {any} */ (dashboardOf(WITH_BUTTON)).content.actions, WITH_BUTTON.actions, "kept as given");
    assert.equal(tiles([{ kind: "number", title: "Deploys", from: "deploys", of: "count", actions: ["rollback"] }]), "tile 1 (Deploys) has actions, which only a table tile takes: the buttons on its rows");
    assert.equal(tiles([{ kind: "table", title: "Runs", from: "runs", actions: ["rollback"] }]), "tile 1 (Runs) has the button rollback, which acts on deploys, not on runs, the rows it shows");
    assert.equal(tiles([{ kind: "table", title: "Deploys", from: "deploys", actions: ["rerun"] }]), "tile 1 (Deploys) has the button rerun, which is none of the dashboard's actions (rollback)");
    assert.equal(tiles([{ kind: "table", title: "Deploys", from: "deploys", actions: "rollback" }]), "tile 1 (Deploys) has actions that are no list of its buttons' names");
  });

  // (fails before: yes — the same)
  test("the grant a Keep promises holds each button's command, rows, checks and fields; its label, sentence and required are words", () => {
    const g = grantOf(WITH_BUTTON);
    assert.deepEqual(g.actions, {
      rollback: { on: "deploys", only: null, except: { version: "7c1e" }, command: ROLLBACK.command, check: ROLLBACK.check, ask: [{ name: "why", choices: null, from: null }], secondLook: false },
    });
    /** @param {any} x */
    const same = (x) => sameGrant(grantOf({ ...WITH_BUTTON, actions: { rollback: { ...ROLLBACK, ...x } } }), g);
    assert.deepEqual([same({ label: "Roll back…" }), same({ says: "Roll back?" }), same({ ask: [{ name: "why", label: "Reason" }] })], [true, true, true], "words: live at once");
    assert.deepEqual(
      [same({ command: [...ROLLBACK.command, "--env", "staging"] }), same({ except: null }), same({ check: {} }), same({ secondLook: true }), same({ ask: [{ name: "why", label: "Why", choices: ["broke", "slow"] }] })],
      [false, false, false, false, false],
      "what it may run: a draft again",
    );
    assert.equal(sameGrant(grantOf({ ...WITH_BUTTON, actions: { ...WITH_BUTTON.actions, again: ROLLBACK } }), g), false, "a button more");
  });

  // (fails before: yes — the same)
  test("a press filled from the row Filament read: each placeholder one part, checked; a value starting with - refused; the fields' answers checked", () => {
    const a = actionKept(ROLLBACK);
    assert.deepEqual(fillAction(a, ROW_A, { why: "the login broke" }), { ok: true, argv: ROLLED });
    assert.deepEqual(fillAction(a, ROW_A, {}, undefined, { rowOnly: true }), { ok: true, argv: ["npx", "wrangler", "rollback", "3f2a", "--message", "{ask.why}", "--yes"] }, "as the sheet opens");
    assert.deepEqual(fillAction(a, ROW_A, { why: " " }), { ok: false, error: "Why (goes in the deploy's message) is empty: it is needed" });
    assert.deepEqual(fillAction(a, ROW_A, { why: "--force" }), { ok: false, error: "{ask.why} is “--force”: a value may not start with “-”" });
    assert.deepEqual(fillAction(a, { ...ROW_A, version: "-rf" }, { why: "x" }), { ok: false, error: "{row.version} is “-rf”: a value may not start with “-”" });
    assert.deepEqual(fillAction(a, { ...ROW_A, version: "3f2a; rm" }, { why: "x" }), { ok: false, error: "{row.version} is “3f2a; rm”, which does not match its check ^[0-9a-f]{4}$" });
    assert.deepEqual(fillAction(a, { ...ROW_A, version: null }, { why: "x" }), { ok: false, error: "the row has no version" });
    assert.deepEqual(fillAction(a, ROW_A, { why: "a\nb" }), { ok: false, error: "{ask.why} is no line of text (1000 characters at most)" });
    const pick = actionKept({
      ...ROLLBACK,
      command: ["gh", "workflow", "run", "deploy", "--ref", "{ask.branch}", "--field", "env={ask.env}"],
      check: {},
      ask: [{ name: "env", label: "Where", choices: ["staging", "production"] }, { name: "branch", label: "Branch", from: { source: "branches", column: "name" } }],
    });
    const from = (/** @type {{ source: string, column: string }} */ f) => (f.source === "branches" && f.column === "name" ? ["main", "next"] : []);
    assert.deepEqual(fillAction(pick, ROW_A, { env: "staging", branch: "next" }, from), { ok: true, argv: ["gh", "workflow", "run", "deploy", "--ref", "next", "--field", "env=staging"] });
    assert.deepEqual(fillAction(pick, ROW_A, { env: "prod", branch: "next" }, from), { ok: false, error: "“prod” is none of env's choices" });
    assert.deepEqual(fillAction(pick, ROW_A, { env: "staging", branch: "gone" }, from), { ok: false, error: "“gone” is no name of branches now" });
    assert.deepEqual([actionOnRow(a, ROW_A), actionOnRow(a, { ...ROW_A, version: "7c1e" })], [true, false], "except: the version serving now has none");
    assert.equal(actionOnRow({ ...a, except: null, only: { message: "Add retry" } }, ROW_A), true);
    assert.equal(argvWords([...ROLLED, ""]), 'npx wrangler rollback 3f2a --message "the login broke" --yes ""');
  });
});

describe("a dashboard's buttons, run (S3a)", () => {
  // (fails before: yes — a dashboard had no buttons)
  test("its sheet: only on a kept dashboard of this Space, on a row as Filament read it; why not, in words", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...WITH_BUTTON });
    const name = "deploys-ab12";
    const notHere = { ok: false, status: 409, error: "it is not kept in this Space: its buttons run once it is" };
    assert.deepEqual(await w.runner.sheet("p1", name, "rollback", "a"), notHere, "a draft's buttons are off");
    w.runner.keep("p1", name, 1);
    assert.deepEqual(await w.runner.sheet("p2", name, "rollback", "a"), notHere, "another project's Space");
    assert.deepEqual(await w.runner.sheet("p1", name, "rollback", "a"), { ok: false, status: 409, error: "deploys has not been read yet: read it first" });
    await w.runner.read(name, 1, "deploys");
    assert.deepEqual(await w.runner.sheet("p1", name, "rollback", "a"), {
      ok: true,
      label: "Roll back to this…",
      title: "Deploys",
      says: "Roll back app-api to 3f2a (Add retry)? Production serves it at once.",
      command: ["npx", "wrangler", "rollback", "3f2a", "--message", "{ask.why}", "--yes"],
      tool: null,
      folder: "/work/app",
      ask: [{ name: "why", label: "Why (goes in the deploy's message)", required: true, choices: null }],
      secondLook: false,
      // What it does (10-29): every button before effects writes.
      effect: "writes",
      // No `verify`; the chat that made it is of this project, so a check could run (S5d).
      verify: "",
      checkOff: "",
      // Who would check it, there, should the person ask: no model said where nothing wired one (the owner's word of 10-31).
      skeptic: { chain: "c1", model: "", why: "" },
      running: null,
    });
    assert.deepEqual(await w.runner.sheet("p1", name, "rollback", "b"), { ok: false, status: 409, error: "Roll back to this… is not on that row" }, "the one serving now");
    assert.deepEqual(await w.runner.sheet("p1", name, "rollback", "zz"), { ok: false, status: 409, error: "that row is no longer in deploys: read it again" });
    assert.deepEqual(await w.runner.sheet("p1", name, "nope", "a"), { ok: false, status: 404, error: "v1 has no button nope" });
    // A row's words are anyone's: a value against the rules is refused as the sheet opens.
    w.answers.npx = { ok: true, out: JSON.stringify([...JSON.parse(WRANGLER), { id: "c", created_on: "2026-10-22T09:00:00Z", versions: [{ version_id: "--all" }], annotations: {} }]) };
    await w.runner.read(name, 1, "deploys", { force: true });
    assert.deepEqual(await w.runner.sheet("p1", name, "rollback", "c"), { ok: false, status: 409, error: "{row.version} is “--all”: a value may not start with “-”" });
    // Its rows stale: a read failed after them.
    w.answers.npx = { ok: false, error: "npx exited 1: not signed in" };
    w.clock.at += 12 * MIN;
    await w.runner.read(name, 1, "deploys", { force: true });
    assert.deepEqual(await w.runner.sheet("p1", name, "rollback", "a"), { ok: false, status: 409, error: "Read it again first: these rows are 12 min old" });
    w.answers.npx = { ok: true, out: WRANGLER };
    await w.runner.read(name, 1, "deploys", { force: true });
    w.runner.change("p1", name, { paused: true });
    assert.deepEqual(await w.runner.sheet("p1", name, "rollback", "a"), { ok: false, status: 409, error: "it is paused: resume it to press its buttons" });
    assert.deepEqual(await w.runner.act("p1", name, "rollback", "a", { why: "x" }), { ok: false, status: 409, error: "it is paused: resume it to press its buttons" }, "whatever the page asks");
    assert.deepEqual(w.acted, []);
  });

  // (fails before: yes — the same)
  test("Run: its command filled from the row Filament read, in the project's folder; a line in What happened; its source read again; a failure said", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...WITH_BUTTON });
    const name = "deploys-ab12";
    w.runner.keep("p1", name, 1);
    await w.runner.read(name, 1, "deploys");
    assert.deepEqual(await w.runner.act("p1", name, "rollback", "a", {}), { ok: false, status: 400, error: "Why (goes in the deploy's message) is empty: it is needed" });
    assert.deepEqual(w.acted, [], "refused: nothing ran");
    const reads = w.ran.length;
    // `ran` and `output`: what ran and what it said, for Hand to an agent… (S5d); `job`, its run, whose log reads by it.
    const rolled = /** @type {any} */ (await w.runner.act("p1", name, "rollback", "a", { why: "the login broke" }));
    assert.equal(w.runner.jobOf(name, rolled.job)?.action, "rollback", "its run, by its id");
    assert.deepEqual(rolled, { ok: true, done: true, said: "Rolled back to 3f2a", output: "Rolling back…\nRolled back to 3f2a\n", ran: "npx wrangler rollback 3f2a --message \"the login broke\" --yes", error: null, outcome: "Rolled back to 3f2a", argv: ROLLED, job: rolled.job });
    assert.deepEqual(w.acted, [[ROLLED, "/work/app"]]);
    assert.equal(w.ran.length, reads + 1, "its source read again, though it was fresh");
    assert.deepEqual(w.spaces.get("p1").log.at(-1)?.text, "You ran “Roll back to this…” on Deploys: npx wrangler rollback 3f2a --message \"the login broke\" --yes — Rolled back to 3f2a");
    w.ends.npx = { ok: false, error: "npx exited 1: Version 3f2a is not found", said: "Version 3f2a is not found\n" };
    const failed = /** @type {any} */ (await w.runner.act("p1", name, "rollback", "a", { why: "again" }));
    assert.deepEqual([failed.ok, failed.done, failed.error, failed.said], [true, false, "npx exited 1: Version 3f2a is not found", "Version 3f2a is not found"]);
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "You ran “Roll back to this…” on Deploys: npx wrangler rollback 3f2a --message again --yes — it failed: npx exited 1: Version 3f2a is not found");
    // A version that changes the button is a draft: the kept one's button is the one that runs.
    w.publish({ id: name, ...WITH_BUTTON, actions: { rollback: { ...ROLLBACK, command: ["npx", "wrangler", "rollback", "{row.version}", "--yes"] } } });
    w.ends.npx = { ok: true, said: "ok\n" };
    await w.runner.act("p1", name, "rollback", "a", { why: "kept" });
    assert.deepEqual(w.acted.at(-1)?.[0], ["npx", "wrangler", "rollback", "3f2a", "--message", "kept", "--yes"]);
  });

  // (fails before: yes — the same)
  test("one at a time on a dashboard; Stop stops it; a field's choices from another source, read for the sheet", async () => {
    const w = worldOf();
    const PROMOTE = {
      label: "Promote…",
      on: "deploys",
      command: ["npx", "wrangler", "versions", "deploy", "{row.version}", "--env", "{ask.env}"],
      check: { "row.version": "^[0-9a-f]{4}$" },
      ask: [{ name: "env", label: "To", required: true, from: { source: "envs", column: "name" } }],
      says: "Promote {row.version} to {ask.env}?",
    };
    w.publish({
      type: "dashboard",
      title: "Deploys",
      ...WITH_BUTTON,
      tiles: WITH_BUTTON.tiles.map((t) => (t.kind === "table" ? { ...t, actions: ["rollback", "promote"] } : t)),
      sources: { ...DEPLOYS.sources, envs: { command: ["git", "branch", "--format=%(refname:short)"], fields: ["name"] } },
      actions: { rollback: ROLLBACK, promote: PROMOTE },
    });
    const name = "deploys-ab12";
    w.runner.keep("p1", name, 1);
    await w.runner.read(name, 1, "deploys");
    w.answers.git = { ok: true, out: "staging\nproduction\n" };
    const sheet = /** @type {any} */ (await w.runner.sheet("p1", name, "promote", "a"));
    assert.deepEqual([sheet.says, sheet.ask[0].choices], ["Promote 3f2a to {ask.env}?", ["staging", "production"]], "envs read for its choices");
    assert.deepEqual(await w.runner.act("p1", name, "promote", "a", { env: "qa" }), { ok: false, status: 400, error: "“qa” is no name of envs now" });
    w.hold.on = true;
    const first = w.runner.act("p1", name, "rollback", "a", { why: "one" });
    await until(() => w.acted.length === 1, "the first press runs");
    assert.deepEqual(await w.runner.act("p1", name, "promote", "a", { env: "staging" }), { ok: false, status: 409, error: "Roll back to this… is running on Deploys: wait for it, or stop it" });
    assert.equal(/** @type {any} */ (await w.runner.sheet("p1", name, "promote", "a")).running, "Roll back to this…", "its sheet says what runs");
    assert.deepEqual(w.runner.stopAct("p2", name), { ok: false, status: 409, error: "nothing of it is running" }, "from another Space, nothing");
    assert.deepEqual(w.runner.stopAct("p1", name), { ok: true, label: "Roll back to this…" });
    const stopped = /** @type {any} */ (await first);
    assert.deepEqual([stopped.done, stopped.error], [false, "you stopped it"]);
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "You ran “Roll back to this…” on Deploys: npx wrangler rollback 3f2a --message one --yes — you stopped it");
    assert.deepEqual(w.runner.stopAct("p1", name), { ok: false, status: 409, error: "nothing of it is running" });
    w.hold.on = false;
    const promoted = /** @type {any} */ (await w.runner.act("p1", name, "promote", "a", { env: "staging" }));
    assert.deepEqual([promoted.done, w.acted.at(-1)?.[0]], [true, ["npx", "wrangler", "versions", "deploy", "3f2a", "--env", "staging"]], "the next press runs");
    // The choices' source read again once older than its every, for the next sheet; younger, as read.
    // (fails before: yes — found by the Hunter on S4a: read once, its choices were served however old)
    w.answers.git = { ok: true, out: "staging\nproduction\nqa\n" };
    const choices = async () => /** @type {any} */ (await w.runner.sheet("p1", name, "promote", "a")).ask?.[0]?.choices;
    assert.deepEqual(await choices(), ["staging", "production"], "younger than its every: as read");
    w.clock.at += 2 * 60_000 + 1;
    assert.deepEqual(await choices(), ["staging", "production", "qa"]);
  });
});

describe("a button's command run", () => {
  const dir = fresh("act");
  writeFileSync(join(dir, "ok.mjs"), 'console.log("Rolling back"); console.error("warn: slow"); console.log("Rolled back to " + process.argv[2]);\n');
  writeFileSync(join(dir, "fail.mjs"), 'console.error("Version not found"); process.exit(3);\n');
  writeFileSync(join(dir, "wait.mjs"), "setInterval(() => {}, 1000);\n");
  // (fails before: yes — nothing ran one)
  test("what it said, both streams; a failure in words; no clock on it — it runs until it ends, or is stopped", async () => {
    const ok = await runActionCommand([process.execPath, "ok.mjs", "3f2a"], dir);
    assert.ok(ok.ok && ["Rolling back", "warn: slow", "Rolled back to 3f2a"].every((l) => ok.said.includes(l)), ok.said);
    assert.deepEqual(await runActionCommand([process.execPath, "fail.mjs"], dir), { ok: false, error: `${process.execPath} exited 3: Version not found`, said: "Version not found\n" });
    assert.deepEqual(await runActionCommand(["filament-no-such-program-x9"], dir), { ok: false, error: "filament-no-such-program-x9 was not found on this computer", said: "" });
    const abort = new AbortController();
    const going = runActionCommand([process.execPath, "wait.mjs"], dir, abort.signal);
    await new Promise((r) => setTimeout(r, 200));
    abort.abort();
    const stopped = await going;
    assert.deepEqual([stopped.ok, !stopped.ok && stopped.error], [false, "you stopped it"]);
  });
});

/**
 * A request to an artifact's address, awaited: its status and its body (JSON where it is).
 * @param {any} answer @param {string} path @param {{ name?: string, method?: string }} [o]
 */
async function ask(answer, path, { name = "deploys-ab12", method = "GET" } = {}) {
  /** @type {any} */
  const res = { status: 0, headers: {}, body: "", written: /** @type {string[]} */ ([]), writeHead(/** @type {number} */ s, /** @type {any} */ h) { this.status = s; this.headers = h; }, write(/** @type {any} */ x) { this.written.push(String(x)); }, end(/** @type {any} */ b) { this.body = b ? String(b) : ""; } };
  /** @type {(() => void)[]} */
  const closes = [];
  await answer({ method, headers: {}, socket: { remoteAddress: "127.0.0.1" }, on: (/** @type {string} */ ev, /** @type {() => void} */ fn) => void (ev === "close" && closes.push(fn)) }, res, name, new URL(`http://x${path}`));
  res.close = () => closes.forEach((f) => f());
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {}
  return { res, status: res.status, json };
}
/** What a page reads as its own: the payload it draws from. @param {string} page */
const payloadOf = (page) => JSON.parse(/** @type {RegExpExecArray} */ (/<script type="application\/json" id="filament-content">([\s\S]*?)<\/script>/.exec(page))[1]);

describe("its address: its kept sources, to it alone", () => {
  // (fails before: yes — an artifact's address read no source)
  test("a draft's source refused in words; kept, its rows; another artifact gets nothing; its page says whether it reads, and how often", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    w.publish({ type: "doc", title: "Notes", markdown: "# N\n" });
    const handler = createArtifactsHandler({ store: w.artifacts, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300, dashboards: w.runner });
    const bare = createArtifactsHandler({ store: w.artifacts, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300 });
    const draftPage = await ask(handler, "/");
    assert.deepEqual(payloadOf(draftPage.res.body).space, { live: false, why: "it is not kept in a Space: nothing reads until it is", off: "draft" });
    assert.deepEqual([(await ask(handler, "/_filament/sources/deploys?v=1")).status, (await ask(handler, "/_filament/sources/deploys?v=1")).json],
      [409, { error: "Deploys does not read deploys now: it is not kept in a Space: nothing reads until it is.", off: "draft" }]);
    w.runner.keep("p1", "deploys-ab12", 1);
    const page = await ask(handler, "/");
    assert.deepEqual(payloadOf(page.res.body).space, { live: true, every: { deploys: 2 * MIN, runs: 2 * MIN } });
    const inSpace = await ask(handler, "/?in=space");
    assert.deepEqual([inSpace.status, payloadOf(inSpace.res.body).space], [200, payloadOf(page.res.body).space], "framed in its Space's tab, the same page");
    const stream = await ask(handler, "/_filament/source-changes");
    assert.deepEqual([stream.status, stream.res.written], [200, [": following\n\n"]]);
    const got = await ask(handler, "/_filament/sources/deploys");
    assert.equal(got.status, 200);
    assert.deepEqual([got.json.source, got.json.rows.length, got.json.at, got.json.error, got.json.stopped], ["deploys", 2, w.clock.at, null, false]);
    assert.deepEqual(stream.res.written.slice(1), ['data: {"source":"deploys"}\n\n'], "its page hears the read");
    stream.res.close();
    await ask(handler, "/_filament/sources/runs");
    assert.equal(stream.res.written.length, 2, "a closed stream hears nothing more");
    assert.deepEqual([(await ask(handler, "/_filament/sources/nope")).status, (await ask(handler, "/_filament/sources/nope")).json], [409, { error: "Deploys does not read nope now: v1 has no source nope." }]);
    assert.deepEqual((await ask(handler, "/_filament/sources/deploys?v=4")).json, { error: "Deploys has no version 4: it has 1 to 1." });
    assert.deepEqual((await ask(handler, "/_filament/sources/deploys", { name: "notes-cd34" })).json, { error: "Notes reads no source." });
    assert.deepEqual((await ask(handler, "/_filament/sources/deploys", { method: "POST" })).status, 405);
    assert.deepEqual((await ask(bare, "/_filament/sources/deploys")).json, { error: "Deploys reads no source." });
    assert.equal(payloadOf((await ask(bare, "/")).res.body).space, undefined, "with no runner its page says nothing of reading");
  });
});

describe("the admin routes: Keep, Pause, Remove, Read again", () => {
  /**
   * One row through the real router: its status and its body.
   * @param {any[]} rows @param {string} method @param {string} path @param {any} [json]
   */
  async function call(rows, method, path, json) {
    const m = createRouter(rows)(method, path.split("?")[0]);
    assert.ok(m, `${method} ${path} matched a row`);
    const got = { status: 0, body: /** @type {any} */ (null) };
    const res = { headersSent: false, writableEnded: false, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))) };
    await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => json }, {});
    return got;
  }
  // (fails before: yes — the Space had no dashboards)
  test("the Space says its dashboards; each write answers the Space; refusals in their words; unwired, said so", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    const routes = (/** @type {any} */ dashboards) => spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "app", cwd: "/work/app" } : null) } },
      spaces: w.spaces,
      dashboards,
    });
    const rows = routes(w.runner);
    const space = await call(rows, "GET", "/space/p1");
    assert.deepEqual(space.body.dashboards.map((/** @type {any} */ d) => [d.name, d.state]), [["deploys-ab12", "draft"]]);
    const p = "/space/p1/dashboards/deploys-ab12";
    assert.deepEqual(await call(rows, "POST", `${p}/keep`, { v: "x" }), { status: 400, body: { error: "v is the version kept, a whole number from 1" } });
    assert.deepEqual(await call(rows, "POST", `${p}/keep`, []), { status: 400, body: { error: "a JSON object is required: { v }, the version kept" } });
    assert.deepEqual(await call(rows, "POST", `${p}/read`, {}), { status: 409, body: { error: "it is not kept in this Space: nothing reads until it is" } });
    const kept = await call(rows, "POST", `${p}/keep`, { v: 1 });
    assert.deepEqual([kept.status, kept.body.dashboard.state, kept.body.space.dashboards[0].state, kept.body.space.log.at(-1).text],
      [200, "kept", "kept", "You kept “Deploys” in this Space: it runs 2 commands and 1 watch by itself."]);
    const read = await call(rows, "POST", `${p}/read`, {});
    assert.deepEqual(Object.keys(read.body.sources).sort(), ["deploys", "runs"]);
    assert.deepEqual(read.body.space.dashboards[0].sources.deploys.rows, 2);
    assert.deepEqual(await call(rows, "POST", `${p}/read`, { source: "zz" }), { status: 404, body: { error: "v1 has no source zz" } });
    const one = w.ran.length;
    await call(rows, "POST", `${p}/read`, { source: "runs" });
    assert.deepEqual([w.ran.length, w.ran.at(-1)?.[0]], [one + 1, "gh run list --json databaseId,conclusion"], "Read again runs it, though it is fresh");
    assert.deepEqual(await call(rows, "POST", `${p}/pause`, { paused: "yes" }), { status: 400, body: { error: "paused is true or false" } });
    assert.equal((await call(rows, "POST", `${p}/pause`, { paused: true })).body.space.dashboards[0].paused, true);
    assert.deepEqual(await call(rows, "POST", `${p}/read`, {}), { status: 409, body: { error: "it is paused: resume it to read it" } });
    await call(rows, "POST", `${p}/pause`, { paused: false });
    const gone = await call(rows, "DELETE", p);
    assert.deepEqual([gone.status, gone.body.space.dashboards, gone.body.space.gone.map((/** @type {any} */ g) => [g.name, g.keptV])], [200, [], [["deploys-ab12", 1]]]);
    const back = await call(rows, "POST", `${p}/back`);
    assert.deepEqual([back.status, back.body.space.dashboards.map((/** @type {any} */ d) => d.state), back.body.space.gone], [200, ["kept"], []]);
    assert.deepEqual(await call(rows, "POST", `${p}/back`), { status: 409, body: { error: "Deploys is not taken out of this Space." } });
    // One this Space does not show is refused, nothing written; another Space's kept one goes on reading.
    // (fails before: yes — found by the Hunter on S2: any name was written as taken out, and its reads stopped)
    assert.deepEqual(await call(rows, "DELETE", "/space/p1/dashboards/nope-zz99"), { status: 404, body: { error: 'There is no dashboard "nope-zz99" in this Space.' } });
    assert.throws(() => w.runner.change("p2", "deploys-ab12", { removed: true }), { status: 404, message: 'There is no dashboard "Deploys" in this Space.' });
    assert.deepEqual([w.spaces.get("p1").dashboards.map((d) => [d.name, d.state]), w.spaces.get("p2").dashboards], [[["deploys-ab12", "kept"]], []]);
    await call(rows, "DELETE", p);
    assert.deepEqual(await call(rows, "DELETE", p), { status: 404, body: { error: 'There is no dashboard "Deploys" in this Space.' } }, "taken out already: Add to this Space… puts it back");
    assert.deepEqual(await call(rows, "POST", "/space/p1/dashboards/deploys-ab12/pause", { paused: true }), { status: 409, body: { error: "Deploys is not kept in this Space: keep it first." } });
    const bare = routes(null);
    assert.deepEqual([(await call(bare, "GET", "/space/p1")).body.dashboards, (await call(bare, "GET", "/space/p1")).body.gone], [[], []]);
    assert.deepEqual(await call(bare, "POST", `${p}/keep`, { v: 1 }), { status: 503, body: { error: "dashboards are not wired in this Filament" } });
  });

  // S5a: Needs you kept by Filament (space-needs.test.js has its store and the page's arithmetic).
  // (fails before: yes — a watch could not say "to": "needs-you", and nothing wrote a row for a stopped source)
  test("Needs you through the runner and the routes: a watch's rows, a stopped source's row gone once it reads; Done, Not now, Bring back", async () => {
    const w = worldOf();
    // The page reads what is shown at its own clock: the world's is now.
    w.clock.at = Date.now();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS, watch: [{ ...DEPLOYS.watch[0], to: "needs-you" }] });
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "app", cwd: "/work/app" } : null) } },
      spaces: w.spaces,
      dashboards: w.runner,
    });
    const name = "deploys-ab12";
    assert.equal((await call(rows, "POST", `/space/p1/dashboards/${name}/keep`, { v: 1 })).status, 200);
    assert.deepEqual((await call(rows, "GET", "/space/p1")).body.needs, [], "the page is given its rows, none yet");
    // Its first look learns; the next brings seven new failures: five rows, the last saying how many more.
    const one = createDashboardRunner({ ...w.deps, firstMs: 1 });
    one.start();
    await until(() => Object.keys(w.spaces.get("p1").dashboards[0].seen).length === 1, "the first look");
    one.stop();
    const log = w.spaces.get("p1").log.length;
    w.answers.gh = { ok: true, out: ghRuns([10, 11, 12, 13, 14, 15, 16].map((id) => ({ id, c: "failure" }))) };
    const two = createDashboardRunner({ ...w.deps, firstMs: 1 });
    two.start();
    await until(() => w.spaces.get("p1").needs.length > 0, "the look that finds them");
    two.stop();
    let needs = (await call(rows, "GET", "/space/p1")).body.needs;
    assert.deepEqual(needs.map((/** @type {any} */ n) => [n.kind, n.text, n.state]), [
      ...[10, 11, 12, 13].map((r) => ["watch", `CI failed on main: run ${r}`, "open"]),
      ["watch", "CI failed on main: run 14 · and 2 more like it", "open"],
    ]);
    assert.deepEqual([needs[0].why, needs[0].dashboard, needs[0].title], ["a watch of Deploys: a new row of runs where status is failure", name, "Deploys"]);
    assert.equal(w.spaces.get("p1").log.length, log, "nothing in What happened");
    // Done, Not now and Bring back, each answering the Space; refusals in words.
    const at = (/** @type {number} */ i) => `/space/p1/needs/${needs[i].id}`;
    let r = await call(rows, "POST", at(0), { done: true });
    assert.deepEqual([r.status, r.body.row.state, r.body.space.needs[0].state], [200, "done", "done"]);
    r = await call(rows, "POST", at(1), { later: w.clock.at + 3_600_000 });
    assert.deepEqual([r.body.row.state, r.body.space.needs[1].state], ["later", "later"]);
    r = await call(rows, "POST", at(0), { back: true });
    // Brought back, it is the newest the trim knows of: the Space's list puts it last (the page orders by moment).
    assert.equal(r.body.space.needs.find((/** @type {any} */ n) => n.id === needs[0].id).state, "open");
    assert.deepEqual(await call(rows, "POST", at(2), { later: w.clock.at - 1 }), { status: 400, body: { error: "later is when it comes back: a moment within the next 8 days" } });
    assert.deepEqual(await call(rows, "POST", at(2), []), { status: 400, body: { error: "a JSON object is required: { done: true }, { later: <when it comes back> }, { back: true }, { discard: true }, { words } or, for an ask, { turnDown: true }" } });
    assert.deepEqual(await call(rows, "POST", "/space/p1/needs/n0", { done: true }), { status: 404, body: { error: 'There is no row "n0" in this Space\'s Needs you.' } });
    // A source that fails three times in a row stops: a row says so, in its words; it goes once Read again reads.
    w.answers.npx = { ok: false, error: "npx exited 1: You are not authenticated." };
    for (let i = 0; i < FAILS_TO_STOP; i++) await w.runner.read(name, 1, "deploys", { force: true });
    needs = (await call(rows, "GET", "/space/p1")).body.needs;
    assert.deepEqual(needs.filter((/** @type {any} */ n) => n.kind === "source").map((/** @type {any} */ n) => [n.text, n.why, n.source, n.state]), [
      ["Deploys stopped reading deploys: npx exited 1: You are not authenticated.", "a kept dashboard's source failed 3 times in a row", "deploys", "open"],
    ]);
    await w.runner.read(name, 1, "deploys", { force: true });
    assert.equal(w.spaces.get("p1").needs.filter((n) => n.kind === "source").length, 1, "a fourth failure is the same row");
    w.answers.npx = { ok: true, out: WRANGLER };
    r = await call(rows, "POST", `/space/p1/dashboards/${name}/read`, { source: "deploys" });
    assert.deepEqual(r.body.space.needs.filter((/** @type {any} */ n) => n.kind === "source"), [], "it read: its row goes with the Read again's answer");
    assert.equal(r.body.space.needs.length, 5, "the watch's rows stay");
  });

  // (fails before: yes — there was no Your Space: a project's Needs you was its Space's alone, a dashboard's tiles its tab's)
  test("Your Space through the routes: every project's rows with its project; At a glance as each tab says it, once switched on; the left bar's counts", async () => {
    const w = worldOf();
    w.clock.at = Date.now();
    w.publish({ type: "dashboard", title: "Deploys", ...DEPLOYS });
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "app", cwd: "/work/app" } : null) } },
      spaces: w.spaces,
      dashboards: w.runner,
    });
    const name = "deploys-ab12";
    // Simple by default (SG-D0): nothing kept, no Your Space. (`watchers`: the plan of 11-11, its w8 — a Space's
    // Watchers row in the left bar, beside Routines.)
    assert.deepEqual((await call(rows, "GET", "/spaces")).body, { open: {}, needs: {}, extended: false, next: null, own: [], back: {}, apps: {}, routines: {}, watchers: {} });
    // What runs by itself, every project's, for its Routines tab (S6); `listening`: how many watchers listen, for its
    // Watchers tab's head.
    assert.deepEqual((await call(rows, "GET", "/your-space")).body, { projects: [], needs: [], dashboards: {}, glance: [], runs: { head: "", listening: "", pausedSince: null, pausedBy: null, routines: [], watches: [] }, extended: false });
    assert.deepEqual(await call(rows, "POST", `/space/p1/dashboards/${name}/glance`, { on: true }), { status: 409, body: { error: "Deploys is not kept in this Space: keep it first." } });
    assert.equal((await call(rows, "POST", `/space/p1/dashboards/${name}/keep`, { v: 1 })).status, 200);
    assert.equal((await call(rows, "GET", "/spaces")).body.extended, true, "a kept dashboard: Your Space shows (S5-D6)");
    // (fails before: yes — the owner's idea of 10-29: a Space's apps are rows under its row in the left bar, which read
    // none) Each Space's apps, as its tabs drew them: what `tabOf` reads, no content.
    const apps = (await call(rows, "GET", "/spaces")).body.apps;
    assert.deepEqual(Object.keys(apps), ["p1"]);
    assert.deepEqual(apps.p1.map((/** @type {any} */ d) => [d.name, d.title, d.type, d.state, d.draft, d.paused, d.liveV, Object.keys(d.sources)]),
      [[name, "Deploys", "dashboard", "kept", false, false, 1, Object.keys(DEPLOYS.sources)]]);
    assert.deepEqual(Object.keys(apps.p1[0]).sort(), ["changed", "draft", "liveV", "name", "paused", "sources", "state", "title", "type", "v"]);
    // (fails before: yes — found reviewing: the bar asks at each Space's change, and each Space listed every artifact
    // again and read each one's content, its own or not) Two Spaces: the artifacts listed once; a Space reads no content
    // of an app none of its chats made.
    {
      let lists = 0;
      let files = 0;
      const store = /** @type {any} */ (w.deps.artifacts);
      const counted = new Proxy(store, { get: (t, k) => (k === "list" ? () => (lists++, t.list()) : k === "file" ? (/** @type {any[]} */ ...a) => (files++, t.file(...a)) : typeof t[k] === "function" ? t[k].bind(t) : t[k]) });
      const runner = createDashboardRunner({ ...w.deps, artifacts: counted });
      const two = spaceRoutes({
        config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
        memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" || id === "p2" ? { id, name: id, cwd: `/work/${id}` } : null) } },
        spaces: w.spaces,
        dashboards: runner,
      });
      assert.equal((await call(two, "POST", "/space/p2")).status, 200);
      lists = 0;
      const both = (await call(two, "GET", "/spaces")).body.apps;
      assert.deepEqual([Object.keys(both), lists], [["p1"], 1], "listed once for both");
      files = 0;
      assert.deepEqual([runner.shown("p2"), files], [[], 0], "none of its own: no content read");
      runner.stop?.();
    }
    const kept = (await call(rows, "GET", "/space/p1")).body.dashboards[0];
    assert.deepEqual([kept.glance, kept.statuses], [false, 2], "off until switched on; two status tiles read its own sources");
    assert.deepEqual((await call(rows, "GET", "/your-space")).body.glance, [], "At a glance holds none until one is switched on");
    const log = w.spaces.get("p1").log.length;
    let r = await call(rows, "POST", `/space/p1/dashboards/${name}/glance`, { on: true });
    assert.deepEqual([r.status, r.body.space.dashboards[0].glance], [200, true]);
    assert.equal(w.spaces.get("p1").log.length, log, "a view's choice: no line in What happened");
    assert.deepEqual(await call(rows, "POST", `/space/p1/dashboards/${name}/glance`, { on: "yes" }), { status: 400, body: { error: "on is true or false" } });
    // Asked, it reads what is older than its every; once read, each status tile in its tab's words.
    const first = (await call(rows, "GET", "/your-space")).body.glance[0];
    assert.deepEqual(first.tiles.map((/** @type {any} */ t) => [t.title, t.read, t.line]), [["Live now", false, null], ["CI on main", false, null]], "nothing read yet: Reading…");
    await until(() => w.runner.glance()[0].tiles.every((t) => t.read), "its sources read");
    // A Space of your own that shows p1 (HarnessV4_SpacesPlugins_Plan A7) has its kept dashboards' tiles, switched on or not.
    assert.deepEqual([w.runner.glance({ projects: new Set(["p1"]) }).map((g) => g.name), w.runner.glance({ projects: new Set(["p2"]) })], [[name], []]);
    let ys = (await call(rows, "GET", "/your-space")).body;
    assert.deepEqual(ys.projects, [{ id: "p1", name: "app", cwd: "/work/app" }]);
    assert.deepEqual(ys.glance, [{ project: "p1", name, title: "Deploys", paused: false, tiles: [
      { title: "Live now", from: "deploys", line: { title: "Live now", value: "7c1e", format: "number", words: "—", tone: "", at: Date.parse("2026-10-24T12:00:00Z") }, read: true, at: w.clock.at, stale: false, error: null },
      { title: "CI on main", from: "runs", line: { title: "CI on main", value: "failure", format: "number", words: "", tone: "bad", at: null }, read: true, at: w.clock.at, stale: false, error: null },
    ] }]);
    // A read that fails since: its last rows stand, stale, with why.
    w.answers.npx = { ok: false, error: "npx exited 1: You are not authenticated." };
    w.clock.at += 1000;
    await w.runner.read(name, 1, "deploys", { force: true });
    const stale = (await call(rows, "GET", "/your-space")).body.glance[0].tiles[0];
    assert.deepEqual([stale.line?.value, stale.stale, stale.error], ["7c1e", true, "npx exited 1: You are not authenticated."]);
    // Paused: it says so and reads nothing.
    await call(rows, "POST", `/space/p1/dashboards/${name}/pause`, { paused: true });
    const ran = w.ran.length;
    assert.deepEqual((await call(rows, "GET", "/your-space")).body.glance, [{ project: "p1", name, title: "Deploys", paused: true, tiles: [] }]);
    assert.equal(w.ran.length, ran);
    await call(rows, "POST", `/space/p1/dashboards/${name}/pause`, { paused: false });
    // Every project's rows, each with its project and its dashboards for their chips; a Space whose project the archive
    // does not know is left out; the left bar's counts, open rows alone.
    w.spaces.watchSaw("p1", name, "w0", { keys: ["1"], at: 1 }, ["CI failed on main: run 1"], "Deploys", { to: "needs-you", why: "a watch of Deploys" });
    w.spaces.keepDashboard("p9", { name: "gone-ef56", v: 1, grant: grantOf(DEPLOYS), title: "Gone" });
    w.spaces.watchSaw("p9", "gone-ef56", "w0", { keys: ["1"], at: 1 }, ["lost"], "Gone", { to: "needs-you", why: "a watch of Gone" });
    ys = (await call(rows, "GET", "/your-space")).body;
    assert.deepEqual(ys.needs.map((/** @type {any} */ n) => [n.project, n.text, n.state]), [["p1", "CI failed on main: run 1", "open"]]);
    assert.deepEqual(ys.dashboards, { p1: [{ name, title: "Deploys", state: "kept", paused: false }] });
    assert.deepEqual((await call(rows, "GET", "/spaces")).body.needs, { p1: 1 });
    // The tray's look: no At a glance, nothing read.
    w.clock.at += 10 * MIN;
    const before = w.ran.length;
    assert.deepEqual((await call(rows, "GET", "/your-space?glance=0")).body.glance, []);
    assert.equal(w.ran.length, before, "?glance=0 reads nothing");
  });

  // (fails before: yes — a dashboard had no buttons)
  test("a button through the routes: its sheet, its run answering the Space, Stop; refusals in their words", async () => {
    const w = worldOf();
    w.publish({ type: "dashboard", title: "Deploys", ...WITH_BUTTON });
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "app", cwd: "/work/app" } : null) } },
      spaces: w.spaces,
      dashboards: w.runner,
    });
    const d = "/space/p1/dashboards/deploys-ab12";
    const p = `${d}/actions/rollback`;
    assert.deepEqual(await call(rows, "POST", p, { key: "a" }), { status: 409, body: { error: "it is not kept in this Space: its buttons run once it is" } });
    const kept = await call(rows, "POST", `${d}/keep`, { v: 1 });
    assert.equal(kept.body.space.log.at(-1).text, "You kept “Deploys” in this Space: it runs 2 commands and 1 watch by itself, and 1 button when you press it.");
    await call(rows, "POST", `${d}/read`, {});
    assert.deepEqual(await call(rows, "POST", p, []), { status: 400, body: { error: "a JSON object is required: { key }, the row's key" } });
    const sheet = await call(rows, "POST", p, { key: "a" });
    assert.deepEqual([sheet.status, sheet.body.command, sheet.body.folder], [200, ["npx", "wrangler", "rollback", "3f2a", "--message", "{ask.why}", "--yes"], "/work/app"]);
    assert.deepEqual(await call(rows, "POST", `${p}/run`, { key: "a", ask: { why: "-x" } }), { status: 400, body: { error: "{ask.why} is “-x”: a value may not start with “-”" } });
    const ran = await call(rows, "POST", `${p}/run`, { key: "a", ask: { why: "broke" } });
    assert.deepEqual([ran.status, ran.body.done, ran.body.said, ran.body.space.log.at(-1).text],
      [200, true, "Rolled back to 3f2a", "You ran “Roll back to this…” on Deploys: npx wrangler rollback 3f2a --message broke --yes — Rolled back to 3f2a"]);
    // `check: { model }` asks for an agent's check (S5d) on the model the person chose — here none is wired, and the
    // answer says so; a check that names no model is refused before anything runs (the owner's word of 10-31).
    // (fails before: yes — the route took no check; then a check named no model)
    assert.deepEqual((await call(rows, "POST", `${p}/run`, { key: "a", ask: { why: "broke" }, check: { model: "brain-checker" } })).body.check, { error: "checks are not wired in this Filament" });
    for (const check of [true, "yes", { model: 7 }])
      assert.deepEqual(await call(rows, "POST", `${p}/run`, { key: "a", ask: { why: "broke" }, check }), { status: 400, body: { error: "choose the model the check runs on" } }, JSON.stringify(check));
    assert.equal((await call(rows, "POST", `${p}/run`, { key: "a", ask: { why: "broke" }, check: false })).body.check, undefined);
    assert.deepEqual(await call(rows, "POST", `${p}/stop`, {}), { status: 409, body: { error: "nothing of it is running" } });
  });
});

describe("the Space's words of its dashboards", () => {
  const NOW = Date.UTC(2026, 9, 24, 14, 20);
  /** A dashboard as the Space says it. @param {any} [o] @returns {import("../src/ui/harness/lib/space-dashboards.js").SpaceDashboard} */
  const dash = (o = {}) => ({
    name: "deploys-ab12", title: "Deploys", v: 1, state: "kept", keptV: 1, liveV: 1, draft: false, paused: false, keptAt: NOW - 15 * MIN,
    grant: grantOf(DEPLOYS), newest: grantOf(DEPLOYS), reads: { sources: DEPLOYS.sources, watch: DEPLOYS.watch, actions: {} }, looks: [null],
    sources: { deploys: { at: NOW - 40_000, error: null, errorAt: 0, fails: 0, stopped: false, rows: 2 }, runs: null }, updatedAt: NOW, ...o,
  });
  /** A moment as the words give it on this machine. @param {number} at */
  const clock = (at) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  // (fails before: yes — a Space had no tabs)
  test("a tab, its bar and its foot: live with its age; a draft dashed with Keep…; paused with Resume; a failure a red dot and its words", () => {
    assert.deepEqual(tabOf(dash(), NOW), { label: "Deploys", tip: "Live: v1, kept", draft: false, paused: false, fault: false, held: false });
    assert.deepEqual(barOf(dash(), NOW), { tone: "live", words: "Live · read 40 s ago", press: "refresh", see: null });
    assert.deepEqual(barOf(dash({ sources: { deploys: null } }), NOW), { tone: "live", words: "Live · not read yet", press: "refresh", see: null });
    assert.equal(footOf(dash(), NOW), `Reads deploys and runs by itself · v1, kept ${clock(NOW - 15 * MIN)}`);
    const draft = dash({ state: "draft", keptV: null, liveV: null, draft: true, grant: null, sources: {} });
    assert.deepEqual(tabOf(draft, NOW), { label: "Deploys · draft", tip: "A draft: nothing reads or runs until you keep it", draft: true, paused: false, fault: false, held: false });
    assert.deepEqual(barOf(draft, NOW), { tone: "draft", words: "Draft · sample rows the agent read · nothing reads or runs until you keep it", press: "keep", see: null });
    assert.equal(footOf(draft, NOW), "Would read deploys and runs by itself, once you keep it");
    const again = dash({ v: 3, liveV: 2, draft: true });
    assert.equal(tabOf(again, NOW).tip, "v3 changes what it reads, watches or runs: it is a draft until you keep it again");
    assert.equal(barOf(again, NOW).words, "Draft · v3 changes what it reads, watches or runs · v2's watches go on until you keep it");
    // Paused beside its draft: nothing goes on, kept again or not.
    // (fails before: yes — found by the Hunter on S2: the bar said v2's watches go on)
    const pausedDraft = dash({ v: 3, liveV: 2, draft: true, paused: true });
    assert.equal(barOf(pausedDraft, NOW).words, "Draft · v3 changes what it reads, watches or runs · paused: nothing of it runs, kept again or not, until you resume it");
    assert.equal(tabOf(pausedDraft, NOW).tip, "v3 changes what it reads, watches or runs: it is a draft until you keep it again; paused, nothing of it runs until you resume it");
    // Beside the draft, its live version: See v2 shows it reading, See v3 the draft again.
    assert.deepEqual(barOf(again, NOW).see, { to: "live", label: "See v2", tip: "v2 as it reads now, beside the draft" });
    assert.deepEqual(barOf(again, NOW, true), { tone: "live", words: "v2 · Live · read 40 s ago", press: "refresh", see: { to: "draft", label: "See v3", tip: "v3, the draft: it reads nothing until you keep it" } });
    assert.deepEqual([footOf(again, NOW), footOf(again, NOW, true)], ["Would read deploys and runs by itself, once you keep it", `Reads deploys and runs by itself · v2, kept ${clock(NOW - 15 * MIN)}`]);
    assert.equal(barOf(draft, NOW, true).see, null, "never kept: nothing beside it");
    assert.deepEqual([tabOf(dash({ paused: true }), NOW).label, barOf(dash({ paused: true }), NOW)], ["Deploys · paused", { tone: "paused", words: "Paused · nothing of it reads or runs", press: "resume", see: null }]);
    assert.equal(footOf(dash({ paused: true }), NOW), `Reads deploys and runs by itself once you resume it · v1, kept ${clock(NOW - 15 * MIN)}`, "paused, its foot says so too");
    const failing = dash({ sources: { deploys: { at: NOW - 12 * MIN, error: "npx exited 1: You are not authenticated.", errorAt: NOW - MIN, fails: 3, stopped: true, rows: 2 }, runs: { at: NOW - MIN, error: null, errorAt: 0, fails: 0, stopped: false, rows: 3 } } });
    assert.deepEqual(faultsOf(failing, NOW), [{
      source: "deploys",
      head: `Couldn't read deploys at ${clock(NOW - MIN)}`,
      said: "npx exited 1: You are not authenticated.",
      kept: `Showing what it read at ${clock(NOW - 12 * MIN)}. It stopped after 3 failures in a row: Read again runs it now. Its other source, runs, reads fine.`,
    }]);
    assert.deepEqual(tabOf(failing, NOW), { label: "Deploys", tip: `Couldn't read deploys at ${clock(NOW - MIN)}: npx exited 1: You are not authenticated.`, draft: false, paused: false, fault: true, held: false });
    assert.deepEqual(barOf(failing, NOW), { tone: "fault", words: `deploys not read since ${clock(NOW - 12 * MIN)}`, press: "refresh", see: null }, "by its own last good read");
    assert.equal(barOf(dash({ sources: { deploys: { at: 0, error: "no", errorAt: NOW, fails: 1, stopped: false, rows: 0 } } }), NOW).words, "deploys not read yet");
    assert.deepEqual(faultsOf(dash({ sources: { deploys: { at: NOW, error: "old", errorAt: NOW - MIN, fails: 0, stopped: false, rows: 1 } } }), NOW), [], "a good read after a failure: none");
    // A failing live version beside a newer draft: its tab's red dot and the bar say it, the draft shown or not.
    // (fails before: yes — found by the Hunter on S2: the dot, the words and the strip were all left out beside a draft)
    const failingBeside = dash({ ...failing, v: 3, liveV: 2, draft: true });
    assert.deepEqual(tabOf(failingBeside, NOW), { label: "Deploys · draft", tip: `Couldn't read deploys at ${clock(NOW - MIN)}: npx exited 1: You are not authenticated.`, draft: true, paused: false, fault: true, held: false });
    assert.deepEqual(barOf(failingBeside, NOW), { tone: "fault", words: `Draft · v3 changes what it reads, watches or runs · v2: deploys not read since ${clock(NOW - 12 * MIN)}`, press: "keep", see: { to: "live", label: "See v2", tip: "v2 as it reads now, beside the draft" } });
    assert.deepEqual(barOf(failingBeside, NOW, true).words, `v2 · deploys not read since ${clock(NOW - 12 * MIN)}`);
    assert.deepEqual([readsNow(failingBeside), readsNow({ ...failingBeside, paused: true }), readsNow(draft), readsNow(failing)], [true, false, false, true]);
    assert.equal(tabOf({ ...failingBeside, paused: true }, NOW).fault, false, "paused: nothing reads, nothing fails");
    assert.equal(barOf({ ...failingBeside, paused: true }, NOW).tone, "draft");
    // (fails before: yes — the Space Apps plan of 10-29: a broken version offered no way back) Back to: the version before
    // the one its tab shows — the draft, or its live one beside it —; none from a first.
    assert.deepEqual([backOf(failingBeside, false), backOf(failingBeside, true), backOf(dash({ v: 1 }), false), backOf(dash({ v: 2, liveV: null }), true)], [2, 1, null, 1]);
    // (fails before: yes — found reviewing the Space work: v6, Back's copy of v4, broken too, offered v5 — the broken one
    // it left — and two presses went to and fro)
    assert.deepEqual([backOf(dash({ v: 6, from: 4 }), false), backOf(dash({ v: 7, liveV: 6, liveFrom: 4, from: null }), true), backOf(dash({ v: 2, from: 1 }), false)], [3, 3, null]);
  });

  // (fails before: yes — nothing asked before a dashboard ran)
  test("the Keep sheet: each exact command, its folder, how often; each watch's rule and words; what is new since the Keep; what it drops", () => {
    assert.deepEqual(commandWords(["npx", "wrangler", "--message", "a b", "", 'say "x"']), 'npx wrangler --message "a b" "" "say \\"x\\""');
    const draft = dash({ state: "draft", grant: null, draft: true });
    assert.deepEqual(keepLines(draft, "H:\\work\\app"), {
      reads: [
        { source: "deploys", command: "npx wrangler deployments list --json", kind: "command", tool: null, host: "", headers: [], filament: "", folder: "H:\\work\\app", every: "every 2 min while you look at it", isNew: false },
        { source: "runs", command: "gh run list --json databaseId,conclusion", kind: "command", tool: null, host: "", headers: [], filament: "", folder: "H:\\work\\app", every: "every 2 min while you look at it; every 10 min otherwise, for its watch", isNew: false },
      ],
      tells: [{ rule: "A new row of runs where status is failure", says: "CI failed on main: run {row.run}", to: "What happened", every: "looks every 10 min, in the background", isNew: false }],
      presses: [],
      tools: [],
      gone: [],
      shows: [],
      secrets: [],
      hooks: [],
      changed: [],
      unrecorded: false,
    });
    const changed ={ ...DEPLOYS, sources: { deploys: { ...DEPLOYS.sources.deploys, every: "5m" } }, watch: [{ from: "deploys", changes: "version", says: "Production is now {row.version}" }] };
    const next = dash({ v: 2, draft: true, newest: grantOf(changed), reads: { sources: changed.sources, watch: changed.watch, actions: {} } });
    const lines = keepLines(next, "/w");
    assert.deepEqual(lines.reads.map((r) => [r.source, r.isNew, r.every]), [["deploys", true, "every 5 min while you look at it; every 10 min otherwise, for its watch"]]);
    assert.deepEqual(lines.tells.map((t) => [t.rule, t.says, t.isNew]), [["The first row's version of deploys changes", "Production is now {row.version}", true]]);
    assert.deepEqual(lines.gone, ["It no longer runs gh run list --json databaseId,conclusion", "It no longer watches: A new row of runs where status is failure"]);
    const may = keepLines(next, "/w", { kept: true });
    assert.deepEqual([may.reads.map((r) => r.source), may.reads.some((r) => r.isNew), may.gone, may.tells[0].says], [["deploys", "runs"], false, [], ""], "What it may do: the kept grant, nothing new");
    assert.equal(ruleWords({ from: "runs", rule: "new", column: "", match: {} }), "A new row of runs");
    assert.equal(ruleWords({ from: "d", rule: "new", column: "", match: { a: null, b: true } }), "A new row of d where a is empty and b is true");
  });

  // (fails before: yes — a dashboard had no buttons)
  test("the Keep sheet's Does when you press: each button's exact command, on which rows, what it asks, its checks; a changed one new, a dropped one said", () => {
    const draft = dash({ state: "draft", grant: null, draft: true, newest: grantOf(WITH_BUTTON), reads: { sources: DEPLOYS.sources, watch: DEPLOYS.watch, actions: WITH_BUTTON.actions } });
    assert.deepEqual(keepLines(draft, "H:\\work\\app").presses, [{
      name: "rollback",
      label: "Roll back to this…",
      command: 'npx wrangler rollback {row.version} --message {ask.why} --yes',
      tool: null,
      folder: "H:\\work\\app",
      rows: "On each row of deploys, except where version is 7c1e",
      asks: ["asks Why (goes in the deploy's message)"],
      checks: ["{row.version} must match ^[0-9a-f]{4}$"],
      second: "",
      isNew: false,
      effect: "writes",
      allowed: false,
    }]);
    // S3b: a button that asks for a second look says so — Filament's Reviewer, offered, never started by itself (the
    // owner's word of 10-31).
    const looked = { ...WITH_BUTTON, actions: { rollback: { ...ROLLBACK, secondLook: true } } };
    assert.equal(keepLines(dash({ state: "draft", grant: null, draft: true, newest: grantOf(looked), reads: { sources: DEPLOYS.sources, watch: DEPLOYS.watch, actions: looked.actions } }), "/w").presses[0].second,
      "offers a second look: Filament's Reviewer, which only reads, when you ask for one on its sheet, on the model you choose");
    const only = { ...WITH_BUTTON, actions: { rollback: { ...ROLLBACK, except: undefined, only: { message: "Add retry" }, ask: [{ name: "why", label: "Why", choices: ["broke", "slow"] }] } } };
    const kept = dash({ grant: grantOf(WITH_BUTTON), v: 2, draft: true, newest: grantOf(only), reads: { sources: DEPLOYS.sources, watch: DEPLOYS.watch, actions: only.actions } });
    const [b] = keepLines(kept, "/w").presses;
    assert.deepEqual([b.rows, b.asks, b.isNew], ["On the rows of deploys where message is Add retry", ["asks Why: one of broke, slow"], true]);
    const none = dash({ grant: grantOf(WITH_BUTTON), v: 2, draft: true, newest: grantOf(DEPLOYS) });
    assert.deepEqual(keepLines(none, "/w").gone, ["It no longer has the button rollback: npx wrangler rollback {row.version} --message {ask.why} --yes"]);
    assert.equal(keepLines(dash({ grant: grantOf(WITH_BUTTON), newest: grantOf(WITH_BUTTON), reads: { ...dash().reads, actions: WITH_BUTTON.actions } }), "/w").presses[0].isNew, false, "kept as it is: nothing new");
  });

  // (fails before: yes — the same)
  test("a press's sheet as it is typed: the sentence's first line its title, each field its answer or its name, the command as it will run, Run once each needed field is filled", () => {
    const look = { says: "Roll back app-api to 3f2a (Add retry)? Production serves it at once.", command: ["npx", "wrangler", "rollback", "3f2a", "--message", "{ask.why}", "--yes"], ask: [{ name: "why", required: true }] };
    assert.deepEqual(pressWords(look, { why: "" }), { title: "Roll back app-api to 3f2a (Add retry)?", rest: "Production serves it at once.", command: "npx wrangler rollback 3f2a --message ‹why› --yes", where: "in its project's folder", ready: false });
    assert.deepEqual(pressWords(look, { why: "the login broke" }), { title: "Roll back app-api to 3f2a (Add retry)?", rest: "Production serves it at once.", command: 'npx wrangler rollback 3f2a --message "the login broke" --yes', where: "in its project's folder", ready: true });
    assert.deepEqual(pressWords({ says: "Re-run run {ask.n}", command: ["gh"], ask: [{ name: "n", required: false }] }, {}), { title: "Re-run run ‹n›", rest: "", command: "gh", where: "in its project's folder", ready: true });
  });

  // (fails before: yes — the same)
  // Making one is ＋ New app's since 10-29 (test/app-starters.test.js).
  test("what fills the Start: fixing one, changing one — each names the project's Space and the dashboard", () => {
    assert.equal(fixWords(dash(), { source: "deploys", said: "npx exited 1: no." }, "app"),
      "The dashboard “Deploys” (artifact deploys-ab12) in app's Space couldn't read its source deploys: npx exited 1: no. Find out why, fix it, and publish its next version: ");
    assert.equal(changeWords(dash(), "app"), "Change the dashboard “Deploys” (artifact deploys-ab12) in app's Space, and publish its next version: ");
  });
});

describe("the page's words for a status tile", () => {
  const UI = join(dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "src", "ui");
  const uiText = (/** @type {string} */ p) => readFileSync(join(UI, ...p.split("/")), "utf8");
  /** @type {any} */
  const page = vm.runInNewContext(`${joinModules(TYPE_MODULES.dashboard.map(uiText)).replace(/\nstartDashboard\(\);\s*$/, "\n")}\n;({momentOf, agoWords, wordsOf, momentWords, asOfWords})`);
  // (fails before: yes — found at E35 S5a's live look: the header said "read 12:50:19 AM" where its Space said "00:49")
  test("the header's moments on the 24-hour clock, as the Space around it says them", () => {
    const night = new Date(2026, 9, 25, 0, 50, 19).getTime();
    assert.equal(page.momentWords(night), "00:50:19");
    assert.equal(page.momentWords(new Date(2026, 9, 24, 14, 5).getTime(), true), "Oct 24, 14:05");
    assert.equal(page.asOfWords(Date.now() - 1000).length, 5, "today: its time alone, HH:MM");
    assert.match(page.asOfWords(Date.now() - 1000), /^\d\d:\d\d$/);
  });
  // (fails before: yes — there was no status tile)
  test("a row's moment, written whole or as seconds or ms; how long ago; its words with the row's values", () => {
    const at = Date.UTC(2026, 9, 24, 12, 0);
    assert.deepEqual([page.momentOf("2026-10-24T12:00:00Z"), page.momentOf(at / 1000), page.momentOf(at), page.momentOf(String(at / 1000)), page.momentOf("soon"), page.momentOf(null)], [at, at, at, at, null, null]);
    assert.deepEqual([page.agoWords(at, at + 20_000), page.agoWords(at, at + 12 * MIN), page.agoWords(at, at + 3 * 3_600_000)], ["just now", "12 min ago", "3 h ago"]);
    assert.match(page.agoWords(at, at + 3 * 86_400_000), /^Oct 24$/);
    assert.equal(page.wordsOf("{message} · {nope}", { message: "Fix login" }), "Fix login · —");
    // Your Space's At a glance reads a row's moment as the page does (core/space-feeds.js, S5b).
    for (const v of ["2026-10-24T12:00:00Z", at / 1000, at, String(at / 1000), "soon", null, "", 12.5]) assert.equal(coreMomentOf(v), page.momentOf(v), String(v));
    // …and says its age and its "as of" in the tab's words.
    for (const ago of [20_000, 12 * MIN, 3 * 3_600_000, 3 * 86_400_000]) assert.equal(ysAgoWords(at, at + ago), page.agoWords(at, at + ago), String(ago));
    for (const back of [1000, 26 * 3_600_000]) assert.equal(ysAsOfWords(Date.now() - back, Date.now()), page.asOfWords(Date.now() - back), String(back));
  });

  // (fails before: yes — the page said its failure under the Space's card, and its stale rows looked fresh)
  test("in its Space's tab the page leaves a source's failure to the Space's card; stale rows say when, faint (pinned in the source)", () => {
    const app = uiText("harness/app.js");
    // Its asks go the Space page's way, its Tell the agent to the Start in the Space's own folder (11-04: no picker asks).
    assert.match(app, /dashboardFrame: \(name, title, cwd, onAct, _from, more = \{\}\) => \{\n\s+const tell = [^\n]*\n\s+const ask = more\.ask \|\| tell;\n(?:\s+\/\/[^\n]*\n)*\s+const frame = artifactFrame\(name, \{[^}]*within: "space", onAct, onStop: more\.onStop, app: more\.app, back: more\.back \}\);/);
    const frame = uiText("harness/artifact-frame.js");
    // Its addresses are read once the page has placed its artifacts (`artifactsPlaced`), each told where it stands.
    assert.match(frame, /const newestOf = \(\) => \(o\.within \? `\$\{artifactAddress\(name, port\)\}\?in=\$\{o\.within\}` : artifactAddress\(name, port\)\);/);
    assert.match(frame, /const versionOf = \(v\) => `\$\{versionAddress\(name, port, v\)\}\$\{o\.within \? `\?in=\$\{o\.within\}` : ""\}`;/);
    // Each load asks its address as it stands then (x52): Read again's reload keeps the version shown, and an older one's.
    assert.match(frame, /const targetNow = \(\) => \(shownV \? versionOf\(shownV\) : newestOf\(\)\);/, "Read again's reload keeps it, and an older version's");
    assert.match(frame, /showVersion\(v\) \{\n\s+shownV = v;\n\s+if \(placed\) show\(\);/);
    const dash = uiText("artifacts/dashboard.js");
    assert.match(dash, /const inSpace = !kept && new URLSearchParams\(location\.search\)\.get\("in"\) === "space";/);
    assert.match(dash, /fault\.hidden = inSpace \|\| !faults\.size;/);
    assert.match(dash, /body\.classList\.toggle\("is-stale", !!src\.asOf\);/);
    assert.match(uiText("artifacts/types.css"), /\.tile-body\.is-stale > :not\(\.tile-stale\) \{ opacity: 0\.55; \}/);
  });

  // (fails before: yes — a dashboard had no buttons)
  test("a table's buttons: on the rows only / except allow; off, each saying why — outside its Space's tab, a draft, paused, stale rows; a press only asks (pinned in the source)", () => {
    /** @type {any} */
    const p = vm.runInNewContext(`${joinModules(TYPE_MODULES.dashboard.map(uiText)).replace(/\nstartDashboard\(\);\s*$/, "\n")}\n;({onRow, pressOff, rowWords})`);
    assert.deepEqual([p.onRow(ROLLBACK, ROW_A), p.onRow(ROLLBACK, { ...ROW_A, version: "7c1e" }), p.onRow({ only: { status: "failure" } }, { status: "success" })], [true, false, false]);
    assert.deepEqual(
      [
        p.pressOff({ shown: true, live: true, inSpace: true }),
        p.pressOff({ shown: false, live: true, inSpace: false }),
        p.pressOff({ shown: true, live: true, inSpace: false }),
        p.pressOff({ shown: true, live: false, inSpace: true, off: "draft" }),
        p.pressOff({ shown: true, live: false, inSpace: true, off: "paused" }),
      ],
      [null, "Press it in its Space's tab: Filament asks there first", "Press it in its Space's tab: Filament asks there first", "Keep it first: its buttons run once it is kept", "It is paused: resume it to press its buttons"],
    );
    assert.deepEqual([...p.rowWords(["version", "message"], { version: "3f2a", message: null })], ["version: 3f2a", "message: —"]);
    const dash = uiText("artifacts/dashboard.js");
    assert.match(dash, /`Read it again first: these rows are \$\{Math\.max\(1, Math\.round\(\(Date\.now\(\) - asOf\) \/ 60_000\)\)\} min old`/);
    assert.match(dash, /if \(!why\) tell\(\{ kind: "act", action: name, key \}\);/, "a press only asks");
    const frame = uiText("harness/artifact-frame.js");
    assert.match(frame, /if \(o\.onAct && clickedIn\(frame\) && typeof m\.action === "string" && typeof m\.key === "string"\) o\.onAct\(/, "heard only right after a click in it");
  });
});

describe("a dashboard's button, with a second look (S3b)", () => {
  // (fails before: yes — a button's secondLook drew nothing)
  test("the Reviewer starts in the chat that made the version shown, told the command with the row's values, the sentence, the row and the others; why not, in words", async () => {
    const w = worldOf();
    /** @type {any[]} */
    const started = [];
    /** @type {any} */
    let answer = { ok: true, chain: "c1", agent: "sa-1" };
    let project = (/** @type {string} */ c) => (c.startsWith("c") ? "p1" : null);
    const lookModel = (/** @type {string} */ chain) => ({ model: `brain-of-${chain}`, why: "the first of its chat's models for agents that can run" });
    const runner = createDashboardRunner({ ...w.deps, projectOfChain: (c) => project(c), startLook: (o) => (started.push(o), answer), lookModel });
    const looked = { ...WITH_BUTTON, actions: { rollback: { ...ROLLBACK, secondLook: true }, plain: { ...ROLLBACK, label: "Plain…" } }, tiles: DEPLOYS.tiles.map((t) => (t.kind === "table" ? { ...t, actions: ["rollback", "plain"] } : t)) };
    w.publish({ type: "dashboard", title: "Deploys", ...looked });
    const name = "deploys-ab12";
    runner.keep("p1", name, 1);
    await runner.read(name, 1, "deploys");
    // Its sheet says who would look, where, and on what — the model the person may change before anything starts.
    const sheet = /** @type {any} */ (await runner.sheet("p1", name, "rollback", "a"));
    assert.deepEqual([sheet.secondLook, sheet.skeptic], [true, { chain: "c1", model: "brain-of-c1", why: "the first of its chat's models for agents that can run" }]);
    assert.equal(started.length, 0, "opening its sheet starts nothing");
    // The owner's word of 10-31: it starts only as the person asks, on the model they chose — named, or refused.
    assert.deepEqual(await runner.lookAt("p1", name, "rollback", "a", ""), { ok: false, status: 400, error: "choose the model the Reviewer runs on" });
    assert.equal(started.length, 0, "none chosen: nothing started");
    assert.deepEqual(await runner.lookAt("p1", name, "rollback", "a", "brain-skeptic"), { ok: true, chain: "c1", agent: "sa-1" });
    const o = started[0];
    assert.equal(o.model, "brain-skeptic", "on the model the person chose");
    assert.deepEqual([o.chainId, o.cwd, o.description, o.why], ["c1", "/work/app", "Second look: Roll back to this on Deploys", "you asked for a second look at the button “Roll back to this…” of the dashboard “Deploys”"]);
    assert.deepEqual([o.about.command, o.about.folder, o.about.why], ["npx wrangler rollback 3f2a --message {ask.why} --yes", "/work/app", o.why], "the row's values in, each field still its name");
    assert.deepEqual([o.about.button.label, o.about.button.dashboard, o.about.button.says], ["Roll back to this…", "Deploys", "Roll back app-api to 3f2a (Add retry)? Production serves it at once."]);
    assert.deepEqual(o.about.button.row, { when: ROW_A.when, version: "3f2a", message: "Add retry" }, "its columns, its key aside");
    assert.deepEqual(o.about.button.rows.map((/** @type {any} */ r) => r.version), ["7c1e"], "the source's other rows");
    assert.deepEqual(await runner.lookAt("p1", name, "plain", "a", "brain-skeptic"), { ok: false, status: 409, error: "Plain… asks for no second look" });
    assert.deepEqual(await runner.lookAt("p1", name, "rollback", "b", "brain-skeptic"), { ok: false, status: 409, error: "Roll back to this… is not on that row" }, "as its sheet would refuse it");
    assert.deepEqual(await runner.lookAt("p2", name, "rollback", "a", "brain-skeptic"), { ok: false, status: 409, error: "it is not kept in this Space: its buttons run once it is" });
    answer = { ok: false, error: "Reviewer is switched off" };
    assert.deepEqual(await runner.lookAt("p1", name, "rollback", "a", "brain-skeptic"), { ok: false, status: 409, error: "Reviewer is switched off" });
    project = () => null;
    assert.deepEqual(await runner.lookAt("p1", name, "rollback", "a", "brain-skeptic"), { ok: false, status: 409, error: "the chat that made Deploys is gone" });
    assert.equal(/** @type {any} */ (await runner.sheet("p1", name, "rollback", "a")).skeptic, null, "no chat to look in: no one offered");
    assert.equal(started.length, 2, "nothing started where it was refused first");
    const bare = createDashboardRunner(w.deps);
    await bare.read(name, 1, "deploys");
    assert.deepEqual(await bare.lookAt("p1", name, "rollback", "a", "brain-skeptic"), { ok: false, status: 409, error: "second looks are not wired in this Filament" });
  });
});

describe("a dashboard's button, checked by an agent (S5d)", () => {
  // HarnessV4_Space_Plan S5d, SG-D25: Run with check, done — the Reviewer in the chat that made the version, told what ran
  // and what it said, the row before and after, what its author said to look for; its verdict lands as it ends.
  // (fails before: yes — nothing checked what a button did)
  test("Run with check: told what ran, said, the rows before and after, verify filled; the verdict in What happened, a row in Needs you where it did not work", async () => {
    const w = worldOf();
    /** @type {any[]} */
    const started = [];
    /** @type {any} */
    let answer = { ok: true, chain: "c1", agent: "sa-1" };
    /** @type {Map<string, (end: any) => void>} */
    const ends = new Map();
    let project = (/** @type {string} */ c) => (c.startsWith("c") ? "p1" : null);
    const checks = {
      start: (/** @type {any} */ o) => (started.push(o), answer),
      ended: (/** @type {string} */ _c, /** @type {string} */ agent) => new Promise((r) => void ends.set(agent, r)),
    };
    const runner = createDashboardRunner({ ...w.deps, projectOfChain: (c) => project(c), checks });
    w.publish({ type: "dashboard", title: "Deploys", ...WITH_BUTTON, actions: { rollback: { ...ROLLBACK, verify: "{row.version} serves all traffic" } } });
    const name = "deploys-ab12";
    runner.keep("p1", name, 1);
    await runner.read(name, 1, "deploys");
    const sheet = /** @type {any} */ (await runner.sheet("p1", name, "rollback", "a"));
    assert.deepEqual([sheet.verify, sheet.checkOff], ["3f2a serves all traffic", ""], "its author's words, the row's values in");
    // Not asked: nothing starts.
    assert.equal(/** @type {any} */ (await runner.act("p1", name, "rollback", "a", { why: "x" })).check, undefined);
    assert.equal(started.length, 0);
    // The owner's word of 10-31: asked with no model chosen, it is refused before the button runs.
    const runs = w.acted.length;
    assert.deepEqual(await runner.act("p1", name, "rollback", "a", { why: "x" }, { check: { model: " " } }), { ok: false, status: 400, error: "choose the model the check runs on" });
    assert.deepEqual([w.acted.length, started.length], [runs, 0], "nothing ran, nothing started");
    const ran = /** @type {any} */ (await runner.act("p1", name, "rollback", "a", { why: "the login broke" }, { check: { model: "brain-checker" } }));
    assert.deepEqual([ran.done, ran.check], [true, { chain: "c1", agent: "sa-1" }]);
    const o = started[0];
    assert.equal(o.model, "brain-checker", "on the model the person chose");
    assert.deepEqual([o.chainId, o.cwd, o.description, o.why], ["c1", "/work/app", "Check: Roll back to this on Deploys", "you asked an agent to check what “Roll back to this” did on “Deploys”"]);
    assert.deepEqual([o.about.label, o.about.dashboard, o.about.says, o.about.ran, o.about.said, o.about.verify, o.about.folder],
      ["Roll back to this…", "Deploys", "Roll back app-api to 3f2a (Add retry)? Production serves it at once.", 'npx wrangler rollback 3f2a --message "the login broke" --yes', "Rolling back…\nRolled back to 3f2a\n", "3f2a serves all traffic", "/work/app"]);
    assert.deepEqual(o.about.before, { when: ROW_A.when, version: "3f2a", message: "Add retry" }, "its columns, its key aside");
    assert.deepEqual(o.about.after, o.about.before, "the same row, read again after");
    assert.deepEqual(o.about.rows.map((/** @type {any} */ r) => r.version), ["7c1e"], "the source's other rows, after");
    // It did not work: a line in What happened, and a row in Needs you with what ran and why.
    const doc = () => /** @type {any} */ (w.spaces.get("p1"));
    ends.get("sa-1")?.({ status: "done", report: "1. What it did: x\n2. What I checked: y\n3. Verdict: it did not work — 7c1e still serves", error: null });
    await until(() => doc().log.at(-1)?.text.startsWith("An agent checked"), "its verdict");
    assert.equal(doc().log.at(-1).text, "An agent checked “Roll back to this…” on Deploys: it did not work — 7c1e still serves");
    const row = doc().needs.at(-1);
    assert.deepEqual([row.kind, row.text, row.why, row.dashboard, row.title, row.state, row.check],
      ["check", "“Roll back to this…” on Deploys did not do what it was for", "an agent checked it: 7c1e still serves", name, "Deploys", "open",
        { label: "Roll back to this…", ran: 'npx wrangler rollback 3f2a --message "the login broke" --yes', said: "Rolled back to 3f2a", reason: "7c1e still serves" }]);
    assert.ok(w.heard.some(([t, p]) => t === "space" && p.project === "p1"), "the Space hears it");
    // It worked, or could not tell: a line alone. Stopped, or cut off: said so, no row.
    const rows = doc().needs.length;
    for (const [i, end, line] of /** @type {[number, any, string][]} */ ([
      [2, { status: "done", report: "3. Verdict: it worked — 3f2a serves 100%", error: null }, "An agent checked “Roll back to this…” on Deploys: it worked — 3f2a serves 100%"],
      [3, { status: "done", report: "I could not reach it.", error: null }, "An agent checked “Roll back to this…” on Deploys: it could not tell."],
      [4, { status: "stopped", report: "", error: null }, "You stopped the agent's check of “Roll back to this…” on Deploys."],
      [5, { status: "failed", report: "", error: "its model refused" }, "The agent's check of “Roll back to this…” on Deploys did not finish: its model refused"],
    ])) {
      answer = { ok: true, chain: "c1", agent: `sa-${i}` };
      await runner.act("p1", name, "rollback", "a", { why: "again" }, { check: { model: "brain-checker" } });
      ends.get(`sa-${i}`)?.(end);
      await until(() => doc().log.at(-1)?.text === line, line);
    }
    assert.equal(doc().needs.length, rows, "no row but where it did not work");
    // It failed: no check — its failure says it.
    w.ends.npx = { ok: false, error: "npx exited 1: Version 3f2a is not found", said: "" };
    const failed = /** @type {any} */ (await runner.act("p1", name, "rollback", "a", { why: "x" }, { check: { model: "brain-checker" } }));
    assert.deepEqual([failed.done, failed.check, started.length], [false, undefined, 5]);
    w.ends.npx = { ok: true, said: "ok\n" };
    // None could start: why, in words; the result stands.
    answer = { ok: false, error: "Reviewer is switched off" };
    assert.deepEqual(/** @type {any} */ (await runner.act("p1", name, "rollback", "a", { why: "x" }, { check: { model: "brain-checker" } })).check, { error: "Reviewer is switched off" });
    project = () => null;
    assert.equal(/** @type {any} */ (await runner.sheet("p1", name, "rollback", "a")).checkOff, "the chat that made Deploys is gone");
    assert.deepEqual(/** @type {any} */ (await runner.act("p1", name, "rollback", "a", { why: "x" }, { check: { model: "brain-checker" } })).check, { error: "the chat that made Deploys is gone" });
    const bare = createDashboardRunner(w.deps);
    await bare.read(name, 1, "deploys");
    assert.deepEqual(/** @type {any} */ (await bare.act("p1", name, "rollback", "a", { why: "x" }, { check: { model: "brain-checker" } })).check, { error: "checks are not wired in this Filament" });
  });

  // Found by the Hunter on S5d: a check under way at a restart never said anything (its end was awaited in memory alone),
  // and a source that could not be read again after the button handed the check the rows from before as "after".
  // (fails before: yes — nothing was kept under way, and the read's failure was ignored)
  test("a check a restart cut ends with its line; a source not read again after: the check is told so, no rows from before", async () => {
    const w = worldOf();
    let n = 0;
    /** @type {any[]} */
    const started = [];
    const checks = {
      start: (/** @type {any} */ o) => (started.push(o), { ok: /** @type {const} */ (true), chain: "c1", agent: `sa-${++n}` }),
      // Never ends here: the Filament that waited on it stops.
      ended: () => new Promise(() => {}),
    };
    const runner = createDashboardRunner({ ...w.deps, checks });
    w.publish({ type: "dashboard", title: "Deploys", ...WITH_BUTTON });
    const name = "deploys-ab12";
    runner.keep("p1", name, 1);
    await runner.read(name, 1, "deploys");
    const doc = () => /** @type {any} */ (w.spaces.get("p1"));
    await runner.act("p1", name, "rollback", "a", { why: "x" }, { check: { model: "brain-checker" } });
    assert.deepEqual(doc().checking.map((/** @type {any} */ c) => [c.agent, c.chain, c.dashboard, c.title, c.label, c.ran, c.said]),
      [["sa-1", "c1", name, "Deploys", "Roll back to this…", "npx wrangler rollback 3f2a --message x --yes", "Rolled back to 3f2a"]], "kept under way");
    // This Filament's start leaves the check it waits on.
    runner.start();
    runner.stop();
    assert.equal(doc().checking.length, 1, "its own check, still awaited, is no cut one");
    const lines = doc().log.length;
    // A restart: a runner that waits on none of them.
    const after = createDashboardRunner({ ...w.deps, checks });
    after.start();
    after.stop();
    assert.equal(doc().checking.length, 0);
    assert.deepEqual(doc().log.slice(lines).map((/** @type {any} */ e) => e.text), ["The agent's check of “Roll back to this…” on Deploys did not finish: Filament stopped before it ended"]);
    assert.equal(doc().needs.filter((/** @type {any} */ x) => x.kind === "check").length, 0, "no row: what the button did stays as it ran");
    assert.ok(w.heard.some(([t, p]) => t === "space" && p.project === "p1"), "the Space hears it");
    // Its source fails as it is read again after: the check is told so, and shown no rows.
    w.answers.npx = { ok: false, error: "npx exited 1: You are not authenticated." };
    await runner.act("p1", name, "rollback", "a", { why: "y" }, { check: { model: "brain-checker" } });
    const o = started.at(-1);
    assert.deepEqual([o.about.unread, o.about.after, o.about.rows], ["npx exited 1: You are not authenticated.", null, []]);
    assert.match(checkWords(o.about), /Its source could not be read again after it ran \(npx exited 1: You are not authenticated\.\): look for yourself, and where you cannot, say can't tell\./);
    assert.doesNotMatch(checkWords(o.about), /read again after:/, "no rows from before shown as after");
  });

  // Found by the Hunter on S5d: a read under way as the button ended may hold the rows from before it.
  // (fails before: yes — a read in flight was shared)
  test("the read after a button begins after it ended: one under way is waited for, then it reads anew", async () => {
    const w = worldOf();
    /** @type {((v: any) => void)[]} */
    const held = [];
    let reads = 0;
    const runner = createDashboardRunner({ ...w.deps, run: async () => (reads++, held.length < 1 ? new Promise((done) => held.push(done)) : { ok: true, out: WRANGLER }) });
    w.publish({ type: "dashboard", title: "Deploys", ...WITH_BUTTON });
    const name = "deploys-ab12";
    runner.keep("p1", name, 1);
    const first = runner.read(name, 1, "deploys", { force: true });
    await until(() => held.length === 1, "a read under way");
    const fresh = runner.read(name, 1, "deploys", { force: true, after: true });
    const shared = runner.read(name, 1, "deploys", { force: true });
    held[0]({ ok: true, out: WRANGLER });
    await Promise.all([first, fresh, shared]);
    assert.equal(reads, 2, "the one under way, then one of its own");
  });

  // (fails before: yes — a button had no verify)
  test("verify: a line of words, {row.<column>} of its source alone; no part of a Keep — a version that changes it alone is live at once", () => {
    const sources = { deploys: DEPLOYS.sources.deploys };
    const fault = (/** @type {any} */ verify) => dashboardOf({ ...WITH_BUTTON, actions: { rollback: { ...ROLLBACK, verify } } });
    for (const [verify, words] of /** @type {[any, string][]} */ ([
      [7, "has verify that is no line of words"],
      ["  ", "has verify that is no line of words"],
      ["x".repeat(301), "300 characters at most"],
      ["{ask.why} lands", "has {ask.why} in verify: it takes {row.<column>} alone"],
      ["{row.nope} serves", "has {row.nope} in verify, a column deploys does not have"],
    ])) {
      const r = /** @type {any} */ (fault(verify));
      assert.ok(!r.ok && r.error.includes(words), `${JSON.stringify(verify).slice(0, 40)}: ${r.ok ? "accepted" : r.error}`);
    }
    assert.ok(/** @type {any} */ (fault("{row.version} serves, {row.key} is first")).ok);
    assert.equal(actionKept({ ...ROLLBACK, verify: "  3f2a serves  " }).verify, "3f2a serves");
    assert.equal(actionKept(ROLLBACK).verify, "");
    const base = grantOf({ sources, actions: { rollback: ROLLBACK } });
    assert.ok(sameGrant(base, grantOf({ sources, actions: { rollback: { ...ROLLBACK, verify: "it serves" } } })), "words for a read-only agent: no part of a Keep");
  });
});
