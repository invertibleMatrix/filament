// @ts-check
// The file tools of a builder in a patch workspace (adapters/git/patch.js, the owner's plan of 11-09 for big repos): the
// same tools and answers as in a worktree at the same paths, with no checkout behind them. A read reads the overlay's
// file, else copies it up from the commit the overlay is laid over (`readFrom`) — as a checkout writes it — and reads
// that; a link is followed inside the project, a folder or a submodule is no file; past the project, the developer's
// ignored dependency folders (node_modules, a virtualenv) are read where they are, as a worktree reads them through its
// links. A write or an edit copies the file up first, so the read-first and changed-since guards (hands.js `opWrite`)
// behave as in a worktree, and refuses a path whose folder is a file or a link in the project. A search asks git which
// of the project's files match (`git grep` on `readFrom`, PCRE where git has it), copies those up, and searches the
// overlay — the overlay's own files as they stand, the rest as the project has them — with the hands' own grep, so its
// answer reads as a worktree's. A listing joins the project's files (`git ls-tree`) and the overlay's. A file Git LFS
// keeps is copied up as its pointer, and a read fetches it as a worktree's read does (patch.js `fetchPatchLfs`). Each
// runs once a move to a worktree under way is done, and a move waits for those at work in the overlay
// (patch.js `inOverlay`); after one, the plain hands answer.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEPENDENCY_DIRS, gitBytes } from "../git/worktree.js";
import { copyUp, copyUpMany, entriesOf, fetchPatchLfs, inOverlay, overlayFiles, relOf } from "../git/patch.js";
import { HandError, resolveInside, runHand, tooBigToRead } from "./hands.js";
import { globToRegExp } from "../../core/path-glob.js";
import { keptOut } from "../../core/read-rules.js";

/** The tools a patch workspace answers itself; every other runs as it does anywhere. */
export const PATCH_HANDS = Object.freeze(new Set(["read", "write", "edit", "grep", "glob"]));
/** The most of the project's files a search copies up to search them: past it, the first ones are searched, said. */
export const GREP_COPY_MAX = 5000;
/** A multiline search reads every file under its path: past this many, its workspace moves to a worktree first. */
export const MULTILINE_MAX = 2000;
/** The folders a listing passes over, as the hands' walk does (hands.js GLOB_SKIP_DIRS). */
const GLOB_SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", ".next", ".cache", "__pycache__", ".venv", "venv", "target"]);
/** As hands.js GLOB_MAX_PATHS, GLOB_LIMIT_MAX and its budget. */
const GLOB_MAX_PATHS = 200;
const GLOB_LIMIT_MAX = 2000;
const MAX_BYTES = 50 * 1024;
const NOTICE_ROOM = 512;
/** @param {unknown} maxBytes */
const contentBudget = (maxBytes) => Math.max(1024, Math.min(MAX_BYTES, Math.floor(Number(maxBytes)) || MAX_BYTES)) - NOTICE_ROOM;
/** @param {string[]} lines @param {number} budget */
const headLinesWithin = (lines, budget) => {
  let bytes = 0;
  let n = 0;
  for (const l of lines) {
    bytes += Buffer.byteLength(l) + 1;
    if (bytes > budget && n > 0) break;
    n++;
  }
  return n;
};
/** @param {string | null | undefined} s */
const firstLine = (s) => String(s || "").split(/\r?\n/)[0].slice(0, 200);

/**
 * A builder's patch workspace as its hands reach it: the workspace (patch.js `PatchWorkspace`) while it is one — null
 * once it moved to a worktree —, the wait for a move under way, and the move itself — for a search too wide to answer
 * without a checkout too —, with the words it leaves for the call it ran under (`said`).
 * @typedef {{ now: () => import("../git/patch.js").PatchWorkspace | null, settled: () => Promise<void>, move: (why: string) => Promise<{ ok: true, said: string | null } | { ok: false, error: string }> }} PatchHold
 */

/** A search that needs a worktree first, said by it from inside the overlay: its move runs once the search is out. */
class MoveFirst {
  /** @param {string} why */
  constructor(why) {
    this.why = why;
  }
}

/**
 * One file tool in a patch workspace, answered as the hands answer it in a worktree at the same paths (`runHand`'s own
 * options pass through: `fetchLfs` reads a file Git LFS keeps once it moved). A workspace that moved to a worktree
 * meanwhile is answered by the plain hands.
 * @param {string} name @param {any} input @param {PatchHold} hold @param {any} o  `runHand`'s options: `root`, `fenced`, `reads`, `theirs`, …
 */
