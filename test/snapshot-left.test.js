// @ts-check
// What a snapshot leaves out so that it can be taken at all (src/adapters/git/snapshot.js `snapshotTree`). Git's add of
// a work tree fails whole on two folders: a junction to a folder it lies in, which Git for Windows walks as a folder,
// round and round until a path is too long for it; and a repository of its own with no commit yet ("does not have a
// commit checked out"). Either one left every snapshot of its project untaken. Each is left out now, and said in the
// snapshot's answer (`left`), which a copy sent to another machine says on (src/adapters/git/send.js `bundleSnapshot`).
// Every repository here is a throwaway under the temp folder — never this one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleSnapshot } from "../src/adapters/git/send.js";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { gitRuns } from "./helpers/git-runs.js";

const hasGit = spawnSync("git", ["--version"], { stdio: "ignore", windowsHide: true }).status === 0;
const GIT = { skip: !hasGit && "git is not on PATH" };
const JUNCTIONS = { skip: (!hasGit && "git is not on PATH") || (process.platform !== "win32" && "junctions are Windows' own") };

/** @param {string} cwd @param {...string} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
/** A file's name longer than any folder's here: git's walk through a junction ends on a path it cannot open. */
const LONG = "a-file-whose-name-is-longer-than-any-folder-here-0123456789.txt";
/**
 * A project of three committed files, as long paths are not taken (git's own default).
 * @param {import("node:test").TestContext} t
 */
const project = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-snapshot-left-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  gitIn(dir, "init", "-q", "-b", "main");
  gitIn(dir, "config", "core.longpaths", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "a.txt"), "one\n");
  writeFileSync(join(dir, "src", "b.txt"), "two\n");
  writeFileSync(join(dir, "src", LONG), "three\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "first");
  return dir;
};
/** A tree's entries, each `mode path`. @param {string} dir @param {string | null} tree */
const entriesOf = (dir, tree) =>
  gitIn(dir, "ls-tree", "-r", String(tree))
    .split("\n")
    .filter(Boolean)
    .map((l) => `${l.split(" ")[0]} ${l.split("\t")[1]}`);
const COMMITTED = ["100644 a.txt", `100644 src/${LONG}`, "100644 src/b.txt"];

// (fails before: yes — `ok: false`, "git add failed: error: open("loop/loop/…"): Filename too long": no snapshot of
// the project at all)
test("a junction to the project's own top: the snapshot is taken without it, and says so", JUNCTIONS, async (t) => {
  const dir = project(t);
  symlinkSync(dir, join(dir, "loop"), "junction");
  writeFileSync(join(dir, "new.txt"), "new\n");
  const s = await snapshotTree(dir, { name: "left", keep: false });
  assert.deepEqual([s.ok, s.error], [true, null]);
  assert.deepEqual(entriesOf(dir, s.tree), ["100644 a.txt", "100644 new.txt", `100644 src/${LONG}`, "100644 src/b.txt"], "the project's files and the new one; nothing through the junction");
  assert.deepEqual(s.left, [{ path: "loop", kind: "link" }]);
});

// (fails before: yes — `ok: false`, "git add failed: …": one in a folder git tracks, and one in a new folder, which
// git names by the new folder alone)
test("a junction to a folder it lies in, in a folder git tracks and in a new one: each is left out by its own path, what lies beside it taken", JUNCTIONS, async (t) => {
  const dir = project(t);
  symlinkSync(dir, join(dir, "src", "up"), "junction");
  mkdirSync(join(dir, "fresh", "deep"), { recursive: true });
  writeFileSync(join(dir, "fresh", LONG), "new\n");
  writeFileSync(join(dir, "fresh", "deep", "c.txt"), "new\n");
  symlinkSync(join(dir, "fresh"), join(dir, "fresh", "deep", "round"), "junction");
  const s = await snapshotTree(dir, { name: "left", keep: false });
  assert.deepEqual([s.ok, s.error], [true, null]);
  assert.deepEqual(entriesOf(dir, s.tree), ["100644 a.txt", `100644 fresh/${LONG}`, "100644 fresh/deep/c.txt", `100644 src/${LONG}`, "100644 src/b.txt"]);
  assert.deepEqual(s.left, [
    { path: "fresh/deep/round", kind: "link" },
    { path: "src/up", kind: "link" },
  ]);
});

// (fails before: yes — `ok: false`, "git add failed: error: 'made/' does not have a commit checked out")
test("a repository of its own with no commit yet, in the project and in a new folder of it: the snapshot is taken without them, and says so", GIT, async (t) => {
  const dir = project(t);
  mkdirSync(join(dir, "made"));
  gitIn(join(dir, "made"), "init", "-q");
  writeFileSync(join(dir, "made", "m.txt"), "its own\n");
  mkdirSync(join(dir, "scratch", "inner"), { recursive: true });
  gitIn(join(dir, "scratch", "inner"), "init", "-q");
  writeFileSync(join(dir, "scratch", "keep.txt"), "new\n");
  const s = await snapshotTree(dir, { name: "left", keep: false });
  assert.deepEqual([s.ok, s.error], [true, null]);
  assert.deepEqual(entriesOf(dir, s.tree), [...COMMITTED.slice(0, 1), "100644 scratch/keep.txt", ...COMMITTED.slice(1)]);
  assert.deepEqual(s.left, [
    { path: "made", kind: "repository" },
    { path: "scratch/inner", kind: "repository" },
  ]);
  // Its first commit made, git takes it as a repository of its own, and nothing is left out for it.
  gitIn(join(dir, "made"), "add", "-A");
  gitIn(join(dir, "made"), "commit", "-q", "-m", "its first");
  const next = await snapshotTree(dir, { name: "left", keep: false });
  assert.equal(next.ok, true, String(next.error));
  assert.ok(entriesOf(dir, next.tree).includes("160000 made"), "a repository with a commit is taken by its commit");
  assert.deepEqual(next.left, [{ path: "scratch/inner", kind: "repository" }]);
});

// (fails before: no — a guard: a project with neither is asked nothing more, and its answer names nothing left out)
test("a project with nothing to leave out: the snapshot asks git what it asked, and names nothing left", GIT, async (t) => {
  const dir = project(t);
  mkdirSync(join(dir, "fresh"));
  writeFileSync(join(dir, "fresh", "c.txt"), "new\n");
  const { out: s, runs } = await gitRuns(() => snapshotTree(dir, { name: "left", keep: false }));
  assert.equal(s.ok, true, String(s.error));
  assert.equal("left" in s, false);
  assert.deepEqual(runs.filter((r) => r[0] === "add" || r[0] === "ls-files").map((r) => r[0]), ["add"], "one add, and no listing of what git does not track");
});

// (fails before: yes — `ok: false`, "git add failed: …": no copy of the project could be sent)
test("a copy sent to another machine names them with what else stays here", GIT, async (t) => {
  const dir = project(t);
  mkdirSync(join(dir, "made"));
  gitIn(join(dir, "made"), "init", "-q");
  if (process.platform === "win32") symlinkSync(dir, join(dir, "loop"), "junction");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p" });
  assert.ok(b.ok, b.ok ? "" : b.error);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  assert.deepEqual(entriesOf(dir, b.commit), COMMITTED);
  assert.deepEqual(b.left, [...(process.platform === "win32" ? [{ path: "loop", why: "a junction: what it leads to is not sent" }] : []), { path: "made", why: "a repository of its own: none is sent yet" }]);
});
