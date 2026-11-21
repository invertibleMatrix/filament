// @ts-check
// Filament's calls to its own front door go over loopback (services/loopback.js), answered as fetch answers, with no
// deadline but their caller's signal. Node's fetch waits 300 s for a reply's head and 300 s between two chunks of its
// body, then fails whatever its caller asked: in the G2 drive's run 4 a sub-agent's call its provider never answered
// died there, "fetch failed", before the call's own bound or the front door's watchdog could act (the run itself is
// test/retry-busy-provider.test.js). These are the transport's own promises.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getEventListeners } from "node:events";
import { loopbackPost } from "../src/services/loopback.js";
import { until, gate } from "./helpers/wait.js";

/**
 * A server for one test, its requests answered by `handle`.
 * @param {(req: http.IncomingMessage, res: http.ServerResponse, raw: Buffer) => void} handle
 */
const serve = async (handle) => {
  const server = http.createServer(async (req, res) => {
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const c of req) chunks.push(c);
    handle(req, res, Buffer.concat(chunks));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(() => r(undefined)));
    },
  };
};
const JSON_HEADERS = { "content-type": "application/json" };

// (fails before: no — a guard the plan asked for: the callers read a reply as fetch's, so the transport answers as
// fetch does)
test("a call is answered as fetch answers it: its status, every header, its body; and it is sent whole, as a POST with its length", async () => {
  /** @type {any} */
  let seen = null;
  const door = await serve((req, res, raw) => {
    seen = { method: req.method, length: req.headers["content-length"], chunked: req.headers["transfer-encoding"] ?? null, body: raw.toString("utf8") };
    res.writeHead(201, { "content-type": "application/json", "set-cookie": ["a=1", "b=2"], "x-filament-upstream": "kimi-cn" });
    res.end(JSON.stringify({ got: raw.length }));
  });
  try {
    const body = JSON.stringify({ text: "é".repeat(100_000) });
    const r = await loopbackPost(`${door.url}/v1/messages`, { headers: JSON_HEADERS, body });
    assert.deepEqual([r.status, r.ok, r.headers.get("x-filament-upstream"), r.headers.getSetCookie()], [201, true, "kimi-cn", ["a=1", "b=2"]]);
    assert.deepEqual(await r.json(), { got: Buffer.byteLength(body) });
    assert.deepEqual(seen, { method: "POST", length: String(Buffer.byteLength(body)), chunked: null, body });
  } finally {
    await door.close();
  }
});

// (fails before: no — a guard the plan asked for: memory stays out of a call named `Filament-…`, and memory's client and
// the records' By client of a loop's model call were built on the name Node's fetch gave it)
test("a call that names no user agent goes as Node's fetch named it, and one that names its own keeps it", async () => {
  const door = await serve((req, res) => res.end(String(req.headers["user-agent"])));
  try {
    const unnamed = await loopbackPost(door.url, { headers: JSON_HEADERS, body: "{}" });
    assert.equal(await unnamed.text(), "node");
    const named = await loopbackPost(door.url, { headers: { ...JSON_HEADERS, "user-agent": "filament-memory/0.1" }, body: "{}" });
    assert.equal(await named.text(), "filament-memory/0.1");
  } finally {
    await door.close();
  }
});

// (fails before: no — a guard the plan asked for: a body on a status that has none is refused by Response, and a reply
// nobody reads keeps its socket)
test("a reply whose status has no body is answered with none, and its socket serves the next call", async () => {
  /** @type {Set<number | undefined>} */
  const sockets = new Set();
  const door = await serve((req, res) => {
    sockets.add(req.socket.remotePort);
    res.writeHead(Number(String(req.url).slice(1)));
    res.end();
  });
  const free = () => Object.entries(http.globalAgent.freeSockets).filter(([name]) => name.includes(`:${door.port}:`)).flatMap(([, s]) => s || []).length;
  try {
    for (const status of [204, 205, 304]) {
      /** @type {any} */
      let r = null;
      loopbackPost(`${door.url}/${status}`, { headers: JSON_HEADERS, body: "{}" }).then((x) => (r = x), (e) => (r = e));
      await until(() => r !== null, `the ${status}'s answer`);
      assert.deepEqual([r.status, r.body], [status, null]);
      await until(() => free() === 1, `the ${status}'s socket back with the agent`);
    }
    assert.equal(sockets.size, 1, "one socket carried all three");
  } finally {
    await door.close();
  }
});

// (fails before: no — a guard the plan asked for: an abort names its cause, as fetch's does — memory's timeouts and the
// loop's Stop are told apart by it)
test("an abort before the head rejects the call with the signal's reason and tears the request down; a signal already aborted sends nothing", async () => {
  let arrived = 0;
  let closed = 0;
  const there = gate();
  const door = await serve((req, res) => {
    arrived++;
    res.on("close", () => closed++);
    there.open();
    // the head a call that was not aborted would get
    setTimeout(() => res.end("{}"), 2_000).unref();
  });
  try {
    const mine = new Error("timed out after 120 s waiting for glm-5.3");
    const stop = new AbortController();
    const call = loopbackPost(door.url, { headers: JSON_HEADERS, body: "{}", signal: stop.signal });
    await there.promise;
    stop.abort(mine);
    await assert.rejects(call, (e) => e === mine);
    await until(() => closed === 1, "the door to see the request go");

    await assert.rejects(loopbackPost(door.url, { headers: JSON_HEADERS, body: "{}", signal: AbortSignal.timeout(100) }), (/** @type {any} */ e) => e.name === "TimeoutError");

    const before = arrived;
    const gone = new AbortController();
    gone.abort(mine);
    await assert.rejects(loopbackPost(door.url, { headers: JSON_HEADERS, body: "{}", signal: gone.signal }), (e) => e === mine);
    assert.equal(arrived, before, "nothing was sent");
  } finally {
    await door.close();
  }
});

