// @ts-check
// One SQLite database per app (core/app-sql.js), each run in a process of its own apart from Filament's: started at
// the app's first statement, given one statement at a time, ended at a statement's time (SQL_TIMEOUT_MS) — the
// statement said stopped, the next one on a new process — and when the app asked nothing for a while. An app's process
// is its alone, so a slow app makes no other wait, and its stop rolls back nothing of another's. Each app's database
// is `<dataDir>/app-sql/<name>.sqlite`, the temporary files SQLite makes for it (a temporary table, a big sort) in
// `<name>.tmp/` beside it, both forgotten with the app. Its page asks through `filament.sql` on its own address
// (http/artifacts.js); a still preview's statement runs `readOnly`, held by the authorizer to reading.
import { fork } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SQL_DB_MAX_MB, SQL_DIR, SQL_TIMEOUT_MS, SQL_WAITING_MAX, sqlRefusal } from "../core/app-sql.js";
import { isArtifactName } from "../core/artifacts.js";

const CHILD = fileURLToPath(new URL("./app-sql-child.js", import.meta.url));

/**
 * What an app's process is given of Filament's environment: what Windows needs alone, never the keys Filament's own
 * environment may hold; its temporary folder is the app's own (`tmp`), where SQLite writes what it keeps aside —
 * TEMP and TMP on Windows, SQLITE_TMPDIR and TMPDIR elsewhere. Electron's own Node, where Filament runs in the app; a
 * plain Node ignores it.
 * @param {string} tmp
 */
export const sqlEnvOf = (tmp) => {
  /** @type {Record<string, string>} */
  const env = { ELECTRON_RUN_AS_NODE: "1", TEMP: tmp, TMP: tmp, TMPDIR: tmp, SQLITE_TMPDIR: tmp };
  for (const k of ["SystemRoot", "SYSTEMROOT"]) if (process.env[k]) env[k] = String(process.env[k]);
  return env;
};

/**
 * @typedef {{ ok: true, rows: Record<string, unknown>[], columns: string[], changes: number, lastId: number | string | null, more: boolean }
 *   | { ok: false, error: string }} SqlAnswer
 * @typedef {{ run: (name: string, sql: unknown, params?: unknown, o?: { readOnly?: boolean }) => Promise<SqlAnswer>, drop: (name: string) => Promise<void>,
 *   fileOf: (name: string) => string, stop: () => Promise<void> }} AppSql
 * @typedef {{ name: string, child: import("node:child_process").ChildProcess | null, gone: Promise<void>, waiting: Map<number, (m: any) => void>,
 *   idle: NodeJS.Timeout | null, turn: Promise<void>, queued: number, dropping: boolean }} Lane  one app's process and its statements
 */

/**
 * @param {{ dataDir: string, timeoutMs?: number, maxMb?: number, idleMs?: number, log?: (line: string) => void }} o
 *   `timeoutMs`: one statement's time; `maxMb`: each database's cap; `idleMs`: how long an app's process waits for its next
 * @returns {AppSql}
 */
