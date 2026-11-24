// @ts-check
// A model call through Filament's own front door folds its stream into the reply as the events come (anthropic-fold.js):
// the message `sseToJson` made of the whole stream's text at its end, with each event parsed once and the text never
// kept. A sub-agent's call streams its whole run; an agent round streams its reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { createAnthropicFold } from "../src/core/wire/anthropic-fold.js";
import { sseToJson } from "../src/core/wire/sse.js";
import { createInternalCall } from "../src/app/internal-call.js";

const sse = (/** @type {any} */ o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
const start = { type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "x", content: [], usage: { input_tokens: 3, output_tokens: 0 } } };
const whole = [
  start,
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me " } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "see." } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Reading " } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "it." } },
  { type: "content_block_delta", index: 7, delta: { type: "text_delta", text: "no block" } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: "read", input: {} } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path": ' } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"a.txt"}' } },
  { type: "content_block_stop", index: 2 },
  { type: "content_block_start", index: 3, content_block: { type: "tool_use", id: "t2", name: "bash", input: {} } },
  { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"command": ' } },
  { type: "content_block_stop", index: 3 },
  { type: "content_block_start", index: 4, content_block: { type: "tool_use", id: "t3", name: "glob", input: { pattern: "*" } } },
  { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 12 } },
  { type: "message_stop" },
];
/** The fold's reply for these events, and sseToJson's for their stream's text. @param {any[]} events */
const both = (events) => {
  const fold = createAnthropicFold();
  for (const e of events) fold.event(e);
  return { folded: fold.reply(), whole: sseToJson("anthropic", events.map(sse).join("")) };
};

// (fails before: yes — the module is new)
test("folded as the events come, a stream is the message sseToJson makes of its whole text: whole, cut short, empty, failed", () => {
  const cases = {
    whole,
    "no stop": whole.slice(0, -1),
    empty: [],
    "no start, no stop": whole.slice(1, -1),
    "error part-way, then more": [...whole.slice(0, 5), { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, ...whole.slice(5)],
    "error without words": [start, { type: "error" }],
    "a second start": [start, ...whole],
    "a delta before its message": [whole[1], start, ...whole.slice(2)],
  };
  for (const [name, events] of Object.entries(cases)) {
    const { folded, whole: expected } = both(events);
    assert.deepEqual(folded, expected, name);
  }
  assert.deepEqual(both(whole).folded.content.map((/** @type {any} */ b) => [b.type, b.text || b.thinking || b.input]), [
    ["thinking", "Let me see."],
    ["text", "Reading it."],
    ["tool_use", { path: "a.txt" }],
    ["tool_use", {}],
    ["tool_use", { pattern: "*" }],
  ]);
});

test("a stop with no message before it, and an event that is no object, are a stream with no message (sseToJson threw at them)", () => {
  const fold = createAnthropicFold();
  fold.event(null);
  fold.event(5);
  fold.event({ type: "message_stop" });
  assert.deepEqual(fold.reply(), { type: "error", error: { type: "api_error", message: "empty upstream stream" } });
});

// (fails before: yes — every event was parsed twice: once as it came, once more in the whole text at the end)
test("through the front door each streamed event is parsed once, and the call's message is whole", async () => {
  const events = whole;
  const door = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // In two pieces, one cutting an event in half.
      const body = events.map(sse).join("") + "data: [DONE]\n\n";
      const cut = Math.floor(body.length / 2);
      res.write(body.slice(0, cut));
      setTimeout(() => res.end(body.slice(cut)), 5);
    });
  });
  await new Promise((r) => door.listen(0, "127.0.0.1", () => r(undefined)));
  const was = JSON.parse;
  /** @type {Map<string, number>} */
  const parsed = new Map();
  JSON.parse = /** @type {any} */ ((/** @type {any[]} */ ...a) => {
    if (typeof a[0] === "string" && a[0].startsWith('{"type":')) parsed.set(a[0], (parsed.get(a[0]) || 0) + 1);
    return was.apply(JSON, /** @type {any} */ (a));
  });
  try {
    const port = /** @type {import("node:net").AddressInfo} */ (door.address()).port;
    const call = createInternalCall({ config: () => ({ server: { port } }), log: () => {} });
    /** @type {string[]} */
    const text = [];
    const r = await call({ body: { model: "x", messages: [] }, onDelta: (d) => text.push(`${d.kind}:${d.text}`) });
    JSON.parse = was;
    assert.equal(r.ok, true);
    assert.deepEqual(r.json, sseToJson("anthropic", events.map(sse).join("")));
    assert.deepEqual(text, ["thinking:Let me ", "thinking:see.", "signature:sig", "text:Reading ", "text:it.", "text:no block"]);
    assert.equal(parsed.size, events.length, "every event came");
    assert.deepEqual([...new Set(parsed.values())], [1], "each parsed once");
  } finally {
    JSON.parse = was;
    await new Promise((r) => door.close(() => r(undefined)));
  }
});

// (fails before: yes — the bug hunt of 10-30: a line of the reply was held whole however long it ran)
test("a reply with a line past 64 MiB is the call's failure, in words: that line's event is lost, and the reply with it", { timeout: 120_000 }, async () => {
  const piece = "x".repeat(2 ** 20);
  const door = http.createServer((req, res) => {
    req.resume();
    req.on("end", async () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write([start, whole[6]].map(sse).join(""));
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"');
      for (let i = 0; i < 65; i++) if (!res.write(piece)) await once(res, "drain");
      res.write('"}}\n\n');
      res.end([whole[10], whole.at(-2), whole.at(-1)].map(sse).join(""));
    });
  });
  await new Promise((r) => door.listen(0, "127.0.0.1", () => r(undefined)));
  try {
    const port = /** @type {import("node:net").AddressInfo} */ (door.address()).port;
    /** @type {string[]} */
    const logged = [];
    const r = await createInternalCall({ config: () => ({ server: { port } }), log: (level, msg) => logged.push(`${level} ${msg}`) })({ body: { model: "x", messages: [] }, onDelta: () => {} });
    const words = "the reply had a line of 65 MiB, past the 64 MiB Filament reads of one: it was dropped unread, and the reply with it";
    assert.deepEqual([r.ok, r.status, r.inStream, r.json?.error?.message], [false, 502, true, words]);
    assert.deepEqual(logged, [`warn internal call: ${words}`]);
  } finally {
    await new Promise((r) => door.close(() => r(undefined)));
  }
});

test("an error inside a 200 stream is still the call's failure, at the status its type stands for", async () => {
  const door = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end([start, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }].map(sse).join(""));
    });
  });
  await new Promise((r) => door.listen(0, "127.0.0.1", () => r(undefined)));
  try {
    const port = /** @type {import("node:net").AddressInfo} */ (door.address()).port;
    const r = await createInternalCall({ config: () => ({ server: { port } }), log: () => {} })({ body: { model: "x", messages: [] }, onDelta: () => {} });
    assert.deepEqual([r.ok, r.status, r.inStream, r.json.error.message], [false, 529, true, "Overloaded"]);
  } finally {
    await new Promise((r) => door.close(() => r(undefined)));
  }
});
