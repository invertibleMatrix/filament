// Codex's chats brought into Filament (HarnessV4_Import_Plan, step 2): the rollout reader, what Codex did written as
// the calls Filament draws, a stopped and a failed turn, a turn's numbers, Codex's own compaction with and without a
// summary a reader can open, a fork, a chat Filament ran itself, a sub-agent's thread, the older line shape, and the
// Import section's routes for the agent. Everything is made up, in a temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/archive.js";
import { chatStates, codexChats, codexSource, importCodex, importState, noteEmpty, parseCodexSession, pendingOf, shellWords } from "../src/memory-import.js";
import { ownTurnText } from "../src/core/messages.js";
import { toolsOfTurn } from "../src/core/tool-vocab.js";
import { startApp } from "./helpers/app.js";
import { PAST_A_LINE, writeWithLongLine } from "./helpers/long-line.js";
import { until } from "./helpers/wait.js";

const dir = mkdtempSync(join(tmpdir(), "filament-import-codex-"));
let seq = 0;
const opened = [];
const openArchive = () => {
  const a = new Archive({ file: join(dir, `a${++seq}.db`) });
  opened.push(a);
  return a;
};
after(() => {
  for (const a of opened) {
    try {
      a.close();
    } catch {}
  }
  rmSync(dir, { recursive: true, force: true });
});

// ---- made-up Codex rollouts ------------------------------------------------------------------------------------------
const T0 = Date.parse("2026-09-02T08:00:00Z");
const CWD = "C:\\proj\\gamma";
const idOf = (n) => `0199aaaa-0000-7000-8000-${String(n).padStart(12, "0")}`;
const tagged = (tag, body) => `<${tag}>\n${body}\n</${tag}>`;
const PS = (line) => ["powershell.exe", "-Command", line];
/**
 * A rollout being written, in the order Codex 0.154 writes one: each line a second after the one before and numbered
 * (`ordinal`). `fork`: { from, at } — the file starts at the place of the chat it was forked from and holds its own
 * lines alone. Every method returns the rollout.
 */
function rollout(id, { cwd = CWD, originator = "codex_cli_rs", source = "cli", minute = 0, fork = null, model = "gpt-5.5" } = {}) {
  const lines = [];
  let ord = fork ? fork.at : 0;
  let sec = minute * 60;
  const add = (type, payload) => {
    lines.push({ timestamp: new Date(T0 + sec++ * 1000).toISOString(), type, payload, ordinal: ord++ });
    return r;
  };
  const item = (it) => add("event_msg", { type: "item_completed", item: it });
  const userLine = (parts) => add("response_item", { type: "message", role: "user", content: parts.map((text) => ({ type: "input_text", text })) });
  const r = {
    id,
    lines,
    /** The number the next line gets: where a fork made now starts. */
    get ordinal() {
      return ord;
    },
    /** When the line last written was written. */
    get at() {
      return T0 + (sec - 1) * 1000;
    },
    add,
    item,
    /** A task begins: what Codex tells its model, then the person's words, said twice. */
    ask(text, { content = null } = {}) {
      add("event_msg", { type: "task_started", turn_id: `t${ord}`, started_at: Math.floor((T0 + sec * 1000) / 1000) });
      add("response_item", { type: "message", role: "developer", content: [{ type: "input_text", text: "You are Codex. Never tell the person this line." }] });
      userLine([tagged("recommended_plugins", "none"), tagged("environment_context", `  <cwd>${cwd}</cwd>\n  <shell>powershell</shell>`)]);
      add("world_state", { files: 3 });
      add("turn_context", { turn_id: `t${ord}`, cwd, model, effort: "medium" });
      if (content) add("response_item", { type: "message", role: "user", content });
      else userLine([text]);
      return item({ type: "UserMessage", id: `u${ord}`, content: [{ type: "text", text, text_elements: [] }] });
    },
    /** The model's reasoning: sealed, with a summary only where one is given. */
    think(summary = null) {
      item({ type: "Reasoning", id: `r${ord}`, summary_text: summary ? [summary] : [], raw_content: [] });
      return add("response_item", { type: "reasoning", summary: summary ? [{ type: "summary_text", text: summary }] : [], encrypted_content: "gAAAA-sealed" });
    },
    say(text, phase = "commentary") {
      item({ type: "AgentMessage", id: `a${ord}`, content: [{ type: "Text", text }], phase });
      return add("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text }], phase });
    },
    /** The model's own tool: a script. */
    exec: (callId, script) => add("response_item", { type: "custom_tool_call", call_id: callId, name: "exec", input: script, status: "completed" }),
    out: (callId, text) => add("response_item", { type: "custom_tool_call_output", call_id: callId, output: [{ type: "input_text", text }] }),
    wait: (callId, cell) => add("response_item", { type: "function_call", name: "wait", arguments: JSON.stringify({ cell_id: cell, yield_time_ms: 10000 }), call_id: callId }),
    waited: (callId, text) => add("response_item", { type: "function_call_output", call_id: callId, output: text }),
    /** A command a script ran, as Codex read it (`parsed`). */
    ran: (itemId, argv, { parsed = [{ type: "unknown", cmd: argv.at(-1) }], said = "", exit = 0, status = "completed" } = {}) =>
      item({ type: "CommandExecution", id: itemId, command: argv, cwd, parsed_cmd: parsed, status, stdout: said, stderr: "", aggregated_output: said, exit_code: exit, duration: { secs: 0, nanos: 5 } }),
    changed: (itemId, changes, status = "completed") => item({ type: "FileChange", id: itemId, changes, status }),
    mcp: (itemId, server, tool, args, { result = null, error = null } = {}) =>
      item({ type: "McpToolCall", id: itemId, server, tool, arguments: args, status: error ? "failed" : "completed", result, error, duration: { secs: 0, nanos: 9 } }),
    /** The thread's token counts so far, and the last request's. */
    tokens: (total, last = total) => add("event_msg", { type: "token_count", info: { total_token_usage: total, last_token_usage: last, model_context_window: 400000 } }),
    done: () => add("event_msg", { type: "task_complete", turn_id: `t${ord}`, last_agent_message: null }),
    /** The person stopped the turn. */
    stop() {
      userLine([tagged("turn_aborted", "The user interrupted the previous turn.")]);
      return add("event_msg", { type: "turn_aborted", reason: "interrupted" });
    },
    fail: (message) => add("event_msg", { type: "error", message }),
    /** Codex compacts its own context, as a task of its own or inside one: its summary sealed unless one is given. */
    compact(message = "", { alone = true } = {}) {
      if (alone) add("event_msg", { type: "task_started", turn_id: `t${ord}` });
      add("compacted", { message, replacement_history: [{ type: "compaction", encrypted_content: "gAAAA-sealed" }] });
      item({ type: "ContextCompaction", id: `k${ord}` });
      return alone ? add("event_msg", { type: "task_complete", turn_id: `t${ord}` }) : r;
    },
    text: () => lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  };
  add("session_meta", {
    id,
    session_id: id,
    timestamp: new Date(T0 + sec * 1000).toISOString(),
    cwd,
    originator,
    cli_version: "0.154.0",
    source,
    model_provider: "openai",
    base_instructions: { text: "You are Codex, a coding agent." },
    git: { commit_hash: "abc", branch: "main" },
    ...(fork ? { forked_from_id: fork.from, forked_from_ordinal_exclusive: fork.at, history_base: { thread_id: fork.from, end_ordinal_exclusive: fork.at, end_byte_offset: 1 } } : {}),
  });
  return r;
}
/** A turn of words alone. */
const plain = (r, question, answer) => r.ask(question).think().say(answer, "final_answer").done();
/** A home folder with Codex's sessions under it, in its dated folders. */
function homeOf(name) {
  const home = join(dir, name);
  const root = join(home, ".codex", "sessions");
  const day = join(root, "2026", "09", "02");
  mkdirSync(day, { recursive: true });
  const file = (id) => join(day, `rollout-2026-09-02T08-00-00-${id}.jsonl`);
  return {
    home,
    root,
    file,
    write: (r) => writeFileSync(file(r.id), r.text()),
    writeText: (id, text) => writeFileSync(file(id), text),
    append: (r, from) => appendFileSync(file(r.id), r.lines.slice(from).map((l) => JSON.stringify(l)).join("\n") + "\n"),
  };
}
const chainOf = (a, id) => a.chainsWithKeyPrefix("cx:").find((c) => c.key === `cx:${id}`) || null;
const msg = (a, hash) => a.getMessage(hash).message;
const said = (a, hash) => {
  const m = msg(a, hash);
  return typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? "").join("");
};
const workOf = (a, t) => t.work.map((h) => msg(a, h));
const usersOf = (a, c) => a.getTurns(c.id).map((t) => said(a, t.user_hash));
const SEALED = { by: "Codex", exact: true, how: "agent-own" };

