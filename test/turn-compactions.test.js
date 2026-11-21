// @ts-check
// The 11-01 report's B9: a turn can make two compactions — at its line, then again for a seed its coding agent refused
// for its size, or in the middle of it for room in the whole chat (HarnessV4_Tasks C33) — and its record named one, the
// second in the first's place, by no id; the page drew a row for that one alone, and both came in with its next read.
// Here the record's side — the pipeline's stamp of a composition, the agent stage's hand for room in the middle of a
// turn — and the page's: the rows a turn places as it ends. The sessions service's side is in sessions-api.test.js,
// whose fake pipeline runs the turns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stampComposed } from "../src/app/pipeline/stages/composed.js";
import { agent } from "../src/app/pipeline/stages/agent.js";
import * as history from "../src/ui/harness/conversation/history.js";

/** The compaction a turn made at its line, and the one it made after it. */
const LINE = { id: 4, fromTurn: 2, toTurn: 2, kind: "plain", method: "fold" };
const AFTER = { id: 5, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary" };
const body = { messages: [{ role: "user", content: "turn 4" }] };

// (fails before: yes — the view kept one compaction, `compaction`: a composition that named two kept neither)
test("a composition's every compaction is on the record's view, in the order made, each by its row's id", () => {
  /** @type {any} */
  const rec = {};
  stampComposed(rec, { form: "plain", compactions: [LINE, AFTER] }, body, "anthropic");
  assert.deepEqual(rec.view.compactions, [LINE, AFTER]);
  stampComposed(rec, { form: "plain" }, body, "anthropic");
  assert.deepEqual(rec.view.compactions, [], "a composition that made none names none");
});

// (fails before: yes — the compaction made in the middle of the turn reached the loop alone: the record kept the line's)
test("the compaction made in the middle of a session's own turn joins its record after the line's; the loop takes the hand's answer as it was given", async () => {
  const made = { history: [{ role: "user", content: "summary" }, { role: "assistant", content: "Understood." }], ...AFTER, note: "compaction: turns 1–3 summarized at the compaction line" };
  /** @type {any[]} */
  const got = [];
  const loop = { turn: async (/** @type {any} */ a) => { got.push(await a.earlier()); } };
  /** @param {any} rec @param {() => Promise<any>} earlier */
  const run = (rec, earlier) => {
    const ctx = { agent: { model: "m" }, rec, res: null, format: "anthropic", body, headers: {}, client: { abort: new AbortController() }, memory: { prep: null, sit: null }, pre: { api: "session", earlier } };
    return agent(loop)(/** @type {any} */ (ctx), /** @type {any} */ ({ config: () => ({}) }));
  };
  const rec = { view: { form: "plain", compactions: [LINE] } };
  assert.equal(await run(rec, async () => made), "replied");
  assert.deepEqual(got, [made]);
  assert.deepEqual(rec.view.compactions, [LINE, AFTER]);
  assert.equal(rec.view.form, "plain", "the rest of the view stands");
  // One that made nothing names nothing.
  const none = { view: { compactions: [LINE] } };
  await run(none, async () => ({ error: "summary: every completed turn is already under the summary of turns 1–3" }));
  assert.deepEqual(none.view.compactions, [LINE]);
});

/** A turn as the transcript lists it. @param {number} n */
const said = (n) => ({ n, turnId: n, requestIds: [`req-${n}`], user: { role: "user", content: [{ type: "text", text: `turn ${n}` }] }, final: { role: "assistant", content: [{ type: "text", text: `Turn ${n} done.` }] } });
/**
 * The chat's compaction rows as a read gives them, each read its own: one made at turn 3's line, then the two turn 4
 * made — its line's fold and the summary in the middle of it, which the server can still take back.
 */
const rows = () => [
  { type: "compaction", id: 2, afterTurn: 1, fromTurn: 1, toTurn: 1, kind: "plain", method: "fold", chars: 0, at: 500, detail: { before: 30_000, after: 16_000 }, undoable: false },
  { type: "compaction", id: 4, afterTurn: 2, fromTurn: 2, toTurn: 2, kind: "plain", method: "fold", chars: 0, at: 1000, detail: { before: 34_470, after: 17_294 }, undoable: false },
  { type: "compaction", id: 5, afterTurn: 3, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary", chars: 7, at: 2000, detail: { before: 17_294, after: 900, cost: { paid: 0.01, list: 0.01, calls: 1 } }, undoable: true, text: "SUMMARY" },
];
/** Where each compaction's row is: per turn, the ids before it and after it. @param {any[]} turns */
const where = (turns) => turns.map((t) => [t.n, ...[t.boundaries, t.boundariesAfter].map((l) => (l || []).filter((/** @type {any} */ b) => b.type === "compaction").map((/** @type {any} */ b) => b.id))]);

// (fails before: yes — the page built one row from the record's `view.compaction`, by no id: the other came in only
// with the page's next read, and no cost or Undo said on the feed found the row it built)
test("a turn's end places the rows of the compactions its record names as a read places them: the cost and an Undo reach them by their ids, and a later read keeps one of each", () => {
  // The page as turn 4 ends: turns 1–3 from its last read, turn 4 its own send.
  const page = /** @type {any[]} */ (history.transcriptTurns({ turns: [1, 2, 3].map(said), boundaries: rows().slice(0, 1) }));
  const mine = { n: 4, status: "done", requestId: "req-4", requestIds: ["req-4"], rec: { view: { compactions: [LINE, AFTER] } }, boundaries: [], boundariesAfter: [] };
  page.push(mine);
  const placed = history.composedCompactions(rows(), mine.rec.view.compactions);
  assert.deepEqual(placed.map((b) => b.id), [4, 5], "the two turn 4 made, not the one before");
  for (const b of placed) if (!history.holdsRow(page, b)) history.placeBoundary(page, b);
  const read = () => history.transcriptTurns({ turns: [1, 2, 3, 4].map(said), boundaries: rows() });
  assert.deepEqual(where(page), where(read()), "where a read places them");
  assert.deepEqual(where(page), [[1, [], []], [2, [2], []], [3, [4], []], [4, [5], []]]);
  assert.deepEqual(page[3].boundaries[0].detail.cost, { paid: 0.01, list: 0.01, calls: 1 }, "with the figures the server gave them");
  assert.ok(history.composedCompactions(rows(), mine.rec.view.compactions).every((b) => history.holdsRow(page, b)), "placed again: the turns hold them");
  assert.deepEqual(history.composedCompactions(rows(), [{ fromTurn: 1, toTurn: 3, kind: "plain", method: "summary" }]), [], "a stamp by no id finds no row");
  // A later read: one row of each compaction.
  assert.deepEqual(where(history.mergedTurns(page, read())), where(read()));
  // The cost the feed says, and an Undo in another tab, find them by their ids.
  assert.deepEqual(history.afterCompactionCost(page, 5, { paid: 0.02, list: 0.02, calls: 2 }).map((t) => t.n), [4]);
  assert.deepEqual(page[3].boundaries[0].detail.cost, { paid: 0.02, list: 0.02, calls: 2 });
  assert.deepEqual(history.afterCompactionUndo(page, 5, 4).map((t) => t.n), [3, 4]);
  assert.deepEqual(where(page), [[1, [], []], [2, [2], []], [3, [4], []], [4, [], []]]);
  assert.equal(page[2].boundaries[0].undoable, true, "the line's takes the Undo the server names");
});

// (fails before: yes — the page's turn end built its one row from the record's `view.compaction`)
test("a turn's end reads those rows with the transcript's newest rows and places each where a read does", () => {
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(timeline, /turn\.composedCompactions = composedCompactions\(tr\.boundaries, turn\.rec\?\.view\?\.compactions\);/);
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /for \(const row of turn\.composedCompactions \|\| \[\]\) \{\s*if \(undone\.has\(Number\(row\.id\)\)\) continue;\s*if \(row\.undoable && !sentSince\) undoOnlyOn\(chat, row\);\s*const placed = row\.undoable && \(sentSince \|\| newerCompaction\(chat\.turns, row\.id\)\) \? \{ \.\.\.row, undoable: false \} : row;\s*(?:\/\/[^\n]*\s*)*\(chat\.rowsHeard \|\|= \[\]\)\.push\(\{ at: Date\.now\(\), row: placed, asRead: true \}\);\s*if \(holdsRow\(chat\.turns, row\)\) continue;\s*const home = placeBoundary\(chat\.turns, placed\);\s*if \(home\) transcript\.drawBoundaries\(home\);\s*\}/);
  assert.ok(!/view\?\.compaction\b/.test(app), "no row is built from one stamp");
});
