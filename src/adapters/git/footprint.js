// @ts-check
// Filament's footprint in a repository (the footprint plan, Phase 7): what it reads of git and of the disk there beside
// its copies (worktree.js `copiesOf`) — its refs under `refs/filament/`, each with its commit, that commit's tree and its
// time; how much disk a folder takes, read within a budget of time and entries; the branches it made for its routines'
// runs, with the worktree each is checked out in, what is uncommitted there and what each holds its base lacks — and the
// writes the person's Clean up makes, on their press only (GW-D1): refs dropped, every group in one step where each
// still points where it was read, else group by group; a branch dropped the same way. Every write runs without the repository's hooks
// (GW-D11), as Put back's. No git, no repository: answered in words, never thrown.
import { existsSync } from "node:fs";
import { opendir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { fewAtOnce } from "../../core/at-once.js";
import { REF_PREFIX } from "../../core/footprint.js";
import { normalizeCwd } from "../../core/project-id.js";
import { firstLine, git, gitWithoutHooks, repoOf } from "./snapshot.js";
import { NO_LOCKS, baseOf, parsePorcelainV2 } from "./inspect.js";
import { worktreesOf } from "./places.js";

/** The files one folder's measure lstats at once. */
const LSTATS_AT_ONCE = 32;
/** What each ref read under `refs/filament/` says: its name, its commit, that commit's tree and its committer's time. */
const REF_FORMAT = "--format=%(refname)%09%(objectname)%09%(tree)%09%(committerdate:unix)";
/** The refs one part of a read past what one git answer holds asks for at most: well inside that answer. */
const REFS_A_PART = 30_000;
/** The characters of the names one part asks for at most: well inside what a command line takes on Windows. */
const NAMES_A_PART = 20_000;

/**
 * The git folder a folder's repository shares among its worktrees, as one key whichever of them asks (`normalizeCwd`);
 * null where the folder is in none.
 * @param {string} folder
 */
export async function gitCommonOf(folder) {
  if (!folder || !existsSync(folder)) return null;
  const r = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder });
  return r.code === 0 && r.out ? normalizeCwd(r.out.split(/\r?\n/)[0]) : null;
}

/** git's refusal of a read, in its first line. @param {{ code: number, err: string, error: string | null }} r */
const refused = (r) => firstLine(r.err || r.error || `git for-each-ref exited ${r.code}`);

/**
 * The `REF_FORMAT` lines of a repository's refs under `refs/filament/`. One read, where git's answer fits what one read
 * holds; past it, the names alone — a third of the size — and then the refs a part at a time, each part asking for its
 * owners' folders by name (`refs/filament/<kind>/<owner>`, which git matches whole or up to a slash; a ref's name holds
 * no `*`, `?` or `[`, so a name is never read as a pattern). Refused in words past what the names' read holds.
 * @param {string} repo
 * @returns {Promise<{ ok: true, lines: string[] } | { ok: false, error: string }>}
 */
async function refLines(repo) {
  const whole = await git(["for-each-ref", REF_FORMAT, REF_PREFIX], { cwd: repo });
  if (!whole.cut) return whole.code === 0 ? { ok: true, lines: whole.out ? whole.out.split(/\r?\n/) : [] } : { ok: false, error: refused(whole) };
  const names = await git(["for-each-ref", "--format=%(refname)", REF_PREFIX], { cwd: repo });
  if (names.cut) return { ok: false, error: "git names more refs under refs/filament/ than Filament reads" };
  if (names.code !== 0) return { ok: false, error: refused(names) };
  /** Each owner's folder (`refs/filament/<kind>/<owner>`, or a shorter name whole), with how many refs it holds. @type {Map<string, number>} */
  const owners = new Map();
  for (const n of names.out.split(/\r?\n/).filter(Boolean)) {
    const at = n.split("/").slice(0, 4).join("/");
    owners.set(at, (owners.get(at) || 0) + 1);
  }
  /** @type {string[][]} */
  const parts = [[]];
  let refs = 0;
  let chars = 0;
  for (const [at, n] of owners) {
    if (parts[parts.length - 1].length && (refs + n > REFS_A_PART || chars + at.length > NAMES_A_PART)) {
      parts.push([]);
      refs = 0;
      chars = 0;
    }
    parts[parts.length - 1].push(at);
    refs += n;
    chars += at.length + 1;
  }
  /** @type {string[]} */
  const lines = [];
  for (const part of parts) {
    const r = await git(["for-each-ref", REF_FORMAT, ...part], { cwd: repo });
    if (r.cut || r.code !== 0) return { ok: false, error: r.cut ? "git named more refs in one part than Filament reads" : refused(r) };
    if (r.out) lines.push(...r.out.split(/\r?\n/));
  }
  return { ok: true, lines };
}

