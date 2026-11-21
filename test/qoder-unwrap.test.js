// Qoder's reply unwrapped into a plain OpenAI stream (adapters/providers/qoder.js `unwrapStream`): the same lines out
// however the bytes were cut, Qoder read only as the unwrapped stream's reader asks, and a cancel that reaches Qoder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrapStream } from "../src/adapters/providers/qoder.js";

const enc = new TextEncoder();
const wrap = (/** @type {any} */ inner, status = 200) => `data: ${JSON.stringify({ statusCodeValue: status, body: typeof inner === "string" ? inner : JSON.stringify(inner) })}`;
const qoderReply = [
  wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { role: "assistant", content: "日本語 and é" } }] }),
  ": keep-alive",
  "data: not json",
  wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: "more" } }] }),
  wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
  wrap("[DONE]"),
  wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: "after the end" } }] }),
].join("\r\n");

/** @param {Uint8Array} bytes @param {number} size */
const cut = (bytes, size) => {
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
};
/** @param {Uint8Array[]} pieces */
const source = (pieces) => {
  let k = 0;
  return new ReadableStream({ pull: (c) => (k < pieces.length ? c.enqueue(pieces[k++]) : c.close()) });
};

test("the same lines out however Qoder's bytes were cut, a character split between two chunks too", async () => {
  const bytes = enc.encode(qoderReply);
  const whole = await new Response(unwrapStream(source([bytes]), { model: "q" })).text();
  assert.equal(
    whole,
    [
      `data: ${JSON.stringify({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { role: "assistant", content: "日本語 and é" } }], model: "q", object: "chat.completion.chunk" })}\n\n`,
      `data: ${JSON.stringify({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: "more" } }], model: "q", object: "chat.completion.chunk" })}\n\n`,
      `data: ${JSON.stringify({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 }, model: "q", object: "chat.completion.chunk" })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""),
    "Qoder's envelope taken off, its end said once, nothing after it",
  );
  for (const size of [1, 2, 3, 7, 64]) assert.equal(await new Response(unwrapStream(source(cut(bytes, size)), { model: "q" })).text(), whole, `cut every ${size} bytes`);
});

// (fails before: yes — the bug hunt of 10-30: a reply Qoder broke off was ended for it with a finish_reason "stop" it
// never sent, a cut passed on as a finished reply; and one it finished without its [DONE] got a second finish, "stop"
// after its "tool_calls")
test("a reply Qoder ends without its [DONE]: the last line, which no newline closed, counts, and its end is said as it came", async () => {
  const cutOff = await new Response(unwrapStream(source([enc.encode(`${wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: "x" } }] })}\n${wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: "y" } }] })}`)]), { model: "q" })).text();
  const events = cutOff.split("\n\n").filter(Boolean);
  assert.equal(events.length, 4);
  assert.match(events[1], /"content":"y"/, "the unterminated last line counts");
  assert.doesNotMatch(cutOff, /finish_reason/, "no finish Qoder never sent");
  assert.deepEqual(JSON.parse(events[2].slice(5)).error, { message: "incomplete upstream stream", type: "api_error" }, "a reply cut short of its finish ends as an error, in the words every wire uses");
  assert.equal(events[3], "data: [DONE]");
  const finished = await new Response(unwrapStream(source([enc.encode(`${wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] } }] })}\n${wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}`)]), { model: "q" })).text();
  const done = finished.split("\n\n").filter(Boolean);
  assert.deepEqual(done.map((e) => (e === "data: [DONE]" ? "[DONE]" : JSON.parse(e.slice(5)).choices?.[0]?.finish_reason ?? null)), [null, "tool_calls", "[DONE]"], "its own finish, then the [DONE] it left out");
});

// (fails before: yes — the bug hunt of 10-30: a line of Qoder's was held whole however long it ran, and read on past)
test("a line of Qoder's past 256 MiB ends the reply with an error that says so, and nothing after it is read", { timeout: 120_000 }, async () => {
  const piece = enc.encode("x".repeat(2 ** 20));
  const said = (/** @type {string} */ content) => `${wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content } }] })}\n`;
  /** What Qoder sends at each read: a line, a line of 257 MiB a MiB at a time, then a line after it. */
  const at = (/** @type {number} */ n) => (n === 0 ? enc.encode(said("before")) : n === 1 ? enc.encode('data: {"statusCodeValue":200,"body":"') : n < 259 ? piece : n === 259 ? enc.encode(`"}\n${said("after")}`) : null);
  let n = 0;
  const qoder = new ReadableStream({
    pull(c) {
      const next = at(n++);
      if (next) c.enqueue(next);
      else c.close();
    },
  }, { highWaterMark: 0 });
  const text = await new Response(unwrapStream(qoder, { model: "q" })).text();
  assert.equal(
    text,
    [
      `data: ${JSON.stringify({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: "before" } }], model: "q", object: "chat.completion.chunk" })}\n\n`,
      `data: ${JSON.stringify({ error: { message: "Qoder sent a line of 257 MiB, past the 256 MiB Filament reads of one: the reply ends here", type: "api_error" } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""),
  );
});

// (fails before: yes — the bug hunt of 10-30, noticed: a reply Qoder ended inside such a line lost it with no word, and
// ended as though it had finished)
test("a reply Qoder ends inside a line past 256 MiB ends with the error that says so", { timeout: 120_000 }, async () => {
  const piece = enc.encode("x".repeat(2 ** 20));
  /** What Qoder sends at each read: a line, then a line of 257 MiB a MiB at a time, and nothing after it. */
  const at = (/** @type {number} */ n) => (n === 0 ? enc.encode(`${wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: "before" } }] })}\n`) : n === 1 ? enc.encode('data: {"statusCodeValue":200,"body":"') : n < 259 ? piece : null);
  let n = 0;
  const qoder = new ReadableStream({
    pull(c) {
      const next = at(n++);
      if (next) c.enqueue(next);
      else c.close();
    },
  }, { highWaterMark: 0 });
  const text = await new Response(unwrapStream(qoder, { model: "q" })).text();
  assert.equal(
    text,
    [
      `data: ${JSON.stringify({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: "before" } }], model: "q", object: "chat.completion.chunk" })}\n\n`,
      `data: ${JSON.stringify({ error: { message: "Qoder sent a line of 257 MiB, past the 256 MiB Filament reads of one: the reply ends here", type: "api_error" } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""),
  );
});

