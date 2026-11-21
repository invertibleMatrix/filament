// @ts-check
// A builder's patch workspace (the owner's plan of 11-09 for big repos, Phase 1), against real repositories: its launch
// makes no checkout — a ref and a folder —, its file tools answer as the hands answer in a worktree of the same project
// at the same paths, and its capture is the commit a worktree's capture makes of the same edits.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureTaskWork, openTaskWorktree, releaseTaskWorktree, taskRefs } from "../src/adapters/git/worktree.js";
import { capturePatch, openPatch, parkPatch, patchRecordOf, patchSoFar, revivePatch } from "../src/adapters/git/patch.js";
import { patchHand } from "../src/adapters/tools/patch-hands.js";
import { runHand } from "../src/adapters/tools/hands.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
after(async () => {
  for (const d of made.reverse()) await rm(d, { recursive: true, force: true }).catch(() => {});
});
/** A project: text files, a folder, a file git writes with CRLF, an ignored build folder and node_modules. */
const repo = () => {
  const dir = join(realpathSync.native(mkdtempSync(join(tmpdir(), "filament-patch-ws-"))), "proj");
  made.push(dir);
  mkdirSync(join(dir, "src", "deep"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\nbuild/\n");
  writeFileSync(join(dir, ".gitattributes"), "*.crlf text eol=crlf\n");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(dir, "win.crlf"), "first\nsecond\n");
  writeFileSync(join(dir, "src", "main.js"), "export const two = 2;\nconsole.log(two);\n");
  writeFileSync(join(dir, "src", "deep", "util.js"), "// two helpers\nexport const one = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  mkdirSync(join(dir, "node_modules", "lib"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "lib", "index.js"), "module.exports = 'lib two';\n");
  return dir;
};
/** A hold over a workspace that never moves. @param {any} ws */
const holdOf = (ws) => ({ now: () => ws, settled: async () => {}, move: async () => ({ ok: /** @type {const} */ (false), error: "not in this test" }) });

// (fails before: yes — there was no patch workspace: every builder's launch checked the whole project out)
test("a patch's launch makes no checkout: a base ref and a folder at its copy's place, its record beside the copies", async () => {
  const dir = repo();
  const before = git(dir, "worktree", "list", "--porcelain");
  const o = await openPatch(dir, { id: "sa_0000aaaa" });
  assert.ok(o.ok, o.ok ? "" : o.error);
  if (!o.ok) return;
  assert.equal(git(dir, "worktree", "list", "--porcelain"), before, "git keeps no new worktree");
  assert.equal(o.wt.dest, join(dir, ".git", "filament-worktrees", "sa_0000aaaa"), "at the place its worktree would take");
  assert.deepEqual([existsSync(o.wt.workdir), existsSync(join(o.wt.dest, ".git")), existsSync(join(o.wt.dest, "a.txt"))], [true, false, false], "an empty folder, no checkout");
  const rec = patchRecordOf(join(dir, ".git", "filament-worktrees"), "sa_0000aaaa");
  assert.deepEqual([rec?.state, rec?.base, rec?.readFrom], ["busy", git(dir, "rev-parse", "HEAD"), git(dir, "rev-parse", "HEAD")]);
  const refs = await taskRefs(dir, "sa_0000aaaa");
  assert.equal(refs?.base, git(dir, "rev-parse", "HEAD"), "its base is on its refs");
});

// (fails before: yes — the same)
test("its file tools answer as a worktree's hands at the same paths: reads, a missing file, a folder, the dependency folders, searches, listings, the read-first guard", async () => {
  const dir = repo();
  // The developer's uncommitted edit is in both: the launch captures the working tree.
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\nfour two\n");
  const p = await openPatch(dir, { id: "sa_0000bbbb" });
  const w = await openTaskWorktree(dir, { id: "sa_0000cccc" });
  assert.ok(p.ok && w.ok);
  if (!p.ok || !w.ok) return;
  const hold = holdOf(p.wt);
  const seenP = new Map();
  const seenW = new Map();
  /** @param {string} name @param {any} input */
  const both = async (name, input) => {
    const one = await patchHand(name, input, hold, { root: p.wt.workdir, fenced: true, seen: seenP }).then(String, (e) => `Error: ${e.message}`);
    const two = await runHand(name, input, { root: w.wt.workdir, fenced: true, seen: seenW, reads: w.wt.linked }).then(String, (e) => `Error: ${e.message}`);
    return [one, two];
  };
  /** @param {string} name @param {any} input @param {string} [why] */
  const same = async (name, input, why) => {
    const [one, two] = await both(name, input);
    assert.equal(one, two, why || `${name} ${JSON.stringify(input)}`);
    return one;
  };
  assert.match(await same("read", { path: "a.txt" }), /four two/, "the developer's edit, as the launch captured it");
  await same("read", { path: "a.txt", offset: 2, limit: 1 });
  assert.match(await same("read", { path: "win.crlf" }), /first\r/, "written as a checkout writes it: CRLF");
  await same("read", { path: "src/deep/util.js" });
  assert.match(await same("read", { path: "nope.txt" }), /no such file/);
  await same("read", { path: "src" }, "a folder is no file");
  // The developer's ignored dependency folder: a worktree links it, a patch reads it where it is.
  const [depP, depW] = await both("read", { path: "node_modules/lib/index.js" });
  assert.deepEqual([/lib two/.test(depP), /lib two/.test(depW)], [true, true]);
  for (const input of [{ pattern: "two" }, { pattern: "two", output: "files" }, { pattern: "two", output: "count" }, { pattern: "TWO", ignoreCase: true }, { pattern: "two", path: "src" }, { pattern: "two", glob: "*.js" }, { pattern: "o.e", context: 1 }, { pattern: "nothing here" }])
    await same("grep", input);
  for (const input of [{ pattern: "*.js" }, { pattern: "**/*.js" }, { pattern: "*.txt" }, { pattern: "*.js", path: "src/deep" }, { pattern: "*.none" }, { pattern: "*", path: "a.txt" }])
    await same("glob", input);
  // The read-first guard: a file it has not read is never overwritten, one it read is.
  assert.match(await same("write", { path: "src/main.js", content: "x\n" }), /you have not read it/);
  await same("read", { path: "src/main.js" });
  await same("write", { path: "src/main.js", content: "export const two = 22;\n" });
  await same("edit", { path: "a.txt", edits: [{ oldText: "three", newText: "THREE" }] });
  await same("write", { path: "src/new.js", content: "export const three = 3;\n" });
  // Its own edits are what its searches and listings find now.
  await same("grep", { pattern: "22|THREE|three = 3" });
  await same("glob", { pattern: "**/*.js", sort: "path" });
  // A file where a folder of the project stands, and a folder where a file stands, are refused as a worktree refuses them.
  assert.match((await both("write", { path: "a.txt/inside.txt", content: "x" }))[0], /^Error: /);
  await releaseTaskWorktree(w.wt, "free");
});

// (fails before: yes — the same)
test("its capture is the tree a worktree's capture makes of the same edits — new, changed, CRLF, ignored left out — and a follow-up's overlay holds its work", async () => {
  const dir = repo();
  const p = await openPatch(dir, { id: "sa_0000dddd" });
  const w = await openTaskWorktree(dir, { id: "sa_0000eeee" });
  assert.ok(p.ok && w.ok);
  if (!p.ok || !w.ok) return;
  const hold = holdOf(p.wt);
  /** @param {string} name @param {any} input */
  const both = async (name, input) => {
    await patchHand(name, input, hold, { root: p.wt.workdir, fenced: true });
    await runHand(name, input, { root: w.wt.workdir, fenced: true });
  };
  await both("edit", { path: "a.txt", edits: [{ oldText: "two", newText: "TWO" }] });
  await both("edit", { path: "win.crlf", edits: [{ oldText: "second", newText: "SECOND" }] });
  await both("write", { path: "src/deep/more.js", content: "export const more = true;\n" });
  await both("write", { path: "build/out.log", content: "ignored output\n" });
  await both("read", { path: "src/main.js" });
  const pc = await capturePatch(p.wt, { id: "sa_0000dddd" });
  const wc = await captureTaskWork(w.wt, { id: "sa_0000eeee" });
  assert.ok(pc.ok && wc.ok, pc.ok ? (wc.ok ? "" : wc.error) : pc.error);
  if (!pc.ok || !wc.ok) return;
  assert.equal(git(dir, "rev-parse", `${pc.head}^{tree}`), git(dir, "rev-parse", `${wc.head}^{tree}`), "the same tree");
  assert.deepEqual(pc.files.map((f) => [f.path, f.status, f.added, f.removed]), wc.files.map((f) => [f.path, f.status, f.added, f.removed]));
  assert.equal(git(dir, "show", `${pc.head}:win.crlf`), "first\nSECOND", "stored clean, as the repository's rules say");
  assert.equal((await taskRefs(dir, "sa_0000dddd"))?.head, pc.head, "on its refs");
  // What it changed so far reads the same as a worktree's.
  const so = await patchSoFar(p.wt, { id: "sa_0000dddd", previous: pc.head });
  assert.deepEqual(so.ok && so.files.map((f) => f.path), ["a.txt", "src/deep/more.js", "win.crlf"]);
  // Parked, then revived at its capture: the overlay as it stood, its build output with it.
  parkPatch(p.wt);
  assert.equal(patchRecordOf(join(dir, ".git", "filament-worktrees"), "sa_0000dddd")?.state, "parked");
  const back = await revivePatch(dir, { id: "sa_0000dddd", base: p.wt.base, head: pc.head });
  assert.ok(back.ok);
  assert.equal(readFileSync(join(p.wt.dest, "build", "out.log"), "utf8"), "ignored output\n", "its build output kept");
  if (back.ok) {
    await patchHand("write", { path: "b.txt", content: "bee\n" }, holdOf(back.wt), { root: back.wt.workdir, fenced: true });
    const again = await capturePatch(back.wt, { id: "sa_0000dddd", previous: pc.head, base: p.wt.base });
    assert.deepEqual(again.ok && again.files.map((f) => f.path), ["a.txt", "b.txt", "src/deep/more.js", "win.crlf"], "measured from its base, its earlier work kept");
  }
  // Revived at another head — an apply or a send back moved its work on — its overlay starts over there.
  const other = await revivePatch(dir, { id: "sa_0000dddd", base: pc.head, head: pc.head });
  assert.ok(other.ok);
  assert.equal(existsSync(join(p.wt.dest, "build", "out.log")), false, "emptied");
  if (other.ok) assert.match(String(await patchHand("read", { path: "a.txt" }, holdOf(other.wt), { root: other.wt.workdir, fenced: true })), /TWO/, "laid over that head");
  await releaseTaskWorktree(w.wt, "free");
});

// (fails before: yes — the hunt of 11-09: the capture's read-tree and write-tree took the repository's core.splitIndex,
// and the shared part of the temporary index they wrote stayed in its git folder)
test("a repository that sets core.splitIndex: a patch's capture leaves no shared index in its git folder", async () => {
  const dir = repo();
  git(dir, "config", "core.splitIndex", "true");
  const p = await openPatch(dir, { id: "sa_0000ffff" });
  assert.ok(p.ok, p.ok ? "" : p.error);
  if (!p.ok) return;
  const shared = () => readdirSync(join(dir, ".git")).filter((n) => n.startsWith("sharedindex.")).sort();
  const had = shared();
  await patchHand("edit", { path: "a.txt", edits: [{ oldText: "two", newText: "TWO" }] }, holdOf(p.wt), { root: p.wt.workdir, fenced: true });
  await patchHand("write", { path: "src/new.js", content: "export const n = 1;\n" }, holdOf(p.wt), { root: p.wt.workdir, fenced: true });
  const pc = await capturePatch(p.wt, { id: "sa_0000ffff" });
  assert.ok(pc.ok, pc.ok ? "" : pc.error);
  assert.deepEqual(pc.ok && pc.files.map((f) => f.path), ["a.txt", "src/new.js"]);
  assert.deepEqual(shared(), had);
});

// (fails before: yes — the same: a search's copy-up wrote its temporary index split, its shared part in the repository's
// git folder)
test("a repository that sets core.splitIndex: a search's copy-up leaves no shared index in its git folder", async () => {
  const dir = repo();
  git(dir, "config", "core.splitIndex", "true");
  const p = await openPatch(dir, { id: "sa_0000eeef" });
  assert.ok(p.ok, p.ok ? "" : p.error);
  if (!p.ok) return;
  const shared = () => readdirSync(join(dir, ".git")).filter((n) => n.startsWith("sharedindex.")).sort();
  const had = shared();
  const said = String(await patchHand("grep", { pattern: "two", path: "." }, holdOf(p.wt), { root: p.wt.workdir, fenced: true }));
  assert.match(said, /a\.txt/);
  assert.equal(existsSync(join(p.wt.dest, "src", "main.js")), true, "the files that may match, copied up");
  assert.deepEqual(shared(), had);
});
