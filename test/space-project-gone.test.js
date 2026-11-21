// @ts-check
// HarnessV4_SpacesPlugins_Plan A5 (SP-D6): a project deleted takes its Space with it, and nothing of a Space whose
// project is gone runs by itself. The delete dialog's words (core's goneWords); the store's drop and its pause of a gone
// project's routines and dashboards; the routines' runner pausing, not failing, a run whose project is gone; and end to
// end: Delete project removes the Space's file and says so first, and a Space left behind by an older Filament has what
// ran by itself paused when Filament starts.
// (fails before: yes — the Space's file stayed behind, and its routines failed at every time where nobody saw them)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptySpace, goneWords } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createRoutines } from "../src/app/routines.js";
import { startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-gone-${tag}-`));
  made.push(d);
  return d;
};

const FIELDS = { title: "Morning brief", when: "daily 09:00", task: "Read the open PRs; say what needs the person.", writes: false };
const BY = { chain: "c1", byName: "Release", model: "agent/brain-model" };
const GRANT = { sources: {}, watch: [], actions: [] };

describe("what goes with a project (core)", () => {
  test("goneWords: nothing for a Space nobody used; else its tasks, logbook, dashboards, routines — those on said to stop — and open rows", () => {
    assert.equal(goneWords(emptySpace()), "");
    const store = createSpaceStore({ dir: null });
    store.addTask("p1", { title: "Ship it" }, { kind: "you" });
    assert.equal(goneWords(store.get("p1")), "Its Space goes too: 1 task.");
    store.write("p1", "Started on the release.", { kind: "you" });
    assert.equal(goneWords(store.get("p1")), "Its Space goes too: 1 task and the logbook.");
    store.addTask("p1", { title: "Docs" }, { kind: "you" });
    const r = store.routinePropose("p1", FIELDS, BY);
    assert.equal(goneWords(store.get("p1")), "Its Space goes too: 2 tasks, the logbook and 1 routine.");
    store.routineOn("p1", r.id);
    store.keepDashboard("p1", { name: "deploys-ab12", v: 1, grant: /** @type {any} */ (GRANT), title: "Deploys" });
    assert.equal(goneWords(store.get("p1")), "Its Space goes too: 2 tasks, the logbook, 1 dashboard and 1 routine (switched on; it stops).");
  });
});

describe("the store", () => {
  test("drop: the file deleted, the copy dropped, said on the stream; a Space never written is no Space to drop", () => {
    const dir = fresh("drop");
    /** @type {any[]} */
    const heard = [];
    const store = createSpaceStore({ dir, events: { publish: (_t, p) => heard.push(p) } });
    store.addTask("0123456789ab", { title: "Ship it" }, { kind: "you" });
    assert.ok(existsSync(join(dir, "0123456789ab.json")));
    assert.deepEqual(store.projects(), ["0123456789ab"]);
    assert.equal(store.drop("0123456789ab"), true);
    assert.equal(existsSync(join(dir, "0123456789ab.json")), false);
    assert.deepEqual(store.projects(), []);
    assert.deepEqual(heard.at(-1), { type: "space", project: "0123456789ab", seq: 0, gone: true });
    assert.deepEqual(store.get("0123456789ab").tasks, []);
    assert.equal(createSpaceStore({ dir }).drop("fedcba987654"), false);
  });

  // (fails before: yes — found by the Hunter on A5: a write under way as its project was deleted made its file again)
  test("a Space dropped with its project is written again only once its project is", () => {
    const dir = fresh("fence");
    let known = true;
    const store = createSpaceStore({ dir, exists: () => known });
    store.addTask("0123456789ab", { title: "Ship it" }, { kind: "you" });
    known = false;
    store.drop("0123456789ab");
    assert.throws(() => store.write("0123456789ab", "A watch's line, late.", { kind: "filament" }), { status: 404, message: "This Space went with its project, which was deleted." });
    assert.equal(existsSync(join(dir, "0123456789ab.json")), false, "no file made again");
    known = true;
    store.addTask("0123456789ab", { title: "Again" }, { kind: "you" });
    assert.deepEqual(store.get("0123456789ab").tasks.map((t) => t.title), ["Again"], "the project made again has its Space again");
    const plain = createSpaceStore({ dir: null });
    plain.addTask("p1", { title: "x" }, { kind: "you" });
    plain.drop("p1");
    plain.addTask("p1", { title: "y" }, { kind: "you" });
    assert.equal(plain.get("p1").tasks.length, 1, "a store that cannot ask whether a project is known writes as before");
  });

  test("pauseGone: every routine on and every dashboard kept paused, in one line; nothing to pause is no change", () => {
    const store = createSpaceStore({ dir: null });
    store.routinePropose("p1", FIELDS, BY);
    store.routineOn("p1", "r1");
    store.routinePropose("p1", { ...FIELDS, title: "Evening brief", when: "daily 18:00" }, BY);
    store.keepDashboard("p1", { name: "deploys-ab12", v: 1, grant: /** @type {any} */ (GRANT), title: "Deploys" });
    const seq = store.get("p1").seq;
    assert.equal(store.pauseGone("p1"), 2);
    const doc = store.get("p1");
    assert.deepEqual(doc.routines.map((r) => [r.title, r.state, r.paused]), [["Morning brief", "on", true], ["Evening brief", "proposed", false]]);
    assert.equal(doc.dashboards[0].paused, true);
    assert.equal(doc.log.at(-1)?.text, "Filament paused the routine “Morning brief” and 1 dashboard: this Space's project was gone. Resume runs each again.");
    assert.equal(doc.seq, seq + 1);
    assert.equal(store.pauseGone("p1"), 0);
    assert.equal(store.get("p1").seq, seq + 1);
  });
});

describe("the routines' runner", () => {
  test("a run whose project is gone pauses its routine, once, with no failure and no chat; one whose folder is unknown for another reason still fails", async () => {
    const store = createSpaceStore({ dir: null });
    for (const p of ["p1", "p2"]) {
      store.routinePropose(p, FIELDS, BY);
      store.routineOn(p, "r1");
    }
    /** @type {any[]} */
    const created = [];
    const routines = createRoutines({
      spaces: store,
      sessions: { create: (o) => (created.push(o), { id: "x" }), besideFacts: () => ({ busy: false, asking: false, last: null }) },
      mark: () => {},
      postTurn: async () => ({ status: 200, body: null }),
      folderOf: () => null,
      gone: (p) => p === "p1",
    });
    await assert.rejects(routines.runNow("p1", "r1"), { status: 502 });
    const r1 = store.get("p1").routines[0];
    assert.deepEqual([r1.paused, r1.last], [true, null]);
    assert.equal(store.get("p1").needs.length, 0);
    await assert.rejects(routines.runNow("p2", "r1"), { status: 502, message: "“Morning brief” could not start: Filament does not know its project's folder" });
    assert.equal(store.get("p2").routines[0].last?.state, "failed");
    assert.equal(created.length, 0);
  });

  // (fails before: yes — found by the Hunter on A5: the chat made after the delete made its project again)
  test("a project deleted while its run's lane is made: no chat, the lane taken back, nothing failed", async () => {
    const store = createSpaceStore({ dir: null });
    store.routinePropose("p1", { ...FIELDS, writes: true }, BY);
    store.routineOn("p1", "r1");
    let deleted = false;
    /** @type {any[]} */
    const created = [];
    /** @type {any[]} */
    const taken = [];
    const routines = createRoutines({
      spaces: store,
      sessions: { create: (o) => (created.push(o), { id: "x" }), besideFacts: () => ({ busy: false, asking: false, last: null }) },
      mark: () => {},
      postTurn: async () => ({ status: 200, body: null }),
      folderOf: () => "/work/app",
      gone: () => deleted,
      places: {
        own: async () => {
          deleted = true;
          return { ok: true, name: "run", branch: "run", folder: "/wt/run", cwd: "/wt/run", main: "/work/app", commit: "abc", place: "/wt/run" };
        },
        takeBack: async (/** @type {any} */ m) => (taken.push(m.folder), null),
      },
    });
    await assert.rejects(routines.runNow("p1", "r1"), { status: 502 });
    assert.deepEqual([created.length, taken], [0, ["/wt/run"]]);
    assert.equal(store.get("p1").routines[0].last, null, "no failure said");
  });
});

describe("end to end", () => {
  test("Delete project: the dialog's line first, then the Space's file goes with the project; its page is gone", async (t) => {
    const shim = await startApp({ memory: true });
    t.after(() => shim.stop());
    const folder = fresh("proj");
    const p = await (await shim.api("/api/memory/projects", { method: "POST", body: { cwd: folder } })).json();
    assert.ok(p.id, JSON.stringify(p));
    assert.equal((await shim.api(`/api/space/${p.id}`, { method: "POST" })).status, 200, "its Space made from its menu");
    assert.equal((await shim.api(`/api/space/${p.id}/tasks`, { method: "POST", body: { title: "Ship it" } })).status, 200);
    const goes = await (await shim.api(`/api/space/${p.id}/goes`)).json();
    assert.equal(goes.words, "Its Space goes too: 1 task and the logbook.", "its logbook says it was made");
    const file = join(shim.dataDir, "spaces", `${p.id}.json`);
    assert.ok(existsSync(file));
    assert.equal((await shim.api(`/api/memory/projects/${p.id}/delete`, { method: "POST" })).status, 200);
    assert.equal(existsSync(file), false);
    assert.equal((await shim.api(`/api/space/${p.id}`)).status, 404);
  });

  test("at start: a Space whose project is gone has its routines and dashboards paused before any time is caught up", async (t) => {
    let spaces = "";
    const shim = await startApp({
      memory: true,
      configure: (_cfg, { dataDir }) => {
        spaces = join(dataDir, "spaces");
        mkdirSync(spaces, { recursive: true });
        const store = createSpaceStore({ dir: spaces });
        store.routinePropose("0123456789ab", FIELDS, BY);
        store.routineOn("0123456789ab", "r1");
        // A run the last stop cut, its chat gone with its project; a dashboard kept, with its watches.
        const evening = store.routinePropose("0123456789ab", { ...FIELDS, title: "Evening brief", when: "daily 18:00" }, BY);
        store.routineOn("0123456789ab", evening.id);
        store.routineStarted("0123456789ab", evening.id, { at: Date.now() - 60_000, chain: "gone-chat", by: "time" });
        store.keepDashboard("0123456789ab", { name: "deploys-ab12", v: 1, grant: /** @type {any} */ (GRANT), title: "Deploys" });
      },
    });
    t.after(() => shim.stop());
    const read = () => JSON.parse(readFileSync(join(spaces, "0123456789ab.json"), "utf8"));
    // Paused as Filament was made, before its watches were armed (found by the Hunter on A5: they looked first).
    assert.deepEqual([read().dashboards[0].paused, read().routines[0].paused], [true, true]);
    const doc = read();
    assert.equal(doc.routines[0].last, null);
    assert.match(doc.log.at(-1).text, /^Filament paused the routines? “Morning brief”.* and 1 dashboard: this Space's project was gone\./);
    // Its cut run is no failure where nobody sees it; it counts for nothing in Home.
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual([read().routines[1].last?.state, read().needs.length], ["running", 0]);
    assert.equal((await (await shim.api("/api/spaces")).json()).extended, false);
  });
});
