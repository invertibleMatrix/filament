// @ts-check
// Where a running Filament listens, for the command line (the owner's of 11-05: "a full Filament CLI that drives and
// controls Filament"): the server writes `listening.json` in its data folder once it listens — its address, its process
// and its version — and takes it away as it stops. `filament status` and every command that asks the server reads it,
// so a port picked at start (`--port 0`) or changed since is found, never guessed from the config. A file whose process
// is gone (Filament was killed) is no Filament.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The file's name, in the data folder. */
export const LISTENING_FILE = "listening.json";

/**
 * What the file says. `url`: where this machine reaches it — a wildcard host is 127.0.0.1, an IPv6 address bracketed.
 * @typedef {{ url: string, host: string, port: number, pid: number, version: string, startedAt: number }} Listening
 */

/**
 * The URL this machine reaches a listener at. @param {string} host @param {number} port
 */
export function listeningUrl(host, port) {
  const h = String(host || "").trim();
  const at = !h || h === "0.0.0.0" || h === "::" || h === "[::]" ? "127.0.0.1" : h.includes(":") && !h.startsWith("[") ? `[${h}]` : h;
  return `http://${at}:${port}`;
}

/**
 * Write it, as the server listens. What fails is the caller's to log: a Filament that cannot write it still serves.
 * @param {string} dataDir @param {Omit<Listening, "url">} o
 */
export function writeListening(dataDir, o) {
  /** @type {Listening} */
  const row = { url: listeningUrl(o.host, o.port), ...o };
  writeFileSync(join(dataDir, LISTENING_FILE), `${JSON.stringify(row, null, 2)}\n`);
  return row;
}

/**
 * Take it away, as the server stops — only where it is this process's: a second Filament's on the same folder stays.
 * @param {string} dataDir @param {number} pid
 */
export function removeListening(dataDir, pid) {
  const now = readListening(dataDir, { alive: () => true });
  if (now && now.pid !== pid) return;
  rmSync(join(dataDir, LISTENING_FILE), { force: true });
}

/** Whether a process runs. @param {number} pid */
export const processRuns = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (/** @type {any} */ e) {
    // EPERM: it runs, as another user's.
    return e?.code === "EPERM";
  }
};

/**
 * What the file says, or null: none, unreadable, or its process gone.
 * @param {string} dataDir @param {{ alive?: (pid: number) => boolean }} [o]
 * @returns {Listening | null}
 */
export function readListening(dataDir, { alive = processRuns } = {}) {
  try {
    const row = JSON.parse(readFileSync(join(dataDir, LISTENING_FILE), "utf8"));
    if (!row || typeof row.url !== "string" || !Number.isInteger(row.port) || !Number.isInteger(row.pid)) return null;
    return alive(row.pid) ? row : null;
  } catch {
    return null;
  }
}
