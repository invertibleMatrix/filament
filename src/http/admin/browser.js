// @ts-check
// The admin API's browser area (HarnessV4_Browser_Plan BR1, BR4): the Browser pane's reads and acts on a chat's
// browser — what it shows, the developer's take-over and give-back, an address typed, back, forward, reload, the tabs,
// the page's size (HarnessV4_BrowserSize_Plan BS2), a site's yes taken back, the browser's data cleared, a picture of
// the page for a pane outside the app — and the
// socket a desktop app holds the browser through (`/api/browser/host`, BR-D2). That socket passes no front door, so
// it holds the guards itself: the Host check, the artifacts' fence, and no Origin — a page always sends one, an app's
// main process none. This machine's app dials it on loopback with Filament's own inbound key — the app reads it from the
// data folder it shares; a page cannot set the header, and no other program holds the key. A viewer's app (b-remote) —
// the desktop app of a paired full device, at the network's door or the tailnet's — dials it with that device's
// sign-in, and holds the pages of the chats it drives there until it goes, is revoked, or stops answering the pings.
import { sendJson } from "../../app/pipeline/respond.js";
import { guard as guardWith } from "./guard.js";
import { deviceCaller, endsWithDevice, hostAllowed, hostNameOf, isLocalCaller, safeEq, whoIs } from "../guards.js";
import { lowerHeaders } from "../../core/headers.js";
import { artifactNameOfHost, isArtifactOrigin } from "../../core/artifacts.js";
import { HEADLESS, HERE, deviceHost } from "../../app/browser/host.js";
import { wsHandshake, wsTextFrame, wsBinaryFrame, wsCloseFrame, wsPingFrame, WsDecoder } from "../ws.js";

/** The host's socket path. */
export const HOST_PATH = "/api/browser/host";
/**
 * A viewer's link is pinged this often; one that says nothing for three of them is gone — a laptop that slept, its
 * connection half open — and its pages go with it, so a chat's next page opens on a host that answers.
 */
export const VIEWER_PING_MS = 15_000;
/** How much a viewer's link holds unsent before the tunnel's frames wait behind the browser's commands. */
export const LINK_HIGH = 256 * 1024;

/**
 * A browser link's writer: the browser's frames go as they come, the tunnel's (b-tunnel, `data`) wait while the socket
 * holds `high` unsent and go as it drains — a command is never queued behind a page's bytes over a slow link; their
 * streams' credit bounds what waits. Nothing goes before `ready`, the handshake written.
 * @param {{ write: (b: Buffer) => unknown, readonly writableLength: number, on: (ev: "drain", fn: () => void) => unknown }} socket
 * @param {number} [high]
 */
export function linkWriter(socket, high = LINK_HIGH) {
  let open = false;
  /** @type {Buffer[]} */
  const held = [];
  /** @type {Buffer[]} */
  const waiting = [];
  const flush = () => {
    while (open && waiting.length && socket.writableLength < high) socket.write(/** @type {Buffer} */ (waiting.shift()));
  };
  socket.on("drain", flush);
  return {
    /** A frame of the browser's. @param {Buffer} buf */
    write(buf) {
      if (open) socket.write(buf);
      else held.push(buf);
    },
    /** A frame of the tunnel's. @param {Buffer} buf */
    data(buf) {
      waiting.push(buf);
      flush();
    },
    /** The handshake written: what was held goes, the browser's first. */
    ready() {
      open = true;
      for (const b of held.splice(0)) socket.write(b);
      flush();
    },
  };
}

/**
 * The app a turn's caller drives its chat from (guards.js `whoIs`), by its host's key (app/browser/host.js): a full
 * device's own (`device:<id>`); this machine's for this computer, the admin token, the tailnet, and another machine's
 * agents' device — whose chat is never hosted in that machine's app. Null for a view-only device, which drives nothing,
 * and for nobody known.
 * @param {import("../guards.js").Caller | null | undefined} who @returns {string | null}
 */
export function driverOf(who) {
  if (!who) return null;
  if (who.kind !== "device") return HERE;
  if (who.scope === "full") return deviceHost(who.device.id);
  return who.scope === "agent" ? HERE : null;
}

/** What a host's key says of what holds the pages: this machine's app, a device's, Chrome, or none. @param {string | null} at */
const kindOf = (at) => (at === HERE ? "app" : at === HEADLESS ? "headless" : at ? "device" : null);

