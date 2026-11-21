// @ts-check
// The one project rule takes worktrees in (HarnessV4_Git_Plan GW-D46, GW-D8): a folder inside a linked worktree
// stands in the project of the same place in its repository's main folder; a submodule, a bare repository's worktree
// and every other folder stay their own (GWC-113, GWC-114). A live request in a worktree finds its chain under the main
// folder's project and keeps its own folder (GW-D47, GWC-110).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { projectFolderOf } from "../src/services/project-folder.js";
import { chainLookup, projectOf } from "../src/services/memory/brain.js";
import { normalizeCwd, projectIdOf } from "../src/core/project-id.js";
import { taskWorktreePath } from "../src/adapters/git/worktree.js";
import { callAgentMemoryTool } from "../src/app/memory-tools.js";
import { world } from "./fixtures/memory-world.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
/** @type {string[]} */
const made = [];
// git's objects are read-only: the promise form, which Electron's Node removes too (HarnessV3-Native NA1).
after(async () => {
  for (const d of made.reverse()) await rm(d, { recursive: true, force: true });
});
/** @param {string} prefix */
const fresh = (prefix) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
/** @param {string} dir */
const repoIn = (dir) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  run(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "src", "a.txt"), "one\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "init"]);
  return dir;
};
const same = (/** @type {string} */ a, /** @type {string} */ b) => assert.equal(normalizeCwd(a), normalizeCwd(b), `${a} is ${b}`);

describe("the folder a folder's project is made of", { skip: !hasGit && "git is not on PATH" }, () => {
  const base = fresh("filament-projfolder-");
  const repo = repoIn(join(base, "proj"));
  const wt = join(base, "proj-fix");
  run(repo, ["worktree", "add", "-q", "-b", "fix", wt]);

  // (fails before: yes — every folder was its own project)
  test("a worktree's top folder and a folder inside it stand in the main folder's, at the same place (GW-D46)", () => {
    same(projectFolderOf(wt), repo);
    same(projectFolderOf(join(wt, "src")), join(repo, "src"));
    same(projectFolderOf(`${wt}/`), repo);
  });

  // (fails before: no — the main folder and other folders were always their own)
  test("the main folder, a folder inside it and a folder outside any repository are their own, spelled as given", () => {
    assert.equal(projectFolderOf(repo), repo);
    assert.equal(projectFolderOf(join(repo, "src")), join(repo, "src"));
    const plain = fresh("filament-projfolder-plain-");
    assert.equal(projectFolderOf(plain), plain);
    assert.equal(projectFolderOf(""), "");
    assert.equal(projectFolderOf(join(base, "not-there")), join(base, "not-there"), "a folder that is gone is its own");
  });

  // (fails before: yes — a helper's copy was a project of its own, inside the git folder)
  test("a helper's own copy inside the repository's git folder stands in the main folder's project (GWC-113)", async () => {
    const copy = /** @type {string} */ (await taskWorktreePath(repo, "t1"));
    run(repo, ["worktree", "add", "-q", "--detach", copy]);
    same(projectFolderOf(copy), repo);
  });

  // (fails before: no — as before)
  test("a submodule's .git file (no commondir) and a bare repository's worktree stay their own (GWC-114)", () => {
    const sub = join(base, "sub");
    mkdirSync(join(base, "subrecord"), { recursive: true });
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, ".git"), `gitdir: ${join(base, "subrecord")}\n`);
    assert.equal(projectFolderOf(sub), sub);
    const bare = join(base, "store.git");
    run(base, ["clone", "-q", "--bare", repo, bare]);
    const fromBare = join(base, "from-bare");
    run(bare, ["worktree", "add", "-q", "-b", "b", fromBare]);
    assert.equal(projectFolderOf(fromBare), fromBare);
  });

  // (fails before: yes — the request's project was the worktree's own)
  test("a request's project in a worktree: the main folder's id and name, its own folder kept (GW-D46)", () => {
    const p = projectOf({ cwdHint: wt });
    assert.equal(p.cwd, wt);
    same(p.home, repo);
    assert.equal(p.id, projectIdOf(repo));
    assert.equal(p.name, "proj");
    const m = projectOf({ cwdHint: repo });
    assert.deepEqual([m.cwd, m.home, m.id], [repo, repo, projectIdOf(repo)]);
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, memory's project lookup: the folder a request named was
  // asked of the disk whatever the folder rules said, a network share's of its computer)
  test("a folder the disk may not be asked of stands in its own project, as written: the lookup asks the rules, then nothing of it", () => {
    assert.equal(projectFolderOf(wt, { asks: false }), wt);
    assert.equal(projectFolderOf(`${wt}/`, { asks: false }), wt, "spelled as given, its last separator dropped");
    /** @type {string[]} */
    const asked = [];
    const p = projectOf({ cwdHint: wt, mayAsk: (/** @type {string} */ f) => (asked.push(f), false) });
    assert.deepEqual([p.cwd, p.home, p.id], [wt, wt, projectIdOf(wt)]);
    assert.deepEqual(asked, [wt], "the rules are asked of the folder the request named");
    same(projectOf({ cwdHint: wt, mayAsk: () => true }).home, repo); // one that may be asked: the main folder's
  });

  // (fails before: yes — the same: memory's doors asked the disk of every folder a request, an outside agent or an agent's
  // memory tool named)
  test("memory asks its folder rules at each door: a request it situates, an outside agent's stand, and an agent's memory tool", async () => {
    await world({}, async (/** @type {any} */ w) => {
      w.svc.mayAsk = (/** @type {string} */ f) => normalizeCwd(f) !== normalizeCwd(wt);
      assert.equal(w.svc.mcpStand({ cwd: wt }).project, projectIdOf(wt), "an outside agent's folder, as written");
      const sit = w.svc.brain.situate({ format: "anthropic", body: { model: "m", messages: [{ role: "user", content: "hello" }] }, headers: {}, cwdHint: wt });
      assert.equal(sit?.project?.home, wt, "a request's folder, as written");
      const kept = JSON.parse(await callAgentMemoryTool(w.svc, "filament_memory_remember", { text: "The fix branch ships on Fridays." }, { cwd: wt, upstream: "qoder" }));
      assert.equal(w.svc.archive.items.get(Number(String(kept.id).slice(1))).project_id, projectIdOf(wt), "an agent's memory tool, its folder as written");
      assert.equal(w.svc.mcpStand({ cwd: join(wt, "src") }).project, projectIdOf(join(repo, "src")), "a folder it may ask: the main folder's, as before");
    });
  });

  // (fails before: yes — the chain was opened with the worktree's folder and no folder of its own)
  test("a chain born in a worktree is filed under the main folder and keeps its own folder; one in the main folder keeps none (GW-D47)", () => {
    const at = (/** @type {string} */ cwd) => chainLookup({ project: projectOf({ cwdHint: cwd }), headers: {}, client: "claude-code", model: "m" });
    const inWt = at(wt);
    assert.equal(inWt.project, projectIdOf(repo));
    same(String(inWt.cwd), repo);
    assert.deepEqual(inWt.meta, { cwd: wt });
    const inMain = at(repo);
    assert.equal(inMain.cwd, repo);
    assert.equal("meta" in inMain, false);
  });
});
