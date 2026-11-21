// @ts-check
// A builder's patch workspace (the owner's plan of 11-09 for big repos, Phase 1), the review of d65a984a9: a move to a
// worktree that fails, or a crash cuts, puts the overlay back where it was — what the failed taking left at its place
// goes —, and a move of it set aside is put right by the next move, its exchange's capture or the start's reconcile;
// files Git LFS keeps are copied up as their pointers, as a builder's worktree holds them, and a read fetches one as a
// worktree's read does, refusing one past its cap before anything is fetched; a move checks them out as pointers and
// keeps what the overlay fetched; a move waits for the copy-ups under way. Against real repositories, with a stand-in for
// git-lfs in each one's own config (helpers/fake-lfs.js).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTaskWorktree, releaseTaskWorktree } from "../src/adapters/git/worktree.js";
import { capturePatch, keepOrphanPatches, openPatch, parkPatch, patchRecordOf, promotePatch } from "../src/adapters/git/patch.js";
import { patchHand } from "../src/adapters/tools/patch-hands.js";
import { runHand } from "../src/adapters/tools/hands.js";
import { fakeLfs, pointerOf, useFakeLfs } from "./helpers/fake-lfs.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
after(async () => {
  for (const d of made.reverse()) await rm(d, { recursive: true, force: true }).catch(() => {});
});
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** A project: a.txt, an ignored build folder. */
const repo = () => {
  const dir = join(realpathSync.native(mkdtempSync(join(tmpdir(), "filament-patch-moves-"))), "proj");
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, ".gitignore"), "build/\n");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** Where a repository keeps its copies, and the patches' records beside them. @param {string} dir */
const homeOf = (dir) => join(dir, ".git", "filament-worktrees");
/** A hold over a workspace that never moves. @param {any} ws */
const holdOf = (ws) => ({ now: () => ws, settled: async () => {}, move: async () => ({ ok: /** @type {const} */ (false), error: "not in this test" }) });
/** A patch with an edit and what git ignores. @param {string} dir @param {string} id */
const worked = async (dir, id) => {
  const o = await openPatch(dir, { id });
  assert.ok(o.ok, o.ok ? "" : o.error);
  const hands = (/** @type {string} */ name, /** @type {any} */ input) => patchHand(name, input, holdOf(o.wt), { root: o.wt.workdir, fenced: true });
  await hands("edit", { path: "a.txt", edits: [{ oldText: "two", newText: "TWO" }] });
  await hands("write", { path: "build/out.log", content: "built\n" });
  return o.wt;
};
/** The names of the copies' home that a move sets aside. @param {string} dir */
const asides = (dir) => readdirSync(homeOf(dir)).filter((n) => n.endsWith(".moving"));

// (fails before: yes — the taking's leftover at its place kept the overlay from going back: it stayed set aside, and the
// workspace named the leftover)
test("a move whose taking fails after leaving a folder at its place puts the overlay back over it: the leftover goes", async () => {
  const dir = repo();
  const id = "sa_0000b001";
  const ws = await worked(dir, id);
  // A taking that fails once it made something at the copy's place, as a checkout cut halfway leaves one.
  const r = await promotePatch(ws, dir, {
    id,
    allowed: (p) => {
      mkdirSync(join(p, "half"), { recursive: true });
      writeFileSync(join(p, "half", "x"), "");
      return false;
    },
  });
  assert.equal(r.ok, false);
  assert.deepEqual([read(join(ws.dest, "a.txt")), read(join(ws.dest, "build", "out.log")), existsSync(join(ws.dest, "half"))], ["one\nTWO\n", "built\n", false], "its overlay where it was, the leftover gone");
  assert.deepEqual(asides(dir), [], "nothing set aside left");
  assert.equal(patchRecordOf(homeOf(dir), id)?.state, "busy", "still its patch, at work");
  const again = await promotePatch(ws, dir, { id });
  assert.ok(again.ok, again.ok ? "" : again.error);
  assert.deepEqual([existsSync(join(ws.dest, ".git")), read(join(ws.dest, "a.txt"))], [true, "one\nTWO\n"], "the next move makes it");
});

