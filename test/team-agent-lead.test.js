// @ts-check
// HarnessV3-ACP AC6-3 to AC6-6: a coding agent leading a team. Its part, the developer's words between its prompts, and
// Filament's tools for a lead, alone (app/agent-lead.js, app/agent-tools.js); then on the live app, a team led by a fake
// agent (fixtures/fake-acp-agent.mjs, Claude's shape) whose workers run on the agent loop: its part rides the agent's
// system channel and its team's tools reach it over Filament's MCP server; a worker's report wakes it within the
// developer's turn; its order runs at once, under its call; its own tools work as the
// chat's permission mode allows, with the chat's MCP servers beside Filament's (HarnessV4_Tasks decision 9); a
// message the developer sends while it waits wakes it, and a stop ends its wait while its worker runs on; a lead that
// took a message into its running turn and heard one more as its next prompt is handed neither again; a report that
// lands while it works, and a message in a later prompt of its turn, go into its running turn; and an agent that takes
// no MCP server over HTTP is refused as a lead.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROMPT, leadLines, systemPromptFor } from "../src/app/agent/prompt.js";
import { STEERING_HEAD } from "../src/app/agent/loop.js";
import { ROLE_BLOCK } from "../src/app/agent-worker.js";
import { MCP_PATIENCE_MS, createAgentTurns } from "../src/app/agent-inbox.js";
import { createLeadTurn, heardBlock, leadGone, leadWords } from "../src/app/agent-lead.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { agentContext } from "../src/app/agent-context.js";
import { planToolset } from "../src/adapters/agents/acp/toolset.js";
import { McpToolServer } from "../src/http/mcp.js";
import { WAKE_HEAD } from "../src/core/watchers.js";
import { MEMBERS } from "./helpers/roster.js";
import { shippedTeam } from "./helpers/team.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

// ---- the lead's part, its words and its tools, alone ----------------------------------------------------------------

test("a lead's part: Filament's instructions, the loop lead's role and its team's persona, that its team's tools are Filament's and its own work as the permission mode allows, how it waits, and its report", () => {
  const team = shippedTeam("builders");
  const words = leadWords(team);
  assert.ok(words.startsWith(`<filament-context kind="${ROLE_BLOCK}">\nThese are Filament's instructions for this session, not background.\n${PROMPT.leadRole}\n${PROMPT.headTeam} Builders\n${team.persona.trim()}\n`), words);
  for (const line of [PROMPT.lead, PROMPT.ambiguity, PROMPT.leadPermission, PROMPT.leadCare, PROMPT.leadReport]) assert.ok(words.includes(`${line}\n`), line);
  // (fails before: yes — HarnessV4_Tasks decision 9: "While you lead, your own tools only read")
  assert.ok(words.includes("Your own tools work as the developer's permission mode allows: keep them for the pieces better done yourself, and brief a worker for the rest.") && words.includes("Filament wakes you with the reports as your next message"));
  assert.ok(!words.includes("only read"), "nothing says its tools only read");
  // (fails before: yes — version 121: a team that changes no file is held to reading while it leads (tm4, 0867f847f),
  // and its lead still read that its own tools work as the developer's permission mode allows)
  const HELD = "Your own tools and your workers only read here, whatever the developer's permission mode says: you change no file and run no command that changes one. Keep your own tools for the pieces better done yourself, and brief a worker for the rest.";
  const OWN_HANDS_READ = "- Brief a worker by default. Your team changes no file here, and neither do you: your own hands only read, whatever the developer's permission mode says. Take a piece yourself only where that is the better call: it is smaller than its brief would be — a file to read, a search, a command that confirms a report — or workers have failed it twice.";
  // (fails before: yes — 031b96a65's left: its permission line said "a refused one means they declined it", where a
  // refusal of a call that writes is Filament's hold on the team, never the developer's no)
  const HELD_PERMISSION = "Your tools and your workers' only read here, whatever the developer's permission mode says. A call that would change something, or one Filament cannot tell only reads, is refused at once and asks nobody: a refusal is that hold, not the developer's no — don't retry it; read another way, or say in your report what you would have run and why.";
  assert.equal(PROMPT.leadPermissionReads, HELD_PERMISSION);
  for (const supervise of [false, true]) {
    const held = leadWords({ ...team, readOnly: true }, { supervise });
    assert.ok(held.includes(`${HELD}\n`), held);
    assert.ok(held.includes(`${HELD_PERMISSION}\n`) && !held.includes("declined it"), held);
    assert.ok(!held.includes("work as the developer's permission mode allows"), "nothing says its tools follow the chat's mode");
    // Its own hands, among the lines of how it leads: hands that only read (below), in place of every lead's.
    const hands = String(PROMPT.lead).split("\n").find((l) => l.startsWith("- Brief a worker by default."));
    assert.ok(hands?.includes("a one-line fix, a rename") && leadWords(team, { supervise }).includes(`${hands}\n`), "a team that writes reads every lead's own hands");
    assert.equal(
      held,
      leadWords(team, { supervise }).replace("Your own tools work as the developer's permission mode allows: keep them for the pieces better done yourself, and brief a worker for the rest.", HELD).replace(String(hands), OWN_HANDS_READ).replace(String(PROMPT.leadPermission), HELD_PERMISSION),
      "those three sentences alone move",
    );
    assert.equal(leadWords({ ...team, readOnly: false }, { supervise }), leadWords(team, { supervise }), "a team that writes reads it as it was");
  }
  assert.ok(!words.includes(String(PROMPT.work)) && !words.includes(String(PROMPT.craft)), "never the loop's words for its own hands");
  assert.ok(!leadWords({ name: "Bare", persona: " " }).includes("\n\n"), "a team without a persona says none");
  // (fails before: yes — HarnessV4_Tasks B12: the words for its going named no team)
  assert.match(leadGone({ name: "Architect" }), /^You no longer lead team Architect: the developer set this session's engine back to a single agent\./);
});

test("the developer's messages between a lead's prompts, in the loop's steering words", () => {
  assert.equal(heardBlock([{ text: "Use the docs folder." }]), `${STEERING_HEAD} (1 message). Acknowledge what you heard in your next reply before acting on it:\n- Use the docs folder.`);
  assert.match(heardBlock([{ text: "a" }, { text: "b" }]), /\(2 messages\)\. [^]*\n- a\n- b$/);
});

test("the leads by session: a lead's turn is found while it runs, and its end lets go of it alone", () => {
  const leads = createAgentTurns();
  const one = /** @type {any} */ ({ n: 1 });
  const two = /** @type {any} */ ({ n: 2 });
  const offOne = leads.open("c1", one);
  assert.equal(leads.get("c1"), one);
  assert.equal(leads.get(null), null);
  const offTwo = leads.open("c1", two);
  offOne();
  assert.equal(leads.get("c1"), two, "an older turn's end never lets go of a newer one");
  offTwo();
  assert.equal(leads.get("c1"), null);
});

test("Filament's tools for a lead: agent, worker and wait while its session's agent leads a team, its tasks the lead's; each call goes to the lead's turn with the agent's patience, and none once that turn has ended", async () => {
  const leads = createAgentTurns();
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => ({ apply: () => ({ ok: true, text: "solo" }) }), turns: leads, subagents: () => null, membersOf: () => null });
  const at = { chain: "c1", turn: null, graph: false, report: false, cwd: "/w", upstream: "cli" };
  const names = (/** @type {any} */ ctx) => tools.list({ ...at, ...ctx }).map((t) => t.name);
  // The envelope tool beside its wait (HarnessV4_Envelopes_Plan EN3).
  assert.deepEqual(names({ team: true }), ["agent", "worker", "wait", "envelope"]);
  assert.deepEqual(names({ team: true, graph: true }), ["tasks", "checklist", "agent", "worker", "wait", "envelope"]);
  // The chat's checklist beside its tasks, for the session's own agent as for a lead (the owner's tool plan of 11-08).
  assert.deepEqual(names({ team: false, graph: true }), ["tasks", "checklist"]);
  const leadTasks = tools.list({ ...at, graph: true, team: true })[0];
  const soloTasks = tools.list({ ...at, graph: true, team: false })[0];
  assert.notEqual(leadTasks.description, soloTasks.description, "a lead's tasks name its team's members");
  assert.ok(["agent", "worker", "wait", "envelope"].every((n) => tools.has(n)));

  const ctx = at;
  assert.deepEqual(await tools.call("agent", {}, { ...ctx, team: false }), { text: "Not run: this session's agent leads no team.", isError: true });
  assert.deepEqual(await tools.call("wait", {}, { ...ctx, team: true }), { text: "Not run: your turn as the team's lead has ended. Your workers' reports reach you with the developer's next message.", isError: true });
  /** @type {any[]} */
  const calls = [];
  const off = leads.open("c1", /** @type {any} */ ({ call: async (/** @type {string} */ name, /** @type {any} */ input, /** @type {any} */ o) => (calls.push([name, input, o]), { text: `ran ${name}` }) }));
  assert.deepEqual(await tools.call("agent", { role: "scout" }, { ...ctx, team: true, patienceMs: 600_000 }), { text: "ran agent" });
  assert.deepEqual(await tools.call("tasks", { action: "add" }, { ...ctx, team: true, graph: true }), { text: "ran tasks" });
  assert.deepEqual(calls, [["agent", { role: "scout" }, { patienceMs: 600_000 }], ["tasks", { action: "add" }, { patienceMs: undefined }]]);
  off();
  assert.equal(MCP_PATIENCE_MS, 50_000);
});

