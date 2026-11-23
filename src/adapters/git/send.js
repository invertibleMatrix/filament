// @ts-check
// A project's copy sent to another machine, and taken in there (the remote plan's cp-send). Sent: its snapshot as git
// sees it — tracked and untracked files, .gitignore respected (snapshot.js `snapshotTree`) — less what stays here
// (`leftOutWhy`: a secret's file by its name or in a credentials folder, a link out of its tree, a submodule, a file
// too large), committed as Filament's own commit on the chain this machine sent that machine for that project
// (`SENT_REF_PREFIX`), and bundled: the first time its tree alone, with none of the project's history; after, only what
// changed since a commit that machine says its mirror holds. Taken in: the bundle's header read here, its pack indexed
// into the project's bare mirror there with every object checked (`importBundle`: `index-pack --strict`, which a fetch
// from a bundle skips before git 2.46), its commit kept under `refs/filament/snapshots/`. No fetch, so no remote's
// address is read; neither side runs a hook of the project's: a bundle carries none.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { lstat, mkdtemp, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, posix, relative, resolve, sep } from "node:path";
import { CREDENTIAL_FOLDERS, credentialFolderOf, privateKeyIn, secretFileOf } from "../../core/secret-files.js";
import { firstLine, git, gitWithoutHooks, refNameOf, repoOf, snapshotTree } from "./snapshot.js";
import { SKIP_LFS, gitBytes } from "./worktree.js";

/** Where this machine keeps the last commit it sent each machine for each project. */
export const SENT_REF_PREFIX = "refs/filament/sent/";
/** Where a mirror keeps each commit it took in. */
export const TAKEN_REF_PREFIX = "refs/filament/snapshots/";
/** The largest file a copy carries: past it, the file stays here, said. */
export const FILE_MAX_BYTES = 100 * 1024 ** 2;
/** The largest file whose first lines are read for a private key (`keyedOf`): a key's file, or a cloud's, is a few KB. */
export const KEY_FILE_MAX_BYTES = 64 * 1024;
/** How much of such a file's start is read for it, and how many bytes of them one git is asked for. */
const KEY_HEAD_CHARS = 4096;
const KEY_BATCH_BYTES = 16 * 1024 ** 2;
/** How long one git of a send may run: a large project's bundle takes minutes. */
const LONG_MS = 10 * 60_000;
/** How long indexing a copy that came, or walking it whole, may run: up to 20 GB, on a slow disk. */
export const TAKE_MS = 60 * 60_000;
/** How many of its commits a mirror names to a sender, newest first, and keeps. */
const HAVES_MAX = 20;
/** The most a bundle's header may take before its pack: the commit it names, the one it builds on, git's own lines. */
const HEADER_MAX = 64 * 1024;

/**
 * Why a file of a snapshot stays here, in words; "" where it goes: a name not in UTF-8 (`path` null), a submodule (none
 * is sent yet), a link whose target lies outside the project's tree, a secret's file (core/secret-files.js
 * `secretFileOf`) or one whose first lines hold a private key (`key`, read by `keyedOf`) but one the repository's HEAD
 * holds as it is here (`tracked`: committed, as its config `.npmrc` or `.yarnrc.yml` is), a file past `FILE_MAX_BYTES`.
 * @param {{ mode: string, path: string | null, size?: number, target?: string, tracked?: boolean, key?: boolean }} e  as the snapshot's index has it: `path` with `/`
 */
export function leftOutWhy(e) {
  if (e.path == null) return "a name not in UTF-8";
  if (e.mode === "160000") return "a submodule: none is sent yet";
  if (e.mode === "120000") {
    const t = String(e.target ?? "");
    const at = posix.normalize(posix.join(posix.dirname(e.path), t.replace(/\\/g, "/")));
    if (!t || /^([\\/]|[A-Za-z]:)/.test(t) || at === ".." || at.startsWith("../")) return "a link out of the project's tree";
  }
  const secret = e.tracked ? "" : secretFileOf(e.path) || (e.key ? "a private key, by its first lines" : "");
  if (secret) return secret;
  return (e.size ?? 0) > FILE_MAX_BYTES ? `larger than ${FILE_MAX_BYTES / 1024 ** 2} MB` : "";
}

/** A path's bytes as UTF-8, null where they are none. */
const utf8 = new TextDecoder("utf-8", { fatal: true });
/** @param {Buffer} b @returns {string | null} */
const nameOf = (b) => {
  try {
    return utf8.decode(b);
  } catch {
    return null;
  }
};

/** Whether a folder is the home folder or a drive's root, whose repository is never sent. @param {string} folder */
const tooWide = (folder) => {
  const k = (/** @type {string} */ p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p)).replace(/[\\/]+$/, "");
  return k(folder) === k(homedir()) || resolve(folder) === parse(resolve(folder)).root;
};

/**
 * Whether a repository's top is a credentials folder or lies in one, or holds one — a dotfiles repository of
 * `~/.config`, `~/.ssh`, AppData —, by its path's names: its files, named from its top, would name none (the swarm's
 * review of 11-10). A top named as a browser's or a keychain's first folder alone (`google`, `library`) is a project's.
 * @param {string} folder
 */
const credentialTop = (folder) => {
  if (credentialFolderOf(resolve(folder))) return true;
  const names = resolve(folder).toLowerCase().split(/[\\/]+/).filter(Boolean);
  const ends = (/** @type {readonly string[]} */ c) => c.every((n, j) => names[names.length - c.length + j] === n);
  return CREDENTIAL_FOLDERS.some((c) => (c[0].startsWith(".") || c[0] === "appdata") && c.slice(1).some((_, k) => ends(c.slice(0, k + 1))));
};

/** A file's sha-256 and size, read as a stream. @param {string} file */
export async function digestOf(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return { sha256: h.digest("hex"), bytes: (await stat(file)).size };
}

/**
 * NUL-ended rows of git's output, as their bytes. @param {Buffer} out @returns {Buffer[]}
 */
const rowsOf = (out) => {
  const rows = [];
  for (let at = 0; at < out.length; ) {
    const end = out.indexOf(0, at);
    const stop = end < 0 ? out.length : end;
    if (stop > at) rows.push(out.subarray(at, stop));
    at = stop + 1;
  }
  return rows;
};

/**
 * The entries of an index: `ls-files -s -z`'s rows, each path as its bytes (`raw`, what git is given back) and as
 * words (`path`, null where its bytes are no UTF-8). @param {Buffer} out
 * @returns {{ mode: string, sha: string, raw: Buffer, path: string | null }[]}
 */
const entriesOf = (out) =>
  rowsOf(out).map((row) => {
    const tab = row.indexOf(9);
    const [mode, sha] = row.subarray(0, tab).toString("latin1").split(" ");
    const raw = row.subarray(tab + 1);
    return { mode, sha, raw, path: nameOf(raw) };
  });

/**
 * Links' targets by their blobs — any blob's words —, asked in one batch: `pre` names the repository where `cwd` does
 * not (`--git-dir`).
 * @param {string[]} pre @param {string} cwd @param {string[]} links  their blobs @param {AbortSignal | null} [signal]
 * @returns {Promise<Map<string, string>>}
 */
const targetsOf = async (pre, cwd, links, signal = null) => {
  /** @type {Map<string, string>} */
  const targets = new Map();
  const shas = [...new Set(links)];
  if (!shas.length) return targets;
  const b = await gitBytes([...pre, "cat-file", "--batch"], { cwd, signal, input: Buffer.from(`${shas.join("\n")}\n`) });
  let at = 0;
  for (const sha of shas) {
    const nl = b.out.indexOf(10, at);
    if (nl < 0) break;
    const size = Number(b.out.subarray(at, nl).toString("utf8").split(" ")[2]);
    if (!Number.isFinite(size)) break;
    targets.set(sha, b.out.subarray(nl + 1, nl + 1 + size).toString("utf8"));
    at = nl + 1 + size + 1;
  }
  return targets;
};

/**
 * The blobs among `shas` whose first lines hold a private key's header (core/secret-files.js `privateKeyIn`), whatever
 * their files are named: read a batch of `KEY_BATCH_BYTES` at a time, by the sizes git gave (`sizes`).
 * @param {string[]} pre @param {string} cwd @param {string[]} shas @param {Map<string, number>} sizes @param {AbortSignal | null} [signal]
 * @returns {Promise<Set<string>>}
 */
