// @ts-check
// HarnessV3-AtHome AH-D9 (a), step 1: the summary's shape. Every summary Filament asks a model for (the call over a
// transcript, the fork of a session's warm cache, the agent loop's fork of a turn's rounds) names the nine sections
// Claude Code's own compaction keeps, in our words, and asks for an <analysis> block first. The notes are dropped and
// only the summary is stored; they are written all the same, so a writer is priced for them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SUMMARY_SHAPE, COMPACTION_SYSTEM, compactionPrompt, summarize, summaryOfReply, writtenTokens, summaryLead, summaryLeadOf, roundsLead, roundsSummaryOf, earlierSummary, earlierOf, leadOf, ownLeadOf, messagesTranscript, summaryReading, transcriptWithin, SUMMARY_ACK, ROUNDS_LINE } from "../src/app/sessions/compaction.js";
import { FORK_NOTE, forkMessages, forkTaskAt, opensForkTask } from "../src/app/agent/subagents.js";
import { summaryCallRoom } from "../src/app/sessions/compactor.js";
import { chooseWriter, roundsForkInstruction, FORK_SUMMARY_INSTRUCTION, FORK_INSTRUCTION_TOKENS } from "../src/app/sessions/compactor.js";
import { cutWeights, estimateTokens, textWeight } from "../src/core/tokens.js";
import { COMPACTION_PROMPT_RE } from "../src/core/trim.js";

const SECTIONS = ["Request and intent", "Key concepts", "Files and code", "Errors and fixes", "Problem solving", "The user's messages", "Pending tasks", "Current work", "Next step"];

