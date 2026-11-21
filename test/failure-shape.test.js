// @ts-check
// HarnessV3-FailurePoints §5.2 and §6 item 1 (2026-10-10): one shape for every failure, and a failed run keeps its
// work. In team_test a clock cut nine workers mid-call and each run kept nothing: the throw flew out of the loop, and
// the run was recorded with `convo: null` and 0 rounds, so the lead could only start the task over.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { failureLine, keptRounds, saidOf, NETWORK_WORDS } from "../src/core/failure.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { modelTurnsOf, failedLine, refusedLine, CUT_OFF_LINE, REFUSED_USER } from "../src/app/sessions/shapes.js";
import { UsageStore } from "../src/usage.js";

test("saidOf: a network code anywhere in an error's causes, in plain words; Filament's own time limit as such; else the message", () => {
  const fetchFailed = new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
  assert.deepEqual(saidOf(fetchFailed), { said: NETWORK_WORDS.UND_ERR_SOCKET, code: "UND_ERR_SOCKET" });
  assert.deepEqual(saidOf(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), { said: "the connection was reset", code: "ECONNRESET" });
  assert.deepEqual(saidOf(new DOMException("The operation was aborted due to timeout", "TimeoutError")), { said: "Filament's time limit on the call cut it", code: null });
  assert.deepEqual(saidOf(new Error("boom")), { said: "boom", code: null });
});

test("failureLine: what failed and where, its tries and time, its words with their code and status, what had streamed and what is kept", () => {
  /** @type {import("../src/core/failure.js").Failure} */
  const cut = { what: "round 2's model call", where: "glm-5.3-flash at zai", said: "the connection was reset", code: "ECONNRESET", status: null, tries: null, began: 0, at: 600_000, streamed: { thinking: 44_000, text: 0 }, kept: keptRounds(2), next: null };
  assert.equal(failureLine(cut), "round 2's model call to glm-5.3-flash at zai failed after 10 min: the connection was reset (ECONNRESET). It had streamed about 11,000 tokens of thinking. 1 finished round is kept.");
  // A quick failure says no time, a first round keeps nothing, and nothing streamed is not said.
  assert.equal(failureLine({ ...cut, what: "round 1's model call", said: "Overloaded", code: null, status: 529, tries: 10, at: 3_000, streamed: { thinking: 0, text: 0 }, kept: keptRounds(1) }), "round 1's model call to glm-5.3-flash at zai failed after 10 tries: Overloaded (HTTP 529).");
  // A status the words already say is not said twice; what happens next closes the line.
  assert.equal(failureLine({ ...cut, said: "HTTP 502", code: null, status: 502, began: null, streamed: null, kept: null, next: "retrying in 20 s" }), "round 2's model call to glm-5.3-flash at zai failed: HTTP 502. Retrying in 20 s.");
  assert.equal(keptRounds(4), "3 finished rounds are kept");
  // A code the words already say is not said twice.
  assert.equal(failureLine({ ...cut, said: "spawn EACCES", code: "EACCES", began: null, streamed: null, kept: null }), "round 2's model call to glm-5.3-flash at zai failed: spawn EACCES.");
});

const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }, id: null, upstream: "zai", retryAfter: null });
const readA = { type: "tool_use", id: "t1", name: "read", input: { path: "a.txt" } };
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const args = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => reply([{ type: "text", text: "Done." }]),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
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

// (fails before: yes — the throw flew out of the loop: the run kept no conversation and counted 0 rounds)
test("a round's call that throws fails the turn in one shape, keeping the rounds before it", async () => {
  let n = 0;
  const out = await runAgentTurn(args({
    call: async ({ onDelta }) => {
      if (++n === 1) return reply([readA]);
      onDelta?.({ kind: "thinking", text: "x".repeat(400) });
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
    },
  }));
  assert.equal(out.status, "failed");
  assert.equal(out.error, "round 2's model call to m failed: the connection was reset (ECONNRESET). It had streamed about 100 tokens of thinking. 1 finished round is kept.");
  assert.deepEqual(out.work.map((m) => m.role), ["assistant", "user"], "round 1's call and its result are the turn's work");
  assert.equal(out.work[1].content[0].tool_use_id, "t1");
  assert.deepEqual([out.failure?.what, out.failure?.code, out.failure?.streamed, out.totals.rounds], ["round 2's model call", "ECONNRESET", { thinking: 400, text: 0 }, 2]);
});