export async function patchHand(name, input, hold, o) {
  await hold.settled();
  const ws = hold.now();
  if (!ws || !PATCH_HANDS.has(name)) return runHand(name, input, o);
  try {
    // Beside the others at work in the overlay, never under its move (the review of d65a984a9: side-by-side calls
    // copied files up into a folder a move had set aside).
    return await inOverlay(ws, async () => {
      if (hold.now() !== ws) return runHand(name, input, o);
      switch (name) {
        case "read":
          return patchRead(ws, input, o);
        case "write":
        case "edit":
          return patchWrite(ws, name, input, o);
        case "grep":
          return patchGrep(ws, input, o);
        default:
          return patchGlob(ws, input, o);
      }
    });
  } catch (/** @type {any} */ e) {
    if (!(e instanceof MoveFirst)) throw e;
    const moved = await hold.move(e.why);
    if (!moved.ok) throw new HandError(`this search needs a worktree, which could not be made: ${moved.error}`);
    return runHand(name, input, o);
  }
}

/**
 * Where a dependency folder of the developer's stands for a path of the workspace that is in none of the project's
 * files: the same path in the developer's repository, where its first folder is one of `DEPENDENCY_DIRS` — at the
 * project's top, or at the session folder's — and git does not track it; null elsewhere.
 * @param {import("../git/patch.js").PatchWorkspace} ws @param {string} rel
 */
const dependencyOf = (ws, rel) => {
  const parts = rel.split("/");
  const under = ws.rel ? ws.rel.split("/") : [];
  const at = parts.slice(0, under.length).join("/") === under.join("/") && DEPENDENCY_DIRS.includes(parts[under.length]) ? under.length : DEPENDENCY_DIRS.includes(parts[0]) ? 0 : -1;
  if (at < 0) return null;
  const top = join(ws.repo, ...parts.slice(0, at + 1));
  return existsSync(top) ? { top, abs: join(ws.repo, ...parts) } : null;
};

/** @param {import("../git/patch.js").PatchWorkspace} ws @param {any} input @param {any} o */
async function patchRead(ws, input, o) {
  const abs = resolveInside(o.root, input.path, { fenced: o.fenced, reads: o.reads, theirs: o.theirs });
  const rel = relOf(ws, abs);
  if (rel == null || rel === "") return runHand("read", input, o);
  const up = await copyUp(ws, rel);
  const fetchLfs = (/** @type {string} */ at) => fetchPatchLfs(ws, at);
  if (up.kind === "file") return runHand("read", up.rel === rel ? input : { ...input, path: join(ws.dest, ...up.rel.split("/")) }, { ...o, fetchLfs });
  if (up.kind === "big") throw new HandError(tooBigToRead(String(input.path), up.size));
  if (up.kind === "link") throw new HandError(`${input.path} is a link to ${up.target}, outside the project: read it there`);
  if (up.kind === "none") {
    const dep = dependencyOf(ws, rel);
    if (dep) return runHand("read", { ...input, path: dep.abs }, { ...o, root: dep.top, reads: [] });
  }
  throw new HandError(`no such file: ${input.path}`);
}

/** @param {import("../git/patch.js").PatchWorkspace} ws @param {string} name @param {any} input @param {any} o */
async function patchWrite(ws, name, input, o) {
  const abs = resolveInside(o.root, input.path, { fenced: o.fenced });
  const rel = relOf(ws, abs);
  if (rel == null || rel === "") return runHand(name, input, o);
  // A folder on its way the project has as a file or a link: a worktree's write would fail there, or land elsewhere.
  const ups = rel.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));
  const entries = await entriesOf(ws, [...ups, rel]);
  for (const u of ups) {
    const e = entries.get(u);
    if (e && e.type === "blob" && !isDir(join(ws.dest, ...u.split("/")))) throw new HandError(`${input.path} cannot be written: ${u} is ${e.mode === "120000" ? "a link" : "a file"} in the project, not a folder`);
  }
  const at = entries.get(rel);
  if (at?.mode === "120000" && !existsSync(abs)) throw new HandError(`${input.path} is a link in the project: write the file it points to`);
  if (at && at.type !== "blob") throw new HandError(`${input.path} is a folder in the project, not a file`);
  if (at) {
    const up = await copyUp(ws, rel);
    if (up.kind === "big") throw new HandError(tooBigToRead(String(input.path), up.size));
  }
  return runHand(name, input, o);
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
 * The project's files under `rel` that git finds the pattern in, at `readFrom`: `git grep -l` with PCRE, else extended
 * regular expressions where git has no PCRE or refuses the pattern there; its glob as a pathspec where git reads it so.
 * Null where git could search with neither: the search then runs on the overlay as it stands.
 * @param {import("../git/patch.js").PatchWorkspace} ws @param {any} input @param {string} rel @param {AbortSignal | null} signal
 */
