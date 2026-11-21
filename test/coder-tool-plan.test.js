// @ts-check
// The owner's tool plan of 11-08 for a coding agent's tools from Filament (agent-tools.js, agent/tools.js): every text
// free of em dashes and double hyphens, and short enough that Claude Code shows it whole; the tools its session's words
// name loaded whole and the rest held by name; one order, the most used first; the checklist offered to the chat's own
// agent and drawn as the loop's plan is; a sub-agent's short envelope; the saved agents at subagent_type, so the agent
// tool's own text stays the same whoever the session names.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildAgentTools, createAgentTools } from "../src/app/agent-tools.js";
import { coderAgentToolFor, leadToolsOf, teamAgentToolFor } from "../src/app/agent/tools.js";

/** Claude Code 2.1.300 cuts an MCP tool's description past this (CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH's default). */
const CLIENT_CUT = 4096;
/** @type {import("../src/app/agent/tools.js").Askable[]} */
const ASKS = /** @type {any} */ ([{ tag: "product", name: "Product", goodFor: "Weighs a plan against the product.", may: "read" }]);
const MEMBERS = /** @type {any} */ ([
  { tag: "hunter", name: "Hunter", goodFor: "Finds bugs.", line: "", may: "read", card: "hunter" },
  { tag: "fixer", name: "Fixer", goodFor: "Fixes bugs.", line: "", may: "edit", card: "fixer" },
]);

/** Every text of a definition, its description and each field's at any depth, by where it stands. @param {any} def */
const textsOf = (def) => {
  /** @type {[string, string][]} */
  const out = [[`${def.name}`, String(def.description ?? "")]];
  /** @param {any} node @param {string} at */
  const walk = (node, at) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.description === "string") out.push([at, node.description]);
    for (const [k, v] of Object.entries(node.properties || {})) walk(v, `${at}.${k}`);
    if (node.items) walk(node.items, `${at}[]`);
  };
  for (const [k, v] of Object.entries((def.inputSchema ?? def.input_schema)?.properties || {})) walk(v, `${def.name}.${k}`);
  return out;
};

/** Every definition a coding agent's session may be offered: the build's, a launch's agent tool and a lead's of any team. */
const everyDef = () => {
  const lead = /** @type {Record<string, any>} */ (leadToolsOf(MEMBERS) || {});
  return [
    ...buildAgentTools(),
    coderAgentToolFor({ asks: [] }),
    coderAgentToolFor({ asks: ASKS }),
    teamAgentToolFor(ASKS, null),
    ...Object.values(lead),
  ];
};

/** What a session's tools from Filament are made with, every switch the list reads on. */
const TOOLS_DEPS = {
  memory: { enabled: () => true, isOpen: () => true, archive: {} },
  memoryToolsOn: () => true,
  graphs: () => null,
  turns: { get: () => null },
  subagents: () => /** @type {any} */ ({ offer: () => ({ asks: [] }), asks: () => [] }),
  membersOf: () => null,
  artifacts: /** @type {any} */ ({}),
  beside: /** @type {any} */ ({ fires: () => true, on: () => true }),
  thread: /** @type {any} */ ({ starts: () => true, on: () => true }),
  flow: /** @type {any} */ ({ fires: () => true, on: () => true }),
  browsers: () => /** @type {any} */ ({}),
  commands: /** @type {any} */ ({}),
  skills: () => /** @type {any} */ ({ skills: [{ name: "s" }], plugins: [] }),
  craft: /** @type {any} */ ({ of: () => true }),
};
/** A session's tools from Filament, with every switch the list reads on. */
const toolsWith = () => createAgentTools(TOOLS_DEPS);
/** A call's place: the chat's own agent with everything on, or as `more` changes it. @param {Record<string, any>} [more] */
const ctxOf = (more = {}) => /** @type {any} */ ({ cwd: "/p", upstream: "claude-code", chain: "c1", turn: "1", graph: true, launch: true, visuals: true, artifacts: true, beside: true, thread: true, flow: true, browser: true, skills: true, ...more });

