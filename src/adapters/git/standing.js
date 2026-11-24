// @ts-check
// Where a folder's repository stands, for a session's briefing (the owner's of 10-29: a session should start knowing
// "what happened in last few commits", not learn it from a memory that may be out of date): the folder's branch against
// its base, the repository's other worktrees and whether each is merged, the commits the branch has that the base
// lacks, and the base's newest, as many as asked (the briefing asks for the newest alone, the memory plan's e1).
// Read-only and without the index lock — `placeInfo`'s and `readWorktree`'s reads, as the Worktrees page reads a place —
// and data only: the briefing words it (services/memory/repo-lines.js).
import { normalizeCwd } from "../../core/project-id.js";
import { git } from "./snapshot.js";
import { baseOf, placeInfo } from "./inspect.js";
import { readWorktree, worktreesOf } from "./places.js";

const LOG_FORMAT = "--format=%h%x09%cs%x09%s";

/** @typedef {import("../../core/repo-standing.js").RepoStanding} RepoStanding */
/** @typedef {import("../../core/repo-standing.js").CommitLine} CommitLine */

/** @param {string} out @returns {CommitLine[]} */
const commitsOf = (out) =>
  String(out || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [short, date, ...subject] = line.split("\t");
      return { short, date, subject: subject.join("\t") };
    });

/** How long one other worktree's read is waited on: a slow one is named as git listed it, and the rest stand. */
const SIBLING_MS = 2000;

/**
 * A read, or `late` once `ms` pass without its answer.
 * @template T, L @param {Promise<T>} work @param {number} ms @param {L} late @returns {Promise<T | L>}
 */
function within(work, ms, late) {
  /** @type {any} */
  let timer = null;
  const timeout = new Promise((done) => {
    timer = setTimeout(() => done(late), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The repository a folder works in, read whole once; null where the folder is in no repository, git could not read it,
 * or the fence refuses it. `commits`, `own` and `worktrees`: how many of each are read at most. `refusedOf`: why the
 * fence refuses a folder, or null, now or once it has looked (one on a share that does not answer, off the server's
 * thread) — another worktree it refuses is named as git listed it, never read (GWC-89).
 * `siblingMs`: how long each other worktree is waited on.
 * @param {string} folder
 * @param {{ commits?: number, own?: number, worktrees?: number, refusedOf?: (path: string) => string | null | Promise<string | null>, siblingMs?: number }} [o]
 * @returns {Promise<RepoStanding | null>}
 */
export async function repoStandingOf(folder, { commits = 30, own = 10, worktrees = 6, refusedOf = () => null, siblingMs = SIBLING_MS } = {}) {
  if (await refusedOf(folder)) return null;
  const info = await placeInfo(folder, { whole: true });
  if (!info.ok || !info.place) return null;
  const place = info.place;
  const [base, list] = await Promise.all([baseOf(place), worktreesOf(place)]);
  const others = list.ok ? list.worktrees.filter((w) => normalizeCwd(w.path) !== normalizeCwd(place)) : [];
  /** One other worktree, read within its time; as git listed it where it was not read, and why. @param {import("./places.js").Worktree} w */
  const sibling = async (w) => {
    const listed = { path: w.path, main: !!w.main, branch: w.branch, head: w.head ? w.head.slice(0, 9) : null, onBase: false, ahead: null, behind: null, fresh: false, uncommitted: null };
    const p = await within(Promise.resolve(refusedOf(w.path)).then((refused) => readWorktree(w, { refused })), siblingMs, null);
    if (!p) return { ...listed, missing: false, unread: "git did not answer in time" };
    if (p.missing) return { ...listed, missing: true, unread: null };
    if (p.refused || !p.ok) return { ...listed, missing: false, unread: p.error || "git could not read it" };
    return { path: p.path, main: p.main, branch: p.branch, head: p.head, onBase: !!p.onBase, ahead: p.ahead ?? null, behind: p.behind ?? null, fresh: !!p.fresh, uncommitted: p.uncommitted ?? null, missing: false, unread: null };
  };
  const [log, mine, at, read] = await Promise.all([
    info.head ? git(["log", "--first-parent", `--max-count=${commits}`, LOG_FORMAT, base ? base.ref : "HEAD", "--"], { cwd: place }) : null,
    base && info.ahead ? git(["log", `--max-count=${own}`, LOG_FORMAT, `${base.ref}..HEAD`, "--"], { cwd: place }) : null,
    base ? git(["rev-parse", "-q", "--verify", "--short", base.ref], { cwd: place }) : null,
    Promise.all(others.slice(0, worktrees).map(sibling)),
  ]);
  return {
    place,
    main: info.main,
    worktree: info.worktree,
    branch: info.branch,
    head: info.head,
    base: info.base ?? null,
    baseHead: at?.code === 0 && at.out ? at.out : null,
    onBase: !!info.onBase,
    ahead: info.ahead ?? null,
    behind: info.behind ?? null,
    fresh: !!info.fresh,
    uncommitted: info.uncommitted ?? null,
    worktrees: read,
    moreWorktrees: Math.max(0, others.length - worktrees),
    own: mine?.code === 0 ? commitsOf(mine.out) : [],
    commits: log?.code === 0 ? commitsOf(log.out) : [],
  };
}
