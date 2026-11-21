// @ts-check
// HarnessV2 Phase 5 — the MCP client door (§5.7 `plugins.mcp`): stdio and streamable HTTP against the scripted
// server in test/fixtures/mcp-server.mjs, the pool's reuse and replacement, and the loop offering a session's MCP
// tools as mcp__<server>__<tool> — a read-only tool runs free, another asks (or runs on a rule), a dead server is
// left out in words. No network beyond loopback.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import childProcess, { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { copyFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { removeDirs } from "./helpers/wait.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { connectMcp, createMcpPool, messagesFromHttp, specKey, isMcpTool, McpError } from "../src/adapters/tools/mcp-client.js";
import { gate, permissionQuestion, argSummary, isLoopTool } from "../src/app/agent/tools.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { POWERSHELL } from "../src/adapters/tools/shell.js";

/** The powershell hand rides only where there is a PowerShell (Windows): the tool list below holds its place. */
const PS = POWERSHELL ? ["powershell"] : [];

// System on the wire: a string, or blocks carrying cache markers past minSystemChars.
const sysTextOf = (b) => (Array.isArray(b.system) ? b.system.map((x) => x?.text ?? "").join("\n") : String(b.system || ""));

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const lastResults = (msgs) => {
  const m = msgs.at(-1);
  return Array.isArray(m?.content) ? m.content.filter((c) => c?.type === "tool_result") : [];
};
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn", model = "brain-model") => anthropicReply("", { model, stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
const readLog = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * A close, its caps held: no timer fires while it runs, so it settles on what it waits for — taskkill's end and the
 * server's — however long a busy machine's taskkill takes (0.6 s idle, 3.7–10.8 s beside 64 busy processes, where the
 * close's 3 s cap settled it with the server still running). A close that waits for nothing settles at once all the
 * same, the server still there.
 * @param {import("node:test").TestContext} t @param {() => Promise<unknown>} close
 */
async function closedAtItsEnd(t, close) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await close();
  } finally {
    t.mock.timers.reset();
  }
}

/** The fixture over HTTP: started once, its port read off stdout. */
function httpFixture(extraEnv = {}) {
  /** @type {import("node:child_process").ChildProcess | null} */
  let proc = null;
  return {
    port: 0,
    async start() {
      proc = spawn(process.execPath, [FIXTURE, "--http", "0"], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, ...extraEnv } });
      this.port = await new Promise((resolve, reject) => {
        let buf = "";
        proc?.stdout?.on("data", (d) => {
          buf += d;
          const m = /listening (\d+)/.exec(buf);
          if (m) resolve(Number(m[1]));
        });
        proc?.on("exit", () => reject(new Error("the http fixture exited")));
      });
    },
    url() {
      return `http://127.0.0.1:${this.port}/mcp`;
    },
    stop() {
      proc?.kill();
    },
  };
}

describe("MCP client — pure", () => {
  test("messagesFromHttp reads a JSON body, a JSON batch and an SSE stream; specKey changes with anything that changes the server; tool names are recognised", () => {
    assert.deepEqual(messagesFromHttp('{"jsonrpc":"2.0","id":1,"result":{}}', "application/json"), [{ jsonrpc: "2.0", id: 1, result: {} }]);
    assert.deepEqual(messagesFromHttp('[{"id":1},{"id":2}]', "application/json").map((m) => m.id), [1, 2]);
    assert.deepEqual(messagesFromHttp('event: message\ndata: {"id":1,"result":"a"}\n\nevent: message\ndata: {"id":2,\ndata: "result":"b"}\n\n', "text/event-stream").map((m) => m.id), [1, 2]);
    assert.deepEqual(messagesFromHttp("", "application/json"), []);
    assert.deepEqual(messagesFromHttp("not json", "application/json"), []);
    const a = specKey({ name: "x", command: "node", args: ["s.js"] });
    assert.equal(specKey({ name: "x", command: "node", args: ["s.js"] }), a);
    assert.notEqual(specKey({ name: "x", command: "node", args: ["s.js", "--flag"] }), a);
    assert.notEqual(specKey({ name: "x", command: "node", args: ["s.js"], env: { A: "1" } }), a);
    assert.notEqual(specKey({ name: "x", url: "http://h/mcp" }), a);
    assert.ok(isMcpTool("mcp__notes__echo") && !isMcpTool("read") && isLoopTool("mcp__notes__echo"));
  });

  // (fails before: yes — the bug hunt of 10-30: a stream framed with CRLF, as SSE allows, was read as one event: its
  // messages' data ran together, nothing parsed, and the call said the server answered without a result)
  test("messagesFromHttp reads an SSE stream whatever line ending frames it: CRLF, CR or LF", () => {
    const events = (/** @type {string} */ nl) => `event: message${nl}data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}${nl}${nl}event: message${nl}data: {"jsonrpc":"2.0","id":2,${nl}data: "result":"b"}${nl}${nl}`;
    for (const nl of ["\r\n", "\r", "\n"]) assert.deepEqual(messagesFromHttp(events(nl), "text/event-stream").map((m) => m.id ?? m.method), ["notifications/message", 2], JSON.stringify(nl));
  });

  test("the gate treats an MCP tool by its nature: read-only runs everywhere; anything else is a command (read-only refuses, edit and ask ask, auto runs, a learned rule runs); the question and the summary name the call", () => {
    assert.deepEqual(gate("read-only", "mcp__n__echo", { text: "x" }, null, "read"), { verdict: "run" });
    assert.match(String(/** @type {any} */ (gate("read-only", "mcp__n__write_note", { name: "a" }, null, "mutate")).text), /this session is read-only, so mcp__n__write_note is not available\. Say precisely what you would call/);
    assert.equal(gate("edit", "mcp__n__write_note", { name: "a", text: "t" }, null, "mutate").verdict, "ask");
    assert.equal(gate("ask", "mcp__n__write_note", { name: "a" }, null, "mutate").verdict, "ask");
    assert.deepEqual(gate("auto", "mcp__n__write_note", { name: "a" }, null, "mutate"), { verdict: "run" });
    assert.deepEqual(gate("edit", "mcp__n__write_note", { name: "a" }, () => true, "mutate"), { verdict: "run", learned: true });
    assert.deepEqual(gate("edit", "mcp__n__echo", {}, null, "read"), { verdict: "run" });
    assert.equal(permissionQuestion("mcp__n__write_note", { name: "a", text: "t" }), 'May I call mcp__n__write_note with `{"name":"a","text":"t"}`? Its server does not vouch for it as read-only — answer /allow to run it, or say what to do instead.');
    assert.equal(permissionQuestion("mcp__n__ping", {}), "May I call mcp__n__ping? Its server does not vouch for it as read-only — answer /allow to run it, or say what to do instead.");
    assert.equal(argSummary("mcp__n__echo", { text: "hi" }), '{"text":"hi"}');
    assert.equal(argSummary("mcp__n__echo", {}), "");
  });
});

