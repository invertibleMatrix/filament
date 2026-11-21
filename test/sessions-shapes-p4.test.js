// HarnessV2 Phase 4: the shapes, the result policies, the rank rule, compaction.mode ask, thinking on the body — all
// pure over the composer.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shapePlan, shapeAt, renderTurn, pointerResults, dedupeResults, stripThinking, resultRef, lowerShape,
} from "../src/app/sessions/shapes.js";
import { compose } from "../src/app/sessions/compose.js";
import { resolveSettings, resultCapOf, globalLayer, SHAPE_RANK } from "../src/services/session-settings.js";

/** A completed turn with one tool round: read a file, answer. */
const turn = (n, { file = `f${n}.txt`, result = `contents of file ${n}`, tool = "read", shape = null, big = 0, finalBig = 0 } = {}) => ({
  turnId: 100 + n,
  n,
  user: { role: "user", content: [{ type: "text", text: `turn ${n}: look at ${file}` }] },
  work: [
    { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: `t${n}`, name: tool, input: { path: file } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}`, content: result + (big ? " " + "x".repeat(big) : "") }] },
  ],
  final: { role: "assistant", content: [{ type: "text", text: `Turn ${n} done: ${file} says "${result}".` + (finalBig ? " " + "y".repeat(finalBig) : "") }] },
  meta: shape ? { shape: { kind: shape, at: 1, viewVersion: 1 } } : {},
});
const NEW = { role: "user", content: [{ type: "text", text: "what did you read in turn 3" }] };
const settingsFor = (session) => resolveSettings({ session }).effective;

test("renderTurn: raw and fold, and a shape no turn takes any more folds", () => {
  const plain = turn(3);
  assert.equal(renderTurn(plain, "raw").kind, "raw");
  const f = renderTurn(plain, "fold");
  assert.equal(f.kind, "fold"); assert.equal(f.fallback, undefined);
  assert.deepEqual(renderTurn(plain, "summary"), f, "an old shape's name renders as the fold");
  assert.deepEqual(renderTurn(plain, "fold"), renderTurn(plain, "fold"), "deterministic");
});

test("result policies: pointer replaces every result with r:<hash8> + a recall hint; dedupe-to-tail keeps the newest of a repeated call raw and points the older at it", () => {
  const t1 = turn(1, { file: "same.txt", result: "first read" });
  const t2 = turn(2, { file: "other.txt", result: "other" });
  const t3 = turn(3, { file: "same.txt", result: "second read of the same file" });
  const raw = [t1, t2, t3].flatMap((t) => renderTurn(t, "raw").messages);
  // Four messages per raw turn: the user's, the tool_use, the tool_result, the final — results sit at 2, 6, 10.
  const turnOf = (mi) => [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3][mi];
  const p = pointerResults(raw);
  assert.equal(p.changed, 3);
  const line = p.messages[2].content[0].content;
  assert.match(line, /^result r:[0-9a-f]{8} \(1 line, ok\) — filament_recall\(\{ result: "r:[0-9a-f]{8}" \}\) brings it back$/);
  assert.equal(line.slice(9, 17), resultRef("first read"), "the pointer is the hash of the result's text");
  assert.equal(pointerResults(p.messages).changed, 0, "already pointers: left alone");
  const d = dedupeResults(raw, turnOf);
  assert.equal(d.changed, 1, "one repeated call: its older result");
  assert.match(d.messages[2].content[0].content, /^→ superseded by the same call in turn 3 \(r:[0-9a-f]{8}; filament_recall brings this one back\)$/);
  assert.equal(d.messages[10].content[0].content, "second read of the same file", "the newest stays raw");
  assert.equal(d.messages[6].content[0].content, "other", "a call made once is untouched");
  assert.deepEqual(dedupeResults(raw, turnOf), d, "deterministic");
});

test("thinking: earlier turns' thinking blocks are stripped from raw unless keepInHistory; a message left empty keeps a placeholder", () => {
  const t = turn(1);
  t.work[0].content.unshift({ type: "thinking", thinking: "let me think", signature: "sig" });
  const kept = renderTurn(t, "raw", { keepThinking: true });
  assert.equal(kept.stripped, undefined); assert.equal(kept.messages[1].content[0].type, "thinking");
  const r = renderTurn(t, "raw");
  assert.equal(r.stripped, 1); assert.deepEqual(r.messages[1].content.map((b) => b.type), ["text", "tool_use"]);
  const only = stripThinking([{ role: "assistant", content: [{ type: "thinking", thinking: "x" }] }]);
  assert.deepEqual(only.messages[0].content, [{ type: "text", text: "(thinking)" }]);
});

test("shapePlan: whole unless a form folds or a compaction marked the turn — a mark holds under every form, never back up", () => {
  assert.deepEqual(SHAPE_RANK, { raw: 0, fold: 1 });
  assert.equal(lowerShape("fold", "raw"), "fold"); assert.equal(lowerShape("raw", "fold"), "fold"); assert.equal(lowerShape("raw", "raw"), "raw");
  assert.deepEqual(shapePlan(3, "plain"), ["raw", "raw", "raw"], "Whole: every turn as it was sent");
  assert.deepEqual(shapePlan(3, "plain", ["fold", "fold", null]), ["fold", "fold", "raw"], "a fold compaction's marks fold its turns under Whole");
  assert.deepEqual(shapePlan(5, "fold+2"), ["fold", "fold", "fold", "raw", "raw"], "a fresh agent session's Folded, newest 2 whole");
  assert.deepEqual(shapePlan(5, "fold+2", [null, null, null, "fold", null]), ["fold", "fold", "fold", "fold", "raw"], "a mark holds where the form would keep the turn whole");
  assert.deepEqual(shapePlan(3, "plain", [null, "summary", null]), ["raw", "fold", "raw"], "a mark of a shape no turn takes any more folds the turn");
  assert.deepEqual(shapePlan(2, "words"), ["fold", "fold"]);
  assert.equal(shapeAt(1, "fold+2"), "raw"); assert.equal(shapeAt(2, "fold+2"), "fold");
  assert.equal(shapeAt(0, "no-such-form"), "fold", "a form it does not know folds");
});

test("resultCapOf: the loop's result cap — a document number wins (0 included), null takes the global", () => {
  assert.equal(resultCapOf({ resultCapChars: 400 }, { resultCapChars: 9000 }), 400, "the session's own cap");
  assert.equal(resultCapOf({ resultCapChars: 0 }, { resultCapChars: 9000 }), 0, "0 in the document is off, whatever the global says");
  assert.equal(resultCapOf({ resultCapChars: null }, { resultCapChars: 9000 }), 9000, "null takes the global");
  assert.equal(resultCapOf(null, { resultCapChars: 9000 }), 9000, "a request with no document reads the global — a plain chain's loop turn");
  assert.equal(resultCapOf(null, { resultCapChars: 0 }), 0);
  assert.equal(resultCapOf(null, {}), 0, "no cap anywhere");
});

test("the global layer states a global result cap, so the document's hash moves with it", () => {
  assert.equal(globalLayer({ agentLoop: { resultCapChars: 0 } })["loop.resultCapChars"], undefined, "the config's 0 is the document's default: nothing stated, no hash change");
  assert.equal(globalLayer({ agentLoop: { resultCapChars: 12000 } })["loop.resultCapChars"], 12000);
  const off = resolveSettings({ global: globalLayer({ agentLoop: { resultCapChars: 0 } }) });
  const on = resolveSettings({ global: globalLayer({ agentLoop: { resultCapChars: 12000 } }) });
  assert.notEqual(off.hash, on.hash, "turning a global cap on is a boundary");
  assert.equal(on.effective.loop.resultCapChars, 12000);
});

test("compose: a turn that asks first stops at the edge instead of making room; thinking rides the body clamped under max_tokens", async () => {
  const settings = settingsFor({ context: { compaction: { thresholdPercent: 60, mode: "ask" } } });
  const bigger = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => turn(n, { big: 6000, finalBig: 6000 }));
  // `asks`: its caller says the turn is a message a person sends into a session that asks (HarnessV4_Tasks C26).
  const c = await compose({ turns: bigger, settings, newUser: NEW, model: "m", window: 20000, asks: true });
  assert.equal(c.report.overLine, true);
  assert.equal(c.report.needsCompaction, true);
  assert.ok(c.report.notes.some((n) => /this session asks before it makes room \(context\.compaction\.mode\)$/.test(n)), c.report.notes.join(" | "));
  // Automatic: over the line too, and no ask words — the caller's compactor makes room (the service's turn start).
  const auto = await compose({ turns: bigger, settings: settingsFor({ context: { compaction: { thresholdPercent: 60 } } }), newUser: NEW, model: "m", window: 20000 });
  assert.equal(auto.report.overLine, true);
  assert.ok(!auto.report.notes.some((n) => /asks before it makes room/.test(n)), auto.report.notes.join(" | "));
  const th = await compose({ turns: [turn(1)], settings: settingsFor({ model: { thinking: { budget: 8000 } } }), newUser: NEW, model: "m", maxTokens: 4000 });
  assert.deepEqual(th.body.thinking, { type: "enabled", budget_tokens: 2976 }); assert.equal(th.report.thinking, 2976);
  assert.ok(th.report.notes.some((n) => /clamped to 2976/.test(n)));
  const low = await compose({ turns: [turn(1)], settings: settingsFor({ model: { thinking: { budget: 500 } } }), newUser: NEW, model: "m" });
  assert.equal(low.body.thinking, undefined); assert.ok(low.report.notes.some((n) => /below the provider's floor/.test(n)));
  const none = await compose({ turns: [turn(1)], settings: settingsFor({}), newUser: NEW, model: "m" });
  assert.equal(none.body.thinking, undefined);
  // max_tokens at or under the floor leaves no room: the provider refuses budget_tokens ≥ max_tokens, so thinking stays off.
  for (const maxTokens of [1024, 800]) {
    const tight = await compose({ turns: [turn(1)], settings: settingsFor({ model: { thinking: { budget: 5000 } } }), newUser: NEW, model: "m", maxTokens });
    assert.equal(tight.body.thinking, undefined, `max_tokens ${maxTokens}`);
    assert.equal(tight.body.max_tokens, maxTokens);
    assert.ok(tight.report.notes.some((n) => /leaves no room for a thinking budget/.test(n)), tight.report.notes.join(" | "));
  }
  const edge = await compose({ turns: [turn(1)], settings: settingsFor({ model: { thinking: { budget: 5000 } } }), newUser: NEW, model: "m", maxTokens: 1500 });
  assert.deepEqual(edge.body.thinking, { type: "enabled", budget_tokens: 1024 }, "the floor, still under max_tokens");
  const room = await compose({ turns: [turn(1)], settings: settingsFor({ model: { thinking: { budget: 3500 } } }), newUser: NEW, model: "m", maxTokens: 4000 });
  assert.deepEqual(room.body.thinking, { type: "enabled", budget_tokens: 3500 }, "a budget under max_tokens goes out as set");
});

test("compose: every turn whole under the defaults (§13)", async () => {
  const turns = [1, 2, 3, 4, 5, 6].map((n) => turn(n, { big: 9000 }));
  const c = await compose({ turns, settings: settingsFor({}), newUser: NEW, model: "m" });
  assert.deepEqual(c.report.turns.map((t) => t.shape), ["raw", "raw", "raw", "raw", "raw", "raw"]);
  assert.equal(c.report.form, "plain");
});

test("compose: a fold compaction's turns in the window are folded under the defaults", async () => {
  const turns = [1, 2, 3].map((n) => turn(n));
  for (const t of turns.slice(0, 2)) t.meta = { compacted: { shape: "fold", id: 7, at: 1 } };
  const c = await compose({ turns, compactions: [{ id: 7, from_turn: 1, to_turn: 2, kind: "manual", method: "fold", text: null }], settings: settingsFor({}), newUser: NEW, model: "m" });
  assert.deepEqual(c.report.turns.map((t) => t.shape), ["fold", "fold", "raw"]);
  assert.equal(c.report.foldedTurns, 2);
});
