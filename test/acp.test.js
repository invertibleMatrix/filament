import "./helpers/clean-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { formatToolLine } from "../src/acp.js";
import { defaultConfig } from "../src/config.js";
import { flattenMessages, determineCwd, choosePermission, conversationKey, extractAttachments } from "../src/acp.js";
import { estimateBodyTokens } from "../src/core/tokens.js";
import { mergeRules, shapeAnthropic, parseModelSuffix } from "../src/rules.js";
import { until } from "./helpers/wait.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-acp-agent.mjs");

test("flattenMessages turns both wire formats into plain turns and never replays reasoning", () => {
  const a = flattenMessages("anthropic", { system: [{ type: "text", text: "sys" }], messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "thinking", thinking: "secret", signature: "x" }, { type: "text", text: "hello" }, { type: "tool_use", id: "t", name: "read", input: { path: "a" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "file body" }, { type: "text", text: "now what" }] },
  ] });
  assert.deepEqual(a.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.ok(!a[2].text.includes("secret") && a[2].text.includes("hello") && a[2].text.includes("read"));
  assert.ok(a[3].text.includes("file body") && a[3].text.includes("now what"));
  const o = flattenMessages("openai", { messages: [{ role: "system", content: "sys" }, { role: "user", content: "q" }, { role: "assistant", content: null, tool_calls: [{ function: { name: "get_weather" } }] }, { role: "tool", content: "sunny" }, { role: "user", content: "thanks" }] });
  assert.deepEqual(o.map((m) => m.role), ["system", "user", "assistant", "user", "user"]);
  assert.ok(o[2].text.includes("get_weather") && o[3].text.includes("sunny"));
});

test("determineCwd prefers the header, then the client's system prompt, then the default", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-cwd-")); const sub = join(dir, "proj"); mkdirSync(sub);
  const flat = [{ role: "system", text: `<env>\nWorking directory: ${sub}\nIs directory a git repo: No\n</env>` }, { role: "user", text: "hi" }];
  assert.equal(determineCwd({}, flat, null).cwd, sub);
  assert.equal(determineCwd({}, flat, dir).cwd, dir);
  assert.equal(determineCwd({ cwdSource: "fixed", cwdDefault: dir }, flat, null).cwd, dir);
  assert.equal(determineCwd({}, [{ role: "system", text: "Working directory: Z:\\definitely\\missing" }], null).source, "home (no project path found)");
  assert.notEqual(conversationKey("u", sub, flat), conversationKey("u", dir, flat));
  rmSync(dir, { recursive: true, force: true });
});

test("choosePermission follows the policy", () => {
  const params = { toolCall: { kind: "execute" }, options: [{ optionId: "a1", kind: "allow_once" }, { optionId: "aa", kind: "allow_always" }, { optionId: "r", kind: "reject_once" }] };
  assert.equal(choosePermission("allow-all", params).outcome.optionId, "a1");
  assert.equal(choosePermission("allow-once", params).outcome.optionId, "a1");
  assert.equal(choosePermission("reject", params).outcome.optionId, "r");
  assert.equal(choosePermission("read-only", params).outcome.optionId, "r");
  assert.equal(choosePermission("read-only", { ...params, toolCall: { kind: "read" } }).outcome.optionId, "a1");
});

// (fails before: yes — the bug hunt of 10-30, AGT-1: allow-all and read-only took the agent's "always" over its
// allow-once, so its later calls of the kind stopped reaching Filament and a policy changed since went unheard for
// them; an option of no kind was read by its name, so "Allow" said yes)
test("choosePermission takes the agent's allow-once wherever it offers one, its always under allow-all alone where it is the one yes, and goes by the options' kinds alone", () => {
  const always = { toolCall: { kind: "read" }, options: [{ optionId: "aa", kind: "allow_always" }, { optionId: "r", kind: "reject_once" }] };
  assert.equal(choosePermission("allow-all", always).outcome.optionId, "aa", "the one yes allow-all has");
  assert.equal(choosePermission("read-only", always).outcome.outcome, "cancelled", "read-only never takes it, for a read either");
  assert.equal(choosePermission("allow-once", always).outcome.outcome, "cancelled", "nor allow-once");
  const named = (/** @type {string[]} */ ...names) => ({ toolCall: { kind: "read" }, options: names.map((name, i) => ({ optionId: `o${i}`, name })) });
  for (const policy of ["allow-all", "allow-once", "read-only", "reject"])
    assert.equal(choosePermission(policy, named("Don't allow", "Allow", "Reject")).outcome.outcome, "cancelled", `${policy}: options of no kind say nothing it goes by`);
  const words = { toolCall: { kind: "read" }, options: [{ optionId: "no", name: "Allow", kind: "reject_once" }, { optionId: "yes", name: "Don't allow", kind: "allow_once" }] };
  assert.deepEqual(["allow-all", "reject"].map((p) => choosePermission(p, words).outcome.optionId), ["yes", "no"], "by its kind, whatever its name says");
});

test("unsigned thinking blocks are stripped from history before Anthropic sees them", () => {
  const rules = mergeRules();
  const body = { model: "claude-opus-5", max_tokens: 10, messages: [{ role: "user", content: "a" }, { role: "assistant", content: [{ type: "thinking", thinking: "cursor thought" }, { type: "text", text: "ok" }] }, { role: "assistant", content: [{ type: "thinking", thinking: "signed", signature: "sig" }, { type: "text", text: "ok2" }] }] };
  const r = shapeAnthropic({ body, rules, requested: parseModelSuffix("claude-opus-5", rules) });
  assert.deepEqual(r.body.messages[1].content, [{ type: "text", text: "ok" }]);
  assert.equal(r.body.messages[2].content.length, 2);
  assert.ok(r.changes.some((c) => c.includes("unsigned thinking")));
});

let app, port, dataDir, logFile, projDir, holdDir;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "filament-acp-")); projDir = join(dataDir, "project"); mkdirSync(projDir);
  holdDir = join(dataDir, "hold"); mkdirSync(holdDir);
  logFile = join(dataDir, "prompts.jsonl");
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  // This suite routes `agent/*` to its fake ACP upstream. The agent loop, always on (the owner's of 11-09), claims an
  // `agent/<model>` name only on a harness chat's turn or Filament's own call: a client's request reaches the fake, and
  // a harness chat here is on another route's name.
  // Memory ships on now (HarnessV3-AtHome AH-D1) and would hand every agent Filament's MCP server with its tools; this
  // suite counts the agent's servers and tools exactly, so memory is switched off here (memory.test.js covers that).
  cfg.memory.enabled = false;
  // The routes with backups below are tried: failover is off until switched on (the owner's of 11-09).
  cfg.rules.resilience.failover = true;
  cfg.upstreams = [{ id: "fake", name: "fake", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile }, cwdDefault: projDir, thoughts: "thinking-block", toolActivity: "text", permissions: "allow-all" } },
    // `hints: true` pinned: Filament's own voice is opt-in now (P2 — it used to be the default), and the hints test
    // below is specifically about that feature. Every other fake upstream leaves it off, which is the new default.
    { id: "fakecfg", name: "fake with config options", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile, FAKE_ACP_CONFIG: "1", FAKE_ACP_ALLOW_LOAD: "1" }, modelSelection: "session", cwdDefault: projDir, permissions: "allow-all", hints: true } }];
  cfg.upstreams.push({ id: "fakeparam", name: "fake with model parameters", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile, FAKE_ACP_PARAMS: "1" }, cwdDefault: projDir, permissions: "allow-all", hints: false } });
  // `timeoutMs`: the silence limit it had until no clock ended an agent's turn (HarnessV3-FailurePoints §4 B), kept
  // as the condition the quiet turn's test below failed under; nothing reads it now.
  cfg.upstreams.push({ id: "fakeslow", name: "fake that goes silent", type: "acp", timeoutMs: 2500, acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile, FAKE_ACP_HOLD_GATE: holdDir }, cwdDefault: projDir, permissions: "allow-all", hints: false } });
  cfg.upstreams.push({ id: "fakehk", name: "fake with a housekeeping model", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile }, cwdDefault: projDir, permissions: "allow-all", hints: false, housekeeping: "model", housekeepingModel: "agent/title-helper" } });
  cfg.upstreams.push({ id: "fakeask", name: "fake that asks", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile }, cwdDefault: projDir, permissions: "ask", hints: false } });
  cfg.upstreams.push({ id: "fakefull", name: "fake with the full client bridge", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile }, cwdDefault: projDir, permissions: "allow-all", hints: false, clientBridge: "full" } });
  cfg.upstreams.push({ id: "fakenative", name: "fake with the native toolset", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile }, cwdDefault: projDir, permissions: "allow-all", hints: false, clientBridge: "native", nativeTools: true } });
  // P9.2: the same native+steering configuration on an agent that DECLARES it cannot take HTTP MCP servers, and on one
  // that declares it can — the gate must skip the first and leave the second exactly as before.
  cfg.upstreams.push({ id: "fakenomcp", name: "fake that declares no HTTP MCP", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile, FAKE_ACP_MCP_CAPS: "none" }, cwdDefault: projDir, permissions: "allow-all", hints: false, clientBridge: "native", nativeTools: true, steering: true } });
  cfg.upstreams.push({ id: "fakehttpmcp", name: "fake that declares HTTP MCP", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile, FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: projDir, permissions: "allow-all", hints: false, clientBridge: "native", nativeTools: true } });
  cfg.upstreams.push({ id: "fakeauto", name: "fake with default thoughts", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile }, cwdDefault: projDir, permissions: "allow-all", hints: false } });
  cfg.upstreams.push({ id: "fakewait", name: "fake whose commands run long", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile }, cwdDefault: projDir, permissions: "allow-all", hints: false, clientBridge: "full" } });
  cfg.upstreams.push({ id: "fakefullno", name: "fake with the full client bridge that refuses", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: logFile }, cwdDefault: projDir, permissions: "reject", hints: false, clientBridge: "full" } });
  cfg.routes = [{ match: "agent/*", upstream: "fake", upstreamModel: "{1}", format: "auto" }, { match: "cfg/*", upstream: "fakecfg", upstreamModel: "{1}", format: "auto" }, { match: "cp/*", upstream: "fakeparam", upstreamModel: "{1}", format: "auto" }, { match: "slow/*", upstream: "fakeslow", upstreamModel: "{1}", format: "auto" }, { match: "hk/*", upstream: "fakehk", upstreamModel: "{1}", format: "auto" }, { match: "ask/*", upstream: "fakeask", upstreamModel: "{1}", format: "auto" }, { match: "full/*", upstream: "fakefull", upstreamModel: "{1}", format: "auto" }, { match: "native/*", upstream: "fakenative", upstreamModel: "{1}", format: "auto" }, { match: "nomcp/*", upstream: "fakenomcp", upstreamModel: "{1}", format: "auto" }, { match: "httpmcp/*", upstream: "fakehttpmcp", upstreamModel: "{1}", format: "auto" }];
  cfg.routes.push({ match: "auto/*", upstream: "fakeauto", upstreamModel: "{1}", format: "auto" });
  cfg.routes.push({ match: "wait/*", upstream: "fakewait", upstreamModel: "{1}", format: "auto" });
  cfg.routes.push({ match: "fullno/*", upstream: "fakefullno", upstreamModel: "{1}", format: "auto" });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0, heartbeatMs: 1000 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); rmSync(dataDir, { recursive: true, force: true }); });

const H = { "content-type": "application/json", authorization: "Bearer k" };
const prompts = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
/** A harness chat on a model, whose commands are Filament's. @param {string} model */
const harnessChat = async (model) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/sessions`, { method: "POST", headers: { ...H, "x-filament-ui": "1" }, body: JSON.stringify({ cwd: projDir, model, preset: "plain" }) });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** A harness chat's turn, and its reply in words. @param {string} id @param {string} content @param {Record<string, unknown>} [more] */
const harnessSays = async (id, content, more = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", headers: { ...H, "x-filament-ui": "1" }, body: JSON.stringify({ content, stream: false, ...more }) });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  return j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
};

test("anthropic streaming: thinking block, tool line, text, session reused on the next turn with only the newest message", async () => {
  const sys = `<env>\nWorking directory: ${projDir}\n</env>`;
  const r1 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "first question" }] }) });
  assert.equal(r1.status, 200); assert.ok(r1.headers.get("content-type").includes("text/event-stream"));
  const s1 = await r1.text();
  assert.ok(s1.includes('"type":"message_start"') && s1.includes('"thinking_delta"') && s1.includes("thinking about it"), s1.slice(0, 500));
  assert.ok(s1.includes("⚙ Read") && s1.includes("echo(1): ") && s1.includes('"stop_reason":"end_turn"') && s1.includes("message_stop"));
  const p1 = prompts(); assert.equal(p1.length, 1); assert.equal(p1[0].cwd, projDir); assert.equal(p1[0].model, "fake-a"); assert.equal(p1[0].text, "first question");
  // (fails before: no — a guard the mutation pass asked for: no agent here was asked for raw messages it never sends)
  assert.equal(p1[0].raw, false, "an agent that is not Claude's adapter is not asked for Claude's raw messages");

  const r2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 100, stream: false, system: sys, messages: [{ role: "user", content: "first question" }, { role: "assistant", content: [{ type: "thinking", thinking: "thinking about it" }, { type: "text", text: "echo(1): first question" }] }, { role: "user", content: "second question" }] }) });
  const j2 = await r2.json();
  assert.equal(j2.type, "message"); assert.equal(j2.content.at(-1).type, "text"); assert.ok(j2.content.at(-1).text.includes("echo(2): "), JSON.stringify(j2));
  const p2 = prompts(); assert.equal(p2.length, 2); assert.equal(p2[1].sessionId, p1[0].sessionId, "same session"); assert.equal(p2[1].text, "second question");
  const rec = app.usage.list(1)[0]; assert.equal(rec.status, "ok"); assert.ok(rec.changes.some((c) => c.includes("reused")));
});

// (fails before: yes — the bug hunt of 10-30, NEW-1: a coding agent's turn worked in the folder x-filament-cwd named,
// listed in agentLoop.roots or not, where Filament's own loop refused that folder)
test("a coding agent's turn in a folder outside agentLoop.roots is answered in the loop's words and the agent hears nothing; under a listed root it runs", async () => {
  const cfg = app.config;
  const roots = cfg.agentLoop.roots;
  const elsewhere = join(dataDir, "elsewhere");
  mkdirSync(elsewhere, { recursive: true });
  const ask = (/** @type {string} */ words) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-filament-cwd": projDir, "x-session-id": "roots-fence" }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 50, messages: [{ role: "user", content: words }] }) });
  const before = prompts().length;
  cfg.agentLoop.roots = [elsewhere];
  try {
    const r = await ask("work in the project");
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.content[0].text, `The working folder ${projDir} is not under any folder listed in agentLoop.roots, so nothing ran. Add it there (Settings → Agent loop) to allow it.`);
    assert.equal(prompts().length, before, "the agent was not asked");
    assert.ok(app.usage.list(1)[0].changes.includes("acp: refused — the working folder is outside agentLoop.roots; fake was not called"), JSON.stringify(app.usage.list(1)[0].changes));
    assert.equal((await (await ask("/sessions")).json()).content[0].text.startsWith("The working folder "), true, "a command of the agent's is refused there too");
    cfg.agentLoop.roots = [dataDir];
    const ok = await ask("work in the project");
    assert.equal(ok.status, 200);
    assert.equal(prompts().length, before + 1, "under a listed root the agent runs");
    assert.equal(prompts().at(-1).cwd, projDir);
  } finally {
    cfg.agentLoop.roots = roots;
  }
});

// (fails before: yes — the owner's of 11-09: a chat whose worktree was removed had its coding agent open a session in
// the home folder and work there, where Filament's own agent refuses the folder)
test("a coding agent's turn in a folder that is gone is answered in the loop's words and the agent hears nothing", async () => {
  const gone = join(dataDir, "removed-worktree");
  const ask = (/** @type {string} */ words) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-filament-cwd": gone, "x-session-id": "gone-folder" }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 50, messages: [{ role: "user", content: words }] }) });
  const before = prompts().length;
  const r = await ask("go on with the work");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).content[0].text, `The working folder does not exist on this machine: ${gone}. Nothing ran.`);
  assert.equal(prompts().length, before, "the agent was not asked");
  assert.ok(app.usage.list(1)[0].changes.includes("acp: refused — the working folder does not exist; fake was not called"), JSON.stringify(app.usage.list(1)[0].changes));
  assert.match((await (await ask("/sessions")).json()).content[0].text, /^The working folder does not exist/, "a command of the agent's is refused there too");
});

test("a coding agent answers a Responses-API client: JSON and the event stream", async () => {
  const sys = `Working directory: ${projDir}`;
  const r = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", headers: H, body: JSON.stringify({ model: "auto/fake-a", instructions: sys, input: "hello agent" }) });
  assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j.object, "response"); assert.equal(j.status, "completed"); assert.match(j.id, /^resp_/);
  assert.deepEqual(j.output.map((it) => it.type), ["reasoning", "message"]); assert.equal(j.output[0].summary[0].text, "thinking about it"); assert.ok(j.output[1].content[0].text.includes("echo(1): hello agent"), j.output[1].content[0].text);
  assert.ok(j.usage.input_tokens > 0, "the estimated input count reaches the Responses usage");
  assert.equal(prompts().at(-1).cwd, projDir, "the working directory comes from instructions");
  const s = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", headers: H, body: JSON.stringify({ model: "auto/fake-a", instructions: sys, input: [{ role: "user", content: [{ type: "input_text", text: "again" }] }], stream: true }) });
  assert.ok(s.headers.get("content-type").includes("text/event-stream"));
  const text = await s.text(); const types = text.split("\n").filter((l) => l.startsWith("event: ")).map((l) => l.slice(7));
  assert.equal(types[0], "response.created"); assert.ok(types.includes("response.reasoning_summary_text.delta")); assert.ok(types.includes("response.output_text.delta")); assert.equal(types.at(-1), "response.completed");
  const events = text.split("\n\n").filter((b) => b.includes("data:")).map((b) => JSON.parse(b.split("\n").find((l) => l.startsWith("data:")).slice(5)));
  const streamed = events.filter((e) => e.type === "response.output_text.delta").map((e) => e.delta).join(""); assert.ok(streamed.includes("echo(1): again"), streamed); // a new first message = a new agent conversation
  const finalText = events.at(-1).response.output.find((it) => it.type === "message").content[0].text; assert.equal(finalText, streamed, "the completed response carries the same text the deltas streamed");
  const rec = app.usage.list(1)[0]; assert.equal(rec.api, "responses"); assert.ok(rec.changes.some((c) => c.includes("Responses API")));
});

/** The slow agent's reply, read as it comes: `text` so far, and `at(words)` when its words first came (0 until then). @param {Response} r */
const reading = (r) => {
  const reader = /** @type {ReadableStream<Uint8Array>} */ (r.body).getReader(); const dec = new TextDecoder();
  const seen = { text: "", /** @type {Map<string, number>} */ firsts: new Map() };
  const done = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) break; seen.text += dec.decode(value, { stream: true }); for (const w of ["thinking about it", ": keep-alive"]) if (!seen.firsts.has(w) && seen.text.includes(w)) seen.firsts.set(w, performance.now()); } })();
  return { done, get text() { return seen.text; }, at: (/** @type {string} */ words) => seen.firsts.get(words) || 0 };
};

// (fails before: yes — the review of 11-11: a fixed sleep read the view at 1250 ms, where a loaded machine had the agent
// speak already, or the ping not yet gone; now the agent says nothing until the test has read the view, which it reads
// once the ping has reached it)
test("a heartbeat ping is not the reply: the request stays pending until the agent's first output", async () => {
  // The first ping opens the stream: the test server pings after 1 s of silence, and the agent stays quiet until the test lets it (FAKE_ACP_HOLD_GATE).
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "slow/fake-a", stream: true, messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "~slowstart please" }] }) });
  const reply = reading(r);
  let live;
  try {
    await until(() => reply.at(": keep-alive"), "the ping", { timeoutMs: 30_000 });
    live = (await (await fetch(`http://127.0.0.1:${port}/api/live`)).json()).active.find((r) => r.model === "slow/fake-a");
    assert.ok(live, "the request is in the live list"); assert.equal(live.phase, "pending"); assert.equal(live.ttftMs, null); assert.ok(live.elapsedMs >= 1000, `the ping came after a second of silence: ${live.elapsedMs} ms`);
  } finally {
    writeFileSync(join(holdDir, "slowstart"), "");
  }
  await reply.done; assert.ok(reply.text.includes("echo(1): "), reply.text.slice(0, 300));
  // Its first output came once the view was read, the ping before it.
  const rec = app.usage.list(1)[0]; assert.ok(rec.ttftMs > live.elapsedMs, `first byte is the agent's first output (${rec.ttftMs} ms), not the ping (before ${live.elapsedMs} ms)`);
});

