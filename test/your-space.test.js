// @ts-check
// Your Space (HarnessV4_Space_Plan S5b): every project's Needs you in one place, beside the chats' asks, and At a
// glance — the status tiles of the dashboards you switch there, in their tabs' words. The store's side: the switch kept
// through Keep again, Remove and Put back, and from its file; every project's rows; the left bar's counts; when Your
// Space shows at all (SG-D0). A status tile's line as its tab says it.
// (fails before: yes — each project's Needs you was its Space's alone, and nothing showed a dashboard outside its tab)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grantOf } from "../src/core/dashboard-sources.js";
import { momentOf, statusLine } from "../src/core/space-feeds.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { FILTERS, FILTER_WORDS, filterCounts, glanceWords, headWords, needYouWords, shownValue, todayRows, yourCount } from "../src/ui/harness/lib/your-space.js";
import { parseRoute, routeFor, isScreen } from "../src/ui/harness/lib/router.js";
import { removeDirs } from "./helpers/wait.js";

const HOUR = 3_600_000;
const RUNS = {
  sources: { runs: { command: ["gh", "run", "list", "--json", "databaseId,conclusion"], key: "databaseId", columns: { run: "databaseId", status: "conclusion" } } },
  watch: [{ from: "runs", new: true, match: { status: "failure" }, says: "CI failed on main: run {row.run}", to: "needs-you" }],
};
const grant = grantOf(RUNS);
const WHY = "a watch of CI: a new row of runs where status is failure";

/** A Space store on the test's clock. @param {string | null} [dir] */
function storeOf(dir = null) {
  const clock = { at: Date.UTC(2026, 9, 25, 14, 0) };
  return { clock, store: createSpaceStore({ dir, now: () => clock.at }) };
}

test("At a glance's switch: off when kept, on and off with no line in What happened; kept through Keep again, Remove and Put back, and its file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-ys-"));
  try {
    const { store } = storeOf(dir);
    assert.throws(() => store.dashboardGlance("p1", "ci-ab12", true, "CI"), { status: 409, message: "CI is not kept in this Space: keep it first." });
    store.keepDashboard("p1", { name: "ci-ab12", v: 1, grant, title: "CI" });
    assert.equal(store.get("p1").dashboards[0].glance, undefined, "off until you switch it on (S5-D7)");
    const log = store.get("p1").log.length;
    assert.equal(store.dashboardGlance("p1", "ci-ab12", true, "CI").glance, true);
    assert.equal(store.get("p1").log.length, log, "a view's choice: nothing in What happened");
    // Kept again (a version that adds a source), it stays where you put it.
    store.keepDashboard("p1", { name: "ci-ab12", v: 2, grant, title: "CI" });
    assert.equal(store.get("p1").dashboards[0].glance, true);
    // Taken out and put back: as it was kept, the switch too.
    store.dashboardChange("p1", "ci-ab12", { removed: true, title: "CI", v: 2 });
    assert.equal(store.get("p1").dashboards[0].was?.glance, true);
    store.dashboardBack("p1", "ci-ab12", "CI");
    assert.equal(store.get("p1").dashboards[0].glance, true);
    // Read back from its file, the switch is there; switched off, it is gone from the record.
    assert.equal(storeOf(dir).store.get("p1").dashboards[0].glance, true);
    store.dashboardGlance("p1", "ci-ab12", false, "CI");
    assert.equal("glance" in store.get("p1").dashboards[0], false);
    assert.equal("glance" in storeOf(dir).store.get("p1").dashboards[0], false);
  } finally {
    await removeDirs(dir);
  }
});

test("every project's rows with its project; the left bar's open counts; Your Space shows once a Space keeps a dashboard or holds a row", () => {
  const { clock, store } = storeOf();
  assert.equal(store.extended(clock.at), false, "simple by default: no Your Space (SG-D0)");
  assert.deepEqual([store.needsAll(clock.at), store.needCounts(clock.at)], [[], {}]);
  store.keepDashboard("p1", { name: "ci-ab12", v: 1, grant, title: "CI" });
  assert.equal(store.extended(clock.at), true, "a kept dashboard: it shows (S5-D6)");
  store.keepDashboard("p2", { name: "ci-cd34", v: 1, grant, title: "API CI" });
  store.watchSaw("p1", "ci-ab12", "w0", { keys: ["1"], at: 1 }, ["CI failed on main: run 1", "CI failed on main: run 2"], "CI", { to: "needs-you", why: WHY });
  store.sourceStopped("p2", { dashboard: "ci-cd34", title: "API CI", source: "runs", error: "gh exited 1" });
  const [a, b] = store.get("p1").needs;
  store.needChange("p1", a.id, { done: true });
  store.needChange("p1", b.id, { later: clock.at + HOUR });
  assert.deepEqual(store.needsAll(clock.at).map((n) => [n.project, n.kind, n.state]), [["p1", "watch", "done"], ["p1", "watch", "later"], ["p2", "source", "open"]]);
  assert.deepEqual(store.needCounts(clock.at), { p2: 1 }, "open rows alone; a project with none is not named");
  // When the counts change by themselves: the row put off comes back in an hour; then the done one leaves in two days.
  // (fails before: yes — found by the Hunter on S5a: nothing said when, so the left bar's count stayed as it was)
  assert.equal(store.needsNext(clock.at), clock.at + HOUR);
  clock.at += 2 * HOUR;
  assert.deepEqual(store.needCounts(clock.at), { p1: 1, p2: 1 }, "a row put off whose moment came counts again");
  assert.equal(store.needsNext(clock.at), Date.UTC(2026, 9, 25, 14, 0) + 2 * 24 * HOUR, "the done one's two days");
  assert.deepEqual(store.needsAll(clock.at).find((n) => n.id === b.id)?.state, "open");
  // Every dashboard taken out: its rows still need a place, so Your Space stays.
  store.dashboardChange("p1", "ci-ab12", { removed: true, title: "CI", v: 1 });
  store.dashboardChange("p2", "ci-cd34", { removed: true, title: "API CI", v: 1 });
  assert.equal(store.extended(clock.at), true, "p1's rows stay: they say what happened");
  for (const n of store.get("p1").needs) if (n.state !== "done") store.needChange("p1", n.id, { done: true });
  clock.at += 3 * 24 * HOUR;
  assert.equal(store.extended(clock.at), false, "nothing kept, no row shown: Now is enough again");
});

