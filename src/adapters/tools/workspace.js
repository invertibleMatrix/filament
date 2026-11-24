// @ts-check
// Read-only views of a project folder for the harness (plan B3): the tree one level at a time, a file's text for the
// code viewer, a name search, and the folder browser's subdirectories. The same fence the hands run behind
// (`resolveInside`: lexical and real-path containment) keeps every path inside the folder; the folder itself is the
// caller's to allow (the admin area judges it against agentLoop.roots). Nothing here writes.
import { readdirSync, statSync, existsSync, realpathSync, lstatSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, basename, dirname, extname, sep } from "node:path";
import { resolveInside } from "./fs-fence.js";
import { withoutOwnSwitch } from "./own-programs.js";
import { OWN_CONFIG, gitAbove, gitProgram, notStarted, refusedWords } from "../git/snapshot.js";
import { execFileOffThread } from "../git/spawn-pool.js";
import { folderThere } from "../git/folder-there.js";

export const MAX_TREE_ENTRIES = 2000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SEARCH_WALK = 20000;
/** The most of git's listing a search reads, in bytes of names — a million files or so: there git is stopped. */
const MAX_SEARCH_LISTING = 64 * 1024 * 1024;
/** How long a search's `git ls-files` may run. */
const LIST_MS = 30_000;
const SKIP_DIRS = new Set([".git", "node_modules"]);
const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon", ".avif": "image/avif" };

/** Folder-relative, forward slashes: the spelling the harness shows and sends back. */
const relOf = (root, abs) => relative(root, abs).replace(/\\/g, "/");
/** @param {{ name: string }} a @param {{ name: string }} b */
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
/** @param {import("node:fs").Dirent} d */
const kindOf = (d) => (d.isSymbolicLink() ? "link" : d.isDirectory() ? "dir" : d.isFile() ? "file" : "other");

/** A path's stats, or null where it has none. @param {string} p */
const statOf = (p) => stat(p).catch(() => null);

/**
 * The entries of one folder (and, with `depth` > 1, its subfolders), directories first. `.git` is never listed;
 * everything else is (hidden files included — the surface decides). Capped at MAX_TREE_ENTRIES per call. Read without
 * holding the event loop: a folder's listing and its files' sizes are asked of the disk and awaited, the sizes of a
 * folder's files together.
 * @param {string} root  the project folder (already allowed)
 * @param {{ path?: string, depth?: number }} [opts]
 */
