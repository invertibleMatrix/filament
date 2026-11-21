// @ts-check
// Codex through its app-server (HarnessV3-ACP AC2-1). The reader that turns Codex's notifications into the events
// every bridge speaks; the policy, model and failure words; and the bridge against a fake app-server
// (fixtures/fake-codex-app-server.mjs): a chat's thread reused, resumed after a restart, replaced and seeded when it
// cannot be; approvals by the permission policy, and in a harness turn by the session's switch (AC3-2); the account
// and its windows on the record; a stop, a silence, a failure by its kind, a crash; a sub-agent's work on its own
// card, and two chats on one app-server kept apart; and everything Filament sends or reads held to the pinned protocol.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";
import { createCodexReader, readsOnly, changeLines, changeDiff } from "../src/adapters/agents/codex/items.js";
import { commandCall, fileCall } from "../src/core/codex-items.js";
import { READS_ON_WINDOWS, CodexBridge, codexPolicy, expandCodexModels, selectCodexModel, codexError } from "../src/adapters/agents/codex/bridge.js";
import { codexProfile } from "../src/adapters/agents/codex/app-server.js";
import { CODEX_SCHEMA } from "../src/adapters/agents/codex/schema-pin.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { classifyFailure } from "../src/adapters/agents/acp/failures.js";
import { commandLine } from "../src/core/catalogues.js";

const FAKE = join(FIXTURES, "fake-codex-app-server.mjs");
const quiet = () => {};

/** A token count as Codex reports one. @param {number} input @param {number} cached @param {number} output */
const counts = (input, cached, output) => ({
  totalTokens: input + output,
  inputTokens: input,
  cachedInputTokens: cached,
  cacheWriteInputTokens: 0,
  outputTokens: output,
  reasoningOutputTokens: 0,
});

/**
 * A reader of thread T, with what it builds in view; `hear` is one notification of T unless its params name another.
 * @param {{ bridgePlan?: (entries: any[]) => boolean }} [o]
 */
function reading({ bridgePlan = () => false } = {}) {
  /** @type {any[]} */
  const events = [];
  /** @type {string[]} */
  const notes = [];
  const out = { text: "", tools: [], linesAdded: 0, linesRemoved: 0, title: null, agentModel: null, error: null };
  const reader = createCodexReader({ threadId: "T", out, onEvent: (ev) => events.push(ev), notes, turn: { bridgePlan }, version: "0.154.0" });
  /** @param {string} method @param {any} [params] */
  const hear = (method, params = {}) => reader.read(method, { threadId: "T", turnId: "U", ...params });
  return { reader, events, notes, out, hear };
}
/** A spawn call of thread T, its thread not known yet. @param {string} id */
const spawn = (id) => ({ type: "collabAgentToolCall", id, tool: "spawnAgent", senderThreadId: "T", receiverThreadIds: [], prompt: `job ${id}`, model: "m", agentsStates: {} });