// (fails before: yes — MEMR-10: a line of the chat past V8's string limit failed the whole chat; past 256 MiB a line is
// left out, named in the import's report, and the rest of the chat comes in)
test("a Codex chat with a line past 256 MiB comes in without that line, and the import's report names it", async () => {
  const a = openArchive();
  const h = homeOf("huge");
  const r = rollout(idOf(90));
  plain(r, "how is the parser built?", "With a table.");
  const before = r.text();
  const from = r.lines.length;
  plain(r, "and the lexer?", "By hand.");
  const f = h.file(r.id);
  writeWithLongLine(f, before, r.lines.slice(from).map((l) => JSON.stringify(l)).join("\n") + "\n");
  try {
    const got = await importCodex({ archive: a, root: h.root });
    assert.deepEqual([got.errors, got.long], [[], [{ file: `rollout-2026-09-02T08-00-00-${r.id}.jsonl`, line: from + 1, bytes: PAST_A_LINE }]]);
    assert.equal(chainOf(a, r.id).turns, 2, "the rest of the chat came in");
  } finally {
    rmSync(f, { force: true });
  }
});

// ---- the reader ------------------------------------------------------------------------------------------------------
// (fails before: yes — Filament read no Codex file at all; there was no reader)
test("a Codex chat's turns are the person's words and the model's: what Codex told its model beside them is no message", () => {
  const r = rollout(idOf(1));
  plain(r, "How do I list files?", "Use ls.");
  r.ask("And hidden ones?").think().say("Looking.").say("Use ls -a.", "final_answer").done();
  const s = parseCodexSession(r.text());
  assert.deepEqual([s.sessionId, s.cwd, s.originator, s.version, s.gitBranch, s.own, s.subagent, s.forkedFrom], [idOf(1), CWD, "codex_cli_rs", "0.154.0", "main", false, false, null]);
  assert.equal(s.turns.length, 2);
  assert.deepEqual(s.turns[0].user, { role: "user", content: "How do I list files?" }, "the words the person typed, said once: no instructions, no folder, no plugins");
  assert.deepEqual(s.turns[0].work, [], "sealed reasoning with no summary leaves nothing");
  assert.deepEqual(s.turns[0].final, { role: "assistant", content: [{ type: "text", text: "Use ls." }] });
  assert.deepEqual(s.turns[0].meta, { format: "anthropic" }, "no token line, no numbers; no client: the chat names it (IM-58)");
  assert.equal(s.turns[0].model, "gpt-5.5");
  assert.deepEqual(s.turns[1].final.content.map((b) => b.text), ["Looking.", "Use ls -a."], "what it said along the way and its answer, in order, in the one reply");
  assert.equal(s.turns[0].at, T0 + 6000, "a turn begins when the person's words were written");
  assert.equal(s.turns[0].endAt, r.lines.findIndex((l) => l.payload.type === "task_complete") * 1000 + T0, "and ends when Codex's task did");
  assert.equal(s.skipped, 0);
});

// (fails before: yes — no reader)
test("a summary of the model's reasoning is a thought; a picture rides with the words it came with", () => {
  const r = rollout(idOf(2));
  r.ask("what is this?", {
    content: [
      { type: "input_text", text: "<image>" },
      { type: "input_image", image_url: "data:image/png;base64,AAAA" },
      { type: "input_text", text: "</image>" },
      { type: "input_text", text: "what is this?" },
    ],
  })
    .think("**Looking** at the picture")
    .say("A cat.", "final_answer")
    .done();
  const [t] = parseCodexSession(r.text()).turns;
  assert.deepEqual(t.user, { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }, { type: "text", text: "what is this?" }] }, "the picture and the words: the marks around the picture are Codex's");
  assert.deepEqual(t.final.content, [{ type: "thinking", thinking: "**Looking** at the picture" }, { type: "text", text: "A cat." }]);
});

