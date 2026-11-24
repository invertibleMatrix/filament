// A client's own compaction (HarnessV3-Compaction §7.3; the owner's rule of 10-31: an outside client gets a plain
// proxy plus memory): its compaction request goes to its own model as it sent it, whatever its session chose, and
// memory archives the summary that model writes. Through a real Filament with a fake upstream.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_SIDECAR = join(here, "fixtures", "fake-sidecar.mjs");

/** `n` turns, each a question, a tool call with a big result, and a short answer: what a fold shrinks. */
const toolConvo = (n, tag = "the lantern") => {
  /** @type {any[]} */
  const m = [];
  for (let i = 1; i <= n; i++) {
    m.push({ role: "user", content: `ask ${i} ${tag}: read file${i}.js` });
    m.push({ role: "assistant", content: [{ type: "text", text: `Reading file${i}.js for ${tag}.` }, { type: "tool_use", id: `t${i}`, name: "read", input: { path: `file${i}.js` } }] });
    m.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `contents of file${i}.js (${tag}) ` + "const x = 1;\n".repeat(300) }] });
    m.push({ role: "assistant", content: `Done with file${i}.js (${tag}): answer ${i}.` });
  }
  return m;
};

let up, app, port, dataDir, seen;
const sysOf = (/** @type {any} */ b) => (typeof b.system === "string" ? b.system : JSON.stringify(b.system || ""));
const isSliceCall = (/** @type {any} */ b) => /compress one part of a long conversation/.test(sysOf(b));
before(async () => {
  seen = [];
  up = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const body = JSON.parse(b || "{}"); seen.push(body);
    if (JSON.stringify(body.messages?.at(-1) ?? "").includes("the request that fails")) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "refused by the test upstream" } })); }
    // A summary of a sound length: under the floor (rules.trim.minSummaryPercent) a slice is retried smaller.
    const text = isSliceCall(body) ? `SUMMARY: the work on ${body.model}, condensed. ${"Every decision, file and result kept. ".repeat(24)}` : "EXPENSIVE MODEL ANSWER";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } }));
  }); });
  await new Promise((r) => up.listen(0, "127.0.0.1", () => r(null)));
  dataDir = mkdtempSync(join(tmpdir(), "filament-client-compaction-"));
  const stateFile = join(dataDir, "fake-engine-state.json"); writeFileSync(stateFile, JSON.stringify({ memories: [], canonical: [], seq: 1 }));
  process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: process.execPath, args: [FAKE_SIDECAR], env: { FAKE_SIDECAR_STATE: stateFile } });
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "u", name: "u", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${/** @type {any} */ (up.address()).port}`, apiKey: "s", pricing: { "cheap-1": { input: 1, output: 1, contextTokens: 64000 }, "cheap-small": { input: 1, output: 1, contextTokens: 8000 }, "big-1": { input: 10, output: 50, contextTokens: 200000 } } }];
  cfg.routes = [{ match: "cheap-*", upstream: "u", upstreamModel: "{model}" }, { match: "big-*", upstream: "u", upstreamModel: "{model}" }];
  cfg.memory = { enabled: true, folder: join(dataDir, "mem"), models: { summarizer: "cheap-1" }, autopilot: { enabled: true, mode: "conservative", briefingTokens: 400, turnTokens: 200, minScore: 0.2, tools: false }, capture: { turns: true, learn: false }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: true } };
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); up.close(); delete process.env.FILAMENT_MEMORY_SIDECAR; for (let i = 0; i < 10; i++) { try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } } });

const H = { "content-type": "application/json", "x-api-key": "k" };
const SYS = "You are a coding assistant.\nWorking directory: C:\\demo\\clientcompaction";
const COMPACT_ASK = "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests.";
const post = (/** @type {any} */ body, /** @type {string} */ sid) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, "x-session-id": sid }, body: JSON.stringify({ model: "big-1", max_tokens: 256, system: SYS, ...body }) });
const textOf = async (/** @type {Response} */ r) => (await r.json()).content.map((/** @type {any} */ b) => b.text || "").join("");
const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => (await fetch(`http://127.0.0.1:${port}/api${path}`, { headers: H, ...init })).json();
const records = async () => (await api("/requests?limit=40")).requests;
/** The conversation as a client sends it: every request ends on the person's newest message (a turn or a tool leg). */
const play = async (/** @type {any[]} */ messages, /** @type {string} */ sid) => {
  for (let i = 0; i < messages.length; i++) if (messages[i].role === "user") await post({ messages: messages.slice(0, i + 1) }, sid);
};

/** The session the newest request was archived under: the one just played. */
const chainOf = async () => (await records()).find((x) => x.memory?.chain && !x.memory?.command)?.memory?.chain;
/** Write the session's own settings, as its page does. @param {string} chain @param {any} patch */
const choose = (chain, patch) => api(`/sessions/${chain}/settings`, { method: "PATCH", body: JSON.stringify({ patch }) });

