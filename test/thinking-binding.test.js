// @ts-check
// Seen live 10-25: a sub-agent (the Hunter, Opus 5.5) failed at round 74, right after Filament folded its rounds 1–70 at
// the compaction line — "messages.3.content.0: Invalid `signature` in `thinking` block. The block is bound to a
// different conversation … Content that preceded this block when it was created is missing from this request". The
// provider binds each thinking block to the conversation before it as it was when the block was made: the kept rounds'
// blocks were bound to the rounds the summary took. Now every rewrite of the loop's conversation — a fold, the earlier
// turns given way, results cleared, an image withdrawn, a look tidied — leaves out the thinking of each reply after
// it, and a refusal for a bound block the loop did not foresee sends the round once more without its thinking. The
// stand-in provider here signs each block with the conversation before it, and refuses as the real one does.
// (fails before: yes — round 4, after the fold, was refused and the turn failed)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, parseSse } from "./helpers/app.js";
import { until, gate, removeDirs } from "./helpers/wait.js";
import { firstChange, unbindThinking } from "../src/app/agent/loop.js";

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const sysOf = (/** @type {any} */ b) => (Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b.system || ""));
const lastText = (/** @type {any} */ m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ c) => c?.type === "text").map((/** @type {any} */ c) => c.text).join("\n"));
const REFUSED = (/** @type {number} */ i) =>
  `messages.${i}.content.0: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. Remove the block, or set \`thinking.block_binding.prefix_mismatch_behavior\` to "drop_block".`;

/**
 * What a block is bound to: the conversation before it, as the provider reads it — its cache markers aside (they move
 * each request) and a message's text the same as one text block of it (the shaping makes one where a marker goes).
 * @param {any[]} messages
 */
const bindingOf = (messages) =>
  createHash("sha256")
    .update(JSON.stringify(messages.map((m) => ({ ...m, content: typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content })), (k, v) => (k === "cache_control" ? undefined : v)))
    .digest("hex")
    .slice(0, 24);
/** The first reply whose thinking was bound to another conversation, or -1. @param {any[]} messages */
function unboundAt(messages) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) if (b?.type === "thinking" && b.signature !== bindingOf(messages.slice(0, i))) return i;
  }
  return -1;
}

describe("unbindThinking and firstChange", () => {
  test("every reply's thinking from the rewrite on leaves, message by message; one that was only thinking keeps a line", () => {
    const think = { type: "thinking", thinking: "t", signature: "s" };
    const a1 = { role: "assistant", content: [think, toolUse("x", "read", {})] };
    const a2 = { role: "assistant", content: [{ type: "redacted_thinking", data: "d" }, { type: "text", text: "ok" }] };
    const a3 = { role: "assistant", content: [think] };
    const u = { role: "user", content: [{ type: "text", text: "go" }] };
    const convo = [u, a1, u, a2, u, a3];
    assert.equal(unbindThinking(convo, 2), 2);
    assert.equal(convo[1], a1, "before the rewrite: as it was");
    assert.deepEqual([convo[3].content, convo[5].content], [[{ type: "text", text: "ok" }], [{ type: "text", text: "(thinking)" }]]);
    assert.equal(a2.content.length, 2, "nothing shared changed in place");
    assert.equal(unbindThinking(convo, -1), 0, "no rewrite: nothing leaves");
    const was = [u, a1, u];
    assert.deepEqual([firstChange(was, [u, a1, u]), firstChange(was, [u, { ...a1 }, u]), firstChange(was, [u, a1]), firstChange(was, [u, a1, u, a2])], [-1, 1, 2, 3]);
  });
});

