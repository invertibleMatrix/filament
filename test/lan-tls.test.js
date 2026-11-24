// @ts-check
// Reach this machine on my network (the owner's remote Filament of 11-06, Part 2): an https listener of its own beside
// the loopback one, its self-signed certificate made once and kept, its door keeping the model endpoints, MCP, hooks
// and artifacts to this machine; a device pairs over it with a Secure cookie and drives, and plain http from the
// network pairs nothing and carries no device. Another machine stands here as a TLS request over loopback that a proxy
// on this machine handed on (X-Forwarded-For), as remote-auth.test.js's does over plain http.
import { test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./helpers/app.js";
import { LAN_DIR, LAN_PORT, WSL_NAT_WORDS, createLanListener, firewallVerdict, lanIdentity, lanIps, lanPortOf, readFirewall, allowThroughFirewall, FIREWALL_RULE, quoted, wslNat } from "../src/services/lan-tls.js";
import { HERE_ALONE_WORDS, lanDoor } from "../src/http/front-door.js";
import { artifactsListener, artifactsPort } from "../src/http/artifacts.js";
import { validateConfig } from "../src/services/config/store.js";
import { keyPrintOf, printOf, samePrint } from "../src/core/x509.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";
import { KEY_PINS_FILE, keyFor, sameKey } from "../src/services/machines/key-pins.js";
import { dialSocket } from "../desktop/lib/pinned-socket.js";
import { wsAcceptKey } from "../src/http/ws.js";
import { createRouter } from "../src/http/router.js";
import { remoteRoutes } from "../src/http/admin/remote.js";
import { createDevices } from "../src/services/devices.js";

/** @type {any} */
const NETS = { eth0: [{ address: "192.168.1.20", family: "IPv4", internal: false }], lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] };
const FAR = { "x-forwarded-for": "192.168.1.9" };

/**
 * An https request to 127.0.0.1 that takes any certificate and says which it was given (its fingerprint).
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, headers: import("node:http").IncomingHttpHeaders, text: string, json: any, fp: string }>}
 */