export async function listTree(root, { path = "", depth = 1 } = {}) {
  const abs = resolveInside(root, path || ".");
  if (!(await statOf(abs))?.isDirectory()) throw new Error(`no such folder: ${path || "."}`);
  const budget = { left: MAX_TREE_ENTRIES };
  const entries = await walk(root, abs, Math.max(1, Math.min(3, Math.floor(Number(depth) || 1))), budget);
  return { path: relOf(root, abs), entries, truncated: budget.left <= 0 };
}
/** @param {string} root @param {string} dir @param {number} depth @param {{ left: number }} budget @returns {Promise<any[]>} */
async function walk(root, dir, depth, budget) {
  /** @type {any[]} */
  const out = [];
  let list;
  try {
    list = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const rows = list
    .filter((d) => d.name !== ".git")
    .map((d) => ({ name: d.name, kind: kindOf(d) }))
    .sort((a, b) => (a.kind === "dir") === (b.kind === "dir") ? byName(a, b) : a.kind === "dir" ? -1 : 1);
  /** The folder's files' sizes, asked as each row is taken and awaited together. @type {Promise<void>[]} */
  const sized = [];
  // The budget is spent row by row, a subfolder's rows before the next of this folder's, as the listing reads.
  for (const r of rows) {
    if (budget.left <= 0) break;
    budget.left--;
    const abs = join(dir, r.name);
    /** @type {any} */
    const row = { name: r.name, path: relOf(root, abs), kind: r.kind };
    if (r.kind === "file")
      sized.push(statOf(abs).then((st) => {
        if (!st) return;
        row.size = st.size;
        row.mtimeMs = Math.round(st.mtimeMs);
      }));
    if (r.kind === "dir" && depth > 1 && !SKIP_DIRS.has(r.name)) row.children = await walk(root, abs, depth - 1, budget);
    out.push(row);
  }
  await Promise.all(sized);
  return out;
}

/**
 * A file for the viewer: UTF-8 text up to MAX_FILE_BYTES (the cut said), an image as a data URL under
 * MAX_IMAGE_BYTES, otherwise "binary" with the size and no content. Read without holding the event loop.
 * @param {string} root @param {string} path
 * @returns {Promise<{ path: string, name: string, size: number, mtimeMs: number, kind: "text" | "image" | "binary", mime?: string | null, note?: string, dataUrl?: string, content?: string, truncated?: boolean, lines?: number }>}
 */
export async function readPreview(root, path) {
  const abs = resolveInside(root, path);
  const st = await statOf(abs);
  if (!st?.isFile()) throw new Error(`no such file: ${path}`);
  const base = { path: relOf(root, abs), name: basename(abs), size: st.size, mtimeMs: Math.round(st.mtimeMs) };
  const mime = IMAGE_MIME[extname(abs).toLowerCase()];
  if (mime) {
    if (st.size > MAX_IMAGE_BYTES) return { ...base, kind: "binary", mime, note: `image over ${MAX_IMAGE_BYTES / 1048576} MB; not previewed` };
    return { ...base, kind: "image", mime, dataUrl: `data:${mime};base64,${(await readFile(abs)).toString("base64")}` };
  }
  // Only what the preview shows is read: a log of a gigabyte was read whole, for its first two megabytes.
  const head = await headOf(abs, MAX_FILE_BYTES);
  if (head.subarray(0, 8192).includes(0)) return { ...base, kind: "binary", mime: null };
  const truncated = st.size > MAX_FILE_BYTES;
  const content = head.toString("utf8");
  let lines = 1;
  for (let i = content.indexOf("\n"); i >= 0; i = content.indexOf("\n", i + 1)) lines++;
  return { ...base, kind: "text", content, truncated, lines: lines - (content.endsWith("\n") ? 1 : 0) };
}
/**
 * A file's first `n` bytes, or all of it where it is shorter: read to its end or to `n`, whichever comes first.
 * @param {string} abs @param {number} n
 */
async function headOf(abs, n) {
  const fh = await open(abs, "r");
  try {
    const buf = Buffer.allocUnsafe(n);
    let got = 0;
    while (got < n) {
      const { bytesRead: k } = await fh.read(buf, got, n - got, got);
      if (!k) break;
      got += k;
    }
    return buf.subarray(0, got);
  } finally {
    await fh.close();
  }
}

/**
 * Files whose relative path contains `q` (case-insensitive), inside a repository through `git ls-files` (so
 * .gitignore is honoured, untracked files included) — of a repository that names more than MAX_SEARCH_LISTING, those
 * it names first, the answer `truncated` — elsewhere by a bounded walk that skips `.git` and `node_modules`. A
 * repository git does not list — it refuses the repository, is not installed, takes too long — is refused in git's
 * words, never walked: a walk hands out what .gitignore hides. Ranked: a name that starts with the query, then a name
 * that contains it, then a path match.
 * @param {string} root @param {string} q @param {{ limit?: number }} [opts]
 */
export async function searchNames(root, q, { limit = 50 } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  const cap = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  const all = await listAllFiles(root);
  const scored = [];
  for (const rel of all.files) {
    const lower = rel.toLowerCase();
    const name = lower.slice(lower.lastIndexOf("/") + 1);
    const score = !needle ? 3 : name.startsWith(needle) ? 0 : name.includes(needle) ? 1 : lower.includes(needle) ? 2 : -1;
    if (score >= 0) scored.push({ rel, score });
  }
  scored.sort((a, b) => a.score - b.score || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel));
  return {
    files: scored.slice(0, cap).map((s) => ({ path: s.rel, name: basename(s.rel) })),
    total: scored.length,
    truncated: scored.length > cap || all.truncated,
    source: all.source,
  };
}

