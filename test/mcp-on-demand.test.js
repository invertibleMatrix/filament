// @ts-check
// E49, the loop half: an MCP server's tools ride every request in full only where it says load core; any other's are
// named in the system prompt under their server, and one tool, mcp, finds them, loads what one does and takes, and
// calls it — what it loads is a tool's result, so the tools and the prompt the provider caches never move for it (the
// owner's words of 10-26: "we don't wanna bloat the context anymore"). A call through it runs as the server's own
// tool's: the gate, the rules and the record judge that tool; the conversation keeps the call as the model made it.
// The setting half is in mcp-load-setting.test.js.
// (fails before: yes — every server's tools rode every request in full, and no mcp tool was offered)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { removeDirs } from "./helpers/wait.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { PROMPT, systemPromptFor } from "../src/app/agent/prompt.js";
import { DOOR_TOOL, MCP_DOOR, doorAnswer, doorCall, doorIndex, resolveTool, unwrapDoor } from "../src/core/mcp-door.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { cardRefusals, isLoopTool } from "../src/app/agent/tools.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
const sysTextOf = (/** @type {any} */ b) => (Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b.system || ""));
const text = (/** @type {any[]} */ blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const lastResults = (/** @type {any[]} */ msgs) => {
  const m = msgs.at(-1);
  return Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result") : [];
};
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

/** Two servers' tools, as the client lists them. */
const TOOLS = [
  { name: "mcp__github__create_issue", description: "Create an issue in a repository. Takes a title and a body.", input_schema: { type: "object", required: ["title"], properties: { title: { type: "string" }, body: { type: "string" } } }, server: "github", tool: "create_issue", readOnly: false },
  { name: "mcp__github__list_issues", description: "List the open issues of a repository.", input_schema: { type: "object", properties: { repo: { type: "string" } } }, server: "github", tool: "list_issues", readOnly: true },
  { name: "mcp__linear__list_issues", description: "List Linear issues assigned to you.", input_schema: { type: "object", properties: {} }, server: "linear", tool: "list_issues", readOnly: true },
  { name: "mcp__linear__odd_name_v2", description: "A tool whose own name the provider would not take.", input_schema: { type: "object", properties: {} }, server: "linear", tool: "odd name.v2", readOnly: true },
];
const index = doorIndex(TOOLS);

describe("the door's pure parts", () => {
  test("a tool is named whole, under its server, or by its own name where one server has it; anything else is said in words", () => {
    const named = (/** @type {any} */ n, /** @type {any} */ s = undefined) => {
      const r = resolveTool(index, n, s);
      return "tool" in r ? r.tool.name : r.error;
    };
    assert.equal(named("mcp__github__create_issue"), "mcp__github__create_issue");
    assert.equal(named("github__create_issue"), "mcp__github__create_issue", "whole, its prefix left off");
    assert.equal(named("create_issue"), "mcp__github__create_issue", "one server's alone");
    assert.equal(named("list_issues", "linear"), "mcp__linear__list_issues");
    assert.equal(named("odd name.v2"), "mcp__linear__odd_name_v2", "by the server's own name for it");
    assert.equal(named("list_issues"), "list_issues is a tool of github and linear: name it whole (mcp__github__list_issues, mcp__linear__list_issues).");
    assert.equal(named("nope"), "No tool named nope in this session's MCP servers. find searches them.");
    assert.equal(named("nope", "slack"), "No MCP server named slack is in this session: its servers are github, linear.");
    assert.equal(named(""), "Name the tool.");
  });

  test("a call through the door is the tool's own call — its name, its args, the door call's id; find, load and a call naming nothing stay the door's", () => {
    const u = toolUse("t1", MCP_DOOR, { action: "call", tool: "create_issue", args: { title: "Bug" } });
    assert.deepEqual(unwrapDoor(u, index), { type: "tool_use", id: "t1", name: "mcp__github__create_issue", input: { title: "Bug" } });
    assert.deepEqual(unwrapDoor(toolUse("t2", MCP_DOOR, { action: "CALL", tool: "mcp__linear__list_issues" }), index).input, {}, "no args: an empty input");
    for (const input of [{ action: "load", tools: ["create_issue"] }, { action: "find", query: "issue" }, { action: "call", tool: "nope" }]) {
      const v = toolUse("t3", MCP_DOOR, input);
      assert.equal(unwrapDoor(v, index), v);
    }
    const other = toolUse("t4", "read", { path: "x" });
    assert.equal(unwrapDoor(other, index), other);
    assert.equal(unwrapDoor(u, null), u, "a session with no MCP tools unwraps nothing");
    assert.ok(isLoopTool(MCP_DOOR));
  });

  test("find names the closest tools with a line each; load gives each one's words, input and how to call it; anything else is refused in words", () => {
    const found = doorAnswer({ action: "find", query: "create issue" }, index);
    assert.match(found, /^3 tools match:\n- mcp__github__create_issue: Create an issue in a repository\.\n- mcp__github__list_issues \(reads only\): List the open issues of a repository\.\n- mcp__linear__list_issues \(reads only\): List Linear issues assigned to you\.\nload reads/);
    assert.equal(doorAnswer({ action: "find", query: "weather" }, index), 'No tool of this session\'s MCP servers matches "weather". find with a server lists its tools.');
    const loaded = doorAnswer({ action: "load", tools: ["create_issue", "nope"] }, index);
    assert.equal(
      loaded,
      [
        "## mcp__github__create_issue",
        "Create an issue in a repository. Takes a title and a body.",
        'Input (JSON Schema): {"type":"object","required":["title"],"properties":{"title":{"type":"string"},"body":{"type":"string"}}}',
        "Call it: mcp with action call, tool mcp__github__create_issue, args as above.",
        "",
        "## nope",
        "No tool named nope in this session's MCP servers. find searches them.",
      ].join("\n"),
    );
    assert.throws(() => doorAnswer({ action: "find" }, index), /^Error: find needs a server, to list its tools, or a query/);
    assert.throws(() => doorAnswer({ action: "load" }, index), /^Error: load needs tools/);
    assert.throws(() => doorAnswer({ action: "call", tool: "nope" }, index), /^Error: No tool named nope/);
    assert.throws(() => doorAnswer({ action: "run" }, index), /^Error: mcp's action is find, load or call, not run\.$/);
  });

  // (fails before: find took only a query, and the prompt carried every tool's name instead)
  test("find with a server lists its tools whole, each by the name the prompt's servers take and its first line; with a query too, that server's only", () => {
    assert.equal(
      doorAnswer({ action: "find", server: "linear" }, index),
      ["linear's 2 tools:", "- list_issues (reads only): List Linear issues assigned to you.", "- odd_name_v2 (reads only): A tool whose own name the provider would not take.", "load reads what one does and the input it takes."].join("\n"),
    );
    assert.match(doorAnswer({ action: "find", server: "github", query: "issue" }, index), /^2 tools match:\n- mcp__github__/);
    assert.ok(!doorAnswer({ action: "find", server: "github", query: "issue" }, index).includes("linear"), "linear's list_issues matches too, but is another server's");
    assert.equal(doorAnswer({ action: "find", server: "linear", query: "weather" }, index), 'No tool of linear matches "weather".');
    assert.throws(() => doorAnswer({ action: "find", server: "slack" }, index), /^Error: No MCP server named slack is in this session: its servers are github, linear\.$/);
  });

  test("a door call cards as the tool it calls, as it ran; find and load by what they look for", () => {
    assert.deepEqual(cardOf(MCP_DOOR, { action: "call", tool: "mcp__github__create_issue", args: { title: "x" } }), cardOf("mcp__github__create_issue", { title: "x" }));
    assert.deepEqual(cardOf(MCP_DOOR, { action: "call", server: "github", tool: "create_issue" }).subject, "mcp__github__create_issue");
    assert.deepEqual(cardOf(MCP_DOOR, { action: "find", query: "issues" }), { kind: "mcp", title: "Look for tools", subject: "issues" });
    assert.deepEqual(cardOf(MCP_DOOR, { action: "load", tools: ["a", "b"] }), { kind: "mcp", title: "Load tools", subject: "a, b" });
    assert.equal(doorCall("read", { action: "find" }), null);
  });

  // (fails before: an on-demand server's line named each of its tools — a server of ninety cost ninety names)
  test("the prompt names a core server's tools by count, as before, and an on-demand server in one line, with how many tools it has, under a sentence of its own", () => {
    const base = { root: "/w", delegateRead: false };
    const core = systemPromptFor({ ...base, mcp: [{ name: "github", tools: 2 }] });
    assert.ok(core.includes(`${PROMPT.mcp} github (2 tools).`));
    assert.ok(!core.includes(PROMPT.mcpByName));
    const both = systemPromptFor({ ...base, mcp: [{ name: "github", tools: 2 }, { name: "linear", tools: 2, names: ["list_issues", "odd_name_v2"] }] });
    assert.ok(both.includes(`${PROMPT.mcp} github (2 tools).\n${PROMPT.mcpByName}\n- linear: 2 tools`), both);
    assert.ok(!both.includes("list_issues"), "no tool's name rides");
    const named = systemPromptFor({ ...base, mcp: [{ name: "linear", tools: 2, names: ["list_issues", "odd_name_v2"] }, { name: "one", tools: 1, names: ["x"] }, { name: "none", tools: 0, names: [] }] });
    assert.ok(!named.includes(PROMPT.mcp) && named.includes(`${PROMPT.mcpByName}\n- linear: 2 tools\n- one: 1 tool\n- none: no tools`), named);
  });

  test("a fork whose card goes without MCP is refused the door too", () => {
    const refused = cardRefusals({ name: "Scout", toolsOff: ["mcp"] }, [{ name: "read" }, { name: "mcp__github__create_issue" }, DOOR_TOOL]);
    assert.ok(MCP_DOOR in refused && "mcp__github__create_issue" in refused);
  });
});

describe("on-demand MCP tools through the loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-mcp-door-"));
    up = await fakeUpstream(async (/** @type {any} */ call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
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
  /** @param {any} settings */
  const create = async (settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content, extra = {}) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return { rid: String(r.headers.get("x-filament-request-id")), json: await r.json() };
  };
  const NOTES = { name: "notes", command: process.execPath, args: [FIXTURE] };

  test("on demand: the request carries the tools' names and the mcp tool, not their definitions; load reads one; a call runs as the tool's own — a read-only one free, another asks, the answer runs it", async () => {
    const id = await create({ plugins: { mcp: [NOTES] } });
    let round = 0;
    /** @type {any[]} */
    const seen = [];
    brain = (/** @type {any} */ call) => {
      round++;
      seen.push(call.body);
      if (round === 1) return reply([toolUse("l1", MCP_DOOR, { action: "load", tools: ["echo", "write_note"] })], "tool_use");
      if (round === 2) return reply([toolUse("e1", MCP_DOOR, { action: "call", tool: "echo", args: { text: "hi" } }), toolUse("w1", MCP_DOOR, { action: "call", server: "notes", tool: "write_note", args: { name: "door", text: "through the door" } })], "tool_use");
      return reply([{ type: "text", text: "Both done." }]);
    };
    up.reset();
    const r1 = await turn(id, "use the notes server");
    const names = seen[0].tools.map((/** @type {any} */ t) => t.name);
    assert.deepEqual(names.slice(-3), [MCP_DOOR, "skill", "filament_recall"], "the door rides last of what the servers bring, the skill tool after it (prompt version 54), the recall tool memory adds last");
    assert.ok(!names.some((/** @type {string} */ n) => n.startsWith("mcp__")), names.join(", "));
    assert.deepEqual(seen[0].tools.at(-3), JSON.parse(JSON.stringify(DOOR_TOOL)));
    assert.ok(sysTextOf(seen[0]).includes(`${PROMPT.mcpByName}\n- notes: 6 tools`), sysTextOf(seen[0]).slice(-900));
    assert.ok(!sysTextOf(seen[0]).includes(PROMPT.mcp));
    // load: the tools' words and inputs, as a tool's result; the tools and the prompt the same bytes as round 1's.
    const loaded = lastResults(seen[1].messages);
    assert.match(String(loaded[0].content), /^## mcp__notes__echo \(reads only\)\nEcho the text back\.\nInput \(JSON Schema\): \{"type":"object","required":\["text"\]/);
    assert.match(String(loaded[0].content), /## mcp__notes__write_note\nWrite <name>\.txt with the text in the working folder\./);
    assert.deepEqual([seen[1].tools, sysTextOf(seen[1])], [seen[0].tools, sysTextOf(seen[0])], "the cached prefix did not move");
    // The read-only echo ran; write_note asks in the server's tool's own name.
    assert.match(text(r1.json.content), /May I call mcp__notes__write_note with `\{"name":"door","text":"through the door"\}`\? Its server does not vouch for it as read-only/);
    assert.ok(!existsSync(join(root, "door.txt")), "nothing written while the question waits");
    const rec1 = await shim.record(r1.rid);
    assert.deepEqual({ ...rec1.agent.mcp[0], ms: 0 }, { name: "notes", transport: "stdio", tools: 6, readOnly: 5, load: "on-demand", ms: 0 });
    assert.ok(rec1.changes.some((/** @type {string} */ c) => /^agent: MCP server notes offers 6 tools \(stdio, connected in \d+ ms, 5 read-only\) — by name in the prompt, each loaded through mcp when the agent needs it \(load on-demand\)$/.test(c)), rec1.changes.join("\n"));
    assert.ok(rec1.changes.includes("agent: paused for permission to mcp__notes__write_note"), rec1.changes.join("\n"));
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(r1.rid)}/events?limit=500`)).json()).events || [];
    assert.equal(events.find((/** @type {any} */ e) => e.type === "tool-start" && e.name === "mcp__notes__echo")?.args, '{"text":"hi"}', "carded and recorded as the tool's own call");
    assert.ok(events.some((/** @type {any} */ e) => e.type === "tool-start" && e.name === MCP_DOOR), "a load is the door's own call");
    assert.ok(events.some((/** @type {any} */ e) => e.type === "ask" && e.kind === "permission" && e.tool === "mcp__notes__write_note"));
    // The answer: the parked call runs; the conversation kept the calls as the model made them.
    const r2 = await turn(id, "yes", { allow: true });
    assert.match(text(r2.json.content), /Both done\./);
    assert.equal(readFileSync(join(root, "door.txt"), "utf8"), "through the door");
    const last = seen.at(-1);
    assert.deepEqual(lastResults(last.messages).map((/** @type {any} */ r) => r.content), ["echo: hi", "wrote door.txt"]);
    const made = last.messages.at(-2).content.filter((/** @type {any} */ b) => b.type === "tool_use");
    assert.deepEqual(made.map((/** @type {any} */ b) => [b.name, b.input.tool]), [[MCP_DOOR, "echo"], [MCP_DOOR, "write_note"]]);
  });

  test("a rule on the server's tool covers a call through the door; under read-only it is refused in that tool's words; a name that means nothing is said", async () => {
    const id = await create({ plugins: { mcp: [NOTES] }, loop: { rules: [{ tool: "mcp__notes__write_note", pattern: "*", verdict: "allow" }] } });
    let round = 0;
    /** @type {any[]} */
    let results = [];
    brain = (/** @type {any} */ call) => {
      round++;
      if (round === 1) return reply([toolUse("w1", MCP_DOOR, { action: "call", tool: "mcp__notes__write_note", args: { name: "ruled", text: "ok" } }), toolUse("n1", MCP_DOOR, { action: "call", tool: "nope" })], "tool_use");
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Ran." }]);
    };
    up.reset();
    const r = await turn(id, "write via rule");
    assert.match(text(r.json.content), /Ran\./);
    assert.equal(readFileSync(join(root, "ruled.txt"), "utf8"), "ok");
    assert.equal(results[0].content, "wrote ruled.txt");
    assert.equal(results[1].is_error, true);
    assert.match(String(results[1].content), /No tool named nope in this session's MCP servers\. find searches them\./);
    const rec = await shim.record(r.rid);
    assert.ok(rec.changes.includes("agent: mcp__notes__write_note ran on the rule mcp__notes__write_note(*) allow"), rec.changes.join("\n"));
    const ro = await create({ plugins: { mcp: [NOTES] }, loop: { permissions: "read-only" } });
    round = 0;
    brain = (/** @type {any} */ call) => {
      round++;
      if (round === 1) return reply([toolUse("w1", MCP_DOOR, { action: "call", tool: "write_note", args: { name: "never", text: "x" } }), toolUse("e1", MCP_DOOR, { action: "call", tool: "echo", args: { text: "still fine" } })], "tool_use");
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Refused." }]);
    };
    const r2 = await turn(ro, "try");
    assert.match(text(r2.json.content), /Refused\./);
    assert.ok(!existsSync(join(root, "never.txt")));
    assert.match(String(results[0].content), /this session is read-only, so mcp__notes__write_note is not available\./);
    assert.equal(results[1].content, "echo: still fine");
  });

  test("core: the server's tools ride in full, as before, with no door; a server of many tools weighs far less on demand in what /autofit counts, a server of a few a little more", async () => {
    brain = () => reply([{ type: "text", text: "ok" }]);
    /** @param {any} spec */
    const firstCall = async (spec) => {
      const id = await create({ plugins: { mcp: [spec] } });
      up.reset();
      await turn(id, "hello");
      const call = up.received.find((/** @type {any} */ c) => c.kind === "anthropic" && Array.isArray(c.body?.tools));
      assert.ok(call);
      const fixed = Number((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { status: true } })).json()).fixed);
      return { names: call.body.tools.map((/** @type {any} */ t) => t.name), sys: sysTextOf(call.body), fixed };
    };
    const core = await firstCall({ ...NOTES, load: "core" });
    assert.deepEqual(core.names.filter((/** @type {string} */ n) => n.startsWith("mcp")), ["mcp__notes__echo", "mcp__notes__write_note", "mcp__notes__slow", "mcp__notes__fail", "mcp__notes__rich", "mcp__notes__odd_name_v2"]);
    assert.ok(core.sys.includes(`${PROMPT.mcp} notes (6 tools).`) && !core.sys.includes(PROMPT.mcpByName));
    // Six short tools weigh less than the door's own words: on demand pays for itself on a server of many.
    const few = await firstCall(NOTES);
    assert.ok(few.fixed > core.fixed && few.fixed - core.fixed < 400, `a few on demand ${few.fixed}, in full ${core.fixed}`);
    const BIG = { name: "big", command: process.execPath, args: [FIXTURE, "--many", "40"] };
    const big = await firstCall({ ...BIG, load: "core" });
    const lazy = await firstCall(BIG);
    assert.equal(big.names.filter((/** @type {string} */ n) => n.startsWith("mcp__big__")).length, 46);
    assert.ok(lazy.fixed < big.fixed - 3000, `many on demand ${lazy.fixed}, in full ${big.fixed}`);
  });
});
