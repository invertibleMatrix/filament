// @ts-check
// HarnessV3-ACP AC2-3: a plain agent, with none of Claude's marks or Cursor's, read from ACP's standard updates as
// Gemini CLI 0.44.1 and Qoder CLI 1.1.50 send them (read in their installed bundles: gemini-cli's bundle/gemini-*.js,
// qodercli's bundle/qodercli.js). The reader and the run on their own; what a turn spent; each agent's profile; the
// prompt a session is sent; the generic card; then through the app, the fake agent's `~gemini` and `~qoder` turns
// (fixtures/fake-acp-agent.mjs), a refusal by the permission policy, and a load whose replay goes on after its answer.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentRun } from "../src/app/agent-run.js";
import { createUpdateReader, readModelUsage, readUsage } from "../src/adapters/agents/acp/updates.js";
import { readProfile } from "../src/adapters/agents/acp/profile.js";
import { composePrompt, countTaken, seenWithin, tookWithin } from "../src/adapters/agents/acp/prompt.js";
import { flattenMessages } from "../src/core/wire/flatten.js";
import { supportsRows } from "../src/ui/lib/agent-profile.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { FAKE_ACP_AGENT, startApp, parseSse } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const ROOT = resolve("/work/proj");
const IN_ROOT = join(ROOT, "src", "a.js");

/** A translator over a recording sink. @param {Partial<Parameters<typeof createAgentRun>[0]>} [o] */
function make(o = {}) {
  /** @type {any[]} */
  const events = [];
  const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, now: () => 1000, ...o });
  return { run, events, /** @param {string} type */ of: (type) => events.filter((e) => e.type === type) };
}
/** The reader of a plain agent's updates, feeding a translator. @param {ReturnType<typeof make>} t */
const readerOf = (t) => createUpdateReader({ out: { tools: [] }, conv: {}, turn: { bridgePlan: () => null }, onEvent: (/** @type {any} */ e) => t.run.take(e), notes: [] });
/** What an agent showed, as ACP's content. @param {string} text */
const said = (text) => [{ type: "content", content: { type: "text", text } }];

