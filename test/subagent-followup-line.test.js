// @ts-check
// A follow-up to a sub-agent whose conversation is already past its compaction line. The loop's fold reaches a turn's
// own rounds alone, and a follow-up has none at its first call: its earlier exchanges sat ahead of its message, out of
// the fold's reach, and nothing else could make room — so its first call went out past the line, and every follow-up
// after it did the same. They give way now as its own work does, by itself (the owner's word of 10-25: self model
// compaction): its own model, reading its own conversation, writes one summary of all of it, and the follow-up's message
// comes after that summary whole. The next follow-up goes on from that start.
// (fails before: yes — the follow-up's first call carried every earlier exchange whole, past the line)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { estimateTokens } from "../src/core/tokens.js";
import { projectIdOf } from "../src/core/project-id.js";

const CHILD = "You are a sub-agent run by Filament";
/** The ask a fork of a whole conversation ends with (compactor.js `FORK_SUMMARY_INSTRUCTION`). */
const WHOLE_ASK = /^\[Filament: this conversation has reached its compaction line\./;
/** The ask a fold of a turn's own rounds ends with (compactor.js `roundsForkInstruction`). */
const ROUNDS_ASK = /^\[Filament: (this turn has reached the compaction line|the developer asked to compact this turn now)\./;
const LONG_MARK = "LONG-REPORT-WORDS";
const BULK_MARK = "BULK-WORDS";
const BRIEF_MARK = "BRIEF-WORDS";
const SAID_MARK = "SAID-WITH-CALLS";
const MUCH_MARK = "MUCH-WORDS";
const FORKLESS_MARK = "FORKLESS-WORDS";
const WORDS_END = "THE-REPORT-ENDS-HERE";
const TOLD_MARK = "TOLD-WORDS";
const WAY_MARK = "WAY-PAST-WORDS";
const PIECE_MARK = "PIECE-WORDS";
const PIECE_TASK = "read the pieces past the window";
const PIECE_RULE = "Quote every path in a piece's report that holds spaces.";
const KEPT_BRIEF = "a summary to keep whole";
const SUMMARY_MARK = "EARLIER-SUMMARY-WORDS";
const SUMMARY_END = "THE-EARLIER-SUMMARY-ENDS-HERE";
const TOO_LONG = "prompt is too long: 230000 tokens > 200000 maximum";
const HUGE_BRIEF = "a summary past a smaller window";
const HUGE_MARK = "HUGE-SUMMARY-WORDS";
const OLDER_MARK = "OLDER-REPORT-WORDS";
const NEWER_MARK = "NEWER-REPORT-WORDS";
const NEWER_END = "THE-NEWER-REPORT-ENDS-HERE";
const SHORT_BRIEF = "a summary under a short ceiling";
/** The window of the model these sub-agents run on (m-1). */
const WINDOW = 200_000;
const textOf = (/** @type {any} */ m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
const blocksOf = (/** @type {any} */ m) => (Array.isArray(m?.content) ? m.content : []);
/** A message's last words: where a fork's ask is, alone or after the newest user message's own. @param {any} m */
const askOf = (m) => (typeof m?.content === "string" ? m.content : String(blocksOf(m).filter((/** @type {any} */ b) => b?.type === "text").at(-1)?.text ?? ""));
const answersTo = (/** @type {any} */ m) => blocksOf(m).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
/** What a request's words weigh, as the estimator counts them. @param {any[]} messages */
const wordsWeigh = (messages) => estimateTokens(messages.map(textOf).join("\n"));
/**
 * Where a request parts a tool result from its call, the provider's refusal, in Anthropic's words; null where every
 * result follows the reply that made its call. @param {any[]} messages
 */
const orphanOf = (messages) => {
  for (let i = 0; i < messages.length; i++) {
    const calls = new Set(messages[i - 1]?.role === "assistant" ? blocksOf(messages[i - 1]).filter((/** @type {any} */ b) => b?.type === "tool_use").map((/** @type {any} */ b) => b.id) : []);
    const lost = messages[i]?.role === "user" ? answersTo(messages[i]).filter((/** @type {string} */ id) => !calls.has(id)) : [];
    if (lost.length) return `messages.${i}.content.0: unexpected \`tool_use_id\` found in \`tool_result\` blocks: ${lost[0]}. Each \`tool_result\` block must have a corresponding \`tool_use\` block in the previous message.`;
  }
  return null;
};
/** Words of about `tokens` tokens, as the estimator counts them, each piece marked. @param {string} mark @param {number} tokens */
const wordsOf = (mark, tokens) => {
  const unit = `${mark} The parser reads each row to its end and keeps a comma inside quotes. `;
  return unit.repeat(Math.ceil(tokens / (estimateTokens(unit.repeat(200)) / 200)));
};
/** A summary longer than the cut of what the agent is told, its end marked. */
const LONG_SUMMARY = `${wordsOf(SUMMARY_MARK, 3_000)}${SUMMARY_END}`;
/** A summary bigger than one call of a 30,000-token window holds. */
const HUGE_SUMMARY = wordsOf(HUGE_MARK, 30_000);
/** A summary as long as one a writer that can write little still writes. */
const SHAPED_SUMMARY = wordsOf("SHAPED-SUMMARY-WORDS", 2_000);
/** The two reports of a helper whose older one is long too, its fork refused by the provider. */
const OLDER_REPORT = `${FORKLESS_MARK} ${wordsOf(OLDER_MARK, 60_000)}`;
const NEWER_REPORT = `${wordsOf(NEWER_MARK, 110_000)}${NEWER_END}`;

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;
/** The long report's words, sized once the launch's record says what its system prompt and tools weigh. */
let longReport = "";
/** The words the first round of the exchange that fails writes, sized the same way. */
let bulk = "";
/** The words beside the calls of the reply whose results end an exchange that fails, sized the same way. */
let saidWithCalls = "";
/** The words of a report the provider takes no request with again. */
let much = "";
/** The words beside the calls of a reply whose conversation no fork can be made of. */
let forklessWords = "";
/** The words of a report that takes the conversation past the window. */
let wayPast = "";
/** The files an exchange reads at once, each result under the transcript's cut of a result. @type {string[]} */
let pieces = [];
/** The window the provider holds m-1's requests to, as its card says it now. */
let windowNow = WINDOW;
/** The summaries asked for, by the ask's kind. @type {string[]} */
const asks = [];
/** The requests the provider refused for a tool result parted from its call. @type {string[]} */
const orphans = [];
let refusedForSize = false;
/** Whether the provider's newest refusal of a sub-agent's call was for size, and no summary was asked since. */
let sizeRefused = false;
/** Each summary call over a transcript: what its words weigh, and the room its reply was given. @type {{ weight: number, room: number }[]} */
const rooms = [];

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-saline-"));
  writeFileSync(join(folder, "a.txt"), "row one\n");
  writeFileSync(join(folder, "b.txt"), "row two\n");
  up = await fakeUpstream(async (call) => {
    const body = call.body || {};
    const system = JSON.stringify(body.system ?? "");
    const messages = body.messages || [];
    const model = body.model || "m-1";
    const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model, stop, blocks, usage: { input_tokens: 5, output_tokens: 3 } });
    const said = (/** @type {string} */ text) => reply([{ type: "text", text }]);
    const refused = (/** @type {string} */ message) => {
      // A sub-agent's call refused for size: this provider counts that conversation as bigger than the estimator does.
      if (system.includes(CHILD) && message.startsWith("prompt is too long")) sizeRefused = true;
      return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message } } };
    };
    const orphan = orphanOf(messages);
    if (orphan) {
      orphans.push(orphan);
      return refused(orphan);
    }
    const last = textOf(messages.at(-1));
    const answers = answersTo(messages.at(-1));
    if (WHOLE_ASK.test(askOf(messages.at(-1)))) {
      if (JSON.stringify(messages).includes(FORKLESS_MARK)) {
        asks.push("whole failed");
        return refused("the provider broke on this request");
      }
      asks.push("whole");
      return said("<analysis>notes</analysis>\n<summary>\nEARLIER SUMMARY: it read the parser and reported.\n</summary>");
    }
    if (ROUNDS_ASK.test(askOf(messages.at(-1)))) {
      asks.push("rounds");
      return said("<summary>\nROUNDS SUMMARY\n</summary>");
    }
    if (system.includes("compaction summaries")) {
      // A request past the window, its reply's room with it, is refused, as any provider refuses one. Just after a
      // sub-agent's call was refused for size, a transcript about as big as that call is refused the same way: this
      // provider counts more than the estimator.
      const read = JSON.stringify(messages);
      const weight = wordsWeigh(messages);
      const room = Number(body.max_tokens) || 0;
      const afterRefusal = sizeRefused;
      sizeRefused = false;
      rooms.push({ weight, room });
      if (weight + room > windowNow || (afterRefusal && read.length > 100_000)) {
        asks.push("transcript refused");
        return refused("prompt is too long: 230000 tokens > 200000 maximum");
      }
      // A helper whose summaries run past the cut of what the agent is told; one whose summary outgrows a smaller window.
      const [kind, summary] = read.includes(KEPT_BRIEF) || read.includes(SUMMARY_MARK) ? ["long summary", LONG_SUMMARY] : read.includes(HUGE_BRIEF) ? ["huge summary", HUGE_SUMMARY] : read.includes(SHORT_BRIEF) ? ["shaped summary", SHAPED_SUMMARY] : ["transcript", "TRANSCRIPT SUMMARY"];
      // The writer's notes come first, a twentieth of what it read and at least 500 tokens, then the summary. Where its
      // room ends first, so does its reply, unfinished, as a model's does at its max_tokens.
      const whole = `<analysis>\n${wordsOf("NOTES", Math.max(500, Math.ceil(weight / 20)))}\n</analysis>\n<summary>\n${summary}\n</summary>`;
      const tokens = estimateTokens(whole);
      if (tokens <= room) {
        asks.push(kind);
        return said(whole);
      }
      asks.push(`${kind} cut short`);
      return reply([{ type: "text", text: whole.slice(0, Math.floor((whole.length * room) / tokens)) }], "max_tokens");
    }
    if (system.includes(CHILD)) {
      // A helper whose earlier summary runs long: refused for size before it, past the window after it, refused again.
      const sent = JSON.stringify(messages);
      if (last.includes("REFUSE FIRST, A LONG SUMMARY")) return sent.includes("FIRST REPORT") ? refused(TOO_LONG) : said(wayPast);
      if (last.includes("AFTER THE LONG SUMMARY")) return said("REPORT AFTER THE SUMMARY");
      if (last.includes("REFUSE AGAIN, THE SUMMARY KEPT")) return sent.includes("REPORT AFTER THE SUMMARY") ? refused(TOO_LONG) : said("REPORT THE SUMMARY KEPT");
      if (last.includes("REFUSE FIRST, A HUGE SUMMARY")) return sent.includes("FIRST REPORT") ? refused(TOO_LONG) : said("REPORT BEFORE THE SHRINK");
      // Two long reports, the older one too.
      if (last.includes("AFTER THE TWO REPORTS")) return said("AFTER TWO REPORT");
      if (last.includes("THE OLDER REPORT")) return said(OLDER_REPORT);
      if (last.includes("THE NEWER REPORT")) return said(NEWER_REPORT);
      // Reports that take the conversation past the window, whole and in pieces.
      if (last.includes("AFTER THE WINDOW")) return said("AFTER WINDOW REPORT");
      if (last.includes("REPORT PAST THE WINDOW")) return said(wayPast);
      if (last.includes("AFTER THE PIECES")) return said("AFTER PIECES REPORT");
      if (answers.includes("toolu_p0")) return said("PIECES READ");
      if (last.includes("READ THE PIECES")) return reply(pieces.map((path, i) => ({ type: "tool_use", id: `toolu_p${i}`, name: "read", input: { path } })), "tool_use");
      // The exchange that fails on the results of a reply with words, whose conversation no fork is made of.
      if (last.includes("AFTER THE FORK FAILED")) return said("AFTER FORK REPORT");
      if (answers.includes("toolu_f1")) return refused("the provider broke on this request");
      if (last.includes("WORDS, THEN A FORK THAT FAILS")) return reply([{ type: "text", text: forklessWords }, { type: "tool_use", id: "toolu_f1", name: "read", input: { path: "a.txt" } }], "tool_use");
      // A follow-up whose own words the provider takes no request with again.
      if (last.includes("TOLD MUCH")) return said("HEARD MUCH");
      if (last.includes("REFUSE THE TOLD")) return JSON.stringify(messages).includes(TOLD_MARK) ? refused("prompt is too long: 230000 tokens > 200000 maximum") : said("RETRIED AFTER TOLD");
      if (last.includes("AFTER THE FAILURE")) return said("AFTER REPORT");
      // The exchange that fails on the results of a reply that said much beside its calls.
      if (last.includes("AFTER THE WORDS")) return said("AFTER WORDS REPORT");
      if (answers.includes("toolu_w1")) return refused("the provider broke on this request");
      if (last.includes("WORDS AND CALLS, THEN A FAILURE")) return reply([{ type: "text", text: saidWithCalls }, { type: "tool_use", id: "toolu_w1", name: "read", input: { path: "a.txt" } }], "tool_use");
      // A request that carries this report is refused for size, though the estimate put it under the line.
      if (last.includes("SAY MUCH")) return said(much);
      if (last.includes("REFUSE THE MUCH")) return JSON.stringify(messages).includes(MUCH_MARK) ? refused("prompt is too long: 230000 tokens > 200000 maximum") : said("RETRIED AFTER MUCH");
      // The exchange that fails: two rounds of reads, then its provider fails the third with nothing streamed.
      if (answers.includes("toolu_t2")) return refused("the provider broke on this request");
      if (answers.includes("toolu_t1")) return reply([{ type: "tool_use", id: "toolu_t2", name: "read", input: { path: "b.txt" } }], "tool_use");
      if (last.includes("TOOLS THEN FAIL")) return reply([{ type: "text", text: bulk }, { type: "tool_use", id: "toolu_t1", name: "read", input: { path: "a.txt" } }], "tool_use");
      if (last.includes("REFUSE FOR SIZE")) {
        if (refusedForSize) return said("RETRIED REPORT");
        refusedForSize = true;
        return refused("prompt is too long: 250000 tokens > 200000 maximum");
      }
      if (last.includes("LONG PART")) return said(longReport);
      if (last.includes("PAST THE LINE")) return said("SECOND REPORT");
      if (last.includes("ONE MORE")) return said("THIRD REPORT");
      return said("FIRST REPORT");
    }
    return said("PLAIN ANSWER");
  });
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 }, "m-small": { input: 1, output: 1, contextTokens: 64000 }, "m-short": { input: 1, output: 1, contextTokens: 200000, maxOutputTokens: 8192 } } }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
      // The line is weighed on the estimator's own scale: the fake provider's usage would teach it nothing true.
      cfg.observability = { ...cfg.observability, tokenCalibration: false };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, folder])
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
});

