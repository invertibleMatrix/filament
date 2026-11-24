// @ts-check
// Where a folder's repository stands, as a session's briefing reads it (the owner's of 10-29: a new session should
// know what happened in the last commits and which worktrees are merged, not learn it from a memory that went stale —
// "the perf work is not merged" was served while main held it).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { repoStandingOf } from "../src/adapters/git/standing.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
// Retried: a read let go past its wait still has git working in the folder for a moment, which Windows will not remove.
after(async () => {
  for (const d of made.reverse()) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});
/** @param {string} dir @param {string} name @param {string} [subject] */
const commit = (dir, name, subject = name) => {
  writeFileSync(join(dir, name), `${name}\n`);
  run(dir, ["add", name]);
  run(dir, ["commit", "-q", "-m", subject]);
};

/** main with three commits; `done`, merged into it; `feat`, two commits main lacks and a file uncommitted. */
const world = () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "repo-standing-")));
  made.push(root);
  const main = join(root, "app");
  mkdirSync(main);
  run(main, ["init", "-q", "-b", "main"]);
  commit(main, "a.txt", "The first: what it is for");
  run(main, ["worktree", "add", "-q", "-b", "done", join(root, "app-done")]);
  commit(join(root, "app-done"), "b.txt", "Done's work");
  run(main, ["merge", "-q", "--ff-only", "done"]);
  commit(main, "c.txt", "The newest on main");
  run(main, ["worktree", "add", "-q", "-b", "feat", join(root, "app-feat")]);
  const feat = join(root, "app-feat");
  commit(feat, "d.txt", "Feat one");
  commit(feat, "e.txt", "Feat two");
  writeFileSync(join(feat, "d.txt"), "changed\nand more\n");
  return { root, main, feat, done: join(root, "app-done") };
};

// (fails before: yes — nothing read a repository for the briefing; the module did not exist)
/** Each other worktree waited on long enough that a loaded machine reads it whole: what is said of a full read. */
const WHOLE = { siblingMs: 60_000 };

test("a worktree's standing: its branch against main, what it has main lacks, main's newest, and the others merged or not", async () => {
  const w = world();
  const s = await repoStandingOf(w.feat, WHOLE);
  assert.ok(s, "read");
  const top = (/** @type {string} */ dir) => run(dir, ["rev-parse", "--show-toplevel"]);
  assert.equal(s.place, top(w.feat));
  assert.equal(s.main, top(w.main));
  assert.equal(s.worktree, true);
  assert.deepEqual([s.branch, s.base, s.onBase, s.ahead, s.behind], ["feat", "main", false, 2, 0]);
  assert.equal(s.baseHead, run(w.main, ["rev-parse", "--short", "main"]));
  assert.deepEqual(s.uncommitted && s.uncommitted.files, 1, "the changed file");
  assert.deepEqual(s.own.map((c) => c.subject), ["Feat two", "Feat one"], "newest first");
  assert.deepEqual(s.commits.map((c) => c.subject), ["The newest on main", "Done's work", "The first: what it is for"], "main's, not the branch's");
  assert.match(s.commits[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(s.commits[0].short, /^[0-9a-f]{7,}$/);
  const byPath = new Map(s.worktrees.map((x) => [x.path, x]));
  assert.deepEqual(s.worktrees.map((x) => x.path), [top(w.main), top(w.done)], "the main folder first, this one left out");
  const mainRow = byPath.get(top(w.main));
  assert.deepEqual(mainRow && [mainRow.main, mainRow.branch, mainRow.onBase], [true, "main", true]);
  const doneRow = byPath.get(top(w.done));
  assert.deepEqual(doneRow && [doneRow.branch, doneRow.ahead, doneRow.behind, doneRow.fresh], ["done", 0, 1, false], "merged, main one past it");
  assert.equal(s.moreWorktrees, 0);
});

// (fails before: yes — the reviewer's of 10-29: the briefing read every worktree past the fence the Worktrees page keeps,
// and one slow sibling held the whole read past the briefing's wait, this folder's line and the commits with it)
test("a worktree the fence refuses, or one git is slow on, is named as git listed it, why said, and the rest stand", async () => {
  const w = world();
  const top = (/** @type {string} */ dir) => run(dir, ["rev-parse", "--show-toplevel"]);
  const refused = await repoStandingOf(w.feat, { ...WHOLE, refusedOf: (p) => (top(w.main) === p.replace(/\\/g, "/") ? "outside the folders Filament may read" : null) });
  const mainRow = refused?.worktrees.find((x) => x.main);
  assert.deepEqual(mainRow && [mainRow.branch, mainRow.unread, mainRow.uncommitted], ["main", "outside the folders Filament may read", null]);
  assert.equal(refused?.worktrees.find((x) => !x.main)?.unread, null, "the other one read");
  assert.deepEqual(refused?.own.length, 2, "this folder's read stands");
  const slow = await repoStandingOf(w.feat, { siblingMs: 1 });
  assert.ok(slow?.worktrees.every((x) => x.unread === "git did not answer in time" && x.branch), JSON.stringify(slow?.worktrees));
  assert.equal(slow?.commits.length, 3, "the commits stand");
  assert.equal(await repoStandingOf(w.feat, { refusedOf: () => "outside the folders Filament may read" }), null, "this folder refused: nothing read");
  // (the review of x31) The fence that looks off the server's thread first answers later: waited for, alike.
  const later = await repoStandingOf(w.feat, { ...WHOLE, refusedOf: async (p) => (top(w.main) === p.replace(/\\/g, "/") ? "does not answer: its drive or share is offline" : null) });
  assert.equal(later?.worktrees.find((x) => x.main)?.unread, "does not answer: its drive or share is offline");
  assert.equal(await repoStandingOf(w.feat, { refusedOf: async () => "does not answer" }), null);
});

test("on the base branch itself: nothing of its own, main's commits; a folder in no repository reads as none", async () => {
  const w = world();
  const s = await repoStandingOf(w.main, { ...WHOLE, commits: 2, worktrees: 1 });
  assert.ok(s);
  assert.deepEqual([s.branch, s.onBase, s.ahead, s.behind, s.worktree], ["main", true, 0, 0, false]);
  assert.deepEqual(s.own, []);
  assert.equal(s.commits.length, 2, "as many as asked");
  assert.equal(s.worktrees.length, 1);
  assert.equal(s.moreWorktrees, 1, "the rest counted, not read");
  const bare = realpathSync.native(mkdtempSync(join(tmpdir(), "repo-standing-none-")));
  made.push(bare);
  assert.equal(await repoStandingOf(bare), null);
});
