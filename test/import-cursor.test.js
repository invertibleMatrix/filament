// Cursor's chats brought into Filament (HarnessV4_Import_Plan, step 3): the transcript reader (Cursor's tags and its
// own lines, the stamp, a message written again in its turn, a turn's end line), Cursor's calls written as the
// calls Filament draws, pictures, a file of the other make, the list (SDK agents and sub-agents are no chats, a chat
// Filament ran, a project's folder found from its name), the archive, and the Import section's routes for the
// agent. Everything is made up, in a temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { Archive } from "../src/archive.js";
import * as imports from "../src/memory-import.js";
import { chatStates, cursorChats, cursorSource, importCursor, listCursorFiles, parseCursorSession, pictureUnder, stampMs } from "../src/memory-import.js";
import { ownTurnText } from "../src/core/messages.js";
import { toolsOfTurn } from "../src/core/tool-vocab.js";
import { trajectoryProblem } from "../src/app/sessions/shapes.js";
import { archivedStubs, askAnswerWords } from "../src/ui/harness/conversation/tools/render.js";
import { factsOf } from "../src/ui/harness/conversation/tools/layout.js";
import { startApp } from "./helpers/app.js";
import { PAST_A_LINE, writeWithLongLine } from "./helpers/long-line.js";
import { until } from "./helpers/wait.js";

const dir = mkdtempSync(join(tmpdir(), "filament-import-cursor-"));
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

// ---- made-up Cursor transcripts --------------------------------------------------------------------------------------
const T0 = Date.parse("2026-09-02T03:00:00Z");
const MIN = 60_000;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A time as Cursor stamps a message with it: to the minute, on a clock five hours ahead of UTC. */
const stamp = (ms) => {
  const d = new Date(ms + 5 * 3600_000);
  const h = d.getUTCHours();
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} (UTC+5)`;
};
const idOf = (n) => `0c0c0c0c-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tagged = (tag, body) => `<${tag}>\n${body}\n</${tag}>`;
const REMINDER = "The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool.\n\nHere are the existing contents of your todo list:\n\n[1. [completed] Read the parser]";
/** A transcript being written, a line a call. Every method returns the chat. */
function chat(id) {
  const lines = [];
  const user = (text) => {
    lines.push({ role: "user", message: { content: [{ type: "text", text }] } });
    return c;
  };
  const c = {
    id,
    lines,
    /** A message of the person's, as Cursor wraps one: its stamp, what Cursor put beside it, the words. */
    ask: (words, { at = T0, beside = "" } = {}) => user(`<timestamp>${stamp(at)}</timestamp>\n${beside}${beside ? "\n" : ""}<user_query>\n${words}\n</user_query>`),
    /** A user line as it stands: Cursor's own block, or a line of the other make. */
    line: user,
    /** A step of the model: its words, then its calls ([name, input]). */
    say(text, ...calls) {
      lines.push({ role: "assistant", message: { content: [...(text ? [{ type: "text", text }] : []), ...calls.map(([name, input]) => ({ type: "tool_use", name, input }))] } });
      return c;
    },
    end(status = "success", error = null) {
      lines.push({ type: "turn_ended", status, ...(error ? { error } : {}) });
      return c;
    },
    text: () => lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  };
  return c;
}
/** A turn of words alone. */
const plain = (c, question, answer, at = T0) => c.ask(question, { at }).say(answer).end();
/** A home folder with Cursor's projects under it. */
function homeOf(name) {
  const home = join(dir, name);
  const root = join(home, ".cursor", "projects");
  mkdirSync(root, { recursive: true });
  const file = (slug, id) => join(root, slug, "agent-transcripts", id, `${id}.jsonl`);
  const put = (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return path;
  };
  return {
    home,
    root,
    file,
    put,
    write: (slug, c) => put(file(slug, c.id), c.text()),
    append: (slug, c, from) => appendFileSync(file(slug, c.id), c.lines.slice(from).map((l) => JSON.stringify(l)).join("\n") + "\n"),
  };
}
/** The name Cursor gives a project's folder: its path, every run of other characters one "-". */
const slugOf = (folder) => folder.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const chainOf = (a, id) => a.chainsWithKeyPrefix("cu:").find((c) => c.key === `cu:${id}`) || null;
const msg = (a, hash) => a.getMessage(hash).message;
const said = (a, hash) => {
  const m = msg(a, hash);
  return typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? "").join("");
};
const workOf = (a, t) => t.work.map((h) => msg(a, h));
const words = (text) => ({ role: "assistant", content: [{ type: "text", text }] });

// (fails before: yes — MEMR-10: a line of the chat past V8's string limit failed the whole chat; past 256 MiB a line is
// left out, named in the import's report, and the rest of the chat comes in)
test("a Cursor chat with a line past 256 MiB comes in without that line, and the import's report names it", async () => {
  const a = openArchive();
  const h = homeOf("huge");
  const c = chat(idOf(90));
  plain(c, "how is the parser built?", "With a table.");
  const before = c.text();
  const from = c.lines.length;
  plain(c, "and the lexer?", "By hand.", T0 + MIN);
  // A window with no folder: no project's folder is looked for on the drive.
  const f = h.file("1730000000000", c.id);
  mkdirSync(dirname(f), { recursive: true });
  writeWithLongLine(f, before, c.lines.slice(from).map((l) => JSON.stringify(l)).join("\n") + "\n");
  try {
    const r = await importCursor({ archive: a, root: h.root });
    assert.deepEqual([r.errors, r.long], [[], [{ file: `${c.id}.jsonl`, line: from + 1, bytes: PAST_A_LINE }]]);
    assert.equal(chainOf(a, c.id).turns, 2, "the rest of the chat came in");
  } finally {
    rmSync(f, { force: true });
  }
});

