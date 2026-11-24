// The slice pass on a long turn: a turn bigger than one slice is read in slices at its steps, every message once and
// in order; and a client's compaction summary its model cut at the output cap is said on the record and the op log.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { turnGroups, estTokens, pickSlice, sliceSummaries, sliceRoom, normalizeTrimPolicy, renderMessages } from "../src/services/trim.js";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_SIDECAR = join(here, "fixtures", "fake-sidecar.mjs");

// The shape: one request, then `steps` model replies each with a tool call and its result, a final report, and a tiny
// newest turn.
function longTurnConvo(steps, { tag = "build", resultWords = 120, tail = true, format = "anthropic" } = {}) {
  const ms = [{ role: "user", content: `${tag}: nail this feature while I sleep. ` + "context ".repeat(200) }];
  for (let i = 0; i < steps; i++) {
    if (format === "anthropic") {
      ms.push({ role: "assistant", content: [{ type: "text", text: `${tag} step ${i}: reading` }, { type: "tool_use", id: `t${i}`, name: "Read", input: { file_path: `src/f${i}.js` } }] });
      ms.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `${tag} line ${i} `.repeat(resultWords) }] });
    } else {
      ms.push({ role: "assistant", content: `${tag} step ${i}: reading`, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "Read", arguments: `{"file_path":"src/f${i}.js"}` } }] });
      ms.push({ role: "tool", tool_call_id: `c${i}`, content: `${tag} line ${i} `.repeat(resultWords) });
    }
  }
  ms.push({ role: "assistant", content: format === "anthropic" ? [{ type: "text", text: `${tag} final report: ` + "done ".repeat(300) }] : `${tag} final report: ` + "done ".repeat(300) });
  if (tail) ms.push({ role: "user", content: "and now?" });
  return ms;
}
// One request, one reply that calls `n` tools at once, their results, a report: a turn with a single step to cut at,
// so no cut at a step makes it smaller.
function wideTurn(n, { words = 300 } = {}) {
  const ms = [
    { role: "user", content: "wide: read them all" },
    { role: "assistant", content: [{ type: "text", text: "wide: reading" }, ...Array.from({ length: n }, (_, i) => ({ type: "tool_use", id: `w${i}`, name: "Read", input: { file_path: `src/w${i}.js` } }))] },
  ];
  for (let i = 0; i < n; i++) ms.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `w${i}`, content: `RESULT-${i}-BEGINS ${"wide line ".repeat(words)}` }] });
  ms.push({ role: "assistant", content: [{ type: "text", text: "wide report: done" }] });
  return ms;
}
const shortModel = (log = []) => async (a) => { log.push(a); return `SUMMARY ${log.length}: ` + "condensed fact ".repeat(40); };

// (fails before: yes — the slice took the turn's newest messages that fit, and the older ones were never read)
test("pickSlice: a group bigger than the budget gives its oldest messages that fit, and the rest of it to the next slice", () => {
  const rendered = ["[user]: ask", ...Array.from({ length: 9 }, (_, i) => `[user]: M${i} ${"w ".repeat(400)}`)];
  const tokens = rendered.map(estTokens);
  const budget = tokens[1] * 3 + tokens[0] + 5;
  const pick = pickSlice({ groups: [{ from: 0, to: 10 }, { from: 10, to: 10 }], rendered, tokens, from: 0, budget });
  assert.deepEqual([pick.fromMsg, pick.toMsg, pick.next], [0, 4, 1], "the request and the first three");
  assert.deepEqual(pick.rest, { from: 4, to: 10 }, "what is left of the group");
  assert.ok(pick.text.startsWith("[user]: ask") && pick.text.includes("M2 ") && !pick.text.includes("M3 "));
  assert.equal(pick.clippedChars, 0);
  // a group that fits has no rest; one message alone bigger than the budget is still taken, clipped and counted
  assert.equal(pickSlice({ groups: [{ from: 0, to: 2 }], rendered, tokens, from: 0, budget }).rest, null);
  const one = pickSlice({ groups: [{ from: 1, to: 3 }], rendered, tokens, from: 0, budget: Math.floor(tokens[1] / 2) });
  assert.deepEqual([one.fromMsg, one.toMsg], [1, 2], "never zero progress");
  assert.deepEqual(one.rest, { from: 2, to: 3 });
  assert.ok(one.clippedChars > 0, "and what did not fit of it is counted");
});

