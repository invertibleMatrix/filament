// @ts-check
// The tool vocabulary (HarnessV3 Step 3 D5): every translation the plan pins, ours ↔ Claude Code, both ways,
// units included — and everything without an equivalent folds (null), never a guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalOf, buildCall, callLines, cardOf, kindOfName, keptCardOf, pathsWritten, toolsOfTurn, ROLE_NAMES } from "../src/core/tool-vocab.js";
import { HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { PLAN_TOOL, DELEGATE_READ_TOOL } from "../src/app/agent/tools.js";
import { WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from "../src/adapters/tools/web-hands.js";

const schema = (obj) => ({ type: "object", ...obj });
// Ours as the loop declares them: the real schemas, not a copy of them.
const OURS = [...HAND_TOOLS, PLAN_TOOL, DELEGATE_READ_TOOL, WEB_FETCH_TOOL, WEB_SEARCH_TOOL].map((t) => ({ name: t.name, schema: t.input_schema }));
// The Claude Code vocabulary (the field words are Claude Code's own).
const CC = [
  { name: "Read", schema: schema({ required: ["file_path"], properties: { file_path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" }, pages: { type: "string" } } }) },
  { name: "Write", schema: schema({ required: ["file_path", "content"], properties: { file_path: { type: "string" }, content: { type: "string" } } }) },
  { name: "Edit", schema: schema({ required: ["file_path", "old_string", "new_string"], properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } } }) },
  { name: "MultiEdit", schema: schema({ required: ["file_path", "edits"], properties: { file_path: { type: "string" }, edits: { type: "array", items: { type: "object", required: ["old_string", "new_string"], properties: { old_string: { type: "string" }, new_string: { type: "string" } } } } } }) },
  { name: "Bash", schema: schema({ required: ["command"], properties: { command: { type: "string" }, timeout: { type: "number", description: "milliseconds" } } }) },
  { name: "Glob", schema: schema({ required: ["pattern"], properties: { pattern: { type: "string" }, path: { type: "string" } } }) },
  { name: "Grep", schema: schema({ required: ["pattern"], properties: { pattern: { type: "string" }, path: { type: "string" }, glob: { type: "string" }, type: { type: "string" }, output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] }, "-i": { type: "boolean" }, "-n": { type: "boolean" }, "-A": { type: "number" }, "-B": { type: "number" }, "-C": { type: "number" }, multiline: { type: "boolean" }, head_limit: { type: "number" }, offset: { type: "number" } } }) },
  { name: "TodoWrite", schema: schema({ required: ["todos"], properties: { todos: { type: "array", items: { type: "object", required: ["content", "status", "activeForm"], properties: { content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] }, activeForm: { type: "string" } } } } } }) },
  { name: "Task", schema: schema({ required: [], properties: {} }) },
  { name: "WebFetch", schema: schema({ required: ["url", "prompt"], properties: { url: { type: "string" }, prompt: { type: "string" } } }) },
  { name: "WebSearch", schema: schema({ required: ["query"], properties: { query: { type: "string" } } }) },
  { name: "LS", schema: schema({ properties: { path: { type: "string" } } }) },
].map((t) => ({ name: t.name, schema: t.schema }));

/** Read a call from `name` and build it against `target`, the pinned round trip. */
const round = (name, input, target) => {
  const canon = canonicalOf(name, input);
  assert.ok(canon, `${name} is recognized`);
  return buildCall(canon.kind, canon.fields, target, canon.extra);
};

test("read translates both ways, field aliases included", () => {
  assert.deepEqual(round("read", { path: "src/app.js", offset: 10, limit: 5 }, CC), { name: "Read", input: { file_path: "src/app.js", offset: 10, limit: 5 } });
  assert.deepEqual(round("Read", { file_path: "src/app.js", offset: 10, limit: 5 }, OURS), { name: "read", input: { path: "src/app.js", offset: 10, limit: 5 } });
  // HarnessV3-Tools TL-D26: a PDF's page range crosses both ways; a reader with no pages can't take it. (fails before)
  assert.deepEqual(round("read", { path: "spec.pdf", pages: "3-7" }, CC), { name: "Read", input: { file_path: "spec.pdf", pages: "3-7" } });
  assert.deepEqual(round("Read", { file_path: "spec.pdf", pages: "3-7" }, OURS), { name: "read", input: { path: "spec.pdf", pages: "3-7" } });
  assert.equal(round("read", { path: "spec.pdf", pages: "3" }, [{ name: "read_file", schema: { type: "object", required: ["path"], properties: { path: { type: "string" } } } }]), null);
});