/** The most folders a mention search names beside its files. */
export const MENTION_FOLDERS = 5;
/** What a letter after it starts a word at: a path's parts, and the words a name is spelt in. */
const WORD_EDGE = new Set(["/", "_", "-", ".", " "]);
/**
 * How tightly `needle`'s letters stand in order in `hay` (both lower-case; `cased`, `hay` as written, says where a
 * capital starts a word): from 0, letters apart, to 99, every one at a word's start and each after the one before —
 * or -1 where they are not all there in order. Read over the shortest stretch that holds them, ending where the
 * leftmost match ends.
 * @param {string} hay @param {string} cased @param {string} needle
 */
export function lettersInOrder(hay, cased, needle) {
  let j = 0;
  let end = -1;
  for (let i = 0; i < hay.length && j < needle.length; i++) if (hay[i] === needle[j] && ++j === needle.length) end = i;
  if (end < 0) return -1;
  let start = end;
  for (let i = end, k = needle.length - 1; i >= 0 && k >= 0; i--) {
    if (hay[i] !== needle[k]) continue;
    start = i;
    k--;
  }
  let score = 0;
  let prev = -2;
  for (let i = start, k = 0; i <= end && k < needle.length; i++) {
    if (hay[i] !== needle[k]) continue;
    const capital = cased[i] !== hay[i] && i > 0 && cased[i - 1] === hay[i - 1] && /[a-z]/.test(hay[i - 1]);
    score += 1 + (prev === i - 1 ? 2 : 0) + (i === 0 || WORD_EDGE.has(hay[i - 1]) || capital ? 2 : 0);
    prev = i;
    k++;
  }
  const gaps = end - start + 1 - needle.length;
  return Math.max(0, Math.min(99, Math.round((score / (5 * needle.length)) * 99 - gaps)));
}
/**
 * How well a path answers what was typed after an `@`, higher first, -1 for not at all: its name the word typed, then
 * starting with it, then holding it; the path holding it; then the letters typed in order in its name, then in the
 * path (`lettersInOrder`). A word typed with a `/` is a path's: only the path is read. A folder's path ends with `/`.
 * @param {string} rel @param {string} needle  lower-case, `/` between a path's parts
 */
export function mentionRank(rel, needle) {
  const lower = rel.toLowerCase();
  const bare = lower.endsWith("/") ? lower.slice(0, -1) : lower;
  const at = bare.lastIndexOf("/") + 1;
  const name = bare.slice(at);
  const pathOnly = needle.includes("/");
  if (!pathOnly) {
    if (name === needle) return 600;
    if (name.startsWith(needle)) return 500;
    if (name.includes(needle)) return 400;
  }
  if (lower.includes(needle)) return 300;
  if (!pathOnly) {
    const s = lettersInOrder(name, rel.slice(at, at + name.length), needle);
    if (s >= 0) return 200 + s;
  }
  const s = lettersInOrder(lower, rel, needle);
  return s >= 0 ? 100 + s : -1;
}
/**
 * What an `@` in the message box offers (the owner's of 11-04: "press @ and tag the files from a project"): the files
 * and folders of the project whose names answer what was typed, best first (`mentionRank`), from the listing the name
 * search reads — the files up to `limit`, the folders up to MENTION_FOLDERS. Typed to a folder's `/` (`src/app/`),
 * what is in it instead: its folders, then its files, by name, up to `limit` of each — `under` names it.
 * @param {string} root @param {string} q @param {{ limit?: number }} [opts]
 */
