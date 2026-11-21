// @ts-check
// An existing Mnemosyne database (a Hermes install, a backup, any path) → a consistent copy into
// <memory folder>/mnemosyne/mnemosyne.db. Memories, not chats: the one import that is no source of sessions.
import * as sqlite from "node:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandHome, isFile, noop } from "./sink.js";

export const MNEMOSYNE_TABLES = ["working_memory", "episodic_memory", "canonical_facts", "triples"];

// Seeds the managed engine from an existing Mnemosyne database (a Hermes install, a backup, any path) with SQLite's
// online backup — a plain file copy of a WAL database misses everything still in the -wal file. The copy lands at
// <memoryFolder>/mnemosyne/mnemosyne.db; an existing non-empty database there is kept unless { replace: true }. It is
// taken beside that database and read back there, and takes its place only then: a copy that fails (a source that is
// no database, a copy inside WSL that did not finish) leaves the database there as it was.
// Returns { file, bytes, mode, tables, rows, skippedTables, counts: { working_memory, episodic_memory, canonical_facts,
// triples } } read back from the copy (null for a table that is missing or cannot be read, e.g. vec0 virtual tables).
// The copied vector index is not usable by this install: the caller must run the engine's `reindex` afterwards.
// `rate` is the number of pages copied per step; progress is reported between steps.
/** @param {{ srcFile?: string, memoryFolder?: string, onProgress?: (p: any) => void, replace?: boolean, rate?: number }} [o] */
export async function importMnemosyneDb({
  srcFile,
  memoryFolder,
  onProgress = noop,
  replace = false,
  rate = 256,
} = {}) {
  if (!srcFile || !memoryFolder) throw new Error("importMnemosyneDb: srcFile and memoryFolder are required");
  srcFile = expandHome(srcFile);
  memoryFolder = expandHome(memoryFolder);
  if (!isFile(srcFile)) throw new Error(`importMnemosyneDb: ${srcFile} not found`);
  const dir = join(memoryFolder, "mnemosyne"),
    dest = join(dir, "mnemosyne.db");
  if (resolve(srcFile) === resolve(dest))
    throw new Error("importMnemosyneDb: source and destination are the same file");
  if (existsSync(dest) && statSync(dest).size > 0 && !replace)
    throw new Error(
      `importMnemosyneDb: ${dest} already holds a database; pass { replace: true } to overwrite it`,
    );
  mkdirSync(dir, { recursive: true });
  const copy = `${dest}.importing`;
  const copyFiles = [copy, `${copy}-wal`, `${copy}-shm`, `${copy}-journal`];
  for (const f of copyFiles) rmSync(f, { force: true });
  onProgress({ step: "mnemosyne", message: "opening source", percent: 0 });
  // A database inside WSL (\\wsl.localhost\<distro>\...) cannot be locked from Windows ("database is locked" over
  // the 9P share), so the consistent copy is taken by SQLite inside that distro and handed over through /mnt.
  const wsl = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\(.+)$/i.exec(srcFile);
  let mode = "read-only";
  /** @type {{ tables: { name: string, sql: string | null }[], rows: Record<string, number>, skippedTables: string[] }} */
  let read;
  try {
    if (wsl) {
      mode = "wsl-backup";
      await wslBackup(wsl[1], "/" + wsl[2].replace(/\\/g, "/"), copy, onProgress);
    } else {
      // Read-only when the file allows it; a plain open otherwise (the backup API only ever reads the source).
      /** @type {any} */
      let src = null;
      try {
        src = new sqlite.DatabaseSync(srcFile, { readOnly: true });
        src.prepare("SELECT count(*) AS n FROM sqlite_master").get();
      } catch {
        try {
          src?.close();
        } catch {}
        src = new sqlite.DatabaseSync(srcFile);
        mode = "read-write";
      }
      try {
        const progress = (/** @type {{ totalPages: number, remainingPages: number }} */ { totalPages, remainingPages }) =>
          onProgress({
            step: "mnemosyne",
            message: "copying pages",
            percent: totalPages ? Math.round(((totalPages - remainingPages) / totalPages) * 100) : 0,
            done: totalPages - remainingPages,
            total: totalPages,
          });
        if (typeof sqlite.backup === "function") await sqlite.backup(src, copy, { rate, progress });
        else if (typeof src.backup === "function") await src.backup(copy, { rate, progress });
        else src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
      } finally {
        src.close();
      }
    }
    read = readBack(copy);
    for (const f of [`${dest}-wal`, `${dest}-shm`, `${dest}-journal`]) rmSync(f, { force: true });
    renameSync(copy, dest);
  } catch (e) {
    for (const f of copyFiles)
      try {
        rmSync(f, { force: true });
      } catch {}
    throw e;
  }
  const { tables, rows, skippedTables } = read;
  const counts = Object.fromEntries(MNEMOSYNE_TABLES.map((k) => [k, rows[k] ?? null]));
  onProgress({ step: "mnemosyne", message: "copy complete", percent: 100, done: 1, total: 1 });
  return {
    file: dest,
    bytes: statSync(dest).size,
    mode,
    tables: tables.map((t) => t.name),
    rows,
    skippedTables,
    counts,
    reindex: true,
  };
}