// ---- the reader ------------------------------------------------------------------------------------------------------
// (fails before: yes — Filament read no Cursor file at all; there was no reader)
test("a Cursor chat's turns are the person's words and the model's: Cursor's tags and its own lines are no message", () => {
  const c = chat(idOf(1));
  c.line(tagged("system-reminder", "You are in agent mode."))
    .line(tagged("dynamic_tools", "browser: click, type"))
    .ask("How do I list files?", { beside: `${tagged("manually_attached_skills", "- shell")}\n${tagged("cursor_commands", "/explain")}` })
    .say("Use ls.")
    .end()
    .line(`<timestamp>${stamp(T0 + 4 * MIN)}</timestamp>`)
    .ask("And hidden ones?", { at: T0 + 5 * MIN })
    .say("Looking.", ["Read", { path: "notes.md" }])
    .line(tagged("task-notification", "<task-id>7</task-id>\n<status>completed</status>\n<summary>the build</summary>"))
    .say("Use ls -a.")
    .end();
  const s = parseCursorSession(c.text());
  assert.deepEqual([s.turns.length, s.firstAt, s.lastAt, s.skipped], [2, T0, T0 + 5 * MIN, 0]);
  const [one, two] = s.turns;
  assert.deepEqual(one.user, { role: "user", content: "How do I list files?" }, "the words between the query's tags: no stamp, no skills, no commands");
  assert.deepEqual([one.work, one.final, one.at, one.endAt, one.model], [[], words("Use ls."), T0, T0, null], "Cursor names no model and stamps the message alone");
  assert.deepEqual(one.meta, { format: "anthropic" }, "no client: the chat names it (IM-58)");
  assert.equal(two.at, T0 + 5 * MIN, "the time its stamp says, in the zone it names");
  assert.deepEqual(two.work, [{ role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "cu_8_1", name: "Read", input: { path: "notes.md" } }] }], "a step of the model is a message: its words, its call, an id of its place in the file");
  assert.deepEqual(two.final, words("Use ls -a."), "the notice Cursor gave its model mid-work is no message");
});

// (fails before: yes — no reader)
test("a stamp is read to the minute in the zone it names, and in this computer's where it names none", () => {
  assert.equal(stampMs("Wednesday, Sep 2, 2026, 8:00 AM (UTC+5)"), Date.parse("2026-09-02T03:00:00Z"));
  assert.equal(stampMs("Thursday, Aug 14, 2026, 6:17 PM (UTC-3:30)"), Date.parse("2026-08-14T21:47:00Z"));
  assert.equal(stampMs("Friday, January 1, 2027, 12:05 AM (UTC)"), Date.parse("2027-01-01T00:05:00Z"), "midnight is hour 0");
  assert.equal(stampMs("Friday, Jan 1, 2027, 12:05 PM (GMT+1)"), Date.parse("2027-01-01T11:05:00Z"), "noon is hour 12");
  assert.equal(stampMs("Sep 2, 2026, 14:30"), new Date(2026, 8, 2, 14, 30).getTime());
  assert.deepEqual([stampMs("yesterday"), stampMs(null), stampMs("Foo 2, 2026, 8:00 AM")], [null, null, null]);
});

// (fails before: yes — no reader)
test("the same message written again in its turn is that turn going on; said again at another time it is a new turn", () => {
  const c = chat(idOf(2));
  c.ask("fix the parser").say("", ["Read", { path: "src/parse.js" }]).ask("fix the parser").ask("fix the parser").say("Fixed.").end();
  c.ask("continue", { at: T0 + 9 * MIN }).say("Going on.").end();
  c.ask("continue", { at: T0 + 20 * MIN }).say("Still going.").end();
  c.ask("continue", { at: T0 + 20 * MIN }).say("And on.").end();
  const s = parseCursorSession(c.text());
  assert.deepEqual(s.turns.map((t) => [t.user.content, t.at - T0, t.work.length, t.final.content[0].text]), [
    ["fix the parser", 0, 1, "Fixed."],
    ["continue", 9 * MIN, 0, "Going on."],
    ["continue", 20 * MIN, 0, "Still going."],
    ["continue", 20 * MIN, 0, "And on."],
  ], "Cursor writes a message again as its turn goes on; after the turn's end the same words are a message of their own");
});