async function gitMatches(ws, input, rel, signal) {
  const pattern = String(input.pattern ?? "");
  const glob = typeof input.glob === "string" && input.glob.trim() && !/[{}]/.test(input.glob) ? input.glob.trim() : "";
  const under = rel || ".";
  const spec = glob ? [`:(glob)${rel ? `${rel}/` : ""}${glob.includes("/") ? glob.replace(/^\/+/, "") : `**/${glob}`}`] : [`:(literal)${under}`];
  for (const how of input.literal ? ["-F"] : ["-P", "-E"]) {
    const r = await gitBytes(["grep", "-l", "-z", "--no-color", ...(input.ignoreCase ? ["-i"] : []), how, "-e", pattern, ws.readFrom, "--", ...spec], { cwd: ws.repo, signal });
    if (r.code === 1) return [];
    if (r.code !== 0) continue;
    const prefix = `${ws.readFrom}:`;
    return r.out.toString("utf8").split("\0").filter(Boolean).map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));
  }
  return null;
}

/** @param {import("../git/patch.js").PatchWorkspace} ws @param {any} input @param {any} o */
async function patchGrep(ws, input, o) {
  const abs = resolveInside(o.root, input.path || ".", { fenced: o.fenced, reads: o.reads, theirs: o.theirs });
  const rel = relOf(ws, abs);
  if (rel == null) return runHand("grep", input, o);
  const dep = rel ? dependencyOf(ws, rel) : null;
  const entries = await entriesOf(ws, [rel], { recursive: true, signal: o.signal || null });
  if (dep && !entries.size && !existsSync(abs)) return runHand("grep", { ...input, path: dep.abs }, { ...o, root: dep.top, reads: [], fullPaths: true });
  if (!entries.size && !existsSync(abs)) throw new HandError(`no such file or folder: ${input.path || "."}`);
  /** @type {string[] | null} */
  let found;
  if (input.multiline === true) {
    // git searches line by line: a multiline search reads every file under its path, few enough of them.
    found = [...entries.keys()];
    if (found.length > MULTILINE_MAX) throw new MoveFirst(`a multiline search over ${found.length} files`);
  } else found = await gitMatches(ws, input, rel, o.signal || null);
  let note = "";
  if (found?.length) {
    const sorted = [...new Set(found)].sort();
    const taken = sorted.slice(0, GREP_COPY_MAX);
    if (taken.length < sorted.length) note = `\n[Only the first ${GREP_COPY_MAX} of the ${sorted.length} files that may match were searched; narrow the pattern or the path.]`;
    await copyUpMany(ws, taken, entries, { signal: o.signal || null });
  }
  // The search itself runs on the overlay, a folder of real files: there needs to be one at its path.
  if (!existsSync(abs)) return found?.length ? runHand("grep", input, o) : "(no matches)";
  const said = await runHand("grep", input, o);
  return note ? `${said}${note}` : said;
}

