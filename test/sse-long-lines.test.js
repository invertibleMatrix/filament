// @ts-check
// A line of a streamed reply past what Filament reads of one (core/lines.js `LINE_MAX`, 64 MiB): the readers beside the
// client's stream — the usage scanner and memory's fold — drop it from what they read and tell their caller; the stages
// a reply goes through on its way drop the event it is in and tell theirs; a reply read whole from such a stream is the
// format's error, in the words its client is answered with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSseFold, sseToJson } from "../src/core/wire/sse.js";
import { createSseScanner } from "../src/adapters/providers/http.js";
import { createCueStream, createMemoryToolStream } from "../src/app/memory-tools.js";
import { createAnthropicToOpenaiStream, createOpenaiToAnthropicStream } from "../src/core/wire/translate.js";
import { createChatToResponsesStream, createResponsesToChatStream } from "../src/core/wire/responses.js";

// (fails before: yes — the bug hunt of 10-30, noticed: the readers that drop a line past 64 MiB — the usage scanner and
// memory's fold — dropped it with no word to anyone)
test("the stream's readers drop a line past 64 MiB and tell their caller: the usage scanner and the fold, the scanner reading on past it", { timeout: 120_000 }, () => {
  const piece = "x".repeat(2 ** 20);
  /** A text delta of 65 MiB a MiB at a time, then the message's end. @param {(t: string) => void} feed */
  const long = (feed) => {
    feed('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"');
    for (let i = 0; i < 65; i++) feed(piece);
    feed('"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
  };
  /** @type {[string, number][]} */
  const told = [];
  /** @param {string} who */
  const tell = (who) => ({ onOver: (/** @type {{ length: number }} */ o) => void told.push([who, Math.round(o.length / 2 ** 20)]) });
  const scanner = createSseScanner("anthropic", tell("scanner"));
  long((t) => scanner.feed(t));
  const fold = createSseFold("anthropic", tell("fold"));
  long((t) => fold.feed(t));
  assert.deepEqual(told, [["scanner", 65], ["fold", 65]]);
  assert.equal(scanner.state.stopReason, "end_turn", "the scanner reads on past it");
});

const MiB = 2 ** 20;
/**
 * A line of 65 MiB fed a piece at a time: `start`, four pieces of 16 MiB and one of 1, then `end`.
 * @param {(t: string) => void} feed @param {string} start @param {string} end
 */
const feedLong = (feed, start, end) => {
  const piece = "x".repeat(16 * MiB);
  feed(start);
  for (let i = 0; i < 4; i++) feed(piece);
  feed("x".repeat(MiB));
  feed(end);
};
const sseEvent = (/** @type {any} */ o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
const chatChunk = (/** @type {any} */ delta, /** @type {string | null} */ finish = null) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
/** A reply in each format with a text delta of 65 MiB in it (`start`, the text, `end`), and a word after it. */
const LONG_REPLIES = {
  anthropic: {
    before: sseEvent({ type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "m", content: [], usage: { input_tokens: 3, output_tokens: 0 } } }) + sseEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    start: 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"',
    end: `"}}\n\n${sseEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "after" } })}${sseEvent({ type: "content_block_stop", index: 0 })}${sseEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } })}${sseEvent({ type: "message_stop" })}`,
  },
  openai: {
    before: chatChunk({ role: "assistant", content: "" }),
    start: 'data: {"id":"c1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"',
    end: `"},"finish_reason":null}]}\n\n${chatChunk({ content: "after" })}${chatChunk({}, "stop")}data: [DONE]\n\n`,
  },
  responses: {
    before: sseEvent({ type: "response.created", response: { id: "r1", status: "in_progress", output: [] } }),
    start: 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"i1","delta":"',
    end: `"}\n\n${sseEvent({ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "i1", delta: "after" })}${sseEvent({ type: "response.completed", response: { id: "r1", status: "completed", output: [{ type: "message", id: "i1", role: "assistant", content: [{ type: "output_text", text: "after" }] }], usage: { input_tokens: 3, output_tokens: 1 } } })}`,
  },
};

// (fails before: yes — the bug hunt of 10-30, noticed: the stages a reply goes through on its way to its client — memory's
// tool stage, the cue, the translations — held such a line whole in buffers of their own, searched again from the
// event's start at each piece, and handed it on, with no word to anyone)
test("the stages a reply's stream goes through drop an event with a line past 64 MiB and tell their caller, reading on past it: memory's tool stage, the cue, the four translations", { timeout: 300_000 }, () => {
  /** @type {[string, number][]} */
  const told = [];
  /** @param {string} who */
  const tell = (who) => ({ onOver: (/** @type {{ length: number }} */ o) => void told.push([who, Math.round(o.length / MiB)]) });
  /**
   * A stage fed a reply with such a line, and closed: how much it handed on, and what, while that is short.
   * @param {{ push: (t: string) => string }} stage @param {{ before: string, start: string, end: string }} reply @param {() => string} close
   */
  const through = (stage, reply, close) => {
    let out = "";
    let length = 0;
    const take = (/** @type {string} */ t) => {
      length += t.length;
      if (length < MiB) out += t;
    };
    take(stage.push(reply.before));
    feedLong((t) => take(stage.push(t)), reply.start, reply.end);
    take(close());
    return { out, length };
  };
  const mem = createMemoryToolStream("anthropic", tell("memory's tool stage"));
  const cue = createCueStream("anthropic", "Cue.", tell("the cue"));
  const toChat = createAnthropicToOpenaiStream({ model: "m", ...tell("Anthropic to Chat") });
  const toAnthropic = createOpenaiToAnthropicStream({ model: "m", ...tell("Chat to Anthropic") });
  const fromResponses = createResponsesToChatStream({ model: "m", ...tell("Responses to Chat") });
  const toResponses = createChatToResponsesStream({ model: "m", input: "hi" }, { id: "r1", created: 1, ...tell("Chat to Responses") });
  /** @type {[string, { out: string, length: number }][]} */
  const read = [
    ["memory's tool stage", through(mem, LONG_REPLIES.anthropic, () => mem.endResponse().forwarded)],
    ["the cue", through(cue, LONG_REPLIES.anthropic, () => cue.end())],
    ["Anthropic to Chat", through(toChat, LONG_REPLIES.anthropic, () => toChat.end())],
    ["Chat to Anthropic", through(toAnthropic, LONG_REPLIES.openai, () => toAnthropic.end())],
    ["Responses to Chat", through(fromResponses, LONG_REPLIES.responses, () => fromResponses.end())],
    ["Chat to Responses", through(toResponses, LONG_REPLIES.openai, () => toResponses.end())],
  ];
  assert.deepEqual(told, read.map(([who]) => [who, 65]), "each told of it, once");
  for (const [who, { out, length }] of read) assert.ok(length < MiB && out.includes('"after"'), `${who} dropped it and read on: ${length} characters, ${out.slice(-300)}`);
});

// (fails before: yes — the bug hunt of 10-30, noticed: a reply read whole from its stream — `sseToJson`, the admin
// replay's, memory's call's — went on without such a line, as though the reply had said nothing more)
test("a reply read whole from a stream with a line past 64 MiB is the format's error, in the words its client is answered with, a 502: so is one the stream ended inside; a fold that is no whole reply goes on without it", { timeout: 300_000 }, () => {
  const words = "the reply had a line of 65 MiB, past the 64 MiB Filament reads of one: it was dropped unread, and the reply with it";
  const anthropic = LONG_REPLIES.anthropic;
  const text = `${anthropic.before}${anthropic.start}${"x".repeat(65 * MiB)}${anthropic.end}`;
  assert.deepEqual(sseToJson("anthropic", text), { type: "error", error: { type: "api_error", message: words } }, "sseToJson");
  const ended = createSseFold("anthropic", { whole: true });
  feedLong((t) => ended.feed(t), anthropic.before + anthropic.start, "");
  ended.end();
  assert.deepEqual(ended.reply(), { type: "error", error: { type: "api_error", message: words } }, "the stream ended inside it");
  const chat = createSseFold("openai", { whole: true });
  feedLong((t) => chat.feed(t), LONG_REPLIES.openai.before + LONG_REPLIES.openai.start, LONG_REPLIES.openai.end);
  chat.end();
  assert.deepEqual(chat.reply(), { error: { message: words, type: "server_error" } }, "a Chat Completions reply");
  const copy = createSseFold("openai");
  feedLong((t) => copy.feed(t), LONG_REPLIES.openai.before + LONG_REPLIES.openai.start, LONG_REPLIES.openai.end);
  copy.end();
  assert.equal(copy.reply().choices?.[0]?.message?.content, "after", "memory's copy of a streamed reply goes on without it");
});

// (fails before: yes — the bug hunt of 10-30, noticed: a stream that ended inside such a line lost it with no word)
test("a stream that ends inside a line past 64 MiB: the usage scanner and the fold are told at its end", { timeout: 120_000 }, () => {
  /** @type {[string, number][]} */
  const told = [];
  /** @param {string} who */
  const tell = (who) => ({ onOver: (/** @type {{ length: number }} */ o) => void told.push([who, Math.round(o.length / MiB)]) });
  const { before, start } = LONG_REPLIES.anthropic;
  const scanner = createSseScanner("anthropic", tell("scanner"));
  feedLong((t) => scanner.feed(t), before + start, "");
  scanner.end();
  const fold = createSseFold("anthropic", tell("fold"));
  feedLong((t) => fold.feed(t), before + start, "");
  fold.end();
  assert.deepEqual(told, [["scanner", 65], ["fold", 65]]);
});