// (fails before: yes — no reader)
test("what Cursor did is written as the calls Filament's cards read", () => {
  const c = chat(idOf(3));
  c.ask("do it all")
    .say("Reading.", ["Read", { path: "src/a.js", offset: 1, limit: 20 }], ["ReadFile", { path: "src/b.js" }])
    .say("", ["StrReplace", { path: "src/a.js", old_string: "let a", new_string: "const a" }], ["StrReplace", { path: "src/a.js", old_string: "x", new_string: "y", replace_all: true }])
    .say("", ["ApplyPatch", "*** Begin Patch\n*** Update File: src/b.js\n@@\n-old\n+new\n*** End Patch"], ["Write", { path: "src/c.js", contents: "export {};\n" }], ["Delete", { path: "src/old.js" }])
    .say("", ["Shell", { command: "npm test", description: "Run the tests", working_directory: "C:\\proj" }], ["Grep", { pattern: "parse\\(", path: "src", glob: "*.js", output_mode: "content" }], ["rg", { pattern: "TODO", path: "src" }])
    .say("", ["Glob", { glob_pattern: "**/*.ts", target_directory: "src" }], ["TodoWrite", { merge: false, todos: [{ id: "1", content: "Fix the parser", status: "in_progress" }, { id: "2", content: "Test it", status: "pending" }] }])
    .say("", ["WebFetch", { url: "https://example.com/docs" }], ["WebSearch", { search_term: "jsonl format", explanation: "to check" }])
    .say("", ["AskQuestion", { title: "One thing", questions: [{ id: "q1", prompt: "Which parser?", options: [{ id: "a", label: "The old one" }] }] }], ["Task", { description: "Scout the tests", prompt: "Find them", subagent_type: "explore" }])
    .say("", ["CreatePlan", { name: "The parser plan", overview: "Two steps", plan: "1. Read\n2. Fix", todos: [] }])
    .say("", ["CallMcpTool", { server: "docs", toolName: "search", arguments: { q: "jsonl" } }], ["CallDynamicTool", { namespace: "browser", toolName: "click", arguments: '{"ref":"e4"}' }], ["CallMcpTool", { server: "docs", toolName: "ping" }])
    .say("", ["ReadLints", { paths: ["src/a.js"] }], ["GetDynamicTools", { namespace: "browser" }], ["mcp_rider_search_in_files", { text: "parse" }])
    .say("All done.")
    .end();
  const [t] = parseCursorSession(c.text()).turns;
  const calls = t.work.flatMap((m) => m.content.filter((b) => b.type === "tool_use"));
  assert.deepEqual(calls.map((b) => b.name), ["Read", "ReadFile", "edit", "edit", "apply_patch", "Write", "Delete", "Shell", "Grep", "grep", "Glob", "TodoWrite", "WebFetch", "WebSearch", "AskQuestion", "Task", "CreatePlan", "mcp__docs__search", "mcp__browser__click", "mcp__docs__ping", "ReadLints", "GetDynamicTools", "mcp__rider__search_in_files"]);
  assert.equal(new Set(calls.map((b) => b.id)).size, calls.length, "every call has an id of its own");
  const input = (name, nth = 0) => calls.filter((b) => b.name === name)[nth].input;
  assert.deepEqual(input("edit"), { path: "src/a.js", old_string: "let a", new_string: "const a" }, "a replacement is an edit");
  assert.deepEqual(input("edit", 1), { path: "src/a.js", old_string: "x", new_string: "y", replace_all: true });
  assert.deepEqual(input("apply_patch"), { path: "src/b.js", patch: "*** Begin Patch\n*** Update File: src/b.js\n@@\n-old\n+new\n*** End Patch" }, "a patch names its file");
  assert.deepEqual(input("Write"), { path: "src/c.js", content: "export {};\n" }, "a written file says its content where Filament reads it");
  assert.deepEqual(input("Glob"), { pattern: "**/*.ts", path: "src" });
  assert.deepEqual(input("WebSearch"), { query: "jsonl format", explanation: "to check" });
  assert.deepEqual(input("mcp__docs__search"), { q: "jsonl" }, "a tool reached through a server is that server's tool, its arguments its input");
  assert.deepEqual(input("mcp__browser__click"), { ref: "e4" }, "arguments kept as text are read");
  assert.deepEqual(input("mcp__docs__ping"), {});
  assert.deepEqual(input("Shell"), { command: "npm test", description: "Run the tests", working_directory: "C:\\proj" }, "a call Filament's vocabulary knows stays as Cursor wrote it");
  const cards = toolsOfTurn(t.work, "anthropic");
  assert.deepEqual(cards.map((x) => x.card.kind), ["read", "read", "edit", "edit", "edit", "write", "other", "shell", "search", "search", "list", "todo", "web", "web", "ask", "subagent", "proposal", "mcp", "mcp", "mcp", "other", "other", "mcp"]);
  const subject = (name, nth = 0) => cards.filter((x) => x.name === name)[nth].card.subject;
  assert.deepEqual(
    [subject("Read"), subject("edit"), subject("apply_patch"), subject("Write"), subject("Shell"), subject("WebFetch"), subject("WebSearch"), subject("AskQuestion"), subject("Task"), subject("CreatePlan")],
    ["src/a.js", "src/a.js", "src/b.js", "src/c.js", "npm test", "https://example.com/docs", "jsonl format", "One thing", "Scout the tests", "The parser plan"],
    "each card says what the call was about",
  );
  assert.deepEqual(cards.map((x) => x.result).filter((r) => r != null), [], "Cursor keeps no result, and none is made up");
  assert.match(trajectoryProblem({ user: t.user, work: t.work, final: t.final, meta: t.meta }) || "", /expected user|has no tool_result/, "so a later request carries the turn as words, not as calls nobody answered");
});

// (fails before: yes — no reader)
test("a turn's end line ends it: stopped by the person, failed with the service's words, or over on a call with Filament's line; a file that ends mid-work stays as it is", () => {
  const c = chat(idOf(4));
  c.ask("do the long thing").say("Starting.", ["Shell", { command: "npm run build" }]).end("aborted");
  c.ask("try again", { at: T0 + MIN }).say("Trying.", ["Read", { path: "a.js" }]).end("error", "User aborted request");
  c.ask("once more", { at: T0 + 2 * MIN }).say("Trying.").end("error", "[resource_exhausted] Error");
  c.ask("and again", { at: T0 + 3 * MIN }).end("error");
  c.ask("check the build", { at: T0 + 4 * MIN }).say("", ["Shell", { command: "npm run build" }]).end();
  c.say("The background job finished.").end();
  c.ask("and the tests", { at: T0 + 6 * MIN }).say("", ["Shell", { command: "npm test" }]);
  const s = parseCursorSession(c.text());
  const [stopped, aborted, failed, bare, silent, own, running] = s.turns;
  assert.equal(s.turns.length, 7);
  assert.deepEqual(stopped.meta.stopped, { by: "cursor", at: T0 });
  assert.deepEqual(stopped.final, words("(turn stopped in Cursor)"), "as Filament's own stopped turn answers");
  assert.deepEqual(stopped.work.map((m) => m.content.map((b) => b.type)), [["text", "tool_use"]], "what it did before the stop is its work, the last call a card like any other");
  assert.deepEqual([aborted.meta.stopped, aborted.meta.failed, aborted.final], [{ by: "cursor", at: T0 + MIN }, undefined, words("(turn stopped in Cursor)")], "Cursor's error line for a stop is a stop, not a failure");
  assert.deepEqual([failed.meta.failed, failed.final, failed.work], [{ cause: "[resource_exhausted] Error" }, undefined, [words("Trying.")]], "a failed turn has no answer: what it said is its work");
  assert.deepEqual([failed.meta.facts.error, failed.meta.facts.errors, failed.meta.facts.calls, failed.meta.facts.startedAt, failed.meta.facts.endedAt, failed.meta.facts.model], ["[resource_exhausted] Error", 1, 1, T0 + 2 * MIN, null, null], "its failure where Filament keeps a turn's, so the page draws it failed; no time it took, no model");
  assert.deepEqual([stopped.meta.facts, silent.meta.facts], [undefined, undefined], "Cursor keeps no numbers of a turn, and none are made up");
  assert.deepEqual([bare.meta.failed, bare.final, bare.work], [{ cause: "the service failed the request" }, undefined, []]);
  assert.deepEqual([silent.final, silent.work.length, silent.cut], [words("(the turn ended in Cursor with no answer)"), 1, undefined], "Cursor ended the turn on a call: no stop, no words");
  assert.deepEqual(own.user, { role: "user", content: [{ type: "text", text: ownTurnText("Cursor", []) }] });
  assert.deepEqual([own.meta.own, own.final, own.at], [{ agent: "Cursor" }, words("The background job finished."), T0 + 4 * MIN], "the model's lines after nobody's message are Cursor's own turn, at the last time known");
  assert.deepEqual([running.final.content.map((b) => b.type), running.work, running.meta.stopped], [["tool_use"], [], undefined], "the file ends there: the chat may go on, and a later read lays the turn out");
});

