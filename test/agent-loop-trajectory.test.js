// @ts-check
// HarnessV2 D7: whatever way a turn ends, what the loop hands the archive — `work` then `final` — must be a valid
// conversation: roles alternating from the developer's message, every tool_use answered, the final the reply that
// closed the turn. The loop is driven directly here with a scripted model call and no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { trajectoryProblem } from "../src/app/sessions/shapes.js";
import { roundsLead, ROUNDS_LINE } from "../src/app/sessions/compaction.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
// The LoopSink contract in full: `count` feeds the round-start's blocksBefore for card placement.
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };

/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const args = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    // The offered set is the loop's contract (a tool it did not offer is answered, never run), so the scripted
    // model's calls name tools from the real set — mode-invariant since the gate took over.
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => reply([{ type: "text", text: "Done." }]),
    costOf: () => 0,
    runHand: async (name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
    ...over,
  });

/** The turn as the archive would hold it, checked as a conversation. */
const archived = (out, user = { role: "user", content: "go" }) =>
  trajectoryProblem({ turnId: 1, n: 1, user, work: out.work, final: { role: "assistant", content: out.final }, meta: {} });

test("done: the rounds are the work, the closing reply alone is the final", async () => {
  let n = 0;
  const out = await runAgentTurn(args({
    call: async () => (++n === 1 ? reply([{ type: "text", text: "Reading." }, toolUse("r1", "read", { path: "a.txt" })]) : reply([{ type: "text", text: "Done." }])),
  }));
  assert.equal(out.status, "done");
  assert.deepEqual(out.work.map((m) => m.role), ["assistant", "user"]);
  assert.deepEqual(out.work[0].content.map((b) => b.type), ["text", "tool_use"]);
  assert.equal(out.work[1].content[0].tool_use_id, "r1");
  assert.deepEqual(out.final, [{ type: "text", text: "Done." }], "the first round's words are in the work, not repeated in the final");
  assert.equal(archived(out), null);
});

test("a stop heard while the model decided answers the reply's calls with 'Not run' so no tool_use is left open", async () => {
  let reads = 0;
  const out = await runAgentTurn(args({
    call: async () => reply([toolUse("r1", "read", { path: "a.txt" }), toolUse("r2", "read", { path: "b.txt" })]),
    mailbox: { read: () => (++reads === 1 ? [{ kind: "stop", text: "enough" }] : []) },
  }));
  assert.equal(out.status, "stopped");
  assert.deepEqual(out.work.map((m) => m.role), ["assistant", "user"]);
  assert.deepEqual(out.work[1].content.map((b) => [b.tool_use_id, b.is_error]), [["r1", true], ["r2", true]]);
  assert.match(out.work[1].content[0].content, /Not run: the developer stopped the turn/);
  assert.equal(out.final.length, 1);
  assert.match(out.final[0].text, /the developer stopped this turn/);
  assert.equal(archived(out), null);
});

test("a resumed turn stopped at the gate: the answered call's result and 'Not run' for the rest close the parked reply", async () => {
  const parked = { role: "assistant", content: [toolUse("c1", "bash", { command: "echo hi" }), toolUse("r2", "read", { path: "a.txt" })] };
  let reads = 0;
  const out = await runAgentTurn(args({
    messages: [{ role: "user", content: "go" }, parked, { role: "user", content: "yes" }],
    mailbox: { read: () => (++reads === 1 ? [{ kind: "stop", text: "enough" }] : []) },
    resume: {
      answer: "yes",
      allow: true,
      paused: { kind: "permission", convo: [{ role: "user", content: "go" }, parked], results: [], pending: parked.content[0], remaining: [parked.content[1]], round: 1, plan: null, root: tmpdir(), readerModel: "", heard: [], baseLen: 1, workFrom: 1 },
    },
  }));
  assert.equal(out.status, "stopped");
  assert.deepEqual(out.work.map((m) => m.role), ["assistant", "user"], "the parked reply, then one message answering both of its calls");
  assert.equal(out.work[0], parked);
  const results = out.work[1].content;
  assert.deepEqual(results.map((b) => b.tool_use_id), ["c1", "r2"]);
  assert.equal(results[0].content, "bash ran", "the developer's yes ran the pending command");
  assert.match(results[1].content, /Not run: the developer stopped the turn/);
  assert.equal(archived(out, { role: "user", content: "yes" }), null);
});

