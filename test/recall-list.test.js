// @ts-check
// filament_recall with neither a turn nor a result lists the chat's turns (the owner's of 11-08): past a compaction the
// agent went looking for what an earlier turn said was left, and the summary view it could have read kept only each
// answer's first 400 characters — the list of what was left sits at an answer's end — and a finished background
// command filled its turn's line with its whole output.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/archive.js";
import { MemoryBrain } from "../src/services/memory/brain.js";
import { recall, recallList } from "../src/app/sessions/recall.js";
import { recallToolDef } from "../src/app/memory-tools.js";

const dir = mkdtempSync(join(tmpdir(), "filament-recall-list-"));
const a = /** @type {any} */ (new Archive({ file: join(dir, "a.db") }));
after(() => {
  a.close();
  rmSync(dir, { recursive: true, force: true });
});
const ch = a.chainForKey("k1", { cwd: "C:\\filament", client: "claude-code", model: "m" });
let n = 0;
/** A finished turn. @param {any} content @param {string} answer @param {any} [own] */
const turn = (content, answer, own = null) => {
  const t = a.beginTurn(ch.id, { requestId: `r${++n}`, userMessage: { role: "user", content }, own });
  a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: answer }, outputChars: answer.length });
};
const MIDDLE = Array.from({ length: 25 }, () => "M".repeat(59)).join("\n");
const LEFT = "What remains: the turn list's line after a compaction, then the land.";
const OUTPUT = Array.from({ length: 200 }, (_, i) => `  ✔ test ${i} passes`).join("\n");
const NOTE = "[Filament: your background command bg_1 ended — `npm test` exited with code 0 after 45 s.]";
const PLAN = `The plan is on the graph.\n\n${MIDDLE}\n\n${LEFT}`;
turn("plan the rest", PLAN);
turn([{ type: "text", text: `${NOTE}\nIts output:\n${OUTPUT}` }], "The suite passed.");
turn("A background task ended (completed): the review found two defects.\nFirst, the sync race in subagents.js.\nSecond, a relative target.", "Both are fixed.", { agent: "Claude Code" });

