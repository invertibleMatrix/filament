// @ts-check
// The resources of the developer's MCP servers (the owner's word of 10-27: "Filament uses their tools but not their
// resources … i will leave this upto you to decide"), as Claude Code reaches them: one tool that only reads, offered
// where a connected server says it has resources — list names what each offers by address, templates too; read gives
// one's content, redacted and cut as a tool's result, an image beside the text. Against test/fixtures/mcp-server.mjs.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpError, connectMcp, createMcpPool } from "../src/adapters/tools/mcp-client.js";
import { MCP_RESOURCES, resourcesAnswer } from "../src/app/agent/mcp-resources.js";
import { MediaResult } from "../src/core/media.js";
import { argSummary, cardRefusals, isLoopTool } from "../src/app/agent/tools.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
const redact = (/** @type {string} */ t) => t.replace(/sk-live-\w+/g, "[redacted]");

describe("the resources tool against a server", () => {
  /** @type {import("../src/adapters/tools/mcp-client.js").McpConnection} */
  let conn;
  /** @type {import("../src/adapters/tools/mcp-client.js").McpConnection} */
  let plain;
  before(async () => {
    conn = await connectMcp({ name: "docs", command: process.execPath, args: [FIXTURE, "--resources"] }, { cwd: tmpdir() });
    plain = await connectMcp({ name: "tools-only", command: process.execPath, args: [FIXTURE] }, { cwd: tmpdir() });
  });
  after(async () => {
    await conn?.close();
    await plain?.close();
  });

  // (fails before: yes — a server's resources were never asked for: only its tools were)
  test("what a server says it has: resources on the one that has them, none on the other", () => {
    assert.equal(conn.resources, true);
    assert.equal(plain.resources, false);
    assert.ok(isLoopTool(MCP_RESOURCES));
  });

  // (fails before: yes)
  test("list names each by address, its name, its type and what it is, and the templates to fill in", async () => {
    const text = String(await resourcesAnswer({ action: "list" }, [{ name: "docs", conn }], { maxBytes: 50_000, redact }));
    assert.equal(
      text,
      [
        "docs (2 resources and 1 template):",
        "- note://readme — The project's readme (text/plain): What the project is.",
        "- img://logo — logo (image/png)",
        "- note://{name} — a note by its name (text/plain) (a template: fill in its {parts})",
      ].join("\n"),
    );
  });

  // (fails before: yes)
  test("read gives the content, redacted as a tool's result; an image beside the text; an address it has not, refused in words", async () => {
    assert.equal(await resourcesAnswer({ action: "read", uri: "note://readme" }, [{ name: "docs", conn }], { maxBytes: 50_000, redact }), "Filament fixture readme\ntoken=[redacted]");
    const img = await resourcesAnswer({ action: "read", uri: "img://logo" }, [{ name: "docs", conn }], { maxBytes: 50_000, redact });
    assert.ok(img instanceof MediaResult, "an image is shown as one");
    assert.equal(img.media.length, 1);
    await assert.rejects(resourcesAnswer({ action: "read", uri: "note://gone" }, [{ name: "docs", conn }], { maxBytes: 50_000, redact }), /^Error: docs could not read note:\/\/gone: no resource note:\/\/gone$/);
    await assert.rejects(resourcesAnswer({ action: "read" }, [{ name: "docs", conn }], { maxBytes: 50_000 }), /read needs uri/);
    await assert.rejects(resourcesAnswer({ action: "read", uri: "x", server: "nope" }, [{ name: "docs", conn }], { maxBytes: 50_000 }), /no MCP server named "nope" offers resources here — docs does/);
    await assert.rejects(resourcesAnswer({ action: "read", uri: "note://readme" }, [{ name: "docs", conn }, { name: "docs2", conn }], { maxBytes: 50_000 }), /name the server the resource is on: docs, docs2 have resources/);
  });
});

