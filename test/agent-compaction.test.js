// @ts-check
// HarnessV3-ACP AC2-1: a coding agent compacting its own context — Codex's `contextCompaction` item, Claude's in each
// way its adapter says it (AC5-7: ACP's compaction updates from 0.87, its call named `compact` to a client that
// declares none, 0.76's call marked `_meta.contextCompaction`) — read into the run's `compacting` and a mark in the
// round it happened in, with the summary it kept, then drawn: live and in words in the transcript, in the Run pane, in
// the lead's count and in an outside client's text. Through the app, in acp-run.test.js; through the bridge, in
// agent-own-compaction.test.js; Codex's, through its fake app-server, in codex.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAgentRun } from "../src/app/agent-run.js";
import { createUpdateReader } from "../src/adapters/agents/acp/updates.js";
import { ActivityRenderer } from "../src/app/acp-render.js";
import { alignEvents, roundCompactingWords, roundCompactionWords, roundNotes } from "../src/ui/harness/lib/labels.js";
import { compactionWords, stationsFrom } from "../src/ui/harness/panes/run.js";
import { compactionCount } from "../src/ui/harness/lib/team.js";

/** A translator over a recording sink. @param {string} [agent] */
function make(agent) {
  /** @type {any[]} */
  const events = [];
  const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, ...(agent ? { agent } : {}) });
  return {
    run,
    /** @param {string} type */
    of: (type) => events.filter((e) => e.type === type),
    /** The events as `type:round`, turn states left out. */
    seq: () => events.filter((e) => e.type !== "turn-state").map((e) => `${e.type}:${e.round}`),
  };
}
/** Claude's compaction call's `_meta`, with what it says of the compaction. @param {Record<string, any>} [cc] */
const meta = (cc = {}) => ({ contextCompaction: { version: 1, ...cc }, claudeCode: { toolName: "compact" } });