// (fails before: yes — no reader)
test("a file of the other make: a line with no tag is a message as it stands, a harness's todo reminder is none", () => {
  const c = chat(idOf(5));
  c.line("Build the importer\nfor Cursor")
    .say("Step one done.")
    .line(REMINDER)
    .say("Step two done.")
    .line(`  Now the tests\n\n${REMINDER}`)
    .say("Tests written.")
    .line("<div>is this a tag?</div>")
    .line("   ")
    .say("All green.");
  const s = parseCursorSession(c.text(), { at: T0 + 30 * MIN });
  assert.deepEqual(s.turns.map((t) => [t.user.content, t.work.map((m) => m.content[0].text), t.final.content[0].text, t.at]), [
    ["Build the importer\nfor Cursor", ["Step one done."], "Step two done.", T0 + 30 * MIN],
    ["Now the tests", ["Tests written."], "All green.", T0 + 30 * MIN],
  ], "the reminder between two steps leaves them one turn; after a message's words it is cut off; a block in a tag is Cursor's; no stamp, so the file's own time");
});

// (fails before: yes — no reader)
test("a picture Cursor saved beside a message rides with its words; only a picture, only under Cursor's folder, only while it is there", () => {
  const h = homeOf("pictures");
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const shot = h.put(join(h.root, "c-proj-alpha", "assets", "shot-1.png"), png);
  const second = h.put(join(h.root, "c-proj-alpha", "assets", "shot 2.JPG"), png);
  const notes = h.put(join(h.root, "c-proj-alpha", "assets", "notes.txt"), "secret notes");
  const outside = h.put(join(h.home, "elsewhere", "private.png"), png);
  const gone = join(h.root, "c-proj-alpha", "assets", "gone.png");
  const c = chat(idOf(6));
  c.ask("what is wrong here?", { beside: tagged("image_files", [shot, second, notes, outside, gone, `${h.root}${sep}..${sep}..${sep}elsewhere${sep}private.png`].map((p, i) => `${i + 1}. ${p}`).join("\n")) }).say("The button is cut off.").end();
  c.ask("", { at: T0 + MIN, beside: tagged("image_files", `1. ${shot}`) }).say("Same picture.").end();
  const picture = pictureUnder(h.root);
  const s = parseCursorSession(c.text(), { picture });
  const data = png.toString("base64");
  assert.deepEqual(s.turns[0].user, { role: "user", content: [{ type: "text", text: "what is wrong here?" }, { type: "image", source: { type: "base64", media_type: "image/png", data } }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data } }] }, "a text file, a picture outside Cursor's folder, one reached by climbing out of it, and one that is gone are left out");
  assert.deepEqual(s.turns[1].user.content.map((b) => b.type), ["image"], "a message of a picture alone is the picture");
  assert.deepEqual(parseCursorSession(c.text()).turns[0].user, { role: "user", content: "what is wrong here?" }, "with nothing to read pictures with, the words alone");
});

// (fails before: yes — a call with no result recorded said "0 chars", a size nobody measured, and a command's
// card "No output.")
test("a call whose result was never kept states no size on its card, and is marked so its card can say the output was not kept", () => {
  const [kept, none] = archivedStubs([{ name: "Read", input: { path: "a.js" }, result: "", resultChars: 0, isError: false }, { name: "Read", input: { path: "a.js" }, result: null, resultChars: 0, isError: false }]);
  assert.deepEqual([factsOf(kept), factsOf(none), none.state, none.preview], ["0 chars", "", "done", ""], "an empty result is 0 chars; no result is no size, and the call still reads done");
  assert.deepEqual([kept.noResult, none.noResult], [undefined, true]);
  const [answered, unkept, silent] = archivedStubs([{ name: "AskQuestion", input: {}, result: "Whole units", isError: false }, { name: "AskQuestion", input: {}, result: null, isError: false }, { name: "AskQuestion", input: {}, result: "", isError: false }]);
  assert.deepEqual([askAnswerWords(answered, false), askAnswerWords(unkept, false), askAnswerWords(silent, false)], ["Whole units", "The answer was not kept.", "No answer provided"], "an answer the archive holds is shown; one never kept is not called missing");
  assert.deepEqual([askAnswerWords({ answer: "Yes" }, false), askAnswerWords({}, true), askAnswerWords({ preview: "a live card's preview is no answer" }, false)], ["Yes", "Waiting for your answer", "No answer provided"]);
});

