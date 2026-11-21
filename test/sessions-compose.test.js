// HarnessV2 P2: the composer — shapes, result policies, the compaction at the line, a compaction's marks, determinism.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapePlan, renderTurn, statusResults, clearResults, trajectoryProblem, CLEARED_TEXT } from "../src/app/sessions/shapes.js";
import { compose, COPY_WORDS } from "../src/app/sessions/compose.js";
import { replyHeadroom } from "../src/core/tokens.js";
import { summaryLead, SUMMARY_ACK } from "../src/app/sessions/compaction.js";
import { resolveSettings } from "../src/services/session-settings.js";

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
  meta: shape ? { compacted: { shape, id: 1, at: 1 } } : {},
});
const NEW = { role: "user", content: [{ type: "text", text: "what did you find in the file you read in turn 1" }] };
const settingsFor = (session) => resolveSettings({ session }).effective;

test("shapePlan: the forms over positions; a compaction's fold mark wins; raw never pins", () => {
  assert.deepEqual(shapePlan(4, "plain"), ["raw", "raw", "raw", "raw"]);
  assert.deepEqual(shapePlan(4, "fold"), ["fold", "fold", "fold", "fold"]);
  assert.deepEqual(shapePlan(4, "fold+2"), ["fold", "fold", "raw", "raw"]);
  assert.deepEqual(shapePlan(3, "fold+2", ["raw", "fold", null]), ["fold", "fold", "raw"], "a fold mark stays folded where the form says raw; a raw mark does not pin");
  assert.deepEqual(shapePlan(3, "plain", ["fold", null, null]), ["fold", "raw", "raw"], "a fold compaction's mark holds under Whole");
});

test("renderTurn: raw is the archived bytes; fold is two messages with one stub per tool call, deterministic", () => {
  const t = turn(1);
  const raw = renderTurn(t, "raw");
  assert.equal(raw.kind, "raw"); assert.equal(raw.messages.length, 4); assert.equal(raw.messages[2].content[0].type, "tool_result");
  const fold = renderTurn(t, "fold", { stubChars: 160 });
  assert.equal(fold.kind, "fold"); assert.equal(fold.messages.length, 2); assert.equal(fold.stubs, 1);
  assert.equal(fold.messages[0].role, "user"); assert.equal(fold.messages[1].role, "assistant");
  const text = fold.messages[1].content[0].text;
  assert.match(text, /⚙ read f1\.txt → contents of file 1/);
  assert.match(text, /Turn 1 done/);
  assert.deepEqual(renderTurn(t, "fold", { stubChars: 160 }), fold, "same bytes in, same bytes out");
  assert.equal(renderTurn(t, "summary").kind, "fold", "unbuilt shapes fall back to fold, never to an invented digest");
});

test("a turn whose archived trajectory is not a conversation never goes out raw: fold instead, the reason reported", async () => {
  const good = turn(1);
  assert.equal(trajectoryProblem(good), null);
  const open = turn(2);
  open.work = [open.work[0]]; // the tool_use's result never landed (an interrupted or imported turn)
  assert.match(String(trajectoryProblem(open)), /tool_use t2 has no tool_result/);
  const twoAssistants = turn(3);
  twoAssistants.work = [{ role: "assistant", content: [{ type: "text", text: "a" }] }, { role: "assistant", content: [{ type: "text", text: "b" }] }];
  assert.match(String(trajectoryProblem(twoAssistants)), /message 3 is assistant, expected user/);
  const r = renderTurn(open, "raw");
  assert.equal(r.kind, "fold");
  assert.match(String(r.fallback), /no tool_result/);
  const c = await compose({ turns: [good, open], settings: settingsFor({}), newUser: NEW, model: "m" });
  const roles = c.body.messages.map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "user", "assistant", "user", "assistant", "user"], "turn 1 raw (4), turn 2 folded (2), the new message");
  assert.deepEqual(c.report.turns.map((t) => t.shape), ["raw", "fold"]);
  assert.ok(c.report.notes.some((n) => /turn 2 folded instead of raw/.test(n)));
  assert.equal(c.report.underSummary, 0);
});