describe("a plain agent's calls (AC2-3)", () => {
  // (fails before: yes — Gemini CLI and Qoder announce a call they ask about first only in the question: its card came
  // at its end, Qoder's by its kind alone, and one the answer kept from running never ended)
  test("a call announced only in its permission question is drawn from it; an answer that keeps it from running ends it", async () => {
    const t = make({ root: ROOT });
    const read = readerOf(t);
    read.asked({ toolCallId: "e1", status: "pending", title: "a.js: one => two", kind: "edit", locations: [{ path: IN_ROOT }], content: [{ type: "diff", path: IN_ROOT, oldText: "one", newText: "two", _meta: { kind: "modify" } }] });
    read.asked({ toolCallId: "b1", status: "pending", title: "npm test", kind: "execute", rawInput: { command: "npm test", description: "Run the tests" }, _meta: { qoder: { toolName: "Bash" } } });
    read.asked({ toolCallId: "b2", status: "pending", title: "rm -rf build", kind: "execute" });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.name, e.card]), [
      ["e1", "edit", { kind: "edit", title: "Edit", subject: "src/a.js" }],
      ["b1", "Bash", { kind: "shell", title: "Run", subject: "npm test" }],
      ["b2", "bash", { kind: "shell", title: "Run", subject: "rm -rf build" }],
    ], "drawn while the question stands");
    read.notRun("e1", "declined", "");
    read.notRun("b2", "refused", "the read-only permission policy");
    // Qoder's own word on a call it was refused comes after: the call keeps the end it had.
    read({ sessionUpdate: "tool_call_update", toolCallId: "b2", status: "failed", content: said("```\nThe user doesn't want to proceed with this tool use.\n```") });
    read({ sessionUpdate: "tool_call_update", toolCallId: "b1", status: "completed", content: said("# pass 3") });
    read.notRun("b1", "declined", "");
    read.asked({ toolCallId: "b1", status: "pending", title: "npm test", kind: "execute" });
    const ends = Object.fromEntries(t.of("tool-end").map((e) => [e.id, e]));
    assert.equal(t.of("tool-end").length, 3, "each ends once");
    assert.deepEqual([ends.e1.ok, ends.e1.declined, ends.e1.chars, "preview" in ends.e1], [false, true, 0, false]);
    assert.deepEqual([ends.b2.ok, ends.b2.refused, ends.b2.reason, ends.b2.chars], [false, true, "the read-only permission policy", 0]);
    assert.deepEqual([ends.b1.ok, ends.b1.declined, ends.b1.preview], [true, undefined, "# pass 3"], "one that ended is left as it is");
    await t.run.close({ status: "done" });
    const { work } = t.run.archive();
    assert.deepEqual(work[1].content.map((/** @type {any} */ r) => [r.tool_use_id, r.content, r.is_error ?? false]), [
      ["e1", "Not run: the developer declined it.", true],
      ["b1", "# pass 3", false],
      ["b2", "Not run: the read-only permission policy refused it.", true],
    ]);
  });

  // (fails before: yes — Qoder names its tools under `_meta.qoder`, which was not read: its calls were drawn by their
  // kinds)
  test("Qoder's tool is named where it announces the call, with its input whole", () => {
    const t = make({ root: ROOT });
    readerOf(t)({ sessionUpdate: "tool_call", toolCallId: "q1", status: "pending", title: `Read ${IN_ROOT}`, kind: "read", rawInput: { file_path: IN_ROOT }, content: said(JSON.stringify({ file_path: IN_ROOT })), locations: [{ path: IN_ROOT }], _meta: { qoder: { toolName: "Read" } } });
    assert.deepEqual(t.of("tool-start").map((e) => [e.name, e.card]), [["Read", { kind: "read", title: "Read", subject: "src/a.js" }]]);
  });

  // (fails before: yes — a result the agent showed nothing of said "0 chars", as if it were empty: Gemini CLI shows
  // nothing of a read)
  test("a result the agent showed nothing of is not counted; one the model read empty is", () => {
    const t = make({ root: ROOT });
    t.run.take({ type: "tool", id: "r1", title: "a.js", kind: "read", status: "in_progress", content: [], locations: [{ path: IN_ROOT }] });
    t.run.take({ type: "tool", id: "r1", title: "a.js", kind: "read", status: "completed", content: [], locations: [{ path: IN_ROOT }] });
    const [end] = t.of("tool-end");
    assert.deepEqual([end.ok, "chars" in end, "preview" in end], [true, false, false]);
    // Claude's raw result is what the model read: an empty one is counted.
    const c = make({ rawMessages: true });
    c.run.take({ type: "raw", message: { type: "assistant", parent_tool_use_id: null, message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "g1", name: "Grep", input: { pattern: "x" } }] } } });
    c.run.take({ type: "raw", message: { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "g1", content: "" }] } } });
    c.run.take({ type: "tool", id: "g1", toolName: "Grep", status: "completed" });
    assert.equal(c.of("tool-end")[0].chars, 0);
  });

  // (fails before: yes — an announcement's words stood as the call's result when its end brought none: Gemini CLI's
  // explanation of a command, Qoder's copy of a call's input)
  test("an update's content replaces the call's whole: an announcement's words are no result; a fenced result reads as its code", () => {
    const t = make({ root: ROOT });
    t.run.take({ type: "tool", id: "x1", title: "npm test", kind: "execute", status: "pending", content: said(`[current working directory ${ROOT}] (Run the tests)`) });
    t.run.take({ type: "tool", id: "x1", title: "npm test", kind: "execute", status: "completed", content: [] });
    t.run.take({ type: "tool", id: "q1", toolName: "Read", title: `Read ${IN_ROOT}`, kind: "read", status: "pending", rawInput: { file_path: IN_ROOT }, content: said(JSON.stringify({ file_path: IN_ROOT })) });
    t.run.take({ type: "tool", id: "q1", status: "completed", content: said("```\nconst a = 1;\n```"), rawOutput: "const a = 1;\n" });
    t.run.take({ type: "tool", id: "q2", toolName: "Bash", title: "ls", kind: "execute", status: "completed", rawInput: { command: "ls" }, content: said("````console\na file with ``` in it\n````") });
    const ends = Object.fromEntries(t.of("tool-end").map((e) => [e.id, e]));
    assert.deepEqual([ends.x1.preview, ends.q1.preview, ends.q2.preview], [undefined, "const a = 1;", "a file with ``` in it"]);
  });

  // (fails before: yes — a path an agent names only in its title was cut at 90 characters before it was made relative:
  // a long one inside the folder read "…")
  test("a path an agent names only in its title reads whole, relative to the folder", () => {
    const parts = [...Array(20).fill("deep"), "file.js"];
    const t = make({ root: ROOT });
    t.run.take({ type: "tool", id: "r1", title: `Read ${join(ROOT, ...parts)}`, kind: "read", status: "completed" });
    assert.equal(t.of("tool-start")[0].card.subject, parts.join("/"));
  });

  // (fails before: yes — ACP's delete and move, named no tool, read as their bare kinds: "delete" over "delete")
  test("ACP's delete and move read as words, by the path they name; a tool's own name comes first", () => {
    const t = make({ root: ROOT });
    t.run.take({ type: "tool", id: "d1", title: "Delete tmp/cache", kind: "delete", status: "in_progress" });
    t.run.take({ type: "tool", id: "m1", title: "Move a.js", kind: "move", status: "in_progress", locations: [{ path: IN_ROOT }] });
    t.run.take({ type: "tool", id: "d2", toolName: "rm_file", title: "Delete it", kind: "delete", status: "in_progress" });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.card]), [
      ["d1", { kind: "other", title: "Delete", subject: "tmp/cache" }],
      ["m1", { kind: "other", title: "Move", subject: "src/a.js" }],
      ["d2", { kind: "other", title: "rm_file", subject: "Delete it" }],
    ]);
  });

  // (fails before: yes — a fetch Gemini CLI titles in words read as its whole sentence)
  test("a fetch titled in words reads as the address it names", () => {
    const t = make();
    t.run.take({ type: "tool", id: "f1", title: "Fetching content from: https://example.com/docs", kind: "fetch", status: "in_progress" });
    t.run.take({ type: "tool", id: "f2", title: "Fetch the docs", kind: "fetch", status: "in_progress" });
    assert.deepEqual(t.of("tool-start").map((e) => e.card.subject), ["https://example.com/docs", "the docs"]);
  });

  // (fails before: yes — Gemini CLI's call to an MCP server's tool read as its title on the generic card, its
  // parameters as its result until the end, and nothing named it in the archive)
  test("Gemini CLI's call to an MCP server's tool is the loop's MCP call: named, its parameters its input", async () => {
    const t = make({ root: ROOT });
    /** @type {{ tools: any[] }} */
    const out = { tools: [] };
    const read = createUpdateReader({ out, conv: {}, turn: { bridgePlan: () => null }, onEvent: (/** @type {any} */ e) => t.run.take(e), notes: [] });
    read({ sessionUpdate: "tool_call", toolCallId: "m1", status: "in_progress", title: "list_issues (github MCP Server)", content: said('{"state":"open"}'), locations: [], kind: "other" });
    read({ sessionUpdate: "tool_call_update", toolCallId: "m1", status: "completed", title: "list_issues (github MCP Server)", content: said('{"open":3}'), locations: [], kind: "other" });
    // One to Filament's own server is routed; parameters too long to send are a note, no input.
    read({ sessionUpdate: "tool_call", toolCallId: "m2", status: "in_progress", title: "filament_memory_search (filament MCP Server)", content: said("[Payload omitted due to length with parameters: query]"), kind: "other" });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.name, e.card]), [
      ["m1", "mcp__github__list_issues", { kind: "mcp", title: "mcp__github__list_issues", subject: "mcp__github__list_issues" }],
      ["m2", "filament_memory_search", { kind: "other", title: "filament_memory_search", subject: "filament_memory_search" }],
    ]);
    assert.deepEqual(out.tools.map((r) => [r.id, !!r.routed]), [["m1", false], ["m2", true]]);
    assert.equal(t.of("tool-end")[0].preview, '{"open":3}');
    await t.run.close({ status: "done" });
    const [call] = t.run.archive().work[0].content.filter((/** @type {any} */ b) => b.type === "tool_use");
    assert.deepEqual([call.name, call.input], ["mcp__github__list_issues", { state: "open" }], "its result is no input");
  });

  // (fails before: yes — Cursor's call to an MCP server's tool read as its title on the generic card, its input as
  // Cursor's wrapper, and one to Filament's own server as the agent's own tool, not routed)
  test("Cursor's call to an MCP server's tool is the loop's MCP call: named from its input, its arguments its input", async () => {
    const t = make({ root: ROOT });
    /** @type {{ tools: any[] }} */
    const out = { tools: [] };
    const read = createUpdateReader({ out, conv: {}, turn: { bridgePlan: () => null }, onEvent: (/** @type {any} */ e) => t.run.take(e), notes: [] });
    const asked = { type: "content", content: { type: "text", text: '```json\n{\n  "state": "open"\n}\n```' } };
    read({ sessionUpdate: "tool_call", toolCallId: "c1", status: "pending", title: "github: list_issues", kind: "other", rawInput: { providerIdentifier: "github", toolName: "list_issues", args: { state: "open" } } });
    read.asked({ toolCallId: "c1", status: "pending", title: "github-list_issues: list_issues", kind: "other", content: [asked] });
    read({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed", rawOutput: { success: true }, content: said("3 open") });
    read({ sessionUpdate: "tool_call", toolCallId: "c2", status: "pending", title: "filament: tasks", kind: "other", rawInput: { providerIdentifier: "filament", toolName: "tasks", args: { add: ["a"] } } });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.name, e.card, e.args]), [
      ["c1", "mcp__github__list_issues", { kind: "mcp", title: "mcp__github__list_issues", subject: "mcp__github__list_issues" }, '{"state":"open"}'],
      // E40: Filament's own tasks call has its own card; this one names no action, so it reads as the task graph's.
      ["c2", "tasks", { kind: "tasks", title: "Task graph", subject: "" }, ""],
    ]);
    assert.deepEqual(out.tools.map((r) => [r.id, !!r.routed]), [["c1", false], ["c2", true]]);
    await t.run.close({ status: "done" });
    const [call] = t.run.archive().work[0].content.filter((/** @type {any} */ b) => b.type === "tool_use");
    assert.deepEqual([call.name, call.input], ["mcp__github__list_issues", { state: "open" }]);
  });

  // (fails before: yes — an agent's MCP call carried its name as its arguments: its card showed no parameters, and
  // the name under Parameters)
  test("an MCP call's card carries its input as the loop's does: its JSON, never its name", () => {
    const t = make();
    t.run.take({ type: "tool", id: "m1", toolName: "mcp__github__list_issues", title: "mcp__github__list_issues", kind: "other", status: "in_progress", rawInput: { state: "open" } });
    t.run.take({ type: "tool", id: "m2", toolName: "mcp__fs__stat", title: "stat (fs MCP Server)", kind: "other", status: "in_progress", rawInput: {} });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.args]), [["m1", '{"state":"open"}'], ["m2", ""]]);
  });

  test("a call its permission's question announced is drawn at once, though its title names no target", () => {
    const t = make({ root: ROOT });
    const read = readerOf(t);
    read.asked({ toolCallId: "m1", status: "pending", title: "list_issues (github MCP Server)", content: said('{"state":"open"}'), kind: "other" });
    read({ sessionUpdate: "tool_call", toolCallId: "m2", status: "pending", title: "list_pulls (github MCP Server)", kind: "other" });
    assert.deepEqual(t.of("tool-start").map((e) => e.id), ["m1"], "a call merely announced waits until its title names a target or it runs");
  });
});

