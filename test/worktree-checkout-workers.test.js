// @ts-check
// Phase 0 of the owner's 11-09 plan for big repos: every checkout and reset of a copy runs git's parallel checkout
// (`checkout.workers`: a worker a core, up to 8; `checkout.thresholdForParallelism=100`: git's own default, so a
// small change stays sequential), and a builder's copy skips Git LFS's smudge — read from git's own trace
// of each process's arguments (GIT_TRACE2_EVENT). The developer's own worktrees (places.js) are not Filament's copies,
// and keep git's defaults.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { openCheckTree, openTaskWorktree, releaseTaskWorktree, resetLane, reviveTaskWorktree } from "../src/adapters/git/worktree.js";
import { git as gitRun } from "../src/adapters/git/snapshot.js";

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
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-workers-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
const WORKERS = ["-c", `checkout.workers=${Math.min(8, availableParallelism())}`, "-c", "checkout.thresholdForParallelism=100"];
const SKIP_LFS = ["-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false"];
/** Whether `argv` holds `part` in a row. @param {string[]} argv @param {string[]} part */
const holds = (argv, part) => argv.some((_, i) => part.every((p, k) => argv[i + k] === p));

/**
 * Each git process's arguments while `fn` runs, from git's own trace: GIT_TRACE2_EVENT names a file every git started
 * meanwhile writes its `start` event to — Filament's calls take the environment as it stands.
 * @param {() => Promise<void>} fn
 */
const traced = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-trace-"));
  made.push(dir);
  const file = join(dir, "trace.json");
  const was = process.env.GIT_TRACE2_EVENT;
  process.env.GIT_TRACE2_EVENT = file;
  try {
    await fn();
  } finally {
    if (was === undefined) delete process.env.GIT_TRACE2_EVENT;
    else process.env.GIT_TRACE2_EVENT = was;
  }
  /** @type {string[][]} */
  const argvs = [];
  for (const line of readFileSync(file, "utf8").split("\n"))
    try {
      const e = JSON.parse(line);
      if (e.event === "start" && Array.isArray(e.argv)) argvs.push(e.argv.slice(1));
    } catch {}
  return argvs;
};

// (fails before: yes — a copy's checkout and resets ran git's sequential checkout, LFS smudged in each)
test("a copy's checkout, its reset at a next question and a lane's reset run parallel checkout; a builder's skip LFS's smudge, a check's and a lane's do not", async () => {
  const dir = repo();
  /** @type {any} */
  let o = null;
  const argvs = await traced(async () => {
    o = await openTaskWorktree(dir, { id: "sa_w1" });
    assert.ok(o.ok);
    await releaseTaskWorktree(o.wt, "parked");
    const again = await reviveTaskWorktree(dir, { id: "sa_w1", base: o.wt.base, head: o.wt.base });
    assert.ok(again.ok, !again.ok ? again.error : "");
    await releaseTaskWorktree(again.wt, "parked");
    const c = await openCheckTree(dir, { id: "chk_w1", commit: o.wt.base });
    assert.ok(c.ok);
    assert.deepEqual(await resetLane(c.wt, o.wt.base), { ok: true });
    await releaseTaskWorktree(c.wt, "free");
  });
  // Filament's own calls, each led by its fsmonitor off (OWN_CONFIG): git worktree add starts a git of its own, its
  // `-c` given it through the environment.
  const own = argvs.filter((a) => a[0] === "-c" && a[1] === "core.fsmonitor=false");
  const adds = own.filter((a) => holds(a, ["worktree", "add"]));
  const resets = own.filter((a) => holds(a, ["checkout", "--force", "--detach"]));
  const lanes = own.filter((a) => holds(a, ["reset", "--hard"]));
  assert.equal(adds.length, 2, "the builder's copy and the check's were checked out");
  assert.equal(resets.length, 1, "the builder's own copy was reset at its next question");
  assert.equal(lanes.length, 1, "the lane went back once");
  for (const a of [...adds, ...resets, ...lanes]) assert.ok(holds(a, WORKERS), `parallel checkout: ${a.join(" ")}`);
  const [builder, check] = adds;
  assert.ok(holds(builder, SKIP_LFS) && holds(resets[0], SKIP_LFS), "a builder's copy skips LFS's smudge");
  assert.ok(!holds(check, SKIP_LFS) && !holds(lanes[0], SKIP_LFS), "a check's copy and a lane smudge as the repository says");
});

test("a git that does not know a -c key runs as it would without it: an older git ignores checkout.workers", async () => {
  const dir = repo();
  const r = await gitRun(["-c", "checkout.filamentNoSuchKey=8", ...WORKERS, "status", "--porcelain"], { cwd: dir });
  assert.deepEqual([r.code, r.out, r.error], [0, "", null]);
});
