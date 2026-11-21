// @ts-check
// A copy of a turn with its own final line leaves what the turn has not opened unopened (core/lazy.js `lazyOver`): a
// spread read every lazy property, and a turn a restart cut off, copied with its line by modelTurnsOf, opened every
// message of its work at each listing of the session's turns, a reader of the turns' marks alone too (the owner's of
// 11-17: a long chat's sizes held the server 12 s, its ten cut-off turns' 5,772 messages opened at each of its views).
// What the copy holds, once read, is what the spread held, in the same order.
// (fails before: yes — modelTurnsOf opened a cut-off turn's messages as it listed it)
import { test } from "node:test";
import assert from "node:assert/strict";
import { lazy, lazyOver } from "../src/core/lazy.js";
import { modelTurnsOf, CUT_OFF_LINE } from "../src/app/sessions/shapes.js";

/** A turn as the archive lists it (archive.js `turnBodies`): its messages opened on first read, each counted — an open
 *  turn has no final answer to open. */
const listed = (/** @type {Record<string, any>} */ row, /** @type {{ n: number }} */ opens) =>
  lazy(lazy(lazy({ ...row }, "user", () => (opens.n++, { role: "user", content: `asked ${row.n}` })), "work", () => (opens.n++, [{ role: "assistant", content: `did ${row.n}` }])), "final", () => (row.finished ? (opens.n++, { role: "assistant", content: `said ${row.n}` }) : null));

test("lazyOver: the spread's properties, in its order, its patch over them; what the original has not read stays unread until the copy's is, then is the same value", () => {
  let loads = 0;
  const o = lazy({ n: 1, meta: { a: 1 } }, "work", () => (loads++, ["w"]));
  const copy = lazyOver(o, { meta: { a: 2 }, final: "f" });
  assert.equal(loads, 0, "nothing read by the copy");
  assert.deepEqual(Object.keys(copy), Object.keys({ ...{ n: 1, meta: 0, work: 0 }, final: 0 }), "the spread's order");
  assert.deepEqual(copy, { n: 1, meta: { a: 2 }, work: ["w"], final: "f" });
  assert.equal(loads, 1);
  assert.equal(copy.work, o.work, "one value, read once, for both");
  assert.equal(loads, 1);
  // What the original had read already is a plain property of the copy; a patch wins over a lazy one unread.
  const read = lazy({ n: 2 }, "work", () => (loads++, ["x"]));
  void read.work;
  const both = lazyOver(read, { work: [] });
  assert.deepEqual([both.work, loads], [[], 2]);
  const plain = lazyOver(read, {});
  assert.equal(Object.getOwnPropertyDescriptor(plain, "work")?.value, read.work);
});

test("modelTurnsOf opens no message of a turn a restart cut off until it is read", () => {
  const opens = { n: 0 };
  const BOOT = 1_000;
  const bodies = [
    listed({ n: 1, finished: true, meta: {} }, opens),
    listed({ n: 2, finished: false, meta: { running: 10 } }, opens),
    listed({ n: 3, finished: false, meta: { running: 20 } }, opens),
    listed({ n: 4, finished: true, meta: { command: true } }, opens),
  ];
  const turns = modelTurnsOf(/** @type {any[]} */ (bodies), BOOT);
  assert.deepEqual(turns.map((t) => t.n), [1, 2, 3]);
  assert.equal(opens.n, 0, "listing them opened no message");
  assert.deepEqual(turns[1].final, { role: "assistant", content: CUT_OFF_LINE });
  assert.equal(turns[1].meta.cutOff, true);
  assert.equal(opens.n, 0, "its line and its marks are its own");
  assert.deepEqual(turns[1].work, [{ role: "assistant", content: "did 2" }]);
  assert.equal(opens.n, 1, "its work opened as it is read");
});

test("what modelTurnsOf gives, read whole, is what the spread gave: every kind of turn", () => {
  const BOOT = 1_000;
  const rows = [
    { n: 1, finished: true, meta: {} },
    { n: 2, finished: false, meta: { running: 10 } },
    { n: 3, finished: false, meta: { failed: { cause: "the model's call failed", text: "half" } } },
    { n: 4, finished: true, meta: { facts: { stopReason: "refusal" } } },
    { n: 5, finished: false, meta: { running: 5_000 } },
    { n: 6, finished: true, meta: { rewound: true } },
  ];
  const now = modelTurnsOf(/** @type {any[]} */ (rows.map((r) => listed(r, { n: 0 }))), BOOT);
  // The spread's copies, read whole: the archive's turns opened, then each copied as modelTurnsOf did before.
  const eager = rows.map((r) => ({ ...listed(r, { n: 0 }) }));
  const before = modelTurnsOf(/** @type {any[]} */ (eager), BOOT);
  assert.deepEqual(JSON.parse(JSON.stringify(now)), JSON.parse(JSON.stringify(before)));
  assert.deepEqual(now.map((t) => Object.keys(t)), before.map((t) => Object.keys(t)), "in the same order");
});
