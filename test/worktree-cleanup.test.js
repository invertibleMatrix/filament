// @ts-check
// Worktree cleanup (the owner's of 11-09): Filament owns what it made without a branch — helper copies, check copies,
// forks — and lets them go itself; the developer owns branch worktrees, which Filament lists with their age, what is
// uncommitted and whether their branch is merged, and offers to remove, never on its own. Against real repositories:
// the copies put right as Filament starts; a capture that fails tried again, and where it fails again kept busy and
// said; a deleted chat's helpers' copies and refs let go, work that waits kept; a mark's hold that expires; a deleted
// chat's forks removed, what they held kept on a ref first, and a fork that prunes only its own stale record; the
// places' age and merged, and Remove worktree and branch with its Put back. And its review's work-loss paths: a fork
// holding submodules, or whose folder someone uses, kept; a fork whose folder is gone keeping the commits made on it; a
// deleted project's folder looked in; a record git keeps relative; a fork's kept contents in the footprint; the commit
// a branch removed with its worktree was at, said. And its third part: a branch worktree's folder removed whatever its
// base lacks; a fork kept at its chat's delete tried again; a deleted chat's turn known without its row, and asked of
// again before the move; a helper's copy record git keeps relative; a deleted chat's helper whose capture failed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fsp, { rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  MARK_KEPT_MS, dropMarkHold, forgetTaskWorktree, holdMarkedWork, letGoOfCopies, letGoTaskWork, markHolds, openTaskWorktree, reposOf, sweepTaskWorktrees, taskRefs, unsavedCopies, waitingTaskWork,
} from "../src/adapters/git/worktree.js";
import { addWorktree } from "../src/adapters/git/snapshot.js";
import { forkKeptRef, forksOf, heldBack, makeWorktree, markFork, readWorktree, worktreesOf } from "../src/adapters/git/places.js";
import { dropForksOf, forkSession } from "../src/app/fork.js";
import { createFootprint, deletedChatsWork } from "../src/app/git-footprint.js";
import { SAVE_AGAIN_MS, createSubagentRegistry } from "../src/app/agent/subagents.js";
import { removeSheet } from "../src/ui/harness/panes/changes-data.js";
import { copiesOf, copyMeta, copyState } from "./helpers/copies.js";
import { startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
// git's objects are read-only: the promise form, which Electron's Node removes too (HarnessV3-Native NA1).
after(async () => {
  for (const d of made.reverse()) await rm(d, { recursive: true, force: true }).catch(() => {});
});
/** A fresh folder under the system's temp, as the filesystem spells it. @param {string} prefix */
const fresh = (prefix) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
/** A repository with one commit on main, node_modules ignored. @param {string} [dir] */
const repo = (dir = join(fresh("filament-clean-"), "proj")) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** A commit of one new file. @param {string} dir @param {string} name */
const commit = (dir, name) => {
  writeFileSync(join(dir, name), `${name}\n`);
  git(dir, "add", name);
  git(dir, "commit", "-qm", name);
};
/** The refs under a prefix, by name. @param {string} dir @param {string} prefix */
const refsUnder = (dir, prefix) => git(dir, "for-each-ref", "--format=%(refname)", prefix).split(/\r?\n/).filter(Boolean).sort();
/** A link to a folder: a junction on Windows, as a helper's node_modules is. @param {string} target @param {string} at */
const linkDir = (target, at) => symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");

/**
 * A registry over a real repository whose front door is a scripted host, as subagent-worktree.test.js's: each exchange
 * "runs" by writing into the copy its sub-agent works in and finishing with a report, `body` the request it was asked
 * with. `log`: the registry's own; `later`: its timer, where the test brings a later step on itself; `over`: parts of
 * its context.
 * @param {string} dir @param {(o: { n: number, cwd: string, body: any }) => string | Promise<string>} work
 * @param {{ log?: (level: string, msg: string) => void, later?: (fn: () => void, ms: number) => void } & Record<string, any>} [o]
 */
const workingRegistry = (dir, work, { log = () => {}, later, ...over } = {}) => {
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log,
    ...(later ? { later } : {}),
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
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const report = await work({ n, cwd, body });
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry };
};
/** One `agent` call through a turn's door, in the foreground. @param {any} door @param {string} id @param {string} prompt */
const launch = (door, id, prompt) => door.subagents.run({ id, input: { run_in_background: false, description: prompt, prompt }, emit: () => {}, signal: null });
/** The helper an answer names. @param {{ text: string }} r */
const idOf = (r) => String(/agent_id "(sa_[0-9a-f]{8})"/.exec(r.text)?.[1]);
/** A helper's ref that git cannot take while this lock file stands. @param {string} dir @param {string} id @param {string} leaf */
const lockOf = (dir, id, leaf) => join(dir, ".git", "refs", "filament", "subagents", id, `${leaf}.lock`);

// ---- 2. a capture that fails ----------------------------------------------------------------------------------------

describe("a capture that fails", () => {
  // (fails before: yes — the owner's of 11-09: one failed capture kept the copy busy and its id in use until a restart,
  // and the thread's delete was refused for it)
  test("is tried again: kept on its refs, the copy is given back, and its thread can be deleted", async () => {
    const dir = repo();
    let id = "";
    const { registry } = workingRegistry(
      dir,
      ({ cwd }) => {
        id = basename(cwd);
        writeFileSync(join(cwd, "made.txt"), "by the helper\n");
        // Its work's ref is held by another git for a moment: the first capture cannot write it.
        writeFileSync(lockOf(dir, id, "work"), "");
        return "WROTE";
      },
      { log: (level, msg) => (level === "warn" && msg.includes(id) && /once more/.test(msg) ? rmSync(lockOf(dir, id, "work"), { force: true }) : undefined) },
    );
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    try {
      const r = await launch(door, "toolu_1", "write a file");
      assert.equal(idOf(r), id);
      assert.match(r.text, /its changes are not in your folder yet: 1 file/, "captured on the second try");
      const cwd = join(dir, ".git", "filament-worktrees", id);
      assert.deepEqual([copyState(cwd), copyMeta(cwd)?.unsaved ?? null], ["parked", null], "given back, parked");
      assert.deepEqual([registry.treesInUse().includes(id), registry.failedCaptures()], [false, []]);
      assert.deepEqual(await registry.forget(id, "c1"), { ok: true, files: 1 }, "its thread's delete is no longer refused");
    } finally {
      door.close();
    }
  });

  // (fails before: yes — nothing said why the copy stayed, and a restart parked it whatever its work's save came to)
  test("that fails again stays busy and says so — the registry, its record, the footprint's read — and the start's sweep keeps it until its work is kept", async () => {
    const dir = repo();
    let id = "";
    const { registry } = workingRegistry(dir, ({ cwd }) => {
      id = basename(cwd);
      writeFileSync(join(cwd, "made.txt"), "by the helper\n");
      writeFileSync(lockOf(dir, id, "work"), "");
      return "WROTE";
    });
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    const cwd = () => join(dir, ".git", "filament-worktrees", id);
    try {
      const r = await launch(door, "toolu_1", "write a file");
      assert.match(r.text, /its work could not be captured \(git update-ref failed/);
      const [failed] = registry.failedCaptures();
      assert.deepEqual([failed?.id, failed?.chainId, failed?.dest], [id, "c1", cwd()]);
      assert.match(String(failed?.error), /git update-ref failed/);
      assert.deepEqual([copyState(cwd()), /update-ref/.test(String(copyMeta(cwd())?.unsaved?.error))], ["busy", true], "its record says it");
      const listed = await unsavedCopies(dir);
      assert.deepEqual(listed.ok && listed.copies.map((c) => [c.name, c.agent]), [[id, id]]);
      const refused = await registry.forget(id, "c1");
      assert.deepEqual(refused, { ok: false, status: 409, error: "its copy of the project is still in use" });
    } finally {
      door.close();
    }
    // Filament stops with it so: the next start's sweep cannot keep its work either, and leaves it busy, said.
    letGoOfCopies();
    const swept = await sweepTaskWorktrees([dir]);
    assert.deepEqual([swept.gone, swept.failed, copyState(cwd())], [0, [], "busy"], "never parked with its work not kept");
    assert.match(String(copyMeta(cwd())?.unsaved?.error), /update-ref/);
    // Once git can write its ref, the next sweep keeps its work there and parks it.
    rmSync(lockOf(dir, id, "work"), { force: true });
    letGoOfCopies();
    await sweepTaskWorktrees([dir]);
    assert.deepEqual([copyState(cwd()), copyMeta(cwd())?.unsaved ?? null], ["parked", null]);
    const refs = await taskRefs(dir, id);
    assert.equal(refs && git(dir, "show", `${refs.head}:made.txt`), "by the helper", "its work is on its refs");
  });
});

// ---- 1. the start's sweep -------------------------------------------------------------------------------------------

describe("the copies as Filament starts", () => {
  // (fails before: yes — the owner's of 11-09: a crash's copy was put right only at the next copy taken in its repository)
  test("a sweep puts right each repository's copies — an orphan's work kept, parked; a half-made checkout gone; past the cap let go — and makes no home where there is none", async () => {
    const dir = repo();
    const plain = repo();
    const orphan = await openTaskWorktree(dir, { id: "sa_000000a1" });
    assert.ok(orphan.ok);
    writeFileSync(join(orphan.wt.workdir, "cut.txt"), "what the crash cut\n");
    // A checkout the crash cut: its folder and git's record, no index yet.
    const half = await openTaskWorktree(dir, { id: "sa_000000a2" });
    assert.ok(half.ok);
    rmSync(join(String(/^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(half.wt.dest, ".git"), "utf8"))?.[1]), "index"));
    letGoOfCopies();
    const r = await sweepTaskWorktrees([dir, join(dir, "a.txt"), plain, join(dir, "nope")]);
    assert.deepEqual([r.repos.length, r.gone, r.failed], [1, 1, []], "one repository, read once; the half-made one went");
    assert.deepEqual(copiesOf(dir), [["sa_000000a1", "parked"]]);
    const refs = await taskRefs(dir, "sa_000000a1");
    assert.equal(refs && git(dir, "show", `${refs.head}:cut.txt`), "what the crash cut", "the orphan's work is on its refs");
    assert.equal(existsSync(join(plain, ".git", "filament-worktrees")), false, "a repository with no copies gets no home");
  });

  // (fails before: yes — nothing swept at the start)
  test("Filament's start sweeps the copies of its projects' repositories, in the background", async () => {
    const dir = repo();
    const first = await startApp({ memory: true, keep: true });
    /** @type {any} */ (first.app).memory.archive.ensureProject(dir);
    const dataDir = first.dataDir;
    await first.stop();
    const orphan = await openTaskWorktree(dir, { id: "sa_000000b1" });
    assert.ok(orphan.ok);
    writeFileSync(join(orphan.wt.workdir, "cut.txt"), "what the crash cut\n");
    letGoOfCopies();
    const again = await startApp({ memory: true, dataDir });
    try {
      await until(() => copyState(orphan.wt.dest) === "parked", "the copy a crash left is parked as Filament starts");
      const refs = await taskRefs(dir, "sa_000000b1");
      assert.equal(refs && git(dir, "show", `${refs.head}:cut.txt`), "what the crash cut");
    } finally {
      await again.stop();
    }
  });
});

