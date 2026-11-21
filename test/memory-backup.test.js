import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { Archive } from "../src/archive.js";
import { BackupManager, consistentCopy } from "../src/memory-backup.js";
import { world } from "./fixtures/memory-world.mjs";
import { removeDirs } from "./helpers/wait.js";

const sha = (/** @type {string} */ file) => createHash("sha256").update(readFileSync(file)).digest("hex");
/** @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A memory folder and a backup of it, with a turn and an engine fact written after the backup: what a restore must
 * leave as it is when it does not go through. Both databases stay open; the test closes what memory would close.
 * @param {import("node:test").TestContext} t
 */
async function backedUp(t) {
  const root = mkdtempSync(join(tmpdir(), "filament-bk-"));
  t.after(() => removeDirs(root));
  const folder = join(root, "memory");
  mkdirSync(join(folder, "mnemosyne"), { recursive: true });
  const archive = new Archive({ file: join(folder, "archive.db") });
  const turn = (/** @type {string} */ text) => {
    const ch = archive.chainForKey("k", { cwd: "C:\\x" });
    const tt = archive.beginTurn(ch.id, { requestId: text, userMessage: { role: "user", content: text } });
    archive.finishTurn(tt.turnId, { finalMessage: { role: "assistant", content: "ok" } });
  };
  turn("before the backup");
  const mn = new DatabaseSync(join(folder, "mnemosyne", "mnemosyne.db"));
  mn.exec("PRAGMA journal_mode=WAL; CREATE TABLE working_memory(id TEXT PRIMARY KEY, content TEXT); INSERT INTO working_memory VALUES ('a','fact one');");
  const bk = new BackupManager({ service: { folder, archive }, getConfig: () => ({ backups: { folder: join(root, "backups"), keep: 3 } }), now: () => Date.UTC(2026, 9, 30, 3) });
  const { dir } = await bk.run({ reason: "manual" });
  turn("after the backup");
  mn.exec("INSERT INTO working_memory VALUES ('b','fact two')");
  return { root, folder, archive, mn, bk, dir };
}
/** The turns the archive at `folder` holds, read and closed. @param {string} folder */
const turnsIn = (folder) => {
  const a = new Archive({ file: join(folder, "archive.db") });
  try {
    return a.counts().turns;
  } finally {
    a.close();
  }
};

test("backup: consistent copies of archive and mnemosyne databases, gzipped with checksums; list, verify, rotate, restore", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-bk-")); const folder = join(root, "memory"); const dest = join(root, "drive", "filament-backups");
  mkdirSync(join(folder, "mnemosyne"), { recursive: true });
  const archive = new Archive({ file: join(folder, "archive.db") }); const ch = archive.chainForKey("k", { cwd: "C:\\x" }); const t = archive.beginTurn(ch.id, { requestId: "r", userMessage: { role: "user", content: "hello backup" } }); archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "hi" } });
  const mn = new DatabaseSync(join(folder, "mnemosyne", "mnemosyne.db")); mn.exec("PRAGMA journal_mode=WAL; CREATE TABLE working_memory(id TEXT PRIMARY KEY, content TEXT); INSERT INTO working_memory VALUES ('a','fact one'),('b','fact two');");
  writeFileSync(join(folder, "memory.json"), JSON.stringify({ version: 1, deviceId: "dev1" })); writeFileSync(join(folder, "mnemosyne", "config.yaml"), "data_dir: x\n");
  let now = new Date(2026, 8, 15, 3, 0, 30).getTime(); // local time: the scheduler compares local hours
  const notes = [];
  const service = { folder, archive, noteBackup: (m) => notes.push(m) };
  const cfg = { backups: { enabled: true, folder: dest, hour: 3, keep: 2 } };
  const bk = new BackupManager({ service, getConfig: () => cfg, now: () => now });
  const m1 = await bk.run({ reason: "manual" });
  assert.ok(existsSync(join(m1.dir, "archive.db.gz")) && existsSync(join(m1.dir, "mnemosyne.db.gz")) && existsSync(join(m1.dir, "memory.json")) && existsSync(join(m1.dir, "manifest.json")));
  assert.ok(m1.files["archive.db.gz"].sha256.length === 64); assert.equal(m1.counts.chains, 1); assert.equal(notes.length, 1);
  assert.equal((await bk.verify(m1.dir)).ok, true);
  // the scheduler: runs once at the hour, not twice in a day
  await bk.tick(); assert.equal(bk.list().length, 1, "same day: already backed up");
  now += 24 * 3600_000; await bk.tick(); assert.equal(bk.list().length, 2, "next day at 03: a new backup");
  now += 24 * 3600_000; await bk.tick(); assert.equal(bk.list().length, 2, "keep 2: the oldest rotated away");
  const st = bk.status(); assert.equal(st.count, 2); assert.equal(st.destinationExists, true); assert.ok(st.last.at > m1.at);
  // restore into a fresh folder and read back
  const target = join(root, "restored"); mkdirSync(target, { recursive: true });
  archive.close(); mn.close();
  const r = await bk.restoreFiles(bk.list()[0].dir, target);
  assert.ok(r.restored.includes("archive.db") && r.restored.includes("mnemosyne.db"));
  const a2 = new Archive({ file: join(target, "archive.db") }); assert.equal(a2.counts().turns, 1); a2.close();
  const m2 = new DatabaseSync(join(target, "mnemosyne", "mnemosyne.db")); assert.equal(m2.prepare("select count(*) c from working_memory").get().c, 2); m2.close();
  // a corrupted backup is refused
  const bad = bk.list()[0].dir; writeFileSync(join(bad, "archive.db.gz"), "garbage"); assert.equal((await bk.verify(bad)).ok, false);
  await assert.rejects(() => bk.restoreFiles(bad, target), /verification/);
  // consistentCopy works on a live WAL database
  const live = new DatabaseSync(join(root, "live.db")); live.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(x); INSERT INTO t VALUES (1),(2),(3);");
  const bytes = await consistentCopy(join(root, "live.db"), join(root, "live-copy.db")); assert.ok(bytes > 0);
  const c = new DatabaseSync(join(root, "live-copy.db")); assert.equal(c.prepare("select count(*) n from t").get().n, 3); c.close(); live.close();
  for (let i = 0; i < 10; i++) { try { rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise((res) => setTimeout(res, 200)); } }
});

