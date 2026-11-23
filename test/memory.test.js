// Long-term memory end to end through a real Filament with a stand-in engine (the fake sidecar speaks the same
// newline-JSON protocol as the Python one): the autopilot briefing on the first turn, opt-outs, `@mem` commands
// answered locally, the memory tools offered to the model and the server-side loop that runs them (JSON and
// streaming), mixed tool replies deferred to the next request, agents reaching the memory tools through Filament's
// MCP server, and the dashboard endpoints.
import "./helpers/clean-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { houseAuth, houseKey } from "../src/services/house.js";
import * as memoryLoop from "../src/app/pipeline/dispatch/memory-loop.js";
import { until } from "./helpers/wait.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_AGENT = join(here, "fixtures", "fake-acp-agent.mjs");
const FAKE_SIDECAR = join(here, "fixtures", "fake-sidecar.mjs");

// What the stand-in engine holds: two good memories, one below the score floor, and canonical identity facts.
const MEMORIES = [
  { id: "m1", content: "The user writes TypeScript with tabs and no semicolons.", fixedScore: 0.81, importance: 0.9, source: "preference", scope: "global", veracity: "stated", timestamp: "2026-09-10T10:00:00" },
  { id: "m2", content: "The user's main project is Filament, a local proxy for coding agents.", fixedScore: 0.55, importance: 0.7, source: "project", scope: "global", veracity: "stated", timestamp: "2026-09-12T10:00:00" },
  { id: "m3", content: "Once mentioned liking cats.", fixedScore: 0.05, importance: 0.2, source: "insight", scope: "session", veracity: "inferred", timestamp: "2026-09-01T10:00:00" },
];
const CANONICAL = [{ owner_id: "hermes-user", category: "identity", name: "name", body: "Alice", confidence: 1, version: 1 }, { owner_id: "hermes-user", category: "voice", name: "style", body: "terse, no filler", confidence: 1, version: 1 }];

// ---- a real Filament with memory on, the fake sidecar as engine, a fake OpenAI-compatible upstream and the fake agent ----
let up, upPort, lastBody = null, bodies = [], app, port, dataDir, logFile, opsLog, callsFile;
const prompts = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const ops = () => (existsSync(opsLog) ? readFileSync(opsLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sse = (o) => `data: ${JSON.stringify(o)}\n\n`;
before(async () => {
  up = http.createServer((req, res) => { let buf = ""; req.on("data", (d) => (buf += d)); req.on("end", () => {
    lastBody = JSON.parse(buf || "{}"); bodies.push(lastBody);
    if (req.url.endsWith("/responses")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ id: "resp_up", object: "response", created_at: 1, model: lastBody.model, status: "completed", output: [{ id: "msg_up", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] }], usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } })); }
    const followUp = (lastBody.messages || []).some((m) => m.role === "tool");
    const usage = { prompt_tokens: followUp ? 7 : 5, completion_tokens: followUp ? 2 : 1, total_tokens: followUp ? 9 : 6 };
    let message = { role: "assistant", content: "ok" }; let finish = "stop";
    if (lastBody.model === "gpt-loop" && !followUp) { message = { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "filament_memory_search", arguments: JSON.stringify({ query: "tabs semicolons" }) } }] }; finish = "tool_calls"; }
    else if (lastBody.model === "gpt-loop") message = { role: "assistant", content: "Found: tabs, no semicolons." };
    else if (lastBody.model === "gpt-mixed" && !followUp) { message = { role: "assistant", content: null, tool_calls: [{ id: "call_r", type: "function", function: { name: "Read", arguments: "{\"file_path\":\"x\"}" } }, { id: "call_m", type: "function", function: { name: "filament_memory_search", arguments: "{\"query\":\"tabs\"}" } }] }; finish = "tool_calls"; }
    // `CALL <tool> <json>` in the newest user message: the model calls that tool with those arguments.
    else if (lastBody.model === "gpt-call" && !followUp) {
      const asked = /CALL (\S+) (\{.*\})/.exec(String((lastBody.messages || []).filter((m) => m.role === "user").at(-1)?.content || ""));
      if (asked) { message = { role: "assistant", content: null, tool_calls: [{ id: "call_x", type: "function", function: { name: asked[1], arguments: asked[2] } }] }; finish = "tool_calls"; }
    }
    if (lastBody.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta, fr = null) => sse({ id: "c1", object: "chat.completion.chunk", model: lastBody.model, choices: [{ index: 0, delta, finish_reason: fr }] });
      let out = chunk({ role: "assistant", content: "" });
      if (message.tool_calls) { message.tool_calls.forEach((tc, i) => { out += chunk({ tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function.name, arguments: "" } }] }); out += chunk({ tool_calls: [{ index: i, function: { arguments: tc.function.arguments } }] }); }); }
      else out += chunk({ content: message.content });
      out += chunk({}, finish) + sse({ id: "c1", object: "chat.completion.chunk", model: lastBody.model, choices: [], usage }) + "data: [DONE]\n\n";
      return res.end(out);
    }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "c", object: "chat.completion", model: lastBody.model, choices: [{ index: 0, message, finish_reason: finish }], usage }));
  }); });
  await new Promise((r) => up.listen(0, "127.0.0.1", r)); upPort = up.address().port;
  dataDir = mkdtempSync(join(tmpdir(), "filament-mem-")); logFile = join(dataDir, "prompts.jsonl"); opsLog = join(dataDir, "engine-ops.jsonl"); callsFile = join(dataDir, "acp-calls.jsonl");
  const stateFile = join(dataDir, "fake-engine-state.json"); writeFileSync(stateFile, JSON.stringify({ memories: MEMORIES, canonical: CANONICAL, seq: 10 }));
  process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: process.execPath, args: [FAKE_SIDECAR], env: { FAKE_SIDECAR_STATE: stateFile, FAKE_SIDECAR_RECALL_ALL: "1", FAKE_SIDECAR_LOG: opsLog } });
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  // The agent loop, always on (the owner's of 11-09), claims the `agent/*` names this suite routes to its fake ACP
  // upstream only on a harness chat's turn or Filament's own call, and these are a client's requests.
  cfg.upstreams = [{ id: "oai", name: "oai", type: "openai-compatible", baseUrl: `http://127.0.0.1:${upPort}`, apiKey: "s" }, { id: "rsp", name: "rsp", type: "openai-compatible", baseUrl: `http://127.0.0.1:${upPort}`, apiKey: "s", wireApi: "responses" }, { id: "fake", name: "fake agent", type: "acp", acp: { command: process.execPath, args: [FAKE_AGENT], env: { FAKE_ACP_LOG: logFile }, cwd: dataDir } }, { id: "fakeask", name: "fake agent that asks", type: "acp", acp: { command: process.execPath, args: [FAKE_AGENT], env: { FAKE_ACP_LOG: logFile }, cwd: dataDir, permissions: "ask" } }, { id: "fakeslow", name: "fake agent slow to open a session", type: "acp", acp: { command: process.execPath, args: [FAKE_AGENT], env: { FAKE_ACP_CALLS: callsFile, FAKE_ACP_SLOW_NEW_MS: "2000" }, cwd: dataDir } }];
  cfg.routes = [{ match: "gpt-*", upstream: "oai", upstreamModel: "{model}" }, { match: "rsp-*", upstream: "rsp", upstreamModel: "{model}" }, { match: "agent/*", upstream: "fake", upstreamModel: "{1}" }, { match: "ask/*", upstream: "fakeask", upstreamModel: "{1}" }, { match: "slow/*", upstream: "fakeslow", upstreamModel: "{1}" }];
  cfg.memory = { enabled: true, folder: join(dataDir, "mem"), autopilot: { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true, toolIterations: 4, cue: true }, capture: { turns: true, learn: true, excludeModels: ["gpt-skip*"] }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: true } };
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); up.close(); delete process.env.FILAMENT_MEMORY_SIDECAR; for (let i = 0; i < 10; i++) { try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } } });
const H = { "content-type": "application/json", authorization: "Bearer k" };
const chat = (body, extra = {}) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { ...H, ...extra }, body: JSON.stringify(body) });
const SYS = { role: "system", content: "You help.\nWorking directory: C:\\demo" };
/**
 * A POST from a caller Filament does not take for this machine's own: from 127.0.0.2, which its guards do not count as
 * loopback, as they do not another machine. It carries the inbound key and no admin token.
 * @param {string} path @param {any} body @param {Record<string, string>} [extra]
 * @returns {Promise<{ status: number | undefined, text: string }>}
 */
const fromElsewhere = (path, body, extra = {}) =>
  new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, localAddress: "127.0.0.2", path, method: "POST", headers: { ...H, ...extra, "content-length": String(Buffer.byteLength(raw)) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end(raw);
  });