/** @param {string} id */
const at = (id, /** @type {string} */ path = "") => `/api/sessions/${encodeURIComponent(id)}/subagents${path}`;
/** @param {string} model */
const newSession = async (model) => {
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model } });
  assert.equal(s.status, 200, await s.clone().text());
  return String((await s.json()).id);
};
/** @param {string} id @param {string} prompt @param {Record<string, unknown>} [more]  the launch's other fields */
const launch = async (id, prompt, more = {}) => {
  const spawn = await shim.api(at(id), { method: "POST", body: { prompt, description: "Past its line", deliver: false, ...more } });
  assert.equal(spawn.status, 200, await spawn.clone().text());
  return String((await spawn.json()).subagent.id);
};
/** The sub-agent once its exchange `n` ended. @param {string} id @param {string} sid @param {number} n */
const ended = (id, sid, n) =>
  until(async () => {
    const { subagents } = await (await shim.api(at(id))).json();
    const sa = subagents.find((/** @type {any} */ s) => s.id === sid);
    return sa && sa.status !== "running" && sa.exchanges.length === n + 1 && sa.exchanges[n].status && sa.exchanges[n].status !== "running" ? sa : null;
  }, `exchange ${n} to end`);
/** @param {string} id @param {string} sid @param {string} prompt */
const followUp = async (id, sid, prompt) => {
  const r = await shim.api(at(id, `/${sid}/follow-up`), { method: "POST", body: { prompt } });
  assert.equal(r.status, 200, await r.clone().text());
};
/** The sub-agent's own rounds the provider received since `mark`, summaries aside. @param {number} mark */
const rounds = (mark) =>
  up.received.slice(mark).filter((c) => {
    const last = askOf(c.body?.messages?.at(-1));
    return JSON.stringify(c.body?.system ?? "").includes(CHILD) && !WHOLE_ASK.test(last) && !ROUNDS_ASK.test(last);
  });