test("with neither a turn nor a result, recall lists the chat's turns: each answer's head and end, Filament's notices and an own turn's opener by their first lines", () => {
  const text = recall(a, ch.id, {});
  // Newest first (the owner's of 11-08): the older a turn, the less it bears on where the session stands.
  assert.match(text, /^## This chat's turns 3 back to 1, newest first: what opened each, and its answer's head and end\. filament_recall\(\{ turn: n \}\) brings one back whole\.\n\n### Turn 3 /);
  assert.ok(text.indexOf("### Turn 3") < text.indexOf("### Turn 2") && text.indexOf("### Turn 2") < text.indexOf("### Turn 1"));
  // (fails before: yes — the summary view cut the answer at its first 400 characters, and recall answered an empty call
  // with an error)
  assert.ok(text.includes(`Assistant: ${PLAN.slice(0, 400)} … ${"M".repeat(59)}\n`), text.slice(0, 1200));
  assert.ok(text.endsWith(`${LEFT}`), "its end, from a line's start");
  assert.ok(!text.includes(MIDDLE), "the middle is left for the turn's recall");
  assert.ok(text.includes(`User: (no words of their own)\nWith the message, Filament's notices, their first lines:\n${NOTE}\nAssistant: The suite passed.`), text);
  assert.ok(!text.includes("test 7 passes"), "a command's output stays out");
  assert.ok(text.includes("No user message — the assistant went on by itself: A background task ended (completed): the review found two defects.\nAssistant: Both are fixed."), text);
  // The turn comes back whole by its number.
  assert.ok(recall(a, ch.id, { turn: 1 }).includes(MIDDLE));
});

test("the list reads newest first within its budget and names the turns before it; a bad before, or no turn, says why", () => {
  const short = recallList(a, ch.id, { budgetTokens: 60 });
  assert.match(String(short), /^## This chat's turns 3 back to 3, .* The turns before 3: filament_recall\(\{ before: 3 \}\)\.\n\n### Turn 3 [^]*\n\n\(2 earlier turns omitted\)$/);
  const before = recall(a, ch.id, { before: 3 });
  assert.match(before, /^## This chat's turns 2 back to 1,/);
  assert.ok(!before.includes("### Turn 3"));
  assert.deepEqual(JSON.parse(recall(a, ch.id, { before: 1 })), { error: "before is a turn number of 2 or more" });
  assert.deepEqual(JSON.parse(recall(a, ch.id, { pointer: "nonsense" })), { error: 'give { turn: <n> } or { result: "r:<hash8>" }' });
  const empty = a.chainForKey("k2", { cwd: "C:\\filament", client: "claude-code", model: "m" });
  assert.deepEqual(JSON.parse(recall(a, empty.id, {})), { error: "no turns in this session yet" });
  // The tool's words name the list, and its paging.
  const def = /** @type {any} */ (recallToolDef("anthropic"));
  assert.match(def.description, /With neither, it lists this chat's turns: what opened each and its answer's head and end/);
  assert.equal(def.input_schema.properties.before.minimum, 2);
});

// (fails before: yes — the review of 11-08: notices were folded after they were joined, so a line in a notice's body
// that opened as a notice was kept as one, with no limit on how many; and a long message stood whole)
test("each notice is folded to its own first line, six at most; a long message keeps its head and end, as an answer does", () => {
  const ch2 = a.chainForKey("k3", { cwd: "C:\\filament", client: "claude-code", model: "m" });
  const t = a.beginTurn(ch2.id, { requestId: "x1", userMessage: { role: "user", content: [{ type: "text", text: `${NOTE}\nIts output:\n [Filament: a line of a diff]\n${OUTPUT}` }] } });
  a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "Read." } });
  const many = Array.from({ length: 8 }, (_, i) => ({ type: "text", text: `[Filament: notice ${i}]\nbody ${i}` }));
  const LONG = `${"P".repeat(2000)}\nthe ask at its end`;
  const t2 = a.beginTurn(ch2.id, { requestId: "x2", userMessage: { role: "user", content: [...many, { type: "text", text: LONG }] } });
  a.finishTurn(t2.turnId, { finalMessage: { role: "assistant", content: "Done." } });
  const text = String(recall(a, ch2.id, {}));
  assert.ok(text.includes(`their first lines:\n${NOTE}\nAssistant: Read.`), text);
  assert.ok(!text.includes("a line of a diff"));
  assert.ok(text.includes(`their first lines:\n${many.slice(0, 6).map((b) => b.text.split("\n")[0]).join("\n")}\n(2 more)\nAssistant: Done.`), text);
  assert.ok(text.includes(`User: ${"P".repeat(400)} … `) && text.includes("the ask at its end\nWith the message") && !text.includes("P".repeat(1700)), text.slice(0, 900));
});

test("memory's summary view renders the same: a learner's line on the turn keeps the answer's end beside it", () => {
  const brain = new MemoryBrain(/** @type {any} */ ({ archive: a }));
  const view = /** @type {any} */ (brain.load(ch.id, { view: "summary", budgetTokens: 10000 }));
  assert.ok(view.text.includes(`${PLAN.slice(0, 400)} … `) && view.text.includes(`${LEFT}\n\n### Turn 2`));
  assert.ok(view.text.includes(`their first lines:\n${NOTE}\n`));
  const first = a.getTurns(ch.id)[0];
  a.setTurnSummary(first.id, "The user asked for a plan; it went on the graph.");
  const listed = String(recall(a, ch.id, {}));
  assert.ok(listed.includes(`Assistant: The user asked for a plan; it went on the graph. Its answer ends: ${"M".repeat(59)}\n`), listed);
  assert.ok(listed.endsWith(LEFT), listed);
  assert.ok(view.text.indexOf("### Turn 1") < view.text.indexOf("### Turn 3"), "memory's views keep a session's order");
});