// ---- the list --------------------------------------------------------------------------------------------------------
// (fails before: yes — cursorChats and the search for a project's folder did not exist)
test("a project's folder is found from the name Cursor gave it; a name that fits no folder is the project's name; a number is a window with no folder", async () => {
  const real = join(dir, "My Projects", "web.app_v2");
  mkdirSync(join(real, "src"), { recursive: true });
  mkdirSync(join(dir, "My"), { recursive: true });
  mkdirSync(join(dir, "My Projects", "web"), { recursive: true });
  const names = [slugOf(real), slugOf(join(real, "missing")), "two-words", ""];
  const { foldersOfNames } = /** @type {any} */ (imports);
  const found = await foldersOfNames(names);
  assert.equal(found.get(slugOf(real))?.toLowerCase(), real.toLowerCase(), "spaces, dots and underscores are all one dash in the name: each folder on the way is tried by its own name, the longest first");
  assert.deepEqual(names.slice(1).map((n) => found.get(n)), [null, null, null]);
  for (const n of names) assert.equal((await foldersOfNames([n])).get(n), found.get(n), `one walk for them all finds what ${n || "an empty name"}'s own walk finds`);

  const h = homeOf("list");
  const here = chat(idOf(10));
  plain(here, "How do I list files?\nSecond line", "Use ls.");
  const lost = chat(idOf(11));
  plain(lost, "where did the folder go", "It moved.", T0 + 2 * MIN);
  const loose = chat(idOf(12));
  plain(loose, "a window with no folder", "Fine.", T0 + 3 * MIN);
  const filaments = chat(idOf(13));
  filaments.ask('<filament-context kind="standing">\nYou are run by Filament.\n</filament-context>\n\na turn Filament ran', { at: T0 + 4 * MIN }).say("Done.").end();
  const sdk = chat(idOf(14));
  plain(sdk, "a program's run", "Ran.");
  const sub = chat(idOf(15));
  plain(sub, "a brief from the parent agent", "Did it.");
  h.write(slugOf(real), here);
  h.write("old-workspace", lost);
  h.write("1757843923420", loose);
  h.write(slugOf(real), filaments);
  h.put(h.file(slugOf(real), `agent-${idOf(14)}`), sdk.text());
  h.put(join(h.root, slugOf(real), "agent-transcripts", idOf(10), "subagents", `${idOf(15)}.jsonl`), sub.text());
  mkdirSync(join(h.root, slugOf(real), "agent-transcripts", idOf(16)), { recursive: true });
  mkdirSync(join(h.root, "no-transcripts-here", "terminals"), { recursive: true });

  assert.deepEqual(listCursorFiles(h.root).map((f) => f.id).sort(), [idOf(10), idOf(11), idOf(12), idOf(13)], "an agent a program made through Cursor's SDK is no chat, nor is a sub-agent's transcript, nor a folder with no file");
  const size = (slug, id) => statSync(h.file(slug, id)).size;
  const chats = (await cursorChats(h.root)).sort((x, y) => x.startedAt - y.startedAt);
  assert.deepEqual(
    chats.map((c) => ({ ...c, lastAt: typeof c.lastAt, cwd: c.cwd?.toLowerCase() ?? null })),
    [
      { id: `${slugOf(real)}/${idOf(10)}`, key: `cu:${idOf(10)}`, agentSession: idOf(10), file: `${idOf(10)}.jsonl`, cwd: real.toLowerCase(), preview: "How do I list files?", startedAt: T0, lastAt: "number", bytes: size(slugOf(real), idOf(10)), mark: size(slugOf(real), idOf(10)) },
      { id: `old-workspace/${idOf(11)}`, key: `cu:${idOf(11)}`, agentSession: idOf(11), file: `${idOf(11)}.jsonl`, cwd: null, project: "old-workspace", preview: "where did the folder go", startedAt: T0 + 2 * MIN, lastAt: "number", bytes: size("old-workspace", idOf(11)), mark: size("old-workspace", idOf(11)) },
      { id: `1757843923420/${idOf(12)}`, key: `cu:${idOf(12)}`, agentSession: idOf(12), file: `${idOf(12)}.jsonl`, cwd: null, preview: "a window with no folder", startedAt: T0 + 3 * MIN, lastAt: "number", bytes: size("1757843923420", idOf(12)), mark: size("1757843923420", idOf(12)) },
      { id: `${slugOf(real)}/${idOf(13)}`, key: `cu:${idOf(13)}`, agentSession: idOf(13), file: `${idOf(13)}.jsonl`, cwd: real.toLowerCase(), preview: "a turn Filament ran", startedAt: T0 + 4 * MIN, lastAt: "number", bytes: size(slugOf(real), idOf(13)), mark: size(slugOf(real), idOf(13)), own: true },
    ],
    "a row shows the first line the person typed, never what Cursor put beside it",
  );
  const a = openArchive();
  assert.deepEqual(Object.fromEntries((await chatStates(cursorSource, { archive: a, where: h.root, ownIds: new Set([idOf(11)]) })).map((c) => [c.agentSession, c.state])), { [idOf(10)]: "new", [idOf(11)]: "own", [idOf(12)]: "new", [idOf(13)]: "own" }, "Filament's own by what its first message holds, or by a bridge's list");
  assert.deepEqual([cursorSource.id, cursorSource.label, cursorSource.prefix, cursorSource.where(h.home), cursorSource.found(h.root), cursorSource.found(join(dir, "nowhere"))], ["cursor", "Cursor", "cu:", h.root, true, false]);
});