// (fails before: yes — a move set aside was refused: "a move of it a crash cut is left at …", every move after it too)
test("a move set aside, a leftover at its place, is put right by the next move: the overlay back, then moved", async () => {
  const dir = repo();
  const id = "sa_0000b002";
  const ws = await worked(dir, id);
  renameSync(ws.dest, join(homeOf(dir), `.patch-${id}.moving`));
  mkdirSync(join(ws.dest, "half"), { recursive: true });
  const r = await promotePatch(ws, dir, { id });
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual([existsSync(join(ws.dest, ".git")), read(join(ws.dest, "a.txt")), read(join(ws.dest, "build", "out.log")), existsSync(join(ws.dest, "half"))], [true, "one\nTWO\n", "built\n", false]);
  assert.deepEqual(asides(dir), []);
});

// (fails before: yes — its exchange's capture read the leftover, and wrote a commit without its work over its refs)
test("its exchange's capture, a move set aside, puts the overlay back first and captures it", async () => {
  const dir = repo();
  const id = "sa_0000b003";
  const ws = await worked(dir, id);
  renameSync(ws.dest, join(homeOf(dir), `.patch-${id}.moving`));
  mkdirSync(join(ws.dest, "half"), { recursive: true });
  const cap = await capturePatch(ws, { id });
  assert.ok(cap.ok, cap.ok ? "" : cap.error);
  assert.deepEqual(cap.ok && cap.files.map((f) => f.path), ["a.txt"]);
  assert.equal(git(dir, "show", `refs/filament/subagents/${id}/work:a.txt`), "one\nTWO");
  assert.deepEqual(asides(dir), []);
});

// (fails before: yes — the start's reconcile kept the leftover on its refs, over the work the move had captured, and left
// the overlay set aside for good)
test("the start's reconcile of a move a crash cut before its copy was made: the leftover goes, the overlay comes back and is kept", async () => {
  const dir = repo();
  const id = "sa_0000b004";
  const ws = await worked(dir, id);
  const cap = await capturePatch(ws, { id });
  assert.ok(cap.ok);
  parkPatch(ws);
  // Filament went in the middle of a move: busy, the overlay set aside, what the taking made at its place.
  const recFile = join(homeOf(dir), ".patches", `${id}.json`);
  writeFileSync(recFile, JSON.stringify({ ...JSON.parse(read(recFile)), owner: "a-gone-filament", state: "busy" }));
  renameSync(ws.dest, join(homeOf(dir), `.patch-${id}.moving`));
  mkdirSync(join(ws.dest, "half"), { recursive: true });
  writeFileSync(join(ws.dest, "half", "x"), "");
  await keepOrphanPatches(dir, homeOf(dir), new Set());
  assert.deepEqual([read(join(ws.dest, "a.txt")), existsSync(join(ws.dest, "half"))], ["one\nTWO\n", false], "the overlay where it was");
  assert.deepEqual(asides(dir), []);
  assert.equal(patchRecordOf(homeOf(dir), id)?.state, "parked");
  assert.equal(git(dir, "show", `refs/filament/subagents/${id}/work:a.txt`), "one\nTWO", "its refs keep its work");
});

/** What the LFS file holds: text, so the read hand shows it. */
const CONTENT = "the real asset, kept by Git LFS\n".repeat(4);
const POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:[0-9a-f]{64}\nsize \d+\n$/;
/** A repository whose `*.bin` Git LFS keeps (the stand-in): asset.bin, other.bin, and huge.bin's pointer to 20 MB it never had. */
const lfsRepo = () => {
  const dir = join(realpathSync.native(mkdtempSync(join(tmpdir(), "filament-patch-lfs-"))), "proj");
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  const lfs = fakeLfs(made);
  useFakeLfs(dir, lfs);
  writeFileSync(join(dir, ".gitattributes"), "*.bin filter=lfs -text\n");
  writeFileSync(join(dir, "asset.bin"), CONTENT);
  writeFileSync(join(dir, "other.bin"), "another asset\n");
  writeFileSync(join(dir, "huge.bin"), pointerOf("a".repeat(64), 20 * 1024 * 1024));
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  lfs.forget();
  return { dir, lfs };
};

