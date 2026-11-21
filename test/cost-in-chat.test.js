// @ts-check
// `/cost` in the harness (HarnessV3-FixRound F1b, decisions 2–4): it is answered by Filament in an `agent/<model>` chat
// too (it used to reach the model there), it counts this chat's requests — a harness turn carries no client id, so it
// used to read "the last 24 hours (this client sends no chat id)" — and Filament's own answers (`/set …`) are counted
// as requests through Filament but never as a model's line.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { chatRecordsOf } from "../src/app/commands/status.js";

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 300, output_tokens: 20 } });
/** The person's newest words in a request. @param {any} body */
const said = (body) => {
  const users = (body?.messages || []).filter((/** @type {any} */ m) => m.role === "user");
  for (const m of users.reverse()) {
    const c = m.content;
    const t = typeof c === "string" ? c : (c || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join(" ");
    if (t.trim()) return t;
  }
  return "";
};
/** @param {any} body */
const answered = (body) => JSON.stringify((body?.messages || []).at(-1)?.content ?? "").includes("tool_result");

// (fails before: yes — the review of 197fa5a44: "ok" records alone were counted, so a stream its client hung up on,
// closed `aborted` with what it spent, was missing from /cost and /status while the Spend widget counted it)
// (fails before: yes — the review of b881c3aab: every closed record counted, so a request refused before any model
// spent on it — Filament's own refusal, a provider's 529 — was a request of the chat's, its model's line and its cache
// line one call more)
test("/cost and /status count the chat's requests that spent, a hung-up one's too; none refused before a model spent, none in flight", () => {
  const ts = new Date().toISOString();
  const recs = [
    { id: "a", status: "ok", clientSession: "c", ts, cost: 0.1 },
    { id: "b", status: "aborted", error: "client disconnected", clientSession: "c", ts, cost: 0.2 },
    { id: "c", status: "error", clientSession: "c", ts, cost: 0, tokens: { input: 0, output: 0 } },
    { id: "d", status: "pending", clientSession: "c", ts },
    { id: "e", status: "ok", clientSession: "other", ts, cost: 1 },
    { id: "f", status: "error", error: "the stream broke", clientSession: "c", ts, tokens: { input: 120, output: 4 } },
  ];
  assert.deepEqual(chatRecordsOf(recs, "c").map((r) => r.id), ["a", "b", "f"]);
});

describe("/cost in a harness chat", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-cost-chat-"));
    up = await fakeUpstream((call) => {
      if (call.kind !== "anthropic") return undefined;
      // "two rounds": a command, then the answer; anything else is answered at once.
      if (/two rounds/.test(said(call.body)) && !answered(call.body)) return reply([toolUse("b1", "bash", { command: "echo hi" })], "tool_use");
      if (/refuse me/.test(said(call.body))) return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "not now" } } };
      return reply([{ type: "text", text: "pong" }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} model */
  const session = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const say = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200);
    const j = await r.json();
    return (j.content || []).map((/** @type {any} */ b) => b.text || "").join("");
  };

  // (fails before: yes — the plain route was looked up by `agent/brain-model`, found none, and /cost went to the model)
  test("in an agent/<model> chat, /cost is answered by Filament and no model is called", async () => {
    const id = await session("agent/brain-model");
    await say(id, "hi");
    const calls = up.received.length;
    const text = await say(id, "/cost");
    assert.match(text, /^\*\*Cost for this chat\*\*/);
    assert.equal(up.received.length, calls, "no model call");
    assert.match(await say(id, "/help"), /Commands you can type in this chat/);
    assert.match(await say(id, "/status"), /Filament status for this chat/);
    assert.equal(up.received.length, calls, "nor for /help or /status");
  });

  // (fails before: yes — with no client id, both read the last 24 hours, every session's requests together)
  test("each harness chat's /cost counts its own rounds, as this chat", async () => {
    const a = await session("brain-model");
    const b = await session("brain-model");
    await say(a, "two rounds please");
    await say(b, "hi");
    const ca = await say(a, "/cost");
    const cb = await say(b, "/cost");
    assert.match(ca, /^\*\*Cost for this chat\*\* \(2 requests through Filament\)/, ca.slice(0, 200));
    assert.match(ca, /brain-model: {2}600 input, 40 output, .*2 requests\)/);
    assert.match(cb, /^\*\*Cost for this chat\*\* \(1 request through Filament\)/, cb.slice(0, 200));
    assert.doesNotMatch(cb, /last 24 hours/);
  });

  // (fails before: yes — the review of bfc1154da: the spend ledger booked every closed record, so a request the
  // provider refused before spending on it was a request of the session's spend — the Spend widget one more than /cost, a
  // 0-token row under the model, the Cache widget's last request)
  test("a request refused before any model spent on it books nothing: the session's spend counts as /cost does", async () => {
    const id = await session("brain-model");
    const refused = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "refuse me", stream: false } });
    assert.notEqual(refused.status, 200, "refused");
    await say(id, "hi");
    const spend = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.spend;
    assert.deepEqual([spend?.requests, spend?.byModel?.["brain-model"]?.requests, spend?.unpricedRequests], [1, 1, 1], "the one that answered, unpriced here: no price card for brain-model");
    assert.match(await say(id, "/cost"), /^\*\*Cost for this chat\*\* \(1 request through Filament\)/);
  });

  // (fails before: yes — the /set's record was a request of brain-model with 0 tokens, so the model's line read 2)
  test("Filament's own answers count as requests through Filament, never as a model's", async () => {
    const id = await session("brain-model");
    assert.match(await say(id, "/set context.compaction.keepWhole 4"), /context\.compaction\.keepWhole/);
    await say(id, "hi");
    const text = await say(id, "/cost");
    assert.match(text, /\(2 requests through Filament, 1 of them answered by Filament itself\)/, text.slice(0, 200));
    assert.match(text, /brain-model: {2}300 input, 20 output, .*1 request\)/);
    assert.equal((text.match(/^ {4}\S+: /gm) || []).length, 1, "one model line");
    assert.match(text, /Prompt cache: +1 request · /, "the cache line counts the model's calls");
  });
});