const keyedOf = async (pre, cwd, shas, sizes, signal = null) => {
  /** @type {Set<string>} */
  const keyed = new Set();
  const all = [...new Set(shas)];
  for (let i = 0; i < all.length; ) {
    let j = i;
    for (let bytes = 0; j < all.length && bytes < KEY_BATCH_BYTES; j++) bytes += sizes.get(all[j]) ?? 0;
    for (const [sha, words] of await targetsOf(pre, cwd, all.slice(i, j), signal)) if (privateKeyIn(words.slice(0, KEY_HEAD_CHARS))) keyed.add(sha);
    i = j;
  }
  return keyed;
};

/** Why what lies through a junction stays here, said once, by the junction. */
const JUNCTION = "a junction: what it leads to is not sent";

/**
 * The folders on the way to an index's files that are links on this disk, as the index names them, outer first: Git
 * for Windows walks a junction as a folder, so what one leads to — a folder outside the project — is in the index as
 * the project's own files (the re-read of 11-11). None elsewhere: there git takes a link for a link.
 * @param {string} root  the work tree @param {{ path: string | null }[]} entries @returns {Promise<string[]>}
 */
const junctionsOf = async (root, entries) => {
  if (process.platform !== "win32") return [];
  /** The folders on the way to a file, by how deep each lies. @type {Set<string>[]} */
  const levels = [];
  for (const { path } of entries) {
    if (path == null) continue;
    for (let depth = 0, at = path.indexOf("/"); at >= 0; depth++, at = path.indexOf("/", at + 1)) (levels[depth] ??= new Set()).add(path.slice(0, at));
  }
  /** @type {string[]} */
  const found = [];
  for (const level of levels) {
    // What lies through a junction found already is not looked at: its folders are another folder's.
    const open = [...level].filter((d) => !found.some((j) => d.startsWith(`${j}/`)));
    const linked = await Promise.all(open.map((d) => lstat(join(root, d)).then((st) => st.isSymbolicLink(), () => false)));
    found.push(...open.filter((_, i) => linked[i]));
  }
  return found;
};

/**
 * The index `env.GIT_INDEX_FILE` names, less what stays here (`leftOutWhy`): each file that stays removed from it by
 * its own bytes, so a name in no UTF-8 is the one removed; a secret's file `at` holds goes only as `at` has it, changed
 * here the committed one in its place (`back`); what lies through a junction of the work tree `cwd` (`junctionsOf`)
 * removed with them, said once by the junction; then counted, so none stays unsaid. `keepSent`, a copy's capture: every
 * file that stays which `at` holds goes as `at` has it, whatever the reason, and so does what `at` holds under one (a
 * folder made a link or a repository of its own) — left out, it would come back as deleted; a junction refuses it
 * whole, as a link out of its tree does. `pre` names the repository where `cwd` does not. → how many files go, what
 * stays, the files that go which `at` does not hold (`fresh`), whether the index moved; or why not, in words.
 * @param {{ pre: string[], cwd: string, env: Record<string, string>, at: string, keepSent?: boolean, signal?: AbortSignal | null }} o
 * @returns {Promise<{ ok: true, files: number, left: { path: string, why: string }[], fresh: string[], moved: boolean } | { ok: false, error: string }>}
 */
async function leaveOut({ pre, cwd, env, at, keepSent = false, signal = null }) {
  const ls = await gitBytes([...pre, "ls-files", "-s", "-z"], { cwd, env, signal });
  if (ls.code !== 0) return { ok: false, error: `git ls-files failed: ${ls.err}` };
  const entries = entriesOf(ls.out);
  const junctions = await junctionsOf(cwd, entries);
  if (keepSent && junctions.length) return { ok: false, error: `the copy holds a junction (${junctions[0].slice(0, 120)}): what changed in it stays there` };
  const through = (/** @type {string | null} */ path) => path != null && junctions.some((j) => path.startsWith(`${j}/`));
  // What `at` holds, each path's blob and row by its bytes: none before a first commit.
  const head = await gitBytes([...pre, "ls-tree", "-r", "-z", at], { cwd, signal });
  /** @type {Map<string, { sha: string, row: Buffer }>} */
  const atHead = new Map();
  if (head.code === 0)
    for (const row of rowsOf(head.out)) {
      const tab = row.indexOf(9);
      atHead.set(row.subarray(tab + 1).toString("latin1"), { sha: row.subarray(0, tab).toString("latin1").split(" ")[2], row });
    }
  // Each blob's size, and each link's target, asked in one batch each.
  const blobs = entries.filter((e) => e.mode !== "160000");
  /** @type {Map<string, number>} */
  const sizes = new Map();
  if (blobs.length) {
    const bc = await gitBytes([...pre, "cat-file", "--batch-check=%(objectname) %(objectsize)"], { cwd, signal, input: Buffer.from(`${[...new Set(blobs.map((e) => e.sha))].join("\n")}\n`) });
    for (const line of bc.out.toString("utf8").split("\n")) {
      const [sha, size] = line.trim().split(" ");
      if (sha && size) sizes.set(sha, Number(size));
    }
  }
  const targets = await targetsOf(pre, cwd, entries.filter((e) => e.mode === "120000").map((e) => e.sha), signal);
  // A private key under a name that says nothing: the first lines of each small file `at` does not hold as it is here.
  const small = entries.filter((e) => e.mode.startsWith("100") && (sizes.get(e.sha) ?? Infinity) <= KEY_FILE_MAX_BYTES && atHead.get(e.raw.toString("latin1"))?.sha !== e.sha && !through(e.path));
  const keyed = await keyedOf(pre, cwd, small.map((e) => e.sha), sizes, signal);
  const leaving = entries
    .map((e) => {
      if (through(e.path)) return { e, why: JUNCTION, back: null };
      const h = atHead.get(e.raw.toString("latin1"));
      const of = { mode: e.mode, path: e.path, size: sizes.get(e.sha), target: targets.get(e.sha), key: keyed.has(e.sha) };
      const why = leftOutWhy({ ...of, tracked: h?.sha === e.sha });
      const back = why && h && (keepSent || !leftOutWhy({ ...of, tracked: true })) ? h : null;
      return { e, why: back ? (keepSent ? `${why}: it goes back as it was sent` : "a secret's file changed here: the committed one goes") : why, back };
    })
    .filter((l) => l.why);
  const left = [...junctions.map((path) => ({ path, why: JUNCTION })), ...leaving.filter((l) => l.why !== JUNCTION).map(({ e, why }) => ({ path: e.path ?? e.raw.toString("utf8"), why }))];
  const removed = leaving.filter((l) => !l.back);
  // The files that go which `at` does not hold: in no commit of the project, and so in nobody's review of one.
  const stays = new Set(leaving.map((l) => l.e));
  const fresh = entries.filter((e) => !stays.has(e) && !atHead.has(e.raw.toString("latin1"))).map((e) => String(e.path));
  if (!leaving.length) return { ok: true, files: entries.length, left, fresh, moved: false };
  // What `at` holds under a path that stays, which git's add took out of the index for it.
  const under = keepSent
    ? removed.flatMap(({ e }) => {
        const dir = `${e.raw.toString("latin1")}/`;
        return [...atHead].filter(([p]) => p.startsWith(dir)).map(([, h]) => h);
      })
    : [];
  const nul = Buffer.from([0]);
  if (removed.length) {
    const rm_ = await gitBytes([...pre, "-c", "core.splitIndex=false", "update-index", "--force-remove", "-z", "--stdin"], { cwd, env, signal, input: Buffer.concat(removed.flatMap(({ e }) => [e.raw, nul])) });
    if (rm_.code !== 0) return { ok: false, error: `git update-index failed: ${rm_.err}` };
  }
  const backs = [...leaving.flatMap(({ back }) => (back ? [back.row, nul] : [])), ...under.flatMap((h) => [h.row, nul])];
  if (backs.length) {
    const put = await gitBytes([...pre, "-c", "core.splitIndex=false", "update-index", "-z", "--index-info"], { cwd, env, signal, input: Buffer.concat(backs) });
    if (put.code !== 0) return { ok: false, error: `git update-index failed: ${put.err}` };
  }
  const after = await gitBytes([...pre, "ls-files", "-s", "-z"], { cwd, env, signal });
  const kept = after.code === 0 ? entriesOf(after.out) : null;
  const shaOf = new Map((kept ?? []).map((x) => [x.raw.toString("latin1"), x.sha]));
  const rowSha = (/** @type {{ row: Buffer }} */ h) => h.row.subarray(0, h.row.indexOf(9)).toString("latin1").split(" ")[2];
  const wrong =
    !kept ||
    kept.length !== entries.length - removed.length + under.length ||
    leaving.some(({ e, back }) => shaOf.get(e.raw.toString("latin1")) !== (back ? back.sha : undefined)) ||
    under.some((h) => shaOf.get(h.row.subarray(h.row.indexOf(9) + 1).toString("latin1")) !== rowSha(h));
  if (wrong) return { ok: false, error: "a file that stays here could not be left out of the copy: none is sent" };
  return { ok: true, files: entries.length - removed.length + under.length, left, fresh, moved: true };
}