/**
 * A repository's refs under `refs/filament/`, each with its commit, that commit's tree (null where it names no commit)
 * and its committer's time in seconds. `repo`: its top folder, where the writes run. Past what one git answer holds,
 * read a part at a time (`refLines`).
 * @param {string} folder
 * @returns {Promise<{ ok: true, repo: string, refs: import("../../core/footprint.js").RefRead[] } | { ok: false, error: string }>}
 */
export async function filamentRefs(folder) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error };
  const read = await refLines(found.repo);
  if (!read.ok) return read;
  const refs = read.lines
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 2 && p[0].startsWith(REF_PREFIX))
    .map(([ref, commit, tree, date]) => ({ ref, commit, tree: tree || null, date: /^\d+$/.test(date || "") ? Number(date) : null }));
  return { ok: true, repo: found.repo, refs };
}

/**
 * @typedef {{ until: number, entries: number }} Budget  what a measure may still spend: until when, and how many
 *   entries; spent as it reads, shared by every folder one read measures
 */

/**
 * How many bytes a folder's files take, read within `budget`: links are counted as links, never followed — a copy's
 * linked `node_modules` is the main folder's. `partial`: the budget ran out first, so it is at least `bytes`.
 * @param {string} dir @param {Budget} budget
 * @returns {Promise<{ bytes: number, partial: boolean }>}
 */
export async function folderBytes(dir, budget) {
  let bytes = 0;
  let partial = false;
  /** @type {string[]} */
  const todo = [dir];
  while (todo.length) {
    if (Date.now() > budget.until || budget.entries <= 0) {
      partial = true;
      break;
    }
    const at = /** @type {string} */ (todo.pop());
    /** @type {string[]} */
    const files = [];
    try {
      const d = await opendir(at);
      for await (const e of d) {
        budget.entries--;
        if (e.isDirectory()) todo.push(join(at, e.name));
        else if (e.isFile()) files.push(join(at, e.name));
      }
    } catch {
      // A folder that went, or one it may not read: what it holds is not counted.
      continue;
    }
    for (let i = 0; i < files.length; i += LSTATS_AT_ONCE) {
      const sizes = await Promise.all(files.slice(i, i + LSTATS_AT_ONCE).map((f) => lstat(f).then((s) => s.size, () => 0)));
      bytes += sizes.reduce((n, s) => n + s, 0);
    }
  }
  return { bytes, partial };
}

/**
 * The branches of a repository Filament made for its routines' runs, as `routineOf` tells them by name (the branch's
 * routine's title, or null for any other): each with its commit, the worktree it is checked out in and how many files are
 * uncommitted there, the base branch it is compared with and how many commits it holds that base lacks — a few branches
 * read at once (`fewAtOnce`).
 * @param {string} folder @param {(branch: string) => string | null} routineOf
 * @returns {Promise<{ ok: true, branches: import("../../core/footprint.js").BranchFact[] } | { ok: false, error: string }>}
 */
