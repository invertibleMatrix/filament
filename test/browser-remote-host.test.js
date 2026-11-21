// @ts-check
// A viewer's app hosts the agent's browser (b-remote, the owner's design of 11-08): the browser host's socket
// (`/api/browser/host`) takes, beside this machine's own app on loopback by Filament's inbound key, the desktop app of a
// paired full device at the network's door or the tailnet's, by that device's sign-in — and the chat it drives opens its
// pages there. A view-only device, another machine's agents' device, a page (an Origin), an unknown or revoked token are
// refused in words; a revoke closes the link at once, its own pages going with it alone; a viewer that answers no ping
// is gone. The doors stand here as the tailnet's hands a request on (over loopback, a proxy's headers on it) and, end to
// end, as the network listener of another Filament reached over the network, its certificate pinned by the app's own
// socket (desktop/lib/pinned-socket.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_HOST, createBrowserHost, deviceHost } from "../src/app/browser/host.js";
import { createBrowsers } from "../src/app/browser/registry.js";
import { HOST_PATH, browserUpgrade, driverOf } from "../src/http/admin/browser.js";
import { deviceCaller } from "../src/http/guards.js";
import { createDevices } from "../src/services/devices.js";
import { WsDecoder } from "../src/http/ws.js";
import { clientFrame, dialSocket } from "../desktop/lib/pinned-socket.js";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

const KEY = "the-inbound-key-of-this-test";
/** What the tailnet's door hands on: a proxy on this machine, over loopback, says whose request it was. */
const FAR = { "x-forwarded-for": "100.101.102.103" };
/** A device's sign-in, as its app's partition holds it over https. @param {string} token */
const signIn = (token) => ({ cookie: `__Host-filament_device=${token}` });

/**
 * What a stand-in page answers an op: a navigation with its load's events after it, the frame tree a blank page's.
 * @param {any} m @returns {{ result: any, events: any[] }}
 */
function answer(m) {
  if (m.op !== "cdp") return { result: null, events: [] };
  if (m.method === "Page.getFrameTree") return { result: { frameTree: { frame: { id: "F", url: "about:blank" } } }, events: [] };
  if (m.method === "Page.navigate")
    return {
      result: { loaderId: "L" },
      events: [
        { op: "event", tab: m.tab, method: "Page.frameNavigated", params: { frame: { id: "F", url: m.params.url } } },
        { op: "event", tab: m.tab, method: "Page.loadEventFired", params: {} },
      ],
    };
  if (m.method === "Accessibility.getFullAXTree") return { result: { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "A page" }, childIds: [] }] }, events: [] };
  return { result: {}, events: [] };
}

/**
 * A stand-in app over a socket: each request it hears kept, and answered as a page would, unless `mute`.
 * @param {(text: string) => void} say @param {{ mute?: boolean }} [o]
 */
function standIn(say, { mute = false } = {}) {
  /** @type {any[]} */
  const heard = [];
  return {
    heard,
    /** @param {any} m */
    hear(m) {
      heard.push(m);
      if (mute || typeof m.n !== "number") return;
      const { result, events } = answer(m);
      say(JSON.stringify({ n: m.n, ok: true, result }));
      for (const e of events) say(JSON.stringify(e));
    },
    /** The tabs it opened. */
    opened: () => heard.filter((m) => m.op === "open").map((m) => String(m.tab)),
  };
}

/**
 * The browser host's socket dialed by hand, as an app's main process dials it: refused, its status and its words;
 * taken, a stand-in app on it — its pings answered, unless `mute`.
 * @param {number} port @param {Record<string, string>} headers @param {{ mute?: boolean }} [o]
 * @returns {Promise<{ status: number, words: string, app?: ReturnType<typeof standIn>, closed?: Promise<true>, end?: () => void }>}
 */
const dialRaw = (port, headers, { mute = false } = {}) =>
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
    req.on("upgrade", (res, socket, head) => {
      socket.on("error", () => {});
      const app = standIn((text) => void socket.write(clientFrame(1, Buffer.from(text))), { mute });
      const dec = new WsDecoder();
      /** @param {Buffer} chunk */
      const read = (chunk) => {
        for (const f of dec.feed(chunk)) {
          if (f.opcode === 9 && !mute) socket.write(clientFrame(10, Buffer.alloc(0)));
          if (f.opcode === 1) app.hear(JSON.parse(f.text));
        }
      };
      socket.on("data", read);
      if (head?.length) read(head);
      resolve({ status: Number(res.statusCode), words: "", app, closed: new Promise((done) => socket.on("close", () => done(true))), end: () => socket.destroy() });
    });
    req.on("error", reject);
    req.end();
  });

