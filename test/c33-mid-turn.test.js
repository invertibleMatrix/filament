// @ts-check
// HarnessV4_Tasks C33 step 4, room in the whole chat in the middle of a running turn. Filament's own loop made room in
// a running turn by folding that turn's own steps; the earlier turns were out of its reach. A turn that began near its
// line on a long history therefore folded the work it was doing while the old history stayed whole, or stood down.
// Where the earlier turns are the bigger part, they give way first — by the session's own method, once a turn — and
// the loop swaps the start of its conversation for the session composed again. The loop is driven directly here, with
// a scripted model call and no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { trajectoryProblem } from "../src/app/sessions/shapes.js";
import { roundCompactionWords, roundCompactingWords } from "../src/ui/harness/lib/labels.js";

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = () => ({ blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } });
const text = (/** @type {any} */ m) => (typeof m?.content === "string" ? m.content : (m?.content || []).map((/** @type {any} */ b) => b?.text ?? (typeof b?.content === "string" ? b.content : "")).join("\n"));

// A long history: three earlier turns, each a big reply, then this turn's message.
const OLD = "old history ".repeat(2000);
const history = () => [
  { role: "user", content: [{ type: "text", text: "turn 1" }] },
  { role: "assistant", content: [{ type: "text", text: `ONE ${OLD}` }] },
  { role: "user", content: [{ type: "text", text: "turn 2" }] },
  { role: "assistant", content: [{ type: "text", text: `TWO ${OLD}` }] },
  { role: "user", content: [{ type: "text", text: "turn 3" }] },
  { role: "assistant", content: [{ type: "text", text: `THREE ${OLD}` }] },
  { role: "user", content: [{ type: "text", text: "this turn's message" }] },
];
/** The session composed again after its earlier turns gave way: a summary and its acknowledgment. */
const COMPOSED = [
  { role: "user", content: [{ type: "text", text: "[Filament compacted turns 1–3 into the summary below.]\nSUMMARY-OF-THE-EARLIER-TURNS" }] },
  { role: "assistant", content: [{ type: "text", text: "Understood." }] },
];

/**
 * One turn of the loop over the long history: `reads` tool rounds, then its closing words.
 * @param {{ usable: number, window?: number, earlier?: any, reads?: number, resume?: any, summarize?: any }} o
 */
async function run({ usable, window = 200_000, earlier = undefined, reads = 2, resume = null, summarize = null }) {
  /** @type {any[]} */
  const bodies = [];
  /** @type {any[]} */
  const events = [];
  let n = 0;
  let summaries = 0;
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    messages: history(),
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async (/** @type {any} */ c) => {
      bodies.push(structuredClone(c.body));
      return ++n <= reads ? reply([{ type: "text", text: `Reading ${n}.` }, toolUse(`r${n}`, "read", { path: `f${n}.txt` })]) : reply([{ type: "text", text: "Done." }]);
    },
    costOf: () => 0,
    runHand: async () => "the file's few words",
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e),
    previewChars: 0,
    sink: sink(),
    signal: null,
    resume,
    compact: {
      usable, window, target: Math.floor(usable / 2), source: "operator", fixed: 0, factor: null,
      summarize: summarize || (async () => { summaries++; return { text: "SUMMARY-OF-THIS-TURN'S-STEPS", by: "m" }; }),
      ...(earlier !== undefined ? { earlier } : {}),
    },
  }));
  return { out, bodies, events, summaries: () => summaries };
}
/** The compaction rows of a run, by kind. @param {any[]} events */
const marks = (events) => events.filter((e) => e.type === "compaction").map((e) => (e.earlier ? (e.result ? "earlier:none" : "earlier") : e.stoodDown ? "down" : e.toRound ? "fold" : "other"));

