import "./helpers/clean-env.js";
import { test, before, after, mock } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import { expandModelNames, selectSdkModel, describeSdkTool, loadCursorSdk, sdkStatus, installCursorSdk } from "../src/cursor-sdk.js";
import { CursorSdkBridge, mcpToolOf } from "../src/adapters/agents/cursor-sdk.js";
import { until } from "./helpers/wait.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = pathToFileURL(join(here, "fixtures", "fake-cursor-sdk.mjs")).href;
let app, port, dataDir, projDir, logFile;
const H = { "content-type": "application/json", authorization: "Bearer k" };
/**
 * npm, as the SDK's install runs it: the line it was given, its output, and no end until it's killed (no pid, so no
 * taskkill ever runs for it). Each is kept in `npms`.
 */
const npms = [];
const fakeNpm = (file, args, opts) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", null)); return true; };
  npms.push({ file, args, opts, child });
  setImmediate(() => { child.stdout.write("npm http fetch GET 200 https://registry.npmjs.org/@cursor%2fsdk\n"); child.stderr.write("npm warn deprecated something\n"); });
  return child;
};
const events = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "filament-sdk-")); projDir = join(dataDir, "project"); mkdirSync(projDir); logFile = join(dataDir, "sdk.log");
  process.env.FAKE_SDK_LOG = logFile;
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.experimental.cursorSdk = true; // Cursor through its SDK, behind Settings › Experimental (off by default)
  cfg.upstreams = [
    // `toolActivity: "text"` is pinned here because the rendering test below asserts fenced diff and output blocks —
    // that is what text mode means now that `quiet` is the default. `csdkquiet` leaves it unset, so it exercises the
    // new default end to end through the real SDK path.
    // `timeoutMs`: the silence limit it had until no clock ended an agent's turn (HarnessV3-FailurePoints §4 B), kept
    // as the condition the quiet run's test below failed under; nothing reads it now.
    { id: "csdk", name: "Cursor SDK", type: "cursor-sdk", apiKey: "ck-test", timeoutMs: 2500, acp: { cwdDefault: projDir, permissions: "allow-all", hints: false, clientBridge: "prompts", toolActivity: "text" } },
    { id: "csdkquiet", name: "Cursor SDK quiet", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false, clientBridge: "prompts" } },
    { id: "csdkfull", name: "Cursor SDK full", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir, permissions: "allow-all", hints: false, clientBridge: "full" } },
    { id: "csdknokey", name: "Cursor SDK no key", type: "cursor-sdk", apiKey: "", acp: { cwdDefault: projDir, hints: false } },
    { id: "csdkbadkey", name: "Cursor SDK bad key", type: "cursor-sdk", apiKey: "wrong", acp: { cwdDefault: projDir, hints: false } },
  ];
  cfg.routes = [{ match: "csdk/*", upstream: "csdk", upstreamModel: "{1}", format: "auto" }, { match: "quiet/*", upstream: "csdkquiet", upstreamModel: "{1}", format: "auto" }, { match: "full/*", upstream: "csdkfull", upstreamModel: "{1}", format: "auto" }, { match: "nokey/*", upstream: "csdknokey", upstreamModel: "{1}", format: "auto" }, { match: "badkey/*", upstream: "csdkbadkey", upstreamModel: "{1}", format: "auto" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0, cursorSdkLoader: () => import(FAKE), sdkInstallSpawn: fakeNpm } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); rmSync(dataDir, { recursive: true, force: true }); });

const chat = (model, messages, extra = {}, headers = {}) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify({ model, messages, ...extra }) });
const sys = () => `Working directory: ${projDir}`;

test("model names expand like the CLI list and flat names resolve to SDK selections", () => {
  const items = [{ id: "grok-4.6", parameters: [{ id: "effort", values: [{ value: "low" }, { value: "high" }, { value: "xhigh" }] }, { id: "fast", values: [{ value: "false" }, { value: "true" }] }] }, { id: "composer-2.5", aliases: ["composer"], parameters: [{ id: "fast", values: [{ value: "false" }, { value: "true" }] }] }, { id: "auto-smart" }];
  const names = expandModelNames(items);
  for (const n of ["grok-4.6", "grok-4.6-xhigh", "grok-4.6-fast", "grok-4.6-xhigh-fast", "composer-2.5", "composer-2.5-fast", "auto-smart"]) assert.ok(names.includes(n), n);
  assert.deepEqual(selectSdkModel("grok-4.6-xhigh-fast", null, items).selection, { id: "grok-4.6", params: [{ id: "effort", value: "xhigh" }, { id: "fast", value: "true" }] });
  assert.deepEqual(selectSdkModel("grok-4.6", "high", items).selection, { id: "grok-4.6", params: [{ id: "fast", value: "false" }, { id: "effort", value: "high" }] });
  assert.equal(selectSdkModel("composer", null, items).selection.id, "composer-2.5");
  const unknown = selectSdkModel("gpt-9", null, items); assert.equal(unknown.selection.id, "auto-smart"); assert.match(unknown.notes[0], /not offered/);
  assert.equal(selectSdkModel("auto", null, items).selection.id, "auto-smart");
  // (fails before: no — a guard the mutation pass asked for: no model of Cursor's said its version in its name alone)
  const named = [{ id: "sonnet", displayName: "Sonnet 5", parameters: [{ id: "thinking", values: [{ value: "false" }, { value: "true" }] }] }, { id: "auto-smart" }];
  assert.deepEqual(selectSdkModel("sonnet-5-thinking", null, named).selection, { id: "sonnet", params: [{ id: "thinking", value: "true" }] }, "Sonnet 5, in Cursor's words");
  assert.equal(selectSdkModel("sonnet-4", null, named).selection.id, "auto-smart", "4 is not the 5 its words say");
  assert.deepEqual(describeSdkTool({ type: "shell", args: { command: "npm test" } }), { title: "npm test", kind: "execute" });
  assert.deepEqual(describeSdkTool({ type: "edit", args: { path: "a.js" } }), { title: "Edit a.js", kind: "edit" });
  assert.equal(describeSdkTool({ type: "updateTodos", args: {} }), null);
});

test("without the SDK installed Filament keeps running and says what to install", async () => {
  const r = await loadCursorSdk({ loader: async () => { throw new Error("Cannot find package '@cursor/sdk'"); } });
  assert.equal(r.ok, false); assert.match(r.hint, /npm install -g @cursor\/sdk/);
  const st = sdkStatus(); assert.equal(typeof st.installed, "boolean"); assert.ok(st.install);
});

