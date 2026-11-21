// @ts-check
// A project's Needs you that Filament keeps (HarnessV4_Space_Plan S5a, SG-D10): the rows a kept dashboard's watch
// brings and a source that stopped, kept on the server beside the Space; Done, Not now and Bring back, each the
// other's way back; its limits; read back from its file; what the page is given. The page's own arithmetic of them:
// its groups, Not now's choices, when a row comes back, a row's dashboard chip; a row's why in the Keep sheet's words.
// (fails before: yes — Needs you held the chats' rows alone, and a watch wrote only in What happened)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NEEDS_DONE_SHOWN_MS, SPACE_LIMITS, needsShown } from "../src/core/space.js";
import { grantOf, watchKept, watchRuleWords } from "../src/core/dashboard-sources.js";
import { LATER_MAX_MS, createSpaceStore } from "../src/services/spaces.js";
import { ruleWords } from "../src/ui/harness/lib/space-dashboards.js";
import { handWords, needChip, needGroups, notNowChoices, resultWords, untilWords } from "../src/ui/harness/lib/space-view.js";
import { removeDirs } from "./helpers/wait.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A dashboard of CI runs whose watch writes in Needs you. */
const RUNS = {
  sources: { runs: { command: ["gh", "run", "list", "--json", "databaseId,conclusion"], key: "databaseId", columns: { run: "databaseId", status: "conclusion" } } },
  watch: [{ from: "runs", new: true, match: { status: "failure" }, says: "CI failed on main: run {row.run}", to: "needs-you" }],
};
const grant = grantOf(RUNS);
const WHY = "a watch of CI: a new row of runs where status is failure";

/** A Space store on a clock of the test's, with the dashboard kept in p1. @param {string | null} [dir] */
function storeOf(dir = null) {
  const clock = { at: Date.UTC(2026, 9, 24, 14, 0) };
  const store = createSpaceStore({ dir, now: () => clock.at });
  store.keepDashboard("p1", { name: "ci-ab12", v: 1, grant, title: "CI" });
  return { clock, store };
}

test("a watch to needs-you writes a row each, not a line in What happened; the last says how many more; none once it is out", () => {
  const { clock, store } = storeOf();
  const log = store.get("p1").log.length;
  store.watchSaw("p1", "ci-ab12", "w0", { keys: ["10"], at: 5 }, ["CI failed on main: run 10", "CI failed on main: run 11", "… and 2 more like it"], "CI", { to: "needs-you", why: WHY, more: 2 });
  const doc = store.get("p1");
  assert.equal(doc.log.length, log, "one thing, one look (S5-D1)");
  assert.deepEqual(doc.dashboards[0].seen.w0, { keys: ["10"], at: 5 }, "what it saw kept as for What happened");
  const at = clock.at;
  assert.deepEqual(doc.needs.map(({ id: _id, ...n }) => n), [
    { kind: "watch", text: "CI failed on main: run 10", why: WHY, dashboard: "ci-ab12", title: "CI", watch: "w0", at, state: "open" },
    { kind: "watch", text: "CI failed on main: run 11 · and 2 more like it", why: WHY, dashboard: "ci-ab12", title: "CI", watch: "w0", at, state: "open" },
  ]);
  assert.equal(new Set(doc.needs.map((n) => n.id)).size, 2, "each row its own id");
  // To What happened, as before.
  store.watchSaw("p1", "ci-ab12", "w0", { keys: ["12"], at: 6 }, ["CI failed on main: run 12"], "CI");
  assert.deepEqual([store.get("p1").needs.length, store.get("p1").log.at(-1)?.text], [2, "CI failed on main: run 12"]);
  store.dashboardChange("p1", "ci-ab12", { removed: true, title: "CI", v: 1 });
  store.watchSaw("p1", "ci-ab12", "w0", { keys: ["13"], at: 7 }, ["late"], "CI", { to: "needs-you", why: WHY });
  assert.equal(store.get("p1").needs.length, 2, "nothing written once it is out; its rows stay: they say what happened");
});

