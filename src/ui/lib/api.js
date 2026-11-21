// @ts-check
// Admin JSON client. Every dashboard call goes through here so the CSRF header (`x-filament-ui`) and
// the error shape stay in one place. `createApi` is the seam a future Electron / remote-dashboard
// shell uses to point at a different origin; the default talks to this process.

/**
 * A fetch-shaped function. The real `fetch` qualifies; tests and an Electron shell may pass a stub
 * that only implements `ok` / `json` / `statusText`.
 * @typedef {{ ok: boolean, status?: number, statusText?: string, json: () => Promise<any> }} ApiResponse
 * @typedef {object} ApiOptions
 * @property {string} [base]  prefix in front of `path` (default `/api`)
 * @property {Record<string, string>} [headers]
 * @property {(input: string, init?: RequestInit) => Promise<ApiResponse>} [fetchImpl]
 */

/** What a view-only device's page says where it would ask the server for a write: never the server's refusal. */
export const VIEW_ONLY_REFUSED = "This device is view-only: it reads this Filament and changes nothing on it";
/** The page is a view-only device's (/api/state's `device`): its clients ask no write. */
let viewOnly = false;
/** @param {boolean} on */
export const setViewOnly = (on) => {
  viewOnly = on === true;
};
/** Whether this page is a view-only device's: a door that writes past the client (a stream's POST) asks it. */
export const viewOnlyNow = () => viewOnly;
/** /api/state as a page read it: whether the device it is reads alone (its scope "view"). @param {any} st */
export const viewOnlyOf = (st) => st?.device?.scope === "view";
/**
 * Whether a view-only device's page asks the server for this: a GET, or its own sign-out — what the server takes from
 * it (remote.js `viewReads`).
 * @param {string} path @param {{ method?: string } | undefined} init
 */
const viewAsks = (path, init) => {
  const method = String(init?.method || "GET").toUpperCase();
  return method === "GET" || (method === "POST" && String(path).split("?")[0] === "/remote/sign-out");
};

/**
 * Every client asks no write of the server on a view-only device's page (`setViewOnly`, the harness's and the
 * console's alike): it is refused here, in the page's words (`VIEW_ONLY_REFUSED`, `viewOnly` on its body), as the
 * server would refuse it. `take`: the harness's own say, read by its fetch (ui/harness/lib/api.js `taking`): false for a
 * write that takes no chat over.
 * @param {ApiOptions} [opts]
 * @returns {(path: string, init?: { method?: string, body?: any, headers?: Record<string, string>, signal?: AbortSignal, take?: boolean }) => Promise<any>}
 */
export function createApi({ base = "/api", headers = {}, fetchImpl = fetch } = {}) {
  const defaults = { "content-type": "application/json", "x-filament-ui": "1", ...headers };
  return async (path, opts = {}) => {
    if (viewOnly && !viewAsks(path, opts)) throw Object.assign(new Error(VIEW_ONLY_REFUSED), { status: 403, body: { error: VIEW_ONLY_REFUSED, viewOnly: true } });
    const r = await fetchImpl(`${base}${path}`, {
      headers: defaults,
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    // The status and the body ride the error, so a caller can tell "not there" (404) from "not reachable now", and
    // read what the refusal says beside its words (a read-only tab's `readOnly`, decision 22).
    if (!r.ok) throw Object.assign(new Error(j.errors ? j.errors.join("; ") : j.error || r.statusText), { status: r.status, body: j });
    return j;
  };
}

// This computer's press — an ask answered, a call's Always allow, a mode or a rule that lets the agent do more unasked —
// carries the desktop app's key while the app holds one (http/guards.js `pressRefusal`): the bridge of the app's window
// hands it to Filament's own page alone (desktop/harness-preload.cjs, dashboard-preload.cjs `filamentApp.pressKey`),
// and each write of the page sends it. A browser has no bridge, and sends none.
const PRESS_HEADER = "x-filament-press";
/** The key as the bridge gave it; asked again where it gave none. @type {Promise<string> | null} */
let pressKey = null;
/** The window's bridge that hands this page the app's key; null in a browser, whose writes go at once. @returns {any} */
export const pressBridge = () => {
  const bridge = /** @type {any} */ (globalThis).filamentApp;
  return typeof bridge?.pressKey === "function" ? bridge : null;
};
/** The header a write carries the app's key in: none where the app gave none. @param {any} bridge @returns {Promise<Record<string, string>>} */
export const pressHeaders = async (bridge) => {
  pressKey ??= Promise.resolve()
    .then(() => bridge.pressKey())
    .then((k) => (typeof k === "string" ? k : ""), () => "");
  const k = await pressKey;
  if (!k) pressKey = null;
  return k ? { [PRESS_HEADER]: k } : {};
};
/**
 * The reads that are presses (http/admin/press.js), each by the end of its path: the keys other apps call Filament
 * with, and a watcher's address a program posts to — neither is handed to a caller without the app's key.
 */
const PRESS_READS = ["/api/keys", "/address"];
/**
 * `fetch`, a write carrying the app's key where the window's bridge gives one; a read never, but the few that are
 * presses (`PRESS_READS`). @param {string} url @param {RequestInit} [init]
 */
export const pressFetch = (url, init = {}) => {
  const read = String(init.method || "GET").toUpperCase() === "GET";
  const bridge = read && !PRESS_READS.some((p) => String(url).split("?")[0].endsWith(p)) ? null : pressBridge();
  return bridge ? pressHeaders(bridge).then((h) => fetch(url, { ...init, headers: { .../** @type {Record<string, string>} */ (init.headers), ...h } })) : fetch(url, init);
};

/** Same contract the dashboard has always used: `api("/state")`, `api("/config", { method: "PUT", body })`. */
export const api = createApi({ fetchImpl: pressFetch });