// (fails before: yes — a backup with no memory folder open said "memory has no folder open (see the log)")
test("backup: with memory not started, a backup is refused in the service's words", async () => {
  const bk = new BackupManager({ service: { folder: null, archiveWhy: () => "Memory has not started." }, getConfig: () => ({ backups: { folder: "unused" } }) });
  await assert.rejects(bk.run(), /^Error: no archive: Memory has not started\.$/);
});

// (fails before: yes — the bug hunt of 10-30, MEMR-4: each database was deleted before its copy landed, so a copy that
// failed left the archive restored and the engine's database cut short: the archive held 1 turn, the backup's, not 2)
test("backup: a restore whose copy fails leaves every database as it was", async (t) => {
  const { folder, archive, mn, bk, dir } = await backedUp(t);
  archive.close();
  mn.close();
  // The engine's database cut short in the backup, its checksum the cut file's: a copy that fails partway.
  const gz = join(dir, "mnemosyne.db.gz");
  writeFileSync(gz, readFileSync(gz).subarray(0, 40));
  const man = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  man.files["mnemosyne.db.gz"].sha256 = sha(gz);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(man));
  await assert.rejects(bk.restoreFiles(dir, folder), /unexpected end of file/);
  assert.equal(turnsIn(folder), 2, "the archive as it was, not the backup's");
  const m = new DatabaseSync(join(folder, "mnemosyne", "mnemosyne.db"), { readOnly: true });
  try {
    assert.equal(m.prepare("select count(*) c from working_memory").get()?.c, 2, "the engine's database as it was");
  } finally {
    m.close();
  }
  assert.deepEqual([...readdirSync(folder), ...readdirSync(join(folder, "mnemosyne"))].filter((n) => /restoring/.test(n)), [], "no copy left beside them");
});

// (fails before: yes — the bug hunt of 10-30, MEMR-1: a -wal that could not be removed was passed over in silence, and
// the backup's database written into the file still open, beside the WAL of the one it replaced: the restore went
// through)
test("backup: a restore over a database something still holds is refused, and nothing is replaced", { skip: process.platform !== "win32" && "only Windows refuses to remove a file in use" }, async (t) => {
  const { folder, archive, mn, bk, dir } = await backedUp(t);
  archive.close(); // memory closes its archive; the engine's database is still open
  try {
    await assert.rejects(bk.restoreFiles(dir, folder), /EBUSY|EPERM/);
    assert.equal(mn.prepare("select count(*) c from working_memory").get()?.c, 2, "the open database untouched");
  } finally {
    mn.close();
  }
  assert.equal(turnsIn(folder), 2, "nor the archive replaced beside it");
});

