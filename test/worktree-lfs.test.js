// @ts-check
// Phase 0 of the owner's 11-09 plan for big repos: a builder's copy is checked out with Git LFS's files as their
// pointers — a Unity-style repository's 20 GB of LFS content downloaded and written into every copy took minutes and
// gigabytes each —, while a check's copy and a command task's lane, whose commands read files Filament cannot see, get
// the content. The loop's read fetches a pointer it opens in a builder's copy; a pointer the builder left alone, or one
// fetched, is never its change. Against real repositories, with a stand-in for git-lfs in each one's own config
// (helpers/fake-lfs.js).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyTaskWork, captureTaskWork, fetchLfsFile, openCheckTree, openTaskWorktree, releaseTaskWorktree, resetLane, reviveTaskWorktree,
} from "../src/adapters/git/worktree.js";
import { runHand } from "../src/adapters/tools/hands.js";
import { copyMeta } from "./helpers/copies.js";
import { fakeLfs, pointerOf, useFakeLfs } from "./helpers/fake-lfs.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** What the LFS file holds: text, so the read hand shows it. */
const CONTENT = "the real asset, kept by Git LFS\n".repeat(4);
const POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:[0-9a-f]{64}\nsize \d+\n$/;

/** A repository whose `*.bin` Git LFS keeps (the stand-in), `asset.bin` committed through it. */
const lfsRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-lfs-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  const lfs = fakeLfs(made);
  useFakeLfs(dir, lfs);
  writeFileSync(join(dir, ".gitattributes"), "*.bin filter=lfs -text\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "asset.bin"), CONTENT);
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  lfs.forget();
  return { dir, lfs };
};

test("the stand-in is Git LFS to git: the commit holds asset.bin's pointer, the folder its content", () => {
  const { dir } = lfsRepo();
  assert.match(git(dir, "cat-file", "blob", "HEAD:asset.bin") + "\n", POINTER);
  assert.equal(read(join(dir, "asset.bin")), CONTENT);
  assert.equal(git(dir, "status", "--porcelain"), "");
});

