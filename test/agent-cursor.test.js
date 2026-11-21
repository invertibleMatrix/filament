// @ts-check
// HarnessV3-ACP AC2-2: Cursor's own tools, read and drawn. Over ACP a call names its tool in `rawInput._toolName`, and
// the facts of some come right after its end, in an extension of their own (`cursor/task`, `cursor/update_todos`,
// `cursor/generate_image`). Read into the run: a sub-agent drawn once its prompt is whole, with its kind and the model
// it ran on; the to-do list as Cursor keeps it; an image with the file it saved. Drawn: the image's card. Through the
// app, with the SDK route's, in acp-run.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { createAgentRun } from "../src/app/agent-run.js";
import { createUpdateReader, mergeTodos } from "../src/adapters/agents/acp/updates.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { alignEvents, callWords } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";
import { stubDocument } from "./helpers/dom-stub.js";

const ROOT = resolve("/work/proj");

/** A reader over a recording sink, and the session it keeps Cursor's to-do list on. */
function reader() {
  /** @type {any[]} */
  const events = [];
  /** @type {any} */
  const conv = {};
  const read = createUpdateReader({ out: { tools: [] }, conv, turn: { bridgePlan: () => null }, onEvent: (/** @type {any} */ e) => events.push(e), notes: [] });
  return { read, conv, events };
}
/** A call as Cursor's ACP server opens one. @param {string} id @param {Record<string, any>} more */
const opened = (id, more) => ({ sessionUpdate: "tool_call", toolCallId: id, kind: "other", status: "pending", ...more });
/** @param {string} id @param {Record<string, any>} more */
const updated = (id, more) => ({ sessionUpdate: "tool_call_update", toolCallId: id, ...more });

/** A translator over a recording sink, in ROOT. */
function make() {
  /** @type {any[]} */
  const events = [];
  const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, root: ROOT });
  return { run, events, of: (/** @type {string} */ type) => events.filter((e) => e.type === type) };
}

