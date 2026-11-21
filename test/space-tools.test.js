// @ts-check
// HarnessV4_Space_Plan S4a: a connection's tools in a dashboard. A source may read a tool of an MCP server the project's
// chats have — one its server marks read-only, asked again at each read, its answer's data read into rows — and a
// button may call any of its tools from Filament's sheet, its args filled from the row Filament read, each placeholder a
// whole value. Checked in words (core/dashboard-sources.js); the MCP client's raw call; the Space's tools over a real
// server (app/space-tools.js); the runner reading, pressing and second-looking through them, and what Keep's sheet is
// told of each tool (services/dashboard-runner.js); the page's words (ui/harness/lib/space-dashboards.js); end to end
// through a chat that publishes one and the admin routes.
// (fails before: yes — a source or a button that named a tool was refused: "a dashboard does not run yet")
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_BYTES, ROW_KEY, TOOL_ARGS_BYTES, actionKept, answerTypes, argsAsSchema, fillAction, grantOf, rowsFrom, sameGrant, sourceKept, sourcesOf, textAs, toolData, toolWords } from "../src/core/dashboard-sources.js";
import { lookWords } from "../src/core/second-look.js";
import { connectMcp, createMcpPool } from "../src/adapters/tools/mcp-client.js";
import { createSpaceTools } from "../src/app/space-tools.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { artifactCall, ARTIFACT_GUIDE } from "../src/app/agent/artifacts.js";
import { keepLines, pressWords } from "../src/ui/harness/lib/space-dashboards.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-runs-server.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** A folder of the test's own. @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-tools-${tag}-`));
  made.push(d);
  return d;
};

/** The runs, as a GitHub-like server's tool lists them. */
const RUNS_SOURCE = {
  tool: { connection: "ci", name: "list_runs", args: { branch: "main" } },
  rows: "workflow_runs",
  key: "id",
  order: "-when",
  every: "2m",
  columns: { when: "created_at", run: "run_number", commit: "head_commit.message", status: "conclusion" },
};
/** Re-run failed jobs…, a tool's button on a red run. */
const RERUN = {
  label: "Re-run failed jobs…",
  on: "runs",
  only: { status: "failure" },
  tool: { connection: "ci", name: "rerun", args: { run_id: "{row.key}", note: "{ask.why}" } },
  check: { "row.key": "^[0-9]+$" },
  ask: [{ name: "why", label: "Why" }],
  says: "Re-run the failed jobs of run {row.run}? They start at once.",
  secondLook: true,
};
/** What a GitHub-like server's rerun takes. */
const RERUN_SCHEMA = { type: "object", required: ["run_id"], properties: { run_id: { type: "number" }, note: { type: "string" } } };
/** The dashboard an agent publishes. */
const CI = {
  tiles: [
    { kind: "status", title: "CI on main", from: "runs", field: "status", bad: { status: "failure" }, good: { status: "success" } },
    { kind: "table", title: "Runs", from: "runs", columns: ["when", "run", "commit", "status"], actions: ["rerun"] },
  ],
  tables: { runs: [{ when: "2026-10-24T13:46:00Z", run: 412, commit: "Fix login redirect", status: "failure" }] },
  sources: { runs: RUNS_SOURCE },
  actions: { rerun: RERUN },
};
/** What the fixture's list_runs says, as data. */
const RUNS = [
  { id: 8812, run_number: 412, head_branch: "main", head_commit: { message: "Fix login redirect" }, conclusion: "failure", created_at: "2026-10-24T13:46:00Z" },
  { id: 8807, run_number: 411, head_branch: "main", head_commit: { message: "Add PLAY-88 retry" }, conclusion: "success", created_at: "2026-10-24T12:00:00Z" },
];