test("a turn through the SDK: streams thinking and text, resumes the same agent, applies model params from the name", async () => {
  const sess = "s-sdk-1";
  const r1 = await chat("csdk/grok-4.6-xhigh-fast", [{ role: "system", content: sys() }, { role: "user", content: "hello there" }], { stream: true }, { "x-session-id": sess });
  assert.equal(r1.status, 200); const s1 = await r1.text();
  assert.ok(s1.includes("pondering") && s1.includes("echo(1): ") && s1.includes("hello there") && s1.includes("[DONE]"), s1.slice(-400));
  const created = events().filter((e) => e.event === "create"); assert.equal(created.length, 1); assert.deepEqual(created[0].model, { id: "grok-4.6", params: [{ id: "effort", value: "xhigh" }, { id: "fast", value: "true" }] }); assert.equal(created[0].cwd, projDir); assert.equal(created[0].disallowedTools, null);
  const r2 = await chat("csdk/grok-4.6-xhigh-fast", [{ role: "system", content: sys() }, { role: "user", content: "hello there" }, { role: "assistant", content: "echo(1): hello there" }, { role: "user", content: "second" }], {}, { "x-session-id": sess });
  const j2 = await r2.json(); assert.match(j2.choices[0].message.content, /echo\(2\): second/); assert.equal(j2.usage.prompt_tokens, 4060, "context meter: base prompt (calibrated on turn 1, floor 4000) + 30 appended per turn"); assert.equal(j2.usage.prompt_tokens_details.cached_tokens, 0); assert.equal(j2.usage.completion_tokens, 30);
  const rec2 = app.usage.list(1)[0]; assert.equal(rec2.tokens.input, 120, "billed input stays the SDK's uncached figure"); assert.equal(rec2.tokens.cacheRead, 100); assert.equal(rec2.contextUsed, 4060);
  assert.equal(events().filter((e) => e.event === "create").length, 1, "the same agent is reused");
  const rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((c) => /sdk: agent .* reused \(turn 2\)/.test(c)), rec.changes.join(" | ")); assert.ok(rec.changes.some((c) => /sdk: model grok-4.6 \(effort xhigh, fast on\)/.test(c)));
  // (fails before: no — a guard the mutation pass asked for: Cursor compacted only in a conversation's first turn)
  const r3 = await chat("csdk/grok-4.6-xhigh-fast", [{ role: "system", content: sys() }, { role: "user", content: "hello there" }, { role: "assistant", content: "echo(1): hello there" }, { role: "user", content: "second" }, { role: "assistant", content: "echo(2): second" }, { role: "user", content: "~compact then finish" }], {}, { "x-session-id": sess });
  assert.equal((await r3.json()).usage.prompt_tokens, 4042, "Cursor's compaction keeps a fifth of what the earlier turns appended: 4000 + 12 + 30");
});

test("tool calls render as lines, diff blocks and command output; sub-agent work is nested; @plan selects plan mode", async () => {
  const r = await chat("csdk/composer-2.5@plan", [{ role: "system", content: sys() }, { role: "user", content: "~shell ~edit ~task please" }]);
  const t = (await r.json()).choices[0].message.content;
  assert.ok(t.includes("⚙ run `npm test`") && t.includes("```text") && t.includes("3 passing"), t);
  assert.ok(t.includes("⚙ Edit src/app.js") && t.includes("```diff") && t.includes("-a\n+b"), t);
  assert.ok(t.includes("⚙ sub-agent explore the repo started: Find where the app starts") && t.includes("↳ ⚙ Read src/index.js") && t.includes("✓ sub-agent explore the repo finished"), t);
  const sent = events().filter((e) => e.event === "send").at(-1); assert.equal(sent.mode, "plan"); assert.equal(sent.model.id, "composer-2.5");
  // two model calls in this run (the shell step, then the answer): the wire shows the last call's context, the record the billed sum
  const rec = app.usage.list(1)[0]; assert.equal(rec.tokens.input, 200, "billed input: the run's sum, cache excluded by the SDK itself"); assert.equal(rec.tokens.cacheRead, 160); assert.equal(rec.tokens.output, 40); assert.equal(rec.contextUsed, 5030, "base 4000 + 1000 (tool result) + 30 (output)");
  assert.ok(rec.changes.some((c) => /context meter set to the agent's context \(5,030 tokens, estimated: base prompt \+ 1,030 appended this turn\)/.test(c)), rec.changes.join(" | "));
  // Cursor's own compaction shrinks the meter
  const c = await chat("csdk/composer-2.5", [{ role: "system", content: sys() }, { role: "user", content: "~compact then finish" }], {}, { "x-session-id": "s-sdk-compact" });
  const jc = await c.json(); assert.equal(jc.usage.prompt_tokens, 4030); const rc = app.usage.list(1)[0]; assert.ok(rc.changes.some((x) => /Cursor compacted its own context/.test(x)));
});

// (fails before: yes — the hunt of c-compact, sa_014723a3: each prompt's first compaction was `summary-1`, so a wake's
// prompt in the same Filament turn that compacted again was taken for the compaction already back, and what it may have
// lost never came back)
test("each of Cursor's compactions has an id of its own across a chat's prompts", async () => {
  const bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, stateFile: join(dataDir, "sdk-ids.json"), loader: () => import(FAKE) }));
  try {
    const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir } };
    /** @type {string[]} */
    const ids = [];
    for (const text of ["~compact one", "~compact two"])
      await bridge.run(/** @type {any} */ ({ upstream: up, modelId: "composer-2.5", format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] }, conversationId: "compaction-ids", headers: {}, onEvent: (/** @type {any} */ ev) => void (ev.type === "compaction" && ev.state === "completed" && ids.push(ev.id)) }));
    assert.equal(ids.length, 2, JSON.stringify(ids));
    assert.notEqual(ids[0], ids[1], JSON.stringify(ids));
  } finally {
    bridge.shutdown();
  }
});

// (fails before: yes — the review of 11-11: a compaction's id stayed on the prompt once it completed, so a second one in
// the same prompt whose end came with no start said was given the first's, and acp-turn's `compactedAfter` let it go)
test("a second compaction in one prompt, its start unsaid, has an id of its own", async () => {
  const bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, stateFile: join(dataDir, "sdk-bare-ids.json"), loader: () => import(FAKE) }));
  try {
    const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir } };
    /** @type {string[]} */
    const ids = [];
    await bridge.run(/** @type {any} */ ({ upstream: up, modelId: "composer-2.5", format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: "~compactbare twice" }] }, conversationId: "compaction-bare", headers: {}, onEvent: (/** @type {any} */ ev) => void (ev.type === "compaction" && ev.state === "completed" && ids.push(ev.id)) }));
    assert.equal(ids.length, 2, JSON.stringify(ids));
    assert.notEqual(ids[0], ids[1], JSON.stringify(ids));
  } finally {
    bridge.shutdown();
  }
});

