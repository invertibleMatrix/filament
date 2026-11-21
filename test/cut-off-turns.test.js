// @ts-check
// A turn cut off before its reply (the filament-agent plan's 2b-C D8): a restart or a crash ended it — a request still
// ran it when this Filament started (`meta.running`), and it has no reply — so none will come. What it did is real: it stays in Filament's copy of the
// chat, with what the archive holds of it and Filament's line as its reply, where it was left out before. The rules are
// shapes.js's, pure; the session's turn is pinned in sessions-api.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { modelTurnsOf, cutOffBefore, CUT_OFF_LINE, renderTurn } from "../src/app/sessions/shapes.js";
import { readFileSync } from "node:fs";
import { agentHeld } from "../src/app/sessions/agent-line.js";
import { textOfMessage } from "../src/core/messages.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { openTurnWords } from "../src/ui/harness/lib/labels.js";

const BOOT = 10_000;
/** @param {string} text */
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
/** @param {string} text */
const said = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
/** Turn `n`, begun at n seconds, finished unless `o` says otherwise. @param {number} n @param {Record<string, any>} [o] */
const turn = (n, o = {}) => ({ turnId: n, n, startedAt: 1000 * n, user: user(`turn ${n}`), work: /** @type {any[]} */ ([]), final: /** @type {any} */ (said(`done ${n}`)), meta: /** @type {Record<string, any>} */ ({}), ...o });
/** Turn `n` with no reply, a request still running it: its mark is when it began. @param {number} n @param {Record<string, any>} [o] */
const ran = (n, o = {}) => turn(n, { final: null, ...o, meta: { running: 1000 * n, ...o.meta } });

// (fails before: yes — every turn without a reply was left out, the one a restart ended with the rest)
test("the turns a model sees: the finished, and those a restart cut off — not one begun since, nor Filament's own", () => {
  const cut = ran(2);
  const since = ran(12); // begun after the start: running
  // (fails before: yes — every turn with no reply begun before the start was cut off, one whose request had already
  // failed or stopped among them: HarnessV3-FailurePoints finding 3)
  const stopped = turn(5, { final: null }); // its request closed before the restart: no mark
  const got = modelTurnsOf([turn(1), cut, turn(3, { meta: { command: true } }), ran(4, { meta: { rewound: { line: "a" } } }), stopped, since], BOOT);
  assert.deepEqual(got.map((t) => t.n), [1, 2]);
  assert.deepEqual([got[1].final, got[1].meta.cutOff], [{ role: "assistant", content: CUT_OFF_LINE }, true], "Filament's line is its reply, and it says so");
  assert.equal(cut.final, null, "the archive's row is left as it is");
  assert.deepEqual([cutOffBefore(cut, BOOT), cutOffBefore(since, BOOT), cutOffBefore(turn(1), BOOT), cutOffBefore(stopped, BOOT)], [true, false, false, false]);
  assert.equal(cutOffBefore(turn(2, { meta: { running: 2_000 } }), BOOT), false, "a turn with its reply is never cut off");
});

test("a cut-off turn renders raw, its words and Filament's line; one a call left with no result folds, its work kept", () => {
  const [bare] = modelTurnsOf([ran(2)], BOOT);
  const raw = renderTurn(bare, "raw");
  assert.equal(raw.kind, "raw");
  assert.deepEqual(raw.messages.map(textOfMessage), ["turn 2", CUT_OFF_LINE]);
  const editing = { role: "assistant", content: [{ type: "text", text: "Editing a.js." }, { type: "tool_use", id: "c1", name: "edit", input: { path: "a.js" } }] };
  const [mid] = modelTurnsOf([ran(2, { work: [editing] })], BOOT);
  const r = renderTurn(mid, "raw");
  assert.deepEqual([r.kind, r.fallback], ["fold", "tool_use c1 has no tool_result"]);
  assert.match(r.messages.map(textOfMessage).join("\n"), /Editing a\.js\.[\s\S]*cut off before its reply/);
});

