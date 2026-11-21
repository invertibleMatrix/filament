// @ts-check
// Where a round's cards splice into its turn is read once for the whole turn (labels.js `cardAnchors`), not again for
// every round (the owner's of 11-17: a long coding agent's turn held the chat window 11 s on opening, 93 % of it in
// roundCardAnchor — every round's anchor rebuilt from every round, per round, and a words-alone turn's anchor counted
// the rounds before it each time: the turn's cube). The places are the ones the per-round reading gave, to the index:
// the reading it replaced is kept here and both are asked on turns of every shape, with cards, visuals and compactions
// spliced in between, as placeCards splices them.
// (fails before: yes — the long turn below took seconds, past its bound)
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardAnchors, cardBoxes, roundCardAnchor, wokeReplies } from "../src/ui/harness/lib/labels.js";

/**
 * The per-round reading as it stood before (labels.js at v0.9.79), word for word.
 * @param {any[]} segments @param {Map<number, any>} byRound @param {number} round
 */
function before(segments, byRound, round) {
  const segs = segments || [];
  const blockSegs = segs.filter((s) => s.kind === "block");
  const cells = [...(byRound || new Map()).entries()];
  const wordsAlone = cells.some(([, c]) => c?.thought) && !blockSegs.some((s) => s.block?.type === "thinking");
  const saidRounds = wordsAlone ? cells.filter(([, c]) => c?.said).map(([r]) => r) : [];
  const anchorOf = (/** @type {number} */ r, /** @type {any} */ c) => (wordsAlone ? saidRounds.filter((x) => x < r).length : c.blocksBefore);
  const starts = cells
    .filter(([, c]) => Number.isInteger(c?.blocksBefore))
    .map(([r, c]) => ({ r, at: anchorOf(r, c) }))
    .sort((x, y) => x.at - y.at || x.r - y.r);
  const mine = starts.find((s) => s.r === round);
  if (mine) {
    const nextStart = starts.find((s) => s.r > round && s.at >= mine.at);
    if (nextStart && blockSegs[nextStart.at]) return segs.indexOf(blockSegs[nextStart.at]);
    const last = blockSegs[blockSegs.length - 1];
    return last ? segs.indexOf(last) + 1 : segs.length;
  }
  const textBlocks = segs.filter((s) => s.kind === "block" && s.block?.type === "text");
  const at = Math.min(round, textBlocks.length);
  const counted = at === 0 ? 0 : segs.indexOf(textBlocks[at - 1]) + 1;
  const later = starts.find((s) => s.r > round && blockSegs[s.at]);
  return later ? Math.min(counted, segs.indexOf(blockSegs[later.at])) : counted;
}

/** A seeded generator, so a failure is the same failure again. @param {number} seed */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * A turn of a random shape: blocks of text and thinking, rounds in any order of insertion, some with an anchor (some
 * shared, some past the blocks there are), some saying words or thinking, some waking.
 * @param {() => number} r
 */
function turnOf(r) {
  const n = Math.floor(r() * 30);
  const thinking = r() < 0.5;
  const segments = [];
  for (let i = 0; i < n; i++) segments.push({ kind: "block", block: { type: thinking && r() < 0.4 ? "thinking" : "text" } });
  const rounds = Math.floor(r() * 25);
  /** @type {Map<number, any>} */
  const byRound = new Map();
  const order = Array.from({ length: rounds }, (_, i) => i).sort(() => r() - 0.5);
  for (const k of order) {
    const anchored = r() < 0.75;
    byRound.set(k, {
      ...(anchored ? { blocksBefore: Math.floor(r() * (n + 3)) } : {}),
      ...(r() < 0.5 ? { said: true } : {}),
      ...(r() < 0.4 ? { thought: true } : {}),
      ...(r() < 0.15 ? { woke: true } : {}),
    });
  }
  return { segments, byRound, rounds };
}