// (fails before: yes — every mode but one naming plan ran as Cursor's agent: `@ask`, a question, ran an agent that edits
// files and runs commands)
test("@ask runs in Cursor's plan mode, never its agent; a mode it has none of runs as its agent, said", async () => {
  await (await chat("csdk/composer-2.5@ask", [{ role: "system", content: sys() }, { role: "user", content: "hello there" }])).json();
  assert.equal(events().filter((e) => e.event === "send").at(-1).mode, "plan");
  assert.ok(app.usage.list(1)[0].changes.includes("sdk: mode plan (alias of ask)"), app.usage.list(1)[0].changes.join(" | "));
  await (await chat("csdk/composer-2.5@nosuchmode", [{ role: "system", content: sys() }, { role: "user", content: "hello there" }])).json();
  assert.equal(events().filter((e) => e.event === "send").at(-1).mode, "agent");
  assert.ok(app.usage.list(1)[0].changes.includes("sdk: mode agent (it has no mode nosuchmode)"), app.usage.list(1)[0].changes.join(" | "));
});

// (fails before: yes — a summary the SDK said failed was drawn as a compaction, the meter cut to a fifth and the turn
// noted as compacted)
test("a summary Cursor says failed compacts nothing: the meter stands and the turn says it could not", async () => {
  const sess = "s-sdk-compactfail";
  const first = [{ role: "system", content: sys() }, { role: "user", content: "hello there" }];
  await (await chat("csdk/composer-2.5", first, {}, { "x-session-id": sess })).json();
  const r = await chat("csdk/composer-2.5", [...first, { role: "assistant", content: "echo(1): hello there" }, { role: "user", content: "~compactfail then finish" }], { stream: true }, { "x-session-id": sess });
  const s = await r.text();
  assert.ok(s.includes("could not compact its context"), s.slice(-600));
  assert.ok(!s.includes("compacted its context"), "never said compacted");
  const rec = app.usage.list(1)[0];
  assert.equal(rec.contextUsed, 4060, "the meter stands: base 4000 + 30 appended per turn");
  assert.ok(!rec.changes.some((x) => /Cursor compacted its own context/.test(x)), rec.changes.join(" | "));
});

// (fails before: yes — a missing key was read as a broken pipe: sent again, and its agent cooled down as if busy)
test("an SDK upstream with no key fails as a sign-in, not to be sent again", async () => {
  const { CursorSdkBridge } = await import("../src/adapters/agents/cursor-sdk.js");
  const { classifyFailure } = await import("../src/adapters/agents/acp/failures.js");
  const bridge = new CursorSdkBridge({ log: () => {} });
  let thrown = null;
  try { bridge.keyOf({ id: "csdknokey", name: "Cursor SDK no key", apiKey: "" }); } catch (e) { thrown = e; }
  assert.match(String(thrown?.message), /has no Cursor API key/);
  assert.deepEqual(classifyFailure(thrown), { kind: "auth", retryable: false, cools: true });
});

// (fails before: yes — its title read `path`, which Cursor's readLints never has: it names `paths`)
// (fails before: yes — the review of 7cd60efc5: a server's tool was named by a word in its name, so `mark_as_read` read
// as a file read, and a move to an agent's next model sent anew a run that had posted to Slack)
test("a call to an MCP server's tool is named by its MCP name, Filament's own as Filament's; Filament's file tools keep Cursor's kind", () => {
  const own = new Set(["tasks"]);
  const call = (/** @type {string} */ server, /** @type {string} */ toolName) => mcpToolOf({ type: "mcp", args: { providerIdentifier: server, toolName, args: { text: "hi" } } }, own);
  assert.deepEqual(call("slack", "mark_as_read"), { toolName: "mcp__slack__mark_as_read", rawInput: { text: "hi" } });
  assert.deepEqual(call("custom-user-tools", "tasks"), { toolName: "mcp__filament__tasks", rawInput: { text: "hi" } });
  assert.deepEqual([call("custom-user-tools", "read_file"), mcpToolOf({ type: "shell", args: { command: "ls" } }, own)], [{}, {}]);
  // (fails before: yes — the review of 46a624ab4: a server's name went in as written, into a name a model's history
  // refuses, and a person's server named filament read as Filament's own)
  assert.deepEqual([call("GitHub MCP", "create issue").toolName, call("Filament", "notes").toolName], ["mcp__GitHub-MCP__create-issue", "mcp__filament-mcp__notes"]);
});

test("Cursor's lint read is titled with the files it reads", () => {
  assert.deepEqual(describeSdkTool({ type: "readLints", args: { paths: ["src/a.js", "src/b.js"] } }), { title: "Lints src/a.js, src/b.js", kind: "read" });
});

