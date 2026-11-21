// @ts-check
// HarnessV4_Tasks C28: Filament's copy of a coding agent's session stays about the size of what the agent holds. A
// fresh agent session's start carries the earlier turns as Words unless chosen — your words, the agent's, and one line
// that counts a turn's tool calls — and where the agent compacts its own context and hands its summary over, the copy
// starts from that summary: the turn it fell in comes from the compaction on, and the session that goes on is told
// its place in the copy. The parts on their own here, then through the app and a fake agent.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, FAKE_ACP_AGENT, startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { foldGroup, REPORT_CHARS } from "../src/core/fold.js";
import { adaptTurn } from "../src/core/turn-adapter.js";
import { flattenMessages } from "../src/core/wire/flatten.js";
import { CARRY_WORDS } from "../src/core/context-words.js";
import { CARRY_FORMS, KNOBS, RESULTS_BY_FORM } from "../src/services/session-settings.js";
import { callsOf, renderTurn, shapeAt } from "../src/app/sessions/shapes.js";
import { afterOwnCompaction, compactionHead, copyTurns, copyWindow, earlierOf, leadOf, madeDuring, ofCopyAlone, ownCompactionMark, ownWriter, ROUNDS_LINE, sessionsWentOn, standsFor } from "../src/app/sessions/compaction.js";
import { copyBehind, followOwnCompaction } from "../src/app/sessions/agent-copy.js";
import { agentHeld, seenBy } from "../src/app/sessions/agent-line.js";
import { openWords } from "../src/app/agent/still-open.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { COMPACTED_WORDS, owes, SEEN_HEADER, seenOf } from "../src/adapters/agents/compactions.js";
import { composePrompt, recounted, told } from "../src/adapters/agents/acp/prompt.js";
import { compactionWords } from "../src/ui/harness/lib/labels.js";
import { historyLabel } from "../src/ui/harness/widgets/compaction.js";

/** @param {string} text */
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
/** The model's message: its words, then its calls. @param {string} text @param {...{ id: string, name: string, input: any }} calls */
const model = (text, ...calls) => ({ role: "assistant", content: [...(text ? [{ type: "text", text }] : []), ...calls.map((c) => ({ type: "tool_use", ...c }))] });
/** The results of calls, and the person's words that reached the agent with them. @param {Record<string, string>} byId @param {...string} words */
const results = (byId, ...words) => ({ role: "user", content: [...Object.entries(byId).map(([id, content]) => ({ type: "tool_result", tool_use_id: id, content })), ...words.map((text) => ({ type: "text", text }))] });
/** A message as `role:words|[call]|=result`. @param {any} m */
const said = (m) => `${m.role}:${m.content.map((/** @type {any} */ b) => (b.type === "text" ? b.text : b.type === "tool_use" ? `[${b.id}]` : `=${b.tool_use_id}`)).join("|")}`;
/** A turn that read a file, edited two and ran a failing command. @param {number} n */
const worked = (n) => ({
  turnId: n, n, meta: {},
  user: user(`fix it ${n}`),
  work: [
    model("Reading.", { id: "r1", name: "Read", input: { file_path: "src/a.js" } }),
    results({ r1: "line\n".repeat(400) }),
    model("Editing.", { id: "e1", name: "Edit", input: { file_path: "src\\a.js", old_string: "a", new_string: "b" } }, { id: "w1", name: "Write", input: { file_path: "docs/b.md", content: "x" } }),
    results({ e1: "updated", w1: "written" }),
    model("", { id: "e2", name: "Edit", input: { file_path: "src/a.js", old_string: "b", new_string: "c" } }, { id: "b1", name: "Bash", input: { command: "npm test" } }),
    { role: "user", content: [{ type: "tool_result", tool_use_id: "e2", content: "updated" }, { type: "tool_result", tool_use_id: "b1", content: "3 failed", is_error: true }] },
  ],
  final: model("Two tests still fail."),
});
const TALLY = "⚙ [Filament left this turn's 5 tool calls out: Edit×2, Bash, Read, Write · 1 failed · changed src/a.js, docs/b.md — re-run a tool if you need its output]";
/** The count of turn `n`, as a reader that knows the turn's number writes it: it names the recall (the owner's of 11-06). @param {number} n */
const tallyOf = (n) => TALLY.replace("re-run a tool if you need its output]", `filament_recall({ turn: ${n} }) brings its output back]`);

