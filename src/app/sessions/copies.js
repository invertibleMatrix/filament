// @ts-check
// The copy of a project's worktree template into a worktree a chat was just made in or moved to (HarnessV4_Four_Plan
// E19): run beside everything else, its progress read by the chat's turn that waits on it (FO-D36), its start and its
// end kept on the chat's meta (`copies`) and told on the feed, for the chat's row (FO-D37). Filament stopping cuts it,
// and what was copied stays (FO-D38); a copy the record says runs while no job does was cut by Filament stopping.
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { copyInto } from "../../adapters/git/template.js";

/** The copies a chat's meta keeps, the newest. */
const COPIES_KEPT = 20;
/** What the row says of a copy Filament's stop cut. */
export const COPY_CUT = "Filament stopped while it copied";

/**
 * @typedef {import("../../adapters/git/template.js").CopyResult} CopyResult
 * @typedef {import("../../adapters/git/template.js").CopyProgress} CopyProgress
 * @typedef {object} CopyRecord  one copy, as the chat's meta keeps it
 * @property {string} id
 * @property {number} at
 * @property {number} atTurn  the chat's newest turn when it began: its row stands after that turn
 * @property {string} into  the worktree's top folder
 * @property {string[]} paths  as asked
 * @property {"running" | "done"} state
 * @property {CopyResult | null} result
 * @property {number | null} ms
 * @typedef {{ id: string, chainId: string, progress: CopyProgress | null, done: Promise<CopyResult>,
 *   on: (fn: (p: CopyProgress) => void) => () => void }} CopyJob
 */

/**
 * A copy as the conversation's row shows it (FO-D37): the worktree by its folder's name, running while a job runs.
 * @param {CopyRecord} c @param {boolean} live
 */
export const copiedBoundary = (c, live) => ({
  type: "copied",
  id: c.id,
  at: c.at,
  afterTurn: Number(c.atTurn) || 0,
  into: basename(String(c.into || "")),
  paths: Array.isArray(c.paths) ? c.paths : [],
  state: c.state === "done" ? "done" : live ? "running" : "cut",
  result: c.state === "done" ? c.result || null : null,
  ms: c.ms ?? null,
  ...(c.state !== "done" && !live ? { why: COPY_CUT } : {}),
});

/**
 * @param {{ memory: any, log?: (level: string, msg: string) => void, publish?: ((chainId: string, e: any) => void) | null,
 *   now?: () => number, copy?: typeof copyInto }} deps
 */
export function createWorktreeCopies({ memory, log = () => {}, publish = null, now = Date.now, copy = copyInto }) {
  /** The job running for each chat. @type {Map<string, CopyJob>} */
  const jobs = new Map();
  const stopping = new AbortController();
  /** Each running job's own stop. @type {Map<CopyJob, AbortController>} */
  const cuts = new Map();
  /**
   * A record onto the chat's meta, in its place among the others, and told on the feed.
   * @param {string} chainId @param {CopyRecord} rec
   */
  const keep = (chainId, rec) => {
    const a = memory.archive;
    const chain = a?.getChain(chainId);
    if (!chain) return;
    const list = (Array.isArray(chain.meta?.copies) ? chain.meta.copies : []).filter((/** @type {any} */ c) => c?.id !== rec.id);
    a.mergeMeta(chainId, { copies: [...list, rec].slice(-COPIES_KEPT) });
    publish?.(chainId, { type: "worktree-copy", boundary: copiedBoundary(rec, rec.state === "running") });
  };

  /**
   * Copy `paths` from the place `from` into the worktree `to` for a chat; none when the list is empty (FOC-71).
   * @param {string} chainId @param {{ from: string, to: string, paths: string[] }} o
   * @returns {CopyJob | null}
   */
  function start(chainId, { from, to, paths }) {
    if (!paths.length) return null;
    const id = randomUUID();
    /** @type {CopyRecord} */
    const rec = { id, at: now(), atTurn: Number(memory.archive?.newestTurnN?.(chainId)) || 0, into: to, paths: [...paths], state: "running", result: null, ms: null };
    keep(chainId, rec);
    /** @type {Set<(p: CopyProgress) => void>} */
    const listeners = new Set();
    /** @type {CopyJob} */
    const job = {
      id,
      chainId,
      progress: null,
      done: /** @type {any} */ (null),
      on: (fn) => {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      },
    };
    const onProgress = (/** @type {CopyProgress} */ p) => {
      job.progress = p;
      for (const fn of listeners) fn(p);
    };
    const own = new AbortController();
    cuts.set(job, own);
    job.done = copy({ from, to, paths, onProgress, signal: AbortSignal.any([stopping.signal, own.signal]) }).then((result) => {
      cuts.delete(job);
      const ms = now() - rec.at;
      keep(chainId, { ...rec, state: "done", result, ms });
      if (jobs.get(chainId) === job) jobs.delete(chainId);
      const said = `${result.files} files, ${result.bytes} bytes in ${ms} ms${result.failed.length ? `; ${result.failed.length + result.failedMore} not copied` : ""}${result.cut ? `; cut: ${result.cut}` : ""}`;
      log(result.failed.length || result.cut ? "warn" : "info", `worktree copy: ${paths.join(", ")} into ${to} for chat ${chainId}: ${said}`);
      return result;
    });
    jobs.set(chainId, job);
    log("info", `worktree copy: ${paths.join(", ")} from ${from} into ${to} for chat ${chainId}`);
    return job;
  }

  return {
    start,
    /** The copy running for a chat now, or null. @param {string} chainId */
    running: (chainId) => jobs.get(String(chainId)) || null,
    /**
     * End the copy running for a chat where it is, `why` on its record (a move taken back takes its worktree, and the
     * copy must not write into it while it goes); resolves once it ended. Nothing running: resolves at once.
     * @param {string} chainId @param {string} why
     */
    stop: async (chainId, why) => {
      const job = jobs.get(String(chainId));
      if (!job) return;
      cuts.get(job)?.abort(new Error(why));
      await job.done;
    },
    /** Filament stops: every copy ends where it is, said so on its record. */
    stopAll: () => {
      stopping.abort(new Error(COPY_CUT));
      return Promise.all([...jobs.values()].map((j) => j.done));
    },
  };
}

/** @typedef {ReturnType<typeof createWorktreeCopies>} WorktreeCopies */
