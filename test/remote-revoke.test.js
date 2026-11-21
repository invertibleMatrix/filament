// @ts-check
// Revoking a device ends what it holds open (the owner's remote Filament of 11-06, the security review of 882809c20): its
// token stopped at once, but a terminal it had open still typed into this machine, and its run socket and events stream
// still followed. Revoked here, or signed out by itself, its terminal, its run socket and its stream close at once;
// another device's and this computer's stay. Another machine stands here as a request a proxy on this machine handed
// on (X-Forwarded-For over loopback).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./helpers/app.js";
import { createDevices } from "../src/services/devices.js";
import { leaveIfRefused, PAIR_PAGE as PAGE_HERE } from "../src/ui/lib/standing.js";
import { PAIR_PAGE } from "../src/http/guards.js";

const FAR = { "x-forwarded-for": "100.101.102.103" };
const WS = { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" };

/**
 * A request over node:http, so the test sets every header itself.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any }>}
 */
const ask = (port, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } });
    req.on("response", (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(b);
        } catch {}
        resolve({ status: Number(res.statusCode), headers: res.headers, json });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

/**
 * A connection held open — a WebSocket's upgrade, or the events stream's response — and a promise of its close.
 * @param {number} port @param {string} path @param {Record<string, string>} headers @param {boolean} upgrade
 * @returns {Promise<{ status: number, closed: Promise<true>, end: () => void }>}
 */
const hold = (port, path, headers, upgrade) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}`, ...(upgrade ? WS : {}), ...headers } });
    req.on("upgrade", (res, socket) => {
      socket.on("error", () => {});
      resolve({ status: Number(res.statusCode), closed: new Promise((done) => socket.on("close", () => done(true))), end: () => socket.destroy() });
    });
    req.on("response", (res) => {
      res.on("error", () => {});
      res.resume();
      resolve({ status: Number(res.statusCode), closed: new Promise((done) => res.on("close", () => done(true))), end: () => req.destroy() });
    });
    req.on("error", (e) => (/** @type {any} */ (e).code === "ECONNRESET" ? null : reject(e)));
    req.end();
  });

/** Whether `p` settles within `ms`. @param {Promise<any>} p @param {number} ms */
const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

/** A device paired from this machine and claimed by another machine's page: its id and headers. @param {number} port @param {string} name */
const paired = async (port, name) => {
  const own = { origin: `http://127.0.0.1:${port}` };
  const pair = await ask(port, "/api/remote/pair", { method: "POST", body: { scope: "full" } });
  const claimed = await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: pair.json.code, name } });
  assert.equal(claimed.status, 200);
  return { id: String(claimed.json.device.id), headers: { ...FAR, ...own, cookie: String(claimed.headers["set-cookie"]?.[0] || "").split(";")[0] } };
};

/** A stand-in for node-pty: it stays up, says nothing, and takes what is typed. */
const fakePty = () => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} });