test("first turn: a stable briefing in the system prompt (deep recall; the engine's canonical facts unread), memory tools offered, the record counts but never quotes", async () => {
  const r = await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "format this file for me the way I like" }] }, { "x-session-id": "conv-1" });
  assert.equal(r.status, 200); const sys = lastBody.messages[0]; assert.equal(sys.role, "system");
  assert.ok(sys.content.startsWith("You help."), sys.content.slice(0, 80)); assert.ok(sys.content.includes('<filament-memory kind="briefing">')); assert.ok(!sys.content.includes("Alice"), "the engine's canonical facts are not read: the facts about the user are memories"); assert.ok(sys.content.includes("TypeScript with tabs")); assert.ok(!sys.content.includes("liking cats"), "below the score floor");
  assert.ok(sys.content.includes("Memory tools (filament_memory_*)"), "the model is told about the tools");
  assert.equal(lastBody.tools.filter((t) => t.function?.name?.startsWith("filament_memory_")).length, 9);
  const rec = app.usage.list(1)[0]; assert.ok(rec.memory.briefing >= 2, JSON.stringify(rec.memory)); assert.equal(rec.memory.tools, true); assert.ok(rec.memory.chain); assert.equal(rec.memory.turn, 1);
  assert.ok(rec.changes.some((c) => /memory: briefing added to the system prompt/.test(c)), rec.changes.join(" | ")); assert.ok(!JSON.stringify(rec).includes("TypeScript with tabs"), "content never on the record");
  // The memory timeline: every step timed, the engine calls counted, nothing quoted. The list view only flags it; the detail carries it.
  assert.equal(rec.hasMemoryTrace, true); assert.equal(rec.memoryTrace, undefined, "the trace stays off the list view");
  const d = app.usage.detail(rec.id); const tr = d.memoryTrace; assert.ok(tr && Array.isArray(tr.steps) && tr.steps.length > 10, JSON.stringify(tr).slice(0, 300));
  const names = tr.steps.map((x) => x.name);
  for (const n of ["situate", "prepare", "session lookup", "signals read", "turn archived", "briefing built", "in every project", "engine recall", "engine results filtered", "briefing placed", "memory tools offered", "tools added to the request", "handed to the upstream", "after the reply", "reply archived", "use judged", "learning queued"]) assert.ok(names.includes(n), `step "${n}" missing in ${names.join(" > ")}`);
  const prep = tr.steps.find((x) => x.name === "prepare"); assert.ok(prep.ms >= 0 && prep.tokensAdded > 0 && prep.briefingItems >= 2, JSON.stringify(prep));
  const rec1 = tr.steps.find((x) => x.name === "engine recall"); assert.equal(rec1.kind, "engine"); assert.equal(rec1.ok, true); assert.equal(rec1.rows, 3); assert.ok(rec1.ms >= 0);
  const filt = tr.steps.find((x) => x.name === "engine results filtered"); assert.equal(filt.kept, 2); assert.equal(filt.underFloor, 1);
  assert.equal(tr.summary.engineCalls >= 2, true); assert.ok(tr.summary.blockingMs >= prep.ms, "blocking time covers prepare"); assert.equal(typeof tr.marks.handed, "number"); assert.equal(typeof tr.marks.firstByte, "number"); assert.ok(tr.marks.firstByte >= tr.marks.handed);
  assert.ok(tr.steps.filter((x) => x.phase === "after").length >= 2 && tr.steps.every((x) => ["before", "upstream", "after", "later"].includes(x.phase)));
  const all = JSON.stringify(d); assert.ok(!all.includes("TypeScript with tabs") && !all.includes("Alice") && !all.includes("liking cats"), "memory content never on the record, trace included");
  const first = sys.content;
  await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "format this file for me the way I like" }, { role: "assistant", content: "ok" }, { role: "user", content: "now the other file too" }] }, { "x-session-id": "conv-1" });
  assert.equal(lastBody.messages[0].content, first, "same system prompt, the provider cache survives");
  const rec2 = app.usage.list(1)[0]; assert.equal(rec2.memory.turn, 2); assert.equal(rec2.memory.briefing, 0);
  // The reused briefing still weighs on the second request (harness B8): the record says how much, never what.
  assert.ok(rec2.memory.composition.briefing > 20, JSON.stringify(rec2.memory.composition)); assert.equal(rec.memory.composition.briefing, rec2.memory.composition.briefing, "the same bytes, the same weight"); assert.equal(rec2.memory.composition.goal, 0);
});

test("opt-out header, excluded models and housekeeping requests get no memory and no tools", async () => {
  await chat({ model: "gpt-x", messages: [{ role: "user", content: "hello" }] }, { "x-filament-memory": "off" }); assert.equal(lastBody.messages[0].role, "user"); assert.ok(!JSON.stringify(lastBody).includes("filament-memory")); assert.equal(lastBody.tools, undefined);
  await chat({ model: "gpt-skip-1", messages: [{ role: "user", content: "hello" }] }); assert.ok(!JSON.stringify(lastBody).includes("filament-memory"));
  await chat({ model: "gpt-x", messages: [{ role: "system", content: `Generate a concise title for this coding session. This is not a conversation, do not respond to the user. Return JSON: {"title": "..."}` }, { role: "user", content: "user: please format my file" }] });
  assert.ok(!JSON.stringify(lastBody).includes("filament-memory")); assert.equal(lastBody.tools, undefined);
});

test("the trace says why memory stayed out; the engine's own model calls come in under /memory-engine/ tagged and uncaptured", async () => {
  await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "hi" }] }, { "x-filament-memory": "off" });
  // A fresh chain with the off header stays bare (2026-09-19 cache audit: quiet mode). On a chain with prior
  // injections the same request would re-attach them byte-identically instead of rewriting history.
  let d = app.usage.detail(app.usage.list(1)[0].id);
  assert.equal(d.memory?.quiet, true, "the record marks the quiet request");
  assert.equal(d.memory?.turn, undefined, "a quiet request is never captured");
  assert.equal(d.memoryTrace.steps.find((x) => x.name === "autopilot stops here")?.why, "the client sent x-filament-memory: off — nothing is recalled or recorded; the history already sent stays byte-identical, and the session's standing blocks (briefing, goal) still ride");
  // The engine's child authenticates with the house key (it is handed it at spawn); a client knocking on its door is refused.
  const engineBody = JSON.stringify({ model: "gpt-x", messages: [{ role: "user", content: "consolidate these" }] });
  const knock = await fetch(`http://127.0.0.1:${port}/memory-engine/v1/chat/completions`, { method: "POST", headers: H, body: engineBody }); assert.equal(knock.status, 403, "the engine's door is Filament's own");
  const r = await fetch(`http://127.0.0.1:${port}/memory-engine/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...houseAuth() }, body: engineBody }); assert.equal(r.status, 200);
  d = app.usage.detail(app.usage.memoryList(1)[0].id); assert.deepEqual(d.memoryFor, { purpose: "engine" }); assert.ok(!app.usage.list(5).some((r) => r.memoryFor), "memory's own calls stay out of the general list"); assert.equal(d.memory, undefined, "never captured");
  const learnLike = await chat({ model: "gpt-x", messages: [{ role: "user", content: "extract" }] }, { authorization: `Bearer ${houseKey()}`, "user-agent": "filament-memory/0.1", "x-filament-memory": "off", "x-filament-memory-purpose": "learn", "x-filament-memory-for": "chain-42" }); assert.equal(learnLike.status, 200);
  d = app.usage.detail(app.usage.memoryList(1)[0].id); assert.deepEqual(d.memoryFor, { purpose: "learn", chain: "chain-42" });
  const bench = await (await fetch(`http://127.0.0.1:${port}/api/memory/benchmark`)).json();
  assert.ok(bench.stats.requests >= 3 && bench.stats.withMemory >= 1, JSON.stringify(bench.stats)); assert.ok(bench.rows.some((x) => x.stayedOut) && bench.rows.some((x) => typeof x.blockingMs === "number" && x.engineCalls >= 1));
  assert.ok(bench.modelCalls.some((x) => x.purpose === "engine") && bench.modelCalls.some((x) => x.purpose === "learn" && x.chain === "chain-42")); assert.ok(bench.learning && Array.isArray(bench.learning.runs));
  assert.ok(!JSON.stringify(bench).includes("TypeScript with tabs"));
});

