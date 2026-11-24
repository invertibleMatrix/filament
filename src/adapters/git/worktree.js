// @ts-check
// A writing sub-agent's own git worktree (HarnessV3 §15 item 88). The launch captures the working tree of the
// repository the session's folder belongs to as it stands — tracked and untracked files, uncommitted changes
// included, .gitignore respected — as a commit (the snapshot machinery: a temporary index, never the repository's
// own) and checks that commit out as a detached worktree inside the repository's git folder, where neither
// `git status` nor the hands' searches look. The sub-agent works there. Each exchange's end captures its tree as a
// commit, and the copy stays as a cache of it (HarnessV4_Worktrees_Plan W3): parked for the agent's next question,
// which resets it in place, and taken — moved, reset, cleaned — by a later agent or check once the cap is reached; at
// most `KEPT_COPIES` per repository that nothing uses, the least recently used going first. New copies are checked out
// one at a time in a repository, and how long the newest took is kept there (`lastCheckout`). Applying brings
// base→work into the developer's folder file by file — a three-way merge where both sides changed a file, the index
// and HEAD untouched — and only when every file comes through cleanly. Ignored dependency folders (node_modules, a
// virtualenv) are linked into the worktree so its checks can run. The refs `refs/filament/subagents/<id>/base` (what
// the work is measured against; it moves to the work once applied) and `…/work` (the newest capture) keep all of it
// reachable, so the work can be applied after a restart too; work marked as applied is held under `…/marked-base` and
// `…/marked-work` while the mark can be undone. After a team lead's apply, Filament checks the folder in a
// worktree of a snapshot of it, and an apply that broke the check is undone — the same apply, the folder after it back
// to the folder before — its work waiting again (HarnessV3-TaskGraph-v2 TG2-D55). A command task's lanes are such
// worktrees too, each going back to its snapshot between two items (V2-3). No git, no repository: answered in words,
// never thrown.
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { lstat, readFile, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildCaches, cowSupport, makeClone } from "./cow.js";
import { OWN_CONFIG, baseEnv, firstLine, git, gitProgramUnless, repoOf, snapshotTree } from "./snapshot.js";
import { SPARSE_CONFIG, bigRepo, checkoutSparse, coneOf, coneTooWide, narrowest, readCone, repoPath, typesIn, widenCone, writeCone } from "./sparse.js";
import { execFileOffThread } from "./spawn-pool.js";
import { keepOrphanPatches, letGoPatch } from "./patch.js";

export const TASK_REF_PREFIX = "refs/filament/subagents/";
/** The worktrees' home inside the repository's (common) git folder: the places list leaves them out (GWC-42). */
export const TASK_HOME = "filament-worktrees";
/**
 * Where a repository's home of copies keeps the records of its builders' patch workspaces (patch.js, the owner's plan of
 * 11-09 for big repos): a patch's folder stands where its worktree would, with no git record, so a copy's reconcile,
 * trim, taking or Clean up must never read it as a checkout a crash cut — which goes whole, its work with it.
 */
export const PATCH_RECORDS = ".patches";
/** Whether a name in a repository's home of copies is a builder's patch workspace. @param {string} home @param {string} name */
export const patchRecorded = (home, name) => existsSync(join(home, PATCH_RECORDS, `${name}.json`));
/** The kinds of copy `takeTaskWorktree` makes: a worktree (sparse and clone come with their own phases). */
export const COPY_KINDS = Object.freeze(/** @type {const} */ (["worktree", "clone", "sparse"]));
/** Ignored folders a check usually needs: linked (a junction on Windows), never copied or captured. */
export const DEPENDENCY_DIRS = Object.freeze(["node_modules", ".venv", "venv"]);
const TIMEOUT_MS = 60_000;
/** How long git may take to check a new copy out: a big repository's takes its time. */
const CHECKOUT_MS = 5 * 60_000;
/**
 * What every checkout and reset of a copy runs with (Phase 0 of the owner's 11-09 plan for big repos): git's parallel
 * checkout, a worker a core up to 8, from git's own threshold of 100 files to write, so a reset that rewrites a few
 * stays sequential. Measured on this repository's copy (2,299 files, 32 cores): 583 ms sequential, 362 ms with a worker
 * a core, 251 ms with 8 — each worker is a process to start. A git older than 2.32, which has neither key, ignores keys
 * it does not know.
 */
const CHECKOUT_WORKERS = Object.freeze(["-c", `checkout.workers=${Math.min(8, availableParallelism())}`, "-c", "checkout.thresholdForParallelism=100"]);
/**
 * A builder's copy is checked out and reset without Git LFS's smudge (Phase 0): the files LFS keeps stay their pointers,
 * a few lines each, where a Unity-style repository's 20 GB of content was downloaded and written into every copy, and
 * the read hand fetches one it opens (`fetchLfsFile`). The lfs driver's smudge and process are emptied for the command
 * alone, never in the repository's configuration, and not required: a git whose configuration names a git-lfs this
 * machine does not have checks out all the same. GIT_LFS_SKIP_SMUDGE for a git-lfs that runs regardless. A patch
 * workspace's copy-ups take them so too (patch.js).
 */
export const SKIP_LFS = Object.freeze(["-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false"]);
/**
 * How a copy holds the files Git LFS keeps: `pointers`, a builder's, its reads fetching one at a time; `whole`, as the
 * developer's folder has them — a check's and a command task's lane's, whose commands read files Filament cannot see.
 * @typedef {"pointers" | "whole"} LfsWay
 */
/**
 * A copy's checkout or reset, as it holds LFS's files: its `-c` and its environment.
 * @param {LfsWay} lfs @returns {{ args: string[], env: Record<string, string> }}
 */
const checkoutFor = (lfs) => (lfs === "pointers" ? { args: [...CHECKOUT_WORKERS, ...SKIP_LFS], env: { GIT_LFS_SKIP_SMUDGE: "1" } } : { args: [...CHECKOUT_WORKERS], env: {} });
/** The first line of a Git LFS pointer (its spec, v1). */
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1\n";
/** Whether a file is a Git LFS pointer: one under 1 KB that starts as one. @param {string} abs */
const isPointerFile = async (abs) => {
  try {
    const st = await lstat(abs);
    return st.isFile() && st.size < 1024 && (await readFile(abs, "latin1")).startsWith(LFS_POINTER);
  } catch {
    return false;
  }
};
/** A diff for a surface is cut here; the work itself is never cut. */
const DIFF_BYTES = 400_000;

/**
 * @typedef {object} TaskWorktree
 * @property {string} repo  the developer's repository (its top-level folder)
 * @property {string} dest  the worktree's top-level folder
 * @property {string} workdir  the session folder's counterpart inside it: where the sub-agent works
 * @property {string} base  the commit its work is measured against
 * @property {string[]} linked  the dependency folders linked in (unlinked before any clean, and before the folder goes)
 * @property {CopyKind} [kind]  how it was made: a checkout, the folder cloned (cow.js), or its cone alone (sparse.js)
 * @property {string[]} [cone]  the folders a sparse one held as it was taken (a widen since adds to them)
 * @property {LfsWay} [lfs]  how it holds the files Git LFS keeps
 * @property {boolean} [pointers]  it holds them as their pointers, and its commit has some: a builder's, of a
 *   repository that keeps files in Git LFS
 */
/**
 * How a copy is made (the plan of 11-09 for big repos): `worktree`, a checkout of every file of its commit; `clone`, the
 * session's folder cloned where the drive clones files (cow.js) — what git ignores in it warm, the builder's —, else a
 * checkout; `sparse`, its cone alone (sparse.js).
 * @typedef {"worktree" | "clone" | "sparse"} CopyKind
 */
/**
 * @typedef {object} ChangedFile
 * @property {string} path  relative to the repository, with forward slashes
 * @property {string} status  A (added), M (modified), D (deleted), T (its type changed)
 * @property {number} added  lines (0 for a binary)
 * @property {number} removed
 * @property {boolean} binary
 * @property {string} srcMode
 * @property {string} dstMode
 * @property {string} srcSha
 * @property {string} dstSha
 */

/**
 * Why no copy was made (HarnessV4_Worktrees_Plan W1): `none` where the folder has none to give — no repository, none
 * with a commit yet, no git on the machine — and a writing sub-agent may work in the session's folder, said; `failed`
 * for every other reason, where it never does.
 * @typedef {{ ok: false, error: string, kind: "none" | "failed" }} NoCopy
 */
/** @param {string} error @returns {NoCopy} */
export const noCopyOf = (error) => ({ ok: false, error, kind: !/^git refuses/.test(error) && /not a git repository|git is not installed|the folder does not exist|has no commit yet/.test(error) ? "none" : "failed" });
/** @param {string} error @returns {NoCopy} */
const copyFailed = (error) => ({ ok: false, error, kind: "failed" });
/** Where a copy would sit outside the folders the agent may work in, said with the folder to add. @param {string} dest */
export const outsideWords = (dest) =>
  `its copy would sit in ${dirname(dest)}, outside the folders the agent may work in (agentLoop.roots): add that folder there (Settings › Agent loop), or launch it read only`;
/** Two paths name one folder (Windows: in any case). @param {string} a @param {string} b */
const samePath = (a, b) => (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
/** Two paths name one folder, links in them resolved (Windows: in any case). @param {string} a @param {string} b */
const sameFolder = (a, b) => samePath(realOr(a), realOr(b));
/** A path with its links resolved, where it exists. @param {string} p */
const realOr = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
};
/**
 * Git's record of a copy, as its `.git` file names it — only one among the repository's records of worktrees, beside
 * the copies' home: a `.git` file that names anything else is never read as one, nor written to or removed. Null where
 * it names none.
 * @param {string} dest
 */
function gitDirOf(dest) {
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(dest, ".git"), "utf8"));
    const record = m ? resolve(dest, m[1]) : null;
    return record && sameFolder(dirname(record), join(dirname(dirname(dest)), "worktrees")) ? record : null;
  } catch {
    return null;
  }
}
/**
 * Git's record of a copy: as its `.git` file names it, else the record whose `gitdir` names the copy — a checkout cut
 * before git wrote that file —, read against the record's folder: git writes it relative where
 * `worktree.useRelativePaths` is on.
 * @param {string} repo @param {string} dest
 */
async function recordOf(repo, dest) {
  const own = gitDirOf(dest);
  if (own) return own;
  const common = await commonDirOf(repo);
  const home = common ? join(common, "worktrees") : "";
  if (!home || !isDir(home)) return null;
  for (const n of readdirSync(home)) {
    try {
      if (samePath(resolve(home, n, readFileSync(join(home, n, "gitdir"), "utf8").trim()), join(dest, ".git"))) return join(home, n);
    } catch {}
  }
  return null;
}
/** Git's record of a copy goes, as `git worktree prune` takes one whose folder is gone. @param {string | null} record */
const dropRecord = (record) => {
  if (record) rmSync(record, { recursive: true, force: true });
};
/**
 * A copy git did not finish making — a stop, or a crash, cut its checkout — goes whole: its folder (its dependency
 * links are made only after the checkout) and git's record of it, whose `locked` mark git leaves while it makes one
 * would keep a prune from taking it.
 * @param {string} repo @param {string} dest
 */
export async function forgetTaskWorktree(repo, dest) {
  const record = await recordOf(repo, dest);
  try {
    await rm(dest, { recursive: true, force: true });
  } catch {}
  if (!existsSync(dest)) dropRecord(record);
}
/** @param {string} p */
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
/**
 * `isDir` off the event loop: a folder of a project on a share that no longer answers holds a stat for as long as the
 * network waits, and the sync form holds every request with it (the owner's of 11-09, its review). @param {string} p
 */
const isDirNow = (p) => stat(p).then((s) => s.isDirectory(), () => false);

/** What a git call with no input reads: its standard input ended at once. */
const NO_INPUT = new Uint8Array(0);
/**
 * One git call whose output is bytes (a blob, a merged file, a NUL-separated listing), with optional input — and
 * `env` over the clean one (a temporary index). Its git is the one `gitProgram` finds — on Windows the real git, not
 * Git for Windows' launcher, so a stop ends git itself —, its process started on a thread of the spawn pool
 * (`spawn-pool.js`), not the server's; its standard input is ended either way, empty where there is none. `signal`: its
 * stop, which ends the git (an error, as git's own failing); the answer comes once its process is gone.
 * @param {string[]} args @param {{ cwd: string, input?: Buffer | null, env?: Record<string, string>, signal?: AbortSignal | null }} o
 * @returns {Promise<{ code: number, out: Buffer, err: string }>}
 */
export async function gitBytes(args, { cwd, input = null, env = {}, signal = null }) {
  const program = await gitProgramUnless(signal);
  // Stopped while git was being looked for: answered as a git its stop ended is.
  if (!program) return { code: -1, out: Buffer.alloc(0), err: "" };
  const { failure: e, stdout, stderr } = await execFileOffThread(
    program.file,
    [...OWN_CONFIG, ...args],
    { cwd, env: program.env({ ...baseEnv(), ...env }), encoding: /** @type {const} */ ("buffer"), maxBuffer: 256 * 1024 * 1024, windowsHide: true, timeout: TIMEOUT_MS },
    { input: input ?? NO_INPUT, signal },
  );
  return { code: e ? (typeof e.code === "number" ? e.code : -1) : 0, out: stdout, err: stderr.toString("utf8") };
}

/** The repository's git folder shared by its worktrees. @param {string} repo */
export async function commonDirOf(repo) {
  const r = await git(["rev-parse", "--git-common-dir"], { cwd: repo });
  return r.code === 0 && r.out ? resolve(repo, r.out) : null;
}

/** Where sub-agent `id`'s worktree lives for this repository, or null without git. @param {string} repo @param {string} id */
export async function taskWorktreePath(repo, id) {
  const common = await commonDirOf(repo);
  return common ? join(common, TASK_HOME, id) : null;
}


/**
 * A new detached checkout of `commit` at `dest`, hooks off, as the fsmonitor is in every call of Filament's
 * (`OWN_CONFIG`): a scratch copy of Filament's, not the developer's checkout, for which nothing the repository
 * configures to run starts. One at a time in a repository's home (Phase 5): the next waits for the one before it to end,
 * and each checkout's own time, the wait left out, is kept there (`lastCheckout`). A record of git's left naming `dest`
 * goes first. `signal` stops the wait, or git; a copy it stopped goes (`forgetTaskWorktree`). `ms`: how long git took.
 * `cone`: a sparse copy that holds it alone (`checkoutSparse`), its time not kept — it says nothing of a whole one's —,
 * and gone where it was not made whole. `lfs`: how it holds the files Git LFS keeps (`checkoutFor`).
 * @param {string} repo @param {string} dest @param {string} commit @param {AbortSignal | null} [signal]
 * @param {readonly string[] | null} [cone] @param {LfsWay} [lfs]
 * @returns {Promise<{ ok: true, ms: number } | { ok: false, error: string }>}
 */
async function checkout(repo, dest, commit, signal = null, cone = null, lfs = "whole") {
  if (signal?.aborted) return { ok: false, error: STOPPED_MAKING };
  if (existsSync(dest)) return { ok: false, error: "a folder stands where its copy goes" };
  const home = dirname(dest);
  const key = keyOf(home);
  const before = checkingOut.get(key) || Promise.resolve();
  /** @type {() => void} */
  let done = () => {};
  /** @type {Promise<void>} */
  const mine = new Promise((r) => (done = () => r()));
  const turn = before.then(() => mine);
  checkingOut.set(key, turn);
  // The entry goes once every checkout before it and this one are over: one stopped while it waits ends its own part,
  // and the next taker still waits for the checkout under way.
  void turn.then(() => {
    if (checkingOut.get(key) === turn) checkingOut.delete(key);
  });
  try {
    await untilStopped(before, signal);
    if (signal?.aborted) return { ok: false, error: STOPPED_MAKING };
    dropRecord(await recordOf(repo, dest));
    const quiet = ["-c", `core.hooksPath=${join(home, ".no-hooks")}`];
    mkdirSync(home, { recursive: true });
    const began = now();
    const how = checkoutFor(lfs);
    if (cone) {
      const made = await checkoutSparse(repo, dest, commit, cone, { config: [...quiet, ...how.args], signal });
      const ms = now() - began;
      if (signal?.aborted || !made.ok) await forgetTaskWorktree(repo, dest);
      if (signal?.aborted) return { ok: false, error: STOPPED_MAKING };
      return made.ok ? { ok: true, ms } : made;
    }
    const wt = await git([...quiet, ...how.args, "worktree", "add", "--detach", dest, commit], {
      cwd: repo,
      env: how.env,
      timeoutMs: CHECKOUT_MS,
      signal,
    });
    const ms = now() - began;
    if (signal?.aborted) {
      await forgetTaskWorktree(repo, dest);
      return { ok: false, error: STOPPED_MAKING };
    }
    if (wt.code !== 0) return { ok: false, error: `git worktree add failed: ${firstLine(wt.err || wt.out || wt.error)}` };
    keepCheckout(home, ms);
    return { ok: true, ms };
  } finally {
    done();
  }
}
/** A copy whose making a stop cut. */
const STOPPED_MAKING = "it was stopped while its copy was made";
/** The checkouts of each repository's home, as the newest one's turn: the next one waits for it. @type {Map<string, Promise<void>>} */
const checkingOut = new Map();
/** Where a repository's home keeps how long its newest checkout took: a name its copies' list leaves out. */
const CHECKOUT_FILE = ".checkout.json";
/** Keep how long a checkout in `home` took, and when. @param {string} home @param {number} ms */
const keepCheckout = (home, ms) => {
  try {
    writeFileSync(join(home, CHECKOUT_FILE), JSON.stringify({ ms, at: now() }));
  } catch {
    // Not kept, the card that offers a side run says nothing of it: the checkout itself stands.
  }
};

/**
 * How long the newest copy of a repository took to check out, and when (Phase 5): the side-by-side card says so where
 * it was slow. Null where no copy was checked out there, or git cannot name the repository's git folder.
 * @param {string} repo  the repository's top-level folder
 * @returns {Promise<{ ms: number, at: number } | null>}
 */
export async function lastCheckout(repo) {
  const common = await commonDirOf(repo);
  if (!common) return null;
  try {
    const j = JSON.parse(readFileSync(join(common, TASK_HOME, CHECKOUT_FILE), "utf8"));
    return Number.isFinite(j?.ms) && j.ms >= 0 && Number(j?.at) > 0 ? { ms: Number(j.ms), at: Number(j.at) } : null;
  } catch {
    return null;
  }
}

/**
 * The ignored dependency folders of the repository's top and of the session's folder, linked into the worktree at
 * the same places — so `npm test` or a virtualenv's tools run there. Only folders git ignores: a tracked one is in
 * the checkout already. A link already there — a parked copy's, at its agent's next question — is kept, and named.
 * Where the repository is a linked worktree (`git worktree add`) with no such folder of its own at a place, its main
 * checkout's at the same place is linked, where git ignores it there (the owner's of 11-10: a worktree with no
 * node_modules of its own linked nothing, silently, and every check that needed one failed in its copies).
 * @param {string} repo @param {string} folder @param {string} dest
 */
async function linkDependencies(repo, folder, dest) {
  /** @type {string[]} */
  const linked = [];
  /** The main checkout, read at the first place the repository has no folder of its own. @type {string | null | undefined} */
  let main;
  for (const b of [...new Set([resolve(repo), resolve(folder)])]) {
    const rel = relative(repo, b);
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    for (const name of DEPENDENCY_DIRS) {
      const at = [rel, name].filter(Boolean).join("/").replace(/\\/g, "/");
      let src = join(b, name);
      let top = repo;
      if (!isDir(src)) {
        if (main === undefined) main = await mainCheckoutOf(repo);
        if (!main || !isDir(join(main, rel, name))) continue;
        src = join(main, rel, name);
        top = main;
      }
      const link = join(dest, rel, name);
      if (isLink(link)) {
        linked.push(link);
        continue;
      }
      if (existsSync(link)) continue;
      const ignored = await git(["check-ignore", "-q", "--", at], { cwd: top });
      if (ignored.code !== 0) continue;
      try {
        mkdirSync(dirname(link), { recursive: true });
        symlinkSync(src, link, process.platform === "win32" ? "junction" : "dir");
        linked.push(link);
      } catch {
        // A folder that cannot be linked (a filesystem without links): the checks that need it say so themselves.
      }
    }
  }
  return linked;
}
/**
 * The main checkout of a repository that is a linked worktree of it: the first of git's list of its worktrees, unless
 * that one is bare or the repository itself. Null otherwise, or where git cannot list them. Git is asked only where
 * the repository's `.git` is a file, as a linked worktree's is: a main checkout's is its git folder.
 * @param {string} repo
 */
async function mainCheckoutOf(repo) {
  try {
    if (!lstatSync(join(repo, ".git")).isFile()) return null;
  } catch {
    return null;
  }
  const list = await git(["worktree", "list", "--porcelain"], { cwd: repo });
  const first = list.code === 0 ? String(list.out || "").split(/\r?\n\r?\n/)[0] : "";
  const path = /^worktree (.+)$/m.exec(first)?.[1];
  if (!path || /^bare$/m.test(first)) return null;
  const main = resolve(path.trim());
  return keyOf(main) === keyOf(resolve(repo)) ? null : main;
}
/**
 * The places `linkDependencies` links the dependency folders at, from the repository's top with "/": a clone leaves
 * them out, to link them as every copy does.
 * @param {string} repo @param {string} folder
 */
