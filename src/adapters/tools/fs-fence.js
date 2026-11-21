// @ts-check
// The filesystem fence for the tools Filament runs on a model's behalf: a path may only resolve inside its root.
// Lexical containment AND real-path containment (a symlink or junction inside the root must not lead outside it),
// case-insensitive on Windows. A path that does not exist yet is checked through its deepest existing ancestor.
// Inside it, what another machine's agents never read (`keptFromAgents`): a repository's own `.git` and a credentials
// folder, by the path's names and where the filesystem resolves it — one rule for every door their reads go through.
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, resolve, dirname, join, relative, sep } from "node:path";
import { credentialFolderOf } from "../../core/secret-files.js";

/** The error a tool shows the model as its result line; a refused path reads like any other tool failure. */
export class HandError extends Error {}

const normCase = (/** @type {string} */ x) => (process.platform === "win32" ? String(x).toLowerCase() : x);
const contained = (/** @type {string} */ x, /** @type {string} */ base) => {
  const a = normCase(x);
  const b = normCase(base.endsWith(sep) ? base : base + sep);
  return a === normCase(base) || a.startsWith(b);
};
/**
 * A drive-relative path (`C:x`) as the shell the hands start in the root reads it: from that drive's current folder,
 * which on the root's own drive is the root and on another is the drive's root. `resolve` reads it from Filament's own
 * folder where that is on the drive, a place the model never named.
 * @param {string} rootAbs @param {string} p
 */
const fromItsDrive = (rootAbs, p) => {
  const m = process.platform === "win32" ? /^([a-z]):(?![\\/])/i.exec(p) : null;
  return m && m[1].toLowerCase() !== rootAbs.slice(0, 1).toLowerCase() ? `${m[1]}:\\${p.slice(2)}` : p;
};
/** Where `p` lands from `rootAbs`, before the fence asks whether it may. @param {string} rootAbs @param {unknown} p */
const landing = (rootAbs, p) => resolve(rootAbs, fromItsDrive(rootAbs, String(p ?? "").replace(/\0/g, "")));

/**
 * The file `p` names from `root`, absolute, as the hands land it and with the case it was said in: what a call says it
 * writes before it runs (the loop's `edits`). It refuses nothing. @param {string} root @param {unknown} p
 */
export const landingOf = (root, p) => landing(resolve(root), p);

/**
 * The file `p` names inside `root` as one key, as the hands resolve it and the fence compares it: two spellings of one
 * file — `./a.txt`, `A.TXT` on Windows, `Q:a.txt` beside `Q:\a.txt` on another drive than the root's — are one key.
 * It refuses nothing. @param {string} root @param {unknown} p
 */
export const fileKey = (root, p) => normCase(landing(resolve(root), p));

/**
 * A name that opens a repository's `.git`, by the names Windows opens it by too (agent/tools.js `GIT_SEGMENT`): with
 * trailing dots or spaces, by its short name (`GIT~1`), or as a stream of the folder.
 */
const GIT_NAME = /^(?:\.git|git~\d+)[. ]*(?::.*)?$/i;

/**
 * A path where the filesystem itself resolves it (`realpathSync.native`: a link on its way at what it opens, and on
 * Windows a short name at its long one), through its deepest part that is there; as written where none of it is.
 * @param {string} abs
 */
export const resolvedPath = (abs) => {
  /** @type {string[]} */
  const rest = [];
  for (let probe = abs; ; probe = dirname(probe)) {
    try {
      return join(realpathSync.native(probe).replace(/^\\\\\?\\(?=[A-Za-z]:)/, ""), ...rest);
    } catch {
      if (dirname(probe) === probe) return abs;
      rest.unshift(basename(probe));
    }
  }
};

/**
 * `keptFromAgents` by a path's names alone, as they stand: a credentials folder anywhere in it, or `.git` below the
 * folder of `bases` that holds it most closely — a worktree Filament keeps inside its repository's `.git`
 * (`filament-worktrees`) is a folder like any other, read below itself.
 * @param {string} p @param {readonly string[]} bases
 */
const keptByNames = (p, bases) => {
  const cred = credentialFolderOf(p);
  if (cred) return cred;
  const base = bases.filter((b) => contained(p, b)).sort((a, b) => b.length - a.length)[0];
  return (base === undefined ? p : relative(base, p)).split(/[\\/]+/).some((n) => GIT_NAME.test(n)) ? ".git" : "";
};

/**
 * What a path is in that another machine's agents never read, in a folder they read: ".git" — a repository's own folder,
 * whose config may hold a remote's URL with a token in it —, or the credentials folder's name (core/secret-files.js);
 * "" where it is in neither. Judged by the path's names and again where the filesystem resolves it, so a link inside the
 * folder, or a short name, opens nothing its own name would not. One rule for every door a caller of theirs without
 * Full control reads through: a command read as only reading (read-only-commands.js, read-only-powershell.js), the file
 * route (http/admin/remote.js `agentFileRefusal`), the loop's read, grep and glob (hands.js), a coding agent's read or
 * search (app/agent-permits.js `readPast`) and Filament's MCP Glob and Grep (http/mcp.js).
 * @param {string} path  whole
 * @param {readonly string[]} bases  the folders the caller reads: its working folder and the folders added to it
 */
export function keptFromAgents(path, bases) {
  const abs = resolve(path);
  return keptByNames(abs, bases.map((b) => resolve(b))) || keptByNames(resolvedPath(abs), bases.map((b) => resolvedPath(resolve(b))));
}

