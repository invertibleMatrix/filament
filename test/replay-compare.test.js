// 2.11 — replay polish (vault: Remediation Plan item 2.11).
//
// Three deliverables, and the reason each needs a test of its own:
//   1. TTFT in the comparison. A replay used to be sent with `stream: false`, which means its "first byte" was
//      measured once the WHOLE reply had arrived — the column existed but the number was a total. Replays now stream,
//      and the fake below delays the last chunk rather than the first so a real TTFT is provably smaller than the
//      total. A test that only checked "ttftMs is present" would pass on the old broken behaviour.
//   2. The comparison payload itself, with the honesty flags: comparing a streamed replay's first byte against a
//      non-streamed original's total would invent a speedup, so each side says whether it streamed.
//   3. Grouping. `/api/requests/:id/replays` is what the Traffic table folds under the original row.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

let fake, app, port, dataDir, hits;
const LAST_CHUNK_DELAY = 250; // the reply starts immediately and finishes late: TTFT << total, by construction
const sseLine = (o) => `data: ${JSON.stringify(o)}\n\n`;

// The user text of a request, in whatever shape it arrives: Filament's cache rules can turn a plain string into an
// array of text blocks with cache_control markers, so a fake that only reads strings sees an empty prompt.
const firstUserText = (body) => {
  const c = body?.messages?.[0]?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((b) => b?.type === "text").map((b) => b.text || "").join("");
  return "";
};

// The fake streams. `who` differs per model so the reply proves which model actually answered.
// Two deliberate misbehaviours, because an honesty flag is only worth anything if something can break it:
//   json-*    answers plain JSON even to a streaming request, so Filament buffers and converts — its "first byte"
//             is then the whole reply, and `ttftReal` must say so instead of reporting a fake TTFT.
//   broken-*  streams a message_start and then garbage: the stream parses but carries no content at all.
function answerStream(res, body, fmt) {
  const who = body.model.includes("sonnet") ? "sonnet says" : body.model.includes("glm") ? "glm says" : body.model.includes("json") ? "json says" : body.model.includes("broken") ? "broken says" : "opus says";
  const text = `${who}: ${firstUserText(body).slice(0, 40)}`;
  if (body.model.includes("broken") && body.stream === true) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "mb", type: "message", role: "assistant", model: body.model, content: [], usage: { input_tokens: 5, output_tokens: 0 } } })}\n\n`);
    return res.end("event: content_block_delta\ndata: {this is not json at all\n\n");
  }
  if (body.stream !== true || body.model.includes("json")) { // a non-streaming request still works (the original traffic in these tests)
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(fmt === "openai"
      ? { id: "c", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }
      : { id: "msg_x", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 5 } }));
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  if (fmt === "openai") {
    const chunk = (delta, fr = null) => sseLine({ id: "c1", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: fr }] });
    res.write(chunk({ role: "assistant", content: "" }));       // first byte: immediate
    setTimeout(() => {
      res.write(chunk({ content: text }));
      res.write(chunk({}, "stop"));
      res.write(sseLine({ id: "c1", object: "chat.completion.chunk", model: body.model, choices: [], usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 } }));
      res.end("data: [DONE]\n\n");
    }, LAST_CHUNK_DELAY);
    return;
  }
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  res.write(ev("message_start", { type: "message_start", message: { id: "msg_s", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } }));
  res.write(ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  setTimeout(() => {                                              // the rest of the reply arrives late
    res.write(ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }));
    res.write(ev("content_block_stop", { type: "content_block_stop", index: 0 }));
    res.write(ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } }));
    res.end(ev("message_stop", { type: "message_stop" }));
  }, LAST_CHUNK_DELAY);
}

before(async () => {
  hits = [];
  fake = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const body = JSON.parse(b || "{}"); hits.push({ url: req.url, body });
    answerStream(res, body, req.url.includes("chat/completions") ? "openai" : "anthropic");
  }); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-replaycmp-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.observability.storeBodies = "full"; // replays need the stored inbound body
  cfg.upstreams = [{ id: "m", name: "m", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: "s", pricing: { "claude-opus-5": { input: 15, output: 75 }, "claude-sonnet-5": { input: 3, output: 15 }, "glm-4.6": { input: 0.6, output: 2.2 } } },
    // A coding agent on its own route, for the refusal test: `x-*` reaches the API upstream, bare `x` reaches the
    // agent, so a model named "x-max" only lands on the agent once the effort suffix is stripped — exactly the case
    // the replay guard used to miss.
    { id: "agent1", name: "agent", type: "acp", acp: { command: process.execPath, args: ["-e", "process.exit(9)"] } }];
  cfg.routes = [{ match: "claude-*", upstream: "m", upstreamModel: "{model}" }, { match: "glm-*", upstream: "m", upstreamModel: "{model}" }, { match: "chat-*", upstream: "m", upstreamModel: "claude-opus-5" },
    { match: "json-*", upstream: "m", upstreamModel: "{model}" }, { match: "broken-*", upstream: "m", upstreamModel: "{model}" },
    { match: "x-*", upstream: "m", upstreamModel: "claude-opus-5" }, { match: "x", upstream: "agent1", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); fake.close(); for (let i = 0; i < 10; i++) { try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); } } });

const H = { "content-type": "application/json", "x-api-key": "k" };
const chat = (body, path = "/v1/messages") => fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
const api = (path, opts = {}) => fetch(`http://127.0.0.1:${port}/api${path}`, { headers: H, ...opts }).then((r) => r.json());
const records = async (limit = 25) => (await api(`/requests?limit=${limit}`)).requests;