// (fails before: yes — the bug hunt of 10-30, ADM-2 / MEMR-5: a manifest's bank name was taken as a path, so a backup
// made to look like one wrote its file outside the memory folder)
test("backup: a manifest that names a path, not a file of its own, is refused before anything is written", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "filament-bk-"));
  t.after(() => removeDirs(root));
  const folder = join(root, "memory");
  mkdirSync(folder, { recursive: true });
  const bk = new BackupManager({ service: { folder }, getConfig: () => ({}) });
  /** A backup at `name` whose manifest lists one file. @param {string} name @param {string} file */
  const crafted = (name, file) => {
    const dir = join(root, "backups", name);
    for (const d of [dir, dirname(join(dir, file))]) mkdirSync(d, { recursive: true });
    writeFileSync(join(dir, file), gzipSync(Buffer.from("no memory of yours")));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ version: 1, at: "2026-10-30T03:00:00.000Z", files: { [file]: { sha256: sha(join(dir, file)) } } }));
    return dir;
  };
  // Read from the backups folder and written to <root>/escape/mnemosyne.db, beside the memory folder.
  const out = crafted("filament-memory-out", "bank-../../../escape.db.gz");
  await assert.rejects(bk.restoreFiles(out, folder), /^Error: backup failed verification: bank-\.\.\/\.\.\/\.\.\/escape\.db\.gz: /);
  assert.equal(existsSync(join(root, "escape")), false, "nothing written outside the memory folder");
  // A bank named `..` is the engine's own database, one folder up.
  const up = crafted("filament-memory-up", "bank-...db.gz");
  await assert.rejects(bk.restoreFiles(up, folder), /^Error: backup failed verification: bank-\.\.\.db\.gz: /);
  assert.equal(existsSync(join(folder, "mnemosyne", "mnemosyne.db")), false);
});

// (fails before: yes — the bug hunt of 10-30, MEMR-9: the day was marked done before its backup ran, so one that failed
// was not tried again that day; and it left its unfinished folder on the list, a broken backup)
test("backup: a scheduled backup that fails is tried again at the next tick of its hour, and leaves no folder", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "filament-bk-"));
  const folder = join(root, "memory");
  mkdirSync(folder, { recursive: true });
  const archive = new Archive({ file: join(folder, "archive.db") });
  t.after(() => (archive.close(), removeDirs(root)));
  let busy = true;
  const service = { folder, archive: { backupTo: (/** @type {string} */ to) => (busy ? Promise.reject(new Error("database is locked")) : archive.backupTo(to)), counts: () => archive.counts() } };
  const dest = join(root, "backups");
  let now = new Date(2026, 9, 30, 3, 0, 30).getTime(); // local time: the scheduler compares local hours
  const bk = new BackupManager({ service, getConfig: () => ({ backups: { enabled: true, folder: dest, hour: 3, keep: 3 } }), now: () => now });
  await assert.rejects(bk.tick(), /database is locked/);
  assert.deepEqual(readdirSync(dest), [], "the backup that failed left no folder");
  busy = false;
  now += 60_000;
  await bk.tick();
  assert.deepEqual(bk.list().map((b) => !!b.broken), [false], "tried again at the next tick, and written");
});

// (fails before: yes — the bug hunt of 10-30, MEMR-9: a folder a backup left unfinished (Filament quit during it) has no
// manifest, sorted first, and the schedule stopped on it: "Cannot read properties of null (reading 'slice')")
test("backup: a folder a backup left unfinished does not stop the schedule", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "filament-bk-"));
  const folder = join(root, "memory");
  mkdirSync(folder, { recursive: true });
  const archive = new Archive({ file: join(folder, "archive.db") });
  t.after(() => (archive.close(), removeDirs(root)));
  const dest = join(root, "backups");
  mkdirSync(join(dest, "filament-memory-2026-10-29T22-00-05"), { recursive: true });
  const bk = new BackupManager({ service: { folder, archive }, getConfig: () => ({ backups: { enabled: true, folder: dest, hour: 3, keep: 3 } }), now: () => new Date(2026, 9, 30, 3, 0, 30).getTime() });
  await bk.tick();
  assert.equal(bk.list().filter((b) => !b.broken).length, 1, "the day's backup written");
});

// (fails before: yes — the bug hunt of 10-30, MEMR-1: memory's stop closed the engine without waiting for it, so the
// backup's databases went in while the engine's process still ran and held its own)
test("restore: the engine's process has ended before the backup's databases go in", () =>
  world({}, async (w) => {
    w.cfg.memory.backups = { folder: join(w.dir, "backups") };
    const b = await w.svc.backup();
    // An engine slow to end, as a real one checkpointing its database is: it does not end on being asked.
    w.svc.store.env = { ...w.svc.store.env, FAKE_SIDECAR_HANG_ON: "shutdown" };
    await w.svc.store.restart();
    const pid = Number(w.svc.store.status().pid);
    assert.ok(pid, "the engine runs");
    /** @type {boolean | null} */
    let running = null;
    const restoreFiles = w.svc.backups.restoreFiles.bind(w.svc.backups);
    w.svc.backups.restoreFiles = (/** @type {string} */ dir, /** @type {string} */ to) => {
      running = alive(pid);
      return restoreFiles(dir, to);
    };
    const out = await w.withEngine(() => w.svc.restore(b.dir));
    assert.deepEqual(out.restored, ["archive.db"]);
    assert.equal(running, false, "its process was gone when the files were replaced");
  }));