test("every round lands where the per-round reading put it, on turns of every shape", () => {
  const r = rng(11_17);
  for (let t = 0; t < 3000; t++) {
    const { segments, byRound, rounds } = turnOf(r);
    const at = cardAnchors(segments, byRound);
    for (let k = -1; k <= rounds + 1; k++) {
      assert.equal(at(k), before(segments, byRound, k), `turn ${t}, round ${k}`);
      assert.equal(roundCardAnchor(segments, byRound, k), before(segments, byRound, k), `turn ${t}, round ${k} (one round's reading)`);
    }
  }
});

test("a round read off segments with cards, visuals and compactions spliced in lands where the per-round reading of those put it", () => {
  const r = rng(4_26);
  for (let t = 0; t < 2000; t++) {
    const { segments, byRound, rounds } = turnOf(r);
    // As placeCards does: read once, then splice what each box brings — never a block — and ask again.
    const at = cardAnchors(segments, byRound);
    /** @type {any[]} */
    const live = [...segments];
    for (let k = 0; k < rounds; k++) {
      const idx = Math.floor(r() * (live.length + 1));
      const kind = ["cards", "visual", "artifact", "compacted"][Math.floor(r() * 4)];
      live.splice(idx, 0, { kind });
      const round = Math.floor(r() * (rounds + 2)) - 1;
      assert.equal(at(round, live), before(live, byRound, round), `turn ${t}, splice ${k}, round ${round}`);
    }
  }
});

test("the boxes and the woken replies are the ones the per-round reading gave", () => {
  const r = rng(2026);
  for (let t = 0; t < 1500; t++) {
    const { segments, byRound } = turnOf(r);
    const drawn = [...byRound.keys()].sort((a, b) => a - b);
    // The boxes join rounds whose cards land at one place: built here from the per-round reading, as cardBoxes did.
    /** @type {number[][]} */
    const want = [];
    let last = null;
    for (const round of drawn) {
      const at = before(segments, byRound, round);
      if (want.length && last && last.at === at) want[want.length - 1].push(round);
      else want.push([round]);
      last = { round, at };
    }
    assert.deepEqual(cardBoxes(segments, byRound, drawn, false), want, `turn ${t}`);
    const woke = new Map();
    for (const [k, c] of byRound) {
      if (!c?.woke || !c.said) continue;
      const lastBlock = segments.slice(0, before([...segments], byRound, k)).findLast((s) => s.kind === "block");
      if (lastBlock && lastBlock.block?.type === "text") woke.set(lastBlock, k);
    }
    assert.deepEqual([...wokeReplies(segments, byRound)], [...woke], `turn ${t}`);
  }
});

test("a long words-alone turn places its cards in well under a second", () => {
  // A coding agent's turn as the archive keeps it: its words alone, a block for each round that said any, its rounds
  // thinking — 4,000 rounds, the size of the turn that held the window.
  const rounds = 4000;
  const segments = [];
  /** @type {Map<number, any>} */
  const byRound = new Map();
  let blocks = 0;
  for (let k = 0; k < rounds; k++) {
    const said = k % 3 === 0;
    byRound.set(k, { blocksBefore: blocks, thought: true, ...(said ? { said: true } : {}) });
    if (said) {
      segments.push({ kind: "block", block: { type: "text" } });
      blocks++;
    }
  }
  const drawn = [...byRound.keys()];
  const t0 = performance.now();
  const boxes = cardBoxes(segments, byRound, drawn, false);
  const ms = performance.now() - t0;
  assert.ok(boxes.length > 0);
  assert.ok(ms < 1000, `placed in ${ms.toFixed(0)} ms`);
});

test("the boxes read the turn's rounds once, not once a round", () => {
  /** A turn's rounds that count how often they are read whole. */
  class Counted extends Map {
    reads = 0;
    entries() {
      this.reads++;
      return super.entries();
    }
  }
  const byRound = new Counted();
  const segments = [];
  for (let k = 0; k < 50; k++) {
    byRound.set(k, { blocksBefore: k, said: true });
    segments.push({ kind: "block", block: { type: "text" } });
  }
  cardBoxes(segments, byRound, [...byRound.keys()], false);
  assert.equal(byRound.reads, 1);
});
