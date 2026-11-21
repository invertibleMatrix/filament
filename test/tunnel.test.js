// @ts-check
// The server's localhost in the viewer's app (b-tunnel, the owner's design of 11-08): the agent on a machine runs its dev
// server on that machine's localhost, and its page in the developer's app — on another computer — loads it from there.
// The app's proxy (desktop/lib/tunnel.js) carries each connection of the machine's profile's loopback as a stream over
// the viewer's link to the machine's browser host (src/http/admin/browser.js), whose end (src/http/admin/tunnel.js)
// opens it on its loopback — never at a port its Filament listens on, never to another host, for a full device's
// viewer's link alone; the streams capped, their bytes flow-controlled, gone with the link. The app's own guards for a
// machine's pages (desktop/lib/machine-browser.js `machineGuards`): nothing of the developer's computer's own, by any
// name. Here over the real socket and its framing, a real proxy and real loopback servers; Electron's profile on
// stand-ins. Whether Chromium sends a profile's loopback to the proxy was read on Electron 45 itself: a PAC script is
// never asked for loopback, `fixed_servers` with `*;<-loopback>` sends loopback to the proxy and the rest straight.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { EventEmitter } from "node:events";
import { WsDecoder, wsBinaryFrame, wsHandshake, wsTextFrame } from "../src/http/ws.js";
import { createBrowserHost } from "../src/app/browser/host.js";
import { HOST_PATH, browserUpgrade, linkWriter } from "../src/http/admin/browser.js";
import { CLOSE, DATA, DONE, OPEN, OPENED, REFUSED, WINDOW, createMux, frameOf, loopbackOf, openBody, tunnelEnd, tunnelsFor } from "../src/http/admin/tunnel.js";
import { createDevices } from "../src/services/devices.js";
import { clientFrame } from "../desktop/lib/pinned-socket.js";
import { PROXY_BYPASS, createProxy, proxyConfig } from "../desktop/lib/tunnel.js";
import { NAMES_MS, createPages } from "../desktop/lib/browser-host.js";
import { createMachineBrowsers, machineGuards, partitionFor } from "../desktop/lib/machine-browser.js";
import { until } from "./helpers/wait.js";

const KEY = "the-inbound-key-of-this-test";
/** What the tailnet's door hands on: a proxy on this machine, over loopback, says whose request it was. */
const FAR = { "x-forwarded-for": "100.101.102.103" };
/** @param {string} token */
const signIn = (token) => ({ cookie: `__Host-filament_device=${token}` });

/** The bytes Buffer.concat copies while `fn` runs. @param {() => void} fn */
function copiedBy(fn) {
  const concat = Buffer.concat;
  let copied = 0;
  Buffer.concat = /** @type {any} */ ((/** @type {Uint8Array[]} */ list, /** @type {number | undefined} */ total) => {
    const out = concat(list, total);
    copied += out.length;
    return out;
  });
  try {
    fn();
  } finally {
    Buffer.concat = concat;
  }
  return copied;
}

/** A server on 127.0.0.1, and its port. @param {http.Server | net.Server} server */
const listening = async (server) => {
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  return /** @type {net.AddressInfo} */ (server.address()).port;
};

/**
 * The machine (S): its browser host's socket on a listener of its own, the streams' end on it as server.js gives it,
 * over the paired devices — a full one, a view-only one, and the full one's machine's agents' device. `ports`: where
 * S's Filament is reached, its own listener's port first.
 * @param {{ ports?: number[], maxStreams?: number }} [o]
 */
async function machine({ ports = [], maxStreams } = {}) {
  const devices = createDevices();
  const host = createBrowserHost();
  const config = { get: () => ({ server: { host: "127.0.0.1", inboundKeys: [KEY], allowedHosts: [], maxBodyBytes: 1 << 20 } }) };
  /** @type {number[]} */
  const own = [];
  const upgrade = browserUpgrade({ config, browserHost: host, devices, tunnels: tunnelsFor({ places: () => ({ ports: own }), name: () => "Workstation", ...(maxStreams ? { maxStreams } : {}) }) });
  const server = http.createServer((_q, s) => void s.end("this is S's Filament"));
  server.on("upgrade", (req, socket, head) => void (upgrade(req, socket, head) || socket.destroy()));
  const port = await listening(server);
  own.push(port, ...ports);
  /** @param {"full" | "view"} scope @param {string} name */
  const paired = (scope, name) => {
    const got = devices.claim(devices.startPairing({ scope }).code, { name, from: FAR["x-forwarded-for"] });
    assert.ok(got.ok);
    return got;
  };
  const laptop = paired("full", "Laptop");
  const phone = paired("view", "Phone");
  const agents = devices.mintAgents(laptop.device.id, { from: "Laptop" });
  assert.ok(agents.ok);
  return { port, own, devices, laptop, phone, agents, close: () => new Promise((r) => server.close(() => r(undefined))) };
}

/**
 * The viewer's link dialed as the app's main process dials it, its binary messages the proxy's: refused, its status
 * and words; taken, the app's proxy on it, listening — and every frame the app sent and heard kept.
 * @param {number} port @param {Record<string, string>} headers @param {{ maxStreams?: number }} [o]
 * @returns {Promise<{ status: number, words: string, proxy?: ReturnType<typeof createProxy>, proxyPort?: number, auth?: string,
 *   sent?: Buffer[], heard?: Buffer[], raw?: (b: Buffer) => void, closed?: Promise<true>, end?: () => void }>}
 */
const link = (port, headers, { maxStreams } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: HOST_PATH,
      headers: { host: `127.0.0.1:${port}`, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers },
    });
    req.on("response", (res) => {
      let words = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (words += d));
      res.on("error", () => {});
      res.on("close", () => resolve({ status: Number(res.statusCode), words }));
    });
    req.on("upgrade", async (res, socket, head) => {
      socket.on("error", () => {});
      /** @type {Buffer[]} */
      const sent = [];
      /** @type {Buffer[]} */
      const heard = [];
      const raw = (/** @type {Buffer} */ b) => void socket.write(clientFrame(2, b));
      const proxy = createProxy({
        name: () => "Workstation",
        send: (b) => {
          sent.push(b);
          raw(b);
        },
        ...(maxStreams ? { maxStreams } : {}),
      });
      const dec = new WsDecoder();
      /** @param {Buffer} chunk */
      const read = (chunk) => {
        for (const f of dec.feed(chunk)) {
          if (f.opcode === 9) socket.write(clientFrame(10, Buffer.alloc(0)));
          if (f.opcode === 2 && f.data) {
            heard.push(f.data);
            proxy.take(f.data);
          }
        }
      };
      socket.on("data", read);
      if (head?.length) read(head);
      const closed = new Promise((done) => socket.on("close", () => done(/** @type {true} */ (true))));
      // The link gone, its proxy with it (lib/machine-browser.js `unproxy`).
      void closed.then(() => proxy.stop());
      const proxyPort = await proxy.start();
      const auth = `Basic ${Buffer.from(`${proxy.auth.user}:${proxy.auth.password}`).toString("base64")}`;
      resolve({ status: Number(res.statusCode), words: "", proxy, proxyPort, auth, sent, heard, raw, closed, end: () => socket.destroy() });
    });
    req.on("error", reject);
    req.end();
  });

