// @ts-check
// Sparse copies of a big repository (the owner's plan of 11-09 for big repos, phase 2): an editing helper's copy holds
// the folders its work is in — its cone —, where a checkout of every file took its time. Made without git's porcelain
// `sparse-checkout`, which may switch the repository's shared configuration to per-worktree configuration
// (extensions.worktreeConfig) under every worktree of the developer's: the copy's sparse-checkout file is written in
// git's record of it, and every git call that reads it is given the settings on its command line (`SPARSE_CONFIG`) —
// the shared configuration's bytes never change. A capture of any sparse checkout keeps the files outside its cone as
// its index has them (`skippedPaths`, `presentOf`: snapshot.js), never deleted.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { lstat, open, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { firstLine, git, plainIndex } from "./snapshot.js";

/**
 * What every git call that reads or applies a copy's cone is given: sparse checkout on, in cone mode, a full index in
 * one file (never a sparse one, whose `sdir` extension a capture cannot start from, nor a split one, whose `link` names
 * a shared part elsewhere), and the checkout's files written on every core.
 */
export const SPARSE_CONFIG = Object.freeze(["-c", "core.sparseCheckout=true", "-c", "core.sparseCheckoutCone=true", "-c", "index.sparse=false", "-c", "core.splitIndex=false", "-c", "checkout.workers=0"]);
/**
 * git's own rewrite of an index — the one `GIT_INDEX_FILE` names, else the checkout's — into one whose bytes say it
 * all: a sparse index's folders expanded into their files, a split index's shared part taken in, every entry's flags
 * kept. A copy's index may be either all the same: its helper's own git reads the repository's configuration.
 */
export const WHOLE_INDEX = Object.freeze(["-c", "index.sparse=false", "-c", "core.splitIndex=false", "update-index", "--force-write-index"]);
/** A repository whose newest copy took this long to check out is big (worktree.js `lastCheckout`). */
export const BIG_CHECKOUT_MS = 5_000;
/** A repository whose index holds more entries than this is big. */
export const BIG_ENTRIES = 20_000;
/** A cone that holds this share of the commit's entries or more is checked out whole: a sparse copy saves too little. */
export const WIDE_SHARE = 0.5;
/** How long a cone's checkout may take. */
const CHECKOUT_MS = 5 * 60_000;

/**
 * How many entries an index holds, from its header alone (as `plainIndex` reads it): null where the file is none.
 * @param {string} file
 */
