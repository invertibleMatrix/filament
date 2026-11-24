import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig, loadConfig } from "../src/config.js";
import { buildSystemPrompt, TOOLS, Assistant } from "../src/assistant.js";
import { seal } from "../src/secrets.js";
import { startApp } from "./helpers/app.js";

// A scripted "model": the fake upstream reads the conversation and replies with tool calls, then a summary.
let fake, app, port, dataDir, seen = [];
before(async () => {
  fake = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    if (req.method !== "POST") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: [{ id: "claude-opus-5" }] })); }
    const body = JSON.parse(b); seen.push(body);
    const last = body.messages.at(-1);
    const reply = (content, stop) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "msg_x", type: "message", role: "assistant", model: "claude-opus-5", content, stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } })); };
    const userText = typeof last.content === "string" ? last.content : Array.isArray(last.content) ? last.content.filter((b) => b.type === "text").map((b) => b.text).join("") : "";
    if (userText.includes("effort")) return reply([{ type: "text", text: "Let me look at the current rules." }, { type: "tool_use", id: "t1", name: "get_config", input: { section: "rules" } }], "tool_use");
    if (userText.includes("how do prompt caches")) return reply([{ type: "tool_use", id: "d1", name: "search_docs", input: { query: "prompt cache blocks" } }], "tool_use");
    if (Array.isArray(last.content) && last.content[0]?.tool_use_id === "d1") return reply([{ type: "tool_use", id: "d2", name: "read_docs", input: { doc: "memory-guide.md", heading: "5.6 Earlier blocks re-attached" } }], "tool_use");
    if (Array.isArray(last.content) && last.content[0]?.tool_use_id === "d2") return reply([{ type: "text", text: "Blocks are re-attached byte for byte from an uncapped table, so the provider's prompt cache survives every resend. Press nothing — that is just how it works." }], "end_turn");
    if (userText.includes("show my usage")) return reply([{ type: "tool_use", id: "u1", name: "get_usage", input: { hours: 24 } }, { type: "tool_use", id: "u2", name: "get_alerts", input: {} }, { type: "tool_use", id: "u3", name: "get_memory_status", input: {} }, { type: "tool_use", id: "u4", name: "open_page", input: { page: "usage", why: "see the 30-day chart" } }], "tool_use");
    if (Array.isArray(last.content) && last.content.some((b) => b.tool_use_id === "u4")) return reply([{ type: "text", text: "Your 24 hours: a few requests, no errors, no alerts; memory is off. I opened Usage for the chart." }], "end_turn");
    if (Array.isArray(last.content) && last.content[0]?.tool_use_id === "t1") return reply([{ type: "tool_use", id: "t2", name: "set_config_value", input: { path: "rules.effort.default", value: "max" } }, { type: "tool_use", id: "t3", name: "add_route", input: { route: { match: "glm-*", upstream: "model", upstreamModel: "{model}" } } }], "tool_use");
    if (Array.isArray(last.content) && last.content[0]?.tool_use_id === "t2") return reply([{ type: "tool_use", id: "t4", name: "validate", input: {} }], "tool_use");
    if (Array.isArray(last.content) && last.content[0]?.tool_use_id === "t4") return reply([{ type: "text", text: "Done: default effort is now max and glm-* routes to the model upstream. Press Apply to save these changes." }], "end_turn");
    if (userText.includes("rename b")) return reply([{ type: "tool_use", id: "r1", name: "set_config_value", input: { path: "upstream:b.id", value: "c" } }], "tool_use");
    if (Array.isArray(last.content) && last.content[0]?.tool_use_id === "r1") return reply([{ type: "text", text: "It cannot be renamed yet." }], "end_turn");
    if (userText.includes("my upstreams")) return reply([{ type: "tool_use", id: "g1", name: "get_config", input: { section: "upstreams" } }], "tool_use");
    if (Array.isArray(last.content) && last.content[0]?.tool_use_id === "g1") return reply([{ type: "text", text: "One upstream, its key set." }], "end_turn");
    return reply([{ type: "text", text: "Hello! I can help configure Filament." }], "end_turn");
  }); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-asst-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "model", name: "m", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: "s" }];
  cfg.routes = [{ match: "claude-*", upstream: "model", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); fake.close(); rmSync(dataDir, { recursive: true, force: true }); });

test("system prompt carries the parameter reference, templates, config and models", async () => {
  const p = buildSystemPrompt({ cfg: app.config, models: [{ id: "claude-opus-5", upstream: "model", upstreamModel: "claude-opus-5" }], dataDir });
  assert.ok(p.includes("rules.effort.default") && p.includes("cursor-via-acp") && p.includes("claude-opus-5 -> model") && p.includes("Press Apply"));
  assert.ok(TOOLS.some((t) => t.name === "set_config_value") && TOOLS.every((t) => t.input_schema?.type === "object"));
});