/** Whether `p` settles within `ms`. @param {Promise<any>} p @param {number} ms */
const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

/**
 * The browser host's socket on a listener of its own, as server.js hands it every upgrade, over the real host set, the
 * chats' browsers and the paired devices: a full device, a second one, a view-only one, and the first's machine's
 * agents' device.
 * @param {{ pingMs?: number }} [o]
 */
async function serve({ pingMs } = {}) {
  const devices = createDevices();
  const host = createBrowserHost();
  const browsers = createBrowsers({ host });
  const config = { get: () => ({ server: { host: "127.0.0.1", inboundKeys: [KEY], allowedHosts: [], maxBodyBytes: 1 << 20 } }) };
  const upgrade = browserUpgrade({ config, browserHost: host, devices, ...(pingMs ? { pingMs } : {}) });
  const server = http.createServer((_q, s) => void s.end());
  server.on("upgrade", (req, socket, head) => void (upgrade(req, socket, head) || socket.destroy()));
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  /** @param {"full" | "view"} scope @param {string} name */
  const paired = (scope, name) => {
    const got = devices.claim(devices.startPairing({ scope }).code, { name, from: FAR["x-forwarded-for"] });
    assert.ok(got.ok);
    return got;
  };
  const laptop = paired("full", "Laptop");
  const desk = paired("full", "Desk PC");
  const phone = paired("view", "Phone");
  const agents = devices.mintAgents(laptop.device.id, { from: "Laptop" });
  assert.ok(agents.ok);
  return {
    port,
    host,
    browsers,
    devices,
    laptop,
    desk,
    phone,
    agents,
    /** @param {Record<string, string>} headers @param {{ mute?: boolean }} [o] */
    dial: (headers, o) => dialRaw(port, headers, o),
    close: () => new Promise((r) => server.close(() => r(undefined))),
  };
}