const ZTOOLS = [
  { type: "function", function: { name: "TodoWrite", parameters: { type: "object", properties: { todos: { type: "array" } }, required: ["todos"] } } },
  { type: "function", function: { name: "Read", parameters: { type: "object", properties: { file_path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, required: ["file_path"] } } },
  { type: "function", function: { name: "Bash", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];
async function toolLoop(model, text, runTool, sessionId) {
  const messages = [{ role: "system", content: sys() }, { role: "user", content: text }]; const calls = []; let out = "";
  for (let i = 0; i < 6; i++) {
    const r = await chat(model, messages, { tools: ZTOOLS, tool_choice: "auto" }, { "x-session-id": sessionId }); assert.equal(r.status, 200); const j = await r.json(); const m = j.choices[0].message; out += m.content || "";
    if (j.choices[0].finish_reason !== "tool_calls") return { text: out, calls };
    messages.push({ role: "assistant", content: m.content, tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) { const input = JSON.parse(tc.function.arguments); calls.push({ name: tc.function.name, input }); messages.push({ role: "tool", tool_call_id: tc.id, content: await runTool(tc.function.name, input) }); }
  }
  throw new Error("loop did not end");
}

test("quiet is the default end to end: the same agent run produces compact lines and no fenced dumps", async () => {
  // The same `~shell ~edit ~task` fixture as the text-mode test above, through an upstream that does not set
  // toolActivity — so this pins the DEFAULT a fresh install gets, through the real SDK path rather than the
  // renderer in isolation.
  const r = await chat("quiet/composer-2.5", [{ role: "system", content: sys() }, { role: "user", content: "~shell ~edit ~task please" }]);
  assert.equal(r.status, 200);
  const t = (await r.json()).choices[0].message.content;
  assert.ok(t.includes("⚙ run `npm test`"), `the command is still announced: ${t}`);
  assert.ok(t.includes("⚙ Edit src/app.js"), "and so is the edit");
  assert.ok(t.includes("⚙ sub-agent explore the repo started") && t.includes("✓ sub-agent explore the repo finished"), "and the sub-agent, nested work included");
  // The whole point of quiet: none of the bulk that used to land in the middle of the agent's prose.
  assert.ok(!t.includes("```diff"), `no fenced diff block: ${t}`);
  assert.ok(!t.includes("```text"), "no fenced command output");
  assert.ok(!t.includes("-a\n+b"), "and no raw diff lines");
  assert.ok(t.includes("✓ +1 −1 src/app.js"), `the edit is a one-line summary instead: ${t}`);
  // A passing command's transcript never reaches the chat, so "3 passing" is gone with the fence
  assert.ok(!t.includes("3 passing"), "a passing command's output is not dumped");
  const text = (await (await chat("csdk/composer-2.5", [{ role: "system", content: sys() }, { role: "user", content: "~shell ~edit ~task please" }])).json()).choices[0].message.content;
  assert.ok(text.includes("```diff") && text.includes("3 passing"), "while the pinned text-mode upstream still fences everything — the modes really differ");
  assert.ok(t.length < text.length, `quiet is materially shorter (${t.length} vs ${text.length} chars)`);
});

test("plans become the client's TodoWrite; with clientBridge=full Cursor's read runs through the client's Read", async () => {
  const r = await toolLoop("csdk/grok-4.6", "~plan then finish", async (name, input) => { assert.equal(name, "TodoWrite"); assert.equal(input.todos.length, 2); return "ok"; }, "s-sdk-plan");
  assert.ok(r.calls.length >= 1 && r.calls.every((c) => c.name === "TodoWrite"), JSON.stringify(r.calls)); assert.ok(r.text.includes("echo(") && !r.text.includes("**Plan**"), r.text);
  assert.equal(r.calls.at(-1).input.todos[0].status, "completed");
  writeFileSync(join(projDir, "README.md"), "hello readme\n");
  const f = await toolLoop("full/grok-4.6", "~custom read please", async (name, input) => { assert.equal(name, "Read"); assert.ok(String(input.file_path).endsWith("README.md")); return "     1\thello readme\n"; }, "s-sdk-full");
  assert.deepEqual(f.calls.map((c) => c.name), ["Read"]); assert.ok(f.text.includes("custom-read:hello readme"), f.text);
  const created = events().filter((e) => e.event === "create").at(-1); assert.deepEqual(created.disallowedTools, ["shell", "read", "edit", "delete"]); assert.deepEqual(created.customTools.slice(0, 5), ["Read", "Write", "Edit", "Bash", "Delete"]); assert.ok(created.customTools.slice(5).every((n) => n.startsWith("filament_") || n === "space"), `then Filament's own (AC4-2), the project's Space among them (team_v2_plan TV2-D7): ${created.customTools}`);
  // without client tools the custom Read uses Filament's own hands
  const n = await chat("full/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "~custom again" }], {}, { "x-session-id": "s-sdk-full-2" });
  assert.match((await n.json()).choices[0].message.content, /custom-read:hello readme/);
});

// (fails before: yes — the review of b1f4c556b: the record kept the newest model call's count alone (400 input, 300 cache
// read, 20 output), and a run that failed after its calls kept none of them)
test("a run Cursor names no usage for counts every model call of its turn, and one that fails after its calls keeps what they spent", async () => {
  /** A turn of its own chat, and its record once closed. @param {string} content @param {string} sess */
  const said = async (content, sess) => {
    const r = await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content }], {}, { "x-session-id": sess });
    await r.text();
    const rec = await until(() => {
      const x = app.usage.list(1)[0];
      return x?.status !== "pending" && x?.clientSession === sess ? x : null;
    }, "its record");
    return { status: r.status, rec };
  };
  const summed = await said("~nousage please", "s-sdk-summed");
  assert.equal(summed.status, 200);
  assert.deepEqual([summed.rec.tokens.input, summed.rec.tokens.cacheRead, summed.rec.tokens.output], [700, 500, 30], "both model calls, added up");
  const failed = await said("~fail-spent please", "s-sdk-failed");
  assert.equal(failed.status, 502);
  assert.deepEqual([failed.rec.status, failed.rec.tokens.input, failed.rec.tokens.cacheRead, failed.rec.tokens.output], ["error", 700, 500, 30], "what its model calls spent before it failed");
});

// (fails before: yes — a run whose wait threw failed the turn before its calls' counts reached its facts: the record kept
// 0 tokens)
test("a Cursor run whose wait throws keeps what its model calls said they spent", async () => {
  const sess = "s-sdk-waitbreaks";
  const r = await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "~waitbreaks please" }], {}, { "x-session-id": sess });
  await r.text();
  const rec = await until(() => {
    const x = app.usage.list(1)[0];
    return x?.status !== "pending" && x?.clientSession === sess ? x : null;
  }, "its record");
  assert.equal(r.status, 502);
  assert.deepEqual([rec.status, rec.tokens.input, rec.tokens.cacheRead, rec.tokens.output], ["error", 700, 500, 30]);
  assert.match(String(rec.error), /the run's stream broke off/);
});

test("missing key, refused key and a failed run are all explained in words", async () => {
  const a = await chat("nokey/grok-4.6", [{ role: "user", content: "hi" }]); assert.equal(a.status, 502); assert.match(JSON.stringify(await a.json()), /no Cursor API key: sign it in under Settings → Coding agents, on Cursor's page or with a key made at /);
  const b = await chat("badkey/grok-4.6", [{ role: "user", content: "hi" }]); assert.equal(b.status, 502); assert.match(JSON.stringify(await b.json()), /Invalid API key/);
  const c = await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "~fail now" }], { stream: true }); const sc = await c.text(); assert.ok(sc.includes("model overloaded") && sc.includes("_filament: Cursor SDK failed"), sc.slice(-400));
});

// (fails before: yes — the run quiet for its upstream's 2.5 s, the silence watchdog cancelled it: "did not finish this turn")
test("a quiet Cursor SDK run is never cut by a clock: the client hanging up ends it", async () => {
  const hangUp = new AbortController();
  const d = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, signal: hangUp.signal, body: JSON.stringify({ model: "csdk/grok-4.6", stream: true, messages: [{ role: "system", content: sys() }, { role: "user", content: "~hang here" }] }) });
  const reader = /** @type {ReadableStream<Uint8Array>} */ (d.body).getReader(); const dec = new TextDecoder();
  let s = ""; let ended = false;
  const reading = (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; s += dec.decode(value, { stream: true }); } ended = true; } catch {} })();
  await until(() => s.includes("working…"), "the run's first words");
  await new Promise((r) => setTimeout(r, 3500)); // past the 2.5 s it was once cut at
  assert.equal(ended, false, "the reply is still open");
  assert.ok(!s.includes("did not finish this turn") && !s.includes('"finish_reason":"'), s.slice(-500));
  hangUp.abort();
  await reading;
  assert.equal(ended, false, "the hang-up ended it, not the reply's end");
});

