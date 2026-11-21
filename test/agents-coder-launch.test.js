// @ts-check
// HarnessV4_Tasks E12 step 2 with E15 step 3, part two: a coding agent's own chat is given Filament's agent and wait —
// its sub-agents on the model a launch names, else as the chat and their cards set them, else on the agent's own model
// (the owner's of 11-06), and the saved
// agents the session lets it ask (V4-D276, AG-66). The
// tool is another per offer, and its words tell it from the agent's own helper tool (AG-67). A launch goes through the
// loop's own door in the registry; one that outlasts the agent's call runs on, and its report comes as a message
// (AG-68), into the running turn or as the wake within the same harness turn (AG-69). A changed offer is a changed
// tool, which the agent's session takes as it opens again (AG-70). An outside client's session is given none.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CONTEXT_HEAD, GRAPH_TOOL, LAUNCH_TOOL, UPDATE_HEAD, givenTools, standingFor, standingText } from "../src/adapters/agents/context.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { agentContext, CODER_GRAPH_TEXT, CODER_PARALLEL_OFF_TEXT, CODER_TRAILER_TEXT, PARALLEL_BLOCK } from "../src/app/agent-context.js";
import { MCP_PATIENCE_MS, createAgentTurns, heldFor } from "../src/app/agent-inbox.js";
import { LAUNCH_BLOCK, LAUNCH_GONE, createLaunchTurn, launchWords } from "../src/app/agent-launch.js";
import { heardBlock, leadWords } from "../src/app/agent-lead.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { PROMPT, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { AGENT_TOOL, CODER_WAIT_TOOL, TEAM_AGENT_TOOL, WAIT_TOOL, agentToolFor, coderAgentToolFor, launchKey } from "../src/app/agent/tools.js";
import { serverInstructions } from "../src/http/mcp.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { askLine } from "../src/core/messages.js";
import { FAKE_ACP_AGENT, FIXTURES, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const root = tmpdir();
/** @type {import("../src/app/agent/tools.js").Askable[]} */
const ASKS = [
  { tag: "pm", name: "PM", goodFor: "Scope, priority and what to leave out.", may: "read", from: null },
  { tag: "designer", name: "Designer", goodFor: "How it reads and feels", may: "read", from: null },
];
/** Parallelize tasks' block while it is off, as it ships (the owner's of 11-14): beside the agent tool's words, graph or none. */
const PARALLEL_OFF = `<filament-context kind="parallel">\n${CODER_PARALLEL_OFF_TEXT}\n</filament-context>`;
/** Its going with the agent tool, in its own words. */
const PARALLEL_OFF_GONE = "Filament no longer holds sub-agents that change files on a card in this session.";
const LINES = "`pm` (PM): Scope, priority and what to leave out (reads only). `designer` (Designer): How it reads and feels (reads only).";
const ANSWER = "Refuse it, and name the limit.";
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
const idIn = (/** @type {any} */ text) => String(/sa_[0-9a-f]{8}/.exec(String(text))?.[0] || "");

// ---------------------------------------------------------------------------------------------------
// The tool, its word, and the words that stand beside it
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — a coding agent's session had no agent tool of Filament's unless its agent led a team)
describe("Filament's agent tool for a coding agent's own chat", () => {
  test("the tool's two kinds, never a fork, one frozen tool per offer", () => {
    const tool = /** @type {any} */ (coderAgentToolFor({ asks: [] }));
    assert.equal(coderAgentToolFor({ asks: [] }), tool, "the same offer sends the same tool");
    assert.ok(Object.isFrozen(tool));
    assert.equal(tool.name, "agent");
    assert.equal(tool.description, `${TOOL_TEXT.coderOwn} ${TOOL_TEXT.coderAgent}`);
    // (fails before: yes — on Claude Code, whose own helper tool is named Agent and takes a subagent_type too, Haiku
    // passed this tool's name to that one as an agent type: the tool's first words now say whose it is, AG-75)
    assert.match(tool.description, /^Filament's own sub-agent tool: call it directly, by this name; it is not a sub-agent tool of your client's own, and this name is never an agent type for one\. It launches one of Filament's sub-agents for one task,/);
    // (fails before: yes — the owner's prompt pass of 11-08: where Claude Code's own sub-agent tool is held back, the
    // tool still told it apart from a helper the session does not have)
    const held = /** @type {any} */ (coderAgentToolFor({ asks: [], held: true }));
    assert.equal(held.description, `${TOOL_TEXT.coderOwnHeld} ${TOOL_TEXT.coderAgent}`);
    assert.notEqual(held, tool, "a frozen tool of its own");
    assert.deepEqual(held.input_schema, tool.input_schema, "the same fields: only whose words differ");
    assert.deepEqual(tool.input_schema.properties.subagent_type.enum, ["builder", "reviewer"]);
    // (fails before: yes — the owner's words of 10-19: there was no context window) Its window is rebuilt, never copied.
    assert.deepEqual(tool.input_schema.properties.context.enum, ["none", "folded", "window"], "its request is not Filament's to copy");
    // (fails before: yes — HarnessV4_Tasks E23: no launch could name its model, its provider or its effort, nor list them)
    assert.deepEqual(Object.keys(tool.input_schema.properties), ["description", "prompt", "subagent_type", "saved_agent", "model", "provider", "effort", "run_in_background", "agent_id", "stop", "apply_changes", "overlap", "mark_applied", "sync", "task", "context", "changes", "attach", "list_models"]);
    // (fails before: yes — the owner's of 11-09: an apply that overlapped the folder's edits was refused with no way on)
    assert.deepEqual(tool.input_schema.properties.overlap, AGENT_TOOL.input_schema.properties.overlap, "the loop's field, in the same words");
    assert.deepEqual(tool.input_schema.properties.overlap.enum, ["markers", "mine", "send_back"]);
    assert.deepEqual(tool.input_schema.properties.effort.enum, ["model", "low", "medium", "high", "xhigh", "max"]);
    // (fails before: yes — the owner's of 11-06: a launch that named no model, in a chat whose Agents tab set none,
    // was refused, though the Reviewer's card said "Same as the main agent")
    assert.match(tool.input_schema.properties.model.description, /Left out: what this chat sets for its kind on its Agents tab, else its card's models, else this chat's list for agents, which is your own model and account where it sets none\./);
    assert.match(tool.input_schema.properties.provider.description, /Left out: the account you run on where it serves that model, else the first that can run it now;/);
    assert.ok(tool.description.length < 2048, "whole where a client cuts a long description (Claude Code: 2,048 characters)");
    assert.notEqual(tool, AGENT_TOOL, "never the loop's own tool");
  });

  test("with agents named beside the model: their tags as kinds, and the loop's words for asking, each with its line", () => {
    const tool = /** @type {any} */ (coderAgentToolFor({ asks: ASKS }));
    // (fails before: yes — whom it may ask stood last, and Claude Code cuts a tool's description at 2,048 characters:
    // with five agents named the list lost its end) The owner's tool plan of 11-08: the tool's own words stay the same
    // whoever the session names, and whom it may ask is said at subagent_type, where one is picked.
    assert.equal(tool.description, `${TOOL_TEXT.coderOwn} ${TOOL_TEXT.coderAgent}`);
    assert.equal(tool.description, /** @type {any} */ (coderAgentToolFor({ asks: [] })).description, "the same words whoever is named");
    assert.ok(tool.description.length < 2048, "whole where a client cuts a long description");
    assert.deepEqual(tool.input_schema.properties.subagent_type.enum, ["builder", "reviewer", "pm", "designer"]);
    assert.ok(tool.input_schema.properties.subagent_type.description.endsWith(` ${TOOL_TEXT.coderAsk} ${LINES}`), "the field lists every agent named, each with its line");
    assert.notEqual(tool, agentToolFor(ASKS), "the loop's and the coding agent's are two tools");
  });

  test("its wait says its reports come with the answer; every offer has a word of its own", () => {
    assert.deepEqual([CODER_WAIT_TOOL.name, CODER_WAIT_TOOL.description, CODER_WAIT_TOOL.input_schema], ["wait", TOOL_TEXT.coderWait, WAIT_TOOL.input_schema]);
    const keys = [launchKey({ asks: [] }), launchKey({ asks: ASKS }), launchKey({ asks: [ASKS[1], ASKS[0]] }), launchKey({ asks: [{ ...ASKS[0], goodFor: "Other." }, ASKS[1]] })];
    assert.equal(new Set(keys).size, keys.length, "who is named, their order and their lines each change the tool");
    assert.ok(keys.every((k) => /^[0-9a-f]{16}$/.test(k)), "never none: the tool stands whatever the session names (E23-D8)");
    assert.equal(launchKey({ asks: ASKS.map((a) => ({ ...a })) }), keys[1], "the same offer is the same word");
  });
});

// (fails before: yes — nothing told the two tools apart, and no block of Filament's context said the tool)
describe("the words that stand in the agent's session", () => {
  test("tell Filament's tool from the agent's own, say what a launch runs on, when to ask where agents are named, and how a late report reaches it (AG-67)", () => {
    const both = launchWords({ asks: ASKS });
    assert.equal(
      both,
      `<filament-context kind="agents">\n${PROMPT.coderAgent}\n${PROMPT.coderAgentModel}\n${PROMPT.agentRecipes}\n${PROMPT.askFirst}\n${PROMPT.agentAsk}\n${PROMPT.coderAgentRules}\n</filament-context>`,
    );
    // (fails before: yes — the owner's prompt pass of 11-08: that Filament's context blocks are its instructions is the
    // head's to say once, and what a launch runs on the tool's model field's, where a launch picks)
    assert.ok(!both.includes("not background") && CONTEXT_HEAD.includes("its context blocks are its instructions for this session"));
    assert.doesNotMatch(PROMPT.coderAgentModel, /Agents tab|card's models/);
    // (fails before: yes — the owner's of 11-08, issues 5 and 6: the words told every client of a helper tool of its own,
    // and Claude Code, its own held back, of one it no longer had)
    assert.equal(PROMPT.coderAgent, "Filament gives you a tool of its own, named agent. Where your client has a sub-agent tool of its own too, they are two tools: call Filament's directly, by its own name in your tool list, and never pass that name to your own tool as an agent type. Where your client holds a tool by name only until you load it, load this one first.");
    assert.equal(
      launchWords({ asks: ASKS, held: true }),
      `<filament-context kind="agents">\n${PROMPT.coderAgentHeld}\n${PROMPT.coderAgentModelHeld}\n${PROMPT.agentRecipes}\n${PROMPT.askFirst}\n${PROMPT.agentAsk}\n${PROMPT.coderAgentRules}\n</filament-context>`,
    );
    assert.ok(!launchWords({ asks: [], held: true }).includes("helper"), "no helper the session does not have");
    // (fails before: yes — the owner's word of 11-05: Filament caps nothing of its own, so no limit of a session's to warn of)
    assert.doesNotMatch(PROMPT.coderAgentRules, /only so many|Past the limit/);
    assert.match(PROMPT.coderAgentRules, /When only waiting is left, end your turn: Filament wakes you with it as your next message, in the same turn of the developer's\.$/);
    // (fails before: yes — the review of 11-08: "as the envelope tool says" pointed at a tool whose words say a result
    // waits sealed, false in a chat that takes results whole, subagents.envelopes)
    assert.match(PROMPT.coderAgentRules, /^A report or an answer reaches you as a message from Filament, or waits sealed for its envelope tool where Filament's line says so\./);
    assert.match(/** @type {any} */ (coderAgentToolFor({ asks: [] })).input_schema.properties.run_in_background.description, /^true: the call answers at once, and the report reaches you as a message from Filament when it finishes, or waits sealed for the envelope tool where Filament's line says so;/);
    const model = launchWords({ asks: [] });
    assert.ok(!model.includes(PROMPT.agentAsk) && !model.includes(PROMPT.askFirst));
    // (fails before: yes — HarnessV4_Tasks E15 step 4, L-85: a coding agent was told what the tool is, never when its
    // sub-agents pay)
    assert.ok(model.includes(`${PROMPT.coderAgentModel}\n${PROMPT.agentRecipes}\n${PROMPT.coderAgentRules}`));
  });

  test("the block stands only in a session given the tool, and says its going", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const offer = { asks: [] };
    const given = agentContext({ format: "anthropic", body: structuredClone(body), graph: false, launch: offer });
    // Parallelize tasks off, as it ships: its block stands with the tool (the owner's of 11-14, parallel-consent.test.js).
    assert.deepEqual(given.standing.map((b) => [b.id, b.text, b.tool]), [[PARALLEL_BLOCK, PARALLEL_OFF, LAUNCH_TOOL], [LAUNCH_BLOCK, launchWords(offer), LAUNCH_TOOL]]);
    assert.deepEqual(given.standing[1], { id: LAUNCH_BLOCK, text: launchWords(offer), held: launchWords({ ...offer, held: true }), gone: LAUNCH_GONE, tool: LAUNCH_TOOL });
    assert.deepEqual(agentContext({ format: "anthropic", body: structuredClone(body), graph: false }).standing, []);
    assert.equal(LAUNCH_BLOCK, "agents");
    assert.match(LAUNCH_GONE, /^Filament's agent tool is gone from this session for now\.$/);
    const has = givenTools({ graph: false, launch: true });
    // (fails before: yes — the turn chose the words before the agent declared, as it starts, the adapter that holds its
    // own sub-agent tool back: on its first turn its tool said it held, its system prompt that it stood beside)
    assert.deepEqual(standingFor(given, has, true).map((b) => b.text), [PARALLEL_OFF, launchWords({ ...offer, held: true })], "a bridge whose agent holds it back says those words");
    assert.deepEqual(standingFor(given, has).map((b) => b.text), [PARALLEL_OFF, launchWords(offer)]);
    assert.deepEqual([has(LAUNCH_TOOL), has(GRAPH_TOOL), has("other")], [true, false, false]);
    assert.deepEqual([givenTools({ graph: true, launch: false })(GRAPH_TOOL), givenTools({ graph: true, launch: false })(LAUNCH_TOOL)], [true, false]);
  });

  test("Filament's server says the tool as the agent connects, in a plain chat given it; a lead's part says when to ask where agents are named", () => {
    // The envelope tool beside its wait is named after it (HarnessV4_Envelopes_Plan EN3), and the background command after
    // that (HarnessV4_Background_Plan BG-D7).
    assert.match(serverInstructions({ cwd: "/w", launch: true }), / Its `agent` tool launches Filament's own sub-agents, or the saved agents the person named, each as its card says\. Where your client has a sub-agent tool of its own, Filament's stands beside it: call it directly, by its own name, which is never an agent type of yours, and use it in place of your own, whose helpers Filament's page and wait know nothing of\. Its `envelope` opens, oldest first, the results other agents sent you that wait sealed: Filament's line names each as it lands\. Its `background_command` runs any command that can take more than a minute, a test suite or a build, while you keep working; its result comes back to you whole, beside your next tool call or as a message from Filament\. The project folder is \/w\.$/);
    assert.match(serverInstructions({ cwd: "/w", launch: true, held: true }), / Its `agent` tool launches Filament's own sub-agents, or the saved agents the person named, each as its card says; your client's own sub-agent tool is off in this session\. Its `envelope`/);
    assert.ok(!serverInstructions({ cwd: "/w" }).includes("`agent` tool"));
    assert.ok(!serverInstructions({ cwd: "/w", launch: true, team: true }).includes("`agent` tool"), "a lead's agent tool is its team's");
    const team = { name: "Architect", persona: "Careful." };
    assert.ok(leadWords(team, { asks: true }).includes(`${PROMPT.ambiguity}\n- ${PROMPT.askFirst}\n${PROMPT.agentAsk}\n`));
    assert.ok(!leadWords(team).includes(PROMPT.agentAsk) && !leadWords(team).includes(PROMPT.askFirst));
  });
});

// ---------------------------------------------------------------------------------------------------
// Filament's tools, as an agent's session lists and calls them
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — the list knew a lead's three tools alone, the lead's with no agent to ask)
describe("the tools a session is given", () => {
  /** @param {{ asks?: any[] }} [offer] */
  const toolsFor = (offer = {}) => {
    const turns = createAgentTurns();
    const now = { asks: offer.asks ?? [] };
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => ({ apply: () => ({ ok: true, text: "solo" }) }), turns, subagents: () => ({ offer: () => now, asks: () => now.asks }), membersOf: () => null });
    return { tools, turns, now };
  };
  const at = { chain: "c1", turn: null, graph: false, report: false, cwd: "/w", upstream: "cli" };

  test("a plain chat given the tool lists agent and wait as its session offers them now; a lead's agent lists whom it may ask", () => {
    const { tools, now } = toolsFor({ asks: ASKS });
    const list = tools.list({ ...at, launch: true });
    // The envelope tool beside the wait (HarnessV4_Envelopes_Plan EN3).
    assert.deepEqual(list.map((t) => t.name), ["agent", "wait", "envelope"]);
    const offered = /** @type {any} */ (coderAgentToolFor(now));
    assert.deepEqual([list[0].description, list[0].inputSchema, list[1].description, list[2].description], [offered.description, offered.input_schema, TOOL_TEXT.coderWait, TOOL_TEXT.envelope]);
    // (fails before: yes — nothing said which tools an agent must hold whole) The envelope loads whole too (the owner's
    // tool plan of 11-08, in place of EN-D15's held name).
    assert.deepEqual(list.map((t) => t.upfront), [true, true, true], "the tools the session's words tell it to call");
    // With the task graph, the graph's tool and Filament's checklist come first, each loaded whole (the same plan).
    assert.deepEqual(tools.list({ ...at, launch: true, graph: true }).map((t) => t.upfront), [true, true, true, true, true]);
    assert.deepEqual(tools.list({ ...at, launch: true, graph: true }).map((t) => t.name), ["tasks", "checklist", "agent", "wait", "envelope"]);
    assert.deepEqual(tools.list(at).map((t) => t.name), [], "a session not given it lists none");
    assert.deepEqual(tools.list({ ...at, launch: true, chain: null }).map((t) => t.name), [], "nor one outside a session");
    now.asks = [];
    // (fails before: yes — HarnessV4_Tasks E23-D8: with nothing named the session lost the tool)
    assert.deepEqual(tools.list({ ...at, launch: true }).map((t) => t.name), ["agent", "wait", "envelope"], "with nobody named it stands: a launch runs on the agent's own model where nothing else names one");
    assert.equal(tools.list({ ...at, launch: true })[0].description, /** @type {any} */ (coderAgentToolFor({ asks: [] })).description);
    now.asks = ASKS;
    const led = tools.list({ ...at, team: true, launch: true });
    assert.deepEqual(led.map((t) => t.name), ["agent", "worker", "wait", "envelope"]);
    assert.deepEqual(led[0].inputSchema.properties.role.enum, ["scout", "builder", "tester", "reviewer", "pm", "designer"]);
    assert.equal(led[2].description, TOOL_TEXT.teamWait, "a lead's wait stays its own");
    now.asks = [];
    assert.deepEqual(tools.list({ ...at, team: true })[0].inputSchema, TEAM_AGENT_TOOL.input_schema);
  });

  test("its calls go to the turn that holds the door, with the agent's patience; with none, in words; a plain chat has no worker", async () => {
    const { tools, turns } = toolsFor();
    assert.deepEqual(await tools.call("agent", {}, { ...at, launch: true }), {
      text: "Not run: Filament holds no turn of the developer's for this session now, so there is nothing to launch from or wait in. A report still owed reaches you with the developer's next message.",
      isError: true,
    });
    assert.deepEqual(await tools.call("worker", {}, { ...at, launch: true }), { text: "Not run: this session's agent leads no team.", isError: true });
    assert.deepEqual(await tools.call("wait", {}, at), { text: "Not run: this session's agent leads no team.", isError: true });
    /** @type {any[]} */
    const calls = [];
    const off = turns.open("c1", /** @type {any} */ ({ call: async (/** @type {string} */ name, /** @type {any} */ input, /** @type {any} */ o) => (calls.push([name, input, o]), { text: `ran ${name}` }) }));
    assert.deepEqual(await tools.call("agent", { prompt: "x" }, { ...at, launch: true, patienceMs: 600_000 }), { text: "ran agent" });
    assert.deepEqual(await tools.call("wait", {}, { ...at, launch: true }), { text: "ran wait" });
    assert.deepEqual(await tools.call("tasks", { action: "show" }, { ...at, launch: true, graph: true }), { text: "solo" }, "its tasks stay its own graph's");
    assert.deepEqual(calls, [["agent", { prompt: "x" }, { patienceMs: 600_000 }], ["wait", {}, { patienceMs: undefined }]]);
    off();
  });
});

// ---------------------------------------------------------------------------------------------------
// The door: a launch, its count, a call that may wait only so long
// ---------------------------------------------------------------------------------------------------

/**
 * A registry whose front door is a scripted host, over the real card store, and a coding agent's turn on it. `max`: a
 * limit set on m-sub across your chats; none, none. `extra`: the registry's context, past the host's own.
 * @param {{ model?: string, ask?: string[], max?: number | null, serve?: ((o: { body: any }) => Promise<string> | string) | null, extra?: Record<string, any> }} [o]
 */
function scripted({ model = "m-sub", ask = ["product", "enduser"], max = null, serve = null, extra = {} } = {}) {
  const cards = createAgentCardStore({ dataDir: null });
  const now = { model, ask, agentOff: false };
  /** @type {any[]} */ const events = [];
  /** @type {string[]} */ const notes = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: { subagents: { slots: max == null ? [] : [{ upstream: "u", model: "m-sub", n: max }] } } }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool: [{ model: now.model }], ask: now.ask }, loop: { permissions: "edit", ...(now.agentOff ? { tools: { agent: false } } : {}) } }),
      modelFacts: (name) => ({ problem: null, limit: null, at: { upstream: "u", model: name } }),
      session: () => ({ cwd: root, model: "coder-1", projectId: "p1" }),
      view: async () => ({ text: "User: fix the parser", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      agentOf: () => null,
      mark: (_chain, m) => ({ ...m, afterTurn: 1 }),
      // The list a launcher reads (E23-D4): what was asked, and each model's seats as the registry says them.
      modelList: async (ask, seats) => `listed ${ask.provider ?? "everyone"}: m-sub — ${seats("m-sub")}`,
      ...extra,
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const report = serve ? await serve({ body }) : ANSWER;
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 0, tokensIn: 100, tokensOut: 10, spentUsd: 0.01, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: root, mode: null, model: "coder-1", thinking: null, fork: null, emit: (e) => events.push(e), round: () => 3 });
  const stop = new AbortController();
  const hangUp = new AbortController();
  /** The agent's own calls Filament's tool calls came in. @type {{ id: string, round: number }[]} */
  const own = [];
  const turn = createLaunchTurn({ registry, door, chainId: "c1", emit: (e) => events.push(e), note: (t) => notes.push(t), mailbox: () => null, signal: hangUp.signal, stopSignal: stop.signal, callOf: async () => own.shift() || null });
  return { registry, turn, events, notes, now, own, stop };
}
/** A launch's answer waits where its question says SLOW. @param {{ promise: Promise<any> }} gate */
const slowBy = (gate) => async (/** @type {{ body: any }} */ { body }) => {
  if (/SLOW/.test(textOf(body.messages.at(-1)))) await gate.promise;
  return ANSWER;
};

