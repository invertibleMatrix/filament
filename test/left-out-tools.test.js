// @ts-check
// D4 (11-01, the owner's to decide, delegated): a chat Memory settings leave out keeps the loop's own tools, under the
// chat's own session — the task graph, artifacts, pictures, the browser, a come-back, teams and flows ride the session
// the request names (`ctx.memory.session`) where memory left the turn out, as they ride memory's chain where it took
// the turn in, for Filament's own agent and a coding agent alike — and memory's own tools stay off for it, on every
// request it makes: the loop's ticks, and a coding agent's session over Filament's MCP server. Since the decisions of
// 11-02 such a chat keeps its own turns (test/left-out-turns.test.js), its agent's pictures are kept on its turn, as any
// chat's are, and filament_recall rides its requests as any chat's: it reads only the chat's own record, which the chat
// keeps. Nothing else of memory's is recorded for it. The start and Overview say the same.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chainRefOf } from "../src/core/conversation.js";
import { visualHome } from "../src/app/agent/visuals.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { serverInstructions } from "../src/http/mcp.js";
import { startAnatomy } from "../src/app/sessions/draft-start.js";
import { headWords } from "../src/ui/harness/conversation/start-board.js";
import { whoWidget } from "../src/ui/harness/widgets/overview-setup.js";
import { defaultConfig } from "../src/config.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const SVG = '<svg viewBox="0 0 400 80" width="100%"><rect x="10" y="10" width="120" height="40" rx="6" fill="var(--blue-fill)"/></svg>';
const OUT = 'model "brain-out" is excluded in Memory settings';
/** The archive of a running Filament, which memory opens. @param {Awaited<ReturnType<typeof startApp>>} shim @returns {any} */
const archiveOf = (shim) => shim.app.memory.archive;
/** Memory's own tools, by name: filament_recall is not among them — it reads only the chat's own record. @param {string} n */
const memorys = (n) => n.startsWith("filament_memory_");

describe("where a picture is kept (agent/visuals.js visualHome)", () => {
  // (fails before: yes — a turn memory leaves out keeps no row, so the chat's own agent's picture had nowhere to go:
  // the loop left show_visual out of its set, and a coding agent's call was refused)
  test("on its turn; else on its session — a helper no turn launched, or the chat's own agent in a turn memory leaves out; else nowhere", () => {
    /** @type {any[]} */
    const kept = [];
    const archive = {
      addTurnVisual: (/** @type {number} */ turn, /** @type {any} */ v) => (kept.push(["turn", turn, v.by ?? null]), { ok: /** @type {const} */ (true), bytes: 1, n: 3 }),
      addChainVisual: (/** @type {string} */ chain, /** @type {any} */ v) => (kept.push(["session", chain, v.by ?? null]), { ok: /** @type {const} */ (true), bytes: 1 }),
    };
    const v = { title: "t", code: SVG, loading: [] };
    const at = { id: "v1", round: 1 };
    visualHome(archive, { turn: 7, chain: "c1", by: null })?.(v, at);
    visualHome(archive, { turn: null, chain: "c1", by: { id: "sa_1", exchange: 0 } })?.(v, at);
    visualHome(archive, { turn: null, chain: "c1", by: null, rowless: true })?.(v, at);
    assert.equal(visualHome(archive, { turn: null, chain: "c1", by: null }), null, "the chat's own agent with no turn, in a chat memory works in: nowhere");
    assert.equal(visualHome(archive, { turn: null, chain: null, by: null, rowless: true }), null, "no session to keep it on: nowhere");
    assert.deepEqual(kept, [["turn", 7, null], ["session", "c1", "sa_1"], ["session", "c1", null]]);
  });
});

