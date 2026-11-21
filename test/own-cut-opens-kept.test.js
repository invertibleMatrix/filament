// @ts-check
// The turn a coding agent compacted its own context in is cut where its summary ends (compaction.js
// `afterOwnCompaction`), and a turn as the archive lists it opens its work from there on alone, the place kept and
// proved at each use by the names of the work up to it (archive.js `workFrom`): each read of a long chat's views opened
// the whole turn to keep what follows the cut (the owner's of 11-17: 3,616 messages opened to keep 146, seconds of the
// server held at each read). What the cut gives is what it gave read whole, in the same order; a turn whose work was
// set anew is cut where its work now says; a call it no longer holds leaves it whole, its work opened once; a turn
// whose work is opened already is cut from it, opening nothing.
// (fails before: yes — every cut opened the turn's whole work)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { afterOwnCompaction, copyTurns, ROUNDS_LINE, ownCompactionMark } from "../src/app/sessions/compaction.js";

/** A turn's work of `calls` rounds: the model's call, then its result; the person's words ride with one result. @param {number} calls @param {string} tag */
const rounds = (calls, tag) =>
  Array.from({ length: calls }, (_, i) => [
    { role: "assistant", content: [{ type: "text", text: `${tag} step ${i}` }, { type: "tool_use", id: `c${i}`, name: "Bash", input: { command: `echo ${tag} ${i}` } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `c${i}`, content: `${tag} out ${i}` }, ...(i === 7 ? [{ type: "text", text: "and the tests too" }] : [])] },
  ]).flat();

/** An archive with one finished turn of `calls` rounds, its messages opened counted. @param {number} calls */
function archiveWith(calls) {
  const dir = mkdtempSync(join(tmpdir(), "filament-own-cut-"));
  const a = /** @type {any} */ (new Archive({ file: join(dir, "a.db") }));
  const chain = a.chainForKey("k-own-cut", { cwd: "C:\\widgets", client: "harness", model: "m" }).id;
  const { turnId } = a.beginTurn(chain, { requestId: "r1", userMessage: { role: "user", content: "fix it" } });
  a.addWork(turnId, rounds(calls, "first"));
  a.finishTurn(turnId, { finalMessage: { role: "assistant", content: "Done." }, outputChars: 5 });
  const count = { opened: 0 };
  const get = a.getMessage.bind(a);
  a.getMessage = (/** @type {string} */ h) => (count.opened++, get(h));
  const listed = () => a.turnBodies(chain)[0];
  return { a, chain, turnId, count, listed, done: () => (a.close(), rmSync(dir, { recursive: true, force: true })) };
}

/** A compaction's head made during turn 1, its summary ending after the call `cutAfter`. @param {string | null} cutAfter */
const headAt = (cutAfter) => ({ detail: { during: 1, cutAfter, by: "Claude Code" } });
/** What a copy holds, read whole, and its keys' order. @param {any} t */
const whole = (t) => ({ value: JSON.parse(JSON.stringify(t)), keys: Object.keys(t) });

test("the cut of a listed turn is the cut of the turn read whole; a later one opens only what it keeps", () => {
  const { count, listed, done } = archiveWith(200);
  try {
    // The turn read whole first (a spread has no `workFrom`): the cut as it always was.
    const before = afterOwnCompaction({ ...listed() }, headAt("c150"));
    count.opened = 0;
    const first = afterOwnCompaction(listed(), headAt("c150"));
    assert.equal(count.opened, 400, "the first cut opens the work up to the cut, then what it keeps");
    assert.deepEqual(whole(first), whole(before));
    count.opened = 0;
    const again = afterOwnCompaction(listed(), headAt("c150"));
    // c150's result is message 301 of 400: it and the 98 after it.
    assert.equal(count.opened, 99, "a later cut opens the call's results and what follows them alone");
    assert.deepEqual(whole(again), whole(before));
    assert.equal(count.opened, 101, "read whole, the copy opens the person's message and the reply as it is read, not before");
    assert.deepEqual(again.work.slice(0, 2), [
      { role: "assistant", content: [{ type: "text", text: ROUNDS_LINE }] },
      { role: "user", content: [{ type: "text", text: ownCompactionMark("Claude Code") }] },
    ]);
    // Another call of the same turn is a place of its own.
    count.opened = 0;
    const early = afterOwnCompaction(listed(), headAt("c7"));
    assert.deepEqual(whole(early), whole(afterOwnCompaction({ ...listed() }, headAt("c7"))));
    assert.deepEqual(early.work[1].content.map((/** @type {any} */ b) => b.text), [ownCompactionMark("Claude Code"), "and the tests too"], "the person's words that came with the results stay with the mark");
  } finally {
    done();
  }
});

test("the blocks the cut keeps are named as the turn read whole names them, so their weights are known across compositions", () => {
  const { a, listed, done } = archiveWith(20);
  try {
    void afterOwnCompaction(listed(), headAt("c10"));
    const cut = afterOwnCompaction(listed(), headAt("c10"));
    const kept = cut.work.slice(2).flatMap((/** @type {any} */ m) => m.content);
    assert.ok(kept.length > 0);
    for (const b of kept) assert.match(String(a.contentName(b)), /^[0-9a-f]+:\d+$/);
  } finally {
    done();
  }
});