describe("Words: a turn as its words and one line that counts its tool calls", () => {
  // (fails before: yes — a fold had one form, a line per tool call: a turn of five hundred calls rode as five hundred
  // lines in a copy nobody reads until a fresh session starts)
  test("the fold that counts: the tools by how often, the failures, the files the turn changed, each once; the words in order", () => {
    const t = worked(1);
    const raw = [t.user, ...t.work, t.final];
    const f = foldGroup(raw, { from: 0, to: raw.length }, "anthropic", { stubChars: 160, foldImages: true, calls: "tally" });
    assert.deepEqual(f.messages.map((m) => m.role), ["user", "assistant"]);
    assert.equal(f.messages[1].content.map((/** @type {any} */ b) => b.text).join("\n"), [TALLY, "Reading.", "Editing.", "Two tests still fail."].join("\n"));
    assert.equal(f.stubs, 5, "the calls it stands for are still counted");
    const each = foldGroup(raw, { from: 0, to: raw.length }, "anthropic", { stubChars: 160, foldImages: true });
    const lines = each.messages[1].content.map((/** @type {any} */ b) => b.text).join("\n").split("\n");
    assert.equal(lines.filter((l) => l.startsWith("⚙ ")).length, 5, "a line per call where nothing asks for the count");
    assert.match(lines[0], /^\[Filament folded this turn: 5 tool calls shown one line each/);
  });

  test("a turn that called no tool says no count; an OpenAI call's input is read as the JSON it is", () => {
    const quiet = [user("hi"), model("Hello.")];
    const f = foldGroup(quiet, { from: 0, to: 2 }, "anthropic", { stubChars: 160, foldImages: true, calls: "tally" });
    assert.deepEqual(f.messages[1].content.map((/** @type {any} */ b) => b.text), ["Hello."]);
    const oa = [
      { role: "user", content: "fix" },
      { role: "assistant", content: "On it.", tool_calls: [{ id: "c1", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "a.txt", content: "x" }) } }] },
      { role: "tool", tool_call_id: "c1", content: "ok" },
      { role: "assistant", content: "Done." },
    ];
    const g = foldGroup(oa, { from: 0, to: oa.length }, "openai", { stubChars: 160, foldImages: true, calls: "tally" });
    assert.match(String(g.messages[1].content), /^⚙ \[Filament left this turn's 1 tool call out: write · changed a\.txt — re-run a tool if you need its output\]\nOn it\.\nDone\.$/);
  });

  // (fails before: yes — the owner's of 11-06: a moved chat's Words carried five research agents' reports as one
  // counted line, and its agent launched them again)
  test("Words keeps what a turn's sub-agents reported, where it fell, cut past its cap; a background launch's notice and a failed launch keep none; Folded keeps a line per call", () => {
    const raw = [
      user("map it"),
      model("Mapping.", { id: "a1", name: "Agent", input: { description: "Map the server", prompt: "Read src/http" } }, { id: "a2", name: "mcp__filament__agent", input: { description: "Map the desktop", prompt: "Read desktop/", run_in_background: true } }),
      results({ a1: "guards.js:45 trusts loopback", a2: "Launched sub-agent sa_1 in the background" }),
      model("", { id: "t1", name: "Task", input: { description: "Map the UI", prompt: "Read src/ui" } }, { id: "x1", name: "Agent", input: { description: "Broken" } }),
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "x".repeat(10_000) }] }, { type: "tool_result", tool_use_id: "x1", content: "it failed", is_error: true }] },
      model("Done mapping."),
    ];
    const textOf = (/** @type {any} */ f) => f.messages[1].content.map((/** @type {any} */ b) => b.text).join("\n");
    const words = textOf(foldGroup(raw, { from: 0, to: raw.length }, "anthropic", { stubChars: 160, foldImages: true, calls: "tally" }));
    assert.match(words, /^⚙ \[Filament left this turn's 4 tool calls out: Agent×2, [^\n]* · 1 failed/);
    assert.match(words, /\nMapping\.\n⚙ Agent \(Map the server\) reported:\nguards\.js:45 trusts loopback\n⚙ Task \(Map the UI\) reported:\nx{8000}\n\[… 2,000 more characters of this report\]\nDone mapping\.$/);
    assert.doesNotMatch(words, /Launched sub-agent|it failed|Map the desktop|Broken/);
    const each = textOf(foldGroup(raw, { from: 0, to: raw.length }, "anthropic", { stubChars: 160, foldImages: true }));
    assert.doesNotMatch(each, /reported:/);
    assert.equal(each.split("\n").filter((l) => l.startsWith("⚙ ")).length, 4);
  });

  // (fails before: yes — the review of 8bcb358fc: five sub-agents launched in the background and waited on came back
  // through Filament's wait, which Words counted and left out; and the agent tool's list of models was kept as a report)
  test("Words keeps what Filament's wait and envelope brought back from launches in the background; a wait that brought nothing, a letter written and the agent tool's other acts keep none", () => {
    const raw = [
      user("research it"),
      model("Launching.", { id: "a1", name: "mcp__filament__agent", input: { description: "Map the server", prompt: "Read src/http", run_in_background: true } }, { id: "m1", name: "mcp__filament__agent", input: { list_models: true } }),
      results({ a1: "Launched sub-agent sa_1 in the background", m1: "claude-code-northwind/opus-xhigh · can run\nglm-5.3 · can run" }),
      model("", { id: "w1", name: "mcp__filament__wait", input: { seconds: 300 } }, { id: "w2", name: "mcp__filament__wait", input: { seconds: 300 } }),
      results({ w1: "Waited 45 s and nothing arrived; Filament's sub-agents are still running.", w2: "[Filament: your background sub-agent sa_1 (\"Map the server\") finished.]\nIts report:\nguards.js:45 trusts loopback" }),
      model("", { id: "e1", name: "envelope", input: { all: true } }, { id: "e2", name: "mcp__filament__envelope", input: { to: "sa_2", subject: "more", text: "look at tls too" } }),
      results({ e1: "[Filament: envelope 2, opened]\nIts report:\nno tls server anywhere", e2: "Sent to sa_2." }),
      model("Done."),
    ];
    const words = foldGroup(raw, { from: 0, to: raw.length }, "anthropic", { stubChars: 160, foldImages: true, calls: "tally" }).messages[1].content.map((/** @type {any} */ b) => b.text).join("\n");
    assert.match(words, /\n⚙ mcp__filament__wait brought back:\n\[Filament: your background sub-agent sa_1 \("Map the server"\) finished\.\]\nIts report:\nguards\.js:45 trusts loopback\n⚙ envelope brought back:\n\[Filament: envelope 2, opened\]\nIts report:\nno tls server anywhere\nDone\.$/);
    assert.doesNotMatch(words, /Launched sub-agent|nothing arrived|can run|Sent to sa_2/);
  });

  // (fails before: yes — the hunt of carry-reports: five reports that came in one wait shared one cap, the first kept and
  // the rest cut; a lead's and the loop's launches, in the background unasked, kept their notices as reports; and a
  // lead's wait that brought nothing, with its look at the workers after it, was kept whole)
  test("Words caps each report a wait or an envelope brought, not their sum; a launch that only says it runs on, and a wait that brought no report, keep none", () => {
    const head = (/** @type {string} */ id, /** @type {string} */ ch) => `[Filament: your background sub-agent ${id} ("Map ${ch}") finished. You asked it:\nRead ${ch}\n\nIts report:\n`;
    const report = (/** @type {string} */ id, /** @type {string} */ ch) => `${head(id, ch)}${ch.repeat(9000)}\n\nTo ask it more in the same context, call agent with agent_id "${id}".]`;
    const envelope = `[Filament: envelope 3, opened — from sub-agent sa_7 ("Map d")]\n`;
    const raw = [
      user("research it"),
      model(
        "Launching.",
        { id: "l1", name: "agent", input: { role: "builder", description: "Add the flag", goal: "add --flag" } },
        { id: "l2", name: "agent", input: { description: "Map the http", prompt: "Read src/http" } },
        { id: "l3", name: "Agent", input: { description: "Map the UI", prompt: "Read src/ui" } },
        { id: "l4", name: "mcp__filament__agent", input: { description: "Slow one", prompt: "Read all" } },
        { id: "l5", name: "agent", input: { agent_id: "sa_4", prompt: "and tls" } },
        { id: "l6", name: "mcp__filament__agent", input: { description: "Long one", prompt: "Read more" } },
      ),
      results({
        l1: `Launched builder sa_3 ("Add the flag") in the background. Keep working: its report arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait.`,
        l2: `Launched sub-agent sa_4 ("Map the http") on Opus 5.5 at high in the background. Keep working: its report arrives as a message when it finishes.`,
        l3: "Async agent launched successfully. (This tool result is internal metadata; never quote it.)\nagentId: a1b2",
        l4: `[Filament: sub-agent sa_5 ("Slow one") is still working, longer than one of your calls may wait: it runs on in the background, and its report reaches you as a message from Filament. Don't launch its task again.]`,
        l5: "Sub-agent sa_4 took your follow-up in the background. Keep working: its report arrives as a message when it finishes.",
        l6: `[Filament: the developer sent sub-agent sa_10 ("Long one") to the background, freeing this call: it keeps running, and its report arrives as a message when it finishes.]`,
      }),
      model("", { id: "w1", name: "wait", input: { seconds: 300 } }, { id: "w2", name: "wait", input: {} }, { id: "w3", name: "wait", input: {} }, { id: "w4", name: "mcp__filament__wait", input: {} }),
      results({
        w1: "Waited 30 s and no report arrived; the workers are still running. Call wait again, or carry on with other work.\n\nWorkers still running (1):\n- builder sa_3 (\"Add the flag\"): 2 min, 14 calls",
        w2: "Waited 12 s: your workers moved.\n\nWorkers still running (1):\n- builder sa_3 (\"Add the flag\"): 2 min, 15 calls",
        w3: "Nothing to wait for: no worker you launched is running, and none of your background commands runs.\n\nNo worker is running now.",
        w4: `Waited 40 s: 3 messages from Filament:\n\n${report("sa_1", "a")}\n\n${report("sa_2", "b")}\n\n${report("sa_6", "c")}`,
      }),
      model("", { id: "e1", name: "mcp__filament__envelope", input: { all: true } }, { id: "e2", name: "envelope", input: {} }),
      results({
        e1: `${envelope}${"d".repeat(9000)}\n\n[Filament: envelope 4, opened — from sub-agent sa_8 ("Map e")]\n${"e".repeat(100)}\n\n[Filament: 2 envelopes opened. None is sealed now.]`,
        e2: `Nothing to wait for: nothing you launched is still running. The 2 envelopes still sealed open here, oldest first:\n\n[Filament: envelope 5, opened — from sub-agent sa_9 ("Map f")]\n${"f".repeat(50)}`,
      }),
      model("Done."),
    ];
    const words = foldGroup(raw, { from: 0, to: raw.length }, "anthropic", { stubChars: 160, foldImages: true, calls: "tally" }).messages[1].content.map((/** @type {any} */ b) => b.text).join("\n");
    assert.doesNotMatch(words, /in the background\.|Async agent|is still working|to the background|workers are still running|moved|no worker you launched|No worker is running/);
    const capped = (/** @type {string} */ text) => `${text.slice(0, REPORT_CHARS)}\n[… ${(text.length - REPORT_CHARS).toLocaleString("en-US")} more characters of this report]`;
    assert.ok(words.includes(`\n⚙ mcp__filament__wait brought back:\nWaited 40 s: 3 messages from Filament:\n\n${capped(report("sa_1", "a"))}\n\n${capped(report("sa_2", "b"))}\n\n${capped(report("sa_6", "c"))}\n`), "each of the wait's three reports kept to its cap");
    assert.ok(words.includes(`\n⚙ mcp__filament__envelope brought back:\n${capped(`${envelope}${"d".repeat(9000)}`)}\n\n[Filament: envelope 4, opened — from sub-agent sa_8 ("Map e")]\n${"e".repeat(100)}\n\n[Filament: 2 envelopes opened. None is sealed now.]\n`), "the envelopes' second report kept beside the first");
    assert.match(words, /\n⚙ envelope brought back:\nNothing to wait for: nothing you launched is still running\. The 2 envelopes still sealed open here, oldest first:\n\n\[Filament: envelope 5, opened — from sub-agent sa_9 \("Map f"\)\]\nf{50}\nDone\.$/, "the envelopes a wait opened kept");
    assert.equal(words.split("\n").filter((l) => /^⚙ \S+ (reported|brought back):$/.test(l)).length, 3, "the wait with reports and the two envelopes alone");
  });

  // (fails before: yes — ag-stop, the owner's of 11-11: the agent tool's stop of a sub-agent answers in Filament's words,
  // which Words kept as that sub-agent's report)
  test("Words keeps none of the agent tool's stop of a sub-agent: its answer is Filament's, no report", () => {
    const stopping = 'Stopping sub-agent sa_1 now, with no message sent to it. Its report so far arrives as a message. To take it up again in the context it has, call agent with agent_id "sa_1" and a prompt.';
    const raw = [
      user("stop the map"),
      model("Stopping it.", { id: "s1", name: "agent", input: { description: "Stop the map", agent_id: "sa_1", stop: true } }, { id: "s2", name: "mcp__filament__agent", input: { description: "Stop the other", agent_id: "sa_2", stop: true } }, { id: "a1", name: "agent", input: { description: "Map the UI", prompt: "Read src/ui", run_in_background: false } }),
      results({ s1: stopping, s2: stopping.replaceAll("sa_1", "sa_2"), a1: "ui/app.js mounts the page" }),
      model("Stopped."),
    ];
    const words = foldGroup(raw, { from: 0, to: raw.length }, "anthropic", { stubChars: 160, foldImages: true, calls: "tally" }).messages[1].content.map((/** @type {any} */ b) => b.text).join("\n");
    assert.doesNotMatch(words, /Stopping sub-agent|Stop the map|Stop the other/);
    assert.match(words, /\nStopping it\.\n⚙ agent \(Map the UI\) reported:\nui\/app\.js mounts the page\nStopped\.$/, "a launch's report beside it is kept as it was");
  });

  // (fails before: yes — `context.carry` had no such form, and its default was Whole: every finished turn with its
  // tool output, the copy of a long agent session millions of tokens)
  test("the form: the default of a fresh start, every turn a fold that counts its calls; the other forms keep a line per call", () => {
    assert.deepEqual([...CARRY_FORMS], ["words", "fold", "fold+2", "plain"]);
    assert.equal(KNOBS["context.carry"].default, "words");
    assert.deepEqual(CARRY_WORDS.map((x) => [x.id, x.name]), [["words", "Words"], ["fold", "Folded"], ["fold+2", "Folded, newest 2 whole"], ["plain", "Whole"]]);
    assert.equal(RESULTS_BY_FORM.words, "status");
    assert.deepEqual([0, 1, 7].map((pos) => shapeAt(pos, "words")), ["fold", "fold", "fold"]);
    assert.deepEqual(["words", "fold", "fold+2", "plain", null].map(callsOf), ["tally", "each", "each", "each", "each"]);
    const t = worked(3);
    // (fails before: yes — the hunt of carry-recall: Folded said to re-run a tool, the turn's number known and the recall there)
    const folded = renderTurn(/** @type {any} */ (t), "fold", {});
    assert.match(folded.messages[1].content[0].text, /^\[Filament folded this turn: 5 tool calls shown one line each — filament_recall\(\{ turn: 3 \}\) brings its output back\]\n/);
    assert.match(renderTurn(/** @type {any} */ (t), "fold", { recall: false }).messages[1].content[0].text, /^\[Filament folded this turn: 5 tool calls shown one line each — re-run a tool if you need its output\]\n/, "a reader with no recall");
    const words = renderTurn(/** @type {any} */ (t), "fold", { calls: "tally" });
    assert.deepEqual([words.kind, words.stubs], ["fold", 5]);
    assert.ok(words.messages[1].content[0].text.startsWith(tallyOf(3)), "the turn's number known: the count names its recall");
    assert.ok(!renderTurn(/** @type {any} */ (t), "fold", {}).messages[1].content[0].text.includes("left this turn's"));
  });

  // (fails before: yes — a turn the adapter folds for a call with no equivalent is text, a line per call, with no
  // call left to count: Words carried every one of those lines)
  test("a turn the turn adapter folds into text comes with its calls counted too, and Words renders that", () => {
    const t = { ...worked(4), work: [model("Planning.", { id: "t1", name: "TodoWrite", input: { todos: [] } }), results({ t1: "ok" }), ...worked(4).work] };
    const r = adaptTurn(t, { format: "anthropic", tools: [] });
    assert.equal(r.mode, "folded");
    const each = r.messages[1].content.map((/** @type {any} */ b) => b.text).join("\n");
    const counted = (r.tallied || [])[1].content.map((/** @type {any} */ b) => b.text).join("\n");
    assert.equal(each.split("\n").filter((/** @type {string} */ l) => l.startsWith("⚙ ")).length, 6);
    assert.equal(counted.split("\n").filter((/** @type {string} */ l) => l.startsWith("⚙ ")).length, 1);
    assert.match(counted, /^⚙ \[Filament left this turn's 6 tool calls out: Edit×2, Bash, Read, TodoWrite, Write · 1 failed · changed src\/a\.js, docs\/b\.md — filament_recall\(\{ turn: 4 \}\) brings its output back\]/);
    const plain = adaptTurn({ user: user("hi"), work: [], final: model("Hello.") }, { format: "anthropic", tools: [] });
    assert.deepEqual([plain.mode, plain.tallied], ["translated", undefined], "a translated turn keeps its own messages: the view counts its calls");
    // As the service hands it to the composer: the folded parts, and the counted ones beside them.
    const [u, a] = r.messages, [tu, ta] = /** @type {any[]} */ (r.tallied);
    const adapted = { ...t, user: u, work: [], final: a, tallied: { user: tu, work: [], final: ta }, meta: { adapted: "folded" } };
    assert.equal(renderTurn(/** @type {any} */ (adapted), "fold", { calls: "tally" }).messages[1].content[0].text, counted);
    assert.equal(renderTurn(/** @type {any} */ (adapted), "fold", {}).messages[1].content[0].text, each);
  });

  // (fails before: yes — the review of 8bcb358fc: a coding agent that takes no MCP tools has no filament_recall, and
  // its counts told it to call one)
  test("a reader with no recall is told to re-run a tool: the view's count and the adapter's alike", () => {
    const t = worked(3);
    const bare = renderTurn(/** @type {any} */ (t), "fold", { calls: "tally", recall: false });
    assert.ok(bare.messages[1].content[0].text.startsWith(TALLY), "the count without the recall");
    const crossed = { ...worked(4), work: [model("Planning.", { id: "t1", name: "TodoWrite", input: { todos: [] } }), results({ t1: "ok" }), ...worked(4).work] };
    const r = adaptTurn(crossed, { format: "anthropic", tools: [] });
    const text = (/** @type {any} */ m) => m[1].content.map((/** @type {any} */ b) => b.text).join("\n");
    assert.match(text(r.talliedBare), /^⚙ \[Filament left this turn's 6 tool calls out: [^\]]* — re-run a tool if you need its output\]/);
    const [u, a] = r.messages, [tu, ta] = /** @type {any[]} */ (r.tallied), [bu, ba] = /** @type {any[]} */ (r.talliedBare);
    const adapted = { ...crossed, user: u, work: [], final: a, tallied: { user: tu, work: [], final: ta }, talliedBare: { user: bu, work: [], final: ba }, meta: { adapted: "folded" } };
    assert.equal(renderTurn(/** @type {any} */ (adapted), "fold", { calls: "tally", recall: false }).messages[1].content[0].text, text(r.talliedBare));
    assert.match(renderTurn(/** @type {any} */ (adapted), "fold", { calls: "tally" }).messages[1].content[0].text, /filament_recall\(\{ turn: 4 \}\)/);
    assert.equal(adaptTurn({ ...crossed, n: undefined }, { format: "anthropic", tools: [] }).talliedBare, undefined, "no number, no recall named: one count serves both");
  });
});

describe("the copy's head: an agent's own summary, and the turn it compacted in the middle of", () => {
  const summary = { id: 3, from_turn: 1, to_turn: 4, text: "S", method: "summary", detail: {} };
  const mirror = { id: 5, from_turn: 1, to_turn: 4, text: "A", method: "own", detail: { during: 5, cutAfter: "r1", by: "Claude Code" } };

  test("which row: one made during a turn says the turn; a row with no such turn says none", () => {
    assert.deepEqual([mirror, summary, { detail: { during: 0 } }, { detail: { during: "5" } }, {}, null].map(madeDuring), [5, null, null, null, null, null]);
    assert.deepEqual([mirror, summary, { method: "own", text: null, detail: { by: "Codex" } }, { method: "own", text: "x" }].map(ownWriter), ["Claude Code", null, null, "The agent"]);
  });

  // (fails before: yes — the head was the summary that reaches the furthest turn and the first found of two that
  // reach the same; a row that reaches no whole turn was none)
  test("the head: the furthest turn, the newest of two that reach the same, a row being weighed the newest of all; the first turn's own counts", () => {
    assert.equal(compactionHead([summary, mirror])?.id, 5);
    assert.equal(compactionHead([mirror, summary])?.id, 5);
    assert.equal(compactionHead([mirror, { ...summary, id: 9, to_turn: 6 }])?.id, 9, "a later summary of Filament's reaches further");
    assert.equal(compactionHead([mirror, { from_turn: 1, to_turn: 4, text: "pending" }])?.text, "pending");
    const first = { id: 1, from_turn: 1, to_turn: 0, text: "A", method: "own", detail: { during: 1, cutAfter: null } };
    assert.equal(compactionHead([first])?.id, 1);
    assert.equal(compactionHead([{ id: 1, from_turn: 1, to_turn: 0, text: "x", detail: {} }]), null, "a row that stands for nothing is none");
    assert.equal(compactionHead([{ ...mirror, text: null }, summary])?.id, 3, "a row whose summary is gone stands for nothing");
    // (fails before: yes — HarnessV4_Tasks C29: every row's text was asked for before the rows were ranked)
    // Ranked first: the row that reaches furthest is asked for its text, and none behind it is.
    /** @type {number[]} */
    const asked = [];
    const row = (/** @type {number} */ id, /** @type {number} */ to, /** @type {string | null} */ text) => ({ id, from_turn: 1, to_turn: to, detail: {}, get text() { asked.push(id); return text; } });
    assert.equal(compactionHead([row(1, 2, "A"), row(2, 4, "B"), row(3, 9, null), row(4, 6, "C")])?.id, 4);
    assert.deepEqual(asked, [3, 4], "the fold's row that reaches further has none; the next in rank is the head");
  });

  test("the words: whose summary it is and what it stands for, to the model that goes on and to a summary's writer", () => {
    assert.equal(standsFor(mirror), "turns 1–4 and the work of turn 5 up to then");
    assert.equal(standsFor({ from_turn: 1, to_turn: 0, detail: { during: 1 } }), "the work of turn 1 up to then");
    assert.equal(standsFor({ from_turn: 2, to_turn: 2 }), "turn 2");
    assert.equal(leadOf(mirror), "[Claude Code compacted its own context during turn 5: its summary below stands for turns 1–4 and the work of turn 5 up to then. Carry on from it where the conversation stands, without recapping it.]\nA");
    assert.equal(leadOf({ ...mirror, detail: { by: "Claude Code" }, to_turn: 5 }), "[Claude Code compacted its own context: its summary below stands for turns 1–5. Carry on from it where the conversation stands, without recapping it.]\nA");
    assert.equal(leadOf(summary), "[Filament compacted turns 1–4 into the summary below. Carry on from it where the conversation stands, without recapping it.]\nS");
    assert.equal(earlierOf(mirror), "[The summary Claude Code wrote as it compacted its own context: it stands for turns 1–4 and the work of turn 5 up to then]\nA");
    assert.equal(earlierOf(summary), "[The summary an earlier compaction wrote of turns 1–4]\nS");
  });

  // (fails before: yes — the copy kept the whole turn: the work the agent's summary already stands for rode beside
  // that summary)
  test("the turn from the compaction on: after the results of the last call before it, the mark in the work's place; the person's words that came with those results stay", () => {
    const t = {
      n: 5, user: user("go"), final: model("Done."),
      work: [model("Reading.", { id: "r1", name: "Read", input: {} }), results({ r1: "A" }, "and b too"), model("Reading b.", { id: "r2", name: "Read", input: {} }), results({ r2: "B" })],
    };
    const cut = afterOwnCompaction(t, mirror);
    assert.deepEqual(cut.work.map(said), [`assistant:${ROUNDS_LINE}`, `user:${ownCompactionMark("Claude Code")}|and b too`, "assistant:Reading b.|[r2]", "user:=r2"]);
    assert.deepEqual([cut.user, cut.final, cut.n], [t.user, t.final, 5], "the person's message and the reply as they were");
    assert.equal(ownCompactionMark("Claude Code"), "[Claude Code compacted its own context at this point of the turn: the work before it is in the summary above.]");
    assert.equal(ownCompactionMark(null), "[The agent compacted its own context at this point of the turn: the work before it is in the summary above.]");
  });

  test("before any call: the whole work follows the mark; words the person sent before any call ride with it, so the messages alternate", () => {
    const none = { ...mirror, detail: { during: 5, cutAfter: null, by: "Claude Code" } };
    const t = { n: 5, user: user("go"), final: model("Done."), work: [model("Reading.", { id: "r1", name: "Read", input: {} }), results({ r1: "A" })] };
    assert.deepEqual(afterOwnCompaction(t, none).work.map(said), [`assistant:${ROUNDS_LINE}`, `user:${ownCompactionMark("Claude Code")}`, "assistant:Reading.|[r1]", "user:=r1"]);
    const steered = { ...t, work: [user("short answers"), ...t.work] };
    assert.deepEqual(afterOwnCompaction(steered, none).work.map(said), [`assistant:${ROUNDS_LINE}`, `user:${ownCompactionMark("Claude Code")}|short answers`, "assistant:Reading.|[r1]", "user:=r1"]);
    // After the last call: only the reply is left.
    const late = afterOwnCompaction(t, { ...mirror, detail: { during: 5, cutAfter: "r1" } });
    assert.deepEqual(late.work.map(said), [`assistant:${ROUNDS_LINE}`, `user:${ownCompactionMark(null)}`]);
  });

  // (fails before: no — a guard: nothing is cut on a guess)
  test("a turn whose work no longer holds that call comes whole", () => {
    const t = { n: 5, user: user("go"), final: model("Done."), work: [model("Reading.", { id: "x9", name: "Read", input: {} }), results({ x9: "A" })] };
    assert.equal(afterOwnCompaction(t, mirror), t);
  });

  test("the copy's turns and its window: only the head's turn is cut, and only under that head", () => {
    const turns = [4, 5, 6].map((n) => ({ n, user: user(`m${n}`), final: model("ok"), work: [model("", { id: "r1", name: "Read", input: {} }), results({ r1: "A" }), model("more")] }));
    const cut = copyTurns(turns, [summary, mirror]);
    assert.deepEqual(cut.map((t) => t.work.length), [3, 3, 3]);
    assert.deepEqual([cut[0] === turns[0], cut[1] === turns[1], cut[2] === turns[2]], [true, false, true]);
    assert.deepEqual(cut[1].work.map(said), [`assistant:${ROUNDS_LINE}`, `user:${ownCompactionMark("Claude Code")}`, "assistant:more"]);
    assert.deepEqual(copyTurns(turns, [mirror, { ...summary, id: 9, to_turn: 6 }]), turns, "under a later head of Filament's the turn is as archived");
    assert.deepEqual(copyTurns(turns, []), turns);
    const w = copyWindow(cut, [summary, mirror]);
    assert.deepEqual([w.head?.id, w.fromN, w.inWindow.map((t) => t.n)], [5, 5, [5, 6]]);
    assert.deepEqual(copyWindow(turns, []), { head: null, fromN: 1, inWindow: turns });
  });
});

describe("the row the turn's end writes, with no model call", () => {
  /** An archive that keeps rows. @param {any[]} rows @param {number} n */
  const archiveOf = (rows, n) => {
    /** @type {any[]} */
    const added = [];
    return {
      added,
      getTurn: (/** @type {number} */ id) => (id === 77 ? { id: 77, n } : null),
      getCompactions: () => rows,
      addCompaction: (/** @type {string} */ chainId, /** @type {any} */ row) => (added.push({ chainId, ...row }), { id: 41, hash: "h" }),
    };
  };
  const compacted = { summary: "  Kept: the plan.  ", cutAfter: "r1", manual: false, before: 180_000, after: 31_000, ms: 42_000 };

  // (fails before: yes — nothing wrote the agent's summary into the chat: the copy never followed its compactions)
  test("the agent's summary as the chat's compaction: the turns before this one from where the copy started, the turn and the call it fell after, whose it is, its figures", () => {
    const a = archiveOf([{ id: 3, from_turn: 2, to_turn: 4, summary_hash: "s", detail: {} }, { id: 4, from_turn: 5, to_turn: 6, summary_hash: null, method: "fold", detail: {} }], 9);
    assert.deepEqual(followOwnCompaction({ archive: a, chainId: "c1", turnId: 77, by: "Claude Code", model: "haiku", compacted }), { id: 41 });
    assert.deepEqual(a.added, [{
      chainId: "c1", fromTurn: 2, toTurn: 8, summaryText: "Kept: the plan.", kind: "plain", window: "harness", method: "own",
      detail: { during: 9, cutAfter: "r1", by: "Claude Code", before: 180_000, after: 31_000, exact: true, model: "haiku", how: "agent-own", ms: 42_000 },
      attached: null,
    }]);
  });

  // (fails before: yes — the owner's of 11-08: after Claude's own summary nothing came back, so the model the chat moved
  // to lost the files, the plan, the task graph and what was still open)
  test("what comes back after it, as after a summary of Filament's: of the turns it stands for, kept with the row", () => {
    const a = archiveOf([], 9);
    /** @type {number[]} */
    const asked = [];
    const block = { text: "[Filament brought these back after the summary: …]", files: [{ shown: true }], plan: true, tokens: 40 };
    followOwnCompaction({ archive: a, chainId: "c1", turnId: 77, by: "Claude Code", compacted, blockAfter: (to) => (asked.push(to), block) });
    assert.deepEqual([asked, a.added[0].toTurn, a.added[0].attached], [[8], 8, block], "up to the turn before the one it fell in");
    const none = archiveOf([], 9);
    followOwnCompaction({ archive: none, chainId: "c1", turnId: 77, by: "Claude Code", compacted, blockAfter: () => ({ ...block, text: "" }) });
    assert.equal(none.added[0].attached, null, "an empty block is none");
  });

  test("the session's first turn: no turn before it; a /compact of the agent's own is said for one; a preview's row is no head", () => {
    const a = archiveOf([{ id: 1, from_turn: 1, to_turn: 3, summary_hash: "s", detail: { door: "now" } }], 1);
    followOwnCompaction({ archive: a, chainId: "c1", turnId: 77, by: "Claude Code", compacted: { summary: "S", cutAfter: null, manual: true } });
    assert.deepEqual(a.added, [{ chainId: "c1", fromTurn: 1, toTurn: 0, summaryText: "S", kind: "manual", window: "harness", method: "own", detail: { during: 1, cutAfter: null, by: "Claude Code", exact: true, how: "agent-own" }, attached: null }]);
  });

  test("no summary, or no such turn: no row", () => {
    const a = archiveOf([], 2);
    assert.equal(followOwnCompaction({ archive: a, chainId: "c1", turnId: 77, by: "x", compacted: { ...compacted, summary: "   " } }), null);
    assert.equal(followOwnCompaction({ archive: a, chainId: "c1", turnId: 5, by: "x", compacted }), null);
    assert.deepEqual(a.added, []);
  });
});

describe("what the run keeps of the agent's own compactions", () => {
  /** @param {Record<string, any>} [o] */
  const make = (o = {}) => createAgentRun({ publish: () => {}, sink: { breakBlock: () => 0 }, now: () => 1000, ...o });
  /** Claude's raw assistant message. @param {string} id @param {any[]} content */
  const assistant = (id, content) => ({ type: "raw", message: { type: "assistant", parent_tool_use_id: null, message: { id, role: "assistant", content } } });
  /** Claude's raw tool result. @param {string} id @param {string} content */
  const result = (id, content) => ({ type: "raw", message: { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } } });

  // (fails before: yes — the run kept a cut copy of the summary for the page, and nothing of where it fell)
  test("Claude's: the summary whole, the last call it had made by then, its figures as they come after its end", async () => {
    const run = make({ rawMessages: true });
    run.take(assistant("m1", [{ type: "text", text: "Reading." }]));
    run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]));
    run.take(result("t1", "A"));
    run.take({ type: "compaction", id: "c1", state: "started" });
    const long = `Kept: ${"the plan and its reasons. ".repeat(400)}`.trim();
    run.take({ type: "compaction", id: "c1", state: "completed", summary: long });
    run.take({ type: "compaction", id: "c1", state: "completed", tokensBefore: 180_000, tokensAfter: 31_000, ms: 42_000 });
    run.take(assistant("m2", [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "b" } }]));
    run.take(result("t2", "B"));
    run.take(assistant("m3", [{ type: "text", text: "Done." }]));
    const { compacted, left, final } = run.archive();
    assert.deepEqual(compacted, { summary: long, cutAfter: "t1", manual: false, before: 180_000, after: 31_000, ms: 42_000 });
    assert.deepEqual([left, final], [null, [{ type: "text", text: "Done." }]]);
  });

  test("before any call: no call to cut after; two in one turn: the newest; one that failed: none", async () => {
    const early = make({ rawMessages: true });
    early.take({ type: "compaction", id: "c1", state: "completed", summary: "S1", manual: true });
    assert.deepEqual(early.archive().compacted, { summary: "S1", cutAfter: null, manual: true, before: 0, after: 0, ms: 0 });
    const twice = make({ rawMessages: true });
    twice.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: {} }]));
    twice.take(result("t1", "A"));
    twice.take({ type: "compaction", id: "c1", state: "completed", summary: "S1" });
    twice.take(assistant("m2", [{ type: "tool_use", id: "t2", name: "Read", input: {} }]));
    twice.take(result("t2", "B"));
    twice.take({ type: "compaction", id: "c2", state: "completed", summary: "S2" });
    assert.deepEqual([twice.archive().compacted?.summary, twice.archive().compacted?.cutAfter], ["S2", "t2"]);
    const failed = make({ rawMessages: true });
    failed.take({ type: "compaction", id: "c1", state: "started" });
    failed.take({ type: "compaction", id: "c1", state: "failed", error: "Not enough messages to compact." });
    assert.deepEqual([failed.archive().compacted, failed.archive().left], [null, null]);
    assert.deepEqual([make().archive().compacted, make().archive().left], [null, null], "a turn with none");
  });

  // (fails before: yes — nothing told an agent that hands no summary over from one that does, nor a session that
  // holds less than the chat)
  test("an agent that hands no summary over, or whose session held less than the chat: nothing the copy can start from, and why", async () => {
    const codex = make();
    codex.take({ type: "tool", id: "c1", title: "npm test", kind: "execute", status: "pending", rawInput: { command: "npm test" } });
    codex.take({ type: "tool", id: "c1", terminalOutput: { output: "ok" }, status: "completed" });
    codex.take({ type: "compaction", id: "k1", state: "completed", tokensBefore: 200_000 });
    assert.deepEqual([codex.archive().compacted, codex.archive().left], [null, "unsaid"]);
    const partial = make({ rawMessages: true });
    partial.take({ type: "compaction", id: "c1", state: "completed", summary: "S", partial: true });
    assert.deepEqual([partial.archive().compacted, partial.archive().left], [null, "partial"]);
    const sub = make({ rawMessages: true });
    sub.take({ type: "compaction", id: "c1", state: "completed", summary: "S", subagent: "task_1" });
    assert.deepEqual([sub.archive().compacted, sub.archive().left], [null, null], "a sub-agent's is its own context's");
  });

  test("another agent's turn, rebuilt from its rounds: the last call it had made by then", async () => {
    const run = make();
    run.take({ type: "text", text: "Looking." });
    run.take({ type: "tool", id: "c1", title: "npm test", kind: "execute", status: "pending", rawInput: { command: "npm test" } });
    run.take({ type: "tool", id: "c1", terminalOutput: { output: "ok" }, status: "completed" });
    run.take({ type: "compaction", id: "k1", state: "completed", summary: "S" });
    assert.equal(run.archive().compacted?.cutAfter, "c1");
  });
});

