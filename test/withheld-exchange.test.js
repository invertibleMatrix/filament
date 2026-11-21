// @ts-check
// BUG-11 (FILAMENT Bug Tracker, 2026-09-30): a memory tool round is withheld from the client, which is shown ONE
// assistant message — [thinking A, thinking B, Bash] — where the model wrote [thinking A, memory call] → Filament's
// results → [thinking B, Bash]. Sent back merged, Anthropic refused it ("thinking blocks in the latest assistant
// message cannot be modified": sub-agent run muo6affs died at round 48 after $4.62), and every provider's prompt cache
// missed from that message on. The exchange is now recorded when the reply ends and put back, exactly, on the wire.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeExchange, restoreMessages, anchorsOf } from "../src/core/withheld.js";
import { createWithheldStore } from "../src/services/memory/withheld-store.js";
import { sseToJson } from "../src/core/wire/sse.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

const thinkA = { type: "thinking", thinking: "I should look this up first.", signature: "SIG_A_the_first_round" };
const thinkB = { type: "thinking", thinking: "Found it; now run the command.", signature: "SIG_B_the_second_round" };
const memCall = { type: "tool_use", id: "toolu_mem1", name: "filament_memory_search", input: { query: "prior notes" } };
const bash = { type: "tool_use", id: "toolu_bash1", name: "Bash", input: { command: "ls" } };
const prefix = [
  { role: "assistant", content: [thinkA, memCall] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_mem1", content: "the notes" }] },
];
/** A lookup over one described exchange, as the store answers it. */
const lookupOf = (/** @type {any} */ d, /** @type {any[]} */ pre, rounds = 1) => (/** @type {string[]} */ anchors) =>
  new Map(anchors.filter((a) => d.anchors.includes(a)).map((a) => [a, { shape: { ...d.shape, rounds }, prefix: pre }]));
const user = (text) => ({ role: "user", content: text });
const bashResult = { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_bash1", content: "file.txt" }] };

describe("the withheld exchange, pure", () => {
  test("anthropic: the merged message becomes the model's true sequence, and only that message changes", () => {
    const d = describeExchange({ format: "anthropic", head: [thinkA], final: [thinkB, bash] });
    assert.ok(d, "signed thinking and a tool call anchor it");
    const merged = { role: "assistant", content: [thinkA, thinkB, bash] };
    const messages = [user("check memory, then run ls"), merged, bashResult];
    const r = restoreMessages("anthropic", messages, lookupOf(d, prefix));
    assert.equal(r.restored, 1);
    assert.deepEqual(r.messages, [messages[0], prefix[0], prefix[1], { role: "assistant", content: [thinkB, bash] }, bashResult]);
    assert.equal(r.messages.filter((m) => m.role === "assistant" && m.content.filter((b) => b.type === "thinking").length > 1).length, 0, "no assistant turn carries two rounds' thinking");
    assert.deepEqual(messages[1], merged, "the input is never mutated");
    assert.notEqual(r.messages[2], prefix[1], "the store's messages are copied, so later stages may edit what they get");
  });

  test("anthropic: the client's own bytes of the last round are kept (its cache marker); an edited message is left alone", () => {
    const d = describeExchange({ format: "anthropic", head: [thinkA], final: [thinkB, bash] });
    const marked = { ...bash, cache_control: { type: "ephemeral" } };
    let r = restoreMessages("anthropic", [user("go"), { role: "assistant", content: [thinkA, thinkB, marked] }, bashResult], lookupOf(d, prefix));
    assert.equal(r.restored, 1);
    assert.deepEqual(r.messages[3].content[1], marked);
    // Edited, trimmed or grown: not exactly what the client was shown, so it goes out as sent.
    for (const content of [[thinkA, bash], [thinkA, thinkB, bash, { type: "text", text: "extra" }], [{ ...thinkA, signature: "OTHER" }, thinkB, bash]]) {
      r = restoreMessages("anthropic", [user("go"), { role: "assistant", content }, bashResult], lookupOf(d, prefix));
      assert.equal(r.restored, 0, JSON.stringify(content.map((b) => b.type)));
    }
  });

  test("restoring twice changes nothing — also when the first round showed the client nothing at all", () => {
    let d = describeExchange({ format: "anthropic", head: [thinkA], final: [thinkB, bash] });
    let once = restoreMessages("anthropic", [user("go"), { role: "assistant", content: [thinkA, thinkB, bash] }, bashResult], lookupOf(d, prefix));
    assert.equal(restoreMessages("anthropic", once.messages, lookupOf(d, prefix)).restored, 0);
    const bare = [{ role: "assistant", content: [memCall] }, prefix[1]];
    d = describeExchange({ format: "anthropic", head: [], final: [thinkB, bash] });
    once = restoreMessages("anthropic", [user("go"), { role: "assistant", content: [thinkB, bash] }, bashResult], lookupOf(d, bare));
    assert.equal(once.restored, 1);
    assert.equal(once.messages.length, 5);
    assert.equal(restoreMessages("anthropic", once.messages, lookupOf(d, bare)).restored, 0, "already in its true form");
  });

  test("openai: the merged text is split back at the round boundary, the tool calls stay the client's", () => {
    const head = [{ type: "text", text: "Let me check my notes. " }];
    const final = [{ type: "text", text: "Running it." }, { type: "tool_use", id: "call_9", name: "shell", input: {} }];
    const d = describeExchange({ format: "openai", head, final });
    assert.ok(d);
    const pre = [
      { role: "assistant", content: "Let me check my notes. ", tool_calls: [{ id: "call_m", type: "function", function: { name: "filament_memory_search", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_m", content: "the notes" },
    ];
    const merged = { role: "assistant", content: "Let me check my notes. Running it.", tool_calls: [{ id: "call_9", type: "function", function: { name: "shell", arguments: "{}" } }] };
    const r = restoreMessages("openai", [user("go"), merged, { role: "tool", tool_call_id: "call_9", content: "ok" }], lookupOf(d, pre));
    assert.equal(r.restored, 1);
    assert.deepEqual(r.messages.slice(1, 4), [pre[0], pre[1], { ...merged, content: "Running it." }]);
    const edited = { ...merged, content: "Let me check my notes. Ran it." };
    assert.equal(restoreMessages("openai", [user("go"), edited], lookupOf(d, pre)).restored, 0);
  });

  test("text alone never anchors an exchange: \"Done.\" is in a thousand conversations", () => {
    assert.equal(describeExchange({ format: "anthropic", head: [{ type: "text", text: "Checking." }], final: [{ type: "text", text: "Done." }] }), null);
    assert.equal(describeExchange({ format: "openai", head: [], final: [{ type: "text", text: "Done." }] }), null);
    assert.deepEqual(anchorsOf("anthropic", { role: "assistant", content: [{ type: "text", text: "Done." }] }), []);
  });
});

/** An Anthropic SSE body for these blocks (thinking with its signature, tool calls with their input). */
function sseOf(/** @type {any[]} */ blocks, stop) {
  const ev = (/** @type {string} */ event, /** @type {any} */ data) => ({ event, data: { type: event, ...data } });
  const out = [ev("message_start", { message: { id: `msg_${Math.random().toString(36).slice(2, 8)}`, type: "message", role: "assistant", model: "m-1", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 30, output_tokens: 1 } } })];
  blocks.forEach((b, index) => {
    if (b.type === "thinking") {
      out.push(ev("content_block_start", { index, content_block: { type: "thinking", thinking: "" } }));
      out.push(ev("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } }));
      out.push(ev("content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } }));
    } else if (b.type === "tool_use") {
      out.push(ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }));
      out.push(ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }));
    } else {
      out.push(ev("content_block_start", { index, content_block: { type: "text", text: "" } }));
      out.push(ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } }));
    }
    out.push(ev("content_block_stop", { index }));
  });
  out.push(ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 9 } }));
  out.push(ev("message_stop", {}));
  return { sse: out };
}
/** @param {any} v */
// Cache markers aside, and the text block a marked string message becomes: the same words to the provider, whose mark
// moves every request (a message marked as the request before's last one goes back to its string after).
const noMarkers = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === "cache_control" ? undefined : k === "content" && typeof x === "string" ? [{ type: "text", text: x }] : x)));