// (fails before: yes — the loop folded this turn's own steps, the smaller part, and stood down: the earlier turns
// stayed whole for the rest of the turn)
test("at the line with the earlier turns the bigger part: they give way first, the turn's message and its steps stay whole, and nothing of the turn is folded", async () => {
  let asked = 0;
  const { out, bodies, events, summaries } = await run({
    usable: 12_000,
    earlier: async () => { asked++; return { history: COMPOSED, fromTurn: 1, toTurn: 3, method: "summary", note: "compaction: turns 1–3 summarized at the compaction line — ≈18,000 → ≈900 tokens" }; },
  });
  assert.equal(out.status, "done");
  assert.equal(asked, 1, "once a turn");
  assert.deepEqual(marks(events), ["earlier"]);
  assert.equal(summaries(), 0, "no fold of the turn's own steps");
  // The first request went out before the line was weighed? No: the line is weighed before every round, the first too.
  const first = bodies[0].messages;
  assert.deepEqual(first.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.match(text(first[0]), /SUMMARY-OF-THE-EARLIER-TURNS/);
  assert.equal(text(first[2]), "this turn's message", "the turn's own message, as it was sent");
  assert.ok(!JSON.stringify(first).includes("old history"), "the earlier turns' words are gone from the request");
  // Every later round carries the same start and the turn's steps whole.
  const last = bodies.at(-1).messages;
  assert.match(text(last[0]), /SUMMARY-OF-THE-EARLIER-TURNS/);
  assert.deepEqual(last.slice(3).map((/** @type {any} */ m) => m.role), ["assistant", "user", "assistant", "user"]);
  assert.ok(JSON.stringify(last).includes("the file's few words"));
  // What the archive takes as the turn's work is the turn's own, from after its message.
  assert.deepEqual(out.work.map((/** @type {any} */ m) => m.role), ["assistant", "user", "assistant", "user"]);
  assert.equal(trajectoryProblem({ turnId: 4, n: 4, user: { role: "user", content: "this turn's message" }, work: out.work, final: { role: "assistant", content: out.final }, meta: {} }), null);
  const ev = events.find((e) => e.type === "compaction");
  assert.deepEqual([ev.fromTurn, ev.toTurn, ev.method], [1, 3, "summary"]);
  assert.ok(ev.tokensBefore > ev.tokensAfter && ev.tokensAfter < 12_000, JSON.stringify(ev));
  assert.ok(events.some((e) => e.type === "compacting" && e.earlier), "said while it runs");
  assert.match(out.notes.join("\n"), /agent: turns 1–3 summarized at the compaction line — ≈18,000 → ≈900 tokens — in the middle of this turn, whose own steps stay whole/);
});

// A sub-agent's hand summarizes what gives way itself, and keeps the conversation it sends on to its next follow-up.
// (fails before: yes — the hand was given nothing, and the turn's result did not say where its conversation starts now)
test("the hand is given the messages ahead of the turn's own and the door that asked; the result says where the conversation starts now", async () => {
  /** @type {any} */
  let asked = null;
  const { out } = await run({
    usable: 12_000,
    earlier: async (/** @type {any} */ o) => { asked = o; return { history: COMPOSED, fromTurn: 1, toTurn: 3, method: "summary", note: "compaction: turns 1–3 summarized at the compaction line" }; },
  });
  assert.equal(out.status, "done");
  assert.deepEqual(asked.ahead, history().slice(0, -1), "every message ahead of the turn's own");
  assert.equal(asked.door, "line");
  assert.ok(asked.signal === null || asked.signal instanceof AbortSignal);
  assert.deepEqual(out.history, COMPOSED);
  // Without a hand, nothing gave way and the result names no start.
  const { out: plain } = await run({ usable: 12_000, reads: 5 });
  assert.equal(plain.history, undefined);
});

test("a stop while the hand writes its summary: the hand hears it, the turn ends stopped, nothing gave way and no call went out", async () => {
  const stop = new AbortController();
  /** @type {any[]} */
  let box = [];
  const mailbox = { stopSignal: stop.signal, read: (/** @type {any} */ f) => { const got = box.filter(f || (() => true)); box = box.filter((m) => !got.includes(m)); return got; } };
  /** @type {any[]} */
  const bodies = [];
  /** @type {any} */
  let heard = null;
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m", messages: history(), system: "s", tools: toolSetFor({ delegateRead: false }), modeNow: () => "edit", root: tmpdir(), readerModel: "", maxTokens: 100,
    call: async (/** @type {any} */ c) => { bodies.push(c.body); return reply([{ type: "text", text: "Done." }]); },
    costOf: () => 0, runHand: async () => "few words", delegateRead: null, mailbox, permissions: null, tree: null,
    onEvent: () => {}, previewChars: 0, sink: sink(), signal: null, resume: null,
    compact: {
      usable: 12_000, window: 200_000, target: 6_000, source: "operator", fixed: 0, factor: null, summarize: async () => ({ text: "S", by: "m" }),
      earlier: async (/** @type {any} */ o) => {
        box.push({ kind: "stop", text: "", from: "harness" });
        stop.abort();
        heard = o.signal?.aborted;
        return { history: COMPOSED, fromTurn: 1, toTurn: 3, method: "summary", note: "compaction: turns 1–3 summarized" };
      },
    },
  }));
  assert.equal(heard, true, "the hand's signal is the turn's cut");
  assert.equal(out.status, "stopped");
  assert.equal(bodies.length, 0);
  assert.equal(out.history, undefined);
});

