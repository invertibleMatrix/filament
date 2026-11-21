// @ts-check
// HarnessV3-ACP AC4: what Filament gives a coding agent's session besides the person's words — memory's blocks lifted
// out of its request, the standing context and its updates, the prompt's layout — and Filament's own tools for it,
// whatever the bridge.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { liftMemoryBlocks } from "../src/services/memory/brain.js";
import { agentContext, CODER_GRAPH_TEXT } from "../src/app/agent-context.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import {
  CONTEXT_HEAD,
  UPDATE_HEAD,
  agentCompacted,
  ahead,
  compacted,
  contextState,
  contextUpdate,
  givenNote,
  givenRecord,
  isAgentCommand,
  notHeldIn,
  openedWith,
  said,
  standingFor,
  standingText,
  stateOf,
  withPromptBlocks,
} from "../src/adapters/agents/context.js";
import { composePrompt } from "../src/adapters/agents/acp/prompt.js";
import { DISMISS_WORDS, bodyWithDismiss, goThrough, withDismiss } from "../src/app/agent/still-open.js";
import { flattenMessages } from "../src/core/wire/flatten.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { TASK_CALLS, applyTasks } from "../src/core/task-graph.js";
import { McpToolServer, serverInstructions } from "../src/http/mcp.js";
import { WRITING_REFUSAL } from "../src/adapters/agents/turn-bridge.js";

/** A block as memory places it. @param {string} kind @param {string} text */
const block = (kind, text) => `<filament-memory kind="${kind}">\n${text}\n</filament-memory>`;

