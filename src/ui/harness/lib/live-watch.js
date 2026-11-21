// @ts-check
// The live view's watchdog (HarnessV3-FixRound F3 item 16, BUG-25): a turn's page went quiet for over an hour while
// its loop kept working — the server and the page's POSTs were fine, only the live view had stopped, and a frozen
// view looked exactly like an idle agent. The page now checks: when it has heard no run event for LIVE_QUIET_MS, it
// asks the run log. A log that holds events the page has not seen is a view behind its run: the page follows the run
// again from its cursor, and says nothing yet (HarnessV4_Tasks B15) — a stream the server closed on a slow reader is
// back within a second, and an event still on its way is no loss at all, yet both read as "lost" and the banner
// showed over turns that ran fine. A look later that finds the page behind still is a lost view, said in words. A run
// that is merely quiet (a long command with no output, a model thinking, a question waiting for the person) has no
// newer events: no follow, no banner. Nor is a lookup that cannot get through: on a busy
// machine the lookup alone takes seconds while the reply streams on (the user's report, 2026-10-09: the banner kept
// showing over a turn that ran fine), and a reply that breaks is the send's to follow again (sendMessage). A run that
// has ended with every event heard is "ended" — the page's reply may still be the one thing stuck. DOM-free.

/** Silence that makes the page look. */
export const LIVE_QUIET_MS = 30_000;
/** How often the page looks while it is quiet. */
export const LIVE_CHECK_MS = 10_000;
/** How long the run lookup may take before the page stops waiting for its answer, which then says nothing. */
export const LIVE_LOOKUP_MS = 5_000;

/**
 * The live view's state, from what the page heard and what the run log says.
 * @param {{ now: number, heardAt: number, cursor: number, run?: { events?: number, endedAt?: number | null } | null | "unreachable", quietMs?: number }} o
 *   `run`: the run log's answer (its `events` count and `endedAt`), null when it knows no such run, "unreachable"
 *   when the lookup failed or timed out; left out while the page has heard within `quietMs` (no lookup needed)
 * @returns {"heard" | "quiet" | "lost" | "ended"}
 */
export function liveViewState({ now, heardAt, cursor, run, quietMs = LIVE_QUIET_MS }) {
  if (now - heardAt < quietMs) return "heard";
  if (!run || run === "unreachable") return "quiet";
  if (Number(run.events) > Number(cursor || 0)) return "lost";
  return run.endedAt ? "ended" : "quiet";
}

/**
 * The watchdog over one live turn. `check()` looks once (the interval calls it every LIVE_CHECK_MS unless
 * `intervalMs` is 0) and answers the state it found; `heard()` marks a run event that arrived and, after a loss,
 * calls `onBack`; `stop()` ends it. A page found behind its run's log is told to follow again (`onBehind`) and
 * answers "behind"; the next look, still behind with nothing heard, is the loss (`onLost`), after which the page
 * gets another LIVE_QUIET_MS before it looks again. `aliveAt`: when the stream that carries the run's events last
 * said anything at all — a reply that carries them and still speaks has delivered every event before its last word,
 * so the page asks nothing while it does.
 * @param {{ runId: () => string | null, cursor: () => number, lookup: (runId: string) => Promise<{ events?: number, endedAt?: number | null } | null>,
 *   onBehind: () => void, onLost: () => void, onBack: () => void, onEnded?: () => void, aliveAt?: () => number, now?: () => number,
 *   intervalMs?: number, lookupMs?: number }} o
 * @returns {{ check: () => Promise<string>, heard: () => void, stop: () => void, isLost: () => boolean }}
 */
export function watchLive(o) {
  const now = o.now || Date.now;
  let heardAt = now();
  let behind = false;
  let lost = false;
  let busy = false;
  const check = async () => {
    const id = o.runId();
    if (!id) return "quiet";
    if (busy || now() - Math.max(heardAt, Number(o.aliveAt?.()) || 0) < LIVE_QUIET_MS) return "heard";
    busy = true;
    /** @type {{ events?: number, endedAt?: number | null } | null | "unreachable"} */
    let run = null;
    /** @type {any} */
    let timer;
    try {
      run = await Promise.race([
        o.lookup(id),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("the run lookup timed out")), o.lookupMs ?? LIVE_LOOKUP_MS); }),
      ]);
    } catch {
      run = "unreachable";
    } finally {
      clearTimeout(timer);
      busy = false;
    }
    const state = liveViewState({ now: now(), heardAt, cursor: o.cursor(), run });
    if (state === "lost") {
      if (!behind) {
        behind = true;
        o.onBehind();
        return "behind";
      }
      lost = true;
      heardAt = now();
      o.onLost();
    } else if (state === "ended") o.onEnded?.();
    return state;
  };
  const every = o.intervalMs ?? LIVE_CHECK_MS;
  const timer = every > 0 ? setInterval(() => { check().catch(() => {}); }, every) : null;
  return {
    check,
    heard() {
      heardAt = now();
      behind = false;
      if (!lost) return;
      lost = false;
      o.onBack();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    isLost: () => lost,
  };
}
