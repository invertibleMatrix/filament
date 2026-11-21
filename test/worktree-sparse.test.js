// @ts-check
// Sparse copies for a big repository's editing helpers (the owner's plan of 11-09 for big repos, phase 2): a copy that
// holds its cone alone — the session folder's place, what changed, the paths it is given —, made without git's
// porcelain so the repository's shared configuration never changes; captured whole; taken only for a copy of its kind;
// widened by `filament workspace widen`. Real throwaway repositories under the temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureTaskWork, letGoOfCopies, isBigRepo, openTaskWorktree, pruneTaskWorktrees, releaseTaskWorktree, reviveTaskWorktree, taskRefs, taskWorkSoFar, taskWorktreePath, widenTaskWorktree,
} from "../src/adapters/git/worktree.js";
import { bigRepo, BIG_ENTRIES, conePatterns, indexEntries, readCone } from "../src/adapters/git/sparse.js";
import { runCli } from "../src/cli/main.js";
import { copyMeta } from "./helpers/copies.js";

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
const FILES = {
  "package.json": "{}\n",
  "README.md": "readme\n",
  "pkg/package.json": "{}\n",
  "pkg/a/index.js": "a\n",
  "pkg/a/util.js": "a util\n",
  "pkg/b/index.js": "b\n",
  "pkg/b/more.js": "b more\n",
  "lib/c/x.js": "x\n",
  "lib/c/y.js": "y\n",
  "docs/d/guide.md": "guide\n",
  "docs/d/more.md": "more\n",
  "tools/e/run.js": "run\n",
  "tools/e/two.js": "two\n",
};
/** A repository of five folders' files, the session's folder pkg/a. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-wt-sparse-"));
  made.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  for (const [p, s] of Object.entries(FILES)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), s);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** The files a copy holds on disk, its git file and links left out. @param {string} dest */
const onDisk = (dest) => git(dest, "ls-files", "-t").split("\n").filter((l) => l.startsWith("H ")).map((l) => l.slice(2)).sort();
/** The shared configuration's bytes, and whether any per-worktree configuration was switched on. @param {string} dir */
const sharedConfig = (dir) => ({ bytes: readFileSync(join(dir, ".git", "config"), "utf8"), worktreeConfig: existsSync(join(dir, ".git", "config.worktree")) });

test("a sparse copy holds the session folder and the paths it is given, the top's and parent folders' files — and the shared config's bytes never change", async () => {
  const dir = repo();
  const before = sharedConfig(dir);
  const o = await openTaskWorktree(join(dir, "pkg", "a"), { id: "sa_sparse01", kind: "sparse", paths: ["lib/c/x.js", "docs/nothing-here"] });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  assert.equal(wt.kind, "sparse");
  assert.equal(wt.workdir, join(wt.dest, "pkg", "a"));
  assert.deepEqual(onDisk(wt.dest), ["README.md", "lib/c/x.js", "lib/c/y.js", "package.json", "pkg/a/index.js", "pkg/a/util.js", "pkg/package.json"]);
  assert.ok(!existsSync(join(wt.dest, "pkg", "b")) && !existsSync(join(wt.dest, "tools")), "nothing outside the cone is on disk");
  const meta = copyMeta(wt.dest);
  assert.equal(/** @type {any} */ (meta)?.kind, "sparse");
  assert.deepEqual(/** @type {any} */ (meta)?.cone, ["lib/c", "pkg/a"]);
  // The developer's own folder and configuration: as they were, byte for byte.
  assert.deepEqual(sharedConfig(dir), before);
  assert.equal(git(dir, "status", "--porcelain"), "");
  assert.equal(git(dir, "ls-files", "-t", "--", "pkg/b/index.js"), "H pkg/b/index.js", "the developer's index has no skip-worktree entry");
  await releaseTaskWorktree(wt, "free");
});