test("write translates both ways", () => {
  assert.deepEqual(round("write", { path: "a.txt", content: "hi" }, CC), { name: "Write", input: { file_path: "a.txt", content: "hi" } });
  assert.deepEqual(round("Write", { file_path: "a.txt", content: "hi" }, OURS), { name: "write", input: { path: "a.txt", content: "hi" } });
});

test("edit: one edit ↔ Edit; several ↔ MultiEdit when declared, otherwise no", () => {
  const one = [{ oldText: "a", newText: "b" }];
  const two = [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }];
  assert.deepEqual(round("edit", { path: "f.js", edits: one }, CC), { name: "Edit", input: { file_path: "f.js", old_string: "a", new_string: "b" } });
  assert.deepEqual(round("Edit", { file_path: "f.js", old_string: "a", new_string: "b" }, OURS), { name: "edit", input: { path: "f.js", edits: one } });
  assert.deepEqual(round("edit", { path: "f.js", edits: two }, CC), { name: "MultiEdit", input: { file_path: "f.js", edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] } });
  assert.deepEqual(round("MultiEdit", { file_path: "f.js", edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] }, OURS), { name: "edit", input: { path: "f.js", edits: two } });
  // several edits with only the pair tool declared: no translation, never two calls.
  const ccEditOnly = CC.filter((t) => t.name === "Edit");
  assert.equal(round("edit", { path: "f.js", edits: two }, ccEditOnly), null);
});

// (fails before: an Edit's replace_all reached a target that has the field without it — one replacement for many —
// and ours had no way to say it at all)
test("edit: replaceAll belongs to each edit, carried both ways, and refused where the target cannot say it (TL2)", () => {
  const ra = { replace_all: { type: "boolean" } };
  const CC_RA = CC.map((t) =>
    t.name === "Edit" ? { name: t.name, schema: { ...t.schema, properties: { ...t.schema.properties, ...ra } } }
    : t.name === "MultiEdit" ? { name: t.name, schema: { ...t.schema, properties: { ...t.schema.properties, edits: { ...t.schema.properties.edits, items: { ...t.schema.properties.edits.items, properties: { ...t.schema.properties.edits.items.properties, ...ra } } } } } }
    : t);
  const all = [{ oldText: "a", newText: "b", replaceAll: true }];
  assert.deepEqual(round("Edit", { file_path: "f.js", old_string: "a", new_string: "b", replace_all: true }, OURS), { name: "edit", input: { path: "f.js", edits: all } });
  assert.deepEqual(round("edit", { path: "f.js", edits: all }, CC_RA), { name: "Edit", input: { file_path: "f.js", old_string: "a", new_string: "b", replace_all: true } });
  assert.deepEqual(round("Edit", { file_path: "f.js", old_string: "a", new_string: "b", replace_all: true }, CC_RA), { name: "Edit", input: { file_path: "f.js", old_string: "a", new_string: "b", replace_all: true } });
  assert.deepEqual(
    round("edit", { path: "f.js", edits: [...all, { oldText: "c", newText: "d" }] }, CC_RA),
    { name: "MultiEdit", input: { file_path: "f.js", edits: [{ old_string: "a", new_string: "b", replace_all: true }, { old_string: "c", new_string: "d" }] } },
  );
  assert.equal(round("edit", { path: "f.js", edits: all }, CC), null, "an Edit without replace_all cannot say it: no translation, never one replacement for many");
  assert.deepEqual(round("Edit", { file_path: "f.js", old_string: "a", new_string: "b", replace_all: false }, OURS), { name: "edit", input: { path: "f.js", edits: [{ oldText: "a", newText: "b" }] } });
});

test("shell translates with the timeout converted, seconds ours and milliseconds Claude Code's", () => {
  assert.deepEqual(round("bash", { command: "npm test", timeout: 30 }, CC), { name: "Bash", input: { command: "npm test", timeout: 30000 } });
  assert.deepEqual(round("Bash", { command: "npm test", timeout: 5000 }, OURS), { name: "bash", input: { command: "npm test", timeout: 5 } });
});

