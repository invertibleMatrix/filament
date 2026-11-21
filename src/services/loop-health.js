// @ts-check
// The event loop's health, in the server's log. The stall detector (services/loop-stall.js) records a hold of 2 s or
// more as an operation; a server that is slow without ever stalling that long — every request a beat late while runs
// stream, a page waiting on many small holds — said nothing. This watches the loop's delay over each window and
// writes one line when its 99th percentile passed the line (100 ms), at most once a minute, with how many slow windows
// went unsaid since. Content-free: delays and counts.
//
// It reads `monitorEventLoopDelay` and resets it after each window. A reset forgets the histogram's last sample time,
// so a delay that began within one sample of it can be missed (loop-stall.js's reason to time its own tick); a
// percentile over ten seconds of samples does not hang on one sample.
import { monitorEventLoopDelay } from "node:perf_hooks";

/** A loop whose p99 delay over a window passes this is slow enough to say. */
export const SLOW_P99_MS = 100;

/**
 * Watch the loop's delay: each `windowMs`, its p99 over the window; past `p99Ms`, one `info` line in the server log —
 * the p99, the max and the mean — unless a line was written less than `quietMs` ago, when the window is counted
 * instead and said with the next line. → `{ look, stop }`: `look` is a window's end, now.
 * @param {{ log: (level: string, msg: string) => void, windowMs?: number, p99Ms?: number, quietMs?: number,
 *   now?: () => number, histogram?: { enable: () => void, disable: () => void, reset: () => void, percentile: (p: number) => number, max: number, mean: number } }} o
 *   `histogram`: a test's stand-in for the loop's
 */
export function watchLoopHealth({ log, windowMs = 10_000, p99Ms = SLOW_P99_MS, quietMs = 60_000, now = Date.now, histogram = monitorEventLoopDelay({ resolution: 10 }) }) {
  histogram.enable();
  let saidAt = -Infinity;
  let unsaid = 0;
  const ms = (/** @type {number} */ ns) => Math.round(ns / 1e6);
  const look = () => {
    const p99 = ms(histogram.percentile(99));
    const max = ms(histogram.max);
    const mean = ms(histogram.mean);
    histogram.reset();
    if (!(p99 > p99Ms)) return;
    const t = now();
    if (t - saidAt < quietMs) return void unsaid++;
    log("info", `the event loop was slow: its delay over the last ${Math.round(windowMs / 1000)} s was ${p99} ms at the 99th percentile (max ${max} ms, mean ${mean} ms)${unsaid ? `; ${unsaid} more slow window${unsaid === 1 ? "" : "s"} since the last line` : ""}`);
    saidAt = t;
    unsaid = 0;
  };
  const timer = setInterval(look, windowMs);
  timer.unref();
  return {
    look,
    stop() {
      clearInterval(timer);
      histogram.disable();
    },
  };
}
