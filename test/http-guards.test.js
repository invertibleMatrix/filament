// @ts-check
// The four doors in http/guards.js, each with the `server` config section as a parameter (Phase 4.1). security.test.js
// proves them through a booted app; this pins each guard's own contract — the loopback and token paths of the admin
// guard were exercised by no test before, and the token paths are the ones a remote dashboard depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import * as guards from "../src/http/guards.js";
import { adminAllowed, checkInboundAuth, hostAllowed, readBody, safeEq } from "../src/http/guards.js";

/** @param {Record<string, string>} headers @param {string} [remoteAddress] */
const request = (headers, remoteAddress = "203.0.113.9") =>
  /** @type {any} */ ({ headers, socket: { remoteAddress } });

test("safeEq: equal strings only, never an empty one, and a length mismatch is simply false", () => {
  assert.equal(safeEq("secret", "secret"), true);
  assert.equal(safeEq("secret", "secre"), false);
  assert.equal(safeEq("secret", "Secret"), false);
  assert.equal(safeEq("", ""), false, "an empty token must not match an empty header");
  assert.equal(safeEq(undefined, ""), false);
  assert.equal(safeEq(12, "12"), true, "both sides are coerced to strings");
});

test("adminAllowed: loopback passes without a token; anywhere else needs server.adminToken in a header", () => {
  const noToken = { adminToken: "" };
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
    assert.equal(adminAllowed(request({}, a), noToken), true, `loopback ${a}`);
  assert.equal(adminAllowed(request({}), noToken), false, "a LAN address with no token configured");
  assert.equal(
    adminAllowed(request({ "x-filament-admin": "anything" }), noToken),
    false,
    "a header cannot open a server that has no token",
  );
  const withToken = { adminToken: "tok-1234" };
  assert.equal(adminAllowed(request({}), withToken), false, "the token is required off loopback");
  assert.equal(adminAllowed(request({ "x-filament-admin": "tok-1234" }), withToken), true);
  assert.equal(
    adminAllowed(request({ "X-Filament-Admin": "tok-1234" }), withToken),
    true,
    "header names are case-insensitive",
  );
  assert.equal(adminAllowed(request({ authorization: "Bearer tok-1234" }), withToken), true);
  assert.equal(adminAllowed(request({ authorization: "bearer tok-1234" }), withToken), true);
  assert.equal(
    adminAllowed(request({ authorization: "tok-1234" }), withToken),
    true,
    "a bare Authorization value is compared too",
  );
  assert.equal(
    adminAllowed(request({ "x-filament-admin": "tok-123" }), withToken),
    false,
    "a prefix is not the token",
  );
  assert.equal(adminAllowed(request({ "x-filament-admin": "tok-12345" }), withToken), false);
  assert.equal(
    adminAllowed(request({ "x-filament-admin": "wrong" }, "127.0.0.1"), withToken),
    true,
    "loopback still passes with a wrong header",
  );
});

// What `tailscale serve` hands on: it listens on this machine, so the request reaches Filament over loopback.
const TAILSCALE_SERVE = { host: "127.0.0.1:20300", "x-forwarded-for": "100.101.102.103", "x-forwarded-proto": "https", "Tailscale-User-Login": "someone@example.com", "Tailscale-User-Name": "Someone" };

// (fails before: yes — the owner's remote Filament of 11-06, Part 1: loopback trust read the socket alone, so a proxy on
// this machine — tailscale serve, Caddy, a Cloudflare tunnel — gave the whole tailnet or the internet this machine's /api)
test("isLocalCaller: loopback with nothing a proxy adds; a request a proxy on this machine hands on is no local caller", () => {
  const local = /** @type {any} */ (guards).isLocalCaller;
  assert.equal(typeof local, "function");
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(local(request({ host: "127.0.0.1:20300" }, a)), true, `loopback ${a}`);
  assert.equal(local(request({})), false, "another machine");
  assert.equal(local(request(TAILSCALE_SERVE, "127.0.0.1")), false, "tailscale serve");
  for (const [name, value] of [["X-Forwarded-For", "203.0.113.9"], ["x-forwarded-host", "box.tail1234.ts.net"], ["x-forwarded-proto", "https"], ["Forwarded", "for=203.0.113.9"], ["X-Real-IP", "203.0.113.9"], ["via", "1.1 caddy"], ["cf-connecting-ip", "203.0.113.9"], ["true-client-ip", "203.0.113.9"], ["x-client-ip", "203.0.113.9"], ["tailscale-user-login", "a@b.c"], ["Tailscale-Headers-Info", "https://tailscale.com/s/serve-headers"]])
    assert.equal(local(request({ host: "127.0.0.1:20300", [name]: value }, "127.0.0.1")), false, name);
  for (const name of ["x-filament-ui", "x-filament-admin", "origin", "sec-fetch-site", "user-agent", "x-forwarded"])
    assert.equal(local(request({ [name]: "x" }, "127.0.0.1")), true, `${name} is nothing a proxy adds`);
});

test("adminAllowed and readsEverySession: a proxied request gets no admin for being on loopback; the admin token still opens it", () => {
  const noToken = { adminToken: "" };
  const withToken = { adminToken: "tok-1234" };
  assert.equal(adminAllowed(request(TAILSCALE_SERVE, "127.0.0.1"), noToken), false);
  assert.equal(adminAllowed(request(TAILSCALE_SERVE, "127.0.0.1"), withToken), false);
  assert.equal(adminAllowed(request({ ...TAILSCALE_SERVE, "x-filament-admin": "tok-1234" }, "127.0.0.1"), withToken), true);
  assert.equal(guards.readsEverySession(request(TAILSCALE_SERVE, "127.0.0.1"), noToken), false);
});