test("the upstream test reports the key owner and the model count; the SDK status endpoint answers", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/upstreams/test`, { method: "POST", headers: { "content-type": "application/json", "x-filament-ui": "1" }, body: JSON.stringify({ upstream: { id: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: projDir } } }) });
  const j = await r.json(); assert.equal(j.ok, true, JSON.stringify(j)); assert.match(j.auth, /dev@example.com/); assert.equal(j.models, 3); assert.match(j.command, /@cursor\/sdk/);
  const st = await (await fetch(`http://127.0.0.1:${port}/api/sdk/status`, { headers: { "x-filament-ui": "1" } })).json(); assert.equal(typeof st.installed, "boolean");
  // The SDK's model list is discovered by an explicit Refresh only (the owner's rule); the read below is served from it.
  await fetch(`http://127.0.0.1:${port}/api/models?refresh=1`, { headers: { "x-filament-ui": "1" } });
  const models = await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: H })).json(); const ids = models.data.map((m) => m.id); assert.ok(ids.includes("csdk/grok-4.6-xhigh") && ids.includes("csdk/composer-2.5-fast"), ids.filter((x) => x.startsWith("csdk/")).join(","));
  // HarnessV3-ACP AF2: the SDK's own names for its models, on the picker's families.
  const fams = (await (await fetch(`http://127.0.0.1:${port}/api/models`, { headers: { "x-filament-ui": "1" } })).json()).families.filter((f) => f.upstream === "csdk");
  assert.deepEqual(fams.map((f) => [f.id, f.label]), [["csdk/auto-smart", "Auto"], ["csdk/grok-4.6", "Grok 4.6"], ["csdk/composer-2.5", "Composer 2.5"]]);
  const acp = await (await fetch(`http://127.0.0.1:${port}/api/acp/status`, { headers: { "x-filament-ui": "1" } })).json(); assert.ok(acp.conversations.some((c) => c.upstreamId === "csdk")); assert.ok("sdk" in acp);
});

// (fails before: yes — no such runner: the route's own cut the install at 10 minutes and nothing stopped it,
// HarnessV3-FailurePoints FP-D3)
test("the SDK's install has no clock: npm runs until it ends or the person stops it, its output as it comes", async () => {
  const turns = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const before = npms.length;
    const run = installCursorSdk({ spawnImpl: fakeNpm, platform: "linux" });
    let settled = false;
    run.done.then(() => (settled = true));
    await turns(5);
    const { file, args, opts, child } = npms[before];
    assert.deepEqual([file, args, opts.windowsHide], ["npm", ["install", "-g", "@cursor/sdk"], true]);
    assert.equal(run.output(), "npm http fetch GET 200 https://registry.npmjs.org/@cursor%2fsdk\nnpm warn deprecated something\n");
    mock.timers.tick(24 * 3600_000);
    await turns(5);
    assert.equal(settled, false, "a day, and it runs on");
    run.stop();
    run.stop();
    assert.equal(child.killed, true);
    assert.deepEqual(await run.done, { code: 1, out: `${run.output()}\n(Filament: stopped by the person)`, stopped: true });
    // On Windows npm runs under cmd, given the line whole.
    const win = installCursorSdk({ spawnImpl: fakeNpm, platform: "win32" });
    assert.deepEqual(npms.at(-1).args, ["/d", "/s", "/c", "npm install -g @cursor/sdk"]);
    npms.at(-1).child.emit("close", 0);
    assert.deepEqual(await win.done, { code: 0, out: "", stopped: false }, "ended by itself before any output: no stop to say");
    // npm that never starts says why.
    const none = installCursorSdk({ spawnImpl: () => { throw new Error("spawn npm ENOENT"); }, platform: "linux" });
    assert.deepEqual(await none.done, { code: 1, out: "spawn npm ENOENT", stopped: false });
    none.stop();
  } finally {
    mock.timers.reset();
  }
});

// (fails before: yes — the install answered only at its end, or at 10 minutes, and had no stop: HarnessV3-FailurePoints
// FP-D3)
test("the SDK's install through the page: its status shows it and its output while it runs, a second waits for it, and Stop ends it", async () => {
  const api = (path, init = {}) => fetch(`http://127.0.0.1:${port}/api${path}`, { ...init, headers: { ...H, "x-filament-ui": "1" } });
  const status = async () => (await api("/sdk/status")).json();
  assert.equal((await status()).installing, null);
  assert.deepEqual(await (await api("/sdk/install/stop", { method: "POST", body: "{}" })).json(), { stopped: false }, "nothing to stop");
  const answer = api("/sdk/install", { method: "POST", body: "{}" }).then((r) => r.json());
  const seen = await until(async () => { const s = await status(); return s.installing?.output?.includes("npm warn") ? s : null; }, "the install's output on its status");
  assert.match(seen.installing.output, /^npm http fetch GET 200 .*\nnpm warn deprecated something\n?$/);
  assert.equal(typeof seen.installing.since, "number");
  const again = await api("/sdk/install", { method: "POST", body: "{}" });
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /being installed already/);
  assert.deepEqual(await (await api("/sdk/install/stop", { method: "POST", body: "{}" })).json(), { stopped: true });
  const done = await answer;
  assert.deepEqual([done.ok, done.stopped], [false, true]);
  assert.match(done.output, /\(Filament: stopped by the person\)$/);
  assert.equal((await status()).installing, null, "it runs no longer");
});

