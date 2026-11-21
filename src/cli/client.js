// @ts-check
// The command line's way to a running Filament (the owner's of 11-05): found by its `listening.json` (cli/listening.js),
// else at the port its config names, else at the data folder's default port — and asked over this machine's loopback,
// which the admin API trusts as the harness's own page (no token). Nothing here writes the data folder: a command that
// finds no Filament says so and exits 3, and `filament start` (or the app) starts one.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultPort } from "../services/config/store.js";
import { listeningUrl, readListening } from "./listening.js";
import { CliError, EXIT, clientAt } from "../services/machines/client.js";

// A client of a Filament's admin API, its words and its exit codes: moved to services/machines/client.js, where this
// Filament's own calls to its machines read them too; said here still for the commands, which import them from here.
export { CliError, EXIT, busyOf, clientAt, readEvents, refusalWords } from "../services/machines/client.js";
/** @typedef {import("../services/machines/client.js").Client} Client */

/**
 * Where the data folder's Filament would listen: its `listening.json`, else its config's port (read, never written),
 * else the folder's default port. `from` says which.
 * @param {string} dataDir @returns {{ url: string, from: "listening" | "config" | "default", version: string | null, pid: number | null }}
 */
export function whereFilament(dataDir) {
  const l = readListening(dataDir);
  if (l) return { url: l.url, from: "listening", version: l.version || null, pid: l.pid };
  const file = join(dataDir, "config.json");
  if (existsSync(file)) {
    try {
      const server = JSON.parse(readFileSync(file, "utf8"))?.server || {};
      if (Number.isInteger(server.port) && server.port > 0) return { url: listeningUrl(server.host || "", server.port), from: "config", version: null, pid: null };
    } catch {}
  }
  return { url: listeningUrl("", defaultPort(dataDir)), from: "default", version: null, pid: null };
}

/** A folder's path to compare by: resolved, in one case on Windows. @param {string} p */
const pathKey = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));

/**
 * A client of the Filament the data folder names, once it answers; else a CliError (exit 3) that says where it looked.
 * One that answers at that address from another data folder is not it: the port was another's — its error's body says
 * that folder (`otherDataDir`), so a caller that would start one knows the port is taken.
 * @param {string} dataDir @param {{ timeoutMs?: number, fetchImpl?: typeof fetch, signal?: AbortSignal }} [o]
 */
export async function connect(dataDir, { timeoutMs = 3000, fetchImpl = fetch, signal } = {}) {
  const at = whereFilament(dataDir);
  /** @type {any} */
  let state;
  try {
    const r = await fetchImpl(`${at.url}/api/state`, { headers: { "x-filament-ui": "1" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    state = await r.json();
  } catch (/** @type {any} */ e) {
    const where = at.from === "listening" ? `at ${at.url}, where it said it listens` : `at ${at.url} (${at.from === "config" ? "its config's port" : "the default port"})`;
    throw new CliError(`No Filament answers ${where}: start it with \`filament start\` or open the Filament app. (${e?.message || e})`, EXIT.noFilament);
  }
  if (typeof state?.dataDir === "string" && state.dataDir && pathKey(state.dataDir) !== pathKey(dataDir))
    throw new CliError(`The Filament at ${at.url} runs from ${state.dataDir}, not ${dataDir}: --data-dir "${state.dataDir}" asks it.`, EXIT.noFilament, { otherDataDir: state.dataDir });
  return clientAt(at.url, state, fetchImpl, signal);
}