/** @param {import("../git/patch.js").PatchWorkspace} ws @param {any} input @param {any} o */
async function patchGlob(ws, input, o) {
  const pattern = String(input?.pattern || "").trim();
  if (!pattern) throw new HandError("glob needs a pattern");
  const base = resolveInside(o.root, String(input?.path || "."), { fenced: o.fenced, reads: o.reads, theirs: o.theirs });
  const rel = relOf(ws, base);
  if (rel == null) return runHand("glob", input, o);
  const here = rel ? (await entriesOf(ws, [rel])).get(rel) : { type: "tree" };
  if (!here && !isDir(base)) {
    const dep = rel ? dependencyOf(ws, rel) : null;
    if (dep && isDir(dep.abs)) return runHand("glob", { ...input, path: dep.abs }, { ...o, root: dep.top, reads: [] });
    throw new HandError(`no such folder: ${input?.path || "."}`);
  }
  // A submodule is a folder, as copy-up reads it: a checkout leaves it empty.
  if ((here && here.type !== "tree" && here.type !== "commit") || (!here && !isDir(base))) throw new HandError(`${input?.path} is a file, not a folder`);
  const sort = input?.sort == null || input.sort === "" ? "path" : String(input.sort);
  if (sort !== "path" && sort !== "modified") throw new HandError(`sort is "path" or "modified", not "${sort}"`);
  const limit = Math.max(1, Math.min(GLOB_LIMIT_MAX, Math.floor(Number(input?.limit) || GLOB_MAX_PATHS)));
  const re = globToRegExp(pattern);
  const byName = !pattern.includes("/") && !pattern.includes("\\");
  const out = keptOut(o.readRules);
  const listed = await gitBytes(["ls-tree", "-r", "-z", "--name-only", "--full-tree", ws.readFrom, "--", `:(literal)${rel || "."}`], { cwd: ws.repo, signal: o.signal || null });
  if (listed.code !== 0) throw new HandError(`glob failed: git could not list the project's files (${firstLine(listed.err) || `exit ${listed.code}`})`);
  const own = overlayFiles(ws, rel);
  const ownSet = new Set(own);
  // What lies under its folder: a submodule's listing names the submodule itself.
  const all = [...new Set([...listed.out.toString("utf8").split("\0").filter(Boolean), ...own])].filter((f) => !rel || f.startsWith(`${rel}/`));
  /** @type {string[]} */
  const matches = [];
  for (const f of all) {
    const r = rel ? f.slice(rel.length + 1) : f;
    const parts = r.split("/");
    // A file is listed where a walk of a worktree would come by it: no folder on its way is one the walk passes over.
    if (parts.slice(0, -1).some((p) => GLOB_SKIP_DIRS.has(p))) continue;
    if (re.test(byName ? parts[parts.length - 1] : r) && !out?.(join(base, ...parts))) matches.push(r);
  }
  matches.sort();
  if (sort === "modified") {
    // The newest first: what the builder wrote or read is in the overlay, newer than the project's files, which keep
    // their path order behind them.
    const when = new Map(matches.map((m) => [m, ownSet.has(rel ? `${rel}/${m}` : m) ? mtimeOf(join(base, ...m.split("/"))) : 0]));
    matches.sort((a, b) => /** @type {number} */ (when.get(b)) - /** @type {number} */ (when.get(a)));
  }
  if (!matches.length) return `No files match ${pattern} under ${input?.path || "the task folder"}.`;
  const shown0 = matches.slice(0, limit).map((p) => (o.redact ? o.redact(p) : p));
  const fit = headLinesWithin(shown0, contentBudget(o.maxBytes));
  const shown = shown0.slice(0, fit);
  const found = `${matches.length.toLocaleString()} match${matches.length === 1 ? "" : "es"}`;
  return (
    shown.join("\n") +
    (fit < shown0.length
      ? `\n[${fit} of ${matches.length} paths shown — past this result's budget. Use a narrower pattern or path.]`
      : matches.length > limit
        ? `\n${limit} paths limit reached (${found}). ${limit < GLOB_LIMIT_MAX ? `Use limit=${Math.min(GLOB_LIMIT_MAX, limit * 2)} for more, or a narrower pattern.` : "That is the most one listing returns; use a narrower pattern or path."}`
        : "")
  );
}
/**
 * The instruction files a turn in a patch workspace is told (agent/instructions.js `instructionsBlock`'s `read`, as the
 * turn's own read of its working folder found them): the overlay's folders read from the developer's repository at the
 * same paths, as a worktree of it holds them; none of the folders that hold the overlay (the repository's git folder
 * and up), which a worktree's walk never reaches — its `.git` stops it; the person's own as they were read.
 * @param {Record<string, { file: string, text: string | null }>} read @param {import("../git/patch.js").PatchWorkspace} ws
 * @returns {Record<string, { file: string, text: string | null }>}
 */
export function instructionsOver(read, ws) {
  /** @type {Record<string, { file: string, text: string | null }>} */
  const out = {};
  for (const [abs, r] of Object.entries(read)) {
    const rel = relOf(ws, abs);
    if (rel != null) out[abs] = { file: r.file, text: textAt(join(ws.repo, ...rel.split("/"))) };
    else out[abs] = relOf({ ...ws, dest: dirname(abs) }, ws.dest) != null ? { file: r.file, text: null } : r;
  }
  return out;
}
/** @param {string} p */
const textAt = (p) => {
  try {
    return statSync(p).isFile() ? readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
};
/** @param {string} p */
const mtimeOf = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};