test("a stopped source: one row, the newest words; gone once it reads well; a paused or removed dashboard's goes with it", () => {
  const { clock, store } = storeOf();
  const stop = (/** @type {string} */ error) => store.sourceStopped("p1", { dashboard: "ci-ab12", title: "CI", source: "runs", error });
  stop("gh exited 1: HTTP 401");
  clock.at += 10 * 60_000;
  stop("gh exited 1: HTTP 403");
  const rows = store.get("p1").needs;
  assert.deepEqual(rows.map(({ id: _id, ...n }) => n), [
    { kind: "source", text: "CI stopped reading runs: gh exited 1: HTTP 403", why: "a kept dashboard's source failed 3 times in a row", dashboard: "ci-ab12", title: "CI", source: "runs", at: clock.at, state: "open" },
  ]);
  store.sourceRead("p1", "ci-ab12", "other");
  assert.equal(store.get("p1").needs.length, 1, "another source's read leaves it");
  store.sourceRead("p1", "ci-ab12", "runs");
  assert.deepEqual(store.get("p1").needs, [], "it said a state, now past");
  // One done stays done, and the next stop is a row of its own.
  stop("gh exited 1: HTTP 401");
  store.needChange("p1", store.get("p1").needs[0].id, { done: true });
  store.sourceRead("p1", "ci-ab12", "runs");
  stop("gh exited 1: HTTP 500");
  assert.deepEqual(store.get("p1").needs.map((n) => [n.state, n.text]), [["done", "CI stopped reading runs: gh exited 1: HTTP 401"], ["open", "CI stopped reading runs: gh exited 1: HTTP 500"]]);
  store.watchSaw("p1", "ci-ab12", "w0", { keys: ["1"], at: 1 }, ["CI failed on main: run 1"], "CI", { to: "needs-you", why: WHY });
  // Paused: nothing reads, so its stopped row goes; the watch's row and the done one stay.
  store.dashboardChange("p1", "ci-ab12", { paused: true, title: "CI" });
  assert.deepEqual(store.get("p1").needs.map((n) => [n.kind, n.state]), [["source", "done"], ["watch", "open"]]);
  store.dashboardChange("p1", "ci-ab12", { paused: false, title: "CI" });
  stop("gh exited 1: HTTP 500");
  store.dashboardChange("p1", "ci-ab12", { removed: true, title: "CI", v: 1 });
  assert.deepEqual(store.get("p1").needs.map((n) => [n.kind, n.state]), [["source", "done"], ["watch", "open"]], "taken out: the same");
  stop("gh exited 1: HTTP 500");
  assert.equal(store.get("p1").needs.length, 2, "no row for one no longer kept");
});

test("Done, Not now and Bring back: each the other's way back; a moment out of reach and a row not there refused in words", () => {
  const { clock, store } = storeOf();
  store.watchSaw("p1", "ci-ab12", "w0", { keys: ["1"], at: 1 }, ["CI failed on main: run 1"], "CI", { to: "needs-you", why: WHY });
  const id = store.get("p1").needs[0].id;
  clock.at += 60_000;
  assert.deepEqual([store.needChange("p1", id, { done: true })].map((n) => [n.state, n.doneAt, n.until]), [["done", clock.at, undefined]]);
  assert.deepEqual([store.needChange("p1", id, { back: true })].map((n) => [n.state, n.doneAt, n.until]), [["open", undefined, undefined]]);
  const later = clock.at + 18 * HOUR;
  assert.deepEqual([store.needChange("p1", id, { later })].map((n) => [n.state, n.until]), [["later", later]]);
  assert.deepEqual([store.needChange("p1", id, { done: true })].map((n) => [n.state, n.until]), [["done", undefined]], "done from later");
  assert.deepEqual([store.needChange("p1", id, { later })].map((n) => [n.state, n.doneAt]), [["later", undefined]], "later from done");
  const no = { status: 400, message: "later is when it comes back: a moment within the next 8 days" };
  assert.throws(() => store.needChange("p1", id, { later: clock.at }), no);
  assert.throws(() => store.needChange("p1", id, { later: clock.at + LATER_MAX_MS + 1 }), no);
  assert.throws(() => store.needChange("p1", id, { later: /** @type {any} */ ("soon") }), no);
  assert.ok(store.needChange("p1", id, { later: clock.at + LATER_MAX_MS }), "8 days is within reach: Monday 09:00 from a Sunday's first minute");
  assert.throws(() => store.needChange("p1", id, {}), { status: 400, message: "say what to do: { done: true }, { later: <when it comes back> }, { back: true } — and for a draft { discard: true } or { words }" });
  assert.throws(() => store.needChange("p1", "n999", { done: true }), { status: 404, message: 'There is no row "n999" in this Space\'s Needs you.' });
});