/**
 * @param {any} a  the admin context: { browsers, browserHost }
 * @returns {import("../router.js").RouteRow[]}
 */
export function browserRoutes(a) {
  const { browsers, browserHost } = a;
  return [
    [
      "GET",
      "/browser",
      // Whether a browser is there for the caller's chat (`?chat=`), else for a chat the caller would drive, and what
      // holds its pages: the host its new page opens on.
      guardWith((r) => {
        const chat = r.url.searchParams.get("chat");
        const at = (chat && browsers ? browsers.hostFor(chat) : browserHost?.choose(driverOf(deviceCaller(r.req, a.devices || null) ?? r.who) || HERE)) ?? null;
        sendJson(r.res, 200, { available: !!at, version: at ? browserHost?.versionOf(at) || "" : "", host: kindOf(at) });
      }),
    ],
    [
      "GET",
      "/sessions/:id/browser",
      guardWith(async (r) => sendJson(r.res, 200, browsers ? await browsers.stateOf(decodeURIComponent(r.params.id)) : { available: false, tabs: [], active: null, taken: false, sites: [], busy: null })),
    ],
    [
      "POST",
      "/sessions/:id/browser",
      guardWith(async (r) => {
        const body = await r.json();
        if (!browsers) return sendJson(r.res, 503, { error: "this Filament has no browser" });
        const got = await browsers.person(decodeURIComponent(r.params.id), { act: String(body.act || ""), url: body.url, tab: body.tab, site: body.site, size: body.size, width: body.width, height: body.height, fit: body.fit === true, hand: body.hand === true });
        if (!got.ok) return sendJson(r.res, 409, { error: got.error });
        return sendJson(r.res, 200, { ok: true, state: await browsers.stateOf(decodeURIComponent(r.params.id)) });
      }),
    ],
    [
      "GET",
      "/sessions/:id/browser/shot",
      guardWith(async (r) => {
        const shot = browsers ? await browsers.shot(decodeURIComponent(r.params.id)).catch(() => null) : null;
        if (!shot) {
          r.res.writeHead(204, { "cache-control": "no-store" });
          return r.res.end();
        }
        const bytes = Buffer.from(shot.data, "base64");
        r.res.writeHead(200, { "content-type": shot.mediaType, "content-length": bytes.length, "cache-control": "no-store" });
        return r.res.end(bytes);
      }),
    ],
  ];
}

/** A refusal's status line. @param {number} status */
const statusWords = (status) => (status === 404 ? "Not Found" : status === 400 ? "Bad Request" : status === 401 ? "Unauthorized" : "Forbidden");

/**
 * The upgrade for an app's socket, or null where the path is another's (the terminal's): this machine's app on
 * loopback by Filament's inbound key; a viewer's app by its full device's sign-in (its cookie, or its token as a
 * Bearer), over a way no one on the network reads (guards.js `whoIs`) — a view-only device, another machine's agents'
 * device, an unknown or revoked token are refused, 403 or 401, said in words. A link's binary messages are its streams
 * to this machine's loopback (admin/tunnel.js), a viewer's alone, ended as it goes.
 * @param {{ config: any, browserHost: ReturnType<typeof import("../../app/browser/host.js").createBrowserHost>,
 *   devices?: import("../../services/devices.js").DeviceStore | null, pingMs?: number,
 *   tunnels?: ((viewer: Extract<import("../guards.js").Caller, { kind: "device" }> | null, send: (b: Buffer) => void) => { take: (b: Buffer) => void, close: (why?: string) => void }) | null }} a
 *   `devices`: the paired devices, none where no device is known; `pingMs`: a viewer's link's ping (`VIEWER_PING_MS`);
 *   `tunnels`: a link's end of its streams (admin/tunnel.js `tunnelsFor`), none where it is not given
 * @returns {(req: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => boolean}  true when it answered
 */