describe("the session that goes on is told its place in the copy", () => {
  test("the header: the copy's head and the count, or nothing", () => {
    assert.equal(SEEN_HEADER, "x-filament-seen");
    assert.deepEqual(seenOf({ [SEEN_HEADER]: "12:7" }), { head: 12, seen: 7 });
    assert.deepEqual([seenOf({}), seenOf({ [SEEN_HEADER]: "12" }), seenOf({ [SEEN_HEADER]: "a:b" }), seenOf(null)], [null, null, null, null]);
  });

  test("which sessions hold less than the whole chat: one told to skip what it missed, a fresh one still owed its seed, one that heard turns as typed", () => {
    assert.deepEqual([{}, { seenUserTurns: 4 }, { partial: true }, { fresh: true }, { heard: [3] }, { heard: [] }, null].map(owes), [false, false, true, true, true, false, false]);
    const conv = { seenUserTurns: 2 };
    told(conv, { userTurns: 5, command: false, skipped: true });
    assert.deepEqual(conv, { seenUserTurns: 5, partial: true });
    const whole = { seenUserTurns: 2 };
    told(whole, { userTurns: 3, command: false });
    assert.deepEqual(whole, { seenUserTurns: 3 });
  });

  // (fails before: yes — the bridge counted the person's turns in the copy as it stood at the session's last prompt:
  // a copy that starts from the agent's summary holds other turns, so the session read as behind and was handed its
  // own work back as another assistant's)
  test("once per head: the harness's count stands for the session's, with what it kept by the earlier form's places", () => {
    const conv = { seenUserTurns: 9, within: { after: 9, texts: ["x"] }, heard: [4] };
    assert.equal(recounted(conv, { head: 12, seen: 3 }), true);
    assert.deepEqual(conv, { seenUserTurns: 3, countedOn: 12 });
    conv.seenUserTurns = 4;
    assert.equal(recounted(conv, { head: 12, seen: 3 }), false, "the same head again: the session's own count goes on");
    assert.equal(conv.seenUserTurns, 4);
    assert.equal(recounted(conv, null), false);
    const fresh = {};
    assert.equal(recounted(fresh, { head: 12, seen: 3 }), false, "a session that saw nothing yet is seeded, not recounted");
    assert.deepEqual(fresh, { countedOn: 12 });
  });

  /** The prompt a live session is sent. @param {any[]} messages @param {Record<string, any>} conv @param {{ head: number, seen: number } | null} seen */
  const sent = (messages, conv, seen) => {
    const flat = flattenMessages("anthropic", { messages });
    const lastIdx = flat.map((m) => m.role).lastIndexOf("user");
    /** @type {string[]} */
    const notes = [];
    const r = composePrompt({ acp: {}, flat, history: flat.slice(0, lastIdx), last: flat[lastIdx], conv, reused: true, resumed: false, seeded: false, archSeed: null, notes, seen });
    return { ...r, notes };
  };
  // The copy after the agent compacted in the middle of turn 2: its summary, its acknowledgment, turn 2 from there on.
  const copy = [user("[Claude Code compacted its own context during turn 2: …]\nS"), model("Understood — I continue from that summary."), user("go"), model("Done."), user("next")];

  test("the session that compacted goes on: sent the message as typed, no catch-up", () => {
    // It saw 2 turns of the person's as the copy stood then (two whole turns); the copy now holds 2 ahead of the new message.
    const conv = { seenUserTurns: 2, turns: 2 };
    const r = sent(copy, conv, { head: 7, seen: 2 });
    assert.equal(r.promptText, "next");
    assert.deepEqual(r.notes, ["acp: Filament's copy of the chat starts from a summary written since this session's last prompt, while the session went on: its place in the copy is the harness's count"]);
    // Ten turns seen of a copy that now holds two: unsaid, the session would never read as behind again.
    const long = { seenUserTurns: 10, turns: 10 };
    assert.equal(sent(copy, long, { head: 7, seen: 2 }).promptText, "next");
    assert.equal(long.seenUserTurns, 2);
  });

  test("a session of the chat that is behind the summary is handed it, and what came after", () => {
    // It answered turn 1 only: of the copy it has seen nothing (the summary's place is turn 2).
    const r = sent(copy, { seenUserTurns: 1, turns: 1 }, { head: 7, seen: 0 });
    assert.match(r.promptText, /^Meanwhile, this conversation continued with another assistant/);
    assert.match(r.promptText, /Claude Code compacted its own context during turn 2/);
    assert.match(r.promptText, /Latest user message[\s\S]*next$/);
  });

  test("the count: the person's turns of the request up to the newest turn that agent answered", () => {
    const turns = [
      { n: 1, meta: { facts: { upstream: "claude" } } },
      { n: 2, meta: { facts: { upstream: "claude" } } },
      { n: 3, meta: { facts: { upstream: "zai" } } },
    ];
    // The head (turn 2's), turn 2 from the compaction on with a steer in it, turn 3 by another model.
    const messages = [user("[lead]"), model("ack"), user("go"), model(ROUNDS_LINE), user("[mark]"), model("Done."), user("elsewhere"), model("There."), user("new")];
    const places = [2, 2, 2, 2, 2, 2, 3, 3];
    assert.equal(seenBy({ messages, places, turns, upstream: "claude" }), 3);
    assert.equal(seenBy({ messages, places, turns, upstream: "zai" }), 4);
    assert.equal(seenBy({ messages, places, turns, upstream: "codex" }), 0, "an agent that answered none has seen none");
    assert.equal(seenBy({ messages, places, turns: turns.slice(0, 1), upstream: "claude" }), 0, "one whose newest turn the head stands for holds none of the request's turns apart");
  });

  // (fails before: yes — any compaction of the agent's since its newest turn began read as one made after it: what the
  // turn said it holds gave way to the row's figure)
  test("what the agent holds: a compaction it made in the middle of its newest turn is in that turn's own count", () => {
    const turn = { n: 2, startedAt: 1000, endedAt: 2000, meta: { facts: { upstream: "ag", context: { held: 40_000, window: 200_000, source: "agent" } } } };
    const row = { created_at: 2001, method: "own", detail: { during: 2, before: 180_000, after: 31_000 } };
    assert.deepEqual(agentHeld({ turns: [turn], compactions: [row], upstream: "ag", window: null }), { held: 40_000, window: 200_000, estimated: false, endedAt: 2000 });
    assert.equal(agentHeld({ turns: [turn], compactions: [row, { created_at: 2500, method: "own", detail: { after: 18_000 } }], upstream: "ag", window: null })?.held, 18_000, "one it was asked for after the turn still counts");
  });
});