export async function findMentions(root, q, { limit = 12 } = {}) {
  const needle = String(q || "").trim().replace(/\\/g, "/").toLowerCase();
  const cap = Math.max(1, Math.min(100, Math.floor(Number(limit) || 12)));
  const all = await listAllFiles(root);
  /** Every folder that holds a listed file, as `a/b/`. @type {Set<string>} */
  const folders = new Set();
  for (const rel of all.files) for (let i = rel.indexOf("/"); i >= 0; i = rel.indexOf("/", i + 1)) folders.add(rel.slice(0, i + 1));
  const named = (/** @type {string} */ rel) => ({ path: rel, name: basename(rel) });
  const base = { truncated: all.truncated, source: all.source };
  if (needle.endsWith("/")) {
    const under = [...folders].find((f) => f.toLowerCase() === needle) ?? null;
    if (under) {
      const inside = (/** @type {string} */ rel) => rel.startsWith(under) && !rel.slice(under.length, -1).includes("/");
      const byPath = (/** @type {string} */ a, /** @type {string} */ b) => a.localeCompare(b, undefined, { sensitivity: "base" });
      const dirs = [...folders].filter((f) => f !== under && inside(f)).sort(byPath);
      const files = all.files.filter((rel) => rel.startsWith(under) && !rel.slice(under.length).includes("/")).sort(byPath);
      return { ...base, under, folders: dirs.slice(0, cap).map(named), files: files.slice(0, cap).map(named) };
    }
  }
  if (!needle) return { ...base, under: null, folders: [], files: [] };
  /** Which of two stands first: the higher rank, then the shorter path, then by the path's letters. @param {{ rel: string, score: number }} a @param {{ rel: string, score: number }} b */
  const first = (a, b) => b.score - a.score || a.rel.length - b.rel.length || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  /**
   * The best `n`, kept as they come: a letter or two typed answers nearly every path of a big project, and each key
   * typed asks again — never the whole list ranked. @param {Iterable<string>} rels @param {number} n
   */
  const best = (rels, n) => {
    /** @type {{ rel: string, score: number }[]} */
    const top = [];
    for (const rel of rels) {
      const score = mentionRank(rel, needle);
      if (score < 0) continue;
      const s = { rel, score };
      if (top.length === n && first(s, /** @type {{ rel: string, score: number }} */ (top.at(-1))) >= 0) continue;
      let i = top.length;
      while (i > 0 && first(s, top[i - 1]) < 0) i--;
      top.splice(i, 0, s);
      if (top.length > n) top.pop();
    }
    return top.map((s) => named(s.rel));
  };
  return { ...base, under: null, files: best(all.files, cap), folders: best(folders, MENTION_FOLDERS) };
}
/**
 * The listing under way for each folder, shared: a search typed key by key asks again before the last answer came, and
 * each started a git of its own. It goes when it is done — the next search lists the folder as it is then.
 * @type {Map<string, Promise<{ files: string[], truncated: boolean, source: "git" | "walk" }>>}
 */
const listing = new Map();
/**
 * The project's files, relative to `root` with `/`, as the name search and the `@` list read them — the listing under
 * way shared. The `@#` list keeps a language server's names to them.
 * @param {string} root
 */
export function listAllFiles(root) {
  const under = listing.get(root);
  if (under) return under;
  const p = listFiles(root).finally(() => {
    if (listing.get(root) === p) listing.delete(root);
  });
  listing.set(root, p);
  return p;
}
/**
 * The files `git ls-files` names in a folder, each name read as git writes it: up to MAX_SEARCH_LISTING bytes of them,
 * where git is stopped and the list is `truncated`, the name it was writing left out. Else why it listed nothing, in
 * words: no git to run, out of time, git that could not run or was cut, or git's own refusal (its first line). A search
 * asks at each key typed: git — the one `gitProgram` finds, so a stop ends git itself — starts on a thread of the
 * spawn pool (`git/spawn-pool.js`), not the server's.
 * @param {string} root @returns {Promise<{ files: string[], truncated: boolean } | { failed: string }>}
 */