describe("AH-D9 step 1: the summary's shape", () => {
  // (fails before: yes — there was no shape: the prompt asked in one sentence for what the user asked, what was done
  // and what is open, and put the transcript after it)
  test("the shape: notes in an analysis block first, then the summary under nine numbered headings, in order", () => {
    const at = (/** @type {string} */ s) => SUMMARY_SHAPE.indexOf(s);
    assert.ok(at("<analysis>") >= 0 && at("<analysis>") < at("<summary>"), "the notes come before the summary");
    let prev = at("<summary>");
    SECTIONS.forEach((name, i) => {
      const here = at(`\n${i + 1}. ${name}:`);
      assert.ok(here > prev, `section ${i + 1}, ${name}, after the one before it`);
      prev = here;
    });
    assert.match(SUMMARY_SHAPE, /dropped, and only the summary is kept/, "the writer is told its notes are not kept");
    // The call over a transcript: the conversation first, in its own tags, and the shape after it.
    const p = compactionPrompt("## Turn 1\nUser: fix the login bug");
    assert.ok(p.includes("<conversation>\n## Turn 1\nUser: fix the login bug\n</conversation>"), p);
    assert.ok(p.indexOf("</conversation>") < p.indexOf(SUMMARY_SHAPE), "the shape follows the conversation");
  });

  // (fails before: yes — there was no summaryOfReply: a reply was stored as it came)
  test("summaryOfReply keeps the summary and drops the notes; a reply without tags is kept whole", () => {
    assert.equal(summaryOfReply("<analysis>\nnotes\n</analysis>\n\n<summary>\n1. Request and intent: X\n</summary>"), "1. Request and intent: X");
    assert.equal(summaryOfReply("A plain summary."), "A plain summary.", "no tags: the reply is the summary");
    assert.equal(summaryOfReply("<summary>S</summary>"), "S", "a summary with no notes");
    assert.equal(summaryOfReply("<analysis>notes</analysis>\nThe summary, untagged."), "The summary, untagged.", "notes, then a summary without its tags");
    assert.equal(summaryOfReply("<analysis>notes cut off by the reply's room"), "", "notes that never end: no summary, so the caller falls back as for an empty reply");
    assert.equal(summaryOfReply("<analysis>a</analysis>\n<summary>\nS, cut off"), "S, cut off", "a summary cut off keeps what was written");
    assert.equal(summaryOfReply("Here it is.\n<analysis>a</analysis>\n<summary>S</summary>\nAnything else?"), "S", "chatter around the blocks is not the summary");
    // A session working on Filament's own compaction code quotes the tags: they do not cut the summary short.
    const quoting = "3. Files and code: compaction.js, where `summaryOfReply` keeps the `<summary>` block up to its `</summary>`.\n4. Errors and fixes: the writer's `<analysis>` notes leaked; fixed.";
    assert.equal(summaryOfReply(`<analysis>\nnotes on the \`</analysis>\` tag\n</analysis>\n<summary>\n${quoting}\n</summary>`), quoting);
    assert.equal(summaryOfReply(quoting), quoting, "untagged, a tag quoted inside a line opens no block");
    // (fails before: no — added for the mutant that ended the notes at their first close) notes that quote the close
    // tag and later name the summary's open tag at the start of a line end at the close the summary follows
    const parserNotes = "<analysis>\nThe parser cuts at </analysis> when it sees one.\nIt also looks for\n<summary> at the start of a line.\n</analysis>\n<summary>\nThe real summary.\n</summary>";
    assert.equal(summaryOfReply(parserNotes), "The real summary.");
    assert.equal(summaryOfReply(null), "");
  });

  // (fails before: yes — the reply was returned as it came, notes and tags included)
  test("summarize asks with the brief and the shape, and returns the summary alone", async () => {
    /** @type {any[]} */
    const calls = [];
    const memory = {
      callModel: async (/** @type {any} */ o) => {
        calls.push(o);
        return "<analysis>\nturn 1 asked for the login fix\n</analysis>\n<summary>\n1. Request and intent: fix the login bug.\n</summary>";
      },
    };
    const text = await summarize(memory, { transcript: "## Turn 1\nUser: fix the login bug", model: "m", chainId: "c1" });
    assert.equal(text, "1. Request and intent: fix the login bug.");
    assert.equal(calls[0].system, COMPACTION_SYSTEM);
    assert.ok(String(calls[0].user).includes(SUMMARY_SHAPE));
    assert.deepEqual([calls[0].model, calls[0].purpose, calls[0].chainId], ["m", "compact", "c1"]);
    // (fails before: yes — the summary was capped at 20,000 tokens: HarnessV3-FailurePoints §13)
    assert.ok(!("maxTokens" in calls[0]), "no cap: the call asks for all the model can write");
  });

  // (fails before: yes — the fork and the rounds fork asked for "the summary text only" with no shape, and the fork's
  // instruction was weighed at a flat 300 tokens)
  test("the fork's and the rounds fork's instructions carry the shape; the fork's instruction weighs what it is", () => {
    const tail = "Do not call any tool: answer with the analysis and the summary only.]";
    for (const ins of [FORK_SUMMARY_INSTRUCTION, roundsForkInstruction(2), roundsForkInstruction(1, "manual")]) {
      assert.ok(ins.includes(SUMMARY_SHAPE), ins.slice(0, 80));
      assert.ok(ins.endsWith(tail), ins.slice(-120));
    }
    assert.equal(FORK_INSTRUCTION_TOKENS, estimateTokens(FORK_SUMMARY_INSTRUCTION));
  });

  // (fails before: no — a guard: an instruction Filament writes that read as a client's compaction request would have
  // Filament's own fork answered by /trim, as if a client had asked)
  test("no instruction Filament writes reads as a client's compaction request", () => {
    for (const ins of [SUMMARY_SHAPE, compactionPrompt("x"), FORK_SUMMARY_INSTRUCTION, roundsForkInstruction(2), roundsForkInstruction(2, "manual")])
      assert.doesNotMatch(ins, COMPACTION_PROMPT_RE);
    assert.doesNotMatch(roundsForkInstruction(2, "manual"), /compaction line/, "a manual Compact never reached the line");
  });

  // (fails before: yes — a writer was priced for the summary alone, as if it wrote no notes)
  test("a writer is priced for what it writes: the notes and the summary", () => {
    const pricing = { big: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, cheap: { input: 1, output: 10 } };
    const cfg = { rules: {}, routes: [{ match: "big", upstream: "u" }, { match: "cheap", upstream: "u" }], upstreams: [{ id: "u", type: "openai-compatible", baseUrl: "http://u", pricing }] };
    const doc = (/** @type {any} */ compaction) => ({ context: { compaction } });
    assert.equal(writtenTokens(5000), 10_000, "the notes assumed as long as the summary");
    const named = chooseWriter({ cfg, doc: doc({ writer: "model", model: "cheap" }), sessionModel: "big", cache: null, transcriptTokens: 100_000, outTokens: 5000 }).chosen;
    assert.equal(named?.cost, (100_000 * 1 + 10_000 * 10) / 1e6);
    const warm = { state: /** @type {const} */ ("warm"), leftMs: 60_000, tokens: 100_000, model: "big" };
    const fork = chooseWriter({ cfg, doc: doc({ writer: "session" }), sessionModel: "big", cache: warm, transcriptTokens: 100_000, outTokens: 5000 }).chosen;
    assert.equal(fork?.fork, true);
    assert.equal(fork?.cost, Math.round(((100_000 * 0.5 + FORK_INSTRUCTION_TOKENS * 6.25 + 10_000 * 25) / 1e6) * 1e6) / 1e6);
  });
});

// AH-D9 (c), step 2: the line a summary leads with. At the head of a history the model continues from, it says Filament
// compacted those turns (or rounds) into the summary below, and to carry on without recapping it. In a transcript a
// new summary is written from, an earlier summary is only said for what it is, so the writer carries its facts.
describe("AH-D9 step 2: the leads", () => {
  // (fails before: yes — the leads said "[Summary of turns 1–3, compacted by Filament — the conversation continues from
  // it]", and the rounds lead said "at the compaction line" on the developer's own Compact too)
  test("a summary at the head of a history: who compacted what, and carry on without recapping it", () => {
    assert.equal(summaryLead(1, 3, " S "), "[Filament compacted turns 1–3 into the summary below. Carry on from it where the conversation stands, without recapping it.]\nS");
    assert.equal(summaryLead(4, 4, "S"), "[Filament compacted turn 4 into the summary below. Carry on from it where the conversation stands, without recapping it.]\nS");
    assert.equal(roundsLead(1, 4, "S"), "[Filament compacted rounds 1–4 of this turn into the summary below. Carry on from it where the work stands, without recapping it.]\nS");
    assert.equal(roundsLead(3, 3, "S"), "[Filament compacted round 3 of this turn into the summary below. Carry on from it where the work stands, without recapping it.]\nS");
  });

  // (fails before: yes — the loop knew its earlier summary by the old lead's first words, and a transcript carried an
  // earlier summary under the lead the continuing model reads)
  test("the loop knows its earlier summary by one predicate; a transcript says an earlier summary for what it is", () => {
    assert.equal(roundsSummaryOf(roundsLead(1, 4, "S\nmore")), "S\nmore", "the summary, without its lead");
    assert.equal(roundsSummaryOf(roundsLead(2, 2, "S")), "S");
    assert.equal(roundsSummaryOf(summaryLead(1, 3, "S")), null, "a turns summary is no rounds summary");
    assert.equal(roundsSummaryOf("a steering note"), null);
    assert.equal(earlierSummary(1, 3, " S "), "[The summary an earlier compaction wrote of turns 1–3]\nS");
    assert.equal(earlierSummary(2, 2, "S"), "[The summary an earlier compaction wrote of turn 2]\nS");
  });

  // (fails before: no — a guard: memory reads "continued from a previous conversation" as a client's compaction, and
  // the client-compaction detector must never fire on Filament's own words)
  test("no lead reads as a client's compaction or its continuation", () => {
    for (const s of [summaryLead(1, 3, "S"), roundsLead(1, 4, "S"), earlierSummary(1, 3, "S")]) {
      assert.doesNotMatch(s, COMPACTION_PROMPT_RE);
      assert.doesNotMatch(s, /continued from a previous|summary of the conversation so far/i);
    }
  });
});

