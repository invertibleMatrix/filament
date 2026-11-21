// @ts-check
// The places in a project (HarnessV4_Git_Plan step 4): the worktrees git lists for a repository, Filament's helper
// copies left out (GWC-42, GWC-90), each read whole with why it offers no Remove (GW-D10, GWC-43, GWC-45, GWC-81,
// GWC-82, GWC-88, GWC-91, GWC-92); what goes with a folder (GW-D36, GWC-79); a removal that never follows a link
// (GW-D35, GWC-78, GWC-80) and its Put back (GW-D37, GWC-84); and the three admin rows against a real app: the chats in
// each worktree (GW-D39, GWC-46, GWC-96), the check at the click (GW-D40, GWC-83, GWC-93, GWC-94), Put back after a
// removal.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { goesWith, heldBack, parseWorktrees, putBack, readWorktree, removeWorktree, worktreesOf } from "../src/adapters/git/places.js";
import { taskWorktreePath } from "../src/adapters/git/worktree.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

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
/** A fresh folder under the system's temp, as the filesystem spells it. @param {string} prefix */
const fresh = (prefix) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
/** A repository with one commit on `branch`, ignoring what a worktree's ignored files would be. @param {string} dir @param {string} [branch] */
const repoIn = (dir, branch = "main") => {
  mkdirSync(dir, { recursive: true });
  run(dir, ["init", "-q", "-b", branch]);
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n.env\nbuild/\n");
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "init"]);
  return dir;
};
/** A commit of one new file. @param {string} dir @param {string} name */
const commit = (dir, name) => {
  writeFileSync(join(dir, name), `${name}\n`);
  run(dir, ["add", name]);
  run(dir, ["commit", "-q", "-m", name]);
};
/** git's spelling of a folder. @param {string} dir */
const top = (dir) => run(dir, ["rev-parse", "--show-toplevel"]);
/** A link to a folder: a junction on Windows, as a developer's or Filament's helper's would be. @param {string} target @param {string} at */
const linkDir = (target, at) => symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
/** The worktree `path` as `worktreesOf` lists it. @param {string} repo @param {string} path */
const listed = async (repo, path) => {
  const w = (await worktreesOf(repo)).worktrees.find((x) => x.path === top(path));
  assert.ok(w, `${path} is listed`);
  return w;
};

describe("parseWorktrees", () => {
  // (fails before: yes — nothing read `git worktree list`)
  test("each worktree's fields: branch, detached, locked with and without a reason, prunable, bare, a branch with no commit", () => {
    const z = [
      "worktree /r", "HEAD 1111111111111111111111111111111111111111", "branch refs/heads/main", "",
      "worktree /r-x", "HEAD 2222222222222222222222222222222222222222", "detached", "locked on a stick", "",
      "worktree /r-y", "HEAD 0000000000000000000000000000000000000000", "branch refs/heads/new", "locked", "",
      "worktree /r-z", "HEAD 3333333333333333333333333333333333333333", "branch refs/heads/z", "prunable gitdir file points to non-existent location", "",
      "worktree /bare.git", "bare", "", "",
    ].join("\0");
    assert.deepEqual(
      parseWorktrees(z).map((w) => [w.path, w.head?.slice(0, 3) ?? null, w.branch, w.detached, w.locked, w.prunable, w.bare]),
      [
        ["/r", "111", "main", false, null, null, false],
        ["/r-x", "222", null, true, "on a stick", null, false],
        ["/r-y", null, "new", false, "", null, false],
        ["/r-z", "333", "z", false, null, "gitdir file points to non-existent location", false],
        ["/bare.git", null, null, false, null, null, true],
      ],
    );
  });
});