// (fails before: yes — the bug hunt of 10-30, MEMR-12: each project's folder was looked for from the drive's root, every
// folder on the way listed again for each project: the root was listed once a project; and, its synchronous half, the
// drive was walked on the server's own thread, every other request held until the last folder was listed)
test("projects whose folders lie along one way are found in one walk, each folder on it listed once, the server answering meanwhile", async () => {
  const way = join(dir, "one way");
  const h = homeOf("one-way");
  for (const [n, name] of ["alpha", "beta", "gamma"].entries()) {
    mkdirSync(join(way, name), { recursive: true });
    const c = chat(idOf(40 + n));
    plain(c, `work in ${name}`, "Done.");
    h.write(slugOf(join(way, name)), c);
  }
  const require = createRequire(import.meta.url);
  const fs = require("node:fs");
  const fsp = require("node:fs/promises");
  const [realSync, realAsync] = [fs.readdirSync, fsp.readdir];
  /** @type {string[]} */
  const held = [];
  /** @type {string[]} */
  const listed = [];
  fs.readdirSync = (/** @type {any[]} */ ...args) => (held.push(String(args[0])), realSync(...args));
  fsp.readdir = (/** @type {any[]} */ ...args) => (listed.push(String(args[0])), realAsync(...args));
  syncBuiltinESMExports();
  // What else the server does while the folders are looked for: a turn of its loop each time it gets one.
  let turns = 0;
  let looking = true;
  const turn = () => {
    if (!looking) return;
    turns++;
    setImmediate(turn);
  };
  setImmediate(turn);
  /** @type {any[]} */
  let chats;
  try {
    chats = await cursorChats(h.root);
  } finally {
    looking = false;
    fs.readdirSync = realSync;
    fsp.readdir = realAsync;
    syncBuiltinESMExports();
  }
  assert.deepEqual(chats.map((c) => c.cwd?.toLowerCase()).sort(), ["alpha", "beta", "gamma"].map((n) => join(way, n).toLowerCase()), "each project's folder found");
  const onTheWay = (/** @type {string} */ d) => join(way, "x").toLowerCase().startsWith(d.toLowerCase().replace(/[\\/]*$/, "")) || d.toLowerCase().startsWith(way.toLowerCase());
  assert.deepEqual(held.filter(onTheWay), [], "no folder on the way is listed on the server's own thread");
  assert.ok(listed.some((d) => d.toLowerCase() === way.toLowerCase()), `the folders on the way are listed without holding the server: ${listed.join(" | ")}`);
  assert.deepEqual([...new Set(listed.filter((d, i) => listed.indexOf(d) !== i))], [], "no folder listed twice");
  assert.ok(turns > 0, "the server's loop turned while the folders were looked for");
});

// (fails before: yes — one chat id under two project folders was two rows and two files written into one session:
// the second read of either wrote turns again)
test("a chat that went on in another window is one chat: the transcript written last, under the project it went on in", async () => {
  const a = openArchive();
  const h = homeOf("twice");
  const early = chat(idOf(17));
  plain(early, "start here", "Started.");
  plain(early, "said only in the first window", "Noted.", T0 + MIN);
  const late = chat(idOf(17));
  plain(late, "start here", "Started.");
  plain(late, "then it went on", "On it.", T0 + 2 * MIN);
  plain(late, "and on", "Done.", T0 + 3 * MIN);
  utimesSync(h.write("old-workspace", early), new Date(T0 + 10 * MIN), new Date(T0 + 10 * MIN));
  utimesSync(h.write("new-workspace", late), new Date(T0 + 20 * MIN), new Date(T0 + 20 * MIN));
  assert.deepEqual(listCursorFiles(h.root).map((f) => [f.slug, f.id, f.mtime]), [["new-workspace", idOf(17), T0 + 20 * MIN]]);
  assert.deepEqual((await cursorChats(h.root)).map((c) => [c.id, c.project, c.lastAt]), [[`new-workspace/${idOf(17)}`, "new-workspace", T0 + 20 * MIN]], "one row");
  const first = await importCursor({ archive: a, root: h.root });
  assert.deepEqual([first.files, first.newChains, first.newTurns], [1, 1, 3]);
  assert.deepEqual(a.getTurns(chainOf(a, idOf(17)).id).map((t) => said(a, t.user_hash)), ["start here", "then it went on", "and on"]);
  assert.equal(a.getProject(chainOf(a, idOf(17)).project_id).name, "new-workspace");
  const again = await importCursor({ archive: a, root: h.root });
  assert.deepEqual([again.newTurns, again.messages], [0, 0], "read twice, written once");
  const same = chat(idOf(18));
  plain(same, "a", "b");
  const longer = chat(idOf(18));
  plain(longer, "a", "b");
  plain(longer, "c", "d", T0 + MIN);
  utimesSync(h.write("new-workspace", same), new Date(T0 + 30 * MIN), new Date(T0 + 30 * MIN));
  utimesSync(h.write("old-workspace", longer), new Date(T0 + 30 * MIN), new Date(T0 + 30 * MIN));
  assert.deepEqual(listCursorFiles(h.root).filter((f) => f.id === idOf(18)).map((f) => f.slug), ["old-workspace"], "written together: the bigger");
});