/** What a launch's system prompt, tools and brief weigh: its record's end state. @param {any} sa */
const startOf = async (sa) => {
  const rec = await shim.record(String(sa.exchanges[0].runId));
  const start = Number(rec.context?.estimate);
  assert.ok(start > 0 && start < 40_000, JSON.stringify(rec.context));
  return { start, usable: Number(rec.context?.usable) };
};

test("a follow-up to a sub-agent past its line: its earlier exchanges give way to its own summary before its first call, and the next follow-up goes on from there", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, "read the parser");
  const { start, usable } = await startOf(await ended(id, sid, 0));
  // Its line: 85% of its model's 200,000. The long report brings the conversation past it, with room left in the
  // window for its own model to read it.
  assert.equal(usable, 170_000);
  longReport = wordsOf(LONG_MARK, 181_000 - start);
  const asked = asks.length;

  // Exchange 1 starts small and ends with the long report: it went out under the line, and nothing was compacted.
  await followUp(id, sid, "now the LONG PART");
  const one = await ended(id, sid, 1);
  assert.equal(one.exchanges[1].status, "done", JSON.stringify(one.exchanges[1]));
  assert.deepEqual(asks.slice(asked), []);

  // Exchange 2 starts past the line.
  const mark = up.received.length;
  await followUp(id, sid, "the follow-up PAST THE LINE");
  const two = await ended(id, sid, 2);
  assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "SECOND REPORT"], JSON.stringify(two.exchanges[2]));
  assert.deepEqual(asks.slice(asked), ["whole"], "its own model read its own conversation and wrote one summary of it");
  const fork = up.received.slice(mark).find((c) => WHOLE_ASK.test(askOf(c.body?.messages?.at(-1))));
  assert.ok(fork && JSON.stringify(fork.body.messages).includes(LONG_MARK), "the summary was written from the conversation itself");
  assert.equal(fork?.body.model, "m-1");
  assert.ok(!JSON.stringify(fork?.body.messages).includes("PAST THE LINE"), "the follow-up's message is no part of what gave way");
  const [first, ...more] = rounds(mark);
  assert.ok(first, "the follow-up's first call");
  assert.equal(more.length, 0);
  const sent = first.body.messages;
  assert.ok(!JSON.stringify(sent).includes(LONG_MARK), "the first call carries no earlier exchange whole");
  assert.deepEqual(sent.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.match(textOf(sent[0]), /^\[Filament compacted turns 1–2 into the summary below\.[^\n]*\]\nEARLIER SUMMARY: it read the parser and reported\.$/);
  assert.match(textOf(sent[2]), /the follow-up PAST THE LINE/);
  const rec = await shim.record(String(two.exchanges[2].runId));
  const notes = (rec.changes || []).join("\n");
  assert.match(notes, /agent: its earlier 2 exchanges summarized by m-1, itself, reading its own conversation — in the middle of this turn, whose own steps stay whole \(the request ≈[\d,]+ → ≈[\d,]+ tokens estimated\)/);
  assert.ok(!/standing down/.test(notes), notes);
  assert.ok(Number(rec.context?.estimate) < 170_000, JSON.stringify(rec.context));
  // Its thread says what gave way as its exchanges (the run's events carry `exchanges`).
  const events = (await (await shim.api(`/api/runs/${encodeURIComponent(String(two.exchanges[2].runId))}/events?since=0&limit=5000`)).json()).events;
  const marks = events.filter((/** @type {any} */ e) => e.type === "compacting" || e.type === "compaction").map((/** @type {any} */ e) => [e.type, !!e.earlier, !!e.exchanges, e.fromTurn ?? null, e.toTurn ?? null]);
  assert.deepEqual(marks, [["compacting", true, true, null, null], ["compaction", true, true, 1, 2]]);

  // Exchange 3 goes on from the start exchange 2 left: the summary, its message and its report — nothing given way
  // again, the long report gone for good.
  const mark3 = up.received.length;
  await followUp(id, sid, "ONE MORE");
  const three = await ended(id, sid, 3);
  assert.deepEqual([three.exchanges[3].status, three.exchanges[3].report], ["done", "THIRD REPORT"]);
  assert.deepEqual(asks.slice(asked), ["whole"]);
  const [next] = rounds(mark3);
  const kept = next.body.messages;
  assert.ok(!JSON.stringify(kept).includes(LONG_MARK));
  assert.deepEqual(kept.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.match(textOf(kept[0]), /EARLIER SUMMARY/);
  assert.match(textOf(kept[2]), /the follow-up PAST THE LINE/);
  assert.match(textOf(kept[3]), /SECOND REPORT/);
  assert.match(textOf(kept[4]), /ONE MORE/);
});