// (fails before: yes — the hunt of 11-08: Claude Code's Bash says what its command is for in `description`, which ours
// has no field for, so a Claude Code turn that ran a command folded whole on its way to the loop)
test("shell: Claude Code's description of a command is cosmetic, carried only where the target declares it", () => {
  assert.deepEqual(round("Bash", { command: "git status --short", description: "See what changed" }, OURS), { name: "bash", input: { command: "git status --short" } });
  const described = [{ name: "Bash", schema: schema({ required: ["command"], properties: { command: { type: "string" }, description: { type: "string" } } }) }];
  assert.deepEqual(round("Bash", { command: "ls", description: "List" }, described), { name: "Bash", input: { command: "ls", description: "List" } });
  // Running in the background is no cosmetic: ours runs that with bash_background, so the call folds.
  assert.equal(round("Bash", { command: "npm run dev", description: "Start", run_in_background: true }, OURS), null);
});

test("list translates; LS's path-only shape finds no pattern in ours and folds", () => {
  assert.deepEqual(round("glob", { pattern: "src/**/*.js" }, CC), { name: "Glob", input: { pattern: "src/**/*.js" } });
  assert.deepEqual(round("Glob", { pattern: "src/**/*.js", path: "lib" }, OURS), { name: "glob", input: { pattern: "src/**/*.js", path: "lib" } });
  assert.equal(round("LS", { path: "src" }, OURS), null);
  // HarnessV3-Tools TL-D20: the order is presentation, so the call still crosses to a Glob that has no sort (Claude
  // Code's lists the newest first anyway); ours declares it and keeps it. (fails before: sort folded the call)
  assert.deepEqual(round("glob", { pattern: "*.log", sort: "modified" }, CC), { name: "Glob", input: { pattern: "*.log" } });
  assert.deepEqual(round("glob", { pattern: "*.log", sort: "modified" }, OURS), { name: "glob", input: { pattern: "*.log", sort: "modified" } });
});

test("search translates every field both ways, the output modes' one different word mapped; literal means no", () => {
  assert.deepEqual(round("grep", { pattern: "todo", path: "src", glob: "*.js", limit: 20 }, CC), { name: "Grep", input: { pattern: "todo", path: "src", glob: "*.js", head_limit: 20 } });
  assert.deepEqual(round("Grep", { pattern: "todo", head_limit: 20 }, OURS), { name: "grep", input: { pattern: "todo", limit: 20 } });
  // HarnessV3-Tools TL4 (TL-D8). (fails before: output_mode, type, context, multiline and offset did not cross — the call folded)
  assert.deepEqual(
    round("Grep", { pattern: "todo", output_mode: "files_with_matches", type: "js", "-i": true, "-n": true, "-C": 2, "-A": 3, multiline: true, head_limit: 50, offset: 10 }, OURS),
    { name: "grep", input: { pattern: "todo", output: "files", type: "js", ignoreCase: true, context: 2, after: 3, multiline: true, limit: 50, offset: 10 } },
  );
  assert.deepEqual(round("grep", { pattern: "todo", output: "files", before: 1, offset: 5 }, CC), { name: "Grep", input: { pattern: "todo", output_mode: "files_with_matches", "-B": 1, offset: 5 } });
  assert.deepEqual(round("Grep", { pattern: "todo", output_mode: "count" }, OURS), { name: "grep", input: { pattern: "todo", output: "count" } });
  assert.deepEqual(round("grep", { pattern: "todo", output: "content" }, CC), { name: "Grep", input: { pattern: "todo", output_mode: "content" } });
  assert.equal(round("grep", { pattern: "todo", literal: true }, CC), null, "literal has no clean equivalent");
});

test("todo translates with the status words mapped; a word with no equivalent folds", () => {
  assert.deepEqual(
    round("plan", { items: [{ text: "fix it", status: "doing" }, { text: "ship", status: "pending" }] }, CC),
    { name: "TodoWrite", input: { todos: [{ content: "fix it", status: "in_progress", activeForm: "fix it" }, { content: "ship", status: "pending", activeForm: "ship" }] } },
  );
  assert.deepEqual(
    round("TodoWrite", { todos: [{ content: "fix it", status: "in_progress", activeForm: "Fixing it" }, { content: "done thing", status: "completed", activeForm: "Done" }] }, OURS),
    { name: "plan", input: { items: [{ text: "fix it", status: "doing" }, { text: "done thing", status: "done" }] } },
  );
  assert.equal(round("plan", { items: [{ text: "stuck", status: "blocked" }] }, CC), null, "blocked has no Claude Code word");
});

test("web-fetch never translates: Claude Code's prompt has no equivalent; web-search does", () => {
  assert.equal(round("web_fetch", { url: "https://x" }, CC), null);
  assert.equal(round("WebFetch", { url: "https://x", prompt: "summarize" }, OURS), null);
  assert.deepEqual(round("web_search", { query: "q" }, CC), { name: "WebSearch", input: { query: "q" } });
  assert.deepEqual(round("WebSearch", { query: "q" }, OURS), { name: "web_search", input: { query: "q" } });
});

