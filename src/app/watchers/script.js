// @ts-check
// A program of the project as a watcher's trigger (the plan of 11-11, its v2-c): each line it prints on stdout is an
// event. This is the one source that runs a program as the person, outside any agent's permission mode, so one rule
// stands over the rest: it runs only what the person approved at Switch on, byte for byte, and no agent starts it,
// reads its secrets, or changes it without the person approving again.
// Approval is by content. At Switch on — a press, never an agent's call — the files its command names are hashed
// (`approve`, which the route hands the store's `routineOn`) and kept on the routine: its program where that is a file
// of the project, each part named as code (a script's name, also after a flag's `=`) with the code beside it in the
// project (services/script-pins.js), and a script outside the project by its own bytes. Before each start they are
// hashed again: one changed, gone, or new beside a script, and it is not started — the watcher is Proposed again
// (`watchUnapproved`), with its line and a row in Needs you, until the person switches it on. A Resume and a Put back
// approve nothing: they start it, so they are checked. One on with no record of an approval is switched off the same
// way.
// It is kept up while its watcher is on, not paused, and Pause all is off (`sync`, at each arm of the routines):
// long-running, or with `everyMin` run to its end at that interval, 60 s at most. It is stopped with its whole process
// tree on a pause, a change, a remove, Pause all and Filament's stop, and never two of one watcher run: a start waits
// for the kill before it. A long-running one that ends is started again after 1 s, 5 s, 30 s, then 5 min, the count
// starting over once it stayed up a minute; five ends in a row, each inside a minute, pause it (`watchPaused`), with
// stderr's first line. Its trouble — it was not started, could not start, ended, ran past its time, exited failing —
// is kept on the watcher's cursor for its row (`watchTrouble`) until it stays up, or a run ends well.
// It runs in the project's folder with no shell — the program the approval found for its name, and none where nothing
// answers to it (`startProgram`) —, its environment the one a command of Filament's gets plus the app secrets it
// names; their values are hidden in every word kept of it — its events, its trouble, the log. stdin is closed; stdout
// is read by lines, one of 64,000 characters at most, a longer one cut to its first characters and the rest counted.
// A line is an event: JSON `{ "summary", "id"?, "body"? }`, else its text. An `id` is the same event however often it
// is printed, while it is among the ids its cursor keeps; a line with none is one each time. 30 events a minute at
// most: the rest of that minute are one event that counts them.
// What this costs. Not pinned: a program that is the system's (node, python, gh — a bare name found on the PATH), the
// packages a script loads, what it imports from elsewhere than beside it, a script no part of the command names by a
// code file's name (what `npm run` reads from package.json, a module behind `python -m`, a folder's entry, a script
// with no extension handed to its interpreter), and the data it reads. The bytes are read a moment before the start,
// not held through it: what a program kept running loads later is the file as it stands then, and a change to it is
// found at its next start. A script edited by anyone — the person, the chat it wakes — switches its watcher off until
// the next Switch on. Lines past 30 a minute are counted, not kept, and a line printed as its watcher is paused or
// switched off is not heard. An event's `body` is kept in the Space's document until its run takes it: up to 16,000
// characters, for each of the 20 that wait. A Filament ended with no stop of its own — killed, crashed — stops no
// program: one kept running finds no reader at its next line, where most end, and one that prints nothing more runs on
// until the person ends it.
// The press is of what its sheet showed. The sheet reads what a Switch on would pin (`approvalOf`: each file, and
// `sealOf` them all, one hash), and a file's text where the person opens one (`fileOf`: one of those files alone,
// never another of the project); the press hands the seal back, and `approve` — called by the store inside the
// Switch on — pins the files as they are then only where their seal is the one it was handed. A press with no seal,
// or with another's, switches nothing on. The cost: a file changed and changed back between the sheet and the press
// is approved as the sheet showed it, which is what it is then.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { safeEnv } from "../../adapters/tools/hands.js";
import { killTree } from "../../adapters/tools/kill-tree.js";
import { programFile, programSpawn, withEnv } from "../../adapters/tools/shell.js";
import { hider } from "../../core/app-secrets.js";
import { SCRIPT_FILE } from "../../core/dashboard-sources.js";
import { shortHash } from "../../core/hash.js";
import { createLineReader } from "../../core/lines.js";
import { clip, durationWords, listed, squash, truncateMarked } from "../../core/text.js";
import { SCRIPT_LIMITS, WATCH_LIMITS, scriptSheet, watchEventOf } from "../../core/watchers.js";
import { hashOf, inProject, pinsOf, scriptsChanged } from "../../services/script-pins.js";

/** How long a long-running program that ended waits to be started again, by its ends in a row: the last, every time after. */
export const SCRIPT_RESTART_MS = Object.freeze([1_000, 5_000, 30_000, 300_000]);
/** How long one stays up before its ends are counted from none again. */
export const SCRIPT_UP_MS = 60_000;
/** How many ends in a row, each sooner than that, pause its watcher. */
export const SCRIPT_ENDS = 5;
/** The minute its events are counted in. */
const MINUTE_MS = 60_000;
/** How long a kill waits for its program's end to be said before it is taken as carried out. */
const KILL_WAIT_MS = 5_000;
/** The longest a timer can wait. */
const TIMER_MAX_MS = 2 ** 31 - 1;
/** The room the count of what was cut takes at the end of what a line said (`truncateMarked`). */
const MARK_ROOM = 40;
/** A terminal's colour and cursor codes, which are no words. */
const TERMINAL_CODE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
/** The most of a file's text a sheet is handed, in characters. */
export const SCRIPT_TEXT_MAX = 200_000;
/** How many watchers' approvals, as a sheet last read them, are held to name what differs at the press. */
const READS_MAX = 200;
/** What a sheet says of one that is on whose files are not as approved. */
const DIFFERS = "What it runs is not what you approved: Filament switches the watcher off at its program's next start, and Switch on then shows what it runs.";
/** What stands for the text of a file that went since its sheet listed it. */
const GONE = "It is not there now.";
/** What a decoder puts for bytes that are no character: where a read ended inside one, its last. */
const NO_CHARACTER = String.fromCharCode(0xfffd);