// (fails before: no — a guard the mutation pass asked for: a lead's part that never said it went, and a lead given the
// coder's graph words, passed every test)
test("a part stands first in the agent's context: a lead's with the words for its going, a worker's with none; a lead's graph words are the loop lead's", () => {
  const body = { system: "Be brief.", messages: [{ role: "user", content: "hi" }] };
  const led = agentContext({ format: "anthropic", body: structuredClone(body), graph: true, role: "THE LEAD'S PART", roleGone: leadGone({ name: "Architect" }), lead: true });
  assert.deepEqual(led.standing[0], { id: ROLE_BLOCK, text: "THE LEAD'S PART", gone: leadGone({ name: "Architect" }) });
  assert.equal(led.standing[1].text, `<filament-context kind="tasks">\n${PROMPT.leadGraph}\n</filament-context>`);
  const worker = agentContext({ format: "anthropic", body: structuredClone(body), graph: false, role: "A WORKER'S PART" });
  assert.deepEqual(worker.standing, [{ id: ROLE_BLOCK, text: "A WORKER'S PART" }], "a worker's part never leaves its session");
});

// (fails before: no — a guard the mutation pass asked for: a call over MCP that lost its agent's patience on the way,
// and a lead whose session wanted nothing else of Filament's MCP server given none, passed every test)
test("a lead's team tools alone bring Filament's MCP server to its session; a call over it carries its agent's patience where the bridge knows it (Codex's 600 s)", async () => {
  /** What a turn that wants only `want` offers the agent. @param {Record<string, boolean>} want */
  const plan = (want) => planToolset({ acp: {}, upstream: { id: "cli" }, proc: { initResult: { agentCapabilities: { mcpCapabilities: { http: true } } } }, profile: /** @type {any} */ ({}), turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:9", memoryWanted: false, existingToken: null, notes: [], ...want });
  assert.equal(plan({}).wantMcp, false, "nothing wanted, no server");
  const led = plan({ teamWanted: true });
  assert.deepEqual([led.wantMcp, led.mcpServers.map((s) => s.name), led.pending?.team], [true, ["filament"], true]);
  /** @type {any[]} */
  const seen = [];
  for (const patienceMs of [600_000, undefined]) {
    const mcp = new McpToolServer({
      bridge: { contextForMcpToken: () => ({ conv: null, turn: null, cwd: "/w", upstream: { id: "codex", acp: {} }, native: false, chain: "c1", graph: false, team: true, ...(patienceMs ? { patienceMs } : {}) }), hands: {} },
      tools: { memoryOn: () => false, list: () => [], has: (/** @type {string} */ n) => n === "wait", call: async (/** @type {string} */ _n, /** @type {any} */ _a, /** @type {any} */ ctx) => (seen.push(ctx.patienceMs), { text: "ok" }) },
    });
    const res = { writeHead() {}, end() {} };
    await mcp.handle({ method: "POST" }, res, "tok", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait", arguments: {} } }));
  }
  assert.deepEqual(seen, [600_000, undefined]);
});

// (fails before: yes — V2-0b's second drive: a lead on Claude Code launched its own sub-agent, which no team holds,
// instead of a worker, and lost its turn to it; HarnessV3-TaskGraph-v2 TG2-D40)
test("a lead on Claude Code is opened without its own sub-agent tool, by both its names, beside its other session options; a session that leads nothing keeps it, and another agent is handed no Claude options", () => {
  /** @param {Record<string, any>} want @param {any} [profile] */
  const plan = (want, profile = { rawMessages: true, thinkingDisplay: true }) => planToolset({ acp: {}, upstream: { id: "claude" }, proc: { initResult: { agentCapabilities: { mcpCapabilities: { http: true } } } }, profile, turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:9", memoryWanted: false, existingToken: null, notes: [], ...want });
  assert.deepEqual(plan({ teamWanted: true }).sessionMeta._meta?.claudeCode?.options, { extraArgs: { "thinking-display": "summarized" }, disallowedTools: ["Agent", "Task"] });
  assert.deepEqual(plan({ teamWanted: true, readsWanted: true }).sessionMeta._meta?.claudeCode?.options?.disallowedTools, ["Agent", "Task"]);
  assert.deepEqual(plan({}).sessionMeta._meta?.claudeCode?.options, { extraArgs: { "thinking-display": "summarized" } });
  assert.equal(plan({ graphWanted: true }).sessionMeta._meta?.claudeCode?.options?.disallowedTools, undefined);
  assert.equal(plan({ teamWanted: true }, { rawMessages: false }).sessionMeta._meta?.claudeCode, undefined);
});

// (fails before: yes — the owner's list of 11-08, issues 5 and 6: a chat's Claude Code offered Filament's agent tool kept
// its own, reached for it, and Filament's wait knew nothing of the helper it started)
test("a chat's Claude Code offered Filament's agent tool is opened without its own; where Filament's server is not offered, its own stays", () => {
  /** @param {Record<string, any>} want @param {boolean} [http] */
  const plan = (want, http = true) =>
    planToolset({ relay: false, acp: {}, upstream: { id: "claude" }, proc: { initResult: { agentCapabilities: { mcpCapabilities: { http } } } }, profile: { rawMessages: true }, turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:9", memoryWanted: false, existingToken: null, notes: [], ...want });
  assert.deepEqual(plan({ launchWanted: "agent" }).sessionMeta._meta?.claudeCode?.options?.disallowedTools, ["Agent", "Task", "CronCreate", "CronDelete", "CronList", "ScheduleWakeup"]);
  assert.equal(plan({ launchWanted: "agent" }, false).sessionMeta._meta?.claudeCode?.options?.disallowedTools, undefined, "no Filament agent tool to use instead");
  assert.equal(plan({ memoryWanted: true }).sessionMeta._meta?.claudeCode?.options?.disallowedTools, undefined, "memory alone offers no agent tool");
});

// (fails before: yes — the owner's list of 11-08: Claude Code kept its own memory, background tasks and artifacts beside
// Filament's, and wrote its Co-Authored-By line into commits)
test("Claude Code's own memory, background tasks and artifacts go off where Filament offers its own, by their variables; its attribution is hidden in every session", () => {
  /** @param {Record<string, any>} want @param {Record<string, any>} [profile] @param {boolean} [http] */
  const plan = (want, profile = {}, http = true) =>
    planToolset({ relay: false, acp: {}, upstream: { id: "claude" }, proc: { initResult: { agentCapabilities: { mcpCapabilities: { http } } } }, profile: { rawMessages: true, compactWindow: true, sessionEnv: true, ...profile }, turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:9", memoryWanted: false, existingToken: null, notes: [], ...want }).sessionMeta._meta?.claudeCode?.options;
  const all = plan({ memoryWanted: true, launchWanted: "agent", artifactsWanted: true });
  assert.deepEqual(all?.env, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", CLAUDE_CODE_DISABLE_ARTIFACT: "1" });
  assert.deepEqual(all?.settings, { attribution: { commit: "", pr: "" } });
  assert.deepEqual(plan({ memoryWanted: true })?.env, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }, "each beside its own stand-in alone");
  assert.deepEqual(plan({ teamWanted: true })?.env, { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" }, "a lead's team tools bring the background command");
  assert.equal(plan({ memoryWanted: true, launchWanted: "agent" }, {}, false)?.env, undefined, "no Filament server, no stand-ins: its own stay (where memory works in the chat, `memoryWorks` turns its memory off: the test below)");
  assert.equal(plan({ memoryWanted: true, launchWanted: "agent" }, { sessionEnv: false })?.env, undefined, "an adapter not read taking a session's variables is handed none");
  assert.deepEqual(plan({}, {}, false)?.settings, { attribution: { commit: "", pr: "" } }, "the attribution hidden with or without Filament's server");
  assert.equal(plan({}, { compactWindow: false })?.settings, undefined, "an adapter not read taking session settings is handed none");
  assert.deepEqual(plan({ modelConfig: true })?.settings, { attribution: { commit: "", pr: "" } }, "nor where CLAUDE_MODEL_CONFIG is set: 0.93.0 lays the session's settings over it");
  assert.equal(plan({ modelConfig: true }, { sessionEnv: false })?.settings, undefined, "an adapter before it, which would replace that config with them, is handed none");
});

// (fails before: yes — the owner's of 11-09: where memory's tools were off for the chat, or its agent was offered no
// Filament server, Claude Code kept its own auto memory beside Filament's memory, and two memories wrote)
test("Claude Code's own auto memory goes off wherever Filament's memory works in the chat, its tools offered or not", () => {
  /** @param {Record<string, any>} want @param {boolean} [http] */
  const env = (want, http = true) =>
    planToolset({ relay: false, acp: {}, upstream: { id: "claude" }, proc: { initResult: { agentCapabilities: { mcpCapabilities: { http } } } }, profile: { rawMessages: true, compactWindow: true, sessionEnv: true }, turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:9", memoryWanted: false, existingToken: null, notes: [], ...want }).sessionMeta._meta?.claudeCode?.options?.env;
  assert.deepEqual(env({ memoryWorks: true }), { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }, "memory's tools off for the chat");
  assert.deepEqual(env({ memoryWorks: true }, false), { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }, "an agent offered no Filament server");
  assert.equal(env({}), undefined, "a chat memory works in none of: its own stays");
});

test("a lead's order launches its worker under its call, in the round it was made in", async () => {
  /** @type {any[]} */
  const launched = [];
  const registry = /** @type {any} */ ({
    recall: () => {},
    launch: async (/** @type {any} */ spec) => (launched.push(spec), { ok: true, id: "sa_1" }),
    get: (/** @type {string} */ id) => ({ id, may: "read", description: "Map it first", model: "m-1", view: "none" }),
    standing: () => "1 running.",
    planHeld: () => false,
    // A launch that names no model: nothing chosen, nothing to say of it (HarnessV4_Tasks E23).
    choice: async (/** @type {any} */ _input, /** @type {any} */ at) => (chose.push(at), { ok: true, fields: {} }),
    launchWords: () => ({ on: "", chose: "" }),
    // A team with no models of its own: its workers run on the sub-agents' list (team_v2_plan TV2-D8).
    teamRows: async () => null,
  });
  /** @type {any[]} */
  const chose = [];
  const lead = createLeadTurn({
    registry,
    door: /** @type {any} */ ({ inbox: { take: () => [], arrival: () => new Promise(() => {}), owed: () => 0 }, close() {} }),
    chainId: "c1",
    runId: "r1",
    cwd: "/w",
    model: "m-1",
    team: { key: "architect", name: "Architect", members: MEMBERS },
    emit: () => {},
    note: () => {},
    mailbox: () => null,
    signal: new AbortController().signal,
    callOf: async () => ({ id: "toolu_1", round: 3 }),
  });
  const said = await lead.call("agent", PROPOSED, { patienceMs: 0 });
  assert.match(said.text, /^Launched scout sa_1 /);
  assert.deepEqual(launched.map((s) => s.lead), [{ runId: "r1", callId: "toolu_1", round: 3 }]);
  // (fails before: yes — the review of f39fac749) A model named alone runs on the lead's own account first.
  assert.deepEqual(chose, [{ model: "m-1", chainId: "c1" }]);
});

/**
 * A lead's turn over stubs: a registry that launches at once, a door whose workers and reports the test holds, and the
 * events and record lines it leaves.
 * @param {{ mailbox?: any, reach?: (m: any) => "step" | "reply" | null }} [o]
 */
function stubLead({ mailbox = null, reach = () => null } = {}) {
  /** @type {any[]} */
  const launched = [];
  /** @type {any[]} */
  const events = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {Promise<void> | null} */
  let owed = null;
  /** What waits at the door, and what the lead's close handed back to the session. @type {any[]} */
  const due = [];
  /** @type {any[]} */
  const back = [];
  let wrote = 0;
  const registry = /** @type {any} */ ({
    recall: () => {},
    apply: async () => ({ ok: true, files: [{ path: "src/a.js", added: 2, removed: 1 }], repo: "/p" }),
    launch: (/** @type {any} */ spec) => (launched.push(spec), { ok: true, id: `sa_${launched.length}` }),
    get: (/** @type {string} */ id) => ({ id, may: "read", description: "Map it first", model: "m-1", view: "none" }),
    standing: () => "1 running.",
    planHeld: () => false,
    list: () => [],
    choice: async () => ({ ok: true, fields: {} }),
    launchWords: () => ({ on: "", chose: "" }),
    // A team with no models of its own: its workers run on the sub-agents' list (team_v2_plan TV2-D8).
    teamRows: async () => null,
  });
  const lead = createLeadTurn({
    registry,
    door: /** @type {any} */ ({ inbox: { take: () => due.splice(0), arrival: () => new Promise(() => {}), owed: () => owed, back: (/** @type {any[]} */ taken) => back.push(...taken) }, close() {} }),
    chainId: "c1",
    runId: "r1",
    cwd: "/w",
    model: "m-1",
    team: { key: "architect", name: "Architect", members: MEMBERS },
    emit: (e) => events.push(e),
    note: (t) => notes.push(t),
    mailbox: () => mailbox,
    reach,
    wrote: () => void wrote++,
    signal: new AbortController().signal,
  });
  return {
    lead,
    /** How many times the lead's team changed the folder, as the run was told. */
    wrote: () => wrote,
    launched,
    events,
    notes,
    due,
    back,
    /** A worker runs, its report never due. */
    running: () => (owed = new Promise(() => {})),
  };
}
// (fails before: no — a guard for HarnessV4_Tasks E15 step 3 where the lead is a coding agent: a question to a saved
// agent is no worker's launch)
test("a lead's question to a saved agent runs at once, in the background (AG-9)", async () => {
  const t = stubLead();
  const refused = await t.lead.call("agent", {}, { patienceMs: 60_000 });
  assert.equal(refused.isError, true, "a brief that is not one is refused at once");
  const said = await t.lead.call("agent", { role: "pm", description: "Queue or refuse", goal: "Queue the fifth launch, or refuse it?" }, { patienceMs: 60_000 });
  assert.match(said.text, /^Asked pm \(sa_1\) in the background\. /);
  assert.deepEqual(t.events.filter((e) => e.type === "ask").length, 0, "nothing waits for the developer");
  assert.deepEqual(t.launched.map((s) => [s.as, s.background, s.prompt]), [["pm", true, "Queue the fifth launch, or refuse it?"]]);
});

// (fails before: yes — HarnessV4_Tasks B12: a worker's change the lead applied over MCP, and a merge its report told
// of, were no write of the run's: its round took no snapshot, and showed no files)
test("a change the lead's team lands in the folder is told to its run: one the lead applies, and one a report tells of", async () => {
  const t = stubLead();
  const applied = await t.lead.call("worker", { agent_id: "sa_1", apply_changes: true });
  assert.match(applied.text, /^Applied the changes of sub-agent sa_1 to your folder: /);
  assert.equal(t.wrote(), 1);
  t.due.push({ text: "[Filament: task t1 is done, merged]", from: "sa_2", description: "t1", kind: "task", task: "t1", state: "done", wrote: true, spentUsd: 0, toolCalls: 0, roundIds: [] }, { text: "[Filament: your scout reported]", from: "sa_3", description: "Map it", kind: "report", wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [] });
  t.lead.take();
  assert.equal(t.wrote(), 2, "the merge, and not the scout's report");
});

// (fails before: yes — HarnessV4_Tasks B12: words taken for the lead that its turn ended before it heard went no
// further than a note on the record: the next turn never heard the report)
test("words taken for a lead whose turn ended before it heard them go back to the session, each as the message it was, and the record says so", async () => {
  const t = stubLead();
  const ended = { text: "[Filament: task t1 is done.]", from: "", description: "t1", kind: "task", task: "t1", state: "done", wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [] };
  const report = { text: "[Filament: your scout sa_1 finished.]", from: "sa_1", description: "Map it first", kind: "report", exchange: 0, wrote: false, spentUsd: 0.12, toolCalls: 3, roundIds: ["r-9"] };
  t.due.push(ended, report);
  const texts = t.lead.take();
  assert.equal(texts.length, 2);
  assert.equal(t.lead.spentUsd(), 0.12, "counted on the turn that took it");
  // The agent's turn ended before Filament could hand them over.
  t.lead.unheard();
  assert.deepEqual(t.lead.take(), texts, "they go with the next prompt, while there is one");
  t.lead.unheard();
  t.lead.close();
  assert.deepEqual(t.back.map((d) => [d.text, d.from, d.kind]), [[ended.text, "", "task"], [report.text, "sa_1", "report"]]);
  assert.equal(t.notes.at(-1), "agent: 2 messages from Filament never reached the lead — its turn ended first — and wait for the session's next turn");
  // Heard, nothing goes back.
  const heard = stubLead();
  heard.due.push(report);
  heard.lead.take();
  heard.lead.close();
  assert.deepEqual([heard.back, heard.notes.filter((n) => /never reached/.test(n))], [[], []]);
});

// (fails before: no — a guard the mutation pass asked for: a wait with nothing to wait for that waited, a wait past
// the agent's patience, a developer's message that never ended one, and a tasks call with no graph passed every test)
test("a lead's wait: nothing to wait for answers at once; it answers within the agent's patience, and at the developer's message; a tasks call with no graph is refused", async () => {
  const idle = stubLead();
  assert.match((await idle.lead.call("wait", {}, { patienceMs: 6_000 })).text, /^Nothing to wait for: no worker you launched is running, and none of your background commands runs\./);
  assert.deepEqual(await idle.lead.call("tasks", { action: "add" }), { text: "Not run: this session has no task graph.", isError: true });
  const patient = stubLead();
  patient.running();
  assert.match((await patient.lead.call("wait", { seconds: 5 }, { patienceMs: 6_000 })).text, /^Waited 1 s and nothing arrived; the workers are still running\. A wait answers within 1 s here: end your turn/);
  /** @type {() => void} */
  let typed = () => {};
  /** The developer's message, once typed. @type {any} */
  let queued = null;
  const message = { id: "s1", kind: "note", text: "Check the docs too.", from: "harness", at: 0 };
  const mailbox = { next: () => new Promise((r) => (typed = () => ((queued = message), r(undefined)))), peek: (/** @type {(m: any) => boolean} */ pick) => (queued && pick(queued) ? queued : null) };
  const told = stubLead({ mailbox, reach: (m) => (m.kind === "note" ? "step" : null) });
  told.running();
  const waited = told.lead.call("wait", { seconds: 3 }, { patienceMs: 60_000 });
  typed();
  assert.match((await waited).text, /^Waited 0 s: the developer sent you a message — Filament hands it to you next\./);
});

// ---- on the live app ------------------------------------------------------------------------------------------------

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;
/** @type {string} */
let logs;
/** Lets the worker that waits for it go on. @type {() => void} */
let release = () => {};

const SCOUT = { role: "scout", description: "Map the folder", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
const PROPOSED = { role: "scout", description: "Map it first", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
// A scout, which works in the session's folder: a worker with a worktree spends seconds on git at its end.
const HELD = { role: "scout", description: "Hold until released", goal: "wait", steps: ["Wait"], acceptance: "it is released" };
// A Builder asked to write a file: it tries, then says it did.
const WRITER = { role: "builder", description: "Write worked.txt", goal: "worked.txt is there", steps: ["Write it"], acceptance: "worked.txt is there" };
const TOLD = "Check the docs folder too.";

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** A JSONL file's lines, parsed. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** The lead's prompts to the fake agent, in a session: each one's words. @param {string} sessionId */
const promptsOf = (sessionId) => lines(join(logs, "prompts.jsonl")).filter((p) => p.sessionId === sessionId);
/** The fake agent's prompt that carries `marker`. @param {string} marker */
const promptWith = (marker) => lines(join(logs, "prompts.jsonl")).find((p) => String(p.text).includes(marker)) || null;

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-agent-lead-"));
  logs = mkdtempSync(join(tmpdir(), "filament-agent-lead-logs-"));
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(folder, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  /** @type {Promise<void>} */
  let held = new Promise((resolve) => (release = () => resolve(undefined)));
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    const all = JSON.stringify(b.messages || []);
    const say = (/** @type {string} */ text) => anthropicReply("", { model: String(b.model || ""), stop: "end_turn", blocks: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
    // The workers, on the loop: each reports at once, but the one that holds, until the test lets it go.
    if (sysOf(b).includes(String(PROMPT.workerRole))) {
      if (all.includes(WRITER.description)) return all.includes("tu_ww") ? say("WRITER TRIED") : anthropicReply("", { model: String(b.model || ""), stop: "tool_use", blocks: [{ type: "tool_use", id: "tu_ww", name: "write", input: { path: "worked.txt", content: "written by a worker\n" } }], usage: { input_tokens: 5, output_tokens: 3 } });
      if (all.includes(HELD.description)) {
        await held;
        held = new Promise((resolve) => (release = () => resolve(undefined)));
        return say("HELD WORKER DONE");
      }
      return say("SCOUT REPORT: a.txt");
    }
    return say("MODEL ANSWER");
  });
  shim = await startApp({ memory: true, keep: true, configure });
});
after(async () => {
  release();
  await shim.stop();
  await up.close();
  // A process just stopped may still hold a folder a moment (EPERM, seen at the full suite's concurrency).
  await removeDirs(folder, logs, shim.dataDir);
});

/** @param {any} cfg @param {{ dataDir: string }} ctx */
function configure(cfg, { dataDir }) {
  const agent = (/** @type {string} */ id, /** @type {Record<string, string>} */ env) => ({
    id,
    name: id,
    type: "acp",
    enabled: true,
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), ...env }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" },
  });
  cfg.upstreams = [
    { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
    agent("cli", { FAKE_ACP_MCP_CAPS: "http" }),
    agent("deaf", { FAKE_ACP_MCP_CAPS: "none" }),
    agent("steerer", { FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_STEERING: "1", FAKE_ACP_QUEUE_GATE: join(logs, "gates"), FAKE_ACP_TICK_DIR: join(logs, "ticks") }),
  ];
  cfg.routes = [
    { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
    { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
    { match: "deaf-*", upstream: "deaf", upstreamModel: "{model}", enabled: true },
    { match: "steerer-*", upstream: "steerer", upstreamModel: "{model}", enabled: true },
  ];
  cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
  cfg.memory.autopilot = { enabled: false };
}

/** A harness session in the repository, led by the coding agent, its workers on the loop. @param {string} [model] */
const newSession = async (model = "coder-1") => {
  const settings = { engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-1", seats: 4 }] } };
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model, preset: "plain", settings } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** A harness turn, as the page sends one, and its run's id. @param {string} id @param {string} content */
const turn = async (id, content) => {
  const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
  assert.equal(res.status, 200);
  return { res, runId: String(res.headers.get("x-filament-request-id")) };
};
/** A harness turn, answered whole. @param {string} id @param {string} content */
const whole = async (id, content) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
  const json = await r.json();
  const text = (json.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
  return { status: r.status, json, text, id: String(r.headers.get("x-filament-request-id")) };
};
/** A run's events so far. @param {string} runId @returns {Promise<any[]>} */
const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
/** The session's sub-agents. @param {string} id @returns {Promise<any[]>} */
const subagentsOf = async (id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents;
/** The notes on a request's record. @param {string} id */
const notesOf = async (id) => {
  const rec = await shim.record(id);
  return { rec, notes: [...(rec.priorChanges || []), ...(rec.changes || [])].map(String) };
};
/** A tool's call to Filament's MCP server, as the agent makes one. @param {string} url @param {string} method @param {any} [params] */
const mcp = async (url, method, params = {}) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

test("a coding agent leads its team: its part rides its system channel, its team's tools reach it over Filament's MCP server, and its worker's report wakes it within the developer's turn", async () => {
  const id = await newSession();
  const t = await whole(id, `~diff ~mcpcall agent ${JSON.stringify(SCOUT)}`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.match(t.text, /mcp:Launched scout sa_[0-9a-f]{8} \("Map the folder"\) in the background\./, "the launch, as the loop lead hears it");

  const first = /** @type {any} */ (promptWith("~mcpcall agent"));
  const opened = lines(join(logs, "calls.jsonl")).find((c) => c.method === "session/new" && c.sessionId === first.sessionId);
  const system = String(opened?.system || "");
  assert.ok(system.includes(`<filament-context kind="${ROLE_BLOCK}">`) && system.includes(String(PROMPT.leadRole)) && system.includes(`${PROMPT.headTeam} Builders`), "its part rode the agent's system channel");
  // (fails before: yes — HarnessV3-TaskGraph-v2 TG2-D47: a lead knew nothing of the models its workers run on)
  assert.ok(system.includes("\n- Your workers run on m-1.\n"), "its lines name its workers' model, as the loop lead's do");
  const listed = (await mcp(first.mcpUrl, "tools/list")).tools.map((/** @type {any} */ x) => x.name);
  assert.ok(["agent", "worker", "wait"].every((n) => listed.includes(n)), listed.join(", "));

  // The worker ran on the loop and reported; the report woke the lead as its next prompt, in the same session and turn.
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.team?.role, sa.model, sa.status], ["scout", "m-1", "done"]);
  const prompts = promptsOf(first.sessionId);
  assert.equal(prompts.length, 2, "the developer's prompt, then the wake");
  assert.ok(prompts[1].text.includes(`[Filament: your scout ${sa.id} ("Map the folder")`) && prompts[1].text.includes("SCOUT REPORT: a.txt"), prompts[1].text);
  assert.match(t.text, /echo\(2\): /, "its answer to the report is the turn's");
  const { rec, notes } = await notesOf(t.id);
  assert.ok(notes.includes("engine: team Builders answers this session's turns (engine.team), its lead the coding agent coder-1"), notes.join("\n"));
  assert.ok(notes.includes("acp: cli woken in the same turn: 1 message from Filament"), notes.join("\n"));
  assert.ok(notes.includes("agent: 1 sub-agent message delivered to the lead"), notes.join("\n"));
  assert.deepEqual([rec.acp.team.key, rec.acp.team.name], ["builders", "Builders"]);
  // (fails before: yes — the turn carried no stamp of who answered it, which the transcript's divider, the lead's
  // signature and the Team view's Leading are drawn from: a reload lost all three)
  const shown = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  assert.deepEqual(shown.turns.map((/** @type {any} */ x) => x.engine ?? null), [{ kind: "team", team: "builders", name: "Builders" }], "the turn says its team's lead answered it");
  // (fails before: no — a guard the mutation pass asked for: a turn of two prompts kept its last one's work alone, and
  // passed every test)
  assert.deepEqual([rec.acp.linesAdded, rec.acp.linesRemoved], [2, 1], "its first prompt's edit stays the turn's");
  assert.ok(rec.acp.team.spentUsd > 0, "what its worker spent goes with the lead's record");
  // On the lead's run: the worker's start under its launch, and its report.
  const events = await runEvents(t.id);
  // (fails before: yes — HarnessV4_Tasks B12: the run's end said no cost at all, so the team's spend was in no figure of
  // the lead's turn)
  assert.equal(events.at(-1).summary.childCostUsd, Math.round(((rec.cost || 0) + rec.acp.team.spentUsd) * 1e6) / 1e6, "the turn's cost counts what its team spent");
  const call = events.find((e) => e.type === "tool-start" && e.name === "agent");
  assert.ok(call, "the agent's own call of the team's tool, drawn on its run");
  const under = events.filter((e) => e.type.startsWith("subagent-") && e.parent === call.id);
  assert.deepEqual(under.filter((e) => e.type === "subagent-start").map((e) => e.agentId), [sa.id], "the worker hangs off the call that launched it, its only card there");
  assert.deepEqual(under.filter((e) => e.type === "subagent-end").map((e) => e.status), ["done"], "the call's own end ends no card: the worker's does");
  assert.ok(events.some((e) => e.type === "subagent-report" && e.agentId === sa.id && e.kind === "report"), "its report on the lead's run");
});

// (fails before: yes — a worker's row named its team and never whether that team leads its chat still, so Now could not
// tell a change that waits for its lead's apply from one left behind when the chat went back to its agent)
test("a worker's row says its team leads its chat while it does — the setting naming the team by its key or its name — and no more once the chat is handed back", async () => {
  const id = await newSession();
  const t = await whole(id, `~mcpcall agent ${JSON.stringify(SCOUT)}`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const teams = async () => (await subagentsOf(id)).map((/** @type {any} */ s) => [s.team?.key, s.team?.charge]);
  /** @param {any} change */
  const settle = async (change) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: change });
    assert.equal(r.status, 200, await r.clone().text());
  };
  assert.deepEqual(await teams(), [["builders", true]]);
  await settle({ unset: ["engine.mode", "engine.team"] });
  assert.deepEqual(await teams(), [["builders", undefined]], "back to its agent");
  await settle({ patch: { engine: { mode: "team", team: "Builders" } } });
  assert.deepEqual(await teams(), [["builders", true]], "named as a person writes it");
  await settle({ patch: { engine: { mode: "team", team: "bughunters" } } });
  assert.deepEqual(await teams(), [["builders", undefined]], "another team's chat");
});

// (fails before: yes — HarnessV4_Tasks decision 9: a lead's own tools only read, so its write was refused, nothing was
// written, and Filament told it who does the work)
test("a lead's own tools work as the chat's permission mode allows: under Edit its write runs, and nothing is said of leading", async () => {
  const id = await newSession();
  const t = await whole(id, "~writefile");
  try {
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.match(t.text, /wrote /, t.text);
    assert.equal(readFileSync(join(folder, "out.txt"), "utf8"), "hello from agent");
    const first = /** @type {any} */ (promptWith("~writefile"));
    assert.equal(promptsOf(first.sessionId).length, 1, "the developer's prompt alone: Filament had nothing to tell the lead");
    const { notes } = await notesOf(t.id);
    assert.equal(notes.some((n) => /lead's own tools only read|why its own request was refused/.test(n)), false, notes.join("\n"));
    assert.ok(notes.includes("acp: cli leads team Builders (engine.team): its workers do the work — Filament's agent, worker and wait reach it over MCP — and its own tools work as the chat's permission mode allows, for a piece better done itself"), notes.join("\n"));
  } finally {
    rmSync(join(folder, "out.txt"), { force: true });
  }
});

// (fails before: yes — a team said to change no file, in charge of a chat on a coding agent: its lead's write ran under
// the chat's Edit, and its Builder was launched to follow the chat's mode)
test("a lead whose team changes no file only reads, whatever the chat's mode says: its own write is refused in read-only's words, and so is its worker's, launched by its order or by its graph", async () => {
  const set = await shim.api("/api/teams/builders", { method: "PUT", body: { readOnly: true } });
  assert.equal(set.status, 200, await set.clone().text());
  try {
    const id = await newSession();
    const t = await whole(id, "~writefile");
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.match(t.text, /writeerr:.*read-only/, t.text);
    assert.equal(existsSync(join(folder, "out.txt")), false, "nothing written");
    const { notes } = await notesOf(t.id);
    assert.ok(notes.includes("acp: cli leads team Builders (engine.team): its workers do the work — Filament's agent, worker and wait reach it over MCP — and its own tools only read, as its workers do: its team changes no file"), notes.join("\n"));
    // (fails before: yes — version 121: its part still said its own tools work as the developer's permission mode allows)
    const mine = lines(join(logs, "prompts.jsonl")).filter((p) => String(p.text).includes("~writefile")).at(-1);
    const system = String(lines(join(logs, "calls.jsonl")).find((c) => c.method === "session/new" && c.sessionId === mine?.sessionId)?.system || "");
    assert.ok(system.includes("Your own tools and your workers only read here, whatever the developer's permission mode says: you change no file and run no command that changes one."), system);
    assert.ok(!system.includes("Your own tools work as the developer's permission mode allows"), "its part promises it no write");
    /** What a worker's write was answered, among the requests since `mark`. @param {number} mark */
    const tried = (mark) => String(up.received.slice(mark).map((/** @type {any} */ c) => JSON.stringify(c.body?.messages || [])).find((/** @type {string} */ m) => m.includes("tool_result") && m.includes("tu_ww")));
    const refused = /Not run: this session is read-only, so write is not available\./;
    let mark = up.received.length;
    const w = await whole(id, `~mcpcall agent ${JSON.stringify(WRITER)}`);
    assert.match(w.text, /mcp:Launched builder sa_[0-9a-f]{8} /, w.text);
    assert.match(tried(mark), refused);
    const sa = (await subagentsOf(id)).find((/** @type {any} */ x) => x.team?.role === "builder");
    assert.deepEqual([sa?.status, sa?.work?.pending || 0], ["done", 0], "its Builder left no change to apply");
    // A task of its graph that a Builder does is launched the same.
    mark = up.received.length;
    const add = { action: "add", goal: "Write the file", tasks: [{ id: "t1", name: WRITER.description, by: "builder", goal: WRITER.goal, steps: WRITER.steps, acceptance: WRITER.acceptance, writes: ["worked.txt"] }] };
    assert.equal((await whole(id, `~mcpcall tasks ${JSON.stringify(add)}`)).status, 200);
    await until(async () => (await subagentsOf(id)).find((/** @type {any} */ x) => x.task === "t1" && x.status !== "running") || null, "the graph's Builder to end");
    assert.match(tried(mark), refused);
  } finally {
    await shim.api("/api/teams/builders", { method: "PUT", body: { readOnly: null } });
    rmSync(join(folder, "out.txt"), { force: true });
  }
});

// (fails before: yes — d-send's third follow-up, r-doors' left: a turn the session holds to reading — a /plan's, a
// watcher's wake that only reads — holds a lead's own tools and its workers whatever its team, and a lead whose team
// changes files still read that its own tools work as the permission mode allows, a one-line fix among its pieces)
/** Every lead's own hands, in a turn held to reading: held by the turn, never by its team. */
const HANDS_HELD = "- Brief a worker by default. This turn is held to reading, whatever the developer's permission mode says: in it your own hands and your workers only read, and work that changes a file waits for a turn that is not held. Take a piece yourself only where that is the better call: it is smaller than its brief would be — a file to read, a search, a command that confirms a report — or workers have failed it twice.";
/** A coding agent's lead's own tools, in a turn held to reading. */
const OWN_HELD = "Your own tools and your workers only read in this turn, whatever the developer's permission mode says: it is held to reading, so you change no file and run no command that changes one until a turn that is not held. Keep your own tools for the pieces better done yourself, and brief a worker for the rest.";
const OWN_FREE = "Your own tools work as the developer's permission mode allows: keep them for the pieces better done yourself, and brief a worker for the rest.";
test("a lead in a turn held to reading reads that in this turn its hands and its workers only read, because the turn is held; a free turn's lead, and a team that changes no file, read what they read", () => {
  const team = shippedTeam("builders");
  const hands = String(String(PROMPT.lead).split("\n").find((l) => l.startsWith("- Brief a worker by default.")));
  assert.ok(hands.includes("a one-line fix, a rename"), hands);
  for (const supervise of [false, true]) {
    const held = leadWords(team, { supervise, held: true });
    assert.equal(
      held,
      leadWords(team, { supervise }).replace(OWN_FREE, OWN_HELD).replace(hands, HANDS_HELD).replace(String(PROMPT.leadPermission), String(PROMPT.leadPermissionReads)),
      "those three sentences alone move",
    );
    for (const untrue of ["Your team changes no file", "its team changes no file", "a one-line fix, a rename", "work as the developer's permission mode allows", "declined it"]) assert.ok(!held.includes(untrue), untrue);
    assert.equal(leadWords(team, { supervise, held: false }), leadWords(team, { supervise }), "a free turn's lead reads what it read");
    const hunters = { ...team, readOnly: true };
    assert.equal(leadWords(hunters, { supervise, held: true }), leadWords(hunters, { supervise }), "a team that changes no file reads what it read");
  }
  for (const seat of [{}, { own: true }, { supervise: true }, { supervise: true, own: true }]) {
    assert.equal(leadLines({ ...seat, held: true }), leadLines(seat).replace(hands, HANDS_HELD), JSON.stringify(seat));
    assert.equal(leadLines({ ...seat, held: true, readOnly: true }), leadLines({ ...seat, readOnly: true }), JSON.stringify(seat));
  }
  // The loop lead's system prompt says the same: its hands' line and its permission sentence, held by the turn.
  /** @param {Record<string, unknown>} more */
  const loopLead = (more) => systemPromptFor({ root: "/w", delegateRead: false, lead: { name: "Builders", persona: team.persona, members: team.members, ...more } });
  const free = loopLead({});
  assert.ok(free.includes(`${hands}\n`) && free.includes(String(PROMPT.leadPermission)), "a free turn's");
  assert.equal(loopLead({ held: true }), free.replace(hands, HANDS_HELD).replace(String(PROMPT.leadPermission), String(PROMPT.leadPermissionReads)));
  assert.equal(loopLead({ held: true, readOnly: true }), loopLead({ readOnly: true }), "a team that changes no file: as it was");
});

// (fails before: yes — r-doors, 11-12: the lead's door fixed its workers' mode for a team that changes no file alone, so
// in a turn the session held to reading a Builder the lead briefed wrote worked.txt in its worktree, under the chat's
// Edit: its write was answered "Successfully wrote to worked.txt (20 bytes)" where the refusal stands now, under /plan
// and under a watcher's wake alike)
test("a turn the session holds to reading holds its lead's workers too, whatever the chat's mode and its team: a /plan's turn and a watcher's wake that only reads, by the lead's order and by its graph", async () => {
  const id = await newSession();
  /** A turn of the chat, as its body says it. @param {any} body */
  const post = async (body) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { ...body, stream: false } });
    const json = await r.json();
    return { status: r.status, json, text: (json.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""), id: String(r.headers.get("x-filament-request-id")) };
  };
  /** What a worker's write was answered, among the requests since `mark`. @param {number} mark */
  const tried = (mark) => String(up.received.slice(mark).map((/** @type {any} */ c) => JSON.stringify(c.body?.messages || [])).find((/** @type {string} */ m) => m.includes("tool_result") && m.includes("tu_ww")));
  const refused = /Not run: this session is read-only, so write is not available\./;
  /** The Builders the chat has launched, the newest last. */
  const builders = async () => (await subagentsOf(id)).filter((/** @type {any} */ x) => x.team?.role === "builder");
  /** A watcher's wake of the chat, as its runner posts one that only reads (app/routines.js `wakeChat`). @param {string} ask */
  const wake = (ask) => post({ by: "watch", content: [{ type: "text", text: `${WAKE_HEAD} “CI” of this chat's Space heard a post; the person's word comes before the watcher's.]\n${ask}` }] });

  // A /plan's turn: the lead's order.
  let mark = up.received.length;
  const planned = await post({ content: `~mcpcall agent ${JSON.stringify(WRITER)}`, plan: true });
  assert.equal(planned.status, 200, JSON.stringify(planned.json));
  assert.match(planned.text, /mcp:Launched builder sa_[0-9a-f]{8} /, planned.text);
  assert.match(tried(mark), refused, "a /plan's turn: its Builder's write");
  assert.deepEqual((await builders()).map((/** @type {any} */ x) => [x.status, x.work?.pending || 0]), [["done", 0]], "which left no change to apply");
  const { notes } = await notesOf(planned.id);
  assert.ok(notes.includes("acp: cli leads team Builders (engine.team): its workers do the work — Filament's agent, worker and wait reach it over MCP — and its own tools only read in this turn, as its workers do: the turn is held to reading"), notes.join("\n"));

  // A watcher's wake that only reads: the lead's order, then a task of its graph.
  mark = up.received.length;
  const woken = await wake(`~mcpcall agent ${JSON.stringify(WRITER)}`);
  assert.equal(woken.status, 200, JSON.stringify(woken.json));
  assert.match(woken.text, /mcp:Launched builder sa_[0-9a-f]{8} /, woken.text);
  assert.match(tried(mark), refused, "a watcher's wake: its Builder's write");
  assert.deepEqual((await builders()).map((/** @type {any} */ x) => [x.status, x.work?.pending || 0]), [["done", 0], ["done", 0]]);
  mark = up.received.length;
  const add = { action: "add", goal: "Write the file", tasks: [{ id: "t1", name: WRITER.description, by: "builder", goal: WRITER.goal, steps: WRITER.steps, acceptance: WRITER.acceptance, writes: ["worked.txt"] }] };
  assert.equal((await wake(`~mcpcall tasks ${JSON.stringify(add)}`)).status, 200);
  await until(async () => (await subagentsOf(id)).find((/** @type {any} */ x) => x.task === "t1" && x.status !== "running") || null, "the graph's Builder to end");
  assert.match(tried(mark), refused, "a watcher's wake: its graph's Builder's write");

  // The person's own turn after: the chat's mode again, and its Builder writes.
  mark = up.received.length;
  const own = await post({ content: `~mcpcall agent ${JSON.stringify(WRITER)}` });
  assert.match(own.text, /mcp:Launched builder sa_[0-9a-f]{8} /, own.text);
  assert.doesNotMatch(tried(mark), refused, "the chat's Edit, where no turn is held");
});

// (fails before: yes — d-send's third follow-up: a Builders lead on a coding agent, in a /plan's turn, opened with its
// team's lines — its own tools working as the chat's mode allows, a one-line fix among its pieces — while the turn held
// them and its workers to reading)
test("a coding agent that leads a team that changes files reads, in a turn held to reading, that its hands and its workers only read in it; the person's next turn says its own lines again", async () => {
  const id = await newSession();
  /** A turn of the chat, as its body says it. @param {any} body */
  const post = async (body) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { ...body, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** What the agent had for a prompt: its session's system channel, then the prompt as sent, Filament's context in it. @param {any} p */
  const had = (p) => `${String(lines(join(logs, "calls.jsonl")).find((c) => c.method === "session/new" && c.sessionId === p?.sessionId)?.system || "")}\n${String(p?.prompt || "")}`;
  const hands = String(String(PROMPT.lead).split("\n").find((l) => l.startsWith("- Brief a worker by default.")));
  await post({ content: "HELD-PLAN look at a.txt", plan: true });
  const held = had(promptWith("HELD-PLAN"));
  for (const said of [HANDS_HELD, OWN_HELD, String(PROMPT.leadPermissionReads)]) assert.ok(held.includes(said), said);
  for (const untrue of [hands, OWN_FREE, String(PROMPT.leadPermission), "Your team changes no file"]) assert.ok(!held.includes(untrue), untrue);
  await post({ content: "FREE-NEXT go on" });
  const next = /** @type {any} */ (promptWith("FREE-NEXT"));
  // Its part changed back, so its prompt says it again, whole, as a standing block that changed is said.
  for (const said of [hands, OWN_FREE, String(PROMPT.leadPermission)]) assert.ok(String(next.prompt).includes(said), said);
  assert.ok(!String(next.prompt).includes(HANDS_HELD), "nothing held in a free turn");
});

// (fails before: yes — the review of 38673a79a: the engine read a situate that failed as memory leaving the chat out, so
// that one turn went to the coding agent as named, with no team, and its note said memory leaves the chat out)
test("a turn whose situate failed is led by the chat's team as its other turns are: its coding agent leads, with its team's tools", async () => {
  const id = await newSession();
  // Memory's situate of this chat's own turn alone throws, as a busy file would.
  const brain = /** @type {any} */ (shim.app.memory).brain;
  const situate = brain.situate;
  let broke = false;
  /** @this {any} @param {any} args */
  brain.situate = function (args) {
    if (args?.headers?.["x-filament-chain"] !== id || args?.headers?.["x-filament-agent-of"]) return situate.call(this, args);
    brain.situate = situate;
    broke = true;
    throw new Error("the situate broke");
  };
  const t = await whole(id, "hello, lead whose situate failed").finally(() => (brain.situate = situate));
  assert.ok(broke, "its situate failed");
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const { notes } = await notesOf(t.id);
  assert.ok(notes.includes("engine: team Builders answers this session's turns (engine.team), its lead the coding agent coder-1"), notes.join("\n"));
  assert.ok(notes.some((n) => n.startsWith("acp: cli leads team Builders (engine.team)")), notes.join("\n"));
  assert.ok(!notes.some((n) => n.includes("memory leaves this chat out")), notes.join("\n"));
  const first = /** @type {any} */ (promptWith("hello, lead whose situate failed"));
  const listed = (await mcp(first.mcpUrl, "tools/list")).tools.map((/** @type {any} */ x) => x.name);
  assert.ok(["agent", "worker", "wait"].every((n) => listed.includes(n)), listed.join(", "));
});

// (fails before: yes — a coding agent led no team in a chat Memory settings leave out, from the review of b28b47713, when
// its turn there ran without the chat's surfaces, which rode memory's chain: its turn went to coder-out as named, with no
// team, and its order reached Filament's own sub-agent launcher, which answered "a sub-agent needs a task". Its turn
// rides the chat's session now, kept apart from memory)
test("in a chat Memory settings leave out its coding agent leads its team as in any chat, and nothing of memory's reaches the team's work: none of memory's tools on the lead's session or its worker's calls, no brief, nothing learned from the report", async () => {
  const OUT = 'model "coder-out" is excluded in Memory settings';
  const st = await (await shim.api("/api/state")).json();
  // Memory's autopilot on, as a person's memory has it: a worker's brief would be refused for that alone.
  const memoryCfg = { ...st.config.memory, autopilot: { ...(st.config.memory.autopilot || {}), enabled: true }, capture: { ...st.config.memory.capture, excludeModels: ["coder-out"] } };
  assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, memory: memoryCfg } })).status, 200);
  const mem = /** @type {any} */ (shim.app.memory);
  /** The briefs memory gave: for whom, the session, why it gave none, and how many items. @type {any[][]} */
  const briefs = [];
  /** The reports memory learned from. @type {any[]} */
  const learned = [];
  const brief = mem.brain.brief;
  const findings = mem.learner.findings;
  /** @this {any} @param {any} o */
  mem.brain.brief = async function (o) {
    const r = await brief.call(this, o);
    briefs.push([o?.purpose, o?.chainId, r?.why ?? null, r?.count ?? 0]);
    return r;
  };
  /** @this {any} @param {any} e */
  mem.learner.findings = function (e) {
    learned.push(e);
    return findings.call(this, e);
  };
  const LEFT = { ...SCOUT, description: "Map the left-out folder" };
  try {
    const id = await newSession("coder-out");
    const t = await whole(id, `~mcpcall agent ${JSON.stringify(LEFT)}`);
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.match(t.text, /mcp:Launched scout sa_[0-9a-f]{8} \("Map the left-out folder"\) in the background\./, t.text);
    const { notes } = await notesOf(t.id);
    assert.ok(notes.includes("engine: team Builders answers this session's turns (engine.team), its lead the coding agent coder-out"), notes.join("\n"));
    assert.ok(notes.includes(`memory: ${OUT} — the chat keeps its turns, and memory adds nothing to it`), notes.join("\n"));
    const first = /** @type {any} */ (promptWith("Map the left-out folder"));
    const listed = (await mcp(first.mcpUrl, "tools/list")).tools.map((/** @type {any} */ x) => String(x.name));
    assert.ok(["agent", "worker", "wait"].every((n) => listed.includes(n)), listed.join(", "));
    assert.deepEqual(listed.filter((n) => n.startsWith("filament_memory_")), [], "none of memory's tools on the lead's session");
    const [sa] = await subagentsOf(id);
    assert.deepEqual([sa.team?.role, sa.model, sa.status], ["scout", "m-1", "done"]);
    // Its worker's calls: none of memory's tools, and no brief; the chat's own record's filament_recall rides them.
    const calls = up.received.filter((c) => sysOf(c.body).includes(String(PROMPT.workerRole)) && JSON.stringify(c.body?.messages || []).includes("Map the left-out folder"));
    assert.ok(calls.length >= 1, "the worker's calls");
    for (const c of calls) {
      const names = (c.body?.tools || []).map((/** @type {any} */ x) => String(x.name));
      assert.deepEqual(names.filter((n) => n.startsWith("filament_memory_")), [], names.join(", "));
      assert.ok(names.includes("filament_recall"), names.join(", "));
      assert.doesNotMatch(JSON.stringify(c.body?.messages || []), /<memory>/);
    }
    assert.deepEqual(briefs.filter((b) => b[1] === id), [["subagent", id, OUT, 0]], "the worker's brief: none, for the chat's reason");
    assert.deepEqual(learned.filter((e) => e?.chain === id), [], "nothing learned from its report");
  } finally {
    mem.brain.brief = brief;
    mem.learner.findings = findings;
    assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
  }
});

// (fails before: yes — HarnessV4_Overnight_Plan OC-46 gave every coding agent the chat's own MCP servers but a lead,
// whose own tools only read; HarnessV4_Tasks decision 9 gives a lead them too)
test("a coding agent that leads its team is given the chat's own MCP servers, beside Filament's own with its team's tools", async () => {
  const settings = { engine: { mode: "team", team: "builders" }, subagents: { pool: [{ model: "m-1", seats: 4 }] }, plugins: { mcp: [{ name: "files", command: "node", args: ["files.mjs"] }] } };
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "coder-1", preset: "plain", settings } });
  assert.equal(r.status, 200, await r.clone().text());
  const t = await whole(String((await r.json()).id), "hello, lead with servers");
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const first = /** @type {any} */ (promptWith("hello, lead with servers"));
  const opened = lines(join(logs, "calls.jsonl")).find((c) => c.method === "session/new" && c.sessionId === first.sessionId);
  assert.ok(opened?.mcpUrl, "Filament's own server, with its team's tools");
  assert.deepEqual(opened.servers, ["files:stdio"], "and the chat's");
  const { notes } = await notesOf(t.id);
  assert.ok(notes.some((n) => /^mcp: the chat's MCP server given to .+: files \(stdio\)$/.test(n)), notes.join("\n"));
});

// (fails before: no — HarnessV4_Tasks decision 9 took a lead's own refusal away: a lead answers to the switch as any
// agent does, so read-only's refusal keeps its words, whoever asked)
test("the switch at read-only: a change is refused in the mode's words, a read runs, and a rule's refusal stays the rule's", () => {
  const mode = () => /** @type {const} */ ("read-only");
  const write = [{ name: "write", input: { path: "a.txt", content: "x" } }];
  const plain = createAgentPermits({ rules: [], modeNow: mode, learned: null });
  const j = plain.judge(write, folder);
  assert.deepEqual([j.verdict, j.how, j.why], ["refuse", "refused (read-only mode)", "this session's read-only mode"]);
  assert.equal(plain.judge([{ name: "read", input: { path: "a.txt" } }], folder).verdict, "run");
  const byRule = createAgentPermits({ rules: [{ tool: "write", pattern: "*", verdict: "deny" }], modeNow: mode, learned: null }).judge(write, folder);
  assert.ok(byRule.verdict === "refuse" && /^refused by the rule /.test(String(byRule.how)), JSON.stringify(byRule));
});

test("a message the developer sends while the lead waits for its worker wakes it in the loop's words; their stop ends its wait, its worker runs on, and its report waits for the session's next turn", async () => {
  const id = await newSession();
  const { res, runId } = await turn(id, `~mcpcall agent ${JSON.stringify(HELD)}`);
  // The lead's prompt ended with its worker running: the turn waits for it.
  await until(async () => (await runEvents(runId)).some((e) => e.type === "turn-state" && e.to === "waiting"), "the lead to wait for its worker");
  const note = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: TOLD } });
  assert.equal(note.status, 200, await note.clone().text());
  const woken = await until(async () => promptWith(heardBlock([{ text: TOLD }])), "the lead to hear the developer");
  const prompts = promptsOf(woken.sessionId);
  assert.equal(prompts.length, 2, "its wake is its second prompt");
  // It waits again for its worker; the developer stops the turn.
  await until(async () => (await runEvents(runId)).filter((e) => e.type === "turn-state" && e.to === "waiting").length >= 2, "the lead to wait again");
  const stop = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "stop" } });
  assert.equal(stop.status, 200);
  const said = await res.text();
  assert.match(said, /the developer stopped this turn after/);
  const { notes } = await notesOf(runId);
  assert.ok(notes.includes("acp: the developer stopped the turn while cli waited for its workers, who run on"), notes.join("\n"));
  const [held] = await subagentsOf(id);
  assert.equal(held.status, "running", "its worker runs on");
  release();
  await until(async () => (await subagentsOf(id))[0].status === "done", "the worker to finish");
  // Its report reaches the lead with the developer's next message, once.
  const next = await whole(id, "go on");
  assert.equal(next.status, 200, JSON.stringify(next.json));
  const told = promptsOf(woken.sessionId).filter((p) => String(p.text).includes(`[Filament: your scout ${held.id} ("Hold until released")`));
  assert.equal(told.length, 1, promptsOf(woken.sessionId).map((p) => p.text).join("\n----\n"));
  assert.ok(told[0].text.includes("HELD WORKER DONE"));
});

// (fails before: yes — the bug hunt of 10-30, SUB-1: a coding agent's Stop as a lead only let go of its task graph, so
// the worker at its task ran on, and the graph, never held, started more at the lead's next turn)
test("the developer's stop of a lead that runs its task graph holds the graph and stops the worker at its task, as the loop lead's stop does", async () => {
  const id = await newSession();
  const add = { action: "add", goal: "Know the folder", tasks: [{ id: "t1", name: HELD.description, by: "scout", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" }] };
  const { res, runId } = await turn(id, `~mcpcall tasks ${JSON.stringify(add)}`);
  try {
    const worker = await until(async () => (await subagentsOf(id)).find((s) => s.task === "t1" && s.status === "running"), "the graph's worker to start");
    await until(async () => (await runEvents(runId)).some((e) => e.type === "turn-state" && e.to === "waiting"), "the lead to wait for it");
    const stop = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "stop" } });
    assert.equal(stop.status, 200);
    assert.match(await res.text(), /the developer stopped this turn after/);
    /** The session's task graph as it keeps it now. @returns {any} */
    const graph = () => /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.graph;
    assert.equal(!!graph().held, true, "nothing of the graph starts until the lead's next tasks call");
    await until(async () => (await subagentsOf(id)).find((s) => s.id === worker.id)?.status === "stopped", "the worker at its task to stop");
    const t1 = await until(() => (graph().tasks[0].state === "waiting" ? graph().tasks[0] : null), "its task to wait again");
    assert.deepEqual([t1.stopped, t1.earlier?.agent], ["developer", worker.id]);
    const { notes } = await notesOf(runId);
    assert.ok(notes.includes("acp: the developer stopped the turn while cli waited for its workers, its task graph held and the workers at its tasks stopped; the others run on"), notes.join("\n"));
  } finally {
    release();
  }
});

// (fails before: yes — the lead's wake read every note queued into its heard block, the agent's own command among
// them: HarnessV3-FailurePoints finding 2)
test("the agent's own command sent while the lead waits for its worker is no word to it: it waits for the turn's end, as typed, and the words after it wake the lead", async () => {
  const id = await newSession();
  const { res, runId } = await turn(id, `~mcpcall agent ${JSON.stringify(HELD)}`);
  await until(async () => (await runEvents(runId)).some((e) => e.type === "turn-state" && e.to === "waiting"), "the lead to wait for its worker");
  /** The developer's note to the lead's run; its id. @param {string} text */
  const note = async (text) => {
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).message.id);
  };
  const held = await note("/review the diff");
  const words = await note(TOLD);
  const woken = await until(async () => promptWith(heardBlock([{ text: TOLD }])), "the lead to hear the developer");
  assert.ok(!promptsOf(woken.sessionId).some((p) => String(p.text).includes("/review the diff")), "the command is no word to the lead");
  release();
  await res.text();
  const reads = (await runEvents(runId)).filter((e) => e.type === "steer-read" || e.type === "steer-unread").map((e) => [e.type, e.ids]);
  assert.deepEqual(reads, [["steer-read", [words]], ["steer-unread", [held]]], "the command waits for the turn's end, to go as the next message");
  const { rec } = await notesOf(runId);
  assert.equal(rec.changes.filter((/** @type {string} */ c) => c === "acp: /review is cli's own command: sent while it worked, it waits for the turn's end and goes as the next message, as typed").length, 1, rec.changes.join("\n"));
});

