// @ts-check
// The store under the git marks (core/kept-reads.js): an answer kept is given at once and read again behind it once old,
// one read under way at a time; what moved is told, what did not is not; a read begun earlier that lands later never
// stands over a newer one; a first read that fails keeps nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keptReads } from "../src/core/kept-reads.js";

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** A read the test lands by hand. */
const held = () => {
  /** @type {Array<{ land: (v: any) => void, fail: (e: any) => void }>} */
  const asked = [];
  const read = () => new Promise((land, fail) => void asked.push({ land, fail }));
  return { asked, read };
};

test("kept: at once, read again behind once old, one at a time, told only where it moved", async () => {
  /** @type {Array<[string, string[]]>} */
  const told = [];
  const kept = keptReads({ freshMs: 30, onMoved: (key, asked) => void told.push([key, asked]) });
  const r = held();
  const first = kept.get("k", r.read, { asked: "A" });
  const also = kept.get("k", r.read, { asked: "a" });
  assert.equal(r.asked.length, 1, "asks while nothing is kept share the first read");
  r.asked[0].land(1);
  assert.deepEqual([await first, await also], [1, 1]);
  assert.equal(await kept.get("k", r.read), 1);
  assert.equal(r.asked.length, 1, "young: no read behind");
  await sleep(40);
  assert.equal(await kept.get("k", r.read), 1, "old: the kept answer at once");
  assert.equal(await kept.get("k", r.read), 1);
  assert.equal(r.asked.length, 2, "one read behind it at a time");
  r.asked[1].land(2);
  await sleep(0);
  assert.deepEqual(told, [["k", ["A", "a"]]]);
  assert.equal(await kept.get("k", r.read), 2);
  await sleep(40);
  await kept.get("k", r.read);
  r.asked[2].land(2);
  await sleep(0);
  assert.equal(told.length, 1, "the same answer: nothing told");
});

test("kept: a read begun earlier never stands over a newer one; a first read that fails keeps nothing", async () => {
  const kept = keptReads({ freshMs: 0 });
  const r = held();
  const failed = kept.get("f", r.read);
  r.asked[0].fail(new Error("no git"));
  await assert.rejects(failed, /no git/);
  const again = kept.get("f", r.read);
  assert.equal(r.asked.length, 2, "nothing kept: read again");
  r.asked[1].land("one");
  assert.equal(await again, "one");
  void kept.get("f", r.read); // behind it, begun first
  const newer = kept.get("f", r.read, { fresh: true });
  assert.equal(r.asked.length, 4);
  r.asked[3].land("newer");
  assert.equal(await newer, "newer");
  r.asked[2].land("older");
  await sleep(0);
  assert.equal(await kept.get("f", () => new Promise(() => {})), "newer");
});

test("kept: at most `most` keys, the one asked longest ago going first; forget drops every one", async () => {
  const kept = keptReads({ freshMs: 1000, most: 2 });
  for (const k of ["a", "b"]) await kept.get(k, async () => k);
  await kept.get("a", async () => "x");
  await kept.get("c", async () => "c");
  assert.equal(kept.size(), 2);
  assert.equal(await kept.get("a", async () => "x"), "a", "asked lately: kept");
  assert.equal(await kept.get("b", async () => "b2"), "b2", "asked longest ago: gone");
  kept.forget();
  assert.equal(kept.size(), 0);
});
