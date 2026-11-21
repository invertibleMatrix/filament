// HarnessV3-TaskGraph-v2 TG2-D81: the agent loop measures its conversation as it goes on the wire. A thinking block
// an OpenAI-format upstream never receives (the translation drops them all), or an unsigned one an Anthropic-format
// upstream never receives (the shaping drops them), costs nothing in the window's measure. The bench's second run
// found the measure counting them: 191K "of the window" while GLM was sent 10K a call.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, openaiReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { estimateBodyParts, estimateBodyTokens, estimateTokens } from "../src/core/tokens.js";
import { thinkingOnWire } from "../src/core/routing.js";

/** A config with one upstream and one route to it. @param {any} up @param {any} [route] */
const cfgOf = (up, route = {}) => ({
  rules: {},
  upstreams: [{ id: "u", name: "u", baseUrl: "http://127.0.0.1:1", enabled: true, ...up }],
  routes: [{ match: "m-*", upstream: "u", upstreamModel: "{model}", enabled: true, ...route }],
});

describe("thinkingOnWire: which thinking blocks reach the model's upstream", () => {
  test("OpenAI's format: none — its translation drops every thinking block", () => {
    assert.equal(thinkingOnWire(cfgOf({ type: "openai-compatible" }), "m-glm"), "none");
    assert.equal(thinkingOnWire(cfgOf({ type: "openai" }), "m-gpt"), "none");
  });
  test("Anthropic's format: the signed — its shaping drops the unsigned; all where that rule is off", () => {
    assert.equal(thinkingOnWire(cfgOf({ type: "anthropic" }), "m-claude"), "signed");
    assert.equal(thinkingOnWire(cfgOf({ type: "anthropic-compatible" }), "m-x"), "signed");
    assert.equal(thinkingOnWire(cfgOf({ type: "anthropic", rules: { thinking: { stripUnsignedHistory: false } } }), "m-claude"), "all", "the upstream's rules");
    assert.equal(thinkingOnWire(cfgOf({ type: "anthropic" }, { rules: { thinking: { stripUnsignedHistory: false } } }), "m-claude"), "all", "the route's rules");
    const cfg = cfgOf({ type: "anthropic" });
    cfg.rules = { thinking: { stripUnsignedHistory: false } };
    assert.equal(thinkingOnWire(cfg, "m-claude"), "all", "the global rules");
  });
  test("the route's own format decides; auto takes Anthropic's where the upstream speaks it, as plan.js picks", () => {
    // A type Filament does not know speaks either format (routing.js upstreamSupports).
    assert.equal(thinkingOnWire(cfgOf({ type: "something-new" }), "m-x"), "signed", "auto: the loop's own shape, sent as it is");
    assert.equal(thinkingOnWire(cfgOf({ type: "something-new" }, { format: "openai" }), "m-x"), "none", "forced to OpenAI's");
    assert.equal(thinkingOnWire(cfgOf({ type: "openai-compatible" }, { format: "auto" }), "m-x"), "none");
  });
  test("no route, an upstream that is off, no config: all — the measure never counts less than may be sent", () => {
    assert.equal(thinkingOnWire(cfgOf({ type: "openai-compatible" }), "other-model"), "all");
    assert.equal(thinkingOnWire(cfgOf({ type: "openai-compatible", enabled: false }), "m-glm"), "all");
    assert.equal(thinkingOnWire(null, "m-glm"), "all");
    assert.equal(thinkingOnWire(cfgOf({ type: "openai-compatible" }), ""), "all");
  });
});