// (fails before: yes — 1 slice of the turn's newest messages, with "N of its older message(s) were left out of the summary")
test("sliceSummaries: a turn bigger than one slice is read in slices one after another, every message in exactly one, in order", async () => {
  const ms = wideTurn(40);
  const P = normalizeTrimPolicy({});
  const room = sliceRoom(8000, P);
  const rendered = renderMessages(ms, { cap: P.tailMessageCapChars });
  const tokens = rendered.map(estTokens);
  const groups = turnGroups(ms, "anthropic");
  assert.equal(groups.length, 1, "one turn");
  assert.ok(tokens.reduce((a, b) => a + b, 0) > 3 * Math.max(room.minSlice, room.budget), "several slices big");
  const log = [], notes = [];
  const pass = await sliceSummaries({ groups, rendered, tokens, policy: P, room, callModel: shortModel(log), notes });
  assert.deepEqual(groups, [{ from: 0, to: ms.length }], "the caller's groups are its own");
  assert.ok(pass.slices.length >= 3, `sliced: ${pass.slices.length}`);
  const sent = log.map((a) => String(a.user).slice(String(a.user).indexOf("EXCERPT (")));
  const where = Array.from({ length: 40 }, (_, i) => sent.flatMap((s, k) => (s.includes(`RESULT-${i}-BEGINS`) ? [k] : [])));
  assert.ok(where.every((w) => w.length === 1), `each result is read once: ${JSON.stringify(where)}`);
  assert.deepEqual(where.flat(), where.flat().slice().sort((a, b) => a - b), "in the order they happened");
  assert.ok(sent[0].includes("wide: read them all"), "the request opens the first slice");
  assert.ok(sent.at(-1).includes("wide report: done"), "the report closes the last");
  assert.equal(pass.slices[0].from, 1);
  assert.equal(pass.slices.at(-1).to, ms.length);
  for (let k = 1; k < pass.slices.length; k++) assert.equal(pass.slices[k].from, pass.slices[k - 1].to + 1, "no gap and no overlap between slices");
  assert.deepEqual([pass.clippedChars, pass.mechanical, pass.endedBy], [0, 0, "exhausted"]);
  assert.ok(!notes.some((n) => /left out/.test(n)), JSON.stringify(notes));
});

// ---- end to end ----------------------------------------------------------------------------------------------------
let up, app, port, dataDir, seen, cutReply = false;
const isSliceCall = (b) => /compress one part of a long conversation/.test(typeof b.system === "string" ? b.system : JSON.stringify(b.system || ""));
before(async () => {
  seen = [];
  up = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const body = JSON.parse(b || "{}"); seen.push(body);
    const text = isSliceCall(body) ? `SUMMARY ${seen.filter(isSliceCall).length}: the build read files and fixed them; ` + "condensed fact ".repeat(60) : "MODEL ANSWER";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_e", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: cutReply && !isSliceCall(body) ? "max_tokens" : "end_turn", usage: { input_tokens: 10, output_tokens: cutReply && !isSliceCall(body) ? 4096 : 5 } }));
  }); });
  await new Promise((r) => up.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-longturn-"));
  const stateFile = join(dataDir, "fake-engine-state.json"); writeFileSync(stateFile, JSON.stringify({ memories: [], canonical: [], seq: 1 }));
  process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: process.execPath, args: [FAKE_SIDECAR], env: { FAKE_SIDECAR_STATE: stateFile } });
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "u", name: "u", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${up.address().port}`, apiKey: "s", pricing: { "cheap-1": { input: 1, output: 1, contextTokens: 128000 }, "cheap-small": { input: 1, output: 1, contextTokens: 8000 }, "big-1": { input: 5, output: 5, contextTokens: 500000 } } }];
  cfg.routes = [{ match: "cheap-*", upstream: "u", upstreamModel: "{model}" }, { match: "big-*", upstream: "u", upstreamModel: "{model}" }];
  cfg.memory = { enabled: true, folder: join(dataDir, "mem"), models: { summarizer: "cheap-1" }, autopilot: { enabled: false }, capture: { turns: true, learn: false }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: false } };
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); up.close(); delete process.env.FILAMENT_MEMORY_SIDECAR; for (let i = 0; i < 10; i++) { try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } } });

const H = { "content-type": "application/json", "x-api-key": "k" };
const SYS = "You are a coding assistant.\nWorking directory: C:\\demo\\longturn";
const post = (body, extra = {}) => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: { ...H, ...extra }, body: JSON.stringify(body) });
const textOf = async (r) => (await r.json()).content.map((b) => b.text || "").join("");
const records = async (limit = 40) => (await (await fetch(`http://127.0.0.1:${port}/api/requests?limit=${limit}`, { headers: H })).json()).requests;
const opsList = async () => { const j = await (await fetch(`http://127.0.0.1:${port}/api/ops?limit=200`, { headers: H })).json(); return Array.isArray(j) ? j : j.ops || []; };
const COMPACT_ASK = "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests.";