// (fails before: yes — any throw in the loop's own code lost the turn's work the same way)
test("a fault in Filament's own code fails the turn on what the loop holds, keeping its work", async () => {
  let n = 0;
  let priced = 0;
  const out = await runAgentTurn(args({
    call: async () => (++n === 1 ? reply([readA]) : reply([{ type: "text", text: "Done." }])),
    costOf: () => {
      if (++priced === 2) throw new Error("the price table is broken");
      return 0;
    },
  }));
  assert.equal(out.status, "failed");
  assert.equal(out.error, "Filament's agent loop failed: the price table is broken. 1 finished round is kept.");
  assert.deepEqual(out.work.map((m) => m.role), ["assistant", "user"], "round 1's work stands");
});

// (fails before: yes — a fault while a reply's calls were open left them unanswered in the work: the next turn's
// history would carry a call with no result, which a provider refuses)
test("a fault while the reply's calls are open answers each one: none ran", async () => {
  let n = 0;
  const out = await runAgentTurn(args({
    call: async () => (++n, reply([readA])),
    mailbox: {
      read: () => {
        if (n) throw new Error("the mailbox is broken");
        return [];
      },
    },
  }));
  assert.equal(out.error, "Filament's agent loop failed: the mailbox is broken.");
  assert.deepEqual(out.work.map((m) => m.role), ["assistant", "user"], "the reply and its answers");
  assert.deepEqual([out.work[1].content[0].type, out.work[1].content[0].tool_use_id], ["tool_result", "t1"]);
});

// (fails before: no — guards the mutation pass asked for: a model named by its upstream is not named twice)
test("a provider's error answer names the model and where it was served, once", async () => {
  const out = await runAgentTurn(args({
    model: "zai/glm-5.3",
    call: async () => ({ ok: false, status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "bad block" } }, id: null, upstream: "zai", retryAfter: null }),
  }));
  assert.match(String(out.error), /^round 1's model call to zai\/glm-5\.3 failed: /);
});

// (fails before: yes — a call cut mid-stream was recorded with no counts at all, so a stuck call and a working one
// read alike: the cut zai calls of team_test read 0 everywhere; §5.1 item 4)
test("a call's record that ends failed or cut keeps what had streamed; one that ends ok keeps its own counts", () => {
  const u = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 5 } });
  const cut = u.start({ format: "anthropic", model: "m", upstream: "u1" });
  u.firstByte(cut);
  u.progress(cut, { outChars: 4400, thinkChars: 4000 });
  u.finish(cut, { status: "aborted", error: "client disconnected" });
  assert.deepEqual([cut.thinkingChars, cut.textChars], [4000, 400]);
  const failed = u.start({ format: "anthropic", model: "m", upstream: "u1" });
  u.firstByte(failed);
  u.progress(failed, { outChars: 120 });
  u.finish(failed, { status: "error", error: "stream failure: terminated" });
  assert.deepEqual([failed.thinkingChars, failed.textChars], [0, 120]);
  const ok = u.start({ format: "anthropic", model: "m", upstream: "u1" });
  u.firstByte(ok);
  u.progress(ok, { outChars: 300, thinkChars: 100 });
  u.finish(ok, { status: "ok", httpStatus: 200 });
  assert.deepEqual([ok.thinkingChars, ok.textChars], [undefined, undefined], "an ok call's counts are its own reply's, as ever");
});

const turn = (/** @type {number} */ n, /** @type {any} */ over = {}) => ({ n, startedAt: 30_000 + n, user: { role: "user", content: `turn ${n}` }, work: [], final: { role: "assistant", content: `reply ${n}` }, meta: {}, ...over });
const work = [{ role: "assistant", content: [readA] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "a" }] }];