describe("what a plain agent's turn spent (AC2-3)", () => {
  /** @param {number} i @param {number} o */
  const count = (i, o) => ({ input_tokens: i, output_tokens: o });
  // (fails before: yes — Gemini CLI says what a turn spent only on the answer's `_meta.quota`, in snake_case: its turns
  // were estimated, and its tokens per model, as Qoder's, read 0)
  test("Gemini CLI's quota and Qoder's usage are the turn's tokens; each model's, in either case", () => {
    const gemini = { stopReason: "end_turn", _meta: { quota: { token_count: count(1840, 96), model_usage: [{ model: "gemini-3-pro-preview", token_count: count(1840, 96) }] } } };
    const qoder = { stopReason: "end_turn", usage: { inputTokens: 2310, outputTokens: 142, totalTokens: 2452 }, _meta: { quota: { token_count: count(2310, 142), model_usage: [{ model: "qoder-auto", token_count: count(2310, 142) }] } } };
    assert.deepEqual(readUsage(gemini), { input: 1840, output: 96, cacheRead: 0, cacheWrite: 0, total: null });
    assert.deepEqual(readUsage(qoder), { input: 2310, output: 142, cacheRead: 0, cacheWrite: 0, total: 2452 }, "ACP's own field first");
    assert.deepEqual(readModelUsage(gemini), [{ model: "gemini-3-pro-preview", input: 1840, output: 96, cacheRead: 0, cacheWrite: 0 }]);
    assert.deepEqual(readModelUsage(qoder), [{ model: "qoder-auto", input: 2310, output: 142, cacheRead: 0, cacheWrite: 0 }]);
    // Claude's adapter counts each model's in camelCase, its cache apart.
    const claude = { _meta: { quota: { model_usage: [{ model: "claude-sonnet-5", token_count: { inputTokens: 10, outputTokens: 46, cachedInputTokens: 100, cachedWriteTokens: 24471 } }] } } };
    assert.deepEqual(readModelUsage(claude), [{ model: "claude-sonnet-5", input: 10, output: 46, cacheRead: 100, cacheWrite: 24471 }]);
    assert.equal(readUsage({ stopReason: "end_turn" }), null, "nothing said: the estimate stands");
  });
});

