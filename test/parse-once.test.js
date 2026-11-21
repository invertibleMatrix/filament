// A streamed reply's events are parsed once on their way through Filament, and the reply memory archives is folded as
// the events go out instead of kept as text and parsed again at the end. Every reader hands what it parsed of a piece of
// the text to the next reader of the same piece (core/wire/sse.js `parseKnown`); a payload it was not handed — an
// event a stage wrote — it parses itself, so what each reader makes of the stream is what it always did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSseFold, sseToJson, parseKnown } from "../src/core/wire/sse.js";
import { createSseScanner, pipeStream } from "../src/adapters/providers/http.js";
import { createAnthropicToOpenaiStream } from "../src/core/wire/translate.js";
import { createMemoryToolStream } from "../src/app/memory-tools.js";

const ev = (/** @type {any} */ o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
/** An Anthropic reply of `n` words, as an upstream streams it. @param {number} n */
const anthropicStream = (n) =>
  [
    ev({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], usage: { input_tokens: 9, output_tokens: 0 } } }),
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ...Array.from({ length: n }, (_, i) => ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `word${i} ` } })),
    ev({ type: "content_block_stop", index: 0 }),
    ev({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: n } }),
    ev({ type: "message_stop" }),
  ].join("");
/** @param {string} s @param {number} size */
const cut = (s, size) => Array.from({ length: Math.ceil(s.length / size) }, (_, i) => s.slice(i * size, (i + 1) * size));

/** JSON.parse counted while `fn` runs. @param {() => void | Promise<void>} fn */
async function parses(fn) {
  const real = JSON.parse;
  let n = 0;
  JSON.parse = /** @type {any} */ ((/** @type {any[]} */ ...a) => (n++, real.apply(JSON, /** @type {any} */ (a))));
  try {
    await fn();
  } finally {
    JSON.parse = real;
  }
  return n;
}

test("parseKnown takes the value for the very payload it was handed, and parses anything else", () => {
  const a = JSON.stringify({ a: 1 });
  const known = /** @type {[string, any][]} */ ([[a, { a: "handed" }]]);
  const parse = parseKnown(known);
  assert.deepEqual(parse('{"b":2}'), { b: 2 }, "not handed: parsed");
  assert.deepEqual(parse(a), { a: "handed" }, "handed: taken");
  assert.deepEqual(parse(a), { a: 1 }, "each handed value is taken once, in order");
  assert.throws(() => parseKnown(null)("{"), SyntaxError);
});

test("the fold answers what sseToJson answers for the whole text — an ending it was not handed put in mid-stream, mid-line too", () => {
  const ending = ev({ type: "content_block_stop", index: 0 }) + ev({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }) + ev({ type: "message_stop" });
  const stream = anthropicStream(6).split("event: message_delta")[0]; // cut before its end: the ending put in ends it
  for (const size of [5, 17, 4096])
    for (const at of [0, 3, 7]) {
      const pieces = cut(stream, size);
      const scanner = createSseScanner("anthropic");
      const fold = createSseFold("anthropic");
      let kept = "";
      pieces.forEach((p, i) => {
        scanner.feed(p);
        fold.feed(p, scanner.parsed);
        kept += p;
        if (i === Math.min(at, pieces.length - 1)) {
          fold.feed(ending);
          kept += ending;
        }
      });
      scanner.end();
      fold.end(scanner.parsed);
      assert.deepEqual(fold.reply(), sseToJson("anthropic", kept), `cut every ${size}, the ending after piece ${at}`);
    }
});

