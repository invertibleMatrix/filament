// @ts-check
// A capture of a sparse checkout (the owner's plan of 11-09 for big repos, phase 2): the files outside its cone are not
// on disk, and a capture must keep them as the base has them — never record them deleted. A sparse copy of Filament's,
// and a developer's own folder that is a sparse checkout, against real throwaway repositories under the temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { plainIndex, snapshotTree } from "../src/adapters/git/snapshot.js";
import { folderSnapshot } from "../src/adapters/git/worktree.js";
import { skippedPaths } from "../src/adapters/git/sparse.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: ENV, windowsHide: true }).trim();
const SPARSE = ["-c", "core.sparseCheckout=true", "-c", "core.sparseCheckoutCone=true", "-c", "index.sparse=false"];

/** A repository with files in three folders and at the top. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sparse-"));
  made.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  for (const [p, s] of Object.entries({ "top.txt": "top\n", "a/x.txt": "x\n", "b/y.txt": "y\n", "c/w.txt": "w\n", "c/d/z.txt": "z\n" })) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), s);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** A sparse copy of `dir`'s HEAD holding `a/` alone, made as Filament makes one: no porcelain, nothing in the shared config. @param {string} dir */
const sparseCopy = (dir) => {
  const dest = mkdtempSync(join(tmpdir(), "filament-sparse-copy-"));
  rmSync(dest, { recursive: true, force: true });
  made.push(dest);
  git(dir, "worktree", "add", "-q", "--no-checkout", "--detach", dest, "HEAD");
  const record = resolve(dest, /** @type {string} */ (/^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(dest, ".git"), "utf8"))?.[1]));
  mkdirSync(join(record, "info"), { recursive: true });
  writeFileSync(join(record, "info", "sparse-checkout"), "/*\n!/*/\n/a/\n");
  git(dest, ...SPARSE, "read-tree", "-mu", "HEAD");
  return { dest, record };
};
/** What a capture changed against its parent, as `git diff --name-status` says it. @param {string} cwd @param {{ parent?: string | null, commit: string | null }} snap */
const changes = (cwd, snap) => (snap.commit ? git(cwd, "diff", "--name-status", "--no-renames", String(snap.parent), snap.commit) : "");

// (fails before: yes — plainIndex refused the copy's skip-worktree entries, the capture read HEAD into its index and
// `add -A` took every file outside the cone, not on disk, for deleted: D b/y.txt, D c/d/z.txt, D c/w.txt)
test("a sparse copy's capture keeps the files outside its cone as its base has them, and takes what changed inside it", async () => {
  const dir = repo();
  const { dest } = sparseCopy(dir);
  assert.deepEqual(git(dest, "ls-files", "-t").split("\n").sort(), ["H a/x.txt", "H top.txt", "S b/y.txt", "S c/d/z.txt", "S c/w.txt"]);
  writeFileSync(join(dest, "a", "x.txt"), "x, edited\n");
  writeFileSync(join(dest, "a", "new.txt"), "new\n");
  const snap = await snapshotTree(dest, { name: "sparse-1", keep: false });
  assert.ok(snap.ok, snap.error || "");
  assert.equal(changes(dest, snap), "A\ta/new.txt\nM\ta/x.txt");
  assert.equal(git(dest, "show", `${snap.commit}:c/d/z.txt`), "z");
});

// (fails before: yes — the same loss: what a command wrote outside the cone was there, the rest of the cone's outside
// recorded deleted)
test("a file a command wrote outside the cone is captured, the folder's other files kept", async () => {
  const dir = repo();
  const { dest } = sparseCopy(dir);
  mkdirSync(join(dest, "c", "d"), { recursive: true });
  writeFileSync(join(dest, "c", "d", "z.txt"), "z, by a command\n");
  mkdirSync(join(dest, "b"), { recursive: true });
  writeFileSync(join(dest, "b", "made.txt"), "made outside the cone\n");
  const snap = await snapshotTree(dest, { name: "sparse-2", keep: false });
  assert.ok(snap.ok, snap.error || "");
  assert.equal(changes(dest, snap), "A\tb/made.txt\nM\tc/d/z.txt");
  // Its own index is untouched: the outside of its cone stays outside.
  assert.match(git(dest, "ls-files", "-t", "--", "c/w.txt"), /^S /);
});

