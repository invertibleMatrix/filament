// @ts-check
// An app's hooks' door (the Space Apps plan of 10-29, phase 4): `POST /hook/<app>/<token>` keeps its body as a record of
// the hook's collection (services/dashboard-runner.js `hookAt`, `hookPost`). From this computer alone — the loopback,
// a Host that names this machine — and never from a web page: a request with an Origin is a browser's, refused, so a
// site cannot write into an app however it learned an address. Nothing else is answered here.
import { sendJson } from "../app/pipeline/respond.js";
import { lowerHeaders } from "../core/headers.js";
import { HOOK_BYTES } from "../core/app-hooks.js";
import { hostAllowed, isLocalCaller, readBody } from "./guards.js";

/**
 * @param {{ dashboards: Pick<import("../services/dashboard-runner.js").DashboardRunner, "hookAt" | "hookPost">,
 *   server: () => any, log?: (level: string, msg: string) => void }} o  `server`: the config's server section, now
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, path: string) => Promise<void>}
 */
export function createHookDoor({ dashboards, server, log = () => {} }) {
  return async function hookDoor(req, res, path) {
    const [raw = "", token = "", ...more] = path.slice("/hook/".length).split("/");
    let app = "";
    try {
      app = decodeURIComponent(raw);
    } catch {}
    if (more.length || !app || !token) return void sendJson(res, 404, { error: "a hook's address is /hook/<app>/<token>, as its What it may do gives it" });
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      return void sendJson(res, 405, { error: "a hook takes a POST" });
    }
    if (!isLocalCaller(req)) return void sendJson(res, 403, { error: "a hook takes a POST from this computer alone" });
    if (!hostAllowed(req, server())) return void sendJson(res, 421, { error: `Host "${req.headers.host}" does not name this machine (protects against DNS rebinding)` });
    const h = lowerHeaders(req.headers);
    if (h.origin) {
      log("warn", `hooks: refused a POST to ${app}'s hook from a web page (${String(h.origin).slice(0, 120)})`);
      return void sendJson(res, 403, { error: "a hook takes no POST from a web page" });
    }
    const at = dashboards.hookAt(app, token);
    if (!at.ok) return void sendJson(res, at.status, { error: at.error });
    /** @type {string} */
    let text;
    try {
      text = await readBody(req, HOOK_BYTES);
    } catch (/** @type {any} */ e) {
      if (e?.status === 413) return void sendJson(res, 413, { error: `a hook's body is ${HOOK_BYTES / 1024} KB at most: nothing was kept` });
      throw e;
    }
    // Looked at again once its body is in: paused, its address renewed, kept without it or deleted meanwhile, it keeps
    // nothing — answered as it would have been at once.
    const still = dashboards.hookAt(app, token);
    if (!still.ok) return void sendJson(res, still.status, { error: still.error });
    const got = dashboards.hookPost(app, still.hook, { type: String(h["content-type"] || ""), text, headers: h });
    if (!got.ok) return void sendJson(res, got.status, { error: got.error });
    sendJson(res, 202, { ok: true, id: got.id });
  };
}
