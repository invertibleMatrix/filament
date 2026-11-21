// @ts-check
// The process an app's SQL runs in (core/app-sql.js), apart from Filament's: services/app-sql.js starts it, sends one
// statement at a time, and ends it at the statement's time — ending this process is what stops SQLite mid-query. Each
// app's database is its own file, opened once and kept open; its cap is set as it opens, then the authorizer holds what
// its SQL reaches (`sqlMay`), and a second statement in the same text is refused rather than left unrun.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, constants } from "node:sqlite";
import { SQL_ANSWER_MAX_BYTES, SQL_ROWS_MAX, SQL_STILL, SQL_TOO_BIG, aloneIn, sizeOut, sqlFailure, sqlMay, valueOut } from "../core/app-sql.js";

/** @type {Map<string, DatabaseSync>} */
const open = new Map();
/** The statement running now may only read (a still preview's): the authorizer holds it to that, as it is read and run. */
let reading = false;

/** An app's database, opened at its file with its cap. @param {string} file @param {number} maxMb */
function dbOf(file, maxMb) {
  const had = open.get(file);
  if (had) return had;
  // What its SQL reaches is held by the authorizer and by defensive mode: a Node without both runs none of it.
  const proto = /** @type {any} */ (DatabaseSync.prototype);
  if (typeof proto.setAuthorizer !== "function" || typeof proto.enableDefensive !== "function")
    throw new Error(`this Node (${process.version}) has no SQLite authorizer or defensive mode, which an app's database needs: Node 24 has both`);
  mkdirSync(dirname(file), { recursive: true });
  // A moment's wait for a file a process just ended still holds.
  const db = new DatabaseSync(file, { allowExtension: false, timeout: 2000 });
  db.exec("PRAGMA journal_mode=WAL");
  const pageSize = Number(/** @type {any} */ (db.prepare("PRAGMA page_size").get())?.page_size) || 4096;
  const pages = Math.max(1, Math.floor((maxMb * 1024 * 1024) / pageSize));
  // Its temporary tables are capped as its tables are: on disk, they would fill it uncapped.
  db.exec(`PRAGMA max_page_count=${pages}`);
  db.exec(`PRAGMA temp.max_page_count=${pages}`);
  db.enableDefensive(true);
  db.setAuthorizer((action, a, b) => (sqlMay(action, a, b, /** @type {any} */ (constants), reading) ? constants.SQLITE_OK : constants.SQLITE_DENY));
  open.set(file, db);
  return db;
}

/**
 * One statement run: its rows (SQL_ROWS_MAX at most, `more` where there were others) and their columns, or what it
 * changed. `readOnly`: it may only read (`reading`).
 * @param {{ file: string, sql: string, params?: any, maxMb: number, readOnly?: boolean }} q
 */
function run(q) {
  reading = q.readOnly === true;
  try {
    return runNow(q);
  } finally {
    reading = false;
  }
}

/** @param {{ file: string, sql: string, params?: any, maxMb: number }} q */
function runNow(q) {
  const db = dbOf(q.file, q.maxMb);
  const st = db.prepare(q.sql);
  if (!aloneIn(q.sql, st.sourceSQL)) return { ok: false, error: "Not run: one statement at a time — send the next one by itself." };
  st.setReadBigInts(true);
  // SQLite has no true or false: 1 and 0, as its own comparisons give.
  /** @type {(v: any) => import("node:sqlite").SQLInputValue} */
  const bound = (v) => (typeof v === "boolean" ? Number(v) : v);
  /** @type {any[]} */
  const args = q.params == null ? [] : Array.isArray(q.params) ? q.params.map(bound) : [Object.fromEntries(Object.entries(q.params).map(([k, v]) => [k, bound(v)]))];
  const columns = st.columns().map((c) => c.name);
  if (!columns.length) {
    // SQLite keeps the count and row id of the last statement that changed rows: one that changed none (a CREATE, an
    // UPDATE that matched nothing) says none, not the last INSERT's.
    const total = () => Number(/** @type {any} */ (db.prepare("SELECT total_changes() AS n").get())?.n);
    const before = total();
    const r = st.run(...args);
    const moved = total() !== before;
    return { ok: true, rows: [], columns, changes: moved ? Number(r.changes) : 0, lastId: moved ? valueOut(r.lastInsertRowid) : null, more: false };
  }
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  let more = false;
  let bytes = 0;
  for (const row of st.iterate(...args)) {
    if (rows.length === SQL_ROWS_MAX) {
      more = true;
      break;
    }
    const out = Object.fromEntries(Object.entries(/** @type {any} */ (row)).map(([k, v]) => [k, valueOut(v)]));
    for (const [k, v] of Object.entries(out)) bytes += sizeOut(k) + 1 + sizeOut(v);
    // Never carried whole through Filament's own process: an answer past its most is refused here.
    if (bytes > SQL_ANSWER_MAX_BYTES) return { ok: false, error: SQL_TOO_BIG };
    rows.push(out);
  }
  return { ok: true, rows, columns, changes: 0, lastId: null, more };
}

process.on("message", (/** @type {any} */ m) => {
  if (m?.close) {
    const db = open.get(m.close);
    open.delete(m.close);
    try {
      db?.close();
    } catch {}
    process.send?.({ id: m.id, ok: true });
    return;
  }
  /** @type {any} */
  let answer;
  try {
    answer = run(m);
  } catch (/** @type {any} */ e) {
    answer = { ok: false, error: m.readOnly === true && /not authorized|authorization denied/i.test(String(e?.message)) ? `${SQL_STILL}.` : sqlFailure(e?.message, m.maxMb) };
  }
  process.send?.({ id: m.id, ...answer });
});
process.on("disconnect", () => process.exit(0));
