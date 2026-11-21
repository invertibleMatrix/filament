// @ts-check
// The project each folder stands in, asked of the server (`POST /api/memory/projects/of`, HarnessV4_Git_Plan GW-D46):
// the new chat's menu folds a worktree's folder into its repository's project, as the left bar groups its chats, by the
// rule a chat's create files it under — never its own guess at git.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startApp } from "./helpers/app.js";
import { projectIdOf } from "../src/core/project-id.js";

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

describe("the project each folder stands in", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let base;
  /** @type {string} */
  let repo;
  /** @type {string} */
  let wt;
  /** @type {string} */
  let plain;
  before(async () => {
    base = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-pof-")));
    repo = join(base, "app");
    mkdirSync(join(repo, "src"), { recursive: true });
    run(repo, ["init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "src", "a.txt"), "a\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-q", "-m", "init"]);
    wt = join(base, "app-space");
    run(repo, ["worktree", "add", "-q", "-b", "space", wt]);
    plain = join(base, "notes");
    mkdirSync(plain);
    shim = await startApp({ memory: true });
  });
  after(async () => {
    await shim?.stop();
    rmSync(base, { recursive: true, force: true });
  });
  /** @param {unknown[]} paths */
  const ask = async (paths) => {
    const r = await shim.api("/api/memory/projects/of", { method: "POST", body: { paths } });
    assert.equal(r.status, 200, await r.clone().text());
    return /** @type {any[]} */ ((await r.json()).projects);
  };

  // (fails before: yes — the route is new; the menu offered each worktree's folder as a project of its own)
  test("a worktree's folder and its subfolders stand in the main folder's project; a plain folder in its own", async () => {
    const [main, inWt, deeper, own] = await ask([repo, wt, join(wt, "src"), plain]);
    assert.deepEqual([main.id, main.cwd, main.name, main.known], [projectIdOf(repo), repo, "app", false], "no chat yet: computed, never made");
    assert.deepEqual([inWt.id, inWt.cwd, inWt.name], [main.id, repo, "app"], "the worktree is the repository's project");
    assert.deepEqual([deeper.id, deeper.cwd], [projectIdOf(join(repo, "src")), join(repo, "src")], "the same place in the main folder");
    assert.deepEqual([own.id, own.cwd, own.name], [projectIdOf(plain), plain, "notes"]);
    const listed = await (await shim.api("/api/memory/projects")).json();
    assert.ok(!listed.projects.some((/** @type {any} */ p) => p.id === main.id), "asking made no project row");
  });

  test("a project the archive has is named as it names it, and known", async () => {
    const made = await (await shim.api("/api/memory/projects", { method: "POST", body: { cwd: repo } })).json();
    const [inWt] = await ask([wt]);
    assert.deepEqual([inWt.id, inWt.cwd, inWt.name, inWt.known], [made.id, made.cwd, made.name, true]);
  });

  test("an empty path, a network share and a path that is not whole are answered null, never asked of the disk", async () => {
    const out = await ask(["", "\\\\fileserver\\share\\app", "app-space", 7]);
    assert.deepEqual(out, [null, null, null, null], "a share: the page asks unprompted, as with /files/exists; a part path would be read against the server's folder");
    const none = await (await shim.api("/api/memory/projects/of", { method: "POST", body: {} })).json();
    assert.deepEqual(none.projects, []);
  });
});