test("@mem commands are answered by Filament without calling the upstream", async () => {
  const n = bodies.length;
  const r = await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "@mem status" }] }, { "x-session-id": "conv-cmd" });
  const j = await r.json(); assert.ok(/Memory status/.test(j.choices[0].message.content), j.choices[0].message.content); assert.ok(/Mnemosyne fake-3\.15\.1 \(ready\)/.test(j.choices[0].message.content), j.choices[0].message.content);
  assert.equal(bodies.length, n, "upstream not called"); const rec = app.usage.list(1)[0]; assert.equal(rec.local, true); assert.ok(rec.changes.some((c) => /memory command/.test(c))); assert.ok(rec.memory.chain && !rec.memory.chain.includes(":"), "the record links the session by id");
  const s = await (await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "@mem sessions format file" }] }, { "x-session-id": "conv-cmd" })).json();
  assert.ok(/Sessions matching/.test(s.choices[0].message.content), s.choices[0].message.content); assert.ok(/1\. `/.test(s.choices[0].message.content));
  const st = await (await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "gpt-x", max_tokens: 50, stream: true, system: "Working directory: C:\\demo", messages: [{ role: "user", content: "@mem help" }] }) })).text();
  assert.ok(st.includes("Memory commands"), st.slice(0, 200)); assert.ok(st.includes("message_stop"));
});

test("memory tools: the model's filament_memory_search call is run by Filament and the model asked again; the client sees one answer (JSON) with the cue", async () => {
  const n = bodies.length;
  const r = await chat({ model: "gpt-loop", messages: [SYS, { role: "user", content: "how do I like my code formatted?" }] }, { "x-session-id": "conv-loop" });
  assert.equal(r.status, 200); const j = await r.json();
  assert.ok(j.choices[0].message.content.endsWith("Found: tabs, no semicolons."), j.choices[0].message.content); assert.ok(j.choices[0].message.content.startsWith("Memory: "), "the first reply of a session carries the one-line cue"); assert.equal(j.choices[0].message.tool_calls, undefined); assert.equal(j.choices[0].finish_reason, "stop");
  assert.deepEqual(j.usage, { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }, "the client sees round one's prompt plus the summed output, not the loop total");
  assert.equal(bodies.length, n + 2, "two upstream requests");
  const follow = bodies.at(-1); const asst = follow.messages.at(-2); const tool = follow.messages.at(-1);
  assert.equal(asst.role, "assistant"); assert.equal(asst.tool_calls[0].function.name, "filament_memory_search"); assert.equal(tool.role, "tool"); assert.equal(tool.tool_call_id, "call_1"); assert.ok(tool.content.includes("TypeScript with tabs"), tool.content.slice(0, 200));
  const rec = app.usage.list(1)[0]; assert.equal(rec.memory.toolRounds, 1); assert.equal(rec.memory.toolCalls, 1); assert.ok(rec.changes.some((c) => /used memory tools \(search\)/.test(c)), rec.changes.join(" | ")); assert.ok(rec.memory.cue && typeof rec.memory.cue === "object" && Array.isArray(rec.memory.cue.sessions), "the cue travels as data (Facade D5), the sentence is cueText's");
  assert.equal(rec.tokens.input, 12, "the record keeps every round's input (billing truth)"); assert.equal(rec.tokens.output, 3);
  assert.ok(!JSON.stringify(rec).includes("TypeScript with tabs"));
});

test("the trace of a tool-loop request shows the round, the tool run and the follow-up", async () => {
  const r = await chat({ model: "gpt-loop", messages: [SYS, { role: "user", content: "how do I like my formatting?" }] }, { "x-session-id": "conv-trace-loop" }); assert.equal(r.status, 200);
  const d = app.usage.detail(app.usage.list(1)[0].id); const names = d.memoryTrace.steps.map((x) => x.name);
  for (const n of ["the model asked memory", "tool search", "upstream asked again with the results"]) assert.ok(names.includes(n), names.join(" > "));
  assert.equal(d.memoryTrace.summary.toolRounds, 1); assert.equal(d.memoryTrace.summary.toolCalls, 1); assert.ok(d.memoryTrace.steps.find((x) => x.name === "tool search").resultChars > 0);
  assert.ok(d.memoryTrace.steps.filter((x) => x.phase === "upstream").length >= 3);
});

test("memory tools while streaming: text flows, the tool call is hidden, one [DONE], usage summed", async () => {
  const r = await chat({ model: "gpt-loop", stream: true, messages: [SYS, { role: "user", content: "how do I like my code formatted? (stream)" }] }, { "x-session-id": "conv-loop-s" });
  assert.equal(r.status, 200); const text = await r.text();
  const events = text.split("\n\n").filter((b) => b.startsWith("data:")).map((b) => b.slice(5).trim()).map((d) => (d === "[DONE]" ? "[DONE]" : JSON.parse(d)));
  assert.equal(events.filter((e) => e === "[DONE]").length, 1, "exactly one [DONE]");
  assert.ok(!text.includes("filament_memory_search"), "the tool call never reached the client");
  assert.ok(events.some((e) => e !== "[DONE]" && e.choices?.[0]?.delta?.content === "Found: tabs, no semicolons."));
  assert.ok(events.some((e) => e !== "[DONE]" && e.choices?.[0]?.finish_reason === "stop"));
  const usage = events.find((e) => e !== "[DONE]" && e.usage)?.usage; assert.deepEqual(usage, { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }, "the client's context meter sees round one's prompt, not the loop total");
  const rec = app.usage.list(1)[0]; assert.equal(rec.memory.toolRounds, 1); assert.equal(rec.status, "ok"); assert.equal(rec.tokens.input, 12, "the record keeps the loop total"); assert.equal(rec.tokens.output, 3);
});

test("a reply mixing the client's tool and a memory tool: the client gets its tool only; the memory result waits for the next request", async () => {
  const r = await chat({ model: "gpt-mixed", tools: [{ type: "function", function: { name: "Read", parameters: { type: "object" } } }], messages: [SYS, { role: "user", content: "read x and recall my formatting" }] }, { "x-session-id": "conv-mixed" });
  const j = await r.json(); assert.equal(j.choices[0].message.tool_calls.length, 1); assert.equal(j.choices[0].message.tool_calls[0].function.name, "Read"); assert.equal(j.choices[0].finish_reason, "tool_calls");
  await new Promise((res) => setTimeout(res, 100));
  await chat({ model: "gpt-mixed", tools: [{ type: "function", function: { name: "Read", parameters: { type: "object" } } }], messages: [SYS, { role: "user", content: "read x and recall my formatting" }, { role: "assistant", content: null, tool_calls: [{ id: "call_r", type: "function", function: { name: "Read", arguments: "{\"file_path\":\"x\"}" } }] }, { role: "tool", tool_call_id: "call_r", content: "file contents" }] }, { "x-session-id": "conv-mixed" });
  const last = lastBody.messages.at(-1); assert.equal(last.role, "tool"); assert.ok(last.content.includes('<filament-memory kind="tool">'), last.content.slice(0, 300)); assert.ok(last.content.includes("TypeScript with tabs"));
});

// (fails before: yes — a passthrough to a Responses upstream sent the client's input as it came: what memory added to a
// message lived in the chat body, which never left Filament)
test("a Responses client in front of a Responses upstream: what memory adds to a message rides its input item, and a resend carries it again byte for byte", async () => {
  await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "we settled on tabs for the parser module" }] }, { "x-session-id": "rsp-source" });
  const source = app.usage.list(1)[0].memory.chain; assert.ok(source);
  const ask = { role: "user", content: "what did we settle on for the parser?" };
  const responses = (input, extra = {}) => fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", headers: { ...H, "x-session-id": "rsp-1", ...extra }, body: JSON.stringify({ model: "rsp-x", instructions: SYS.content, input }) });
  const r1 = await responses([ask], { "x-filament-memory-load": source }); assert.equal(r1.status, 200, await r1.text());
  assert.equal(lastBody.messages, undefined, "the Responses shape went through");
  const first = lastBody.input[0];
  assert.ok(String(first.content).startsWith(`${ask.content}\n\n<filament-memory kind="load">`), JSON.stringify(first).slice(0, 300));
  const r2 = await responses([ask, { role: "assistant", content: "Tabs." }, { role: "user", content: "and for the lexer?" }]); assert.equal(r2.status, 200, await r2.text());
  assert.equal(lastBody.input[0].content, first.content, "the block rides the same item again, byte for byte");
  assert.equal(lastBody.input[1].content, "Tabs.");
});

// (fails before: yes — MEMR-5's scope: `x-filament-memory-load` pasted any chat it named into the request of whoever sent
// it: a page that rebound a name to this machine, or a client on another machine without the admin token)
test("a session named for loading by a caller that could not read every session anyway is not loaded, and the record says why", async () => {
  await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "we settled on spaces for the lexer module" }] }, { "x-session-id": "load-source" });
  const source = app.usage.list(1)[0].memory.chain; assert.ok(source);
  // A client Filament does not take for this machine's own, without the admin token (a page whose name was rebound to
  // this machine is refused at the door, security.test.js).
  const { status } = await fromElsewhere("/v1/chat/completions", { model: "gpt-x", messages: [SYS, { role: "user", content: "what did we settle on for the lexer?" }] }, { "x-session-id": "load-stranger", "x-filament-memory-load": source });
  assert.equal(status, 200);
  const said = () => String(lastBody.messages.at(-1).content);
  assert.ok(said().startsWith("what did we settle on for the lexer?") && !said().includes('<filament-memory kind="load">'), `nothing loaded into its request: ${said().slice(0, 300)}`);
  const rec = app.usage.list(1)[0];
  assert.equal(rec.memory.loaded, undefined);
  assert.ok(rec.changes.includes("memory: x-filament-memory-load set aside — a session is loaded by its id only for a caller that could read every session anyway: one on this machine that names it as its own, or one with the admin token"), rec.changes.join(" | "));
  // The same request from a client on this machine, naming it, loads the session.
  const r = await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "and what for the parser?" }] }, { "x-session-id": "load-local", "x-filament-memory-load": source });
  assert.equal(r.status, 200);
  assert.ok(said().startsWith(`and what for the parser?\n\n<filament-memory kind="load">\nPast session ${source} (chat view)`), said().slice(0, 300));
  assert.equal(app.usage.list(1)[0].memory.loaded, source);
});

const SYS_B = { role: "system", content: "You help.\nWorking directory: C:\\elsewhere-b" };
/** A chat in `sys`'s folder whose one message is `content`: its session's id. @param {any} sys @param {string} content @param {string} sid */
const sessionOf = async (sys, content, sid) => {
  const r = await chat({ model: "gpt-x", messages: [sys, { role: "user", content }] }, { "x-session-id": sid });
  assert.equal(r.status, 200, await r.text());
  const chain = app.usage.list(1)[0].memory.chain;
  assert.ok(chain);
  return chain;
};

// (fails before: yes — `x-filament-chain` was believed from any caller: one from another machine without the admin token
// named any session on this machine and continued it, its history and memory with it; the owner's rule of 10-31: a
// client's is believed from no caller, the header being Filament's own)
test("a client's x-filament-chain is believed from no caller; Filament's own call's is", async () => {
  const own = await sessionOf(SYS, "the demo's queue drains at midnight", "chain-own");
  const other = await sessionOf(SYS_B, "the other project's keys are kept in vault nine", "chain-other");
  const ask = (/** @type {string} */ content) => ({ model: "gpt-x", messages: [SYS, { role: "user", content }] });
  const r1 = await fromElsewhere("/v1/chat/completions", ask("what is kept where?"), { "x-filament-chain": other });
  assert.equal(r1.status, 200, r1.text);
  const aside = app.usage.list(1)[0];
  assert.notEqual(aside.memory.chain, other, "the other project's session is not continued");
  assert.ok(aside.changes.some((/** @type {string} */ c) => /dropped x-filament-chain/.test(c)), aside.changes.join(" | "));
  assert.ok(!bodies.at(-1).messages.some((/** @type {any} */ m) => /vault nine/.test(JSON.stringify(m.content))), "nothing of it reaches the request");
  const r2 = await fromElsewhere("/v1/chat/completions", ask("when does the queue drain?"), { "x-filament-chain": own });
  assert.equal(r2.status, 200, r2.text);
  assert.notEqual(app.usage.list(1)[0].memory.chain, own, "nor its own project's");
  const r3 = await chat(ask("and where are the keys?"), { "x-filament-chain": other });
  assert.equal(r3.status, 200, await r3.text());
  assert.notEqual(app.usage.list(1)[0].memory.chain, other, "nor from this machine");
  // Filament's own call naming the session (a harness turn's) goes on in it.
  const house = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...houseAuth(), "x-filament-memory": "tools", "x-filament-chain": other }, body: JSON.stringify(ask("a tick")) });
  assert.equal(house.status, 200, await house.text());
  assert.equal(app.usage.list(1)[0].memory?.chain, other);
});

// (fails before: yes — the model's memory tools reached every session whoever's request it was: one from another
// machine without the admin token loaded, grepped, listed and searched every project's sessions)
test("the model's memory tools, for a caller that could not read every session, keep to its own project's sessions; one on this machine reaches every session", async () => {
  const ownA = await sessionOf(SYS, "the demo's lantern job runs hourly", "tools-own");
  const other = await sessionOf(SYS_B, "the zebra relay listens on port 7777", "tools-other");
  const call = (/** @type {string} */ tool, /** @type {any} */ args) => ({ model: "gpt-call", messages: [SYS, { role: "user", content: `CALL ${tool} ${JSON.stringify(args)}` }] });
  const result = () => String((lastBody.messages || []).find((/** @type {any} */ m) => m.role === "tool")?.content || "");
  const away = async (/** @type {string} */ tool, /** @type {any} */ args, /** @type {string} */ sid) => {
    const r = await fromElsewhere("/v1/chat/completions", call(tool, args), { "x-session-id": sid });
    assert.equal(r.status, 200, r.text);
    return result();
  };
  const here = async (/** @type {string} */ tool, /** @type {any} */ args, /** @type {string} */ sid) => {
    const r = await chat(call(tool, args), { "x-session-id": sid });
    assert.equal(r.status, 200, await r.text());
    return result();
  };
  const refused = JSON.stringify({ error: "no such session in this project's memory" });
  assert.equal(await away("filament_memory_load", { session: other }, "t-1"), refused);
  assert.equal(await away("filament_memory_grep", { session: other, text: "zebra" }, "t-2"), refused);
  assert.match(await away("filament_memory_load", { session: ownA }, "t-3"), /lantern job runs hourly/, "its own project's session loads");
  const listed = JSON.parse(await away("filament_memory_sessions", { query: "" }, "t-4")).sessions.map((/** @type {any} */ s) => s.id);
  assert.ok(listed.includes(ownA) && !listed.includes(other), JSON.stringify(listed));
  // What was typed in the other project's session is not found (its own sessions' calls name the words too).
  assert.doesNotMatch(await away("filament_memory_search", { query: "zebra relay" }, "t-5"), /port 7777/, "another project's words are not found");
  // On this machine, every session.
  assert.match(await here("filament_memory_load", { session: other }, "t-6"), /zebra relay listens on port 7777/);
  assert.match(await here("filament_memory_search", { query: "zebra relay" }, "t-7"), /port 7777/);
});

// (fails before: yes — a session's lineage, loaded for a caller that could not read every session, brought in each
// session it continues, another project's too)
test("a lineage loaded for a caller that could not read every session — by the model's tool or by @mem load — keeps to its own project's sessions", async () => {
  const earlier = await sessionOf(SYS_B, "the plover sync began in the other project", "lin-other");
  const own = await sessionOf(SYS, "the demo's plover port goes on", "lin-own");
  // Filament's own continuations stay in one project; an archive's parent link can name any session.
  app.memory.archive.setParent(own, earlier);
  const load = { model: "gpt-call", messages: [SYS, { role: "user", content: `CALL filament_memory_load ${JSON.stringify({ session: own, view: "lineage" })}` }] };
  const result = () => String((lastBody.messages || []).find((/** @type {any} */ m) => m.role === "tool")?.content || "");
  const r1 = await fromElsewhere("/v1/chat/completions", load, { "x-session-id": "lin-1" });
  assert.equal(r1.status, 200, r1.text);
  assert.match(result(), /plover port goes on/);
  assert.doesNotMatch(result(), /plover sync began/, "the other project's session is left out");
  const typed = [SYS, { role: "user", content: `@mem load ${own} lineage` }];
  const r2 = await fromElsewhere("/v1/chat/completions", { model: "gpt-x", messages: typed }, { "x-session-id": "lin-2" });
  assert.equal(r2.status, 200, r2.text);
  const r3 = await fromElsewhere("/v1/chat/completions", { model: "gpt-x", messages: [...typed, { role: "assistant", content: JSON.parse(r2.text).choices[0].message.content }, { role: "user", content: "so where are we?" }] }, { "x-session-id": "lin-2" });
  assert.equal(r3.status, 200, r3.text);
  const pasted = String(bodies.at(-1).messages.at(-1).content);
  assert.match(pasted, /<filament-memory kind="load">[\s\S]*plover port goes on/, pasted.slice(0, 400));
  assert.doesNotMatch(pasted, /plover sync began/, "the other project's session is left out");
  // On this machine, the whole lineage.
  assert.equal((await chat(load, { "x-session-id": "lin-3" })).status, 200);
  assert.match(result(), /plover sync began[\s\S]*plover port goes on/);
});

// (fails before: yes — `@mem load` reached any session for whoever typed it, a chat of a client from another machine
// without the admin token too)
test("@mem load, typed in a chat of a caller that could not read every session, reaches its own project's sessions alone", async () => {
  const other = await sessionOf(SYS_B, "the heron batch closes on Fridays", "mem-other");
  const typed = async (/** @type {string} */ content, /** @type {string} */ sid) => {
    const r = await fromElsewhere("/v1/chat/completions", { model: "gpt-x", messages: [SYS, { role: "user", content }] }, { "x-session-id": sid });
    assert.equal(r.status, 200, r.text);
    return String(JSON.parse(r.text).choices[0].message.content);
  };
  assert.equal(await typed(`@mem load ${other}`, "m-1"), `No session ${other} in this project's memory. Run \`@mem sessions <words>\` first.`);
  const r = await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: `@mem load ${other}` }] }, { "x-session-id": "m-3" });
  assert.match(String((await r.json()).choices[0].message.content), new RegExp(`^Loaded session \`${other}\``), "on this machine it loads");
});