// (fails before: no — a guard the mutation pass asked for: a lead's later prompt that forgot the agent's commands
// passed every test)
test("the agent's own command sent while the lead's later prompt works waits for the turn's end too", async () => {
  const id = await newSession("steerer-1");
  const { res, runId } = await turn(id, `~mcpcall agent ${JSON.stringify(HELD)}`);
  await until(async () => (await runEvents(runId)).some((e) => e.type === "turn-state" && e.to === "waiting"), "the lead to wait for its worker");
  /** The developer's note to the lead's run; its id. @param {string} text */
  const note = async (text) => {
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).message.id);
  };
  // Woken by the developer, the lead works again: a prompt of its turn's own after the first.
  await note("~steerable look again");
  await until(async () => promptWith("~steerable look again"), "the lead's next prompt");
  const held = await note("/review the diff");
  await until(async () => ((await notesOf(runId)).rec.priorChanges || []).some((/** @type {string} */ c) => c.startsWith("acp: /review is steerer's own command")) || null, "the command held");
  await note("that is all");
  release();
  await res.text();
  const reads = (await runEvents(runId)).filter((e) => e.type === "steer-unread").map((e) => e.ids);
  assert.deepEqual(reads, [[held]], "the command waits for the turn's end, to go as the next message");
  assert.ok(!lines(join(logs, "calls.jsonl")).some((c) => String(c.words || "").includes("/review the diff")), "never handed to the agent's turn");
});

