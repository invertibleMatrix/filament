// @ts-check
// The owner's report of 11-02: "filament starts crawling". A compaction's transcript — the summary before and every turn
// since, read whole — was weighed as one text: each plan (the Context popover's, a turn's at the line, the fold the
// loop asks of the earlier turns) built it again and classified all of it, a turn more than the time before, so its
// count was never one the memo had: on the owner's 56 MB chat, seconds of the main thread each time. Its pieces are
// weighed in order now, where each run of first pieces stood kept, so a plan classifies only the turns new since the
// last — and the count is the joined text's own, to the last token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, joinedTokens, textWeight } from "../src/core/tokens.js";
import { createCompactor } from "../src/app/sessions/compactor.js";
import { summaryTranscript } from "../src/app/sessions/compaction.js";

/**
 * How many runs the classifier read while `fn` ran: each run of a text it weighs is one step of its pattern (tokens.js
 * `CLASSES`, the only global pattern of the runs' scripts).
 * @template T @param {() => T} fn @returns {{ value: T, runs: number }}
 */
const classified = (fn) => {
  const was = RegExp.prototype.exec;
  let runs = 0;
  RegExp.prototype.exec = function (/** @type {string} */ s) {
    if (this.global && this.source.includes("Script=Han")) runs++;
    return was.call(this, s);
  };
  try {
    return { value: fn(), runs };
  } finally {
    RegExp.prototype.exec = was;
  }
};
/** The same, for an async `fn`. @template T @param {() => Promise<T>} fn @returns {Promise<{ value: T, runs: number }>} */
const classifiedAsync = async (fn) => {
  const was = RegExp.prototype.exec;
  let runs = 0;
  RegExp.prototype.exec = function (/** @type {string} */ s) {
    if (this.global && this.source.includes("Script=Han")) runs++;
    return was.call(this, s);
  };
  try {
    return { value: await fn(), runs };
  } finally {
    RegExp.prototype.exec = was;
  }
};

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
// Every class a run can be, and what a join can merge: spaces and line breaks on either side of it, a letter run that
// takes a Han character in, astral letters and Han, marks, and the halves of a pair apart.
const ATOMS = ["\uD801", "\uDC37", " ","  ", "\n", "\n\n", "\t", " ", "word", "Longerwords", "x", "12345", "7", "{", "}", "=>", ")", "`", "\"", "…", "漢字", "ひらがな", "カタカナ", "한글", "𐐷𐐸", "𠀀𠀁", "é", "é", "abc漢", "_", "-", ".", "aé1"];
/** A piece of up to `n` atoms; now and then empty, or only spaces. @param {number} n */
const piece = (n) => {
  const r = rnd();
  if (r < 0.05) return "";
  if (r < 0.1) return " \n ".slice(0, 1 + Math.floor(rnd() * 3));
  return Array.from({ length: 1 + Math.floor(rnd() * n) }, () => ATOMS[Math.floor(rnd() * ATOMS.length)]).join("");
};

test("texts joined weigh as the joined text does, to the last token, whichever of their starts were counted before", () => {
  for (const sep of ["\n\n", " ", "\n", "x", "\uD801"]) {
    for (let trial = 0; trial < 150; trial++) {
      const pieces = Array.from({ length: Math.floor(rnd() * 9) }, () => piece(1 + Math.floor(rnd() * 40)));
      // Growing, as a chat's transcript does: each start counted, then one more piece.
      for (let k = 0; k <= pieces.length; k++) {
        const some = pieces.slice(0, k);
        assert.equal(joinedTokens(some, sep), estimateTokens(some.join(sep)), `${JSON.stringify(sep)} ${JSON.stringify(some)}`);
      }
      // And a start counted with other pieces after it.
      const other = [...pieces.slice(0, Math.floor(pieces.length / 2)), piece(20), piece(5)];
      assert.equal(joinedTokens(other, sep), estimateTokens(other.join(sep)), `${JSON.stringify(sep)} ${JSON.stringify(other)}`);
    }
  }
  // Long texts too, past the memo's least: a run that a piece ends with, and the next lengthens.
  const long = ["intro ".repeat(500), `${"abc".repeat(400)}`, `${"def".repeat(400)} `, "   \n", `\n${"漢".repeat(300)}`];
  for (const sep of ["\n\n", "x"]) for (let k = 0; k <= long.length; k++) assert.equal(joinedTokens(long.slice(0, k), sep), estimateTokens(long.slice(0, k).join(sep)));
  // A pair's halves at a piece's end and the next one's start stay apart, as the separator keeps them in the joined text.
  const split = ["a\uD801", "\uDC37b"];
  for (const sep of ["\n\n", " ", "x"]) assert.equal(joinedTokens(split, sep), estimateTokens(split.join(sep)));
});