describe("a fold in a running turn, on a provider that binds its thinking", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {any[]} */
  const rounds = [];
  /** @type {number[]} */
  const refused = [];
  /** A refusal of the kind the loop cannot foresee: the next request with any thinking in it, once. */
  let refuseAny = false;
  const hold = gate();
  /** @param {any[]} blocks @param {any[]} messages @param {string} [stop] */
  const signed = (blocks, messages, stop = "end_turn") =>
    anthropicReply("", { model: "brain-model", stop, blocks: [{ type: "thinking", thinking: `thinking at ${messages.length}`, signature: bindingOf(messages) }, ...blocks] });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-bind-"));
    for (const f of ["a", "b", "c"]) writeFileSync(join(root, `${f}.txt`), `MARKER-${f.toUpperCase()} ${"words ".repeat(400)}`);
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const msgs = b.messages || [];
      const newest = lastText(msgs.at(-1));
      if (sysOf(b).includes("compaction summaries") || /^\[Filament: (this turn has reached the compaction line|the developer asked to compact this turn now)\./.test(newest))
        return anthropicReply("<summary>\nSUMMARY: read a and b.\n</summary>", { model: "brain-model" });
      const at = unboundAt(msgs);
      const anyThinking = msgs.some((/** @type {any} */ m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((/** @type {any} */ x) => x?.type === "thinking"));
      if (at >= 0 || (refuseAny && anyThinking)) {
        refuseAny = false;
        refused.push(rounds.length + 1);
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: REFUSED(Math.max(at, 1)) } } };
      }
      rounds.push(b);
      const n = rounds.length;
      if (n === 1) return signed([toolUse("r1", "read", { path: "a.txt" })], msgs, "tool_use");
      if (n === 2) return signed([toolUse("r2", "read", { path: "b.txt" })], msgs, "tool_use");
      if (n === 3) {
        await hold.promise;
        return signed([toolUse("r3", "read", { path: "c.txt" })], msgs, "tool_use");
      }
      if (n === 4) return signed([toolUse("r4", "read", { path: "a.txt" })], msgs, "tool_use");
      return signed([{ type: "text", text: "Done." }], msgs);
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    hold.open();
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  test("the kept round's thinking is left out with the fold, and the turn goes on; one the loop did not foresee is sent again without", async () => {
    const res = await shim.house(
      "/v1/messages",
      { model: "agent/brain-model", max_tokens: 400, stream: true, messages: [{ role: "user", content: "read a, b and c" }] },
      { "x-filament-cwd": root, "x-session-id": "bind-fold" },
    );
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(() => rounds.length === 3, "round 3's model call to be in flight");
    // Rounds 1–3 went with their signed thinking, unrefused: the provider's binding holds while nothing is rewritten.
    assert.deepEqual(refused, []);
    assert.ok(rounds[2].messages.some((/** @type {any} */ m) => m.role === "assistant" && m.content.some((/** @type {any} */ x) => x.type === "thinking")), "thinking went back unchanged");
    const s = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
    assert.equal(s.status, 200, await s.text());
    // Round 5 meets a refusal the loop did not foresee: the next request with thinking in it.
    refuseAny = true;
    hold.open();
    const raw = await body;
    const text = parseSse(raw).map((f) => f.data).filter((d) => d?.delta?.type === "text_delta").map((d) => d.delta.text).join("");
    assert.match(text, /Done\./, "the turn went on to its end");
    const r4 = rounds[3].messages;
    assert.ok(JSON.stringify(r4).includes("SUMMARY: read a and b."), "round 4 carries the summary");
    assert.equal(unboundAt(r4), -1, "nothing bound to the folded rounds went with round 4");
    assert.ok(!r4.some((/** @type {any} */ m) => m.role === "assistant" && m.content.some((/** @type {any} */ x) => x.type === "thinking")), "the kept round's thinking left with the fold");
    assert.deepEqual(refused, [5], "the fold's round was not refused; round 5's unforeseen refusal was, once");
    const r5 = rounds[4].messages;
    assert.ok(!r5.some((/** @type {any} */ m) => m.role === "assistant" && m.content.some((/** @type {any} */ x) => x.type === "thinking")), "sent again without its thinking");
    const rec = await shim.record(runId);
    const changes = (rec.changes || []).join("\n");
    assert.match(changes, /compacted rounds 1–2 of this turn on the developer's request.*, 1 thinking block of the kept rounds left out/);
    assert.match(changes, /round 5 was refused for a thinking block bound to an earlier form of the conversation \(messages\.\d+\.content\.0: Invalid `signature`.*\) — retrying once without its \d+ thinking blocks?/);
  });
});
