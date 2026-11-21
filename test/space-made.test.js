// @ts-check
// A project has a Space once the person makes one (the owner's of 10-29: "by default there is no space and one can right
// click to make one and similarly one can right click and delete one"). The store: the Spaces of before set aside whole
// at the first start — a Space of your own stays —; none until made; making one brings an old board's tasks back, only
// those; Delete renames its file, and Bring back has it as it was for 30 days; a read alone makes no Space.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpaceStore, NO_SPACE, SET_ASIDE, SPACE_BACK_MS, SPACE_DELETED } from "../src/services/spaces.js";
import { grantOf } from "../src/core/dashboard-sources.js";
import { backWords } from "../src/ui/harness/lib/space-view.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-made-${tag}-`));
  made.push(d);
  return d;
};

const P = "0123456789ab";
const Q = "ba9876543210";
const YOU = /** @type {const} */ ({ kind: "you" });
const FIELDS = { title: "Morning brief", when: "daily 09:00", task: "Read the open PRs.", writes: false };
const BY = { chain: "c1", byName: "Release", model: "agent/brain-model" };
const RUNS = {
  sources: { runs: { command: ["gh", "run", "list", "--json", "databaseId,conclusion"], key: "databaseId", columns: { run: "databaseId", status: "conclusion" } } },
  watch: [{ from: "runs", new: true, match: { status: "failure" }, says: "CI failed on main: run {row.run}", to: "needs-you" }],
};