const dependencyPaths = (repo, folder) => {
  /** @type {Set<string>} */
  const out = new Set();
  for (const b of new Set([resolve(repo), resolve(folder)])) {
    const rel = relative(repo, b);
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    for (const name of DEPENDENCY_DIRS) out.add([rel, name].filter(Boolean).join("/").replace(/\\/g, "/"));
  }
  return out;
};
/** A link (a junction on Windows), never what it points to. @param {string} p */
const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
/** The links Filament made in a copy go, never followed. @param {readonly string[]} links */
const unlinkAll = (links) => {
  for (const l of links) {
    try {
      if (isLink(l)) unlinkSync(l);
    } catch {}
  }
};

// ---- kept copies (HarnessV4_Worktrees_Plan W3) ------------------------------------------------------------------------

/** This Filament's name on the copies it holds: another Filament leaves them alone while this one lives (WT-D7). */
let OWNER = randomUUID();
/**
 * The data folder of this process's Filament, on every record of a copy it writes (`setCopiesHome`): a name that
 * outlives the process, unlike `OWNER` — what shows Filament's footprint whose data folder made a copy, and whether
 * that folder is still there (the footprint plan). "" until it is set: such a record names no data folder.
 */
let HOME = "";
/** At most this many copies per repository that nothing uses stay (WT-D4); past it the least recently used go. */
export const KEPT_COPIES = 4;
/**
 * Another Filament lives while its process runs and it said so within this long: two and a half of its beats. Its
 * process is known by number only, and a number goes to the next program after a restart; past this, a copy it held is
 * this Filament's however its number runs (the copies hunt of 10-23: a restart's old number, taken by another program,
 * kept its copies held for five minutes).
 */
const ALIVE_MS = 150_000;
/** How often a Filament that holds copies in a repository says it lives. */
const BEAT_MS = 60_000;
/** A copy parked this recently is not taken for another agent: its coding agent's process may still be leaving it. */
const SETTLE_MS = 60_000;
/**
 * A repository whose new copy took this long to check out has a spare made ahead where a taking leaves none free
 * (HarnessV4_Worktrees_Plan W5): on 100,000 files a checkout took half a minute, a taken copy one second.
 */
const SPARE_AFTER_MS = 5_000;
/** Filament's own record of a copy, in git's record of it. */
const COPY_FILE = "filament.json";
/** Where each Filament that holds copies in a repository says it lives, one file each: its process's id. */
const ALIVE_DIR = ".alive";

/**
 * What Filament keeps of a copy: who holds it; its state — `busy` (an answer or a check runs in it), `parked` (it holds
 * its agent's captured work, for that agent's next question), `free`; the agent or check it was taken for; when it was
 * last used; the links made in it, unlinked before any clean or removal; `home`, the data folder of the Filament that
 * wrote the record (absent on a record written before Filament named it); `unsaved`, on a busy one whose work could not
 * be kept on its agent's refs, why and since when (the owner's of 11-09): it stays busy, so nothing takes, resets or
 * trims it, and Filament's footprint and Still open can say so. `kind`: how it was made (`CopyKind`; none on a record
 * written before, a checkout): a copy is taken only for its own kind. `cone`: the folders a sparse one holds. `lfs`:
 * how it holds the files Git LFS keeps (absent: as the developer's folder has them).
 * @typedef {{ owner: string, state: "busy" | "parked" | "free", agent: string, at: number, links: string[], home?: string, unsaved?: { error: string, at: number }, kind?: CopyKind, cone?: string[], lfs?: LfsWay }} CopyMeta
 */
/** How a copy was made, as its record says. @param {CopyMeta | null | undefined} meta @returns {CopyKind} */
const kindOfCopy = (meta) => (meta?.kind === "clone" ? "clone" : meta?.kind === "sparse" ? "sparse" : "worktree");
/**
 * A data folder as a copy's record names it: resolved, so a relative one names the same folder wherever it is read
 * (the footprint tells its own copies by it); "" for none.
 * @param {string} dataDir
 */
export const copiesHomeOf = (dataDir) => (dataDir ? resolve(dataDir) : "");
/**
 * The data folder this process's Filament runs from, named on every record of a copy it writes from now on (the
 * footprint plan): the composition root's, once, as it starts.
 * @param {string} dataDir
 */
export function setCopiesHome(dataDir) {
  HOME = copiesHomeOf(dataDir);
}
/**
 * Who writes a record of Filament's in a repository's home now: this Filament's name, and its data folder (`HOME`) —
 * what a patch workspace's record says too (patch.js), so another Filament leaves it alone while this one lives.
 */
export const copiesOwner = () => ({ owner: OWNER, ...(HOME ? { home: HOME } : {}) });
/** @param {string | null} record @returns {CopyMeta | null} */
function metaAt(record) {
  if (!record) return null;
  try {
    const m = JSON.parse(readFileSync(join(record, COPY_FILE), "utf8"));
    return m && typeof m.owner === "string" && Array.isArray(m.links) ? m : null;
  } catch {
    return null;
  }
}
/** @param {string} dest */
const metaOf = (dest) => metaAt(gitDirOf(dest));
/** A file's size and time as one word, or null where there is none. @param {string} path */
const stampOf = (path) => {
  try {
    const s = statSync(path);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return null;
  }
};
/**
 * What `copyHeldBy` last read of each copy, by its folder: its `.git` file's stamp and the record it names, the record's
 * `filament.json`'s stamp and what it says. A page polls a chat's agents every few seconds and asks this of each parked
 * copy: each file is read again once its size or its time moved — a rewrite that keeps both is not seen.
 * @type {Map<string, { git: string | null, record: string | null, stamp: string | null, meta: CopyMeta | null }>}
 */
const heldReads = new Map();
/**
 * Whether the copy at `dest` still holds sub-agent `id`'s work — its own, busy or parked — and not another agent's or
 * none (the Hunter's of 10-28: a parked copy is taken for the next agent past the cap, moved, or dropped).
 * @param {string | null | undefined} dest @param {string} id
 */
export const copyHeldBy = (dest, id) => {
  if (!dest) return false;
  try {
    const was = heldReads.get(dest);
    const git = stampOf(join(dest, ".git"));
    const record = was && git !== null && was.git === git ? was.record : gitDirOf(dest);
    const stamp = record ? stampOf(join(record, COPY_FILE)) : null;
    const m = was && stamp !== null && was.record === record && was.stamp === stamp ? was.meta : metaAt(record);
    heldReads.set(dest, { git, record, stamp, meta: m });
    return !!m && m.agent === id && m.state !== "free";
  } catch {
    return false;
  }
};
/**
 * A copy's record, written whole and naming this Filament's data folder (`HOME`): another Filament, or this one after a
 * crash, reads the old record or the new one, never half of one — which it would take for no record, and so for a copy
 * that is not Filament's.
 * @param {string} dest @param {CopyMeta} meta
 */
function writeMeta(dest, meta) {
  const record = gitDirOf(dest);
  if (!record) return false;
  const file = join(record, COPY_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(HOME ? { ...meta, home: HOME } : meta));
    renameSync(tmp, file);
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {}
    return false;
  }
}
/** @param {{ meta: CopyMeta | null }} a @param {{ meta: CopyMeta | null }} b */
const byUse = (a, b) => (a.meta?.at ?? 0) - (b.meta?.at ?? 0);
/** A copy's record with its mark of work not kept dropped: what it held is on its refs now, or nothing of it is. @param {CopyMeta} meta @returns {CopyMeta} */
const saved = (meta) => {
  const { unsaved: _, ...rest } = meta;
  return rest;
};

/**
 * The copies this Filament is busy with — `use`: an answer or a check runs in one; else it is being taken, put right or
 * removed — each with the promise its giving back settles: nothing else of Filament's touches one meanwhile.
 * @type {Map<string, { done: Promise<void>, free: () => void, use: boolean }>}
 */
const claims = new Map();
/** A copy's place as a key: its folder's links resolved (Windows: in any case). @param {string} p */
const keyOf = (p) => {
  const k = join(realOr(dirname(p)), basename(p));
  return process.platform === "win32" ? k.toLowerCase() : k;
};
/** @param {string} dest */
const claimed = (dest) => claims.has(keyOf(dest));
/** @param {string} dest */
const claim = (dest) => {
  /** @type {() => void} */
  let free = () => {};
  /** @type {Promise<void>} */
  const done = new Promise((r) => (free = () => r()));
  claims.set(keyOf(dest), { done, free, use: false });
};
/** @param {string} dest */
const unclaim = (dest) => {
  const c = claims.get(keyOf(dest));
  claims.delete(keyOf(dest));
  c?.free();
};

/** The repositories' homes of copies this Filament works in, each told every minute that it lives. @type {Set<string>} */
const homes = new Set();
/** @type {ReturnType<typeof setInterval> | null} */
let beating = null;
/** A home that is gone is never made again: Filament says it lives only where its copies are. @param {string} home */
const beat = (home) => {
  if (!isDir(home)) {
    homes.delete(home);
    return;
  }
  try {
    mkdirSync(join(home, ALIVE_DIR));
  } catch {}
  try {
    writeFileSync(join(home, ALIVE_DIR, OWNER), String(process.pid));
  } catch {}
};
/** @param {string} home */
export const holdHome = (home) => {
  if (!homes.has(home)) {
    homes.add(home);
    beat(home);
  }
  if (!beating) {
    beating = setInterval(() => {
      for (const h of homes) beat(h);
    }, BEAT_MS);
    beating.unref?.();
  }
};
/**
 * Whether a copy is another Filament's that lives: it said so within `ALIVE_MS`, and its process runs. A restarted
 * Filament is another one, whose old process is gone: its copies are the new one's at once.
 * @param {string} home @param {string | undefined} owner
 */
export const othersLive = (home, owner) => {
  if (!owner || owner === OWNER || !/^[\w-]{8,64}$/.test(owner)) return false;
  try {
    const f = join(home, ALIVE_DIR, owner);
    if (Date.now() - statSync(f).mtimeMs >= ALIVE_MS) return false;
    const pid = Number(readFileSync(f, "utf8"));
    if (!(pid > 0)) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (/** @type {any} */ e) {
      return e?.code === "EPERM";
    }
  } catch {
    return false;
  }
};
/** Whether any Filament but this one lives in a repository's home of copies (`othersLive`). @param {string} home */
const anotherLives = (home) => {
  try {
    return readdirSync(join(home, ALIVE_DIR)).some((n) => othersLive(home, n));
  } catch {
    return false;
  }
};
/**
 * A copy no record of Filament's names that changed this recently may be one another Filament is making still: its git
 * checks it out for up to `CHECKOUT_MS`, and the record is written once that is done and its links are made.
 */
const MAKING_MS = CHECKOUT_MS + 60_000;
/** Whether a copy's folder changed within `MAKING_MS` of `at`. @param {string} dest @param {number} at */
const changedLately = (dest, at) => {
  try {
    return at - statSync(dest).mtimeMs < MAKING_MS;
  } catch {
    return false;
  }
};

/**
 * A copy's folder as a Clean up moves it aside to remove it (`letGoCopy`): out of the copies' names, which start with
 * no dot, so no Filament takes it, puts it right or counts it as a copy.
 */
const ASIDE = /^\.[^\\/]+\.letting-go-[0-9a-z]+$/;
/** @param {string} name */
const asideOf = (name) => `.${name}.letting-go-${Date.now().toString(36)}`;

/**
 * The copies in a repository's home, each with its place, Filament's record of it and whether its checkout was whole.
 * A builder's patch workspace is none (`patchRecorded`): its folder has no git record, and read as a copy it would go
 * as a checkout a crash cut.
 * @param {string} home @returns {{ name: string, dest: string, meta: CopyMeta | null, whole: boolean }[]}
 */
const copiesIn = (home) => {
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(home).filter((n) => !n.startsWith(".") && !patchRecorded(home, n));
  } catch {}
  return names.map((name) => {
    const dest = join(home, name);
    return { name, dest, meta: metaOf(dest), whole: checkedOutWhole(dest) };
  });
};

/**
 * A copy goes: the links Filament made in it unlinked, the folder removed (a link in it is never followed), git's record
 * of it with it. Where a program still stands in the folder it stays, and the answer says so: a later trim or taking
 * deals with it.
 * @param {string} repo @param {string} dest @param {readonly string[]} links
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function dropCopy(repo, dest, links) {
  unlinkAll(links);
  const record = await recordOf(repo, dest);
  try {
    // The promise form: electron's Node, the desktop app's, stops at a read-only file in the sync one (HarnessV3-Native NA1).
    await rm(dest, { recursive: true, force: true });
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `the worktree folder could not be removed (${firstLine(e?.message)})` };
  }
  dropRecord(record);
  return { ok: true };
}

/**
 * A copy put to `commit` where it stands: every tracked file as `commit` has it — git rewrites only those that differ
 * — and what git does not track removed, what it ignores too unless `ignored` keeps it (an agent's own build output, at
 * its next question). The links Filament made go first where what git ignores goes. Hooks off. `sparse`: a sparse
 * copy, its cone as its sparse-checkout file names it now applied (`SPARSE_CONFIG`) — what leaves it leaves its disk.
 * `lfs`: how it is to hold the files Git LFS keeps; `was`, how it held them — a copy a builder held with pointers,
 * taken whole, has them checked out again (`wholeLfs`).
 * @param {string} dest @param {string} commit @param {readonly string[]} links
 * @param {{ ignored?: boolean, signal?: AbortSignal | null, sparse?: boolean, lfs?: LfsWay, was?: LfsWay }} [o]
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function resetCopy(dest, commit, links, { ignored = false, signal = null, sparse = false, lfs = "whole", was = "whole" } = {}) {
  const quiet = ["-c", `core.hooksPath=${join(dirname(dest), ".no-hooks")}`, ...(sparse ? SPARSE_CONFIG : [])];
  if (!ignored) unlinkAll(links);
  const how = checkoutFor(lfs);
  const co = await git([...quiet, ...how.args, "checkout", "--force", "--detach", "--quiet", commit], { cwd: dest, env: how.env, timeoutMs: 5 * 60_000, signal });
  if (co.code !== 0) return { ok: false, error: `git checkout failed: ${firstLine(co.err || co.out || co.error)}` };
  const cl = await git([...quiet, "clean", ignored ? "-fd" : "-fdx", "--quiet"], { cwd: dest, timeoutMs: 5 * 60_000, signal });
  if (cl.code !== 0) return { ok: false, error: `git clean failed: ${firstLine(cl.err || cl.out || cl.error)}` };
  return lfs === "whole" && was === "pointers" ? wholeLfs(dest, quiet, signal) : { ok: true };
}

/**
 * The files Git LFS keeps, as their content again in a copy a builder held with their pointers (Phase 0 of the owner's
 * 11-09 plan for big repos): a check or a lane that takes it reads them as the developer's folder has them. A checkout
 * leaves a pointer git sees unchanged as it is, so each file the lfs filter keeps that is a pointer now goes and is
 * checked out again, smudged as the repository says — git-lfs fetching what it does not hold.
 * @param {string} dest @param {string[]} quiet  its hooks off @param {AbortSignal | null} signal
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function wholeLfs(dest, quiet, signal) {
  const ls = await gitBytes(["ls-files", "-z", "--", ":(attr:filter=lfs)"], { cwd: dest, signal });
  if (ls.code !== 0) return { ok: false, error: `git ls-files failed: ${firstLine(ls.err) || `exit ${ls.code}`}` };
  /** @type {string[]} */
  const pointers = [];
  for (const p of ls.out.toString("utf8").split("\0").filter(Boolean)) if (await isPointerFile(join(dest, p))) pointers.push(p);
  if (!pointers.length) return { ok: true };
  for (const p of pointers) await rm(join(dest, p), { force: true });
  const co = await git([...quiet, ...CHECKOUT_WORKERS, "checkout", "--quiet", "--pathspec-from-file=-", "--pathspec-file-nul"], { cwd: dest, env: { GIT_LITERAL_PATHSPECS: "1" }, timeoutMs: 5 * 60_000, signal, input: pointers.join("\0") });
  if (co.code !== 0) return { ok: false, error: `git checkout of the files Git LFS keeps failed: ${firstLine(co.err || co.out || co.error)}` };
  return { ok: true };
}

/**
 * Past `KEPT_COPIES` copies of this Filament's that nothing uses, the least recently used go: what each held is on its
 * agent's refs (WT-D6). How many went.
 * @param {string} repo @param {string} home @param {ReadonlySet<string>} keep
 */
async function trim(repo, home, keep) {
  const idle = copiesIn(home)
    .filter((c) => !keep.has(c.name) && !claimed(c.dest) && c.meta?.owner === OWNER && c.meta.state !== "busy")
    .sort(byUse);
  const out = idle.slice(0, Math.max(0, idle.length - KEPT_COPIES));
  for (const c of out) claim(c.dest);
  let gone = 0;
  for (const c of out) {
    try {
      if ((await dropCopy(repo, c.dest, c.meta?.links || [])).ok) gone++;
    } finally {
      unclaim(c.dest);
    }
  }
  return gone;
}

/**
 * Git's records of copies in `home` whose folder is gone — removed by hand, or by a crash between two steps — go, as
 * `git worktree prune` would take them: only Filament's, none being made (`locked`) or moved (its old place claimed),
 * none another living Filament holds. The developer's own worktrees' records are never touched. Each `gitdir` read
 * against its record's folder, as `recordOf` reads it.
 * @param {string} home
 */
function dropStaleRecords(home) {
  const records = join(dirname(home), "worktrees");
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(records);
  } catch {
    return;
  }
  for (const n of names) {
    const record = join(records, n);
    let named = "";
    try {
      named = readFileSync(join(record, "gitdir"), "utf8").trim();
    } catch {
      continue;
    }
    const dest = dirname(resolve(record, named));
    if (!sameFolder(dirname(dest), home) || existsSync(dest) || claimed(dest) || existsSync(join(record, "locked"))) continue;
    if (othersLive(home, metaAt(record)?.owner)) continue;
    dropRecord(record);
  }
}

/**
 * A repository's copies, put right: one this Filament does not work in now (`keep`, and its claims) and no other living
 * Filament holds is this one's to keep or let go — but one with no record of Filament's yet that changed within
 * `MAKING_MS`, while another Filament lives here, may be one that Filament is making, and is left to it. One a crash
 * left at work — busy, or with no record of Filament's — has what it holds captured onto its agent's work ref first
 * (`keepOrphanWork`); where that fails a busy one stays busy, this Filament's, marked with why (`unsaved`), so nothing
 * takes, resets or trims it, and the next reconcile tries again (the owner's of 11-09). Then one not checked out whole
 * goes, and one with no record of Filament's — what links it holds is not known; every other one is kept, this
 * Filament's, parked for its agent. Records of copies that are gone go; past the cap the least recently used copies go.
 * How many went.
 * @param {string} repo @param {string} home @param {ReadonlySet<string>} keep
 */
async function reconcile(repo, home, keep) {
  const now = Date.now();
  const others = anotherLives(home);
  const mine = copiesIn(home).filter(
    (c) =>
      !keep.has(c.name) &&
      !claimed(c.dest) &&
      !othersLive(home, c.meta?.owner) &&
      !(c.meta?.owner === OWNER && c.meta.state !== "busy") &&
      !(others && !c.meta && changedLately(c.dest, now)),
  );
  for (const c of mine) claim(c.dest);
  dropStaleRecords(home);
  let gone = 0;
  for (const c of mine) {
    try {
      const kept = !c.meta || c.meta.state === "busy" ? await keepOrphanWork(repo, c.dest, c.name).catch((/** @type {any} */ e) => ({ ok: false, error: String(e?.message || e) })) : { ok: true, error: "" };
      if (c.meta && c.whole && c.meta.state === "busy" && !kept.ok) writeMeta(c.dest, { ...c.meta, owner: OWNER, unsaved: { error: kept.error, at: c.meta.unsaved?.at || now } });
      else if (!c.whole || !c.meta) {
        if ((await dropCopy(repo, c.dest, c.meta?.links || [])).ok) gone++;
      } else writeMeta(c.dest, { ...saved(c.meta), owner: OWNER, state: c.meta.state === "free" ? "free" : "parked", at: c.meta.at || now });
    } finally {
      unclaim(c.dest);
    }
  }
  gone += await trim(repo, home, keep);
  // A patch workspace a crash left at work has what it holds kept on its agent's refs too, and is parked (patch.js).
  await keepOrphanPatches(repo, home, keep).catch(() => {});
  // A gone Filament's word that it lived goes after a day.
  try {
    for (const n of readdirSync(join(home, ALIVE_DIR)))
      if (n !== OWNER && now - statSync(join(home, ALIVE_DIR, n)).mtimeMs > 24 * 3600_000) rmSync(join(home, ALIVE_DIR, n), { force: true });
  } catch {}
  return gone;
}

