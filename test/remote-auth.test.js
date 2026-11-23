// @ts-check
// Device sessions (the owner's remote Filament of 11-06, Part 1): a pairing started on this machine, claimed by another
// machine's page (an HttpOnly cookie) or its CLI (a Bearer token), and what each device may then do — a full one drives
// this Filament as you do, a view-only one reads; a revoked one is refused at once. Another machine stands here as a
// request a proxy on this machine handed on (X-Forwarded-For over loopback), which guards.js counts as no local caller.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./helpers/app.js";
import { VIEW_ROUTES, pairLinks, viewReads } from "../src/http/admin/remote.js";
import { cookiesOf, deviceTokenOf, callerAddress, hostAllowed, sealedWay, whoIs } from "../src/http/guards.js";
import { lanAddresses, lanIps, lanNames } from "../src/services/lan-tls.js";
import { LAPSED_WORDS, createDevices } from "../src/services/devices.js";

const FAR = { "x-forwarded-for": "100.101.102.103" };

/**
 * A request over node:http, so the test sets every header itself. `upgrade` asks for a WebSocket and answers its status.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any, upgrade?: boolean }} [o]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any }>}
 */
const ask = (port, path, { method = "GET", headers = {}, body, upgrade = false } = {}) =>
  new Promise((resolve, reject) => {
    const ws = upgrade ? { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } : {};
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...ws, ...headers } });
    req.on("upgrade", (res, socket) => (socket.destroy(), resolve({ status: Number(res.statusCode), headers: res.headers, json: null })));
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

// (fails before: yes — nothing paired a device, and only this computer or the admin token reached the admin API)
test("a page on another machine pairs by a code started here: its cookie is HttpOnly and SameSite=Strict, and opens the API, the stream and the sockets", async () => {
  const shim = await startApp();
  try {
    const { port } = shim;
    const own = { origin: `http://127.0.0.1:${port}` };
    assert.equal((await ask(port, "/api/state", { headers: FAR })).status, 403, "another machine, unpaired");
    assert.equal((await ask(port, "/api/remote/pair", { method: "POST", headers: FAR, body: {} })).status, 403, "a pairing starts on this machine alone");
    const pair = await ask(port, "/api/remote/pair", { method: "POST", body: { scope: "full" } });
    assert.equal(pair.status, 200);
    assert.match(pair.json.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(pair.json.machine.id.length, 36, "the machine the code pairs with");
    // Another code closed by its id leaves this one open (the review of 35049d31f); the device names the code it claimed.
    const other = await ask(port, "/api/remote/pair", { method: "POST", body: { scope: "view" } });
    assert.deepEqual((await ask(port, `/api/remote/pair?id=${other.json.id}`, { method: "DELETE" })).json, { ok: true, closed: true });
    assert.deepEqual((await ask(port, "/api/remote/pair")).json.pending.map((/** @type {any} */ c) => c.id), [pair.json.id]);
    // A page of another site cannot claim it: the Origin check every write passes.
    assert.equal((await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, origin: "http://evil.example" }, body: { code: pair.json.code } })).status, 403);
    const claimed = await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: pair.json.code, name: "MacBook" } });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.json.token, undefined, "a page never sees its token");
    assert.deepEqual([claimed.json.device.name, claimed.json.device.scope, claimed.json.device.kind, claimed.json.device.pairing], ["MacBook", "full", "browser", pair.json.id]);
    const set = String(claimed.headers["set-cookie"]?.[0] || "");
    assert.match(set, /^filament_device=fdt_[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=34560000$/, "no Secure over plain http");
    const cookie = { cookie: set.split(";")[0] };
    assert.equal((await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: pair.json.code } })).status, 403, "a code works once");
    const state = await ask(port, "/api/state", { headers: { ...FAR, ...cookie } });
    assert.equal(state.status, 200);
    assert.deepEqual([state.json.viewer, state.json.device.name, state.json.device.scope], ["remote", "MacBook", "full"]);
    assert.equal((await ask(port, "/api/defaults/settings", { headers: { ...FAR, ...cookie } })).status, 200);
    assert.notEqual((await ask(port, "/api/terminal/t1/stream", { headers: { ...FAR, ...cookie, ...own }, upgrade: true })).status, 403, "a full device's terminal");
    assert.equal((await ask(port, "/api/runs/socket", { headers: { ...FAR, ...cookie, ...own }, upgrade: true })).status, 101, "the run socket");
    assert.equal((await ask(port, "/api/terminal/t1/stream", { headers: FAR, upgrade: true })).status, 403, "no cookie, no terminal");
    // The live stream answers it: its head comes, then the test lets go.
    const stream = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/events", headers: { host: `127.0.0.1:${port}`, ...FAR, ...cookie } }, (res) => (resolve(res.statusCode), req.destroy()));
      req.on("error", (e) => (/** @type {any} */ (e).code === "ECONNRESET" ? null : reject(e)));
      req.end();
    });
    assert.equal(stream, 200);
    // Pairing again is this machine's alone, a full device's too.
    assert.equal((await ask(port, "/api/remote/pair", { method: "POST", headers: { ...FAR, ...cookie, ...own }, body: {} })).status, 403);
    // Revoked here, it is refused at once.
    const list = await ask(port, "/api/remote/devices");
    assert.deepEqual(list.json.devices.map((/** @type {any} */ d) => d.name), ["MacBook"]);
    assert.ok(!("hash" in list.json.devices[0]));
    assert.equal((await ask(port, `/api/remote/devices/${list.json.devices[0].id}`, { method: "DELETE" })).status, 200);
    assert.equal((await ask(port, "/api/state", { headers: { ...FAR, ...cookie } })).status, 403, "revoked: refused at once");
    assert.equal((await ask(port, "/api/runs/socket", { headers: { ...FAR, ...cookie, ...own }, upgrade: true })).status, 403);
  } finally {
    await shim.stop();
  }
});