describe("the count: a thinking block the wire leaves out counts nothing", () => {
  const thought = { type: "thinking", thinking: "deep thought about the sheet ".repeat(800) };
  const signed = { type: "thinking", thinking: "a signed thought on the ledger ".repeat(500), signature: "sig-1" };
  const redacted = { type: "redacted_thinking", data: "Zm9v".repeat(900) };
  /** @param {any[]} blocks */
  const body = (blocks) => ({
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [...blocks, { type: "text", text: "on it" }, { type: "tool_use", id: "t1", name: "read", input: { path: "a.txt" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "the file's words" }] },
    ],
  });
  const all = body([thought, signed, redacted]);
  test("no option, or all: today's count, every block", () => {
    assert.equal(estimateBodyTokens(all), estimateBodyTokens(all, "conversation", null, { thinking: "all" }));
    assert.deepEqual(estimateBodyParts(all), estimateBodyParts(all, "conversation", { thinking: "all" }));
    assert.ok(estimateBodyTokens(all) > estimateBodyTokens(body([])) + 3000, "the blocks weigh, counted");
    assert.equal(estimateBodyTokens(body([thought])) - estimateBodyTokens(body([])), estimateTokens(thought), "an unsigned block weighs its JSON, as it always did");
    assert.equal(estimateBodyTokens(body([redacted]), "conversation", null, { thinking: "all" }) - estimateBodyTokens(body([])), estimateTokens(redacted));
  });
  test("none: the conversation weighs as if it had no thinking at all", () => {
    assert.equal(estimateBodyTokens(all, "conversation", null, { thinking: "none" }), estimateBodyTokens(body([])));
    assert.deepEqual(estimateBodyParts(all, "conversation", { thinking: "none" }), estimateBodyParts(body([])));
  });
  test("signed: a block with a signature and every redacted block count; an unsigned one does not", () => {
    assert.equal(estimateBodyTokens(all, "conversation", null, { thinking: "signed" }), estimateBodyTokens(body([signed, redacted])));
  });
  test("the factor scales what is counted, the same with the option", () => {
    const n = estimateBodyParts(all, "conversation", { thinking: "none" });
    assert.equal(estimateBodyTokens(all, "conversation", 1.5, { thinking: "none" }), Math.round(n.text * 1.5) + n.fixed);
  });
  test("the request scope counts tools as before, thinking by the option", () => {
    const req = { ...all, tools: [{ name: "read", description: "reads", input_schema: { type: "object" } }] };
    assert.equal(estimateBodyTokens(req, "request", null, { thinking: "none" }) - estimateBodyTokens(body([]), "conversation"), estimateBodyTokens({ ...body([]), tools: req.tools }, "request") - estimateBodyTokens(body([]), "conversation"));
  });
});