test("a status tile's line as its tab says it: the first row or the last, its format, words, tone and moment", () => {
  const rows = [
    { version: "7c1e", message: "Fix login", when: "2026-10-24T12:00:00Z", status: "failure", ms: 1500 },
    { version: "3f2a", when: 1_761_300_000, status: "success", ms: 820 },
  ];
  const live = { kind: "status", title: "Live now", from: "deploys", field: "version", words: "{message}", age: "when" };
  assert.deepEqual(statusLine(live, rows), { title: "Live now", value: "7c1e", format: "number", words: "Fix login", tone: "", at: Date.parse("2026-10-24T12:00:00Z") });
  assert.deepEqual(statusLine({ ...live, row: "last" }, rows), { title: "Live now", value: "3f2a", format: "number", words: "—", tone: "", at: 1_761_300_000_000 });
  const ci = { kind: "status", title: "CI on main", from: "runs", field: "status", bad: { status: "failure" }, good: { status: "success" } };
  assert.deepEqual([statusLine(ci, rows)?.tone, statusLine({ ...ci, row: "last" }, rows)?.tone], ["bad", "good"]);
  assert.equal(statusLine(ci, [{ status: "cancelled" }])?.tone, "", "neither: no tone");
  // The tile's format: its own for that column, or its one format.
  assert.equal(statusLine({ ...ci, field: "ms", format: "ms" }, rows)?.format, "ms");
  assert.equal(statusLine({ ...ci, field: "ms", format: { ms: "seconds" } }, rows)?.format, "seconds");
  assert.deepEqual(statusLine({ ...ci, field: "nope" }, rows)?.value, null, "no value: the page says —");
  assert.equal(statusLine(ci, []), null, "no row: nothing to say");
  assert.deepEqual([momentOf("soon"), momentOf(null), momentOf("1761300000")], [null, null, 1_761_300_000_000]);
});

// The page's arithmetic (ui/harness/lib/your-space.js): Today's order and its filters, the head's line, the left bar's
// count, At a glance's words.
test("Today's rows: the chats' asks, then what fails, then a watch's, the newest first in each; each in one filter", () => {
  const ask = (/** @type {string} */ tone, /** @type {number} */ at) => /** @type {any} */ ({ key: `chat:${tone}${at}`, tone, at });
  const kept = (/** @type {string} */ kind, /** @type {number} */ at) => /** @type {any} */ ({ id: `${kind}${at}`, kind, at, project: "p1" });
  const rows = todayRows([ask("asks", 5), ask("error", 7), ask("asks", 9)], [kept("watch", 8), kept("source", 3), kept("watch", 10)]);
  assert.deepEqual(rows.map((r) => [r.filter, r.kind === "chat" ? r.row.key : r.need.id]), [
    ["chats", "chat:asks9"], ["chats", "chat:asks5"],
    ["failing", "chat:error7"], ["failing", "source3"],
    ["news", "watch10"], ["news", "watch8"],
  ]);
  assert.deepEqual(filterCounts(rows), { all: 6, chats: 2, drafts: 0, failing: 2, news: 2 });
  assert.deepEqual(FILTERS, ["all", "chats", "drafts", "failing", "news"]);
  assert.deepEqual(todayRows([], []), []);
  // A check that says a button did not work fails (S5d).
  // (fails before: yes — a check's row would have gone to a watch's finds)
  assert.deepEqual(todayRows([], [kept("watch", 8), kept("check", 4)]).map((r) => [r.filter, r.kind === "kept" ? r.need.id : ""]), [["failing", "check4"], ["news", "watch8"]]);
  // A routine's failed run (S6) and a reproduction (S7) are failures too, as a project's Space ranks them.
  // (fails before: yes — both went to a watch's finds, found by the Hunter on S6)
  assert.deepEqual(todayRows([], [kept("watch", 9), kept("routine", 4), kept("repro", 6)]).map((r) => [r.filter, r.kind === "kept" ? r.need.id : ""]), [["failing", "repro6"], ["failing", "routine4"], ["news", "watch9"]]);
});

