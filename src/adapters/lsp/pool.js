// @ts-check
// Language servers kept warm (the owner's LSP of 11-04): one per real folder and server, started when an agent first
// asks about a file it serves, and shared by every chat working in that folder. An ask holds its server until it lets
// go (`release`): one held is never closed under it. One left idle LSP_IDLE_MS is closed; past LSP_MOST at once, the
// least used of those not held is. One that fails to start, or ends by itself, is held back: asked of again once its
// wait is over — LSP_FAILED_WAIT_MS, twice as long after each failure more, to LSP_FAILED_WAIT_MAX_MS —, its problem
// said meanwhile. A worker's own, started in its worktree, close with its run (`close(root)`) — each once the asks that
// hold it let go, a start there stopped — and none starts there while they close; every one ends with Filament
// (`closeAll`), held or starting, after which none starts.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { startLsp } from "./client.js";

/** How long a server may sit unused before it is closed. */
export const LSP_IDLE_MS = 10 * 60_000;
/** How many run at once; past it, the least used of those no ask holds is closed. */
export const LSP_MOST = 8;
/** How long one that failed is held back at first, and at the most. */
export const LSP_FAILED_WAIT_MS = 30_000;
export const LSP_FAILED_WAIT_MAX_MS = 5 * 60_000;

/**
 * A folder as one key: its real path, so a link and its target, or two spellings of one folder, are one; where it
 * has none, its whole path — on Windows in any case.
 * @param {string} root
 */
export function rootKey(root) {
  try {
    return realpathSync.native(resolve(root));
  } catch {
    return process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  }
}

/** A server's identity: every field that changes what runs. @param {import("./client.js").LspSpec} spec */
export const lspSpecKey = (spec) =>
  createHash("sha256")
    .update(JSON.stringify({ n: spec.name, c: spec.command, a: spec.args || [], e: spec.env || {}, l: spec.languages, i: spec.initializationOptions ?? null, s: spec.settings ?? null }))
    .digest("hex")
    .slice(0, 16);

/**
 * An ask's answer: the server, held until `release` — or the problem in words. The server works in the folder it was
 * started in (`server.root`), which may be another spelling of the asker's: a file is named to it relative to its root.
 * `fresh`: this ask started it, or tried to.
 * @typedef {{ server: import("./client.js").LspServer, problem: null, fresh: boolean, release: () => void }
 *   | { server: null, problem: string, fresh: boolean, release: () => void }} LspAsk
 */

const NOTHING = () => {};

/**
 * @param {{ log?: (level: string, msg: string) => void, idleMs?: number, most?: number, start?: typeof startLsp, now?: () => number,
 *   failedWaitMs?: number, failedMaxMs?: number }} [o]
 */