describe("MCP client — stdio and streamable HTTP against the scripted server", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-mcp-"));
  after(() => removeDirs(dir));

  test("stdio: initialize, the tool list with read-only marks and provider-safe names, calls with text, rich, error and timeout outcomes, the spec's env, close kills the process", async (t) => {
    const log = join(dir, "stdio.log");
    const c = await connectMcp({ name: "fx", command: process.execPath, args: [FIXTURE], env: { FIXTURE_FLAG: "on", MCP_FIXTURE_LOG: log } }, { cwd: dir, timeoutMs: 10_000 });
    try {
      assert.equal(c.transport, "stdio");
      assert.deepEqual(c.serverInfo, { name: "fixture", version: "1.0" });
      assert.deepEqual(c.tools.map((t) => t.name), ["mcp__fx__echo", "mcp__fx__write_note", "mcp__fx__slow", "mcp__fx__fail", "mcp__fx__rich", "mcp__fx__odd_name_v2"]);
      assert.deepEqual(c.tools.map((t) => t.readOnly), [true, false, true, true, true, true]);
      assert.equal(c.tools[0].tool, "echo"); assert.equal(c.tools[5].tool, "odd name.v2");
      assert.deepEqual(c.tools[0].input_schema, { type: "object", required: ["text"], properties: { text: { type: "string" } } });
      assert.equal(await c.call("echo", { text: "hi" }), "echo: hi");
      const long = String(await c.call("echo", { text: "z".repeat(5000) }, { maxBytes: 2000 }));
      assert.ok(long.length <= 2000, `${long.length}: the caller's budget holds, its notice inside it`);
      assert.match(long, /^echo: z+\n…\[Filament: [\d,]+ more characters of this MCP result are not shown; ask the tool for a narrower result\]$/);
      assert.equal(await c.call("odd name.v2", {}), "odd ok");
      assert.equal(await c.call("write_note", { name: "note1", text: "body" }), "wrote note1.txt");
      assert.equal(readFileSync(join(dir, "note1.txt"), "utf8"), "body", "the server ran in the session's folder");
      assert.equal(await c.call("rich", {}), "line one\n[image image/png]\n[resource file:///x — x]");
      await assert.rejects(c.call("fail", {}), (e) => e instanceof McpError && /it broke/.test(e.message));
      await assert.rejects(c.call("nope", {}), /unknown tool nope/);
      // The session's redaction covers what the server says — a result, a failure it reports, an error it answers.
      const redact = (/** @type {string} */ t) => t.replace(/SECRET-\d|broke|nope/g, "[redacted]");
      assert.equal(await c.call("echo", { text: "key SECRET-1" }, { redact }), "echo: key [redacted]");
      await assert.rejects(c.call("fail", {}, { redact }), (e) => e instanceof McpError && /it \[redacted\]/.test(e.message));
      await assert.rejects(c.call("nope", {}, { redact }), /unknown tool \[redacted\]/);
      await assert.rejects(c.call("slow", { ms: 2000 }, { timeoutMs: 300 }), /fx: slow did not answer within 0 s|did not answer within/);
      const seen = readLog(log);
      assert.deepEqual(seen.slice(0, 3).map((x) => x.method), ["initialize", "notifications/initialized", "tools/list"], "the handshake in order");
      assert.ok(seen.every((x) => x.env === "on"), "the spec's env reached the server");
      assert.ok(c.alive());
    } finally {
      await closedAtItsEnd(t, () => c.close());
    }
    // (fails before: yes — HarnessV3-Readiness RD1 d: close fired the kill and returned; the test waited 400 ms for it)
    assert.ok(!c.alive(), "closed: the process is gone when close resolves");
  });

  // (fails before: yes — the bug hunt of 10-30: a server's tools past the 100 Filament offers were left out and nothing
  // said so, nor of the pages it never asked for)
  test("a server with more tools than Filament offers: the first 100 are offered, and the connection names the rest it listed and says whether pages were left unasked", async () => {
    const tools = (/** @type {number} */ from, /** @type {number} */ to) => Array.from({ length: to - from }, (_, i) => `tool_${from + i}`);
    const whole = await connectMcp({ name: "big", command: process.execPath, args: [FIXTURE, "--many", "150"] }, { cwd: dir, timeoutMs: 10_000 });
    try {
      assert.equal(whole.tools.length, 100);
      assert.deepEqual(whole.capped, { at: 100, names: tools(94, 150), more: false }, "the six of its own and tool_0…tool_93 offered");
    } finally {
      await whole.close();
    }
    const paged = await connectMcp({ name: "big", command: process.execPath, args: [FIXTURE, "--many", "150", "--page", "40"] }, { cwd: dir, timeoutMs: 10_000 });
    try {
      assert.equal(paged.tools.length, 100);
      assert.deepEqual(paged.capped, { at: 100, names: tools(94, 114), more: true }, "three pages asked, the fourth left");
    } finally {
      await paged.close();
    }
    const small = await connectMcp({ name: "fx", command: process.execPath, args: [FIXTURE, "--page", "4"] }, { cwd: dir, timeoutMs: 10_000 });
    try {
      assert.deepEqual([small.tools.length, small.capped], [6, null], "a server within the cap, every page asked");
    } finally {
      await small.close();
    }
  });

  // (fails before: yes — the bug hunt of 10-30: a server that answered every page with no tools and a next cursor was
  // asked for pages forever, the connection never made)
  test("a server whose pages list no tools, or name a cursor asked for already, is asked no further: what it lists is offered, the rest said as unasked", async () => {
    const tool = (/** @type {string} */ name) => ({ name, inputSchema: { type: "object" } });
    // Each server by its pages: the tools on the n-th page asked, and the cursor it names after them.
    const servers = [
      { pages: 2, page: (/** @type {number} */ n) => ({ tools: n ? [] : [tool("first")], nextCursor: "again" }) },
      { pages: 3, page: (/** @type {number} */ n) => ({ tools: [tool(n ? `t${n}` : "first")], nextCursor: `p${n === 2 ? 0 : n}` }) },
    ];
    for (const server of servers) {
      let pages = 0;
      /** @type {typeof fetch} */
      const fetchImpl = async (_url, init) => {
        const m = JSON.parse(String(init?.body));
        if (m.id === undefined) return new Response(null, { status: 202 });
        if (m.method === "initialize") return Response.json({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "pager" } } });
        if (++pages > 50) throw new Error("asked for pages past fifty");
        return Response.json({ jsonrpc: "2.0", id: m.id, result: server.page(pages - 1) });
      };
      const c = await connectMcp({ name: "pager", url: "http://127.0.0.1:1/mcp" }, { timeoutMs: 5000, fetchImpl });
      try {
        assert.equal(pages, server.pages);
        assert.equal(c.tools[0].tool, "first");
        assert.equal(c.capped?.more, true, "the pages after them said, not asked for");
      } finally {
        await c.close();
      }
    }
  });

  // (fails before: yes — the bug hunt of 10-30: the client's answer to a question of the server's, written after the
  // server could no longer read it, was a promise nobody caught: Filament's log said "unhandled rejection")
  test("stdio: a question a server asks as it goes is answered into nothing, quietly: no rejection is left unheard", async () => {
    /** @type {unknown[]} */
    const unheard = [];
    const hear = (/** @type {unknown} */ e) => unheard.push(e);
    process.on("unhandledRejection", hear);
    const c = await connectMcp({ name: "ask", command: process.execPath, args: [FIXTURE, "--ask-back"] }, { cwd: dir, timeoutMs: 10_000 });
    try {
      await assert.rejects(c.call("ask_back", {}, { timeoutMs: 5_000 }), /MCP server ask exited/);
      await new Promise((r) => setTimeout(r, 1500)); // the question comes after the exit, and its answer fails then
    } finally {
      process.off("unhandledRejection", hear);
      await c.close();
    }
    assert.deepEqual(unheard.map((e) => String(/** @type {any} */ (e)?.message || e)), []);
  });

  // (fails before: yes — RD1 d: closeAll fired the kills and returned at once, and on Windows the server left on its
  // stdin's end before taskkill could walk its tree, so the process it started lived on in the folder)
  test("closing waits for the server's whole tree: closeAll resolves once the server and what it started are gone, and the folder can be removed", async (t) => {
    const work = mkdtempSync(join(tmpdir(), "filament-mcp-tree-"));
    const log = join(dir, "tree.log");
    const alive = (/** @type {number} */ pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    /** @type {{ pid: number, grandchild: number } | null} */
    let pids = null;
    const pool = createMcpPool();
    try {
      const [s] = await pool.servers("s", [{ name: "tree", command: process.execPath, args: [FIXTURE, "--grandchild"], env: { MCP_FIXTURE_LOG: log } }], { cwd: work });
      assert.equal(s.problem, null);
      pids = readLog(log).find((x) => x.grandchild) || null;
      assert.ok(pids && alive(pids.pid) && alive(pids.grandchild), `both run: ${JSON.stringify(pids)}`);
      await closedAtItsEnd(t, () => pool.closeAll());
      assert.equal(alive(pids.pid), false, "the server is gone when closeAll resolves");
      if (process.platform === "win32") {
        assert.equal(alive(pids.grandchild), false, "and so is the process it started (taskkill /T)");
        await removeDirs(work); // EBUSY for as long as a process works in the folder; a hold of Windows' own on a file just written passes
      }
    } finally {
      for (const pid of pids ? [pids.pid, pids.grandchild] : []) if (alive(pid)) process.kill(pid);
      await removeDirs(work);
    }
  });

  // (fails before: yes — the bug hunt of 10-30, PERM-3: the pool closed all its servers, or one idle past its time,
  // never one session's — a worker's own, started in its worktree, which go as its run ends)
  test("one session's servers close: each with its whole tree, its folder can be removed, and another session's run on", async (t) => {
    const work = mkdtempSync(join(tmpdir(), "filament-mcp-own-"));
    const other = mkdtempSync(join(tmpdir(), "filament-mcp-other-"));
    const log = join(dir, "own.log");
    const alive = (/** @type {number} */ pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const spec = { name: "tree", command: process.execPath, args: [FIXTURE, "--grandchild"], env: { MCP_FIXTURE_LOG: log } };
    /** @type {{ pid: number, grandchild: number }[]} */
    let pids = [];
    const pool = createMcpPool();
    try {
      await pool.servers("subagent:sa_1", [spec], { cwd: work });
      await pool.servers("chain:c1", [spec], { cwd: other });
      pids = readLog(log).filter((x) => x.grandchild);
      assert.equal(pids.length, 2, "one server for each session");
      await closedAtItsEnd(t, () => pool.close("subagent:sa_1"));
      assert.equal(pool.size(), 1, "the other session's server is kept");
      assert.deepEqual([alive(pids[0].pid), alive(pids[1].pid)], [false, true], "the closed session's server is gone when close resolves");
      if (process.platform === "win32") {
        assert.equal(alive(pids[0].grandchild), false, "and so is the process it started");
        await removeDirs(work); // EBUSY for as long as a process works in the folder; a hold of Windows' own on a file just written passes
      }
    } finally {
      await pool.closeAll();
      for (const p of pids) for (const pid of [p.pid, p.grandchild]) if (alive(pid)) process.kill(pid);
      await removeDirs(work, other);
    }
  });

  // (fails before: no — L4's mutation pass: waiting on the server's exit alone passed the test above, since taskkill
  // takes the tree before that exit is heard; nothing held the close to taskkill's own end)
  test("on Windows the close settles only once taskkill itself is done, not at the server's exit", { skip: process.platform !== "win32" }, async (t) => {
    const c = await connectMcp({ name: "fx", command: process.execPath, args: [FIXTURE] }, { cwd: dir, timeoutMs: 10_000 });
    const cp = /** @type {any} */ (childProcess);
    const real = cp.spawn;
    /** @type {number | null} */
    let heard = null;
    // The clock's own: the close's are held below.
    const later = setTimeout;
    cp.spawn = function (/** @type {any[]} */ ...args) {
      const child = real.apply(this, args);
      if (args[0] !== "taskkill") return child;
      // taskkill's end is heard 300 ms late: a close that waits on it cannot settle sooner.
      const late = new EventEmitter();
      child.once("exit", (/** @type {any} */ code) => later(() => { heard = Date.now(); late.emit("exit", code); }, 300));
      child.once("error", (/** @type {any} */ e) => late.emit("error", e));
      return late;
    };
    syncBuiltinESMExports();
    try {
      await closedAtItsEnd(t, () => c.close());
    } finally {
      cp.spawn = real;
      syncBuiltinESMExports();
    }
    assert.ok(!c.alive(), "the server is gone");
    assert.notEqual(heard, null, "the close settled after taskkill's end was heard");
  });

  // (fails before: yes — the close started taskkill and never read its exit: with taskkill failing, the server kept
  // running past the close with its pipes open, and a full-suite run hung on a server that outlived the app's stop) —
  // with a guard the mutation pass asked for: a taskkill that works leaves nothing to fall back on, and says nothing
  test("on Windows a close that taskkill fails to carry out, or that cannot start taskkill, still ends the server and says so in the log", { skip: process.platform !== "win32" }, async (t) => {
    /** A server, and what it logs past the debug lines. @param {string[]} lines */
    const server = (lines) => connectMcp({ name: "fx", command: process.execPath, args: [FIXTURE] }, { cwd: dir, timeoutMs: 10_000, log: (level, msg) => void (level !== "debug" && lines.push(`${level} ${msg}`)) });
    /** @type {string[]} */
    const quiet = [];
    const worked = await server(quiet);
    await closedAtItsEnd(t, () => worked.close());
    assert.deepEqual([worked.alive(), quiet], [false, []]);
    const bin = mkdtempSync(join(tmpdir(), "filament-mcp-kill-"));
    // A taskkill that refuses every call: where.exe exits 2 on taskkill's arguments.
    copyFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe"), join(bin, "taskkill.exe"));
    const path = process.env.PATH;
    t.after(() => {
      process.env.PATH = path;
      rmSync(bin, { recursive: true, force: true });
    });
    /** @type {string[]} */
    const failed = [];
    const refused = await server(failed);
    process.env.PATH = `${bin};${path}`;
    await closedAtItsEnd(t, () => refused.close());
    process.env.PATH = path;
    assert.equal(refused.alive(), false, "the server is gone when the close settles");
    assert.deepEqual(failed, ["warn mcp fx: taskkill exited 2; killing the server directly"]);
    // No taskkill to start at all.
    /** @type {string[]} */
    const none = [];
    const missing = await server(none);
    process.env.PATH = join(bin, "nothing-here");
    await closedAtItsEnd(t, () => {
      const closing = missing.close();
      process.env.PATH = path;
      return closing;
    });
    assert.equal(missing.alive(), false);
    assert.deepEqual(none, ["warn mcp fx: taskkill could not start (spawn taskkill ENOENT); killing the server directly"]);
  });

  // (fails before: no — a guard the mutation pass asked for: a close settles on what it waits for, taskkill's end and
  // the server's or the direct kill, and MCP_CLOSE_WAIT_MS only caps a close that is stuck)
  test("on Windows a close settles once the server is gone, not at its cap, whether taskkill ends it or the direct kill does", { skip: process.platform !== "win32" }, async (t) => {
    const works = await connectMcp({ name: "fx", command: process.execPath, args: [FIXTURE] }, { cwd: dir, timeoutMs: 10_000 });
    const fails = await connectMcp({ name: "fx", command: process.execPath, args: [FIXTURE] }, { cwd: dir, timeoutMs: 10_000, log: () => {} });
    const cp = /** @type {any} */ (childProcess);
    const real = cp.spawn;
    // The cap's timer never fires here: a close that waited on it would never settle.
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      await works.close();
      cp.spawn = function (/** @type {any[]} */ ...args) {
        if (args[0] === "taskkill") throw new Error("spawn EPERM");
        return real.apply(this, args);
      };
      syncBuiltinESMExports();
      await fails.close();
    } finally {
      t.mock.timers.reset();
      cp.spawn = real;
      syncBuiltinESMExports();
    }
    assert.ok(!works.alive() && !fails.alive(), "both servers are gone");
  });

  // (fails before: yes — a taskkill whose spawn threw at once was swallowed, and the server outlived its close; Node
  // throws at once for some errors instead of emitting one)
  test("on Windows a taskkill whose spawn throws at once still ends the server, and says so", { skip: process.platform !== "win32" }, async (t) => {
    /** @type {string[]} */
    const lines = [];
    const c = await connectMcp({ name: "fx", command: process.execPath, args: [FIXTURE] }, { cwd: dir, timeoutMs: 10_000, log: (level, msg) => void (level !== "debug" && lines.push(`${level} ${msg}`)) });
    const cp = /** @type {any} */ (childProcess);
    const real = cp.spawn;
    cp.spawn = function (/** @type {any[]} */ ...args) {
      if (args[0] === "taskkill") throw new Error("spawn EPERM");
      return real.apply(this, args);
    };
    syncBuiltinESMExports();
    try {
      await closedAtItsEnd(t, () => c.close());
    } finally {
      cp.spawn = real;
      syncBuiltinESMExports();
    }
    assert.equal(c.alive(), false);
    assert.deepEqual(lines, ["warn mcp fx: taskkill could not start (spawn EPERM); killing the server directly"]);
  });

  test("stdio: a server that exits before answering and a command that does not exist are refused in words, with stderr's last line", async () => {
    await assert.rejects(connectMcp({ name: "dead", command: process.execPath, args: [FIXTURE, "--stderr", "--crash"] }, { cwd: dir, timeoutMs: 5000 }), /MCP server dead exited \(code 3\): fixture: hello from stderr/);
    await assert.rejects(connectMcp({ name: "ghost", command: "no-such-binary-filament-xyz" }, { cwd: dir, timeoutMs: 5000 }), /MCP server ghost (could not start|exited)/);
    await assert.rejects(connectMcp({ name: "mute", command: process.execPath, args: ["-e", "setTimeout(()=>{}, 5000)"] }, { cwd: dir, timeoutMs: 400 }), /mute: initialize did not answer within 0 s/);
  });

  test("streamable HTTP: the session id from initialize rides on every later request with the spec's headers; JSON and SSE answers; DELETE on close", async () => {
    const log = join(dir, "http.log");
    const fx = httpFixture({ MCP_FIXTURE_LOG: log });
    await fx.start();
    try {
      const c = await connectMcp({ name: "hx", url: fx.url(), headers: { authorization: "Bearer t0k" } }, { timeoutMs: 10_000 });
      assert.equal(c.transport, "http");
      assert.deepEqual(c.tools.map((t) => t.name).slice(0, 2), ["mcp__hx__echo", "mcp__hx__write_note"]);
      assert.equal(await c.call("echo", { text: "over http" }), "echo: over http");
      assert.equal(await c.call("echo", { text: "streamed", sse: true }), "echo: streamed", "the result is found among the SSE messages");
      assert.ok(String(await c.call("echo", { text: "h".repeat(4000) }, { maxBytes: 1500 })).length <= 1500, "the caller's budget holds over HTTP too");
      await assert.rejects(c.call("fail", {}), /it broke/);
      await c.close();
      const seen = readLog(log).filter((x) => x.http || x.method === "DELETE");
      assert.equal(seen[0].session, null, "initialize carries no session yet");
      assert.ok(seen.slice(1).every((x) => x.session === "sess-1"), JSON.stringify(seen.map((x) => x.session)));
      assert.ok(seen.filter((x) => x.http).every((x) => x.auth === "Bearer t0k" && x.protocol === "2025-06-18"));
      assert.equal(seen.at(-1)?.method, "DELETE");
      await assert.rejects(connectMcp({ name: "nx", url: "http://127.0.0.1:9/mcp" }, { timeoutMs: 3000 }), /nx: initialize: 127\.0\.0\.1:9 could not be reached/);
    } finally {
      fx.stop();
    }
  });

  test("the pool: the same spec is connected once per session and reused; a changed spec replaces its connection; a dropped server and an idle one are closed", async () => {
    /** @type {string[]} */
    const events = [];
    let clock = 1000;
    const fakeConnect = async (spec) => {
      events.push(`connect ${spec.name}:${(spec.args || []).join(",")}`);
      let alive = true;
      return { name: spec.name, transport: "stdio", serverInfo: null, tools: [], alive: () => alive, call: async () => "", close: async () => { alive = false; events.push(`close ${spec.name}:${(spec.args || []).join(",")}`); } };
    };
    const pool = createMcpPool({ connect: /** @type {any} */ (fakeConnect), idleMs: 5000, now: () => clock });
    try {
      const a1 = await pool.servers("s1", [{ name: "a", command: "x", args: ["1"] }]);
      assert.equal(a1[0].fresh, true);
      const a2 = await pool.servers("s1", [{ name: "a", command: "x", args: ["1"] }, { name: "b", command: "y" }]);
      assert.deepEqual(a2.map((s) => `${s.name}:${s.fresh}`), ["a:false", "b:true"]);
      const a3 = await pool.servers("s1", [{ name: "a", command: "x", args: ["2"] }]);
      assert.equal(a3[0].fresh, true, "the spec changed: reconnected");
      assert.deepEqual(events, ["connect a:1", "connect b:", "close a:1", "connect a:2", "close b:"]);
      await pool.servers("s2", [{ name: "a", command: "x", args: ["2"] }]);
      assert.equal(pool.size(), 2, "sessions do not share connections");
      clock += 6000;
      pool.sweep();
      assert.equal(pool.size(), 0, "idle connections are closed");
      // Two turns of one session asking at once share one connect; nothing is opened twice and nothing leaks.
      events.length = 0;
      const [c1, c2] = await Promise.all([pool.servers("s3", [{ name: "a", command: "x", args: ["3"] }]), pool.servers("s3", [{ name: "a", command: "x", args: ["3"] }])]);
      assert.equal(c1[0].conn, c2[0].conn, "the same connection");
      assert.deepEqual(events, ["connect a:3"]);
      assert.deepEqual([c1[0].fresh, c2[0].fresh], [true, false]);
      assert.equal(pool.size(), 1);
      // A spec changed while its first version was still connecting: the newer wins and the older is closed, not left running.
      events.length = 0;
      const [d1, d2] = await Promise.all([pool.servers("s4", [{ name: "a", command: "x", args: ["4"] }]), pool.servers("s4", [{ name: "a", command: "x", args: ["5"] }])]);
      assert.ok(d1[0].conn && d2[0].conn && d1[0].conn !== d2[0].conn);
      assert.deepEqual(events.slice(0, 2), ["connect a:4", "connect a:5"]);
      assert.ok(events.includes("close a:4"), events.join(", "));
      assert.equal(pool.size(), 2, "s3 and s4 hold one each");
    } finally {
      pool.closeAll();
    }
    const failing = createMcpPool({ connect: /** @type {any} */ (async () => { throw new McpError("MCP server z exited (code 3)"); }) });
    try {
      const r = await failing.servers("s", [{ name: "z", command: "boom" }]);
      assert.equal(r[0].problem, "MCP server z exited (code 3)");
      const again = await failing.servers("s", [{ name: "z", command: "boom" }]);
      assert.equal(again[0].problem, "MCP server z exited (code 3)", "a pool with no wait tries again at once (a Space's press)");
    } finally {
      failing.closeAll();
    }
  });

  // (fails before: yes — the slowness of 11-01: a turn connected its servers one after another, each up to its 15 s)
  test("the pool connects a turn's servers side by side, each entry in the spec's order", async () => {
    /** @type {Map<string, (conn: any) => void>} */
    const waiting = new Map();
    const fakeConnect = (spec) => new Promise((ok) => waiting.set(spec.name, ok));
    const conn = (name) => ({ name, transport: "stdio", serverInfo: null, tools: [], alive: () => true, call: async () => "", close: async () => {} });
    const pool = createMcpPool({ connect: /** @type {any} */ (fakeConnect) });
    try {
      const asked = pool.servers("s", [{ name: "a", command: "x" }, { name: "b", command: "y" }, { name: "c", command: "z" }]);
      await new Promise((r) => setImmediate(r));
      assert.deepEqual([...waiting.keys()], ["a", "b", "c"], "every server asked before any answers");
      waiting.get("c")?.(conn("c"));
      waiting.get("a")?.(conn("a"));
      waiting.get("b")?.(conn("b"));
      const r = await asked;
      assert.deepEqual(r.map((s) => s.conn?.name), ["a", "b", "c"]);
    } finally {
      pool.closeAll();
    }
  });

  // (fails before: yes — the slowness of 11-01: a server that did not answer was asked again by every turn, and every
  // sub-agent's, each waiting out its connect before its first request)
  test("a turn's pool never waits again for a server that did not answer: asked again behind a turn once its wait is over, longer each time, its tools with the next turn once it answers", async () => {
    let clock = 1_000;
    /** @type {string[]} */
    const tried = [];
    /** How the next connect ends: "fail", "ok", or "hang" (a server that does not answer, held until the test says). */
    let next = "fail";
    /** @type {((e: any) => void) | null} */
    let hung = null;
    const conn = (/** @type {string} */ name) => ({ name, transport: "stdio", serverInfo: null, tools: [], alive: () => true, call: async () => "", close: async () => {} });
    const fakeConnect = (/** @type {any} */ spec) => {
      tried.push(`${spec.name}:${spec.args?.[0] || ""}`);
      if (next === "hang") return new Promise((_, fail) => { hung = fail; });
      return next === "ok" ? Promise.resolve(conn(spec.name)) : Promise.reject(new McpError(`MCP server ${spec.name}: initialize timed out`));
    };
    const pool = createMcpPool({ connect: /** @type {any} */ (fakeConnect), now: () => clock, failedWaitMs: 30_000 });
    const z = { name: "z", command: "x", args: ["1"] };
    const settle = () => new Promise((r) => setImmediate(r));
    try {
      const r1 = await pool.servers("s", [z]);
      assert.equal(r1[0].problem, "MCP server z: initialize timed out");
      clock += 10_000;
      const r2 = await pool.servers("s", [z]);
      assert.deepEqual(tried, ["z:1"], "not asked again yet");
      assert.deepEqual([r2[0].conn, r2[0].problem, r2[0].ms, r2[0].fresh], [null, "MCP server z: initialize timed out — asked again in 20 s", 0, false]);
      const other = await pool.servers("t", [z]);
      assert.equal(tried.length, 1, "another session's — a sub-agent's — is the same server, held back alike");
      assert.equal(other[0].problem, "MCP server z: initialize timed out — asked again in 20 s");
      // Its wait over, it is asked again behind the turn: the turn goes on without waiting for it.
      clock += 20_000;
      next = "hang";
      const r3 = await pool.servers("s", [z]);
      assert.deepEqual(tried, ["z:1", "z:1"], "asked again");
      assert.equal(r3[0].problem, "MCP server z: initialize timed out — asked again now, behind this turn");
      await pool.servers("s", [z]);
      assert.equal(tried.length, 2, "one ask behind the turns at a time");
      /** @type {any} */ (hung)?.(new McpError("MCP server z: initialize timed out"));
      await settle();
      clock += 59_000;
      next = "fail";
      const r4 = await pool.servers("s", [z]);
      assert.equal(tried.length, 2, "the second wait is twice the first");
      assert.equal(r4[0].problem, "MCP server z: initialize timed out — asked again in 1 s");
      const changed = await pool.servers("s", [{ ...z, args: ["2"] }]);
      assert.deepEqual(tried.slice(2), ["z:2"], "a changed spec is another server, asked at once");
      assert.equal(changed[0].problem, "MCP server z: initialize timed out");
      // It answers behind a turn: the next turn has it.
      clock += 30_000;
      next = "ok";
      const r5 = await pool.servers("s", [{ ...z, args: ["2"] }]);
      assert.equal(r5[0].conn, null, "this turn's tools stay as they were");
      await settle();
      const r6 = await pool.servers("s", [{ ...z, args: ["2"] }]);
      assert.equal(r6[0].conn?.name, "z", "the next turn has it");
      assert.equal(tried.length, 4);
      // Answered once, it is waited for again the next time it is connected, and held back only once that fails.
      if (r6[0].conn) r6[0].conn.alive = () => false;
      next = "fail";
      const r7 = await pool.servers("s", [{ ...z, args: ["2"] }]);
      assert.equal(r7[0].problem, "MCP server z: initialize timed out");
      const r8 = await pool.servers("s", [{ ...z, args: ["2"] }]);
      assert.equal(r8[0].problem, "MCP server z: initialize timed out — asked again in 30 s", "the first wait again");
      assert.equal(tried.length, 5);
    } finally {
      pool.closeAll();
    }
  });

  // (fails before: yes — the cache audit's finding of 11-07: a server down for one turn left its tools and its prompt
  // line out of that turn's request and brought them back with the next, and the provider wrote the chat to its cache
  // twice)
  test("a turn's pool offers a server that answered before and does not now as it last listed itself: its tools as they were, each call refused in words", async () => {
    let clock = 1_000;
    let next = "ok";
    const tool = { name: "mcp__z__look", description: "Look", input_schema: { type: "object" }, server: "z", tool: "look", readOnly: true };
    const conn = (/** @type {string} */ name) => ({ name, transport: "stdio", serverInfo: { name: "zz" }, tools: [tool], dropped: [], alive: () => true, call: async () => "looked", close: async () => {} });
    const fakeConnect = (/** @type {any} */ spec) => (next === "ok" ? Promise.resolve(conn(spec.name)) : Promise.reject(new McpError(`MCP server ${spec.name}: connection refused`)));
    const pool = createMcpPool({ connect: /** @type {any} */ (fakeConnect), now: () => clock, failedWaitMs: 30_000, keepListed: true });
    const z = { name: "z", command: "x" };
    try {
      const [up] = await pool.servers("s", [z]);
      assert.equal(await up.conn?.call("look", {}), "looked");
      /** @type {any} */ (up.conn).alive = () => false;
      next = "fail";
      const [down] = await pool.servers("s", [z]);
      assert.equal(down.problem, "MCP server z: connection refused");
      assert.deepEqual([down.conn?.tools, down.conn?.transport, down.conn?.alive()], [[tool], "stdio", false], "its tools as it last listed them");
      await assert.rejects(down.conn?.call("look", {}) ?? Promise.resolve(), /^Error: MCP server z did not answer this turn \(MCP server z: connection refused\): its tools are as it last listed them, and none of them can be called until it answers again$/);
      const [held] = await pool.servers("s", [z]);
      assert.deepEqual([held.conn?.tools, held.problem], [[tool], "MCP server z: connection refused — asked again in 30 s"], "held back, as it was listed still");
      const [changed] = await pool.servers("s", [{ ...z, command: "y" }]);
      assert.equal(changed.conn, null, "a changed spec is another server: nothing listed for it");
      assert.equal((await createMcpPool({ connect: /** @type {any} */ (fakeConnect) }).servers("s", [z]))[0].conn, null, "a pool that keeps nothing listed: none");
      // One that asks to be signed in to again is left out until it is: no wait mends it.
      const signedOut = createMcpPool({ connect: /** @type {any} */ ((/** @type {any} */ spec) => (next === "ok" ? Promise.resolve(conn(spec.name)) : Promise.reject(new McpError(`MCP server ${spec.name}: signed out`, { data: { signIn: true } })))), now: () => clock, failedWaitMs: 30_000, keepListed: true });
      next = "ok";
      const [was] = await signedOut.servers("s", [z]);
      /** @type {any} */ (was.conn).alive = () => false;
      next = "fail";
      assert.deepEqual((await signedOut.servers("s", [z])).map((x) => [x.conn, x.problem]), [[null, "MCP server z: signed out"]]);
      assert.equal((await signedOut.servers("s", [z]))[0].conn, null, "and held back so");
      signedOut.closeAll();
      clock += 30_000;
      next = "ok";
      await pool.servers("s", [z]);
      await new Promise((r) => setImmediate(r));
      const [back] = await pool.servers("s", [z]);
      assert.deepEqual([back.problem, await back.conn?.call("look", {})], [null, "looked"], "answering again, called again");
      // (fails before: yes — the review of c05ca7aee: what a slot last listed was kept for the process's life) Not asked
      // for in longer than a provider keeps a cache, its listing is let go: there is no cache left to hold.
      /** @type {any} */ (back.conn).alive = () => false;
      clock += 3_600_001;
      pool.sweep();
      next = "fail";
      assert.equal((await pool.servers("s", [z]))[0].conn, null, "past the hour: left out, as one never listed");
    } finally {
      pool.closeAll();
    }
  });
});

