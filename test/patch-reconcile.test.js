// @ts-check
// A builder's patch workspace (the owner's plan of 11-09 for big repos, Phase 1) lives where its worktree would — a real
// folder under the repository's copies' home holding only the files it read or wrote — with Filament's record of it
// beside the copies, in `.patches/<id>.json`. No git record names it: the copies' own reconcile, trim and Clean up must
// never read it as a checkout a crash cut, which goes whole — that would drop the builder's work.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { letGoCopy, letGoOfCopies, letGoTaskWork, openTaskWorktree, pruneTaskWorktrees, sweepTaskWorktrees } from "../src/adapters/git/worktree.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
after(async () => {
  for (const d of made.reverse()) await rm(d, { recursive: true, force: true }).catch(() => {});
});
/** A repository with one commit. */
const repo = () => {
  const dir = join(realpathSync.native(mkdtempSync(join(tmpdir(), "filament-patch-rec-"))), "proj");
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/**
 * A patch workspace as a builder leaves it: its folder at the copy's place, one file it changed, and its record.
 * @param {string} dir @param {string} id @param {"busy" | "parked"} state
 */
const patchOf = (dir, id, state) => {
  const home = join(dir, ".git", "filament-worktrees");
  const overlay = join(home, id);
  mkdirSync(overlay, { recursive: true });
  writeFileSync(join(overlay, "a.txt"), "changed by the helper\n");
  mkdirSync(join(home, ".patches"), { recursive: true });
  const head = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(home, ".patches", `${id}.json`), JSON.stringify({ owner: "a-gone-filament", home: "", agent: id, base: head, readFrom: head, at: Date.now(), state }));
  return overlay;
};

// (fails before: yes — the owner's plan of 11-09, the loss path: a folder in the copies' home with no git record was
// read as a checkout a crash cut, and went whole, the builder's work with it)
test("a patch's folder stays through the start's sweep, a taking's reconcile and a prune, and a Clean up refuses it", async () => {
  const dir = repo();
  const parked = patchOf(dir, "sa_0000beef", "parked");
  const busy = patchOf(dir, "sa_0000cafe", "busy");
  letGoOfCopies();
  const swept = await sweepTaskWorktrees([dir]);
  assert.deepEqual(swept.failed, []);
  assert.equal(swept.gone, 0, "nothing went");
  for (const p of [parked, busy]) assert.equal(readFileSync(join(p, "a.txt"), "utf8"), "changed by the helper\n", "its work stays where it was");
  // Another agent's copy taken in the repository reconciles its home too.
  const other = await openTaskWorktree(dir, { id: "sa_00000001" });
  assert.ok(other.ok, other.ok ? "" : other.error);
  assert.equal(await pruneTaskWorktrees(dir, new Set(["sa_00000001"])), 0);
  for (const p of [parked, busy]) assert.equal(existsSync(join(p, "a.txt")), true, "a reconcile leaves it");
  // The footprint's Clean up never takes a patch for a copy.
  const cleaned = await letGoCopy(dir, "sa_0000beef", { at: 0, homes: () => true });
  assert.equal(cleaned.ok, false);
  assert.equal(existsSync(join(parked, "a.txt")), true, "a Clean up leaves it");
});

// (fails before: yes — the same loss path: a deleted chat's helper's patch went whole, nothing of it on its refs)
test("a deleted chat's helper's patch has its work kept on its refs before its folder and record go", async () => {
  const dir = repo();
  const overlay = patchOf(dir, "sa_0000d00d", "parked");
  const done = await letGoTaskWork(dir, "sa_0000d00d");
  assert.ok(done.ok, done.ok ? "" : done.error);
  assert.deepEqual([done.ok && done.copy, done.ok && done.waits], ["gone", true], "its folder went, its work waits on its refs");
  assert.equal(existsSync(overlay), false);
  assert.equal(existsSync(join(dir, ".git", "filament-worktrees", ".patches", "sa_0000d00d.json")), false, "its record with it");
  assert.equal(git(dir, "show", "refs/filament/subagents/sa_0000d00d/work:a.txt"), "changed by the helper");
});