describe("the withheld exchange, through the front door", () => {
  // Each variant has its own signatures and call ids. The store keys on them, so a streamed run sharing the JSON run's
  // ids was answered from the JSON run's capture and passed with its own capture removed (the owner's other agent
  // found it by undoing that capture).
  /** @param {"json" | "sse"} tag */
  const fixturesFor = (tag) => {
    const sh = { ...bash, id: `${bash.id}_${tag}` };
    return {
      thinkA: { ...thinkA, signature: `${thinkA.signature}_${tag}` },
      thinkB: { ...thinkB, signature: `${thinkB.signature}_${tag}` },
      memCall: { ...memCall, id: `${memCall.id}_${tag}` },
      bash: sh,
      bashResult: { role: "user", content: [{ type: "tool_result", tool_use_id: sh.id, content: "file.txt" }] },
    };
  };
  const fx = { json: fixturesFor("json"), sse: fixturesFor("sse") };
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-withheld-"));
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const last = b.messages?.at(-1);
      const results = Array.isArray(last?.content) ? last.content.filter((c) => c?.type === "tool_result").map((c) => c.tool_use_id) : [];
      const f = JSON.stringify(b.messages?.[0] ?? "").includes("[sse]") ? fx.sse : fx.json;
      // Round 2 of the first request: memory answered; the model thinks again and asks the client to run Bash.
      const blocks = results.includes(f.memCall.id)
        ? [f.thinkB, f.bash]
        : results.includes(f.bash.id)
          ? [{ type: "text", text: "All done." }]
          : [f.thinkA, f.memCall];
      const stop = blocks.some((x) => x.type === "tool_use") ? "tool_use" : "end_turn";
      return b.stream ? sseOf(blocks, stop) : anthropicReply("", { model: "m-1", stop, blocks });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { ...cfg.memory.autopilot, enabled: true, tools: true, briefingTokens: 400, turnTokens: 0, cue: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });
  const ask = (sid, messages, stream) =>
    shim.post(
      "/v1/messages",
      {
        model: "m-1",
        max_tokens: 2048,
        stream,
        thinking: { type: "enabled", budget_tokens: 1024 },
        tools: [{ name: "Bash", description: "Run a command", input_schema: { type: "object", properties: { command: { type: "string" } } } }],
        messages,
      },
      { "x-session-id": sid, "x-filament-cwd": root, "user-agent": "opencode/1.0" },
    );

  for (const stream of [false, true]) {
    // (fails before: the continuation went upstream as [thinking A, thinking B, Bash] — the 400 of run muo6affs)
    test(`${stream ? "streamed" : "JSON"} reply: the continuation goes upstream as the model's true sequence, byte for byte what the follow-up sent`, async () => {
      up.reset();
      const tag = stream ? "sse" : "json";
      const f = fx[tag];
      const sid = `withheld-${tag}`;
      const first = [user(`check your notes, then run ls [${tag}]`)];
      const r1 = await ask(sid, first, stream);
      assert.equal(r1.status, 200, await r1.clone().text());
      const reply = stream ? sseToJson("anthropic", await r1.text()) : await r1.json();
      assert.ok(up.received[0].body.tools.some((t) => t.name === "filament_memory_search"), "memory's tools ride the request");
      assert.deepEqual(reply.content.map((b) => b.type), ["thinking", "thinking", "tool_use"], "the client is shown the merged message, memory's call withheld");
      const followUp = up.received[1].body.messages;
      assert.equal(up.received.length, 2, "one memory round");

      const r2 = await ask(sid, [...first, { role: "assistant", content: reply.content }, f.bashResult], false);
      assert.equal(r2.status, 200, await r2.clone().text());
      const sent = up.received[2].body.messages;
      const assistants = sent.filter((m) => m.role === "assistant");
      assert.ok(assistants.every((m) => m.content.filter((b) => b.type === "thinking").length <= 1), `no assistant turn carries two rounds' thinking: ${JSON.stringify(assistants.map((m) => m.content.map((b) => b.type)))}`);
      // The withheld pair is exactly what the follow-up appended (cache markers aside: they move every request).
      const at = sent.findIndex((m) => m.role === "assistant" && m.content.some((b) => b.id === f.memCall.id));
      assert.ok(at > 0, "the memory call is back where the model made it");
      assert.deepEqual(noMarkers(sent.slice(at, at + 2)), noMarkers(followUp.slice(-2)), "byte for byte what the upstream saw in the follow-up");
      assert.deepEqual(noMarkers(sent[at + 2]), { role: "assistant", content: [f.thinkB, f.bash] }, "then the model's own last reply");
      assert.deepEqual(noMarkers(sent.slice(0, at)), noMarkers(followUp.slice(0, at)), "and the prefix before it is unchanged");
      const rec = await shim.record(r2.headers.get("x-filament-request-id"));
      assert.ok((rec.changes || []).some((c) => /put back 1 memory exchange/.test(c)), `the record says so: ${JSON.stringify(rec.changes)}`);
    });
  }
});

