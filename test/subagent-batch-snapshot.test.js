// @ts-check
// Phase 0 of the owner's 11-09 plan for big repos: builders launched together share one snapshot of the folder, where
// each took its own — n scans of a folder of 100,000 files for one state of it. A batch is the launches asked in one
// pass (attempts, a task graph's side run), or one round's agent calls (the loop's run and round). A launch of the
// batch that comes while its snapshot is being taken shares it; one that comes after takes its own, so nothing is
// shared across a change of the folder. Each keeps its own base ref.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTaskWorktree, releaseTaskWorktree } from "../src/adapters/git/worktree.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { until } from "./helpers/wait.js";

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
/** A repository with a commit, and an edit in the folder not committed: a snapshot of it is a commit of its own. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-batch-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  writeFileSync(join(dir, "a.txt"), "edited, not committed\n");
  return dir;
};
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** A sub-agent's base ref. @param {string} dir @param {string} id */
const baseOf = (dir, id) => git(dir, "rev-parse", "--verify", "-q", `refs/filament/subagents/${id}/base`);
/** Whether a sub-agent's base ref is there yet. @param {string} dir @param {string} id */
const hasBase = (dir, id) => {
  try {
    return !!baseOf(dir, id);
  } catch {
    return false;
  }
};
const WORK = { timeoutMs: 60_000 };

// ---- worktree.js: openTaskWorktree's batch ---------------------------------------------------------------------------

// (fails before: yes — each launch took a snapshot of its own: three commits of one folder)
test("three launches of one batch share one snapshot, each with its own base ref; three with none take three", async () => {
  const dir = repo();
  const head = git(dir, "rev-parse", "HEAD");
  const ids = ["sa_b1", "sa_b2", "sa_b3"];
  const os = await Promise.all(ids.map((id) => openTaskWorktree(dir, { id, batch: "turn-1:2" })));
  for (const o of os) assert.ok(o.ok, !o.ok ? o.error : "");
  const bases = os.map((o) => (o.ok ? o.wt.base : ""));
  assert.equal(new Set(bases).size, 1, "one snapshot");
  assert.notEqual(bases[0], head, "of the folder's edit");
  assert.deepEqual(ids.map((id) => baseOf(dir, id)), bases, "each its own base ref");
  for (const o of os) if (o.ok) assert.equal(read(join(o.wt.dest, "a.txt")), "edited, not committed\n");
  for (const o of os) if (o.ok) await releaseTaskWorktree(o.wt, "parked");
  const alone = await Promise.all(["sa_n1", "sa_n2", "sa_n3"].map((id) => openTaskWorktree(dir, { id })));
  assert.equal(new Set(alone.map((o) => (o.ok ? o.wt.base : ""))).size, 3, "without a batch, a snapshot each");
  for (const o of alone) if (o.ok) await releaseTaskWorktree(o.wt, "parked");
});

// (fails before: yes — the batch was not known)
test("a launch of the batch that comes once its snapshot is taken, after the folder changed, takes its own: never shared across a change", async () => {
  const dir = repo();
  const first = await openTaskWorktree(dir, { id: "sa_l1", batch: "turn-2:1" });
  assert.ok(first.ok);
  writeFileSync(join(dir, "a.txt"), "changed again\n");
  const late = await openTaskWorktree(dir, { id: "sa_l2", batch: "turn-2:1" });
  assert.ok(late.ok);
  assert.notEqual(late.wt.base, first.wt.base);
  assert.equal(read(join(late.wt.dest, "a.txt")), "changed again\n", "its copy holds the folder as it is now");
  await releaseTaskWorktree(first.wt, "parked");
  await releaseTaskWorktree(late.wt, "parked");
});

test("a launch of the batch stopped while the shared snapshot is taken leaves nothing, and the others get theirs", async () => {
  const dir = repo();
  const stop = new AbortController();
  const [a, b, c] = await Promise.all([
    openTaskWorktree(dir, { id: "sa_s1", batch: "turn-3:1" }),
    (async () => {
      const p = openTaskWorktree(dir, { id: "sa_s2", batch: "turn-3:1", signal: stop.signal });
      stop.abort();
      return p;
    })(),
    openTaskWorktree(dir, { id: "sa_s3", batch: "turn-3:1" }),
  ]);
  assert.ok(a.ok && c.ok, "the others have their copies");
  assert.equal(a.ok && c.ok && a.wt.base === c.wt.base, true);
  assert.deepEqual(b, { ok: false, error: "it was stopped while its copy was made", kind: "failed" });
  assert.equal(hasBase(dir, "sa_s2"), false, "no base ref for the stopped one");
  if (a.ok) await releaseTaskWorktree(a.wt, "parked");
  if (c.ok) await releaseTaskWorktree(c.wt, "parked");
});