describe("the browser host's socket, at the tailnet's door", () => {
  // (fails before: yes — the socket answered this machine's app alone: another machine's call was refused 403, "the
  // browser's host connects on this machine only")
  test("a full device's app is a viewer: its link holds by the device's id, and the chat it drives opens its page there — a chat driven from here none", async () => {
    const s = await serve();
    try {
      const d = await s.dial({ ...FAR, ...signIn(s.laptop.token) });
      assert.equal(d.status, 101, d.words);
      const at = deviceHost(s.laptop.device.id);
      await until(() => s.host.linked(at), "the laptop's app linked as a viewer");
      assert.equal(s.host.linked("here"), false, "never as this machine's own app");
      // The turn route records the chat's driver as its caller's app (http/admin/browser.js `driverOf`).
      s.browsers.drive("c1", at);
      assert.equal(s.browsers.hostFor("c1"), at);
      const opened = await s.browsers.person("c1", { act: "new" });
      assert.deepEqual(opened, { ok: true });
      assert.equal(d.app?.opened().length, 1, "the chat's page opened in the laptop's app");
      assert.equal((await s.browsers.stateOf("c1")).tabs.length, 1);
      // A chat driven from this machine: no app of its own here, no Chrome — and nothing of it in the laptop's.
      const here = await s.browsers.person("c2", { act: "new" });
      assert.deepEqual(here, { ok: false, error: NO_HOST });
      assert.equal(d.app?.opened().length, 1);
      d.end?.();
      await until(() => !s.host.linked(at), "the viewer gone with its socket");
    } finally {
      await s.close();
    }
  });

  // (fails before: yes — every caller from elsewhere had the same 403, "connects on this machine only", whoever it was)
  test("refused, in words: a view-only device, another machine's agents' device, a page (an Origin), a token no one knows, none at all, a revoked one", async () => {
    const s = await serve();
    try {
      const view = await s.dial({ ...FAR, ...signIn(s.phone.token) });
      assert.equal(view.status, 403);
      assert.match(view.words, /Phone is a view-only device: it holds no chat's browser/);
      const agents = await s.dial({ ...FAR, authorization: `Bearer ${s.agents.token}` });
      assert.equal(agents.status, 403);
      assert.match(agents.words, /another machine's agents' device: their chats' pages open on this machine, never in an app of theirs/);
      const page = await s.dial({ ...FAR, ...signIn(s.laptop.token), origin: "https://evil.example" });
      assert.equal(page.status, 403);
      assert.match(page.words, /a desktop app, not a page/);
      const stranger = await s.dial({ ...FAR, ...signIn("fdt_no-such-token") });
      assert.equal(stranger.status, 401);
      assert.match(stranger.words, /none it knows — revoked, signed out, or never paired/);
      assert.equal((await s.dial({ ...FAR })).status, 401, "no sign-in at all");
      s.devices.revoke(s.desk.device.id);
      assert.equal((await s.dial({ ...FAR, ...signIn(s.desk.token) })).status, 401, "a revoked device's token");
      assert.equal(s.host.available, false, "nothing linked by any of them");
    } finally {
      await s.close();
    }
  });

  // (fails before: yes — no viewer's link was taken, so none closed on a revoke)
  test("a revoke closes the device's link at once, and only its pages go: another device's app holds its own", async () => {
    const s = await serve();
    try {
      const laptop = await s.dial({ ...FAR, ...signIn(s.laptop.token) });
      const desk = await s.dial({ ...FAR, ...signIn(s.desk.token) });
      assert.deepEqual([laptop.status, desk.status], [101, 101]);
      await until(() => s.host.linked(deviceHost(s.laptop.device.id)) && s.host.linked(deviceHost(s.desk.device.id)), "both apps linked");
      s.browsers.drive("c1", deviceHost(s.laptop.device.id));
      s.browsers.drive("c2", deviceHost(s.desk.device.id));
      assert.deepEqual(await s.browsers.person("c1", { act: "new" }), { ok: true });
      assert.deepEqual(await s.browsers.person("c2", { act: "new" }), { ok: true });
      s.devices.revoke(s.laptop.device.id);
      assert.equal(await within(/** @type {Promise<true>} */ (laptop.closed), 2000), true, "the laptop's link closed at once");
      await until(async () => (await s.browsers.stateOf("c1")).tabs.length === 0, "the laptop's chat's page gone");
      assert.equal((await s.browsers.stateOf("c2")).tabs.length, 1, "the desk's chat's page stays");
      assert.equal(s.host.linked(deviceHost(s.desk.device.id)), true);
      assert.equal(await within(/** @type {Promise<true>} */ (desk.closed), 50), false, "the desk's link stays open");
      assert.equal((await s.dial({ ...FAR, ...signIn(s.laptop.token) })).status, 401, "and it links no more");
      desk.end?.();
    } finally {
      await s.close();
    }
  });

  // (fails before: yes, by its time alone — its answers held as they were, and the app's socket, ended with no close
  // frame, stayed half open: the listener's close waited on it for good)
  test("this machine's own app as it always was: on loopback by the inbound key, no other; a device's sign-in from this machine is no key", async () => {
    const s = await serve();
    try {
      const none = await s.dial({});
      assert.equal(none.status, 403);
      assert.match(none.words, /needs Filament's inbound key/);
      assert.equal((await s.dial({ authorization: "Bearer not-the-key" })).status, 403);
      assert.equal((await s.dial({ ...signIn(s.laptop.token) })).status, 403, "this computer's caller gives the key");
      const app = await s.dial({ authorization: `Bearer ${KEY}` });
      assert.equal(app.status, 101);
      await until(() => s.host.linked("here"), "this machine's app linked");
      assert.equal(s.host.linked(deviceHost(s.laptop.device.id)), false);
      app.end?.();
    } finally {
      await s.close();
    }
  });

  // (fails before: yes — no viewer's link was pinged: one whose laptop slept held its chats' new pages on a socket
  // nobody answered)
  test("a viewer's app that answers no ping is gone after three, its pages with it; one that answers stays", async () => {
    const s = await serve({ pingMs: 40 });
    try {
      const asleep = await s.dial({ ...FAR, ...signIn(s.laptop.token) }, { mute: true });
      const awake = await s.dial({ ...FAR, ...signIn(s.desk.token) });
      assert.deepEqual([asleep.status, awake.status], [101, 101]);
      assert.equal(await within(/** @type {Promise<true>} */ (asleep.closed), 2000), true, "the silent one dropped");
      await until(() => !s.host.linked(deviceHost(s.laptop.device.id)), "the silent viewer gone");
      assert.equal(s.host.linked(deviceHost(s.desk.device.id)), true, "the one that answers holds");
      awake.end?.();
    } finally {
      await s.close();
    }
  });
});

// (fails before: yes — the network's listener answered /api/browser/host 404, "no such websocket")
test("end to end, at another Filament's network door: the app's own socket, its certificate pinned, holds the pages of the chat its device drives there; a wrong pin sends nothing; a revoke there closes it", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-remote-host-"));
  const up = await fakeUpstream((/** @type {any} */ call) => (call.kind === "anthropic" ? anthropicReply("Hello from the workstation.", { model: "m-1" }) : undefined));
  const two = await startTwoMachines({
    there: {
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    },
  });
  /** @type {{ close: () => void }[]} */
  const socks = [];
  try {
    const url = `${two.there.far.replace(/^https:/, "wss:")}${HOST_PATH}`;
    /** @param {string} pin */
    const dial = (pin) => {
      /** @type {(v: any) => void} */
      let opened = () => {};
      /** @type {(v: any) => void} */
      let closed = () => {};
      const out = {
        opened: new Promise((r) => (opened = r)),
        /** @type {Promise<{ status: number, why: string }>} */
        closed: new Promise((r) => (closed = r)),
        app: standIn((text) => sock.send(text)),
      };
      const sock = dialSocket({ url, headers: signIn(two.remote.token), pin, onOpen: () => opened(true), onMessage: (text) => out.app.hear(JSON.parse(text)), onClose: (c) => closed(c) });
      socks.push(sock);
      return out;
    };
    const wrong = dial(`${"00:".repeat(31)}00`);
    const refused = await wrong.closed;
    assert.equal(refused.status, 0);
    assert.match(refused.why, /not the one this app paired with/);
    assert.deepEqual(wrong.app.heard, [], "nothing was sent past a certificate not pinned");

    const link = dial(two.there.lan.fingerprint);
    assert.equal(await within(link.opened, 5000), true, "the link is up over the pinned certificate");
    // The device's chat: a session and a turn of its own there, which makes it the chat's driver.
    const json = { "content-type": "application/json" };
    const made = await two.ask("/api/sessions", { method: "POST", headers: json, body: JSON.stringify({ cwd: root, model: "m-1", preset: "plain" }) });
    assert.equal(made.status, 200, await made.clone().text());
    const chat = String((await made.json()).id);
    const turn = await two.ask(`/api/sessions/${encodeURIComponent(chat)}/turns`, { method: "POST", headers: json, body: JSON.stringify({ content: "hello", stream: false }) });
    assert.equal(turn.status, 200, await turn.clone().text());
    const kind = await (await two.ask(`/api/browser?chat=${encodeURIComponent(chat)}`)).json();
    assert.deepEqual([kind.available, kind.host], [true, "device"], "its pages are the device's app's");
    const opened = await two.ask(`/api/sessions/${encodeURIComponent(chat)}/browser`, { method: "POST", headers: json, body: JSON.stringify({ act: "new" }) });
    assert.equal(opened.status, 200, await opened.clone().text());
    assert.equal(link.app.opened().length, 1, "the chat's page opened in the app");
    const state = await (await two.there.api(`/api/sessions/${encodeURIComponent(chat)}/browser`)).json();
    assert.equal(state.tabs.length, 1);

    // Revoked there: the link closes at once, and its page goes.
    const gone = await two.there.api(`/api/remote/devices/${encodeURIComponent(two.remote.device.id)}`, { method: "DELETE" });
    assert.equal(gone.status, 200, await gone.clone().text());
    const ended = await link.closed;
    assert.equal(ended.status, 0);
    await until(async () => (await (await two.there.api(`/api/sessions/${encodeURIComponent(chat)}/browser`)).json()).tabs.length === 0, "the revoked app's page gone");
    const again = await dial(two.there.lan.fingerprint).closed;
    assert.equal(again.status, 401, again.why);
  } finally {
    for (const s of socks) s.close();
    await two.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — no request was its device's but by whoIs, which says a tailnet login Filament trusts first: the
// laptop's app over the tailnet was refused its link, and its turns drove the chat from this machine's app)
test("a device's own sign-in is its device's whatever else the request is: its app's link and the chat it drives are its own", async () => {
  const s = await serve();
  try {
    const laptop = s.laptop.device;
    const tokenOf = s.laptop.token;
    /** A request as a door hands it on, over a sealed way. @param {Record<string, string>} headers @returns {any} */
    const req = (headers) => ({ headers, socket: { encrypted: true, remoteAddress: "100.101.102.103" } });
    const who = deviceCaller(req(signIn(tokenOf)), s.devices);
    assert.deepEqual([who?.kind, who?.scope, who?.device.id], ["device", "full", laptop.id]);
    assert.equal(driverOf(who), deviceHost(laptop.id), "its app drives the chat");
    assert.equal(deviceCaller(req({}), s.devices), null, "no sign-in, no device");
    assert.equal(deviceCaller(/** @type {any} */ ({ headers: signIn(tokenOf), socket: { encrypted: false, remoteAddress: "192.168.0.7" } }), s.devices), null, "plain http from the network: no one's");
  } finally {
    await s.close();
  }
});
