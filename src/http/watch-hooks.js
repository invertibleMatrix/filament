// @ts-check
// A watcher's address, its door (the plan of 11-11, its v2-b): `POST /watch/<token>` is a program's post to the
// webhook watcher the token opens (app/watchers/webhook.js `at`, `wait`, `post`). No key is asked: a program posts,
// and the token is what it holds. Its reach is this computer — the loopback, handed on by no proxy — and the tailnet's
// door (guards.js `isLocalCaller`, `onTailnetDoor`), under a Host that names this machine; never the network's
// listener, which refuses the path before this is reached (front-door.js `lanDoor`), and never Tailscale Funnel, whose
// requests tailscale serve marks: those are a 404, as a path that is not there. So a watcher has no public address.
// Never a web page: a request with an Origin is a browser's, refused, so a site cannot wake a watcher however it
// learned an address. In order: anything but a POST is refused; the token is looked for among every address kept, in
// the same time whatever it is, before a byte of the body is read; the address's minute is counted (60 posts, then a
// 429 that says how long to wait); the body is read whole, 256 KB at most, as bytes — a signature is over them as they
// came —; and the address is looked at again once the body is in, since the watcher may have been changed meanwhile.
// A post taken is answered 202 with `{ "ok": true }` and no more: no id, no echo, nothing of the watcher's state.
// Nothing is thrown on from here once a token is looked for: an address in a log line is one an agent may read, and
// this door rests on no other to keep it out — the front door's own line for a handler that throws names the door
// alone (front-door.js `pathShown`). A sender that hangs up mid-body is let go in silence, and anything else that
// fails is a 500 and a log line that names no address.
import { sendJson } from "../app/pipeline/respond.js";
import { lowerHeaders } from "../core/headers.js";
import { WEBHOOK_LIMITS } from "../core/watchers.js";
import { hostAllowed, isLocalCaller, onTailnetDoor } from "./guards.js";

const NO_ADDRESS = "no watcher listens at this address: copy it again from the watcher's sheet";

/**
 * A request's body whole, as bytes, `max` at most: past it the rest is drained, so its refusal reaches the sender.
 * @param {import("node:http").IncomingMessage} req @param {number} max @returns {Promise<Buffer>}
 */
function bytesOf(req, max) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on("data", function onData(/** @type {Buffer} */ c) {
      size += c.length;
      if (size > max) {
        chunks.length = 0;
        req.off("data", onData);
        req.resume();
        reject(Object.assign(new Error("request body too large"), { status: 413 }));
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * @param {{ watch: Pick<import("../app/watchers/webhook.js").WebhookWatch, "at" | "wait" | "post">,
 *   server: () => any, log?: (level: string, msg: string) => void }} o  `server`: the config's server section, now
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, path: string) => Promise<void>}
 */
export function createWatchHookDoor({ watch, server, log = () => {} }) {
  return async function watchHookDoor(req, res, path) {
    const h = lowerHeaders(req.headers);
    // From the internet, through Tailscale Funnel: nothing here is there.
    if (h["tailscale-funnel-request"]) return void sendJson(res, 404, { error: "not found" });
    const [token = "", ...more] = path.slice("/watch/".length).split("/");
    if (more.length || !token) return void sendJson(res, 404, { error: NO_ADDRESS });
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      return void sendJson(res, 405, { error: "a watcher's address takes a POST" });
    }
    if (!isLocalCaller(req) && !onTailnetDoor(req)) return void sendJson(res, 403, { error: "a watcher's address takes a POST from this computer, or from its tailnet where Filament is served there" });
    if (!hostAllowed(req, server())) return void sendJson(res, 421, { error: `Host "${req.headers.host}" does not name this machine (protects against DNS rebinding)` });
    if (h.origin) {
      log("warn", `watch hooks: refused a POST to a watcher's address from a web page (${String(h.origin).slice(0, 120)})`);
      return void sendJson(res, 403, { error: "a watcher's address takes no POST from a web page" });
    }
    try {
      const found = watch.at(token);
      if (!found) return void sendJson(res, 404, { error: NO_ADDRESS });
      const wait = watch.wait(found);
      if (wait) {
        res.setHeader("retry-after", String(wait));
        return void sendJson(res, 429, { error: `this address takes ${WEBHOOK_LIMITS.perMinute} posts a minute: this one was not heard` });
      }
      /** @type {Buffer} */
      let body;
      try {
        body = await bytesOf(req, WEBHOOK_LIMITS.bytes);
      } catch (/** @type {any} */ e) {
        if (e?.status === 413) return void sendJson(res, 413, { error: `a post's body is ${WEBHOOK_LIMITS.bytes / 1024} KB at most: nothing was heard` });
        // Its sender hung up before its body ended: nothing was heard, and there is no one to tell.
        return;
      }
      // Looked at again once its body is in: changed, switched off, removed or given a new address meanwhile, it hears
      // nothing — answered as it would have been at once.
      const still = watch.at(token);
      if (!still) return void sendJson(res, 404, { error: NO_ADDRESS });
      const got = watch.post(still, { type: String(h["content-type"] || ""), headers: h, body });
      if (!got.ok) return void sendJson(res, got.status, { error: got.error });
      sendJson(res, 202, { ok: true });
    } catch (/** @type {any} */ e) {
      // Answered here, whatever failed, in a line that names no address.
      log("error", `watch hooks: a post to a watcher's address could not be taken (${String(e?.message || e).slice(0, 200)})`);
      if (!res.headersSent) sendJson(res, 500, { error: "the post could not be taken: nothing was heard" });
      else res.end();
    }
  };
}