// (fails before: yes — every copy smudged: a builder's checked out the LFS content whole, as the developer's folder has it)
test("a builder's copy holds Git LFS files as their pointers, its record says so; a check's copy holds their content; the repository's config is never changed", async () => {
  const { dir, lfs } = lfsRepo();
  const config = git(dir, "config", "--local", "--list");
  const o = await openTaskWorktree(dir, { id: "sa_lfs1" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  assert.match(read(join(o.wt.dest, "asset.bin")), POINTER, "the builder's copy holds the pointer");
  assert.equal(read(join(o.wt.dest, "a.txt")), "one\n");
  assert.deepEqual(lfs.smudged(), [], "nothing was smudged for it");
  assert.equal(copyMeta(o.wt.dest)?.lfs, "pointers");
  assert.deepEqual([o.wt.lfs, o.wt.pointers], ["pointers", true]);
  assert.equal(git(o.wt.dest, "status", "--porcelain"), "", "git sees the pointer as the commit's file");
  const c = await openCheckTree(dir, { id: "chk1", commit: o.wt.base });
  assert.ok(c.ok, !c.ok ? c.error : "");
  assert.equal(read(join(c.wt.dest, "asset.bin")), CONTENT, "a check's copy holds the content");
  assert.equal(copyMeta(c.wt.dest)?.lfs, "whole");
  assert.deepEqual([c.wt.lfs, c.wt.pointers], ["whole", false]);
  assert.equal(git(dir, "config", "--local", "--list"), config, "the repository's own config is as it was");
  await releaseTaskWorktree(c.wt, "free");
  await releaseTaskWorktree(o.wt, "parked");
});

// (fails before: yes — a pooled copy was taken as it stood: a check took a builder's pointers)
test("a check that takes a builder's copy from the pool gets the LFS content; a builder's own copy at its next question keeps pointers", async () => {
  const { dir, lfs } = lfsRepo();
  const o = await openTaskWorktree(dir, { id: "sa_lfs2" });
  assert.ok(o.ok);
  const base = o.wt.base;
  const dest = o.wt.dest;
  await releaseTaskWorktree(o.wt, "parked");
  const again = await reviveTaskWorktree(dir, { id: "sa_lfs2", base, head: base });
  assert.ok(again.ok, !again.ok ? again.error : "");
  assert.match(read(join(dest, "asset.bin")), POINTER, "its next question's reset leaves the pointer");
  assert.deepEqual(lfs.smudged(), []);
  await releaseTaskWorktree(again.wt, "free");
  const c = await openCheckTree(dir, { id: "chk2", commit: base });
  assert.ok(c.ok, !c.ok ? c.error : "");
  assert.equal(existsSync(dest), false, "the check took the builder's free copy");
  assert.equal(read(join(c.wt.dest, "asset.bin")), CONTENT, "and holds the content");
  assert.equal(copyMeta(c.wt.dest)?.lfs, "whole");
  assert.equal(git(c.wt.dest, "status", "--porcelain"), "", "the content is the commit's file to git");
  // A command task's lane goes back to its snapshot with the content too.
  writeFileSync(join(c.wt.dest, "asset.bin"), "scribbled\n");
  assert.deepEqual(await resetLane(c.wt, base), { ok: true });
  assert.equal(read(join(c.wt.dest, "asset.bin")), CONTENT);
  await releaseTaskWorktree(c.wt, "free");
});

// (fails before: yes — fetchLfsFile did not exist, and a builder read the pointer's three lines as the file)
test("a builder's copy left alone captures no change and applies nothing; a pointer its read fetched is no change either", async () => {
  const { dir, lfs } = lfsRepo();
  const o = await openTaskWorktree(dir, { id: "sa_lfs3" });
  assert.ok(o.ok);
  const id = "sa_lfs3";
  const cap = await captureTaskWork(o.wt, { id });
  assert.ok(cap.ok, !cap.ok ? cap.error : "");
  assert.deepEqual(cap.files, [], "the pointer is no change");
  const applied = await applyTaskWork(dir, { base: o.wt.base, head: cap.head });
  assert.ok(applied.ok, !applied.ok ? JSON.stringify(applied.conflicts) : "");
  assert.deepEqual([applied.files, applied.came], [[], []], "nothing to apply");
  assert.equal(read(join(dir, "asset.bin")), CONTENT, "the developer's file is as it was");
  assert.equal(git(dir, "status", "--porcelain"), "");
  // The loop's read fetches the file it opens: the content in the copy, one smudge, and still no change.
  const fetchLfs = (/** @type {string} */ abs) => fetchLfsFile(o.wt.dest, abs);
  const text = String(await runHand("read", { path: "asset.bin" }, { root: o.wt.workdir, fetchLfs }));
  assert.match(text, /^\s+1\tthe real asset, kept by Git LFS$/m, "the read shows the content");
  assert.doesNotMatch(text, /git-lfs\.github\.com/);
  assert.equal(read(join(o.wt.dest, "asset.bin")), CONTENT, "the content is in the copy, for its commands too");
  assert.deepEqual(lfs.smudged(), ["smudge asset.bin skip=0"], "one file was fetched, with smudging on");
  assert.equal(git(o.wt.dest, "status", "--porcelain"), "", "git reads the fetched file as the commit's");
  const after = await captureTaskWork(o.wt, { id, previous: cap.head });
  assert.ok(after.ok, !after.ok ? after.error : "");
  assert.deepEqual(after.files, [], "the fetched file is no change");
  // A file the builder changes is its change, as LFS stores it: a new pointer.
  writeFileSync(join(o.wt.dest, "asset.bin"), "changed by the builder\n");
  const changed = await captureTaskWork(o.wt, { id, previous: after.head });
  assert.ok(changed.ok);
  assert.deepEqual(changed.files.map((f) => f.path), ["asset.bin"]);
  assert.match(git(dir, "cat-file", "blob", `${changed.head}:asset.bin`) + "\n", POINTER);
  await releaseTaskWorktree(o.wt, "parked");
});

// (fails before: yes — fetchLfsFile did not exist: the read showed the pointer as the file)
test("with no LFS filter on the machine, the folder and the copy hold pointers, and the read says the file is an LFS pointer Filament could not fetch, and why", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-lfs-none-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  // No lfs filter here, whatever the user's global config says: as a clone made where git-lfs is not installed.
  git(dir, "config", "--local", "filter.lfs.process", "");
  git(dir, "config", "--local", "filter.lfs.required", "false");
  writeFileSync(join(dir, ".gitattributes"), "*.bin filter=lfs -text\n");
  writeFileSync(join(dir, "asset.bin"), pointerOf("c".repeat(64), 40));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  const o = await openTaskWorktree(dir, { id: "sa_lfs4" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  assert.match(read(join(o.wt.dest, "asset.bin")), POINTER);
  assert.equal(o.wt.pointers, true, "its builder is told");
  const fetchLfs = (/** @type {string} */ abs) => fetchLfsFile(o.wt.dest, abs);
  await assert.rejects(
    async () => runHand("read", { path: "asset.bin" }, { root: o.wt.workdir, fetchLfs }),
    (/** @type {any} */ e) => {
      assert.equal(e.message, `asset.bin is a Git LFS pointer, and Filament could not fetch the file it stands for (no LFS filter smudged it: git-lfs is not installed here, or not set up for this repository (git lfs install)). Its pointer reads:\n${pointerOf("c".repeat(64), 40)}`);
      return true;
    },
  );
  assert.match(read(join(o.wt.dest, "asset.bin")), POINTER, "the pointer stays as it was");
  const cap = await captureTaskWork(o.wt, { id: "sa_lfs4" });
  assert.ok(cap.ok, !cap.ok ? cap.error : "");
  assert.deepEqual(cap.files, []);
  await releaseTaskWorktree(o.wt, "parked");
});

// (fails before: yes — the lfs filter, required, smudged each copy's checkout: one whose git-lfs is gone failed whole)
test("where the repository's lfs filter names a git-lfs the machine does not have, a builder's copy is still checked out with pointers, and the read says git's words", async () => {
  const { dir } = lfsRepo();
  // The folder's index read while the filter ran, its files older than it: git does not read them again.
  const past = new Date(Date.now() - 3600_000);
  for (const f of ["asset.bin", "a.txt", ".gitattributes", ".gitignore"]) utimesSync(join(dir, f), past, past);
  git(dir, "update-index", "--refresh");
  git(dir, "config", "--local", "filter.lfs.process", "no-such-git-lfs filter-process");
  const o = await openTaskWorktree(dir, { id: "sa_lfs6" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  assert.match(read(join(o.wt.dest, "asset.bin")), POINTER);
  const fetchLfs = (/** @type {string} */ abs) => fetchLfsFile(o.wt.dest, abs);
  await assert.rejects(async () => runHand("read", { path: "asset.bin" }, { root: o.wt.workdir, fetchLfs }), /^Error: asset\.bin is a Git LFS pointer, and Filament could not fetch the file it stands for \(.*no-such-git-lfs.*\)\. Its pointer reads:\nversion https:\/\/git-lfs\.github\.com\/spec\/v1\n/);
  assert.match(read(join(o.wt.dest, "asset.bin")), POINTER, "the pointer stays as it was");
  await releaseTaskWorktree(o.wt, "parked");
});

test("a pointer to a file past the read's cap is refused before anything is fetched; a pointer git keeps as a plain file reads as it is; with no fetchLfs, a pointer reads as text", async () => {
  const { dir, lfs } = lfsRepo();
  writeFileSync(join(dir, "huge.bin"), pointerOf("a".repeat(64), 20 * 1024 * 1024));
  writeFileSync(join(dir, "notes.txt"), pointerOf("b".repeat(64), 12));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "more");
  const o = await openTaskWorktree(dir, { id: "sa_lfs5" });
  assert.ok(o.ok);
  const fetchLfs = (/** @type {string} */ abs) => fetchLfsFile(o.wt.dest, abs);
  await assert.rejects(async () => runHand("read", { path: "huge.bin" }, { root: o.wt.workdir, fetchLfs }), /^Error: huge\.bin is a Git LFS pointer to a file of 20 MB, over the read tool's 10 MB cap: Filament did not fetch it\. To have it in the copy, run git lfs pull --include "huge\.bin" with the bash tool/);
  assert.deepEqual(lfs.smudged(), [], "nothing was fetched");
  const notes = String(await runHand("read", { path: "notes.txt" }, { root: o.wt.workdir, fetchLfs }));
  assert.match(notes, /^\s+1\tversion https:\/\/git-lfs\.github\.com\/spec\/v1$/m, "not an LFS file to git: read as the text it is");
  const plain = String(await runHand("read", { path: "asset.bin" }, { root: o.wt.workdir }));
  assert.match(plain, /^\s+1\tversion https:\/\/git-lfs\.github\.com\/spec\/v1$/m, "a read with no fetchLfs is as it was");
  await releaseTaskWorktree(o.wt, "parked");
});
