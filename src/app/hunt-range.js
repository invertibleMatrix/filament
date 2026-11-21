// @ts-check
// A hunt's range read from git (the plan's p6): core/hunt-range.js's range as the chat's folder holds it — its files,
// each with the lines its diff changes and the command that reads that diff — or, where it names nothing or a ref git
// does not know, why, in words. None named, it is what is uncommitted and what the chat's turns changed, read from the
// rounds its snapshots keep (adapters/git/changes.js `ownChangesOf`, as the turn's changes card and a rewind read them).
// Read-only: `--no-optional-locks` and plumbing reads alone, so nothing is staged, written or locked in the repository;
// the commands it suggests read so too, each path in double quotes and each commit by its id. Nothing here blocks the
// server's thread: files are looked at and read asynchronously, a few at a time, and an untracked file's lines are
// counted as the Branch read counts them — the first MAX_BRANCH_FILES files, each up to MAX_UNTRACKED_PATCH_BYTES —
// the rest listed with no count.
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fewAtOnce } from "../core/at-once.js";
import { EMPTY_TREE, changesSince, diffFiles, isRev, ownChangesOf } from "../adapters/git/changes.js";
import { MAX_BRANCH_FILES, MAX_UNTRACKED_PATCH_BYTES, NO_LOCKS, statusOf } from "../adapters/git/inspect.js";
import { git, repoOf } from "../adapters/git/snapshot.js";
import { GIT_READ, parseRange, quoted } from "../core/hunt-range.js";

/** The files a folder named in a range brings, at most: the rest are left out, and said so. */
const FOLDER_FILES = 2000;
/**
 * The chat's writing rounds the default range reads, the newest: a round of its own files is one git read, about 10 ms
 * where each round wrote a file of its own (300 rounds, 2.9 s, measured 11-03), so the read stays near 2 s; older ones
 * are left out, and said so.
 */
export const CHAT_ROUNDS = 200;
/** How long a commit's id is in a suggested command: its full id for the empty tree, which no short form finds. */
const SHORT = 12;

/**
 * @typedef {import("../core/hunt-range.js").HuntRange} HuntRange
 * @typedef {import("../core/hunt-range.js").RangeFile} RangeFile
 * @typedef {{ ok: true, range: HuntRange | null } | { ok: false, error: string }} RangeRead  `range` null: none named,
 *   and nothing is uncommitted or changed by the chat — no range to carry
 */

/** @param {string} error @returns {RangeRead} */
const no = (error) => ({ ok: false, error });
/** A path with forward slashes, as git spells one. @param {string} p */
const slashed = (p) => p.split(sep).join("/");
/** A commit as a suggested command names it. @param {string} id */
const idOf = (id) => (id === EMPTY_TREE ? id : id.slice(0, SHORT));
/** The first line of what git said. @param {unknown} s */
const firstLine = (s) => String(s || "").trim().split("\n")[0] || "git gave no reason";

/** What a path is: a file, a folder, or null where nothing is there. @param {string} abs @returns {Promise<"file" | "folder" | null>} */
const kindOf = async (abs) => {
  try {
    return (await stat(abs)).isDirectory() ? "folder" : "file";
  } catch {
    return null;
  }
};

/**
 * A new file's lines: null where it is larger than MAX_UNTRACKED_PATCH_BYTES or cannot be read; binary where a zero
 * byte shows in its start. @param {string} abs @returns {Promise<{ added: number | null, binary: boolean }>}
 */
async function newLines(abs) {
  try {
    const s = await stat(abs);
    if (!s.isFile() || s.size > MAX_UNTRACKED_PATCH_BYTES) return { added: null, binary: false };
    const buf = await readFile(abs);
    if (buf.subarray(0, 8192).includes(0)) return { added: 0, binary: true };
    const text = buf.toString("utf8");
    return { added: text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0, binary: false };
  } catch {
    return { added: null, binary: false };
  }
}

/**
 * Untracked files as a range lists them, each as new: the first MAX_BRANCH_FILES with their lines counted, a few at a
 * time; the rest with no count. @param {string} repo @param {string[]} paths @returns {Promise<RangeFile[]>}
 */
async function untrackedFiles(repo, paths) {
  const counted = await fewAtOnce(paths.slice(0, MAX_BRANCH_FILES), (p) => newLines(resolve(repo, p)));
  return paths.map((path, i) => {
    const n = counted[i] ?? { added: null, binary: false };
    return { path, added: n.added, removed: n.added == null ? null : 0, ...(n.binary ? { binary: true } : {}), note: "new, untracked: read the file" };
  });
}

/**
 * What is uncommitted in a repository: each file against HEAD — staged and not as one — and each untracked one as new.
 * @param {string} folder
 * @returns {Promise<{ ok: true, repo: string, head: string | null, files: RangeFile[] } | { ok: false, error: string }>}
 */