// (fails before: yes — the review of 11-11: a fixed sleep read the view at 1300 ms, where a loaded machine had the agent
// still at its tool, or not yet asked; now the agent drips until the test has read the view, read once it says the reply
// is in the stage this is about)
test("while the reply streams, the live view shows the speed over the last second, the stage and no pause", async () => {
  // The agent thinks, reads a file, then drips a chunk every 200 ms until the test lets it end (FAKE_ACP_HOLD_GATE).
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "slow/fake-a", stream: true, messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "~drip please" }] }) });
  const reply = reading(r);
  let asked = 0;
  let live;
  try {
    // Answering, writing long enough to have a speed of its own, its last words within the second: read in that stage.
    live = await until(async () => {
      if (!reply.at("thinking about it")) return null;
      asked = performance.now();
      const l = (await (await fetch(`http://127.0.0.1:${port}/api/live`)).json()).active.find((r) => r.model === "slow/fake-a");
      return l?.stage === "answering" && l.liveTpsWriting > 0 && l.sinceOutputMs < 1000 ? l : null;
    }, "the reply answering a while, its last words within the second", { timeoutMs: 30_000 });
  } finally {
    writeFileSync(join(holdDir, "drip"), "");
  }
  // Its first byte is its first output, the thought the client had before the view was asked: no later one's.
  assert.equal(live.phase, "streaming"); assert.ok(live.elapsedMs - live.ttftMs > asked - reply.at("thinking about it") - 1, `first byte at ${live.ttftMs} ms of ${live.elapsedMs}`); assert.ok(live.streamMs > 0);
  // Words within the last second: a speed over it, and no pause — the time since the last words, not since the first.
  assert.ok(live.liveTpsNow > 0, `speed over the last second: ${live.liveTpsNow}`); assert.ok(live.liveTps > 0); assert.equal(live.stalled, false); assert.ok(live.sinceOutputMs < live.streamMs, `${live.sinceOutputMs} ms since the last words, ${live.streamMs} ms streamed`);
  assert.ok(live.liveTpsWriting > 0, `and its speed while writing, what the tray shows between words: ${live.liveTpsWriting}`);
  assert.ok(live.liveOutTokens > 0 && live.liveThinkTokens >= 1, "output so far, thinking counted separately");
  await reply.done; assert.ok(reply.text.includes("tick 1 ") && reply.text.includes("echo(1): "), reply.text.slice(-300));
});

test("thought order: an OpenAI-format client gets later thoughts woven into the text; an Anthropic-format client gets thinking blocks in order", async () => {
  const sys = `Working directory: ${projDir}`;
  const openaiDeltas = async (model, text) => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: sys }, { role: "user", content: text }] }) });
    assert.equal(r.status, 200);
    return (await r.text()).split("\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]")).map((l) => JSON.parse(l.slice(6)).choices?.[0]?.delta).filter(Boolean);
  };
  // auto + OpenAI format: reasoning_content only until the first text, then the second thought as a quoted paragraph, in order
  const d1 = await openaiDeltas("auto/fake-a", "~rethink please");
  const kinds = d1.map((d) => (d.reasoning_content ? "R" : typeof d.content === "string" && d.content ? "T" : "")).join("");
  assert.match(kinds, /^R+T+$/, `reasoning first, then only text: ${kinds}`);
  const text = d1.map((d) => d.content || "").join(""), reasoning = d1.map((d) => d.reasoning_content || "").join("");
  assert.equal(reasoning, "thinking about it");
  const i1 = text.indexOf("echo(1): "), i2 = text.indexOf("\n\n> 💭 second thought, two lines\n> line two\n\nafter rethink");
  assert.ok(i1 >= 0 && i2 > i1, JSON.stringify(text));
  const rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((c) => c.includes("woven into the text")), rec.changes.join(" | "));
  // auto + Anthropic format: thinking, text, thinking, text as four blocks in that order
  const a = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "auto/fake-a", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "~rethink please" }] }) });
  const blocks = (await a.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))).filter((e) => e.type === "content_block_start").map((e) => e.content_block.type);
  assert.deepEqual(blocks, ["thinking", "text", "thinking", "text"], blocks.join(","));
  // explicit thinking-block: every thought stays reasoning_content in an OpenAI stream too
  const d2 = await openaiDeltas("agent/fake-a", "~rethink again");
  assert.ok(d2.map((d) => d.reasoning_content || "").join("").includes("second thought"), "thinking-block keeps later thoughts as reasoning_content");
  assert.ok(!d2.map((d) => d.content || "").join("").includes("💭"));
  // non-streaming auto + OpenAI: the first thought is reasoning_content, the later one sits inside the content, in order
  const r3 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "auto/fake-a", stream: false, messages: [{ role: "system", content: sys }, { role: "user", content: "~rethink once more" }] }) });
  const j3 = await r3.json(); assert.equal(j3.choices[0].message.reasoning_content, "thinking about it");
  assert.ok(j3.choices[0].message.content.includes("echo(1): ") && j3.choices[0].message.content.indexOf("> 💭 second thought") > j3.choices[0].message.content.indexOf("echo(1): "), j3.choices[0].message.content);
});

test("openai format, model switch mid-conversation seeds a new session with the earlier turns, permission auto-approved", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-b", stream: false, messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "start here" }, { role: "assistant", content: "some earlier answer from claude" }, { role: "user", content: "please ask for perm now" }] }) });
  const j = await r.json();
  // allow-all answers with the agent's allow-once, never its "always" (the bug hunt of 10-30, AGT-1)
  assert.equal(j.object, "chat.completion"); assert.ok(j.choices[0].message.content.includes("permission:allow "), j.choices[0].message.content);
  assert.ok(j.choices[0].message.reasoning_content.includes("thinking about it"));
  const last = prompts().at(-1);
  assert.equal(last.model, "fake-b");
  assert.ok(last.text.includes("Earlier conversation") && last.text.includes("some earlier answer from claude") && last.text.endsWith("please ask for perm now"), last.text);
  const rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((c) => c.includes("new session") && c.includes("seeded")));
});

test("@mode suffix switches the session mode mid-conversation and is not sent as part of the model id", async () => {
  const sys = `Working directory: ${projDir}`;
  const msgs = [{ role: "user", content: "mode test start" }];
  const r1 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 50, system: sys, messages: msgs }) });
  assert.equal(r1.status, 200); const j1 = await r1.json();
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a@ask", max_tokens: 50, system: sys, messages: [...msgs, { role: "assistant", content: j1.content }, { role: "user", content: "now in ask mode" }] }) });
  assert.equal(r2.status, 200);
  const rec = app.usage.list(1)[0];
  assert.equal(rec.upstreamModel, "fake-a");
  assert.ok(rec.changes.some((c) => c.includes("reused")) && rec.changes.some((c) => c.includes("mode agent -> ask")), rec.changes.join(" | "));
  assert.equal(prompts().at(-1).model, "fake-a");
});

test("input_tokens are estimated so the client's context meter moves; count_tokens works for ACP routes", async () => {
  const long = "x".repeat(4000);
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: long }] }) });
  const j = await r.json();
  // The class-weighted estimate: a pathological single-letter run counts at ~3.5 chars/token, so 4,000 x's land
  // near 1,150 — the band says "roughly the text's density, not its base64 length or zero".
  assert.ok(j.usage.input_tokens >= 1000 && j.usage.input_tokens <= 1250, `input_tokens=${j.usage.input_tokens}`);
  assert.ok(j.usage.output_tokens > 0);
  const c = await fetch(`http://127.0.0.1:${port}/v1/messages/count_tokens`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", messages: [{ role: "user", content: long }] }) });
  assert.equal(c.status, 200); const cj = await c.json(); assert.ok(cj.input_tokens >= 1000, JSON.stringify(cj));
  const o = await (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: long }] }) })).json();
  assert.ok(o.usage.prompt_tokens >= 1000 && o.usage.total_tokens > o.usage.prompt_tokens);
});

test("effortTemplate turns a suffix or client effort into the agent's model id; without it effort is only noted", async () => {
  const fake = app.config.upstreams.find((u) => u.id === "fake");
  fake.acp.effortTemplate = "{model}[effort={effort}]";
  await (await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a-xhigh", max_tokens: 20, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "effort via suffix" }] }) })).json();
  assert.equal(prompts().at(-1).model, "fake-a[effort=xhigh]");
  assert.ok(app.usage.list(1)[0].changes.some((c) => c.includes("effort xhigh (from model suffix)")));
  await (await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, output_config: { effort: "high" }, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "effort via client field" }] }) })).json();
  assert.equal(prompts().at(-1).model, "fake-a[effort=high]");
  fake.acp.effortTemplate = "";
  await (await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, output_config: { effort: "high" }, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "effort ignored" }] }) })).json();
  assert.equal(prompts().at(-1).model, "fake-a");
  assert.ok(app.usage.list(1)[0].changes.some((c) => c.includes("not applied")));
});

test("modelSelection = session uses one process and session/set_model", async () => {
  const fake = app.config.upstreams.find((u) => u.id === "fake");
  fake.acp.modelSelection = "session";
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-b", max_tokens: 20, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "session model selection" }] }) });
  assert.equal(r.status, 200);
  assert.equal(prompts().at(-1).model, "fake-b");
  assert.ok(app.usage.list(1)[0].changes.some((c) => c.includes("-> fake-b")), app.usage.list(1)[0].changes.join(" | "));
  fake.acp.modelSelection = "arg";
});

test("counting is local only: no provider is ever contacted for a token count", async () => {
  const http = await import("node:http");
  let hits = 0;
  const counter = http.createServer((req, res) => { hits++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ input_tokens: 4242 })); });
  await new Promise((r) => counter.listen(0, "127.0.0.1", r));
  const cfg = app.config; cfg.upstreams.push({ id: "anth", name: "a", type: "anthropic", baseUrl: `http://127.0.0.1:${counter.address().port}`, apiKey: "k", enabled: true });
  try {
    const j = await (await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "count me" }] }) })).json();
    assert.ok(j.usage.input_tokens > 0, "the turn still reports a count");
    assert.notEqual(j.usage.input_tokens, 4242, "the count is the local estimate, not the counter's answer");
    const c = await (await fetch(`http://127.0.0.1:${port}/v1/messages/count_tokens`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", messages: [{ role: "user", content: "count me" }] }) })).json();
    assert.ok(Number.isFinite(c.input_tokens) && c.input_tokens > 0, "the endpoint answers locally");
    assert.equal(hits, 0, "the counting upstream received nothing — counting is not a data pump");
  } finally { cfg.upstreams.splice(cfg.upstreams.findIndex((u) => u.id === "anth"), 1); counter.close(); }
});

test("client session header keys the conversation; different ids never share a session; images and MCP servers pass through", async () => {
  const fake = app.config.upstreams.find((u) => u.id === "fake"); fake.acp.mcpServers = [{ name: "mem", command: "node", args: ["x.js"], env: { A: "1" } }];
  const sys = `Working directory: ${projDir}`; const same = [{ role: "user", content: [{ type: "text", text: "identical opening line" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } }] }];
  const send = (sid) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": sid }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: same }) }).then((r) => r.json());
  await send("sess_one"); const a = prompts().at(-1); await send("sess_two"); const b = prompts().at(-1); await send("sess_one"); const c = prompts().at(-1);
  assert.notEqual(a.sessionId, b.sessionId, "different client sessions must not share an agent session");
  assert.equal(a.sessionId, c.sessionId, "same client session id reuses the agent session");
  assert.equal(a.images, 1); assert.equal(a.mcp, 1);
  assert.ok(app.usage.list(1)[0].changes.some((x) => x.includes("client session id")));
  fake.acp.mcpServers = [];
});

test("files attached to the last message reach the agent: inlined as text when it lacks embeddedContext, embedded when it has it; agent slash commands are recorded", async () => {
  const sys = `Working directory: ${projDir}`;
  const content = [{ type: "text", text: "summarize the attachment" }, { type: "document", title: "notes.txt", source: { type: "text", media_type: "text/plain", data: "alpha beta gamma" } }, { type: "document", title: "spec.pdf", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } }, { type: "document", title: "blob.bin", source: { type: "base64", media_type: "application/octet-stream", data: "AAEC" } }];
  await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "files-1" }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content }] }) }).then((r) => r.json());
  const p1 = prompts().at(-1);
  assert.ok(p1.text.includes("--- Attached file: notes.txt ---\nalpha beta gamma"), "text file inlined into the prompt");
  assert.ok(p1.text.includes('attached a file "blob.bin"'), "binary file announced, not silently dropped");
  // A PDF reaches an agent as its text (pdf-attachment.test.js); this one is no PDF pdftotext reads, and says so.
  assert.ok(p1.text.includes('attached the PDF "spec.pdf"'), "the PDF announced, not silently dropped");
  assert.equal(p1.resources, 0);
  const rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((x) => /1 file\(s\) inlined/.test(x)) && rec.changes.some((x) => /1 binary file/.test(x)) && rec.changes.some((x) => /^pdf: "spec\.pdf" sent as its text/.test(x)));
  const commands = await until(async () => {
    const st = await fetch(`http://127.0.0.1:${port}/api/acp/status`).then((r) => r.json());
    const listed = st.conversations.find((c) => c.sessionId === p1.sessionId)?.commands;
    return listed?.length ? listed : null;
  }, "the agent to publish its commands");
  assert.deepEqual(commands, ["review", "commit"]);
  // unit level: an agent with embeddedContext gets ACP resource blocks instead
  const att = extractAttachments("anthropic", { messages: [{ role: "user", content }] }, { image: true, embeddedContext: true });
  assert.equal(att.blocks.length, 3); assert.equal(att.blocks[0].resource.text, "alpha beta gamma"); assert.equal(att.blocks[1].resource.mimeType, "application/pdf"); assert.equal(att.blocks[1].resource.blob, "JVBERi0="); assert.equal(att.blocks[2].resource.blob, "AAEC"); assert.equal(att.inlineText, "");
  // OpenAI shape: file parts and image_url; images dropped with a note when the agent cannot take them
  const oa = extractAttachments("openai", { messages: [{ role: "user", content: [{ type: "text", text: "x" }, { type: "file", file: { filename: "a.json", file_data: "data:application/json;base64," + Buffer.from("{\"k\":1}").toString("base64") } }, { type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } }] }] }, { image: false });
  assert.ok(oa.inlineText.includes('Attached file: a.json') && oa.inlineText.includes('{"k":1}')); assert.ok(oa.notes.some((n) => /image\(s\) dropped/.test(n)));
});

test("input token estimate counts an image as ~1,500 tokens, not its base64 length", () => {
  const big = "A".repeat(400000);
  const withImage = estimateBodyTokens({ messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", source: { type: "base64", media_type: "image/png", data: big } }] }] });
  assert.ok(withImage > 1400 && withImage < 1700, `got ${withImage}`);
  const textDoc = estimateBodyTokens({ messages: [{ role: "user", content: [{ type: "document", source: { type: "text", media_type: "text/plain", data: "x".repeat(4000) } }] }] });
  assert.ok(textDoc >= 1100 && textDoc <= 1200, `got ${textDoc}`); // ~3.5 chars/token for a single-letter run
});

test("agents that expose model and effort as session config options: both are set per turn, names are matched loosely, models are advertised", async () => {
  const sys = `Working directory: ${projDir}`; const H2 = { ...H, "x-session-id": "cfg-1" };
  let r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H2, body: JSON.stringify({ model: "cfg/sonnet-xhigh", max_tokens: 20, system: sys, messages: [{ role: "user", content: "one" }] }) }); assert.equal(r.status, 200); await r.text();
  let p1 = prompts().at(-1); assert.equal(p1.config?.model, "sonnet"); assert.equal(p1.config?.effort, "xhigh");
  let rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((c) => /model sonnet \(effort xhigh\)/.test(c)), rec.changes.join("; "));
  // "opus" is not an exact id; the closest offered one is opus[1m]. Client effort (output_config) is honoured too.
  r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H2, body: JSON.stringify({ model: "cfg/opus", max_tokens: 20, system: sys, output_config: { effort: "low" }, messages: [{ role: "user", content: "one" }, { role: "assistant", content: "echo" }, { role: "user", content: "two" }] }) }); assert.equal(r.status, 200); await r.text();
  p1 = prompts().at(-1); assert.equal(p1.config?.model, "opus[1m]"); assert.equal(p1.config?.effort, "low");
  rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((c) => /model sonnet -> opus\[1m\] \(closest match for opus\)/.test(c)), rec.changes.join("; "));
  // The agent's model list is discovered by an explicit Refresh only (the owner's rule), never by a read.
  await fetch(`http://127.0.0.1:${port}/api/models?refresh=1`);
  const m = await fetch(`http://127.0.0.1:${port}/api/models`).then((x) => x.json());
  const ids = m.models.filter((x) => x.upstream === "fakecfg").map((x) => x.id); assert.ok(ids.includes("cfg/sonnet") && ids.includes("cfg/opus[1m]") && !ids.includes("cfg/default"), ids.join(","));
  // In the agent's own words (HarnessV3-ACP AF2): its name and description on its rows, and on the picker's families.
  const opus = m.models.find((x) => x.id === "cfg/opus[1m]");
  assert.deepEqual([opus?.label, opus?.note], ["Opus (1M context)", "Opus 5 with 1M context · Best for everyday, complex tasks"]);
  assert.deepEqual(m.families.filter((f) => f.upstream === "fakecfg").map((f) => [f.id, f.label]), [["cfg/opus[1m]", "Opus (1M context)"], ["cfg/sonnet", "Sonnet 5"]]);
});