export function createAppSql({ dataDir, timeoutMs = SQL_TIMEOUT_MS, maxMb = SQL_DB_MAX_MB, idleMs = 60_000, log = () => {} }) {
  const dir = join(dataDir, SQL_DIR);
  /** @type {Map<string, Lane>} */
  const lanes = new Map();
  let seq = 0;
  let stopped = false;

  const fileOf = (/** @type {string} */ name) => join(dir, `${name}.sqlite`);
  const tmpOf = (/** @type {string} */ name) => join(dir, `${name}.tmp`);

  /** @param {string} name */
  const laneOf = (name) => {
    let l = lanes.get(name);
    if (!l) lanes.set(name, (l = { name, child: null, gone: Promise.resolve(), waiting: new Map(), idle: null, turn: Promise.resolve(), queued: 0, dropping: false }));
    return l;
  };

  /** An app's process ended — at a statement's time, an idle while, or by itself: whatever waited on it is answered. @param {Lane} l @param {string} why */
  const end = (l, why) => {
    const c = l.child;
    l.child = null;
    if (l.idle) clearTimeout(l.idle);
    l.idle = null;
    if (c && c.exitCode === null && c.signalCode === null) c.kill();
    for (const [, answer] of l.waiting) answer({ ok: false, error: why });
    l.waiting.clear();
  };

  /** @param {Lane} l */
  const childOf = (l) => {
    if (l.child) return l.child;
    mkdirSync(tmpOf(l.name), { recursive: true });
    const c = fork(CHILD, [], { env: sqlEnvOf(tmpOf(l.name)), execArgv: ["--no-warnings"], stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
    let said = "";
    c.stderr?.on("data", (d) => (said = (said + d).slice(-2000)));
    // Its files are let go once it has ended: a drop waits for that.
    l.gone = new Promise((resolve) => c.once("exit", () => resolve()));
    c.on("message", (/** @type {any} */ m) => {
      const answer = l.waiting.get(m?.id);
      l.waiting.delete(m?.id);
      answer?.(m);
    });
    c.on("exit", (code) => {
      if (l.child !== c) return;
      const last = said.trim().split("\n").at(-1) || "";
      log(`app-sql: a process ended (${code ?? "a signal"})${last ? `: ${last}` : ""}`);
      end(l, `Not run: the process that runs this app's SQL stopped${last ? ` (${last})` : ""}.`);
    });
    c.on("error", (e) => l.child === c && end(l, `Not run: the process that runs this app's SQL failed (${e.message}).`));
    l.child = c;
    return c;
  };

  /** One message to an app's process, answered — or the process ended at its time. @param {Lane} l @param {any} m */
  const ask = (l, m) =>
    new Promise((resolve) => {
      // One that waited its turn as Filament began to stop starts no process.
      if (stopped) return resolve({ ok: false, error: "Not run: Filament is stopping." });
      if (l.idle) clearTimeout(l.idle);
      l.idle = null;
      /** @type {import("node:child_process").ChildProcess} */
      let c;
      try {
        c = childOf(l);
      } catch (/** @type {any} */ e) {
        return resolve({ ok: false, error: `Not run: its process did not start (${e?.message || e}).` });
      }
      const id = ++seq;
      const timer = setTimeout(() => {
        if (!l.waiting.has(id)) return;
        log(`app-sql: a statement ran past ${timeoutMs} ms; its app's process is ended`);
        l.waiting.delete(id);
        resolve({ ok: false, error: `Stopped: it ran past ${Math.round(timeoutMs / 1000)} s, an app's statement's time. A query over many rows wants an index, or a LIMIT.` });
        end(l, "Not run: the statement before it was stopped.");
      }, timeoutMs);
      l.waiting.set(id, (/** @type {any} */ a) => {
        clearTimeout(timer);
        const { id: _id, ...rest } = a || {};
        resolve(rest);
        if (!l.waiting.size && l.child === c) l.idle = setTimeout(() => l.child === c && end(l, "idle"), idleMs);
      });
      c.send({ ...m, id });
    });

  /** @param {Lane} l @param {() => Promise<any>} fn */
  const inTurn = (l, fn) => {
    const next = l.turn.then(fn, fn);
    l.turn = next.then(
      () => {},
      () => {},
    );
    return next;
  };

  return {
    fileOf,
    run(name, sql, params, { readOnly = false } = {}) {
      if (stopped) return Promise.resolve({ ok: false, error: "Not run: Filament is stopping." });
      if (!isArtifactName(name)) return Promise.resolve({ ok: false, error: `No app is named ${name}.` });
      const no = sqlRefusal(sql, params);
      if (no) return Promise.resolve({ ok: false, error: no });
      const l = laneOf(name);
      // One sent once its app's deletion began would make its database again behind it.
      if (l.dropping) return Promise.resolve({ ok: false, error: "Not run: the app was deleted." });
      // A page that sends without waiting is told so, rather than held in memory behind its own statements.
      if (l.queued >= SQL_WAITING_MAX) return Promise.resolve({ ok: false, error: `Not run: ${SQL_WAITING_MAX} statements wait their turn already. Await each before sending the next.` });
      l.queued++;
      return inTurn(l, () => ask(l, { file: fileOf(name), sql, params: params ?? null, maxMb, ...(readOnly ? { readOnly } : {}) })).finally(() => l.queued--);
    },
    async drop(name) {
      if (!isArtifactName(name)) return;
      const l = laneOf(name);
      l.dropping = true;
      await inTurn(l, async () => {
        end(l, "Not run: the app was deleted.");
        await l.gone;
        // A process just ended can hold its files a moment longer on Windows.
        for (const end of ["", "-wal", "-shm"]) rmSync(`${fileOf(name)}${end}`, { force: true, maxRetries: 10, retryDelay: 100 });
        rmSync(tmpOf(name), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      });
      if (lanes.get(name) === l) lanes.delete(name);
    },
    async stop() {
      stopped = true;
      const gone = [];
      for (const l of lanes.values()) {
        end(l, "Not run: Filament is stopping.");
        gone.push(l.gone);
      }
      // Their files are let go once their processes have ended.
      await Promise.all(gone);
    },
  };
}