test("the steps the bigger part: they fold as ever, and the earlier turns are not asked", async () => {
  let asked = 0;
  const big = "a long note ".repeat(4000);
  const bodies = [];
  const events = [];
  let n = 0;
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m", messages: [{ role: "user", content: "a short chat" }, { role: "assistant", content: "yes" }, { role: "user", content: "read the notes" }], system: "s",
    tools: toolSetFor({ delegateRead: false }), modeNow: () => "edit", root: tmpdir(), readerModel: "", maxTokens: 100,
    call: async (/** @type {any} */ c) => { bodies.push(c.body); return ++n <= 5 ? reply([toolUse(`r${n}`, "read", { path: `f${n}.txt` })]) : reply([{ type: "text", text: "Done." }]); },
    costOf: () => 0, runHand: async () => big, delegateRead: null, mailbox: { read: () => [] }, permissions: null, tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e), previewChars: 0, sink: sink(), signal: null, resume: null,
    compact: { usable: 30_000, window: 200_000, target: 12_000, source: "operator", fixed: 0, factor: null, summarize: async () => ({ text: "SUMMARY-OF-THE-STEPS", by: "m" }), earlier: async () => { asked++; return { error: "never asked" }; } },
  }));
  assert.equal(out.status, "done");
  assert.equal(asked, 0);
  assert.ok(marks(events).includes("fold"), JSON.stringify(marks(events)));
  assert.ok(!marks(events).some((m) => m.startsWith("earlier")));
});

test("the earlier turns cannot give way (all under a summary already, or the method failed): said, and the turn's own steps fold instead, as before", async () => {
  const { out, events, summaries } = await run({ usable: 12_000, reads: 5, earlier: async () => ({ error: "summary: every completed turn is already under the summary of turns 1–3" }) });
  assert.equal(out.status, "done");
  assert.equal(marks(events)[0], "earlier:none");
  assert.ok(marks(events).includes("fold"), `the steps folded after it: ${JSON.stringify(marks(events))}`);
  assert.ok(summaries() >= 1);
  assert.equal(marks(events).filter((m) => m.startsWith("earlier")).length, 1, "asked once, not again every round");
  assert.match(out.notes.join("\n"), /the earlier turns are the bigger part of it, but they could not give way \(summary: every completed turn is already under the summary of turns 1–3\)/);
});

test("a hand that throws is a way that failed, not a turn that failed", async () => {
  const { out, events } = await run({ usable: 12_000, earlier: async () => { throw new Error("the archive is closed"); } });
  assert.equal(out.status, "done");
  assert.equal(events.find((e) => e.type === "compaction" && e.earlier)?.error, "the archive is closed");
});

