// @ts-check
// The PTY behind an integrated terminal (B4): node-pty, the one
// AgentPlan.md §9.4 named for this feature. The native module is required lazily (a machine without the prebuild is
// a clean "terminal is unavailable" at call time, never a boot crash), and `spawn` is injectable so the service and
// its tests never need a real shell.
import { createRequire } from "node:module";
import { release as osRelease } from "node:os";
import { withoutOwnSwitch } from "../tools/own-programs.js";

const requireHere = createRequire(import.meta.url);

/** @type {((o: any) => any) | null} */
let realSpawn = null;

/**
 * One PTY, or the failure in words. It runs a shell — PowerShell on Windows, the login shell elsewhere — or the
 * `program` given (an agent's sign-in, HarnessV3-ACP AC3-7), which brings its whole environment. TERM tells the
 * programs inside they are talking to xterm.
 * @param {{ cwd?: string, cols?: number, rows?: number, env?: Record<string, string>,
 *   program?: { file: string, args: string[], env: Record<string, string> }, spawn?: (o: any) => any }} o
 */
export function spawnTerminal(o = {}) {
  const cols = Math.min(500, Math.max(20, Math.floor(Number(o.cols) || 80)));
  const rows = Math.min(300, Math.max(4, Math.floor(Number(o.rows) || 24)));
  const fromDefault = getDefaultSpawn();
  const spawn = o.spawn || ((/** @type {any} */ x) => fromDefault?.(x));
  const isWin = process.platform === "win32";
  const file = o.program ? o.program.file : isWin ? "powershell.exe" : process.env.SHELL || "/bin/bash";
  const args = o.program ? o.program.args : isWin ? ["-NoLogo"] : [];
  // The FULL environment or Windows shells die at boot (node-pty does not merge): PowerShell without SystemRoot
  // answers "Internal Windows PowerShell error" and exits before the first prompt. A program's is whole already.
  // Without the switch Filament set for itself (tools/own-programs.js): the person's shell finds a folder's program
  // by its name as it does in a terminal of their own.
  const env = withoutOwnSwitch({ ...(o.program ? o.program.env : { ...process.env, ...o.env }), TERM: "xterm-256color" });
  try {
    /** @type {any} */
    const pty = spawn({ cwd: o.cwd, cols, rows, env, file, args });
    return { ok: true, pty };
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `the terminal could not start: ${String(e?.message || e).slice(0, 200)}` };
  }
}

/**
 * Which Windows console stands behind this machine's terminals, as xterm's `windowsPty` names it — ConPTY, the one
 * node-pty runs on every Windows that has it, and its build — or null away from Windows. A view told so grows as the
 * console does (new rows blank at its foot, nothing pulled back from the scrollback): else its rows and the shell's
 * part, and typing lands a line from the prompt.
 * @param {string} [platform] @param {string} [release]  os.release(): "10.0.26200"
 * @returns {{ backend: "conpty", buildNumber: number } | null}
 */
export function windowsPtyOf(platform = process.platform, release = osRelease()) {
  if (platform !== "win32") return null;
  const buildNumber = Number(String(release).split(".")[2]) || 0;
  return buildNumber ? { backend: "conpty", buildNumber } : null;
}

/** The lazy node-pty binding, memoized. */
function getDefaultSpawn() {
  if (realSpawn) return realSpawn;
  let pty;
  try {
    pty = requireHere("node-pty");
  } catch (/** @type {any} */ e) {
    throw new Error(`node-pty is not installed or its native module did not load (${String(e?.message || e).slice(0, 120)})`);
  }
  realSpawn = ({ cwd, cols, rows, env, file, args }) => pty.spawn(file, args, { cwd, cols, rows, env, name: "xterm-256color" });
  return realSpawn;
}