test("Chat Completions and Responses: the fold is sseToJson's, a payload its fold cannot read included", () => {
  const chunk = (/** @type {any} */ o) => `data: ${JSON.stringify(o)}\n\n`;
  const openai = [chunk({ id: "c", choices: [{ index: 0, delta: { role: "assistant", content: "hé" } }] }), chunk({ id: "c", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "t", function: { name: "f", arguments: "{}" } }] } }] }), chunk({ id: "c", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1 } }), "data: [DONE]\n\n"].join("");
  const responses = [chunk({ type: "response.created", response: { id: "r" } }), chunk({ type: "response.completed", response: { id: "r", status: "completed", output: [] } })].join("");
  for (const [format, text] of /** @type {const} */ ([["openai", openai], ["responses", responses], ["openai", `${openai}data: null\n\n`], ["responses", "data: 5\n\n"]])) {
    const fold = createSseFold(format);
    for (const p of cut(text, 11)) fold.feed(p);
    fold.end();
    let whole, folded;
    try {
      whole = { reply: sseToJson(format, text) };
    } catch (e) {
      whole = { threw: String(e) };
    }
    try {
      folded = { reply: fold.reply() };
    } catch (e) {
      folded = { threw: String(e) };
    }
    assert.deepEqual(folded, whole, `${format}: ${text.slice(-20)}`);
  }
});

test("a JSON reply read from a stream: the fold reads the bytes as Buffer decodes them, a leading BOM and all", async () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const body = new TextEncoder().encode(anthropicStream(3));
  for (const bytes of [body, new Uint8Array([...bom, ...body])]) {
    const pieces = Array.from({ length: Math.ceil(bytes.length / 7) }, (_, i) => bytes.slice(i * 7, (i + 1) * 7));
    const res = () => new Response(new ReadableStream({ start: (c) => (pieces.forEach((p) => c.enqueue(p)), c.close()) }));
    const plain = await pipeStream({ upstreamRes: res(), clientRes: null, format: "anthropic" });
    const folded = await pipeStream({ upstreamRes: res(), clientRes: null, format: "anthropic", fold: true });
    assert.deepEqual(/** @type {any} */ (folded.fold).reply(), sseToJson("anthropic", Buffer.from(bytes).toString("utf8")), bytes === body ? "plain" : "BOM-led");
    assert.deepEqual({ ...folded, fold: null }, { ...plain, fold: null }, "the scanner's reading is the same");
  }
});

// The saving: the memory stage parses each event of a round with no memory call; the scanner and the fold take its
// parse — once per event where it was three times.
test("an event is parsed once from the memory stage through the scanner and the fold", async () => {
  const words = 200;
  const pieces = cut(anthropicStream(words), 64);
  const events = words + 5;
  /** @param {boolean} handOn */
  const run = (handOn) => {
    const memStage = createMemoryToolStream("anthropic");
    const scanner = createSseScanner("anthropic");
    const fold = createSseFold("anthropic");
    for (const p of pieces) {
      const t = memStage.push(p);
      scanner.feed(t, handOn ? memStage.parsed : null);
      fold.feed(t, handOn ? scanner.parsed : null);
    }
    scanner.end();
    fold.end();
    return { reply: fold.reply(), usage: scanner.state.usage };
  };
  let before, after;
  const was = await parses(() => void (before = run(false)));
  const now = await parses(() => void (after = run(true)));
  assert.deepEqual(after, before, "the same reply and usage");
  assert.equal(was, events * 3, "handed nothing on, each reader parsed every event");
  assert.equal(now, events, "handed on, each event was parsed once");
});

test("a translating stage takes the memory stage's parse; the scanner reads the stage's own text", async () => {
  const pieces = cut(anthropicStream(50), 100);
  /** @param {boolean} handOn */
  const run = (handOn) => {
    const memStage = createMemoryToolStream("anthropic");
    const stage = createAnthropicToOpenaiStream({ model: "m", now: () => 1 });
    const scanner = createSseScanner("openai");
    let out = "";
    for (const p of pieces) {
      const t = stage.push(memStage.push(p), handOn ? memStage.parsed : null);
      scanner.feed(t);
      out += t;
    }
    out += stage.end();
    return out;
  };
  let before = "",
    after = "";
  const was = await parses(() => void (before = run(false)));
  const now = await parses(() => void (after = run(true)));
  assert.equal(after, before, "the same bytes out");
  assert.equal(was - now, 55, "the stage parsed none of the 55 events the memory stage had");
});
