// @ts-check
// The re-read of 11-11 of Cursor through its SDK under the chat's permission switch. The SDK runs inside Filament's
// process and approves Cursor's own tools itself, so what the switch can judge is only what Filament's hands do:
// - the tool lists hold the SDK's own names (1.0.31 knows no `write`: every strict turn failed as its agent opened);
// - a chat stricter than Auto keeps Cursor to the tools that read and plan, with no sub-agents of its own and none of
//   the person's MCP servers, whose calls nothing could judge;
// - every turn with a switch runs on Filament's hands, so a switch moved mid-turn is the one that judges the next call,
//   and a run that goes on past its turn has nothing done for it;
// - Filament's Bash runs a line in the shell that read it.
import "./helpers/clean-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { removeDirs, until } from "./helpers/wait.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = pathToFileURL(join(HERE, "fixtures", "fake-cursor-sdk.mjs")).href;
const top = mkdtempSync(join(tmpdir(), "filament-sdk-strict-"));
const log = join(top, "sdk.jsonl");
/** @returns {any[]} */
const lines = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

before(() => {
  process.env.FAKE_SDK_LOG = log;
});
after(async () => {
  delete process.env.FAKE_SDK_LOG;
  delete process.env.FAKE_SDK_LATE;
  delete process.env.FAKE_SDK_NO_TOOLS;
  await removeDirs(top);
});

/** Cursor's own tools a chat stricter than Auto keeps: the ones that read and plan, and the MCP family Filament's ride in. */
const KEPT = ["grep", "glob", "ls", "semSearch", "readLints", "webSearch", "webFetch", "updateTodos", "readTodos", "createPlan", "askQuestion", "mcp"];
const HANDS = ["shell", "read", "edit", "delete"];

/**
 * A chat on Cursor's SDK with a permission switch (`mode`, moved by `set`), in a folder of its own.
 * @param {string} name @param {{ acp?: any, stateFile?: string, dir?: string }} [o]
 */
const chatOn = (name, { acp = {}, stateFile = undefined, dir = mkdtempSync(join(top, `${name}-`)) } = {}) => {
  const bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: () => import(FAKE), ...(stateFile ? { stateFile } : {}) }));
  const upstream = { id: name, name, type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, clientBridge: "prompts", hints: false, ...acp } };
  /** @type {import("../src/app/agent/prompt.js").PermissionMode} */
  let mode = "read-only";
  /** @param {string} text @param {string} conv @param {any} [more] */
  const run = (text, conv, more = {}) =>
    bridge.run({
      upstream,
      modelId: "grok-4.6",
      format: "anthropic",
      body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] },
      conversationId: conv,
      onEvent: () => {},
      permits: createAgentPermits({ rules: [], modeNow: () => mode, learned: null }),
      ...more,
    });
  /** What the agent of a turn was last opened with, and its newest message. @param {string} agentId */
  const opened = (agentId) => lines().filter((e) => (e.event === "create" || e.event === "resume") && e.agentId === agentId).at(-1);
  return { bridge, upstream, dir, run, opened, set: (/** @type {typeof mode} */ m) => void (mode = m) };
};

// (fails before: yes — `disallowedTools` named `write`, which @cursor/sdk 1.0.31 does not know: Agent.create threw
// "Unknown tool name(s) in `disallowedTools`: write", and so did Agent.resume, which dropped the chat's agent first)
test("a chat stricter than Auto opens its agent on names the SDK takes, and comes back to the same agent after a restart", async () => {
  const stateFile = join(top, "restart.json");
  const dir = mkdtempSync(join(top, "restart-"));
  const first = chatOn("strict-open", { stateFile, dir });
  /** @type {string} */
  let agentId;
  try {
    for (const mode of /** @type {const} */ (["read-only", "edit", "ask"])) {
      first.set(mode);
      const r = await first.run("hello", `open-${mode}`);
      assert.match(r.text, /^echo\(1\): hello/, `${mode}: the turn ran`);
      assert.deepEqual(first.opened(r.sessionId)?.disallowedTools, [...HANDS, "task"], `${mode}: Cursor's own hands and sub-agents off, by the SDK's names`);
    }
    first.set("read-only");
    agentId = (await first.run("one", "kept")).sessionId;
  } finally {
    first.bridge.shutdown();
  }
  // Filament restarted: the chat's agent is resumed by its id, with the same lists.
  const second = chatOn("strict-open", { stateFile, dir });
  try {
    second.set("read-only");
    const r = await second.run("two", "kept");
    assert.equal(r.sessionId, agentId, r.notes.join("\n"));
    assert.match(r.text, /^echo\(2\): two/);
    assert.ok(!r.notes.some((/** @type {string} */ n) => n.includes("could not resume")), r.notes.join("\n"));
    const resumed = lines().filter((e) => e.event === "resume" && e.agentId === agentId).at(-1);
    assert.deepEqual([resumed?.disallowedTools, resumed?.tools], [[...HANDS, "task"], KEPT]);
  } finally {
    second.bridge.shutdown();
  }
});