test("a lead that took the developer's message into its running turn, then heard one more as its next prompt, is handed neither again at the session's next turn", async () => {
  const id = await newSession("steerer-1");
  const { res, runId } = await turn(id, "~steerable");
  await until(async () => (await runEvents(runId)).some((e) => e.type === "round-start"), "the lead to work");
  // Sent together, to interrupt it (FP-D8): the one it takes ends its turn, and the other, handed back, wakes it as its
  // next prompt. (A plain note is queued at Claude, which runs it itself: HarnessV3-FailurePoints §7.2.)
  const sent = await Promise.all(["that is all", "one more thing"].map((text) => shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text, from: "harness", interrupt: true } })));
  assert.deepEqual(sent.map((r) => r.status), [200, 200]);
  await res.text();
  const { notes } = await notesOf(runId);
  assert.ok(notes.includes("acp: a message sent while steerer worked interrupted it and went into its running turn"), notes.join("\n"));
  assert.ok(notes.includes("acp: steerer woken in the same turn: 1 of the developer's"), notes.join("\n"));
  const next = await whole(id, "and now the docs");
  assert.equal(next.status, 200, JSON.stringify(next.json));
  assert.ok(!String(promptWith("and now the docs")?.text).includes("Meanwhile"), "nothing handed again as another assistant's");
  const after = await notesOf(next.id);
  assert.ok(!after.notes.some((n) => n.includes("handled elsewhere")), after.notes.join("\n"));
});