// (fails before: yes — copy-up read the pointer's size from the commit, under any cap, and smudged the object whole:
// here git's smudge failed and the read said so in git's words; with the object there, gigabytes went through memory)
test("a patch's read of an LFS file past the read's cap is refused in a worktree's words, before anything is fetched; one under it reads as a worktree's read fetches it", async () => {
  const { dir, lfs } = lfsRepo();
  const o = await openPatch(dir, { id: "sa_0000b010" });
  assert.ok(o.ok, o.ok ? "" : o.error);
  if (!o.ok) return;
  const hands = (/** @type {string} */ name, /** @type {any} */ input) => patchHand(name, input, holdOf(o.wt), { root: o.wt.workdir, fenced: true });
  const worktree = await openTaskWorktree(dir, { id: "sa_0000b011" });
  assert.ok(worktree.ok, worktree.ok ? "" : worktree.error);
  if (!worktree.ok) return;
  /** @type {string[]} */
  const said = [];
  for (const read of [() => hands("read", { path: "huge.bin" }), () => runHand("read", { path: "huge.bin" }, { root: worktree.wt.workdir, fetchLfs: async () => ({ ok: false, lfs: false, error: "" }) })])
    await assert.rejects(read, (/** @type {any} */ e) => (said.push(e.message), true));
  assert.equal(said[0], said[1], "the patch's words are the worktree's");
  assert.match(said[0], /^huge\.bin is a Git LFS pointer to a file of 20 MB, over the read tool's 10 MB cap: Filament did not fetch it\./);
  assert.deepEqual(lfs.smudged(), [], "nothing was fetched");
  const text = String(await hands("read", { path: "asset.bin" }));
  assert.match(text, /^\s+1\tthe real asset, kept by Git LFS$/m, "the read shows the content");
  assert.equal(read(join(o.wt.dest, "asset.bin")), CONTENT);
  const cap = await capturePatch(o.wt, { id: "sa_0000b010" });
  assert.deepEqual(cap.ok && cap.files, [], "a file fetched is no change");
  await releaseTaskWorktree(worktree.wt, "free");
});

// (fails before: yes — the copy-up smudged, and with the git-lfs it names not here the read said git's failure alone; a
// pointer copied up as it is must not fail its capture either, whose filters never run on what it never changed)
test("where the repository's lfs filter names a git-lfs the machine does not have, a patch's read says so as a worktree's does, and its capture holds no change", async () => {
  const { dir } = lfsRepo();
  // The folder's index read while the filter ran, its files older than it: git does not read them again.
  const past = new Date(Date.now() - 3600_000);
  for (const f of ["asset.bin", "other.bin", "huge.bin", "a.txt", ".gitattributes"]) utimesSync(join(dir, f), past, past);
  git(dir, "update-index", "--refresh");
  git(dir, "config", "--local", "filter.lfs.process", "no-such-git-lfs filter-process");
  const id = "sa_0000b015";
  const o = await openPatch(dir, { id });
  assert.ok(o.ok, o.ok ? "" : o.error);
  if (!o.ok) return;
  await assert.rejects(
    async () => patchHand("read", { path: "asset.bin" }, holdOf(o.wt), { root: o.wt.workdir, fenced: true }),
    /^Error: asset\.bin is a Git LFS pointer, and Filament could not fetch the file it stands for \(.*no-such-git-lfs.*\)\. Its pointer reads:\nversion https:\/\/git-lfs\.github\.com\/spec\/v1\n/,
  );
  assert.match(read(join(o.wt.dest, "asset.bin")), POINTER, "the pointer stays as it was");
  const cap = await capturePatch(o.wt, { id });
  assert.ok(cap.ok, cap.ok ? "" : cap.error);
  assert.deepEqual(cap.files, []);
});

// (fails before: yes — a search copied up every LFS file that may match by checking it out whole, its smudges unchecked)
test("a patch's search copies LFS files up as their pointers, never smudged, and answers as a worktree that holds pointers", async () => {
  const { dir, lfs } = lfsRepo();
  const o = await openPatch(dir, { id: "sa_0000b012" });
  assert.ok(o.ok, o.ok ? "" : o.error);
  if (!o.ok) return;
  const worktree = await openTaskWorktree(dir, { id: "sa_0000b013" });
  assert.ok(worktree.ok, worktree.ok ? "" : worktree.error);
  if (!worktree.ok) return;
  // Its .gitattributes in the overlay, as a read of it leaves it: a checkout of the files that may match reads it.
  await patchHand("read", { path: ".gitattributes" }, holdOf(o.wt), { root: o.wt.workdir, fenced: true });
  lfs.forget();
  const input = { pattern: "^size ", path: "." };
  const inPatch = String(await patchHand("grep", input, holdOf(o.wt), { root: o.wt.workdir, fenced: true }));
  assert.deepEqual(lfs.smudged(), [], "nothing was smudged");
  assert.equal(inPatch, String(await runHand("grep", input, { root: worktree.wt.workdir, fenced: true })));
  assert.match(inPatch, /huge\.bin/);
  assert.match(read(join(o.wt.dest, "asset.bin")), POINTER, "its pointer, as a worktree holds it");
  await releaseTaskWorktree(worktree.wt, "free");
});

// (fails before: yes — the move checked every LFS file out whole, as a check's copy: another.bin smudged, and where an
// object was not here the checkout failed, so no command could ever run)
test("a move checks LFS files out as their pointers, as a builder's worktree holds them, and keeps the content the overlay fetched", async () => {
  const { dir, lfs } = lfsRepo();
  const id = "sa_0000b014";
  const o = await openPatch(dir, { id });
  assert.ok(o.ok, o.ok ? "" : o.error);
  if (!o.ok) return;
  await patchHand("read", { path: "asset.bin" }, holdOf(o.wt), { root: o.wt.workdir, fenced: true });
  lfs.forget();
  const r = await promotePatch(o.wt, dir, { id });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.deepEqual([r.wt.lfs, r.wt.pointers], ["pointers", true]);
  assert.equal(read(join(o.wt.dest, "asset.bin")), CONTENT, "what the overlay fetched");
  assert.match(read(join(o.wt.dest, "other.bin")), POINTER, "the rest as pointers");
  assert.deepEqual(lfs.smudged(), [], "nothing was smudged");
  assert.equal(git(o.wt.dest, "status", "--porcelain"), "", "the fetched file is no change");
});

// (fails before: yes — the move did not wait for a read under way: it renamed the overlay aside as the read copied a file
// up into it)
test("a move waits for the copy-ups under way, and the read under it answers from the overlay", async () => {
  const dir = repo();
  // slow.txt's smudge takes a while, once: the read's copy-up of it is under way as the move is asked.
  const once = join(dir, "..", "slow-once");
  const filter = join(dir, "..", "slow.cjs");
  writeFileSync(filter, `const fs = require("fs"); const once = ${JSON.stringify(once)}; const slow = fs.existsSync(once); if (slow) fs.rmSync(once); setTimeout(() => process.stdin.pipe(process.stdout), slow ? 1500 : 0);`);
  git(dir, "config", "--local", "filter.slow.smudge", `"${process.execPath.replace(/\\/g, "/")}" "${filter.replace(/\\/g, "/")}"`);
  git(dir, "config", "--local", "filter.slow.clean", "cat");
  writeFileSync(join(dir, ".gitattributes"), "slow.txt filter=slow\n");
  writeFileSync(join(dir, "slow.txt"), "slowly\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "slow");
  const id = "sa_0000b020";
  const o = await openPatch(dir, { id });
  assert.ok(o.ok, o.ok ? "" : o.error);
  if (!o.ok) return;
  /** @type {any} */
  let current = o.wt;
  /** @type {Promise<any> | null} */
  let moving = null;
  const hold = {
    now: () => current,
    settled: async () => void (await moving),
    move: (/** @type {string} */ _why) =>
      (moving = promotePatch(o.wt, dir, { id }).then((r) => {
        if (r.ok) current = null;
        return r.ok ? { ok: /** @type {const} */ (true), said: null } : r;
      })),
  };
  writeFileSync(once, "");
  const reading = patchHand("read", { path: "slow.txt" }, hold, { root: o.wt.workdir, fenced: true });
  await new Promise((r) => setTimeout(r, 200));
  const moved = hold.move("command");
  const text = String(await reading);
  const checkoutAtRead = existsSync(join(o.wt.dest, ".git"));
  const m = await moved;
  assert.match(text, /^\s+1\tslowly$/m);
  assert.equal(checkoutAtRead, false, "no checkout before the read was answered");
  assert.equal(m.ok, true, m.ok ? "" : m.error);
  assert.deepEqual([existsSync(join(o.wt.dest, ".git")), read(join(o.wt.dest, "slow.txt"))], [true, "slowly\n"]);
  assert.deepEqual(asides(dir), []);
});

// (fails before: yes — where its commit keeps the submodule (its folder there, as a checkout leaves one), the listing
// said "sub is a file, not a folder"; a worktree checks it out as an empty folder)
test("a patch's listing of a submodule's folder answers as a worktree's: no files there, never 'a file'", async () => {
  const dir = repo();
  git(dir, "update-index", "--add", "--cacheinfo", `160000,${git(dir, "rev-parse", "HEAD")},sub`);
  git(dir, "commit", "-qm", "a submodule");
  mkdirSync(join(dir, "sub"));
  const o = await openPatch(dir, { id: "sa_0000b030" });
  assert.ok(o.ok, o.ok ? "" : o.error);
  if (!o.ok) return;
  const worktree = await openTaskWorktree(dir, { id: "sa_0000b031" });
  assert.ok(worktree.ok, worktree.ok ? "" : worktree.error);
  if (!worktree.ok) return;
  const input = { pattern: "*", path: "sub" };
  const inWorktree = await runHand("glob", input, { root: worktree.wt.workdir, fenced: true }).then(String, (e) => `threw: ${e.message}`);
  const inPatch = await patchHand("glob", input, holdOf(o.wt), { root: o.wt.workdir, fenced: true }).then(String, (e) => `threw: ${e.message}`);
  assert.equal(inPatch, inWorktree, `the worktree holds ${existsSync(join(worktree.wt.dest, "sub")) ? "a folder" : "nothing"} at sub`);
  await releaseTaskWorktree(worktree.wt, "free");
});

// (verified: `:(glob)**/*.js` is git's pathspec for a file at the top too)
test("a patch's search with a glob of no folder finds a file at the project's top, as a worktree's does", async () => {
  const dir = repo();
  writeFileSync(join(dir, "top.js"), "const needle = 1;\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "in.js"), "const needle = 2;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "js");
  const o = await openPatch(dir, { id: "sa_0000b032" });
  assert.ok(o.ok, o.ok ? "" : o.error);
  if (!o.ok) return;
  const said = String(await patchHand("grep", { pattern: "needle", glob: "*.js" }, holdOf(o.wt), { root: o.wt.workdir, fenced: true }));
  assert.match(said, /top\.js/);
  assert.match(said, /src[\\/]in\.js/);
});