// (fails before: yes — a name that carries a version took a model of another: claude-opus-5-5 ran as the adapter's
// opus[1m], which its own words call Opus 5, as its "closest match")
test("a model name that carries its version runs only as a model of that version, in the agent's own words (the bug report's O1)", async () => {
  const sys = `Working directory: ${projDir}`;
  const ask = async (model, messages) => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "cfg-o1" }, body: JSON.stringify({ model, max_tokens: 20, system: sys, messages }) });
    assert.equal(r.status, 200);
    await r.text();
    return app.usage.list(1)[0];
  };
  let rec = await ask("cfg/claude-opus-5-5", [{ role: "user", content: "one" }]);
  assert.ok(rec.changes.includes("acp: model claude-opus-5-5 not offered by this agent (offers default, opus[1m], sonnet); keeping default"), rec.changes.join("; "));
  assert.equal(prompts().at(-1).config?.model, undefined, "the session's model left as it was");
  rec = await ask("cfg/claude-opus-5", [{ role: "user", content: "one" }, { role: "assistant", content: "echo" }, { role: "user", content: "two" }]);
  assert.ok(rec.changes.includes("acp: model default -> opus[1m] (closest match for claude-opus-5)"), rec.changes.join("; "));
  assert.equal(prompts().at(-1).config?.model, "opus[1m]");
  // (fails before: no — a guard the mutation pass asked for: no turn asked for a model by its version after the agent's
  // answer to a change named its ids alone, and none took a name apart by the agent's words)
  const three = [{ role: "user", content: "one" }, { role: "assistant", content: "echo" }, { role: "user", content: "two" }, { role: "assistant", content: "echo" }, { role: "user", content: "three" }];
  rec = await ask("cfg/claude-sonnet-5", three);
  assert.ok(rec.changes.includes("acp: model opus[1m] -> sonnet (closest match for claude-sonnet-5)"), rec.changes.join("; "));
  rec = await ask("cfg/sonnet-5-high", [...three, { role: "assistant", content: "echo" }, { role: "user", content: "four" }]);
  assert.ok(rec.changes.includes("acp: model sonnet (effort high)"), rec.changes.join("; "));
  assert.deepEqual([prompts().at(-1).config?.model, prompts().at(-1).config?.effort], ["sonnet", "high"]);
});

test("a #sessionid suffix continues a session the agent already has; the sessions can be listed", async () => {
  const sys = `Working directory: ${projDir}`;
  const l = await fetch(`http://127.0.0.1:${port}/api/acp/fakecfg/sessions`).then((r) => r.json()); assert.ok(l.ok && l.sessions.some((x) => x.sessionId === "sess_old1" && x.title === "Old chat from the terminal"), JSON.stringify(l));
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "resume-1" }, body: JSON.stringify({ model: "cfg/sonnet-high#sess_old1", max_tokens: 20, system: sys, messages: [{ role: "user", content: "earlier" }, { role: "assistant", content: "x" }, { role: "user", content: "continue please" }] }) });
  assert.equal(r.status, 200); await r.text();
  const p1 = prompts().at(-1); assert.equal(p1.sessionId, "sess_old1"); assert.equal(p1.loaded, true); assert.equal(p1.text, "continue please", "history is not re-sent on a resumed session"); assert.equal(p1.config?.model, "sonnet"); assert.equal(p1.config?.effort, "high");
  const rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((c) => /resumed agent session sess_old/.test(c)), rec.changes.join("; "));
  // second message in the same client chat keeps using the resumed session without another load
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "resume-1" }, body: JSON.stringify({ model: "cfg/sonnet#sess_old1", max_tokens: 20, system: sys, messages: [{ role: "user", content: "and more" }] }) }); await r2.text();
  const p2 = prompts().at(-1); assert.equal(p2.sessionId, "sess_old1"); assert.ok(app.usage.list(1)[0].changes.some((c) => /session sess_old reused/.test(c)));
  // unknown id: a fresh session with a note, never an error
  const r3 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "resume-2" }, body: JSON.stringify({ model: "cfg/sonnet#nope1234", max_tokens: 20, system: sys, messages: [{ role: "user", content: "hi" }] }) }); assert.equal(r3.status, 200); await r3.text();
  assert.ok(app.usage.list(1)[0].changes.some((c) => /no agent session matches "nope1234"/.test(c)));
});

test("exact usage from the agent replaces the estimate; an outside client's /sessions, /compact and /new go to the agent as typed", async () => {
  const sys = `Working directory: ${projDir}`; const H3 = { ...H, "x-session-id": "usage-1" };
  let r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H3, body: JSON.stringify({ model: "cfg/sonnet", max_tokens: 20, system: sys, messages: [{ role: "user", content: "count me" }] }) }); assert.equal(r.status, 200); const j = await r.json();
  assert.deepEqual(j.usage, { input_tokens: 24527, output_tokens: 46, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, "the wire shows the agent's context (usage_update: 24,627 used); the record below keeps the billed numbers");
  let rec = app.usage.list(1)[0]; assert.equal(rec.estimatedTokens, false); assert.equal(rec.tokens.cacheWrite, 24471); assert.deepEqual([rec.billing, rec.cost, rec.listCost], ["plan", 0, 0.0309], "the agent's own price: a plan paid it, and it is what the turn was worth"); assert.equal(rec.contextUsed, 24627); assert.equal(rec.contextSize, 200000); assert.ok(rec.changes.some((c) => /usage reported by the agent.*context 24,627 of 200,000 tokens \(12%\)/.test(c)), rec.changes.join("; "));
  const before = prompts().length; const session = prompts().at(-1).sessionId;
  for (const words of ["/sessions", "/compact", "/new"]) {
    r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H3, body: JSON.stringify({ model: "cfg/sonnet", max_tokens: 20, system: sys, messages: [{ role: "user", content: words }] }) });
    const said = (await r.json()).content.map((b) => b.text || "").join("");
    assert.ok(said.endsWith(words) && !said.includes("Old chat from the terminal") && !said.includes("context is at"), said);
    assert.deepEqual([prompts().at(-1).prompt, prompts().at(-1).sessionId], [words, session], "the agent heard it as typed, in the chat's session");
  }
  assert.equal(prompts().length, before + 3);
  // In a harness chat they are Filament's.
  const id = await harnessChat("cfg/sonnet");
  await harnessSays(id, "count me");
  const heard = prompts().length;
  const listed = await harnessSays(id, "/sessions");
  assert.ok(listed.includes("Old chat from the terminal") && listed.includes("/resume sess_old") && listed.includes("cfg/sonnet#sess_"), listed);
  assert.ok((await harnessSays(id, "/compact")).includes("context is at 24,627 of 200,000 tokens (12%)"), "explained where the agent has no such command");
  assert.ok((await harnessSays(id, "/new")).includes("fresh"));
  assert.equal(prompts().length, heard, "the agent was not called");
  // The chat's session let go of, the harness asks before the next message; sent as it is, it opens a new one.
  await harnessSays(id, "after new", { sendAsIs: true });
  assert.ok(app.usage.list(1)[0].changes.some((c) => /new session/.test(c)), "after /new the next message opens a new session");
});

test("/api/acp/:id/offer describes what an agent offers: modes, models, efforts, commands, its profile", async () => {
  const o = await fetch(`http://127.0.0.1:${port}/api/acp/fakecfg/offer`).then((r) => r.json());
  assert.equal(o.ok, true); assert.deepEqual(o.modes.map((m) => m.id), ["default", "plan", "bypassPermissions"]); assert.deepEqual(o.models, ["default", "opus[1m]", "sonnet"]); assert.deepEqual(o.efforts, ["default", "low", "high", "xhigh"]);
  assert.ok(o.commands.some((c) => c.name === "review")); assert.equal(o.profile.prompt.image, true); assert.equal(o.profile.sessions.load, true); assert.equal(o.prefix, "cfg/"); assert.ok(o.configOptions.some((c) => c.id === "effort"));
});

test("client <system-reminder> blocks are stripped before the agent sees the text, so a typed /sessions reaches it alone", async () => {
  const sys = `Working directory: ${projDir}`; const rem = (t) => ({ type: "text", text: `<system-reminder>\n${t}\n</system-reminder>` });
  let r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "rem-1" }, body: JSON.stringify({ model: "cfg/sonnet", max_tokens: 20, system: sys, messages: [{ role: "user", content: [rem("skills available: a, b"), rem("Today's date is 2026-09-13."), { type: "text", text: "/sessions" }] }] }) });
  await r.json(); assert.equal(prompts().at(-1).prompt, "/sessions", "the command as typed, the reminders left out");
  r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "rem-1" }, body: JSON.stringify({ model: "cfg/sonnet", max_tokens: 20, system: sys, messages: [{ role: "user", content: [rem("memory recall: irrelevant"), { type: "text", text: "real question" }] }] }) }); await r.json();
  const p1 = prompts().at(-1); assert.equal(p1.text, "real question"); assert.ok(app.usage.list(1)[0].changes.some((c) => /1 <system-reminder> block\(s\) from the client removed/.test(c)));
});

test("in a harness chat /status, /help and /commands are Filament's; an outside client's go to the agent as typed, any /word with a note", async () => {
  const id = await harnessChat("cfg/sonnet-high");
  await harnessSays(id, "warm up");
  await new Promise((r) => setTimeout(r, 60)); // the fake publishes its commands a few ms after session/new; a real turn takes far longer
  const before = prompts().length;
  const t = await harnessSays(id, "/status");
  assert.ok(t.includes("agent model `sonnet`") && t.includes("effort: high") && t.includes("context: 24,627 of 200,000") && t.includes("commands published: 2"), t);
  assert.ok(t.includes("fake with config options 1.0 (fake-acp)") && t.includes("this session: 1 Filament request(s)") && t.includes("out tokens · $0.0309 at list price, paid by the plan") && t.includes("MCP servers passed to the agent: none"), t);
  const help = await harnessSays(id, "/help");
  assert.ok(help.includes("/review, /commit"), help);
  // (fails before: yes — the review of 12332341d: the harness /help ended "Full cheat sheet: Upstreams page → … “How to
  // use … from <client>”", a card for outside clients' chats, which offer none of these commands)
  assert.ok(!help.includes("from your chat client"), help);
  const listed = await harnessSays(id, "/commands");
  assert.ok(listed.includes("- `/review` — Review the diff") && listed.includes("2 commands") && listed.includes("/sessions"), listed);
  // a brand-new chat has no session yet: /commands asks the agent directly
  const fresh = await harnessSays(await harnessChat("cfg/sonnet"), "/commands");
  assert.ok(fresh.includes("asked the agent just now") && fresh.includes("/commit"), fresh);
  assert.equal(prompts().length, before, "the agent was not called");
  const sys = `Working directory: ${projDir}`; const H4 = { ...H, "x-session-id": "status-1" };
  /** @param {string} words */
  const send = (words) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H4, body: JSON.stringify({ model: "cfg/sonnet", max_tokens: 20, system: sys, messages: [{ role: "user", content: words }] }) }).then((r) => r.json());
  await send("warm up");
  await new Promise((r) => setTimeout(r, 60));
  for (const words of ["/status", "/help", "/commands"]) {
    const said = (await send(words)).content.map((b) => b.text || "").join("");
    assert.ok(said.endsWith(words) && !said.includes("Filament status for this chat"), said);
    assert.equal(prompts().at(-1).prompt, words, "the agent heard it as typed");
    // (fails before: yes — the review of 11-01's hang-up round: Traffic said an outside client's Filament word was no
    // Filament command)
    assert.ok(app.usage.list(1)[0].changes.includes(`acp: ${words} is Filament's in its own chats; an outside client's goes to the agent as text (not among the 2 the agent published)`), app.usage.list(1)[0].changes.join(" | "));
  }
  await send("/review please");
  assert.equal(prompts().at(-1).prompt, "/review please"); assert.ok(app.usage.list(1)[0].changes.some((c) => /\/review is a command published by the agent; passed through/.test(c)));
  await send("/nonsense");
  assert.ok(app.usage.list(1)[0].changes.some((c) => /\/nonsense is not a Filament command and not among the 2 the agent published; sent to the agent as text/.test(c)));
});

test("a harness chat's /resume attaches it, or explains why it cannot (session open elsewhere, unknown id) without prompting the agent; an outside client's goes to the agent as typed", async () => {
  const id = await harnessChat("cfg/sonnet");
  const before = prompts().length;
  let t = await harnessSays(id, "/resume sess_busy");
  assert.ok(t.includes("still open in a Claude Code terminal") && t.includes("claude stop sess_bus"), t); assert.equal(prompts().length, before, "no prompt sent");
  t = await harnessSays(id, "/resume zzz");
  assert.ok(t.includes('no session matches "zzz"'), t); assert.equal(prompts().length, before);
  // by title words: unique -> attaches; ambiguous -> lists the candidates
  t = await harnessSays(id, "/resume terminal");
  assert.ok(t.includes("matches 2 sessions") && t.includes("Old chat from the terminal") && t.includes("Open in a terminal"), t); assert.equal(prompts().length, before);
  t = await harnessSays(id, "/resume old chat");
  assert.ok(t.startsWith("Attached to **Old chat from the terminal** (sess_old"), t); assert.equal(prompts().at(-1).sessionId, "sess_old1");
  await harnessSays(id, "/resume sess_old2");
  const p1 = prompts().at(-1); assert.equal(p1.sessionId, "sess_old2"); assert.equal(p1.loaded, true); assert.ok(p1.text.includes("remind me where we left off")); assert.ok(app.usage.list(1)[0].changes.some((c) => /attached this chat to session sess_old/.test(c)));
  const sys = `Working directory: ${projDir}`;
  const j = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "resume-cmd-1" }, body: JSON.stringify({ model: "cfg/sonnet", max_tokens: 20, system: sys, messages: [{ role: "user", content: "/resume sess_old1" }] }) }).then((r) => r.json());
  assert.ok(!j.content.map((b) => b.text || "").join("").includes("Attached to"), JSON.stringify(j.content));
  assert.equal(prompts().at(-1).prompt, "/resume sess_old1", "the agent heard it as typed");
  assert.notEqual(prompts().at(-1).sessionId, "sess_old1", "in a session of the chat's own");
});

test("switching away to another model and back: the agent session is handed the turns it missed", async () => {
  const sys = `Working directory: ${projDir}`; const H6 = { ...H, "x-session-id": "switch-1" };
  await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H6, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "first with the agent" }] }) }).then((r) => r.json());
  const p1 = prompts().at(-1); assert.equal(p1.text, "first with the agent");
  // the client then talked to some API model for two turns (Filament never saw them on this session), now back to the agent
  const hist = [{ role: "user", content: "first with the agent" }, { role: "assistant", content: "echo(1): first with the agent" }, { role: "user", content: "now with claude please" }, { role: "assistant", content: "Claude answered about apples" }, { role: "user", content: "and one more for claude" }, { role: "assistant", content: "Claude answered about pears" }, { role: "user", content: "back to you, agent" }];
  await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H6, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: hist }) }).then((r) => r.json());
  const p2 = prompts().at(-1); assert.equal(p2.sessionId, p1.sessionId, "same agent session reused");
  assert.ok(p2.text.includes("Meanwhile, this conversation continued with another assistant") && p2.text.includes("apples") && p2.text.includes("pears") && p2.text.endsWith("back to you, agent"), p2.text);
  assert.ok(!p2.text.includes("first with the agent"), "turns the session already saw are not repeated");
  assert.ok(app.usage.list(1)[0].changes.some((c) => /2 turn\(s\) handled elsewhere/.test(c)));
  // a normal follow-up sends only the new message again
  await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H6, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [...hist, { role: "assistant", content: "echo" }, { role: "user", content: "plain follow-up" }] }) }).then((r) => r.json());
  assert.equal(prompts().at(-1).text, "plain follow-up");
});

// (fails before: yes — the command went inside the catch-up's words, which the agent read as words, so it never ran)
test("an agent's own command after a switch away goes as typed; the turns it missed come with the next message, the command's exchange left out", async () => {
  const sys = `Working directory: ${projDir}`; const H7 = { ...H, "x-session-id": "switch-cmd" };
  const send = (messages) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H7, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages }) }).then((r) => r.json());
  await send([{ role: "user", content: "first with the agent" }]);
  await new Promise((r) => setTimeout(r, 60)); // the fake publishes its commands a few ms after session/new; a real turn takes far longer
  const away = [{ role: "user", content: "first with the agent" }, { role: "assistant", content: "echo(1): first with the agent" }, { role: "user", content: "now with claude please" }, { role: "assistant", content: "Claude answered about apples" }, { role: "user", content: "/review" }];
  await send(away);
  assert.equal(prompts().at(-1).text, "/review", "the command as typed");
  assert.ok(app.usage.list(1)[0].changes.includes("acp: /review is the agent's own command, sent as typed: the 1 turn(s) handled elsewhere since this session's last turn wait for the next message"), app.usage.list(1)[0].changes.join(" | "));
  await send([...away, { role: "assistant", content: "echo(2): /review" }, { role: "user", content: "back to work" }]);
  const p = prompts().at(-1).text;
  assert.ok(p.startsWith("Meanwhile, this conversation continued with another assistant") && p.endsWith("### User\nnow with claude please\n\n### Assistant\nClaude answered about apples\n\n---\nLatest user message:\n\nback to work"), p);
  assert.ok(!p.includes("/review") && !p.includes("first with the agent"), "the command's own exchange, and the turns the session saw, are not handed back");
});