// (fails before: yes — HarnessV4_Tasks U1; HarnessV3-FailurePoints §14.4: the card awaited the install's answer with a
// greyed button and nothing else — no output, no stop — and after a reload offered Install again, which answers 409)
test("the SDK's card on Destinations: while an install runs — its own or one its status says — its output, how long, and Stop; Install greyed; one stopped is no failure (source contract)", () => {
  const page = readFileSync(new URL("../src/ui/pages/destinations.js", import.meta.url), "utf8");
  const card = page.slice(page.indexOf("const sdkPanel = (u) => {"), page.indexOf("  return box;", page.indexOf("const sdkPanel = (u) => {")));
  assert.match(card, /const running = \(\) => mine \|\| !!st\?\.installing;/, "this page's own, or one under way elsewhere");
  assert.match(card, /const poll = async \(\) => \{ timer = 0; if \(!box\.isConnected \|\| !running\(\)\) return; try \{ const now = await api\("\/sdk\/status"\); if \(running\(\)\) st = now; \}/, "its status each second, while the card is on screen");
  assert.match(card, /const stop = async \(\) => \{ stopping = true; draw\(\); try \{ const r = await api\("\/sdk\/install\/stop", \{ method: "POST" \}\); if \(!r\?\.stopped\) \{ stopping = false; toast\("It had ended already"\); \} \}/);
  assert.match(card, /h\("button", \{ class: "primary", disabled: busy \? "" : null, onclick: install \}, busy \? "Installing… \(about 50 MB, a minute or two\)" : "Install the Cursor SDK now"\),/, "a second install answers 409: the button is greyed while one runs");
  assert.match(card, /busy \? h\("button", \{ class: "sm", disabled: stopping \? "" : null, title: "[^"]+", onclick: stop \}, stopping \? "Stopping…" : "Stop"\) : null,/);
  assert.match(card, /busy && live \? `running for \$\{fmt\.ms\(Math\.max\(0, Date\.now\(\) - live\.since\)\)\}`/);
  assert.match(card, /!installed && busy \? h\("pre", \{ class: "small" \}, live\?\.output \|\| "npm has printed nothing yet"\) : null,/);
  assert.match(card, /toast\(r\.stopped \? "Cursor SDK install stopped" : r\.ok \? /);
  assert.match(card, /r\.ok \|\| r\.stopped \? "ok" : "err"\)/, "the person's stop is no failure");
  assert.match(card, /!busy && result\?\.stopped \? h\("p", \{ class: "small muted" \}, "You stopped the install\. Install runs it again from the start\."\) : null,/);
  assert.match(page, /api\("\/sdk\/status"\)\.then\(\(now\) => \{ st = now; draw\(\); watch\(\); \}\)/, "a page loaded while one runs picks it up");
});

test("a new message while the SDK agent waits for the client interrupts that turn instead of queueing behind it", async () => {
  const sess = "s-sdk-int"; writeFileSync(join(projDir, "README.md"), "hello readme\n");
  const first = await chat("full/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "~custom read" }], { tools: ZTOOLS }, { "x-session-id": sess });
  const j1 = await first.json(); assert.equal(j1.choices[0].finish_reason, "tool_calls", JSON.stringify(j1).slice(0, 200));
  const t0 = Date.now();
  const second = await chat("full/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "~custom read" }, { role: "assistant", content: "…" }, { role: "user", content: "never mind, just say hi" }], { tools: ZTOOLS }, { "x-session-id": sess });
  const j2 = await second.json(); const t = j2.choices[0].message.content;
  assert.ok(Date.now() - t0 < 20000, "answered promptly"); assert.ok(t.includes("echo(") && /previous turn|waiting for the client/.test(t) || t.includes("echo("), t);
  const rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((c) => /previous turn was still waiting for the client/.test(c)), rec.changes.join(" | "));
});

test("an agent left with an active run (Filament restarted mid-turn) is recovered with a forced follow-up", async () => {
  const r = await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "~busy hello" }], {}, { "x-session-id": "s-sdk-busy" });
  assert.equal(r.status, 200); const j = await r.json(); assert.match(j.choices[0].message.content, /echo\(1\): ~busy hello/);
  const rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((c) => /previous run was still marked active/.test(c)), rec.changes.join(" | "));
});

// (fails before: no — a guard the mutation pass asked for: no chat that went on held a tool's result)
test("a tool's result in the history is no turn of the person's: the chat goes on uncaught, and a later catch-up misses none", async () => {
  const sess = `s-${Math.random().toString(36).slice(2, 8)}`;
  await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "first" }], {}, { "x-session-id": sess });
  const read = { id: "t1", type: "function", function: { name: "Read", arguments: JSON.stringify({ path: "a.txt" }) } };
  const hist = [
    { role: "system", content: sys() },
    { role: "user", content: "first" },
    { role: "assistant", content: null, tool_calls: [read] },
    { role: "tool", tool_call_id: "t1", content: "hello" },
    { role: "assistant", content: "echo(1): first" },
    { role: "user", content: "second" },
  ];
  await chat("csdk/grok-4.6", hist, {}, { "x-session-id": sess });
  assert.doesNotMatch(events().filter((e) => e.event === "send").at(-1).text, /Meanwhile/);
  assert.ok(!app.usage.list(1)[0].changes.some((c) => /handled elsewhere/.test(c)), "no turn handled elsewhere");
  const away = [
    { role: "assistant", content: "echo(2): second" },
    { role: "user", content: "away with claude" }, { role: "assistant", content: "about apples" },
    { role: "user", content: "away again" }, { role: "assistant", content: "about pears" },
    { role: "user", content: "back to you" },
  ];
  await chat("csdk/grok-4.6", [...hist, ...away], {}, { "x-session-id": sess });
  const sent = events().filter((e) => e.event === "send").at(-1).text;
  assert.match(sent, /away with claude[\s\S]*apples[\s\S]*away again/, "from the first turn it missed");
});