describe("a coding agent's tool texts (the owner's tool plan of 11-08)", () => {
  test("no em dash and no double hyphen in any description or field, and each description shown whole", () => {
    const bad = [];
    for (const def of everyDef())
      for (const [at, text] of textsOf(def)) {
        if (/—/.test(text)) bad.push(`${at}: em dash`);
        if (/(^|[^-])--([^-]|$)/.test(text)) bad.push(`${at}: --`);
      }
    assert.deepEqual(bad, []);
    const long = everyDef().filter((d) => String(d.description).length > CLIENT_CUT).map((d) => `${d.name}: ${d.description.length}`);
    assert.deepEqual(long, [], `Claude Code cuts a description past ${CLIENT_CUT} characters`);
  });

  test("the agent tool's own text is the same whoever the session names: the saved agents are said at subagent_type", () => {
    const none = coderAgentToolFor({ asks: [] });
    const named = coderAgentToolFor({ asks: ASKS });
    assert.equal(named.description, none.description);
    const kind = named.input_schema.properties.subagent_type;
    assert.ok(kind.enum.includes("product"));
    assert.match(kind.description, /`product` \(Product\): Weighs a plan against the product \(reads only\)\./);
    assert.doesNotMatch(none.input_schema.properties.subagent_type.description, /saved agents/i);
    // A task whose needs are not done is refused (core/task-graph.js `helperRefusal`): its field says which it takes.
    assert.match(none.input_schema.properties.task.description, /^With a task graph: the id of your task this launch or follow-up works on, one whose needs are done\. /);
  });
});

describe("a coding agent's tool list (the owner's tool plan of 11-08)", () => {
  const MEMORY = ["search", "grep", "load", "sessions", "remember", "correct", "confirm", "close", "forget"].map((n) => `filament_memory_${n}`);
  const HELD = ["visual_guide", "show_visual", "artifact", "team", "thread", "flow", "browser", "skill_craft"];

  test("the chat's own agent: the most used first, memory's reads before its writes, then the tools held by name", () => {
    const list = toolsWith().list(ctxOf());
    assert.deepEqual(
      list.map((t) => t.name),
      ["tasks", "checklist", "filament_recall", "agent", "wait", "envelope", "background_command", "skill", ...MEMORY, ...HELD],
    );
    const whole = list.filter((t) => t.upfront).map((t) => t.name);
    assert.deepEqual(whole, ["tasks", "checklist", "filament_recall", "agent", "wait", "envelope", "background_command", "skill", ...MEMORY], "the session's words name these: each loads whole");
  });

  test("a sub-agent: no checklist, and the short envelope that writes the agent that launched it and answers its letters", () => {
    const list = toolsWith().list(ctxOf({ launch: false, by: { id: "sa_1", exchange: 0 } }));
    const names = list.map((t) => t.name);
    assert.ok(!names.includes("checklist"));
    const env = list.find((t) => t.name === "envelope");
    assert.ok(env?.upfront);
    // (fails before: it offered count and all, which a sub-agent's call refuses — nothing reaches it sealed — and wait,
    // which no call over MCP holds, and left out answer, which a letter asking for a reply names)
    assert.match(String(env?.description), /^Write to the agent that launched you: to "lead"/);
    assert.deepEqual(Object.keys(env?.inputSchema.properties).sort(), ["answer", "reply", "subject", "text", "to"]);
  });

  test("an outside client's agent (no task graph): no checklist, so its client still draws and mirrors its own todo list", () => {
    const names = toolsWith().list(ctxOf({ graph: false, launch: false })).map((t) => t.name);
    assert.ok(!names.includes("checklist"));
    assert.ok(!names.includes("tasks"));
  });

  test("a graph task's sub-agent and a worker: report and ask_lead load whole, after memory's", () => {
    const names = (/** @type {any} */ more) => toolsWith().list(ctxOf({ launch: false, graph: false, ...more }));
    const task = names({ report: true, by: { id: "sa_2", exchange: 0 } });
    assert.ok(task.find((t) => t.name === "report")?.upfront);
    assert.ok(task.findIndex((t) => t.name === "report") > task.findIndex((t) => t.name === "filament_memory_forget"));
    const worker = names({ asksLead: "w1", by: { id: "sa_3", exchange: 0 } });
    assert.ok(worker.find((t) => t.name === "ask_lead")?.upfront);
    assert.ok(!worker.some((t) => t.name === "checklist"));
  });

  test("a team's lead: its tasks, agent, worker and wait load whole", () => {
    const list = toolsWith().list(ctxOf({ launch: false, team: true }));
    const at = (/** @type {string} */ n) => list.find((t) => t.name === n);
    for (const n of ["tasks", "checklist", "agent", "worker", "wait", "envelope"]) assert.ok(at(n)?.upfront, `${n} loads whole`);
    assert.deepEqual(list.slice(0, 7).map((t) => t.name), ["tasks", "checklist", "filament_recall", "agent", "worker", "wait", "envelope"]);
  });
});