export async function indexEntries(file) {
  /** @type {import("node:fs/promises").FileHandle | null} */
  let fh = null;
  try {
    fh = await open(file, "r");
    const b = Buffer.alloc(12);
    const { bytesRead } = await fh.read(b, 0, 12, 0);
    return bytesRead === 12 && b.toString("latin1", 0, 4) === "DIRC" ? b.readUInt32BE(8) : null;
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}

/**
 * Whether a repository is big, for a copy of it: its newest copy took `BIG_CHECKOUT_MS` or more to check out
 * (`checkoutMs`, worktree.js `lastCheckout`), its index holds more than `BIG_ENTRIES` entries, or `commit`'s attributes
 * store files with Git LFS, whose checkout fetches each. Why, in a word — "slow", "entries", "lfs" —, or null.
 * @param {string} repo  the repository's top folder
 * @param {{ commit?: string, checkoutMs?: number | null }} [o]
 * @returns {Promise<"slow" | "entries" | "lfs" | null>}
 */
export async function bigRepo(repo, { commit = "HEAD", checkoutMs = null } = {}) {
  if (checkoutMs != null && checkoutMs >= BIG_CHECKOUT_MS) return "slow";
  const at = await git(["rev-parse", "--git-path", "index"], { cwd: repo });
  const file = at.code === 0 && at.out ? resolve(repo, at.out) : null;
  let n = file ? await indexEntries(file) : null;
  // A split index's header counts what moved since its shared part, a sparse one's a folder outside its cone as one
  // entry: one under the line that is no plain index is counted by git, whole — an answer past what one call keeps is
  // more entries than the line by far.
  if (file && n != null && n <= BIG_ENTRIES && !plainIndex(await readFile(file).catch(() => Buffer.alloc(0)), { skipWorktree: true })) {
    const all = await git(["-c", "index.sparse=false", "ls-files", "-z"], { cwd: repo });
    if (all.cut) return "entries";
    if (all.code === 0) n = all.out.split("\0").filter(Boolean).length;
  }
  if (n != null && n > BIG_ENTRIES) return "entries";
  const lfs = await git(["grep", "-q", "-F", "filter=lfs", commit, "--", ":(glob)**/.gitattributes"], { cwd: repo });
  return lfs.code === 0 ? "lfs" : null;
}

/**
 * A path as a cone names it — relative to the repository's top, forward slashes, no `.`, `..` or trailing slash — or
 * null where it is outside the repository. "" is the top.
 * @param {string} repo @param {string} p  relative to the top, or absolute
 */
export function repoPath(repo, p) {
  const s = String(p || "");
  if (/[\r\n]/.test(s)) return null;
  const rel = isAbsolute(s) ? relative(resolve(repo), resolve(s)) : s;
  if (isAbsolute(rel)) return null;
  const n = posix.normalize(rel.replace(/\\/g, "/")).replace(/^(\.\/)+|\/+$/g, "");
  if (n === "." || n === "") return "";
  return n === ".." || n.startsWith("../") ? null : n;
}
/** A path's folder, as `repoPath` names one ("" the top). @param {string} p */
const folderOfPath = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/**
 * Folders with none inside another of them, in order: the cone mode takes one with all it holds.
 * @param {Iterable<string>} folders
 */
export function narrowest(folders) {
  const sorted = [...new Set([...folders].filter(Boolean))].sort();
  /** @type {string[]} */
  const out = [];
  for (const f of sorted) if (!out.some((g) => f.startsWith(`${g}/`))) out.push(f);
  return out;
}

/**
 * A copy's cone: the folders its work is in. The session folder's place in the repository (the top adds nothing: its
 * files come with every cone); the folders of `files` — those already changed, or a patch's —, whether `commit` has
 * them or not; and `paths` — a brief's, the files a move read — where `commit` has them: a folder itself, a file its
 * folder. With every one of them, the cone mode brings the files at the top and in each parent folder (a package's
 * build manifest, the repository's).
 * @param {string} repo @param {string} commit
 * @param {{ rel?: string, files?: readonly string[], paths?: readonly string[] }} [o]  relative to the top, or absolute
 * @returns {Promise<string[]>}
 */
export async function coneOf(repo, commit, { rel = "", files = [], paths = [] } = {}) {
  /** @type {Set<string>} */
  const folders = new Set();
  const at = repoPath(repo, rel);
  if (at) folders.add(at);
  for (const f of files) {
    const p = repoPath(repo, f);
    if (p) folders.add(folderOfPath(p));
  }
  const types = await typesIn(repo, commit, paths.map((p) => repoPath(repo, p)).filter((p) => !!p).map(String));
  for (const [p, type] of types) {
    if (type === "tree") folders.add(p);
    else if (type) folders.add(folderOfPath(p));
  }
  return narrowest(folders);
}

/**
 * What `commit` has at each path — "tree" (a folder), "blob" (a file), "commit" (a submodule) —, null where it has
 * nothing there: one git run for all of them, each line `<commit>:<path>` answered by its type, or `… missing`.
 * @param {string} repo @param {string} commit @param {readonly string[]} paths  as `repoPath` names them
 * @returns {Promise<Map<string, string | null>>}
 */
export async function typesIn(repo, commit, paths) {
  const asked = [...new Set(paths.filter(Boolean))];
  /** @type {Map<string, string | null>} */
  const out = new Map();
  if (!asked.length) return out;
  const r = await git(["cat-file", "--batch-check=%(objecttype)"], { cwd: repo, input: asked.map((p) => `${commit}:${p}\n`).join("") });
  const lines = r.code === 0 ? r.out.split(/\r?\n/) : [];
  asked.forEach((p, i) => out.set(p, ["tree", "blob", "commit"].includes(lines[i]) ? lines[i] : null));
  return out;
}

/**
 * How many entries `commit` holds under `folders` — every one where none is named. Infinity where git could not count
 * them all (an answer past what one call keeps): too many, as far as a cone goes.
 * @param {string} repo @param {string} commit @param {readonly string[]} folders
 */
async function entriesUnder(repo, commit, folders) {
  const spec = folders.length ? ["--", ...folders] : [];
  // One byte and a line's end per entry; a git before 2.36 knows no --format, and names each.
  const r = await git(["ls-tree", "-r", "--format=.", commit, ...spec], { cwd: repo });
  if (r.cut) return Infinity;
  if (r.code === 0) return r.out ? r.out.split("\n").length : 0;
  const n = await git(["ls-tree", "-r", "-z", "--name-only", commit, ...spec], { cwd: repo });
  if (n.cut || n.code !== 0) return Infinity;
  return n.out.split("\0").filter(Boolean).length;
}

/**
 * Whether a cone is too wide for a sparse copy: it holds `WIDE_SHARE` of `commit`'s entries or more, or git could not
 * count them. An empty cone — nothing says where the work is — is too wide too: a copy of the top's files alone is no
 * place to work.
 * @param {string} repo @param {string} commit @param {readonly string[]} cone
 */
export async function coneTooWide(repo, commit, cone) {
  if (!cone.length) return true;
  const [part, all] = await Promise.all([entriesUnder(repo, commit, cone), entriesUnder(repo, commit, [])]);
  return !Number.isFinite(part) || !(all > 0) || part >= all * WIDE_SHARE;
}

/** A folder's name as a cone pattern writes it: git's glob characters escaped. @param {string} f */
const escaped = (f) => f.replace(/[\\*?[]/g, "\\$&");
/**
 * The sparse-checkout file of a cone, as git writes one in cone mode: the top's files, each parent folder's own files,
 * and each cone folder whole.
 * @param {readonly string[]} cone
 */
export function conePatterns(cone) {
  const folders = narrowest(cone);
  /** @type {Set<string>} */
  const parents = new Set();
  for (const f of folders) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) parents.add(parts.slice(0, i).join("/"));
  }
  const lines = ["/*", "!/*/"];
  for (const p of [...parents].sort()) lines.push(`/${escaped(p)}/`, `!/${escaped(p)}/*/`);
  for (const f of folders) lines.push(`/${escaped(f)}/`);
  return `${lines.join("\n")}\n`;
}
/** A copy's sparse-checkout file, in git's record of it. @param {string} record */
const patternsFile = (record) => join(record, "info", "sparse-checkout");
/**
 * The cone a copy's sparse-checkout file names: its folders taken whole, the parent folders left out. Empty where it
 * has none.
 * @param {string} record  git's record of the copy
 */