// (fails before: yes — nothing read the SDK's refusal: the turn failed with it)
test("a name the loaded SDK does not know is left out, said on the turn's record, and the agent is opened once more", async () => {
  process.env.FAKE_SDK_NO_TOOLS = "semSearch,delete";
  const c = chatOn("other-sdk");
  try {
    c.set("read-only");
    const before = lines().filter((e) => e.event === "refused").length;
    const r = await c.run("hello", "one");
    assert.match(r.text, /^echo\(1\): hello/);
    const o = c.opened(r.sessionId);
    assert.deepEqual([o.tools, o.disallowedTools], [KEPT.filter((n) => n !== "semSearch"), ["shell", "read", "edit", "task"]]);
    assert.equal(lines().filter((e) => e.event === "refused").length - before, 1, "one refusal, then the open that held");
    assert.ok(
      r.notes.includes("sdk: this @cursor/sdk (fake-1.0) knows no tool named semSearch, delete: Cursor is neither given nor kept from a tool by a name it does not know, and the agent was opened once more without them"),
      r.notes.join("\n"),
    );
    // The next chat's agent opens at once: what the SDK said holds for as long as it is loaded.
    const next = await c.run("hello", "two");
    assert.match(next.text, /^echo\(1\): hello/);
    assert.equal(lines().filter((e) => e.event === "refused").length - before, 1, "no second refusal");
    assert.ok(next.notes.includes("sdk: this @cursor/sdk (fake-1.0) knows no tool named semSearch, delete: Cursor is neither given nor kept from a tool by a name it does not know"), next.notes.join("\n"));
  } finally {
    delete process.env.FAKE_SDK_NO_TOOLS;
    c.bridge.shutdown();
  }
});

// (fails before: yes — `task` was off only where Filament's agent tool stood in, the person's MCP servers went to the
// agent whatever the switch said, and a list of what is off left on every tool it did not name: generateImage,
// applyAgentDiff, whatever the SDK adds)
test("a chat stricter than Auto keeps Cursor to its tools that read and plan, no sub-agents of its own, none of the person's MCP servers; Auto gives them", async () => {
  const servers = { acp: { mcpServers: [{ name: "notes", command: process.execPath, args: ["notes.js"] }] } };
  const board = [{ name: "board", url: "http://127.0.0.1:9/mcp" }];
  const c = chatOn("strict-tools", servers);
  try {
    for (const mode of /** @type {const} */ (["read-only", "edit", "ask"])) {
      c.set(mode);
      const r = await c.run("hello", `tools-${mode}`, { toolsAt: { mcp: board } });
      const o = c.opened(r.sessionId);
      assert.deepEqual(o.tools, KEPT, `${mode}: only what reads and plans, and the MCP family Filament's own tools ride in`);
      assert.deepEqual(o.disallowedTools, [...HANDS, "task"], `${mode}: its sub-agents keep tools of their own, so it starts none`);
      assert.equal(o.mcpServers, undefined, `${mode}: none of the person's MCP servers`);
      assert.ok(
        r.notes.includes(`sdk: the MCP servers notes, board are not given to Cursor while the chat's permission is ${mode}: its SDK calls a server's tools unasked, and nothing of theirs could be judged. In Auto it is given them`),
        r.notes.join("\n"),
      );
      assert.ok(
        r.notes.includes(`sdk: the chat's permission is ${mode}: of its own tools Cursor keeps the ones that read and plan (${KEPT.filter((n) => n !== "mcp").join(", ")}); its sub-agents (task), which keep tools of their own, and every other are off`),
        r.notes.join("\n"),
      );
      assert.ok(!r.notes.some((/** @type {string} */ n) => /MCP servers? given to Cursor/.test(n)), r.notes.join("\n"));
      // Filament's hands reach it all the same: they ride in the MCP family.
      const sent = lines().filter((e) => e.event === "send" && e.agentId === r.sessionId).at(-1);
      assert.deepEqual(sent.customTools.slice(0, 5), ["Read", "Write", "Edit", "Bash", "Delete"]);
    }
    c.set("auto");
    const auto = await c.run("hello", "tools-auto", { toolsAt: { mcp: board } });
    const o = c.opened(auto.sessionId);
    assert.deepEqual([o.tools, o.disallowedTools, o.mcpServers], [null, HANDS, ["notes", "board"]], "Auto: its sub-agents, its other tools and the person's servers");
    assert.ok(auto.notes.includes("mcp: the chat's MCP server given to Cursor: board (http)"), auto.notes.join("\n"));
    // The switch moved between two turns of one chat: the agent is opened again with what the new mode takes.
    c.set("read-only");
    const strict = await c.run("again", "tools-auto", { toolsAt: { mcp: board } });
    assert.equal(strict.sessionId, auto.sessionId);
    assert.deepEqual([c.opened(strict.sessionId).event, c.opened(strict.sessionId).tools, c.opened(strict.sessionId).mcpServers], ["resume", KEPT, undefined]);
  } finally {
    c.bridge.shutdown();
  }
});