test("a view-only device reads and does nothing more: no write, no keys, no terminal; the run socket follows", async () => {
  const shim = await startApp();
  try {
    const { port } = shim;
    const own = { origin: `http://127.0.0.1:${port}` };
    const pair = await ask(port, "/api/remote/pair", { method: "POST", body: { scope: "view" } });
    const claimed = await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: pair.json.code, name: "Phone" } });
    const cookie = { cookie: String(claimed.headers["set-cookie"]?.[0] || "").split(";")[0] };
    const as = { ...FAR, ...cookie };
    const state = await ask(port, "/api/state", { headers: as });
    assert.deepEqual([state.status, state.json.device.scope], [200, "view"]);
    assert.equal((await ask(port, "/api/defaults/settings", { headers: as })).status, 200, "a read on its list");
    for (const [method, path] of [["GET", "/api/keys"], ["GET", "/api/config/changes"], ["GET", "/api/start"], ["POST", "/api/sessions/c1/stop"], ["PUT", "/api/config"], ["GET", "/api/remote/devices"]]) {
      const r = await ask(port, path, { method, headers: { ...as, ...own }, ...(method === "GET" ? {} : { body: {} }) });
      assert.equal(r.status, 403, `${method} ${path}`);
    }
    assert.match((await ask(port, "/api/keys", { headers: as })).json.error, /^a view-only device reads; GET \/keys is more than that$/);
    assert.equal((await ask(port, "/api/terminal/t1/stream", { headers: { ...as, ...own }, upgrade: true })).status, 403, "no terminal");
    assert.equal((await ask(port, "/api/runs/socket", { headers: { ...as, ...own }, upgrade: true })).status, 101, "the run socket follows");
    // It signs itself out: its cookie goes, its token stops.
    const out = await ask(port, "/api/remote/sign-out", { method: "POST", headers: { ...as, ...own }, body: {} });
    assert.equal(out.status, 200);
    assert.match(String(out.headers["set-cookie"]?.[0]), /^filament_device=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/);
    assert.equal((await ask(port, "/api/state", { headers: as })).status, 403);
  } finally {
    await shim.stop();
  }
});