describe("a connection's tool as a source or a button, checked", () => {
  test("a source names a tool: kept as given, its grant the call; each wrong part refused in words that name it", () => {
    assert.equal(sourcesOf({ sources: { runs: RUNS_SOURCE } }).ok, true);
    const k = sourceKept(RUNS_SOURCE);
    assert.deepEqual([k.tool, k.command], [{ connection: "ci", name: "list_runs", args: { branch: "main" } }, []]);
    const err = (/** @type {any} */ s) => {
      const r = sourcesOf({ sources: { runs: s } });
      return r.ok ? "" : r.error;
    };
    assert.equal(err({ ...RUNS_SOURCE, command: ["gh", "run", "list"] }), "the source runs has a command and a tool: a source reads one of them");
    assert.match(err({ ...RUNS_SOURCE, tool: { name: "list_runs" } }), /^the source runs has a tool with no connection: the name of an MCP server the project's chats have/);
    assert.match(err({ ...RUNS_SOURCE, tool: { connection: "ci" } }), /^the source runs has a tool with no name/);
    assert.match(err({ ...RUNS_SOURCE, tool: { connection: "ci", name: "x", args: [1] } }), /whose args are no object/);
    assert.match(err({ ...RUNS_SOURCE, tool: { connection: "ci", name: "x", args: { q: "x".repeat(TOOL_ARGS_BYTES) } } }), /whose args weigh more than 10 KB$/);
    assert.equal(err({ tool: RUNS_SOURCE.tool, fields: ["a", "b"] }), "the source runs reads a tool, whose answer is data: give rows and columns, not fields");
    assert.match(err({ every: "2m" }), /has no command: .* or a tool of a connection, a fetch, a folder, filament or python$/);
    // The grant: the call and how often; a command's stays as it was.
    const both = { runs: RUNS_SOURCE, deploys: { command: ["npx", "wrangler", "deployments", "list"], every: "2m" } };
    const g = grantOf({ sources: both });
    assert.deepEqual(g.sources, { runs: { tool: RUNS_SOURCE.tool, every: 120_000 }, deploys: { command: ["npx", "wrangler", "deployments", "list"], every: 120_000 } });
    const other = (/** @type {any} */ runs) => grantOf({ sources: { ...both, runs } });
    assert.equal(sameGrant(g, other({ ...RUNS_SOURCE, tool: { ...RUNS_SOURCE.tool, args: { branch: "dev" } } })), false, "another arg: a draft again");
    assert.equal(sameGrant(g, other({ ...RUNS_SOURCE, tool: { ...RUNS_SOURCE.tool, connection: "gh" } })), false, "another connection: a draft again");
    assert.equal(sameGrant(g, other({ ...RUNS_SOURCE, columns: { ...RUNS_SOURCE.columns, took: "run_duration_ms" } })), true, "a column's path is layout: live at once");
  });

  test("a button's tool: each placeholder a whole value of its args, however deep; checks name what its args use; its grant holds the call", () => {
    const err = (/** @type {any} */ a) => {
      const r = sourcesOf({ sources: { runs: RUNS_SOURCE }, actions: { rerun: a } });
      return r.ok ? "" : r.error;
    };
    assert.equal(err(RERUN), "");
    assert.equal(err({ ...RERUN, tool: { ...RERUN.tool, args: { deep: [{ id: "{row.key}" }], note: "{ask.why}" } } }), "");
    assert.equal(err({ ...RERUN, command: ["gh", "run", "rerun"] }), "the button rerun has a command and a tool: a button runs one of them");
    assert.equal(
      err({ ...RERUN, tool: { ...RERUN.tool, args: { run_id: "run {row.key}" } } }),
      'the button rerun has "run {row.key}" in its tool\'s args: a placeholder fills a whole value, {row.<column>}, {row.key} or {ask.<field>} alone',
    );
    assert.equal(err({ ...RERUN, tool: { ...RERUN.tool, args: { n: "{row.nope}" } }, check: {} }), "the button rerun has {row.nope}, a column runs does not have (when, run, commit, status)");
    assert.equal(err({ ...RERUN, tool: { ...RERUN.tool, args: { deep: [{ x: "{ask.who}" }] } }, check: {} }), "the button rerun has {ask.who}, a field its ask does not have (why)");
    assert.equal(err({ ...RERUN, check: { "row.run": "^\\d+$" } }), "the button rerun checks row.run, which its tool's args do not use (row.key, ask.why)");
    const kept = actionKept(RERUN);
    assert.deepEqual([kept.command, kept.tool], [[], RERUN.tool]);
    assert.deepEqual(grantOf({ sources: { runs: RUNS_SOURCE }, actions: { rerun: RERUN } }).actions.rerun, {
      on: "runs",
      only: { status: "failure" },
      except: null,
      tool: RERUN.tool,
      check: { "row.key": "^[0-9]+$" },
      ask: [{ name: "why", choices: null, from: null }],
      secondLook: true,
    });
  });

  test("a press fills its args from the row Filament read: a number stays a number, a field its words; a check holds; a value may start with “-”", () => {
    const a = actionKept({ ...RERUN, tool: { ...RERUN.tool, args: { run_id: "{row.key}", number: "{row.run}", note: "{ask.why}", repo: "app" } } });
    const row = { run: 412, status: "failure", [ROW_KEY]: "8812" };
    assert.deepEqual(fillAction(a, row, { why: "-flaky" }), { ok: true, argv: [], args: { run_id: "8812", number: 412, note: "-flaky", repo: "app" } });
    assert.deepEqual(fillAction(a, row, {}, () => [], { rowOnly: true }), { ok: true, argv: [], args: { run_id: "8812", number: 412, note: "{ask.why}", repo: "app" } }, "as the sheet opens, a field stays its placeholder");
    assert.deepEqual(fillAction(a, { ...row, [ROW_KEY]: "x1" }, {}), { ok: false, error: "{row.key} is “x1”, which does not match its check ^[0-9]+$" });
    assert.deepEqual(fillAction(a, { status: "failure", [ROW_KEY]: "8812" }, {}), { ok: false, error: "the row has no run" });
  });

  test("a tool's args go as its schema takes them: a key or an answer that reads as a number goes as one; a number where it takes text, its text; an empty answer it does not need, left out", () => {
    const schema = {
      type: "object",
      required: ["run_id"],
      properties: { run_id: { type: "integer" }, ratio: { type: "number" }, force: { type: "boolean" }, ref: { type: "string" }, either: { type: ["string", "number"] }, pr: { type: "object", properties: { n: { type: "integer" } } }, ids: { type: "array", items: { type: "integer" } }, limit: { type: "integer" } },
    };
    const args = { run_id: "8812", ratio: "0.5", force: "true", ref: 412, either: "7", pr: { n: "3" }, ids: ["1", "2"], limit: "", free: "9" };
    assert.deepEqual(argsAsSchema(args, schema), { run_id: 8812, ratio: 0.5, force: true, ref: "412", either: "7", pr: { n: 3 }, ids: [1, 2], free: "9" });
    assert.deepEqual(argsAsSchema({ run_id: "" }, schema), { run_id: "" }, "a needed one goes, and the server says why not");
    assert.deepEqual(argsAsSchema({ run_id: "x12", ratio: "1e3", force: "yes" }, schema), { run_id: "x12", ratio: 1000, force: "yes" }, "what reads as no number goes as it is");
    assert.deepEqual(argsAsSchema(args, null), args, "no schema: as filled");
    assert.deepEqual([textAs(" 42 ", ["integer"]), textAs("4.2", ["integer"]), textAs("4.2", ["integer", "number"]), textAs("99999999999999999999", ["integer"]), textAs("0x10", ["number"]), textAs("1", ["string"])], [42, "4.2", 4.2, "99999999999999999999", "0x10", "1"]);
    assert.deepEqual(answerTypes({ run_id: "{row.key}", n: "{ask.n}", why: "{ask.why}", deep: { f: "{ask.f}" }, many: ["{ask.m}"] }, { type: "object", properties: { n: { type: "integer" }, why: { type: "string" }, deep: { type: "object", properties: { f: { type: "boolean" } } }, many: { type: "array", items: { type: "number" } } } }), { n: ["integer"], f: ["boolean"], m: ["number"] });
    assert.deepEqual(answerTypes({ n: "{ask.n}" }, null), {});
  });

  test("a tool's answer as a source reads it: its structured content, else its first text as JSON; words, its error, nothing, too much — each said", () => {
    const out = toolData({ content: [{ type: "text", text: "2 runs" }], structuredContent: { workflow_runs: RUNS } });
    assert.deepEqual(out, { ok: true, out: JSON.stringify({ workflow_runs: RUNS }) });
    const rows = rowsFrom(/** @type {any} */ (out).out, sourceKept(RUNS_SOURCE));
    assert.deepEqual(/** @type {any} */ (rows).rows.map((/** @type {any} */ r) => [r.run, r.status, r[ROW_KEY]]), [[412, "failure", "8812"], [411, "success", "8807"]]);
    assert.deepEqual(toolData({ content: [{ type: "text", text: "[1,2]" }] }), { ok: true, out: "[1,2]" });
    assert.deepEqual(toolData({ content: [{ type: "text", text: "Here are your runs." }] }), { ok: false, error: "the tool answered words, not data: “Here are your runs.”" });
    assert.deepEqual(toolData({ content: [{ type: "text", text: "the API said 502" }], isError: true }), { ok: false, error: "the tool said it failed: the API said 502" });
    assert.deepEqual(toolData({ content: [] }), { ok: false, error: "the tool answered no data" });
    assert.deepEqual(toolData({ structuredContent: { s: "x".repeat(COMMAND_BYTES) } }), { ok: false, error: "the tool said more than 1 MB" });
    // Weighed in UTF-8 bytes, as a command's output: fewer characters than the most, more bytes.
    // (fails before: yes — found by the Hunter on S4a: counted in characters)
    assert.deepEqual(toolData({ structuredContent: { s: "é".repeat(COMMAND_BYTES / 2 + 16) } }), { ok: false, error: "the tool said more than 1 MB" });
    assert.equal(toolData({ structuredContent: { s: "é".repeat(COMMAND_BYTES / 2 - 16) } }).ok, true);
    assert.equal(toolWords({ connection: "ci", name: "list_runs", args: {} }), "ci › list_runs");
    assert.equal(toolWords(RERUN.tool, { run_id: "8812" }), 'ci › rerun {"run_id":"8812"}');
  });

  test("the guide tells the agent: a tool in place of a command, called first in its chat, read-only for a source; a button's placeholders whole values", () => {
    assert.match(ARTIFACT_GUIDE.dashboard, /`tool` in place of `command`: a connection's tool, `\{"connection":"github"/);
    assert.match(ARTIFACT_GUIDE.dashboard, /Its server must mark it read-only: Filament asks at each read/);
    assert.match(ARTIFACT_GUIDE.dashboard, /a placeholder is a whole value of `args`, never inside one; Filament sends each value as the tool's schema takes it/);
    assert.match(ARTIFACT_GUIDE.dashboard, /Run each command or script, call each tool, fetch each address, once yourself first/);
  });

  test("the Skeptic is told it is a tool's call, through which server", () => {
    const words = lookWords({ command: 'ci › rerun {"run_id":"8812"}', tool: "ci", folder: "/work/app", why: "the button asks" });
    assert.match(words, /^The command: ci › rerun \{"run_id":"8812"\}$/m);
    assert.match(words, /^It calls a tool of the MCP server ci, which this project's chats have: the server, then the tool's name, then its args as JSON\. The project's folder: \/work\/app$/m);
    assert.doesNotMatch(words, /^Where it runs:/m);
  });
});

describe("the MCP client's raw call", () => {
  test("the result as the server sent it — its data, its error unthrown; the text call as ever", async () => {
    const conn = await connectMcp({ name: "ci", command: process.execPath, args: [FIXTURE] }, { cwd: fresh("raw") });
    try {
      const r = await conn.call("list_runs", {}, { raw: true });
      assert.deepEqual(r.structuredContent.workflow_runs.map((/** @type {any} */ x) => x.id), [8812, 8807]);
      const broken = await conn.call("broken", {}, { raw: true });
      assert.deepEqual([broken.isError, broken.content[0].text], [true, "the API said 502"]);
      await assert.rejects(conn.call("broken", {}), /the API said 502/);
      assert.equal(await conn.call("list_runs", {}), "2 runs", "the text call reads its words");
    } finally {
      await conn.close();
    }
  });

  // A dashboard's button has no clock: a call past the pool's idle time is no idleness.
  // (fails before: yes — found by the Hunter on S4a: the sweep closed a connection in the middle of a call)
  test("the pool: a connection at work is never closed as idle; once its calls end, its idle time starts", async () => {
    const clock = { at: 0 };
    let closed = 0;
    /** @type {(v: any) => void} */
    let release = () => {};
    const conn = { name: "ci", tools: [], transport: "stdio", serverInfo: null, dropped: [], alive: () => true, call: () => new Promise((r) => (release = r)), close: async () => void closed++ };
    const pool = createMcpPool({ idleMs: 1000, now: () => clock.at, connect: async () => /** @type {any} */ (conn) });
    try {
      const [r] = await pool.servers("space:p1:ci", [/** @type {any} */ ({ name: "ci", command: "x" })]);
      const calling = /** @type {any} */ (r.conn).call("hold", {});
      clock.at += 5000;
      pool.sweep();
      assert.deepEqual([closed, pool.size()], [0, 1], "at work: kept");
      release("held");
      assert.equal(await calling, "held");
      clock.at += 500;
      pool.sweep();
      assert.equal(closed, 0, "its idle time starts at the last sweep it was at work");
      clock.at += 1000;
      pool.sweep();
      assert.deepEqual([closed, pool.size()], [1, 0], "idle: closed");
    } finally {
      await pool.closeAll();
    }
  });
});

describe("the Space's tools, over a real server", () => {
  const cwd = fresh("tools");
  const log = join(cwd, "calls.log");
  writeFileSync(log, "");
  const spec = { name: "ci", command: process.execPath, args: [FIXTURE], env: { MCP_FIXTURE_LOG: log } };
  /** @type {Record<string, any>} */
  const servers = { ci: { ok: true, spec, cwd }, off: { ok: false, error: "off is switched off for this project (Library › Plugins & Connectors)" } };
  const tools = createSpaceTools({ serverFor: (p, n) => (p === "p1" && servers[n]) || { ok: false, error: `${n} is no MCP server of this project's chats (Library › Plugins & Connectors, for all chats or this project)` } });
  after(() => tools.close());
  const called = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  test("read: a tool its server marks read-only, called with its args — its data; one that is not, none, words, an error: refused, and nothing that acts is called", async () => {
    const read = await tools.read("p1", { connection: "ci", name: "list_runs", args: { branch: "main" } });
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.deepEqual(JSON.parse(/** @type {any} */ (read).out).workflow_runs.map((/** @type {any} */ r) => r.id), [8812, 8807]);
    assert.deepEqual(await tools.read("p1", { connection: "ci", name: "rerun", args: {} }), { ok: false, error: "ci does not say rerun only reads: a source only reads, so it is not called" });
    assert.deepEqual(await tools.read("p1", { connection: "ci", name: "nope", args: {} }), { ok: false, error: "ci has no tool nope" });
    assert.deepEqual(await tools.read("p1", { connection: "off", name: "list_runs", args: {} }), { ok: false, error: "off is switched off for this project (Library › Plugins & Connectors)" });
    assert.deepEqual(await tools.read("p2", { connection: "ci", name: "list_runs", args: {} }), { ok: false, error: "ci is no MCP server of this project's chats (Library › Plugins & Connectors, for all chats or this project)" });
    assert.deepEqual(await tools.read("p1", { connection: "ci", name: "chatter", args: {} }), { ok: false, error: "the tool answered words, not data: “Here are your runs: two of them, one red.”" });
    assert.deepEqual(await tools.read("p1", { connection: "ci", name: "broken", args: {} }), { ok: false, error: "the tool said it failed: the API said 502" });
    assert.deepEqual(called().map((c) => c.tool), ["list_runs", "chatter", "broken"], "rerun was never called to read");
    assert.deepEqual(called()[0].args, { branch: "main" });
    // Asked again at each read: once the server stops saying list_runs only reads, the pooled connection reads it no
    // more; once it says so again, it reads.
    // (fails before: yes — found by the Hunter on S4a: the list was the one read as it connected)
    writeFileSync(join(cwd, "list_runs.acts"), "");
    try {
      assert.deepEqual(await tools.read("p1", { connection: "ci", name: "list_runs", args: {} }), { ok: false, error: "ci does not say list_runs only reads: a source only reads, so it is not called" });
    } finally {
      rmSync(join(cwd, "list_runs.acts"));
    }
    assert.equal((await tools.read("p1", { connection: "ci", name: "list_runs", args: {} })).ok, true);
    assert.equal(called().filter((c) => c.tool === "list_runs").length, 2, "never called while it did not say it only reads");
    // Its args go as its schema takes them, as a button's do: list_runs takes its branch as text.
    // (fails before: yes — the Hunter on S4a: a source's args went as published)
    await tools.read("p1", { connection: "ci", name: "list_runs", args: { branch: 7 } });
    assert.deepEqual(called().at(-1), { tool: "list_runs", args: { branch: "7" } });
    // Stopped — its dashboard paused —: the server is told to cancel the call; stopped before, nothing is called.
    // (fails before: yes — found by the Hunter on S4a: a source's call ran on to its 60 s)
    const ctl = new AbortController();
    const held = tools.read("p1", { connection: "ci", name: "list_runs", args: { ms: 60_000 } }, ctl.signal);
    await until(() => called().at(-1)?.args?.ms === 60_000, "the call to be made");
    ctl.abort();
    assert.deepEqual(await held, { ok: false, error: "the read was stopped" });
    await until(() => called().some((c) => "cancelled" in c), "the server told");
    const count = called().length;
    assert.deepEqual(await tools.read("p1", { connection: "ci", name: "list_runs", args: {} }, AbortSignal.abort()), { ok: false, error: "the read was stopped" });
    assert.equal(called().length, count, "nothing called");
  });

  test("act: any tool of the server, its args as filled, no clock; Stop cancels its call; check: each tool's word, a source's must only read", async () => {
    assert.deepEqual(await tools.act("p1", { connection: "ci", name: "rerun", args: {} }, { run_id: 8812 }), { ok: true, said: "Queued run 412 again.\nIts failed jobs re-run.", args: { run_id: 8812 } });
    assert.deepEqual(called().at(-1), { tool: "rerun", args: { run_id: 8812 } });
    // A row's key is text: it goes as the number the tool's schema takes, and a strict server takes it.
    assert.deepEqual(await tools.act("p1", { connection: "ci", name: "rerun", args: {} }, { run_id: "8812" }), { ok: true, said: "Queued run 412 again.\nIts failed jobs re-run.", args: { run_id: 8812 } });
    assert.deepEqual(called().at(-1), { tool: "rerun", args: { run_id: 8812 } });
    assert.deepEqual(await tools.act("p1", { connection: "ci", name: "rerun", args: {} }, { run_id: "x12" }), { ok: false, error: 'run_id must be a number, not "x12"', said: "", args: { run_id: "x12" } }, "what reads as no number goes as it is; the server says why not");
    assert.deepEqual(await tools.schema("p1", { connection: "ci", name: "rerun", args: {} }), { type: "object", required: ["run_id"], properties: { run_id: { type: "number" } } });
    assert.deepEqual([await tools.schema("p1", { connection: "ci", name: "nope", args: {} }), await tools.schema("p1", { connection: "off", name: "rerun", args: {} })], [null, null]);
    // The log is the read test's too, its stopped read's cancellation in it.
    const cancels = () => called().filter((c) => "cancelled" in c).length;
    const cancelled = cancels();
    const ctl = new AbortController();
    const held = tools.act("p1", { connection: "ci", name: "hold", args: {} }, { ms: 60_000 }, ctl.signal);
    await until(() => called().at(-1)?.tool === "hold", "the call to be made");
    ctl.abort();
    assert.deepEqual(await held, { ok: false, error: "you stopped it", said: "", args: { ms: 60_000 }, sent: true });
    // The server is told, as MCP has it: one that heeds it stops the tool's work.
    // (fails before: yes — found by the Hunter on S4a: Stop only let the wait go, and the server went on)
    await until(() => cancels() > cancelled, "the server told");
    // Stopped before the call went out — its server still connecting —: nothing is called.
    // (fails before: yes — found by the Hunter on S4a: an aborted signal was never heard, so the call ran on)
    const before = called().length;
    assert.deepEqual(await tools.act("p1", { connection: "ci", name: "rerun", args: {} }, { run_id: 8812 }, AbortSignal.abort()), { ok: false, error: "you stopped it", said: "", sent: false });
    assert.equal(called().length, before, "rerun was not called");
    assert.deepEqual(await tools.act("p1", { connection: "ci", name: "nope", args: {} }, {}), { ok: false, error: "ci has no tool nope", said: "" });
    // A press hears the server's list of now, its connection pooled: a tool it no longer lists is not called.
    // (fails before: yes — found by the Hunter on S4a: a press went by the list read as it connected, its schema too)
    writeFileSync(join(cwd, "rerun.gone"), "");
    try {
      const was = called().length;
      assert.deepEqual(await tools.act("p1", { connection: "ci", name: "rerun", args: {} }, { run_id: 8812 }), { ok: false, error: "ci has no tool rerun", said: "" });
      assert.equal(called().length, was, "rerun was not called");
    } finally {
      rmSync(join(cwd, "rerun.gone"));
    }
    assert.deepEqual(
      await tools.check("p1", [
        { connection: "ci", name: "list_runs", reads: true },
        { connection: "ci", name: "rerun", reads: true },
        { connection: "ci", name: "rerun", reads: false },
        { connection: "ci", name: "nope", reads: false },
        { connection: "off", name: "list_runs", reads: true },
      ]),
      [
        { connection: "ci", name: "list_runs", reads: true, ok: true, words: "only reads, its server says" },
        { connection: "ci", name: "rerun", reads: true, ok: false, words: "ci does not say it only reads: it will not be read" },
        { connection: "ci", name: "rerun", reads: false, ok: true, words: "acts: Filament calls it only from its sheet, when you press Run" },
        { connection: "ci", name: "nope", reads: false, ok: false, words: "ci has no tool nope" },
        { connection: "off", name: "list_runs", reads: true, ok: false, words: "off is switched off for this project (Library › Plugins & Connectors)" },
      ],
    );
    // Keep's sheet hears the server's word of now, its connection pooled: one that no longer says list_runs only reads.
    // (fails before: yes — found by the Hunter on S4a: the sheet said "only reads" from the list read as it connected)
    writeFileSync(join(cwd, "list_runs.acts"), "");
    try {
      assert.deepEqual(await tools.check("p1", [{ connection: "ci", name: "list_runs", reads: true }]), [
        { connection: "ci", name: "list_runs", reads: true, ok: false, words: "ci does not say it only reads: it will not be read" },
      ]);
    } finally {
      rmSync(join(cwd, "list_runs.acts"));
    }
  });
});

/** A runner over stand-ins: the Space's tools answer by the tool's name. @param {{ four?: () => string }} [o]  each new artifact's four */
function world(o = {}) {
  const clock = { at: Date.UTC(2026, 9, 24, 14, 0) };
  const now = () => clock.at;
  const artifacts = createArtifactStore({ dataDir: fresh("art"), log: () => {}, now, four: o.four || (() => "ab12") });
  const spaces = createSpaceStore({ dir: null, now, events: { publish: () => {} } });
  /** @type {any[]} */
  const calls = [];
  /** @type {Record<string, import("../src/core/dashboard-sources.js").CommandOut>} */
  const answers = { list_runs: { ok: true, out: JSON.stringify({ workflow_runs: RUNS }) } };
  /** @type {any[]} */
  const looks = [];
  /** @type {import("../src/services/dashboard-runner.js").ToolDoor} */
  const tools = {
    read: async (p, t) => (calls.push(["read", p, t]), answers[t.name] || { ok: false, error: `${t.connection} has no tool ${t.name}` }),
    act: async (p, t, args) => (calls.push(["act", p, t.name, args]), { ok: true, said: "Queued run 412 again.\nIts failed jobs re-run.", args: /** @type {any} */ (argsAsSchema(args, RERUN_SCHEMA)) }),
    check: async (_p, list) => list.map((x) => ({ ...x, ok: !x.reads || x.name === "list_runs", words: x.reads ? "only reads, its server says" : "acts" })),
    schema: async (_p, t) => (t.name === "rerun" ? RERUN_SCHEMA : null),
  };
  const base = { spaces, artifacts, folderOf: (/** @type {string} */ p) => (p === "p1" ? "/work/app" : null), projectOfChain: (/** @type {string} */ c) => (c.startsWith("c") ? "p1" : null), now, run: async () => ({ ok: /** @type {const} */ (false), error: "no command runs here" }) };
  const runner = createDashboardRunner({ ...base, tools, startLook: (o) => (looks.push(o), { ok: true, chain: o.chainId, agent: "sa-1" }) });
  const bare = createDashboardRunner(base);
  /** @param {any} input */
  const publish = (input) => {
    const r = artifactCall({ action: "publish", ...input }, { who: "c1", by: { chain: "c1", model: "m-1", folder: "/work/app", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 }, artifacts);
    assert.ok(r.ok, r.ok ? "" : r.error);
  };
  return { clock, spaces, runner, bare, calls, looks, answers, publish, base, tools };
}

describe("the runner, through a connection's tools", () => {
  test("a kept tool source reads through the project's server; a tool's button: its sheet, its run, a line in What happened, its second look told the call; Keep's sheet told each tool", async () => {
    const w = world();
    w.publish({ type: "dashboard", title: "CI", ...CI });
    const name = "ci-ab12";
    assert.deepEqual(await w.runner.toolsOf("p1", name), {
      ok: true,
      tools: [
        { connection: "ci", name: "list_runs", reads: true, ok: true, words: "only reads, its server says", of: "source:runs" },
        { connection: "ci", name: "rerun", reads: false, ok: true, words: "acts", of: "action:rerun" },
      ],
    }, "asked as a draft's Keep sheet opens; nothing is called");
    assert.deepEqual(w.calls, []);
    assert.deepEqual(await w.runner.toolsOf("p1", "nope-zz99"), { ok: false, status: 404, error: "nope-zz99 is no dashboard of this Space" });
    assert.equal(w.runner.keep("p1", name, 1).ok, true);
    const r = await w.runner.read(name, 1, "runs");
    assert.deepEqual(r.ok && r.state.rows.map((x) => [x.run, x.status]), [[412, "failure"], [411, "success"]]);
    assert.deepEqual(w.calls, [["read", "p1", RUNS_SOURCE.tool]], "the call kept, for its project");
    const sheet = /** @type {any} */ (await w.runner.sheet("p1", name, "rerun", "8812"));
    assert.deepEqual([sheet.ok, sheet.command, sheet.tool, sheet.says], [true, [], { connection: "ci", name: "rerun", args: { run_id: 8812, note: "{ask.why}" }, asks: {} }, "Re-run the failed jobs of run 412? They start at once."], "the row's key as the number the tool takes");
    assert.deepEqual(await w.runner.sheet("p1", name, "rerun", "8807"), { ok: false, status: 409, error: "Re-run failed jobs… is not on that row" });
    const look = await w.runner.lookAt("p1", name, "rerun", "8812", "brain-skeptic");
    assert.equal(look.ok, true);
    assert.deepEqual([w.looks[0].about.command, w.looks[0].about.tool, w.looks[0].chainId, w.looks[0].model], ['ci › rerun {"run_id":8812,"note":"{ask.why}"}', "ci", "c1", "brain-skeptic"], "told the call as the sheet shows it, on the model the person chose");
    const ran = /** @type {any} */ (await w.runner.act("p1", name, "rerun", "8812", { why: "flaky" }));
    assert.equal(w.runner.jobOf(name, ran.job)?.action, "rerun", "its run, by its id");
    assert.deepEqual(ran, { ok: true, done: true, said: "Its failed jobs re-run.", output: "Queued run 412 again.\nIts failed jobs re-run.", ran: 'ci › rerun {"run_id":8812,"note":"flaky"}', error: null, outcome: "Its failed jobs re-run.", argv: [], job: ran.job, args: { run_id: 8812, note: "flaky" } }, "the args the tool was sent");
    assert.deepEqual(w.calls.at(-2), ["act", "p1", "rerun", { run_id: "8812", note: "flaky" }]);
    assert.deepEqual(w.calls.at(-1), ["read", "p1", RUNS_SOURCE.tool], "its source read again");
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, 'You ran “Re-run failed jobs…” on CI: ci › rerun {"run_id":8812,"note":"flaky"} — Its failed jobs re-run.');
  });

  // Found by the Hunter on S4a, each.
  test("What it may do asks of the kept tools, not a draft's beside them; a tool's button stopped says what its Stop did", async () => {
    const w = world();
    w.publish({ type: "dashboard", title: "CI", ...CI });
    const name = "ci-ab12";
    assert.equal(w.runner.keep("p1", name, 1).ok, true);
    // v2 reads list_text in place of list_runs: a draft beside the kept v1.
    w.publish({ id: name, ...CI, sources: { ...CI.sources, runs: { ...CI.sources.runs, tool: { ...CI.sources.runs.tool, name: "list_text" } } } });
    const names = async (/** @type {boolean} */ kept) => (/** @type {any} */ (await w.runner.toolsOf("p1", name, { kept }))).tools.map((/** @type {any} */ t) => `${t.of} ${t.name}`);
    // (fails before: yes — What it may do asked of v2's tools under v1's lines)
    assert.deepEqual(await names(true), ["source:runs list_runs", "action:rerun rerun"], "what runs now");
    assert.deepEqual(await names(false), ["source:runs list_text", "action:rerun rerun"], "Keep… of the draft");
    // A button's tool stopped: what its Stop did, in What happened and in the sheet's words.
    // (fails before: yes — it said "you stopped it" though the server went on)
    const stopped = (/** @type {boolean} */ sent) => createDashboardRunner({ ...w.base, tools: { ...w.tools, act: async () => ({ ok: false, error: "you stopped it", said: "", sent }) } });
    const one = stopped(true);
    await one.read(name, 1, "runs");
    const r = /** @type {any} */ (await one.act("p1", name, "rerun", "8812", { why: "flaky" }));
    assert.equal(r.outcome, "you stopped it; ci was told to cancel the call, and what it did before that stays done");
    assert.match(String(w.spaces.get("p1").log.at(-1)?.text), /— you stopped it; ci was told to cancel the call, and what it did before that stays done$/);
    const two = stopped(false);
    await two.read(name, 1, "runs");
    assert.equal((/** @type {any} */ (await two.act("p1", name, "rerun", "8812", { why: "flaky" }))).outcome, "you stopped it before it was called");
  });

  // (fails before: yes — found by the Hunter on S4a: a tool's read was given no stop, so Pause let its call run on)
  test("Pause stops a tool source's read under way: its call is told, and what it read is let be", async () => {
    const w = world();
    /** @type {AbortSignal[]} */
    const signals = [];
    const runner = createDashboardRunner({
      ...w.base,
      tools: {
        ...w.tools,
        read: (_p, _t, signal) =>
          new Promise((resolve) => {
            if (signal) signals.push(signal);
            signal?.addEventListener("abort", () => resolve({ ok: false, error: "the read was stopped" }), { once: true });
          }),
      },
    });
    w.publish({ type: "dashboard", title: "CI", ...CI });
    assert.equal(runner.keep("p1", "ci-ab12", 1).ok, true);
    const reading = runner.read("ci-ab12", 1, "runs");
    await until(() => signals.length === 1, "the read under way");
    runner.change("p1", "ci-ab12", { paused: true });
    assert.equal(signals[0].aborted, true, "its stop heard");
    const r = await reading;
    assert.deepEqual(r.ok && [r.state.error, r.state.fails], [null, 0], "no failure: what it read is let be");
  });

  // (fails before: yes — found reviewing the Space work: Filament's own wiring of the runner's tools dropped the stop,
  // so Pause let a tool source's read run on to its 60 s in the app though the runner heard it)
  test("Filament hands a tool source's stop on to the connection's read (pinned in the source)", () => {
    const server = readFileSync(fileURLToPath(new URL("../src/server.js", import.meta.url)), "utf8");
    assert.match(server, /read: \(project, tool, signal\) => spaceToolsNow\(\)\.read\(project, tool, signal\),/);
  });

  test("Keep's line in What happened says what it runs and what it calls", () => {
    const w = world();
    const deploys = { command: ["gh", "run", "list"], columns: { when: "createdAt" } };
    w.publish({ type: "dashboard", title: "CI", ...CI, tiles: [...CI.tiles, { kind: "table", title: "Deploys", from: "deploys", columns: ["when"] }], tables: { ...CI.tables, deploys: [{ when: "2026-10-24T13:00:00Z" }] }, sources: { ...CI.sources, deploys } });
    assert.equal(w.runner.keep("p1", "ci-ab12", 1).ok, true);
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "You kept “CI” in this Space: it runs 1 command and calls 1 tool by itself, and 1 button when you press it.");
  });

  // HarnessV4_Space_Plan S4b: what the Space's Connections sheet says of each connection, and of the programs.
  // (fails before: yes — nothing said what in a Space used a connection)
  test("what a project's kept dashboards reach out through: each connection by dashboard — its sources, its buttons' labels —, each program, the folder", () => {
    const w = world();
    const deploys = { command: ["gh", "run", "list"], columns: { when: "createdAt" } };
    w.publish({ type: "dashboard", title: "CI", ...CI, tiles: [...CI.tiles, { kind: "table", title: "Deploys", from: "deploys", columns: ["when"] }], tables: { ...CI.tables, deploys: [{ when: "2026-10-24T13:00:00Z" }] }, sources: { ...CI.sources, deploys } });
    assert.deepEqual(w.runner.usesOf("p1"), { connections: {}, programs: [], folder: "/work/app" }, "a draft reaches out through nothing");
    assert.equal(w.runner.keep("p1", "ci-ab12", 1).ok, true);
    assert.deepEqual(w.runner.usesOf("p1"), {
      connections: { ci: [{ name: "ci-ab12", title: "CI", reads: ["runs"], presses: ["Re-run failed jobs…"] }] },
      programs: [{ program: "gh", by: ["CI"] }],
      folder: "/work/app",
    });
    assert.deepEqual(w.runner.usesOf("p2"), { connections: {}, programs: [], folder: null }, "another project's Space: its own");
  });

  // (fails before: yes — found by the Hunter on S4b: by its title, the second "CI" was left out of who runs gh)
  test("two kept dashboards of one title that run one program: each said", () => {
    const fours = ["ab12", "cd34"];
    const w = world({ four: () => fours.shift() || "ef56" });
    const only = { type: "dashboard", title: "CI", tiles: [{ kind: "number", title: "Runs", from: "runs", field: "n" }], tables: { runs: [{ n: 1 }] }, sources: { runs: { command: ["gh", "run", "list"], columns: { n: "n" } } } };
    w.publish(only);
    w.publish(only);
    assert.deepEqual([w.runner.keep("p1", "ci-ab12", 1).ok, w.runner.keep("p1", "ci-cd34", 1).ok], [true, true]);
    assert.deepEqual(w.runner.usesOf("p1").programs, [{ program: "gh", by: ["CI", "CI"] }]);
  });

  test("a failing tool says why in the tab, as a command does; where nothing wired the tools, it says so", async () => {
    const w = world();
    w.answers.list_runs = { ok: false, error: "ci asks you to sign in (Library › Plugins & Connectors › Sign in)" };
    w.publish({ type: "dashboard", title: "CI", ...CI });
    w.runner.keep("p1", "ci-ab12", 1);
    const r = await w.runner.read("ci-ab12", 1, "runs");
    assert.deepEqual(r.ok && [r.state.error, r.state.fails], ["ci asks you to sign in (Library › Plugins & Connectors › Sign in)", 1]);
    const b = await w.bare.read("ci-ab12", 1, "runs", { force: true });
    assert.equal(b.ok && b.state.error, "a connection's tools are not wired in this Filament");
  });
});

describe("the page's words of a tool", () => {
  test("Keep's lines: Calls ci › list_runs {…} through ci; a changed arg marked new; a button's call; its sheet's call filled as typed", () => {
    const w = world();
    w.publish({ type: "dashboard", title: "CI", ...CI });
    w.runner.keep("p1", "ci-ab12", 1);
    const [d] = w.runner.shown("p1");
    const lines = keepLines(d, "/work/app");
    assert.deepEqual(lines.reads, [{ source: "runs", command: 'ci › list_runs {"branch":"main"}', kind: "tool", tool: { connection: "ci", name: "list_runs" }, host: "", headers: [], filament: "", folder: "/work/app", every: "every 2 min while you look at it", isNew: false }]);
    assert.deepEqual([lines.presses[0].command, lines.presses[0].tool], ['ci › rerun {"run_id":"{row.key}","note":"{ask.why}"}', { connection: "ci", name: "rerun" }]);
    w.publish({ id: "ci-ab12", ...CI, sources: { runs: { ...RUNS_SOURCE, tool: { ...RUNS_SOURCE.tool, args: { branch: "dev" } } } } });
    const [d2] = w.runner.shown("p1");
    assert.equal(d2.draft, true, "another arg: a draft until kept");
    assert.deepEqual(keepLines(d2, "/work/app").reads.map((r) => [r.command, r.isNew]), [['ci › list_runs {"branch":"dev"}', true]]);
    const look = { says: "Re-run the failed jobs of run 412? They start at once.", command: [], tool: { connection: "ci", name: "rerun", args: { run_id: "8812", note: "{ask.why}" } }, folder: "/work/app", ask: [{ name: "why", required: false }] };
    assert.deepEqual(pressWords(look, { why: "" }), { title: "Re-run the failed jobs of run 412?", rest: "They start at once.", command: 'ci › rerun {"run_id":"8812","note":"‹why›"}', where: "through ci, as this project's chats reach it", ready: true });
    assert.equal(pressWords(look, { why: "flaky" }).command, 'ci › rerun {"run_id":"8812","note":"flaky"}');
    assert.equal(pressWords({ ...look, tool: null, command: ["gh", "run", "rerun"] }, {}).where, "in /work/app");
    const counted = { ...look, tool: { connection: "ci", name: "rerun", args: { run_id: 8812, attempts: "{ask.n}", note: "{ask.why}" }, asks: { n: ["integer"] } }, ask: [{ name: "n", required: false }, { name: "why", required: false }] };
    assert.equal(pressWords(counted, { n: "3", why: "7" }).command, 'ci › rerun {"run_id":8812,"attempts":3,"note":"7"}', "a field whose arg takes an integer shows as one; a text field stays text");
    assert.equal(pressWords(counted, { n: "three" }).command, 'ci › rerun {"run_id":8812,"attempts":"three","note":"‹why›"}', "what reads as no number shows as it goes");
    assert.equal(pressWords(counted, {}).command, 'ci › rerun {"run_id":8812,"attempts":"‹n›","note":"‹why›"}');
  });
});

describe("end to end: a project's server, a dashboard a chat publishes, kept, read and pressed", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = fresh("e2e");
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const body = call.body || {};
      // The Skeptic's check of a press, by its task's first words.
      if (JSON.stringify(body.messages?.[0]?.content ?? "").includes("This is a check, for Filament")) return anthropicReply("1. What it did: re-ran 8812.\n2. Verdict: it worked.", { model: "brain-check" });
      if (!body.tools?.length) return anthropicReply("A title", { model: "brain-model" });
      const last = body.messages?.at(-1);
      const parts = Array.isArray(last?.content) ? last.content : [{ type: "text", text: String(last?.content || "") }];
      if (parts.some((/** @type {any} */ p) => p?.type === "tool_result")) return anthropicReply("Published.", { model: "brain-model" });
      return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "pub1", name: "artifact", input: { action: "publish", type: "dashboard", title: "CI", ...CI } }] });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  test("Keep's sheet hears each tool's word; kept, its rows come from the server; Re-run… calls it with the row's run; a line in What happened", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const { projectId } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
    assert.equal((await shim.api(`/api/space/${encodeURIComponent(projectId)}`, { method: "POST" })).status, 200, "its Space made from its menu (10-29)");
    const ci = { name: "ci", command: process.execPath, args: [FIXTURE] };
    const set = await shim.api(`/api/projects/${encodeURIComponent(projectId)}/settings`, { method: "POST", body: { patch: { plugins: { mcp: [ci] } } } });
    assert.equal(set.status, 200, await set.clone().text());
    writeFileSync(join(root, "runs.json"), JSON.stringify(RUNS));
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "make ci", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const base = `/api/space/${encodeURIComponent(projectId)}`;
    const space = async () => (await shim.api(base)).json();
    await until(async () => (await space()).dashboards?.length === 1, "the draft in the Space");
    const name = String((await space()).dashboards[0].name);
    const at = `${base}/dashboards/${encodeURIComponent(name)}`;
    const told = await (await shim.api(`${at}/tools`)).json();
    assert.deepEqual(told.tools.map((/** @type {any} */ x) => [x.name, x.reads, x.ok, x.words]), [
      ["list_runs", true, true, "only reads, its server says"],
      ["rerun", false, true, "acts: Filament calls it only from its sheet, when you press Run"],
    ]);
    assert.equal((await shim.api(`${at}/keep`, { method: "POST", body: { v: 1 } })).status, 200);
    assert.ok((await space()).log.some((/** @type {any} */ e) => e.text === "You kept “CI” in this Space: it calls 1 tool by itself, and 1 button when you press it."), "a tool is called, not run as a command");
    const read = await shim.api(`${at}/read`, { method: "POST", body: { source: "runs" } });
    assert.equal(read.status, 200, await read.clone().text());
    const kept = (await space()).dashboards[0];
    assert.deepEqual([kept.state, kept.sources.runs.rows, kept.sources.runs.error], ["kept", 2, null]);
    const sheet = await (await shim.api(`${at}/actions/rerun`, { method: "POST", body: { key: "8812" } })).json();
    assert.deepEqual(sheet.tool, { connection: "ci", name: "rerun", args: { run_id: 8812, note: "{ask.why}" }, asks: {} }, "the key as the number the server's schema takes");
    const ran = await shim.api(`${at}/actions/rerun/run`, { method: "POST", body: { key: "8812", ask: { why: "flaky" } } });
    assert.equal(ran.status, 200, await ran.clone().text());
    const done = await ran.json();
    assert.deepEqual([done.done, done.said], [true, "Its failed jobs re-run."]);
    assert.equal(JSON.parse(readFileSync(join(root, "runs.json"), "utf8"))[0].conclusion, "queued", "the server's tool ran, with the row's run");
    assert.ok(done.space.log.some((/** @type {any} */ e) => e.text === 'You ran “Re-run failed jobs…” on CI: ci › rerun {"run_id":8812,"note":"flaky"} — Its failed jobs re-run.'), JSON.stringify(done.space.log.map((/** @type {any} */ e) => e.text)));
    // A check asked on a model as the loop names it (`agent/…`) is judged as the model it names, as a second look's and
    // a routine's are: one that cannot run is refused before anything runs, saying the model; one that can runs it.
    // (fails before: yes — found by the review of 10-31: the check read the `agent/` name as a route, and refused it)
    writeFileSync(join(root, "runs.json"), JSON.stringify(RUNS));
    await shim.api(`${at}/read`, { method: "POST", body: { source: "runs" } });
    const cannot = await shim.api(`${at}/actions/rerun/run`, { method: "POST", body: { key: "8812", ask: { why: "flaky" }, check: { model: "agent/zz-none" } } });
    assert.equal(cannot.status, 409);
    assert.match(String((await cannot.json()).error), /^the check cannot run on "agent\/zz-none": no route matches model "zz-none"/);
    assert.equal(JSON.parse(readFileSync(join(root, "runs.json"), "utf8"))[0].conclusion, "failure", "refused: nothing ran");
    const checkedRun = await shim.api(`${at}/actions/rerun/run`, { method: "POST", body: { key: "8812", ask: { why: "flaky" }, check: { model: "agent/brain-check" } } });
    assert.equal(checkedRun.status, 200, await checkedRun.clone().text());
    const check = (await checkedRun.json()).check;
    assert.match(String(check?.agent || ""), /\S/, JSON.stringify(check));
    const looked = `/api/sessions/${encodeURIComponent(check.chain)}/second-looks/${encodeURIComponent(check.agent)}`;
    await until(async () => (await (await shim.api(looked)).json()).status !== "running", "the check's end");
    assert.ok(up.received.some((c) => c.body?.model === "brain-check" && JSON.stringify(c.body?.messages?.[0]?.content ?? "").includes("This is a check, for Filament")), "the check, on the model chosen");
    // Switched off for the project: its source fails in words, nothing called.
    const off = await shim.api(`/api/projects/${encodeURIComponent(projectId)}/settings`, { method: "POST", body: { patch: { plugins: { mcp: [{ ...ci, enabled: false }] } } } });
    assert.equal(off.status, 200, await off.clone().text());
    await shim.api(`${at}/read`, { method: "POST", body: { source: "runs" } });
    assert.equal((await space()).dashboards[0].sources.runs.error, "ci is switched off for this project (Library › Plugins & Connectors)");
  });
});