test("P4: a client with no tools is reported as the divergence it is", async () => {
  // The other half of the same column: `full` configured, but this client declares no tools at all, so the agent's
  // delegated work falls back to Filament's own hands rather than rendering as native cards. The bridge writes a note
  // saying so; the dashboard must surface it, and the regex that recognises it has to match the note's REAL wording —
  // it was first written from memory as "no client tools" and silently matched nothing.
  const sys = `Working directory: ${projDir}`; const up = app.config.upstreams.find((u) => u.id === "fake");
  const was = up.acp.clientBridge; up.acp.clientBridge = "full";
  try {
    // No `tools` in the body: this client cannot run anything for the agent.
    await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `nohands-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "hi" }] }) }).then((r) => r.json());
    const rec = app.usage.list(1)[0];
    assert.equal(rec.acp.configuredBridge, "full");
    assert.equal(rec.acp.bridge, "full", "the mode is still full; what changed is who does the work");
    assert.ok(rec.changes.some((c) => /client bridge full \(client has no tools/.test(c)), `the record says whose hands were used: ${rec.changes.join(" | ").slice(-200)}`);
    const s = await (await fetch(`http://127.0.0.1:${port}/api/acp/status`, { headers: { "x-filament-ui": "1" } })).json();
    const cv = s.conversations.find((c) => c.sessionId === rec.acp.sessionId);
    assert.ok(cv, "this conversation is on the live surface");
    assert.match(cv.bridgeNote || "", /client has no tools/, "and the column explains that the client could not do the work");
    assert.deepEqual(cv.clientTools, [], "it also shows that this client declared no tools");
  } finally { up.acp.clientBridge = was; }
});

test("P6: clientBridge off wins over steering, and the record says steering was skipped", async () => {
  // `off` promises the chat client is never involved. A call to a Filament tool is routed to the client by
  // McpToolServer, which checks the client's tools and not the bridge — so steering under `off` broke that promise.
  // Both knobs sit in the same dashboard form, which makes the combination easy to create by accident.
  const sys = `Working directory: ${projDir}`;
  const up = app.config.upstreams.find((u) => u.id === "fake");
  const wasB = up.acp.clientBridge; up.acp.clientBridge = "off"; up.acp.steering = true;
  try {
    await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `off-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "hi" }] }) }).then((r) => r.json());
    const p = prompts().at(-1);
    assert.ok(!p.text.includes("Tool routing:"), `no steering instruction was sent: ${p.text.slice(0, 120)}`);
    const rec = app.usage.list(1)[0];
    assert.ok(!rec.acp.steering, "and the record does not claim steering was in force");
    assert.equal(rec.acp.bridge, "off", "the bridge in force is off");
    assert.ok(rec.changes.some((c) => /steering is on but clientBridge is "off"/.test(c)), `the record explains why: ${rec.changes.join(" | ").slice(-240)}`);
  } finally { up.acp.clientBridge = wasB; up.acp.steering = false; }
});

test("P6: steering switched on mid-conversation does not claim an offer the session never got", async () => {
  // The toolset only reaches the agent when a session is created or reloaded. Enabling steering on a live session
  // cannot retro-offer it, and the old code still pushed "Filament's tools were offered ALONGSIDE the agent's own"
  // and set `acp.steering` — so a user read a 100% leak rate as evidence about a session that was never offered
  // anything at all.
  const sys = `Working directory: ${projDir}`;
  const sess = `mid-${Math.random().toString(36).slice(2, 8)}`;
  const up = app.config.upstreams.find((u) => u.id === "fake");
  const post = (msgs) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": sess }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: msgs }) }).then((r) => r.json());
  await post([{ role: "user", content: "turn one" }]); // session created with steering OFF
  const rec1 = app.usage.list(1)[0];
  assert.ok(!rec1.acp.steering, "turn one was not steered");
  up.acp.steering = true;
  try {
    await post([{ role: "user", content: "turn one" }, { role: "assistant", content: "echo(1): turn one" }, { role: "user", content: "turn two" }]);
    const p2 = prompts().at(-1);
    assert.ok(!p2.text.includes("Tool routing:"), `no instruction went to a session that has no tools: ${p2.text.slice(0, 120)}`);
    const rec2 = app.usage.list(1)[0];
    assert.ok(!rec2.acp.steering, "and the record does not claim steering was in force");
    assert.ok(rec2.changes.some((c) => /started before it|takes effect on the next new session/i.test(c)), `it says what the user must do instead: ${rec2.changes.join(" | ").slice(-260)}`);
  } finally { up.acp.steering = false; }
  // A NEW session on the same chat does get it, which is what the note tells the user to do.
  const sess2 = `mid2-${Math.random().toString(36).slice(2, 8)}`;
  up.acp.steering = true;
  try {
    await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": sess2 }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "fresh session" }] }) }).then((r) => r.json());
    assert.ok(prompts().at(-1).text.includes("Tool routing:"), "a new session gets the instruction");
    assert.equal(app.usage.list(1)[0].acp.steering, true, "and is recorded as steered");
  } finally { up.acp.steering = false; }
});

test("P6: steering offers Filament's tools ALONGSIDE the agent's own, and states the instruction once per session", async () => {
  const sys = `Working directory: ${projDir}`;
  const up = app.config.upstreams.find((u) => u.id === "fake");
  const post = (sess, msgs) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": sess }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: msgs }) }).then((r) => r.json());
  const sess = `steer-${Math.random().toString(36).slice(2, 8)}`;
  up.acp.steering = true;
  try {
    await post(sess, [{ role: "user", content: "first turn" }]);
    const p = prompts().at(-1);
    assert.ok(p.mcp >= 1, "Filament's MCP server was passed to the agent");
    assert.ok(p.mcpTools >= 6, `and the six file tools are listed, not only memory tools: ${p.mcpTools}`);
    // THE distinction from `native`: the agent keeps its own tools, so steering is a request, not an enforcement —
    // which is exactly why the leak rate has to be measured rather than assumed.
    assert.ok(!p.disableBuiltIn, "but the agent KEEPS its built-in tools");
    assert.ok(p.text.startsWith("Tool routing:"), `the instruction leads the prompt: ${JSON.stringify(p.text.slice(0, 80))}`);
    const rec = app.usage.list(1)[0];
    assert.equal(rec.acp.steering, true, "the record says steering was in force for this turn");
    assert.ok(rec.changes.some((c) => /steering \(Rung 2 experiment\)/.test(c)), `and says it may be ignored: ${rec.changes.join(" | ").slice(-240)}`);
    // Second turn of the SAME session: not repeated. Repeating it would make the leak rate measure compliance with a
    // reminder instead of with the session's setup, which is the number actually worth having.
    await post(sess, [{ role: "user", content: "first turn" }, { role: "assistant", content: "x" }, { role: "user", content: "second turn" }]);
    const p2 = prompts().at(-1);
    assert.ok(!p2.text.includes("Tool routing:"), `sent once per session, not every turn: ${JSON.stringify(p2.text.slice(0, 100))}`);
    // The instruction is editable, because the wording IS the experiment.
    up.acp.steeringPrompt = "CUSTOM STEERING MARKER: please use the Filament tools for everything.";
    const sess2 = `steer2-${Math.random().toString(36).slice(2, 8)}`;
    await post(sess2, [{ role: "user", content: "custom wording" }]);
    assert.ok(prompts().at(-1).text.startsWith("CUSTOM STEERING MARKER"), "a custom instruction replaces the default");
  } finally { up.acp.steering = false; delete up.acp.steeringPrompt; }
  // Off: no instruction, and the record does not claim steering.
  const sess3 = `nosteer-${Math.random().toString(36).slice(2, 8)}`;
  await post(sess3, [{ role: "user", content: "plain turn" }]);
  assert.ok(!prompts().at(-1).text.includes("Tool routing:"), "with steering off there is no instruction in the prompt");
  assert.equal(app.usage.list(1)[0].acp.steering, undefined, "and the record does not claim it was on");
});

test("P6: the leak rate counts calls made with the agent's OWN tools, once per call", async () => {
  const sys = `Working directory: ${projDir}`;
  // The `~leak` fixture emits one call through Filament's toolset (titled the way Claude Code titles MCP tools) and two
  // with built-ins, plus a second update for one of them; the fixture's own unconditional call is a third built-in.
  await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `leak-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "~leak" }] }) }).then((r) => r.json());
  const st = app.usage.list(1)[0].acp.toolStats;
  assert.equal(st.calls, 4, `four distinct calls, not five events: ${JSON.stringify(st)}`);
  assert.equal(st.routed, 1, "the call through Filament's toolset is recognised as routed");
  assert.equal(st.builtIn, 3, "and the agent's own calls are counted as leaks");
  assert.equal(st.routed + st.builtIn, st.calls, "every call is in exactly one column");
  assert.equal(st.leakRate, 75, "so the leak rate is 3 of 4");
  // The routed call's title is rewritten for display, so the classification has to happen before that — asserting the
  // rendered line here too pins that the rewrite did not cost the routing information.
  const rec = app.usage.list(1)[0];
  assert.ok(rec.acp.tools.some((t) => /Read /.test(t)), `the routed call is still legible in the record: ${JSON.stringify(rec.acp.tools)}`);
});

test("P4: native mode with a client that has no tools says whose hands did the work", async () => {
  // The cell the truth table got wrong. `native` on a capable agent really does switch the agent's built-in tools
  // off, but with no client tools to route to, Filament's OWN hands run everything under the permission policy and the
  // client renders no cards at all. The column's tooltip promises native cards, so the divergence has to be flagged —
  // the bridge writes the note, and the regex that recognises it has to match this third wording too.
  const sys = `Working directory: ${projDir}`;
  // `native/*` is configured clientBridge: "native" with nativeTools: true, so the agent IS capable.
  await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `nat-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "native/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "hi" }] }) }).then((r) => r.json());
  const rec = app.usage.list(1)[0];
  assert.equal(rec.acp.configuredBridge, "native");
  assert.equal(rec.acp.bridge, "native", "the mode really is native — the agent's built-in tools are off");
  assert.ok(rec.changes.some((c) => /no client tools: Filament's own hands/.test(c)), `and the record says who did the work: ${rec.changes.join(" | ").slice(-220)}`);
  const s = await (await fetch(`http://127.0.0.1:${port}/api/acp/status`, { headers: { "x-filament-ui": "1" } })).json();
  const cv = s.conversations.find((c) => c.sessionId === rec.acp.sessionId);
  assert.ok(cv, "this conversation is on the live surface");
  assert.equal(cv.bridge, "native");
  assert.match(cv.bridgeNote || "", /Filament's own hands/, "so the column warns that the client rendered nothing");
  assert.deepEqual(cv.clientTools, []);
});

test("P4: every §10 rendering parameter exists in the schema, so it reaches the dashboard and the docs", async () => {
  // A hard requirement for this whole plan: no config-file-only knobs. The dashboard form and
  // docs/PARAMETERS.md are both generated from the schema, so a parameter that is not here is a parameter nobody can
  // change without editing JSON — and this test is what stops one being added to the code but not to the schema.
  const { SCHEMAS } = await import("../src/schema.js");
  const acp = SCHEMAS.UPSTREAM.acp;
  const want = ["toolActivity", "toolDiffStyle", "toolDiffMaxFiles", "toolOutput", "toolOutputMaxLines", "toolIcons", "thoughts", "clientBridge", "pacingMs", "seedHistory", "catchUp", "hints", "steering", "steeringPrompt", "nativePaging", "nativePageLines", "nativePageChars", "seedFromArchive", "seedView", "seedBudgetTokens"];
  for (const k of want) {
    assert.ok(acp[k], `${k} is in the schema`);
    assert.ok(typeof acp[k].description === "string" && acp[k].description.length > 12, `${k} has a description a person can read`);
    assert.ok(typeof acp[k].effect === "string" && acp[k].effect.length > 40, `${k} explains what it does in the dashboard`);
  }
  // The enums must list every value the code accepts: an option missing here is a mode the dashboard cannot select,
  // which is exactly the bug `native-then-inline` had. The leading "" is "not set — follow the mode's default".
  assert.deepEqual(acp.toolActivity.options, ["quiet", "text", "verbose", "hide"]);
  assert.deepEqual(acp.toolDiffStyle.options, ["", "summary", "fenced", "off"]);
  assert.deepEqual(acp.toolOutput.options, ["", "failure", "always", "never"]);
  assert.deepEqual(acp.clientBridge.options, ["off", "prompts", "full", "native"]);
  assert.deepEqual(acp.thoughts.options, ["auto", "native-then-inline", "thinking-block", "text", "hide"]);
  // And the defaults the plan chose.
  assert.equal(acp.toolActivity.default, "quiet", "quiet is the default feed");
  assert.equal(acp.hints.default, false, "Filament's own voice is opt-in");
  assert.equal(acp.toolIcons.default, true, "glyphs stay on unless asked otherwise");
  assert.equal(acp.catchUp.default, true, "a returning agent is told what it missed");
  assert.equal(acp.steering.default, false, "steering is opt-in: it is an experiment whose outcome is unknown, not a default");
  assert.ok(String(acp.steeringPrompt.default).length > 80, "and the default instruction is a real instruction, not a placeholder");
  assert.equal(acp.nativePaging.default, true, "result paging is on by default");
  assert.equal(acp.seedFromArchive.default, true, "the archive is the preferred seed source by default");
  assert.deepEqual(acp.seedView.options, ["chat", "summary", "compact"], "and the three views it can take");
  assert.equal(acp.seedView.default, "chat", "a transcript by default; summary is the handoff shape");
  assert.equal(acp.seedBudgetTokens.default, 0, "with no budget of its own: half the window Filament knows for the agent's model");
});

test("P4: acp.catchUp = off stops the missed-turns preamble", async () => {
  const sys = `Working directory: ${projDir}`; const HS = { ...H, "x-session-id": `catchup-${Math.random().toString(36).slice(2, 8)}` };
  const up = app.config.upstreams.find((u) => u.id === "fake");
  // One turn so the session exists and `seenUserTurns` is set; then the chat goes elsewhere and comes back.
  await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: HS, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "first" }] }) }).then((r) => r.json());
  const hist = [{ role: "user", content: "first" }, { role: "assistant", content: "echo(1): first" }, { role: "user", content: "away with claude" }, { role: "assistant", content: "about apples" }, { role: "user", content: "back again" }];
  up.acp.catchUp = false;
  try {
    await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: HS, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: hist }) }).then((r) => r.json());
    const p = prompts().at(-1);
    assert.equal(p.text, "back again", "only the newest message is sent: the missed turns are not injected");
    assert.ok(!p.text.includes("Meanwhile"), "and there is no preamble");
    assert.ok(!app.usage.list(1)[0].changes.some((c) => /handled elsewhere/.test(c)), "the record does not claim a catch-up that did not happen");
  } finally { up.acp.catchUp = true; }
  // Restored: the same shape now catches up, which proves the flag was what changed and not the session state. Two
  // more away-turns, because `seenUserTurns` advanced during the disabled turn (correctly — otherwise the preamble
  // would arrive late, on some unrelated future message) so one new turn is not enough to be "missed".
  await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: HS, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [...hist, { role: "assistant", content: "echo" }, { role: "user", content: "away again" }, { role: "assistant", content: "about oranges" }, { role: "user", content: "and again" }] }) }).then((r) => r.json());
  assert.ok(prompts().at(-1).text.includes("Meanwhile"), "with the knob back on, the missed turns are injected again");
  assert.ok(prompts().at(-1).text.includes("oranges"), "and they are the right ones");
});