/**
 * A copy for `id` at `commit` (HarnessV4_Worktrees_Plan W3): its own, where it stands, reset in place — `own`, its
 * agent's next question, keeps what git ignores there, its build output; else a free one, else — the cap reached — the
 * least recently used parked one, moved to its place (`git worktree move`), reset and cleaned of everything git does not
 * track; else a new checkout. Its links made, it is this Filament's and busy until it is given back
 * (`releaseTaskWorktree`). `keep`: the copies the caller works in now, never taken. `kind` "clone": where the drive
 * clones files (`cowSupport`) a new copy is the folder cloned (`makeClone`) — else, or where the clone fails, a checkout
 * —, and one taken from another agent keeps what git ignores, its caches. `kind` "sparse" (the plan of 11-09 for big
 * repos): a copy that holds its cone alone (`coneFor`) — `paths` widen it —, its own keeping what it held; one whose
 * cone is too wide holds every file, as a "worktree" one does. A copy is taken only for its own kind, but for its
 * agent's own (`own`) a checkout and a clone stand for each other; a sparse one is no whole one. Not made, why and of
 * which kind. `lfs`: how it is to hold the files Git LFS keeps — a builder's as their pointers, a check's whole (Phase
 * 0).
 * `head`: the commit it was put at — for `own`, its agent's work's ref read again once the copy is this taking's, where
 * a capture kept on it since `commit` (a reconcile that held the copy meanwhile: the start's sweep, another copy's
 * taking) moved it on: a reset to `commit` would wipe what that capture kept (the owner's of 11-09, its review).
 * @param {string} folder  the session's folder
 * @param {{ id: string, commit: string, base: string, allowed?: (path: string) => boolean, signal?: AbortSignal | null, keep?: ReadonlySet<string>, own?: boolean, kind?: CopyKind, paths?: readonly string[], lfs?: LfsWay }} o
 * @returns {Promise<{ ok: true, wt: TaskWorktree, head: string } | NoCopy>}
 */
export async function takeTaskWorktree(folder, { id, commit: asked, base, allowed = () => true, signal = null, keep = new Set(), own = false, kind = "worktree", paths = [], lfs = "whole" }) {
  let commit = asked;
  if (!COPY_KINDS.includes(kind)) return copyFailed(`no copy of the kind "${kind}" is made here`);
  const found = await repoOf(folder);
  if (!found.repo) return noCopyOf(found.error);
  const repo = found.repo;
  const common = await commonDirOf(repo);
  if (!common) return copyFailed("git could not name the repository's git folder");
  const home = join(common, TASK_HOME);
  const dest = join(home, id);
  if (!allowed(dest)) return copyFailed(outsideWords(dest));
  if (signal?.aborted) return copyFailed(STOPPED_MAKING);
  // Its patch workspace stands at its place (patch.js): its work is moved aside before a copy is taken there, never
  // removed as a checkout a crash cut.
  if (existsSync(dest) && patchRecorded(home, id)) return copyFailed("its patch workspace stands where its copy goes");
  mkdirSync(home, { recursive: true });
  holdHome(home);
  const others = new Set([...keep].filter((k) => k !== id));
  await reconcile(repo, home, others);
  // One taking of a place at a time: another's hold on it — a trim, a reconcile — is waited for, never raced; one in
  // use is not to be had until it is given back.
  for (let held = claims.get(keyOf(dest)); held; held = claims.get(keyOf(dest))) {
    if (held.use) return copyFailed("its copy is in use: an answer or a check runs in it now");
    await held.done;
  }
  claim(dest);
  let taken = false;
  try {
    if (own) {
      const refs = await taskRefs(repo, id).catch(() => null);
      if (refs && refs.head !== commit && (await git(["merge-base", "--is-ancestor", commit, refs.head], { cwd: repo })).code === 0) commit = refs.head;
    }
    /** The folders a sparse copy holds; null where it holds every file. */
    const cone = kind === "sparse" ? await coneFor(repo, folder, { commit, base, paths }) : null;
    /** @type {CopyKind} */
    const want = cone ? "sparse" : kind === "clone" && (await cowSupport(home, repo)).cow ? "clone" : "worktree";
    let placed = false;
    /** @type {CopyKind} */
    let got = want;
    /** @type {string[]} */
    let kept = [];
    if (existsSync(dest)) {
      const meta = metaOf(dest);
      if (othersLive(home, meta?.owner)) return copyFailed("its copy is held by another Filament that works in this repository");
      // Its work there could not be kept on its refs, again as it was put right above: a reset would lose it.
      if (meta?.state === "busy" && meta.unsaved) return copyFailed(`its copy holds work that could not be kept on its refs (${meta.unsaved.error}): it stays as it is until that can be done`);
      // One of a kind that cannot stand for it is made again: a sparse one's outside is not on its disk, and a whole one
      // is no sparse one.
      const had = kindOfCopy(meta);
      const fits = checkedOutWhole(dest) && (had === want || (own && want !== "sparse" && had !== "sparse"));
      const record = fits && cone ? gitDirOf(dest) : null;
      if (fits && (!cone || record)) {
        // Its own cone stays — what it widened to — with what this taking adds.
        if (record && cone) writeCone(record, narrowest([...readCone(record), ...cone]));
        placed = (await resetCopy(dest, commit, meta?.links || [], { ignored: (own && !!meta) || want === "clone", signal, sparse: !!cone, lfs, was: meta?.lfs })).ok;
        if (placed) got = had;
        if (placed && own && meta) kept = meta.links.filter(isLink);
      }
      if (!placed) {
        const gone = await dropCopy(repo, dest, meta?.links || []);
        if (!gone.ok) return copyFailed(`its copy could not be made again: ${gone.error}`);
      }
    }
    /** Copies not to be moved now: a program stands in one, or it holds a submodule. @type {Set<string>} */
    const tried = new Set();
    let waited = false;
    while (!placed && !signal?.aborted) {
      const idle = copiesIn(home).filter((c) => c.name !== id && !others.has(c.name) && !tried.has(c.name) && !claimed(c.dest) && c.whole && c.meta?.owner === OWNER && c.meta.state !== "busy");
      // Only a copy of its kind is taken; the cap counts them all.
      const pool = idle.filter((c) => kindOfCopy(c.meta) === want);
      const settled = pool.filter((c) => c.meta?.state === "parked" && now() - (c.meta?.at ?? 0) > SETTLE_MS).sort(byUse);
      const c = pool.find((x) => x.meta?.state === "free") || (idle.length + tried.size >= KEPT_COPIES ? settled[0] : undefined);
      // None to be had while a spare is being made: it is waited for, once, sooner done than a checkout of its own. A
      // spare is a checkout of every file: a clone or a sparse taking waits for none.
      const spare = c?.meta || want !== "worktree" ? null : spares.get(home);
      if (spare && !waited) {
        waited = true;
        await untilStopped(spare, signal);
        continue;
      }
      if (!c?.meta) break;
      const meta = c.meta;
      tried.add(c.name);
      claim(c.dest);
      // Its links named under the place it leaves: they go before it moves.
      unlinkAll(meta.links);
      const mv = await git(["worktree", "move", c.dest, dest], { cwd: repo, timeoutMs: 5 * 60_000, signal }).finally(() => unclaim(c.dest));
      if (mv.code !== 0) {
        writeMeta(c.dest, { ...meta, links: [] });
        continue;
      }
      // A sparse one taken holds this taking's cone, not its last agent's.
      const moved = cone ? gitDirOf(dest) : null;
      if (moved && cone) writeCone(moved, cone);
      placed = (!cone || !!moved) && (await resetCopy(dest, commit, [], { ignored: want === "clone", signal, sparse: !!cone, lfs, was: meta.lfs })).ok;
      if (!placed) {
        const gone = await dropCopy(repo, dest, []);
        if (!gone.ok) return copyFailed(`a copy taken for it could not be put right, nor removed: ${gone.error}`);
      }
    }
    if (!placed && want === "clone" && !signal?.aborted) {
      placed = (await makeClone(repo, dest, commit, { skip: dependencyPaths(repo, resolve(folder)), signal, checkout: checkoutFor(lfs) })).ok;
      // Not cloned: what the clone made goes — it holds no link —, and a checkout is made instead.
      if (!placed) await forgetTaskWorktree(repo, dest);
    }
    if (!placed) {
      if (signal?.aborted) return copyFailed(STOPPED_MAKING);
      got = cone ? "sparse" : "worktree";
      const made = await checkout(repo, dest, commit, signal, cone, lfs);
      if (!made.ok) return copyFailed(made.error);
      if (!cone && made.ms >= SPARE_AFTER_MS) slowHomes.add(keyOf(home));
    }
    const rel = relative(repo, resolve(folder));
    const linked = [...new Set([...kept, ...(await linkDependencies(repo, resolve(folder), dest))])];
    const coneAt = got === "sparse" ? gitDirOf(dest) : null;
    const held = coneAt ? readCone(coneAt) : null;
    writeMeta(dest, { owner: OWNER, state: "busy", agent: id, at: now(), links: linked, kind: got, lfs, ...(held ? { cone: held } : {}) });
    const pointers = lfs === "pointers" && (await keepsLfs(dest)) && (got !== "clone" || (await holdsPointer(dest)));
    const mine = claims.get(keyOf(dest));
    if (mine) mine.use = true;
    taken = true;
    if (want === "worktree" && slowHomes.has(keyOf(home))) void makeSpareCopy(repo, home);
    return { ok: true, wt: { repo, dest, workdir: rel && !rel.startsWith("..") ? join(dest, rel) : dest, base, linked, kind: got, lfs, pointers, ...(held ? { cone: held } : {}) }, head: commit };
  } catch (/** @type {any} */ e) {
    return copyFailed(String(e?.message || e));
  } finally {
    if (!taken) unclaim(dest);
  }
}
/**
 * The cone of a sparse copy at `commit` (sparse.js `coneOf`): the session folder's place in the repository, the folders
 * of what changed from `base` to `commit` — its agent's work so far —, and `paths` where `commit` has them. Null where
 * it is too wide for a sparse copy (`coneTooWide`): the copy holds every file.
 * @param {string} repo @param {string} folder @param {{ commit: string, base: string, paths: readonly string[] }} o
 */
async function coneFor(repo, folder, { commit, base, paths }) {
  const files = base && base !== commit ? (await changedFiles(repo, base, commit).catch(() => [])).map((f) => f.path) : [];
  const cone = await coneOf(repo, commit, { rel: resolve(folder), files, paths });
  return (await coneTooWide(repo, commit, cone)) ? null : cone;
}

/**
 * Whether the repository a folder is in is big, for a copy of it (the plan of 11-09 for big repos: sparse.js
 * `bigRepo`) — its newest copy's checkout took its time (`lastCheckout`), its index holds many entries, or its files
 * are stored with Git LFS —, why in a word; null where it is not, or there is no repository.
 * @param {string} folder @param {{ commit?: string }} [o]
 */
export async function isBigRepo(folder, { commit = "HEAD" } = {}) {
  const found = await repoOf(folder);
  if (!found.repo) return null;
  return bigRepo(found.repo, { commit, checkoutMs: (await lastCheckout(found.repo))?.ms ?? null });
}

/**
 * What the kind of a helper's copy is chosen by (app/agent/workspace-kind.js `copyKind`, the owner's plan of 11-09 for
 * big repos): whether the repository is big (`isBigRepo`), the build caches git ignores at its top and in the session's
 * folder (cow.js `buildCaches`), and — only where there are some: on Windows its probe starts a PowerShell — whether
 * the drive its copies are on clones files, the folder on it too (`cowSupport`). Null where the folder is in no
 * repository with a commit.
 * @param {string} folder  the session's folder
 * @returns {Promise<{ big: "slow" | "entries" | "lfs" | null, cow: boolean, caches: string[] } | null>}
 */
export async function copyFacts(folder) {
  const found = await repoOf(folder);
  if (!found.repo || !found.head) return null;
  const repo = found.repo;
  const common = await commonDirOf(repo);
  if (!common) return null;
  const [big, caches] = await Promise.all([lastCheckout(repo).then((l) => bigRepo(repo, { checkoutMs: l?.ms ?? null })), buildCaches(repo, resolve(folder))]);
  if (!caches.length) return { big, cow: false, caches };
  const home = join(common, TASK_HOME);
  mkdirSync(home, { recursive: true });
  return { big, cow: (await cowSupport(home, repo)).cow, caches };
}

/** Whether a cone holds a folder's files: the folder is in it, or a parent of one of its folders (whose own files come). @param {readonly string[]} cone @param {string} f */
const coneHolds = (cone, f) => !f || cone.some((c) => f === c || f.startsWith(`${c}/`) || c.startsWith(`${f}/`));
/** The widen of each copy under way (`widenFor`): one at a time, as a reply's reads run side by side through one index. @type {Map<string, Promise<unknown>>} */
const widening = new Map();

/**
 * A sparse copy of Filament's widened for a path a helper reads or writes outside its cone (the owner's plan of 11-09
 * for big repos), as `widenTaskWorktree` widens one: a read there finds no file, and a write makes one beside files the
 * copy does not hold — the file's folder comes in first. Read from the path alone, so any of Filament's file tools may
 * ask — the loop's, the ACP bridge's, its MCP server's —: a path in no copy costs its name's reading, one in a cone two
 * small files. Null where there is nothing to bring in: the path is in no copy of Filament's, its copy holds every file,
 * its cone holds it — the top's files and each parent folder's own come with any cone —, or its commit has no such
 * folder (a new folder's files are new to git: nothing of the commit lies beside them). One copy widens one path at a
 * time, its cone read again after the one before. `rel`: the path in the copy; `folder`: the one asked for.
 * @param {string} abs @param {{ signal?: AbortSignal | null }} [o]
 * @returns {Promise<null | { ok: true, dest: string, added: string[], rel: string, folder: string } | { ok: false, error: string, rel: string, folder: string }>}
 */
export async function widenFor(abs, { signal = null } = {}) {
  const parts = resolve(abs).split(/[\\/]/);
  for (let at = parts.lastIndexOf(TASK_HOME); at > 0; at = parts.lastIndexOf(TASK_HOME, at - 1)) {
    if (at + 1 >= parts.length) continue;
    const dest = parts.slice(0, at + 2).join(sep);
    const record = gitDirOf(dest);
    if (!record) continue;
    if (kindOfCopy(metaAt(record)) !== "sparse") return null;
    const rel = parts.slice(at + 2).join("/");
    const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    if (coneHolds(readCone(record), folder)) return null;
    const key = keyOf(dest);
    // The commit is read in the copy's turn, not ahead of it: a read ahead let a later ask overtake an earlier one, the
    // folder coming in for whichever finished reading first.
    const widen = async () => {
      if (coneHolds(readCone(record), folder)) return null;
      if ((await typesIn(dest, "HEAD", [folder])).get(folder) !== "tree") return null;
      const w = await widenTaskWorktree(dest, [folder], { signal });
      if (!w.ok) return { ok: /** @type {const} */ (false), error: w.error, rel, folder };
      return w.added.length ? { ok: /** @type {const} */ (true), dest, added: w.added, rel, folder } : null;
    };
    const p = (widening.get(key) || Promise.resolve()).then(widen, widen);
    widening.set(key, p);
    void p.catch(() => {}).finally(() => {
      if (widening.get(key) === p) widening.delete(key);
    });
    return p;
  }
  return null;
}

/**
 * A sparse copy of Filament's holds more folders (the plan of 11-09 for big repos): each added to its cone and read
 * onto its disk, its record saying the cone it holds now (sparse.js `widenCone`) — what `filament workspace widen` runs
 * in the copy, and what a write outside its cone asks first. `folder`: the copy, or a folder in it; `folders` relative
 * to it, or absolute — a file stands for its folder, and one its commit does not have is said. A copy that holds every
 * file widens to nothing (`whole`). Not one of Filament's copies, or not widened: why, in words.
 * @param {string} folder @param {readonly string[]} folders @param {{ signal?: AbortSignal | null }} [o]
 * @returns {Promise<{ ok: true, dest: string, cone: string[], added: string[], whole: boolean } | { ok: false, error: string }>}
 */
export async function widenTaskWorktree(folder, folders, { signal = null } = {}) {
  const top = await git(["rev-parse", "--show-toplevel"], { cwd: folder });
  if (top.error) return { ok: false, error: top.error };
  if (top.code !== 0 || !top.out) return { ok: false, error: "this folder is in no git repository" };
  const dest = resolve(top.out);
  const record = gitDirOf(dest);
  const meta = metaAt(record);
  if (!record || !meta || !sameFolder(dirname(dest), join(dirname(dirname(record)), TASK_HOME))) return { ok: false, error: "this folder is not in a copy Filament made for a helper" };
  if (kindOfCopy(meta) !== "sparse") return { ok: true, dest, cone: [], added: [], whole: true };
  /** @type {string[]} */
  const asked = [];
  for (const f of folders) {
    const p = repoPath(dest, resolve(folder, f));
    if (p === null) return { ok: false, error: `${f} is outside this copy` };
    if (p) asked.push(p);
  }
  const missing = [...(await typesIn(dest, "HEAD", asked))].filter(([, type]) => !type).map(([p]) => p);
  if (missing.length) return { ok: false, error: `the copy's commit has no ${missing.join(", ")}` };
  const quiet = ["-c", `core.hooksPath=${join(dirname(dest), ".no-hooks")}`, ...checkoutFor(meta.lfs === "pointers" ? "pointers" : "whole").args];
  const w = await widenCone(dest, record, await coneOf(dest, "HEAD", { paths: asked }), { config: quiet, signal });
  if (!w.ok) return w;
  const latest = metaAt(record);
  if (w.added.length && latest) writeMeta(dest, { ...latest, cone: w.cone });
  return { ok: true, dest, cone: w.cone, added: w.added, whole: false };
}

/** The time now. */
const now = () => Date.now();
/** `p` settled, or `signal` stopped the wait. @param {Promise<void>} p @param {AbortSignal | null} signal */
const untilStopped = (p, signal) =>
  signal ? Promise.race([p, new Promise((r) => (signal.aborted ? r(undefined) : signal.addEventListener("abort", () => r(undefined), { once: true })))]) : p;

/** Repositories' homes whose new copy took `SPARE_AFTER_MS` or more to check out. @type {Set<string>} */
const slowHomes = new Set();
/** The spare copy being made in each home, as its promise. @type {Map<string, Promise<void>>} */
const spares = new Map();
/**
 * One copy made ahead, free, where none is free and fewer than `KEPT_COPIES` copies wait unused (HarnessV4_Worktrees_Plan
 * W5): the next agent or check takes it in a second, where a checkout of a big repository takes half a minute. One at a
 * time per repository; at its HEAD, which a taker's reset moves on from. A takeTaskWorktree that finds none waits for
 * the one being made. Made on its own after a taking in a repository whose checkout was slow; settles when it is made,
 * or is not.
 * @param {string} repo @param {string} home
 * @returns {Promise<void>}
 */
export function makeSpareCopy(repo, home) {
  const had = spares.get(home);
  if (had) return had;
  const idle = copiesIn(home).filter((c) => !claimed(c.dest) && c.whole && c.meta?.owner === OWNER && c.meta.state !== "busy" && kindOfCopy(c.meta) === "worktree");
  if (idle.some((c) => c.meta?.state === "free") || idle.length >= KEPT_COPIES) return Promise.resolve();
  const dest = join(home, `spare-${randomUUID().slice(0, 8)}`);
  claim(dest);
  const p = (async () => {
    try {
      const head = await git(["rev-parse", "--verify", "-q", "HEAD^{commit}"], { cwd: repo });
      if (head.code !== 0 || !head.out) return;
      const made = await checkout(repo, dest, head.out, null, null, "pointers");
      if (made.ok) writeMeta(dest, { owner: OWNER, state: "free", agent: "", at: now(), links: [], lfs: "pointers" });
      else await forgetTaskWorktree(repo, dest);
    } catch {
      // A spare not made is no loss: the next taker checks one out, as it would have.
    } finally {
      unclaim(dest);
      spares.delete(home);
    }
  })();
  spares.set(home, p);
  return p;
}

/**
 * A copy given back (HarnessV4_Worktrees_Plan W3): `parked` keeps it as it stands for its agent's next question (its
 * work is captured), `free` gives it to whoever comes next. Past the cap the least recently used copies go. One with no
 * record of Filament's goes now.
 * @param {TaskWorktree} wt @param {"parked" | "free"} state
 */
export async function releaseTaskWorktree(wt, state) {
  const meta = metaOf(wt.dest);
  try {
    if (meta) writeMeta(wt.dest, { ...saved(meta), owner: OWNER, state, at: now(), links: wt.linked });
    else await dropCopy(wt.repo, wt.dest, wt.linked);
  } finally {
    unclaim(wt.dest);
  }
  const common = await commonDirOf(wt.repo);
  if (common) await trim(wt.repo, join(common, TASK_HOME), new Set());
}

/**
 * Open a sub-agent's worktree: the working tree captured as its base (HEAD itself when nothing differs from it), and a
 * copy of it taken (`takeTaskWorktree`). `allowed` vets the copy's place (the loop's folder rule); `keep` names the
 * copies the caller works in now. Not made, the answer says why and of which kind (`NoCopy`). `signal` stops it,
 * leaving nothing. `kind`, `paths`: how the copy is made and what it holds (`takeTaskWorktree`). `batch`: the launches
 * asked with it (Phase 0 of the owner's 11-09 plan for big repos), whose snapshot it shares while that is being taken
 * (`batchSnapshot`). Its copy holds the files Git LFS keeps as their pointers.
 * @param {string} folder  the session's folder
 * @param {{ id: string, allowed?: (path: string) => boolean, signal?: AbortSignal | null, keep?: ReadonlySet<string>, kind?: CopyKind, paths?: readonly string[], batch?: string | null }} o
 * @returns {Promise<{ ok: true, wt: TaskWorktree } | NoCopy>}
 */
