// @ts-check
// The event-loop stall detector (HarnessV3-FixRound F3 item 17, BUG-19): about 60 s passed between the owner's Enter
// and the server seeing the turn, and nothing on the server's side could say whether the process itself had been
// held. A stall past the threshold is now an operation — a warning on the System tab ("Warnings and errors") saying
// how long the loop was held. Content-free: a duration and the threshold.
//
// The watcher times its own tick. It first read `monitorEventLoopDelay` and reset it after each look, but a reset also
// forgets the histogram's last sample time, so a stall that began within one sample of a reset was never recorded (a
// probe on Node 24: 0 of 10 seen) — about 2 % of the server's stalls, and the F3 test failed one run in three (found
// in F4's gates).
import { performance } from "node:perf_hooks";

/** A held loop worth a line: every request waits while it lasts. */
export const STALL_MS = 2000;

/**
 * Watch the event loop: a tick every `everyMs`; one that comes late by `thresholdMs` or more is a stall, recorded at
 * once as a `log` operation (`sub: "stall"`, level warn) with how late it came — the stall's length, short by at most
 * one tick (100 ms by default: the tenth of a second the warning shows). One stall, one tick, one warning. → `{ stop }`.
 * @param {{ ops: { record: (kind: string, title: string, o?: any) => any }, thresholdMs?: number, everyMs?: number }} o
 */
export function watchLoopStalls({ ops, thresholdMs = STALL_MS, everyMs = 100 }) {
  let last = performance.now();
  const timer = setInterval(() => {
    const t = performance.now();
    const ms = t - last - everyMs;
    last = t;
    if (!(ms >= thresholdMs)) return;
    ops.record("log", `the server's event loop was held for ${(ms / 1000).toFixed(1)} s — every request waited meanwhile`, {
      level: "warn",
      sub: "stall",
      ms,
      detail: { ms: Math.round(ms), thresholdMs },
    });
  }, everyMs);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