/**
 * @typedef {import("../../core/routines.js").Routine} Routine
 * @typedef {Extract<import("../../core/watchers.js").Trigger, { kind: "script" }>} ScriptTrigger
 * @typedef {{ code: number | null, signal?: string | null, error?: string }} ProgramEnd  how a program ended: its exit,
 *   the signal that ended it, or why it could not start
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, out: (chunk: string) => void, err: (chunk: string) => void, end: (end: ProgramEnd) => void, warn?: (what: string) => void }} ProgramIo
 *   `warn`: why a kill of its tree went another way than meant (kill-tree.js)
 * @typedef {{ kill: () => Promise<void> }} Program  `kill`: its whole tree ended, settled once that is carried out
 * @typedef {{ set: (fn: () => void, ms: number) => unknown, clear: (timer: any) => void }} Timers
 */

/** @type {Timers} */
const REAL_TIMERS = {
  set: (fn, ms) => {
    const t = setTimeout(fn, Math.min(Math.max(0, ms), TIMER_MAX_MS));
    t.unref?.();
    return t;
  },
  clear: (t) => clearTimeout(t),
};

/**
 * The files a script watcher's command may name: `parts`, each part that may be a file it runs — its program, as it is
 * started (on Windows a path with no extension opens the file PATHEXT finds: shell.js `programFile`), and each
 * argument named as code, also what follows the `=` of a flag (`--import=./hook.mjs`) —; `outside`, those of them
 * named as code that lie outside the project, each under its whole path. A bare program name found on the PATH is the
 * system's, and no file of these. Every part is read as it is written: a watcher's command has no holes to fill.
 * @param {readonly string[]} argv @param {string} folder @param {Record<string, string | undefined>} env
 */
function namedFiles(argv, folder, env) {
  const program = programFile(argv[0], { cwd: folder, env }) || argv[0];
  const named = argv.slice(1).flatMap((part) => {
    if (!part || !SCRIPT_FILE.test(part)) return [];
    const eq = part.indexOf("=");
    return part.startsWith("-") && eq > 0 ? [part, part.slice(eq + 1)] : [part];
  });
  const parts = [...new Set([program, ...named])];
  const byPath = /[\\/]/.test(argv[0]);
  const outside = parts
    .filter((part, i) => SCRIPT_FILE.test(part) && (i > 0 || byPath) && !inProject(folder, part) && resolve(folder, part) !== resolve(folder))
    .map((part) => ({ key: resolve(folder, part).split("\\").join("/"), file: resolve(folder, part) }));
  return { parts, outside };
}

/**
 * What a Switch on pins of a script watcher's command: each file of the project it names, with the code beside it
 * (services/script-pins.js `pinsOf`), by its path in the project; and each script it names outside the project, by its
 * own bytes, under its whole path with `/`. `{}` where it names none, or its project has no folder.
 * @param {readonly string[]} argv @param {string | null} folder
 * @param {{ hash?: (file: string) => string | null, env?: Record<string, string | undefined> }} [o]
 * @returns {Record<string, string>}
 */
export function scriptPins(argv, folder, { hash = hashOf, env = safeEnv() } = {}) {
  if (!folder) return {};
  const { parts, outside } = namedFiles(argv, folder, env);
  const pins = pinsOf(parts, folder, hash);
  for (const o of outside) {
    const bytes = hash(o.file);
    if (bytes) pins[o.key] = bytes;
  }
  return pins;
}

/**
 * The files of a script watcher's command that are not as its Switch on pinned them: changed, gone, new beside a
 * script, or named and never pinned — each once, by the path it was or would be pinned under.
 * @param {Record<string, string>} pins @param {readonly string[]} argv @param {string | null} folder
 * @param {{ hash?: (file: string) => string | null, env?: Record<string, string | undefined> }} [o]
 * @returns {string[]}
 */
export function scriptChanged(pins, argv, folder, { hash = hashOf, env = safeEnv() } = {}) {
  if (!folder) return [];
  const { parts, outside } = namedFiles(argv, folder, env);
  const changed = scriptsChanged(pins, parts, folder, hash);
  for (const o of outside) {
    const bytes = hash(o.file);
    if (bytes === null && !Object.hasOwn(pins, o.key)) continue;
    if (bytes !== pins[o.key]) changed.push(o.key);
  }
  return changed;
}

/**
 * The app secrets a script watcher is handed, as the server reads them: among the apps kept in its project's Space,
 * each name's value from the first whose Keep hands it that secret and for which the person typed one (the secrets a
 * dashboard's own commands get: services/dashboard-runner.js `sealedFor`). A name no kept app is handed, or none typed,
 * has no value.
 * @param {{ kept: () => { project: string, d: { name: string, grant?: { secrets?: string[] } | null } }[], values: (app: string) => Record<string, string> }} from
 * @returns {(project: string, names: readonly string[]) => Record<string, string>}
 */
