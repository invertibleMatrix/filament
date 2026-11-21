// @ts-check
// What the agents' hands changed, read back from the snapshots (harness plan B2, HarnessV4_Git_Plan step 1). Each
// writing round of a turn is kept per place and per agent (turn-tree.js): the place's snapshot before it, the one
// after, and the files the agent's own calls named. An agent's changes are its own files, each from before the first
// round that named it to after the last — never what someone else changed in the place meanwhile, which only shows
// as a mark on a file of its own, or under what changed while one of its commands ran. Everything here is read-only
// git on each place: names, counts and, only when asked, the patch — clipped, with the cut said.
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fewAtOnce } from "../../core/at-once.js";
import { firstLine, git, repoOf, snapshotTree } from "./snapshot.js";

/** git's well-known empty tree: the base for a snapshot that has no parent (a repository that had no HEAD yet). */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const MAX_PATCH_LINES = 2000;
/** What a place's read says when its folder is not there. */
export const FOLDER_GONE = "the folder is gone";
/** The files one git call names at most: a long list goes in parts, under Windows' command-line limit. */
const PATHS_PER_CALL = 100;
/** git's status letters in words. */
export const STATUS_WORDS = Object.freeze(/** @type {Record<string, string>} */ ({ A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "typechange", U: "unmerged" }));

/**
 * @typedef {object} FileChange
 * @property {string} path  repository-relative, forward slashes (git's own spelling)
 * @property {string | null} oldPath  the source of a rename or copy
 * @property {string} status  added | modified | deleted | renamed | copied | typechange | unmerged | the raw letter
 * @property {number} added  lines; 0 for a binary file
 * @property {number} removed
 * @property {boolean} binary
 * @property {string} [patch]  the unified diff, when asked for (clipped)
 * @property {boolean} [truncated]  the patch was cut at the line cap
 * @property {number} [lines]  the patch's full line count
 * @property {number} [size]  a binary file's bytes, when the patches are asked for: its diff is none
 */

/**
 * `git diff --name-status -z` → [{ path, oldPath, status }]. Entries are NUL-separated: the status (with a
 * similarity score after R and C), the path, and for R/C the new path as well.
 * @param {string} z
 */
export function parseNameStatus(z) {
  const parts = String(z || "").split("\0");
  /** @type {Array<{ path: string, oldPath: string | null, status: string }>} */
  const out = [];
  for (let i = 0; i < parts.length; ) {
    const st = parts[i++];
    if (!st) continue;
    const letter = st[0];
    const status = STATUS_WORDS[letter] || letter;
    if (letter === "R" || letter === "C") {
      const oldPath = parts[i++] ?? "";
      const path = parts[i++] ?? "";
      if (path) out.push({ path, oldPath, status });
    } else {
      const path = parts[i++] ?? "";
      if (path) out.push({ path, oldPath: null, status });
    }
  }
  return out;
}

/**
 * `git diff --numstat -z` → path → { added, removed, binary }. A line is "added<TAB>removed<TAB>path", `-` for a
 * binary file; a rename or copy leaves the path empty and follows with the old and the new path as two NUL fields.
 * @param {string} z
 */
export function parseNumstat(z) {
  const parts = String(z || "").split("\0");
  /** @type {Map<string, { added: number, removed: number, binary: boolean }>} */
  const out = new Map();
  for (let i = 0; i < parts.length; ) {
    const line = parts[i++];
    if (!line) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(line);
    if (!m) continue;
    const binary = m[1] === "-";
    let path = m[3];
    if (!path) {
      i++; // the old path of a rename
      path = parts[i++] ?? "";
    }
    if (path) out.set(path, { added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary });
  }
  return out;
}

/** A raw entry's head, `-z`: the modes, the objects and the status (a rename's or a copy's with its score). */
const RAW_HEAD = /^:[0-7]{6} [0-7]{6} [0-9a-f]+ [0-9a-f]+ ([A-Z][0-9]*)$/;

/**
 * `git diff --raw --numstat -z` → the names as `parseNameStatus` reads `--name-status`, and the counts as `parseNumstat`
 * reads `--numstat`: git writes every raw entry, then every count. Null where the output is not that, entry by entry,
 * to its end — the caller asks the two apart.
 * @param {string} z
 * @returns {{ names: ReturnType<typeof parseNameStatus>, counts: ReturnType<typeof parseNumstat> } | null}
 */
export function parseRawNumstat(z) {
  const parts = String(z || "").split("\0");
  /** @type {ReturnType<typeof parseNameStatus>} */
  const names = [];
  /** @type {ReturnType<typeof parseNumstat>} */
  const counts = new Map();
  let i = 0;
  for (let m; i < parts.length && (m = RAW_HEAD.exec(parts[i])); ) {
    i++;
    const letter = m[1][0];
    const status = STATUS_WORDS[letter] || letter;
    const oldPath = letter === "R" || letter === "C" ? (parts[i++] ?? "") : null;
    const path = parts[i++] ?? "";
    if (path) names.push({ path, oldPath, status });
  }
  for (; i < parts.length; ) {
    const line = parts[i++];
    if (!line) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(line);
    if (!m) return null;
    const binary = m[1] === "-";
    let path = m[3];
    if (!path) {
      i++; // the old path of a rename
      path = parts[i++] ?? "";
    }
    if (path) counts.set(path, { added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary });
  }
  return { names, counts };
}

/**
 * How a diff from `base` is asked of git: between two commits, or — `head` null — against the working tree through
 * the plumbing, since the porcelain `git diff` rewrites the index there (HarnessV4_Git_Plan GW-D23, GW-D31).
 * @param {string | null} base @param {string | null} head @param {string[]} how  the diff's own options
 */
const diffArgs = (base, head, how) => (head ? ["diff", ...how, base || EMPTY_TREE, head] : ["diff-index", ...how, base || EMPTY_TREE]);

/**
 * The files that differ between two commits; `base` null means the empty tree (a root snapshot), and `head` null the
 * working tree as it stands, of the files git tracks. Against the working tree a file whose time alone changed is in
 * the plumbing's names but not in its counts, which compare the content: it is no change. `paths` narrows the list
 * to those repository-relative files. `renames: false` pairs no deleted file with an added one: each file is listed
 * as a diff of it alone lists it, however many are asked together (`diffsOf`).
 * @param {string} repo @param {string | null} base @param {string | null} head @param {{ paths?: string[] | null, renames?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, files: FileChange[], error: string | null }>}
 */
export async function diffFiles(repo, base, head, { paths = null, renames = true } = {}) {
  const parts = paths ? chunks(paths, PATHS_PER_CALL) : [null];
  const pairing = renames ? "-M" : "--no-renames";
  /** @type {FileChange[]} */
  const files = [];
  let untold = false;
  for (const part of parts) {
    const tail = part ? ["--", ...part] : [];
    // The names and the counts of one diff from one process (a turn's read asked thousands); where it fails, or says
    // past what a call keeps, each from a process of its own.
    const both = await git([...diffArgs(base, head, ["--raw", "--numstat", "-z", pairing]), ...tail], { cwd: repo });
    let read = both.code === 0 ? parseRawNumstat(both.out) : null;
    if (!read) {
      const ns = await git([...diffArgs(base, head, ["--name-status", "-z", pairing]), ...tail], { cwd: repo });
      if (ns.code !== 0) return { ok: false, files: [], error: firstLine(ns.err || ns.error || `git diff exited ${ns.code}`) };
      const num = await git([...diffArgs(base, head, ["--numstat", "-z", pairing]), ...tail], { cwd: repo });
      if (num.code !== 0 && !head) return { ok: false, files: [], error: firstLine(num.err || num.error || `git diff-index exited ${num.code}`) };
      read = { names: parseNameStatus(ns.out), counts: num.code === 0 ? parseNumstat(num.out) : new Map() };
      untold ||= num.code !== 0;
    }
    const { counts } = read;
    for (const f of read.names) {
      const c = counts.get(f.path);
      if (!c && !head) continue;
      files.push({ ...f, added: c?.added ?? 0, removed: c?.removed ?? 0, binary: c?.binary ?? false });
    }
  }
  const out = { ok: true, files, error: null };
  if (untold) countsUntold.add(out);
  return out;
}

