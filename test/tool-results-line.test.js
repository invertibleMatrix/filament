// @ts-check
// Tool results (Settings › Context › Advanced › Every turn, `context.results`) offer As is and One line (the owner's of
// 11-07). One line sends each result of a finished turn sent whole as its line, with the result's recall id where the
// line leaves something out, so `filament_recall` brings it back whole. The policies offered before — the line without
// an id (`status`), a repeated call's newest only (`dedupe-to-tail`) and pointers (`pointer`) — are offered no more, and
// a chat on one of them sends the same bytes as before: its cache holds, no history is rewritten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compose } from "../src/app/sessions/compose.js";
import { lineResults, resultRef, CLEARED_TEXT, LINE_MIN_TOKENS } from "../src/app/sessions/shapes.js";
import { resolveSettings, KNOBS } from "../src/services/session-settings.js";
import { estimateTokens, tailWithinTokens } from "../src/core/tokens.js";

const LISTING = Array.from({ length: 30 }, (_, i) => `src/file${i}.js`).join("\n") + "\n";
const FAILED = "ENOENT: no such file or directory, open 'bad.txt'\n" + "    at stack line\n".repeat(20);
/** A finished turn with one tool call and its result. @param {number} n @param {{ path: string, result: string, error?: boolean }} o */
const turn = (n, { path, result, error = false }) => ({
  turnId: 100 + n, n,
  user: { role: "user", content: [{ type: "text", text: `turn ${n}` }] },
  work: [
    { role: "assistant", content: [{ type: "tool_use", id: `t${n}`, name: "read", input: { path } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}`, content: result, ...(error ? { is_error: true } : {}) }] },
  ],
  final: { role: "assistant", content: [{ type: "text", text: `done ${n}` }] },
  meta: {},
});
const TURNS = [
  turn(1, { path: "src", result: LISTING }),
  turn(2, { path: "bad.txt", result: FAILED, error: true }),
  turn(3, { path: "short.txt", result: "a short answer" }),
  turn(4, { path: "src", result: LISTING.replace("file0", "fileA") }),
];
const NEW = { role: "user", content: [{ type: "text", text: "next" }] };
/** The history composed under a policy: its report, its results' text and the hash of its messages. @param {string} results @param {any} [extra] */
const composed = async (results, extra = {}) => {
  const c = await compose({ turns: TURNS, settings: resolveSettings({ session: { context: { results } } }).effective, newUser: NEW, model: "m", window: 200000, ...extra });
  const out = c.body.messages.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content.filter((/** @type {any} */ b) => b.type === "tool_result").map((/** @type {any} */ b) => b.content) : []));
  return { report: c.report, out, hash: createHash("sha256").update(JSON.stringify(c.body.messages)).digest("hex").slice(0, 16) };
};

// The bytes each policy sent before One line was added, read at 89e04a02b: a chat on one of them sends these still.
test("the policies offered before send the same bytes as before — As is, the line without an id, newest only, pointers", async () => {
  const keep = await composed("keep");
  assert.equal(keep.hash, "76ccf1fb860e66d9");
  assert.deepEqual(keep.out, [LISTING, FAILED, "a short answer", LISTING.replace("file0", "fileA")]);
  const status = await composed("status");
  assert.equal(status.report.results, "status");
  assert.equal(status.hash, "c745357c7e193345");
  assert.deepEqual(status.out, ["30 lines · 410 chars", "error: ENOENT: no such file or directory, open 'bad.txt' at stack line at stack line at stack line at stack line at stack line…", "a short answer", "30 lines · 410 chars"]);
  const dedupe = await composed("dedupe-to-tail");
  assert.equal(dedupe.report.results, "dedupe-to-tail");
  assert.equal(dedupe.hash, "2cf26e10189ed4ba");
  assert.equal(dedupe.out[0], "→ superseded by the same call in turn 4 (r:95527469; filament_recall brings this one back)");
  const pointer = await composed("pointer");
  assert.equal(pointer.report.results, "pointer");
  assert.equal(pointer.hash, "41e2312e20beb66b");
  assert.deepEqual(pointer.out, [
    'result r:95527469 (30 lines, ok) — filament_recall({ result: "r:95527469" }) brings it back',
    'result r:33f036a3 (21 lines, error) — filament_recall({ result: "r:33f036a3" }) brings it back',
    'result r:5d10030b (1 line, ok) — filament_recall({ result: "r:5d10030b" }) brings it back',
    'result r:e62d8786 (30 lines, ok) — filament_recall({ result: "r:e62d8786" }) brings it back',
  ]);
});

// A read of a big file: some 25K tokens.
const BIG = Array.from({ length: 2000 }, (_, i) => `export const value${i} = compute(${i}, "row ${i}");`).join("\n") + "\n";
/** A text of about so many tokens, as Filament counts them. @param {number} n */
const ofTokens = (n) => tailWithinTokens(BIG, n);
/** One step's messages: a call per result, then the results. @param {string[]} results */
const step = (results) => [
  { role: "assistant", content: results.map((_, i) => ({ type: "tool_use", id: `c${i}`, name: "read", input: { path: `f${i}.js` } })) },
  { role: "user", content: results.map((content, i) => ({ type: "tool_result", tool_use_id: `c${i}`, content })) },
];

// (fails before: yes — there was no One line with an id: `line` was no policy, and the chat sent its results as is)
test("One line: a finished turn whose results shrink by 10K tokens or more sends each its line and its recall id; the others go as they ran", async () => {
  assert.ok(estimateTokens(BIG) > 2 * LINE_MIN_TOKENS, "the big read is well over the line");
  const turns = [turn(1, { path: "big.js", result: BIG }), turn(2, { path: "bad.txt", result: FAILED, error: true }), turn(3, { path: "src", result: LISTING })];
  const keep = await composed("keep", { turns });
  const line = await composed("line", { turns });
  assert.equal(line.report.results, "line");
  assert.deepEqual(line.out, [`2000 lines · 98 KB — result r:${resultRef(BIG)}`, FAILED, LISTING]);
  assert.equal(line.report.pointers, 1, "the one result lined carries its id");
  // The two small turns go byte for byte as As is sends them: no line would save what the cache's one miss costs.
  const bytes = async (/** @type {string} */ results) => JSON.stringify((await compose({ turns, settings: resolveSettings({ session: { context: { results } } }).effective, newUser: NEW, model: "m", window: 200000 })).body.messages.slice(4));
  assert.equal(await bytes("line"), await bytes("keep"));
  assert.notEqual(line.hash, keep.hash);
  // A coding agent that takes no MCP tools has no filament_recall: an id would name what it cannot reach.
  const blind = await composed("line", { turns, recall: false });
  assert.deepEqual(blind.out, [`2000 lines · 98 KB`, FAILED, LISTING]);
  assert.equal(blind.report.pointers, 0);
});

// (fails before: yes — One line lined every result, so each finished turn, however small, cost the cache its miss)
test("One line's threshold is the turn's: results under 10K tokens stay as they ran, several that add up to it are lined", () => {
  assert.equal(LINE_MIN_TOKENS, 10000);
  const under = step([ofTokens(9000)]);
  const r = lineResults(under);
  assert.equal(r.changed, 0);
  assert.equal(r.ids, 0);
  assert.equal(r.messages, under, "the turn's own messages, as they ran");
  const two = lineResults(step([ofTokens(6000), ofTokens(6000), "a short answer"]));
  assert.equal(two.changed, 2, "two results of 6K: 12K the turn saves");
  assert.equal(two.ids, 2);
  assert.equal(/** @type {any} */ (two.messages[1].content)[2].content, "a short answer");
  // What the turn saves, not what it holds: a big result that is a picture is no saving.
  const shot = [{ type: "text", text: ofTokens(12000) }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }];
  assert.equal(lineResults(step([/** @type {any} */ (shot), ofTokens(4000)])).changed, 0);
});

test("lineResults: the pair stays whole; an empty result says so without an id; a cleared one and a pointer are left alone", () => {
  const msgs = [
    { role: "assistant", content: [{ type: "tool_use", id: "a", name: "read", input: {} }, { type: "tool_use", id: "b", name: "read", input: {} }, { type: "tool_use", id: "c", name: "read", input: {} }, { type: "tool_use", id: "d", name: "read", input: {} }] },
    { role: "user", content: [
      { type: "tool_result", tool_use_id: "a", content: LISTING },
      { type: "tool_result", tool_use_id: "b", content: "" },
      { type: "tool_result", tool_use_id: "c", content: CLEARED_TEXT },
      { type: "tool_result", tool_use_id: "d", content: 'result r:95527469 (30 lines, ok) — filament_recall({ result: "r:95527469" }) brings it back' },
    ] },
  ];
  const r = lineResults(msgs, { min: 0 });
  assert.equal(r.changed, 2);
  const blocks = /** @type {any[]} */ (r.messages[1].content);
  assert.deepEqual(blocks.map((b) => b.tool_use_id), ["a", "b", "c", "d"], "every pair intact");
  assert.equal(blocks[0].content, "30 lines · 410 chars — result r:95527469");
  assert.equal(blocks[1].content, "(no output)");
  assert.equal(blocks[2].content, CLEARED_TEXT);
  assert.equal(blocks[3], msgs[1].content[3], "a pointer is already its line");
  assert.deepEqual(lineResults(msgs, { min: 0 }), r, "deterministic");
});

// (fails before: yes — the review of d55677d7f: a result that was a picture became "(no output)", and one with words
// beside it a line whose id brought the words back alone)
test("lineResults: a result holding a picture stays whole", () => {
  const shot = [{ type: "text", text: LISTING }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }];
  const msgs = [
    { role: "assistant", content: [{ type: "tool_use", id: "s", name: "screenshot", input: {} }, { type: "tool_use", id: "p", name: "screenshot", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "s", content: shot }, { type: "tool_result", tool_use_id: "p", content: [shot[1]] }] },
  ];
  const r = lineResults(msgs, { min: 0 });
  assert.equal(r.changed, 0);
  assert.equal(r.messages[1], msgs[1], "both as they ran");
});

test("the knobs take One line, and keep the policies chosen before valid", () => {
  for (const v of ["keep", "line", "status", "dedupe-to-tail", "pointer"]) {
    assert.equal(resolveSettings({ session: { context: { results: v } } }).effective.context.results, v, `context.results ${v}`);
  }
  assert.ok(KNOBS["fork.results"].options?.includes("line"), "a fork may start on One line");
});
