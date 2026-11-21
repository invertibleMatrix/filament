// @ts-check
// The review of 11-10 of the coding agents other than Claude Code, which no one had run for real: what an agent of
// ACP is sent and how its words are read, where the path made for Claude Code broke another agent.
import "./helpers/clean-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AcpBridge, extractAttachments, extractImages, modeSaidAsText } from "../src/adapters/agents/acp/bridge.js";
import { readSessionOffer } from "../src/adapters/agents/acp/negotiate.js";
import { createUpdateReader } from "../src/adapters/agents/acp/updates.js";
import { classifyFailure, overflowSaid } from "../src/adapters/agents/acp/failures.js";
import { CONTEXT_HEAD, UPDATE_HEAD } from "../src/adapters/agents/context.js";
import { agentContext } from "../src/app/agent-context.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

// (fails before: yes — an image given by its address went as an image block with no data, which ACP's schema requires:
// Gemini CLI refused the whole prompt with -32602)
test("an image the client gave by its address goes as a link to it; one given as data stays an image", () => {
  const url = "https://example.com/shots/screen.png?x=1";
  const anthropic = { messages: [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image", source: { type: "url", url } }, { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } }] }] };
  assert.deepEqual(extractAttachments("anthropic", anthropic, { image: true }).blocks, [
    { type: "resource_link", uri: url, name: "screen.png" },
    { type: "image", mimeType: "image/png", data: "aGk=" },
  ]);
  const openai = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,aGk=" } }] }] };
  assert.deepEqual(extractAttachments("openai", openai, { image: true }).blocks, [
    { type: "resource_link", uri: url, name: "screen.png" },
    { type: "image", mimeType: "image/jpeg", data: "aGk=" },
  ]);
  assert.deepEqual(extractImages("openai", openai), [
    { type: "resource_link", uri: url, name: "screen.png" },
    { type: "image", mimeType: "image/jpeg", data: "aGk=" },
  ]);
  assert.ok(!JSON.stringify(extractAttachments("openai", openai, { image: true }).blocks).includes("image/*"), "no image block without its data");
});

// (fails before: yes — Gemini CLI says its approval mode's change as a line of its reply, "[MODE_UPDATE] yolo", which
// drew in the person's reply and left the mode Filament knew unchanged)
test("an agent's mode said as a line of its reply is the mode update it is; any other line is its reply", () => {
  const said = (/** @type {string} */ text) => ({ sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
  assert.deepEqual(modeSaidAsText(said("[MODE_UPDATE] yolo")), { sessionId: "s1", update: { sessionUpdate: "current_mode_update", currentModeId: "yolo" } });
  assert.deepEqual(modeSaidAsText(said("[MODE_UPDATE] autoEdit\n")).update.currentModeId, "autoEdit");
  for (const text of ["The mode is [MODE_UPDATE] yolo", "[MODE_UPDATE] two words", "hello"]) assert.deepEqual(modeSaidAsText(said(text)), said(text), text);
  const other = { sessionId: "s1", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "[MODE_UPDATE] yolo" } } };
  assert.equal(modeSaidAsText(other), other, "only a line of its reply");
});

// (fails before: yes — Gemini's API refuses a prompt too long for its model in words no overflow pattern read: the
// failure was a broken connection, Retry sent the same prompt again, and the agent was cooled)
test("Gemini's words for a prompt too long for its model are an overflow, with its numbers", () => {
  const e = { message: "Internal error", data: { details: "[API Error: The input token count (1250000) exceeds the maximum number of tokens allowed (1048576).]" } };
  assert.equal(classifyFailure(e).kind, "overflow");
  assert.deepEqual(overflowSaid(e), { max: 1048576, counted: 1250000 });
});

// (fails before: yes — ACP lets an agent give a select's choices in groups, and mark its model option by `category`;
// a grouped list, or a model option named otherwise, read as no models at all)
test("a session's models and effort, in groups or found by their category, are read flat in their order", () => {
  const offer = readSessionOffer({
    configOptions: [
      { id: "engine", name: "Engine", category: "model", type: "select", currentValue: "fast-1", options: [
        { group: "fast", name: "Fast", options: [{ value: "fast-1", name: "Fast One" }, { value: "fast-2" }] },
        { group: "deep", name: "Deep", options: [{ value: "deep-1", name: "Deep One", description: "thinks longer" }] },
      ] },
      { id: "reasoning", name: "Reasoning", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
    ],
  });
  assert.deepEqual([offer.models, offer.currentModel, offer.modelConfigId], [["fast-1", "fast-2", "deep-1"], "fast-1", "engine"]);
  assert.deepEqual([offer.efforts, offer.currentEffort, offer.effortConfigId], [["low", "medium", "high"], "medium", "reasoning"]);
  assert.deepEqual(offer.modelLabels["deep-1"], { label: "Deep One", note: "thinks longer" });
  assert.deepEqual(offer.params.map((p) => p.id), ["reasoning"], "the model option is no other setting");
});

// (fails before: yes — an agent that opens a session but lists no model had no row in the picker, and ↻ could never
// give it one)
test("an agent that opens a session with no model to choose lists one row that runs its own", async () => {
  const bridge = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
  const dir = mkdtempSync(join(tmpdir(), "filament-no-models-"));
  const up = { id: "plainer", name: "Plainer", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_NO_MODELS: "1" }, cwdDefault: dir, permissions: "allow-all" } };
  try {
    assert.deepEqual(await bridge.listModels(up, { force: true }), {
      names: ["default"],
      labels: { default: { label: "Its own model", note: "The model the agent runs by itself: it lists none to choose from" } },
      source: "discovered",
    });
  } finally {
    bridge.shutdown?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — Gemini CLI compresses its history and says nothing of it: what Filament said ahead of its
// prompts, its briefing and rules, could be summarised away and was never said again)
test("an agent's context falling to under half with no compaction said is taken as one: the standing context is said again", () => {
  /** @type {string[]} */
  const notes = [];
  const conv = /** @type {any} */ ({ sessionId: "s1", steerSaid: true });
  const read = createUpdateReader({ out: { tools: [] }, conv, turn: { bridgePlan: () => null }, onEvent: () => {}, notes });
  const used = (/** @type {number} */ n) => read({ sessionUpdate: "usage_update", used: n, size: 1048576 });
  used(30000);
  used(90000);
  used(60000);
  assert.equal(read.compacted(), false, "a third less is no compaction");
  used(12000);
  assert.equal(read.compacted(), true);
  assert.deepEqual(notes, ["acp: the agent's context fell from 60,000 to 12,000 tokens with no compaction said: taken as one, and Filament's standing context is said again"]);
  assert.equal(conv.steerSaid, false, "what it was told ahead of its prompts is said again");
  // A count from a session other than the one before is no fall; nor is one from under 20,000.
  const fresh = /** @type {any} */ ({ sessionId: "s2", usedSeen: 90000, usedSeenIn: "s1" });
  const again = createUpdateReader({ out: { tools: [] }, conv: fresh, turn: { bridgePlan: () => null }, onEvent: () => {}, notes: [] });
  again({ sessionUpdate: "usage_update", used: 5000, size: 1048576 });
  assert.equal(again.compacted(), false);
  const small = /** @type {any} */ ({ sessionId: "s3" });
  const low = createUpdateReader({ out: { tools: [] }, conv: small, turn: { bridgePlan: () => null }, onEvent: () => {}, notes: [] });
  for (const n of [15000, 2000]) low({ sessionUpdate: "usage_update", used: n, size: 1048576 });
  assert.equal(low.compacted(), false);
});

// (fails before: yes — the re-read's finding 17: the test above feeds the reader updates written by hand; no turn of a
// bridge showed the agent told again. With the fall no longer read as a compaction (acp/updates.js), or the bridge
// keeping what a turn said ahead of its prompt though the context fell after it (acp/bridge.js), the fourth prompt here
// goes with nothing ahead of it, and this fails)
test("through its turns: an agent whose context falls to under half with no word of a compaction is told Filament's standing context again at its next prompt, once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-silent-fall-"));
  const bridge = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
  const log = join(dir, "prompts.jsonl");
  const up = { id: "quiet", name: "Quiet", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: log }, cwdDefault: dir, permissions: "allow-all" } };
  const briefing = (/** @type {string} */ b) => `<filament-memory kind="briefing">\n${b}\n</filament-memory>`;
  /** The prompts as the agent got them. @returns {string[]} */
  const sent = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).prompt) : []);
  /** A turn of the chat, its context as memory prepared it. @param {string} text @param {string} [b] its briefing */
  const turn = (text, b = "B1") => {
    const body = { model: "m", max_tokens: 100, system: briefing(b), messages: [{ role: "user", content: text }] };
    return bridge.run({ upstream: up, modelId: "fake-a", format: "anthropic", body, conversationId: "chat", onEvent: () => {}, mcpBase: "http://127.0.0.1:9", context: agentContext({ format: "anthropic", body, graph: false }), toolsAt: { chain: "ch_1", turn: "t_1", graph: false, team: false } });
  };
  const whole = (/** @type {string} */ text, b = "B1") => `${CONTEXT_HEAD}\n\n${briefing(b)}\n\n---\n${text}`;
  const fell = (/** @type {any} */ out) => out.notes.filter((/** @type {string} */ n) => n.includes("with no compaction said"));
  try {
    // The fake says what its context holds as each turn ends (`~holds <n>`), and never a word of a compaction.
    await turn("one ~holds 60000");
    assert.equal(sent().at(-1), whole("one ~holds 60000"), "ahead of its first prompt, as for any agent with no channel of its own");
    assert.deepEqual(fell(await turn("two ~holds 40000")), [], "a third less is no compaction");
    assert.equal(sent().at(-1), "two ~holds 40000", "said once");
    // Its briefing changed: said ahead of the prompt of the turn whose context then falls, which the summary may drop.
    assert.deepEqual(fell(await turn("three ~holds 12000", "B2")), ["acp: the agent's context fell from 40,000 to 12,000 tokens with no compaction said: taken as one, and Filament's standing context is said again"]);
    assert.equal(sent().at(-1), `${UPDATE_HEAD}\n\n${briefing("B2")}\n\n---\nthree ~holds 12000`);
    const four = await turn("four", "B2");
    assert.equal(sent().at(-1), whole("four", "B2"), "the prompt after the fall says it again, whole, the briefing said just before it too");
    assert.deepEqual(four.given?.said, { added: ["briefing"], removed: [], whole: true });
    await turn("five", "B2");
    assert.equal(sent().at(-1), "five", "and once");
  } finally {
    bridge.shutdown();
    await removeDirs(dir);
  }
});