// ---- 3. a deleted chat ----------------------------------------------------------------------------------------------

describe("a deleted chat's helpers", () => {
  // (fails before: yes — the owner's of 11-09: a deleted chat's helpers' copies and refs stayed for good)
  test("let go of their copies, of their refs where nothing waits, and of their marks' holds; work that waits stays, found", async () => {
    const dir = repo();
    const { registry } = workingRegistry(dir, ({ n, cwd }) => {
      writeFileSync(join(cwd, `made${n}.txt`), `${n}\n`);
      return `WROTE ${n}`;
    });
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    const waits = idOf(await launch(door, "toolu_1", "one"));
    const applied = idOf(await launch(door, "toolu_2", "two"));
    const marked = idOf(await launch(door, "toolu_3", "three"));
    door.close();
    assert.equal((await registry.apply(applied, "c1", "owner")).ok, true);
    const m = await taskRefs(dir, marked);
    assert.ok(m && (await holdMarkedWork(dir, marked, { base: m.base, head: m.head })));
    assert.deepEqual(copiesOf(dir).map(([n]) => n).sort(), [waits, applied, marked].sort(), "three parked copies");
    // A helper of another chat, whose copy no registry holds now (a restart): found by its thread, as its delete noted it.
    const other = workingRegistry(dir, ({ cwd }) => (writeFileSync(join(cwd, "x.txt"), "x\n"), "X")).registry;
    const door2 = other.openTurn({ chainId: "c2", runId: "turn-2", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    const unheld = idOf(await launch(door2, "toolu_4", "four"));
    door2.close();

    await registry.forgetChat("c1");
    assert.deepEqual(copiesOf(dir).map(([n]) => n), [unheld], "the deleted chat's copies went; another chat's stays");
    assert.deepEqual(refsUnder(dir, `refs/filament/subagents/${waits}/`), [`refs/filament/subagents/${waits}/base`, `refs/filament/subagents/${waits}/work`], "work that waits stays");
    assert.deepEqual([refsUnder(dir, `refs/filament/subagents/${applied}/`), refsUnder(dir, `refs/filament/subagents/${marked}/`)], [[], []], "nothing waits: nothing stays");
    const found = await waitingTaskWork(dir);
    assert.deepEqual(found.ok && found.work.map((w) => w.id).sort(), [unheld, waits].sort());
    const archive = () => ({ goneChains: () => new Map([["c1", { helpers: [waits, applied, marked], at: 1000 }]]) });
    const left = await deletedChatsWork(dir, { archive });
    assert.deepEqual(left.ok && left.work.map((w) => [w.id, w.chainId, w.deletedAt]), [[waits, "c1", 1000]], "what a deleted chat left waiting, listed");

    const restarted = workingRegistry(dir, () => "never", { goneHelpers: (/** @type {string} */ c) => (c === "c2" ? [unheld] : []), folders: () => [dir] }).registry;
    await restarted.forgetChat("c2");
    assert.deepEqual(copiesOf(dir), [], "a helper the registry does not hold lets go too, found in the folders Filament knows");
    assert.deepEqual(refsUnder(dir, `refs/filament/subagents/${unheld}/`).length, 2, "its work waits, and stays");
  });

  // (fails before: yes — as above)
  test("a copy a junction is linked into goes without following it", async () => {
    const dir = repo();
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
    const { registry } = workingRegistry(dir, ({ cwd }) => (writeFileSync(join(cwd, "m.txt"), "m\n"), "W"));
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    await launch(door, "toolu_1", "one");
    door.close();
    await registry.forgetChat("c1");
    assert.deepEqual(copiesOf(dir), []);
    assert.equal(readFileSync(join(dir, "node_modules", "pkg", "index.js"), "utf8"), "module.exports = 1;\n", "the link was never followed");
  });
});

// ---- 4. marks' holds ------------------------------------------------------------------------------------------------

describe("a mark's hold", () => {
  // (fails before: yes — the owner's of 11-09: a hold stayed until its helper worked again, maybe forever)
  test("says when it was made, and goes past MARK_KEPT_MS; one that says no time stays", async () => {
    const dir = repo();
    const head = git(dir, "rev-parse", "HEAD");
    await holdMarkedWork(dir, "sa_000000e2", { base: head, head });
    // A mark of eight days ago, as holdMarkedWork writes one; and one from before holds kept a reflog.
    const old = Math.floor((Date.now() - 8 * 86_400_000) / 1000);
    const lines = (/** @type {string} */ id) => `update refs/filament/subagents/${id}/marked-base ${head}\nupdate refs/filament/subagents/${id}/marked-work ${head}\n`;
    execFileSync("git", ["update-ref", "--create-reflog", "--stdin"], { cwd: dir, input: lines("sa_000000e1"), env: { ...GIT_ENV, GIT_COMMITTER_DATE: `@${old} +0000` }, windowsHide: true });
    execFileSync("git", ["update-ref", "--stdin"], { cwd: dir, input: lines("sa_000000e3"), env: GIT_ENV, windowsHide: true });
    const read = await markHolds(dir);
    assert.ok(read.ok);
    const at = new Map(read.holds.map((h) => [h.id, h.at]));
    assert.equal(at.get("sa_000000e1"), old * 1000);
    assert.ok(Math.abs(Number(at.get("sa_000000e2")) - Date.now()) < 60_000, "a mark made now says now");
    assert.equal(at.get("sa_000000e3"), null);
    assert.ok(MARK_KEPT_MS === 7 * 86_400_000);
    const { registry } = workingRegistry(dir, () => "never");
    assert.equal(await registry.expireMarks([dir]), 1);
    assert.deepEqual(refsUnder(dir, "refs/filament/subagents/").map((r) => r.split("/")[3]), ["sa_000000e2", "sa_000000e2", "sa_000000e3", "sa_000000e3"]);
  });
});

// ---- 5. forks -------------------------------------------------------------------------------------------------------

describe("forks", () => {
  // (fails before: yes — the owner's of 11-09: making a fork ran a blanket `git worktree prune`)
  test("making one drops only its own stale record: the developer's worktree on a drive not mounted keeps its", async () => {
    const dir = repo();
    const away = join(fresh("filament-away-"), "dev-wt");
    git(dir, "worktree", "add", "-q", "-b", "dev", away);
    rmSync(away, { recursive: true, force: true });
    git(dir, "update-ref", "refs/filament/snapshots/c/1", "HEAD");
    const a = await addWorktree(dir, { ref: "refs/filament/snapshots/c/1", suffix: "chainA" });
    assert.ok(a.ok, !a.ok ? a.error : "");
    const listed = () => git(dir, "worktree", "list", "--porcelain").replace(/\\/g, "/").toLowerCase();
    assert.ok(listed().includes(away.replace(/\\/g, "/").toLowerCase()), "the developer's record stays");
    // Its own folder deleted by hand: the same name works again.
    rmSync(a.path, { recursive: true, force: true });
    const b = await addWorktree(dir, { ref: "refs/filament/snapshots/c/1", suffix: "chainA" });
    assert.deepEqual([b.ok, b.ok && b.path], [true, a.path]);
    assert.ok(listed().includes(away.replace(/\\/g, "/").toLowerCase()), "and still stays");
  });

  // (fails before: yes — the owner's of 11-09: no code removed a fork)
  test("a deleted chat's fork goes, what it held kept on a ref first — edits, files, commits made on it —; another chat's fork and the developer's worktree stay; a junction in it is never followed", async () => {
    const dir = repo();
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
    git(dir, "update-ref", "refs/filament/snapshots/c/1", "HEAD");
    const ref = "refs/filament/snapshots/c/1";
    // Made as a chat's fork is made, through forkSession: marked for its chat.
    const memory = {
      forkSession: () => ({ chainId: "chat-gone", tree: { snapshotRef: ref } }),
      archive: { getChain: () => ({ project_id: "p" }), getProject: () => ({ cwd: dir }) },
      setSessionWorktree: (/** @type {string} */ _id, /** @type {string} */ path) => ({ snapshotRef: ref, worktree: path }),
    };
    const forked = await forkSession({ memory }, "src", { atTurn: 1, worktree: true });
    const gonePath = String(forked.tree.worktree);
    const keep = await addWorktree(dir, { ref, suffix: "chat-kept" });
    assert.ok(keep.ok);
    markFork(keep.path, { chain: "chat-kept", commit: keep.commit });
    const dev = join(dirname(dir), "proj-dev");
    git(dir, "worktree", "add", "-q", "-b", "dev", dev);
    const listed = await forksOf(dir);
    assert.deepEqual(listed.ok && listed.forks.map((f) => f.chain).sort(), ["chat-gone", "chat-kept"], "the developer's worktree is no fork");
    writeFileSync(join(gonePath, "a.txt"), "edited in the fork\n");
    writeFileSync(join(gonePath, "new.txt"), "new in the fork\n");
    linkDir(join(dir, "node_modules"), join(gonePath, "node_modules"));
    /** @type {string[]} */
    const said = [];
    const r = await dropForksOf(["chat-gone"], { folders: [dir, dev], log: (_l, m) => said.push(m) });
    assert.deepEqual(r.gone.map((g) => [g.chain, g.kept]), [["chat-gone", forkKeptRef("chat-gone")]]);
    assert.deepEqual(r.stayed, []);
    assert.equal(existsSync(gonePath), false);
    assert.deepEqual([git(dir, "show", `${forkKeptRef("chat-gone")}:a.txt`), git(dir, "show", `${forkKeptRef("chat-gone")}:new.txt`)], ["edited in the fork", "new in the fork"], "what it held is kept");
    assert.ok(said.some((m) => m.includes(forkKeptRef("chat-gone"))), "the log says where");
    assert.equal(readFileSync(join(dir, "node_modules", "pkg", "index.js"), "utf8"), "module.exports = 1;\n", "the junction was never followed");
    assert.deepEqual([existsSync(keep.path), existsSync(dev)], [true, true]);
    // A fork with nothing uncommitted, a commit made on it: the commit is kept.
    commit(keep.path, "c.txt");
    const at = git(keep.path, "rev-parse", "HEAD");
    const k = await dropForksOf(["chat-kept"], { folders: [dir] });
    assert.deepEqual(k.gone.map((g) => g.kept), [forkKeptRef("chat-kept")]);
    assert.equal(git(dir, "rev-parse", forkKeptRef("chat-kept")), at);
    assert.equal(existsSync(keep.path), false);
    const after = await forksOf(dir);
    assert.deepEqual(after.ok && after.forks, []);
    assert.equal(existsSync(dev), true);
  });

  /** A fork of `chain`'s made from the repository's last commit and marked for it, as forkSession makes one. @param {string} dir @param {string} chain @param {string} [suffix] */
  const forkOf = async (dir, chain, suffix = chain) => {
    git(dir, "update-ref", `refs/filament/snapshots/${chain}/1`, "HEAD");
    const f = await addWorktree(dir, { ref: `refs/filament/snapshots/${chain}/1`, suffix });
    assert.ok(f.ok, !f.ok ? f.error : "");
    markFork(f.path, { chain, commit: f.commit });
    return f;
  };
  /** Two spellings of one folder, compared as Windows compares them. @param {string} a @param {string} b */
  const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

  // (fails before: yes — the review of 11-09: its removal dropped git's record of it, the submodules' git folders in it,
  // and kept only their commits' ids)
  test("a deleted chat's fork holding submodules stays, and says why", async () => {
    const sub = repo();
    const dir = repo();
    git(dir, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "lib");
    git(dir, "commit", "-qm", "lib");
    const f = await forkOf(dir, "chat-sub");
    git(f.path, "-c", "protocol.file.allow=always", "submodule", "update", "--init", "-q");
    writeFileSync(join(f.path, "lib", "in-sub.txt"), "work in the submodule\n");
    /** @type {string[]} */
    const said = [];
    const r = await dropForksOf(["chat-sub"], { folders: [dir], log: (_l, m) => said.push(m) });
    assert.deepEqual([r.gone.map((g) => g.chain), r.stayed.map((s) => s.why)], [[], ["it holds submodules, whose git folders would go with it"]]);
    assert.equal(readFileSync(join(f.path, "lib", "in-sub.txt"), "utf8"), "work in the submodule\n");
    assert.ok(said.some((m) => /stays: it holds submodules/.test(m)), "the log says why");
    const listed = await forksOf(dir);
    assert.deepEqual(listed.ok && listed.forks.map((x) => [x.chain, x.submodules]), [["chat-sub", true]], "a list of the forks says it too");
  });

  // (fails before: yes — the review of 11-09: no one was asked whether the folder was in use, and it was moved away
  // under them)
  test("a deleted chat's fork whose folder someone uses stays, and says who: a chat at work there, its own chat still at work, a project in it, another chat in it", async () => {
    const dir = repo();
    /** @type {Record<string, string>} */
    const at = {};
    for (const chain of ["chat-a", "chat-b", "chat-c", "chat-d", "chat-e"]) at[chain] = (await forkOf(dir, chain)).path;
    const project = join(at["chat-c"], "app");
    const r = await dropForksOf(Object.keys(at), {
      folders: [dir],
      chatsIn: (paths) => new Map(paths.map((p) => [p, same(p, at["chat-a"]) ? [{ id: "w1", name: "Working one" }] : same(p, at["chat-d"]) ? [{ id: "x1", name: "Lives here" }] : []])),
      projects: () => [project],
      atWork: () => new Set(["w1", "chat-b"]),
    });
    assert.deepEqual(
      new Map(r.stayed.map((s) => [s.chain, s.why])),
      new Map([
        ["chat-a", "“Working one” works here now"],
        ["chat-b", "its chat was still at work as it was deleted"],
        ["chat-c", `the project at ${project} is in it`],
        ["chat-d", "“Lives here” works in it"],
      ]),
    );
    assert.deepEqual(r.gone.map((g) => g.chain), ["chat-e"], "nobody uses its folder: it goes");
    assert.deepEqual(["chat-a", "chat-b", "chat-c", "chat-d", "chat-e"].map((c) => existsSync(at[c])), [true, true, true, true, false]);
  });

  // (fails before: yes — the review of 11-09: git's record of it was dropped, and with it all that reached those commits)
  test("a deleted chat's fork whose folder is gone has the commits made on it kept before git's record of it goes", async () => {
    const dir = repo();
    const f = await forkOf(dir, "chat-lost");
    commit(f.path, "made-there.txt");
    const tip = git(f.path, "rev-parse", "HEAD");
    rmSync(f.path, { recursive: true, force: true });
    const r = await dropForksOf(["chat-lost"], { folders: [dir] });
    assert.deepEqual(r.gone.map((g) => [g.chain, g.kept]), [["chat-lost", forkKeptRef("chat-lost")]]);
    assert.equal(git(dir, "rev-parse", forkKeptRef("chat-lost")), tip, "the commit made on it is kept");
    const after = await forksOf(dir);
    assert.deepEqual(after.ok && after.forks, [], "git's record of it went");
  });

  // (fails before: yes — the review of 11-09: a record's gitdir was read against Filament's working folder, so one git
  // wrote relative to its own folder, as worktree.useRelativePaths has it write, was never found)
  test("making a fork drops its own stale record where git keeps it relative to the record's folder", async () => {
    const dir = repo();
    const a = await forkOf(dir, "chat-rel");
    const record = String(/^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(a.path, ".git"), "utf8"))?.[1]);
    // As git 2.48 writes it with worktree.useRelativePaths on: this machine's git writes them whole.
    writeFileSync(join(record, "gitdir"), `${relative(record, join(a.path, ".git")).replace(/\\/g, "/")}\n`);
    rmSync(a.path, { recursive: true, force: true });
    const b = await addWorktree(dir, { ref: "refs/filament/snapshots/chat-rel/1", suffix: "chat-rel" });
    assert.ok(b.ok, !b.ok ? b.error : "");
    const records = join(dir, ".git", "worktrees");
    const naming = readdirSync(records).filter((n) => same(resolve(join(records, n), readFileSync(join(records, n, "gitdir"), "utf8").trim()), join(a.path, ".git")));
    assert.equal(naming.length, 1, "the stale record went before git made the new one");
  });

  // (fails before: yes — the review of 11-09: refs/filament/forks/ was read as a ref nothing knew the use of, which no
  // Clean up could take)
  test("the footprint names what a deleted chat's fork held, by its chat, and a Clean up takes it only ticked", async () => {
    const dir = repo();
    const head = git(dir, "rev-parse", "HEAD");
    git(dir, "update-ref", forkKeptRef("chat-gone"), head);
    git(dir, "update-ref", forkKeptRef("chat-else"), head);
    const fp = createFootprint({
      home: fresh("filament-data-"),
      archive: () => ({
        chainIds: () => [],
        hasChain: () => false,
        snapshotRefsNamed: () => new Set(),
        goneChains: () => new Map([["chat-gone", { helpers: [], at: Date.now() }]]),
        goneSince: () => Date.now() + 60_000,
      }),
    });
    const read = /** @type {any} */ (await fp.read(dir, { refs: true }));
    assert.ok(read.ok, read.error);
    const kinds = new Map(read.refs.kinds.map((/** @type {any} */ k) => [k.kind, k]));
    assert.deepEqual([kinds.get("other")?.count, kinds.get("forks")?.count, kinds.get("forks")?.tick, kinds.get("forks")?.goes], [0, 2, 2, 0], "no longer refs nothing knows the use of");
    const held = "what its fork's folder held as its chat was deleted: edits, files or commits nothing else keeps";
    assert.deepEqual(
      kinds.get("forks").groups.map((/** @type {any} */ g) => [g.owner, g.part, g.count, g.goes, g.tick, g.why]),
      [
        ["chat-else", "kept", 1, false, true, `${held}; no record shows this Filament made it`],
        ["chat-gone", "kept", 1, false, true, `${held}; you deleted its chat`],
      ],
    );
    const none = await fp.clean(dir, { copies: [], left: [], refs: [], branches: [] });
    assert.ok(none.ok);
    assert.deepEqual([none.went.refs.forks, refsUnder(dir, "refs/filament/forks/").length], [0, 2], "unticked, it stays");
    const ticked = kinds.get("forks").groups.find((/** @type {any} */ g) => g.owner === "chat-gone").refs;
    const done = await fp.clean(dir, { copies: [], left: [], refs: ticked, branches: [] });
    assert.ok(done.ok);
    assert.equal(done.went.refs.forks, 1);
    assert.deepEqual(refsUnder(dir, "refs/filament/forks/"), [forkKeptRef("chat-else")]);
  });
});

