// @ts-check
// A chat's project gains its Space partway through (the owner's of 11-08, h3): Filament never takes a tool away because
// it does not apply now, and a session just works when the thing appears in it. A coding agent reads the tools of
// Filament's MCP server once, as its session opens (`listChanged: false`), so the Space made, switched off, switched
// on or deleted between two messages opens its session again, with the space tool and the server's words as they
// stand then; a message with the Space as it was keeps the session, and its cache. Claude Code over ACP through the
// app, the turn saying the Space (acp-turn.js `toolsAt.spaceOn`); Codex's thread opens again the same way; Cursor's SDK
// takes Filament's tools with every message, so its agent has the change at once.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { agentContext } from "../src/app/agent-context.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { FAKE_ACP_AGENT, FIXTURES, startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

describe("Claude Code over ACP, through the app", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let folder;
  /** @type {string} */ let logs;

  /** The fake agent's prompt that carries `marker`. @param {string} marker */
  const promptWith = (marker) => lines(join(logs, "prompts.jsonl")).find((p) => String(p.text).includes(marker)) || null;
  /** What a session opened with, oldest first. @param {string} sessionId */
  const opens = (sessionId) => lines(join(logs, "calls.jsonl")).filter((c) => ["session/new", "session/load", "session/resume"].includes(c.method) && c.sessionId === sessionId);
  /** A harness turn, answered whole: its record's notes. @param {string} id @param {string} content */
  const said = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    return [...(rec.priorChanges || []), ...(rec.changes || [])].map(String).join("\n");
  };
  /** @param {string} url @param {string} method */
  const mcp = async (url, method) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }) })).json()).result;
  /**
   * What the agent reads at its tools' address as its session opens: whether the list has the space tool, and whether
   * the server's words name it. Asked right after the turn that opened it, as the agent asks: the server reads both at
   * each ask. @param {string} url
   */
  const spaceAt = async (url) => [(await mcp(url, "tools/list")).tools.some((/** @type {any} */ t) => t.name === "space"), String((await mcp(url, "initialize")).instructions).includes("`space`")];

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-space-mid-"));
    logs = mkdtempSync(join(tmpdir(), "filament-space-mid-logs-"));
    shim = await startApp({
      memory: true,
      configure: (cfg, { dataDir }) => {
        // `cli` as Claude's adapter is: it takes MCP over HTTP and opens a session again (session/resume).
        const env = { FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SESSION_CAPS: "resume,close" };
        cfg.upstreams = [{ id: "cli", name: "cli", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } }];
        cfg.routes = [{ match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await removeDirs(folder, logs);
  });

  // (fails before: yes — the bridge reopened a session for none of the Space's changes: the turn said no Space, and the
  // session's record kept none, so Claude Code went on with the tools it listed as its session opened, a Space made
  // since never among them, and one deleted still listed)
  test("its Space made between two messages: the session opens again with the space tool and the server's words for it; switched off, on and deleted, the same; the Space as it was, the session stays", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "coder-1", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const { projectId } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
    const space = `/api/space/${encodeURIComponent(projectId)}`;
    /** The chat's switch for the space tool. @param {boolean} on */
    const switchTo = async (on) => assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { tools: { space: on } } } } })).status, 200);

    await said(id, "before the Space");
    const first = /** @type {any} */ (promptWith("before the Space"));
    assert.deepEqual(await spaceAt(first.mcpUrl), [false, false], "no Space yet: no tool, no words for it");

    assert.equal((await shim.api(space, { method: "POST" })).status, 200, "the Space made from the project's menu");
    const made = await said(id, "the Space made");
    const second = /** @type {any} */ (promptWith("the Space made"));
    assert.equal(second.sessionId, first.sessionId, `the same session\n${made}`);
    assert.notEqual(second.mcpUrl, first.mcpUrl, `opened again, at a new address for its tools\n${made}`);
    assert.equal(opens(first.sessionId).at(-1).method, "session/resume");
    assert.deepEqual(await spaceAt(second.mcpUrl), [true, true], "the space tool, and the server's words name it");
    assert.match(made, /resumed again: the task graph, memory's tools, the team it leads, what Filament's agent tool offers it, or the project's Space, changed the tools it takes$/m);

    const kept = await said(id, "the Space as it was");
    assert.equal(/** @type {any} */ (promptWith("the Space as it was")).mcpUrl, second.mcpUrl, `nothing moved: the session, and its cache, stay as they were\n${kept}`);

    await switchTo(false);
    await said(id, "switched off");
    const third = /** @type {any} */ (promptWith("switched off"));
    assert.equal(third.sessionId, first.sessionId);
    assert.notEqual(third.mcpUrl, second.mcpUrl, "opened again without it");
    assert.deepEqual(await spaceAt(third.mcpUrl), [false, false]);

    await switchTo(true);
    await said(id, "switched on");
    const fourth = /** @type {any} */ (promptWith("switched on"));
    assert.notEqual(fourth.mcpUrl, third.mcpUrl, "opened again with it");
    assert.deepEqual(await spaceAt(fourth.mcpUrl), [true, true]);

    assert.equal((await shim.api(space, { method: "DELETE" })).status, 200, "the Space deleted");
    await said(id, "the Space deleted");
    const fifth = /** @type {any} */ (promptWith("the Space deleted"));
    assert.equal(fifth.sessionId, first.sessionId);
    assert.notEqual(fifth.mcpUrl, fourth.mcpUrl, "opened again without it");
    assert.deepEqual(await spaceAt(fifth.mcpUrl), [false, false]);
  });
});

