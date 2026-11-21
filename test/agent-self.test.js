// @ts-check
// HarnessV3-ACP AC5-4: a coding agent writes Filament's summary of its own session (Self). Each bridge against its
// fake: in a fork of the session where the agent makes one — opened as the session was, so it reads the warm cache —
// let go of after; else in the session itself, its mode set back after. Read-only either way: what the agent asks is
// refused, nothing is written or run for it, Filament's own tools refuse their calls, and the chat's next turn waits for
// it. Then through the app: the line while the agent's cache is warm, Compact now, and Filament's copy when the agent
// cannot write it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FIXTURES, FAKE_ACP_AGENT, startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { afterHead } from "./helpers/agent-head.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { WRITING_REFUSAL } from "../src/adapters/agents/turn-bridge.js";
import { CODEX_SCHEMA } from "../src/adapters/agents/codex/schema-pin.js";
import { COMPACTED_WORDS, COMPACTION_HEADER } from "../src/adapters/agents/compactions.js";
import { standingText } from "../src/adapters/agents/context.js";
import { agentContext } from "../src/app/agent-context.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { FORK_SUMMARY_INSTRUCTION } from "../src/app/sessions/compactor.js";
import { applyTasks } from "../src/core/task-graph.js";

const quiet = () => {};
const MCP_BASE = "http://127.0.0.1:9";
/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** What the agent's client answers a summary that tries to write a file or run a command. */
const REFUSED = "error: Filament writes nothing and runs nothing while the agent writes its summary, which reads only";
const SUMMARY_OPENS = "[Filament: this conversation has reached its compaction line.";

/**
 * One turn's request with Filament's standing context, and that context as the agent path lifts it (app/acp-turn.js).
 * @param {string} text @param {boolean} [graph]
 */
function prepared(text, graph = false) {
  const body = { model: "m", max_tokens: 100, system: '<filament-memory kind="briefing">\nB1\n</filament-memory>', messages: [{ role: "user", content: text }] };
  return { body, context: agentContext({ format: "anthropic", body, graph }) };
}

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

let dir = "";
before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-agent-self-"));
  writeFileSync(join(dir, "README.md"), "hello agent\n");
});
after(async () => {
  await removeDirs(dir);
});

