// @ts-check
// A connection's tool as a watcher's trigger (the plan of 11-11, its w4): a watcher on asks one read-only tool of its
// project's connections — the one the person approved by switching it on, with its args — every `everyMin`, 15 minutes
// at least, and keeps what the answer held (its items' hashes and which list they are of, core/watchers.js
// `connectionNews`). It wakes only on what it had not seen: each new item an event, its words quoted to the run as
// outside data, heard before the answer's keys are kept — a hearing that fails loses no news. Its first answer is where
// it listens from. A tool that fails is asked again later each time, doubled up to once a day, and its trouble is on
// the watcher (`troubleWords`); an ask that throws — the store's own write, as its file is locked — backs off the same
// way, counted here where nothing could be kept. One off, paused, removed, under Pause all or of a project the person
// archived (r-itself, 11-12; the store's `archived`) is never asked; switched on again, it starts over. The asks follow the store's watchers each time the routines arm (`sync`): a watcher
// changed is asked anew.
import { askEveryMin, connectionNews, watchEventOf } from "../../core/watchers.js";

/** The longest a timer can wait. */
const TIMER_MAX_MS = 2 ** 31 - 1;
/** A minute of a watcher's every. */
const MINUTE_MS = 60_000;

/**
 * @typedef {{ tool: string, args: Record<string, unknown> }} AskedTool  a tool as its trigger names it (mcp__<server>__<tool>), and its input
 * @typedef {import("../../core/routines.js").Routine} Routine
 */

/**
 * @param {{ store: { get: (project: string) => { routines: Routine[] }, routinesAll: () => { project: string, r: Routine }[], pausedSince: () => number | null, archived?: (project: string) => boolean,
 *     watchAsked: (project: string, id: string, asked: { at: number, keys?: string[], list?: string[] | null, failed?: string }) => boolean },
 *   heard: (project: string, id: string, events: readonly unknown[]) => Promise<number> | number,
 *   ask: (project: string, tool: AskedTool, signal: AbortSignal) => Promise<{ ok: true, out: string } | { ok: false, error: string }>,
 *   now?: () => number, log?: (level: string, msg: string) => void, minuteMs?: number }} deps
 *   `ask`: the project's connection asked (app/space-tools.js `ask`): read-only, or refused in words; `minuteMs`: how long
 *   a minute of its asks lasts (the tests')
 */
