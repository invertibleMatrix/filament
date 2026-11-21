// @ts-check
// HarnessV3-FailurePoints §5.1 item 1 (2026-10-10): a sub-agent's running model call says how it goes — when it
// began, what has streamed and when its newest byte came — in its progress, which the lead's watch and the Team view
// read. In team_test a worker's call streamed thinking for ten minutes and its lead saw only "round 2".
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, removeDirs, fedStream } from "./helpers/wait.js";

const CHILD = "You are a sub-agent run by Filament";
const textOf = (/** @type {any} */ m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
const sse = (/** @type {string} */ event, /** @type {any} */ data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("a sub-agent's running model call, in its progress", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let folder;
  /** The child's call, held after its thinking streamed. */
  const held = fedStream([
    sse("message_start", { type: "message_start", message: { id: "msg_child", type: "message", role: "assistant", model: "m-1", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "x".repeat(4000) } }),
  ]);
  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-live-call-"));
    up = await fakeUpstream(async (call) => {
      const system = JSON.stringify(call.body?.system ?? "");
      const messages = call.body?.messages || [];
      const last = messages.at(-1);
      const answered = Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b?.type === "tool_result");
      const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model: call.body?.model || "m-1", stop, blocks: b, usage: { input_tokens: 5, output_tokens: 3 } });
      if (system.includes(CHILD) && /break at once/.test(textOf(messages[0])))
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "messages: a bad block" } } };
      if (system.includes(CHILD)) return /** @type {any} */ (held);
      if (answered) return blocks([{ type: "text", text: "PARENT DONE" }]);
      if (/run a failing child/.test(textOf(last)))
        return blocks([{ type: "tool_use", id: "toolu_b1", name: "agent", input: { run_in_background: false, description: "Failing child", prompt: "break at once" } }], "tool_use");
      if (/run a thinking child/.test(textOf(last)))
        return blocks([{ type: "text", text: "Launching." }, { type: "tool_use", id: "toolu_a1", name: "agent", input: { run_in_background: false, description: "Thinking child", prompt: "think long" } }], "tool_use");
      return blocks([{ type: "text", text: "PLAIN" }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
      },
    });
  });
  after(async () => {
    held.end();
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, folder);
  });

  // (fails before: yes — a sub-agent's progress said its round and nothing of the call it was in)
  test("while its call streams, the call's start, what has streamed and its newest byte; once its reply is in, none", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1" } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "run a thinking child", stream: true } });
    assert.equal(res.status, 200);
    const body = res.text();
    const subsOf = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents || [];
    const call = await until(async () => {
      const c = (await subsOf())[0]?.progress?.call;
      return c && c.thinking >= 4000 ? c : null;
    }, "the child's streamed thinking in its progress");
    assert.deepEqual([call.round, call.thinking, call.text], [1, 4000, 0]);
    assert.ok(call.lastAt >= call.began && call.began > 0, "when it began, and when its newest byte came");
    held.push(
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "CHILD REPORT" } }),
    );
    const said = await until(async () => {
      const c = (await subsOf())[0]?.progress?.call;
      return c && c.text >= 12 ? c : null;
    }, "the child's streamed text in its progress");
    assert.deepEqual([said.thinking, said.text], [4000, 12]);
    held.end(
      sse("content_block_stop", { type: "content_block_stop", index: 1 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }),
      sse("message_stop", { type: "message_stop" }),
    );
    assert.match(await body, /PARENT DONE/);
    const sa = await until(async () => {
      const x = (await subsOf())[0];
      return x && x.status !== "running" ? x : null;
    }, "the child to report");
    assert.deepEqual([sa.status, sa.progress], ["done", null], "a sub-agent that reported has no progress");
  });

  // (fails before: yes — a sub-agent's failure was kept on its outcome and never reached the surfaces: they had its
  // error's words alone; HarnessV3-FailurePoints §5.2)
  test("a sub-agent whose call fails says why in one shape, on its exchange", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1" } });
    const id = String((await s.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "run a failing child", stream: true } });
    assert.match(await res.text(), /PARENT DONE/);
    const sa = await until(async () => {
      const x = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents?.[0];
      return x && x.status !== "running" ? x : null;
    }, "the child to end");
    const [ex] = sa.exchanges;
    assert.equal(sa.status, "failed");
    assert.deepEqual([ex.failure?.what, ex.failure?.status], ["round 1's model call", 400]);
    assert.equal(ex.error, "round 1's model call to m-1 at m failed: messages: a bad block (HTTP 400).");
  });
});