describe("each agent's profile (AC2-3)", () => {
  // Gemini CLI 0.44.1's answer to initialize, as its bundle builds it.
  const GEMINI = {
    protocolVersion: 1,
    authMethods: [
      { id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account" },
      { id: "gemini-api-key", name: "Gemini API key", description: "Use an API key with Gemini Developer API", _meta: { "api-key": { provider: "google" } } },
      { id: "vertex-ai", name: "Vertex AI", description: "Use an API key with Vertex AI GenAI API" },
      { id: "gateway", name: "AI API Gateway", description: "Use a custom AI API Gateway", _meta: { gateway: { protocol: "google", restartRequired: "false" } } },
    ],
    agentInfo: { name: "gemini-cli", title: "Gemini CLI", version: "0.44.1" },
    agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: true, embeddedContext: true }, mcpCapabilities: { http: true, sse: true } },
  };
  // Qoder CLI 1.1.50's: its capabilities as its bundle builds them; its name, version and login method stand in for
  // the constants it reads them from.
  const QODER = {
    protocolVersion: 1,
    authMethods: [{ id: "qoder-login", name: "Use Qoder login" }],
    agentInfo: { name: "qodercli", title: "Qoder CLI", version: "1.1.50" },
    agentCapabilities: {
      _meta: { qoder: { promptQueueing: true } },
      loadSession: true,
      sessionCapabilities: { additionalDirectories: {}, close: {}, delete: {}, fork: {}, list: {}, resume: {} },
      promptCapabilities: { image: true, embeddedContext: true },
      mcpCapabilities: { http: true, sse: true },
    },
  };
  /** The rows a profile has, by key. @param {any} init */
  const has = (init) => supportsRows(/** @type {any} */ (readProfile(init))).filter((r) => r.has).map((r) => r.key);

  // (fails before: yes — Qoder declares prompt queueing under `_meta.qoder`, which was not read)
  test("each says what its agent has and lacks: Qoder queues messages and keeps its sessions, Gemini CLI reopens them", () => {
    assert.deepEqual(has(QODER), ["reopen", "list", "close", "queueing", "fork", "delete", "folders", "images", "files", "tools"]);
    assert.deepEqual(has(GEMINI), ["reopen", "images", "audio", "files", "tools"]);
    const gemini = readProfile(GEMINI);
    assert.deepEqual([gemini.agent, gemini.auth, gemini.rawMessages], [{ name: "gemini-cli", title: "Gemini CLI", version: "0.44.1" }, ["oauth-personal", "gemini-api-key", "vertex-ai", "gateway"], false]);
    const raw = supportsRows(/** @type {any} */ (gemini)).find((r) => r.key === "raw");
    assert.equal(raw?.means, "Its tool calls are drawn from its updates: their titles, their kinds, any input it sends, and what it showed of their results.");
  });
});

