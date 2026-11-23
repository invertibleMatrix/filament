// @ts-check
// A WebSocket's client end in the app's main process, to another machine's Filament (b-remote: its browser host): over
// https, the certificate the machine was paired with pinned where its route pins one (the network listener's, which no
// authority signed) — any other ends the connection before a byte of the request is sent, its sign-in included — or
// checked as any site's (tailscale serve's, which an authority signed). Node's own WebSocket pins no certificate, and the
// app ships no library for one: the protocol slice here is the one Filament's own sockets speak (src/http/ws.js), text
// and binary frames and the control frames, each frame of ours masked as a client's must be. A refusal is heard with its
// status and its words, so a 401 or a 403 is told from a way that does not answer. Plain Node (NA-D13).
import http from "node:http";
import tls from "node:tls";
import { isIP } from "node:net";
import { randomBytes } from "node:crypto";
import { WsDecoder, wsAcceptKey } from "../../src/http/ws.js";
import { printOf } from "../../src/core/x509.js";
import { pinHolds } from "../../src/services/machines/key-pins.js";

/** How long the connection and its handshake may take before the dial fails. */
export const DIAL_MS = 10_000;
/**
 * How long the socket may hear nothing — Filament pings a viewer's link every 15 s (src/http/admin/browser.js
 * `VIEWER_PING_MS`) — before it is taken for gone: a machine that slept, its connection half open, answers no ping.
 */
export const QUIET_MS = 50_000;
/** The most one message of the machine's may hold. */
const MESSAGE_MAX = 64 * 1024 * 1024;

/** One frame of ours, masked: `opcode` 1 text, 2 binary, 10 pong. @param {number} opcode @param {Buffer} payload */
export function clientFrame(opcode, payload) {
  const len = payload.length;
  const head = Buffer.alloc(len < 126 ? 2 : len < 65536 ? 4 : 10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = 0x80 | len;
  else if (len < 65536) {
    head[1] = 0x80 | 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  const mask = randomBytes(4);
  const body = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

/**
 * @typedef {{ status: number, why: string }} Closed  how the socket ended: `status`, the HTTP status a refusal came with —
 *   0 where none came (no answer, the certificate another, the socket ended after it opened) —, and why, in words
 */

/**
 * A socket to a wss address. `pin`: the certificate's SHA-256 fingerprint where the route pins one, "" to check it as
 * any site's. `onOpen` once the handshake is done; `onMessage` each text message, `onBinary` each binary one; `onClose`
 * once, however it ends.
 * @param {{ url: string, headers?: Record<string, string>, pin?: string, onOpen?: () => void, onMessage?: (text: string) => void,
 *   onBinary?: (data: Buffer) => void, onClose?: (c: Closed) => void, dialMs?: number, quietMs?: number }} o
 * @returns {{ send: (text: string) => void, sendBinary: (data: Buffer) => void, close: () => void }}
 */
export function dialSocket({ url, headers = {}, pin = "", onOpen = () => {}, onMessage = () => {}, onBinary = () => {}, onClose = () => {}, dialMs = DIAL_MS, quietMs = QUIET_MS }) {
  const u = new URL(url);
  if (u.protocol !== "wss:") throw new Error(`a machine's socket is wss alone, not ${u.protocol}`);
  const port = Number(u.port || 443);
  const key = randomBytes(16).toString("base64");
  /** @type {import("node:stream").Duplex | null} */
  let sock = null;
  let ended = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let quiet = null;
  const slow = setTimeout(() => end(0, `no answer from ${u.host} in ${Math.round(dialMs / 1000)} s`), dialMs);
  slow.unref?.();
  /** @param {number} status @param {string} why */
  const end = (status, why) => {
    if (ended) return;
    ended = true;
    clearTimeout(slow);
    if (quiet) clearTimeout(quiet);
    sock?.destroy();
    req.destroy();
    onClose({ status, why });
  };
  const hush = () => {
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(() => end(0, `${u.host} said nothing for ${Math.round(quietMs / 1000)} s`), quietMs);
    quiet.unref?.();
  };
  const req = http.request({
    host: u.hostname,
    port,
    path: `${u.pathname}${u.search}`,
    headers: { ...headers, host: u.host, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": key },
    // The connection is TLS, made here: the request goes over it only once its certificate is the pinned one.
    createConnection: (/** @type {any} */ _o, /** @type {(e: Error | null, s?: any) => void} */ done) => {
      const s = tls.connect({ host: u.hostname, port, ...(isIP(u.hostname) ? {} : { servername: u.hostname }), rejectUnauthorized: !pin });
      s.once("secureConnect", () => {
        if (!pin) return done(null, s);
        const peer = s.getPeerCertificate();
        const got = peer?.fingerprint256 || "";
        // The pinned certificate, or one its key signed since (a renewal: key-pins.js).
        if (pinHolds(pin, peer)) return done(null, s);
        s.destroy();
        done(Object.assign(new Error(`the certificate at ${u.host} is ${printOf(got) || "none"}, not the one this app paired with (${printOf(pin)}): nothing was sent`), { code: "FILAMENT_PIN" }));
      });
      s.once("error", (e) => done(e));
      return undefined;
    },
  });
  req.on("error", (e) => end(0, String(e?.message || e)));
  // Refused: its status, and the words it came with — read to the socket's close, as the refusal closes it.
  req.on("response", (res) => {
    let text = "";
    const said = () => end(Number(res.statusCode) || 0, text.trim().slice(0, 500) || `HTTP ${res.statusCode}`);
    res.setEncoding("utf8");
    res.on("data", (d) => void (text.length < 2000 && (text += d)));
    res.on("close", said);
    res.on("error", said);
  });
  req.on("upgrade", (res, socket, head) => {
    clearTimeout(slow);
    sock = socket;
    if (ended) return void socket.destroy();
    if (res.headers["sec-websocket-accept"] !== wsAcceptKey(key)) return end(0, `${u.host} answered no WebSocket handshake of ours`);
    const dec = new WsDecoder(MESSAGE_MAX);
    /** @param {Buffer} chunk */
    const read = (chunk) => {
      hush();
      let frames;
      try {
        frames = dec.feed(chunk);
      } catch (/** @type {any} */ e) {
        return end(0, `${u.host} sent what is no WebSocket: ${e?.message || e}`);
      }
      for (const f of frames) {
        if (ended) return;
        if (f.opcode === 8) return end(0, `${u.host} closed the socket`);
        if (f.opcode === 9) socket.write(clientFrame(10, Buffer.alloc(0)));
        else if (f.opcode === 1) onMessage(f.text);
        else if (f.opcode === 2 && f.data) onBinary(f.data);
      }
    };
    socket.on("data", read);
    socket.on("close", () => end(0, `the socket to ${u.host} closed`));
    socket.on("error", (e) => end(0, String(e?.message || e)));
    hush();
    onOpen();
    if (head?.length) read(head);
  });
  req.end();
  return {
    send(text) {
      if (!ended && sock) sock.write(clientFrame(1, Buffer.from(text, "utf8")));
    },
    sendBinary(data) {
      if (!ended && sock) sock.write(clientFrame(2, data));
    },
    close: () => end(0, "closed here"),
  };
}
