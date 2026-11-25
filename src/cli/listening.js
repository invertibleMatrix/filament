// @ts-check
// Where a running Filament listens, for the command line (the owner's of 11-05: "a full Filament CLI that drives and
// controls Filament"): the server writes `listening.json` in its data folder once it listens — its address, its process
// and its version — and takes it away as it stops. `filament status` and every command that asks the server reads it,
// so a port picked at start (`--port 0`) or changed since is found, never guessed from the config. A file whose process
// is gone (Filament was killed) is no Filament.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * The start lock's name, in the data folder: the Filament that starts there holds it from before it opens anything —
 * its config, its devices, its archive — until it ends. `listening.json` comes only once it listens, and a first start
 * opens memory for a minute or more before that (the hunt on x46).
 */
export const START_LOCK = "filament.lock";
/** The exit of a start refused because another Filament of its data folder starts or runs there (the app waits for it). */
export const STARTED_ALREADY = 6;

/** What the lock says, or null: none, or not (yet) a lock. @param {string} file @returns {{ pid: number, startedAt: number | null } | null} */
const lockOf = (file) => {
  try {
    const row = JSON.parse(readFileSync(file, "utf8"));
    return row && Number.isInteger(row.pid) && row.pid > 0 ? { pid: row.pid, startedAt: Number.isFinite(row.startedAt) ? row.startedAt : null } : null;
  } catch {
    return null;
  }
};

/**
 * Take the data folder's start lock for this process, before anything in the folder is opened: a second Filament on one
 * folder raced the first on its files while the first opened memory, before either listened. A lock whose process is
 * gone (killed, crashed) is taken over; one just made, its words not yet written, is read again a moment later first.
 * A folder that takes no lock file (read-only, say) starts unlocked: its own start says what fails there.
 * @param {string} dataDir
 * @param {{ pid?: number, alive?: (pid: number) => boolean, now?: () => number, pause?: (ms: number) => void }} [o]
 * @returns {{ ok: true, release: () => void } | { ok: false, pid: number, startedAt: number | null, file: string }}
 */
export function takeStartLock(dataDir, { pid = process.pid, alive = processRuns, now = Date.now, pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  const file = join(dataDir, START_LOCK);
  const release = () => {
    if (lockOf(file)?.pid === pid) rmSync(file, { force: true });
  };
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {}
  for (let tries = 0; tries < 4; tries++) {
    try {
      writeFileSync(file, `${JSON.stringify({ pid, startedAt: now() })}\n`, { flag: "wx" });
      return { ok: true, release };
    } catch (/** @type {any} */ e) {
      if (e?.code !== "EEXIST") return { ok: true, release: () => {} };
    }
    let held = lockOf(file);
    for (let looks = 0; !held && looks < 5 && existsSync(file); looks++) {
      pause(100);
      held = lockOf(file);
    }
    if (held && held.pid !== pid && alive(held.pid)) return { ok: false, pid: held.pid, startedAt: held.startedAt, file };
    // Its process gone, never a lock, or this very process's (a pid used again): taken over.
    try {
      rmSync(file, { force: true });
    } catch {}
  }
  const held = lockOf(file);
  return { ok: false, pid: held?.pid ?? 0, startedAt: held?.startedAt ?? null, file };
}
