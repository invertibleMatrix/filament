// @ts-check
// A snapshot's temporary index starts as a copy of the repository's own (HarnessV4_Worktrees_Plan W2), so git re-reads
// only the files whose size or time moved: the same tree as an index read from HEAD gives, in every state a working
// tree is in; a file saved in the same instant as the index is still read; the setups where a copy would miss a file
// — skip-worktree, assume-unchanged — and a split index give the tree from HEAD as before.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainIndex, snapshotTree } from "../src/adapters/git/snapshot.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args @param {Record<string, string>} [extra] */
const git = (cwd, args, extra = {}) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...ENV, ...extra } }).trim();
/** A repository with files at its top and in a folder, `*.log` ignored. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-seed-"));
  made.push(dir);
  git(dir, ["init", "-q"]);
  git(dir, ["config", "core.autocrlf", "false"]);
  writeFileSync(join(dir, ".gitignore"), "*.log\n");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  writeFileSync(join(dir, "b.txt"), "bee\n");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "c.txt"), "sea\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "init"]);
  return dir;
};
/** The tree the way before seeding gives it: an index read from HEAD, then `add -A`. @param {string} dir */
const fromHead = (dir) => {
  const t = mkdtempSync(join(tmpdir(), "filament-ref-index-"));
  made.push(t);
  const e = { GIT_INDEX_FILE: join(t, "index") };
  git(dir, ["read-tree", "HEAD"], e);
  git(dir, ["add", "-A", "--", "."], e);
  return git(dir, ["write-tree"], e);
};
/** @param {string} dir @param {string} name */
const snap = async (dir, name) => {
  const s = await snapshotTree(dir, { name, keep: false });
  assert.ok(s.ok, s.error || "");
  return String(s.tree);
};
/** @param {string} dir */
const indexOf = (dir) => join(dir, ".git", "index");
/** What a file holds in a tree. @param {string} dir @param {string} tree @param {string} path */
const inTree = (dir, tree, path) => git(dir, ["cat-file", "-p", `${tree}:${path}`]);

// (fails before: no — the same trees; what moved is how many files git reads, measured in W4)
test("seeded from the repository's own index, a snapshot is the tree an index read from HEAD gives, in each state a working tree can be in, and the developer's index is never written", async () => {
  const dir = repo();
  assert.equal(plainIndex(readFileSync(indexOf(dir))), true, "a plain index: the snapshot seeds from it");
  const before = readFileSync(indexOf(dir));
  const at = statSync(indexOf(dir)).mtimeMs;
  /** @type {[string, () => void][]} */
  const steps = [
    ["an edit", () => writeFileSync(join(dir, "a.txt"), "one\ntwo, edited\n")],
    ["a new file", () => writeFileSync(join(dir, "new.txt"), "new\n")],
    ["a deletion", () => unlinkSync(join(dir, "b.txt"))],
    ["a rename", () => renameSync(join(dir, "sub", "c.txt"), join(dir, "sub", "d.txt"))],
    ["an ignored file", () => writeFileSync(join(dir, "out.log"), "noise\n")],
    ["a touch, nothing changed", () => utimesSync(join(dir, "new.txt"), new Date(), new Date())],
  ];
  for (const [what, step] of steps) {
    step();
    assert.equal(await snap(dir, "s"), fromHead(dir), what);
  }
  assert.deepEqual([readFileSync(indexOf(dir)).equals(before), statSync(indexOf(dir)).mtimeMs], [true, at], "the developer's index untouched");
  // A change staged, then edited again: the snapshot is the file as it stands, as before.
  writeFileSync(join(dir, "a.txt"), "staged\n");
  git(dir, ["add", "a.txt"]);
  writeFileSync(join(dir, "a.txt"), "as it stands\n");
  const tree = await snap(dir, "staged");
  assert.deepEqual([tree, inTree(dir, tree, "a.txt")], [fromHead(dir), "as it stands"]);
  // A version 4 index (paths kept short) is read the same.
  git(dir, ["update-index", "--index-version", "4"]);
  writeFileSync(join(dir, "sub", "e.txt"), "e\n");
  assert.equal(plainIndex(readFileSync(indexOf(dir))), true);
  assert.equal(await snap(dir, "v4"), fromHead(dir));
});

// (fails where the copy takes its own time — a mutant in a mirror, 10-22: the seeded index took the file for unchanged)
test("a file saved in the same instant as the index is read again: the copy keeps the index's time", async () => {
  const dir = repo();
  const file = join(dir, "r.txt");
  const t = Math.floor(Date.now() / 1000) - 60;
  writeFileSync(file, "aaaa\n");
  utimesSync(file, t, t);
  git(dir, ["add", "r.txt"]);
  // The index stamped with the file's own instant: git cannot trust that entry's time, and reads the file.
  utimesSync(indexOf(dir), t, t);
  writeFileSync(file, "bbbb\n");
  utimesSync(file, t, t);
  const tree = await snap(dir, "racy");
  assert.deepEqual([inTree(dir, tree, "r.txt"), tree], ["bbbb", fromHead(dir)]);
});

// (fails before: no for the trees — they started from HEAD; since 11-09 git rewrites such an index whole in the copy,
// its assume-unchanged bits cleared, and the guards keep the trees the same)
test("skip-worktree, assume-unchanged and a split index give the tree from HEAD: the file as it stands, and nothing new in the git folder", async () => {
  for (const flag of ["--skip-worktree", "--assume-unchanged"]) {
    const dir = repo();
    git(dir, ["update-index", flag, "a.txt"]);
    writeFileSync(join(dir, "a.txt"), `changed under ${flag}\n`);
    assert.equal(plainIndex(readFileSync(indexOf(dir))), false, flag);
    const tree = await snap(dir, "flagged");
    assert.deepEqual([inTree(dir, tree, "a.txt"), tree], [`changed under ${flag}`, fromHead(dir)], flag);
  }
  const dir = repo();
  git(dir, ["update-index", "--split-index"]);
  const shared = () => readdirSync(join(dir, ".git")).filter((n) => n.startsWith("sharedindex.")).sort();
  const had = shared();
  assert.ok(had.length >= 1, "a split index keeps its shared part beside it");
  assert.equal(plainIndex(readFileSync(indexOf(dir))), false, "its link is an extension git must understand");
  writeFileSync(join(dir, "b.txt"), "changed\n");
  assert.equal(await snap(dir, "split"), fromHead(dir));
  assert.deepEqual(shared(), had, "no shared part of Filament's in the repository's git folder");
});

test("an index that is not one, or cut short, is not seeded from", () => {
  assert.equal(plainIndex(Buffer.from("not an index at all, but long enough")), false);
  const dir = repo();
  const b = readFileSync(indexOf(dir));
  assert.equal(plainIndex(b.subarray(0, b.length - 30)), false);
});