test("its limits: past 100 open the oldest go to Done today, done now — a draft discarded —; past 200 done the oldest go", () => {
  const { clock, store } = storeOf();
  const batch = (/** @type {number} */ b) => {
    clock.at += HOUR;
    store.watchSaw("p1", "ci-ab12", "w0", { keys: [], at: 1 }, Array.from({ length: 100 }, (_, i) => `run ${b}-${i}`), "CI", { to: "needs-you", why: WHY });
  };
  batch(1);
  assert.deepEqual([SPACE_LIMITS.needs, SPACE_LIMITS.needsDone], [100, 200]);
  assert.equal(store.get("p1").needs.length, 100);
  batch(2);
  let rows = store.get("p1").needs;
  assert.deepEqual([rows.filter((n) => n.state === "open").length, rows.filter((n) => n.state === "done").length], [100, 100]);
  // (fails before: yes — found by the Hunter on S2: done at the moment each came, an older day's rows were gone from
  // sight, Done today's Bring back included)
  assert.ok(rows.filter((n) => n.state === "done").every((n) => n.text.startsWith("run 1-") && n.doneAt === clock.at && n.at < clock.at), "the oldest, done now: in Done today");
  batch(3);
  batch(4);
  rows = store.get("p1").needs;
  assert.deepEqual([rows.filter((n) => n.state === "open").length, rows.filter((n) => n.state === "done").length], [100, 200]);
  assert.ok(rows.every((n) => !n.text.startsWith("run 1-")), "the oldest done went");
  assert.equal(new Set(rows.map((n) => n.id)).size, 300, "each its own id");
});

test("read back from its file as it was; what is no row is dropped; one put off with no moment is open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-needs-"));
  try {
    const { clock, store } = storeOf(dir);
    store.watchSaw("p1", "ci-ab12", "w0", { keys: ["1"], at: 1 }, ["CI failed on main: run 1", "CI failed on main: run 2"], "CI", { to: "needs-you", why: WHY });
    store.sourceStopped("p1", { dashboard: "ci-ab12", title: "CI", source: "runs", error: "HTTP 401" });
    const [a, b] = store.get("p1").needs;
    store.needChange("p1", a.id, { later: clock.at + HOUR });
    store.needChange("p1", b.id, { done: true });
    assert.deepEqual(createSpaceStore({ dir, now: () => clock.at }).get("p1").needs, store.get("p1").needs);
    const file = join(dir, "p1.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.needs.push({ id: "x1", kind: "mail", text: "t", dashboard: "d" }, { id: "x2", kind: "watch", dashboard: "d" }, { id: "x3", kind: "watch", text: "t", dashboard: "d", state: "later", at: 4 });
    writeFileSync(file, JSON.stringify(doc));
    const back = createSpaceStore({ dir, now: () => clock.at }).get("p1").needs;
    assert.deepEqual(back.map((n) => [n.id, n.state]), [[a.id, "later"], [b.id, "done"], [store.get("p1").needs[2].id, "open"], ["x3", "open"]]);
    assert.deepEqual(back[3], { id: "x3", kind: "watch", text: "t", why: "", dashboard: "d", title: "d", at: 4, state: "open" });
  } finally {
    await removeDirs(dir);
  }
});