describe("Codex's reader", () => {
  test("an earlier turn's late end does not end this one; this turn's own does", async () => {
    const { reader, hear } = reading();
    reader.turnId("U2");
    let ended = false;
    reader.ended.then(() => (ended = true));
    hear("turn/completed", { turn: { id: "U1", status: "interrupted" } });
    await new Promise((r) => setImmediate(r));
    assert.equal(ended, false, "the stopped turn before this one ended late: not this turn's end");
    hear("turn/completed", { turn: { id: "U2", status: "completed" } });
    assert.equal((await reader.ended).status, "completed");
  });

  test("a reasoning item is drawn once: as its summary or its text, whichever came first; a whole one from its end", () => {
    const { hear, events } = reading();
    hear("item/started", { item: { type: "reasoning", id: "r1", summary: [], content: [] } });
    hear("item/reasoning/summaryTextDelta", { itemId: "r1", delta: "Plan", summaryIndex: 0 });
    hear("item/reasoning/textDelta", { itemId: "r1", delta: "raw thinking", contentIndex: 0 });
    hear("item/reasoning/summaryPartAdded", { itemId: "r1", summaryIndex: 1 });
    hear("item/reasoning/summaryTextDelta", { itemId: "r1", delta: "Next", summaryIndex: 1 });
    hear("item/completed", { item: { type: "reasoning", id: "r1", summary: ["Plan", "Next"], content: ["raw thinking"] } });
    hear("item/completed", { item: { type: "reasoning", id: "r2", summary: ["Whole"], content: [] } });
    assert.deepEqual(
      events.filter((e) => e.type === "thought").map((e) => e.text),
      ["Plan", "\n\n", "Next", "Whole"],
    );
  });

  test("a command's card reads as what it does; only reads pass a read-only policy", () => {
    assert.deepEqual(commandCall({ command: "cat a.txt", commandActions: [{ type: "read", command: "cat a.txt", name: "a.txt", path: "a.txt" }] }), {
      toolName: "read",
      kind: "read",
      title: "Read a.txt",
      rawInput: { file_path: "a.txt" },
      locations: [{ path: "a.txt" }],
    });
    assert.equal(commandCall({ command: "rg foo src", commandActions: [{ type: "search", query: "foo", path: "src" }] }).title, "Search foo");
    assert.equal(commandCall({ command: "ls", commandActions: [{ type: "listFiles" }] }).title, "List .");
    const two = commandCall({ command: "cat a && rm b", commandActions: [{ type: "read", path: "a" }, { type: "unknown", command: "rm b" }] });
    assert.deepEqual([two.toolName, two.title], ["bash", "cat a && rm b"], "two actions: a command");
    assert.equal(readsOnly([{ type: "read" }, { type: "listFiles" }, { type: "search" }]), true);
    assert.equal(readsOnly([{ type: "read" }, { type: "unknown" }]), false);
    assert.equal(readsOnly([]), false, "a command Codex cannot read for what it does is not a read");
    assert.equal(readsOnly(undefined), false);
  });

  test("a file change: a card per file as its patch grows, a diff each, its lines once applied", () => {
    const { hear, events, out } = reading();
    const a = { path: "a.txt", kind: { type: "add" }, diff: "x\n" };
    const b = { path: "b.txt", kind: { type: "delete" }, diff: "y\nz\n" };
    const c = { path: "c.txt", kind: { type: "update", move_path: "d.txt" }, diff: "@@ -1 +1 @@\n-old\n+new\n" };
    hear("item/started", { item: { type: "fileChange", id: "p", changes: [], status: "inProgress" } });
    hear("item/fileChange/patchUpdated", { itemId: "p", changes: [a] });
    hear("item/fileChange/patchUpdated", { itemId: "p", changes: [a, b] });
    hear("item/completed", { item: { type: "fileChange", id: "p", status: "completed", changes: [a, b, c] } });
    const calls = events.filter((e) => e.type === "tool" && e.phase === "call");
    assert.deepEqual(
      calls.map((e) => [e.id, e.toolName, e.title]),
      [
        ["p#0", "write", "Write a.txt"],
        ["p#1", "", "Delete"],
        ["p#2", "edit", "Edit d.txt"],
      ],
      "each file once, in the order Codex named them",
    );
    const ends = events.filter((e) => e.type === "tool" && e.phase === "update");
    assert.deepEqual(ends.map((e) => [e.id, e.status]), [["p#0", "completed"], ["p#1", "completed"], ["p#2", "completed"]]);
    assert.deepEqual(ends.map((e) => e.diffText), ["--- /dev/null\n+++ a.txt\n+x", "--- b.txt\n+++ /dev/null\n-y\n-z", c.diff]);
    assert.deepEqual([out.linesAdded, out.linesRemoved], [2, 3]);
    assert.deepEqual(changeLines(c), { added: 1, removed: 1 });
    assert.equal(changeDiff({ path: "e.txt", kind: { type: "add" }, diff: "" }), "--- /dev/null\n+++ e.txt\n");
    assert.deepEqual(fileCall({ path: "f.txt", kind: { type: "update", move_path: null } }).title, "Edit f.txt");
  });

  test("a generated image is an image's card: what Codex was asked to draw, and the file it saved (AC2-2)", () => {
    const { hear, events } = reading();
    hear("item/started", { item: { type: "imageGeneration", id: "g1", status: "inProgress", revisedPrompt: "a red square", result: "" } });
    hear("item/completed", { item: { type: "imageGeneration", id: "g1", status: "completed", revisedPrompt: "a red square", result: "iVBORw0KGgo=", savedPath: "/work/red.png" } });
    const tools = events.filter((e) => e.type === "tool");
    assert.deepEqual(tools.map((e) => [e.phase, e.id]), [["call", "g1"], ["update", "g1"]]);
    assert.deepEqual([tools[0].toolName, tools[0].rawInput, tools[1].file], ["image_generation", { prompt: "a red square" }, "/work/red.png"]);
  });

  // HarnessV4_Tasks U9. (fails before: yes — an image Codex looked at ended with no content, so its card had no picture)
  test("an image Codex looked at ends with its file as the call's picture, for the run log to keep", () => {
    const { hear, events } = reading();
    hear("item/started", { item: { type: "imageView", id: "v1", path: "/work/shot.png" } });
    hear("item/completed", { item: { type: "imageView", id: "v1", path: "/work/shot.png" } });
    const end = events.find((e) => e.type === "tool" && e.phase === "update");
    assert.deepEqual([end?.status, end?.content], ["completed", [{ type: "image", path: "/work/shot.png" }]]);
  });

  test("a declined item ends as the approval's answer kept it from running, else as Codex declined it alone", () => {
    const { hear, reader, events, out } = reading();
    const change = { path: "a.txt", kind: { type: "add" }, diff: "x\n" };
    hear("item/started", { item: { type: "fileChange", id: "p", changes: [change], status: "inProgress" } });
    hear("item/completed", { item: { type: "fileChange", id: "p", changes: [change], status: "declined" } });
    reader.notRun("c", "refused", "the reject permission policy");
    hear("item/started", { item: { type: "commandExecution", id: "c", command: "rm x", commandActions: [{ type: "unknown" }], status: "inProgress" } });
    hear("item/completed", { item: { type: "commandExecution", id: "c", command: "rm x", commandActions: [{ type: "unknown" }], status: "declined", aggregatedOutput: "" } });
    const ends = events.filter((e) => e.type === "tool" && e.phase === "update");
    assert.deepEqual(ends.map((e) => [e.id, e.status, e.content?.[0].content.text ?? null, e.notRun ?? null, e.why ?? null]), [
      ["p#0", "failed", "Declined: Codex did not change it.", null, null],
      ["c", "failed", null, "refused", "the reject permission policy"],
    ]);
    assert.deepEqual([out.linesAdded, out.linesRemoved], [0, 0], "nothing declined counts as changed");
  });

  test("a sub-agent's thread heard before its call names it is kept, and drawn on that call's card once matched", () => {
    const { hear, reader, events } = reading();
    hear("item/started", { item: spawn("s1") });
    hear("item/started", { item: spawn("s2") });
    assert.equal(reader.expecting(), true);
    // Two spawns wait: a thread that names its parent cannot be told apart yet.
    reader.read("thread/started", { thread: { id: "C2", parentThreadId: "T" } });
    reader.read("item/completed", { threadId: "C2", turnId: "V", item: { type: "agentMessage", id: "m2", text: "done two" } });
    assert.equal(reader.unmatched(), 1);
    assert.ok(reader.owns("C2", null), "a kept thread is the turn's");
    hear("item/completed", { item: { ...spawn("s2"), status: "completed", receiverThreadIds: ["C2"] } });
    assert.equal(reader.unmatched(), 0);
    assert.deepEqual(
      events.filter((e) => e.subagent === "s2").map((e) => [e.type, e.text]),
      [["text", "done two"]],
    );
    assert.equal(reader.expecting(), true, "s1 still waits for its thread");
    reader.read("thread/started", { thread: { id: "C1", parentThreadId: "T" } });
    assert.equal(reader.expecting(), false);
    assert.ok(reader.owns("C1", null));
    assert.equal(reader.owns("X", null), false);
    assert.equal(reader.owns("X", { thread: { parentThreadId: "C1" } }), true, "a sub-agent's own sub-agent");
    reader.read("turn/completed", { threadId: "C1", turn: { id: "V1", status: "failed", error: { message: "it broke" } } });
    assert.deepEqual(events.filter((e) => e.subagent === "s1").map((e) => e.text), ["it broke"], "a failed child says why");
    assert.ok(events.some((e) => e.type === "subagent" && e.state === "failed" && e.id === "s1"));
  });

  test("usage: what the turn billed across its threads; its context: its own thread's last call", () => {
    const { hear, reader } = reading();
    hear("item/started", { item: spawn("s") });
    reader.read("thread/started", { thread: { id: "C", parentThreadId: "T" } });
    // The thread stood at 5000 in before this turn; the turn makes two calls; its sub-agent one.
    hear("thread/tokenUsage/updated", { tokenUsage: { total: counts(6200, 4000, 140), last: counts(1200, 1000, 40), modelContextWindow: 400000 } });
    hear("thread/tokenUsage/updated", { tokenUsage: { total: counts(7700, 5200, 170), last: counts(1500, 1200, 30), modelContextWindow: 400000 } });
    reader.read("thread/tokenUsage/updated", { threadId: "C", tokenUsage: { total: counts(300, 0, 20), last: counts(300, 0, 20), modelContextWindow: 400000 } });
    assert.deepEqual(reader.usage(), {
      usage: { input: 3000 - 2200, output: 90, cacheRead: 2200, cacheWrite: 0, total: 3090, cacheSeen: true },
      context: { used: 1530, size: 400000, cacheRead: 1200 },
    });
    assert.deepEqual(reading().reader.usage(), { usage: null, context: null }, "nothing reported: nothing claimed");
  });

  test("the meter and the Cache while Codex works: its own thread's newest call, each time it reports; a sub-agent's never", () => {
    const { hear, reader, events } = reading();
    hear("item/started", { item: spawn("s") });
    reader.read("thread/started", { thread: { id: "C", parentThreadId: "T" } });
    hear("thread/tokenUsage/updated", { tokenUsage: { total: counts(6200, 4000, 140), last: counts(1200, 1000, 40), modelContextWindow: 400000 } });
    reader.read("thread/tokenUsage/updated", { threadId: "C", tokenUsage: { total: counts(300, 0, 20), last: counts(300, 0, 20), modelContextWindow: 400000 } });
    hear("thread/tokenUsage/updated", { tokenUsage: { total: counts(7700, 5200, 170), last: counts(1500, 1200, 30), modelContextWindow: null } });
    // (fails before: yes — the owner's report of 10-26: the Cache said the last turn's sum all through a running turn;
    // each report names its call's prompt now, what it read from the cache apart from its new input)
    assert.deepEqual(events.filter((e) => e.type === "usage"), [
      { type: "usage", usage: { used: 1240, size: 400000 }, call: { input: 200, cacheRead: 1000, cacheWrite: 0 } },
      { type: "usage", usage: { used: 1530, size: 400000 }, call: { input: 300, cacheRead: 1200, cacheWrite: 0 } },
    ], "a report that leaves the window out keeps the one said before");
  });

  test("a plan: the turn's checklist and the client's task list; a sub-agent's stays its own", () => {
    /** @type {any[][]} */
    const bridged = [];
    const { hear, events, reader } = reading({ bridgePlan: (e) => (bridged.push(e), true) });
    hear("turn/plan/updated", { explanation: null, plan: [{ step: "Read", status: "completed" }, { step: "Write", status: "inProgress" }, { step: " ", status: "pending" }] });
    const entries = [
      { content: "Read", status: "completed", priority: "medium" },
      { content: "Write", status: "in_progress", priority: "medium" },
    ];
    assert.deepEqual(events[0], { type: "plan", entries, bridged: true });
    hear("item/started", { item: spawn("s") });
    reader.read("thread/started", { thread: { id: "C", parentThreadId: "T" } });
    reader.read("turn/plan/updated", { threadId: "C", turnId: "V", plan: [{ step: "Count", status: "pending" }] });
    assert.deepEqual(events.at(-1), { type: "plan", entries: [{ content: "Count", status: "pending", priority: "medium" }], subagent: "s" });
    assert.equal(bridged.length, 1, "the client's task list is the turn's own");
  });

  test("what Filament does not draw is said once in the record; the person's own message and a hook's say nothing", () => {
    const { hear, notes, events } = reading();
    hear("item/started", { item: { type: "userMessage", id: "u", content: [] } });
    hear("item/completed", { item: { type: "hookPrompt", id: "h" } });
    hear("item/started", { item: { type: "holoDeck", id: "x1" } });
    hear("item/completed", { item: { type: "holoDeck", id: "x1" } });
    hear("item/started", { item: { type: "holoDeck", id: "x2" } });
    assert.deepEqual(notes, ['codex: Codex sent an item Filament does not draw yet ("holoDeck", app-server 0.154.0); its work is not on the turn\'s cards']);
    assert.deepEqual(events, []);
  });

  test("Codex retrying says so; its warnings and a model it moved to reach the record", () => {
    const { hear, notes, out } = reading();
    hear("error", { error: { message: "stream disconnected" }, willRetry: true });
    hear("error", { error: { message: "stream disconnected" }, willRetry: true });
    hear("warning", { message: "approaching the context limit" });
    hear("model/rerouted", { fromModel: "gpt-6-astra", toModel: "gpt-6-mini", reason: "capacity" });
    assert.deepEqual(notes, [
      "codex: stream disconnected — Codex is trying again",
      "codex: approaching the context limit",
      "codex: Codex moved this turn from gpt-6-astra to gpt-6-mini (capacity)",
    ]);
    assert.equal(out.agentModel, "gpt-6-mini");
    assert.equal(out.error, null, "a retried error is not the turn's");
  });

  // (fails before: no — a guard the mutation pass asked for: an MCP call's name, kind and error, a web search's
  // query from its action, a command's exit code and its failure)
  test("an MCP call: its server in its name, a read where it says so, its error its result; a search by its action", () => {
    const { hear, events } = reading();
    const mcp = { type: "mcpToolCall", id: "m1", server: "docs", tool: "lookup", arguments: { q: "x" }, readOnlyHint: true, status: "inProgress", result: null, error: null };
    hear("item/started", { item: mcp });
    hear("item/completed", { item: { ...mcp, status: "completed", error: { message: "no such page" } } });
    hear("item/started", { item: { type: "webSearch", id: "w1", query: "", action: { type: "search", query: "acp spec" } } });
    const make = { type: "commandExecution", id: "c1", command: "make", commandActions: [{ type: "unknown", command: "make" }], status: "inProgress" };
    hear("item/started", { item: make });
    hear("item/completed", { item: { ...make, status: "completed", exitCode: 2, aggregatedOutput: "make: no rule" } });
    const calls = events.filter((e) => e.type === "tool" && e.phase === "call");
    assert.deepEqual(
      calls.map((e) => [e.toolName, e.kind, e.title]),
      [
        ["mcp__docs__lookup", "read", "lookup"],
        ["web_search", "fetch", "Search the web: acp spec"],
        ["bash", "execute", "make"],
      ],
    );
    const ends = events.filter((e) => e.type === "tool" && e.phase === "update");
    assert.deepEqual(ends.map((e) => [e.id, e.status, e.exitCode]), [["m1", "failed", undefined], ["c1", "failed", 2]]);
    assert.deepEqual(ends[0].content, [{ type: "text", text: "no such page" }]);
  });

  // (fails before: yes — an image Codex could not make (its plan's image limit) ended as made, its card empty;
  // HarnessV3-ACP AC2's mutation pass)
  test("an image Codex could not make ends failed, and says why", () => {
    const { hear, events } = reading();
    const g = { type: "imageGeneration", id: "g2", status: "inProgress", revisedPrompt: "a blue circle", result: "", failure: null };
    hear("item/started", { item: g });
    hear("item/completed", { item: { ...g, status: "completed", failure: { type: "usageLimitExceeded", limitId: "images", resetsAt: null } } });
    const end = events.find((e) => e.type === "tool" && e.phase === "update");
    assert.deepEqual([end.status, end.content, end.file], ["failed", [{ type: "text", text: "Not made: the plan's image limit is reached." }], undefined]);
  });

  // (fails before: no — a guard the mutation pass asked for: a file's card drawn as Codex names it, before its change
  // ends; a diff's own headers are no lines changed; a report that leaves the window out keeps the one said before)
  test("a file's card is drawn as Codex names it, before the change ends; a diff's headers are no lines", () => {
    const { hear, events, reader } = reading();
    hear("item/started", { item: { type: "fileChange", id: "p", changes: [], status: "inProgress" } });
    hear("item/fileChange/patchUpdated", { itemId: "p", changes: [{ path: "a.txt", kind: { type: "add" }, diff: "x\n" }] });
    assert.deepEqual(events.map((e) => [e.type, e.phase, e.id]), [["tool", "call", "p#0"]]);
    const headed = { path: "b.txt", kind: { type: "update", move_path: null }, diff: "--- b.txt\n+++ b.txt\n@@ -1 +1 @@\n-old\n+new\n" };
    assert.deepEqual(changeLines(headed), { added: 1, removed: 1 });
    hear("thread/tokenUsage/updated", { tokenUsage: { total: counts(100, 0, 10), last: counts(100, 0, 10), modelContextWindow: 400000 } });
    hear("thread/tokenUsage/updated", { tokenUsage: { total: counts(300, 0, 20), last: counts(200, 0, 10), modelContextWindow: null } });
    assert.equal(reader.usage().context?.size, 400000);
  });

  // (fails before: no — a guard the mutation pass asked for: a sub-agent's card ends once, with its own words or the
  // wait's report; more work for one that ended opens a card of its own; a child's calls, lines, name, error and turn
  // are never the turn's own; a thread another turn's thread spawned is not this turn's)
  test("a sub-agent's card: one end, its words or the wait's report, more work on a new card, nothing the turn's own", () => {
    const { hear, reader, events, out } = reading();
    hear("item/started", { item: spawn("s1") });
    reader.read("thread/started", { thread: { id: "C1", parentThreadId: "T" } });
    reader.read("turn/started", { threadId: "C1", turn: { id: "V1" } });
    assert.equal(reader.turnId(), null, "a sub-agent's turn is not the turn's");
    const edit = { type: "fileChange", id: "f1", changes: [{ path: "x.txt", kind: { type: "add" }, diff: "a\nb\n" }], status: "inProgress" };
    reader.read("item/started", { threadId: "C1", item: edit });
    reader.read("item/completed", { threadId: "C1", item: { ...edit, status: "completed" } });
    reader.read("item/agentMessage/delta", { threadId: "C1", itemId: "a1", delta: "found it" });
    reader.read("thread/name/updated", { threadId: "C1", threadName: "Counting files" });
    reader.read("error", { threadId: "C1", error: { message: "child broke" }, willRetry: false });
    assert.deepEqual([out.tools, out.linesAdded, out.title, out.error], [[], 0, null, null], "the child's work is its card's");
    // A wait reports s1 done, in words it said already: they are not said again, and its card ends once.
    const wait = { type: "collabAgentToolCall", id: "w1", tool: "wait", senderThreadId: "T", receiverThreadIds: ["C1", "C9"], prompt: null, model: null, agentsStates: {} };
    hear("item/started", { item: wait });
    hear("item/completed", { item: { ...wait, status: "completed", agentsStates: { C1: { status: "completed", message: "found it" } } } });
    const ends = () => events.filter((e) => e.type === "subagent" && e.state !== "spawned").map((e) => [e.state, e.id]);
    assert.deepEqual(ends(), [["completed", "s1"]]);
    hear("item/completed", { item: { type: "subAgentActivity", id: "x1", kind: "completed", agentThreadId: "C1", agentPath: "" } });
    assert.deepEqual(ends(), [["completed", "s1"]], "its card ends once");
    assert.deepEqual(events.filter((e) => e.subagent === "s1" && e.type === "text").map((e) => e.text), ["found it"]);
    assert.equal(events.find((e) => e.type === "tool" && e.id === "w1")?.title, "Wait for agents (2)");
    // More work for the ended s1: a card of its own, where its next words go.
    const more = { type: "collabAgentToolCall", id: "m1", tool: "sendInput", senderThreadId: "T", receiverThreadIds: ["C1"], prompt: "count again", model: null, agentsStates: {} };
    hear("item/started", { item: more });
    reader.read("item/agentMessage/delta", { threadId: "C1", itemId: "a2", delta: "3 files" });
    assert.deepEqual(events.filter((e) => e.subagent === "m1").map((e) => e.text), ["3 files"]);
    assert.equal(reader.owns("Y", { thread: { parentThreadId: "Z" } }), false, "a thread another turn's thread spawned");
    assert.deepEqual(out.tools.map((/** @type {any} */ t) => t.id), ["w1"]);
  });

  // (fails before: yes — a spawn that failed stayed among those waiting for a thread: the next child thread was
  // matched to its ended card, and the turn kept taking threads nobody owned; HarnessV3-ACP AC2's mutation pass)
  test("a spawn that failed ends its card and takes no thread: the next is the waiting spawn's", () => {
    const { hear, reader, events } = reading();
    hear("item/started", { item: spawn("s2") });
    hear("item/completed", { item: { ...spawn("s2"), status: "failed" } });
    hear("item/started", { item: spawn("s3") });
    hear("item/completed", { item: { type: "subAgentActivity", id: "x2", kind: "completed", agentThreadId: "C3", agentPath: "" } });
    assert.deepEqual(
      events.filter((e) => e.type === "subagent" && e.state !== "spawned").map((e) => [e.state, e.id]),
      [["failed", "s2"], ["completed", "s3"]],
    );
    assert.equal(reader.expecting(), false, "no spawn waits for a thread");
  });
});