async function gitFiles(root) {
  // Whatever launched Filament may have exported a GIT_DIR (see git/snapshot.js): the folder decides, nothing else.
  const env = withoutOwnSwitch({ ...process.env });
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_NAMESPACE"]) delete env[k];
  const program = await gitProgram();
  const { failure: e, stdout, stderr } = await execFileOffThread(
    program.file,
    [...OWN_CONFIG, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, env: program.env(env), timeout: LIST_MS, maxBuffer: MAX_SEARCH_LISTING, windowsHide: true },
  );
  const names = stdout.split("\0");
  if (!e) return { files: names.filter(Boolean), truncated: false };
  if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && e.message.startsWith("stdout")) {
    names.pop();
    return { files: names.filter(Boolean), truncated: true };
  }
  if (e.code === "ENOENT") return { failed: notStarted(root) };
  if (e.code == null && e.killed) return { failed: `git ls-files did not finish within ${LIST_MS / 1000} s` };
  // A process that could not run, or was cut — its thread stopped, its files could not be made, its errors past what
  // a call keeps —, says so in its own words; only one that ran and failed is git's refusal, in git's words.
  if (typeof e.code === "string") return { failed: `git ls-files could not run (${e.message})` };
  return { failed: refusedWords({ code: typeof e.code === "number" ? e.code : -1, out: "", err: stderr }) };
}
/** @param {string} root @returns {Promise<{ files: string[], truncated: boolean, source: "git" | "walk" }>} */
async function listFiles(root) {
  const fromGit = await gitFiles(root);
  if ("files" in fromGit) return { ...fromGit, source: "git" };
  // A `.git` in the folder or above it: a repository git does not list, whatever language git says why in.
  if (gitAbove(root)) throw new Error(`${fromGit.failed} — a git repository's files are listed by git alone, which leaves out what .gitignore hides`);
  /** @type {string[]} */
  const files = [];
  const stack = [root];
  let truncated = false;
  // A folder at a time, without holding the event loop: up to MAX_SEARCH_WALK files.
  while (stack.length && !truncated) {
    const dir = /** @type {string} */ (stack.pop());
    let list;
    try {
      list = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of list) {
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) stack.push(join(dir, d.name));
      } else if (d.isFile()) {
        files.push(relOf(root, join(dir, d.name)));
        if (files.length >= MAX_SEARCH_WALK) {
          truncated = true;
          break;
        }
      }
    }
  }
  return { files, truncated, source: "walk" };
}

/**
 * The folder browser's one level: the subdirectories of `path`, its parent, and — with no path — the top level,
 * which is the allowed roots when some are listed, else this machine's filesystem roots (the drives on Windows,
 * `/` elsewhere), each looked at off the server's thread, a moment at most: a drive or share that does not answer — a
 * mapped drive gone offline — is left out, never waited on there (folder-there.js `folderThere`). Hidden folders
 * (dot-prefixed) are left out unless asked for. The caller has already allowed `path`, looked at off the thread; the
 * parent is offered only when it is allowed too (`allowed(parent)`).
 * @param {{ path?: string, hidden?: boolean, roots: string[], allowed: (p: string) => boolean, there?: { ms?: number, statOf?: (path: string) => Promise<unknown> } }} opts
 */
export async function listDirs({ path = "", hidden = false, roots, allowed, there }) {
  if (!path) {
    const top = roots.length ? roots.map((r) => resolve(r)) : driveLetters();
    const answered = await Promise.all(top.map((p) => folderThere(p, there)));
    return { path: "", parent: null, top: true, dirs: top.filter((_, i) => answered[i] === true).map((p) => ({ name: p, path: p })) };
  }
  const abs = resolve(path);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`no such folder: ${path}`);
  let list;
  try {
    list = readdirSync(abs, { withFileTypes: true });
  } catch (/** @type {any} */ e) {
    throw new Error(`cannot list ${path}: ${e.code || e.message}`);
  }
  const dirs = list
    .filter((d) => (d.isDirectory() || (d.isSymbolicLink() && isDirLink(join(abs, d.name)))) && d.name !== ".git" && (hidden || !d.name.startsWith(".")))
    .map((d) => ({ name: d.name, path: join(abs, d.name) }))
    .sort(byName);
  const parent = dirname(abs);
  const isTop = parent === abs || (roots.length && roots.some((r) => samePath(resolve(r), abs)));
  return { path: abs, parent: isTop || !allowed(parent) ? null : parent, top: false, dirs };
}
function isDirLink(p) {
  try {
    return lstatSync(p).isSymbolicLink() && statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function samePath(a, b) {
  const norm = (p) => {
    let r = p;
    try {
      r = realpathSync(p);
    } catch {}
    r = r.replace(/[\\/]+$/, "");
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}
/** The filesystem roots a browser may start from when no roots are listed: `/`, or each drive letter Windows has. */
function driveLetters() {
  if (process.platform !== "win32") return ["/"];
  return Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:${sep}`);
}