export async function openTaskWorktree(folder, { id, allowed = () => true, signal = null, keep = new Set(), kind = "worktree", paths = [], batch = null }) {
  const found = await repoOf(folder);
  if (!found.repo) return noCopyOf(found.error);
  if (!found.head) return noCopyOf("the repository has no commit yet");
  const repo = found.repo;
  const dest = await taskWorktreePath(repo, id);
  if (!dest) return copyFailed("git could not name the repository's git folder");
  if (!allowed(dest)) return copyFailed(outsideWords(dest));
  const ref = `${TASK_REF_PREFIX}${id}/base`;
  const snap = batch
    ? await batchSnapshot(repo, batch, id, signal)
    : await snapshotTree(repo, { name: `subagent-${id}-base`, ref, message: `Filament: the working tree when sub-agent ${id} started`, signal });
  if (!snap.ok) return copyFailed(signal?.aborted ? STOPPED_MAKING : snap.error || "the working tree could not be captured");
  const base = snap.commit || found.head;
  if (batch || !snap.commit) {
    const ur = await git(["update-ref", ref, base], { cwd: repo });
    if (ur.code !== 0) return copyFailed(`git update-ref failed: ${firstLine(ur.err || ur.out || ur.error)}`);
  }
  return takeTaskWorktree(folder, { id, commit: base, base, allowed, signal, keep, kind, paths, lfs: "pointers" });
}

/**
 * The snapshots of batches of launches being taken, by repository and batch (Phase 0 of the owner's 11-09 plan for big
 * repos): ten builders launched together took ten snapshots of one folder, each a scan of all its files. A launch of
 * the batch that comes while one is taken shares it — they were asked together, and it reads the folder as their own
 * would —; one that comes once it is taken takes its own, so none is shared across a change of the folder. Under no
 * ref, each launch writing its own; no launch's stop stops it, as the others wait on it.
 * @type {Map<string, Promise<import("./snapshot.js").SnapshotResult>>}
 */
const batchSnapshots = new Map();
/**
 * The snapshot of `batch` in `repo` being taken, else one taken now for it; a stop of `id`'s launch answers it as
 * stopped, the snapshot going on for the others.
 * @param {string} repo @param {string} batch @param {string} id @param {AbortSignal | null} signal
 * @returns {Promise<import("./snapshot.js").SnapshotResult>}
 */
export async function batchSnapshot(repo, batch, id, signal) {
  /** @type {import("./snapshot.js").SnapshotResult} */
  const stopped = { ok: false, changed: false, ref: null, commit: null, tree: null, repo: null, error: STOPPED_MAKING };
  if (signal?.aborted) return stopped;
  const key = `${keyOf(repo)}\n${batch}`;
  let taking = batchSnapshots.get(key);
  if (!taking) {
    const p = snapshotTree(repo, { name: `subagents-${batch}-base`, keep: false, message: `Filament: the working tree when sub-agent ${id} started, for any launched with it too` }).finally(() => {
      if (batchSnapshots.get(key) === p) batchSnapshots.delete(key);
    });
    p.catch(() => {});
    batchSnapshots.set(key, p);
    taking = p;
  }
  if (!signal) return taking;
  const stop = new Promise((r) => signal.addEventListener("abort", () => r(stopped), { once: true }));
  return /** @type {Promise<import("./snapshot.js").SnapshotResult>} */ (Promise.race([taking, stop]));
}

/**
 * A sub-agent's newest work in a copy again, for its next question: its parked copy reset where it stands, else one
 * taken (`takeTaskWorktree`). `signal`: its exchange's stop, which stops the copy's move and reset with it. `kind`,
 * `paths`: how the copy is made and what it holds — its launch's, so its parked copy is reset where it stands, keeping
 * its cone; of `kind` where its own is gone. Its copy holds the files Git LFS keeps as their pointers. `head`: its newest work, `head` or — where a capture of its copy moved its work's ref on
 * meanwhile — that.
 * @param {string} folder @param {{ id: string, base: string, head: string, allowed?: (path: string) => boolean, keep?: ReadonlySet<string>, signal?: AbortSignal | null, kind?: CopyKind, paths?: readonly string[] }} o
 * @returns {Promise<{ ok: true, wt: TaskWorktree, head: string } | { ok: false, error: string }>}
 */
export async function reviveTaskWorktree(folder, { id, base, head, allowed = () => true, keep = new Set(), signal = null, kind = "worktree", paths = [] }) {
  return takeTaskWorktree(folder, { id, commit: head, base, allowed, keep, own: true, signal, kind, paths, lfs: "pointers" });
}

/**
 * Until nothing of this Filament's holds sub-agent `id`'s copy — a reconcile putting it right (the start's sweep,
 * another copy's taking), a trim, a taking — so what that hold kept on its refs is read after it (the owner's of 11-09,
 * its review). One in use is not waited for: an answer or a check runs in it, which gives it back at its end.
 * @param {string} folder @param {string} id
 */
export async function untilCopyFree(folder, id) {
  const found = await repoOf(folder);
  const dest = found.repo ? await taskWorktreePath(found.repo, id) : null;
  if (!dest) return;
  for (let held = claims.get(keyOf(dest)); held && !held.use; held = claims.get(keyOf(dest))) await held.done;
}

/**
 * Whether a copy's commit keeps files in Git LFS: a `.gitattributes` of it names the lfs filter. Said to its builder,
 * whose copy holds them as their pointers.
 * @param {string} dest
 */
async function keepsLfs(dest) {
  const r = await git(["grep", "-q", "-F", "-e", "filter=lfs", "--", "*.gitattributes"], { cwd: dest });
  return r.code === 0;
}
/**
 * Whether a copy holds a file Git LFS keeps as its pointer: a clone holds each as the developer's folder had it —
 * content or pointer —, only what its put-back wrote a pointer. Git not answering, it is taken to hold some.
 * @param {string} dest
 */
async function holdsPointer(dest) {
  const ls = await gitBytes(["ls-files", "-z", "--", ":(attr:filter=lfs)"], { cwd: dest });
  if (ls.code !== 0) return true;
  for (const p of ls.out.toString("utf8").split("\0").filter(Boolean)) if (await isPointerFile(join(dest, p))) return true;
  return false;
}

/**
 * The file at `abs`, in a builder's copy that holds it as its Git LFS pointer, fetched in place (Phase 0 of the owner's
 * 11-09 plan for big repos): the read hand asks it before it reads a pointer there. Only a file git keeps through the
 * lfs filter (`check-attr`) whose bytes are its pointer as the copy's commit has it — never one the builder wrote —,
 * smudged as the repository's configuration says (`cat-file --filters`: git-lfs fetches what it does not hold), and
 * written over the pointer only where git reads it back as that pointer (`hash-object --path`), so a fetched file is
 * never the builder's change. Not fetched: `lfs` false where git does not keep it through LFS, to be read as it is;
 * else why, in words.
 * @param {string} dest  the copy's top folder @param {string} abs  the file
 * @returns {Promise<{ ok: true } | { ok: false, lfs: boolean, error: string }>}
 */
export async function fetchLfsFile(dest, abs) {
  const rel = relative(dest, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return { ok: false, lfs: false, error: "" };
  const path = rel.replace(/\\/g, "/");
  return fetchLfsAt(dest, path, abs, async () => {
    const at = await gitBytes(["rev-parse", "--verify", "-q", `HEAD:${path}`], { cwd: dest });
    return at.code === 0 ? at.out.toString("utf8").trim() : "";
  });
}
/**
 * `fetchLfsFile`'s fetch, wherever the pointer stands — a copy, or a patch workspace's overlay (patch.js
 * `fetchPatchLfs`): `cwd`, where git reads the repository and what its attributes say of `path`, the file's path from
 * the repository's top; `blobOf`, its pointer's blob as the commit it was laid out from has it ("" where it has none).
 * @param {string} cwd @param {string} path @param {string} abs @param {() => Promise<string>} blobOf
 * @returns {Promise<{ ok: true } | { ok: false, lfs: boolean, error: string }>}
 */
export async function fetchLfsAt(cwd, path, abs, blobOf) {
  const attr = await gitBytes(["check-attr", "-z", "filter", "--", path], { cwd });
  if (attr.code !== 0 || attr.out.toString("utf8").split("\0")[2] !== "lfs") return { ok: false, lfs: false, error: "" };
  /** @type {Buffer} */
  let pointer;
  try {
    pointer = await readFile(abs);
  } catch (/** @type {any} */ e) {
    return { ok: false, lfs: true, error: `it could not be read (${e?.code || e?.message})` };
  }
  const blob = await blobOf();
  const id = blob.length === 64 ? "sha256" : "sha1";
  if (!blob || createHash(id).update(`blob ${pointer.length}\0`).update(pointer).digest("hex") !== blob)
    return { ok: false, lfs: true, error: "it is not the pointer the copy was checked out with: it changed since" };
  const got = await gitBytes(["cat-file", "--filters", `--path=${path}`, blob], { cwd, env: { GIT_LFS_SKIP_SMUDGE: "0" } });
  if (got.code !== 0) return { ok: false, lfs: true, error: firstLine(got.err) || `git cat-file exited ${got.code}` };
  if (got.out.equals(pointer)) return { ok: false, lfs: true, error: "no LFS filter smudged it: git-lfs is not installed here, or not set up for this repository (git lfs install)" };
  try {
    await writeFile(abs, got.out);
  } catch (/** @type {any} */ e) {
    return { ok: false, lfs: true, error: `the copy would not take it (${e?.code || e?.message})` };
  }
  const back = await gitBytes(["hash-object", `--path=${path}`, "--", abs], { cwd });
  if (back.code === 0 && back.out.toString("utf8").trim() === blob) return { ok: true };
  await writeFile(abs, pointer).catch(() => {});
  return { ok: false, lfs: true, error: "git here would not store the fetched file as its pointer again (no LFS clean filter), so the pointer stays" };
}

/**
 * The folder as it stands, for Filament's check of it after a lead's apply (HarnessV3-TaskGraph-v2 TG2-D55): its
 * working tree captured as a commit under no ref — HEAD itself where nothing differs from it — so nothing in the folder,
 * its index or its refs changes. Git prunes it with nothing else unless work is kept on it (`keepTaskWork`).
 * @param {string} folder @param {{ name: string }} o
 * @returns {Promise<{ ok: true, commit: string } | { ok: false, error: string }>}
 */
export async function folderSnapshot(folder, { name }) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error };
  const snap = await snapshotTree(found.repo, { name, keep: false, message: `Filament: the folder ${name}` });
  if (!snap.ok) return { ok: false, error: snap.error || "the folder could not be captured" };
  const commit = snap.commit || found.head;
  return commit ? { ok: true, commit } : { ok: false, error: "the repository has no commit yet" };
}

/**
 * A snapshot of the folder checked out where Filament's check of it runs (TG2-D55): a copy at `id`'s place, its
 * dependency folders linked, as a sub-agent's is, and given back free once the check ends (`releaseTaskWorktree`).
 * @param {string} folder @param {{ id: string, commit: string, allowed?: (path: string) => boolean, keep?: ReadonlySet<string> }} o
 * @returns {Promise<{ ok: true, wt: TaskWorktree } | { ok: false, error: string }>}
 */
export async function openCheckTree(folder, { id, commit, allowed = () => true, keep = new Set() }) {
  return takeTaskWorktree(folder, { id, commit, base: commit, allowed, keep, lfs: "whole" });
}

/**
 * A command task's lane goes back to the snapshot it was opened on, between two items (HarnessV3-TaskGraph-v2 V2-3,
 * TG2-D4): every tracked file as the snapshot has it, and what the last item made that git does not ignore removed.
 * What git ignores stays — a build's output folder, and the linked dependency folders, which `clean` never follows.
 * @param {TaskWorktree} wt @param {string} commit
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function resetLane(wt, commit) {
  const quiet = ["-c", `core.hooksPath=${join(dirname(wt.dest), ".no-hooks")}`];
  const reset = await git([...quiet, ...CHECKOUT_WORKERS, "reset", "--hard", "--quiet", commit], { cwd: wt.dest, timeoutMs: 5 * 60_000 });
  if (reset.code !== 0) return { ok: false, error: `git reset failed: ${firstLine(reset.err || reset.out || reset.error)}` };
  const clean = await git([...quiet, "clean", "-fd", "--quiet"], { cwd: wt.dest, timeoutMs: 5 * 60_000 });
  if (clean.code !== 0) return { ok: false, error: `git clean failed: ${firstLine(clean.err || clean.out || clean.error)}` };
  return { ok: true };
}

/**
 * A sub-agent's work waits to be applied again, as `base`→`head` — an apply Filament undid (TG2-D55): both its refs
 * written, so it can be applied after a restart too. False when git would not write them.
 * @param {string} repo @param {string} id @param {{ base: string, head: string }} o
 */
export async function keepTaskWork(repo, id, { base, head }) {
  for (const [name, at] of [[`${TASK_REF_PREFIX}${id}/base`, base], [`${TASK_REF_PREFIX}${id}/work`, head]]) {
    const r = await git(["update-ref", name, at], { cwd: repo });
    if (r.code !== 0) return false;
  }
  return true;
}

/**
 * The commit a sub-agent's copy on another machine was sent at, held under a ref of its own (cp-back): every capture
 * that comes back is built on it, whatever was applied or dropped since — and the work an apply moved its base to
 * (`applied`), which what comes back next is measured from. False when git would not write them.
 * @param {string} repo @param {string} id @param {string} commit @param {string | null} [applied]
 */
export function holdCopyCommit(repo, id, commit, applied = null) {
  return refTransaction(repo, [`update ${TASK_REF_PREFIX}${id}/copy ${commit}`, applied && applied !== commit ? `update ${TASK_REF_PREFIX}${id}/applied ${applied}` : `delete ${TASK_REF_PREFIX}${id}/applied`]);
}

/** A sub-agent's hold on its copy's commits goes (`holdCopyCommit`): its chat or its thread did. @param {string} repo @param {string} id */
export function dropCopyCommit(repo, id) {
  return refTransaction(repo, [`delete ${TASK_REF_PREFIX}${id}/copy`, `delete ${TASK_REF_PREFIX}${id}/applied`]);
}

/**
 * The files between two commits, with their line counts, modes and blob ids (renames as a delete and an add). A git
 * that cannot answer throws, in words: an empty list always means nothing changed. `signal`: its stop, which throws
 * once git is gone.
 * @param {string} repo @param {string} base @param {string} head @param {{ signal?: AbortSignal | null }} [o]
 * @returns {Promise<ChangedFile[]>}
 */
export async function changedFiles(repo, base, head, { signal = null } = {}) {
  if (!base || !head || base === head) return [];
  const raw = await gitBytes(["diff", "--raw", "--no-renames", "--no-abbrev", "-z", base, head], { cwd: repo, signal });
  signal?.throwIfAborted();
  const num = await gitBytes(["diff", "--numstat", "--no-renames", "-z", base, head], { cwd: repo, signal });
  signal?.throwIfAborted();
  if (raw.code !== 0) throw new Error(`git could not list the changed files (${firstLine(raw.err) || `exit ${raw.code}`})`);
  /** @type {Map<string, { added: number, removed: number, binary: boolean }>} */
  const counts = new Map();
  for (const rec of num.out.toString("utf8").split("\0").filter(Boolean)) {
    const [a, r, ...p] = rec.split("\t");
    counts.set(p.join("\t"), { added: Number(a) || 0, removed: Number(r) || 0, binary: a === "-" });
  }
  const parts = raw.out.toString("utf8").split("\0");
  /** @type {ChangedFile[]} */
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const head0 = parts[i];
    const path = parts[i + 1];
    if (!head0.startsWith(":")) break;
    const [srcMode, dstMode, srcSha, dstSha, status] = head0.slice(1).split(" ");
    const c = counts.get(path) || { added: 0, removed: 0, binary: false };
    out.push({ path, status: status.charAt(0), added: c.added, removed: c.removed, binary: c.binary, srcMode, dstMode, srcSha, dstSha });
  }
  return out;
}

/**
 * Capture the sub-agent's tree as its newest work (`…/work`), measured against its work's base — whose ref is written
 * again too: an applied sub-agent's refs are dropped, and a follow-up's work must be reachable after a restart. `base`:
 * where its work waits from, the worktree's own unless an apply moved it on while the worktree stayed open (a capture
 * that failed keeps it) — what was applied never waits again.
 * @param {TaskWorktree} wt @param {{ id: string, previous?: string | null, base?: string }} o  `previous`: the last capture, if any
 * @returns {Promise<{ ok: true, head: string, files: ChangedFile[] } | { ok: false, error: string }>}
 */
export async function captureTaskWork(wt, { id, previous = null, base = wt.base }) {
  const ref = `${TASK_REF_PREFIX}${id}/work`;
  const snap = await snapshotTree(wt.dest, { name: `subagent-${id}-work`, ref, previous: previous || base, message: `Filament: sub-agent ${id}'s work` });
  if (!snap.ok) return { ok: false, error: snap.error || "its work could not be captured" };
  const head = snap.commit || previous || base;
  for (const [name, at] of [...(snap.commit ? [] : [[ref, head]]), [`${TASK_REF_PREFIX}${id}/base`, base]]) {
    const ur = await git(["update-ref", name, at], { cwd: wt.repo });
    if (ur.code !== 0) return { ok: false, error: `git update-ref failed: ${firstLine(ur.err || ur.out || ur.error)}` };
  }
  return { ok: true, head, files: await changedFiles(wt.repo, base, head) };
}

/**
 * The worktree goes now, whatever the cap: its links unlinked first (never followed), the folder removed, git's record
 * of it with it. A folder a program still stands in stays whole, and the answer says so: a later trim or taking deals
 * with it.
 * @param {TaskWorktree} wt
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function removeTaskWorktree(wt) {
  try {
    const gone = await dropCopy(wt.repo, wt.dest, wt.linked);
    // Kept against its will, it is nobody's: the next taker or trim has it.
    const meta = gone.ok ? null : metaOf(wt.dest);
    if (meta) writeMeta(wt.dest, { ...meta, owner: OWNER, state: "free", at: now(), links: [] });
    return gone;
  } finally {
    unclaim(wt.dest);
  }
}

/**
 * This Filament lets go of its copies as a crash does — its claims dropped, its word that it lives taken back, a new
 * name for what it holds next: what the Filament after a restart finds, for the tests of it.
 */
export function letGoOfCopies() {
  for (const h of homes) rmSync(join(h, ALIVE_DIR, OWNER), { force: true });
  homes.clear();
  for (const c of claims.values()) c.free();
  claims.clear();
  OWNER = randomUUID();
}

/**
 * Whether a worktree a crash left was checked out whole: git's record of it holds its index, and the lock git keeps
 * while it makes one (`locked`, "initializing") is gone. A checkout the crash cut, captured, would read as the agent's
 * deleting every file the checkout had not reached. An index's lock left beside a whole index is not that: a `git
 * status` or `add` the crash cut in a copy that was handed out — what it holds is captured through an index of its own,
 * as every capture is, and kept (the owner's of 11-09, its review: read as half-made, its edits went with it).
 * @param {string} dest
 */
function checkedOutWhole(dest) {
  const record = gitDirOf(dest);
  return !!record && existsSync(join(record, "index")) && !existsSync(join(record, "locked"));
}

/**
 * What an orphaned worktree holds goes onto its sub-agent's work ref (Fable 5.1's read of 10-22): what an exchange a
 * restart cut wrote stood only there, and an apply or a follow-up after the restart works from the refs. Only a
 * sub-agent's worktree with refs — a check's tree has none, nor has an applied agent's — and only one checked out
 * whole. Not ok, with git's words, only where there was work to keep and it could not be kept.
 * @param {string} repo @param {string} dest @param {string} id
 * @returns {Promise<{ ok: boolean, error: string }>}
 */
async function keepOrphanWork(repo, dest, id) {
  if (!checkedOutWhole(dest)) return { ok: true, error: "" };
  const refs = await taskRefs(repo, id);
  if (!refs) return { ok: true, error: "" };
  const snap = await snapshotTree(dest, { name: `subagent-${id}-work`, ref: `${TASK_REF_PREFIX}${id}/work`, previous: refs.head, message: `Filament: sub-agent ${id}'s work, kept from its folder after a restart` });
  return snap.ok ? { ok: true, error: "" } : { ok: false, error: snap.error || "its work could not be captured" };
}

/**
 * A repository's copies put right after a crash or a restart, and trimmed (`reconcile`): what an orphan holds kept on
 * its refs first, a checkout that was not whole gone, the rest kept for the agents and checks to come. `keep` names the
 * ones the caller works in now. How many went.
 * @param {string} folder @param {ReadonlySet<string>} [keep]
 */
export async function pruneTaskWorktrees(folder, keep = new Set()) {
  const found = await repoOf(folder);
  if (!found.repo) return 0;
  const common = await commonDirOf(found.repo);
  if (!common || !isDir(join(common, TASK_HOME))) return 0;
  holdHome(join(common, TASK_HOME));
  return reconcile(found.repo, join(common, TASK_HOME), keep);
}