test("P4: native-then-inline is selectable on its own, not only through auto", async () => {
  // This mode existed in the code but was missing from the schema's options, so the dashboard could not select it
  // and nothing tested it: it was reachable only as what `auto` resolves to for an OpenAI-format client.
  const { SCHEMAS } = await import("../src/schema.js");
  const opts = SCHEMAS.UPSTREAM.acp.thoughts.options;
  assert.ok(opts.includes("native-then-inline"), `the dashboard can select it: ${opts.join(", ")}`);
  assert.ok(opts.includes("auto") && opts.includes("thinking-block") && opts.includes("text") && opts.includes("hide"), "and the other four are still there");

  const sys = `Working directory: ${projDir}`; const up = app.config.upstreams.find((u) => u.id === "fake");
  const was = up.acp.thoughts; up.acp.thoughts = "native-then-inline";
  try {
    // OpenAI format, so `reasoning_content` is the native channel. `~rethink` makes the fixture think AGAIN after it
    // has already started answering, which is the case this mode exists for.
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-rt", stream: true, messages: [{ role: "system", content: sys }, { role: "user", content: "~rethink" }] }) });
    const wire = await r.text();
    assert.match(wire, /"reasoning_content":"thinking about it/, "the thought BEFORE the first text goes out natively");
    assert.match(wire, /> 💭/, "and a thought AFTER the text began is woven in as a quoted paragraph");
    assert.match(wire, /second thought, two lines/, "carrying the later thought's actual words");
    const iNative = wire.indexOf('"reasoning_content":"thinking about it');
    const iText = wire.indexOf("echo(");
    const iInline = wire.indexOf("> 💭");
    assert.ok(iNative >= 0 && iText > iNative && iInline > iText, `the order is native thought, text, inline thought (${iNative} < ${iText} < ${iInline})`);
    assert.ok(wire.includes("after rethink"), "and the reply still completes");
  } finally { up.acp.thoughts = was; }
});

test("P4: the record and the live surface report the bridge mode IN FORCE, not the configured one", async () => {
  const sys = `Working directory: ${projDir}`; const up = app.config.upstreams.find((u) => u.id === "fake");
  const was = up.acp.clientBridge;
  // `native` needs an agent that can switch its built-in tools off. This one cannot (nativeTools is unset), so the
  // turn really runs as `full` — and a display that showed the configured value would claim a guarantee it did not
  // get, which is the one thing this column must not do.
  up.acp.clientBridge = "native"; up.acp.nativeTools = false;
  try {
    await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `bridge-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "hi" }] }) }).then((r) => r.json());
    const rec = app.usage.list(1)[0];
    assert.equal(rec.acp.configuredBridge, "native", "what the upstream asks for");
    assert.equal(rec.acp.bridge, "full", "and what the turn actually got");
    assert.ok(rec.changes.some((c) => /native is only for agents that can switch their built-in tools off/.test(c)), "with the reason on the record");
    // Tool stats: the dedupe/merge counters §10 asks the dashboard to show.
    const st = rec.acp.toolStats;
    assert.ok(st && typeof st.calls === "number" && st.calls >= 1, `calls counted: ${JSON.stringify(st)}`);
    assert.ok(typeof st.announced === "number" && typeof st.updatesMerged === "number" && typeof st.failures === "number", `and the rest of the summary: ${JSON.stringify(st)}`);
    assert.ok(Array.isArray(rec.acp.tools) && rec.acp.tools.length >= 1, "the announced tool lines are still on the record");
    // The live surface carries it per conversation, with the reason when it diverges.
    const s = await (await fetch(`http://127.0.0.1:${port}/api/acp/status`, { headers: { "x-filament-ui": "1" } })).json();
    // Matched by THIS turn's session id. `find(c => c.bridge === "full")` would happily return an older conversation
    // left over from an earlier test, whose turn is long gone and whose notes are empty — a test that passes for the
    // wrong reason, or fails for one that has nothing to do with the code.
    const cv = s.conversations.find((c) => c.sessionId === rec.acp.sessionId);
    assert.ok(cv, `this conversation is on the live surface: ${JSON.stringify(s.conversations.map((c) => (c.sessionId || "").slice(0, 8)))}`);
    assert.equal(cv.bridge, "full", "and it reports the mode in force");
    assert.match(cv.bridgeNote || "", /behaving as full/, "with the reason it is not the configured mode");
  } finally { up.acp.clientBridge = was; delete up.acp.nativeTools; }
});

test("a harness chat's /cost summarises the agent session like Claude CLI: cost, durations, code changes, usage by model, cache; an outside client's goes to the agent as typed", async () => {
  const id = await harnessChat("cfg/sonnet");
  for (const t of ["one", "two"]) await harnessSays(id, t);
  const rec = app.usage.list(1)[0]; assert.equal(rec.acp.linesAdded, 3); assert.equal(rec.acp.linesRemoved, 1); assert.equal(rec.acp.modelUsage[0].model, "claude-sonnet-5");
  // (fails before: yes — the review of 197fa5a44: a turn its client hung up on closes `aborted` with what it spent,
  // and /cost and /status read "ok" turns alone)
  Object.assign(app.usage.records.find((r) => r.id === rec.id), { status: "aborted", error: "client disconnected" });
  // (fails before: yes — the review of b881c3aab: a request refused before the agent spent on it was one of the
  // session's, in its cache line too)
  app.usage.records.push({ id: "req_refused", status: "error", error: "529 overloaded", ts: new Date().toISOString(), acp: { sessionId: rec.acp.sessionId }, tokens: { input: 0, output: 0 }, cost: 0 });
  assert.match(await harnessSays(id, "/status"), /this session: 2 Filament request\(s\)/);
  const t = await harnessSays(id, "/cost");
  // (fails before: yes — the review of bfc1154da: the header counted the refusal its cache line left out)
  assert.match(t, /^\*\*Cost for this fake with config options session `[^`]+`\*\* \(2 requests through Filament\)/, t.slice(0, 200));
  assert.ok(t.includes("Total cost:            $0.0000\nAt list price:         $0.0618\nSaved by plans:        $0.0618") && t.includes("6 lines added, 2 lines removed") && t.includes("claude-sonnet-5:  20 input, 92 output, 200 cache read, 48.9k cache write") && t.includes("2 requests · 0% of input tokens from cache · 0 misses · last activity"), t);
  assert.ok(t.includes("Numbers come from fake with config options itself."));
  const sys = `Working directory: ${projDir}`;
  const j = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "cost-1" }, body: JSON.stringify({ model: "cfg/sonnet", max_tokens: 20, system: sys, messages: [{ role: "user", content: "/cost" }] }) }).then((r) => r.json());
  assert.ok(!j.content.map((b) => b.text || "").join("").includes("Total cost:"), JSON.stringify(j.content));
  assert.equal(prompts().at(-1).prompt, "/cost", "the agent heard it as typed");
});

test("P8: the Anthropic endpoint carries ordered thinking blocks with contiguous indices — the reason to prefer it", async () => {
  // The research question P8 exists to answer, encoded as a test rather than left as a claim in the docs: on
  // /v1/messages an agent that thinks, answers, thinks again and finishes produces FOUR correctly ordered blocks,
  // each with its own contiguous index and its deltas routed to it. On /v1/chat/completions the same turn cannot: an
  // OpenAI-style client keeps one reasoning part and one text part per reply, so the later thought has to be woven
  // into the text as a quoted paragraph: the difference a client connected in OpenAI format actually gets.
  const sys = `Working directory: ${projDir}`;
  const sess = `p8-${Math.random().toString(36).slice(2, 8)}`;
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": sess }, body: JSON.stringify({ model: "auto/fake-a", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "~rethink for p8" }] }) });
  const wire = await r.text();
  const events = wire.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  const starts = events.filter((e) => e.type === "content_block_start").map((e) => ({ index: e.index, type: e.content_block.type }));
  assert.deepEqual(starts.map((s) => s.type), ["thinking", "text", "thinking", "text"], "four blocks, in the order they happened");
  assert.deepEqual(starts.map((s) => s.index), [0, 1, 2, 3], "with contiguous, unique indices — a client keys blocks by index, so a repeat or a gap would misfile the deltas");
  // Each delta lands on the block that is open, and only that block: a thinking_delta on a text block (or the reverse)
  // is what makes a client paint reasoning under the answer.
  const stops = events.filter((e) => e.type === "content_block_stop").map((e) => e.index);
  assert.deepEqual(stops, [0, 1, 2, 3], "every block is closed, in order");
  const seq = events.filter((e) => e.type === "content_block_delta").map((e) => `${e.index}:${e.delta.type}`);
  assert.ok(seq.includes("0:thinking_delta") && seq.includes("2:thinking_delta"), `thoughts ride thinking deltas on the thinking blocks: ${seq.join(" ")}`);
  assert.ok(seq.includes("1:text_delta") && seq.includes("3:text_delta"), `and text rides text deltas on the text blocks: ${seq.join(" ")}`);
  assert.ok(!seq.some((s) => /^1:thinking_delta|^3:thinking_delta|^0:text_delta|^2:text_delta/.test(s)), `no delta is on the wrong kind of block: ${seq.join(" ")}`);
  // Kinds alone would still pass if the two thought runs were swapped with each other, so pin WHICH thought is in
  // WHICH block: order is the entire claim of this test.
  const thoughtByIndex = new Map();
  for (const e of events) if (e.type === "content_block_delta" && e.delta.type === "thinking_delta") thoughtByIndex.set(e.index, (thoughtByIndex.get(e.index) || "") + e.delta.thinking);
  assert.match(thoughtByIndex.get(0) || "", /thinking about it/, `the first thought is in the first thinking block: ${JSON.stringify([...thoughtByIndex])}`);
  assert.match(thoughtByIndex.get(2) || "", /second thought/, "and the later thought is in the second, not the first");
  const textByIndex = new Map();
  for (const e of events) if (e.type === "content_block_delta" && e.delta.type === "text_delta") textByIndex.set(e.index, (textByIndex.get(e.index) || "") + e.delta.text);
  assert.match(textByIndex.get(3) || "", /after rethink/, "and the final answer is in the last text block");
  assert.ok(!wire.includes("💭"), "and nothing had to be woven into the text, because the wire could carry it properly");
  // The same turn over the OpenAI endpoint, for the contrast the docs claim.
  const o = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { ...H, "x-session-id": `p8b-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "auto/fake-a", max_tokens: 100, stream: true, messages: [{ role: "system", content: sys }, { role: "user", content: "~rethink for p8 openai" }] }) });
  const ow = await o.text();
  assert.ok(ow.includes("reasoning_content"), "the first thought still goes out natively");
  assert.ok(ow.includes("💭"), "but a thought after the text began has to be inlined — this is the limitation, not a bug");
  const recO = app.usage.list(2).find((x) => (x.changes || []).some((c) => /woven into the text/.test(c)));
  assert.ok(recO, "and the record says so, pointing at the Anthropic endpoint as the fix");
  assert.match(recO.changes.find((c) => /woven into the text/.test(c)), /\/v1\/messages/, "by name");
});

test("hints: what could not be applied is said once in the reply, and no command is pointed at; a harness chat's /sessions shows names, its /status the session name", async () => {
  const sys = `Working directory: ${projDir}`; const H8 = { ...H, "x-session-id": "hints-1" };
  let j = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H8, body: JSON.stringify({ model: "cfg/nonexistent-model@yolo", max_tokens: 20, system: sys, messages: [{ role: "user", content: "hello there" }] }) }).then((r) => r.json());
  let t = j.content.map((b) => b.text || "").join("");
  assert.ok(t.includes("_filament:") && t.includes("is not a model fake with config options offers") && t.includes("mode @yolo is not one"), t);
  assert.ok(!t.includes("/help"), "an outside client's commands are its agent's: no hint points at Filament's");
  j = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H8, body: JSON.stringify({ model: "cfg/nonexistent-model@yolo", max_tokens: 20, system: sys, messages: [{ role: "user", content: "hello there" }, { role: "assistant", content: "x" }, { role: "user", content: "again" }] }) }).then((r) => r.json());
  t = j.content.map((b) => b.text || "").join(""); assert.ok(!t.includes("_filament:"), "hints are not repeated: " + t);
  const id = await harnessChat("cfg/sonnet");
  await harnessSays(id, "hello there");
  t = await harnessSays(id, "/status");
  assert.ok(t.includes("agent session: “hello there”"), t);
  t = await harnessSays(id, "/sessions");
  assert.ok(t.includes("**Open in a terminal**") && t.includes("`/resume open terminal`") && t.includes("This chat is on “hello there”"), t);
  // hints can be switched off per upstream
  const up = app.config.upstreams.find((u) => u.id === "fakecfg"); up.acp.hints = false;
  j = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "hints-2" }, body: JSON.stringify({ model: "cfg/nonexistent-model", max_tokens: 20, system: sys, messages: [{ role: "user", content: "quiet" }] }) }).then((r) => r.json());
  // …and what they say stays off the reply; that another model than the chat's answered is said whatever the setting.
  const quiet = j.content.map((b) => b.text || "").join(""); up.acp.hints = true;
  assert.ok(!quiet.includes("is not a model fake with config options offers"), "the hints stay off the reply: " + quiet);
  assert.equal(quiet.split("_filament:").length - 1, 1, "one line of Filament's: " + quiet);
  assert.ok(quiet.includes("_filament: This reply came from claude-sonnet-5, not nonexistent-model, the model this chat names: fake with config options does not offer that model on this account and kept its own. To get the model you choose, pick one fake with config options lists for this account in the model menu._"), quiet);
});

test("P2: Filament's own voice stays out of the reply by default, but is always on the record", async () => {
  const sys = `Working directory: ${projDir}`;
  // `agent/*` has no `hints` setting, so it gets the new default: off. Asking for a model and a mode the agent does
  // not have used to append an italic `_filament: …_` paragraph to the reply — which the chat client then keeps as
  // permanent context, where the next model reads it and can start imitating it.
  const sid = { ...H, "x-session-id": `p2-${Math.random().toString(36).slice(2, 8)}` };
  const j = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: sid, body: JSON.stringify({ model: "agent/nonexistent-model@yolo", max_tokens: 20, system: sys, messages: [{ role: "user", content: "hello there" }] }) }).then((r) => r.json());
  const t = j.content.map((b) => b.text || "").join("");
  assert.ok(!t.includes("_filament:"), `the reply carries no Filament voice: ${t.slice(0, 300)}`);
  assert.ok(!t.includes("is not a model"), "and no hint prose either");
  // But the information is not lost: the request record says exactly what could not be applied. (This fake agent
  // accepts any model name, so the note here is the mode one; the model note is covered by the hints test above.)
  const rec = app.usage.list(6).find((r) => (r.changes || []).some((c) => /not offered by this agent/.test(c)));
  assert.ok(rec, `the record carries the note instead: ${JSON.stringify(app.usage.list(3).map((r) => r.changes))}`);
  assert.match(JSON.stringify(rec.changes), /mode yolo not offered by this agent/, "the mode note is on the record");
  // With hints explicitly on, the same request does say it in the reply — the knob really controls this.
  const up = app.config.upstreams.find((u) => u.id === "fake"); const before = up.acp.hints; up.acp.hints = true;
  try {
    const j2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p2b-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/nonexistent-model@yolo", max_tokens: 20, system: sys, messages: [{ role: "user", content: "hello there" }] }) }).then((r) => r.json());
    const t2 = j2.content.map((b) => b.text || "").join("");
    assert.ok(t2.includes("_filament:"), `hints on puts Filament's voice back in the reply: ${t2.slice(-260)}`);
    assert.ok(t2.includes("mode @yolo is not one"), `and the specific note with it: ${t2.slice(-260)}`);
  } finally { up.acp.hints = before; }
});

test("P2: a truncated turn does not get a paragraph, but a failed turn always explains itself", async () => {
  const sys = `Working directory: ${projDir}`;
  // max_tokens means the reply is real but cut short, and the wire already carries `length`: no paragraph appended.
  const j = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p2c-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-limit", max_tokens: 20, system: sys, messages: [{ role: "user", content: "~limit please" }] }) }).then((r) => r.json());
  const t = j.content.map((b) => b.text || "").join("");
  // Unconditional: a conditional assertion silently voids the whole truncation case if the stop-reason mapping ever
  // regresses, which is exactly what this test exists to guard.
  assert.equal(j.stop_reason, "max_tokens", "the fixture really did truncate the turn");
  assert.ok(t.includes("a real but truncated answer"), "and there is a real reply to read");
  assert.ok(!t.includes("_filament:"), `a truncated reply WITH text gets no Filament prose: ${t.slice(-200)}`);
  const recT = app.usage.list(6).find((r) => (r.changes || []).some((c) => /stop reason max_tokens/.test(c)));
  assert.ok(recT, "but the record notes the stop reason");

  // THE P1 THIS PINS: a turn that spent its whole budget on tools and never answered. `col.text` is NOT empty here —
  // it holds Filament's own quiet tool lines — so measuring "did the agent say anything?" from it made this look like a
  // complete reply and suppressed the explanation, leaving two ⚙ lines, no answer and no reason anywhere in the chat.
  const js = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p2s-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-silentlimit", max_tokens: 20, system: sys, messages: [{ role: "user", content: "~silentlimit" }] }) }).then((r) => r.json());
  const ts = js.content.map((b) => b.text || "").join("");
  assert.equal(js.stop_reason, "max_tokens");
  assert.ok(!/echo\(/.test(ts), "the agent produced no words of its own");
  assert.match(ts, /_filament: .*hit its output limit/, `a textless truncated turn IS explained, even with hints off: ${ts.slice(-260)}`);
  // A refusal is a failed turn: there is no answer to read, so Filament says so even with hints off.
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p2d-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-r2", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "~refuse me" }] }) });
  const s2 = await r2.text();
  assert.match(s2, /"stop_reason":"refusal"/, "the wire carries the mapped stop reason");
  assert.match(s2, /refused this request/, "and a failed turn still explains itself in the reply");
  // A genuine crash is never silenced, whatever the setting.
  const r3 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-r3", stream: true, messages: [{ role: "system", content: sys }, { role: "user", content: "~crash please" }] }) });
  assert.match(await r3.text(), /_filament: fake failed:/, "a crash is always reported in words");
});

// (fails before: yes — HarnessV4_Tasks C21: Filament declared no notices; the agent wrote its own into its answer)
test("C21: a notice the agent sends reaches a client that draws no card as a line of the reply, in its adapter's words", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `c21-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-notice", max_tokens: 100, stream: false, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "~notice" }] }) });
  assert.equal(r.status, 200);
  const text = ((await r.json()).content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
  assert.match(text, /(^|\n)\*\*Model fallback:\*\* claude-opus-5-5 was overloaded, so it went on with claude-sonnet-5-5 \(as a notice\)\.\n/, `a line of its own, the agent told of notices: ${text}`);
  assert.equal((text.match(/Model fallback/g) || []).length, 1, "said once");
  assert.match(text, /After\./, "and the answer goes on after it");
});

test("P3: a thought run is flushed as ONE unit, and a tool boundary resets it", async () => {
  const sys = `Working directory: ${projDir}`;
  // Three thought chunks then text: one thinking block carrying all three, not three fragments. The `fake` upstream
  // is configured with thoughts: "thinking-block", and it is an Anthropic-format connection, so ordering is exact.
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p3a-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-thoughts", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "~thoughts" }] }) });
  const wire = await r.text();
  const thinkDeltas = [...wire.matchAll(/"thinking_delta","thinking":"([^"]*)"/g)].map((m) => m[1]);
  // The fixture emits its own thought + tool call for every prompt, so there are legitimately two runs here:
  // "thinking about it" before the tool boundary, and this test's three chunks after it. What matters is that the
  // THREE chunks arrive as ONE delta — not three fragments — which is what buffering the run buys.
  const run = thinkDeltas.find((d) => d.includes("first part"));
  assert.ok(run, `the run was emitted: ${JSON.stringify(thinkDeltas)}`);
  assert.equal(run, "first part of the thought second part third part", "all three chunks flushed as one unit, in order");
  assert.equal(thinkDeltas.filter((d) => d.includes("first part") || d.includes("second part") || d.includes("third part")).length, 1, "and they were not split across several blocks");
  assert.ok(thinkDeltas.some((d) => d.includes("thinking about it")), "the pre-tool thought is its own run");
  assert.equal((wire.match(/"content_block":\{"type":"thinking"/g) || []).length, 2, "one block per run, reset at the tool boundary");
  // The thought must precede the text — that ordering is the whole point of buffering the run.
  assert.ok(wire.indexOf(run) < wire.indexOf("the answer"), "the thought lands before the answer");
  assert.match(wire, /the answer/, "and the answer still arrives");

  // Thought, tool, thought: the tool boundary resets the run, so the two thoughts are separate blocks and the tool
  // line sits between them. Merging them would put reasoning about the next step underneath the step before it.
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p3b-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-thinktool", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "~thinktool" }] }) });
  const w2 = await r2.text();
  const d2 = [...w2.matchAll(/"thinking_delta","thinking":"([^"]*)"/g)].map((m) => m[1]);
  // The fixture's own thought+tool call runs first, so there are three runs here; what this test pins is that the
  // two thoughts around MY tool call did not merge into one block.
  assert.ok(d2.some((d) => d.includes("thinking before the tool")), `the pre-tool thought was emitted: ${JSON.stringify(d2)}`);
  assert.ok(d2.some((d) => d.includes("thinking after the tool")), "and so was the post-tool one");
  assert.ok(!d2.some((d) => d.includes("thinking before the tool") && d.includes("thinking after the tool")), "but they were NOT merged into one run — the tool boundary reset it");
  const iBefore = w2.indexOf("thinking before the tool");
  const iTool = w2.indexOf("Read src/a.js");
  const iAfter = w2.indexOf("thinking after the tool");
  assert.ok(iBefore >= 0 && iTool > iBefore && iAfter > iTool, `the order is thought, tool, thought (${iBefore} < ${iTool} < ${iAfter})`);
  assert.match(w2, /done thinking/, "and the reply finishes");
});

test("P3: a long thinking phase still streams — the flush timer sends a run mid-turn", async () => {
  const sys = `Working directory: ${projDir}`;
  // Without the flush timer a run is only flushed at a text/tool boundary or at turn end, so an agent that thinks for
  // thirty seconds before answering would show nothing at all until it starts writing. The fixture thinks, waits
  // 700 ms (past THOUGHT_FLUSH_MS = 400), then thinks again: the two runs must arrive SEPARATELY, which can only have
  // happened because the timer fired between them.
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p3t-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-idlegap", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "~idlegap" }] }) });
  const wire = await r.text();
  const d = [...wire.matchAll(/"thinking_delta","thinking":"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(d.some((x) => x.includes("first run")), `the first run was emitted: ${JSON.stringify(d)}`);
  assert.ok(d.some((x) => x.includes("second run")), "and so was the second");
  assert.ok(!d.some((x) => x.includes("first run") && x.includes("second run")), "they did NOT merge, so the timer flushed the first run while the agent was still silent");
  assert.ok(wire.indexOf("first run") < wire.indexOf("second run"), "in order");
  assert.match(wire, /after the gap/, "and the reply still completes");
  // The reply having ended must not leave the timer armed: a later request proves the process is still healthy and
  // nothing wrote to a finished response.
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p3t2-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "still alive?" }] }) });
  assert.equal(r2.status, 200, "the next request still works after a turn whose timer outlived the reply");
});

test("P3: steady thinking streams in pieces while it lasts, not in one lump when the text begins", async () => {
  const sys = `Working directory: ${projDir}`;
  // A model's thinking deltas come every few tens of milliseconds, never 400 ms apart: a flush timer that started over
  // with each chunk never fired, so a whole thinking phase went out as one delta when the text began. The fixture
  // thinks a chunk every 150 ms for 1.2 s, then answers: its thinking must reach the wire in pieces, all of it, in order.
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p3s-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-steady", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "~steadythought" }] }) });
  const wire = await r.text();
  const pieces = [...wire.matchAll(/"thinking_delta","thinking":"([^"]*)"/g)].map((m) => m[1]).filter((d) => /step\d/.test(d));
  assert.ok(pieces.length >= 2, `the thinking went out while it lasted, in pieces: ${JSON.stringify(pieces)}`);
  assert.equal(pieces.join(""), "step1 step2 step3 step4 step5 step6 step7 step8 ", "all of it, in order, once");
  assert.ok(wire.indexOf("step8") < wire.indexOf("after steady thinking"), "and before the answer");
});

test("P2: a permission policy that could not be honoured is told to the user even with hints off", async () => {
  const sys = `Working directory: ${projDir}`;
  // `fakeask` has permissions: "ask" AND hints: false. This client declares no question tool, so Filament cannot ask
  // and auto-allows every prompt instead. That is a silent downgrade of a security setting: the user believes they
  // are being asked and never are, and nothing else in the chat reveals it (the turn's record shows the policy, away
  // from the chat). So it is said once per conversation regardless of `hints`.
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p2p-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "ask/fake-a", max_tokens: 100, system: sys, messages: [{ role: "user", content: "~perm please" }] }) }).then((x) => x.json());
  const t = r.content.map((b) => b.text || "").join("");
  assert.match(t, /permission policy is .ask./, `the auto-allow is disclosed in the reply: ${t.slice(-300)}`);
  assert.match(t, /prompts were allowed once/, "and it says what Filament did instead of asking");
});

// (fails before: no — a guard the mutation pass asked for: no sub-agent asked for permission on its own session)
test("P2: a sub-agent's permission prompt, on its own session, is its turn's: the auto-allow is told there too", async () => {
  const sys = `Working directory: ${projDir}`;
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p2s-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "ask/fake-a", max_tokens: 100, system: sys, messages: [{ role: "user", content: "~subask please" }] }) }).then((x) => x.json());
  const t = r.content.map((b) => b.text || "").join("");
  assert.match(t, /sub-permission:allow/, t.slice(-300));
  assert.match(t, /permission policy is .ask./, `the auto-allow is disclosed in the reply: ${t.slice(-300)}`);
});

// (fails before: yes — the bug hunt of 10-30, AGT-1: under ask with nobody to ask, an agent that offered only to always
// allow it was handed its "always", and the reply said its prompts were allowed once)
test("ask with nobody to ask allows once alone: an agent that offers only to always allow it is refused, and nothing says it was allowed once", async () => {
  const sys = `Working directory: ${projDir}`;
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p2a-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "ask/fake-a", max_tokens: 100, system: sys, messages: [{ role: "user", content: "~permalways" }] }) }).then((x) => x.json());
  const t = r.content.map((b) => b.text || "").join("");
  assert.match(t, /permalways: cancelled/, t.slice(-300));
  assert.doesNotMatch(t, /allowed once/, t.slice(-300));
  const rec = app.usage.list(1)[0];
  assert.equal((rec.notes || []).some((n) => n.kind === "permissions-unanswerable"), false, JSON.stringify(rec.notes));
});

test("P3: invisible Unicode tag characters never reach the client, the archive, or the next model", async () => {
  const sys = `Working directory: ${projDir}`;
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p3c-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-tags", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "~tags" }] }) });
  const wire = await r.text();
  // The U+E0000 block is invisible in a terminal and in a diff, so assert on code points, not on what it looks like.
  const codePoints = [...wire].map((c) => c.codePointAt(0));
  const tagged = codePoints.filter((n) => (n >= 0xE0000 && n <= 0xE007F) || (n >= 0xE0100 && n <= 0xE01EF));
  assert.deepEqual(tagged, [], `${tagged.length} Unicode tag characters leaked into the stream`);
  // …and the text around them survives intact, joined without a gap.
  assert.match(wire, /clean beforeclean after/, "the surrounding text is preserved and closed up");
  assert.match(wire, /thoughttagged/, "thoughts are sanitised too");
  assert.match(wire, /and the end/);
  // The non-streaming path and the openai shape get the same treatment.
  const j = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `p3d-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/fake-tags", max_tokens: 100, system: sys, messages: [{ role: "user", content: "~tags" }] }) }).then((x) => x.json());
  const text = j.content.map((b) => b.text || "").join("");
  assert.ok(!/[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u.test(text), "no tag characters in a JSON reply either");
  assert.match(text, /clean beforeclean after/);
});

test("sessionIdleMinutes controls when a conversation mapping is forgotten", async () => {
  const fake = app.config.upstreams.find((u) => u.id === "fake"); fake.acp.sessionIdleMinutes = 1;
  await (await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "idle-test" }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "idle" }] }) })).json();
  const st = await (await fetch(`http://127.0.0.1:${port}/api/acp/status`)).json();
  const conv = st.conversations.find((c) => c.turns === 1 && c.upstreamId === "fake");
  assert.ok(conv, "conversation listed in /api/acp/status");
  assert.equal(app.acp.sweep(Date.now() + 30_000), 0, "not idle yet");
  assert.ok(app.acp.sweep(Date.now() + 2 * 60_000) >= 1, "dropped after the idle window");
  fake.acp.sessionIdleMinutes = 240;
});

