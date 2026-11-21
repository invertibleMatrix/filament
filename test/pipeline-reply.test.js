// @ts-check
// The reply path's edge cases through the whole pipeline: what the client and the record get when an upstream says
// 200 but hands back nothing usable.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, fakeUpstream } from "./helpers/app.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** An upstream whose connection breaks after the first piece of its stream. @type {http.Server} */
let cutUp;

before(async () => {
  up = await fakeUpstream((call) => {
    if (call.body?.model === "junk") return { status: 200, text: "<html>maintenance page</html>" };
    if (call.body?.model === "silent") return { status: 200, sse: [": keep-alive"] };
    return undefined;
  });
  cutUp = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "half a rep" }, finish_reason: null }] })}\n\n`);
      setTimeout(() => res.socket?.destroy(), 100);
    });
  });
  await new Promise((r) => cutUp.listen(0, "127.0.0.1", () => r(undefined)));
  const cutPort = /** @type {import("node:net").AddressInfo} */ (cutUp.address()).port;
  shim = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [
        { id: "fake", name: "fake", type: "openai-compatible", baseUrl: up.url, apiKey: "x", enabled: true },
        { id: "cut", name: "cut", type: "openai-compatible", baseUrl: `http://127.0.0.1:${cutPort}`, apiKey: "x", enabled: true },
      ];
      cfg.routes = [
        { match: "cut/*", upstream: "cut", upstreamModel: "{1}", enabled: true },
        { match: "*", upstream: "fake", upstreamModel: "{1}", enabled: true },
      ];
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  await new Promise((r) => cutUp.close(() => r(undefined)));
});

// (fails before: yes — the bug hunt of 10-30, WIRE-1: a stream whose upstream broke off after its first byte ended with
// Anthropic's `event: error` whatever the client spoke, so a Chat Completions client read no error and no [DONE])
test("a stream that breaks off after its first byte ends with the error in the client's own format", async () => {
  const r = await shim.post("/v1/chat/completions", {
    model: "cut/m",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(text.includes("half a rep"), "what came before the cut was forwarded");
  assert.doesNotMatch(text, /^event: error/m);
  const datas = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  assert.equal(datas.at(-1), "[DONE]");
  const err = JSON.parse(/** @type {string} */ (datas.at(-2)));
  assert.equal(err.error.type, "server_error");
  assert.ok(err.error.message, "the error names why the stream ended");
});

test("a 200 whose body is not JSON, where the reply must be translated, is a 502 'empty reply' — not a crash", async () => {
  // An Anthropic client on an OpenAI-compatible upstream: the reply has to be translated, so its bytes cannot go
  // through untouched. Before the fix this path threw inside the reply code (JSON.parse of an object) and the client
  // got 502 "stream failure: Unexpected token …".
  const r = await shim.post("/v1/messages", {
    model: "junk",
    max_tokens: 16,
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.type, "error");
  assert.equal(body.error.message, "empty reply from the upstream");
  const rec = (await shim.records()).find((x) => x.model === "junk");
  assert.ok(rec, "the request was recorded");
  assert.equal(rec.status, "error");
  assert.equal(rec.httpStatus, 502);
  assert.equal(rec.error, "empty reply from the upstream");
  // Said on the System tab too: warnings become operations, and an upstream that answers 200 with nothing in it is one.
  const { ops } = await (await shim.api("/api/ops?kinds=log&limit=50")).json();
  assert.ok(
    ops.some(
      (o) =>
        o.level === "warn" && /answered 200 with nothing usable/.test(o.title) && o.title.includes(rec.id),
    ),
    `a warn operation names the request: ${JSON.stringify(ops.map((o) => o.title))}`,
  );
});

test("a 200 stream that carries no events is a 502 for a non-streaming client", async () => {
  // The scanner names this one itself ("empty upstream stream"); the reply path hands its verdict on as an error.
  const r = await shim.post("/v1/chat/completions", {
    model: "silent",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.error.message, "empty upstream stream");
  const rec = (await shim.records()).find((x) => x.model === "silent");
  assert.ok(rec);
  assert.equal(rec.status, "error");
});

test("a 200 whose body is not JSON goes through untouched when no translation is needed", async () => {
  // Same format on both sides: Filament is a proxy here and hands the bytes on as they are, as it always did.
  const r = await shim.post("/v1/chat/completions", {
    model: "junk",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "<html>maintenance page</html>");
});
