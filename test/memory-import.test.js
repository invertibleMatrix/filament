import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync, existsSync, statSync, utimesSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Archive } from "../src/archive.js";
import { importClaudeCode, importMnemosyneDb, wslBackup, detectSources, parseClaudeCodeSession, listClaudeCodeFiles, claudeCodeChats, CONTINUATION_PREFIX } from "../src/memory-import.js";

// Everything synthetic, in a temp dir; every database is closed before the dir goes (Windows holds open files).
const dir = mkdtempSync(join(tmpdir(), "filament-import-")); let seq = 0; const opened = [];
const openArchive = () => { const a = new Archive({ file: join(dir, `a${++seq}.db`) }); opened.push(a); return a; };
after(() => { for (const a of opened) { try { a.close(); } catch {} } rmSync(dir, { recursive: true, force: true }); });

// ---- Claude Code fixtures ------------------------------------------------------------------------------------------
const T0 = Date.parse("2026-09-01T10:00:00Z"); const ts = (i) => new Date(T0 + i * 60_000).toISOString();
const CWD_A = "C:\\proj\\alpha", CWD_B = "C:\\proj\\beta";
const base = (sid, cwd, i, extra = {}) => ({ parentUuid: null, isSidechain: false, userType: "external", cwd, sessionId: sid, version: "2.1.0", gitBranch: "main", uuid: `u-${sid}-${i}-${++seq}`, timestamp: ts(i), ...extra });
const userLine = (sid, cwd, i, content, extra = {}) => ({ ...base(sid, cwd, i, extra), type: "user", message: { role: "user", content } });
const asstLine = (sid, cwd, i, id, block, extra = {}) => ({ ...base(sid, cwd, i, extra), type: "assistant", requestId: `req_${id}`, message: { id, type: "message", role: "assistant", model: "claude-opus-4-1", content: [block], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
const toolResult = (id, out) => [{ type: "tool_result", tool_use_id: id, content: out }];
const jsonl = (lines) => lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n";
const SUMMARY_1 = `${CONTINUATION_PREFIX} that ran out of context. Summary: two files were listed and one renamed.`;
const SUMMARY_2 = `${CONTINUATION_PREFIX}. Summary two: c.js was deleted.`;

const SID_A = "aaaaaaaa-0000-4000-8000-000000000001", SID_B = "bbbbbbbb-0000-4000-8000-000000000002";
function sessionA() {
  return jsonl([
    { type: "mode", mode: "default", sessionId: SID_A },
    userLine(SID_A, CWD_A, 1, "Please list the files"),
    asstLine(SID_A, CWD_A, 2, "m1", { type: "thinking", thinking: "The user wants a listing.", signature: "x" }),
    asstLine(SID_A, CWD_A, 2, "m1", { type: "text", text: "Let me look." }),
    asstLine(SID_A, CWD_A, 2, "m1", { type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }),
    userLine(SID_A, CWD_A, 3, toolResult("tu1", "a.js\nb.js"), { toolUseResult: { stdout: "a.js\nb.js", stderr: "" }, sourceToolUseID: "tu1" }),
    asstLine(SID_A, CWD_A, 4, "m2", { type: "text", text: "There are two files: a.js and b.js." }),
    { type: "ai-title", aiTitle: "Listing files", sessionId: SID_A },
    { type: "custom-title", customTitle: "Alpha file survey", sessionId: SID_A },
    userLine(SID_A, CWD_A, 5, "<local-command-stdout>ok</local-command-stdout>", { isMeta: true }), // skipped
    userLine(SID_A, CWD_A, 5, "[Request interrupted by user]", { isVisibleInTranscriptOnly: true }), // skipped: transcript-only, not a compact summary
    userLine(SID_A, CWD_A, 5, "sub-agent prompt", { isSidechain: true }), // skipped
    asstLine(SID_A, CWD_A, 5, "side1", { type: "text", text: "sub-agent answer" }, { isSidechain: true }), // skipped
    '{"type":"user","message":{"role":"user","content":"half a li', // a line still being written: skipped
    { type: "queue-operation", operation: "enqueue", sessionId: SID_A, timestamp: ts(5) },
    { ...base(SID_A, CWD_A, 5), type: "system", subtype: "turn_duration", durationMs: 1234, content: "", level: "info" },
    userLine(SID_A, CWD_A, 6, [{ type: "text", text: "Now rename a.js to c.js" }]),
    asstLine(SID_A, CWD_A, 7, "m3", { type: "text", text: "Renamed." }),
    { type: "last-prompt", lastPrompt: "Now rename a.js to c.js", leafUuid: "u-x", sessionId: SID_A },
    { type: "continued-in", continuedInSessionId: SID_B, sessionId: SID_A, timestamp: ts(8) },
  ]);
}
function sessionB() {
  return jsonl([
    userLine(SID_B, CWD_A, 9, SUMMARY_1, { isCompactSummary: true, isVisibleInTranscriptOnly: true }), // flagged exactly as Claude Code writes them
    asstLine(SID_B, CWD_A, 10, "m4", { type: "text", text: "Continuing where we left off." }),
    userLine(SID_B, CWD_A, 11, "Delete c.js"),
    asstLine(SID_B, CWD_A, 12, "m5", { type: "tool_use", id: "tu2", name: "Bash", input: { command: "rm c.js" } }),
    userLine(SID_B, CWD_A, 13, toolResult("tu2", "")),
    asstLine(SID_B, CWD_A, 14, "m6", { type: "text", text: "Deleted." }),
    userLine(SID_B, CWD_A, 15, [{ type: "text", text: SUMMARY_2 }], { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    asstLine(SID_B, CWD_A, 16, "m7", { type: "text", text: "Resuming after compaction." }),
  ]);
}
function claudeRoot(name) {
  const root = join(dir, name); const slug = join(root, "H--proj-alpha"); mkdirSync(slug, { recursive: true });
  writeFileSync(join(slug, `${SID_A}.jsonl`), sessionA()); writeFileSync(join(slug, `${SID_B}.jsonl`), sessionB());
  const nested = join(slug, SID_A, "subagents"); mkdirSync(nested, { recursive: true }); writeFileSync(join(nested, "agent-x.jsonl"), jsonl([userLine("x", CWD_A, 1, "sub", { isSidechain: true })]));
  return root;
}
const kinds = (a, hashes) => hashes.map((h) => a.getMessage(h).kind);
const text = (a, hash) => a.getMessage(hash).message.content.map((b) => b.text || "").join("");

// ---- Claude Code -----------------------------------------------------------------------------------------------------
test("parseClaudeCodeSession: turns, merged assistant blocks, work vs final, titles, skips and where a chat goes on", () => {
  const a = parseClaudeCodeSession(sessionA());
  assert.equal(a.sessionId, SID_A); assert.equal(a.cwd, CWD_A); assert.equal(a.title, "Alpha file survey");
  assert.equal(a.firstAt, T0 + 60_000); assert.equal(a.lastAt, T0 + 8 * 60_000); assert.deepEqual(a.continuedIn, [SID_B]);
  assert.equal(a.turns.length, 2); assert.equal(a.skipped, 5, "meta, transcript-only, two sidechain lines, one unparsable line"); assert.equal(a.startsFromSummary, false); assert.deepEqual(a.compactions, []);
  const [t1, t2] = a.turns;
  assert.equal(t1.user.content, "Please list the files"); assert.equal(t1.work.length, 2);
  assert.deepEqual(t1.work[0].content.map((b) => b.type), ["thinking", "text", "tool_use"], "three lines of one response merged back into one message");
  // (fails before: yes — a reply was kept with its response's envelope (id, model, usage, stop_reason): no message of Filament's own has those)
  assert.deepEqual(Object.keys(t1.work[0]), ["role", "content"], "a reply is kept as its role and its blocks"); assert.deepEqual(Object.keys(t1.final), ["role", "content"]);
  assert.equal(t1.work[1].content[0].type, "tool_result"); assert.deepEqual(Object.keys(t1.work[1]), ["role", "content"]); assert.equal(t1.final.content[0].text, "There are two files: a.js and b.js.");
  assert.equal(t1.at, T0 + 60_000); assert.equal(t1.endAt, T0 + 4 * 60_000); assert.equal(t1.model, "claude-opus-4-1");
  assert.equal(t2.work.length, 0); assert.equal(t2.final.content[0].text, "Renamed.");
  assert.equal(parseClaudeCodeSession("").turns.length, 0);
  // a turn cut mid tool loop closes on its last tool call: that call is the final, its result stays in the work, the turn is marked cut
  const cut = parseClaudeCodeSession(jsonl([userLine("s", CWD_A, 1, "go"), asstLine("s", CWD_A, 2, "m", { type: "tool_use", id: "t", name: "Bash", input: {} }), userLine("s", CWD_A, 3, toolResult("t", "out"))]));
  assert.equal(cut.turns.length, 1); assert.equal(cut.turns[0].work.length, 1); assert.equal(cut.turns[0].work[0].content[0].type, "tool_result");
  assert.equal(cut.turns[0].final.content[0].type, "tool_use"); assert.equal(cut.turns[0].cut, true); assert.equal(cut.turns[0].endAt, T0 + 3 * 60_000, "the turn ends at its last item");
  // a turn whose last message is the model's tool call (no result yet) closes on it too, and is not cut
  const tail = parseClaudeCodeSession(jsonl([userLine("s", CWD_A, 1, "go"), asstLine("s", CWD_A, 2, "m", { type: "tool_use", id: "t", name: "Bash", input: {} })]));
  assert.equal(tail.turns[0].work.length, 0); assert.equal(tail.turns[0].final.content[0].type, "tool_use"); assert.equal(tail.turns[0].cut, undefined);
  // a turn with no assistant message at all stays open
  const none = parseClaudeCodeSession(jsonl([userLine("s", CWD_A, 1, "go")]));
  assert.equal(none.turns[0].final, undefined);
});

// The translation (HarnessV4_Import_Plan §7): what Claude Code keeps as a user line is often not what the person typed.
// Each such line becomes what Filament keeps for the same thing in a chat of its own.
const S = "s", say = (i, id, t, extra) => asstLine(S, CWD_A, i, id, { type: "text", text: t }, extra), call = (i, id, tu, name = "Bash") => asstLine(S, CWD_A, i, id, { type: "tool_use", id: tu, name, input: {} });
const typed = (i, t, extra) => userLine(S, CWD_A, i, t, extra), result = (i, tu) => userLine(S, CWD_A, i, toolResult(tu, "out"));
const summaryLine = (i, t = SUMMARY_2) => typed(i, t, { isCompactSummary: true, isVisibleInTranscriptOnly: true });
const parse = (lines) => parseClaudeCodeSession(jsonl(lines));
const said = (t) => (typeof t.user.content === "string" ? t.user.content : t.user.content.map((b) => b.text || `(${b.type})`).join(" | "));

// (fails before: yes — every turn came in bare: no client, no numbers, so the chat's footer said nothing and no bubble said where it was typed)
test("a Claude Code turn carries what Filament keeps on a turn of its own: the format and its numbers (the client is its chat's: IM-58)", () => {
  const usage = (i, o, r, w) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: r, cache_creation_input_tokens: w });
  const line = (i, id, block, u, stop) => { const l = asstLine(S, CWD_A, i, id, block); l.message.usage = u; l.message.stop_reason = stop; return l; };
  const p = parse([
    typed(1, "go"),
    // one response, three lines: its usage is on each, and is counted once
    line(2, "r1", { type: "thinking", thinking: "hm", signature: "x" }, usage(10, 50, 1000, 200), "tool_use"), line(2, "r1", { type: "text", text: "Looking." }, usage(10, 50, 1000, 200), "tool_use"), line(3, "r1", { type: "tool_use", id: "t1", name: "Bash", input: {} }, usage(10, 50, 1000, 200), "tool_use"),
    result(4, "t1"),
    line(6, "r2", { type: "text", text: "Done." }, usage(4, 30, 1300, 60), "end_turn"),
    typed(7, "and nothing answers this"),
  ]);
  const [t, open] = p.turns;
  assert.equal(t.meta.client, undefined); assert.equal(t.meta.format, "anthropic");
  assert.deepEqual(t.meta.facts.tokens, { input: 14, output: 80, cacheRead: 2300, cacheWrite: 260 }, "each response once, summed");
  assert.equal(t.meta.facts.held, 4 + 1300 + 60, "what the last request held: its input and both cache figures");
  assert.deepEqual([t.meta.facts.model, t.meta.facts.calls, t.meta.facts.requests, t.meta.facts.stopReason], ["claude-opus-4-1", 2, 1, "end_turn"]);
  assert.deepEqual([t.meta.facts.startedAt, t.meta.facts.endedAt], [T0 + 60_000, T0 + 6 * 60_000]);
  assert.deepEqual([t.meta.facts.costUsd, t.meta.facts.listUsd, t.meta.facts.error], [null, null, null], "no cost: Filament paid for none of it");
  assert.equal(t.meta.facts.v, 1);
  assert.deepEqual(open.meta, { format: "anthropic" }, "a turn nothing answered has no numbers");
});

// (fails before: yes — the three lines of a command came in as two unanswered turns of raw tags)
test("a slash command is the turn the person typed, and what Claude Code printed for it is its answer", () => {
  const cmd = (i, name, args = "") => typed(i, `<command-name>${name}</command-name>\n            <command-message>${name.slice(1)}</command-message>\n            <command-args>${args}</command-args>`);
  const p = parse([
    typed(1, "<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>", { isMeta: true }),
    cmd(2, "/model", "sonnet"), typed(3, "<local-command-stdout>Set model to sonnet</local-command-stdout>"),
    // a skill's command: its name comes second, a model answers it
    typed(4, "<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>the fix</command-args>"), typed(5, "You are reviewing a change.", { isMeta: true }), say(6, "m1", "Looks right."),
    cmd(7, "/clear"),
    typed(8, "<local-command-stderr>Unknown command</local-command-stderr>"),
    typed(9, "<local-command-stdout>stray output with no command before it</local-command-stdout>"),
    typed(10, "plain words"), say(11, "m2", "ok"),
  ]);
  assert.deepEqual(p.turns.map(said), ["/model sonnet", "/review the fix", "/clear", "plain words"]);
  const [model, review, clear] = p.turns;
  assert.equal(model.meta.command, true); assert.equal(model.meta.commandBy, "Claude Code"); assert.equal(model.final.content[0].text, "Set model to sonnet"); assert.equal(model.meta.facts, undefined, "no model answered: no numbers");
  assert.equal(review.meta.command, undefined, "a command a model answers is a turn like any other"); assert.equal(review.final.content[0].text, "Looks right."); assert.equal(review.meta.facts.calls, 1);
  assert.equal(clear.meta.command, true); assert.equal(clear.final.content[0].text, "Unknown command", "what it printed as an error is its answer too");
  assert.equal(p.skipped, 3, "the caveat, the skill's own prompt, and output with no command before it");
});

// (fails before: yes — a command that printed nothing had no answer: an unfinished turn in the middle of the chat)
test("a slash command Claude Code printed nothing for is a finished command turn with an empty answer", () => {
  const p = parse([
    typed(1, "<command-name>/cost</command-name>\n<command-message>cost</command-message>\n<command-args></command-args>"),
    typed(2, "next words"), say(3, "m1", "ok"),
    // the last line of a file still being written
    typed(4, "<command-name>/exit</command-name>"),
  ]);
  assert.deepEqual(p.turns.map(said), ["/cost", "next words", "/exit"]);
  for (const t of [p.turns[0], p.turns[2]]) {
    assert.equal(t.meta.command, true); assert.equal(t.meta.commandBy, "Claude Code");
    assert.deepEqual(t.final, { role: "assistant", content: [{ type: "text", text: "" }] }); assert.deepEqual(t.work, []);
    assert.equal(t.meta.facts, undefined, "no model answered: no numbers");
  }
  assert.equal(p.turns[0].endAt, p.turns[0].at, "it ended when it was typed");
  // what it prints on a later read of the grown file is its answer then
  const grown = parse([typed(4, "<command-name>/exit</command-name>"), typed(5, "<local-command-stdout>Bye!</local-command-stdout>")]);
  assert.equal(grown.turns[0].final.content[0].text, "Bye!");
});

// (fails before: yes — a task's end came in as a message of the person's, tags and all)
test("a background task's end opens a turn the agent began by itself, in Filament's own words for one", () => {
  const note = (i, status, summary) => typed(i, `<task-notification>\n<task-id>bg_${i}</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>\nRead the output file to retrieve the result: C:\\tmp\\bg.output`);
  const p = parse([
    typed(1, "run it in the background"), say(2, "m1", "Running."),
    note(3, "completed", "Background command \"npm test\" completed (exit code 0)"), say(4, "m2", "It passed."),
    // two ends before the agent says anything: one turn
    note(5, "failed", "build failed"), note(6, "killed", "watcher stopped"), say(7, "m3", "Both ended."),
    // an answer after nobody's message
    typed(8, "thanks"), say(9, "m4", "Welcome."), summaryLine(10), say(11, "m5", "Going on from the summary."),
  ]);
  assert.equal(p.turns.length, 5);
  const [, one, two, , alone] = p.turns;
  assert.deepEqual(one.meta.own, { agent: "Claude Code", tasks: [{ id: "bg_3", status: "completed", summary: "Background command \"npm test\" completed (exit code 0)" }] });
  assert.equal(said(one), "A background task ended (completed): Background command \"npm test\" completed (exit code 0)");
  assert.deepEqual(two.meta.own.tasks.map((t) => t.status), ["failed", "stopped"], "Claude Code's killed is Filament's stopped");
  assert.equal(said(two), "2 background tasks ended:\n- (failed) build failed\n- (stopped) watcher stopped");
  assert.equal(two.final.content[0].text, "Both ended.");
  assert.deepEqual(alone.meta.own, { agent: "Claude Code" }); assert.equal(said(alone), "Claude Code went on by itself."); assert.equal(alone.final.content[0].text, "Going on from the summary.");
});

// (fails before: yes — the bracketed line opened a turn of its own, as words of the person's)
test("the line Claude Code writes where the person stopped a turn marks that turn stopped", () => {
  const p = parse([
    typed(1, "run everything"), call(2, "m1", "t1"), result(3, "t1"),
    typed(4, [{ type: "text", text: "[Request interrupted by user]" }]),
    typed(5, "go on"), call(6, "m2", "t2"), typed(7, "[Request interrupted by user for tool use]"),
    typed(8, "[Request interrupted by user] and then I typed more"), say(9, "m3", "ok"),
  ]);
  assert.deepEqual(p.turns.map(said), ["run everything", "go on", "[Request interrupted by user] and then I typed more"], "only the line alone is the mark");
  assert.deepEqual(p.turns[0].meta.stopped, { by: "claude-code", at: T0 + 4 * 60_000 }); assert.deepEqual(p.turns[1].meta.stopped, { by: "claude-code", at: T0 + 7 * 60_000 }); assert.equal(p.turns[2].meta.stopped, undefined);
  assert.equal(parse([typed(1, "[Request interrupted by user]")]).turns.length, 0, "with no turn to stop it is nothing");
});

// (fails before: yes — the service's error line was dropped: the turn read as one nobody answered)
test("a reply that is the service's error fails its turn, unless the agent went on in it", () => {
  const error = (i, text = "API Error: 529 Overloaded") => say(i, `e${i}`, text, { isApiErrorMessage: true });
  const p = parse([
    typed(1, "push it"), error(2),
    typed(3, "do the work"), call(4, "m1", "t1"), result(5, "t1"), error(6, "API Error: 500"),
    typed(7, "again"), error(8), say(9, "m2", "Pushed."),
  ]);
  const [bare, worked, recovered] = p.turns;
  assert.equal(bare.final, undefined); assert.deepEqual(bare.meta.failed, { cause: "API Error: 529 Overloaded" }); assert.equal(bare.meta.facts.error, "API Error: 529 Overloaded"); assert.equal(bare.meta.facts.errors, 1); assert.equal(bare.meta.facts.endedAt, T0 + 2 * 60_000);
  assert.equal(worked.final, undefined, "a failed turn has no answer: its last call is not made one"); assert.deepEqual(worked.work.map((m) => m.content[0].type), ["tool_use", "tool_result"]); assert.equal(worked.meta.failed.cause, "API Error: 500"); assert.equal(worked.cut, undefined);
  assert.equal(recovered.meta.failed, undefined, "it went on: the turn did not fail"); assert.equal(recovered.meta.facts.error, null); assert.equal(recovered.final.content[0].text, "Pushed.");
});

// (fails before: yes — a summary opened a turn as words of the person's, and cut the turn it fell in into two)
test("a compaction's summary is never a turn's message: inside a turn the turn goes on, between turns it stands for those before", () => {
  const p = parse([
    typed(1, "refactor it"), call(2, "m1", "t1"), result(3, "t1"), call(4, "m2", "t2"), result(5, "t2"),
    summaryLine(6, SUMMARY_1), call(7, "m3", "t3"), result(8, "t3"), say(9, "m4", "Refactored."),
    // after an answer: between turns, and asked for by the command beside it
    summaryLine(10, SUMMARY_2), typed(11, "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>"), typed(12, "<local-command-stdout>Compacted</local-command-stdout>"),
    typed(13, "next"), say(14, "m5", "ok"),
  ]);
  assert.deepEqual(p.turns.map(said), ["refactor it", "/compact", "next"]);
  assert.equal(p.turns[0].work.length, 6, "the turn the summary fell in is one turn, whole"); assert.equal(p.turns[0].final.content[0].text, "Refactored.");
  assert.deepEqual(p.compactions, [
    { during: 1, cutAfter: "t2", toTurn: 0, text: SUMMARY_1, at: T0 + 6 * 60_000, manual: false },
    { toTurn: 1, text: SUMMARY_2, at: T0 + 10 * 60_000, manual: true },
  ]);
  assert.equal(p.startsFromSummary, false);
  // the command first, then its summary: asked for all the same
  const other = parse([typed(1, "a"), say(2, "m1", "b"), typed(3, "<command-name>/compact</command-name>"), summaryLine(4), typed(5, "<local-command-stdout>Compacted</local-command-stdout>")]);
  assert.deepEqual(other.compactions.map((c) => [c.toTurn, c.during, c.manual]), [[1, undefined, true]]); assert.deepEqual(other.turns.map(said), ["a", "/compact"]); assert.equal(other.turns[1].final.content[0].text, "Compacted");
  // before any tool call of the turn: inside it, with no call before
  const early = parse([typed(1, "a"), summaryLine(2), say(3, "m1", "b")]);
  assert.deepEqual(early.compactions.map((c) => [c.toTurn, c.during, c.cutAfter]), [[0, 1, null]]); assert.equal(early.turns.length, 1);
  // first in the file: it stands for the chat before, and the first turn goes from it
  const first = parse(sessionB().trimEnd().split("\n").map((l) => JSON.parse(l)));
  assert.equal(first.startsFromSummary, true); assert.deepEqual(first.compactions.map((c) => [c.toTurn, c.during, c.cutAfter]), [[0, 1, null], [2, undefined, undefined]]);
  assert.deepEqual(first.turns.map(said), ["Claude Code went on by itself.", "Delete c.js", "Claude Code went on by itself."]);
  // told by its opening words alone, where the flag is missing
  assert.equal(parse([typed(1, `${CONTINUATION_PREFIX}. Summary: x`), typed(2, "hello"), say(3, "m1", "hi")]).turns.length, 1);
});

test("importClaudeCode builds one chain per session with turns, work, finals, title, timestamps, the announced link and compactions", async () => {
  const a = openArchive(); const root = claudeRoot("cc1"); const progress = [];
  assert.equal(listClaudeCodeFiles(root).length, 2, "nested sub-agent folders are not sessions");
  const r = await importClaudeCode({ archive: a, root, onProgress: (p) => progress.push(p) });
  assert.deepEqual(r.errors, []); assert.equal(r.files, 2); assert.equal(r.chains, 2); assert.equal(r.newChains, 2); assert.equal(r.turns, 5); assert.equal(r.newTurns, 5);
  assert.equal(r.messages, 14); assert.equal(r.skipped, 5); assert.equal(r.compactions, 2); assert.equal(r.links, 1);
  assert.ok(progress.length >= 3); assert.ok(progress.every((p) => p.step === "claude-code")); assert.equal(progress.at(-1).percent, 100); assert.equal(progress.at(-1).done, 2); assert.equal(progress.at(-1).total, 2);
  assert.ok(progress.every((p) => !JSON.stringify(p).includes("Please list")), "progress never carries message text");
  const chains = a.recentChains(); assert.equal(chains.length, 2);
  const A = chains.find((c) => c.key === `cc:${SID_A}`), B = chains.find((c) => c.key === `cc:${SID_B}`);
  assert.equal(A.title, "Alpha file survey"); assert.equal(A.client, "harness"); assert.equal(A.meta.native, true); assert.equal(A.model, null, "the session names no model: Claude Code's is no route of Filament's, and the person picks"); assert.equal(A.turns, 2);
  assert.equal(a.getProject(A.project_id).name, "alpha"); assert.equal(a.getProject(A.project_id).cwd, CWD_A); assert.equal(B.project_id, A.project_id);
  assert.equal(A.started_at, T0 + 60_000, "started_at is the session's first timestamp"); assert.equal(A.last_at, T0 + 8 * 60_000, "last_at is the session's last timestamp (the continued-in line)"); assert.equal(B.last_at, T0 + 16 * 60_000);
  assert.equal(A.meta.sessionId, SID_A); assert.equal(A.meta.import, "claude-code");
  const turnsA = a.getTurns(A.id); assert.equal(turnsA.length, 2);
  assert.deepEqual(kinds(a, turnsA[0].work), ["tool_use", "tool_result"]); assert.equal(text(a, turnsA[0].final_hash), "There are two files: a.js and b.js."); assert.equal(turnsA[0].started_at, T0 + 60_000); assert.equal(turnsA[0].ended_at, T0 + 4 * 60_000);
  assert.equal(a.getMessage(turnsA[0].user_hash).message.content, "Please list the files"); assert.equal(turnsA[1].work.length, 0); assert.equal(text(a, turnsA[1].final_hash), "Renamed.");
  // (fails before: yes — a turn was written bare)
  assert.equal(turnsA[0].meta.client, "harness"); assert.equal(turnsA[0].meta.format, "anthropic"); assert.equal(turnsA[0].meta.facts.model, "claude-opus-4-1"); assert.equal(turnsA[0].meta.facts.calls, 2);
  // A said it goes on in B: the two are linked. (fails before: yes — the link's summary was also written into A as a
  // compaction of A's turns, so A sent on from a summary that was B's)
  assert.equal(B.parent_id, A.id); assert.equal(B.title, null);
  assert.deepEqual(a.linksFor(B.id).map((l) => [l.src, l.dst, l.type]), [[B.id, A.id, "continues"]]);
  assert.deepEqual(a.getCompactions(A.id), [], "nothing is written into the chat that went before");
  // B's own summaries, as Claude Code's own compactions: the one it starts from, and the one after its second turn
  const compB = a.getCompactions(B.id); assert.equal(compB.length, 2);
  assert.deepEqual(compB.map((c) => [c.from_turn, c.to_turn, c.kind, c.method]), [[1, 0, "plain", "own"], [1, 2, "plain", "own"]]);
  assert.deepEqual(compB.map((c) => c.detail), [{ during: 1, cutAfter: null, by: "Claude Code", exact: true, how: "agent-own" }, { by: "Claude Code", exact: true, how: "agent-own" }]);
  assert.deepEqual(compB.map((c) => a.getMessage(c.summary_hash).message.content), [SUMMARY_1, SUMMARY_2]);
  const turnsB = a.getTurns(B.id); assert.equal(turnsB.length, 3);
  assert.equal(a.getMessage(turnsB[0].user_hash).message.content[0].text, "Claude Code went on by itself.", "no summary is a turn's message"); assert.deepEqual(turnsB[0].meta.own, { agent: "Claude Code" });
  assert.deepEqual(kinds(a, turnsB[1].work), ["tool_use", "tool_result"]); assert.equal(B.turns, 3);
  assert.equal(a.searchInputs("rename").length, 1, "user inputs are searchable");
  assert.equal(a.counts().messages, 15, "14 turn messages, one of them said twice, + 2 compaction summaries"); assert.equal(a.counts().compactions, 2);
});

test("importClaudeCode is idempotent and picks up turns appended to a session later", async () => {
  const a = openArchive(); const root = claudeRoot("cc2");
  const first = await importClaudeCode({ archive: a, root }); const before = a.counts();
  const again = await importClaudeCode({ archive: a, root });
  assert.deepEqual(a.counts(), before, "second run writes nothing");
  assert.equal(again.chains, 2); assert.equal(again.newChains, 0); assert.equal(again.turns, first.turns); assert.equal(again.newTurns, 0); assert.equal(again.messages, 0); assert.equal(again.compactions, 0); assert.equal(again.links, 0);
  const A = a.recentChains().find((c) => c.key === `cc:${SID_A}`); assert.equal(a.getTurns(A.id).length, 2); assert.equal(a.linksFor(A.id).length, 1);
  assert.equal(A.last_at, T0 + 8 * 60_000, "a re-run keeps last_at");
  // the session grows by one turn, then by a final for a turn that was cut mid tool loop
  const file = join(root, "H--proj-alpha", `${SID_A}.jsonl`);
  appendFileSync(file, jsonl([userLine(SID_A, CWD_A, 20, "One more thing"), asstLine(SID_A, CWD_A, 21, "m9", { type: "tool_use", id: "tu9", name: "Read", input: { file: "c.js" } }), userLine(SID_A, CWD_A, 22, toolResult("tu9", "body"))]));
  const third = await importClaudeCode({ archive: a, root });
  assert.equal(third.newTurns, 1); assert.equal(third.messages, 3); const t3 = a.getTurns(A.id); assert.equal(t3.length, 3);
  assert.equal(a.getMessage(t3[2].final_hash).kind, "tool_use", "cut mid-loop: the turn closes on its last tool call"); assert.equal(t3[2].work.length, 1); assert.equal(t3[2].meta?.cut, true); assert.equal(a.getChain(A.id).turns, 3);
  assert.equal(a.getChain(A.id).last_at, T0 + 22 * 60_000, "last_at follows the appended lines");
  const again3 = await importClaudeCode({ archive: a, root }); assert.equal(again3.messages, 0, "a cut turn re-imported unchanged writes nothing");
  appendFileSync(file, jsonl([asstLine(SID_A, CWD_A, 23, "m10", { type: "text", text: "c.js holds the renamed code." })]));
  const fourth = await importClaudeCode({ archive: a, root });
  assert.equal(fourth.newTurns, 0); assert.equal(fourth.messages, 2, "the tool call joins the work, the answer is the new final"); const t4 = a.getTurns(A.id); assert.equal(t4.length, 3); assert.equal(text(a, t4[2].final_hash), "c.js holds the renamed code."); assert.equal(a.getChain(A.id).turns, 3, "re-finishing counts the turn once");
  assert.deepEqual(kinds(a, t4[2].work), ["tool_use", "tool_result"], "the work is laid out again in order: the call before its result"); assert.equal(t4[2].meta?.cut, undefined, "no longer cut");
  // (fails before: yes — a turn had no numbers to grow)
  assert.equal(t3[2].meta.facts.calls, 1); assert.equal(t4[2].meta.facts.calls, 2, "the turn's numbers follow the chat as it grows"); assert.equal(t4[2].meta.facts.endedAt, T0 + 23 * 60_000);
  assert.equal(a.counts().messages, before.messages + 4);
});

// (fails before: yes — a turn had no marks: a chat that grew past a failure or a stop could not say so)
test("a turn's marks follow the chat as it grows: a failure the agent went on from, a stop, a command's answer", async () => {
  const a = openArchive(); const root = join(dir, "cc5"); const slug = join(root, "H--proj-alpha"); mkdirSync(slug, { recursive: true });
  const G = "99999999-0000-4000-8000-000000000009"; const file = join(slug, `${G}.jsonl`);
  const u = (i, c, extra) => userLine(G, CWD_A, i, c, extra), s = (i, id, t, extra) => asstLine(G, CWD_A, i, id, { type: "text", text: t }, extra);
  writeFileSync(file, jsonl([u(1, "push it"), s(2, "e1", "API Error: 529 Overloaded", { isApiErrorMessage: true })]));
  await importClaudeCode({ archive: a, root });
  const chain = () => a.recentChains().find((c) => c.key === `cc:${G}`);
  const one = a.getTurns(chain().id)[0];
  assert.deepEqual(one.meta.failed, { cause: "API Error: 529 Overloaded" }); assert.equal(one.final_hash, null); assert.equal(one.meta.facts.error, "API Error: 529 Overloaded");
  // Claude Code tried again and it worked; then a command, a turn the person stopped, and a task's end
  appendFileSync(file, jsonl([
    s(3, "m1", "Pushed."),
    u(4, "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>sonnet</command-args>"), u(5, "<local-command-stdout>Set model to sonnet</local-command-stdout>"),
    u(6, "run the suite"), asstLine(G, CWD_A, 7, "m2", { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }), u(8, toolResult("t1", "running")), u(9, [{ type: "text", text: "[Request interrupted by user]" }]),
    u(10, "<task-notification>\n<task-id>bg_1</task-id>\n<status>completed</status>\n<summary>the suite passed</summary>\n</task-notification>"), s(11, "m3", "All green."),
  ]));
  const r = await importClaudeCode({ archive: a, root });
  assert.deepEqual(r.errors, []); assert.equal(r.newTurns, 3);
  const [pushed, command, stopped, own] = a.getTurns(chain().id);
  assert.equal(pushed.meta.failed, undefined, "the failure is gone: the agent went on"); assert.equal(pushed.meta.facts.error, null); assert.equal(text(a, pushed.final_hash), "Pushed.");
  assert.equal(command.meta.command, true); assert.equal(command.meta.commandBy, "Claude Code"); assert.equal(a.getMessage(command.user_hash).message.content, "/model sonnet"); assert.equal(text(a, command.final_hash), "Set model to sonnet");
  assert.deepEqual(stopped.meta.stopped, { by: "claude-code", at: T0 + 9 * 60_000 });
  // (fails before: yes — the stopped turn closed on its call, `cut`: the page drew no card for the call)
  assert.equal(stopped.meta.cut, undefined); assert.deepEqual(kinds(a, stopped.work), ["tool_use", "tool_result"], "what it did before the stop is its work, in order");
  assert.equal(text(a, stopped.final_hash), "(turn stopped in Claude Code)", "and it answers with how it ended, as Filament's own stopped turn does");
  assert.deepEqual(own.meta.own, { agent: "Claude Code", tasks: [{ id: "bg_1", status: "completed", summary: "the suite passed" }] });
  assert.ok([pushed, command, stopped, own].every((t) => t.meta.client === "harness" && t.meta.format === "anthropic"));
  assert.equal(chain().title, null); assert.equal((await importClaudeCode({ archive: a, root })).messages, 0, "read again, nothing is written");
});

test("importClaudeCode: dryRun writes nothing, since filters by mtime, a missing root is nothing to import", async () => {
  const a = openArchive(); const root = claudeRoot("cc3"); const progress = [];
  const dry = await importClaudeCode({ archive: a, root, dryRun: true, onProgress: (p) => progress.push(p) });
  assert.deepEqual(a.counts(), { projects: 0, chains: 0, turns: 0, messages: 0, bytes: 0, items: 0, compactions: 0, trimSlices: 0, injections: 0 });
  assert.equal(dry.dryRun, true); assert.equal(dry.chains, 2); assert.equal(dry.turns, 5); assert.equal(dry.messages, 14); assert.equal(dry.compactions, 2); assert.equal(dry.links, 1); assert.equal(dry.skipped, 5); assert.ok(progress.length >= 3);
  const none = await importClaudeCode({ dryRun: true, root }); assert.equal(none.chains, 2, "dryRun needs no archive");
  const old = new Date(T0 - 86_400_000); utimesSync(join(root, "H--proj-alpha", `${SID_A}.jsonl`), old, old);
  const recent = await importClaudeCode({ archive: a, root, since: T0 }); assert.equal(recent.files, 1); assert.equal(recent.chains, 1);
  assert.equal((await importClaudeCode({ archive: a, root, since: Date.now() + 86_400_000 })).files, 0);
  const missing = await importClaudeCode({ archive: a, root: join(dir, "nowhere") }); assert.equal(missing.files, 0); assert.equal(missing.chains, 0); assert.deepEqual(missing.errors, []);
  await assert.rejects(importClaudeCode({ root }), /archive is required/);
});

// (fails before: yes — a chat that began from a summary was hung on the latest earlier chat of its folder, and its
// summary written into that chat as a compaction of its turns: in a folder with several chats that was the wrong one
// more often than not, and the chat it landed on then sent on from a summary that was never its own)
test("a chat that begins from a summary is hung on no chat by a guess: it keeps its own summary, and links only where a chat said so", async () => {
  const a = openArchive(); const root = join(dir, "cc4"); const slug = join(root, "H--proj-beta"); mkdirSync(slug, { recursive: true });
  const C = "cccccccc-0000-4000-8000-000000000003", D = "dddddddd-0000-4000-8000-000000000004", E = "eeeeeeee-0000-4000-8000-000000000005";
  writeFileSync(join(slug, `${C}.jsonl`), jsonl([userLine(C, CWD_B, 1, "Start beta"), asstLine(C, CWD_B, 2, "c1", { type: "text", text: "Started." })]));
  writeFileSync(join(slug, `${E}.jsonl`), jsonl([userLine(E, CWD_B, 30, "Much later"), asstLine(E, CWD_B, 31, "e1", { type: "text", text: "Later." })]));
  await importClaudeCode({ archive: a, root });
  // D starts after C and before E in the same folder, from a summary, and no chat said it goes on there
  writeFileSync(join(slug, `${D}.jsonl`), jsonl([userLine(D, CWD_B, 10, `${CONTINUATION_PREFIX}. Summary: beta started.`, { isCompactSummary: true }), userLine(D, CWD_B, 11, "carry on"), asstLine(D, CWD_B, 12, "d1", { type: "text", text: "Going on." })]));
  const r = await importClaudeCode({ archive: a, root }); assert.equal(r.links, 0); assert.equal(r.compactions, 1);
  const byKey = Object.fromEntries(a.recentChains().map((c) => [c.key, c]));
  assert.equal(byKey[`cc:${D}`].parent_id, null); assert.deepEqual(a.getCompactions(byKey[`cc:${C}`].id), []); assert.deepEqual(a.getCompactions(byKey[`cc:${E}`].id), []);
  const own = a.getCompactions(byKey[`cc:${D}`].id); assert.equal(own.length, 1);
  assert.deepEqual([own[0].to_turn, own[0].detail.during, own[0].method], [0, 1, "own"], "its summary is its own: the first turn goes from it");
  assert.equal(a.getMessage(a.getTurns(byKey[`cc:${D}`].id)[0].user_hash).message.content, "carry on");
});

// (fails before: yes — a chat was keyed by the session id on its first lines. A chat resumed from another begins with
// that chat's lines, id and all, so the two ran into one session: the resumed chat's turns were hung on the end of the
// first one's. 7 of the 73 files on the machine this was built on begin so.)
test("a chat resumed from another is a chat of its own, named by its file, and linked to the one it came from", async () => {
  const a = openArchive(); const root = join(dir, "cc6"); const slug = join(root, "H--proj-alpha"); mkdirSync(slug, { recursive: true });
  const F = "f0f0f0f0-0000-4000-8000-00000000000f", R = "abababab-0000-4000-8000-00000000000a";
  const first = [userLine(F, CWD_A, 1, "Start the work"), asstLine(F, CWD_A, 2, "f1", { type: "text", text: "Started." })];
  writeFileSync(join(slug, `${F}.jsonl`), jsonl([...first, userLine(F, CWD_A, 3, "Go on here"), asstLine(F, CWD_A, 4, "f2", { type: "text", text: "Went on in the first chat." })]));
  // The resumed chat's file: the first chat's opening lines as they were, then its own.
  writeFileSync(join(slug, `${R}.jsonl`), jsonl([...first, userLine(R, CWD_A, 10, "Take another way"), asstLine(R, CWD_A, 11, "r1", { type: "text", text: "Another way taken." })]));
  const listed = claudeCodeChats(root);
  assert.deepEqual(listed.map((c) => [c.key, c.agentSession]).sort(), [[`cc:${R}`, R], [`cc:${F}`, F]], "each file is a chat, by its own name");
  const r = await importClaudeCode({ archive: a, root });
  assert.deepEqual(r.errors, []); assert.equal(r.chains, 2); assert.equal(r.newChains, 2); assert.equal(r.turns, 4); assert.equal(r.links, 1);
  const byKey = Object.fromEntries(a.recentChains().map((c) => [c.key, c]));
  const says = (key) => a.getTurns(byKey[key].id).map((t) => a.getMessage(t.user_hash).message.content);
  assert.deepEqual(says(`cc:${F}`), ["Start the work", "Go on here"], "the first chat holds its own turns alone");
  assert.deepEqual(says(`cc:${R}`), ["Start the work", "Take another way"], "the resumed chat is whole: what it began from, then its own");
  assert.equal(byKey[`cc:${R}`].parent_id, byKey[`cc:${F}`].id); assert.deepEqual(a.linksFor(byKey[`cc:${R}`].id).map((l) => l.type), ["continues"]);
  assert.equal(byKey[`cc:${R}`].meta.sessionId, R); assert.equal(byKey[`cc:${R}`].meta.resumedFrom, F); assert.equal(byKey[`cc:${F}`].meta.resumedFrom, undefined);
  assert.equal((await importClaudeCode({ archive: a, root })).messages, 0, "read again, nothing is written");
  // The chat it came from is not in Filament: the resumed one stands alone.
  const b = openArchive(); const lone = join(dir, "cc7"); mkdirSync(join(lone, "H--proj-alpha"), { recursive: true });
  writeFileSync(join(lone, "H--proj-alpha", `${R}.jsonl`), jsonl([...first, userLine(R, CWD_A, 10, "Take another way"), asstLine(R, CWD_A, 11, "r1", { type: "text", text: "Another way taken." })]));
  const alone = await importClaudeCode({ archive: b, root: lone });
  assert.equal(alone.links, 0); assert.equal(b.recentChains()[0].key, `cc:${R}`); assert.equal(b.recentChains()[0].parent_id, null);
  assert.equal((await importClaudeCode({ root: lone, dryRun: true })).links, 0, "a dry run looks no chat up");
});

// ---- Mnemosyne database -------------------------------------------------------------------------------------------------
function makeMnemosyneDb(file) {
  const db = new DatabaseSync(file); db.exec("PRAGMA journal_mode=WAL");
  db.exec(`CREATE TABLE working_memory (id TEXT PRIMARY KEY, content TEXT, importance REAL, created_at TEXT);
    CREATE TABLE episodic_memory (id TEXT PRIMARY KEY, content TEXT, session_id TEXT, created_at TEXT);
    CREATE TABLE canonical_facts (id INTEGER PRIMARY KEY, owner TEXT, category TEXT, name TEXT, body TEXT);
    CREATE TABLE triples (id INTEGER PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT);
    CREATE TABLE schema_version (version INTEGER)`);
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO working_memory VALUES (?, ?, ?, ?)").run(`w${i}`, `working ${i}`, 0.5, "2026-01-01");
  for (let i = 0; i < 2; i++) db.prepare("INSERT INTO episodic_memory VALUES (?, ?, ?, ?)").run(`e${i}`, `episode ${i}`, "s", "2026-01-01");
  db.prepare("INSERT INTO canonical_facts (owner, category, name, body) VALUES ('user', 'tools', 'editor', 'vim')").run();
  for (let i = 0; i < 4; i++) db.prepare("INSERT INTO triples (subject, predicate, object) VALUES (?, ?, ?)").run("a", `p${i}`, "b");
  db.prepare("INSERT INTO schema_version VALUES (7)").run();
  return db; // kept open: the rows stay in the -wal file until a checkpoint
}

test("importMnemosyneDb takes a consistent copy (rows still in the WAL included) and reads counts back from the copy", async () => {
  const src = join(dir, "hermes", "mnemosyne.db"); mkdirSync(join(dir, "hermes"), { recursive: true }); const live = makeMnemosyneDb(src);
  try {
    assert.ok(statSync(`${src}-wal`).size > 0, "the data sits in the WAL, where a plain file copy would miss it");
    const folder = join(dir, "memory1"); const progress = [];
    const r = await importMnemosyneDb({ srcFile: src, memoryFolder: folder, rate: 1, onProgress: (p) => progress.push(p) });
    assert.equal(r.file, join(folder, "mnemosyne", "mnemosyne.db")); assert.ok(existsSync(r.file)); assert.ok(r.bytes > 0); assert.equal(r.bytes, statSync(r.file).size); assert.equal(r.mode, "read-only");
    assert.deepEqual(r.counts, { working_memory: 3, episodic_memory: 2, canonical_facts: 1, triples: 4 });
    assert.deepEqual(r.tables, ["canonical_facts", "episodic_memory", "schema_version", "triples", "working_memory"]); assert.equal(r.rows.schema_version, 1); assert.deepEqual(r.skippedTables, []); assert.equal(r.reindex, true);
    assert.ok(progress.length >= 2); assert.ok(progress.every((p) => p.step === "mnemosyne")); assert.equal(progress.at(-1).percent, 100); assert.ok(progress.some((p) => p.message === "copying pages"));
    assert.ok(!existsSync(`${r.file}-wal`), "the copy is left checkpointed and closed");
    const copy = new DatabaseSync(r.file, { readOnly: true }); try { assert.equal(copy.prepare("SELECT count(*) AS n FROM triples").get().n, 4); } finally { copy.close(); }
  } finally { live.close(); }
});

test("importMnemosyneDb refuses to overwrite a non-empty database unless replace is set, and validates its inputs", async () => {
  const src = join(dir, "hermes2", "mnemosyne.db"); mkdirSync(join(dir, "hermes2"), { recursive: true }); makeMnemosyneDb(src).close();
  const folder = join(dir, "memory2"); const first = await importMnemosyneDb({ srcFile: src, memoryFolder: folder }); assert.equal(first.counts.triples, 4);
  await assert.rejects(importMnemosyneDb({ srcFile: src, memoryFolder: folder }), /already holds a database.*replace/);
  assert.equal(statSync(first.file).size, first.bytes, "the refused import left the existing copy untouched");
  const replaced = await importMnemosyneDb({ srcFile: src, memoryFolder: folder, replace: true }); assert.deepEqual(replaced.counts, first.counts);
  // an empty placeholder file is not a database and is overwritten without replace
  const folder3 = join(dir, "memory3"); mkdirSync(join(folder3, "mnemosyne"), { recursive: true }); writeFileSync(join(folder3, "mnemosyne", "mnemosyne.db"), "");
  assert.equal((await importMnemosyneDb({ srcFile: src, memoryFolder: folder3 })).counts.working_memory, 3);
  await assert.rejects(importMnemosyneDb({ srcFile: join(dir, "nope.db"), memoryFolder: folder }), /not found/);
  await assert.rejects(importMnemosyneDb({ memoryFolder: folder }), /required/);
  await assert.rejects(importMnemosyneDb({ srcFile: first.file, memoryFolder: folder, replace: true }), /same file/);
});

// (fails before: yes — the bug hunt of 10-30, MEMR-4: the database was deleted before the copy was taken, so a copy that
// failed left memory's engine with none: an empty file where the import's database had been)
test("importMnemosyneDb: a replace whose copy fails leaves the database there as it was", async () => {
  const src = join(dir, "hermes4", "mnemosyne.db"); mkdirSync(join(dir, "hermes4"), { recursive: true }); makeMnemosyneDb(src).close();
  const folder = join(dir, "memory4"); const first = await importMnemosyneDb({ srcFile: src, memoryFolder: folder });
  const bad = join(dir, "hermes4", "broken.db"); writeFileSync(bad, "this is no database at all. ".repeat(200));
  await assert.rejects(importMnemosyneDb({ srcFile: bad, memoryFolder: folder, replace: true }), /not a database/);
  assert.equal(existsSync(first.file) && statSync(first.file).size, first.bytes, "the database as the first import left it");
  assert.deepEqual(readdirSync(join(folder, "mnemosyne")), ["mnemosyne.db"], "nothing of the failed copy left beside it");
  const kept = new DatabaseSync(first.file, { readOnly: true });
  try { assert.equal(kept.prepare("SELECT count(*) AS n FROM working_memory").get().n, 3); } finally { kept.close(); }
});

// (fails before: yes — the bug hunt of 10-30, MEMR-3: the path was written into the script WSL's bash ran, with only its
// double quotes taken out, so a single quote in it ended the script's words and the rest ran as commands in the distro)
test("wslBackup hands the distro its paths as arguments, never as words of the script it runs", async () => {
  const cp = createRequire(import.meta.url)("node:child_process");
  const real = cp.spawnSync;
  const calls = [];
  cp.spawnSync = (file, args) => (calls.push({ file, args }), { status: 1, stdout: "", stderr: "a stand-in for wsl.exe" });
  syncBuiltinESMExports();
  const src = "/home/me/it's mine'; touch /tmp/pwned; echo '/mnemosyne.db";
  try {
    await assert.rejects(wslBackup("Ubuntu", src, "C:\\Filament\\memory\\mnemosyne\\mnemosyne.db"), /the copy inside WSL failed: a stand-in for wsl\.exe/);
  } finally {
    cp.spawnSync = real;
    syncBuiltinESMExports();
  }
  assert.deepEqual(calls.map((c) => [c.file, ...c.args.slice(0, 3)]), [["wsl.exe", "-d", "Ubuntu", "-e"]]);
  assert.deepEqual(calls[0].args.filter((a) => a.includes("pwned")), [src], "the path is an argument of its own, and in no script");
});

// ---- detection --------------------------------------------------------------------------------------------------------
test("detectSources reports what exists under a home folder and never throws on missing pieces", () => {
  const home = join(dir, "home1"); mkdirSync(join(home, ".claude", "projects", "H--x"), { recursive: true }); mkdirSync(join(home, ".claude", "projects", "H--y"), { recursive: true });
  writeFileSync(join(home, ".claude", "projects", "H--x", "s1.jsonl"), ""); writeFileSync(join(home, ".claude", "projects", "H--x", "s2.jsonl"), ""); writeFileSync(join(home, ".claude", "projects", "H--y", "s3.jsonl"), ""); writeFileSync(join(home, ".claude", "projects", "H--y", "notes.txt"), "");
  mkdirSync(join(home, ".hermes", "mnemosyne", "data"), { recursive: true }); makeMnemosyneDb(join(home, ".hermes", "mnemosyne", "data", "mnemosyne.db")).close();
  const d = detectSources({ home, wsl: false });
  assert.deepEqual(d.claudeCode, { root: join(home, ".claude", "projects"), exists: true, files: 3, sessions: 3, projects: 2 });
  assert.deepEqual(Object.keys(d), ["claudeCode", "hermes"], "the sources it looks for");
  assert.deepEqual(d.hermes.candidates, [join(home, ".hermes", "mnemosyne", "data", "mnemosyne.db")]);
  const empty = detectSources({ home: join(dir, "home-none"), wsl: ["No-Such-Distro"] });
  assert.equal(empty.claudeCode.exists, false); assert.equal(empty.claudeCode.files, 0); assert.deepEqual(empty.hermes.candidates, []);
  const overridden = detectSources({ home: join(dir, "home-none"), claudeRoot: join(home, ".claude", "projects"), wsl: false });
  assert.equal(overridden.claudeCode.files, 3);
});