// ---- the registry: attempts, a pass of launches, one round's agent calls ----------------------------------------------

/**
 * A registry over a real repository whose front door is a scripted host: each exchange ends with a report once the
 * test lets it (`release`), so every launch's copy is made while none has ended.
 * @param {string} dir
 */
const registryOver = (dir) => {
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((r) => (release = () => r(undefined)));
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      settings: () => ({ subagents: {}, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      await held;
      registry.finish(id, { status: "done", error: null, report: "Done.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Done." }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Done." }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, release };
};
/** The builders' base refs once each has its copy, in launch order. @param {any} registry @param {string} dir @param {number} count */
const basesOf = async (registry, dir, count) => {
  await until(() => registry.list("c1").length === count && registry.list("c1").every((/** @type {any} */ s) => hasBase(dir, s.id)), `${count} base refs`, WORK);
  return registry.list("c1").map((/** @type {any} */ s) => baseOf(dir, s.id));
};
/** @type {any} */
const BUILDER = { origin: "agent", chainId: "c1", prompt: "change a.txt", description: "builder", worker: "builder", background: true, mode: "edit" };

// (fails before: yes — attempts' n launches took n snapshots: subagents.js attempts → launch, each its own)
test("attempts(3) make one snapshot and three base refs", async () => {
  const dir = repo();
  const { registry, release } = registryOver(dir);
  const r = await registry.attempts({ ...BUILDER, cwd: dir }, 3);
  assert.ok(r.ok, !r.ok ? r.error : "");
  const bases = await basesOf(registry, dir, 3);
  assert.equal(new Set(bases).size, 1, `one snapshot: ${bases.join(", ")}`);
  release();
});

// (fails before: yes — a task graph's side run launches its tasks in one pass, a snapshot each)
test("launches asked in one pass share a snapshot; launches a pass apart take their own", async () => {
  const dir = repo();
  const { registry, release } = registryOver(dir);
  for (let k = 0; k < 3; k++) assert.ok(registry.launch({ ...BUILDER, cwd: dir }).ok);
  assert.equal(new Set(await basesOf(registry, dir, 3)).size, 1, "one pass, one snapshot");
  release();
  const other = registryOver(dir);
  for (let k = 0; k < 2; k++) {
    assert.ok(other.registry.launch({ ...BUILDER, cwd: dir }).ok);
    await null;
  }
  assert.equal(new Set(await basesOf(other.registry, dir, 2)).size, 2, "two passes, two snapshots");
  other.release();
});

// (fails before: yes — consecutive agent calls of one round each took a snapshot; loop.js passes its round as `batch`)
test("two agent calls of one round through the turn's door share a snapshot; calls of two rounds do not", async () => {
  const dir = repo();
  const { registry, release } = registryOver(dir);
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  /** @param {string} id @param {number} batch */
  const call = (id, batch) => /** @type {any} */ (door.subagents).run({ id, input: { run_in_background: true, description: "builder", prompt: "change a.txt" }, emit: () => {}, signal: null, batch });
  const rs = await Promise.all([call("toolu_1", 4), call("toolu_2", 4)]);
  for (const r of rs) assert.ok(r.ok, r.text);
  assert.equal(new Set(await basesOf(registry, dir, 2)).size, 1, "one round, one snapshot");
  release();
  const other = registryOver(dir);
  const door2 = other.registry.openTurn({ chainId: "c1", runId: "turn-2", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  /** @param {string} id @param {number} batch */
  const call2 = (id, batch) => /** @type {any} */ (door2.subagents).run({ id, input: { run_in_background: true, description: "builder", prompt: "change a.txt" }, emit: () => {}, signal: null, batch });
  await Promise.all([call2("toolu_3", 5), call2("toolu_4", 6)]);
  assert.equal(new Set(await basesOf(other.registry, dir, 2)).size, 2, "two rounds, two snapshots");
  other.release();
});
