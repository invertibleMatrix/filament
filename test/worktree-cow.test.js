// @ts-check
// Copy-on-write clones for an agent's copy (the owner's plan of 11-09 for big repositories, phase 3), against real
// repositories: where the drive clones files, a copy asked for as a clone is the folder cloned — what git ignores (a
// Unity project's Library) warm in it —, git's index of it the snapshot's own with each file's stat the clone's, put back
// to the commit it starts at; elsewhere a checkout, as before. Which drive clones is the probe's answer, given here: this
// machine's may clone nothing, and a clone made by plain copies is the same clone, only slower and bigger.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { cowSupport, makeClone, setCowProbe } from "../src/adapters/git/cow.js";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import {
  captureTaskWork, forgetTaskWorktree, letGoOfCopies, openTaskWorktree, pruneTaskWorktrees, releaseTaskWorktree, removeTaskWorktree, takeTaskWorktree, taskRefs,
} from "../src/adapters/git/worktree.js";
import { copyMeta } from "./helpers/copies.js";
import { fakeLfs, useFakeLfs } from "./helpers/fake-lfs.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
afterEach(() => setCowProbe(null));
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** @param {string} p @param {string} text */
const put = (p, text) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
};
/** A drive that clones, as the probe would say of APFS or btrfs. */
const CLONES = async () => ({ cow: true, how: "the test's drive clones", verified: true });
/** A drive that does not, as of NTFS or ext4. */
const COPIES = async () => ({ cow: false, how: "the test's drive does not clone", verified: true });
/**
 * Past the second the files were written in, and the folder's index read again since: git's stat of each file is then
 * no longer racy — what a developer's folder is, its files written before the agent is launched.
 * @param {string} dir
 */
const settle = async (dir) => {
  await new Promise((r) => setTimeout(r, 1100));
  git(dir, "status", "--porcelain");
};
/**
 * A Unity-style project: tracked sources, and what git ignores — the Library of imported assets (a lock among it), the
 * running editor's Temp, node_modules —, settled.
 */