/**
 * Every repository's copies put right as Filament starts (the owner's of 11-09), where until then a crash's or a
 * restart's waited for the next copy taken there or the next restored helper read: each repository the folders are in,
 * once, its copies reconciled as `pruneTaskWorktrees` does — what an orphan holds kept on its agent's refs, busy ones
 * parked, half-made checkouts gone, past the cap the least recently used let go. A repository with no copies' home is
 * passed over: none is made for it. `keep`, asked as each repository's turn comes: the copies Filament's helpers and
 * checks use now. A repository that fails is said in `failed`, and the rest go on; nothing throws.
 * @param {readonly string[]} folders @param {{ keep?: () => ReadonlySet<string> }} [o]
 * @returns {Promise<{ repos: string[], gone: number, failed: { folder: string, error: string }[] }>}
 */
export async function sweepTaskWorktrees(folders, { keep = () => new Set() } = {}) {
  const { repos: found, failed } = await reposOf(folders);
  /** @type {string[]} */
  const repos = [];
  let gone = 0;
  for (const r of found) {
    if (!(await isDirNow(r.home))) continue;
    try {
      holdHome(r.home);
      gone += await reconcile(r.repo, r.home, keep());
      repos.push(r.repo);
    } catch (/** @type {any} */ e) {
      failed.push({ folder: r.folder, error: firstLine(e?.message || String(e)) });
    }
  }
  return { repos, gone, failed };
}

/**
 * The repositories folders are in, each once — two worktrees of one repository are one, by its copies' home —, with a
 * folder of each, its top folder and its copies' home (which may not exist). A folder that is gone or in no
 * repository is passed over; one git fails on is said in `failed`. Each folder is looked at off the event loop
 * (`isDirNow`): it runs as Filament starts, at every chat's delete and every few hours.
 * @param {readonly string[]} folders
 * @returns {Promise<{ repos: { folder: string, repo: string, home: string }[], failed: { folder: string, error: string }[] }>}
 */
export async function reposOf(folders) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {{ folder: string, repo: string, home: string }[]} */
  const repos = [];
  /** @type {{ folder: string, error: string }[]} */
  const failed = [];
  for (const folder of new Set(folders.filter(Boolean))) {
    try {
      if (!(await isDirNow(folder))) continue;
      const found = await repoOf(folder);
      if (!found.repo) continue;
      const common = await commonDirOf(found.repo);
      if (!common) continue;
      const home = join(common, TASK_HOME);
      if (seen.has(keyOf(home))) continue;
      seen.add(keyOf(home));
      repos.push({ folder, repo: found.repo, home });
    } catch (/** @type {any} */ e) {
      failed.push({ folder, error: firstLine(e?.message || String(e)) });
    }
  }
  return { repos, failed };
}

/**
 * A deleted chat's helpers let go of what they kept in each repository the folders are in (`letGoTaskWork`, the
 * owner's of 11-09): only the helpers named, only where a copy or a ref of theirs is. What went, what stayed with why,
 * and whose work still waits on its refs, where.
 * @param {readonly string[]} folders @param {readonly string[]} ids
 * @param {{ keep?: () => ReadonlySet<string> }} [o]  the copies Filament's helpers and checks use now, asked per helper
 * @returns {Promise<{ gone: string[], stayed: { id: string, repo: string, why: string }[], waiting: { id: string, repo: string }[], failed: { folder: string, error: string }[] }>}
 */
export async function letGoHelpers(folders, ids, { keep = () => new Set() } = {}) {
  const out = { gone: /** @type {string[]} */ ([]), stayed: /** @type {{ id: string, repo: string, why: string }[]} */ ([]), waiting: /** @type {{ id: string, repo: string }[]} */ ([]) };
  const named = new Set(ids.filter((id) => id && !id.startsWith(".") && !/[\\/]/.test(id)));
  if (!named.size) return { ...out, failed: [] };
  const { repos, failed } = await reposOf(folders);
  for (const r of repos) {
    try {
      const refs = await helperRefs(r.repo);
      for (const id of named) {
        if (!refs.has(id) && !existsSync(join(r.home, id))) continue;
        const done = await letGoTaskWork(r.repo, id, { keep: keep() });
        if (!done.ok) failed.push({ folder: r.repo, error: done.error });
        else {
          if (done.copy === "gone") out.gone.push(id);
          if (done.copy === "stayed") out.stayed.push({ id, repo: r.repo, why: String(done.why) });
          if (done.waits) out.waiting.push({ id, repo: r.repo });
        }
      }
    } catch (/** @type {any} */ e) {
      failed.push({ folder: r.repo, error: firstLine(e?.message || String(e)) });
    }
  }
  return { ...out, failed };
}

/**
 * A copy whose work could not be captured at its exchange's end, nor kept on a second try (the owner's of 11-09): it
 * stays busy, as it was, and its record says why and since when (`unsaved`) — what Filament's footprint and Still open
 * read (`unsavedCopies`). False where it has no record of Filament's to mark.
 * @param {TaskWorktree} wt @param {string} error
 */
export function markUnsaved(wt, error) {
  const meta = metaOf(wt.dest);
  return !!meta && writeMeta(wt.dest, { ...meta, unsaved: { error: String(error), at: meta.unsaved?.at || now() } });
}

/**
 * The copies of a repository whose work could not be kept on their agent's refs (`markUnsaved`, `reconcile`): each
 * busy, by its folder, with its agent, why and since when. No repository: answered in words.
 * @param {string} folder
 * @returns {Promise<{ ok: true, repo: string, copies: { name: string, dest: string, agent: string, error: string, at: number }[] } | { ok: false, error: string }>}
 */
export async function unsavedCopies(folder) {
  const read = await copiesOf(folder);
  if (!read.ok) return read;
  /** @type {{ name: string, dest: string, agent: string, error: string, at: number }[]} */
  const copies = [];
  for (const c of read.copies) if (c.meta?.state === "busy" && c.meta.unsaved) copies.push({ name: c.name, dest: c.dest, agent: c.meta.agent, error: c.meta.unsaved.error, at: c.meta.unsaved.at });
  return { ok: true, repo: read.repo, copies };
}

/**
 * Each helper's refs in a repository, read in one git run: its `base`, `work`, `marked-base` and `marked-work` commits,
 * the trees of the first two, and when its work was captured (its `work` commit's time, in ms).
 * @param {string} repo  a folder of the repository's
 * @param {string} [id]  one helper's alone
 * @returns {Promise<Map<string, { base?: string, work?: string, baseTree?: string, workTree?: string, marked: boolean, at: number | null }>>}
 */
async function helperRefs(repo, id = "") {
  const r = await git(["for-each-ref", "--format=%(refname)%09%(objectname)%09%(tree)%09%(committerdate:unix)", `${TASK_REF_PREFIX}${id ? `${id}/` : ""}`], { cwd: repo });
  /** @type {Map<string, { base?: string, work?: string, baseTree?: string, workTree?: string, marked: boolean, at: number | null }>} */
  const out = new Map();
  if (r.code !== 0) return out;
  for (const line of r.out.split(/\r?\n/).filter(Boolean)) {
    const [ref, commit, tree, date] = line.split("\t");
    const parts = ref.slice(TASK_REF_PREFIX.length).split("/");
    if (parts.length !== 2 || !parts[0]) continue;
    const [owner, leaf] = parts;
    const h = out.get(owner) || { marked: false, at: null };
    if (leaf === "base") Object.assign(h, { base: commit, baseTree: tree || "" });
    else if (leaf === "work") Object.assign(h, { work: commit, workTree: tree || "", at: /^\d+$/.test(date || "") ? Number(date) * 1000 : null });
    else if (leaf === "marked-base" || leaf === "marked-work") h.marked = true;
    out.set(owner, h);
  }
  return out;
}
/** Whether a helper's refs hold work that waits: a base and a work whose trees differ. @param {{ base?: string, work?: string, baseTree?: string, workTree?: string }} h */
const workWaits = (h) => !!h.base && !!h.work && h.baseTree !== h.workTree;

/**
 * The helpers whose work waits to be applied in a repository's refs — their `base` and `work` trees differ —, each
 * with both commits and when the work was captured: what stays once its chat is deleted (`letGoTaskWork`), cheap, for
 * the person to find and apply or let go. No repository: answered in words.
 * @param {string} folder
 * @returns {Promise<{ ok: true, repo: string, work: { id: string, base: string, head: string, at: number | null }[] } | { ok: false, error: string }>}
 */
export async function waitingTaskWork(folder) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error };
  const refs = await helperRefs(found.repo);
  /** @type {{ id: string, base: string, head: string, at: number | null }[]} */
  const work = [];
  for (const [id, h] of refs) if (workWaits(h)) work.push({ id, base: String(h.base), head: String(h.work), at: h.at });
  return { ok: true, repo: found.repo, work };
}

/**
 * What a helper whose chat was deleted kept in a repository goes (the owner's of 11-09): its copy — what a crash left
 * in it kept on its refs first, its links unlinked and never followed — unless this Filament works in it (`keep`, its
 * claims), another living Filament holds it, or its work could not be kept; then its refs: all of them where nothing of
 * its work waits, else its mark's hold and its copy's on another machine alone — work that waits stays on its `base` and `work`, cheap, found by
 * `waitingTaskWork`. A copy that stays keeps its refs whole: they are what its work is kept against. `copy`: "gone",
 * "stayed" (why in `why`) or "none"; `waits`: its work waits on its refs.
 * @param {string} folder  a folder of the repository's @param {string} id
 * @param {{ keep?: ReadonlySet<string> }} [o]
 * @returns {Promise<{ ok: true, copy: "gone" | "stayed" | "none", why: string | null, waits: boolean } | { ok: false, error: string }>}
 */
export async function letGoTaskWork(folder, id, { keep = new Set() } = {}) {
  if (!id || id.startsWith(".") || /[\\/]/.test(id)) return { ok: false, error: "no helper goes by that name" };
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error };
  const repo = found.repo;
  const common = await commonDirOf(repo);
  if (!common) return { ok: false, error: "git could not name the repository's git folder" };
  const home = join(common, TASK_HOME);
  const dest = join(home, id);
  /** @type {"gone" | "stayed" | "none"} */
  let copy = "none";
  /** @type {string | null} */
  let why = null;
  // A patch workspace (patch.js): what it holds kept on its refs, then its folder and record go.
  if (patchRecorded(home, id)) {
    copy = "stayed";
    if (claimed(dest) || keep.has(id)) why = "in use now";
    else {
      const gone = await letGoPatch(repo, home, id);
      if (gone.ok) copy = "gone";
      else why = gone.error;
    }
  } else if (existsSync(dest)) {
    copy = "stayed";
    if (claimed(dest) || keep.has(id)) why = "in use now";
    else {
      claim(dest);
      try {
        const meta = metaOf(dest);
        if (othersLive(home, meta?.owner)) why = "another Filament that works in this repository holds it";
        else if (!meta && anotherLives(home) && changedLately(dest, Date.now())) why = "Filament has no record of it yet: it may still be being made";
        else {
          const kept = !meta || meta.state === "busy" ? await keepOrphanWork(repo, dest, id) : { ok: true, error: "" };
          if (!kept.ok) why = `its work could not be kept on its refs (${kept.error})`;
          else {
            const gone = await dropCopy(repo, dest, meta?.links || []);
            if (gone.ok) copy = "gone";
            else why = gone.error;
          }
        }
      } finally {
        unclaim(dest);
      }
    }
  }
  const h = (await helperRefs(repo, id)).get(id);
  const waits = !!h && workWaits(h);
  if (h && copy !== "stayed") {
    await (waits ? dropMarkHold(repo, id) : dropTaskRefs(repo, id));
    // Its copy on another machine went with its chat: what waits stays on its `base` and `work`.
    await dropCopyCommit(repo, id);
  }
  return { ok: true, copy, why, waits };
}

/**
 * @typedef {object} CopyRead  one of a repository's copies as Filament's footprint reads it (the footprint plan)
 * @property {string} name  its folder's name in the copies' home
 * @property {string} dest  its folder
 * @property {string | null} record  git's record of it, where its `.git` file names one
 * @property {CopyMeta | null} meta  Filament's record of it
 * @property {boolean} whole  its checkout is whole
 * @property {boolean} claimed  this Filament works in it now: an answer or a check, a taking, a trim
 * @property {boolean} othersHold  another living Filament holds it
 */

/**
 * A repository's copies as they stand, for Filament's footprint (the footprint plan): each with git's record and
 * Filament's — its `home`, the data folder that wrote it, among it —, whether its checkout is whole, whether this
 * Filament works in it now and whether another living one holds it; and `left`, the folders a Clean up moved aside
 * whose removal stopped part way (`letGoCopy`). Read only — nothing is put right here, as a taking or a trim would. No
 * repository: answered in words.
 * @param {string} folder
 * @returns {Promise<{ ok: true, repo: string, home: string, copies: CopyRead[], left: { name: string, dest: string }[] } | { ok: false, error: string }>}
 */
export async function copiesOf(folder) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error };
  const common = await commonDirOf(found.repo);
  if (!common) return { ok: false, error: "git could not name the repository's git folder" };
  const home = join(common, TASK_HOME);
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(home).filter((n) => ASIDE.test(n) && isDir(join(home, n)));
  } catch {}
  const left = names.map((name) => ({ name, dest: join(home, name) }));
  const copies = copiesIn(home).map((c) => ({
    name: c.name,
    dest: c.dest,
    record: gitDirOf(c.dest),
    meta: c.meta,
    whole: c.whole,
    claimed: claimed(c.dest),
    othersHold: othersLive(home, c.meta?.owner),
  }));
  return { ok: true, repo: found.repo, home, copies, left };
}

/** The errors a folder a program holds gives when it is moved (Windows: a file open in it, a process working there). */
const HELD = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * One copy let go on the person's Clean up (the footprint plan), read again under its claim: it goes only where Filament
 * has a record of it that is the one read (`at`, its last use), naming a data folder `homes` lets go (this Filament's,
 * or one that is gone), its checkout is whole, it is at rest — parked or free —, no other living Filament holds it, and
 * nothing of this one's works in it or names it in `keep` (the copies its helpers and checks use now). It is moved aside
 * first, out of the copies' names — another Filament that would take it, or put it right, finds it gone, and one that
 * holds a file in it keeps it whole —, then the links Filament made in it unlinked, git's record of it dropped and the
 * folder removed, a link in it never followed. Else why it stayed, in words; `left`, the moved folder, where its removal
 * stopped part way.
 * @param {string} repo @param {string} name
 * @param {{ keep?: () => ReadonlySet<string>, at: number, homes: (home: string | undefined) => boolean }} o
 * @returns {Promise<{ ok: true, left: string | null } | { ok: false, error: string }>}
 */
export async function letGoCopy(repo, name, { keep = () => new Set(), at, homes }) {
  if (!name || name.startsWith(".") || /[\\/]/.test(name)) return { ok: false, error: "no copy goes by that name" };
  const common = await commonDirOf(repo);
  if (!common) return { ok: false, error: "git could not name the repository's git folder" };
  const home = join(common, TASK_HOME);
  const dest = join(home, name);
  if (!existsSync(dest)) return { ok: false, error: "it is gone already" };
  if (patchRecorded(home, name)) return { ok: false, error: "it is a builder's patch workspace, not a copy: it goes with its chat" };
  if (claimed(dest) || keep().has(name)) return { ok: false, error: "in use now" };
  claim(dest);
  try {
    const meta = metaOf(dest);
    if (!meta) return { ok: false, error: "Filament has no record of it yet: it may still be being made" };
    if (meta.at !== at) return { ok: false, error: "it was used since you read it" };
    if (!homes(meta.home)) return { ok: false, error: "no record shows this Filament made it" };
    if (!checkedOutWhole(dest)) return { ok: false, error: "its checkout is not whole: it may still be being made" };
    if (meta.state === "busy") return { ok: false, error: "it is at work" };
    if (othersLive(home, meta.owner)) return { ok: false, error: "another Filament that works in this repository holds it" };
    const record = gitDirOf(dest);
    const aside = join(home, asideOf(name));
    try {
      renameSync(dest, aside);
    } catch (/** @type {any} */ e) {
      if (e?.code === "ENOENT") return { ok: false, error: "it was taken meanwhile" };
      return { ok: false, error: HELD.has(e?.code) ? `a program is using it (${e.code})` : `its folder could not be moved aside: ${firstLine(e?.message)}` };
    }
    unlinkAll(meta.links.map((l) => join(aside, relative(dest, l))));
    dropRecord(record);
    try {
      // The promise form: electron's Node, the desktop app's, stops at a read-only file in the sync one (HarnessV3-Native NA1).
      await rm(aside, { recursive: true, force: true });
      return { ok: true, left: null };
    } catch {
      return { ok: true, left: aside };
    }
  } finally {
    unclaim(dest);
  }
}

/**
 * A folder a Clean up moved aside and could not remove all the way (`letGoCopy`'s `left`), removed on the person's
 * next Clean up: by its name in the copies' home alone, a link in it never followed. It is no copy — git's record of it
 * and its links went as it was moved aside —, so whichever Filament's Clean up moved it, nothing of any Filament's is in
 * it. Else why it stays, in words.
 * @param {string} repo @param {string} name
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function sweepAside(repo, name) {
  if (!ASIDE.test(name)) return { ok: false, error: "no folder a Clean up left goes by that name" };
  const common = await commonDirOf(repo);
  if (!common) return { ok: false, error: "git could not name the repository's git folder" };
  const dest = join(common, TASK_HOME, name);
  if (!existsSync(dest)) return { ok: false, error: "it is gone already" };
  try {
    // The promise form: electron's Node, the desktop app's, stops at a read-only file in the sync one (HarnessV3-Native NA1).
    await rm(dest, { recursive: true, force: true });
    return { ok: true };
  } catch (/** @type {any} */ e) {
    return { ok: false, error: HELD.has(e?.code) ? `a program is using a file in it (${e.code})` : `it could not be removed: ${firstLine(e?.message)}` };
  }
}

/**
 * A sub-agent's refs in the repository the folder belongs to — what an apply after a restart works from.
 * @param {string} folder @param {string} id
 * @returns {Promise<{ repo: string, base: string, head: string } | null>}
 */
export async function taskRefs(folder, id) {
  const found = await repoOf(folder);
  if (!found.repo) return null;
  const b = await git(["rev-parse", "--verify", "-q", `${TASK_REF_PREFIX}${id}/base^{commit}`], { cwd: found.repo });
  if (b.code !== 0 || !b.out) return null;
  const w = await git(["rev-parse", "--verify", "-q", `${TASK_REF_PREFIX}${id}/work^{commit}`], { cwd: found.repo });
  return { repo: found.repo, base: b.out, head: w.code === 0 && w.out ? w.out : b.out };
}

/** @param {Buffer} b */
const isBinary = (b) => b.subarray(0, 8000).includes(0);
/** @param {string} repo @param {string} sha */
const blobOf = async (repo, sha) => (await gitBytes(["cat-file", "blob", sha], { cwd: repo })).out;

/** The labels git's conflict markers carry in a file the developer chose to keep both in: theirs, then its. */
const MARK_LABELS = ["-L", "yours", "-L", "at its start", "-L", "its change"];

/**
 * Three texts merged by git's merge-file, in a folder of their own: its output, and how many changes overlap (0 where
 * none). `diff3`: the start shown between the two sides, as Compare reads it. `signal`: its stop.
 * @param {Buffer} o @param {Buffer} b @param {Buffer} t @param {{ diff3?: boolean, signal?: AbortSignal | null }} [opt]
 * @returns {Promise<{ ok: true, out: Buffer, overlaps: number } | { ok: false, why: string }>}
 */
async function mergeFile(o, b, t, { diff3 = false, signal = null } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "filament-merge-"));
  try {
    writeFileSync(join(tmp, "yours"), o);
    writeFileSync(join(tmp, "base"), b);
    writeFileSync(join(tmp, "sub-agent"), t);
    const m = await gitBytes(["merge-file", "-p", ...(diff3 ? ["--diff3"] : []), ...MARK_LABELS, "yours", "base", "sub-agent"], { cwd: tmp, signal });
    // Its exit is the number of conflicts (127 at most); an error is negative, read here as 128 and up.
    if (m.code >= 0 && m.code < 128) return { ok: true, out: m.out, overlaps: m.code };
    return { ok: false, why: `git could not merge it (${firstLine(m.err)})` };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}
/** "1 change overlaps yours", "3 changes overlap yours". @param {number} n */
const overlapWords = (n) => (n === 1 ? "1 change overlaps yours" : `${n} changes overlap yours`);
/** The sub-agent's start of a file it added: none. */
const NO_BLOB = /^0+$/;

/**
 * @typedef {{ ok: true, sha: string, same?: true, keep?: Buffer } | { ok: false, why: string, kind: ConflictKind, overlaps?: number, marked?: string, keep?: Buffer }} Merged
 *   a merge three ways (`mergeThree`); `keep`, what a stored one keeps in git, its sha "" until the caller keeps it
 */
/**
 * A file both sides changed, merged three ways on the repository's cleaned form (line endings normalized): `ours`, git's
 * answer for the developer's version, kept in git (`hashesOf`), and `blobs` the bytes of its three versions
 * (`blobsOf`). `store` false: a dry run's — the merge is tried, and nothing of it kept in git (its sha ""). One whose
 * changes overlap says how many, and — stored — keeps the file with git's conflict markers too (`marked`), for the
 * developer who chooses to keep both (the Designer's of 10-27, built 10-28). `same`: the merge is the developer's file
 * as it is — its change is in it already, beside edits of their own —, and nothing need be written. What a stored merge
 * keeps in git is handed back as `keep`, for the caller to keep with the others' in one git call (`storeBlobs`).
 * @param {ChangedFile} f @param {Hashed} ours @param {Map<string, Buffer>} blobs @param {{ store?: boolean, signal?: AbortSignal | null }} [o]
 * @returns {Promise<Merged>}
 */