// ---- 3 and 5 in a running Filament ----------------------------------------------------------------------------------

describe("a running Filament's deletes", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = fresh("filament-deletes-");
    shim = await startApp({ memory: true, configure: (cfg) => (cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" }) });
  });
  after(async () => {
    await shim.stop();
  });
  const archive = () => /** @type {any} */ (shim.app).memory.archive;
  /** A fork of `chain`'s, marked as forkSession marks one, with an edit in it. @param {string} dir @param {string} chain @param {string} [suffix] */
  const editedFork = async (dir, chain, suffix = chain) => {
    git(dir, "update-ref", `refs/filament/snapshots/${chain}/1`, "HEAD");
    const f = await addWorktree(dir, { ref: `refs/filament/snapshots/${chain}/1`, suffix });
    assert.ok(f.ok, !f.ok ? f.error : "");
    markFork(f.path, { chain, commit: f.commit });
    writeFileSync(join(f.path, "a.txt"), "edited in the fork\n");
    return f.path;
  };
  /** What the app logs at `level` while `fn` runs and until `done` holds of it. @param {"info" | "warn"} level @param {() => Promise<unknown>} fn @param {(said: string[]) => boolean} done */
  const logged = async (level, fn, done) => {
    /** @type {string[]} */
    const said = [];
    const was = console[level];
    console[level] = (/** @type {unknown[]} */ ...a) => void said.push(a.map(String).join(" "));
    try {
      await fn();
      await until(() => done(said), `the log to say it: ${said.join(" | ")}`);
    } finally {
      console[level] = was;
    }
    return said;
  };

  // (fails before: yes — the review of 11-09: a project's delete took its row before its chats' delete was heard, so its
  // repository was looked in by nothing, and its chats' forks stayed)
  test("deleting a project removes its chats' forks, what they held kept on a ref", async () => {
    const dir = repo(join(root, "proj"));
    const chat = archive().chainForKey("n:fork-of-a-project", { cwd: dir });
    const path = await editedFork(dir, chat.id);
    const r = await shim.api(`/api/memory/projects/${chat.project_id}/delete`, { method: "POST" });
    assert.equal(r.status, 200, await r.clone().text());
    await until(() => !existsSync(path), "the deleted project's chat's fork to go");
    assert.equal(git(dir, "show", `${forkKeptRef(chat.id)}:a.txt`), "edited in the fork");
  });

  // (fails before: yes — the review of 11-09: the fork's folder was moved away under the project and the chat in it)
  test("a deleted chat's fork a project or another chat is in stays, and the log says why", async () => {
    const dir = repo(join(root, "proj2"));
    const gone = archive().chainForKey("n:fork-gone", { cwd: dir });
    const withChat = await editedFork(dir, gone.id);
    const withProject = await editedFork(dir, gone.id, `${gone.id}-b`);
    archive().chainForKey("n:works-in-fork", { project: gone.project_id, cwd: dir, meta: { cwd: withChat } });
    archive().ensureProject(withProject);
    const said = await logged(
      "warn",
      async () => assert.equal((await shim.api(`/api/memory/sessions/${gone.id}/delete`, { method: "POST", body: {} })).status, 200),
      (s) => s.filter((m) => m.includes(`of deleted chat ${gone.id} stays`)).length === 2,
    );
    assert.ok(said.some((m) => m.includes(`stays: the project at ${withProject} is in it`)), said.join("\n"));
    assert.ok(said.some((m) => m.includes("stays: an untitled chat works in it")), said.join("\n"));
    assert.deepEqual([readFileSync(join(withChat, "a.txt"), "utf8"), readFileSync(join(withProject, "a.txt"), "utf8")], ["edited in the fork\n", "edited in the fork\n"]);
  });

  // (fails before: yes — the review of 11-09, part 3: the chat's row went before its delete was heard, and the turn lock
  // knows a turn by the chat's key alone, so its own turn was read as no one's and its fork moved away under it; and a
  // fork that stayed was never tried again)
  test("a deleted chat's fork whose own turn still runs stays, and goes, what it held kept, once that turn ends", async () => {
    const dir = repo(join(root, "proj3"));
    const chat = archive().chainForKey("n:fork-own-turn", { cwd: dir });
    const path = await editedFork(dir, chat.id);
    const turns = /** @type {any} */ (shim.app).sessionTurns;
    const key = archive().getChain(chat.id).key;
    const lock = turns.acquire(key, { window: "harness", client: "harness" });
    assert.equal(lock.ok, true);
    let held = true;
    try {
      /** @type {string[]} */
      const said = [];
      const was = { warn: console.warn, info: console.info };
      console.warn = console.info = (/** @type {unknown[]} */ ...a) => void said.push(a.map(String).join(" "));
      try {
        assert.equal((await shim.api(`/api/memory/sessions/${chat.id}/delete`, { method: "POST", body: {} })).status, 200);
        await until(() => said.some((m) => m.includes(`of deleted chat ${chat.id}`)), "the log to say what came of its fork");
      } finally {
        Object.assign(console, was);
      }
      assert.ok(said.some((m) => m.includes(`of deleted chat ${chat.id} stays: its chat was still at work as it was deleted`)), said.join("\n"));
      assert.equal(readFileSync(join(path, "a.txt"), "utf8"), "edited in the fork\n");
      turns.release(key, lock.token);
      held = false;
      await until(() => !existsSync(path), "its fork to go once its chat's turn ended");
      assert.equal(git(dir, "show", `${forkKeptRef(chat.id)}:a.txt`), "edited in the fork", "what it held is kept");
    } finally {
      if (held) turns.release(key, lock.token);
    }
  });
});

