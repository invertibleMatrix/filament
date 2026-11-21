// @ts-check
// The wire between this Filament and a paired machine, where whoever answers at that machine's address may mean it harm:
// what it sends is read no further than an answer or an event can be (client.js), the name it gives itself is kept as one
// short line with nothing invisible in it (machine.js `cleanName`, remotes.js), a redirect is a refusal and nothing is
// sent on (client.js, remotes.js), the agents' row follows the machine's address and certificate as the window's pairing
// has them (desktop/lib/machine-agents.js) and the desktop reads no answer of the machine's past its cap, a lent model's
// call that never begins, a reply that falls silent and a refusal whose words never come each end and hand their turn on
// (adapters/providers/filament.js), a model list is read no further than its cap (adapters/providers/http.js), and no
// provider's reply passes Filament's own headers on (core/wire/upstream-headers.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError, clientAt, readEvents } from "../src/services/machines/client.js";
import { REMOTES_FILE, connectRemote, keepRemote, machineAt, readRemotes } from "../src/services/machines/remotes.js";
import { createMachines } from "../src/services/machines/index.js";
import { NAME_MAX, cleanName } from "../src/services/machine.js";
import { filamentDestination } from "../src/adapters/providers/filament.js";
import { testProvider } from "../src/adapters/providers/http.js";
import { responseHeaders } from "../src/core/wire/upstream-headers.js";
import { createMachineAgents } from "../desktop/lib/machine-agents.js";
import { pickRoute } from "../desktop/lib/machines.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";