test("e2e: a client's compaction summary the model cut at its output cap is flagged on the record and as a warning operation", async () => {
  const S = { "x-session-id": "long-conv-3" };
  const ms = longTurnConvo(6, { tag: "sigma", tail: false, resultWords: 20 });
  await post({ model: "big-1", max_tokens: 64, system: SYS, messages: ms }, S);
  cutReply = true;
  try {
    const r = await post({ model: "big-1", max_tokens: 4096, system: SYS, messages: [...ms, { role: "user", content: COMPACT_ASK }] }, S);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.stop_reason, "max_tokens", "the client saw the real stop reason");
    assert.equal(j.content[0].text, "MODEL ANSWER", "the client's model wrote the summary");
  } finally { cutReply = false; }
  const rec = (await records()).find((x) => x.clientSession === "long-conv-3" && x.stopReason === "max_tokens");
  assert.ok(rec, "the compaction record");
  assert.ok(rec.changes.some((c) => /compaction: the model's summary stopped at the output cap \(max_tokens, 4,096 tokens\)/.test(c)), JSON.stringify(rec.changes));
  assert.deepEqual(rec.compactionCut, { stop: "max_tokens", outputTokens: 4096 });
  const op = (await opsList()).find((o) => o.kind === "compaction" && o.sub === "client-cut");
  assert.ok(op, "a compaction operation was recorded");
  assert.equal(op.level, "warn");
  assert.match(op.title, /cut at the output cap \(4,096 tokens\)/);
  assert.equal(op.detail?.outputTokens, 4096);
  // an ordinary reply that ends on its own is not flagged
  const r2 = await post({ model: "big-1", max_tokens: 64, system: SYS, messages: [...ms, { role: "user", content: "sigma: and now?" }] }, S);
  assert.equal(r2.status, 200);
  const rec2 = (await records()).find((x) => x.clientSession === "long-conv-3" && x.ts > rec.ts && !x.local);
  assert.ok(rec2 && !rec2.compactionCut && !rec2.changes.some((c) => /output cap/.test(c)), JSON.stringify(rec2?.changes));
});

// (fails before: yes — the review of 10-31: the warning named the chain memory's prepare pass named, and a request that
// pass skips — the client's summary probe — named none, so its session could not find it)
test("e2e: a client's summary probe the model cut at its output cap names its session on the warning operation", async () => {
  const S = { "x-session-id": "long-conv-probe" };
  await post({ model: "big-1", max_tokens: 64, system: SYS, messages: [{ role: "user", content: "probe: hello" }] }, S);
  const chain = (await records()).find((x) => x.clientSession === "long-conv-probe")?.memory?.chain;
  assert.ok(chain, "the session's chain");
  cutReply = true;
  try {
    const r = await post({ model: "big-1", max_tokens: 4096, system: "This is a summary generation task: summarize the text you are given.", messages: [{ role: "user", content: "probe: the text to condense" }] }, S);
    assert.equal(r.status, 200);
  } finally { cutReply = false; }
  const rec = (await records()).find((x) => x.clientSession === "long-conv-probe" && x.stopReason === "max_tokens");
  assert.ok(rec?.compactionCut, "the probe's cut summary, flagged");
  const op = (await opsList()).find((o) => o.kind === "compaction" && o.sub === "client-cut" && o.ref?.requestId === rec.id);
  assert.ok(op, "its warning operation");
  assert.equal(op.ref.chainId, chain);
});