test("the CLI claims with no Origin and gets a Bearer token once; https through a proxy makes a page's cookie Secure; wrong codes are held", async () => {
  const shim = await startApp();
  try {
    const { port } = shim;
    const own = { origin: `http://127.0.0.1:${port}` };
    // A pairing names its scope: one that is neither, or none, is refused, never read as full (the review of 882809c20).
    for (const body of [{}, { scope: "View" }, { scope: "read" }]) {
      const no = await ask(port, "/api/remote/pair", { method: "POST", body });
      assert.equal(no.status, 400, JSON.stringify(body));
      assert.match(no.json.error, /^scope is "full" \(it drives this Filament\) or "view" \(it reads\)/);
    }
    const pair = await ask(port, "/api/remote/pair", { method: "POST", body: { scope: "full" } });
    const cli = await ask(port, "/api/remote/claim", { method: "POST", headers: FAR, body: { code: pair.json.code, name: "laptop CLI" } });
    assert.equal(cli.status, 200);
    assert.match(cli.json.token, /^fdt_/);
    assert.equal(cli.headers["set-cookie"], undefined);
    assert.equal(cli.json.device.kind, "cli");
    const me = await ask(port, "/api/remote/me", { headers: { ...FAR, authorization: `Bearer ${cli.json.token}` } });
    assert.deepEqual([me.status, me.json.who, me.json.device.name], [200, "device", "laptop CLI"]);
    // Over https the cookie is a __Host- one, which no other site under the name sets or shadows (the review of 882809c20).
    const https = { ...FAR, "x-forwarded-proto": "https" };
    const tls = await ask(port, "/api/remote/pair", { method: "POST", body: { scope: "full" } });
    const secure = await ask(port, "/api/remote/claim", { method: "POST", headers: { ...https, ...own }, body: { code: tls.json.code } });
    const set = String(secure.headers["set-cookie"]?.[0]);
    assert.match(set, /^__Host-filament_device=fdt_[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=34560000; Secure$/);
    const jar = { cookie: set.split(";")[0] };
    assert.equal((await ask(port, "/api/state", { headers: { ...https, ...jar } })).status, 200, "the __Host- cookie opens the API");
    const gone = await ask(port, "/api/remote/sign-out", { method: "POST", headers: { ...https, ...jar, ...own }, body: {} });
    assert.deepEqual(gone.headers["set-cookie"], [
      "__Host-filament_device=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure",
      "filament_device=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    ]);
    // (fails before: yes — a proxy that said https as a list, or by Forwarded alone, sealed the claim and got a cookie
    // without Secure)
    for (const said of /** @type {Record<string, string>[]} */ ([{ "x-forwarded-proto": "https, https" }, { "x-forwarded-proto": " https " }, { forwarded: "for=100.64.1.1;proto=https" }])) {
      const open = await ask(port, "/api/remote/pair", { method: "POST", body: { scope: "full" } });
      const got = await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, ...said, ...own }, body: { code: open.json.code } });
      assert.equal(got.status, 200, JSON.stringify(said));
      assert.match(String(got.headers["set-cookie"]?.[0]), /^__Host-filament_device=fdt_[\w-]+; .*; Secure$/, JSON.stringify(said));
    }
    // Five wrong codes from one address, and that address is held: a 429 with when to try again.
    for (let i = 0; i < 5; i++) assert.equal((await ask(port, "/api/remote/claim", { method: "POST", headers: { "x-forwarded-for": "100.64.9.9" }, body: { code: "AAAA-AAAA" } })).status, 403);
    const held = await ask(port, "/api/remote/claim", { method: "POST", headers: { "x-forwarded-for": "100.64.9.9" }, body: { code: "AAAA-AAAA" } });
    assert.equal(held.status, 429);
    assert.ok(Number(held.headers["retry-after"]) > 0 && held.json.retryAt > Date.now());
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — s4f: a device's token was good however long it went unused, and its cookie, set once at the
// claim, ran out at 400 days in a browser used every day)
test("a device unused 90 days is refused in words that say to pair again, its page sent to pairing; one in use has its cookie sent again, a day apart at the most", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "filament-lapse-"));
  const now = Date.now();
  const day = 86_400_000;
  /** A device as devices.json keeps it, with the token that opens it. @param {string} name @param {number} seen @param {string} [scope] */
  const kept = (name, seen, scope = "full") => {
    const token = `fdt_${randomBytes(32).toString("base64url")}`;
    return { token, row: { id: randomUUID(), name, scope, kind: "browser", hash: createHash("sha256").update(token).digest("hex"), grants: {}, createdAt: seen, lastSeenAt: seen, lastSeenFrom: null, revokedAt: null } };
  };
  const old = kept("Old tablet", now - 100 * day);
  const older = kept("Old phone", now - 120 * day);
  const fresh = kept("Phone", now - day);
  const tunneled = kept("Desk PC", now - day);
  const sealed = kept("Laptop", now - day, "view");
  const agents = kept("Filament agents on Box", now - 300 * day, "agent");
  writeFileSync(join(dataDir, "devices.json"), JSON.stringify({ version: 1, unusedFrom: now - 400 * day, devices: [old.row, older.row, fresh.row, tunneled.row, sealed.row, { ...agents.row, of: old.row.id }] }));
  const shim = await startApp({ dataDir });
  try {
    const { port } = shim;
    // Unused past its days: refused in words that say so, by cookie or Bearer, and its page sends it to pairing.
    for (const h of /** @type {Record<string, string>[]} */ ([{ cookie: `filament_device=${old.token}` }, { authorization: `Bearer ${old.token}` }])) {
      const no = await ask(port, "/api/state", { headers: { ...FAR, ...h } });
      assert.deepEqual([no.status, no.json.error, no.json.lapsed, no.json.pair], [403, LAPSED_WORDS, true, "/ui/pair.html"], JSON.stringify(h));
    }
    assert.match(LAPSED_WORDS, /went unused here for 90 days, so its pairing ran out: pair it again/);
    const sent = await ask(port, "/ui/harness.html", { headers: { ...FAR, cookie: `filament_device=${old.token}` } });
    assert.deepEqual([sent.status, sent.headers.location], [302, "/ui/pair.html"]);
    // A token no device has is refused as any stranger is: nothing says it lapsed.
    const stranger = await ask(port, "/api/state", { headers: { ...FAR, cookie: "filament_device=fdt_nobody" } });
    assert.deepEqual([stranger.status, stranger.json.lapsed], [403, undefined]);
    // Listed still, unrevoked, past its day; the agents' device never lapses and is let in.
    const list = (await ask(port, "/api/remote/devices")).json.devices;
    const row = list.find((/** @type {any} */ d) => d.name === "Old tablet");
    assert.equal(row.revokedAt, null);
    assert.ok(row.expiresAt <= Date.now(), "past its day");
    assert.equal(list.find((/** @type {any} */ d) => d.name === "Filament agents on Box").expiresAt, null);
    assert.equal((await ask(port, "/api/remote/me", { headers: { ...FAR, authorization: `Bearer ${agents.token}` } })).json.who, "device");
    // A Bearer is no cookie: none is sent; nor to this computer, which is let in as itself.
    assert.equal((await ask(port, "/ui/harness.html", { headers: { ...FAR, authorization: `Bearer ${fresh.token}` } })).headers["set-cookie"], undefined);
    assert.equal((await ask(port, "/ui/harness.html")).headers["set-cookie"], undefined);
    // (fails before: yes — s0b: through an SSH tunnel, on loopback, a device's page was this computer's, its cookie never
    // sent again) A tunnel's browser is its device: its cookie sent again too.
    const tunnel = await ask(port, "/ui/harness.html", { headers: { cookie: `filament_device=${tunneled.token}` } });
    assert.deepEqual(tunnel.headers["set-cookie"], [`filament_device=${tunneled.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000`]);
    // In use: its page sends its cookie again, under the name it came by, then not again that day.
    const plain = { ...FAR, cookie: `filament_device=${fresh.token}` };
    const first = await ask(port, "/ui/harness.html", { headers: plain });
    assert.equal(first.status, 200);
    assert.deepEqual(first.headers["set-cookie"], [`filament_device=${fresh.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000`]);
    assert.equal((await ask(port, "/ui/harness.html", { headers: plain })).headers["set-cookie"], undefined, "a day apart at the most");
    const over = { ...FAR, "x-forwarded-proto": "https", cookie: `__Host-filament_device=${sealed.token}` };
    assert.deepEqual((await ask(port, "/ui/harness.html", { headers: over })).headers["set-cookie"], [`__Host-filament_device=${sealed.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000; Secure`]);
    // (fails before: yes — the review of s4f: a lapsed device could not sign itself out, so pairing again — which signs
    // the old one out first — left it standing, and its machine's agents' device tied to it) Lapsed, it still signs
    // itself out, its agents' device with it; a token no device has signs nothing out.
    const own = { origin: `http://127.0.0.1:${port}` };
    const out = await ask(port, "/api/remote/sign-out", { method: "POST", headers: { ...FAR, ...own, cookie: `filament_device=${old.token}` }, body: {} });
    assert.equal(out.status, 200);
    assert.deepEqual(out.headers["set-cookie"], ["filament_device=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"]);
    const revokedOf = async (/** @type {string} */ name) => (await ask(port, "/api/remote/devices")).json.devices.find((/** @type {any} */ d) => d.name === name)?.revokedAt;
    assert.ok((await revokedOf("Old tablet")) > 0);
    assert.ok((await revokedOf("Filament agents on Box")) > 0, "its agents' device with it");
    // (fails before: yes — the review of s0b: on loopback a device's Bearer that no longer verified was this computer
    // itself, so another machine's agents through an SSH tunnel went on past their revoke)
    assert.equal((await ask(port, "/api/state", { headers: { authorization: `Bearer ${agents.token}` } })).status, 403, "a revoked agents' device through a tunnel");
    const lapsedHere = await ask(port, "/api/state", { headers: { authorization: `Bearer ${older.token}` } });
    assert.deepEqual([lapsedHere.status, lapsedHere.json.lapsed], [403, true], "a lapsed one through a tunnel, said so");
    assert.equal((await ask(port, "/api/state", { headers: { cookie: "filament_device=fdt_nobody" } })).status, 200, "another port's cookie: this computer still");
    assert.equal((await ask(port, "/api/remote/sign-out", { method: "POST", headers: { ...FAR, ...own, cookie: "filament_device=fdt_nobody" }, body: {} })).status, 403);
    // A browser whose pairing lapsed claims a new code: the device it replaces goes; another's stays.
    const code = (await ask(port, "/api/remote/pair", { method: "POST", body: { scope: "full" } })).json.code;
    const again = await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, ...own, cookie: `filament_device=${older.token}` }, body: { code, name: "Old phone again" } });
    assert.equal(again.status, 200);
    assert.ok((await revokedOf("Old phone")) > 0, "the one it replaces");
    assert.deepEqual([await revokedOf("Old phone again"), await revokedOf("Phone")], [null, null]);
  } finally {
    await shim.stop();
  }
});