// (fails before: yes — revoking set revokedAt alone, and the terminal, the run socket and the stream went on)
test("a device revoked, or signed out, loses its open terminal, run socket and events stream at once; another device's and this computer's stay", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-revoke-"));
  const shim = await startApp({ overrides: { terminalSpawn: fakePty } });
  /** @type {{ end: () => void }[]} */
  const open = [];
  try {
    const { port } = shim;
    const made = await ask(port, "/api/terminal", { method: "POST", body: { cwd: root } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const stream = `/api/terminal/${made.json.terminal.id}/stream`;
    const lost = await paired(port, "Stolen laptop");
    const kept = await paired(port, "Desk");
    /** What a caller holds open: its terminal, its run socket, its events stream. @param {Record<string, string>} headers */
    const holdAll = async (headers) => {
      const all = await Promise.all([hold(port, stream, headers, true), hold(port, "/api/runs/socket", headers, true), hold(port, "/api/events", headers, false)]);
      open.push(...all);
      assert.deepEqual(all.map((x) => x.status), [101, 101, 200]);
      return all;
    };
    const its = await holdAll(lost.headers);
    const others = await holdAll(kept.headers);
    const here = await holdAll({ origin: `http://127.0.0.1:${port}` });
    assert.equal((await ask(port, `/api/remote/devices/${lost.id}`, { method: "DELETE" })).status, 200);
    for (const [i, x] of its.entries()) assert.equal(await within(x.closed, 3000), true, `the revoked device's ${["terminal", "run socket", "events stream"][i]} is closed`);
    assert.deepEqual(await Promise.all([...others, ...here].map((x) => within(x.closed, 300))), Array(6).fill(false), "another device's and this computer's stay open");
    // Its stream asked again is refused, and the refusal names the pairing page, where its harness goes (standing.js).
    const again = await ask(port, "/api/events", { headers: lost.headers });
    assert.equal(again.status, 403);
    assert.equal(again.json?.pair, "/ui/pair.html");
    /** @type {string[]} */
    const went = [];
    const real = (/** @type {string} */ path) => ask(port, path, { headers: lost.headers }).then((x) => ({ ok: x.status < 400, json: async () => x.json }));
    assert.equal(await leaveIfRefused({ fetchImpl: /** @type {any} */ (real), go: (p) => went.push(p) }), true);
    assert.deepEqual(went, ["/ui/pair.html"]);
    const still = (/** @type {string} */ path) => ask(port, path, { headers: kept.headers }).then((x) => ({ ok: x.status < 400, json: async () => x.json }));
    assert.equal(await leaveIfRefused({ fetchImpl: /** @type {any} */ (still), go: (p) => went.push(p) }), false, "a device still paired stays");
    assert.equal(went.length, 1);
    // Signed out by itself, the same.
    const mine = await ask(port, "/api/remote/sign-out", { method: "POST", headers: kept.headers, body: {} });
    assert.equal(mine.status, 200);
    for (const x of others) assert.equal(await within(x.closed, 3000), true, "signed out: closed");
    assert.deepEqual(await Promise.all(here.map((x) => within(x.closed, 300))), [false, false, false]);
  } finally {
    for (const x of open) x.end();
    await shim.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — a run's events, followed as a stream, went on after its device was revoked)
test("a device revoked loses every stream it follows through the admin API — a run's events too; its sign-out is answered", async () => {
  const shim = await startApp();
  /** @type {{ end: () => void }[]} */
  const open = [];
  try {
    const { port } = shim;
    /** @type {any} */ (shim.app.runs).startRun({ id: "r-held", kind: "test" });
    const lost = await paired(port, "Stolen laptop");
    const kept = await paired(port, "Desk");
    const its = await hold(port, "/api/runs/r-held/events?stream=1", lost.headers, false);
    const theirs = await hold(port, "/api/runs/r-held/events?stream=1", kept.headers, false);
    const here = await hold(port, "/api/runs/r-held/events?stream=1", { origin: `http://127.0.0.1:${port}` }, false);
    open.push(its, theirs, here);
    assert.deepEqual([its.status, theirs.status, here.status], [200, 200, 200]);
    assert.equal((await ask(port, `/api/remote/devices/${lost.id}`, { method: "DELETE" })).status, 200);
    assert.equal(await within(its.closed, 3000), true, "the revoked device's run events are closed");
    assert.deepEqual(await Promise.all([theirs, here].map((x) => within(x.closed, 300))), [false, false], "another device's and this computer's stay open");
    // A sign-out revokes its own device before it answers: its answer comes whole, its cookie cleared.
    const out = await ask(port, "/api/remote/sign-out", { method: "POST", headers: kept.headers, body: {} });
    assert.equal(out.status, 200);
    assert.match(String(out.headers["set-cookie"] || ""), /filament_device=;/);
    assert.equal(await within(theirs.closed, 3000), true);
    assert.equal(await within(here.closed, 300), false);
  } finally {
    for (const x of open) x.end();
    await shim.stop();
  }
});

// (fails before: yes — a revoked device's open harness sat on a page that read nothing until it was loaded again)
test("the harness leaves for the pairing page on a refusal that names it, and on nothing else", async () => {
  /** @param {number} status @param {any} body */
  const answer = (status, body) => async () => /** @type {any} */ ({ ok: status < 400, json: async () => body });
  /** @param {any} fetchImpl */
  const run = async (fetchImpl) => {
    /** @type {string[]} */
    const went = [];
    return { left: await leaveIfRefused({ fetchImpl, go: (p) => went.push(p) }), went };
  };
  assert.deepEqual(await run(answer(403, { error: "no", pair: "/ui/pair.html" })), { left: true, went: ["/ui/pair.html"] });
  assert.deepEqual(await run(answer(200, { who: "local" })), { left: false, went: [] }, "this computer stays");
  assert.deepEqual(await run(answer(403, { error: "cross-site request refused" })), { left: false, went: [] }, "a refusal that names no page");
  // (fails before: yes — `/\t/evil.example` passed the path check, and the URL parser drops the tab: another site)
  for (const elsewhere of ["https://evil.example/pair", "//evil.example/pair", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/%2F/evil.example"])
    assert.deepEqual(await run(answer(403, { pair: elsewhere })), { left: true, went: ["/ui/pair.html"] }, `never an address an answer names: ${JSON.stringify(elsewhere)}`);
  assert.deepEqual(await run(answer(403, null)), { left: false, went: [] }, "a refusal with no body");
  assert.equal(PAGE_HERE, PAIR_PAGE, "the page's pairing page is the server's");
  // The harness's stream and the console's ask it once a refusal closes them (the console's: the review of 35049d31f).
  const bus = readFileSync("src/ui/harness/lib/bus.js", "utf8");
  assert.match(bus.slice(bus.indexOf("source.onerror"), bus.indexOf("source.onmessage")), /readyState !== EventSource\.CLOSED[\s\S]*void leaveIfRefused\(\);/);
  const app = readFileSync("src/ui/app.js", "utf8");
  assert.match(app.slice(app.indexOf("function connectEvents()"), app.indexOf("function connectEvents()") + 6000), /es\.onerror = \(\) => \{[^\n]*void leaveIfRefused\(\);/);
  assert.deepEqual(await run(async () => { throw new Error("down"); }), { left: false, went: [] }, "a server that does not answer");
});

test("the store says each device revoked, once, to each listener until it stops listening", () => {
  const devices = createDevices();
  /** @type {string[]} */
  const heard = [];
  const off = devices.onRevoke((id) => heard.push(id));
  const a = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "A" });
  const b = devices.claim(devices.startPairing({ scope: "view" }).code, { name: "B" });
  assert.ok(a.ok && b.ok);
  devices.revoke(a.device.id);
  devices.revoke(a.device.id);
  assert.deepEqual(heard, [a.device.id], "once: a second revoke changes nothing");
  off();
  devices.revoke(b.device.id);
  assert.deepEqual(heard, [a.device.id], "no longer listening");
});