describe("Cursor's own tools, read (AC2-2)", () => {
  test("the to-do list Cursor keeps: an update that merges changes items by id and adds new ones; else it is the list", () => {
    const first = mergeTodos(undefined, { todos: [{ id: "1", content: "Read", status: "completed" }, { id: "2", content: "Fix", status: "in_progress" }, { id: "x" }], merge: false });
    assert.deepEqual(first, [{ id: "1", content: "Read", status: "completed" }, { id: "2", content: "Fix", status: "in_progress" }], "an item without words is none");
    const merged = mergeTodos(first, { todos: [{ id: "2", content: "Fix", status: "completed" }, { id: "3", content: "Test", status: "pending" }], merge: true });
    assert.deepEqual(merged.map((t) => `${t.id}:${t.status}`), ["1:completed", "2:completed", "3:pending"]);
    assert.deepEqual(first.map((t) => t.status), ["completed", "in_progress"], "the list it was stays as it was");
    assert.deepEqual(mergeTodos(merged, { todos: [{ id: "9", content: "Anew", status: "pending" }] }).map((t) => t.id), ["9"]);
    assert.deepEqual(mergeTodos(first, { todos: [{ content: "No id" }], merge: true }).map((t) => `${t.content}:${t.status}`), ["Read:completed", "Fix:in_progress", "No id:pending"]);
  });

  test("a call names its tool in its input; a sub-agent's end waits for the model its extension names, an image's for its file", () => {
    const { read, events } = reader();
    read(opened("t1", { title: "Task", rawInput: { _toolName: "task", description: "Look" } }));
    read(updated("t1", { status: "completed" }));
    assert.equal(events.length, 1, "its end is held");
    assert.deepEqual(read.ext("cursor/task", { toolCallId: "t1", model: "composer-2.5" }), { outcome: { outcome: "completed" } });
    read(opened("g1", { title: "Generate Image: a cat", rawInput: { _toolName: "generateImage", description: "a cat" } }));
    read(updated("g1", { status: "completed" }));
    assert.deepEqual(read.ext("cursor/generate_image", { toolCallId: "g1", filePath: "/w/cat.png" }), { outcome: { outcome: "generated" } });
    assert.deepEqual(events.map((e) => [e.id, e.status, e.toolName, e.model ?? null, e.file ?? null]), [
      ["t1", "pending", "task", null, null],
      ["t1", "completed", "task", "composer-2.5", null],
      ["g1", "pending", "generateImage", null, null],
      ["g1", "completed", "generateImage", null, "/w/cat.png"],
    ]);
  });

  test("an end whose extension never comes goes out with the agent's next update, or the turn's end", () => {
    const { read, events } = reader();
    read(opened("t1", { rawInput: { _toolName: "task" } }));
    read(updated("t1", { status: "failed" }));
    read({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Next." } });
    assert.deepEqual(events.map((e) => (e.type === "tool" ? `${e.id}:${e.status}` : e.type)), ["t1:pending", "t1:failed", "text"], "before the words after it");
    read(opened("g1", { rawInput: { _toolName: "generateImage" }, status: "completed" }));
    read.flush();
    assert.equal(events.at(-1).id, "g1");
    assert.deepEqual(read.ext("cursor/generate_image", { toolCallId: "g9", filePath: "/x.png" }), { outcome: { outcome: "generated" } }, "a call it holds none of: answered all the same");
    assert.deepEqual(events.filter((e) => e.file), []);
  });

  test("its to-do list: each update is the turn's plan, merged into the session's list, a cancelled item left out", () => {
    const { read, conv, events } = reader();
    read(opened("t1", { rawInput: { _toolName: "task" }, status: "completed" }));
    const answer = read.ext("cursor/update_todos", { toolCallId: "u1", todos: [{ id: "1", content: "Read", status: "completed" }, { id: "2", content: "Drop", status: "cancelled" }], merge: false });
    assert.deepEqual(answer, { outcome: { outcome: "accepted" } });
    read.ext("cursor/update_todos", { toolCallId: "u2", todos: [{ id: "3", content: "Fix", status: "in_progress" }], merge: true });
    assert.deepEqual(events.map((e) => e.type), ["tool", "plan", "plan"], "a held end goes out before the plan");
    assert.deepEqual(events.slice(1).map((e) => e.entries.map((/** @type {any} */ x) => `${x.status}:${x.content}`)), [["completed:Read"], ["completed:Read", "in_progress:Fix"]]);
    assert.deepEqual(conv.todos.map((/** @type {any} */ t) => t.id), ["1", "2", "3"], "the session keeps the list whole, as Cursor does");
  });
});

describe("Cursor's own tools, on the run (AC2-2)", () => {
  test("a sub-agent's card waits for its call to start, when its prompt is whole; its kind, and its model at its end", () => {
    const t = make();
    const task = { _toolName: "task", description: "Look for TODOs", prompt: "Find the TODOs in src", subagentType: "explore" };
    t.run.take({ type: "tool", id: "c1", toolName: "task", title: "Task", kind: "other", status: "pending", rawInput: { _toolName: "task", description: "Look" } });
    t.run.take({ type: "tool", id: "c1", toolName: "task", status: "pending", rawInput: { _toolName: "task", description: "Look for TODOs", prompt: "Find the TO" } });
    assert.deepEqual(t.of("tool-start"), [], "not while its model writes it");
    t.run.take({ type: "tool", id: "c1", toolName: "task", title: "Task: Look for TODOs", status: "in_progress", rawInput: task });
    t.run.take({ type: "tool", id: "c1", toolName: "task", status: "completed", model: "composer-2.5", content: [{ type: "content", content: { type: "text", text: "One TODO." } }] });
    assert.deepEqual(t.of("subagent-start").map((e) => [e.parent, e.description, e.agent, e.prompt]), [["c1", "Look for TODOs", "explore", "Find the TODOs in src"]]);
    assert.deepEqual(t.of("subagent-end").map((e) => [e.parent, e.ok, e.model]), [["c1", true, "composer-2.5"]]);
  });

  test("a sub-agent its agent announces (Cursor's SDK): its kind in a word, a custom one by its name, and its model", () => {
    const t = make();
    t.run.take({ type: "subagent", state: "spawned", id: "s1", call: true, name: "plan the fix", description: "Plan it", kind: { kind: "custom", name: "planner" }, model: "composer-2.5" });
    t.run.take({ type: "subagent", state: "spawned", id: "s2", call: true, name: "look", description: "Look", kind: { kind: "unspecified" } });
    t.run.take({ type: "subagent", state: "spawned", id: "s3", call: true, name: "explore", description: "Explore", kind: "explore" });
    assert.deepEqual(t.of("subagent-start").map((e) => [e.parent, e.agent ?? null, e.model ?? null]), [["s1", "planner", "composer-2.5"], ["s2", null, null], ["s3", "explore", null]]);
  });

  test("an image's card names what it was asked to draw; its end, the file it saved, inside the working folder in its words", () => {
    const t = make();
    t.run.take({ type: "tool", id: "g1", toolName: "generateImage", title: "Generate Image: a cat", kind: "other", status: "pending", rawInput: { _toolName: "generateImage", description: "a cat" } });
    t.run.take({ type: "tool", id: "g1", status: "completed", file: join(ROOT, "img", "cat.png") });
    t.run.take({ type: "tool", id: "g2", toolName: "image_generation", title: "Generate an image", kind: "other", status: "in_progress", rawInput: { prompt: "a dog" } });
    t.run.take({ type: "tool", id: "g2", status: "completed", file: resolve("/elsewhere/dog.png") });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.card.kind, e.card.subject]), [["g1", "image", "a cat"], ["g2", "image", "a dog"]]);
    assert.deepEqual(t.of("tool-end").map((e) => [e.id, e.file]), [["g1", "img/cat.png"], ["g2", resolve("/elsewhere/dog.png")]]);
  });

  test("its tools' cards: a task is a sub-agent, an update of its to-dos a plan, a question an ask, an image an image", () => {
    assert.deepEqual(
      [cardOf("task", { description: "Look" }), cardOf("updateTodos", { todos: [{ content: "a" }, { content: "b" }] }), cardOf("askQuestion", { prompt: "Which?" })].map((c) => [c.kind, c.subject]),
      [["subagent", "Look"], ["todo", "2 items"], ["ask", "Which?"]],
    );
    assert.deepEqual(cardOf("generateImage", { description: "a cat" }), { kind: "image", title: "Generate an image", subject: "a cat" });
  });

  // (fails before: yes — an AskUserQuestion's or askQuestion's card named no question)
  test("a question's card names what it asks: Cursor's by its title, else its first question; Claude's by its first question", () => {
    const db = { id: "db", prompt: "Which database?", options: [] };
    assert.deepEqual([cardOf("askQuestion", { title: "Setup", questions: [db] }).subject, cardOf("askQuestion", { questions: [db] }).subject], ["Setup", "Which database?"]);
    assert.equal(cardOf("AskUserQuestion", { questions: [{ question: "Which database?", header: "Database", options: [] }] }).subject, "Which database?");
  });

  test("a plan proposed for the person to accept: Cursor's by its name, Claude's by its first line (AC2-4)", () => {
    assert.deepEqual(cardOf("createPlan", { name: "Add auth", plan: "# Auth" }), { kind: "proposal", title: "Propose a plan", subject: "Add auth" });
    assert.equal(cardOf("ExitPlanMode", { plan: "\n## Add auth\n1. Sessions" }).subject, "Add auth");
  });
});