test("the guards' pieces: cookies, a device's token, the caller's address a proxy here says, and who calls", () => {
  /** @param {Record<string, string>} headers @param {string} [remoteAddress] */
  const req = (headers, remoteAddress = "127.0.0.1") => /** @type {any} */ ({ headers, socket: { remoteAddress } });
  assert.deepEqual(cookiesOf(req({ cookie: "a=1; filament_device=fdt_x%2Dy; bad; =v" })), { a: "1", filament_device: "fdt_x-y" });
  assert.equal(deviceTokenOf(req({ authorization: "Bearer fdt_abc" })), "fdt_abc");
  assert.equal(deviceTokenOf(req({ authorization: "Bearer tok-1234" })), "", "the admin token is no device's");
  assert.equal(callerAddress(req({ "x-forwarded-for": "100.64.0.7" })), "100.64.0.7", "a proxy on this machine says who");
  // A proxy appends the address it took the request from: what stands before it is the caller's own word (the review of
  // 882809c20 — the first let a caller pass the per-address limit, or hold another's address).
  assert.equal(callerAddress(req({ "x-forwarded-for": "6.6.6.6, 100.64.0.7" })), "100.64.0.7");
  assert.equal(callerAddress(req({ "x-forwarded-for": "6.6.6.6, 100.64.0.7, " })), "100.64.0.7", "a trailing comma is no address");
  assert.equal(deviceTokenOf(req({ cookie: "__Host-filament_device=fdt_s; filament_device=fdt_p" })), "fdt_s", "the __Host- cookie first");
  assert.equal(callerAddress(req({ "x-forwarded-for": "1.2.3.4" }, "192.168.1.9")), "192.168.1.9", "another machine's own word is not believed");
  const devices = createDevices();
  const got = devices.claim(devices.startPairing({ scope: "view" }).code, { name: "Phone" });
  assert.ok(got.ok);
  assert.deepEqual(whoIs(req({}), {}, devices), { kind: "local" });
  assert.equal(whoIs(req({ ...FAR }), {}, devices), null);
  assert.deepEqual(whoIs(req({ ...FAR, "x-filament-admin": "tok" }), { adminToken: "tok" }, devices), { kind: "admin" });
  const who = /** @type {any} */ (whoIs(req({ ...FAR, cookie: `filament_device=${got.token}` }), {}, devices));
  assert.deepEqual([who.kind, who.scope, who.device.name, who.device.lastSeenFrom], ["device", "view", "Phone", "100.101.102.103"]);
  assert.equal(whoIs(req({ ...FAR, cookie: `filament_device=${got.token}` }), {}, null), null, "no store: no device");
  // Over plain http from another machine, a device's token is no one's: it came where anyone on the network reads it
  // (the owner's remote Filament of 11-06, Part 2). Over TLS to Filament itself it is the device's.
  const far = (/** @type {Record<string, string>} */ headers, encrypted = false) => /** @type {any} */ ({ headers, socket: { remoteAddress: "192.168.1.9", encrypted } });
  assert.equal(whoIs(far({ cookie: `filament_device=${got.token}` }), {}, devices), null, "plain http from the network");
  assert.equal(whoIs(far({ authorization: `Bearer ${got.token}` }), {}, devices), null, "a CLI's Bearer too");
  assert.equal(/** @type {any} */ (whoIs(far({ cookie: `__Host-filament_device=${got.token}` }, true), {}, devices))?.device.name, "Phone", "over TLS");
  assert.deepEqual(whoIs(far({ "x-filament-admin": "tok" }), { adminToken: "tok" }, devices), { kind: "admin" }, "the admin token is the person's own choice, as it was");
  assert.deepEqual([sealedWay(far({})), sealedWay(far({}, true)), sealedWay(req({ ...FAR }))], [false, true, true]);
  // (fails before: yes — a proxy here that took the request over plain http was a sealed way, the review of p2-lan)
  assert.deepEqual(
    [sealedWay(req({ ...FAR, "x-forwarded-proto": "http" })), sealedWay(req({ forwarded: 'for=192.168.1.9;proto="http"' })), sealedWay(req({ ...FAR, "x-forwarded-proto": "https" }))],
    [false, false, true],
    "a proxy here that says it took the request over plain http hands on what the network read",
  );
  assert.equal(whoIs(req({ ...FAR, "x-forwarded-proto": "http", cookie: `filament_device=${got.token}` }), {}, devices), null);
  // (fails before: yes — the certificate names this machine by its host name, and its Host was refused, the review of p2-lan)
  const named = (/** @type {string} */ host, encrypted = false) => /** @type {any} */ ({ headers: { host }, socket: { remoteAddress: "192.168.1.9", encrypted } });
  assert.deepEqual([lanNames("Workstation"), lanNames("bad_name"), lanNames("")], [["workstation", "workstation.local"], [], []]);
  const own = lanNames()[0];
  if (own) {
    assert.equal(hostAllowed(named(`${own}.local:20343`, true), {}), true, "this machine's name, over the network listener's TLS");
    assert.equal(hostAllowed(named(`${own.toUpperCase()}:20343`, true), {}), true);
    assert.equal(hostAllowed(named(`${own}.local:20300`), {}), false, "over plain http a name may be a page that rebound it");
  }
  assert.equal(hostAllowed(named("evil.example:20343", true), {}), false);
});

