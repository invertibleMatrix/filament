// @ts-check
// The turn collector decides the line break before a tool's line and the gaps around a woven thought from the reply's
// last two characters, kept as it grows (acp-collect.js `tail`), not by asking the whole reply — a string grown a piece
// at a time, which each ask copied whole: a long turn's tool lines were quadratic (the owner's of 11-17: a coding
// agent's burst of updates held the server 14.5 s, 3.2 s of it in `appendText`). What it collects, streams and hands
// the page is what the collector of v0.9.79 did, on random turns in every mode (the oracle, test/fixtures).
// (fails before: yes — 30,000 tool lines took seconds, past the bound below)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTurnCollector } from "../src/app/acp-collect.js";
import { createTurnCollector as before } from "./fixtures/acp-collect-v0979.js";

/** A seeded generator, so a failure is the same failure again. @param {number} seed */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const TEXTS = ["a", "word.", "line\n", "para\n\n", "\n", " ", "x\ny", "", "ends in two\n\n\n", "z"];
const THOUGHTS = ["hmm", "think\n", " ", "deep\n\nthought", "\n", "x"];
const LINES = ["⚙ run ls", "⚙ read a.js\n", "", "\n", "▸ plan\n\n", "?"];

/**
 * One collector of `make`'s, its wire and its page logged.
 * @param {typeof createTurnCollector} make @param {any} mode
 */
function collector(make, mode) {
  /** @type {string[]} */
  const log = [];
  const rec = /** @type {any} */ ({});
  const c = make({
    rec,
    stream: mode.stream,
    wire: /** @type {any} */ ({ streamText: (/** @type {string} */ t) => log.push(`wire text:${t}`), streamThought: (/** @type {string} */ t) => log.push(`wire thinking:${t}`), breakBlock: () => log.push("wire break") }),
    thoughtsMode: mode.thoughtsMode,
    renderer: { handle: (/** @type {any} */ ev) => ev.line },
    log: () => {},
    progress: (/** @type {any} */ p) => log.push(`progress ${p.outChars} ${p.stage}`),
    harness: mode.harness,
    paged: mode.paged,
    words: { piece: (/** @type {string} */ type, /** @type {string} */ text) => log.push(`page ${type}:${text}`), endBlock: () => log.push("page end") },
  });
  return { c, log, rec };
}

test("what the collector collects, streams and hands the page is what v0.9.79's did, on random turns in every mode", () => {
  const r = rng(11_17);
  const pick = (/** @type {any[]} */ xs) => xs[Math.floor(r() * xs.length)];
  for (let t = 0; t < 3000; t++) {
    const harness = r() < 0.4;
    const mode = { harness, paged: harness || r() < 0.4, stream: r() < 0.8, thoughtsMode: pick(["text", "native-then-inline", "thinking-block", "hide"]) };
    const now = collector(createTurnCollector, mode);
    const was = collector(before, mode);
    const steps = Math.floor(r() * 40);
    for (let k = 0; k < steps; k++) {
      const x = r();
      /** @type {(c: any) => any} */
      const step =
        x < 0.3 ? ((text, own) => (c) => c.onEvent({ type: "text", text, ...(own ? { own } : {}) }))(pick(TEXTS), r() < 0.1)
        : x < 0.5 ? ((text) => (c) => c.onEvent({ type: "thought", text }))(pick(THOUGHTS))
        : x < 0.7 ? ((line, type) => (c) => c.onEvent({ type, line, toolCallId: `t${k}` }))(pick(LINES), pick(["tool", "tool", "plan", "subagent", "compaction"]))
        : x < 0.75 ? ((line) => (c) => c.onEvent({ type: "agent-notice", line }))(pick(LINES))
        : x < 0.83 ? ((words) => (c) => c.ownLine(words))(pick(["a note", "stopped", ""]))
        : x < 0.91 ? (c) => c.breakBlock()
        : x < 0.96 ? (c) => c.flushThought()
        : (c) => c.thought(k);
      const a = step(now.c);
      const b = step(was.c);
      assert.equal(a, b, `turn ${t}, step ${k}: what it returns`);
    }
    now.c.flushThought();
    was.c.flushThought();
    assert.deepEqual(now.c.col, was.c.col, `turn ${t}: what it collected (${JSON.stringify(mode)})`);
    assert.deepEqual(now.log, was.log, `turn ${t}: what it streamed and handed the page`);
    assert.deepEqual(now.c.said, was.c.said, `turn ${t}: Filament's own words`);
    assert.deepEqual(now.rec, was.rec, `turn ${t}: what it noted on the request's record`);
  }
});

test("a long turn's tool lines cost what each line is, not what the reply has grown to", () => {
  const { c } = collector(createTurnCollector, { harness: false, paged: false, stream: false, thoughtsMode: "text" });
  c.onEvent({ type: "text", text: "x".repeat(200_000) });
  const t0 = performance.now();
  for (let k = 0; k < 30_000; k++) {
    c.onEvent({ type: "tool", line: "⚙ read src/some/file/path.js (120 lines)", toolCallId: `t${k}` });
    c.onEvent({ type: "text", text: "some words the model said in between" });
  }
  const ms = performance.now() - t0;
  assert.ok(c.col.text.length > 2_000_000);
  assert.ok(ms < 1500, `30,000 tool lines in ${ms.toFixed(0)} ms`);
});