const askTls = (port, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = https.request({ host: "127.0.0.1", port, path, method, agent: false, rejectUnauthorized: false, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      const fp = /** @type {any} */ (res.socket).getPeerCertificate().fingerprint256;
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(b);
        } catch {}
        resolve({ status: Number(res.statusCode), headers: res.headers, text: b, json, fp });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

const scratch = () => mkdtempSync(join(tmpdir(), "filament-lan-"));

// (fails before: yes — there was no network listener and no certificate to keep)
test("the certificate is made the first time and kept: one fingerprint across starts, this machine's names, its key this user's alone; made anew a month before its end, or when what is kept does not read", () => {
  const dir = scratch();
  try {
    const first = lanIdentity(dir, { name: "Workstation", nets: NETS, host: () => "Workstation" });
    assert.equal(first.made, true);
    const x = new X509Certificate(first.cert);
    assert.equal(x.subject, "CN=Filament on Workstation");
    assert.equal(x.subjectAltName, "DNS:localhost, DNS:workstation, DNS:workstation.local, IP Address:127.0.0.1, IP Address:192.168.1.20");
    assert.ok(x.checkPrivateKey(createPrivateKey(first.key)), "the key kept is the certificate's");
    if (process.platform !== "win32") assert.equal(statSync(join(dir, LAN_DIR, "key.pem")).mode & 0o777, 0o600);
    const again = lanIdentity(dir, { name: "Renamed", nets: NETS });
    assert.deepEqual([again.made, again.fingerprint], [false, first.fingerprint], "kept: a pinned fingerprint holds");
    // An address that moves makes none anew: every device pinned the certificate's whole fingerprint (cli/pinned.js),
    // and a browser warns of a self-signed one whatever its names (fx-lan). (fails before: no — it holds, pinned here)
    const moved = lanIdentity(dir, { nets: /** @type {any} */ ({ wifi: [{ address: "10.0.0.7", family: "IPv4", internal: false }] }), host: () => "Renamed" });
    assert.deepEqual([moved.made, moved.fingerprint, moved.cert], [false, first.fingerprint, first.cert], "another address, the same certificate");
    // A host name a certificate cannot carry is left out, not mangled.
    const odd = scratch();
    try {
      assert.equal(new X509Certificate(lanIdentity(odd, { name: "My PC", nets: {}, host: () => "My PC_1" }).cert).subjectAltName, "DNS:localhost, IP Address:127.0.0.1");
    } finally {
      rmSync(odd, { recursive: true, force: true });
    }
    // (fails before: yes — s4g: a renewal made a new key, and every device pinned to the old one paired again)
    const late = lanIdentity(dir, { now: first.notAfter - 29 * 86_400_000, nets: NETS });
    assert.deepEqual([late.made, late.renewed], [true, true], "within a month of its end: renewed");
    assert.notEqual(late.fingerprint, first.fingerprint);
    assert.equal(late.keyPrint, first.keyPrint, "by the same key");
    assert.equal(late.key, first.key);
    assert.equal(late.keyPrint, keyPrintOf(first.cert));
    assert.ok(new X509Certificate(late.cert).validTo !== x.validTo, "a new span");
    // New key: a key made anew, and the certificate with it.
    const fresh = lanIdentity(dir, { nets: NETS, newKey: true });
    assert.deepEqual([fresh.made, fresh.renewed], [true, false]);
    assert.notEqual(fresh.keyPrint, first.keyPrint);
    assert.deepEqual([lanIdentity(dir, { nets: NETS }).made, lanIdentity(dir, { nets: NETS }).keyPrint], [false, fresh.keyPrint], "kept as made");
    // (fails before: yes — the review of s4g: a certificate that does not read cut every device off, its key good)
    writeFileSync(join(dir, LAN_DIR, "cert.pem"), "not a certificate");
    const unread = lanIdentity(dir, { nets: NETS });
    assert.deepEqual([unread.made, unread.renewed, unread.keyPrint], [true, true, fresh.keyPrint], "a certificate that does not read: renewed by the key beside it");
    rmSync(join(dir, LAN_DIR, "cert.pem"));
    assert.deepEqual([lanIdentity(dir, { nets: NETS }).renewed, lanIdentity(dir, { nets: NETS }).keyPrint], [true, fresh.keyPrint], "none at all: the same");
    writeFileSync(join(dir, LAN_DIR, "key.pem"), "not a key");
    const keyless = lanIdentity(dir, { nets: NETS });
    assert.deepEqual([keyless.made, keyless.renewed], [true, false], "a key that does not read: made anew, by a new key");
    assert.notEqual(keyless.keyPrint, fresh.keyPrint);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — every vEthernet adapter and every br- bridge was left out, a Hyper-V External switch's and a
// router's br-lan with them, so a machine on the network through either had no address to pair at)
test("this machine's addresses: a Hyper-V External switch's vEthernet and a bridge of its own (br-lan, br0) are on the network; Hyper-V's Default Switch and NAT, WSL's, Docker's br-<id> and vEthernet, a veth and a VM's are not", () => {
  const at = (/** @type {string} */ address) => [{ address, family: "IPv4", internal: false }];
  /** @type {any} */
  const nets = {
    Ethernet: at("192.168.1.20"),
    "vEthernet (External Switch)": at("192.168.1.21"),
    "vEthernet (Intel(R) Wi-Fi 6 AX201 160MHz Virtual Switch)": at("192.168.1.22"),
    "br-lan": at("192.168.8.1"),
    br0: at("192.168.2.5"),
    "vEthernet (Default Switch)": at("172.20.48.1"),
    "vEthernet (WSL)": at("172.28.16.1"),
    "vEthernet (WSL (Hyper-V firewall))": at("172.29.16.1"),
    "vEthernet (nat)": at("172.30.0.1"),
    "vEthernet (DockerNAT)": at("10.0.75.1"),
    "vEthernet (HNS Internal NIC)": at("172.31.0.1"),
    "br-3f2a9c1d4e5b": at("172.18.0.1"),
    docker0: at("172.17.0.1"),
    veth1a2b3c4: at("172.17.0.9"),
    virbr0: at("192.168.122.1"),
    vboxnet0: at("192.168.57.1"),
    "VirtualBox Host-Only Network": at("192.168.56.1"),
    "VMware Network Adapter VMnet8": at("192.168.80.1"),
    vmnet1: at("192.168.81.1"),
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  };
  assert.deepEqual(lanIps(nets), ["192.168.1.20", "192.168.1.21", "192.168.1.22", "192.168.8.1", "192.168.2.5"]);
});

// (fails before: yes — the listener read server.lan.port one way and its artifacts another: an emptied field (null) had
// the listener on any free port and the artifacts at 20344, 65535 the listener there and the artifacts at 20344; and a
// port the listener would not take, or the loopback listener's, was saved)
test("server.lan.port: one lanPortOf for the listener and its artifacts, which take the one after it (0: any free port for both); validateConfig saves an integer from 0 to 65534 alone, and on, neither the loopback listener's port nor the one before it", async () => {
  assert.deepEqual(
    [undefined, { port: 0 }, { port: 20400 }, { port: 65534 }, { port: 65535 }, { port: null }, { port: -1 }, { port: 1.5 }, { port: "20400" }].map((l) => lanPortOf(/** @type {any} */ (l))),
    [LAN_PORT, 0, 20400, 65534, LAN_PORT, LAN_PORT, LAN_PORT, LAN_PORT, LAN_PORT],
  );
  const dir = scratch();
  const lan = createLanListener({ dataDir: dir, handler: () => {}, upgrade: () => {}, host: "127.0.0.1", nets: () => NETS });
  const art = artifactsListener({ dataDir: dir, answer: /** @type {any} */ (() => {}), server: () => ({}), host: "127.0.0.1", nets: () => NETS });
  try {
    for (const port of [undefined, 0, 20343, 20400, 65534, 65535, null, -1, 1.5, "20400", true]) {
      // Off: each says the port it would listen on, and nothing listens.
      const l = /** @type {any} */ ({ enabled: false, port });
      void lan.apply(l);
      void art.apply(l);
      const p = lan.state().port;
      assert.equal(p, lanPortOf(l), `the listener: ${port}`);
      assert.deepEqual([art.state().port, artifactsPort(l)], [p === 0 ? 0 : p + 1, p === 0 ? 0 : p + 1], `its artifacts beside it: ${port}`);
    }
  } finally {
    await Promise.all([lan.close(), art.close()]);
    rmSync(dir, { recursive: true, force: true });
  }
  const errs = (/** @type {any} */ lan, port = 20300) => validateConfig({ server: { port, lan }, upstreams: [], routes: [] }).errors.filter((/** @type {string} */ e) => e.startsWith("server.lan"));
  for (const port of [0, 1, 20343, 20301, 65534]) assert.deepEqual(errs({ enabled: true, port }), [], String(port));
  for (const port of [65535, 70000, -1, 1.5, null, "20343", NaN])
    assert.deepEqual(errs({ enabled: true, port }), ["server.lan.port must be a whole number from 0 to 65534 (0 picks a free port; the artifacts' network address takes the port after it)"], String(port));
  assert.deepEqual(errs({ enabled: false, port: 65535 }), ["server.lan.port must be a whole number from 0 to 65534 (0 picks a free port; the artifacts' network address takes the port after it)"], "off too: no port the listener would not take is saved");
  assert.deepEqual(errs({ enabled: true, port: 20300 }), ["server.lan.port 20300 is server.port, where this machine's apps call Filament: the network listener takes a port of its own — choose another, or 0 for any free one"]);
  assert.deepEqual(errs({ enabled: true, port: 20299 }), ["server.lan.port 20299 puts the artifacts' network address, at the port after it, on server.port (20300): choose another, or 0 for any free one"]);
  // Off, the default may meet a server.port of its own without stopping a save of anything else; turned on, it is refused.
  assert.deepEqual([errs({ enabled: false, port: 20343 }, 20343), errs({ enabled: false, port: 20343 }, 20344)], [[], []]);
  assert.equal(errs({ enabled: true, port: 20343 }, 20344).length, 1);
  assert.deepEqual(errs(undefined), [], "no server.lan: nothing to say");
});

test("the listener: on at its port with the kept certificate; its door keeps the model endpoints, MCP, hooks and artifacts to this machine; a port in use is said; off closes what it holds", async () => {
  const dir = scratch();
  /** @type {string[]} */
  const reached = [];
  const listener = createLanListener({
    dataDir: dir,
    handler: lanDoor((req, res) => void (reached.push(String(req.url)), res.end(`front ${req.url}`))),
    upgrade: () => {},
    host: "127.0.0.1",
    nets: () => NETS,
    name: () => "Workstation",
  });
  const busy = net.createServer();
  try {
    assert.deepEqual(listener.state(), { on: false, port: LAN_PORT, listening: null, error: null, fingerprint: null, notAfter: null, addresses: [], hostOnly: null }, "off until asked: no certificate made");
    await listener.apply({ enabled: true, port: 0 });
    const s = listener.state();
    const port = Number(s.listening?.port);
    assert.ok(port > 0);
    assert.deepEqual([s.on, s.error, s.addresses], [true, null, [`https://192.168.1.20:${port}`]]);
    const page = await askTls(port, "/ui/harness.html");
    assert.deepEqual([page.status, page.text], [200, "front /ui/harness.html"]);
    assert.ok(samePrint(page.fp, String(s.fingerprint)), "the certificate it serves is the one it says");
    for (const path of ["/v1/models", "/v1/messages", "/v1", "/messages", "/chat/completions", "/responses", "/embeddings", "/models", "/mcp/memory", "/mcp/abc123", "/hook/app/tok", "/memory-engine/v1/messages"]) {
      const r = await askTls(port, path, { method: path === "/v1/models" || path === "/models" ? "GET" : "POST", body: {} });
      assert.deepEqual([r.status, r.json?.error], [404, HERE_ALONE_WORDS], path);
    }
    const art = await askTls(port, "/", { headers: { host: `notes.art.localhost:${port}` } });
    assert.equal(art.status, 404, "an artifact's address answers on this machine alone");
    assert.equal((await askTls(port, "/v1x")).text, "front /v1x", "a path that only begins like one is the front door's");
    assert.deepEqual(reached, ["/ui/harness.html", "/v1x"]);
    // Asked again as it is: the same listener, not a new one.
    await listener.apply({ enabled: true, port: 0 });
    assert.equal(listener.state().listening?.port, port);
    // A connection it holds closes as it is turned off.
    const held = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false });
    held.on("error", () => {}); // cut by the other side, as it is meant to be
    await new Promise((r) => held.once("secureConnect", r));
    const closed = new Promise((r) => held.once("close", r));
    await listener.apply({ enabled: false });
    await closed;
    assert.deepEqual([listener.state().on, listener.state().listening, listener.state().error], [false, null, null]);
    // A port another program holds: said, and Filament goes on.
    await new Promise((r) => busy.listen(0, "127.0.0.1", () => r(null)));
    const taken = /** @type {net.AddressInfo} */ (busy.address()).port;
    await listener.apply({ enabled: true, port: taken });
    assert.equal(listener.state().listening, null);
    assert.equal(listener.state().error, `port ${taken} is in use by another program: choose another port`);
    await listener.apply({ enabled: true, port: 0 });
    assert.equal(listener.state().error, null, "another port: it listens");
    assert.equal(listener.state().fingerprint, s.fingerprint, "with the certificate it keeps");
    // (fails before: yes — a config change after Filament stopped turned it on again, the review of p2-lan)
    await listener.close();
    await listener.apply({ enabled: true, port: 0 });
    await listener.settled();
    assert.equal(listener.state().listening, null, "closed as Filament stops: a change after that turns it on no more");
  } finally {
    await listener.close();
    busy.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — s4g: a renewed certificate had a new key, and every pinned connection was refused until the
// device paired again)
test("a renewal keeps the key: a fetch and a socket pinned to the first certificate learned its key and take the renewed one; New key's is refused, the listener serving it at once on its port", async () => {
  const dir = scratch();
  // A socket's handshake answered, as Filament's own sockets answer it (src/http/ws.js).
  const upgrade = (/** @type {any} */ req, /** @type {any} */ socket) =>
    void socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAcceptKey(String(req.headers["sec-websocket-key"]))}\r\n\r\n`);
  const listener = createLanListener({ dataDir: dir, handler: (_req, res) => void res.end("ok"), upgrade, host: "127.0.0.1", nets: () => ({}), name: () => "Workstation" });
  /** The app's socket to it, pinned to `pin`: whether it opened, or why it closed. @param {string} pin @returns {Promise<true | string>} */
  const dial = (pin) =>
    new Promise((resolve) => {
      const s = dialSocket({ url: `wss://127.0.0.1:${listener.state().listening?.port}/api/browser/host`, pin, onOpen: () => (resolve(true), s.close()), onClose: (c) => resolve(c.why) });
    });
  try {
    await listener.apply({ enabled: true, port: 0 });
    const port = Number(listener.state().listening?.port);
    const first = String(listener.state().fingerprint);
    const url = `https://127.0.0.1:${port}/ui/harness.html`;
    const pinned = pinnedFetch(first);
    assert.equal(await (await pinned(url)).text(), "ok", "the first certificate: its key learned");
    assert.equal(samePrint(keyFor(first), lanIdentity(dir).keyPrint), true);
    assert.equal(await dial(first), true);
    // Renewed on disk a month before its end, and served as the listener starts again.
    const renewed = lanIdentity(dir, { now: Number(listener.state().notAfter) - 29 * 86_400_000, nets: {} });
    assert.equal(renewed.renewed, true);
    await listener.apply({ enabled: false });
    await listener.apply({ enabled: true, port });
    assert.equal(listener.state().fingerprint, renewed.fingerprint);
    assert.equal(await (await pinnedFetch(first)(url)).text(), "ok", "renewed: taken by its key");
    assert.equal(await dial(first), true, "the app's socket too");
    assert.equal(sameKey(first, renewed.fingerprint), true, "and learned under its own fingerprint");
    // New key: served at once, on the port it had, and refused by the pin.
    const fresh = await listener.newKey();
    assert.equal(fresh.ok, true);
    assert.deepEqual([listener.state().listening?.port, listener.state().fingerprint], [port, /** @type {any} */ (fresh).fingerprint]);
    await assert.rejects(pinnedFetch(first)(url), (/** @type {any} */ e) => e?.code === "FILAMENT_PIN" || e?.cause?.code === "FILAMENT_PIN" || /not the one this command line pinned/.test(String(e?.message)));
    assert.match(String(await dial(first)), /not the one this app paired with/);
  } finally {
    await listener.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the review of s5a: a certificate was renewed only as a listener started, so a Filament that ran
// past its certificate's end served one that had run out)
test("a listener that runs renews its certificate once it is due, served from the next handshake on: its port, its key and a connection it holds stay; the artifacts' listener on the same files takes it; closed, it looks no more", async () => {
  const dir = scratch();
  let t = Date.now();
  /** @type {string[]} */
  const said = [];
  const make = () => createLanListener({ dataDir: dir, handler: (_req, res) => void res.end("ok"), upgrade: () => {}, host: "127.0.0.1", nets: () => ({}), name: () => "Workstation", log: (_l, m) => void said.push(m), clock: () => t, lookEvery: 20 });
  const main = make();
  const art = make();
  /** @param {() => boolean} f */
  const until = async (f) => {
    for (const end = Date.now() + 5000; !f(); await new Promise((r) => setTimeout(r, 20))) if (Date.now() > end) throw new Error("timed out");
  };
  /** @type {tls.TLSSocket | null} */
  let held = null;
  try {
    await main.apply({ enabled: true, port: 0 });
    await art.apply({ enabled: true, port: 0 });
    const port = Number(main.state().listening?.port);
    const first = String(main.state().fingerprint);
    const key = lanIdentity(dir).keyPrint;
    held = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false });
    await new Promise((r) => /** @type {tls.TLSSocket} */ (held).once("secureConnect", r));
    // Not due: looked at, and nothing made.
    const kept = readFileSync(join(dir, LAN_DIR, "cert.pem"), "utf8");
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(main.state().fingerprint, first);
    assert.equal(readFileSync(join(dir, LAN_DIR, "cert.pem"), "utf8"), kept);
    // A month before its end: renewed with its key, on the port it has.
    t = Number(main.state().notAfter) - 29 * 86_400_000;
    await until(() => main.state().fingerprint !== first && art.state().fingerprint === main.state().fingerprint);
    const now = String(main.state().fingerprint);
    assert.equal(main.state().listening?.port, port);
    assert.ok(Number(main.state().notAfter) > t + 300 * 86_400_000, "a certificate that runs on for its days");
    assert.equal((await askTls(port, "/")).fp, now, "served from the next handshake on");
    assert.equal((await askTls(Number(art.state().listening?.port), "/")).fp, now, "the artifacts' listener too");
    assert.equal(lanIdentity(dir, { now: t }).keyPrint, key, "its key kept: every pin holds");
    assert.equal(held.destroyed, false, "the connection it held stays");
    assert.equal(held.getPeerCertificate().fingerprint256, first);
    assert.equal(said.filter((m) => /renewed with its key/.test(m)).length, 1, `renewed once, by one listener: ${said.join(" | ")}`);
    // Its key gone from the folder: the next look makes a new one, said as one, never as a renewal (the review of x47).
    rmSync(join(dir, LAN_DIR, "key.pem"));
    await until(() => said.some((m) => /a new key and certificate for this machine on the network, its key kept no more/.test(m)));
    assert.notEqual(lanIdentity(dir, { now: t }).keyPrint, key);
    assert.equal(said.filter((m) => /renewed with its key/.test(m)).length, 1);
    // Closed: no look makes another.
    await main.close();
    await art.close();
    const last = readFileSync(join(dir, LAN_DIR, "cert.pem"), "utf8");
    t = Number(lanIdentity(dir, { now: t }).notAfter) - 29 * 86_400_000;
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(readFileSync(join(dir, LAN_DIR, "cert.pem"), "utf8"), last);
  } finally {
    held?.destroy();
    await main.close();
    await art.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — s4g: there was no book of keys) Kept in the data folder named, read by another process's book.
test("the key book: kept in the data folder it is told, learned only from a connection the pin itself made, read by another process", async () => {
  const dir = scratch();
  try {
    const a = lanIdentity(join(dir, "a"), { nets: {} });
    const renewed = lanIdentity(join(dir, "a"), { now: a.notAfter - 29 * 86_400_000, nets: {} });
    const other = lanIdentity(join(dir, "b"), { nets: {} });
    const book = await import(`../src/services/machines/key-pins.js?book=${Date.now()}`);
    book.usePinBook(dir);
    const peer = (/** @type {string} */ pem) => {
      const x = new X509Certificate(pem);
      return { fingerprint256: x.fingerprint256, raw: x.raw };
    };
    assert.equal(book.pinHolds(a.fingerprint, peer(renewed.cert)), false, "no key learned yet: a renewal is refused");
    assert.equal(book.pinHolds(a.fingerprint, peer(other.cert)), false);
    assert.equal(book.keyFor(a.fingerprint), "", "nothing learned from a certificate the pin did not name");
    assert.equal(book.pinHolds(a.fingerprint, peer(a.cert)), true);
    assert.equal(book.keyFor(a.fingerprint), a.keyPrint);
    assert.equal(book.pinHolds(a.fingerprint, peer(renewed.cert)), true);
    assert.equal(book.pinHolds(a.fingerprint, peer(other.cert)), false, "another key: refused still");
    assert.equal(book.pinHolds(a.fingerprint, null), false);
    const kept = JSON.parse(readFileSync(join(dir, KEY_PINS_FILE), "utf8"));
    assert.deepEqual(Object.keys(kept.keys).sort(), [a.fingerprint, renewed.fingerprint].sort());
    // Another process: its own book reads the file.
    const there = await import(`../src/services/machines/key-pins.js?there=${Date.now()}`);
    assert.equal(there.keyFor(a.fingerprint), "", "no book named: this process alone");
    there.usePinBook(dir);
    assert.equal(there.pinHolds(a.fingerprint, peer(renewed.cert)), true);
    // (fails before: yes — the review of s4g: a stranger's many certificates put a pin in use out of the book) One in use
    // is kept newest: 600 others learned around its uses leave it; one not used since goes.
    const many = await import(`../src/services/machines/key-pins.js?many=${Date.now()}`);
    const print = (/** @type {number} */ n) => printOf(n.toString(16).padStart(64, "0"));
    many.learnKey(a.fingerprint, a.keyPrint);
    many.learnKey(other.fingerprint, other.keyPrint);
    for (let i = 1; i <= 600; i++) {
      many.learnKey(print(i), print(i + 10_000));
      if (i % 100 === 0) assert.equal(many.pinHolds(a.fingerprint, peer(a.cert)), true);
    }
    assert.equal(many.keyFor(a.fingerprint), a.keyPrint, "in use: kept");
    assert.equal(many.keyFor(other.fingerprint), "", "unused since: put out");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows Firewall in words: a block on this program wins, a Public network lets nothing in by Filament's rule, an allow or Filament's rule for the port opens it", () => {
  const verdict = (/** @type {any} */ f) => firewallVerdict({ networks: ["Private"], ownPorts: [], app: [], ...f }, 20301);
  assert.deepEqual(verdict({}), { open: false, fix: true, words: "Windows Firewall lets no other machine reach port 20301 yet. Allow it here — Windows asks you to confirm — and a rule opens the port to your Private network alone; or answer Allow when Windows asks." });
  assert.equal(verdict({ ownPorts: ["20301"] }).open, true, "Filament's rule for the port");
  assert.equal(verdict({ ownPorts: ["20999"] }).open, false, "a rule for another port");
  assert.equal(verdict({ app: [{ action: "Allow", profile: "Private, Public" }] }).open, true, "Windows's own allow, answered once");
  assert.equal(verdict({ app: [{ action: "Allow", profile: "Public" }] }).open, false, "an allow on another kind of network");
  assert.equal(verdict({ networks: ["DomainAuthenticated"], app: [{ action: "Allow", profile: "Domain" }] }).open, true);
  const blocked = verdict({ ownPorts: ["20301"], app: [{ action: "Allow", profile: "Any" }, { action: "Block", profile: "Private" }] });
  assert.deepEqual([blocked.open, blocked.fix], [false, true], "a block wins over any allow");
  assert.match(blocked.words, /^Windows Firewall blocks Filament on this network/);
  const pub = verdict({ networks: ["Public"], ownPorts: ["20301"] });
  assert.deepEqual([pub.open, pub.fix], [false, false], "Filament's rule opens Private and Domain networks alone");
  assert.match(pub.words, /^Windows calls this network Public, so it lets no other machine reach port 20301\. If it is your home or office network, make it Private/);
  assert.equal(verdict({ networks: ["Public"], app: [{ action: "Allow", profile: "Public" }] }).open, true, "the person allowed it on Public networks");
  assert.equal(verdict({ networks: [] }).fix, false, "no network said: Public, as Windows treats it");
  // The listener's port and its artifacts' (the owner's remote Filament of 11-06, Part 4): Filament's rule opens them
  // only where it names both — PowerShell says a rule's several ports in one, spaced or with commas.
  // (fails before: yes — one port alone was asked of the rule)
  const both = (/** @type {any} */ f) => firewallVerdict({ networks: ["Private"], ownPorts: [], app: [], ...f }, [20343, 20344]);
  assert.equal(both({ ownPorts: ["20343 20344"] }).open, true);
  assert.equal(both({ ownPorts: ["20343,20344"] }).open, true);
  assert.equal(both({ ownPorts: ["20343"] }).open, false, "the artifacts' port not opened");
  assert.match(both({}).words, /reach ports 20343 and 20344 yet. Allow it here — Windows asks you to confirm — and a rule opens the ports to your Private network alone/);
  assert.equal(both({ app: [{ action: "Allow", profile: "Private" }] }).open, true, "Windows's own allow is the program's, every port");
});

// (fails before: yes — one block on any of this machine's networks offered Allow, though Allow turns off no block of a
// Public network's alone and its rule opens no Public network: it cleared nothing there, and was offered again)
test("Windows Firewall network by network: Allow is offered only where it opens one of this machine's networks, and every Allow offered does; a block on a Public network alone is the Public network's words", () => {
  const ports = [20343, 20344];
  const verdict = (/** @type {any} */ f) => firewallVerdict({ networks: ["Private"], ownPorts: [], app: [], ...f }, ports);
  /** What Allow leaves (allowThroughFirewall's script): Filament's rule for the ports, and no block on this program whose profiles name Any, Private or Domain. @param {any} f */
  const allowed = (f) => ({ ...f, ownPorts: [ports.join(" ")], app: (f.app || []).filter((/** @type {any} */ a) => !(a.action === "Block" && /Any|Private|Domain/i.test(a.profile))) });
  const block = (/** @type {string} */ profile) => ({ action: "Block", profile });
  const allow = (/** @type {string} */ profile) => ({ action: "Allow", profile });
  const cases = [
    { networks: ["Public"], app: [block("Public")] },
    { networks: ["Public"], app: [block("Any")] },
    { networks: ["Public"], app: [allow("Any"), block("Private, Public")] },
    { networks: ["Public"], app: [allow("Public"), block("Public")] },
    { networks: ["Private", "Public"], app: [block("Public")] },
    { networks: ["Private", "Public"], app: [allow("Private"), block("Public")] },
    { networks: ["Private", "Public"], app: [block("Any")] },
    { networks: ["DomainAuthenticated", "Public"], app: [block("Domain, Public")] },
    { networks: ["Private"], app: [block("Private")] },
    { networks: ["Private"], app: [] },
    { networks: ["Public"], app: [] },
  ];
  for (const c of cases) if (verdict(c).fix) assert.equal(verdict(allowed(c)).open, true, `Allow opens it: ${JSON.stringify(c)}`);
  const pub = verdict(cases[0]);
  assert.deepEqual([pub.open, pub.fix], [false, false], "a block on a Public network: Allow cannot clear it");
  assert.match(pub.words, /^Windows calls this network Public, so it lets no other machine reach ports 20343 and 20344\. If it is your home or office network, make it Private/);
  assert.deepEqual([verdict(cases[1]).fix, verdict(cases[3]).fix], [false, false], "Allow turns that block off, but its rule opens no Public network; the person's own block on Public stands");
  const offAndOpen = verdict(cases[2]);
  assert.deepEqual([offAndOpen.open, offAndOpen.fix], [false, true], "a block Allow turns off, under Windows's allow on every network");
  assert.match(offAndOpen.words, /^Windows Firewall blocks Filament on this network/);
  const beside = verdict(cases[4]);
  assert.deepEqual([beside.open, beside.fix], [false, true], "the Private network beside it is the one Allow opens");
  assert.match(beside.words, /^Windows Firewall lets no other machine reach ports 20343 and 20344 yet/, "no block stands on it");
  assert.deepEqual([verdict(cases[5]).open, verdict(cases[5]).fix], [true, false], "the machines on the Private network get through");
  assert.deepEqual([verdict({ networks: ["Private", "DomainAuthenticated"], app: [allow("Private")] }).open, verdict({ networks: ["Private", "DomainAuthenticated"], app: [allow("Private")] }).fix], [true, false], "one network let in: its machines reach Filament, though Allow would open the other too");
  assert.match(verdict(cases[6]).words, /^Windows Firewall blocks Filament on this network/);
  assert.deepEqual([verdict(cases[7]).fix, verdict(cases[8]).fix], [true, true]);
});

test("Windows Firewall's scripts: the read asks nothing it cannot read unelevated; the rule is made elevated, for the port, the Private and Domain networks and the local subnet; a no is said", async () => {
  /** @type {string[]} */
  const ran = [];
  const read = await readFirewall({ exe: "C:\\Program Files\\Filament\\Filament.exe", run: async (s) => (ran.push(s), '{"networks":"Private","ownPorts":null,"app":{"action":"Allow","profile":"Private, Public"}}') });
  assert.deepEqual(read, { networks: ["Private"], ownPorts: [], app: [{ action: "Allow", profile: "Private, Public" }] }, "PowerShell's one-element lists and nulls");
  assert.match(ran[0], /Get-NetFirewallApplicationFilter -Program 'C:\\Program Files\\Filament\\Filament\.exe'/);
  assert.match(ran[0], new RegExp(`Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}'`));
  assert.doesNotMatch(ran[0], /RunAs|New-NetFirewallRule|Disable-NetFirewallRule/);
  ran.length = 0;
  await allowThroughFirewall({ port: 20301, exe: "C:\\it's\\Filament.exe", run: async (s) => (ran.push(s), "") });
  assert.match(ran[0], /^\$p = Start-Process powershell\.exe -Verb RunAs -Wait -PassThru/, "Windows asks the person to confirm");
  const inner = Buffer.from(/** @type {string} */ (ran[0].match(/'-EncodedCommand','([^']+)'/)?.[1]), "base64").toString("utf16le");
  assert.match(inner, /New-NetFirewallRule -DisplayName 'Filament on the network' .* -Direction Inbound -Action Allow -Protocol TCP -LocalPort 20301 -Profile Private,Domain -RemoteAddress LocalSubnet/);
  assert.match(inner, /-Program 'C:\\it''s\\Filament\.exe'/, "a quote in a path stays inside its string");
  // (fails before: yes — PowerShell ends a single-quoted string at a curly quote too, the review of p2-lan)
  assert.equal(quoted("C:\\Bob\u2019s apps\\it's\u2018\u201A\u201B.exe"), "'C:\\Bob\u2019\u2019s apps\\it''s\u2018\u2018\u201A\u201A\u201B\u201B.exe'");
  assert.match(inner, /Disable-NetFirewallRule/);
  assert.doesNotMatch(inner, /Remove-NetFirewallRule[^\n]*Block|Block[^\n]*Remove-NetFirewallRule/, "a block is turned off, never removed");
  await assert.rejects(allowThroughFirewall({ port: 20301, run: async () => Promise.reject(new Error("This command cannot be run due to the error: The operation was canceled by the user.")) }), { message: "Windows asked to confirm, and was told no: nothing changed" });
  await assert.rejects(allowThroughFirewall({ port: 0, run: async () => "" }), /no port to open/);
  // With the artifacts' port beside it, one rule names both (the owner's remote Filament of 11-06, Part 4).
  ran.length = 0;
  await allowThroughFirewall({ port: 20343, also: [20344], run: async (s) => (ran.push(s), "") });
  const two = Buffer.from(/** @type {string} */ (ran[0].match(/'-EncodedCommand','([^']+)'/)?.[1]), "base64").toString("utf16le");
  assert.match(two, /-Protocol TCP -LocalPort 20343,20344 -Profile Private,Domain/);
  await assert.rejects(allowThroughFirewall({ port: 20343, also: [70000], run: async () => "" }), /no port to open: 70000/);
});

// (fails before: yes — a claim and a device's token were taken over plain http from anywhere; then, the review of p2-lan,
// a code sent over plain http stayed open, for whoever read it on the way to claim over https)
test("plain http from the network pairs nothing: the claim is refused in words, and the code it carried in the clear is closed, never claimed after", async () => {
  const devices = createDevices();
  const route = createRouter(remoteRoutes({ devices, machine: { get: () => ({ id: "m1", name: "Workstation" }) } }));
  const m = route("POST", "/remote/claim");
  assert.ok(m);
  /** @param {any} socket @param {string} code @param {Record<string, string>} [headers] */
  const claim = async (socket, code, headers = {}) => {
    /** @type {{ status: number, body: string }} */
    const res = /** @type {any} */ ({ status: 0, body: "", headersSent: false, setHeader() {}, writeHead(/** @type {number} */ s) { this.status = s; this.headersSent = true; return this; }, end(c = "") { this.body += c; } });
    await m.handler(/** @type {any} */ ({ req: { headers, method: "POST", socket, on() {} }, res, url: new URL("http://x/remote/claim"), path: "/remote/claim", method: "POST", params: m.params, json: async () => ({ code, name: "Laptop" }), who: null }), /** @type {any} */ ({}));
    return { status: res.status, json: JSON.parse(res.body) };
  };
  const read = devices.startPairing({ scope: "full" });
  const other = devices.startPairing({ scope: "view" });
  const plain = await claim({ remoteAddress: "192.168.1.9" }, read.code);
  assert.equal(plain.status, 403);
  assert.equal(plain.json.https, true);
  assert.match(plain.json.error, /^pairing goes over https, and this code came over plain http, so it is closed: on the machine Filament runs on, turn on Settings › Remote access › Reach this machine on my network/);
  assert.deepEqual(devices.pending().map((c) => c.id), [other.id], "the code read on the way is closed; another stays open");
  const late = await claim({ remoteAddress: "192.168.1.66", encrypted: true }, read.code);
  assert.equal(late.status, 403, "whoever read it on the way claims nothing over https");
  // A proxy on this machine that says it took the request over plain http hands on what the network read.
  const proxied = await claim({ remoteAddress: "127.0.0.1" }, other.code, { "x-forwarded-proto": "http", "x-forwarded-for": "192.168.1.9" });
  assert.deepEqual([proxied.status, proxied.json.https], [403, true]);
  const fresh = devices.startPairing({ scope: "full" });
  const sealed = await claim({ remoteAddress: "192.168.1.9", encrypted: true }, fresh.code);
  assert.equal(sealed.status, 200, "over TLS to Filament itself");
  assert.match(sealed.json.token, /^fdt_/);
});

/**
 * POST /remote/pair asked of `remoteRoutes` over `lan`, as this machine's own page asks it: its answer's JSON.
 * @param {any} lan
 */
const pairOver = async (lan) => {
  const route = createRouter(remoteRoutes(/** @type {any} */ ({ devices: createDevices(), machine: { get: () => ({ id: "m1", name: "Workstation" }) }, lan: () => lan })));
  const m = route("POST", "/remote/pair");
  assert.ok(m);
  /** @type {{ status: number, body: string }} */
  const res = /** @type {any} */ ({ status: 0, body: "", headersSent: false, setHeader() {}, writeHead(/** @type {number} */ s) { this.status = s; this.headersSent = true; return this; }, end(c = "") { this.body += c; } });
  await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "POST", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL("http://x/remote/pair"), path: "/remote/pair", method: "POST", params: m.params, json: async () => ({ scope: "full" }), who: { kind: "local" } }), /** @type {any} */ ({}));
  assert.equal(res.status, 200, res.body);
  return JSON.parse(res.body);
};
const PRINT = `${"AB:".repeat(31)}CD`;

// (fails before: yes — the sv-live hunt's: `filament settings set server.lan.enabled true`, then `filament pair` at once,
// read the listener before the save had made it, and said no other machine reaches this one)
test("a pairing waits for a save that turned the network on: its links are the listener's once it listens", async () => {
  /** @type {{ port: number } | null} */
  let listening = null;
  let settle = () => {};
  const made = new Promise((r) => (settle = () => r((listening = { port: 20343 }))));
  const lan = { state: () => ({ on: true, port: 20343, listening, error: null, fingerprint: listening ? PRINT : null, notAfter: null, addresses: listening ? ["https://192.168.1.20:20343"] : [], hostOnly: null }), settled: () => made };
  setTimeout(settle, 50);
  const p = await pairOver(lan);
  assert.equal(p.links.length, 1, JSON.stringify(p));
  assert.match(p.links[0], new RegExp(`^https://192\\.168\\.1\\.20:20343/ui/pair\\.html#code=${p.code}&fp=${"AB".repeat(31)}CD$`));
  assert.equal(p.hostOnly, null);
});

// (fails before: yes — the sv-live hunt's: inside WSL 2's NAT, its 172.x address was offered as the network's, which no
// other machine on the person's network can open)
test("WSL 2 behind its NAT: its addresses are said to open from this computer alone; mirrored or bridged networking, WSL 1 and Linux elsewhere are on the network", async () => {
  const wsl2 = "5.15.167.4-microsoft-standard-WSL2\n";
  assert.equal(wslNat(wsl2, "nat\n"), true);
  assert.equal(wslNat(wsl2, null), true, "a WSL too old to say its mode has NAT alone");
  assert.equal(wslNat("4.19.128-microsoft-standard", "nat"), true);
  assert.equal(wslNat(wsl2, "mirrored\n"), false);
  assert.equal(wslNat(wsl2, "bridged"), false);
  assert.equal(wslNat("4.4.0-19041-Microsoft", null), false, "WSL 1 shares Windows's network");
  assert.equal(wslNat("6.8.0-45-generic", null), false);

  // The listener says it while it listens, and a pairing beside its links; `filament pair` prints what the pairing says.
  const dir = scratch();
  const listener = createLanListener({ dataDir: dir, handler: (_q, s) => void s.end(), upgrade: () => {}, host: "127.0.0.1", nets: () => NETS, hostOnly: () => true });
  try {
    assert.equal(listener.state().hostOnly, null, "off: nothing to say");
    await listener.apply({ enabled: true, port: 0 });
    assert.equal(listener.state().hostOnly, WSL_NAT_WORDS);
    const p = await pairOver(listener);
    assert.equal(p.hostOnly, WSL_NAT_WORDS);
    assert.equal(p.links.length, 1);
  } finally {
    await listener.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("on the network, a device pairs over https: a stranger is sent to the pairing page, the link carries the fingerprint, the cookie is __Host- and Secure, the device drives; the firewall is read and allowed from here alone; turned off, it closes", async () => {
  /** @type {number[]} */
  const allowed = [];
  let firewallReads = 0;
  const firewall = { platform: "win32", read: async () => (firewallReads++, { networks: ["Private"], ownPorts: allowed.map(String), app: [] }), allow: async (/** @type {{ port: number, also?: number[] }} */ o) => void allowed.push(o.port, ...(o.also || [])) };
  const shim = await startApp({ configure: (c) => void (c.server.lan = { enabled: true, port: 0 }), overrides: { lanHost: "127.0.0.1", firewall } });
  try {
    const net0 = shim.started.lan;
    const port = Number(net0?.listening?.port);
    assert.ok(port > 0 && port !== shim.port, "a port of its own, beside the loopback listener");
    assert.match(String(net0.fingerprint), /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const harness = await askTls(port, "/ui/harness.html", { headers: FAR });
    assert.deepEqual([harness.status, harness.headers.location], [302, "/ui/pair.html"], "a stranger goes to the pairing page");
    assert.equal((await askTls(port, "/ui/pair.html", { headers: FAR })).status, 200);
    assert.equal((await askTls(port, "/api/state", { headers: FAR })).status, 403);
    assert.equal((await askTls(port, "/v1/models", { headers: { ...FAR, "x-api-key": shim.key } })).status, 404, "the inbound key opens nothing here");
    assert.equal((await shim.api("/v1/models")).status, 200, "on this machine it does, as it did");
    // A code made here: its links are the network's https addresses, each with the fingerprint.
    const pair = await (await shim.api("/api/remote/pair", { method: "POST", body: { scope: "full" } })).json();
    assert.ok(samePrint(pair.fingerprint, net0.fingerprint));
    const hex = String(net0.fingerprint).replace(/:/g, "");
    for (const link of pair.links) assert.match(link, new RegExp(`^https://[\\d.]+:${port}/ui/pair\\.html#code=${pair.code}&fp=${hex}$`));
    // The claim over TLS: a __Host- cookie, Secure.
    const own = { origin: `https://127.0.0.1:${port}` };
    const claimed = await askTls(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: pair.code, name: "Laptop" } });
    assert.equal(claimed.status, 200);
    const set = String(claimed.headers["set-cookie"]?.[0]);
    assert.match(set, /^__Host-filament_device=fdt_[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
    const as = { ...FAR, cookie: set.split(";")[0] };
    const state = await askTls(port, "/api/state", { headers: as });
    assert.deepEqual([state.status, state.json.viewer, state.json.device.name], [200, "remote", "Laptop"]);
    assert.equal((await askTls(port, "/ui/harness.html", { headers: as })).status, 200, "the harness opens for it");
    // The listener and the firewall, as Settings reads them: from here, and from the device.
    const here = await (await shim.api("/api/remote/lan")).json();
    assert.deepEqual([here.on, here.listening.port, here.fingerprint, here.platform], [true, port, net0.fingerprint, "win32"]);
    assert.deepEqual([here.firewall.open, here.firewall.fix], [false, true]);
    const theirs = await askTls(port, "/api/remote/lan", { headers: as });
    assert.equal(theirs.status, 200, "a full device reads it");
    // Another machine's app learning its ways reads it with no firewall run (desktop/lib/learn-routes.js).
    const reads = firewallReads;
    const lean = await askTls(port, "/api/remote/lan?firewall=0&fresh=1", { headers: as });
    assert.deepEqual([lean.status, lean.json.firewall, lean.json.listening.port, firewallReads], [200, null, port, reads]);
    assert.equal((await askTls(port, "/api/remote/lan/firewall", { method: "POST", headers: { ...as, ...own }, body: {} })).status, 403, "Windows asks the person at this machine: never from another");
    const fw = await (await shim.api("/api/remote/lan/firewall", { method: "POST", body: {} })).json();
    // The artifacts' network address listens beside it, at a port of its own: the rule opens both (Part 4).
    // A device reaches it by this machine's network address: its pages read the artifacts there, over https.
    const far = await askTls(port, "/api/state", { headers: { ...as, host: `192.168.1.20:${port}` } });
    assert.match(String(far.json.artifacts?.page), /^https:\/\/192\.168\.1\.20:\d+\/\{name\}\/$/);
    assert.match(String(state.json.artifacts?.page), /^http:\/\/\{name\}\.art\.localhost:\d+\/$/, "at a loopback name, this machine's own address");
    const art = Number(new URL(String(far.json.artifacts.page).replace("{name}", "x")).port);
    assert.ok(art > 0 && art !== port, "the artifacts' own port");
    assert.deepEqual([allowed, fw.firewall.open], [[port, art], true]);
    // (fails before: yes — s4g: no New key) A new key is made from this computer alone, served at once on its port.
    const refusedKey = await askTls(port, "/api/remote/lan/new-key", { method: "POST", headers: { ...as, ...own }, body: {} });
    assert.deepEqual([refusedKey.status, refusedKey.json?.error], [403, "a new key cuts off every machine and command line paired over the network: make it on the machine Filament runs on"]);
    assert.ok(samePrint((await askTls(art, "/", { headers: FAR })).fp, net0.fingerprint), "the artifacts' address serves the same pair");
    const keyed = await (await shim.api("/api/remote/lan/new-key", { method: "POST", body: {} })).json();
    assert.notEqual(keyed.fingerprint, net0.fingerprint);
    assert.equal(keyed.listening.port, port, "on the port it had");
    assert.ok(samePrint((await askTls(port, "/ui/pair.html", { headers: FAR })).fp, keyed.fingerprint), "the new certificate served");
    // (fails before: yes — the review of s4g: the artifacts' address served the old key until Filament started again)
    assert.ok(samePrint((await askTls(art, "/", { headers: FAR })).fp, keyed.fingerprint), "its artifacts' address too, on its port");
    // Turned off in the configuration: it closes, and the loopback listener stays.
    const cfg = (await (await shim.api("/api/state")).json()).config;
    assert.deepEqual(cfg.server.lan, { enabled: true, port: 0 });
    // (fails before: yes — the loopback listener's port was saved as the network's) Refused in words, and it listens on.
    const clash = await shim.api("/api/config", { method: "PUT", body: { ...cfg, server: { ...cfg.server, lan: { enabled: true, port: cfg.server.port } } } });
    assert.equal(clash.status, 400);
    assert.match(JSON.stringify(await clash.json()), /server\.lan\.port \d+ is server\.port/);
    assert.equal((await askTls(port, "/ui/pair.html", { headers: FAR })).status, 200, "the listener stays where it was");
    cfg.server.lan.enabled = false;
    assert.equal((await shim.api("/api/config", { method: "PUT", body: cfg })).status, 200);
    await assert.rejects(askTls(port, "/ui/pair.html"), /ECONNREFUSED|ECONNRESET/);
    const off = await (await shim.api("/api/remote/lan")).json();
    assert.deepEqual([off.on, off.listening, off.firewall], [false, null, null]);
    assert.deepEqual((await (await shim.api("/api/remote/pair", { method: "POST", body: { scope: "full" } })).json()).links, [], "off: no link");
  } finally {
    await shim.stop();
  }
});