/** The diffs between two commits whose counts git would not give, each file listed with none (`diffFiles`). @type {WeakSet<object>} */
const countsUntold = new WeakSet();

/**
 * How each answer of `ownChangesOf` was read: the time its walk took, and whether it was told less than git knows
 * without saying so — a diff's counts listed as none, a gap between two steps git could not name, its files' marks
 * left off. An answer kept past the process is one read whole, and slow to read again. `served`: the pieces of a
 * hundred paths taken from a place's whole or a span's diff (`wholeOf`); `skipped`: the commands' steps answered from
 * their names alone.
 * @type {WeakMap<object, { ms: number, partly: boolean, served: number, skipped: number }>}
 */
const walks = new WeakMap();
/** How `ownChangesOf` read this answer; null for any other object. @param {object} answer */
export const walkOf = (answer) => walks.get(answer) ?? null;
/**
 * The walk's version, in what an answer kept past the process rests on: moved with any change to how the walk reads
 * git or shapes what it answers (a test pins it to this file's source and to the cuts the routes keep).
 */
export const WALK_VERSION = 3;

/**
 * The names of the files that differ between two commits — no counts: what a mark needs.
 * @param {string} repo @param {string | null} base @param {string} head
 * @returns {Promise<Set<string> | null>}  null where git could not tell
 */
async function namesChanged(repo, base, head) {
  const r = await git(["diff", "--name-only", "-z", "--no-renames", base || EMPTY_TREE, head], { cwd: repo });
  return r.code === 0 ? new Set(r.out.split("\0").filter(Boolean)) : null;
}

/** A commit's id, whole, as git writes it (SHA-1 or SHA-256). */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** The pairs one batched call asks at most: one past what a call keeps is asked again in halves. */
const PAIRS_PER_CALL = 256;
/** @param {string | null} before @param {string} after */
export const pairKey = (before, after) => `${before ?? ""}\n${after}`;

/**
 * `namesChanged` for many pairs of one repository, by `pairKey` (a turn's command rounds asked one git each, 1,253 for
 * TinyQuest's turn 47). Pairs of two commits go to `git diff-tree --stdin`, each line a commit and the one it is read
 * against: the same diff. The rest, and every pair a batch did not answer whole, are asked one by one — a pair from the
 * empty tree, a repository whose diff settings the plumbing does not read (an order file, the porcelain's own ignoring of
 * submodules), an id that is no commit there (a tree read as one would list nothing). `batchOnly`: the batch alone, a
 * lone pair too; a pair it does not answer is left out (`wholeOf`'s links, which only send a read to its own diff).
 * @param {string} repo @param {[string | null, string][]} pairs @param {{ batchOnly?: boolean }} [opts]
 * @returns {Promise<Map<string, Set<string> | null>>}
 */
export async function namesChangedAll(repo, pairs, { batchOnly = false } = {}) {
  /** @type {Map<string, Set<string> | null>} */
  const out = new Map();
  const distinct = [...new Map(pairs.map(([b, a]) => [pairKey(b, a), /** @type {[string | null, string]} */ ([b, a])])).values()];
  const whole = /** @type {[string, string][]} */ (distinct.filter(([b, a]) => b && OBJECT_ID.test(b) && OBJECT_ID.test(a)));
  if (whole.length > (batchOnly ? 0 : 1) && (await readsAlike(repo))) {
    const commits = await commitsOf(repo, whole.flat());
    await namesBatched(repo, whole.filter(([b, a]) => commits.has(b) && commits.has(a)), out, batchOnly);
  }
  if (batchOnly) return out;
  const rest = distinct.filter(([b, a]) => !out.has(pairKey(b, a)));
  const got = await fewAtOnce(rest, ([b, a]) => namesChanged(repo, b, a));
  rest.forEach(([b, a], i) => out.set(pairKey(b, a), got[i]));
  return out;
}

/**
 * Whether `git diff-tree` names a repository's changes as `git diff` does: the porcelain reads `diff.orderFile` (the
 * names' order) and `diff.ignoreSubmodules`, the plumbing neither. A submodule's own `ignore`, in `.gitmodules` or the
 * configuration, both read; one in the configuration is asked one by one all the same.
 * @param {string} repo
 */
async function readsAlike(repo) {
  const r = await git(["config", "--get-regexp", "^(diff\\.(orderfile|ignoresubmodules)|submodule\\..*\\.ignore)$"], { cwd: repo });
  return r.code === 1 && !r.out;
}

/** The ids among `ids` that are commits in the repository, in one ask. @param {string} repo @param {string[]} ids */
async function commitsOf(repo, ids) {
  const r = await git(["cat-file", "--batch-check=%(objectname) %(objecttype)"], { cwd: repo, input: `${[...new Set(ids)].join("\n")}\n` });
  /** @type {Set<string>} */
  const commits = new Set();
  if (r.code !== 0) return commits;
  for (const line of r.out.split("\n")) {
    const [id, type] = line.split(" ");
    if (type === "commit") commits.add(id);
  }
  return commits;
}

/**
 * Each pair's names from `git diff-tree --stdin`, into `out`: a pair's are the paths after its line's header (the
 * commit's id) up to the next pair's. A batch git refuses, or whose answer is cut, is asked again in halves; one that
 * timed out or did not start, or whose headers are not each pair's in order, or whose paths hold one of its ids, answers
 * none of its pairs. A lone pair is left to be asked one by one, unless `lone`: the batch is all that is asked.
 * @param {string} repo @param {[string, string][]} pairs @param {Map<string, Set<string> | null>} out @param {boolean} [lone]
 */
async function namesBatched(repo, pairs, out, lone = false) {
  if (pairs.length > PAIRS_PER_CALL) {
    for (let i = 0; i < pairs.length; i += PAIRS_PER_CALL) await namesBatched(repo, pairs.slice(i, i + PAIRS_PER_CALL), out, lone);
    return;
  }
  if (pairs.length < (lone ? 1 : 2)) return;
  const r = await git(["diff-tree", "--stdin", "--always", "-r", "-z", "--name-only", "--no-renames"], { cwd: repo, input: pairs.map(([b, a]) => `${a} ${b}\n`).join("") });
  if (r.code !== 0) {
    // A timeout, a git that did not start: its halves would fare no better; a lone pair has none.
    if ((r.code < 0 && !r.cut) || pairs.length < 2) return;
    const half = Math.ceil(pairs.length / 2);
    await namesBatched(repo, pairs.slice(0, half), out, lone);
    await namesBatched(repo, pairs.slice(half), out, lone);
    return;
  }
  const sets = batchNames(r.out, pairs);
  if (sets) pairs.forEach(([b, a], k) => out.set(pairKey(b, a), sets[k]));
}

/**
 * A batch's output (`diff-tree --stdin -z --name-only`) → each pair's names, in the pairs' order: the paths after its
 * header up to the next pair's. Null where a header is missing (git skips a line it cannot read and says nothing) or out
 * of order, or a path is one of the pairs' ids: no pair of it is told.
 * @param {string} z @param {[string, string][]} pairs
 * @returns {Set<string>[] | null}
 */
