// @ts-check
// Working-tree snapshots on hidden refs (plan WP-J.2). After a round in which the agent loop's hands wrote, the whole
// repository the folder belongs to is captured as a commit object under `refs/filament/snapshots/<name>`: a temporary
// index (never the repository's own), `write-tree`, `commit-tree` with HEAD as the parent, `update-ref`. No branch
// moves, no checkout, the index and the working tree are untouched, `git status` sees nothing new. A fork can then
// check that commit out as a detached worktree beside the repository, so the files rewind with the conversation.
// A folder with no git, or no git on the machine, is answered in words — never thrown. The temporary index starts as
// a copy of the repository's own where that is plain (HarnessV4_Worktrees_Plan W2), so git re-reads only the files
// whose size or time moved: seconds, not minutes, on a big repository.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { lstat, mkdtemp, readdir, readFile, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join, resolve, basename, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { withoutOwnSwitch } from "../tools/own-programs.js";
import { execFileOffThread } from "./spawn-pool.js";
import { presentOf, skippedPaths, WHOLE_INDEX } from "./sparse.js";

export const SNAPSHOT_REF_PREFIX = "refs/filament/snapshots/";
const GIT_TIMEOUT_MS = 60_000;
// Commits need an author; the developer's git config may not have one, and a snapshot is Filament's, not theirs.
const IDENTITY = Object.freeze({
  GIT_AUTHOR_NAME: "Filament",
  GIT_AUTHOR_EMAIL: "filament@localhost",
  GIT_COMMITTER_NAME: "Filament",
  GIT_COMMITTER_EMAIL: "filament@localhost",
});
// Whatever launched Filament (an editor task, a hook, a wrapper) may have exported these; inherited, they would
// point every command below at a repository other than the folder's own — the snapshot would land in a stranger's
// object store while `rev-parse --show-toplevel` still named the right folder. The folder decides, nothing else.
const REDIRECTS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"];
export function baseEnv() {
  // Without the switch Filament set for itself (tools/own-programs.js): git and what it starts get the person's own.
  const env = withoutOwnSwitch({ ...process.env });
  for (const k of REDIRECTS) delete env[k];
  return { ...env, ...IDENTITY };
}

/** @typedef {Record<string, string | undefined>} Env */
/**
 * The git Filament starts (`gitProgram`): `file`, as spawn takes it, and what a call's environment becomes for it.
 * @typedef {{ file: string, env: (env: Env) => Env }} GitProgram
 */
/** The git the PATH names, started as it is. @type {GitProgram} */
const PATH_GIT = Object.freeze({ file: "git", env: (/** @type {Env} */ env) => env });
/** How long the git a look that failed fell back on stands before a call looks again (`gitProgram`). */
const LOOK_AGAIN_MS = 10_000;
/**
 * The look for the git to start (`findGit`): what it found, and until when that stands — for good, unless the look
 * failed (its `--exec-path` did not answer), on the monotonic clock; `again`, a look made again under way.
 * @type {{ found: Promise<GitProgram>, until: number, again: boolean } | null}
 */
let look = null;
/**
 * The git `git()` and worktree.js's `gitBytes` start, found once. On Windows the PATH's git is mostly Git for Windows'
 * launcher — `<prefix>\cmd\git.exe`, or `<prefix>\bin\git.exe` —, which starts the real git (`<prefix>\mingw64\bin\
 * git.exe`) as a process of its own: a stop or a timeout ends the launcher, and the real git lives on past its call's
 * answer, holding the files it reads and answering into a call already answered (the measure of 11-03: under load,
 * 43 of 375 stopped calls' gits outlived their answer, up to 73 ms, where none of the real git's did). Where the PATH's
 * git is that launcher — the real git its `--exec-path` names stands beside it —, the real git is started, each call
 * given the environment the launcher gives it (`launcherEnv`). Any other git, or one that does not say where it is, is
 * started as the PATH names it — for good where it answered, for `LOOK_AGAIN_MS` where its look failed. The first look
 * is waited for, once; a look made again after one failed is waited for by no call (the review of 11-03: a look that
 * hangs, up to git's 60 s, held every git call of Filament's, most of which cannot be stopped): calls go on with the
 * PATH's git meanwhile, and what the look finds stands from when it answers.
 * @returns {Promise<GitProgram>}
 */
export function gitProgram() {
  if (process.platform !== "win32") return Promise.resolve(PATH_GIT);
  if (!look) {
    const at = { found: Promise.resolve(PATH_GIT), until: Infinity, again: false };
    at.found = findGit().then(
      (r) => {
        if (!r.sure) at.until = performance.now() + LOOK_AGAIN_MS;
        return r.program;
      },
      () => {
        at.until = performance.now() + LOOK_AGAIN_MS;
        return PATH_GIT;
      },
    );
    look = at;
  } else if (!look.again && performance.now() > look.until) {
    const at = look;
    at.again = true;
    void findGit()
      .catch(() => ({ program: PATH_GIT, sure: false }))
      .then((r) => {
        at.again = false;
        if (!r.sure) at.until = performance.now() + LOOK_AGAIN_MS;
        else {
          at.found = Promise.resolve(r.program);
          at.until = Infinity;
        }
      });
  }
  return look.found;
}
/**
 * The git `gitProgram` finds, or null where `signal` stops the wait first: a call stopped while git is still being
 * looked for is answered at once, not once the look is over.
 * @param {AbortSignal | null} signal @returns {Promise<GitProgram | null>}
 */
export function gitProgramUnless(signal) {
  if (signal?.aborted) return Promise.resolve(null);
  const found = gitProgram();
  if (!signal) return found;
  return new Promise((done) => {
    const stopped = () => done(null);
    signal.addEventListener("abort", stopped, { once: true });
    void found.then((p) => {
      signal.removeEventListener("abort", stopped);
      done(p);
    });
  });
}
/** The key `env` holds `name` under, in any case — Windows' variables have none —, else `name`. @param {Env} env @param {string} name */
const keyIn = (env, name) => Object.keys(env).find((k) => k.toUpperCase() === name) ?? name;
/**
 * `name`'s one key in `env`, as Windows has one variable of a name in any case: of its spellings the last given stands
 * — the call's own over the base's —, the others go. Two would reach the process as Node picks, the first in sorting
 * order, whatever was set on the other.
 * @param {Env} env @param {string} name
 */