// (fails before: yes — no reader)
test("what Codex did is written as the calls Filament's own Codex turns show: a read, a command, a change a file at a time, an MCP tool", () => {
  const r = rollout(idOf(3));
  r.ask("Fix the parser")
    .say("I'll look first.")
    .exec("c1", "const r = await tools.exec_command({ cmd: 'Get-Content src/parse.js' }); text(r.output)")
    .ran("i1", PS("Get-Content src/parse.js"), { parsed: [{ type: "read", cmd: "Get-Content src/parse.js", name: "parse.js", path: "src/parse.js" }], said: "export function parse() {}" })
    .out("c1", "Script completed\nexport function parse() {}")
    .exec("c2", "text((await tools.exec_command({ cmd: 'npm test' })).output)")
    .ran("i2", PS("npm test"), { said: "1 failing", exit: 1 })
    .out("c2", "Script completed\n1 failing")
    .exec("c3", "await tools.apply_patch('*** Begin Patch …')")
    .changed("i3", {
      "src/parse.js": { type: "update", unified_diff: "@@ -1 +1 @@\n-a\n+b\n", move_path: null },
      "src/new.js": { type: "add", content: "export const n = 1;\n" },
      "src/old.js": { type: "delete", content: "gone" },
    })
    .out("c3", "Script completed")
    .exec("c4", "await tools.mcp__docs__search({ q: 'parse' })")
    .mcp("i4", "docs", "search", { q: "parse" }, { result: { content: [{ type: "text", text: "two hits" }] } })
    .mcp("i5", "docs", "open", { id: 9 }, { error: { message: "no such page" } })
    .out("c4", "Script completed")
    .exec("c5", "await tools.exec_command({ cmd: 'npm run build' })")
    .out("c5", "Script running with cell ID 7")
    .wait("w1", "7")
    .ran("i6", PS("npm run build"), { said: "built" })
    .waited("w1", "Script completed\nbuilt")
    .exec("c6", "text(1 + 1)")
    .out("c6", "Script completed\n2")
    .exec("c7", "await tools.exec_command({ cmd: 'nope' })")
    .out("c7", "Script failed\nError: the command was refused")
    .say("Fixed.", "final_answer")
    .done();
  const s = parseCodexSession(r.text());
  assert.equal(s.skipped, 0);
  const [t] = s.turns;
  assert.deepEqual(t.work.map((m) => m.role), ["assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user"], "the model's turn and its calls' answers, one after the other");
  assert.deepEqual(t.work[0].content[0], { type: "text", text: "I'll look first." }, "its words come before the call they led to");
  assert.deepEqual(t.final, { role: "assistant", content: [{ type: "text", text: "Fixed." }] });
  const cards = toolsOfTurn(t.work, "anthropic");
  assert.deepEqual(
    cards.map((c) => [c.id, c.name, c.input, c.result, c.isError]),
    [
      ["i1", "read", { file_path: "src/parse.js" }, "export function parse() {}", false],
      ["i2", "bash", { command: "powershell.exe -Command 'npm test'" }, "1 failing", true],
      ["i3#0", "edit", { path: "src/parse.js", patch: "@@ -1 +1 @@\n-a\n+b\n" }, "", false],
      ["i3#1", "write", { path: "src/new.js", content: "export const n = 1;\n" }, "", false],
      ["i3#2", "delete", { path: "src/old.js", deleted: true }, "", false],
      ["i4", "mcp__docs__search", { q: "parse" }, "two hits", false],
      ["i5", "mcp__docs__open", { id: 9 }, "no such page", true],
      ["i6", "bash", { command: "powershell.exe -Command 'npm run build'" }, "built", false],
      ["c6", "exec", { input: "text(1 + 1)" }, "Script completed\n2", false],
      ["c7", "exec", { input: "await tools.exec_command({ cmd: 'nope' })" }, "Script failed\nError: the command was refused", true],
    ],
    "a script that ran a command is the command; one it waited on, too; one that ran nothing is kept as itself, failed where Codex says it failed",
  );
  assert.deepEqual(cards.slice(0, 4).map((c) => c.card.kind), ["read", "shell", "edit", "write"], "each is a card of Filament's own kinds");
  assert.equal(cards[1].card.subject, "npm test", "a command reads without the shell Codex wrapped it in");
  assert.equal(JSON.stringify(t.work.slice(0, 10)).includes("tools.exec_command"), false, "the script that asked is not kept beside what it did");
});

// (fails before: yes — no reader)
test("a command's words are joined as a shell would need them quoted", () => {
  assert.equal(shellWords(["git", "status"]), "git status");
  assert.equal(shellWords(["powershell.exe", "-Command", "Get-Content a.txt"]), "powershell.exe -Command 'Get-Content a.txt'");
  assert.equal(shellWords(["echo", "it's"]), 'echo "it\'s"');
  assert.equal(shellWords(["echo", ""]), "echo ''");
});