// (fails before: yes — on 41c8d5e9c the chat's own session pasted the message being sent into itself and linked the
// session to itself; on 1d8c5f5c4 it loaded nothing, its lineage neither)
test("@mem load of the chat's own session brings its earlier turns, and its lineage its ancestors, never the message being sent", async () => {
  const earlier = await sessionOf(SYS, "the heron feed began last spring", "self-load-before");
  const asked = { role: "user", content: "the wren job runs nightly" };
  const r0 = await chat({ model: "gpt-x", messages: [SYS, asked] }, { "x-session-id": "self-load" });
  const reply = String((await r0.json()).choices[0].message.content);
  const own = app.usage.list(1)[0].memory.chain;
  assert.ok(own && own !== earlier, "the chat's session");
  app.memory.archive.setParent(own, earlier);
  let history = [SYS, asked, { role: "assistant", content: reply }];
  /** The block pasted into the message after `@mem load …`. @param {string} typed @param {string} next */
  const loaded = async (typed, next) => {
    const r1 = await chat({ model: "gpt-x", messages: [...history, { role: "user", content: typed }] }, { "x-session-id": "self-load" });
    const said = String((await r1.json()).choices[0].message.content);
    assert.match(said, /^Loaded /, said);
    history = [...history, { role: "user", content: typed }, { role: "assistant", content: said }];
    const r2 = await chat({ model: "gpt-x", messages: [...history, { role: "user", content: next }] }, { "x-session-id": "self-load" });
    assert.equal(r2.status, 200, await r2.clone().text());
    const back = String((await r2.json()).choices[0].message.content);
    const msg = String(bodies.at(-1).messages.at(-1).content);
    history = [...history, { role: "user", content: next }, { role: "assistant", content: back }];
    return /<filament-memory kind="load">([\s\S]*?)<\/filament-memory>/.exec(msg)?.[1] ?? "";
  };
  const chatView = await loaded(`@mem load ${own}`, "and the finch job?");
  assert.match(chatView, /wren job runs nightly/, "its earlier turn");
  assert.doesNotMatch(chatView, /finch job/, "not the message being sent");
  const lineage = await loaded(`@mem load ${own} lineage`, "and the sparrow job?");
  assert.match(lineage, /heron feed began[\s\S]*wren job runs nightly/, "the ancestor, then its own earlier turns");
  assert.doesNotMatch(lineage, /sparrow job/, "not the message being sent");
  assert.deepEqual(app.memory.archive.linksFor(own).filter((/** @type {any} */ l) => l.type === "loaded" && l.dst === own), [], "no link of the session to itself");
});