describe("memory's blocks, lifted out of an agent's request (AC4-2)", () => {
  test("the system prompt's stand for the session, the newest message's go with its prompt; none is left behind", () => {
    const body = {
      system: [{ type: "text", text: "You are helpful." }, { type: "text", text: block("briefing", "The project uses pnpm.") }],
      messages: [
        { role: "user", content: `first\n\n${block("recall", "an older recall")}` },
        { role: "assistant", content: "ok" },
        { role: "user", content: [{ type: "text", text: `fix the build\n\n${block("recall", "Last time: the lockfile.")}` }] },
      ],
    };
    const { system, newest } = liftMemoryBlocks("anthropic", body);
    assert.deepEqual(system, [{ kind: "briefing", text: "The project uses pnpm." }]);
    assert.deepEqual(newest, [{ kind: "recall", text: "Last time: the lockfile." }]);
    assert.deepEqual(body.system, [{ type: "text", text: "You are helpful." }], "the briefing's part is gone, the client's stays");
    assert.equal(body.messages[0].content, "first", "an older message's block is lifted too, and said nowhere");
    assert.equal(/** @type {any} */ (body.messages[2].content)[0].text, "fix the build");
    const chat = { messages: [{ role: "system", content: `Rules.\n\n${block("goal", "Ship v2")}` }, { role: "user", content: `go\n\n${block("recall", "x")}` }] };
    const lifted = liftMemoryBlocks("openai", chat);
    assert.deepEqual([lifted.system, lifted.newest], [[{ kind: "goal", text: "Ship v2" }], [{ kind: "recall", text: "x" }]]);
    assert.deepEqual(chat.messages.map((m) => m.content), ["Rules.", "go"]);
  });

  test("the context of a turn: memory's blocks stand, each with the words for its going; the graph's words where the session has it", () => {
    const body = { system: `Be brief.\n\n${block("briefing", "B")}\n\n${block("goal", "Ship v2.")}`, messages: [{ role: "user", content: `hi\n\n${block("recall", "R")}` }] };
    const on = agentContext({ format: "anthropic", body: structuredClone(body), graph: true });
    assert.deepEqual(on.standing.map((b) => [b.id, b.tool || null]), [["briefing", null], ["goal", null], ["tasks", "tasks"]]);
    assert.equal(on.standing[0].text, block("briefing", "B"));
    assert.match(String(on.standing[1].gone), /The session's goal no longer stands/);
    assert.equal(on.standing[2].text, `<filament-context kind="tasks">\n${CODER_GRAPH_TEXT}\n</filament-context>`);
    assert.equal(on.standing[2].gone, "Filament's task graph no longer stands for this session: the tasks tool is gone. Carry on as you see fit.");
    assert.deepEqual(on.prompt, [{ id: "recall", text: block("recall", "R") }]);
    const none = agentContext({ format: "anthropic", body: structuredClone(body), graph: false });
    assert.deepEqual(none.standing.map((b) => b.id), ["briefing", "goal"]);
  });

  // (fails before: yes — t417: the agent stood on the goal the system prompt keeps until the chat's next compaction, and
  // was handed a change said on the person's message once, in its prompt)
  test("the goal in force stands in place of the goal memory's blocks carry: the system prompt's pin and a change said on the message", () => {
    const body = { system: `Be brief.\n\n${block("briefing", "B")}\n\n${block("goal", "Ship v1.")}`, messages: [{ role: "user", content: `hi\n\n${block("recall", "R")}\n\n${block("goal", "The session's goal changed.\nShip v2.")}` }] };
    const now = agentContext({ format: "anthropic", body: structuredClone(body), graph: false, goal: "Ship v2." });
    assert.deepEqual(now.standing.map((b) => [b.id, b.text]), [["briefing", block("briefing", "B")], ["goal", block("goal", "Ship v2.")]]);
    assert.match(String(now.standing[1].gone), /The session's goal no longer stands/);
    assert.deepEqual(now.prompt, [{ id: "recall", text: block("recall", "R") }], "the change is said by the goal standing, not in the prompt");
    const closed = agentContext({ format: "anthropic", body: structuredClone(body), graph: false, goal: "" });
    assert.deepEqual(closed.standing.map((b) => b.id), ["briefing"], "a goal closed stands nowhere, whatever the system prompt keeps");
    const unsaid = agentContext({ format: "anthropic", body: structuredClone(body), graph: false });
    assert.deepEqual(unsaid.standing.map((b) => b.id), ["briefing", "goal"], "no goal given: memory's blocks as they are");
    // (fails before: yes — t418: a briefing built after the system prompt went out was handed in the prompt, once)
    const held = { system: "Be brief.", messages: [{ role: "user", content: `hi\n\n${block("briefing", "B2")}` }] };
    const briefed = agentContext({ format: "anthropic", body: structuredClone(held), graph: false, briefing: "B2", goal: "" });
    assert.deepEqual(briefed.standing.map((b) => [b.id, b.text]), [["briefing", block("briefing", "B2")]], "the briefing in force stands");
    assert.deepEqual(briefed.prompt, [], "not in the prompt");
  });

  // (fails before: yes — the owner's of 11-04: "if things needs to be done multiple steps then either todo checklist
  // needs to be created or node of task graph needs to be created"; the graph's words said "Nothing has to go on it", and
  // the agent took a 99-file change and the owner's next asks with no task at all)
  // (fails before: yes — the owner's of 11-08: "any thing task is divided into more than 1 breakable task it either needs
  // to go in checklist or if a task have sub tasks that forms a tree structure then it needs to go in task graph... agents
  // just don't care about checklists and task graphs even with tools available"; the words described the choice, never
  // said it was a rule, never named a tree, and "Just do it — no plan." read as no checklist either)
  test("every planning text says it as a rule: more than one step on the checklist or the graph, never neither, and work that branches on the graph", async () => {
    const { CODER_CHECKLIST_TOOL, CODER_TASKS_TOOL } = await import("../src/app/agent/tools.js");
    const { planAskLine } = await import("../src/core/task-graph.js");
    const { JUST_DO_TEXT } = await import("../src/ui/harness/lib/plan-ask.js");
    const lines = { plan: String(PROMPT.plan), planOrGraph: String(PROMPT.planOrGraph), planOnGraph: String(PROMPT.planOnGraph), coder: CODER_GRAPH_TEXT.split("\n")[1] };
    for (const [name, text] of Object.entries(lines)) {
      assert.match(text, /^Before you start work that breaks into more than one step|^- Before you start work that breaks into more than one step/, `${name}: before it starts, anything past one step`);
      assert.match(text, /never do work of more than one step with(out it| neither)/i, `${name}: never neither`);
      assert.match(text, /only a question you answer straight, or a single step, needs (none|neither)/i, `${name}: what needs none`);
    }
    for (const text of [lines.planOrGraph, lines.planOnGraph, lines.coder, String(PROMPT.graph), CODER_TASKS_TOOL.description, CODER_CHECKLIST_TOOL.description, planAskLine()])
      assert.match(text, /work that branches \(a step with steps of its own\)|work that branches goes on it/i, `a tree goes on the graph: ${text.slice(0, 80)}`);
    for (const text of [String(PROMPT.graph), CODER_GRAPH_TEXT]) assert.match(text, /Just do it skips planning first, never the checklist or the graph/);
    assert.match(CODER_CHECKLIST_TOOL.description, /publish it before you start any work of more than one step/);
    assert.doesNotMatch(JUST_DO_TEXT, /no plan\b/, "the card's go says no planning first, not no checklist");
  });

  test("the graph's words say when to plan and on which: a short job on the agent's todo checklist, a complex one on the graph with what it keeps, a straight answer on neither", () => {
    assert.doesNotMatch(CODER_GRAPH_TEXT, /Nothing has to go on it/);
    const line = CODER_GRAPH_TEXT.split("\n")[1];
    assert.match(line, /^- Before you start work that breaks into more than one step, plan it, and keep the plan up to date as it moves; only a question you answer straight, or a single step, needs none\./);
    assert.match(line, /a note, a file, a whole document: keep\)/, "what the graph keeps that a checklist does not");
    // (fails before: yes — the owner's of 11-05: an agent with no todo tool put a short job's nine tasks on the graph,
    // "simple enough that could have simply used the todo check list"; the words sent a short job there "where you have
    // none", and never said what made work complex)
    // The owner's tool plan of 11-08: Filament gives the agent a checklist of its own, so a short job goes there; since
    // version 105 (the bug hunt of 11-08) no line of a reply stands for it beside "never neither".
    assert.match(line, /Steps you take yourself one after another go on Filament's checklist tool, never as tasks you add: /);
    // (fails before: yes — the nudge map of 11-10, c-mirror: a coding agent's checklist goes on its graph as the loop's
    // does, and the words said it never did)
    assert.match(line, /its items are tasks of yours on this graph, p1, p2, … in the order you first gave them, each moved by its status \(doing starts it, done ends it\), and tasks change adds what pays to one by its id \(a check, needs\)\./);
    assert.match(line, /Work that branches \(a step with steps of its own\) goes on this graph, its steps as sub-tasks under it, and so does work whose pieces need one another or can run side by side, that runs on over many turns or past a compaction, or whose tasks must keep what it needs to go on/);
    assert.doesNotMatch(CODER_GRAPH_TEXT, /as tasks on this graph where you have none/);
    assert.match(String(PROMPT.planOrGraph), /steps you take yourself one after another on the plan tool's checklist; work that branches \(a step with steps of its own\), or whose pieces need one another or can run side by side, runs on over many turns, or keeps notes, files and whole documents behind its tasks, on the tasks tool's graph \(below\)\. Only a question you answer straight, or a single step, needs neither/);
  });
});

describe("the standing context, said once (AC4-1)", () => {
  /** @param {string} id @param {string} text @param {any} [more] */
  const b = (id, text, more = {}) => ({ id, text, ...more });

  test("a session with none hears all of it; then only what changed, and a line for what went", () => {
    const s = contextState();
    const first = [b("briefing", "A"), b("goal", "G", { gone: "The goal is done." })];
    const whole = contextUpdate(s, first);
    assert.deepEqual([whole?.whole, whole?.added, whole?.removed, whole?.text], [true, ["briefing", "goal"], [], `${CONTEXT_HEAD}\n\nA\n\nG`]);
    said(s, first, /** @type {any} */ (whole));
    assert.equal(contextUpdate(s, first), null, "said once: nothing to say again");
    const now = [b("briefing", "A2")];
    const change = contextUpdate(s, now);
    assert.deepEqual([change?.whole, change?.added, change?.removed, change?.text], [false, ["briefing"], ["goal"], `${UPDATE_HEAD}\n\nA2\n\nThe goal is done.`]);
    said(s, now, /** @type {any} */ (change));
    assert.equal(contextUpdate(s, now), null);
    assert.deepEqual(stateOf(JSON.parse(JSON.stringify(s))), s, "kept across a restart");
    assert.deepEqual(stateOf("garbage"), contextState());
  });

  test("a system channel carries it whole from the open; the agent's own compaction loses only what was said ahead of prompts", () => {
    const s = contextState();
    openedWith(s, [b("briefing", "A")]);
    assert.equal(contextUpdate(s, [b("briefing", "A")]), null);
    const added = [b("briefing", "A"), b("goal", "G")];
    const u = contextUpdate(s, added);
    assert.deepEqual([u?.whole, u?.added], [false, ["goal"]]);
    said(s, added, /** @type {any} */ (u));
    compacted(s);
    assert.deepEqual(contextUpdate(s, added)?.added, ["goal"], "said again after the compaction; the system channel's stays");
    const none = contextState();
    said(none, [b("briefing", "A")], /** @type {any} */ (contextUpdate(none, [b("briefing", "A")])));
    compacted(none);
    assert.equal(contextUpdate(none, [b("briefing", "A")])?.whole, true, "an agent with no system channel hears it whole again");
  });

  test("an agent that compacted after the prompt: what the prompt said is not the session's, what went is gone; steering is said again (AC-R4)", () => {
    const blocks = [b("briefing", "A"), b("goal", "G")];
    const s = contextState();
    said(s, blocks, /** @type {any} */ (contextUpdate(s, blocks)), true);
    assert.equal(contextUpdate(s, blocks)?.whole, true, "said again, whole");
    const t = contextState();
    openedWith(t, blocks);
    const less = [b("briefing", "A")];
    said(t, less, /** @type {any} */ (contextUpdate(t, less)), true);
    assert.equal(contextUpdate(t, less), null, "the block that went is gone either way");
    const conv = { given: contextState(), steerSaid: true };
    said(conv.given, blocks, /** @type {any} */ (contextUpdate(conv.given, blocks)));
    agentCompacted(conv);
    assert.deepEqual([contextUpdate(conv.given, blocks)?.whole, conv.steerSaid], [true, false]);
  });

  test("a block about a Filament tool stands only where the session was given the tool; the text, the record and its line", () => {
    const ctx = { standing: [b("briefing", "A"), b("tasks", "T", { tool: "tasks" })], prompt: [] };
    assert.deepEqual(standingFor(ctx, () => false).map((x) => x.id), ["briefing"]);
    assert.deepEqual(standingFor(ctx, (t) => t === "tasks").map((x) => x.id), ["briefing", "tasks"]);
    assert.equal(standingText([]), "");
    assert.equal(givenRecord({ opened: null, update: null, recall: [] }), null);
    const g = /** @type {any} */ (givenRecord({ opened: [b("briefing", "A")], update: { text: "U", added: ["goal"], removed: ["tasks"], whole: false }, recall: [b("recall", "R")] }));
    assert.deepEqual([g.system, g.said, g.recall, typeof g.tokens], [["briefing"], { added: ["goal"], removed: ["tasks"], whole: false }, ["recall"], "number"]);
    assert.equal(
      givenNote("acp", g, "Claude's system prompt"),
      `acp: Filament's context — briefing in Claude's system prompt; ahead of the prompt: goal new or changed, tasks gone; memory's recall after the person's words (~${g.tokens} tokens)`,
    );
  });

  test("an agent's own command is its command only when the agent published it", () => {
    const commands = [{ name: "compact" }, "review"];
    assert.equal(isAgentCommand("/compact keep the tests", commands), true);
    assert.equal(isAgentCommand("  /review", commands), true);
    assert.equal(isAgentCommand("/usr/bin is broken", commands), false);
    assert.equal(isAgentCommand("/compact", undefined), false, "an agent that published none has none");
    assert.equal(isAgentCommand("compact", commands), false);
    assert.equal(withPromptBlocks("hi", []), "hi");
    assert.equal(ahead("", "hi"), "hi");
  });
});

describe("the prompt's layout (AC4-1, AC4-2)", () => {
  const recall = { id: "recall", text: block("recall", "R") };
  /** @param {string} text @param {any} conv @param {any} [more] */
  const compose = (text, conv, more = {}) => {
    const flat = flattenMessages("anthropic", { messages: [{ role: "user", content: text }] });
    /** @type {string[]} */
    const notes = [];
    return composePrompt({ acp: {}, flat, history: [], last: flat[0], conv, reused: false, resumed: false, seeded: false, archSeed: null, notes, ...more });
  };

  test("the update, then the seed's framing, then the person's words, then the recall", () => {
    const r = compose("hello", { turns: 0 }, { seeded: true, archSeed: { text: "### User\nearlier", view: "full", turns: 1, tokens: 5 }, context: { update: { text: "UPD" }, prompt: [recall] } });
    assert.equal(
      r.promptText,
      `UPD\n\n---\nEarlier conversation (from another assistant; continue it, do not repeat it):\n\n### User\nearlier\n\n---\nLatest user message:\n\nhello\n\n${block("recall", "R")}`,
    );
    assert.equal(r.command, false);
  });

  // (fails before: yes — a session that had taken a turn read as steered, so one whose first prompt was the agent's
  // own command was never steered)
  test("an agent's own command goes as typed: no update, recall or steering — they wait for the next prompt", () => {
    const conv = { turns: 0, steering: true, commands: [{ name: "compact" }] };
    const r = compose("/compact", conv, { context: { update: { text: "UPD" }, prompt: [recall] } });
    assert.deepEqual([r.promptText, r.command, r.steered], ["/compact", true, false]);
    conv.turns++; // the command's turn ended, as the bridge counts it
    const next = compose("go on", conv, { context: { update: { text: "UPD" }, prompt: [] } });
    assert.equal(next.steered, true);
    assert.match(next.promptText, /\n\n---\nUPD\n\n---\ngo on$/, "the steering first, then the update, then the words");
  });

  test("steering, said once per session, is said again once the agent compacted its context (AC-R4)", () => {
    const conv = { turns: 3, steering: true, steerSaid: true };
    assert.equal(compose("go on", conv).steered, false, "said once");
    agentCompacted(conv);
    /** @type {string[]} */
    const notes = [];
    assert.equal(compose("go on", conv, { notes }).steered, true);
    assert.deepEqual(notes, ["acp: steering instructions sent again: the agent compacted its context since, and its summary may have dropped them"]);
  });
});

describe("Filament's own tools for a coding agent (AC4-2, AC4-5)", () => {
  const memory = { enabled: () => true, isOpen: () => true, cfg: () => ({}) };
  /** @param {{ memoryOn?: boolean }} [o] */
  const toolsWith = ({ memoryOn = true } = {}) => {
    /** @type {any[]} */
    const applied = [];
    const runner = {
      apply: (/** @type {string} */ chain, /** @type {any} */ input, /** @type {any} */ opts) => {
        applied.push({ chain, input, opts });
        const r = applyTasks(null, input, { at: 1, ...opts });
        return r.ok ? { ok: true, text: r.text, view: { tasks: r.graph?.tasks.length } } : { ok: false, error: r.error };
      },
    };
    return { applied, tools: createAgentTools({ memory, memoryToolsOn: () => memoryOn, graphs: () => runner, turns: createAgentTurns(), subagents: () => null, membersOf: () => null }) };
  };
  const at = { cwd: "C:/p", upstream: "claude", chain: "ch_1", turn: "t_1", graph: true };

  test("the list: memory's while their switch is on, `tasks` where the session was given it", () => {
    const names = (/** @type {any} */ t, /** @type {any} */ ctx) => t.list(ctx).map((/** @type {any} */ x) => x.name);
    const on = toolsWith().tools;
    assert.ok(names(on, at).includes("filament_memory_search"));
    // The owner's tool plan of 11-08: the graph's first, then the checklist, then memory's.
    assert.deepEqual(names(on, at).slice(0, 3), ["tasks", "checklist", "filament_memory_search"]);
    assert.equal(names(on, { ...at, graph: false }).includes("tasks"), false);
    assert.equal(names(on, { ...at, chain: null }).includes("tasks"), false, "no session, no graph");
    assert.deepEqual(names(toolsWith({ memoryOn: false }).tools, at), ["tasks", "checklist"]);
    assert.deepEqual([on.has("tasks"), on.has("checklist"), on.has("filament_memory_search"), on.has("Read")], [true, true, true, false]);
  });

  test("a tasks call is the session's graph's, every task the agent's own; a change is told to the turn", async () => {
    const { applied, tools } = toolsWith();
    /** @type {any[]} */
    const told = [];
    const r = await tools.call("tasks", { action: "add", goal: "ship", tasks: [{ id: "a", name: "A" }] }, { ...at, emit: (ev) => told.push(ev) });
    assert.match(r.text, /^Added a\./);
    assert.deepEqual(applied.map((x) => [x.chain, x.opts]), [["ch_1", { crew: "agent", solo: true, cwd: "C:/p" }]], "the call's folder, where what its tasks change is read (E41 P2 case 11)");
    assert.deepEqual(told, [{ type: "graph", graph: { tasks: 1 } }]);
    const refused = await tools.call("tasks", { action: "add", goal: "ship", tasks: [{ id: "a", name: "A", by: "sub-agent" }] }, at);
    assert.deepEqual([refused.isError, refused.text], [true, `a: by is no field of a task — its fields are id, name, needs, writes, acceptance, check, goal, steps, thread, found_by, under\nThe call: ${TASK_CALLS.add}`]);
  });

  test("refused in words: memory's tools gone off, a session with no graph; an unknown tool is no tool", async () => {
    assert.deepEqual(await toolsWith({ memoryOn: false }).tools.call("filament_memory_search", { query: "x" }, at), { text: "Not run: memory's tools are off in Filament now.", isError: true });
    const { tools, applied } = toolsWith();
    assert.deepEqual(await tools.call("tasks", { action: "show" }, { ...at, graph: false }), { text: "Not run: this session has no task graph.", isError: true });
    assert.equal(applied.length, 0);
    await assert.rejects(tools.call("Read", {}, at), (/** @type {any} */ e) => e.code === -32601);
  });
});

describe("Filament's MCP server for a session given only Filament's own tools", () => {
  /** The server's answer to one request. @param {McpToolServer} mcp @param {any} msg */
  const ask = async (mcp, msg) => {
    const out = { body: "" };
    const res = { writeHead() {}, end(/** @type {any} */ b) { out.body += b || ""; } };
    await mcp.handle({ method: "POST" }, res, "tok", JSON.stringify({ jsonrpc: "2.0", id: 1, ...msg }));
    return JSON.parse(out.body);
  };
  const own = {
    memoryOn: () => true,
    list: () => [{ name: "tasks", description: "the graph", inputSchema: { type: "object" } }],
    has: (/** @type {string} */ n) => n === "tasks",
    call: async () => ({ text: "ok" }),
  };
  const mcpFor = (/** @type {boolean} */ native) =>
    new McpToolServer({ bridge: { contextForMcpToken: () => ({ conv: null, turn: null, cwd: "C:/p", upstream: { id: "codex", acp: {} }, native, chain: "ch_1", graph: true }), hands: { readTextFile: async () => ({ content: "secret" }) } }, tools: own });

  test("its tools are Filament's own, and its words say so", async () => {
    const list = await ask(mcpFor(false), { method: "tools/list" });
    assert.deepEqual(list.result.tools.map((/** @type {any} */ t) => t.name), ["tasks"]);
    const init = await ask(mcpFor(false), { method: "initialize", params: {} });
    assert.equal(
      init.result.instructions,
      "Filament is the harness the person works with you through. While the person has memory on, its memory tools search and keep what the person and earlier sessions learned, and what you learn goes there, not into a memory of your client's own. Its `tasks` keeps this session's task graph. The project folder is C:/p.",
    );
    assert.match((await ask(mcpFor(true), { method: "initialize", params: {} })).result.instructions, /`tasks` keeps this session's task graph\. Its file and shell tools run through the person's chat client, with its permission prompts, or on their machine; their paths are absolute\. The project folder is C:\/p\.$/, "the hands, where the session was given them");
    assert.deepEqual((await ask(mcpFor(false), { method: "tools/call", params: { name: "tasks", arguments: {} } })).result, { content: [{ type: "text", text: "ok" }] });
  });

  // (fails before: yes — a coding agent was never told Filament's command line, which Filament's setup skill tells it to
  // read from its Environment section, a section only the loop's own agent has: the owner's of 11-05)
  test("Filament's command line, where the server knows it, is said as the agent connects", async () => {
    const server = mcpFor(false);
    server.cli = '"C:/Program Files/Filament/bin/filament"';
    assert.match((await ask(server, { method: "initialize", params: {} })).result.instructions, /`tasks` keeps this session's task graph\. Its command line: `"C:\/Program Files\/Filament\/bin\/filament" --help` \(status, models, keys, coding agents, memory, settings\)\. The project folder is C:\/p\.$/);
    assert.doesNotMatch((await ask(mcpFor(false), { method: "initialize", params: {} })).result.instructions, /command line/, "none where it is not known");
  });

  // (fails before: yes — the review of 11-08: the team's and the flow's lines keyed on the session's flags, while each
  // tool is listed only where its chat resolves, so an agent was told of a tool it did not have)
  test("the team's and the flow's tools are named only where the session's list has them", async () => {
    /** @param {string[]} names */
    const server = (names) =>
      new McpToolServer({
        bridge: { contextForMcpToken: () => ({ conv: null, turn: null, cwd: "C:/p", upstream: { id: "codex", acp: {} }, native: false, chain: "ch_1", graph: true, beside: true, flow: true }), hands: { readTextFile: async () => ({ content: "" }) } },
        tools: { ...own, list: () => names.map((name) => ({ name, description: name, inputSchema: { type: "object" } })) },
      });
    const without = (await ask(server(["tasks"]), { method: "initialize", params: {} })).result.instructions;
    assert.ok(!without.includes("`team`") && !without.includes("`flow`"), without);
    const given = (await ask(server(["tasks", "team", "flow"]), { method: "initialize", params: {} })).result.instructions;
    assert.ok(given.includes(" Its `team` sends a team to work beside this chat") && given.includes(" Its `flow` designs a flow"), given);
  });

  // (fails before: yes — the review of 11-08: the words sent a client's own memory away where Filament's memory was off,
  // and the head called the goal the person set and their own rules background)
  test("memory's words hold whether memory is on or off, and the head leaves a block that says otherwise in force", () => {
    const own = serverInstructions({ cwd: "/p" });
    assert.match(own, /^Filament is the harness the person works with you through\. While the person has memory on, its memory tools search and keep what the person and earlier sessions learned, and what you learn goes there, not into a memory of your client's own\./);
    assert.match(CONTEXT_HEAD, /its memory blocks are background, leads to check before you act on them, save where a block says otherwise, and its context blocks are its instructions for this session\./);
  });

  // (fails before: yes — a session never given the hands could still call them by name: Filament's hands read a file for
  // a session that was offered only memory's tools)
  test("the hands are no tool of a session never given them", async () => {
    const r = await ask(mcpFor(false), { method: "tools/call", params: { name: "Read", arguments: { file_path: "C:/p/a.txt" } } });
    assert.deepEqual([r.error?.code, r.result], [-32601, undefined]);
  });

  test("while the agent writes Filament's summary, no tool runs for it, the hands nor Filament's own; the list stays as the agent's cache holds it (HarnessV3-ACP AC5-4)", async () => {
    let ran = 0;
    const mcp = new McpToolServer({
      bridge: { contextForMcpToken: () => ({ conv: null, turn: null, cwd: "C:/p", upstream: { id: "claude", acp: {} }, native: true, chain: "ch_1", graph: true, writing: true }), hands: { readTextFile: async () => (ran++, { content: "secret" }) } },
      tools: { ...own, call: async () => (ran++, { text: "ok" }) },
    });
    const listed = (await ask(mcp, { method: "tools/list" })).result.tools.map((/** @type {any} */ t) => t.name);
    assert.deepEqual([listed.includes("Read"), listed.at(-1)], [true, "tasks"]);
    for (const name of ["tasks", "Read"])
      assert.deepEqual((await ask(mcp, { method: "tools/call", params: { name, arguments: { file_path: "C:/p/a.txt" } } })).result, { content: [{ type: "text", text: WRITING_REFUSAL }], isError: true });
    assert.equal(ran, 0);
  });

  // (fails before: yes — a call its tool refused was logged "error: null", and the console's recent calls said only
  // "failed")
  test("a call its tool refuses is kept with the refusal's words: the log and the console's recent calls say why", async () => {
    /** @type {string[]} */
    const logged = [];
    const said = "Not run: the developer amended your proposal.";
    const mcp = new McpToolServer({
      bridge: { contextForMcpToken: () => ({ conv: null, turn: null, cwd: "C:/p", upstream: { id: "claude", acp: {} }, native: false, chain: "ch_1", graph: true }), hands: {} },
      tools: { ...own, call: async () => ({ text: said, isError: true }) },
      log: (_level, line) => logged.push(line),
    });
    assert.deepEqual((await ask(mcp, { method: "tools/call", params: { name: "tasks", arguments: {} } })).result, { content: [{ type: "text", text: said }], isError: true });
    assert.deepEqual([mcp.hits.at(-1)?.ok, mcp.hits.at(-1)?.error], [false, said]);
    assert.equal(logged.at(-1), `[mcp] tools/call tasks (tok) error: ${said}`);
  });
});

describe("after an agent's compaction during a turn, through the bridge (AC-R4)", () => {
  /** @type {AcpBridge} */
  let bridge;
  let dir = "";
  const sent = () => (existsSync(join(dir, "prompts.jsonl")) ? readFileSync(join(dir, "prompts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).prompt) : []);
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-agent-context-"));
    bridge = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
  });
  after(async () => {
    bridge.shutdown();
    await removeDirs(dir);
  });
  const context = { standing: [{ id: "briefing", text: "The project uses pnpm." }], prompt: [] };
  /** One turn of a chat, its words the newest of `words`. @param {string} chat @param {string[]} words */
  const turn = (chat, words) =>
    bridge.run({
      upstream: { id: "r4", name: "r4", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_LOG: join(dir, "prompts.jsonl") }, cwdDefault: dir, permissions: "allow-all", steering: true, steeringPrompt: "STEER" } },
      modelId: "fake-a",
      format: "anthropic",
      body: { model: "m", max_tokens: 100, messages: words.map((w, i) => ({ role: i % 2 ? "assistant" : "user", content: w })) },
      conversationId: chat,
      headers: {},
      mcpBase: "http://127.0.0.1:9",
      context,
      onEvent: () => {},
    });

  // (fails before: yes — the agent's compaction during the turn reset what Filament had said, then the turn's end marked
  // it said again, and steering was never said twice: the next prompt left out both, though the summary may have
  // dropped them)
  test("the next prompt says the context and the steering again; without a compaction, neither is said twice", async () => {
    await turn("a", ["~compact"]);
    const again = await turn("a", ["~compact", "Going on.", "hello"]);
    await turn("a", ["~compact", "Going on.", "hello", "x", "more"]);
    const [first, second, third] = sent().slice(-3);
    assert.match(first, /^STEER\n\n---\n[^]*The project uses pnpm\./);
    assert.match(second, /^STEER\n\n---\n[^]*The project uses pnpm\./, "said again after the compaction");
    assert.ok(again.notes.includes("acp: steering instructions sent again: the agent compacted its context since, and its summary may have dropped them"), again.notes.join("\n"));
    assert.ok(!third.includes("STEER") && !third.includes("pnpm"), third);
    await turn("b", ["hello"]);
    await turn("b", ["hello", "x", "again"]);
    const [one, two] = sent().slice(-2);
    assert.match(one, /^STEER[^]*pnpm/);
    assert.ok(!two.includes("STEER") && !two.includes("pnpm"), two);
  });
});

// (fails before: yes — the nudge map of 11-10, c-dupes: a fresh session's seed that brought back where the agent stands
// on its graph was followed by the same words in its prompt; Codex's thread takes the seed as its history, and the rule
// is the same)
test("a prompt block that the history going with the prompt says already is left out, by the texts that say the same", () => {
  const where = { id: "where", text: "[Filament: where you are — x]", tool: "tasks", sameAs: ["[Filament: where you are — x]", "[Filament: where you are — x, back]"] };
  const open = { id: "open", text: "[Filament: still open]" };
  assert.deepEqual(notHeldIn([open, where], "SUMMARY\n\n<tasks>\n[Filament: where you are — x, back]\n</tasks>"), { blocks: [open], held: ["where"] });
  assert.deepEqual(notHeldIn([open, where], "SUMMARY"), { blocks: [open, where], held: [] });
  assert.deepEqual(notHeldIn([open, where], ""), { blocks: [open, where], held: [] }, "no history, nothing held");
});

// (fails before: yes — c-dupes: the block kept with Filament's summary asked every reader to dismiss with the envelope
// tool, which a coding agent that neither leads nor launches lacks)
test("the dismiss words go only to a reader with the envelope tool: a kept block's, as the request's messages carry it", () => {
  const block = `[Filament: brought back. ${goThrough("what was open")}]`;
  assert.ok(block.includes(DISMISS_WORDS));
  assert.equal(withDismiss(block, true), block);
  assert.equal(withDismiss(block, false), `[Filament: brought back. ${goThrough("what was open", false)}]`);
  const body = { model: "m", messages: [{ role: "user", content: [{ type: "text", text: block }] }, { role: "assistant", content: "ok" }, { role: "user", content: "next" }] };
  assert.equal(bodyWithDismiss(body, true), body);
  const told = bodyWithDismiss(body, false);
  assert.ok(!JSON.stringify(told).includes("dismiss") && told.messages[2] === body.messages[2], JSON.stringify(told));
  const plain = { messages: [{ role: "user", content: "hi" }] };
  assert.equal(bodyWithDismiss(plain, false), plain, "the same body where nothing changes");
});