// The reviewer's case of 11-02: an exchange whose next call failed after its tools ran ends on their results, and the
// follow-up's words join that message. Past the line, the reply that made those calls must not give way with the rest:
// its results would be parted from it, and the provider refuses every call after (an orphan `tool_use_id`).
// (fails before: yes — the first call was [summary, acknowledgment, results + words]: refused, and so was the next)
test("a follow-up past the line after an exchange that failed on its tools' results: the reply that made the calls stays after the summary, and the helper goes on", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, "tools then a failure");
  const { start } = await startOf(await ended(id, sid, 0));
  // The failing exchange stays under the line as it runs; the follow-up's words then take it past.
  bulk = wordsOf(BULK_MARK, 158_000 - start);
  const asked = asks.length;
  const refusedBefore = orphans.length;
  await followUp(id, sid, "TOOLS THEN FAIL");
  const one = await ended(id, sid, 1);
  assert.equal(one.exchanges[1].status, "failed", JSON.stringify(one.exchanges[1]));
  assert.deepEqual(asks.slice(asked), [], "it ran under the line");

  const mark = up.received.length;
  await followUp(id, sid, `AFTER THE FAILURE: go on. ${wordsOf("FOLLOW-UP-WORDS", 16_000)}`);
  const two = await ended(id, sid, 2);
  assert.deepEqual(orphans.slice(refusedBefore), [], "no request parted a result from its call");
  assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "AFTER REPORT"], JSON.stringify(two.exchanges[2]));
  assert.deepEqual(asks.slice(asked), ["whole"]);
  const fork = up.received.slice(mark).find((c) => WHOLE_ASK.test(askOf(c.body?.messages?.at(-1))));
  assert.ok(fork && JSON.stringify(fork.body.messages).includes(BULK_MARK), "the summary was written from the earlier exchanges");
  assert.ok(!JSON.stringify(fork?.body.messages).includes("toolu_t2"), "the reply whose calls the follow-up answers is no part of the summary");
  const [first] = rounds(mark);
  const sent = first.body.messages;
  assert.ok(!JSON.stringify(sent).includes(BULK_MARK), "the earlier exchanges gave way");
  assert.deepEqual(sent.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.match(textOf(sent[0]), /^\[Filament compacted turns 1–2 into the summary below\./);
  assert.deepEqual(blocksOf(sent[1]).map((/** @type {any} */ b) => [b.type, b.id]), [["tool_use", "toolu_t2"]], "the reply that made the call, in the acknowledgment's place");
  assert.deepEqual(answersTo(sent[2]), ["toolu_t2"]);
  assert.match(textOf(sent[2]), /^AFTER THE FAILURE: go on\./);

  // The start it keeps is as well formed: the next follow-up goes out and is answered.
  const mark3 = up.received.length;
  await followUp(id, sid, "ONE MORE");
  const three = await ended(id, sid, 3);
  assert.deepEqual([three.exchanges[3].status, three.exchanges[3].report], ["done", "THIRD REPORT"], JSON.stringify(three.exchanges[3]));
  assert.deepEqual(orphans.slice(refusedBefore), []);
  const kept = rounds(mark3)[0].body.messages;
  assert.deepEqual(kept.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.deepEqual(answersTo(kept[2]), ["toolu_t2"]);
});

// The Hunter's case of 11-02: the reply whose calls the follow-up's message answers said much beside them. Its calls
// stay after the summary, for their results; its words give way with the rest. Kept whole, they held the follow-up's
// first call past its line, out of the turn's fold, and — where that exchange failed too — the next follow-up kept the
// same reply ahead of its message, and they never gave way.
// (fails before: yes — the reply stayed whole after the summary, its words in the first call and none in the summary)
test("a follow-up past the line after an exchange that failed on the results of a reply with words: its words give way, its calls stay", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, "words and calls then a failure");
  const { start } = await startOf(await ended(id, sid, 0));
  saidWithCalls = wordsOf(SAID_MARK, 158_000 - start);
  const asked = asks.length;
  const refusedBefore = orphans.length;
  await followUp(id, sid, "WORDS AND CALLS, THEN A FAILURE");
  const one = await ended(id, sid, 1);
  assert.equal(one.exchanges[1].status, "failed", JSON.stringify(one.exchanges[1]));
  assert.deepEqual(asks.slice(asked), [], "it ran under the line");

  const mark = up.received.length;
  await followUp(id, sid, `AFTER THE WORDS: go on. ${wordsOf("FOLLOW-UP-WORDS", 16_000)}`);
  const two = await ended(id, sid, 2);
  assert.deepEqual(orphans.slice(refusedBefore), [], "no request parted a result from its call");
  assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "AFTER WORDS REPORT"], JSON.stringify(two.exchanges[2]));
  const [first, ...more] = rounds(mark);
  assert.equal(more.length, 0);
  const sent = first.body.messages;
  assert.ok(!JSON.stringify(sent).includes(SAID_MARK), "the reply's words gave way");
  assert.deepEqual(sent.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(blocksOf(sent[1]).map((/** @type {any} */ b) => [b.type, b.id]), [["tool_use", "toolu_w1"]], "the reply's calls, in the acknowledgment's place");
  assert.deepEqual(answersTo(sent[2]), ["toolu_w1"]);
  const rec = await shim.record(String(two.exchanges[2].runId));
  assert.ok(Number(rec.context?.estimate) < 170_000, JSON.stringify(rec.context));
  assert.deepEqual(asks.slice(asked), ["whole"]);
  const fork = up.received.slice(mark).find((c) => WHOLE_ASK.test(askOf(c.body?.messages?.at(-1))));
  assert.ok(fork && JSON.stringify(fork.body.messages).includes(SAID_MARK), "the summary was written from the reply's words too");
  assert.ok(!JSON.stringify(fork?.body.messages).includes("toolu_w1"), "its calls are no part of the summary");

  // The start it keeps holds the calls alone: the next follow-up goes out without the words.
  const mark3 = up.received.length;
  await followUp(id, sid, "ONE MORE");
  const three = await ended(id, sid, 3);
  assert.deepEqual([three.exchanges[3].status, three.exchanges[3].report], ["done", "THIRD REPORT"], JSON.stringify(three.exchanges[3]));
  assert.deepEqual(asks.slice(asked), ["whole"]);
  const kept = rounds(mark3)[0].body.messages;
  assert.ok(!JSON.stringify(kept).includes(SAID_MARK));
  assert.deepEqual(kept.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.deepEqual(answersTo(kept[2]), ["toolu_w1"]);
});

// A launch has nothing of its own ahead of its message: its first call goes out as it is, with no summary asked for.
test("a launch past its line gets no hand: nothing gives way, its brief goes out whole", async () => {
  const id = await newSession("m-small");
  const { start, usable } = await startOf(await ended(id, await launch(id, "look aside"), 0));
  assert.equal(usable, 54_400, "85% of its model's 64,000");
  const asked = asks.length;
  const mark = up.received.length;
  const sid = await launch(id, `${wordsOf(BRIEF_MARK, usable - start + 3_000)}\nRead it.`);
  const done = await ended(id, sid, 0);
  assert.equal(done.exchanges[0].status, "done", JSON.stringify(done.exchanges[0]));
  assert.deepEqual(asks.slice(asked), []);
  const [first] = rounds(mark);
  assert.ok(JSON.stringify(first.body.messages).includes(BRIEF_MARK));
  const rec = await shim.record(String(done.exchanges[0].runId));
  assert.ok(Number(rec.context?.estimate) >= usable, `it was past its line: ${JSON.stringify(rec.context)}`);
  assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => /earlier (exchange|turn)/.test(c)), JSON.stringify(rec.changes));
});