test("subagent and ask never translate", () => {
  assert.equal(round("delegate_read", { paths: ["a"], question: "q" }, CC), null, "Task and delegate_read mean different things");
  assert.equal(round("Task", { prompt: "go" }, OURS), null);
  assert.equal(round("ask", { question: "q?", options: [] }, CC), null, "the option shapes differ");
});

test("kindOfName: the table's names, any case; memory by prefix; mcp and unknown by no kind", () => {
  assert.equal(kindOfName("read"), "read");
  assert.equal(kindOfName("Read"), "read");
  assert.equal(kindOfName("read_file"), "read"); // Cursor's name, recognized
  assert.equal(kindOfName("run_terminal_cmd"), "shell");
  assert.equal(kindOfName("TodoWrite"), "todo");
  assert.equal(kindOfName("NotebookEdit"), "notebook", "in D5's first table: recognized, never translated");
  assert.equal(kindOfName("filament_recall"), "memory");
  assert.equal(kindOfName("filament_remember"), "memory");
  assert.equal(kindOfName("mcp__github__create_issue"), null, "mcp carries its server in the name: full name only, never a kind");
  assert.equal(kindOfName("frobnicate"), null);
  assert.equal(canonicalOf("frobnicate", {}), null, "unrecognized folds");
});

test("a malformed stored edit refuses the build instead of guessing", () => {
  // Claude Code's Edit missing its old_string: no candidate fits, the turn folds.
  const canon = canonicalOf("Edit", { file_path: "f.js", new_string: "b" });
  assert.ok(canon);
  assert.equal(buildCall(canon.kind, canon.fields, CC.filter((t) => t.name === "Edit"), canon.extra), null);
});

test("the timeout follows the spelling when it says the unit: a timeout_ms alias is milliseconds", () => {
  const cursorShell = [{ name: "run_terminal_cmd", schema: schema({ required: ["command"], properties: { command: { type: "string" }, timeout_ms: { type: "number" } } }) }];
  assert.deepEqual(round("bash", { command: "ls", timeout: 30 }, cursorShell), { name: "run_terminal_cmd", input: { command: "ls", timeout_ms: 30000 } });
  assert.deepEqual(round("run_terminal_cmd", { command: "ls", timeout_ms: 2000 }, OURS), { name: "bash", input: { command: "ls", timeout: 2 } });
});

test("ROLE_NAMES is the one table, exactly the six lists the bridge always asked by", () => {
  assert.deepEqual(ROLE_NAMES, {
    ask: ["AskUserQuestion", "ask_user_question", "ask_user", "askUser"],
    todo: ["TodoWrite", "todo_write", "update_plan", "TaskCreate"],
    read: ["Read", "read_file", "ReadFile", "view_file", "cat"],
    write: ["Write", "write_file", "WriteFile", "create_file"],
    edit: ["Edit", "edit_file", "str_replace_based_edit_tool", "str_replace_editor"],
    bash: ["Bash", "bash", "run_command", "execute_command", "shell", "Shell", "run_terminal_cmd"],
  });
});

test("a required property that cannot be filled refuses the build", () => {
  // A read with no path against Claude Code's Read (file_path required): refused, not guessed.
  assert.equal(round("read", { offset: 1 }, CC), null);
  assert.equal(round("Read", { offset: 1 }, OURS), null);
});