test("a chat turn runs the tool loop against a draft, streams events, and Apply saves the result", async () => {
  // Discovered lists are served from disk (the owner's rule): press the dashboard's Refresh once, as he would.
  await fetch(`http://127.0.0.1:${port}/api/models?refresh=1`);
  const ml = await (await fetch(`http://127.0.0.1:${port}/api/assistant/models`)).json();
  assert.ok(ml.models.some((m) => m.id === "claude-opus-5"));
  const r = await fetch(`http://127.0.0.1:${port}/api/assistant/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "set default effort to max and route glm to my model", model: "claude-opus-5" }) });
  assert.equal(r.status, 200);
  const events = (await r.text()).split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5)));
  const sessionId = events.find((e) => e.type === "session").sessionId;
  assert.deepEqual(events.filter((e) => e.type === "tool").map((e) => e.name), ["get_config", "set_config_value", "add_route", "validate"], JSON.stringify(events).slice(0, 1500));
  assert.ok(events.filter((e) => e.type === "tool_result").every((e) => e.ok), JSON.stringify(events.filter((e) => e.type === "tool_result")));
  const done = events.find((e) => e.type === "done");
  assert.equal(done.valid, true);
  assert.ok(done.pendingChanges.some((c) => c.path === "rules.effort.default" && c.to === "max"), JSON.stringify(done.pendingChanges));
  assert.ok(done.pendingChanges.some((c) => c.path.startsWith("routes")));
  assert.ok(events.some((e) => e.type === "text" && e.text.includes("Press Apply")));
  // the model was called through Filament's own front door with the tools attached
  assert.ok(seen.every((b) => Array.isArray(b.tools) && b.tools.some((t) => t.name === "set_config_value") && (typeof b.system === "string" || Array.isArray(b.system))), "model called through Filament with tools + system");
  // nothing saved yet
  assert.equal(loadConfig(dataDir).config.rules.effort.default, "none");
  const s = await (await fetch(`http://127.0.0.1:${port}/api/assistant/session?id=${sessionId}`)).json();
  assert.equal(s.pendingChanges.length, done.pendingChanges.length); assert.ok(s.transcript.some((t) => t.role === "tool" && t.name === "set_config_value"));
  const a = await (await fetch(`http://127.0.0.1:${port}/api/assistant/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) })).json();
  assert.equal(a.ok, true); assert.ok(a.changes.length >= 2);
  const saved = loadConfig(dataDir).config;
  assert.equal(saved.rules.effort.default, "max"); assert.ok(saved.routes.some((x) => x.match === "glm-*"));
  const s2 = await (await fetch(`http://127.0.0.1:${port}/api/assistant/session?id=${sessionId}`)).json();
  assert.equal(s2.pendingChanges.length, 0);
});

test("knowledge and dashboard tools: docs search, usage, alerts, memory state, page navigation", async () => {
  assert.ok(TOOLS.some((t) => t.name === "search_docs") && TOOLS.some((t) => t.name === "open_page"), "the new tools are advertised");
  const p = buildSystemPrompt({ cfg: app.config, models: [], dataDir });
  assert.ok(p.includes("search_docs") && p.includes("memory.autopilot") && p.includes("The memory system"), "the prompt teaches docs + memory");
  const r = await fetch(`http://127.0.0.1:${port}/api/assistant/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "how do prompt caches survive resends?", model: "claude-opus-5" }) });
  const events = (await r.text()).split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5)));
  assert.deepEqual(events.filter((e) => e.type === "tool").map((e) => e.name), ["search_docs", "read_docs"], JSON.stringify(events).slice(0, 800));
  const sr = events.filter((e) => e.type === "tool_result");
  assert.ok(sr[0].ok && sr[0].summary.includes("memory-guide.md"), `search_docs found the guide: ${sr[0]?.summary?.slice(0, 200)}`);
  assert.ok(sr[1].ok && /uncapped|byte/.test(sr[1].summary), `read_docs returned the section: ${sr[1]?.summary?.slice(0, 200)}`);
  assert.ok(events.some((e) => e.type === "text" && /byte for byte|prompt cache/i.test(e.text)));
  const r2 = await fetch(`http://127.0.0.1:${port}/api/assistant/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "show my usage and open the page", model: "claude-opus-5" }) });
  const ev2 = (await r2.text()).split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5)));
  assert.deepEqual(ev2.filter((e) => e.type === "tool").map((e) => e.name), ["get_usage", "get_alerts", "get_memory_status", "open_page"], JSON.stringify(ev2).slice(0, 800));
  assert.ok(ev2.filter((e) => e.type === "tool_result").every((e) => e.ok), JSON.stringify(ev2.filter((e) => e.type === "tool_result")));
  assert.ok(ev2.some((e) => e.type === "text" && /opened Usage/i.test(e.text)));
});

test("discard drops the draft; a bad path is reported as a tool error, not a crash", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/assistant/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi", model: "claude-opus-5" }) });
  const events = (await r.text()).split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5)));
  const sid = events.find((e) => e.type === "session").sessionId;
  assert.ok(events.some((e) => e.type === "text" && e.text.startsWith("Hello")));
  const d = await (await fetch(`http://127.0.0.1:${port}/api/assistant/discard`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sid }) })).json();
  assert.equal(d.ok, true);
  const after = await (await fetch(`http://127.0.0.1:${port}/api/assistant/session?id=${sid}`)).json();
  assert.equal(after.pendingChanges.length, 0, "the draft is gone"); assert.ok(after.transcript.some((t) => t.role === "system" && /discard/i.test(t.text)));
});