test("a pause: the parked reply is the last work message and the question is the final (the caller parks the reply with the pause)", async () => {
  const out = await runAgentTurn(args({
    // A command that does more than read: in Edit mode one that only reads runs without asking (HarnessV3-Launch LD-D11).
    call: async () => reply([{ type: "text", text: "I need a command." }, toolUse("c1", "bash", { command: "npm test" })]),
  }));
  assert.equal(out.status, "paused");
  assert.ok(out.pause);
  assert.equal(out.work.length, 1);
  assert.equal(out.work[0].role, "assistant");
  assert.match(out.final[0].text, /May I run this command\? `npm test`/);
  // agent/turn.js drops the dangling reply from the archived work (it is parked with the pause), leaving user + final.
  assert.equal(trajectoryProblem({ turnId: 1, n: 1, user: { role: "user", content: "go" }, work: [], final: { role: "assistant", content: out.final }, meta: {} }), null);
});

// (fails before: yes — the fold at the line waited for 2,000 tokens of growth: a turn whose folds landed just under its
// line folded a round every round. The live drive of 2026-10-12, where the session's line and its target were the same)
test("the fold at the line waits for the turn to grow by half the line where the line and the target leave less: a line set at the target folds twice in eight rounds, not every round", async () => {
  const LINE = 20000;
  /** @type {any[]} */ const sized = [];
  // What a character of a message and of a tool's result weighs on the loop's own measure: one turn that only reads.
  const base = { usable: 1e9, target: 0, window: 1e9, source: /** @type {const} */ ("operator"), fixed: 0, summarize: async () => ({ text: "S", by: "w" }) };
  await runAgentTurn(args({ messages: [{ role: "user", content: "x".repeat(40000) }], compact: base, onEvent: (e) => sized.push(e) }));
  const perChar = Number(sized.find((e) => e.type === "round-start")?.context) / 40000;
  assert.ok(perChar > 0, "the loop measured its start");
  const chars = (/** @type {number} */ tokens) => Math.round(tokens / perChar);
  /** @type {any[]} */ const bodies = [];
  /** @type {any[]} */ const events = [];
  // The turn begins at seven tenths of the line on words it cannot fold, and each of eight reads adds some 3,000 tokens.
  const out = await runAgentTurn(args({
    messages: [{ role: "user", content: "x".repeat(chars(LINE * 0.7)) }],
    call: reading({ to: 8 }, bodies),
    runHand: async () => "z".repeat(chars(3000)),
    compact: { ...base, usable: LINE, target: LINE, window: LINE * 10 },
    onEvent: (e) => events.push(e),
  }));
  assert.equal(out.status, "done");
  const folds = events.filter((e) => e.type === "compaction" && e.toRound);
  assert.equal(folds.length, 2, JSON.stringify(folds.map((f) => [f.fromRound, f.toRound, f.tokensBefore, f.tokensAfter])));
  assert.ok(folds[0].tokensAfter < LINE, "the first landed under the line: nothing stood down on it");
  assert.ok(folds[1].tokensBefore >= folds[0].tokensAfter + LINE / 2, `the second waited for half the line of growth: ${folds[0].tokensAfter} → ${folds[1].tokensBefore}`);
  assert.equal(archived(out, { role: "user", content: "x".repeat(chars(LINE * 0.7)) }), null);
});