test("conversation map survives a restart and the agent session is reloaded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-acp-restart-")); const log2 = join(dir, "p.jsonl");
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  // This suite routes `agent/*` to its fake ACP upstream: the agent loop, always on (the owner's of 11-09), claims an
  // `agent/<model>` name only on a harness chat's turn or Filament's own call, and these are a client's requests.
  cfg.upstreams = [{ id: "fake", name: "fake", type: "acp", acp: { command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: log2, FAKE_ACP_ALLOW_LOAD: "1" }, cwdDefault: dir } }];
  cfg.routes = [{ match: "agent/*", upstream: "fake", upstreamModel: "{1}" }];
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
  let a1 = createApp({ dataDir: dir, overrides: { port: 0 } }); const p1 = (await a1.start()).port;
  await (await fetch(`http://127.0.0.1:${p1}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "persist" }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, messages: [{ role: "user", content: "before restart" }] }) })).json();
  await new Promise((r) => setTimeout(r, 500)); await a1.stop();
  assert.ok(existsSync(join(dir, "acp-sessions.json")), "session map written");
  // (fails before: yes — the map dropped the commands the agent published: the composer's menu had none until it spoke)
  assert.deepEqual(Object.values(JSON.parse(readFileSync(join(dir, "acp-sessions.json"), "utf8")).conversations).map((c) => c.commands.map((x) => x.name)), [["review", "commit"]]);
  const a2 = createApp({ dataDir: dir, overrides: { port: 0 } }); const p2 = (await a2.start()).port;
  await (await fetch(`http://127.0.0.1:${p2}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "persist" }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, messages: [{ role: "user", content: "before restart" }, { role: "assistant", content: "x" }, { role: "user", content: "after restart" }] }) })).json();
  const lines = readFileSync(log2, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2); assert.equal(lines[1].sessionId, lines[0].sessionId); assert.equal(lines[1].loaded, true); assert.equal(lines[1].text, "after restart");
  assert.ok(a2.usage.list(1)[0].changes.some((c) => c.includes("loaded into")));
  await a2.stop(); rmSync(dir, { recursive: true, force: true });
});

test("an ACP primary that fails before output falls back to the next upstream", async () => {
  const http = await import("node:http");
  const fb = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "fb", content: [{ type: "text", text: "fallback answered" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } })); }); });
  await new Promise((r) => fb.listen(0, "127.0.0.1", r));
  const cfg = app.config;
  cfg.upstreams.push({ id: "deadagent", name: "d", type: "acp", enabled: true, acp: { command: process.execPath, args: ["-e", "process.exit(2)"] } }, { id: "fbhttp", name: "f", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fb.address().port}`, apiKey: "k", enabled: true });
  cfg.routes.unshift({ match: "resilient/*", upstream: "deadagent", upstreamModel: "{1}", format: "auto", enabled: true, fallbacks: [{ upstream: "fbhttp", upstreamModel: "fb" }] });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "resilient/x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
    assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.content[0].text, "fallback answered");
    const rec = app.usage.list(1)[0]; assert.equal(rec.upstream, "fbhttp"); assert.equal(rec.attempt, 2); assert.ok(rec.changes.some((c) => c.includes("trying fallback")));
    // (fails before: yes — HarnessV4_Tasks B10: the agent's failure was no entry of the trail, and what it wrote as it
    // ended was dropped where the request went on to a backup)
    const [first, ...rest] = rec.failover.trail;
    assert.deepEqual([rest.length, first.upstream, first.status, rec.failover.servedBy], [0, "deadagent", null, "fbhttp"]);
    assert.match(first.reason, /exit|ended|code 2/i, first.reason);
    assert.match(first.detail, /bad option: --model/, "what the agent wrote as it ended, under its headline");
    assert.ok(rec.changes.includes("failover: served by fbhttp (#2 in order) after deadagent failed"), rec.changes.join(" | "));
  } finally { cfg.routes.shift(); cfg.upstreams.splice(cfg.upstreams.findIndex((u) => u.id === "deadagent"), 2); fb.close(); }
});

// (fails before: no — a guard of the failover's line, which every later attempt opens its notes with: kept and never
// taken back, the record said both that the agent which failed before its first word served the request and that the
// backup after it did)
test("a coding agent that takes a request over and fails before its first word served nothing: the record's failover line names the backup that did, once", async () => {
  const http = await import("node:http");
  const reply = (/** @type {number} */ status, /** @type {any} */ body) => http.createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }); });
  const down = reply(500, { type: "error", error: { type: "api_error", message: "down" } });
  const fb = reply(200, { id: "m", type: "message", role: "assistant", model: "fb", content: [{ type: "text", text: "fallback answered" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  await Promise.all([down, fb].map((s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(undefined)))));
  const cfg = app.config;
  cfg.upstreams.push(
    { id: "downhttp3", name: "dh", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${/** @type {any} */ (down.address()).port}`, apiKey: "k", enabled: true },
    { id: "deadagent3", name: "d", type: "acp", enabled: true, acp: { command: process.execPath, args: ["-e", "process.exit(2)"] } },
    { id: "fbhttp3", name: "f", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${/** @type {any} */ (fb.address()).port}`, apiKey: "k", enabled: true },
  );
  cfg.routes.unshift({ match: "overtaken/*", upstream: "downhttp3", upstreamModel: "{1}", format: "auto", enabled: true, fallbacks: [{ upstream: "deadagent3", upstreamModel: "{1}" }, { upstream: "fbhttp3", upstreamModel: "fb" }] });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "overtaken/x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
    assert.equal(r.status, 200); assert.equal((await r.json()).content[0].text, "fallback answered");
    const rec = app.usage.list(1)[0];
    assert.deepEqual([rec.upstream, rec.failover.servedBy, rec.failover.trail.map((/** @type {any} */ t) => t.upstream)], ["fbhttp3", "fbhttp3", ["downhttp3", "deadagent3"]]);
    const notes = [...(rec.priorChanges || []), ...rec.changes];
    assert.deepEqual(rec.changes.filter((/** @type {string} */ c) => c.startsWith("failover: served by")), ["failover: served by fbhttp3 (#3 in order) after downhttp3 failed with HTTP 500, deadagent3 failed"], notes.join(" | "));
    assert.ok(!notes.some((c) => c.startsWith("failover: served by deadagent3")), `no note says the agent served it: ${notes.join(" | ")}`);
  } finally { cfg.routes.shift(); cfg.upstreams.splice(cfg.upstreams.findIndex((u) => u.id === "downhttp3"), 3); down.close(); fb.close(); }
});

// (fails before: yes — the review of 14b90e384: the agent's failure took back its "served by" line but left the record
// naming it as the candidate that served — servedBy "deadagent4", its trail ["downhttp4"] — when the backup after it ended
// in its client's hang-up: Traffic drew the agent as having served the request)
test("a coding agent that takes a request over and fails before its first word served nothing: a request its client then leaves names no candidate that served it, its trail kept", async () => {
  const http = await import("node:http");
  const down = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "down" } })); }); });
  // The backup after the agent hears the request and answers nothing.
  /** @type {() => void} */
  let heard = () => {};
  const asked = new Promise((r) => (heard = () => r(undefined)));
  const silent = http.createServer((req) => { req.resume(); heard(); });
  await Promise.all([down, silent].map((s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(undefined)))));
  const cfg = app.config;
  cfg.upstreams.push(
    { id: "downhttp4", name: "dh", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${/** @type {any} */ (down.address()).port}`, apiKey: "k", enabled: true },
    { id: "deadagent4", name: "d", type: "acp", enabled: true, acp: { command: process.execPath, args: ["-e", "process.exit(2)"] } },
    { id: "silenthttp4", name: "s", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${/** @type {any} */ (silent.address()).port}`, apiKey: "k", enabled: true },
  );
  cfg.routes.unshift({ match: "abandoned/*", upstream: "downhttp4", upstreamModel: "{1}", format: "auto", enabled: true, fallbacks: [{ upstream: "deadagent4", upstreamModel: "{1}" }, { upstream: "silenthttp4", upstreamModel: "s" }] });
  try {
    // The client leaves while the backup says nothing.
    const ac = new AbortController();
    const sent = fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "abandoned/x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }), signal: ac.signal }).catch(() => null);
    await asked;
    ac.abort();
    await sent;
    const rec = await until(() => app.usage.list(10).find((/** @type {any} */ r) => r.model === "abandoned/x" && r.status !== "pending") ?? null, "the request's record closed");
    assert.deepEqual([rec.status, rec.failover?.servedBy ?? null, rec.failover?.trail?.map((/** @type {any} */ t) => t.upstream)], ["aborted", null, ["downhttp4", "deadagent4"]], JSON.stringify(rec.failover));
  } finally { cfg.routes.shift(); cfg.upstreams.splice(cfg.upstreams.findIndex((u) => u.id === "downhttp4"), 3); down.close(); silent.closeAllConnections?.(); silent.close(); }
});

// (fails before: yes — HarnessV4_Tasks B10: a request nobody answered kept its failures as notes alone, the first one's
// own words lost)
test("a route nobody answers on keeps what each said as it failed", async () => {
  const cfg = app.config;
  cfg.upstreams.push({ id: "deadagent2", name: "d", type: "acp", enabled: true, acp: { command: process.execPath, args: ["-e", "process.exit(2)"] } }, { id: "deadhttp", name: "f", type: "anthropic-compatible", baseUrl: "http://127.0.0.1:9", apiKey: "k", enabled: true });
  cfg.routes.unshift({ match: "nobody/*", upstream: "deadagent2", upstreamModel: "{1}", format: "auto", enabled: true, fallbacks: [{ upstream: "deadhttp", upstreamModel: "fb" }] });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "nobody/x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
    assert.equal(r.status, 502); await r.text();
    const rec = app.usage.list(1)[0];
    assert.equal(rec.status, "error");
    assert.deepEqual([rec.failover.servedBy, rec.failover.trail.map((/** @type {any} */ t) => t.upstream)], [null, ["deadagent2", "deadhttp"]]);
    assert.match(rec.failover.trail[0].detail, /bad option: --model/);
  } finally { cfg.routes.shift(); cfg.upstreams.splice(cfg.upstreams.findIndex((u) => u.id === "deadagent2"), 2); }
});

test("connection test and model list work for ACP upstreams", async () => {
  const t = await (await fetch(`http://127.0.0.1:${port}/api/upstreams/fake/test`)).json();
  assert.equal(t.ok, true, JSON.stringify(t)); assert.equal(t.models, 2); assert.ok(t.modes.includes("agent"));
  // A read never asks the agent CLI — the Refresh button does (the owner's rule), then the names are served from disk.
  await fetch(`http://127.0.0.1:${port}/api/models?refresh=1`);
  const m = await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: H })).json();
  const ids = m.data.map((x) => x.id);
  assert.ok(ids.includes("agent/fake-a") && ids.includes("agent/fake-b"), "the agent's own models are advertised under the route prefix: " + ids.join(","));
});

test("an agent that could not list its models says why, on the Refresh and the reads after it, until it answers one", async () => {
  // (fails before: yes — its failure stayed in a debug line; the list said 0 models and nothing more)
  const cfg = app.config;
  const fakeAcp = { ...cfg.upstreams.find((u) => u.id === "fake").acp, env: {} }; // the agent that answers, logging nowhere
  cfg.upstreams.push({ id: "nolist", name: "n", type: "acp", enabled: true, acp: { command: process.execPath, args: ["-e", "process.exit(2)"] } });
  try {
    const said = async (refresh) => (await (await fetch(`http://127.0.0.1:${port}/api/models${refresh ? "?refresh=1" : ""}`)).json()).upstreams.nolist;
    const refreshed = await said(true);
    assert.match(String(refreshed.error), /^agent process exited \(code 2\)/, JSON.stringify(refreshed));
    assert.equal(refreshed.count, 0);
    const read = await said(false);
    assert.deepEqual([read.error, read.unasked], [refreshed.error, undefined], "a read after it still says why; it was asked");
    cfg.upstreams.find((u) => u.id === "nolist").acp = fakeAcp;
    const answered = await said(true);
    assert.deepEqual([answered.error, answered.count], [undefined, 2], JSON.stringify(answered));
    assert.equal((await said(false)).error, undefined, "the words go once it answers");
  } finally {
    cfg.upstreams.splice(cfg.upstreams.findIndex((u) => u.id === "nolist"), 1);
  }
});

