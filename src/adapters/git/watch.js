// @ts-check
// A branch watched for new commits (the plan of 11-11, its w3): where its tip is now, and what changed since a commit
// a watcher saw — the commits added, each with its committer's time and subject; those dropped where it was rewritten or
// moved back; its last seen commit gone, where git no longer has it. The tip is read again within moments of a change:
// the repository's refs are looked at every second where they live — its common git folder, which every worktree of
// it shares: the branch's loose file, packed-refs, a reftable's list —, by their size and times alone, and the tip read
// with git only as one changed. Nothing of the repository is held open: its folder, and those above it, stay free to
// rename, move and delete. Where the folder is on the network, or no repository is found there, it is read every half
// minute instead; and where looked at, every minute besides, for a change the look missed. A branch that is not there
// is said too, so one made later is heard made. Reads only: no git here writes, takes a lock, fetches what a partial
// clone lacks or asks at a terminal. No git, no repository: said in words, never thrown.
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { truncateMarked } from "../../core/text.js";
import { NO_LOCKS } from "./inspect.js";
import { firstLine, git as run } from "./snapshot.js";

/** How often a branch's refs are looked at, on a disk of this machine. */
export const POLL_MS = 1000;
/** How often a branch is read where its refs are not looked at: on the network, or where no repository is found. */
export const SLOW_READ_MS = 30_000;
/** How often a branch whose refs are looked at is read besides, for a change the look missed. */
export const SAFETY_READ_MS = 60_000;
/** The most commits a move's read names, with their times; past it they are counted. */
export const COMMITS_READ = 200;
/** How far back a branch's reflog is read for when it came to a commit. */
const REFLOG_READ = 50;

/**
 * What every git here runs under: no object a partial clone lacks fetched from its remote — a look reads what is
 * there, never the network, and writes nothing —, and no question asked at a terminal.
 */