describe("the prompt a session is sent (AC2-3)", () => {
  /**
   * What a session that saw `seen` of the person's turns is sent; `conv` adds to the session's state.
   * `tried`: how many of the history's user turns are an earlier try of the newest message.
   * @param {"anthropic" | "openai"} format @param {any[]} messages @param {number} seen @param {Record<string, any>} [conv]
   */
  const sent = (format, messages, seen, conv = {}, tried = 0) => {
    const flat = flattenMessages(format, { messages });
    const lastIdx = flat.map((m) => m.role).lastIndexOf("user");
    /** @type {string[]} */
    const notes = [];
    const r = composePrompt({ acp: {}, flat, history: flat.slice(0, lastIdx), last: flat[lastIdx], conv: { seenUserTurns: seen, turns: 1, ...conv }, reused: true, resumed: false, seeded: false, archSeed: null, notes, tried });
    return { ...r, notes };
  };
  // (fails before: yes — HarnessV4_Tasks B8: a message sent again after its turn failed rides twice in the history and
  // is one turn of the chat; the session counted two, so the next turn another engine answered read as one it saw)
  test("a message's earlier try is one turn with it: counted once, so the next turn elsewhere is handed over", () => {
    const retried = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi." },
      { role: "user", content: "fix the parser" },
      { role: "assistant", content: "Reading.\n\n[this turn failed: the model's service is overloaded]" },
      { role: "user", content: "fix the parser" },
    ];
    // The session heard the failed try (2 turns seen): the message again is the same turn, sent as typed.
    const again = sent("anthropic", retried, 2, {}, 1);
    assert.deepEqual(again, { promptText: "fix the parser", userTurns: 2, command: false, steered: false, skipped: false, held: [], notes: [] });
    assert.equal(sent("anthropic", retried, 2).userTurns, 3, "unsaid, the history's count stands");
    // The chat from then on holds the turn once. A turn elsewhere, and back:
    const later = [...retried.slice(0, 3), { role: "assistant", content: "Fixed." }, { role: "user", content: "a turn elsewhere" }, { role: "assistant", content: "its answer" }, { role: "user", content: "back here" }];
    const back = sent("anthropic", later, again.userTurns);
    assert.match(back.promptText, /^Meanwhile, this conversation continued with another assistant[^]*### User\na turn elsewhere\n\n### Assistant\nits answer\n\n---\nLatest user message:\n\nback here$/);
    assert.equal(sent("anthropic", later, 3).promptText, "back here", "counted as two, the turn elsewhere was never handed over");
  });
  // (fails before: yes — a user message that only answers tool calls counted as a turn of the person's: after a turn
  // with tool calls, an agent was sent its own turn back as "another assistant's")
  test("tool results are no turn of the person's: an agent that saw its own turn is sent the new message alone", () => {
    const anthropic = [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "t1", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "hello agent" }, { type: "text", text: "<system-reminder>a note</system-reminder>" }] },
      { role: "assistant", content: "Done." },
      { role: "user", content: "and again" },
    ];
    const openai = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Reading.", tool_calls: [{ id: "t1", type: "function", function: { name: "read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "t1", content: "hello agent" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "and again" },
    ];
    for (const [format, messages] of /** @type {const} */ ([["anthropic", anthropic], ["openai", openai]]))
      assert.deepEqual(sent(format, messages, 1), { promptText: "and again", userTurns: 2, command: false, steered: false, skipped: false, held: [], notes: [] }, format);
    // A turn of the person's that another model answered is still handed over.
    const missed = sent("anthropic", [...anthropic.slice(0, 4), { role: "user", content: "a turn elsewhere" }, { role: "assistant", content: "its answer" }, { role: "user", content: "back here" }], 1);
    assert.equal(missed.userTurns, 3);
    assert.match(missed.promptText, /^Meanwhile, this conversation continued with another assistant[^]*### User\na turn elsewhere\n\n### Assistant\nits answer\n\n---\nLatest user message:\n\nback here$/);
    assert.deepEqual(missed.notes, ["acp: 1 turn(s) handled elsewhere since this session's last turn were included so the agent catches up"]);
  });

  // The agent's last turn as the archive keeps it, the person's words where it took them (AC3-1): with the results
  // before them, two at one place, then a message of their own.
  const steeredTurn = [
    { role: "user", content: "fix the bug" },
    { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "t1", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "the code" }, { type: "text", text: "also the tests" }] },
    { role: "assistant", content: [{ type: "text", text: "Reading the tests." }, { type: "tool_use", id: "t2", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "the tests" }, { type: "text", text: "and the docs" }, { type: "text", text: "now" }] },
    { role: "assistant", content: "Fixed." },
    { role: "user", content: [{ type: "text", text: "one more thing" }] },
    { role: "assistant", content: "Done, the one more thing too." },
  ];
  /** The session that took them: its prompt was the history's first user turn. */
  const took = () => {
    const conv = { seenUserTurns: 1 };
    for (const words of ["also the tests", "and the docs", "now", "one more thing"]) tookWithin(conv, 1, words);
    return conv;
  };
  // (fails before: yes — the words an agent took into its running turn counted as turns it never saw: the next message
  // handed its own turn back to it as "another assistant's", from the first of them on)
  test("the words an agent took into its last turn are its session's: the next message goes alone, a turn elsewhere after them still handed over", () => {
    const alone = sent("anthropic", [...steeredTurn, { role: "user", content: "thanks" }], 1, took());
    assert.deepEqual(alone, {
      promptText: "thanks",
      userTurns: 5,
      command: false,
      steered: false,
      skipped: false,
      held: [],
      notes: ["acp: 3 message(s) sent while the agent's last turn ran are in that turn: the session heard them there, so they are not handed back"],
    });
    const after = sent("anthropic", [...steeredTurn, { role: "user", content: "a turn elsewhere" }, { role: "assistant", content: "its answer" }, { role: "user", content: "back here" }], 1, took());
    assert.match(after.promptText, /^Meanwhile, this conversation continued with another assistant[^]*:\n\n### User\na turn elsewhere\n\n### Assistant\nits answer\n\n---\nLatest user message:\n\nback here$/);
    assert.equal(after.notes[1], "acp: 1 turn(s) handled elsewhere since this session's last turn were included so the agent catches up");
  });

  test("a history that holds none of the words, its turn folded into the answer, counts none: the turn elsewhere is handed over whole", () => {
    const folded = [
      { role: "user", content: "fix the bug" },
      { role: "assistant", content: "[Filament folded this turn: 2 tool calls shown one line each]\nLooking.\nalso the tests\nand the docs\nnow\nFixed.\none more thing\nDone." },
      { role: "user", content: "a turn elsewhere" },
      { role: "assistant", content: "its answer" },
      { role: "user", content: "back here" },
    ];
    const r = sent("anthropic", folded, 1, took());
    assert.equal(r.userTurns, 3);
    assert.match(r.promptText, /^Meanwhile, this conversation continued with another assistant[^]*:\n\n### User\na turn elsewhere\n\n### Assistant\nits answer\n\n---\nLatest user message:\n\nback here$/);
    assert.deepEqual(r.notes, ["acp: 1 turn(s) handled elsewhere since this session's last turn were included so the agent catches up"]);
  });

  test("the words are kept by the turn they went into, in order, blank ones none; counted once", () => {
    /** @type {any} */
    const conv = { seenUserTurns: 4 };
    tookWithin(conv, 4, "  first  ");
    tookWithin(conv, 4, "   ");
    tookWithin(conv, 4, "second");
    assert.deepEqual(conv.within, { after: 4, texts: ["first", "second"] });
    tookWithin(conv, 6, "a later turn's");
    assert.deepEqual(conv.within, { after: 6, texts: ["a later turn's"] }, "a later turn's words start afresh");
    const history = flattenMessages("anthropic", { messages: steeredTurn });
    const mine = took();
    assert.equal(seenWithin(mine, history), 3);
    assert.deepEqual(mine, { seenUserTurns: 4 });
    assert.equal(seenWithin(mine, history), 0, "once");
    assert.equal(seenWithin({ seenUserTurns: null, within: { after: 1, texts: ["also the tests"] } }, history), 0, "a session that saw none counts none");
  });

  // (fails before: yes — a sub-agent's agent hears a note wrapped in whose it is, and the wrapping was what the count
  // looked for: the history holds the words alone, so it found none there)
  test("a steer keeps what the agent took as the archive keeps it — the person's words, where it heard them wrapped — and none it handed back", async () => {
    /** @type {any} */
    const conv = { seenUserTurns: 1 };
    const wrapped = "Your team's lead says (1 message). Acknowledge what you heard in your next reply before acting on it:\n- also the tests";
    assert.equal(await countTaken(conv, 1, async () => true)(wrapped, "also the tests"), true);
    assert.equal(await countTaken(conv, 1, async () => false)("and the docs"), false);
    assert.deepEqual(conv.within, { after: 1, texts: ["also the tests"] });
    assert.equal(seenWithin(conv, flattenMessages("anthropic", { messages: steeredTurn })), 1);
  });
});