// (fails before: yes — MEMR-5's scope: nothing said whether a model request's caller could read every session, so
// `x-filament-memory-load` pasted any chat it named into the request of whoever sent it)
test("readsEverySession: the admin API's own answer — this machine named, over loopback or with the admin token", () => {
  const reads = /** @type {any} */ (guards).readsEverySession;
  assert.equal(typeof reads, "function");
  const noToken = { adminToken: "" };
  const withToken = { adminToken: "tok-1234" };
  assert.equal(reads(request({ host: "127.0.0.1:20300" }, "127.0.0.1"), noToken), true, "a client on this machine");
  assert.equal(reads(request({}, "::1"), noToken), true, "no Host: a client that is no page");
  assert.equal(reads(request({ host: "10.0.0.5:20300" }), noToken), false, "another machine, no token configured");
  assert.equal(reads(request({ host: "10.0.0.5:20300" }), withToken), false, "another machine without the token");
  assert.equal(reads(request({ host: "10.0.0.5:20300", "x-filament-admin": "tok-1234" }), withToken), true, "another machine with it");
  assert.equal(reads(request({ host: "evil.example:20300" }, "127.0.0.1"), noToken), false, "a page that rebound its name to this machine");
});

test("hostAllowed: this machine's names pass, a hostname a page controls does not", () => {
  const server = { host: "MyBox.lan", allowedHosts: ["Proxy.Example"] };
  assert.equal(
    hostAllowed(request({}), server),
    true,
    "no Host header: a non-browser client (A.8 keeps this open)",
  );
  assert.equal(
    hostAllowed(request({ host: "bad host" }), server),
    false,
    "an unparseable Host does not pass",
  );
  for (const host of [
    "localhost",
    "localhost:20300",
    "app.localhost",
    "127.0.0.1",
    "127.0.0.1:20300",
    "[::1]:5",
    "10.0.0.7:8080",
  ])
    assert.equal(hostAllowed(request({ host }), server), true, host);
  assert.equal(hostAllowed(request({ host: "evil.example:20300" }), server), false);
  assert.equal(
    hostAllowed(request({ host: "mybox.lan:20300" }), server),
    true,
    "server.host, case-insensitive",
  );
  assert.equal(
    hostAllowed(request({ host: "proxy.example" }), server),
    true,
    "server.allowedHosts, case-insensitive",
  );
  assert.equal(
    hostAllowed(request({ host: "proxy.example" }), { host: "" }),
    false,
    "the list is the only way in for a name",
  );
  assert.equal(hostAllowed(request({ host: "evil.example" }), { host: "", allowedHosts: undefined }), false);
});

test("checkInboundAuth: off unless server.requireAuth; then a Bearer or x-api-key must equal one configured key", () => {
  const off = { requireAuth: false, inboundKeys: ["k1"] };
  assert.equal(checkInboundAuth(request({}), off), true);
  const on = { requireAuth: true, inboundKeys: ["k1", "k2"] };
  assert.equal(checkInboundAuth(request({}), on), false, "no key at all");
  assert.equal(checkInboundAuth(request({ authorization: "Bearer k2" }), on), true);
  assert.equal(
    checkInboundAuth(request({ authorization: "Bearer  k2 " }), on),
    true,
    "surrounding whitespace is trimmed",
  );
  assert.equal(checkInboundAuth(request({ "x-api-key": "k1" }), on), true);
  assert.equal(checkInboundAuth(request({ "x-api-key": "k3" }), on), false);
  assert.equal(
    checkInboundAuth(request({ authorization: "Bearer k3", "x-api-key": "k1" }), on),
    false,
    "a Bearer present is the key checked, not x-api-key",
  );
  assert.equal(
    checkInboundAuth(request({ "x-api-key": "k1" }), { requireAuth: true, inboundKeys: [] }),
    false,
    "no keys configured: nothing matches",
  );
  assert.equal(
    checkInboundAuth(request({ "x-api-key": "" }), { requireAuth: true, inboundKeys: [""] }),
    false,
    "an empty key never matches",
  );
});

test("readBody: the whole body under the cap; over it a 413 rejection while the stream is drained, not destroyed", async () => {
  const small = new PassThrough();
  const read = readBody(/** @type {any} */ (small), 100);
  small.write("hello ");
  small.end("world");
  assert.equal(await read, "hello world");

  const big = new PassThrough();
  const over = readBody(/** @type {any} */ (big), 10);
  big.write("12345678");
  big.write("90AB");
  await assert.rejects(over, (/** @type {any} */ e) => e.status === 413 && /too large/.test(e.message));
  // The 413 must reach the client, so the request is still readable to its end: more bytes are consumed, `end` fires.
  let ended = false;
  big.on("end", () => (ended = true));
  big.write("more");
  big.end();
  await new Promise((r) => setImmediate(r));
  assert.equal(ended, true, "the stream was drained to its end after the cap tripped");

  const broken = new PassThrough();
  const failing = readBody(/** @type {any} */ (broken), 100);
  broken.emit("error", new Error("socket reset"));
  await assert.rejects(failing, /socket reset/);
});