export function browserUpgrade(a) {
  const { config, browserHost, devices = null, pingMs = VIEWER_PING_MS, tunnels = null } = a;
  return (req, socket, head) => {
    const url = new URL(String(req.url || ""), "http://localhost");
    if (url.pathname !== HOST_PATH) return false;
    /** @param {string} why @param {number} status */
    const refuse = (why, status) => {
      socket.write(`HTTP/1.1 ${status} ${statusWords(status)}\r\nconnection: close\r\n\r\n${why}`);
      socket.destroy();
      return true;
    };
    const h = lowerHeaders(req.headers);
    if (artifactNameOfHost(hostNameOf(req)) !== null) return refuse("no such websocket", 404);
    if (isArtifactOrigin(h.origin)) return refuse("an artifact's page reaches nothing of Filament's", 403);
    // A page in a browser always sends Origin on a socket; an app's main process sends none.
    if (h.origin) return refuse("the browser's host is a desktop app, not a page", 403);
    const server = config.get().server;
    if (!hostAllowed(req, server)) return refuse("host not allowed", 403);
    /** The viewer's device, for one that dials from another machine; null for this machine's app. @type {Extract<import("../guards.js").Caller, { kind: "device" }> | null} */
    let viewer = null;
    if (isLocalCaller(req)) {
      const key = String(h.authorization || "").replace(/^bearer\s+/i, "");
      if (!key || !(server.inboundKeys || []).some((/** @type {string} */ k) => safeEq(String(k), key))) return refuse("the browser's host needs Filament's inbound key", 403);
    } else {
      // A device's own sign-in is its device's here, over the tailnet too where its login is trusted (`deviceCaller`).
      const who = deviceCaller(req, devices) ?? whoIs(req, server, devices);
      if (!who) return refuse("the browser's host on another machine is the desktop app of a device paired with this Filament, by its sign-in: this one is none it knows — revoked, signed out, or never paired", 401);
      if (who.kind !== "device") return refuse("the browser's host on another machine is the desktop app of a full device paired with this Filament, by its sign-in", 403);
      if (who.scope === "view") return refuse(`${who.device.name} is a view-only device: it holds no chat's browser`, 403);
      if (who.scope !== "full") return refuse(`${who.device.name} is another machine's agents' device: their chats' pages open on this machine, never in an app of theirs`, 403);
      viewer = who;
    }
    const wsKey = h["sec-websocket-key"];
    if (!wsKey) return refuse("not a websocket handshake", 400);
    const out = linkWriter(socket);
    const write = out.write;
    let closed = false;
    const link = {
      send: (/** @type {any} */ msg) => {
        if (!closed) write(wsTextFrame(JSON.stringify(msg)));
      },
      close: () => {
        if (closed) return;
        closed = true;
        try {
          socket.end(wsCloseFrame());
        } catch {}
      },
    };
    socket.write(wsHandshake(wsKey), () => out.ready());
    const take = viewer ? browserHost.attachViewer(viewer.device.id, link) : browserHost.attach(link);
    const tunnel = tunnels ? tunnels(viewer, (b) => void (!closed && out.data(wsBinaryFrame(b)))) : null;
    /** When the viewer's app last said anything — a pong among it. */
    let heard = Date.now();
    const ping = viewer
      ? setInterval(() => {
          if (Date.now() - heard > pingMs * 3) return void socket.destroy();
          if (!closed) write(wsPingFrame());
        }, pingMs)
      : null;
    ping?.unref?.();
    const dec = new WsDecoder(server.maxBodyBytes);
    const onChunk = (/** @type {Buffer} */ chunk) => {
      heard = Date.now();
      let frames;
      try {
        frames = dec.feed(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const f of frames) {
        if (f.opcode === 8) {
          link.close();
          return;
        }
        if (f.opcode === 9) {
          socket.write(Buffer.from([0x8a, 0x00]));
          continue;
        }
        if (f.opcode === 2 && f.data) tunnel?.take(f.data);
        if (f.opcode !== 1) continue;
        let msg = null;
        try {
          msg = JSON.parse(f.text);
        } catch {}
        if (msg) take(msg);
      }
    };
    socket.on("data", onChunk);
    if (head?.length) onChunk(head);
    // A viewer's device revoked, or signed out, holds no page more: its link closes at once, and its pages and its
    // streams go with it.
    const unhear = endsWithDevice(devices, viewer, () => socket.destroy());
    const gone = () => {
      closed = true;
      if (ping) clearInterval(ping);
      unhear();
      tunnel?.close();
      browserHost.detach(link);
      socket.destroy();
    };
    socket.on("close", gone);
    socket.on("error", gone);
    // An app that ends its side has gone, a close frame said or not: the listener keeps a socket half open else.
    socket.on("end", gone);
    return true;
  };
}