// (fails before: yes — the developer's own sparse checkout lost the same way: D b/y.txt, D c/d/z.txt)
test("a developer's own folder that is a sparse checkout snapshots whole: nothing outside its cone reads as deleted", async () => {
  const dir = repo();
  // Their own folder, their own porcelain: the developer set it up, as git's documentation says.
  git(dir, "sparse-checkout", "set", "a");
  assert.equal(git(dir, "ls-files", "-t", "--", "b/y.txt"), "S b/y.txt");
  writeFileSync(join(dir, "a", "x.txt"), "x, theirs\n");
  const snap = await folderSnapshot(dir, { name: "dev-sparse" });
  assert.ok(snap.ok, !snap.ok ? snap.error : "");
  assert.equal(git(dir, "diff", "--name-status", "--no-renames", "HEAD", snap.commit), "M\ta/x.txt");
  const nothing = await snapshotTree(dir, { name: "dev-sparse-2", keep: false, previous: snap.commit });
  assert.ok(nothing.ok && !nothing.changed, "the same folder again: the same tree");
});

// (fails before: yes — every version of the copy's index fell back to HEAD)
test("index versions 2 to 4: the skip-worktree paths are read from the bytes, and the capture stays whole on each", async () => {
  const dir = repo();
  const { dest, record } = sparseCopy(dir);
  writeFileSync(join(dest, "a", "x.txt"), "x2\n");
  for (const v of ["2", "3", "4"]) {
    git(dest, "update-index", "--index-version", v);
    const b = readFileSync(join(record, "index"));
    // Version 2 has no room for the flag: git writes 3 wherever an entry needs it.
    assert.equal(b.readUInt32BE(4), v === "2" ? 3 : Number(v));
    assert.equal(plainIndex(b), false, "a plain index has no skip-worktree entry");
    assert.equal(plainIndex(b, { skipWorktree: true }), true);
    assert.deepEqual(skippedPaths(b), ["b/y.txt", "c/d/z.txt", "c/w.txt"]);
    const snap = await snapshotTree(dest, { name: `sparse-v${v}`, keep: false });
    assert.ok(snap.ok, snap.error || "");
    assert.equal(changes(dest, snap), "M\ta/x.txt", `index version ${v}`);
  }
});

// (fails before: yes, each — the folder's index was no plain one, the capture read HEAD into its index and `add -A`
// took every file outside the cone for deleted, the snapshot saying ok)
/** @type {[string, (dir: string) => void][]} */
const flagged = [
  ["a sparse index", (dir) => git(dir, "sparse-checkout", "set", "--sparse-index", "a")],
  [
    "a split index",
    (dir) => {
      git(dir, "sparse-checkout", "set", "a");
      git(dir, "update-index", "--split-index");
    },
  ],
  [
    "a file assumed unchanged",
    (dir) => {
      git(dir, "sparse-checkout", "set", "a");
      git(dir, "update-index", "--assume-unchanged", "top.txt");
    },
  ],
];
for (const [what, setup] of flagged)
  test(`a developer's sparse checkout with ${what} snapshots whole, their index and git folder untouched`, async () => {
    const dir = repo();
    setup(dir);
    assert.equal(git(dir, "ls-files", "-t", "--", "b/y.txt"), "S b/y.txt");
    writeFileSync(join(dir, "a", "x.txt"), "x, theirs\n");
    writeFileSync(join(dir, "top.txt"), "top, theirs\n");
    mkdirSync(join(dir, "c"), { recursive: true });
    writeFileSync(join(dir, "c", "w.txt"), "w, by a command\n");
    const index = readFileSync(join(dir, ".git", "index"));
    const gitFolder = readdirSync(join(dir, ".git")).sort();
    const snap = await snapshotTree(dir, { name: "dev-flagged", keep: false });
    assert.ok(snap.ok, snap.error || "");
    assert.equal(changes(dir, snap), "M\ta/x.txt\nM\tc/w.txt\nM\ttop.txt");
    assert.ok(readFileSync(join(dir, ".git", "index")).equals(index), "their index untouched");
    assert.deepEqual(readdirSync(join(dir, ".git")).sort(), gitFolder, "nothing new in their git folder");
  });