// (fails before: yes — no reader)
test("an older Codex file reads the same: no envelope, the shell tool a command, a patch an edit of its file, a plan a list", () => {
  const old = [
    { id: idOf(4), timestamp: "2025-06-01T09:00:00.000Z", instructions: "be brief", git: { branch: "dev" } },
    { record_type: "state" },
    { type: "message", role: "user", content: [{ type: "input_text", text: tagged("environment_context", "<cwd>C:\\proj\\old</cwd>") }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "rename it" }] },
    { type: "reasoning", summary: [{ type: "summary_text", text: "**Renaming** the file" }], encrypted_content: "x" },
    { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "mv a b"] }), call_id: "k1" },
    { type: "function_call_output", call_id: "k1", output: JSON.stringify({ output: "", metadata: { exit_code: 0, duration_seconds: 0.1 } }) },
    { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "ls c"] }), call_id: "k2" },
    { type: "function_call_output", call_id: "k2", output: JSON.stringify({ output: "ls: c: No such file", metadata: { exit_code: 2 } }) },
    { type: "function_call", name: "apply_patch", arguments: JSON.stringify({ input: "*** Begin Patch\n*** Update File: src/b.js\n@@\n-x\n+y\n*** End Patch" }), call_id: "k3" },
    { type: "function_call_output", call_id: "k3", output: JSON.stringify({ output: "Success", metadata: { exit_code: 0 } }) },
    { type: "function_call", name: "update_plan", arguments: JSON.stringify({ plan: [{ step: "rename", status: "completed" }, { step: "test", status: "pending" }] }), call_id: "k4" },
    { type: "function_call_output", call_id: "k4", output: "Plan updated" },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Renamed." }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "thanks" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Welcome." }] },
  ];
  const s = parseCodexSession(old.map((l) => JSON.stringify(l)).join("\n"));
  assert.deepEqual([s.sessionId, s.cwd, s.gitBranch, s.turns.length, s.skipped], [idOf(4), "C:\\proj\\old", "dev", 2, 0], "the folder is the one Codex told its model");
  const [one, two] = s.turns;
  assert.equal(one.user.content, "rename it");
  assert.deepEqual(one.work[0].content[0], { type: "thinking", thinking: "**Renaming** the file" });
  assert.deepEqual(
    toolsOfTurn(one.work, "anthropic").map((c) => [c.name, c.card.kind, c.input, c.result, c.isError]),
    [
      ["bash", "shell", { command: "bash -lc 'mv a b'" }, "", false],
      ["bash", "shell", { command: "bash -lc 'ls c'" }, "ls: c: No such file", true],
      ["apply_patch", "edit", { path: "src/b.js", patch: "*** Begin Patch\n*** Update File: src/b.js\n@@\n-x\n+y\n*** End Patch" }, "Success", false],
      ["update_plan", "todo", { items: [{ text: "rename", status: "completed" }, { text: "test", status: "pending" }] }, "Plan updated", false],
    ],
  );
  assert.equal(one.final.content[0].text, "Renamed.");
  assert.deepEqual([two.user.content, two.final.content[0].text], ["thanks", "Welcome."], "with no task lines, the next message ends a turn");
  assert.equal(one.at, Date.parse("2025-06-01T09:00:00.000Z"), "its lines carry no time: the session's stands in");
});

// (fails before: yes — no reader)
test("a turn the person stopped says so, a turn the service failed says why, and one Codex began by itself names Codex", () => {
  const r = rollout(idOf(5));
  r.ask("do the long thing").think().stop();
  r.ask("try again").say("Trying.").fail("stream disconnected before completion").done();
  r.ask("once more").fail("a hiccup").say("Recovered.", "final_answer").done();
  r.add("event_msg", { type: "task_started", turn_id: "bg" }).say("The background job finished.", "final_answer").done();
  const s = parseCodexSession(r.text());
  const [stopped, failed, went, own] = s.turns;
  assert.equal(s.turns.length, 4);
  assert.deepEqual(stopped.meta.stopped, { by: "codex", at: r.lines.find((l) => l.payload.type === "turn_aborted") && T0 + r.lines.findIndex((l) => l.payload.type === "turn_aborted") * 1000 });
  assert.equal(stopped.final, undefined, "no answer was written");
  assert.equal(stopped.user.content, "do the long thing", "the note Codex left its model about the stop is no message");
  assert.deepEqual(failed.meta.failed, { cause: "stream disconnected before completion" });
  assert.equal(failed.final, undefined, "a failed turn has no answer");
  assert.deepEqual(failed.work, [{ role: "assistant", content: [{ type: "text", text: "Trying." }] }], "what it said before failing is its work");
  assert.deepEqual([failed.meta.facts.error, failed.meta.facts.errors, failed.meta.facts.calls], ["stream disconnected before completion", 1, 0]);
  assert.equal(went.meta.failed, undefined, "it went on after the failure: the turn did not fail");
  assert.equal(went.final.content[0].text, "Recovered.");
  assert.deepEqual(own.user, { role: "user", content: [{ type: "text", text: ownTurnText("Codex", []) }] });
  assert.deepEqual(own.meta.own, { agent: "Codex" });
  assert.equal(own.final.content[0].text, "The background job finished.");
});

// (fails before: yes — a turn that ended on a call closed on that call: the page drew no card for it, and a model
// reading the chat was not told of the turn)
test("a turn that is over and never answered keeps all it did as its work and says how it ended; a file that simply ends mid-work stays as it is", () => {
  const r = rollout(idOf(7));
  r.ask("rewrite it all").say("Starting.").exec("c1", "…").ran("i1", PS("git status --short"), { said: " M a.js" }).out("c1", "Script completed").stop();
  r.ask("check the build").exec("c2", "…").ran("i2", PS("npm run build"), { said: "built" }).out("c2", "Script completed").done();
  r.ask("and the tests").exec("c3", "…").ran("i3", PS("npm test"), { said: "running" }).out("c3", "Script completed");
  const [stopped, silent, running] = parseCodexSession(r.text()).turns;
  assert.deepEqual(stopped.work.map((m) => [m.role, m.content.map((b) => b.type)]), [["assistant", ["text", "tool_use"]], ["user", ["tool_result"]]], "its words, its call and what the call returned, in the order they happened");
  assert.deepEqual(stopped.final, { role: "assistant", content: [{ type: "text", text: "(turn stopped in Codex)" }] }, "as Filament's own stopped turn answers");
  assert.deepEqual([stopped.cut, !!stopped.meta.stopped], [undefined, true]);
  assert.deepEqual(toolsOfTurn(stopped.work, "anthropic").map((c) => [c.card.subject, c.result]), [["git status --short", " M a.js"]], "the last call is a card like any other");
  assert.equal(silent.final.content[0].text, "(the turn ended in Codex with no answer)", "Codex ended its task on a call: no stop, no words");
  assert.equal(silent.work.length, 2);
  assert.deepEqual([running.cut, running.final.content.map((b) => b.type), running.work.map((m) => m.role)], [true, ["tool_use"], ["user"]], "the file ends there: the chat may go on, and a later read lays the turn out");
});

