// @ts-check
// When a turn of a chat last started (archive `lastStartedAt`), which a compaction's Undo reads on every transcript
// read: the newest turn's row says it — its first start, or the start of a request that went on in it since
// (`meta.lastStart`, a failed try's retry). A retry goes on in the chat's newest open row, and no compaction of
// Filament's is made while an older one's request runs, so no row behind the newest holds a later start that counts. The
// read was a scan of every row's meta of the chat (the decision of 11-02: the newest row alone).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";

const dir = mkdtempSync(join(tmpdir(), "filament-last-start-"));
let clock = 1_758_000_000_000;
/** The archive, its turns begun as memory begins them (beginTurn's JSDoc names no message). @type {any} */
const a = new Archive({ file: join(dir, "a.db"), now: () => (clock += 1000) });
after(() => {
  a.close();
  rmSync(dir, { recursive: true, force: true });
});
const user = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });

// (fails before: yes — the read scanned every row of the chat: an older row's mark, 1_758_000_100_000, was taken for the
// chat's last start over the newest row's)
test("the newest row says when a turn last started: its first start, or its retry's; the rows behind it are not read", () => {
  const c = a.chainForKey("n:last", { client: "harness" });
  assert.equal(a.lastStartedAt(c.id), 0, "before its first turn");
  const one = a.beginTurn(c.id, { userMessage: user("first"), running: true });
  const two = a.beginTurn(c.id, { userMessage: user("second"), running: true });
  const second = a.turnBodies(c.id).at(-1);
  assert.equal(a.lastStartedAt(c.id), Number(second.startedAt), "the newest row's start");
  // A mark on a row behind the newest is no read of the newest row's.
  a.mergeTurnMeta(one.turnId, { lastStart: 1_758_000_100_000 });
  assert.equal(a.lastStartedAt(c.id), Number(second.startedAt), "only the newest row is read");
  // The retry of the newest, still open: its start is the newest.
  const again = a.beginTurn(c.id, { userMessage: user("second"), running: true });
  assert.equal(again.turnId, two.turnId, "the retry goes on in the newest row");
  const retried = Number(a.turnBodies(c.id).at(-1).meta?.lastStart);
  assert.ok(retried > Number(second.startedAt));
  assert.equal(a.lastStartedAt(c.id), retried, "its retry's start");
});