describe("the loop on an OpenAI-format upstream: a long turn that thinks hard keeps its room (TG2-D81)", () => {
  /** @type {any} */
  let up;
  /** @type {any} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  // About 7,700 tokens of thinking a round by the estimator: four rounds of it are past an 85% line of a 30K
  // window with the loop's own system prompt and tools.
  const THOUGHT = "deep thought about the sheet ".repeat(1400);
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-thinking-root-"));
    writeFileSync(join(root, "a.txt"), "the file's words\n");
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "g", name: "g", type: "openai-compatible", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "glm-think": { input: 1, output: 1, contextTokens: 30000 } } },
          { id: "a", name: "a", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "claude-think": { input: 1, output: 1, contextTokens: 30000 } } },
        ];
        cfg.routes = [
          { match: "glm-*", upstream: "g", upstreamModel: "{model}", enabled: true },
          { match: "claude-*", upstream: "a", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    // (Windows may hold a file of the stopped server's a moment longer: wait until it goes, as the other suites do —
    // rmSync's own retries gave up at once with EPERM)
    await removeDirs(root);
  });
  const H = () => ({ "x-filament-cwd": root, "x-session-id": `s-${Math.random().toString(36).slice(2, 8)}` });
  const eventsOf = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${runId}/events?since=0&limit=5000`)).json()).events;
  /** The model's rounds: four that think and read, then the answer. @param {(round: number, call: any) => any} say */
  const rounds = (say) => {
    /** @type {any[]} */
    const calls = [];
    brain = (call) => {
      calls.push(call);
      return say(calls.length, call);
    };
    return calls;
  };

  test("GLM's reasoning is not counted: every round asks its full max_tokens, nothing folds, the context stays what is sent", async () => {
    const calls = rounds((n) =>
      n <= 4
        ? withReasoning(openaiReply("", { model: "glm-think", finish: "tool_calls", toolCalls: [{ id: `c${n}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path: "a.txt" }) } }] }), THOUGHT)
        : openaiReply("all read", { model: "glm-think" }),
    );
    const r = await shim.house("/v1/messages", { model: "agent/glm-think", max_tokens: 8000, stream: false, messages: [{ role: "user", content: "read a.txt four times" }] }, H());
    assert.equal(r.status, 200, await r.clone().text());
    const j = await r.json();
    assert.equal(j.stop_reason, "end_turn");
    assert.equal(calls.length, 5, "four rounds that read, then the answer: no summarizer was asked");
    assert.ok(calls.every((c) => c.path.includes("/chat/completions")), "every call went in OpenAI's format");
    assert.ok(calls.every((c) => !JSON.stringify(c.body.messages).includes("deep thought")), "the premise: no thinking went on the wire");
    // (fails before: yes — the third and later rounds were clamped under 8,000 and the line folded)
    assert.deepEqual(calls.map((c) => c.body.max_tokens), [8000, 8000, 8000, 8000, 8000], "no round's room was clamped by thinking that was not sent");
    const evts = await eventsOf(String(r.headers.get("x-filament-request-id")));
    assert.ok(!evts.some((e) => e.type === "compacting" || e.type === "compaction"), "nothing folded");
    const ctx = evts.filter((e) => e.type === "round-start").map((e) => e.context || 0);
    assert.ok(ctx.length === 5 && Math.max(...ctx) - ctx[0] < 2000, `the turn's measure grew by its calls and results alone (${ctx.join(", ")})`);
    assert.ok(evts.filter((e) => e.type === "round-thinking").length >= 4, "the thinking itself was seen and kept for the page");
  });

  test("Claude's signed thinking is counted, as before: the turn reaches its line and folds", async () => {
    const calls = rounds((n, call) => {
      if (String(JSON.stringify(call.body.system || "")).includes("compaction summaries")) return anthropicReply("SUMMARY: a.txt was read.", { model: "claude-think" });
      return n <= 6
        ? anthropicReply("", { model: "claude-think", stop: "tool_use", blocks: [{ type: "thinking", thinking: THOUGHT, signature: `sig-${n}` }, { type: "tool_use", id: `t${n}`, name: "read", input: { path: "a.txt" } }] })
        : anthropicReply("all read", { model: "claude-think" });
    });
    const r = await shim.house("/v1/messages", { model: "agent/claude-think", max_tokens: 8000, stream: false, messages: [{ role: "user", content: "read a.txt again and again" }] }, H());
    assert.equal(r.status, 200, await r.clone().text());
    const evts = await eventsOf(String(r.headers.get("x-filament-request-id")));
    const sent = calls.filter((c) => !String(JSON.stringify(c.body.system || "")).includes("compaction summaries"));
    assert.ok(sent.some((c) => JSON.stringify(c.body.messages).includes("deep thought")), "the premise: signed thinking goes on the wire");
    assert.ok(evts.some((e) => e.type === "compacting") || sent.some((c) => c.body.max_tokens < 8000), "what is sent is counted: the line or the clamp was reached");
  });

  test("Claude's unsigned thinking (a translated reply's) is not counted: the shaping drops it before the wire", async () => {
    const calls = rounds((n) =>
      n <= 4
        ? anthropicReply("", { model: "claude-think", stop: "tool_use", blocks: [{ type: "thinking", thinking: THOUGHT }, { type: "tool_use", id: `u${n}`, name: "read", input: { path: "a.txt" } }] })
        : anthropicReply("all read", { model: "claude-think" }),
    );
    const r = await shim.house("/v1/messages", { model: "agent/claude-think", max_tokens: 8000, stream: false, messages: [{ role: "user", content: "read a.txt four times" }] }, H());
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(calls.length, 5);
    assert.ok(calls.every((c) => !JSON.stringify(c.body.messages).includes("deep thought")), "the premise: the unsigned blocks were dropped on the wire");
    // (fails before: yes)
    assert.deepEqual(calls.map((c) => c.body.max_tokens), [8000, 8000, 8000, 8000, 8000]);
    const evts = await eventsOf(String(r.headers.get("x-filament-request-id")));
    assert.ok(!evts.some((e) => e.type === "compacting"), "nothing folded");
  });
});

/** A Chat Completions reply whose message carries `reasoning_content`, as GLM sends its thinking. @param {any} reply @param {string} text */
function withReasoning(reply, text) {
  reply.json.choices[0].message.reasoning_content = text;
  return reply;
}