/** A Space of before, as an older Filament wrote it: two tasks, a routine on, a logbook. @param {string} dir */
function oldSpace(dir) {
  const old = createSpaceStore({ dir: null });
  old.addTask(P, { title: "Ship the installer" }, YOU);
  old.addTask(P, { title: "Docs", column: "doing" }, YOU);
  old.write(P, "Started on the release.", YOU);
  const r = old.routinePropose(P, FIELDS, BY);
  old.routineOn(P, r.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${P}.json`), JSON.stringify(old.get(P)));
  return old.get(P);
}

describe("the Spaces of before", () => {
  // (fails before: yes — every project's file was its Space, and what it kept ran by itself)
  test("are set aside whole at the first start; a Space of your own stays; once only", () => {
    const dir = fresh("aside");
    const was = oldSpace(dir);
    const own = createSpaceStore({ dir: null });
    own.makeOwn(Q, { name: "Personal", folder: "C:/Personal" });
    writeFileSync(join(dir, `${Q}.json`), JSON.stringify(own.get(Q)));
    /** @type {string[]} */
    const said = [];
    const store = createSpaceStore({ dir, madeOnly: true, log: (_l, m) => said.push(m) });
    assert.equal(store.has(P), false, "no Space until made");
    assert.equal(store.has(Q), true, "a Space of your own was made by the person");
    assert.deepEqual(store.projects(), [Q]);
    assert.equal(store.routinesAll().length, 0, "nothing of it runs");
    assert.deepEqual(JSON.parse(readFileSync(join(dir, `${P}.json${SET_ASIDE}`), "utf8")), JSON.parse(JSON.stringify(was)), "kept whole");
    assert.match(said.join("\n"), /1 Space of before set aside/);
    // A Space made since is never set aside again.
    store.make(P);
    const again = createSpaceStore({ dir, madeOnly: true });
    assert.equal(again.has(P), true);
  });
});

describe("a Space made by the person", () => {
  // (fails before: yes — a first write made the Space, wherever it came from)
  test("none until made: a write is refused, a read makes none; made, it says so", () => {
    const store = createSpaceStore({ dir: fresh("none"), madeOnly: true });
    assert.equal(store.has(P), false);
    assert.equal(store.get(P).tasks.length, 0, "reads as an empty one");
    assert.deepEqual(store.projects(), [], "a read alone makes no Space");
    assert.throws(() => store.addTask(P, { title: "x" }, YOU), (e) => /** @type {any} */ (e).status === 404 && /** @type {any} */ (e).message === NO_SPACE);
    assert.throws(() => store.happened(P, { lines: ["A new lane: feat/x"] }), /no Space/);
    assert.deepEqual(store.make(P), { made: true, tasks: 0 });
    assert.equal(store.has(P), true);
    assert.deepEqual(store.projects(), [P]);
    assert.equal(store.get(P).log.at(-1)?.text, "You made this Space.");
    assert.deepEqual(store.make(P), { made: false, tasks: 0 }, "made once");
    store.addTask(P, { title: "x" }, YOU);
  });

  // (fails before: yes — a Space only read was listed with those written)
  test("a read alone lists no Space in a store where every project has one, either", () => {
    const store = createSpaceStore({ dir: null });
    store.get(P);
    assert.deepEqual(store.projects(), []);
    assert.equal(store.has(P), true, "the world before 10-29: every project's");
  });

  test("making it brings the old board's tasks back, only those; their ids never meet a new one's; once", () => {
    const dir = fresh("back");
    const was = oldSpace(dir);
    const store = createSpaceStore({ dir, madeOnly: true });
    assert.deepEqual(store.make(P), { made: true, tasks: 2 });
    const now = store.get(P);
    assert.deepEqual(now.tasks.map((t) => [t.title, t.column]), [["Ship the installer", "planned"], ["Docs", "doing"]]);
    assert.equal(now.routines.length, 0, "its routines stay in the old file");
    assert.equal(now.log.length, 1);
    assert.equal(now.log[0].text, "You made this Space. 2 tasks came back from its old board.");
    const t = store.addTask(P, { title: "New one" }, YOU);
    assert.ok(!was.tasks.some((x) => x.id === t.id), `${t.id} is none of the old ids`);
    assert.ok(existsSync(join(dir, `${P}.json${SET_ASIDE}-brought`)), "the old file stays, named as brought");
    assert.equal(existsSync(join(dir, `${P}.json${SET_ASIDE}`)), false);
    // Deleted and made again, it starts empty.
    store.remove(P);
    assert.deepEqual(store.make(P), { made: true, tasks: 0 });
  });
});

describe("Delete Space and Bring back", () => {
  test("delete renames its file, says it on the stream, refuses a write under way; Bring back has it as it was", () => {
    const dir = fresh("delete");
    /** @type {any[]} */
    const heard = [];
    let at = 1_000_000;
    const store = createSpaceStore({ dir, madeOnly: true, events: { publish: (_t, p) => heard.push(p) }, now: () => at });
    store.make(P);
    store.addTask(P, { title: "Keep me" }, YOU);
    const r = store.routinePropose(P, FIELDS, BY);
    store.routineOn(P, r.id);
    assert.deepEqual(store.remove(P), { at });
    assert.equal(store.has(P), false);
    assert.deepEqual(store.projects(), []);
    assert.equal(store.routinesAll().length, 0, "nothing of it runs");
    assert.deepEqual(heard.at(-1), { type: "space", project: P, seq: 0, gone: true });
    assert.ok(readdirSync(dir).includes(`${P}.json.deleted-${at}`));
    assert.equal(store.routineEnded(P, r.id, /** @type {any} */ ({ at, by: "time", state: "done" })), null, "a run's end that comes after finds nothing");
    // In the words of a deleted Space that waits, never the by-need sentence: nothing added makes another (d-send).
    assert.throws(() => store.write(P, "a line under way", { kind: "agent", chain: "c1" }), { message: SPACE_DELETED }, "a write under way is refused");
    assert.equal(existsSync(join(dir, `${P}.json`)), false, "and makes no file again");
    assert.equal(store.deletedAt(P), at);
    at += 60_000;
    assert.deepEqual(store.bringBack(P), { at: at - 60_000 });
    const back = store.get(P);
    assert.deepEqual(back.tasks.map((t) => t.title), ["Keep me"]);
    assert.equal(back.routines[0].state, "on", "as it was");
    assert.equal(back.log.at(-1)?.text, "You brought this Space back.");
    assert.equal(store.deletedAt(P), null);
    assert.throws(() => store.bringBack(P), /has a Space already/);
  });

  // (fails before: yes — found reviewing the Space work, 10-29: an app kept in another Space since the delete came back
  // kept here too, so it read and watched in two Spaces, where a Keep is refused while another keeps it)
  test("Bring back keeps no app in two Spaces: one kept in another Space since comes back taken out, its way back as it was kept", () => {
    const grant = grantOf(RUNS);
    let at = 2_000_000;
    const store = createSpaceStore({ dir: fresh("two"), madeOnly: true, now: () => at });
    store.make(P);
    store.keepDashboard(P, { name: "ci-ab12", v: 1, grant, title: "CI" });
    store.keepDashboard(P, { name: "notes-cd34", v: 2, grant, title: "Notes" });
    store.dashboardChange(P, "ci-ab12", { paused: true, title: "CI" });
    store.remove(P);
    store.make(Q);
    store.keepDashboard(Q, { name: "ci-ab12", v: 3, grant, title: "CI" });
    at += 60_000;
    const titles = /** @type {Record<string, string>} */ ({ "ci-ab12": "CI", "notes-cd34": "Notes" });
    assert.deepEqual(store.bringBack(P, { appOf: (name) => ({ title: titles[name], v: 3 }) }), { at: at - 60_000, takenOut: ["CI"] });
    assert.deepEqual(store.keptDashboards().map((k) => [k.project, k.d.name]).sort(), [[P, "notes-cd34"], [Q, "ci-ab12"]], "each kept once");
    const out = store.get(P).dashboards.find((d) => d.name === "ci-ab12");
    assert.deepEqual(out, { name: "ci-ab12", state: "removed", v: 3, grant: null, at, paused: false, seen: {}, was: { v: 1, grant, scripts: {}, at: 2_000_000, paused: true, seen: {} } });
    assert.deepEqual(store.get(P).log.slice(-2).map((e) => e.text), [
      "You brought this Space back.",
      "“CI” is kept in another project's Space now, so it came back taken out of this one: Add to this Space… puts it back once it is taken out there.",
    ]);
    assert.equal(new Set(store.get(P).log.map((e) => e.id)).size, store.get(P).log.length, "each line its own id");
    assert.throws(() => store.dashboardBack(P, "ci-ab12", "CI"), /kept in another project's Space/);
    store.dashboardChange(Q, "ci-ab12", { removed: true, title: "CI", v: 3 });
    assert.equal(store.dashboardBack(P, "ci-ab12", "CI")?.paused, true, "put back as it was kept, paused");
    // With none kept elsewhere, it comes back as it was, and says nothing more.
    store.remove(P);
    assert.deepEqual(store.bringBack(P), { at });
    assert.equal(store.get(P).dashboards.find((d) => d.name === "ci-ab12")?.state, "kept");
  });

  // (fails before: yes — found by the review of 10-29: its file was named back before the change was written, so a change
  // that failed left the Space back with the app kept in two Spaces)
  test("a Bring back whose change fails leaves the Space deleted as it was, to bring back again", () => {
    const grant = grantOf(RUNS);
    for (const dir of [fresh("undo"), null]) {
      let at = 3_000_000;
      const store = createSpaceStore({ dir, madeOnly: true, now: () => at });
      store.make(P);
      store.keepDashboard(P, { name: "ci-ab12", v: 1, grant, title: "CI" });
      store.remove(P);
      store.make(Q);
      store.keepDashboard(Q, { name: "ci-ab12", v: 1, grant, title: "CI" });
      at += 60_000;
      assert.throws(() => store.bringBack(P, { appOf: () => { throw new Error("no title"); } }), /no title/);
      assert.equal(store.has(P), false, `${dir ? "a file" : "in memory"}: still deleted`);
      assert.equal(store.deletedAt(P), at - 60_000, "deleted when it was");
      assert.deepEqual(store.keptDashboards().map((k) => k.project), [Q], "kept in one Space");
      assert.deepEqual(store.bringBack(P, { appOf: () => ({ title: "CI", v: 1 }) }), { at: at - 60_000, takenOut: ["CI"] });
      assert.deepEqual(store.keptDashboards().map((k) => k.project), [Q]);
    }
  });

  test("its toast names the apps that came back taken out; none, it says only that the Space is back", () => {
    assert.equal(backWords("This Space is back", undefined), "This Space is back");
    assert.equal(backWords("This Space is back", []), "This Space is back");
    assert.equal(backWords("repo's Space is back", ["CI"]), "repo's Space is back: “CI” is kept in another Space, so here it is taken out");
    assert.equal(backWords("This Space is back", ["CI", "Notes", "Deploys", 4]), "This Space is back: “CI”, “Notes” and “Deploys” are kept in another Space, so here they are taken out");
  });

  test("past 30 days it can't come back; a Space of your own is deleted from its own menu; no Space, nothing to delete", () => {
    let at = 5_000_000;
    const store = createSpaceStore({ dir: null, now: () => at });
    assert.throws(() => store.remove(P), /no Space/);
    store.make(P);
    store.remove(P);
    assert.equal(store.deletedAt(P), at);
    at += SPACE_BACK_MS + 1;
    assert.equal(store.deletedAt(P), null);
    assert.throws(() => store.bringBack(P), /kept 30 days/);
    store.makeOwn(Q, { name: "Personal", folder: "C:/Personal" });
    assert.throws(() => store.remove(Q), /its own menu/);
  });

  // The owner's of 10-29: a deleted Space that can no longer come back goes for good. (fails before: yes — its file
  // stayed for ever)
  test("past 30 days a deleted Space's file is removed, at the start and at the next delete; a younger one and the rest stay", () => {
    const dir = fresh("prune");
    const T = 100 * SPACE_BACK_MS;
    mkdirSync(dir, { recursive: true });
    const old = `${P}.json.deleted-${T - SPACE_BACK_MS - 1}`;
    const young = `${Q}.json.deleted-${T - SPACE_BACK_MS + 60_000}`;
    for (const f of [old, young, `${P}.json${SET_ASIDE}`, "_set-aside.json"]) writeFileSync(join(dir, f), "{}");
    let at = T;
    const store = createSpaceStore({ dir, madeOnly: true, now: () => at });
    assert.deepEqual(readdirSync(dir).sort(), [young, `${P}.json${SET_ASIDE}`, "_set-aside.json"].sort());
    assert.equal(store.deletedAt(Q), T - SPACE_BACK_MS + 60_000);
    at += 120_000;
    store.make(P);
    store.remove(P);
    assert.equal(readdirSync(dir).includes(young), false, "gone at the next delete, its 30 days over");
    assert.ok(readdirSync(dir).includes(`${P}.json.deleted-${at}`));
  });

  // (fails before: yes — found mapping the prune, 10-29: it ran at the start and at a delete alone, so a Filament left
  // running past a deleted Space's 30 days kept its file until one of them came)
  test("past its 30 days a deleted Space's file goes while Filament runs on, with no delete and no restart; a Space made again stays", async () => {
    const dir = fresh("prune-on");
    const T = 100 * SPACE_BACK_MS;
    mkdirSync(dir, { recursive: true });
    let at = T;
    const store = createSpaceStore({ dir, madeOnly: true, now: () => at, pruneEvery: 20 });
    try {
      store.make(P);
      store.remove(P);
      store.make(Q);
      store.remove(Q);
      store.make(Q);
      const p = `${P}.json.deleted-${T}`;
      const q = `${Q}.json.deleted-${T}`;
      /** The two projects' files, the store's own marks aside. */
      const files = () => readdirSync(dir).filter((f) => f.startsWith(P) || f.startsWith(Q)).sort();
      assert.deepEqual(files(), [p, `${Q}.json`, q].sort());
      await new Promise((r) => setTimeout(r, 80));
      assert.deepEqual(files(), [p, `${Q}.json`, q].sort(), "within its 30 days each stays");
      assert.equal(store.deletedAt(P), T);
      at += SPACE_BACK_MS + 1;
      for (let i = 0; i < 100 && files().includes(p); i++) await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(files(), [`${Q}.json`], "gone by itself; the Space made again stays");
      assert.throws(() => store.bringBack(P), /no deleted Space to bring back: one is kept 30 days/);
    } finally {
      store.stop();
    }
  });
});
