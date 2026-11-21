// @ts-check
// The desktop app's own Filament server, as a child process (HarnessV3-Native NA-D3, NA-D9): started, watched, started
// again when it ends — whoever stopped it (the page's Restart, a crash), never faster than once in five seconds — and
// stopped on Quit. One that ends before it ever answered is not started again by itself: it
// cannot start (a config that does not read, say), and trying every five seconds would only say so for ever; the app
// says why, and the person tries again. A stop asks Filament first (`/api/shutdown`): only while nothing runs, unless the
// person chose to stop anyway; then it waits for the process to end, which Filament does once what was in flight finished
// (its own 20 s), and ends it at 25 s. Before each start again the port is asked: another Filament there is the one the
// app shows from then on. Plain Node: the child, the questions to the server and the clock come in from the caller
// (NA-D13).

/** How long after one start the next may come at the soonest (the tray's rule). */
export const RESTART_GAP_MS = 5000;
/** How long a stopped server's process may take to end before it is ended: Filament's own drain is 20 s. */
export const END_WAIT_MS = 25_000;
/** Past this a start that has not answered says so; the start goes on (it is no clock on Filament's work). */
export const LATE_MS = 40_000;
/** How often a starting server is asked whether it answers. */
const POLL_MS = 250;

/**
 * @typedef {{ pid: number | undefined, kill: () => boolean, onExit: (fn: (code: number | null) => void) => void }} Child
 * @typedef {"starting" | "late" | "up" | "restarting" | "stopping" | "stopped" | "taken" | "failed"} State
 *   `taken`: when it was to start again, the port was another's — a Filament started elsewhere meanwhile, or another
 *   program; `failed`: it ended before it ever answered, and is not started again unasked
 * @typedef {{ ok: true } | { ok: false, note: string, unanswered?: true }} Asked  what a stop's question to Filament came
 *   back with; `unanswered`: Filament gave no answer at all (it refused nothing)
 * @typedef {{ pid: number | undefined, since: number, found?: import("./start.js").Found, code?: number | null }} Facts
 *   `found` with `taken`; `code`, the exit, with `failed`
 */

/**
 * @param {{
 *   fork: () => Child,
 *   answers: () => Promise<boolean>,
 *   shutdown: (ifIdle: boolean) => Promise<Asked>,
 *   vacant?: () => Promise<import("./start.js").Found>,
 *   later?: (fn: () => void, ms: number) => unknown,
 *   now?: () => number,
 *   onState?: (state: State, facts: Facts) => void,
 *   log?: (line: string) => void,
 * }} o
 *   `vacant`: who holds the port now, asked before each start again (the launch asked before the first)
 */