// (fails before: yes — every row of a watcher was a failure: a guidance held for your Send it and what a watcher told
// you stood under Failing with its failed run, and the filter of what a dashboard's watch brought said Watches, which
// reads as the watchers')
test("a watcher's rows go by what each is: a held guidance waits with the drafts, what it told you is news with a watch's finds, its failed run fails", () => {
  const kept = (/** @type {string} */ id, /** @type {string} */ kind, /** @type {number} */ at, /** @type {Record<string, any>} */ routine = {}) =>
    /** @type {any} */ ({ id, kind, at, project: "p1", ...(kind === "routine" ? { routine: { id: "r1", chain: "", watcher: true, ...routine } } : {}) });
  const guide = { id: "g1", to: "c2", name: "Build the login flow", text: "Add the header." };
  const rows = todayRows([], [kept("failed", "routine", 1), kept("told", "routine", 2, { told: 3, heard: "a commit on main" }), kept("held", "routine", 3, { guide }), kept("found", "watch", 4), kept("draft", "draft", 5)]);
  assert.deepEqual(rows.map((r) => [r.filter, r.kind === "kept" ? r.need.id : ""]), [["drafts", "draft"], ["drafts", "held"], ["failing", "failed"], ["news", "found"], ["news", "told"]]);
  assert.deepEqual(filterCounts(rows), { all: 5, chats: 0, drafts: 2, failing: 1, news: 2 });
  assert.deepEqual(FILTERS.map((f) => FILTER_WORDS[f]), ["All", "Chats", "Drafts", "Failing", "News"]);
});

test("the head's line, the left bar's count: the day, how many need you, how many work", () => {
  assert.equal(headWords(new Date(2026, 9, 25, 10, 0).getTime(), 6, 2), "Sunday 25 October · 6 need you · 2 working");
  assert.equal(headWords(new Date(2026, 9, 25, 10, 0).getTime(), 1, 0), "Sunday 25 October · 1 needs you");
  assert.equal(headWords(new Date(2026, 9, 25, 10, 0).getTime(), 0, 0), "Sunday 25 October");
  assert.deepEqual([needYouWords(0), needYouWords(1), needYouWords(6)], ["", "1 needs you", "6 need you"]);
  assert.equal(yourCount(2, { p1: 3, p2: 1 }), 6, "the chats' and every project's open rows");
  assert.equal(yourCount(0, {}), 0);
});

test("At a glance's words, as the tab says them: a value in its format, the words and age under it; why none shows", () => {
  const now = Date.UTC(2026, 9, 25, 14, 0);
  const line = (/** @type {any} */ o) => ({ title: "t", value: null, format: "number", words: "", tone: "", at: null, ...o });
  assert.deepEqual([shownValue(line({ value: 0.42, format: "percent" })), shownValue(line({})), shownValue(line({ value: "" })), shownValue(line({ value: "failure" })), shownValue(line({ value: "2026-10-16", format: "date" })), shownValue(line({ value: "7", format: "text" }))],
    ["42%", "—", "—", "failure", "2026-10-16", "7"], "a number in its format; a day, a moment or words as written");
  const tile = (/** @type {any} */ o) => ({ title: "Live now", from: "deploys", line: null, read: true, at: now, stale: false, error: null, ...o });
  assert.deepEqual(glanceWords(tile({ line: line({ value: "7c1e", format: "text", words: "Fix login", at: now - 12 * 60_000 }) }), now), { value: "7c1e", tone: "", under: "Fix login · 12 min ago", faint: "" });
  const stale = glanceWords(tile({ line: line({ value: "failure", tone: "bad" }), stale: true, at: now - 60_000 }), now);
  assert.deepEqual([stale.value, stale.tone, stale.under], ["failure", "bad", ""]);
  assert.match(stale.faint, /^as of \d\d:\d\d$/);
  assert.deepEqual(glanceWords(tile({ read: false, error: "gh exited 4: not logged in." }), now), { value: "", tone: "bad", under: "Couldn't read deploys: gh exited 4: not logged in.", faint: "" });
  assert.deepEqual(glanceWords(tile({}), now), { value: "", tone: "", under: "No rows yet.", faint: "" });
  assert.deepEqual(glanceWords(tile({ read: false }), now), { value: "", tone: "", under: "Reading…", faint: "" });
});

test("its address: #/your-space, a full-frame screen", () => {
  assert.deepEqual(parseRoute("#/your-space"), { kind: "your-space" });
  assert.equal(routeFor("your-space"), "#/your-space");
  assert.ok(isScreen("your-space"));
});