describe("the page's words", () => {
  // (fails before: yes — every own compaction read "compacted by the agent, in its own session", whatever became of
  // Filament's copy)
  test("the boundary: whose compaction, and what Filament's copy does with it", () => {
    assert.equal(compactionWords({ fromTurn: 1, toTurn: 4, method: "own", chars: 900, detail: { by: "Claude Code" } }), "turns 1–4 compacted by Claude Code, in its own session: Filament's copy starts from its summary");
    assert.equal(compactionWords({ fromTurn: 1, toTurn: 4, method: "own", chars: 0, detail: { by: "Codex" } }), "turns 1–4 compacted by Codex, in its own session: it handed no summary over, so Filament's copy keeps the turns until Filament summarizes them");
    assert.equal(compactionWords({ fromTurn: 1, toTurn: 4, method: "own", chars: 900, detail: { by: "Claude Code", during: 5 } }), "Claude Code compacted its own context during turn 5: Filament's copy starts from its summary");
    assert.equal(compactionWords({ fromTurn: 1, toTurn: 0, method: "own", chars: 900, detail: { during: 1 } }), "the agent compacted its own context during turn 1: Filament's copy starts from its summary");
    assert.equal(compactionWords({ fromTurn: 1, toTurn: 4, method: "summary" }), "turns 1–4 compacted into one summary");
  });

  test("the widget's history row", () => {
    assert.equal(historyLabel({ fromTurn: 1, toTurn: 0, method: "own", detail: { during: 1, by: "Claude Code" } }), "During turn 1: compacted by Claude Code");
    assert.equal(historyLabel({ fromTurn: 1, toTurn: 4, method: "own", detail: null }), "Turns 1–4 compacted by the agent");
    assert.equal(historyLabel({ fromTurn: 2, toTurn: 3, method: "fold" }), "Turns 2–3 folded");
  });
});