const unity = async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-cow-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\nLibrary/\nTemp/\nvendor/\ncachelink\n");
  put(join(dir, "Assets", "Player.cs"), "class Player {}\n");
  put(join(dir, "Assets", "Enemy.cs"), "class Enemy {}\n");
  put(join(dir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.1f1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  put(join(dir, "Library", "ArtifactDB"), "imported assets, hours of them\n");
  put(join(dir, "Library", "ArtifactDB-lock"), "the editor's lock\n");
  put(join(dir, "Temp", "UnityLockfile"), "the running editor\n");
  put(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  await settle(dir);
  return dir;
};

// (fails before: yes — there was no cow.js: nothing asked whether a drive clones)
test("whether the drive clones is asked once for a repository's copies and kept beside them — asked again for another drive or system —; this machine's own answer is said, its probe's files gone", async (t) => {
  const dir = await unity();
  const home = join(dir, ".git", "filament-worktrees");
  mkdirSync(home, { recursive: true });
  let asked = 0;
  setCowProbe(async () => (asked++, { cow: true, how: "the test's drive clones", verified: true }));
  const one = await cowSupport(home);
  const two = await cowSupport(home);
  assert.deepEqual([one.cow, two.cow, asked], [true, true, 1], "asked once");
  const kept = JSON.parse(read(join(home, ".cow.json")));
  assert.equal(kept.cow, true);
  writeFileSync(join(home, ".cow.json"), JSON.stringify({ ...kept, dev: "another drive" }));
  assert.equal((await cowSupport(home)).cow, true);
  assert.equal(asked, 2, "a repository moved to another drive is asked again");
  writeFileSync(join(home, ".cow.json"), JSON.stringify({ ...kept, os: "another system" }));
  await cowSupport(home);
  assert.equal(asked, 3, "after the system's update too: Windows clones on ReFS from build 26100");
  // A probe that fails: no clone, said.
  rmSync(join(home, ".cow.json"));
  setCowProbe(async () => {
    throw new Error("no answer");
  });
  const failed = await cowSupport(home);
  assert.deepEqual([failed.cow, /no answer/.test(failed.how)], [false, true]);
  // This machine's drive, by the real probe.
  setCowProbe(null);
  const other = await unity();
  const h = join(other, ".git", "filament-worktrees");
  mkdirSync(h, { recursive: true });
  const real = await cowSupport(h);
  t.diagnostic(`this machine's drive: ${real.cow ? "clones" : "does not clone"} — ${real.how}${real.verified ? "" : " (unverified)"}`);
  assert.deepEqual([typeof real.cow, typeof real.how, real.how.length > 0], ["boolean", "string", true]);
  assert.deepEqual(readdirSync(h), [".cow.json"], "the probe's files went");
});

// (fails before: yes — a Windows probe whose PowerShell gave no answer was kept as "does not clone", until the drive or
// the system changed)
test("a probe that could not tell whether the drive clones is not kept, nor read back where an older Filament kept one: the next copy asks again; ReFS's clone, read from the drive's kind, is kept", async () => {
  const home = mkdtempSync(join(tmpdir(), "filament-cow-home-"));
  made.push(home);
  let asked = 0;
  setCowProbe(async () => (asked++, { cow: false, how: "the drive's file system could not be read (no answer)", verified: false }));
  const one = await cowSupport(home);
  const two = await cowSupport(home);
  assert.deepEqual([one.cow, two.cow, asked, existsSync(join(home, ".cow.json"))], [false, false, 2, false], "asked each time, nothing kept");
  // One an older Filament kept.
  const { dev } = lstatSync(home);
  writeFileSync(join(home, ".cow.json"), JSON.stringify({ cow: false, how: "the drive's file system could not be read (no answer)", verified: false, dev: String(dev), os: `${process.platform} ${release()}`, at: 1 }));
  await cowSupport(home);
  assert.equal(asked, 3, "a kept failure is asked again");
  setCowProbe(async () => (asked++, { cow: true, how: "ReFS on Windows build 26100: a copy of a file is a block clone", verified: false }));
  rmSync(join(home, ".cow.json"));
  assert.deepEqual([(await cowSupport(home)).cow, (await cowSupport(home)).cow, asked], [true, true, 4], "kept");
});

// (fails before: yes — the copies' drive alone was asked: a folder on another drive, a linked worktree's, was "cloned",
// every byte of it written — its Library's gigabytes too)
test("a folder on another drive than its copies is never cloned — a copy from one drive to another writes every byte —: nothing asked, nothing kept", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "filament-cow-home-"));
  made.push(home);
  const other = process.cwd();
  if (lstatSync(other).dev === lstatSync(home).dev) return t.skip("the temp folder and the project are on one drive here");
  let asked = 0;
  setCowProbe(async () => (asked++, { cow: true, how: "the test's drive clones", verified: true }));
  const across = await cowSupport(home, other);
  assert.deepEqual([across.cow, across.verified, asked, existsSync(join(home, ".cow.json"))], [false, true, 0, false]);
  assert.deepEqual([(await cowSupport(home, home)).cow, asked], [true, 1], "from its own drive, cloned");
});

// (fails before: yes — there was no kind: a copy was a checkout)
test("where the drive clones nothing, a clone asked for is a checkout, as before: nothing git ignores in it, and its record says it is one", async () => {
  setCowProbe(COPIES);
  const dir = await unity();
  const o = await openTaskWorktree(dir, { id: "sa_c0000001", kind: "clone" });
  assert.ok(o.ok, o.ok ? "" : o.error);
  assert.deepEqual([o.wt.kind, copyMeta(o.wt.dest)?.kind], ["worktree", "worktree"]);
  assert.deepEqual([read(join(o.wt.workdir, "Assets", "Player.cs")), existsSync(join(o.wt.workdir, "Library"))], ["class Player {}\n", false]);
  assert.equal(lstatSync(join(o.wt.workdir, "node_modules")).isSymbolicLink(), true);
  await removeTaskWorktree(o.wt);
});

