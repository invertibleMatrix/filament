// @ts-check
// Copy-on-write clones for an agent's copy (the owner's plan of 11-09 for big repositories, phase 3). Where the drive
// clones files — APFS's clonefile; a reflink on btrfs, XFS, bcachefs or ZFS 2.2; on Windows from build 26100 a block
// clone on ReFS (a Dev Drive), which every copy of a file there makes —, a copy of the repository is its folder cloned
// rather than checked out: what git ignores — a Unity project's Library, a build's caches — comes warm, at almost no
// disk cost. Whether a drive clones is asked once for a repository's home of copies and kept there (`COW_FILE`). A clone
// is a worktree git makes with nothing checked out, the folder's files cloned into it; its index the snapshot's own of
// the folder, each entry given the clone's stat as git records it where git's minimal check finds the file as the
// snapshot read it — so neither Filament's git nor the builder's reads a file again —; then put back to the commit it
// starts at, a file written while the clone ran with it. Filament's git runs there with git's minimal stat check: a
// clone's inode and change time are its own. Nothing is written outside the clone and its record but the drive's answer.
import { createHash, randomUUID } from "node:crypto";
import { constants, copyFileSync, lstatSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fewAtOnce } from "../../core/at-once.js";
import { firstLine, git, plainIndex, snapshotTree } from "./snapshot.js";
import { repoPath } from "./sparse.js";
import { execFileOffThread } from "./spawn-pool.js";

/** Where a repository's home of copies keeps whether its drive clones: a name its copies' list leaves out. */
export const COW_FILE = ".cow.json";
/** Windows clones a file on ReFS in every copy of it from this build on (Windows 11 24H2, Server 2025). */
const WINDOWS_CLONES_FROM = 26100;
/** Files cloned side by side: a clone is the drive's bookkeeping, each file one open and one close. */
const CLONE_AT_ONCE = 16;
/** A clone where the drive makes one, else a copy; never over a file that is there (as a template's, template.js). */
const CLONE_MODE = constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE;
/** Folders a clone leaves out wherever they stand: Unity's Temp, the running editor's own (its lock among it). */
const LEFT_OUT_DIRS = new Set(["Temp"]);
/** A running program's lock: one cloned reads as that program at work in the clone. A tracked one comes back from git. */
const LOCK = /(?:^|[._-])lock$|lockfile$|\.lck$/i;
/** Filament's git in a clone: git's minimal stat check, as a clone's inode and change time are its own. */
const MINIMAL = Object.freeze(["-c", "core.checkStat=minimal", "-c", "core.trustctime=false"]);
/** How long git may take to make a clone's worktree, or to put it back: a big repository's takes its time. */
const GIT_MS = 5 * 60_000;
/**
 * The build caches a clone keeps warm, by the names their tools give them: an engine's imported assets (Unity's
 * Library, Unreal's DerivedDataCache and Intermediate), a compiler's or a bundler's output and caches — what takes
 * minutes to make again. The dependency folders a copy links in (worktree.js `DEPENDENCY_DIRS`) are no reason to clone:
 * every copy has them.
 */
export const BUILD_CACHES = Object.freeze(["Library", "DerivedDataCache", "Intermediate", "target", "build", ".gradle", "obj", ".next", ".turbo", ".nx", ".angular", ".parcel-cache", ".build", "DerivedData", "_build", ".zig-cache", "zig-cache", "dist-newstyle", ".stack-work"]);

/**
 * What a drive does with a copy of a file: `cow`, it clones it; `how`, in words; `verified`, the probe saw a clone made
 * or refused — Windows' block clone on ReFS is read from the drive's kind and the system's build, never seen.
 * @typedef {{ cow: boolean, how: string, verified: boolean }} CowAnswer
 * @typedef {(home: string) => Promise<CowAnswer>} CowProbe
 */

/**
 * Whether the drive `home` is on clones files: on macOS and Linux a file made there is cloned with the clone forced,
 * which fails where the drive cannot; on Windows PowerShell names the drive's file system (`Get-Volume`) — ReFS clones —
 * beside the system's build. The probe's files go.
 * @type {CowProbe}
 */