describe("a repository's worktrees, read", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {string} */
  let base;
  /** @type {string} */
  let repo;
  before(async () => {
    base = fresh("filament-places-");
    repo = repoIn(join(base, "proj"));
    run(repo, ["worktree", "add", "-q", "-b", "done", join(base, "proj-done")]);
    run(repo, ["worktree", "add", "-q", "-b", "busy", join(base, "proj-busy")]);
    commit(join(base, "proj-busy"), "b.txt");
    run(repo, ["worktree", "add", "-q", "-b", "gone", join(base, "proj-gone")]);
    rmSync(join(base, "proj-gone"), { recursive: true, force: true });
    run(repo, ["worktree", "add", "-q", "-b", "kept", join(base, "proj-kept")]);
    run(repo, ["worktree", "lock", "--reason", "on a stick", join(base, "proj-kept")]);
    const copy = /** @type {string} */ (await taskWorktreePath(repo, "helper1"));
    run(repo, ["worktree", "add", "-q", "--detach", copy]);
  });

  // (fails before: yes — nothing listed a repository's worktrees)
  test("the main folder first, then each worktree; a helper's copy left out; a gone one listed by git (GWC-42, GWC-43)", async () => {
    const wt = await worktreesOf(join(base, "proj-done"));
    assert.equal(wt.ok, true, wt.error || "");
    assert.equal(wt.main, top(repo));
    assert.deepEqual(
      wt.worktrees.map((w) => [w.path.split("/").pop(), w.main, w.branch, w.prunable !== null, w.locked]),
      [
        ["proj", true, "main", false, null],
        ["proj-busy", false, "busy", false, null],
        ["proj-done", false, "done", false, null],
        ["proj-gone", false, "gone", true, null],
        ["proj-kept", false, "kept", false, "on a stick"],
      ],
    );
    assert.equal((await worktreesOf(fresh("filament-places-none-"))).error, "not in a git repository");
  });

  // (fails before: yes — no worktree said why it could not be removed)
  test("why each offers no Remove: the main folder, gone, locked, uncommitted, a chat at work — never a branch's commits its base lacks (GW-D10)", async () => {
    const why = async (/** @type {string} */ name, /** @type {string[]} */ atWork = []) => heldBack(await readWorktree(await listed(repo, join(base, name))), atWork);
    assert.equal(await why("proj"), "the repository's main folder", "GWC-88");
    const gone = (await worktreesOf(repo)).worktrees.find((w) => w.path.endsWith("/proj-gone"));
    assert.equal(heldBack(await readWorktree(/** @type {any} */ (gone)), []), "its folder is gone", "GWC-43");
    assert.equal(await why("proj-kept"), "locked: on a stick", "GWC-81");
    // Its branch keeps the commit main lacks: only its folder goes (the review of 11-09); the branch does not go with it.
    assert.equal(await why("proj-busy"), null, "GWC-45");
    assert.equal(heldBack(await readWorktree(await listed(repo, join(base, "proj-busy")), { into: "main" }), [], { branch: true }), "its branch holds commits main lacks");
    assert.equal(await why("proj-done"), null, "clean and merged: it may go");
    assert.equal(await why("proj-done", ["fix login"]), "“fix login” works here now", "GWC-46");
    assert.equal(await why("proj-done", ["a", "b"]), "2 chats work here now");
    writeFileSync(join(base, "proj-done", "loose.txt"), "x\n");
    try {
      assert.equal(await why("proj-done"), "1 file uncommitted", "an untracked file is uncommitted work (GWC-45)");
    } finally {
      rmSync(join(base, "proj-done", "loose.txt"));
    }
  });

  // (fails before: yes — as above)
  test("a detached worktree of yours: Remove only where its base has its commit (GWC-82); submodules held back (GWC-91)", async () => {
    const det = join(base, "proj-det");
    run(repo, ["worktree", "add", "-q", "--detach", det]);
    const w = await listed(repo, det);
    assert.equal(w.detached, true);
    assert.equal(heldBack(await readWorktree(w), []), null);
    commit(det, "d.txt");
    assert.equal(heldBack(await readWorktree(w), []), "it holds 1 commit main lacks");
    run(det, ["checkout", "-q", "--detach", "main"]);
    mkdirSync(join(run(det, ["rev-parse", "--path-format=absolute", "--git-dir"]), "modules", "lib"), { recursive: true });
    assert.equal(heldBack(await readWorktree(w), []), "it holds submodules, whose git folders would go with it");
  });

  // (fails before: yes — as above)
  test("no base branch to compare a detached one with (GWC-92) — a branch's folder needs none —; a branch with no commit yet", async () => {
    const r = repoIn(join(base, "odd"), "work");
    const wt = join(base, "odd-x");
    run(r, ["worktree", "add", "-q", "-b", "x", wt]);
    assert.equal(heldBack(await readWorktree(await listed(r, wt)), []), null, "its branch keeps its commits (the review of 11-09)");
    const det = join(base, "odd-det");
    run(r, ["worktree", "add", "-q", "--detach", det]);
    assert.equal(heldBack(await readWorktree(await listed(r, det)), []), "no base branch to compare with");
    const unborn = join(base, "odd-new");
    run(r, ["worktree", "add", "-q", "--orphan", "-b", "fresh", unborn]);
    assert.equal(heldBack(await readWorktree(await listed(r, unborn)), []), "its branch has no commit yet");
  });

  // (fails before: yes — nothing said what goes with a folder)
  test("what git ignores goes with the folder, a link named as a link (GW-D36, GWC-79)", async () => {
    const wt = join(base, "proj-done");
    mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
    // git looks through a junction as through a folder: an empty one would be listed by no one.
    writeFileSync(join(repo, "node_modules", "dep", "index.js"), "x\n");
    linkDir(join(repo, "node_modules"), join(wt, "node_modules"));
    writeFileSync(join(wt, ".env"), "S=1\n");
    mkdirSync(join(wt, "build"));
    writeFileSync(join(wt, "build", "out.js"), "x\n");
    try {
      const goes = await goesWith(top(wt));
      assert.deepEqual(
        goes?.names.map((n) => [n.path, n.link]).sort(),
        [[".env", false], ["build/", false], ["node_modules/", true]],
      );
      assert.equal(goes?.more, 0);
      assert.equal(heldBack(await readWorktree(await listed(repo, wt)), []), null, "ignored files are not uncommitted work");
    } finally {
      for (const p of ["node_modules", ".env", "build"]) rmSync(join(wt, p), { recursive: true, force: true });
    }
  });
});