const MB = 1024 * 1024;
const enc = new TextEncoder();
/** A data folder of its own, removed after. @param {import("node:test").TestContext} t */
const folder = (t) => {
  const d = mkdtempSync(join(tmpdir(), "filament-sec-wire-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
/** Whether `p` settles within `ms`: its outcome, else "still waiting". @param {Promise<any>} p @param {number} ms */
const within = (p, ms) => Promise.race([p.then((v) => ({ v }), (e) => ({ e })), new Promise((r) => setTimeout(() => r("still waiting"), ms).unref())]);

/**
 * A body of `chunks` megabytes, each made only once it is read — none ahead —; `pulled` counts those read.
 * @param {number} chunks @param {Uint8Array} [first]  sent ahead of the rest
 */
function bigBody(chunks, first) {
  const one = enc.encode("x".repeat(MB));
  const read = { pulled: 0 };
  let sentFirst = !first;
  const body = new ReadableStream({
    pull(c) {
      if (!sentFirst) {
        sentFirst = true;
        return c.enqueue(/** @type {Uint8Array} */ (first));
      }
      if (read.pulled >= chunks) return c.close();
      read.pulled++;
      c.enqueue(one);
    },
  }, { highWaterMark: 0 });
  return { body, read };
}

/** A paired machine named Box, as the store hands it out. */
const BOX = /** @type {any} */ ({ name: "Box", url: "https://box.example", machine: { id: "m-box", name: "Box" }, device: { id: "d-1", name: "agents", scope: "agent" }, connectedAt: 0 });

// (fails before: yes — an event with no blank line grew without end, and an answer was read whole, however large)
test("what a machine sends is read no further than one event or one answer may be: 50 MB with no blank line ends in an error that names it, an answer past the cap is refused", async () => {
  // readEvents on its own: the stream ends in an error, read no further than the cap.
  const lone = bigBody(50, enc.encode("data: "));
  const seen = [];
  const out = await readEvents(/** @type {any} */ (lone.body), (_e, d) => seen.push(d), { from: "Box" }).then(() => "read whole", (e) => e);
  assert.ok(out instanceof Error, String(out));
  assert.match(out.message, /^Box sent an event of more than 16 MB: it is read no further$/);
  assert.ok(lone.read.pulled <= 18, `read ${lone.read.pulled} MB of 50`);
  assert.deepEqual(seen, []);

  // The client's stream: the same, its words naming the machine.
  const streamed = bigBody(50, enc.encode("event: x\ndata: "));
  const client = clientAt("https://box.example", {}, /** @type {any} */ (async () => new Response(streamed.body, { status: 200, headers: { "content-type": "text/event-stream" } })), undefined, { remote: BOX });
  const s = await client.stream("/sessions/c/turns", {}, () => {}).then(() => "read whole", (e) => e);
  assert.ok(s instanceof Error, String(s));
  assert.match(s.message, /^Box sent an event of more than 16 MB/);
  assert.ok(streamed.read.pulled <= 18, `read ${streamed.read.pulled} MB of 50`);

  // Events under the cap still come whole, in many small pieces.
  /** @type {any[]} */
  const small = [];
  async function* pieces() {
    for (const ch of `data: {"a":1}\n\nevent: e\ndata: ${JSON.stringify({ b: "y".repeat(5000) })}\n\n`) yield enc.encode(ch);
  }
  await readEvents(pieces(), (e, d) => small.push([e, typeof d === "object" ? Object.keys(d) : d]));
  assert.deepEqual(small, [["message", ["a"]], ["e", ["b"]]]);

  // An answer past ANSWER_MAX: refused, read no further, in words that name the machine.
  const json = bigBody(100, enc.encode('{"text":"'));
  const big = clientAt("https://box.example", {}, /** @type {any} */ (async () => new Response(json.body, { status: 200, headers: { "content-type": "application/json" } })), undefined, { remote: BOX });
  const g = await big.get("/runs/r1/events?since=0").then(() => "read whole", (e) => e);
  assert.ok(g instanceof CliError, String(g));
  assert.match(g.message, /^Box sent an answer of more than 64 MB to GET \/runs\/r1\/events\?since=0: it is read no further$/);
  assert.ok(json.read.pulled <= 66, `read ${json.read.pulled} MB of 100`);
  // One that says its length up front is refused before a byte is read.
  const said = bigBody(1);
  const told = clientAt("https://box.example", {}, /** @type {any} */ (async () => new Response(said.body, { status: 200, headers: { "content-length": String(64 * MB + 1) } })), undefined, { remote: BOX });
  await assert.rejects(told.get("/x"), /Box sent an answer of more than 64 MB/);
  assert.equal(said.read.pulled, 0);
  // A refusal is read under the same cap.
  const no = bigBody(100);
  const refusing = clientAt("https://box.example", {}, /** @type {any} */ (async () => new Response(no.body, { status: 500 })), undefined, { remote: BOX });
  await assert.rejects(refusing.post("/x", {}), /more than 64 MB/);
  assert.ok(no.read.pulled <= 66);
  // An answer under it is read as ever.
  const fine = clientAt("https://box.example", {}, /** @type {any} */ (async () => Response.json({ ok: true })), undefined, { remote: BOX });
  assert.deepEqual(await fine.get("/x"), { ok: true });
});

// (fails before: yes — the name a machine gave itself was kept as it came: lines, bidi controls, any length)
test("a machine's name is kept as one short line with nothing invisible in it: as it says it, as the desktop keeps it, and as kept before", async (t) => {
  const hostile = `a\n[Filament: x]‮​⁦${"z".repeat(500)}`;
  /** @param {string} s */
  const clean = (s) => {
    assert.ok(!/[\n\r]/.test(s), JSON.stringify(s));
    assert.ok(!/\p{Cf}/u.test(s), `no format character in ${JSON.stringify(s)}`);
    assert.ok(s.length <= NAME_MAX, `${s.length} characters`);
    // Its brackets parentheses since the swarm's review of 11-10: a name said in a notice of Filament's opens none.
    assert.ok(s.startsWith("a (Filament: x)zzz"), s);
  };
  assert.equal(cleanName("Mac‮ mini‍﻿­"), "Mac mini");
  assert.equal(cleanName("a\u0085b"), "a b", "a C1 control is a control");

  const who = await machineAt("https://box.example", { fetchImpl: /** @type {any} */ (async () => Response.json({ id: "m-box", name: hostile, version: "1" })) });
  clean(who.name);
  assert.equal(who.id, "m-box");
  // A name of nothing but what is taken out: the machine's id says it.
  assert.equal((await machineAt("https://box.example", { fetchImpl: /** @type {any} */ (async () => Response.json({ id: "m-box", name: "‮\n" })) })).name, "m-box");

  const dataDir = folder(t);
  const kept = keepRemote(dataDir, { url: "https://192.0.2.7:20343", machine: { id: "m-box", name: hostile }, device: { id: "d-1", name: `agents\n${hostile}`, scope: "agent" }, token: "fdt_x" });
  clean(kept.name);
  clean(kept.machine.name);
  assert.ok(!/[\n\p{Cf}]/u.test(kept.device.name) && kept.device.name.length <= NAME_MAX, kept.device.name);
  assert.equal(readRemotes(dataDir)[0].name, kept.name);

  // A row kept before, its name as it came: read cleaned.
  const before = folder(t);
  const row = { name: hostile, url: "https://192.0.2.7:20343", token: "fdt_y", machine: { id: "m-old", name: hostile }, device: { id: "d-2", name: hostile, scope: "agent" }, connectedAt: 1 };
  writeFileSync(join(before, REMOTES_FILE), JSON.stringify({ remotes: [row] }));
  const [read] = readRemotes(before);
  clean(read.name);
  clean(read.machine.name);
  assert.ok(!/[\n\p{Cf}]/u.test(read.device.name), read.device.name);
  assert.equal(read.token, "fdt_y");
  clean(/** @type {any} */ (createMachines({ dataDir: before }).find("m-old", { agents: true })).name);
});

/** A server that records what reached it. @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} answer */
async function serverOf(answer) {
  /** @type {string[]} */
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    answer(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  return {
    url,
    hits,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r(undefined));
      }),
  };
}

// (fails before: yes — fetch followed a redirect, so a call's body and headers went on to whatever the machine named)
test("a redirect from the machine is a refusal in words: nothing is sent on to where it points, by the client, its stream, or the connect", async (t) => {
  const elsewhere = await serverOf((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  t.after(() => elsewhere.close());
  const box = await serverOf((req, res) => {
    if (req.url === "/.well-known/filament") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "m-red", name: "Red", version: "1" }));
    }
    res.writeHead(307, { location: `${elsewhere.url}${req.url}` });
    res.end();
  });
  t.after(() => box.close());

  const client = clientAt(box.url, {}, fetch, undefined, { remote: /** @type {any} */ ({ ...BOX, name: "Red", url: box.url }) });
  await assert.rejects(client.post("/sessions", { secret: "the person's words" }), (/** @type {any} */ e) => e instanceof CliError && /^Red answered with a redirect \(HTTP 307 to http:\/\/127\.0\.0\.1:\d+\/api\/sessions\): nothing is sent on/.test(e.message));
  await assert.rejects(client.get("/remote/me"), /Red answered with a redirect/);
  await assert.rejects(client.stream("/sessions/c/turns", { content: "go" }, () => {}), /Red answered with a redirect/);

  const dataDir = folder(t);
  keepRemote(dataDir, { url: box.url, machine: { id: "m-red", name: "Red" }, device: { id: "d-1", scope: "agent" }, token: "fdt_secret" });
  await assert.rejects(connectRemote(dataDir, "m-red", { agents: true }), /Red answered with a redirect \(HTTP 307/);
  assert.deepEqual(elsewhere.hits, [], "nothing reached where the redirects pointed");
  assert.ok(box.hits.includes("GET /api/state"), box.hits.join(", "));
});