// ---- 6. branch worktrees --------------------------------------------------------------------------------------------

describe("branch worktrees", () => {
  // (fails before: yes — the owner's of 11-09: a place said nothing of its age, nor of the branch it was made from)
  test("each says its age and whether the branch it was made from — else the main folder's — has every commit of it; Remove worktree and branch only then", async () => {
    const dir = repo();
    const made = await makeWorktree(dir, "feat");
    assert.ok(made.ok);
    commit(made.folder, "f.txt");
    const read = async (/** @type {string} */ path) => {
      const wt = await worktreesOf(dir);
      const w = wt.worktrees.find((x) => x.path.toLowerCase() === git(path, "rev-parse", "--show-toplevel").toLowerCase());
      assert.ok(w);
      return readWorktree(w, { into: wt.worktrees.find((x) => x.main)?.branch || null });
    };
    let p = await read(made.folder);
    assert.deepEqual([p.mergedInto, p.merged], ["main", false]);
    assert.ok(Math.abs(Number(p.age.commit) - Date.now()) < 120_000 && Number(p.age.folder) > 0, "its last commit and its folder's time");
    assert.equal(heldBack(p, [], { branch: true }), "its branch holds commits main lacks");
    git(dir, "merge", "-q", "--ff-only", "feat");
    p = await read(made.folder);
    assert.deepEqual([p.merged, heldBack(p, [], { branch: true })], [true, null]);
    writeFileSync(join(made.folder, "loose.txt"), "x\n");
    p = await read(made.folder);
    assert.equal(heldBack(p, [], { branch: true }), "1 file uncommitted");
    // Made from a worktree on another branch: compared with that one, which Filament recorded.
    git(dir, "branch", "develop");
    const dev = join(dirname(dir), "proj-develop");
    git(dir, "worktree", "add", "-q", dev, "develop");
    const fromDev = await makeWorktree(dev, "feat2");
    assert.ok(fromDev.ok);
    commit(fromDev.folder, "g.txt");
    git(dev, "merge", "-q", "--ff-only", "feat2");
    p = await read(fromDev.folder);
    assert.deepEqual([p.mergedInto, p.merged, p.ahead], ["develop", true, 1], "merged into develop, which main lacks");
    assert.equal(heldBack(p, [], { branch: true }), null);
    // A detached one has no branch to remove.
    const detached = join(dirname(dir), "proj-detached");
    git(dir, "worktree", "add", "-q", "--detach", detached);
    p = await read(detached);
    assert.deepEqual([p.mergedInto, p.merged, heldBack(p, [], { branch: true })], [null, null, "it is on no branch"]);
  });

  test("the places' words: its age, and merged into the branch it was made from", async () => {
    const { ageWords, removeWithBranchSheet } = await import("../src/ui/harness/space/places.js");
    const now = Date.UTC(2026, 10, 9, 12);
    const base = { ok: true, main: false, missing: false, uncommitted: { files: 0 }, base: "main", onBase: false };
    assert.equal(ageWords({ ...base, age: { commit: now - 3 * 86_400_000, folder: now }, ahead: 0, mergedInto: "main", merged: true }, now), "last commit 3 d ago", "merged into main is said by the place's own line");
    assert.equal(ageWords({ ...base, age: { commit: now - 2 * 3_600_000, folder: now }, ahead: 1, mergedInto: "develop", merged: true }, now), "last commit 2 h ago · merged into develop");
    assert.equal(ageWords({ ...base, uncommitted: { files: 2 }, age: { commit: null, folder: now - 120_000 }, ahead: 1, mergedInto: "develop", merged: true }, now), "changed 2 min ago", "merged is said of a clean one only");
    assert.equal(ageWords({ ...base, main: true, age: { commit: now, folder: now } }, now), "");
    const s = removeWithBranchSheet({ name: "proj-feat", path: "/p/proj-feat", branch: "feat", mergedInto: "develop", head: "1a2b3c4d", chats: [], goes: { names: [], more: 0 } });
    assert.equal(s.title, "Remove the worktree proj-feat and its branch?");
    assert.equal(s.lines[0], "The folder goes, and the branch feat with it: develop has every commit of it. Put back makes it again where it is now.");
    assert.match(s.lines[1], /^Nothing uncommitted is in it\./);
  });

  describe("against a real app", () => {
    /** @type {Awaited<ReturnType<typeof startApp>>} */
    let shim;
    /** @type {string} */
    let dir;
    before(async () => {
      dir = repo();
      const root = dirname(dir);
      shim = await startApp({ memory: true, configure: (cfg) => (cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" }) });
    });
    after(async () => {
      await shim.stop();
    });
    const places = async () => (await shim.api(`/api/git/places?cwd=${encodeURIComponent(dir)}`)).json();

    // (fails before: yes — Remove kept the branch on purpose, and nothing offered more)
    test("Remove worktree and branch: offered where merged and clean, checked again at the click, both go; Put back makes the branch again", async () => {
      const made = await makeWorktree(dir, "done");
      assert.ok(made.ok);
      commit(made.folder, "d.txt");
      const row = async () => (await places()).places.find((/** @type {any} */ x) => x.name === basename(made.folder));
      let p = await row();
      assert.deepEqual([p.removableWithBranch, p.whyBranch, p.mergedInto, p.merged, typeof p.age.commit], [false, "its branch holds commits main lacks", "main", false, "number"]);
      const refused = await shim.post("/api/git/places/remove", { cwd: dir, path: p.path, branch: true });
      assert.deepEqual([refused.status, (await refused.json()).error], [409, "not removed: its branch holds commits main lacks"]);
      git(dir, "merge", "-q", "--ff-only", "done");
      // The places' read serves its asks a moment (keptReads), and is read again behind them.
      p = await until(async () => ((await row()).removableWithBranch ? row() : null), "the merged branch's place to offer Remove worktree and branch");
      assert.deepEqual([p.removableWithBranch, p.whyBranch, p.merged], [true, null, true]);
      const tip = git(made.folder, "rev-parse", "HEAD");
      const r = await shim.post("/api/git/places/remove", { cwd: dir, path: p.path, branch: true });
      const body = await r.json();
      assert.equal(r.status, 200, JSON.stringify(body));
      assert.deepEqual([body.removed.branch, body.removed.branchGone], ["done", true]);
      assert.equal(existsSync(made.folder), false);
      assert.equal(git(dir, "branch", "--list", "done"), "", "the branch went with it");
      const back = await shim.post("/api/git/places/put-back", { cwd: dir, id: body.removed.id });
      assert.equal(back.status, 200, await back.clone().text());
      assert.deepEqual([git(made.folder, "symbolic-ref", "--short", "HEAD"), git(dir, "rev-parse", "done")], ["done", tip], "made again where it was");
    });

    // (fails before: yes — the review of 11-09: Put back lives as long as this Filament, and nothing said where a branch
    // that went was, to make it again; a Put back it did not know said "The branch stays." of one that went)
    test("Remove worktree and branch says in the log the commit its branch was at; a Put back Filament cannot do is worded by what it knows of the removal", async () => {
      const made = await makeWorktree(dir, "said");
      assert.ok(made.ok);
      const p = await until(async () => (await places()).places.find((/** @type {any} */ x) => x.name === basename(made.folder) && x.removableWithBranch), "a branch with no commit of its own to offer Remove worktree and branch");
      const tip = git(made.folder, "rev-parse", "HEAD");
      /** @type {string[]} */
      const said = [];
      const was = console.info;
      console.info = (/** @type {unknown[]} */ ...a) => void said.push(a.map(String).join(" "));
      /** @type {any} */
      let body;
      try {
        const r = await shim.post("/api/git/places/remove", { cwd: dir, path: p.path, branch: true });
        body = await r.json();
        assert.equal(r.status, 200, JSON.stringify(body));
      } finally {
        console.info = was;
      }
      assert.ok(said.some((m) => m.includes(`it was at ${tip}: git branch said ${tip} makes it again`)), said.join("\n"));
      const other = repo(join(dirname(dir), "other"));
      const elsewhere = await shim.post("/api/git/places/put-back", { cwd: other, id: body.removed.id });
      assert.deepEqual([elsewhere.status, (await elsewhere.json()).error], [404, `That removal was another repository's. The branch said went with it, at ${tip}.`]);
      const unknown = await shim.post("/api/git/places/put-back", { cwd: dir, id: "a-removal-before-a-restart" });
      const words = String((await unknown.json()).error);
      assert.equal(unknown.status, 404);
      assert.doesNotMatch(words, /The branch stays/);
      assert.match(words, /A branch removed with its worktree is made again at the commit Filament's log names for it/);
      assert.equal((await shim.post("/api/git/places/put-back", { cwd: dir, id: body.removed.id })).status, 200);
    });
  });
});

// ---- the review's second part: the sweep against a helper's work, an index's lock, a mark let go, a share ----------

describe("the review of 11-09, part 2", () => {
  /** A file's text, or null where there is none. @param {string} p */
  const textOf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  /** git's record of a copy, as its `.git` file names it. @param {string} dest */
  const recordOf = (dest) => git(dest, "rev-parse", "--absolute-git-dir");

  /**
   * A helper restored after a crash cut its follow-up: launched once (`c.txt`, captured), then a follow-up wrote
   * `cut.slow` in its copy and Filament went — the copy busy, what the follow-up wrote there alone. Its thread is kept,
   * so the next registry gives it back. `*.slow` files go through the repository's filter `slow`.
   */
  const crashedHelper = async () => {
    const dir = repo();
    writeFileSync(join(dir, ".gitattributes"), "*.slow filter=slow\n");
    git(dir, "add", ".gitattributes");
    git(dir, "commit", "-qm", "attributes");
    /** @type {Map<string, any[]>} */
    const threads = new Map();
    const store = {
      saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
      loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
    };
    const { registry } = workingRegistry(dir, ({ cwd }) => (writeFileSync(join(cwd, "c.txt"), "first\n"), "WROTE"), store);
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    const id = idOf(await launch(door, "toolu_1", "write c.txt"));
    door.close();
    const cwd = join(dir, ".git", "filament-worktrees", id);
    writeFileSync(join(cwd, "cut.slow"), "cut by the restart\n");
    writeFileSync(join(recordOf(cwd), "filament.json"), JSON.stringify({ ...copyMeta(cwd), state: "busy" }));
    letGoOfCopies();
    return { dir, id, store };
  };
  /**
   * The repository's filter `slow`: it keeps a file as it is, and takes `ms` over it — the capture of a copy holding a
   * `*.slow` file holds the copy that long. `began`: it was first run.
   * @param {string} dir @param {number} ms
   */
  const slowFilter = (dir, ms) => {
    const at = fresh("filament-slow-");
    const marker = join(at, "began");
    const script = join(at, "slow.cjs");
    writeFileSync(script, `require("fs").writeFileSync(process.argv[2], "x");const c=[];process.stdin.on("data",(d)=>c.push(d));process.stdin.on("end",()=>setTimeout(()=>process.stdout.write(Buffer.concat(c)),${ms}));`);
    const fwd = (/** @type {string} */ p) => p.replace(/\\/g, "/");
    git(dir, "config", "filter.slow.clean", `"${fwd(process.execPath)}" "${fwd(script)}" "${fwd(marker)}"`);
    return { began: () => existsSync(marker) };
  };

  // (fails before: yes — the review of 11-09: the follow-up read its refs while the sweep held its copy, a capture behind;
  // its copy was reset to that once the sweep let go, and its refs written back to it — what the sweep kept lost)
  test("a restored helper's follow-up asked while the start's sweep keeps its copy's work goes on from what the sweep kept", async () => {
    const { dir, id, store } = await crashedHelper();
    const filter = slowFilter(dir, 1500);
    /** @type {string | null | undefined} */
    let saw;
    const after = workingRegistry(dir, ({ cwd }) => ((saw = textOf(join(cwd, "cut.slow"))), "WENT ON"), store).registry;
    const sweep = sweepTaskWorktrees([dir], { keep: () => new Set(after.treesInUse()) });
    await until(filter.began, "the sweep's capture of the crashed copy to begin");
    const door = after.openTurn({ chainId: "c1", runId: "turn-2", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    try {
      await door.subagents.run({ id: "toolu_2", input: { run_in_background: false, description: "again", agent_id: id, prompt: "go on" }, emit: () => {}, signal: null });
    } finally {
      door.close();
    }
    await sweep;
    assert.equal(saw, "cut by the restart\n", "its copy held what the restart cut as it went on");
    const refs = await taskRefs(dir, id);
    assert.equal(refs && git(dir, "show", `${refs.head}:cut.slow`), "cut by the restart", "and its refs still do");
  });

  // (fails before: yes — the review of 11-09: the apply read the refs while the sweep held the copy, and brought in the
  // capture behind)
  test("a restored helper's apply asked while the start's sweep keeps its copy's work brings in what the sweep kept", async () => {
    const { dir, id, store } = await crashedHelper();
    const filter = slowFilter(dir, 1500);
    const after = workingRegistry(dir, () => "never", store).registry;
    const sweep = sweepTaskWorktrees([dir], { keep: () => new Set(after.treesInUse()) });
    await until(filter.began, "the sweep's capture of the crashed copy to begin");
    const applied = await after.apply(id, "c1", "owner");
    await sweep;
    assert.ok(applied.ok, applied.ok ? "" : applied.error);
    assert.deepEqual([textOf(join(dir, "c.txt")), textOf(join(dir, "cut.slow"))], ["first\n", "cut by the restart\n"]);
  });

  // (fails before: yes — the review of 11-09: a lock git's status or add left as Filament went read as a checkout that
  // never finished, and the copy went with the edits in it)
  test("a whole copy a crash left with git's index lock is kept: its work captured, by the sweep and as its deleted chat lets it go", async () => {
    const dir = repo();
    const a = await openTaskWorktree(dir, { id: "sa_000000c1" });
    const b = await openTaskWorktree(dir, { id: "sa_000000c2" });
    assert.ok(a.ok && b.ok);
    writeFileSync(join(a.wt.workdir, "cut.txt"), "what the crash cut\n");
    writeFileSync(join(b.wt.workdir, "cut.txt"), "what the crash cut, too\n");
    for (const wt of [a.wt, b.wt]) writeFileSync(join(recordOf(wt.dest), "index.lock"), "");
    letGoOfCopies();
    const gone = await letGoTaskWork(dir, "sa_000000c2");
    assert.deepEqual(gone.ok && [gone.copy, gone.waits], ["gone", true], "its copy went, its work waits on its refs");
    const kept = await taskRefs(dir, "sa_000000c2");
    assert.equal(kept && git(dir, "show", `${kept.head}:cut.txt`), "what the crash cut, too");
    await sweepTaskWorktrees([dir]);
    assert.deepEqual(copiesOf(dir), [["sa_000000c1", "parked"]], "the sweep kept the copy");
    const refs = await taskRefs(dir, "sa_000000c1");
    assert.equal(refs && git(dir, "show", `${refs.head}:cut.txt`), "what the crash cut");
  });

  // (fails before: yes — the review of 11-09: its follow-up checked out the commit git had pruned, and failed)
  test("a follow-up after its mark's hold went and git pruned its last work starts from the folder as it stands, and is told so", async () => {
    const dir = repo();
    /** @type {string[]} */
    const asked = [];
    const { registry } = workingRegistry(dir, ({ n, cwd, body }) => {
      if (n === 1) writeFileSync(join(cwd, "m.txt"), "marked\n");
      else asked.push(JSON.stringify(body.messages), String(textOf(join(cwd, "m.txt"))));
      return n === 1 ? "WROTE" : "WENT ON";
    });
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    try {
      const id = idOf(await launch(door, "toolu_1", "write m.txt"));
      const last = (await taskRefs(dir, id))?.head;
      // Brought in by hand, and marked so; its mark's hold gone past its days, its copy let go, and git's gc since.
      writeFileSync(join(dir, "m.txt"), "marked\n");
      const marked = await registry.markTaken(id, "c1", "owner");
      assert.ok(marked.ok, marked.ok ? "" : marked.error);
      assert.ok(await dropMarkHold(dir, id));
      git(dir, "worktree", "remove", "--force", join(dir, ".git", "filament-worktrees", id));
      git(dir, "-c", "gc.reflogExpire=now", "-c", "gc.reflogExpireUnreachable=now", "gc", "-q", "--prune=now");
      assert.throws(() => git(dir, "cat-file", "-e", `${last}^{commit}`), "git pruned its last work");
      const r = await door.subagents.run({ id: "toolu_2", input: { run_in_background: false, description: "again", agent_id: id, prompt: "go on" }, emit: () => {}, signal: null });
      assert.match(r.text, /WENT ON/, r.text);
      assert.match(String(asked[0]), /the copy you worked in last has been let go, with git's record of it/);
      assert.equal(asked[1], "marked\n", "its fresh copy is the folder as it stands");
    } finally {
      door.close();
    }
  });

  // (fails before: yes — the review of 11-09: every known folder was looked at with a sync stat, which held the event
  // loop for as long as the share held it: 21 s on this machine for //192.0.2.1/share, an address nothing answers)
  test("the repositories of the known folders are found without holding the event loop on a share that does not answer", async () => {
    const dir = repo();
    // A share that no longer answers holds a stat until the network gives up (21 s on a Windows machine whose share
    // went): node's own stats play it, slow on its path alone, so the check is the same on every machine and quick.
    // Its name fails at once for real, so what is slow is only what the share would hold.
    const share = "//filament-no-such-host.invalid/share";
    const onShare = (/** @type {any} */ p) => String(p).replace(/\\/g, "/").toLowerCase() === share;
    const real = { statSync: fs.statSync, stat: fsp.stat };
    /** @type {any} */ (fs).statSync = /** @type {any} */ (function (/** @type {any} */ p, /** @type {any[]} */ ...rest) {
      for (const end = Date.now() + 2000; onShare(p) && Date.now() < end; );
      return /** @type {any} */ (real.statSync).call(this, p, ...rest);
    });
    fsp.stat = /** @type {any} */ (async function (/** @type {any} */ p, /** @type {any[]} */ ...rest) {
      if (onShare(p)) await new Promise((r) => setTimeout(r, 2000));
      return /** @type {any} */ (real.stat).call(this, p, ...rest);
    });
    syncBuiltinESMExports();
    try {
      const t0 = Date.now();
      const tick = new Promise((r) => setTimeout(() => r(Date.now() - t0), 50));
      const found = reposOf([share, dir]);
      const late = Number(await tick);
      assert.ok(late < 1000, `the event loop was held ${late} ms`);
      const { repos } = await found;
      assert.deepEqual(repos.map((r) => resolve(r.folder).toLowerCase() === resolve(dir).toLowerCase()), [true]);
    } finally {
      /** @type {any} */ (fs).statSync = real.statSync;
      fsp.stat = real.stat;
      syncBuiltinESMExports();
    }
  });
});

// ---- the review's third part: the safer Remove, forks tried again, a deleted chat's turn, relative records, captures --

describe("the review of 11-09, part 3", () => {
  /** A fork of `chain`'s made from the repository's last commit and marked for it, as forkSession makes one. @param {string} dir @param {string} chain */
  const forkOf = async (dir, chain) => {
    git(dir, "update-ref", `refs/filament/snapshots/${chain}/1`, "HEAD");
    const f = await addWorktree(dir, { ref: `refs/filament/snapshots/${chain}/1`, suffix: chain });
    assert.ok(f.ok, !f.ok ? f.error : "");
    markFork(f.path, { chain, commit: f.commit });
    return f;
  };
  /** git's record of a copy, as its `.git` file names it. @param {string} dest */
  const recordOf = (dest) => resolve(dest, String(/^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(dest, ".git"), "utf8"))?.[1]));

  // (fails before: yes — the review of 11-09, part 3: the folder's Remove compared its branch with the main folder's, so a
  // worktree whose commits are on the branch it was made from offered Remove worktree and branch, and greyed the safer one)
  test("a branch worktree's folder goes whatever its base lacks — its branch keeps every commit —; a detached one's commits keep it", async () => {
    const dir = repo();
    git(dir, "branch", "develop");
    const dev = join(dirname(dir), "proj-develop");
    git(dir, "worktree", "add", "-q", dev, "develop");
    const made = await makeWorktree(dev, "feat");
    assert.ok(made.ok);
    commit(made.folder, "g.txt");
    git(dev, "merge", "-q", "--ff-only", "feat");
    const read = async (/** @type {string} */ path) => {
      const wt = await worktreesOf(dir);
      const w = wt.worktrees.find((x) => x.path.toLowerCase() === git(path, "rev-parse", "--show-toplevel").toLowerCase());
      assert.ok(w);
      return readWorktree(w, { into: wt.worktrees.find((x) => x.main)?.branch || null });
    };
    let p = await read(made.folder);
    assert.deepEqual([p.ahead, heldBack(p, [], { branch: true }), heldBack(p, [])], [1, null, null], "merged into develop, which main lacks: both go");
    // A commit merged nowhere: the folder goes, the branch keeping it; the branch itself does not.
    commit(made.folder, "h.txt");
    p = await read(made.folder);
    assert.deepEqual([heldBack(p, []), heldBack(p, [], { branch: true })], [null, "its branch holds commits develop lacks"]);
    assert.equal(removeSheet({ ...p, chats: [], goes: { names: [], more: 0 } }).lines[0], "The folder goes. The branch feat stays, with every commit on it.", "never that main has them");
    writeFileSync(join(made.folder, "loose.txt"), "x\n");
    assert.equal(heldBack(await read(made.folder), []), "1 file uncommitted");
    // A detached one: what its commits hold no branch keeps.
    const detached = join(dirname(dir), "proj-detached");
    git(dir, "worktree", "add", "-q", "--detach", detached);
    commit(detached, "d.txt");
    assert.equal(heldBack(await read(detached), []), "it holds 1 commit main lacks");
  });

  // (fails before: yes — the review of 11-09, part 3: who uses a fork's folder was read once, before what it holds was
  // kept — a snapshot that can take a minute —, and the folder moved away under a turn begun meanwhile)
  test("a deleted chat's fork whose folder its chat takes to while what it holds is kept stays, what it held kept", async () => {
    const dir = repo();
    const f = await forkOf(dir, "chat-late");
    writeFileSync(join(f.path, "a.txt"), "edited in the fork\n");
    let asked = 0;
    const r = await dropForksOf(["chat-late"], { folders: [dir], atWork: () => (++asked > 1 ? new Set(["chat-late"]) : new Set()) });
    assert.deepEqual([r.gone, r.stayed.map((s) => [s.chain, s.why])], [[], [["chat-late", "its chat was still at work as it was deleted"]]]);
    assert.equal(readFileSync(join(f.path, "a.txt"), "utf8"), "edited in the fork\n");
    assert.equal(git(dir, "show", `${forkKeptRef("chat-late")}:a.txt`), "edited in the fork", "what it holds is kept already");
  });

  // (fails before: yes — the review of 11-09, part 3: a fork kept at its chat's delete was never tried again)
  test("a deleted chat's fork that stayed is tried again as Filament starts, and goes once nothing keeps it", async () => {
    const root = fresh("filament-forks-again-");
    const roots = (/** @type {any} */ cfg) => (cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" });
    const first = await startApp({ memory: true, keep: true, configure: roots });
    const dir = repo(join(root, "proj"));
    const chat = /** @type {any} */ (first.app).memory.archive.chainForKey("n:fork-locked", { cwd: dir });
    const f = await forkOf(dir, chat.id);
    writeFileSync(join(f.path, "a.txt"), "edited in the fork\n");
    git(dir, "worktree", "lock", "--reason", "on a stick", f.path);
    /** @type {string[]} */
    const said = [];
    const was = console.warn;
    console.warn = (/** @type {unknown[]} */ ...a) => void said.push(a.map(String).join(" "));
    try {
      assert.equal((await first.api(`/api/memory/sessions/${chat.id}/delete`, { method: "POST", body: {} })).status, 200);
      await until(() => said.some((m) => m.includes(`of deleted chat ${chat.id} stays: locked: on a stick`)), `the log to say its fork stays: ${said.join(" | ")}`);
    } finally {
      console.warn = was;
    }
    await first.stop();
    git(dir, "worktree", "unlock", f.path);
    const again = await startApp({ memory: true, dataDir: first.dataDir, configure: roots });
    try {
      await until(() => !existsSync(f.path), "the fork kept at its chat's delete to go as Filament starts");
      assert.equal(git(dir, "show", `${forkKeptRef(chat.id)}:a.txt`), "edited in the fork", "what it held is kept");
    } finally {
      await again.stop();
    }
  });

  // (fails before: yes — the review of 11-09, part 3: the sweep read a record's gitdir against Filament's working folder,
  // and a cut checkout's record was looked for by its gitdir's spelling, so one git keeps relative was never found)
  test("a gone copy's record, and a cut checkout's, go where git keeps their gitdir relative to the record's folder", async () => {
    const dir = repo();
    const a = await openTaskWorktree(dir, { id: "sa_000000d1" });
    const b = await openTaskWorktree(dir, { id: "sa_000000d2" });
    assert.ok(a.ok && b.ok);
    const [ra, rb] = [recordOf(a.wt.dest), recordOf(b.wt.dest)];
    // As git 2.48 writes them with worktree.useRelativePaths on: this machine's git writes them whole.
    for (const [record, dest] of [[ra, a.wt.dest], [rb, b.wt.dest]]) writeFileSync(join(record, "gitdir"), `${relative(record, join(dest, ".git")).replace(/\\/g, "/")}\n`);
    // A checkout cut before git wrote its `.git` file: it goes whole, its record with it.
    rmSync(join(b.wt.dest, ".git"));
    await forgetTaskWorktree(dir, b.wt.dest);
    assert.deepEqual([existsSync(b.wt.dest), existsSync(rb)], [false, false], "the cut checkout's record went with it");
    // A copy's folder removed by hand: the start's sweep drops its record.
    letGoOfCopies();
    await rm(a.wt.dest, { recursive: true, force: true });
    await sweepTaskWorktrees([dir]);
    assert.equal(existsSync(ra), false, "the gone copy's record went");
  });

  /** The registry's later steps that wait as long as a capture's next try at least, which the test brings on. */
  const laterTries = () => {
    /** @type {(() => void)[]} */
    const due = [];
    return { due, later: (/** @type {() => void} */ fn, /** @type {number} */ ms) => (ms >= SAVE_AGAIN_MS ? void due.push(fn) : void setTimeout(fn, ms).unref?.()) };
  };

  // (fails before: yes — the review of 11-09, part 3: its copy stayed in use, its work in it alone, until a restart)
  test("a helper whose capture fails as its chat is deleted under it has its capture tried again, and its copy let go once its work is kept", async () => {
    const dir = repo();
    let id = "";
    const tries = laterTries();
    const { registry } = workingRegistry(
      dir,
      ({ cwd }) => {
        id = basename(cwd);
        writeFileSync(join(cwd, "made.txt"), "by the helper\n");
        writeFileSync(lockOf(dir, id, "work"), "");
        // Its chat is deleted while it works.
        void registry.forgetChat("c1");
        return "WROTE";
      },
      { later: tries.later },
    );
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    try {
      assert.match((await launch(door, "toolu_1", "write a file")).text, /its work could not be captured/);
    } finally {
      door.close();
    }
    const dest = join(dir, ".git", "filament-worktrees", id);
    assert.equal(copyState(dest), "busy", "in use while its work is in it alone");
    rmSync(lockOf(dir, id, "work"), { force: true });
    for (const fn of tries.due.splice(0)) fn();
    await until(() => copiesOf(dir).length === 0, "its copy to be let go once its work is kept");
    assert.deepEqual([registry.treesInUse().includes(id), registry.failedCaptures()], [false, []]);
    const refs = await taskRefs(dir, id);
    assert.equal(refs && git(dir, "show", `${refs.head}:made.txt`), "by the helper", "its work waits on its refs");
  });

  // (fails before: yes — as above: the delete let go of every copy of its but this one, in use)
  test("a helper whose capture failed before its chat was deleted has its capture tried at the delete, and again later while it fails", async () => {
    const dir = repo();
    let id = "";
    const tries = laterTries();
    const { registry } = workingRegistry(
      dir,
      ({ cwd }) => {
        id = basename(cwd);
        writeFileSync(join(cwd, "made.txt"), "by the helper\n");
        writeFileSync(lockOf(dir, id, "work"), "");
        return "WROTE";
      },
      { later: tries.later },
    );
    const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
    try {
      await launch(door, "toolu_1", "write a file");
    } finally {
      door.close();
    }
    assert.deepEqual([registry.failedCaptures().map((f) => f.id), tries.due.length], [[id], 0], "its chat lives: its next exchange keeps its work");
    await registry.forgetChat("c1");
    await until(() => tries.due.length > 0, "its capture, tried at the delete and failing still, to be tried again later");
    assert.equal(copyState(join(dir, ".git", "filament-worktrees", id)), "busy", "never let go with its work in it alone");
    rmSync(lockOf(dir, id, "work"), { force: true });
    for (const fn of tries.due.splice(0)) fn();
    await until(() => copiesOf(dir).length === 0, "its copy to be let go once its work is kept");
    assert.deepEqual([registry.treesInUse().includes(id), registry.failedCaptures()], [false, []]);
    const refs = await taskRefs(dir, id);
    assert.equal(refs && git(dir, "show", `${refs.head}:made.txt`), "by the helper", "its work waits on its refs");
  });
});