// (fails before: yes — no reader)
test("a turn's numbers are the thread's counts at its end less those at its start, and the model Codex named for it", () => {
  const r = rollout(idOf(6));
  r.ask("one").say("First.", "final_answer").tokens({ input_tokens: 1200, cached_input_tokens: 1000, cache_write_input_tokens: 50, output_tokens: 30, total_tokens: 1230 }).done();
  r.ask("two")
    .say("Checking.")
    .tokens({ input_tokens: 2700, cached_input_tokens: 2200, cache_write_input_tokens: 50, output_tokens: 70, total_tokens: 2770 }, { input_tokens: 1500, cached_input_tokens: 1200, output_tokens: 40 })
    .add("event_msg", { type: "token_count", info: null })
    .say("Second.", "final_answer")
    .tokens({ input_tokens: 4500, cached_input_tokens: 3900, cache_write_input_tokens: 80, output_tokens: 90, total_tokens: 4590 }, { input_tokens: 1800, cached_input_tokens: 1700, output_tokens: 20 })
    .done();
  const [one, two] = parseCodexSession(r.text()).turns;
  assert.deepEqual(one.meta.facts.tokens, { input: 200, output: 30, cacheRead: 1000, cacheWrite: 50 });
  assert.deepEqual([one.meta.facts.calls, one.meta.facts.held, one.meta.facts.model, one.meta.facts.costUsd], [1, 1200, "gpt-5.5", null], "Filament paid for none of it");
  assert.deepEqual(two.meta.facts.tokens, { input: 3300 - 2900, output: 60, cacheRead: 2900, cacheWrite: 30 }, "the second turn's alone");
  assert.deepEqual([two.meta.facts.calls, two.meta.facts.held], [2, 1800], "a count line that says nothing is no request; the last request held what it read");
  assert.equal(two.meta.facts.startedAt, two.at);
  assert.equal(two.meta.facts.endedAt, two.endAt);
});

// ---- into the archive ------------------------------------------------------------------------------------------------
// (fails before: yes — importCodex did not exist)
test("a Codex chat becomes a session of Filament's: its folder, its times, its turns; a second read writes nothing, a longer file adds its turn", async () => {
  const a = openArchive();
  const h = homeOf("grow");
  const r = rollout(idOf(10));
  plain(r, "How do I list files?", "Use ls.");
  r.ask("show me").exec("c1", "…").ran("i1", PS("ls"), { said: "a.txt" }).out("c1", "Script completed\na.txt").say("There.", "final_answer").tokens({ input_tokens: 900, cached_input_tokens: 0, output_tokens: 9 }).done();
  h.write(r);
  const first = await importCodex({ archive: a, root: h.root });
  assert.deepEqual([first.files, first.passed, first.newChains, first.newTurns, first.errors], [1, 0, 1, 2, []]);
  const c = chainOf(a, idOf(10));
  assert.deepEqual([c.client, c.turns, c.kind, c.meta.native], ["harness", 2, "interactive", true], "the harness's own chat (IM-58)");
  assert.deepEqual(
    { import: c.meta.import, sessionId: c.meta.sessionId, file: c.meta.file, gitBranch: c.meta.gitBranch, version: c.meta.version, mark: c.meta.mark },
    { import: "codex", sessionId: idOf(10), file: `rollout-2026-09-02T08-00-00-${idOf(10)}.jsonl`, gitBranch: "main", version: "0.154.0", mark: statSync(h.file(idOf(10))).size },
  );
  assert.deepEqual([a.getProject(c.project_id).cwd, a.getProject(c.project_id).name], [CWD, "gamma"], "filed under the folder Codex worked in");
  assert.equal(c.started_at, T0, "the chat's own times, not the import's");
  assert.equal(c.last_at, r.at);
  const turns = a.getTurns(c.id);
  assert.deepEqual(turns.map((t) => said(a, t.user_hash)), ["How do I list files?", "show me"]);
  assert.deepEqual(turns.map((t) => said(a, t.final_hash)), ["Use ls.", "There."]);
  assert.deepEqual(turns.map((t) => [t.meta.client, t.meta.format, t.model]), [["harness", "anthropic", "gpt-5.5"], ["harness", "anthropic", "gpt-5.5"]]);
  assert.deepEqual(toolsOfTurn(workOf(a, turns[1]), "anthropic").map((t) => [t.name, t.card.subject, t.result]), [["bash", "ls", "a.txt"]]);
  assert.equal(turns[1].meta.facts.tokens.input, 900);
  assert.equal(turns[0].started_at, T0 + 6000);

  const again = await importCodex({ archive: a, root: h.root });
  assert.deepEqual([again.newChains, again.newTurns, again.messages, again.compactions], [0, 0, 0, 0], "read twice, written once");
  const before = r.lines.length;
  plain(r, "and a third?", "Yes.");
  h.append(r, before);
  const grown = await chatStates(codexSource, { archive: a, where: h.root });
  assert.deepEqual(grown.map((x) => [x.agentSession, x.state, x.turns]), [[idOf(10), "grown", 2]], "the file grew past what was read");
  const third = await importCodex({ archive: a, root: h.root });
  assert.deepEqual([third.newChains, third.newTurns], [0, 1]);
  assert.equal((await chatStates(codexSource, { archive: a, where: h.root }))[0].state, "imported");
  assert.equal(chainOf(a, idOf(10)).last_at, r.at);
});

