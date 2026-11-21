// The silence limit on a reply's body (adapters/providers/http.js): a provider that sends nothing while its reply is
// read fails the body with the silence's own error and has its connection closed; the time a slow reader takes is never
// counted; and the watch costs one timer for the whole body, not a timer and a race of promises for every chunk.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { forwardRequest } from "../src/adapters/providers/http.js";

/** @type {http.Server} */
let server;
let url = "";
/** How the provider answers each path, and whether its connection was closed under it. */
const closed = { silent: false };
before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (req.url === "/silent") {
      res.write("data: first\n\n");
      res.on("close", () => (closed.silent = true)); // and nothing more, ever
      return;
    }
    if (req.url === "/many") {
      for (let i = 0; i < 60; i++) res.write(`data: piece ${i}\n\n`);
      return void setTimeout(() => res.end("data: [DONE]\n\n"), 20);
    }
    res.end("data: all\n\ndata: [DONE]\n\n");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
});
after(() => new Promise((r) => server.close(() => r(undefined))));

/** @param {string} path */
const open = (path) => forwardRequest({ url: `${url}${path}`, headers: {}, bodyString: "{}", signal: undefined });

/** @param {() => Promise<void>} fn */
async function withLimit(ms, fn) {
  process.env.FILAMENT_SILENT_REPLY_MS = String(ms);
  try {
    await fn();
  } finally {
    delete process.env.FILAMENT_SILENT_REPLY_MS;
  }
}

test("a provider silent mid-reply: the read fails with the silence's error, and its connection is closed", () =>
  withLimit(150, async () => {
    const fw = await open("/silent");
    const reader = /** @type {ReadableStream<Uint8Array>} */ (fw.res.body).getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "data: first\n\n");
    const t0 = Date.now();
    await assert.rejects(reader.read(), (/** @type {any} */ e) => {
      assert.equal(e.code, "FILAMENT_SILENT_REPLY");
      assert.equal(e.message, "it sent nothing for 0.2 s mid-reply");
      return true;
    });
    assert.ok(Date.now() - t0 >= 140, "not before the limit");
    for (let i = 0; i < 50 && !closed.silent; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(closed.silent, "the request was aborted: the provider's connection is closed");
    fw.cleanup();
  }));

test("a slow reader is never counted as the provider's silence", () =>
  withLimit(100, async () => {
    const fw = await open("/many");
    const reader = /** @type {ReadableStream<Uint8Array>} */ (fw.res.body).getReader();
    let text = "";
    for (let n = 0; ; n++) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      if (n === 0) await new Promise((r) => setTimeout(r, 300)); // three limits without reading
    }
    assert.match(text, /piece 59/);
    assert.ok(text.endsWith("data: [DONE]\n\n"));
    fw.cleanup();
  }));

test("the watch costs one timer for the whole body, and no race per chunk", () =>
  withLimit(60_000, async () => {
    const fw = await open("/many");
    const reader = /** @type {ReadableStream<Uint8Array>} */ (fw.res.body).getReader();
    const realRace = Promise.race;
    let races = 0;
    Promise.race = /** @type {any} */ (function (/** @type {any} */ ...a) {
      races++;
      return realRace.apply(this, /** @type {any} */ (a));
    });
    let chunks = 0;
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
      }
    } finally {
      Promise.race = realRace;
    }
    assert.ok(chunks >= 1);
    assert.equal(races, 0, `no Promise.race per chunk (${races} for ${chunks} chunks)`);
    fw.cleanup();
  }));