describe("a coding agent's own tools from Filament in a chat Memory settings leave out (agent-tools.js, http/mcp.js)", () => {
  /** @type {string[]} */
  const asked = [];
  /** @type {any[]} */
  const kept = [];
  const memory = {
    enabled: () => true,
    isOpen: () => true,
    mayAsk: () => true,
    scope: () => {
      asked.push("scope");
      throw new Error("memory was asked");
    },
    archive: {
      addTurnVisual: () => ({ ok: true, bytes: 1, n: 1 }),
      addChainVisual: (/** @type {string} */ chain, /** @type {any} */ v) => (kept.push([chain, v.id, v.by ?? null]), { ok: true, bytes: Buffer.byteLength(v.code) }),
    },
  };
  const tools = createAgentTools({ memory, memoryToolsOn: () => true, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null });
  const ctx = { cwd: "/p", upstream: "cli", chain: "c1", turn: null, graph: false };

  // (fails before: yes — memory's tools were listed and run wherever memory's switch was on: a coding agent in a chat
  // Memory settings leave out searched and remembered all the same)
  test("memory's tools are neither listed nor run; the server's words as the agent connects name none of them", async () => {
    assert.ok(tools.list(ctx).some((t) => memorys(t.name)), "in a chat memory works in: listed");
    assert.deepEqual(tools.list({ ...ctx, leftOut: true }).filter((t) => memorys(t.name)), []);
    const r = await tools.call("filament_memory_remember", { text: "a fact", kind: "fact" }, { ...ctx, leftOut: true });
    assert.deepEqual(r, { text: "Not run: this chat is left out of memory (Memory settings), and so are memory's tools.", isError: true });
    assert.deepEqual(asked, [], "memory was never asked");
    assert.match(serverInstructions({ cwd: "/p" }), /its memory tools search and keep/);
    assert.doesNotMatch(serverInstructions({ cwd: "/p", leftOut: true }), /memory tools/);
    assert.match(serverInstructions({ cwd: "/p", leftOut: true }), /^Filament is the harness the person works with you through\. This chat is left out of its memory, as the person's Memory settings say, and so are memory's tools\. Its `tasks` keeps this session's task graph\./);
  });

  // (fails before: yes — the owner's of 11-06: a coding agent was offered no filament_recall, so what a fresh session's
  // Words left out of a turn it got back only by running the tools again — five sub-agents launched a second time)
  test("filament_recall is listed and runs in any chat's session, left out of memory or not, on the chat's own record alone", async () => {
    /** @type {any[]} */
    const reads = [];
    const turn = {
      n: 2, endedAt: 1, user: { role: "user", content: [{ type: "text", text: "map it" }] },
      work: [
        { role: "assistant", content: [{ type: "tool_use", id: "a1", name: "Agent", input: { description: "Map" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a1", content: "guards.js:45 trusts loopback" }] },
      ],
      final: { role: "assistant", content: [{ type: "text", text: "Mapped." }] },
    };
    const archive = { turnBodies: (/** @type {string} */ chain, /** @type {any} */ at) => (reads.push([chain, at.from]), chain === "c1" && at.from === 2 ? [turn] : []) };
    const own = createAgentTools({ memory: { ...memory, archive }, memoryToolsOn: () => true, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null });
    const recalls = (/** @type {any} */ c) => own.list(c).some((t) => t.name === "filament_recall");
    assert.deepEqual([recalls(ctx), recalls({ ...ctx, leftOut: true }), recalls({ ...ctx, chain: null })], [true, true, false]);
    // (fails before: yes — the hunt of carry-recall: a fresh session's words name it, and Claude Code held it by name alone)
    assert.equal(own.list(ctx).find((t) => t.name === "filament_recall")?.upfront, true, "loaded whole (AG-75)");
    const r = await own.call("filament_recall", { turn: 2 }, { ...ctx, leftOut: true });
    assert.equal(r.isError, undefined);
    assert.match(r.text, /^## Turn 2\nUser: map it\nTool call Agent \{"description":"Map"\}\nResult of Agent \(r:[0-9a-f]{8}\):\nguards\.js:45 trusts loopback\nAssistant: Mapped\.$/);
    assert.deepEqual(reads, [["c1", 2]], "the chat's own record, by the turn asked for");
    assert.deepEqual(asked, [], "memory was never asked");
    assert.deepEqual(await own.call("filament_recall", { turn: 2 }, { ...ctx, chain: null }), { text: "Not run: recall reads a chat's own record, and this call stands in no chat.", isError: true });
  });

  // (fails before: yes — the chat's own agent's call found no turn to keep its picture on: "no turn … no chat to draw in")
  test("the chat's own agent's picture is kept on its session while its turn runs, and said so on the run; with no turn running, nowhere", async () => {
    /** @type {any[]} */
    const said = [];
    const on = { ...ctx, visuals: true, leftOut: true, rowless: true, emit: (/** @type {any} */ e) => said.push(e), callOf: async () => ({ id: "toolu_v", round: 2 }) };
    const r = await tools.call("show_visual", { title: "flow", code: SVG }, on);
    assert.ok(!r.isError, r.text);
    assert.deepEqual(kept, [["c1", "toolu_v", null]]);
    assert.deepEqual(said, [{ type: "visual", id: "toolu_v", round: 2, title: "flow", bytes: Buffer.byteLength(SVG), session: true }]);
    assert.deepEqual(await tools.call("show_visual", { title: "flow", code: SVG }, { ...on, emit: null }), { text: "Not shown: no turn of the developer's runs in this session now, so there is no chat to draw in.", isError: true });
    assert.equal(kept.length, 1);
  });
});

describe("the start of a chat Memory settings leave out (sessions/draft-start.js, the Start's heads)", () => {
  const cfg = defaultConfig();
  cfg.upstreams = [{ id: "api", name: "api", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "s", enabled: true }];
  cfg.routes = [{ match: "brain-*", upstream: "api", upstreamModel: "{model}", enabled: true }];
  cfg.agentLoop = { ...cfg.agentLoop, enabled: true, readerModel: "" };
  cfg.memory = { ...(cfg.memory || {}), enabled: true, autopilot: { enabled: true, briefingTokens: 1200, turnTokens: 300, tools: true } };
  const memory = { archive: { projects: () => [{ id: "p1", items: 7, dossier: 3 }] } };
  const eff = { model: { name: "brain-out" } };

  // (fails before: yes — the start weighed memory's briefing, its recall and its tools by memory's switches alone: for a
  // chat Memory settings leave out it said all of them ride the first request, which carries none. Since the decision
  // of 11-02 the recall tool rides there: it reads only the chat's own record, which the chat keeps — before it, the
  // start said it rode none, `tools.recall` false)
  test("it says memory leaves the chat out, and why, and weighs none of memory's parts — no briefing, no recall, no memory tools — and the recall tool, which reads the chat's own record", () => {
    const took = startAnatomy({ cfg, eff, cwd: tmpdir(), projectId: "p1", memory });
    const out = startAnatomy({ cfg, eff, cwd: tmpdir(), projectId: "p1", memory, excluded: OUT });
    assert.ok(took.tools.memory > 0 && took.tools.recall && took.memory.briefing > 0, "a chat memory works in: memory's parts");
    assert.deepEqual([out.tools.memory, out.tools.recall, out.memory.briefing, out.memory.recall, out.memory.tools, out.memory.out], [0, true, 0, 0, false, OUT]);
    assert.equal(took.memory.out, null);
    assert.equal(out.parts.find((p) => p.id === "memory")?.tokens, 0);
    assert.deepEqual(out.tools.offered, took.tools.offered, "the loop's own tools are the same");
    const words = headWords(out, { who: "", permission: "edit", main: "brain-out", held: {} });
    assert.deepEqual(words.memory, { value: "Left out", sub: OUT });
  });

  // (fails before: yes — Overview's who-runs-it tile said Filament adds memory to a chat Memory settings leave out)
  test("Overview's who-runs-it tile names memory only where it works in the chat", () => {
    /** @param {any} engine */
    const lineOf = (engine) => {
      const ctx = /** @type {any} */ ({ view: () => ({ settings: { effective: {}, flat: {}, sources: {}, engine } }), accounts: { session: () => ({ agentName: "Claude Code", type: "acp" }) }, subagents: { sessionModel: () => "m" } });
      const tile = /** @type {any} */ (whoWidget(ctx).tile);
      return textOf(fakeH("div", {}, tile(fakeH)));
    };
    assert.match(lineOf({ active: false, leftOut: null }), /Filament runs the turns: its tools, memory, sub-agents and the compaction line\./);
    assert.match(lineOf({ active: false, leftOut: OUT }), new RegExp(`Filament runs the turns: its tools, sub-agents and the compaction line\\. Memory leaves this chat out: ${OUT}\\.`));
    assert.match(lineOf({ active: false, coder: "cli", leftOut: null }), /Filament adds memory, agents, pictures and artifacts\./);
    assert.match(lineOf({ active: false, coder: "cli", leftOut: OUT }), new RegExp(`Filament adds agents, pictures and artifacts\\. Memory leaves this chat out: ${OUT}\\.`));
  });
});

describe("through the app: Filament's own agent in a harness chat Memory settings leave out", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-left-out-loop-"));
  /** Each tick's tools, by the model it went out on. @type {Map<string, string[][]>} */
  const ticks = new Map();
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const names = (call.body?.tools || []).map((/** @type {any} */ t) => String(t.name));
      if (!names.includes("read")) return undefined;
      const model = String(call.body.model);
      const seen = ticks.get(model) || [];
      seen.push(names);
      ticks.set(model, seen);
      const asked = call.body.messages.at(-1);
      const answered = Array.isArray(asked?.content) && asked.content.some((/** @type {any} */ b) => b?.type === "tool_result");
      return answered
        ? anthropicReply("Drawn.", { model })
        : anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: "v1", name: "show_visual", input: { title: "flow", code: SVG } }], usage: { input_tokens: 30, output_tokens: 7 } });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false, excludeModels: ["brain-out"] };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} model */
  const chat = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const json = await r.json();
    return { runId: String(r.headers.get("x-filament-request-id")), text: (json.content || []).map((/** @type {any} */ b) => b.text || "").join("") };
  };
  const events = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];

  // (fails before: yes — the loop keyed the chat's own tools on memory's prepare, which a turn memory leaves out never
  // had: the task graph, artifacts, pictures, the browser, a come-back, teams and flows were all off there; and, before
  // the decisions of 11-02, no turn of it was kept, so its picture went on its session, and no tick carried
  // filament_recall)
  test("its turn is offered the tools a chat memory works in is offered, memory's own aside, on every tick; its turn is kept, and its picture on it", async () => {
    const took = await chat("agent/brain-in");
    assert.equal((await turn(took, "draw the flow")).text, "Drawn.");
    const out = await chat("agent/brain-out");
    const { runId, text } = await turn(out, "draw the flow");
    assert.equal(text, "Drawn.");
    const inTicks = ticks.get("brain-in") || [];
    const outTicks = ticks.get("brain-out") || [];
    assert.equal(inTicks.length, 2);
    assert.equal(outTicks.length, 2);
    assert.ok(inTicks[0].some((n) => n.startsWith("filament_memory_")) && inTicks[0].includes("filament_recall"), `memory's tools where it works in the chat: ${inTicks[0].join(", ")}`);
    for (const t of outTicks) assert.deepEqual(t.filter(memorys), [], "memory's tools on none of its ticks");
    // filament_recall rides them as any chat's (the decision of 11-02): it reads only the chat's own record.
    for (const t of outTicks) assert.ok(t.includes("filament_recall"), t.join(", "));
    assert.deepEqual(outTicks[0], inTicks[0].filter((n) => !memorys(n)), "the chat's own tools, as where memory works in the chat");
    assert.deepEqual(outTicks[1], outTicks[0], "the same tools tick to tick");
    for (const n of ["tasks", "show_visual", "visual_guide", "artifact", "come_back"]) assert.ok(outTicks[0].includes(n), `${n}: ${outTicks[0].join(", ")}`);
    const drew = (await events(runId)).find((/** @type {any} */ e) => e.type === "visual");
    assert.deepEqual([drew?.id, drew?.session, drew?.turn], ["v1", undefined, 1], "said on the run as kept on its turn");
    const [kept] = archiveOf(shim).getTurns(out);
    assert.ok(kept, "its turn is kept");
    assert.equal(archiveOf(shim).turnVisual(kept.id, "v1")?.code, SVG, "kept on its turn");
    assert.equal(archiveOf(shim).chainVisual(out, "v1"), null, "not on the session");
    const served = await shim.api(`/api/sessions/${encodeURIComponent(out)}/turns/1/visuals/v1`);
    assert.equal(served.status, 200);
    assert.equal((await served.json()).code, SVG);
    assert.equal(archiveOf(shim).getTurns(out).length, 1, "its turn, kept");
    assert.equal(archiveOf(shim).getTurns(took).length, 1, "where memory works in the chat, its turn");
  });

  // (fails before: yes — no tick carried filament_recall, which since the decision of 11-02 rides each, as any chat's:
  // it reads only the chat's own record. The rest is a guard on the Hunter's lead: with the harness's client excluded,
  // the loop's ticks go out with Node's user agent and memory's `tools` word, yet each names its chat, and memory leaves
  // a chat's calls out with it)
  test("with the harness's client excluded, memory's tools ride none of the loop's ticks, and filament_recall each", async () => {
    const id = await chat("agent/brain-in");
    const st = await (await shim.api("/api/state")).json();
    const memory = { ...st.config.memory, capture: { ...st.config.memory.capture, excludeClients: ["harness"] } };
    assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, memory } })).status, 200);
    try {
      ticks.delete("brain-in");
      assert.equal((await turn(id, "draw it again")).text, "Drawn.");
      const all = ticks.get("brain-in") || [];
      assert.equal(all.length, 2);
      for (const t of all) assert.deepEqual(t.filter(memorys), [], t.join(", "));
      for (const t of all) assert.ok(t.includes("filament_recall"), `the chat's own record's tool: ${t.join(", ")}`);
      assert.equal(archiveOf(shim).getTurns(id).length, 1, "its turn, kept as the chat's own");
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });
});