// (fails before: yes — importCodex did not exist; the sink kept no compaction without a summary, and a second read
// of one would have written it again)
test("Codex's own compaction: a summary it kept stands for the turns before it; a sealed one says so and stands for none; inside a turn it marks the turn", async () => {
  const a = openArchive();
  const h = homeOf("compact");
  const r = rollout(idOf(20));
  plain(r, "one", "First.");
  plain(r, "two", "Second.");
  r.compact(""); // sealed, between two turns
  plain(r, "three", "Third.");
  r.compact("Summary: the first three answers were given."); // one a reader can open
  r.ask("four").exec("c1", "…").ran("i1", PS("ls"), { said: "a" }).out("c1", "Script completed").compact("", { alone: false }).say("Fourth.", "final_answer").done();
  r.ask("five").exec("c2", "…").ran("i2", PS("dir"), { said: "b" }).out("c2", "Script completed").compact("Summary: mid-turn.", { alone: false }).say("Fifth.", "final_answer").done();
  h.write(r);
  const first = await importCodex({ archive: a, root: h.root });
  assert.deepEqual([first.newTurns, first.compactions, first.errors], [5, 3, []]);
  const c = chainOf(a, idOf(20));
  const rows = a.getCompactions(c.id);
  assert.deepEqual(
    rows.map((x) => [x.from_turn, x.to_turn, x.method, x.kind, x.summary_hash ? msg(a, x.summary_hash).content : null, x.detail]),
    [
      [1, 2, "own", "plain", null, SEALED],
      [1, 3, "own", "plain", "Summary: the first three answers were given.", SEALED],
      [1, 4, "own", "plain", "Summary: mid-turn.", { during: 5, cutAfter: "i2", ...SEALED }],
    ],
    "as Filament keeps a compaction of an agent it runs itself: with the summary, or saying none was handed over",
  );
  const turns = a.getTurns(c.id);
  assert.deepEqual(turns.map((t) => t.meta.ownCompaction ?? null), [null, null, null, { by: "Codex", left: "unsaid" }, null], "inside a turn, with no summary: the turn says Codex compacted in it");
  assert.equal(said(a, turns[3].final_hash), "Fourth.", "and the turn goes on to its answer");
  assert.equal(turns.length, 5, "a compaction is no turn");
  const again = await importCodex({ archive: a, root: h.root });
  assert.deepEqual([again.newTurns, again.compactions], [0, 0]);
  assert.equal(a.getCompactions(c.id).length, 3, "a sealed compaction is recorded once for its place");
});

// (fails before: yes — importCodex did not exist; the sink could make no fork)
test("a Codex fork that holds its own turns alone is Filament's fork of the chat it came from: the turns up to the fork, then its own", async () => {
  const a = openArchive();
  const h = homeOf("fork");
  const parent = rollout(idOf(30));
  plain(parent, "one", "First.");
  plain(parent, "two", "Second.");
  const at = parent.ordinal;
  plain(parent, "three", "Third.");
  const fork = rollout(idOf(31), { minute: 30, fork: { from: idOf(30), at } });
  plain(fork, "another third", "Other.");
  const at2 = fork.ordinal;
  plain(fork, "a fourth", "Four.");
  const second = rollout(idOf(32), { minute: 60, fork: { from: idOf(31), at: at2 } });
  plain(second, "from the fork", "Deeper.");
  const orphan = rollout(idOf(33), { minute: 90, fork: { from: idOf(99), at: 40 } });
  plain(orphan, "alone", "Here.");
  for (const r of [parent, fork, second, orphan]) h.write(r);

  const out = await importCodex({ archive: a, root: h.root });
  assert.deepEqual([out.files, out.newChains, out.newTurns, out.errors], [4, 4, 3 + 2 + 1 + 1, []], "a fork's turns from its source are not written again");
  const [P, F, S, O] = [30, 31, 32, 33].map((n) => chainOf(a, idOf(n)));
  const users = (c) => a.getTurns(c.id).map((t) => said(a, t.user_hash));
  assert.deepEqual(users(P), ["one", "two", "three"]);
  assert.deepEqual(users(F), ["one", "two", "another third", "a fourth"]);
  assert.deepEqual(users(S), ["one", "two", "another third", "from the fork"], "a fork of a fork counts from its source's own fork");
  assert.deepEqual(users(O), ["alone"], "its source is not in Filament: a chat of its own turns");
  assert.deepEqual([F.kind, F.meta.fork.from, F.meta.fork.atTurn, S.meta.fork.from, S.meta.fork.atTurn], ["fork", P.id, 2, F.id, 3]);
  assert.deepEqual([O.kind, O.meta.fork ?? null, O.meta.forkedFrom], ["interactive", null, idOf(99)], "it still says what it was forked from");
  assert.deepEqual([F.meta.import, F.meta.sessionId, F.meta.forkedFrom, F.client, F.meta.native], ["codex", idOf(31), idOf(30), "harness", true], "the fork is a chat from Codex too, and the harness's as its source is");
  assert.deepEqual(a.getTurns(F.id).slice(0, 2).map((t) => t.user_hash), a.getTurns(P.id).slice(0, 2).map((t) => t.user_hash), "the same messages, none copied");
  assert.equal(a.linksFor(F.id).some((l) => l.type === "forked"), true);
  assert.equal(F.title, "one (fork at turn 2)", "named as Filament names a fork");
  assert.equal(F.meta.mark, statSync(h.file(idOf(31))).size);

  const again = await importCodex({ archive: a, root: h.root });
  assert.deepEqual([again.newChains, again.newTurns, again.messages], [0, 0, 0], "a second read: the fork's own turns are found after its source's");
  assert.deepEqual(users(chainOf(a, idOf(31))), ["one", "two", "another third", "a fourth"]);
  const before = fork.lines.length;
  plain(fork, "a fifth", "Five.");
  h.append(fork, before);
  assert.equal((await importCodex({ archive: a, root: h.root })).newTurns, 1);
  assert.deepEqual(users(chainOf(a, idOf(31))).slice(-2), ["a fourth", "a fifth"]);
});

// (fails before: yes — importCodex did not exist)
test("a compaction in a fork's own turns stands at the fork's turn numbers", async () => {
  const a = openArchive();
  const h = homeOf("fork-compact");
  const parent = rollout(idOf(40));
  plain(parent, "one", "First.");
  plain(parent, "two", "Second.");
  const fork = rollout(idOf(41), { minute: 30, fork: { from: idOf(40), at: parent.ordinal } });
  fork.compact("");
  plain(fork, "three", "Third.");
  fork.compact("Summary: three so far.");
  h.write(parent);
  h.write(fork);
  await importCodex({ archive: a, root: h.root });
  const rows = a.getCompactions(chainOf(a, idOf(41)).id);
  assert.deepEqual(rows.map((x) => [x.to_turn, x.summary_hash == null]), [[3, false]], "before any turn of its own there is nothing of the fork's to stand for; after its first, the fork's three");
});