// (fails before: no — a guard the plan asked for: an abort mid-body names its cause too)
test("an abort mid-body errors the body with the signal's reason and tears the connection down", async () => {
  let closed = false;
  const door = await serve((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("event: message_start\n\n");
    req.socket.on("close", () => (closed = true));
  });
  try {
    const mine = new Error("stopped");
    const stop = new AbortController();
    const r = await loopbackPost(door.url, { headers: JSON_HEADERS, body: "{}", signal: stop.signal });
    const reader = /** @type {ReadableStream<Uint8Array>} */ (r.body).getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "event: message_start\n\n");
    /** @type {unknown} */
    let ended = null;
    reader.read().then(() => (ended = "read on"), (e) => (ended = e));
    stop.abort(mine);
    await until(() => ended !== null, "the read to end");
    assert.equal(ended, mine);
    await until(() => closed, "the door to see the connection go");
  } finally {
    await door.close();
  }
});

// (fails before: no — a guard the plan asked for: a socket's error after the head is the body's, never one thrown past
// the call)
test("a connection the door drops mid-body errors the body, and nothing throws past the call", async () => {
  const drop = gate();
  const door = await serve(async (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("event: message_start\n\n");
    await drop.promise;
    req.socket.destroy();
  });
  try {
    const r = await loopbackPost(door.url, { headers: JSON_HEADERS, body: "{}" });
    const reader = /** @type {ReadableStream<Uint8Array>} */ (r.body).getReader();
    await reader.read();
    /** @type {any} */
    let ended = null;
    reader.read().then(() => (ended = "read on"), (e) => (ended = e));
    drop.open();
    await until(() => ended !== null, "the read to end");
    assert.equal(ended.code, "ECONNRESET");
  } finally {
    await door.close();
  }
});

// (fails before: no — a guard the plan asked for: a call leaves nothing behind on a signal its caller keeps)
test("a call leaves nothing on its caller's signal, answered or refused", async () => {
  const door = await serve((_q, res) => res.end("{}"));
  const gone = await serve(() => {});
  await gone.close();
  const keep = new AbortController();
  try {
    await (await loopbackPost(door.url, { headers: JSON_HEADERS, body: "{}", signal: keep.signal })).text();
    await until(() => getEventListeners(keep.signal, "abort").length === 0, "the answered call's listener gone");
  } finally {
    await door.close();
  }
  await assert.rejects(loopbackPost(gone.url, { headers: JSON_HEADERS, body: "{}", signal: keep.signal }), (/** @type {any} */ e) => e.code === "ECONNREFUSED");
  assert.equal(getEventListeners(keep.signal, "abort").length, 0, "nor the refused one's");
});

// (fails before: no — a guard the plan asked for: the transport has no deadline of its own, where Node's fetch has
// two, and Node's agent ends an idle socket after 5 s but not one in use)
test("a head that comes after 6 s and a body that pauses 6 s both arrive, where Node's fetch gives up", async () => {
  const door = await serve((req, res) => {
    if (req.url === "/late-head") return void setTimeout(() => res.end("late"), 6_000).unref();
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("first ");
    setTimeout(() => res.end("then the rest"), 6_000).unref();
  });
  // Node's fetch's own waits, 300 s each, here 1 s: the control, so the transport is shown not to be using them.
  const slot = Symbol.for("undici.globalDispatcher.1");
  await (await fetch(`${door.url}/warm-up`, { method: "POST", body: "{}" })).body?.cancel();
  const g = /** @type {any} */ (globalThis);
  const own = g[slot];
  assert.ok(own, "Node's fetch keeps its dispatcher where undici does");
  const short = new own.constructor({ headersTimeout: 1_000, bodyTimeout: 1_000 });
  g[slot] = short;
  try {
    const [lateHead, slowBody, fetchHead, fetchBody] = await Promise.allSettled([
      loopbackPost(`${door.url}/late-head`, { headers: JSON_HEADERS, body: "{}" }).then((r) => r.text()),
      loopbackPost(`${door.url}/slow-body`, { headers: JSON_HEADERS, body: "{}" }).then((r) => r.text()),
      fetch(`${door.url}/late-head`, { method: "POST", body: "{}" }).then((r) => r.text()),
      fetch(`${door.url}/slow-body`, { method: "POST", body: "{}" }).then((r) => r.text()),
    ]);
    assert.deepEqual([lateHead, slowBody], [{ status: "fulfilled", value: "late" }, { status: "fulfilled", value: "first then the rest" }]);
    assert.deepEqual(
      [fetchHead, fetchBody].map((/** @type {any} */ s) => [s.status, s.reason?.cause?.code]),
      [["rejected", "UND_ERR_HEADERS_TIMEOUT"], ["rejected", "UND_ERR_BODY_TIMEOUT"]],
    );
  } finally {
    g[slot] = own;
    await short.close();
    await door.close();
  }
});