describe("through the app: a coding agent in a harness chat Memory settings leave out", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-left-out-coder-"));
  const logs = mkdtempSync(join(tmpdir(), "filament-left-out-logs-"));
  const calls = join(logs, "calls.jsonl");
  const added = join(root, "notes");
  const WEB = { name: "web", url: "http://127.0.0.1:9/mcp" };
  before(async () => {
    mkdirSync(added);
    shim = await startApp({
      memory: true,
      configure: (cfg, { dataDir }) => {
        const acp = { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SESSION_CAPS: "additionalDirectories,resume" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" };
        cfg.upstreams = [{ id: "cli", name: "cli", type: "acp", enabled: true, acp }];
        cfg.routes = [{ match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false, excludeModels: ["coder-out"] };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root, logs);
  });
  /** @param {string} model */
  const chat = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings: { plugins: { mcp: [WEB] }, loop: { addedFolders: [added] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return ((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
  };
  /** The session opens the fake agent was sent, in order. @returns {any[]} */
  const opens = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((c) => c.method === "session/new");
  /** @param {string} url @param {string} method @param {any} [params] */
  const rpc = async (url, method, params = {}) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

  // (fails before: yes — the coding agent's turn was handed memory's state with the chat's surfaces off where memory left
  // the turn out: its session opened without the chat's MCP servers and added folders, Filament's server gave it memory's
  // tools and none of the chat's own, and a call to memory's ran; and, before the decision of 11-02, no turn of it was
  // kept, so its picture went on its session)
  test("its session opens with the chat's servers and folders; Filament's server lists the chat's own tools and none of memory's, and its words name none; its turns are kept, its picture on its turn", async () => {
    const took = await chat("coder-in");
    await turn(took, "hello");
    const out = await chat("coder-out");
    await turn(out, "hello");
    const [tookOpen, outOpen] = /** @type {any[]} */ (await until(() => (opens().length >= 2 ? opens() : null), "both sessions opened"));
    assert.deepEqual(outOpen.servers, tookOpen.servers, "the chat's own MCP servers");
    assert.deepEqual(outOpen.servers, ["web:http"]);
    assert.equal(outOpen.dirs?.length, 1, "the chat's added folder");
    for (const o of [tookOpen, outOpen]) await rpc(o.mcpUrl, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const listed = async (/** @type {any} */ o) => ((await rpc(o.mcpUrl, "tools/list"))?.tools || []).map((/** @type {any} */ t) => String(t.name));
    const tookTools = await listed(tookOpen);
    const outTools = await listed(outOpen);
    assert.ok(tookTools.some(memorys), `memory's tools where it works in the chat: ${tookTools.join(", ")}`);
    assert.deepEqual(outTools, tookTools.filter((n) => !memorys(n)), "the chat's own tools, memory's aside");
    for (const n of ["tasks", "show_visual", "artifact"]) assert.ok(outTools.includes(n), `${n}: ${outTools.join(", ")}`);
    const words = String((await rpc(outOpen.mcpUrl, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }))?.instructions || "");
    assert.doesNotMatch(words, /memory tools/, words);
    assert.match(await turn(out, '~mcpcall filament_memory_remember {"text":"a fact","kind":"fact"}'), /mcp:error:Not run: this chat is left out of memory \(Memory settings\), and so are memory's tools\./);
    assert.match(await turn(out, `~mcpcall show_visual ${JSON.stringify({ title: "flow", code: SVG })}`), /mcp:Shown to the developer in the chat as flow/);
    assert.deepEqual(archiveOf(shim).getChain(out)?.meta?.visuals || [], [], "none on its session");
    const turns = archiveOf(shim).getTurns(out);
    assert.equal(turns.length, 3, "its three turns, kept");
    const drawn = archiveOf(shim).turnMeta(turns[2].id)?.visuals || [];
    assert.equal(drawn.length, 1, "kept on the turn that drew it");
    assert.equal(archiveOf(shim).turnVisual(turns[2].id, drawn[0].id)?.code, SVG);
  });

  // (fails before: yes — the request's reading of why failed as its situate did and named no setting, so the turn took
  // its chat for one memory works in: the agent's session listed memory's nine tools, filament_memory_search to _grep)
  test("a turn of a chat whose folder Memory settings exclude, its situate and its reading of why failing alike: the agent's session is offered none of memory's tools", async () => {
    const away = join(root, "away");
    mkdirSync(away);
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: away, model: "coder-in", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const st = await (await shim.api("/api/state")).json();
    /** @param {any} config */
    const put = async (config) => assert.equal((await shim.api("/api/config", { method: "PUT", body: config })).status, 200);
    await put({ ...st.config, memory: { ...st.config.memory, capture: { ...st.config.memory.capture, excludeFolders: [away] } } });
    const brain = /** @type {any} */ (shim.app.memory).brain;
    const real = { situate: brain.situate, excludedWhy: brain.excludedWhy };
    /** The chat's requests cannot be read, for its situate and for why it is left out alike. @param {"situate" | "excludedWhy"} name */
    const failing = (name) =>
      /** @this {any} @param {any} a */
      function (a) {
        if (chainRefOf(a?.headers || {}) === id) throw new Error("the folder could not be read");
        return real[name].call(this, a);
      };
    brain.situate = failing("situate");
    brain.excludedWhy = failing("excludedWhy");
    const before = opens().length;
    try {
      await turn(id, "hello");
    } finally {
      Object.assign(brain, real);
      await put(st.config);
    }
    const opened = /** @type {any[]} */ (await until(() => (opens().length > before ? opens() : null), "its session opened")).at(-1);
    await rpc(opened.mcpUrl, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const tools = ((await rpc(opened.mcpUrl, "tools/list"))?.tools || []).map((/** @type {any} */ t) => String(t.name));
    assert.ok(tools.includes("tasks"), `the chat's own tools: ${tools.join(", ")}`);
    assert.deepEqual(tools.filter(memorys), [], `none of memory's: ${tools.join(", ")}`);
  });

  // (fails before: yes — the owner's of 11-09: a chat memory works in whose own settings switch memory's tools off opened
  // Claude Code with its own auto memory on, and two memories wrote)
  test("Claude Code opens without its own auto memory where memory works in the chat, its tools switched off there or not; where Memory settings leave the chat out, it keeps it", async () => {
    /** @param {string} model @param {any} [settings] */
    const opened = async (model, settings = {}) => {
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings } });
      assert.equal(r.status, 200, await r.clone().text());
      const id = String((await r.json()).id);
      await turn(id, "hello");
      const conv = [.../** @type {any} */ (shim.app).acp.convs.values()].find((/** @type {any} */ c) => c.chain === id);
      return conv?.opened?.sessionMeta?._meta?.claudeCode?.options?.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
    };
    assert.equal(await opened("coder-in"), "1", "memory's tools on");
    assert.equal(await opened("coder-in", { memory: { tools: false } }), "1", "memory's tools off for the chat");
    assert.equal(await opened("coder-out"), undefined, "left out of memory: its own stays");
  });

  // (fails before: yes — lead (e) of 11-02: memory leaves Filament's own call out (`leftOutOf` true, no setting's words),
  // and the coding agent's turn kept memory's tools off only for a setting's: the console Assistant's call on a coding
  // agent opened its session with Filament's MCP server, memory's tools listed on it)
  test("the console Assistant's call on a coding agent: memory leaves Filament's own call out, and the agent's session is offered none of memory's tools", async () => {
    const before = opens().length;
    const r = await shim.house("/v1/messages", { model: "coder-in", max_tokens: 50, messages: [{ role: "user", content: "hello" }] }, { "user-agent": "filament-assistant/0.1", "x-session-id": "assistant-coder-in" });
    assert.equal(r.status, 200, await r.clone().text());
    const opened = /** @type {any[]} */ (await until(() => (opens().length > before ? opens() : null), "the assistant's session opened")).at(-1);
    const tools = opened.mcpUrl ? ((await rpc(opened.mcpUrl, "tools/list"))?.tools || []).map((/** @type {any} */ t) => String(t.name)) : [];
    assert.deepEqual(tools.filter(memorys), [], `no memory tool for Filament's own call: ${tools.join(", ")}`);
  });
});