// The provider refuses a follow-up's first call for size, though the estimate put it under the line: the earlier
// exchanges give way at the overflow door, from their transcript — a conversation refused for size is not read again.
test("a follow-up refused for size: its earlier exchanges give way from their transcript, and the call is sent once more", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, "small then refused");
  await ended(id, sid, 0);
  const asked = asks.length;
  const mark = up.received.length;
  await followUp(id, sid, "REFUSE FOR SIZE");
  const one = await ended(id, sid, 1);
  assert.deepEqual([one.exchanges[1].status, one.exchanges[1].report], ["done", "RETRIED REPORT"], JSON.stringify(one.exchanges[1]));
  assert.deepEqual(asks.slice(asked), ["transcript"], "its own model over the transcript; no fork of what was refused");
  const sent = rounds(mark);
  assert.equal(sent.length, 2, "the refused call and the one sent again");
  assert.ok(JSON.stringify(sent[0].body.messages).includes("FIRST REPORT"));
  const again = sent[1].body.messages;
  assert.ok(!JSON.stringify(again).includes("FIRST REPORT"), "the earlier exchange gave way");
  assert.deepEqual(again.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.match(textOf(again[0]), /^\[Filament compacted turn 1 into the summary below\.[^\n]*\]\nTRANSCRIPT SUMMARY$/);
  assert.match(textOf(again[2]), /REFUSE FOR SIZE/);
  const notes = ((await shim.record(String(one.exchanges[1].runId))).changes || []).join("\n");
  assert.match(notes, /agent: its earlier exchange summarized by m-1, itself, from their transcript/);
  assert.match(notes, /round 1 was refused for size \(prompt is too long[^)]*\) — retrying once, after its earlier exchanges gave way/);
});

// The Hunter's case of 11-02: what was refused for size is a report's words. Their transcript bounds each of the
// agent's words as the loop's fold of its rounds does: whole, it was about as big as the request the provider refused,
// refused the same way, and the call went out again as it was.
// (fails before: yes — the transcript carried the report whole; refused, nothing gave way, and the exchange failed)
test("a follow-up refused for size with a long report ahead of it: the transcript its earlier exchanges give way from bounds the report's words", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, "much then refused");
  await ended(id, sid, 0);
  much = wordsOf(MUCH_MARK, 120_000);
  await followUp(id, sid, "SAY MUCH");
  const one = await ended(id, sid, 1);
  assert.equal(one.exchanges[1].status, "done", JSON.stringify(one.exchanges[1]));
  const asked = asks.length;
  const mark = up.received.length;
  await followUp(id, sid, "REFUSE THE MUCH");
  const two = await ended(id, sid, 2);
  assert.deepEqual(asks.slice(asked), ["transcript"], "its own model over the transcript, which the provider took");
  assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "RETRIED AFTER MUCH"], JSON.stringify(two.exchanges[2]));
  const transcript = up.received.slice(mark).find((c) => JSON.stringify(c.body?.system ?? "").includes("compaction summaries"));
  const read = JSON.stringify(transcript?.body.messages);
  assert.ok(read.includes(`Assistant: ${MUCH_MARK}`) && read.includes("…"), "the report's start, cut");
  assert.ok(read.length < 20_000, `the transcript is bounded: ${read.length} characters`);
  const sent = rounds(mark);
  assert.equal(sent.length, 2, "the refused call and the one sent again");
  const again = sent[1].body.messages;
  assert.ok(!JSON.stringify(again).includes(MUCH_MARK), "the earlier exchanges gave way");
  assert.deepEqual(again.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.match(textOf(again[0]), /^\[Filament compacted turns 1–2 into the summary below\.[^\n]*\]\nTRANSCRIPT SUMMARY$/);
});

// The Hunter's case of 11-02 (sa_1738c248): at the line the fork wrote nothing, and the summary is written from the
// transcript. The reply's words give way with the rest and go on in that summary alone: the transcript holds them
// whole, since the conversation fit under the line. The size refusal's cut is for the overflow door.
// (fails before: yes — the transcript cut the reply's words to 2,000 characters at the line too; their end was lost)
test("a follow-up at the line whose fork fails: the transcript its earlier exchanges give way from holds the reply's words whole", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, "words then a fork that fails");
  const { start } = await startOf(await ended(id, sid, 0));
  forklessWords = `${wordsOf(FORKLESS_MARK, 1_500)}${WORDS_END}`;
  await followUp(id, sid, "WORDS, THEN A FORK THAT FAILS");
  const one = await ended(id, sid, 1);
  assert.equal(one.exchanges[1].status, "failed", JSON.stringify(one.exchanges[1]));
  const asked = asks.length;
  const refusedBefore = orphans.length;
  const mark = up.received.length;
  // The follow-up's words take the conversation past its line of 170,000, under its window.
  await followUp(id, sid, `AFTER THE FORK FAILED: go on. ${wordsOf("FOLLOW-UP-WORDS", 172_000 - start)}`);
  const two = await ended(id, sid, 2);
  assert.deepEqual(orphans.slice(refusedBefore), [], "no request parted a result from its call");
  assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "AFTER FORK REPORT"], JSON.stringify(two.exchanges[2]));
  assert.deepEqual(asks.slice(asked), ["whole failed", "transcript"], "the fork failed; its own model wrote the summary from the transcript");
  const transcript = up.received.slice(mark).find((c) => JSON.stringify(c.body?.system ?? "").includes("compaction summaries"));
  const read = JSON.stringify(transcript?.body.messages);
  assert.ok(read.includes(`Assistant: ${FORKLESS_MARK}`), "the reply's words are in the transcript");
  assert.ok(read.includes(WORDS_END), "the reply's words, whole");
  const [first] = rounds(mark);
  const sent = first.body.messages;
  assert.ok(!JSON.stringify(sent).includes(FORKLESS_MARK), "the reply's words gave way");
  assert.deepEqual(sent.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(blocksOf(sent[1]).map((/** @type {any} */ b) => [b.type, b.id]), [["tool_use", "toolu_f1"]], "the reply's calls, in the acknowledgment's place");
  const notes = ((await shim.record(String(two.exchanges[2].runId))).changes || []).join("\n");
  assert.match(notes, /agent: its earlier 2 exchanges summarized by m-1, itself, from their transcript/);
});

// The Hunter's case of 11-02 (sa_1738c248): what was refused for size is words the agent was told — a follow-up's
// message. Their transcript cuts them as the loop's fold of a turn's rounds cuts a message to it: whole, they were
// about as big as the request the provider refused, refused the same way, and nothing gave way.
// (fails before: yes — the transcript carried the told words whole; refused, nothing gave way, and the exchange failed)
test("a follow-up refused for size after a long message to the agent: the transcript its earlier exchanges give way from bounds the message's words", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, "told much then refused");
  await ended(id, sid, 0);
  await followUp(id, sid, `TOLD MUCH: ${wordsOf(TOLD_MARK, 120_000)}`);
  const one = await ended(id, sid, 1);
  assert.deepEqual([one.exchanges[1].status, one.exchanges[1].report], ["done", "HEARD MUCH"], JSON.stringify(one.exchanges[1]));
  const asked = asks.length;
  const mark = up.received.length;
  await followUp(id, sid, "REFUSE THE TOLD");
  const two = await ended(id, sid, 2);
  assert.deepEqual(asks.slice(asked), ["transcript"], "its own model over the transcript, which the provider took");
  assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "RETRIED AFTER TOLD"], JSON.stringify(two.exchanges[2]));
  const transcript = up.received.slice(mark).find((c) => JSON.stringify(c.body?.system ?? "").includes("compaction summaries"));
  const read = JSON.stringify(transcript?.body.messages);
  assert.ok(read.includes(`User: TOLD MUCH: ${TOLD_MARK}`) && read.includes("…"), "the message's start, cut");
  assert.ok(read.length < 20_000, `the transcript is bounded: ${read.length} characters`);
  const again = rounds(mark)[1].body.messages;
  assert.ok(!JSON.stringify(again).includes(TOLD_MARK), "the earlier exchanges gave way");
  assert.match(textOf(again[0]), /^\[Filament compacted turns 1–2 into the summary below\.[^\n]*\]\nTRANSCRIPT SUMMARY$/);
  // The review of 11-03 (sa_94bd1300, round 5): the note said "its longest words cut to 2,000 characters", where only
  // the message to it was cut, to 8,000.
  // (fails before: yes — the note named a cut of the agent's own words that never was)
  const notes = ((await shim.record(String(two.exchanges[2].runId))).changes || []).join("\n");
  assert.match(notes, /agent: its earlier 2 exchanges summarized by m-1, itself, from their transcript, one message to it cut to 8,000 characters to fit one call — /);
});