describe("MCP tools through the loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-mcp-loop-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });
  const create = async (settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()).id;
  };
  const turn = async (id, content, extra = {}) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return { rid: String(r.headers.get("x-filament-request-id")), json: await r.json() };
  };
  // A server whose tools ride every request in full (E49: load core; on demand, the default, is mcp-on-demand.test.js's).
  const NOTES = { name: "notes", command: process.execPath, args: [FIXTURE], load: "core" };

  test("a session's servers ride as mcp__ tools: the read-only one runs, the other asks and the answer runs it; the dead server is left out in words; the second turn keeps the connection", async () => {
    const id = await create({ plugins: { mcp: [NOTES, { name: "broken", command: process.execPath, args: [FIXTURE, "--crash"] }] } });
    let round = 0;
    /** @type {any[]} */
    let results = [];
    brain = (call) => {
      round++;
      if (round === 1) {
        const names = call.body.tools.map((t) => t.name);
        // Every tool on in a new chat (HarnessV4_AgentTools_Plan AT-D1): tasks beside plan, report after the loop's own
        // (a task's fork carries it), the web's and the browser last of the loop's own, the servers' after them.
        // No space tool: the project has no Space made (10-29).
        assert.deepEqual(names.slice(0, 27 + PS.length), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "ask", "plan", "tasks", "agent", "wait", "envelope", "visual_guide", "show_visual", "artifact", "team", "flow", "thread", "report", "web_fetch", "web_search", "browser", "come_back"]);
        assert.deepEqual(names.slice(27 + PS.length), ["mcp__notes__echo", "mcp__notes__write_note", "mcp__notes__slow", "mcp__notes__fail", "mcp__notes__rich", "mcp__notes__odd_name_v2", "skill", "filament_recall"], "the skill tool after them: the Library holds the skill Filament ships (prompt version 54); the recall tool memory adds last");
        assert.ok(sysTextOf(call.body).includes(`${PROMPT.mcp} notes (6 tools).`), String(call.body.system).slice(-400));
        return reply([toolUse("e1", "mcp__notes__echo", { text: "hello" }), toolUse("w1", "mcp__notes__write_note", { name: "from-mcp", text: "written by the server" })], "tool_use");
      }
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Both done." }]);
    };
    up.reset();
    const r1 = await turn(id, "use the notes server");
    assert.match(text(r1.json.content), /May I call mcp__notes__write_note with `\{"name":"from-mcp","text":"written by the server"\}`\? Its server does not vouch for it as read-only/);
    assert.ok(!existsSync(join(root, "from-mcp.txt")), "nothing written while the question waits");
    const rec1 = await shim.record(r1.rid);
    assert.equal(rec1.agent.mcp.length, 2);
    assert.deepEqual({ ...rec1.agent.mcp[0], ms: 0 }, { name: "notes", transport: "stdio", tools: 6, readOnly: 5, load: "core", ms: 0 });
    assert.equal(rec1.agent.mcp[1].name, "broken");
    assert.match(rec1.agent.mcp[1].problem, /MCP server broken exited \(code 3\)/);
    assert.ok(rec1.changes.some((c) => /^agent: MCP server notes offers 6 tools \(stdio, connected in \d+ ms, 5 read-only\) — in full with every request \(load core\)$/.test(c)), rec1.changes.join("\n"));
    assert.ok(rec1.changes.some((c) => /^agent: MCP server broken left out — MCP server broken exited \(code 3\)/.test(c)), rec1.changes.join("\n"));
    assert.ok(rec1.changes.includes("agent: paused for permission to mcp__notes__write_note"), rec1.changes.join("\n"));
    // The answer: the parked call runs, the turn finishes.
    const r2 = await turn(id, "yes", { allow: true });
    assert.match(text(r2.json.content), /Both done\./);
    assert.equal(readFileSync(join(root, "from-mcp.txt"), "utf8"), "written by the server");
    assert.equal(results.length, 2);
    assert.equal(results[0].content, "echo: hello");
    assert.equal(results[1].content, "wrote from-mcp.txt");
    const rec2 = await shim.record(r2.rid);
    assert.ok(rec2.changes.some((c) => /^agent: MCP server notes offers 6 tools \(stdio, kept from an earlier turn, 5 read-only\) — in full with every request \(load core\)$/.test(c)), rec2.changes.join("\n"));
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(r1.rid)}/events?limit=500`)).json()).events || [];
    const e1 = events.find((e) => e.type === "tool-end" && e.name === "mcp__notes__echo");
    assert.ok(e1?.ok, "the echo ran on the first turn");
    assert.equal(events.find((e) => e.type === "tool-start" && e.name === "mcp__notes__echo")?.args, '{"text":"hello"}');
    assert.ok(events.some((e) => e.type === "ask" && e.kind === "permission" && e.tool === "mcp__notes__write_note"));
  });

  // (fails before: yes — the bug hunt of 10-30: the turn said the server offers 100 tools, and nothing of the rest)
  test("a server with more tools than Filament offers: the turn's record names those not offered", async () => {
    const id = await create({ plugins: { mcp: [{ name: "big", command: process.execPath, args: [FIXTURE, "--many", "150"] }] } });
    brain = () => reply([{ type: "text", text: "Looked." }]);
    up.reset();
    const r = await turn(id, "what can the big server do");
    const rec = await shim.record(r.rid);
    const names = Array.from({ length: 20 }, (_, i) => `"tool_${94 + i}"`).join(", ");
    assert.ok(rec.changes.includes(`agent: MCP server big lists more tools than the 100 Filament offers of one server — not offered: ${names}, 36 more`), rec.changes.join("\n"));
  });

  test("a rule lets a non-read-only MCP tool run without asking; under read-only it is refused in words; a tool error is the model's result, not a crash", async () => {
    const id = await create({ plugins: { mcp: [NOTES] }, loop: { rules: [{ tool: "mcp__notes__write_note", pattern: "*", verdict: "allow" }] } });
    let round = 0;
    /** @type {any[]} */
    let results = [];
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("w1", "mcp__notes__write_note", { name: "ruled", text: "ok" }), toolUse("f1", "mcp__notes__fail", {})], "tool_use");
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Ran." }]);
    };
    up.reset();
    const r = await turn(id, "write via rule");
    assert.match(text(r.json.content), /Ran\./);
    assert.equal(readFileSync(join(root, "ruled.txt"), "utf8"), "ok");
    assert.equal(results[0].content, "wrote ruled.txt");
    assert.equal(results[1].is_error, true);
    assert.match(String(results[1].content), /^Error: it broke/);
    const rec = await shim.record(r.rid);
    assert.ok(rec.changes.includes("agent: mcp__notes__write_note ran on the rule mcp__notes__write_note(*) allow"), rec.changes.join("\n"));
    // Read-only: refused before the server hears of it.
    const ro = await create({ plugins: { mcp: [NOTES] }, loop: { permissions: "read-only" } });
    round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("w1", "mcp__notes__write_note", { name: "never", text: "x" }), toolUse("e1", "mcp__notes__echo", { text: "still fine" })], "tool_use");
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Refused." }]);
    };
    const r2 = await turn(ro, "try");
    assert.match(text(r2.json.content), /Refused\./);
    assert.ok(!existsSync(join(root, "never.txt")));
    assert.equal(results[0].is_error, true);
    assert.match(String(results[0].content), /this session is read-only, so mcp__notes__write_note is not available\. Say precisely what you would call/);
    assert.equal(results[1].content, "echo: still fine", "the read-only tool still runs under read-only");
  });

  // (fails before: yes — the request after a change carried nothing, and a model went on naming a server from its earlier turns)
  test("HS-D25: the first turn after a chat's servers change carries a note on its newest message, in that request alone — gone, added, not answering", async () => {
    const id = await create({ plugins: { mcp: [NOTES] } });
    brain = () => reply([{ type: "text", text: "ok" }]);
    /** A turn: the note on the newest message of its first loop request, its tools, and its record. @param {string} content */
    const sent = async (content) => {
      up.reset();
      const r = await turn(id, content);
      const call = up.received.find((c) => c.kind === "anthropic" && Array.isArray(c.body?.tools));
      const last = call?.body.messages.findLast((/** @type {any} */ m) => m.role === "user");
      const blocks = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
      const note = blocks.map((/** @type {any} */ b) => String(b.text || "")).find((/** @type {string} */ t) => t.startsWith("[Filament: the MCP servers")) || null;
      return { note, tools: call?.body.tools.map((/** @type {any} */ t) => t.name), rec: await shim.record(r.rid) };
    };
    /** @param {any[]} mcp */
    const setMcp = async (mcp) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { plugins: { mcp } } } });
      assert.equal(r.status, 200, await r.text());
    };
    const first = await sent("hello");
    assert.equal(first.note, null, "a chat's first turn has nothing to compare with");
    assert.ok(first.tools.includes("mcp__notes__echo"));
    const PAD = { name: "pad", command: process.execPath, args: [FIXTURE], load: "core" };
    await setMcp([PAD]);
    const changed = await sent("which servers now?");
    assert.equal(changed.note, "[Filament: the MCP servers changed since your last turn. Go by the tools you have now, not by earlier turns:\n- notes was switched off or removed: its tools (mcp__notes__…) are gone.\n- pad was added: its tools (mcp__pad__…) are offered from this turn.]");
    assert.ok(changed.rec.changes.includes("agent: the session's MCP servers changed since its last turn (gone: notes; new: pad) — the newest message carries the note in this request alone"), changed.rec.changes.join("\n"));
    assert.ok(!changed.tools.some((/** @type {string} */ t) => t.startsWith("mcp__notes__")) && changed.tools.includes("mcp__pad__echo"));
    assert.equal((await sent("and now?")).note, null, "the note rides the first turn after the change alone");
    await setMcp([{ ...PAD, args: [FIXTURE, "--crash"] }]);
    assert.match(String((await sent("still there?")).note), /^\[Filament: the MCP servers changed since your last turn\. Go by the tools you have now, not by earlier turns:\n- pad did not answer this turn \(MCP server pad exited \(code 3\)[^\n]*\): its tools \(mcp__pad__…\) are not offered now\.\]$/);
  });
});

describe("Filament's stop takes the sessions' MCP servers with it", () => {
  // (fails before: yes — HarnessV3-Readiness RD1 d: the stop fired the pool's closes without waiting, and the server
  // left on its stdin's end before taskkill walked its tree, so what it started outlived Filament in the folder)
  test("when stop resolves, a session's server and the process it started are gone, and their folder can be removed", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "filament-mcp-stop-"));
    const log = join(root, "tree.log");
    const alive = (/** @type {number} */ pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const up = await fakeUpstream(async () => reply([{ type: "text", text: "Hello." }]));
    // Its data folder is removed below, once the stop is over: the stop runs with its caps held (`closedAtItsEnd`).
    const shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    /** @type {{ pid: number, grandchild: number } | null} */
    let pids = null;
    let stopped = false;
    try {
      const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { plugins: { mcp: [{ name: "tree", command: process.execPath, args: [FIXTURE, "--grandchild"], env: { MCP_FIXTURE_LOG: log } }] } } } });
      assert.equal(made.status, 200, await made.clone().text());
      const id = (await made.json()).id;
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
      assert.equal(r.status, 200, await r.text());
      pids = readLog(log).find((x) => x.grandchild) || null;
      assert.ok(pids && alive(pids.pid) && alive(pids.grandchild), `the session's server runs, with the process it started: ${JSON.stringify(pids)}`);
      await closedAtItsEnd(t, () => shim.stop());
      stopped = true;
      assert.equal(alive(pids.pid), false, "the server is gone when Filament's stop resolves");
      if (process.platform === "win32") {
        assert.equal(alive(pids.grandchild), false, "and so is the process it started");
        await removeDirs(root); // EBUSY for as long as a process works in the folder; a hold of Windows' own on a file just written passes
      }
    } finally {
      for (const pid of pids ? [pids.pid, pids.grandchild] : []) if (alive(pid)) process.kill(pid);
      if (!stopped) await shim.stop();
      await up.close();
      await removeDirs(root, shim.dataDir);
    }
  });
});
