// @ts-check
// h1 (the owner's of 11-08: give sub-agents Filament's background_command, keep a sub-agent's run open until its
// commands finish, then switch Claude's own off for them — "nothing is lost, and Filament sees everything"): a sub-agent
// on a coding agent is offered the tool as the main agent is, its run does not end nor send its report while a command
// it started still runs, each end reaches it as the main agent's reaches the chat's turn, and its Claude Code session
// is opened with Claude's own background tasks off. Once its run is over, an end goes to the session's agent, the
// sub-agent named.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { planToolset } from "../src/adapters/agents/acp/toolset.js";
import { BACKGROUND_COMMAND, attendCommands, createBackgroundCommands, stopByPerson } from "../src/app/agent/commands.js";
import { disposeBackgroundShells, disposeSpills, peekShellExits, runningShellsOf, tellShellExits } from "../src/adapters/tools/hands.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { serverInstructions } from "../src/http/mcp.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

after(async () => {
  await disposeBackgroundShells();
  disposeSpills();
});
/** A node one-liner, as the shell runs it. @param {string} js */
const node = (js) => `node -e "${js}"`;
const allow = async () => ({ asked: false });

// (fails before: yes — a sub-agent's session was offered no background_command, and its Claude Code kept its own
// background tasks)
test("a sub-agent's session is offered background_command, named as it connects, and its Claude Code is opened with its own background tasks off; its own Agent tool stays", () => {
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null, commands: createBackgroundCommands() });
  const by = { id: "sa_00000001", exchange: 1, name: "Builder" };
  const listed = tools.list({ cwd: "/w", upstream: "cli", turn: null, graph: false, chain: "c1", by }).find((t) => t.name === BACKGROUND_COMMAND) || null;
  assert.equal(listed?.upfront, true, "a sub-agent's, loaded whole");
  assert.match(serverInstructions({ cwd: "/w", background: true }), /Its `background_command` runs any command that can take more than a minute/);
  /** @param {Record<string, any>} turn */
  const plan = (turn) => planToolset({ acp: {}, upstream: { id: "claude" }, proc: { initResult: { agentCapabilities: { mcpCapabilities: { http: true } } } }, profile: /** @type {any} */ ({ rawMessages: true, compactWindow: true, sessionEnv: true }), turn: { bridge: "prompts", ...turn }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:9", memoryWanted: false, existingToken: null, notes: [] });
  const sub = plan({ toolsAt: { chain: "c1", by } });
  assert.deepEqual([sub.wantMcp, sub.mcpServers.map((s) => s.name)], [true, ["filament"]], "Filament's server carries the tool, whatever else the sub-agent goes without");
  const options = /** @type {any} */ (sub.sessionMeta)._meta?.claudeCode?.options;
  assert.deepEqual(options?.env, { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" });
  assert.deepEqual(options?.disallowedTools, ["CronCreate", "CronDelete", "CronList", "ScheduleWakeup"], "Filament gives a sub-agent no agent tool: Claude's own stays; its timers go (x50)");
  assert.equal(/** @type {any} */ (plan({ toolsAt: { chain: "c1" } }).sessionMeta)._meta?.claudeCode?.options?.env, undefined, "a session no sub-agent's keeps them");
});

// (fails before: yes — its command's end went to the session's agent as that agent's own, "your background command")
test("a sub-agent's command that ends with no run of its to hear it goes to the session's agent, the sub-agent named", async () => {
  /** @type {any[]} */
  const ends = [];
  const commands = createBackgroundCommands({ registry: () => ({ commandEnd: (/** @type {string} */ chain, /** @type {any} */ r) => (ends.push({ chain, ...r }), { ok: false }) }), graceMs: 50 });
  const r = await commands.call({ command: node("setTimeout(()=>{console.log('late');process.exit(2)},600)") }, { chain: "c-sub", cwd: tmpdir(), permit: allow, agent: "subagent:sa_00000002" });
  const id = String(/bg_[0-9a-z]+/.exec(r.text)?.[0] || "");
  const main = { session: "c-sub", agent: null };
  const [x] = /** @type {any[]} */ (await until(() => (peekShellExits(main).length ? peekShellExits(main) : null), "the end, told to the session's agent", { timeoutMs: 15_000 }));
  assert.equal(x.id, id);
  assert.match(x.text, new RegExp(`^\\[Filament: background command ${id}, started by sub-agent sa_00000002, ended: \`node -e .+\` exited with code 2 after \\d+ s\\.\\]\\nIts output:\\nlate$`), x.text);
  assert.equal(ends.length, 1, "the session's running turn was asked first");
  tellShellExits(main, [id]);
});

// (fails before: yes — its run owed a command that never ends by itself for good: a server it left running held its run,
// and whoever waited on its report, until someone stopped it)
test("a sub-agent's run waits for its commands for a bounded time: past it the run lets go, the command runs on, and the record says so", async () => {
  const commands = createBackgroundCommands({ registry: () => ({ commandEnd: () => ({ ok: false }) }), graceMs: 50 });
  const owner = { session: "c-held", agent: "subagent:sa_00000003" };
  /** @type {string[]} */
  const notes = [];
  const lt = attendCommands(owner, { emit: () => {}, note: (text) => notes.push(text), heldMs: 300 });
  const r = await commands.call({ command: node("setInterval(()=>{},1000)") }, { chain: owner.session, cwd: tmpdir(), permit: allow, agent: owner.agent });
  const id = String(/bg_[0-9a-z]+/.exec(r.text)?.[0] || "");
  const owes = lt.owes?.();
  assert.ok(owes, "its run owes the command while it runs");
  const got = await Promise.race([owes.then(() => "let go"), new Promise((res) => setTimeout(() => res("still held"), 5000))]);
  assert.equal(got, "let go", "the run's wait ends at its bound, the command still running");
  assert.equal(lt.owes?.(), null, "and it owes the command no more");
  assert.ok(runningShellsOf(owner.session).some((s) => s.id === id), "the command runs on: stopping it could end a server its launcher wanted");
  assert.match(notes.join("\n"), new RegExp(`^agent: the sub-agent's run waited \\d+ s for its background command ${id} and ends without it: it runs on, its end going to the session's agent$`, "m"), notes.join("\n"));
  lt.close();
  await commands.call({ id, stop: true }, { chain: owner.session, cwd: tmpdir(), permit: allow, agent: owner.agent });
});

// (fails before: yes — its run's wait for the command ended on the stop with nothing heard: the person's Stop was told
// to the session's agent alone, the session's agent's to nobody, and the sub-agent reported as though it never ran)
test("a sub-agent's command stopped by the person, or by the session's agent, while its run waits on it is said into that run, which wakes with it", async () => {
  const commands = createBackgroundCommands({ registry: () => ({ commandEnd: () => ({ ok: false }) }), graceMs: 50 });
  const owner = { session: "c-stopped", agent: "subagent:sa_00000004" };
  const lt = attendCommands(owner, { emit: () => {}, note: () => {} });
  const start = async () => String(/bg_[0-9a-z]+/.exec((await commands.call({ command: node("setInterval(()=>{},1000)") }, { chain: owner.session, cwd: tmpdir(), permit: allow, agent: owner.agent })).text)?.[0] || "");
  try {
    const byPerson = await start();
    const waits = lt.owes?.();
    assert.ok(waits);
    const stopped = await stopByPerson(owner.session, byPerson);
    assert.equal(stopped.ok, true);
    await waits;
    const heard = lt.take({});
    assert.equal(heard.length, 1, heard.join("\n"));
    assert.match(heard[0], new RegExp(`^\\[Filament: background command ${byPerson} \\(\`node -e .+\`\\) was stopped by the person after \\d+ s\\.\\]$`));
    assert.deepEqual(peekShellExits({ session: owner.session, agent: null }).map((x) => x.id), [], "the sub-agent heard it: nobody else is told");
    const byMain = await start();
    const again = lt.owes?.();
    assert.ok(again);
    const r = await commands.call({ id: byMain, stop: true }, { chain: owner.session, cwd: tmpdir(), permit: allow, agent: null });
    assert.match(r.text, new RegExp(`^Stopped background command ${byMain}`));
    await again;
    const heardMain = lt.take({});
    assert.equal(heardMain.length, 1, heardMain.join("\n"));
    assert.match(heardMain[0], new RegExp(`^\\[Filament: background command ${byMain} \\(\`node -e .+\`\\) was stopped by the session's agent after \\d+ s\\.\\]$`));
  } finally {
    lt.close();
  }
});

// (fails before: yes — the bug hunt of 11-08: a sub-agent's list showed the session's agent's commands as though they
// were its own, and told it to read or stop them, which it may not)
test("a sub-agent's list says whose each command is: its own unnamed, the session's agent's and another's named, and that only its own are its to read and stop", async () => {
  const commands = createBackgroundCommands({ graceMs: 50 });
  const chain = "c-whose";
  /** @param {string | null} agent */
  const start = async (agent) => String(/bg_[0-9a-z]+/.exec((await commands.call({ command: node("setInterval(()=>{},1000)") }, { chain, cwd: tmpdir(), permit: allow, agent })).text)?.[0] || "");
  const mains = await start(null);
  const mine = await start("subagent:sa_00000005");
  const theirs = await start("subagent:sa_00000006");
  try {
    const listed = (await commands.call({ list: true }, { chain, cwd: tmpdir(), agent: "subagent:sa_00000005" })).text;
    assert.match(
      listed,
      new RegExp(`^3 background commands run in this chat now, the oldest first:\\n- ${mains}: \`node -e .+\` in .+, running for \\d+ s, started by the session's agent\\n- ${mine}: \`node -e .+\` in .+, running for \\d+ s\\n- ${theirs}: \`node -e .+\` in .+, running for \\d+ s, started by sub-agent sa_00000006\\nRead one of yours: background_command\\(\\{ id \\}\\)\\. Stop one of yours: background_command\\(\\{ id, stop: true \\}\\)\\. Another agent's are its own to read and stop\\.$`),
      listed,
    );
    const main = (await commands.call({ list: true }, { chain, cwd: tmpdir(), agent: null })).text;
    assert.match(main, new RegExp(`\\n- ${mains}: \`node -e .+\` in .+, running for \\d+ s\\n- ${mine}: .+, started by sub-agent sa_00000005\\n- ${theirs}: .+, started by sub-agent sa_00000006\\nRead one: background_command\\(\\{ id \\}\\)\\. Stop one: background_command\\(\\{ id, stop: true \\}\\)\\.$`), "the session's agent reads and stops every one, as before");
  } finally {
    for (const id of [mains, mine, theirs]) await commands.call({ id, stop: true }, { chain, cwd: tmpdir(), agent: null });
  }
});

describe("a sub-agent's turn and the background tasks Claude left running (the owner's D3 of 11-09), at the bridge", () => {
  let root = "";
  /** @type {AcpBridge} */
  let bridge;
  /** Claude's adapter, its cycle after the turn FAKE_ACP_WAKE_MS on: the task ends then. @param {number} wakeMs */
  const up = (wakeMs) => ({ id: `claude-${wakeMs}`, name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_WAKE_MS: String(wakeMs) }, cwdDefault: root, permissions: "allow-all", hints: false } });
  /**
   * A sub-agent's turn: no chat, its tasks held `heldMs`; `text` the prompt (Claude's Monitor left running, by default).
   * @param {number} wakeMs @param {number} heldMs @param {{ signal?: AbortSignal, text?: string, onEvent?: (ev: any) => void }} [o]
   */
  const turn = (wakeMs, heldMs, { signal, text = "Run the tests. ~wake-monitor", onEvent = () => {} } = {}) =>
    bridge.run({ upstream: up(wakeMs), modelId: "fake-a", format: "anthropic", body: { model: "claude/fake-a", max_tokens: 100, messages: [{ role: "user", content: text }] }, conversationId: `sub-${wakeMs}-${heldMs}-${text.length}`, tasksHeldMs: heldMs, signal, onEvent });
  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-bg-tasks-"));
    // A task's end said as its status is owed its notification a second here, not ten.
    bridge = new AcpBridge(/** @type {any} */ ({ log: () => {}, stateFile: join(root, "acp-sessions.json"), taskNoticeMs: 1000 }));
  });
  after(async () => {
    bridge.shutdown();
    await removeDirs(root);
  });

  // (fails before: yes — nothing held a sub-agent's turn for its agent's own tasks: it ended with its answer)
  test("one that never ends in time: the turn waits its bound, then ends, and the record names what runs on", async () => {
    const since = Date.now();
    const r = await turn(60_000, 400);
    assert.ok(Date.now() - since >= 400, "held for its bound");
    assert.equal(r.stopReason, "end_turn");
    assert.match(r.notes.join("\n"), /^acp: the sub-agent's turn waited (?:\d+ s|under a second) for Claude's own background task “npm test” and ends without it: it runs on in Claude's session, its end no one's to read$/m, r.notes.join("\n"));
  });

  // (fails before: yes — as above)
  test("a stop while it waits ends the turn at once, as stopped", async () => {
    const stop = new AbortController();
    const since = Date.now();
    /** @type {string[]} */
    const waited = [];
    // Stopped once the turn says it waits: the stop lands in the wait.
    const r = await turn(60_000, 30_000, { signal: stop.signal, onEvent: (ev) => ev.type === "waiting" && (waited.push(ev.why), stop.abort()) });
    assert.deepEqual(waited, ["waiting for its own background task “npm test” to end"]);
    assert.ok(Date.now() - since < 10_000, "not held for its bound");
    assert.equal(r.stopReason, "cancelled");
  });

  // (fails before: yes — the review of fb87c0c10: the task's end came as its status first, which ended the wait at once,
  // and Claude's answer to its notification, 50 ms on, was no one's)
  test("a task whose end comes as its status before its notification is waited on for it: Claude's answer is the turn's", async () => {
    /** @type {string[]} */
    const said = [];
    const r = await turn(100, 10_000, { text: "Run the tests. ~wake-monitorlate", onEvent: (ev) => ev.type === "text" && said.push(String(ev.text)) });
    assert.equal(r.stopReason, "end_turn");
    assert.match(said.join(""), /The tests pass\./, said.join(""));
    assert.match(r.notes.join("\n"), /^acp: Claude left a background task of its own running as it answered \(“npm test”\): the sub-agent's turn waited (?:\d+ s|under a second) for it, and read Claude's answer to its end$/m, r.notes.join("\n"));
  });

  // (fails before: yes — the review of D3's follow-up: the record said Claude's answer to its end was read)
  test("a task whose status says it ended and whose end never comes is waited on a while: the record says no end came", async () => {
    const since = Date.now();
    const r = await turn(100, 30_000, { text: "Run the tests. ~wake-monitornoend" });
    assert.ok(Date.now() - since < 10_000, "not held for its bound");
    assert.equal(r.stopReason, "end_turn");
    assert.match(r.notes.join("\n"), /^acp: Claude left a background task of its own running as it answered \(“npm test”\): the sub-agent's turn waited (?:\d+ s|under a second) for it, and its status said it ended, but no end came for Claude to answer$/m, r.notes.join("\n"));
  });

  test("a turn that is no sub-agent's ends with its answer, the task running on: its chat shows Claude's own cycle", async () => {
    const since = Date.now();
    const r = await turn(60_000, 0);
    assert.ok(Date.now() - since < 10_000);
    assert.equal(r.stopReason, "end_turn");
    assert.doesNotMatch(r.notes.join("\n"), /background task/);
  });
});

