// @ts-check
// The artifacts' store as the perf pass left it (services/artifacts.js): a record that reads is read off the disk once
// and kept, so the list — every transcript a page asks for reads it, and a running chat's page asks again and again —
// costs one look at the folder, not a read and a parse of every artifact's record. Every write the store makes keeps
// what it wrote, so each answer is the one a read of the disk gives: checked here against a store opened afresh on the
// same folder after each kind of write. The disk calls are counted on node:fs itself, which the store imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../src/services/artifacts.js";

const fs = createRequire(import.meta.url)("node:fs");

/** The record reads the store makes until `restore`. */
function countRecordReads() {
  const real = fs.readFileSync;
  let n = 0;
  fs.readFileSync = (/** @type {any[]} */ ...args) => {
    if (String(args[0]).endsWith("artifact.json")) n++;
    return real(...args);
  };
  syncBuiltinESMExports();
  return {
    get n() {
      return n;
    },
    restore() {
      fs.readFileSync = real;
      syncBuiltinESMExports();
    },
  };
}

const files = (/** @type {Record<string, string>} */ o) => Object.entries(o).map(([path, text]) => ({ path, data: Buffer.from(text) }));
const maker = (/** @type {string} */ chain) => ({ chain, model: "m-1", folder: "/p", helper: null, call: null });

/** A store on a fresh folder, its clock a minute a call, its names four letters each. */
function storeOn(dataDir = mkdtempSync(join(tmpdir(), "filament-art-reads-"))) {
  let t = Date.UTC(2027, 0, 15, 8, 0);
  let k = 0;
  return createArtifactStore({ dataDir, now: () => (t += 60_000), four: () => `k${String(k++).padStart(3, "0")}` });
}

// (fails before: yes — every list read and parsed every artifact's record: 40 reads for four lists of ten)
test("the list reads each artifact's record off the disk once, not at each ask", (t) => {
  const first = storeOn();
  t.after(() => rmSync(first.dir, { recursive: true, force: true }));
  for (let i = 0; i < 10; i++) first.publish({ title: `Page ${i}`, files: files({ "index.html": `<p>${i}</p>` }), by: maker("c1"), who: "c1" });
  // A restart: a store that has read nothing yet.
  const store = createArtifactStore({ dataDir: join(first.dir, "..") });
  const spy = countRecordReads();
  /** @type {any[]} */
  let lists = [];
  try {
    for (let i = 0; i < 4; i++) lists.push(store.list());
  } finally {
    spy.restore();
  }
  assert.equal(spy.n, 10, "ten records, read once each");
  assert.equal(lists[0].length, 10);
  for (const l of lists) assert.deepEqual(l, lists[0], "each list says the same");
  assert.deepEqual(lists[0], first.list(), "and the same as the store that wrote them");
});

// (fails before: no — a guard: the store read every answer off the disk, so it said what the disk held after each write)
test("after each kind of write the store makes, its answers are what a read of the disk gives", (t) => {
  const store = storeOn();
  const dataDir = join(store.dir, "..");
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const fresh = () => createArtifactStore({ dataDir });
  const same = (/** @type {string} */ why) => {
    const disk = fresh();
    assert.deepEqual(store.list(), disk.list(), `the list, after ${why}`);
    for (const a of disk.list()) {
      assert.deepEqual(store.get(a.name), disk.get(a.name), `${a.name}, after ${why}`);
      assert.deepEqual(store.file(a.name, a.versions.length, "index.html"), disk.file(a.name, a.versions.length, "index.html"), `its page, after ${why}`);
    }
  };
  store.list();
  const a = /** @type {any} */ (store.publish({ title: "Board", files: files({ "index.html": "1" }), by: maker("c1"), who: "c1" })).artifact.name;
  const b = /** @type {any} */ (store.publish({ title: "Other", description: "d", icon: "chart", files: files({ "index.html": "x" }), by: maker("c2"), who: null })).artifact.name;
  same("two new artifacts");
  store.publish({ name: a, files: files({ "index.html": "2" }), by: maker("c1"), who: "c1" });
  same("a next version");
  assert.equal(/** @type {any} */ (store.publish({ name: a, files: files({ "index.html": "3" }), by: maker("c2"), who: "c2" })).ok, false);
  same("a publish refused over a version its chat had not read, which counts as its read");
  store.seen(b, "c3");
  same("a read noted");
  store.update(a, { title: "Board renamed" });
  store.update(b, { pinned: true });
  same("a rename and a pin");
  store.viewed(a);
  same("a view");
  assert.equal(store.restore(a, 1).ok, true);
  same("a version made the newest again");
  assert.equal(store.remove(b), true);
  same("a delete");
  assert.equal(store.get(b), null);
  assert.deepEqual(store.list().map((x) => x.title), ["Board renamed"]);
});

// (fails before: no — a guard: each answer was a fresh read, so changing one changed nothing of the store's)
test("what the store hands out is the caller's: changing it changes nothing the store says next", (t) => {
  const store = storeOn();
  t.after(() => rmSync(join(store.dir, ".."), { recursive: true, force: true }));
  const name = /** @type {any} */ (store.publish({ title: "Board", files: files({ "index.html": "1" }), by: maker("c1"), who: "c1" })).artifact.name;
  const listed = store.list()[0];
  listed.title = "changed";
  listed.versions.push(/** @type {any} */ ({ v: 9 }));
  listed.seen.x = 9;
  const got = /** @type {any} */ (store.get(name));
  got.pinned = true;
  got.versions[0].files.length = 0;
  const now = /** @type {any} */ (store.get(name));
  assert.deepEqual([now.title, now.versions.length, now.seen, now.pinned, now.versions[0].files.length], ["Board", 1, { c1: 1 }, false, 1]);
  assert.deepEqual(store.list(), [now]);
});