const PRINT = `${"AB:".repeat(31)}CD`;
const PRINT_NEW = `${"EF:".repeat(31)}01`;
const FULL = { id: "d-window", name: "Laptop", scope: "full", kind: "browser", grants: { agents: false, models: false, browser: false }, revokedAt: null };

/** A machine's admin API as the desktop's main reaches it, scripted: its device list, the mint and a grant. */
function scripted() {
  /** @type {any[]} */
  const devices = [{ ...FULL }];
  let minted = 0;
  /** @param {number} status @param {any} json */
  const answer = (status, json) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = /** @type {typeof fetch} */ (
    async (u, init = {}) => {
      const path = new URL(String(u)).pathname.replace(/^\/api/, "");
      const method = init.method || "GET";
      if (path === "/remote/me") return answer(200, { who: "device", device: devices[0] });
      if (path === "/remote/devices") return answer(200, { devices });
      if (path === "/remote/agent-device" && method === "POST") {
        const d = { id: `d-agents-${++minted}`, name: "Filament agents on Laptop", scope: "agent", of: "d-window", grants: { agents: false, models: false, browser: false }, revokedAt: null };
        devices.push(d);
        return answer(200, { device: d, machine: { id: "m-mac", name: "Mac mini" }, token: `fdt_minted-${minted}` });
      }
      const one = /^\/remote\/devices\/(.+)$/.exec(path);
      const d = one ? devices.find((x) => x.id === decodeURIComponent(one[1])) : null;
      if (d && method === "PATCH") {
        Object.assign(d.grants, JSON.parse(String(init.body)).grants);
        return answer(200, { device: d });
      }
      return answer(404, { error: `no route ${path}` });
    }
  );
  return { fetchImpl, minted: () => minted };
}