describe("Codex's policy, model and failure words", () => {
  test("Filament's permission policy as Codex's approval policy and sandbox", () => {
    assert.deepEqual(codexPolicy("allow-all"), { approvalPolicy: "never", sandbox: "danger-full-access" });
    assert.deepEqual(codexPolicy("read-only"), { approvalPolicy: "untrusted", sandbox: "read-only" });
    assert.deepEqual(codexPolicy("reject"), { approvalPolicy: "untrusted", sandbox: "read-only" });
    assert.deepEqual(codexPolicy("allow-once"), { approvalPolicy: "untrusted", sandbox: "workspace-write" });
    assert.deepEqual(codexPolicy("ask"), { approvalPolicy: "untrusted", sandbox: "workspace-write" });
  });

  test("a model name as Codex's model and effort", () => {
    const items = [
      { id: "gpt-6-astra", model: "gpt-6-astra", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }] },
      { id: "gpt-6", model: "gpt-6", isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
      { id: "secret", model: "secret", hidden: true, supportedReasoningEfforts: [] },
    ];
    assert.deepEqual(expandCodexModels(items), ["gpt-6-astra", "gpt-6-astra-low", "gpt-6-astra-high", "gpt-6", "gpt-6-low"]);
    assert.deepEqual(
      selectCodexModel("gpt-6-astra-high", null, items),
      { model: "gpt-6-astra", effort: "high", notes: ["codex: model gpt-6-astra (effort high)"] },
      "the longest model id the name begins with: gpt-6-astra, not gpt-6",
    );
    assert.deepEqual(selectCodexModel("gpt-6", "high", items), {
      model: "gpt-6",
      effort: null,
      notes: [{ kind: "effort-not-applied", effort: "high", reason: "gpt-6 offers low" }, "codex: model gpt-6"],
    });
    assert.deepEqual(selectCodexModel("auto", "low", items), { model: null, effort: "low", notes: ["codex: model gpt-6-astra (effort low), Codex's default"] });
    assert.deepEqual(selectCodexModel("gpt-6-astra-turbo", null, items), {
      model: null,
      effort: null,
      notes: [{ kind: "model-not-offered", model: "gpt-6-astra-turbo", offers: ["gpt-6-astra", "gpt-6"], keeping: "gpt-6-astra" }],
    });
    assert.equal(selectCodexModel("secret", null, items).model, null, "a hidden model is not offered");
    assert.deepEqual(selectCodexModel("gpt-7", "high", []), { model: "gpt-7", effort: "high", notes: ["codex: model gpt-7 (model list unavailable; sent as is)"] });
  });

  test("a failed turn's error is sorted by Codex's own kind, not its words", () => {
    const e = codexError({ message: "The request was flagged", codexErrorInfo: "cyberPolicy", additionalDetails: "see the policy" });
    assert.equal(e.message, "The request was flagged: see the policy");
    assert.equal(/** @type {any} */ (e).code, "CODEX_TURN");
    assert.equal(classifyFailure(e).kind, "refusal", "its words alone would read as a transport failure");
    assert.equal(classifyFailure(codexError({ message: "Bad gateway", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } })).kind, "transport");
    // (fails before: no — a guard the mutation pass asked for: a kind given as an object was classified, its name never
    // read)
    assert.equal(codexError({ message: "Bad gateway", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } }).data.errorKind, "httpConnectionFailed");
    assert.equal(classifyFailure(codexError({ message: "Too long", codexErrorInfo: "contextWindowExceeded" })).kind, "overflow");
    assert.equal(classifyFailure(codexError({ message: "Wait", codexErrorInfo: "usageLimitExceeded" })).kind, "limit");
    assert.equal(classifyFailure(codexError({ message: "Who are you", codexErrorInfo: "unauthorized" })).kind, "auth");
    assert.equal(codexError(null).message, "Codex's turn failed");
  });

  test("Codex's profile, from the pinned protocol", () => {
    const p = codexProfile("0.154.0");
    assert.deepEqual(p.agent, { name: "codex", title: "Codex", version: "0.154.0" });
    assert.equal(codexProfile("").agent?.version, CODEX_SCHEMA.codex, "before the handshake: the pinned version");
    assert.deepEqual([p.mcp, p.systemPrompt], [{ http: true, sse: false }, true], "a thread takes MCP servers and developer instructions as it opens (AC4)");
    assert.deepEqual(
      [p.sessions.list, p.sessions.resume, p.sessions.close, p.sessions.subagents, p.sessions.load],
      [true, true, true, true, false],
    );
    assert.deepEqual(p.auth, ["chatgpt", "apiKey"]);
    // (fails before: no — a guard the mutation pass asked for: nothing read whether Codex takes a running turn's steer)
    assert.equal(p.steering, true, "Codex takes turn/steer");
  });
});