// HarnessV4_Space_Plan S5d: an agent's check, ended — its verdict in What happened; where it did not work, a row in
// Needs you with what ran and why, read back from its file as it was; a check's row with nothing of its check is dropped.
// (fails before: yes — there were no checks)
test("a check's verdict: a line each way; a row where it did not work, kept in its file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-needs-"));
  try {
    const { clock, store } = storeOf(dir);
    const base = { dashboard: "ci-ab12", title: "CI", label: "Re-run…", ran: "gh run rerun 8812", said: "✓ Requested" };
    store.checkSaid("p1", { ...base, verdict: "worked", reason: "run 8812 is queued again" });
    store.checkSaid("p1", { ...base, verdict: "unclear", reason: "" });
    store.checkSaid("p1", { ...base, verdict: "none", reason: "", stopped: true });
    store.checkSaid("p1", { ...base, verdict: "none", reason: "its model refused" });
    assert.equal(store.get("p1").needs.length, 0, "no row but where it did not work");
    store.checkSaid("p1", { ...base, verdict: "failed", reason: "run 8812\n still says failure" });
    // Its words name the dashboard: by Filament alone, no "CI:" before them (seen live).
    assert.deepEqual(store.get("p1").log.slice(-5).map((e) => [e.text, e.by]), [
      ["An agent checked “Re-run…” on CI: it worked — run 8812 is queued again", { kind: "filament" }],
      ["An agent checked “Re-run…” on CI: it could not tell.", { kind: "filament" }],
      ["You stopped the agent's check of “Re-run…” on CI.", { kind: "filament" }],
      ["The agent's check of “Re-run…” on CI did not finish: its model refused", { kind: "filament" }],
      ["An agent checked “Re-run…” on CI: it did not work — run 8812 still says failure", { kind: "filament" }],
    ]);
    const { id: _id, ...row } = /** @type {any} */ (store.get("p1").needs[0]);
    assert.deepEqual(row, { kind: "check", text: "“Re-run…” on CI did not do what it was for", why: "an agent checked it: run 8812 still says failure", dashboard: "ci-ab12", title: "CI",
      check: { label: "Re-run…", ran: "gh run rerun 8812", said: "✓ Requested", reason: "run 8812 still says failure" }, at: clock.at, state: "open" });
    assert.deepEqual(createSpaceStore({ dir, now: () => clock.at }).get("p1").needs, store.get("p1").needs, "read back as it was");
    const file = join(dir, "p1.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.needs.push({ id: "x1", kind: "check", text: "t", dashboard: "d" });
    writeFileSync(file, JSON.stringify(doc));
    assert.equal(createSpaceStore({ dir, now: () => clock.at }).get("p1").needs.length, 1, "a check's row with nothing of its check is dropped");
  } finally {
    await removeDirs(dir);
  }
});

test("what the page is given: a row put off whose moment came is open; one done more than 2 days ago is not given", () => {
  const now = Date.UTC(2026, 9, 24, 14, 0);
  /** @type {import("../src/core/space.js").NeedRow[]} */
  const needs = [
    { id: "n1", kind: "watch", text: "a", why: "", dashboard: "d", title: "D", at: 1, state: "open" },
    { id: "n2", kind: "watch", text: "b", why: "", dashboard: "d", title: "D", at: 1, state: "later", until: now },
    { id: "n3", kind: "watch", text: "c", why: "", dashboard: "d", title: "D", at: 1, state: "later", until: now + 1 },
    { id: "n4", kind: "watch", text: "d", why: "", dashboard: "d", title: "D", at: 1, state: "done", doneAt: now - NEEDS_DONE_SHOWN_MS },
    { id: "n5", kind: "watch", text: "e", why: "", dashboard: "d", title: "D", at: 1, state: "done", doneAt: now - NEEDS_DONE_SHOWN_MS - 1 },
  ];
  const shown = needsShown(needs, now);
  assert.deepEqual(shown.map((n) => [n.id, n.state, n.until]), [["n1", "open", undefined], ["n2", "open", undefined], ["n3", "later", now + 1], ["n4", "done", undefined]]);
  assert.equal(needs[1].state, "later", "the kept row is not changed by a look");
});