describe("Codex and Cursor's SDK", () => {
  const MCP_BASE = "http://127.0.0.1:9";
  const P = "0123456789ab";
  /** @type {string} */ let dir;
  /** The projects' Spaces, none made until the test makes one (10-29), and the chat's switch. */
  const store = createSpaceStore({ dir: null, madeOnly: true });
  const now = { on: true };
  const tools = createAgentTools({
    memory: null,
    memoryToolsOn: () => false,
    graphs: () => null,
    turns: createAgentTurns(),
    subagents: () => null,
    membersOf: () => null,
    space: { store, projectOf: () => P, nameOf: () => "an untitled chat", on: () => now.on },
  });
  /**
   * One turn as the agent path hands it to a bridge: the Space as the turn reads it (acp-turn.js `spaceOn`), with the
   * task graph's tool, so Filament's server rides every open. @param {string} text
   */
  const handed = (text) => {
    const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] };
    return { body, context: agentContext({ format: "anthropic", body, graph: true }), toolsAt: { chain: "c1", turn: "t1", graph: true, team: false, spaceOn: store.has(P) && now.on } };
  };
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-space-mid-bridges-"));
    process.env.FAKE_SDK_LOG = join(dir, "sdk.jsonl");
  });
  after(async () => {
    delete process.env.FAKE_SDK_LOG;
    await removeDirs(dir);
  });

  // (fails before: yes — Codex's thread opened again for none of the Space's changes, and kept the tools it listed as it
  // opened)
  test("Codex: its Space made, switched off or deleted between two messages opens the thread again at a new address; the Space as it was leaves it as it is", async () => {
    const bridge = new CodexBridge({ log: () => {}, stateFile: join(dir, "codex-sessions.json") });
    bridge.agentTools = tools;
    const up = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(dir, "cx.jsonl") }, cwdDefault: dir, permissions: "allow-all" } };
    const heard = (/** @type {string} */ method) => lines(join(dir, "cx.jsonl")).filter((m) => m.method === method);
    /** The address of Filament's server each open gave the thread, oldest first. */
    const tokens = () => [...heard("thread/start"), ...heard("thread/resume")].map((m) => String(m.params.config["mcp_servers.filament"].url).split("/").pop() || "");
    /** Whether the tools at the thread's newest address have the space tool, as Codex lists them as it opens. */
    const listed = () => tools.list(/** @type {any} */ (bridge.contextForMcpToken(tokens().at(-1) || ""))).some((t) => t.name === "space");
    const run = async (/** @type {string} */ text) => {
      const h = handed(text);
      return bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: h.body, conversationId: "chat", onEvent: () => {}, mcpBase: MCP_BASE, context: h.context, toolsAt: h.toolsAt });
    };
    const reopened = "opened again: the task graph, memory's tools, the team it leads, what Filament's agent tool offers it, the project's Space, or the visuals', the artifacts' or the team tool's switch, changed the tools it takes";
    try {
      now.on = true;
      const first = await run("hello");
      assert.equal(listed(), false, "no Space yet");
      store.make(P);
      const made = await run("the Space made");
      assert.deepEqual(heard("thread/resume").map((m) => m.params.threadId), [first.sessionId], "the same thread, opened again");
      assert.equal(heard("thread/unsubscribe").length, 1, "let go of first");
      assert.equal(new Set(tokens()).size, 2, "at a new address");
      assert.equal(listed(), true, "with the space tool");
      assert.ok(made.notes.some((/** @type {string} */ n) => n.endsWith(reopened)), made.notes.join("\n"));
      await run("the Space as it was");
      assert.equal(heard("thread/resume").length, 1, "the Space as it was leaves the thread as it is");
      now.on = false;
      await run("switched off");
      assert.deepEqual([heard("thread/resume").length, listed()], [2, false], "switched off: opened again without it");
      now.on = true;
      store.remove(P);
      await run("the Space deleted");
      assert.deepEqual([heard("thread/resume").length, listed()], [2, false], "switched on with no Space: no change for the thread");
      store.make(P);
      await run("made again");
      assert.deepEqual([heard("thread/resume").length, listed()], [3, true]);
      store.remove(P);
      await run("deleted again");
      assert.deepEqual([heard("thread/resume").length, listed()], [4, false], "deleted: opened again without it");
    } finally {
      bridge.shutdown();
      if (store.has(P)) store.remove(P);
    }
  });

  // (fails before: no — a guard: Cursor's agent takes Filament's tools with every message, read as each message goes, so
  // a Space made, switched off or deleted reaches it at once, with no load of the agent again)
  test("Cursor's SDK: the space tool goes with the first message after the Space is made, and goes with the first after it is switched off or deleted", async () => {
    const bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) }));
    bridge.agentTools = tools;
    const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir } };
    const sent = () => lines(join(dir, "sdk.jsonl")).filter((e) => e.event === "send").at(-1);
    const run = async (/** @type {string} */ text) => {
      const h = handed(text);
      return bridge.run({ upstream: up, modelId: "grok-4.6", format: "anthropic", body: h.body, conversationId: "sdk-chat", onEvent: () => {}, context: h.context, toolsAt: h.toolsAt });
    };
    try {
      now.on = true;
      await run("hello");
      assert.equal(sent().customTools.includes("space"), false, "no Space yet");
      store.make(P);
      await run("the Space made");
      assert.ok(sent().customTools.includes("space"), JSON.stringify(sent().customTools));
      now.on = false;
      await run("switched off");
      assert.equal(sent().customTools.includes("space"), false, "switched off");
      now.on = true;
      await run("switched on");
      assert.ok(sent().customTools.includes("space"));
      store.remove(P);
      await run("the Space deleted");
      assert.equal(sent().customTools.includes("space"), false, "deleted");
      assert.deepEqual(lines(join(dir, "sdk.jsonl")).filter((e) => e.event === "create" || e.event === "resume").map((e) => e.event), ["create"], "one agent, never loaded again for it");
    } finally {
      bridge.shutdown();
      if (store.has(P)) store.remove(P);
    }
  });
});