// ---- into the archive ------------------------------------------------------------------------------------------------
// (fails before: yes — importCursor did not exist)
test("a Cursor chat becomes a session of Filament's: its folder, its times, its turns; a second read writes nothing, a longer file adds its turn", async () => {
  const a = openArchive();
  const h = homeOf("grow");
  const real = join(dir, "grow-proj");
  mkdirSync(real, { recursive: true });
  const slug = slugOf(real);
  const c = chat(idOf(20));
  plain(c, "How do I list files?", "Use ls.");
  c.ask("show me", { at: T0 + 5 * MIN }).say("", ["Shell", { command: "ls" }]).say("", ["Shell", { command: "ls" }]).say("There.").end();
  h.write(slug, c);
  const own = chat(idOf(21));
  own.ask("<filament-memory>\nnotes\n</filament-memory>\n\na turn Filament ran").say("Done.").end();
  h.write(slug, own);
  const hollow = chat(idOf(22));
  hollow.line(tagged("system-reminder", "nothing was ever asked"));
  h.write(slug, hollow);
  h.put(h.file(slug, `agent-${idOf(23)}`), chat(idOf(23)).ask("a program's run").say("Ran.").end().text());

  const first = await importCursor({ archive: a, root: h.root });
  assert.deepEqual([first.source, first.files, first.passed, first.newChains, first.newTurns, first.errors, first.empty.map((e) => e.key)], ["cursor", 3, 1, 1, 2, [], [`cu:${idOf(22)}`]], "Filament's own is passed over and counted; a file of Cursor's own lines alone has nothing in it");
  const ch = chainOf(a, idOf(20));
  assert.deepEqual([ch.client, ch.turns, ch.kind, ch.meta.native], ["harness", 2, "interactive", true], "the harness's own chat (IM-58)");
  assert.deepEqual(ch.meta && { import: ch.meta.import, sessionId: ch.meta.sessionId, file: ch.meta.file, slug: ch.meta.slug, mark: ch.meta.mark }, { import: "cursor", sessionId: idOf(20), file: `${idOf(20)}.jsonl`, slug, mark: statSync(h.file(slug, idOf(20))).size });
  assert.deepEqual([a.getProject(ch.project_id).cwd.toLowerCase(), a.getProject(ch.project_id).name], [real.toLowerCase(), "grow-proj"], "filed under the folder the name stands for");
  assert.equal(ch.started_at, T0, "the chat's own times, not the import's");
  assert.equal(ch.last_at, Math.floor(statSync(h.file(slug, idOf(20))).mtimeMs), "last active when its file was last written: Cursor stamps a message, not its answer");
  const turns = a.getTurns(ch.id);
  assert.deepEqual(turns.map((t) => [said(a, t.user_hash), said(a, t.final_hash), t.started_at, t.meta.client, t.meta.format, t.model]), [
    ["How do I list files?", "Use ls.", T0, "harness", "anthropic", null],
    ["show me", "There.", T0 + 5 * MIN, "harness", "anthropic", null],
  ]);
  assert.deepEqual(toolsOfTurn(workOf(a, turns[1]), "anthropic").map((t) => [t.name, t.card.subject]), [["Shell", "ls"], ["Shell", "ls"]], "the same command run twice is two calls: each has its own id");
  assert.equal(chainOf(a, idOf(21)), null);
  assert.equal(chainOf(a, idOf(23)), null);

  const again = await importCursor({ archive: a, root: h.root });
  assert.deepEqual([again.newChains, again.newTurns, again.messages], [0, 0, 0], "read twice, written once");
  const before = c.lines.length;
  plain(c, "and a third?", "Yes.", T0 + 9 * MIN);
  h.append(slug, c, before);
  assert.deepEqual((await chatStates(cursorSource, { archive: a, where: h.root })).filter((x) => x.agentSession === idOf(20)).map((x) => [x.state, x.turns]), [["grown", 2]], "the file grew past what was read");
  const third = await importCursor({ archive: a, root: h.root });
  assert.deepEqual([third.newChains, third.newTurns], [0, 1]);
  assert.equal((await chatStates(cursorSource, { archive: a, where: h.root })).find((x) => x.agentSession === idOf(20)).state, "imported");

  const named = await importCursor({ archive: a, root: h.root, only: new Set([`${slug}/${idOf(21)}`]) });
  assert.deepEqual([named.files, named.passed, named.newChains], [1, 1, 0], "asked for by name, Filament's own is still a session already");
  assert.deepEqual(await importCursor({ archive: a, root: join(dir, "nowhere") }).then((o) => [o.files, o.newChains]), [0, 0], "no folder: nothing to bring");
  const dry = await importCursor({ root: h.root, dryRun: true });
  assert.deepEqual([dry.newChains, dry.newTurns, dry.dryRun], [1, 3, true], "a dry run counts and writes nothing");
});

// (fails before: yes — importCursor did not exist)
test("a project whose folder is not on this computer is named as Cursor named it; a window with no folder has no project", async () => {
  const a = openArchive();
  const h = homeOf("nofolder");
  const lost = chat(idOf(30));
  plain(lost, "where did the folder go", "It moved.");
  const loose = chat(idOf(31));
  plain(loose, "a window with no folder", "Fine.");
  h.write("old-workspace", lost);
  h.write("1757843923420", loose);
  const out = await importCursor({ archive: a, root: h.root });
  assert.deepEqual([out.newChains, out.errors], [2, []]);
  const named = a.getProject(chainOf(a, idOf(30)).project_id);
  assert.deepEqual([named.name, named.cwd ?? null], ["old-workspace", null], "the project is named by that name, with no folder");
  assert.equal(chainOf(a, idOf(31)).project_id, "none", "no folder, no project");
});

// (fails before: yes — the writer told a turn by the bytes of its message, so a picture gone since the first read
// made every turn from its own on look new, and the chat doubled from there)
test("a picture whose file is gone at the next read loses no turn its place: the chat grows by its new turn alone", async () => {
  const a = openArchive();
  const h = homeOf("picture-gone");
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const shot = h.put(join(h.root, "c-proj-beta", "assets", "shot.png"), png);
  const c = chat(idOf(40));
  c.ask("what is this?", { beside: tagged("image_files", `1. ${shot}`) }).say("A screenshot.").end();
  plain(c, "thanks", "Welcome.", T0 + MIN);
  h.write("c-proj-beta", c);
  const first = await importCursor({ archive: a, root: h.root });
  assert.deepEqual([first.newTurns, first.errors], [2, []]);
  const ch = chainOf(a, idOf(40));
  assert.deepEqual(msg(a, a.getTurns(ch.id)[0].user_hash).content.map((b) => b.type), ["text", "image"]);
  rmSync(shot);
  const before = c.lines.length;
  plain(c, "one more", "Sure.", T0 + 2 * MIN);
  h.append("c-proj-beta", c, before);
  const second = await importCursor({ archive: a, root: h.root });
  assert.deepEqual([second.newTurns, a.getTurns(ch.id).map((t) => said(a, t.user_hash))], [1, ["what is this?", "thanks", "one more"]]);
  assert.deepEqual(msg(a, a.getTurns(ch.id)[0].user_hash).content.map((b) => b.type), ["text", "image"], "and the turn keeps the picture it was read with");
});