export function batchNames(z, pairs) {
  const parts = z.split("\0").filter(Boolean);
  const ids = new Set(pairs.map(([, a]) => a));
  /** @type {Set<string>[]} */
  const sets = [];
  let at = 0;
  for (let k = 0; k < pairs.length; k++) {
    if (parts[at] !== pairs[k][1]) return null;
    at++;
    const next = k + 1 < pairs.length ? pairs[k + 1][1] : null;
    /** @type {Set<string>} */
    const names = new Set();
    for (; at < parts.length && parts[at] !== next; at++) {
      if (ids.has(parts[at])) return null;
      names.add(parts[at]);
    }
    sets.push(names);
  }
  return sets;
}

/**
 * One file's unified diff between two commits (`head` null: the working tree), clipped at `maxLines` with the cut
 * said in `truncated`. A renamed file needs both its paths for git to show the rename rather than an addition. One
 * past what a git call says (`git`'s `cut`) ends where git was stopped, cut the same; its whole count, `lines`, is not
 * known then: 0.
 * @param {string} repo @param {string | null} base @param {string | null} head @param {string | string[]} paths
 * @param {{ maxLines?: number }} [opts]
 * @returns {Promise<{ patch: string, truncated: boolean, lines: number }>}
 */
export async function diffPatch(repo, base, head, paths, { maxLines = MAX_PATCH_LINES } = {}) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  const r = await git([...diffArgs(base, head, ["-p", "-M", "--no-color", "--no-ext-diff"]), "--", ...list], { cwd: repo });
  if (r.code !== 0 && !r.cut) return { patch: "", truncated: false, lines: 0 };
  const lines = r.out.split("\n");
  // Where git was stopped may be within a line: that line goes.
  if (r.cut) lines.pop();
  const cut = !!r.cut || lines.length > maxLines;
  return { patch: (cut ? lines.slice(0, maxLines) : lines).join("\n"), truncated: cut, lines: r.cut ? 0 : lines.length };
}

/**
 * @typedef {import("../../core/types.js").RoundChange} RoundChange
 * @typedef {FileChange & { place: string, agent: string, from: string | null, also?: true, via?: "command" }} OwnFile
 *   an agent's own file in a place; `from`: the snapshot its change is read from, taken before the first round that
 *   named it (null: the empty tree); `also`: someone else changed it too, between the first round that named it and
 *   the last; `via`: its commands changed it and its calls never named it — in a place only its chat works in
 *   (HarnessV4_Git_Plan GW-D57)
 * @typedef {FileChange & { place: string, agent: string, round: number | null, turn?: number }} DuringFile  a file that
 *   changed while one of an agent's commands ran: its own command's, or anyone's — Filament cannot tell
 * @typedef {object} OwnChanges
 * @property {OwnFile[]} files  each agent's own files, once per place, net from before its first change to after its last
 * @property {{ files: number, added: number, removed: number }} totals  of `files`
 * @property {DuringFile[]} during  what else changed while its commands ran, by the round it changed in
 * @property {{ agent: string, path: string }[]} outside  files written outside any repository, by their path: no diff
 * @property {{ place: string, start: RoundChange["base"] }[]} places  each place written in, in the order first seen,
 *   with what its first round started from: a snapshot just before it, its previous one, or its last commit (GWC-10)
 * @property {{ place: string, error: string }[]} errors  a place git could not read, in words
 */

/**
 * The turns that changed files, newest first, from their writing rounds alone: the one read here with no git, so a
 * chat of many turns answers at once (the Changes pane's History; the owner's words of 10-18 on the whole chat's
 * read: "first it took ages to load the changes and there were so many"). Per turn: `files`, what its agents' own
 * write and edit calls named in a repository, each once per place; `outside`, what they named outside any
 * repository; `commands`, a place changed while one of its commands ran. What each file came to, net, is the turn's
 * own read (`ownChangesOf`). A move's rounds are the chat's, never a turn's (GW-D88).
 * @param {RoundChange[]} rounds  the chain's, each with its `turn`
 * @returns {{ n: number, files: number, outside: number, commands: boolean }[]}
 */
export function turnsChanged(rounds) {
  /** @type {Map<number, { files: Set<string>, outside: Set<string>, commands: boolean }>} */
  const by = new Map();
  for (const r of rounds) {
    const n = Number(r.turn);
    if (!Number.isInteger(n) || n < 1 || r.base === "move") continue;
    const t = by.get(n) || { files: new Set(), outside: new Set(), commands: false };
    by.set(n, t);
    for (const p of r.own) {
      if (r.place) t.files.add(`${r.place}\n${p}`);
      else t.outside.add(String(p));
    }
    if (r.place && r.command) t.commands = true;
  }
  return [...by]
    .filter(([, t]) => t.files.size || t.outside.size || t.commands)
    .sort((a, b) => b[0] - a[0])
    .map(([n, t]) => ({ n, files: t.files.size, outside: t.outside.size, commands: t.commands }));
}

/**
 * What a turn's — or a chat's — writing rounds changed (HarnessV4_Git_Plan step 1): each agent's own files per place,
 * net from before the first round that named a file to after the last, marked where someone else changed it in
 * between; what changed while its commands ran, apart; and the files written outside any repository, by path.
 * `path` narrows to one file (as git names it in `place`, which it then needs); `patch` adds the diffs, clipped.
 * `alone`: the places only the rounds' chat works in, where what its commands changed is its own (GW-D57). `whole`:
 * when a place's reads are served from one diff of it (`WHOLE_AT`, `wholeOf`).
 * @param {RoundChange[]} rounds  in the order taken
 * @param {{ patch?: boolean, path?: string | null, place?: string | null, maxPatchLines?: number, alone?: Set<string> | null, whole?: WholeAt }} [opts]
 * @returns {Promise<OwnChanges>}
 */
export async function ownChangesOf(rounds, { patch = false, path = null, place: only = null, maxPatchLines = MAX_PATCH_LINES, alone = null, whole = WHOLE_AT } = {}) {
  const t0 = performance.now();
  let partly = false;
  let served = 0;
  let skipped = 0;
  /** @type {OwnChanges} */
  const out = { files: [], totals: { files: 0, added: 0, removed: 0 }, during: [], outside: [], places: [], errors: [] };
  /** @type {Map<string, RoundChange[]>} */
  const byPlace = new Map();
  for (const r of rounds) {
    if (!r.place) {
      for (const p of r.own) if (!out.outside.some((o) => o.agent === r.agent && o.path === p) && (!path || p === path)) out.outside.push({ agent: r.agent, path: p });
      continue;
    }
    byPlace.set(r.place, [...(byPlace.get(r.place) || []), r]);
  }
  for (const [place, rows] of byPlace) {
    out.places.push({ place, start: rows[0].base });
    if (only && place !== only) continue;
    if (!existsSync(place)) {
      out.errors.push({ place, error: FOLDER_GONE });
      continue;
    }
    const read = await placeChanges(place, rows, { patch, path, maxPatchLines, alone: !!alone?.has(place), whole });
    if (read.error) out.errors.push({ place, error: read.error });
    partly ||= read.partly;
    served += read.served;
    skipped += read.skipped;
    out.files.push(...read.files);
    out.during.push(...read.during);
  }
  out.totals = totalsOf(out.files);
  walks.set(out, { ms: performance.now() - t0, partly, served, skipped });
  return out;
}

/**
 * Whether an answer's errors are only places whose folder was already gone when its basis was taken (`gone`, the list
 * the basis holds): such an answer rests on that basis as one with no error does, and may be kept. Any other — git's,
 * or a folder that went while the read ran — is not: it is gone at the next ask, or the next basis tells.
 * @param {{ place?: string | null, error?: string | null }[]} errors @param {readonly string[]} gone
 */