// (fails before: yes — the unwrapped stream pumped all of Qoder's reply in from its start, whatever its reader asked)
test("Qoder is read only as the unwrapped stream's reader asks", async () => {
  let pulls = 0;
  const qoder = new ReadableStream({
    pull(c) {
      pulls++;
      if (pulls > 100) return c.close();
      c.enqueue(enc.encode(`${wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: `piece ${pulls} ` } }] })}\n`));
    },
  }, { highWaterMark: 0 });
  const unwrapped = unwrapStream(qoder, { model: "q" });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(pulls <= 3, `nobody read it, so Qoder was not read either (${pulls} pulls)`);
  const text = await new Response(unwrapped).text();
  assert.equal(text.match(/piece \d+ /g)?.length, 100, "read, it is the whole reply");
});

// (fails before: yes — the cancel asked Qoder's body itself, which the unwrapping held locked: it was refused, and Qoder
// was read on to its end)
test("a cancel of the unwrapped stream reaches Qoder's connection", async () => {
  let cancelled = false;
  let pulls = 0;
  const qoder = new ReadableStream({
    pull(c) {
      pulls++;
      c.enqueue(enc.encode(`${wrap({ id: "chatcmpl-abcdefgh", choices: [{ index: 0, delta: { content: "x" } }] })}\n`));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const reader = unwrapStream(qoder, { model: "q" }).getReader();
  await reader.read();
  await reader.cancel();
  assert.ok(cancelled, "Qoder's body was cancelled");
  const at = pulls;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(pulls, at, "and read no more");
});
