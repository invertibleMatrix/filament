// @ts-check
// Before every request an agent's newest two hundred sightings, and a hundred older ones in turn, are looked at for a
// change (hands.js `changedSightings`). Looked at one synchronous stat after another, that held every other agent and
// request of the server while it ran, every round of every agent. The looks run side by side, a few at a time, without
// blocking — what they find is the same.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand, changedSightings } from "../src/adapters/tools/hands.js";

const dir = mkdtempSync(join(tmpdir(), "stale-async-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const later = (/** @type {string} */ p) => utimesSync(p, new Date(), new Date(Date.now() + 5_000));

// (fails before: yes — 300 sightings took 300 synchronous stats, one after another)
test("three hundred sightings are looked at without one synchronous stat, at most a few at once, and the changed ones named in order", async () => {
  const seen = new Map();
  for (let i = 0; i < 320; i++) {
    writeFileSync(join(dir, `f${i}.txt`), `file ${i}\n`);
    await runHand("read", { path: `f${i}.txt` }, { root: dir, seen });
  }
  for (const i of [5, 250, 319]) {
    writeFileSync(join(dir, `f${i}.txt`), `file ${i}, changed\n`);
    later(join(dir, `f${i}.txt`));
  }
  const fsAny = /** @type {any} */ (fs);
  const realSync = fsAny.statSync;
  const realStat = fsAny.promises.stat;
  let sync = 0;
  let open = 0;
  let most = 0;
  let looks = 0;
  fsAny.statSync = (/** @type {any[]} */ ...a) => (sync++, realSync(...a));
  fsAny.promises.stat = async (/** @type {any[]} */ ...a) => {
    looks++;
    most = Math.max(most, ++open);
    try {
      return await realStat(...a);
    } finally {
      open--;
    }
  };
  syncBuiltinESMExports();
  /** @type {Awaited<ReturnType<typeof changedSightings>>} */
  let changes;
  try {
    changes = await changedSightings(seen);
  } finally {
    fsAny.statSync = realSync;
    fsAny.promises.stat = realStat;
    syncBuiltinESMExports();
  }
  assert.equal(sync, 0, "no synchronous stat");
  assert.ok(looks >= 300, `every sighting in reach looked at (${looks})`);
  assert.ok(most > 1 && most <= 16, `side by side, at most a few at once (${most})`);
  // The older sightings come first in a look (the turn through them), then the newest two hundred.
  assert.deepEqual(changes.map((c) => c.abs.split(/[\\/]/).pop()), ["f5.txt", "f250.txt", "f319.txt"]);
  // A copy of what a file held is kept for the newest fifty: the older two are named without it, and lose their sighting.
  assert.deepEqual(changes.map((c) => [c.was, c.now]), [[null, "file 5, changed\n"], [null, "file 250, changed\n"], ["file 319\n", "file 319, changed\n"]]);
  assert.deepEqual(await changedSightings(seen), [], "each told once");
  // Told it with its copy, the agent may write it: the sighting moved with the file's own size and time.
  assert.match(String(await runHand("write", { path: "f319.txt", content: "new" }, { root: dir, seen })), /Successfully wrote/);
  await assert.rejects(runHand("write", { path: "f250.txt", content: "new" }, { root: dir, seen }), /read it first/, "one named without its copy is read first");
});
