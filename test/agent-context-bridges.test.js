// @ts-check
// HarnessV3-ACP AC4 through each bridge, against the fakes: Filament's standing context in the agent's own channel —
// Claude's system prompt, Codex's developer instructions, ahead of the first prompt elsewhere — and what changed since
// ahead of the next prompt, said again after the agent's compaction; memory's recall after the person's words;
// Filament's own tools where the session stands, the task graph coming or going reopening a session; the bare retry.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FIXTURES } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { TurnBridge } from "../src/adapters/agents/turn-bridge.js";
import { CONTEXT_HEAD, UPDATE_HEAD, standingText } from "../src/adapters/agents/context.js";
import { COMPACTED_WORDS, COMPACTION_HEADER, LINE_HEADER } from "../src/adapters/agents/compactions.js";
import { agentContext, CODER_GRAPH_TEXT } from "../src/app/agent-context.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { isMemoryTool } from "../src/app/memory-tools.js";
import { applyTasks } from "../src/core/task-graph.js";
import { McpToolServer } from "../src/http/mcp.js";

const quiet = () => {};
const MCP_BASE = "http://127.0.0.1:9";
/** A block as memory places it. @param {string} kind @param {string} text */
const block = (kind, text) => `<filament-memory kind="${kind}">\n${text}\n</filament-memory>`;
const RECALL = block("recall", "R");
/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * One turn's request as memory prepared it, and its context as the agent path lifts it (app/acp-turn.js).
 * @param {string} text @param {{ briefing?: string, goal?: string | null, graph?: boolean, history?: any[] }} [o]
 */
function prepared(text, { briefing = "B1", goal = null, graph = false, history = [] } = {}) {
  const body = {
    model: "m",
    max_tokens: 100,
    system: [block("briefing", briefing), ...(goal ? [block("goal", goal)] : [])].join("\n\n"),
    messages: [...history, { role: "user", content: `${text}\n\n${RECALL}` }],
  };
  const context = agentContext({ format: "anthropic", body, graph });
  return { body, context };
}
/** The chat so far: each message, then its echo. @param {string[]} said */
const echoed = (...said) => said.flatMap((t) => [{ role: "user", content: t }, { role: "assistant", content: `Echo: ${t}` }]);

/** Filament's own tools, as the server builds them: memory's on for the bridges, the graph's through a runner. */
const tools = {
  ...createAgentTools({
    memory: null,
    memoryToolsOn: () => false,
    turns: createAgentTurns(),
    subagents: () => null,
    membersOf: () => null,
    graphs: () => ({
      apply: (/** @type {string} */ _chain, /** @type {any} */ input, /** @type {any} */ opts) => {
        const r = applyTasks(null, input, { at: 1, ...opts });
        return r.ok ? { ok: true, text: r.text, view: { goal: r.graph?.goal } } : { ok: false, error: r.error };
      },
    }),
  }),
  memoryOn: () => true,
};
/** Filament's own tools with memory on and open: a chat memory works in lists memory's tools. */
const withMemory = createAgentTools({ memory: { enabled: () => true, isOpen: () => true }, memoryToolsOn: () => true, turns: createAgentTurns(), subagents: () => null, membersOf: () => null, graphs: () => null });

let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-agent-context-"));
});
after(async () => {
  await removeDirs(dir);
});