export function createSupervisor({ fork, answers, shutdown, vacant = async () => ({ kind: "start" }), later = (fn, ms) => setTimeout(fn, ms), now = Date.now, onState = () => {}, log = () => {} }) {
  /** @type {Child | null} */
  let child = null;
  /** @type {State} */
  let state = "stopped";
  let startedAt = -Infinity;
  let since = now();
  /** Set while the app stops it for good: its end starts nothing. */
  let stopping = false;
  /** The waiters on the child's end. @type {(() => void)[]} */
  let ended = [];
  /** A start waiting out the gap, or the port's answer: one at a time. */
  let pending = false;
  /** The child answered once; the app itself ended it to begin it again. */
  let answered = false;
  let meant = false;
  /** @type {import("./start.js").Found | undefined} */
  let found;
  /** @type {number | null | undefined} */
  let code;

  /** @param {State} next */
  const become = (next) => {
    if (next === state) return;
    state = next;
    since = now();
    onState(state, { pid: child?.pid, since, ...(state === "taken" ? { found } : {}), ...(state === "failed" ? { code } : {}) });
  };

  const poll = () => {
    const mine = child;
    // An answer that comes once the state moved on (a restart, a stop) says nothing any more.
    const asking = () => child === mine && (state === "starting" || state === "late");
    if (!mine || !asking()) return;
    void answers().then(
      (yes) => {
        if (!asking()) return;
        if (yes) {
          answered = true;
          return become("up");
        }
        if (state === "starting" && now() - startedAt >= LATE_MS) {
          log(`Filament has not answered ${Math.round(LATE_MS / 1000)} s after its start; still waiting`);
          become("late");
        }
        later(poll, POLL_MS);
      },
      () => {
        if (asking()) later(poll, POLL_MS);
      },
    );
  };

  const start = () => {
    if (child || stopping) return;
    startedAt = now();
    answered = false;
    meant = false;
    const c = fork();
    child = c;
    become("starting");
    log(`Filament started${c.pid ? ` (pid ${c.pid})` : ""}`);
    c.onExit((exit) => {
      if (child !== c) return;
      child = null;
      const waiters = ended;
      ended = [];
      for (const w of waiters) w();
      if (stopping) {
        log(`Filament stopped (exit ${exit ?? "?"})`);
        return become("stopped");
      }
      become("restarting");
      if (pending) return;
      pending = true;
      if (!answered && !meant) {
        // It never answered: it cannot start. Said, not tried again and again — unless another took its port.
        log(`Filament ended before it answered (exit ${exit ?? "?"})`);
        void again(exit);
        return;
      }
      // Whatever ended it — the page's Restart, a crash — the app starts it again, the gap kept.
      const wait = Math.max(0, startedAt + RESTART_GAP_MS - now());
      log(`Filament ended (exit ${exit ?? "?"}); starting it again${wait ? ` in ${Math.ceil(wait / 1000)} s` : ""}`);
      later(() => void again(), wait);
    });
    poll();
  };

  /**
   * Start again, where the port is still free: in the gap another Filament of this folder (one started in a terminal,
   * say) may have taken the port — the app then shows that one (`taken`, found an `attach`); another program holding it
   * is said, never tried again and again. After an end before any answer (`failedWith`, its exit) a free port is no
   * reason to try again: it is `failed`.
   * @param {number | null} [failedWith]
   */
  const again = async (failedWith) => {
    const f = await vacant().catch(() => /** @type {import("./start.js").Found} */ ({ kind: "start" }));
    pending = false;
    if (child || stopping) return;
    if (f.kind === "start") {
      if (failedWith === undefined) return start();
      code = failedWith;
      log("not started again: try again from the tray once what server.log says is fixed");
      return become("failed");
    }
    found = f;
    log(f.kind === "attach" ? `port taken by a Filament started ${f.supervisor === "tray" ? "by the tray" : "elsewhere"} (data folder ${f.dataDir}); not started again` : `not started again: ${f.why}`);
    become("taken");
  };

  /** A question to Filament that got no answer at all. @param {any} e @returns {Asked} */
  const unanswered = (e) => ({ ok: false, unanswered: true, note: String(e?.message || e) });

  /** Resolve once the child ends; end it at `END_WAIT_MS` where it has not. */
  const untilEnded = () => {
    const c = child;
    if (!c) return Promise.resolve();
    return new Promise((resolve) => {
      ended.push(() => resolve(undefined));
      later(() => {
        if (child === c) {
          log(`Filament did not end ${Math.round(END_WAIT_MS / 1000)} s after its stop; ending it`);
          c.kill();
        }
      }, END_WAIT_MS);
    });
  };

  return {
    /** Start the server where none runs. */
    start() {
      stopping = false;
      start();
    },
    /**
     * Start it again: Filament is asked to stop while nothing runs; it refuses while a turn runs, and the answer says
     * what holds it. The end starts it again. `force`: one that gives no answer is ended (the person chose to).
     * @param {{ force?: boolean }} [o]
     * @returns {Promise<Asked>}
     */
    async restart({ force = false } = {}) {
      if (stopping) return { ok: true };
      if (!child) {
        // Not running (it failed, its port was taken): the port is asked again first.
        if (!pending) {
          pending = true;
          await again();
        }
        return { ok: true };
      }
      if (state === "starting" || state === "late" || (force && state === "up")) {
        // A start that has not answered runs nothing yet, and one that does not answer was chosen to be ended: begun
        // again, the gap kept.
        meant = true;
        become("restarting");
        child.kill();
        await untilEnded();
        return { ok: true };
      }
      if (state !== "up") return { ok: true };
      const asked = await shutdown(true).catch(unanswered);
      if (!asked.ok) return asked;
      meant = true;
      become("restarting");
      await untilEnded();
      return { ok: true };
    },
    /**
     * Stop it for good (Quit). `force`: stop even while work runs (the person chose to); else a refusal comes back as
     * it came, and nothing stops.
     * @param {{ force?: boolean }} [o]
     * @returns {Promise<Asked>}
     */
    async stop({ force = false } = {}) {
      if (!child) {
        stopping = true;
        become("stopped");
        return { ok: true };
      }
      if (state !== "up") {
        // Not answering yet, it runs nothing of anyone's: ended without a question. Restarting or stopping, its stop
        // was asked already: its end is waited for.
        const fresh = state === "starting" || state === "late";
        stopping = true;
        become("stopping");
        if (fresh) child.kill();
        await untilEnded();
        return { ok: true };
      }
      const asked = await shutdown(!force).catch(unanswered);
      if (!asked.ok && !force) return asked;
      stopping = true;
      // One that ended while it was asked is stopped already: nothing to end, nothing to wait for.
      if (!child) {
        become("stopped");
        return { ok: true };
      }
      become("stopping");
      // A server that could not be asked is ended.
      if (!asked.ok) child.kill();
      await untilEnded();
      return { ok: true };
    },
    /** `found`, while taken: who holds the port. @returns {{ state: State, pid: number | undefined, since: number, found?: import("./start.js").Found }} */
    now: () => ({ state, pid: child?.pid, since, ...(state === "taken" ? { found } : {}) }),
  };
}