test("a row's why says its watch's rule as the Keep sheet does", () => {
  /** @param {any} w */
  const both = (w) => {
    const k = watchKept(w);
    const page = ruleWords(k);
    return [watchRuleWords(k), page[0].toLowerCase() + page.slice(1)];
  };
  const a = both(RUNS.watch[0]);
  assert.equal(a[0], "a new row of runs where status is failure");
  assert.equal(a[0], a[1]);
  const b = both({ from: "deploys", changes: "version", says: "x" });
  assert.equal(b[0], "the first row's version of deploys changes");
  assert.equal(b[0], b[1]);
  const c = both({ from: "runs", new: true, match: { status: "failure", branch: null }, says: "x" });
  assert.equal(c[0], c[1]);
});

// Words that end in a period of their own keep one (seen live: "Rolled back app-api to 3f2a…91.. … writes nothing..").
// (fails before: yes)
test("Hand to an agent…'s words: a sentence ends once, where the words end in a period of their own", () => {
  /** @type {any} */
  const row = { id: "k1", kind: "check", text: "“Roll back to this…” on Deploys did not do what it was for", why: "", dashboard: "d", title: "Deploys", at: 1, state: "open",
    check: { label: "Roll back to this…", ran: "node rollback.mjs 3f2a", said: "Rolled back app-api to 3f2a. ", reason: "production still serves 7c1e; it writes nothing." } };
  assert.equal(handWords(row, "proj"), "On “Deploys”, a dashboard in proj's Space, I pressed “Roll back to this…”: it ran node rollback.mjs 3f2a and said: Rolled back app-api to 3f2a. An agent checked it and says it did not work: production still serves 7c1e; it writes nothing. It is row k1 of Needs you: once it is dealt with, mark it done with the space tool, in a line on what you did. Find out why, and fix it: ");
  assert.equal(handWords({ ...row, check: { ...row.check, said: "", reason: "" } }, "proj"), "On “Deploys”, a dashboard in proj's Space, I pressed “Roll back to this…”: it ran node rollback.mjs 3f2a. An agent checked it and says it did not work: it gave no reason. It is row k1 of Needs you: once it is dealt with, mark it done with the space tool, in a line on what you did. Find out why, and fix it: ");
  assert.equal(handWords({ ...row, kind: "watch", check: undefined, text: "CI failed on main: run 8813.", why: "" }, "proj"), "“Deploys”, a dashboard in proj's Space, put this in Needs you as row k1: CI failed on main: run 8813. Once it is dealt with, mark the row done with the space tool, in a line on what you did. Look into it: ");
  const o = { place: "proj", dashboard: "Deploys", label: "Roll back to this…", says: "Roll back?", ran: "node rollback.mjs 3f2a", said: "Rolled back." };
  assert.equal(resultWords({ ...o, checked: "it did not work — 7c1e still serves." }), "On “Deploys”, a dashboard in proj's Space, I pressed “Roll back to this…” (Roll back?). It ran node rollback.mjs 3f2a. It said: Rolled back. An agent checked it and says: it did not work — 7c1e still serves.\n\nLook into it: ");
  assert.equal(resultWords({ ...o, said: "Rolled back", checked: "it worked" }), "On “Deploys”, a dashboard in proj's Space, I pressed “Roll back to this…” (Roll back?). It ran node rollback.mjs 3f2a. It said: Rolled back. An agent checked it and says: it worked.\n\nLook into it: ");
  // A failure: what it said, once (seen live: "It failed: node exited 1: ✘ X. What it said: ✘ X.").
  const sign = "✘ [ERROR] You are not signed in to Cloudflare: run wrangler login.";
  assert.equal(resultWords({ ...o, said: `${sign}\n`, error: `it failed: node exited 1: ${sign}` }), `On “Deploys”, a dashboard in proj's Space, I pressed “Roll back to this…” (Roll back?). It ran node rollback.mjs 3f2a. It failed: node exited 1: ${sign}\n\nLook into it: `);
  assert.equal(resultWords({ ...o, said: "Uploading…\nRetrying", error: "it failed: node exited 1: timed out" }), "On “Deploys”, a dashboard in proj's Space, I pressed “Roll back to this…” (Roll back?). It ran node rollback.mjs 3f2a. It failed: node exited 1: timed out. What it said: Uploading…\nRetrying\n\nLook into it: ");
});