export function readCone(record) {
  let text = "";
  try {
    text = readFileSync(patternsFile(record), "utf8");
  } catch {
    return [];
  }
  const unescape = (/** @type {string} */ s) => s.replace(/\\(.)/g, "$1");
  /** @type {Set<string>} */
  const whole = new Set();
  /** @type {Set<string>} */
  const parents = new Set();
  for (const line of text.split(/\r?\n/)) {
    const neg = /^!\/(.+)\/\*\/$/.exec(line);
    if (neg) parents.add(unescape(neg[1]));
    else {
      const pos = /^\/(.+)\/$/.exec(line);
      if (pos && line !== "/*") whole.add(unescape(pos[1]));
    }
  }
  return narrowest([...whole].filter((f) => !parents.has(f)));
}
/**
 * A copy's cone written whole, in git's record of it: read by every git call given `SPARSE_CONFIG` there, and by none
 * of the developer's.
 * @param {string} record @param {readonly string[]} cone
 */
export function writeCone(record, cone) {
  const file = patternsFile(record);
  mkdirSync(join(record, "info"), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, conePatterns(cone));
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * A new sparse copy of `commit` at `dest`: git's worktree made with no checkout — it counts as half made until the
 * read below writes its index (worktree.js `checkedOutWhole`) —, its cone written in git's record of it, and the
 * commit read into its index and onto its disk with the cone applied: only the cone's files are written. `config`:
 * what each git call is given first (hooks off). Not made, git's words; what was made of it is the caller's to drop.
 * @param {string} repo @param {string} dest @param {string} commit @param {readonly string[]} cone
 * @param {{ config?: readonly string[], signal?: AbortSignal | null }} [o]
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function checkoutSparse(repo, dest, commit, cone, { config = [], signal = null } = {}) {
  const wt = await git([...config, "worktree", "add", "--no-checkout", "--detach", dest, commit], { cwd: repo, timeoutMs: CHECKOUT_MS, signal });
  if (wt.code !== 0) return { ok: false, error: `git worktree add failed: ${firstLine(wt.err || wt.out || wt.error)}` };
  const record = recordOf(dest);
  if (!record) return { ok: false, error: "git made no record of the copy" };
  try {
    writeCone(record, cone);
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `its cone could not be written (${firstLine(e?.message)})` };
  }
  const rt = await git([...config, ...SPARSE_CONFIG, "read-tree", "-mu", "HEAD"], { cwd: dest, timeoutMs: CHECKOUT_MS, signal });
  if (rt.code !== 0) return { ok: false, error: `git read-tree failed: ${firstLine(rt.err || rt.out || rt.error)}` };
  return { ok: true };
}
/** Git's record of a worktree, as its `.git` file names it. @param {string} dest */
const recordOf = (dest) => {
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(dest, ".git"), "utf8"));
    return m ? resolve(dest, m[1]) : null;
  } catch {
    return null;
  }
};