export function onlyGone(errors, gone) {
  return errors.every((e) => e.error === FOLDER_GONE && !!e.place && gone.includes(e.place));
}

/**
 * One place's rounds read: its steps (one per round, which its agents' rows share), each agent's own files over the
 * steps that named them, the marks, and the files its commands' steps changed besides. `alone`: only the rounds' chat
 * works in the place, so what a command changed joins its agent's own files, marked (GW-D57) — in a step that began
 * just before its round, or where the chain last left the place; never one compared with the last commit, which holds
 * whatever was uncommitted before. A place of many reads serves them from one diff of it where it can (`wholeOf`).
 * @param {string} place @param {RoundChange[]} rows
 * @param {{ patch: boolean, path: string | null, maxPatchLines: number, alone: boolean, whole: WholeAt }} o
 * @returns {Promise<{ files: OwnFile[], during: DuringFile[], error: string | null, partly: boolean, served: number, skipped: number }>}
 */
async function placeChanges(place, rows, { patch, path, maxPatchLines, alone, whole }) {
  /** @type {OwnFile[]} */
  const files = [];
  /** @type {DuringFile[]} */
  const during = [];
  /** @type {{ before: string | null, after: string, base: RoundChange["base"], round: number | null, turn?: number, rows: RoundChange[] }[]} */
  const steps = [];
  for (const r of rows) {
    const at = steps.at(-1);
    if (at && at.round === r.round && at.turn === r.turn && at.after === r.after) at.rows.push(r);
    else if (r.after) steps.push({ before: r.before, after: r.after, base: r.base, round: r.round, ...(r.turn != null ? { turn: r.turn } : {}), rows: [r] });
  }
  /** Each agent's own files, by the steps that named them: [first, last]. @type {Map<string, Map<string, [number, number]>>} */
  const spans = new Map();
  steps.forEach((st, s) => {
    for (const r of st.rows) {
      const mine = spans.get(r.agent) || new Map();
      spans.set(r.agent, mine);
      for (const p of r.own) if (!path || p === path) mine.set(p, [mine.get(p)?.[0] ?? s, s]);
    }
  });
  const commands = steps.flatMap((st) => st.rows.filter((r) => r.command).map((r) => ({ st, r })));
  /** @param {{ st: (typeof steps)[number] }} c */
  const credited = (c) => alone && (c.st.base === "round" || c.st.base === "last");
  /** The files each agent's commands changed that its calls never named. @type {Map<string, Set<string>>} */
  const via = new Map();
  /** @type {string | null} */
  let error = null;
  /** Told less than git knows, and not said (`walkOf`). */
  let partly = false;
  let served = 0;
  let skipped = 0;
  const claimed = commands.filter(credited);
  if (claimed.length) {
    const named = new Map([...spans].map(([agent, mine]) => [agent, new Set(mine.keys())]));
    const names = await namesChangedAll(place, claimed.map(({ st }) => [st.before, st.after]));
    const changed = claimed.map(({ st }) => names.get(pairKey(st.before, st.after)) ?? null);
    claimed.forEach(({ st, r }, i) => {
      const got = changed[i];
      if (!got) return void (error ||= "git could not list what its commands changed");
      const s = steps.indexOf(st);
      // A file another agent's call named in that round is that agent's.
      const others = new Set(st.rows.filter((x) => x.agent !== r.agent).flatMap((x) => x.own));
      const mine = spans.get(r.agent) || new Map();
      spans.set(r.agent, mine);
      for (const p of got) {
        if ((path && p !== path) || others.has(p)) continue;
        const span = mine.get(p);
        mine.set(p, [Math.min(span?.[0] ?? s, s), Math.max(span?.[1] ?? s, s)]);
        // Added to the agent's set where it stands: a set made anew for each file cost what the set had grown to, every
        // file of every command — the owner's of 11-17: a turn whose commands touched a build's files held the server
        // 344 s.
        if (!named.get(r.agent)?.has(p)) {
          const theirs = via.get(r.agent);
          if (theirs) theirs.add(p);
          else via.set(r.agent, new Set([p]));
        }
      }
    });
  }
  // Each agent's files that share a span are read in one diff; a long chat has a span per turn.
  /** @type {{ agent: string, a: number, b: number, paths: string[] }[]} */
  const reads = [];
  for (const [agent, mine] of spans) {
    /** @type {Map<string, string[]>} */
    const bySpan = new Map();
    for (const [p, [a, b]] of mine) {
      const paths = bySpan.get(`${a}:${b}`);
      if (paths) paths.push(p);
      else bySpan.set(`${a}:${b}`, [p]);
    }
    for (const [key, paths] of bySpan) {
      const [a, b] = key.split(":").map(Number);
      reads.push({ agent, a, b, paths });
    }
  }
  const unclaimed = commands.filter((c) => !credited(c));
  // A place of many reads names every link of its chain, and the spans of its reads of many paths, in one batch: what
  // its whole diff serves them from (`wholeOf`), and what its commands' steps changed. Not where git reads a path in
  // any case, nor where a step began from nothing: its whole would count the repository.
  const pieces = reads.reduce((t, r) => t + Math.ceil(r.paths.length / PATHS_PER_CALL), 0);
  const links =
    !path && pieces >= whole.pieces && !process.env.GIT_ICASE_PATHSPECS && steps.every((st) => !!st.before)
      ? await namesChangedAll(place, [...linksOf(steps), ...reads.filter((r) => r.paths.length > PATHS_PER_CALL).map((r) => /** @type {[string | null, string]} */ ([steps[r.a].before, steps[r.b].after]))], { batchOnly: true })
      : null;
  const plan = links ? await wholeOf(place, steps, reads, links, whole.served) : null;
  // What changed between two steps, where the later one was taken just before its round: someone else's.
  /** @param {(typeof steps)[number]} st @param {number} s */
  const gapAfter = (st, s) => s > 0 && st.base === "round" && !!st.before && st.before !== steps[s - 1].after;
  // Every read a few at a time — a long chat's are many, each a git call — and what they found taken in order.
  const [gapNames, own, ran] = await Promise.all([
    namesChangedAll(place, steps.flatMap((st, s) => (gapAfter(st, s) ? [/** @type {[string | null, string]} */ ([steps[s - 1].after, String(st.before)])] : []))),
    fewAtOnce(reads, async (rd) => {
      const { a, b, paths } = rd;
      const parts = plan ? await plan(rd) : null;
      served += parts ? parts.filter((x) => x.files).length : 0;
      const d = parts ? await piecewise(place, steps[a].before, steps[b].after, parts) : await diffFiles(place, steps[a].before, steps[b].after, { paths });
      if (countsUntold.has(d)) partly = true;
      return d.ok ? { files: patch ? await withPatches(place, steps[a].before, steps[b].after, d.files, maxPatchLines) : d.files, error: null } : { files: [], error: d.error };
    }),
    fewAtOnce(unclaimed, async ({ st, r }) => {
      // Every file its step changed is its agent's own: nothing else changed while it ran.
      const told = links?.get(pairKey(st.before, st.after));
      const mine = spans.get(r.agent) || new Map();
      if (told && [...told].every((p) => mine.has(p))) {
        skipped++;
        return { files: [], error: null };
      }
      const d = await diffFiles(place, st.before, st.after, path ? { paths: [path] } : {});
      if (!d.ok) return { files: [], error: d.error };
      if (countsUntold.has(d)) partly = true;
      const rest = d.files.filter((f) => !mine.has(f.path));
      return { files: patch ? await withPatches(place, st.before, st.after, rest, maxPatchLines) : rest, error: null };
    }),
  ]);
  /** Each step's gap: what changed before it, none where it began where the step before ended, null where git could not tell. */
  const gaps = steps.map((st, s) => (gapAfter(st, s) ? gapNames.get(pairKey(steps[s - 1].after, String(st.before))) ?? null : new Set()));
  if (gaps.includes(null)) partly = true;
  reads.forEach(({ agent, a, b }, i) => {
    error ||= own[i].error;
    for (const f of own[i].files) {
      // Another agent's call named it, or it changed between two of the steps: before the first, it was no one's yet.
      const others = (/** @type {number} */ s) => steps[s].rows.some((r) => r.agent !== agent && r.own.includes(f.path));
      let also = false;
      for (let s = a; s <= b && !also; s++) also = others(s) || (s > a && !!gaps[s]?.has(f.path));
      const byCommand = !!via.get(agent)?.has(f.path);
      files.push({ ...f, place, agent, from: steps[a].before, ...(also ? { also: /** @type {const} */ (true) } : {}), ...(byCommand ? { via: /** @type {const} */ ("command") } : {}) });
    }
  });
  unclaimed.forEach(({ st, r }, i) => {
    error ||= ran[i].error;
    for (const f of ran[i].files) during.push({ ...f, place, agent: r.agent, round: st.round, ...(st.turn != null ? { turn: st.turn } : {}) });
  });
  return { files, during, error, partly, served, skipped };
}