const QUIET = Object.freeze({ GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" });
/** git as this file runs it (`QUIET`). @param {string[]} args @param {{ cwd: string }} o */
const git = (args, o) => run(args, { ...o, env: QUIET });

/** A full commit id. @param {string} s */
const isSha = (s) => /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(s);
/** A folder on the network, whose refs are not looked at every second: \\server\share, //server/share. @param {string} p */
export const onNetwork = (p) => /^(\\\\|\/\/)[^\\/]/.test(p);

/**
 * The git folder a folder's repository shares among its worktrees, as the disk names it — case and all, which a look
 * at its files on a case-sensitive disk needs —; null where the folder is in none.
 * @param {string} place
 */
export async function commonDirOf(place) {
  if (!place || !existsSync(place)) return null;
  const r = await git([...NO_LOCKS, "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: place });
  const dir = r.code === 0 ? r.out.split(/\r?\n/)[0] : "";
  return dir ? resolve(place, dir) : null;
}

/**
 * The branch a name misses by its case alone, on a disk that tells no case apart (git's core.ignorecase, set as the
 * repository was made): that branch's ref; null where there is none, or where the disk tells them apart — the name
 * is then simply no branch's.
 * @param {string} place @param {string} ref
 */
async function otherCase(place, ref) {
  const r = await git([...NO_LOCKS, "for-each-ref", "--ignore-case", "--format=%(refname)", ref], { cwd: place });
  const other = r.code === 0 ? r.out.split(/\r?\n/).find((n) => n !== ref && n.toLowerCase() === ref.toLowerCase()) : undefined;
  if (!other) return null;
  const c = await git([...NO_LOCKS, "config", "--type=bool", "--get", "core.ignorecase"], { cwd: place });
  return c.code === 0 && c.out === "true" ? other : null;
}

/**
 * The commit a branch's tip is at in a folder's repository; null where it has no such branch. By its exact name, as
 * git lists its refs: a name in another case would open the branch's loose file on a disk that tells no case apart,
 * and no more once its refs are packed — there it is refused, naming the branch that is (`otherCase`).
 * @param {string} place @param {string} branch
 * @returns {Promise<{ ok: true, head: string | null } | { ok: false, error: string }>}
 */
export async function branchHead(place, branch) {
  if (!place || !existsSync(place)) return { ok: false, error: "the folder is gone" };
  const ref = `refs/heads/${branch}`;
  // The refs named so, and those in a folder of that name: its own line is the one that names it whole.
  const r = await git([...NO_LOCKS, "for-each-ref", "--format=%(objectname)%1f%(refname)", ref], { cwd: place });
  if (r.code !== 0) return { ok: false, error: firstLine(r.error || r.err || `git for-each-ref exited ${r.code}`) };
  for (const l of r.out.split(/\r?\n/)) {
    const [head, name] = l.split("\x1f");
    if (name === ref && isSha(head)) return { ok: true, head };
  }
  const other = await otherCase(place, ref);
  return other ? { ok: false, error: `it is named ${other.slice("refs/heads/".length)}, not ${branch}` } : { ok: true, head: null };
}

/**
 * When a branch came to a commit in this repository, in ms, as its reflog says: a commit made here at its own moment;
 * one pulled, merged or reset to, when that was done. Null where the reflog says nothing of it: none kept, the entry
 * past the newest `REFLOG_READ`, the branch gone.
 * @param {string} place @param {string} branch @param {string} head
 * @returns {Promise<number | null>}
 */
export async function branchCameAt(place, branch, head) {
  if (!isSha(head) || !place || !existsSync(place)) return null;
  const r = await git([...NO_LOCKS, "reflog", "show", `-n${REFLOG_READ}`, "--date=unix", "--format=%H%x1f%gd", `refs/heads/${branch}`], { cwd: place });
  if (r.code !== 0) return null;
  for (const l of r.out.split(/\r?\n/)) {
    const [sha, entry = ""] = l.split("\x1f");
    const at = Number(/@\{(\d+)\}$/.exec(entry)?.[1]);
    if (sha === head && at > 0) return at * 1000;
  }
  return null;
}

/**
 * @typedef {{ sha: string, at: number, subject: string }} CommitRead  a commit: its id, its committer's time (ms), its subject
 * @typedef {{ ok: true, gone: true } | { ok: true, gone: false, added: CommitRead[], more: number, dropped: number }} Moved
 *   what a branch's move from a commit to another holds: the commits added, newest first, the first `most` of them and
 *   how many more; how many it dropped (rewritten, or moved back); or that git has the first no more (`gone`)
 */

/**
 * The commits read off a range of git's, newest first, the first `most`, and how many more of `all`.
 * @param {string} place @param {string[]} range  what git log reads @param {number} all @param {number} most
 * @returns {Promise<{ ok: true, added: CommitRead[], more: number } | { ok: false, error: string }>}
 */
async function commitsOf(place, range, all, most) {
  if (!all) return { ok: true, added: [], more: 0 };
  const log = await git([...NO_LOCKS, "log", "--no-color", `-n${most}`, "--format=%H%x1f%ct%x1f%s", ...range], { cwd: place });
  if (log.code !== 0) return { ok: false, error: firstLine(log.error || log.err || `git log exited ${log.code}`) };
  /** @type {CommitRead[]} */
  const list = [];
  for (const line of log.out.split(/\r?\n/)) {
    const [sha, ct, ...subject] = line.split("\x1f");
    if (isSha(sha)) list.push({ sha, at: Number(ct) * 1000 || 0, subject: subject.join("\x1f").trim() });
  }
  return { ok: true, added: list, more: Math.max(0, all - list.length) };
}

/**
 * The commits a branch made anew holds that no other branch does: what was committed on it before it came.
 * @param {string} place @param {string} branch @param {string} to @param {{ most?: number }} [o]
 * @returns {Promise<{ ok: true, gone: false, added: CommitRead[], more: number, dropped: number } | { ok: false, error: string }>}
 */
export async function commitsMade(place, branch, to, { most = COMMITS_READ } = {}) {
  if (!isSha(to)) return { ok: false, error: "a branch made names its commit" };
  // With --branches git takes a branch by its short name.
  const range = [to, "--not", `--exclude=${branch}`, "--branches"];
  const count = await git([...NO_LOCKS, "rev-list", "--count", ...range], { cwd: place });
  const all = Number(count.out);
  if (count.code !== 0 || !count.out || !Number.isInteger(all)) return { ok: false, error: firstLine(count.error || count.err || `git rev-list exited ${count.code}`) };
  const c = await commitsOf(place, range, all, most);
  return c.ok ? { ...c, gone: false, dropped: 0 } : c;
}

/**
 * What changed on a branch from one commit to another (`from..to`, and what `to` lacks of `from`).
 * @param {string} place @param {string} from @param {string} to @param {{ most?: number }} [o]
 * @returns {Promise<Moved | { ok: false, error: string }>}
 */
export async function commitsBetween(place, from, to, { most = COMMITS_READ } = {}) {
  if (!isSha(from) || !isSha(to)) return { ok: false, error: "a move names two commits" };
  const has = await git([...NO_LOCKS, "cat-file", "-e", `${from}^{commit}`], { cwd: place });
  if (has.error) return { ok: false, error: firstLine(has.error) };
  if (has.code !== 0) return { ok: true, gone: true };
  const counts = await git([...NO_LOCKS, "rev-list", "--left-right", "--count", `${from}...${to}`], { cwd: place });
  const [dropped, added] = counts.out.split(/\s+/).map(Number);
  if (counts.code !== 0 || !Number.isInteger(dropped) || !Number.isInteger(added)) return { ok: false, error: firstLine(counts.error || counts.err || `git rev-list exited ${counts.code}`) };
  const c = await commitsOf(place, [`${from}..${to}`], added, most);
  return c.ok ? { ...c, gone: false, dropped } : c;
}

/** What a move's commits read whole hold at most, in characters; and how many commits. */
export const SHOWN_CHARS = 20_000;
export const SHOWN_COMMITS = 20;

/**
 * A move's commits read whole, for a woken watcher's packet (app/watchers/packet.js): each one's id, author, date and
 * message, the files it touched and its diff, newest first — `from..to`; the tip alone where the branch was made
 * (`from` null); nothing where it was deleted (`to` null). Past `chars` it is cut, the rest counted; past `most` commits
 * the rest are counted too. Where the commit it moved from is in the repository no more — rewritten away and pruned
 * since the move was heard —, which commits are new cannot be told: the tip's newest `most` are shown, and said so.
 * @param {string} place @param {string | null} from @param {string | null} to @param {{ chars?: number, most?: number }} [o]
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function commitsShown(place, from, to, { chars = SHOWN_CHARS, most = SHOWN_COMMITS } = {}) {
  if (!to) return { ok: true, text: "" };
  if (!isSha(to) || (from !== null && !isSha(from))) return { ok: false, error: "a move names its commits by their whole ids" };
  let gone = false;
  if (from) {
    const has = await git([...NO_LOCKS, "cat-file", "-e", `${from}^{commit}`], { cwd: place });
    if (has.error) return { ok: false, error: firstLine(has.error) };
    gone = has.code !== 0;
  }
  const range = from && !gone ? [`${from}..${to}`] : gone ? [to] : ["-n1", to];
  const log = await git([...NO_LOCKS, "log", "--no-color", "--no-ext-diff", "--stat", "--patch", `-n${most}`, "--format=commit %H%nAuthor: %an <%ae>%nDate:   %aI%n%n%w(0,4,4)%B", ...range], { cwd: place });
  if (log.code !== 0 && !log.cut) return { ok: false, error: firstLine(log.error || log.err || `git log exited ${log.code}`) };
  if (gone) return { ok: true, text: `(the commit it moved from, ${from?.slice(0, 7)}, is in this repository no more, so which of these are new is unknown: the newest ${most} at its tip)\n${truncateMarked(log.out, chars)}` };
  const all = from ? Number((await git([...NO_LOCKS, "rev-list", "--count", `${from}..${to}`], { cwd: place })).out) || 0 : 1;
  const past = all > most ? `\n… (${all - most} older commit${all - most === 1 ? "" : "s"} not shown)` : "";
  return { ok: true, text: `${truncateMarked(log.out, chars)}${past}` };
}

/**
 * What a branch's refs look like now in its repository's common git folder: its loose file, packed-refs and a
 * reftable's list, each by its size, its times and its file's number — "" for one not there. Read off the disk, none
 * of it held open. A move of the branch's tip changes one of them, whichever worktree made it.
 * @param {string} common @param {string} branch
 */
async function refsLook(common, branch) {
  const files = [join(common, "refs", "heads", ...branch.split("/")), join(common, "packed-refs"), join(common, "reftable", "tables.list")];
  const looks = await Promise.all(files.map((f) => stat(f).then((s) => `${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.ino}`, () => "")));
  return looks.join("|");
}

/**
 * A branch watched: `onHead` hears its tip at the first read and at each change since — null where the branch is not
 * there —; `onError`, a read that failed, once until one succeeds, and null as one does. `stop` ends the watch; `read`
 * reads it now (the tests'); `mode`, whether its refs are looked at ("poll") or it is read slowly. A read that fails
 * where its refs were looked at — its folder moved away, no repository there any more — reads slowly from then, its
 * repository looked for again each time: one found, its refs are looked at again.
 * @param {string} place @param {string} branch
 * @param {{ onHead: (head: string | null) => void, onError?: (error: string | null) => void, pollMs?: number, slowMs?: number, safetyMs?: number, slow?: boolean }} o
 *   `slow`: read every `slowMs`, its refs not looked at (the tests')
 */
export function watchBranch(place, branch, { onHead, onError = () => {}, pollMs = POLL_MS, slowMs = SLOW_READ_MS, safetyMs = SAFETY_READ_MS, slow = false }) {
  /** @type {string | null | undefined} */
  let last = undefined;
  /** The failure said, null where the last read went well. @type {string | null} */
  let said = null;
  let stopped = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let next = null;
  /** @type {Promise<void> | null} */
  let reading = null;
  let again = false;
  /** @type {"poll" | "slow" | "starting"} */
  let mode = "starting";
  /** The repository's common git folder, while one is found. @type {string | null} */
  let common = null;
  /** What its refs looked like as its tip was last read, and when that was. */
  let looked = "";
  let readAt = 0;

  /** The tip read, one read at a time: a change during one reads once more after it. */
  const read = () => {
    if (stopped) return Promise.resolve();
    if (reading) {
      again = true;
      return reading;
    }
    reading = (async () => {
      do {
        again = false;
        readAt = Date.now();
        const r = await branchHead(place, branch).catch((/** @type {any} */ e) => ({ ok: /** @type {const} */ (false), error: firstLine(e?.message || String(e)) }));
        if (stopped) return;
        if (!r.ok) {
          if (said !== r.error) onError(r.error);
          said = r.error;
          continue;
        }
        if (said !== null) onError(null);
        said = null;
        if (r.head === last) continue;
        last = r.head;
        onHead(r.head);
      } while (again && !stopped);
    })().finally(() => {
      reading = null;
    });
    return reading;
  };

  /** One look, and how long until the next: its refs' files looked at, its tip read where one changed or a minute passed. */
  const look = async () => {
    if (!slow && !onNetwork(place) && !common) common = await commonDirOf(place).catch(() => null);
    if (stopped) return slowMs;
    if (!common) {
      mode = "slow";
      await read();
      return slowMs;
    }
    mode = "poll";
    // Looked at before the read: a change that comes while git reads shows at the next look.
    const now = await refsLook(common, branch);
    if (now === looked && Date.now() - readAt < safetyMs) return pollMs;
    looked = now;
    await read();
    if (said === null) return pollMs;
    common = null;
    looked = "";
    mode = "slow";
    return slowMs;
  };
  const looking = async () => {
    const wait = await look().catch(() => slowMs);
    if (stopped) return;
    next = setTimeout(() => void looking(), wait);
    next.unref?.();
  };
  void looking();

  return {
    read,
    mode: () => mode,
    stop() {
      stopped = true;
      if (next) clearTimeout(next);
    },
  };
}

/** @typedef {ReturnType<typeof watchBranch>} BranchWatch */