async function mergeThree(f, ours, blobs, { store = true, signal = null } = {}) {
  if (ours.code !== 0 || !ours.out) return { ok: false, why: "git could not read your version", kind: "unread" };
  const [o, b, t] = [ours.out, f.srcSha, f.dstSha].map((sha) => blobs.get(sha) || Buffer.alloc(0));
  if ([o, b, t].some(isBinary)) return { ok: false, why: "a binary file both you and the sub-agent changed", kind: "binary" };
  const m = await mergeFile(o, b, t, { signal });
  if (!m.ok) return { ok: false, why: m.why, kind: "unread" };
  if (m.overlaps) return { ok: false, why: overlapWords(m.overlaps), kind: "lines", overlaps: m.overlaps, marked: "", ...(store ? { keep: m.out } : {}) };
  if (m.out.equals(o)) return { ok: true, sha: ours.out, same: true };
  return store ? { ok: true, sha: "", keep: m.out } : { ok: true, sha: "" };
}
/** Bytes kept in git as a blob, in the repository's cleaned form; "" where git would not. @param {string} repo @param {Buffer} bytes */
async function storeBlob(repo, bytes) {
  const w = await gitBytes(["hash-object", "-w", "--stdin", "--no-filters"], { cwd: repo, input: bytes });
  const sha = w.out.toString("utf8").trim();
  return w.code === 0 ? sha : "";
}

/** A git object's id as git prints it: SHA-1's 40 hex digits, or SHA-256's 64. */
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** The files whose three versions one `cat-file --batch` reads for their merges, at most: what it says stays well under what one call keeps. */
const MERGES_PER_READ = 50;
/** The files a read checks the developer's folder for between two turns of Filament's loop (`waysOf`). */
const LOOKS_PER_TURN = 50;
/** One turn of Filament's loop: what waits on it goes first. */
const aTurn = () => new Promise((resolve) => setImmediate(resolve));
/**
 * A path as one line of git's `--stdin-paths`: as it is, or quoted as git quotes a path a line cannot hold as it is — a
 * line break in it, or a quote first.
 * @param {string} p
 */