async function probeCow(home) {
  if (process.platform === "win32") {
    const build = Number(release().split(".")[2]) || 0;
    if (build < WINDOWS_CLONES_FROM) return { cow: false, how: `Windows clones files from build ${WINDOWS_CLONES_FROM} (24H2) on; this is ${build}`, verified: true };
    const r = await execFileOffThread(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-Volume -FilePath '${home.replace(/'/g, "''")}').FileSystemType`],
      { timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true },
    );
    const kind = String(r.stdout || "").trim();
    if (r.failure || !kind) return { cow: false, how: `the drive's file system could not be read (${firstLine(r.stderr || r.failure?.message) || "no answer"})`, verified: false };
    return /^refs$/i.test(kind) ? { cow: true, how: `ReFS on Windows build ${build}: a copy of a file is a block clone`, verified: false } : { cow: false, how: `${kind} does not clone files`, verified: true };
  }
  const a = join(home, `.cow-probe-${randomUUID().slice(0, 8)}`);
  const b = `${a}-clone`;
  try {
    writeFileSync(a, "Filament asks whether this drive clones files\n");
    copyFileSync(a, b, constants.COPYFILE_FICLONE_FORCE);
    return { cow: true, how: process.platform === "darwin" ? "the drive clones files (APFS)" : "the drive clones files (a reflink)", verified: true };
  } catch (/** @type {any} */ e) {
    return { cow: false, how: `the drive does not clone files (${e?.code || firstLine(e?.message)})`, verified: true };
  } finally {
    rmSync(a, { force: true });
    rmSync(b, { force: true });
  }
}
/** @type {CowProbe} */
let probe = probeCow;
/**
 * The probe asked from now on — the tests' drive that clones, or does not —; null puts the drive's own back. The one
 * it replaces.
 * @param {CowProbe | null} next
 */
export function setCowProbe(next) {
  const was = probe;
  probe = next || probeCow;
  return was;
}

/**
 * Whether the drive a repository's home of copies is on clones files (`probeCow`): asked once and kept in the home
 * (`COW_FILE`) with the drive's number and the system's version — a repository moved to another drive, or a system
 * updated, is asked again. A probe that fails is said, and not kept — nor a "does not clone" it could not see, a
 * PowerShell that gave no answer: kept, it would stand until the drive or the system changed. `from`: the folder its
 * copies are cloned from — on another drive, none is a clone, a copy across drives writing every byte: nothing is asked.
 * @param {string} home @param {string} [from]
 * @returns {Promise<CowAnswer>}
 */
export async function cowSupport(home, from = home) {
  let dev = "";
  try {
    dev = String(statSync(home).dev);
  } catch {
    return { cow: false, how: "the copies' folder is not there", verified: false };
  }
  try {
    if (String(statSync(from).dev) !== dev) return { cow: false, how: "the folder is on another drive than its copies: a copy across drives is every byte written", verified: true };
  } catch {
    return { cow: false, how: "the folder is not there", verified: false };
  }
  const os = `${process.platform} ${release()}`;
  const file = join(home, COW_FILE);
  try {
    const k = JSON.parse(readFileSync(file, "utf8"));
    if (k?.dev === dev && k.os === os && typeof k.cow === "boolean" && typeof k.how === "string" && (k.cow || k.verified)) return { cow: k.cow, how: k.how, verified: !!k.verified };
  } catch {}
  /** @type {CowAnswer} */
  let got;
  try {
    got = await probe(home);
  } catch (/** @type {any} */ e) {
    return { cow: false, how: `whether the drive clones could not be read: ${firstLine(e?.message || String(e))}`, verified: false };
  }
  const answer = { cow: !!got.cow, how: String(got.how || ""), verified: !!got.verified };
  if (!answer.cow && !answer.verified) return answer;
  try {
    writeFileSync(file, JSON.stringify({ ...answer, dev, os, at: Date.now() }));
  } catch {
    // Not kept, the next copy asks again: the answer stands.
  }
  return answer;
}