// (fails before: yes — a copy was a checkout: the Library was not in it, so an engine builder could not even build)
test("on a drive that clones, the copy is the folder cloned: the Library warm in it, not Temp, a lock, a nested repository's contents, a link, nor git's folder; the dependency folders linked as on every copy", async () => {
  setCowProbe(CLONES);
  const dir = await unity();
  // A repository inside (an embedded package's), and a link to a folder outside, both ignored.
  const outside = mkdtempSync(join(tmpdir(), "filament-cow-outside-"));
  made.push(outside);
  writeFileSync(join(outside, "keep.txt"), "not Filament's\n");
  mkdirSync(join(dir, "vendor", "pkg"), { recursive: true });
  git(join(dir, "vendor", "pkg"), "init", "-q");
  writeFileSync(join(dir, "vendor", "pkg", "x.txt"), "its own\n");
  symlinkSync(outside, join(dir, "cachelink"), process.platform === "win32" ? "junction" : "dir");
  const o = await openTaskWorktree(dir, { id: "sa_c0000002", kind: "clone" });
  assert.ok(o.ok, o.ok ? "" : o.error);
  const w = o.wt.workdir;
  assert.deepEqual([o.wt.kind, copyMeta(o.wt.dest)?.kind], ["clone", "clone"]);
  assert.equal(read(join(w, "Library", "ArtifactDB")), "imported assets, hours of them\n", "the Library came warm");
  assert.deepEqual(
    [existsSync(join(w, "Library", "ArtifactDB-lock")), existsSync(join(w, "Temp")), existsSync(join(w, "vendor", "pkg", ".git")), existsSync(join(w, "vendor", "pkg", "x.txt")), existsSync(join(w, "cachelink"))],
    [false, false, false, false, false],
    "no lock, no Temp, nothing of a nested repository, no link",
  );
  assert.match(read(join(o.wt.dest, ".git")), /^gitdir: .*worktrees/m, "its own record, never the developer's git folder");
  assert.equal(lstatSync(join(w, "node_modules")).isSymbolicLink(), true, "node_modules linked, not cloned");
  assert.equal(read(join(w, "node_modules", "pkg", "index.js")), "module.exports = 1;\n");
  assert.equal(git(o.wt.dest, "status", "--porcelain"), "", "at its commit, git says");
  assert.equal(git(dir, "status", "--porcelain"), "", "the developer's repository sees nothing new");
  await removeTaskWorktree(o.wt);
  assert.deepEqual([read(join(outside, "keep.txt")), read(join(dir, "node_modules", "pkg", "index.js"))], ["not Filament's\n", "module.exports = 1;\n"], "no link followed as it went");
});

// (fails before: yes — there was no clone to start anywhere)
test("a clone starts exactly at the commit asked for, whatever the folder holds: its edits, new files and deletions put back; what git ignores stays", async () => {
  setCowProbe(CLONES);
  const dir = await unity();
  const head = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "Assets", "Player.cs"), "class Player { int hp; } // the developer's, not committed\n");
  writeFileSync(join(dir, "Assets", "New.cs"), "class New {}\n");
  rmSync(join(dir, "Assets", "Enemy.cs"));
  put(join(dir, "Library", "Fresh"), "imported just now\n");
  const o = await takeTaskWorktree(dir, { id: "sa_c0000003", commit: head, base: head, kind: "clone" });
  assert.ok(o.ok, o.ok ? "" : o.error);
  const w = o.wt.workdir;
  assert.equal(o.wt.kind, "clone");
  assert.deepEqual(
    [read(join(w, "Assets", "Player.cs")), existsSync(join(w, "Assets", "New.cs")), read(join(w, "Assets", "Enemy.cs")), read(join(w, "Library", "Fresh"))],
    ["class Player {}\n", false, "class Enemy {}\n", "imported just now\n"],
  );
  assert.deepEqual([git(o.wt.dest, "rev-parse", "HEAD"), git(o.wt.dest, "status", "--porcelain")], [head, ""]);
  await removeTaskWorktree(o.wt);
});

// (fails before: yes — there was no clone; this is its race: the folder is written between its snapshot and its clone)
test("a file edited while the clone ran is put back to the commit too: the clone holds the commit, not a mix", async () => {
  const dir = await unity();
  const head = git(dir, "rev-parse", "HEAD");
  const snap = await snapshotTree(dir, { name: "clone-test", keep: false, keepIndex: true });
  assert.ok(snap.ok && snap.index, snap.error || "no index kept");
  // Written after the snapshot read the folder: what the clone takes, and the index does not know.
  writeFileSync(join(dir, "Assets", "Player.cs"), "class Player { /* saved mid-clone */ }\n");
  writeFileSync(join(dir, "Assets", "Late.cs"), "class Late {}\n");
  put(join(dir, "Library", "Late"), "imported mid-clone\n");
  const dest = join(dir, ".git", "filament-worktrees", "sa_c0000004");
  mkdirSync(join(dest, ".."), { recursive: true });
  const c = await makeClone(dir, dest, head, { index: snap.index });
  assert.ok(c.ok, c.ok ? "" : c.error);
  assert.deepEqual(
    [read(join(dest, "Assets", "Player.cs")), existsSync(join(dest, "Assets", "Late.cs")), read(join(dest, "Library", "Late"))],
    ["class Player {}\n", false, "imported mid-clone\n"],
  );
  assert.equal(git(dest, "status", "--porcelain"), "");
  assert.equal(existsSync(snap.index), false, "the snapshot's index went with its folder");
  await forgetTaskWorktree(dir, dest);
});