/**
 * A sparse copy holds more folders: each added to its cone, and what they hold read onto its disk — what is in its
 * index as it stands, so neither what the agent staged nor what it changed on disk moves. A file a command already
 * wrote there is taken as a changed one, kept as it is (`presentOf`). Not added, the cone goes back as it was, and
 * git's words say why. `config`: what each git call is given first (hooks off).
 * @param {string} dest  the copy's top folder @param {string} record  git's record of it
 * @param {readonly string[]} folders  as `repoPath` names them
 * @param {{ config?: readonly string[], signal?: AbortSignal | null }} [o]
 * @returns {Promise<{ ok: true, cone: string[], added: string[] } | { ok: false, error: string }>}
 */
export async function widenCone(dest, record, folders, { config = [], signal = null } = {}) {
  const had = readCone(record);
  const cone = narrowest([...had, ...folders]);
  const added = cone.filter((f) => !had.includes(f));
  if (!added.length) return { ok: true, cone: had, added };
  const run = (/** @type {string[]} */ args, /** @type {string | null} */ input = null) => git([...config, ...args], { cwd: dest, timeoutMs: CHECKOUT_MS, signal, input });
  // The tree first — the bits below never change it —, its name as long as the repository's ids, which its index is
  // read by.
  const tree = await run([...SPARSE_CONFIG, "write-tree"]);
  if (tree.code !== 0 || !tree.out) return { ok: false, error: `git write-tree failed: ${firstLine(tree.err || tree.out || tree.error)}` };
  const idBytes = tree.out.length / 2;
  // What a command wrote where the cone does not reach is a changed file to git from here on, never one to overwrite.
  const b = await readIndexOf(record);
  const present = b ? await presentOf(dest, skippedPaths(b, { idBytes }) || []) : [];
  if (present.length) {
    const ui = await run([...SPARSE_CONFIG, "update-index", "--no-skip-worktree", "-z", "--stdin"], `${present.join("\0")}\0`);
    if (ui.code !== 0) return { ok: false, error: `git update-index failed: ${firstLine(ui.err || ui.out || ui.error)}` };
  }
  writeCone(record, cone);
  const rt = await run([...SPARSE_CONFIG, "read-tree", "-mu", tree.out]);
  if (rt.code !== 0) {
    writeCone(record, had);
    return { ok: false, error: `git read-tree failed: ${firstLine(rt.err || rt.out || rt.error)}` };
  }
  return { ok: true, cone, added };
}
/** A copy's own index, or null. @param {string} record */
const readIndexOf = async (record) => {
  try {
    return await readFile(join(record, "index"));
  } catch {
    return null;
  }
};

/**
 * The paths of an index's skip-worktree entries — a sparse checkout's outside —, read from its bytes: versions 2 to 4
 * (4's paths each kept as what of the last one stays, a varint, and the rest). Null where the bytes are no index git
 * writes, or end too soon. `idBytes`: the size of the repository's ids, 20 (SHA-1) or 32 (SHA-256).
 * @param {Buffer} b @param {{ idBytes?: number }} [o]
 * @returns {string[] | null}
 */
