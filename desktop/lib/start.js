// @ts-check
// What the desktop app finds where Filament should listen, at its launch (HarnessV3-Native NA-D7): nothing — it starts
// its own server; a Filament — it attaches to that one, so the app can be tried beside a proxy your clients use; anything
// else — it starts nothing and says which port is taken and where to change it. Plain Node: no Electron here (NA-D13).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultPort, portOption } from "../../src/config.js";

/**
 * @typedef {{ kind: "start" }
 *   | { kind: "attach", version: string, dataDir: string, supervisor: string | null }
 *   | { kind: "refuse", why: string }} Found
 */

/**
 * The port Filament listens on for this data folder: `--port` where given, else the config's `server.port`, else the
 * folder's default (a checkout's folder its own, `defaultPort`). Only that one value is read: the app's own process
 * never opens the config's secrets — the server does.
 * @param {string} dataDir @param {string | undefined} [given]  `--port`'s text
 * @returns {number}
 */
export function portOf(dataDir, given) {
  if (given != null) return portOption(given);
  const read = serverOf(dataDir);
  // A config that is no JSON: the server's own start says so, in its words, in its log.
  return read.kind === "read" && read.port != null ? read.port : defaultPort(dataDir);
}

/**
 * The port to follow before a start again: as `portOf`, but a config that does not read keeps the port the app is on —
 * the default would be another Filament's, and that start fails on the config anyway.
 * @param {string} dataDir @param {string | undefined} given @param {number} current
 */
export function followPort(dataDir, given, current) {
  if (given != null) return portOption(given);
  return serverOf(dataDir).kind === "unreadable" ? current : portOf(dataDir);
}

/**
 * The host the app reaches Filament on, from the config's `server.host`: a wildcard or none is this machine's
 * 127.0.0.1; `localhost` stays a name (Node may listen on [::1] alone for it); an IPv6 address goes in brackets. A
 * config that does not read keeps `current`, as `followPort` does.
 * @param {string} dataDir @param {string} [current]
 */
export function hostOf(dataDir, current = "127.0.0.1") {
  const read = serverOf(dataDir);
  if (read.kind === "unreadable") return current;
  const host = read.kind === "read" ? read.host : null;
  if (!host || host === "0.0.0.0" || host === "::" || host === "[::]") return "127.0.0.1";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * The config's `server` as the app may read it — its port and host alone, never a secret.
 * @param {string} dataDir
 * @returns {{ kind: "none" } | { kind: "unreadable" } | { kind: "read", port: number | null, host: string | null }}
 */
function serverOf(dataDir) {
  const file = join(dataDir, "config.json");
  if (!existsSync(file)) return { kind: "none" };
  try {
    const server = JSON.parse(readFileSync(file, "utf8"))?.server;
    const port = Number(server?.port);
    return { kind: "read", port: Number.isInteger(port) && port > 0 && port < 65536 ? port : null, host: typeof server?.host === "string" && server.host.trim() ? server.host.trim() : null };
  } catch {
    return { kind: "unreadable" };
  }
}

/** Whether two data folders are one, as Windows reads a path (its case is no difference there). @param {string} a @param {string} b */
export const sameFolder = (a, b) => {
  const f = (/** @type {string} */ p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return f(a) === f(b);
};

/**
 * Who answers on `port` now. A Filament says its version and data folder on `/api/state` (the tray's question too); a
 * refused connection is a free port; anything else holds it. A Filament of another data folder holds it too: the app
 * would show another folder's chats as this one's. The wait is a port's answer, never a model's.
 * @param {number} port
 * @param {{ fetch?: typeof globalThis.fetch, waitMs?: number, host?: string, dataDir?: string }} [o]  `dataDir`: the
 *   app's own, which a Filament found there must serve
 * @returns {Promise<Found>}
 */
export async function foundAt(port, { fetch = globalThis.fetch, waitMs = 5000, host = "127.0.0.1", dataDir = undefined } = {}) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), waitMs);
  try {
    const r = await fetch(`http://${host}:${port}/api/state`, { headers: { "x-filament-ui": "1" }, signal: stop.signal });
    const body = /** @type {any} */ (await r.json().catch(() => null));
    if (r.ok && typeof body?.version === "string" && typeof body?.dataDir === "string") {
      if (dataDir && !sameFolder(body.dataDir, dataDir)) return { kind: "refuse", why: `port ${port} is held by a Filament of another data folder (${body.dataDir})` };
      return { kind: "attach", version: body.version, dataDir: body.dataDir, supervisor: typeof body.supervisor === "string" ? body.supervisor : null };
    }
    return { kind: "refuse", why: `another program answers on port ${port} (HTTP ${r.status}), not Filament` };
  } catch (/** @type {any} */ e) {
    const code = e?.cause?.code || e?.code;
    if (code === "ECONNREFUSED") return { kind: "start" };
    if (stop.signal.aborted) return { kind: "refuse", why: `a program holds port ${port} and gave no answer in ${Math.round(waitMs / 1000)} s` };
    return { kind: "refuse", why: `port ${port} could not be asked (${code || e?.message || e})` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How long the Filament the app attached to may give no answer before the app starts its own: longer than a restart of
 * that Filament takes (its turns' 20 s, the end, the start), so whatever runs it starts it again first.
 */
export const TAKE_OVER_MS = 45_000;

/**
 * The app attached to a Filament started elsewhere, at one of its looks: `gone` while that Filament gives no answer;
 * `take` once it gave none for `TAKE_OVER_MS` — whoever ran it quit (a terminal's Ctrl+C, say),
 * and the app starts Filament on its folder, as it does at a launch that finds nothing there.
 * @param {number | null} silentSince  when it last stopped answering, or null @param {boolean} answered @param {number} now
 * @returns {{ silentSince: number | null, gone: boolean, take: boolean }}
 */
export function attachWatch(silentSince, answered, now) {
  if (answered) return { silentSince: null, gone: false, take: false };
  const since = silentSince ?? now;
  return { silentSince: since, gone: true, take: now - since >= TAKE_OVER_MS };
}

/**
 * The words of the dialog for a port another program holds: which port, why, and where Filament's port is set.
 * `again`: Filament ran and ended, and the port was another's when it was to start again (the tray's Restart tries anew);
 * `given`: the port came from `--port`, not the config.
 * @param {number} port @param {string} why @param {string} dataDir @param {{ again?: boolean, given?: boolean }} [o]
 */
export function refusedWords(port, why, dataDir, { again = false, given = false } = {}) {
  const then = again ? "choose Restart Filament in the tray" : "open Filament again";
  return {
    title: `Port ${port} is taken`,
    message: again ? `Filament stopped and cannot start again: ${why}.` : `Filament cannot start: ${why}.`,
    detail: given
      ? `The app was started with --port ${port}. Start it on another port, or stop the program on port ${port}, then ${then}.`
      : `Filament listens on the port in its config: server.port in ${join(dataDir, "config.json")}. Change it there, or stop the program on port ${port}, then ${then}.`,
  };
}