test("replay TTFT is a real first byte, not the whole reply", async () => {
  hits.length = 0;
  const r1 = await chat({ model: "claude-opus-5", max_tokens: 100, messages: [{ role: "user", content: "fix the flux capacitor" }] });
  assert.equal(r1.status, 200);
  const orig = (await records()).find((x) => x.model === "claude-opus-5" && x.status === "ok");
  assert.ok(orig?.id, "the original is recorded");

  const rep = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "claude-sonnet-5" }) });
  assert.equal(rep.ok, true, JSON.stringify(rep).slice(0, 400));
  assert.match(rep.reply, /sonnet says: fix the flux capacitor/, "the reply was reconstructed from the streamed chunks");
  // THE point of 2.11: the replay streamed, so its first byte came long before its last.
  const sent = hits.find((h) => h.body.model === "claude-sonnet-5");
  assert.equal(sent.body.stream, true, "the replay was sent as a streaming request");
  const side = rep.compare.replay;
  assert.ok(side.ttftMs != null, "the replay reports a first-byte time");
  assert.ok(side.totalMs != null && side.totalMs > side.ttftMs, `total ${side.totalMs} > first byte ${side.ttftMs}`);
  assert.ok(side.ttftMs < LAST_CHUNK_DELAY, `first byte ${side.ttftMs}ms arrived before the ${LAST_CHUNK_DELAY}ms delay on the last chunk — it is a genuine TTFT, not a total`);
  assert.equal(side.streamed, true, "and it says it streamed");
  assert.equal(side.model, "claude-sonnet-5");
  assert.ok(side.id, "with the replay's own record id");
  // the record itself carries it, so the Traffic row and the drawer agree
  const rec = (await records()).find((x) => x.id === side.id);
  assert.ok(rec, "the replay record is listed");
  assert.equal(rec.replayOf, orig.id, "linked to the original");
  assert.ok(rec.ttftMs != null && rec.ttftMs < rec.totalMs, `the record's own TTFT is real too (${rec.ttftMs} < ${rec.totalMs})`);
  assert.ok(rec.tps != null, "and tokens-per-second is computable, because a stream has a first byte");
});

