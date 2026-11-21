// @ts-check
// A streamed reply's line past what Filament reads of one (core/lines.js `LINE_MAX`) reaches its client as it came, and
// the readers of the reply that drop it — the usage scanner, memory's fold, the stream watcher — say so once, in the
// log, for the whole reply. A stage the stream goes through on its way drops it from what the client gets, said the same
// way; a reply read whole from such a stream is the error that says so, a 502.
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { startApp } from "./helpers/app.js";

const sse = (/** @type {any} */ o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
const WORDS = "the reply had a line of 257 MiB, past the 256 MiB Filament reads of one: it was dropped unread, and the reply with it";

/**
 * A provider that streams whatever it is asked, its text delta 257 MiB on one line, written as its socket takes it:
 * Responses events on its Responses path, Anthropic's otherwise. A model named "claude-short" gets a short whole reply.
 */
const longLineProvider = async () => {
  const piece = "x".repeat(2 ** 20);
  const up = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      const model = String(JSON.parse(raw || "{}").model || "");
      if (model === "claude-short") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "m0", type: "message", role: "assistant", model, content: [{ type: "text", text: "short" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 1 } }));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const responses = String(req.url).includes("/responses");
      if (responses) {
        res.write(sse({ type: "response.created", response: { id: "r1", status: "in_progress", output: [] } }));
        res.write('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"i1","delta":"');
      } else {
        res.write(sse({ type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "claude-x", content: [], usage: { input_tokens: 3, output_tokens: 0 } } }) + sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
        res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"');
      }
      for (let i = 0; i < 257; i++) if (!res.write(piece)) await once(res, "drain");
      if (responses) {
        res.write('"}\n\n');
        return res.end(sse({ type: "response.completed", response: { id: "r1", status: "completed", output: [{ type: "message", id: "i1", role: "assistant", content: [{ type: "output_text", text: "the rest" }] }], usage: { input_tokens: 3, output_tokens: 3 } } }));
      }
      res.write('"}}\n\n');
      res.end([{ type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }, { type: "message_stop" }].map(sse).join(""));
    });
  });
  await new Promise((r) => up.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (up.address()).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => up.close(() => r(undefined))) };
};
/**
 * Filament on that provider: Anthropic's wire for every model, and a Responses-only one for `resp-*`.
 * @param {string} url @param {{ memory?: boolean }} [o]
 */
const onProvider = (url, { memory = true } = {}) =>
  startApp({
    memory,
    configure: (cfg) => {
      cfg.observability.storeBodies = "full";
      cfg.upstreams = [
        { id: "u", type: "anthropic-compatible", baseUrl: url, apiKey: "k", enabled: true },
        { id: "rw", type: "openai-compatible", baseUrl: `${url}/v1`, apiKey: "k", enabled: true, wireApi: "responses" },
      ];
      cfg.routes = [
        { match: "resp-*", upstream: "rw", upstreamModel: "{model}" },
        { match: "*", upstream: "u", upstreamModel: "{model}" },
      ];
    },
  });
/** The log's words that match. @param {any} shim @param {RegExp} said */
const logged = async (shim, said) => {
  const ops = (await (await shim.api("/api/ops?kinds=log&limit=200")).json()).ops || [];
  return { said: ops.filter((/** @type {any} */ o) => said.test(String(o.title))), all: ops.map((/** @type {any} */ o) => o.title) };
};