// (fails before: yes — a turn that failed in this Filament was left out of the history whatever it had done)
test("the history: a turn that failed after doing work rides with its work, what it said and why it failed as its reply; one that did nothing drops out", () => {
  const failed = { at: 40_000, cause: "round 2's model call to m failed: the connection was reset (ECONNRESET). 1 finished round is kept.", text: "Reading a.txt first." };
  const got = modelTurnsOf([turn(1), turn(2, { final: null, work, meta: { failed } }), turn(3, { final: null, meta: { failed } }), turn(4)], 20_000);
  assert.deepEqual(got.map((t) => t.n), [1, 2, 4], "the failed turn with work rides; the one with none drops out");
  assert.deepEqual(got[1].final, { role: "assistant", content: failedLine(failed) });
  assert.equal(failedLine(failed), "Reading a.txt first.\n\n[this turn failed: round 2's model call to m failed: the connection was reset (ECONNRESET). 1 finished round is kept.]");
  assert.deepEqual(got[1].work, work, "its work as it ran");
  // Begun before this Filament started, it failed rather than being cut off: its own words, not the cut-off line.
  const [before] = modelTurnsOf([turn(5, { startedAt: 1_000, final: null, work, meta: { failed } })], 20_000);
  assert.notEqual(before.final.content, CUT_OFF_LINE);
  assert.equal(before.meta.cutOff, undefined);
});

// (fails before: yes — a turn the model's provider refused rode whole in every later history: a fresh agent session
// started from it was refused again, and so was every message after)
test("the history: a refused turn is left out — one that wrote files stands as Filament's line naming them, one that did nothing drops out", () => {
  const refused = { facts: { stopReason: "refusal" } };
  const edits = [
    { role: "assistant", content: [readA, { type: "tool_use", id: "e1", name: "Edit", input: { file_path: "src/a.js", old_string: "a", new_string: "b" } }, { type: "tool_use", id: "e2", name: "Write", input: { file_path: "notes.md", content: "x" } }, { type: "tool_use", id: "e3", name: "Edit", input: { file_path: "src/b.js", old_string: "a", new_string: "b" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "a" }, { type: "tool_result", tool_use_id: "e1", content: "ok" }, { type: "tool_result", tool_use_id: "e2", content: "ok" }, { type: "tool_result", tool_use_id: "e3", content: "no match", is_error: true }] },
  ];
  const got = modelTurnsOf([turn(1), turn(2, { work: edits, summary: "asked: the refused words", meta: refused }), turn(3, { meta: refused }), turn(4, { work, meta: refused }), turn(5)], 20_000);
  assert.deepEqual(got.map((t) => t.n), [1, 2, 4, 5], "the refused turn that did no work drops out");
  assert.deepEqual([got[1].user, got[1].work, got[1].final, got[1].summary, got[1].meta.refused], [{ role: "user", content: REFUSED_USER }, [], { role: "assistant", content: refusedLine(edits) }, null, true], "its words, its work and its digest are left out");
  assert.equal(refusedLine(edits), "[The model's provider refused this turn, so Filament leaves it out of the history. Before it was refused it wrote to src/a.js and notes.md: those files may hold its unfinished changes, so check them (git status, git diff) before you redo any of it.]");
  const oneAndRan = [{ role: "assistant", content: [edits[0].content[1], { type: "tool_use", id: "b1", name: "Bash", input: { command: "npm test" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "e1", content: "ok" }, { type: "tool_result", tool_use_id: "b1", content: "ok" }] }];
  assert.equal(refusedLine(oneAndRan), "[The model's provider refused this turn, so Filament leaves it out of the history. Before it was refused it wrote to src/a.js and ran 1 command: that file may hold its unfinished changes, so check it (git status, git diff) before you redo any of it.]");
  assert.equal(refusedLine([{ role: "user", content: "words taken into the turn" }]), "[The model's provider refused this turn, so Filament leaves it out of the history. It made no tool call before it was refused.]");
  assert.equal(got[2].final.content, "[The model's provider refused this turn, so Filament leaves it out of the history. Before it was refused it made 1 tool call, and what that did may already be on disk.]", "no file written: its calls counted");
  assert.deepEqual(got[3], turn(5), "the turns around it as they were");
});

// (fails before: yes — HarnessV4_Tasks C29: a turn's answer was read to know it had one)
test("the history: a finished turn is known by its row — its answer is not read to say so", () => {
  const unread = (/** @type {number} */ n) => ({ n, startedAt: 30_000 + n, meta: {}, finished: true, get user() { throw new Error("read"); }, get work() { throw new Error("read"); }, get final() { throw new Error("read"); } });
  const got = modelTurnsOf(/** @type {any[]} */ ([unread(1), turn(2), { ...turn(3, { final: null }), finished: false }, unread(4)]), 20_000);
  assert.deepEqual(got.map((t) => t.n), [1, 2, 4], "turn 3 has no answer and neither failed nor was cut off");
});