// (fails before: yes — a lineage the chat's session is an ancestor in rendered the chat's session whole, the message
// being sent with it)
test("@mem load of a lineage the chat's own session is in never brings the message being sent", async () => {
  const asked = { role: "user", content: "the kite feed is hourly" };
  const r0 = await chat({ model: "gpt-x", messages: [SYS, asked] }, { "x-session-id": "anc-load" });
  const reply = String((await r0.json()).choices[0].message.content);
  const own = app.usage.list(1)[0].memory.chain;
  const later = await sessionOf(SYS, "the lark job continues the kite feed", "anc-later");
  assert.ok(own && later !== own, "two sessions");
  app.memory.archive.setParent(later, own);
  const history = [SYS, asked, { role: "assistant", content: reply }, { role: "user", content: `@mem load ${later} lineage` }];
  const r1 = await chat({ model: "gpt-x", messages: history }, { "x-session-id": "anc-load" });
  const said = String((await r1.json()).choices[0].message.content);
  assert.match(said, /^Loaded the lineage/, said);
  const r2 = await chat({ model: "gpt-x", messages: [...history, { role: "assistant", content: said }, { role: "user", content: "and the robin job?" }] }, { "x-session-id": "anc-load" });
  assert.equal(r2.status, 200, await r2.clone().text());
  const block = /<filament-memory kind="load">([\s\S]*?)<\/filament-memory>/.exec(String(bodies.at(-1).messages.at(-1).content))?.[1] ?? "";
  assert.match(block, /kite feed is hourly[\s\S]*lark job continues/, "the chat's session, then the one that continues it");
  assert.doesNotMatch(block, /robin job/, "not the message being sent");
});

// (fails before: yes — the load was taken by the first request memory prepared, one it said nothing into as well (a
// chat with memory off), and lost there, while the reply promised it in the next message)
test("@mem load waits while memory is off in the chat, and rides the first message after @mem on", async () => {
  const other = await sessionOf(SYS, "the egret index reindexes on Sundays", "wait-other");
  /** @type {any[]} */
  let history = [SYS];
  const say = async (/** @type {string} */ content) => {
    history = [...history, { role: "user", content }];
    const r = await chat({ model: "gpt-x", messages: history }, { "x-session-id": "wait-load" });
    assert.equal(r.status, 200, await r.clone().text());
    const back = String((await r.json()).choices[0].message.content);
    history = [...history, { role: "assistant", content: back }];
    return back;
  };
  const block = () => /<filament-memory kind="load">([\s\S]*?)<\/filament-memory>/.exec(String(bodies.at(-1).messages.at(-1).content))?.[1] ?? "";
  await say("the heron gate opens at nine");
  await say("@mem off");
  const said = await say(`@mem load ${other}`);
  await say("and the egret index?");
  assert.equal(block(), "", "nothing pasted while memory is off here");
  await say("@mem on");
  await say("so when does it reindex?");
  assert.match(block(), /egret index reindexes on Sundays/, "it rides the first message after @mem on");
  assert.match(said, /It waits while memory is off in this chat \(`@mem on` turns it back on\), then rides your next message here\.$/, said);
});

// (fails before: yes — `@mem attach <session>` made the chat's key resolve to the session it named, and the chat's turns
// went on in that session: the owner's rule of 10-31, an outside client's chat is its own session)
test("@mem attach is no command: the help answers it, and the chat's turns stay in its own session", async () => {
  const other = await sessionOf(SYS, "the finch export runs at noon", "att-other");
  const typed = { role: "user", content: `@mem attach ${other}` };
  const r = await chat({ model: "gpt-x", messages: [SYS, typed] }, { "x-session-id": "att-mine" });
  assert.equal(r.status, 200);
  const said = String((await r.json()).choices[0].message.content);
  assert.match(said, /^\*\*Memory commands\*\* \(@mem\)\n/, said.slice(0, 300));
  assert.doesNotMatch(said, /attach/, "the help names no attach");
  const mine = app.usage.list(1)[0].memory.chain;
  assert.ok(mine && mine !== other, "the command was answered on the chat's own session");
  const turnsOfOther = app.memory.archive.getTurns(other).length;
  const next = await chat({ model: "gpt-x", messages: [SYS, typed, { role: "assistant", content: said }, { role: "user", content: "and when does the finch export run?" }] }, { "x-session-id": "att-mine" });
  assert.equal(next.status, 200, await next.text());
  assert.equal(app.usage.list(1)[0].memory.chain, mine, "its next turn is the chat's own session's");
  assert.equal(app.memory.archive.getTurns(other).length, turnsOfOther, "the session it named has no turn of it");
});

