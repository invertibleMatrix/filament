// @ts-check
// The curator's merge finds its pairs by rule from an index of words and slots (curator.js `rulePairs`): it asked
// every pair of a project's standing claims — their overlap, their slots, their values —, and a long memory's pairs are
// its claims squared (the owner's of 11-17). Two that share no word and no slot can never pass, so only those that do
// are asked. The pairs are the same, in the same order (which the merge's sort by overlap keeps among equals): the
// oracle is the walk over every pair it replaced.
// (fails before: yes — there was no index; `rulePairs` is new)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mayMerge, rulePairs } from "../src/services/memory/curator.js";
import { holdsValue } from "../src/services/memory/slots.js";
import { valuesOf } from "../src/services/memory/values.js";

/** The walk it replaced (curator.js before): every pair (i, j), i < j. @param {any[]} claims @param {Set<string>[]} words @param {(c: any) => any} values */
function everyPair(claims, words, values) {
  const overlap = (/** @type {Set<string>} */ a, /** @type {Set<string>} */ b) => {
    if (a.size < 2 || b.size < 2) return 0;
    let n = 0;
    for (const w of a) if (b.has(w)) n++;
    return n / Math.min(a.size, b.size);
  };
  const pairs = [];
  for (let i = 0; i < claims.length; i++)
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i],
        b = claims[j];
      if (!mayMerge(a, b, values)) continue;
      const slotted = !!a.slot && a.slot === b.slot && !!b.slot_value && holdsValue(a, b.slot_value);
      const ov = slotted ? 1 : overlap(words[i], words[j]);
      if (ov >= 0.5) pairs.push({ a, b, ov });
    }
  return pairs;
}

/** Each claim's values read once, as the merge does. */
const once = () => {
  const read = new Map();
  return (/** @type {any} */ c) => {
    if (!read.has(c)) read.set(c, valuesOf(c));
    return read.get(c);
  };
};
/** A seeded draw in [0, 1). @param {number} seed */
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** A pair as places and overlap. @param {any[]} claims */
const placed = (claims) => {
  const at = new Map(claims.map((c, i) => [c, i]));
  return (/** @type {{ a: any, b: any, ov: number }[]} */ ps) => ps.map((p) => [at.get(p.a), at.get(p.b), p.ov]);
};

const VOCAB = ["parser", "lexer", "release", "notes", "tag", "branch", "main", "commit", "test", "suite", "port", "server", "cache", "token", "model", "agent"];
const TOOLS = ["pnpm", "npm", "bun", "yarn"];
const KINDS = ["fact", "fact", "rule", "preference", "convention", "decision", "procedure"];
const SLOTS = ["project · package manager", "project · port", "user · editor"];

/** A set of claims to try: shared words, slots with and without a value, sets under two words, the same text twice, and a word held by all. @param {number} seed @param {number} n */
function claimsOf(seed, n) {
  const r = rng(seed);
  const pick = (/** @type {any[]} */ xs) => xs[Math.floor(r() * xs.length)];
  /** @type {any[]} */
  const claims = [];
  /** @type {Set<string>[]} */
  const words = [];
  const everyone = seed % 2 === 0;
  for (let i = 0; i < n; i++) {
    const size = Math.floor(r() * 5);
    const ws = new Set(Array.from({ length: size }, () => pick(VOCAB)));
    if (everyone) ws.add("filament");
    const tool = r() < 0.3 ? pick(TOOLS) : "";
    const slot = r() < 0.25 ? pick(SLOTS) : null;
    const text = [...ws, tool && `with ${tool}`].filter(Boolean).join(" ");
    claims.push({ id: i + 1, kind: pick(KINDS), text, slot, slot_value: slot && r() < 0.6 ? tool || pick(["3000", "vim", "5173"]) : null, slot_multi: slot && r() < 0.2 ? 1 : 0 });
    words.push(ws);
    if (r() < 0.1) {
      claims.push({ ...claims[i], id: claims.length + 1 });
      words.push(new Set(ws));
    }
  }
  return { claims, words };
}

test("the pairs found from the index are the walk over every pair's, in its order: shared words, slots with and without a value, sets under two words, the same text twice, a word all hold", () => {
  let found = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { claims, words } = claimsOf(seed, 60 + seed * 3);
    const at = placed(claims);
    const want = at(everyPair(claims, words, once()));
    assert.deepEqual(at(rulePairs(claims, words, once())), want, `seed ${seed}`);
    found += want.length;
  }
  assert.ok(found > 500, `the sets made pairs to find (${found})`);
});

test("2,300 claims that all hold one word: the index asks no pair's values whose words cannot pass, and finds the two that say the same thing in well under a second", () => {
  const unique = (/** @type {number} */ k) => `w${k.toString(36)}`;
  /** @type {any[]} */
  const claims = [];
  /** @type {Set<string>[]} */
  const words = [];
  for (let i = 0; i < 2300; i++) {
    const ws = ["filament", unique(4 * i), unique(4 * i + 1), unique(4 * i + 2), unique(4 * i + 3)];
    claims.push({ id: i + 1, kind: "fact", text: ws.join(" "), slot: null, slot_value: null, slot_multi: 0 });
    words.push(new Set(ws));
  }
  claims.push({ id: 9001, kind: "fact", text: "filament release notes by hand", slot: null, slot_value: null, slot_multi: 0 }, { id: 9002, kind: "fact", text: "filament release notes written by hand", slot: null, slot_value: null, slot_multi: 0 });
  words.push(new Set(["filament", "release", "notes", "hand"]), new Set(["filament", "release", "notes", "written", "hand"]));
  let asked = 0;
  const values = (/** @type {any} */ c) => (asked++, valuesOf(c));
  const t0 = performance.now();
  const pairs = rulePairs(claims, words, values);
  const ms = performance.now() - t0;
  assert.deepEqual(pairs.map((p) => [p.a.id, p.b.id, p.ov]), [[9001, 9002, 1]]);
  assert.equal(asked, 2, "the values of the one pair that passes, alone");
  assert.ok(ms < 1000, `found in ${ms.toFixed(0)} ms`);
});
