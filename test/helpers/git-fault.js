// @ts-check
// A git call that fails, for a test whose git runs on the spawn pool's threads (src/adapters/git/spawn-pool.js), which
// no patch of the test's own thread reaches: git itself answers the call a rule names with the fault, asked otherwise
// than Filament asked it — an option git does not know (it exits 129, nothing on its standard output), another
// question than the one asked, other words on its standard input. The answer comes from a Node process of its own
// (`withGitFault`), started with this file in NODE_OPTIONS, which loads it on every thread — the pool's too, as
// test/helpers/process-trace.mjs relies on — and with the rule in FILAMENT_GIT_FAULT. On each thread its spawn of git
// is wrapped; on the process's own this file is its script too: `node <this file> <an export of worktree.js> <its
// arguments as JSON>` calls that export once, and says on its standard output, as JSON, what it gave and the git
// commands it started (`gitRuns`), each by its words as Filament asked them.
//
// A test whose scene runs in its own process — a registry, its turns, an Apply pressed while a read runs — arms a git
// call there instead (`gitFaultsHere`), before the pool starts its first thread: this file goes into NODE_OPTIONS, which
// the pool's threads read as they start (they take none of the process's flags, and the environment's are theirs), and
// each thread reads the call armed from a file of the test's as it starts git, so the rule stands before the git it
// names, on whichever thread starts it. The first git call it names after it is armed — that one alone — is held where
// it ends, its process gone but its end not yet told, until the test lets it go or its stop comes; or another program
// starts in its place; or it is asked with other words. The threads tell the test it was reached, and hear that it may
// end, on a BroadcastChannel.
import cp, { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BroadcastChannel, isMainThread, threadId } from "node:worker_threads";

/**
 * The git call whose words are `ask`, started with `instead`; `input`, where given, a pattern in what it reads on its
 * standard input and what it is replaced by.
 * @typedef {{ ask: string[], instead: string[], input?: [string, string] }} Fault
 */
/**
 * The git calls a rule armed in this process names: those whose words have every one of `has` and none of `lacks`.
 * @typedef {{ has: string[], lacks?: string[] }} Words
 */
/**
 * A git call armed in this process (`gitFaultsHere`), the first that `match` names: `hold` — it runs whole, and its end
 * is told only once the test lets it go, or at once where its stop comes; `instead` — another program, with its
 * arguments, starts in its place, git's options its; `args` — git is asked these words instead, after the `-c` pairs
 * Filament sets first.
 * @typedef {{ match: Words, hold?: boolean, instead?: [string, string[]], args?: string[] }} Armed
 */

const HERE = fileURLToPath(import.meta.url);
const RULE = process.env.FILAMENT_GIT_FAULT;
/** Where this process's armed call waits for the thread that starts it, and whose process armed it. */
const ARMED_IN = process.env.FILAMENT_GIT_FAULTS || "";
const ARMED_BY = Number(process.env.FILAMENT_GIT_FAULTS_PID || 0);
/** The channel the threads tell an armed call's moments on, and hear that a held one may end. */
const CHANNEL = "filament-git-faults";

/** @param {unknown} file */
const isGit = (file) => /^git(\.exe)?$/i.test(basename(String(file)));
/** How many of `args` are the `-c name=value` pairs Filament sets first. @param {string[]} args */
const pairs = (args) => {
  let i = 0;
  while (args[i] === "-c") i += 2;
  return i;
};

if (RULE) {
  const { ask, instead, input } = /** @type {Fault} */ (JSON.parse(RULE));
  const spawn = cp.spawn;
  /** @type {any} */ (cp).spawn = function (/** @type {any} */ file, /** @type {any} */ args, /** @type {any[]} */ ...rest) {
    let named = false;
    if (isGit(file) && Array.isArray(args)) {
      // Its words past the `-c name=value` pairs Filament sets first, which it keeps.
      const i = pairs(args);
      named = JSON.stringify(args.slice(i)) === JSON.stringify(ask);
      if (named) args = [...args.slice(0, i), ...instead];
    }
    const child = /** @type {any} */ (spawn).call(this, file, args, ...rest);
    if (named && input && child.stdin) {
      const end = child.stdin.end;
      child.stdin.end = function (/** @type {any} */ chunk, /** @type {any[]} */ ...more) {
        const text = chunk == null ? "" : Buffer.from(chunk).toString("utf8");
        return end.call(this, text.replace(new RegExp(input[0]), input[1]), ...more);
      };
    }
    return child;
  };
  syncBuiltinESMExports();
}