// (fails before: yes — HarnessV3-FailurePoints §6 item 3 and §8 item 2: a task's try kept none of its calls, and no
// call said which files a worker in the folder itself wrote)
test("a conversation's calls in their card's words, a failed one marked and secrets redacted; the files its write and edit calls named — in either wire format", () => {
  const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
  const convo = [
    { role: "user", content: [{ type: "text", text: "the brief" }] },
    { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "u1", name: "Read", input: { file_path: "src/parse.js" } }, { type: "tool_use", id: "u2", name: "Write", input: { file_path: "src/parse.js", content: "x" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "…" }, { type: "tool_result", tool_use_id: "u2", content: "denied", is_error: true }] },
    { role: "assistant", content: [{ type: "tool_use", id: "u3", name: "Bash", input: { command: `curl -H "x-api-key: ${KEY}" https://example.com` } }, { type: "tool_use", id: "u4", name: "Edit", input: { file_path: "src/lex.js", old_string: "a", new_string: "b" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "u3", content: "ok" }, { type: "tool_result", tool_use_id: "u4", content: "ok" }] },
    // OpenAI's chat format and its Responses format.
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "src/parse.js", content: "y" }) } }] },
    { role: "tool", tool_call_id: "c1", content: "ok" },
    { type: "function_call", call_id: "f1", name: "edit", arguments: JSON.stringify({ path: "docs/parse.md", old_string: "a", new_string: "b" }) },
    { type: "function_call_output", call_id: "f1", output: "ok" },
  ];
  const lines = callLines(convo);
  assert.deepEqual(lines.slice(0, 2), ["Read src/parse.js", "Write src/parse.js (failed)"]);
  assert.ok(lines[2].startsWith("Run curl") && !lines[2].includes(KEY), lines[2]);
  assert.deepEqual(lines.slice(3), ["Edit src/lex.js", "Write src/parse.js", "Edit docs/parse.md"]);
  // Each file once, in the order first written; a failed write wrote nothing, and a read is none.
  assert.deepEqual(pathsWritten(convo), ["src/lex.js", "src/parse.js", "docs/parse.md"]);
  assert.deepEqual([callLines(null), pathsWritten(undefined), callLines([{ role: "user", content: "hi" }])], [[], [], []]);
  // A call whose only subject is its name says it once; a path is kept as its call named it — the file the call wrote.
  // (fails before: yes — the path was trimmed, naming a file other than the one written)
  const plain = [
    { role: "assistant", content: [{ type: "tool_use", id: "p1", name: "ping", input: {} }, { type: "tool_use", id: "p2", name: "Write", input: { file_path: " notes.md", content: "x" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "p1", content: "pong" }, { type: "tool_result", tool_use_id: "p2", content: "ok" }] },
  ];
  assert.deepEqual([callLines(plain), pathsWritten(plain)], [["ping", "Write notes.md"], [" notes.md"]]);
});

// (fails before: yes — HarnessV4_Tasks U1: a call rebuilt from a run log holds the log's target as `{ input }`, which
// no field of the call names, so its card said "Read" and nothing of what it read; and B2: so does a call a coding
// agent named no input for, whose line in the next worker's brief said "Edit" and no file)
test("a call kept by its target alone: its card and its line name the target; a call's own fields stand, an unknown tool keeps its name", () => {
  assert.deepEqual(keptCardOf("read_file", { input: "src/parser.js" }), { kind: "read", title: "Read", subject: "src/parser.js" });
  assert.deepEqual(keptCardOf("Bash", { input: "cd /repo && npm run build" }), { kind: "shell", title: "Run", subject: "npm run build" }, "a command as its card says any");
  assert.equal(keptCardOf("grep", { input: "tokenize in src" }).subject, "tokenize in src");
  assert.equal(keptCardOf("Task", { input: "Map the parser" }).subject, "Map the parser", "a sub-agent's task, where its card had only the tool's name");
  const long = `${"deep/".repeat(30)}x.js`;
  assert.equal(keptCardOf("edit_file", { input: long }).subject, long, "a path stays whole: the page cuts it where it draws it");
  assert.equal(keptCardOf("read_file", { path: "src/a.js" }).subject, "src/a.js", "the turn's earlier, archived leg: the call's own field");
  assert.equal(keptCardOf("read_file", { path: "src/a.js", input: "x" }).subject, "src/a.js");
  assert.equal(keptCardOf("read_file", {}).subject, "", "the log kept no target");
  assert.equal(keptCardOf("read_file", { input: { path: "x" } }).subject, "");
  assert.deepEqual(keptCardOf("mcp__x__y", { input: "z" }), { kind: "mcp", title: "mcp__x__y", subject: "mcp__x__y" }, "named, never guessed");
  // A call as it runs is read by its own fields alone (`cardOf`): the target is a kept call's.
  assert.equal(cardOf("read_file", { input: "src/parser.js" }).subject, "");
  const work = [{ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "Read", input: { input: "src/parser.js" } }, { type: "tool_use", id: "c2", name: "edit", input: { input: "src/app.js" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "export function parse() {}" }, { type: "tool_result", tool_use_id: "c2", content: "no", is_error: true }] }];
  assert.deepEqual(toolsOfTurn(work, "anthropic").map((t) => [t.card.title, t.card.subject]), [["Read", "src/parser.js"], ["Edit", "src/app.js"]]);
  assert.equal(toolsOfTurn(work, "anthropic")[0].result, "export function parse() {}");
  assert.deepEqual(callLines(work), ["Read src/parser.js", "Edit src/app.js (failed)"]);
});
