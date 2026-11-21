// A stopped instance writes nothing more into its data dir, and leaves nothing of its own behind in %TEMP%
// (HarnessV3-FixRound F1 item 1): one full suite run used to leave 27 entries — data dirs a late writer brought back
// after their removal (the op log's mkdir, token calibration's mkdir and its process-wide file, the catalogue's
// debounced save) and the bash hand's spill files, whose removal timers are unref'd and died with the process.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, readdirSync, writeFileSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpLog } from "../src/services/oplog.js";
import { initTokenCalib, disposeTokenCalib, observeRatio } from "../src/services/token-calib.js";
import { createModelCache } from "../src/app/models.js";
import { runHand, disposeSpills, sweepSpills } from "../src/adapters/tools/hands.js";

const made = /** @type {string[]} */ ([]);
const fresh = (/** @type {string} */ p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  made.push(d);
  return d;
};
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("after its stop, a writer writes nothing", () => {
  // (fails before: yes — the op recorded after the stop re-created the removed dir with its ops.jsonl: the log's
  // first write makes the dir, and an instance that had written nothing yet made it after its own removal)
  test("the op log: closed at the stop, a later op stays in the ring and never reaches the disk", async () => {
    const dir = fresh("filament-stop-ops-");
    const ops = new OpLog({ dataDir: dir });
    ops.close();
    rmSync(dir, { recursive: true, force: true });
    ops.record("config", "after the stop");
    await ops.flush();
    assert.equal(existsSync(dir), false, "the removed dir stays removed");
    assert.ok(ops.ops.some((o) => o.title === "after the stop"), "the ring still has it");
  });

  // (fails before: yes — the older instance's stop flushed into the file the newer one named, and stood it down)
  test("token calibration: a stop flushes its own file only, never re-creates a removed dir, and then stands down", () => {
    const fileA = join(fresh("filament-stop-calib-a-"), "token-calib.json");
    const fileB = join(fresh("filament-stop-calib-b-"), "token-calib.json");
    initTokenCalib({ file: fileA });
    initTokenCalib({ file: fileB }); // a second instance in the same process names its own
    observeRatio("up", "m", () => 1000, 1500); // a save pending for B
    disposeTokenCalib(fileA); // the older instance's stop: not the current file, so nothing to do
    assert.equal(existsSync(fileB), false, "the older stop did not flush into the newer instance's file");
    disposeTokenCalib(fileB);
    assert.ok(existsSync(fileB), "the newer instance's own stop flushes it: it was not stood down by the older one");

    const c = fresh("filament-stop-calib-c-");
    initTokenCalib({ file: join(c, "token-calib.json") });
    observeRatio("up", "m", () => 1000, 1500);
    rmSync(c, { recursive: true, force: true }); // the instance's data dir is removed before its stop
    disposeTokenCalib(join(c, "token-calib.json"));
    assert.equal(existsSync(c), false, "no mkdir: the removed dir stays removed");

    initTokenCalib({ file: fileA });
    observeRatio("up", "m", () => 1000, 1500);
    disposeTokenCalib(fileA);
    assert.ok(existsSync(fileA), "its own stop flushes");
    rmSync(fileA, { force: true });
    observeRatio("up", "m", () => 1000, 1500); // after its stop the instance stands down: a later receipt writes nothing
    disposeTokenCalib();
    assert.equal(existsSync(fileA), false, "stood down");
  });

  // (fails before: yes — the debounced save fired after the stop, into a dir already removed)
  test("the catalogue cache: a pending save is written at the stop, and none after", () => {
    const dir = fresh("filament-stop-models-");
    const cfg = { upstreams: [], routes: [], rules: {} };
    const cache = createModelCache({ dataDir: dir, config: { get: () => cfg }, log: () => {}, destinationFor: () => null });
    cache.persistModelCache();
    assert.equal(existsSync(join(dir, "models-cache.json")), false, "debounced: not yet");
    cache.close();
    assert.ok(existsSync(join(dir, "models-cache.json")), "the stop writes the pending save now");
    rmSync(join(dir, "models-cache.json"));
    cache.persistModelCache();
    return new Promise((res) =>
      setTimeout(() => {
        assert.equal(existsSync(join(dir, "models-cache.json")), false, "nothing is saved after the stop");
        res(undefined);
      }, 700),
    );
  });
});

describe("the bash hand's spill files", () => {
  // (fails before: yes — the spill's removal timer is unref'd, so the file outlived the process: in %TEMP% for good)
  test("disposeSpills removes the spill files still kept, and only once", async () => {
    const root = fresh("filament-stop-spill-");
    writeFileSync(join(root, "x.txt"), "x");
    const command = `node -e "for(let i=0;i<2500;i++)console.log(i)"`; // 2,500 lines: over the line cap, so it spills
    const out = String(await runHand("bash", { command }, { root }));
    const m = /Full output \(first \d+ MB, kept 30 minutes\): (\S+)$/m.exec(out);
    assert.ok(m, out.slice(-300));
    const spilled = /** @type {RegExpExecArray} */ (m)[1];
    assert.ok(existsSync(spilled), "kept while Filament runs");
    assert.equal(disposeSpills(), 1);
    assert.equal(existsSync(spilled), false, "removed at the stop");
    assert.equal(disposeSpills(), 0, "nothing left to remove");
    assert.ok(readdirSync(root).length === 1, "the folder is untouched");
  });

  // (fails before: a Filament killed before its stop left its spill files for good — 199 were in %TEMP% on 2026-10-02;
  // HarnessV3-CodebasePass decision 5)
  test("the next start sweeps the ones past their 30 minutes; a younger one, and anything else, stays", () => {
    const dir = fresh("filament-sweep-");
    const now = Date.now();
    const old = join(dir, "filament-bash-mupg4gq2-m6gf.log");
    const young = join(dir, "filament-bash-mupz9abc-x1y2.log");
    const other = join(dir, "filament-notes.log");
    for (const f of [old, young, other]) writeFileSync(f, "output");
    const past = (now - 31 * 60_000) / 1000;
    utimesSync(old, past, past);
    utimesSync(other, past, past);
    assert.equal(sweepSpills({ dir, now }), 1);
    assert.equal(existsSync(old), false, "past its promise: removed");
    assert.equal(existsSync(young), true, "another Filament may still name it: kept");
    assert.equal(existsSync(other), true, "not a spill file: never touched");
    assert.equal(sweepSpills({ dir: join(dir, "missing") }), 0, "no folder, no error");
    const server = readFileSync("src/server.js", "utf8");
    const start = server.slice(server.indexOf("    start() {"), server.indexOf("    stop({ drainMs"));
    assert.match(start, /const swept = sweepSpills\(\);/, "the server's start runs it");
  });
});
