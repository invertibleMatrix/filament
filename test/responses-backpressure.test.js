// The Responses front door's socket stand-in (http/responses.js) answers a write the way the client's socket did: a
// full socket says false, and the pipeline waits for its drain before reading the provider on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createResponsesFrontDoor } from "../src/http/responses.js";

/** A client's socket that is full: every write says so. */
function fullSocket() {
  const s = /** @type {any} */ (new EventEmitter());
  s.written = [];
  s.headersSent = false;
  s.writeHead = () => ((s.headersSent = true), s);
  s.flushHeaders = () => {};
  s.write = (/** @type {any} */ c) => (s.written.push(String(c)), false);
  s.end = (/** @type {any} */ c) => {
    if (c != null) s.written.push(String(c));
  };
  return s;
}

/** @param {any} body */
function request(body) {
  const req = /** @type {any} */ (new PassThrough());
  req.headers = { "content-type": "application/json" };
  req.end(JSON.stringify(body));
  return req;
}

const chunk = (/** @type {any} */ delta, finish = null) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

// (fails before: yes — the stand-in said true to every write, so the pipeline never waited and a slow reader's reply piled up)
test("a streamed Responses reply: a write the client's socket refused says false", async () => {
  /** @type {boolean[]} */
  const answers = [];
  const door = createResponsesFrontDoor({
    config: { get: () => ({ server: { requireAuth: false, maxBodyBytes: 1e6 } }) },
    pipeline: {
      async handle(/** @type {any} */ _req, /** @type {any} */ res) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        answers.push(res.write(chunk({ role: "assistant", content: "" })));
        answers.push(res.write(chunk({ content: "hello" })));
        answers.push(res.write("data: {\"id\":\"c1\",")); // half an event: nothing goes out yet
        answers.push(res.write(`"object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n`));
        res.write(chunk({}, "stop"));
        res.end("data: [DONE]\n\n");
      },
    },
  });
  const sock = fullSocket();
  await door.handle(request({ model: "m", input: "hi", stream: true }), sock);
  assert.deepEqual(answers, [false, false, true, false], "the socket's answer where something was written, true where nothing was");
  assert.ok(sock.written.join("").includes("response.output_text.delta"), "the Responses events went out");
});