/**
 * A plain request through the proxy, as Chromium sends one for an http address: its absolute form, the proxy's sign-in.
 * @param {number} proxyPort @param {string} url @param {{ auth?: string, method?: string, body?: Buffer, headers?: Record<string, string> }} [o]
 * @returns {Promise<{ status: number, body: Buffer, headers: http.IncomingHttpHeaders }>}
 */
const viaProxy = (proxyPort, url, { auth, method = "GET", body, headers = {} } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: proxyPort, method, path: url, headers: { host: new URL(url).host, ...(auth ? { "proxy-authorization": auth } : {}), ...headers } }, (res) => {
      /** @type {Buffer[]} */
      const parts = [];
      res.on("data", (d) => parts.push(d));
      res.on("end", () => resolve({ status: Number(res.statusCode), body: Buffer.concat(parts), headers: res.headers }));
      res.on("error", reject);
    });
    r.on("error", reject);
    r.end(body);
  });

/**
 * A CONNECT through the proxy: its status, and the socket where it was taken.
 * @param {number} proxyPort @param {string} target @param {string} [auth]
 * @returns {Promise<{ status: number, words: string, socket: net.Socket | null }>}
 */
const connectVia = (proxyPort, target, auth) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: target, headers: auth ? { "proxy-authorization": auth } : {} });
    r.on("connect", (res, socket, head) => {
      if (res.statusCode === 200) {
        if (head?.length) socket.unshift(head);
        return resolve({ status: 200, words: "", socket });
      }
      let words = head?.toString("utf8") || "";
      socket.on("data", (d) => (words += d));
      socket.on("close", () => resolve({ status: Number(res.statusCode), words, socket: null }));
      socket.on("error", () => {});
    });
    r.on("error", reject);
    r.end();
  });