/**
 * A copied database's tables and the rows of each, read back from the copy itself and closed: a vec0 virtual table, or
 * one that cannot be read, is passed over and named. @param {string} file
 */
function readBack(file) {
  const db = new sqlite.DatabaseSync(file);
  try {
    const tables = /** @type {{ name: string, sql: string | null }[]} */ (
      db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    );
    /** @type {Record<string, number>} */
    const rows = {};
    /** @type {string[]} */
    const skippedTables = [];
    for (const t of tables) {
      if (/\bUSING\s+vec0\b/i.test(t.sql || "")) {
        skippedTables.push(t.name);
        continue;
      }
      try {
        rows[t.name] = Number(/** @type {any} */ (db.prepare(`SELECT count(*) AS n FROM "${t.name.replace(/"/g, '""')}"`).get()).n);
      } catch {
        skippedTables.push(t.name);
      }
    }
    return { tables, rows, skippedTables };
  } finally {
    db.close();
  }
}

// The copy inside the distro: bash runs the Python with the paths as its arguments ($1 the source, $2 the temp copy, $3
// its place under /mnt), so no character of a path — a quote, a `$` — is ever read as shell or Python. The source is
// opened read-only through a URI, its path escaped as one.
const WSL_COPY = 'python3 -c "$0" "$1" "$2" && cp "$2" "$3" && rm -f "$2"';
const WSL_BACKUP_PY =
  "import sqlite3, sys, urllib.parse; src = sqlite3.connect('file:' + urllib.parse.quote(sys.argv[1]) + '?mode=ro', uri=True); dst = sqlite3.connect(sys.argv[2]); src.backup(dst); dst.close(); src.close(); print('backup ok')";

// SQLite's online backup run inside a WSL distro (python3 ships with Ubuntu), written to a temp file there and copied
// to the Windows destination through /mnt/<drive>. `linuxSrc` is the path inside the distro.
/** @param {string} distro @param {string} linuxSrc @param {string} dest @param {(p: any) => void} [onProgress] */
export async function wslBackup(distro, linuxSrc, dest, onProgress = noop) {
  const { spawnSync } = await import("node:child_process");
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(dest);
  if (!m) throw new Error(`importMnemosyneDb: destination must be a Windows drive path, got ${dest}`);
  const mnt = `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
  const tmp = `/tmp/filament-import-${Date.now().toString(36)}.db`;
  onProgress({ step: "mnemosyne", message: `consistent copy inside WSL (${distro})`, percent: 10 });
  const r = spawnSync("wsl.exe", ["-d", distro, "-e", "bash", "-lc", WSL_COPY, WSL_BACKUP_PY, linuxSrc, tmp, mnt], {
    encoding: "utf8",
    timeout: 600_000,
    windowsHide: true,
  });
  if (r.status !== 0 || !existsSync(dest))
    throw new Error(
      `importMnemosyneDb: the copy inside WSL failed: ${(r.stderr || r.stdout || `exit ${r.status}`).trim().slice(0, 300)}`,
    );
  onProgress({ step: "mnemosyne", message: "copy complete", percent: 90 });
  return statSync(dest).size;
}