test("result policies: status summarises long results and keeps pairs; the overflow recovery keeps the newest N compactable results", () => {
  const long = turn(1, { big: 5000 });
  const s = statusResults(long.work);
  assert.equal(s.changed, 1);
  assert.match(s.messages[1].content[0].content, /^1 line · 4\.9 KB$/);
  assert.equal(s.messages[1].content[0].tool_use_id, "t1", "the pair is intact");
  assert.equal(statusResults(turn(2).work).changed, 0, "a short result is already its own summary");
  const msgs = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => [turn(n).user, ...turn(n).work, turn(n).final]);
  const c = clearResults(msgs, { keepRecent: 5 });
  assert.equal(c.cleared, 2);
  const results = c.messages.filter((m) => m.role === "user" && m.content[0]?.type === "tool_result").map((m) => m.content[0].content);
  assert.deepEqual(results.slice(0, 2), [CLEARED_TEXT, CLEARED_TEXT]);
  assert.equal(results[2], "contents of file 3");
  const nonCompactable = [turn(9, { tool: "ask" }).user, ...turn(9, { tool: "ask" }).work, turn(9, { tool: "ask" }).final];
  assert.equal(clearResults([...nonCompactable, ...msgs], { keepRecent: 0 }).cleared, 7, "ask is not compactable");
});

test("compose: plain keeps every turn raw — turn 1's tool_result reaches the model verbatim (the parity assertion)", async () => {
  const turns = [turn(1, { result: "the secret is 42" }), turn(2)];
  // (What the Plain preset named, while there were presets: memory on, the rest the defaults.)
  const c = await compose({ turns, settings: settingsFor({ memory: { enabled: true } }), newUser: NEW, model: "m", window: 200000 });
  const flat = JSON.stringify(c.body.messages);
  assert.match(flat, /the secret is 42/);
  assert.equal(c.body.messages.length, 9, "4 + 4 + the new message");
  assert.equal(c.body.messages.at(-1), NEW);
  assert.equal(c.report.form, "plain"); assert.equal(c.report.results, "keep");
  assert.deepEqual(c.report.turns.map((t) => t.shape), ["raw", "raw"]);
  assert.equal(c.body.model, "m"); assert.equal(c.body.max_tokens, 128000, "no session cap and no stated maximum: the 128,000 floor"); assert.equal(c.body.stream, true);
});

test("compose: a fold compaction's marks fold its turns under Whole, and the result is byte-identical across two runs", async () => {
  const turns = [turn(1, { big: 3000, shape: "fold" }), turn(2, { big: 3000, shape: "fold" }), turn(3), turn(4)];
  const settings = settingsFor({ context: { results: "status" } });
  const a = await compose({ turns, settings, newUser: NEW, model: "m" });
  const b = await compose({ turns, settings, newUser: NEW, model: "m" });
  assert.equal(JSON.stringify(a.body), JSON.stringify(b.body), "determinism");
  assert.deepEqual(a.report.turns.map((t) => t.shape), ["fold", "fold", "raw", "raw"]);
  assert.equal(a.body.messages.length, 2 + 2 + 4 + 4 + 1);
  assert.ok(a.report.sentTokens < a.report.historyTokens, "the fold saves tokens");
  assert.equal(a.report.results, "status");
  assert.equal(a.report.foldedTurns, 2);
  // A fresh agent session's Folded, newest 2 whole, over the same turns: the marks hold, and the form folds the rest.
  const carried = await compose({ turns, settings, form: "fold+2", newUser: NEW, model: "m" });
  assert.deepEqual(carried.report.turns.map((t) => t.shape), ["fold", "fold", "raw", "raw"]);
  assert.equal(carried.report.form, "fold+2");
});

// (fails before: yes — HarnessV4_Tasks U0 item 8, V4-D302: under a Folded view the turns it keeps whole sent each tool
// result as one status line, so "Folded, newest 2 whole" was not whole: the model no longer had what those turns read)
test("compose: the turns a form keeps whole keep their tool results; Tool results set to one line still makes them one line", async () => {
  const turns = [1, 2, 3].map((n) => turn(n, { big: 3000 })).concat(turn(4, { big: 3000, result: "the newest secret" }));
  const c = await compose({ turns, settings: settingsFor({}), form: "fold+2", newUser: NEW, model: "m" });
  assert.equal(c.report.results, "keep");
  assert.deepEqual(c.report.turns.map((t) => t.shape), ["fold", "fold", "raw", "raw"]);
  assert.match(JSON.stringify(c.body.messages), /the newest secret x{3000}/, "the newest turn's result goes whole");
  assert.equal((JSON.stringify(c.body.messages).match(/x{3000}/g) || []).length, 2, "the two whole turns' results, whole");
  // Chosen by hand: one line each, as before.
  const lined = await compose({ turns, settings: settingsFor({ context: { results: "status" } }), form: "fold+2", newUser: NEW, model: "m" });
  assert.equal(lined.report.results, "status");
  assert.doesNotMatch(JSON.stringify(lined.body.messages), /x{3000}/);
});