/** A server on S's loopback, answering a path with its own words, or `big`'s bytes at /big, and an upload's size at /up. */
async function devServer() {
  const big = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 255;
  /** @type {Set<net.Socket>} */
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let n = 0;
    req.on("data", (d) => (n += d.length));
    req.on("end", () => {
      res.setHeader("set-cookie", ["sid=abc; HttpOnly", "theme=dark"]);
      if (req.url === "/big") return res.end(big);
      if (req.url === "/up") return res.end(`took ${n}`);
      res.end(`hello ${req.url} for ${req.headers.host}`);
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  // A dev server's WebSocket (its hot reload): each text message said back.
  server.on("upgrade", (req, sock) => {
    sock.write(wsHandshake(String(req.headers["sec-websocket-key"])));
    const dec = new WsDecoder();
    sock.on("data", (c) => {
      for (const f of dec.feed(c)) if (f.opcode === 1) sock.write(wsTextFrame(`echo ${f.text}`));
    });
    sock.on("end", () => sock.end());
    sock.on("error", () => {});
  });
  const port = await listening(server);
  return {
    port,
    big,
    sockets,
    close: () =>
      new Promise((r) => {
        server.close(() => r(undefined));
        for (const x of sockets) x.destroy();
      }),
  };
}

describe("the streams over the viewer's link, end to end", () => {
  // (fails before: yes — the app had no proxy and the link no streams: a remote machine's page refused every loopback
  // address, and the link's binary messages were read as text)
  test("a page's request for the machine's localhost goes through the app's proxy and the link to a server on its loopback: its Host, its cookies, a 2 MB answer and a 1 MB upload whole", async () => {
    const s = await machine();
    const dev = await devServer();
    const l = await link(s.port, { ...FAR, ...signIn(s.laptop.token) });
    try {
      assert.equal(l.status, 101, l.words);
      const page = await viaProxy(/** @type {number} */ (l.proxyPort), `http://localhost:${dev.port}/index.html?x=1`, { auth: l.auth });
      assert.equal(page.status, 200);
      assert.equal(page.body.toString(), `hello /index.html?x=1 for localhost:${dev.port}`, "the page's own Host: it believes itself on localhost");
      assert.deepEqual(page.headers["set-cookie"], ["sid=abc; HttpOnly", "theme=dark"]);
      const big = await viaProxy(/** @type {number} */ (l.proxyPort), `http://127.0.0.1:${dev.port}/big`, { auth: l.auth });
      assert.ok(big.body.equals(dev.big), `the 2 MB answer, whole (${big.body.length} bytes)`);
      const up = await viaProxy(/** @type {number} */ (l.proxyPort), `http://localhost:${dev.port}/up`, { auth: l.auth, method: "POST", body: Buffer.alloc(1024 * 1024, 1) });
      assert.equal(up.body.toString(), `took ${1024 * 1024}`);
      assert.ok((l.sent ?? []).some((f) => f[0] === OPEN), "it went as a stream of the link");
      await until(() => l.proxy?.streams === 0, "each request's stream closed once it was answered");
    } finally {
      l.end?.();
      await dev.close();
      await s.close();
    }
  });

  // (fails before: yes — no CONNECT was carried anywhere)
  test("a WebSocket — a dev server's hot reload — goes through it by CONNECT, its frames both ways", async () => {
    const s = await machine();
    const dev = await devServer();
    const l = await link(s.port, { ...FAR, ...signIn(s.laptop.token) });
    try {
      const c = await connectVia(/** @type {number} */ (l.proxyPort), `localhost:${dev.port}`, l.auth);
      assert.equal(c.status, 200, c.words);
      const sock = /** @type {net.Socket} */ (c.socket);
      const dec = new WsDecoder();
      /** @type {string[]} */
      const texts = [];
      let shook = "";
      sock.on("data", (d) => {
        if (!shook.includes("\r\n\r\n")) {
          shook += d.toString("latin1");
          const at = shook.indexOf("\r\n\r\n");
          if (at < 0) return;
          d = Buffer.from(shook.slice(at + 4), "latin1");
        }
        for (const f of dec.feed(d)) if (f.opcode === 1) texts.push(f.text);
      });
      sock.write(`GET /hmr HTTP/1.1\r\nHost: localhost:${dev.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      await until(() => shook.includes("\r\n\r\n"), "the handshake answered");
      assert.match(shook, /^HTTP\/1\.1 101 Switching Protocols/);
      sock.write(clientFrame(1, Buffer.from("update app.js")));
      sock.write(clientFrame(1, Buffer.from("x".repeat(70_000))));
      await until(() => texts.length === 2, "both said back");
      assert.deepEqual([texts[0], texts[1].length], ["echo update app.js", 70_005]);
      sock.destroy();
    } finally {
      l.end?.();
      await dev.close();
      await s.close();
    }
  });

  // (fails before: yes — there was no stream to refuse; S's own ports had no guard on such a way in)
  test("every port S's Filament listens on is refused, by plain request and by CONNECT, in words its agent reads — its own listener among them, which answers otherwise", async () => {
    const s = await machine({ ports: [20343, 20344, 41001, 41002] });
    const l = await link(s.port, { ...FAR, ...signIn(s.laptop.token) });
    try {
      for (const p of s.own) {
        const got = await viaProxy(/** @type {number} */ (l.proxyPort), `http://localhost:${p}/api/keys`, { auth: l.auth });
        assert.equal(got.status, 403, `port ${p}`);
        assert.equal(got.body.toString(), `localhost:${p} is where Workstation's Filament is reached: its API acts for the developer, so no page reaches it.`);
      }
      const v4 = await viaProxy(/** @type {number} */ (l.proxyPort), `http://127.0.0.1:${s.port}/`, { auth: l.auth });
      assert.equal(v4.status, 403);
      assert.match(v4.body.toString(), new RegExp(`^127\\.0\\.0\\.1:${s.port} is where Workstation's Filament is reached`));
      const six = await connectVia(/** @type {number} */ (l.proxyPort), `[::1]:${s.port}`, l.auth);
      assert.equal(six.status, 403);
      assert.match(six.words, new RegExp(`\\[::1\\]:${s.port} is where Workstation's Filament is reached`));
      // The listener answers anyone at its door otherwise.
      assert.equal(await (await fetch(`http://127.0.0.1:${s.port}/`)).text(), "this is S's Filament");
    } finally {
      l.end?.();
      await s.close();
    }
  });

  // (fails before: yes — no stream was refused, as none was carried)
  test("a host that is no loopback's is refused: at the app's proxy, and at S for a stream that names one", async () => {
    const s = await machine();
    const l = await link(s.port, { ...FAR, ...signIn(s.laptop.token) });
    try {
      const web = await viaProxy(/** @type {number} */ (l.proxyPort), "http://example.com/", { auth: l.auth });
      assert.equal(web.status, 403);
      assert.equal(web.body.toString(), "This proxy carries Workstation's localhost alone (localhost, 127.x, ::1), not example.com.");
      const lan = await connectVia(/** @type {number} */ (l.proxyPort), "192.168.1.20:443", l.auth);
      assert.equal(lan.status, 403);
      // At S, by the frames themselves: an IPv4 address outside 127/8, a host kind none knows.
      const before = (l.heard ?? []).length;
      l.raw?.(frameOf(OPEN, 9001, Buffer.from([0x14, 0xe9, 4, 10, 0, 0, 1])));
      l.raw?.(frameOf(OPEN, 9002, Buffer.from([0x14, 0xe9, 9])));
      await until(() => (l.heard ?? []).length >= before + 2, "S answered both");
      const answers = (l.heard ?? []).slice(before).map((f) => ({ kind: f[0], id: f.readUInt32BE(1), code: f[5], words: f.subarray(6).toString() }));
      assert.deepEqual(answers, [
        { kind: CLOSE, id: 9001, code: REFUSED, words: "The tunnel to Workstation carries its own localhost alone (localhost, 127.x, ::1): the stream named a host that is no loopback's." },
        { kind: CLOSE, id: 9002, code: REFUSED, words: "The tunnel to Workstation carries its own localhost alone (localhost, 127.x, ::1): the stream named a host that is no loopback's." },
      ]);
    } finally {
      l.end?.();
      await s.close();
    }
  });

  // (fails before: yes, for this machine's own app's link — its binary messages were read as text and dropped, never
  // refused in words; the view-only and agents' devices were refused their link already, b-remote)
  test("a view-only device and another machine's agents' device have no link to open a stream on; this machine's own app's link opens none", async () => {
    const s = await machine();
    const dev = await devServer();
    try {
      const view = await link(s.port, { ...FAR, ...signIn(s.phone.token) });
      assert.equal(view.status, 403);
      assert.match(view.words, /Phone is a view-only device/);
      const agents = await link(s.port, { ...FAR, authorization: `Bearer ${s.agents.token}` });
      assert.equal(agents.status, 403);
      assert.match(agents.words, /another machine's agents' device/);
      const here = await link(s.port, { authorization: `Bearer ${KEY}` });
      assert.equal(here.status, 101);
      const got = await viaProxy(/** @type {number} */ (here.proxyPort), `http://localhost:${dev.port}/`, { auth: here.auth });
      assert.equal(got.status, 403);
      assert.equal(got.body.toString(), "Only the desktop app of a full device that views Workstation carries pages to its localhost.");
      assert.equal(dev.sockets.size, 0, "nothing reached the server");
      here.end?.();
      // The end S gives a link by its viewer's scope: a view-only one's opens none.
      /** @type {Buffer[]} */
      const out = [];
      const end = tunnelsFor({ places: () => ({ ports: [] }), name: () => "Workstation" })({ scope: "view" }, (b) => void out.push(b));
      end.take(frameOf(OPEN, 1, openBody(dev.port, { kind: 0 })));
      assert.equal(out[0][0], CLOSE);
      assert.equal(out[0][5], REFUSED);
    } finally {
      await dev.close();
      await s.close();
    }
  });

  // (fails before: yes — no stream existed to end)
  test("the link closing ends its streams: S's connection to its server closes, and the app's connection through the proxy with it; a revoke does the same", async () => {
    const s = await machine();
    /** @type {net.Socket[]} */
    const held = [];
    const hold = net.createServer((c) => void held.push(c.on("error", () => {})));
    const holdPort = await listening(hold);
    try {
      const l = await link(s.port, { ...FAR, ...signIn(s.laptop.token) });
      const c = await connectVia(/** @type {number} */ (l.proxyPort), `127.0.0.1:${holdPort}`, l.auth);
      assert.equal(c.status, 200);
      await until(() => held.length === 1, "S connected the stream");
      const there = held[0];
      const gone = new Promise((r) => there.on("close", r));
      const appSide = new Promise((r) => /** @type {net.Socket} */ (c.socket).on("close", r));
      l.end?.();
      await gone;
      await appSide;
      // Revoked: the link closes at once, and its streams.
      const l2 = await link(s.port, { ...FAR, ...signIn(s.laptop.token) });
      const c2 = await connectVia(/** @type {number} */ (l2.proxyPort), `127.0.0.1:${holdPort}`, l2.auth);
      assert.equal(c2.status, 200);
      await until(() => held.length === 2, "S connected the second");
      const second = new Promise((r) => held[1].on("close", r));
      s.devices.revoke(s.laptop.device.id);
      await second;
      await l2.closed;
    } finally {
      for (const c of held) c.destroy();
      await new Promise((r) => hold.close(() => r(undefined)));
      await s.close();
    }
  });
});

describe("caps", () => {
  // (fails before: yes — nothing capped a link's streams)
  test("a link holds so many streams at once: past the cap, refused in words — at S, and at the app's proxy", async () => {
    const s = await machine({ maxStreams: 2 });
    /** @type {net.Socket[]} */
    const held = [];
    const hold = net.createServer((c) => void held.push(c.on("error", () => {})));
    const holdPort = await listening(hold);
    const l = await link(s.port, { ...FAR, ...signIn(s.laptop.token) });
    try {
      const a = await connectVia(/** @type {number} */ (l.proxyPort), `127.0.0.1:${holdPort}`, l.auth);
      const b = await connectVia(/** @type {number} */ (l.proxyPort), `127.0.0.1:${holdPort}`, l.auth);
      const c = await connectVia(/** @type {number} */ (l.proxyPort), `127.0.0.1:${holdPort}`, l.auth);
      assert.deepEqual([a.status, b.status, c.status], [200, 200, 403]);
      assert.equal(c.words, "2 streams are open on this link already: another opens as one closes");
      a.socket?.destroy();
      await until(() => held.length === 2 && held[0].destroyed, "the first's stream closed at S");
      const d = await connectVia(/** @type {number} */ (l.proxyPort), `127.0.0.1:${holdPort}`, l.auth);
      assert.equal(d.status, 200, "one opens as one closed");
      b.socket?.destroy();
      d.socket?.destroy();
    } finally {
      l.end?.();
      for (const x of held) x.destroy();
      await new Promise((r) => hold.close(() => r(undefined)));
      await s.close();
    }
    // The app's own proxy holds its cap too.
    /** @type {Buffer[]} */
    const out = [];
    const p = createProxy({ name: () => "Workstation", send: (f) => void out.push(f), maxStreams: 1 });
    const port = await p.start();
    const auth = `Basic ${Buffer.from(`${p.auth.user}:${p.auth.password}`).toString("base64")}`;
    const first = connectVia(port, "localhost:5173", auth);
    await until(() => out.length === 1, "the first stream opened");
    const second = await connectVia(port, "localhost:5173", auth);
    assert.equal(second.status, 503);
    assert.equal(second.words, "1 connections to Workstation are open already: another opens as one closes.");
    p.stop();
    await assert.rejects(first, { code: "ECONNRESET" }, "the first is closed as the proxy stops");
  });

  // (fails before: yes — nothing held a stream's bytes back)
  test("a big download waits on its reader: no more than the window and the reader's own buffer cross the link, and all of it arrives once it is read", async () => {
    /** @type {ReturnType<typeof createMux>} */
    let app;
    /** @type {ReturnType<typeof createMux>} */
    let far;
    let crossed = 0;
    /** @type {import("../src/http/admin/tunnel.js").TunnelStream | null} */
    let source = null;
    far = createMux({
      send: (b) => setImmediate(() => app.take(b)),
      onOpen: (id) => {
        source = far.accept(id);
        source.joined = true;
      },
    });
    app = createMux({
      send: (b) => setImmediate(() => far.take(b)),
    });
    const sink = /** @type {import("../src/http/admin/tunnel.js").TunnelStream} */ (app.open(Buffer.from([0, 80, 0])));
    sink.joined = true;
    const counting = app.take;
    app.take = (b) => {
      if (b[0] === DATA) crossed += b.length - 5;
      counting(b);
    };
    await until(() => source !== null, "the far end took the stream");
    const body = Buffer.alloc(8 * 1024 * 1024);
    for (let i = 0; i < body.length; i += 4096) body[i] = i & 255;
    const writing = new Promise((r) => /** @type {any} */ (source).end(body, r));
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(crossed <= WINDOW + sink.readableHighWaterMark, `${crossed} bytes crossed with nothing read: the window is ${WINDOW}, the reader's buffer ${sink.readableHighWaterMark}`);
    assert.ok(crossed > 0);
    /** @type {Buffer[]} */
    const got = [];
    sink.on("data", (d) => got.push(d));
    await new Promise((r) => sink.on("end", r));
    await writing;
    assert.ok(Buffer.concat(got).equals(body), "every byte, in order");
  });

  // (fails before: yes — nothing held a peer to its window)
  test("an end that sends past the window it was granted fails its stream, said", async () => {
    /** @type {Buffer[]} */
    const out = [];
    const mux = createMux({ send: (b) => void out.push(b) });
    const s = /** @type {import("../src/http/admin/tunnel.js").TunnelStream} */ (mux.open(Buffer.from([0, 80, 0])));
    s.joined = true;
    s.pause();
    /** @type {any} */
    let failed = null;
    s.on("error", (e) => (failed = e));
    // Nothing read: the window, and the reader's own buffer granted as it filled, then past them.
    for (let sent = 0; sent <= 2 * WINDOW && !failed; sent += 32 * 1024) mux.take(frameOf(DATA, s.id, Buffer.alloc(32 * 1024)));
    await until(() => failed !== null, "the stream failed");
    assert.equal(failed.message, "the other end sent past the window it was granted");
    assert.equal(out.at(-1)?.[0], CLOSE, "said to the other end");
  });
});

describe("the app's proxy", () => {
  // (fails before: yes — there was no proxy)
  test("a caller without its secret — another program on this computer — is answered 407 and opens no stream; a wrong secret the same", async () => {
    /** @type {Buffer[]} */
    const out = [];
    const p = createProxy({ name: () => "Workstation", send: (f) => void out.push(f) });
    const port = await p.start();
    try {
      const none = await viaProxy(port, "http://localhost:5173/");
      assert.equal(none.status, 407);
      assert.equal(none.headers["proxy-authenticate"], 'Basic realm="Filament: Workstation"');
      const wrong = await viaProxy(port, "http://localhost:5173/", { auth: `Basic ${Buffer.from("filament:guess").toString("base64")}` });
      assert.equal(wrong.status, 407);
      const tunnel = await connectVia(port, "localhost:5173");
      assert.equal(tunnel.status, 407);
      const guessed = await connectVia(port, "localhost:5173", `Basic ${Buffer.from(`filament:${p.auth.password}x`).toString("base64")}`);
      assert.equal(guessed.status, 407);
      assert.deepEqual(out, [], "nothing went to the machine");
      assert.notEqual(createProxy({ name: () => "x", send: () => {} }).auth.password, p.auth.password, "each proxy's secret its own");
    } finally {
      p.stop();
    }
  });

  // (fails before: yes — the review of b-tunnel: the port came from a URL, which drops 80, so CONNECT localhost:80 was 400)
  test("CONNECT to port 80 opens a stream to port 80: a dev server's WebSocket on localhost:80", async () => {
    /** @type {Buffer[]} */
    const out = [];
    const p = createProxy({ name: () => "Workstation", send: (f) => void out.push(f) });
    const port = await p.start();
    const auth = `Basic ${Buffer.from(`filament:${p.auth.password}`).toString("base64")}`;
    const asked = connectVia(port, "localhost:80", auth).catch(() => null);
    try {
      await until(() => out.length > 0, "an OPEN sent");
      assert.equal(out[0][0], OPEN);
      assert.deepEqual(out[0].subarray(5), openBody(80, /** @type {any} */ (loopbackOf("localhost"))));
    } finally {
      p.stop();
      await asked;
    }
  });

  // (fails before: yes — the review of b-tunnel: a CLOSE that said DONE before OPENED destroyed the stream with no error,
  // and the CONNECT waiting on it was never answered)
  test("a stream the machine closes before it opened answers its CONNECT 502", async () => {
    /** @type {Buffer[]} */
    const out = [];
    const p = createProxy({ name: () => "Workstation", send: (f) => void out.push(f) });
    const port = await p.start();
    try {
      const asked = connectVia(port, "localhost:5173", `Basic ${Buffer.from(`filament:${p.auth.password}`).toString("base64")}`);
      await until(() => out.length > 0, "an OPEN sent");
      p.take(frameOf(CLOSE, out[0].readUInt32BE(1), Buffer.from([DONE])));
      const got = await asked;
      assert.equal(got.status, 502);
      assert.match(got.words, /the stream closed before it opened/);
    } finally {
      p.stop();
    }
  });

  // (fails before: yes — the review of b-handoff: the fix for a CLOSE before OPENED took S's own streams, which hear no
  // OPENED, for streams that never opened: a joined one the app closed was cut short, its unread bytes dropped)
  test("on S, a stream the app closes after it opened ends: every byte it sent reaches a server slow to read them, and its socket is ended", async () => {
    let heard = 0;
    let ended = false;
    let reset = false;
    // The server reads nothing for a while: what the app sent waits on S as the CLOSE comes.
    const server = net.createServer({ allowHalfOpen: true }, (c) => {
      c.pause();
      setTimeout(() => c.resume(), 300);
      c.on("data", (d) => void (heard += d.length));
      c.on("end", () => {
        ended = true;
        c.end();
      });
      c.on("error", () => void (reset = true));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {net.AddressInfo} */ (server.address()).port;
    /** @type {Buffer[]} */
    const out = [];
    // S's socket to the server, watched: one destroyed before it ended was cut short, whatever bytes it held dropped.
    let cutShort = false;
    /** @param {net.NetConnectOpts} o */
    const connect = (o) => {
      const sock = net.connect(o);
      const destroy = sock.destroy.bind(sock);
      sock.destroy = (/** @type {any} */ e) => {
        if (!sock.writableEnded) cutShort = true;
        return destroy(e);
      };
      return sock;
    };
    const end = tunnelEnd({ send: (b) => void out.push(b), viewer: true, places: () => ({ ports: [] }), connect });
    try {
      end.take(frameOf(OPEN, 7, openBody(port, /** @type {any} */ (loopbackOf("127.0.0.1")))));
      await until(() => out.some((b) => b[0] === OPENED), "OPENED sent");
      for (let sent = 0; sent < WINDOW; sent += 32 * 1024) end.take(frameOf(DATA, 7, Buffer.alloc(32 * 1024, 7)));
      end.take(frameOf(CLOSE, 7, Buffer.from([DONE])));
      await until(() => ended || reset, "the server's socket ended");
      assert.equal(heard, WINDOW, "every byte reached the server");
      assert.equal(reset, false);
      assert.equal(cutShort, false, "its socket ended, never destroyed before");
    } finally {
      end.close();
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  // (fails before: yes — the review of b-tunnel: a proxy stopped before it was listening left its start waiting for
  // ever — and, where its address is looked up first, bound after, its port held)
  test("a proxy stopped before it listens never does: its start fails, its port none", async () => {
    const p = createProxy({ name: () => "Workstation", send: () => {} });
    const starting = p.start();
    p.stop();
    await assert.rejects(starting, /This app's link to Workstation went\./);
    assert.equal(p.port, 0);
  });

  // (fails before: yes — a remote machine's profile had no proxy)
  test("the profile's settings: loopback to the proxy, every other address straight — Chromium's own loopback bypass lifted, as a PAC script cannot", () => {
    assert.deepEqual(proxyConfig(41234), { mode: "fixed_servers", proxyRules: "127.0.0.1:41234", proxyBypassRules: "*;<-loopback>" });
    assert.equal(PROXY_BYPASS, "*;<-loopback>", "the last rule first: loopback is not bypassed, then every host is");
  });
});

// (fails before: yes — the review of b-tunnel: the tunnel's bytes were written as they came, and a browser command
// waited behind all of them over a slow link)
test("the link's writer: past its mark of unsent bytes the tunnel's frames wait and the browser's go ahead of them; as it drains they go, in order", () => {
  const sock = /** @type {any} */ (new EventEmitter());
  /** @type {string[]} */
  const sent = [];
  sock.writableLength = 0;
  sock.write = (/** @type {Buffer} */ b) => void sent.push(b.toString());
  const w = linkWriter(sock, 100);
  w.write(Buffer.from("cmd0"));
  w.data(Buffer.from("d0"));
  assert.deepEqual(sent, [], "nothing before the handshake");
  w.ready();
  assert.deepEqual(sent, ["cmd0", "d0"]);
  sock.writableLength = 150;
  w.data(Buffer.from("d1"));
  w.data(Buffer.from("d2"));
  w.write(Buffer.from("cmd1"));
  assert.deepEqual(sent.slice(2), ["cmd1"], "the command goes ahead of the waiting bytes");
  sock.writableLength = 0;
  sock.emit("drain");
  assert.deepEqual(sent.slice(3), ["d1", "d2"]);
});

// (fails before: yes — every chunk joined the whole of what was held: a 4 MB message in 16 KB chunks copied 547 MB)
test("WsDecoder: a message that comes in many chunks is joined once — the bytes copied grow with its size, not its square; a binary message comes as its bytes", () => {
  const body = Buffer.alloc(4 * 1024 * 1024, 7);
  const frame = wsBinaryFrame(body);
  const dec = new WsDecoder();
  /** @type {import("../src/http/ws.js").WsMessage[]} */
  const got = [];
  const copied = copiedBy(() => {
    for (let at = 0; at < frame.length; at += 16 * 1024) got.push(...dec.feed(frame.subarray(at, at + 16 * 1024)));
  });
  assert.equal(got.length, 1);
  assert.equal(got[0].opcode, 2);
  assert.ok(got[0].data && got[0].data.equals(body), "the binary message's bytes, as sent");
  assert.ok(copied < 3 * frame.length, `copied ${copied} bytes for a ${frame.length}-byte frame`);
});

/** Stand-ins for the Electron a machine's pages use: its pages, their window, their profile. */
function fakeElectron() {
  /** @type {any[]} */
  const views = [];
  class WebContents extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      const dbg = /** @type {any} */ (new EventEmitter());
      dbg.attached = false;
      dbg.attach = () => void (dbg.attached = true);
      dbg.isAttached = () => dbg.attached;
      dbg.detach = () => void (dbg.attached = false);
      dbg.sendCommand = async () => ({});
      this.debugger = dbg;
    }
    async loadURL() {}
    setWindowOpenHandler() {}
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      this.destroyed = true;
    }
  }
  class View {
    constructor() {
      this.webContents = new WebContents();
      views.push(this);
    }
    setBounds() {}
  }
  class Win {
    constructor() {
      this.contentView = { addChildView: () => {}, removeChildView: () => {} };
    }
    isDestroyed() {
      return false;
    }
    destroy() {}
  }
  class Profile extends EventEmitter {
    constructor() {
      super();
      /** @type {any} */
      this.before = null;
      /** @type {any} */
      this.started = null;
      /** @type {any[]} */
      this.proxies = [];
      this.closedAll = 0;
      this.reloaded = 0;
      /** Each name and what it resolves to here. @type {Record<string, string[]>} */
      this.dns = {};
      /** @type {string[]} */
      this.resolved = [];
      this.webRequest = { onBeforeRequest: (/** @type {any} */ f) => (this.before = f), onResponseStarted: (/** @type {any} */ f) => (this.started = f) };
    }
    setPermissionRequestHandler() {}
    setPermissionCheckHandler() {}
    /** @param {any} c */
    async setProxy(c) {
      this.proxies.push(c);
    }
    async closeAllConnections() {
      this.closedAll++;
    }
    async forceReloadProxyConfig() {
      this.reloaded++;
    }
    /** @param {string} host */
    async resolveHost(host) {
      this.resolved.push(host);
      if (!this.dns[host]) throw new Error("net::ERR_NAME_NOT_RESOLVED");
      return { endpoints: this.dns[host].map((address) => ({ address, family: address.includes(":") ? "ipv6" : "ipv4" })) };
    }
  }
  const ses = new Profile();
  return { electron: /** @type {any} */ ({ WebContentsView: View, BrowserWindow: Win, session: { fromPartition: () => ses } }), ses, views };
}

/** Whether the profile cancels a request. @param {any} ses @param {string} url @param {string} resourceType @param {any} [webContents] @returns {Promise<boolean>} */
const cancels = (ses, url, resourceType, webContents = null) => new Promise((resolve) => ses.before({ url, resourceType, webContents }, (/** @type {{ cancel: boolean }} */ r) => resolve(r.cancel)));

/** This computer's Filament, as its own link says it is reached: its ports, its LAN address and name, its tailnet's address. */
const HERE = { ports: [20300, 20343, 20344], names: ["127.0.0.1", "192.168.1.4", "laptop"], origins: ["https://laptop.tail0.ts.net"] };

/**
 * A machine's pages as main.js makes them: its profile, the machine's guards over where this computer's Filament is
 * reached, one tab open — and its link's proxy set, unless `tunneled` is false; `clock`, the pages' own.
 * @param {{ tunneled?: boolean, clock?: () => number }} [o]
 */
async function machinePages({ tunneled = true, clock = Date.now } = {}) {
  const f = fakeElectron();
  /** @type {any[]} */
  const said = [];
  /** @type {ReturnType<typeof createPages> | null} */
  let made = null;
  const guards = machineGuards({ here: () => HERE, tunneled: () => !!made?.proxying() });
  made = createPages({ electron: f.electron, send: (m) => said.push(m), partition: partitionFor("m-box"), clock, ...guards });
  await made.handle({ op: "open", tab: "t1" });
  if (tunneled) await made.proxy({ port: 41234, user: "filament", password: "s3cret" });
  return { f, said, pages: made, wc: f.views[0].webContents };
}

describe("a machine's pages in the app", () => {
  // (fails before: yes — b-remote refused every loopback address of a machine's page, at any port: its dev server too;
  // and its profile had no proxy)
  test("with its link's proxy, localhost, 127.x and ::1 are the machine's — let go to the proxy —, the profile's settings say so, and the proxy's sign-in is given to that proxy alone", async () => {
    const m = await machinePages();
    assert.deepEqual(m.f.ses.proxies, [proxyConfig(41234)]);
    assert.equal(m.f.ses.closedAll, 1, "connections made the other way closed");
    assert.equal(m.f.ses.reloaded, 1, "the proxy reloaded before a page counts on it");
    for (const url of ["http://localhost:5173/", "http://127.0.0.1:8080/api", "http://[::1]:3000/", "ws://localhost:5173/hmr", "http://app.localhost:5173/", "http://my_app.localhost:5173/", "http://localhost:20300/"])
      assert.equal(await cancels(m.f.ses, url, "xhr"), false, url);
    assert.deepEqual(m.f.ses.resolved, [], "no loopback name is resolved here: the machine resolves it");
    /** @param {any} info */
    const login = (info) => {
      /** @type {any[]} */
      const given = [];
      let prevented = false;
      m.wc.emit("login", { preventDefault: () => (prevented = true) }, {}, info, (/** @type {string} */ u, /** @type {string} */ p) => given.push([u, p]));
      return { prevented, given };
    };
    assert.deepEqual(login({ isProxy: true, host: "127.0.0.1", port: 41234, realm: "Filament: Workstation" }), { prevented: true, given: [["filament", "s3cret"]] });
    assert.deepEqual(login({ isProxy: true, host: "127.0.0.1", port: 41235 }), { prevented: false, given: [] }, "another proxy");
    assert.deepEqual(login({ isProxy: false, host: "localhost", port: 41234 }), { prevented: false, given: [] }, "a site's own sign-in");
    await m.pages.proxy(null);
    assert.deepEqual(m.f.ses.proxies.at(-1), { mode: "direct" });
    assert.equal(m.pages.proxying(), false);
    assert.deepEqual(login({ isProxy: true, host: "127.0.0.1", port: 41234 }), { prevented: false, given: [] }, "no proxy: nothing given");
    assert.equal(await cancels(m.f.ses, "http://localhost:5173/", "mainFrame", m.wc), true, "no proxy: this computer's localhost refused");
    assert.match(m.said.at(-1).words, /its localhost is the machine the chat runs on only while the app's link to it holds/);
  });

  // (fails before: yes — the guards compared the address's words alone: these names went straight to this computer's
  // loopback, past the proxy, which takes loopback's own names and addresses)
  test("a name that resolves to this computer's loopback — lvh.me, localtest.me, this computer's own name — is refused before its request goes, said to the tab's agent; another name goes; 0.0.0.0 and :: are refused", async () => {
    const m = await machinePages();
    Object.assign(m.f.ses.dns, { "lvh.me": ["127.0.0.1"], "localtest.me": ["::1", "127.0.0.1"], "127.0.0.1.nip.io": ["127.0.0.1"], "localhost.localdomain": ["127.0.0.1"], "debian-laptop": ["127.0.1.1"], "shop.test": ["93.184.215.14"] });
    for (const host of ["lvh.me", "localtest.me", "127.0.0.1.nip.io", "localhost.localdomain", "debian-laptop"]) assert.equal(await cancels(m.f.ses, `http://${host}:5173/`, "xhr"), true, host);
    assert.equal(await cancels(m.f.ses, "http://lvh.me:5173/", "mainFrame", m.wc), true);
    assert.deepEqual(m.said.at(-1), {
      op: "note",
      tab: "t1",
      words: "The page tried to go to http://lvh.me:5173/: lvh.me resolves to 127.0.0.1, the loopback of the developer's own computer, where this chat's browser runs, and the browser opens nothing of that computer's own. The machine the chat runs on is reached as localhost (or 127.0.0.1).",
    });
    assert.equal(await cancels(m.f.ses, "https://shop.test/", "mainFrame", m.wc), false);
    assert.equal(await cancels(m.f.ses, "https://no-such-name.test/", "mainFrame", m.wc), true, "a name whose lookup fails lets nothing by");
    assert.match(m.said.at(-1).words, /no-such-name\.test did not resolve, so it was not opened/);
    for (const url of ["http://0.0.0.0:5173/", "http://[::]:5173/"]) assert.equal(await cancels(m.f.ses, url, "mainFrame", m.wc), true, url);
    assert.match(m.said.at(-1).words, /0\.0\.0\.0 and :: reach the computer the browser runs on/);
  });

  // (fails before: yes — nothing watched where a request landed)
  test("a request that landed on this computer's loopback past the check — its name resolved anew between — closes its tab, said to the agent; one the proxy carried is the machine's", async () => {
    const m = await machinePages();
    m.f.ses.started({ url: "http://localhost:5173/app.js", ip: "127.0.0.1", webContents: m.wc });
    assert.deepEqual(m.pages.ids(), ["t1"], "through the proxy: its address is the proxy's");
    m.f.ses.started({ url: "https://shop.test/", ip: "93.184.215.14", webContents: m.wc });
    assert.deepEqual(m.pages.ids(), ["t1"]);
    m.f.ses.started({ url: "http://rebind.test:8080/", ip: "127.0.0.1", webContents: m.wc });
    assert.deepEqual(m.pages.ids(), [], "its tab closed");
    assert.deepEqual(m.said.at(-1), {
      op: "gone",
      tab: "t1",
      why: "The page tried to go to http://rebind.test:8080/: rebind.test resolves to 127.0.0.1, the loopback of the developer's own computer, where this chat's browser runs, and the browser opens nothing of that computer's own. The machine the chat runs on is reached as localhost (or 127.0.0.1).",
    });
  });

  // (fails before: yes — a machine's pages knew this computer's Filament at its main port alone: its tailnet's address,
  // where "Trust my own tailnet login" lets a page act as the person, went)
  test("this computer's own Filament, wherever its link says it is reached — its tailnet's address, its LAN address at each door, a name for it — is refused; another port of that address goes", async () => {
    const m = await machinePages();
    m.f.ses.dns["laptop.local"] = ["192.168.1.4"];
    for (const url of ["https://laptop.tail0.ts.net/ui/harness.html", "https://192.168.1.4:20343/api/keys", "http://laptop:20300/", "https://laptop.local:20344/x"])
      assert.equal(await cancels(m.f.ses, url, "mainFrame", m.wc), true, url);
    assert.equal(m.said.at(-1).words, "The page tried to go to https://laptop.local:20344/x, the Filament of the developer's own computer, where this chat's browser runs: its API acts for the developer, so the browser never opens it.");
    assert.equal(await cancels(m.f.ses, "http://192.168.1.4:5173/", "mainFrame", m.wc), false);
    m.f.ses.started({ url: "https://rebind.test:20343/", ip: "192.168.1.4", webContents: m.wc });
    assert.deepEqual(m.pages.ids(), [], "landed on it: its tab closed");
  });

  // (fails before: yes — the review of b-tunnel: with the link's proxy, every loopback address was let go, and Chromium
  // sends IPv4 as IPv6 writes it straight out, to this computer's own loopback — its Filament at another port among it;
  // a link-local address went to the proxy, refused, and its tab closed in words of loopback)
  test("while its link carries the machine's localhost, loopback written any other way — IPv4 as IPv6 writes it, a trailing dot — and a link-local address are refused", async () => {
    const m = await machinePages();
    for (const url of ["http://[::ffff:127.0.0.1]:5173/", "http://[::ffff:7f00:1]:20301/ui/harness.html", "ws://[::ffff:127.0.0.1]:5173/hmr", "http://localhost.:5173/"])
      assert.equal(await cancels(m.f.ses, url, "xhr"), true, url);
    assert.equal(await cancels(m.f.ses, "http://[::ffff:127.0.0.1]:20301/ui/harness.html", "mainFrame", m.wc), true);
    assert.match(m.said.at(-1).words, /is reached as localhost \(or a name under it\), 127\.x or \[::1\] alone; loopback written another way may reach the developer's own computer/);
    for (const url of ["http://169.254.169.254/latest/meta-data/", "http://[fe80::1]/", "http://[::ffff:169.254.1.1]/"]) assert.equal(await cancels(m.f.ses, url, "mainFrame", m.wc), true, url);
    assert.match(m.said.at(-1).words, /a link-local address \(169\.254\.x, fe80::\) is no one's while this chat's browser carries the machine's localhost/);
    m.f.ses.started({ url: "http://[::ffff:7f00:1]:5173/", ip: "::ffff:127.0.0.1", webContents: m.wc });
    assert.deepEqual(m.pages.ids(), [], "one that landed past the check closes its tab: the proxy never carries it");
    const off = await machinePages({ tunneled: false });
    assert.equal(await cancels(off.f.ses, "http://169.254.1.1/", "mainFrame", off.wc), false, "with no link's proxy, a link-local address goes straight");
  });

  // (fails before: yes — the review of b-tunnel: a name whose lookup failed was let by, and kept so for 10 s, while the
  // request's own lookup after it could answer this computer's loopback)
  test("a name whose lookup fails is refused, said, and kept so as any answer is: a rebinding name's failed answer lets nothing by, and its next is read", async () => {
    let at = 1_000_000;
    const m = await machinePages({ clock: () => at });
    assert.equal(await cancels(m.f.ses, "http://rebind.test:5173/", "mainFrame", m.wc), true);
    assert.match(m.said.at(-1).words, /rebind\.test did not resolve, so it was not opened/);
    m.f.ses.dns["rebind.test"] = ["127.0.0.1"];
    assert.equal(await cancels(m.f.ses, "http://rebind.test:5173/", "xhr"), true, "the failure kept: refused still");
    assert.equal(m.f.ses.resolved.filter((h) => h === "rebind.test").length, 1);
    at += NAMES_MS;
    assert.equal(await cancels(m.f.ses, "http://rebind.test:5173/", "xhr"), true, "asked again: loopback now, refused");
    assert.equal(m.f.ses.resolved.filter((h) => h === "rebind.test").length, 2);
  });

  // (fails before: yes — each pages made on the profile added a listener of its own, kept after they went)
  test("a machine's pages made again on its profile — its switch off and on — leave no listener behind", async () => {
    const f = fakeElectron();
    for (let i = 0; i < 3; i++) {
      const pages = createPages({ electron: f.electron, send: () => {}, partition: partitionFor("m-box") });
      await pages.handle({ op: "open", tab: `t${i}` });
      assert.equal(f.ses.listenerCount("will-download"), 1, `pages ${i + 1}`);
      pages.destroy();
    }
    assert.equal(f.ses.listenerCount("will-download"), 0);
  });
});

describe("a machine's proxy as its link comes and goes", () => {
  /** The machines' browsers over stand-ins: a link dialed by hand, each proxy made kept. */
  function rig() {
    let kept = [{ id: "m-box", name: "Workstation", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: "AB" }], partition: "persist:machine-m-box", addedAt: 1, browser: true }];
    /** @type {any[]} */
    const dials = [];
    /** @type {any[]} */
    const pages = [];
    /** @type {any[]} */
    const proxies = [];
    const mb = createMachineBrowsers({
      machines: () => /** @type {any} */ (kept),
      cookieOf: async () => "__Host-filament_device=fdt_box",
      keep: (id, on) => {
        kept = kept.map((m) => (m.id === id ? { ...m, browser: on } : m));
        return /** @type {any} */ (kept.find((m) => m.id === id) ?? null);
      },
      pagesFor: () => {
        const p = {
          /** @type {any[]} */ proxied: [],
          /** @type {any[]} */ handled: [],
          /** @param {any} conf */
          proxy: async (conf) => void p.proxied.push(conf),
          /** @param {any} msg */
          handle: async (msg) => void p.handled.push([msg.n, p.proxied.length]),
          closeAll: () => {},
          destroy: () => {},
        };
        pages.push(p);
        return /** @type {any} */ (p);
      },
      pick: /** @type {any} */ (async (/** @type {any} */ m) => ({ route: m.routes[0], tried: [] })),
      dial: /** @type {any} */ ((/** @type {any} */ o) => {
        const d = { ...o, /** @type {Buffer[]} */ binary: [], closed: 0 };
        dials.push(d);
        return { send: () => {}, sendBinary: (/** @type {Buffer} */ b) => void d.binary.push(b), close: () => void d.closed++ };
      }),
      proxyFor: /** @type {any} */ ((/** @type {any} */ m, /** @type {(b: Buffer) => void} */ send) => {
        const at = proxies.length;
        const x = { machine: m, send, taken: /** @type {Buffer[]} */ ([]), stopped: /** @type {string[]} */ ([]), auth: { user: "filament", password: `pw${at}` }, start: async () => 41000 + at, take: (/** @type {Buffer} */ b) => void x.taken.push(b), stop: (/** @type {string} */ why) => void x.stopped.push(why) };
        proxies.push(x);
        return x;
      }),
      wait: /** @type {any} */ (() => 0),
      clear: () => {},
    });
    const settle = async () => {
      for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
    };
    return { mb, dials, pages, proxies, settle, drop: (/** @type {string} */ id) => void (kept = kept.filter((m) => m.id !== id)) };
  }

  // (fails before: yes — a machine's link carried no proxy)
  test("the link up: a proxy of its own, the profile sent to it before the machine's first word is done; the machine's frames are the proxy's, the proxy's go out on the link", async () => {
    const t = rig();
    t.mb.sync();
    await t.settle();
    const d = t.dials[0];
    d.onOpen();
    d.onMessage(JSON.stringify({ n: 1, op: "open", tab: "t1" }));
    await t.settle();
    assert.equal(t.proxies.length, 1);
    assert.deepEqual(t.pages[0].proxied, [{ port: 41000, user: "filament", password: "pw0" }]);
    assert.deepEqual(t.pages[0].handled, [[1, 1]], "its first word handled once the profile went to the proxy");
    assert.equal(t.mb.proxyOf("m-box"), t.proxies[0]);
    d.onBinary(Buffer.from([2, 0, 0, 0, 1]));
    assert.deepEqual(t.proxies[0].taken, [Buffer.from([2, 0, 0, 0, 1])]);
    t.proxies[0].send(Buffer.from([1, 0, 0, 0, 7]));
    assert.deepEqual(d.binary, [Buffer.from([1, 0, 0, 0, 7])]);
  });

  // (fails before: yes — there was no proxy to end)
  test("the proxy and its streams go as the link drops, as the switch goes off, and as the machine goes from the window — its pages' localhost sent nowhere", async () => {
    const t = rig();
    t.mb.sync();
    await t.settle();
    t.dials[0].onOpen();
    await t.settle();
    t.dials[0].onClose({ status: 0, why: "the socket closed" });
    await t.settle();
    assert.deepEqual(t.proxies[0].stopped, ["the socket closed"]);
    assert.deepEqual(t.pages[0].proxied.at(-1), null);
    assert.equal(t.mb.proxyOf("m-box"), null);

    const u = rig();
    u.mb.sync();
    await u.settle();
    u.dials[0].onOpen();
    await u.settle();
    u.mb.set("m-box", false);
    await u.settle();
    assert.deepEqual(u.proxies[0].stopped, ["this app let the machine's browser go"]);
    assert.deepEqual(u.pages[0].proxied.at(-1), null);

    const v = rig();
    v.mb.sync();
    await v.settle();
    v.dials[0].onOpen();
    await v.settle();
    v.drop("m-box");
    v.mb.sync();
    await v.settle();
    assert.deepEqual(v.proxies[0].stopped, ["this app let the machine's browser go"]);
    assert.equal(v.dials[0].closed, 1);
  });
});