// (fails before: yes — a coding agent's plain chat had no door into the registry)
describe("a coding agent's launch goes through the loop's own door", () => {
  test("a quick one: its report is the call's answer with the session's count, its card hangs off the agent's own call, and what it spent is the turn's", async () => {
    const s = scripted();
    s.own.push({ id: "own-1", round: 2 });
    const r = await s.turn.call("agent", { description: "Map it", prompt: "List the files", subagent_type: "reviewer" });
    const id = idIn(r.text);
    assert.equal(r.text, `${ANSWER}\n\n[Filament: sub-agent ${id} — to ask it more in the same context, call agent with agent_id "${id}". 0 running.]`);
    assert.equal(r.isError, undefined);
    const sa = /** @type {any} */ (s.registry.get(id));
    assert.deepEqual([sa.model, sa.card.tag, sa.may, sa.view, sa.origin, sa.background], ["m-sub", "reviewer", "read", "none", "agent", false]);
    const start = s.events.find((e) => e.type === "subagent-start");
    assert.deepEqual([start.parent, start.round, start.agentId], ["own-1", 2, id], "at the round the agent made its call in");
    assert.equal(s.turn.spentUsd(), 0.01);
    assert.match(s.notes[0], new RegExp(`^agent: launched sub-agent ${id} \\(Reviewer, m-sub\\) — finished after 1 round, 0 tool calls$`));
    assert.equal(s.turn.owes(), null, "nothing owed: its report was the call's answer");
  });

  test("a saved agent the session names is asked through the same call; any other word is refused as the loop refuses it", async () => {
    const s = scripted();
    const r = await s.turn.call("agent", { description: "Queue or refuse", prompt: "Queue the fifth launch, or refuse it?", subagent_type: "product" });
    const id = idIn(r.text);
    assert.match(r.text, new RegExp(`^${ANSWER}\\n\\n\\[Filament: Product \\(${id}\\) answered\\. `));
    assert.deepEqual([s.registry.get(id)?.card?.tag, s.events.find((e) => e.type === "subagent-start").parent], ["product", "mcp:1"], "with no call of the agent's seen, the launch still has a card");
    const bad = await s.turn.call("agent", { description: "x", prompt: "y", subagent_type: "watcher" });
    assert.deepEqual([bad.isError, bad.text], [true, "Error: `watcher` is not one you may ask. This session's agent may ask: `product` (Product), `enduser` (End user) — or launch a builder or a reviewer sub-agent."]);
  });

  // (fails before: yes — the call waited as long as the sub-agent ran, past the time an agent lets a call run)
  test("one that outlasts the call runs on: the call says so with the count, the card says nothing of a detach, the turn owes its report, and the report comes as a message (AG-68)", async () => {
    const gate = deferred();
    const s = scripted({ serve: slowBy(gate) });
    const t0 = Date.now();
    const r = await s.turn.call("agent", { description: "Queue or refuse", prompt: "SLOW: queue or refuse?", subagent_type: "product" }, { patienceMs: 0 });
    const id = idIn(r.text);
    assert.ok(Date.now() - t0 >= 900 && Date.now() - t0 < 5_000, "it answered once the call could wait no longer");
    assert.equal(
      r.text,
      `[Filament: Product (${id}) is still thinking, longer than one of your calls may wait: it runs on, and its answer reaches you as a message from Filament. Don't ask it again. Your turn does not end before it answers: carry on, call wait, or end your turn when only waiting is left. To ask it more later, call agent with agent_id "${id}". 1 running.]`,
    );
    assert.equal(r.isError, undefined);
    const view = /** @type {any} */ (s.registry.get(id));
    assert.deepEqual([view.status, view.background, view.detached], ["running", true, null]);
    assert.equal(s.events.some((e) => e.type === "subagent-detached"), false, "the developer detached nothing");
    assert.match(s.notes[0], /longer than its call may wait: it runs on, and its answer comes as a message$/);
    const owed = s.turn.owes();
    assert.ok(owed, "the turn does not end before it answers");
    assert.deepEqual(s.turn.take(), []);
    gate.resolve();
    await owed;
    await s.turn.arrival();
    const [said] = s.turn.take();
    assert.ok(said.includes(ANSWER) && said.includes(`Product (${id})`), said);
    assert.ok(s.events.some((e) => e.type === "subagent-report" && e.agentId === id && e.kind === "report"));
    assert.ok(s.notes.includes("agent: 1 sub-agent message delivered to the agent"));
    assert.equal(s.turn.spentUsd(), 0.01, "what it spent is counted once, with its report");
    assert.equal(s.turn.owes(), null);
  });

  test("a sub-agent that outlasts its call says so in its own words; a launch in the background answers at once", async () => {
    const gate = deferred();
    const s = scripted({ serve: slowBy(gate) });
    const late = await s.turn.call("agent", { description: "Map it", prompt: "SLOW: list the files" }, { patienceMs: 0 });
    const id = idIn(late.text);
    assert.match(late.text, new RegExp(`^\\[Filament: sub-agent ${id} \\("Map it"\\) is still working, longer than one of your calls may wait: it runs on in the background, and its report reaches you as a message from Filament\\. Don't launch its task again\\. `));
    const bg = await s.turn.call("agent", { description: "Read it", prompt: "SLOW: read", subagent_type: "reviewer", run_in_background: true }, { patienceMs: 600_000 });
    assert.match(bg.text, /^Launched sub-agent sa_[0-9a-f]{8} \("Read it"\) in the background\. .* 2 running\.$/);
    gate.resolve();
    await s.turn.owes();
  });

  // (fails before: yes — the owner's of 11-06: with the side list naming none, a launch that named none was refused,
  // E23-D8, though the card said "Same as the main agent": the reviewer went to the account the chat does not run on)
  test("with no model in the side list a launch that names none runs on the agent's own model; one that names a model runs on it; a saved agent is still asked", async () => {
    const s = scripted({ model: "", ask: ["product"] });
    for (const input of [{ description: "x", prompt: "y", subagent_type: "builder" }, { description: "x", prompt: "y", subagent_type: "reviewer" }, { description: "x", prompt: "y" }]) {
      const r = await s.turn.call("agent", input);
      assert.equal(s.registry.get(idIn(r.text))?.model, "coder-1", r.text);
    }
    const named = await s.turn.call("agent", { description: "Map it", prompt: "List the files", subagent_type: "reviewer", model: "m-x" });
    assert.equal(s.registry.get(idIn(named.text))?.model, "m-x", named.text);
    // (fails before: yes — E23-D5: a follow-up that named a model was read as nothing)
    assert.deepEqual(await s.turn.call("agent", { description: "More", prompt: "And the tests?", agent_id: idIn(named.text), model: "m-y", effort: "high" }), {
      text: "Error: a follow-up runs on the model and the effort its launch gave it — leave model and effort out, or launch a new sub-agent",
      isError: true,
    });
    const asked = await s.turn.call("agent", { description: "Queue or refuse", prompt: "Queue or refuse?", subagent_type: "product" });
    assert.match(asked.text, /Product \(sa_[0-9a-f]{8}\) answered\./);
    const again = await s.turn.call("agent", { description: "More", prompt: "And why?", agent_id: idIn(asked.text) });
    assert.match(again.text, /Product \(sa_[0-9a-f]{8}\) answered\./, "a follow-up names no kind");
  });

  // (fails before: yes — the owner's of 11-06: a model named alone was chosen with no word of the account the chat's
  // agent runs on, so the first account in the picker's order ran)
  test("a model named alone is chosen with the chat's own account first", async () => {
    /** @type {(string | null)[]} */
    const seen = [];
    const s = scripted({ extra: { agentOf: (/** @type {string} */ m) => (m === "coder-1" ? "u-coder" : null), chooseModel: async (/** @type {string} */ _name, /** @type {string | null} */ _provider, /** @type {string | null} */ prefer) => (seen.push(prefer), { ok: true, model: "m-x", upstream: "u-coder", note: "" }) } });
    const r = await s.turn.call("agent", { description: "x", prompt: "y", subagent_type: "reviewer", model: "Opus 5.5" });
    assert.deepEqual([seen, s.registry.get(idIn(r.text))?.model], [["u-coder"], "m-x"]);
  });

  // (fails before: yes — the review of f39fac749: a lead's launch and /subagent chose a model named alone with no word
  // of the account the chat's agent runs on)
  test("every launcher's model named alone prefers the account its agent runs on: a lead's own, else its chat's", async () => {
    /** @type {(string | null)[]} */
    const seen = [];
    const s = scripted({ extra: { agentOf: (/** @type {string} */ m) => (m === "coder-1" ? "u-coder" : m === "lead-1" ? "u-lead" : null), chooseModel: async (/** @type {string} */ _name, /** @type {string | null} */ _provider, /** @type {string | null} */ prefer) => (seen.push(prefer), { ok: true, model: "m-x", upstream: "u", note: "" }) } });
    await s.registry.choice({ model: "Opus" }, { model: "lead-1", chainId: "c1" });
    await s.registry.choice({ model: "Opus" }, { chainId: "c1" });
    await s.registry.choice({ model: "Opus" }, { model: "m-api" });
    await s.registry.choice({ model: "Opus" });
    assert.deepEqual(seen, ["u-lead", "u-coder", null, null], "a lead's, else its chat's agent's; an API model's none; no word, none");
  });

  // (fails before: no — a guard for AG-72: the loop's tool switches are the loop's, a coding agent never reads them)
  test("the loop's agent switch is the loop's: the session's offer to a coding agent reads its list alone", async () => {
    const s = scripted();
    const offered = s.registry.offer("c1");
    // (fails before: yes — the owner's of 11-06: the offer held the chat's model for sub-agents, so a change to the
    // Agents tab's list opened the agent's session again for nothing its tool says)
    assert.deepEqual(offered, { asks: offered.asks });
    assert.deepEqual(offered.asks.map((a) => [a.tag, a.name]), [["product", "Product"], ["enduser", "End user"]]);
    s.now.agentOff = true;
    assert.deepEqual(s.registry.offer("c1"), offered);
    assert.match((await s.turn.call("agent", { description: "Queue or refuse", prompt: "Queue or refuse?", subagent_type: "product" })).text, /Product \(sa_[0-9a-f]{8}\) answered\./);
  });

  test("with the side list's model taken away since the session opened, a launch that names none runs on the agent's own model; a worker call is no tool of this session's", async () => {
    const s = scripted();
    s.now.model = "";
    s.now.ask = [];
    const r = await s.turn.call("agent", { description: "x", prompt: "y", subagent_type: "reviewer" });
    assert.equal(s.registry.get(idIn(r.text))?.model, "coder-1", r.text);
    assert.deepEqual(await s.turn.call("worker", { agent_id: "sa_1" }), { text: "Not run: Filament has no worker tool for this session.", isError: true });
  });

  // (fails before: yes — HarnessV4_Tasks E23-D4: nothing listed the models a launch could name)
  test("list_models answers with the models there are, each with its seats, and launches nothing", async () => {
    const s = scripted();
    assert.deepEqual(await s.turn.call("agent", { list_models: true, provider: "OpenRouter" }), { text: "listed OpenRouter: m-sub — on the chat's list" });
    assert.equal(s.registry.list("c1").length, 0, "nothing started");
  });

  // (fails before: yes — a fork asked for failed as "the main agent's turn has sent no request yet")
  test("a fork is refused in words, and a launch that names no view gets its task alone", async () => {
    const s = scripted();
    const r = await s.turn.call("agent", { description: "x", prompt: "y", context: "fork" });
    assert.deepEqual([r.isError, r.text], [true, "Error: a fork copies Filament's own request to its model, and your session has none — leave context out, or choose none, folded, window"]);
    const ok = await s.turn.call("agent", { description: "Map it", prompt: "List the files" });
    assert.equal(s.registry.get(idIn(ok.text))?.view, "none");
    const folded = await s.turn.call("agent", { description: "Map it", prompt: "List the files", context: "folded" });
    assert.equal(s.registry.get(idIn(folded.text))?.view, "folded", "a view it names is the view it gets");
  });

  test("past the limit a launch is refused, naming it; every launch says the count", async () => {
    const gate = deferred();
    const s = scripted({ max: 1, serve: slowBy(gate) });
    const first = await s.turn.call("agent", { description: "One", prompt: "SLOW: one", run_in_background: true });
    assert.match(first.text, /1 running\.$/);
    assert.deepEqual(await s.turn.call("agent", { description: "Two", prompt: "two" }), { text: "Error: The limit is 1 at once, and 1 is running. Wait for one to report.", isError: true });
    gate.resolve();
    await s.turn.owes();
  });
});