describe("through the app", () => {
  const CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** JSON lines of a file, oldest first. @param {string} file */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** The prompts the fake agent was sent. @param {string} id */
  const prompts = (id) => lines(join(root, `${id}-prompts.jsonl`));
  /** The session methods it was sent. @param {string} id */
  const calls = (id) => lines(join(root, `${id}-calls.jsonl`));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-copy-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    up = await fakeUpstream(() => anthropicReply("Loop here.", { model: "m-1", usage: { input_tokens: 10, output_tokens: 5 } }));
    /** @param {string} id @param {string} name */
    const agent = (id, name) => ({
      id, name, type: "acp",
      acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(root, `${id}-prompts.jsonl`), FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: projDir, permissions: "allow-all", hints: false },
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          agent("cc", "Claude Code (agent via ACP)"),
          agent("cc2", "Claude Code · Work (agent via ACP)"),
          { id: "cx", name: "Codex", type: "codex", acp: { command: process.execPath, args: [CODEX], env: {}, cwdDefault: projDir, permissions: "allow-all" } },
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
        ];
        cfg.routes = [
          ...["cc", "cc2", "cx"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true })),
          { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await shim.api(path, init)).json();
  /** @param {string} id */
  const at = (id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A session on `model`. @param {string} model @param {any} [context] */
  const open = async (model, context = {}) => String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", settings: { context: { compaction: { model: "m-1" }, ...context } } } })).id);
  /** The turn's record, once its run's account is on it. @param {string} id */
  const recordOf = (id) =>
    until(async () => {
      const rec = await shim.record(id);
      return rec?.acp?.run || rec?.status ? rec : null;
    }, `${id}'s record`);
  /** A turn as the page sends one — a run, whose work the archive keeps: its record's notes. @param {string} id @param {string} content @param {any} [more] */
  const say = async (id, content, more = {}) => {
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true, ...more } });
    assert.equal(res.status, 200, await res.clone().text());
    await res.text();
    const rec = await recordOf(String(res.headers.get("x-filament-request-id")));
    return { notes: /** @type {string[]} */ ([...(rec.priorChanges || []), ...(rec.changes || [])]) };
  };
  /** The session's compaction rows. @param {string} id */
  const rows = (id) => /** @type {any} */ (shim.app.memory.archive).getCompactions(id);
  /** Filament's copy as the next request would carry it, with `text` as the message. @param {string} id @param {string} text */
  const copyOf = async (id, text) => (await json(`${at(id)}/compose?dry=1&prompt=1&text=${encodeURIComponent(text)}`)).current.prompt.messages;
  /** A message as `role:words|[call name]|=result`. @param {any} m */
  const shown = (m) => `${m.role}:${(Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]).map((/** @type {any} */ b) => (b.type === "text" ? b.text : b.type === "tool_use" ? `[${b.name}]` : `=${typeof b.content === "string" ? b.content : JSON.stringify(b.content)}`)).join("|")}`;
  const FOLLOWED = "acp: Claude Code compacted its own context during the turn and handed its summary over: Filament's copy of the chat starts from that summary, then this turn from there on";
  const RECOUNTED = "acp: Filament's copy of the chat starts from a summary written since this session's last prompt, while the session went on: its place in the copy is the harness's count";
  const LEAD_2 = "[Claude Code compacted its own context during turn 2: its summary below stands for turn 1 and the work of turn 2 up to then. Carry on from it where the conversation stands, without recapping it.]\nKept: the readme says hello agent.";
  const MARK = "[Claude Code compacted its own context at this point of the turn: the work before it is in the summary above.]";
  /** What comes back with the agent's summary: the readme the turn read before it compacted (the review of cb2d2d1f0). */
  const BACK = "|[Filament brought these back after the summary: the files the work used most recently, as they are on disk now.";
  /** A message that is the summary of turn 2's compaction, the readme brought back with it. @param {string} m @param {string} [by] */
  const lead2 = (m, by = "Claude Code") => m.startsWith(`user:${LEAD_2.replace(/Claude Code/g, by)}${BACK}`) && m.includes("README.md");
  /** What the first prompt after a compaction with nothing open says, once (still-open.js; the owner's of 11-08). */
  const AFTER = openWords([], "lost");

  // (fails before: yes — the copy kept both turns whole, the read's output with them, and the agent's summary went no
  // further than the page's row: after twenty-six such compactions the copy of one real session weighed millions of
  // tokens beside an agent that never held more than its window)
  test("the agent compacts in the middle of a turn: its summary is the chat's compaction, the copy starts from it, and the session goes on as typed", async () => {
    const id = await open("cc/haiku");
    await say(id, "one");
    const two = await say(id, "~midcompact two");
    assert.ok(two.notes.includes(FOLLOWED), two.notes.join("\n"));
    const [row, ...more] = rows(id);
    assert.deepEqual(more, []);
    assert.deepEqual([row.method, row.kind, row.window, row.from_turn, row.to_turn], ["own", "plain", "harness", 1, 1]);
    const { attached, ...detail } = row.detail;
    assert.deepEqual(detail, { during: 2, cutAfter: "mc_r1", by: "Claude Code", before: 180_000, after: 31_000, exact: true, model: "haiku", how: "agent-own", ms: 42_000 });
    // (fails before: yes — the review of cb2d2d1f0) The readme the turn read before it compacted comes back with the summary.
    assert.deepEqual([attached?.shown, attached?.named, attached?.plan], [1, 0, false], JSON.stringify(attached));
    // The copy under Words, the default: the summary, then turn 2 from the compaction on, its one call since counted.
    const copy = (await copyOf(id, "three")).map(shown);
    assert.equal(copy.length, 5, copy.join("\n"));
    assert.ok(lead2(copy[0]), copy[0]);
    assert.deepEqual([copy[1], copy[2], copy[4]], ["assistant:Understood — I continue from that summary.", "user:~midcompact two", "user:three"]);
    assert.match(copy[3], /^assistant:⚙ \[Filament left this turn's 1 tool call out: bash — filament_recall\(\{ turn: 2 \}\) brings its output back\]\nWorking on it\.\n\[Claude Code compacted its own context at this point of the turn: the work before it is in the summary above\.\]\nChecking the tree\.\nAll clean\.$/i);
    assert.ok(!copy.slice(1).join("\n").includes("hello agent") && !/Reading the readme\./.test(copy.join("\n")), "what the summary stands for is gone from the copy's turns: the readme comes back with the summary alone");
    // The page: the row after the turn it fell in, with the summary to open, and no Undo.
    const tr = await json(`${at(id)}/transcript`);
    const [b] = tr.boundaries.filter((/** @type {any} */ x) => x.type === "compaction");
    assert.deepEqual([b.afterTurn, b.fromTurn, b.toTurn, b.method, b.undoable, b.text], [2, 1, 1, "own", false, "Kept: the readme says hello agent."]);
    assert.equal(compactionWords(b), "Claude Code compacted its own context during turn 2: Filament's copy starts from its summary");
    const undo = await shim.api(`${at(id)}/compactions/${row.id}/undo`, { method: "POST" });
    assert.equal(undo.status, 409, await undo.clone().text());
    const pv = (await json(`${at(id)}/compose?dry=1`));
    assert.deepEqual(pv.compactions.map((/** @type {any} */ c) => [c.method, c.undoable, c.detail.during]), [["own", false, 2]]);
    assert.equal(pv.current.compactedSince, false, "the turn's own count says what the agent holds");
    // The next turns: the same agent session, the message as typed, told its place once.
    const [session] = calls("cc").filter((c) => c.method === "session/new").map((c) => c.sessionId).slice(-1);
    const three = await say(id, "three");
    assert.deepEqual([prompts("cc").at(-1)?.sessionId, prompts("cc").at(-1)?.text], [session, `three\n\n${AFTER}`]);
    assert.ok(three.notes.includes(RECOUNTED), three.notes.join("\n"));
    assert.ok(!three.notes.some((n) => /fresh agent session|turns it missed|another assistant/.test(n)), three.notes.join("\n"));
    const four = await say(id, "four");
    assert.deepEqual([prompts("cc").at(-1)?.sessionId, prompts("cc").at(-1)?.text], [session, "four"]);
    assert.ok(!four.notes.includes(RECOUNTED), "once per head");
    assert.equal(calls("cc").filter((c) => c.method === "session/new" && c.sessionId === session).length, 1);
    assert.equal(rows(id).length, 1);
  });

  // (fails before: yes — the same, in the whole form: the read and its output rode in front of the summary's turn)
  test("the copy chosen Whole: the turn from the compaction on with its calls, nothing of the work before it", async () => {
    const id = await open("cc/haiku", { carry: "plain" });
    await say(id, "one");
    await say(id, "~midcompact two");
    const copy = (await copyOf(id, "three")).map(shown);
    assert.ok(lead2(copy[0]), copy[0]);
    assert.deepEqual(copy.slice(1, 5), ["assistant:Understood — I continue from that summary.", "user:~midcompact two", "assistant:Working on it.", `user:${MARK}`], copy.join("\n"));
    assert.match(copy.slice(5).join("\n"), /^assistant:Checking the tree\.\|\[bash\]\nuser:=.*clean.*\nassistant:All clean\.\nuser:three$/i);
  });

  // (fails before: yes — a row that reaches no whole turn was no head at all)
  test("in the session's first turn: the summary stands for that turn's start alone, and the next turn goes on in the session", async () => {
    const id = await open("cc/haiku");
    const one = await say(id, "~compact first");
    assert.ok(one.notes.includes(FOLLOWED), one.notes.join("\n"));
    const [row] = rows(id);
    assert.deepEqual([row.from_turn, row.to_turn, row.detail.during, row.detail.cutAfter], [1, 0, 1, null]);
    const copy = (await copyOf(id, "two")).map(shown);
    assert.deepEqual(copy, [
      "user:[Claude Code compacted its own context during turn 1: its summary below stands for the work of turn 1 up to then. Carry on from it where the conversation stands, without recapping it.]\nKept: the reading so far.",
      "assistant:Understood — I continue from that summary.",
      "user:~compact first",
      `assistant:Working on it.\n${MARK}\nReading.\nGoing on.`,
      "user:two",
    ]);
    const [session] = calls("cc").filter((c) => c.method === "session/new").map((c) => c.sessionId).slice(-1);
    const two = await say(id, "two");
    assert.deepEqual([prompts("cc").at(-1)?.sessionId, prompts("cc").at(-1)?.text], [session, `two\n\n${AFTER}`]);
    assert.ok(two.notes.includes(RECOUNTED) && !two.notes.some((n) => /fresh agent session|another assistant/.test(n)), two.notes.join("\n"));
  });

  // (fails before: yes — another model was handed every turn whole; and the agent that compacted, switched back into,
  // read as far behind as the copy had changed, so it was handed its own work back as another assistant's)
  test("a switch to another model starts from the agent's summary; back in the agent that compacted, its session is handed the one turn it missed", async () => {
    const id = await open("cc2/haiku");
    await say(id, "one");
    await say(id, "~midcompact two");
    up.received.length = 0;
    const now = await say(id, "now you", { settingsPatch: { model: { name: "m-1" } }, sendAsIs: true });
    // (fails before: yes — the review of 11-08: the loop's record said what is still open changed)
    assert.ok(now.notes.includes("agent: the chat's context was compacted with nothing said after it, and nothing is open: recall's list of the turns named with the turn's first request"), now.notes.join("\n"));
    const sent = up.received.at(-1)?.body.messages.map(shown);
    assert.ok(lead2(sent[0], "Claude Code · Work"), sent[0]);
    assert.deepEqual(sent.slice(1, 3), ["assistant:Understood — I continue from that summary.", "user:~midcompact two"], sent.join("\n"));
    assert.ok(!sent.join("\n").includes("Reading the readme.") && sent.at(-1) === `user:now you|${AFTER}`, sent.join("\n"));
    const [session] = calls("cc2").filter((c) => c.method === "session/new").map((c) => c.sessionId).slice(-1);
    const back = await say(id, "and back", { settingsPatch: { model: { name: "cc2/haiku" } }, sendAsIs: true });
    assert.ok(back.notes.includes(RECOUNTED), back.notes.join("\n"));
    assert.deepEqual(
      [prompts("cc2").at(-1)?.sessionId, prompts("cc2").at(-1)?.text],
      [session, "Meanwhile, this conversation continued with another assistant (you did not see these turns; continue from them, do not repeat them):\n\n### User\nnow you\n\n### Assistant\nLoop here.\n\n---\nLatest user message:\n\nand back"],
      "its own summary and its own turn are not handed back",
    );
    assert.equal(rows(id).length, 1);
  });

  // (fails before: yes — another agent's fresh session was handed every turn whole)
  test("another agent starts fresh from the same copy, as Words; where it compacts in its own turn the copy's head is its summary, and the first agent starts fresh from the copy there", async () => {
    const id = await open("cc2/haiku");
    await say(id, "one");
    await say(id, "~midcompact two");
    // Another account of the same agent, answered on the switch's card with Words (HarnessV4_Tasks A7).
    const other = await say(id, "and you", { settingsPatch: { model: { name: "cc/haiku" } }, carry: "words" });
    assert.ok(other.notes.includes("compose: agent: you switched to Claude Code from Claude Code · Work, another account of the same agent, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as Words (chosen on the switch's card)"), other.notes.join("\n"));
    const seed = String(prompts("cc").at(-1)?.text || "");
    assert.match(seed, /Claude Code · Work compacted its own context during turn 2[\s\S]*Kept: the readme says hello agent\.[\s\S]*left this turn's 1 tool call out[\s\S]*All clean\.[\s\S]*and you/);
    assert.ok(!seed.includes("Reading the readme."), "the work the summary stands for is in no seed");
    // The fake agent reads its script's word in the seed and compacts in the middle of this turn too: a second row,
    // its own, reaching further — the copy's head from now on.
    assert.ok(other.notes.includes(FOLLOWED), other.notes.join("\n"));
    assert.deepEqual(rows(id).map((/** @type {any} */ r) => [r.from_turn, r.to_turn, r.detail.during, r.detail.by]), [[1, 1, 2, "Claude Code · Work"], [1, 2, 3, "Claude Code"]]);
    const copy = (await copyOf(id, "x")).map(shown);
    assert.ok(copy[0].startsWith(`user:[Claude Code compacted its own context during turn 3: its summary below stands for turns 1–2 and the work of turn 3 up to then. Carry on from it where the conversation stands, without recapping it.]\nKept: the readme says hello agent.${BACK}`), copy[0]);
    assert.deepEqual([copy.length, copy[2]], [5, "user:and you"]);
    // The first agent's session holds what the other's summary stands for, and none of what came after (HarnessV4_Tasks
    // A8): it is let go, and a fresh one starts from the copy — the summary and the turns since, nothing twice.
    // (fails before: yes — it went on, handed the summary and the turns since on top of all it held)
    const [was] = calls("cc2").filter((c) => c.method === "session/new").map((c) => c.sessionId).slice(-1);
    const back = await say(id, "and back", { settingsPatch: { model: { name: "cc2/haiku" } }, sendAsIs: true });
    assert.ok(back.notes.includes(`acp: the chat was compacted since session ${String(was).slice(0, 8)} started: it is let go, and a fresh session starts from the compaction`), back.notes.join("\n"));
    const sent = prompts("cc2").at(-1);
    assert.notEqual(sent?.sessionId, was);
    assert.ok(String(sent?.text || "").startsWith(`${COMPACTED_WORDS}:\n\n### User\n[Claude Code compacted its own context during turn 3: its summary below stands for turns 1–2 and the work of turn 3 up to then`), String(sent?.text).slice(0, 400));
    // A session that begins from the copy never compacted: its seed's head says the compaction, once, and nothing after
    // the person's message says it again.
    assert.match(String(sent?.text || ""), /### User\nand you[\s\S]*Latest user message:\n\nand back$/);
    assert.ok(!String(sent?.text || "").includes(AFTER), "the compaction in the other agent's turn, said by the seed's head alone");
    assert.ok(!/Meanwhile|Reading the readme\./.test(String(sent?.text)), "nothing handed on top of a session's own");
  });

  // The owner's report of 10-17 (HarnessV4_Tasks A8): back on the first account after the second's Claude Code had
  // compacted its own context, the first account's session from before went on, handed the second's summary and the
  // six turns since on top of all it held — 522,000 tokens, where the copy held 433,000 — and the card showed no figure.
  // (fails before: yes — the card said the session from before goes on, and it did)
  test("back on an account whose session the other account's own compaction left behind: the card says a new session starts from the summary, and one does", async () => {
    const id = await open("cc2/haiku");
    await say(id, "one");
    const [was] = calls("cc2").filter((c) => c.method === "session/new").map((c) => c.sessionId).slice(-1);
    await say(id, "two", { settingsPatch: { model: { name: "cc/haiku" } }, sendAsIs: true });
    const three = await say(id, "~compact three");
    assert.ok(three.notes.includes(FOLLOWED), three.notes.join("\n"));
    const asked = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content: "four", stream: true, runEvents: true, settingsPatch: { model: { name: "cc2/haiku" } } } });
    const body = JSON.parse(await asked.text());
    assert.equal(asked.status, 409, JSON.stringify(body));
    assert.deepEqual([body.switchQuestion.account, body.switchQuestion.sameModel, body.switchQuestion.resumes, body.switchQuestion.compacted], [true, true, false, true]);
    assert.match(body.error, /It starts a new session of this chat now, and Filament hands it the conversation from its own copy: the summary of the newest compaction, then every turn since, whole unless you choose less below/);
    const four = await say(id, "four", { sendAsIs: true });
    assert.ok(four.notes.includes(`acp: the chat was compacted since session ${String(was).slice(0, 8)} started: it is let go, and a fresh session starts from the compaction`), four.notes.join("\n"));
    const seed = prompts("cc2").at(-1);
    assert.notEqual(seed?.sessionId, was);
    assert.ok(String(seed?.text || "").startsWith(`${COMPACTED_WORDS}:\n\n### User\n[Claude Code compacted its own context during turn 3: its summary below stands for turns 1–2 and the work of turn 3 up to then`), String(seed?.text).slice(0, 400));
    assert.ok(!/Meanwhile/.test(String(seed?.text)), "the summary and the turns since, once");
  });

  /** A first message long enough that a summary of its turn makes the copy smaller (a summary is guessed at 1,000 tokens or more). */
  const LONG_ONE = `one ${"word ".repeat(1500)}`.trim();

  // (fails before: yes — where the agent handed no summary over, Filament's copy kept every turn, whatever it grew to)
  test("an agent that hands no summary over (Codex): Filament writes the copy's summary once the turn has ended — a row of the copy alone — and the thread goes on, told its place once", async () => {
    const id = await open("cx/gpt-6-astra");
    await say(id, LONG_ONE);
    up.received.length = 0;
    const two = await say(id, "~compact two");
    assert.ok(
      two.notes.includes("acp: Codex compacted its own context during the turn and handed no summary over: Filament's copy keeps this turn, and a summary of the turns before it is written for the copy once the turn has ended, where a model can write it and they weigh more than a summary would (context.compaction.follow)"),
      two.notes.join("\n"),
    );
    const [row, ...more] = await until(async () => (rows(id).length ? rows(id) : null), "the copy's row");
    assert.deepEqual(more, []);
    assert.deepEqual([row.method, row.kind, row.window, row.from_turn, row.to_turn], ["summary", "plain", "harness", 1, 1]);
    assert.deepEqual([row.detail.copy, row.detail.by, row.detail.model, row.detail.how, row.detail.attached], ["agent", "Codex", "m-1", "call", undefined]);
    // The compaction model read turn 1, and not the turn the agent compacted in.
    const read = JSON.stringify(up.received.at(-1)?.body.messages);
    assert.ok(/## Turn 1\\nUser: one/.test(read) && !read.includes("## Turn 2"), read.slice(0, 600));
    // The copy: Filament's summary, then turn 2 as it was said. Codex takes Filament's tools, filament_recall among them:
    // the summary with nothing brought back after it says the turn comes back through it (the owner's of 11-09, D6).
    const copy = (await copyOf(id, "three")).map(shown);
    assert.deepEqual([copy.length, copy[0], copy[1], copy[2], copy[4]], [5, "user:[Filament compacted turn 1 into the summary below. Carry on from it where the conversation stands, without recapping it.]\nLoop here.|[Filament: Turn 1 comes back word for word with filament_recall({ turn: 1 }).]", "assistant:Understood — I continue from that summary.", "user:~compact two", "user:three"], copy.join("\n"));
    // The page: the row after the turn it reaches, said for what it is, with no Undo; the agent holds what it held.
    const tr = await json(`${at(id)}/transcript`);
    const [b] = tr.boundaries.filter((/** @type {any} */ x) => x.type === "compaction");
    assert.deepEqual([b.afterTurn, b.fromTurn, b.toTurn, b.method, b.undoable], [1, 1, 1, "summary", false]);
    assert.equal(compactionWords(b), "turn 1 compacted into one summary for Filament's copy alone (Codex compacted its own context and handed no summary over): Codex's own session goes on as it is");
    const undo = await shim.api(`${at(id)}/compactions/${row.id}/undo`, { method: "POST" });
    assert.equal(undo.status, 409, await undo.clone().text());
    const pv = await json(`${at(id)}/compose?dry=1`);
    assert.deepEqual(pv.compactions.map((/** @type {any} */ c) => [c.method, c.undoable, c.detail.copy]), [["summary", false, "agent"]]);
    assert.equal(pv.current.compactedSince, false, "nothing the agent holds changed");
    // The next turns: the same thread, told its place in the copy once, and no second summary of what is followed.
    const three = await say(id, "three");
    assert.ok(three.notes.some((n) => /^codex: thread \w+ reused/.test(n)), three.notes.join("\n"));
    assert.ok(three.notes.includes("codex: Filament's copy of the chat starts from a summary written since this thread's last prompt, while the thread went on: its place in the copy is the harness's count"), three.notes.join("\n"));
    assert.ok(!three.notes.some((n) => /fresh|another assistant|turns it missed/.test(n)), three.notes.join("\n"));
    const four = await say(id, "four");
    assert.ok(four.notes.some((n) => /^codex: thread \w+ reused/.test(n)) && !four.notes.some((n) => /its place in the copy/.test(n)), four.notes.join("\n"));
    assert.equal(rows(id).length, 1);
  });

  // (fails before: yes — the copy's summary was written whatever the turns weighed: a model call that left a small
  // copy larger than the turns it stood for)
  test("a copy too small to gain from a summary keeps its turns: nothing is written until the turns behind the newest outweigh one", async () => {
    const id = await open("cx/gpt-6-astra");
    await say(id, "one");
    up.received.length = 0;
    await say(id, "~compact two");
    await say(id, "three");
    const asked = () => up.received.some((/** @type {any} */ r) => JSON.stringify(r.body?.messages ?? "").includes("## Turn 1"));
    assert.deepEqual([rows(id), asked()], [[], false], "three turns of a few words: no summary, no call");
    await say(id, `four ${"word ".repeat(1500)}`.trim());
    assert.deepEqual([rows(id), asked()], [[], false], "the long turn is the newest: it stays as it was said, and the ones behind it are small");
    await say(id, "five");
    const [row, ...more] = await until(async () => (rows(id).length ? rows(id) : null), "the copy's row");
    assert.deepEqual(more, []);
    assert.deepEqual([row.from_turn, row.to_turn, row.detail.copy, row.detail.by], [1, 4, "agent", "Codex"]);
    assert.ok(row.detail.before > 1000, "what it read: the turns that outweigh a summary");
  });

  test("the session that keeps every turn (context.compaction.follow off): no row, the copy keeps the turns as Words, and the record says so", async () => {
    const id = await open("cx/gpt-6-astra", { compaction: { model: "m-1", follow: false } });
    await say(id, "one");
    const two = await say(id, "~compact two");
    assert.ok(two.notes.includes("acp: Codex compacted its own context during the turn and handed no summary over: Filament's copy keeps the turns as they were (context.compaction.follow is off)"), two.notes.join("\n"));
    await say(id, "three");
    assert.deepEqual(rows(id), []);
    const copy = (await copyOf(id, "four")).map(shown);
    assert.deepEqual([copy.length, copy[0], copy[2], copy[4], copy[6]], [7, "user:one", "user:~compact two", "user:three", "user:four"], copy.join("\n"));
  });

  // (fails before: yes — every form of a fresh start weighed a turn's calls a line each at the least)
  test("the forms weighed: Words is the lightest where the turns hold tool calls", async () => {
    const id = await open("cc/haiku");
    await say(id, "~work on the readme");
    await say(id, "~work on the readme again");
    const pv = await json(`${at(id)}/compose?dry=1&form=words,fold,plain`);
    const { words, fold, plain } = pv.forms;
    assert.ok(words.tokens < fold.tokens && fold.tokens <= plain.tokens, JSON.stringify([words.tokens, fold.tokens, plain.tokens]));
    assert.equal(pv.current.form, "words");
    assert.equal(pv.current.tokens, words.tokens);
  });
});