test("agent failure before output becomes a 502 in the client's format", async () => {
  const cfg = app.config; cfg.upstreams.push({ id: "broken", name: "b", type: "acp", enabled: true, acp: { command: process.execPath, args: ["-e", "process.exit(3)"], mode: "agent" } }); cfg.routes.push({ match: "broken/*", upstream: "broken", upstreamModel: "{1}", format: "auto", enabled: true });
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "broken/x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
  assert.equal(r.status, 502); const j = await r.json(); assert.equal(j.type, "error"); assert.ok(j.error.message.includes("broken"), j.error.message);
});

test("chat commands answered locally count as requests but not as tokens", async () => {
  assert.ok((await harnessSays(await harnessChat("auto/fake-a"), "/help")).length > 50);
  const rec = app.usage.list(1)[0]; assert.equal(rec.local, true); assert.equal(rec.tokens.input, 0); assert.equal(rec.tokens.output, 0); assert.equal(rec.estimatedTokens, false); assert.equal(rec.tps, null);
  assert.ok(rec.changes.some((c) => c.includes("answered by Filament")));
  // (fails before: yes — the record kept autofit's verdict on a request Filament never sent: "window unknown", with a
  // pricing hint, on a command's turn)
  assert.deepEqual([rec.context?.usable ?? null, rec.context?.verdict ?? null, rec.context?.last ?? null], [null, null, null], "no request, so no line and no verdict");
});

test("Cursor-style flat model names become the base model plus its parameters (effort, fast, thinking) through session options", async () => {
  const ask = async (sid, model, extra = {}) => { const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": sid }, body: JSON.stringify({ model, max_tokens: 100, messages: [{ role: "user", content: "hello" }], ...extra }) }); const t = await r.text(); assert.equal(r.status, 200, t); return app.usage.list(1)[0]; };
  const notes = (rec) => rec.changes.filter((c) => c.startsWith("acp: model") || /ignored in the model name|not applied|not offered/.test(c));
  let rec = await ask("variant-1", "cp/cursor-grok-4.6-xhigh");
  assert.deepEqual(notes(rec), ["acp: model grok-4.6 (effort xhigh, fast off)"], rec.changes.join(" | "));
  rec = await ask("variant-1", "cp/cursor-grok-4.6-xhigh"); // second turn, same chat: already set, nothing to change
  assert.deepEqual(notes(rec), ["acp: model grok-4.6 (effort xhigh, fast off)"], rec.changes.join(" | "));
  rec = await ask("variant-2", "cp/grok-4.6-high-fast"); // without the cursor- prefix, fast on
  assert.deepEqual(notes(rec), ["acp: model grok-4.6 (effort high, fast on)"], rec.changes.join(" | "));
  rec = await ask("variant-3", "cp/composer-2.5-turbo"); // a model without an effort option, plus a word the agent does not know
  assert.deepEqual(notes(rec), ["acp: model composer-2.5 (fast off)", "acp: ignored in the model name: turbo"], rec.changes.join(" | "));
  rec = await ask("variant-4", "cp/claude-opus-4-8-thinking", { output_config: { effort: "medium" } }); // switching model reveals new options; the client's effort fills in
  assert.deepEqual(notes(rec), ["acp: model claude-opus-4-8 (thinking on, fast off, effort medium)"], rec.changes.join(" | "));
  rec = await ask("variant-5", "cp/composer-2.5-xhigh"); // effort asked for a model that has none
  assert.deepEqual(notes(rec), ["acp: model composer-2.5 (fast off)", "acp: effort xhigh not applied: composer-2.5 has no effort setting"], rec.changes.join(" | "));
  const st = await (await fetch(`http://127.0.0.1:${port}/api/acp/status`)).json();
  const conv = st.conversations.find((c) => c.model === "grok-4.6" || c.modelId === "grok-4.6"); assert.ok(conv, JSON.stringify(st.conversations.slice(0, 3)));
});

test("tool lines: shell commands become one short code span, plain titles stay plain, nothing spans lines", () => {
  const cmd = "cd /h/filament && cp ~/.cursor/cli-config.json \"C:/x/y.json\"; pid=$(powershell -NoProfile -Command \"(Get-CimInstance Win32_Process)\"); for i in $(seq 1 30); do\n sleep 1; up=$(curl -s http://127.0.0.1:20300/api/state); done";
  const l = formatToolLine(cmd, "execute");
  assert.ok(l.startsWith("⚙ run `") && l.endsWith("…`"), l); assert.ok(!l.includes("\n") && l.length < 110, l);
  assert.equal(formatToolLine("Read src/app.js", "read"), "⚙ Read src/app.js");
  assert.equal(formatToolLine("`ls -la \"/c/Program Files\"`", "other"), "⚙ run `ls -la \"/c/Program Files\"`");
  assert.equal(formatToolLine("grep \"Program Files/Git/model|Git/model\"", "search"), "⚙ run `grep \"Program Files/Git/model|Git/model\"`");
  assert.equal(formatToolLine("Find `*.jsonl`", "search"), "⚙ `Find '*.jsonl'`");
  assert.equal(formatToolLine("  ", "read"), null);
});

// (fails before: yes — its agent quiet for 2.5 s, the silence watchdog cancelled the turn: "no activity from the agent")
test("a quiet agent turn is never cut by a clock: heartbeat pings keep its stream open, and the client hanging up ends it", async () => {
  const before = prompts().length;
  const hangUp = new AbortController();
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, signal: hangUp.signal, body: JSON.stringify({ model: "slow/fake-s", max_tokens: 100, stream: true, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "please hang here" }] }) });
  assert.equal(r.status, 200);
  const reader = /** @type {ReadableStream<Uint8Array>} */ (r.body).getReader(); const dec = new TextDecoder();
  let s = ""; let ended = false;
  const reading = (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; s += dec.decode(value, { stream: true }); } ended = true; } catch {} })();
  // Four pings a second apart after the agent's last words: quiet past the 2.5 s it was once cut at.
  await until(() => s.includes("working…") && (s.slice(s.indexOf("working…")).match(/"type":"ping"/g) || []).length >= 4, "pings while the agent is quiet", { timeoutMs: 15000 });
  assert.equal(ended, false, "the reply is still open");
  assert.ok(!s.includes("did not finish this turn") && !s.includes('"type":"error"'), s.slice(-600));
  hangUp.abort();
  await reading;
  assert.equal(ended, false, "the hang-up ended it, not the reply's end");
  assert.equal(prompts().length, before + 1);
});

test("housekeeping: a client's title request is answered by Filament, never by the agent", async () => {
  const before = prompts().length;
  const sys = "Generate a concise title for this coding session.\n\nThis is a title-generation task, not a conversation.\nNever answer the user's question.\nReturn exactly one valid JSON object with no surrounding text: {\"title\":\"...\"}";
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 128000, messages: [{ role: "system", content: sys }, { role: "user", content: "ok so an ai agent built this Filament app. i want you to review it and then let me know your thoughts. after that give me suggestions." }] }) });
  assert.equal(r.status, 200); const j = await r.json();
  const title = JSON.parse(j.choices[0].message.content).title;
  assert.ok(title.length > 3 && title.length <= 61 && !/^ok /i.test(title), title);
  assert.equal(prompts().length, before, "the agent was not called");
  assert.equal(j.usage.completion_tokens, 0);
  // housekeeping = model: forwarded through Filament's own front door to the named model (here: another agent route that answers locally)
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "hk/fake-h", messages: [{ role: "system", content: sys }, { role: "user", content: "fix the flaky login test in auth.spec.ts" }] }) });
  assert.equal(r2.status, 200); const j2 = await r2.json(); assert.match(JSON.parse(j2.choices[0].message.content).title, /login test/i);
  assert.equal(prompts().length, before, "neither agent was called");
  // a real conversation with an ordinary system prompt still reaches the agent
  const r3 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", messages: [{ role: "system", content: `You are a chat client.\nWorking directory: ${projDir}` }, { role: "user", content: "what is the title of README?" }] }) });
  assert.equal(r3.status, 200); assert.equal(prompts().length, before + 1);
});

// ---- Phase 1: faithful rendering of what the agent does -------------------------------------------------
test("rendering: edits become diff blocks, command output a fenced block, plans a checklist, failures and sub-agents lines", async () => {
  const sys = `Working directory: ${projDir}`;
  const ask = async (text) => { const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-r", messages: [{ role: "system", content: sys }, { role: "user", content: text }] }) }); assert.equal(r.status, 200); return (await r.json()).choices[0].message.content; };
  const d = await ask("please ~diff this");
  assert.ok(d.includes("⚙ Edit src/app.js") && d.includes("```diff") && d.includes("-two") && d.includes("+two changed") && d.includes("+five"), d);
  const t = await ask("run the ~terminal");
  assert.ok(t.includes("⚙ run `npm test`") && t.includes("```text") && t.includes("3 passing"), t);
  const p = await ask("make a ~plan");
  assert.ok(p.includes("**Plan**") && p.includes("- [ ] Read the failing test ·high") && p.includes("✓ Read the failing test") && p.includes("▸ Fix the off-by-one"), p);
  const f = await ask("~failtool now");
  assert.ok(f.includes("✗ failed: Delete tmp/cache"), f);
  const sa = await ask("use a ~subagent");
  assert.ok(sa.includes("⚙ sub-agent explorer started") && sa.includes("↳ ⚙ Read src/index.js") && sa.includes("✓ sub-agent explorer finished"), sa);
  const w = await ask("something ~weird");
  assert.ok(w.includes("echo("), "an unknown update kind is ignored, the turn completes");
});

test("rendering: refusal and title updates are surfaced; a crashing agent is explained in words", async () => {
  const sys = `Working directory: ${projDir}`;
  const r1 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-r2", max_tokens: 100, stream: true, system: sys, messages: [{ role: "user", content: "~refuse me" }] }) });
  const s1 = await r1.text(); assert.ok(s1.includes('"stop_reason":"refusal"') && s1.includes("refused this request"), s1.slice(-500));
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-r2", messages: [{ role: "system", content: sys }, { role: "user", content: "give it a ~title" }] }) });
  assert.equal(r2.status, 200); await r2.json();
  const st = await (await fetch(`http://127.0.0.1:${port}/api/acp/status`, { headers: { "x-filament-ui": "1" } })).json();
  assert.ok(st.conversations.some((c) => c.title === "Fix the login test"), JSON.stringify(st.conversations.map((c) => c.title)));
  const r3 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-r3", stream: true, messages: [{ role: "system", content: sys }, { role: "user", content: "~crash please" }] }) });
  const s3 = await r3.text(); assert.ok(s3.includes("about to crash") && s3.includes("_filament: fake failed:") && s3.includes("exited"), s3.slice(-600));
});

// ---- Phase 2 / 3: the client's own hands ----------------------------------------------------------------------
const ZTOOLS = [
  { type: "function", function: { name: "AskUserQuestion", parameters: { type: "object", properties: { questions: { type: "array" } }, required: ["questions"] } } },
  { type: "function", function: { name: "TodoWrite", parameters: { type: "object", properties: { todos: { type: "array" } }, required: ["todos"] } } },
  { type: "function", function: { name: "Read", parameters: { type: "object", properties: { file_path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, required: ["file_path"] } } },
  { type: "function", function: { name: "Write", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } } },
  { type: "function", function: { name: "Bash", parameters: { type: "object", properties: { command: { type: "string" }, timeout: { type: "number" }, description: { type: "string" } }, required: ["command"] } } },
];
// Drive a chat client's tool loop: run the tools Filament asks for with `runTool`, feed results back, until the reply ends.
async function toolLoop(model, userText, runTool, { sessionId = `s-${Math.random().toString(36).slice(2, 8)}`, maxSteps = 8 } = {}) {
  const messages = [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: userText }];
  const calls = []; let text = "", last = null;
  for (let step = 0; step < maxSteps; step++) {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { ...H, "x-session-id": sessionId }, body: JSON.stringify({ model, messages, tools: ZTOOLS, tool_choice: "auto" }) });
    assert.equal(r.status, 200); last = await r.json(); const msg = last.choices[0].message; text += msg.content || "";
    if (last.choices[0].finish_reason !== "tool_calls") return { text, calls, last, messages };
    messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });
    for (const tc of msg.tool_calls) { const input = JSON.parse(tc.function.arguments); calls.push({ name: tc.function.name, input, id: tc.id }); const out = await runTool(tc.function.name, input); messages.push({ role: "tool", tool_call_id: tc.id, content: typeof out === "string" ? out : JSON.stringify(out) }); }
  }
  throw new Error(`tool loop did not end in ${maxSteps} steps`);
}

test("client bridge: permissions = ask puts the question to the client as AskUserQuestion and continues the same turn", async () => {
  const before = prompts().length;
  const r = await toolLoop("ask/fake-a", "need perm for this", async (name, input) => { assert.equal(name, "AskUserQuestion"); assert.match(input.questions[0].question, /wants to run `Run command`\. Allow it\?/); assert.deepEqual(input.questions[0].options.map((o) => o.label), ["Allow", "Always", "Reject"]); return JSON.stringify({ questions: input.questions, answers: { [input.questions[0].question]: "Allow" } }); });
  assert.equal(r.calls.length, 1); assert.ok(r.calls[0].id.startsWith("filament_act_"));
  assert.ok(r.text.includes("permission:allow") && r.text.includes("echo(1)"), r.text);
  assert.equal(prompts().length, before + 1, "one agent turn, not two");
  // (fails before: no — a guard the mutation pass asked for: no one asked the reply that continued a turn for its run)
  assert.equal(app.usage.list(1)[0].acp?.run?.status, "done", "the reply that continued the turn ran it as a run");
  // the exact label refuses as it allows; words that hold a label pick nothing, and nothing picked refuses (a3)
  const r2 = await toolLoop("ask/fake-a", "need perm again", async () => "Reject");
  assert.ok(r2.text.includes("permission:no"), r2.text);
  const r3 = await toolLoop("ask/fake-a", "need perm once more", async () => "The user chose: Allow");
  assert.ok(r3.text.includes("permission:cancelled") && !r3.text.includes("permission:allow"), r3.text);
  // Anthropic format, streaming: tool_use block, stop_reason tool_use, then the continuation
  const sess = `s-${Math.random().toString(36).slice(2, 8)}`; const sysA = `Working directory: ${projDir}`;
  const a1 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": sess }, body: JSON.stringify({ model: "ask/fake-a", max_tokens: 200, stream: true, system: sysA, tools: [{ name: "AskUserQuestion", input_schema: { type: "object", properties: { questions: { type: "array" } } } }], messages: [{ role: "user", content: "perm check" }] }) });
  const sa = await a1.text(); assert.ok(sa.includes('"type":"tool_use"') && sa.includes('"name":"AskUserQuestion"') && sa.includes('"stop_reason":"tool_use"'), sa.slice(-700));
  const id = /"id":"(filament_act_[a-f0-9]+)"/.exec(sa)[1];
  const a2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": sess }, body: JSON.stringify({ model: "ask/fake-a", max_tokens: 200, stream: false, system: sysA, tools: [{ name: "AskUserQuestion", input_schema: { type: "object", properties: { questions: { type: "array" } } } }], messages: [{ role: "user", content: "perm check" }, { role: "assistant", content: [{ type: "tool_use", id, name: "AskUserQuestion", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "Allow" }] }] }) });
  const j2 = await a2.json(); assert.equal(j2.stop_reason, "end_turn"); assert.match(j2.content.map((c) => c.text || "").join(""), /permission:allow/);
});

test("client bridge: the agent's plan becomes the client's TodoWrite; the turn keeps running meanwhile", async () => {
  const r = await toolLoop("agent/fake-a", "make a ~plan then finish", async (name, input) => { assert.equal(name, "TodoWrite"); assert.ok(Array.isArray(input.todos) && input.todos.length === 2 && input.todos[0].content === "Read the failing test", JSON.stringify(input)); return "Todos have been modified successfully"; });
  assert.ok(r.calls.length >= 1 && r.calls.every((c) => c.name === "TodoWrite"), JSON.stringify(r.calls.map((c) => c.name)));
  assert.ok(r.text.includes("echo(") && !r.text.includes("**Plan**"), r.text);
  const done = r.calls.at(-1).input.todos; assert.equal(done[0].status, "completed"); assert.equal(done[1].status, "in_progress");
});

// (fails before: no — a guard the mutation pass asked for: no plan came with the client bridge off)
test("client bridge off: the agent's plan is drawn in the reply, never sent to the client's TodoWrite", async () => {
  const up = app.config.upstreams.find((u) => u.id === "fake");
  const was = up.acp.clientBridge; up.acp.clientBridge = "off";
  try {
    const r = await toolLoop("agent/fake-a", "make a ~plan then finish", async (name) => assert.fail(`the client was asked to run ${name}`));
    assert.deepEqual(r.calls, []);
    assert.ok(r.text.includes("**Plan**"), r.text);
  } finally { up.acp.clientBridge = was; }
});

test("client bridge (full): file reads, writes and commands run through the client's Read, Write and Bash", async () => {
  writeFileSync(join(projDir, "README.md"), "hello readme\nsecond line\n");
  const seen = [];
  const r = await toolLoop("full/fake-a", "~readfile then ~writefile then ~runcmd", async (name, input) => {
    seen.push(name);
    if (name === "Read") { assert.ok(String(input.file_path).endsWith("README.md")); return "     1\thello readme\n     2\tsecond line\n"; }
    if (name === "Write") { assert.ok(String(input.file_path).endsWith("out.txt")); assert.equal(input.content, "hello from agent"); return "File written"; }
    if (name === "Bash") { assert.equal(input.command, "echo hi"); return "hi\n"; }
    throw new Error(`unexpected tool ${name}`);
  });
  assert.deepEqual(seen, ["Read", "Write", "Bash"]);
  assert.ok(r.text.includes("read:hello readme") && r.text.includes("wrote") && r.text.includes("cmd:hi(exit 0)"), r.text);
  assert.ok(!existsSync(join(projDir, "out.txt")), "the client wrote the file, not Filament");
});

test("client bridge (full) without client tools: Filament's own hands read, write and run under the permission policy", async () => {
  writeFileSync(join(projDir, "README.md"), "hello readme\n");
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "full/fake-b", messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "~readfile ~writefile ~runcmd" }] }) });
  assert.equal(r.status, 200); const j = await r.json(); const t = j.choices[0].message.content;
  assert.ok(t.includes("read:hello readme") && t.includes("wrote") && /cmd:hi\(exit 0\)/.test(t), t);
  assert.equal(readFileSync(join(projDir, "out.txt"), "utf8"), "hello from agent");
});