async function uncommittedOf(folder) {
  const st = await statusOf(folder, { eachFile: true });
  if (!st.ok || !st.repo) return { ok: false, error: String(st.error || "git could not read the folder") };
  const repo = st.repo;
  const head = st.head ?? null;
  const tracked = await diffFiles(repo, head, null);
  if (!tracked.ok) return { ok: false, error: String(tracked.error) };
  /** @type {RangeFile[]} */
  const files = tracked.files.map(fileOf);
  files.push(...(await untrackedFiles(repo, (st.files || []).filter((x) => x.kind === "untracked").map((x) => x.path))));
  return { ok: true, repo, head, files };
}

/**
 * A commit as git knows it in a repository: its full id, or null. @param {string} repo @param {string} ref
 * @returns {Promise<string | null>}
 */
async function commitOf(repo, ref) {
  if (!isRev(ref)) return null;
  const r = await git(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { cwd: repo });
  return r.code === 0 && r.out.trim() ? r.out.trim() : null;
}

/**
 * The repository's top as the range's paths start from it, where that is not the chat's folder itself.
 * @param {string} repo @param {string} folder
 */
const topOf = (repo, folder) => (resolve(repo) === resolve(folder) ? null : repo);
/** A ref as a label says it: its name, and the commit it is where they differ. @param {string} ref @param {string} id */
const named = (ref, id) => (ref === idOf(id) || ref === id ? `\`${ref}\`` : `\`${ref}\` (${idOf(id)})`);

/**
 * A range read: none named — what is uncommitted and the files the chat's turns changed (`rounds`; `alone`, the places
 * only the chat works in, as a rewind reads them); what is uncommitted; everything since a ref; a commit range; files and
 * folders named — or one word that is a ref and no path. A ref git does not know, or a range that names nothing, is
 * refused in words; none named that finds nothing is no range (`range` null).
 * @param {{ folder: string | null, spec: unknown, rounds?: import("../core/types.js").RoundChange[] | null, alone?: Set<string> | null, label?: string }} o
 *   `label`: what a list of files is, in words (the Plan's hunt: its task's)
 * @returns {Promise<RangeRead>}
 */
export async function resolveRange({ folder, spec, rounds = null, alone = null, label = "" }) {
  const p = parseRange(spec);
  if ("error" in p) return no(p.error);
  if (!folder || (await kindOf(folder)) !== "folder") return p.kind === "chat" ? { ok: true, range: null } : no("the chat names no folder to hunt in");
  const found = await repoOf(folder);
  const repo = found.repo;
  if (p.kind === "chat") return chatRange(folder, repo, rounds, alone);
  if (!repo && p.kind !== "words" && p.kind !== "files") return no(`the chat's folder is in no git repository (${found.error || "git found none"}): a diff or a commit range needs one — name files instead`);
  if (p.kind === "uncommitted") {
    const u = await uncommittedOf(folder);
    if (!u.ok) return no(u.error);
    if (!u.files.length) return no("nothing is uncommitted in the chat's folder: name a ref, a commit range or files");
    return { ok: true, range: { kind: "uncommitted", label: "what is uncommitted in the chat's folder", files: u.files, read: `A file's diff: ${GIT_READ} diff HEAD -- "<file>"`, list: `${GIT_READ} status`, top: topOf(u.repo, folder) } };
  }
  if (p.kind === "diff") return sinceRange(folder, /** @type {string} */ (repo), p.ref);
  if (p.kind === "commits") {
    const top = /** @type {string} */ (repo);
    const [from, to] = await Promise.all([commitOf(top, p.from), commitOf(top, p.to)]);
    const unknown = [!from ? p.from : "", !to ? p.to : ""].filter(Boolean);
    if (!from || !to) return no(`git knows no commit, tag or branch ${unknown.map((u) => `\`${u}\``).join(" or ")} in this repository`);
    const d = await diffFiles(top, from, to);
    if (!d.ok) return no(String(d.error));
    if (!d.files.length) return no(`\`${p.from}..${p.to}\` changes no file`);
    // The commits by their ids in what the lead runs: a ref no shell reads the same way (`@{u}`) and one that moves.
    const span = `${idOf(from)}..${idOf(to)}`;
    const said = `${p.from}..${p.to}`;
    return { ok: true, range: { kind: "commits", label: `the commits ${said === span ? said : `${said} (${span})`}`, files: d.files.map(fileOf), read: `A file's diff: ${GIT_READ} diff ${span} -- "<file>"`, list: `${GIT_READ} diff --stat ${span}`, top: topOf(top, folder) } };
  }
  // Words: one that names no path but a commit is a diff since it; the rest are files and folders.
  const words = p.kind === "files" ? p.files : p.words;
  if (p.kind === "words" && words.length === 1 && repo && isRev(words[0]) && !(await kindOf(resolve(folder, words[0]))) && (await commitOf(repo, words[0]))) return sinceRange(folder, repo, words[0]);
  return filesRange(folder, repo, words, { strict: p.kind === "words", label });
}