/**
 * @typedef {{ pieces: number, served: number }} WholeAt  when a place's reads are served from one diff of it: they take
 *   `pieces` pieces of a hundred paths at least, and that diff (or their spans') could serve `served` of them
 */
/**
 * When a place's whole is read (`wholeOf`). Below it, the place's own diffs, a few at a time, cost less than the batch,
 * the check and the whole taken one after another: a place of a few dozen pieces, or one whose agents took turns on its
 * files (each a span of its own, which the whole cannot serve).
 */
export const WHOLE_AT = Object.freeze({ pieces: 64, served: 24 });
/** What a whole or a span's diff may list at most, by the names its pair holds: past it, the reads as they are. */
const WHOLE_BYTES_MOST = 6 * 1024 * 1024;
/** A whole or a span's diff that takes longer is given up for the reads as they are. */
const WHOLE_TIMEOUT_MS = 15_000;

/**
 * Every link of a place's chain — each step, and before it the gap where it did not begin where the one before ended —
 * and the chain whole, whose names say what its diff would list.
 * @param {{ before: string | null, after: string }[]} steps
 * @returns {[string | null, string][]}
 */
const linksOf = (steps) => [
  ...steps.flatMap((st, s) => [
    ...(s > 0 && st.before && st.before !== steps[s - 1].after ? [/** @type {[string, string]} */ ([steps[s - 1].after, st.before])] : []),
    /** @type {[string | null, string]} */ ([st.before, st.after]),
  ]),
  ...(steps.length ? [/** @type {[string | null, string]} */ ([steps[0].before, steps[steps.length - 1].after])] : []),
];

/** About what a diff's raw and numstat entries take for these names, `-z`, ids of 40. @param {Iterable<string>} names */
const bytesOf = (names) => {
  let n = 0;
  for (const p of names) n += 110 + 2 * Buffer.byteLength(p);
  return n;
};

/**
 * Whether one diff listing `listed` serves reads of `own` paths for less than their own diffs: not past what a call
 * keeps, nor far past them (a branch switched, a build in a folder others work in, files made and removed meanwhile).
 * @param {Set<string> | null | undefined} listed @param {number} own
 */
const worthReading = (listed, own) => !!listed && bytesOf(listed) <= WHOLE_BYTES_MOST && listed.size <= Math.max(2000, 4 * own);

/**
 * A read's pieces of a hundred paths, as `diffFiles` asks them, each with its entries where they are known without a
 * diff of its own, or null for that piece's own diff. One diff of the place from before its first step to after its
 * last, porcelain as `diffFiles` and with no renames paired, gives a path the entry its span's diff gives where no link
 * outside the span changed it: its blob and mode are the same at either end. A read of many pieces takes the ones that
 * fail that from one diff of its own span, with no paths. A piece is taken only where its narrowed diff could say no
 * other: none of its paths git reads as more than itself (a pattern, magic, a spelling git's own differs from, a folder
 * of a name the links hold), and not a deletion with an addition, which it could pair as a rename. Null: the place is
 * read as it is — a link the batch did not name, a whole that would list much, fewer pieces it could serve than
 * `least`, a partial clone, a whole that failed.
 * @param {string} place @param {{ before: string | null, after: string }[]} steps
 * @param {{ a: number, b: number, paths: string[] }[]} reads @param {Map<string, Set<string> | null>} links
 * @param {number} least  the pieces it could serve at least
 * @returns {Promise<((rd: { a: number, b: number, paths: string[] }) => Promise<{ paths: string[], files: FileChange[] | null }[]>) | null>}
 */
async function wholeOf(place, steps, reads, links, least) {
  // The first and the last link that changed each path: step s is link 2s, the gap before it 2s - 1, taken in order.
  /** @type {Map<string, [number, number]>} */
  const changedAt = new Map();
  let unknown = false;
  /** @param {Set<string> | null | undefined} set @param {number} at */
  const mark = (set, at) => {
    if (!set) return void (unknown = true);
    for (const p of set) {
      const ats = changedAt.get(p);
      if (ats) ats[1] = at;
      else changedAt.set(p, [at, at]);
    }
  };
  steps.forEach((st, s) => {
    if (s > 0 && st.before !== steps[s - 1].after) mark(links.get(pairKey(steps[s - 1].after, String(st.before))), 2 * s - 1);
    mark(links.get(pairKey(st.before, st.after)), 2 * s);
  });
  if (unknown || !worthReading(links.get(pairKey(steps[0].before, steps[steps.length - 1].after)), new Set(reads.flatMap((r) => r.paths)).size)) return null;
  // Every folder of a name the links hold, which a diff narrowed to it reads whole: a whole's names and a span's are
  // among them.
  /** @type {Set<string>} */
  const dirs = new Set();
  for (const p of changedAt.keys()) for (let i = p.indexOf("/"); i > 0; i = p.indexOf("/", i + 1)) dirs.add(p.slice(0, i));
  /** @param {string} p */
  const plain = (p) => !PATHSPEC_MAGIC.test(p) && !/^\s/.test(p) && p === p.normalize("NFC") && !p.split("/").some((seg) => !seg || seg === "." || seg === "..") && !dirs.has(p);
  /** @param {number} a @param {number} b */
  const inSpanOf = (a, b) => (/** @type {string} */ p) => {
    const at = changedAt.get(p);
    return !at || (at[0] >= 2 * a && at[1] <= 2 * b);
  };
  // The pieces it could serve: from the whole where the chain allows, or from a read's own span where it has many. A
  // place whose agents took turns on its files (each a span of its own) serves few, and its diffs cost less.
  let could = 0;
  for (const { a, b, paths } of reads) {
    const parts = chunks(paths, PATHS_PER_CALL);
    const inSpan = inSpanOf(a, b);
    could += parts.length > 1 && worthReading(links.get(pairKey(steps[a].before, steps[b].after)), paths.length) ? parts.length : parts.filter((part) => part.every(inSpan) && part.every(plain)).length;
  }
  if (could < least) return null;
  const promisor = await git(["config", "--get-regexp", "^(extensions\\.partialclone|remote\\..*\\.promisor)$"], { cwd: place });
  if (promisor.code !== 1 || promisor.out) return null;
  /** @param {string | null} base @param {string} head */
  const read = async (base, head) => {
    const r = await git([...diffArgs(base, head, ["--raw", "--numstat", "-z", "--no-renames"]), "--"], { cwd: place, timeoutMs: WHOLE_TIMEOUT_MS });
    return r.code === 0 ? parseRawNumstat(r.out) : null;
  };
  const whole = await read(steps[0].before, steps[steps.length - 1].after);
  if (!whole) return null;
  /** @param {NonNullable<ReturnType<typeof parseRawNumstat>>} parsed @param {string[]} part */
  const served = (parsed, part) => {
    if (!part.every(plain)) return null;
    const files = entriesOf(parsed, part);
    return files.some((f) => f.status === "deleted") && files.some((f) => f.status === "added") ? null : files;
  };
  return async ({ a, b, paths }) => {
    const inSpan = inSpanOf(a, b);
    const parts = chunks(paths, PATHS_PER_CALL).map((part) => ({ paths: part, files: part.every(inSpan) ? served(whole, part) : null }));
    if (parts.length < 2 || parts.every((x) => x.files) || !worthReading(links.get(pairKey(steps[a].before, steps[b].after)), paths.length)) return parts;
    // A read of many paths: the pieces left from one diff of its span.
    const span = await read(steps[a].before, steps[b].after);
    return span ? parts.map((x) => (x.files ? x : { paths: x.paths, files: served(span, x.paths) })) : parts;
  };
}

