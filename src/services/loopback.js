// @ts-check
// Filament's calls to its own front door — an agent loop's model call, memory's, the assistant's, a replay, a ping —
// sent over loopback with node:http and answered as fetch answers: a Response whose body streams. Not Node's fetch:
// its dispatcher waits 300 s for a reply's head and 300 s between two chunks of its body, then fails whatever its
// caller asked (the G2 drive's run 4: a sub-agent's call its provider never answered died there, "fetch failed",
// before the call's own 600 s bound or the front door's watchdog could act, and nothing tried it again). A call here
// waits as long as its caller's signal lets it, and an abort carries the signal's reason, before the head or mid-body,
// as fetch's does. Node's own agent carries it: sockets kept alive, an idle one closed after 5 s — long before the
// front door closes an idle one (65 s), so a call never meets a socket being closed under it — and a socket in use
// has no deadline.
import { request } from "node:http";
import { Readable } from "node:stream";

/** The statuses whose reply has no body (fetch answers them with a null body). */
const BODILESS = new Set([204, 205, 304]);

/**
 * POST `body` to `url` on loopback. A call that names no user agent goes as `node`, the name Node's fetch gave it:
 * the records' By client and memory's client of a loop's model call are built on it, and memory stays out of a call
 * named `Filament-…`.
 * @param {string} url
 * @param {{ headers: Record<string, string>, body: string, signal?: AbortSignal | null }} init
 * @returns {Promise<Response>}
 */
export function loopbackPost(url, { headers, body, signal = null }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    /** @type {import("node:http").IncomingMessage | null} */
    let got = null;
    const req = request(url, { method: "POST", headers: { "user-agent": "node", ...headers } });
    const onAbort = () => (got || req).destroy(signal?.reason);
    const done = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort);
    req.on("error", (e) => {
      done();
      reject(e);
    });
    req.on("response", (res) => {
      got = res;
      res.on("close", done);
      const h = new Headers();
      for (let i = 0; i < res.rawHeaders.length; i += 2) h.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
      const status = /** @type {number} */ (res.statusCode);
      if (BODILESS.has(status)) {
        res.resume();
        return resolve(new Response(null, { status, headers: h }));
      }
      resolve(new Response(/** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(res)), { status, headers: h }));
    });
    req.end(body);
  });
}