// (fails before: no — a guard the mutation pass asked for: a worker's report that waited for its lead's prompt to end
// passed every test)
// The report goes in sealed, as its envelope's line (HarnessV4_Envelopes_Plan EN3): the lead works.
test("a worker's report that lands while its lead works goes into the lead's running turn", async () => {
  const id = await newSession("steerer-1");
  const { res, runId } = await turn(id, `~mcpcall agent ${JSON.stringify(SCOUT)} ~steerable`);
  await until(() => lines(join(logs, "calls.jsonl")).some((c) => c.method === "queued prompt" && /\[Filament: envelope \d+, sealed — from your scout sa_/.test(String(c.words))), "the report's line to be queued at the lead");
  const said = await res.text();
  assert.match(said, /heard:\[Filament: envelope \d+, sealed — from your scout sa_[0-9a-f]{8}/);
  const { notes } = await notesOf(runId);
  assert.ok(notes.includes("acp: 1 message from Filament went into steerer's running turn"), notes.join("\n"));
  const first = /** @type {any} */ (promptWith(`~mcpcall agent ${JSON.stringify(SCOUT)} ~steerable`));
  const prompts = promptsOf(first.sessionId).map((p) => String(p.text));
  assert.equal(prompts.length, 2, "no prompt of its own: the line went into the one running, and the turn's end said the envelope once");
  assert.match(prompts[1], /\[Filament: one envelope is still sealed \(envelope \d+, from your scout sa_[0-9a-f]{8}/);
});

// (fails before: no — a guard the mutation pass asked for: a later prompt of the lead's turn that no message could
// reach passed every test)
test("a later prompt of the lead's turn takes the developer's message into its running turn, as its first did", async () => {
  const id = await newSession("steerer-1");
  const { res, runId } = await turn(id, "~steerable for a later prompt");
  const first = await until(() => promptWith("~steerable for a later prompt"), "the lead to work");
  await until(async () => (await runEvents(runId)).some((e) => e.type === "round-start"), "its round");
  const note = (/** @type {string} */ text) => shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text, from: "harness" } });
  // Sent together, to interrupt it (FP-D8): whichever it takes ends its prompt; the other, handed back, is its next —
  // which works on until a word comes. That word is a plain note, queued at Claude (HarnessV3-FailurePoints §7.2).
  const interrupt = (/** @type {string} */ text) => shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text, from: "harness", interrupt: true } });
  assert.deepEqual((await Promise.all(["~steerable one", "~steerable two"].map(interrupt))).map((r) => r.status), [200, 200]);
  await until(() => promptsOf(first.sessionId).length === 2, "its next prompt");
  assert.equal((await note("the last word")).status, 200);
  // The word waits in Filament for the lead's next call (HarnessV4_Tasks C34): the fake makes one when told.
  const ticks = join(logs, "ticks");
  mkdirSync(ticks, { recursive: true });
  writeFileSync(join(ticks, "tick"), "");
  await until(() => lines(join(logs, "calls.jsonl")).some((c) => c.method === "queued prompt" && c.words === "the last word"), "the word to be queued in its later prompt");
  assert.match(await res.text(), /heard:the last word/);
  const { rec } = await notesOf(runId);
  const into = rec.changes.filter((/** @type {string} */ n) => n === "acp: a message sent while steerer worked interrupted it and went into its running turn" || n === "acp: a message sent while steerer worked was queued and went in at its next step");
  assert.equal(into.length, 2, rec.changes.join("\n"));
});