// The loop's fold mid-turn: the head it leaves, the rounds it counts and their numbers (the bug report's L1, L2, L6).
const TOO_LONG = { ok: false, status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 99999 tokens > 5000 maximum" } }, id: null };
/**
 * A model whose call n is round `from + n - 1`, reading f<round>.txt up to round `to` and closing after; the call
 * `refuse` names is refused for size, and the round it was is asked again. Every request lands in `bodies`.
 * @param {{ from?: number, to: number, refuse?: number }} o @param {any[]} bodies
 */
const reading = ({ from = 1, to, refuse = 0 }, bodies) => async (/** @type {any} */ { body }) => {
  bodies.push(structuredClone(body));
  const n = bodies.length;
  if (n === refuse) return TOO_LONG;
  const k = from + (refuse && n > refuse ? n - 2 : n - 1);
  return k <= to ? reply([toolUse(`r${k}`, "read", { path: `f${k}.txt` })]) : reply([{ type: "text", text: "Done." }]);
};
/** A mailbox that hands the loop a Compact once the model has answered each call `at` names. @param {number[]} at @param {any[]} bodies */
const compacting = (at, bodies) => {
  const given = new Set();
  return {
    read: (/** @type {any} */ only) => {
      if (only || !at.includes(bodies.length) || given.has(bodies.length)) return [];
      given.add(bodies.length);
      return [{ kind: "compact", text: "" }];
    },
  };
};
/** The fold's writer: what it was asked lands in `asks`, and its summary is numbered by the ask. @param {any[]} asks */
const writer = (asks) => ({
  usable: 0,
  target: 0,
  window: 0,
  source: /** @type {const} */ ("operator"),
  fixed: 0,
  summarize: async (/** @type {string} */ transcript, /** @type {any} */ o) => {
    asks.push({ transcript, rounds: [o.fromRound, o.toRound] });
    return { text: `SUMMARY-${asks.length}`, by: "w" };
  },
});
/** The rounds each fold said it took. @param {any[]} events */
const foldedRounds = (events) => events.filter((e) => e.type === "compaction" && e.fromRound != null).map((e) => [e.fromRound, e.toRound]);
/** The calls a request's results answer. @param {any} body */
const answered = (body) => body.messages.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);