// (fails before: yes — importCursor did not exist)
test("a failed turn the person sent again is one turn: what both did, and the answer of the second", async () => {
  const a = openArchive();
  const h = homeOf("retry");
  const c = chat(idOf(50));
  c.ask("build it").say("Building.", ["Shell", { command: "npm run build" }]).end("error", "Connection lost");
  c.ask("build it", { at: T0 + 3 * MIN }).say("Built.").end();
  h.write("c-proj-gamma", c);
  await importCursor({ archive: a, root: h.root });
  const turns = a.getTurns(chainOf(a, idOf(50)).id);
  assert.deepEqual(turns.map((t) => [said(a, t.user_hash), t.work.length, said(a, t.final_hash), t.meta.failed ?? null, t.started_at]), [["build it", 1, "Built.", null, T0]], "as Filament keeps a message sent again while its turn had no answer");
});

// ---- the routes ------------------------------------------------------------------------------------------------------
const json = async (res) => ({ status: res.status, body: await res.json() });
// (fails before: yes — the section listed Claude Code and Codex alone; Cursor's chats could not be seen, chosen or synced)
test("the Import section lists Cursor, brings its chats in, and the chat opens with Filament's cards", async () => {
  const h = homeOf("routes");
  const c = chat(idOf(60));
  c.ask("Fix the parser").say("Reading it.", ["Read", { path: "src/parse.js" }]).say("", ["StrReplace", { path: "src/parse.js", old_string: "a", new_string: "b" }]).say("Fixed.").end();
  const lost = chat(idOf(61));
  plain(lost, "where did the folder go", "It moved.", T0 + MIN);
  const own = chat(idOf(62));
  own.ask("<filament-memory>\nnotes\n</filament-memory>\n\na turn Filament ran", { at: T0 + 2 * MIN }).say("Done.").end();
  h.write("old-workspace", c);
  h.write("other-workspace", lost);
  h.write("old-workspace", own);
  h.put(h.file("old-workspace", `agent-${idOf(63)}`), chat(idOf(63)).ask("a program's run").say("Ran.").end().text());
  const shim = await startApp({ memory: true, overrides: { importHome: h.home } });
  const get = (path) => shim.api(`/api/memory/import/${path}`).then(json);
  const send = (method, path, body) => shim.api(`/api/memory/import/${path}`, { method, body }).then(json);
  const finished = async (id) => until(async () => { const j = await (await shim.api(`/api/memory/jobs/${id}`)).json(); return j.status === "running" ? null : j; }, `job ${id} to end`);
  try {
    const before = await get("overview");
    assert.deepEqual(before.body.sources.map((s) => s.id), ["claude-code", "codex", "cursor"]);
    const row = before.body.sources.find((s) => s.id === "cursor");
    assert.deepEqual(
      { label: row.label, where: row.where, found: row.found, on: row.on, chats: row.chats, projects: row.projects, states: row.states, pending: row.pending.chats },
      { label: "Cursor", where: h.root, found: true, on: false, chats: 3, projects: 2, states: { new: 2, own: 1 }, pending: 2 },
      "two projects by the names Cursor gave them; Filament's own chat is counted, and no Sync would bring it; the SDK's agent is no chat",
    );
    const list = await get("chats?source=cursor");
    assert.deepEqual(list.body.chats.map((x) => [x.agentSession, x.state, x.preview, x.cwd, x.project ?? null]).sort(), [
      [idOf(60), "new", "Fix the parser", null, "old-workspace"],
      [idOf(61), "new", "where did the folder go", null, "other-workspace"],
      [idOf(62), "own", "a turn Filament ran", null, "old-workspace"],
    ]);
    const refused = await send("POST", "chosen", { source: "cursor", chats: [`old-workspace/${idOf(62)}`] });
    assert.equal(refused.status, 400, "a chat Filament runs itself cannot be chosen");

    const started = await send("POST", "chosen", { source: "cursor", chats: [`old-workspace/${idOf(60)}`] });
    assert.equal(started.status, 200);
    const job = await finished(started.body.job.id);
    assert.deepEqual([job.status, job.kind], ["done", "import-cursor"]);
    const chain = chainOf(shim.app.memory.archive, idOf(60));
    assert.equal(chain.turns, 1);
    assert.deepEqual((await get("overview")).body.sources.find((s) => s.id === "cursor").states, { imported: 1, new: 1, own: 1 });

    const listed = (await (await shim.api("/api/memory/sessions?limit=200&kind=interactive,fork")).json()).sessions;
    assert.equal(listed.find((s) => s.id === chain.id).importedFrom, "Cursor", "its row names the agent it came from");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(chain.id)}/transcript`)).json();
    assert.equal(tr.turns.length, 1);
    assert.deepEqual(tr.turns[0].user, { role: "user", content: "Fix the parser" });
    assert.deepEqual(tr.turns[0].tools.map((t) => [t.name, t.card.kind, t.card.subject]), [["Read", "read", "src/parse.js"], ["edit", "edit", "src/parse.js"]], "the read and the change are file cards, as in a turn Filament runs");
    assert.deepEqual(tr.turns[0].final, { role: "assistant", content: [{ type: "text", text: "Fixed." }] });

    await send("PUT", "prefs", { on: ["cursor"] });
    const synced = await (await shim.app.memory.importSync()).done;
    assert.deepEqual([synced.newTurns, synced.chats], [1, 1], "a Sync brings the other chat");
    const after = (await get("overview")).body;
    assert.deepEqual([after.sources.find((s) => s.id === "cursor").states, after.sources.find((s) => s.id === "cursor").pending.chats], [{ imported: 2, own: 1 }, 0]);
    assert.equal(chainOf(shim.app.memory.archive, idOf(62)), null, "and Filament's own chat stays out");
  } finally {
    await shim.stop();
  }
});