if (ARMED_IN && ARMED_BY === process.pid) {
  const armedFile = join(ARMED_IN, "armed.json");
  /** @type {BroadcastChannel | null} */
  let heard = null;
  /** Held calls let go before their end came. @type {Set<number>} */
  const gone = new Set();
  /** Each held call's end, told when it is let go. @type {Map<number, () => void>} */
  const waiting = new Map();
  const channel = () => {
    if (!heard) {
      heard = new BroadcastChannel(CHANNEL);
      /** @type {any} */ (heard).unref?.();
      heard.onmessage = (/** @type {any} */ m) => {
        const token = m.data?.go;
        if (typeof token !== "number") return;
        const tell = waiting.get(token);
        if (tell) tell();
        else gone.add(token);
      };
    }
    return heard;
  };
  let taken = 0;
  /** The armed call, taken for this start where it names `words`: no other thread's start takes it after. @param {string[]} words */
  const take = (words) => {
    /** @type {(Armed & { token: number }) | null} */
    let rule = null;
    try {
      rule = JSON.parse(readFileSync(armedFile, "utf8"));
    } catch {
      return null;
    }
    if (!rule || !rule.match.has.every((w) => words.includes(w)) || (rule.match.lacks || []).some((w) => words.includes(w))) return null;
    try {
      renameSync(armedFile, join(ARMED_IN, `taken-${threadId}-${++taken}.json`));
    } catch {
      return null;
    }
    return rule;
  };
  const spawn = cp.spawn;
  /** @type {any} */ (cp).spawn = function (/** @type {any} */ file, /** @type {any} */ args, /** @type {any[]} */ ...rest) {
    const rule = isGit(file) && Array.isArray(args) ? take(args.slice(pairs(args)).map(String)) : null;
    if (!rule) return /** @type {any} */ (spawn).call(this, file, args, ...rest);
    const said = channel();
    if (rule.instead) {
      const child = /** @type {any} */ (spawn).call(this, rule.instead[0], rule.instead[1], ...rest);
      said.postMessage({ reached: rule.token });
      return child;
    }
    if (rule.args) args = [...args.slice(0, pairs(args)), ...rule.args];
    const child = /** @type {any} */ (spawn).call(this, file, args, ...rest);
    if (!rule.args && !rule.hold) return child;
    if (!rule.hold) {
      said.postMessage({ reached: rule.token });
      return child;
    }
    // Held where it ends: its exit kept from its thread until the test lets it go, or until its stop comes — told at
    // once then, as a git its stop ended is.
    const emit = child.emit;
    /** @type {any[] | null} */
    let ended = null;
    let stopped = false;
    const tell = () => {
      waiting.delete(rule.token);
      if (ended) emit.call(child, "exit", ...ended);
      ended = null;
    };
    child.emit = function (/** @type {string} */ event, /** @type {any[]} */ ...a) {
      if (event !== "exit" || stopped || gone.has(rule.token)) return emit.call(this, event, ...a);
      ended = a;
      waiting.set(rule.token, tell);
      said.postMessage({ reached: rule.token });
      return true;
    };
    const kill = child.kill;
    child.kill = function (/** @type {any[]} */ ...a) {
      stopped = true;
      if (!ended) return kill.apply(this, a);
      tell();
      return true;
    };
    return child;
  };
  syncBuiltinESMExports();
}

if (isMainThread && !!process.argv[1] && resolve(process.argv[1]) === HERE) {
  const [name, json] = process.argv.slice(2);
  const { gitRuns } = await import("./git-runs.js");
  const worktree = /** @type {Record<string, (...a: unknown[]) => Promise<unknown>>} */ (/** @type {unknown} */ (await import("../../src/adapters/git/worktree.js")));
  process.stdout.write(JSON.stringify(await gitRuns(() => worktree[name](...JSON.parse(json)))));
}

/**
 * What worktree.js's export `name` gives for `args`, and the git commands it started, from a Node process of its own
 * in which git answers the call `fault` names as it is asked there.
 * @param {Fault} fault @param {string} name @param {unknown[]} args
 * @returns {Promise<{ out: any, runs: string[][] }>}
 */
export function withGitFault(fault, name, args) {
  const preload = `--import=${pathToFileURL(HERE).href}`;
  const env = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, preload].filter(Boolean).join(" "), FILAMENT_GIT_FAULT: JSON.stringify(fault) };
  return new Promise((done, fail) =>
    execFile(process.execPath, [HERE, name, JSON.stringify(args)], { env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (e, out, err) =>
      e ? fail(new Error(`${e.message}\n${err}`)) : done(JSON.parse(String(out))),
    ),
  );
}

/** @type {{ arm: (rule: Armed) => { reached: Promise<void>, go: () => void } } | null} */
let here = null;
/**
 * Git calls armed in this process, on whichever of the pool's threads starts them: called before the pool starts its
 * first thread — at the top of a test file —, since a thread reads NODE_OPTIONS as it starts. `arm(rule)` arms the
 * first git call `rule` names from now on (one at a time: a rule armed again stands in place of one no git took yet):
 * `reached` once it has — held, once git has ended; else once its program started —, and `go()` lets a held one end.
 */
export function gitFaultsHere() {
  if (here) return here;
  const dir = mkdtempSync(join(tmpdir(), "filament-git-faults-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  Object.assign(process.env, {
    FILAMENT_GIT_FAULTS: dir,
    FILAMENT_GIT_FAULTS_PID: String(process.pid),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(HERE).href}`].filter(Boolean).join(" "),
  });
  const said = new BroadcastChannel(CHANNEL);
  /** @type {any} */ (said).unref?.();
  /** Each armed call's word that it was reached. @type {Map<number, () => void>} */
  const reached = new Map();
  said.onmessage = (/** @type {any} */ m) => reached.get(m.data?.reached)?.();
  let token = 0;
  here = {
    arm(rule) {
      const t = ++token;
      /** @type {() => void} */
      let came = () => {};
      const at = new Promise((r) => (came = () => r(undefined)));
      reached.set(t, came);
      const file = join(dir, "armed.json");
      // Written whole, then put in place: a thread reads the rule before it, or after it, never half of it.
      writeFileSync(`${file}.${t}`, JSON.stringify({ ...rule, token: t }));
      renameSync(`${file}.${t}`, file);
      return { reached: at.then(() => void reached.delete(t)), go: () => said.postMessage({ go: t }) };
    },
  };
  return here;
}