// (fails before: yes — the second fold took the first one's summary and its acknowledgment for a round: it folded them
// alone, said it took round 3, and kept rounds 3–5 whole; and the turn's work went person, summary, acknowledgment,
// reply: two user messages, then two replies, so the archive could not send the turn again)
test("a fold counts the rounds after an earlier fold's head, never the head, and the turn's work alternates as the archive sends it again", async () => {
  /** @type {any[]} */ const bodies = [];
  /** @type {any[]} */ const asks = [];
  /** @type {any[]} */ const events = [];
  const out = await runAgentTurn(args({ call: reading({ to: 6 }, bodies), mailbox: compacting([3, 5], bodies), compact: writer(asks), onEvent: (e) => events.push(e) }));
  assert.equal(out.status, "done");
  assert.deepEqual(foldedRounds(events), [[1, 2], [3, 4]], "a Compact at round 4 keeps round 3, one at round 6 keeps round 5");
  assert.equal(asks[1].transcript, 'Summary of earlier rounds:\nSUMMARY-1\n## Round 3\nTool call read: {"path":"f3.txt"}\nResult: read ran\n## Round 4\nTool call read: {"path":"f4.txt"}\nResult: read ran');
  assert.deepEqual(bodies[5].messages.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.deepEqual(answered(bodies[5]), ["r5"], "round 6 is sent with round 5 whole and no other");
  assert.deepEqual(out.work.slice(0, 2).map((m) => [m.role, m.content[0].text]), [["assistant", ROUNDS_LINE], ["user", roundsLead(1, 4, "SUMMARY-2")]], "one summary stands for rounds 1–4");
  assert.equal(archived(out), null);
});

// (fails before: yes — after a fold the overflow recovery folded the summary and its acknowledgment alone, called that
// compacted, and sent the request the provider had refused again, rounds 3–5 whole)
test("the overflow recovery after a fold folds whole rounds, the newest kept, before it sends again", async () => {
  /** @type {any[]} */ const bodies = [];
  /** @type {any[]} */ const asks = [];
  /** @type {any[]} */ const events = [];
  const out = await runAgentTurn(args({ call: reading({ to: 5, refuse: 6 }, bodies), mailbox: compacting([3], bodies), compact: writer(asks), onEvent: (e) => events.push(e) }));
  assert.equal(out.status, "done");
  assert.deepEqual(answered(bodies[5]), ["r3", "r4", "r5"], "round 6 as the provider refused it");
  assert.deepEqual(foldedRounds(events), [[1, 2], [3, 4]]);
  assert.deepEqual(answered(bodies[6]), ["r5"], "and as it went again");
  assert.equal(archived(out), null);
});

// (fails before: yes — the fold's rounds were read off the loop's counter, which at the overflow door had the refused
// round already: a fold of round 1 said rounds 1–2)
test("a fold at the overflow door names the rounds it took, not the one refused", async () => {
  /** @type {any[]} */ const bodies = [];
  /** @type {any[]} */ const events = [];
  const out = await runAgentTurn(args({ call: reading({ to: 4, refuse: 5 }, bodies), compact: writer([]), onEvent: (e) => events.push(e) }));
  assert.equal(out.status, "done");
  assert.deepEqual(foldedRounds(events), [[1, 1]], "four rounds, three kept: round 1 alone");
  assert.equal(bodies[5].messages[2].content[0].text, roundsLead(1, 1, "SUMMARY-1"));
});

// (fails before: yes — a resumed turn's work was numbered from round 1: a fold of the reply that asked, round 3, said
// rounds 1–3)
test("a fold in a resumed turn's work names its rounds by their numbers in the turn", async () => {
  const go = { role: "user", content: "go" };
  const round = (/** @type {number} */ k) => [{ role: "assistant", content: [toolUse(`r${k}`, "read", { path: `f${k}.txt` })] }, { role: "user", content: [{ type: "tool_result", tool_use_id: `r${k}`, content: "read ran" }] }];
  const parked = { role: "assistant", content: [toolUse("c3", "bash", { command: "npm test" })] };
  const convo = [go, ...round(1), ...round(2), parked];
  /** @type {any[]} */ const later = [];
  /** @type {any[]} */ const asks = [];
  /** @type {any[]} */ const events = [];
  const resumed = await runAgentTurn(args({
    messages: [...convo, { role: "user", content: "yes" }],
    call: reading({ from: 4, to: 6 }, later),
    mailbox: compacting([3], later),
    compact: writer(asks),
    onEvent: (e) => events.push(e),
    resume: {
      answer: "yes",
      allow: true,
      paused: { kind: "permission", convo, results: [], pending: parked.content[0], remaining: [], round: 3, plan: null, root: tmpdir(), readerModel: "", heard: [], baseLen: 1, workFrom: 5 },
    },
  }));
  assert.equal(resumed.status, "done");
  assert.deepEqual(foldedRounds(events), [[3, 3]], "the reply that asked is round 3: rounds 4–6 kept");
  assert.match(asks[0].transcript, /^## Round 3\nTool call bash: /);
  assert.deepEqual(resumed.work.slice(0, 2).map((m) => [m.role, m.content[0].text]), [["assistant", ROUNDS_LINE], ["user", roundsLead(3, 3, "SUMMARY-1")]]);
  assert.equal(archived(resumed, { role: "user", content: "yes" }), null);
});

// (fails before: yes — Filament had no moment for Claude's PreCompact: a fold told no hook, 10-27)
test("a fold tells its pre-compact hooks first, with what set it off — the person's Compact is manual — and none of them stops it", async () => {
  /** @type {any[]} */ const bodies = [];
  /** @type {any[]} */ const asks = [];
  /** @type {any[]} */ const events = [];
  /** @type {any[]} */ const told = [];
  const none = async () => [];
  const hooks = {
    pre: none, post: none, turnEnd: none, sessionStart: none, promptSubmit: none, subagentEnd: none, readBackBeforeDone: false,
    preCompact: async (/** @type {"manual" | "auto"} */ trigger) => {
      told.push({ trigger, summariesAsked: asks.length });
      return [{ on: /** @type {const} */ ("pre-compact"), tool: null, command: "backup.sh", verdict: /** @type {const} */ ("block"), note: "not now", args: null, ms: 1, exit: 2, timedOut: false }];
    },
  };
  const out = await runAgentTurn(args({ call: reading({ to: 4 }, bodies), mailbox: compacting([3], bodies), compact: writer(asks), hooks, onEvent: (e) => events.push(e) }));
  assert.equal(out.status, "done");
  assert.deepEqual(told, [{ trigger: "manual", summariesAsked: 0 }], "told once, before the summary was asked for");
  assert.equal(asks.length, 1, "the fold went on: a pre-compact hook blocks nothing");
  assert.deepEqual(events.filter((e) => e.type === "hook").map((e) => [e.on, e.command]), [["pre-compact", "backup.sh"]]);
  assert.ok(out.notes.some((n) => /^hook: pre-compact backup\.sh → block \(exit 2, 1 ms\) — not now$/.test(n)), out.notes.join("\n"));
});
