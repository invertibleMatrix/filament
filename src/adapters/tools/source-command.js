// @ts-check
// A dashboard source's command, run (HarnessV4_Space_Plan S2, SG-D6): found as a shell finds it, no shell between, in
// the project's folder, the environment an MCP server gets, its stdout read up to 1 MB within 60 s. A button's command
// (S3, SG-D11) runs the same way with no clock on it: until it ends, or the person stops it. The dashboard runner
// (services/dashboard-runner.js) is handed both by the composition root; the tests hand it stand-ins.
import { spawn } from "node:child_process";
import { COMMAND_BYTES, COMMAND_MS } from "../../core/dashboard-sources.js";
import { hider } from "../../core/app-secrets.js";
import { safeEnv } from "./hands.js";
import { programSpawn } from "./shell.js";
import { killTree } from "./kill-tree.js";

/**
 * A command run as a source runs; a failure in words — not found, its exit and the last lines it said, too much, too
 * long, stopped (`signal`: its dashboard paused, taken out or kept again while it ran).
 * @type {import("../../core/dashboard-sources.js").RunCommand}
 */
export function runCommand(argv, cwd, signal, extra = {}) {
  return new Promise((done) => {
    // An app's secrets (10-29) beside the environment an MCP server gets.
    const env = { ...safeEnv(), ...extra };
    // Each hidden before what it said is cut — its stderr to its last 4000, its last lines to 400 —: a secret astride a
    // cut left its start, which no form matched (found reviewing the Space work, 10-29).
    const hide = hider(extra).text;
    const run = programSpawn(argv[0], argv.slice(1), { cwd, env });
    let child;
    try {
      child = spawn(run.file, run.args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: run.verbatim });
    } catch (/** @type {any} */ e) {
      return done({ ok: false, error: `${argv[0]} could not start (${e?.message || e})` });
    }
    /** @type {Buffer[]} */
    const out = [];
    let bytes = 0;
    let err = "";
    /** @type {string | null} */
    let cut = null;
    let settled = false;
    /** @param {import("../../core/dashboard-sources.js").CommandOut} r */
    const end = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stopped);
      done(r);
    };
    const stop = (/** @type {string} */ why) => {
      cut = why;
      void killTree(child);
    };
    const timer = setTimeout(() => stop(`it did not finish in ${COMMAND_MS / 1000} s`), COMMAND_MS);
    timer.unref?.();
    const stopped = () => stop("it was stopped");
    if (signal?.aborted) stopped();
    else signal?.addEventListener("abort", stopped, { once: true });
    child.stdout?.on("data", (d) => {
      bytes += d.length;
      if (bytes > COMMAND_BYTES) return cut ? undefined : stop(`it said more than ${COMMAND_BYTES / 1_048_576} MB`);
      out.push(d);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d) => {
      err = hide(err + d).slice(-4000);
    });
    child.on("error", (/** @type {any} */ e) =>
      end({ ok: false, error: e?.code === "ENOENT" ? `${argv[0]} was not found on this computer` : `${argv[0]} could not start (${e?.message || e})` }),
    );
    child.on("close", (code) => {
      if (cut) return end({ ok: false, error: cut });
      const text = Buffer.concat(out).toString("utf8");
      if (code !== 0) {
        const said = hide(err.trim() || text.trim()).split(/\r?\n/).filter((l) => l.trim()).slice(-3).join(" · ").slice(0, 400);
        return end({ ok: false, error: `${argv[0]} exited ${code ?? "on a signal"}${said ? `: ${said}` : ""}` });
      }
      end({ ok: true, out: text });
    });
  });
}

/** How much of what a button's command said is kept: its last words, for the sheet, the toast and What happened. */
const ACTION_TAIL = 4000;

/**
 * A button's command run as a source's is, with no clock on it: it runs until it ends, or `signal` stops it (its tree
 * killed). What it said on stdout and stderr is kept to its last 4000 characters, and handed to `onData` as it comes (an
 * app's page shows it live); a failure in words — not found, its exit and its last lines, stopped.
 * @type {import("../../core/dashboard-sources.js").RunAction}
 */
export function runActionCommand(argv, cwd, signal, onData, extra = {}) {
  return new Promise((done) => {
    const env = { ...safeEnv(), ...extra };
    const run = programSpawn(argv[0], argv.slice(1), { cwd, env });
    let child;
    try {
      child = spawn(run.file, run.args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: run.verbatim });
    } catch (/** @type {any} */ e) {
      return done({ ok: false, error: `${argv[0]} could not start (${e?.message || e})`, said: "" });
    }
    // Hidden before it is cut to its last words, as a source's is (found reviewing the Space work, 10-29); what it says
    // live is the runner's to hide, piece by piece.
    const hide = hider(extra).text;
    let said = "";
    const keep = (/** @type {string} */ d) => {
      said = hide(said + d).slice(-ACTION_TAIL);
      try {
        onData?.(d);
      } catch {}
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", keep);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", keep);
    let stopped = false;
    const stop = () => {
      stopped = true;
      void killTree(child);
    };
    let settled = false;
    /** @param {import("../../core/dashboard-sources.js").ActionOut} r */
    const end = (r) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", stop);
      done(r);
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    child.on("error", (/** @type {any} */ e) =>
      end({ ok: false, error: e?.code === "ENOENT" ? `${argv[0]} was not found on this computer` : `${argv[0]} could not start (${e?.message || e})`, said }),
    );
    child.on("close", (code) => {
      if (stopped) return end({ ok: false, error: "you stopped it", said });
      if (code !== 0) {
        const last = said.split(/\r?\n/).filter((l) => l.trim()).slice(-3).join(" · ").slice(0, 400);
        return end({ ok: false, error: `${argv[0]} exited ${code ?? "on a signal"}${last ? `: ${last}` : ""}`, said });
      }
      end({ ok: true, said });
    });
  });
}
