// @ts-check
// Claude Code's ToolSearch says what it did (the owner's of 10-31: "when you call ToolSearch the output pill doesn't
// show anything useful in the transcript"). It carded as itself — "ToolSearch", its parameters its own name — and its
// result, the tools it loaded, came as Claude's tool_reference blocks, which no reader took for words: nothing to open.
// It cards as Filament's mcp tool's load and find do — the tools it names, or the words it looks for — and opens on the
// tools it found, live and in a chat opened again.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents, callWords } from "../src/ui/harness/lib/labels.js";
import { archivedRows, roundRows, workSentence } from "../src/ui/harness/conversation/tools/render.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { cardOf, toolsOfTurn } from "../src/core/tool-vocab.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => doc.restore());

// What Claude Code sends, as a session of 10-31 recorded it: the call, and its result — the tools by name, no text.
const LOAD = { query: "select:mcp__filament__envelope,mcp__filament__tasks", max_results: 2 };
const LOADED = [{ type: "tool_reference", tool_name: "mcp__filament__envelope" }, { type: "tool_reference", tool_name: "mcp__filament__tasks" }];
const FOUND = "mcp__filament__envelope\nmcp__filament__tasks";

// (fails before: yes — every query carded { kind: "other", title: "ToolSearch", subject: "ToolSearch" })
test("its card: the tools it loads by name, Filament's by their own names; or the words it looks for", () => {
  assert.deepEqual(cardOf("ToolSearch", LOAD), { kind: "other", title: "Load tools", subject: "envelope, tasks" });
  assert.deepEqual(cardOf("ToolSearch", { query: "select:TaskStop, mcp__github__create_issue" }), { kind: "other", title: "Load tools", subject: "TaskStop, mcp__github__create_issue" });
  assert.deepEqual(cardOf("ToolSearch", { query: "+slack send", max_results: 5 }), { kind: "other", title: "Look for tools", subject: "+slack send" });
});

// (fails before: yes — live, the call's args were "ToolSearch" and its end counted no result: chars 0, no preview)
test("live: the row says the tools it loads, and opens on the tools it found", () => {
  /** @type {any[]} */
  const events = [];
  const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, now: () => 1000, rawMessages: true });
  run.take({ type: "tool", id: "ts1", toolName: "ToolSearch", title: "ToolSearch", kind: "other", status: "pending", rawInput: {} });
  run.take({ type: "raw", message: { type: "assistant", parent_tool_use_id: null, message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "ts1", name: "ToolSearch", input: LOAD }] } } });
  run.take({ type: "raw", message: { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "ts1", content: LOADED }] } } });
  run.take({ type: "tool", id: "ts1", toolName: "ToolSearch", status: "completed", content: [] });
  const start = events.find((e) => e.type === "tool-start");
  const end = events.find((e) => e.type === "tool-end");
  assert.deepEqual([start?.card, start?.args], [{ kind: "other", title: "Load tools", subject: "envelope, tasks" }, "envelope, tasks"]);
  assert.deepEqual([end?.chars, end?.preview], [FOUND.length, FOUND]);
  const [row] = roundRows(alignEvents(events).byRound.get(start.round), { live: true });
  assert.match(row.querySelector("summary")?.textContent || "", /Load tools[\s\S]*envelope, tasks/);
  assert.equal(row.querySelector(".term-out")?.textContent, FOUND, "opened: the tools it found");
});

// (fails before: yes — a chat opened again read its result as no words: the tools it loaded nowhere)
test("a chat opened again: its card, and the tools it found, from the turn's messages", () => {
  const [kept] = toolsOfTurn([
    { role: "assistant", content: [{ type: "tool_use", id: "ts1", name: "ToolSearch", input: LOAD }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "ts1", content: LOADED }] },
  ], "anthropic");
  assert.deepEqual([kept.card, kept.result, kept.resultChars], [{ kind: "other", title: "Load tools", subject: "envelope, tasks" }, FOUND, FOUND.length]);
  const row = /** @type {any} */ (archivedRows([kept])[0]);
  assert.match(row.querySelector("summary")?.textContent || "", /Load tools[\s\S]*envelope, tasks/);
  assert.equal(row.querySelector(".term-out")?.textContent, FOUND);
});

// (fails before: yes — a work row said "Used 2 tools" of them, and the live fold "running ToolSearch")
test("a work row says it loaded tools or looked for them; the live fold, what it loads or looks for", () => {
  const stub = (/** @type {any} */ input) => ({ name: "ToolSearch", state: "done", card: cardOf("ToolSearch", input), args: cardOf("ToolSearch", input).subject });
  assert.equal(workSentence([stub(LOAD), stub({ query: "select:Monitor" })]), "Loaded 3 tools");
  assert.equal(workSentence([stub({ query: "slack" }), stub({ query: "notion pages" })]), "Looked for tools twice");
  assert.equal(callWords({ ...stub(LOAD), state: "running" }), "loading envelope, tasks");
  assert.equal(callWords({ ...stub({ query: "slack send" }), state: "running" }), "looking for tools: slack send");
});
