// @ts-check
// Another machine's localhost in this app (b-tunnel, the owner's design of 11-08): the agent on that machine runs its
// dev server on its own localhost, and its page here opens http://localhost:5173 and loads it from there — the page
// believing itself on localhost, so its cookies, its CORS, its OAuth redirects and its dev server's WebSocket all hold.
// No address is rewritten. The machine's profile (lib/machine-browser.js `partitionFor`) sends its loopback — localhost
// and the names under it, 127.x, ::1 — to a proxy of this app's own on 127.0.0.1 (`proxyConfig`), every other address
// straight out of this computer's own network; the proxy carries each connection to that machine as a stream over the
// link this app holds to it (src/http/admin/tunnel.js), opened there on its loopback. It takes CONNECT (a page's https,
// and its WebSockets, which Chromium sends through a proxy so) and a plain request for an http address; a destination
// that is no loopback's is refused. It answers this app's pages alone: each proxy makes a secret of its own, which the
// pages give as its sign-in (Basic, `PROXY_USER`; lib/browser-host.js answers the profile's proxy login with it), and a
// caller without it — any other program on this computer — is answered 407 and reaches nothing. Plain Node (NA-D13).
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { MAX_STREAMS, REFUSED, WINDOW, createMux, join, loopbackOf, openBody } from "../../src/http/admin/tunnel.js";

/** The proxy's sign-in's user; its password is the proxy's own secret. */
export const PROXY_USER = "filament";
/**
 * The profile's bypass: every address straight out — but loopback, which Chromium sends straight by itself unless told
 * otherwise (`<-loopback>`), and which goes to the proxy. A PAC script cannot say it: Chromium asks none for loopback.
 */
export const PROXY_BYPASS = "*;<-loopback>";

/** A profile's proxy settings, its loopback to the proxy at `port`. @param {number} port */
export const proxyConfig = (port) => ({ mode: /** @type {const} */ ("fixed_servers"), proxyRules: `127.0.0.1:${port}`, proxyBypassRules: PROXY_BYPASS });

/** The headers of one hop alone, never handed on. */
const HOP = new Set(["connection", "proxy-connection", "keep-alive", "proxy-authorization", "proxy-authenticate", "te", "trailer", "transfer-encoding", "upgrade"]);

/** A message's headers, without its hop's — those named and those its Connection names. @param {import("node:http").IncomingHttpHeaders} h */
function handedOn(h) {
  const named = new Set(String(h.connection || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean));
  /** @type {Record<string, string | string[]>} */
  const out = {};
  for (const [k, v] of Object.entries(h)) if (v !== undefined && !HOP.has(k) && !named.has(k)) out[k] = v;
  return out;
}

const STATUS = /** @type {Record<number, string>} */ ({ 400: "Bad Request", 403: "Forbidden", 407: "Proxy Authentication Required", 502: "Bad Gateway", 503: "Service Unavailable" });

/**
 * A machine's proxy: its streams go out by `send` (the link's binary messages), the machine's frames come in by `take`.
 * `start` listens, → its port; `stop` closes it and every stream.
 * @param {{ name: () => string, send: (b: Buffer) => void, log?: (line: string) => void, window?: number, maxStreams?: number, secret?: string }} o
 *   `name`: the machine's, as its words say it
 */