test("compose: the line holds in every form — a fold is over it too — and the reply's room is the max_tokens clamp", async () => {
  // window 20,000 × 85% = a 17,000-token line; three big finals put fold+2 over it (a fold keeps the model's text).
  const settings = settingsFor({ context: { compaction: { thresholdPercent: 85 } } });
  const turns = [1, 2, 3].map((n) => turn(n, { finalBig: 24000 }));
  const c = await compose({ turns, settings, form: "fold+2", newUser: NEW, model: "m", window: 20000, maxTokens: 16000 });
  assert.equal(c.report.overLine, true, "a folded form is over the line too, not Whole alone");
  assert.equal(c.report.head, null, "the composer writes nothing: making room is the compactor's (compactor.js)");
  assert.ok(!c.report.notes.some((n) => /compaction\.mode is ask/.test(n)), "auto: no ask words — the caller makes room");
  // What the compactor wrote is the head the next composition starts from, and the line is behind it.
  const after = await compose({ turns, settings, form: "fold+2", newUser: NEW, model: "m", window: 20000, maxTokens: 16000, compactions: [{ from_turn: 1, to_turn: 3, kind: "plain", text: "S" }] });
  assert.match(after.body.messages[0].content[0].text, /^\[Filament compacted turns 1–3 /);
  assert.equal(after.report.overLine, false, "nothing past the head: the window restarts from the summary");
  // The clamp: a history over half the window (and under the line) goes out whole, and max_tokens gives the reply
  // what remains minus the headroom (what rides after the compose, and the estimate's own drift).
  const over = await compose({ turns: [1, 2, 3].map((n) => turn(n, { finalBig: 12000 })), settings, form: "fold+2", newUser: NEW, model: "m", window: 20000, maxTokens: 16000 });
  assert.equal(over.report.overLine, false, "under the line");
  const headroom = Math.max(1536, Math.floor(20000 * 0.02));
  assert.ok(over.report.sentTokens > 4000 && over.report.sentTokens < 20000 - 1024 - headroom, `sized to exercise the clamp: ${over.report.sentTokens}`);
  assert.equal(over.body.max_tokens, Math.max(1024, Math.min(16000, 20000 - over.report.sentTokens - headroom)), "max_tokens clamped to the room less the headroom");
  assert.ok(over.report.notes.some((n) => /max_tokens 16,000 clamped/.test(n)), over.report.notes.join(" | "));
  // Under the line the clamp is quiet and the request goes out as configured.
  const small = await compose({ turns: [turn(1)], settings: settingsFor({}), form: "fold+2", newUser: NEW, model: "m", window: 20000, maxTokens: 16000 });
  assert.equal(small.body.max_tokens, 16000);
  assert.ok(!small.report.notes.some((n) => /clamped/.test(n)));
});

// (fails before: yes — HarnessV4_Tasks C20: the composer had one set of words for the window stage, a request's: a
// coding agent's turn that went on in its own session noted "compact before the next turn", "the request leaves 0
// tokens" and a clamp of max_tokens, about Filament's copy, which that turn never sent)
test("compose: a coding agent holds the conversation — the window stage speaks of Filament's copy, and notes no clamp of a request that is the agent's", async () => {
  const settings = settingsFor({ context: { compaction: { mode: "ask", thresholdPercent: 30 } } });
  const turns = [1, 2, 3].map((n) => turn(n, { finalBig: 24000 }));
  // `asks`: the turn is a message a person sends into a session that asks before it makes room (HarnessV4_Tasks C26).
  const args = { turns, settings, newUser: NEW, model: "m", window: 40000, maxTokens: 64000, asks: true };
  const sent = await compose(args);
  const copy = await compose({ ...args, agentHolds: true });
  const ofRequest = /compact before the next turn|max_tokens|the request leaves|the history weighs/;
  assert.ok(sent.report.notes.some((n) => /^the history weighs [\d,]+ of the 40,000-token window, past the 12,000-token compaction line: this session asks before it makes room \(context\.compaction\.mode\)$/.test(n)), sent.report.notes.join(" | "));
  // A turn that does not ask (a running turn's next request, a session that makes room by itself) is its caller's to
  // compact: over the line, and not stopped here.
  const going = await compose({ ...args, asks: false });
  assert.deepEqual([going.report.overLine, going.report.needsCompaction], [true, false]);
  assert.ok(sent.report.notes.some((n) => /^max_tokens 64,000 clamped to /.test(n)), sent.report.notes.join(" | "));
  // The same judgement — the caller decides what it means for an agent's turn — in the copy's words, said once.
  assert.deepEqual([copy.report.overLine, copy.report.needsCompaction, copy.report.sentTokens, copy.report.usable], [true, true, sent.report.sentTokens, 12000]);
  assert.deepEqual(
    copy.report.notes.filter((n) => !sent.report.notes.includes(n)),
    [`Filament's copy of the chat weighs ≈${copy.report.sentTokens.toLocaleString()} of the agent's 40,000-token window, past the 12,000-token compaction line. ${COPY_WORDS}`],
  );
  assert.ok(!copy.report.notes.some((n) => ofRequest.test(n)), copy.report.notes.join(" | "));
  assert.deepEqual(sent.report.notes.filter((n) => !copy.report.notes.includes(n)).every((n) => ofRequest.test(n)), true, "every other note is the same");

  // No room for a reply after the copy: said the same way, and under auto too.
  const full = await compose({ turns, settings: settingsFor({ context: { compaction: { thresholdPercent: 100 } } }), newUser: { role: "user", content: [{ type: "text", text: "z".repeat(66000) }] }, model: "m", window: 20000, agentHolds: true });
  assert.equal(full.report.needsCompaction, true);
  assert.deepEqual(
    full.report.notes.filter((n) => n.startsWith("Filament's copy")),
    [`Filament's copy of the chat weighs ≈${full.report.sentTokens.toLocaleString()} of the agent's 20,000-token window, leaving under the 1,024-token reply floor. ${COPY_WORDS}`],
  );
  assert.ok(!full.report.notes.some((n) => ofRequest.test(n)), full.report.notes.join(" | "));
  // A copy with room says nothing of the window at all.
  const small = await compose({ turns: [turn(1)], settings, newUser: NEW, model: "m", window: 200000, agentHolds: true });
  assert.ok(!small.report.notes.some((n) => n.startsWith("Filament's copy")), small.report.notes.join(" | "));
});

test("compose: a request that leaves under the reply floor stops in words — needsCompaction, nothing sent", async () => {
  const settings = settingsFor({ context: { compaction: { thresholdPercent: 100 } } });
  const turns = [1, 2, 3].map((n) => turn(n, { finalBig: 24000 }));
  const c = await compose({ turns, settings, newUser: { role: "user", content: [{ type: "text", text: "z".repeat(66000) }] }, model: "m", window: 20000 });
  assert.equal(c.report.needsCompaction, true, "the new message alone nearly fills the window");
  assert.ok(c.report.notes.some((n) => /not even the 1,024-token reply floor fits/.test(n)), c.report.notes.join(" | "));
});

test("compose: a compaction head replaces the turns it covers — its own message pair before the first kept turn", async () => {
  const turns = [turn(1), turn(2), turn(3)];
  const c = await compose({
    turns, settings: settingsFor({}), newUser: NEW, model: "m",
    compactions: [{ from_turn: 1, to_turn: 2, kind: "plain", text: "Turns 1-2: read f1 and f2." }],
  });
  assert.deepEqual(c.report.turns.map((t) => t.n), [3]);
  assert.equal(c.body.messages[0].role, "user");
  assert.equal(c.body.messages[0].content[0].text, summaryLead(1, 2, "Turns 1-2: read f1 and f2."));
  assert.equal(c.body.messages[1].role, "assistant");
  assert.equal(c.body.messages[1].content[0].text, SUMMARY_ACK);
  assert.equal(c.body.messages[2].content[0].text, "turn 3: look at f3.txt", "the kept user message is untouched");
  assert.deepEqual(c.report.head, { fromTurn: 1, toTurn: 2, kind: "plain" });
  const none = await compose({ turns, settings: settingsFor({}), newUser: NEW, model: "m", compactions: [{ from_turn: 1, to_turn: 2, kind: "plain", text: null }] });
  assert.equal(none.report.head, null, "a compaction whose text is gone does not hide turns");
});

test("compose: plain never clears — under the edge every result stays whole; at the edge the request is over the line, and a summary restarts it", async () => {
  // window 20,000 × 60% = a 12,000-token compaction line.
  const settings = settingsFor({ context: { compaction: { thresholdPercent: 60 } } });
  const turns = [1, 2, 3, 4, 5, 6].map((n) => turn(n, { big: 2000 })); // ~500 tokens of result each → well under the 12,000-token line
  const under = await compose({ turns, settings, newUser: NEW, model: "m", window: 20000 });
  assert.ok(under.report.sentTokens < under.report.usable, `${under.report.sentTokens} of ${under.report.usable}`);
  assert.ok(!JSON.stringify(under.body.messages).includes(CLEARED_TEXT), "nothing is ever cleared at compose time");
  assert.equal(under.report.overLine, false);
  // Twelve long answers and long results: over the edge — and still nothing is cleared; the compactor makes room.
  const bigger = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => turn(n, { big: 6000, finalBig: 6000 }));
  const over = await compose({ turns: bigger, settings, newUser: NEW, model: "m", window: 20000 });
  assert.equal(over.report.overLine, true);
  assert.ok(!JSON.stringify(over.body.messages).includes(CLEARED_TEXT), "over the line, nothing is cleared either");
  // The summary the compactor writes for turns 1–12 takes the window.
  const withSummary = await compose({ turns: bigger, settings, newUser: NEW, model: "m", window: 20000, compactions: [{ from_turn: 1, to_turn: 12, kind: "plain", text: "SUMMARY: twelve files read." }] });
  assert.equal(withSummary.body.messages.length, 3, "summary, acknowledgment, the new message; the history restarts");
  assert.match(withSummary.body.messages[0].content[0].text, /^\[Filament compacted turns 1–12 /);
  assert.equal(withSummary.body.messages[1].content[0].text, SUMMARY_ACK);
  assert.equal(withSummary.body.messages[2].content[0].text, NEW.content[0].text);
  assert.ok(withSummary.report.sentTokens < 500);
  assert.equal(withSummary.report.overLine, false);
});

// (fails before: yes — the line and the clamp weighed the body alone, though the loop's prompt and tools ride beside it)
test("compose: the line and the reply's room weigh the whole request — the body and what rides beside it (LD-D6)", async () => {
  // window 20,000 × 60% = a 12,000-token compaction line.
  const settings = settingsFor({ context: { compaction: { thresholdPercent: 60 } } });
  const turns = [1, 2, 3, 4, 5, 6].map((n) => turn(n, { big: 2000 }));
  const alone = await compose({ turns, settings, newUser: NEW, model: "m", window: 20000 });
  assert.equal(alone.report.overLine, false);
  assert.equal(alone.report.fixedTokens, 0, "nothing rides beside the body unless the caller says so");
  const sent = alone.report.sentTokens;
  // What rides beside it brings the request to the line exactly.
  const fixed = 12000 - sent;
  const whole = await compose({ turns, settings, newUser: NEW, model: "m", window: 20000, fixed });
  assert.equal(whole.report.sentTokens, sent, "sentTokens stays the body's measure");
  assert.equal(whole.report.fixedTokens, fixed);
  assert.equal(whole.report.overLine, true, "the request is at the line");
  assert.equal(whole.body.max_tokens, 20000 - 12000 - replyHeadroom(20000), "the reply asks for what the whole request leaves of the window");
  assert.ok(whole.report.notes.some((n) => n.includes("the request is 12,000 of the 20,000-token window")), whole.report.notes.join(" | "));
  const ask = await compose({ turns, settings: settingsFor({ context: { compaction: { thresholdPercent: 60, mode: "ask" } } }), newUser: NEW, model: "m", window: 20000, fixed, asks: true });
  assert.equal(ask.report.needsCompaction, true);
  assert.ok(ask.report.notes.some((n) => n.startsWith(`the request weighs 12,000 (its prompt and tools ≈${fixed.toLocaleString("en-US")}) of the 20,000-token window`)), ask.report.notes.join(" | "));
});
