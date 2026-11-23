// @ts-check
// A fetch pinned to one certificate (the owner's remote Filament of 11-06, Part 2): the network's listener on another
// machine serves a certificate no authority vouches for (services/lan-tls.js), so the command line and this Filament's
// own calls to its machines (index.js) trust the one whose SHA-256 fingerprint they were given — by the pairing's link,
// which came from that machine's own Settings, or by --fingerprint — and the ones its key signs as it is renewed
// (key-pins.js), no other: any other certificate ends the
// connection before a byte of the request is sent, the device token included. Names are not read: a machine's address
// changes, its certificate does not. Answers a real Response, so the client reads it as it reads fetch's: its JSON, its
// text, its event stream. Moved from cli/pinned.js, which says it still.
import http from "node:http";
import tls from "node:tls";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { printOf } from "../../core/x509.js";
import { pinHolds } from "./key-pins.js";

/** Statuses whose answer has no body: a Response with one is refused. */
const NO_BODY = new Set([101, 204, 205, 304]);
/**
 * How long a connection may be quiet before the system asks the machine whether it is still there, as fetch's own
 * connections do: one that went to sleep, its link half open, answers no such question, and the connection ends — a
 * request waiting for its answer's head with it, which no limit of its own ends.
 */
const KEEP_ALIVE_MS = 60_000;

/**
 * The fingerprint of the certificate an https address serves, read without trusting it — for the person to compare
 * with the one the machine shows before anything is sent there.
 * @param {string} url @param {{ timeoutMs?: number }} [o]
 * @returns {Promise<string>}
 */
export function certificateAt(url, { timeoutMs = 5000 } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: u.hostname, port: Number(u.port || 443), ...(isIP(u.hostname) ? {} : { servername: u.hostname }), rejectUnauthorized: false, timeout: timeoutMs });
    s.once("secureConnect", () => {
      const fp = s.getPeerCertificate()?.fingerprint256 || "";
      s.destroy();
      resolve(printOf(fp));
    });
    s.once("timeout", () => s.destroy(new Error(`no answer from ${u.host} in ${timeoutMs / 1000} s`)));
    s.once("error", reject);
  });
}

/**
 * fetch, for https addresses whose certificate is the pinned one; any other address is fetch's own. `connectMs`: how
 * long its connection may take to be made and its certificate read — a machine switched off answers no packet, and
 * the system's own wait is twenty seconds or more —, past which the fetch fails (ETIMEDOUT); none by default.
 * @param {string} pin  the certificate's SHA-256 fingerprint, in any spelling
 * @param {{ connectMs?: number }} [o]
 * @returns {typeof fetch}
 */
export function pinnedFetch(pin, { connectMs = 0 } = {}) {
  return /** @type {any} */ (
    (/** @type {any} */ input, /** @type {any} */ init = {}) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      if (u.protocol !== "https:") return fetch(input, init);
      return new Promise((resolve, reject) => {
        const signal = /** @type {AbortSignal | undefined} */ (init.signal);
        // Ended already: no request is made, which would open its connection and be heard by nothing.
        if (signal?.aborted) return reject(signal.reason);
        /** @type {Record<string, string>} */
        const headers = {};
        new Headers(init.headers || {}).forEach((v, k) => (headers[k] = v));
        const body = init.body == null ? null : Buffer.from(String(init.body));
        if (body) headers["content-length"] = String(body.length);
        const port = Number(u.port || 443);
        /** The connection made for it: until it is handed to the request, the request's end is not its own. @type {import("node:tls").TLSSocket | null} */
        let made = null;
        const req = http.request({
          host: u.hostname,
          port,
          path: `${u.pathname}${u.search}`,
          method: init.method || "GET",
          headers: { host: u.host, ...headers },
          // The connection is TLS, made here: the request goes over it only once its certificate is the pinned one.
          createConnection: (/** @type {any} */ _o, /** @type {(e: Error | null, s?: any) => void} */ done) => {
            const s = (made = tls.connect({ host: u.hostname, port, ...(isIP(u.hostname) ? {} : { servername: u.hostname }), rejectUnauthorized: false }));
            const slow = connectMs > 0 ? setTimeout(() => s.destroy(Object.assign(new Error(`no answer from ${u.host} in ${Math.round(connectMs / 100) / 10} s`), { code: "ETIMEDOUT" })), connectMs) : null;
            s.once("close", () => slow && clearTimeout(slow));
            s.once("secureConnect", () => {
              if (slow) clearTimeout(slow);
              const peer = s.getPeerCertificate();
              const got = peer?.fingerprint256 || "";
              // The pinned certificate, or one its key signed since (a renewal: key-pins.js).
              if (pinHolds(pin, peer)) return done(null, s.setKeepAlive(true, KEEP_ALIVE_MS));
              s.destroy();
              done(Object.assign(new Error(`the certificate at ${u.host} is ${printOf(got) || "none"}, not the one this command line pinned (${printOf(pin)}): nothing was sent`), { code: "FILAMENT_PIN" }));
            });
            s.once("error", (e) => done(e));
            return undefined;
          },
        });
        // Ended before its handshake did, the connection goes with it, and the fetch ends: a request handed no
        // connection yet heard nothing of its end, and waited for good on a port that never said a word of TLS — the
        // tray's look at that machine with it (the review of p3-watch).
        signal?.addEventListener("abort", () => (made?.destroy(), req.destroy(signal.reason), reject(signal.reason)), { once: true });
        req.on("response", (res) => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) for (const one of Array.isArray(v) ? v : [v]) if (one != null) h.append(k, String(one));
          const status = Number(res.statusCode);
          resolve(new Response(NO_BODY.has(status) ? (res.resume(), null) : /** @type {any} */ (Readable.toWeb(res)), { status, statusText: res.statusMessage, headers: h }));
        });
        req.on("error", reject);
        req.end(body ?? undefined);
      });
    }
  );
}