export const appSecretsOf = ({ kept, values }) => (project, names) => {
  /** @type {Record<string, string>} */
  const out = {};
  if (!names.length) return out;
  for (const { project: p, d } of kept()) {
    if (p !== project) continue;
    const handed = (d.grant?.secrets || []).filter((n) => names.includes(n) && !Object.hasOwn(out, n));
    if (!handed.length) continue;
    const typed = values(d.name);
    for (const n of handed) if (typeof typed[n] === "string") out[n] = typed[n];
  }
  return out;
};

/**
 * A program started as a script watcher's is: found as a shell finds it and run with no shell between
 * (`programSpawn`), stdin closed, what it prints handed on as text. Only a program `programFile` finds is started —
 * the file the approval looked at. A name it does not find is handed to no spawn, and ends as not found: Windows' own
 * search for a bare name looks in the folder the program runs in, for `<name>.exe` — a file of the project no pin
 * covers. `kill` ends it with everything it started — on Windows through taskkill's tree, elsewhere by its process
 * group, which it leads — and settles once its end was said, or after `KILL_WAIT_MS`.
 * @param {readonly string[]} argv @param {ProgramIo} io @returns {Program}
 */
export function startProgram(argv, { cwd, env, out, err, end, warn = () => {} }) {
  if (!programFile(argv[0], { cwd, env })) {
    queueMicrotask(() => end({ code: null, error: `${argv[0]} was not found on this computer` }));
    return { kill: async () => {} };
  }
  const run = programSpawn(argv[0], argv.slice(1), { cwd, env });
  const group = process.platform !== "win32";
  const child = spawn(run.file, run.args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: run.verbatim, detached: group });
  let over = false;
  /** @type {Promise<void>} */
  const closed = new Promise((done) => {
    /** @param {ProgramEnd} e */
    const said = (e) => {
      if (over) return;
      over = true;
      done();
      end(e);
    };
    child.on("error", (/** @type {any} */ e) => said({ code: null, error: e?.code === "ENOENT" ? `${argv[0]} was not found on this computer` : String(e?.message || e) }));
    child.on("close", (code, signal) => said({ code, signal }));
  });
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", out);
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", err);
  return {
    async kill() {
      const direct = () => {
        try {
          if (group && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      };
      await killTree(child, { direct, warn: (what) => warn(`taskkill ${what}`) });
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      await Promise.race([closed, new Promise((done) => (timer = setTimeout(done, KILL_WAIT_MS)))]);
      clearTimeout(timer);
    },
  };
}

/** Text with no terminal codes and no control characters but a newline and a tab. @param {string} s */
const plain = (s) => s.replace(TERMINAL_CODE, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

/**
 * A line a program printed, as an event's parts, or null for a blank one: JSON with a `summary` of words gives its
 * summary, its `id` and its `body` — text, or any other value as JSON —; any other line is its own text. What is
 * longer than a summary holds is kept whole as what it said (`body`). Control characters are out before a secret is
 * looked for, so none parts a value from itself; `hide` hides each.
 * @param {string} raw @param {(s: string) => string} hide
 * @returns {{ id: string, words: string, body: string } | null}
 */
function lineParts(raw, hide) {
  const text = raw.replace(/\r$/, "");
  if (!text.trim()) return null;
  /** @type {unknown} */
  let v = null;
  if (text.trimStart().startsWith("{"))
    try {
      v = JSON.parse(text);
    } catch {
      // No JSON: its text.
    }
  const o = v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
  if (o && typeof o.summary === "string" && squash(plain(o.summary))) {
    const said = hide(plain(o.summary));
    const id = typeof o.id === "string" || typeof o.id === "number" ? squash(hide(plain(String(o.id)))) : "";
    const more = typeof o.body === "string" ? o.body : o.body == null ? "" : JSON.stringify(o.body);
    return { id, words: squash(said), body: hide(plain(more)) || (squash(said).length > WATCH_LIMITS.summary ? said.trim() : "") };
  }
  const said = hide(plain(text));
  const words = squash(said);
  return words ? { id: "", words, body: words.length > WATCH_LIMITS.summary ? said.trim() : "" } : null;
}

/** How an end is said: its exit, or what ended it; then the first line it said on stderr. @param {ProgramEnd} end @param {string} first */
const endWords = (end, first) => `${end.code === 0 ? "it ended" : end.code != null ? `it ended with exit code ${end.code}` : `it was ended by ${end.signal || "a signal"}`}${first ? `: ${first}` : ""}`;

/** Paths as a line names them: the first three, the rest counted. @param {readonly string[]} paths */
const pathsWords = (paths) => `${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""}`;

/** Whether a file is there, as a hash that reads none of it: what a sheet lists before anything is pinned. @param {string} file */
const there = (file) => {
  try {
    return statSync(file).isFile() ? "there" : null;
  } catch {
    return null;
  }
};

/** A file's size, or null where it is no file. @param {string} file */
const sizeOf = (file) => {
  try {
    const s = statSync(file);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
};

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * What a Switch on would pin, as one hash: each path with its bytes' hash, the paths sorted — the same pins seal alike
 * in any order, and no path runs into its hash. A sheet reads it and its press hands it back: the press is taken only
 * where it is the seal of what is pinned then.
 * @param {Record<string, string>} pins
 */
export const sealOf = (pins) => createHash("sha256").update(JSON.stringify(Object.keys(pins).sort().map((p) => [p, pins[p]]))).digest("hex");

/**
 * A file's text for its watcher's sheet: its first `SCRIPT_TEXT_MAX` characters, `cut` where it holds more, with its
 * size; or why it is not shown (`unread`) — it is gone, it could not be read, or it is no text: a NUL among the bytes
 * read. `path`: the file as its pin names it.
 * @param {string} file @param {string} path
 * @returns {{ path: string, text: string, cut: boolean, bytes: number } | { path: string, bytes?: number, unread: string }}
 */
function textOf(file, path) {
  /** @type {number | null} */
  let fd = null;
  try {
    fd = openSync(file, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { path, unread: GONE };
    const size = stat.size;
    // Four bytes at most for a character: what is read holds the characters shown, whatever they are.
    const buf = Buffer.alloc(Math.min(size, SCRIPT_TEXT_MAX * 4));
    const head = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0));
    if (head.includes(0)) return { path, bytes: size, unread: "It does not read as text, so it is not shown: it is approved by its bytes all the same." };
    const whole = head.length >= size;
    const said = head.toString("utf8");
    // A character the read ended inside is no character of the file's.
    const text = whole || !said.endsWith(NO_CHARACTER) ? said : said.slice(0, -1);
    return { path, text: text.slice(0, SCRIPT_TEXT_MAX), cut: !whole || text.length > SCRIPT_TEXT_MAX, bytes: size };
  } catch (/** @type {any} */ e) {
    return { path, unread: e?.code === "ENOENT" ? GONE : `It could not be read: ${String(e?.code || e?.message || e).slice(0, 120)}` };
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * A run of a watcher's program: the program, when it started, the last of what it said on stderr with its secrets
 * hidden, what hides them, whether it is over — ended, or stopped by Filament —, its timer (a long-running one's
 * minute up, a run at an interval's time), its lines' reader and the events of the chunk being read.
 * @typedef {{ program: Program | null, startedAt: number, err: string, hide: ReturnType<typeof hider>, over: boolean, timer: unknown,
 *   reader: ReturnType<typeof createLineReader> | null, batch: import("../../core/watchers.js").WatchEvent[] }} Run
 */
/**
 * A watcher whose program Filament keeps: its project, id and title; `sig`, what it was started as — its cursor's
 * start, its approval and its trigger —, so one switched on again is started anew; its run under way, none between
 * two; `timer`, its next start; `tries`, the starts in a row that did not stay up, by which the next waits; `ends`,
 * the ends in a row each inside a minute; `minute`, the minute its events are counted in — when it began, how many it
 * made and how many lines came past them —, and `flush`, the timer that says those at its end; `stamp`, the lines with
 * no id of one moment, so the same words twice in it are two events; `hearing`, its events' way to the store, in order;
 * `said`, whether the log has its start; `gone`, kept no more.
 * @typedef {{ project: string, id: string, title: string, sig: string, run: Run | null, timer: unknown, tries: number, ends: number,
 *   minute: { from: number, n: number, more: number } | null, flush: unknown, stamp: { at: number, seen: Map<string, number> },
 *   hearing: Promise<void>, said: boolean, gone: boolean }} Kept
 */

/**
 * @param {{ store: { get: (project: string) => { routines: Routine[] }, routinesAll: () => { project: string, r: Routine }[], pausedSince: () => number | null, archived?: (project: string) => boolean,
 *     watchTrouble: (project: string, id: string, why: string | null) => boolean, watchPaused: (project: string, id: string, why: string) => boolean,
 *     watchUnapproved: (project: string, id: string, why: string) => boolean },
 *   heard: (project: string, id: string, events: readonly unknown[]) => Promise<unknown> | unknown,
 *   folderOf: (project: string) => string | null,
 *   secretsOf?: (project: string, names: readonly string[]) => Record<string, string>,
 *   start?: (argv: readonly string[], io: ProgramIo) => Program,
 *   hash?: (file: string) => string | null, now?: () => number, timers?: Timers, log?: (level: string, msg: string) => void }} deps
 *   `folderOf`: a project's folder, where its program runs; `secretsOf`: the values of the app secrets it names, those
 *   kept (`appSecretsOf`); `start`: how a program is started (`startProgram`; the tests' stand-in); `timers`: how it
 *   waits (the tests')
 */
export function createScriptWatch({ store, heard, folderOf, secretsOf = () => ({}), start = startProgram, hash = hashOf, now = Date.now, timers = REAL_TIMERS, log = () => {} }) {
  /** Each watcher whose program is kept up, by its project and id. @type {Map<string, Kept>} */
  const kept = new Map();
  /** Each watcher's kill under way: its next start waits for it. @type {Map<string, Promise<void>>} */
  const dying = new Map();
  /** What is under way — a kill, a hearing, a start that waits —, for the tests and the stop to wait on. @type {Set<Promise<void>>} */
  const work = new Set();
  /** What each watcher's sheet last read as its approval, by its project and id, the newest last (`approvalOf`). @type {Map<string, { seal: string, pins: Record<string, string> }>} */
  const reads = new Map();
  let stopped = false;

  /** @param {string} project @param {string} id */
  const keyOf = (project, id) => `${project}\n${id}`;
  /** A routine's script trigger; null for any other. @param {Routine | undefined} r @returns {ScriptTrigger | null} */
  const triggerOf = (r) => (r?.trigger?.kind === "script" ? r.trigger : null);
  /**
   * Whether a watcher's program runs: a script's, on, not paused, Pause all off, its project not archived (r-itself,
   * 11-12; the store's `archived`). @param {string} project @param {Routine | undefined} r
   */
  const runs = (project, r) => !!r && !!triggerOf(r) && r.state === "on" && !r.paused && !store.pausedSince() && !store.archived?.(project);
  /** What a watcher's Switch on approved, while it stands switched on: null for one proposed, and where nothing records it. @param {Routine} r */
  const approvedOf = (r) => (r.state !== "proposed" && r.script ? r.script.pins : null);
  /** What a watcher is started as: switched on, resumed or put back since, it is another start. @param {Routine} r */
  const sigOf = (r) => `${r.seen?.from ?? ""}\n${r.script?.at ?? ""}\n${JSON.stringify(r.trigger)}`;
  /** @param {unknown} e */
  const why = (e) => String(/** @type {any} */ (e)?.message || e).split(/\r?\n/)[0].slice(0, 200);
  /** @param {Promise<unknown>} p @returns {Promise<void>} */
  const track = (p) => {
    const q = p.then(
      () => {},
      (e) => log("warn", `watchers: a script watcher's work failed (${why(e)})`),
    );
    work.add(q);
    void q.then(() => work.delete(q));
    return q;
  };
  /** A watcher's trouble kept, or taken off (null): what throws is said, never thrown. @param {Kept} e @param {string | null} said */
  const troubled = (e, said) => {
    try {
      store.watchTrouble(e.project, e.id, said);
      if (said) log("warn", `watchers: “${e.title}” of ${e.project}: its program failed: ${said}`);
    } catch (x) {
      log("warn", `watchers: “${e.title}” of ${e.project} could not keep its trouble (${why(x)})`);
    }
  };

  /** Each script watcher that runs has its program up; one that runs no more, or was switched on anew, has its tree stopped. */
  function sync() {
    if (stopped) return;
    /** @type {Map<string, { project: string, r: Routine }>} */
    const on = new Map();
    for (const { project, r } of store.routinesAll()) if (runs(project, r)) on.set(keyOf(project, r.id), { project, r });
    for (const [k, e] of [...kept]) {
      const still = on.get(k);
      if (!still || sigOf(still.r) !== e.sig) drop(k, e);
    }
    for (const [k, { project, r }] of on) {
      if (kept.has(k)) continue;
      /** @type {Kept} */
      const e = { project, id: r.id, title: r.title, sig: sigOf(r), run: null, timer: null, tries: 0, ends: 0, minute: null, flush: null, stamp: { at: 0, seen: new Map() }, hearing: Promise.resolve(), said: false, gone: false };
      kept.set(k, e);
      launch(k, e);
    }
  }

  /** A watcher kept no more: its timers cleared, its run stopped with its tree. @param {string} k @param {Kept} e */
  function drop(k, e) {
    if (kept.get(k) === e) kept.delete(k);
    e.gone = true;
    if (e.timer) timers.clear(e.timer);
    if (e.flush) timers.clear(e.flush);
    e.timer = e.flush = null;
    kill(k, e);
  }

  /**
   * A watcher's run under way stopped by Filament: over at once — what it prints or how it ends is heard no more — and
   * its tree killed, the kill kept until it is carried out. @param {string} k @param {Kept} e
   */
  function kill(k, e) {
    const run = e.run;
    e.run = null;
    if (!run || run.over) return;
    run.over = true;
    if (run.timer) timers.clear(run.timer);
    if (!run.program) return;
    /** @type {Promise<unknown>} */
    let killed;
    try {
      killed = Promise.resolve(run.program.kill());
    } catch (x) {
      killed = Promise.reject(x);
    }
    const before = dying.get(k);
    const done = track(Promise.all([before, killed.catch((x) => log("warn", `watchers: “${e.title}” of ${e.project}: its program's kill failed (${why(x)})`))]));
    dying.set(k, done);
    void done.then(() => {
      if (dying.get(k) === done) dying.delete(k);
    });
  }

  /** A watcher's program started once no kill of it is under way: never two of one watcher. @param {string} k @param {Kept} e */
  function launch(k, e) {
    const wait = dying.get(k);
    if (wait) return void track(wait.then(() => launch(k, e)));
    try {
      launchNow(k, e);
    } catch (x) {
      // What no check foresaw: its trouble, and tried again at the longest wait — never left on and silent.
      if (e.gone || e.run || e.timer) return void log("warn", `watchers: “${e.title}” of ${e.project} could not start its program (${why(x)})`);
      const wait = SCRIPT_RESTART_MS[SCRIPT_RESTART_MS.length - 1];
      troubled(e, `it was not started: ${why(x)}; it is tried again in ${durationWords(wait)}`);
      later(k, e, wait);
    }
  }

  /**
   * One start, checked as every start is: the watcher still runs as it was kept, its project has a folder, the bytes
   * are as the person approved them, and each secret it names has a value. @param {string} k @param {Kept} e
   */
  function launchNow(k, e) {
    if (stopped || e.gone || kept.get(k) !== e || e.run) return;
    const r = store.get(e.project).routines.find((x) => x.id === e.id);
    const t = triggerOf(r);
    if (!r || !t || !runs(e.project, r) || sigOf(r) !== e.sig) return void (drop(k, e), sync());
    const folder = folderOf(e.project);
    if (!folder) return notStarted(k, e, t, "its project has no folder to run in");
    if (!r.script) return unapproved(k, e, "nothing records what you approved for it");
    const changed = scriptChanged(r.script.pins, t.command, folder, { hash });
    if (changed.length) return unapproved(k, e, `its script changed since you switched it on (${pathsWords(changed)})`);
    const names = t.secrets || [];
    const given = names.length ? secretsOf(e.project, names) : {};
    const values = Object.fromEntries(names.filter((n) => typeof given[n] === "string").map((n) => [n, given[n]]));
    const missing = names.filter((n) => !Object.hasOwn(values, n));
    if (missing.length) return notStarted(k, e, t, `this project's apps keep no value for its secret${missing.length > 1 ? "s" : ""} ${listed(missing)}`);
    /** @type {Run} */
    const run = { program: null, startedAt: now(), err: "", hide: hider(values), over: false, timer: null, reader: null, batch: [] };
    run.reader = createLineReader((line) => void took(e, run, t, lineParts(line, run.hide.text)), { max: SCRIPT_LIMITS.line, onOver: (over) => void took(e, run, t, overParts(run, over)) });
    e.run = run;
    try {
      run.program = start([...t.command], {
        cwd: folder,
        env: withEnv(safeEnv(), values),
        out: (chunk) => printed(e, run, t, chunk),
        // Hidden before it is cut to its last characters: a secret astride the cut would leave its start.
        err: (chunk) => void (run.over || (run.err = run.hide.text(run.err + chunk).slice(-SCRIPT_LIMITS.stderr))),
        end: (end) => ended(k, e, run, t, end),
        warn: (what) => log("warn", `watchers: “${e.title}” of ${e.project}: its program's tree was not ended as meant (${what})`),
      });
    } catch (x) {
      return ended(k, e, run, t, { code: null, error: why(x) });
    }
    if (run.over) return;
    run.timer = t.everyMin ? timers.set(() => pastTime(k, e, run, t), SCRIPT_LIMITS.runMs) : timers.set(() => stayedUp(e, run), SCRIPT_UP_MS);
    // Said of each start of one kept running, and of the first run of one at an interval: not of every minute's.
    if (!t.everyMin || !e.said) log("info", `watchers: “${e.title}” of ${e.project} started its program${t.everyMin ? `, which runs every ${t.everyMin} min` : ""}`);
    e.said = true;
  }

  /** A watcher switched off: what would start is not what the person approved. Never started. @param {string} k @param {Kept} e @param {string} said */
  function unapproved(k, e, said) {
    drop(k, e);
    try {
      store.watchUnapproved(e.project, e.id, said);
      log("warn", `watchers: “${e.title}” of ${e.project} was switched off: ${said}`);
    } catch (x) {
      // Still on in its Space, and not kept here: the routines' next arm finds it and checks it again.
      log("warn", `watchers: “${e.title}” of ${e.project} is not started (${said}), and could not be switched off (${why(x)})`);
    }
  }

  /** How long a start that did not stay up waits for the next: by its interval, else by how many came before. @param {Kept} e @param {ScriptTrigger} t */
  const nextWait = (e, t) => {
    const wait = t.everyMin ? t.everyMin * MINUTE_MS : SCRIPT_RESTART_MS[Math.min(e.tries, SCRIPT_RESTART_MS.length - 1)];
    e.tries += 1;
    return wait;
  };
  /** A watcher's next start set. @param {string} k @param {Kept} e @param {number} wait */
  const later = (k, e, wait) => {
    e.timer = timers.set(() => {
      e.timer = null;
      launch(k, e);
    }, Math.max(0, wait));
  };

  /** A start that could not be made: its trouble, and tried again later. @param {string} k @param {Kept} e @param {ScriptTrigger} t @param {string} said */
  function notStarted(k, e, t, said) {
    const wait = nextWait(e, t);
    troubled(e, `it was not started: ${said}; it is tried again in ${durationWords(wait)}`);
    later(k, e, wait);
  }

  /** A long-running program stayed up its minute: its ends are counted from none, and its trouble is over. @param {Kept} e @param {Run} run */
  function stayedUp(e, run) {
    if (run.over || e.run !== run) return;
    run.timer = null;
    e.tries = 0;
    e.ends = 0;
    troubled(e, null);
  }

  /** A run at an interval past its time: stopped with its tree, which is its trouble. @param {string} k @param {Kept} e @param {Run} run @param {ScriptTrigger} t */
  function pastTime(k, e, run, t) {
    if (run.over || e.run !== run) return;
    kill(k, e);
    troubled(e, `it ran longer than ${SCRIPT_LIMITS.runMs / 1000} s and was stopped`);
    later(k, e, run.startedAt + (t.everyMin || 1) * MINUTE_MS - now());
  }

  /**
   * A program ended by itself. One run at an interval: a failing exit is its trouble, an exit that is none ends it,
   * and its next run is its interval after this one began. A long-running one: started again after its wait — its
   * trouble meanwhile —, and paused at its fifth end in a row inside a minute.
   * @param {string} k @param {Kept} e @param {Run} run @param {ScriptTrigger} t @param {ProgramEnd} end
   */
  function ended(k, e, run, t, end) {
    if (run.over) return;
    // Its last words, where it ended with no newline after them.
    run.batch = [];
    const rest = run.reader?.end();
    if (rest) took(e, run, t, lineParts(rest, run.hide.text));
    run.over = true;
    if (run.timer) timers.clear(run.timer);
    if (e.run === run) e.run = null;
    hear(e, run.batch);
    if (e.gone || stopped) return;
    const first = clip(run.err.split(/\r?\n/).find((l) => l.trim()) || "", 160);
    const said = end.error ? `it could not start: ${run.hide.text(end.error)}` : endWords(end, first);
    if (t.everyMin) {
      troubled(e, end.error || end.code !== 0 ? said : null);
      return later(k, e, run.startedAt + t.everyMin * MINUTE_MS - now());
    }
    e.ends = now() - run.startedAt < SCRIPT_UP_MS ? e.ends + 1 : 0;
    if (e.ends >= SCRIPT_ENDS) {
      const paused = `its program ended ${SCRIPT_ENDS} times in a row: ${end.error ? run.hide.text(end.error) : first || (end.code != null ? `exit code ${end.code}` : `ended by ${end.signal || "a signal"}`)}`;
      drop(k, e);
      try {
        store.watchPaused(e.project, e.id, paused);
        log("warn", `watchers: “${e.title}” of ${e.project} is paused: ${paused}`);
      } catch (x) {
        log("warn", `watchers: “${e.title}” of ${e.project} could not be paused (${why(x)})`);
      }
      return;
    }
    const wait = nextWait(e, t);
    troubled(e, `${said}; it starts again in ${durationWords(wait)}`);
    later(k, e, wait);
  }

  /** What a program printed, read by its lines; the events of the chunk go to the store together. @param {Kept} e @param {Run} run @param {ScriptTrigger} t @param {string} chunk */
  function printed(e, run, t, chunk) {
    if (run.over || e.run !== run || !run.reader) return;
    run.batch = [];
    run.reader.push(String(chunk));
    hear(e, run.batch);
    run.batch = [];
  }

  /**
   * A line past the most one is held to, as an event's parts: its first characters and how many were left out. Its
   * secrets are hidden as a stream's piece has them hidden: the end of what is kept, which may begin a value the cut
   * fell inside, is left out too. @param {Run} run @param {import("../../core/lines.js").Over} over
   */
  function overParts(run, over) {
    let head = "";
    run.hide.stream((s) => void (head += s)).push(plain(over.start));
    const words = squash(head) || `a line of ${over.length} characters`;
    return { id: "", words, body: `${head}…[truncated ${over.length - head.length} chars]` };
  }

  /**
   * A line as an event of its run's chunk, where its minute has room: 30 a minute, the lines past them counted and
   * said once at the minute's end. Its key: the line's own id, else its hash and its moment — the same words twice in
   * one moment are two. @param {Kept} e @param {Run} run @param {ScriptTrigger} t @param {{ id: string, words: string, body: string } | null} parts
   */
  function took(e, run, t, parts) {
    if (!parts) return;
    const at = now();
    if (e.minute && at >= e.minute.from + MINUTE_MS) {
      const more = sayMore(e, t);
      if (more) run.batch.push(more);
    }
    if (!e.minute) e.minute = { from: at, n: 0, more: 0 };
    if (e.minute.n >= SCRIPT_LIMITS.perMinute) {
      e.minute.more += 1;
      if (!e.flush)
        e.flush = timers.set(() => {
          e.flush = null;
          const more = sayMore(e, t);
          if (more) hear(e, [more]);
        }, e.minute.from + MINUTE_MS - at);
      return;
    }
    e.minute.n += 1;
    let key = parts.id ? shortHash(parts.id) : "";
    if (!key) {
      if (e.stamp.at !== at) e.stamp = { at, seen: new Map() };
      const h = shortHash(`${parts.words}\n${parts.body}`);
      const n = e.stamp.seen.get(h) || 0;
      e.stamp.seen.set(h, n + 1);
      key = `${h}:${at}${n ? `:${n}` : ""}`;
    }
    // What it said is held to its most here, the rest counted in its last words.
    const body = parts.body.length > SCRIPT_LIMITS.body ? String(truncateMarked(parts.body, SCRIPT_LIMITS.body - MARK_ROOM)) : parts.body;
    run.batch.push(watchEventOf({ kind: "script", at, key, words: parts.words, ...(parts.id ? { ref: parts.id } : {}), ...(body ? { body } : {}) }, t, () => ""));
  }

  /**
   * A minute over: the lines that came past its 30, as one event that counts them, or null where none did; the next
   * line begins a minute of its own. @param {Kept} e @param {ScriptTrigger} t
   */
  function sayMore(e, t) {
    const m = e.minute;
    e.minute = null;
    if (e.flush) timers.clear(e.flush);
    e.flush = null;
    if (!m?.more) return null;
    return watchEventOf({ kind: "script", at: now(), key: `more:${m.from}`, words: `and ${m.more} more ${m.more === 1 ? "line" : "lines"} that minute, not kept: a script watcher takes ${SCRIPT_LIMITS.perMinute} lines a minute` }, t, () => "");
  }

  /** Events handed to the store, after those before them. @param {Kept} e @param {readonly import("../../core/watchers.js").WatchEvent[]} events */
  function hear(e, events) {
    if (!events.length) return;
    const batch = [...events];
    e.hearing = track(
      e.hearing.then(() => heard(e.project, e.id, batch)).catch((x) => log("warn", `watchers: what “${e.title}” of ${e.project} printed was not heard (${why(x)})`)),
    );
  }

  /**
   * What a script watcher's sheet reads as it opens: the `seal` of what a Switch on would pin as the project stands
   * (`sealOf`), and its `files`, each by its path and its size — null where it is no file. For one that is on, the
   * files are those approved, with any that came beside them since: each not as approved says how (`changed`), and
   * `differs` what Filament does about it. Null for a watcher of any other kind.
   * @param {string} project @param {Routine} r
   * @returns {{ seal: string, files: { path: string, bytes: number | null, changed?: string }[], differs?: string } | null}
   */
  function approvalOf(project, r) {
    const t = triggerOf(r);
    if (!t) return null;
    const folder = folderOf(project);
    const pins = scriptPins(t.command, folder, { hash });
    const seal = sealOf(pins);
    // Held for its press, the newest read last: `approve` names what differs from it.
    const k = keyOf(project, r.id);
    reads.delete(k);
    reads.set(k, { seal, pins });
    for (const old of reads.keys()) {
      if (reads.size <= READS_MAX) break;
      reads.delete(old);
    }
    const approved = approvedOf(r);
    const moved = new Set(approved ? scriptChanged(approved, t.command, folder, { hash }) : []);
    const paths = approved ? [...Object.keys(approved), ...[...moved].filter((p) => !Object.hasOwn(approved, p))] : Object.keys(pins);
    const files = paths.map((path) => {
      const bytes = folder ? sizeOf(resolve(folder, path)) : null;
      const how = !approved || !moved.has(path) ? "" : !Object.hasOwn(approved, path) ? "new" : bytes === null ? "gone" : "changed";
      return { path, bytes, ...(how ? { changed: `${how} since you switched it on` } : {}) };
    });
    return { seal, files, ...(moved.size ? { differs: DIFFERS } : {}) };
  }

  /**
   * One of the files a script watcher's sheet lists, for the person to read (`textOf`): by its path as listed, and
   * as it stands on the disk. Null for a path that is none of them — no other file of the project is read through
   * a watcher —, and for a watcher of any other kind.
   * @param {string} project @param {Routine} r @param {string} path
   */
  function fileOf(project, r, path) {
    const t = triggerOf(r);
    const folder = t ? folderOf(project) : null;
    if (!t || !folder || typeof path !== "string") return null;
    const approved = approvedOf(r);
    const listed = approved ? [...Object.keys(approved), ...scriptChanged(approved, t.command, folder, { hash })] : Object.keys(scriptPins(t.command, folder, { hash: there }));
    return listed.includes(path) ? textOf(resolve(folder, path), path) : null;
  }

  return {
    sync,
    /**
     * What a Switch on would pin of a watcher as its project stands: the pins of what its command names; null for a
     * watcher of any other kind, and a routine at times. A press pins them through `approve`, which asks its sheet's
     * seal. @param {string} project @param {Routine} r
     */
    pinsFor(project, r) {
      const t = triggerOf(r);
      return t ? scriptPins(t.command, folderOf(project), { hash }) : null;
    },
    /**
     * A script watcher's sheet, in core's words (`scriptSheet`): its files those approved while it is switched on, else
     * those a Switch on would approve as the project stands; and the secrets it names that no app of its project keeps
     * a value for, by name — what its start would find missing (`launchNow`). Null for any other.
     * @param {string} project @param {Routine} r
     */
    sheetOf(project, r) {
      const t = triggerOf(r);
      if (!t) return null;
      const approved = approvedOf(r);
      const names = t.secrets || [];
      /** @type {Record<string, string>} */
      let given = {};
      let read = true;
      try {
        if (names.length) given = secretsOf(project, names);
      } catch (x) {
        // Not known: nothing is said of them, and its start says what it finds.
        read = false;
        log("warn", `watchers: the secrets “${r.title}” of ${project} names could not be looked for (${why(x)})`);
      }
      return scriptSheet(t, Object.keys(approved || scriptPins(t.command, folderOf(project), { hash: there })), { on: !!approved, unkept: read ? names.filter((n) => typeof given[n] !== "string") : [] });
    },
    approvalOf,
    fileOf,
    /**
     * What a Switch on approves, where the press is of what its sheet showed (the store's `routineOn`, its `pins`):
     * the pins of a script watcher's files as they are at the press, handed on only where their seal is the one the
     * sheet read (`seal`). No seal is refused — nothing is approved unseen —; another's is refused as a change
     * (`moved`), naming the files that differ from what that sheet read where it is the newest read. Null for a
     * watcher of any other kind, whose Switch on approves nothing by content.
     * @param {string} project @param {Routine} r @param {unknown} seal
     */
    approve(project, r, seal) {
      const t = triggerOf(r);
      if (!t) return null;
      if (typeof seal !== "string" || !seal) throw refused(400, `“${r.title}” runs a program as you: it is switched on from its sheet, which shows what the press approves.`);
      const pins = scriptPins(t.command, folderOf(project), { hash });
      if (sealOf(pins) === seal) return pins;
      const read = reads.get(keyOf(project, r.id));
      const differs = read?.seal === seal ? [...new Set([...Object.keys(read.pins), ...Object.keys(pins)])].filter((p) => read.pins[p] !== pins[p]).sort() : [];
      throw Object.assign(refused(409, `what “${r.title}” runs changed since this sheet was drawn${differs.length ? ` (${pathsWords(differs)})` : ""}: read it again`), { moved: true });
    },
    /**
     * The read of a script watcher's sheet, by the watcher's id (the admin API's): what a Switch on would approve
     * (`approvalOf`), or, with `file`, that file's text (`fileOf`). Refused, in words, where there is no such watcher,
     * where it is of another kind, and for a file that is none of those it lists.
     * @param {string} project @param {string} id @param {string | null} [file]
     */
    read(project, id, file = null) {
      /** @type {Routine | undefined} */
      let r;
      try {
        r = store.get(project).routines.find((x) => x.id === id);
      } catch {
        // A Space that does not read has no watcher to show.
      }
      if (!r?.trigger) throw refused(404, `There is no watcher "${String(id).slice(0, 40)}" in this Space.`);
      if (!triggerOf(r)) throw refused(409, `“${r.title}” runs no program of its own: only a watcher of what a program prints has files to approve.`);
      const got = file === null ? approvalOf(project, r) : fileOf(project, r, file);
      if (!got) throw refused(404, `“${r.title}” names no file “${clip(file ?? "", 120)}”: its sheet lists the files it runs.`);
      return got;
    },
    /** The watchers whose program runs, each by its project and id (the tests'). */
    up: () => [...kept].filter(([, e]) => !!e.run && !e.run.over).map(([k]) => k),
    /** Everything under way — a kill, a hearing, a start that waited —, settled (the tests'). */
    async settled() {
      while (work.size) await Promise.all([...work]);
    },
    /** Every program stopped with its tree and every timer cleared (the server's stop); settled once the kills are carried out. */
    async stop() {
      stopped = true;
      for (const [k, e] of [...kept]) drop(k, e);
      while (work.size) await Promise.all([...work]);
    },
  };
}

/** @typedef {ReturnType<typeof createScriptWatch>} ScriptWatch */