// (fails before: yes — a plain chat's agent had no wait of Filament's)
describe("the agent's wait", () => {
  test("answers at once with nothing to wait for; within the agent's patience while one still runs; and with the report the moment it lands", async () => {
    const gate = deferred();
    const s = scripted({ serve: slowBy(gate) });
    assert.deepEqual(await s.turn.call("wait", {}), {
      text: "Nothing to wait for: none of Filament's sub-agents you launched is still running, no agent you asked is still thinking, and none of your background commands runs. A report that already arrived reaches you as a message from Filament.",
    });
    const bg = await s.turn.call("agent", { description: "Queue or refuse", prompt: "SLOW: queue or refuse?", subagent_type: "product", run_in_background: true });
    const id = idIn(bg.text);
    assert.equal(s.turn.waiting(), null);
    const short = s.turn.call("wait", { seconds: 30 }, { patienceMs: 0 });
    assert.ok(s.turn.waiting(), "while it waits, what lands goes to the wait");
    assert.equal((await short).text, "Waited 1 s and nothing arrived; Filament's sub-agents are still running. A wait answers within 1 s here: end your turn when only waiting is left — Filament wakes you with the reports.");
    assert.equal(s.turn.waiting(), null);
    const long = s.turn.call("wait", { seconds: 30 }, { patienceMs: 600_000 });
    gate.resolve();
    const said = (await long).text;
    assert.match(said, /^Waited \d+ s: one message from Filament:\n\n/);
    assert.ok(said.includes(ANSWER) && said.includes(`Product (${id})`), said);
    assert.deepEqual(s.turn.take(), [], "the wait handed it over");
  });

  test("its end: words it took and never heard go back to the session, and the door closes", async () => {
    const gate = deferred();
    const s = scripted({ serve: slowBy(gate) });
    await s.turn.call("agent", { description: "Queue or refuse", prompt: "SLOW: queue or refuse?", subagent_type: "product", run_in_background: true });
    gate.resolve();
    await s.turn.owes();
    await s.turn.arrival();
    assert.equal(s.turn.take().length, 1);
    s.turn.unheard();
    s.turn.close();
    assert.ok(s.notes.includes("agent: 1 message from Filament never reached the agent — its turn ended first — and waits for the session's next turn"), s.notes.join("\n"));
    assert.equal(s.registry.peekQueued("c1").length, 1, "the session's next turn opens with it");
    assert.equal(heldFor(MCP_PATIENCE_MS), 45_000);
  });
});