describe("removing a worktree and putting it back", { skip: !hasGit && "git is not on PATH" }, () => {
  // (fails before: yes — git's own `worktree remove` follows the junction: on Windows it emptied the main folder's
  // node_modules in the probe of 10-16)
  test("the folder goes, git's record of it too, and a junction inside it is taken alone: what it points at stays (GWC-78)", async () => {
    const base = fresh("filament-places-rm-");
    const repo = repoIn(join(base, "proj"));
    mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "dep", "index.js"), "kept\n");
    const wt = join(base, "proj-x");
    run(repo, ["worktree", "add", "-q", "-b", "x", wt]);
    linkDir(join(repo, "node_modules"), join(wt, "node_modules"));
    mkdirSync(join(wt, "deep"));
    linkDir(join(repo, "node_modules"), join(wt, "deep", "nm"));
    writeFileSync(join(wt, ".env"), "S=1\n");
    const out = await removeWorktree(repo, top(wt));
    assert.deepEqual(out, { ok: true, left: null });
    assert.equal(existsSync(wt), false, "the folder is gone");
    assert.equal(readFileSync(join(repo, "node_modules", "dep", "index.js"), "utf8"), "kept\n", "the main folder's node_modules is whole");
    assert.deepEqual((await worktreesOf(repo)).worktrees.map((w) => w.branch), ["main"], "git no longer lists it");
    assert.equal(run(repo, ["rev-parse", "--verify", "-q", "refs/heads/x"]).length > 0, true, "the branch stays");
    assert.deepEqual(readdirSync(base), ["proj"], "nothing is left beside it");

    // Put back: the branch at the same folder (GW-D37); a second Put back finds the folder there (GWC-84).
    assert.deepEqual(await putBack(repo, { path: top(repo).replace(/proj$/, "proj-x"), branch: "x", head: "" }), { ok: true });
    assert.equal(run(wt, ["symbolic-ref", "--short", "HEAD"]), "x");
    assert.equal(existsSync(join(wt, "a.txt")), true);
    assert.match(/** @type {any} */ (await putBack(repo, { path: top(wt), branch: "x", head: "" })).error, /^something is at .*proj-x again$/);
  });

  // (fails before: yes, under Electron's Node — HarnessV3-Native NA1: inside the desktop app the folder's deletion stopped at
  // a read-only file, and half the folder was left; plain node's sync form takes it, so `npm run test:desktop` runs this
  // file under Electron's Node, where it proves the fix)
  test("a worktree holding a read-only file — a package's, a nested repository's — goes whole", async () => {
    const base = fresh("filament-places-ro-");
    const repo = repoIn(join(base, "proj"));
    const wt = join(base, "proj-x");
    run(repo, ["worktree", "add", "-q", "-b", "x", wt]);
    mkdirSync(join(wt, "vendor"));
    writeFileSync(join(wt, "vendor", "locked.js"), "x\n");
    chmodSync(join(wt, "vendor", "locked.js"), 0o444);
    assert.deepEqual(await removeWorktree(repo, top(wt)), { ok: true, left: null });
    assert.deepEqual(readdirSync(base), ["proj"], "nothing is left beside it");
  });

  // (fails before: yes — as above)
  test("Put back says git's reason where the branch is gone, and makes nothing (GWC-84); a detached one goes back to its commit", async () => {
    const base = fresh("filament-places-pb-");
    const repo = repoIn(join(base, "proj"));
    const wt = join(base, "proj-x");
    run(repo, ["worktree", "add", "-q", "-b", "x", wt]);
    const path = top(wt);
    assert.equal((await removeWorktree(repo, path)).ok, true);
    run(repo, ["branch", "-D", "x"]);
    const r = /** @type {any} */ (await putBack(repo, { path, branch: "x", head: "" }));
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid reference|not a valid|x/);
    assert.equal(existsSync(wt), false, "nothing half made");
    const head = run(repo, ["rev-parse", "HEAD"]);
    assert.deepEqual(await putBack(repo, { path, branch: null, head }), { ok: true });
    assert.equal(run(wt, ["rev-parse", "HEAD"]), head);
    assert.equal(run(wt, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD", "detached, as it was");
  });

  // (fails before: yes — as above; Windows only: a file held open is what keeps a folder from moving there)
  test("a program holding a file in it: nothing removed, and the reason said (GWC-80)", { skip: process.platform !== "win32" && "only Windows keeps a folder with an open file from moving" }, async () => {
    const base = fresh("filament-places-held-");
    const repo = repoIn(join(base, "proj"));
    const wt = join(base, "proj-x");
    run(repo, ["worktree", "add", "-q", "-b", "x", wt]);
    const fd = openSync(join(wt, "a.txt"), "r");
    try {
      const r = /** @type {any} */ (await removeWorktree(repo, top(wt)));
      assert.equal(r.ok, false);
      assert.match(r.error, /^a program is using it \(E[A-Z]+\): close what works there, then remove it again$/);
      assert.equal(existsSync(join(wt, "a.txt")), true, "the folder is whole");
      assert.equal((await worktreesOf(repo)).worktrees.length, 2, "git still lists it");
    } finally {
      closeSync(fd);
    }
  });
});