test("with no hand (a sub-agent's launch, a request at the front door) the loop is as it was: the steps fold, the line stands down", async () => {
  const { out, events } = await run({ usable: 12_000, reads: 5 });
  assert.equal(out.status, "done");
  assert.ok(!marks(events).some((m) => m.startsWith("earlier")));
  assert.ok(marks(events).includes("down"), JSON.stringify(marks(events)));
});

test("a turn that pauses after the earlier turns gave way remembers its new start", async () => {
  let n = 0;
  /** @type {any[]} */
  const events = [];
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m", messages: history(), system: "s", tools: toolSetFor({ delegateRead: false }), modeNow: () => "edit", root: tmpdir(), readerModel: "", maxTokens: 100,
    call: async () => (++n === 1 ? reply([toolUse("r1", "read", { path: "a.txt" })]) : reply([toolUse("q1", "ask", { question: "Which one?", options: ["a", "b"] })])),
    costOf: () => 0, runHand: async () => "few words", delegateRead: null, mailbox: { read: () => [] }, permissions: null, tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e), previewChars: 0, sink: sink(), signal: null, resume: null,
    compact: { usable: 12_000, window: 200_000, target: 6_000, source: "operator", fixed: 0, factor: null, summarize: async () => ({ text: "S", by: "m" }), earlier: async () => ({ history: COMPOSED, fromTurn: 1, toTurn: 3, method: "fold", note: "compaction: turns 1–3 folded at the compaction line" }) },
  }));
  assert.equal(out.status, "paused", JSON.stringify(out.error || out.notes));
  // Two messages of history and the turn's own message: the turn's work starts at the fourth.
  const pause = /** @type {any} */ (out.pause);
  assert.equal(pause.baseLen, 3);
  assert.equal(text(pause.convo[2]), "this turn's message");
  assert.ok(pause.workFrom >= 3);
});

test("the page's words for it", () => {
  assert.equal(roundCompactingWords({ earlier: true }), "⌁ Making room in the whole chat: the earlier turns give way first, this turn's own steps stay whole…");
  assert.equal(
    roundCompactionWords({ earlier: true, fromTurn: 1, toTurn: 3, method: "summary", tokensBefore: 180_000, tokensAfter: 40_000 }),
    "⌁ Room made in the whole chat: turns 1–3 summarized, this turn's own steps kept whole · 180k → 40k",
  );
  assert.match(roundCompactionWords({ earlier: true, fromTurn: 2, toTurn: 2, method: "fold" }), /^⌁ Room made in the whole chat: turn 2 folded, /);
  assert.equal(
    roundCompactionWords({ earlier: true, result: "none", error: "no model to summarize with" }),
    "⌁ The earlier turns could not give way (no model to summarize with): this turn's own steps are summarized instead, where they can be",
  );
  // A sub-agent's thread: what gave way is its earlier exchanges, to its own summary.
  // (fails before: yes — its thread said "Room made in the whole chat: turns 1–2 summarized")
  assert.equal(roundCompactingWords({ earlier: true, exchanges: true }), "⌁ Making room in its conversation: its earlier exchanges give way first, summarized by itself; this exchange's own steps stay whole…");
  assert.equal(
    roundCompactionWords({ earlier: true, exchanges: true, fromTurn: 1, toTurn: 2, method: "summary", tokensBefore: 175_000, tokensAfter: 21_000 }),
    "⌁ Room made in its conversation: its 2 earlier exchanges summarized by itself, this exchange's own steps kept whole · 175k → 21k",
  );
  assert.match(roundCompactionWords({ earlier: true, exchanges: true, fromTurn: 1, toTurn: 1, method: "summary" }), /^⌁ Room made in its conversation: its earlier exchange summarized by itself, /);
  assert.equal(
    roundCompactionWords({ earlier: true, exchanges: true, result: "none", error: "m-1 wrote no summary of them" }),
    "⌁ Its earlier exchanges could not give way (m-1 wrote no summary of them): this exchange's own steps are summarized instead, where they can be",
  );
});