// (fails before: yes — a pairing's links were http ones, for whatever the loopback listener listened on, and carried no fingerprint)
test("a pairing's links: the network's listener's https addresses — none of loopback, link-local or a tailnet — each with the code and the certificate's fingerprint; none while it is off", () => {
  /** @type {any} */
  const nets = {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    eth0: [{ address: "192.168.1.20", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }],
    tailscale0: [{ address: "100.88.1.2", family: "IPv4", internal: false }],
    wifi: [{ address: "169.254.3.4", family: "IPv4", internal: false }, { address: "10.0.0.7", family: "IPv4", internal: false }],
    cgnat: [{ address: "100.127.255.1", family: "IPv4", internal: false }, { address: "100.128.0.1", family: "IPv4", internal: false }],
    "vEthernet (Default Switch)": [{ address: "172.18.80.1", family: "IPv4", internal: false }],
    "vEthernet (WSL)": [{ address: "172.29.0.1", family: "IPv4", internal: false }],
    docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
    "VirtualBox Host-Only Network": [{ address: "192.168.56.1", family: "IPv4", internal: false }],
  };
  assert.deepEqual(lanIps(nets), ["192.168.1.20", "10.0.0.7", "100.128.0.1"], "100.64.0.0/10 is a tailnet's, never the network's; a network for this machine's own virtual machines is no one else's");
  const fingerprint = "AB:CD:" + "01:".repeat(29) + "EF";
  const on = { listening: { port: 20301 }, addresses: lanAddresses(20301, nets), fingerprint };
  assert.deepEqual(pairLinks(on, "ABCD-EFGH"), [
    `https://192.168.1.20:20301/ui/pair.html#code=ABCD-EFGH&fp=ABCD${"01".repeat(29)}EF`,
    `https://10.0.0.7:20301/ui/pair.html#code=ABCD-EFGH&fp=ABCD${"01".repeat(29)}EF`,
    `https://100.128.0.1:20301/ui/pair.html#code=ABCD-EFGH&fp=ABCD${"01".repeat(29)}EF`,
  ]);
  assert.deepEqual(pairLinks({ ...on, listening: null }, "ABCD-EFGH"), [], "off: plain http pairs nothing");
  assert.deepEqual(pairLinks(null, "ABCD-EFGH"), [], "not wired");
});