// (fails before: no — a guard the mutation pass asked for: no worker's report reached its lead after the lead's cycle
// had ended, so Claude running it as its next prompt was said as taken into the cycle)
test("a worker's report that reaches its lead as its cycle ends runs as the lead's next prompt, and the turn says so", async () => {
  const gates = join(logs, "gates");
  rmSync(gates, { recursive: true, force: true });
  mkdirSync(gates);
  const id = await newSession("steerer-1");
  const { res, runId } = await turn(id, `~mcpcall agent ${JSON.stringify(HELD)} ~queue`);
  const first = await until(() => promptWith(`~mcpcall agent ${JSON.stringify(HELD)} ~queue`), "the lead to work");
  for (const step of ["q1", "q2"]) writeFileSync(join(gates, step), "");
  await until(async () => (await runEvents(runId)).some((e) => e.type === "tool-end" && e.id === "q2"), "the lead's last step");
  release();
  // Its own lead's: an earlier test's report may lie queued in the same log.
  await until(() => lines(join(logs, "calls.jsonl")).some((c) => c.method === "queued prompt" && c.sessionId === first.sessionId && String(c.words).includes('("Hold until released")')), "the report to be queued at the lead");
  writeFileSync(join(gates, "end"), "");
  // It reached the lead at work: sealed, as its envelope's line (HarnessV4_Envelopes_Plan EN3).
  assert.match(await res.text(), /next:\[Filament: envelope \d+, sealed — from your scout sa_[0-9a-f]{8}/);
  const { notes } = await notesOf(runId);
  assert.ok(notes.includes("acp: 1 message from Filament ran as steerer's next prompt: its turn had ended first"), notes.join("\n"));
  rmSync(gates, { recursive: true, force: true });
});

// (fails before: yes — the review of 11-10: an agent that takes no MCP server over HTTP was refused as a lead, though ACP
// asks every agent to take one over stdio; the relay carries the team's tools to it. And the re-read's finding 17: no
// call went through the relay, so this passed with a relay that never answered one; the fake now starts the relay and
// calls the agent tool through it)
test("an agent that takes no MCP server over HTTP leads: the team's tools reach it through the relay over stdio", async () => {
  const id = await newSession("deaf-1");
  const t = await whole(id, `~mcpcall agent ${JSON.stringify(SCOUT)}`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.match(t.text, /mcp:Launched scout sa_[0-9a-f]{8} \("Map the folder"\) in the background\./, "the launch, answered through the relay");
  const { notes, rec } = await notesOf(t.id);
  assert.ok(notes.some((/** @type {string} */ n) => /deaf takes no MCP server over HTTP \(mcpCapabilities\.http\): Filament's tools reach it over stdio, through Filament's relay/.test(n)), notes.join("\n"));
  assert.equal(rec.failure ?? null, null);
});