const pathLine = (p) => (/^"|[\r\n]/.test(p) ? `"${p.replace(/["\\]/g, "\\$&").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"` : p);
/** @typedef {{ code: number, out: string, err: string, error?: string | null }} Hashed  git's answer for one file: its id in `out`, else its failure */
/**
 * What git would add each of the developer's files as — their clean filters applied, as `git add` does —, each answered
 * as one `hash-object` call for that file answers it; `write` keeps them in git too. One git call reads them all
 * (`--stdin-paths`): on Windows each git process Filament starts holds its loop while it starts. Git stops at a file it
 * cannot read; that one is asked alone, for its own words, and the files after it go on in a call of their own.
 * `signal`: its stop, which throws once git is gone, and starts no git after it.
 * @param {string} repo  the top folder @param {string[]} paths @param {{ write?: boolean, signal?: AbortSignal | null }} [o]
 * @returns {Promise<Hashed[]>}
 */
async function hashesOf(repo, paths, { write = false, signal = null } = {}) {
  const w = write ? ["-w"] : [];
  /** @type {Hashed[]} */
  const out = [];
  for (let rest = paths; rest.length; ) {
    signal?.throwIfAborted();
    const r = await gitBytes(["hash-object", ...w, "--stdin-paths"], { cwd: repo, input: Buffer.from(rest.map((p) => `${pathLine(p)}\n`).join(""), "utf8"), signal });
    signal?.throwIfAborted();
    const ids = r.out.toString("utf8").split("\n");
    let n = 0;
    while (n < rest.length && OID.test(ids[n])) n++;
    for (const id of ids.slice(0, n)) out.push({ code: 0, out: id, err: "" });
    if (n === rest.length) break;
    const one = rest[n];
    out.push(await git(["hash-object", ...w, `--path=${one}`, "--", join(repo, one)], { cwd: repo, signal }));
    signal?.throwIfAborted();
    rest = rest.slice(n + 1);
  }
  return out;
}
/**
 * The bytes of each blob by its id, as `blobOf` reads one — one git cannot read is empty —, from one `cat-file --batch`
 * for all of them; where git could not answer that call whole, blob by blob. `sure` false where git failed a read.
 * `signal`: its stop, which throws once git is gone.
 * @param {string} repo @param {string[]} shas @param {AbortSignal | null} [signal]
 * @returns {Promise<{ blobs: Map<string, Buffer>, sure: boolean }>}
 */
async function blobsOf(repo, shas, signal = null) {
  const asked = [...new Set(shas)];
  /** @type {Map<string, Buffer>} */
  const blobs = new Map();
  if (!asked.length) return { blobs, sure: true };
  const r = await gitBytes(["cat-file", "--batch"], { cwd: repo, input: Buffer.from(asked.map((s) => `${s}\n`).join("")), signal });
  signal?.throwIfAborted();
  let whole = r.code === 0;
  let sure = whole;
  // Each answer: `<id> <type> <size>`, its bytes and a line's end; else `<id> missing`.
  for (let i = 0, at = 0; whole && i < asked.length; i++) {
    const nl = r.out.indexOf(10, at);
    const m = nl < 0 ? null : /^(\S+) (?:missing|\S+ (\d+))$/.exec(r.out.subarray(at, nl).toString("utf8"));
    if (!m || m[1] !== asked[i]) whole = false;
    else if (m[2] == null) {
      blobs.set(asked[i], Buffer.alloc(0));
      sure = false;
      at = nl + 1;
    } else {
      const end = nl + 1 + Number(m[2]);
      if (end >= r.out.length) whole = false;
      else {
        blobs.set(asked[i], r.out.subarray(nl + 1, end));
        at = end + 1;
      }
    }
  }
  if (whole) return { blobs, sure };
  sure = true;
  for (const sha of asked) {
    const b = await gitBytes(["cat-file", "blob", sha], { cwd: repo, signal });
    signal?.throwIfAborted();
    blobs.set(sha, b.out);
    sure &&= b.code === 0;
  }
  return { blobs, sure };
}
/**
 * Bytes kept in git as blobs, as `storeBlob` keeps each — "" where git would not —, in one git call for all of them,
 * read from files in a folder of their own; where that call fails, each is kept alone.
 * @param {string} repo @param {Buffer[]} list @returns {Promise<string[]>}
 */
async function storeBlobs(repo, list) {
  if (!list.length) return [];
  const tmp = mkdtempSync(join(tmpdir(), "filament-store-"));
  try {
    const files = list.map((bytes, i) => {
      const p = join(tmp, String(i));
      writeFileSync(p, bytes);
      return p;
    });
    const r = await gitBytes(["hash-object", "-w", "--no-filters", "--stdin-paths"], { cwd: repo, input: Buffer.from(files.map((p) => `${pathLine(p)}\n`).join(""), "utf8") });
    const ids = r.out.toString("utf8").split("\n").slice(0, list.length);
    if (r.code === 0 && ids.length === list.length && ids.every((id) => OID.test(id))) return ids;
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
  /** @type {string[]} */
  const out = [];
  for (const bytes of list) out.push(await storeBlob(repo, bytes));
  return out;
}

/**
 * How a file of a sub-agent's work comes into the developer's folder (the Designer's of 10-27, on the owner's "what
 * does that apply button even do behind the scene"): `took` its version, over a file they left as it was or where none
 * stood; `merged` with their own edits, three ways; `deleted`, as it deleted it; `same`, already as it left it, or holding its
 * change beside edits of their own. And by
 * the developer's choice on a file that overlapped theirs (the Designer's of 10-27, built 10-28): `kept` theirs, its
 * change to it dropped; `replaced` theirs by its version; `markers` — both, with git's conflict markers in it for them to
 * resolve.
 * @typedef {"took" | "merged" | "deleted" | "same" | "kept" | "replaced" | "markers"} CameIn
 */
/** @typedef {{ path: string, how: CameIn }} Came */
/**
 * What stops a file: `lines` — the same lines changed on both sides; `deleted` — the sub-agent deleted a file the
 * developer changed; `gone` — it changed one they deleted; `added` — both added a file there, not the same; `binary` —
 * a binary both changed; `place` — their folder has something else there (a folder, a file where its folder should
 * be, a link, a submodule), applied by hand; `unread` — git could not read their version.
 * @typedef {"lines" | "deleted" | "gone" | "added" | "binary" | "place" | "unread"} ConflictKind
 */
/** @typedef {{ path: string, why: string, kind?: ConflictKind, overlaps?: number }} ApplyConflict */
/** The developer's choice for a file that stopped an apply: theirs, its, or both with markers. @typedef {"yours" | "its" | "both"} ApplyChoice */
/**
 * The choices each kind of overlap offers (the Designer's of 10-27): both with markers only where lines overlap — a
 * text file —, its version where there is one to take or a delete to make, and theirs always.
 * @type {Readonly<Record<ConflictKind, readonly ApplyChoice[]>>}
 */
export const CHOICES = Object.freeze({ lines: ["yours", "its", "both"], deleted: ["yours", "its"], gone: ["yours", "its"], added: ["yours", "its"], binary: ["yours", "its"], place: ["yours"], unread: ["yours"] });
/**
 * The agent's one answer for every file that stops an apply (the owner's of 11-09: an apply that overlaps must offer a
 * way on): `mine` keeps theirs of each; `markers` takes both with git's markers where lines overlap, and keeps theirs
 * where no marker fits — its delete, a binary, a link.
 * @typedef {"markers" | "mine"} OverlapWay
 */
/** The choice an overlap makes for a file of `kind`. @param {ConflictKind} kind @param {OverlapWay} overlap @returns {ApplyChoice} */
const overlapChoice = (kind, overlap) => (overlap === "markers" && CHOICES[kind].includes("both") ? "both" : "yours");

/** @typedef {{ link: boolean, there: boolean, dir: boolean }} PathKind  what stands at a path: a link (a junction on Windows), and whether anything is there, a folder — through a link, what it leads to */
/** @type {PathKind} */
const NOTHING = Object.freeze({ link: false, there: false, dir: false });
/** @param {string} p @returns {PathKind} */
const kindAt = (p) => {
  let l;
  try {
    l = lstatSync(p);
  } catch {
    return NOTHING;
  }
  if (!l.isSymbolicLink()) return { link: false, there: true, dir: l.isDirectory() };
  try {
    return { link: true, there: true, dir: statSync(p).isDirectory() };
  } catch {
    return { link: true, there: false, dir: false };
  }
};
/**
 * The developer's folder as one read of it finds it: each path's kind asked once, each folder's way checked once — a
 * link on it that leads out of the repository (`out`), a file where a folder should be (`fileAbove`) — and the
 * repository's own place once, so a read of a thousand files in a few folders asks a few stats a file, where each
 * file's own dozen would hold Filament's loop a second and more (the review of 11-02).
 * @param {string} repo
 */
function folderLook(repo) {
  /** @type {Map<string, PathKind>} */
  const kinds = new Map();
  /** @param {string} p */
  const kindOf = (p) => {
    let k = kinds.get(p);
    if (!k) kinds.set(p, (k = kindAt(p)));
    return k;
  };
  /** @type {string | null | undefined} */
  let top;
  /** @type {Map<string, boolean>} */
  const outs = new Map();
  /** @type {Map<string, string>} */
  const files = new Map();
  return {
    kindOf,
    /**
     * Whether a write in `dir` would land outside the repository: a link on its way that leads nowhere, or out of it.
     * Nothing there at all up to the root — a drive or a share gone — is no link in the way: the write fails in words.
     * @param {string} dir
     */
    out(dir) {
      let out = outs.get(dir);
      if (out != null) return out;
      out = false;
      try {
        let probe = dir;
        while (!kindOf(probe).there) {
          if (kindOf(probe).link) {
            out = true;
            break;
          }
          const up = dirname(probe);
          if (up === probe) break;
          probe = up;
        }
        if (!out && kindOf(probe).there) {
          if (top === undefined) {
            try {
              top = realpathSync(repo);
            } catch {
              top = null;
            }
          }
          if (top != null) {
            const rel = relative(top, realpathSync(probe));
            out = rel.startsWith("..") || isAbsolute(rel);
          }
        }
      } catch {}
      outs.set(dir, out);
      return out;
    },
    /**
     * `dir` or a folder above it, in the repository, that is a file in the developer's folder: its path in the
     * repository, else "" — a file the sub-agent added under a name they use for a file (the Hunter's of 10-28: the dry
     * run said it would come in, and the apply failed at its folder).
     * @param {string} dir
     */
    fileAbove(dir) {
      let found = files.get(dir);
      if (found != null) return found;
      found = "";
      for (let p = dir; p.length > repo.length && relative(repo, p) && !relative(repo, p).startsWith(".."); p = dirname(p)) {
        const k = kindOf(p);
        if (k.there && !k.dir) {
          found = relative(repo, p).split("\\").join("/");
          break;
        }
      }
      files.set(dir, found);
      return found;
    },
  };
}
/** @typedef {ReturnType<typeof folderLook>} FolderLook */

/** @typedef {{ how: CameIn, write?: string, remove?: boolean } | { conflict: ApplyConflict, marked?: string }} Way  a file's way into the developer's folder, or what stops it */
/** @param {ChangedFile} f @param {ConflictKind} kind @param {string} why @returns {Way} */
const stopsAt = (f, kind, why) => ({ conflict: { path: f.path, why, kind } });
/** A link's mode in a tree, or a submodule's. @param {string} m */
const linkOrSubmodule = (m) => m === "120000" || m === "160000";
/**
 * What stops a file before git reads it, as the developer's folder stands (`look`) — a link or a submodule, a link on
 * its way, a file where its folder should be —, else null.
 * @param {string} repo @param {ChangedFile} f @param {string} abs @param {FolderLook} look @returns {Way | null}
 */
function stopOnTheWay(repo, f, abs, look) {
  if (linkOrSubmodule(f.srcMode) || linkOrSubmodule(f.dstMode)) return stopsAt(f, "place", "a link or a submodule: apply it by hand");
  const linked = linkOnTheWay(repo, abs, look);
  if (linked) return stopsAt(f, "place", linked);
  const onTheWay = f.status === "D" ? "" : look.fileAbove(dirname(abs));
  if (onTheWay) return stopsAt(f, "place", `your folder has a file where its folder should be (${onTheWay})`);
  return null;
}
/**
 * A file's way in by what the developer's folder holds at its path — a folder (`dir`), or the id git gives their file
 * (`ours`, null where none is) —; null where both sides changed it, and it is merged.
 * @param {ChangedFile} f @param {boolean} dir @param {string | null} ours @returns {Way | null}
 */
function cameBy(f, dir, ours) {
  if (f.status === "A") {
    if (dir) return stopsAt(f, "place", "your folder has a folder there");
    if (ours == null) return { how: "took", write: f.dstSha };
    return ours === f.dstSha ? { how: "same" } : stopsAt(f, "added", "your folder has another file there");
  }
  if (f.status === "D") {
    if (ours == null) return { how: "same" };
    return ours === f.srcSha ? { how: "deleted", remove: true } : stopsAt(f, "deleted", "the sub-agent deleted it; you changed it since");
  }
  if (dir) return stopsAt(f, "place", "your folder has a folder there");
  if (ours == null) return stopsAt(f, "gone", "the sub-agent changed it; it is gone from your folder");
  if (ours === f.srcSha) return { how: "took", write: f.dstSha };
  if (ours === f.dstSha) return { how: "same" };
  return null;
}
/** Whether a file comes in as it is: its apply would write nothing. @param {Way | null} w */
const comesSame = (w) => !!w && "how" in w && w.how === "same";

/**
 * Each file's way into the developer's folder, or what stops it, with its kind, in order — read with one git call for
 * each kind of work (`hashesOf`, `mergesOf`), never one a file: on Windows each git process Filament starts holds its
 * loop while it starts (the slowness of 11-02). `whole`: only whether every file comes in as it is (`same`) is asked —
 * null at the first that does not, nothing merged after it. `sure` false where a git call the read stood on failed,
 * which another read may not. `signal`: its stop, which throws once its git is gone, and starts no git after it.
 * @param {string} repo @param {ChangedFile[]} files @param {{ store?: boolean, whole?: boolean, signal?: AbortSignal | null }} [o]
 * @returns {Promise<{ ways: Way[] | null, sure: boolean }>}
 */
async function waysOf(repo, files, { store = true, whole = false, signal = null } = {}) {
  /** @type {(Way | null)[]} */
  const ways = [];
  /** @type {boolean[]} */
  const dirs = [];
  /** @type {number[]} */
  const here = [];
  const look = folderLook(repo);
  for (const [i, f] of files.entries()) {
    // The folder's checks a few dozen files at a time, Filament's loop let turn between.
    if (i && i % LOOKS_PER_TURN === 0) {
      await aTurn();
      signal?.throwIfAborted();
    }
    const abs = join(repo, f.path);
    const stop = stopOnTheWay(repo, f, abs, look);
    if (stop && whole) return { ways: null, sure: true };
    ways.push(stop);
    const at = look.kindOf(abs);
    dirs.push(!stop && at.dir);
    if (!stop && !at.dir && at.there) here.push(i);
  }
  const hashed = await hashesOf(repo, here.map((i) => files[i].path), { signal });
  let sure = true;
  /** @type {Map<number, string>} */
  const ours = new Map();
  for (const [k, i] of here.entries()) {
    const h = hashed[k];
    if (h.code === 0) ours.set(i, h.out);
    else {
      // Their version that git could not read is no absent file (the copies hunt of 10-23: a delete was skipped, said
      // applied): the apply stops, in words.
      ways[i] = stopsAt(files[i], "unread", `git could not read your version (${firstLine(h.err || h.error || "") || `exit ${h.code}`})`);
      sure = false;
    }
  }
  /** @type {number[]} */
  const both = [];
  for (const [i, f] of files.entries()) {
    if (ways[i]) continue;
    ways[i] = cameBy(f, dirs[i], ours.get(i) ?? null);
    if (!ways[i]) both.push(i);
  }
  if (whole && ways.some((w) => w && !comesSame(w))) return { ways: null, sure };
  const merged = await mergesOf(repo, both.map((i) => files[i]), { store, whole, signal });
  if (!merged.ways) return { ways: null, sure: sure && merged.sure };
  for (const [k, i] of both.entries()) ways[i] = merged.ways[k];
  return { ways: /** @type {Way[]} */ (ways), sure: sure && merged.sure };
}

/**
 * The files both sides changed, each merged three ways (`mergeThree`): their versions in the developer's folder kept
 * in git with one git call, all three versions of each read with one for MERGES_PER_READ files, one `merge-file` each,
 * and the merges a store keeps kept with one. `whole`: null at the first that does not come in as it is, none merged
 * after it. `sure` false where a git call failed. `signal`: its stop, which throws once its git is gone.
 * @param {string} repo @param {ChangedFile[]} list @param {{ store: boolean, whole: boolean, signal?: AbortSignal | null }} o
 * @returns {Promise<{ ways: Way[] | null, sure: boolean }>}
 */
async function mergesOf(repo, list, { store, whole, signal = null }) {
  const ours = await hashesOf(repo, list.map((f) => f.path), { write: true, signal });
  let sure = true;
  /** @type {Merged[]} */
  const merges = [];
  for (let k = 0; k < list.length; k += MERGES_PER_READ) {
    const part = list.slice(k, k + MERGES_PER_READ);
    const read = await blobsOf(repo, part.flatMap((f, j) => (ours[k + j].code === 0 && ours[k + j].out ? [ours[k + j].out, f.srcSha, f.dstSha] : [])), signal);
    sure &&= read.sure;
    for (const [j, f] of part.entries()) {
      const m = await mergeThree(f, ours[k + j], read.blobs, { store, signal });
      signal?.throwIfAborted();
      if (!m.ok && m.kind === "unread") sure = false;
      if (whole && !(m.ok && m.same)) return { ways: null, sure };
      merges.push(m);
    }
  }
  const kept = await storeBlobs(repo, merges.flatMap((m) => (m.keep ? [m.keep] : [])));
  let n = 0;
  const ways = merges.map((m, i) => {
    const f = list[i];
    /** @type {Merged} */
    let got = m;
    if (m.keep) {
      const sha = kept[n++];
      got = m.ok ? (sha ? { ok: true, sha } : { ok: false, why: "git could not store the merge", kind: "unread" }) : { ok: false, why: m.why, kind: m.kind, overlaps: m.overlaps, marked: sha };
    }
    if (got.ok) return /** @type {Way} */ (got.same ? { how: "same" } : { how: "merged", write: got.sha });
    return { conflict: { path: f.path, why: got.why, kind: got.kind, ...(got.overlaps ? { overlaps: got.overlaps } : {}) }, ...(got.marked != null ? { marked: got.marked } : {}) };
  });
  return { ways, sure };
}

/** One file's way into the developer's folder, or what stops it (`waysOf`). @param {string} repo @param {ChangedFile} f @param {boolean} store @returns {Promise<Way>} */
const wayOf = async (repo, f, store) => /** @type {Way[]} */ ((await waysOf(repo, [f], { store })).ways)[0];

/**
 * A file that stopped, as the developer chose it: theirs kept, its version taken, or both with markers — or null where
 * the choice is none of those its kind offers (`CHOICES`), and it still stops.
 * @param {ChangedFile} f @param {ApplyConflict} c @param {ApplyChoice | undefined} choice @param {string | undefined} marked
 * @returns {{ how: CameIn, write?: string, remove?: boolean } | null}
 */
function chosenWay(f, c, choice, marked) {
  const kind = c.kind || "unread";
  if (!choice || !CHOICES[kind].includes(choice)) return null;
  if (choice === "yours") return { how: "kept" };
  if (choice === "both") return { how: "markers", write: marked || "" };
  if (kind === "deleted") return { how: "deleted", remove: true };
  return { how: kind === "gone" ? "took" : "replaced", write: f.dstSha };
}

/**
 * What an apply of base→head would do, file by file, written nowhere: each file's way in (`came`), what it writes
 * (`plan`), and every file that cannot come through cleanly. `store` false keeps nothing of a merge in git (a dry run).
 * `choices`: the developer's, by path, for the files that stopped it — one with a choice its kind offers comes in that
 * way, and stops no more (the Designer's of 10-27, built 10-28). `overlap`: the agent's, for each that stopped it and
 * the choices name none for (`overlapChoice`).
 * @param {string} repo @param {{ base: string, head: string }} o
 * @param {{ store?: boolean, choices?: Readonly<Record<string, ApplyChoice>>, overlap?: OverlapWay | null }} [opt]
 * @returns {Promise<{ files: ChangedFile[], plan: { f: ChangedFile, write?: string, remove?: boolean }[], came: Came[], conflicts: ApplyConflict[] }>}
 */
async function planApply(repo, { base, head }, { store = true, choices = {}, overlap = null } = {}) {
  const files = await changedFiles(repo, base, head);
  /** @type {{ f: ChangedFile, write?: string, remove?: boolean }[]} */
  const plan = [];
  /** @type {Came[]} */
  const came = [];
  /** @type {ApplyConflict[]} */
  const conflicts = [];
  const ways = /** @type {Way[]} */ ((await waysOf(repo, files, { store })).ways);
  for (const [i, f] of files.entries()) {
    const got = ways[i];
    const way = "conflict" in got ? chosenWay(f, got.conflict, choices[f.path] ?? (overlap ? overlapChoice(got.conflict.kind || "unread", overlap) : undefined), got.marked) : got;
    if (!way) {
      if ("conflict" in got) conflicts.push(got.conflict);
      continue;
    }
    came.push({ path: f.path, how: way.how });
    if (way.write != null || way.remove) plan.push({ f, ...(way.remove ? { remove: true } : { write: way.write }) });
  }
  return { files, plan, came, conflicts };
}

/**
 * What an apply of base→head would do now, nothing written (the Designer's of 10-27: Apply says its effect before the
 * press): how each file would come in, and the files that would stop it — with the developer's choices for those
 * where they made some. The apply itself checks all again.
 * @param {string} repo @param {{ base: string, head: string }} o @param {{ choices?: Readonly<Record<string, ApplyChoice>> }} [opt]
 * @returns {Promise<{ files: ChangedFile[], came: Came[], conflicts: ApplyConflict[] }>}
 */
export async function previewApply(repo, o, { choices = {} } = {}) {
  const { files, came, conflicts } = await planApply(repo, o, { store: false, choices });
  return { files, came, conflicts };
}

/** @typedef {{ files: ChangedFile[], came: Came[], conflicts: ApplyConflict[] }} Preview  what an apply would do (`previewApply`) */
/**
 * What a read of a sub-agent's work against the developer's folder stood on, and what it found (`foundWhole`): its
 * commits, the paths it read and the files git read beside them (`gitFilesOf`), the stats of all of them as one key
 * (`folderStamp`), and its answer.
 * @typedef {{ repo: string, base: string, head: string, paths: string[], watched: string[], key: string, whole: Preview | null }} ApplyStamp
 */
/** How near a read a file's last write may be and its stat still be trusted to show the next one: past the coarsest clock a disk keeps (FAT's 2 s). */
export const RACY_MS = 3_000;

/**
 * Whether base→head is in the developer's folder whole (`settleFound`'s question): every file as the sub-agent left
 * it, or holding its change beside edits of their own — its apply would write nothing, and nothing stops it. The dry
 * run's answer (`previewApply`) where it is, else null; the read stops at the first file that does not come in as it is
 * (`waysOf`). `stamp`: what the answer stands on, its stats read before the folder is — null where nothing a later look
 * can trust: a file written as it was read, a git call that failed. `since`: an earlier answer's stamp; where nothing it
 * stands on moved, its answer is this one's, and no git is started for it. `signal`: its stop — an apply that comes —,
 * which ends its git and throws once that git is gone, so none of it holds a file the apply writes.
 * @param {string} repo @param {{ base: string, head: string }} o @param {{ since?: ApplyStamp | null, signal?: AbortSignal | null }} [opt]
 * @returns {Promise<{ whole: Preview | null, stamp: ApplyStamp | null }>}
 */
export async function foundWhole(repo, { base, head }, { since = null, signal = null } = {}) {
  signal?.throwIfAborted();
  const was = since && since.repo === repo && since.base === base && since.head === head ? since : null;
  const now = was ? await folderStamp(repo, was.paths, was.watched) : null;
  if (was && now?.sure && now.key === was.key) return { whole: was.whole, stamp: was };
  const files = await changedFiles(repo, base, head, { signal });
  const paths = files.map((f) => f.path);
  const watched = await gitFilesOf(repo, signal);
  // The look just made stands for this read where it looked at the same files: it too was made before the folder is read.
  const same = !!was && !!watched && watched.join("\0") === was.watched.join("\0") && paths.join("\0") === was.paths.join("\0");
  const at = now && same ? now : await folderStamp(repo, paths, watched || []);
  const read = await waysOf(repo, files, { store: false, whole: true, signal });
  signal?.throwIfAborted();
  const whole = files.length > 0 && read.ways ? { files, came: files.map((f) => ({ path: f.path, how: /** @type {CameIn} */ ("same") })), conflicts: [] } : null;
  return { whole, stamp: watched && at.sure && read.sure ? { repo, base, head, paths, watched, key: at.key, whole } : null };
}

/**
 * What `gitFilesOf` last found for each repository: the files, the environment git read them by (`gitEnv`), and the
 * stats of the config files the list follows from (`config`) as one key.
 * @type {Map<string, { files: string[], config: string[], env: string, key: string }>}
 */
const gitFilesKept = new Map();
/** The locations `git var -l` names (git 2.42 on), by name: the system's config and attributes, the user's. */
const GIT_PLACES = /^(GIT_CONFIG_SYSTEM|GIT_CONFIG_GLOBAL|GIT_ATTR_SYSTEM|GIT_ATTR_GLOBAL)=(.+)$/;
/**
 * The settings a read's stamp follows to files, read with their paths as git reads them (`--type=path`: `~/` and
 * `%(prefix)/` expanded by git): git's own home (`filament.home`, set to `~/` for the call), every include, the user's
 * attributes, and whether attributes come from a tree.
 */
const PATH_KEYS = "^(filament\\.home|include\\.path|includeif\\..*\\.path|core\\.attributesfile|attr\\.tree)$";
/** What git's config and attributes follow in the environment: its home, where it looks for config, and settings it is handed. */
const GIT_ENV = ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "XDG_CONFIG_HOME", "PROGRAMDATA", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_ATTR_SOURCE", "GIT_ATTR_NOSYSTEM"];
/** The environment git reads its config and attributes by, as one key: what was kept under another stands for nothing. */
const gitEnv = () => [...GIT_ENV, ...Object.keys(process.env).filter((k) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)).sort()].map((k) => `${k}=${process.env[k] ?? ""}`).join("\0");
/**
 * A `-z --show-origin` listing of git's config, setting by setting: the file it comes from (none for the command line),
 * its key in lower case, its value. Each setting: `<origin>\0<key>\n<value>\0`, its origin `file:<path>` where a file
 * holds it, relative to git's folder — the repository's top.
 * @param {string} repo @param {Buffer} out @returns {{ origin: string, key: string, value: string }[]}
 */
function settingsIn(repo, out) {
  const parts = out.toString("utf8").split("\0");
  /** @type {{ origin: string, key: string, value: string }[]} */
  const list = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [name, ...rest] = parts[i + 1].split("\n");
    list.push({ origin: parts[i].startsWith("file:") ? resolve(repo, parts[i].slice(5)) : "", key: name.toLowerCase(), value: rest.join("\n") });
  }
  return list;
}

/**
 * The files besides the work's own that git reads to say what the developer's files would be added as. The config
 * files: the system's and the user's where git looks for them, there yet or not (`git var -l`: GIT_CONFIG_GLOBAL and
 * git's own home followed; Git for Windows' ProgramData one), every file a setting comes from (`--show-origin`), every
 * file an include names, its condition met or not, and HEAD, which a branch's include follows. The attributes git
 * keeps for the system and the user, and beside the repository; the index, whose .gitattributes git reads where the
 * folder has none. Every path as git means it (`PATH_KEYS`): relative ones from git's folder, the repository's top.
 * Kept for the next read where neither the environment nor any config file moved since (`gitFilesKept`) — an index or
 * an attributes file that moves is the read's to see, not the list's. Null — kept as nothing — where git would not say
 * all of it, and where attributes come from a tree (`attr.tree`, GIT_ATTR_SOURCE): they move with commits no stat
 * sees, so every read reads the folder again. `signal`: its stop, which throws once its git is gone.
 * @param {string} repo @param {AbortSignal | null} [signal] @returns {Promise<string[] | null>}
 */
async function gitFilesOf(repo, signal = null) {
  const env = gitEnv();
  const kept = gitFilesKept.get(repo);
  if (kept) {
    const now = kept.env === env ? await statsOf(kept.config) : null;
    if (now?.sure && now.key === kept.key) return kept.files;
    gitFilesKept.delete(repo);
  }
  if (process.env.GIT_ATTR_SOURCE) return null;
  const [r, p, v] = await Promise.all([
    gitBytes(["config", "--list", "--show-origin", "-z"], { cwd: repo, signal }),
    gitBytes(["-c", "filament.home=~/", "config", "--get-regexp", "--show-origin", "-z", "--type=path", PATH_KEYS], { cwd: repo, signal }),
    gitBytes(["var", "-l"], { cwd: repo, signal }),
  ]);
  signal?.throwIfAborted();
  if (r.code !== 0 || p.code !== 0 || v.code !== 0) return null;
  /** The config files the list follows from. @type {Set<string>} */
  const config = new Set();
  /** @type {Set<string>} */
  const others = new Set();
  /** @type {string[]} */
  const globals = [];
  for (const line of v.out.toString("utf8").split(/\r?\n/)) {
    const m = GIT_PLACES.exec(line);
    if (!m) continue;
    const at = resolve(repo, m[2]);
    (m[1].startsWith("GIT_CONFIG_") ? config : others).add(at);
    if (m[1] === "GIT_CONFIG_GLOBAL") globals.push(at);
  }
  for (const s of settingsIn(repo, r.out)) if (s.origin) config.add(s.origin);
  let home = "";
  for (const s of settingsIn(repo, p.out)) {
    if (s.key === "attr.tree") return null;
    if (s.key === "filament.home") home = resolve(s.value);
    else if (s.key === "core.attributesfile") others.add(resolve(repo, s.value));
    else if (s.value) config.add(resolve(s.origin ? dirname(s.origin) : repo, s.value));
  }
  // A git before 2.42 names neither the user's config nor their attributes: where git looks for them, from its home.
  if (!globals.length) {
    const at = home || process.env.HOME || homedir();
    const xdg = process.env.XDG_CONFIG_HOME || join(at, ".config");
    config.add(join(at, ".gitconfig")).add(join(xdg, "git", "config"));
    others.add(join(xdg, "git", "attributes"));
  }
  if (process.platform === "win32" && process.env.PROGRAMDATA) config.add(join(process.env.PROGRAMDATA, "Git", "config"));
  // The repository's git folder, as its `.git` names it — a worktree's names its own, and the one it shares.
  let gitDir = join(repo, ".git");
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(gitDir, "utf8"));
    if (m) gitDir = resolve(repo, m[1]);
  } catch {}
  let common = gitDir;
  try {
    common = resolve(gitDir, (await readFile(join(gitDir, "commondir"), "utf8")).trim());
  } catch {}
  config.add(join(common, "config")).add(join(gitDir, "config.worktree")).add(join(gitDir, "HEAD"));
  others.add(join(gitDir, "index")).add(join(common, "info", "attributes"));
  const follows = [...config];
  const files = [...new Set([...follows, ...others])];
  // Read after git was asked: a file that moved meanwhile is too new for its stat to stand for it, and nothing is kept.
  const at = await statsOf(follows);
  if (at.sure) gitFilesKept.set(repo, { files, config: follows, env, key: at.key });
  return files;
}

/**
 * What a read against the developer's folder stands on now, as one key (`foundWhole`): each path's stat, the kind of
 * every folder on its way, every .gitattributes on its way and the files git reads beside them (`gitFilesOf`), under
 * the environment git reads by (`gitEnv`). Read without git, off Filament's loop (`statsOf`).
 * @param {string} repo @param {string[]} paths @param {string[]} watched
 * @returns {Promise<{ key: string, sure: boolean }>}
 */
async function folderStamp(repo, paths, watched) {
  /** @type {Set<string>} */
  const folders = new Set();
  const files = new Set([join(repo, ".gitattributes")]);
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = join(repo, ...parts.slice(0, i));
      folders.add(dir);
      files.add(join(dir, ".gitattributes"));
    }
  }
  return statsOf([...paths.map((p) => join(repo, p)), ...files, ...watched, ...folders], gitEnv());
}

/**
 * The stats of `list`, in order, as one key — beside `also`, what else the key stands on: each one's kind, size, times
 * and id; a folder's kind; a link's own id and times and, as git reads through it, what it leads to with its stat. `sure`
 * false where a stat cannot stand for its file: one written or changed within RACY_MS of the read may be written again
 * with the same stat (git's racy files) — by its change time too, which a copy that keeps a file's written time moves,
 * and which some disks keep as coarsely —, and one that could not be read.
 * @param {string[]} list @param {string} [also]
 * @returns {Promise<{ key: string, sure: boolean }>}
 */
async function statsOf(list, also = "") {
  const at = Date.now();
  let sure = true;
  /** @param {import("node:fs").Stats} s */
  const fileWords = (s) => {
    if (Math.max(s.mtimeMs, s.ctimeMs) > at - RACY_MS) sure = false;
    return `f ${s.size} ${s.mtimeMs} ${s.ctimeMs} ${s.ino}`;
  };
  /** @param {string} p */
  const statOf = async (p) => {
    try {
      const s = await lstat(p);
      if (s.isFile()) return fileWords(s);
      if (s.isDirectory()) return "d";
      if (!s.isSymbolicLink()) return "o";
      const to = await stat(p).then((t) => (t.isDirectory() ? "d" : t.isFile() ? fileWords(t) : "o"), () => "-");
      return `l ${s.ino} ${s.mtimeMs} ${s.ctimeMs} ${to}`;
    } catch (/** @type {any} */ e) {
      if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return "-";
      sure = false;
      return "?";
    }
  };
  const words = await Promise.all(list.map(statOf));
  return { key: createHash("sha1").update(also).update("\0").update(words.join("\n")).digest("hex"), sure };
}

/**
 * One file of a sub-agent's work as Compare shows it (the Designer's of 10-27): what stops it and, where lines
 * overlap, each overlap — its line in the developer's file, their lines, the lines at its start and its own.
 * @typedef {{ at: number, yours: string[], start: string[], its: string[] }} Overlap
 * @param {string} repo @param {{ base: string, head: string }} o @param {string} path
 * @returns {Promise<{ ok: true, path: string, kind: ConflictKind | null, why: string, overlaps: Overlap[] } | { ok: false, error: string }>}
 */
export async function compareApply(repo, { base, head }, path) {
  const f = (await changedFiles(repo, base, head)).find((x) => x.path === path);
  if (!f) return { ok: false, error: `${path} is not among the files of its work` };
  const got = await wayOf(repo, f, false);
  if (!("conflict" in got)) return { ok: true, path, kind: null, why: "", overlaps: [] };
  const c = got.conflict;
  if (c.kind !== "lines") return { ok: true, path, kind: c.kind || "unread", why: c.why, overlaps: [] };
  const ours = await git(["hash-object", "-w", `--path=${f.path}`, "--", join(repo, f.path)], { cwd: repo });
  const [o, b, t] = await Promise.all([blobOf(repo, ours.out), blobOf(repo, f.srcSha), blobOf(repo, f.dstSha)]);
  const m = await mergeFile(o, b, t, { diff3: true });
  if (!m.ok) return { ok: false, error: m.why };
  const merged = m.out.toString("utf8");
  const mine = o.toString("utf8");
  const overlaps = overlapsOf(merged);
  // Carried across by git where it can say; by their lines where it can't.
  const starts = await startsIn(mine, merged, overlaps);
  const near = placed(structuredClone(overlaps), linesOf(mine));
  return { ok: true, path, kind: "lines", why: c.why, overlaps: overlaps.map((v, k) => ({ ...v, at: starts?.[k] ?? near[k].at })) };
}

/** @param {string} text */
const linesOf = (text) => text.replace(/\r\n/g, "\n").split("\n");

/**
 * Where each overlap starts in the developer's own file (the Hunter's of 10-28: found by their lines nearest the merge's
 * count, which counts the sub-agent's clean changes too, a side that repeated went to the wrong copy of it). The merge
 * with every overlap as their side differs from their file by the sub-agent's clean changes alone, so git's diff of the
 * two carries each start across. Null where git can't say; an overlap the diff reads as changed, null.
 * @param {string} mine @param {string} merged  the diff3 merge's output @param {Overlap[]} overlaps
 * @returns {Promise<(number | null)[] | null>}
 */
async function startsIn(mine, merged, overlaps) {
  if (!overlaps.length) return [];
  // The merge as the developer's side: each overlap's lines theirs, its markers and other sides gone.
  /** @type {string[]} */
  const theirs = [];
  let side = "";
  for (const l of linesOf(merged)) {
    if (!side && l.startsWith("<<<<<<< ")) side = "yours";
    else if (side && l.startsWith("||||||| ")) side = "start";
    else if (side && l === "=======") side = "its";
    else if (side && l.startsWith(">>>>>>> ")) side = "";
    else if (!side || side === "yours") theirs.push(l);
  }
  const tmp = mkdtempSync(join(tmpdir(), "filament-place-"));
  try {
    writeFileSync(join(tmp, "yours"), linesOf(mine).join("\n"));
    writeFileSync(join(tmp, "merged"), theirs.join("\n"));
    const d = await gitBytes(["diff", "--no-index", "--no-color", "--no-ext-diff", "-U0", "--", "yours", "merged"], { cwd: tmp });
    if (d.code !== 0 && d.code !== 1) return null;
    const hunks = [...d.out.toString("utf8").matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((h) => ({ b: h[2] == null ? 1 : Number(h[2]), c: Number(h[3]), d: h[4] == null ? 1 : Number(h[4]) }));
    return overlaps.map((v) => {
      const r = v.at;
      let shift = 0;
      for (const h of hunks) {
        // Lines the diff adds (c to c+d-1) or removes after line c: before the overlap, they move it.
        if (h.d > 0 && h.c <= r && r < h.c + h.d) return null;
        if (h.d > 0 ? h.c + h.d <= r : h.c < r) shift += h.d - h.b;
      }
      return r - shift;
    });
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Each overlap's line in the developer's own file: their side of it stands there whole, so it is found there — the
 * place nearest the merge's own count (which counts the sub-agent's clean changes too), after the overlap before it.
 * One where they removed every line keeps the merge's count.
 * @param {Overlap[]} overlaps @param {string[]} lines
 */
function placed(overlaps, lines) {
  let from = 0;
  for (const v of overlaps) {
    const n = v.yours.length;
    let best = -1;
    if (n) {
      for (let i = from; i + n <= lines.length; i++) {
        if (!v.yours.every((l, k) => lines[i + k] === l)) continue;
        if (best < 0 || Math.abs(i + 1 - v.at) < Math.abs(best + 1 - v.at)) best = i;
        else break;
      }
    }
    if (best >= 0) v.at = best + 1;
    else v.at = Math.max(v.at, from + 1);
    from = v.at - 1 + n;
  }
  return overlaps;
}

/**
 * The overlaps in a diff3 merge's output, in order: where each stands in the merged file (from 1), and its three
 * sides. @param {string} text @returns {Overlap[]}
 */
function overlapsOf(text) {
  /** @type {Overlap[]} */
  const out = [];
  /** @type {Overlap | null} */
  let cur = null;
  /** @type {"yours" | "start" | "its"} */
  let side = "yours";
  let line = 0;
  for (const l of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!cur && l.startsWith("<<<<<<< ")) {
      cur = { at: line + 1, yours: [], start: [], its: [] };
      side = "yours";
    } else if (cur && l.startsWith("||||||| ")) side = "start";
    else if (cur && l === "=======") side = "its";
    else if (cur && l.startsWith(">>>>>>> ")) {
      out.push(cur);
      line += cur.yours.length;
      cur = null;
    } else if (cur) cur[side].push(l);
    else line++;
  }
  return out;
}

/**
 * The entries of a commit's tree at `paths`, by path: each one's mode, type and id; a path with none is absent.
 * @param {string} repo @param {string} commit @param {string[]} paths
 * @returns {Promise<Map<string, { mode: string, type: string, sha: string }>>}
 */
async function entriesAt(repo, commit, paths) {
  const r = await gitBytes(["ls-tree", "-z", "--full-tree", commit, "--", ...paths], { cwd: repo });
  if (r.code !== 0) throw new Error(`git could not read your folder's tree (${firstLine(r.err) || `exit ${r.code}`})`);
  const out = new Map();
  for (const rec of r.out.toString("utf8").split("\0")) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]*)$/.exec(rec);
    if (m) out.set(m[4], { mode: m[1], type: m[2], sha: m[3] });
  }
  return out;
}