const oneKey = (env, name) => {
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === name);
  if (keys.length < 2) return keys[0] ?? name;
  const last = /** @type {string} */ (keys.at(-1));
  const value = env[last];
  for (const k of keys) delete env[k];
  env[last] = value;
  return last;
};
/** @param {string} p */
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
/** @param {string} p */
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
/** Two paths name one file: their links resolved, in any case. @param {string} a @param {string} b */
const sameFile = (a, b) => {
  const real = (/** @type {string} */ p) => {
    try {
      return realpathSync.native(p).toLowerCase();
    } catch {
      return resolve(p).toLowerCase();
    }
  };
  return real(a) === real(b);
};
/** The file spawn starts for `git` from `env`'s PATH: in each of its folders, `git.com`, then `git.exe`. @param {Env} env */
function pathGit(env) {
  for (const entry of String(env[keyIn(env, "PATH")] || "").split(";")) {
    const dir = entry.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    for (const name of ["git.com", "git.exe"]) if (isFile(join(dir, name))) return join(dir, name);
  }
  return null;
}
/**
 * The PATH's git, or the real git beside it where it is Git for Windows' launcher (`gitProgram`); `sure` false where
 * the launcher's `--exec-path` did not answer, and the look is to be made again.
 * @returns {Promise<{ program: GitProgram, sure: boolean }>}
 */
async function findGit() {
  const env = baseEnv();
  const onPath = pathGit(env);
  const asIs = { program: PATH_GIT, sure: true };
  if (!onPath) return asIs;
  const r = await execFileOffThread(onPath, ["--exec-path"], { env, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true });
  if (r.failure) return { program: PATH_GIT, sure: false };
  // `<prefix>/<mingw64>/libexec/git-core`, the real git in `<prefix>\<mingw64>\bin`.
  const core = resolve(r.stdout.trim());
  if (basename(core).toLowerCase() !== "git-core" || basename(dirname(core)).toLowerCase() !== "libexec") return asIs;
  const mingw = dirname(dirname(core));
  const prefix = dirname(mingw);
  const real = join(mingw, "bin", "git.exe");
  if (!isFile(real) || ![join(prefix, "cmd", "git.exe"), join(prefix, "bin", "git.exe")].some((l) => sameFile(l, onPath))) return asIs;
  const place = { prefix, mingw, msystem: basename(mingw).toUpperCase() };
  return { program: { file: real, env: (e) => launcherEnv(e, place) }, sure: true };
}
/**
 * The environment Git for Windows' launcher gives the real git, from the one it is given — the same, variable by
 * variable, as the launcher's (11-03): MSYSTEM its own (`MINGW64`); MSYS led by `disable_pcon`; PLINK_PROTOCOL `ssh`
 * and HOME where unset, HOME the folder HOMEDRIVE and HOMEPATH name where it is there, else USERPROFILE; and first on
 * the PATH its folders — `<mingw64>\bin`, `<prefix>\usr\bin` (sh, and the tools hooks, aliases and filters call) — and
 * the home's `bin`. The real git, its MSYSTEM set, leaves the PATH as it is given. Each variable it reads or sets has
 * one key, in any spelling given (`oneKey`).
 * @param {Env} env @param {{ prefix: string, mingw: string, msystem: string }} place
 * @returns {Env}
 */
function launcherEnv(env, { prefix, mingw, msystem }) {
  const out = { ...env };
  out[oneKey(out, "MSYSTEM")] = msystem;
  const msys = oneKey(out, "MSYS");
  out[msys] = out[msys] ? `disable_pcon ${out[msys]}` : "disable_pcon";
  const plink = oneKey(out, "PLINK_PROTOCOL");
  if (!out[plink]) out[plink] = "ssh";
  const home = oneKey(out, "HOME");
  if (!out[home]) {
    const path = out[oneKey(out, "HOMEPATH")];
    const at = `${out[oneKey(out, "HOMEDRIVE")] || ""}${path || ""}`;
    out[home] = path && isDir(at) ? at : out[oneKey(out, "USERPROFILE")];
  }
  const path = oneKey(out, "PATH");
  const first = [join(mingw, "bin"), join(prefix, "usr", "bin"), ...(out[home] ? [`${String(out[home]).replace(/[\\/]+$/, "")}\\bin`] : [])];
  out[path] = [...first, out[path] || ""].join(";");
  return out;
}
/**
 * The line of what git said that says why it failed, for a note, 200 characters of it: its multi-line hints are for a
 * terminal, not a record. The first line that is neither a warning nor a hint of git's nor its progress (`PROGRESS`),
 * else the first: git says its warnings before the error that stopped it — on Windows one for each file whose line ends
 * it would change (`warning: in the working copy of 'a.txt', LF will be replaced by CRLF…`) —, and a worktree's add says
 * what it prepares, and the first line alone would give a note those words in the error's place. The first such line,
 * not the first `fatal:`: what a program git ran said of
 * itself (a filter that is not there, ssh that reached nobody) comes before git's own last word, and says more. The
 * one reader of a failure's words for every file of this folder; an error's message of anything else is one line, or
 * said by its first, as it reads.
 * @param {string | null | undefined} s
 */