test("the comparison reports both sides, and is honest about which one streamed", async () => {
  const orig = (await records()).find((x) => x.model === "claude-opus-5" && x.status === "ok");
  const rep = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "glm-4.6" }) });
  assert.ok(rep.compare, "the payload carries a comparison");
  const { original, replay } = rep.compare;
  assert.equal(original.id, orig.id, "the original side is the request that was replayed");
  assert.equal(original.model, "claude-opus-5");
  assert.equal(replay.model, "glm-4.6");
  assert.notEqual(original.id, replay.id, "two different records");
  for (const [name, s] of [["original", original], ["replay", replay]]) {
    for (const k of ["id", "model", "status", "ttftMs", "totalMs", "tokens", "streamed", "ts"]) assert.ok(k in s, `${name} side carries ${k}`);
  }
  // The original was a plain non-streaming call, so its "first byte" is really its whole reply. Saying so is the
  // difference between a comparison and a misleading one.
  assert.equal(original.streamed, false, "the original did not stream");
  assert.equal(replay.streamed, true, "the replay did");
  assert.ok(original.cost != null && replay.cost != null, "both sides carry a cost");
  assert.ok(replay.cost < original.cost, `the cheaper model really is cheaper here (${replay.cost} < ${original.cost})`);
  assert.equal(rep.record.id, replay.id, "the legacy `record` field and the comparison agree");
});

test("/requests/:id/replays lists the replays newest first, and only the replays", async () => {
  const orig = (await records()).find((x) => x.model === "claude-opus-5" && x.status === "ok");
  const list = await api(`/requests/${orig.id}/replays`);
  assert.equal(list.original, orig.id);
  assert.ok(list.count >= 2, `both earlier replays are listed (${list.count})`);
  assert.ok(list.replays.every((r) => r.replayOf === orig.id), "every row is a replay of that request");
  assert.ok(!list.replays.some((r) => r.id === orig.id), "and the original is not in its own list");
  const times = list.replays.map((r) => new Date(r.ts).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first, so the table folds them in order");
  // a second replay of the same request accumulates rather than replacing
  const before = list.count;
  await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "claude-sonnet-5" }) });
  const after = await api(`/requests/${orig.id}/replays`);
  assert.equal(after.count, before + 1, "replays accumulate");
  // an unrelated request has none, and an unknown id is a 404 rather than an empty list
  const other = (await records()).find((x) => x.id !== orig.id && !x.replayOf);
  if (other) assert.equal((await api(`/requests/${other.id}/replays`)).count, 0, "a request with no replays says so");
  const missing = await fetch(`http://127.0.0.1:${port}/api/requests/does-not-exist/replays`, { headers: H });
  assert.equal(missing.status, 404, "an unknown id is a 404");
  assert.match((await missing.json()).error, /no such request/);
});

test("openai-shaped requests replay too, and the text is rebuilt from openai chunks", async () => {
  hits.length = 0;
  const r1 = await chat({ model: "chat-1", max_tokens: 100, messages: [{ role: "user", content: "openai shaped question" }] }, "/v1/chat/completions");
  assert.equal(r1.status, 200);
  const orig = (await records()).find((x) => x.format === "openai" && x.status === "ok" && !x.replayOf);
  assert.ok(orig?.id, `the openai original is recorded: ${JSON.stringify((await records()).slice(0, 3).map((x) => [x.model, x.format]))}`);
  const rep = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "claude-sonnet-5" }) });
  assert.equal(rep.ok, true, JSON.stringify(rep).slice(0, 400));
  assert.match(rep.reply, /sonnet says: openai shaped question/, "the reply was rebuilt from openai SSE chunks");
  assert.equal(rep.compare.replay.streamed, true);
  assert.ok(rep.compare.replay.ttftMs < LAST_CHUNK_DELAY, "and its TTFT is a real first byte");
  // NOTE: what this observes is Filament's upstream-leg translation (an openai-format replay sent to an
  // anthropic-compatible provider), not the loopback endpoint the handler chose — the handler always speaks the
  // ORIGINAL's format, which the assertions above already prove by rebuilding the text correctly.
  const sent = hits.find((h) => h.body.model === "claude-sonnet-5");
  assert.ok(sent, "the replay reached the provider");
});