describe("through the app", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let folder;
  /** @type {string} */ let logs;
  /** Where `gated` waits for the word to end its task (FAKE_ACP_WAKE_GATE). @type {string} */ let gate;
  /** A JSONL file's lines, parsed. @param {string} file */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const prompts = () => lines(join(logs, "prompts.jsonl"));
  const runEvents = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  const subagentsOf = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents;
  /** @param {string} url @param {string} method */
  const mcp = async (url, method) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }) })).json()).result;

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-bg-sub-"));
    logs = mkdtempSync(join(tmpdir(), "filament-bg-sub-logs-"));
    gate = mkdtempSync(join(tmpdir(), "filament-bg-sub-gate-"));
    up = await fakeUpstream(async (call) => anthropicReply("", { model: String(call.body?.model || ""), stop: "end_turn", blocks: [{ type: "text", text: "MODEL ANSWER" }], usage: { input_tokens: 5, output_tokens: 3 } }));
    shim = await startApp({
      memory: true,
      configure: (cfg, { dataDir }) => {
        // `cli` as Claude's adapter is (FAKE_ACP_CLAUDE): its sub-agents run on it.
        const CLI = { id: "cli", name: "cli", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } };
        // `gated`: so, Claude's task ending once the test says (`~wake-monitorlate`).
        const GATED = { ...CLI, id: "gated", name: "gated", acp: { ...CLI.acp, env: { ...CLI.acp.env, FAKE_ACP_WAKE_GATE: gate } } };
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }, CLI, GATED];
        cfg.routes = [
          { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
          { match: "gated-*", upstream: "gated", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(folder, logs, gate);
  });

  // (fails before: yes — the sub-agent's call was refused, "no turn of a chat for a command's end to reach", and its run
  // ended and reported at once)
  test("a sub-agent on Claude Code starts a command with background_command: its run stays open while it runs, the end comes as its next prompt, and its report after", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const command = node("setTimeout(()=>{console.log('BUILD DONE');process.exit(0)},3000)");
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: `Build it. ~mcpcall ${BACKGROUND_COMMAND} ${JSON.stringify({ command, description: "the build" })}`, description: "Build", model: "coder-1", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const first = await until(() => prompts().find((p) => String(p.text).includes(`~mcpcall ${BACKGROUND_COMMAND}`)) || null, "the sub-agent's first prompt");
    // Its session lists the tool, loaded whole, while its run is open.
    const listed = (await mcp(first.mcpUrl, "tools/list"))?.tools || [];
    assert.deepEqual(listed.filter((/** @type {any} */ t) => t.name === BACKGROUND_COMMAND).map((/** @type {any} */ t) => t._meta), [{ "anthropic/alwaysLoad": true }], listed.map((/** @type {any} */ t) => t.name).join(", "));
    assert.match((await mcp(first.mcpUrl, "initialize"))?.instructions || "", /Its `background_command` runs any command that can take more than a minute/);
    const sa = await until(async () => (await subagentsOf(id)).find((/** @type {any} */ s) => s.status !== "running") || null, "the sub-agent to report", { timeoutMs: 30_000 });
    const mine = prompts().filter((p) => p.sessionId === first.sessionId);
    assert.equal(mine.length, 2, `its prompt, then its command's end: ${mine.map((p) => p.text).join("\n---\n")}`);
    const bg = String(/bg_[0-9a-z]+/.exec(String(mine[1].text))?.[0] || "");
    assert.match(String(mine[1].text), new RegExp(`\\[Filament: your background command ${bg} ended — \`node -e .+\` exited with code 0 after \\d+ s\\.\\]\\nIts output:\\nBUILD DONE`), mine[1].text);
    assert.equal(sa.status, "done", JSON.stringify(sa));
    assert.match(String(sa.exchanges[0].report), /echo\(2\)[\s\S]*BUILD DONE/, "its report is its answer to the end, which came first");
    const events = await runEvents(String(sa.exchanges[0].runId));
    assert.deepEqual(events.filter((e) => e.type === "shell-exit").map((e) => e.shells.map((/** @type {any} */ s) => [s.id, s.code])), [[[bg, 0]]], "the end said on its run, as the shells' row");
    const waited = events.find((e) => e.type === "turn-state" && e.to === "waiting");
    assert.match(String(waited?.why), /^waiting for its background command “node -e .+” to end$/, "what its run waits for, by its command");
  });

  // (fails before: yes — the sub-agent reported "I will say when they end." while Claude's Monitor still ran, and Claude's
  // answer to its end, a cycle of its own after the turn, was no one's: no chat shows a sub-agent's session)
  test("a sub-agent on Claude Code that leaves its own Monitor running past its answer: its run waits for the task's end and reports Claude's answer to it", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "Run the tests. ~wake-monitor", description: "Tests", model: "coder-1", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const sa = await until(async () => (await subagentsOf(id)).find((/** @type {any} */ s) => s.status !== "running") || null, "the sub-agent to report", { timeoutMs: 30_000 });
    assert.equal(sa.status, "done", JSON.stringify(sa));
    assert.match(String(sa.exchanges[0].report), /The tests pass\./, `its report is Claude's answer to the task's end: ${sa.exchanges[0].report}`);
    const events = await runEvents(String(sa.exchanges[0].runId));
    const waited = events.find((e) => e.type === "turn-state" && e.to === "waiting");
    assert.equal(String(waited?.why), "waiting for its own background task “npm test” to end", "what its run waits for, by Claude's task");
  });

  // (fails before: yes — the review of fb87c0c10: what the developer typed waited for the agent's next call (C34), and an
  // agent idle on its own task makes none before its end)
  test("a note typed while such a sub-agent waits for its agent's own task reaches the agent at once, the task still running", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "Run the tests. ~wake-monitorlate", description: "Tests", model: "gated-1", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const runId = String(await until(async () => (await subagentsOf(id))[0]?.exchanges?.[0]?.runId || null, "the sub-agent's run"));
    await until(async () => (await runEvents(runId)).some((/** @type {any} */ e) => e.type === "turn-state" && e.to === "waiting") || null, "its wait for Claude's task", { timeoutMs: 15_000 });
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text: "and check the docs", from: "harness" } });
    assert.equal(r.status, 200, await r.clone().text());
    try {
      await until(() => prompts().find((p) => String(p.text).includes("and check the docs")) || null, "the note at the agent", { timeoutMs: 10_000 });
      assert.equal((await subagentsOf(id))[0].status, "running", "its task still runs");
    } finally {
      writeFileSync(join(gate, "t1"), "");
    }
    const sa = await until(async () => (await subagentsOf(id)).find((/** @type {any} */ s) => s.status !== "running") || null, "the sub-agent to report", { timeoutMs: 30_000 });
    assert.equal(sa.status, "done", JSON.stringify(sa));
    assert.match(String(sa.exchanges[0].report), /The tests pass\./, `its report: ${sa.exchanges[0].report}`);
  });
});