// (fails before: yes — the switch was read as the turn began: under Auto the agent kept Cursor's own shell and edit,
// which no switch moved since could judge, and was given none of Filament's hands)
test("a turn with a switch runs on Filament's hands whatever the switch says as it begins: moved to Read only mid-turn, it refuses the next write", async () => {
  const c = chatOn("mid-turn");
  const go = join(c.dir, "go");
  process.env.FAKE_SDK_LATE = go;
  /** @type {Promise<any> | null} */
  let turn = null;
  try {
    c.set("auto");
    let sent = false;
    turn = c.run("~late then say so", "switch", { onEvent: (/** @type {any} */ ev) => void (ev.type === "step" && ev.step === "sent" && (sent = true)) });
    await until(() => sent, "the message to go out");
    const agentId = lines().filter((e) => e.event === "send").at(-1).agentId;
    assert.deepEqual([c.opened(agentId).disallowedTools, c.opened(agentId).tools], [HANDS, null], "Cursor's own shell, read, edit and delete off under Auto too");
    assert.deepEqual(lines().filter((e) => e.event === "send").at(-1).customTools.slice(0, 5), ["Read", "Write", "Edit", "Bash", "Delete"]);
    // The person moves the switch while the agent works; its next write is judged by the switch as it stands now.
    c.set("read-only");
    writeFileSync(go, "");
    const r = await turn;
    const late = lines().find((e) => e.event === "late" && e.agentId === agentId);
    assert.match(late.result, /^Error: refused: .*read-only/i, late.result);
    assert.equal(existsSync(join(c.dir, "late.txt")), false, "nothing written");
    assert.ok(
      r.notes.includes("sdk: Cursor's own shell, read, edit and delete are off in a chat with a permission switch: Filament's hands do that work, each call judged by the switch as it stands then (auto as the turn began)"),
      r.notes.join("\n"),
    );
  } finally {
    // The run is let through whatever was found, so none is left waiting.
    writeFileSync(go, "");
    await turn?.catch(() => {});
    delete process.env.FAKE_SDK_LATE;
    c.bridge.shutdown();
  }
});

// (fails before: yes — a call that came once its turn had ended went by the upstream's policy, allow-all by default:
// in a Read-only chat, a run its stop could not cancel wrote the file)
test("a run that goes on past its turn has nothing judged for it: Filament's hands do nothing, and say why", async () => {
  const c = chatOn("past-turn");
  const go = join(c.dir, "go");
  process.env.FAKE_SDK_LATE = go;
  const stop = new AbortController();
  try {
    c.set("read-only");
    let sent = false;
    const turn = c.run("~nocancel ~late", "late", { signal: stop.signal, onEvent: (/** @type {any} */ ev) => void (ev.type === "step" && ev.step === "sent" && (sent = true)) });
    await until(() => sent, "the message to go out");
    stop.abort();
    const out = await turn;
    assert.equal(out.stopReason, "cancelled", "the turn ended at its stop; the run takes no cancel and goes on");
    writeFileSync(go, "");
    await until(() => lines().some((e) => e.event === "late" && e.agentId === out.sessionId), "the run's late write");
    const late = lines().find((e) => e.event === "late" && e.agentId === out.sessionId);
    assert.equal(late.result, `Error: refused: no turn of the harness chat runs to judge it, so Filament did not edit ${join(c.dir, "late.txt")}`);
    assert.equal(existsSync(join(c.dir, "late.txt")), false, "nothing written");
  } finally {
    delete process.env.FAKE_SDK_LATE;
    c.bridge.shutdown();
  }
});

// (fails before: yes on Windows — the line was read as bash's and run by cmd.exe, to which a single quote is no quote:
// `cat 'a.txt&echo INJECTED>made.txt'` read as one file to print, and wrote a file)
test("a command the chat's switch read as only reading does only that: Filament's Bash runs it in the shell that read it", async () => {
  const c = chatOn("bash-shell");
  try {
    c.set("read-only");
    writeFileSync(join(c.dir, "a.txt"), "hello\n");
    const r = await c.run("~bash:cat 'a.txt&echo INJECTED>made.txt'~ then say so", "bash");
    const said = lines().find((e) => e.event === "bash" && e.agentId === r.sessionId);
    assert.ok(said, "the command was answered");
    assert.deepEqual(readdirSync(c.dir).sort(), ["a.txt"], `the folder as it was: ${said.result}`);
    // Read only ran it unasked where the switch's reader reads the shell (a bash): it prints one file, of that name or none.
    if (SHELL.kind !== "cmd") assert.match(said.result, /No such file or directory/, said.result);
  } finally {
    c.bridge.shutdown();
  }
});