// HarnessV3-FixRound F4 item 20 — BUG-11's follow-ups.
const CUE = "Related: you worked on the parser in session a1b2 (load it with filament_recall).";
const NOTE = "Since your last message here, this session went on in another window: 2 turns.";
describe("the withheld exchange: BUG-11a, the lines Filament puts in front of the reply", () => {
  const head = [thinkA];
  const final = [thinkB, { type: "text", text: "Running it now." }, bash];
  // (fails before: the client's first text carried the cue, its fingerprint was the model's own, so it never matched)
  test("anthropic: a cue in front of the first text is taken off before the match, and off what goes upstream", () => {
    const d = describeExchange({ format: "anthropic", head, final, lead: [CUE, NOTE] });
    for (const text of [`${CUE}\n\nRunning it now.`, `${NOTE}\n\n${CUE}\n\nRunning it now.`]) {
      const merged = { role: "assistant", content: [thinkA, thinkB, { type: "text", text }, bash] };
      const r = restoreMessages("anthropic", [user("go"), merged, bashResult], lookupOf(d, prefix));
      assert.equal(r.restored, 1, JSON.stringify(text));
      assert.deepEqual(r.messages[3], { role: "assistant", content: final }, "the model's own last reply: no cue, no note");
    }
  });

  test("anthropic: a cue that came as a block of its own (a reply with no text) is dropped before the match", () => {
    const quiet = [thinkB, bash];
    const d = describeExchange({ format: "anthropic", head, final: quiet, lead: [CUE] });
    const merged = { role: "assistant", content: [{ type: "text", text: CUE }, thinkA, thinkB, bash] };
    const r = restoreMessages("anthropic", [user("go"), merged, bashResult], lookupOf(d, prefix));
    assert.equal(r.restored, 1);
    assert.deepEqual(r.messages[3], { role: "assistant", content: quiet });
  });

  test("only a recorded line comes off: other text in front still makes the message the client's own", () => {
    const d = describeExchange({ format: "anthropic", head, final, lead: [CUE] });
    const edited = { role: "assistant", content: [thinkA, thinkB, { type: "text", text: "Something I added.\n\nRunning it now." }, bash] };
    assert.equal(restoreMessages("anthropic", [user("go"), edited, bashResult], lookupOf(d, prefix)).restored, 0);
    const bare = describeExchange({ format: "anthropic", head, final });
    const cued = { role: "assistant", content: [thinkA, thinkB, { type: "text", text: `${CUE}\n\nRunning it now.` }, bash] };
    assert.equal(restoreMessages("anthropic", [user("go"), cued, bashResult], lookupOf(bare, prefix)).restored, 0, "no line recorded: nothing comes off");
  });

  test("openai: the cue in front of the merged text is taken off before it is split back", () => {
    const h = [{ type: "text", text: "Let me check my notes. " }];
    const f = [{ type: "text", text: "Running it." }, { type: "tool_use", id: "call_c9", name: "shell", input: {} }];
    const d = describeExchange({ format: "openai", head: h, final: f, lead: [CUE] });
    const pre = [
      { role: "assistant", content: "Let me check my notes. ", tool_calls: [{ id: "call_cm", type: "function", function: { name: "filament_memory_search", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_cm", content: "the notes" },
    ];
    const merged = { role: "assistant", content: `${CUE}\n\nLet me check my notes. Running it.`, tool_calls: [{ id: "call_c9", type: "function", function: { name: "shell", arguments: "{}" } }] };
    const r = restoreMessages("openai", [user("go"), merged, { role: "tool", tool_call_id: "call_c9", content: "ok" }], lookupOf(d, pre));
    assert.equal(r.restored, 1);
    assert.deepEqual(r.messages[3], { ...merged, content: "Running it." });
  });

  test("the loop records the cue as the line a match takes off", () => {
    const src = readFileSync(new URL("../src/app/pipeline/dispatch/memory-loop.js", import.meta.url), "utf8");
    const fin = src.slice(src.indexOf("const finishWithheld = "), src.indexOf("const followUp = "));
    assert.match(fin, /const lead = memCueSentence \? \[memCueSentence\] : \[\];/);
    assert.match(fin, /store\.put\(\{[^}]*\blead\b/);
  });
});

describe("the withheld exchange: BUG-11c, a last round that called the client's tools", () => {
  // (fails before: the restore spliced in a trailing tool_use that nothing answered)
  test("anthropic: put back only before the answers to the last round's tool calls", () => {
    const d = describeExchange({ format: "anthropic", head: [thinkA], final: [thinkB, bash] });
    const merged = { role: "assistant", content: [thinkA, thinkB, bash] };
    assert.equal(restoreMessages("anthropic", [user("go"), merged, user("never mind, stop")], lookupOf(d, prefix)).restored, 0, "the next message does not answer it");
    assert.equal(restoreMessages("anthropic", [user("go"), merged], lookupOf(d, prefix)).restored, 0, "nothing after it");
    const partly = { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_other", content: "x" }] };
    assert.equal(restoreMessages("anthropic", [user("go"), merged, partly], lookupOf(d, prefix)).restored, 0, "answers to other calls do not count");
    assert.equal(restoreMessages("anthropic", [user("go"), merged, bashResult], lookupOf(d, prefix)).restored, 1);
    const said = describeExchange({ format: "anthropic", head: [thinkA], final: [thinkB, { type: "text", text: "All set." }] });
    assert.equal(restoreMessages("anthropic", [user("go"), { role: "assistant", content: [thinkA, thinkB, { type: "text", text: "All set." }] }, user("thanks")], lookupOf(said, prefix)).restored, 1, "a last round with no tool call goes back before anything");
  });

  test("openai: every tool call of the last round needs its tool message after it", () => {
    const h = [{ type: "text", text: "Checking. " }];
    const f = [{ type: "text", text: "Running both." }, { type: "tool_use", id: "call_a", name: "shell", input: {} }, { type: "tool_use", id: "call_b", name: "shell", input: {} }];
    const d = describeExchange({ format: "openai", head: h, final: f });
    const pre = [{ role: "assistant", content: "Checking. ", tool_calls: [{ id: "call_mm", type: "function", function: { name: "filament_memory_search", arguments: "{}" } }] }, { role: "tool", tool_call_id: "call_mm", content: "n" }];
    const merged = { role: "assistant", content: "Checking. Running both.", tool_calls: ["call_a", "call_b"].map((id) => ({ id, type: "function", function: { name: "shell", arguments: "{}" } })) };
    const tool = (/** @type {string} */ id) => ({ role: "tool", tool_call_id: id, content: "ok" });
    assert.equal(restoreMessages("openai", [user("go"), merged, tool("call_a"), user("hm")], lookupOf(d, pre)).restored, 0, "one of two answered");
    assert.equal(restoreMessages("openai", [user("go"), merged, tool("call_a"), tool("call_b")], lookupOf(d, pre)).restored, 1);
  });
});

describe("the withheld exchange: BUG-11b, a reply that stopped at the round limit or a failed follow-up", () => {
  /** @param {string} tag */
  const fixtures = (tag) => ({
    a: { type: "thinking", thinking: "Round one.", signature: `SIG_1_${tag}` },
    b: { type: "thinking", thinking: "Round two.", signature: `SIG_2_${tag}` },
    c: { type: "thinking", thinking: "Round three.", signature: `SIG_3_${tag}` },
    m: [1, 2, 3].map((i) => ({ type: "tool_use", id: `toolu_m${i}_${tag}`, name: "filament_memory_search", input: { query: `q${i}` } })),
  });
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-withheld-b-"));
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const opener = JSON.stringify(b.messages?.[0] ?? "");
      const tag = /\[(\w+)\]/.exec(opener)?.[1] || "x";
      const f = fixtures(tag);
      const lastSays = JSON.stringify(b.messages?.at(-1) ?? "");
      // Every round asks memory again: the "limit" variants run into the round limit (2), and the "fail" one's second
      // follow-up fails, its provider out of reach.
      /** @type {any[]} */
      let blocks;
      if (lastSays.includes(f.m[1].id)) {
        if (tag.startsWith("fail")) return { drop: true };
        blocks = [f.c, { type: "text", text: "Partial answer." }, f.m[2]];
      } else if (lastSays.includes(f.m[0].id)) blocks = tag.startsWith("fail") ? [f.b, { type: "text", text: "Partial answer." }, f.m[1]] : [f.b, f.m[1]];
      else if (b.messages?.length === 1) blocks = [f.a, f.m[0]];
      else blocks = [{ type: "text", text: "Carrying on." }];
      const stop = blocks.some((x) => x.type === "tool_use") ? "tool_use" : "end_turn";
      return b.stream ? sseOf(blocks, stop) : anthropicReply("", { model: "m-1", stop, blocks });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { ...cfg.memory.autopilot, enabled: true, tools: true, toolIterations: 2, briefingTokens: 400, turnTokens: 0, cue: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  });
  const ask = (/** @type {string} */ sid, /** @type {any[]} */ messages, /** @type {boolean} */ stream) =>
    shim.post("/v1/messages", { model: "m-1", max_tokens: 2048, stream, thinking: { type: "enabled", budget_tokens: 1024 }, messages }, { "x-session-id": sid, "x-filament-cwd": root, "user-agent": "opencode/1.0" });

  // A JSON reply whose follow-up failed shows its client none of the rounds, only the failure (follow-up-abort.test.js):
  // it has no merged message to put back. A stream had shown the rounds before the follow-up failed.
  for (const [stream, kind] of /** @type {const} */ ([[false, "limit"], [true, "limit"], [true, "fail"]])) {
      // (fails before: only a last round that came back whole was recorded, so these went back merged — every
      // round's thinking in one assistant turn, the 400 BUG-11 was about)
      test(`${stream ? "streamed" : "JSON"} reply, ${{ limit: "the round limit", fail: "a failed follow-up" }[kind]}: the continuation goes upstream as the model's true sequence`, async () => {
        const tag = `${kind}${stream ? "s" : "j"}`;
        const f = fixtures(tag);
        const first = [user(`dig through your notes [${tag}]`)];
        const r1 = await ask(`withheld-b-${tag}`, first, stream);
        assert.equal(r1.status, 200, await r1.clone().text());
        // What the client was shown and keeps: every round's visible blocks, memory's calls taken out.
        const shown = kind === "limit" ? [f.a, f.b, f.c, { type: "text", text: "Partial answer." }] : [f.a, f.b, { type: "text", text: "Partial answer." }];
        if (!stream) assert.deepEqual(noMarkers((await r1.json()).content), shown);
        const mark = up.received.length;
        const r2 = await ask(`withheld-b-${tag}`, [...first, { role: "assistant", content: shown }, user("go on")], false);
        assert.equal(r2.status, 200, await r2.clone().text());
        const sent = up.received.slice(mark)[0].body.messages;
        const assistants = sent.filter((/** @type {any} */ m) => m.role === "assistant");
        assert.ok(assistants.every((/** @type {any} */ m) => m.content.filter((/** @type {any} */ b) => b.type === "thinking").length <= 1), `no assistant turn carries two rounds' thinking: ${JSON.stringify(assistants.map((/** @type {any} */ m) => m.content.map((/** @type {any} */ b) => b.type)))}`);
        assert.deepEqual(noMarkers(assistants.at(-1)), { role: "assistant", content: shown.slice(kind === "limit" ? 2 : 1) }, "the last round as the client saw it");
        assert.ok(sent.some((/** @type {any} */ m) => m.role === "assistant" && m.content.some((/** @type {any} */ b) => b.id === f.m[0].id)), "the first memory call is back where the model made it");
        if (kind === "fail") assert.ok(!sent.some((/** @type {any} */ m) => JSON.stringify(m).includes(f.m[1].id)), "the failed round's own call is not: its follow-up never came back");
        // The rounds put back: both at the limit; the round before the failed follow-up.
        const rec = await shim.record(String(r2.headers.get("x-filament-request-id")));
        const n = kind === "limit" ? "2 rounds" : "1 round";
        assert.ok((rec.changes || []).some((/** @type {string} */ c) => c.includes(`put back 1 memory exchange withheld from the client (${n})`)), JSON.stringify(rec.changes));
      });
    }
});

test("the store keeps the lines a match takes off with the exchange it records", () => {
  /** @type {Map<string, any>} */
  const msgs = new Map();
  /** @type {Map<string, string>} */
  const rows = new Map();
  const archive = {
    putMessage: (/** @type {string} */ _role, /** @type {any} */ m) => {
      const hash = `h${msgs.size}`;
      msgs.set(hash, structuredClone(m));
      return { hash, truncated: false };
    },
    putWithheld: (/** @type {string[]} */ anchors, /** @type {string} */ json) => anchors.forEach((a) => rows.set(a, json)),
    withheldFor: (/** @type {string[]} */ list) => new Map(list.filter((a) => rows.has(a)).map((a) => [a, JSON.parse(String(rows.get(a)))])),
    getMessage: (/** @type {string} */ h) => (msgs.has(h) ? { message: msgs.get(h) } : null),
  };
  const final = [thinkB, { type: "text", text: "Running it now." }, bash];
  assert.equal(createWithheldStore(archive).put({ format: "anthropic", prefix, head: [thinkA], final, rounds: 1, lead: [CUE] }), true);
  const merged = { role: "assistant", content: [thinkA, thinkB, { type: "text", text: `${CUE}\n\nRunning it now.` }, bash] };
  const fresh = createWithheldStore(archive);
  const r = restoreMessages("anthropic", [user("go"), merged, bashResult], (a) => fresh.lookup(a));
  assert.equal(r.restored, 1, "read back from the archive, the line still comes off");
});