// (fails before: yes — the kept device's grant switched on returned at once, its row's address and pin as they were)
test("switched on again, the agents' row takes the machine's address and certificate as the window's pairing has them now, its token kept", async (t) => {
  const dataDir = folder(t);
  const store = createMachines({ dataDir });
  const there = scripted();
  /** @type {any[]} */
  let routes = [{ kind: "lan", url: "https://192.0.2.9:20343", fingerprint: PRINT }];
  const flow = createMachineAgents({
    machines: () => [{ id: "m-mac", name: "Mac mini", routes, partition: "persist:machine-m-mac", addedAt: 0 }],
    cookieOf: async () => "__Host-filament_device=c",
    store,
    pick: async (m) => ({ route: m.routes[0], name: m.name, version: "9", tried: [] }),
    fetchOf: () => there.fetchImpl,
  });
  assert.equal((await flow.set("m-mac", true)).on, true);
  assert.deepEqual([store.list()[0].url, store.list()[0].fingerprint], ["https://192.0.2.9:20343", PRINT]);

  // That machine's certificate made anew, and paired again in the window at a new address.
  routes = [{ kind: "lan", url: "https://192.0.2.44:20343", fingerprint: PRINT_NEW }];
  const again = await flow.set("m-mac", true);
  assert.deepEqual([again.on, again.failed, there.minted()], [true, undefined, 1], "nothing minted");
  const row = store.list()[0];
  assert.deepEqual([row.url, row.fingerprint, row.device.id], ["https://192.0.2.44:20343", PRINT_NEW, "d-agents-1"]);
  assert.equal(readRemotes(dataDir)[0].token, "fdt_minted-1", "its token kept");
  assert.equal(store.list().length, 1);

  // Reached by a tailnet's address now, whose certificate an authority signed: no pin kept.
  routes = [{ kind: "url", url: "https://mac.tail0.ts.net" }];
  await flow.set("m-mac", true);
  assert.deepEqual([store.list()[0].url, store.list()[0].fingerprint], ["https://mac.tail0.ts.net", undefined]);
  assert.equal(readRemotes(dataDir)[0].token, "fdt_minted-1");
});

