// @ts-check
// A running turn opened from elsewhere (the window opened again from the tray, a second window, a reload), or a send of
// the page's own whose connection dropped, is followed from its run's first event, and the run socket replays a long
// run one message at a time, after the newest words, which come whole ahead of it. Drawn a frame at a time as it came,
// the turn rolled through every step it had taken, each step's call flashing under those words (the owner's of 11-16:
// "it does show the tail but it shows quite a lot of tool calls being made rapidly showing up and hiding"; a lead's
// ten-hour turn, 34,607 events). Its draws wait out of sight until the replay is in at the newest event its hello named,
// then land at once, or once it falls quiet (`REPLAY_QUIET_MS`) or has taken `REPLAY_MAX_MS`, a replay that slow drawn
// as it comes. A thread's rounds wait the same way (subagent-viewer.js `heardRun`). DOM-free.

/** A replay that brings nothing for this long is drawn as it stands. */
export const REPLAY_QUIET_MS = 1500;
/** And this long at most in all: on a slow link a long run's replay is drawn as the rest comes, never left out of sight. */
export const REPLAY_MAX_MS = 10_000;

/**
 * @param {{ onHold: () => void, onEnd: () => void }} on  the replay held (its draws wait), and in (what waited is drawn)
 * @param {{ setTimeout?: (fn: () => void, ms: number) => any, clearTimeout?: (handle: any) => void, now?: () => number }} [io]  a test's own clock
 */
export function createReplayHold(on, io = {}) {
  const later = io.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const unlater = io.clearTimeout || ((handle) => clearTimeout(handle));
  const now = io.now || Date.now;
  /** The newest event the hello named: the replay is in once it is here. */
  let to = 0;
  let holding = false;
  /** When the replay last brought something, and when it is drawn whatever it has brought. */
  let heardAt = 0;
  let until = 0;
  /** @type {any} */
  let wait = null;
  const end = () => {
    if (wait != null) unlater(wait);
    wait = null;
    if (!holding) return;
    holding = false;
    on.onEnd();
  };
  /** Drawn once the replay falls quiet or has waited its most; else looked at again then. */
  const look = () => {
    const left = Math.min(heardAt + REPLAY_QUIET_MS, until) - now();
    if (left <= 0) return end();
    wait = later(look, left);
  };
  return {
    get holding() {
      return holding;
    },
    /**
     * The follow's hello, with where the run stood (its `run.events`, the newest event's `n`) and the newest event
     * here. A follow taken up again (its socket dropped, the watchdog) replays only what it missed, onto what is drawn:
     * it holds nothing, nor does a run with nothing to replay.
     * @param {unknown} runEvents @param {number} have
     */
    begin(runEvents, have) {
      to = Math.max(to, Number(runEvents) || 0);
      // Taken up again while it holds — its socket dropped mid-replay —: the new hello is word from the run, and the
      // quiet counts from it (the review of c5b791484).
      if (holding) return void (heardAt = now());
      if (have > 0 || to <= 0) return;
      holding = true;
      heardAt = now();
      until = heardAt + REPLAY_MAX_MS;
      wait = later(look, REPLAY_QUIET_MS);
      on.onHold();
    },
    /** An event heard: at the hello's newest, the replay is in. @param {unknown} n */
    heard(n) {
      if (!holding) return;
      if (Number(n) >= to) end();
      else heardAt = now();
    },
    /** Its words came: the replay is not quiet, though no event has come yet (a long reply's words come ahead of it,
     *  and its first event waits for the socket to take them). */
    brought() {
      if (holding) heardAt = now();
    },
    /** What waits is drawn now: the turn's end reads what is drawn. */
    end,
  };
}