/** The summary's call over a transcript among the requests since `mark`. @param {number} mark */
const transcriptCall = (mark) => up.received.slice(mark).find((c) => JSON.stringify(c.body?.system ?? "").includes("compaction summaries"));

// A bug hunt's case of 11-03: compaction runs before a round, never after a final reply, so a report that ends an
// exchange can leave the conversation past the window, and the follow-up's first round finds it there. No fork has room
// to read a conversation past the window, and the transcript its earlier exchanges give way from holds the report whole
// at the line: as big as the window, the summary's own call is refused, nothing gives way, and the follow-up stops at
// the window. Where whole does not fit one call, the transcript is cut.
// (fails before: yes — the transcript held the report whole; refused, nothing gave way, and the follow-up stopped at the window)
// The review of 11-03 (sa_94bd1300): cut, the report went to 2,000 characters as after a size refusal, the rest of a
// 200,000-token window unused; and the summary's own room was what the window left — a reply's notes over the whole
// transcript could not end in it. The report keeps all of itself the room holds, and the reply the rest of the window.
// (fails before: yes — the transcript the summary was written from held 2,000 characters of the report)
test("a follow-up whose earlier exchanges are past the window, with no room for a fork: the transcript they give way from keeps all of the report the room holds, the summary its own room, and the helper goes on", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, "a report past the window");
  await ended(id, sid, 0);
  // The report alone is past the window: so is the conversation, and a transcript that holds it whole.
  wayPast = `${wordsOf(WAY_MARK, 215_000)}${WORDS_END}`;
  await followUp(id, sid, "REPORT PAST THE WINDOW");
  const one = await ended(id, sid, 1);
  assert.equal(one.exchanges[1].status, "done", JSON.stringify(one.exchanges[1]));
  const asked = asks.length;
  const mark = up.received.length;
  await followUp(id, sid, "AFTER THE WINDOW: go on.");
  const two = await ended(id, sid, 2);
  assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "AFTER WINDOW REPORT"], JSON.stringify(two.exchanges[2]));
  assert.ok(!up.received.slice(mark).some((c) => WHOLE_ASK.test(askOf(c.body?.messages?.at(-1)))), "no fork had room to read it");
  assert.deepEqual(asks.slice(asked), ["transcript"], "its own model wrote the summary from the transcript, which the provider took, and its notes and summary fit its room");
  const call = transcriptCall(mark);
  const read = JSON.stringify(call?.body.messages);
  assert.ok(read.includes(`Assistant: ${WAY_MARK}`) && read.includes("…") && !read.includes(WORDS_END), "the report's start, cut");
  const weight = wordsWeigh(call?.body.messages);
  const room = Number(call?.body.max_tokens);
  assert.ok(weight > 0.6 * WINDOW && weight <= 0.7 * WINDOW, `the report fills what one call may read — 70% of the window, less the summary's reserve: ${weight} tokens`);
  assert.ok(room >= 0.25 * WINDOW && weight + room <= WINDOW, `the rest of the window is the reply's: ${room} tokens`);
  assert.deepEqual(rooms.at(-1), { weight, room }, "the provider saw that call, and that room");
  const [first, ...more] = rounds(mark);
  assert.equal(more.length, 0);
  const sent = first.body.messages;
  assert.ok(!JSON.stringify(sent).includes(WAY_MARK), "the earlier exchanges gave way");
  assert.deepEqual(sent.map((/** @type {any} */ m) => m.role), ["user", "assistant", "user"]);
  assert.match(textOf(sent[0]), /^\[Filament compacted turns 1–2 into the summary below\.[^\n]*\]\nTRANSCRIPT SUMMARY$/);
  assert.match(textOf(sent[2]), /AFTER THE WINDOW: go on\./);
  const notes = ((await shim.record(String(two.exchanges[2].runId))).changes || []).join("\n");
  assert.match(notes, /agent: its earlier 2 exchanges summarized by m-1, itself, from their transcript, one of its replies cut to [\d,]+ characters, its oldest line left out to fit one call — in the middle of this turn/);
  assert.ok(!/cannot fit/.test(notes), notes);
});