// (fails before: yes — the bug hunt of 10-30, AGT-5: Filament's own hands read whatever file an agent delegated, under
// any policy, while its writes and commands were judged: under reject the agent read README.md)
test("client bridge (full) without client tools: under reject, Filament's own hands read nothing for the agent, as they write and run nothing", async () => {
  writeFileSync(join(projDir, "README.md"), "hello readme\n");
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "fullno/fake-b", messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "~readfile" }] }) });
  assert.equal(r.status, 200);
  const t = (await r.json()).choices[0].message.content;
  assert.match(t, /readerr:refused by Filament's permission policy \(reject\)/, t);
});

// (fails before: yes — the agent waiting on Filament's command, or polling its output, said nothing meanwhile, so a
// command longer than the silence bound cancelled the turn as an agent gone silent (HarnessV3-ACP AC-R3, the bug
// report's L23); no clock ends an agent's turn now (HarnessV3-FailurePoints §4 B), and the two ways of waiting stay)
test("an agent waits on a command Filament runs for it, or polls its output, as long as the command takes", async () => {
  for (const [scenario, said] of [["~runslow", /slowcmd\(exit 0\)/], ["~pollslow", /polledcmd\(exit 0\)/]]) {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "wait/fake-a", messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: scenario }] }) });
    assert.equal(r.status, 200);
    const t = (await r.json()).choices[0].message.content;
    assert.match(t, said, t);
  }
});

// (fails before: yes — a command Filament ran for an agent outlived the agent, and the one its terminals' cap let go of
// ran on, with nothing left to read it or stop it)
test("a command Filament runs for an agent ends with the agent, or once the agent's terminals pass their cap (the bug report's L23)", async () => {
  writeFileSync(join(projDir, "linger.js"), "require('fs').writeFileSync(process.argv[2], String(process.pid));\nconsole.log('ready');\nsetInterval(() => {}, 1000);\n");
  const pidFile = join(projDir, "linger.pid");
  /** @param {number} pid */
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  /** @type {number[]} */
  const pids = [];
  try {
    for (const scenario of ["~termcrash", "~termflood"]) {
      rmSync(pidFile, { force: true });
      const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "wait/fake-a", messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: scenario }] }) });
      await r.text();
      const pid = Number(readFileSync(pidFile, "utf8"));
      pids.push(pid);
      await until(() => !alive(pid), `${scenario}: the command Filament ran for the agent to end`);
    }
  } finally {
    for (const pid of pids) if (alive(pid)) process.kill(pid);
  }
});

test("a command Filament runs for an agent keeps each argument whole, and the question names them so (fails before: yes — the program and its arguments were joined unquoted: the question read `x&echo INJECTED a b` and the shell ran a second command)", async () => {
  writeFileSync(join(projDir, "say.js"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  /** @type {string[]} */
  const asked = [];
  const r = await toolLoop("ask/fake-a", "~runargs", async (name, input) => {
    assert.equal(name, "AskUserQuestion");
    asked.push(input.questions[0].question);
    return JSON.stringify({ questions: input.questions, answers: { [input.questions[0].question]: "Allow" } });
  });
  assert.equal(asked.length, 1, JSON.stringify(asked));
  assert.ok(asked[0].includes("'x&echo INJECTED' 'a b'"), asked[0]);
  assert.ok(r.text.includes('argv:["x&echo INJECTED","a b"](exit 0)'), r.text);
});

test("client bridge: stale tool results and a new message during a wait are handled in words", async () => {
  // results for an action Filament never issued (it restarted): a sentence, no agent call
  const before = prompts().length;
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", tools: ZTOOLS, messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "hello" }, { role: "assistant", content: null, tool_calls: [{ id: "filament_act_deadbeef0000", type: "function", function: { name: "AskUserQuestion", arguments: "{}" } }] }, { role: "tool", tool_call_id: "filament_act_deadbeef0000", content: "Allow" }] }) });
  const j = await r.json(); assert.match(j.choices[0].message.content, /has already ended/); assert.equal(prompts().length, before);
  // the agent waits for a permission answer; the user sends a new message instead: the old turn is cancelled and its leftovers shown
  const sess = `s-${Math.random().toString(36).slice(2, 8)}`;
  const first = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { ...H, "x-session-id": sess }, body: JSON.stringify({ model: "ask/fake-a", tools: ZTOOLS, messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "perm one" }] }) });
  const j1 = await first.json(); assert.equal(j1.choices[0].finish_reason, "tool_calls");
  const second = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { ...H, "x-session-id": sess }, body: JSON.stringify({ model: "ask/fake-a", tools: ZTOOLS, messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "perm one" }, { role: "assistant", content: "…" }, { role: "user", content: "never mind, do something else" }] }) });
  const j2 = await second.json(); const t2 = j2.choices[0].message.content;
  // This upstream has hints off (the default), so Filament's prose label is gone but the previous turn's own output is
  // still delivered, still separated by a rule, and still explained on the record.
  assert.ok(t2.includes("permission:cancelled") && t2.includes("echo(2)"), `the previous turn's buffered output is still delivered: ${t2}`);
  assert.ok(t2.includes("---"), "and a rule still separates the two turns, so they do not merge into one blob");
  assert.ok(!t2.includes("_filament:"), `but Filament does not speak in the reply with hints off: ${t2}`);
  const rec2 = app.usage.list(3).find((r) => (r.priorChanges || []).some((c) => /buffered event/.test(c)) || (r.changes || []).some((c) => /buffered event/.test(c)));
  assert.ok(rec2, "the record explains the carry-over instead");
  assert.match(JSON.stringify([...(rec2.priorChanges || []), ...(rec2.changes || [])]), /buffered event\(s\) from the previous turn delivered first/);
});

test("native toolset: the agent gets Filament's MCP tools instead of its built-ins; Read runs through the client, Glob/Grep/Edit locally", async () => {
  writeFileSync(join(projDir, "README.md"), "hello readme\n"); writeFileSync(join(projDir, "notes.txt"), "alpha\nbeta gamma\n");
  const sess = `s-${Math.random().toString(36).slice(2, 8)}`; const sys = `Working directory: ${projDir}`; const HS = { ...H, "x-session-id": sess };
  const A = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: HS, body: JSON.stringify({ model: "native/fake-a", tools: ZTOOLS, messages: [{ role: "system", content: sys }, { role: "user", content: "hang here" }] }) });
  await new Promise((r) => setTimeout(r, 500));
  const p = prompts().at(-1); assert.equal(p.mcp, 1, "Filament's MCP server was passed to the agent"); assert.equal(p.disableBuiltIn, true); assert.ok(String(p.mcpUrl).includes("/mcp/"), p.mcpUrl);
  assert.equal(p.mcpInit, 200, "the toolset answers while session/new is still open (Claude Code connects then)"); assert.equal(p.mcpTools, 7, "the six file tools and the chat's own recall (11-06); no Space, its project has none made (10-29)");
  const rpc = (m) => fetch(p.mcpUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(m) }).then((r) => r.json());
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  assert.equal(init.result.serverInfo.name, "filament"); assert.equal(init.result.protocolVersion, "2025-06-18");
  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }); assert.deepEqual(list.result.tools.map((t) => t.name), ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "filament_recall"], "and the chat's own recall (11-06)");
  const glob = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "Glob", arguments: { pattern: "*.txt", path: projDir } } }); assert.match(glob.result.content[0].text, /notes\.txt/);
  const grep = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "Grep", arguments: { pattern: "beta", path: projDir, output_mode: "content" } } }); assert.match(grep.result.content[0].text, /notes\.txt:2:beta gamma/);
  // Read goes through the client's own Read tool: the pending chat reply ends with that tool call, the client answers, the MCP call resolves
  const readP = rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "Read", arguments: { file_path: join(projDir, "README.md") } } });
  const a = await (await A).json(); assert.equal(a.choices[0].finish_reason, "tool_calls", JSON.stringify(a).slice(0, 300)); const tc = a.choices[0].message.tool_calls[0]; assert.equal(tc.function.name, "Read"); assert.ok(JSON.parse(tc.function.arguments).file_path.endsWith("README.md"));
  const hangUp = new AbortController();
  const B = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: HS, signal: hangUp.signal, body: JSON.stringify({ model: "native/fake-a", tools: ZTOOLS, messages: [{ role: "system", content: sys }, { role: "user", content: "hang here" }, { role: "assistant", content: a.choices[0].message.content, tool_calls: a.choices[0].message.tool_calls }, { role: "tool", tool_call_id: tc.id, content: "     1\thello readme" }] }) });
  const read = await readP; assert.match(read.result.content[0].text, /hello readme/);
  // The fake stays silent after the read: the client hanging up ends its turn, as no clock does.
  hangUp.abort(); await B.catch(() => {});
  // with the turn over, tools still work locally
  const edit = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "Edit", arguments: { file_path: join(projDir, "notes.txt"), old_string: "alpha", new_string: "ALPHA" } } });
  assert.match(edit.result.content[0].text, /Successfully replaced 1 block in .*notes\.txt/); assert.ok(readFileSync(join(projDir, "notes.txt"), "utf8").startsWith("ALPHA"));
  const bad = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "Edit", arguments: { file_path: join(projDir, "notes.txt"), old_string: "zzz", new_string: "y" } } }); assert.equal(bad.result.isError, true);
  const unknown = await fetch(`http://127.0.0.1:${port}/mcp/nope`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }); assert.equal(unknown.status, 404);
});

test("parallel client actions go out in one reply; housekeeping summaries never wait behind a live turn", async () => {
  writeFileSync(join(projDir, "a.txt"), "A"); writeFileSync(join(projDir, "b.txt"), "B");
  const r = await toolLoop("full/fake-p", "~readfile2 now", async (name, input) => { assert.equal(name, "Read"); return String(input.file_path).endsWith("a.txt") ? "     1\tA" : "     1\tB"; });
  assert.equal(r.calls.length, 2, "both reads in one reply"); assert.ok(r.text.includes("two:A+B"), r.text);
  const legs = app.usage.list(3).filter((x) => x.acp?.clientAction); assert.ok(legs.some((x) => x.acp.clientAction.calls === 2), JSON.stringify(legs.map((x) => x.acp.clientAction)));
  // a compaction / summary request from the client is answered by Filament, not queued behind the agent
  const before = prompts().length;
  const s = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "agent/fake-a", messages: [{ role: "system", content: "Summarize the conversation below for a compact context. This is not a conversation; do not answer the user." }, { role: "user", content: "User asked about login bugs. Assistant found two." }] }) });
  const j = await s.json(); assert.match(j.choices[0].message.content, /Summary of the conversation/); assert.equal(prompts().length, before);
});

test("a real agent turn becomes durable operations: session, permission decision, kill and exit", async () => {
  // The unit tests drive the injected recorder directly. This one proves the PRODUCERS fire on a real turn through a
  // real subprocess — the part that is private (`#op`, `#watchProc`) and therefore invisible to any other test. It is
  // also the only thing that can catch the failure mode that matters here: a hook that is wired but never called,
  // which leaves the Agents tab showing an empty history with every test green.
  const agentOps = async () => (await (await fetch(`http://127.0.0.1:${port}/api/ops?limit=200&kinds=agent`, { headers: H })).json()).ops;
  const before = (await agentOps()).length;
  const sys = `Working directory: ${projDir}`;
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": "oplog-1" }, body: JSON.stringify({ model: "agent/fake-a", max_tokens: 20, system: sys, messages: [{ role: "user", content: "perm please" }] }) });
  const body = await r.text();
  assert.equal(r.status, 200, body);
  await new Promise((res) => setTimeout(res, 150));

  const ops = await agentOps();
  assert.ok(ops.length > before, `the turn recorded agent operations (${before} → ${ops.length})`);
  const titles = ops.map((o) => `${o.sub}: ${o.title}`).join("\n");

  const sess = ops.find((o) => o.sub === "new" && /agent session on fake/.test(o.title));
  assert.ok(sess, `session/new produced an operation:\n${titles}`);
  assert.equal(sess.ref.upstreamId, "fake", "linked to the upstream, which is how the Agents tab groups history");
  assert.ok(sess.ref.sessionId, "and to the agent session id, so a row can be tied back to a conversation");

  const perm = ops.find((o) => o.sub === "permission");
  assert.ok(perm, `the permission decision produced an operation:\n${titles}`);
  assert.match(perm.title, /^agent permission on fake: execute → \S+/, "the title names the kind and the decision");
  assert.ok(["allow", "always", "no"].includes(perm.detail.decision), `the decision is one the agent offered: ${perm.detail.decision}`);
  assert.equal(perm.detail.kind, "execute");
  assert.ok(perm.detail.policy, "and the policy that produced it, so 'why did Filament say yes' is answerable later");

  // Both bridges share the one `agent` kind, so every operation says which produced it — otherwise a session started
  // in-process by the SDK is indistinguishable from one started as a subprocess.
  for (const o of [sess, perm]) assert.equal(o.detail.bridge, "acp", `${o.sub} is tagged with its bridge`);

  // Content-free, not a transcript: the tool title is agent-supplied text (a command, a file path), so it is not
  // recorded AT ALL — the durable op carries the kind and the decision only. A length cap would still store it.
  assert.ok(!("asked" in (perm.detail || {})), "the agent-supplied title is absent from the durable op, not just capped");

  // Killing from the dashboard records the kill, and the process actually exiting records the exit — two different
  // facts, and the second is the one that proves #watchProc was attached at the creation site.
  const st = await fetch(`http://127.0.0.1:${port}/api/acp/status`, { headers: { "x-filament-ui": "1" } }).then((x) => x.json());
  const proc = (st.processes || []).find((p) => String(p.key || "").startsWith("fake|"));
  assert.ok(proc, `there is a live agent process to kill: ${JSON.stringify((st.processes || []).map((p) => p.key))}`);
  const k = await fetch(`http://127.0.0.1:${port}/api/acp/processes/${encodeURIComponent(proc.key)}/kill`, { method: "POST", headers: { ...H, "x-filament-ui": "1" } }).then((x) => x.json());
  assert.equal(k.ok, true, "the kill endpoint reports success");
  await new Promise((res) => setTimeout(res, 100));
  const afterKill = await agentOps();
  const kill = afterKill.find((o) => o.sub === "kill");
  assert.ok(kill, "the kill was recorded");
  assert.equal(kill.level, "warn", "and it is a warning: it interrupts whatever the agent was doing");

  let exit = null;
  for (let i = 0; i < 40 && !exit; i++) { await new Promise((res) => setTimeout(res, 100)); exit = (await agentOps()).find((o) => o.sub === "exit" && String(o.title).includes(proc.key)); }
  assert.ok(exit, "the process exiting on its own was recorded too, which is what #watchProc is for");
  assert.match(exit.title, /exited \(code |exited \(code \?/, "and the title carries the exit code");
  assert.ok(["info", "warn"].includes(exit.level), "levelled by whether the exit was clean");
});

test("P9.1: an agent started from a Claude Code terminal is not told it is nested, and the record says what was withheld", async () => {
  // Filament is routinely launched from a coding agent's terminal. `CLAUDECODE` in that environment makes
  // claude-agent-acp behave as a nested session; until P9.1 every spawn passed process.env through whole.
  // A model id no earlier test used forces a fresh agent process, which is where the once-per-process note fires.
  const had = process.env.CLAUDECODE; process.env.CLAUDECODE = "1";
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": `env-${Math.random().toString(36).slice(2, 8)}` }, body: JSON.stringify({ model: "agent/envprobe-model", max_tokens: 20, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "hello" }] }) });
    assert.equal(r.status, 200, await r.text().catch(() => ""));
    const rec = app.usage.list(1)[0];
    const note = rec.changes.find((c) => /inherited environment variable\(s\) withheld/.test(c));
    assert.ok(note, `the record names the withheld variables: ${rec.changes.join(" | ").slice(-300)}`);
    assert.match(note, /CLAUDECODE/, "including the nested-session marker that was actually present");
  } finally { if (had == null) delete process.env.CLAUDECODE; else process.env.CLAUDECODE = had; }
});

// (fails before: yes — the review of 11-10: an agent that declares no HTTP MCP support was handed none of Filament's
// server, its built-in tools left on and `native` given up, though ACP asks every agent to take MCP over stdio)
test("P9.2: an agent that declares no HTTP MCP support is handed Filament's MCP server over stdio, through the relay, and native is in force", async () => {
  // Until P9.2 the URL was pushed regardless of `agentCapabilities.mcpCapabilities.http`, so on such an agent `native`
  // and `steering` silently never connected. Since, it went without them; now the relay carries them to it.
  writeFileSync(join(projDir, "README.md"), "hello readme\n");
  const sess = `nomcp-${Math.random().toString(36).slice(2, 8)}`;
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { ...H, "x-session-id": sess }, body: JSON.stringify({ model: "nomcp/fake-a", tools: ZTOOLS, messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "hello" }] }) });
  assert.equal(r.status, 200, await r.text().catch(() => ""));
  const p = prompts().at(-1);
  assert.equal(p.mcp, 1, "Filament's server reached session/new");
  assert.equal(p.mcpVia, "stdio", "as a server the agent starts");
  assert.equal(p.mcpInit, 200, "whose handshake went through to Filament");
  assert.equal(p.mcpTools, 7, "with the six file tools and the chat's own recall listed, as over HTTP");
  assert.equal(p.disableBuiltIn, true, "and the built-ins are off: native is genuinely in force");
  const rec = app.usage.list(1)[0];
  assert.equal(rec.acp.bridge, "native");
  const all = [...(rec.priorChanges || []), ...(rec.changes || [])].join(" | ");
  assert.match(all, /takes no MCP server over HTTP \(mcpCapabilities\.http\): Filament's tools reach it over stdio, through Filament's relay/, `the record says how: ${all.slice(-400)}`);
  assert.ok(!/declares no HTTP MCP support/.test(all), "and claims nothing lost");
});

test("P9.2: an agent that declares HTTP MCP support is offered the server exactly as before, and an agent that omits the field keeps the old behaviour", async () => {
  // The positive declaration must change nothing; and `fakenative` (no mcpCapabilities at all) is exercised by the
  // native toolset test above — an older agent that predates the field is unknown, and unknown is not "no".
  const sess = `httpmcp-${Math.random().toString(36).slice(2, 8)}`;
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { ...H, "x-session-id": sess }, body: JSON.stringify({ model: "httpmcp/fake-a", tools: ZTOOLS, messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "hello" }] }) });
  assert.equal(r.status, 200, await r.text().catch(() => ""));
  const p = prompts().at(-1);
  assert.equal(p.mcp, 1, "Filament's MCP server was passed"); assert.equal(p.disableBuiltIn, true, "and the built-ins are off: native is genuinely in force");
  assert.equal(p.mcpTools, 7, "with the six file tools and the chat's own recall listed (11-06); no Space, its project has none made (10-29)");
  const rec = app.usage.list(1)[0];
  assert.equal(rec.acp.bridge, "native");
  assert.ok(![...(rec.priorChanges || []), ...(rec.changes || [])].some((c) => /declares no HTTP MCP support/.test(c)), "and no capability note is written when nothing was lost");
});