/**
 * A read's pieces made one answer, as `diffFiles` gives it: a piece not known read by its own diff, in order, the
 * first that fails failing the read. @param {string} place @param {string | null} base @param {string} head
 * @param {{ paths: string[], files: FileChange[] | null }[]} parts
 * @returns {Promise<{ ok: boolean, files: FileChange[], error: string | null }>}
 */
async function piecewise(place, base, head, parts) {
  /** @type {FileChange[]} */
  const files = [];
  let untold = false;
  for (const x of parts) {
    if (x.files) {
      files.push(...x.files);
      continue;
    }
    const d = await diffFiles(place, base, head, { paths: x.paths });
    if (!d.ok) return d;
    untold ||= countsUntold.has(d);
    files.push(...d.files);
  }
  const out = { ok: true, files, error: null };
  if (untold) countsUntold.add(out);
  return out;
}

/**
 * The entries of `paths` in a diff between two commits of more, in git's order, as a diff narrowed to them lists them.
 * @param {NonNullable<ReturnType<typeof parseRawNumstat>>} parsed @param {string[]} paths
 * @returns {FileChange[]}
 */
function entriesOf(parsed, paths) {
  const want = new Set(paths);
  /** @type {FileChange[]} */
  const out = [];
  for (const f of parsed.names) {
    if (!want.has(f.path)) continue;
    const c = parsed.counts.get(f.path);
    out.push({ ...f, added: c?.added ?? 0, removed: c?.removed ?? 0, binary: c?.binary ?? false });
  }
  return out;
}

/**
 * A file as a call named it — absolute, or relative to the folder the agent worked in — as git names it in one of the
 * places: the place that holds it, and its path there — the innermost, where one place holds another (a worktree
 * inside the repository's folder). Null where none of them does.
 * @param {string[]} places @param {string | null} root @param {string} path
 * @returns {{ place: string, path: string } | null}
 */