/**
 * A copy of the project `folder` is in, to send the machine `machine`: its snapshot less what stays here, as a commit on
 * the chain sent that machine, bundled in a temp folder of its own (`dir`, the caller's to remove). `haves`: the commits
 * that machine's mirror of the project holds (`mirrorHaves`) — a bundle carries only what changed since the newest one
 * also here; none, the tree alone. `unchanged`: that machine has the commit already, and no bundle is made.
 * `untracked`: the files that go which no commit of the project holds — untracked, or added and not committed —, for
 * the person's yes. `ask`: that yes, asked before the bundle is built — its bytes what git keeps of the objects that go,
 * near the bundle's — so a no or a question answered later builds none; a git that cannot measure them (before 2.31)
 * asks once it is built. What it throws ends the send.
 * @param {string} folder
 * @param {{ machine: string, project: string, haves?: readonly string[], signal?: AbortSignal | null,
 *   ask?: ((o: { files: number, bytes: number, untracked: string[], left: { path: string, why: string }[] }) => Promise<unknown>) | null }} o
 * @returns {Promise<{ ok: true, repo: string, sub: string, commit: string, basis: string | null, files: number, left: { path: string, why: string }[], untracked: string[], unchanged: boolean, dir: string | null, file: string | null, bytes: number, sha256: string }
 *   | { ok: false, error: string }>}
 */