// (fails before: yes — outside Windows a command was looked for on the PATH the app started with alone: Cursor's CLI,
// installed since into ~/.local/bin, wasn't found until Filament started again)
test("outside Windows a command is looked for on the PATH, then in ~/.local/bin, each folder once", async () => {
  const { unixDirs } = await import("../src/adapters/agents/agent-process.js");
  assert.deepEqual(unixDirs({ PATH: "/usr/bin::/bin" }, "/home/ana"), ["/usr/bin", "/bin", join("/home/ana", ".local", "bin")]);
  assert.deepEqual(unixDirs({ PATH: `/usr/bin:${join("/home/ana", ".local", "bin")}` }, "/home/ana"), ["/usr/bin", join("/home/ana", ".local", "bin")]);
  assert.deepEqual(unixDirs({}, ""), []);
});

// (fails before: yes — the re-read's finding 17: the test above reads the list of folders alone, and passed with the
// lookup itself reading the PATH alone, or starting what it found by its bare name; this one fails on either)
test("outside Windows a command the PATH lacks is found in ~/.local/bin and started by its whole path; one on the PATH starts by its name", async () => {
  const { commandExists, resolveAgentCommand } = await import("../src/adapters/agents/agent-process.js");
  const root = mkdtempSync(join(tmpdir(), "filament-unix-path-"));
  const was = { platform: /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process, "platform")), cwd: process.cwd(), PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const late = join(root, "home", ".local", "bin", "late-agent");
  try {
    mkdirSync(dirname(late), { recursive: true });
    mkdirSync(join(root, "onpath"));
    writeFileSync(late, "");
    writeFileSync(join(root, "onpath", "path-agent"), "");
    // The computer said to be other than Windows, its home the test's own (Windows reads it from USERPROFILE). The
    // PATH's one folder is named from the working folder: a Windows folder's whole name holds the ":" a PATH is split at.
    Object.defineProperty(process, "platform", { ...was.platform, value: "linux" });
    process.env.HOME = process.env.USERPROFILE = join(root, "home");
    process.chdir(root);
    process.env.PATH = "onpath";
    assert.equal(commandExists("late-agent"), true, "found in ~/.local/bin, a folder the PATH lacks");
    assert.deepEqual(resolveAgentCommand("late-agent", ["--acp"]), { file: late, args: ["--acp"], resolved: `late-agent (${late})` }, "and started by its whole path, which the PATH can't find");
    assert.equal(commandExists("path-agent"), true);
    assert.deepEqual(resolveAgentCommand("path-agent", ["--acp"]), { file: "path-agent", args: ["--acp"], resolved: "path-agent" }, "one on the PATH starts by its name");
    assert.equal(commandExists("no-agent"), false);
    assert.deepEqual(resolveAgentCommand("no-agent", []), { file: "no-agent", args: [], resolved: "no-agent" }, "one found nowhere starts as written, and fails in its own words");
  } finally {
    process.chdir(was.cwd);
    Object.defineProperty(process, "platform", was.platform);
    for (const k of /** @type {const} */ (["PATH", "HOME", "USERPROFILE"])) {
      if (was[k] === undefined) delete process.env[k];
      else process.env[k] = was[k];
    }
    rmSync(root, { recursive: true, force: true });
  }
});