// (fails before: yes — a lent model's reply that fell silent mid-stream held its turn among the calls there until the
// chat was stopped, or ten minutes)
test("a lent model's reply that sends nothing for the silence limit ends in words that name the machine, and its turn is handed on", async (t) => {
  /** @type {AbortSignal[]} */
  const signals = [];
  const stalled = /** @type {typeof fetch} */ (
    async (_u, init = {}) => {
      const signal = /** @type {AbortSignal} */ (init.signal);
      signals.push(signal);
      const body = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(`event: message_start\ndata: {"type":"message_start"}\n\n`));
          signal.addEventListener("abort", () => c.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
  );
  const machines = { modelsWay: async () => ({ url: "https://box.example", fetch: stalled, headers: { authorization: "Bearer t" } }) };
  const dest = filamentDestination({ id: "u-quiet", name: "Box", type: "filament", machine: "m-quiet" }, /** @type {any} */ ({ machines, inFlight: 1, silentMs: 300 }));
  const open = () => /** @type {any} */ (dest.answers).open({ headers: {}, bodyString: "{}", signal: new AbortController().signal, format: "anthropic" });
  const first = await open();
  const reader = first.res.body.getReader();
  t.after(() => (reader.cancel().catch(() => {}), first.cleanup()));
  assert.ok(!(await reader.read()).done, "its first event comes");
  const t0 = Date.now();
  const end = await within(reader.read(), 3000);
  assert.ok(end !== "still waiting", "the silent reply ended");
  assert.match(String(/** @type {any} */ (end).e?.message), /^Box: it sent nothing for 0\.3 s mid-reply, and the call ended$/);
  assert.ok(Date.now() - t0 < 2500);
  assert.equal(signals[0].aborted, true, "its request ended, its connection with it");
  // The one turn there (inFlight 1) handed on: the next call goes, the first one's cleanup never called.
  const next = await within(open(), 1000);
  assert.ok(next !== "still waiting" && /** @type {any} */ (next).v, "the next call had its turn");
  await /** @type {any} */ (next).v.res.body.cancel();
  /** @type {any} */ (next).v.cleanup();
});

// (fails before: yes — a lent model's reply was read on without end, and a refusal's body read whole)
test("a lent model's reply past the reply limit ends in words that name the machine, its turn handed on; a refusal's words are its first 64K", async () => {
  /** @type {AbortSignal[]} */
  const signals = [];
  let refuse = false;
  const flood = /** @type {typeof fetch} */ (
    async (_u, init = {}) => {
      const signal = /** @type {AbortSignal} */ (init.signal);
      signals.push(signal);
      if (refuse) return new Response(JSON.stringify({ error: { message: "x".repeat(1024 * 1024) } }), { status: 403, headers: { "x-filament": "1" } });
      const body = new ReadableStream({
        pull(c) {
          if (signal.aborted) return c.error(signal.reason);
          c.enqueue(enc.encode(`data: ${"y".repeat(4096)}\n\n`));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
  );
  const machines = { modelsWay: async () => ({ url: "https://box.example", fetch: flood, headers: { authorization: "Bearer t" } }) };
  const dest = filamentDestination({ id: "u-flood", name: "Box", type: "filament", machine: "m-flood" }, /** @type {any} */ ({ machines, inFlight: 1, replyMax: 64 * 1024 }));
  const open = () => /** @type {any} */ (dest.answers).open({ headers: {}, bodyString: "{}", signal: new AbortController().signal, format: "anthropic" });
  const first = await open();
  const reader = first.res.body.getReader();
  let got = 0;
  /** @type {any} */
  let failed = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      got += value.byteLength;
    }
  } catch (e) {
    failed = e;
  }
  assert.match(String(failed?.message), /^Box: it sent more than 64 KB in one reply, and the call ended$/);
  assert.ok(got <= 64 * 1024, `read ${got} bytes`);
  assert.equal(signals[0].aborted, true, "its request ended");
  // Its one turn there handed on; a refusal of a megabyte is read for its first 64K alone.
  refuse = true;
  const said = /** @type {any} */ (await within(open(), 2000));
  assert.ok(said !== "still waiting" && said.e, "the refused call ended");
  assert.ok(String(said.e.message).length < 70 * 1024, "the refusal's words are its head");
  assert.match(String(said.e.message), /^Box said: \{"error":\{"message":"x+$/);
});

// (fails before: yes — a lent call the machine took and sent no head for held its turn there until the chat was stopped)
test("a lent call whose answer never begins ends in words that name the machine, its turn handed on: streamed by the silence limit, asked whole by the head limit", async () => {
  /** @type {AbortSignal[]} */
  const signals = [];
  let heads = false;
  const mute = /** @type {typeof fetch} */ (
    async (_u, init = {}) => {
      const signal = /** @type {AbortSignal} */ (init.signal);
      signals.push(signal);
      if (heads) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      return new Promise((_r, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
  );
  const machines = { modelsWay: async () => ({ url: "https://box.example", fetch: mute, headers: { authorization: "Bearer t" } }) };
  const dest = filamentDestination({ id: "u-mute", name: "Box", type: "filament", machine: "m-mute" }, /** @type {any} */ ({ machines, inFlight: 1, silentMs: 300, headMs: 600 }));
  /** @param {boolean} stream */
  const open = (stream) => /** @type {any} */ (dest.answers).open({ headers: {}, bodyString: "{}", body: { stream }, signal: new AbortController().signal, format: "anthropic" });

  const t0 = Date.now();
  const streamed = /** @type {any} */ (await within(open(true), 3000));
  assert.ok(streamed !== "still waiting" && streamed.e, "the streamed call ended");
  assert.match(String(streamed.e.message), /^Box: it sent no answer in 0\.3 s, and the call ended$/);
  assert.equal(streamed.e.offline, true, "the dispatch's failover goes on to the next candidate");
  assert.ok(Date.now() - t0 < 2500);
  assert.equal(signals[0].aborted, true, "its request ended, its connection with it");
  // Its one turn there (inFlight 1) handed on: the next, asked whole, has it, and waits the head limit.
  const t1 = Date.now();
  const whole = /** @type {any} */ (await within(open(false), 3000));
  assert.ok(whole !== "still waiting" && whole.e, "the call asked whole ended");
  assert.match(String(whole.e.message), /^Box: it sent no answer in 0\.6 s, and the call ended$/);
  assert.ok(Date.now() - t1 >= 550, "asked whole, it waits the head limit, not the silence's");
  assert.equal(signals[1].aborted, true);
  // And the next one goes.
  heads = true;
  const next = /** @type {any} */ (await within(open(true), 1000));
  assert.ok(next !== "still waiting" && next.v, "the next call had its turn");
  await next.v.res.body.cancel();
  next.v.cleanup();
});

// (fails before: yes — a door's refusal whose words never came held the call, and its turn there, for ten minutes)
test("a door's refusal whose words never come is read for the silence limit at the most: the call ends, its turn handed on", async () => {
  let silent = true;
  const refusing = /** @type {typeof fetch} */ (
    async () => {
      if (!silent) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      return new Response(new ReadableStream({ start() {} }), { status: 403, headers: { "x-filament": "1", "content-type": "application/json" } });
    }
  );
  const machines = { modelsWay: async () => ({ url: "https://box.example", fetch: refusing, headers: { authorization: "Bearer t" } }) };
  const dest = filamentDestination({ id: "u-shut", name: "Box", type: "filament", machine: "m-shut" }, /** @type {any} */ ({ machines, inFlight: 1, silentMs: 300 }));
  const open = () => /** @type {any} */ (dest.answers).open({ headers: {}, bodyString: "{}", signal: new AbortController().signal, format: "anthropic" });
  const t0 = Date.now();
  const said = /** @type {any} */ (await within(open(), 3000));
  assert.ok(said !== "still waiting" && said.e, "the refused call ended");
  assert.equal(said.e.message, "Box said: HTTP 403");
  assert.ok(Date.now() - t0 < 2500);
  silent = false;
  const next = /** @type {any} */ (await within(open(), 1000));
  assert.ok(next !== "still waiting" && next.v, "the next call had its turn");
  await next.v.res.body.cancel();
  next.v.cleanup();
});

// (fails before: yes — a model list was read whole, however large: another machine's, or a provider's)
test("a model list is read no further than 16 MB: another machine's, and a provider's", async (t) => {
  const listing = bigBody(100, enc.encode('{"data":["'));
  const machines = { modelsWay: async () => ({ url: "https://box.example", fetch: /** @type {any} */ (async () => new Response(listing.body, { status: 200, headers: { "content-type": "application/json" } })), headers: { authorization: "Bearer t" } }) };
  const dest = filamentDestination({ id: "u-list", name: "Box", type: "filament", machine: "m-list" }, /** @type {any} */ ({ machines, inFlight: 1 }));
  const tested = await dest.test();
  assert.equal(tested.ok, false);
  assert.equal(tested.error, "its model list is more than 16 MB: it is read no further");
  assert.ok(listing.read.pulled <= 18, `read ${listing.read.pulled} MB of 100`);
  // One that says its length up front is refused before a byte is read.
  const said = bigBody(1);
  const told = filamentDestination({ id: "u-told", name: "Box", type: "filament", machine: "m-told" }, /** @type {any} */ ({ machines: { modelsWay: async () => ({ url: "https://box.example", fetch: /** @type {any} */ (async () => new Response(said.body, { status: 200, headers: { "content-length": String(16 * MB + 1) } })), headers: {} }) }, inFlight: 1 }));
  assert.match(String((await told.listModels({ force: true })).error), /^its model list is more than 16 MB/);
  assert.equal(said.read.pulled, 0);

  // A provider's, over this Filament's own GET /v1/models of it.
  /** @type {import("node:http").ServerResponse | null} */
  let sending = null;
  let sent = 0;
  const provider = await serverOf((_req, res) => {
    sending = res;
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"data":["');
    const one = "x".repeat(MB);
    const more = () => {
      while (sent < 100 && res.write(one)) sent++;
      if (sent < 100) res.once("drain", () => (sent++, more()));
      else res.end('"]}');
    };
    more();
  });
  t.after(() => provider.close());
  const got = await testProvider({ id: "p", type: "openai", baseUrl: provider.url, apiKey: "k" });
  assert.equal(got.ok, false);
  assert.equal(got.error, "its model list is more than 16 MB: it is read no further");
  assert.ok(sent < 60, `sent ${sent} MB of 100`);
  /** @type {any} */ (sending)?.destroy();
});

// (fails before: yes — the desktop read the machine's answer to a switch whole, however large)
test("the desktop reads a machine's answer to a switch no further than 1 MB, and says so", async (t) => {
  const store = createMachines({ dataDir: folder(t) });
  /** @type {ReturnType<typeof bigBody>[]} */
  const bodies = [];
  const flow = createMachineAgents({
    machines: () => [{ id: "m-mac", name: "Mac mini", routes: [{ kind: "lan", url: "https://192.0.2.9:20343", fingerprint: PRINT }], partition: "persist:machine-m-mac", addedAt: 0 }],
    cookieOf: async () => "__Host-filament_device=c",
    store,
    pick: async (m) => ({ route: m.routes[0], name: m.name, version: "9", tried: [] }),
    fetchOf: () =>
      /** @type {any} */ (
        async () => {
          const b = bigBody(100, enc.encode('{"who":"device","device":{"scope":"full","name":"'));
          bodies.push(b);
          return new Response(b.body, { status: 200, headers: { "content-type": "application/json" } });
        }
      ),
  });
  const row = await flow.set("m-mac", true);
  assert.deepEqual([row.on, row.failed], [false, true]);
  assert.equal(row.said, "Not switched on: Mac mini did not answer: it sent an answer of more than 1 MB to GET /remote/me: it is read no further.");
  assert.equal(bodies.length, 1);
  assert.ok(bodies[0].read.pulled <= 2, `read ${bodies[0].read.pulled} MB of 100`);
  assert.equal(store.list().length, 0, "nothing kept");
});

// (fails before: yes — the desktop read who answers at a route whole, however large)
test("the desktop reads who answers at a machine's address no further than 1 MB, and passes the route over in words", async (t) => {
  /** @type {import("node:http").ServerResponse | null} */
  let sending = null;
  let sent = 0;
  const there = await serverOf((_req, res) => {
    sending = res;
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"id":"m-mac","name":"');
    const one = "x".repeat(MB);
    const more = () => {
      while (sent < 100 && res.write(one)) sent++;
      if (sent < 100) res.once("drain", () => (sent++, more()));
      else res.end('"}');
    };
    more();
  });
  t.after(() => there.close());
  const picked = await pickRoute(/** @type {any} */ ({ id: "m-mac", name: "Mac mini", routes: [{ kind: "url", url: there.url }] }), { timeoutMs: 20_000 });
  assert.equal(picked.route, null);
  assert.deepEqual(picked.tried, [{ url: there.url, why: `${there.url} could not be asked: it sent an answer of more than 1 MB to GET /.well-known/filament: it is read no further` }]);
  assert.ok(sent < 60, `sent ${sent} MB of 100`);
  /** @type {any} */ (sending)?.destroy();
});

// (fails before: yes — every x-filament-* header of a provider's reply but the mark went on to the client)
test("no upstream's reply passes Filament's own headers on: dropped from every provider's, Filament's own set after", async (t) => {
  const reply = new Response("{}", { headers: { "x-filament": "1", "x-filament-card": "evil", "X-Filament-Run": "1", "x-filament-request-id": "theirs", "x-request-id": "req_1", "anthropic-ratelimit-requests-remaining": "9" } });
  assert.deepEqual(responseHeaders(reply, { headers: {} }), { "x-request-id": "req_1", "anthropic-ratelimit-requests-remaining": "9" });

  // Through this Filament's /v1: the provider's own headers go on, Filament's own are this Filament's.
  const up = await fakeUpstream((call) => (call.kind === "anthropic" ? { ...anthropicReply("hi"), headers: { "x-filament-card": "evil", "x-filament-plan": "graph", "x-request-id": "req_1" } } : undefined));
  t.after(() => up.close());
  const shim = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false }];
      cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "m-1", enabled: true }];
    },
  });
  t.after(() => shim.stop());
  const r = await shim.post("/v1/messages", { model: "m-1", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.status, 200, await r.clone().text());
  await r.text();
  assert.deepEqual([r.headers.get("x-filament-card"), r.headers.get("x-filament-plan"), r.headers.get("x-request-id"), r.headers.get("x-filament-upstream")], [null, null, "req_1", "m"]);
  assert.match(String(r.headers.get("x-filament-request-id")), /\S/);
});