// (fails before: yes — with no separator the halves joined to one letter, which joins the run before: 2 for the joined
// text's 1)
test("a separator that could join a piece's end to the next piece's start is refused: none, or one that starts with a pair's second half", () => {
  assert.equal(estimateTokens("a𐐷b"), 1, "the joined text is one letter run");
  for (const sep of ["", "\uDC37", "\uDC37 "]) assert.throws(() => joinedTokens(["a\uD801", "\uDC37b"], sep), RangeError, JSON.stringify(sep));
});

test("a count of texts joined classifies only the pieces past the longest start counted before", () => {
  const pieces = Array.from({ length: 12 }, (_, i) => `## Turn ${i + 1}\nUser: ${"what the file holds and why ".repeat(80)}${i}`);
  const sep = "\n\n";
  joinedTokens(pieces.slice(0, 11), sep);
  const last = classified(() => textWeight(`${sep}${pieces[11]}`)).runs;
  const whole = classified(() => textWeight(pieces.join(sep))).runs;
  const next = classified(() => joinedTokens(pieces, sep));
  assert.equal(next.value, estimateTokens(pieces.join(sep)));
  assert.ok(next.runs <= last + 2, `${next.runs} runs read, the newest piece holds ${last} (the whole ${whole})`);
  assert.equal(classified(() => joinedTokens(pieces, sep)).runs, 0, "counted again, nothing is classified");
});

/** A finished turn of tool calls and results, its words its own. @param {number} n */
const turn = (n) => ({
  n,
  turnId: n,
  finished: true,
  meta: {},
  user: { role: "user", content: [{ type: "text", text: `turn ${n}: ${"look at the code and say what it does ".repeat(10)}` }] },
  work: [1, 2, 3].flatMap((k) => [
    { role: "assistant", content: [{ type: "text", text: `Reading ${n}.${k}.` }, { type: "tool_use", id: `t${n}_${k}`, name: "read", input: { path: `src/f${n}_${k}.js` } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}_${k}`, content: `const f${n}_${k} = ${k}; // ${"what the file holds ".repeat(40)}` }] },
  ]),
  final: { role: "assistant", content: [{ type: "text", text: `Turn ${n} done: ${"it reads the files ".repeat(10)}` }] },
});

// (fails before: yes — each plan classified the whole transcript, the turn added making it a text the memo never had)
test("a compaction plan after a new turn classifies that turn's transcript alone, and weighs the transcript as one text", async () => {
  const cfg = { rules: {}, upstreams: [], routes: [] };
  const compactor = createCompactor({ memory: null, config: { get: () => cfg }, ops: { record: () => {} }, log: () => {} });
  const turns = Array.from({ length: 9 }, (_, i) => turn(i + 1));
  /** @param {any[]} list */
  const planOf = (list) =>
    compactor.plan({
      chain: { id: "c-joined", meta: {} },
      doc: {},
      turns: list,
      compactions: [],
      sessionModel: "some-model",
      window: 1_000_000,
      // What the composer would say the request weighs: not what this test is about.
      measure: async ({ turns: t }) => ({ sent: 100_000, earlier: 90_000, perTurn: t.map((x) => ({ n: x.n, tokens: 10_000 })) }),
    });
  /** The summary's way, as the plan says it. @param {any} p @returns {any} */
  const summaryOf = (p) => p.methods.summary;
  const first = await planOf(turns.slice(0, 8));
  assert.equal(summaryOf(first).reads, "whole");
  assert.equal(summaryOf(first).transcriptTokens, estimateTokens(summaryTranscript(null, turns.slice(0, 8))));
  const whole = classified(() => textWeight(summaryTranscript(null, turns))).runs;
  const newest = classified(() => textWeight(summaryTranscript(null, turns.slice(8)))).runs;
  const next = await classifiedAsync(() => planOf(turns));
  assert.equal(summaryOf(next.value).transcriptTokens, estimateTokens(summaryTranscript(null, turns)), "the transcript's count, as one text");
  assert.ok(next.runs < newest * 2 + 50, `the plan classified ${next.runs} runs: the new turn holds ${newest}, the whole transcript ${whole}`);
  // The same figures as a compactor that never counted a start of it.
  const cold = await createCompactor({ memory: null, config: { get: () => cfg }, ops: { record: () => {} }, log: () => {} }).plan({ chain: { id: "c-joined-cold", meta: {} }, doc: {}, turns, compactions: [], sessionModel: "some-model", window: 1_000_000, measure: async ({ turns: t }) => ({ sent: 100_000, earlier: 90_000, perTurn: t.map((x) => ({ n: x.n, tokens: 10_000 })) }) });
  assert.deepEqual(next.value.methods, cold.methods);
});