describe("the generic card (AC2-3)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  /** A done call's row on the generic card. @param {Record<string, any>} more */
  const row = (more) => roundRows({ round: 1, order: ["g1"], tools: new Map([["g1", { id: "g1", name: "think", card: { kind: "other", title: "Running subagent 'codebase_investigator' with inputs: { objective: Map the auth module }", subject: "" }, state: "done", ...more }]]), plan: null })[0];
  /** Its body's labels and blocks, in order. @param {any} el */
  const body = (el) => el.querySelectorAll(".sub-label, .term-cmd, .term-out").map((/** @type {any} */ n) => n.textContent);

  test("its body shows the result it got beside its parameters; parameters it never had are not said", () => {
    const report = "The auth module lives in src/auth.";
    assert.deepEqual(body(row({ args: "", preview: report, chars: 34 })), ["Result", report]);
    assert.deepEqual(body(row({ args: { objective: "Map the auth module" }, preview: report, chars: 34 })), ["Parameters", '{"objective":"Map the auth module"}', "Result", report]);
    assert.deepEqual(body(row({ args: "" })), ["Parameters", "(none)"], "nothing came back: what it took is all there is to show");
    assert.equal(row({ args: "", preview: report, chars: 400 }).querySelector(".pane-note")?.textContent, "Preview of 400 characters. The whole result is in the request.");
  });
});