test("its capture and its work so far keep the files outside the cone; a crash's orphan keeps them too", async () => {
  const dir = repo();
  const before = sharedConfig(dir);
  const id = "sa_sparse02";
  const o = await openTaskWorktree(join(dir, "pkg", "a"), { id, kind: "sparse" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  writeFileSync(join(wt.dest, "pkg", "a", "index.js"), "a, by the helper\n");
  // A command that wrote where the cone does not reach: its file is taken, its folder's others kept.
  mkdirSync(join(wt.dest, "tools", "e"), { recursive: true });
  writeFileSync(join(wt.dest, "tools", "e", "run.js"), "run, by a command\n");
  const so = await taskWorkSoFar(wt, { id });
  assert.ok(so.ok, !so.ok ? so.error : "");
  assert.deepEqual(so.files.map((f) => `${f.status} ${f.path}`), ["M pkg/a/index.js", "M tools/e/run.js"]);
  const cap = await captureTaskWork(wt, { id });
  assert.ok(cap.ok, !cap.ok ? cap.error : "");
  assert.deepEqual(cap.files.map((f) => `${f.status} ${f.path}`), ["M pkg/a/index.js", "M tools/e/run.js"]);
  // A second exchange, cut by a crash: its orphan's work goes onto its refs, the outside of its cone kept.
  writeFileSync(join(wt.dest, "pkg", "a", "util.js"), "util, before the crash\n");
  letGoOfCopies();
  await pruneTaskWorktrees(dir);
  const refs = await taskRefs(dir, id);
  assert.ok(refs);
  assert.equal(git(dir, "diff", "--name-status", "--no-renames", refs.base, refs.head), "M\tpkg/a/index.js\nM\tpkg/a/util.js\nM\ttools/e/run.js");
  assert.deepEqual(sharedConfig(dir), before);
});

test("a cone of half the entries or more, or one nothing names, is checked out whole", async () => {
  const dir = repo();
  const wide = await openTaskWorktree(join(dir, "pkg", "a"), { id: "sa_sparse03", kind: "sparse", paths: ["pkg/b", "lib", "docs", "tools"] });
  assert.ok(wide.ok, !wide.ok ? wide.error : "");
  assert.equal(wide.wt.kind, "worktree");
  assert.equal(onDisk(wide.wt.dest).length, Object.keys(FILES).length);
  assert.equal(/** @type {any} */ (copyMeta(wide.wt.dest))?.kind, "worktree");
  await releaseTaskWorktree(wide.wt, "parked");
  // The session at the top, and no path given: nothing says where its work is.
  const top = await openTaskWorktree(dir, { id: "sa_sparse04", kind: "sparse" });
  assert.ok(top.ok, !top.ok ? top.error : "");
  assert.equal(top.wt.kind, "worktree");
  assert.equal(onDisk(top.wt.dest).length, Object.keys(FILES).length);
  await releaseTaskWorktree(top.wt, "parked");
});

test("a free copy is taken only for a copy of its kind, a sparse one with the new taking's cone", async () => {
  const dir = repo();
  const first = await openTaskWorktree(join(dir, "pkg", "a"), { id: "sa_sparse05", kind: "sparse" });
  assert.ok(first.ok, !first.ok ? first.error : "");
  await releaseTaskWorktree(first.wt, "free");
  // A whole copy is not made from it: the sparse one stays where it is, free.
  const whole = await openTaskWorktree(join(dir, "pkg", "a"), { id: "sa_sparse06" });
  assert.ok(whole.ok, !whole.ok ? whole.error : "");
  assert.equal(onDisk(whole.wt.dest).length, Object.keys(FILES).length);
  assert.ok(existsSync(first.wt.dest), "the sparse copy was not taken for a whole one");
  // A sparse one is: moved to its place, its cone this taking's.
  const second = await openTaskWorktree(join(dir, "lib", "c"), { id: "sa_sparse07", kind: "sparse" });
  assert.ok(second.ok, !second.ok ? second.error : "");
  assert.ok(!existsSync(first.wt.dest), "the free sparse copy was moved to the new place");
  assert.deepEqual(onDisk(second.wt.dest), ["README.md", "lib/c/x.js", "lib/c/y.js", "package.json"]);
  assert.ok(!existsSync(join(second.wt.dest, "pkg", "a")), "the last taking's cone left its disk");
  assert.deepEqual(/** @type {any} */ (copyMeta(second.wt.dest))?.cone, ["lib/c"]);
  await releaseTaskWorktree(second.wt, "parked");
  await releaseTaskWorktree(whole.wt, "parked");
});

test("widening brings a folder in and moves nothing the helper changed; its next question keeps the cone it widened to", async () => {
  const dir = repo();
  const before = sharedConfig(dir);
  const id = "sa_sparse08";
  const o = await openTaskWorktree(join(dir, "pkg", "a"), { id, kind: "sparse" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  writeFileSync(join(wt.dest, "pkg", "a", "index.js"), "a, staged\n");
  git(wt.dest, "add", "pkg/a/index.js");
  writeFileSync(join(wt.dest, "pkg", "a", "util.js"), "util, changed on disk\n");
  // Written by a command before it widened: kept as it stands, the folder's other file brought in.
  mkdirSync(join(wt.dest, "pkg", "b"), { recursive: true });
  writeFileSync(join(wt.dest, "pkg", "b", "index.js"), "b, by a command\n");
  const w = await widenTaskWorktree(wt.workdir, ["../b/more.js", join(wt.dest, "docs", "d")]);
  assert.ok(w.ok, !w.ok ? w.error : "");
  assert.deepEqual(w.added, ["docs/d", "pkg/b"]);
  assert.equal(readFileSync(join(wt.dest, "pkg", "b", "more.js"), "utf8"), "b more\n");
  assert.equal(readFileSync(join(wt.dest, "pkg", "b", "index.js"), "utf8"), "b, by a command\n");
  assert.equal(readFileSync(join(wt.dest, "docs", "d", "guide.md"), "utf8"), "guide\n");
  assert.equal(readFileSync(join(wt.dest, "pkg", "a", "index.js"), "utf8"), "a, staged\n");
  assert.equal(git(wt.dest, "diff", "--cached", "--name-only"), "pkg/a/index.js", "what it staged is staged still");
  assert.equal(readFileSync(join(wt.dest, "pkg", "a", "util.js"), "utf8"), "util, changed on disk\n");
  assert.deepEqual(/** @type {any} */ (copyMeta(wt.dest))?.cone, ["docs/d", "pkg/a", "pkg/b"]);
  // Asked again: nothing to add. Asked for what the commit has not, or outside the copy: said.
  const again = await widenTaskWorktree(wt.workdir, ["../b"]);
  assert.ok(again.ok && again.added.length === 0);
  const none = await widenTaskWorktree(wt.workdir, ["../nothing"]);
  assert.ok(!none.ok && /has no pkg\/nothing/.test(none.error));
  const out = await widenTaskWorktree(wt.workdir, [dir]);
  assert.ok(!out.ok && /outside this copy/.test(out.error));
  const cap = await captureTaskWork(wt, { id });
  assert.ok(cap.ok, !cap.ok ? cap.error : "");
  assert.deepEqual(cap.files.map((f) => `${f.status} ${f.path}`), ["M pkg/a/index.js", "M pkg/a/util.js", "M pkg/b/index.js"]);
  await releaseTaskWorktree(wt, "parked");
  // Its next question: its parked copy reset where it stands, its cone as it widened it.
  const back = await reviveTaskWorktree(join(dir, "pkg", "a"), { id, base: wt.base, head: cap.head, kind: "sparse" });
  assert.ok(back.ok, !back.ok ? back.error : "");
  assert.equal(back.wt.dest, wt.dest);
  assert.deepEqual(readCone(/** @type {string} */ (join(dir, ".git", "worktrees", id))), ["docs/d", "pkg/a", "pkg/b"]);
  assert.equal(readFileSync(join(back.wt.dest, "pkg", "b", "index.js"), "utf8"), "b, by a command\n");
  assert.deepEqual(sharedConfig(dir), before);
  await releaseTaskWorktree(back.wt, "parked");
});

test("filament workspace widen runs on the copy it is in; a copy that holds every file, or a folder that is no copy, says so", async () => {
  const dir = repo();
  const o = await openTaskWorktree(join(dir, "pkg", "a"), { id: "sa_sparse09", kind: "sparse" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  /** @type {string[]} */
  const said = [];
  /** @type {string[]} */
  const errs = [];
  const io = { dataDir: join(dir, ".no-data"), out: (/** @type {string} */ s) => said.push(s), err: (/** @type {string} */ s) => errs.push(s) };
  assert.equal(await runCli(["workspace", "widen", "tools/e", "--folder", o.wt.dest], io), 0);
  assert.match(said.at(-1) || "", /Brought in tools\/e\//);
  assert.ok(existsSync(join(o.wt.dest, "tools", "e", "run.js")));
  assert.equal(await runCli(["workspace", "widen", "--folder", o.wt.dest], io), 2, "no folder named: typed wrong");
  assert.equal(await runCli(["workspace", "widen", "lib", "--folder", dir], io), 1, "the developer's folder is no copy");
  assert.match(errs.at(-1) || "", /not in a copy Filament made/);
  await releaseTaskWorktree(o.wt, "parked");
  const whole = await openTaskWorktree(join(dir, "pkg", "a"), { id: "sa_sparse10" });
  assert.ok(whole.ok, !whole.ok ? whole.error : "");
  assert.equal(await runCli(["workspace", "widen", "lib", "--folder", whole.wt.workdir, "--json"], io), 0);
  assert.equal(JSON.parse(said.at(-1) || "{}").whole, true);
  await releaseTaskWorktree(whole.wt, "parked");
});

test("a sparse copy cut before its index was written counts as half made, and goes", async () => {
  const dir = repo();
  const dest = /** @type {string} */ (await taskWorktreePath(dir, "sa_half"));
  mkdirSync(join(dest, ".."), { recursive: true });
  git(dir, "worktree", "add", "-q", "--no-checkout", "--detach", dest, "HEAD");
  assert.ok(existsSync(dest));
  await pruneTaskWorktrees(dir);
  assert.ok(!existsSync(dest), "a checkout with no index is no copy to keep");
});

test("a big repository: a slow checkout, many entries in its index, or files stored with LFS", async () => {
  const dir = repo();
  assert.equal(await bigRepo(dir), null);
  assert.equal(await isBigRepo(dir), null);
  assert.equal(await bigRepo(dir, { checkoutMs: 5_000 }), "slow");
  // Many entries, as an index holds them: one blob under BIG_ENTRIES + 1 names, written in one run.
  const many = mkdtempSync(join(tmpdir(), "filament-wt-big-"));
  made.push(many);
  git(many, "init", "-q");
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: many, input: "same\n", encoding: "utf8" }).trim();
  const lines = Array.from({ length: BIG_ENTRIES + 1 }, (_, i) => `100644 ${blob}\tf/${i}.txt`).join("\n");
  execFileSync("git", ["update-index", "--index-info"], { cwd: many, input: `${lines}\n`, env: ENV });
  assert.equal(await bigRepo(many, { commit: "HEAD" }), "entries");
  // LFS: told by the attributes the commit holds, git-lfs installed or not.
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
  git(dir, "add", "-A");
  git(dir, "-c", "core.hooksPath=.no-hooks", "commit", "-qm", "lfs");
  assert.equal(await bigRepo(dir), "lfs");
  assert.equal(await isBigRepo(join(dir, "pkg")), "lfs");
});

// (fails before: yes — Filament's own read-tree wrote the copy's index split, and once split, by its own git or the
// helper's, its capture read HEAD into its index and took every file outside the cone for deleted)
test("a repository that sets core.splitIndex: a sparse copy's capture and widen keep the outside of its cone and what a command wrote there", async () => {
  const dir = repo();
  git(dir, "config", "core.splitIndex", "true");
  const id = "sa_sparse11";
  const o = await openTaskWorktree(join(dir, "pkg", "a"), { id, kind: "sparse" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  const { wt } = o;
  assert.ok(!readFileSync(join(dir, ".git", "worktrees", id, "index")).includes("link"), "Filament's own git writes the copy's index whole");
  writeFileSync(join(wt.dest, "pkg", "a", "index.js"), "a, by the helper\n");
  mkdirSync(join(wt.dest, "tools", "e"), { recursive: true });
  writeFileSync(join(wt.dest, "tools", "e", "run.js"), "run, by a command\n");
  // The helper's own git reads the repository's configuration: its index is split from here on.
  git(wt.dest, "add", "pkg/a/index.js");
  assert.ok(readFileSync(join(dir, ".git", "worktrees", id, "index")).includes("link"));
  const cap = await captureTaskWork(wt, { id });
  assert.ok(cap.ok, !cap.ok ? cap.error : "");
  assert.deepEqual(cap.files.map((f) => `${f.status} ${f.path}`), ["M pkg/a/index.js", "M tools/e/run.js"]);
  const w = await widenTaskWorktree(wt.workdir, ["../../tools/e"]);
  assert.ok(w.ok, !w.ok ? w.error : "");
  assert.equal(readFileSync(join(wt.dest, "tools", "e", "run.js"), "utf8"), "run, by a command\n");
  assert.equal(readFileSync(join(wt.dest, "tools", "e", "two.js"), "utf8"), "two\n");
  await releaseTaskWorktree(wt, "parked");
});

// (fails before: yes — the header of a split index counts what moved since its shared part, a sparse index's a folder
// outside its cone as one entry: neither was big)
for (const how of ["split", "sparse"])
  test(`a big repository's ${how} index is counted whole`, async () => {
    const many = mkdtempSync(join(tmpdir(), "filament-wt-big-"));
    made.push(many);
    git(many, "init", "-q");
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: many, input: "same\n", encoding: "utf8" }).trim();
    const lines = Array.from({ length: BIG_ENTRIES + 1 }, (_, i) => `100644 ${blob}\tf/${i}.txt`).join("\n");
    execFileSync("git", ["update-index", "--index-info"], { cwd: many, input: `${lines}\n100644 ${blob}\ta/x.txt\n`, env: ENV });
    git(many, "commit", "-qm", "many");
    if (how === "split") git(many, "update-index", "--split-index");
    else git(many, "sparse-checkout", "set", "--sparse-index", "a");
    assert.ok(Number(await indexEntries(join(many, ".git", "index"))) < BIG_ENTRIES, "its header counts fewer");
    assert.equal(await bigRepo(many), "entries");
  });

// (fails before: no — `**/` matches no folder too; pinned)
test("files stored with LFS by the top's .gitattributes make a repository big", async () => {
  const dir = repo();
  writeFileSync(join(dir, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
  git(dir, "add", "-A");
  git(dir, "-c", "core.hooksPath=.no-hooks", "commit", "-qm", "lfs");
  assert.equal(await bigRepo(dir), "lfs");
});

test("cone patterns are git's own cone form: the top, each parent folder's own files, each folder whole, glob characters escaped", () => {
  assert.equal(conePatterns(["pkg/a", "lib", "pkg/a/deeper", "x*y"]), "/*\n!/*/\n/pkg/\n!/pkg/*/\n/lib/\n/pkg/a/\n/x\\*y/\n");
});
