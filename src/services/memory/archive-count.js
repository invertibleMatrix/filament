// @ts-check
// An archive's messages counted whole, on a thread of their own: the one count a file needs whose messages were
// written before their running totals were kept (archive.js `MESSAGE_TOTALS`). It reads beside the archive's own
// connection, which WAL lets go on writing meanwhile. The totals row and every message are read in one snapshot, so
// what the triggers added to the row by then is told apart from what was there before them: the answer is the
// messages the row does not hold yet. Read in slices, `stop` looked at between two: an archive that closes ends the
// count within one slice, and this connection closes with it.
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

/** How many messages one slice reads. */
const SLICE = 20_000;
const { file, stop } = /** @type {{ file: string, stop: Int32Array }} */ (workerData);
const db = new DatabaseSync(file, { readOnly: true });
try {
  db.exec("PRAGMA busy_timeout=5000; BEGIN");
  const kept = /** @type {any} */ (db.prepare("SELECT rows, bytes FROM message_totals WHERE id = 1").get());
  const slice = db.prepare(
    "SELECT MAX(id) AS last, COUNT(*) AS rows, COALESCE(SUM(bytes), 0) AS bytes FROM (SELECT rowid AS id, bytes FROM messages WHERE rowid > ? ORDER BY rowid LIMIT ?)",
  );
  let rows = 0,
    bytes = 0,
    whole = false;
  // Below any rowid SQLite gives.
  let after = Number.MIN_SAFE_INTEGER;
  while (!Atomics.load(stop, 0)) {
    const s = /** @type {any} */ (slice.get(after, SLICE));
    if (!Number(s.rows)) {
      whole = true;
      break;
    }
    rows += Number(s.rows);
    bytes += Number(s.bytes);
    after = Number(s.last);
  }
  db.exec("COMMIT");
  if (whole) parentPort?.postMessage({ rows: rows - Number(kept?.rows || 0), bytes: bytes - Number(kept?.bytes || 0) });
} finally {
  db.close();
}