describe("a plain agent through the app (AC2-3)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  // Made when the tests run, so a run that filters them out leaves no folder behind.
  let root = "";
  let projDir = "";
  let prompts = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-plain-"));
    projDir = join(root, "project");
    prompts = join(root, "prompts.jsonl");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    /** @param {string} permissions @param {Record<string, string>} [env] */
    const acp = (permissions, env = {}) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env, cwdDefault: projDir, permissions, hints: false });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "plain", name: "plain", type: "acp", acp: acp("allow-all") },
          { id: "late", name: "late", type: "acp", acp: acp("allow-all", { FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_LATE_REPLAY: "1", FAKE_ACP_SLOW_MS: "300", FAKE_ACP_LOG: prompts }) },
        ];
        cfg.routes = ["plain", "late"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /**
   * A harness turn in a new session, as the page sends one, the session's switch at `mode` where one is named: its
   * reply, and its run's id. @param {string} model @param {string} content @param {string | null} [mode]
   */
  const start = async (model, content, mode = null) => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", ...(mode ? { settings: { loop: { permissions: mode } } } : {}) } });
    const id = String((await s.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    assert.equal(res.status, 200);
    return { res, runId: String(res.headers.get("x-filament-request-id")) };
  };
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** The reply's words, its run's events apart. @param {Response} res */
  const wordsOf = async (res) => {
    let words = "";
    for (const { event, data } of parseSse(await res.text())) if (event !== "filament_run" && data?.type === "content_block_delta") words += data.delta?.text ?? "";
    return words;
  };
  /**
   * A harness turn to its end: its words, its run's events, its record.
   * @param {string} model @param {string} content @param {string | null} [mode]
   */
  const turn = async (model, content, mode = null) => {
    const { res, runId } = await start(model, content, mode);
    const words = await wordsOf(res);
    const events = await runEvents(runId);
    const rec = await until(async () => {
      const r = await shim.record(runId);
      return r?.acp?.run ? r : null;
    }, "the turn's record");
    return { words, events, rec, /** @param {string} type */ of: (type) => events.filter((e) => e.type === type) };
  };

  // (fails before: yes — a fetch Gemini CLI titles in words read as its sentence, a read it showed nothing of said
  // "0 chars", and its turn's tokens were estimated)
  test("Gemini CLI's turn: a card for each call, the two it asked about first among them; the tokens its quota says", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const t = await turn("plain/gemini-3-pro-preview", "~gemini go");
    assert.equal(t.words, "Done: the edit made, the tests run.");
    assert.deepEqual(t.of("tool-start").map((/** @type {any} */ e) => [e.id, e.card.title, e.card.subject]), [
      ["read_file-1", "Read", "README.md"],
      ["grep_search-2", "Search", "'TODO' within ./"],
      ["replace-3", "Edit", "README.md"],
      ["run_shell_command-4", "Run", "npm test"],
      ["web_fetch-5", "Fetch", "https://example.com/docs"],
      ["list_issues-6", "mcp__github__list_issues", "mcp__github__list_issues"],
      ["codebase_investigator-7", "Running subagent 'codebase_investigator' with inputs: { objective: Map the auth module }", ""],
      ["read_file-8", "Read", "missing.md"],
    ]);
    assert.deepEqual(t.of("tool-end").map((/** @type {any} */ e) => [e.id, e.ok, e.chars ?? null]), [
      ["read_file-1", true, null],
      ["grep_search-2", true, 13],
      ["replace-3", true, null],
      ["run_shell_command-4", true, 50],
      ["web_fetch-5", true, 30],
      ["list_issues-6", true, 28],
      ["codebase_investigator-7", true, 69],
      ["read_file-8", false, `File not found: ${projDir}/missing.md`.length],
    ]);
    assert.deepEqual([t.rec.estimatedTokens, t.rec.tokens.input, t.rec.tokens.output], [false, 1840, 96]);
    assert.deepEqual(t.rec.acp.modelUsage, [{ model: "gemini-3-pro-preview", input: 1840, output: 96, cacheRead: 0, cacheWrite: 0 }]);
  });

  // (fails before: yes — Qoder's own tool names were not read: its calls were drawn by their kinds, the two it asked
  // about first as a bare "tool")
  test("Qoder's turn: its own tools by name, a result fenced as code read as its code, its plan, its usage", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const t = await turn("plain/qoder-auto", "~qoder go");
    assert.equal(t.words, "Done: the edit made, the tests run.");
    assert.deepEqual(t.of("tool-start").map((/** @type {any} */ e) => [e.id, e.name, e.card.subject]), [
      ["q_todo", "TodoWrite", "3 items"],
      ["q_read", "Read", "README.md"],
      ["q_edit", "Edit", "README.md"],
      ["q_bash", "Bash", "npm test"],
      ["q_grep", "Grep", "TODO"],
    ]);
    const ends = Object.fromEntries(t.of("tool-end").map((/** @type {any} */ e) => [e.id, e]));
    assert.deepEqual([ends.q_read.preview, ends.q_bash.preview], ["hello agent", "# pass 3\n# fail 0"]);
    assert.deepEqual(t.of("plan").map((/** @type {any} */ e) => e.items.map((/** @type {any} */ i) => i.status)), [["doing", "pending", "pending"], ["done", "done", "done"]]);
    assert.deepEqual([t.rec.estimatedTokens, t.rec.tokens.input, t.rec.tokens.output], [false, 2310, 142]);
  });

  // (fails before: yes — a call the permission policy refused was not drawn (Gemini CLI never mentions it again) or was
  // drawn at the agent's failure (Qoder's): nothing said the policy refused it)
  test("under read-only, the calls it asks about are refused and say why; the rest run", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    for (const word of ["~gemini", "~qoder"]) {
      const t = await turn("plain/m", `${word} go`, "read-only");
      assert.equal(t.words, "Done: the edit not made, the tests not run.", word);
      const refused = t.of("tool-end").filter((/** @type {any} */ e) => e.refused).map((/** @type {any} */ e) => [e.card.kind, e.reason, e.chars]);
      assert.deepEqual(refused, [["edit", "this session's read-only mode", 0], ["shell", "this session's read-only mode", 0]], word);
      assert.equal(t.of("tool-start").length, t.of("tool-end").length, `${word}: every card ends`);
      assert.equal(readFileSync(join(projDir, "README.md"), "utf8"), "hello agent\n", word);
    }
  });

  // (fails before: yes — a call Gemini CLI asks about first had no card while the question stood: the question took a
  // card of its own, and a call the person rejected was never drawn)
  test("under Ask, the question stands on the card of the call it is about; the person's Deny ends the call Denied", async () => {
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    const { res, runId } = await start("plain/m", "~gemini go", "ask");
    /** The run's question, once it waits. @param {string} id */
    const asked = (id) => until(async () => (await runEvents(runId)).find((e) => e.type === "ask" && e.id === id) || null, `question ${id}`);
    /** @param {string} id @param {"allow" | "deny"} choice  the loop's card's answer */
    const answer = (id, choice) => shim.api(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body: { ask: id, outcome: "answered", answers: { permission: { chosen: [choice] } } } });
    const edit = await asked("q1");
    assert.deepEqual([edit.kind, edit.call, edit.form.questions[0].choices.map((/** @type {any} */ c) => c.id)], ["permission", "replace-3", ["allow", "deny"]]);
    assert.ok((await runEvents(runId)).some((e) => e.type === "tool-start" && e.id === "replace-3"), "the edit's card is drawn while the question stands");
    assert.equal((await answer("q1", "deny")).status, 200);
    assert.equal((await asked("q2")).call, "run_shell_command-4");
    assert.equal((await answer("q2", "allow")).status, 200);
    assert.equal(await wordsOf(res), "Done: the edit not made, the tests run.");
    const ends = Object.fromEntries((await runEvents(runId)).filter((e) => e.type === "tool-end").map((e) => [e.id, e]));
    assert.deepEqual([ends["replace-3"].ok, ends["replace-3"].declined, ends["replace-3"].chars], [false, true, 0]);
    assert.deepEqual([ends["run_shell_command-4"].ok, ends["run_shell_command-4"].preview], [true, "> fake@1.0.0 test\n> node --test\n\n# pass 3\n# fail 0"]);
    assert.equal(readFileSync(join(projDir, "README.md"), "utf8"), "hello agent\n");
  });

  // (fails before: yes — Gemini CLI answers a session/load at once and replays the session after: its replay was read
  // into the turn that followed, the old words in the new reply)
  test("a load whose replay goes on after its answer is waited out: the turn after it reads none of it", async () => {
    /** @param {string} model @param {any[]} messages */
    const chat = async (model, messages) => {
      const r = await shim.post("/v1/chat/completions", { model, messages: [{ role: "system", content: `Working directory: ${projDir}` }, ...messages] }, { "x-filament-conversation": "late" });
      const body = await r.json();
      assert.equal(r.status, 200, JSON.stringify(body));
      return { text: String(body.choices[0].message.content), id: String(r.headers.get("x-filament-request-id")) };
    };
    await chat("late/m1", [{ role: "user", content: "first" }]);
    const moved = await chat("late/m2", [{ role: "user", content: "first" }, { role: "assistant", content: "ok" }, { role: "user", content: "~slowstart then" }]);
    assert.ok(!moved.text.includes("REPLAYED"), moved.text);
    const rec = await shim.record(moved.id);
    assert.ok((rec.changes || []).some((/** @type {string} */ c) => /^acp: session \w{8} loaded into m2 process$/.test(c)), JSON.stringify(rec.changes));
  });
});