// (fails before: yes — a fork brought in without the chat it came from began mid-way, with its own turns alone; and
// a fork nobody wrote in made no session and stayed "new", so every Sync counted it again)
test("a fork chosen by itself reads whole, the turns it took read from its source's file; a fork nobody wrote in is empty, and not new again until it grows", async () => {
  const a = openArchive();
  const h = homeOf("fork-alone");
  const parent = rollout(idOf(70));
  plain(parent, "one", "First.");
  parent.compact("Summary: one.");
  plain(parent, "two", "Second.");
  const at = parent.ordinal;
  plain(parent, "three", "Third.");
  const fork = rollout(idOf(71), { minute: 30, fork: { from: idOf(70), at } });
  plain(fork, "another third", "Other.");
  const deeper = rollout(idOf(72), { minute: 60, fork: { from: idOf(71), at: fork.ordinal } });
  plain(deeper, "from the fork", "Deeper.");
  const hollow = rollout(idOf(73), { minute: 90, fork: { from: idOf(70), at } });
  for (const r of [parent, fork, deeper, hollow]) h.write(r);
  const stateOf = async (id) => (await chatStates(codexSource, { archive: a, where: h.root, empty: importState(a).empty })).find((c) => c.agentSession === id).state;

  const one = await importCodex({ archive: a, root: h.root, only: new Set([idOf(71)]) });
  assert.deepEqual([one.newChains, one.newTurns, one.compactions, one.empty, one.errors], [1, 3, 1, [], []]);
  const F = chainOf(a, idOf(71));
  assert.deepEqual(usersOf(a, F), ["one", "two", "another third"], "no chat that begins mid-way: what it stood on comes first");
  assert.deepEqual([F.kind, F.meta.fork ?? null, F.meta.taken, F.meta.forkedFrom], ["interactive", null, 2, idOf(70)], "its source is not in Filament, so it is a chat of its own, and says how many turns it took");
  assert.equal(F.title, "one (fork at turn 2)", "named as Filament names a fork, so it is told from the chat it came from");
  a.setTitle(F.id, "my own name for it");
  assert.deepEqual(a.getCompactions(F.id).map((x) => [x.to_turn, msg(a, x.summary_hash).content]), [[1, "Summary: one."]], "a compaction among the turns it took stands where it stood");
  assert.equal(chainOf(a, idOf(70)), null, "the chat it came from was not asked for, and is not brought in");
  assert.deepEqual(await importCodex({ archive: a, root: h.root, only: new Set([idOf(71)]) }).then((o) => [o.newTurns, o.messages, o.compactions]), [0, 0, 0], "read again: nothing new");

  // A fork of that one: Filament has its source now, so it is Filament's fork, counted past the turns the source took.
  await importCodex({ archive: a, root: h.root, only: new Set([idOf(72)]) });
  const D = chainOf(a, idOf(72));
  assert.deepEqual([D.kind, D.meta.fork.from, D.meta.fork.atTurn], ["fork", F.id, 3]);
  assert.deepEqual(usersOf(a, D), ["one", "two", "another third", "from the fork"]);

  // A fork nobody wrote in: no turn of its own, so no session; remembered, with how big its file was.
  const none = await importCodex({ archive: a, root: h.root, only: new Set([idOf(73)]) });
  assert.deepEqual([none.newChains, none.empty], [0, [{ key: `cx:${idOf(73)}`, mark: statSync(h.file(idOf(73))).size }]]);
  assert.equal(await stateOf(idOf(73)), "new", "until the run's end is noted, it is as it was");
  noteEmpty(a, none.empty);
  assert.equal(await stateOf(idOf(73)), "empty");
  assert.deepEqual(pendingOf(await chatStates(codexSource, { archive: a, where: h.root, empty: importState(a).empty }), { reachDays: 0, now: Date.now() }).map((c) => c.agentSession), [idOf(70)], "a Sync would bring the one chat not read yet, and not the empty one");
  const before = hollow.lines.length;
  plain(hollow, "written in at last", "Now there is a turn.");
  h.append(hollow, before);
  assert.equal(await stateOf(idOf(73)), "new", "its file grew: it is read again");

  // Everything: the source comes in as itself, the forks stay as they are, the one written in becomes Filament's fork.
  const all = await importCodex({ archive: a, root: h.root });
  assert.deepEqual([all.newChains, all.empty, all.errors], [2, [], []]);
  assert.deepEqual(usersOf(a, chainOf(a, idOf(70))), ["one", "two", "three"]);
  assert.deepEqual(usersOf(a, chainOf(a, idOf(71))), ["one", "two", "another third"]);
  assert.equal(chainOf(a, idOf(71)).title, "my own name for it", "a later read leaves the person's name for it alone");
  assert.deepEqual([chainOf(a, idOf(73)).kind, usersOf(a, chainOf(a, idOf(73)))], ["fork", ["one", "two", "written in at last"]]);
});

// (fails before: yes — importCodex and codexChats did not exist)
test("the list of Codex's chats: a chat Filament ran itself says so and is passed over, a sub-agent's thread is no chat, a row shows the first words typed", async () => {
  const a = openArchive();
  const h = homeOf("list");
  const mine = rollout(idOf(50));
  plain(mine, "How do I list files?\nSecond line", "Use ls.");
  const filaments = rollout(idOf(51), { originator: "filament", source: "vscode", minute: 5 });
  plain(filaments, "a turn Filament ran", "Done.");
  const sub = rollout(idOf(52), { source: { subagent: { thread_spawn: { parent_thread_id: idOf(50), depth: 1 } } }, minute: 9 });
  plain(sub, "a brief from the parent agent", "Did it.");
  for (const r of [mine, filaments, sub]) h.write(r);

  const chats = codexChats(h.root).sort((x, y) => x.startedAt - y.startedAt);
  assert.deepEqual(
    chats.map((c) => ({ ...c, lastAt: typeof c.lastAt })),
    [
      { id: idOf(50), key: `cx:${idOf(50)}`, agentSession: idOf(50), file: `rollout-2026-09-02T08-00-00-${idOf(50)}.jsonl`, cwd: CWD, preview: "How do I list files?", startedAt: T0, lastAt: "number", bytes: statSync(h.file(idOf(50))).size, mark: statSync(h.file(idOf(50))).size },
      { id: idOf(51), key: `cx:${idOf(51)}`, agentSession: idOf(51), file: `rollout-2026-09-02T08-00-00-${idOf(51)}.jsonl`, cwd: CWD, preview: "a turn Filament ran", startedAt: T0 + 5 * 60_000, lastAt: "number", bytes: statSync(h.file(idOf(51))).size, mark: statSync(h.file(idOf(51))).size, own: true },
    ],
    "the row's label is the first line the person typed, never what Codex told its model",
  );
  assert.deepEqual(Object.fromEntries((await chatStates(codexSource, { archive: a, where: h.root })).map((c) => [c.agentSession, c.state])), { [idOf(50)]: "new", [idOf(51)]: "own" });
  assert.equal(codexSource.where(h.home), h.root);
  assert.equal(codexSource.found(h.root), true);
  assert.equal(codexSource.found(join(dir, "nowhere")), false);

  const out = await importCodex({ archive: a, root: h.root });
  assert.deepEqual([out.files, out.passed, out.newChains, out.newTurns], [3, 2, 1, 1], "Filament's own and the sub-agent's are passed over, and counted");
  assert.deepEqual(a.chainsWithKeyPrefix("cx:").map((c) => c.key), [`cx:${idOf(50)}`]);
  const named = await importCodex({ archive: a, root: h.root, only: new Set([idOf(51)]) });
  assert.deepEqual([named.files, named.passed, named.newChains], [1, 1, 0], "asked for by name, Filament's own is still a session already");
  assert.deepEqual(await importCodex({ archive: a, root: join(dir, "nowhere") }).then((o) => [o.files, o.newChains]), [0, 0], "no folder: nothing to bring");
  const dry = await importCodex({ root: h.root, dryRun: true });
  assert.deepEqual([dry.newChains, dry.newTurns, dry.dryRun], [1, 1, true], "a dry run counts and writes nothing");
});