// ---------------------------------------------------------------------------------------------------
// Through the app, on a coding agent over the bridge
// ---------------------------------------------------------------------------------------------------

describe("through the app", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let folder;
  /** @type {string} */ let logs;
  let gate = deferred();

  /** @param {any} b */
  const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
  /** A JSONL file's lines, parsed. @param {string} file */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** The fake agent's prompt that carries `marker`. @param {string} marker */
  const promptWith = (marker) => lines(join(logs, "prompts.jsonl")).find((p) => String(p.text).includes(marker)) || null;
  const promptsOf = (/** @type {string} */ sessionId) => lines(join(logs, "prompts.jsonl")).filter((p) => p.sessionId === sessionId);
  /** What a session opened with, newest first. @param {string} sessionId */
  const opens = (sessionId) => lines(join(logs, "calls.jsonl")).filter((c) => ["session/new", "session/load", "session/resume"].includes(c.method) && c.sessionId === sessionId);
  /** @param {any} settings @param {string} [model] */
  const newSession = async (settings, model = "coder-1") => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model, preset: "plain", settings } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A harness turn, answered whole. @param {string} id @param {string} content */
  const whole = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    const json = await r.json();
    const text = (json.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
    return { status: r.status, json, text, id: String(r.headers.get("x-filament-request-id")) };
  };
  const runEvents = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  const subagentsOf = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents;
  const notesOf = async (/** @type {string} */ id) => {
    const rec = await shim.record(id);
    return { rec, notes: [...(rec.priorChanges || []), ...(rec.changes || [])].map(String) };
  };
  /** @param {string} url @param {string} method @param {any} [params] */
  const mcp = async (url, method, params = {}) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
  const toolsAt = async (/** @type {string} */ url) => (await mcp(url, "tools/list")).tools;

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-coder-launch-"));
    logs = mkdtempSync(join(tmpdir(), "filament-coder-launch-logs-"));
    writeFileSync(join(folder, "a.txt"), "one\n");
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const say = (/** @type {string} */ text) => anthropicReply("", { model: String(b.model || ""), stop: "end_turn", blocks: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
      // Filament's sub-agents, on the loop: each reports at once, but the one told to hold.
      if (sysOf(b).includes(String(PROMPT.subagentRole))) {
        if (JSON.stringify(b.messages || []).includes("HOLD")) await gate.promise;
        return say("SUB REPORT: a.txt");
      }
      return say("MODEL ANSWER");
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg, { dataDir }) => {
        const agent = (/** @type {string} */ id, /** @type {Record<string, string>} */ env) => ({
          id,
          name: id,
          type: "acp",
          enabled: true,
          acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), ...env }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" },
        });
        // `cli` as Claude's adapter is: its system prompt takes Filament's words. `plain` has no such channel.
        const CLI = agent("cli", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SESSION_CAPS: "resume,close" });
        // `steerer` takes words while it works; `slow` takes none, and its `~slowtool` runs until the gate's file is there.
        const STEERER = agent("steerer", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_STEERING: "1", FAKE_ACP_QUEUE_GATE: join(logs, "gates") });
        const SLOW = agent("slow", { FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_TOOL_GATE: join(logs, "tool-gate") });
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }, CLI, agent("deaf", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "none" }), agent("plain", { FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SESSION_CAPS: "resume,close" }), STEERER, SLOW];
        cfg.routes = [
          { match: "steerer-*", upstream: "steerer", upstreamModel: "{model}", enabled: true },
          { match: "slow-*", upstream: "slow", upstreamModel: "{model}", enabled: true },
          { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
          { match: "deaf-*", upstream: "deaf", upstreamModel: "{model}", enabled: true },
          { match: "plain-*", upstream: "plain", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
  });
  after(async () => {
    gate.resolve();
    await shim.stop();
    await up.close();
    for (const dir of [folder, logs, shim.dataDir]) rmSync(dir, { recursive: true, force: true });
  });

  /** A side agent's answer, kept with the developer, in a session that names nothing for its agent. @param {string} model */
  const keptAnswer = async (model) => {
    const id = await newSession({}, model);
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "List the files", description: "Side look", model: "m-1", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const sa = await until(async () => (await subagentsOf(id)).find((/** @type {any} */ s) => s.status !== "running") || null, "the side agent to answer");
    assert.deepEqual([sa.exchanges[0].delivery, sa.model], ["held", "m-1"]);
    return { id, sa };
  };
  const sendNow = async (/** @type {string} */ id, /** @type {string} */ sid) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${sid}/send`, { method: "POST", body: { when: "now" } });
    return [r.status, (await r.json()).into];
  };
  const queuedOf = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).queued;

  // (fails before: yes — HarnessV4_Tasks E15 step 5 (BW-8, case 20): a coding agent's turn held a door into the registry
  // only where its session named a model for Filament's sub-agents or someone to ask. In any other session a report sent
  // while the agent worked answered `into: "queue"` and waited on the session for the next turn)
  test("Send, now, in a plain coding agent's turn: the report goes into the turn that runs, where the agent takes words while it works", async () => {
    const { id, sa } = await keptAnswer("steerer-1");
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~steerable plain now", stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const first = await until(() => promptWith("~steerable plain now"), "the agent to work");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "round-start"), "its round");
    assert.deepEqual(await sendNow(id, sa.id), [200, "turn"]);
    await until(() => lines(join(logs, "calls.jsonl")).some((c) => c.method === "queued prompt" && String(c.words).includes(`the report of sub-agent ${sa.id}`)), "the report to be queued at the agent");
    assert.match(await res.text(), /heard:\[Filament: the developer is passing you the report of sub-agent sa_[0-9a-f]{8} /);
    const { notes } = await notesOf(runId);
    assert.ok(notes.includes("acp: 1 message from Filament went into steerer's running turn"), notes.join("\n"));
    // (fails before: yes — HarnessV4_Tasks E23-D8: a session that named nothing gave its agent no tool of Filament's)
    assert.ok(notes.includes("acp: Filament's agent and wait are steerer's for this turn: sub-agents on the model each launch names, else this chat's and their cards', else steerer's own"), notes.join("\n"));
    assert.equal(promptsOf(first.sessionId).length, 1, "no prompt of its own: the report went into the one running");
    assert.equal(await queuedOf(id), 0);
    const report = (await runEvents(runId)).find((e) => e.type === "subagent-report");
    assert.deepEqual([report?.agentId, report?.sent], [sa.id, true], "said on the turn's run, as the loop says a sent report");
  });

  // (fails before: yes — the same: it waited for the developer's next message)
  test("Send, now, at a coding agent that takes no words while it works: the report wakes it before its turn ends, as its next prompt", async () => {
    const { id, sa } = await keptAnswer("slow-1");
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~slowtool plain now", stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const first = await until(() => promptWith("~slowtool plain now"), "the agent to work");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "tool-start"), "its command to run");
    assert.deepEqual(await sendNow(id, sa.id), [200, "turn"]);
    writeFileSync(join(logs, "tool-gate"), "");
    await res.text();
    const prompts = promptsOf(first.sessionId);
    assert.equal(prompts.length, 2, "the developer's prompt, then the wake");
    assert.ok(prompts[1].text.includes(`the report of sub-agent ${sa.id}`) && prompts[1].text.includes("SUB REPORT: a.txt"), prompts[1].text);
    const { notes } = await notesOf(runId);
    assert.ok(notes.includes("acp: slow woken in the same turn: 1 message from Filament"), notes.join("\n"));
    assert.equal(await queuedOf(id), 0);
  });

  // (fails before: no — a guard: with a door in every turn, a report sent for the next message must still stay out)
  test("Send, with my next message, in a plain coding agent's turn: the turn ends without it, and the next message carries it", async () => {
    const { id, sa } = await keptAnswer("slow-1");
    rmSync(join(logs, "tool-gate"), { force: true });
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "~slowtool plain next", stream: true, runEvents: true } });
    const first = await until(() => promptWith("~slowtool plain next"), "the agent to work");
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${sa.id}/send`, { method: "POST", body: { when: "next" } });
    assert.deepEqual([r.status, (await r.json()).into], [200, "queue"]);
    writeFileSync(join(logs, "tool-gate"), "");
    await res.text();
    assert.deepEqual([promptsOf(first.sessionId).length, await queuedOf(id)], [1, 1], "the turn ended on its one prompt; the report waits");
    const next = await whole(id, "and now this");
    assert.equal(next.status, 200, JSON.stringify(next.json));
    const carried = /** @type {any} */ (promptWith("and now this"));
    assert.ok(carried.text.includes(`the report of sub-agent ${sa.id}`), carried.text);
    assert.equal(await queuedOf(id), 0);
  });

  // (fails before: yes — a coding agent's plain chat was given no tool of Filament's that launches)
  test("a chat on a coding agent whose session names a model: Filament's agent and wait reach it over MCP, its words stand in the session, and a launch runs on that model, its report the call's answer", async () => {
    const id = await newSession({ subagents: { pool: [{ model: "m-1", seats: 4 }] } });
    const t = await whole(id, `~mcpcall agent ${JSON.stringify({ description: "Map the folder", prompt: "List the files", subagent_type: "reviewer" })}`);
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.match(t.text, /mcp:SUB REPORT: a\.txt\n\n\[Filament: sub-agent sa_[0-9a-f]{8} — to ask it more in the same context, call agent with agent_id "sa_[0-9a-f]{8}"\. 0 running\.\]/);

    const first = /** @type {any} */ (promptWith("~mcpcall agent"));
    const system = String(opens(first.sessionId)[0]?.system || "");
    // (fails before: yes — the owner's list of 11-08, issues 5 and 6: Claude Code, its own sub-agent tool held back, was
    // told of a helper beside Filament's; on its first turn the words were chosen before it declared its adapter)
    assert.ok(system.includes(launchWords({ asks: [], held: true })), "the words for an agent whose own sub-agent tool is held back rode its system channel");
    const listed = await toolsAt(first.mcpUrl);
    const names = listed.map((/** @type {any} */ x) => x.name);
    assert.ok(names.includes("agent") && names.includes("wait") && !names.includes("worker"), names.join(", "));
    assert.equal(listed.find((/** @type {any} */ x) => x.name === "agent").description, `${TOOL_TEXT.coderOwnHeld} ${TOOL_TEXT.coderAgent}`, "its tool says the same");
    // (fails before: yes — Claude Code holds a server's tools by name until the model looks one up, and held these so:
    // the list now marks the two to load whole, in the words that client reads, and no other) — and the background
    // command, whose words say when to use it (HarnessV4_Background_Plan BG-D7); and filament_recall, which a fresh
    // session's words name (the hunt of carry-recall). The owner's tool plan of 11-08: the graph's, the checklist, the
    // envelope and memory's load whole too, in the plan's order.
    const loadWhole = ["tasks", "checklist", "filament_recall", "agent", "wait", "envelope", "background_command", "skill", ...["search", "grep", "load", "sessions", "remember", "correct", "confirm", "close", "forget"].map((n) => `filament_memory_${n}`)];
    assert.deepEqual(listed.filter((/** @type {any} */ x) => x._meta).map((/** @type {any} */ x) => [x.name, x._meta]), loadWhole.map((n) => [n, { "anthropic/alwaysLoad": true }]));
    assert.ok(listed.every((/** @type {any} */ x) => !("upfront" in x)), "Filament's own word for it stays inside");
    assert.match((await mcp(first.mcpUrl, "initialize", {})).instructions, /Its `agent` tool launches Filament's own sub-agents, or the saved agents the person named, each as its card says; your client's own sub-agent tool is off in this session\./);

    const [sa] = await subagentsOf(id);
    assert.deepEqual([sa.model, sa.card.tag, sa.status, sa.origin], ["m-1", "reviewer", "done", "agent"]);
    assert.equal(promptsOf(first.sessionId).length, 1, "nothing was owed: the turn is one prompt");
    const { rec, notes } = await notesOf(t.id);
    assert.ok(notes.includes("acp: Filament's agent and wait are cli's for this turn: sub-agents on the model each launch names, else this chat's and their cards', else cli's own"), notes.join("\n"));
    assert.ok(notes.some((n) => new RegExp(`^agent: launched sub-agent ${sa.id} \\(Reviewer, m-1\\) — finished after`).test(n)), notes.join("\n"));
    assert.equal(rec.acp.team, undefined, "it leads no team");
    // On its run: the sub-agent's card hangs off the agent's own call, and what it spent is the turn's.
    const events = await runEvents(t.id);
    const call = events.find((e) => e.type === "tool-start" && e.name === "agent");
    assert.ok(call, "the agent's own call of Filament's tool, drawn on its run");
    assert.deepEqual(events.filter((e) => e.type === "subagent-start").map((e) => [e.parent, e.agentId, e.model]), [[call.id, sa.id, "m-1"]]);
    assert.ok(events.at(-1).summary.childCostUsd > (rec.cost || 0), "the turn's cost counts what its sub-agent spent");
  });

  // (fails before: yes — nothing held a coding agent's turn for a report of Filament's, and nothing woke it)
  test("a launch in the background: the agent's turn does not end before the report, which wakes it as its next prompt in the same turn", async () => {
    gate = deferred();
    const id = await newSession({ subagents: { pool: [{ model: "m-1", seats: 4 }] } });
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~mcpcall agent ${JSON.stringify({ description: "Hold it", prompt: "HOLD then list", run_in_background: true })}`, stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const waiting = await until(async () => (await runEvents(runId)).find((e) => e.type === "turn-state" && e.to === "waiting") || null, "the turn to wait for Filament's sub-agent");
    // (fails before: yes — the owner's of 11-04: the wait was said as "waiting for Filament's sub-agents to report",
    // naming none)
    assert.equal(waiting.why, "waiting for its sub-agent “Hold it” to report", "what it waits for, by name");
    const [running] = await subagentsOf(id);
    assert.deepEqual([running.status, running.background], ["running", true]);
    gate.resolve();
    const said = await res.text();
    assert.match(said, /echo\(2\): /, "its answer to the report is the turn's");
    const first = /** @type {any} */ (promptWith("HOLD then list"));
    const prompts = promptsOf(first.sessionId);
    assert.equal(prompts.length, 2, "the developer's prompt, then the wake");
    assert.ok(prompts[1].text.includes(`sub-agent ${running.id}`) && prompts[1].text.includes("SUB REPORT: a.txt"), prompts[1].text);
    const { notes } = await notesOf(runId);
    assert.ok(notes.includes("acp: cli woken in the same turn: 1 message from Filament") && notes.includes("agent: 1 sub-agent message delivered to the agent"), notes.join("\n"));
  });

  // (fails before: yes — the owner's of 11-04: a plain chat's message waited "for Claude Code's next tool call", which
  // never comes between its prompts, so it sat behind the builder the agent waited on for 51 minutes)
  test("a message sent while a plain chat's agent waits on its background sub-agent wakes it at once, the report still owed; the report wakes it again", async () => {
    gate = deferred();
    const id = await newSession({ subagents: { pool: [{ model: "m-1", seats: 4 }] } });
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~mcpcall agent ${JSON.stringify({ description: "Hold it", prompt: "HOLD then list for the note", run_in_background: true })}`, stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    try {
      await until(async () => (await runEvents(runId)).some((e) => e.type === "turn-state" && e.to === "waiting") || null, "the turn to wait for Filament's sub-agent");
      const s = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "why is the turn blocked?" } });
      assert.equal(s.status, 200, await s.clone().text());
      const first = /** @type {any} */ (promptWith("HOLD then list for the note"));
      const heard = await until(() => promptsOf(first.sessionId).find((p) => String(p.text).includes("why is the turn blocked?")) || null, "the message as the agent's next prompt, its sub-agent still running");
      assert.equal(heard.text, heardBlock([{ text: "why is the turn blocked?" }]), "in the words a lead hears one in");
      const [running] = await subagentsOf(id);
      assert.equal(running.status, "running", "the report is still owed");
    } finally {
      gate.resolve();
    }
    const said = await res.text();
    assert.match(said, /echo\(3\): /, "the report woke it again, in the same turn");
    const first = /** @type {any} */ (promptWith("HOLD then list for the note"));
    const prompts = promptsOf(first.sessionId);
    assert.equal(prompts.length, 3, "the developer's prompt, their message, then the report");
    assert.ok(prompts[2].text.includes("SUB REPORT: a.txt"), prompts[2].text);
    const { notes } = await notesOf(runId);
    assert.ok(notes.includes("acp: cli woken in the same turn: 1 of the developer's"), notes.join("\n"));
    // (fails before: yes — an agent that names no model call for its answer went on in the round its last prompt ended
    // in, so the page never saw the message read: "The run ended before reading this")
    const events = await runEvents(runId);
    const readAt = events.findIndex((e) => e.type === "steer-read");
    assert.ok(readAt > 0 && events.slice(readAt).filter((e) => e.type === "round-start").length === 2, "its answer, then the report's, each a round of its own");
  });

  // (fails before: yes — the session's tools never changed with whom it names)
  test("the offer changes between two messages: the agent's session opens again with the tool as it is now (AG-70)", async () => {
    const id = await newSession({ subagents: { ask: ["product"] } });
    const one = await whole(id, `first ~mcpcall agent ${JSON.stringify({ description: "x", prompt: "y", subagent_type: "reviewer" })}`);
    // (fails before: yes — the owner's of 11-06: with no model named on the launch, the chat's list or the card, the
    // launch was refused; the Reviewer's card says "Same as the main agent", so it runs on the chat's own model)
    assert.match(one.text, /mcp:echo\(1\): y\n\n\[Filament: sub-agent sa_[0-9a-f]{8} /, one.text);
    assert.equal((await subagentsOf(id))[0]?.model, "coder-1", "the chat's own model");
    const first = /** @type {any} */ (promptWith("first ~mcpcall"));
    const unnamed = (await toolsAt(first.mcpUrl)).find((/** @type {any} */ x) => x.name === "agent");
    assert.deepEqual(unnamed.inputSchema.properties.subagent_type.enum, ["builder", "reviewer", "product"]);
    assert.ok(String(opens(first.sessionId)[0]?.system || "").includes(PROMPT.agentAsk), "when to ask stands in its session");
    // (fails before: yes — AG-74: whom it may ask stood in its session's words alone, far behind the message it works on)
    assert.ok(String(first.text).includes(askLine(["product"])), `whom it may ask rides its prompt: ${first.text}`);
    // (fails before: yes — the line rode ahead of the agent's own command too, and an agent reads one only at the start
    // of its prompt: "/review" would reach it as plain words)
    await whole(id, "/review the diff");
    const own = /** @type {any} */ (promptWith("/review the diff"));
    assert.ok(String(own.text).startsWith("/review the diff") && !String(own.text).includes("[Filament: the developer named saved agents"), `its own command opens its prompt: ${own.text}`);

    const patch = async (/** @type {any} */ body) => assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body })).status, 200);
    // (fails before: yes — the owner's of 11-06: the chat's list for agents rode the tool's words, so a change to it
    // opened the agent's session again; a launch reads the list as it stands now)
    await patch({ patch: { subagents: { pool: [{ model: "m-1", seats: 4 }] } } });
    const two = await whole(id, "second hello");
    const second = /** @type {any} */ (promptWith("second hello"));
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.mcpUrl, first.mcpUrl, `the list is no part of the tool: the session stays as it is\n${(await notesOf(two.id)).notes.join("\n")}`);

    await patch({ patch: { subagents: { ask: [] } } });
    const three = await whole(id, "third hello");
    const third = /** @type {any} */ (promptWith("third hello"));
    const said = (await notesOf(three.id)).notes.join("\n");
    assert.equal(third.sessionId, first.sessionId, `the same session\n${said}`);
    assert.notEqual(third.mcpUrl, second.mcpUrl, "opened again, at a new address for its tools");
    assert.match(said, /resumed again: the task graph, memory's tools, the team it leads, what Filament's agent tool offers it, or the project's Space, changed the tools it takes$/m);
    // (fails before: yes — E23-D8: the tool went with the model)
    assert.deepEqual((await toolsAt(third.mcpUrl)).find((/** @type {any} */ x) => x.name === "agent").inputSchema.properties.subagent_type.enum, ["builder", "reviewer"], "the tool stands, whom it may ask gone");
    assert.ok(String(second.text).includes(askLine(["product"])) && !String(third.text).includes("[Filament: the developer named saved agents"), "the line went with whom it may ask");
    // (fails before: yes — Claude Code records a conversation's system prompt and tool list at its first request and
    // sends that record after a resume, whatever the resume passes: live, a chat whose offer changed went on reading
    // the first in its instructions and in the tool's text. Every open now asks for a prompt read as it stands, AG-77)
    const reopened = opens(third.sessionId).at(-1);
    assert.equal(reopened.method, "session/resume");
    assert.ok(String(reopened.system || "").includes(launchWords({ asks: [], held: true })) && !String(reopened.system || "").includes(PROMPT.agentAsk), "its system prompt, as the session opened again, says the offer as it is now");
    assert.deepEqual(opens(first.sessionId).map((o) => o.snapshot), opens(first.sessionId).map(() => false), "no open leaves a record of its prompt");
  });

  // (fails before: yes — an agent with no system channel was told nothing of Filament's tool, nor of a change to it)
  test("an agent with no system channel reads the words ahead of its first prompt, and again when they change", async () => {
    // The task graph's words (always on) first, then the agent tool's (HarnessV4_AgentTools_Plan AT-D1), then Filament's
    // co-author line, on as it ships (the owner's of 11-10).
    const id = await newSession({ subagents: { pool: [{ model: "m-1", seats: 4 }] } }, "plain-1");
    await whole(id, "plain first");
    const first = /** @type {any} */ (promptWith("plain first"));
    assert.equal(first.prompt, `${CONTEXT_HEAD}\n\n<filament-context kind="tasks">\n${CODER_GRAPH_TEXT}\n</filament-context>\n\n${PARALLEL_OFF}\n\n${launchWords({ asks: [] })}\n\n${CODER_TRAILER_TEXT}\n\n---\nplain first`);
    assert.ok((await toolsAt(first.mcpUrl)).some((/** @type {any} */ x) => x.name === "agent"));
    const patch = async (/** @type {any} */ subagents) => assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { subagents } } })).status, 200);
    await patch({ pool: [{ model: "", seats: 4 }] });
    await whole(id, "plain second");
    const second = /** @type {any} */ (promptWith("plain second"));
    assert.equal(second.sessionId, first.sessionId);
    // (fails before: yes — the owner's of 11-06: the chat's list for agents rode the words, said again on each change)
    assert.equal(second.prompt, "plain second", "the list is no part of the words");
    // (fails before: yes — HarnessV4_Tasks E23-D8: the tool went with the model)
    assert.ok((await toolsAt(second.mcpUrl)).some((/** @type {any} */ x) => x.name === "agent"), "the tool stands");
    await patch({ ask: ["product"] });
    await whole(id, "plain third");
    const third = /** @type {any} */ (promptWith("plain third")).prompt;
    assert.ok(third.startsWith(`${UPDATE_HEAD}\n\n<filament-context kind="agents">`) && third.includes(PROMPT.agentAsk) && third.includes("</filament-context>\n\n---\n") && third.includes("plain third"), third);
    await whole(id, "plain fourth");
    assert.equal(/** @type {any} */ (promptWith("plain fourth")).prompt, `${askLine(["product"])}\nplain fourth`, "said once: whom it may ask alone rides each prompt (AG-74)");
  });

  // (fails before: yes — the review of 11-10: an agent that takes no MCP server over HTTP was given none of Filament's,
  // its sub-agents among them, though ACP asks every agent to take one over stdio; an outside client's: a guard)
  test("an outside client's request is given no such tool; an agent that takes no MCP server over HTTP is given Filament's through the relay over stdio", async () => {
    const id = await newSession({ subagents: { pool: [{ model: "m-1", seats: 4 }] } }, "deaf-1");
    const t = await whole(id, "hello there");
    assert.equal(t.status, 200, JSON.stringify(t.json));
    const notes = (await notesOf(t.id)).notes;
    assert.ok(notes.some((n) => /takes no MCP server over HTTP \(mcpCapabilities\.http\): Filament's tools reach it over stdio, through Filament's relay/.test(n)), notes.join("\n"));
    assert.ok(!notes.some((n) => /declares no HTTP MCP support/.test(n)), "nothing lost");
    const deaf = /** @type {any} */ (promptWith("hello there"));
    assert.equal(deaf.mcpVia, "stdio", "the agent started the relay");
    assert.equal(deaf.mcpInit, 200, "and its handshake went through it");
    assert.ok((await toolsAt(deaf.mcpUrl)).some((/** @type {any} */ x) => x.name === "agent"), "Filament's agent tool with the rest");
    const r = await shim.api("/v1/messages", { method: "POST", body: { model: "coder-1", max_tokens: 100, messages: [{ role: "user", content: "outside hello" }] } });
    assert.equal(r.status, 200, await r.clone().text());
    const outside = /** @type {any} */ (promptWith("outside hello"));
    assert.ok(!outside.mcpUrl || !(await toolsAt(outside.mcpUrl)).some((/** @type {any} */ x) => x.name === "agent"), "no agent tool of Filament's");
    assert.ok(!String(opens(outside.sessionId)[0]?.system || "").includes(PROMPT.coderAgent));
  });

  // (fails before: yes — a coding agent's chat had no door to launch through, onto any model)
  test("\"Their model\" is another coding agent's: the launch runs on that agent, whose own session is given no tool of Filament's that launches", async () => {
    const id = await newSession({ subagents: { pool: [{ model: "plain-9", seats: 4 }] } });
    const t = await whole(id, `across ~mcpcall agent ${JSON.stringify({ description: "Ask the other", prompt: "HELPER-TASK say hello", subagent_type: "builder" })}`);
    assert.equal(t.status, 200, JSON.stringify(t.json));
    const [sa] = await subagentsOf(id);
    assert.deepEqual([sa.model, sa.card.tag, sa.status, sa.origin], ["plain-9", "builder", "done", "agent"]);
    assert.match(t.text, new RegExp(`HELPER-TASK say hello[\\s\\S]*\\[Filament: sub-agent ${sa.id} — to ask it more in the same context, call agent with agent_id "${sa.id}"\\. 0 running\\.\\]`));
    const helper = lines(join(logs, "prompts.jsonl")).find((p) => String(p.text).includes("HELPER-TASK") && !String(p.text).includes("~mcpcall"));
    assert.ok(helper, "the other agent was prompted with the task");
    assert.notEqual(helper.sessionId, /** @type {any} */ (promptWith("across ~mcpcall")).sessionId, "in a session of its own");
    assert.ok(!helper.mcpUrl || !(await toolsAt(helper.mcpUrl)).some((/** @type {any} */ x) => x.name === "agent" || x.name === "wait"), "a sub-agent launches nothing");
    assert.ok(!String(helper.prompt).includes(PROMPT.coderAgent), "and is told of no such tool");
  });

  // (fails before: no — a guard: the developer's stop reaches a sub-agent as it does on Filament's loop)
  test("the developer stops the turn: a sub-agent the agent's call still waits for is stopped, and nothing is left running", async () => {
    gate = deferred();
    const id = await newSession({ subagents: { pool: [{ model: "m-1", seats: 4 }] } });
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `~dropcall ~mcpcall agent ${JSON.stringify({ description: "Hold it", prompt: "HOLD in front" })}`, stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    const running = await until(async () => (await subagentsOf(id)).find((/** @type {any} */ s) => s.status === "running" && s.runId) || null, "the sub-agent's own run to start");
    assert.equal(running.background, false);
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} })).status, 200);
    await res.text();
    const sa = await until(async () => (await subagentsOf(id)).find((/** @type {any} */ s) => s.status !== "running") || null, "the sub-agent to end");
    assert.equal(sa.status, "stopped", JSON.stringify(sa));
    const { notes } = await notesOf(runId);
    assert.ok(notes.some((n) => new RegExp(`^agent: launched sub-agent ${sa.id} \\(Builder, m-1\\) — was stopped by the developer after`).test(n)), notes.join("\n"));
    const end = (await runEvents(runId)).at(-1);
    assert.deepEqual([end.type, end.status], ["run-end", "stopped"], JSON.stringify(end));
    assert.equal((await subagentsOf(id)).filter((/** @type {any} */ s) => s.status === "running").length, 0);
    gate.resolve();
  });

  // (fails before: no — a guard: a stop while the turn only waits ends the turn and leaves a background launch running)
  test("the developer stops a turn that only waits: its background sub-agent runs on, and its report opens the session's next turn", async () => {
    gate = deferred();
    const id = await newSession({ subagents: { pool: [{ model: "m-1", seats: 4 }] } });
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `behind ~mcpcall agent ${JSON.stringify({ description: "Hold it", prompt: "HOLD behind", run_in_background: true })}`, stream: true, runEvents: true } });
    const runId = String(res.headers.get("x-filament-request-id"));
    await until(async () => (await runEvents(runId)).find((e) => e.type === "turn-state" && e.to === "waiting") || null, "the turn to wait for Filament's sub-agent");
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} })).status, 200);
    await res.text();
    const end = (await runEvents(runId)).at(-1);
    assert.deepEqual([end.type, end.status], ["run-end", "stopped"], JSON.stringify(end));
    const [sa] = await subagentsOf(id);
    assert.deepEqual([sa.status, sa.background], ["running", true], "the stop was the turn's, not its");
    gate.resolve();
    await until(async () => (await subagentsOf(id))[0].status === "done", "the sub-agent to report");
    await whole(id, "after the stop");
    const next = /** @type {any} */ (promptWith("after the stop"));
    assert.ok(String(next.prompt).includes(`sub-agent ${sa.id}`) && String(next.prompt).includes("SUB REPORT: a.txt"), String(next.prompt));
  });

  // (fails before: yes — the transcript audit, 2026-10-23: a sub-agent's coding agent sent its thread Filament's tool
  // lines as its words, under the cards that drew the same calls)
  test("a sub-agent on a coding agent: its thread reads its words in the page's shape, its calls as their cards alone", async () => {
    const id = await newSession({}, "m-1");
    /** @type {{ id: string, type: string, text: string }[]} */
    const pieces = [];
    const words = shim.app.liveWords;
    const piece = words.piece;
    words.piece = (run, type, text) => (pieces.push({ id: run, type, text }), piece(run, type, text));
    try {
      const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "~terminal Run the tests", description: "Tests", model: "plain-9", deliver: false } });
      assert.equal(spawn.status, 200, await spawn.clone().text());
      const sa = await until(async () => (await subagentsOf(id)).find((/** @type {any} */ s) => s.status !== "running") || null, "the sub-agent to answer");
      const runId = String(sa.exchanges[0].runId);
      assert.ok((await runEvents(runId)).some((e) => e.type === "tool-start"), "its call is its run's card");
      const read = pieces.filter((p) => p.id === runId).map((p) => p.text).join("");
      assert.ok(read.trim(), "its words reach its thread");
      assert.doesNotMatch(read, /⚙|npm test/, "no line of Filament's for the call beside its card");
    } finally {
      words.piece = piece;
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Codex's bridge and Cursor's SDK, against their fakes
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — neither bridge knew the tool: Codex's thread was given no server for it, Cursor's agent no tool)
describe("the tool through Codex and through Cursor's SDK", () => {
  const MCP_BASE = "http://127.0.0.1:9";
  const now = { asks: /** @type {any[]} */ ([]), gone: false };
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => ({ offer: () => now, asks: () => now.asks }), membersOf: () => null });
  /** @type {string} */ let dir;
  /** JSON lines of a file, oldest first. @param {string} file */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /**
   * One turn as the agent path hands it to a bridge: the session's offer as its context's block and its tools' word.
   * `gone`: no offer — as where a team's lead took the session, its own tools in the tool's place (acp-turn.js).
   * @param {string} text
   */
  const handed = (text) => {
    const offer = now.gone ? null : { asks: now.asks };
    const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] };
    return { body, context: agentContext({ format: "anthropic", body, graph: false, launch: offer }), toolsAt: { chain: "c1", turn: "t1", graph: false, team: false, launch: offer ? launchKey(offer) : "" } };
  };
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-coder-launch-bridges-"));
    process.env.FAKE_SDK_LOG = join(dir, "sdk.jsonl");
  });
  after(async () => {
    delete process.env.FAKE_SDK_LOG;
    await removeDirs(dir);
  });

  test("Codex: the thread's developer instructions say it, Filament's server rides its config with the tool, and a changed offer opens the thread again", async () => {
    const bridge = new CodexBridge({ log: () => {}, stateFile: join(dir, "codex-sessions.json") });
    bridge.agentTools = tools;
    const up = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(dir, "cx.jsonl") }, cwdDefault: dir, permissions: "allow-all" } };
    const heard = (/** @type {string} */ method) => lines(join(dir, "cx.jsonl")).filter((m) => m.method === method);
    const said = () => heard("turn/start").at(-1)?.params.input[0].text;
    const run = async (/** @type {string} */ text) => {
      const h = handed(text);
      return { ...h, out: await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: h.body, conversationId: "chat", onEvent: () => {}, mcpBase: MCP_BASE, context: h.context, toolsAt: h.toolsAt }) };
    };
    try {
      now.asks = [];
      now.gone = false;
      const first = await run("hello");
      const [start] = heard("thread/start");
      // In the words for an agent whose own sub-agents are off (`held`).
      assert.equal(start.params.developerInstructions, standingText(first.context.standing.map((/** @type {any} */ b) => (b.held ? { ...b, text: b.held } : b))));
      assert.ok(start.params.developerInstructions.includes(launchWords({ asks: [], held: true })));
      const url = start.params.config["mcp_servers.filament"].url;
      const ctx = /** @type {any} */ (bridge.contextForMcpToken(url.split("/").pop()));
      assert.deepEqual([ctx.launch, ctx.team, ctx.chain, ctx.patienceMs], [true, false, "c1", 600_000], "Codex lets one of Filament's calls run 600 s");
      // (fails before: yes — the owner's of 11-10: Codex's own sub-agents (spawn_agent and the rest) stood beside
      // Filament's agent tool, and its words offered them where they fit)
      assert.deepEqual([start.params.config["features.multi_agent"], start.params.config["features.multi_agent_v2"]], [false, false], "Codex's own sub-agents off beside Filament's");
      assert.equal(ctx.held, true, "and its server's words say so");
      assert.deepEqual(tools.list(ctx).map((t) => t.name), ["agent", "wait", "envelope"]);
      // (fails before: yes — HarnessV4_Envelopes_Plan EN3: no bridge said whether its agent could open an envelope)
      assert.equal(first.out.opensEnvelopes, true, "the envelope tool reached the thread");
      assert.ok(first.out.notes.includes("codex: Filament's MCP server given to the thread: Filament's agent tool"), first.out.notes.join("\n"));
      assert.equal(said(), "hello");

      await run("same offer");
      assert.equal(heard("thread/resume").length, 0, "the same offer leaves the thread as it is");

      now.asks = ASKS;
      const second = await run("ask them too");
      assert.equal(heard("thread/unsubscribe").length, 1, "let go of first");
      const [resume] = heard("thread/resume");
      const url2 = resume.params.config["mcp_servers.filament"].url;
      assert.notEqual(url2, url);
      assert.ok(second.out.notes.some((/** @type {string} */ n) => n.endsWith("opened again: the task graph, memory's tools, the team it leads, what Filament's agent tool offers it, the project's Space, or the visuals', the artifacts' or the team tool's switch, changed the tools it takes")), second.out.notes.join("\n"));
      assert.equal(said(), `${UPDATE_HEAD}\n\n${launchWords({ asks: ASKS, held: true })}\n\n---\nask them too`, "a resumed thread may keep the instructions it started with: the change goes ahead too");
      assert.deepEqual(tools.list(/** @type {any} */ (bridge.contextForMcpToken(url2.split("/").pop()))).find((t) => t.name === "agent")?.inputSchema.properties.subagent_type.enum, ["builder", "reviewer", "pm", "designer"]);
      assert.equal(bridge.contextForMcpToken(url.split("/").pop()), null, "the old address stands for nothing");

      // (fails before: yes — HarnessV4_Tasks E23-D8: with nothing named the tool went)
      now.asks = [];
      await run("nobody named");
      assert.equal(heard("thread/resume").length, 2);
      assert.ok(heard("thread/resume")[1].params.config?.["mcp_servers.filament"], "the tool stands: a launch runs on the agent's own model where nothing else names one");
      assert.equal(said(), `${UPDATE_HEAD}\n\n${launchWords({ asks: [], held: true })}\n\n---\nnobody named`);
      now.gone = true;
      const alone = await run("on my own");
      assert.equal(heard("thread/resume").length, 3);
      assert.equal(heard("thread/resume")[2].params.config?.["mcp_servers.filament"], undefined, "no server of Filament's where it has no tool to give");
      assert.equal(heard("thread/resume")[2].params.config?.["features.multi_agent"], undefined, "and Codex's own sub-agents back on");
      assert.equal(alone.out.opensEnvelopes, false, "nor an envelope tool: a result would come whole (EN-D10)");
      assert.equal(said(), `${UPDATE_HEAD}\n\n${PARALLEL_OFF_GONE}\n\n${LAUNCH_GONE}\n\n---\non my own`);
    } finally {
      bridge.shutdown();
    }
  });

  test("Cursor's SDK: the tool goes with each message as one of the agent's own, its words ahead of the first prompt; gone, the agent is told", async () => {
    const bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) }));
    bridge.agentTools = tools;
    const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir } };
    const sent = () => lines(join(dir, "sdk.jsonl")).filter((e) => e.event === "send").at(-1);
    const run = async (/** @type {string} */ text, /** @type {any} */ over = {}) => {
      const h = handed(text);
      return bridge.run({ upstream: up, modelId: "grok-4.6", format: "anthropic", body: h.body, conversationId: "sdk-chat", onEvent: () => {}, context: h.context, toolsAt: { ...h.toolsAt, ...over } });
    };
    try {
      now.asks = [];
      now.gone = false;
      const first = await run("hello");
      assert.equal(sent().prompt, `${CONTEXT_HEAD}\n\n${PARALLEL_OFF}\n\n${launchWords({ asks: [], held: true })}\n\n---\nhello`);
      // (fails before: yes — the owner's of 11-10: Cursor's own sub-agents (its `task` tool) stood beside Filament's)
      const loaded = () => lines(join(dir, "sdk.jsonl")).filter((e) => e.event === "create" || e.event === "resume").at(-1);
      assert.deepEqual(loaded().disallowedTools, ["task"], "Cursor's own sub-agents off beside Filament's");
      assert.deepEqual(["agent", "wait", "envelope", "worker"].filter((n) => sent().customTools.includes(n)), ["agent", "wait", "envelope"], JSON.stringify(sent().customTools));
      // (fails before: yes — HarnessV4_Envelopes_Plan EN3: no bridge said whether its agent could open an envelope)
      assert.equal(/** @type {any} */ (first).opensEnvelopes, true);
      now.asks = ASKS;
      await run("ask them too");
      assert.equal(sent().prompt, `${UPDATE_HEAD}\n\n${launchWords({ asks: ASKS, held: true })}\n\n---\nask them too`);
      assert.deepEqual(["agent", "wait"].filter((n) => sent().customTools.includes(n)), ["agent", "wait"], JSON.stringify(sent().customTools));
      now.gone = true;
      const alone = await run("on my own");
      assert.equal(sent().prompt, `${UPDATE_HEAD}\n\n${PARALLEL_OFF_GONE}\n\n${LAUNCH_GONE}\n\n---\non my own`);
      assert.deepEqual(["agent", "wait", "envelope"].filter((n) => sent().customTools.includes(n)), [], JSON.stringify(sent().customTools));
      assert.equal(loaded().disallowedTools, null, "and its own back, loaded again");
      assert.equal(/** @type {any} */ (alone).opensEnvelopes, false, "a result would come whole (EN-D10)");
    } finally {
      bridge.shutdown();
    }
  });
});