// Pieces each under their cut can add up past the window too: an exchange read many files at once, under its line, and
// the window its model is measured by is smaller by the follow-up (its card edited). Cut, the transcript is as big as
// whole, and its summary's call is refused the same way. Its oldest lines after the brief give way, as few as make
// that call fit, and a line in their place says so.
// (fails before: yes — the transcript went out past the window; refused, nothing gave way, and the follow-up stopped at the window)
// The review of 11-03 (sa_94bd1300): the lines left out were as few as filled the call to the window less a fork's
// least room, and the writer's notes over the whole transcript did not end in it, so no summary came back; and the line
// kept first was the first message's first block — memory's brief, where it has one — while the task after it went
// with the oldest lines. The call reads what the compactor lets one call read, the rest of the window the reply's, and
// the first message stays as one: memory's brief and the task.
// (fails before: yes — the summary's call had some 4,000 tokens of room, and its notes ran out in it)
test("a follow-up whose earlier exchanges are past the window in pieces each under their cut: the transcript's oldest lines give way until the summary's call fits with room for the summary, its first message — memory's brief and the task — kept", async () => {
  const id = await newSession("m-1");
  const autopilot = shim.app.config.memory.autopilot;
  autopilot.enabled = true;
  /** @type {string} */
  let sid;
  /** @type {{ start: number, usable: number }} */
  let opened;
  try {
    const said = await shim.api("/api/memory/remember", { method: "POST", body: { text: PIECE_RULE, kind: "rule", project: projectIdOf(folder) } });
    assert.equal(said.status, 200, await said.clone().text());
    const mark0 = up.received.length;
    sid = await launch(id, PIECE_TASK, { memory: true });
    opened = await startOf(await ended(id, sid, 0));
    const first = rounds(mark0)[0].body.messages[0].content.map((/** @type {any} */ b) => b.text);
    assert.equal(first.length, 2, "memory's brief, then the task");
    assert.ok(first[0].startsWith("<memory>\n") && first[0].includes(PIECE_RULE), first[0]);
    assert.equal(first[1], PIECE_TASK);
  } finally {
    autopilot.enabled = false;
  }
  const { start } = opened;
  const row = (/** @type {string} */ n) => `${PIECE_MARK} ${n} the parser reads each row to its end and keeps a comma inside quotes.`;
  const file = (/** @type {number} */ i) => Array.from({ length: 16 }, () => row(String(i).padStart(4, "0"))).join("\n");
  // What one read weighs in the conversation, its call and its result, with room for how the result is shown.
  const per = estimateTokens(file(0)) + 120;
  pieces = Array.from({ length: Math.floor((150_000 - start) / per) }, (_, i) => `p${i}.txt`);
  pieces.forEach((path, i) => writeFileSync(join(folder, path), `${file(i)}\n`));
  await followUp(id, sid, "READ THE PIECES");
  const one = await ended(id, sid, 1);
  assert.deepEqual([one.exchanges[1].status, one.exchanges[1].report], ["done", "PIECES READ"], JSON.stringify(one.exchanges[1]));
  assert.ok(Number((await shim.record(String(one.exchanges[1].runId))).context?.estimate) < 170_000, "it ran under the line");
  const asked = asks.length;
  const mark = up.received.length;
  const cfg = (await (await shim.api("/api/state")).json()).config;
  /** @param {number} tokens */
  const windowOf = async (tokens) => {
    const upstreams = cfg.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, pricing: { ...u.pricing, "m-1": { ...u.pricing["m-1"], contextTokens: tokens } } } : u));
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...cfg, upstreams } })).status, 200);
    windowNow = tokens;
  };
  await windowOf(100_000);
  try {
    await followUp(id, sid, "AFTER THE PIECES: go on.");
    const two = await ended(id, sid, 2);
    assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "AFTER PIECES REPORT"], JSON.stringify(two.exchanges[2]));
    assert.deepEqual(asks.slice(asked), ["transcript"], "its own model wrote the summary from the transcript, which the provider took, and its notes and summary fit its room");
    const call = transcriptCall(mark);
    const read = String(textOf(call?.body.messages?.[0]));
    assert.ok(!read.includes("…"), "no piece was cut");
    const weight = wordsWeigh(call?.body.messages);
    const room = Number(call?.body.max_tokens);
    assert.ok(weight <= 0.7 * 100_000 && room >= 0.25 * 100_000 && weight + room <= 100_000, `what one call may read, the rest of the window the reply's: ${weight} + ${room} tokens`);
    const note = read.search(/\[[\d,]+ earlier lines of this conversation are left out here: with them, it did not fit one call of its summarizer\]/);
    const [brief, task] = [read.indexOf("User: <memory>\n"), read.indexOf(`User: ${PIECE_TASK}\n`)];
    assert.ok(brief >= 0 && read.slice(brief).includes(PIECE_RULE), "memory's brief stays");
    assert.ok(task > brief && note > task, `the task stays, and what gave way follows it: ${[brief, task, note]}`);
    assert.ok(!read.includes(row("0000")) && read.includes(row(String(pieces.length - 1).padStart(4, "0"))), "the oldest pieces gave way, the newest stayed");
    const sent = rounds(mark)[0].body.messages;
    assert.ok(!JSON.stringify(sent).includes(PIECE_MARK), "the earlier exchanges gave way");
    assert.match(textOf(sent[0]), /^\[Filament compacted turns 1–2 into the summary below\.[^\n]*\]\nTRANSCRIPT SUMMARY$/);
    const notes = ((await shim.record(String(two.exchanges[2].runId))).changes || []).join("\n");
    assert.match(notes, /agent: its earlier 2 exchanges summarized by m-1, itself, from their transcript, its oldest [\d,]+ lines left out to fit one call — /);
  } finally {
    await windowOf(WINDOW);
  }
});

// The cut transcript cut an earlier summary — the start an earlier give-way left, the conversation's first message — to
// 8,000 characters, as it cuts any message to the agent: the summary written from it lost the earlier one's end. The
// loop's fold keeps an earlier summary whole: it already is the compressed form of what came before it. So does the
// cut transcript now, past the window and after a size refusal alike.
// (fails before: yes — both transcripts held the earlier summary to its first 8,000 characters, its end lost)
// It also said that summary with its lead's word to the model that continues — "Carry on from it … without recapping
// it." — which the loop's fold and the session's compactor leave out: the writer of the new summary is told to carry
// its facts, not to skip them. It is said for what it is, as the compactor says its head (`earlierSummary`).
// (fails before: yes — round 2 of 11-03 kept it whole but under its lead, the word to skip it with it)
test("a follow-up after an earlier give-way: the cut transcript keeps the earlier summary whole and says it for what it is, past the window and after a size refusal", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, KEPT_BRIEF);
  await ended(id, sid, 0);
  assert.ok(LONG_SUMMARY.length > 8_000, "the summary is longer than the cut of what the agent is told");
  wayPast = `${wordsOf(WAY_MARK, 215_000)}${WORDS_END}`;
  const asked = asks.length;
  /** The give-way's transcript among the requests since `mark`, as the summarizer read it. @param {number} mark */
  const readSince = (mark) => String(textOf(transcriptCall(mark)?.body.messages?.[0]));

  // Refused for size: the brief and the first report give way to a long summary, and the retry ends with a report that
  // takes the conversation past the window.
  await followUp(id, sid, "REFUSE FIRST, A LONG SUMMARY");
  const one = await ended(id, sid, 1);
  assert.equal(one.exchanges[1].status, "done", JSON.stringify(one.exchanges[1]));
  assert.deepEqual(asks.slice(asked), ["long summary"]);

  // Past the window, with no room for a fork: the transcript is cut, the report with it, and the summary stays whole.
  const mark2 = up.received.length;
  await followUp(id, sid, "AFTER THE LONG SUMMARY: go on.");
  const two = await ended(id, sid, 2);
  assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "REPORT AFTER THE SUMMARY"], JSON.stringify(two.exchanges[2]));
  assert.ok(!up.received.slice(mark2).some((c) => WHOLE_ASK.test(askOf(c.body?.messages?.at(-1)))), "no fork had room");
  assert.deepEqual(asks.slice(asked), ["long summary", "long summary"]);
  const read2 = readSince(mark2);
  assert.ok(read2.includes(`\n<conversation>\n[The summary an earlier compaction wrote of turn 1]\n${LONG_SUMMARY}\n`), "the earlier summary, whole, said for what it is");
  assert.ok(!read2.includes("Carry on from it") && !read2.includes("without recapping"), "no word to the model that continues");
  assert.ok(read2.includes(`Assistant: ${WAY_MARK}`) && !read2.includes(WORDS_END), "the report, cut");

  // Refused for size again: the summary that start holds stays whole too.
  const mark3 = up.received.length;
  await followUp(id, sid, "REFUSE AGAIN, THE SUMMARY KEPT");
  const three = await ended(id, sid, 3);
  assert.deepEqual([three.exchanges[3].status, three.exchanges[3].report], ["done", "REPORT THE SUMMARY KEPT"], JSON.stringify(three.exchanges[3]));
  assert.deepEqual(asks.slice(asked), ["long summary", "long summary", "long summary"]);
  const read3 = readSince(mark3);
  assert.ok(read3.includes(`\n<conversation>\n[The summary an earlier compaction wrote of turns 1–2]\n${LONG_SUMMARY}\n`), "the earlier summary, whole, said for what it is");
  assert.ok(!read3.includes("Carry on from it") && !read3.includes("without recapping"), "no word to the model that continues");
  const notes = ((await shim.record(String(three.exchanges[3].runId))).changes || []).join("\n");
  assert.match(notes, /agent: its earlier 3 exchanges summarized by m-1, itself, from their transcript — /);
});