export async function routineBranches(folder, routineOf) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error };
  const repo = found.repo;
  const heads = await git(["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/heads/"], { cwd: repo });
  if (heads.code !== 0) return { ok: false, error: firstLine(heads.err || heads.error || `git for-each-ref exited ${heads.code}`) };
  const mine = heads.out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .map(([ref, commit]) => ({ name: ref.replace(/^refs\/heads\//, ""), commit, routine: routineOf(ref.replace(/^refs\/heads\//, "")) }))
    .filter((b) => b.routine);
  if (!mine.length) return { ok: true, branches: [] };
  const [wt, base] = await Promise.all([worktreesOf(repo), baseOf(repo)]);
  if (!wt.ok) return { ok: false, error: String(wt.error) };
  const where = new Map(wt.worktrees.filter((w) => w.branch).map((w) => [w.branch, w.path]));
  const branches = await fewAtOnce(mine, async (b) => {
    const worktree = where.get(b.name) || null;
    const ahead = base ? await git(["rev-list", "--count", `${base.ref}..refs/heads/${b.name}`], { cwd: repo }) : null;
    const st = worktree ? await git([...NO_LOCKS, "status", "--porcelain=v2", "-z", "--untracked-files=all"], { cwd: worktree }) : null;
    return {
      name: b.name,
      routine: String(b.routine),
      commit: b.commit,
      worktree,
      uncommitted: st && st.code === 0 ? parsePorcelainV2(st.out).files.filter((f) => f.kind !== "ignored").length : null,
      base: base?.name ?? null,
      ahead: ahead && ahead.code === 0 && /^\d+$/.test(ahead.out) ? Number(ahead.out) : null,
    };
  });
  return { ok: true, branches };
}

/**
 * Refs dropped in one step, each only where it still points at the commit it was read at — `git update-ref --stdin`
 * takes all of them or none —, without the repository's hooks. Else git's words.
 * @param {string} repo @param {{ ref: string, commit: string }[]} refs
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function dropRefs(repo, refs) {
  if (!refs.length) return { ok: true };
  const input = refs.map((r) => `delete ${r.ref} ${r.commit}\n`).join("");
  const r = await gitWithoutHooks(["update-ref", "--stdin"], { cwd: repo, input });
  return r.code === 0 ? { ok: true } : { ok: false, error: firstLine(r.err || r.error || `git update-ref exited ${r.code}`) };
}

/**
 * Groups of refs dropped, each whole or not at all, in one transaction where every ref still points where it was read
 * — one `git update-ref --stdin`, one rewrite of the packed refs, however many groups. git takes a transaction whole or
 * none of it: where any ref moved, nothing went, and each group is dropped again on its own (`dropRefs`), so only those
 * with a ref that moved stay. Each group's answer, in its order.
 * @param {string} repo @param {{ ref: string, commit: string }[][]} groups
 * @returns {Promise<({ ok: true } | { ok: false, error: string })[]>}
 */
export async function dropRefGroups(repo, groups) {
  const all = await dropRefs(repo, groups.flat());
  if (all.ok || groups.length < 2) return groups.map(() => all);
  /** @type {({ ok: true } | { ok: false, error: string })[]} */
  const out = [];
  for (const g of groups) out.push(await dropRefs(repo, g));
  return out;
}

/**
 * A branch dropped, only where it still points at the commit it was read at and no worktree has it checked out now —
 * the worktrees read again first —, without the repository's hooks. Else why, in words.
 * @param {string} repo @param {{ name: string, commit: string }} b
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function dropBranch(repo, { name, commit }) {
  const wt = await worktreesOf(repo);
  if (!wt.ok) return { ok: false, error: String(wt.error) };
  if (wt.worktrees.some((w) => w.branch === name)) return { ok: false, error: "a worktree has it checked out now" };
  const r = await gitWithoutHooks(["update-ref", "-d", `refs/heads/${name}`, commit], { cwd: repo });
  return r.code === 0 ? { ok: true } : { ok: false, error: firstLine(r.err || r.error || `git update-ref exited ${r.code}`) };
}