export function inPlaces(places, root, path) {
  const abs = isAbsolute(path) ? path : root ? resolve(root, path) : null;
  if (!abs) return null;
  for (const place of [...places].sort((a, b) => b.length - a.length)) {
    const r = relative(place, abs);
    if (r && !isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`)) return { place, path: r.split(sep).join("/") };
  }
  return null;
}

/**
 * One round's own change in a place, as an edit's card reads it: the files the row's agent named, between the snapshot
 * before the round and the one after — or `path` alone.
 * @param {RoundChange} r @param {{ patch?: boolean, path?: string | null, maxPatchLines?: number }} [opts]
 * @returns {Promise<{ files: FileChange[], error: string | null }>}
 */
export async function roundFilesOf(r, { patch = false, path = null, maxPatchLines = MAX_PATCH_LINES } = {}) {
  if (!r.place || !r.after) return { files: [], error: null };
  if (!existsSync(r.place)) return { files: [], error: FOLDER_GONE };
  const paths = path ? r.own.filter((p) => p === path) : r.own;
  if (!paths.length) return { files: [], error: null };
  const d = await diffFiles(r.place, r.before, r.after, { paths });
  if (!d.ok) return { files: [], error: d.error };
  return { files: patch ? await withPatches(r.place, r.before, r.after, d.files, maxPatchLines) : d.files, error: null };
}

/**
 * A commit as a person names one — a hash, a tag, a branch, `HEAD~3` — in git's own spelling: one word that opens with
 * a letter, a digit, `_` or `@`, so it is never read as an option, and holds no range (`:` and spaces are out).
 */
const REV = /^[A-Za-z0-9_@][A-Za-z0-9_.\/@^~{}-]{0,199}$/;
/** @param {unknown} ref */
export const isRev = (ref) => REV.test(String(ref ?? "")) && !String(ref).includes("..");

/**
 * The changes from a commit a person names (`isRev`) to the folder as it stands: what was committed since, and what is
 * uncommitted in the files git tracks. A file git does not track yet is in no diff against a commit: the caller reads
 * those from the status. `unknown`: the repository holds no such commit — the one failure that is the caller's word.
 * @param {string} folder @param {string} ref
 * @param {{ patch?: boolean, maxPatchLines?: number }} [opts]
 * @returns {Promise<{ ok: true, repo: string, commit: string, files: FileChange[], error: null } | { ok: false, repo: string | null, commit: null, files: FileChange[], error: string, unknown: boolean }>}
 */
export async function changesSince(folder, ref, { patch = false, maxPatchLines = MAX_PATCH_LINES } = {}) {
  const found = await repoOf(folder);
  /** @param {string} error @param {boolean} [unknown] */
  const none = (error, unknown = false) => ({ ok: /** @type {const} */ (false), repo: found.repo, commit: null, files: [], error, unknown });
  if (!found.repo) return none(found.error);
  const { repo } = found;
  if (!isRev(ref)) return none(`\`${ref}\` is not a commit, tag or branch as git names one`, true);
  const at = await git(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { cwd: repo });
  if (at.code !== 0 || !at.out) return none(`git knows no commit, tag or branch \`${ref}\` in this repository`, true);
  const d = await diffFiles(repo, at.out, null);
  if (!d.ok) return none(d.error || "git diff failed");
  const files = patch ? await withPatches(repo, at.out, null, d.files, maxPatchLines) : d.files;
  return { ok: true, repo, commit: at.out, files, error: null };
}

/** The most of HEAD's reflog a span's read takes, newest first: one that moved HEAD more often reads as no reflog. */
const REFLOG_READ = 2000;
/**
 * A reflog entry that moved HEAD onto a commit that stood already, as git words what it did (`<action>: <what>`): a
 * checkout, a reset, a clone, a rebase's start, finish, abort or reset, and a fast-forward of any command but a commit
 * — git's own words for one, whole (`merge main: Fast-forward`, `pull --ff-only: Fast-forward`, `rebase:
 * fast-forward`), or a merge's or a pull's with what it ignored in brackets after. Every other wrote the commit it
 * points at: a commit, an amend, a merge made, a cherry-pick, a revert, an am, a rebase's pick — its words after the
 * colon are the commit's own subject, which may open as git's word does ("Fast-forward (the cursor) to the end"). A
 * pick of a commit whose whole subject is "fast-forward" reads as a move: git writes the two alike.
 * @param {string} subject
 */
const movedOnly = (subject) => {
  const i = subject.indexOf(": ");
  const [action, what] = i < 0 ? [subject, ""] : [subject.slice(0, i), subject.slice(i + 2)];
  if (/^(?:checkout|reset|clone)\b|\((?:start|finish|abort|reset)\)$/.test(action)) return true;
  if (/^commit\b/.test(action)) return false;
  return /^fast-forward$/i.test(what) || (/^(?:merge|pull)\b[^(]*$/.test(action) && /^Fast-forward \(/.test(what));
};

/**
 * The commits the folder's HEAD wrote since it stood on `from` as the span began (`before`, ms), read from its reflog
 * (the task reflog-brought): what a fast-forward, a rebase's start or a reset moved it onto is in none. The span's
 * entries are those above the newest that left HEAD on `from` before it began, whatever date each carries: an entry
 * takes its commit's committer date, and a commit dated back (GIT_COMMITTER_DATE, a rebase that keeps its dates) puts
 * it before the span, though the task made it. Where none names `from` — a reflog cut short, a HEAD that came to
 * `from` as the span began — the entries dated from `before` on. Null where the reflog cannot say — none kept, none
 * from the span, or its newest entry not `to`, where HEAD stands: HEAD moved with no entry.
 * @param {string} repo @param {string} from @param {string} to @param {number} before
 * @returns {Promise<Set<string> | null>}
 */
async function madeOnHead(repo, from, to, before) {
  const r = await git(["log", "-g", "--date=unix", `--max-count=${REFLOG_READ}`, "--format=%H%x01%gd%x01%gs", "HEAD", "--"], { cwd: repo });
  if (r.code !== 0) return null;
  const since = Math.floor(before / 1000);
  /** @type {{ id: string, at: number, subject: string }[]} */
  const entries = [];
  for (const l of r.out.split(/\r?\n/).filter(Boolean)) {
    const [id, selector, subject = ""] = l.split("\x01");
    const at = /@\{(\d+)\}$/.exec(selector || "");
    if (!id || !at) return null;
    entries.push({ id, at: Number(at[1]), subject });
  }
  const began = entries.findIndex((e) => e.id === from && e.at < since);
  const older = began >= 0 ? began : entries.findIndex((e) => e.at < since);
  const span = older < 0 ? entries : entries.slice(0, older);
  if (!span.length || span[0].id !== to || span.length === REFLOG_READ) return null;
  return new Set(span.filter((e) => !movedOnly(e.subject)).map((e) => e.id));
}

/** A commit's line in the span's log, as `brought` asks for it: \x01, its id, its committer time, its parents. */
const COMMIT_LINE = /^\x01([0-9a-f]{40,64}) (\d+)((?: [0-9a-f]{40,64})*) ?$/;

/**
 * Git on the folder a task of a session's graph runs in (HarnessV4_TaskGraphPlus_Plan E41 P2 case 11), read-only for
 * the folder: `snapshot` the folder as it stands — the commit that holds its tree, kept by no ref, the repository's own
 * index and refs untouched — and the HEAD it was taken on, or why there is none; `between` the files that differ from
 * one such commit to another, as git names them in the repository; `brought` the files HEAD's move from one commit to
 * another (`from..to`) brought in as another's: each a commit of another's touched — one no entry of HEAD's reflog
 * since the span began (`before`, ms) wrote: what a merge, a fast-forward or a rebase onto others' work brought,
 * whenever it was made (the task reflog-brought) —, that no commit HEAD wrote in the span touched, and that the folder
 * holds (`held`, its snapshot as the span closed) as a commit it was brought to holds it. A file the task changed
 * after it came — a conflict it resolved in a merge, an edit on top — is the task's. Where the reflog cannot say whose
 * a commit is: another's off HEAD's first-parent line, or committed before `before` (FabeleHelper's of 11-10).
 * @type {Readonly<{ snapshot: (folder: string) => Promise<{ ok: true, repo: string, commit: string, head: string | null } | { ok: false, error: string }>, between: (repo: string, from: string, to: string) => Promise<{ ok: true, files: string[] } | { ok: false, error: string }>, brought: (repo: string, from: string, to: string, before: number, held: string) => Promise<{ ok: true, files: string[] } | { ok: false, error: string }> }>}
 */
export const taskFolders = Object.freeze({
  snapshot: async (/** @type {string} */ folder) => {
    const s = await snapshotTree(folder, { name: "task", keep: false, message: "Filament: a task's start or end" });
    return s.ok && s.repo && s.at ? { ok: /** @type {const} */ (true), repo: s.repo, commit: s.at, head: s.parent || null } : { ok: /** @type {const} */ (false), error: s.error || "git kept no snapshot" };
  },
  between: async (/** @type {string} */ repo, /** @type {string} */ from, /** @type {string} */ to) => {
    if (from === to) return { ok: /** @type {const} */ (true), files: [] };
    const d = await diffFiles(repo, from, to);
    return d.ok ? { ok: /** @type {const} */ (true), files: d.files.map((f) => f.path) } : { ok: /** @type {const} */ (false), error: d.error || "git diff failed" };
  },
  brought: async (/** @type {string} */ repo, /** @type {string} */ from, /** @type {string} */ to, /** @type {number} */ before, /** @type {string} */ held) => {
    if (from === to || !isRev(from) || !isRev(to) || !isRev(held)) return { ok: /** @type {const} */ (true), files: [] };
    // What HEAD wrote as the span ran: a commit it came to hold without writing it — a merge's other side, what a
    // fast-forward or a rebase's start moved it onto — is another's whenever it was made (another chat's commit to main
    // as the task ran).
    const made = await madeOnHead(repo, from, to, before);
    // With no reflog, HEAD's own line: a commit off it came by a merge's other side, another's whenever it was made
    // (FabeleHelper's second read of 11-10); one on it, by a rebase or a fast-forward, is another's where it was made
    // before the span began.
    const line = made ? null : await git(["rev-list", "--first-parent", `${from}..${to}`, "--"], { cwd: repo });
    if (line && line.code !== 0) return { ok: /** @type {const} */ (false), error: firstLine(line.err || line.error || `git rev-list exited ${line.code}`) };
    const own = new Set(line ? line.out.split(/\r?\n/).filter(Boolean) : []);
    // Each commit's id, committer time and parents (\x01 ahead of them), then the files it touched — a merge names
    // none —, a NUL after each: a path as it is, where a line each has git write one that holds a tab, a quote or a
    // newline in quotes, escaped, which names no file the folder changed.
    const r = await git(["log", "--format=%x01%H %ct %P", "--name-only", "--no-renames", "-z", `${from}..${to}`, "--"], { cwd: repo });
    if (r.code !== 0) return { ok: /** @type {const} */ (false), error: firstLine(r.err || r.error || `git log exited ${r.code}`) };
    /** The files another's commits touched, and those HEAD's own did. @type {[Set<string>, Set<string>]} */
    const [theirs, ours] = [new Set(), new Set()];
    /** Another's commits, and the commits they stand on. @type {[Set<string>, Set<string>]} */
    const [others, under] = [new Set(), new Set()];
    let mine = false;
    let first = false;
    for (const part of r.out.split("\0")) {
      const c = COMMIT_LINE.exec(part);
      if (c) {
        mine = made ? made.has(c[1]) : own.has(c[1]) && Number(c[2]) * 1000 >= before;
        if (!mine) {
          others.add(c[1]);
          for (const p of c[3].split(" ")) if (p) under.add(p);
        }
        first = true;
        continue;
      }
      // git sets a commit's files off from its own line with a newline ahead of the first.
      const path = first && part.startsWith("\n") ? part.slice(1) : part;
      first = false;
      if (path) (mine ? ours : theirs).add(path);
    }
    /** @type {Set<string>} */
    const files = new Set();
    // The commits HEAD was brought to: those of another's no other of them stands on. A file the folder holds as none
    // of them does was changed after it came, and one HEAD's own commit touched is the task's however it stands. Where
    // git cannot say how the folder differs from one, nothing is kept as brought in from it.
    for (const tip of others) {
      if (under.has(tip)) continue;
      const differs = await namesChanged(repo, tip, held);
      if (differs) for (const p of theirs) if (!ours.has(p) && !differs.has(p)) files.add(p);
    }
    return { ok: /** @type {const} */ (true), files: [...files].sort() };
  },
});

/** A list of changed files counted: how many, the lines added and removed. @param {FileChange[]} files */
export function totalsOf(files) {
  return files.reduce((t, f) => ({ files: t.files + 1, added: t.added + f.added, removed: t.removed + f.removed }), { files: 0, added: 0, removed: 0 });
}
/**
 * The files with their diffs, each clipped at `maxLines`; a binary file with its size instead. Each patch is the one a
 * diff of the file alone gives (`diffPatch`), and most come from one diff of them all (`patchesOf`): one git a file,
 * one after another, was hundreds of processes for a view of a change. Asked alone still: a rename, whose two paths
 * git pairs only when they are asked together — asked with others, it could pair them otherwise —, a binary file, an
 * unmerged one, one git reads as a pattern, and one whose path holds others (a file that was a folder), which a diff
 * of it alone shows with them.
 * @param {string} repo @param {string | null} base @param {string | null} head @param {FileChange[]} files @param {number} maxLines
 * @returns {Promise<FileChange[]>}
 */
export async function withPatches(repo, base, head, files, maxLines) {
  const holders = foldersOf(files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])));
  const together = files.filter((f) => !f.binary && !f.oldPath && f.status !== "unmerged" && !PATHSPEC_MAGIC.test(f.path) && !holders.has(f.path)).map((f) => f.path);
  const found = together.length ? await patchesOf(repo, base, head, together, maxLines) : new Map();
  const out = [];
  for (const f of files)
    out.push(
      f.binary
        ? { ...f, patch: "", truncated: false, ...(await sizeOf(repo, f.status === "deleted" ? base : head, f.path)) }
        : { ...f, ...(found.get(f.path) ?? (await diffPatch(repo, base, head, f.oldPath ? [f.oldPath, f.path] : f.path, { maxLines }))) },
    );
  return out;
}