// (fails before: yes — a coding agent's memory tools reached every session whoever's turn it was)
test("a coding agent's memory tools, in a turn for a caller that could not read every session, keep to its own project's sessions", async () => {
  const other = await sessionOf(SYS_B, "the osprey cache warms at dawn", "agent-other");
  const sys = { role: "system", content: `Working directory: ${dataDir}` };
  const ask = { model: "agent/fake-a", messages: [sys, { role: "user", content: `~mcpcall filament_memory_load {"session":"${other}"}` }] };
  const r1 = await fromElsewhere("/v1/chat/completions", ask, { "x-session-id": "ag-1" });
  assert.equal(r1.status, 200, r1.text);
  assert.match(String(JSON.parse(r1.text).choices[0].message.content), /mcp:.*no such session in this project's memory/);
  const r2 = await chat(ask, { "x-session-id": "ag-2" });
  assert.match(String((await r2.json()).choices[0].message.content), /osprey cache warms at dawn/, "on this machine it loads");
});

// (fails before: yes — the review of 38673a79a: only a request memory situated carried `confined`, so in a turn whose
// situate failed a coding agent's memory tools, for a caller that could not read every session, reached every session)
test("a coding agent's memory tools keep to its own project's sessions for such a caller in a turn whose situate failed too", async () => {
  const other = await sessionOf(SYS_B, "the heron queue drains at midnight", "agent-other-unsituated");
  const sys = { role: "system", content: `Working directory: ${dataDir}` };
  const ask = { model: "agent/fake-a", messages: [sys, { role: "user", content: `~mcpcall filament_memory_load {"session":"${other}"}` }] };
  // Memory's situate of this request alone throws, as a busy file would.
  const brain = app.memory.brain;
  const situate = brain.situate;
  let broke = false;
  brain.situate = function (args) {
    if (args?.headers?.["x-session-id"] !== "ag-unsituated") return situate.call(this, args);
    brain.situate = situate;
    broke = true;
    throw new Error("the situate broke");
  };
  const r = await fromElsewhere("/v1/chat/completions", ask, { "x-session-id": "ag-unsituated" }).finally(() => (brain.situate = situate));
  assert.ok(broke, "its situate failed");
  assert.equal(r.status, 200, r.text);
  const said = String(JSON.parse(r.text).choices[0].message.content);
  assert.match(said, /mcp:.*no such session in this project's memory/, said);
  assert.doesNotMatch(said, /heron queue/);
});

// (fails before: yes — t420, a memory cache breaker: a request memory could not read went out with none of memory's
// tools, and the next one it read brought them back, so the tools section under the conversation changed twice and the
// provider wrote the whole conversation to its cache twice for one miss)
test("a client's request memory could not read keeps memory's tools as every request carries them, and a call of theirs is told memory is unavailable", async () => {
  const brain = app.memory.brain;
  const memOf = (/** @type {any} */ b) => (b.tools || []).filter((/** @type {any} */ t) => String(t.function?.name || "").startsWith("filament_memory_"));
  /**
   * One request whose memory fails where `where` says, for its own session alone, as a busy file would: what the upstream got.
   * @param {"situate" | "prepare"} where @param {any} body @param {string} sid
   */
  const failing = async (where, body, sid) => {
    const real = brain[where];
    let broke = false;
    brain[where] = function (/** @type {any} */ a, /** @type {any[]} */ ...rest) {
      if (a?.headers?.["x-session-id"] !== sid) return real.call(this, a, ...rest);
      broke = true;
      throw new Error(`the ${where} broke`);
    };
    const from = bodies.length;
    const r = await chat(body, { "x-session-id": sid }).finally(() => (brain[where] = real));
    assert.ok(broke, `its ${where} failed`);
    assert.equal(r.status, 200, await r.clone().text());
    return { sent: bodies.slice(from), reply: await r.json(), rec: app.usage.list(1)[0] };
  };
  const ask = (/** @type {string} */ text, model = "gpt-x") => ({ model, messages: [SYS, { role: "user", content: "remember the kestrel build" }, { role: "assistant", content: "ok" }, { role: "user", content: text }] });
  await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "remember the kestrel build" }] }, { "x-session-id": "t420" });
  const asRead = lastBody.tools;
  assert.equal(memOf(lastBody).length, 9, "a request memory reads carries its tools");
  for (const where of /** @type {const} */ (["situate", "prepare"])) {
    const t = await failing(where, ask(`and again, its ${where} failing`), "t420");
    assert.deepEqual(t.sent[0].tools, asRead, `${where}: the tools as every request of the chat carries them`);
    assert.ok((t.rec.priorChanges || []).some((/** @type {string} */ c) => /^memory: skipped \(the \w+ broke\)/.test(c)), (t.rec.priorChanges || []).join("\n"));
    assert.ok((t.rec.priorChanges || []).some((/** @type {string} */ c) => /memory's tools stay offered/.test(c)), (t.rec.priorChanges || []).join("\n"));
  }
  // The model calls one: Filament answers it in words, never runs it, and the client is handed none of it.
  const call = await failing("situate", ask('CALL filament_memory_search {"query":"kestrel"}', "gpt-call"), "t420");
  assert.equal(call.sent.length, 2, "the call answered, the upstream asked again");
  const told = call.sent[1].messages.at(-1);
  assert.equal(told.role, "tool");
  assert.match(String(told.content), /memory is unavailable for this request\./, String(told.content));
  assert.doesNotMatch(String(told.content), /situate broke/, "why memory missed it stays on the record: an error's words go to no provider");
  assert.equal(call.rec.memory?.toolRounds, 1, "the record says the round, a JSON reply's too");
  // Streamed, the same.
  const real = brain.situate;
  brain.situate = function (/** @type {any} */ a) {
    if (a?.headers?.["x-session-id"] === "t420") throw new Error("the situate broke");
    return real.call(this, a);
  };
  const from = bodies.length;
  const streamed = await chat({ ...ask('CALL filament_memory_search {"query":"kestrel"}', "gpt-call"), stream: true }, { "x-session-id": "t420" }).finally(() => (brain.situate = real));
  const text = await streamed.text();
  assert.equal(bodies.length - from, 2, "streamed: the call answered, the upstream asked again");
  assert.deepEqual(bodies[from].tools, asRead, "streamed: the tools as every request carries them");
  assert.match(String(bodies[from + 1].messages.at(-1).content), /memory is unavailable for this request/);
  assert.doesNotMatch(text, /filament_memory_search/, "streamed: the client sees no memory call");
  // A request Memory settings leave out carries none of memory's tools, read or not.
  const skipped = await failing("situate", ask("and a model memory leaves out", "gpt-skip-2"), "t420-skip");
  assert.equal(memOf(skipped.sent[0]).length, 0, "memory's settings leave it out, so no memory tool rides it");
  // Whether Memory settings leave it out could not be read either: none rides, as for a request they leave out.
  const excludedWhy = brain.excludedWhy;
  brain.excludedWhy = () => {
    throw new Error("the settings broke");
  };
  const unread = await failing("situate", ask("and its settings unread"), "t420").finally(() => (brain.excludedWhy = excludedWhy));
  assert.equal(memOf(unread.sent[0]).length, 0, "its leaving-out unknown, no memory tool rides it");
  // Its chat not known, and another chat's own settings, or another project's, choosing memory's tools: that chat may be
  // this one, so none rides.
  const offChat = await sessionOf(SYS_B, "the wren list is sorted weekly", "t420-other");
  const offProject = app.memory.archive.chainHead(offChat).project_id;
  for (const [layer, put, clear] of /** @type {const} */ ([
    ["a chat's, dotted", () => app.memory.archive.setChainSettings(offChat, { "memory.tools": false }), () => app.memory.archive.setChainSettings(offChat, null)],
    ["a project's", () => app.memory.archive.setProjectSettings(offProject, { memory: { tools: true } }), () => app.memory.archive.setProjectSettings(offProject, { memory: null })],
  ])) {
    put();
    try {
      const chosen = await failing("situate", ask(`and ${layer} settings chose memory's tools`), "t420");
      assert.equal(memOf(chosen.sent[0]).length, 0, `${layer} settings chose memory's tools, and this request's chat is not known`);
    } finally {
      clear();
    }
  }
  assert.equal(app.memory.archive.memoryToolsChosen(), false, "no layer chooses them now");
});

// (fails before: yes — the review of ca9412675: Filament's own call on a chat whose situate failed went with no
// filament_recall; one whose prepare failed in a chat with memory's tools off had filament_recall reading no chat; and a
// tick's results its reply could not carry waited for the chat's next request, never for the tick's own run)
test("Filament's own call on a chat memory could not read keeps filament_recall on that chat: it reads its record, and what its reply cannot carry waits for its own run", async () => {
  const brain = app.memory.brain;
  const chain = await sessionOf(SYS_B, "the plover gate opens at nine", "t420-tick");
  const names = (/** @type {any} */ b) => (b.tools || []).map((/** @type {any} */ t) => String(t.function?.name || t.name));
  /** A tick of a loop on the chat: Filament's own call, quiet but for the tools. @param {string} content @param {string} model @param {string} run */
  const tick = (content, model, run) =>
    fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...houseAuth(), "x-filament-memory": "tools", "x-filament-chain": chain, "x-filament-agent-of": run },
      body: JSON.stringify({ model, messages: [SYS_B, { role: "user", content }] }),
    });
  /** `run` with memory's `where` failing for this chat's requests. @param {"situate" | "prepare"} where @param {() => Promise<Response>} run */
  const failing = async (where, run) => {
    const real = brain[where];
    brain[where] = function (/** @type {any} */ a, /** @type {any[]} */ ...rest) {
      if (a?.headers?.["x-filament-chain"] !== chain) return real.call(this, a, ...rest);
      throw new Error(`the ${where} broke`);
    };
    try {
      const r = await run();
      assert.equal(r.status, 200, await r.clone().text());
      return r;
    } finally {
      brain[where] = real;
    }
  };
  await (await tick("a tick", "gpt-x", "run-1")).text();
  const asRead = names(lastBody);
  assert.ok(asRead.includes("filament_recall") && asRead.some((n) => n.startsWith("filament_memory_")), asRead.join(", "));
  // Its situate fails, and memory situates it from nothing else (an outside client's chat): the tools as ever.
  await failing("situate", () => tick("a tick, its situate failing", "gpt-x", "run-1"));
  assert.deepEqual(names(lastBody), asRead, "its situate failed");
  // Memory's tools off in the chat, its prepare failing before its turn opens: filament_recall alone, reading the chat.
  app.memory.archive.setChainSettings(chain, { memory: { tools: false } });
  try {
    await (await tick("a tick", "gpt-x", "run-2")).text();
    const offRead = names(lastBody);
    assert.deepEqual(offRead.filter((n) => n.startsWith("filament_")), ["filament_recall"], offRead.join(", "));
    const from = bodies.length;
    await failing("prepare", () => tick('CALL filament_recall {"turn":1}', "gpt-call", "run-2"));
    assert.deepEqual(names(bodies[from]), offRead, "its prepare failed");
    const told = String(bodies[from + 1]?.messages.at(-1)?.content || "");
    assert.match(told, /plover gate opens at nine/, told);
  } finally {
    app.memory.archive.setChainSettings(chain, null);
  }
  // A reply mixing memory's call with another tool on a tick whose prepare failed: its results wait for the tick's run.
  brain.deferred.delete(chain);
  await failing("prepare", () => tick("a mixed tick", "gpt-mixed", "run-3"));
  assert.ok(brain.deferred.has(`${chain}/run-3`), [...brain.deferred.keys()].join(", "));
  assert.ok(!brain.deferred.has(chain), "nothing waits for the chat's next request");
  brain.deferred.delete(`${chain}/run-3`);
});

// (fails before: yes — the review of be487d62e: only a turn the bridge held carried `confined`, so at a session's MCP
// address while the session opened, and once its turn was forgotten, the other project's session loaded for such a caller)
test("a coding agent's memory tools keep to its own project's sessions while its session opens for such a caller, and wherever no turn places the caller", async () => {
  const other = await sessionOf(SYS_B, "the plover log rotates at noon", "agent-other-opening");
  const sys = { role: "system", content: `Working directory: ${dataDir}` };
  const opens = () => (existsSync(callsFile) ? readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((c) => c.method === "session/new");
  /** A load of the other project's session at an agent session's MCP address, as the agent makes it: its answer. @param {string} url */
  const load = async (url) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "filament_memory_load", arguments: { session: other } } }) });
    return JSON.stringify(await r.json());
  };
  /** A POST from this machine, answered as `fromElsewhere`'s is. @param {string} path @param {any} body @param {Record<string, string>} [extra] */
  const fromHere = async (path, body, extra = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { ...H, ...extra }, body: JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
  };
  /**
   * A new chat's turn on the agent slow to open its session, and that session's MCP address, which a load reaches while
   * the session opens: the token stands for the turn opening it alone (`pendingMcp`) when the load is answered.
   * @param {typeof fromHere} send @param {string} sid
   */
  const whileOpening = async (send, sid) => {
    const before = opens().length;
    const turn = send("/v1/chat/completions", { model: "slow/fake-a", messages: [sys, { role: "user", content: "hello" }] }, { "x-session-id": sid });
    await until(() => opens().length > before, "its session to open");
    const url = String(opens().at(-1).mcpUrl);
    const said = await load(url);
    assert.ok(app.acp.pendingMcp.has(url.split("/").pop()), "the load was answered while the session opened");
    const r = await turn;
    assert.equal(r.status, 200, r.text);
    return { url, said };
  };
  const away = await whileOpening(fromElsewhere, "ag-opening-away");
  assert.match(away.said, /no such session in this project's memory/, away.said);
  assert.doesNotMatch(away.said, /plover log/);
  // The turn opening a session from this machine says its caller reaches every session.
  const here = await whileOpening(fromHere, "ag-opening-here");
  assert.match(here.said, /plover log rotates at noon/, here.said);
  // Turns that ended long ago are forgotten, the sessions open still: an address no turn speaks for keeps to the project.
  app.acp.sweepTurns(Date.now() + 31 * 60_000);
  for (const url of [away.url, here.url]) {
    const said = await load(url);
    assert.match(said, /no such session in this project's memory/, said);
    assert.doesNotMatch(said, /plover log/);
  }
});