// (fails before: yes — the hunt of 11-08, T1 #11: the history leaves a turn the model's provider refused out, as its
// words sent again are refused again (shapes.js `modelTurnsOf`), and recall's list and the turn's recall handed them
// back in a tool result every later request carried)
test("a turn the model's provider refused: the list and its recall say Filament's line on what it wrote, never its words", () => {
  const ch3 = a.chainForKey("k4", { cwd: "C:\\filament", client: "claude-code", model: "m" });
  const t1 = a.beginTurn(ch3.id, { requestId: "y1", userMessage: { role: "user", content: "start" } });
  a.finishTurn(t1.turnId, { finalMessage: { role: "assistant", content: "Started." } });
  const t2 = a.beginTurn(ch3.id, { requestId: "y2", userMessage: { role: "user", content: "THE REFUSED ASK" } });
  a.addWork(t2.turnId, [
    { role: "assistant", content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "src/a.js", old_string: "a", new_string: "THE REFUSED EDIT" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "e1", content: "ok" }] },
  ]);
  a.finishTurn(t2.turnId, { finalMessage: { role: "assistant", content: "THE REFUSED ANSWER" } });
  a.mergeTurnMeta(t2.turnId, { facts: { stopReason: "refusal" } });
  a.setTurnSummary(a.getTurns(ch3.id)[1].id, "THE REFUSED DIGEST");
  const t3 = a.beginTurn(ch3.id, { requestId: "y3", userMessage: { role: "user", content: "go on" } });
  a.finishTurn(t3.turnId, { finalMessage: { role: "assistant", content: "Went on." } });
  const listed = String(recall(a, ch3.id, {}));
  assert.ok(!/THE REFUSED/.test(listed), listed);
  assert.ok(listed.includes("### Turn 2 (") && listed.includes("[The model's provider refused this turn, so Filament leaves it out of the history. Before it was refused it wrote to src/a.js"), listed);
  assert.ok(listed.includes("User: start") && listed.includes("User: go on"), "the turns around it as they were");
  const back = String(recall(a, ch3.id, { turn: 2 }));
  assert.ok(!/THE REFUSED/.test(back), back);
  assert.ok(back.startsWith("## Turn 2\n[The model's provider refused this turn"), back);
});

// (fails before: yes — the hunt of 11-08: a turn with no answer showed its work count alone, "(work: 1 tool calls)",
// which reads as a turn that did its work and ended)
test("a turn with no answer says why in the list: it failed, with the cause; it was cut off; or none was recorded", () => {
  const ch4 = a.chainForKey("k5", { cwd: "C:\\filament", client: "claude-code", model: "m" });
  const call = [
    { role: "assistant", content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "a.txt" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "r1", content: "a" }] },
  ];
  /** A turn with work and no answer, its meta as given. @param {string} ask @param {any} meta */
  const unanswered = (ask, meta) => {
    const t = a.beginTurn(ch4.id, { requestId: `z${++n}`, userMessage: { role: "user", content: ask } });
    a.addWork(t.turnId, call);
    if (meta) a.mergeTurnMeta(t.turnId, meta);
  };
  unanswered("fail", { failed: { at: 1, cause: "round 2's model call to m failed: the connection was reset", text: "Reading a.txt first." } });
  unanswered("cut", { cut: { run: "run_1", at: 2, rounds: 1, tools: 1, logged: 2 } });
  unanswered("none", null);
  const listed = String(recall(a, ch4.id, {}));
  assert.ok(listed.includes("User: fail\nAssistant: Reading a.txt first. [this turn failed: round 2's model call to m failed: the connection was reset] (work: 1 tool calls)"), listed);
  assert.ok(listed.includes("User: cut\nAssistant: (cut off before its reply) (work: 1 tool calls)"), listed);
  assert.ok(listed.includes("User: none\nAssistant: (no final answer recorded) (work: 1 tool calls)"), listed);
});

// (fails before: yes — the hunt of 11-08: the head and end of a long answer were cut by UTF-16 units, so an emoji at
// either cut left half of its pair in the list, which is no text: every later request carried it)
test("a long answer's head and end never split an emoji's pair", () => {
  const ch5 = a.chainForKey("k6", { cwd: "C:\\filament", client: "claude-code", model: "m" });
  const t = a.beginTurn(ch5.id, { requestId: "e1", userMessage: { role: "user", content: `${"u".repeat(399)}😀${"v".repeat(1000)}` } });
  const answer = `${"a".repeat(399)}😀${"b".repeat(1000)}😀${"c".repeat(399)}`;
  a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: answer } });
  const listed = String(recall(a, ch5.id, {}));
  const half = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.ok(!half.test(listed), JSON.stringify(listed.match(/a{3}[^a]{0,4} … [^c]{0,4}c{3}/)?.[0]));
  assert.ok(listed.includes(`Assistant: ${"a".repeat(399)} … ${"c".repeat(399)}`), listed.slice(-900));
  assert.ok(listed.includes(`User: ${"u".repeat(399)} … `), listed.slice(0, 600));
});
