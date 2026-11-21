// @ts-check
// A coding agent's own compaction in the middle of a turn stands where it happened. The owner's words of 10-18, of the
// green row under turn 176: "shouldn't it only show right after compaction happens", then "yeah exactly, it should sit
// where it happened". One line in the turn's work, the moment the agent's compaction ends; once the turn ends, its work
// folds on either side of it ("The work after it" under the line), and the chat's row for it steps aside — it stays
// under the turn only where the turn has no line (its run's log swept).
// (fails before: yes — the line was a grey note inside the turn's fold, folded away with the work, and the green row
// came under the turn, at its end or with the next read)
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compactionWords, foldParts, ownCompacted } from "../src/ui/harness/lib/labels.js";
import { isOwnDuring, ownRowOf, placeBoundary } from "../src/ui/harness/conversation/history.js";
import { afterFold, tallyBetween } from "../src/ui/harness/conversation/turn.js";
import { stubDocument } from "./helpers/dom-stub.js";

const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
const BY = "Claude Code · Northwind";
/** The server's row for the compaction in the middle of turn 176, as the transcript gives it. */
const ROW = Object.freeze({ type: "compaction", id: 77, afterTurn: 176, fromTurn: 1, toTurn: 175, kind: "plain", method: "own", chars: 5000, detail: { during: 176, by: BY, before: 402_000, after: 13_000, exact: true, model: "opus-max", how: "agent-own", ms: 97_000 } });

test("its words on the turn it fell in: here, not during turn N", () => {
  assert.equal(compactionWords(ROW, { here: true }), `${BY} compacted its own context here: Filament's copy starts from its summary`);
  assert.equal(compactionWords(ROW), `${BY} compacted its own context during turn 176: Filament's copy starts from its summary`, "between turns, as before");
});

test("a line of its own: an agent's own compaction that ended, not one that failed, nor the loop's", () => {
  assert.equal(ownCompacted({ type: "compaction", own: true, by: BY, tokensBefore: 402_000 }), true);
  assert.equal(ownCompacted({ type: "compaction", own: true, result: "failed", error: "no room" }), false, "a failure stays a note in its round");
  assert.equal(ownCompacted({ type: "compaction", fromRound: 1, toRound: 4 }), false, "the loop's own folding of its rounds");
  assert.equal(ownCompacted(null), false);
});

test("a settled turn's work folds on either side of each line", () => {
  const [a, b, c, line, line2] = [{ kind: "cards", n: "a" }, { kind: "block", n: "b" }, { kind: "cards", n: "c" }, { kind: "compacted", n: "L" }, { kind: "compacted", n: "L2" }];
  assert.deepEqual(foldParts([a, line, c]), { before: [], head: [a], after: [{ line, segs: [c] }] });
  assert.deepEqual(foldParts([a, line, b, line2, c]), { before: [], head: [a], after: [{ line, segs: [b] }, { line: line2, segs: [c] }] }, "two compactions in one turn");
  assert.deepEqual(foldParts([line, a, c]), { before: [line], head: [a, c], after: [] }, "before its first model call: above the turn's fold");
  assert.deepEqual(foldParts([a, c, line]), { before: [], head: [a, c], after: [{ line, segs: [] }] }, "after the last work: no fold under it");
  assert.deepEqual(foldParts([a, c]), { before: [], head: [a, c], after: [] }, "no compaction: the turn's fold as it was");
});

test("the chat's row stays on the turn it fell in, whatever follows it — and finds its line there", () => {
  const turns = [{ n: 176, boundaries: [], boundariesAfter: [] }, { n: 177, boundaries: [], boundariesAfter: [] }];
  assert.equal(placeBoundary(turns, { ...ROW }), turns[0], "not above turn 177");
  assert.deepEqual(turns.map((t) => [t.boundaries.length, t.boundariesAfter.length]), [[0, 1], [0, 0]]);
  // Any other compaction still stands before the turn after it.
  const trimmed = { type: "compaction", method: "summary", afterTurn: 176, fromTurn: 1, toTurn: 170 };
  assert.equal(placeBoundary(turns, trimmed), turns[1]);
  // Its turn not on the page (a page of the turns): before the next, as any row.
  const later = [{ n: 177, boundaries: [], boundariesAfter: [] }];
  assert.equal(placeBoundary(later, { ...ROW }), later[0]);
  assert.equal(later[0].boundaries.length, 1);

  assert.equal(isOwnDuring(ROW, 176), true);
  assert.equal(isOwnDuring(ROW, 177), false);
  assert.equal(isOwnDuring({ ...ROW, detail: { ...ROW.detail, during: 0 } }, 176), false, "one made between turns");
  assert.equal(ownRowOf({ n: 176, boundariesAfter: [ROW] }), ROW, "placed on the turn");
  assert.equal(ownRowOf({ n: 176, compactions: [ROW], boundariesAfter: [] }), ROW, "read as the turn ended");
  assert.equal(ownRowOf({ n: 177, boundaries: [ROW] }), null, "another turn's");
});