test("the view-only list: reads alone, by the row that answers, each a GET row the admin API has, none that acts", () => {
  assert.equal(viewReads("GET", "/sessions/:id/transcript"), true);
  assert.equal(viewReads("GET", "/requests/:id/replays"), true);
  assert.equal(viewReads("POST", "/sessions/:id/turns"), false);
  assert.equal(viewReads("POST", "/remote/sign-out"), true, "its own sign-out, the one write");
  assert.equal(viewReads("GET", undefined), false, "no row answers: nothing");
  // A row shaped like a view row is its own (the review of 882809c20): /flows/uncommitted walks git.
  assert.equal(viewReads("GET", "/sessions/:id/flows/uncommitted"), false);
  for (const p of ["/keys", "/config/changes", "/start", "/models", "/upstreams/:id/test", "/files/dirs", "/terminal", "/sessions/:id/compose", "/remote/devices", "/remote/pair"])
    assert.equal(viewReads("GET", p), false, p);
  assert.equal(new Set(VIEW_ROUTES).size, VIEW_ROUTES.length, "each once");
  // Each names a GET row the admin API has, as the route ratchet lists them: a pattern that names none reads nothing.
  const rows = new Set(readFileSync(new URL("./fixtures/admin-routes.txt", import.meta.url), "utf8").split(/\r?\n/));
  const missing = VIEW_ROUTES.filter((p) => !rows.has(`GET /api${p.replace(/:[a-z]+\*?/gi, "*")}`));
  assert.deepEqual(missing, [], "view rows the admin API has no GET row for");
});