describe("the places rows against a real app", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let base;
  /** @type {string} */
  let repo;
  /** @type {string} */
  let done;
  /** @type {string} */
  let outside;
  before(async () => {
    base = fresh("filament-places-app-");
    repo = repoIn(join(base, "proj"));
    done = join(base, "proj-done");
    run(repo, ["worktree", "add", "-q", "-b", "done", done]);
    run(repo, ["worktree", "add", "-q", "-b", "busy", join(base, "proj-busy")]);
    commit(join(base, "proj-busy"), "b.txt");
    outside = join(fresh("filament-places-out-"), "proj-out");
    run(repo, ["worktree", "add", "-q", "-b", "out", outside]);
    up = await fakeUpstream(() => anthropicReply("Done.", { model: "brain-model" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [base], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });
  const enc = encodeURIComponent;
  /** A chat in `cwd`, named by its first words; its id. @param {string} cwd @param {string} words */
  const chatIn = async (cwd, words) => {
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 100, messages: [{ role: "user", content: words }] }, { "x-filament-cwd": cwd, "x-session-id": `places-${words}` });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await shim.record(r.headers.get("x-filament-request-id"))).memory.chain);
  };
  const places = async () => (await shim.api(`/api/git/places?cwd=${enc(repo)}`)).json();

  // (fails before: yes — the rows are new)
  test("GET /api/git/places: each worktree with its chats and Remove or why not; one outside the roots unread (GW-D38, GW-D39, GWC-89, GWC-96)", async () => {
    const inDone = await chatIn(done, "fix the login redirect");
    const fromMain = await chatIn(repo, "work on main");
    /** @type {any} */ (shim.app).memory.followPlace(fromMain, top(done));
    const p = await places();
    assert.equal(p.ok, true, p.error || "");
    assert.equal(p.name, "proj");
    const row = (/** @type {string} */ path) => p.places.find((/** @type {any} */ x) => x.path === top(path) || x.path.endsWith(path.split(/[\\/]/).pop()));
    assert.deepEqual(
      p.places.map((/** @type {any} */ x) => [x.name, x.main, x.branch, x.removable, x.why]),
      [
        ["proj", true, "main", false, "the repository's main folder"],
        ["proj-busy", false, "busy", true, null],
        ["proj-done", false, "done", true, null],
        ["proj-out", false, "out", false, `${top(outside)} is not under any folder listed in agentLoop.roots`],
      ],
    );
    assert.deepEqual(
      row(done).chats.map((/** @type {any} */ c) => [c.id, c.atWork, c.home]).sort(),
      [[fromMain, false, false], [inDone, false, true]].sort(),
      "its own chat, whose folder is there, and the one whose agent wrote there",
    );
    assert.deepEqual(row(repo).chats.map((/** @type {any} */ c) => [c.id, c.home]), [[fromMain, true]]);
    assert.deepEqual(row(done).goes, { names: [], more: 0 });
    assert.equal(row(outside).refused, true);
    assert.equal(row(outside).goes, null);
    assert.deepEqual(p.removed, []);
    assert.equal((await shim.api(`/api/git/places?cwd=${enc(join(base, "nope"))}`)).status, 404, "fenced like every git row");
  });

  // (fails before: yes — as above)
  test("Remove is checked again at the click: a turn running there, a file written since, a folder that is no worktree (GW-D40)", async () => {
    const app = /** @type {any} */ (shim.app);
    const id = await chatIn(done, "a turn that runs");
    const lock = await app.sessionTurns.acquire(app.memory.archive.getChain(id).key, { window: "harness", client: "harness" });
    assert.equal(lock.ok, true);
    try {
      const r = await shim.post("/api/git/places/remove", { cwd: repo, path: top(done) });
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error, "not removed: “a turn that runs” works here now", "GWC-46");
    } finally {
      app.sessionTurns.release(app.memory.archive.getChain(id).key, lock.token);
    }
    writeFileSync(join(done, "loose.txt"), "x\n");
    try {
      const r = await shim.post("/api/git/places/remove", { cwd: repo, path: top(done) });
      assert.deepEqual([r.status, (await r.json()).error], [409, "not removed: 1 file uncommitted"], "GWC-83");
    } finally {
      rmSync(join(done, "loose.txt"));
    }
    const no = await shim.post("/api/git/places/remove", { cwd: repo, path: join(base, "elsewhere") });
    assert.equal(no.status, 404, "GWC-93");
    assert.equal(existsSync(join(done, "a.txt")), true, "nothing was removed");
  });

  // (fails before: yes — as above)
  test("Remove, then the removed row with Put back; each twice at once acts once (GWC-44, GWC-94); Put back (GW-D37)", async () => {
    const [a, b] = await Promise.all([
      shim.post("/api/git/places/remove", { cwd: repo, path: top(done) }),
      shim.post("/api/git/places/remove", { cwd: repo, path: top(done) }),
    ]);
    const answers = [[a.status, await a.json()], [b.status, await b.json()]].sort((x, y) => Number(x[0]) - Number(y[0]));
    assert.equal(answers[0][0], 200, JSON.stringify(answers));
    // The second is told it is under way, or, where the first ended before the second read the list, not found.
    assert.ok([404, 409].includes(Number(answers[1][0])), JSON.stringify(answers));
    assert.match(/** @type {any} */ (answers[1][1]).error, /being removed already|not a worktree of this repository/);
    const gone = /** @type {any} */ (answers[0][1]).removed;
    assert.deepEqual([gone.name, gone.branch], ["proj-done", "done"]);
    assert.equal(existsSync(done), false);
    const p = await places();
    assert.deepEqual(p.places.map((/** @type {any} */ x) => x.name), ["proj", "proj-busy", "proj-out"]);
    assert.deepEqual(p.removed.map((/** @type {any} */ x) => [x.id, x.name, x.branch]), [[gone.id, "proj-done", "done"]]);
    const backs = await Promise.all([1, 2].map(() => shim.post("/api/git/places/put-back", { cwd: repo, id: gone.id })));
    const twice = (await Promise.all(backs.map(async (r) => [r.status, await r.json()]))).sort((x, y) => Number(x[0]) - Number(y[0]));
    assert.equal(twice[0][0], 200, JSON.stringify(twice));
    assert.ok([404, 409].includes(Number(twice[1][0])), JSON.stringify(twice));
    assert.match(/** @type {any} */ (twice[1][1]).error, /being put back already|does not know that removal/);
    assert.equal(run(done, ["symbolic-ref", "--short", "HEAD"]), "done");
    const again = await places();
    assert.deepEqual([again.places.map((/** @type {any} */ x) => x.name), again.removed], [["proj", "proj-busy", "proj-done", "proj-out"], []]);
    const stale = await shim.post("/api/git/places/put-back", { cwd: repo, id: gone.id });
    assert.equal(stale.status, 404, "a removal put back, or one from before a restart, is unknown (GWC-85)");
  });

  // (fails before: yes — the owner's of 11-09: Remove left the chat whose folder it took naming that folder, and its
  // coding agent then worked in the home folder)
  test("Remove with moveChats: the chats of Filament's own whose folder it is move to the main folder first, then it goes; one that cannot move keeps every chat and it where they are", async () => {
    const app = /** @type {any} */ (shim.app);
    const same = (/** @type {string} */ a, /** @type {string} */ b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
    /** A chat of Filament's own in `cwd`, as the page makes one; its id. @param {string} cwd */
    const ownChat = async (cwd) => {
      const made = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "brain-model" } });
      assert.equal(made.status, 200, await made.clone().text());
      return String((await made.json()).id);
    };
    const cwdOf = (/** @type {string} */ id) => String(app.memory.archive.getChain(id).meta.cwd);
    // One works in a folder of the branch's own, which the main folder lacks: neither it nor the chat beside it moves,
    // and the worktree stands (the review of the first cut: chats moved one by one, the first gone before the second
    // was refused).
    const stuck = join(base, "proj-stuck");
    run(repo, ["worktree", "add", "-q", "-b", "stuck", stuck]);
    mkdirSync(join(stuck, "only-here"));
    commit(stuck, "only-here/a.txt");
    const deep = await ownChat(join(stuck, "only-here"));
    const beside = await ownChat(stuck);
    const refused = await shim.post("/api/git/places/remove", { cwd: repo, path: top(stuck), moveChats: true });
    const no = await refused.json();
    assert.equal(refused.status, 409, JSON.stringify(no));
    // (fails before: yes — the refusal ended "that folder of its place", the code's word for a folder or worktree)
    assert.equal(no.error, "not removed: an untitled chat cannot move to proj — only-here would not be in proj: the chat works in that folder of its repository");
    assert.equal(existsSync(stuck), true, "the worktree stands");
    assert.ok(same(cwdOf(beside), top(stuck)) && same(cwdOf(deep), join(top(stuck), "only-here")), "no chat moved");
    // Filament's own chat moves and the worktree goes; a client's session there is its client's, which names its folder.
    const mv = join(base, "proj-mv");
    run(repo, ["worktree", "add", "-q", "-b", "mv", mv]);
    const chat = await ownChat(mv);
    const client = await chatIn(mv, "a client session there");
    const listed = app.memory.chatsIn([top(mv)]).get(top(mv)) || [];
    assert.deepEqual(listed.map((/** @type {any} */ c) => [c.id, c.own]).sort(), [[chat, true], [client, false]].sort(), "each chat says whether it is one of Filament's own");
    const r = await shim.post("/api/git/places/remove", { cwd: repo, path: top(mv), moveChats: true });
    const yes = await r.json();
    assert.equal(r.status, 200, JSON.stringify(yes));
    assert.deepEqual(yes.moved.map((/** @type {any} */ c) => c.id), [chat]);
    assert.equal(existsSync(mv), false, "the worktree went");
    const meta = app.memory.archive.getChain(chat).meta;
    assert.ok(same(meta.cwd, top(repo)), `its folder is the main folder: ${meta.cwd}`);
    assert.equal(meta.moves.length, 1, "moved as Move moves a chat, its move kept");
    // Its Move back would take it into the folder that is gone (the review of the first cut).
    const back = await shim.post(`/api/sessions/${encodeURIComponent(chat)}/move/back`, { id: meta.moves[0].id });
    const said = await back.json();
    assert.equal(back.status, 409, JSON.stringify(said));
    assert.match(said.error, /^not moved back: .+ is gone$/);
    assert.ok(same(cwdOf(chat), top(repo)), "it stays in the main folder");
  });

  // (fails before: yes — nothing said which places a chat works in alone, so what its commands changed in its own
  // worktree was "whose, git cannot tell": the owner's opus55 in H:\filament-wt)
  test("the places only one chat works in: none another chat's folder is in, none another's agents wrote in (GW-D57, GWC-134)", async () => {
    const mem = /** @type {any} */ (shim.app).memory;
    const busy = join(base, "proj-busy");
    const own = await chatIn(busy, "tidy the busy branch");
    await chatIn(repo, "one more on main");
    await chatIn(done, "one more in done");
    const [p, d, b] = [top(repo), top(done), top(busy)];
    assert.deepEqual([...mem.placesAlone(own, [p, d, b, b, ""])], [b], "its folder alone is its; the main folder and done have other chats");
    assert.deepEqual([...mem.placesAlone(own, [])], []);
    // Another chat's agent writes there: it is no longer the first chat's alone.
    const other = await chatIn(repo, "another on main");
    mem.followPlace(other, b);
    assert.deepEqual([...mem.placesAlone(own, [b])], []);
    assert.deepEqual([...mem.placesAlone(other, [b])], [], "nor the other's: the first chat's folder is there");
  });
});