test("P4: acp.catchUp is honoured by the SDK bridge too, and SDK turns report the bridge in force", async () => {
  // THE P1 THIS PINS. The catch-up preamble existed as TWO copies of the same block — one in src/acp.js, one in
  // src/cursor-sdk.js — and the new `acp.catchUp` gate was added to only one of them. The dashboard renders the same
  // `acp` schema group for both upstream types, so unticking the box on a Cursor upstream changed nothing while
  // looking like it did. A schema-presence test cannot catch that: the knob exists, it is just not wired here.
  const sess = `s-${Math.random().toString(36).slice(2, 8)}`;
  const up = app.config.upstreams.find((u) => u.id === "csdk");
  await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "first" }], {}, { "x-session-id": sess });
  const hist = [
    { role: "system", content: sys() },
    { role: "user", content: "first" }, { role: "assistant", content: "echo(1): first" },
    { role: "user", content: "away with claude" }, { role: "assistant", content: "about apples" },
    { role: "user", content: "away again" }, { role: "assistant", content: "about pears" },
    { role: "user", content: "back to you" },
  ];
  // Default (on): the turns this agent missed while the chat was elsewhere are injected.
  await chat("csdk/grok-4.6", hist, {}, { "x-session-id": sess });
  const sentOn = events().filter((e) => e.event === "send").at(-1);
  assert.match(sentOn.text, /Meanwhile, this conversation continued/, "the SDK bridge catches up by default");
  assert.match(sentOn.text, /apples/, "with the turns it actually missed");
  const recOn = app.usage.list(1)[0];
  assert.equal(recOn.acp.configuredBridge, "prompts", "this upstream is configured for prompts");
  assert.equal(recOn.acp.bridge, "prompts", "and that is what the turn got — the SDK record used to carry no bridge at all");
  assert.ok(recOn.acp.toolStats && typeof recOn.acp.toolStats.calls === "number", `tool stats are on the record: ${JSON.stringify(recOn.acp.toolStats)}`);
  // Off: no preamble, only the newest message.
  up.acp.catchUp = false;
  try {
    await chat("csdk/grok-4.6", [...hist, { role: "assistant", content: "echo" }, { role: "user", content: "away once more" }, { role: "assistant", content: "about quince" }, { role: "user", content: "and back" }], {}, { "x-session-id": sess });
    const sentOff = events().filter((e) => e.event === "send").at(-1);
    assert.equal(sentOff.text, "and back", `only the newest message is sent, got: ${sentOff.text.slice(0, 200)}`);
    assert.ok(!sentOff.text.includes("Meanwhile"), "and there is no preamble");
    assert.ok(!app.usage.list(1)[0].changes.some((c) => /handled elsewhere/.test(c)), "the record does not claim a catch-up that did not happen");
  } finally { up.acp.catchUp = true; }
  // The live surface merges both bridges into ONE table, so an SDK conversation without these fields rendered as an
  // empty cell beside real ACP ones — and the tooltip then asserted no turn had ever run, which was false.
  const s = await (await fetch(`http://127.0.0.1:${port}/api/acp/status`, { headers: { "x-filament-ui": "1" } })).json();
  const cv = s.conversations.find((c) => c.sessionId === recOn.acp.sessionId);
  assert.ok(cv, `the SDK conversation is on the shared status surface: ${JSON.stringify(s.conversations.map((c) => c.upstreamId))}`);
  assert.equal(cv.upstreamId, "csdk");
  assert.equal(cv.bridge, "prompts", "it reports the mode in force");
  assert.equal(cv.bridgeConfigured, "prompts", "and what was configured");
  assert.ok(Array.isArray(cv.clientTools), `plus the tools this client declared: ${JSON.stringify(cv.clientTools)}`);
});

// (fails before: yes — a message that only answers tool calls counted as a turn of the person's: after a turn with
// tool calls, the agent was sent its own turn back as another assistant's)
test("tool results in the history are no turn of the person's: the SDK agent is sent the new message alone", async () => {
  const H2 = { "x-session-id": "s-tool-results" };
  await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "read it" }], {}, H2);
  await chat("csdk/grok-4.6", [
    { role: "system", content: sys() },
    { role: "user", content: "read it" },
    { role: "assistant", content: "Reading.", tool_calls: [{ id: "t1", type: "function", function: { name: "Read", arguments: '{"file_path":"README.md"}' } }] },
    { role: "tool", tool_call_id: "t1", content: "hello agent" },
    { role: "assistant", content: "It says hello." },
    { role: "user", content: "and again" },
  ], {}, H2);
  assert.equal(events().filter((e) => e.event === "send").at(-1).text, "and again");
  assert.ok(!app.usage.list(1)[0].changes.some((c) => /handled elsewhere/.test(c)), "no catch-up claimed");
});

test("P6: steering works on the SDK bridge too, and `off` still wins there", async () => {
  // The knob is rendered for SDK upstreams exactly as for ACP ones, so it has to DO something there — this is the
  // failure the P4 review found in the catch-up gate, where a dashboard control silently applied to one bridge only.
  const sess = `s-${Math.random().toString(36).slice(2, 8)}`;
  const up = app.config.upstreams.find((u) => u.id === "csdk");
  const wasB = up.acp.clientBridge;
  up.acp.steering = true;
  try {
    await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "steer me" }], {}, { "x-session-id": sess });
    const sent = events().filter((e) => e.event === "send").at(-1);
    // `prompts` mode passes no custom tools at all without steering, so their presence is the whole change.
    assert.ok(sent.customTools?.length > 0, `Filament's tools were offered even in prompts mode: ${JSON.stringify(sent.customTools)}`);
    assert.ok(sent.customTools.includes("Read") && sent.customTools.includes("Bash"), "including the file and command tools");
    assert.ok(sent.text.startsWith("Tool routing:"), `and the instruction leads the prompt: ${JSON.stringify(sent.text.slice(0, 70))}`);
    const rec = app.usage.list(1)[0];
    assert.equal(rec.acp.steering, true, "the record says steering was in force");
    assert.equal(rec.acp.bridge, "prompts", "while the bridge in force is still prompts — steering does not change the mode");
    assert.ok(rec.changes.some((c) => /steering \(Rung 2 experiment\)/.test(c)), `with the caveat that the agent may ignore it: ${rec.changes.join(" | ").slice(-200)}`);
    // Not repeated on the next turn of the same agent.
    await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "steer me" }, { role: "assistant", content: "echo(1): steer me" }, { role: "user", content: "again" }], {}, { "x-session-id": sess });
    assert.ok(!events().filter((e) => e.event === "send").at(-1).text.includes("Tool routing:"), "sent once per agent, not every turn");
  } finally { up.acp.steering = false; }
  // `off` promises the client is never involved, and a custom-tool call is routed straight to the client.
  up.acp.clientBridge = "off"; up.acp.steering = true;
  try {
    const s2 = `s-${Math.random().toString(36).slice(2, 8)}`;
    await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "off mode" }], {}, { "x-session-id": s2 });
    const sent = events().filter((e) => e.event === "send").at(-1);
    assert.ok(!sent.text.includes("Tool Routing:"), "no instruction under off");
    assert.deepEqual((sent.customTools || []).filter((n) => !n.startsWith("filament_") && n !== "space"), [], `and no file tools offered — memory's and the Space's are Filament's own, and never reach the client: ${JSON.stringify(sent.customTools)}`);
    const rec = app.usage.list(1)[0];
    assert.ok(!rec.acp.steering, "the record does not claim steering");
    assert.ok(rec.changes.some((c) => /steering is on but clientBridge is "off"/.test(c)), `and says why: ${rec.changes.join(" | ").slice(-220)}`);
  } finally { up.acp.clientBridge = wasB; up.acp.steering = false; }
});