describe("through the loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-mcp-res-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });
  /** @param {any} mcp */
  const create = async (mcp) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { plugins: { mcp } } } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()).id;
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  };
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

  // (fails before: yes)
  test("offered where a server has resources, never where none has; a read runs without asking, and its words reach the model", async () => {
    /** @type {string[][]} */
    const offered = [];
    /** @type {any[]} */
    let results = [];
    brain = (call) => {
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "brain-model" });
      offered.push(call.body.tools.map((/** @type {any} */ t) => t.name));
      const said = JSON.stringify(call.body.messages);
      if (said.includes("read the readme") && !said.includes('"tool_use_id":"r1"')) return reply([{ type: "tool_use", id: "r1", name: MCP_RESOURCES, input: { action: "read", uri: "note://readme" } }], "tool_use");
      results = call.body.messages.at(-1).content.filter((/** @type {any} */ c) => c?.type === "tool_result");
      return reply([{ type: "text", text: "Read it." }]);
    };
    const plainId = await create([{ name: "tools", command: process.execPath, args: [FIXTURE], load: "core" }]);
    await turn(plainId, "hello");
    assert.ok(!offered.at(-1)?.includes(MCP_RESOURCES), "no server has resources: the set is the one it always was");

    const id = await create([{ name: "docs", command: process.execPath, args: [FIXTURE, "--resources"] }]);
    const out = await turn(id, "read the readme");
    assert.match(JSON.stringify(out.content), /Read it\./, "nothing asked: it only reads");
    assert.ok(offered.at(-1)?.includes(MCP_RESOURCES));
    assert.equal(results.length, 1);
    assert.match(JSON.stringify(results[0].content), /Filament fixture readme/);
  });
});