describe("the agent's own compaction, read (AC2-1)", () => {
  test("Claude's compaction call is a compaction, not a tool: its start, its end, the figures after it", () => {
    /** @type {any[]} */
    const events = [];
    /** @type {string[]} */
    const notes = [];
    const out = { tools: [] };
    const read = createUpdateReader({ out, conv: {}, turn: {}, onEvent: (/** @type {any} */ e) => events.push(e), notes });
    read({ sessionUpdate: "tool_call", toolCallId: "u1", title: "Compact conversation", kind: "think", status: "in_progress", _meta: meta() });
    read({ sessionUpdate: "tool_call_update", toolCallId: "u1", status: "in_progress", _meta: meta() });
    read({ sessionUpdate: "tool_call_update", toolCallId: "u1", status: "completed", _meta: meta() });
    read({ sessionUpdate: "tool_call_update", toolCallId: "u1", _meta: meta({ trigger: "manual", preTokens: 180000, postTokens: 31000, durationMs: 42000 }) });
    const failed = { type: "content", content: { type: "text", text: "Compaction failed: Not enough messages to compact." } };
    read({ sessionUpdate: "tool_call", toolCallId: "u2", title: "Compact conversation", kind: "think", status: "failed", content: [failed], _meta: meta({ error: "Not enough messages to compact." }) });
    read({ sessionUpdate: "tool_call", toolCallId: "u3", title: "Compact conversation", kind: "think", status: "completed", _meta: meta() }, { subagent: "task_1" });
    assert.deepEqual(events, [
      { type: "compaction", id: "u1", state: "started" },
      { type: "compaction", id: "u1", state: "completed" },
      { type: "compaction", id: "u1", tokensBefore: 180000, tokensAfter: 31000, ms: 42000, manual: true },
      { type: "compaction", id: "u2", state: "failed", error: "Not enough messages to compact." },
      { type: "compaction", id: "u3", state: "completed", subagent: "task_1" },
    ]);
    assert.deepEqual(out.tools, [], "no call the model made");
    assert.deepEqual(notes, ["acp: the agent compacted its context during this turn"], "the turn's own, said once");
  });

  /** A turn's reader over a recording sink: its compaction events, its notes, its calls. */
  const reading = () => {
    /** @type {any[]} */
    const events = [];
    /** @type {string[]} */
    const notes = [];
    const out = { tools: [] };
    const read = createUpdateReader({ out, conv: {}, turn: {}, onEvent: (/** @type {any} */ e) => events.push(e), notes });
    return { read, out, notes, compactions: () => events.filter((e) => e.type === "compaction") };
  };

  // (fails before: yes — HarnessV4_Tasks U3-5: the chunks were gathered and nothing was said of them until the
  // compaction's end, so the page could show no summary growing)
  test("the summary's growth is said as its chunks come: how much is written, at each step of it, never at each chunk", () => {
    const { read, compactions } = reading();
    read({ sessionUpdate: "compaction_update", compactionId: "g1", status: "in_progress" });
    const chunk = (/** @type {number} */ n) => read({ sessionUpdate: "compaction_summary_chunk", compactionId: "g1", content: { type: "text", text: "w".repeat(n) } });
    chunk(120);
    assert.deepEqual(compactions(), [{ type: "compaction", id: "g1", state: "started" }], "under a step: nothing yet");
    chunk(120);
    chunk(30);
    chunk(500);
    assert.deepEqual(compactions().slice(1), [{ type: "compaction", id: "g1", written: 240 }, { type: "compaction", id: "g1", written: 770 }]);
    read({ sessionUpdate: "compaction_update", compactionId: "g1", status: "completed" });
    assert.equal(compactions().at(-1).summary, "w".repeat(770), "the summary is the chunks', as before");
    // A chunk after its end, or of no text, says nothing.
    chunk(900);
    read({ sessionUpdate: "compaction_summary_chunk", compactionId: "g1", content: { type: "image" } });
    assert.equal(compactions().length, 4);
  });

  test("ACP's compaction updates (claude-agent-acp 0.87, to a client that declares them): the start, the summary its chunks or its end said, one end, the figures from Claude's raw boundary after it", () => {
    const { read, out, notes, compactions } = reading();
    read({ sessionUpdate: "compaction_update", compactionId: "c1", status: "in_progress" });
    read.raw({ type: "system", subtype: "status", status: "compacting", uuid: "c1" });
    read({ sessionUpdate: "compaction_summary_chunk", compactionId: "c1", content: { type: "text", text: "Kept: the " } });
    read({ sessionUpdate: "compaction_summary_chunk", compactionId: "c1", content: { type: "text", text: "reading so far." } });
    read({ sessionUpdate: "compaction_update", compactionId: "c1", status: "completed" });
    read.raw({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 180000, post_tokens: 31000, duration_ms: 42000 }, uuid: "b1" });
    // Its end again, once the boundary came: the figures in it are AIR's only.
    read({ sessionUpdate: "compaction_update", compactionId: "c1", status: "completed" });
    read({ sessionUpdate: "compaction_update", compactionId: "c2", status: "in_progress" });
    read({ sessionUpdate: "compaction_update", compactionId: "c2", status: "completed", summary: [{ type: "text", text: "Kept: all of it." }] });
    read({ sessionUpdate: "compaction_update", compactionId: "c3", status: "failed", error: "Not enough messages to compact." });
    // A boundary after a failed one is none of its: no figures go on it.
    read.raw({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 5000 } });
    read({ sessionUpdate: "compaction_update", compactionId: "c4", status: "in_progress" });
    read({ sessionUpdate: "compaction_update", compactionId: "c4", status: "cancelled" });
    read({ sessionUpdate: "compaction_update", compactionId: "s1", status: "completed", summary: [{ type: "text", text: "A sub-agent's." }] }, { subagent: "task_1" });
    assert.deepEqual(compactions(), [
      { type: "compaction", id: "c1", state: "started" },
      { type: "compaction", id: "c1", state: "completed", summary: "Kept: the reading so far." },
      { type: "compaction", id: "c1", tokensBefore: 180000, tokensAfter: 31000, ms: 42000 },
      { type: "compaction", id: "c2", state: "started" },
      { type: "compaction", id: "c2", state: "completed", summary: "Kept: all of it." },
      { type: "compaction", id: "c3", state: "failed", error: "Not enough messages to compact." },
      { type: "compaction", id: "c4", state: "started" },
      { type: "compaction", id: "c4", state: "failed", error: "it was cancelled before it finished" },
      { type: "compaction", id: "s1", state: "completed", summary: "A sub-agent's.", subagent: "task_1" },
    ]);
    assert.deepEqual(out.tools, []);
    assert.deepEqual(notes, ["acp: the agent compacted its context during this turn"], "drawn, so nothing undrawn is said");
  });

  // (fails before: yes — claude-agent-acp 0.87 says its compaction to a client that declares no compaction updates as
  // its call named `compact`, the figures in `rawOutput`, and the reader knew only 0.76's mark: it was drawn as a tool)
  test("claude-agent-acp 0.87, to a client that declares no compaction updates: its call named `compact`, the figures in its `rawOutput` — a compaction, not a tool", () => {
    const { read, out, compactions } = reading();
    const named = { claudeCode: { toolName: "compact" } };
    read({ sessionUpdate: "tool_call", toolCallId: "u1", title: "Compact conversation", kind: "think", status: "in_progress", _meta: named });
    read({ sessionUpdate: "tool_call_update", toolCallId: "u1", status: "in_progress", _meta: named });
    read({ sessionUpdate: "tool_call_update", toolCallId: "u1", status: "completed", _meta: named });
    read({ sessionUpdate: "tool_call_update", toolCallId: "u1", rawOutput: { trigger: "manual", preTokens: 120000, postTokens: 18000, durationMs: 31000 }, _meta: named });
    const failed = { type: "content", content: { type: "text", text: "Compaction failed: Not enough messages to compact." } };
    read({ sessionUpdate: "tool_call", toolCallId: "u2", title: "Compact conversation", kind: "think", status: "failed", content: [failed], rawOutput: { error: "Not enough messages to compact." }, _meta: named });
    assert.deepEqual(compactions(), [
      { type: "compaction", id: "u1", state: "started" },
      { type: "compaction", id: "u1", state: "completed" },
      { type: "compaction", id: "u1", tokensBefore: 120000, tokensAfter: 18000, ms: 31000, manual: true },
      { type: "compaction", id: "u2", state: "failed", error: "Not enough messages to compact." },
    ]);
    assert.deepEqual(out.tools, [], "no call the model made");
  });
});