// ---- the routes ------------------------------------------------------------------------------------------------------
const json = async (res) => ({ status: res.status, body: await res.json() });
// (fails before: yes — the section listed Claude Code alone; Codex's chats could not be seen, chosen or synced)
test("the Import section lists Codex beside Claude Code, brings its chats in, and the chat opens with Filament's cards", async () => {
  const h = homeOf("routes");
  const r = rollout(idOf(60));
  r.ask("Fix the parser")
    .say("Reading it.")
    .exec("c1", "…")
    .ran("i1", PS("Get-Content src/parse.js"), { parsed: [{ type: "read", cmd: "Get-Content src/parse.js", name: "parse.js", path: "src/parse.js" }], said: "export function parse() {}" })
    .out("c1", "Script completed")
    .say("Fixed.", "final_answer")
    .done();
  const own = rollout(idOf(61), { originator: "filament", minute: 5 });
  plain(own, "a turn Filament ran", "Done.");
  const hollow = rollout(idOf(62), { minute: 9, fork: { from: idOf(60), at: r.ordinal } });
  for (const x of [r, own, hollow]) h.write(x);
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  const get = (path) => shim.api(`/api/memory/import/${path}`).then(json);
  const send = (method, path, body) => shim.api(`/api/memory/import/${path}`, { method, body }).then(json);
  const finished = async (id) => until(async () => { const j = await (await shim.api(`/api/memory/jobs/${id}`)).json(); return j.status === "running" ? null : j; }, `job ${id} to end`);
  try {
    const before = await get("overview");
    const row = before.body.sources.find((s) => s.id === "codex");
    assert.deepEqual(
      { label: row.label, where: row.where, found: row.found, on: row.on, chats: row.chats, projects: row.projects, states: row.states, pending: row.pending.chats },
      { label: "Codex", where: h.root, found: true, on: false, chats: 3, projects: 1, states: { new: 2, own: 1 }, pending: 2 },
      "Filament's own chat is counted, and no Sync would bring it",
    );
    const list = await get("chats?source=codex");
    assert.deepEqual(list.body.chats.map((c) => [c.agentSession, c.state, c.preview]).sort(), [[idOf(60), "new", "Fix the parser"], [idOf(61), "own", "a turn Filament ran"], [idOf(62), "new", null]]);
    const refused = await send("POST", "chosen", { source: "codex", chats: [idOf(61)] });
    assert.equal(refused.status, 400, "a chat Filament runs itself cannot be chosen");

    const started = await send("POST", "chosen", { source: "codex", chats: [idOf(60)] });
    assert.equal(started.status, 200);
    const job = await finished(started.body.job.id);
    assert.equal(job.status, "done");
    assert.equal(job.kind, "import-codex");
    const chain = chainOf(shim.app.memory.archive, idOf(60));
    assert.equal(chain.turns, 1);
    assert.deepEqual((await get("overview")).body.sources.find((s) => s.id === "codex").states, { imported: 1, new: 1, own: 1 });

    const listed = (await (await shim.api("/api/memory/sessions?limit=200&kind=interactive,fork")).json()).sessions;
    assert.equal(listed.find((s) => s.id === chain.id).importedFrom, "Codex", "its row names the agent it came from");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(chain.id)}/transcript`)).json();
    assert.equal(tr.turns.length, 1);
    assert.deepEqual(tr.turns[0].user, { role: "user", content: "Fix the parser" });
    assert.deepEqual(tr.turns[0].tools.map((t) => [t.name, t.card.kind, t.card.subject, t.result]), [["read", "read", "src/parse.js", "export function parse() {}"]], "the read is a file card, as in a Codex turn Filament runs");
    assert.deepEqual(tr.turns[0].final, { role: "assistant", content: [{ type: "text", text: "Fixed." }] });

    await send("PUT", "prefs", { on: ["codex"] });
    const synced = await (await shim.app.memory.importSync()).done;
    assert.deepEqual([synced.newTurns, synced.chats, synced.empty], [0, 0, 1], "a Sync after it reads the fork nobody wrote in, and brings nothing");
    const after = (await get("overview")).body;
    assert.deepEqual([after.sources.find((s) => s.id === "codex").states, after.sources.find((s) => s.id === "codex").pending.chats, after.last.empty], [{ imported: 1, empty: 1, own: 1 }, 0, 1], "which is then no new chat: nothing is left for a Sync");
    assert.equal((await (await shim.app.memory.importSync()).done).empty, undefined, "and is not read again");
    assert.equal(chainOf(shim.app.memory.archive, idOf(61)), null, "and Filament's own chat stays out");
  } finally {
    await shim.stop();
  }
});