// (fails before: yes — the update-index that clears a written file's skip-worktree bit wrote a split index, its shared
// part in the repository's git folder)
test("a repository that sets core.splitIndex: a sparse capture leaves no shared index in its git folder", async () => {
  const dir = repo();
  git(dir, "sparse-checkout", "set", "a");
  git(dir, "config", "core.splitIndex", "true");
  const shared = () => readdirSync(join(dir, ".git")).filter((n) => n.startsWith("sharedindex.")).sort();
  const had = shared();
  mkdirSync(join(dir, "b"), { recursive: true });
  writeFileSync(join(dir, "b", "y.txt"), "y, by a command\n");
  const snap = await snapshotTree(dir, { name: "split-config", keep: false });
  assert.ok(snap.ok, snap.error || "");
  assert.equal(changes(dir, snap), "M\tb/y.txt");
  assert.deepEqual(shared(), had);
});

// (fails before: no — the update-index that clears a written file's skip-worktree bit rewrites the temporary index
// stamped now, but git smudges each racily clean entry as it writes, against the seeded time; fails where the seed
// takes its own time — a mutant, 11-09)
test("a file saved in the same instant as a sparse checkout's index is read again, a file written outside its cone beside it", async () => {
  const dir = repo();
  git(dir, "sparse-checkout", "set", "a");
  mkdirSync(join(dir, "b"), { recursive: true });
  writeFileSync(join(dir, "b", "y.txt"), "y, by a command\n");
  const file = join(dir, "a", "x.txt");
  const t = Math.floor(Date.now() / 1000) - 60;
  writeFileSync(file, "aaaa\n");
  utimesSync(file, t, t);
  git(dir, "add", "a/x.txt");
  utimesSync(join(dir, ".git", "index"), t, t);
  writeFileSync(file, "bbbb\n");
  utimesSync(file, t, t);
  const snap = await snapshotTree(dir, { name: "sparse-racy", keep: false });
  assert.ok(snap.ok, snap.error || "");
  assert.equal(git(dir, "show", `${snap.commit}:a/x.txt`), "bbbb");
  assert.equal(git(dir, "show", `${snap.commit}:b/y.txt`), "y, by a command");
});

// (fails before: yes on a disk that tells no cases apart — the folder's listing was matched by exact name, so the file
// stayed skip-worktree and git took the command's write for the tracked file it is. A developer's own sparse checkout
// is spared: git (2.37 on) clears the bit itself where core.sparseCheckout is in its configuration, never a copy's)
test("a file a command wrote outside a sparse copy's cone under another case of its name is taken, where the disk tells no cases apart", async (t) => {
  const dir = repo();
  if (!existsSync(join(dir, "TOP.TXT"))) return t.skip("this disk tells cases apart");
  git(dir, "mv", "b/y.txt", "b/Y.txt");
  git(dir, "commit", "-qm", "Y");
  const { dest } = sparseCopy(dir);
  mkdirSync(join(dest, "b"), { recursive: true });
  writeFileSync(join(dest, "b", "y.txt"), "y, by a command\n");
  const snap = await snapshotTree(dest, { name: "sparse-case", keep: false });
  assert.ok(snap.ok, snap.error || "");
  assert.equal(changes(dest, snap), "M\tb/Y.txt");
  assert.equal(git(dest, "show", `${snap.commit}:b/Y.txt`), "y, by a command");
});

// (fails before: yes — a SHA-256 repository's index was never seeded from, and the capture read HEAD into its index)
test("a SHA-256 repository's sparse checkout snapshots whole", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sparse-256-"));
  made.push(dir);
  git(dir, "init", "-q", "-b", "main", "--object-format=sha256");
  git(dir, "config", "core.autocrlf", "false");
  for (const [p, s] of Object.entries({ "top.txt": "top\n", "a/x.txt": "x\n", "b/y.txt": "y\n", "c/w.txt": "w\n" })) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), s);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  git(dir, "sparse-checkout", "set", "a");
  writeFileSync(join(dir, "a", "x.txt"), "x, theirs\n");
  mkdirSync(join(dir, "c"), { recursive: true });
  writeFileSync(join(dir, "c", "w.txt"), "w, by a command\n");
  const snap = await snapshotTree(dir, { name: "sparse-256", keep: false });
  assert.ok(snap.ok, snap.error || "");
  assert.equal(changes(dir, snap), "M\ta/x.txt\nM\tc/w.txt");
  assert.deepEqual(skippedPaths(readFileSync(join(dir, ".git", "index")), { idBytes: 32 }), ["b/y.txt", "c/w.txt"]);
});

test("skippedPaths: an index with none says none; bytes that are no index say null", () => {
  const dir = repo();
  const b = readFileSync(join(dir, ".git", "index"));
  assert.deepEqual(skippedPaths(b), []);
  assert.equal(skippedPaths(Buffer.from("not an index at all, not at all")), null);
});
