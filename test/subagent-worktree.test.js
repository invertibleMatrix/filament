// @ts-check
// A writing sub-agent's own worktree (HarnessV3 §15 item 88), against real repositories: the launch captures the
// working tree as it stands, the worktree is invisible to the developer's repository, dependency folders are linked,
// the work is captured, and applying merges it into the developer's folder file by file — all or nothing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyTaskWork, captureTaskWork, changedFiles, diffTaskWork, dropTaskRefs, forgetTaskWorktree, KEPT_COPIES, letGoOfCopies, makeSpareCopy, markApplied,
  openTaskWorktree, pruneTaskWorktrees, releaseTaskWorktree, removeTaskWorktree, reviveTaskWorktree, taskRefs, taskWorktreePath,
} from "../src/adapters/git/worktree.js";
import { createSubagentRegistry, SUBAGENT_NOTES } from "../src/app/agent/subagents.js";
import { copiesOf, copyMeta, copyState, copyTemps } from "./helpers/copies.js";

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
/** A repository with two committed files, node_modules ignored, and line endings as git's defaults leave them. @param {{ crlf?: boolean }} [o] */
const repo = ({ crlf = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-wt-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", crlf ? "true" : "false");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\nfour\nfive\n");
  writeFileSync(join(dir, "b.txt"), "bee\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/**
 * A program that stands in a folder until it is ended, as a coding agent's process stands in its session's: on
 * Windows nobody can remove the folder meanwhile.
 * @param {string} cwd
 */
const standIn = async (cwd) => {
  const child = spawn(process.execPath, ["-e", "console.log('in'); setInterval(() => {}, 1000)"], { cwd, stdio: ["ignore", "pipe", "ignore"] });
  await once(child.stdout, "data");
  return async () => {
    const gone = once(child, "exit");
    child.kill();
    await gone;
  };
};
const WINDOWS = process.platform === "win32";

test("the launch captures the working tree as it stands — edits, new files — into a worktree the developer's repository does not see, dependencies linked", async () => {
  const dir = repo();
  writeFileSync(join(dir, "a.txt"), "one\ntwo (edited, not committed)\nthree\nfour\nfive\n");
  writeFileSync(join(dir, "new.txt"), "untracked\n");
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  const status = git(dir, "status", "--porcelain");
  const o = await openTaskWorktree(dir, { id: "sa_00000001" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  assert.equal(wt.dest, await taskWorktreePath(dir, "sa_00000001"));
  assert.match(wt.dest.replace(/\\/g, "/"), /\/\.git\/filament-worktrees\/sa_00000001$/, "inside the git folder: no search and no status looks there");
  assert.equal(read(join(wt.workdir, "a.txt")), "one\ntwo (edited, not committed)\nthree\nfour\nfive\n", "the uncommitted edit came along");
  assert.equal(read(join(wt.workdir, "new.txt")), "untracked\n", "the untracked file came along");
  assert.equal(lstatSync(join(wt.workdir, "node_modules")).isSymbolicLink(), true, "node_modules is linked, not copied");
  assert.equal(read(join(wt.workdir, "node_modules", "pkg", "index.js")), "module.exports = 1;\n");
  assert.equal(git(dir, "status", "--porcelain"), status, "the developer's repository sees nothing new");
  assert.equal(git(dir, "rev-parse", "HEAD"), git(dir, "rev-parse", "HEAD~0"), "HEAD did not move");
  // A read-only file in it (fails before: yes, under Electron's Node — HarnessV3-Native NA1: the desktop app's runtime
  // stopped there and kept the folder; `npm run test:desktop` runs this file there — plain node takes the file).
  writeFileSync(join(wt.workdir, "locked.txt"), "x\n");
  chmodSync(join(wt.workdir, "locked.txt"), 0o444);
  const removed = await removeTaskWorktree(wt);
  assert.ok(removed.ok, !removed.ok ? removed.error : "");
  assert.equal(existsSync(wt.dest), false);
  assert.equal(read(join(dir, "node_modules", "pkg", "index.js")), "module.exports = 1;\n", "the link was unlinked, never followed");
});

test("the launch starts no fsmonitor the repository configures (fails before: yes — the worktree's checkout ran it, a command planted in .git/config)", async () => {
  const dir = repo();
  const mark = join(dir, "fsmonitor-ran");
  const hook = join(dir, "fsmonitor.sh");
  writeFileSync(hook, `#!/bin/sh\necho ran > '${mark.replaceAll("\\", "/")}'\nexit 1\n`, { mode: 0o755 });
  git(dir, "config", "core.fsmonitor", hook.replaceAll("\\", "/"));
  const o = await openTaskWorktree(dir, { id: "sa_00000009" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  assert.equal(existsSync(mark), false, "the configured fsmonitor did not run");
  await removeTaskWorktree(o.wt);
});

// (fails before: yes — HarnessV4_Worktrees_Plan W3: a crash's copy was removed, and each answer made its copy anew)
test("a copy a crash left behind is kept, parked for its agent; its dependency link is never followed — not by the clean of a fresh start at its place, nor by its removal", async () => {
  const dir = repo();
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  const orphan = await openTaskWorktree(dir, { id: "sa_0000000a" });
  assert.ok(orphan.ok);
  assert.equal(lstatSync(join(orphan.wt.workdir, "node_modules")).isSymbolicLink(), true);
  // Never given back: the process died with the copy and its link in place.
  letGoOfCopies();
  assert.equal(await pruneTaskWorktrees(dir, new Set()), 0, "nothing went");
  assert.deepEqual([existsSync(orphan.wt.dest), copyState(orphan.wt.dest)], [true, "parked"], "kept, parked for its agent");
  // A fresh start at its place: reset, cleaned of all git does not track — its link unlinked first — and linked again.
  const again = await openTaskWorktree(dir, { id: "sa_0000000a" });
  assert.ok(again.ok);
  assert.deepEqual([again.wt.dest, lstatSync(join(again.wt.workdir, "node_modules")).isSymbolicLink()], [orphan.wt.dest, true]);
  assert.equal(read(join(dir, "node_modules", "pkg", "index.js")), "module.exports = 1;\n", "the clean did not follow the link");
  await removeTaskWorktree(again.wt);
  assert.equal(existsSync(again.wt.dest), false);
  assert.equal(read(join(dir, "node_modules", "pkg", "index.js")), "module.exports = 1;\n", "nor did the removal");
});

// (fails before: yes — the owner's of 11-10: a copy of a linked worktree with no node_modules of its own linked nothing,
// silently, and every check that needed one failed in it)
test("a copy of a linked worktree with no dependency folder of its own links its main checkout's, where git ignores it; parked, taken again and removed, the link is never followed", async () => {
  const main = repo();
  mkdirSync(join(main, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(main, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  const side = mkdtempSync(join(tmpdir(), "filament-wt-side-"));
  made.push(side);
  const folder = join(side, "wt");
  git(main, "worktree", "add", "-q", "-b", "side", folder);
  const o = await openTaskWorktree(folder, { id: "sa_0000001a" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const link = join(o.wt.workdir, "node_modules");
  assert.equal(lstatSync(link).isSymbolicLink(), true, "the main checkout's node_modules is linked in");
  assert.equal(read(join(link, "pkg", "index.js")), "module.exports = 1;\n");
  assert.deepEqual(o.wt.linked, [link], "and named, for the cleanup to unlink");
  // Parked, then taken again by its agent: the link kept, and named again.
  await releaseTaskWorktree(o.wt, "parked");
  assert.deepEqual(copyMeta(o.wt.dest)?.links, [link]);
  const again = await openTaskWorktree(folder, { id: "sa_0000001a" });
  assert.ok(again.ok, !again.ok ? again.error : "");
  assert.deepEqual([again.wt.dest, again.wt.linked], [o.wt.dest, [link]]);
  await removeTaskWorktree(again.wt);
  assert.equal(existsSync(again.wt.dest), false);
  assert.equal(read(join(main, "node_modules", "pkg", "index.js")), "module.exports = 1;\n", "the link was unlinked, never followed");
  // One git does not ignore in the main checkout is no dependency folder of its: nothing is linked, and the list says so.
  const plain = repo();
  mkdirSync(join(plain, "venv"));
  writeFileSync(join(plain, "venv", "kept.txt"), "not ignored\n");
  const other = join(side, "wt2");
  git(plain, "worktree", "add", "-q", "-b", "side", other);
  const none = await openTaskWorktree(other, { id: "sa_0000001b" });
  assert.ok(none.ok, !none.ok ? none.error : "");
  assert.deepEqual([none.wt.linked, existsSync(join(none.wt.workdir, "venv"))], [[], false], "nothing linked");
  await removeTaskWorktree(none.wt);
  assert.equal(read(join(plain, "venv", "kept.txt")), "not ignored\n");
});

test("the work is captured against the base, with line counts; applying it where the developer changed nothing brings it over, the index untouched", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_00000002" });
  assert.ok(o.ok);
  const { wt } = o;
  writeFileSync(join(wt.workdir, "a.txt"), "one\ntwo\nthree\nFOUR\nfive\n");
  writeFileSync(join(wt.workdir, "c.txt"), "sea\n");
  rmSync(join(wt.workdir, "b.txt"));
  const cap = await captureTaskWork(wt, { id: "sa_00000002" });
  assert.ok(cap.ok);
  assert.deepEqual(cap.files.map((f) => [f.path, f.status, f.added, f.removed]).sort(), [["a.txt", "M", 1, 1], ["b.txt", "D", 0, 1], ["c.txt", "A", 1, 0]]);
  assert.match(await diffTaskWork(wt.repo, wt.base, cap.head), /^-four\n\+FOUR$/m);
  await removeTaskWorktree(wt);
  const refs = await taskRefs(dir, "sa_00000002");
  assert.deepEqual(refs && [refs.base, refs.head], [wt.base, cap.head], "the refs hold the work after the folder went");
  const staged = git(dir, "diff", "--cached", "--name-only");
  const ap = await applyTaskWork(dir, { base: wt.base, head: cap.head });
  assert.ok(ap.ok, !ap.ok ? JSON.stringify(ap.conflicts) : "");
  assert.equal(read(join(dir, "a.txt")), "one\ntwo\nthree\nFOUR\nfive\n");
  assert.equal(read(join(dir, "c.txt")), "sea\n");
  assert.equal(existsSync(join(dir, "b.txt")), false);
  assert.equal(git(dir, "diff", "--cached", "--name-only"), staged, "nothing staged");
  assert.ok(await markApplied(dir, "sa_00000002", cap.head));
  const moved = await taskRefs(dir, "sa_00000002");
  assert.deepEqual(await changedFiles(dir, String(moved?.base), String(moved?.head)), [], "once applied, nothing is pending");
});

test("a file both sides changed is merged three ways; overlapping changes stop the whole apply before anything is written", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_00000003" });
  assert.ok(o.ok);
  const { wt } = o;
  writeFileSync(join(wt.workdir, "a.txt"), "one\ntwo\nthree\nfour\nFIVE by the sub-agent\n");
  writeFileSync(join(wt.workdir, "c.txt"), "sea\n");
  const cap = await captureTaskWork(wt, { id: "sa_00000003" });
  assert.ok(cap.ok);
  await removeTaskWorktree(wt);
  // The developer edited the first line meanwhile: no overlap.
  writeFileSync(join(dir, "a.txt"), "ONE by the developer\ntwo\nthree\nfour\nfive\n");
  const merged = await applyTaskWork(dir, { base: wt.base, head: cap.head });
  assert.ok(merged.ok, !merged.ok ? JSON.stringify(merged.conflicts) : "");
  assert.equal(read(join(dir, "a.txt")), "ONE by the developer\ntwo\nthree\nfour\nFIVE by the sub-agent\n", "both edits kept");
  // Now an overlap on another run: nothing is written, not even the clean file.
  const dir2 = repo();
  const o2 = await openTaskWorktree(dir2, { id: "sa_00000004" });
  assert.ok(o2.ok);
  writeFileSync(join(o2.wt.workdir, "a.txt"), "one\ntwo\nTHREE (sub-agent)\nfour\nfive\n");
  writeFileSync(join(o2.wt.workdir, "c.txt"), "sea\n");
  const cap2 = await captureTaskWork(o2.wt, { id: "sa_00000004" });
  assert.ok(cap2.ok);
  await removeTaskWorktree(o2.wt);
  writeFileSync(join(dir2, "a.txt"), "one\ntwo\nthree (developer)\nfour\nfive\n");
  const refused = await applyTaskWork(dir2, { base: o2.wt.base, head: cap2.head });
  assert.equal(refused.ok, false);
  assert.deepEqual(!refused.ok && refused.conflicts.map((c) => c.path), ["a.txt"]);
  assert.match(!refused.ok ? refused.conflicts[0].why : "", /1 change overlaps yours/);
  assert.equal(read(join(dir2, "a.txt")), "one\ntwo\nthree (developer)\nfour\nfive\n", "the developer's file untouched");
  assert.equal(existsSync(join(dir2, "c.txt")), false, "all or nothing: the clean file waits too");
});

test("line endings follow the repository's rules: a CRLF checkout compares clean and is written back CRLF", async () => {
  const dir = repo({ crlf: true });
  // Re-check-out so the working tree carries CRLF, as a Windows checkout does.
  rmSync(join(dir, "a.txt"));
  git(dir, "checkout", "--", "a.txt");
  assert.match(readFileSync(join(dir, "a.txt"), "utf8"), /\r\n/);
  const o = await openTaskWorktree(dir, { id: "sa_00000005" });
  assert.ok(o.ok);
  const text = readFileSync(join(o.wt.workdir, "a.txt"), "utf8").replace("three", "THREE");
  writeFileSync(join(o.wt.workdir, "a.txt"), text);
  const cap = await captureTaskWork(o.wt, { id: "sa_00000005" });
  assert.ok(cap.ok);
  assert.deepEqual(cap.files.map((f) => [f.path, f.added, f.removed]), [["a.txt", 1, 1]], "one line changed, not every line's ending");
  await removeTaskWorktree(o.wt);
  const ap = await applyTaskWork(dir, { base: o.wt.base, head: cap.head });
  assert.ok(ap.ok, !ap.ok ? JSON.stringify(ap.conflicts) : "");
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "one\r\ntwo\r\nTHREE\r\nfour\r\nfive\r\n");
});

test("a delete against a change, and a new file where the developer made another, are conflicts in words", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_00000006" });
  assert.ok(o.ok);
  rmSync(join(o.wt.workdir, "b.txt"));
  writeFileSync(join(o.wt.workdir, "d.txt"), "from the sub-agent\n");
  const cap = await captureTaskWork(o.wt, { id: "sa_00000006" });
  assert.ok(cap.ok);
  await removeTaskWorktree(o.wt);
  writeFileSync(join(dir, "b.txt"), "bee, changed\n");
  writeFileSync(join(dir, "d.txt"), "the developer's own\n");
  const r = await applyTaskWork(dir, { base: o.wt.base, head: cap.head });
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.conflicts.map((c) => [c.path, c.why]).sort(), [["b.txt", "the sub-agent deleted it; you changed it since"], ["d.txt", "your folder has another file there"]]);
});

// (fails before: yes — the copies hunt of 10-23: a file of the developer's that git could not read was read as gone, so
// the sub-agent's delete of it was skipped and the apply said done)
test("a file of the developer's that git cannot read stops the apply in words: it is never read as gone", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_000000a1" });
  assert.ok(o.ok);
  rmSync(join(o.wt.workdir, "b.txt"));
  writeFileSync(join(o.wt.workdir, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  const cap = await captureTaskWork(o.wt, { id: "sa_000000a1" });
  assert.ok(cap.ok);
  await removeTaskWorktree(o.wt);
  // A clean filter the repository needs for b.txt, which fails: git cannot hash the developer's b.txt.
  mkdirSync(join(dir, ".git", "info"), { recursive: true });
  writeFileSync(join(dir, ".git", "info", "attributes"), "b.txt filter=broken\n");
  git(dir, "config", "filter.broken.clean", "false");
  git(dir, "config", "filter.broken.required", "true");
  const r = await applyTaskWork(dir, { base: o.wt.base, head: cap.head });
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.conflicts.map((c) => c.path), ["b.txt"]);
  assert.match(!r.ok ? r.conflicts[0].why : "", /^git could not read your version \(.+\)$/);
  assert.deepEqual([read(join(dir, "b.txt")), read(join(dir, "a.txt"))], ["bee\n", "one\ntwo\nthree\nfour\nfive\n"], "nothing written, nothing deleted");
});

// (fails before: yes — the copies hunt of 10-23: the apply wrote through a link in the developer's folder, outside it)
test("a link in the developer's folder where a file goes — at its own path, or a folder on its way that leads out — is a conflict: nothing is written through it", async () => {
  const dir = repo();
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "x.txt"), "ex\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "sub");
  const o = await openTaskWorktree(dir, { id: "sa_000000a2" });
  assert.ok(o.ok);
  writeFileSync(join(o.wt.workdir, "sub", "x.txt"), "EX, the sub-agent's\n");
  writeFileSync(join(o.wt.workdir, "b.txt"), "BEE, the sub-agent's\n");
  const cap = await captureTaskWork(o.wt, { id: "sa_000000a2" });
  assert.ok(cap.ok);
  await removeTaskWorktree(o.wt);
  // The developer's sub is a link now, to a folder outside the project that holds the same file; b.txt a link to a
  // file there, where this system lets a test make one.
  const outside = mkdtempSync(join(tmpdir(), "filament-outside-"));
  made.push(outside);
  writeFileSync(join(outside, "x.txt"), "ex\n");
  writeFileSync(join(outside, "b.txt"), "bee\n");
  rmSync(join(dir, "sub"), { recursive: true });
  symlinkSync(outside, join(dir, "sub"), "junction");
  let fileLink = true;
  rmSync(join(dir, "b.txt"));
  try {
    symlinkSync(join(outside, "b.txt"), join(dir, "b.txt"), "file");
  } catch {
    fileLink = false;
    writeFileSync(join(dir, "b.txt"), "bee\n");
  }
  try {
    const r = await applyTaskWork(dir, { base: o.wt.base, head: cap.head });
    assert.deepEqual(!r.ok && r.conflicts.map((c) => [c.path, c.why]), [
      ...(fileLink ? [["b.txt", "your folder has a link there: apply it by hand"]] : []),
      ["sub/x.txt", "a folder on its way in yours is a link out of the project: apply it by hand"],
    ]);
    assert.deepEqual([read(join(outside, "x.txt")), read(join(outside, "b.txt"))], ["ex\n", "bee\n"], "nothing written outside");
  } finally {
    // The link alone goes, never what it points to: a junction is a folder's link on Windows, a plain link elsewhere.
    if (WINDOWS) rmdirSync(join(dir, "sub"));
    else unlinkSync(join(dir, "sub"));
  }
});

test("a file the folder will not take puts back every file already written — changed, new, deleted — so a failed apply leaves the folder as it was; a folder where a new file goes is a conflict before anything is written", { skip: process.getuid?.() === 0 && "root writes read-only files" }, async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_0000000c" });
  assert.ok(o.ok);
  // In the order the apply writes them: .gitignore, a.txt and aa.txt go through before b.txt refuses.
  rmSync(join(o.wt.workdir, ".gitignore"));
  writeFileSync(join(o.wt.workdir, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  writeFileSync(join(o.wt.workdir, "aa.txt"), "new\n");
  writeFileSync(join(o.wt.workdir, "b.txt"), "BEE\n");
  const cap = await captureTaskWork(o.wt, { id: "sa_0000000c" });
  assert.ok(cap.ok);
  await removeTaskWorktree(o.wt);
  chmodSync(join(dir, "b.txt"), 0o444);
  try {
    const r = await applyTaskWork(dir, { base: o.wt.base, head: cap.head });
    assert.equal(r.ok, false);
    assert.deepEqual(!r.ok && r.conflicts.map((c) => c.path), ["b.txt"]);
    assert.match(!r.ok ? r.conflicts[0].why : "", /^your folder would not take it \((EPERM|EACCES)\)$/);
    assert.equal(!r.ok ? r.stuck : "", undefined, "every file written was put back");
    assert.equal(read(join(dir, ".gitignore")), "node_modules/\n", "the deleted file is back");
    assert.equal(read(join(dir, "a.txt")), "one\ntwo\nthree\nfour\nfive\n", "the changed file is as it was");
    assert.equal(existsSync(join(dir, "aa.txt")), false, "the new file is gone again");
    assert.equal(read(join(dir, "b.txt")), "bee\n");
  } finally {
    chmodSync(join(dir, "b.txt"), 0o644);
  }
  const dir2 = repo();
  const o2 = await openTaskWorktree(dir2, { id: "sa_0000000d" });
  assert.ok(o2.ok);
  writeFileSync(join(o2.wt.workdir, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
  writeFileSync(join(o2.wt.workdir, "d.txt"), "from the sub-agent\n");
  const cap2 = await captureTaskWork(o2.wt, { id: "sa_0000000d" });
  assert.ok(cap2.ok);
  await removeTaskWorktree(o2.wt);
  mkdirSync(join(dir2, "d.txt"));
  const r2 = await applyTaskWork(dir2, { base: o2.wt.base, head: cap2.head });
  assert.deepEqual(!r2.ok && r2.conflicts.map((c) => [c.path, c.why]), [["d.txt", "your folder has a folder there"]]);
  assert.equal(read(join(dir2, "a.txt")), "one\ntwo\nthree\nfour\nfive\n", "nothing written");
});

// (fails before: yes — Fable 5.1's read of 10-22: the prune after a restart deleted what the cut exchange had written,
// which no ref held)
test("an orphaned worktree's work is kept on its refs, its copy parked; one whose checkout a crash cut is not read as work, and goes", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_0000000c" });
  assert.ok(o.ok);
  writeFileSync(join(o.wt.workdir, "c.txt"), "written in the exchange a restart cut\n");
  writeFileSync(join(o.wt.workdir, "a.txt"), "one\n");
  letGoOfCopies();
  assert.equal(await pruneTaskWorktrees(dir, new Set()), 0);
  assert.equal(copyState(o.wt.dest), "parked");
  const refs = await taskRefs(dir, "sa_0000000c");
  assert.ok(refs && refs.head !== o.wt.base, "a work ref past the base");
  assert.deepEqual((await changedFiles(dir, o.wt.base, /** @type {any} */ (refs).head)).map((f) => [f.path, f.status]).sort(), [["a.txt", "M"], ["c.txt", "A"]]);
  const back = await reviveTaskWorktree(dir, { id: "sa_0000000c", base: o.wt.base, head: /** @type {any} */ (refs).head });
  assert.ok(back.ok);
  assert.equal(back.wt.dest, o.wt.dest, "in the copy where it stands");
  assert.equal(read(join(back.wt.workdir, "c.txt")), "written in the exchange a restart cut\n", "a follow-up after the restart starts from it");
  await removeTaskWorktree(back.wt);

  const cut = await openTaskWorktree(dir, { id: "sa_0000000d" });
  assert.ok(cut.ok);
  rmSync(join(cut.wt.workdir, "b.txt"));
  // As git leaves a worktree whose making a crash cut: its lock, "initializing".
  writeFileSync(join(git(cut.wt.dest, "rev-parse", "--absolute-git-dir"), "locked"), "initializing\n");
  letGoOfCopies();
  assert.equal(await pruneTaskWorktrees(dir, new Set()), 1);
  assert.equal((await taskRefs(dir, "sa_0000000d"))?.head, cut.wt.base, "no work read from a checkout that may be half made");
  assert.equal(git(dir, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length, 1, "and git's record of it went too, its lock with it");
});

// (fails before: yes — HarnessV4_Worktrees_Plan W1: every failure was one, so a writing agent whose copy failed in a
// repository worked in the developer's folder; the folder rule's words named no folder to add; a stop ran git on)
test("no copy, and of which kind: none outside git or before a first commit; failed where the folder rule refuses or a stop came; a checkout cut leaves no record", async () => {
  const plain = mkdtempSync(join(tmpdir(), "filament-nogit-"));
  made.push(plain);
  const a = await openTaskWorktree(plain, { id: "sa_00000011" });
  assert.deepEqual([a.ok, !a.ok && a.kind], [false, "none"]);
  const empty = mkdtempSync(join(tmpdir(), "filament-nocommit-"));
  made.push(empty);
  git(empty, "init", "-q");
  const b = await openTaskWorktree(empty, { id: "sa_00000012" });
  assert.deepEqual([!b.ok && b.kind, !b.ok && b.error], ["none", "the repository has no commit yet"]);
  const dir = repo();
  const c = await openTaskWorktree(dir, { id: "sa_00000013", allowed: () => false });
  assert.equal(!c.ok && c.kind, "failed");
  assert.match(!c.ok ? c.error : "", /^its copy would sit in .*filament-worktrees, outside the folders the agent may work in \(agentLoop\.roots\): add that folder there \(Settings › Agent loop\), or launch it read only$/);
  const stop = new AbortController();
  stop.abort();
  const d = await openTaskWorktree(dir, { id: "sa_00000014", signal: stop.signal });
  assert.deepEqual([!d.ok && d.kind, !d.ok && d.error, existsSync(String(await taskWorktreePath(dir, "sa_00000014")))], ["failed", "it was stopped while its copy was made", false]);
  // (fails before: yes — the copies hunt of 10-23) A follow-up's copy stops with its exchange too: never moved, nor reset.
  const head = git(dir, "rev-parse", "HEAD");
  const e = await reviveTaskWorktree(dir, { id: "sa_000000a3", base: head, head, signal: stop.signal });
  assert.deepEqual([e.ok, !e.ok && e.error, existsSync(String(await taskWorktreePath(dir, "sa_000000a3")))], [false, "it was stopped while its copy was made", false]);
  // As a crash leaves a checkout: git's lock on its record, which no prune takes.
  const o = await openTaskWorktree(dir, { id: "sa_00000015" });
  assert.ok(o.ok);
  const record = git(o.wt.dest, "rev-parse", "--absolute-git-dir");
  writeFileSync(join(record, "locked"), "initializing\n");
  await forgetTaskWorktree(dir, o.wt.dest);
  assert.deepEqual([existsSync(o.wt.dest), existsSync(record)], [false, false], "the folder and git's record of it");
});

test("a follow-up checks the newest work out again; no repository is said in words", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_00000007" });
  assert.ok(o.ok);
  writeFileSync(join(o.wt.workdir, "c.txt"), "first exchange\n");
  const cap = await captureTaskWork(o.wt, { id: "sa_00000007" });
  assert.ok(cap.ok);
  await removeTaskWorktree(o.wt);
  const back = await reviveTaskWorktree(dir, { id: "sa_00000007", base: o.wt.base, head: cap.head });
  assert.ok(back.ok);
  assert.equal(read(join(back.wt.workdir, "c.txt")), "first exchange\n", "the follow-up starts from its own work");
  writeFileSync(join(back.wt.workdir, "e.txt"), "second exchange\n");
  const cap2 = await captureTaskWork(back.wt, { id: "sa_00000007", previous: cap.head });
  assert.ok(cap2.ok);
  assert.deepEqual(cap2.files.map((f) => f.path).sort(), ["c.txt", "e.txt"], "measured from the base: both exchanges' work");
  await removeTaskWorktree(back.wt);
  const plain = mkdtempSync(join(tmpdir(), "filament-nogit-"));
  made.push(plain);
  const none = await openTaskWorktree(plain, { id: "sa_00000009" });
  assert.equal(none.ok, false);
  assert.match(!none.ok ? none.error : "", /not a git repository/);
  const refused = await openTaskWorktree(dir, { id: "sa_0000000a", allowed: () => false });
  assert.match(!refused.ok ? refused.error : "", /outside the folders the agent may work in/);
});

// (fails before: yes — on Windows the checkout threw the folder's removal as it came, "EPERM, Permission denied", and
// a held folder with no worktree left in it threw the same; found by E15 step 1's drive, a sub-agent on Claude Code)
test("a worktree a program still stands in: its removal says so and leaves it free, a follow-up works in the folder — the newest work, in place — and one that is no worktree any more is refused in words", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_0000000b" });
  assert.ok(o.ok);
  writeFileSync(join(o.wt.workdir, "c.txt"), "first exchange\n");
  const cap = await captureTaskWork(o.wt, { id: "sa_0000000b" });
  assert.ok(cap.ok);
  const leave = await standIn(o.wt.dest);
  try {
    const gone = await removeTaskWorktree(o.wt);
    if (WINDOWS) {
      assert.equal(gone.ok, false);
      assert.match(!gone.ok ? gone.error : "", /^the worktree folder could not be removed \(/);
      assert.equal(read(join(o.wt.dest, "c.txt")), "first exchange\n", "the folder stays whole");
      assert.equal(copyState(o.wt.dest), "free", "nobody's: the next taking of it, or a trim, has it");
    }
    // What a program left there after the capture does not stand in the way; a changed file goes back to the work's.
    writeFileSync(join(o.wt.dest, "c.txt"), "scribbled on since\n");
    const back = await reviveTaskWorktree(dir, { id: "sa_0000000b", base: o.wt.base, head: cap.head });
    assert.ok(back.ok, back.ok ? "" : back.error);
    assert.equal(read(join(back.wt.workdir, "c.txt")), "first exchange\n", "the follow-up starts from its own work");
    writeFileSync(join(back.wt.workdir, "e.txt"), "second exchange\n");
    const cap2 = await captureTaskWork(back.wt, { id: "sa_0000000b", previous: cap.head });
    assert.ok(cap2.ok);
    assert.deepEqual(cap2.files.map((f) => f.path).sort(), ["c.txt", "e.txt"], "measured from the base: both exchanges' work");
    await releaseTaskWorktree(back.wt, "parked");
    if (WINDOWS) {
      rmSync(join(o.wt.dest, ".git"));
      const refused = await reviveTaskWorktree(dir, { id: "sa_0000000b", base: o.wt.base, head: cap2.head });
      assert.equal(refused.ok, false);
      assert.match(!refused.ok ? refused.error : "", /^its copy could not be made again: the worktree folder could not be removed \(/);
      assert.equal(read(join(dir, "a.txt")), "one\ntwo\nthree\nfour\nfive\n", "nothing was checked out over the developer's files");
    }
  } finally {
    await leave();
  }
  await pruneTaskWorktrees(dir, new Set());
  if (WINDOWS) assert.equal(existsSync(o.wt.dest), false, "free again, the folder that is no copy any more goes with the next prune");
});

// (fails before: yes — HarnessV4_Worktrees_Plan W3: every exchange's end removed the copy, and every next question
// checked the whole project out again)
test("a follow-up resets its parked copy where it stands — its build output kept, what was written since gone; a free copy is moved to the next agent and cleaned of all git does not track; one in use is never had", async () => {
  const dir = repo();
  writeFileSync(join(dir, ".git", "info", "exclude"), "*.out\n");
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  const o = await openTaskWorktree(dir, { id: "sa_00000021" });
  assert.ok(o.ok);
  assert.equal(copyState(o.wt.dest), "busy");
  const busy = await reviveTaskWorktree(dir, { id: "sa_00000021", base: o.wt.base, head: o.wt.base });
  assert.deepEqual([busy.ok, !busy.ok && busy.error], [false, "its copy is in use: an answer or a check runs in it now"]);
  writeFileSync(join(o.wt.workdir, "a.txt"), "one\ntwo\nTHREE\nfour\nfive\n");
  writeFileSync(join(o.wt.workdir, "c.txt"), "sea\n");
  writeFileSync(join(o.wt.workdir, "build.out"), "its build output\n");
  const cap = await captureTaskWork(o.wt, { id: "sa_00000021" });
  assert.ok(cap.ok);
  assert.deepEqual(cap.files.map((f) => f.path).sort(), ["a.txt", "c.txt"], "what git ignores is never work");
  await releaseTaskWorktree(o.wt, "parked");
  assert.equal(copyState(o.wt.dest), "parked");
  // After the capture: a check's scribble, a tracked file changed under it.
  writeFileSync(join(o.wt.workdir, "late.txt"), "written after the capture\n");
  writeFileSync(join(o.wt.workdir, "b.txt"), "changed after the capture\n");
  const back = await reviveTaskWorktree(dir, { id: "sa_00000021", base: o.wt.base, head: cap.head });
  assert.ok(back.ok, back.ok ? "" : back.error);
  assert.equal(back.wt.dest, o.wt.dest, "the same folder");
  const w = back.wt.workdir;
  assert.deepEqual(
    [read(join(w, "a.txt")), read(join(w, "c.txt")), read(join(w, "b.txt")), existsSync(join(w, "late.txt")), read(join(w, "build.out"))],
    ["one\ntwo\nTHREE\nfour\nfive\n", "sea\n", "bee\n", false, "its build output\n"],
  );
  assert.deepEqual([lstatSync(join(w, "node_modules")).isSymbolicLink(), copyMeta(back.wt.dest)?.links.length], [true, 1], "its link kept, and known");
  await releaseTaskWorktree(back.wt, "free");
  // Free, it is the next agent's: moved to its place, reset to its base, cleaned of the build output, linked anew.
  const next = await openTaskWorktree(dir, { id: "sa_00000022" });
  assert.ok(next.ok);
  assert.deepEqual([existsSync(o.wt.dest), existsSync(next.wt.dest)], [false, true], "the copy moved");
  const n = next.wt.workdir;
  assert.deepEqual([read(join(n, "a.txt")), existsSync(join(n, "c.txt")), existsSync(join(n, "build.out"))], ["one\ntwo\nthree\nfour\nfive\n", false, false]);
  assert.equal(read(join(n, "node_modules", "pkg", "index.js")), "module.exports = 1;\n");
  assert.equal(read(join(dir, "node_modules", "pkg", "index.js")), "module.exports = 1;\n", "no clean followed a link");
  assert.equal(git(dir, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length, 2, "one copy, git's record of it moved with it");
  // The first agent's work is on its refs: its next question checks it out anew, beside the one in use.
  assert.equal((await taskRefs(dir, "sa_00000021"))?.head, cap.head);
  const again = await reviveTaskWorktree(dir, { id: "sa_00000021", base: o.wt.base, head: cap.head });
  assert.ok(again.ok);
  assert.equal(read(join(again.wt.workdir, "c.txt")), "sea\n");
  await removeTaskWorktree(again.wt);
  await removeTaskWorktree(next.wt);
});

// (fails before: yes — W3: no copy was kept, so none could be had again or let go)
test(`at most ${KEPT_COPIES} copies nobody uses stay: past them the least recently used goes, its work on its refs; at the cap a new agent takes the oldest parked one — never one parked within the minute, nor one in use`, async () => {
  const dir = repo();
  /** @param {string} id */
  const one = async (id) => {
    const o = await openTaskWorktree(dir, { id });
    assert.ok(o.ok, o.ok ? "" : o.error);
    writeFileSync(join(o.wt.workdir, `${id}.txt`), `${id}\n`);
    const cap = await captureTaskWork(o.wt, { id });
    assert.ok(cap.ok);
    return { wt: o.wt, head: cap.head };
  };
  /** As a copy parked `ago` ms back. @param {string} dest @param {number} ago */
  const parkedAgo = (dest, ago) => writeFileSync(join(git(dest, "rev-parse", "--absolute-git-dir"), "filament.json"), JSON.stringify({ ...copyMeta(dest), state: "parked", at: Date.now() - ago }));
  const ids = ["sa_00000031", "sa_00000032", "sa_00000033", "sa_00000034", "sa_00000035"];
  const five = [];
  for (const id of ids) five.push(await one(id));
  for (const [i, m] of five.slice(0, 4).entries()) {
    await releaseTaskWorktree(m.wt, "parked");
    parkedAgo(m.wt.dest, (10 - i) * 60_000);
  }
  assert.equal(copiesOf(dir).length, 5, "the cap counts the copies nobody uses: one is in use");
  await releaseTaskWorktree(five[4].wt, "parked");
  assert.deepEqual(copiesOf(dir).map(([name]) => name), ids.slice(1), "the least recently used went");
  assert.equal((await taskRefs(dir, ids[0]))?.head, five[0].head, "its work on its refs");
  // At the cap, a new agent: the oldest parked copy moves to it — not the one parked just now.
  const f = await openTaskWorktree(dir, { id: "sa_00000036" });
  assert.ok(f.ok);
  assert.deepEqual(copiesOf(dir), [["sa_00000033", "parked"], ["sa_00000034", "parked"], ["sa_00000035", "parked"], ["sa_00000036", "busy"]]);
  assert.equal(existsSync(join(f.wt.workdir, "sa_00000032.txt")), false, "cleaned of what it held");
  // Another while that one works: fewer copies to be had than the cap, so a new checkout.
  const g = await openTaskWorktree(dir, { id: "sa_00000037" });
  assert.ok(g.ok);
  assert.equal(copiesOf(dir).length, 5);
  await releaseTaskWorktree(f.wt, "free");
  await releaseTaskWorktree(g.wt, "free");
  assert.deepEqual(copiesOf(dir).map(([name]) => name), ["sa_00000034", "sa_00000035", "sa_00000036", "sa_00000037"], `${KEPT_COPIES} again, the oldest gone`);
});

// (fails before: yes — HarnessV4_Worktrees_Plan W5: on 100,000 files a check that found no free copy waited 33 s for
// its checkout; with a spare made ahead, 0.7 s)
test("a spare copy made ahead is the next taker's: moved and reset to the commit it needs; a taker that comes while it is made waits for it, never checking out a second; none is made where a copy is free", async () => {
  const dir = repo();
  const home = join(dir, ".git", "filament-worktrees");
  const worktrees = () => git(dir, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;
  const a = await openTaskWorktree(dir, { id: "sa_00000051" });
  assert.ok(a.ok);
  await makeSpareCopy(dir, home);
  const [spare] = copiesOf(dir).filter(([name]) => name.startsWith("spare-"));
  assert.deepEqual(spare?.[1], "free", "made, free");
  // The developer's uncommitted edit is in the next agent's base: the spare, made at HEAD, is reset to it.
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree (uncommitted)\nfour\nfive\n");
  const b = await openTaskWorktree(dir, { id: "sa_00000052" });
  assert.ok(b.ok);
  assert.deepEqual(copiesOf(dir), [["sa_00000051", "busy"], ["sa_00000052", "busy"]], "the spare moved to it");
  assert.equal(read(join(b.wt.workdir, "a.txt")), "one\ntwo\nthree (uncommitted)\nfour\nfive\n");
  // One being made when the next taker comes: it waits for that one.
  const making = makeSpareCopy(dir, home);
  const c = await openTaskWorktree(dir, { id: "sa_00000053" });
  await making;
  assert.ok(c.ok);
  assert.deepEqual([copiesOf(dir).map(([name]) => name), worktrees()], [["sa_00000051", "sa_00000052", "sa_00000053"], 4], "no second checkout beside the spare");
  // A copy free: no spare.
  await releaseTaskWorktree(c.wt, "free");
  await makeSpareCopy(dir, home);
  assert.deepEqual(copiesOf(dir).map(([name]) => name), ["sa_00000051", "sa_00000052", "sa_00000053"]);
  await removeTaskWorktree(a.wt);
  await removeTaskWorktree(b.wt);
});

// (fails before: yes — W3: two Filament runs on one repository would take each other's copies for a crash's)
test("a copy another living Filament holds is never touched; once its process is gone — a restart — it is this one's, what it held kept on its refs", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_00000041" });
  assert.ok(o.ok);
  writeFileSync(join(o.wt.workdir, "c.txt"), "theirs\n");
  const home = join(dir, ".git", "filament-worktrees");
  const record = git(o.wt.dest, "rev-parse", "--absolute-git-dir");
  /** Busy, held by a Filament whose process is `pid`, which said a moment ago that it lives. @param {number} pid */
  const heldBy = (pid) => {
    writeFileSync(join(record, "filament.json"), JSON.stringify({ ...copyMeta(o.wt.dest), owner: "another-filament", state: "busy" }));
    mkdirSync(join(home, ".alive"), { recursive: true });
    writeFileSync(join(home, ".alive", "another-filament"), String(pid));
  };
  letGoOfCopies();
  heldBy(process.pid);
  assert.equal(await pruneTaskWorktrees(dir, new Set()), 0);
  assert.deepEqual([copyMeta(o.wt.dest)?.owner, copyState(o.wt.dest), read(join(o.wt.workdir, "c.txt"))], ["another-filament", "busy", "theirs\n"], "its copy as it holds it");
  const refused = await reviveTaskWorktree(dir, { id: "sa_00000041", base: o.wt.base, head: o.wt.base });
  assert.deepEqual([refused.ok, !refused.ok && refused.error], [false, "its copy is held by another Filament that works in this repository"]);
  // Restarted: it said it lived a moment ago, but its process is gone.
  const ended = spawn(process.execPath, ["-e", ""]);
  await once(ended, "exit");
  heldBy(Number(ended.pid));
  assert.equal(await pruneTaskWorktrees(dir, new Set()), 0);
  assert.deepEqual([copyMeta(o.wt.dest)?.owner === "another-filament", copyState(o.wt.dest)], [false, "parked"], "this Filament's now, parked for its agent");
  const head = String((await taskRefs(dir, "sa_00000041"))?.head);
  assert.notEqual(head, o.wt.base, "what the busy copy held is on its refs");
  const back = await reviveTaskWorktree(dir, { id: "sa_00000041", base: o.wt.base, head });
  assert.ok(back.ok);
  assert.equal(read(join(back.wt.workdir, "c.txt")), "theirs\n");
});

// (fails before: yes — the bug hunt of 10-30, GIT-5: a copy another living Filament was still checking out — no record
// of Filament's yet, git's lock on it — was taken for a checkout a crash cut, and removed under that Filament's git)
test("a copy another living Filament may still be making is left to it; one older than a making takes, or once that Filament is gone, goes as a cut checkout does", async () => {
  const dir = repo();
  const home = join(dir, ".git", "filament-worktrees");
  const making = await openTaskWorktree(dir, { id: "sa_00000043" });
  const stale = await openTaskWorktree(dir, { id: "sa_00000044" });
  assert.ok(making.ok && stale.ok);
  // As a checkout stands mid-way: git's lock on its record, and no record of Filament's yet.
  for (const c of [making, stale]) {
    const record = git(c.wt.dest, "rev-parse", "--absolute-git-dir");
    rmSync(join(record, "filament.json"));
    writeFileSync(join(record, "locked"), "initializing\n");
  }
  letGoOfCopies();
  // Another Filament lives in the repository; the second copy has not changed for longer than a checkout may take.
  mkdirSync(join(home, ".alive"), { recursive: true });
  writeFileSync(join(home, ".alive", "another-filament"), String(process.pid));
  const then = (Date.now() - 10 * 60_000) / 1000;
  utimesSync(stale.wt.dest, then, then);
  assert.equal(await pruneTaskWorktrees(dir, new Set()), 1);
  assert.deepEqual([existsSync(making.wt.dest), existsSync(stale.wt.dest)], [true, false], "the one in the making left to it; the old one is a crash's");
  // That Filament gone, nobody makes it: a checkout cut, it goes.
  rmSync(join(home, ".alive", "another-filament"));
  assert.equal(await pruneTaskWorktrees(dir, new Set()), 1);
  assert.equal(existsSync(making.wt.dest), false);
});

// (fails before: yes — the bug hunt of 10-30, GIT-6: git ending before it read its input left the pipe's error unheard,
// and it threw past every caller: "write EOF")
test("input git never reads — it ended first — throws nothing: the refs' step answers false", async () => {
  // A folder in no repository ends git at once, and lines past what a pipe holds are never taken.
  const plain = mkdtempSync(join(tmpdir(), "filament-nogit-"));
  made.push(plain);
  assert.equal(await dropTaskRefs(plain, `sa_${"0".repeat(2 * 1024 * 1024)}`), false);
});

// (fails before: yes — the copies hunt of 10-23: a restart's old process number, taken by another program, kept the
// copies the old Filament held for five minutes)
test("a copy whose Filament has not said it lives for three minutes is this one's, though a program runs under its old number", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_00000042" });
  assert.ok(o.ok);
  const home = join(dir, ".git", "filament-worktrees");
  writeFileSync(join(git(o.wt.dest, "rev-parse", "--absolute-git-dir"), "filament.json"), JSON.stringify({ ...copyMeta(o.wt.dest), owner: "another-filament", state: "busy" }));
  mkdirSync(join(home, ".alive"), { recursive: true });
  const alive = join(home, ".alive", "another-filament");
  // This test's own process stands for the program that took the old number.
  writeFileSync(alive, String(process.pid));
  const then = (Date.now() - 3 * 60_000) / 1000;
  utimesSync(alive, then, then);
  letGoOfCopies();
  assert.equal(await pruneTaskWorktrees(dir, new Set()), 0);
  assert.deepEqual([copyMeta(o.wt.dest)?.owner === "another-filament", copyState(o.wt.dest)], [false, "parked"], "this Filament's now, parked for its agent");
});

// ---- the registry: a sub-agent that changes files, its exchanges in its own worktree -------------------------------------

/**
 * A registry over a real repository whose front door is a scripted host: each exchange "runs" by writing into the
 * folder the host works in — the worktree `hostOf` names, else the folder its request names (x-filament-cwd), as
 * agent/turn.js decides — what the hands would do there — and finishing with a report. `over`: parts of its context.
 * @param {string} dir @param {(o: { n: number, cwd: string, body: any }) => string | Promise<string>} work  returns the report
 * @param {Record<string, any>} [over]
 */
const workingRegistry = (dir, work, over = {}) => {
  /** @type {{ body: any, headers: Record<string, string>, cwd: string }[]} */
  const posts = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      settings: () => ({ subagents: { workspace: "worktree" }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      ...over,
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const cwd = registry.hostOf(id)?.workdir || String(headers["x-filament-cwd"]);
      posts.push({ body, headers, cwd });
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const report = await work({ n, cwd, body });
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, posts };
};
/** One `agent` call through a turn's door. @param {any} door @param {string} id @param {any} input */
const agentCall = (door, id, input) => door.subagents.run({ id, input, emit: () => {}, signal: null });

// (fails before: yes — HarnessV4_Worktrees_Plan W1: it worked in the developer's folder, said only by a toast)
test("an agent that edits, whose copy fails in a repository, never works in the developer's folder: its launch says why and the ways on", async () => {
  const dir = repo();
  const { registry, posts } = workingRegistry(dir, ({ cwd }) => {
    writeFileSync(join(cwd, "made.txt"), "by the sub-agent\n");
    return "WROTE";
  }, { folderProblem: (/** @type {string} */ p) => (/filament-worktrees/.test(String(p)) ? "outside the roots" : null) });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  const r = await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write a file" });
  assert.deepEqual([posts.length, existsSync(join(dir, "made.txt"))], [0, false], "it never ran, and nothing is in the developer's folder");
  assert.match(r.text, /Builder edits in its own copy of the project, and its copy could not be made: its copy would sit in .*filament-worktrees, outside the folders the agent may work in \(agentLoop\.roots\): add that folder there \(Settings › Agent loop\), or launch it read only\. Ask it read only, or tell the developer: only they can let it work in the session's folder/);
  const [row] = /** @type {any[]} */ (registry.list("c1"));
  assert.equal(row.shares, null, "its row never says it worked in the folder");
  assert.match(String(row.noCopy), /^its copy would sit in /);
  // (fails before: yes — the bug round of 10-23: a follow-up ran it in the developer's folder, and its launch's answer
  // invited one)
  assert.doesNotMatch(r.text, /call agent with agent_id/, "its launch invites no follow-up");
  assert.match(r.text, /It never ran: launch it again, without agent_id, once its copy can be made\./);
  const again = await agentCall(door, "toolu_2", { run_in_background: false, description: "again", agent_id: row.id, prompt: "write it now" });
  assert.deepEqual([posts.length, existsSync(join(dir, "made.txt"))], [0, false], "a follow-up does not run it in the developer's folder either");
  assert.match(again.text, /its copy could not be made: .*It never ran: launch it again/);
});

// (fails before: yes — the bug round of 10-23: git refusing a repository another account owns read as no repository,
// so the agent shared the developer's folder and edited it)
test("an agent that edits, in a repository git refuses (another account owns it), never works in the developer's folder", async (t) => {
  const dir = repo();
  const knob = { ...process.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: "1" };
  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, env: knob, stdio: "ignore", windowsHide: true });
    return t.skip("this git reads a repository another account owns (safe.directory, or no such check)");
  } catch {}
  const { registry, posts } = workingRegistry(dir, ({ cwd }) => {
    writeFileSync(join(cwd, "made.txt"), "by the sub-agent\n");
    return "WROTE";
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1";
  try {
    const r = await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write a file" });
    assert.deepEqual([posts.length, existsSync(join(dir, "made.txt"))], [0, false], "it never ran, and nothing is in the developer's folder");
    assert.match(r.text, /its copy could not be made: git refuses the repository this folder is in: fatal: detected dubious ownership/);
    const [row] = /** @type {any[]} */ (registry.list("c1"));
    assert.equal(row.shares, null, "never read as no repository");
  } finally {
    delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
  }
});

// (fails before: yes — found by E15 step 1's live drive: a folder Claude Code or Codex still stood in when the exchange
// ended was tried once, and stayed in the repository's git folder until a later launch there; since W3 every copy is
// parked at its exchange's end, held or not)
test("a copy a program still stands in when the exchange ends is parked as any; a follow-up works in it, its own work there, and nothing removes it under the follow-up", async () => {
  const dir = repo();
  /** @type {(() => Promise<void>) | null} */
  let leave = null;
  let kept = false;
  const { registry, posts } = workingRegistry(dir, async ({ n, cwd }) => {
    if (n === 1 || n === 3) {
      writeFileSync(join(cwd, `made${n}.txt`), "by the sub-agent\n");
      leave = await standIn(cwd);
      return "WROTE";
    }
    // The follow-up: the program left as it began.
    await leave?.();
    leave = null;
    writeFileSync(join(cwd, "made2.txt"), "the follow-up's\n");
    await new Promise((r) => setTimeout(r, 100));
    kept = existsSync(join(cwd, "made2.txt")) && existsSync(join(cwd, "made1.txt"));
    return "REVISED";
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  try {
    const first = await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write a file" });
    const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
    const cwd = posts[0].cwd;
    assert.match(first.text, /its changes are not in your folder yet: 1 file/, "its work is captured all the same");
    assert.equal(copyState(cwd), "parked", "parked, a program in it or not");
    assert.deepEqual(copyTemps(cwd), [], "its record was written whole: no temp file stays beside it");
    const again = await agentCall(door, "toolu_2", { run_in_background: false, description: "again", agent_id: id, prompt: "revise it" });
    assert.match(again.text, /^REVISED[\s\S]*2 files/);
    assert.equal(kept, true, "nothing touched the follow-up's work under it");
    assert.deepEqual([posts[1].cwd, copyState(cwd)], [cwd, "parked"], "in the same folder, parked again");
    // A second sub-agent, whose folder is held at its end: parked the same.
    const other = await agentCall(door, "toolu_3", { run_in_background: false, description: "write", prompt: "write another file" });
    const held = posts[2].cwd;
    assert.match(other.text, /^WROTE/);
    assert.equal(copyState(held), "parked");
  } finally {
    await /** @type {(() => Promise<void>) | null} */ (leave)?.();
  }
});

// (fails before: yes — the owner's of 11-10: every worktree note said dependency folders were linked in, where none was)
test("a writing sub-agent's note names the dependency folders linked into its copy, and says plainly where none was", async () => {
  const dir = repo();
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  const { registry, posts } = workingRegistry(dir, () => "WROTE");
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write a file" });
  const [note] = posts[0].body.messages[0].content.map((/** @type {any} */ b) => b.text);
  assert.match(note, /Folders git ignores are not in the copy, except the dependency folders Filament linked into it: node_modules \(linked to .*node_modules\)\. Use them, never install into them: they are the project's own\./);
  assert.notEqual(note, SUBAGENT_NOTES.worktree);
  const bare = repo();
  const other = workingRegistry(bare, () => "WROTE");
  const door2 = other.registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: bare, mode: "edit", model: "m", thinking: null, fork: null });
  await agentCall(door2, "toolu_1", { run_in_background: false, description: "write", prompt: "write a file" });
  const [none] = other.posts[0].body.messages[0].content.map((/** @type {any} */ b) => b.text);
  assert.match(none, /Folders git ignores are not in the copy, and no dependency folder is linked into it: neither the project nor its repository's main checkout has a node_modules or virtualenv that git ignores, so a command that needs one fails here\./);
  assert.doesNotMatch(none, /linked in from the project/);
});

test("a writing sub-agent's exchange runs in its own worktree: the report says what waits; the agent applies it — merged with the developer's edit — and a follow-up works on its own work", async () => {
  const dir = repo();
  let found = "";
  const { registry, posts } = workingRegistry(dir, ({ n, cwd }) => {
    if (n === 1) {
      writeFileSync(join(cwd, "made.txt"), "by the sub-agent\n");
      writeFileSync(join(cwd, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
      return "WROTE";
    }
    found = read(join(cwd, "made.txt"));
    writeFileSync(join(cwd, "made.txt"), "by the sub-agent, revised\n");
    return "REVISED";
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  const first = await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write a file" });
  const cwd = posts[0].cwd;
  assert.match(cwd.split("\\").join("/"), /\/\.git\/filament-worktrees\/sa_[0-9a-f]{8}$/, "the run works in its worktree");
  assert.equal(posts[0].headers["x-filament-cwd"], dir, "while its request names the session's folder — its project");
  assert.deepEqual(posts[0].body.messages[0].content.map((/** @type {any} */ b) => b.text), [SUBAGENT_NOTES.worktree, "write a file"], "told so ahead of its task");
  assert.match(first.text, /^WROTE\n\nIt worked in its own git worktree, so its changes are not in your folder yet: 2 files \(\+2 −1\) — a\.txt, made\.txt\. To apply them, call agent with agent_id "sa_[0-9a-f]{8}" and apply_changes: true/);
  assert.equal(existsSync(join(dir, "made.txt")), false, "the developer's folder is untouched");
  assert.equal(copyState(cwd), "parked", "its copy stays once its work is captured, parked for its next question");
  const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
  const seen = /** @type {any} */ (registry.get(id));
  assert.deepEqual([seen.work.pending, seen.work.added, seen.work.removed, seen.work.open, seen.shares], [2, 2, 1, false, null]);
  assert.equal(seen.work.folder, cwd, "where its copy is, parked: its header names it (the owner's words of 10-26: \"What copy?\")");
  const c = await registry.changes(id, "c1");
  assert.ok(c.ok);
  assert.deepEqual(c.ok && c.files.map((f) => [f.path, f.status]), [["a.txt", "M"], ["made.txt", "A"]]);
  assert.match(c.ok ? c.diff : "", /\+FIVE/);
  writeFileSync(join(dir, "a.txt"), "ONE\ntwo\nthree\nfour\nfive\n");
  const applied = await agentCall(door, "toolu_2", { description: "apply", agent_id: id, apply_changes: true });
  assert.deepEqual([applied.ok, applied.wrote], [true, true]);
  assert.match(applied.text, /^Applied the changes of sub-agent sa_[0-9a-f]{8} to your folder: 2 files/);
  assert.equal(read(join(dir, "a.txt")), "ONE\ntwo\nthree\nfour\nFIVE\n", "merged with the developer's own edit");
  assert.equal(read(join(dir, "made.txt")), "by the sub-agent\n");
  assert.deepEqual([registry.get(id)?.work?.pending, registry.get(id)?.work?.applied], [0, 1]);
  // (fails before: yes — the row said how many applies, not when the newest was: the Changes pane's "applied 14:02 ·
  // 2 files", HarnessV4_Git_Plan GWC-72)
  const last = registry.get(id)?.work?.lastApplied;
  assert.deepEqual([last?.files, typeof last?.at], [2, "number"]);
  // (fails before: no — a guard, HarnessV4_Tasks E15 step 5 (AG-129): the line an apply sends is the developer's
  // apply's alone)
  assert.deepEqual(door.inbox.take(), [], "its own apply tells it nothing more: it applied the files itself");
  assert.match(String(await registry.apply(id, "c1").then((r) => (r.ok ? "" : r.error))), /has no changes waiting to be applied/);
  const again = await agentCall(door, "toolu_3", { run_in_background: false, description: "again", agent_id: id, prompt: "revise it" });
  assert.equal(found, "by the sub-agent\n", "the follow-up's worktree holds its own earlier work");
  assert.equal(read(join(dir, "made.txt")), "by the sub-agent\n", "the developer's copy waits for the next apply");
  assert.match(again.text, /^REVISED[\s\S]*1 file \(\+1 −1\) — made\.txt/, "measured from what was applied");
  // Forgotten by the registry (a restart): the repository's refs still reach the work.
  const fresh = workingRegistry(dir, () => "never").registry;
  const later = await fresh.changes(id, "c1");
  assert.deepEqual(later.ok && later.files.map((f) => f.path), ["made.txt"]);
  writeFileSync(join(dir, "made.txt"), "the developer's own line\n");
  const refused = await fresh.apply(id, "c1", "owner");
  assert.equal(refused.ok, false);
  assert.deepEqual(!refused.ok && refused.conflicts?.map((x) => x.path), ["made.txt"]);
  assert.match(!refused.ok ? refused.error : "", /^1 file does not come through cleanly — made\.txt: 1 change overlaps yours$/);
  assert.equal(read(join(dir, "made.txt")), "the developer's own line\n", "nothing written");
  assert.match(String(await registry.apply(id, "c2").then((r) => (r.ok ? "" : r.error))), /no sub-agent sa_[0-9a-f]{8} in this session/);
  door.close();
});

// (fails before: yes — the owner's list of 11-08: a follow-up's worktree held the folder as it stood at the launch, so
// the edits made there since never reached it, and the field was unknown)
test("a follow-up with sync takes the folder as it stands now into its worktree, its change on top, and is told what came in; an overlap refuses it, nothing moved and nothing run", async () => {
  const dir = repo();
  /** @type {string[]} */
  const seen = [];
  const { registry, posts } = workingRegistry(dir, ({ n, cwd }) => {
    if (n === 1) {
      writeFileSync(join(cwd, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");
      return "WROTE";
    }
    seen.push(read(join(cwd, "b.txt")), read(join(cwd, "a.txt")));
    return "READ";
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  const first = await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write" });
  const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
  writeFileSync(join(dir, "b.txt"), "bee, edited after its launch\n");
  writeFileSync(join(dir, "a.txt"), "ONE\ntwo\nthree\nfour\nfive\n");
  await agentCall(door, "toolu_2", { run_in_background: false, description: "again", agent_id: id, prompt: "look again", sync: true });
  assert.deepEqual(seen, ["bee, edited after its launch\n", "ONE\ntwo\nthree\nfour\nFIVE\n"], "the folder's edits came in, its change on top");
  const asked = posts[1].body.messages.at(-1).content.map((/** @type {any} */ b) => b.text);
  assert.deepEqual(asked, ["[Filament: the developer's folder as it stands now came into your worktree before this message, your change kept on top of it: 2 files came in (a.txt, b.txt).]", "look again"]);
  const c = await registry.changes(id, "c1");
  assert.deepEqual(c.ok && c.files.map((f) => f.path), ["a.txt"], "what waits is its own change alone");
  assert.match(c.ok ? c.diff : "", /-five\n\+FIVE/);
  // (fails before: yes — the review of 11-08: a follow-up that came while the sync moved its work reopened the work from
  // where it stood, and the move's new base then measured it wrong)
  writeFileSync(join(dir, "b.txt"), "bee, edited again\n");
  const moving = agentCall(door, "toolu_m", { run_in_background: false, description: "again", agent_id: id, prompt: "once more", sync: true });
  await assert.rejects(agentCall(door, "toolu_n", { run_in_background: false, description: "meanwhile", agent_id: id, prompt: "meanwhile" }), /being moved onto your folder now/);
  await moving;
  assert.equal(seen.at(-2), "bee, edited again\n", "the move's own follow-up went on from the folder as it stood");
  // Its change and the folder's next edit overlap: nothing moves, and it does not start.
  writeFileSync(join(dir, "a.txt"), "ONE\ntwo\nthree\nfour\nfive, the developer's\n");
  const refs = git(dir, "for-each-ref", `refs/filament/subagents/${id}`);
  await assert.rejects(agentCall(door, "toolu_3", { run_in_background: false, description: "again", agent_id: id, prompt: "and again", sync: true }), /^Error: nothing was synced and it did not start: a\.txt \(your edits and its change overlap\)\. Follow it up without sync, or apply its change first$/);
  assert.deepEqual([posts.length, git(dir, "for-each-ref", `refs/filament/subagents/${id}`)], [3, refs], "it never ran, and its refs stand as they were");
  // (fails before: yes — the review of 11-08: the sync moved its work first, and a follow-up refused after it lost the note)
  writeFileSync(join(dir, "a.txt"), "ONE\ntwo\nthree\nfour\nFIVE\n");
  await assert.rejects(agentCall(door, "toolu_e", { run_in_background: false, description: "again", agent_id: id, prompt: " ", sync: true }), /a follow-up needs a message/);
  assert.equal(git(dir, "for-each-ref", `refs/filament/subagents/${id}`), refs, "a follow-up that would be refused moves nothing");
  await assert.rejects(agentCall(door, "toolu_4", { run_in_background: false, description: "new", prompt: "go", sync: true }), /sync needs agent_id/);
  door.close();
});

// (fails before: yes — on Windows the follow-up failed with the raw "EPERM, Permission denied …" of the folder's
// removal: the first exchange's end had counted the held folder as gone)
test("a sub-agent whose worktree a program still stands in at its exchange's end: its work is captured and waits as any, and its follow-up works on it in the same folder", async () => {
  const dir = repo();
  /** @type {(() => Promise<void>) | null} */
  let leave = null;
  let found = "";
  const { registry, posts } = workingRegistry(dir, async ({ n, cwd }) => {
    if (n === 1) {
      writeFileSync(join(cwd, "made.txt"), "by the sub-agent\n");
      leave = await standIn(cwd);
      return "WROTE";
    }
    found = read(join(cwd, "made.txt"));
    writeFileSync(join(cwd, "made.txt"), "by the sub-agent, revised\n");
    return "REVISED";
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  try {
    const first = await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write a file" });
    assert.match(first.text, /^WROTE\n\nIt worked in its own git worktree, so its changes are not in your folder yet: 1 file \(\+1 −0\) — made\.txt\./);
    const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
    assert.equal(copyState(posts[0].cwd), "parked", "held or not, the copy is parked");
    const again = await agentCall(door, "toolu_2", { run_in_background: false, description: "again", agent_id: id, prompt: "revise it" });
    assert.equal(again.ok, true, again.text);
    assert.equal(found, "by the sub-agent\n", "the follow-up found its own earlier work");
    assert.equal(posts[1].cwd, posts[0].cwd, "in the same folder");
    assert.match(again.text, /^REVISED[\s\S]*1 file \(\+1 −0\) — made\.txt/);
    const applied = await registry.apply(id, "c1", "owner");
    assert.equal(applied.ok, true);
    assert.equal(read(join(dir, "made.txt")), "by the sub-agent, revised\n");
    // (fails before: yes — AG-129: the developer's apply told the turn that runs nothing)
    const [told] = door.inbox.take();
    assert.deepEqual([told?.kind, told?.from, told?.wrote], ["applied", id, false]);
    assert.equal(told.text, `[Filament: the developer applied the changes of sub-agent ${id} ("write") to your folder: 1 file changed under you — made.txt. What you read of it before may be out of date: read again before you edit.]`);
  } finally {
    await /** @type {(() => Promise<void>) | null} */ (leave)?.();
    door.close();
  }
});

// (fails before: yes — the bug round of 10-23: a capture that failed kept the copy open at its first base, and once
// the developer applied, the next capture measured against that base: what was applied waited again)
test("a capture that fails, then an apply: the follow-up's work is only what came after the apply", async () => {
  const dir = repo();
  let id = "";
  const lock = () => join(dir, ".git", "refs", "filament", "subagents", id, "work.lock");
  const { registry } = workingRegistry(dir, ({ n, cwd }) => {
    writeFileSync(join(cwd, `step${n}.txt`), `step ${n}\n`);
    // The second exchange's capture fails: git cannot take its ref's lock.
    if (n === 2) writeFileSync(lock(), "");
    return `WROTE ${n}`;
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  try {
    const first = await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write a file" });
    id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
    assert.match(first.text, /1 file \(\+1 −0\) — step1\.txt/);
    const second = await agentCall(door, "toolu_2", { run_in_background: false, description: "again", agent_id: id, prompt: "more" });
    assert.match(second.text, /its work could not be captured \(git update-ref failed/, "its capture failed, and its copy stays open");
    rmSync(lock(), { force: true });
    const applied = await registry.apply(id, "c1", "owner");
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(read(join(dir, "step1.txt")), "step 1\n", "the work captured before went in");
    const third = await agentCall(door, "toolu_3", { run_in_background: false, description: "more", agent_id: id, prompt: "more again" });
    assert.match(third.text, /step3\.txt/);
    assert.doesNotMatch(third.text, /step1\.txt/, "what was applied does not wait again");
  } finally {
    rmSync(lock(), { force: true });
    door.close();
  }
});

test("Reviewer and a launch with worktree off work in the session's folder; a folder without git shares it and says why", async () => {
  const dir = repo();
  const { registry, posts } = workingRegistry(dir, () => "LOOKED");
  const ex = await registry.launch({ origin: "owner", chainId: "c1", prompt: "look", worker: "reviewer" });
  assert.ok(ex.ok);
  await (ex.ok && ex.done);
  const off = await registry.launch({ origin: "owner", chainId: "c1", prompt: "edit here", worktree: false });
  assert.ok(off.ok);
  await (off.ok && off.done);
  assert.deepEqual(posts.map((p) => [p.cwd, p.headers["x-filament-cwd"]]), [[dir, dir], [dir, dir]], "both work in the session's folder");
  assert.ok(posts.every((p) => !JSON.stringify(p.body.messages).includes("your own git worktree")));
  assert.deepEqual(registry.list("c1").map((s) => [s.card.tag, s.may, s.work, s.shares]), [["builder", "edit", null, null], ["reviewer", "read", null, null]]);
  assert.match(String(await registry.apply(ex.ok ? ex.id : "", "c1").then((r) => (r.ok ? "" : r.error))), /was read-only: it changed nothing/);
  const plain = mkdtempSync(join(tmpdir(), "filament-nogit-"));
  made.push(plain);
  const bare = workingRegistry(plain, () => "WROTE HERE");
  const r = await bare.registry.launch({ origin: "owner", chainId: "c1", prompt: "write" });
  assert.ok(r.ok);
  await (r.ok && r.done);
  assert.deepEqual([bare.posts[0].cwd, bare.posts[0].headers["x-filament-cwd"]], [plain, plain]);
  assert.match(String(bare.registry.list("c1")[0].shares), /not a git repository/);
  assert.match(String(await bare.registry.apply(r.ok ? r.id : "", "c1").then((x) => (x.ok ? "" : x.error))), /worked in the session's folder \(no worktree: .*not a git repository/);
});

test("a sub-agent's refs last only while its work waits: applied, they go and a restart offers nothing; a follow-up writes both again and applies after a restart; an exchange that changed nothing leaves none; an apply in flight answers only its own session", async () => {
  const dir = repo();
  const { registry } = workingRegistry(dir, ({ n, cwd }) => {
    if (n === 1) writeFileSync(join(cwd, "c.txt"), "first\n");
    if (n === 2) writeFileSync(join(cwd, "c.txt"), "second\n");
    return n === 3 ? "LOOKED" : "WROTE";
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  const first = await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write c.txt" });
  const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
  assert.ok(await taskRefs(dir, id), "its work waits: the refs hold it");
  const [mine, theirs] = await Promise.all([registry.apply(id, "c1"), registry.apply(id, "c2")]);
  assert.ok(mine.ok);
  assert.match(!theirs.ok ? theirs.error : "", /^no sub-agent sa_[0-9a-f]{8} in this session$/, "another session's ask is not handed this session's apply");
  assert.equal(read(join(dir, "c.txt")), "first\n");
  assert.equal(await taskRefs(dir, id), null, "applied: its refs are gone");
  const restarted = workingRegistry(dir, () => "never").registry;
  assert.match(String(await restarted.apply(id, "c1").then((r) => (r.ok ? "" : r.error))), /^no work of sub-agent sa_[0-9a-f]{8} waits in this session's repository$/, "a restart does not offer the applied work again");
  await agentCall(door, "toolu_2", { run_in_background: false, description: "revise", agent_id: id, prompt: "revise c.txt" });
  const refs = await taskRefs(dir, id);
  assert.ok(refs, "the follow-up's capture wrote both refs again");
  assert.deepEqual((await changedFiles(dir, refs.base, refs.head)).map((f) => f.path), ["c.txt"], "measured from what was applied");
  const again = workingRegistry(dir, () => "never").registry;
  const later = await again.apply(id, "c1", "owner");
  assert.ok(later.ok, !later.ok ? later.error : "");
  assert.equal(read(join(dir, "c.txt")), "second\n", "applied after a restart, from the refs");
  assert.equal(await taskRefs(dir, id), null);
  const looked = await agentCall(door, "toolu_3", { run_in_background: false, description: "look", prompt: "look only" });
  const quiet = String(registry.list("c1").find((s) => s.id !== id)?.id);
  assert.match(looked.text, /changed nothing/);
  assert.equal(await taskRefs(dir, quiet), null, "nothing waits, so no refs stay behind");
  door.close();
});

test("git failing under an apply or a look at the changes is said in words — never a throw", async () => {
  const dir = repo();
  // A commit whose tree is gone: git still names the commit, but cannot diff it.
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, input: "orphan\n", encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["mktree"], { cwd: dir, input: `100644 blob ${blob}\tz.txt\n`, encoding: "utf8" }).trim();
  const commit = git(dir, "commit-tree", tree, "-p", "HEAD", "-m", "lost");
  const loose = join(dir, ".git", "objects", tree.slice(0, 2), tree.slice(2));
  chmodSync(loose, 0o644);
  rmSync(loose);
  git(dir, "update-ref", "refs/filament/subagents/sa_0000000e/base", "HEAD");
  git(dir, "update-ref", "refs/filament/subagents/sa_0000000e/work", commit);
  const { registry } = workingRegistry(dir, () => "never");
  const a = await registry.apply("sa_0000000e", "c1");
  assert.equal(a.ok, false);
  assert.match(!a.ok ? a.error : "", /^the apply failed \(git could not list the changed files \(.+\)\)$/);
  const c = await registry.changes("sa_0000000e", "c1");
  assert.match(!c.ok ? c.error : "", /^its changes could not be read \(git could not list the changed files/);
});

// (fails before: yes — Fable 5.1's read of 10-22, HarnessV4_Worktrees_Plan W3: after a restart an agent answered from
// what was kept of it, a capture behind what its cut exchange had left in its copy — with its thread kept, and without)
test("after a restart, an agent's exchange the restart cut is read from its copy: its changes and its apply are what the copy held, its thread kept or not", async () => {
  for (const kept of [true, false]) {
    const dir = repo();
    /** @type {Map<string, any[]>} */
    const threads = new Map();
    const store = kept
      ? {
          saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
          loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
        }
      : {};
    const { registry, posts } = workingRegistry(dir, ({ cwd }) => {
      writeFileSync(join(cwd, "c.txt"), "first\n");
      return "WROTE";
    }, store);
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    const first = await agentCall(door, "toolu_1", { run_in_background: false, description: "write", prompt: "write c.txt" });
    const id = String(/agent_id "(sa_[0-9a-f]{8})"/.exec(first.text)?.[1]);
    door.close();
    assert.equal(threads.size, kept ? 1 : 0);
    // A follow-up was writing when Filament went: its copy busy, what it wrote there alone.
    const cwd = posts[0].cwd;
    writeFileSync(join(cwd, "c.txt"), "second, cut by the restart\n");
    writeFileSync(join(git(cwd, "rev-parse", "--absolute-git-dir"), "filament.json"), JSON.stringify({ ...copyMeta(cwd), state: "busy" }));
    letGoOfCopies();
    const after = workingRegistry(dir, () => "never", store).registry;
    const c = await after.changes(id, "c1");
    assert.ok(c.ok, c.ok ? "" : c.error);
    assert.match(c.ok ? c.diff : "", /^\+second, cut by the restart$/m, `kept: ${kept}`);
    const applied = await after.apply(id, "c1", "owner");
    assert.ok(applied.ok, applied.ok ? "" : applied.error);
    assert.equal(read(join(dir, "c.txt")), "second, cut by the restart\n");
    assert.equal(copyState(cwd), "parked", "its copy kept, this Filament's now");
  }
});