test("the page's groups: open — a stopped source first, then the newest —, put off by when it comes back, done today", () => {
  const now = new Date(2026, 9, 21, 15, 0).getTime();
  const today = new Date(now).setHours(0, 0, 0, 0);
  /** @param {string} id @param {any} o @returns {import("../src/ui/harness/lib/space-view.js").NeedRow} */
  const n = (id, o) => ({ id, kind: "watch", text: id, why: "", dashboard: "d", title: "D", at: now - HOUR, state: "open", ...o });
  const g = needGroups([
    n("a", { at: now - 10 }),
    n("b", { kind: "source", at: now - 5 * HOUR }),
    n("c", { state: "later", until: now + 2 * HOUR }),
    n("d", { state: "later", until: now - 1, at: now - 20 }),
    n("e", { state: "later", until: now + HOUR }),
    n("f", { state: "done", doneAt: today }),
    n("g", { state: "done", doneAt: today - 1 }),
    n("h", { state: "done", doneAt: now - 1 }),
  ], now);
  assert.deepEqual([g.open, g.later, g.done].map((x) => x.map((r) => r.id)), [["b", "a", "d"], ["e", "c"], ["h", "f"]]);
});

test("Not now's choices: tomorrow 09:00 and Monday 09:00, Monday alone where it is tomorrow; in the night 09:00 this morning first; each within reach", () => {
  const wed = new Date(2026, 9, 21, 15, 0).getTime();
  assert.equal(new Date(wed).getDay(), 3);
  assert.deepEqual(notNowChoices(wed), [
    { label: "Until tomorrow 09:00", until: new Date(2026, 9, 22, 9).getTime() },
    { label: "Until Monday 09:00", until: new Date(2026, 9, 26, 9).getTime() },
  ]);
  // Sunday at 00:50, as the live look found it: this morning, then tomorrow (Monday).
  const sun = new Date(2026, 9, 25, 0, 50).getTime();
  assert.deepEqual(notNowChoices(sun), [
    { label: "Until 09:00 this morning", until: new Date(2026, 9, 25, 9).getTime() },
    { label: "Until tomorrow 09:00", until: new Date(2026, 9, 26, 9).getTime() },
  ]);
  const mon = new Date(2026, 9, 26, 0, 1).getTime();
  assert.deepEqual(notNowChoices(mon).map((c) => c.until), [new Date(2026, 9, 26, 9).getTime(), new Date(2026, 9, 27, 9).getTime(), new Date(2026, 10, 2, 9).getTime()]);
  // Less than an hour before 09:00: not this morning.
  assert.equal(notNowChoices(new Date(2026, 9, 21, 8, 1).getTime())[0].label, "Until tomorrow 09:00");
  assert.equal(notNowChoices(new Date(2026, 9, 21, 8, 0).getTime())[0].label, "Until 09:00 this morning");
  for (let day = 0; day < 7; day++)
    for (const hour of [0, 8, 9, 23]) {
      const at = new Date(2026, 9, 19 + day, hour, 0).getTime();
      for (const c of notNowChoices(at)) assert.ok(c.until > at && c.until <= at + LATER_MAX_MS, `${c.label} from day ${day} at ${hour}:00`);
    }
});

test("when a row comes back, in words; a row's dashboard chip: paused, or taken out with no tab", () => {
  const wed = new Date(2026, 9, 21, 15, 0).getTime();
  assert.deepEqual(
    [new Date(2026, 9, 21, 18).getTime(), new Date(2026, 9, 22, 9).getTime(), new Date(2026, 9, 26, 9).getTime(), new Date(2026, 10, 3, 9).getTime()].map((t) => untilWords(t, wed)),
    ["today 18:00", "tomorrow 09:00", "Mon 09:00", "3 Nov 09:00"],
  );
  const ds = [{ name: "d1", title: "Deploys", paused: false }, { name: "d2", title: "PRs", paused: true }];
  /** @param {string} dashboard @returns {any} */
  const row = (dashboard) => ({ dashboard, title: "Old name" });
  assert.deepEqual([needChip(row("d1"), ds), needChip(row("d2"), ds), needChip(row("d3"), ds)], [
    { label: "Deploys", tab: true },
    { label: "PRs · paused", tab: true },
    { label: "Old name · taken out", tab: false },
  ]);
});