describe("an ACP agent", () => {
  /** @type {AcpBridge} */ let bridge;
  before(() => {
    bridge = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    bridge.agentTools = tools;
  });
  after(() => bridge.shutdown());
  /** @param {string} id @param {Record<string, string>} env */
  const upstream = (id, env) => ({
    id,
    name: id,
    type: "acp",
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(dir, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(dir, `${id}-prompts.jsonl`), ...env }, cwdDefault: dir, permissions: "allow-all" },
  });
  /** @param {any} up @param {string} text */
  const turn = (up, text) => {
    const { body, context } = prepared(text);
    return bridge.run({ upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "chat", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: false } });
  };

  test("in a fork of the session, opened as the session was, in a mode that changes nothing: what it asks refused, nothing written or run, Filament's tools refusing, the chat's next turn waiting; the fork deleted after", async () => {
    const gate = join(dir, "acp-gate");
    const up = upstream("forks", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", FAKE_ACP_SUMMARY_TRIES: "1", FAKE_ACP_SUMMARY_GATE: gate });
    const calls = () => lines(join(dir, "forks-calls.jsonl"));
    const prompts = () => lines(join(dir, "forks-prompts.jsonl"));
    const where = { upstream: up, conversationId: "chat" };
    assert.equal(bridge.summarizes(where), null, "no session to write from");
    await turn(up, "one");
    const two = await turn(up, "two");
    assert.equal(bridge.summarizes(where), "fork");
    const [open] = calls().filter((c) => c.method === "session/new");
    const token = String(open.mcpUrl).split("/").pop();

    const writing = bridge.summarize({ ...where, instruction: FORK_SUMMARY_INSTRUCTION });
    await until(() => calls().some((c) => c.method === "summary: tried"), "the agent tried its hands");
    assert.equal(bridge.contextForMcpToken(token)?.writing, true, "Filament's tools refuse their calls meanwhile");
    const three = turn(up, "three");
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(prompts().some((p) => p.text === "three"), false, "the chat's next turn waits for the summary");
    writeFileSync(gate, "");
    assert.deepEqual(await writing, {
      text: "<analysis>Going through it.</analysis>\n<summary>The session heard: one | two</summary>",
      how: "fork",
      usage: { input: 5, output: 40, cacheRead: 900, cacheWrite: 0, total: 945, cacheSeen: true },
    });
    assert.equal((await three).sessionId, two.sessionId);

    const fork = calls().find((c) => c.method === "session/fork");
    assert.deepEqual([fork.from, fork.mcpUrl], [two.sessionId, open.mcpUrl], "forked from the session, with Filament's MCP server");
    const opened = calls().find((c) => c.method === "session/resume" && c.sessionId === fork.sessionId);
    assert.deepEqual([opened?.mcpUrl, opened?.system], [open.mcpUrl, open.system], "opened as the session was: its MCP server, its system prompt");
    assert.ok(open.system, "the session's system prompt carries Filament's context");
    assert.deepEqual(calls().filter((c) => c.method === "session/set_mode").map((c) => [c.sessionId, c.modeId]), [[fork.sessionId, "ask"]], "the fork in the agent's ask mode; the session's own left as it was");
    assert.deepEqual(calls().find((c) => c.method === "summary: tried"), { method: "summary: tried", sessionId: fork.sessionId, pid: fork.pid, permission: "no", write: REFUSED, terminal: REFUSED, read: "ok" });
    assert.ok(!existsSync(join(dir, "notes.md")), "nothing written");
    await until(() => calls().some((c) => c.method === "session/delete" && c.sessionId === fork.sessionId), "the fork deleted");
    assert.deepEqual(prompts().filter((p) => p.sessionId === two.sessionId).map((p) => p.text), ["one", "two", "three"], "the session heard the chat alone");
    assert.deepEqual(prompts().filter((p) => p.sessionId === fork.sessionId).map((p) => p.text.startsWith(SUMMARY_OPENS)), [true]);
    assert.equal(bridge.contextForMcpToken(token)?.writing, false);
  });

  // (fails before: yes — the summary was no work on the agent's process: an account signed out or removed meanwhile
  // stopped the process under it)
  test("an agent let go of while it writes the summary: it writes on, then stops once its fork is deleted (the bug report's P3)", async () => {
    const gate = join(dir, "letgo-gate");
    // (fails before: no — a guard the mutation pass asked for: the agent answered the delete as it heard it, so an
    // agent stopped before its answer had still heard it)
    const up = upstream("letgo", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", FAKE_ACP_SUMMARY_GATE: gate, FAKE_ACP_DELETE_MS: "300" });
    const calls = () => lines(join(dir, "letgo-calls.jsonl"));
    await turn(up, "one");
    const proc = [...bridge.procs.values()].find((p) => p.key.startsWith("letgo|"));
    const writing = bridge.summarize({ upstream: up, conversationId: "chat", instruction: FORK_SUMMARY_INSTRUCTION });
    await until(() => lines(join(dir, "letgo-prompts.jsonl")).some((p) => p.text.startsWith(SUMMARY_OPENS)), "the agent writing");
    bridge.letGo(up.id);
    assert.equal(bridge.running(up.id), true, "its account is neither signed out nor removed meanwhile");
    writeFileSync(gate, "");
    assert.equal((await writing).how, "fork");
    await until(() => proc.exited, "the agent stopped");
    const fork = calls().find((c) => c.method === "session/fork");
    assert.ok(calls().some((c) => c.method === "session/delete" && c.sessionId === fork.sessionId), "once its fork was deleted");
    assert.equal(bridge.running(up.id), false);
  });

  // (fails before: no — a guard the mutation pass asked for: Filament never stopped while an agent let go of wrote)
  test("Filament stopping stops an agent let go of while it writes the summary", async () => {
    const own = new AcpBridge(/** @type {any} */ ({ log: quiet }));
    own.agentTools = tools;
    const gate = join(dir, "letgodown-gate");
    const up = upstream("letgodown", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", FAKE_ACP_SUMMARY_GATE: gate });
    const { body, context } = prepared("one");
    await own.run({ upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "chat", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: false } });
    const proc = [...own.procs.values()].find((p) => p.key.startsWith("letgodown|"));
    const writing = own.summarize({ upstream: up, conversationId: "chat", instruction: FORK_SUMMARY_INSTRUCTION }).catch((e) => e);
    await until(() => lines(join(dir, "letgodown-prompts.jsonl")).some((p) => p.text.startsWith(SUMMARY_OPENS)), "the agent writing");
    own.letGo(up.id);
    try {
      own.shutdown();
      await until(() => proc.exited, "the agent stopped");
    } finally {
      writeFileSync(gate, "");
      await writing;
    }
  });

  // (fails before: no — a guard the mutation pass asked for (the bug report's L23): first against the silence bound,
  // gone since HarnessV3-FailurePoints §4 B; now that a summary's reader takes the agent's requests as a turn's does)
  test("an agent reading files as it writes the summary: its requests are served, and the summary is waited for", async () => {
    const up = upstream("readsum", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", FAKE_ACP_SUMMARY_READS_MS: "1500" });
    await turn(up, "one");
    const r = await bridge.summarize({ upstream: up, conversationId: "chat", instruction: FORK_SUMMARY_INSTRUCTION });
    assert.equal(r.how, "fork");
  });

  // (fails before: yes — the session /resume attached was kept as the attach opened it, without Filament's instructions
  // or tools, and the fork Filament's summary is written in opened without them too)
  test("a session /resume attached: the chat's next turn opens it as a turn opens one, and the fork for Filament's summary copies that (the bug report's L25)", async () => {
    const up = upstream("attached", { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", FAKE_ACP_ALLOW_LOAD: "1" });
    const calls = () => lines(join(dir, "attached-calls.jsonl"));
    const r = await bridge.attach({ upstream: up, modelId: "fake-a", format: "anthropic", body: prepared("/resume sess_old1").body, cwdHint: null, conversationId: "chat", sessionId: "sess_old1" });
    assert.ok(r.ok, JSON.stringify(r));
    await turn(up, "one");
    const opens = calls().filter((c) => c.method === "session/resume" && c.sessionId === "sess_old1");
    assert.equal(opens.length, 2, "opened by the attach, then by the chat's turn");
    assert.ok(calls().some((c) => c.method === "session/close" && c.sessionId === "sess_old1"), "let go of in between");
    const opened = opens[1];
    assert.ok(opened.system && opened.mcpUrl, "the turn's open carries Filament's instructions and its tools");
    await bridge.summarize({ upstream: up, conversationId: "chat", instruction: FORK_SUMMARY_INSTRUCTION });
    const fork = calls().find((c) => c.method === "session/fork");
    const forkOpen = calls().find((c) => c.method === "session/resume" && c.sessionId === fork?.sessionId);
    assert.deepEqual([forkOpen?.system, forkOpen?.mcpUrl], [opened.system, opened.mcpUrl], "the fork opens as the session did");
  });

  test("in the session itself where the agent forks none: in its plan mode, the mode it was in set back after", async () => {
    const up = upstream("inplace", { FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "resume,close" });
    const calls = () => lines(join(dir, "inplace-calls.jsonl"));
    const prompts = () => lines(join(dir, "inplace-prompts.jsonl"));
    const where = { upstream: up, conversationId: "chat" };
    const one = await turn(up, "one");
    assert.equal(bridge.summarizes(where), "session");
    const modes = () => calls().filter((c) => c.method === "session/set_mode").map((c) => c.modeId);
    assert.deepEqual(modes(), ["bypassPermissions"], "the turn's: the agent's word for agent");
    const r = await bridge.summarize({ ...where, instruction: FORK_SUMMARY_INSTRUCTION });
    assert.deepEqual([r.text, r.how], ["<analysis>Going through it.</analysis>\n<summary>The session heard: one</summary>", "session"]);
    assert.deepEqual(modes(), ["bypassPermissions", "plan", "bypassPermissions"], "plan while it wrote, then the mode it was in");
    assert.deepEqual(calls().filter((c) => /^session\/(fork|delete|close)$/.test(c.method)), [], "nothing forked, nothing let go");
    await turn(up, "two");
    assert.equal(modes().length, 3, "the next turn finds the session in its mode");
    assert.deepEqual(prompts().map((p) => [p.sessionId, p.text.startsWith(SUMMARY_OPENS) ? "summary" : p.text]), [[one.sessionId, "one"], [one.sessionId, "summary"], [one.sessionId, "two"]]);
  });

  // (fails before: no — a guard the mutation pass asked for: no session reopened after a restart was asked for a
  // model by its version)
  test("after a restart, a model asked for by its version is the one the agent's words name as its session reopens", async () => {
    const stateFile = join(dir, "labels-kept.json");
    const up = upstream("labelsload", { FAKE_ACP_CONFIG: "1", FAKE_ACP_ALLOW_LOAD: "1" });
    /** @param {AcpBridge} b @param {string} modelId @param {string} text */
    const on = (b, modelId, text) => {
      const { body, context } = prepared(text);
      return b.run({ upstream: up, modelId, format: "anthropic", body, conversationId: "chat", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: false } });
    };
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    first.agentTools = tools;
    try {
      await on(first, "default", "one");
    } finally {
      first.shutdown();
    }
    const again = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    again.agentTools = tools;
    try {
      await on(again, "claude-sonnet-5", "two");
      const [heard] = lines(join(dir, "labelsload-prompts.jsonl")).slice(-1);
      assert.deepEqual([heard.text, heard.loaded, heard.config?.model], ["two", true, "sonnet"], "reopened, then Sonnet 5 in its words");
    } finally {
      again.shutdown();
    }
  });

  // (fails before: yes — the session map kept no modes of a session's, and a session reopened naming its modes but no
  // models took none of them: after a restart the agent wrote Filament's summary in whatever mode its session was in)
  test("after a restart, in the session itself: in the mode that changes nothing, from the modes the map kept or the session named as it reopened (the bug report's L26)", async () => {
    const stateFile = join(dir, "modes-kept.json");
    // Reopened with session/load, which names no modes; with session/resume, which names its modes alone.
    const ups = [upstream("modesload", { FAKE_ACP_ALLOW_LOAD: "1" }), upstream("modesresume", { FAKE_ACP_CONFIG: "1", FAKE_ACP_SESSION_CAPS: "resume,close" })];
    /** @param {AcpBridge} b @param {any} up @param {string} text */
    const on = (b, up, text) => {
      const { body, context } = prepared(text);
      return b.run({ upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "chat", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_1", turn: "t_1", graph: false } });
    };
    const first = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    first.agentTools = tools;
    try {
      for (const up of ups) await on(first, up, "one");
    } finally {
      first.shutdown();
    }
    const again = new AcpBridge(/** @type {any} */ ({ log: quiet, stateFile }));
    again.agentTools = tools;
    try {
      for (const up of ups) {
        await on(again, up, "two");
        const where = { upstream: up, conversationId: "chat" };
        assert.equal(again.summarizes(where), "session", up.id);
        const set = () => lines(join(dir, `${up.id}-calls.jsonl`)).filter((c) => c.method === "session/set_mode").map((c) => c.modeId);
        const before = set().length;
        assert.equal((await again.summarize({ ...where, instruction: FORK_SUMMARY_INSTRUCTION })).how, "session");
        assert.deepEqual(set().slice(before), ["ask", "agent"], `${up.id}: the mode that changes nothing while it wrote, then the one it was in`);
      }
    } finally {
      again.shutdown();
    }
  });

  test("an agent that fails to write it: the failure, the fork deleted all the same, and the chat goes on in its session", async () => {
    const up = upstream("fails", { FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", FAKE_ACP_SUMMARY_FAIL: "1" });
    const calls = () => lines(join(dir, "fails-calls.jsonl"));
    const where = { upstream: up, conversationId: "chat" };
    const one = await turn(up, "one");
    await assert.rejects(bridge.summarize({ ...where, instruction: FORK_SUMMARY_INSTRUCTION }), /overloaded/i);
    const fork = calls().find((c) => c.method === "session/fork");
    await until(() => calls().some((c) => c.method === "session/delete" && c.sessionId === fork.sessionId), "the fork deleted");
    assert.equal((await turn(up, "two")).sessionId, one.sessionId);
  });
});

describe("Codex", () => {
  /** @type {CodexBridge} */ let bridge;
  const file = () => join(dir, "codex.jsonl");
  before(() => {
    bridge = new CodexBridge({ log: quiet, stateFile: join(dir, "codex-sessions.json") });
    bridge.agentTools = tools;
  });
  after(() => bridge.shutdown());
  const up = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(dir, "codex.jsonl"), FAKE_CODEX_SUMMARY_TRIES: "1" }, cwdDefault: dir, permissions: "allow-all" } };
  /** @param {string} method */
  const heard = (method) => lines(file()).filter((m) => m.method === method);
  /** @param {string} text */
  const turn = (text) => {
    const { body, context } = prepared(text);
    return bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body, conversationId: "chat", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_2", turn: "t_2", graph: false } });
  };

  test("in an ephemeral fork of the thread, opened as the thread was, on its model, read-only: what it asks declined; the fork let go after", async () => {
    const where = { upstream: up, conversationId: "chat" };
    assert.equal(bridge.summarizes(where), null, "no thread to write from");
    await turn("one");
    const two = await turn("two");
    assert.equal(bridge.summarizes(where), "fork");
    const r = await bridge.summarize({ ...where, instruction: FORK_SUMMARY_INSTRUCTION });
    assert.deepEqual([r.text, r.how, r.usage?.cacheRead], ["<analysis>Going through it.</analysis>\n<summary>The thread heard: one | two</summary>", "fork", 900]);

    const [start] = heard("thread/start");
    const [fork] = heard("thread/fork");
    const { threadId, cwd, ephemeral, excludeTurns, approvalPolicy, sandbox, model, ...same } = fork.params;
    assert.deepEqual([threadId, cwd, ephemeral, excludeTurns, approvalPolicy, sandbox, model], [two.sessionId, two.cwd, true, true, "untrusted", "read-only", start.params.model]);
    assert.deepEqual(same, { developerInstructions: start.params.developerInstructions, config: start.params.config }, "Filament's MCP server and the instructions, as the thread opened with them");
    assert.equal(start.params.developerInstructions, standingText(prepared("one").context.standing));
    assert.deepEqual(Object.keys(fork.params).filter((k) => !CODEX_SCHEMA.threadFork.includes(k)), [], "only what thread/fork takes");
    const sent = heard("turn/start").map((m) => [m.params.threadId, m.params.input[0].text]);
    const forkId = sent[2][0];
    assert.notEqual(forkId, two.sessionId);
    assert.ok(sent[2][1].startsWith(SUMMARY_OPENS));
    assert.deepEqual(sent.slice(0, 2).map(([t]) => t), [two.sessionId, two.sessionId]);
    assert.deepEqual(lines(file()).filter((m) => m.result && "decision" in m.result).map((m) => m.result.decision), ["decline"], "the command it asked to run, declined");
    await until(() => heard("thread/unsubscribe").some((m) => m.params.threadId === forkId), "the fork let go");
    assert.equal((await turn("three")).sessionId, two.sessionId, "the chat goes on in its thread");
  });

  // (fails before: yes — the summary was no work on the app-server: an account signed out or removed meanwhile stopped
  // the app-server under it)
  test("an app-server let go of while Codex writes the summary: it writes on, then stops once the fork is let go of (the bug report's P3)", async () => {
    const gate = join(dir, "cxletgo-gate");
    const calls = join(dir, "cxletgo.jsonl");
    // (fails before: no — a guard the mutation pass asked for: Codex answered the unsubscribe as it heard it, so an
    // app-server stopped before its answer had still heard it)
    const other = { ...up, id: "cxletgo", name: "cxletgo", acp: { ...up.acp, env: { FAKE_CODEX_CALLS: calls, FAKE_CODEX_SUMMARY_GATE: gate, FAKE_CODEX_DROP_MS: "300" } } };
    const { body, context } = prepared("one");
    await bridge.run({ upstream: other, modelId: "gpt-6-astra", format: "anthropic", body, conversationId: "chat", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_2", turn: "t_2", graph: false } });
    const proc = bridge.procs.get(other.id);
    assert.ok(proc, "the app-server runs");
    const writing = bridge.summarize({ upstream: other, conversationId: "chat", instruction: FORK_SUMMARY_INSTRUCTION });
    const started = () => lines(calls).filter((m) => m.method === "turn/start");
    await until(() => started().length === 2, "Codex writing");
    bridge.letGo(other.id);
    assert.equal(bridge.running(other.id), true, "its account is neither signed out nor removed meanwhile");
    writeFileSync(gate, "");
    assert.equal((await writing).how, "fork");
    await until(() => proc.exited, "the app-server stopped");
    const forkId = started()[1].params.threadId;
    assert.ok(lines(calls).some((m) => m.method === "thread/unsubscribe answered" && m.params.threadId === forkId), "once the fork was let go of");
    assert.equal(bridge.running(other.id), false);
  });

  // (fails before: yes — with no clock on the summary (HarnessV3-FailurePoints §4 B), nothing ended its wait once the
  // app-server had ended: the summary waited for Codex's answer for ever)
  test("the app-server ends while Codex writes the summary: the summary fails in the process's words", async () => {
    const calls = join(dir, "cxgone.jsonl");
    const other = { ...up, id: "cxgone", name: "cxgone", acp: { ...up.acp, env: { FAKE_CODEX_CALLS: calls, FAKE_CODEX_SUMMARY_GATE: join(dir, "cxgone-gate-never") } } };
    const { body, context } = prepared("one");
    await bridge.run({ upstream: other, modelId: "gpt-6-astra", format: "anthropic", body, conversationId: "chat", onEvent: () => {}, mcpBase: MCP_BASE, context, toolsAt: { chain: "ch_3", turn: "t_3", graph: false } });
    const writing = bridge.summarize({ upstream: other, conversationId: "chat", instruction: FORK_SUMMARY_INSTRUCTION });
    await until(() => lines(calls).filter((m) => m.method === "turn/start").length === 2, "Codex writing");
    /** @type {any} */ (bridge.procs.get(other.id)).child.kill();
    await assert.rejects(writing, /agent process exited/);
  });
});

describe("Cursor's SDK", () => {
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
  const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir } };
  /** @param {string} text */
  const turn = (text) => {
    const { body, context } = prepared(text, true);
    return bridge.run({ upstream: up, modelId: "grok-4.6", format: "anthropic", body, conversationId: "sdk-chat", onEvent: () => {}, context, toolsAt: { chain: "ch_3", turn: "t_3", graph: true } });
  };

  test("in the chat's agent, on its turns' model, in plan mode: Filament's tools refusing meanwhile, working again after", async () => {
    const where = { upstream: up, conversationId: "sdk-chat" };
    assert.equal(bridge.summarizes(where), null, "no agent to write from");
    const one = await turn("one");
    assert.equal(bridge.summarizes(where), "session");
    const r = await bridge.summarize({ ...where, instruction: FORK_SUMMARY_INSTRUCTION });
    assert.deepEqual(r, {
      text: "<analysis>Going through it.</analysis>\n<summary>The agent heard 1 message(s) before this one</summary>",
      how: "session",
      usage: { input: 40, output: 30, cacheRead: 900, cacheWrite: 0, total: 970, cacheSeen: true },
    });
    const [first, summary] = log().filter((e) => e.event === "send");
    assert.deepEqual([summary.agentId, summary.mode, summary.model], [one.sessionId, "plan", first.model]);
    assert.ok(summary.text.startsWith(SUMMARY_OPENS));
    assert.equal(log().find((e) => e.event === "summary-tool")?.text, WRITING_REFUSAL, "Filament's tools refused the agent's call");
    const on = await turn("~graph");
    assert.match(on.text, /graph:Added a\./, "and answer again");
  });

  // (fails before: yes — Cursor's agent wrote the summary whatever compaction it stood on: after an undo, from the
  // compaction undone)
  test("only from an agent standing on the chat's newest compaction (the bug report's L28)", async () => {
    const { body, context } = prepared("one");
    await bridge.run({ upstream: up, modelId: "grok-4.6", format: "anthropic", body, conversationId: "sdk-compacted", headers: { [COMPACTION_HEADER]: "2" }, onEvent: () => {}, context, toolsAt: { chain: "ch_4", turn: "t_4", graph: false } });
    const where = { upstream: up, conversationId: "sdk-compacted" };
    assert.equal(bridge.summarizes({ ...where, base: 2 }), "session");
    assert.equal(bridge.summarizes({ ...where, base: 1 }), null, "an undo took the chat back past the compaction the agent stands on");
  });
});

describe("through the app", () => {
  const SUMMARY = "SUMMARY: the turns so far, condensed.";
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** @param {string} id */
  const calls = (id) => lines(join(root, `${id}-calls.jsonl`));
  /** What each prompt carries after Filament's own head, where it has one. @param {string} id */
  const prompts = (id) => lines(join(root, `${id}-prompts.jsonl`)).map((p) => afterHead(p.prompt));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-self-app-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    // Filament's own writer, for the summaries the agent does not write.
    up = await fakeUpstream(() => anthropicReply(SUMMARY, { model: "m-1", usage: { input_tokens: 10, output_tokens: 5 } }));
    /** @param {string} id @param {Record<string, string>} [env] */
    const agent = (id, env = {}) => ({
      id,
      name: id,
      type: "acp",
      acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, `${id}-calls.jsonl`), FAKE_ACP_LOG: join(root, `${id}-prompts.jsonl`), FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete", ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false },
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          agent("ag"),
          agent("fails", { FAKE_ACP_SUMMARY_FAIL: "1" }),
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
        ];
        cfg.routes = [
          { match: "ag/*", upstream: "ag", upstreamModel: "{1}", enabled: true },
          { match: "fails/*", upstream: "fails", upstreamModel: "{1}", enabled: true },
          { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await shim.api(path, init)).json();
  /** A session on `model`, its compaction model Filament's writer. @param {string} model @param {any} [compaction] */
  // Each session makes room by itself at the line (Automatic) unless a test says otherwise: asking first is the
  // default (HarnessV4_Tasks C26).
  const open = async (model, compaction = {}) => String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", settings: { context: { compaction: { model: "m-1", mode: "auto", ...compaction } } } } })).id);
  /** The turn's reply and its record. @param {string} id @param {string} content */
  const say = async (id, content) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(res.status, 200, await res.clone().text());
    return { reply: await res.json(), rec: await shim.record(String(res.headers.get("x-filament-request-id"))) };
  };
  /** What the turn's composition said of the compaction and the agent. @param {any} rec */
  const composed = (rec) => (rec.changes || []).filter((/** @type {string} */ x) => /^compose: (agent|compaction):/.test(x));
  /** @param {string} id */
  const forks = (id) => calls(id).filter((c) => c.method === "session/fork").map((c) => c.sessionId);

  test("at the line while the agent's cache is warm, the agent writes the summary in a fork of its session, read from its cache; the next session starts from it", async () => {
    const id = await open("ag/fake-a");
    await say(id, "one ~holds 1000");
    await say(id, "two ~holds 180000");
    const asked = up.received.length;
    const { rec } = await say(id, "three");
    assert.equal(up.received.length, asked, "Filament's writer not called");
    assert.deepEqual(composed(rec), [
      "compose: compaction: turns 1–2 summarized at the compaction line by ag/fake-a, the agent itself, in a fork of its session; nothing learned from them now: memory is off: nothing learns",
      "compose: agent: the agent's context holds 180,000 of its 200,000-token window, past the 170,000-token compaction line — suggested: the agent's cache is warm, so it writes the summary from it; this turn starts a fresh agent session from the compaction",
    ], (rec.changes || []).join("\n"));
    const [fork] = forks("ag");
    assert.ok(fork, "a fork of the session");
    await until(() => calls("ag").some((c) => c.method === "session/delete" && c.sessionId === fork), "the fork deleted");
    const seed = prompts("ag").at(-1) || "";
    assert.ok(seed.startsWith(`${COMPACTED_WORDS}:\n\n### User\n[Filament compacted `), seed.slice(0, 300));
    assert.ok(seed.includes("The session heard: one ~holds 1000 | two ~holds 180000") && seed.endsWith("\n---\nLatest user message:\n\nthree"), seed.slice(-400));
    const ops = (await json("/api/ops?kinds=compaction&limit=20")).ops || [];
    const op = ops.find((/** @type {any} */ o) => o.detail?.chainId === id);
    const d = op?.detail || {};
    assert.deepEqual([d.how, d.inputTokens, d.outputTokens, d.cacheReadTokens, d.cacheWriteTokens], ["agent-fork", 5, 40, 900, 0], "what the summary cost, mostly read from the agent's cache");
  });

  test("an agent that cannot write it: Filament makes room on its copy, and says why", async () => {
    const id = await open("fails/fake-a");
    await say(id, "one ~holds 1000");
    await say(id, "two ~holds 180000");
    const { rec } = await say(id, "three");
    assert.deepEqual(composed(rec), [
      "compose: compaction: turns 1–2 summarized at the compaction line by m-1; nothing learned from them now: memory is off: nothing learns",
      "compose: agent: the agent's context holds 180,000 of its 200,000-token window, past the 170,000-token compaction line — the agent (fails/fake-a) failed: Internal error: Overloaded, so Filament made room on its copy instead; this turn starts a fresh agent session from the compaction",
    ], (rec.changes || []).join("\n"));
    const [fork] = forks("fails");
    await until(() => calls("fails").some((c) => c.method === "session/delete" && c.sessionId === fork), "the fork deleted");
    assert.ok((prompts("fails").at(-1) || "").includes(SUMMARY), "the next session starts from Filament's summary");
  });

  test("Compact now: the agent writes it while its cache is warm, or always where the session says so; a method named for this once, or a cold cache, is Filament's", async () => {
    const id = await open("ag/fake-a");
    await say(id, "one");
    await say(id, "two ~holds 5000");
    /** Compact now, its row undone after so the next one has the same turns. @param {any} body */
    const compact = async (body) => {
      const done = await json(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body });
      assert.equal(done.ok, true, JSON.stringify(done));
      const undone = await json(`/api/sessions/${encodeURIComponent(id)}/compactions/${done.compaction.id}/undo`, { method: "POST", body: {} });
      assert.ok(undone.undone, JSON.stringify(undone));
      return done;
    };
    const before = forks("ag").length;
    const warm = await compact({});
    assert.match(warm.note, /^compaction: turns 1–2 summarized on request by ag\/fake-a, the agent itself, in a fork of its session/);
    assert.deepEqual([warm.compaction.detail.how, forks("ag").length], ["agent-fork", before + 1]);
    const named = await compact({ method: "summary" });
    assert.match(named.note, /^compaction: turns 1–2 summarized on request by m-1/);
    assert.equal(forks("ag").length, before + 1, "no fork");
    // Its turns ended over an hour ago: the agent's cache has gone cold.
    /** @type {any} */ (shim.app.memory.archive).db.prepare("UPDATE turns SET started_at = started_at - ?, ended_at = ended_at - ? WHERE chain_id = ?").run(61 * 60_000, 61 * 60_000, id);
    const cold = await compact({});
    assert.match(cold.note, /^compaction: turns 1–2 summarized on request by m-1/);
    assert.equal(forks("ag").length, before + 1, "no fork");
    const set = await json(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { context: { compaction: { agent: "self" } } } } });
    assert.equal(set.ok ?? true, true, JSON.stringify(set));
    const chosen = await compact({});
    assert.match(chosen.note, /^compaction: turns 1–2 summarized on request by ag\/fake-a, the agent itself, in a fork of its session/);
    assert.equal(forks("ag").length, before + 2);
  });

  // (fails before: yes — a Self named for this once that failed was made on Filament's copy anyway, and the way ours
  // with a method of Filament's was refused in the words for the agent's summary)
  test("Compact now naming a way: Self is the agent's, or refused in its words, never Filament's copy; ours with a method makes room on Filament's copy", async () => {
    const id = await open("fails/fake-a");
    await say(id, "one");
    await say(id, "two ~holds 5000");
    const asked = up.received.length;
    const self = await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { way: "self" } });
    assert.deepEqual([self.status, (await self.json()).error], [502, "the agent (fails/fake-a) failed: Internal error: Overloaded"]);
    assert.equal(up.received.length, asked, "Filament's writer not called");
    const ours = await json(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { way: "ours", method: "summary" } });
    assert.match(String(ours.note), /^compaction: turns 1–2 summarized on request by m-1/, JSON.stringify(ours));
  });
});