/** A file of a diff as a range lists it. @param {import("../adapters/git/changes.js").FileChange} f @returns {RangeFile} */
const fileOf = (f) => ({ path: f.path, added: f.added, removed: f.removed, ...(f.binary ? { binary: true } : {}), ...(f.status !== "modified" ? { note: f.status } : {}) });

/**
 * Everything since a ref: what was committed since, and what is uncommitted — a file git does not track yet read as
 * new. The ref is read as the commit it names as the range is read. @param {string} folder @param {string} repo @param {string} ref
 * @returns {Promise<RangeRead>}
 */
async function sinceRange(folder, repo, ref) {
  const at = await commitOf(repo, ref);
  if (!at) return no(`git knows no commit, tag or branch \`${ref}\` in this repository`);
  const out = await changesSince(folder, at);
  if (!out.ok) return no(out.error);
  const files = out.files.map(fileOf);
  const st = await statusOf(folder, { eachFile: true });
  files.push(...(await untrackedFiles(repo, st.ok ? (st.files || []).filter((x) => x.kind === "untracked").map((x) => x.path) : [])));
  if (!files.length) return no(`nothing has changed since \`${ref}\``);
  const id = idOf(at);
  return { ok: true, range: { kind: "diff", label: `everything changed since ${named(ref, at)} — committed since, and uncommitted`, files, read: `A file's diff: ${GIT_READ} diff ${id} -- "<file>"`, list: `${GIT_READ} diff --stat ${id}`, top: topOf(repo, folder) } };
}

/**
 * None named: what is uncommitted, and each file the chat's turns changed — its lines from before the chat first changed
 * it, read from that snapshot (`git diff <snapshot> -- "<file>"`), in any place the chat wrote in. A file of both is
 * listed once, as the chat's. Outside git, the chat's files alone, by their paths. Nothing found is no range.
 * @param {string} folder @param {string | null} repo @param {import("../core/types.js").RoundChange[] | null} rounds
 * @param {Set<string> | null} alone @returns {Promise<RangeRead>}
 */
async function chatRange(folder, repo, rounds, alone) {
  /** @type {Map<string, RangeFile>} */
  const files = new Map();
  /** @type {string | null} */
  let top = null;
  if (repo) {
    const u = await uncommittedOf(folder);
    if (u.ok) {
      top = u.repo;
      for (const f of u.files) files.set(f.path, { ...f, note: f.note ? `uncommitted, ${f.note}` : "uncommitted" });
    }
  }
  const read = (rounds || []).slice(-CHAT_ROUNDS);
  const older = (rounds?.length || 0) - read.length;
  const own = read.length ? await ownChangesOf(read, { alone }) : null;
  for (const f of own?.files || []) {
    const home = top && resolve(f.place) === resolve(top);
    const key = home ? f.path : `${slashed(f.place)}/${f.path}`;
    const was = files.get(key);
    const from = idOf(f.from || EMPTY_TREE);
    files.set(key, {
      path: key,
      added: f.added,
      removed: f.removed,
      ...(f.binary ? { binary: true } : {}),
      note: `this chat changed it${f.status !== "modified" ? `, ${f.status}` : ""}${was ? ", uncommitted" : ""}`,
      read: home ? `${GIT_READ} diff ${from} -- ${quoted(f.path)}` : `${GIT_READ} -C ${quoted(f.place)} diff ${from} -- ${quoted(f.path)}`,
    });
  }
  for (const o of own?.outside || []) {
    const rel = isAbsolute(o.path) ? slashed(relative(folder, o.path)) : slashed(o.path);
    const key = rel.startsWith("..") ? slashed(o.path) : rel;
    if (!files.has(key)) files.set(key, { path: key, added: null, removed: null, note: "this chat changed it, outside any repository: read the file" });
  }
  if (!files.size) return { ok: true, range: null };
  return {
    ok: true,
    range: {
      kind: "chat",
      label: `what is uncommitted in the chat's folder and the files this chat's turns changed${older ? ` from turn ${read[0]?.turn ?? "?"} on (its ${older} older writing rounds left out)` : ""}`,
      files: [...files.values()],
      read: `A file this chat changed: the command on its line, from before the chat first changed it; one only uncommitted: ${GIT_READ} diff HEAD -- "<file>"`,
      list: `${GIT_READ} status, with the chat's Changes pane,`,
      top: top ? topOf(top, folder) : null,
    },
  };
}

