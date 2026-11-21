// @ts-check
// The remote-agents plan's s-tools: where this Filament keeps a machine for its agents (services/machines, an agents'
// device in remotes.json), the agent tool — the loop's and a coding agent's — takes machine, list_machines and cwd, and
// its text says in one sentence where such a sub-agent runs. A Filament with none sends the tool it always sent, byte
// for byte: the cache stays whole for everyone else (prompt version 96). c-tools does the same for bash_background and
// a coding agent's background_command: machine and cwd, and one sentence (the same version).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { PROMPT_VERSION, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { AGENT_TOOL, COMMAND_MACHINE_FIELDS, coderAgentToolFor, keepsAgentsMachine, launchKey, loopToolArgs } from "../src/app/agent/tools.js";
import { BACKGROUND_COMMAND_TOOL, createBackgroundCommands } from "../src/app/agent/commands.js";
import { HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { asV116Tools, asV119Tools, asV122Tools } from "./helpers/team.js";

const sha = (/** @type {unknown} */ x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
// The tools a Filament with no agents' machine sends, whole: main's, byte for byte (version 105's, pinned again as main's
// was merged). A release that changes them on purpose pins them again; version 117 moved the agent tool's line on what
// a sub-agent goes without alone, read back as version 116's (asV116Tools); version 120 a coding agent's task field
// alone, read back as version 119's (asV119Tools); version 122 both tools' stop and their sentences on it (ag-stop), read
// back as version 121's by the same two, first of all; version 127 both tools' attach, read back as version 126's by
// the same two, first of all.
const LOOP_AGENT_TOOL_SHA = "4bdb16d0b07eeea317232afc2947400321f00400a6d941ca85bf176a4226b6f4";
const CODER_AGENT_TOOL_SHA = "d8a867a55fe7ae3e2de6c91d3ab45293e946b5a8931d167c654a77044d514311";
const CODER_LAUNCH_KEY = "084fed08b978af4d";
// bash_background as main sends it, whole (version 105's; version 123 adds its sentence on the filtered environment,
// which asV122Tools takes back). background_command's words name this machine's shell, so it is held to the tool as it
// is defined (`BACKGROUND_COMMAND_TOOL`) and its own fields instead.
const BASH_BACKGROUND_SHA = "d8f77193cf181d430f5ecb7c385b8b739e20d8bac50aee0c5002db20188acffb";
const BASH_BACKGROUND_KEYS = ["command", "grace", "watch"];
const BACKGROUND_COMMAND_KEYS = ["command", "description", "id", "stop", "list"];
const COMMAND_MACHINE_KEYS = ["machine", "cwd"];
/** bash_background as the hands define it. */
const OWN_BASH_BACKGROUND = /** @type {any} */ (HAND_TOOLS.find((t) => t.name === "bash_background"));
/** A tool as a coding agent's list gives it, in the shape the loop's are. @param {any} t */
const asDefined = (t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema });
const OWN_KEYS = ["description", "prompt", "subagent_type", "saved_agent", "model", "provider", "effort", "run_in_background", "agent_id", "stop", "apply_changes", "overlap", "mark_applied", "sync", "context", "changes", "attach", "list_models"];
const CODER_KEYS = ["description", "prompt", "subagent_type", "saved_agent", "model", "provider", "effort", "run_in_background", "agent_id", "stop", "apply_changes", "overlap", "mark_applied", "sync", "task", "context", "changes", "attach", "list_models"];
const MACHINE_KEYS = ["machine", "cwd", "list_machines"];
/** @type {import("../src/app/agent/tools.js").Askable[]} */
const ASKS = [
  { tag: "pm", name: "PM", goodFor: "Scope, priority and what to leave out.", may: "read", from: null },
  { tag: "designer", name: "Designer", goodFor: "How it reads and feels", may: "read", from: null },
];
/** A row of remotes.json: `scope` "agent" for an agents' device, "full" for the person's. */
const remote = (/** @type {string} */ name, /** @type {string} */ scope) => ({ name, url: "https://127.0.0.1:1", token: `tok-${name}-${scope}`, machine: { id: `id-${name}`, name }, device: { id: `dev-${name}`, name: "here", scope }, connectedAt: 1 });
/** The machines store as the agent tools read it, counting its reads. @param {any[]} rows */
const storeOf = (rows) => {
  const s = { reads: 0, list: () => (s.reads++, rows.map(({ token: _t, ...m }) => m)) };
  return s;
};

test("the version is 107", () => {
  assert.equal(PROMPT_VERSION, 129);
});

// (fails before: no — it guards that a Filament with no agents' machine sends the agent tool it always sent, byte for
// byte, both the loop's and a coding agent's, and the word a coding agent's session is opened under)
describe("no machine kept for its agents: the tool as it was", () => {
  test("the loop's agent tool and a coding agent's, whole, and the session's word", () => {
    for (const set of [loopToolArgs({}), loopToolArgs({ machines: false }), loopToolArgs({ machines: true, disabled: ["agent"] })]) {
      const agent = set.find((t) => t.name === "agent");
      if (agent) assert.equal(agent, AGENT_TOOL);
    }
    assert.equal(sha(asV116Tools(AGENT_TOOL)), LOOP_AGENT_TOOL_SHA);
    assert.deepEqual(Object.keys(AGENT_TOOL.input_schema.properties), OWN_KEYS);
    // With the agent tool off, bash_background still takes machine (c-tools, below); with both off, nothing moves.
    assert.equal(sha(loopToolArgs({ machines: true, disabled: ["agent", "bash_background"] })), sha(loopToolArgs({ disabled: ["agent", "bash_background"] })), "with the agent tool and bash_background off, nothing moves");
    const coder = coderAgentToolFor({ asks: [], machines: false });
    assert.equal(coder, coderAgentToolFor({ asks: [] }));
    assert.equal(sha(asV119Tools(coder)), CODER_AGENT_TOOL_SHA);
    assert.deepEqual(Object.keys(coder.input_schema.properties), CODER_KEYS);
    assert.equal(launchKey({ asks: [], machines: false }), CODER_LAUNCH_KEY);
    assert.equal(launchKey({ asks: [] }), CODER_LAUNCH_KEY);
  });

  test("a person's device alone is no machine for its agents", () => {
    assert.equal(keepsAgentsMachine(null), false);
    assert.equal(keepsAgentsMachine(/** @type {any} */ (storeOf([]))), false);
    assert.equal(keepsAgentsMachine(/** @type {any} */ (storeOf([remote("Mac", "full")]))), false);
    assert.equal(keepsAgentsMachine(/** @type {any} */ (storeOf([remote("Mac", "full"), remote("Mac", "agent")]))), true);
  });
});

// (fails before: yes — the agent tool had no machine, list_machines or cwd, and its text never said a sub-agent could run
// on another machine, though a launch there was taken: no model knew to ask for one)
describe("a machine kept for its agents: machine, list_machines and cwd", () => {
  test("the loop's agent tool: its three fields after its own, its sentence after its text; a lead's has none", () => {
    const agent = loopToolArgs({ machines: true }).find((t) => t.name === "agent");
    assert.notEqual(agent, AGENT_TOOL);
    assert.ok(Object.isFrozen(agent));
    assert.equal(agent.description, `${TOOL_TEXT.agent} ${TOOL_TEXT.agentMachine}`);
    assert.deepEqual(Object.keys(agent.input_schema.properties), [...OWN_KEYS, ...MACHINE_KEYS]);
    const p = agent.input_schema.properties;
    assert.deepEqual([p.machine.type, p.cwd.type, p.list_machines.type], ["string", "string", "boolean"]);
    for (const k of OWN_KEYS) assert.equal(JSON.stringify(p[k]), JSON.stringify(AGENT_TOOL.input_schema.properties[k]), `${k} as it was`);
    assert.equal(loopToolArgs({ machines: true }).find((t) => t.name === "agent"), agent, "one frozen tool, the same bytes each turn");
    // Saved agents named too: the sentence stays with the tool's own text, the list after it.
    const named = loopToolArgs({ machines: true, asks: ASKS }).find((t) => t.name === "agent");
    assert.ok(named.description.startsWith(`${TOOL_TEXT.agent} ${TOOL_TEXT.agentMachine}\n\n${TOOL_TEXT.agentAsk} `), named.description);
    assert.deepEqual(Object.keys(named.input_schema.properties), [...OWN_KEYS, ...MACHINE_KEYS]);
    const lead = loopToolArgs({ machines: true, lead: true, graph: true });
    assert.equal(sha(lead), sha(loopToolArgs({ lead: true, graph: true })), "a lead launches its team's members, never on another machine");
  });

  test("a coding agent's copy: the same fields and sentence, under 2,048 characters, its session's word another", () => {
    const tool = coderAgentToolFor({ asks: [], machines: true });
    assert.equal(tool.description, `${TOOL_TEXT.coderOwn} ${TOOL_TEXT.coderAgent} ${TOOL_TEXT.agentMachine}`);
    assert.ok(tool.description.length < 2048, `${tool.description.length}: whole where a client cuts a long description (Claude Code: 2,048 characters)`);
    assert.deepEqual(Object.keys(tool.input_schema.properties), [...CODER_KEYS, ...MACHINE_KEYS]);
    assert.equal(tool.input_schema.properties.machine, loopToolArgs({ machines: true }).find((t) => t.name === "agent").input_schema.properties.machine);
    const named = coderAgentToolFor({ asks: ASKS, machines: true });
    assert.ok(named.description.endsWith(`${TOOL_TEXT.coderAgent} ${TOOL_TEXT.agentMachine}`));
    assert.ok(named.description.indexOf("`designer`") < 2048, "whom it may ask still stands inside what a client that cuts keeps");
    assert.notEqual(launchKey({ asks: [], machines: true }), CODER_LAUNCH_KEY, "a changed tool is a changed word: the session takes it as it opens");
    assert.notEqual(launchKey({ asks: ASKS, machines: true }), launchKey({ asks: ASKS }));
    const held = coderAgentToolFor({ asks: [], machines: true, held: true });
    assert.equal(held.description, `${TOOL_TEXT.coderOwnHeld} ${TOOL_TEXT.coderAgent} ${TOOL_TEXT.agentMachine}`);
    assert.ok(held.description.length < 2048, `${held.description.length}: held back and on a machine, still whole`);
  });

  // (fails before: yes — the hunt on s-tools: the tool's own words said to apply a sub-agent's changes, which one on
  // another machine refuses, and list_models with machine said nothing of what model and provider do there)
  // (fails before: yes — cp-back: the sentence said a sub-agent there was never applied here, its own copy's change too)
  test("its sentence says a sub-agent in its own copy there comes back to apply, one in a folder there stays there; its fields say how list_models reads there and that list_machines answers beside it", () => {
    assert.match(TOOL_TEXT.agentMachine, /\(list_machines lists them\): with no cwd, in its own copy of this chat's folder there \(where this folder is in git\), what it changes coming back here as a local sub-agent's does, for apply_changes or mark_applied \(sync and send_back do not reach that copy; what git ignores, a secret's file or a file over 100 MB goes neither there nor back\); with cwd, or where that machine takes no copy, in that folder or its clone of this project there, what it changes staying there: have it commit its own change alone, on a branch of its own, and push that branch, then fetch it here\. Its report comes back here either way\./);
    const p = /** @type {any} */ (loopToolArgs({ machines: true }).find((t) => t.name === "agent")).input_schema.properties;
    assert.match(p.machine.description, /With list_models, the models that answer there, by name alone: model narrows them by name, provider not at all\.$/);
    assert.match(p.list_machines.description, /With list_models, both lists\.$/);
    assert.doesNotMatch(TOOL_TEXT.agentMachine, /—|--/, "no dash pair in the tool's words");
  });

  // (fails before: yes — the swarm's review of 11-10: one cwd field for both said a launch with none ran in its clone
  // there, where it works in its own copy, and told the agent to have the person's clone there committed and pushed whole)
  test("cwd: a launch's says its own copy there, a command's its clone; neither commits the person's work there", () => {
    const tools = loopToolArgs({ machines: true });
    const launch = /** @type {any} */ (tools.find((t) => t.name === "agent")).input_schema.properties.cwd.description;
    const command = /** @type {any} */ (tools.find((t) => t.name === "bash_background")).input_schema.properties.cwd.description;
    assert.equal(launch, "With machine: the folder there it works in. Left out: its own copy of this chat's folder there, or, where that machine makes none, its clone of this project there, found by its git remote.");
    assert.equal(command, "With machine: the folder there it runs in. Left out: its clone of this project there, found by its git remote.");
    assert.doesNotMatch(TOOL_TEXT.agentMachine, /commit and push there, then pull here/);
  });

  test("a coding agent's tool list reads the store once a list, and offers machine only while one is kept for its agents", () => {
    /** @type {any[]} */
    let rows = [];
    const store = { reads: 0, list: () => (store.reads++, rows.map(({ token: _t, ...m }) => m)) };
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => /** @type {any} */ ({ offer: () => ({ asks: [] }) }), membersOf: () => null, machines: /** @type {any} */ (store) });
    const ctx = /** @type {any} */ ({ cwd: tmpdir(), upstream: "claude-code", chain: "c1", turn: null, graph: false, launch: true });
    const agentOf = () => /** @type {any} */ (tools.list(ctx).find((t) => t.name === "agent"));
    const none = agentOf();
    assert.equal(store.reads, 1);
    assert.equal(sha(asV119Tools({ name: none.name, description: none.description, input_schema: none.inputSchema })), CODER_AGENT_TOOL_SHA, "none kept: the tool as it was");
    rows = [remote("Mac", "full")];
    assert.equal(sha(asV119Tools({ name: agentOf().name, description: agentOf().description, input_schema: agentOf().inputSchema })), CODER_AGENT_TOOL_SHA, "the person's device alone: as it was");
    rows = [remote("Mac", "full"), remote("Mac", "agent")];
    const kept = agentOf();
    assert.deepEqual(Object.keys(kept.inputSchema.properties), [...CODER_KEYS, ...MACHINE_KEYS]);
    assert.ok(kept.description.endsWith(TOOL_TEXT.agentMachine));
    // A call given no agent tool (a sub-agent's, a lead's) never reads the store.
    const before = store.reads;
    tools.list(/** @type {any} */ ({ ...ctx, launch: false }));
    assert.equal(store.reads, before);
  });

  // (fails before: yes — a chat whose meta could not be read was read as the person's: machine was offered on it)
  test("a chat whose meta cannot be read is taken as another machine's agents': its agent tool offers no machine", () => {
    const store = { list: () => [remote("Mac", "full"), remote("Mac", "agent")].map(({ token: _t, ...m }) => m) };
    const memory = /** @type {any} */ ({ archive: { metaOf: () => { throw new SyntaxError("Unexpected token } in JSON at position 3"); } } });
    const tools = createAgentTools({ memory, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => /** @type {any} */ ({ offer: () => ({ asks: [] }) }), membersOf: () => null, machines: /** @type {any} */ (store) });
    const tool = /** @type {any} */ (tools.list(/** @type {any} */ ({ cwd: tmpdir(), upstream: "claude-code", chain: "c1", turn: null, graph: false, launch: true })).find((t) => t.name === "agent"));
    assert.deepEqual(Object.keys(tool.inputSchema.properties), CODER_KEYS);
  });
});

// (fails before: no — it guards that a Filament with no agents' machine sends bash_background and background_command as
// they always were, byte for byte)
describe("c-tools, no machine kept for its agents: the commands' tools as they were", () => {
  test("bash_background, whole, in every set; background_command as it is defined", () => {
    assert.equal(sha(asV122Tools(OWN_BASH_BACKGROUND)), BASH_BACKGROUND_SHA);
    assert.deepEqual(Object.keys(OWN_BASH_BACKGROUND.input_schema.properties), BASH_BACKGROUND_KEYS);
    for (const set of [loopToolArgs({}), loopToolArgs({ machines: false }), loopToolArgs({ machines: false, disabled: ["agent"] }), loopToolArgs({ machines: true, lead: true })])
      assert.equal(set.find((t) => t.name === "bash_background"), OWN_BASH_BACKGROUND);
    assert.deepEqual(Object.keys(BACKGROUND_COMMAND_TOOL.input_schema.properties), BACKGROUND_COMMAND_KEYS);
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => /** @type {any} */ ({ offer: () => ({ asks: [] }) }), membersOf: () => null, machines: /** @type {any} */ (storeOf([remote("Mac", "full")])), commands: createBackgroundCommands() });
    const offered = tools.list(/** @type {any} */ ({ cwd: tmpdir(), upstream: "claude-code", chain: "c1", turn: null, graph: false, launch: true })).find((t) => t.name === "background_command");
    assert.equal(JSON.stringify(asDefined(offered)), JSON.stringify(BACKGROUND_COMMAND_TOOL), "the person's device alone: as it was");
  });
});