/**
 * The folder `from` cloned into `to` (which stands), but for git's folder, a nested repository's contents (its folder
 * made, empty, as a checkout leaves a submodule's), the folders `skip` names (from the top, with "/") and those named
 * `Temp`, a lock, and every link — a link cloned could lead a clean or a removal out of the clone; git puts a tracked one
 * back. Each file keeps its time, read after its clone: git's stat of it then reads it as the snapshot did, unless it
 * was written meanwhile. A file that cannot be read is left out — a tracked one comes back with the put-back —; a full
 * disk or `signal` stops it, in words.
 * @param {string} from @param {string} to @param {{ skip: ReadonlySet<string>, signal: AbortSignal | null }} o
 * @returns {Promise<{ ok: true, files: number, left: number } | { ok: false, error: string }>}
 */
async function cloneTree(from, to, { skip, signal }) {
  let files = 0;
  let left = 0;
  /** @type {string | null} */
  let cut = null;
  /** @type {Set<Promise<void>>} */
  const running = new Set();
  // Windows' copy keeps a file's time itself; elsewhere a copy is new, its time set back.
  const setTimes = process.platform !== "win32";
  /** @param {string} src @param {string} dst */
  const one = async (src, dst) => {
    try {
      await copyFile(src, dst, CLONE_MODE);
      if (setTimes) {
        const st = await stat(src);
        await utimes(dst, st.atimeMs / 1000, st.mtimeMs / 1000);
      }
      files++;
    } catch (/** @type {any} */ e) {
      if (e?.code === "ENOSPC") cut = "the disk is full (ENOSPC)";
      left++;
      await unlink(dst).catch(() => {});
    }
  };
  /** @type {string[]} */
  const dirs = [""];
  while (dirs.length && !cut) {
    const rel = /** @type {string} */ (dirs.pop());
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = await readdir(join(from, rel), { withFileTypes: true });
    } catch {
      left++;
      continue;
    }
    if (rel && entries.some((e) => e.name === ".git")) {
      left++;
      continue;
    }
    for (const e of entries) {
      if (signal?.aborted) cut = firstLine(String(signal.reason?.message || signal.reason || "stopped"));
      if (cut) break;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === ".git" || e.isSymbolicLink()) left++;
      else if (e.isDirectory()) {
        if (LEFT_OUT_DIRS.has(e.name) || skip.has(r)) {
          left++;
          continue;
        }
        try {
          await mkdir(join(to, r));
          dirs.push(r);
        } catch (/** @type {any} */ err) {
          if (err?.code === "EEXIST") dirs.push(r);
          else left++;
        }
      } else if (e.isFile() && !LOCK.test(e.name)) {
        while (running.size >= CLONE_AT_ONCE) await Promise.race(running);
        const t = one(join(from, r), join(to, r)).finally(() => running.delete(t));
        running.add(t);
      } else left++;
    }
  }
  await Promise.all(running);
  return cut ? { ok: false, error: `the clone stopped: ${cut}` } : { ok: true, files, left };
}

/**
 * An index's entries given the clone's stat of their files as git records it, in place: `b`, an index `plainIndex`
 * passed, of a SHA-1 repository. Only a file whose size and whole-second time are its entry's — git's minimal check —,
 * the time before `beforeSec`, the second the snapshot's index was written in — a file written in it may have changed
 * unseen (git's racy entries) —; a link, a submodule, a file in conflict or one of no size (git's smudged entry) is left
 * as it was, for git to read again. Git for Windows records no device, inode, owner or group, and a file's creation
 * time as its change time. The checksum is written again where the index has one. How many entries were given the
 * clone's stat.
 * @param {Buffer} b @param {string} top  the clone's top folder @param {number} beforeSec
 */