test("a replay can never reach a coding agent — including through an effort suffix", async () => {
  const orig = (await records()).find((x) => x.model === "claude-opus-5" && x.status === "ok");
  assert.ok(orig?.id, "an original to replay");
  const replaysBefore = (await api(`/requests/${orig.id}/replays`)).count; // earlier tests may have left some
  hits.length = 0;
  // THE P1 REGRESSION. The guard used to resolve the route with `parseModelSuffix(model)` — no `cfg.rules` — while the
  // proxy resolves it with the rules, which strip effort suffixes. So "x-max" looked like the API route `x-*` to the
  // guard but became base "x" (the AGENT route) by the time it was sent: a replay that is supposed to be refused
  // actually spawned a coding agent.
  const agentViaSuffix = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "x-max" }) });
  assert.equal(agentViaSuffix.error ? 400 : 200, 400, `an effort-suffixed name that strips onto an agent route must be refused, got ${JSON.stringify(agentViaSuffix).slice(0, 200)}`);
  assert.match(agentViaSuffix.error, /coding agent "agent1"/, "and the refusal names the agent");
  // plain names, already covered elsewhere but asserted here so the two paths cannot drift apart
  const agentPlain = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "x" }) });
  assert.match(agentPlain.error || "", /coding agent/, "the bare agent route is refused");
  // nothing at all was sent for either refusal: the guard runs before the call, not after
  assert.equal(hits.length, 0, `no upstream call was made for a refused replay (${hits.length} seen)`);
  // and no replay records were created by the refusals (earlier tests may have left some, so compare the count)
  assert.equal((await api(`/requests/${orig.id}/replays`)).count, replaysBefore, "a refused replay leaves no record behind");
  // a legitimate API-only suffixed name still works, so the fix is not just "refuse everything with a suffix"
  const okSuffix = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "claude-sonnet-5-high" }) });
  assert.equal(okSuffix.ok, true, `an effort-suffixed API model still replays: ${JSON.stringify(okSuffix).slice(0, 200)}`);
});

test("an upstream that answers JSON to a streamed replay is not allowed to fake a TTFT", async () => {
  const orig = (await records()).find((x) => x.model === "claude-opus-5" && x.status === "ok");
  const rep = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "json-only" }) });
  assert.equal(rep.ok, true, JSON.stringify(rep).slice(0, 300));
  assert.match(rep.reply, /json says/, "the reply still came back, buffered and converted");
  const side = rep.compare.replay;
  // The replay asked for a stream, but this provider answered JSON, so Filament buffered the whole reply and its
  // "first byte" is really its total. Reporting that as a real TTFT would put a total next to the original's genuine
  // first byte and invent a comparison — which is the exact thing 2.11's honesty flags exist to prevent.
  assert.equal(side.streamed, true, "the request did ask for a stream");
  assert.equal(side.ttftReal, false, "but the first-byte time is NOT a real first byte, and the payload says so");
  const original = rep.compare.original;
  assert.equal(original.ttftReal, false, "the non-streaming original is flagged the same way");
});

test("a stream that parses but carries no content is reported as a failure, not a green replay", async () => {
  const orig = (await records()).find((x) => x.model === "claude-opus-5" && x.status === "ok");
  const rep = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "broken-1" }) });
  assert.equal(rep.ok, false, "a contentless stream is not a successful replay");
  assert.match(rep.error, /no content|truncated|malformed|incomplete/i, `and the reason is honest: ${rep.error}`);
  assert.equal(rep.reply, null, "no reply text is invented");
  assert.equal(rep.compare.replay.status, "error", "the comparison side agrees with the top-level ok");
});

test("refusals before any call are reported cleanly, with no comparison invented", async () => {
  const orig = (await records()).find((x) => x.model === "claude-opus-5" && x.status === "ok");
  hits.length = 0;
  const noRoute = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "nope-xyz" }) });
  assert.match(noRoute.error, /no route/, "an unroutable model is refused before any call");
  assert.equal(noRoute.compare, undefined, "and no comparison is invented for a call that never happened");
  const empty = await api(`/requests/${orig.id}/replay`, { method: "POST", body: JSON.stringify({ model: "" }) });
  assert.match(empty.error, /model is required/, "an empty model is refused");
  const missing = await fetch(`http://127.0.0.1:${port}/api/requests/does-not-exist/replay`, { method: "POST", headers: H, body: JSON.stringify({ model: "claude-sonnet-5" }) });
  assert.equal(missing.status, 404, "an unknown request is a 404");
  assert.equal(hits.length, 0, "none of the refusals reached an upstream");
});
