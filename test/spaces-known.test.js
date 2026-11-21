// @ts-check
// The Space store's list of the projects that have a Space (services/spaces.js `known`), as the perf pass left it: the
// folder is read once and again only after the store makes or takes away a Space's file, not at every look — and the
// kept dashboards are looked at several times for each read of a dashboard (dashboard-runner.js `keptOf`), the left
// bar's counts and the routines through the same list. After each kind of change the list is what a store opened afresh
// on the folder says. The folder reads are counted on node:fs itself, which the store imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpaceStore } from "../src/services/spaces.js";

const fs = createRequire(import.meta.url)("node:fs");

/** The reads of `dir` the store makes until `restore`. @param {string} dir */
function countDirReads(dir) {
  const real = fs.readdirSync;
  let n = 0;
  fs.readdirSync = (/** @type {any[]} */ ...args) => {
    if (String(args[0]) === dir) n++;
    return real(...args);
  };
  syncBuiltinESMExports();
  return {
    get n() {
      return n;
    },
    restore() {
      fs.readdirSync = real;
      syncBuiltinESMExports();
    },
  };
}

const grant = { sources: { deploys: { command: "node deploys.mjs", every: 60_000 } }, watch: [], actions: {} };
const fresh = () => mkdtempSync(join(tmpdir(), "filament-spaces-known-"));

// (fails before: yes — every look at the kept dashboards, the counts and the routines read the folder: 40 reads)
test("the kept dashboards, the counts and the routines read the Spaces' folder once, not at each look", (t) => {
  const dir = fresh();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = createSpaceStore({ dir, now: () => 1000 });
  for (const p of ["p1", "p2", "p3"]) first.keepDashboard(p, { name: `deploys-${p}`, v: 1, grant: /** @type {any} */ (grant), title: "Deploys" });
  const store = createSpaceStore({ dir, now: () => 1000 });
  const spy = countDirReads(dir);
  /** @type {any[]} */
  const kept = [];
  try {
    for (let i = 0; i < 10; i++) {
      kept.push(store.keptDashboards().map((k) => `${k.project} ${k.d.name}`));
      store.needCounts(1000);
      store.openCounts();
      store.routinesAll();
    }
  } finally {
    spy.restore();
  }
  assert.equal(spy.n, 1, "the folder, read once");
  for (const k of kept) assert.deepEqual(k, ["p1 deploys-p1", "p2 deploys-p2", "p3 deploys-p3"]);
});

// (fails before: no — a guard: the folder was read at each look, so the list always said what it held)
test("after each change to the Spaces' files the store makes, its projects are what a store opened afresh says", (t) => {
  const dir = fresh();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let at = 1000;
  const store = createSpaceStore({ dir, now: () => at, madeOnly: true });
  const same = (/** @type {string} */ why) => {
    const disk = createSpaceStore({ dir, now: () => at, madeOnly: true });
    assert.deepEqual(store.projects(), disk.projects(), `the projects, after ${why}`);
    assert.deepEqual(store.keptDashboards(), disk.keptDashboards(), `the kept dashboards, after ${why}`);
  };
  same("nothing");
  store.make("p2");
  same("a Space made");
  store.make("p1");
  store.keepDashboard("p1", { name: "deploys-p1", v: 1, grant: /** @type {any} */ (grant), title: "Deploys" });
  same("a second made, and a dashboard kept in it");
  store.addTask("p1", { title: "Ship it" }, { kind: "you" });
  same("a write to a Space that has its file");
  at += 1000;
  store.remove("p2");
  same("a delete");
  at += 1000;
  store.bringBack("p2");
  same("a bring back");
  store.makeOwn("q1", { name: "Personal", folder: "C:/Personal" });
  same("a Space of your own");
  store.drop("p1");
  same("a Space dropped with its project");
  // A file that does not read is set aside as it is read: the store reads it, the folder loses it.
  const other = createSpaceStore({ dir, now: () => at });
  other.make?.("p4");
  writeFileSync(join(dir, "p4.json"), "{ not json");
  const broken = createSpaceStore({ dir, now: () => at });
  assert.deepEqual(broken.projects().sort(), ["p2", "p4", "q1"]);
  broken.get("p4");
  assert.deepEqual(broken.projects().sort(), ["p2", "q1"], "set aside as .broken, it has no Space");
  assert.match(readFileSync(join(dir, "p4.json.broken"), "utf8"), /not json/);
});