/** A chat's events, as the console reads its stream. @param {string} message */
const chat = async (message) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/assistant/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, model: "claude-opus-5" }) });
  return (await r.text()).split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5)));
};

// (fails before: yes — the bug hunt of 10-30, SEC-4: the assistant's view of the configuration carried each key's first
// and last four characters, so eight characters of every key went into a model's prompt)
test("the assistant's view of the configuration says which keys are set and carries no part of one: its prompt and get_config", async () => {
  const cfg = structuredClone(app.config);
  cfg.upstreams = [{ ...cfg.upstreams[0], apiKey: "sk-ant-api03-Qz9W" }, { id: "q", type: "qoder", apiKey: "", qoder: { accessToken: "dt-Vb7K-0000-Vb7K", refreshToken: "rt-Jm4P-0000-Jm4P" } }];
  cfg.server = { ...cfg.server, inboundKeys: ["sk-filament-Hx3T-Hx3T"] };
  const p = buildSystemPrompt({ cfg, models: [], dataDir });
  assert.ok(p.includes('"apiKey": "__SECRET__"'), "a key set says so");
  for (const part of ["Masked", "Qz9W", "Vb7K", "Jm4P", "Hx3T"]) assert.ok(!p.includes(part), part);
  const events = await chat("list my upstreams");
  const got = events.find((e) => e.type === "tool_result");
  assert.ok(got?.ok && got.summary.includes("__SECRET__"), JSON.stringify(got));
  assert.ok(!got.summary.includes("Masked"), got.summary);
});

// (fails before: yes — the bug hunt of 10-30: the assistant's draft renamed a provider whose key this secret.key cannot
// open, and Apply let the sealed key go, the file keeping it only under the id it had)
test("the assistant's draft refuses, in words, to rename a provider holding a secret this secret.key cannot open; another it renames", async () => {
  const cfg = defaultConfig();
  cfg.upstreams = [{ id: "a", type: "anthropic", baseUrl: "https://a.example", apiKey: "sk-a" }, { id: "b", type: "anthropic", baseUrl: "https://b.example", apiKey: "" }];
  const a = new Assistant({ getConfig: () => cfg, describeDiff: () => [], dataDir, unreadable: () => ["upstreams.b.apiKey"] });
  const s = a.session(undefined);
  await assert.rejects(a.runTool(s, "set_config_value", { path: "upstream:b.id", value: "c" }), {
    message: 'Not renamed: upstreams.b.apiKey cannot be read (sealed with another secret.key), so it cannot move with "b" to a new id. Put back the secret.key it was sealed with and restart Filament, or have the person set the value again on the Upstreams page, then rename it.',
  });
  assert.deepEqual(s.draft.upstreams.map((/** @type {any} */ u) => u.id), ["a", "b"], "the draft as it was");
  assert.equal((await a.runTool(s, "set_config_value", { path: "upstream:a.id", value: "a2" })).after, "a2");
  assert.deepEqual(s.draft.upstreams.map((/** @type {any} */ u) => u.id), ["a2", "b"]);
});