// (fails before: yes — there was no relay: an agent that takes MCP over stdio alone went without Filament's tools)
test("the relay carries an agent's MCP messages to Filament's address side by side, says in its answer what failed, and closes a call cancelled or left open", async () => {
  const { relay, answersOf } = await import("../src/adapters/agents/acp/mcp-relay.js");
  const { createServer } = await import("node:http");
  const { PassThrough } = await import("node:stream");
  /** @type {string[]} */
  const sessions = [];
  /** The calls whose connection closed before their answer, by id. @type {unknown[]} */
  const closedEarly = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      sessions.push(String(req.headers["mcp-session-id"] || ""));
      const m = JSON.parse(body);
      if (m.id === undefined) return void res.writeHead(202).end();
      if (m.method === "broken") return void res.writeHead(500).end("it broke");
      const answer = () => res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s-1" }).end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { method: m.method } }));
      if (m.method === "slow") setTimeout(answer, 300);
      else if (m.method === "endless") res.on("close", () => void (res.writableEnded || closedEarly.push(m.id)));
      else answer();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  try {
    const address = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/mcp/tok`;
    const input = new PassThrough();
    const output = new PassThrough();
    /** @type {any[]} */
    const got = [];
    let buf = "";
    output.on("data", (c) => {
      buf += c;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        got.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
      }
    });
    const send = (/** @type {any} */ m) => input.write(`${JSON.stringify(m)}\n`);
    const done = relay(address, input, output);
    send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await until(() => got.length === 1, "the handshake's answer");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "slow" });
    send({ jsonrpc: "2.0", id: 3, method: "quick" });
    send({ jsonrpc: "2.0", id: 4, method: "broken" });
    input.write("not json\n");
    await until(() => got.length === 5, "every answer");
    assert.deepEqual(got.filter((m) => m.result).map((m) => m.id), [1, 3, 2], "the quick answer came before the slow one");
    assert.match(got.find((m) => m.id === 4)?.error?.message, /^Filament's MCP server answered 500: it broke$/);
    assert.equal(got.find((m) => m.id === null)?.error?.code, -32700);
    assert.deepEqual(sessions.slice(1), ["s-1", "s-1", "s-1", "s-1"], "the session Filament gave goes with each message after");
    // A call the agent cancels is closed at Filament, which stops it there; nothing is written for it.
    send({ jsonrpc: "2.0", id: 7, method: "endless" });
    await until(() => sessions.length === 6, "the endless call at Filament");
    send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7, reason: "stopped" } });
    await until(() => closedEarly.includes(7), "the cancelled call closed at Filament");
    // One still open when the agent closes its end is closed too, and the relay is done.
    send({ jsonrpc: "2.0", id: 8, method: "endless" });
    await until(() => sessions.length === 8, "the second endless call at Filament");
    input.end();
    await done;
    await until(() => closedEarly.includes(8), "the open call closed at Filament");
    assert.equal(got.length, 5, "nothing written for a call closed on purpose");
    const away = new PassThrough();
    let said = "";
    const awayOut = new PassThrough();
    awayOut.on("data", (c) => (said += c));
    const gone = relay("http://127.0.0.1:1/mcp/tok", away, awayOut);
    away.write(`${JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" })}\n`);
    await until(() => said.includes("\n"), "the unreachable call's answer");
    away.end();
    await gone;
    assert.match(JSON.parse(said).error.message, /^Filament's MCP server could not be reached/);
    assert.deepEqual(answersOf("text/event-stream", 'event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":1,"result":{}}\n\ndata: [{"jsonrpc":"2.0","id":2,"result":{}}]\n\n').map((m) => m.id), [1, 2]);
  } finally {
    server.close();
  }
});

// (fails before: yes — a session's record kept Filament's own server by its `url` alone: one given through the relay
// was left out, and opened again from the record it went without Filament's tools; the review of 11-10: the address was
// on the relay's command line, which anyone on the computer can read)
test("Filament's server given through the relay carries its address in a variable, is kept without its token, and given a new one when its session opens again", async () => {
  const { relayServer, RELAY_SCRIPT } = await import("../src/adapters/agents/acp/toolset.js");
  const { SessionMap, givenAgain } = await import("../src/adapters/agents/acp/sessions.js");
  assert.deepEqual(relayServer("http://127.0.0.1:5/mcp/abc", { execPath: "/app/Filament", electron: true }), {
    name: "filament",
    command: "/app/Filament",
    args: [RELAY_SCRIPT],
    env: [{ name: "FILAMENT_RELAY_ADDRESS", value: "http://127.0.0.1:5/mcp/abc" }, { name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  });
  assert.deepEqual(relayServer("u", { execPath: "/usr/bin/node", electron: false }).env, [{ name: "FILAMENT_RELAY_ADDRESS", value: "u" }]);
  const dir = mkdtempSync(join(tmpdir(), "filament-relay-"));
  try {
    const stateFile = join(dir, "sessions.json");
    const map = new SessionMap({ stateFile });
    // As an earlier start gave it: its program and script where they were then.
    const earlier = { ...relayServer("http://127.0.0.1:5/mcp/secret-token"), command: "/tmp/.mount_old/filament", args: ["/tmp/.mount_old/src/mcp-relay.js"] };
    map.set("k", { sessionId: "s1", cwd: "/w", opened: { mcpServers: [{ name: "files", command: "x", args: [], env: [] }, earlier] } });
    map.flush();
    const text = (await import("node:fs")).readFileSync(stateFile, "utf8");
    assert.ok(!text.includes("secret-token"), "no token on disk");
    const back = new SessionMap({ stateFile });
    back.load();
    const conv = back.get("k");
    const addressOf = (/** @type {any} */ s) => s.env.find((/** @type {any} */ e) => e.name === "FILAMENT_RELAY_ADDRESS").value;
    assert.deepEqual(conv.opened.mcpServers.map(addressOf), ["http://127.0.0.1:5/mcp/"]);
    givenAgain(conv);
    const own = conv.opened.mcpServers[0];
    assert.deepEqual([own.command, own.args], [process.execPath, [RELAY_SCRIPT]], "the relay as this Filament starts it");
    assert.match(addressOf(own), /^http:\/\/127\.0\.0\.1:5\/mcp\/[0-9a-f]+$/);
    assert.equal(addressOf(own), `http://127.0.0.1:5/mcp/${conv.mcpToken}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the review of 11-10: an agent with no HTTP MCP was offered none of Filament's tools)
test("an agent with no HTTP MCP is handed Filament's server through the relay; where the install has none, it goes without, said", async () => {
  const { planToolset, RELAY_SCRIPT } = await import("../src/adapters/agents/acp/toolset.js");
  const { readProfile } = await import("../src/adapters/agents/acp/profile.js");
  const init = { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: false, sse: false } }, agentInfo: { name: "fake", version: "1" } };
  const upstream = { id: "deaf", name: "Deaf", acp: { command: "deaf" } };
  const plan = (/** @type {boolean} */ relay, /** @type {string[]} */ notes) =>
    planToolset({ acp: upstream.acp, upstream, proc: { initResult: init }, profile: readProfile(init), turn: { bridge: "prompts", toolsAt: {} }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:9", memoryWanted: true, existingToken: "tok", notes, relay });
  const said = /** @type {string[]} */ ([]);
  const relayed = plan(true, said);
  assert.equal(relayed.wantMcp, true);
  assert.deepEqual(relayed.mcpServers.map((/** @type {any} */ s) => [s.name, s.args?.[0], s.env?.[0]?.value]), [["filament", RELAY_SCRIPT, "http://127.0.0.1:9/mcp/tok"]]);
  assert.match(said.join("\n"), /Deaf takes no MCP server over HTTP \(mcpCapabilities\.http\): Filament's tools reach it over stdio, through Filament's relay/);
  const lost = /** @type {string[]} */ ([]);
  const without = plan(false, lost);
  assert.deepEqual([without.wantMcp, without.mcpServers.length], [false, 0]);
  assert.match(lost.join("\n"), /declares no HTTP MCP support \(mcpCapabilities\.http\), and Filament's relay over stdio is missing from its install .*: the memory tools/);
  const { relayHere } = await import("../src/adapters/agents/acp/toolset.js");
  assert.equal(relayHere(), true, "the install holds it");
  process.env.FILAMENT_MCP_RELAY = "off";
  try {
    assert.equal(relayHere(), false, "kept off by the person's word");
    const off = /** @type {string[]} */ ([]);
    assert.equal(plan(relayHere(), off).wantMcp, false);
    assert.match(off.join("\n"), /Filament's relay over stdio is off here \(FILAMENT_MCP_RELAY=off\), so Filament's MCP server was not offered/);
  } finally {
    delete process.env.FILAMENT_MCP_RELAY;
  }
});