// ---- C29: the copy's own summary, where the agent hands none over ---------------------------------------------------

// (fails before: yes — nothing said the copy was behind: where the agent handed no summary over, the copy kept every turn)
test("copyBehind: the agent compacted where the copy's head has not reached, and handed no summary — in a turn, or on request; followed once the head reaches the turn before", () => {
  const turns = [1, 2, 3, 4, 5].map((n) => ({ n, meta: n === 4 ? { ownCompaction: { by: "Codex", left: "unsaid" } } : {} }));
  const row = (/** @type {any} */ o) => ({ id: 1, from_turn: 1, kind: "plain", window: "harness", method: "summary", text: "S", detail: {}, ...o });
  assert.deepEqual(copyBehind({ turns, compactions: [] }), { by: "Codex" }, "in turn 4: the copy holds turns 1–3 behind it");
  assert.deepEqual(copyBehind({ turns, compactions: [row({ to_turn: 2 })] }), { by: "Codex" });
  assert.equal(copyBehind({ turns, compactions: [row({ to_turn: 3 })] }), null, "the head reaches turn 3: followed, turn 4 stays as it was said");
  assert.equal(copyBehind({ turns: turns.slice(0, 3), compactions: [] }), null, "no compaction of the agent's");
  assert.equal(copyBehind({ turns: [{ n: 1, meta: { ownCompaction: { by: "Codex", left: "unsaid" } } }], compactions: [] }), null, "in the first turn: nothing before it");
  // On request, at the line: a row of the method own with no text.
  const own = { id: 2, from_turn: 1, to_turn: 5, kind: "manual", window: "harness", method: "own", text: null, detail: { by: "Cursor", how: "agent-own" } };
  const plain = turns.map((t) => ({ n: t.n, meta: {} }));
  assert.deepEqual(copyBehind({ turns: plain, compactions: [own] }), { by: "Cursor" });
  assert.equal(copyBehind({ turns: plain, compactions: [own, row({ id: 3, to_turn: 4 })] }), null);
  assert.equal(copyBehind({ turns: plain, compactions: [{ ...own, text: "ITS SUMMARY" }] }), null, "it handed its summary over: the copy starts from that");
  // (fails before: yes — HarnessV4_Tasks C29: an own compaction's summary behind the copy's start was opened to know
  // it had one) A row the copy's start is past is not asked for its text.
  const past = { ...own, id: 1, to_turn: 3, get text() { throw new Error("opened a summary behind the copy's start"); } };
  assert.equal(copyBehind({ turns: plain, compactions: [past, row({ id: 3, to_turn: 4 })] }), null);
  // Stopped by the person: nothing up to there asks again; the agent's next compaction does.
  assert.equal(copyBehind({ turns, compactions: [], held: 3 }), null);
  assert.deepEqual(copyBehind({ turns: [...turns, { n: 6, meta: { ownCompaction: { by: "Codex", left: "unsaid" } } }], compactions: [], held: 3 }), { by: "Codex" });
});