// (fails before: no — a guard the review of b1f4c556b asked for: a sub-agent runs on house calls, which read every
// session, so one launched for a caller that could not would read them all; an outside client's agent launches none)
test("a coding agent's turn for a caller that could not read every session launches no sub-agent: Filament's agent tool refuses it, and /subagent is the model's words", async () => {
  const sys = { role: "system", content: `Working directory: ${dataDir}` };
  const launch = { model: "agent/fake-a", messages: [sys, { role: "user", content: `~mcpcall agent {"description":"Read the other project","prompt":"Load another project's session"}` }] };
  const r = await fromElsewhere("/v1/chat/completions", launch, { "x-session-id": "ag-launch" });
  assert.equal(r.status, 200, r.text);
  assert.match(String(JSON.parse(r.text).choices[0].message.content), /mcp:error:Not run: this session's agent leads no team\./);
  const typed = await fromElsewhere("/v1/chat/completions", { model: "agent/fake-a", messages: [sys, { role: "user", content: "/subagent Load another project's session" }] }, { "x-session-id": "ag-launch-typed" });
  assert.equal(typed.status, 200, typed.text);
  assert.match(String(JSON.parse(typed.text).choices[0].message.content), /echo\(1\): \/subagent Load another project's session$/, "the agent heard it as words: no launch of Filament's");
});

// (fails before: yes — `/mcp/memory` reached every session for any caller with an inbound key)
test("/mcp/memory, for a caller that could not read every session, keeps to the sessions of the project it stands in", async () => {
  const other = await sessionOf(SYS_B, "the kestrel index rebuilds weekly", "mcp-other");
  const load = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "load", arguments: { session: other, cwd: "C:\\demo" } } };
  const away = await fromElsewhere("/mcp/memory", load);
  assert.equal(away.status, 200, away.text);
  const said = JSON.parse(away.text).result;
  assert.deepEqual([said.isError, said.content.at(-1).text], [true, JSON.stringify({ error: "no such session in this project's memory" })], away.text);
  const r = await fetch(`http://127.0.0.1:${port}/mcp/memory`, { method: "POST", headers: H, body: JSON.stringify(load) });
  assert.match(JSON.stringify(await r.json()), /kestrel index rebuilds weekly/, "on this machine it loads");
  // A brief for a task the other project's words match: none of them, for that caller.
  const brief = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "brief", arguments: { task: "rebuild the kestrel index", cwd: "C:\\demo" } } };
  const briefed = await fromElsewhere("/mcp/memory", brief);
  assert.equal(briefed.status, 200, briefed.text);
  assert.doesNotMatch(briefed.text, /rebuilds weekly/, briefed.text.slice(0, 400));
  const local = await fetch(`http://127.0.0.1:${port}/mcp/memory`, { method: "POST", headers: H, body: JSON.stringify(brief) });
  assert.match(JSON.stringify(await local.json()), /rebuilds weekly/, "on this machine it is matched");
});

test("a coding agent gets Filament's MCP server with the memory tools (not the hands) even with its own tools on", async () => {
  const r = await chat({ model: "agent/fake-a", messages: [{ role: "system", content: `Working directory: ${dataDir}` }, { role: "user", content: "hello agent" }] });
  assert.equal(r.status, 200); const p = prompts().at(-1); assert.equal(p.mcp, 1, "Filament's MCP server passed to session/new"); assert.ok(p.mcpUrl?.includes("/mcp/"), p.mcpUrl); assert.equal(p.disableBuiltIn, false);
  const list = await (await fetch(p.mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json();
  const names = list.result.tools.map((t) => t.name); assert.ok(names.includes("filament_memory_search") && names.includes("filament_memory_load")); assert.ok(!names.includes("Read"), "hands only for the native toolset");
  const call = await (await fetch(p.mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "filament_memory_search", arguments: { query: "tabs" } } }) })).json();
  assert.ok(call.result.content[0].text.includes("TypeScript with tabs"));
  const rec = app.usage.list(1)[0]; assert.ok(rec.memory?.chain, "the agent turn is archived");
});

test("a coding agent's turn carries what memory placed for it, outside the person's words, and its record says what (HarnessV3-ACP AC4-2)", async () => {
  const r = await chat({ model: "agent/fake-a", messages: [{ role: "system", content: `Working directory: ${dataDir}` }, { role: "user", content: "do we indent with tabs in TypeScript?" }] }, { "x-session-id": "ac4-memory" });
  assert.equal(r.status, 200);
  const p = prompts().at(-1);
  assert.match(p.prompt, /<filament-memory kind="[^"]+">/, p.prompt.slice(0, 400));
  assert.equal(p.text, "do we indent with tabs in TypeScript?", "the person's words stand apart from memory's blocks");
  const rec = app.usage.list(1)[0];
  assert.ok(rec.acp?.given && rec.acp.given.tokens > 0, JSON.stringify(rec.acp?.given));
  assert.ok(rec.changes.some((c) => /^acp: Filament's context — /.test(c)), rec.changes.join(" | "));
});

// (fails before: no — a guard the mutation pass asked for: no agent's tool leg came back with memory's autopilot on)
test("what answers a coding agent's question to the client, a tool leg, is archived only: memory places nothing on it (HarnessV3-ACP AC4-2)", async () => {
  const ASK = [{ type: "function", function: { name: "AskUserQuestion", parameters: { type: "object", properties: { questions: { type: "array" } } } } }];
  const first = [{ role: "system", content: `Working directory: ${dataDir}` }, { role: "user", content: "need perm to indent the TypeScript with tabs" }];
  const r1 = await chat({ model: "ask/fake-a", tools: ASK, messages: first }, { "x-session-id": "ac4-leg" });
  const j1 = await r1.json();
  assert.equal(j1.choices[0].finish_reason, "tool_calls", JSON.stringify(j1).slice(0, 300));
  const asked = app.usage.list(1)[0];
  const call = j1.choices[0].message.tool_calls[0];
  const r2 = await chat({ model: "ask/fake-a", tools: ASK, messages: [...first, { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: "Allow" }] }, { "x-session-id": "ac4-leg" });
  assert.match((await r2.json()).choices[0].message.content, /permission:allow/);
  const leg = app.usage.list(1)[0];
  assert.deepEqual([asked.memory.position, asked.memory.tools, asked.memory.briefing > 0], ["first", true, true], "the person's leg: memory's whole pass");
  assert.deepEqual([leg.memory.position, leg.memory.tools, leg.memory.briefing, leg.memory.injected], ["toolLeg", false, 0, 0]);
});

test("dashboard endpoints: status, sessions, recall, remember reaches the engine, items, activity; mutating calls need JSON", async () => {
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const saved = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: H, body: JSON.stringify(state.config) }); assert.equal(saved.status, 200, await saved.text());
  const st = await (await fetch(`http://127.0.0.1:${port}/api/memory/status?probe=1`)).json(); assert.equal(st.enabled, true); assert.equal(st.engine.version, "fake-3.15.1"); assert.equal(st.engine.state, "ready"); assert.ok(st.archive.chains >= 3);
  const ss = await (await fetch(`http://127.0.0.1:${port}/api/memory/sessions?q=format`)).json(); assert.ok(ss.sessions.length >= 1); const one = await (await fetch(`http://127.0.0.1:${port}/api/memory/sessions/${ss.sessions[0].id}?view=chat`)).json(); assert.ok(one.turns.length >= 1); assert.ok(one.rendered.text.includes("format"));
  // An untitled row carries its first user text as `preview` (the sidebar's label until a title exists); a titled row carries none.
  const untitled = ss.sessions.find((s) => !s.title); if (untitled) assert.ok(typeof untitled.preview === "string" && untitled.preview.length > 0, JSON.stringify(untitled));
  const titled = ss.sessions.find((s) => s.title); if (titled) assert.equal(titled.preview, null);
  const rc = await (await fetch(`http://127.0.0.1:${port}/api/memory/recall`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "tabs", limit: 3 }) })).json(); const tabs = rc.results.find((x) => /tabs/.test(x.text)); assert.match(String(tabs?.id), /^i\d+$/, "an engine row no item stood behind answers as the claim adopted for it (M2-3)"); assert.equal(tabs.trust, "imported");
  const rm = await (await fetch(`http://127.0.0.1:${port}/api/memory/remember`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "dashboard note about deploys", kind: "fact" }) })).json(); assert.match(String(rm.id), /^i\d+$/, JSON.stringify(rm)); assert.equal(rm.id, `i${rm.itemId}`);
  // The engine's copy goes by the outbox, off the request path (M2-2): the test waits for it to land, not for the reply.
  await until(() => ops().some((o) => o.op === "remember" && o.args.content === "dashboard note about deploys" && o.args.metadata?.kind === "fact"), "the engine to receive the remember");
  const items = await (await fetch(`http://127.0.0.1:${port}/api/memory/items`)).json(); assert.ok(items.items.length >= 1);
  // A claim's history (M2-4), by the dashboard's number or by the id a line shows; the owner's remember is the first event.
  const hist = await (await fetch(`http://127.0.0.1:${port}/api/memory/items/${rm.itemId}/history`)).json();
  assert.equal(hist.id, rm.id); assert.deepEqual(hist.events.map((e) => [e.action, e.by]), [["created", "owner"]]);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/memory/items/${rm.id}/history`)).json()).text, "dashboard note about deploys");
  const none = await fetch(`http://127.0.0.1:${port}/api/memory/items/999999/history`); assert.equal(none.status, 404); assert.match((await none.json()).error, /no memory i999999/);
  const filed = await (await fetch(`http://127.0.0.1:${port}/api/memory/remember`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "the pq project deploys on fridays", project: "pq" }) })).json();
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/memory/items/${filed.itemId}/history`)).json()).project, "pq", "filed in the project the dashboard named");
  // Searched once the engine holds it, as the first: its copy goes by the outbox.
  await until(() => ops().some((o) => o.op === "remember" && o.args.content === "the pq project deploys on fridays"), "the engine to receive the project's remember");
  const scoreOf = async (body) => (await (await fetch(`http://127.0.0.1:${port}/api/memory/recall`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()).results.find((x) => x.id === filed.id)?.score;
  const everywhere = await scoreOf({ query: "pq project deploys fridays" });
  const inPq = await scoreOf({ query: "pq project deploys fridays", project: "pq" });
  assert.ok(inPq > everywhere, `a search in the project ranks its own claims first (${inPq} vs ${everywhere})`);
  const act = await (await fetch(`http://127.0.0.1:${port}/api/memory/activity`)).json(); assert.ok(act.activity.length >= 1); assert.ok(!JSON.stringify(act).includes("TypeScript with tabs"));
  const bad = await fetch(`http://127.0.0.1:${port}/api/memory/remember`, { method: "POST", headers: { "content-type": "text/plain", origin: "http://evil.example" }, body: "x" }); assert.ok(bad.status >= 400);
});