describe("Cursor's own tools, drawn (AC2-2)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => {
    doc.restore();
    chipActions.open = null;
    chipActions.readFile = null;
  });
  /** One box's cell of calls. @param {any[]} tools */
  const cellOf = (tools) => ({ round: 1, order: tools.map((t) => t.id), tools: new Map(tools.map((t) => [t.id, t])), plan: null });
  /** What a row's summary says: its kind, its subject, the rest; null for a part it does not draw. @param {any} row */
  const parts = (row) => ["tool-kind", "tool-primary", "tool-secondary"].map((c) => row.querySelector(`.${c}`)?.textContent ?? null);
  /** An image call's stub. @param {string} id @param {Record<string, any>} more */
  const image = (id, more) => ({ id, name: "generateImage", card: cardOf("generateImage", { description: "a red square" }), ...more });
  const settled = () => new Promise((r) => setImmediate(r));

  test("the transcript keeps a call's file and a sub-agent's model; the live fold says an image is being made", () => {
    const a = alignEvents([
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, id: "c1", name: "task", card: cardOf("task", { description: "Look" }) },
      { type: "subagent-start", round: 1, parent: "c1", description: "Look", agent: "explore", prompt: "Find" },
      { type: "subagent-end", round: 1, parent: "c1", status: "done", ok: true, model: "composer-2.5" },
      { type: "tool-end", round: 1, id: "c1", ok: true },
      { type: "tool-start", round: 1, id: "g1", name: "generateImage", card: cardOf("generateImage", { description: "a cat" }) },
      { type: "tool-end", round: 1, id: "g1", ok: true, file: "img/cat.png" },
    ]);
    const tools = a.byRound.get(1).tools;
    assert.deepEqual([tools.get("c1").sub.agent, tools.get("c1").sub.model, tools.get("g1").file], ["explore", "composer-2.5", "img/cat.png"]);
    assert.equal(callWords({ name: "generateImage", card: cardOf("generateImage", { description: "a cat" }) }), "generating an image");
  });

  test("an image's card: what it was asked to draw, then its file and the picture, which opens in the side pane", async () => {
    /** @type {string[]} */
    const paneOpened = [];
    chipActions.open = (p) => void paneOpened.push(p);
    chipActions.readFile = async (p) => (p === "red.png" ? { kind: "image", dataUrl: "data:image/png;base64,AAAA" } : null);
    const running = roundRows(cellOf([image("i0", { state: "running" })]))[0];
    assert.deepEqual(parts(running), ["Generating an image", "a red square", null]);
    assert.equal(running.querySelector(".image-shot"), null, "no picture before its file");
    const row = roundRows(cellOf([image("i1", { state: "done", file: "red.png" })]))[0];
    assert.deepEqual(parts(row), ["Generated an image", "red.png", "a red square"]);
    assert.equal(row.hasAttribute("open"), true, "open: the picture is what it made");
    await settled();
    const img = /** @type {any} */ (row.querySelector("img.code-img"));
    assert.equal(img?.getAttribute("src"), "data:image/png;base64,AAAA");
    img.dispatch("click");
    assert.deepEqual(paneOpened, ["red.png"]);
  });

  // (fails before: no — a guard the mutation pass asked for: no image card had failed)
  test("an image it could not make says so on its card", () => {
    assert.equal(parts(roundRows(cellOf([image("i2", { state: "failed" })]))[0])[0], "Image failed");
  });

  test("an image the files route cannot show is named by its chip, and says why it is not shown", async () => {
    chipActions.readFile = async (p) => {
      if (p === "big.png") return { kind: "binary", note: "image over 5 MB; not previewed" };
      throw new Error("no such file");
    };
    const rows = roundRows(cellOf([image("i2", { state: "done", file: "big.png" }), image("i3", { state: "done", file: "/elsewhere/cat.png" })]));
    await settled();
    assert.deepEqual(rows.map((r) => r.querySelector(".pane-note")?.textContent), ["Not shown: image over 5 MB; not previewed.", "Not shown: the file is outside this session's folder, or gone."]);
    assert.deepEqual(rows.map((r) => parts(r)[1]), ["big.png", "cat.png"]);
  });
});