// (fails before: yes — bash_background and background_command took no machine: a command ran on this machine alone, and
// no text said it could run on another)
describe("c-tools, a machine kept for its agents: machine and cwd on the commands' tools", () => {
  test("bash_background: its two fields after its own, its sentence after its text, on its own switch; a lead's has none", () => {
    const bg = /** @type {any} */ (loopToolArgs({ machines: true }).find((t) => t.name === "bash_background"));
    assert.notEqual(bg, OWN_BASH_BACKGROUND);
    assert.ok(Object.isFrozen(bg));
    assert.equal(bg.description, `${OWN_BASH_BACKGROUND.description} ${TOOL_TEXT.commandMachine}`);
    assert.deepEqual(Object.keys(bg.input_schema.properties), [...BASH_BACKGROUND_KEYS, ...COMMAND_MACHINE_KEYS]);
    assert.deepEqual(bg.input_schema.required, ["command"]);
    for (const k of BASH_BACKGROUND_KEYS) assert.equal(JSON.stringify(bg.input_schema.properties[k]), JSON.stringify(OWN_BASH_BACKGROUND.input_schema.properties[k]), `${k} as it was`);
    const agent = /** @type {any} */ (loopToolArgs({ machines: true }).find((t) => t.name === "agent"));
    // Its own cwd since the swarm's review of 11-10: a command left without one runs in the clone, a launch in its copy.
    assert.equal(bg.input_schema.properties.cwd, COMMAND_MACHINE_FIELDS.cwd, "cwd is a command's own");
    assert.notEqual(bg.input_schema.properties.cwd.description, agent.input_schema.properties.cwd.description);
    assert.equal(loopToolArgs({ machines: true }).find((t) => t.name === "bash_background"), bg, "one frozen tool, the same bytes each turn");
    // On its own switch: with the agent tool off it still takes machine; switched off, it is gone and the agent's stays.
    assert.equal(loopToolArgs({ machines: true, disabled: ["agent"] }).find((t) => t.name === "bash_background"), bg);
    const noBg = loopToolArgs({ machines: true, disabled: ["bash_background"] });
    assert.ok(!noBg.some((t) => t.name === "bash_background"));
    assert.equal(noBg.find((t) => t.name === "agent"), agent);
    assert.equal(sha(loopToolArgs({ machines: true, lead: true, graph: true })), sha(loopToolArgs({ lead: true, graph: true })), "a lead's commands run here");
    assert.ok(TOOL_TEXT.commandMachine.length < 300, "one short sentence");
  });

  test("a coding agent's background_command: the same two fields and sentence, the store read once a list, none for a lead", () => {
    /** @type {any[]} */
    let rows = [remote("Mac", "full"), remote("Mac", "agent")];
    const store = { reads: 0, list: () => (store.reads++, rows.map(({ token: _t, ...m }) => m)) };
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => /** @type {any} */ ({ offer: () => ({ asks: [] }), asks: () => [] }), membersOf: () => null, machines: /** @type {any} */ (store), commands: createBackgroundCommands() });
    const ctx = /** @type {any} */ ({ cwd: tmpdir(), upstream: "claude-code", chain: "c1", turn: null, graph: false, launch: true });
    const list = tools.list(ctx);
    assert.equal(store.reads, 1, "one read for the agent tool and background_command both");
    const bg = /** @type {any} */ (list.find((t) => t.name === "background_command"));
    assert.equal(bg.description, `${BACKGROUND_COMMAND_TOOL.description} ${TOOL_TEXT.commandMachine}`);
    assert.deepEqual(Object.keys(bg.inputSchema.properties), [...BACKGROUND_COMMAND_KEYS, ...COMMAND_MACHINE_KEYS]);
    assert.equal(JSON.stringify(bg.inputSchema.properties.machine), JSON.stringify(COMMAND_MACHINE_FIELDS.machine));
    assert.deepEqual(Object.keys(/** @type {any} */ (list.find((t) => t.name === "agent")).inputSchema.properties).slice(-3), MACHINE_KEYS);
    // A team's lead runs its commands here: its background_command is the tool as it was.
    const lead = tools.list(/** @type {any} */ ({ ...ctx, launch: false, team: true })).find((t) => t.name === "background_command");
    assert.equal(JSON.stringify(asDefined(lead)), JSON.stringify(BACKGROUND_COMMAND_TOOL));
    rows = [];
    assert.equal(JSON.stringify(asDefined(tools.list(ctx).find((t) => t.name === "background_command"))), JSON.stringify(BACKGROUND_COMMAND_TOOL), "none kept again: as it was");
  });
});