test("a turn whose work was set anew is cut where its work now says; a place is kept only behind messages the archive holds", () => {
  const { a, turnId, count, listed, done } = archiveWith(50);
  try {
    void afterOwnCompaction(listed(), headAt("c30"));
    // The work replaced whole: the same calls, other words — the place kept no longer proves itself.
    a.setWork(turnId, rounds(50, "second"));
    count.opened = 0;
    const now = afterOwnCompaction(listed(), headAt("c30"));
    assert.equal(count.opened, 100, "found again, as the first time");
    assert.deepEqual(whole(now), whole(afterOwnCompaction({ ...listed() }, headAt("c30"))));
    assert.equal(now.work[2].content[0].text, "second step 31");
    // A message before the cut the archive does not hold: the cut is found, and not kept.
    const gone = a.getTurn(turnId).work[3];
    a.db.prepare("DELETE FROM messages WHERE hash = ?").run(gone);
    count.opened = 0;
    const missing = afterOwnCompaction(listed(), headAt("c40"));
    assert.deepEqual(whole(missing), whole(afterOwnCompaction({ ...listed() }, headAt("c40"))));
    count.opened = 0;
    void afterOwnCompaction(listed(), headAt("c40"));
    assert.equal(count.opened, 100, "not kept: looked for again from the top");
  } finally {
    done();
  }
});

test("a call the turn no longer holds leaves it whole, its work opened once, nothing kept", () => {
  const { count, listed, done } = archiveWith(30);
  try {
    const t = listed();
    count.opened = 0;
    assert.equal(afterOwnCompaction(t, headAt("x9")), t, "the turn itself");
    assert.equal(count.opened, 60);
    assert.equal(t.work.length, 60, "its work is what was opened");
    assert.equal(count.opened, 60, "opened once");
    assert.deepEqual(whole(t), whole({ ...listed() }));
    count.opened = 0;
    void afterOwnCompaction(listed(), headAt("x9"));
    assert.equal(count.opened, 60, "nothing kept for a call not found");
    // No call to cut after: the whole work follows the mark, as it always did.
    const none = afterOwnCompaction(listed(), headAt(null));
    assert.deepEqual(whole(none), whole(afterOwnCompaction({ ...listed() }, headAt(null))));
  } finally {
    done();
  }
});

test("a turn whose work is opened already is cut from it: nothing opened again, its own messages kept", () => {
  const { count, listed, done } = archiveWith(30);
  try {
    // Its work read before the cut.
    const t = listed();
    const work = t.work;
    count.opened = 0;
    const cut = afterOwnCompaction(t, headAt("c20"));
    assert.equal(count.opened, 0);
    assert.equal(cut.work[2], work[42], "the turn's own message, not another copy");
    assert.deepEqual(whole(cut), whole(afterOwnCompaction({ ...listed() }, headAt("c20"))));
    // One listing cut twice for a call it does not hold: the first opens its work, the second nothing.
    const u = listed();
    count.opened = 0;
    assert.equal(afterOwnCompaction(u, headAt("x9")), u);
    assert.equal(afterOwnCompaction(u, headAt("x9")), u);
    assert.equal(count.opened, 60);
  } finally {
    done();
  }
});

test("a place kept, then a message before it gone: the cut is the turn's read whole; two answers to one call: the cut is at the first", () => {
  const { a, turnId, chain, listed, done } = archiveWith(20);
  try {
    void afterOwnCompaction(listed(), headAt("c12"));
    a.db.prepare("DELETE FROM messages WHERE hash = ?").run(a.getTurn(turnId).work[4]);
    assert.deepEqual(whole(afterOwnCompaction(listed(), headAt("c12"))), whole(afterOwnCompaction({ ...listed() }, headAt("c12"))));
    // A call answered twice (the result kept cut, then whole): the first answer is where the summary ends.
    const { turnId: twice } = a.beginTurn(chain, { requestId: "r2", userMessage: { role: "user", content: "again" } });
    a.addWork(twice, [
      { role: "assistant", content: [{ type: "tool_use", id: "d1", name: "Bash", input: { command: "ls" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "d1", content: "a (cut)" }] },
      { role: "assistant", content: [{ type: "text", text: "between" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "d1", content: "a b c" }] },
      { role: "assistant", content: [{ type: "text", text: "after" }] },
    ]);
    a.finishTurn(twice, { finalMessage: { role: "assistant", content: "Done." }, outputChars: 5 });
    const second = () => a.turnBodies(chain).find((/** @type {any} */ t) => t.turnId === twice);
    for (let k = 0; k < 2; k++) {
      const cut = afterOwnCompaction(second(), headAt("d1"));
      assert.deepEqual(whole(cut), whole(afterOwnCompaction({ ...second() }, headAt("d1"))));
      assert.deepEqual(cut.work.slice(2).map((/** @type {any} */ m) => m.content[0].text ?? m.content[0].content), ["between", "a b c", "after"]);
    }
  } finally {
    done();
  }
});

test("the copy's turns, as composed: only the head's turn is cut, the same whichever way it is read", () => {
  const { listed, done } = archiveWith(12);
  try {
    const head = { id: 3, to_turn: 0, text: "the summary", detail: { during: 1, cutAfter: "c5", by: "Claude Code" } };
    const viaArchive = copyTurns([listed()], [head]);
    const viaSpread = copyTurns([{ ...listed() }], [head]);
    assert.deepEqual(viaArchive.map(whole), viaSpread.map(whole));
    assert.equal(viaArchive[0].work.length, 2 + 12);
  } finally {
    done();
  }
});
