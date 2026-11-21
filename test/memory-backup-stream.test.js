// @ts-check
// A memory backup's checksums (services/memory/backup.js) as the perf pass left them: each file is hashed as it streams
// off the disk, not read whole into memory first — a backup's databases can be hundreds of megabytes, and the whole
// read held each one in memory and blocked the server while it read. The digests are the ones a whole read gives, and
// a backup that was changed still fails its check. The reads are counted on node:fs itself, which the backup imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BackupManager as BackupManagerClass } from "../src/services/memory/backup.js";

/** The backups, their options as memory passes them (the module is not type-checked: its defaults would narrow them). */
const BackupManager = /** @type {any} */ (BackupManagerClass);

const fs = createRequire(import.meta.url)("node:fs");

/** The whole-file reads made until `restore`, but a manifest's. */
function countWholeReads() {
  const real = fs.readFileSync;
  /** @type {string[]} */
  const read = [];
  fs.readFileSync = (/** @type {any[]} */ ...args) => {
    if (!String(args[0]).endsWith("manifest.json")) read.push(String(args[0]));
    return real(...args);
  };
  syncBuiltinESMExports();
  return {
    read,
    restore() {
      fs.readFileSync = real;
      syncBuiltinESMExports();
    },
  };
}

const sha = (/** @type {string} */ file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// (fails before: yes — every checksum read its file whole: the backup read archive.db.gz, mnemosyne.db.gz, memory.json
// and config.yaml, and its check read each again)
test("a backup's checksums are made and checked reading each file as a stream, never whole; the digests are a whole read's", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "filament-bk-stream-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, "memory");
  mkdirSync(join(folder, "mnemosyne"), { recursive: true });
  for (const f of [join(folder, "archive.db"), join(folder, "mnemosyne", "mnemosyne.db")]) {
    const db = new DatabaseSync(f);
    db.exec("CREATE TABLE t(x TEXT)");
    const put = db.prepare("INSERT INTO t VALUES (?)");
    db.exec("BEGIN");
    for (let i = 0; i < 2000; i++) put.run(`row ${i} ${"y".repeat(400)}`);
    db.exec("COMMIT");
    db.close();
  }
  writeFileSync(join(folder, "memory.json"), JSON.stringify({ version: 1, deviceId: "dev1" }));
  writeFileSync(join(folder, "mnemosyne", "config.yaml"), "data_dir: x\n");
  const dest = join(root, "backups");
  const bk = new BackupManager({ service: /** @type {any} */ ({ folder }), getConfig: () => ({ backups: { enabled: true, folder: dest, keep: 3 } }), now: () => Date.UTC(2026, 9, 29, 3) });
  const spy = countWholeReads();
  /** @type {any} */
  let m;
  /** @type {any} */
  let checked;
  try {
    m = await bk.run({ reason: "manual" });
    checked = await bk.verify(m.dir);
  } finally {
    spy.restore();
  }
  assert.deepEqual(spy.read, [], "no file read whole");
  assert.deepEqual(Object.keys(m.files).sort(), ["archive.db.gz", "config.yaml", "memory.json", "mnemosyne.db.gz"]);
  for (const [f, info] of Object.entries(m.files)) assert.equal(/** @type {any} */ (info).sha256, sha(join(m.dir, f)), `${f}: the digest a whole read gives`);
  assert.equal(m.files["memory.json"].sha256, sha(join(folder, "memory.json")), "and the source's, which the copy is");
  assert.deepEqual([checked.ok, checked.problems], [true, []]);
  writeFileSync(join(m.dir, "memory.json"), "{}");
  assert.deepEqual((await bk.verify(m.dir)).problems, ["memory.json: checksum differs"], "a changed file still fails its check");
});