export const firstLine = (s) => {
  const lines = String(s || "").split(/\r?\n/);
  return (lines.find((l) => l.trim() && !/^(warning|hint): /.test(l) && !PROGRESS.test(l)) ?? lines[0]).slice(0, 200);
};
/** Git's words on what it is doing, which it says on its error stream before any failure: a worktree's add, a checkout's. */
const PROGRESS = /^(Preparing worktree \(|Updating files: |HEAD is now at )/;
/** The command an invocation runs, for its words: the first argument past any `-c name=value`. @param {string[]} args */
const commandOf = (args) => {
  let i = 0;
  while (args[i] === "-c") i += 2;
  return args[i] ?? "";
};

/**
 * @typedef {object} SnapshotResult
 * @property {boolean} ok  false when no snapshot could be taken (the reason is `error`)
 * @property {boolean} changed  true when a new commit was written; false when the tree equals the previous snapshot's (or HEAD's)
 * @property {string | null} ref  the hidden ref the commit was written to (none for `keep: false`)
 * @property {string | null} commit
 * @property {string | null} tree
 * @property {string | null} repo  the repository's top-level folder
 * @property {string | null} error  in words
 * @property {boolean} [timedOut]  git ran past its time: another try would wait as long
 * @property {string | null} [parent]  what the tree was compared with: `previous` where the repository has it, else
 *   HEAD (null in a repository with no commit yet)
 * @property {string | null} [at]  the commit that holds the tree as it stands: the new one, or `parent` it equals
 * @property {string} [index]  `keepIndex`'s: the temporary index the tree was written from, kept
 * @property {{ path: string, kind: "link" | "repository" }[]} [left]  the folders the tree was taken without, where git's
 *   add of the work tree failed on them (`stoppersOf`), each by its path from the top
 */

/**
 * What every git call of Filament's sets first: the repository's fsmonitor off. A configured one is a program (or, set
 * to `true`, a daemon) that each command reading the index starts, and Filament reads repositories an agent may have
 * set up — a sibling worktree, another repository it wrote in (HarnessV4_Git_Plan GWC-54). A temporary index can't use
 * what it reports anyway. The repository's filters stay: they are how it stores its files (LFS). And no bare repository
 * is found by where git runs (`safe.bareRepository=explicit`, git 2.38 on; an older git ignores the key): a bare one is
 * a few files an agent can write without touching a `.git` (agent/tools.js `intoGit`), and its config — a filter, its
 * own core.worktree — would run in the snapshot's add. A repository's own `.git` folder and a worktree's are found as
 * they are; Filament names no bare repository to git.
 */
export const OWN_CONFIG = Object.freeze(["-c", "core.fsmonitor=false", "-c", "safe.bareRepository=explicit"]);

/**
 * Why a git could not start (ENOENT): the folder it was to work in is gone, else no git is on PATH — a process asked
 * to start in a folder that does not exist fails as a missing program does.
 * @param {string} cwd
 */
export const notStarted = (cwd) => (existsSync(cwd) ? "git is not installed or not on PATH" : `the folder git was asked to work in does not exist (${cwd})`);

/**
 * `execFile` on this thread, its answer as `execFileOffThread` gives one: how it ended and what the process said.
 * @param {string} file @param {string[]} args @param {import("node:child_process").ExecFileOptions} options
 * @param {{ signal: AbortSignal | null, input: string | import("node:stream").Readable | null }} how
 * @returns {Promise<import("./spawn-pool.js").Ran>}
 */
function execFileHere(file, args, options, { signal, input }) {
  return new Promise((done) => {
    const child = execFile(file, args, { ...options, ...(signal ? { signal } : {}) }, (e, stdout, stderr) => {
      if (input && typeof input !== "string") input.destroy();
      done({
        failure: e ? { code: /** @type {any} */ (e).code, killed: !!(/** @type {any} */ (e).killed), message: String(e.message || e) } : null,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
      });
    });
    if (input != null) {
      // A git that ends before it read all of it says why through its exit; the pipe's own error is that same end.
      child.stdin?.on("error", () => {});
      if (typeof input === "string") child.stdin?.end(input);
      else if (child.stdin) {
        // A stream that fails to read ends git's input there: git says what it lacked.
        input.on("error", () => child.stdin?.end());
        input.pipe(child.stdin);
      }
    }
  });
}

/**
 * One git invocation, of the git `gitProgram` finds. Its process starts off the server's thread (`execFileOffThread`),
 * so a burst of git runs never holds every request while their processes start — unless its time runs past git()'s
 * own (`timeoutMs` above 60 s: a checkout, a clone, a fetch), when it starts on this thread with pipes, where every
 * other process Filament starts does. On Windows a process started on one thread while another thread starts one
 * inherits that one's output pipes and holds them open for its whole life: a command's or an agent's output started in
 * that moment ends only once the git does — in a moment for most, seconds for an `add -A` or a `status` of a large tree
 * or a filter that reaches the network, minutes for a checkout or a clone, which is why those start here. Nonzero exits
 * resolve; only a missing binary or folder to work in (`notStarted`), a timeout, an abort, an answer past what one call
 * keeps (8 MB) or a pool thread that could not run it (it stopped; the files git's output goes to could not be made)
 * ends up in `error` — a timeout also `timedOut`; the cut answer also `cut`, `out` what git said up to there.
 * `input`: what git reads on its standard input — a batch of questions in one call; or a stream, read as git takes it
 * (a pack, gigabytes), which starts git on this thread.
 * @param {string[]} args
 * @param {{ cwd: string, env?: Record<string, string>, timeoutMs?: number, signal?: AbortSignal | null, input?: string | import("node:stream").Readable | null }} opts
 * @returns {Promise<{ code: number, out: string, err: string, error: string | null, cut?: boolean, timedOut?: boolean }>}
 */
export async function git(args, { cwd, env = {}, timeoutMs = GIT_TIMEOUT_MS, signal = null, input = null }) {
  const argv = [...OWN_CONFIG, ...args];
  const program = await gitProgramUnless(signal);
  if (!program) {
    if (input && typeof input !== "string") input.destroy();
    return { code: -1, out: "", err: "", error: `git ${commandOf(args)} was abandoned (the request ended)` };
  }
  const options = { cwd, env: program.env({ ...baseEnv(), ...env }), timeout: Math.max(1000, timeoutMs), maxBuffer: 8 * 1024 * 1024, windowsHide: true };
  const { failure: e, stdout, stderr } =
    timeoutMs > GIT_TIMEOUT_MS || (input && typeof input !== "string")
      ? await execFileHere(program.file, argv, options, { signal, input })
      : await execFileOffThread(program.file, argv, options, { signal, input: /** @type {string | null} */ (input) });
  const out = stdout.trim();
  const err = stderr.trim();
  if (e && typeof e.code !== "number") {
    const { code } = e;
    // Past `maxBuffer` git is stopped and what it said is kept: an answer cut there, never a timeout.
    const cut = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    const abandoned = code === "ABORT_ERR" || !!signal?.aborted;
    const timedOut = code !== "ENOENT" && !abandoned && !cut && e.killed;
    return {
      code: -1,
      out,
      err,
      error:
        code === "ENOENT"
          ? notStarted(cwd)
          : abandoned
            ? `git ${commandOf(args)} was abandoned (the request ended)`
            : timedOut
              ? `git ${commandOf(args)} timed out`
              : e.message,
      ...(cut ? { cut } : {}),
      ...(timedOut ? { timedOut } : {}),
    };
  }
  return { code: e ? Number(e.code) : 0, out, err, error: null };
}

/**
 * A ref name from a free one: git forbids a few characters (`@{`, `..`, `~^:?*[`, control characters, spaces) and
 * a few shapes (a component starting with `.`, ending with `.lock`, an empty component).
 * @param {string} name
 */
export function refNameOf(name) {
  const s = String(name || "")
    .replace(/[^A-Za-z0-9._\/-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .split("/")
    .map((c) => c.replace(/^[.-]+|[.]+$/g, "").replace(/\.lock$/i, "-lock"))
    .filter(Boolean)
    .join("/")
    .replace(/[./-]+$/, "");
  return s || "snapshot";
}

/**
 * Whether `git add --sparse` failed for a git too old to know the flag: git's usage exit (129), whatever language its
 * words are in — the English words too, for a wrapper that changes the code.
 * @param {{ code: number, err: string }} r
 */
export const noSparse = (r) => r.code === 129 || (r.code !== 0 && /unknown option|usage: git add/i.test(r.err));

/**
 * Whether a `.git` stands in a folder or in one above it: a repository, whether git will read it or not — one another
 * account owns ("dubious ownership"), a worktree whose records are gone. Asked where git answers none, so that git's
 * refusal is never taken for no repository, in any language git speaks. A folder inside a `.git` folder is in none.
 * @param {string} folder
 */
export function gitAbove(folder) {
  for (let dir = resolve(folder); ; ) {
    if (basename(dir).toLowerCase() === ".git") return false;
    if (existsSync(join(dir, ".git"))) return true;
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/** Git's own words where it refuses the repository a folder is in. @param {{ code: number, out: string, err: string }} r */
export const refusedWords = (r) => `git refuses the repository this folder is in: ${firstLine(r.err || r.out) || `it exited ${r.code}`}`;

/**
 * Where a folder stands, in one git run: its repository's top folder, the commit HEAD is at (null before the first),
 * and — `index` — where the repository keeps its own index. git prints each asked path as it reads its option, then
 * HEAD's commit; before the first commit `--verify -q` leaves HEAD's line out and exits 1. A repository a snapshot
 * reads runs this once, not once for each of them: every git process is a spawn, and a writing round takes two
 * snapshots per place.
 * @param {string} folder @param {{ index?: boolean }} [o]
 * @returns {Promise<{ repo: string | null, head: string | null, index: string | null, error: string, timedOut?: boolean }>}
 */
async function locate(folder, { index = false } = {}) {
  const cwd = resolve(folder);
  /** @param {string} error @param {boolean} [timedOut] */
  const none = (error, timedOut = false) => ({ repo: null, head: null, index: null, error, ...(timedOut ? { timedOut } : {}) });
  if (!existsSync(cwd)) return none(`the folder does not exist (${cwd})`);
  const r = await git(["rev-parse", "--show-toplevel", ...(index ? ["--git-path", "index"] : []), "--verify", "-q", "HEAD"], { cwd });
  if (r.error) return none(r.error, r.timedOut);
  const lines = r.out ? r.out.split(/\r?\n/) : [];
  const paths = index ? 2 : 1;
  const read = r.code === 0 ? lines.length === paths + 1 : r.code === 1 && lines.length === paths;
  if (!read || !lines[0]) return none(gitAbove(cwd) ? refusedWords(r) : "not a git repository (no snapshot without one)");
  // `--git-path` answers relative to where git ran.
  return { repo: lines[0], head: r.code === 0 ? lines[paths] || null : null, index: index && lines[1] ? resolve(cwd, lines[1]) : null, error: "" };
}

/**
 * The repository a folder belongs to (`repo` null with the reason in `error` when there is none, or git refuses it).
 * @param {string} folder
 * @returns {Promise<{ repo: string | null, head: string | null, error: string }>}
 */
export async function repoOf(folder) {
  const { repo, head, error } = await locate(folder);
  return { repo, head, error };
}

/**
 * The nearest folder of a path that exists: the path itself where it is one; null where none does.
 * @param {string} path  absolute
 * @returns {string | null}
 */
export function folderOf(path) {
  let dir = resolve(path);
  while (!existsSync(dir) || !statSync(dir).isDirectory()) {
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return dir;
}

/**
 * The place a file is in (HarnessV4_Git_Plan GW-D3): the top folder of the repository or worktree that holds it, as
 * git spells it — found from its nearest folder that exists, since a write may make the file and its folders. `place`
 * null with `outside` where no repository holds it (a file inside a `.git` folder is in none: no snapshot covers it);
 * `error` alone where git could not tell (none on the machine).
 * @param {string} path  absolute
 * @returns {Promise<{ place: string | null, outside: boolean, error: string }>}
 */
export async function placeOf(path) {
  const dir = folderOf(path);
  if (!dir) return { place: null, outside: true, error: "no folder of it exists" };
  const top = await git(["rev-parse", "--show-toplevel"], { cwd: dir });
  if (top.error) return { place: null, outside: false, error: top.error };
  if (top.code === 0 && top.out) return { place: top.out, outside: false, error: "" };
  return gitAbove(dir) ? { place: null, outside: false, error: refusedWords(top) } : { place: null, outside: true, error: "not in a git repository" };
}

/**
 * Whether an index is one a snapshot may start from (HarnessV4_Worktrees_Plan W2), read from its bytes: "DIRC",
 * version 2 to 4, no entry assume-unchanged or skip-worktree (a sparse checkout) — `add -A` passes over those, so the
 * file as it stands would be missed — and no extension git must understand (a lowercase signature: a split index's
 * `link`, a sparse index's `sdir`), up to its checksum. `idBytes`: the size of the repository's ids, 20 (SHA-1) or 32
 * (SHA-256). `skipWorktree`: skip-worktree entries are taken, for a caller that puts those whose file is on disk right
 * (`snapshotTree`).
 * @param {Buffer} b @param {{ skipWorktree?: boolean, idBytes?: number }} [o]
 */
export function plainIndex(b, { skipWorktree = false, idBytes = 20 } = {}) {
  if (b.length < 12 + idBytes || b.toString("latin1", 0, 4) !== "DIRC") return false;
  const version = b.readUInt32BE(4);
  if (version < 2 || version > 4) return false;
  const count = b.readUInt32BE(8);
  const end = b.length - idBytes;
  let at = 12;
  for (let i = 0; i < count; i++) {
    if (at + 42 + idBytes > end) return false;
    const flags = b.readUInt16BE(at + 40 + idBytes);
    if (flags & 0x8000) return false;
    let p = at + 42 + idBytes;
    if (flags & 0x4000) {
      if (version < 3 || p + 2 > end || (!skipWorktree && b.readUInt16BE(p) & 0x4000)) return false;
      p += 2;
    }
    if (version === 4) {
      // How much of the last path it keeps, as a varint, then the rest of its own, NUL-ended; no padding.
      while (p < end && b[p] & 0x80) p++;
      p++;
    }
    const nul = b.indexOf(0, p);
    if (nul < 0 || nul >= end) return false;
    // Versions 2 and 3 pad an entry with one to eight NULs to a multiple of eight bytes, from its start.
    at = version === 4 ? nul + 1 : at + ((nul - at + 8) & ~7);
  }
  while (at + 8 <= end) {
    const sig = b.toString("latin1", at, at + 4);
    if (sig[0] < "A" || sig[0] > "Z") return false;
    at += 8 + b.readUInt32BE(at + 4);
  }
  return at === end;
}

/**
 * An index's assume-unchanged bits cleared, in place — each such entry then compared with its file as any other —, its
 * checksum written again where it has one (`index.skipHash` writes none). How many it cleared.
 * @param {Buffer} b  an index of version 2 to 4 @param {number} idBytes  the size of the repository's ids
 */
function unassume(b, idBytes) {
  const version = b.readUInt32BE(4);
  const count = b.readUInt32BE(8);
  const end = b.length - idBytes;
  let cleared = 0;
  let at = 12;
  for (let i = 0; i < count && at + 42 + idBytes <= end; i++) {
    const o = at + 40 + idBytes;
    const flags = b.readUInt16BE(o);
    if (flags & 0x8000) {
      b.writeUInt16BE(flags & 0x7fff, o);
      cleared++;
    }
    let p = o + 2 + (flags & 0x4000 ? 2 : 0);
    if (version === 4) {
      while (p < end && b[p] & 0x80) p++;
      p++;
    }
    const nul = b.indexOf(0, p);
    if (nul < 0 || nul >= end) break;
    at = version === 4 ? nul + 1 : at + ((nul - at + 8) & ~7);
  }
  if (cleared && b.subarray(end).some((x) => x !== 0)) createHash(idBytes === 32 ? "sha256" : "sha1").update(b.subarray(0, end)).digest().copy(b, end);
  return cleared;
}

/**
 * The repository's own index, copied as a snapshot's temporary one (HarnessV4_Worktrees_Plan W2): git then compares
 * each file's size and time with what it knew and re-reads only what moved, where an index read from HEAD re-reads
 * every file. Its own index is a linked worktree's for an agent's copy. One that is not plain (`plainIndex`) — a
 * sparse index, a split one, entries assumed unchanged — git rewrites whole in the copy first (`WHOLE_INDEX`), and the
 * assume-unchanged bits go from it: a file the developer told git not to look at is read as it stands, as an index
 * read from HEAD reads it. The copy keeps its time: git's racy check compares each entry's time with its index's, so a
 * file saved in the same second is read again. The copy is read and written without blocking: a big repository's
 * index is megabytes, and every other agent and request waits on a synchronous one. Its skip-worktree entries — a
 * sparse checkout's outside, not on disk — are taken as they are (the plan of 11-09 for big repos): an index read from
 * HEAD would hold every one of them and `add -A` would take each for deleted. What it gives back is their paths, none
 * where it has none; false where there is no index to start from, and the snapshot starts from an index read from
 * HEAD — never where the index holds a sparse checkout's outside: then why, in words.
 * @param {(args: string[], env?: Record<string, string>) => Promise<{ code: number, out: string, err: string, error: string | null, timedOut?: boolean }>} run
 *   git in the repository, its own index unless `env` names another
 * @param {{ head: string | null, index: string | null }} at  where the repository stands (`locate`)
 * @param {string} to  the temporary index
 * @returns {Promise<false | string[] | { error: string, timedOut?: boolean }>}
 */
async function seedIndex(run, { head, index }, to) {
  // A commit's name is as long as its repository's ids: 40 hex digits are SHA-1's, 64 SHA-256's. Before the first
  // commit there is none to tell, and the configuration says.
  let idBytes = 20;
  if (head) idBytes = head.length / 2;
  else {
    const fmt = await run(["config", "--get", "extensions.objectformat"]);
    const name = fmt.code === 0 ? fmt.out.toLowerCase() : "";
    idBytes = !name || name === "sha1" ? 20 : name === "sha256" ? 32 : 0;
  }
  if ((idBytes !== 20 && idBytes !== 32) || !index) return false;
  /** @type {Buffer} */
  let b;
  /** @type {import("node:fs").Stats} */
  let st;
  try {
    st = await stat(index);
    b = await readFile(index);
    await writeFile(to, b);
  } catch (/** @type {any} */ e) {
    // No index yet holds nothing a sparse checkout leaves off its disk; one that could not be read may.
    return e?.code === "ENOENT" ? false : { error: `the folder's index could not be read (${firstLine(e?.message)})` };
  }
  if (!plainIndex(b, { skipWorktree: true, idBytes })) {
    const w = await run([...WHOLE_INDEX], { GIT_INDEX_FILE: to });
    if (w.code !== 0) return { error: `git could not read the folder's index: ${firstLine(w.timedOut ? w.error : w.err || w.out || w.error)}`, ...(w.timedOut ? { timedOut: true } : {}) };
    try {
      b = await readFile(to);
      if (unassume(b, idBytes)) await writeFile(to, b);
    } catch (/** @type {any} */ e) {
      return { error: `the snapshot's index could not be read back (${firstLine(e?.message)})` };
    }
    if (!plainIndex(b, { skipWorktree: true, idBytes })) {
      // Still not plain — an extension a later git must understand —: from HEAD where nothing lies outside a sparse
      // checkout, never where something does.
      const skipped = skippedPaths(b, { idBytes });
      if (skipped && !skipped.length) {
        await rm(to, { force: true }).catch(() => {});
        return false;
      }
      return { error: "the folder's index is in a form Filament cannot read, and holds files a sparse checkout leaves off its disk: a snapshot from HEAD would take each of them for deleted" };
    }
  }
  try {
    await utimes(to, st.atime, st.mtime);
  } catch (/** @type {any} */ e) {
    return { error: `the snapshot's index could not keep the folder's index's time (${firstLine(e?.message)})` };
  }
  return skippedPaths(b, { idBytes }) || [];
}

/**
 * The folders git's add of a work tree fails whole on, looked for once it failed (`snapshotTree`) among those git
 * tracks nothing of: a link to a folder it lies in — a junction, which Git for Windows walks as a folder, round and
 * round until a path is too long for it or its time is up — and a repository of its own with no commit yet, of which
 * git has no commit to take. Git names such a folder itself where it lies beside files it tracks; in a folder all new,
 * which git names alone, they are looked for on the disk, with no word of .gitignore: one git would pass over is found
 * too, and left out of an add that would not take it. No link is followed and no repository entered. A link is a
 * junction on Windows alone — elsewhere git takes a link for a link —, and any link there to a folder it lies in is
 * taken for one: a symbolic link among them, which git would keep as a link, is left out as well.
 * @param {string} repo  the work tree's top @param {Record<string, string>} env  the index the add writes
 * @param {(args: string[], env?: Record<string, string>) => ReturnType<typeof git>} run @param {AbortSignal | null} signal
 * @returns {Promise<{ path: string, kind: "link" | "repository" }[]>}  each by its path from the top, in their order
 */
async function stoppersOf(repo, env, run, signal) {
  const ls = await run(["ls-files", "--others", "--exclude-standard", "--directory", "-z"], env);
  if (ls.code !== 0) return [];
  /** @type {{ path: string, kind: "link" | "repository" }[]} */
  const found = [];
  const fold = (/** @type {string} */ p) => (process.platform === "win32" ? p.toLowerCase() : p);
  /** Whether the link `at`, in the folder whose real path is `home`, leads to that folder or to one it lies in. */
  const round = async (/** @type {string} */ at, /** @type {string} */ home) => {
    const to = await realpath(at).catch(() => null);
    return to != null && fold(`${home}${sep}`).startsWith(fold(to.endsWith(sep) ? to : `${to}${sep}`));
  };
  /** @param {string} path  a folder git tracks nothing of, from the top @param {string} home  the real path of the folder it is in */
  const look = async (path, home) => {
    if (signal?.aborted) return;
    const at = join(repo, path);
    const st = await lstat(at).catch(() => null);
    if (st?.isSymbolicLink()) {
      if (process.platform === "win32" && (await round(at, home))) found.push({ path, kind: "link" });
      return;
    }
    if (!st?.isDirectory()) return;
    if (existsSync(join(at, ".git"))) {
      // Its own top (nothing to go up by), and no commit HEAD names: a `.git` that is no repository is the project's.
      const head = await git(["rev-parse", "--show-cdup", "--verify", "-q", "HEAD"], { cwd: at, signal });
      if (head.code === 1 && !head.out) found.push({ path, kind: "repository" });
      return;
    }
    const here = await realpath(at).catch(() => null);
    if (here == null) return;
    for (const d of await readdir(at, { withFileTypes: true }).catch(() => [])) if (d.isDirectory() || d.isSymbolicLink()) await look(`${path}/${d.name}`, here);
  };
  for (const row of ls.out.split("\0")) {
    if (!row.endsWith("/")) continue;
    const path = row.slice(0, -1);
    const home = await realpath(dirname(join(repo, path))).catch(() => null);
    if (home != null) await look(path, home);
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Snapshot the working tree of the repository `folder` belongs to onto `refs/filament/snapshots/<name>`.
 * `previous` (a commit) is what the tree is compared with and the new commit's parent; a `previous` this
 * repository does not have (the session moved to another repository, a pruned object) is dropped and HEAD stands
 * in. Without one the comparison is HEAD, so a tree identical to HEAD (nothing written after all) is
 * `changed: false` and no commit is made. `timeoutMs` bounds each git call (60 s at most); `signal` abandons them.
 * `ref` names the whole ref instead (a sub-agent's work lives under its own prefix, out of the snapshots' list).
 * `keep: false` writes the commit with no ref at all (`ref` null): a turn's starting point, kept by the snapshots that
 * follow it, and pruned by git with nothing else when none does. `keepIndex`: the temporary index stays where it was
 * written, named in `index` — its folder the caller's to remove —: a clone's index (cow.js), each file's stat as git read it.
 * A folder git's add fails whole on (`stoppersOf`) is left out of the tree, and named in `left`.
 * @param {string} folder
 * @param {{ name: string, previous?: string | null, message?: string, timeoutMs?: number, signal?: AbortSignal | null, ref?: string | null, keep?: boolean, keepIndex?: boolean }} opts
 * @returns {Promise<SnapshotResult>}
 */
export async function snapshotTree(folder, { name, previous = null, message = "", timeoutMs = GIT_TIMEOUT_MS, signal = null, ref: fullRef = null, keep = true, keepIndex = false }) {
  /** @param {string} error @param {boolean} [timedOut] @returns {SnapshotResult} */
  const none = (error, timedOut = false) => ({ ok: false, changed: false, ref: null, commit: null, tree: null, repo: null, error, ...(timedOut ? { timedOut } : {}) });
  const found = await locate(folder, { index: true });
  if (!found.repo) return none(found.error, found.timedOut);
  const { repo, head } = found;
  const run = (/** @type {string[]} */ args, env = {}) => git(args, { cwd: repo, env, timeoutMs: Math.min(timeoutMs, GIT_TIMEOUT_MS), signal });
  const tmp = await mkdtemp(join(tmpdir(), "filament-snap-"));
  const env = { GIT_INDEX_FILE: join(tmp, "index") };
  let indexKept = false;
  /** The folders the add left out so that it could be made at all (`stoppersOf`). @type {{ path: string, kind: "link" | "repository" }[]} */
  let left = [];
  /** The kept index (`keepIndex`) and what was left out, named on an answer that holds the tree. */
  const kept = () => ({ ...(keepIndex ? ((indexKept = true), { index: env.GIT_INDEX_FILE }) : {}), ...(left.length ? { left } : {}) });
  try {
    const seeded = await seedIndex(run, found, env.GIT_INDEX_FILE);
    if (seeded && !Array.isArray(seeded)) return none(seeded.error, seeded.timedOut);
    // Every git that writes the temporary index writes it whole: never a split index, whose shared part would land in
    // the repository's git folder.
    const unsplit = ["-c", "core.splitIndex=false"];
    if (!seeded && head) {
      const rt = await run([...unsplit, "read-tree", head], env);
      if (rt.code !== 0) return none(`git read-tree failed: ${rt.timedOut ? rt.error : rt.err || rt.out || rt.error}`, rt.timedOut);
    }
    // A sparse checkout's file outside its cone that a command wrote all the same is a changed file, taken as the
    // others are; the rest stay as its index has them. Its own index is never touched: only the temporary one.
    const present = seeded ? await presentOf(repo, seeded) : [];
    if (present.length) {
      const ui = await git([...unsplit, "update-index", "--no-skip-worktree", "-z", "--stdin"], { cwd: repo, env, timeoutMs: Math.min(timeoutMs, GIT_TIMEOUT_MS), signal, input: `${present.join("\0")}\0` });
      if (ui.code !== 0) return none(`git update-index failed: ${firstLine(ui.timedOut ? ui.error : ui.err || ui.out || ui.error)}`, ui.timedOut);
    }
    // Tracked and untracked files alike, .gitignore respected: what the developer would see in `git status`.
    // `--sparse` lets a sparse checkout snapshot what the hands wrote outside its cone (a no-op elsewhere); a git
    // too old to know the flag gets the plain form.
    const plain = [...unsplit, "add", "-A"];
    /** The add, of everything but the folders `less` names, each by its name. @param {string[]} [less] */
    const adds = async (less = []) => {
      const what = less.length ? ["--pathspec-from-file=-", "--pathspec-file-nul"] : ["--", "."];
      const o = { cwd: repo, env, timeoutMs: Math.min(timeoutMs, GIT_TIMEOUT_MS), signal, ...(less.length ? { input: [".", ...less.map((p) => `:(exclude,literal)${p}`)].map((p) => `${p}\0`).join("") } : {}) };
      const r = await git([...plain, "--sparse", ...what], o);
      return noSparse(r) ? git([...plain, ...what], o) : r;
    };
    let add = await adds();
    // A folder git's add fails whole on — a junction to a folder it lies in, a repository with no commit — is left out,
    // and said (`left`): looked for only once the add failed, so a snapshot of any other folder asks git nothing more.
    // The add stopped at its time's end may have left its lock beside the index.
    if (add.code !== 0 && !signal?.aborted) {
      left = await stoppersOf(repo, env, run, signal);
      if (left.length) {
        await rm(`${env.GIT_INDEX_FILE}.lock`, { force: true }).catch(() => {});
        add = await adds(left.map((l) => l.path));
      }
    }
    if (add.code !== 0) return none(`git add failed: ${firstLine(add.timedOut ? add.error : add.err || add.out || add.error)}`, add.timedOut);
    const wt = await run([...unsplit, "write-tree"], env);
    if (wt.code !== 0 || !wt.out) return none(`git write-tree failed: ${firstLine(wt.timedOut ? wt.error : wt.err || wt.out || wt.error)}`, wt.timedOut);
    const tree = wt.out;
    let parent = head;
    /** The tree `parent` holds, where it was read. @type {string | null} */
    let parentTree = null;
    if (previous) {
      // The previous commit and its tree in one run; `--` makes both revisions, never a file of that name. Either
      // missing fails it whole, and HEAD stands in.
      const pv = await run(["rev-parse", `${previous}^{commit}`, `${previous}^{tree}`, "--"]);
      const [c, t] = pv.code === 0 ? pv.out.split(/\r?\n/) : [];
      if (c && t) {
        parent = c;
        parentTree = t;
      }
    }
    if (parent && !parentTree) {
      const bt = await run(["rev-parse", "--verify", "-q", `${parent}^{tree}`]);
      if (bt.code === 0 && bt.out) parentTree = bt.out;
    }
    if (parent && parentTree === tree) return { ok: true, changed: false, ref: null, commit: null, tree, repo, error: null, parent, at: parent, ...kept() };
    const ct = await run(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message || `Filament snapshot ${name}`]);
    if (ct.code !== 0 || !ct.out) return none(`git commit-tree failed: ${firstLine(ct.timedOut ? ct.error : ct.err || ct.out || ct.error)}`, ct.timedOut);
    if (!keep) return { ok: true, changed: true, ref: null, commit: ct.out, tree, repo, error: null, parent, at: ct.out, ...kept() };
    const ref = fullRef || SNAPSHOT_REF_PREFIX + refNameOf(name);
    const ur = await run(["update-ref", ref, ct.out]);
    if (ur.code !== 0) return none(`git update-ref failed: ${firstLine(ur.timedOut ? ur.error : ur.err || ur.out || ur.error)}`, ur.timedOut);
    return { ok: true, changed: true, ref, commit: ct.out, tree, repo, error: null, parent, at: ct.out, ...kept() };
  } finally {
    if (!indexKept) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Does the repository still have this snapshot? (A `git gc` never prunes a reachable ref; a developer may delete one.)
 * @param {string} folder @param {string} ref
 */
export async function snapshotExists(folder, ref) {
  const found = await repoOf(folder);
  if (!found.repo) return false;
  const r = await git(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { cwd: found.repo });
  return r.code === 0 && !!r.out;
}

/**
 * The snapshots of a repository, newest commit first: `{ ref, name, commit }` rows.
 * @param {string} folder
 */
export async function listSnapshots(folder) {
  const found = await repoOf(folder);
  if (!found.repo) return [];
  const r = await git(["for-each-ref", "--sort=-committerdate", "--format=%(refname) %(objectname)", SNAPSHOT_REF_PREFIX], { cwd: found.repo });
  if (r.code !== 0 || !r.out) return [];
  return r.out
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((p) => p.length === 2 && p[0].startsWith(SNAPSHOT_REF_PREFIX))
    .map(([ref, commit]) => ({ ref, name: ref.slice(SNAPSHOT_REF_PREFIX.length), commit }));
}

/**
 * One git invocation with the repository's hooks off: `core.hooksPath` names an empty folder made for this command
 * alone, under the system's temp folder, and removed once it ends. A copy Filament checks out is not the developer's
 * checkout, and nothing the repository wires to run on one — an install, a notification — starts for it. The folder is
 * a fresh one because Git LFS's filter writes LFS's own hooks into whatever folder the hooks are pointed at, making it
 * if it is not there: they come and go with it, and nothing is left beside the copy.
 * @param {string[]} args @param {Parameters<typeof git>[1]} opts
 */
export async function gitWithoutHooks(args, opts) {
  const hooks = await mkdtemp(join(tmpdir(), "filament-no-hooks-"));
  try {
    return await git(["-c", `core.hooksPath=${hooks}`, ...args], opts);
  } finally {
    await rm(hooks, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Check a snapshot out as a detached worktree: `dest` when given, else a sibling folder of the repository named
 * `<repo>-fork-<suffix>`. Refused in words when the destination exists, the ref is gone, or there is no git. The
 * checkout runs with the repository's hooks off (`gitWithoutHooks`): the fork's folder is Filament's copy. Its filters
 * run, so LFS content checks out. A fork folder the developer deleted by hand leaves a stale registration behind; that
 * one is dropped first so the same name works again (`dropStaleRecordOf`) — never a blanket `git worktree prune`,
 * which takes every record whose folder is missing, the developer's own worktrees on a drive not mounted among them
 * (the owner's of 11-09).
 * @param {string} folder @param {{ ref: string, dest?: string | null, suffix?: string }} opts
 * @returns {Promise<{ ok: true, path: string, repo: string, commit: string } | { ok: false, error: string }>}
 */
export async function addWorktree(folder, { ref, dest = null, suffix = "" }) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error };
  const { repo } = found;
  const rv = await git(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { cwd: repo });
  if (rv.code !== 0 || !rv.out) return { ok: false, error: `the snapshot ${ref} is not in this repository (deleted, or the folder is another repository)` };
  const path = dest ? resolve(dest) : join(dirname(repo), `${basename(repo)}-fork-${refNameOf(suffix || rv.out.slice(0, 8)).replace(/\//g, "-")}`);
  if (existsSync(path)) return { ok: false, error: `the worktree folder exists already (${path})` };
  await dropStaleRecordOf(repo, path);
  const wt = await gitWithoutHooks(["worktree", "add", "--detach", path, rv.out], { cwd: repo, timeoutMs: 5 * 60_000 });
  if (wt.code !== 0) return { ok: false, error: `git worktree add failed: ${firstLine(wt.err || wt.out || wt.error)}` };
  return { ok: true, path, repo, commit: rv.out };
}

/**
 * git's record of a worktree at `path` whose folder is gone goes — that one record alone, as `git worktree prune` would
 * take it, and only where git keeps no lock on it (a worktree on a drive not mounted, locked by its owner, stays).
 * Nothing else of the repository's records is read for more than its name. A record's `gitdir` is read against the
 * record's own folder: git writes it relative where `worktree.useRelativePaths` is on.
 * @param {string} repo @param {string} path
 */
async function dropStaleRecordOf(repo, path) {
  if (existsSync(path)) return;
  const r = await git(["rev-parse", "--git-common-dir"], { cwd: repo });
  if (r.code !== 0 || !r.out) return;
  const records = join(resolve(repo, r.out.split(/\r?\n/)[0]), "worktrees");
  const want = resolve(path, ".git");
  const same = (/** @type {string} */ a) => (process.platform === "win32" ? a.toLowerCase() === want.toLowerCase() : a === want);
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(records);
  } catch {
    return;
  }
  for (const n of names) {
    const record = join(records, n);
    try {
      if (!same(resolve(record, readFileSync(join(record, "gitdir"), "utf8").trim())) || existsSync(join(record, "locked"))) continue;
      await rm(record, { recursive: true, force: true });
    } catch {}
  }
}