export function skippedPaths(b, { idBytes = 20 } = {}) {
  if (b.length < 12 + idBytes || b.toString("latin1", 0, 4) !== "DIRC") return null;
  const version = b.readUInt32BE(4);
  if (version < 2 || version > 4) return null;
  const count = b.readUInt32BE(8);
  const end = b.length - idBytes;
  /** @type {string[]} */
  const out = [];
  /** @type {Buffer} */
  let last = Buffer.alloc(0);
  let at = 12;
  for (let i = 0; i < count; i++) {
    if (at + 42 + idBytes > end) return null;
    const flags = b.readUInt16BE(at + 40 + idBytes);
    let p = at + 42 + idBytes;
    let skip = false;
    if (flags & 0x4000) {
      if (version < 3 || p + 2 > end) return null;
      skip = !!(b.readUInt16BE(p) & 0x4000);
      p += 2;
    }
    /** @type {Buffer} */
    let path;
    if (version === 4) {
      // git's varint: seven bits a byte, each continued byte adding one before the shift.
      let c = b[p++];
      let strip = c & 0x7f;
      while (c & 0x80) {
        if (p >= end) return null;
        c = b[p++];
        strip = ((strip + 1) << 7) | (c & 0x7f);
      }
      const nul = b.indexOf(0, p);
      if (nul < 0 || nul >= end || strip > last.length) return null;
      path = Buffer.concat([last.subarray(0, last.length - strip), b.subarray(p, nul)]);
      at = nul + 1;
    } else {
      const nul = b.indexOf(0, p);
      if (nul < 0 || nul >= end) return null;
      path = b.subarray(p, nul);
      at = at + ((nul - at + 8) & ~7);
    }
    last = path;
    if (skip) out.push(path.toString("utf8"));
  }
  return out;
}

/** A name as a disk that tells no cases apart, or keeps it decomposed (macOS), may hold it. @param {string} s */
const looseName = (s) => s.normalize("NFC").toLowerCase();
/**
 * Of an index's skip-worktree paths, those whose file is on disk all the same — a command wrote it where the cone does
 * not reach —, looked for folder by folder, without blocking: a folder that is not there holds none, nor does any
 * under it, and each that is is read once. A name its folder holds in another case or form is the file where the disk
 * finds it by the index's name.
 * @param {string} top  the checkout's top folder @param {readonly string[]} paths  as the index names them
 * @returns {Promise<string[]>}
 */
export async function presentOf(top, paths) {
  /** @type {Map<string, string[]>} */
  const byFolder = new Map();
  for (const p of paths) {
    const f = folderOfPath(p);
    const names = byFolder.get(f);
    if (names) names.push(p);
    else byFolder.set(f, [p]);
  }
  /** @type {Set<string>} */
  const gone = new Set();
  const under = (/** @type {string} */ f) => {
    for (let d = folderOfPath(f); d; d = folderOfPath(d)) if (gone.has(d)) return true;
    return false;
  };
  /** @type {string[]} */
  const out = [];
  // A folder's parents sort before it.
  for (const f of [...byFolder.keys()].sort()) {
    if (under(f)) {
      gone.add(f);
      continue;
    }
    /** @type {string[]} */
    let held;
    try {
      held = await readdir(join(top, f));
    } catch {
      gone.add(f);
      continue;
    }
    const names = new Set(held);
    const loose = new Set(held.map(looseName));
    for (const p of byFolder.get(f) || []) {
      const name = p.slice(p.lastIndexOf("/") + 1);
      if (names.has(name) || (loose.has(looseName(name)) && (await lstat(join(top, p)).then(() => true, () => false)))) out.push(p);
    }
  }
  return out;
}

/**
 * The words a helper working in a sparse copy is given beside its brief: which folders it holds, and the command that
 * brings in another — a command, not a tool, so no tool's definition rides any prompt.
 * @param {readonly string[]} cone @param {string} cli  Filament's command line as the agent's shell runs it
 */
export const sparseWords = (cone, cli = "filament") =>
  `Your copy of the project is sparse: it holds ${cone.map((f) => `${f}/`).join(", ")} and the files at the top and in their parent folders. Before you read, search or change files in another folder, run \`${cli} workspace widen <folder>\` in your copy to bring it in.`;

/**
 * What a helper's call is told where its sparse copy was widened for a path it read or wrote outside its cone
 * (worktree.js `widenFor`): the folders brought in — or, where they could not be, why, and the command that brings
 * them in.
 * @param {{ ok: true, added: readonly string[], rel: string } | { ok: false, error: string, folder: string, rel: string }} w
 * @param {string} cli  Filament's command line as the agent's shell runs it
 */
export const widenedWords = (w, cli = "filament") =>
  w.ok
    ? `[Filament: ${w.rel} lies outside the folders your sparse copy held: it holds ${w.added.map((f) => `${f}/`).join(", ")} now too.]`
    : `[Filament: ${w.rel} lies outside the folders your sparse copy holds, and ${w.folder}/ could not be brought in (${w.error}): run \`${cli} workspace widen ${w.folder}\` in your copy.]`;
