// The archive's figures (`counts`: the Memory page's status, the Feature board, Get started): the messages' count and
// bytes are the totals the archive keeps as each message is written or deleted, never a pass over the messages on the
// server's thread; a file written before those totals has its messages counted once, on a thread of its own, and says
// it is counting until then.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Archive } from "../src/services/memory/archive.js";

const dir = mkdtempSync(join(tmpdir(), "filament-archive-counts-"));
let seq = 0;
/** @type {Archive[]} */
const opened = [];
const open = (/** @type {string} */ file) => {
  const a = new Archive({ file });
  opened.push(a);
  return a;
};
after(async () => {
  for (const a of opened) a.close();
  // A count a close stopped ends within its slice; its connection goes with it, and only then can the folder go.
  await Promise.all(opened.map((a) => a.messagesCounted()));
  rmSync(dir, { recursive: true, force: true });
});
const fileOf = () => join(dir, `a${++seq}.db`);
const say = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });
/** What the file holds, read on a connection of its own. @param {string} file */
const truth = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const r = /** @type {any} */ (db.prepare("SELECT COUNT(*) AS rows, COALESCE(SUM(bytes), 0) AS bytes FROM messages").get());
    return { messages: Number(r.rows), bytes: Number(r.bytes) };
  } finally {
    db.close();
  }
};
/** The SQL each statement the archive prepares from here on says. @param {Archive} a */
const preparedBy = (a) => {
  /** @type {string[]} */
  const said = [];
  const prepare = a.db.prepare.bind(a.db);
  a.db.prepare = (/** @type {string} */ sql) => (said.push(sql), prepare(sql));
  return said;
};
/**
 * A file as one written before the archive kept its messages' totals: `n` messages written straight into it, the
 * totals and their triggers taken out where it has them.
 * @param {string} file @param {number} n
 */
function writtenBefore(file, n) {
  new Archive({ file }).close();
  const db = new DatabaseSync(file);
  db.exec("BEGIN");
  const put = db.prepare("INSERT INTO messages (hash, role, kind, bytes, truncated, body, created_at) VALUES (?, 'user', 'text', ?, 0, ?, 0)");
  for (let i = 0; i < n; i++) {
    const body = `message ${i} ${"x".repeat(i % 97)}`;
    put.run(createHash("sha256").update(body).digest("hex"), Buffer.byteLength(body), body);
  }
  db.exec("COMMIT; DROP TRIGGER IF EXISTS message_kept; DROP TRIGGER IF EXISTS message_dropped; DROP TABLE IF EXISTS message_totals;");
  db.close();
}

// (fails before: yes — the owner's top complaint, Filament crawls: `counts()` ran COUNT(*) and SUM(bytes) over every
// message on the server's thread, 6.6 s cold and 1.0 s warm on 630,696 messages and 2.29 GB, at each read of the Memory
// page's status, the Feature board and Get started)
test("the figures read no message: the count and bytes are the totals the archive keeps as messages are written, deleted, rolled back", () => {
  const file = fileOf();
  const a = open(file);
  for (let i = 0; i < 40; i++) a.putMessage(i % 2 ? "assistant" : "user", say(`hello ${i} ${"y".repeat(i * 13)}`));
  // One over the cap: its bytes are the whole message's, as the row says.
  a.putMessage("user", say("z".repeat(1_100_000)));
  const said = preparedBy(a);
  const c = a.counts();
  assert.deepEqual([c.messages, c.bytes], [truth(file).messages, truth(file).bytes]);
  assert.equal(c.messages, 41);
  assert.ok(Number(c.bytes) > 1_100_000);
  assert.equal(c.counting, undefined, "nothing to count: the file kept its totals from its first message");
  assert.deepEqual(said.filter((sql) => /\bFROM\s+messages\b/i.test(sql)), [], "no statement of the figures reads the messages");

  // The same message again is no new row; a write rolled back is taken back; a row deleted by any statement goes.
  a.putMessage("user", say("hello 0 "));
  assert.throws(() =>
    a.transaction(() => {
      a.putMessage("user", say("rolled back"));
      throw new Error("no");
    }),
  );
  a.db.prepare("DELETE FROM messages WHERE rowid = (SELECT MIN(rowid) FROM messages)").run();
  const d = a.counts();
  assert.deepEqual([d.messages, d.bytes], [truth(file).messages, truth(file).bytes]);
  assert.equal(d.messages, 40);
  a.close();

  // Kept in the file: an opening after reads them as they were.
  const b = open(file);
  const e = b.counts();
  assert.deepEqual([e.messages, e.bytes, e.counting], [40, d.bytes, undefined]);
});

// (fails before: yes — the same: a file's figures were a pass over its messages at every read)
test("a file written before its totals says it is counting, counts its messages once off the server's thread — those written meanwhile once — and keeps them", async () => {
  const file = fileOf();
  // More than two slices of the count's.
  writtenBefore(file, 45_000);
  const a = open(file);
  const said = preparedBy(a);
  const c = a.counts();
  assert.deepEqual([c.messages, c.bytes, c.counting], [null, null, true], "the two figures wait for the count, and say so");
  assert.equal(c.chains, 0, "the other figures are there at once");
  assert.deepEqual(said.filter((sql) => /\bFROM\s+messages\b/i.test(sql)), [], "the server's thread reads no message to count them");

  // Written while the count runs, on the archive's own connection: before its snapshot or after, each counts once.
  for (let i = 0; i < 5; i++) a.putMessage("user", say(`during ${i}`));
  await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 5; i++) a.putMessage("assistant", say(`later ${i}`));
  await a.messagesCounted();
  const d = a.counts();
  assert.deepEqual([d.messages, d.bytes, d.counting], [truth(file).messages, truth(file).bytes, undefined]);
  assert.equal(d.messages, 45_010);

  a.putMessage("user", say("after the count"));
  assert.deepEqual([a.counts().messages, a.counts().bytes], [truth(file).messages, truth(file).bytes]);
  a.close();

  // Counted once: the next opening has its figures at once.
  const b = open(file);
  const e = b.counts();
  assert.deepEqual([e.messages, e.bytes, e.counting], [45_011, truth(file).bytes, undefined]);
});

// (fails before: yes — there was no count to stop)
test("an archive closed while its messages are counted stops the count, keeps nothing half-counted, and the file can go", async () => {
  const file = fileOf();
  writtenBefore(file, 45_000);
  const a = open(file);
  a.close();
  await a.messagesCounted();
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(/** @type {any} */ (db.prepare("SELECT counted FROM message_totals WHERE id = 1").get()).counted, 0, "a count a close stopped folds nothing in");
  db.close();
  // Counted again at the next opening, whole.
  const b = open(file);
  await b.messagesCounted();
  assert.deepEqual([b.counts().messages, b.counts().bytes], [truth(file).messages, truth(file).bytes]);
  b.close();
  await b.messagesCounted();
  // Windows keeps a file that a connection holds: the count's has closed.
  for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
  assert.equal(existsSync(file), false);
});