describe("an ACP agent (AC4-1, AC4-4, AC4-5)", () => {
  /** @type {AcpBridge} */ let bridge;
  before(() => {
    bridge = new AcpBridge({ log: quiet });
    bridge.agentTools = tools;
  });
  after(() => bridge.shutdown());
  /** @param {string} id @param {Record<string, string>} [env] */
  const upstream = (id, env = {}) => ({
    id,
    name: id,
    type: "acp",
    acp: { command: process.execPath, args: [join(FIXTURES, "fake-acp-agent.mjs")], env: { FAKE_ACP_CALLS: join(dir, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(dir, `${id}-prompts.jsonl`), ...env }, cwdDefault: dir, permissions: "allow-all" },
  });
  /** @param {any} up @param {string} text @param {any} [o] @param {boolean} [graph] */
  async function turn(up, text, o = {}, graph = false) {
    const { body, context } = prepared(text, o);
    /** @type {any[]} */
    const events = [];
    const out = await bridge.run({ upstream: up, modelId: o.model || "fake-a", format: "anthropic", body, conversationId: o.chat || "chat", onEvent: (/** @type {any} */ ev) => events.push(ev), mcpBase: o.mcpBase || MCP_BASE, context, toolsAt: { chain: "ch_1", turn: "t_1", graph, team: !!o.team }, ...(o.reseed ? { reseed: o.reseed } : {}) });
    return { out, events, context };
  }

  test("Claude's system prompt carries it as each session opens; a change goes ahead of the next prompt; the graph's switch reopens the session", async () => {
    const up = upstream("claudeish", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    const calls = () => lines(join(dir, "claudeish-calls.jsonl"));
    const sent = () => lines(join(dir, "claudeish-prompts.jsonl")).map((p) => p.prompt);
    const first = await turn(up, "hello");
    const [open] = calls().filter((c) => c.method === "session/new");
    assert.equal(open.system, standingText(first.context.standing));
    assert.match(open.mcpUrl, /^http:\/\/127\.0\.0\.1:9\/mcp\/[0-9a-f]{24}$/, "memory's tools over Filament's MCP server");
    assert.equal(sent().at(-1), `hello\n\n${RECALL}`, "nothing ahead: the system prompt has it; the recall after the words");
    assert.deepEqual([first.out.given.system, first.out.given.said, first.out.given.recall], [["briefing"], undefined, ["recall"]]);
    assert.ok(first.out.notes.some((/** @type {string} */ n) => /^acp: Filament's context — briefing in Claude's system prompt; memory's recall after the person's words/.test(n)), first.out.notes.join("\n"));

    await turn(up, "again", { briefing: "B2" });
    assert.equal(sent().at(-1), `${UPDATE_HEAD}\n\n${block("briefing", "B2")}\n\n---\nagain\n\n${RECALL}`);
    await turn(up, "and again", { briefing: "B2" });
    assert.equal(sent().at(-1), `and again\n\n${RECALL}`, "said once");

    const onGraph = await turn(up, "plan it", { briefing: "B2", graph: true }, true);
    const reopened = calls().filter((c) => c.method === "session/resume").at(-1);
    assert.equal(reopened?.sessionId, onGraph.out.sessionId, "the same session, opened again");
    assert.notEqual(reopened.mcpUrl, open.mcpUrl, "at a new MCP address");
    assert.ok(reopened.system.includes(CODER_GRAPH_TEXT), "the graph's words in the system prompt it reopened with");
    assert.equal(sent().at(-1), `plan it\n\n${RECALL}`);
    const token = String(reopened.mcpUrl).split("/").pop();
    const ctx = bridge.contextForMcpToken(token);
    assert.deepEqual([ctx?.chain, ctx?.graph, ctx?.native], ["ch_1", true, false]);
    assert.equal(bridge.contextForMcpToken(String(open.mcpUrl).split("/").pop()), null, "the old address stands for nothing");

    await turn(up, "set a goal", { briefing: "B2", graph: true, goal: "Ship v2" }, true);
    assert.match(String(sent().at(-1)), /^Filament's context for this session changed since your last message:\n\n<filament-memory kind="goal">/);
    await turn(up, "~compact", { briefing: "B2", graph: true, goal: "Ship v2" }, true);
    await turn(up, "go on", { briefing: "B2", graph: true, goal: "Ship v2" }, true);
    assert.equal(sent().at(-1), `${UPDATE_HEAD}\n\n${block("goal", "Ship v2")}\n\n---\ngo on\n\n${RECALL}`, "the goal said again after Claude compacted; the system prompt's stays");
  });

  // (fails before: yes — the trial of 11-11 with Antigravity 1.4.5 signed in: it declares a system channel of its own,
  // `_meta.antigravity.systemPrompt.append`, and takes Claude's shape nowhere, so Filament's context went ahead of its
  // first prompt, as for an agent with no channel)
  test("Antigravity's own system channel carries it as each session opens, never in Claude's shape; a session opened again with the same tools keeps it", async () => {
    const up = upstream("agyish", { FAKE_ACP_AGY_PROMPT: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    const calls = () => lines(join(dir, "agyish-calls.jsonl"));
    const sent = () => lines(join(dir, "agyish-prompts.jsonl")).map((p) => p.prompt);
    const first = await turn(up, "hello", { chat: "agy" });
    const [open] = calls().filter((c) => c.method === "session/new");
    assert.deepEqual([open.agySystem, open.system, open.agySnapshot], [standingText(first.context.standing), undefined, undefined], "its own channel alone, with no `snapshot`, which is Claude's");
    assert.equal(sent().at(-1), `hello\n\n${RECALL}`, "nothing ahead: its system prompt has it");
    assert.deepEqual([first.out.given.system, first.out.given.said], [["briefing"], undefined]);
    assert.ok(first.out.notes.some((/** @type {string} */ n) => /^acp: Filament's context — briefing in Antigravity's system prompt/.test(n)), first.out.notes.join("\n"));
    await turn(up, "on another model", { chat: "agy", briefing: "B2", model: "fake-b" });
    const reopened = calls().filter((c) => /^session\/(resume|load)$/.test(c.method)).at(-1);
    assert.equal(reopened?.sessionId, first.out.sessionId, "the same session, opened again in the other model's process");
    assert.deepEqual([reopened.agySystem, reopened.system], [open.agySystem, undefined], "the words it was opened with, in its own channel");
    assert.equal(sent().at(-1), `${UPDATE_HEAD}\n\n${block("briefing", "B2")}\n\n---\non another model\n\n${RECALL}`, "the briefing that changed, ahead of the prompt");
  });

  // (fails before: yes — the cache audit's sa_e6d289ec: every open again wrote Claude's system prompt from the context
  // as it stood, so a session reopened with the same tools — Filament restarted, another model's process, a session its
  // agent lost — sent its agent a system prompt other than the one its cache was written with)
  test("a session opened again with the same tools keeps the system prompt it was opened with; what changed goes ahead of the prompt", async () => {
    const up = upstream("keptish", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    const calls = () => lines(join(dir, "keptish-calls.jsonl"));
    const sent = () => lines(join(dir, "keptish-prompts.jsonl")).map((p) => p.prompt);
    const first = await turn(up, "hello", { chat: "kept" });
    const [open] = calls().filter((c) => c.method === "session/new");
    const moved = await turn(up, "on another model", { chat: "kept", briefing: "B2", model: "fake-b" });
    const reopened = calls().filter((c) => /^session\/(resume|load)$/.test(c.method)).at(-1);
    assert.equal(reopened?.sessionId, first.out.sessionId, "the same session, opened again in the other model's process");
    assert.equal(reopened.system, open.system, "the system prompt it was opened with");
    assert.equal(reopened.snapshot, false);
    assert.equal(sent().at(-1), `${UPDATE_HEAD}\n\n${block("briefing", "B2")}\n\n---\non another model\n\n${RECALL}`, "the briefing that changed, ahead of the prompt");
    assert.deepEqual([moved.out.given.system, moved.out.given.said?.added], [undefined, ["briefing"]], "nothing new in the system prompt; the briefing said");
    await turn(up, "and back", { chat: "kept", briefing: "B2" });
    assert.equal(calls().filter((c) => /^session\/(resume|load)$/.test(c.method)).at(-1).system, open.system, "and so again, back in the first model's");
    assert.equal(sent().at(-1), `and back\n\n${RECALL}`, "said once");
  });

  // (fails before: no — a guard the review of b1f4c556b asked for: a failed turn tells a prompt that failed before its
  // session began from one that failed in it by the facts each prompt handed back, the object its session event carried)
  test("a turn's result is the facts its session event carried, the object itself", async () => {
    const { out, events } = await turn(upstream("factsacp"), "hello", { chat: "facts" });
    assert.equal(events.find((e) => e.type === "session")?.facts, out);
  });

  test("a session whose agent starts leading a team opens again, its MCP server carrying the team's tools; one that takes no MCP server over HTTP leads through the relay", async () => {
    const up = upstream("leadish", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    const calls = () => lines(join(dir, "leadish-calls.jsonl"));
    const first = await turn(up, "hello", { chat: "lead" });
    const [open] = calls().filter((c) => c.method === "session/new");
    assert.equal(bridge.contextForMcpToken(String(open.mcpUrl).split("/").pop())?.team, false);
    const led = await turn(up, "lead them", { chat: "lead", team: true });
    const reopened = calls().filter((c) => c.method === "session/resume").at(-1);
    assert.equal(reopened?.sessionId, first.out.sessionId, "the same session, opened again");
    assert.equal(bridge.contextForMcpToken(String(reopened.mcpUrl).split("/").pop())?.team, true);
    assert.ok(led.out.notes.some((/** @type {string} */ n) => n.endsWith("resumed again: the task graph, memory's tools, the team it leads, what Filament's agent tool offers it, or the project's Space, changed the tools it takes")), led.out.notes.join("\n"));
    // (fails before: yes — the review of 11-10: an agent that takes no MCP server over HTTP could not lead; the relay
    // carries the team's tools to it over stdio)
    const deaf = upstream("deafish", { FAKE_ACP_MCP_CAPS: "none" });
    await turn(deaf, "lead them", { chat: "deaf", team: true });
    const deafOpen = lines(join(dir, "deafish-calls.jsonl")).filter((c) => c.method === "session/new").at(-1);
    assert.equal(deafOpen.servers, undefined, "Filament's own server alone, as the relay");
    assert.equal(bridge.contextForMcpToken(String(deafOpen.mcpUrl).split("/").pop())?.team, true, "its team's tools reach it");
  });

  // (fails before: yes — the review of 21d92f3df: a session kept the tools it opened with when Memory settings came to
  // leave its chat out: the agent was offered memory's tools there, and told by Filament's server as it connected that it
  // has them, on every request; and a chat taken back in was offered none of them until a new session)
  test("a session whose chat Memory settings come to leave out opens again without memory's tools; taken back in, it opens again with them", async () => {
    const b = new AcpBridge({ log: quiet });
    b.agentTools = withMemory;
    const mcp = new McpToolServer({ bridge: b, tools: withMemory });
    /** What Filament's server told the agent of itself as it connected, oldest first. @type {string[]} */
    const told = [];
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const end = res.end.bind(res);
        /** @type {any} */ (res).end = (/** @type {any} */ s) => {
          const words = JSON.parse(String(s ?? "null"))?.result?.instructions;
          if (typeof words === "string") told.push(words);
          return end(s);
        };
        void mcp.handle(req, res, String(req.url).split("/").pop(), raw);
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    const mcpBase = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
    const up = upstream("memout", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    /** A turn of the chat, its task graph on. `leftOut`: Memory settings leave the chat out now. @param {string} text @param {boolean} leftOut */
    const say = (text, leftOut) => {
      const { body, context } = prepared(text, { graph: true });
      return b.run({ upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "memout", onEvent: () => {}, mcpBase, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: true, team: false, leftOut } });
    };
    /** How many of Filament's tools such a session lists. @param {boolean} leftOut */
    const listing = (leftOut) => withMemory.list({ cwd: "", upstream: "", chain: "ch_1", turn: null, graph: true, leftOut }).length;
    try {
      const first = await say("hello", false);
      const out = await say("left out", true);
      const still = await say("still out", true);
      const back = await say("taken back in", false);
      const opens = lines(join(dir, "memout-calls.jsonl")).filter((c) => /^session\/(new|resume|load)$/.test(c.method));
      assert.deepEqual(opens.map((c) => [c.method, c.sessionId]), [["session/new", first.sessionId], ["session/resume", first.sessionId], ["session/resume", first.sessionId]], "the same session, opened again as memory left the chat out and as it took it back in, and not in between");
      assert.equal(new Set(opens.map((c) => c.mcpUrl)).size, 3, "each time at a new MCP address");
      assert.ok(listing(false) > listing(true), "memory's tools are among those a chat memory works in lists");
      assert.deepEqual(lines(join(dir, "memout-prompts.jsonl")).map((p) => p.mcpTools), [listing(false), listing(true), listing(true), listing(false)], "what the agent listed as its session opened");
      assert.deepEqual(told.map((w) => /its memory tools search and keep/.test(w)), [true, false, true], "what Filament's server told it as it connected");
      for (const r of [out, back]) assert.ok(r.notes.some((/** @type {string} */ n) => n.endsWith("resumed again: the task graph, memory's tools, the team it leads, what Filament's agent tool offers it, or the project's Space, changed the tools it takes")), r.notes.join("\n"));
      assert.equal(still.notes.some((/** @type {string} */ n) => / again: /.test(n)), false, still.notes.join("\n"));
    } finally {
      b.shutdown();
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  // (fails before: yes — the cache audit's sa_e6d289ec: Filament's server read the sub-agent a session is, and a card
  // without the Space, from its turn alone, and the agent lists its tools as its session opens, before the turn is the
  // session's: a sub-agent's first list had no envelope to its lead, and the Space its card leaves out)
  test("a sub-agent's session lists, as it opens, the tools its turns list: its envelope to its lead, and no Space where its card has none", async () => {
    const b = new AcpBridge({ log: quiet });
    b.agentTools = withMemory;
    const mcp = new McpToolServer({ bridge: b, tools: withMemory });
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => void mcp.handle(req, res, String(req.url).split("/").pop(), raw));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    const mcpBase = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
    const up = upstream("subish", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    const by = { id: "sa_00000001", exchange: 1, name: "Audit" };
    try {
      const { body, context } = prepared("look into it");
      await b.run({ upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "subish", onEvent: () => {}, mcpBase, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: false, team: false, by, space: false } });
      const names = withMemory.list({ cwd: "", upstream: "", chain: "ch_1", turn: null, graph: false, by, space: false }).map((t) => t.name);
      assert.ok(names.includes("envelope") && !withMemory.list({ cwd: "", upstream: "", chain: "ch_1", turn: null, graph: false }).some((t) => t.name === "envelope"), names.join(", "));
      assert.deepEqual(lines(join(dir, "subish-prompts.jsonl")).map((p) => p.mcpTools), [names.length], "what it listed as its session opened");
    } finally {
      b.shutdown();
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  // (fails before: yes — the bug hunt of 11-08: who the session is and its card's want of the Space were read off the
  // token the session opened with alone, which the sweep lets go of 30 minutes on — a sub-agent's turn running longer
  // lost them: its background_command refused, its envelope to its lead gone, and the Space its card has none of given)
  test("a sub-agent's turn that runs past the 30 minutes its opening token is kept stays its own: who it is, and no Space where its card has none", async () => {
    const b = new AcpBridge({ log: quiet });
    b.agentTools = tools;
    const up = upstream("longish", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SLOW_MS: "4000" });
    const by = { id: "sa_00000002", exchange: 1, name: "Builder" };
    try {
      const { body, context } = prepared("~slowstart build it");
      const running = b.run({ upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "longish", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: false, team: false, by, space: false } });
      const conv = /** @type {any} */ (await until(() => [...b.convs.values()].find((c) => c.mcpToken && c.upstreamId === "longish") || null, "its session"));
      b.sweep(Date.now() + 31 * 60_000);
      const ctx = b.contextForMcpToken(conv.mcpToken);
      assert.deepEqual([ctx?.chain, ctx?.by, ctx?.space], ["ch_1", by, false], "its turn runs: the session is still the sub-agent's");
      await running;
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — sa_b28facdc's lead of 11-01: a session opened again with none of Filament's servers — memory's
  // tools its only ones, its chat come to be left out — kept its old token, so Filament's server still answered at the
  // old address as the session's)
  test("a session opened again with none of Filament's servers is found at its old address no more", async () => {
    const b = new AcpBridge({ log: quiet });
    b.agentTools = withMemory;
    const up = upstream("memonly", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    const calls = () => lines(join(dir, "memonly-calls.jsonl"));
    /** A turn of the chat, no tool of Filament's but memory's. @param {string} text @param {boolean} leftOut */
    const say = (text, leftOut) => {
      const { body, context } = prepared(text);
      return b.run({ upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "memonly", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: false, team: false, leftOut } });
    };
    try {
      const first = await say("hello", false);
      const [open] = calls().filter((c) => c.method === "session/new");
      const token = String(open.mcpUrl).split("/").pop();
      assert.equal(b.contextForMcpToken(token)?.chain, "ch_1", "memory's tools at its address");
      await say("left out", true);
      const reopened = calls().filter((c) => c.method === "session/resume").at(-1);
      assert.deepEqual([reopened?.sessionId, reopened?.mcpUrl ?? null], [first.sessionId, null], "the same session, opened again with no server of Filament's");
      assert.equal(b.contextForMcpToken(token), null, "its old address stands for nothing");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: no — a guard the mutation pass asked for: an agent that connected as its session reopened at the
  // address it had was listed no team tools, and passed every test)
  test("a session reopened in a process of its own — a model switch, or Filament's restart — as its chat starts to lead lists the team's tools as it connects", async () => {
    const mcp = new McpToolServer({ bridge, tools });
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => void mcp.handle(req, res, String(req.url).split("/").pop(), raw));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    const mcpBase = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
    try {
      const up = upstream("relead", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
      const calls = () => lines(join(dir, "relead-calls.jsonl"));
      await turn(up, "plan it", { chat: "relead", mcpBase }, true);
      await turn(up, "lead them", { chat: "relead", mcpBase, team: true, model: "fake-b" }, true);
      const [open] = calls().filter((c) => c.method === "session/new");
      const reopened = calls().filter((c) => c.method === "session/resume").at(-1);
      assert.deepEqual([reopened?.sessionId, reopened?.mcpUrl, reopened?.pid === open.pid], [open.sessionId, open.mcpUrl, false], "the same session at the same address, in another process");
      const listed = lines(join(dir, "relead-prompts.jsonl")).map((p) => p.mcpTools);
      assert.deepEqual(listed, [2, 6], "the graph's tool and the checklist; then the lead's tasks, the checklist, agent, worker, wait and envelope");
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  // (fails before: yes — after Filament's restart no turn of the session is held while it opens again, and its list went
  // out without the tools that need the chat: the graph's, a plain chat's agent and wait. Seen live once Claude Code read
  // its tools as they stand, AG-77: a chat resumed after a restart had no agent tool. Its address is a new one: the
  // session map keeps no token on disk, the bug hunt of 10-30)
  test("after Filament's restart a session opens again at a new address and lists its chat's tools as it connects", async () => {
    const stateFile = join(dir, "restarted-state.json");
    /** @type {McpToolServer | null} */
    let mcp = null;
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => void mcp?.handle(req, res, String(req.url).split("/").pop(), raw));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    const mcpBase = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
    const up = upstream("restarted", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    /** Filament, started: its bridge on the state file, its tools on the address the sessions were given. */
    const started = () => {
      const b = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
      b.agentTools = tools;
      mcp = new McpToolServer({ bridge: b, tools });
      return b;
    };
    /** @param {AcpBridge} b @param {string} text */
    const say = (b, text) => {
      const { body, context } = prepared(text, { graph: true });
      return b.run({ upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "restarted", onEvent: () => {}, mcpBase, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: true, team: false } });
    };
    const one = started();
    /** @type {AcpBridge | null} */
    let two = null;
    try {
      const first = await say(one, "plan it");
      await until(() => existsSync(stateFile) && readFileSync(stateFile, "utf8").includes(String(first.sessionId)), "the chat saved, for a restart to read");
      one.shutdown();
      two = started();
      const second = await say(two, "go on");
      const calls = lines(join(dir, "restarted-calls.jsonl"));
      const [open] = calls.filter((c) => c.method === "session/new");
      const reopened = calls.filter((c) => c.method === "session/resume").at(-1);
      const token = (/** @type {any} */ c) => String(c?.mcpUrl).split("/").pop() || "";
      assert.deepEqual([second.sessionId, reopened?.sessionId, reopened?.pid === open.pid], [first.sessionId, open.sessionId, false], "the same session, in another process");
      assert.notEqual(token(reopened), token(open), "at a new address: no token was kept on disk");
      assert.deepEqual([two.contextForMcpToken(token(reopened))?.conv?.sessionId, two.contextForMcpToken(token(open))], [open.sessionId, null], "the new token stands for the chat's session, the old for nothing");
      assert.deepEqual(lines(join(dir, "restarted-prompts.jsonl")).map((p) => p.mcpTools), [2, 2], "the graph's tool and the checklist, as it opened and as it opened again");
    } finally {
      one.shutdown();
      two?.shutdown();
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  // (fails before: no — a guard the mutation pass asked for: no test sent a turn after a compaction Filament asked for)
  test("after its own compaction asked for (Compact now under the way own, AC5-5), what was said ahead of the prompts is said again", async () => {
    const up = upstream("ownc", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_OWN_COMPACT: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    const sent = () => lines(join(dir, "ownc-prompts.jsonl")).map((p) => p.prompt);
    await turn(up, "hello");
    await turn(up, "set a goal", { goal: "Ship v2" });
    await turn(up, "and on", { goal: "Ship v2" });
    assert.equal(sent().at(-1), `and on\n\n${RECALL}`, "said once");
    await bridge.compactOwn({ upstream: up, conversationId: "chat", keep: "", fork: false, record: () => 1 });
    await turn(up, "go on", { goal: "Ship v2" });
    assert.equal(sent().at(-1), `${UPDATE_HEAD}\n\n${block("goal", "Ship v2")}\n\n---\ngo on\n\n${RECALL}`, "the goal said again; the system prompt's stays");
  });

  test("an agent with no system channel hears it whole ahead of its first prompt, once", async () => {
    const up = upstream("plain");
    const sent = () => lines(join(dir, "plain-prompts.jsonl")).map((p) => p.prompt);
    const first = await turn(up, "hello");
    assert.equal(lines(join(dir, "plain-calls.jsonl")).find((c) => c.method === "session/new")?.system, undefined);
    assert.equal(sent().at(-1), `${CONTEXT_HEAD}\n\n${block("briefing", "B1")}\n\n---\nhello\n\n${RECALL}`);
    assert.deepEqual(first.out.given.said, { added: ["briefing"], removed: [], whole: true });
    await turn(up, "again");
    assert.equal(sent().at(-1), `again\n\n${RECALL}`);
  });

  test("the bare retry: a seeded first prompt refused for its size goes once more without the earlier conversation, in a new session", async () => {
    const up = upstream("tight", { FAKE_ACP_OVERFLOW_SEEDED: "1", FAKE_ACP_SESSION_CAPS: "close" });
    const r = await turn(up, "two", { history: echoed("one"), chat: "tight" });
    const opened = lines(join(dir, "tight-calls.jsonl")).filter((c) => c.method === "session/new").map((c) => c.sessionId);
    assert.equal(opened.length, 2, "a fresh session");
    assert.ok(lines(join(dir, "tight-calls.jsonl")).some((c) => c.method === "session/close" && c.sessionId === opened[0]), "the refused one let go");
    assert.equal(r.out.sessionId, opened[1]);
    assert.equal(r.out.seeded, false);
    assert.ok(r.events.some((e) => e.type === "text" && e.own && /the earlier conversation was too long for .* so it goes on without it, in a new session\./.test(e.text)), JSON.stringify(r.events.filter((e) => e.type === "text")));
    assert.ok(r.out.notes.includes("acp: the earlier conversation was too long for the agent (overflow): this new session goes on without it"), r.out.notes.join("\n"));
    assert.ok(!String(lines(join(dir, "tight-prompts.jsonl")).at(-1)?.prompt).includes("Earlier conversation"));
  });

  // (fails before: yes — words sent as the session opened went to the agent ahead of the turn's prompt; Claude ran them
  // as its first prompt)
  test("words into the turn wait for its prompt: a turn stopped before its prompt went out hands them back, never sent", async () => {
    const up = upstream("before-prompt", { FAKE_ACP_STEERING: "1" });
    const ac = new AbortController();
    /** @type {Promise<any> | null} */
    let sent = null;
    const { body, context } = prepared("hello");
    const out = await bridge.run({
      upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "before-prompt", signal: ac.signal, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: false, team: false },
      onEvent: (/** @type {any} */ ev) => {
        if (ev.type !== "session" || !ev.steer) return;
        sent = ev.steer.send("one more thing");
        ac.abort();
      },
    });
    assert.equal(out.stopReason, "cancelled");
    assert.equal(await sent, false, "handed back: it goes as the next message");
    assert.ok(!lines(join(dir, "before-prompt-calls.jsonl")).some((c) => c.method === "_session/steering"), "never sent to the agent");
  });

  // (fails before: yes — a harness chat's refused seed went bare too: HarnessV3-FailurePoints D9)
  test("a harness chat's refused seed: Filament compacts its copy, and a new session starts from that — or, refused again, goes bare", async () => {
    const up = upstream("reseeds", { FAKE_ACP_OVERFLOW_SEEDED: "1", FAKE_ACP_SESSION_CAPS: "close" });
    const opened = () => lines(join(dir, "reseeds-calls.jsonl")).filter((c) => c.method === "session/new").map((c) => c.sessionId);
    const said = (/** @type {any} */ r) => r.events.filter((/** @type {any} */ e) => e.type === "text" && e.own).map((/** @type {any} */ e) => e.text);
    // The compacted chat as Filament composes it: the compaction's id rides the request, and the seed says so.
    let asked = 0;
    const compacted = (/** @type {string} */ id) => async () => {
      asked++;
      return { body: prepared("two", { history: echoed("one, briefly") }).body, headers: { [COMPACTION_HEADER]: id } };
    };
    const r = await turn(up, "two", { history: echoed("one"), chat: "reseeds-a", reseed: compacted("7") });
    assert.equal(asked, 1);
    assert.equal(opened().length, 2, "the refused session, then a fresh one");
    assert.equal(r.out.sessionId, opened()[1]);
    assert.equal(r.out.seeded, true);
    assert.deepEqual(said(r), ["_filament: the earlier conversation was too long for reseeds to take in, so Filament compacts its copy of it, and a new session starts from that._\n\n"]);
    const seed = String(lines(join(dir, "reseeds-prompts.jsonl")).at(-1)?.prompt);
    assert.ok(seed.includes(`${COMPACTED_WORDS}:`) && seed.includes("one, briefly"), seed.slice(0, 300));
    // A compaction the agent refuses too: the message goes bare.
    const again = await turn(up, "two", { history: echoed("one"), chat: "reseeds-b", reseed: compacted("0") });
    assert.equal(opened().length, 5, "the refused session, the refused compaction's, then a bare one");
    assert.equal(again.out.seeded, false);
    assert.deepEqual(said(again).slice(1), ["_filament: compacted, the earlier conversation was still too long for reseeds to take in, so it goes on without it, in a new session._\n\n"]);
  });
});

describe("Codex (AC4-1, AC4-2, AC4-4, AC4-5)", () => {
  /** @type {CodexBridge} */ let bridge;
  before(() => {
    bridge = new CodexBridge({ log: quiet, stateFile: join(dir, "codex-sessions.json") });
    bridge.agentTools = tools;
  });
  after(() => bridge.shutdown());
  /** @param {string} id @param {Record<string, string>} [env] */
  const upstream = (id, env = {}) => ({
    id,
    name: id,
    type: "codex",
    acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(dir, `${id}.jsonl`), ...env }, cwdDefault: dir, permissions: "allow-all" },
  });
  /** @param {string} id @param {string} method */
  const heard = (id, method) => lines(join(dir, `${id}.jsonl`)).filter((m) => m.method === method);
  /** @param {any} up @param {string} text @param {any} [o] @param {boolean} [graph] */
  async function turn(up, text, o = {}, graph = false) {
    const { body, context } = prepared(text, o);
    /** @type {any[]} */
    const events = [];
    const out = await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body, conversationId: o.chat || "chat", onEvent: (/** @type {any} */ ev) => events.push(ev), mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_2", turn: "t_2", graph, team: !!o.team }, ...(o.reseed ? { reseed: o.reseed } : {}) });
    return { out, events, context };
  }
  /** The text of the newest turn/start. @param {string} id */
  const said = (id) => heard(id, "turn/start").at(-1)?.params.input[0].text;

  test("the developer instructions carry it as the thread opens, Filament's MCP server rides its config; a change goes ahead; the switch opens it again", async () => {
    const up = upstream("cx");
    const first = await turn(up, "hello");
    const [start] = heard("cx", "thread/start");
    assert.equal(start.params.developerInstructions, standingText(first.context.standing));
    const url = start.params.config["mcp_servers.filament"].url;
    assert.match(url, /^http:\/\/127\.0\.0\.1:9\/mcp\/[0-9a-f]{24}$/);
    assert.equal(start.params.config["mcp_servers.filament"].default_tools_approval_mode, "approve", "Filament's tools run without Codex asking the person first");
    assert.equal(said("cx"), `hello\n\n${RECALL}`);
    assert.deepEqual(first.out.given.system, ["briefing"]);
    const ctx = bridge.contextForMcpToken(url.split("/").pop());
    assert.deepEqual([ctx?.native, ctx?.chain, ctx?.graph, ctx?.cwd], [false, "ch_2", false, first.out.cwd], "Filament's own tools, never the file tools");

    await turn(up, "again", { briefing: "B2" });
    assert.equal(said("cx"), `${UPDATE_HEAD}\n\n${block("briefing", "B2")}\n\n---\nagain\n\n${RECALL}`);
    assert.equal(heard("cx", "thread/resume").length, 0);

    await turn(up, "plan it", { briefing: "B2", graph: true }, true);
    assert.equal(heard("cx", "thread/unsubscribe").length, 1, "let go of first");
    const [resume] = heard("cx", "thread/resume");
    const url2 = resume.params.config["mcp_servers.filament"].url;
    assert.notEqual(url2, url);
    assert.ok(resume.params.developerInstructions.includes(CODER_GRAPH_TEXT));
    assert.match(said("cx"), /^Filament's context for this session changed since your last message:\n\n<filament-context kind="tasks">/, "a resumed thread may keep the instructions it started with: the change goes ahead too");
    assert.deepEqual([bridge.contextForMcpToken(url2.split("/").pop())?.graph, bridge.contextForMcpToken(url.split("/").pop())], [true, null]);

    await turn(up, "~compact", { briefing: "B2", graph: true }, true);
    await turn(up, "go on", { briefing: "B2", graph: true }, true);
    assert.match(said("cx"), /^Filament's context for this session changed since your last message:\n\n<filament-memory kind="briefing">\nB2\n[\s\S]*<filament-context kind="tasks">[\s\S]*\n---\ngo on/, "said again after Codex compacted");
  });

  // (fails before: yes — the bug hunt of 11-08: once its thread had opened, a call's place was read off the thread
  // alone, which kept neither who the session is nor its card's want of the Space: a sub-agent's background_command and
  // envelope to its lead were refused, and the Space its card has none of was given)
  test("a sub-agent's thread stays its own once it has opened: who it is, and no Space where its card has none", async () => {
    const up = upstream("cx-sub");
    const by = { id: "sa_00000003", exchange: 1, name: "Builder" };
    const { body, context } = prepared("build it");
    await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body, conversationId: "subagent:sa_00000003", headers: { "x-filament-subagent": "sa_00000003" }, onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_2", turn: "t_2", by, space: false } });
    const url = String(heard("cx-sub", "thread/start").at(-1)?.params.config["mcp_servers.filament"].url);
    const ctx = bridge.contextForMcpToken(url.split("/").pop() || "");
    assert.deepEqual([ctx?.conv?.sessionId != null, ctx?.chain, ctx?.by, ctx?.space], [true, "ch_2", by, false]);
  });

  // The owner's word of 11-02: a sub-agent compacts at the lower of 400K and 85% of its window. Codex takes it as its own
  // auto-compact limit, so it makes room in the middle of a turn, as Claude Code does with its auto-compact window.
  // (fails before: yes — Codex was handed no line: a sub-agent on it compacted at a point of its own)
  test("a sub-agent's thread opens with its compaction line as Codex's auto-compact limit; a main chat's line is not handed", async () => {
    const up = upstream("cx-line");
    /** @param {string} conversationId @param {Record<string, string>} headers */
    const open = async (conversationId, headers) => {
      const { body, context } = prepared("look", {});
      const out = await bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body, conversationId, headers, onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_2", turn: "t_2" } });
      return { config: heard("cx-line", "thread/start").at(-1)?.params.config || {}, out };
    };
    const side = await open("subagent:sa_00000001", { "x-filament-subagent": "sa_00000001", [LINE_HEADER]: "400000" });
    assert.equal(side.config.model_auto_compact_token_limit, 400_000);
    // (fails before: yes — its turn's facts said nothing of where Codex makes room, so a running sub-agent's card had no
    // line to draw: the owner's of 11-12)
    assert.deepEqual(side.out.point, { at: 400_000, line: 400_000 }, "its facts say where it makes room by itself, as Claude Code's do");
    const main = await open("chain:ch_line", { [LINE_HEADER]: "850000" });
    assert.equal(main.config.model_auto_compact_token_limit, undefined, "a main chat's line is weighed by Filament between turns");
    assert.equal(main.out.point, undefined, "and its facts name no point of Codex's");
  });

  // (fails before: yes — the bug hunt of 11-02: a sub-agent's thread opened while nobody knew its window took no line,
  // and its follow-up, the line known by then, went on in the loaded thread as it was: Codex compacted at a point of its own)
  test("a sub-agent's thread opened with no line opens again with its line once the line is known; the same line leaves it as it is", async () => {
    const up = upstream("cx-line-late");
    /** A turn of the sub-agent, with the line its request names, if any. @param {string} text @param {string | null} line */
    const say = (text, line) => {
      const { body, context } = prepared(text, {});
      const headers = { "x-filament-subagent": "sa_00000002", ...(line ? { [LINE_HEADER]: line } : {}) };
      return bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body, conversationId: "subagent:sa_00000002", headers, onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_2", turn: "t_2" } });
    };
    const first = await say("look", null);
    assert.equal(heard("cx-line-late", "thread/start")[0].params.config.model_auto_compact_token_limit, undefined, "nobody knows its window yet");
    const out = await say("go on", "400000");
    assert.equal(heard("cx-line-late", "thread/unsubscribe").length, 1, "let go of the thread opened without a line");
    assert.deepEqual(heard("cx-line-late", "thread/resume").map((m) => [m.params.threadId, m.params.config.model_auto_compact_token_limit]), [[first.sessionId, 400_000]], "the same thread, opened again with its line");
    assert.ok(out.notes.some((/** @type {string} */ n) => n.endsWith("opened again: it opened with no compaction line, and Codex keeps a loaded thread's auto-compact limit as it opened")), out.notes.join("\n"));
    await say("and on", "400000");
    assert.deepEqual([heard("cx-line-late", "thread/unsubscribe").length, heard("cx-line-late", "thread/resume").length, heard("cx-line-late", "thread/start").length], [1, 1, 1], "the same line leaves the thread as it is");
  });

  // (fails before: no — a guard the review of b1f4c556b asked for: Codex's thread hands back its facts as its result, and a
  // failed turn tells a prompt that failed before its session began by that object)
  test("a turn's result is the facts its session event carried, the object itself", async () => {
    const { out, events } = await turn(upstream("cx-facts"), "hello", { chat: "facts" });
    assert.equal(events.find((e) => e.type === "session")?.facts, out);
  });

  test("a session whose agent leads a team: Codex lets one of Filament's calls run 600 s, its server carries the team's tools, and the lead's start opens the thread again", async () => {
    const up = upstream("cx-lead");
    await turn(up, "hello", { chat: "lead" });
    const [start] = heard("cx-lead", "thread/start");
    const server = start.params.config["mcp_servers.filament"];
    assert.equal(server.tool_timeout_sec, 600, "a lead's wait, and its order waiting for the developer, may hold a call that long");
    const ctx = bridge.contextForMcpToken(server.url.split("/").pop());
    assert.deepEqual([ctx?.team, ctx?.patienceMs], [false, 600_000]);
    await turn(up, "lead them", { chat: "lead", team: true });
    assert.equal(heard("cx-lead", "thread/unsubscribe").length, 1, "let go of the thread without the team's tools");
    const [resume] = heard("cx-lead", "thread/resume");
    const led = bridge.contextForMcpToken(resume.params.config["mcp_servers.filament"].url.split("/").pop());
    assert.deepEqual([led?.team, led?.patienceMs, bridge.contextForMcpToken(server.url.split("/").pop())], [true, 600_000, null]);
  });

  // (fails before: yes — the review of 21d92f3df: a thread kept the MCP server it opened with when Memory settings came to
  // leave its chat out, and Codex the memory's tools it listed from it; a chat taken back in was given none of them until a
  // new thread)
  test("a thread whose chat Memory settings come to leave out opens again without memory's tools; taken back in, it opens again with them", async () => {
    const up = upstream("cx-memout");
    /** A turn of the chat, its task graph on. `leftOut`: Memory settings leave the chat out now. @param {string} text @param {boolean} leftOut */
    const say = (text, leftOut) => {
      const { body, context } = prepared(text, { graph: true });
      return bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body, conversationId: "memout", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_2", turn: "t_2", graph: true, team: false, leftOut } });
    };
    /** The token of Filament's server each open gave the thread, oldest first. */
    const tokens = () => [...heard("cx-memout", "thread/start"), ...heard("cx-memout", "thread/resume")].map((m) => String(m.params.config["mcp_servers.filament"].url).split("/").pop() || "");
    const said = "opened again: the task graph, memory's tools, the team it leads, what Filament's agent tool offers it, the project's Space, or the visuals', the artifacts' or the team tool's switch, changed the tools it takes";
    const first = await say("hello", false);
    const out = await say("left out", true);
    assert.equal(heard("cx-memout", "thread/unsubscribe").length, 1, "let go of the thread given memory's tools");
    assert.deepEqual(heard("cx-memout", "thread/resume").map((m) => m.params.threadId), [first.sessionId], "the same thread, opened again");
    const [given, outAt] = tokens();
    assert.notEqual(outAt, given, "at a new address");
    assert.deepEqual([bridge.contextForMcpToken(outAt)?.leftOut, bridge.contextForMcpToken(given)], [true, null], "the new address stands for the chat memory leaves out, the old for nothing");
    assert.ok(out.notes.some((/** @type {string} */ n) => n.endsWith(said)), out.notes.join("\n"));
    await say("still out", true);
    assert.equal(heard("cx-memout", "thread/resume").length, 1, "the same status leaves the thread as it is");
    const back = await say("taken back in", false);
    assert.equal(heard("cx-memout", "thread/unsubscribe").length, 2);
    assert.equal(heard("cx-memout", "thread/resume").length, 2, "opened again as memory takes the chat back in");
    const backAt = tokens()[2];
    assert.deepEqual([bridge.contextForMcpToken(backAt)?.leftOut, bridge.contextForMcpToken(outAt)], [false, null]);
    assert.ok(back.notes.some((/** @type {string} */ n) => n.endsWith(said)), back.notes.join("\n"));
  });

  // (fails before: yes — the review of be487d62e: a load at the confined caller's thread's address while the thread opened
  // was handed no `confined`, nor one at an address whose turn was forgotten)
  test("a thread's address keeps memory's tools to the project for a caller that reaches no other sessions while the thread opens, and wherever no turn places the caller", async () => {
    const up = upstream("cx-confined", { FAKE_CODEX_SLOW_START_MS: "1500" });
    /** What each call of memory's tools at a thread's address was handed. @type {any[]} */
    const handed = [];
    const mcp = new McpToolServer({ bridge, tools: { ...withMemory, call: async (/** @type {string} */ _name, /** @type {any} */ _args, /** @type {any} */ ctx) => (handed.push(ctx), { text: "ok" }) } });
    /** Whether a load at a token's address, as Codex makes one, keeps to the project. @param {string} token */
    const keptAt = async (token) => {
      const res = { writeHead: () => {}, end: () => {}, on: () => {}, writableEnded: true };
      await mcp.handle({ method: "POST" }, res, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "filament_memory_load", arguments: { session: "s_other" } } });
      return handed.at(-1)?.confined === true;
    };
    /** A new chat's turn, a load made at its thread's address while the thread opens. @param {string} chat @param {boolean} confined */
    const whileOpening = async (chat, confined) => {
      const before = heard("cx-confined", "thread/start").length;
      const { body, context } = prepared("hello");
      const run = bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body, conversationId: chat, onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_2", turn: "t_2", graph: false, team: false, ...(confined ? { confined: true } : {}) } });
      await until(() => heard("cx-confined", "thread/start").length > before, "its thread to open");
      const token = String(heard("cx-confined", "thread/start").at(-1).params.config["mcp_servers.filament"].url).split("/").pop() || "";
      const kept = await keptAt(token);
      assert.ok(bridge.pendingMcp.has(token), "the load was answered while the thread opened");
      await run;
      return { token, kept };
    };
    const away = await whileOpening("cx-away", true);
    const here = await whileOpening("cx-here", false);
    assert.deepEqual([away.kept, here.kept], [true, false], "as the turn opening each thread says");
    assert.deepEqual([await keptAt(away.token), await keptAt(here.token)], [true, false], "as each thread's turn says");
    // Turns that ended long ago are forgotten, the threads open still.
    bridge.sweepTurns(Date.now() + 31 * 60_000);
    assert.deepEqual([await keptAt(away.token), await keptAt(here.token)], [true, true], "an address no turn speaks for keeps to the project");
  });

  test("the bare retry: a seeded thread refused for its size, and the message goes again in a new one", async () => {
    const up = upstream("cx-tight", { FAKE_CODEX_OVERFLOW_SEEDED: "1" });
    const r = await turn(up, "two", { history: echoed("one"), chat: "tight" });
    assert.deepEqual([heard("cx-tight", "thread/start").length, heard("cx-tight", "thread/inject_items").length], [2, 1]);
    assert.equal(r.out.text, "Echo: two");
    assert.equal(r.out.seeded, false);
    assert.ok(r.events.some((e) => e.type === "text" && e.own && /so it goes on without it, in a new thread\./.test(e.text)));
    assert.ok(r.out.notes.includes("codex: the earlier conversation was too long for Codex (overflow): this new thread goes on without it"), r.out.notes.join("\n"));
  });

  test("a harness chat's refused seed is compacted and handed to a new thread; refused again, the message goes bare", async () => {
    const up = upstream("cx-reseed", { FAKE_CODEX_OVERFLOW_SEEDED: "1" });
    const reseed = async () => ({ body: prepared("two", { history: echoed("one, briefly") }).body, headers: { [COMPACTION_HEADER]: "7" } });
    const r = await turn(up, "two", { history: echoed("one"), chat: "reseed", reseed });
    const injected = heard("cx-reseed", "thread/inject_items");
    assert.deepEqual([heard("cx-reseed", "thread/start").length, injected.length], [3, 2], "the refused thread, the compaction's, then a bare one");
    assert.ok(JSON.stringify(injected[1].params).includes("one, briefly"), "the compacted history went to the second");
    assert.equal(r.out.text, "Echo: two");
    assert.ok(r.events.some((e) => e.type === "text" && e.own && /so Filament compacts its copy of it, and a new thread starts from that\./.test(e.text)));
    assert.ok(r.events.some((e) => e.type === "text" && e.own && /compacted, the earlier conversation was still too long for .* in a new thread\./.test(e.text)));
  });
});

describe("Cursor's SDK (AC4-1, AC4-5)", () => {
  /** @type {CursorSdkBridge} */ let bridge;
  const log = () => lines(join(dir, "sdk.jsonl"));
  before(() => {
    process.env.FAKE_SDK_LOG = join(dir, "sdk.jsonl");
    bridge = new CursorSdkBridge(/** @type {any} */ ({ log: quiet, loader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) }));
    bridge.agentTools = tools;
  });
  after(() => {
    bridge.shutdown();
    delete process.env.FAKE_SDK_LOG;
  });
  const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: "" } };
  /** @param {string} text @param {any} [o] @param {boolean} [graph] */
  async function turn(text, o = {}, graph = false) {
    const { body, context } = prepared(text, o);
    /** @type {any[]} */
    const events = [];
    const out = await bridge.run({ upstream: { ...up, acp: { cwdDefault: dir } }, modelId: "grok-4.6", format: "anthropic", body, conversationId: "sdk-chat", onEvent: (/** @type {any} */ ev) => events.push(ev), context, toolsAt: { chain: "ch_3", turn: "t_3", graph, team: !!o.team } });
    return { out, events };
  }

  test("the context ahead of the first prompt; the graph's tool goes with each message once the switch is on, its calls Filament's own", async () => {
    await turn("hello");
    const first = log().filter((e) => e.event === "send").at(-1);
    assert.equal(first.prompt, `${CONTEXT_HEAD}\n\n${block("briefing", "B1")}\n\n---\nhello\n\n${RECALL}`);
    assert.equal(first.customTools.includes("tasks"), false);
    const on = await turn("~graph", { graph: true }, true);
    const sent = log().filter((e) => e.event === "send").at(-1);
    assert.ok(sent.customTools.includes("tasks"), JSON.stringify(sent.customTools));
    assert.ok(!sent.customTools.includes("agent"), "no team's tools where the agent leads none");
    assert.match(sent.prompt, /^Filament's context for this session changed since your last message:\n\n<filament-context kind="tasks">/);
    assert.match(on.out.text, /graph:Added a\./);
    assert.deepEqual(on.out.tools.map((/** @type {any} */ t) => [t.title, t.routed]), [["tasks", false]], "a call to Filament's own tool is no file tool's routed call");
  });

  // (fails before: no — a guard the review of b1f4c556b asked for: as Codex's and the ACP agents')
  test("a turn's result is the facts its session event carried, the object itself", async () => {
    const { out, events } = await turn("hello");
    assert.equal(events.find((e) => e.type === "session")?.facts, out);
  });

  test("while the agent leads a team, its team's tools go with each message, the lead's tasks among them", async () => {
    await turn("lead them", { graph: true, team: true }, true);
    const sent = log().filter((e) => e.event === "send").at(-1);
    assert.deepEqual(["tasks", "agent", "worker", "wait"].filter((n) => sent.customTools.includes(n)), ["tasks", "agent", "worker", "wait"], JSON.stringify(sent.customTools));
  });

  // (fails before: no — HarnessV4_Tasks B5: Cursor's refused seed ran in no test, its fake SDK refusing none)
  test("a harness chat's refused seed: Filament compacts its copy, and a new agent starts from that — or, refused again, goes bare", async () => {
    process.env.FAKE_SDK_OVERFLOW_SEEDED = "1";
    try {
      /** @param {string} chat @param {string} id  the compaction the remade request stands on */
      const tried = async (chat, id) => {
        const { body, context } = prepared("two", { history: echoed("one") });
        /** @type {any[]} */
        const events = [];
        let asked = 0;
        const reseed = async () => (asked++, { body: prepared("two", { history: echoed("one, briefly") }).body, headers: { [COMPACTION_HEADER]: id } });
        const before = log().filter((e) => e.event === "create").length;
        const out = await bridge.run({ upstream: { ...up, acp: { cwdDefault: dir } }, modelId: "grok-4.6", format: "anthropic", body, conversationId: chat, onEvent: (/** @type {any} */ ev) => events.push(ev), context, toolsAt: { chain: "ch_3", turn: "t_3", graph: false, team: false }, reseed });
        return { out, asked, made: log().filter((e) => e.event === "create").length - before, said: events.filter((e) => e.type === "text" && e.own).map((e) => e.text) };
      };
      const r = await tried("sdk-reseed-a", "7");
      assert.deepEqual([r.asked, r.made, r.out.seeded], [1, 2, true], "the refused agent, then a fresh one from the compaction");
      assert.deepEqual(r.said, ["_filament: the earlier conversation was too long for csdk to take in, so Filament compacts its copy of it, and a new agent starts from that._\n\n"]);
      const seed = String(log().filter((e) => e.event === "send").at(-1).prompt);
      assert.ok(seed.includes(`${COMPACTED_WORDS}:`) && seed.includes("one, briefly"), seed.slice(0, 300));
      // A compaction the agent refuses too: the message goes bare.
      const again = await tried("sdk-reseed-b", "0");
      assert.deepEqual([again.asked, again.made, again.out.seeded], [1, 3, false], "the refused agent, the refused compaction's, then a bare one");
      assert.deepEqual(again.said.slice(1), ["_filament: compacted, the earlier conversation was still too long for csdk to take in, so it goes on without it, in a new agent._\n\n"]);
    } finally {
      delete process.env.FAKE_SDK_OVERFLOW_SEEDED;
    }
  });

  // (fails before: no — a guard the mutation pass asked for: the agent's compaction left Filament's context counted as
  // said, so the agent never heard it again)
  test("once the agent compacts its context, the next prompt says Filament's context whole again", async () => {
    await turn("~compact");
    await turn("after");
    const sent = log().filter((e) => e.event === "send").at(-1);
    assert.ok(sent.prompt.startsWith(`${CONTEXT_HEAD}\n\n${block("briefing", "B1")}`), sent.prompt.slice(0, 300));
  });
});

// (fails before: no — a guard the mutation pass asked for: an overflow of a turn that carried nothing, or a seeded
// turn's other failure, went again bare)
test("the bare retry is for a seeded turn refused for its size alone, not stopped", async () => {
  const bridge = new TurnBridge();
  const upstream = { id: "u", name: "u", type: "acp" };
  /** @param {any} e @param {any} [signal] */
  const tried = async (e, signal) => {
    let dropped = 0;
    /** @type {any[]} */
    const said = [];
    const turn = /** @type {any} */ ({ emit: (/** @type {any} */ ev) => said.push(ev) });
    const r = await bridge
      .retrySeed(e, { upstream, signal }, turn, { session: "session", drop: () => dropped++, again: async (/** @type {any} */ o) => (o.bare ? "again" : "reseeded") })
      .catch((/** @type {any} */ x) => (x === e ? "thrown" : x));
    return [r, dropped, said.length];
  };
  /** @param {string} errorKind @param {boolean} seeded */
  const failure = (errorKind, seeded) => Object.assign(new Error("refused"), { data: { errorKind }, ...(seeded ? { seededUnanswered: true } : {}) });
  assert.deepEqual(await tried(failure("contextWindowExceeded", true)), ["again", 1, 1]);
  assert.deepEqual(await tried(failure("contextWindowExceeded", false)), ["thrown", 0, 0], "a turn that carried nothing is the turn's failure");
  assert.deepEqual(await tried(failure("authentication_failed", true)), ["thrown", 0, 0], "a seeded turn's other failure is the turn's");
  assert.deepEqual(await tried(failure("contextWindowExceeded", true), { aborted: true }), ["thrown", 0, 0], "a stopped turn goes no further");
});

// (fails before: yes — a refused seed always went bare: HarnessV3-FailurePoints D9)
test("a refused seed with a way to fit it: compacted and sent again; no room made, refused again or a failure of its own, as each says", async () => {
  const bridge = new TurnBridge();
  const upstream = { id: "u", name: "Agent U", type: "acp" };
  const refusal = () => Object.assign(new Error("refused"), { data: { errorKind: "contextWindowExceeded" }, seededUnanswered: true });
  const MADE = { body: { messages: [] }, headers: { "x-filament-compaction": "7" } };
  // (fails before: yes — HarnessV4_Tasks B5: the way to fit the seed was told nothing of what the agent said it takes)
  {
    /** @type {any[]} */
    const heard = [];
    const turn = /** @type {any} */ ({ emit: () => {} });
    const reseed = async (/** @type {any} */ said) => (heard.push(said), MADE);
    const numbered = Object.assign(new Error("Internal error: Prompt is too long: 212000 tokens > 200000 maximum"), { seededUnanswered: true });
    for (const e of [numbered, refusal()]) await bridge.retrySeed(e, { upstream, reseed }, turn, { session: "thread", drop: () => {}, again: async () => "reseeded" });
    assert.deepEqual(heard, [{ max: 200000, counted: 212000 }, { max: null, counted: null }]);
  }
  /**
   * @param {() => Promise<any>} reseed @param {(o: any) => Promise<any>} again @param {{ aborted: boolean }} [signal]
   */
  const tried = async (reseed, again, signal) => {
    let dropped = 0;
    /** @type {any[]} */
    const runs = [];
    /** @type {string[]} */
    const said = [];
    const turn = /** @type {any} */ ({ emit: (/** @type {any} */ ev) => said.push(String(ev.text).replace(/^_filament: |\._\n\n$/g, "")) });
    const e = refusal();
    const r = await bridge
      .retrySeed(e, { upstream, signal, reseed }, turn, { session: "thread", drop: () => dropped++, again: async (/** @type {any} */ o) => (runs.push(o), again(o)) })
      .catch((/** @type {any} */ x) => (x === e ? "thrown" : x.message));
    return { r, dropped, runs, said };
  };
  const ok = async (/** @type {any} */ o) => (o.bare ? "bare" : "reseeded");
  const first = "the earlier conversation was too long for Agent U to take in, so Filament compacts its copy of it, and a new thread starts from that";
  assert.deepEqual(await tried(async () => MADE, ok), { r: "reseeded", dropped: 1, runs: [MADE], said: [first] });
  assert.deepEqual(await tried(async () => ({ error: "nothing can make room: no finished turn to fold, digest or summarize" }), ok), {
    r: "bare", dropped: 1, runs: [{ bare: true }],
    said: [first, "the compaction made no room (nothing can make room: no finished turn to fold, digest or summarize), so it goes on without the earlier conversation, in a new thread"],
  });
  assert.deepEqual((await tried(async () => { throw new Error("the writer broke"); }, ok)).said[1], "the compaction made no room (the writer broke), so it goes on without the earlier conversation, in a new thread");
  const refusedAgain = async (/** @type {any} */ o) => { if (o.bare) return "bare"; throw refusal(); };
  assert.deepEqual(await tried(async () => MADE, refusedAgain), {
    r: "bare", dropped: 2, runs: [MADE, { bare: true }],
    said: [first, "compacted, the earlier conversation was still too long for Agent U to take in, so it goes on without it, in a new thread"],
  });
  const broke = async (/** @type {any} */ o) => { throw new Error(o.bare ? "bare broke" : "it broke otherwise"); };
  assert.deepEqual((await tried(async () => MADE, broke)).r, "it broke otherwise", "another failure of the compacted seed's is the turn's");
  // Stopped while Filament compacted: the turn goes no further.
  const stop = { aborted: false };
  assert.deepEqual(await tried(async () => ((stop.aborted = true), MADE), ok, stop), { r: "thrown", dropped: 1, runs: [], said: [first] });
});