// (fails before: yes — the bug hunt of 10-30, a Low: a negative limit reached SQLite as a LIMIT of none, and every item
// came back)
test("the items list gives at least one and no more than it is asked: a negative limit is not every item", async () => {
  for (const text of ["the build runs on the night shift", "the night shift reads the build's log"])
    await fetch(`http://127.0.0.1:${port}/api/memory/remember`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, kind: "fact" }) });
  const count = async (/** @type {string} */ limit) => (await (await fetch(`http://127.0.0.1:${port}/api/memory/items?limit=${limit}`)).json()).items.length;
  const all = await count("1000");
  assert.ok(all >= 2, "two items at least, so a cap shows");
  assert.equal(await count("-1"), 1);
  assert.equal(await count("1"), 1);
  assert.equal(await count("0"), Math.min(all, 200), "none named: the 200 it gives by default, as before");
});

// HarnessV3-AtHome AH-D1: memory is on for everyone, so Filament's own line in front of a reply must never land where it
// means nothing or breaks something. (fails before: yes — the first reply of every session carried it: an app's with no
// folder, where "earlier sessions here" has no here, and a JSON reply's, which then no longer parses)
test("the cue goes in front of a reply only where the request works in a folder and asked for no structured reply; its data rides the record either way", async () => {
  const ask = async (messages, sessionId, extra = {}) => {
    const r = await chat({ model: "gpt-x", messages, ...extra }, { "x-session-id": sessionId });
    assert.equal(r.status, 200);
    return { text: (await r.json()).choices[0].message.content, rec: app.usage.list(1)[0] };
  };
  // A question memory has for the user, asked everywhere: what an app's request would have been cued with.
  const asked = app.memory.archive.inbox.add({ projectId: null, kind: "retire", key: "test:cue-everywhere", proposal: { action: "retire" }, reason: "a question for the cue test" });
  try {
    const fromApp = await ask([{ role: "user", content: "how do I like my code formatted, an app asks" }], "conv-app");
    assert.equal(fromApp.text, "ok", "no folder: nothing in front of the reply");
    assert.equal(fromApp.rec.memory.cue?.questions, 1, "the cue's data still rides the record");
    assert.deepEqual(fromApp.rec.memory.cue.sessions, [], "and names no session: a request in no folder has no project to share one with");
    assert.notEqual(fromApp.rec.memory.cuePlaced, true);
  } finally {
    app.memory.archive.inbox.decide(asked.id, { status: "withdrawn", by: "test" });
  }
  const json = await ask([SYS, { role: "user", content: "how do I like my code formatted, as JSON" }], "conv-json", { response_format: { type: "json_object" } });
  assert.equal(json.text, "ok", "a structured reply: nothing in front of it");
  const folder = await ask([SYS, { role: "user", content: "how do I like my code formatted, in the folder" }], "conv-folder");
  assert.ok(folder.text.startsWith("Memory: ") && folder.text.endsWith("\n\nok"), folder.text);
  assert.equal(folder.rec.memory.cuePlaced, true);
  // Every shape a structured reply is asked for: Chat Completions, the Responses API (its own body too), Anthropic.
  const structured = /** @type {any} */ (memoryLoop).asksForStructuredReply;
  for (const body of [{ response_format: { type: "json_object" } }, { response_format: { type: "json_schema", json_schema: { name: "x", schema: {} } } }, { text: { format: { type: "json_schema" } } }, { output_config: { format: { type: "json_schema", schema: {} } } }])
    assert.equal(structured(body), true, JSON.stringify(body));
  for (const body of [{}, { response_format: { type: "text" } }, { text: { format: { type: "text" } } }]) assert.equal(structured(body), false, JSON.stringify(body));
  assert.equal(structured({}, { text: { format: { type: "json_object" } } }), true, "a Responses client's own body");
});

// HarnessV3-AtHome AH-D1. (fails before: yes — a request in no folder was briefed with "Recent sessions in this project":
// every other folderless conversation, an app's and a chat's alike, under a project there is none of)
test("a request in no folder has no project: its briefing names no session as its project's; a folder's still does", async () => {
  const systemOf = () => String(lastBody.messages[0]?.role === "system" ? lastBody.messages[0].content : "");
  await (await chat({ model: "gpt-x", messages: [{ role: "user", content: "what time zone do I work in, another app asks" }] }, { "x-session-id": "conv-app-2" })).json();
  assert.ok(systemOf().includes('<filament-memory kind="briefing">'), "briefed all the same: what memory knows of the user rides");
  assert.ok(!systemOf().includes("Recent sessions in this project"), systemOf());
  await (await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "what time zone do I work in, in the folder" }] }, { "x-session-id": "conv-folder-2" })).json();
  assert.ok(systemOf().includes("Recent sessions in this project"), systemOf());
});

// HarnessV4_Tasks U4's closing, V4-D208. (fails before: no — the briefing says "untitled"; this keeps it so: named by
// its first words, an earlier session said again a rule the user had retired, and a fact's value they had corrected)
test("the briefing names an earlier session with no title untitled, never by its first words", async () => {
  const systemOf = () => String(lastBody.messages[0]?.role === "system" ? lastBody.messages[0].content : "");
  await (await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "rename the billing tables, in the folder" }] }, { "x-session-id": "conv-folder-3" })).json();
  await (await chat({ model: "gpt-x", messages: [SYS, { role: "user", content: "and now something else, in the folder" }] }, { "x-session-id": "conv-folder-4" })).json();
  // The sessions' lines alone: the quotes block after them has its own rule for what it quotes.
  const recent = systemOf().slice(systemOf().indexOf("Recent sessions in this project")).split(/\n(?!- session )/)[0];
  assert.match(recent, /- session \S+ untitled — /, recent);
  assert.ok(!recent.includes("rename the billing tables"), `an untitled session's first words are not served: ${recent}`);
});

// HarnessV3-FixRound decision 30. (fails before: yes — a session's day was its UTC date, and the sidebar reads a
// date-only stamp as a calendar day where the developer is: east of UTC, a session touched after midnight read
// "yesterday" and sat under Yesterday until the UTC date turned)
test("a session's day in the sessions list is the machine's own calendar day, not the UTC date", () => {
  const brain = new URL("../src/services/memory/brain.js", import.meta.url).href;
  // 22:40 UTC on 1 October is 03:40 on 2 October in Karachi (UTC+5, no daylight saving).
  const script = `import { MemoryBrain } from ${JSON.stringify(brain)};
    const at = Date.UTC(2026, 9, 1, 22, 40);
    const archive = { listChains: () => [{ id: "c1", title: "t", started_at: at, last_at: at, turns: 1, meta: {}, state: {} }], items: {} };
    const [row] = new MemoryBrain({ archive }).sessions(null, { limit: 5 });
    process.stdout.write(JSON.stringify([row.when, row.created]));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: "Asia/Karachi" }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), ["2026-10-02", "2026-10-02"]);
});
