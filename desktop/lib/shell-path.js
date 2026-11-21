// @ts-check
// The PATH a terminal has, for the app a Mac's Finder or Dock, or a Linux desktop's launcher, started (the owner's of
// 11-08: the built Mac app said every coding agent "needs npm" while npm ran in the Terminal). macOS hands an app launchd's
// /usr/bin:/bin:/usr/sbin:/sbin, without what the person's shell profile adds — Homebrew's /opt/homebrew/bin,
// nodejs.org's /usr/local/bin, nvm, ~/.local/bin — so npm, node, git, gh and the agents' commands a terminal finds were
// missing to Filament, and to everything it runs. Read once as the app starts, from the person's login shell run
// interactive (a profile sets PATH in .zshrc as often as in .zprofile), between marks so a profile's own output is
// passed over, in a few seconds or not at all: a slow or broken profile leaves the app's own PATH. Windows hands an app
// the person's whole PATH, so it reads none. Plain Node: main.js puts it in place before the server starts.
import { execFile } from "node:child_process";
import { userInfo } from "node:os";

/** What the shell's answer is found between: whatever a profile prints around it is not the PATH. */
const MARK = "__FILAMENT_PATH__";
/** How long the login shell has to answer. */
export const SHELL_PATH_MS = 5000;

/**
 * The shell that reads the person's profile: theirs (SHELL, else their account's), else the system's own.
 * @param {Record<string, string | undefined>} env @param {NodeJS.Platform} platform @param {() => string} accountShell
 */
export function loginShell(env, platform, accountShell) {
  if (env.SHELL && env.SHELL.startsWith("/")) return env.SHELL;
  let own = "";
  try {
    own = accountShell();
  } catch {}
  return own && own.startsWith("/") ? own : platform === "darwin" ? "/bin/zsh" : "/bin/sh";
}

/**
 * The PATH between the marks of a login shell's output, or "" where it gave none.
 * @param {string} out
 */
export function pathBetween(out) {
  const from = out.indexOf(MARK), to = out.indexOf(MARK, from + MARK.length);
  return from < 0 || to < 0 ? "" : out.slice(from + MARK.length, to).trim();
}

/**
 * The PATH to run with: the shell's folders first, in its order, then the app's own the shell's lacks; each once.
 * @param {string} shell @param {string | undefined} own
 */
export function mergedPath(shell, own) {
  const seen = new Set();
  return [...shell.split(":"), ...String(own || "").split(":")].filter((d) => d && !seen.has(d) && seen.add(d)).join(":");
}

/**
 * The person's login shell's PATH, or "" where none is read: on Windows, or where the shell fails, says nothing between
 * the marks or takes longer than `timeoutMs`. Its stdin is closed and its profile's oh-my-zsh update and tmux start
 * are told to wait, so it can't stop to ask.
 * @param {{ env?: Record<string, string | undefined>, platform?: NodeJS.Platform, timeoutMs?: number, accountShell?: () => string,
 *   run?: (file: string, args: string[], o: { env: Record<string, string | undefined>, timeout: number }) => Promise<string> }} [o]
 * @returns {Promise<{ path: string, shell: string, why?: string }>}
 */
export async function readShellPath({
  env = process.env,
  platform = process.platform,
  timeoutMs = SHELL_PATH_MS,
  accountShell = () => userInfo().shell || "",
  run = (file, args, o) =>
    new Promise((done, fail) => {
      const child = execFile(file, args, { env: o.env, timeout: o.timeout, killSignal: "SIGKILL", maxBuffer: 1 << 20, encoding: "utf8" }, (e, stdout) => (e ? fail(e) : done(stdout)));
      child.stdin?.end();
    }),
} = {}) {
  if (platform === "win32") return { path: "", shell: "", why: "Windows hands an app the whole PATH" };
  const shell = loginShell(env, platform, accountShell);
  const asked = `printf '%s' '${MARK}'; /usr/bin/printenv PATH; printf '%s' '${MARK}'`;
  try {
    const out = await run(shell, ["-ilc", asked], { env: { ...env, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTART: "false", ZSH_TMUX_AUTOSTARTED: "true" }, timeout: timeoutMs });
    const path = pathBetween(out);
    return path ? { path, shell } : { path: "", shell, why: "it printed no PATH" };
  } catch (e) {
    const err = /** @type {any} */ (e);
    return { path: "", shell, why: err?.killed || err?.signal === "SIGKILL" ? `it took over ${timeoutMs / 1000} s` : String(err?.message || e).split("\n")[0] };
  }
}