describe("the agent's own compaction, on the run (AC2-1)", () => {
  test("its start is `compacting`; its end a mark in its round, with the facts that came after it, before the next work", () => {
    const t = make("Claude Code");
    t.run.take({ type: "text", text: "Reading.", messageId: "m1" });
    t.run.take({ type: "compaction", id: "u1", state: "started" });
    t.run.take({ type: "compaction", id: "u1", state: "started" });
    t.run.take({ type: "compaction", id: "u1", state: "completed" });
    // Claude's raw messages and its refreshed usage come between: they are not the agent's next work.
    t.run.take({ type: "raw", message: { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 180000 } } });
    t.run.take({ type: "compaction", id: "u1", tokensBefore: 180000, tokensAfter: 31000, ms: 42000 });
    t.run.take({ type: "usage", usage: { used: 31000, size: 200000 } });
    assert.deepEqual(t.of("compaction"), [], "held until the work goes on");
    t.run.take({ type: "text", text: "Going on.", messageId: "m2" });
    t.run.take({ type: "compaction", id: "u1", state: "completed" });
    assert.deepEqual(t.of("compacting"), [{ type: "compacting", round: 1, own: true, by: "Claude Code" }]);
    assert.deepEqual(t.of("compaction"), [{ type: "compaction", round: 1, own: true, by: "Claude Code", tokensBefore: 180000, tokensAfter: 31000, ms: 42000 }], "one mark");
    // The agent's count after it is the meter's figure at once (HarnessV3-ACP AC3-5).
    assert.deepEqual(t.of("held"), [{ type: "held", round: 1, tokens: 31000, window: 200000, exact: true }]);
    assert.deepEqual(t.seq(), ["round-start:1", "compacting:1", "held:1", "compaction:1", "round-text:1", "round-start:2"]);
  });

  // (fails before: yes — HarnessV4_Tasks U3-5: the run said `compacting` once and nothing more until the mark)
  test("while it compacts, the run says how much of its summary is written; never before its start or after its end", () => {
    const t = make("Claude Code");
    t.run.take({ type: "text", text: "Reading.", messageId: "m1" });
    t.run.take({ type: "compaction", id: "u9", written: 200 });
    assert.deepEqual(t.of("compacting"), [], "a compaction that has not started");
    t.run.take({ type: "compaction", id: "u1", state: "started" });
    t.run.take({ type: "compaction", id: "u1", written: 240 });
    t.run.take({ type: "compaction", id: "u1", written: 770 });
    t.run.take({ type: "compaction", id: "u1", state: "completed" });
    t.run.take({ type: "compaction", id: "u1", written: 990 });
    assert.deepEqual(t.of("compacting"), [
      { type: "compacting", round: 1, own: true, by: "Claude Code" },
      { type: "compacting", round: 1, own: true, by: "Claude Code", chars: 240 },
      { type: "compacting", round: 1, own: true, by: "Claude Code", chars: 770 },
    ]);
    t.run.take({ type: "text", text: "Going on.", messageId: "m2" });
    assert.deepEqual(t.of("compaction"), [{ type: "compaction", round: 1, own: true, by: "Claude Code" }], "its mark is as before: no figure of the growth on it");
    // The page: the newest word of it is the live row's.
    const a = alignEvents([{ type: "round-start", round: 1 }, ...t.of("compacting")]);
    assert.equal(a.byRound.get(1)?.compacting?.chars, 770);
  });

  test("its mark carries the summary the agent kept (AC5-7), all of any it writes", () => {
    const t = make("Claude Code");
    t.run.take({ type: "compaction", id: "c1", state: "started" });
    t.run.take({ type: "compaction", id: "c1", state: "completed", summary: "Kept: the reading so far." });
    t.run.take({ type: "text", text: "Going on.", messageId: "m2" });
    assert.deepEqual(t.of("compaction"), [{ type: "compaction", round: 0, own: true, by: "Claude Code", summary: "Kept: the reading so far." }]);
    const long = make("Claude Code");
    long.run.take({ type: "compaction", id: "c1", state: "completed", summary: "x".repeat(50_000) });
    long.run.take({ type: "text", text: "Going on.", messageId: "m2" });
    const [mark] = long.of("compaction");
    assert.deepEqual([mark.summary.length, mark.summary.endsWith("…")], [40_000, true]);
  });

  // (fails before: no — a guard the mutation pass asked for: no compaction sent word of itself while it ran)
  test("word of a compaction while it runs ends nothing: a turn stopped midway marks none", async () => {
    const t = make("Claude Code");
    t.run.take({ type: "compaction", id: "u1", state: "started" });
    t.run.take({ type: "compaction", id: "u1", tokensBefore: 180000 });
    await t.run.close({ status: "stopped" });
    assert.deepEqual([t.of("compacting").length, t.of("compaction")], [1, []]);
  });

  test("before the first model call it is round 0; a failed one says why; the turn's end marks the one held; a sub-agent's is its own", async () => {
    const t = make("Codex");
    t.run.take({ type: "compaction", id: "c0", state: "started" });
    t.run.take({ type: "compaction", id: "c0", state: "completed" });
    t.run.take({ type: "compaction", id: "s1", state: "completed", subagent: "S1" });
    t.run.take({ type: "text", text: "Hello." });
    t.run.take({ type: "compaction", id: "c1", state: "failed", manual: true, error: "Not enough messages to compact." });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.of("compacting"), [{ type: "compacting", round: 0, own: true, by: "Codex" }]);
    assert.deepEqual(t.of("compaction"), [
      { type: "compaction", round: 0, own: true, by: "Codex" },
      { type: "compaction", round: 1, own: true, by: "Codex", manual: true, result: "failed", error: "Not enough messages to compact." },
    ]);
    const unnamed = make();
    unnamed.run.take({ type: "compaction", id: "c0", state: "completed" });
    await unnamed.run.close({ status: "done" });
    assert.deepEqual(unnamed.of("compaction"), [{ type: "compaction", round: 0, own: true }]);
  });
});

