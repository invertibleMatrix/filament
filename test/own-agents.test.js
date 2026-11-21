// @ts-check
// A coding agent's own sub-agent tool, off in the processes Filament starts for it where the agent takes that switch only
// as it starts (the owner's of 11-10: "have other agents stop from spawning their sub agents"): Qoder by its
// `--disallowed-tools`, in a process of its own for the turns that hand it Filament's agent tool.
import "./helpers/clean-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AcpBridge } from "../src/acp.js";
import { ownAgentsOff, ownOffAtStart } from "../src/adapters/agents/acp/own-agents.js";
import { removeDirs } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
const lines = (/** @type {string} */ f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * The fake agent under a program's name in `dir`, by its path: a bare name would find the person's own agent first, in
 * npm's folder (agent-process.js `npmShim`).
 * @param {string} dir @returns {(name: string) => string}
 */
const fakeIn = (dir) => {
  const win = process.platform === "win32";
  if (win) {
    copyFileSync(FAKE, join(dir, "fake-acp-agent.mjs"));
    copyFileSync(join(dirname(FAKE), "person-words.mjs"), join(dir, "person-words.mjs"));
  }
  return (name) => {
    if (win) writeFileSync(join(dir, `${name}.cmd`), `@"%~dp0\\node.exe" "%dp0%\\fake-acp-agent.mjs" %*\r\n`);
    else {
      writeFileSync(join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
      chmodSync(join(dir, name), 0o755);
    }
    return win ? join(dir, `${name}.cmd`) : join(dir, name);
  };
};

// (fails before: yes — no module said how an agent's own sub-agents go off)
test("the switch for each agent: Qoder's tools by name, none for the rest", () => {
  const qoder = ownAgentsOff({ id: "qoder", type: "acp", acp: { command: "qodercli", args: ["--acp"] } });
  assert.deepEqual([qoder.held, qoder.args, qoder.env], [true, ["--disallowed-tools", "Agent", "--disallowed-tools", "Workflow"], {}]);
  assert.match(qoder.words, /Qoder's own sub-agent tools \(Agent, Workflow\) are off in this process/);
  assert.equal(ownAgentsOff({ id: "q-cn", type: "acp", acp: { command: "C:\\npm\\qodercli.cmd", env: { QODERCLI_SITE: "cn" } } }).held, true, "Qoder CN, its command by its path");
  const others = [
    { id: "claude-code", type: "acp", acp: { command: "claude-agent-acp" } },
    { id: "cursor", type: "acp", acp: { command: "agent", args: ["acp"] } },
    { id: "cx", type: "codex", acp: { command: "codex" } },
    { id: "antigravity-acp", type: "acp", acp: { command: "C:\\data\\agents\\installed\\antigravity-acp\\1.4.5\\agy_acp_server.exe" } },
    { id: "gemini", type: "acp", acp: { command: "gemini", args: ["--acp"] } },
  ];
  for (const u of others) {
    assert.deepEqual(ownAgentsOff(u), { held: false, args: [], env: {}, words: "" }, `${u.id}: no switch at its start`);
    assert.equal(ownOffAtStart(u), false);
  }
});

// (fails before: yes — Qoder started with its own sub-agents on, beside Filament's agent tool; then, the second read of
// 11-10, without them in every process, a chat with no agent tool of Filament's too)
test("Qoder starts without its own sub-agents where a turn hands it Filament's, and the turn's record says so", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-own-agents-"));
  const argv = join(dir, "argv.jsonl");
  const shim = fakeIn(dir);
  const env = { FAKE_ACP_ARGV: argv };
  const up = (/** @type {string} */ id, /** @type {string} */ command) => ({ id, name: id, type: "acp", acp: { command: shim(command), args: ["--acp"], env, modelSelection: "none", cwdDefault: dir, permissions: "allow-all" } });
  const bridge = new AcpBridge({ log: () => {}, stateFile: join(dir, "acp-sessions.json") });
  try {
    const turn = (/** @type {any} */ u, launch = true) => bridge.run({ upstream: u, modelId: "auto", format: "anthropic", body: { model: "m", max_tokens: 50, messages: [{ role: "user", content: "hi" }] }, conversationId: u.id, onEvent: () => {}, ...(launch ? { toolsAt: { launch: "agent" } } : {}) });
    // A chat that hands it no agent tool of Filament's: Qoder keeps its own, said nowhere.
    const plain = await turn(up("qoder", "qodercli"), false);
    assert.equal(plain.stopReason, "end_turn");
    assert.deepEqual(lines(argv).at(-1), ["--acp"]);
    assert.equal(plain.notes.some((/** @type {string} */ n) => n.includes("own sub-agent")), false);
    const q = await turn(up("qoder", "qodercli"));
    assert.equal(q.stopReason, "end_turn");
    assert.deepEqual(lines(argv).at(-1), ["--acp", "--disallowed-tools", "Agent", "--disallowed-tools", "Workflow"], "its own process, started without them");
    assert.ok(q.notes.some((/** @type {string} */ n) => /^acp: Qoder's own sub-agent tools \(Agent, Workflow\) are off in this process/.test(n)), q.notes.join("\n"));
    // Said once a process: its next turn says nothing of it.
    const again = await turn(up("qoder", "qodercli"));
    assert.equal(again.notes.some((/** @type {string} */ n) => n.includes("own sub-agent")), false);
    // Anyone else starts as before.
    const other = await turn(up("argv", "argv-agent"));
    assert.equal(other.stopReason, "end_turn");
    assert.deepEqual(lines(argv).at(-1), ["--acp"]);
  } finally {
    bridge.shutdown();
    await removeDirs(dir);
  }
});

// (fails before: yes — the bug hunt of r-map: a chat at rest holds no process, and its token had gone from the pending
// ones, so the words Filament's agent tool gave its agent said its own sub-agent tool stood beside it, while the
// process its session opens in again starts without it)
test("a chat at rest: Filament's words still say Qoder's own sub-agents are off, as the process it opens in again starts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-own-rest-"));
  const u = { id: "qoder", name: "qoder", type: "acp", acp: { command: fakeIn(dir)("qodercli"), args: ["--acp"], env: { FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_SESSION_CAPS: "close", FAKE_ACP_ALLOW_LOAD: "1" }, modelSelection: "none", cwdDefault: dir, permissions: "allow-all" } };
  const bridge = new AcpBridge({ log: () => {}, stateFile: join(dir, "acp-sessions.json") });
  const at = { upstream: u, format: "anthropic", conversationId: "qoder", body: { model: "m", max_tokens: 50, messages: [{ role: "user", content: "hi" }] } };
  try {
    const q = await bridge.run({ ...at, modelId: "auto", onEvent: () => {}, mcpBase: "http://127.0.0.1:9", toolsAt: { launch: "agent" } });
    assert.equal(q.stopReason, "end_turn");
    const conv = /** @type {any} */ ([...bridge.convs.values()].find((c) => c.upstreamId === "qoder"));
    assert.ok(conv?.mcpToken, "Filament's server offered");
    assert.equal(bridge.contextForMcpToken(conv.mcpToken)?.held, true, "while its process holds the session");
    await bridge.restByRequest(at);
    assert.equal(conv.procKey, null, "at rest");
    assert.equal(bridge.contextForMcpToken(conv.mcpToken)?.held, true, "at rest, as its next process starts");
  } finally {
    bridge.shutdown();
    await removeDirs(dir);
  }
});