// (fails before: yes — a session that chose fold was answered with Filament's fold bundle and no model called, and one
// that chose a side model with a summary from /trim's summarizer)
test("e2e: a client's compaction goes to its own model as it sent it, whatever its session chose, and the summary it writes is the client's row", async () => {
  for (const [sid, compaction] of /** @type {const} */ ([["cc-own-fold", { method: "fold" }], ["cc-own-side", { method: "summary", writer: "model", model: "cheap-1" }]])) {
    const messages = toolConvo(6, `the lantern of ${sid}`);
    await play(messages, sid);
    const chain = await chainOf();
    assert.ok(chain, "the client's session");
    await choose(chain, { context: { compaction } });
    seen.length = 0;
    const r = await post({ max_tokens: 4096, messages: [...messages, { role: "user", content: COMPACT_ASK }] }, sid);
    assert.equal(r.status, 200);
    assert.equal(await textOf(r), "EXPENSIVE MODEL ANSWER", `${sid}: the client's own model wrote it`);
    assert.deepEqual(seen.map((b) => b.model), ["big-1"], `${sid}: one call, to the model the client named`);
    assert.equal(seen[0].messages.length, messages.length + 1, "every message the client sent, and nothing folded away");
    assert.ok(JSON.stringify(seen[0].messages).includes("contents of file1.js"), "the oldest tool result as it was");
    assert.ok(!seen.some(isSliceCall), "and no summarizer was called");
    const rec = (await records()).find((x) => x.memory?.chain === chain && x.memory?.position === "compaction");
    assert.ok(rec, "the record is the compaction's");
    assert.notEqual(rec.local, true, "answered upstream, not by Filament");
    const row = app.memory.archive.getCompactions(chain).at(-1);
    assert.deepEqual([row?.kind, row?.method], ["client", "summary"], `${sid}: archived as the client's own summary`);
  }
});

// (fails before: yes — the row stood for as many turns as had finished, by count: a turn that never ended shifted it)
test("e2e: a client's compaction row stands for the turns up to the newest that finished, by its number — a turn that never ended does not shift it", async () => {
  const sid = "cc-unended-1";
  const before = toolConvo(2, "the unended lantern");
  await play(before, sid);
  const failed = await post({ messages: [...before, { role: "user", content: "the request that fails, for the unended lantern" }] }, sid);
  assert.equal(failed.status, 400);
  const a = app.memory.archive;
  const chain = await chainOf();
  /** The client compacts `messages`: the row its summary was archived as. @param {any[]} messages */
  const compact = async (messages) => {
    const r = await post({ max_tokens: 4096, messages: [...messages, { role: "user", content: COMPACT_ASK }] }, sid);
    assert.equal(r.status, 200);
    return a.getCompactions(chain).at(-1);
  };
  // (fails before: no — a guard: the turn that failed, the newest of all, is none the summary holds)
  const first = await compact(before);
  assert.deepEqual([first.kind, first.to_turn], ["client", 2]);
  // The client carries on without the message that failed: its turn never ends.
  const all = [...before, ...toolConvo(4, "the unended lantern").slice(8)];
  for (let i = before.length; i < all.length; i++) if (all[i].role === "user") await post({ messages: all.slice(0, i + 1) }, sid);
  const turns = a.getTurns(chain);
  assert.deepEqual(turns.filter((/** @type {any} */ t) => t.ended_at == null).map((/** @type {any} */ t) => t.n), [3], "the turn that failed never ended");
  const newest = Math.max(...turns.filter((/** @type {any} */ t) => t.ended_at != null).map((/** @type {any} */ t) => t.n));
  assert.ok(a.getChain(chain).turns < newest, "fewer turns finished than the newest one's number");
  const second = await compact(all);
  assert.deepEqual([second.kind, second.to_turn], ["client", newest]);
});

// (fails before: yes — a lead of 11-01's engine fix: memory read the person's message as a client's compaction request,
// so the turn was none of the chat's, its answer archived as a compaction of the turns before it — the next request
// composed from that "summary" — and the request offered tools the chat's others do, breaking the cached prefix)
test("e2e: a message typed in a chat Filament composes that reads like a compaction prompt is a turn of that chat", async () => {
  /** @type {any[]} */
  const bodies = [];
  const up2 = await fakeUpstream(async (/** @type {any} */ call) => {
    bodies.push(call.body);
    return anthropicReply("Here is where we stand.", { model: "brain-model" });
  });
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up2.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: false };
    cfg.memory.capture = { turns: true, learn: false };
  };
  const shim = await startApp({ memory: true, configure });
  try {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "brain-model", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    /** @param {string} content */
    const say = async (content) => assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } })).status, 200);
    await say("let us talk about the parser");
    await say("summarize our conversation so far");
    await say("and what next?");
    const turns = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=0`)).json()).turns || [];
    const said = (/** @type {any} */ m) => [].concat(m?.content || []).map((/** @type {any} */ b) => b.text || "").join("");
    assert.deepEqual(turns.map((/** @type {any} */ t) => [t.n, said(t.user)]), [[1, "let us talk about the parser"], [2, "summarize our conversation so far"], [3, "and what next?"]]);
    assert.deepEqual(/** @type {any} */ (shim.app).memory.archive.getCompactions(id), [], "nothing compacted");
    assert.deepEqual(bodies.at(-1).messages.map((/** @type {any} */ m) => said(m)).filter(Boolean).slice(0, 4), ["let us talk about the parser", "Here is where we stand.", "summarize our conversation so far", "Here is where we stand."], "the next request carries the chat as it was said");
    const names = (/** @type {any} */ b) => (b.tools || []).map((/** @type {any} */ t) => t.name);
    assert.deepEqual(names(bodies[1]), names(bodies[0]), "the same tools as the chat's other requests");
  } finally {
    await shim.stop();
    await up2.close();
  }
});

test("e2e: a settings write on a client's session answers `native: false`, so the harness keeps drawing the client's side after the write", async () => {
  const sid = "cc-native-1";
  const messages = toolConvo(2, "the native lantern");
  await play(messages, sid);
  const chain = (await records()).find((x) => x.memory?.chain && !x.memory?.command)?.memory?.chain;
  const w = await api(`/sessions/${chain}/settings`, { method: "PATCH", body: JSON.stringify({ patch: { context: { compaction: { method: "fold" } } } }) });
  assert.equal(w.native, false, JSON.stringify(Object.keys(w)));
  const r = await api(`/sessions/${chain}/settings`);
  assert.equal(r.native, false, "the read answer says the same");
});