export function createProxy({ name, send, log = () => {}, window = WINDOW, maxStreams = MAX_STREAMS, secret = randomBytes(24).toString("base64url") }) {
  const expected = Buffer.from(`Basic ${Buffer.from(`${PROXY_USER}:${secret}`).toString("base64")}`);
  /** @param {http.IncomingMessage} req */
  const signedIn = (req) => {
    const got = Buffer.from(String(req.headers["proxy-authorization"] || ""));
    return got.length === expected.length && timingSafeEqual(got, expected);
  };
  const realm = () => `Basic realm="Filament: ${name().replace(/["\\\r\n]/g, "")}"`;
  // The machine opens no stream here: what it opens is refused.
  const mux = createMux({ send, window, maxStreams });
  /** Every connection to the proxy, closed as it stops. @type {Set<import("node:net").Socket>} */
  const sockets = new Set();
  /** @type {http.Server | null} */
  let server = null;
  /** @type {Promise<number> | null} */
  let ready = null;
  let port = 0;
  let stopped = false;
  /** Fails a start still waiting to listen, as the proxy stops. @type {((e: Error) => void) | null} */
  let unstart = null;

  /**
   * A stream to the machine's loopback at a host and port, or what is answered in its place.
   * @param {string} hostname @param {number} at
   * @returns {{ s: import("../../src/http/admin/tunnel.js").TunnelStream } | { status: number, words: string }}
   */
  const streamTo = (hostname, at) => {
    const where = loopbackOf(hostname);
    if (!where) return { status: 403, words: `This proxy carries ${name()}'s localhost alone (localhost, 127.x, ::1), not ${hostname}.` };
    if (!Number.isInteger(at) || at < 1 || at > 65535) return { status: 400, words: `${at} is no port.` };
    const s = mux.open(openBody(at, where));
    if (!s) return { status: 503, words: stopped ? `This app's link to ${name()} went.` : `${maxStreams} connections to ${name()} are open already: another opens as one closes.` };
    return { s };
  };

  /** A plain request for an http address: sent over a stream of its own, its answer handed back. @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  const onRequest = (req, res) => {
    /** @param {number} status @param {string} words @param {Record<string, string>} [more] */
    const say = (status, words, more = {}) => {
      res.writeHead(status, { ...more, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(words);
    };
    if (!signedIn(req)) return say(407, "This proxy is the Filament app's own.", { "proxy-authenticate": realm() });
    /** @type {URL | null} */
    let u = null;
    try {
      u = new URL(String(req.url));
    } catch {}
    if (!u || u.protocol !== "http:") return say(400, "This proxy takes an http address, or CONNECT.");
    const at = Number(u.port || 80);
    const got = streamTo(u.hostname, at);
    if (!("s" in got)) return say(got.status, got.words);
    const s = got.s;
    s.joined = true;
    s.on("error", () => {});
    // No agent: an agent dials its own connection, and the request's would go to this computer's loopback. Its Host is
    // the address's, as a proxy's must be.
    const up = http.request({
      host: u.hostname,
      port: at,
      method: req.method,
      path: `${u.pathname}${u.search}`,
      headers: { ...handedOn(req.headers), host: u.host },
      setHost: false,
      createConnection: () => /** @type {any} */ (s),
    });
    up.on("response", (r) => {
      res.writeHead(r.statusCode || 502, r.statusMessage, handedOn(r.headers));
      r.pipe(res);
      // The answer whole: its stream is done.
      r.on("end", () => s.destroy());
      r.on("error", () => {
        res.destroy();
        s.destroy();
      });
    });
    up.on("error", (/** @type {any} */ e) => {
      s.destroy();
      if (res.headersSent) return void res.destroy();
      say(e?.tunnel === REFUSED ? 403 : 502, String(e?.message || e));
    });
    res.on("close", () => {
      if (res.writableFinished) return;
      up.destroy();
      s.destroy();
    });
    req.pipe(up);
  };

  /** CONNECT: a page's https or WebSocket, a stream of its own once the machine has connected it. @param {http.IncomingMessage} req @param {import("node:net").Socket} sock @param {Buffer} head */
  const onConnect = (req, sock, head) => {
    sock.on("error", () => {});
    /** @param {number} status @param {string} words @param {string} [more] */
    const say = (status, words, more = "") =>
      void sock.end(`HTTP/1.1 ${status} ${STATUS[status] || "Error"}\r\n${more}content-type: text/plain; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(words)}\r\nconnection: close\r\n\r\n${words}`);
    if (!signedIn(req)) return say(407, "This proxy is the Filament app's own.", `proxy-authenticate: ${realm()}\r\n`);
    // Its port read as written: a URL drops a scheme's own (80), and a WebSocket on localhost:80 is one.
    const at = /^(\[[0-9a-fA-F:.]+\]|[^:\[\]/]+):(\d{1,5})$/.exec(String(req.url));
    if (!at) return say(400, "CONNECT names a host and its port.");
    /** @type {URL | null} */
    let u = null;
    try {
      u = new URL(`http://${at[1]}`);
    } catch {}
    if (!u) return say(400, "CONNECT names a host and its port.");
    const got = streamTo(u.hostname, Number(at[2]));
    if (!("s" in got)) return say(got.status, got.words);
    const s = got.s;
    const lost = () => s.destroy();
    sock.once("close", lost);
    s.once("opened", () => {
      sock.off("close", lost);
      if (sock.destroyed) return void s.destroy();
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) s.write(head);
      join(sock, s);
    });
    s.once("error", (/** @type {any} */ e) => {
      if (!s.opened) say(e?.tunnel === REFUSED ? 403 : 502, String(e?.message || e));
    });
  };

  return {
    /** The proxy listening, on 127.0.0.1 at a port of its own: → the port. */
    start() {
      if (ready) return ready;
      const srv = http.createServer(onRequest);
      server = srv;
      srv.on("connect", onConnect);
      // Chromium sends a WebSocket through a proxy by CONNECT; an upgrade asked any other way is none of its.
      srv.on("upgrade", (_req, sock) => void sock.end("HTTP/1.1 400 Bad Request\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"));
      srv.on("connection", (c) => {
        if (stopped) return void c.destroy();
        sockets.add(c);
        c.on("close", () => sockets.delete(c));
      });
      ready = new Promise((resolve, reject) => {
        unstart = reject;
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
          // Stopped before it was listening: it closes now, holding no port.
          if (stopped) {
            srv.close();
            return reject(new Error(`This app's link to ${name()} went.`));
          }
          port = /** @type {import("node:net").AddressInfo} */ (srv.address()).port;
          log(`the proxy to ${name()}'s localhost listens at 127.0.0.1:${port}`);
          unstart = null;
          // Listening: an error after is said, never thrown in the app's main process.
          srv.off("error", reject);
          srv.on("error", (e) => log(`the proxy to ${name()}'s localhost: ${String(e?.message || e)}`));
          resolve(port);
        });
      });
      return ready;
    },
    /** A frame from the machine. @param {Buffer} b */
    take: (b) => mux.take(b),
    /** The link went, the switch went off, the machine went: the proxy closes, and every stream with it. @param {string} [why] */
    stop(why = "the link went") {
      if (stopped) return;
      stopped = true;
      mux.close(why);
      server?.close();
      unstart?.(new Error(`This app's link to ${name()} went.`));
      for (const c of sockets) c.destroy();
      sockets.clear();
    },
    /** Its port, 0 before it listens. */
    get port() {
      return port;
    },
    /** The streams open now. */
    get streams() {
      return mux.size;
    },
    /** The sign-in its pages give. */
    auth: { user: PROXY_USER, password: secret },
  };
}