describe("Codex's bridge against a fake app-server", () => {
  /** @type {string} */ let dir;
  /** @type {CodexBridge} */ let bridge;
  /** @type {Map<string, any>} */
  const profiles = new Map();
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-codex-"));
    bridge = new CodexBridge({ log: quiet, stateFile: join(dir, "codex-sessions.json"), profiles: { put: (id, p) => profiles.set(id, p) } });
  });
  after(async () => {
    bridge.shutdown();
    await removeDirs(dir);
  });

  /** An upstream on the fake, what it hears logged to `<dir>/<id>.jsonl`. @param {string} id @param {any} [acp] @param {Record<string, string>} [env] */
  const fake = (id, acp = {}, env = {}) => ({
    id,
    name: id,
    type: "codex",
    acp: { command: process.execPath, args: [FAKE], env: { FAKE_CODEX_CALLS: join(dir, `${id}.jsonl`), ...env }, cwdDefault: dir, permissions: "allow-all", ...acp },
  });
  /** What Filament sent the upstream's fake: its requests and notifications, oldest first. @param {string} id @returns {any[]} */
  const heard = (id) =>
    existsSync(join(dir, `${id}.jsonl`))
      ? readFileSync(join(dir, `${id}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.method)
      : [];
  /** @param {string} id @param {string} method */
  const sent = (id, method) => heard(id).filter((m) => m.method === method);
  /** @param {string} text @param {any[]} [history] @param {any} [extra] */
  const body = (text, history = [], extra = {}) => ({ model: "m", max_tokens: 100, messages: [...history, { role: "user", content: text }], ...extra });
  /** The chat so far: each message, then its echo. @param {string[]} said */
  const echoed = (...said) => said.flatMap((t) => [{ role: "user", content: t }, { role: "assistant", content: `Echo: ${t}` }]);
  /**
   * One turn, its events kept.
   * @param {any} upstream @param {string} text
   * @param {{ history?: any[], conversationId?: string, modelId?: string, extra?: any, [k: string]: any }} [o]
   */
  async function send(upstream, text, { history = [], conversationId = "chat", modelId = "gpt-6-astra", extra = {}, ...more } = {}) {
    /** @type {any[]} */
    const events = [];
    const out = await bridge.run({ upstream, modelId, format: "anthropic", body: body(text, history, extra), conversationId, onEvent: (/** @type {any} */ ev) => events.push(ev), ...more });
    return { out, events };
  }

  test("a new chat starts a thread with the policy's settings, its next turn goes on in it, the account rides on the record", async () => {
    const up = fake("cx-basic");
    const first = await send(up, "hello", { conversationId: "c-basic" });
    assert.equal(first.out.text, "Echo: hello");
    assert.equal(first.out.stopReason, "end_turn");
    assert.equal(first.out.reused, false);
    assert.ok(first.out.notes.some((/** @type {string} */ n) => /^codex: new Codex thread [0-9a-f]{8}$/.test(n)), first.out.notes.join("\n"));
    const [start] = sent("cx-basic", "thread/start");
    const { cwd, ...settings } = start.params;
    assert.equal(cwd, first.out.cwd);
    assert.deepEqual(settings, { ephemeral: false, approvalPolicy: "never", sandbox: "danger-full-access", model: "gpt-6-astra" });
    const [turn] = sent("cx-basic", "turn/start");
    assert.deepEqual(turn.params, { threadId: first.out.sessionId, input: [{ type: "text", text: "hello", text_elements: [] }], model: "gpt-6-astra" });
    const { at, ...account } = first.out.account;
    assert.equal(typeof at, "number");
    assert.deepEqual(account, {
      kind: "account",
      label: "ChatGPT Plus",
      plan: "plus",
      email: "dev@example.com",
      organization: null,
      detail: null,
      billing: "plan",
      windows: [
        { id: "primary", kind: "session", label: "5-hour", usedPercent: 12, resetsAt: 1791400000000, windowMins: 300, status: null },
        { id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 40, resetsAt: 1791900000000, windowMins: 10080, status: null },
      ],
    });
    assert.deepEqual(first.out.usage, { input: 900, output: 12, cacheRead: 0, cacheWrite: 0, total: 912, cacheSeen: true });
    assert.deepEqual(first.out.context, { used: 912, size: 400000, cacheRead: 0 });
    assert.equal(first.out.agentModel, "gpt-6-astra");
    // (fails before: yes — nothing said Codex starting, its thread opening, or the message gone out: HarnessV3-FailurePoints
    // §5.1 item 2)
    const steps = (/** @type {any[]} */ evs) => evs.filter((e) => e.type === "step").map((e) => e.step);
    assert.deepEqual(steps(first.events), ["starting", "opening", "sent"], "each step the turn waits on, by name");
    const { facts, steer, ...session } = first.events.find((/** @type {any} */ e) => e.type === "session");
    assert.deepEqual(session, { type: "session", sessionId: first.out.sessionId, cwd: first.out.cwd, rawMessages: false });
    assert.equal(facts, first.out, "the turn's facts ride on it as they grow: its result itself (HarnessV3-ACP AC2-5)");
    assert.deepEqual([steer.at, typeof steer.send], ["live", "function"], "the person's words go into the running turn (HarnessV3-ACP AC3-1)");

    const second = await send(up, "again", { conversationId: "c-basic", history: echoed("hello") });
    assert.equal(second.out.text, "Echo: again");
    assert.deepEqual(steps(second.events), ["sent"], "Codex up and its thread loaded: nothing to wait on before the message");
    assert.equal(second.out.sessionId, first.out.sessionId);
    assert.equal(second.out.reused, true);
    assert.ok(second.out.notes.includes(`codex: thread ${first.out.sessionId.slice(0, 8)} reused (turn 2)`), second.out.notes.join("\n"));
    assert.equal(sent("cx-basic", "thread/start").length, 1, "no second thread");
    assert.deepEqual(
      [sent("cx-basic", "thread/resume").length, sent("cx-basic", "thread/inject_items").length],
      [0, 0],
      "a loaded thread has its history",
    );
    const st = bridge.status().conversations.find((c) => c.sessionId === first.out.sessionId);
    assert.deepEqual([st?.turns, st?.live, st?.title], [2, true, "hello"], "the chat named by its first message until Codex names it");
  });

  test("a restart: the chat's thread is resumed from the thread map", async () => {
    const up = fake("cx-restart");
    const a = await send(up, "one", { conversationId: "c-restart" });
    const file = join(dir, "codex-sessions.json");
    await until(() => existsSync(file) && readFileSync(file, "utf8").includes(a.out.sessionId), "the thread map to be saved");
    const again = new CodexBridge({ log: quiet, stateFile: file });
    try {
      const out = await again.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: body("two", echoed("one")), conversationId: "c-restart", onEvent: quiet });
      assert.equal(out.text, "Echo: two");
      assert.equal(out.sessionId, a.out.sessionId);
      assert.equal(out.reused, true);
      assert.ok(out.notes.includes(`codex: thread ${a.out.sessionId.slice(0, 8)} loaded again`), out.notes.join("\n"));
      const [resume] = sent("cx-restart", "thread/resume");
      assert.deepEqual(
        [resume.params.threadId, resume.params.excludeTurns, resume.params.approvalPolicy, resume.params.sandbox],
        [a.out.sessionId, true, "never", "danger-full-access"],
      );
      assert.equal(sent("cx-restart", "thread/start").length, 1, "no new thread");
      assert.equal(sent("cx-restart", "thread/inject_items").length, 0, "a resumed thread has its own history");
    } finally {
      again.shutdown();
    }
  });

  test("a thread Codex cannot resume is replaced by a new one, seeded with the chat so far as its history", async () => {
    const up = fake("cx-lost", {}, { FAKE_CODEX_RESUME_FAIL: "1" });
    const a = await send(up, "first", { conversationId: "c-lost" });
    assert.equal(bridge.killProcess("cx-lost|app-server"), true);
    // A new app-server has not loaded the chat's thread, and this one cannot resume it.
    const b = await send(up, "second", { conversationId: "c-lost", history: echoed("first") });
    assert.equal(b.out.text, "Echo: second");
    assert.notEqual(b.out.sessionId, a.out.sessionId);
    assert.deepEqual([b.out.reused, b.out.seeded], [false, true]);
    assert.ok(b.out.notes.some((/** @type {string} */ n) => /^codex: could not resume thread [0-9a-f]{8} \(no rollout found .*\); starting a new one$/.test(n)), b.out.notes.join("\n"));
    assert.ok(b.out.notes.includes("codex: seeded with the client's 2 earlier message(s) (no archived turns for this chat), as the thread's history"), b.out.notes.join("\n"));
    const [inject] = sent("cx-lost", "thread/inject_items");
    assert.equal(inject.params.threadId, b.out.sessionId);
    assert.deepEqual(inject.params.items, [
      { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Echo: first" }] },
    ]);
    assert.equal(sent("cx-lost", "turn/start").at(-1).params.input[0].text, "second", "the message itself goes alone");
  });

  test("turns another model answered since the thread's last are handed over as its history", async () => {
    const up = fake("cx-catch");
    await send(up, "u1", { conversationId: "c-catch" });
    const history = [...echoed("u1"), { role: "user", content: "u2" }, { role: "assistant", content: "from another model" }];
    const b = await send(up, "u3", { conversationId: "c-catch", history });
    assert.equal(b.out.reused, true);
    const inject = sent("cx-catch", "thread/inject_items");
    assert.equal(inject.length, 1);
    assert.deepEqual(inject[0].params.items, [
      { type: "message", role: "user", content: [{ type: "input_text", text: "u2" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "from another model" }] },
    ]);
    assert.ok(
      b.out.notes.includes("codex: 1 turn(s) handled elsewhere since this thread's last turn were handed over so Codex catches up, as the thread's history"),
      b.out.notes.join("\n"),
    );
    assert.equal(sent("cx-catch", "turn/start").at(-1).params.input[0].text, "u3");
  });

  // (fails before: yes — a message that only answers tool calls counted as a turn of the person's: after a turn with
  // tool calls, Codex was handed its own turn back as another model's)
  test("tool results in the history are no turn of the person's: nothing is handed over", async () => {
    const up = fake("cx-tools");
    await send(up, "u1", { conversationId: "c-tools" });
    const history = [
      { role: "user", content: "u1" },
      { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.js" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "hello" }] },
      { role: "assistant", content: "Echo: u1" },
    ];
    const b = await send(up, "u2", { conversationId: "c-tools", history });
    assert.equal(b.out.reused, true);
    assert.equal(sent("cx-tools", "thread/inject_items").length, 0, b.out.notes.join("\n"));
    assert.equal(sent("cx-tools", "turn/start").at(-1).params.input[0].text, "u2");
  });

  test("history Codex will not take as items goes in the prompt instead", async () => {
    const up = fake("cx-noinject", {}, { FAKE_CODEX_INJECT_FAIL: "1" });
    const b = await send(up, "now", { conversationId: "c-noinject", history: [{ role: "user", content: "before" }, { role: "assistant", content: "earlier answer" }] });
    assert.equal(
      sent("cx-noinject", "turn/start")[0].params.input[0].text,
      "Earlier conversation (from another assistant; continue it, do not repeat it):\n\n### User\nbefore\n\n### Assistant\nearlier answer\n\n---\nLatest user message:\n\nnow",
    );
    assert.ok(
      b.out.notes.includes("codex: seeded with the client's 2 earlier message(s) (no archived turns for this chat), in the prompt (Codex refused them as history: invalid items)"),
      b.out.notes.join("\n"),
    );
  });

  // (fails before: yes — Codex installed but stopping at its start (its state folder) was told to install Codex;
  // HarnessV3-ACP AC2's drive)
  test("Codex that stops at its start says why in its words; a program that can't be run is an install to do", async () => {
    await assert.rejects(send(fake("cx-start-fail", {}, { FAKE_CODEX_START_FAIL: "1" }), "hello", { conversationId: "c-start-fail" }), (/** @type {any} */ e) => {
      assert.equal(e.code, "CODEX_START");
      assert.match(e.message, /^Codex's app-server did not start: agent process exited \(code 1\): Error: failed to initialize sqlite state runtime/);
      assert.match(e.message, /Run `codex app-server` in a terminal to see its whole message\.$/);
      return true;
    });
    await assert.rejects(send(fake("cx-unrun", { command: join(dir, "no-such-codex.exe"), args: [] }), "hello", { conversationId: "c-unrun" }), (/** @type {any} */ e) => {
      assert.match(e.message, /^Codex could not be run \(.*\)\. Install it with `npm install -g @openai\/codex`, or set the upstream's command/);
      return true;
    });
  });

  test("signed out: the turn is refused in words, as an auth failure, and the test says how to sign in", async () => {
    const up = fake("cx-out", {}, { FAKE_CODEX_SIGNED_OUT: "1" });
    // Its own sign-in, as Filament runs Codex: here the fake under node.
    const login = commandLine([process.execPath, FAKE, "login"], {}, process.platform);
    await assert.rejects(send(up, "hello", { conversationId: "c-out" }), (/** @type {any} */ e) => {
      assert.equal(e.code, "CODEX_AUTH");
      assert.equal(e.message, `cx-out is not signed in. Sign in under Settings → Coding agents in Filament's harness, or run \`${login}\` in a terminal, then send your message again.`);
      assert.equal(classifyFailure(e).kind, "auth");
      return true;
    });
    assert.equal(sent("cx-out", "thread/start").length, 0, "no thread for a turn that cannot run");
    assert.equal(sent("cx-out", "account/rateLimits/read").length, 0, "no plan to read while signed out");
    const t = await bridge.test(up);
    assert.equal(t.ok, true, "Codex runs; it is the account that is missing");
    assert.equal(t.auth, `not signed in. Sign in under Settings → Coding agents in Filament's harness, or run \`${login}\` in a terminal`);
    assert.deepEqual(bridge.processInfo("cx-out")?.identity, { kind: "none", label: "Not signed in", plan: null, email: null, organization: null, detail: null, billing: null });
  });

  // (fails before: no — a guard the mutation pass asked for: nobody signed in while Filament ran, and no Codex ran on a
  // provider that needs no sign-in)
  test("signed in from a terminal while Filament runs, the next turn goes; on a provider that needs no sign-in, turns run", async () => {
    const flag = join(dir, "cx-later.signed-in");
    const up = fake("cx-later", {}, { FAKE_CODEX_SIGNED_OUT: flag });
    await assert.rejects(send(up, "hello", { conversationId: "c-later" }), (/** @type {any} */ e) => e.code === "CODEX_AUTH");
    writeFileSync(flag, "");
    const later = await send(up, "hello", { conversationId: "c-later" });
    assert.deepEqual([later.out.text, later.out.account?.email], ["Echo: hello", "dev@example.com"]);
    const free = fake("cx-provider", {}, { FAKE_CODEX_SIGNED_OUT: "provider" });
    const { out } = await send(free, "hello", { conversationId: "c-provider" });
    const { at, ...provider } = out.account;
    assert.deepEqual([out.text, provider], ["Echo: hello", { kind: "external", label: "Codex's configured provider", plan: null, email: null, organization: null, detail: "no sign-in needed", billing: null, windows: [] }], "the record says whose model ran: the provider's");
    const t = await bridge.test(free);
    assert.deepEqual([t.signedIn, t.auth], [true, "Codex's configured provider (no sign-in needed)"]);
  });

  test("approvals follow the permission policy, and its sandbox goes with the thread", async () => {
    /** @type {[string, string, string, string, string][]} */
    const cases = [
      ["allow-all", "~approve", "accept", "never", "danger-full-access"],
      ["allow-once", "~approve", "accept", "untrusted", "workspace-write"],
      ["read-only", "~approve", "decline", "untrusted", "read-only"],
      ["read-only", "~read-approve", "accept", "untrusted", "read-only"],
      ["reject", "~read-approve", "decline", "untrusted", "read-only"],
    ];
    for (const [policy, script, decision, approvalPolicy, sandbox] of cases) {
      const id = `cx-policy-${policy}`;
      const { out, events } = await send(fake(id, { permissions: policy }), script, { conversationId: `c-${policy}${script}` });
      assert.equal(out.text, `decision: ${decision}`, `${policy} answers ${script}`);
      const start = sent(id, "thread/start").at(-1);
      assert.deepEqual([start.params.approvalPolicy, start.params.sandbox], [approvalPolicy, sandbox], `${policy}'s thread`);
      const entry = bridge.permissionLog.filter((p) => p.upstream === id).at(-1);
      assert.deepEqual([entry.kind, entry.decision, entry.policy], ["execute", decision, policy]);
      if (decision === "decline") {
        const end = events.find((e) => e.type === "tool" && e.phase === "update" && e.status === "failed");
        assert.deepEqual([end?.notRun, end?.why], ["refused", `the ${policy} permission policy`]);
      }
    }
  });

  // (fails before: yes — the owner's word on AGT-3, 10-30: a word that is none of the policies, read as ask, let Codex
  // write in the project folder unasked and allowed its approval once where nobody could be asked)
  test("a permission policy that is none of the known words, in a config.json edited by hand: Codex is kept read-only, and with nobody to ask its approval is refused", async () => {
    const id = "cx-policy-typo";
    const { out, events } = await send(fake(id, { permissions: "readonly" }), "~approve", { conversationId: "c-typo" });
    assert.equal(out.text, "decision: decline");
    const start = sent(id, "thread/start").at(-1);
    assert.deepEqual([start.params.approvalPolicy, start.params.sandbox], ["untrusted", "read-only"], "nothing written unasked");
    const entry = bridge.permissionLog.filter((p) => p.upstream === id).at(-1);
    assert.deepEqual([entry.decision, entry.policy], ["decline", '"readonly", none of the policies: nobody to ask, refused']);
    const end = events.find((e) => e.type === "tool" && e.phase === "update" && e.status === "failed");
    assert.deepEqual([end?.notRun, end?.why], ["refused", 'the permission policy "readonly", which is none of the policies and asks first, with nobody to ask']);
  });

  test("a file change's approval names its files", async () => {
    const { out, events } = await send(fake("cx-patch", { permissions: "allow-once" }), "~patch-approve", { conversationId: "c-patch" });
    assert.equal(out.text, "decision: accept");
    const entry = bridge.permissionLog.filter((p) => p.upstream === "cx-patch").at(-1);
    assert.deepEqual([entry.kind, entry.title], ["edit", "a.txt"]);
    assert.equal(events.find((e) => e.type === "tool" && e.phase === "call")?.title, "Write a.txt");
    assert.equal(out.linesAdded, 2);
  });

  test("more access: granted as Codex asked when the policy allows it, nothing when it refuses", async () => {
    const yes = await send(fake("cx-access-yes"), "~more-access", { conversationId: "c-access-yes" });
    assert.equal(yes.out.text, 'granted: {"network":{"enabled":true},"fileSystem":null}');
    assert.equal(bridge.permissionLog.filter((p) => p.upstream === "cx-access-yes").at(-1)?.title, "reach the network");
    const no = await send(fake("cx-access-no", { permissions: "reject" }), "~more-access", { conversationId: "c-access-no" });
    assert.equal(no.out.text, "granted: {}");
  });

  test("ask, and the client has a question tool: the person decides", async () => {
    const up = fake("cx-ask", { permissions: "ask" });
    const tools = [{ name: "AskUserQuestion", description: "Ask the user", input_schema: { type: "object", properties: { questions: { type: "array" } } } }];
    /** @type {any[]} */
    const events = [];
    const first = await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: body("~approve", [], { tools }), conversationId: "c-ask", onEvent: (/** @type {any} */ ev) => events.push(ev) });
    assert.ok(first.clientAction, "the question goes to the client");
    assert.equal(first.clientAction.name, "AskUserQuestion");
    assert.equal(first.clientAction.input.questions[0].question, "cx-ask wants to run `rm -rf build`. Allow it?");
    bridge.detach(first.turn);
    const { res } = await bridge.resume({ turn: first.turn, results: [{ id: first.clientAction.id, text: "Reject" }], onEvent: (/** @type {any} */ ev) => events.push(ev) });
    assert.equal(res.text, "decision: decline");
    assert.equal(bridge.permissionLog.filter((p) => p.upstream === "cx-ask").at(-1)?.policy, "asked the user");
  });

  test("ask, and no question tool: allowed once, and the turn says the person could not be asked", async () => {
    const { out, events } = await send(fake("cx-ask-none", { permissions: "ask" }), "~approve", { conversationId: "c-ask-none" });
    assert.equal(out.text, "decision: accept");
    const note = events.find((e) => e.type === "note");
    assert.deepEqual(note?.note, { kind: "permissions-unanswerable" });
  });

  /**
   * The page of a harness turn: each question answered at once by `answer`, and kept.
   * @param {(form: any) => any} answer
   */
  const page = (answer) => {
    /** @type {{ form: any, id: string, signal: AbortSignal | null }[]} */
    const asked = [];
    /** @type {import("../src/adapters/agents/turn-bridge.js").Asker} */
    const asker = async (form, id, signal) => {
      asked.push({ form, id, signal });
      return answer(form);
    };
    return { asked, asker };
  };
  /** The run's question events, each without its form. @param {any[]} events */
  const asks = (events) => events.filter((e) => e.type === "ask" || e.type === "ask-end").map(({ form, ...e }) => e);

  /**
   * The session's switch at `mode`, as a harness turn judges with it: the session's rules, no learned permissions.
   * @param {string} mode @param {any[]} [rules]
   */
  const switchAt = (mode, rules = []) => createAgentPermits({ rules, modeNow: () => /** @type {any} */ (mode), learned: null });
  /** A call's end, as the reader says it. @param {any[]} events @param {string} id */
  const endOf = (events, id) => events.find((e) => e.type === "tool" && e.phase === "update" && e.id === id);
  /** What the turn's record says of Codex's requests. @param {any[]} events @returns {string[]} */
  const judged = (events) => events.filter((e) => e.type === "note" && String(e.text).startsWith("permission: ")).map((e) => e.text);

  test("in a harness turn the session's switch answers Codex, once: Auto accepts, Read-only declines all but reads; the sandbox is the switch's", async () => {
    const up = fake("cx-switch");
    const auto = await send(up, "~approve", { conversationId: "c-switch", permits: switchAt("auto") });
    assert.equal(auto.out.text, "decision: accept", "once, never for the session");
    const start = sent("cx-switch", "thread/start").at(-1);
    assert.deepEqual([start.params.approvalPolicy, start.params.sandbox], ["untrusted", "danger-full-access"], "Codex asks before what it doesn't know is safe");
    assert.deepEqual(judged(auto.events), ["permission: cx-switch asked to run `rm -rf build` — ran (auto mode)"]);
    assert.equal(bridge.permissionLog.filter((p) => p.upstream === "cx-switch").at(-1)?.policy, "the session's switch (auto): run");
    const ro = await send(up, "~approve", { conversationId: "c-switch", permits: switchAt("read-only") });
    assert.equal(ro.out.text, "decision: decline");
    const turnStart = sent("cx-switch", "turn/start").at(-1);
    assert.deepEqual([turnStart.params.approvalPolicy, turnStart.params.sandboxPolicy], ["untrusted", { type: "readOnly", networkAccess: false }], "the switch moved: the next turn says so");
    const end = endOf(ro.events, "cmd_rm");
    assert.deepEqual([end?.status, end?.notRun, end?.why], ["failed", "refused", "this session's read-only mode"]);
    const reads = await send(up, "~read-approve", { conversationId: "c-switch", permits: switchAt("read-only") });
    assert.equal(reads.out.text, "decision: accept", "a command that only reads runs");
    // (fails before: no — a guard the mutation pass asked for: no command asked for the network)
    const net = await send(up, "~net-approve", { conversationId: "c-switch", permits: switchAt("read-only") });
    assert.equal(net.out.text, "decision: accept", "the network it wants is a fetch of its host, which only reads");
    assert.equal(bridge.permissionLog.filter((p) => p.upstream === "cx-switch").at(-1)?.policy, "the session's switch (read-only): run");
  });

  test("under Ask, Codex's approval draws the loop's card: Allow accepts once, Deny declines; unanswered, Codex is told to cancel", async () => {
    const yes = page(() => ({ outcome: "answered", answers: { permission: { chosen: ["allow"] } } }));
    const a = await send(fake("cx-judged"), "~approve", { conversationId: "c-judged", asker: yes.asker, permits: switchAt("ask") });
    assert.equal(a.out.text, "decision: accept");
    const [{ form, id }] = yes.asked;
    assert.deepEqual([id, form.kind, form.call, form.judged.tool, form.judged.command], ["q1", "permission", "cmd_rm", "bash", "rm -rf build"]);
    assert.match(form.title, /^May I run this command\? `rm -rf build`/);
    assert.deepEqual(asks(a.events), [
      { type: "ask", id: "q1", waits: true },
      { type: "ask-end", id: "q1", outcome: "answered", words: ["Allow"] },
    ]);
    const no = page(() => ({ outcome: "answered", answers: { permission: { chosen: ["deny"] } } }));
    const b = await send(fake("cx-judged-no"), "~approve", { conversationId: "c-judged-no", asker: no.asker, permits: switchAt("ask") });
    assert.equal(b.out.text, "decision: decline");
    assert.equal(endOf(b.events, "cmd_rm")?.notRun, "declined");
    const gone = page(() => null);
    const c = await send(fake("cx-judged-gone"), "~approve", { conversationId: "c-judged-gone", asker: gone.asker, permits: switchAt("ask") });
    assert.equal(c.out.text, "decision: cancel");
    assert.equal(endOf(c.events, "cmd_rm")?.notRun, "stopped");
    assert.deepEqual(asks(c.events).at(-1), { type: "ask-end", id: "q1", outcome: "cancelled", words: ["Cancelled"] });
  });

  // (fails before: yes — HarnessV4_Tasks C10: Codex words every command on Windows as PowerShell and `-Command`
  // before the script, and that whole line was judged as one bash command: none was read as only reading, so each
  // asked, and the card showed the wrapper)
  test("a command Codex wraps in PowerShell is judged as its script: one that only reads runs without asking, another asks by the script", async () => {
    const outside = mkdtempSync(join(tmpdir(), "filament-codex-ps-"));
    try {
      const program = join(outside, "powershell.exe");
      writeFileSync(program, "");
      const env = { FAKE_CODEX_POWERSHELL: program };
      const nobody = page(() => assert.fail("a script that only reads asks nobody"));
      const reads = await send(fake("cx-ps-read", {}, env), "~ps-read-approve", { conversationId: "c-ps-read", asker: nobody.asker, permits: switchAt("ask") });
      assert.equal(reads.out.text, "decision: accept");
      assert.match(judged(reads.events).at(-1) || "", /^permission: cx-ps-read asked to run `.*powershell\.exe"? -Command 'Get-Content a\.txt \| Select-Object -First 2'` — ran without asking: it only reads$/);
      const ro = await send(fake("cx-ps-ro", {}, env), "~ps-read-approve", { conversationId: "c-ps-ro", permits: switchAt("read-only") });
      assert.equal(ro.out.text, "decision: accept", "read-only runs what only reads");
      // (fails before: yes — found by E15's live drive: a read-only agent on Codex searched with `rg`, was refused, read
      // "rejected by user" and gave up; Codex carries no reason back, so the thread is told ahead which commands run)
      const told = (/** @type {string} */ id) => String(sent(id, "thread/start")[0].params.developerInstructions || "");
      assert.equal(told("cx-ps-ro").includes(READS_ON_WINDOWS), process.platform === "win32", "a thread that only reads, on Windows, is told which commands run");
      assert.ok(!told("cx-ps-read").includes(READS_ON_WINDOWS), "a session that asks is told nothing of it: its person answers");
      const yes = page(() => ({ outcome: "answered", answers: { permission: { chosen: ["allow"] } } }));
      const a = await send(fake("cx-ps-ask", {}, env), "~ps-approve", { conversationId: "c-ps-ask", asker: yes.asker, permits: switchAt("ask") });
      assert.equal(a.out.text, "decision: accept");
      const [{ form }] = yes.asked;
      assert.deepEqual([form.call, form.judged.tool, form.judged.command], ["cmd_ps", "powershell", "Remove-Item -Recurse build"], "the card shows the script, not its wrapper");
      assert.match(form.title, /^May I run this PowerShell script\? `Remove-Item -Recurse build`/);
      assert.match(String(form.judged.reason), /Filament cannot tell that it only reads inside the working folder: `Remove-Item` is not one of the PowerShell commands known to only read/);
      const refused = await send(fake("cx-ps-refuse", {}, env), "~ps-approve", { conversationId: "c-ps-refuse", permits: switchAt("read-only") });
      assert.equal(refused.out.text, "decision: decline");
      // A rule of the session speaks for the script: before, its pattern met the wrapper's line.
      const ruled = await send(fake("cx-ps-rule", {}, env), "~ps-approve", { conversationId: "c-ps-rule", permits: switchAt("auto", [{ tool: "bash", pattern: "Remove-Item *", verdict: "deny" }]) });
      assert.equal(ruled.out.text, "decision: decline");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a change is judged by its files, more access as Codex's own tool, and a sub-agent's approval on the turn that spawned it", async () => {
    const p = page(() => ({ outcome: "answered", answers: { permission: { chosen: ["allow"] } } }));
    const patch = await send(fake("cx-judged-patch"), "~patch-approve", { conversationId: "c-judged-patch", asker: p.asker, permits: switchAt("ask") });
    assert.equal(patch.out.text, "decision: accept");
    assert.deepEqual([p.asked[0].form.judged.tool, p.asked[0].form.call], ["write", "patch_ask"], "a new file is written");
    const [made] = p.asked[0].form.judged.changes;
    assert.deepEqual([made.file.endsWith("a.txt"), made.created, made.added, made.patch.split("\n").slice(2)], [true, true, 2, ["@@ -0,0 +1,2 @@", "+one", "+two", ""]], "its card shows the file it writes (AC3's drive D5)");
    const edit = await send(fake("cx-judged-edit"), "~patch-approve", { conversationId: "c-judged-edit", permits: switchAt("edit") });
    assert.equal(edit.out.text, "decision: accept", "Edit makes a change without asking");
    const access = await send(fake("cx-judged-access"), "~more-access", { conversationId: "c-judged-access", permits: switchAt("auto") });
    assert.equal(access.out.text, 'granted: {"network":{"enabled":true},"fileSystem":null}', "for the turn, never for the session");
    const refused = await send(fake("cx-judged-access-ro"), "~more-access", { conversationId: "c-judged-access-ro", permits: switchAt("read-only") });
    assert.equal(refused.out.text, "granted: {}");
    const child = page(() => ({ outcome: "answered", answers: { permission: { chosen: ["allow"] } } }));
    const sub = await send(fake("cx-judged-child"), "~subagent-approve", { conversationId: "c-judged-child", asker: child.asker, permits: switchAt("ask") });
    assert.equal(sub.out.text, `the sub-agent's decision: "accept"`);
    assert.deepEqual([child.asked[0]?.form.call, child.asked[0]?.form.judged.command], ["c_rm", "rm -rf build"]);
  });

  test("plan mode reads only whatever the switch says; a rule of the session's comes before its mode", async () => {
    const plan = await send(fake("cx-judged-plan"), "~approve", { conversationId: "c-judged-plan", permits: switchAt("auto"), mode: "plan" });
    assert.equal(plan.out.text, "decision: decline");
    assert.deepEqual([endOf(plan.events, "cmd_rm")?.notRun, endOf(plan.events, "cmd_rm")?.why], ["refused", "plan mode"]);
    // (fails before: no — a guard the mutation pass asked for: nothing checked plan mode's sandbox under the switch)
    const start = sent("cx-judged-plan", "thread/start").at(-1);
    assert.deepEqual([start.params.approvalPolicy, start.params.sandbox], ["untrusted", "read-only"], "plan mode's sandbox, never the switch's");
    assert.ok(!plan.out.notes.some((/** @type {string} */ n) => n.startsWith("codex: the session's switch")), plan.out.notes.join("\n"));
    const ruled = await send(fake("cx-judged-rule"), "~approve", { conversationId: "c-judged-rule", permits: switchAt("auto", [{ tool: "bash", pattern: "rm *", verdict: "deny" }]) });
    assert.equal(ruled.out.text, "decision: decline");
    assert.equal(endOf(ruled.events, "cmd_rm")?.why, "the rule bash(rm *) deny");
  });

  // (fails before: yes — Codex's question before an MCP server's tool runs read as a form that asks nothing, declined
  // unseen: no tool of the person's own MCP servers ran through Filament)
  test("Codex's question before an MCP server's tool runs is an approval: the policy or the session's switch answers it, the tool judged as itself, a yes once", async () => {
    const all = await send(fake("cx-mcp"), "~mcp-approve", { conversationId: "c-mcp" });
    assert.equal(all.out.text, 'mcp: {"action":"accept","content":null}');
    const entry = bridge.permissionLog.filter((p) => p.upstream === "cx-mcp").at(-1);
    assert.deepEqual([entry.kind, entry.title, entry.decision, entry.policy], ["other", "run search_docs from the docs MCP server", "accept", "allow-all"]);
    const ro = await send(fake("cx-mcp-ro", { permissions: "read-only" }), "~mcp-approve", { conversationId: "c-mcp-ro" });
    assert.equal(ro.out.text, 'mcp: {"action":"decline","content":null}');
    const p = page(() => ({ outcome: "answered", answers: { permission: { chosen: ["allow"] } } }));
    const asked = await send(fake("cx-mcp-ask"), "~mcp-approve", { conversationId: "c-mcp-ask", asker: p.asker, permits: switchAt("ask") });
    assert.equal(asked.out.text, 'mcp: {"action":"accept","content":null}');
    assert.deepEqual([p.asked.length, p.asked[0].form.kind, p.asked[0].form.judged.tool], [1, "permission", "mcp__docs__search_docs"]);
    assert.deepEqual(judged(asked.events)[0], "permission: cx-mcp-ask asked to run search_docs from the docs MCP server — asked (ask mode)");
    const refused = await send(fake("cx-mcp-switch-ro"), "~mcp-approve", { conversationId: "c-mcp-switch-ro", permits: switchAt("read-only") });
    assert.equal(refused.out.text, 'mcp: {"action":"decline","content":null}', "an MCP tool no server vouches for as read-only");
    const ruled = await send(fake("cx-mcp-rule"), "~mcp-approve", { conversationId: "c-mcp-rule", permits: switchAt("ask", [{ tool: "mcp__docs__search_docs", pattern: "*", verdict: "allow" }]) });
    assert.equal(ruled.out.text, 'mcp: {"action":"accept","content":null}', "the session's rule for the tool, by its name");
    const denied = await send(fake("cx-mcp-deny"), "~mcp-approve", { conversationId: "c-mcp-deny", permits: switchAt("auto", [{ tool: "mcp__docs__search_docs", pattern: "*tabs*", verdict: "deny" }]) });
    assert.equal(denied.out.text, 'mcp: {"action":"decline","content":null}', "and by its arguments");
    assert.ok(![all, ro, asked, refused, ruled, denied].some((r) => r.events.some((e) => e.type === "note" && e.note?.kind === "question-unasked")), "never a form Filament can't show");
  });

  test("a question Codex asks, with nobody to ask it, is skipped at once, and the record says why", async () => {
    const { out, events } = await send(fake("cx-question"), "~ask", { conversationId: "c-question" });
    assert.equal(out.text, "answers: {}");
    assert.deepEqual(events.find((e) => e.type === "note")?.note, { kind: "question-unasked", asked: "Which file?", why: "this chat tool declares no question tool", heard: "Skipped" });
    assert.deepEqual(asks(events), [
      { type: "ask", id: "q1", waits: false },
      { type: "ask-end", id: "q1", outcome: "skipped", words: ["Skipped"], nobody: true },
    ]);
  });

  // (fails before: no — a guard the mutation pass asked for: no app-server died with a question waiting)
  test("an app-server that dies while its question waits withdraws the question from the page", async () => {
    const p = page(() => new Promise(() => {}));
    await assert.rejects(send(fake("cx-ask-crash"), "~ask-crash", { conversationId: "c-ask-crash", asker: p.asker }));
    assert.equal(p.asked[0]?.signal?.aborted, true);
  });

  test("a question Codex asks goes to the page, answered by its question's id", async () => {
    const p = page(() => ({ outcome: "answered", answers: { q1: { chosen: ["b.txt"] } } }));
    const { out } = await send(fake("cx-question-page"), "~ask", { conversationId: "c-question-page", asker: p.asker });
    assert.equal(out.text, 'answers: {"q1":{"answers":["b.txt"]}}');
    const [{ form }] = p.asked;
    assert.equal(form.call, "ask_1");
    assert.deepEqual(
      form.questions.map((/** @type {any} */ q) => [q.id, q.header, q.prompt, q.choices.map((/** @type {any} */ c) => c.id)]),
      [["q1", "Pick", "Which file?", ["a.txt", "b.txt"]]],
    );
  });

  test("without a page, a question Codex asks goes to the client's question tool, and its answer is read back", async () => {
    const up = fake("cx-question-client");
    const tools = [{ name: "AskUserQuestion", description: "Ask the user", input_schema: { type: "object", properties: { questions: { type: "array" } } } }];
    /** @type {any[]} */
    const events = [];
    const onEvent = (/** @type {any} */ ev) => events.push(ev);
    const first = await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: body("~ask", [], { tools }), conversationId: "c-question-client", onEvent });
    assert.equal(first.clientAction?.name, "AskUserQuestion");
    assert.deepEqual(first.clientAction.input, {
      questions: [{ question: "Which file?", header: "Pick", options: [{ label: "a.txt", description: "" }, { label: "b.txt", description: "" }], multiSelect: false }],
    });
    bridge.detach(first.turn);
    const { res } = await bridge.resume({ turn: first.turn, results: [{ id: first.clientAction.id, text: 'User has answered your questions: "Which file?"="b.txt".' }], onEvent });
    assert.equal(res.text, 'answers: {"q1":{"answers":["b.txt"]}}');
    assert.deepEqual(asks(events).at(-1), { type: "ask-end", id: "q1", outcome: "answered", words: ["Pick: b.txt"] });
  });

  test("Codex withdraws a question it no longer waits on: the page's wait ends, cancelled", async () => {
    /** @type {AbortSignal | null} */
    let seen = null;
    /** @type {import("../src/adapters/agents/turn-bridge.js").Asker} */
    const asker = (_form, _id, signal) =>
      new Promise((resolve) => {
        seen = signal;
        signal?.addEventListener("abort", () => resolve(null), { once: true });
      });
    const { out, events } = await send(fake("cx-withdrawn"), "~ask-withdrawn", { conversationId: "c-withdrawn", asker });
    assert.equal(out.text, "Went on without it.");
    assert.equal(/** @type {AbortSignal | null} */ (seen)?.aborted, true);
    assert.deepEqual(asks(events).at(-1), { type: "ask-end", id: "q1", outcome: "cancelled", words: ["Cancelled"] });
  });

  test("an MCP server's form Codex relays goes to the page, the server beside it; with nobody to ask, it is declined", async () => {
    const p = page(() => ({ outcome: "answered", answers: { space: { chosen: ["ops"] } } }));
    const a = await send(fake("cx-elicit"), "~elicit", { conversationId: "c-elicit", asker: p.asker });
    assert.equal(a.out.text, 'elicit: {"action":"accept","content":{"space":"ops"}}');
    assert.deepEqual([p.asked[0].form.title, p.asked[0].form.detail], ["Which space?", "asked by its MCP server “docs”"]);
    const b = await send(fake("cx-elicit-none"), "~elicit", { conversationId: "c-elicit-none" });
    assert.equal(b.out.text, 'elicit: {"action":"decline","content":null}');
    assert.equal(b.events.find((e) => e.type === "note")?.note?.kind, "question-unasked");
  });

  // (fails before: no — a guard the mutation pass asked for: no question or form Codex relayed was one the card can't
  // show)
  test("a question that asks nothing, or a form the card can't show, never reaches the page: the turn says so", async () => {
    const p = page(() => ({ outcome: "answered", answers: {} }));
    const a = await send(fake("cx-ask-nothing"), "~ask-nothing", { conversationId: "c-ask-nothing", asker: p.asker });
    assert.equal(a.out.text, "answers: {}");
    assert.deepEqual(a.events.find((e) => e.type === "note")?.note, { kind: "question-unasked", asked: "a question", why: "Filament can't show it: it asks nothing", heard: "Skipped" });
    const b = await send(fake("cx-elicit-odd"), "~elicit-odd", { conversationId: "c-elicit-odd", asker: p.asker });
    assert.equal(b.out.text, 'elicit: {"action":"decline","content":null}');
    assert.equal(b.events.find((e) => e.type === "note")?.note?.why, "Filament can't show it: its form asks nothing");
    assert.equal(p.asked.length, 0);
  });

  test("a turn's thoughts, calls, change, plan and words reach the client as a Claude turn's do", async () => {
    const { out, events } = await send(fake("cx-work"), "~work", { conversationId: "c-work" });
    assert.equal(out.text, "Added a line to notes.txt.");
    assert.deepEqual(events.filter((e) => e.type === "thought").map((e) => e.text), ["Reading the file"]);
    assert.deepEqual(
      events.filter((e) => e.type === "tool" && e.phase === "call").map((e) => [e.id, e.toolName, e.title]),
      [
        ["cmd_read", "read", "Read notes.txt"],
        ["cmd_run", "bash", "npm test"],
        ["patch_1#0", "edit", "Edit notes.txt"],
      ],
    );
    assert.deepEqual(
      events.filter((e) => e.terminalOutput).map((e) => e.terminalOutput.output),
      ["ok 1\n", "ok 2\n"],
      "a command's output as it comes",
    );
    assert.deepEqual(out.tools.map((/** @type {any} */ t) => [t.id, t.status]), [["cmd_read", "completed"], ["cmd_run", "completed"], ["patch_1#0", "completed"]]);
    assert.deepEqual(events.find((e) => e.type === "plan")?.entries, [
      { content: "Read notes", status: "completed", priority: "medium" },
      { content: "Add a line", status: "in_progress", priority: "medium" },
    ]);
    assert.deepEqual([out.linesAdded, out.linesRemoved], [1, 0]);
    assert.deepEqual(out.usage, { input: 2700 - 2200, output: 70, cacheRead: 2200, cacheWrite: 0, total: 2770, cacheSeen: true });
  });

  test("a turn that fails carries Codex's kind of failure", async () => {
    await assert.rejects(send(fake("cx-fail"), "~fail", { conversationId: "c-fail" }), (/** @type {any} */ e) => {
      assert.equal(e.code, "CODEX_TURN");
      assert.equal(e.message, "You've hit your usage limit.");
      assert.equal(e.data.errorKind, "usageLimitExceeded");
      assert.equal(classifyFailure(e).kind, "limit");
      return true;
    });
  });

  test("a stop interrupts Codex's turn: it ends cancelled, with what it said", async () => {
    const ac = new AbortController();
    const { out } = await send(fake("cx-stop"), "~slow", {
      conversationId: "c-stop",
      signal: ac.signal,
      onEvent: (/** @type {any} */ ev) => ev.type === "text" && ac.abort(),
    });
    assert.equal(out.stopReason, "cancelled");
    assert.ok(out.text.length > 0, "what it said before the stop stays");
    const [interrupt] = sent("cx-stop", "turn/interrupt");
    assert.equal(interrupt?.params.threadId, out.sessionId);
    assert.match(String(interrupt?.params.turnId), /^turn_/);
  });

  // (fails before: no — a guard the mutation pass asked for: no stop came before the message went out, or while the
  // turn was being started)
  test("a stop before the message goes out sends none; a stop while the turn starts interrupts it once it has an id", async () => {
    const early = new AbortController();
    early.abort();
    const a = await send(fake("cx-stop-early"), "hello", { conversationId: "c-stop-early", signal: early.signal });
    assert.deepEqual([a.out.stopReason, sent("cx-stop-early", "turn/start").length], ["cancelled", 0]);
    // A stop as the turn's start is told, while its reader may still note where the folder stands: no message goes.
    const opening = new AbortController();
    const o = await send(fake("cx-stop-opening"), "~slow", {
      conversationId: "c-stop-opening",
      signal: opening.signal,
      onEvent: (/** @type {any} */ ev) => ev.type === "session" && opening.abort(),
    });
    assert.deepEqual([o.out.stopReason, sent("cx-stop-opening", "turn/start").length], ["cancelled", 0]);
    // A stop once the message is on its way, before Codex names the turn.
    const mid = new AbortController();
    const b = await send(fake("cx-stop-mid"), "~slow", {
      conversationId: "c-stop-mid",
      signal: mid.signal,
      onEvent: (/** @type {any} */ ev) => ev.type === "session" && setImmediate(() => mid.abort()),
    });
    assert.deepEqual([b.out.stopReason, sent("cx-stop-mid", "turn/start").length, sent("cx-stop-mid", "turn/interrupt").length], ["cancelled", 1, 1]);
  });

  // (fails before: yes — a turn waited for Codex's handshake with no way to stop it: the stop came, and the turn went
  // on waiting for an app-server that had not answered — HarnessV3-FailurePoints §4 B)
  test("a stop while Codex starts ends the turn there, cancelled; the start goes on, and the next turn runs on that app-server", async () => {
    const gate = join(dir, "cx-init-gate");
    const up = fake("cx-held-start", {}, { FAKE_CODEX_INIT_GATE: gate });
    const stop = new AbortController();
    const running = send(up, "hello", { conversationId: "c-held-start", signal: stop.signal });
    await until(() => sent("cx-held-start", "initialize").length === 1, "the handshake to be asked");
    stop.abort();
    const { out } = await running;
    assert.equal(out.stopReason, "cancelled");
    assert.ok(out.notes.includes("codex: stopped while waiting for Codex's answer to its handshake"), out.notes.join("\n"));
    const server = bridge.procs.get("cx-held-start");
    assert.equal(server?.exited, false, "its start goes on");
    writeFileSync(gate, "");
    const next = await send(up, "hello", { conversationId: "c-held-start" });
    assert.equal(next.out.text, "Echo: hello");
    assert.equal(bridge.procs.get("cx-held-start"), server, "the same app-server");
  });

  // (fails before: yes — the stop waited for thread/start's answer, a minute here: the thread was opened with a clock
  // of two minutes and none the turn's stop could end)
  test("a stop while Codex's thread opens ends the turn at once, cancelled", async () => {
    const stop = new AbortController();
    const running = send(fake("cx-slow-open", {}, { FAKE_CODEX_SLOW_START_MS: "60000" }), "hello", { conversationId: "c-slow-open", signal: stop.signal });
    await until(() => sent("cx-slow-open", "thread/start").length === 1, "the thread to be asked for");
    const t0 = performance.now();
    stop.abort();
    const { out } = await running;
    assert.ok(performance.now() - t0 < 10_000, "at once, not when Codex answered");
    assert.equal(out.stopReason, "cancelled");
    assert.ok(out.notes.includes("codex: stopped while waiting for Codex's answer to thread/start"), out.notes.join("\n"));
  });

  // (fails before: no — a guard the mutation pass asked for: no failed turn's end left its error out, no turn's facts
  // were read from a turn that broke before its end, and no app-server that exited was looked for again)
  test("a failed turn: Codex's error from its notification when its end says none; its facts from its start", async () => {
    await assert.rejects(send(fake("cx-fail-unsaid"), "~fail-unsaid", { conversationId: "c-fail-unsaid" }), (/** @type {any} */ e) => {
      assert.deepEqual([e.message, e.data.errorKind], ["You've hit your usage limit.", "usageLimitExceeded"]);
      return true;
    });
    /** @type {any[]} */
    const events = [];
    const run = bridge.run({ upstream: fake("cx-broke"), modelId: "gpt-6-astra", format: "anthropic", body: body("~crash"), conversationId: "c-broke", onEvent: (/** @type {any} */ ev) => events.push(ev) });
    await assert.rejects(run);
    const facts = events.find((e) => e.type === "session")?.facts;
    assert.deepEqual([facts?.account?.email, facts?.agentModel], ["dev@example.com", "gpt-6-astra"]);
    await until(() => !bridge.status().processes.some((/** @type {any} */ p) => p.key === "cx-broke|app-server"), "the exited app-server unlisted");
  });

  // (fails before: yes — a turn quiet for its `timeoutMs` was cancelled: "no activity from the agent for 1 s, so Filament
  // cancelled the turn"; the 1 s stays here as that condition, and nothing reads it now — HarnessV3-FailurePoints §4 B)
  test("Codex quiet for long: no clock cancels the turn; its stop does", async () => {
    const stop = new AbortController();
    let settled = false;
    const run = send(fake("cx-quiet"), "~slow", { conversationId: "c-quiet", timeoutMs: 1000, signal: stop.signal }).finally(() => (settled = true));
    await until(() => sent("cx-quiet", "turn/start").length === 1, "the turn to start");
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(settled, false, "quiet 2.5 s, the turn runs on");
    assert.equal(sent("cx-quiet", "turn/interrupt").length, 0, "nobody asked Codex to stop it");
    stop.abort();
    const { out } = await run;
    assert.equal(out.stopReason, "cancelled");
  });

  test("the app-server dies mid-turn: the turn fails with its exit; the next starts Codex again and resumes the thread", async () => {
    const up = fake("cx-crash");
    const a = await send(up, "hello", { conversationId: "c-crash" });
    await assert.rejects(send(up, "~crash", { conversationId: "c-crash", history: echoed("hello") }), /agent process exited \(code 3\)/);
    const b = await send(up, "again", { conversationId: "c-crash", history: [...echoed("hello"), { role: "user", content: "~crash" }, { role: "assistant", content: "Starting…" }] });
    assert.equal(b.out.text, "Echo: again");
    assert.equal(b.out.sessionId, a.out.sessionId);
    assert.equal(sent("cx-crash", "thread/resume").at(-1)?.params.threadId, a.out.sessionId);
  });

  test("a sub-agent's work reaches its own card, and the turn's usage counts its thread too", async () => {
    const { out, events } = await send(fake("cx-sub"), "~subagent", { conversationId: "c-sub" });
    assert.deepEqual(events.find((e) => e.type === "subagent" && e.state === "spawned"), {
      type: "subagent",
      state: "spawned",
      id: "spawn_1",
      name: "gpt-5.6-terra",
      description: "count the files",
    });
    const own = events.filter((e) => e.subagent === "spawn_1");
    assert.deepEqual(own.filter((e) => e.type === "thought").map((e) => e.text), ["Counting"]);
    assert.equal(own.find((e) => e.type === "tool" && e.phase === "call")?.title, "List .");
    assert.equal(own.filter((e) => e.type === "text").map((e) => e.text).join(""), "There are 2 files.");
    assert.ok(events.some((e) => e.type === "subagent" && e.state === "completed" && e.id === "spawn_1"));
    assert.ok(events.some((e) => e.type === "tool" && e.phase === "call" && e.title === "Wait for agents" && !e.subagent));
    assert.equal(out.text, "The sub-agent counted 2 files.");
    assert.deepEqual(out.usage, { input: 1100, output: 45, cacheRead: 0, cacheWrite: 0, total: 1145, cacheSeen: true });
    assert.deepEqual(out.context, { used: 825, size: 400000, cacheRead: 0 }, "the context is the turn's own thread's");
    assert.ok(!out.notes.some((/** @type {string} */ n) => /never matched/.test(n)), out.notes.join("\n"));
  });

  test("two chats on one app-server: a chat's own thread is never taken by the other's sub-agent wait", async () => {
    const up = fake("cx-two", {}, { FAKE_CODEX_SPAWN_MS: "1500" });
    /** @type {() => void} */
    let spawned = () => {};
    const seen = new Promise((/** @type {(v?: any) => void} */ r) => (spawned = r));
    const a = bridge.run({
      upstream: up,
      modelId: "gpt-6-astra",
      format: "anthropic",
      body: body("~subagent-slow"),
      conversationId: "c-two-a",
      onEvent: (/** @type {any} */ ev) => ev.type === "subagent" && ev.state === "spawned" && spawned(),
    });
    a.catch(() => {});
    await seen;
    // Chat A waits for its sub-agent's thread; chat B starts a thread of its own meanwhile.
    const b = await Promise.race([
      send(up, "while it waits", { conversationId: "c-two-b" }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("chat B's turn never ended: its thread went to chat A's turn")), 5000).unref()),
    ]);
    assert.equal(/** @type {any} */ (b).out.text, "Echo: while it waits");
    const aOut = await a;
    assert.equal(aOut.text, "The sub-agent counted 2 files.");
    assert.ok(!aOut.notes.some((/** @type {string} */ n) => /never matched/.test(n)), "chat A took nothing of chat B's");
  });

  test("the model: a name with its effort, Codex's default, and a name Codex does not offer", async () => {
    const up = fake("cx-models");
    await send(up, "a", { conversationId: "c-m1", modelId: "gpt-6-astra-high" });
    const auto = await send(up, "b", { conversationId: "c-m2", modelId: "auto" });
    const odd = await send(up, "c", { conversationId: "c-m3", modelId: "gpt-9" });
    const starts = sent("cx-models", "turn/start");
    assert.deepEqual([starts[0].params.model, starts[0].params.effort], ["gpt-6-astra", "high"]);
    assert.ok(!("model" in starts[1].params) && !("effort" in starts[1].params), "auto leaves the model to Codex");
    assert.ok(auto.out.notes.includes("codex: model gpt-6-astra, Codex's default"), auto.out.notes.join("\n"));
    assert.ok(!("model" in starts[2].params));
    assert.deepEqual(odd.out.structured.find((/** @type {any} */ s) => s.note.kind === "model-not-offered")?.note, {
      kind: "model-not-offered",
      model: "gpt-9",
      offers: ["gpt-6-astra", "gpt-5.6-terra"],
      keeping: "gpt-6-astra",
    });
  });

  test("plan mode reads only; a policy changed since the thread opened goes with the turn", async () => {
    const up = fake("cx-plan");
    const a = await send(up, "look around", { conversationId: "c-plan", mode: "plan" });
    assert.ok(a.out.notes.includes("codex: plan mode: Codex reads only (its sandbox read-only, its commands asked of Filament)"));
    const [start] = sent("cx-plan", "thread/start");
    assert.deepEqual([start.params.approvalPolicy, start.params.sandbox], ["untrusted", "read-only"]);
    await send(up, "now build it", { conversationId: "c-plan", history: echoed("look around") });
    const [first, second] = sent("cx-plan", "turn/start");
    assert.ok(!("approvalPolicy" in first.params), "a thread opened with the policy needs no override");
    assert.equal(second.params.approvalPolicy, "never");
    assert.deepEqual(second.params.sandboxPolicy, { type: "dangerFullAccess" });
  });

  // (fails before: yes, for its notice — the review of 11-10: only the record said it, and the person never saw why
  // Codex wrote nothing by itself)
  test("a sandbox Codex makes read-only is said, on the chat too; setting it up is left to Codex", async () => {
    const { out, events } = await send(fake("cx-sandbox", { permissions: "allow-once" }, { FAKE_CODEX_READONLY: "1" }), "hi", { conversationId: "c-sandbox" });
    const note = out.notes.find((/** @type {string} */ n) => /sandbox, not workspaceWrite/.test(n)) || "";
    assert.match(note, /^codex: Codex runs this thread with a readOnly sandbox, not workspaceWrite/);
    if (process.platform === "win32")
      assert.match(note, /: Codex's Windows sandbox is not set up \(Codex's own setup turns it on; Filament never changes the machine's security setup\)$/);
    const told = events.filter((e) => e.type === "agent-notice");
    assert.equal(told.length, 1, "once, as the thread opens");
    assert.equal(told[0].severity, "warning");
    assert.match(told[0].title, /^Codex works read-only in this chat/);
    assert.equal(told[0].description, "its changes and commands come to Filament to approve, one by one");
    // (fails before: yes — it left ahead of the session's event, which opens the run a harness chat draws it on)
    assert.deepEqual(events.filter((e) => e.type === "session" || e.type === "agent-notice").map((e) => e.type), ["session", "agent-notice"], "on the run the session's event opened");
  });

  // (fails before: yes — every open of the thread told the chat again: its app-server started again, an idle thread
  // loaded again, a change of its tools)
  test("the read-only sandbox is told once for a chat, whatever opens its thread again or replaces it; again once a thread of it has opened able to write", async () => {
    const acp = { permissions: "allow-once" };
    const readOnly = fake("cx-sandbox-once", acp, { FAKE_CODEX_READONLY: "1" });
    const told = (/** @type {any[]} */ events) => events.filter((e) => e.type === "agent-notice").length;
    const recorded = (/** @type {any} */ out) => out.notes.filter((/** @type {string} */ n) => /sandbox, not workspaceWrite/.test(n)).length;
    const again = () => assert.equal(bridge.killProcess("cx-sandbox-once|app-server"), true);
    const a = await send(readOnly, "one", { conversationId: "c-once" });
    assert.deepEqual([told(a.events), recorded(a.out)], [1, 1]);
    again();
    const b = await send(readOnly, "two", { conversationId: "c-once", history: echoed("one") });
    assert.ok(b.out.notes.includes(`codex: thread ${a.out.sessionId.slice(0, 8)} loaded again`), b.out.notes.join("\n"));
    assert.deepEqual([told(b.events), recorded(b.out)], [0, 1], "the record says it at every open, the chat once");
    // A thread that replaces the chat's (this Codex cannot resume it) is the same chat's.
    again();
    const c = await send(fake("cx-sandbox-once", acp, { FAKE_CODEX_READONLY: "1", FAKE_CODEX_RESUME_FAIL: "1" }), "three", { conversationId: "c-once", history: echoed("one", "two") });
    assert.notEqual(c.out.sessionId, a.out.sessionId);
    assert.deepEqual([told(c.events), recorded(c.out)], [0, 1], "a new thread of a chat that was told");
    // Its sandbox set up meanwhile, the thread opens able to write; read-only once more, the chat is told again.
    again();
    const d = await send(fake("cx-sandbox-once", acp), "four", { conversationId: "c-once", history: echoed("one", "two", "three") });
    assert.deepEqual([told(d.events), recorded(d.out)], [0, 0]);
    again();
    const e = await send(readOnly, "five", { conversationId: "c-once", history: echoed("one", "two", "three", "four") });
    assert.deepEqual([told(e.events), recorded(e.out)], [1, 1], "told again");
  });

  // (fails before: yes — the chat was told Codex's changes come to Filament, where Codex asks for nothing)
  test("a read-only sandbox under allow-all: Codex asks for nothing, and the notice says so", async () => {
    const { out, events } = await send(fake("cx-sandbox-all", {}, { FAKE_CODEX_READONLY: "all" }), "hi", { conversationId: "c-sandbox-all" });
    const [start] = sent("cx-sandbox-all", "thread/start");
    assert.deepEqual([start.params.approvalPolicy, start.params.sandbox], ["never", "danger-full-access"]);
    assert.ok(out.notes.includes("codex: Codex runs this thread with a readOnly sandbox, not dangerFullAccess"), out.notes.join("\n"));
    assert.deepEqual(events.filter((e) => e.type === "agent-notice").map((e) => [e.title, e.description]), [["Codex works read-only in this chat", "under the allow-all policy it asks for nothing, so the changes and commands its sandbox refuses fail there, and none comes to Filament"]]);
  });

  test("the threads Codex knows, a chat set to one, and the name and compaction Codex reports", async () => {
    const up = fake("cx-threads");
    const a = await send(up, "~rename", { conversationId: "c-t1" });
    assert.equal(a.out.title, "Fake named thread");
    assert.ok(a.events.some((e) => e.type === "info" && e.title === "Fake named thread"));
    await send(up, "~subagent", { conversationId: "c-t3" });
    const l = await bridge.listSessions(up);
    assert.equal(l.ok, true);
    assert.equal(l.sessions.length, 2, "two chats' threads; the sub-agent's is not one to resume");
    assert.equal(l.sessions.find((/** @type {any} */ s) => s.sessionId === a.out.sessionId)?.updatedAt, new Date(1791300100 * 1000).toISOString());
    const att = await bridge.attach({ upstream: up, format: "anthropic", body: body("x"), conversationId: "c-t2", sessionId: a.out.sessionId.slice(0, 8) });
    assert.equal(att.ok, true);
    const b = await send(up, "~compact", { conversationId: "c-t2" });
    assert.equal(b.out.sessionId, a.out.sessionId, "the chat goes on in the thread it was set to");
    assert.ok(b.out.notes.includes("codex: Codex compacted its context during this turn"));
    // HarnessV3-ACP AC2-1: the item's start and end, once; the deprecated `thread/compacted` that follows is no second.
    assert.deepEqual(b.events.filter((/** @type {any} */ e) => e.type === "compaction"), [{ type: "compaction", id: "cmp_1", state: "started" }, { type: "compaction", id: "cmp_1", state: "completed" }]);
    const miss = await bridge.attach({ upstream: up, format: "anthropic", body: body("x"), conversationId: "c-t4", sessionId: "nope" });
    assert.match(String(miss.error), /^no Codex thread matches "nope" \(2 known; \/sessions lists them\)$/);
  });

  test("the plan's windows: Codex's sparse update keeps what it does not say", async () => {
    const { out } = await send(fake("cx-limits"), "~limits", { conversationId: "c-limits" });
    assert.deepEqual(out.account.windows, [
      { id: "primary", kind: "session", label: "5-hour", usedPercent: 55, resetsAt: 1791400000000, windowMins: 300, status: null },
      { id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 40, resetsAt: 1791900000000, windowMins: 10080, status: null },
    ]);
    // (fails before: no — a guard the mutation pass asked for: no update named the plan, or left out a window's length,
    // its reset or its use)
    assert.equal(out.account.plan, "pro");
    // (fails before: no — a guard the mutation pass asked for: no model's own allowance came beside the plan's)
    assert.deepEqual([out.account.reached ?? null, out.account.credits ?? null], [null, null], "a model's own allowance is never the plan's");
  });

  // (fails before: no — a guard the mutation pass asked for: no update came while Codex said the plan had reached its
  // limit)
  test("an update that leaves out why the plan stopped says nothing of it: Codex's word stands", async () => {
    const { out } = await send(fake("cx-limits-spent", {}, { FAKE_CODEX_SPENT: "1" }), "~limits", { conversationId: "c-limits-spent" });
    assert.equal(out.account.reached, "rate_limit_reached");
  });

  // (fails before: no — a guard the mutation pass asked for: no reset credit's answer was lost)
  test("a reset credit whose answer was lost: pressed again, the same attempt — Codex says it already reset the plan", async () => {
    const up = fake("cx-credit-lost", {}, { FAKE_CODEX_SPENT: "1", FAKE_CODEX_CONSUME_LOST: "1" });
    await assert.rejects(bridge.useResetCredit(up), /the answer was lost/);
    assert.equal(await bridge.useResetCredit(up), "alreadyRedeemed");
  });

  // (fails before: no — a guard the mutation pass asked for: no account was read again while its windows could not be)
  test("the same account read again keeps its windows when they can't be read", async () => {
    const up = fake("cx-limits-fail", {}, { FAKE_CODEX_LIMITS_FAIL: "1" });
    const uses = (/** @type {any} */ out) => out.account.windows.map((/** @type {any} */ w) => [w.id, w.usedPercent]);
    assert.deepEqual(uses((await send(up, "~limits", { conversationId: "c-limits-fail" })).out), [["primary", 55]]);
    assert.equal((await bridge.test(up)).signedIn, true);
    assert.deepEqual(uses((await send(up, "again", { conversationId: "c-limits-fail" })).out), [["primary", 55]]);
  });

  // (fails before: yes — another account signing in kept the last one's weekly window, which its plan does not have;
  // HarnessV3-ACP AC2's mutation pass)
  test("another account signs in: the record has it, its plan and its windows, none of the last one's", async () => {
    const { out } = await send(fake("cx-account"), "~account-change", { conversationId: "c-account" });
    const { at, ...account } = out.account;
    assert.deepEqual(account, {
      kind: "account",
      label: "ChatGPT Pro",
      plan: "pro",
      email: "ops@example.com",
      organization: null,
      detail: null,
      billing: "plan",
      windows: [{ id: "primary", kind: "session", label: "5-hour", usedPercent: 12, resetsAt: 1791400000000, windowMins: 300, status: null }],
    });
  });

  test("offer, the connection test, the process: what the Agents page reads", async () => {
    const up = fake("cx-offer");
    const o = await bridge.offer(up);
    assert.equal(o.ok, true);
    assert.deepEqual(o.models, [
      "gpt-6-astra",
      "gpt-6-astra-low",
      "gpt-6-astra-medium",
      "gpt-6-astra-high",
      "gpt-6-astra-xhigh",
      "gpt-5.6-terra",
      "gpt-5.6-terra-low",
      "gpt-5.6-terra-medium",
    ]);
    assert.deepEqual([o.modes, o.efforts], [["agent", "plan"], ["low", "medium", "high", "xhigh"]]);
    const t = await bridge.test(up);
    assert.equal(t.ok, true);
    assert.deepEqual([t.auth, t.models, t.currentModel, t.agent?.version], ["ChatGPT Plus (dev@example.com)", 2, "gpt-6-astra", "0.154.0"]);
    assert.equal(profiles.get("cx-offer")?.agent?.version, "0.154.0", "the profile kept where the ACP agents' are");
    assert.deepEqual(bridge.processInfo("cx-offer")?.identity, { kind: "account", label: "ChatGPT Plus", plan: "plus", email: "dev@example.com", organization: null, detail: null, billing: "plan" });
    // (fails before: no — a guard the mutation pass asked for: the models came on one page, and none were listed twice
    // within the hour)
    const pages = sent("cx-offer", "model/list").length;
    const kept = await bridge.listModels(up);
    assert.equal(kept.source, "cache");
    // HarnessV3-ACP AF2: Codex's own words for its models, kept with its list.
    assert.deepEqual(kept.labels, { "gpt-6-astra": { note: "Latest frontier agentic coding model." } }, "a displayName that only spells its id says nothing");
    assert.equal(sent("cx-offer", "model/list").length, pages);
    assert.deepEqual(sent("cx-offer", "model/list").slice(-2).map((m) => m.params.cursor ?? null), [null, "2"]);
    const p = bridge.status().processes.find((x) => x.key === "cx-offer|app-server");
    assert.ok(p && !p.exited);
    // (fails before: no — a guard the mutation pass asked for: no key named an upstream without its process's part)
    assert.equal(bridge.killProcess("cx-offer"), false, "an upstream's id is no process's key");
    assert.equal(bridge.killProcess("cx-offer|app-server"), true);
    assert.equal(bridge.killProcess("cx-offer|app-server"), false, "gone already");
    assert.equal(bridge.killProcess("cx-offer|sonnet"), false, "an ACP agent's key is not Codex's");
  });

  // (fails before: no — a guard the mutation pass asked for: no chat's name or fill was read back for /status and
  // /compact, no thread was spawned without a call, and no chat started a thread while another turn waited for one)
  test("a chat keeps its thread's name and last fill; a thread no call spawned is said; another chat's is never taken", async () => {
    const up = fake("cx-keep", {}, { FAKE_CODEX_SPAWN_MS: "1500" });
    await send(up, "~rename", { conversationId: "c-keep" });
    await send(up, "hello", { conversationId: "c-keep" });
    const conv = bridge.peekByRequest({ upstream: up, format: "anthropic", body: body("x"), conversationId: "c-keep" });
    assert.deepEqual([conv?.title, conv?.context], ["Fake named thread", { used: 912, size: 400000, cacheRead: 0 }]);
    const stray = await send(up, "~stray-child", { conversationId: "c-stray" });
    const never = (/** @type {string[]} */ notes) => notes.filter((n) => /^codex: 1 sub-agent thread\(s\) of this turn were never matched/.test(n));
    assert.equal(never(stray.out.notes).length, 1);
    /** @type {any[]} */
    const events = [];
    const waits = bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: body("~subagent-slow"), conversationId: "c-waits", onEvent: (/** @type {any} */ ev) => events.push(ev) });
    await until(() => events.some((e) => e.type === "subagent" && e.state === "spawned"), "the spawn");
    await send(up, "hello", { conversationId: "c-other" });
    const out = await waits;
    assert.equal(never(out.notes).length, 0, out.notes.join("\n"));
    assert.equal(events.filter((e) => e.subagent === "spawn_1" && e.type === "text").map((e) => e.text).join(""), "There are 2 files.");
  });

  // (fails before: no — a guard the mutation pass asked for: no chat was set to another chat's thread, none was
  // forgotten while another held its thread, none went idle, and no chat had two turns at once)
  test("a chat set to another's thread resumes it, and keeps it when the other is forgotten; idle, a chat lets go", async () => {
    const up = fake("cx-share", { sessionIdleMinutes: 1 }, { FAKE_CODEX_SPAWN_MS: "600" });
    const x = await send(up, "hello", { conversationId: "c-x" });
    const y = await send(up, "hi", { conversationId: "c-y", resumeSessionId: x.out.sessionId });
    assert.deepEqual([y.out.sessionId, y.out.resumed], [x.out.sessionId, true]);
    const forget = (/** @type {string} */ c) => bridge.forgetByRequest({ upstream: up, format: "anthropic", body: body("x"), conversationId: c });
    assert.equal(forget("c-x"), true);
    await send(up, "ping", { conversationId: "c-ping" });
    assert.equal(sent("cx-share", "thread/unsubscribe").length, 0, "held while another chat holds it");
    assert.equal(forget("c-y"), true);
    await send(up, "ping", { conversationId: "c-ping" });
    assert.equal(sent("cx-share", "thread/unsubscribe").length, 1, "let go once, when no chat holds it");
    /** @type {string[]} */
    const order = [];
    await Promise.all([
      send(up, "~subagent-slow", { conversationId: "c-queue" }).then(() => order.push("first")),
      send(up, "hello", { conversationId: "c-queue" }).then(() => order.push("second")),
    ]);
    assert.deepEqual(order, ["first", "second"], "a chat's turns go one at a time");
    bridge.sweep(Date.now() + 2 * 60000);
    assert.equal(bridge.peekByRequest({ upstream: up, format: "anthropic", body: body("x"), conversationId: "c-queue" }), null);
    await until(() => sent("cx-share", "thread/unsubscribe").length === 3, "the idle chats let go");
  });

  // (fails before: no — a guard the mutation pass asked for: no turn ran in `ask` or `read-only` mode, forwarded the
  // client's system prompt, carried an image, or was said after its client left; no new thread was seeded from the
  // archive or with seeding off; no turn chose no model)
  test("what Codex is handed: plan mode, the client's system prompt, images, what it said meanwhile, the seed, its model", async () => {
    for (const mode of ["ask", "read-only"]) {
      const { out } = await send(fake(`cx-mode-${mode}`), "hello", { conversationId: `c-mode-${mode}`, mode });
      const [start] = sent(`cx-mode-${mode}`, "thread/start");
      assert.deepEqual([start.params.sandbox, start.params.approvalPolicy], ["read-only", "untrusted"]);
      assert.ok(out.notes.some((/** @type {string} */ n) => n.startsWith("codex: plan mode")));
    }
    const up = fake("cx-handed", { forwardSystemPrompt: true });
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
    const pic = { model: "m", max_tokens: 100, system: "Answer in French.", messages: [{ role: "user", content: [{ type: "text", text: "what is this" }, image] }] };
    await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: pic, conversationId: "c-handed", onEvent: () => {} });
    assert.equal(sent("cx-handed", "thread/start")[0].params.developerInstructions, "Answer in French.");
    assert.deepEqual(sent("cx-handed", "turn/start")[0].params.input[1], { type: "image", url: "data:image/png;base64,iVBORw0KGgo=" });
    // Its client gone after the turn began, what the turn said goes to the chat's next turn.
    await send(up, "hello", { conversationId: "c-left", onEvent: (/** @type {any} */ ev) => ev.type === "session" && bridge.turns.get(ev.sessionId)?.detach() });
    const next = await send(up, "again", { conversationId: "c-left" });
    assert.equal(next.events.filter((e) => e.type === "text").map((e) => e.text).join(""), "Echo: helloEcho: again");
    const off = await send(fake("cx-noseed", { seedHistory: false }), "c", { conversationId: "c-noseed", history: echoed("a", "b") });
    assert.deepEqual([off.out.seeded, sent("cx-noseed", "thread/inject_items").length], [false, 0]);
    /** @type {any} */ (bridge).archivedTranscript = () => ({ text: "User: a\n\nAssistant: noted", view: "chat", turns: 1, tokens: 9, dropped: 0 });
    try {
      const arch = await send(fake("cx-archseed"), "c", { conversationId: "c-archseed", history: echoed("a", "b") });
      assert.match(sent("cx-archseed", "thread/inject_items")[0].params.items[0].content[0].text, /^Earlier conversation \(from another assistant; continue it, do not repeat it\):\n\nUser: a/);
      assert.ok(arch.out.notes.includes("codex: seeded from Filament's archive (chat view): 1 turn(s), ~9 tokens, as the thread's history"));
    } finally {
      /** @type {any} */ (bridge).archivedTranscript = null;
    }
    const a = await send(fake("cx-nomodel"), "hello", { conversationId: "c-nomodel", modelId: "" });
    const b = await send(fake("cx-nomodel"), "again", { conversationId: "c-nomodel", modelId: "" });
    assert.deepEqual([a.out.agentModel, b.out.agentModel], ["gpt-6-astra", "gpt-6-astra"], "the thread's model, kept for the chat");
  });

  test("everything Filament sent Codex is in the pinned protocol", () => {
    const all = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
    const requests = all.filter((m) => m.method && m.id != null);
    assert.ok(requests.length > 50, "the tests above went through the fake");
    for (const m of new Set(requests.map((r) => r.method))) assert.ok(CODEX_SCHEMA.requests.includes(m), `${m}: a request Codex takes`);
    /** @param {string} method @param {string[]} fields */
    const within = (method, fields) => {
      for (const r of requests.filter((x) => x.method === method))
        for (const k of Object.keys(r.params || {})) assert.ok(fields.includes(k), `${method} takes ${k}`);
    };
    within("thread/start", CODEX_SCHEMA.threadStart);
    within("thread/resume", CODEX_SCHEMA.threadResume);
    within("turn/start", CODEX_SCHEMA.turnStart);
    // (fails before: no — a guard the mutation pass asked for: nothing read the handshake's last word, the experimental
    // API left off, or the lines' missing jsonrpc field)
    const inits = requests.filter((m) => m.method === "initialize");
    assert.ok(inits.every((m) => m.params.capabilities.experimentalApi === false), "Codex's experimental API never asked for");
    assert.equal(all.filter((m) => m.method === "initialized").length, inits.length, "each handshake confirmed");
    assert.ok(all.every((m) => m.jsonrpc === null), "Codex's lines carry no jsonrpc field");
  });
});

test("every method Filament reads or answers is one the pinned protocol has", () => {
  const src = ["items.js", "bridge.js"].map((f) => readFileSync(new URL(`../src/adapters/agents/codex/${f}`, import.meta.url), "utf8")).join("\n");
  const methods = new Set([...src.matchAll(/"([a-zA-Z]+(?:\/[a-zA-Z_]+)+)"/g)].map((m) => m[1]));
  assert.ok(methods.size > 30, [...methods].join(", "));
  const known = new Set([...CODEX_SCHEMA.requests, ...CODEX_SCHEMA.serverRequests, ...CODEX_SCHEMA.notifications]);
  for (const m of methods) assert.ok(known.has(m), `${m}: a method of Codex ${CODEX_SCHEMA.codex}'s stable protocol`);
  const cases = [...src.matchAll(/case "([^"/]+)":/g)].map((m) => m[1]);
  for (const c of cases) assert.ok(CODEX_SCHEMA.items.includes(c) || known.has(c), `${c}: an item kind or a method Codex has`);
});