// (fails before: yes — a row of the copy alone was one of two things, by `detail.during`)
test("ofCopyAlone and sessionsWentOn: the agent's own in the middle of a turn, and the summary Filament wrote for the copy — neither moves a session, both are told on", () => {
  const during = { method: "own", text: "ITS", detail: { during: 4, by: "Claude Code" } };
  const copy = { method: "summary", text: "OURS", detail: { copy: "agent", by: "Codex" } };
  const ours = { method: "summary", text: "OURS", detail: { model: "w" } };
  const asked = { method: "own", text: "ITS", detail: { by: "Claude Code" } };
  assert.deepEqual([during, copy, ours, asked].map(ofCopyAlone), [true, true, false, false]);
  assert.deepEqual([during, copy, ours, asked, null].map(sessionsWentOn), [true, true, false, true, false]);
  // What the agent holds is its last turn's count: the copy's summary since changed none of it.
  const turns = [{ n: 1, startedAt: 100, endedAt: 200, meta: { facts: { upstream: "ag", context: { held: 50_000, window: 200_000, source: "agent" } } } }];
  const at = agentHeld({ turns, compactions: [{ ...copy, id: 1, created_at: 300, to_turn: 1 }], upstream: "ag", window: 200_000 });
  assert.deepEqual([at?.held, at?.unsaid], [50_000, undefined]);
  assert.equal(agentHeld({ turns, compactions: [{ ...ours, id: 1, created_at: 300, to_turn: 1 }], upstream: "ag", window: 200_000 }), null, "Filament's own compaction: the next turn starts fresh");
});