// (fails before: yes — the bug hunt of 10-30, noticed: the readers dropped such a line with no word to anyone)
test("a streamed reply's line past 256 MiB reaches its client whole, and its readers' drop of it is said once in the log", { timeout: 180_000 }, async () => {
  const up = await longLineProvider();
  const shim = await onProvider(up.url);
  try {
    const r = await fetch(`${shim.url}/v1/messages`, {
      method: "POST",
      headers: { ...shim.headers, "x-session-id": "long-line" },
      body: JSON.stringify({ model: "claude-x", max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(r.status, 200);
    let bytes = 0;
    for await (const chunk of /** @type {any} */ (r.body)) bytes += chunk.length;
    assert.ok(bytes > 257 * 2 ** 20, `the client got the line as it came: ${bytes} bytes`);
    const { said, all } = await logged(shim, /: the reply had a line of 257 MiB, past the 256 MiB Filament reads of one, which its readers dropped: its client got it as it came/);
    assert.equal(said.length, 1, JSON.stringify(all));
  } finally {
    await shim.stop();
    await up.close();
  }
});

// (fails before: yes — the bug hunt of 10-30, noticed: a client that asked for a whole reply was answered with the
// fold of the stream, the line's text gone, as though the reply had said nothing more)
test("a whole reply folded from a stream with a line past 256 MiB is an error that says so, and the drop is said once in the log", { timeout: 180_000 }, async () => {
  const up = await longLineProvider();
  const shim = await onProvider(up.url);
  try {
    const r = await shim.post("/v1/messages", { model: "claude-x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }, { "x-session-id": "long-json" });
    assert.deepEqual([r.status, (await r.json())?.error?.message], [502, WORDS]);
    const { said, all } = await logged(shim, /: the reply had a line of 257 MiB, past the 256 MiB Filament reads of one, which its readers dropped: it was dropped unread, and the reply with it/);
    assert.equal(said.length, 1, JSON.stringify(all));
  } finally {
    await shim.stop();
    await up.close();
  }
});

// (fails before: yes — the bug hunt of 10-30, noticed: a translation held such a line whole and handed it on, and the
// log said the client got it as it came)
test("a stream translated for its client drops an event with a line past 256 MiB from what the client gets, and the log says so once", { timeout: 180_000 }, async () => {
  const up = await longLineProvider();
  const shim = await onProvider(up.url, { memory: false });
  try {
    const r = await shim.post("/v1/chat/completions", { model: "claude-x", max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(text.length < 2 ** 20 && /"finish_reason":"stop"/.test(text), `the client got the reply without it: ${text.length} characters, ${text.slice(-300)}`);
    const { said, all } = await logged(shim, /: the reply had a line of 257 MiB, past the 256 MiB Filament reads of one, which its readers dropped: its client got the reply without it, and so do the request's usage, its record and memory's copy of the reply$/);
    assert.equal(said.length, 1, JSON.stringify(all));
  } finally {
    await shim.stop();
    await up.close();
  }
});

// (fails before: yes — the bug hunt of 10-30, noticed: a Responses-wire reply asked for whole was kept whole, such a line
// in it, and read by a converter of its own)
test("a whole reply from a Responses-only server, its stream holding a line past 256 MiB, is the error that says so", { timeout: 180_000 }, async () => {
  const up = await longLineProvider();
  const shim = await onProvider(up.url, { memory: false });
  try {
    const r = await shim.post("/v1/chat/completions", { model: "resp-x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
    assert.deepEqual([r.status, (await r.json())?.error?.message], [502, WORDS]);
    const { said, all } = await logged(shim, /: the reply had a line of 257 MiB, past the 256 MiB Filament reads of one, which its readers dropped: it was dropped unread, and the reply with it: the client is answered with an error that says so$/);
    assert.equal(said.length, 1, JSON.stringify(all));
  } finally {
    await shim.stop();
    await up.close();
  }
});

// (fails before: yes — the bug hunt of 10-30, noticed: memory's call kept the whole stream and read it with `sseToJson`,
// which went on without such a line)
test("memory's call to its model fails in words where the reply had a line past 256 MiB, said once in the log", { timeout: 180_000 }, async () => {
  const up = await longLineProvider();
  const shim = await onProvider(up.url);
  try {
    await assert.rejects(/** @type {any} */ (shim.app).memory.callModel({ system: "s", user: "u", model: "claude-x" }), (/** @type {any} */ e) => String(e?.message).includes(WORDS));
    const { said, all } = await logged(shim, /^memory: the memory call \S+: the reply had a line of 257 MiB, past the 256 MiB Filament reads of one, which its readers dropped: it was dropped unread, and the reply with it: the call fails in those words$/);
    assert.equal(said.length, 1, JSON.stringify(all));
  } finally {
    await shim.stop();
    await up.close();
  }
});

// (fails before: yes — the bug hunt of 10-30, noticed: the replay kept the whole stream and read it with `sseToJson`,
// which went on without such a line)
test("a replay whose reply had a line past 256 MiB fails in words, said once in the log", { timeout: 180_000 }, async () => {
  const up = await longLineProvider();
  const shim = await onProvider(up.url, { memory: false });
  try {
    assert.equal((await shim.post("/v1/messages", { model: "claude-short", max_tokens: 10, messages: [{ role: "user", content: "hi" }] })).status, 200);
    const orig = (await shim.records()).find((/** @type {any} */ x) => x.model === "claude-short");
    assert.ok(orig?.id, "the original is recorded");
    const rep = await (await shim.api(`/api/requests/${orig.id}/replay`, { method: "POST", body: { model: "claude-x" } })).json();
    assert.deepEqual([rep.ok, rep.error], [false, WORDS]);
    const { said, all } = await logged(shim, new RegExp(`^replay of ${orig.id}: the reply had a line of 257 MiB, past the 256 MiB Filament reads of one, which its readers dropped: it was dropped unread, and the reply with it: the replay fails in those words$`));
    assert.equal(said.length, 1, JSON.stringify(all));
  } finally {
    await shim.stop();
    await up.close();
  }
});