/** How a rebase's commit names each file it left with git's conflict markers, one line each. */
const MARKED_TRAILER = "Filament-Marked: ";

/**
 * The files a rebase left with git's conflict markers that still hold them in a sub-agent's work (the Hunter's of
 * 10-28): named by the rebase's commit — among `base`..`head`, else `head` alone — and kept where the file at `head`
 * still has its markers' lines, so a file its sub-agent resolved since is none, and one it left is one however many
 * commits came after. Read from git, so it holds after a restart. Git failing reads as none.
 * @param {string} repo @param {string} head @param {string} [base] @returns {Promise<string[]>}
 */
export async function rebaseMarks(repo, head, base = "") {
  if (!head) return [];
  const r = await git(["log", "--format=%B", ...(base && base !== head ? [`${base}..${head}`] : ["-1", head])], { cwd: repo });
  if (r.code !== 0) return [];
  const named = [...new Set(String(r.out || "").split("\n").filter((l) => l.startsWith(MARKED_TRAILER)).map((l) => l.slice(MARKED_TRAILER.length).trim()).filter(Boolean))];
  const still = await Promise.all(
    named.map(async (path) => {
      const b = await gitBytes(["cat-file", "blob", `${head}:${path}`], { cwd: repo });
      if (b.code !== 0) return false;
      const lines = b.out.toString("utf8").split(/\r?\n/);
      return lines.includes(`<<<<<<< ${MARK_LABELS[1]}`) && lines.includes(`>>>>>>> ${MARK_LABELS[5]}`);
    }),
  );
  return named.filter((_, i) => still[i]);
}

/**
 * A sub-agent's work redone on the developer's folder as it stands now (the Designer's of 10-27: Send back to
 * rebase): the folder captured as a commit (`base`), and its change brought onto it file by file (`head`) — a file
 * only it changed as it left it, one both changed merged three ways, one whose lines overlap with git's conflict
 * markers in it (`marked`) for it to resolve; one it cannot bring in — a delete against their change, a file they
 * deleted, a binary both changed, a folder or a link in the way — stays as their folder has it, named (`left`). Both
 * commits are kept on its refs, so its worktree revives at `head` and its work waits as base→head, whole again.
 * Nothing in the folder, its index or its refs changes.
 * @param {string} repo @param {string} id @param {{ base: string, head: string }} o
 * @returns {Promise<{ ok: true, base: string, head: string, files: ChangedFile[], marked: string[], left: ApplyConflict[] } | { ok: false, error: string }>}
 */
export async function rebaseTaskWork(repo, id, { base, head }) {
  const snap = await folderSnapshot(repo, { name: `subagent-${id}-rebase` });
  if (!snap.ok) return snap;
  const folder = snap.commit;
  /** @type {string[]} */
  const records = [];
  /** @type {string[]} */
  const marked = [];
  /** @type {ApplyConflict[]} */
  const left = [];
  const special = (/** @type {string} */ m) => m === "120000" || m === "160000";
  try {
    for (const f of await changedFiles(repo, base, head)) {
      /** @param {ConflictKind} kind @param {string} why */
      const leave = (kind, why) => left.push({ path: f.path, why, kind });
      /** @param {string} mode @param {string} sha */
      const put = (mode, sha) => records.push(`${mode} ${sha}\t${f.path}`);
      if (special(f.srcMode) || special(f.dstMode)) {
        leave("place", "a link or a submodule: apply it by hand");
        continue;
      }
      const ups = f.path.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));
      const tree = await entriesAt(repo, folder, [...ups, f.path]);
      const at = tree.get(f.path) || null;
      const onTheWay = f.status === "D" ? "" : ups.find((p) => tree.get(p)?.type === "blob") || "";
      if (onTheWay) leave("place", `your folder has a file where its folder should be (${onTheWay})`);
      else if (at && (at.type !== "blob" || special(at.mode))) leave("place", at.type === "tree" ? "your folder has a folder there" : "your folder has a link there: apply it by hand");
      else if (f.status === "D") {
        if (at && at.sha === f.srcSha) records.push(`0 ${"0".repeat(at.sha.length)}\t${f.path}`);
        else if (at) leave("deleted", "it deleted it; you changed it since");
      } else if (at?.sha === f.dstSha) continue;
      else if (!at) {
        if (f.status === "A") put(f.dstMode, f.dstSha);
        else leave("gone", "it changed it; it is gone from your folder");
      } else if (f.status !== "A" && at.sha === f.srcSha) put(f.dstMode, f.dstSha);
      else {
        // Both changed it, or both added a file there (from an empty start).
        const [o, b, t] = await Promise.all([blobOf(repo, at.sha), f.status === "A" ? Buffer.alloc(0) : blobOf(repo, f.srcSha), blobOf(repo, f.dstSha)]);
        if ([o, b, t].some(isBinary)) {
          leave("binary", "a binary file both you and it changed");
          continue;
        }
        const m = await mergeFile(o, b, t);
        const sha = m.ok ? await storeBlob(repo, m.out) : "";
        if (!m.ok || !sha) {
          leave("unread", m.ok ? "git could not store the merge" : m.why);
          continue;
        }
        put(f.srcMode === f.dstMode ? at.mode : f.dstMode, sha);
        if (m.overlaps) marked.push(f.path);
      }
    }
  } catch (/** @type {any} */ e) {
    return { ok: false, error: e.message };
  }
  let commit = folder;
  if (records.length) {
    const tmp = mkdtempSync(join(tmpdir(), "filament-rebase-"));
    try {
      const env = { GIT_INDEX_FILE: join(tmp, "index") };
      const said = (/** @type {{ code: number, out: Buffer, err: string }} */ r, /** @type {string} */ what) => `git ${what} failed: ${firstLine(r.err) || `exit ${r.code}`}`;
      // Every git that writes the temporary index writes it whole: never a split index, whose shared part would land in
      // the repository's git folder.
      const unsplit = ["-c", "core.splitIndex=false"];
      const rt = await gitBytes([...unsplit, "read-tree", folder], { cwd: repo, env });
      if (rt.code !== 0) return { ok: false, error: said(rt, "read-tree") };
      const ui = await gitBytes([...unsplit, "update-index", "-z", "--add", "--remove", "--index-info"], { cwd: repo, env, input: Buffer.from(records.map((r) => `${r}\0`).join(""), "utf8") });
      if (ui.code !== 0) return { ok: false, error: said(ui, "update-index") };
      const wt = await gitBytes([...unsplit, "write-tree"], { cwd: repo, env });
      if (wt.code !== 0) return { ok: false, error: said(wt, "write-tree") };
      // The files left with markers ride in its message, so an apply knows them after a restart too (`rebaseMarks`).
      const trailers = marked.filter((p) => !p.includes("\n")).map((p) => `${MARKED_TRAILER}${p}`);
      const message = [`Filament: sub-agent ${id}'s work, redone on your folder`, ...(trailers.length ? ["", ...trailers] : [])].join("\n");
      const ct = await gitBytes(["commit-tree", wt.out.toString("utf8").trim(), "-p", folder, "-m", message], { cwd: repo });
      if (ct.code !== 0) return { ok: false, error: said(ct, "commit-tree") };
      commit = ct.out.toString("utf8").trim();
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {}
    }
  }
  if (!(await keepTaskWork(repo, id, { base: folder, head: commit }))) return { ok: false, error: "git would not keep its work on its refs" };
  return { ok: true, base: folder, head: commit, files: await changedFiles(repo, folder, commit), marked, left };
}

/**
 * Bring base→head into the developer's folder, file by file. A file they left as it was takes the sub-agent's
 * version; one they changed too is merged three ways; one that cannot come through cleanly — overlapping changes, a
 * delete against a change, a binary both changed, a link — stops the whole apply before anything is written. Every
 * new version is read out of git before the first write, and what each write replaces is kept, so a file the folder
 * will not take (read-only, locked by an editor, a file where its folder should be) puts back the ones already
 * written: all or nothing even then. `stuck` names any that could not be put back. Files are compared in the repository's cleaned
 * form and written in its checked-out form (its line-ending rules). The index and HEAD are untouched. `came` says how
 * each file came in. `choices`: the developer's for files that would stop it; `overlap`: the agent's for every such
 * file (`planApply`).
 * @param {string} repo @param {{ base: string, head: string }} o @param {{ choices?: Readonly<Record<string, ApplyChoice>>, overlap?: OverlapWay | null }} [opt]
 * @returns {Promise<{ ok: true, files: ChangedFile[], came: Came[] } | { ok: false, conflicts: ApplyConflict[], stuck?: string[] }>}
 */
export async function applyTaskWork(repo, { base, head }, { choices = {}, overlap = null } = {}) {
  const { files, plan, came, conflicts } = await planApply(repo, { base, head }, { choices, overlap });
  if (conflicts.length) return { ok: false, conflicts };
  /** @type {Step[]} */
  const steps = [];
  for (const p of plan) {
    const abs = join(repo, p.f.path);
    let bytes = null;
    if (!p.remove) {
      const b = await gitBytes(["cat-file", "--filters", `--path=${p.f.path}`, String(p.write)], { cwd: repo });
      if (b.code !== 0) return { ok: false, conflicts: [{ path: p.f.path, why: `git could not read the sub-agent's version (${firstLine(b.err) || `exit ${b.code}`})` }] };
      bytes = b.out;
    }
    try {
      const had = existsSync(abs);
      steps.push({ f: p.f, abs, bytes, before: had ? readFileSync(abs) : null, mode: had ? statSync(abs).mode & 0o777 : null });
    } catch (/** @type {any} */ e) {
      return { ok: false, conflicts: [{ path: p.f.path, why: `your folder would not let it be read (${e.code || e.message})` }] };
    }
  }
  /** @type {Step[]} */
  const written = [];
  for (const s of steps) {
    try {
      if (s.bytes == null) rmSync(s.abs, { force: true });
      else {
        mkdirSync(dirname(s.abs), { recursive: true });
        writeFileSync(s.abs, s.bytes);
        if (s.f.dstMode === "100755" && process.platform !== "win32") chmodSync(s.abs, 0o755);
      }
      written.push(s);
    } catch (/** @type {any} */ e) {
      // The failed one too: a write can fail half-way through the file.
      const stuck = [s, ...written.reverse()].filter((w) => !putBack(w)).map((w) => w.f.path);
      return { ok: false, conflicts: [{ path: s.f.path, why: `your folder would not take it (${e.code || e.message})` }], ...(stuck.length ? { stuck } : {}) };
    }
  }
  return { ok: true, files, came };
}

/**
 * An apply that did not come through (`applyTaskWork`), in its words: in part — a file it could not put back, to check
 * by hand (`stuck`) — or not at all.
 * @param {{ conflicts: ApplyConflict[], stuck?: string[] }} r
 * @returns {{ ok: false, error: string, conflicts: ApplyConflict[], partial?: true, stuck?: string[] }}
 */
export function notApplied(r) {
  if (r.stuck) {
    const [c] = r.conflicts;
    const n = r.stuck.length;
    return { ok: false, partial: true, error: `Applied only in part: ${c.path}: ${c.why}, and ${n === 1 ? "1 file" : `${n} files`} could not be put back as ${n === 1 ? "it was" : "they were"} — ${r.stuck.join(", ")}. Check ${n === 1 ? "it" : "them"} by hand; the rest of the folder is as it was`, conflicts: r.conflicts, stuck: r.stuck };
  }
  return { ok: false, error: `${r.conflicts.length === 1 ? "1 file does" : `${r.conflicts.length} files do`} not come through cleanly — ${r.conflicts.map((c) => `${c.path}: ${c.why}`).join("; ")}`, conflicts: r.conflicts };
}

/**
 * Where a write at `abs` would not land in the file it names (the copies hunt of 10-23): `here`, a link stands at its
 * path, so the write lands wherever it points; `out`, a folder on its way is a link out of the repository. Null where
 * neither. An apply asks it of each file before it writes, and a rewind too; `look`, the read's own of the folder,
 * where it asks for many files (`folderLook`).
 * @param {string} repo @param {string} abs @param {FolderLook} [look]
 * @returns {"here" | "out" | null}
 */
export function linkInTheWay(repo, abs, look = folderLook(repo)) {
  if (look.kindOf(abs).link) return "here";
  return look.out(dirname(abs)) ? "out" : null;
}
/** Why the developer's folder cannot take a file at `abs` plainly (`linkInTheWay`); "" where it can. @param {string} repo @param {string} abs @param {FolderLook} look */
function linkOnTheWay(repo, abs, look) {
  const at = linkInTheWay(repo, abs, look);
  return at === "here" ? "your folder has a link there: apply it by hand" : at === "out" ? LINK_OUT : "";
}
const LINK_OUT = "a folder on its way in yours is a link out of the project: apply it by hand";

/** @typedef {{ f: ChangedFile, abs: string, bytes: Buffer | null, before: Buffer | null, mode: number | null }} Step */
/**
 * A file of an apply as it was before it (its bytes and mode); false when it cannot be. One that already is — the
 * write that failed before touching it — is left alone.
 * @param {Step} s
 */
function putBack(s) {
  try {
    const now = existsSync(s.abs) ? readFileSync(s.abs) : null;
    if (s.before == null) {
      if (now != null) rmSync(s.abs, { force: true });
      return true;
    }
    if (now == null || !now.equals(s.before)) writeFileSync(s.abs, s.before);
    if (s.mode != null && process.platform !== "win32" && (statSync(s.abs).mode & 0o777) !== s.mode) chmodSync(s.abs, s.mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * The work is applied: the base moves to it, so what comes next is measured from there — for when the refs would not
 * go (dropTaskRefs), so a restart does not offer the same work again.
 * @param {string} repo @param {string} id @param {string} head
 */
export async function markApplied(repo, id, head) {
  const r = await git(["update-ref", `${TASK_REF_PREFIX}${id}/base`, head], { cwd: repo });
  return r.code === 0;
}

/**
 * The work as a unified diff, for a surface (cut past DIFF_BYTES, said at the end).
 * @param {string} repo @param {string} base @param {string} head
 */
export async function diffTaskWork(repo, base, head) {
  if (!base || !head || base === head) return "";
  const d = await gitBytes(["diff", "--no-renames", "--no-color", "--no-ext-diff", base, head], { cwd: repo });
  if (d.code !== 0) return `[Filament: git could not show the diff (${firstLine(d.err) || `exit ${d.code}`})]`;
  return d.out.length > DIFF_BYTES ? `${d.out.subarray(0, DIFF_BYTES).toString("utf8")}\n…[Filament: the diff is cut here; the work itself is whole]` : d.out.toString("utf8");
}

/**
 * A running sub-agent's change so far (HarnessV3-TaskGraph-v2 §12, TG2-D17): its tree as it stands now, measured
 * against the worktree's base — the files, and the diff cut as a surface's is. It only reads: the commit it measures is
 * kept under no ref, so the sub-agent's refs and the capture at its exchange's end are untouched. A file written while
 * git reads it may fail the read: answered in words, and asked again.
 * @param {TaskWorktree} wt @param {{ id: string, previous?: string | null }} o  `previous`: its last capture, if any
 * @returns {Promise<{ ok: true, files: ChangedFile[], diff: string } | { ok: false, error: string }>}
 */
export async function taskWorkSoFar(wt, { id, previous = null }) {
  const snap = await snapshotTree(wt.dest, { name: `subagent-${id}-so-far`, previous: previous || wt.base, message: `Filament: sub-agent ${id}'s work so far`, keep: false });
  if (!snap.ok) return { ok: false, error: snap.error || "its work could not be read" };
  const head = snap.commit || previous || wt.base;
  return { ok: true, files: await changedFiles(wt.repo, wt.base, head), diff: await diffTaskWork(wt.repo, wt.base, head) };
}

/**
 * Refs moved in one step, all of them or none (`git update-ref --stdin`): each line `update <ref> <commit>` or
 * `delete <ref>` — a ref to delete that is not there is no failure. `reflog`: each ref it writes gets a reflog, which
 * says when it was written (`markHolds`), and goes with the ref. False when git would not move them.
 * @param {string} repo @param {string[]} lines @param {{ reflog?: boolean }} [o]
 */
async function refTransaction(repo, lines, { reflog = false } = {}) {
  const r = await gitBytes(["update-ref", ...(reflog ? ["--create-reflog"] : []), "--stdin"], { cwd: repo, input: Buffer.from(lines.map((l) => `${l}\n`).join("")) });
  return r.code === 0;
}

/** A sub-agent's ref by its name: `base` and `work` while its work waits, `marked-…` while a mark's undo holds it, or what an apply set aside (`holdMarkedWork`). @param {string} id @param {"base" | "work" | "marked-base" | "marked-work"} name */
const taskRef = (id, name) => `${TASK_REF_PREFIX}${id}/${name}`;

/**
 * The sub-agent's refs go, in one step: its work is applied, or nothing of it waits — and a mark's hold with them. They
 * hold its commits only while there is work to apply after a restart (a follow-up's capture writes them again), or a
 * mark to undo. False when git would not drop them.
 * @param {string} repo @param {string} id
 */
export function dropTaskRefs(repo, id) {
  return refTransaction(repo, [`delete ${taskRef(id, "work")}`, `delete ${taskRef(id, "base")}`, `delete ${taskRef(id, "marked-work")}`, `delete ${taskRef(id, "marked-base")}`]);
}

/**
 * A sub-agent's work marked as applied (10-29): nothing of it waits — its `base` and `work` refs go, so a restart offers
 * nothing — and its commits are held under refs of their own while the mark can be undone, where a gc would otherwise
 * take them once its copy is let go. One step: a mark git would not keep (false) leaves its work waiting as it did. The
 * hold's refs are written with a reflog, which says when the mark was made: the hold goes `MARK_KEPT_MS` after it. An
 * apply that kept the folder's version of files its change overlapped (the agent's `overlap` "mine", 11-09) holds its
 * commits the same way, so its change to them stays readable for as long.
 * @param {string} repo @param {string} id @param {{ base: string, head: string }} o
 */
export function holdMarkedWork(repo, id, { base, head }) {
  return refTransaction(repo, [`update ${taskRef(id, "marked-base")} ${base}`, `update ${taskRef(id, "marked-work")} ${head}`, `delete ${taskRef(id, "work")}`, `delete ${taskRef(id, "base")}`], { reflog: true });
}

/**
 * How long a mark's hold stays after the mark (the owner's of 11-09): long past the day its undo lasts
 * (subagents.js `MARK_UNDO_MS`), never for good — until then a hold stayed until its helper worked again, which may be
 * never.
 */
export const MARK_KEPT_MS = 7 * 24 * 3600_000;

/**
 * The marks' holds in a repository: each helper with a `marked-base` or `marked-work`, and when its mark was made — its
 * `marked-work`'s reflog's newest line (`holdMarkedWork`), in ms; null where it has none (a mark made before holds had
 * one, or a repository that keeps no reflogs). No repository: answered in words.
 * @param {string} folder
 * @returns {Promise<{ ok: true, repo: string, holds: { id: string, at: number | null }[] } | { ok: false, error: string }>}
 */
export async function markHolds(folder) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error };
  const repo = found.repo;
  /** @type {{ id: string, at: number | null }[]} */
  const holds = [];
  for (const [id, h] of await helperRefs(repo)) {
    if (!h.marked) continue;
    const log = await git(["reflog", "show", "-n", "1", "--date=unix", "--format=%gd", taskRef(id, "marked-work")], { cwd: repo });
    const m = log.code === 0 ? /@\{(\d+)\}\s*$/.exec(log.out) : null;
    holds.push({ id, at: m ? Number(m[1]) * 1000 : null });
  }
  return { ok: true, repo, holds };
}

/**
 * A mark's undo: the work it held waits again on its refs, as it did, and the hold goes — one step. False when git would
 * not move them.
 * @param {string} repo @param {string} id @param {{ base: string, head: string }} o
 */
export function unholdMarkedWork(repo, id, { base, head }) {
  return refTransaction(repo, [`update ${taskRef(id, "base")} ${base}`, `update ${taskRef(id, "work")} ${head}`, `delete ${taskRef(id, "marked-work")}`, `delete ${taskRef(id, "marked-base")}`]);
}

/** A mark that can be undone no more (its sub-agent worked since): what it held goes. @param {string} repo @param {string} id */
export function dropMarkHold(repo, id) {
  return refTransaction(repo, [`delete ${taskRef(id, "marked-work")}`, `delete ${taskRef(id, "marked-base")}`]);
}