// (fails before: yes — with a cut-off turn last, what the agent holds read that turn, which said nothing: the agent's
// line went unchecked)
test("what the agent holds is the newest finished turn's word: a cut-off turn after it said nothing", () => {
  const facts = { upstream: "claude-code", context: { held: 120_000, window: 1_000_000, source: "agent" } };
  // Filament restarted at 20 s, while turn 14 ran.
  const turns = modelTurnsOf([turn(13, { endedAt: 13_500, meta: { facts } }), ran(14)], 20_000);
  assert.equal(turns.at(-1)?.meta.cutOff, true, "the cut-off turn is the newest");
  const at = agentHeld({ turns, compactions: [], upstream: "claude-code", window: null });
  assert.deepEqual(at && [at.held, at.window, at.endedAt], [120_000, 1_000_000, 13_500]);
});

// (fails before: yes — the page said "no reply was recorded" of every open turn, whether or not a restart ended it)
test("the page says a restart cut the turn off; an open turn it can't account for keeps its old words", () => {
  const row = (/** @type {number} */ n, /** @type {Record<string, any>} */ o = {}) => ({ n, turnId: n, requestIds: [], user: user(`turn ${n}`), work: [], final: null, open: true, ...o });
  const [cut, open] = transcriptTurns({ turns: [row(2, { cutOff: true }), row(3)] });
  assert.deepEqual([cut.status, cut.cutOff, open.status, open.cutOff], ["open", true, "open", undefined]);
  assert.deepEqual([openTurnWords(cut), openTurnWords(open)], ["cut off before its reply — Filament stopped while it ran", "no reply was recorded for this turn"]);
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(timeline, /if \(turn\.status === "open" && !c\.live\) v\.shim = h\("div", \{ class: "turn-open-note" \}, openTurnWords\(turn\)\);/);
});

// (fails before: yes — HarnessV4_Tasks U1: the line said only that the turn was cut. That the next start kept its work
// from its run's log (A2), and that the agent has it with the next message, was said nowhere on the page)
test("the cut-off line says what was kept of the turn — its rounds and calls, from its run's log; a log that held none, and a turn with no mark, say no more than is known", () => {
  const row = (/** @type {number} */ n, /** @type {Record<string, any>} */ o = {}) => ({ n, turnId: n, requestIds: [], user: user(`turn ${n}`), work: [], final: null, open: true, ...o });
  const [kept, other] = transcriptTurns({ turns: [row(2, { cutOff: true, cut: { rounds: 3, tools: 5, logged: 6 } }), row(3, { cut: { rounds: 3, tools: 5, logged: 6 } })] });
  assert.deepEqual([kept.cut, other.cut], [{ rounds: 3, tools: 5, logged: 6 }, undefined], "a cut-off turn's alone");
  const head = "cut off before its reply — Filament stopped while it ran";
  assert.equal(openTurnWords(kept), `${head}. What it had done is kept from its run's log (3 rounds, 5 tool calls): the agent has it with your next message`);
  assert.equal(openTurnWords({ cutOff: true, cut: { rounds: 1, tools: 1, logged: 2 } }), `${head}. What it had done is kept from its run's log (1 round, 1 tool call): the agent has it with your next message`);
  assert.equal(openTurnWords({ cutOff: true, cut: { rounds: 2, tools: 0, logged: 1 } }), `${head}. What it had done is kept from its run's log (2 rounds): the agent has it with your next message`, "words alone");
  assert.equal(openTurnWords({ cutOff: true, cut: { rounds: 0, tools: 0 } }), `${head}. Its run's log shows no work before that`);
  // (fails before: yes — found in the live drive: a turn cut while its first reply streamed read "kept … (1 round)",
  // and the log held none of it)
  assert.equal(openTurnWords({ cutOff: true, cut: { rounds: 1, tools: 0, logged: 0 } }), `${head}. Nothing of it is kept: it was cut before a reply was whole, and a reply joins its run's log only then`, "a round that began, and nothing rebuilt");
  assert.equal(openTurnWords({ cutOff: true }), head, "no mark: a turn with no run log to read");
  assert.equal(openTurnWords({ cut: { rounds: 3, tools: 5 } }), "no reply was recorded for this turn");
});