/** What git reads as a pattern in a path it is asked about (a pathspec's wildcards and magic): its diff alone may hold other files. */
export const PATHSPEC_MAGIC = /[*?[\\]|^:/;

/** Every folder above the paths: `a/b/c.txt` is in `a` and `a/b`. @param {Iterable<string>} paths */
export function foldersOf(paths) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const p of paths) for (let i = p.indexOf("/"); i >= 0; i = p.indexOf("/", i + 1)) out.add(p.slice(0, i));
  return out;
}

/**
 * Many files' patches from one diff of them, each as `diffPatch` gives it alone: the diff's part under each file's own
 * `diff --git` line (two for a file whose type changed), trimmed and clipped as git's answer for it alone would be.
 * Renames are not looked for, so no file is paired with another: alone, one path has nothing to pair with. A part of
 * the answer this cannot place — a header it cannot read, a file not asked about, a call that failed or ran past git's
 * output limit — leaves its files out, to be asked alone.
 * @param {string} repo @param {string | null} base @param {string | null} head @param {string[]} paths @param {number} maxLines
 * @returns {Promise<Map<string, { patch: string, truncated: boolean, lines: number }>>}
 */
async function patchesOf(repo, base, head, paths, maxLines) {
  /** @type {Map<string, { patch: string, truncated: boolean, lines: number }>} */
  const found = new Map();
  for (const part of chunks(paths, PATHS_PER_CALL)) {
    const r = await git([...diffArgs(base, head, ["-p", "--no-renames", "--no-color", "--no-ext-diff"]), "--", ...part], { cwd: repo });
    if (r.code !== 0 || !r.out.startsWith("diff --git ")) continue;
    const asked = new Set(part);
    /** Each file's sections of the answer, in order. @type {Map<string, string[]>} */
    const sections = new Map();
    let placed = true;
    for (const s of r.out.split(/\n(?=diff --git )/)) {
      const nl = s.indexOf("\n");
      const p = headerPath(nl < 0 ? s : s.slice(0, nl));
      if (p == null || !asked.has(p)) {
        placed = false;
        break;
      }
      sections.set(p, [...(sections.get(p) || []), s]);
    }
    if (!placed) continue;
    for (const [p, s] of sections) {
      const lines = s.join("\n").trim().split("\n");
      const cut = lines.length > maxLines;
      found.set(p, { patch: (cut ? lines.slice(0, maxLines) : lines).join("\n"), truncated: cut, lines: lines.length });
    }
  }
  return found;
}

/** git's escapes in a quoted path, by the letter after the backslash. @type {Record<string, number>} */
const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
/**
 * The path a `diff --git a/<path> b/<path>` line names, where both name the same file (no rename): as written, or in
 * the C-style quotes git puts around a name with a byte it escapes. Null for any other line.
 * @param {string} line
 */
function headerPath(line) {
  const rest = line.slice("diff --git ".length);
  if (!rest.startsWith('"')) {
    const n = (rest.length - 5) / 2;
    const p = rest.slice(2, 2 + n);
    return Number.isInteger(n) && n > 0 && rest === `a/${p} b/${p}` ? p : null;
  }
  // The name's bytes: its letters as they stand (UTF-8), each escape one byte.
  /** @type {Buffer[]} */
  const bytes = [];
  let i = 1;
  while (i < rest.length && rest[i] !== '"') {
    const esc = rest.indexOf("\\", i);
    const close = rest.indexOf('"', i);
    const to = close < 0 ? rest.length : esc >= 0 && esc < close ? esc : close;
    bytes.push(Buffer.from(rest.slice(i, to)));
    i = to;
    if (rest[i] !== "\\") break;
    const code = rest.slice(i + 1, i + 4);
    const c = rest[i + 1];
    if (/^[0-3][0-7]{2}$/.test(code)) {
      bytes.push(Buffer.from([parseInt(code, 8)]));
      i += 4;
    } else if (c != null && Object.hasOwn(ESCAPES, c)) {
      bytes.push(Buffer.from([ESCAPES[c]]));
      i += 2;
    } else return null;
  }
  const quoted = rest.slice(0, i + 1);
  const name = Buffer.concat(bytes).toString("utf8");
  return name.startsWith("a/") && rest === `${quoted} "b/${quoted.slice(3)}` ? name.slice(2) : null;
}

/**
 * A binary file's size, which stands in for its diff (HarnessV4_Git_Plan GWC-30): in a commit, or in the working tree
 * where `rev` is null. Nothing where it cannot be read.
 * @param {string} repo @param {string | null} rev @param {string} path @returns {Promise<{ size?: number }>}
 */
async function sizeOf(repo, rev, path) {
  if (!rev) {
    try {
      return { size: statSync(join(repo, path)).size };
    } catch {
      return {};
    }
  }
  const r = await git(["cat-file", "-s", `${rev}:${path}`], { cwd: repo });
  return r.code === 0 && /^\d+$/.test(r.out) ? { size: Number(r.out) } : {};
}
/** @template T @param {T[]} list @param {number} n @returns {T[][]} */
const chunks = (list, n) => {
  /** @type {T[][]} */
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};