// (fails before: yes — a turn's agent tool never said machine, whatever this Filament kept)
describe("a loop turn: the store read as the turn's tools are built", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {any[]} */
  let bodies = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-machines-tool-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      bodies.push(call.body);
      return anthropicReply("", { model: call.body.model, stop: "end_turn", blocks: [{ type: "text", text: "Done." }], usage: { input_tokens: 30, output_tokens: 4 } });
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    for (const dir of [shim?.dataDir, root]) {
      try {
        if (dir) rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  /** One turn on a fresh session: the agent tool its first request carried, and the turn's record. */
  const turn = async () => {
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/m-1", preset: "plain", settings: {} } })).json();
    bodies = [];
    const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: "say hello", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    await r.json();
    const rec = /** @type {any} */ (await shim.record(r.headers.get("x-filament-request-id")));
    const sent = bodies.find((b) => Array.isArray(b.tools));
    assert.ok(sent, "the turn sent its tools");
    return { agent: sent.tools.find((/** @type {any} */ t) => t.name === "agent"), bg: sent.tools.find((/** @type {any} */ t) => t.name === "bash_background"), rec };
  };
  const keep = (/** @type {any[]} */ rows) => writeFileSync(join(shim.dataDir, "remotes.json"), `${JSON.stringify({ remotes: rows }, null, 2)}\n`);
  const LINE = "agent: this Filament keeps a machine for its agents: the agent tool takes machine, list_machines and cwd";
  const BG_LINE = "agent: this Filament keeps a machine for its agents: bash_background takes machine and cwd, and runs its command there";

  test("none kept, then the person's device alone: the agent tool as it was; an agents' device: its three fields and sentence", async () => {
    const none = await turn();
    assert.equal(sha(asV116Tools(none.agent)), LOOP_AGENT_TOOL_SHA, "the bytes it always sent");
    assert.ok(!(none.rec.changes || []).includes(LINE));
    // c-tools (fails before: no for these two — bash_background was always sent so): as it was, and no line.
    assert.equal(sha(asV122Tools(none.bg)), BASH_BACKGROUND_SHA, "bash_background's bytes as it always sent them");
    assert.ok(!(none.rec.changes || []).includes(BG_LINE));
    keep([remote("Mac", "full")]);
    const person = await turn();
    assert.equal(sha(asV116Tools(person.agent)), LOOP_AGENT_TOOL_SHA, "a machine paired for the person, not for its agents");
    assert.equal(sha(asV122Tools(person.bg)), BASH_BACKGROUND_SHA);
    keep([remote("Mac", "full"), remote("Mac", "agent")]);
    const kept = await turn();
    assert.deepEqual(Object.keys(kept.agent.input_schema.properties), [...OWN_KEYS, ...MACHINE_KEYS]);
    assert.equal(kept.agent.description, `${TOOL_TEXT.agent} ${TOOL_TEXT.agentMachine}`);
    assert.ok(kept.rec.changes.includes(LINE), kept.rec.changes.join("\n"));
    // c-tools (fails before: yes — bash_background took no machine): its two fields and sentence, and its line.
    assert.deepEqual(Object.keys(kept.bg.input_schema.properties), [...BASH_BACKGROUND_KEYS, ...COMMAND_MACHINE_KEYS]);
    assert.equal(kept.bg.description, `${OWN_BASH_BACKGROUND.description} ${TOOL_TEXT.commandMachine}`);
    assert.ok(kept.rec.changes.includes(BG_LINE), kept.rec.changes.join("\n"));
  });

  // (fails before: yes — turn.js read a meta it could not read as the person's chat's: its turn was offered the machine
  // kept for this Filament's agents, the browser and the web, where server.js and the agent tools read it as theirs)
  test("a chat whose meta cannot be read runs its turn as another machine's agents' chat: no machine, browser or web; read again, the person's", async () => {
    keep([remote("Mac", "agent")]);
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const metaOf = archive.metaOf;
    archive.metaOf = (/** @type {string} */ id, /** @type {string[]} */ keys) => {
      if (Array.isArray(keys) && keys.includes("agentDevice")) throw new SyntaxError("Unexpected token in JSON at position 3");
      return metaOf.call(archive, id, keys);
    };
    /** @type {Awaited<ReturnType<typeof turn>>} */
    let unread;
    try {
      unread = await turn();
    } finally {
      archive.metaOf = metaOf;
    }
    assert.deepEqual(Object.keys(unread.agent.input_schema.properties), OWN_KEYS, "no machine");
    assert.deepEqual(Object.keys(unread.bg.input_schema.properties), BASH_BACKGROUND_KEYS);
    const names = bodies.find((b) => Array.isArray(b.tools)).tools.map((/** @type {any} */ t) => t.name);
    for (const off of ["browser", "web_fetch", "web_search"]) assert.ok(!names.includes(off), `${off} is not offered: ${names.join(", ")}`);
    assert.ok(unread.rec.changes.some((/** @type {string} */ c) => /could not be read: the turn runs as theirs/.test(c)), unread.rec.changes.join("\n"));
    const read = await turn();
    assert.deepEqual(Object.keys(read.agent.input_schema.properties), [...OWN_KEYS, ...MACHINE_KEYS], "read, the person's: machine is offered");
  });
});