// (fails before: no — a guard the mutation pass asked for: Check now was never pressed twice within the hour, and none
// failed)
test("Check now asks Cursor afresh each time; one that fails answers with the account's row as it stands", async () => {
  const check = (/** @type {string} */ id) => fetch(`http://127.0.0.1:${port}/api/agent-accounts/${id}/check`, { method: "POST", headers: { "x-filament-ui": "1" } });
  const asked = () => events().filter((e) => e.event === "me").length;
  const before = asked();
  for (let i = 0; i < 2; i++) assert.equal((await check("csdk")).status, 200);
  assert.equal(asked() - before, 2, "never the hour's cached answer");
  const bad = await check("csdkbadkey");
  assert.deepEqual([bad.status, (await bad.json()).agent?.upstream], [502, "csdkbadkey"]);
});

test("P4: an SDK upstream configured for the client bridge really does disable Cursor's own tools", async () => {
  // `full`/`native` on the SDK bridge pass disallowedTools for shell/read/edit/delete and hand over Filament's own
  // tool set, which is what makes "native" the honest label for the mode in force rather than "full".
  const sess = `s-${Math.random().toString(36).slice(2, 8)}`;
  await chat("full/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "~shell please" }], {}, { "x-session-id": sess });
  const rec = app.usage.list(1)[0];
  assert.equal(rec.acp.configuredBridge, "full");
  assert.equal(rec.acp.bridge, "native", `built-ins really are off, so the turn got native semantics: ${JSON.stringify(rec.acp)}`);
  const sent = events().filter((e) => e.event === "send").at(-1);
  assert.ok(sent.customTools?.length > 0, `Filament's tools were handed over: ${JSON.stringify(sent.customTools)}`);
});

test("a warm Cursor agent is loaded again when its tool ban changes", async () => {
  const sess = `s-ban-${Math.random().toString(36).slice(2, 8)}`;
  const up = app.config.upstreams.find((u) => u.id === "csdk");
  const was = up.acp.clientBridge;
  try {
    await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "ban first" }], {}, { "x-session-id": sess });
    const opened = events().filter((e) => e.event === "send" && e.text === "ban first").at(-1);
    up.acp.clientBridge = "full";
    await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "ban first" }, { role: "assistant", content: "echo" }, { role: "user", content: "ban second" }], {}, { "x-session-id": sess });
    const resumes = () => events().filter((e) => e.event === "resume" && e.agentId === opened.agentId);
    assert.equal(resumes().length, 1);
    assert.deepEqual(resumes()[0].disallowedTools, ["shell", "read", "edit", "delete"]);
    assert.ok(events().some((e) => e.event === "close" && e.agentId === opened.agentId));
    const rec = app.usage.list(1)[0];
    assert.ok(rec.changes.some((c) => /opened with changed \(its tool ban/.test(c)), rec.changes.join(" | "));
    await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "ban first" }, { role: "assistant", content: "echo" }, { role: "user", content: "ban second" }, { role: "assistant", content: "echo" }, { role: "user", content: "ban third" }], {}, { "x-session-id": sess });
    assert.equal(resumes().length, 1, "the same ban is kept on the handle");
  } finally {
    up.acp.clientBridge = was;
  }
});

test("a send that never starts is retried once when Cursor says so, and otherwise leaves the chat unheard", async () => {
  const retry = await chat("csdk/grok-4.6", [{ role: "system", content: sys() }, { role: "user", content: "~retry hello" }], {}, { "x-session-id": "s-sdk-retry" });
  assert.equal(retry.status, 200);
  assert.match((await retry.json()).choices[0].message.content, /echo\(1\): ~retry hello/);
  const rec = app.usage.list(1)[0];
  assert.ok(rec.changes.some((c) => /the run never started \(transport stalled\); retrying once/.test(c)), rec.changes.join(" | "));
  assert.ok(rec.changes.some((c) => /sdk: run run-/.test(c)), rec.changes.join(" | "));

  const sess = "s-sdk-unheard";
  const first = [{ role: "system", content: sys() }, { role: "user", content: "~nostart please" }];
  const missed = await chat("csdk/grok-4.6", first, {}, { "x-session-id": sess });
  assert.equal(missed.status, 502);
  assert.match(JSON.stringify(await missed.json()), /cursor unreachable/);
  const again = await chat("csdk/grok-4.6", [...first, { role: "user", content: "now go" }], {}, { "x-session-id": sess });
  assert.equal(again.status, 200);
  const seeded = events().filter((e) => e.event === "send").at(-1);
  assert.match(seeded.prompt, /Earlier conversation/);
  assert.match(seeded.prompt, /~nostart please/);
  assert.match(seeded.prompt, /Latest user message:\n\nnow go/);

  const heard = "s-sdk-heard-fail";
  const failed = [{ role: "system", content: sys() }, { role: "user", content: "keep this phrase" }, { role: "user", content: "~fail now" }];
  const ran = await chat("csdk/grok-4.6", failed, { stream: true }, { "x-session-id": heard });
  assert.ok((await ran.text()).includes("model overloaded"));
  await chat("csdk/grok-4.6", [...failed, { role: "assistant", content: "failed" }, { role: "user", content: "after fail" }], {}, { "x-session-id": heard });
  const followed = events().filter((e) => e.event === "send").at(-1);
  assert.equal(followed.text, "after fail");
  assert.doesNotMatch(followed.prompt, /Earlier conversation/);
});

// (fails before: yes — with no clock to end an agent's turn (HarnessV3-FailurePoints §4 B), a run that takes no cancel
// held its turn for good: the hang-up rightly asked it nothing, and nothing else let go of it)
test("a run that cannot be cancelled is not asked to cancel: a hang-up lets go of it, and the turn ends", async () => {
  const hangUp = new AbortController();
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, signal: hangUp.signal, body: JSON.stringify({ model: "csdk/grok-4.6", stream: true, messages: [{ role: "system", content: sys() }, { role: "user", content: "~hang ~nocancel" }] }) });
  const reader = /** @type {ReadableStream<Uint8Array>} */ (r.body).getReader(); const dec = new TextDecoder();
  let s = "";
  const reading = (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; s += dec.decode(value, { stream: true }); } } catch {} })();
  await until(() => s.includes("working…"), "the run's first words");
  const sent = events().filter((e) => e.event === "send" && /~nocancel/.test(e.text)).at(-1);
  assert.ok(sent);
  hangUp.abort();
  await reading;
  const turnRun = () => /** @type {any} */ (app).runs.listRuns({ kind: "coding-agent" }).find((/** @type {any} */ m) => m.meta?.session === sent.agentId);
  await until(() => turnRun()?.endedAt != null, "the turn's run to end once its client hung up");
  assert.equal(events().filter((e) => e.event === "cancel" && e.agentId === sent.agentId).length, 0, "the run was never asked to cancel");
});
