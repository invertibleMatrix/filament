// @ts-check
// Answers kept by what they rest on (core/kept-answers.js; the 10-29 speed pass): a run's changes answer read once
// while its rounds, its gone places and its places alone stay, then read anew; one under way serves every ask; a
// failed read is not kept; the store keeps its most keys and answers, the one asked longest ago going first.
// (fails before: yes — the module is new: each files card and the header read their run's turn with git at every ask)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { keptAnswers } from "../src/core/kept-answers.js";
import { RUN_CHANGES_KEPT, rowsOf } from "../src/http/admin/runs.js";
import { readFileSync } from "node:fs";

describe("answers kept by what they rest on", () => {
  test("one read while the basis holds, one under way serving every ask; a moved basis reads anew; a failed read is not kept", async () => {
    const kept = keptAnswers({ most: 4, perKey: 4 });
    let reads = 0;
    /** @param {string} v */
    const read = (v) => async () => {
      reads++;
      return v;
    };
    const [a, b] = await Promise.all([kept.get("run", "2 rounds", "whole", read("A")), kept.get("run", "2 rounds", "whole", read("B"))]);
    assert.deepEqual([a, b, reads], ["A", "A", 1], "the read under way served both");
    assert.equal(await kept.get("run", "2 rounds", "whole", read("C")), "A");
    assert.equal(await kept.get("run", "2 rounds", "notes.md", read("D")), "D", "another query, read");
    assert.equal(await kept.get("run", "3 rounds", "whole", read("E")), "E", "a round more: read anew");
    assert.equal(await kept.get("run", "3 rounds", "notes.md", read("F")), "F", "what rested on the old basis went with it");
    reads = 0;
    await assert.rejects(kept.get("run", "3 rounds", "broken", async () => { reads++; throw new Error("git failed"); }));
    assert.equal(await kept.get("run", "3 rounds", "broken", read("G")), "G", "a failed read is read again");
  });

  test("the store keeps its most keys and answers under each, the one asked longest ago going first", async () => {
    const kept = keptAnswers({ most: 2, perKey: 2 });
    const v = (/** @type {string} */ s) => async () => s;
    await kept.get("r1", "b", "q", v("1"));
    await kept.get("r2", "b", "q", v("2"));
    await kept.get("r1", "b", "q", v("x"));
    await kept.get("r3", "b", "q", v("3"));
    assert.equal(kept.size(), 2);
    assert.deepEqual([await kept.get("r1", "b", "q", v("again")), await kept.get("r2", "b", "q", v("anew"))], ["1", "anew"], "r1 asked last stayed; r2 went");
    await kept.get("k", "b", "q1", v("1"));
    await kept.get("k", "b", "q2", v("2"));
    await kept.get("k", "b", "q1", v("x"));
    await kept.get("k", "b", "q3", v("3"));
    assert.deepEqual([await kept.get("k", "b", "q1", v("y")), await kept.get("k", "b", "q2", v("anew"))], ["1", "anew"]);
  });

  // (fails before: yes — the review of 11-19: a store kept 64 runs' answers of any size, a whole of 22.8 MB among them)
  test("a budget: each answer weighed once it came; past it the keys asked longest ago go, never the one just weighed", async () => {
    const kept = keptAnswers({ most: 10, perKey: 4, budget: 10, weigh: (/** @type {number} */ n) => n });
    const v = (/** @type {number} */ n) => async () => n;
    await kept.get("a", "b", "q", v(4));
    await kept.get("b", "b", "q", v(4));
    assert.deepEqual([kept.size(), kept.weight()], [2, 8]);
    await kept.get("c", "b", "q", v(4));
    assert.deepEqual([kept.size(), kept.weight()], [2, 8], "a went: the one asked longest ago");
    assert.equal(await kept.get("b", "b", "q", v(99)), 4, "b kept");
    assert.equal(await kept.get("a", "b", "q", v(1)), 1, "a read again");
    await new Promise((r) => setImmediate(r));
    assert.equal(kept.weight(), 9, "b and c, then a: 4 + 4 + 1");
    // One that alone weighs past the budget stays, and every other goes.
    await kept.get("big", "b", "q", v(25));
    assert.deepEqual([kept.size(), kept.weight()], [1, 25]);
    assert.equal(await kept.get("big", "b", "q", v(0)), 25);
    // A moved basis, an answer trimmed under its key, a failed read and one refused weigh nothing more.
    await kept.get("big", "moved", "q", v(2));
    assert.equal(kept.weight(), 2, "the old basis's weight let go");
    for (const q of ["q1", "q2", "q3", "q4"]) await kept.get("big", "moved", q, v(1));
    assert.equal(kept.weight(), 4, "four answers a key: the first trimmed, its weight with it");
    await assert.rejects(kept.get("big", "moved", "bad", async () => { throw new Error("no"); }));
    await kept.get("big", "moved", "refused", v(7), () => false);
    await new Promise((r) => setImmediate(r));
    assert.equal(kept.weight(), 3, "q1 trimmed for 'bad', which failed; 'refused' not kept");
    // An answer that comes after its key went is not weighed.
    /** @type {(n: number) => void} */
    let land = () => {};
    const late = kept.get("late", "b", "q", () => new Promise((r) => (land = r)));
    await kept.get("late", "other", "q", v(1));
    land(50);
    await late;
    await new Promise((r) => setImmediate(r));
    assert.equal(kept.weight(), 4, "the late answer of an old basis weighs nothing");
  });

  // (fails before: yes — Fable 5.2's read of 11-19: the bound's edges none of the above lands on)
  test("a budget's edges: a key past most lets its weight go; a read trimmed while under way is not weighed; at the budget nothing goes; a weight that is no count weighs none; a key whose read is under way is passed over", async () => {
    const v = (/** @type {any} */ n) => async () => n;
    const settle = () => new Promise((r) => setImmediate(r));
    // A key past `most`: its weight goes with it.
    const few = keptAnswers({ most: 2, perKey: 2, budget: 100, weigh: (/** @type {number} */ n) => n });
    for (const k of ["a", "b", "c"]) await few.get(k, "b", "q", v(5));
    assert.deepEqual([few.size(), few.weight()], [2, 10]);
    // A read trimmed by `perKey` while under way: not weighed when it lands.
    /** @type {(n: number) => void} */
    let land = () => {};
    const trimmed = keptAnswers({ most: 4, perKey: 1, budget: 100, weigh: (/** @type {number} */ n) => n });
    const slow = trimmed.get("k", "b", "q1", () => new Promise((r) => (land = r)));
    await trimmed.get("k", "b", "q2", v(3));
    land(40);
    await slow;
    await settle();
    assert.equal(trimmed.weight(), 3, "q1, trimmed for q2, weighs nothing");
    // Exactly at the budget: nothing goes.
    const edge = keptAnswers({ most: 4, perKey: 1, budget: 10, weigh: (/** @type {number} */ n) => n });
    await edge.get("a", "b", "q", v(6));
    await edge.get("b", "b", "q", v(4));
    assert.deepEqual([edge.size(), edge.weight()], [2, 10]);
    // A weight that is no finite count weighs none.
    const odd = keptAnswers({ most: 8, perKey: 1, budget: 10, weigh: (/** @type {any} */ n) => n });
    for (const [k, w] of /** @type {[string, any][]} */ ([["neg", -5], ["nan", NaN], ["inf", Infinity], ["word", "x"]])) await odd.get(k, "b", "q", v(w));
    assert.deepEqual([odd.size(), odd.weight()], [4, 0]);
    await odd.get("real", "b", "q", v(4));
    assert.deepEqual([odd.size(), odd.weight()], [5, 4], "and the sum stays a count");
    // A key whose read is under way frees nothing: passed over, it stays with its read; the oldest that weighs goes.
    const busy = keptAnswers({ most: 8, perKey: 1, budget: 10, weigh: (/** @type {number} */ n) => n });
    /** @type {(n: number) => void} */
    let busyLand = () => {};
    const pending = busy.get("busy", "b", "q", () => new Promise((r) => (busyLand = r)));
    await busy.get("old", "b", "q", v(6));
    await busy.get("new", "b", "q", v(6));
    assert.deepEqual([busy.size(), busy.weight()], [2, 6], "old went, busy stayed");
    busyLand(1);
    assert.equal(await pending, 1);
    await settle();
    assert.deepEqual([busy.size(), busy.weight()], [2, 7], "its answer, kept and weighed");
  });

  test("a store with no budget weighs nothing, though given a weight", async () => {
    let weighed = 0;
    const kept = keptAnswers({ most: 2, perKey: 2, weigh: (/** @type {number} */ n) => (weighed++, n) });
    await kept.get("a", "b", "q", async () => 1e9);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([kept.weight(), weighed], [0, 0]);
  });

  test("rowsOf: a run's answer's rows, its whole's three lists and each round's files", () => {
    assert.equal(rowsOf({ whole: { files: [1, 2], during: [3], outside: [4, 5, 6] }, rounds: [{ files: [1] }, { files: [] }, {}] }), 7);
    assert.equal(rowsOf({ whole: null, rounds: null }), 0);
    assert.equal(rowsOf(null), 0);
  });

  test("a run's changes are read through it, the rounds only where asked for (pinned in the source)", () => {
    assert.deepEqual(RUN_CHANGES_KEPT, { most: 64, perKey: 200, budget: 200_000 });
    const src = readFileSync(new URL("../src/http/admin/runs.js", import.meta.url), "utf8");
    assert.match(src, /const walk = async \(\) => \{/);
    assert.match(src, /const changeAnswers = keptAnswers\(\{ \.\.\.RUN_CHANGES_KEPT, weigh: rowsOf \}\);/, "bounded by the rows it holds");
    assert.equal(src.split("const answer = await changeAnswers.get(key, basis, query, walk, keep);").length - 1, 2, "the whole, and the files card's cut, read through it");
    assert.match(src, /const withRounds = one \|\| !!named \|\| q\.get\("rounds"\) === "1";/);
  });
});