// (fails before: yes — the bug hunt of 10-30: a "__SECRET__" the assistant copied from its view into a write stood in its
// draft as text, which Apply saved; and the write's answer gave back the place's stored secret as `before`)
test("a placeholder the assistant writes is the secret stored at its place, never text; one that stands for nothing is refused, the draft as it was", async () => {
  const cfg = defaultConfig();
  cfg.upstreams = [{ id: "p", type: "openai-compatible", baseUrl: "https://p.example/v1", apiKey: "sk-p", headers: { Authorization: "Bearer hdr-secret", "X-Team": "red" } }];
  const a = new Assistant({ getConfig: () => cfg, describeDiff: () => [], dataDir });
  const s = a.session(undefined);
  const view = (await a.runTool(s, "get_config", { section: "upstreams" })).upstreams[0].headers;
  assert.deepEqual(view, { Authorization: "__SECRET__", "X-Team": "red" });
  const set = await a.runTool(s, "set_config_value", { path: "upstream:p.headers", value: { ...view, "X-Team": "blue" } });
  assert.deepEqual(s.draft.upstreams[0].headers, { Authorization: "Bearer hdr-secret", "X-Team": "blue" });
  assert.deepEqual(a.applied(s).upstreams[0].headers, { Authorization: "Bearer hdr-secret", "X-Team": "blue" }, "what Apply writes");
  assert.deepEqual(set.before, { Authorization: "__SECRET__", "X-Team": "red" }, "what stood there, as its view shows it");
  await assert.rejects(a.runTool(s, "set_config_value", { path: "upstream:p.headers", value: { "X-Auth": "__SECRET__" } }), {
    message: "Not changed: __SECRET__ stands for a secret Filament keeps, and none is kept at upstreams.p.headers.X-Auth. Write no placeholder there: leave a stored secret where it is, and have the person set a new one on the Upstreams page.",
  });
  assert.deepEqual(s.draft.upstreams[0].headers, { Authorization: "Bearer hdr-secret", "X-Team": "blue" }, "the draft as it was");
  await assert.rejects(a.runTool(s, "add_upstream", { upstream: { id: "n", type: "anthropic", baseUrl: "https://n.example", apiKey: "__SECRET__" } }), { message: /none is kept at upstreams\.n\.apiKey\./ });
  assert.deepEqual(s.draft.upstreams.map((/** @type {any} */ u) => u.id), ["p"]);
});

// (fails before: yes — the running Filament's assistant was never told what its secret.key cannot open)
test("in a running Filament, the chat's rename of a provider whose key this secret.key cannot open is refused, and the key stays sealed on disk", async () => {
  const other = randomBytes(32);
  const sealedB = seal("sk-b-sealed-elsewhere", other);
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "model", name: "m", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: "s" }, { id: "b", type: "anthropic", baseUrl: "https://b.example", apiKey: sealedB });
    c.routes.push({ match: "claude-*", upstream: "model", upstreamModel: "{model}" });
  } });
  try {
    const r = await shim.api("/api/assistant/chat", { method: "POST", body: { message: "please rename b to c", model: "claude-opus-5" } });
    const events = (await r.text()).split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(5)));
    const got = events.find((e) => e.type === "tool_result");
    assert.equal(got?.ok, false, JSON.stringify(got));
    assert.match(got.summary, /Not renamed: upstreams\.b\.apiKey cannot be read \(sealed with another secret\.key\)/);
    const sessionId = events.find((e) => e.type === "session").sessionId;
    assert.equal((await (await shim.api("/api/assistant/apply", { method: "POST", body: { sessionId } })).json()).ok, true);
    assert.equal(JSON.parse(readFileSync(join(shim.dataDir, "config.json"), "utf8")).upstreams.find((/** @type {any} */ u) => u.id === "b").apiKey, sealedB);
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — the bug hunt of 10-30, SEC-5: Apply wrote the chat's draft whole, its secrets as they stood when
// the chat began, so a key pasted or an inbound key made while it ran was undone)
test("Apply keeps each secret the draft never changed as it stands: a key pasted and an inbound key made while the chat ran", async () => {
  const base = `http://127.0.0.1:${port}/api`;
  const J = { "content-type": "application/json" };
  const sessionId = (await chat("hi")).find((e) => e.type === "session").sessionId;
  const st = await (await fetch(`${base}/state`)).json();
  st.config.upstreams.find((u) => u.id === "model").apiKey = "s-pasted-meanwhile";
  assert.equal((await fetch(`${base}/config`, { method: "PUT", headers: J, body: JSON.stringify(st.config) })).status, 200);
  const { key } = await (await fetch(`${base}/keys/rotate`, { method: "POST" })).json();
  const { pendingChanges } = await (await fetch(`${base}/assistant/session?id=${sessionId}`)).json();
  assert.deepEqual(pendingChanges.filter((c) => /apiKey|inboundKeys/.test(c.path)), [], "no secret is the draft's to change");
  const a = await (await fetch(`${base}/assistant/apply`, { method: "POST", headers: J, body: JSON.stringify({ sessionId }) })).json();
  assert.equal(a.ok, true);
  const saved = loadConfig(dataDir).config;
  assert.equal(saved.upstreams.find((u) => u.id === "model").apiKey, "s-pasted-meanwhile");
  assert.deepEqual(saved.server.inboundKeys, [key, "k"]);
});