// A side agent's earlier exchanges give way from their transcript (turn.js `exchangesGiveWay`); pieces each under their
// cut can add up past what one call of its summary holds.
// (fails before: yes — there was no `transcriptWithin`; the transcript went as it was, whatever its size)
describe("transcriptWithin: a transcript one call holds", () => {
  const convo = [
    { role: "user", content: "the brief" },
    { role: "assistant", content: [{ type: "text", text: "one" }, { type: "tool_use", id: "t1", name: "read", input: { path: "a.txt" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "row one" }] },
    { role: "assistant", content: [{ type: "text", text: "two" }] },
    { role: "user", content: "and then" },
    { role: "assistant", content: [{ type: "text", text: "the newest" }] },
  ];
  /** What lines weigh joined: each line's runs, summed, rounded up once. @param {string[]} lines */
  const lineSum = (lines) => Math.ceil(lines.reduce((n, l) => n + textWeight(l), 0));
  /** @param {number} n */
  const leftLine = (n) => `[${n} earlier ${n === 1 ? "line of this conversation is" : "lines of this conversation are"} left out here: with them, it did not fit one call of its summarizer]`;

  test("whole where it fits: messagesTranscript's own text, nothing left out or cut", () => {
    assert.deepEqual(transcriptWithin(convo, Infinity), { text: messagesTranscript(convo), left: 0, cuts: [] });
    assert.deepEqual(transcriptWithin(convo, Infinity, { grow: true }), { text: messagesTranscript(convo), left: 0, cuts: [] });
  });

  /** Words long enough that leaving them out weighs less than the line that says so. @param {string} s */
  const sized = (s) => `${s} ${"w".repeat(600)}`;
  const longer = [
    { role: "user", content: "the brief" },
    { role: "assistant", content: [{ type: "text", text: sized("one") }, { type: "tool_use", id: "t1", name: "read", input: { path: "a.txt" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: sized("row one") }] },
    { role: "assistant", content: [{ type: "text", text: sized("two") }] },
    { role: "user", content: "and then" },
    { role: "assistant", content: [{ type: "text", text: sized("the newest") }] },
  ];

  test("else the fewest of the oldest lines after the start left out, a line in their place saying how many", () => {
    const kept = ["User: the brief", leftLine(3), `Assistant: ${sized("two")}`, "", "User: and then", `Assistant: ${sized("the newest")}`];
    const got = transcriptWithin(longer, lineSum(kept));
    assert.equal(got?.left, 3, "the first answer, its call and its result");
    assert.equal(got?.text, kept.join("\n"));
    assert.ok(estimateTokens(String(got?.text)) <= lineSum(kept), "built once, it holds what it was found to");
    assert.equal(transcriptWithin(convo, estimateTokens(messagesTranscript(convo)))?.left, 0, "where the line saying so weighs more than the lines, none go");
  });

  test("null where nothing more may give way", () => {
    const start = ["User: the brief", leftLine(6)];
    assert.deepEqual(transcriptWithin(longer, lineSum(start)), { text: start.join("\n"), left: 6, cuts: [] }, "every line after the start that says something");
    assert.equal(transcriptWithin(longer, lineSum(start) - 1), null, "the start alone does not fit");
    assert.equal(transcriptWithin([{ role: "user", content: "only" }], 0), null);
  });

  // The review of 11-03 (sa_94bd1300, round 5): at the line the longest words were cut first wherever they stood, so a
  // newest report was cut while every older line stayed; and once lines went, every piece went to READING_CUT with them.
  // The newest exchange gives way last: older pieces are cut, the oldest first, then left out, before it is cut.
  // (fails before: yes — the newest report was cut to share the room with older lines, every one of which stayed)
  describe("at the line the newest exchange gives way last", () => {
    const small = (/** @type {number} */ i) => `OLD-${String(i).padStart(3, "0")} ${"o".repeat(1_500)}`;
    /** A brief, `n` older exchanges of small pieces, then the newest: its message and a report. @param {number} n @param {string} report */
    const talk = (n, report) => [
      { role: "user", content: "the brief" },
      ...Array.from({ length: n }, (_, i) => [{ role: "assistant", content: small(i) }, { role: "user", content: `next ${i}` }]).flat(),
      { role: "assistant", content: "OLDEST-OF-THE-NEWEST" },
      { role: "user", content: "THE NEWEST ASK" },
      { role: "assistant", content: report },
    ];
    const whole = (/** @type {any[]} */ m) => estimateTokens(messagesTranscript(m));
    test("(a) older pieces weigh more than the room leaves the report: the oldest lines go, the report stays whole", () => {
      const report = `NEWEST ${"n".repeat(40_000)} NEWEST-END`;
      const m = talk(40, report);
      const limit = Math.floor(whole(m) * 0.75);
      const got = transcriptWithin(m, limit, { grow: true });
      assert.ok(got && estimateTokens(got.text) <= limit, "it fits");
      assert.ok(got.text.includes(`Assistant: ${report}`), "the newest report, whole");
      assert.ok(got.text.includes("User: THE NEWEST ASK") && got.text.startsWith("User: the brief\n"), "its ask and the start, whole");
      assert.ok(got.left > 0 && !got.text.includes("OLD-000 ") && got.text.includes("OLD-039 "), "the oldest lines left out, the newest of the older kept");
      assert.deepEqual(got.cuts, [], "nothing cut: the older pieces are under their cut");
    });
    test("(b) older pieces outweigh the room: the report stays whole and only the older lines go", () => {
      const report = `NEWEST ${"n".repeat(8_000)} NEWEST-END`;
      const m = talk(80, report);
      const limit = Math.floor(whole(m) * 0.5);
      const got = transcriptWithin(m, limit, { grow: true });
      assert.ok(got && estimateTokens(got.text) <= limit);
      assert.ok(got.text.includes(`Assistant: ${report}`), "not cut to 2,000 characters with the lines that went");
      assert.ok(got.left > 0 && got.left < 2 * 80);
    });
    test("an older long piece is cut first, the oldest first, as few as fit; the newest stays whole", () => {
      const older = `OLDER-REPORT ${"x".repeat(20_000)}`;
      const report = `NEWEST ${"n".repeat(20_000)} NEWEST-END`;
      const m = [{ role: "user", content: "the brief" }, { role: "assistant", content: older }, { role: "user", content: "THE NEWEST ASK" }, { role: "assistant", content: report }];
      const got = transcriptWithin(m, Math.floor(whole(m) * 0.6), { grow: true });
      assert.ok(got?.text.includes(`Assistant: ${older.slice(0, 2_000)}…\n`) && got.text.endsWith(`Assistant: ${report}`));
      assert.deepEqual([got?.left, got?.cuts], [0, [{ of: "agent", to: 2_000, count: 1 }]]);
    });
    test("the newest is cut only once everything older is gone, to the longest length that fits, its ask kept at four times that", () => {
      const ask = `THE NEWEST ASK ${"a".repeat(12_000)}`;
      const report = `NEWEST ${"n".repeat(60_000)} NEWEST-END`;
      const m = [...talk(3, "x").slice(0, -2), { role: "user", content: ask }, { role: "assistant", content: report }];
      const limit = Math.floor(estimateTokens(`User: the brief\nUser: ${ask}\nAssistant: ${report}`) * 0.5);
      const got = transcriptWithin(m, limit, { grow: true });
      const to = Number(got?.cuts.find((c) => c.of === "agent")?.to);
      assert.ok(got && estimateTokens(got.text) <= limit && to > 2_000, JSON.stringify(got?.cuts));
      assert.equal(got.left, 7, "every older line that may go");
      assert.ok(got.text.includes(`Assistant: ${report.slice(0, to)}…`));
      assert.ok(got.text.includes(`User: ${ask}\n`) || got.text.includes(`User: ${ask.slice(0, to * 4)}…\n`), "what it was told, at four times the agent's own");
    });
    test("after a size refusal, everything cut as READING_CUT cuts, then the oldest lines left out", () => {
      const report = `NEWEST ${"n".repeat(8_000)} NEWEST-END`;
      const m = talk(80, report);
      const limit = Math.floor(whole(m) * 0.5);
      const got = transcriptWithin(m, limit);
      assert.ok(got && estimateTokens(got.text) <= limit);
      assert.ok(got.text.endsWith(`Assistant: ${report.slice(0, 2_000)}…`), "the report too, to 2,000 characters");
      assert.ok(got.left > 0 && !got.text.includes("OLD-000 "));
      assert.deepEqual(got.cuts, [{ of: "agent", to: 2_000, count: 1 }]);
    });
  });

  // The review of 11-03 (sa_c60bdc92, round 6): what was cut counted the lines left out too — two replies "cut to
  // 2,000 characters" where neither was in the transcript — and a text of 2,001 characters, which `cut` keeps whole.
  // (fails before: yes — the note named cuts of lines that went, and of a text kept whole)
  test("what was cut counts the words kept, cut where `cut` drops something", () => {
    const m = [
      { role: "user", content: "the brief" },
      { role: "assistant", content: `OLD-A ${"a".repeat(20_000)}` },
      { role: "user", content: "more" },
      { role: "assistant", content: `OLD-B ${"b".repeat(20_000)}` },
      { role: "user", content: "THE NEWEST ASK" },
      { role: "assistant", content: `NEWEST ${"n".repeat(1_500)}` },
    ];
    const got = transcriptWithin(m, 900);
    assert.ok(got && got.left === 3 && !got.text.includes("OLD-"), String(got?.text).slice(0, 300));
    assert.deepEqual(got.cuts, [], "nothing kept was cut");
    const line = [{ role: "user", content: "the brief" }, { role: "assistant", content: `OLD ${"o".repeat(20_000)}` }, { role: "user", content: "THE NEWEST ASK" }, { role: "assistant", content: `NEWEST ${"n".repeat(40_000)} END` }];
    const atLine = transcriptWithin(line, Math.floor(estimateTokens(`User: the brief\nUser: THE NEWEST ASK\nAssistant: NEWEST ${"n".repeat(40_000)}`) * 0.6), { grow: true });
    assert.ok(atLine && atLine.left === 1 && !atLine.text.includes("OLD "));
    assert.deepEqual(atLine.cuts.map((c) => c.of), ["agent"], "the newest report alone, not the older one that went");
    const edge = [{ role: "user", content: "the brief" }, { role: "assistant", content: "x".repeat(2_001) }, { role: "user", content: "then" }, { role: "assistant", content: "y".repeat(2_002) }];
    const read = transcriptWithin(edge, Infinity);
    assert.ok(read?.text.includes(`Assistant: ${"x".repeat(2_001)}\n`) && read.text.endsWith(`Assistant: ${"y".repeat(2_000)}…`));
    assert.deepEqual(read?.cuts, [{ of: "agent", to: 2_000, count: 1 }], "2,001 characters kept whole; 2,002 cut");
  });

  // The review of 11-03 (sa_c60bdc92, round 6): with the task cut, the first way tried cut the newest exchange to
  // READING_CUT, where the task cut and the newest whole fit.
  // (fails before: yes — the newest report was cut to 2,000 characters beside a cut task)
  test("at the line, once the task is cut the newest exchange still gives way last", () => {
    const task = `TASK ${"k".repeat(40_000)}`;
    const report = `NEWEST ${"n".repeat(10_000)} NEWEST-END`;
    const m = [{ role: "user", content: task }, { role: "assistant", content: "short" }, { role: "user", content: "THE NEWEST ASK" }, { role: "assistant", content: report }];
    const limit = estimateTokens(`User: ${task.slice(0, 8_000)}…\nAssistant: short\n\nUser: THE NEWEST ASK\nAssistant: ${report}`) + 2;
    const got = transcriptWithin(m, limit, { grow: true });
    assert.ok(got?.text.endsWith(`Assistant: ${report}`), "the newest report, whole");
    assert.deepEqual(got?.cuts, [{ of: "task", to: 8_000, count: 1 }]);
  });

  // The review of 11-03 (sa_c60bdc92, round 6): a reply cut at its ceiling leaves Filament's note in a message of its
  // own within the work (loop.js), and the newest exchange started there: the follow-up's ask and the reply's first part
  // read as older, and were cut before anything else.
  // (fails before: yes — the newest report's first part was cut, the older reply kept)
  test("the newest exchange starts at the newest message of someone's words, not at a note of Filament's", () => {
    const note = "[Filament: your reply was cut at the most it may write, mid-sentence. Go on from where you were.]";
    const ask = `THE NEWEST ASK ${"q".repeat(9_000)}`;
    const part = `PART-ONE ${"p".repeat(20_000)}`;
    const rest = `PART-TWO ${"r".repeat(20_000)}`;
    const older = `OLDER ${"o".repeat(30_000)}`;
    const m = [{ role: "user", content: "the brief" }, { role: "assistant", content: older }, { role: "user", content: ask }, { role: "assistant", content: part }, { role: "user", content: [{ type: "text", text: note }] }, { role: "assistant", content: rest }];
    const newest = [`User: ${ask}`, `Assistant: ${part}`, "", `User: ${note}`, `Assistant: ${rest}`];
    const limit = Math.ceil(textWeight(["User: the brief", "[1 earlier line of this conversation is left out here: with them, it did not fit one call of its summarizer]", "", ...newest].join("\n"))) + 3;
    const got = transcriptWithin(m, limit, { grow: true });
    assert.ok(got?.text.endsWith(newest.join("\n")), "the ask and both parts of the reply, whole");
    assert.deepEqual([got?.left, got?.cuts], [1, []], "the older reply went first");
  });

  // (fails before: yes — guard: the task picked as a start's last words was a note of Filament's riding after it)
  test("a start's task is its last words that are not one of Filament's own blocks", () => {
    const task = `TASK ${"k".repeat(9_000)} TASK-END`;
    const m = [{ role: "user", content: [{ type: "text", text: task }, { type: "text", text: "[Filament: your reply was cut at its ceiling.]" }] }, { role: "assistant", content: "done" }];
    assert.ok(transcriptWithin(m, Infinity)?.text.includes(`User: ${task}\n`), "the task, whole");
  });

  // The review of 11-03 (sa_c60bdc92, round 6): the newest exchange's words were weighed cut by their average rate a
  // character; a report dense at its start (CJK, then prose) weighed far more cut than that said, the retries ran out,
  // and nothing was read, as if the start alone did not fit.
  // (fails before: yes — null)
  test("a report dense at its start is cut by what its start weighs, and the reading fits", () => {
    const report = `${"漢".repeat(20_000)} ${"prose ".repeat(40_000)}`;
    const m = [{ role: "user", content: "the brief" }, { role: "assistant", content: "earlier" }, { role: "user", content: "THE NEWEST ASK" }, { role: "assistant", content: report }];
    const got = transcriptWithin(m, 8_000, { grow: true });
    const to = Number(got?.cuts[0]?.to);
    assert.ok(got && estimateTokens(got.text) <= 8_000 && to > 2_000 && to < 8_000, JSON.stringify({ cuts: got?.cuts, left: got?.left }));
    assert.ok(got.text.includes(`Assistant: ${report.slice(0, to)}…`), "its start, as long as fits");
    assert.ok(estimateTokens(got.text) > 7_900, "and as long as the room allows");
  });

  // (fails before: yes — there was no cutWeights; a cut was weighed by its piece's average rate a character)
  test("cutWeights weighs every cut of a text as textWeight weighs the text cut, its ellipsis with it", () => {
    const s = "漢字かな 1234 abc-- --x  {\"k\": [1, 2]}\n\n  words   and…more 漢字 ### the end";
    const at = cutWeights(s);
    for (let n = 1; n < s.length; n++) assert.equal(at(n), textWeight(`${s.slice(0, n)}…`), `cut after ${n}: ${JSON.stringify(s.slice(0, n))}`);
  });

  // The review of 11-03 (sa_94bd1300, round 5): the note said "its longest words cut to 2,000 characters" wherever the
  // way that fit could cut — where only the task was cut, or only words told over 8,000.
  // (fails before: yes — the reading said a cut length, not what was cut)
  test("what was cut is said exactly: whose words, to how many characters, how many of them", () => {
    const task = `TASK ${"k".repeat(30_000)}`;
    const m = [{ role: "user", content: task }, { role: "assistant", content: "short" }, { role: "user", content: "then" }, { role: "assistant", content: "done" }];
    const got = transcriptWithin(m, Math.floor(estimateTokens(task) * 0.4));
    assert.deepEqual(got?.cuts, [{ of: "task", to: 8_000, count: 1 }], "only the task");
    const told = `TOLD ${"t".repeat(30_000)}`;
    const m2 = [{ role: "user", content: "the brief" }, { role: "assistant", content: "short" }, { role: "user", content: told }, { role: "assistant", content: "done" }];
    assert.deepEqual(transcriptWithin(m2, Math.floor(estimateTokens(told) * 0.5))?.cuts, [{ of: "told", to: 8_000, count: 1 }], "only what it was told");
  });

  // The review of 11-03 (sa_94bd1300): the line kept first was the first message's first block — memory's brief, a view
  // of the session, where its opening holds one — and its task, its last block, went with the oldest lines.
  // (fails before: yes — the halving left out the task and kept the brief ahead of it)
  test("its start stays as one: every block of its first message kept, its background cut as words told are, its task whole; the task cut only where nothing else can give way", () => {
    const memory = `<memory>\nMEMORY ${"m".repeat(9_000)}\n</memory>`;
    const note = "[Filament: you work in your own git worktree.]";
    const task = `TASK ${"k".repeat(9_000)} TASK-END`;
    const opened = [
      { role: "user", content: [{ type: "text", text: memory }, { type: "text", text: note }, { type: "text", text: task }] },
      { role: "assistant", content: `OLD-WORK ${"o".repeat(1_000)}` },
      { role: "user", content: "and then" },
      { role: "assistant", content: "the newest" },
    ];
    const start = [`User: ${memory.slice(0, 8_000)}…`, `User: ${note}`, `User: ${task}`];
    const kept = transcriptWithin(opened, lineSum([...start, leftLine(2), "Assistant: the newest"]));
    assert.deepEqual([kept?.left, kept?.cuts], [2, [{ of: "told", to: 8_000, count: 1 }]]);
    assert.equal(kept?.text, [...start, leftLine(2), "Assistant: the newest"].join("\n"));
    const last = transcriptWithin(opened, lineSum([start[0], start[1], `User: ${task.slice(0, 8_000)}…`, leftLine(3)]));
    assert.deepEqual([last?.left, last?.cuts.map((c) => c.of)], [3, ["told", "task"]], "the task cut, as the words told are, once nothing else could give way");
    assert.ok(last?.text.startsWith(`User: ${memory.slice(0, 8_000)}…\nUser: ${note}\nUser: ${task.slice(0, 8_000)}…\n[3 earlier lines`), String(last?.text).slice(0, 200));
  });

  // (fails before: yes — a fork's first line was the main chat's first message, and its own task went with the oldest lines)
  // The review of 11-03 (sa_94bd1300, round 5): a fork's task joined by a note after it — the loop's, of a reply cut at
  // its ceiling, which rides the newest message — was its task no more: the note was its last words.
  // (fails before: yes — forkTaskAt read the message's last words alone, and found the note)
  test("a fork's start is the message its own task joined after the main agent's messages, while it stands there", () => {
    const main = [{ role: "user", content: sized("MAIN-BRIEF") }, { role: "assistant", content: sized("MAIN-ANSWER") }, { role: "user", content: "THE-PERSON-NEWEST" }];
    const instruction = `${FORK_NOTE}\n\nTHE-FORK-TASK`;
    const forked = forkMessages(main, instruction);
    assert.equal(forkTaskAt(forked, 3), 2, "joined the main agent's newest message, the person's");
    assert.equal(forkTaskAt(forkMessages(main.slice(0, 2), instruction), 2), 2, "after the main agent's answer: a message of its own");
    const convo = [...forked, { role: "assistant", content: sized("FORK-WORK") }, { role: "user", content: "FOLLOW-UP" }, { role: "assistant", content: "FORK-REPORT" }];
    const at = forkTaskAt(convo, 3);
    const keep = [leftLine(3), "User: THE-PERSON-NEWEST", `User: ${instruction}`, "", "User: FOLLOW-UP", "Assistant: FORK-REPORT"];
    const got = transcriptWithin(convo, lineSum(keep), { start: at, isTask: opensForkTask });
    assert.equal(got?.left, 3, "the main agent's two messages, then the fork's oldest work");
    assert.equal(got?.text, keep.join("\n"));
    const gaveWay = [{ role: "user", content: summaryLead(1, 1, "S") }, { role: "assistant", content: SUMMARY_ACK }, { role: "user", content: "FOLLOW-UP" }, { role: "assistant", content: "R" }];
    assert.equal(forkTaskAt(gaveWay, 3), -1, "an earlier give-way's start took the main agent's messages' place");
    const cut = "[Filament: your reply was cut at its ceiling. Go on from where you were.]";
    const noted = forked.map((m, i) => (i === 2 ? { ...m, content: [...m.content, { type: "text", text: cut }] } : m));
    assert.equal(forkTaskAt(noted, 3), 2, "a note after its task: its task still");
    const long = noted.map((m, i) => (i === 2 ? { ...m, content: m.content.map((/** @type {any} */ b) => (b.text === instruction ? { ...b, text: `${instruction} ${"w".repeat(9_000)}` } : b)) } : m));
    const read = transcriptWithin(long, Infinity, { start: 2, isTask: opensForkTask });
    assert.ok(read?.text.includes(`User: ${instruction} ${"w".repeat(9_000)}\n`), "the task named by its note kept whole, not the note after it");
  });

  const headText = `HEAD ${"h".repeat(9_000)} HEAD-END`;
  const foldText = `FOLD ${"f".repeat(9_000)} FOLD-END`;
  const toldText = `told ${"t".repeat(9_000)}`;
  const earlier = [
    { role: "user", content: [{ type: "text", text: summaryLead(1, 2, headText) }] },
    { role: "assistant", content: [{ type: "text", text: SUMMARY_ACK }] },
    { role: "user", content: toldText },
    { role: "assistant", content: [{ type: "text", text: ROUNDS_LINE }] },
    { role: "user", content: [{ type: "text", text: roundsLead(1, 3, foldText) }] },
    { role: "assistant", content: [{ type: "text", text: "the newest" }] },
  ];
  /** The head and the fold as the next summary's writer reads them. */
  const head = `[The summary an earlier compaction wrote of turns 1–2]\n${headText}`;
  const fold = `Summary of earlier rounds:\n${foldText}`;

  // (fails before: yes — an earlier summary was cut to the told words' cut like any message to the agent, and the
  // halving left out a fold's summary of an exchange's rounds with the lines around it)
  test("an earlier summary is kept whole: no cut reaches it, and the halving leaves out the lines around it, never it", () => {
    const cut = /** @type {{ text: string, left: number }} */ (transcriptWithin(earlier, Infinity));
    assert.ok(cut.text.includes(head) && cut.text.includes(fold), "both summaries whole");
    assert.ok(cut.text.includes(`User: ${toldText.slice(0, 8_000)}…`), "a message to the agent, cut");
    assert.equal(summaryReading(earlier, 2000, 2000, 8000), cut.text);
    const kept = [head, leftLine(3), "", fold, "Assistant: the newest"];
    const left = /** @type {{ text: string, left: number }} */ (transcriptWithin(earlier, lineSum(kept)));
    assert.equal(left.left, 3, "the acknowledgment, the message and the fold's line");
    assert.equal(left.text, kept.join("\n"));
    assert.equal(transcriptWithin(earlier, lineSum([head, fold])), null, "the summaries alone, with the line that would say what went, do not fit: nothing gives way");
  });

  // (fails before: yes — the reading said each summary under its lead, "Carry on from it … without recapping it.": the
  // word to the model that continues, which the loop's fold and the session's compactor leave out)
  test("an earlier summary is said for what it is, as the compactor says its head and the loop's fold an earlier fold", () => {
    const read = summaryReading(earlier);
    assert.equal(read, [head, `Assistant: ${SUMMARY_ACK}`, "", `User: ${toldText}`, `Assistant: ${ROUNDS_LINE}`, "", fold, "Assistant: the newest"].join("\n"));
    assert.equal(head, earlierSummary(1, 2, headText), "the compactor's words for its head");
    assert.doesNotMatch(read, /Carry on from it|without recapping/);
    assert.equal(transcriptWithin(earlier, Infinity, { grow: true })?.text, read, "the transcript reads them the same way");
    assert.match(messagesTranscript(earlier), /^User: \[Filament compacted turns 1–2 into the summary below\. Carry on/, "a sub-agent's view of its session is no summary's reading: as it was");
  });

  // The review of 11-03 (sa_94bd1300): a coding agent's own summary at the head of a history (`leadOf`) passed for no
  // summary, and was cut and left out as a message to the agent.
  // (fails before: yes — read as the words of a message, its lead to the continuing model with it)
  test("a coding agent's own head is read back as leadOf writes it, and said as earlierOf says it", () => {
    const own = { from_turn: 1, to_turn: 3, text: `AGENT ${"a".repeat(9_000)} AGENT-END`, method: "own", detail: { by: "Claude Code" } };
    const lead = leadOf(own);
    assert.deepEqual(ownLeadOf(lead), { who: "Claude Code", standsFor: "turns 1–3", text: own.text });
    assert.equal(summaryReading([{ role: "user", content: lead }]), earlierOf(own));
    assert.ok(transcriptWithin([{ role: "user", content: lead }, { role: "assistant", content: "R" }], Infinity)?.text.includes("AGENT-END"), "whole, as an earlier summary is");
    assert.equal(ownLeadOf(lead.replace("Carry on from it", "Go on from it")), null, "only in leadOf's own words");
  });

  // (fails before: yes — any message to the agent that opened with "[Filament compacted turn" or "round" passed for an
  // earlier summary, wherever it stood)
  test("only where Filament puts one, in its own words: the first message, in the exact words of its lead; a fold's, after the fold's line", () => {
    const words = (/** @type {any[]} */ messages) => summaryReading(messages, 2000, 20, 20);
    const fake = "[Filament compacted turn 1 and then some words of the brief]\nmore of the brief, long enough to be cut";
    assert.equal(words([{ role: "user", content: fake }]), `User: ${fake.slice(0, 20)}…`, "only opening with its words: the brief, cut");
    assert.equal(words([{ role: "user", content: summaryLead(4, 4, "S") }]), "[The summary an earlier compaction wrote of turn 4]\nS");
    const lead = summaryLead(1, 1, `S ${"s".repeat(40)}`);
    const second = [{ role: "user", content: "the brief" }, { role: "assistant", content: "ok" }, { role: "user", content: lead }];
    assert.ok(words(second).endsWith(`\nUser: ${lead.slice(0, 20)}…`), "not the first message: a message, cut");
    const rounds = roundsLead(1, 2, `F ${"f".repeat(40)}`);
    const loose = [{ role: "user", content: "the brief" }, { role: "assistant", content: "Working on it, I think." }, { role: "user", content: rounds }];
    assert.ok(words(loose).endsWith(`\nUser: ${rounds.slice(0, 20)}…`), "not after the fold's line: a message, cut");
    assert.deepEqual(summaryLeadOf(summaryLead(1, 3, " S \nmore")), { fromTurn: 1, toTurn: 3, text: "S \nmore" });
    assert.equal(summaryLeadOf(summaryLead(2, 2, "S").replace("turn 2", "turns 2")), null, "a span its lead never writes");
    assert.equal(summaryLeadOf(roundsLead(1, 3, "S")), null);
  });
});

// The review of 11-03 (sa_94bd1300, round 5): the summary's call read the owner's share of the window whatever its
// reply could hold — on a model that writes 8,192 tokens at most, a transcript of 70% of its window, whose notes alone
// ran past what it could write; at a share of 95%, a reply's room of 3%.
// (fails before: yes — there was no room for the reply but what the share left)
test("one summary call's room: the reply's what a summary of that transcript needs, never more than the model writes; the request the rest, within the owner's share", () => {
  const wide = summaryCallRoom({ window: 200_000, ceiling: 128_000 });
  assert.deepEqual(wide, { request: 138_500, reply: 2 * Math.round(138_500 * 0.06) }, "the share bounds it: 70% of the window less the summary's reserve");
  const short = summaryCallRoom({ window: 200_000, ceiling: 8_192 });
  assert.equal(short.reply, 8_192, "no more than the model writes");
  assert.ok(short.request < 70_000 && 2 * Math.round(short.request * 0.06) <= 8_192 && 2 * Math.round((short.request + 1) * 0.06) > 8_192, `the longest transcript whose summary it can write: ${short.request}`);
  const greedy = summaryCallRoom({ window: 200_000, ceiling: 128_000, policy: { sliceBudgetFraction: 0.95 } });
  assert.ok(greedy.request < 0.95 * 200_000 - 1_500 && greedy.request + greedy.reply + 4_000 <= 200_000 && greedy.reply >= 20_000, `the share only up to the summary's room: ${JSON.stringify(greedy)}`);
  const carried = summaryCallRoom({ window: 200_000, ceiling: 128_000, past: ["s ".repeat(20_000)] });
  assert.equal(carried.reply, 2 * estimateTokens("s ".repeat(20_000)), "an earlier summary it carries sets the summary's length, as a session's own do");
  assert.equal(summaryCallRoom({ window: 1_000_000, ceiling: 128_000 }).request, 698_500, "no ceiling of one slice on one call");
});

// (fails before: no — a guard on the room a caller weighed itself, which `summarize` hands memory's `callModel`)
test("summarize hands on the room its caller weighed, a whole number of tokens; none where it names none worth asking", async () => {
  /** @type {any[]} */
  const asked = [];
  const memory = { callModel: async (/** @type {any} */ a) => (asked.push(a), "<summary>\nS\n</summary>") };
  for (const maxTokens of [1234.7, 0, -5, Number.NaN, null]) await summarize(memory, { transcript: "T", maxTokens });
  assert.deepEqual(asked.map((a) => a.maxTokens), [1234, undefined, undefined, undefined, undefined]);
});
