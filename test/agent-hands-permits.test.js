// @ts-check
// Who judges what Filament's hands do for a coding agent, through its MCP server or its requests to the client. The bug
// report's P1: the turn the call is for, the one the session's own requests find; a harness chat's call with no turn of
// it running is refused, as nothing stands for the person's switch and the upstream's policy is not theirs (the ACP
// bridge's side, with a fake agent: test/acp-own-turns.test.js). P2: under "ask" with nobody to ask, what is allowed
// once is said, as the agent's own requests are.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TurnBridge } from "../src/adapters/agents/turn-bridge.js";
import { McpToolServer } from "../src/http/mcp.js";
import { removeDirs } from "./helpers/wait.js";

const dir = mkdtempSync(join(tmpdir(), "filament-hands-permits-"));
after(() => removeDirs(dir));
const upstream = { id: "agent", name: "Agent", acp: { permissions: "allow-all" } };

/** A call to one of Filament's tools, as the agent sends it; its JSON-RPC answer. @param {McpToolServer} srv @param {string} name @param {any} args */
async function mcpCall(srv, name, args) {
  /** @type {any} */
  let out = null;
  const res = /** @type {any} */ ({ writeHead() {}, end: (/** @type {string} */ s) => (out = JSON.parse(s)) });
  await srv.handle(/** @type {any} */ ({ method: "POST" }), res, "tok", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return out;
}

// (fails before: yes — nothing told a harness chat's call apart: the upstream's allow-all let it through)
test("a harness chat's call with no turn of it running is refused, saying what Filament did not do; another's goes by the upstream's policy", async () => {
  const tb = new TurnBridge();
  for (const turn of [null, undefined, { done: true }])
    await assert.rejects(tb.permitLocal(/** @type {any} */ (turn), upstream, "execute", "npm test", { chat: true }), {
      code: -32000,
      message: "refused: no turn of the harness chat runs to judge it, so Filament did not run `npm test`",
    });
  await tb.permitLocal(null, upstream, "execute", "npm test");
  await tb.permitLocal(/** @type {any} */ ({ done: true }), upstream, "edit", join(dir, "x.txt"), { chat: false });
});

// (fails before: yes — the call took the session's newest turn, ended, at once: the upstream's policy judged it, and
// no turn showed it)
test("an MCP call waits for the turn its session settles on: that turn judges it, serves it and shows it", async () => {
  /** @type {any[]} */
  const order = [];
  /** @type {((v: any) => void)[]} */
  const waiting = [];
  const emit = () => {};
  const live = { done: false, emit, clientTools: { has: () => false } };
  const base = { cwd: dir, upstream, native: true, chat: true };
  const bridge = {
    askClient: async () => {
      throw new Error("no client here");
    },
    permitLocal: async (/** @type {any} */ turn, /** @type {any} */ _u, /** @type {string} */ kind, /** @type {string} */ title, /** @type {any} */ o) => {
      order.push([turn === live, kind, title, o]);
    },
    contextForMcpToken: () => ({ ...base, turn: { done: true }, turnId: null, emit: null, settled: () => new Promise((r) => waiting.push(r)) }),
  };
  const hands = {
    runTerminal: (/** @type {any} */ _a, /** @type {any} */ term) => {
      term.output = "hi";
      term.exit = { exitCode: 0 };
      return Promise.resolve();
    },
    kill: () => {},
  };
  /** @type {any} */
  let toolCtx = null;
  const tools = { has: (/** @type {string} */ n) => n === "memory_note", list: () => [], call: async (/** @type {string} */ _n, /** @type {any} */ _a, /** @type {any} */ c) => ((toolCtx = c), { text: "noted" }) };
  const srv = new McpToolServer({ bridge, hands, tools: /** @type {any} */ (tools) });
  const ran = mcpCall(srv, "Bash", { command: "echo hi" });
  const noted = mcpCall(srv, "memory_note", { text: "x" });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(order, [], "nothing judged before the turn is known");
  assert.equal(waiting.length, 2, "both calls wait");
  for (const w of waiting) w({ ...base, turn: live, turnId: "t-own", emit });
  assert.match((await ran).result.content[0].text, /hi/);
  assert.equal((await noted).result.content[0].text, "noted");
  assert.deepEqual(order, [[true, "execute", "echo hi", { chat: true }]], "the turn judged the command, and only it");
  assert.deepEqual([toolCtx.turn, toolCtx.emit === emit], ["t-own", true], "Filament's own tools stand in the turn the call is for");
});

// (fails before: yes — the upstream's allow-all had Filament's hands write, edit and run for the agent)
test("a harness chat's MCP call with no turn to judge it: the agent is told, and Filament's hands do nothing", async () => {
  const file = join(dir, "kept.txt");
  writeFileSync(file, "as it was\n");
  const ctx = { turn: null, cwd: dir, upstream, native: true, chat: true };
  const bridge = Object.assign(new TurnBridge(), { contextForMcpToken: () => ({ ...ctx, settled: async () => ctx }) });
  /** @type {string[][]} */
  const done = [];
  const hands = {
    readTextFile: async (/** @type {any} */ a) => (done.push(["read", a.path]), { content: readFileSync(a.path, "utf8") }),
    writeTextFile: async (/** @type {any} */ a) => (done.push(["write", a.path]), writeFileSync(a.path, a.content), null),
    runTerminal: async (/** @type {any} */ a, /** @type {any} */ term) => {
      done.push(["run", a.command]);
      term.exit = { exitCode: 0 };
    },
    kill: () => {},
  };
  const srv = new McpToolServer({ bridge, hands });
  for (const [name, args, what] of /** @type {[string, any, string][]} */ ([
    ["Write", { file_path: file, content: "replaced\n" }, `edit ${file}`],
    ["Edit", { file_path: file, old_string: "as it was", new_string: "changed" }, `edit ${file}`],
    ["Bash", { command: "npm test" }, "run `npm test`"],
  ]))
    assert.deepEqual((await mcpCall(srv, name, args)).result, { content: [{ type: "text", text: `Error: refused: no turn of the harness chat runs to judge it, so Filament did not ${what}` }], isError: true }, name);
  assert.deepEqual([done, readFileSync(file, "utf8")], [[], "as it was\n"]);
  ctx.chat = false;
  assert.equal((await mcpCall(srv, "Write", { file_path: file, content: "replaced\n" })).result.content[0].text, `Wrote ${file}`, "a session of no harness chat goes by the upstream's policy");
});

// (fails before: yes — the bug hunt of 10-30, AGT-5: Read on Filament's hands read for the agent under any policy, and
// for a harness chat with no turn to judge it, while its Write, Edit and Bash were judged)
test("Read on Filament's hands is judged as Write is: refused for a harness chat with no turn running and under reject, read under allow-all", async () => {
  const file = join(dir, "notes.txt");
  writeFileSync(file, "a note\n");
  /** @type {{ turn: any, cwd: string, upstream: any, native: boolean, chat: boolean }} */
  const ctx = { turn: null, cwd: dir, upstream, native: true, chat: true };
  const bridge = Object.assign(new TurnBridge(), { contextForMcpToken: () => ({ ...ctx, settled: async () => ctx }) });
  /** @type {string[]} */
  const read = [];
  const hands = { readTextFile: async (/** @type {any} */ a) => (read.push(a.path), { content: readFileSync(a.path, "utf8") }) };
  const srv = new McpToolServer({ bridge, hands });
  assert.deepEqual((await mcpCall(srv, "Read", { file_path: file })).result, { content: [{ type: "text", text: `Error: refused: no turn of the harness chat runs to judge it, so Filament did not read ${file}` }], isError: true });
  ctx.chat = false;
  ctx.upstream = { ...upstream, acp: { permissions: "reject" } };
  assert.deepEqual((await mcpCall(srv, "Read", { file_path: file })).result, { content: [{ type: "text", text: "Error: refused by Filament's permission policy (reject)" }], isError: true });
  assert.deepEqual(read, [], "Filament's hands read nothing");
  ctx.upstream = upstream;
  assert.match((await mcpCall(srv, "Read", { file_path: file })).result.content[0].text, /a note/);
});

// (fails before: yes — Filament's own hands were allowed once with nothing said)
test("under ask, with nobody to ask, what Filament does for the agent is allowed once and said, as the agent's own requests are", async () => {
  const tb = new TurnBridge();
  /** @type {any[]} */
  const said = [];
  const turn = { done: false, bridge: "prompts", permits: null, clientTools: { has: () => false }, emit: (/** @type {any} */ e) => said.push(e) };
  const asks = { ...upstream, acp: { permissions: "ask" } };
  await tb.permitLocal(/** @type {any} */ (turn), asks, "execute", "npm test");
  assert.deepEqual(said, [{ type: "note", text: "acp: permissions ask: the client has no question tool, so the prompt was allowed once", note: { kind: "permissions-unanswerable" } }]);
  await tb.permitLocal(/** @type {any} */ (turn), upstream, "execute", "npm test");
  await tb.permitLocal(/** @type {any} */ ({ ...turn, done: true }), asks, "execute", "npm test");
  assert.equal(said.length, 1, "nothing said under another policy, nor on a turn that ended");
});

// (fails before: yes — once Filament's reads for the agent were judged, ask put each read to the client, and with
// nobody to ask said it was allowed once, where its reads had never asked)
test("under ask, a read Filament does for the agent is neither asked nor said, as the agent's own reads never are", async () => {
  const tb = new TurnBridge();
  /** @type {any[]} */
  const asked = [];
  tb.askClient = async (/** @type {any} */ _turn, /** @type {any} */ a) => (asked.push(a), "allow");
  /** @type {any[]} */
  const said = [];
  const asks = { ...upstream, acp: { permissions: "ask" } };
  for (const ask of [true, false]) {
    const turn = { done: false, bridge: "full", permits: null, clientTools: { has: (/** @type {string} */ t) => ask && t === "ask", buildAsk: () => ({}) }, emit: (/** @type {any} */ e) => said.push(e) };
    await tb.permitLocal(/** @type {any} */ (turn), asks, "read", join(dir, "notes.txt"));
  }
  assert.deepEqual([asked, said], [[], []]);
});