describe("the agent's own compaction, drawn (AC2-1)", () => {
  test("the transcript: live while it runs, then the mark where it happened — before the first round's words at round 0", () => {
    const started = [{ type: "compacting", round: 0, own: true, by: "Codex" }];
    let a = alignEvents(started);
    assert.equal(a.byRound.get(0)?.compacting?.by, "Codex");
    assert.deepEqual([roundNotes(a.byRound.get(0), true), roundNotes(a.byRound.get(0), false)], [true, false], "live, it ends its box");
    a = alignEvents([...started, { type: "compaction", round: 0, own: true, by: "Codex" }, { type: "round-start", round: 1, blocksBefore: 0 }]);
    assert.deepEqual([a.byRound.get(0)?.compacting, a.byRound.get(0)?.compactions.length], [null, 1]);
    // The loop's fold that came back with nothing leaves no mark: its live row ends with the next round.
    a = alignEvents([{ type: "round-start", round: 1 }, { type: "compacting", round: 1 }, { type: "round-start", round: 2 }]);
    assert.equal(a.byRound.get(1)?.compacting, null);
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /if \(live && cell\.compacting\) rows\.push\(h\("div", \{ class: "tool-note compaction-note" \}, h\("span", \{ class: "work-state gradient" \}, roundCompactingWords\(cell\.compacting\)\)\)\)/);
    // The mark with the summary the agent kept opens on it (AC5-7); any other is its words.
    assert.match(timeline, /kept\("compaction", cell\.compactions \|\| \[\], compactionNote\);/);
    assert.match(timeline, /if \(!k\.own \|\| !k\.summary\) return h\("div", \{ class: "tool-note compaction-note" \}, words\);/);
    assert.match(timeline, /h\("details", \{ class: "tool-note compaction-note compaction-kept" \},[\s\S]{0,200}?h\("div", \{ class: "compaction-kept-text" \}, String\(k\.summary\)\)\);/);
  });

  test("its words: who, on whose request, its figures and its time as the agent gave them, or why it failed", () => {
    assert.equal(roundCompactingWords({ own: true, by: "Codex" }), "⌁ Codex is compacting its own context…");
    // (fails before: yes — U3-5) the summary as it is written, in tokens, an estimate
    assert.equal(roundCompactingWords({ own: true, by: "Claude Code", chars: 4960 }), "⌁ Claude Code is compacting its own context… ≈1,240 tokens of its summary written");
    assert.equal(roundCompactingWords({ own: true, by: "Claude Code", chars: 0 }), "⌁ Claude Code is compacting its own context…");
    assert.equal(roundCompactingWords({}), "⌁ Compacting: the older rounds are being summarized into one…");
    assert.equal(roundCompactionWords({ own: true, by: "Codex" }), "⌁ Codex compacted its own context here: what came before is a summary in its session now");
    assert.equal(
      roundCompactionWords({ own: true, by: "Claude Code", manual: true, tokensBefore: 180000, tokensAfter: 31000, ms: 42000 }),
      "⌁ Claude Code compacted its own context here on your request: what came before is a summary in its session now · 180k → 31k · 42.0 s",
    );
    assert.equal(roundCompactionWords({ own: true, tokensBefore: 180000 }), "⌁ The agent compacted its own context here: what came before is a summary in its session now · at 180k");
    assert.equal(roundCompactionWords({ own: true, by: "Claude Code", result: "failed", error: "Not enough messages to compact." }), "⌁ Claude Code could not compact its context: Not enough messages to compact.");
  });

  test("the Run pane: at the first round's station before it, a fold in its figures; a failed one is none", () => {
    const view = stationsFrom([
      { type: "compacting", round: 0, own: true, by: "Codex" },
      { type: "compaction", round: 0, own: true, by: "Codex", tokensBefore: 180000, tokensAfter: 31000 },
      { type: "round-start", round: 1 },
      { type: "compaction", round: 1, own: true, by: "Codex", result: "failed", error: "boom" },
    ]);
    assert.deepEqual(view.rounds.map((/** @type {any} */ r) => r.n), [1], "no round 0");
    assert.deepEqual(view.rounds[0].bodies, [
      { kind: "folding", text: "Codex is compacting its own context…" },
      { kind: "compaction", text: "Codex compacted its own context (~180k → ~31k tok) — what came before is a summary in its session now." },
      { kind: "folding", text: "Codex could not compact its context: boom" },
    ]);
    assert.deepEqual([view.metrics.rounds, view.metrics.compactions], [1, 1]);
    assert.equal(compactionWords({ own: true, manual: true }), "The agent compacted its own context on request — what came before is a summary in its session now.");
  });

  test("the lead's count takes the agent's own compactions, not one that failed", () => {
    const aligned = alignEvents([
      { type: "compaction", round: 0, own: true, by: "Codex" },
      { type: "round-start", round: 1 },
      { type: "compaction", round: 1, own: true, by: "Codex", result: "failed" },
      { type: "compaction", round: 1, fromRound: 1, toRound: 1 },
      { type: "compaction", round: 1, manual: true, result: "little" },
    ]);
    assert.equal(compactionCount([{ aligned }]), 2);
  });

  test("an outside client's text: a line once it has compacted, or could not; none while it runs", () => {
    const r = new ActivityRenderer({ agentName: "Claude Code" });
    assert.equal(r.handle({ type: "compaction", id: "u1", state: "started" }), null);
    assert.equal(r.handle({ type: "compaction", id: "u1", tokensBefore: 180000 }), null);
    assert.equal(r.handle({ type: "compaction", id: "u1", state: "completed" }), "✓ Claude Code compacted its context\n");
    assert.equal(r.handle({ type: "compaction", id: "u2", state: "failed", error: "Not enough\nmessages." }), "✗ Claude Code could not compact its context: Not enough messages.\n");
    assert.equal(r.handle({ type: "compaction", id: "u3", state: "completed", subagent: "S1" }), null);
    assert.equal(new ActivityRenderer(/** @type {any} */ ({ icons: false })).handle({ type: "compaction", id: "u1", state: "completed" }), "ok: the agent compacted its context\n");
    assert.deepEqual(r.lines, [], "not a tool");
  });
});