export function createConnectionWatch({ store, heard, ask, now = Date.now, log = () => {}, minuteMs = MINUTE_MS }) {
  /** Each watcher's next ask, by its project and id: when, its timer, and the ask under way. @type {Map<string, { at: number, timer: ReturnType<typeof setTimeout> | null, asking: AbortController | null }>} */
  const due = new Map();
  /** Each watcher whose ask threw: not asked before `at`, and how many threw in a row. @type {Map<string, { at: number, fails: number }>} */
  const held = new Map();
  /** The asks under way, for the tests to wait on. @type {Set<Promise<void>>} */
  const running = new Set();
  let stopped = false;

  /** @param {string} project @param {string} id */
  const keyOf = (project, id) => `${project}\n${id}`;
  /** Whether a watcher asks now: a connection's, on, not paused, Pause all off, its project not archived. @param {string} project @param {Routine | undefined} r */
  const asks = (project, r) => r?.trigger?.kind === "connection" && r.state === "on" && !r.paused && !store.pausedSince() && !store.archived?.(project);
  /** When a watcher asks next: its last ask and its every, backed off for each failure in a row. @param {Routine} r */
  const dueAt = (r) => {
    const t = /** @type {Extract<NonNullable<Routine["trigger"]>, { kind: "connection" }>} */ (r.trigger);
    return (r.seen?.asked ?? 0) + askEveryMin(t.everyMin, r.seen?.trouble?.fails || 0) * minuteMs;
  };

  /** Each watcher of a connection that asks now has its next ask set; one that no longer asks has none, its ask stopped. */
  function sync() {
    if (stopped) return;
    /** @type {Map<string, { project: string, r: Routine }>} */
    const on = new Map();
    for (const { project, r } of store.routinesAll()) if (asks(project, r)) on.set(keyOf(project, r.id), { project, r });
    for (const [k, d] of due) {
      if (on.has(k)) continue;
      if (d.timer) clearTimeout(d.timer);
      d.asking?.abort();
      due.delete(k);
    }
    for (const k of held.keys()) if (!on.has(k)) held.delete(k);
    for (const [k, { project, r }] of on) {
      const d = due.get(k);
      if (d?.asking) continue;
      const at = Math.max(now(), dueAt(r), held.get(k)?.at ?? 0);
      if (d?.at === at) continue;
      if (d?.timer) clearTimeout(d.timer);
      const timer = setTimeout(() => {
        const p = askNow(project, r.id)
          .catch((/** @type {any} */ e) => log("warn", `watchers: “${r.title}” of ${project} did not ask its tool (${e?.message || e})`))
          .finally(() => running.delete(p));
        running.add(p);
      }, Math.min(Math.max(0, at - now()), TIMER_MAX_MS));
      timer.unref?.();
      due.set(k, { at, timer, asking: null });
    }
  }

  /**
   * A watcher's tool asked now: its news heard, then its keys and its ask kept; or its failure kept, and asked again
   * later. An ask that throws anywhere — the hearing, the store's write — is a failure too, and waits its backoff
   * here (`held`) whether or not the store could keep it: never asked again at once.
   * @param {string} project @param {string} id
   */
  async function askNow(project, id) {
    const k = keyOf(project, id);
    const r = store.get(project).routines.find((x) => x.id === id);
    if (!r || !asks(project, r) || r.trigger?.kind !== "connection") return void (due.delete(k), sync());
    // One ask of a watcher at a time.
    const d = due.get(k);
    if (d?.asking) return;
    if (d?.timer) clearTimeout(d.timer);
    const t = r.trigger;
    const ctl = new AbortController();
    due.set(k, { at: now(), timer: null, asking: ctl });
    try {
      const out = await ask(project, { tool: t.tool, args: t.args || {} }, ctl.signal);
      if (ctl.signal.aborted) return;
      const at = now();
      if (!out.ok) {
        store.watchAsked(project, id, { at, failed: out.error });
        held.delete(k);
        log("warn", `watchers: “${r.title}” of ${project} could not ask ${t.tool} (${out.error})`);
        return;
      }
      // Its keys as kept now: switched off and on meanwhile, it starts over from this answer.
      const kept = store.get(project).routines.find((x) => x.id === id);
      if (!kept || !asks(project, kept)) return;
      const { keys, news, list } = connectionNews(kept.seen?.keys ?? null, out.out, kept.seen?.list ?? null);
      // Heard before its keys are kept: a hearing that fails leaves them as they were, and its news is the next ask's.
      if (news.length) await heard(project, id, news.map((n) => watchEventOf({ kind: "connection", at, tool: t.tool, key: n.key, words: n.words }, t, () => "")));
      // Resumed, switched on again or put back while it was heard: this answer is none of the cursor it has now. An
      // ask stopped meanwhile — Pause all, its own pause — keeps its keys all the same: the store kept what was heard,
      // and the same answer after must not be news again.
      if (store.get(project).routines.find((x) => x.id === id)?.seen?.from !== kept.seen?.from) return;
      store.watchAsked(project, id, { at, keys, list });
      held.delete(k);
    } catch (/** @type {any} */ e) {
      if (ctl.signal.aborted) return;
      const why = String(e?.message || e);
      log("warn", `watchers: “${r.title}” of ${project} did not ask its tool (${why})`);
      const fails = (held.get(k)?.fails || 0) + 1;
      held.set(k, { at: now() + askEveryMin(t.everyMin, fails) * minuteMs, fails });
      // Its failure kept too, where the store can keep one: what threw may be its own write.
      try {
        store.watchAsked(project, id, { at: now(), failed: why });
      } catch {}
    } finally {
      if (due.get(k)?.asking === ctl) due.delete(k);
      sync();
    }
  }

  return {
    sync,
    /** A watcher asked now, whatever its time (the tests'). @param {string} project @param {string} id */
    askNow,
    /** When each watcher asks next, by its project and id (the tests'). */
    dueOf: () => new Map([...due].map(([k, d]) => [k, d.at])),
    /** Every ask under way, settled (the tests'). */
    settled: () => Promise.all([...running]),
    /** Every timer stopped and every ask let go (the server's stop). */
    stop() {
      stopped = true;
      for (const d of due.values()) {
        if (d.timer) clearTimeout(d.timer);
        d.asking?.abort();
      }
      due.clear();
    },
  };
}

/** @typedef {ReturnType<typeof createConnectionWatch>} ConnectionWatch */