export function createLspPool({ log = () => {}, idleMs = LSP_IDLE_MS, most = LSP_MOST, start = startLsp, now = Date.now, failedWaitMs = LSP_FAILED_WAIT_MS, failedMaxMs = LSP_FAILED_WAIT_MAX_MS } = {}) {
  /**
   * Each running, by its slot; `free`: what waits for the last ask holding it to let go.
   * @type {Map<string, { root: string, server: import("./client.js").LspServer, usedAt: number, held: number, free: (() => void)[] }>}
   */
  const live = new Map();
  /**
   * Starts under way, so two asks at once share one server; `stop` ends one, its process with it.
   * @type {Map<string, { root: string, promise: Promise<import("./client.js").LspServer>, stop: AbortController }>}
   */
  const starting = new Map();
  /** Each one held back, by its slot: why, until when, and the wait it was given. @type {Map<string, { problem: string, until: number, wait: number }>} */
  const failed = new Map();
  /** Folders whose servers are closing (`close`): none starts in them meanwhile. @type {Set<string>} */
  const closing = new Set();
  let closed = false;

  /** Whether a folder is `at` or inside it. @param {string} at @param {string} r */
  const inside = (at, r) => r === at || r.startsWith(at.endsWith(sep) ? at : at + sep);
  /** @param {string} slot @param {string} problem */
  const holdBack = (slot, problem) => {
    const before = failed.get(slot);
    const wait = before ? Math.min(failedMaxMs, before.wait * 2) : failedWaitMs;
    failed.set(slot, { problem, until: now() + wait, wait });
  };
  /** @param {string} slot */
  const drop = (slot) => {
    const v = live.get(slot);
    if (!v) return Promise.resolve();
    live.delete(slot);
    return v.server.close().catch(() => {});
  };
  /** Past `most`, the least used of those no ask holds go, `keep` aside. @param {string} [keep] */
  const trim = (keep) => {
    const free = [...live].filter(([k, v]) => k !== keep && v.held === 0).sort((a, b) => a[1].usedAt - b[1].usedAt);
    while (live.size > most && free.length) void drop(/** @type {[string, any]} */ (free.shift())[0]);
  };
  const sweep = () => {
    const cutoff = now() - idleMs;
    for (const [slot, v] of live) {
      // Held by an ask: its idle time starts once it is let go.
      if (v.held > 0 && v.server.alive()) v.usedAt = now();
      else if (v.usedAt < cutoff || !v.server.alive()) void drop(slot);
    }
    trim();
    // A failure long past and not asked about since is forgotten: the next one starts from the first wait.
    for (const [slot, f] of failed) if (f.until + failedMaxMs < now()) failed.delete(slot);
  };
  const timer = setInterval(sweep, Math.min(idleMs, 60_000));
  timer.unref?.();
  // The last resort: an exit handler runs no later turn of the event loop, but each kill starts at once. It is listened
  // for once a server starts: a pool that never started one adds nothing to the process.
  const onExit = () => {
    for (const s of starting.values()) s.stop.abort();
    for (const v of live.values()) void v.server.kill();
  };
  let listening = false;

  /**
   * One server started into the pool: kept once it answers, its end by itself heard and held back.
   * @param {string} slot @param {import("./client.js").LspSpec} spec @param {string} at  its folder's key @param {string} root  the folder as asked
   */
  const begin = (slot, spec, at, root) => {
    if (!listening) {
      listening = true;
      process.once("exit", onExit);
    }
    const stop = new AbortController();
    const promise = start(spec, { root, log, signal: stop.signal })
      .then(
        (s) => {
          s.onExit((why) => {
            if (live.get(slot)?.server !== s) return;
            live.delete(slot);
            holdBack(slot, `language server ${spec.name} ${why}`);
            log("warn", `lsp: ${spec.name} in ${s.root} ${why}; held back ${Math.round((failed.get(slot)?.wait || 0) / 1000)} s`);
          });
          // Its last failure stays until the sweep forgets it: one that starts and ends again waits longer each time.
          live.set(slot, { root: at, server: s, usedAt: now(), held: 0, free: [] });
          return s;
        },
        (/** @type {any} */ e) => {
          // One stopped by a close failed nothing of its own.
          if (!stop.signal.aborted) holdBack(slot, String(e?.message || e));
          throw e;
        },
      )
      .finally(() => {
        if (starting.get(slot)?.promise === promise) starting.delete(slot);
      });
    starting.set(slot, { root: at, promise, stop });
    return promise;
  };

  return {
    /**
     * The server for a folder, held until the ask lets go (`release`, once its tool call is through): the one running
     * there, shared; else started, side by side with any other ask for it; else the problem in words — its start's,
     * the one it last ended with while it is held back, or the pool's closing.
     * @param {import("./client.js").LspSpec} spec @param {string} root  the folder it works in (the chat's)
     * @returns {Promise<LspAsk>}
     */
    async server(spec, root) {
      if (closed) return { server: null, problem: "Filament's language servers are closing", fresh: false, release: NOTHING };
      const at = rootKey(root);
      if ([...closing].some((c) => inside(c, at))) return { server: null, problem: `the language servers of ${root} are closing with the run that worked there`, fresh: false, release: NOTHING };
      const slot = `${at}|${lspSpecKey(spec)}`;
      let have = live.get(slot);
      if (have && !have.server.alive()) {
        live.delete(slot);
        have = undefined;
      }
      const held = have ? null : failed.get(slot);
      if (held && now() < held.until) return { server: null, problem: `${held.problem} — tried again in ${Math.ceil((held.until - now()) / 1000)} s`, fresh: false, release: NOTHING };
      const under = have ? undefined : starting.get(slot);
      let server;
      try {
        server = have ? have.server : await (under?.promise || begin(slot, spec, at, resolve(root)));
      } catch (/** @type {any} */ e) {
        return { server: null, problem: String(e?.message || e), fresh: !under, release: NOTHING };
      }
      const v = live.get(slot);
      if (!v || v.server !== server) return { server: null, problem: `language server ${spec.name} was closed as it started`, fresh: !under, release: NOTHING };
      v.held++;
      v.usedAt = now();
      trim(slot);
      let let_go = false;
      return {
        server,
        problem: null,
        fresh: !have && !under,
        release: () => {
          if (let_go) return;
          let_go = true;
          v.held--;
          v.usedAt = now();
          if (v.held === 0) for (const w of v.free.splice(0)) w();
        },
      };
    },
    /**
     * Close the servers of a folder and the folders in it — a start there stopped, one an ask holds once it is let go,
     * as each ask's own call bounds it — and settle when each has gone; none starts there meanwhile: a worker's own,
     * as its run ends, before its worktree is given back.
     * @param {string} root
     */
    async close(root) {
      const at = rootKey(root);
      closing.add(at);
      try {
        const starts = [...starting.values()].filter((s) => inside(at, s.root));
        for (const s of starts) s.stop.abort();
        await Promise.allSettled(starts.map((s) => s.promise));
        await Promise.all(
          [...live]
            .filter(([, v]) => inside(at, v.root))
            .map(async ([slot, v]) => {
              if (v.held > 0) await new Promise((r) => v.free.push(() => r(undefined)));
              if (live.get(slot) === v) await drop(slot);
            }),
        );
      } finally {
        closing.delete(at);
      }
    },
    /** Close every server, held or not, a start under way stopped, and settle when each has gone; none starts after. */
    async closeAll() {
      closed = true;
      clearInterval(timer);
      if (listening) process.removeListener("exit", onExit);
      const starts = [...starting.values()];
      for (const s of starts) s.stop.abort();
      await Promise.allSettled(starts.map((s) => s.promise));
      await Promise.all([...live.keys()].map(drop));
    },
    /** The servers running, each with its folder, when it was last used and how many asks hold it. */
    running: () => [...live.values()].map((v) => ({ name: v.server.name, root: v.server.root, usedAt: v.usedAt, held: v.held })),
    size: () => live.size,
    sweep,
  };
}