/**
 * Files and folders named: each read from the chat's folder — a folder brings the files git tracks in it — each with
 * the lines it holds uncommitted where it does, read from one list of what is uncommitted. A path outside the repository
 * is listed as such, never handed to git. `strict` (a person's or an agent's words): a path that names nothing is
 * refused by name, as a typo would be, and so is a folder whose files are too many to list; else (a list Filament made:
 * the Plan's task) each is listed as it stands — gone, or too large a folder — and the hunt goes on.
 * @param {string} folder @param {string | null} repo @param {string[]} words
 * @param {{ strict: boolean, label: string }} o @returns {Promise<RangeRead>}
 */
async function filesRange(folder, repo, words, { strict, label }) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const paths = [];
  /** @type {RangeFile[]} */
  const apart = [];
  /** @type {string[]} */
  const unlisted = [];
  let cut = 0;
  const kinds = await fewAtOnce(words, (w) => kindOf(resolve(folder, w)));
  for (const [i, word] of words.entries()) {
    const abs = resolve(folder, word);
    const inRepo = repo ? relative(repo, abs) : null;
    const rel = inRepo != null && inRepo !== ".." && !inRepo.startsWith(`..${sep}`) && !isAbsolute(inRepo) ? slashed(inRepo) : null;
    const kind = kinds[i];
    if (!kind) {
      if (strict) missing.push(word);
      else apart.push({ path: rel ?? slashed(word), added: null, removed: null, note: "not in the folder now" });
      continue;
    }
    // A path outside the repository: git reads none of it, and is never asked to.
    if (repo && rel == null) {
      apart.push({ path: slashed(word), added: null, removed: null, note: "outside the repository: read the file" });
      continue;
    }
    if (kind === "folder") {
      if (!repo) {
        paths.push(slashed(word).replace(/\/?$/, "/"));
        continue;
      }
      const r = await git([...NO_LOCKS, "ls-files", "-z", "--", rel || "."], { cwd: repo });
      if (r.cut) {
        unlisted.push(word);
        if (!strict) apart.push({ path: `${rel || "."}/`, added: null, removed: null, note: "a folder of too many files to list: read what you need of it" });
        continue;
      }
      if (r.code !== 0) {
        if (strict) return no(`git could not list the files of \`${word}\`: ${firstLine(r.err || r.error)}`);
        apart.push({ path: `${rel || "."}/`, added: null, removed: null, note: "a folder git could not list" });
        continue;
      }
      const listed = r.out.split("\0").filter(Boolean);
      if (!listed.length && strict) missing.push(word);
      cut += Math.max(0, listed.length - FOLDER_FILES);
      paths.push(...listed.slice(0, FOLDER_FILES));
      continue;
    }
    paths.push(rel ?? slashed(word));
  }
  if (missing.length) return no(`the range names no file or folder in the chat's folder: ${missing.map((m) => `\`${m}\``).join(", ")}${missing.length === 1 && words.length === 1 ? ", and git knows no commit by that name" : ""}`);
  if (strict && unlisted.length) return no(`${unlisted.map((u) => `\`${u}\``).join(", ")} ${unlisted.length === 1 ? "holds" : "hold"} too many files to list (git's list passed 8 MB): name files, or a folder inside it`);
  const unique = [...new Set(paths)];
  if (!unique.length && !apart.length) return no("the range names nothing to hunt in");
  // What each file holds uncommitted: one list of the repository's, read once — never a path handed to git — and,
  // where git cannot give it, said unknown rather than none.
  /** @type {Map<string, import("../adapters/git/changes.js").FileChange>} */
  const loose = new Map();
  /** @type {string | null} */
  let unread = null;
  if (repo && unique.length) {
    const head = (await repoOf(repo)).head;
    const d = await diffFiles(repo, head, null);
    if (d.ok) for (const f of d.files) loose.set(f.path, f);
    else unread = firstLine(d.error);
  }
  /** @type {RangeFile[]} */
  const files = unique.map((path) => {
    if (unread != null && !path.endsWith("/")) return { path, added: null, removed: null, note: `its uncommitted lines unknown: git could not read them (${unread})` };
    const f = loose.get(path);
    return f ? { path, added: f.added, removed: f.removed, ...(f.binary ? { binary: true } : {}), note: "uncommitted", read: `${GIT_READ} diff HEAD -- ${quoted(path)}` } : { path, added: null, removed: null };
  });
  files.push(...apart);
  const more = cut ? `, ${cut} more files of its folders left out` : "";
  return {
    ok: true,
    range: { kind: "files", label: `${label || "the files named"}${more}`, files, read: "Read each file whole; one with uncommitted lines names the command that shows them", list: "the range's words", top: repo ? topOf(repo, folder) : null },
  };
}