export async function restatIndex(b, top, beforeSec) {
  const version = b.readUInt32BE(4);
  const count = b.readUInt32BE(8);
  const end = b.length - 20;
  /** @type {{ at: number, path: string, size: number, sec: number }[]} */
  const files = [];
  let at = 12;
  let last = Buffer.alloc(0);
  for (let i = 0; i < count; i++) {
    const flags = b.readUInt16BE(at + 60);
    let p = at + 62 + (flags & 0x4000 ? 2 : 0);
    /** @type {Buffer} */
    let name;
    let next;
    if (version === 4) {
      // How much of the last path to drop, as git's varint, then the rest of this one, NUL-ended.
      let c = b[p++];
      let drop = c & 0x7f;
      while (c & 0x80) {
        c = b[p++];
        drop = (drop + 1) * 128 + (c & 0x7f);
      }
      const nul = b.indexOf(0, p);
      name = last = Buffer.concat([last.subarray(0, last.length - drop), b.subarray(p, nul)]);
      next = nul + 1;
    } else {
      const nul = b.indexOf(0, p);
      name = b.subarray(p, nul);
      next = at + ((nul - at + 8) & ~7);
    }
    const mode = b.readUInt32BE(at + 24);
    const size = b.readUInt32BE(at + 36);
    const sec = b.readUInt32BE(at + 8);
    if ((flags & 0x3000) === 0 && (mode & 0o170000) === 0o100000 && size > 0 && sec < beforeSec) files.push({ at, path: name.toString("utf8"), size, sec });
    at = next;
  }
  const M = 0xffffffffn;
  const NS = 1_000_000_000n;
  const windows = process.platform === "win32";
  let given = 0;
  await fewAtOnce(
    files,
    async (f) => {
      /** @type {import("node:fs").BigIntStats} */
      let st;
      try {
        st = await lstat(join(top, f.path), { bigint: true });
      } catch {
        return;
      }
      if (!st.isFile() || Number(st.size & M) !== f.size || Number((st.mtimeNs / NS) & M) !== f.sec) return;
      /** @param {bigint} v @param {number} o */
      const put = (v, o) => b.writeUInt32BE(Number(v & M), f.at + o);
      const ct = windows ? st.birthtimeNs : st.ctimeNs;
      put(ct / NS, 0);
      put(ct % NS, 4);
      put(st.mtimeNs / NS, 8);
      put(st.mtimeNs % NS, 12);
      put(windows ? 0n : st.dev, 16);
      put(windows ? 0n : st.ino, 20);
      put(windows ? 0n : st.uid, 28);
      put(windows ? 0n : st.gid, 32);
      given++;
    },
    32,
  );
  // An index written with `index.skipHash` has no checksum: none is made for it.
  if (given && b.subarray(end).some((x) => x !== 0)) createHash("sha1").update(b.subarray(0, end)).digest().copy(b, end);
  return given;
}

/**
 * Of `BUILD_CACHES`, the folders at the repository's top and in the session's folder that are there and git ignores —
 * what a clone brings warm and a checkout never has —, from the top with "/". One git run asks for them all; none on
 * disk asks none. A link to one — a Library a junction moved to another drive — is none: a clone leaves links out
 * (`cloneTree`), linked in the copy it would be the developer's cache every builder writes, and cloned through it
 * would be every byte copied across drives.
 * @param {string} repo  the repository's top folder @param {string} folder  the session's folder
 * @returns {Promise<string[]>}
 */
export async function buildCaches(repo, folder) {
  const at = repoPath(repo, folder);
  /** @type {string[]} */
  const there = [];
  for (const base of new Set(["", at || ""]))
    for (const n of BUILD_CACHES) {
      const rel = base ? `${base}/${n}` : n;
      try {
        if (lstatSync(join(repo, rel)).isDirectory()) there.push(rel);
      } catch {}
    }
  if (!there.length) return [];
  // Exit 1: git ignores none of them.
  const r = await git(["check-ignore", "-z", "--stdin"], { cwd: repo, input: `${there.join("\0")}\0` });
  return r.code === 0 ? r.out.split("\0").filter(Boolean) : [];
}

/** Git's record of the worktree at `dest`, as its `.git` file names it; null where it names none. @param {string} dest */
const recordOf = (dest) => {
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(dest, ".git"), "utf8"));
    return m ? resolve(dest, m[1]) : null;
  } catch {
    return null;
  }
};