// The earlier summary alone outgrows one call of the summary: the window its model is measured by shrank since that
// summary was written (its card edited). Cut, it would lose facts the new summary must carry; sent whole, the call would
// only be refused. Nothing gives way, no call is made, and the follow-up stops at the window, saying why.
// (fails before: no — a guard on the path round 2 of 11-03 built, which only a unit test reached)
test("a follow-up whose earlier summary alone does not fit one call of its summary: nothing gives way, no call is made, and the record says why", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, HUGE_BRIEF);
  await ended(id, sid, 0);
  const asked = asks.length;
  await followUp(id, sid, "REFUSE FIRST, A HUGE SUMMARY");
  const one = await ended(id, sid, 1);
  assert.deepEqual([one.exchanges[1].status, one.exchanges[1].report], ["done", "REPORT BEFORE THE SHRINK"], JSON.stringify(one.exchanges[1]));
  assert.deepEqual(asks.slice(asked), ["huge summary"]);
  const cfg = (await (await shim.api("/api/state")).json()).config;
  /** @param {number} tokens */
  const windowOf = async (tokens) => {
    const upstreams = cfg.upstreams.map((/** @type {any} */ u) => (u.id === "m" ? { ...u, pricing: { ...u.pricing, "m-1": { ...u.pricing["m-1"], contextTokens: tokens } } } : u));
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...cfg, upstreams } })).status, 200);
    windowNow = tokens;
  };
  await windowOf(30_000);
  try {
    const mark = up.received.length;
    await followUp(id, sid, "AFTER THE SHRINK: go on.");
    const two = await ended(id, sid, 2);
    assert.equal(two.exchanges[2].status, "stopped", JSON.stringify(two.exchanges[2]));
    assert.match(String(two.exchanges[2].report), /reached the 30,000-token context window/);
    assert.deepEqual(up.received.slice(mark), [], "no call went out: no fork, no summary, no round");
    assert.deepEqual(asks.slice(asked), ["huge summary"]);
    const notes = ((await shim.record(String(two.exchanges[2].runId))).changes || []).join("\n");
    assert.match(notes, /agent: the conversation is at its line and its earlier exchanges are the bigger part of it, but they could not give way \(their start and their earlier summaries alone do not fit one call of m-1 in its 30,000-token window\)/);
    assert.match(notes, /agent: stopped before round 1 — the request \(≈[\d,]+ tokens with the system prompt and tools\) cannot fit the 30,000-token window even after compaction/);
  } finally {
    await windowOf(WINDOW);
  }
});

// The review of 11-03 (sa_94bd1300, round 5): at the line the longest words gave way first wherever they stood, so the
// newest report, which a summary goes on from, was cut to share the room with an older one kept whole. Older pieces
// give way first: cut, the oldest first, then left out, before the newest exchange is cut.
// (fails before: yes — the newest report was cut, the older one kept whole)
test("a follow-up whose earlier exchanges hold an older long report and a newer one: the older is cut first, the newest stays whole", async () => {
  const id = await newSession("m-1");
  const sid = await launch(id, "two long reports");
  await ended(id, sid, 0);
  await followUp(id, sid, "say THE OLDER REPORT");
  assert.equal((await ended(id, sid, 1)).exchanges[1].status, "done");
  await followUp(id, sid, "say THE NEWER REPORT");
  assert.equal((await ended(id, sid, 2)).exchanges[2].status, "done");
  const asked = asks.length;
  const mark = up.received.length;
  await followUp(id, sid, "AFTER THE TWO REPORTS: go on.");
  const three = await ended(id, sid, 3);
  assert.deepEqual([three.exchanges[3].status, three.exchanges[3].report], ["done", "AFTER TWO REPORT"], JSON.stringify(three.exchanges[3]));
  assert.deepEqual(asks.slice(asked), ["whole failed", "transcript"], "the fork failed at the line; the transcript's summary fit its room");
  const call = transcriptCall(mark);
  const read = String(textOf(call?.body.messages?.[0]));
  assert.ok(read.includes(`Assistant: ${NEWER_REPORT}\n`), "the newest report, whole");
  assert.ok(read.includes(`Assistant: ${OLDER_REPORT.slice(0, 2_000)}…\n`), "the older one, cut to 2,000 characters");
  const { weight, room } = /** @type {{ weight: number, room: number }} */ (rooms.at(-1));
  assert.ok(weight + room <= WINDOW && room >= 0.25 * WINDOW, JSON.stringify(rooms.at(-1)));
  const notes = ((await shim.record(String(three.exchanges[3].runId))).changes || []).join("\n");
  assert.match(notes, /agent: its earlier 3 exchanges summarized by m-1, itself, from their transcript, one of its replies cut to 2,000 characters to fit one call — /);
});

// The review of 11-03 (sa_94bd1300, round 5): a model that writes 8,192 tokens at most was given a transcript of 70% of
// its window, and its notes over all of it did not end within what it can write: no summary came back.
// (fails before: yes — the summary's reply was cut off in its notes, and nothing gave way)
test("a follow-up on a model that writes little: the transcript is held to one whose summary it can write", async () => {
  const id = await newSession("m-short");
  const sid = await launch(id, SHORT_BRIEF);
  await ended(id, sid, 0);
  wayPast = `${wordsOf(WAY_MARK, 215_000)}${WORDS_END}`;
  await followUp(id, sid, "REPORT PAST THE WINDOW");
  assert.equal((await ended(id, sid, 1)).exchanges[1].status, "done");
  const asked = asks.length;
  const mark = up.received.length;
  await followUp(id, sid, "AFTER THE WINDOW: go on.");
  const two = await ended(id, sid, 2);
  assert.deepEqual([two.exchanges[2].status, two.exchanges[2].report], ["done", "AFTER WINDOW REPORT"], JSON.stringify(two.exchanges[2]));
  assert.deepEqual(asks.slice(asked), ["shaped summary"], "its notes and its summary ended within what it writes");
  const call = transcriptCall(mark);
  const { weight, room } = /** @type {{ weight: number, room: number }} */ (rooms.at(-1));
  assert.equal(room, 8_192, "the most it can write");
  assert.equal(Number(call?.body.max_tokens), room);
  assert.ok(weight < 70_000, `a transcript whose summary it can write: ${weight} tokens`);
});

// (fails before: no — a guard on memory's `callModel`, which takes a caller's room where it names a whole one)
test("memory's callModel asks for the room its caller weighed, a whole number of tokens; else for callRoom's", async () => {
  const mem = /** @type {any} */ (shim.app.memory);
  /** @param {any} maxTokens */
  const asked = async (maxTokens) => {
    const mark = up.received.length;
    await mem.callModel({ system: "S", user: "U", model: "m-1", purpose: "compact", ...(maxTokens === undefined ? {} : { maxTokens }) });
    return Number(up.received.slice(mark).at(-1)?.body.max_tokens);
  };
  const own = await asked(undefined);
  assert.ok(own > 100_000, `callRoom's: ${own}`);
  assert.deepEqual([await asked(1234.7), await asked(0), await asked(-5), await asked(Number.NaN)], [1234, own, own, own]);
});