describe("Filament's checklist for a coding agent (agent-tools.js)", () => {
  test("drawn on the running turn as the loop's plan is; refused to a sub-agent and outside a turn", async () => {
    const tools = toolsWith();
    /** @type {any[]} */
    const events = [];
    const items = [{ text: "Read the file", status: "done" }, { text: "Fix it", status: "doing" }, { text: "Odd", status: "later" }];
    const r = await tools.call("checklist", { items }, ctxOf({ emit: (/** @type {any} */ e) => events.push(e) }));
    assert.equal(r.text, "Checklist recorded: 3 items (1 done).");
    assert.deepEqual(events, [{ type: "plan", items: [{ text: "Read the file", status: "done" }, { text: "Fix it", status: "doing" }, { text: "Odd", status: "pending" }] }]);
    const sub = await tools.call("checklist", { items }, ctxOf({ by: { id: "sa_1", exchange: 0 }, emit: () => {} }));
    assert.equal(sub.isError, true);
    const none = await tools.call("checklist", { items }, ctxOf({ emit: null }));
    assert.equal(none.isError, true);
    const bare = await tools.call("checklist", {}, ctxOf({ emit: () => {} }));
    assert.equal(bare.isError, true);
    const outside = await tools.call("checklist", { items }, ctxOf({ graph: false, emit: () => {} }));
    assert.equal(outside.isError, true);
    assert.equal(events.length, 1, "only the chat's own agent's call drew one");
    assert.ok(tools.has("checklist"));
  });

  // (fails before: yes — the nudge map of 11-10, c-mirror: a coding agent's checklist answered its count alone, where the
  // loop's goes on its task graph)
  test("on the chat's task graph, from the call's folder, its answer the graph's; a lead's stays off it", async () => {
    /** @type {any[]} */
    const planned = [];
    const runner = { plan: (/** @type {string} */ chain, /** @type {any} */ items, /** @type {any} */ o) => (planned.push([chain, items.length, o]), { text: "Your checklist starts your task graph: p1, p2.", view: { rev: 1 }, changed: true, more: Promise.resolve("p1 changed a.js") }) };
    const tools = createAgentTools({ ...TOOLS_DEPS, graphs: () => /** @type {any} */ (runner) });
    /** @type {any[]} */
    const events = [];
    const items = [{ text: "Read the file", status: "doing" }, { text: "Fix it", status: "pending" }];
    const r = await tools.call("checklist", { items }, ctxOf({ emit: (/** @type {any} */ e) => events.push(e) }));
    assert.equal(r.text, "Checklist recorded: 2 items (0 done). Your checklist starts your task graph: p1, p2.\np1 changed a.js");
    // A coding agent's list, as its tasks calls are (`solo`): its tick's words offer no sub-agent, which its tool refuses.
    assert.deepEqual(planned, [["c1", 2, { cwd: "/p", solo: true }]]);
    assert.deepEqual(events.map((e) => e.type), ["plan", "graph"]);
    const lead = await tools.call("checklist", { items }, ctxOf({ team: true, emit: () => {} }));
    assert.equal(lead.text, "Checklist recorded: 2 items (0 done).");
    assert.equal(planned.length, 1, "a lead's checklist is not on its graph");
  });
});