/**
 * Whether a path is in a repository's own .git folder — `keptFromAgents`'s rule for it alone, by the path's names from
 * the folder it is in and again where the filesystem resolves it —, whoever reads: an attachment's contents leave for
 * another conversation, maybe another machine (app/agent/attach.js).
 * @param {string} path  whole @param {readonly string[]} bases  the folders the caller reads
 */
export function inGitFolder(path, bases) {
  const abs = resolve(path);
  /** @param {string} p @param {string[]} bs */
  const named = (p, bs) => {
    const base = bs.filter((b) => contained(p, b)).sort((a, b) => b.length - a.length)[0];
    return (base === undefined ? p : relative(base, p)).split(/[\\/]+/).some((n) => GIT_NAME.test(n));
  };
  return named(abs, bases.map((b) => resolve(b))) || named(resolvedPath(abs), bases.map((b) => resolvedPath(resolve(b))));
}

/** What `keptFromAgents` found, in words. @param {string} kept */
export const keptWords = (kept) => (kept === ".git" ? "a repository's own .git folder" : `a credentials folder (${kept})`);
/** Why a read of `asked` is refused another machine's agents, in words. @param {string} asked  as named @param {string} kept  `keptFromAgents`'s */
export const keptRefusal = (asked, kept) => `another machine's agents never read ${kept === ".git" ? "a repository's own .git folder" : "a credentials folder"}; ${asked} is in ${kept === ".git" ? "one" : kept}`;

/**
 * Whether a file found under `dir` — by a walk that follows no link, so each lies where its names say — is kept from
 * another machine's agents (`keptFromAgents`), `dir` resolved once for them all.
 * @param {string} dir  the folder walked, itself judged already @param {readonly string[]} bases
 * @returns {(file: string) => boolean}
 */
export function keptBelow(dir, bases) {
  const at = resolve(dir);
  const real = resolvedPath(at);
  const realBases = bases.map((b) => resolvedPath(resolve(b)));
  return (file) => !!keptByNames(join(real, relative(at, resolve(file))), realBases);
}

/** How many folders `holdsKept` looks through before it says it cannot tell. */
const HOLDS_MAX = 5000;
/**
 * Whether the tree under `dir` holds what another machine's agents never read (`keptFromAgents`), for a command that
 * reads every file below a folder: where, by its path, at the first found; "many" past `HOLDS_MAX` folders, too many to
 * tell here; null for none. Nearest folders first, so a repository's own `.git` is found at once. A link is judged by
 * where it leads and not walked into, as such a command leaves it. Folders alone: the `.git` a worktree has is a file
 * that names its git folder and holds no config, and a search of a worktree, or of a copy, would ask every time for it.
 * @param {string} dir @param {readonly string[]} bases
 * @returns {{ kept: string, at: string } | "many" | null}
 */
export function holdsKept(dir, bases) {
  const realBases = bases.map((b) => resolvedPath(resolve(b)));
  const todo = [resolvedPath(resolve(dir))];
  for (let i = 0; i < todo.length; i++) {
    if (i >= HOLDS_MAX) return "many";
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = readdirSync(todo[i], { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile()) continue;
      const p = join(todo[i], e.name);
      const kept = keptByNames(e.isSymbolicLink() ? resolvedPath(p) : p, realBases);
      if (kept) return { kept, at: p };
      if (e.isDirectory()) todo.push(p);
    }
  }
  return null;
}

/**
 * The absolute path of `p` inside `root`; a HandError when it is not inside. `reads`: the folders a read may also land
 * in (`loop.addedFolders`, HarnessV4_Overnight_Plan OV-D22; a run that only reads, its repository's worktrees too — the
 * owner's of 11-09), each held to the same two tests; a caller that writes passes none. `theirs`: the read is for
 * another machine's agents without Full control, and a path inside that `keptFromAgents` names is refused too, its
 * error's `kept` saying what it is in.
 * @param {string | null | undefined} root
 * @param {unknown} p
 * @param {{ fenced?: boolean, reads?: readonly string[], theirs?: boolean }} [o]
 * @returns {string}
 */
export function resolveInside(root, p, { fenced = true, reads = [], theirs = false } = {}) {
  if (!root) throw new HandError("no folder is configured for this session's file tools");
  const rootAbs = resolve(root);
  if (!existsSync(rootAbs)) throw new HandError(`the hands root does not exist: ${root}`);
  const abs = landing(rootAbs, p);
  if (!fenced) return abs;
  /** @param {string} base */
  const lexically = (base) => contained(abs, resolve(base));
  const bases = [rootAbs, ...reads];
  // A path outside is refused by its words, before the disk is asked: a drive or a share that is not there is never
  // looked for.
  if (!bases.some(lexically)) throw new HandError(`"${p}" resolves outside the allowed task folder${reads.length ? " and the folders added to it" : ""}`);
  let probe = abs;
  while (!existsSync(probe)) {
    const up = dirname(probe);
    // A drive's root is its own parent: an added folder on a drive that is gone has nothing above it that exists.
    if (up === probe) throw new HandError(`"${p}" is on a drive or share that is not there`);
    probe = up;
  }
  const probeReal = realpathSync(probe);
  /** @param {string} base */
  const really = (base) => existsSync(base) && contained(probeReal, realpathSync(resolve(base)));
  if (!bases.some(really)) throw new HandError(`"${p}" reaches outside the allowed task folder through a link`);
  const kept = theirs ? keptFromAgents(abs, bases) : "";
  if (kept) throw Object.assign(new HandError(keptRefusal(`"${p}"`, kept)), { kept });
  return abs;
}