test("a compaction of the copy alone in words: the timeline's row and the Compactions list say whose it is, and that the agent's session went on", () => {
  const b = { fromTurn: 1, toTurn: 7, method: "summary", chars: 900, detail: { copy: "agent", by: "Codex" } };
  assert.equal(compactionWords(b), "turns 1–7 compacted into one summary for Filament's copy alone (Codex compacted its own context and handed no summary over): Codex's own session goes on as it is");
  assert.equal(compactionWords({ ...b, detail: { copy: "line" } }), "turns 1–7 compacted into one summary for Filament's copy alone (the copy passed the session's line): the agent's own session goes on as it is");
  assert.equal(historyLabel(/** @type {any} */ (b)), "Turns 1–7 summarized for Filament's copy");
  assert.equal(historyLabel(/** @type {any} */ ({ fromTurn: 1, toTurn: 4, method: "newest", detail: { leftFrom: 1 } })), "Turns 1–4 compacted", "a way no compaction takes any more (the owner's rules of 10-31): its old row says it compacted");
  assert.equal(compactionWords({ fromTurn: 1, toTurn: 5, method: "own", chars: 0, detail: { by: "Codex" } }), "turns 1–5 compacted by Codex, in its own session: it handed no summary over, so Filament's copy keeps the turns until Filament summarizes them");
});