// The Hunter's finds of 10-27 (sa_54c9fe4c), each verified against the code before it was fixed.
describe("the resources tool's edges", () => {
  // (fails before: yes — an empty page that named a next one was asked for again and again: the call never ended)
  test("a server that pages without end — empty pages with a cursor, the same cursor again — ends the list, said so", { timeout: 10_000 }, async () => {
    // Each answer waits a turn of the event loop, so a list that never ends fails on the test's clock, not by freezing the run.
    const tick = () => new Promise((r) => setImmediate(r));
    let asked = 0;
    const empty = { request: async (/** @type {string} */ m) => (await tick(), asked++, m === "resources/list" ? { resources: [], nextCursor: "again" } : { resourceTemplates: [] }) };
    assert.equal(await resourcesAnswer({ action: "list" }, [{ name: "odd", conn: /** @type {any} */ (empty) }], { maxBytes: 50_000 }), "odd: it named none, though it says it has more.");
    assert.equal(asked, 1);
    let k = 0;
    const loop = { request: async (/** @type {string} */ m) => (await tick(), m === "resources/list" ? { resources: [{ uri: `r://${k++}` }], nextCursor: "same" } : { resourceTemplates: [] }) };
    assert.equal(await resourcesAnswer({ action: "list" }, [{ name: "loop", conn: /** @type {any} */ (loop) }], { maxBytes: 50_000 }), "loop (the first 2: it has more):\n- r://0\n- r://1");
  });

  // (fails before: yes — a templates list that failed any other way than "method not found" threw the listed resources away)
  test("a templates list that fails leaves the resources listed, and says why; method not found over HTTP is no failure", async () => {
    const failing = (/** @type {Error} */ e) => ({ request: async (/** @type {string} */ m) => { if (m === "resources/list") return { resources: [{ uri: "note://a", name: "a" }] }; throw e; } });
    assert.equal(
      await resourcesAnswer({ action: "list" }, [{ name: "web", conn: /** @type {any} */ (failing(new McpError("web: resources/templates/list: HTTP 500 — broke"))) }], { maxBytes: 50_000 }),
      "web (1 resource):\n- note://a — a\n(its templates could not be listed: web: resources/templates/list: HTTP 500 — broke)",
    );
    assert.equal(await resourcesAnswer({ action: "list" }, [{ name: "web", conn: /** @type {any} */ (failing(new McpError("web: HTTP 404 — Method not found", { code: -32601 }))) }], { maxBytes: 50_000 }), "web (1 resource):\n- note://a — a");
  });

  // (fails before: yes — the list went whole, whatever its size)
  test("a list is cut to the result budget", async () => {
    const many = { request: async (/** @type {string} */ m) => (m === "resources/list" ? { resources: Array.from({ length: 150 }, (_, i) => ({ uri: `doc://${i}`, description: "x".repeat(100) })) } : { resourceTemplates: [] }) };
    const text = String(await resourcesAnswer({ action: "list" }, [{ name: "big", conn: /** @type {any} */ (many) }], { maxBytes: 2000 }));
    assert.ok(Buffer.byteLength(text) <= 2000, String(Buffer.byteLength(text)));
    assert.match(text, /\n… \(the list was cut: name a server to see its own\)$/);
  });

  // (fails before: yes — a stopped read settled Filament's side alone; the server worked on)
  test("a read stopped before it answers tells the server, as a call's stop does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-mcp-res-stop-"));
    const log = join(dir, "log.jsonl");
    const conn = await connectMcp({ name: "docs", command: process.execPath, args: [FIXTURE, "--resources"], env: { MCP_FIXTURE_LOG: log } }, { cwd: dir });
    try {
      const stop = new AbortController();
      const reading = resourcesAnswer({ action: "read", uri: "slow://wait" }, [{ name: "docs", conn }], { maxBytes: 50_000, signal: stop.signal });
      setTimeout(() => stop.abort(), 200);
      await assert.rejects(reading, /docs could not read slow:\/\/wait: the request was cancelled/);
      const said = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
      await until(() => said().some((x) => x.method === "notifications/cancelled"), "the server told of the stop", { timeoutMs: 5000 });
      const read = said().find((x) => x.method === "resources/read");
      assert.equal(said().find((x) => x.method === "notifications/cancelled")?.params?.requestId, read?.id);
    } finally {
      await conn.close();
      await removeDirs(dir);
    }
  });

  // (fails before: yes — the sweep counted a connection's calls alone: a list reading page after page was closed under it)
  test("the pool's sweep never closes a connection in the middle of a request", async () => {
    let clock = 1000;
    /** @type {(v: any) => void} */
    let answer = () => {};
    let alive = true;
    const fakeConnect = async (/** @type {any} */ spec) => ({ name: spec.name, transport: "stdio", serverInfo: null, tools: [], resources: true, alive: () => alive, call: async () => "", request: () => new Promise((r) => (answer = r)), close: async () => void (alive = false) });
    const pool = createMcpPool({ connect: /** @type {any} */ (fakeConnect), idleMs: 5000, now: () => clock });
    try {
      const [s] = await pool.servers("s1", [{ name: "docs", command: "x" }]);
      const asking = /** @type {any} */ (s.conn).request("resources/list", {});
      clock += 60_000;
      pool.sweep();
      assert.equal(alive, true, "a request under way is no idleness");
      answer({ resources: [] });
      await asking;
      clock += 60_000;
      pool.sweep();
      assert.equal(alive, false, "idle once it ended");
    } finally {
      await pool.closeAll?.();
    }
  });

  // (fails before: yes — a fork whose card goes without MCP was told no server offers resources, not that it goes without the tool)
  test("a fork whose card goes without MCP is refused the resources tool in its card's words", () => {
    const r = cardRefusals({ name: "Scout", toolsOff: ["mcp"] }, [{ name: "mcp__docs__search" }, { name: MCP_RESOURCES }, { name: "read" }]);
    assert.deepEqual(Object.keys(r).filter((k) => k.startsWith("mcp")).sort(), ["mcp__docs__search", MCP_RESOURCES].sort());
    assert.match(r[MCP_RESOURCES], /^Not run: Scout goes without this tool/);
    assert.equal(argSummary(MCP_RESOURCES, { action: "read", uri: "note://readme" }), "read note://readme");
  });
});