export async function bundleSnapshot(folder, { machine, project, haves = [], signal = null, ask = null }) {
  // The home folder's repository holds the person's whole account: its history, its tokens, Filament's own data.
  const found = await repoOf(folder);
  if (found.repo && tooWide(found.repo)) return { ok: false, error: `this folder's repository is ${found.repo}, the home folder or a drive's root: no copy of it is sent` };
  if (found.repo && credentialTop(found.repo)) return { ok: false, error: `this folder's repository is ${found.repo}, a credentials folder, or holds one: no copy of it is sent` };
  void sweepLeft();
  const snap = await snapshotTree(folder, { name: "send", keep: false, keepIndex: true, signal });
  if (!snap.ok || !snap.repo || !snap.index) {
    if (snap.index) await rm(dirname(snap.index), { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: snap.error || "the project's snapshot could not be taken" };
  }
  const repo = snap.repo;
  const index = snap.index;
  const env = { GIT_INDEX_FILE: index };
  const run = (/** @type {string[]} */ args) => git(args, { cwd: repo, env, signal });
  try {
    const shaped = await leaveOut({ pre: [], cwd: repo, env, at: "HEAD", signal });
    if (!shaped.ok) return shaped;
    // What the snapshot was taken without — a junction to a folder it lies in, a repository with no commit — is said
    // with what the index left out, in the order of their paths.
    const untaken = (snap.left || []).map((l) => ({ path: l.path, why: l.kind === "link" ? JUNCTION : NESTED }));
    const left = untaken.length ? [...untaken, ...shaped.left].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) : shaped.left;
    let tree = snap.tree || "";
    if (shaped.moved) {
      const wt = await run(["-c", "core.splitIndex=false", "write-tree"]);
      if (wt.code !== 0 || !wt.out) return { ok: false, error: `git write-tree failed: ${wt.err || wt.error}` };
      tree = wt.out;
    }
    // The chain: the last commit sent that machine for this project, where its mirror holds it; else the newest commit
    // it holds that is here too; else none, and the tree goes alone.
    const ref = `${SENT_REF_PREFIX}${refNameOf(machine)}/${refNameOf(project)}`;
    const last = (await run(["rev-parse", "--verify", "-q", `${ref}^{commit}`])).out || "";
    let basis = last && haves.includes(last) ? last : null;
    for (const h of haves) {
      if (basis) break;
      if (/^[0-9a-f]{40,64}$/.test(h) && (await run(["cat-file", "-e", `${h}^{commit}`])).code === 0) basis = h;
    }
    const basisTree = basis ? (await run(["rev-parse", `${basis}^{tree}`])).out : "";
    let commit = basis && basisTree === tree ? basis : "";
    if (!commit) {
      const ct = await run(["commit-tree", tree, ...(basis ? ["-p", basis] : []), "-m", `Filament: ${project}, as sent to another machine`]);
      if (ct.code !== 0 || !ct.out) return { ok: false, error: `git commit-tree failed: ${ct.err || ct.error}` };
      commit = ct.out;
    }
    // This folder within the repository, as git names its root: by its path as named, else by its real path (a link on
    // the way, which git's root leaves out; a drive `subst` or a mapped one keeps its letter in both); none where
    // neither is within.
    const within = (/** @type {string} */ p) => {
      const rel = relative(repo, p);
      return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : rel.split(sep).join("/");
    };
    let sub = within(folder);
    if (sub === null) {
      try {
        sub = within(realpathSync.native(folder));
      } catch {}
    }
    sub ??= "";
    const base = { ok: /** @type {const} */ (true), repo, sub, commit, basis, files: shaped.files, left, untracked: shaped.fresh };
    const asked = { files: base.files, untracked: base.untracked, left: base.left };
    // Asked before the bundle, measured from this commit; the ref every send of the project to that machine shares moves
    // after the yes, just before the bundle reads it: another send while the person answers is never bundled on this yes.
    let askLater = !!ask;
    if (ask) {
      const du = commit === basis ? { code: 0, out: "0" } : await run(["rev-list", "--objects", "--disk-usage", commit, ...(basis ? [`^${basis}`] : [])]);
      if (du.code === 0 && /^\d+$/.test(String(du.out).trim())) {
        await ask({ ...asked, bytes: Number(String(du.out).trim()) });
        askLater = false;
      }
    }
    const ur = await run(["update-ref", ref, commit]);
    if (ur.code !== 0) return { ok: false, error: `git update-ref failed: ${ur.err || ur.error}` };
    if (commit === basis) return { ...base, unchanged: true, dir: null, file: null, bytes: 0, sha256: "" };
    const dir = await mkdtemp(join(tmpdir(), SEND_PREFIX));
    const file = join(dir, "copy.bundle");
    const bundled = await git(["bundle", "create", file, ref, ...(basis ? [`^${basis}`] : [])], { cwd: repo, signal, timeoutMs: LONG_MS });
    if (bundled.code !== 0 || !existsSync(file)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: `git bundle failed: ${bundled.err || bundled.error}` };
    }
    const digest = await digestOf(file);
    if (askLater && ask)
      try {
        await ask({ ...asked, bytes: digest.bytes });
      } catch (e) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        throw e;
      }
    return { ...base, unchanged: false, dir, file, ...digest };
  } finally {
    await rm(dirname(index), { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A git of a mirror's: named by its folder, as a bare repository is only where it is named (`safe.bareRepository`).
 * @param {string} mirror @param {string[]} args @param {{ timeoutMs?: number, input?: string | import("node:stream").Readable | null }} [o]
 */
const inMirror = (mirror, args, { timeoutMs, input = null } = {}) => gitWithoutHooks([`--git-dir=${mirror}`, ...args], { cwd: dirname(mirror), timeoutMs, input });

/**
 * A bundle's header, read here (git's own bundle format, v2 or v3): the commits its pack builds on (`needs`), the refs
 * it names, its capabilities, and where its pack starts; null where the file is no bundle.
 * @param {string} file
 * @returns {Promise<{ needs: string[], heads: { sha: string, ref: string }[], caps: string[], packAt: number } | null>}
 */
export async function bundleHeaderOf(file) {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(HEADER_MAX);
    const { bytesRead } = await fh.read(buf, 0, HEADER_MAX, 0);
    const end = buf.subarray(0, bytesRead).indexOf("\n\n");
    if (end < 0) return null;
    const [first, ...lines] = buf.subarray(0, end).toString("utf8").split("\n");
    if (!/^# v[23] git bundle$/.test(first)) return null;
    /** @type {string[]} */
    const needs = [];
    /** @type {{ sha: string, ref: string }[]} */
    const heads = [];
    /** @type {string[]} */
    const caps = [];
    for (const l of lines) {
      if (l.startsWith("@")) caps.push(l.slice(1));
      else if (l.startsWith("-")) {
        const sha = l.slice(1).split(" ")[0];
        if (!/^[0-9a-f]{40}$/.test(sha)) return null;
        needs.push(sha);
      } else {
        const sp = l.indexOf(" ");
        const [sha, ref] = [l.slice(0, sp), l.slice(sp + 1)];
        if (sp < 0 || !/^[0-9a-f]{40}$/.test(sha) || !ref) return null;
        heads.push({ sha, ref });
      }
    }
    return { needs, heads, caps, packAt: end + 2 };
  } finally {
    await fh.close();
  }
}

/**
 * The commits a project's mirror holds, newest first (`HAVES_MAX` at most): none where it is not made yet.
 * @param {string} mirror @returns {Promise<string[]>}
 */
export async function mirrorHaves(mirror) {
  if (!existsSync(mirror)) return [];
  const r = await inMirror(mirror, ["for-each-ref", "--sort=-committerdate", `--count=${HAVES_MAX}`, "--format=%(objectname)", TAKEN_REF_PREFIX]);
  return r.code === 0 && r.out ? r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
}

/** The line of git's that says why, in words (snapshot.js `firstLine`). @param {{ err: string, error?: string | null }} r */
const whyOf = (r) => firstLine(r.err || r.error);

/**
 * A bundle sent from another machine taken into a project's mirror (`mirror`, made bare where it is not there): its
 * header read here (`bundleHeaderOf`) — one commit of Filament's alone, in sha-1 —, the commits it builds on there
 * (else `lacks`, for the sender to send it whole), then its pack indexed with every object checked (`index-pack
 * --strict`: no path that leaves the tree or names `.git`, nothing it names missing), its head a commit. → the commit,
 * kept under `TAKEN_REF_PREFIX` with the newest `HAVES_MAX` taken before; or why not, in words.
 * @param {string} mirror @param {string} file
 * @returns {Promise<{ ok: true, commit: string } | { ok: false, error: string, lacks?: true }>}
 */
export async function importBundle(mirror, file) {
  const h = await bundleHeaderOf(file).catch(() => null);
  if (!h) return { ok: false, error: "the copy sent is no git bundle" };
  if (h.caps.some((c) => c !== "object-format=sha1")) return { ok: false, error: `the copy sent is a bundle this mirror takes none of (${h.caps.join(", ").slice(0, 120)})` };
  if (h.heads.length !== 1 || !h.heads[0].ref.startsWith(SENT_REF_PREFIX)) return { ok: false, error: "the copy sent names one commit of Filament's alone, and this one names another" };
  const commit = h.heads[0].sha;
  if (!existsSync(mirror)) {
    mkdirSync(dirname(mirror), { recursive: true });
    const made = await gitWithoutHooks(["init", "--bare", "-q", mirror], { cwd: dirname(mirror) });
    if (made.code !== 0) return { ok: false, error: `the project's mirror could not be made: ${whyOf(made)}` };
  }
  for (const need of h.needs)
    if ((await inMirror(mirror, ["cat-file", "-e", `${need}^{commit}`])).code !== 0) return { ok: false, lacks: true, error: `the copy sent builds on ${need.slice(0, 12)}, which this mirror does not hold: send it whole` };
  const packed = await inMirror(mirror, ["index-pack", "--stdin", "--fix-thin", "--strict"], { timeoutMs: TAKE_MS, input: createReadStream(file, { start: h.packAt }) });
  if (packed.code !== 0) return { ok: false, error: `the copy sent could not be taken in: ${whyOf(packed)}` };
  const kind = await inMirror(mirror, ["cat-file", "-t", commit]);
  if (kind.out !== "commit") return { ok: false, error: "the copy sent names no commit" };
  const whole = await inMirror(mirror, ["rev-list", "--objects", "--quiet", commit, ...(h.needs.length ? ["--not", ...h.needs] : [])], { timeoutMs: TAKE_MS });
  if (whole.code !== 0) return { ok: false, error: `the copy sent lacks what its commit names: ${whyOf(whole)}` };
  const kept = await inMirror(mirror, ["update-ref", `${TAKEN_REF_PREFIX}${commit}`, commit]);
  if (kept.code !== 0) return { ok: false, error: `the copy sent could not be kept: ${whyOf(kept)}` };
  // The newest it took, and this one, are kept; what older ones alone held goes at git's own pace.
  const all = await inMirror(mirror, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)", TAKEN_REF_PREFIX]);
  const old = all.code === 0 ? all.out.split(/\r?\n/).filter((r) => r && r !== `${TAKEN_REF_PREFIX}${commit}`).slice(HAVES_MAX - 1) : [];
  if (old.length) await inMirror(mirror, ["update-ref", "--stdin"], { input: old.map((r) => `delete ${r}\n`).join("") });
  await inMirror(mirror, ["-c", "gc.autoDetach=false", "gc", "--auto", "--quiet"], { timeoutMs: LONG_MS });
  return { ok: true, commit };
}

/** Where a mirror pins the commit each copy of it is checked out at, so no gc there takes what that copy reads. */
export const PINNED_REF_PREFIX = "refs/filament/copies/";

/** Whether a mirror holds `commit`, a commit. @param {string} mirror @param {string} commit */
export const mirrorHas = async (mirror, commit) => /^[0-9a-f]{40}$/.test(commit) && existsSync(mirror) && (await inMirror(mirror, ["cat-file", "-t", commit])).out === "commit";

/**
 * The first link — or file — on the way from `root` down to `folder`, which would take what is written there elsewhere,
 * or words where `folder` is not below `root`; "" where the way is folders alone, those not made yet included.
 * @param {string} root @param {string} folder
 */
export const linkOnTheWay = (root, folder) => {
  const rel = relative(resolve(root), resolve(folder));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return `${folder} is not in ${root}`;
  let at = resolve(root);
  for (const part of rel.split(/[\\/]+/)) {
    at = join(at, part);
    /** @type {import("node:fs").Stats} */
    let st;
    try {
      st = lstatSync(at);
    } catch {
      return "";
    }
    if (st.isSymbolicLink() || !st.isDirectory()) return at;
  }
  return "";
};

/**
 * The first link of `commit`'s tree that leads out of it (`leftOutWhy`), its words read alone or through another link of
 * it (`y -> x/s/..` where `x/s -> ..`), each path read as this machine's disk reads it (`X/S`, `x/s.` and `x/s` one name
 * on Windows; a name's two Unicode spellings one on macOS): its path, "" where none does; or why its files could not be
 * listed. `pre` names the repository where `cwd` does not.
 * @param {string[]} pre @param {string} cwd @param {string} commit
 * @returns {Promise<{ ok: true, path: string } | { ok: false, error: string }>}
 */
export async function linkAstray(pre, cwd, commit) {
  const ls = await gitBytes([...pre, "ls-tree", "-r", "-z", commit], { cwd });
  if (ls.code !== 0) return { ok: false, error: firstLine(ls.err) };
  const links = rowsOf(ls.out)
    .map((row) => {
      const tab = row.indexOf(9);
      const [mode, , sha] = row.subarray(0, tab).toString("latin1").split(" ");
      return { mode, sha, path: row.subarray(tab + 1).toString("utf8") };
    })
    .filter((e) => e.mode === "120000");
  const targets = await targetsOf(pre, cwd, links.map((e) => e.sha));
  const onDisk = (/** @type {string} */ path) => {
    const p = path.normalize("NFC");
    if (process.platform === "win32") return p.split("/").map((n) => n.replace(/[. ]+$/, "")).join("/").toLowerCase();
    return process.platform === "darwin" ? p.toLowerCase() : p;
  };
  const linked = new Set(links.map((e) => onDisk(e.path)));
  const through = (/** @type {{ path: string, sha: string }} */ e) => {
    const parts = String(targets.get(e.sha) ?? "").split(/[\\/]+/).filter((p) => p && p !== ".");
    const at = posix.dirname(e.path) === "." ? [] : posix.dirname(e.path).split("/");
    for (const p of parts.slice(0, -1)) {
      if (p === "..") at.pop();
      else at.push(p);
      if (linked.has(onDisk(at.join("/")))) return true;
    }
    return false;
  };
  const out = links.find((e) => leftOutWhy({ mode: e.mode, path: e.path, target: targets.get(e.sha), tracked: true }) || through(e));
  return { ok: true, path: out ? out.path : "" };
}

/**
 * A copy of a project checked out from its mirror at `commit` into `folder` (a copy's, made or taken again: cp-place):
 * its `.git` made fresh each time, so nothing an agent did to the one before is read, reading the mirror's objects
 * (alternates) with the commit pinned there (`PINNED_REF_PREFIX` + `pin`); the commit's files written over what is
 * there, what is neither the commit's nor ignored removed, what is ignored (`node_modules`, a build) kept, so a copy taken
 * again keeps its installs — a repository an earlier launch made in it goes with the rest (`clean -ff`). A link out of
 * the tree, which no sender of Filament's sends, refuses the copy before anything is written, and so does a link on the
 * way from `root` (the copies folder) to the copy's folder; two paths its disk reads as one (`sameFolded`) refuse it
 * before any file of the commit is. Every git
 * names its repository and its work tree, so none finds another; hooks off; Git LFS's files stay their pointers.
 * → the commit, or why not, in words.
 * @param {string} mirror @param {string} folder @param {string} commit @param {{ pin: string, root?: string | null }} o
 * @returns {Promise<{ ok: true, commit: string } | { ok: false, error: string }>}
 */
export async function checkoutCopy(mirror, folder, commit, { pin, root = null }) {
  const at = Date.now();
  if (!/^[0-9a-f]{40}$/.test(commit)) return { ok: false, error: "the copy's commit is 40 hex digits" };
  if (!(await mirrorHas(mirror, commit))) return { ok: false, error: `the commit ${commit.slice(0, 12)} is not here: send the copy first` };
  const out = await linkAstray([`--git-dir=${mirror}`], dirname(mirror), commit);
  if (!out.ok) return { ok: false, error: `the copy's files could not be listed: ${out.error}` };
  if (out.path) return { ok: false, error: `the copy holds a link out of its tree (${out.path.slice(0, 120)}): it is not checked out` };
  // Its folder lies in the copies folder as named, no link on the way that would take Filament's git elsewhere.
  const astray = root ? linkOnTheWay(root, folder) : "";
  if (astray) return { ok: false, error: `the copy's folder is not where it was made (${astray}): it is not checked out` };
  const pinned = await inMirror(mirror, ["update-ref", `${PINNED_REF_PREFIX}${refNameOf(pin)}`, commit]);
  if (pinned.code !== 0) return { ok: false, error: `the copy's commit could not be kept: ${whyOf(pinned)}` };
  // A pin whose copy, beside this one, is gone holds nothing any more, nor does its newest capture or its index.
  const pins = await inMirror(mirror, ["for-each-ref", "--format=%(refname)", PINNED_REF_PREFIX]);
  const loose = pins.out
    .split(/\r?\n/)
    .filter((r) => r && !existsSync(join(dirname(folder), r.slice(PINNED_REF_PREFIX.length))) && r !== `${PINNED_REF_PREFIX}${refNameOf(pin)}`)
    .map((r) => r.slice(PINNED_REF_PREFIX.length));
  if (loose.length) await inMirror(mirror, ["update-ref", "--stdin"], { input: loose.map((n) => `delete ${PINNED_REF_PREFIX}${n}\ndelete ${BACK_REF_PREFIX}${n}\n`).join("") });
  const indexes = join(mirror, "filament-capture");
  for (const name of await readdir(indexes).catch(() => /** @type {string[]} */ ([]))) if (loose.some((n) => name.startsWith(`${n}.`))) await rm(join(indexes, name), { force: true }).catch(() => {});
  const dotGit = join(folder, ".git");
  try {
    await rm(dotGit, { recursive: true, force: true, maxRetries: 3 });
    mkdirSync(folder, { recursive: true });
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `the copy's folder could not be made ready: ${e?.message || e}` };
  }
  const made = await gitWithoutHooks(["init", "-q", "--template=", folder], { cwd: folder });
  if (made.code !== 0) return { ok: false, error: `the copy's repository could not be made: ${whyOf(made)}` };
  mkdirSync(join(dotGit, "objects", "info"), { recursive: true });
  writeFileSync(join(dotGit, "objects", "info", "alternates"), `${join(mirror, "objects").split(sep).join("/")}\n`);
  // Two of the commit's paths this folder's disk reads as one, as git's init just found it to (`core.ignorecase`): one
  // file here for the two, so the copy would not be the project, and its capture fails where two folders hold a name.
  const folds = (await git([`--git-dir=${dotGit}`, "config", "--type=bool", "--get", "core.ignorecase"], { cwd: folder })).out === "true";
  const twice = folds ? await sameFolded(mirror, commit) : "";
  if (twice) return { ok: false, error: `the copy holds two paths this machine's disk reads as one (${twice}): it is not checked out` };
  // A link an earlier launch left where the commit has a folder (`src` made a junction) goes first, the link alone:
  // Git for Windows writes a checkout's files through a junction (the swarm's review of 11-10).
  const stray = await linksLeft(mirror, folder, commit);
  if (stray) return { ok: false, error: `what an earlier launch left in the copy could not be cleared: ${stray}` };
  // The files Git LFS keeps stay their pointers, as they came — their content was never sent —, no filter this
  // machine's configuration names runs on them (`filtersOff`), a path past Windows' 260 characters is written all the
  // same, and a path Windows or macOS would read as another (`.GIT~1`, a name's trailing dot) is refused on any system.
  const here = [...SKIP_LFS, "-c", "core.longpaths=true", "-c", "core.protectNTFS=true", "-c", "core.protectHFS=true", `--git-dir=${dotGit}`, `--work-tree=${folder}`];
  const env = { GIT_LFS_SKIP_SMUDGE: "1", ...(await filtersOff(mirror)) };
  const co = await gitWithoutHooks([...here, "checkout", "-q", "-f", "--detach", commit], { cwd: folder, env, timeoutMs: TAKE_MS });
  if (co.code !== 0) return { ok: false, error: `the copy could not be checked out: ${whyOf(co)}` };
  // Twice forced: a folder that is a repository of its own, which an earlier launch's agent made, goes with the rest.
  const cl = await gitWithoutHooks([...here, "clean", "-q", "-ff", "-d"], { cwd: folder, env, timeoutMs: LONG_MS });
  if (cl.code !== 0) return { ok: false, error: `what an earlier launch left in the copy could not be cleared: ${whyOf(cl)}` };
  // When this launch took the copy, kept in the mirror: what git ignores there (an install, a build, kept above) is
  // said to stay only where it was made or changed since (`ignoredOf`; r-itself, 11-12).
  try {
    mkdirSync(indexes, { recursive: true });
    writeFileSync(placedFile(mirror, pin), String(at));
  } catch {}
  return { ok: true, commit };
}

/**
 * Every filter this machine's git configuration names, Git LFS's among them, off, as git's environment keys after any of
 * the person's: a name holds any character, and there is no count to keep under a command line's length. Read through
 * the mirror, which reads this machine's configuration. @param {string} mirror @returns {Promise<Record<string, string>>}
 */
const filtersOff = async (mirror) => {
  const named = await inMirror(mirror, ["config", "-z", "--name-only", "--get-regexp", "^filter\\."]);
  const filters = [...new Set(named.out.split("\0").map((k) => /^filter\.(.+)\.[^.]+$/s.exec(k)?.[1] || "").filter(Boolean))];
  const off = ["lfs", ...filters].flatMap((n) => [...["clean", "smudge", "process"].map((k) => [`filter.${n}.${k}`, ""]), [`filter.${n}.required`, "false"]]);
  const theirs = Number(process.env.GIT_CONFIG_COUNT) || 0;
  return {
    GIT_CONFIG_COUNT: String(theirs + off.length),
    ...Object.fromEntries(off.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${theirs + i}`, k], [`GIT_CONFIG_VALUE_${theirs + i}`, v]])),
  };
};

/**
 * Two of `commit`'s paths — files, or folders on the way to them — that a disk which folds case reads as one
 * (`README.md` and `Readme.md`, sent from a disk that tells them apart), in words; "" where no two are. macOS reads a
 * name's two Unicode spellings as one too.
 * @param {string} mirror @param {string} commit
 */
const sameFolded = async (mirror, commit) => {
  const ls = await gitBytes([`--git-dir=${mirror}`, "ls-tree", "-r", "-t", "-z", "--name-only", commit], { cwd: dirname(mirror) });
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const row of ls.code === 0 ? rowsOf(ls.out) : []) {
    const path = row.toString("utf8");
    const key = (process.platform === "darwin" ? path.normalize("NFC") : path).toLowerCase();
    const was = seen.get(key);
    if (was !== undefined) return `${was.slice(0, 120)} and ${path.slice(0, 120)}`;
    seen.set(key, path);
  }
  return "";
};

/**
 * The links in a copy's folder where `commit` has a folder, removed — the link alone, never what it leads to —, outer
 * first, so what lay through one is not looked for. → the first that could not be removed, in words, or "".
 * @param {string} mirror @param {string} folder @param {string} commit
 */
const linksLeft = async (mirror, folder, commit) => {
  const ls = await gitBytes([`--git-dir=${mirror}`, "ls-tree", "-r", "-d", "-z", "--name-only", commit], { cwd: dirname(mirror) });
  if (ls.code !== 0) return `its folders could not be listed (${firstLine(ls.err)})`;
  for (const row of rowsOf(ls.out)) {
    const at = join(folder, row.toString("utf8"));
    try {
      if (lstatSync(at).isSymbolicLink()) unlinkSync(at);
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT" && e?.code !== "ENOTDIR") return `${at}: ${e?.message || e}`;
    }
  }
  return "";
};

/** Where a repository's git folder holds what comes back from a copy while it is checked (`importBack`). */
const INCOMING = "filament-incoming";
/** How long a check's folder a crash left stays before the next import clears it. */
const INCOMING_TTL_MS = 24 * 3600_000;

/**
 * A sub-agent's capture come back from its copy on another machine (cp-back), taken into the developer's repository
 * `repo`: its header read here — one commit of Filament's back, in sha-1 — built on commits this repository holds,
 * `base` among them; its pack indexed with every object checked (`index-pack --strict`) into a repository of its own
 * beside it that reads this one's objects, so nothing of one refused stays; its commit one on `base`, walked whole;
 * every path one a checkout here takes (no `.git` in any spelling; on Windows, no `\` nor a name it refuses); no link of
 * it leading out of its tree. Then its pack moves into this repository. No ref is written: the caller keeps the commit
 * where it keeps the sub-agent's work. → the commit, or why not, in words: `again` where this machine failed it (a file
 * held a moment, a full disk), not what came; `lacks` where it builds on a commit this repository holds no more, for
 * the caller to ask for it without that one.
 * @param {string} repo @param {string} file @param {{ base: string }} o
 * @returns {Promise<{ ok: true, commit: string } | { ok: false, error: string, again?: true, lacks?: true }>}
 */
export async function importBack(repo, file, { base }) {
  const h = await bundleHeaderOf(file).catch(() => null);
  if (!h) return { ok: false, error: "what came back is no git bundle" };
  if (h.caps.some((c) => c !== "object-format=sha1")) return { ok: false, error: `what came back is a bundle this repository takes none of (${h.caps.join(", ").slice(0, 120)})` };
  if (h.heads.length !== 1 || !h.heads[0].ref.startsWith(BACK_REF_PREFIX)) return { ok: false, error: "what came back names one capture of Filament's alone, and this one names another" };
  const commit = h.heads[0].sha;
  for (const need of h.needs)
    if ((await gitWithoutHooks(["cat-file", "-e", `${need}^{commit}`], { cwd: repo })).code !== 0) return { ok: false, lacks: true, error: `what came back builds on ${need.slice(0, 12)}, which this repository does not hold` };
  const common = await git(["rev-parse", "--git-common-dir"], { cwd: repo });
  const objects = await git(["rev-parse", "--git-path", "objects"], { cwd: repo });
  if (common.code !== 0 || objects.code !== 0) return { ok: false, error: `git could not name this repository's folders: ${whyOf(common.code ? common : objects)}` };
  const own = resolve(repo, objects.out);
  const home = join(resolve(repo, common.out), INCOMING);
  mkdirSync(home, { recursive: true });
  for (const name of await readdir(home).catch(() => /** @type {string[]} */ ([]))) {
    const at = join(home, name);
    if (Date.now() - ((await stat(at).catch(() => null))?.mtimeMs ?? Date.now()) > INCOMING_TTL_MS) await rm(at, { recursive: true, force: true }).catch(() => {});
  }
  const q = await mkdtemp(join(home, "back-"));
  try {
    const made = await gitWithoutHooks(["init", "-q", "--bare", "--template=", q], { cwd: home });
    if (made.code !== 0) return { ok: false, error: `what came back could not be checked: ${whyOf(made)}` };
    mkdirSync(join(q, "objects", "info"), { recursive: true });
    writeFileSync(join(q, "objects", "info", "alternates"), `${own.split(sep).join("/")}\n`);
    const pre = [`--git-dir=${q}`];
    const run = (/** @type {string[]} */ args, /** @type {Omit<Parameters<typeof git>[1], "cwd">} */ o = {}) => gitWithoutHooks([...pre, ...args], { ...o, cwd: q });
    const packed = await run(["index-pack", "--stdin", "--fix-thin", "--strict"], { timeoutMs: TAKE_MS, input: createReadStream(file, { start: h.packAt }) });
    if (packed.code !== 0) return { ok: false, error: `what came back could not be taken in: ${whyOf(packed)}` };
    if ((await run(["cat-file", "-t", commit])).out !== "commit") return { ok: false, error: "what came back names no commit" };
    if ((await run(["merge-base", "--is-ancestor", base, commit])).code !== 0) return { ok: false, error: `what came back is not built on the copy sent (${base.slice(0, 12)})` };
    const whole = await run(["rev-list", "--objects", "--quiet", commit, ...(h.needs.length ? ["--not", ...h.needs] : [])], { timeoutMs: TAKE_MS });
    if (whole.code !== 0) return { ok: false, error: `what came back lacks what its commit names: ${whyOf(whole)}` };
    const paths = await gitWithoutHooks(["-c", "core.protectNTFS=true", "-c", "core.protectHFS=true", ...pre, "read-tree", commit], { cwd: q, env: { GIT_INDEX_FILE: join(q, "index") }, timeoutMs: LONG_MS });
    if (paths.code !== 0) return { ok: false, error: `what came back holds a path a checkout here would not take: ${whyOf(paths)}` };
    const astray = await linkAstray(pre, q, commit);
    if (!astray.ok) return { ok: false, error: `what came back could not be listed: ${astray.error}` };
    if (astray.path) return { ok: false, error: `what came back holds a link out of its tree (${astray.path.slice(0, 120)}): it is not taken` };
    // Its pack, then its indexes, so this repository never finds an index whose pack is not there yet.
    const packs = join(own, "pack");
    mkdirSync(packs, { recursive: true });
    const came = (await readdir(join(q, "objects", "pack"))).filter((n) => /^pack-[0-9a-f]+\.(pack|rev|idx)$/.test(n));
    for (const ext of [".pack", ".rev", ".idx"])
      for (const n of came.filter((x) => x.endsWith(ext))) if (!existsSync(join(packs, n))) await rename(join(q, "objects", "pack", n), join(packs, n));
    return { ok: true, commit };
  } catch (/** @type {any} */ e) {
    return { ok: false, again: true, error: `what came back could not be taken in: ${e?.message || e}` };
  } finally {
    await rm(q,{ recursive: true, force: true }).catch(() => {});
  }
}

/** Why a repository made in a copy stays there, said by its folder. */
const NESTED = "a repository of its own: none is sent yet";

/** Why what git ignores in a copy stays there, said by its name, a folder ignored whole by its own (`dist/`). */
const IGNORED = "ignored by git: none is sent";
/** How many such names a capture says: past it, their reason says how many there are in all. */
const IGNORED_MAX = 100;
/** How many names git ignores in a copy are looked at, and how many entries of their folders in all, for one capture. */
const IGNORED_LOOKS = 5000;

/** Where a mirror keeps when a copy was last placed (`checkoutCopy`), beside its capture's index. @param {string} mirror @param {string} pin */
const placedFile = (mirror, pin) => join(mirror, "filament-capture", `${refNameOf(pin)}.placed`);

/**
 * What git ignores in a copy that was made or changed there since the copy was placed (r-itself, 11-12): a build's
 * output, an install, a log — never read into the mirror and never sent, so said to stay there, by name, as what
 * `unreadOf` leaves is. A folder ignored whole is one name (`dist/`, as ls-files names it): a build makes thousands.
 * One counts where it, or anything in it, was written, changed or made after the copy was placed — what an earlier
 * launch left there (`checkoutCopy` keeps it) is none of this launch's work; `IGNORED_LOOKS` names are looked at, and
 * as many entries of their folders in all, so one change deep in a folder of thousands may go unsaid. `IGNORED_MAX`
 * names at most: past it the reason says how many there are. A copy placed before its time was kept says them all.
 * What cannot be listed is not said: the capture is not held up for it.
 * @param {string[]} pre @param {string} folder @param {Record<string, string>} env @param {AbortSignal | null} signal @param {number} since
 * @returns {Promise<{ path: string, why: string }[]>}
 */
const ignoredOf = async (pre, folder, env, signal, since) => {
  const ls = await gitBytes([...pre, "ls-files", "-o", "-i", "--exclude-standard", "--directory", "--no-empty-directory", "-z"], { cwd: folder, env, signal });
  if (ls.code !== 0) return [];
  /** @param {import("node:fs").Stats} st */
  const newer = (st) => Math.max(st.mtimeMs, st.ctimeMs, st.birthtimeMs) > since;
  let looks = IGNORED_LOOKS;
  /** Whether `path`, or an entry under it, breadth first, is newer than the copy's placing. @param {string} path */
  const touched = async (path) => {
    const st = await lstat(path).catch(() => null);
    if (!st) return false;
    if (newer(st)) return true;
    const queue = st.isDirectory() ? [path] : [];
    for (let dir = queue.shift(); dir && looks > 0; dir = queue.shift())
      for (const name of await readdir(dir).catch(() => /** @type {string[]} */ ([]))) {
        if (looks-- <= 0) return false;
        const inner = await lstat(join(dir, name)).catch(() => null);
        if (!inner) continue;
        if (newer(inner)) return true;
        if (inner.isDirectory()) queue.push(join(dir, name));
      }
    return false;
  };
  /** @type {string[]} */
  const names = [];
  for (const row of rowsOf(ls.out).slice(0, IGNORED_LOOKS)) {
    const path = nameOf(row);
    if (path != null && (await touched(join(folder, path)))) names.push(path);
  }
  const why = names.length > IGNORED_MAX ? `ignored by git, ${names.length} in all, the first ${IGNORED_MAX} named: none is sent` : IGNORED;
  return names.slice(0, IGNORED_MAX).map((path) => ({ path, why }));
};

/**
 * What a copy's capture never reads (`captureCopy`), found among the files git does not track there before its add
 * hashes any: a secret's file by its name, a file past `FILE_MAX_BYTES` (`leftOutWhy`) and a repository of its own
 * (`x/`, as ls-files names one) — read, each would lie in the mirror's objects though it stays there, and a repository
 * with no commit fails the add whole. `pre`: the mirror and the copy as its work tree. → each path with why, as
 * `leaveOut` says what stays; or why they could not be listed.
 * @param {string[]} pre @param {string} folder @param {Record<string, string>} env @param {AbortSignal | null} signal
 * @returns {Promise<{ ok: true, left: { path: string, why: string }[] } | { ok: false, error: string }>}
 */
const unreadOf = async (pre, folder, env, signal) => {
  const ls = await gitBytes([...pre, "ls-files", "-o", "--exclude-standard", "-z"], { cwd: folder, env, signal });
  if (ls.code !== 0) return { ok: false, error: `the copy's files could not be listed: ${firstLine(ls.err)}` };
  /** @type {{ path: string, why: string }[]} */
  const left = [];
  for (const row of rowsOf(ls.out)) {
    const path = nameOf(row);
    if (path == null) continue;
    if (path.endsWith("/")) {
      left.push({ path: path.slice(0, -1), why: NESTED });
      continue;
    }
    const why = leftOutWhy({ mode: "100644", path }) || leftOutWhy({ mode: "100644", path, size: (await lstat(join(folder, path)).catch(() => null))?.size });
    if (why) left.push({ path, why });
  }
  return { ok: true, left };
};

/** Where a mirror keeps each copy's newest capture: what its sub-agent changed there (cp-back). */
export const BACK_REF_PREFIX = "refs/filament/back/";

/**
 * What a sub-agent changed in its copy, to go back to the machine that sent it (cp-back): the copy's files as git sees
 * them — tracked and new, .gitignore respected — less what stays here (`leaveOut`), committed on the commit the copy
 * was checked out at, its pin's (Filament's record, never the copy's own `.git`, which its agents can write), and
 * bundled in a temp folder of its own (`dir`, the caller's to remove) without what the sender holds (`haves`). Every git
 * runs on the mirror, its work tree the copy: no config, hook or filter of the copy's is read, and every filter this
 * machine's configuration names is off, so a file goes as the copy has it (Git LFS's a pointer or its content). A capture of the same files on the same commit is the one before.
 * What stays there by its name or its size, and a repository made there, is never read into the mirror (`unreadOf`);
 * what git ignores there, made or changed since the copy was placed, is said to stay with them (`ignoredOf`).
 * `unchanged`: the copy is its commit, no bundle made; `had`: the sender holds the capture already, none made either.
 * A link out of the tree, read alone or through another, keeps it here. Each capture on a commit is built on the one
 * before as well, so a bundle without it carries only what changed since. `gone`: the copy, or its commit, is no more.
 * `bundle` false: the capture alone, kept on its ref, for a caller that keeps it there (`keepCapture`) and sends none.
 * @param {string} mirror @param {string} folder @param {{ pin: string, haves?: readonly string[], signal?: AbortSignal | null, bundle?: boolean }} o
 * @returns {Promise<{ ok: true, base: string, commit: string, unchanged: boolean, had: boolean, files: number, left: { path: string, why: string }[], dir: string | null, file: string | null, bytes: number, sha256: string }
 *   | { ok: false, error: string, gone?: true }>}
 */
export async function captureCopy(mirror, folder, { pin, haves = [], signal = null, bundle = true }) {
  if (!existsSync(folder)) return { ok: false, gone: true, error: "the copy is gone: what changed in it cannot be read" };
  const base = (await inMirror(mirror, ["rev-parse", "--verify", "-q", `${PINNED_REF_PREFIX}${refNameOf(pin)}^{commit}`])).out;
  if (!/^[0-9a-f]{40}$/.test(base)) return { ok: false, gone: true, error: "the commit the copy was checked out at is not kept: what changed in it cannot be read" };
  void sweepLeft();
  const dir = await mkdtemp(join(tmpdir(), CAPTURE_PREFIX));
  // Its index is kept between captures of the copy on that commit, so git reads again only the files whose stat moved.
  const indexes = join(mirror, "filament-capture");
  const index = join(indexes, `${refNameOf(pin)}.${base}`);
  let kept = false;
  let whole = false;
  try {
    mkdirSync(indexes, { recursive: true });
    const placed = placedFile(mirror, pin);
    for (const name of await readdir(indexes)) if (name.startsWith(`${refNameOf(pin)}.`) && join(indexes, name) !== index && join(indexes, name) !== placed) await rm(join(indexes, name), { force: true });
    // Every filter this machine's git configuration names is off, whichever the copy's .gitattributes picks, so no
    // program of one runs on what its agents wrote (`filtersOff`).
    const env = { GIT_INDEX_FILE: index, GIT_LFS_SKIP_SMUDGE: "1", ...(await filtersOff(mirror)) };
    const pre = ["-c", "core.longpaths=true", "-c", "core.splitIndex=false", `--git-dir=${mirror}`, `--work-tree=${folder}`];
    const run = (/** @type {string[]} */ args, timeoutMs = LONG_MS) => gitWithoutHooks([...pre, ...args], { cwd: folder, env, signal, timeoutMs });
    if (!existsSync(index)) {
      const read = await run(["read-tree", base]);
      if (read.code !== 0) return { ok: false, error: `git read-tree failed: ${whyOf(read)}` };
    }
    // What stays there by its name or its size, and a repository made there, are kept out of the add (`unreadOf`):
    // nothing of them is read into the mirror, and a repository with no commit, which fails git's add, fails none.
    const unread = await unreadOf(pre, folder, env, signal);
    if (!unread.ok) return unread;
    const added = unread.left.length
      ? await gitWithoutHooks([...pre, "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], { cwd: folder, env, signal, timeoutMs: TAKE_MS, input: [".", ...unread.left.map((l) => `:(exclude,literal)${l.path}`)].map((p) => `${p}\0`).join("") })
      : await run(["add", "-A", "--", "."], TAKE_MS);
    if (added.code !== 0) return { ok: false, error: `the copy's files could not be read: ${whyOf(added)}` };
    const shaped = await leaveOut({ pre, cwd: folder, env, at: base, keepSent: true, signal });
    if (!shaped.ok) return shaped;
    // What git ignores there, made or changed since the copy was placed, stays there too, and is said so (`ignoredOf`).
    const ignored = await ignoredOf(pre, folder, env, signal, Number(await readFile(placed, "utf8").catch(() => "")) || 0);
    // Said with what the index left out, in the order of their paths.
    shaped.left = [...unread.left, ...shaped.left, ...ignored].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const wt = await run(["write-tree"]);
    if (wt.code !== 0 || !wt.out) return { ok: false, error: `git write-tree failed: ${whyOf(wt)}` };
    whole = true;
    const tree = wt.out;
    const same = { ok: /** @type {const} */ (true), base, files: shaped.files, left: shaped.left, dir: null, file: null, bytes: 0, sha256: "" };
    if (tree === (await inMirror(mirror, ["rev-parse", `${base}^{tree}`])).out) return { ...same, commit: base, unchanged: true, had: false };
    const ref = `${BACK_REF_PREFIX}${refNameOf(pin)}`;
    const last = (await inMirror(mirror, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])).out;
    // The capture before on this commit is a parent of the next, so a bundle without it carries only what changed since.
    const onBase = !!last && (await inMirror(mirror, ["merge-base", "--is-ancestor", base, last])).code === 0;
    let commit = onBase && (await inMirror(mirror, ["rev-parse", `${last}^{tree}`])).out === tree ? last : "";
    if (!commit) {
      const ct = await run(["commit-tree", tree, "-p", base, ...(onBase ? ["-p", last] : []), "-m", "Filament: the copy as its sub-agent left it"]);
      if (ct.code !== 0 || !/^[0-9a-f]{40}$/.test(ct.out)) return { ok: false, error: `git commit-tree failed: ${whyOf(ct)}` };
      commit = ct.out;
    }
    const astray = await linkAstray([`--git-dir=${mirror}`], dirname(mirror), commit);
    if (!astray.ok) return { ok: false, error: `the copy's files could not be listed: ${astray.error}` };
    if (astray.path) return { ok: false, error: `the copy holds a link out of its tree (${astray.path.slice(0, 120)}): what changed in it stays there` };
    const kept_ = await inMirror(mirror, ["update-ref", ref, commit]);
    if (kept_.code !== 0) return { ok: false, error: `the capture could not be kept: ${whyOf(kept_)}` };
    if (haves.includes(commit) || !bundle) return { ...same, commit, unchanged: false, had: haves.includes(commit) };
    /** @type {string[]} */
    const held = [];
    for (const h of haves) if (/^[0-9a-f]{40}$/.test(h) && h !== base && (await inMirror(mirror, ["cat-file", "-e", `${h}^{commit}`])).code === 0) held.push(h);
    const file = join(dir, "back.bundle");
    const b = await gitWithoutHooks([`--git-dir=${mirror}`, "bundle", "create", "-q", file, ref, `^${base}`, ...held.map((h) => `^${h}`)], { cwd: dirname(mirror), signal, timeoutMs: LONG_MS });
    if (b.code !== 0 || !existsSync(file)) return { ok: false, error: `git bundle failed: ${whyOf(b)}` };
    kept = true;
    return { ...same, commit, unchanged: false, had: false, dir, file, ...(await digestOf(file)) };
  } finally {
    if (!kept) await rm(dir, { recursive: true, force: true }).catch(() => {});
    // One a capture stopped part way is read again from the commit next time.
    if (!whole) await rm(index, { force: true }).catch(() => {});
  }
}

/**
 * The temp folders a copy is bundled in to go (`bundleSnapshot`), its capture to go back (`captureCopy`) and a capture
 * come back to be read (remote-agents.js `takeBack`): each its caller's to remove, those a crash or a restart left
 * swept a day on.
 */
const SEND_PREFIX = "filament-send-";
const CAPTURE_PREFIX = "filament-capture-";
export const BACK_PREFIX = "filament-back-";
let sweptAt = 0;
/**
 * Such folders no caller removed (a crash mid-send, a restart while a capture waited to be read), swept at most once an
 * hour, by a send here or a capture: Filament's own by their names, in the temp folder alone, a day old.
 */
const sweepLeft = async () => {
  if (Date.now() - sweptAt < 3600_000) return;
  sweptAt = Date.now();
  for (const name of await readdir(tmpdir()).catch(() => /** @type {string[]} */ ([]))) {
    if (![SEND_PREFIX, CAPTURE_PREFIX, BACK_PREFIX].some((p) => name.startsWith(p))) continue;
    const at = join(tmpdir(), name);
    if (Date.now() - ((await stat(at).catch(() => null))?.mtimeMs ?? Date.now()) > INCOMING_TTL_MS) await rm(at, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * Where a mirror keeps a copy's state as its chat left it, once a newer launch takes the copy or it goes for room (the
 * review of 11-11: a checkout over it took what its sub-agent changed, never brought back). Under `BACK_REF_PREFIX`, so
 * a bundle of one names a capture of Filament's, which the machine it goes back to takes as one (`importBack`); no
 * copy's pin is "kept", so none of these is a copy's newest capture.
 */
export const KEPT_REF_PREFIX = `${BACK_REF_PREFIX}kept/`;

/**
 * A capture (`captureCopy`'s commit) kept under a name of its own, which the copy's next checkout and captures leave.
 * → "" once kept, else why not. @param {string} mirror @param {string} commit @param {string} name
 */
export async function keepCapture(mirror, commit, name) {
  if (!/^[0-9a-f]{40}$/.test(commit)) return "the capture to keep is 40 hex digits";
  const kept = await inMirror(mirror, ["update-ref", `${KEPT_REF_PREFIX}${refNameOf(name)}`, commit]);
  return kept.code === 0 ? "" : `the copy's state could not be kept: ${whyOf(kept)}`;
}

/**
 * A kept capture bundled to go back, as `captureCopy` bundles a copy's: without the commit it was made on (`base`) and
 * what the sender holds (`haves`), in a temp folder of its own (`dir`, the caller's to remove). `gone`: it is kept no
 * more. @param {string} mirror @param {string} name
 * @param {{ base: string, haves?: readonly string[], signal?: AbortSignal | null }} o
 * @returns {Promise<{ ok: true, commit: string, dir: string, file: string, bytes: number, sha256: string } | { ok: false, error: string, gone?: true }>}
 */
export async function bundleKept(mirror, name, { base, haves = [], signal = null }) {
  const ref = `${KEPT_REF_PREFIX}${refNameOf(name)}`;
  const commit = existsSync(mirror) ? (await inMirror(mirror, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])).out : "";
  if (!/^[0-9a-f]{40}$/.test(commit)) return { ok: false, gone: true, error: "what was kept of the copy is no more" };
  /** @type {string[]} */
  const held = [];
  for (const h of [base, ...haves]) if (/^[0-9a-f]{40}$/.test(h) && !held.includes(h) && (await inMirror(mirror, ["cat-file", "-e", `${h}^{commit}`])).code === 0) held.push(h);
  void sweepLeft();
  const dir = await mkdtemp(join(tmpdir(), CAPTURE_PREFIX));
  const file = join(dir, "back.bundle");
  const b = await gitWithoutHooks([`--git-dir=${mirror}`, "bundle", "create", "-q", file, ref, ...held.map((h) => `^${h}`)], { cwd: dirname(mirror), signal, timeoutMs: LONG_MS });
  if (b.code !== 0 || !existsSync(file)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: `git bundle failed: ${whyOf(b)}` };
  }
  return { ok: true, commit, dir, file, ...(await digestOf(file)) };
}

/**
 * The kept captures of a mirror let go, all but those named (`live`): their refs deleted, what they alone held going at
 * git's own pace. @param {string} mirror @param {readonly string[]} live
 */
export async function dropKept(mirror, live) {
  if (!existsSync(mirror)) return;
  const all = await inMirror(mirror, ["for-each-ref", "--format=%(refname)", KEPT_REF_PREFIX]);
  const keep = new Set(live.map((n) => `${KEPT_REF_PREFIX}${refNameOf(n)}`));
  const old = all.code === 0 ? all.out.split(/\r?\n/).filter((r) => r && !keep.has(r)) : [];
  if (old.length) await inMirror(mirror, ["update-ref", "--stdin"], { input: old.map((r) => `delete ${r}\n`).join("") });
}