test("the work after it is counted for its own rounds", () => {
  const cell = (/** @type {number} */ calls) => ({ tools: new Map(Array.from({ length: calls }, (_, i) => [`c${i}`, {}])) });
  const aligned = { byRound: new Map([[1, cell(2)], [2, cell(1)], [3, cell(3)], [4, cell(0)], [5, cell(1)]]) };
  assert.deepEqual(tallyBetween(aligned, 2), { legs: 2, calls: 4 }, "rounds 3 and 5: round 4 called nothing");
  assert.deepEqual(tallyBetween(aligned, 2, 3), { legs: 1, calls: 3 }, "up to the next line");
  assert.deepEqual(tallyBetween(aligned, 5), { legs: 0, calls: 0 });
});

describe("the fold under the line", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  test("says what it holds, opens as the turn's fold is, and a click holds the folds as you leave them", () => {
    /** @type {any} */
    const turn = {};
    const f = /** @type {any} */ (afterFold(turn, false));
    f.count({ legs: 2, calls: 3 });
    // The calls on the line, the steps they came in on hover (the Designer's review of 10-24: "tool leg" is a builder's word).
    assert.equal(f.el.querySelector(".work-label").textContent, "The work after it · 3 tool calls");
    assert.equal(f.el.querySelector(".work-counts").title, "After the compaction: 3 tool calls in 2 steps: a step is one go of the agent's — it calls one or more tools, then reads what they answer");
    assert.equal(f.el.open, false);
    assert.ok(f.el.classList.contains("work-fold") && f.el.classList.contains("is-after"));
    f.count({ legs: 1, calls: 1 });
    assert.equal(f.el.querySelector(".work-label").textContent, "The work after it · 1 tool call");
    f.count(null);
    assert.equal(f.el.querySelector(".work-label").textContent, "The work after it");
    f.el.querySelector("summary").dispatch("click");
    assert.equal(turn.foldHeld, true);
    assert.equal(/** @type {any} */ (afterFold({}, true)).el.open, true, "made while the turn's fold is open");
  });
});

test("the timeline: the line out of its round's box, the folds around it, the row aside while it stands", () => {
  const cards = timeline.slice(timeline.indexOf("    placeCards(turn, aligned = null) {"), timeline.indexOf("    /** The session's sub-agents moved: the order rows on screen"));
  assert.match(cards, /const own = \(whole\.compactions \|\| \[\]\)\.filter\(ownCompacted\);/);
  assert.match(cards, /const cell = own\.length \? \{ \.\.\.whole, compactions: whole\.compactions\.filter\(\(\/\*\* @type \{any\} \*\/ k\) => !ownCompacted\(k\)\) \} : whole;/, "not a note inside the box");
  assert.match(cards, /const b = k === newestOwn \? ownRow : null;/, "the newest takes the chat's row: its words and summary");
  assert.match(cards, /return \{ kind: "compacted", round, at: Number\(k\.ts\) \|\| 0, began: Number\(k\.began\) \|\| 0, ms: Number\(k\.ms\) \|\| 0, el: keptRow\(v\.drawn, `compacted:\$\{round\}:\$\{i\}`, sig, \(\) => ownCompactionRow\(k, b\)\) \};/, "kept while it holds, as a card is; when it ran, for the folds' times");
  assert.match(cards, /turn\.segments\.splice\(idx, 0, \.\.\.\(box \? \[\{ kind: "cards", round: rounds\[0\], last: rounds\.at\(-1\), el: box \}\] : \[\]\), \.\.\.pics, \.\.\.here\);/, "right after its round's box");
  assert.match(cards, /if \(\(lines > 0\) !== !!v\.hereShown\) \{\n\s+v\.hereShown = lines > 0;\n\s+api_\.drawBoundaries\(turn\);/);
  assert.match(timeline, /const parts = live \|\| !v\.fold \? \{ before: \[\], head: fold, after: \[\] \} : foldParts\(fold, replies, /, "settled only: while it runs, the line stands in the work");
  assert.match(timeline, /placeChildren\(v\.group, \[v\.sig, \.\.\.parts\.before\.map\(\(s\) => s\.el\), v\.fold\.el, \.\.\.parts\.after\.flatMap\(\(p, i\) => \[lineOf\(p\), \.\.\.\(p\.with \|\| \[\]\)\.map\(\(s\) => s\.el\), folds\[i\]\]\), v\.shots, v\.final\]\.filter\(Boolean\)\);/);
  assert.match(timeline, /const after = \(turn\.boundariesAfter \|\| \[\]\)\.filter\(\(\/\*\* @type \{any\} \*\/ b\) => !\(v\.hereShown && isOwnDuring\(b, turn\.n\)\) && !\(b\.type === "held" && v\.heldHere\?\.has\(b\.id\)\)\);/);
  assert.match(timeline, /if \(pv && !prev\.foldHeld\) \{\n\s+if \(pv\.fold\?\.el\) [^\n]+\n\s+for \(const p of pv\.parts \|\| \[\]\) if \(p\) p\.el\.open = false;/, "closed with the turn's fold, at the next turn's start");
  const row = timeline.slice(timeline.indexOf("function ownCompactionRow(k, b) {"), timeline.indexOf("function reportNote("));
  assert.match(row, /b \? compactionRowWords\(b, \{ here: true \}\) : roundCompactionWords\(k\)/, "the row's words once there is one, the agent's before");
  assert.match(row, /const kept = String\(b\?\.text \|\| k\?\.summary \|\| ""\);/, "Show summary: the row's, else what the agent kept");
  assert.match(row, /h\("div", \{ class: "boundary is-compaction is-here" \}/, "the compaction's row, as between turns");
});