// (fails before: yes — there was no clone. And with the clone's stat left out of its index — the snapshot's as it was —
// a plain `git status` there ran the clean filter on every file: 5 of 5 on this machine's Git for Windows)
for (const version of [2, 4])
  test(`\`git status\` in a clone runs no clean filter — neither as Filament's calls make it nor as the builder's own git does — its index each file's stat as git records it (index version ${version})`, async () => {
    setCowProbe(CLONES);
    const dir = mkdtempSync(join(tmpdir(), "filament-cow-filter-"));
    made.push(dir);
    const log = join(dir, "..", `${dir.split(/[\\/]/).pop()}-clean.log`);
    made.push(log);
    git(dir, "init", "-q");
    git(dir, "config", "core.autocrlf", "false");
    git(dir, "config", "index.version", String(version));
    git(dir, "config", "filter.trace.clean", `echo %f >> "${log.replace(/\\/g, "/")}"; cat`);
    git(dir, "config", "filter.trace.smudge", "cat");
    writeFileSync(join(dir, ".gitattributes"), "*.txt filter=trace\n");
    writeFileSync(join(dir, ".gitignore"), "Library/\n");
    for (const p of ["a.txt", "src/b.txt", "src/c.txt", "src/deep/d.txt", "src/deep/e.txt", "z/f.txt"]) put(join(dir, p), `${p}\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    put(join(dir, "Library", "cache.txt"), "warm\n");
    await settle(dir);
    const runs = () => (existsSync(log) ? read(log).split(/\r?\n/).filter(Boolean).length : 0);
    writeFileSync(log, "");
    const o = await openTaskWorktree(dir, { id: "sa_c0000005", kind: "clone" });
    assert.ok(o.ok, o.ok ? "" : o.error);
    assert.equal(o.wt.kind, "clone");
    assert.equal(runs(), 0, "making the clone read no file again");
    assert.equal(git(o.wt.dest, "-c", "core.checkStat=minimal", "-c", "core.trustctime=false", "status", "--porcelain"), "");
    assert.equal(runs(), 0, "Filament's own git, as it calls it there");
    assert.equal(git(o.wt.dest, "status", "--porcelain"), "");
    assert.equal(runs(), 0, "the builder's own git");
    assert.equal(read(join(o.wt.dest, "Library", "cache.txt")), "warm\n");
    await removeTaskWorktree(o.wt);
  });

// (fails before: yes — there was no clone, nor a kind on a copy's record for the pool to read)
test("a clone is a copy like any other: its work captured, what git ignores never; a crash's work kept on its refs; free, it is taken by a clone alone — its caches warm, its last agent's work gone —, never by a checkout, nor a checkout by a clone", async () => {
  setCowProbe(CLONES);
  const dir = await unity();
  const a = await openTaskWorktree(dir, { id: "sa_c0000006", kind: "clone" });
  assert.ok(a.ok, a.ok ? "" : a.error);
  writeFileSync(join(a.wt.workdir, "Assets", "Boss.cs"), "class Boss {}\n");
  put(join(a.wt.workdir, "Library", "Built"), "its own import\n");
  const cap = await captureTaskWork(a.wt, { id: "sa_c0000006" });
  assert.ok(cap.ok, cap.ok ? "" : cap.error);
  assert.deepEqual(cap.files.map((f) => f.path), ["Assets/Boss.cs"], "the Library is never work");
  // A crash while it works: the restart keeps what it wrote since on its refs.
  writeFileSync(join(a.wt.workdir, "Assets", "Boss.cs"), "class Boss { int phase; }\n");
  letGoOfCopies();
  await pruneTaskWorktrees(dir);
  const refs = await taskRefs(dir, "sa_c0000006");
  assert.ok(refs);
  assert.equal(git(dir, "show", `${refs.head}:Assets/Boss.cs`), "class Boss { int phase; }");
  assert.deepEqual([copyMeta(a.wt.dest)?.state, copyMeta(a.wt.dest)?.kind], ["parked", "clone"], "parked, a clone still");
  // Free, beside a free checkout.
  const w = await openTaskWorktree(dir, { id: "sa_c0000007" });
  assert.ok(w.ok, w.ok ? "" : w.error);
  assert.deepEqual([existsSync(a.wt.dest), w.wt.kind, existsSync(join(w.wt.workdir, "Library"))], [true, "worktree", false], "a checkout asked for: not the clone");
  await releaseTaskWorktree({ ...a.wt, linked: copyMeta(a.wt.dest)?.links || [] }, "free");
  await releaseTaskWorktree(w.wt, "free");
  const c = await openTaskWorktree(dir, { id: "sa_c0000008", kind: "clone" });
  assert.ok(c.ok, c.ok ? "" : c.error);
  assert.deepEqual([existsSync(a.wt.dest), existsSync(w.wt.dest), c.wt.kind, copyMeta(c.wt.dest)?.kind], [false, true, "clone", "clone"], "the free clone moved to it");
  assert.deepEqual(
    [read(join(c.wt.workdir, "Library", "Built")), existsSync(join(c.wt.workdir, "Assets", "Boss.cs")), git(c.wt.dest, "status", "--porcelain")],
    ["its own import\n", false, ""],
    "its caches warm, its last agent's work gone",
  );
  const w2 = await openTaskWorktree(dir, { id: "sa_c0000009" });
  assert.ok(w2.ok, w2.ok ? "" : w2.error);
  assert.deepEqual([existsSync(w.wt.dest), w2.wt.kind], [false, "worktree"], "the free checkout is a checkout's");
  for (const x of [c.wt, w2.wt]) await removeTaskWorktree(x);
  assert.equal(read(join(dir, "node_modules", "pkg", "index.js")), "module.exports = 1;\n", "no link followed");
});

/** What an LFS file holds, and the pointer git keeps of it (helpers/fake-lfs.js). */
const CONTENT = "the real asset, kept by Git LFS\n".repeat(4);
const POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:[0-9a-f]{64}\nsize \d+\n$/;

// (fails before: yes — the clone's put-back ran Git LFS's smudge: a file the developer had changed came back fetched
// whole, git-lfs downloading it; and a clone that held the folder's content whole said it held pointers)
test("a builder's clone runs no Git LFS smudge: an LFS file the put-back writes is its pointer, one the folder holds whole comes cloned whole; whether it holds pointers is what its disk holds", async () => {
  setCowProbe(CLONES);
  const dir = mkdtempSync(join(tmpdir(), "filament-cow-lfs-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  const lfs = fakeLfs(made);
  useFakeLfs(dir, lfs);
  writeFileSync(join(dir, ".gitattributes"), "*.bin filter=lfs -text\n");
  writeFileSync(join(dir, ".gitignore"), "Library/\n");
  writeFileSync(join(dir, "asset.bin"), CONTENT);
  writeFileSync(join(dir, "art.bin"), "the art, as committed\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  const head = git(dir, "rev-parse", "HEAD");
  put(join(dir, "Library", "ArtifactDB"), "warm\n");
  await settle(dir);
  // Whole in the folder, as git-lfs's own checkout leaves them: cloned whole, at no cost, and no pointer said.
  const whole = await openTaskWorktree(dir, { id: "sa_c0000010", kind: "clone" });
  assert.ok(whole.ok, whole.ok ? "" : whole.error);
  assert.equal(whole.wt.kind, "clone");
  assert.deepEqual([read(join(whole.wt.dest, "asset.bin")), whole.wt.lfs, whole.wt.pointers], [CONTENT, "pointers", false], "it holds the content, and says so");
  assert.equal(git(whole.wt.dest, "status", "--porcelain"), "");
  await removeTaskWorktree(whole.wt);
  // The developer changed one since the commit the copy starts at: the put-back writes the commit's as its pointer.
  writeFileSync(join(dir, "art.bin"), "the art, redrawn and not committed\n");
  await settle(dir);
  lfs.forget();
  const o = await takeTaskWorktree(dir, { id: "sa_c0000011", commit: head, base: head, kind: "clone", lfs: "pointers" });
  assert.ok(o.ok, o.ok ? "" : o.error);
  assert.equal(o.wt.kind, "clone");
  assert.deepEqual(lfs.smudged(), [], "nothing was smudged, nothing fetched");
  assert.match(read(join(o.wt.dest, "art.bin")), POINTER, "the commit's, as its pointer");
  assert.deepEqual([read(join(o.wt.dest, "asset.bin")), o.wt.pointers], [CONTENT, true], "the folder's whole one cloned whole; a pointer among them, said");
  assert.equal(git(o.wt.dest, "status", "--porcelain"), "");
  await removeTaskWorktree(o.wt);
});
