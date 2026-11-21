// @ts-check
// Ending a process Filament started, with everything that process started: an agent and its helpers, an MCP server, a
// terminal's shell, a hook's command, memory's engine. One kill, so each of them is carried out the same way.
import { spawn } from "node:child_process";
import { durationWords } from "../../core/text.js";

/** How long taskkill may take: one that hangs past it would hold every stop that waits for the kill. */
const TASKKILL_MS = 10_000;

/**
 * End `child` with its tree. On Windows a bare kill leaves what the child started running, so the tree goes through
 * taskkill while the child still runs (`/T` finds children through their parent's id). taskkill's exit is read: one
 * that failed, could not start, or did not finish in its time (`waitMs`) leaves the child to the direct kill and says
 * why through `warn` — a process Filament believes gone must not keep running, nor hold its pipes open. A child Node
 * has already seen end gets no taskkill: its id may be another process's by now; and one that ended while taskkill
 * looked for it is not a failure. Elsewhere there is only the direct kill. Settles once the kill is carried out.
 * @param {import("node:child_process").ChildProcess | null | undefined} child
 * @param {object} [o]
 * @param {boolean} [o.gone]  the caller already knows the child ended, or has a kill under way
 * @param {string} [o.platform]
 * @param {(what: string) => void} [o.warn]  why taskkill did not do it: "exited 2", "could not start (…)", "did not
 *   finish in 10 s"
 * @param {() => void} [o.direct]  the kill without taskkill; the child's own `kill()` when not given
 * @param {number} [o.waitMs]  how long taskkill may take, `TASKKILL_MS`
 * @returns {Promise<void>}
 */
export function killTree(child, { gone = false, warn = () => {}, direct, platform = process.platform, waitMs = TASKKILL_MS } = {}) {
  if (!child) return Promise.resolve();
  const kill = () => {
    try {
      if (direct) direct();
      else child.kill();
    } catch {}
  };
  const ended = () => child.exitCode != null || child.signalCode != null;
  if (platform !== "win32" || !child.pid || gone || ended()) {
    kill();
    return Promise.resolve();
  }
  return new Promise((done) => {
    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @param {string} what */
    const fallback = (what) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      warn(what);
      kill();
      done();
    };
    try {
      const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      // A taskkill that hangs is ended, and the kill goes on without it.
      timer = setTimeout(() => {
        try {
          k.kill();
        } catch {}
        fallback(`did not finish in ${durationWords(waitMs)}`);
      }, waitMs);
      k.on("error", (e) => fallback(`could not start (${e.message})`));
      k.on("exit", (code) => {
        clearTimeout(timer);
        // A taskkill that found nothing because the child ended meanwhile has nothing left to do, or to say.
        if (code !== 0 && !ended()) return fallback(`exited ${code}`);
        settled = true;
        done();
      });
    } catch (e) {
      fallback(`could not start (${e instanceof Error ? e.message : e})`);
    }
  });
}