/**
 * A clone of the repository's folder at `dest`, at `commit`: git's worktree of it made with nothing checked out, hooks
 * off; the folder cloned into it (`cloneTree`), `skip` left out — the dependency folders a copy links, from the top with
 * "/" —; its index the snapshot's — `index`, a snapshot's kept index (`snapshotTree`'s `keepIndex`), else one taken now
 * — given the clone's stat (`restatIndex`); then put back to `commit`: every tracked file as `commit` has it — git
 * rewrites those whose stat moved, a file written while the clone ran among them — and what git neither tracks nor
 * ignores removed. What git ignores stays: the builder's caches. The snapshot's index goes, with its folder, either way.
 * `checkout`: what the put-back runs with, as the copy holds the files Git LFS keeps (worktree.js `checkoutFor`) — a
 * builder's writes their pointers, never fetching —: its `-c` and its environment. Not made, why: what was made of it
 * is the caller's to remove (`forgetTaskWorktree`).
 * @param {string} repo  the repository's top folder @param {string} dest @param {string} commit  a full commit id
 * @param {{ index?: string | null, skip?: ReadonlySet<string>, signal?: AbortSignal | null, checkout?: { args: readonly string[], env: Record<string, string> } }} [o]
 * @returns {Promise<{ ok: true, ms: number, files: number, left: number, restat: number } | { ok: false, error: string }>}
 */
export async function makeClone(repo, dest, commit, { index = null, skip = new Set(), signal = null, checkout = { args: [], env: {} } } = {}) {
  let kept = index;
  const began = Date.now();
  try {
    if (!kept) {
      const snap = await snapshotTree(repo, { name: `clone-${basename(dest)}`, keep: false, keepIndex: true, signal, message: "Filament: the folder as its clone began" });
      if (!snap.ok || !snap.index) return { ok: false, error: snap.error || "the folder could not be read for its clone" };
      kept = snap.index;
    }
    const before = Math.floor(statSync(kept).mtimeMs / 1000);
    const quiet = ["-c", `core.hooksPath=${join(dirname(dest), ".no-hooks")}`];
    const wt = await git([...quiet, "worktree", "add", "--no-checkout", "--detach", dest, commit], { cwd: repo, timeoutMs: GIT_MS, signal });
    if (wt.code !== 0) return { ok: false, error: `git worktree add failed: ${firstLine(wt.err || wt.out || wt.error)}` };
    const record = recordOf(dest);
    if (!record) return { ok: false, error: "git made the clone's worktree with no record of it" };
    const cloned = await cloneTree(repo, dest, { skip, signal });
    if (!cloned.ok) return cloned;
    const b = await readFile(kept);
    // A SHA-1 repository's plain index alone is read; any other stays as the snapshot wrote it, and git reads its files again.
    const restat = commit.length === 40 && plainIndex(b) ? await restatIndex(b, dest, before) : 0;
    const tmp = join(record, `index.filament-${process.pid}.tmp`);
    await writeFile(tmp, b);
    await rename(tmp, join(record, "index"));
    const back = await git([...quiet, ...MINIMAL, ...checkout.args, "reset", "--hard", "--quiet", commit], { cwd: dest, env: checkout.env, timeoutMs: GIT_MS, signal });
    if (back.code !== 0) return { ok: false, error: `git reset failed: ${firstLine(back.err || back.out || back.error)}` };
    const clean = await git([...quiet, ...MINIMAL, "clean", "-fd", "--quiet"], { cwd: dest, timeoutMs: GIT_MS, signal });
    if (clean.code !== 0) return { ok: false, error: `git clean failed: ${firstLine(clean.err || clean.out || clean.error)}` };
    return { ok: true, ms: Date.now() - began, files: cloned.files, left: cloned.left, restat };
  } catch (/** @type {any} */ e) {
    return { ok: false, error: firstLine(e?.message || String(e)) };
  } finally {
    // The snapshot's own temporary folder goes whole; an index anywhere else, alone.
    if (kept) await rm(basename(dirname(kept)).startsWith("filament-snap-") ? dirname(kept) : kept, { recursive: true, force: true }).catch(() => {});
  }
}
