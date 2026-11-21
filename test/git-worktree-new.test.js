// @ts-check
// A chat's first send in a new worktree (HarnessV4_Git_Plan step 5). The name judged as git would (GWC-106); the plan
// read before the send: branch, folder, the folder the chat works in, the commit it starts at, what stays behind
// (GW-D45, GWC-103, GWC-104, GWC-105, GWC-107, GWC-117), a taken name with a free one (GWC-48); the make, its branch
// first and no hook run (GW-D11), so two sends of one name make one (GWC-112), a checkout that fails leaves no branch;
// the take-back (GWC-108). Against a real app: the plan's row, a chat made in a new worktree under the main folder's
// project (GW-D8, GWC-109), a made name that gives way (GW-D44), refusals that make nothing, an existing worktree's
// folder as a chat's (GW-D49), a live client in a worktree (GWC-110), and Memory's excluded folders (GW-D48, GWC-111).
// And a flow's own worktree (HarnessV4_OneAgent_Plan OA5): made where it can be, else why the folder is used.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { badName, makeWorktree, ownWorktree, planWorktree, putBack, removeWorktree, takeBack, worktreeFolder } from "../src/adapters/git/places.js";
import { normalizeCwd, projectIdOf } from "../src/core/project-id.js";
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
const hasLfs =
  hasGit &&
  (() => {
    try {
      execFileSync("git", ["lfs", "version"], { stdio: "ignore", windowsHide: true });
      return true;
    } catch {
      return false;
    }
  })();
/**
 * `fn` run with the system's temp folder a folder of its own, and the hooks' folders Filament's commands made there and
 * left (`hooks`): the shared one holds other test files' hooks' folders, their commands running meanwhile.
 * @template T @param {() => Promise<T>} fn @returns {Promise<{ value: T, hooks: string[] }>}
 */
const ownTemp = async (fn) => {
  const own = mkdtempSync(join(tmpdir(), "filament-wtnew-temp-"));
  /** @type {Record<string, string | undefined>} */
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  for (const k of Object.keys(saved)) process.env[k] = own;
  try {
    assert.equal(tmpdir(), own, "the commands' temp folder is the test's own");
    const value = await fn();
    return { value, hooks: readdirSync(own).filter((n) => n.startsWith("filament-no-hooks-")) };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(own, { recursive: true, force: true });
  }
};
/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made.reverse()) rmSync(d, { recursive: true, force: true });
});
/** A fresh folder under the system's temp, as the filesystem spells it. @param {string} prefix */
const fresh = (prefix) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
/** A repository on `main` with `src/a.txt` committed and node_modules ignored. @param {string} dir */
const repoIn = (dir) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  run(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "src", "a.txt"), "one\n");
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
const same = (/** @type {unknown} */ a, /** @type {string} */ b) => assert.equal(normalizeCwd(a), normalizeCwd(b), `${a} is ${b}`);
/** The branches of a repository. @param {string} repo */
const branches = (repo) => run(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).split(/\r?\n/).filter(Boolean).sort();
/** The worktrees git lists, by folder name. @param {string} repo */
const listed = (repo) =>
  run(repo, ["worktree", "list", "--porcelain"])
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9).split("/").pop());

describe("badName", () => {
  // (fails before: yes — no name was judged)
  test("each of git's rules for a branch name, in words; a name it takes passes git's own check too (GWC-106)", () => {
    const cases = [
      ["", "a name is needed"],
      ["x".repeat(61), "at most 60 characters"],
      ["fix login", "only letters, digits and . _ - /"],
      ["fix:x", "only letters, digits and . _ - /"],
      ["-x", "it cannot start with “-”"],
      ["/x", "it cannot start with “/”"],
      ["x/", "it cannot end with “/”"],
      ["x.", "it cannot end with “.”"],
      ["fix..x", "it cannot hold “..”"],
      ["a//b", "it cannot hold “//”"],
      ["a/.b", "no part of it can start with “.” or end with “.lock”"],
      ["a.lock/b", "no part of it can start with “.” or end with “.lock”"],
      ["HEAD", "git keeps that name for itself"],
    ];
    assert.deepEqual(cases.map(([n]) => [n, badName(n)]), cases);
    for (const name of ["fix-login", "feat/x.y_z", "Fix-2", "a.b"]) {
      assert.equal(badName(name), null, name);
      if (hasGit) assert.equal(spawnSync("git", ["check-ref-format", "--branch", name], { windowsHide: true }).status, 0, `git takes ${name}`);
    }
  });

  // (fails before: yes — no folder was made for a name)
  test("the new folder sits beside the main folder, named after it and the name, a / as a - (GW-D45)", () => {
    assert.equal(worktreeFolder(join("H:", "work", "proj"), "feat/x"), join("H:", "work", "proj-feat-x"));
  });
});

describe("planWorktree", { skip: !hasGit && "git is not on PATH" }, () => {
  const base = fresh("filament-wtnew-plan-");
  const repo = repoIn(join(base, "proj"));
  const head = run(repo, ["rev-parse", "HEAD"]);
  const short = run(repo, ["rev-parse", "--short", "HEAD"]);

  // (fails before: yes — nothing planned a worktree)
  test("from the main folder: its branch, its folder, its commit; what stays behind counted, what git ignores not (GWC-103)", async () => {
    writeFileSync(join(repo, "loose.txt"), "x\n");
    mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "dep", "i.js"), "x\n");
    try {
      const p = await planWorktree(repo, "fix-login");
      assert.equal(p.ok, true, JSON.stringify(p));
      if (!p.ok) return;
      same(p.main, repo);
      same(p.folder, join(base, "proj-fix-login"));
      same(p.cwd, join(base, "proj-fix-login"));
      assert.deepEqual(
        { name: p.name, repo: p.repo, here: p.here, branch: p.branch, from: p.from, commit: p.commit, uncommitted: p.uncommitted, bad: p.bad, taken: p.taken, free: p.free, refused: p.refused, lacks: p.lacks },
        { name: "fix-login", repo: "proj", here: "proj", branch: "fix-login", from: { branch: "main", head: short }, commit: head, uncommitted: 1, bad: null, taken: null, free: null, refused: null, lacks: null },
      );
      assert.equal(existsSync(join(base, "proj-fix-login")), false, "a plan makes nothing");
      assert.deepEqual(branches(repo), ["main"]);
    } finally {
      rmSync(join(repo, "loose.txt"));
      rmSync(join(repo, "node_modules"), { recursive: true });
    }
  });

  // (fails before: yes — as above)
  test("from a subfolder, the chat works in the same subfolder of the new worktree (GWC-117)", async () => {
    const p = await planWorktree(join(repo, "src"), "sub");
    assert.ok(p.ok);
    same(p.cwd, join(base, "proj-sub", "src"));
    same(p.folder, join(base, "proj-sub"));
  });

  // (fails before: yes — as above)
  test("from a worktree: its commit and branch, the folder beside the main folder; from a detached commit, that commit (GWC-104, GWC-105)", async () => {
    const agent = join(base, "proj-agent");
    run(repo, ["worktree", "add", "-q", "-b", "agent", agent]);
    commit(agent, "b.txt");
    const p = await planWorktree(agent, "next");
    assert.ok(p.ok);
    same(p.main, repo);
    same(p.folder, join(base, "proj-next"));
    assert.deepEqual([p.here, p.from.branch, p.commit], ["proj-agent", "agent", run(agent, ["rev-parse", "HEAD"])]);
    const loose = join(base, "proj-loose");
    run(repo, ["worktree", "add", "-q", "--detach", loose, head]);
    const d = await planWorktree(loose, "again");
    assert.ok(d.ok);
    assert.deepEqual([d.from, d.commit], [{ branch: null, head: short }, head]);
  });

  // (fails before: yes — a folder git does not track was planned as the chat's, and its create failed after the make)
  test("a subfolder git does not track, or spelled in another case: the commit's folder is read (GW-D50, GWC-119)", async () => {
    mkdirSync(join(repo, "scratch", "exp"), { recursive: true });
    writeFileSync(join(repo, "scratch", "exp", "n.txt"), "x\n");
    mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
    try {
      const untracked = await planWorktree(join(repo, "scratch", "exp"), "s");
      assert.equal(untracked.ok && untracked.lacks, "scratch/exp");
      const ignored = await planWorktree(join(repo, "node_modules", "dep"), "s");
      assert.equal(ignored.ok && ignored.lacks, "node_modules/dep");
      if (process.platform === "win32") {
        const other = await planWorktree(join(repo, "SRC"), "s");
        assert.equal(other.ok && other.lacks, null, "SRC is src on this filesystem");
        same(other.ok && other.cwd, join(base, "proj-s", "src"));
      }
    } finally {
      rmSync(join(repo, "scratch"), { recursive: true });
      rmSync(join(repo, "node_modules"), { recursive: true });
    }
  });

  // (fails before: yes — as above)
  test("a taken name: by a branch (in any case) or by a folder, with the first free one (GWC-48)", async () => {
    run(repo, ["branch", "fix", "main"]);
    run(repo, ["branch", "fix-2", "main"]);
    const byBranch = await planWorktree(repo, "FIX");
    assert.ok(byBranch.ok);
    assert.deepEqual([byBranch.taken, byBranch.free], ["branch", "FIX-3"]);
    mkdirSync(join(base, "proj-stray"));
    const byFolder = await planWorktree(repo, "stray");
    assert.ok(byFolder.ok);
    assert.deepEqual([byFolder.taken, byFolder.free], ["folder", "stray-2"]);
  });

  // (fails before: yes — as above)
  test("a name that is no branch name has no branch or folder; the roots' refusal is said; no repository, no commit: not ok (GWC-106, GWC-107)", async () => {
    const bad = await planWorktree(repo, "fix..x");
    assert.ok(bad.ok);
    assert.deepEqual([bad.bad, bad.branch, bad.folder, bad.cwd, bad.taken, bad.refused], ["it cannot hold “..”", null, null, null, null, null]);
    const refused = await planWorktree(repo, "out", { refuse: (f) => `${f} is not yours` });
    assert.ok(refused.ok);
    assert.match(String(refused.refused), /proj-out is not yours$/);
    const plain = await planWorktree(fresh("filament-wtnew-plain-"), "x");
    assert.equal(plain.ok, false);
    const empty = join(base, "empty");
    mkdirSync(empty);
    run(empty, ["init", "-q", "-b", "main"]);
    assert.deepEqual(await planWorktree(empty, "x"), { ok: false, error: "its branch has no commit yet: a worktree starts at a commit" });
  });
});

describe("makeWorktree and takeBack", { skip: !hasGit && "git is not on PATH" }, () => {
  const base = fresh("filament-wtnew-make-");
  const repo = repoIn(join(base, "proj"));
  // A hook that leaves a mark where it runs: a worktree made by Filament runs none (GW-D11).
  writeFileSync(join(repo, ".git", "hooks", "post-checkout"), "#!/bin/sh\necho ran > hook-ran\n");
  if (process.platform !== "win32") execFileSync("chmod", ["+x", join(repo, ".git", "hooks", "post-checkout")]);

  // (fails before: yes — nothing made a worktree)
  test("made: its branch at the folder's commit, checked out in the folder beside, the chat's folder the same subfolder; no hook ran, nothing left beside it", async () => {
    writeFileSync(join(repo, "src", "loose.txt"), "x\n");
    try {
      const tried = await ownTemp(() => makeWorktree(join(repo, "src"), "fix-login"));
      const m = tried.value;
      assert.equal(m.ok, true, JSON.stringify(m));
      if (!m.ok) return;
      same(m.folder, join(base, "proj-fix-login"));
      same(m.cwd, join(base, "proj-fix-login", "src"));
      assert.equal(run(m.folder, ["symbolic-ref", "--short", "HEAD"]), "fix-login");
      assert.equal(run(m.folder, ["rev-parse", "HEAD"]), run(repo, ["rev-parse", "HEAD"]));
      assert.equal(existsSync(join(m.cwd, "a.txt")), true);
      assert.equal(existsSync(join(m.cwd, "loose.txt")), false, "an uncommitted file stays where it was");
      assert.equal(existsSync(join(m.folder, "hook-ran")), false, "no hook ran");
      // The hooks pointed at an empty folder of their own under the temp folder, made for each command and gone with it.
      assert.deepEqual(readdirSync(base).sort(), ["proj", "proj-fix-login"], "nothing beside the worktree");
      assert.deepEqual(tried.hooks, [], "the hooks' folders went with their commands");
      // The same hook does run for a worktree git makes by itself: the mark above means something.
      run(repo, ["worktree", "add", "-q", "-b", "control", join(base, "proj-control")]);
      assert.equal(existsSync(join(base, "proj-control", "hook-ran")), true, "git's own worktree add runs it");
    } finally {
      rmSync(join(repo, "src", "loose.txt"));
    }
  });

  // (fails before: yes — as above)
  test("a taken name is refused with the free one; Filament's own name takes the free one (GWC-48, GW-D44)", async () => {
    const no = await makeWorktree(repo, "fix-login");
    assert.deepEqual(no, { ok: false, error: "the branch fix-login is there already; fix-login-2 is free", free: "fix-login-2" });
    const yes = await makeWorktree(repo, "fix-login", { orFree: true });
    assert.ok(yes.ok);
    assert.deepEqual([yes.name, yes.branch], ["fix-login-2", "fix-login-2"]);
    same(yes.folder, join(base, "proj-fix-login-2"));
    const bad = await makeWorktree(repo, "-x");
    assert.deepEqual(bad, { ok: false, error: "“-x” is no branch name: it cannot start with “-”" });
    const refused = await makeWorktree(repo, "out", { refuse: () => "not under the roots" });
    assert.deepEqual(refused, { ok: false, error: "not under the roots" });
    mkdirSync(join(repo, "scratch"));
    try {
      const lacking = await makeWorktree(join(repo, "scratch"), "lacking");
      assert.deepEqual(lacking, { ok: false, error: "scratch is not in the commit the new worktree starts at, so it would not have that folder" });
    } finally {
      rmSync(join(repo, "scratch"), { recursive: true });
    }
    assert.deepEqual([branches(repo).includes("out"), branches(repo).includes("lacking")], [false, false], "a refusal makes nothing");
  });

  // (fails before: yes — as above)
  test("two makes of one name at once: one makes it, the other is refused, one branch and one folder (GWC-112)", async () => {
    const both = await Promise.all([makeWorktree(repo, "twin"), makeWorktree(repo, "twin")]);
    const ok = both.filter((m) => m.ok);
    assert.equal(ok.length, 1, JSON.stringify(both));
    const other = both.find((m) => !m.ok);
    assert.match(String(other && !other.ok && other.error), /the branch twin is there already|did not make the branch twin/);
    assert.equal(branches(repo).filter((b) => b === "twin").length, 1);
    assert.equal(listed(repo).filter((n) => n === "proj-twin").length, 1);
    assert.equal(run(join(base, "proj-twin"), ["symbolic-ref", "--short", "HEAD"]), "twin", "the made one is whole");
  });

  // (fails before: yes — as above)
  test("a checkout that fails deletes the branch it made, and leaves the folder that was in the way as it was", async () => {
    const inWay = join(base, "proj-blocked");
    // Made after the plan read the folder as free: the checkout meets it.
    const m = await makeWorktree(repo, "blocked", {
      refuse: (f) => {
        mkdirSync(f);
        writeFileSync(join(f, "mine.txt"), "mine\n");
        return null;
      },
    });
    assert.equal(m.ok, false);
    assert.match(String(!m.ok && m.error), /^git did not make the worktree: /);
    assert.equal(branches(repo).includes("blocked"), false, "the branch it made is gone");
    assert.deepEqual(readdirSync(inWay), ["mine.txt"]);
  });

  // (fails before: yes — nothing took a worktree back)
  test("takeBack removes the worktree and its branch; git lists it no more (GWC-108)", async () => {
    const m = await makeWorktree(repo, "back");
    assert.ok(m.ok);
    writeFileSync(join(m.folder, "new.txt"), "x\n");
    assert.equal(await takeBack(m), null);
    assert.equal(existsSync(m.folder), false);
    assert.equal(branches(repo).includes("back"), false);
    assert.equal(listed(repo).includes("proj-back"), false);
  });

  // (fails before: yes — as above)
  test("takeBack says what stays where a program holds a file in it", { skip: process.platform !== "win32" && "a held file blocks a move on Windows only" }, async () => {
    const m = await makeWorktree(repo, "held");
    assert.ok(m.ok);
    const fd = openSync(join(m.folder, "src", "a.txt"), "r");
    try {
      assert.match(String(await takeBack(m)), /^the worktree .*proj-held stays: a program is using it \(E[A-Z]+\)/);
      assert.equal(branches(repo).includes("held"), true, "its branch stays with it");
    } finally {
      closeSync(fd);
    }
    assert.equal(await takeBack(m), null, "taken back once nothing holds it");
  });
});

describe("a worktree of a repository on Git LFS", { skip: !hasLfs && "git-lfs is not on PATH" }, () => {
  // (fails before: yes — the bug hunt of 10-30, beside GIT-7: the hooks pointed at a folder named beside the worktree,
  // and Git LFS's filter, run by the checkout, made that folder and wrote LFS's own hooks into it, so a new worktree and
  // a Put back each left a `.filament-no-hooks` folder in the developer's projects folder)
  test("made and put back with its content, not its pointers, and nothing left beside it", async () => {
    const base = fresh("filament-wtnew-lfs-");
    const repo = repoIn(join(base, "proj"));
    run(repo, ["lfs", "install", "--local"]);
    writeFileSync(join(repo, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
    writeFileSync(join(repo, "big.bin"), bytes);
    run(repo, ["add", "."]);
    run(repo, ["commit", "-q", "-m", "lfs"]);
    const tried = await ownTemp(async () => {
      const m = await makeWorktree(repo, "lfs-work");
      assert.equal(m.ok, true, JSON.stringify(m));
      if (!m.ok) return;
      assert.deepEqual(readFileSync(join(m.folder, "big.bin")), bytes, "the content, not its pointer");
      assert.deepEqual(readdirSync(base).sort(), ["proj", "proj-lfs-work"], "nothing beside the worktree");
      // Removed, then put back (GW-D37): the same again.
      assert.equal((await removeWorktree(repo, m.folder)).ok, true);
      assert.deepEqual(readdirSync(base), ["proj"]);
      assert.deepEqual(await putBack(repo, { path: m.folder, branch: "lfs-work", head: "" }), { ok: true });
      assert.deepEqual(readFileSync(join(m.folder, "big.bin")), bytes, "put back with its content");
      assert.deepEqual(readdirSync(base).sort(), ["proj", "proj-lfs-work"], "and nothing beside it");
    });
    assert.deepEqual(tried.hooks, [], "the hooks' folders went with their commands");
  });
});

describe("ownWorktree: a flow's own (OA5)", { skip: !hasGit && "git is not on PATH" }, () => {
  // (fails before: yes — a flow's team box that writes worked in the main chat's folder)
  test("in a repository: made from its folder, a taken name giving way; outside git, or before a first commit, why it cannot be; a refusal in words", async () => {
    const base = fresh("filament-wtnew-own-");
    const repo = repoIn(join(base, "proj"));
    const m = await ownWorktree(join(repo, "src"), "flow-a-lexer");
    assert.equal(m.ok, true, JSON.stringify(m));
    if (!m.ok) return;
    same(m.folder, join(base, "proj-flow-a-lexer"));
    same(m.cwd, join(base, "proj-flow-a-lexer", "src"));
    assert.equal(run(m.folder, ["symbolic-ref", "--short", "HEAD"]), "flow-a-lexer");
    const again = await ownWorktree(repo, "flow-a-lexer");
    assert.equal(again.ok && again.branch, "flow-a-lexer-2", "a second flow of that title takes the first free name");
    const plain = fresh("filament-wtnew-plain-");
    assert.deepEqual(await ownWorktree(plain, "flow-x"), { ok: false, outside: "it is not in a git repository" });
    const empty = join(fresh("filament-wtnew-empty-"), "e");
    mkdirSync(empty);
    run(empty, ["init", "-q", "-b", "main"]);
    assert.deepEqual(await ownWorktree(empty, "flow-x"), { ok: false, outside: "its git repository has no commit yet" });
    // (fails before: yes — the flows hunt of 10-23: a branch that points nowhere was read as no commit yet, and the
    // flow's writer changed the folder)
    const broken = repoIn(join(fresh("filament-wtnew-broken-"), "b"));
    writeFileSync(join(broken, ".git", "refs", "heads", run(broken, ["symbolic-ref", "--short", "HEAD"])), "zzz\n");
    const bad = await ownWorktree(broken, "flow-x");
    assert.equal("outside" in bad, false, "a broken branch is no reason to use the folder");
    assert.match(String(/** @type {any} */ (bad).error), /^git could not read its last commit: fatal: bad object/);
    const no = await ownWorktree(repo, "flow-y", { refuse: () => "that folder is outside the folders Filament may work in" });
    assert.equal(no.ok, false);
    assert.equal("outside" in no, false, "a refusal is no reason to use the folder");
    assert.match(String(/** @type {any} */ (no).error), /outside the folders Filament may work in/);
    // (fails before: yes — the bug round of 10-23: any failure to list worktrees, git's refusal of a repository
    // another account owns too, sent the flow's writer into the folder)
    const knob = { ...process.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: "1" };
    let refuses = true;
    try {
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repo, env: knob, stdio: "ignore", windowsHide: true });
      refuses = false;
    } catch {}
    if (!refuses) return;
    process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1";
    try {
      const owned = await ownWorktree(repo, "flow-z");
      assert.equal("outside" in owned, false, "a refused repository is no reason to use the folder");
      assert.match(String(/** @type {any} */ (owned).error), /^git refuses the repository this folder is in: fatal: detected dubious ownership/);
    } finally {
      delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
    }
  });
});

describe("a chat in a new worktree, against a real app", { skip: !hasGit && "git is not on PATH" }, () => {
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
  /** @type {string[]} */
  const systems = [];
  before(async () => {
    base = fresh("filament-wtnew-app-");
    repo = repoIn(join(base, "proj"));
    done = join(base, "proj-done");
    run(repo, ["worktree", "add", "-q", "-b", "done", done]);
    up = await fakeUpstream((call) => {
      const s = call.body?.system;
      systems.push(Array.isArray(s) ? s.map((/** @type {any} */ b) => b.text).join("") : String(s || ""));
      return anthropicReply("Done.", { model: "brain-model" });
    });
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
  /** @param {any} body */
  const create = (body) => shim.post("/api/sessions", { model: "agent/brain-model", ...body });
  /** The session list's row for a chat. @param {string} id */
  const rowOf = async (id) => (await (await shim.api("/api/memory/sessions?limit=200")).json()).sessions.find((/** @type {any} */ s) => s.id === id);
  /** A live client's request in `cwd`: its chain, or null where memory stayed out. */
  /** @param {string} cwd @param {string} words */
  const liveIn = async (cwd, words) => {
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 100, messages: [{ role: "user", content: words }] }, { "x-filament-cwd": cwd, "x-session-id": `wtnew-${words}` });
    assert.equal(r.status, 200, await r.clone().text());
    return (await shim.record(r.headers.get("x-filament-request-id"))).memory?.chain ?? null;
  };

  // (fails before: yes — the row is new)
  test("GET /api/git/places/new: the plan, the roots' refusal, fenced like every git row", async () => {
    const p = await (await shim.api(`/api/git/places/new?cwd=${enc(join(repo, "src"))}&name=fix-login`)).json();
    assert.deepEqual([p.ok, p.branch, p.here, p.taken, p.refused], [true, "fix-login", "proj", null, null]);
    same(p.cwd, join(base, "proj-fix-login", "src"));
    const app = /** @type {any} */ (shim.app);
    const roots = app.config.agentLoop.roots;
    app.config.agentLoop.roots = [repo];
    try {
      const out = await (await shim.api(`/api/git/places/new?cwd=${enc(repo)}&name=x`)).json();
      assert.match(out.refused, /proj-x would not be under any folder listed in agentLoop\.roots$/);
    } finally {
      app.config.agentLoop.roots = roots;
    }
    assert.equal((await shim.api(`/api/git/places/new?cwd=${enc(join(tmpdir(), "elsewhere"))}&name=x`)).status, 404);
  });

  // (fails before: yes — a chat could not be made in a new worktree, and a worktree's chat was a project of its own)
  test("POST /api/sessions with worktree: made, the chat works in it under the main folder's project; its turn works there (GW-D8, GWC-109)", async () => {
    const r = await create({ cwd: join(repo, "src"), worktree: { name: "fix-login", made: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const s = await r.json();
    const folder = join(base, "proj-fix-login");
    assert.deepEqual([s.worktree.name, s.worktree.branch], ["fix-login", "fix-login"]);
    same(s.worktree.folder, folder);
    same(s.cwd, join(folder, "src"));
    assert.equal(s.projectId, projectIdOf(join(repo, "src")), "the same place in the main folder's project");
    assert.equal(run(folder, ["symbolic-ref", "--short", "HEAD"]), "fix-login");
    const row = await rowOf(s.id);
    same(row.cwd, join(folder, "src"));
    assert.equal(row.project, s.projectId);
    const t = await shim.api(`/api/sessions/${enc(s.id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    assert.ok(normalizeCwd(systems.at(-1)).includes(normalizeCwd(join(folder, "src"))), "the turn's environment names the worktree's folder");
    const places = await (await shim.api(`/api/git/places?cwd=${enc(repo)}`)).json();
    const wt = places.places.find((/** @type {any} */ x) => x.name === "proj-fix-login");
    assert.deepEqual(wt.chats.map((/** @type {any} */ c) => [c.id, c.home]), [[s.id, true]], "the places list names it among the worktree's chats");
  });

  // (fails before: yes — as above)
  test("a taken name: 409 with the free one, nothing made; a name Filament made takes the free one (GWC-48, GW-D44)", async () => {
    const before = branches(repo);
    const r = await create({ cwd: repo, worktree: { name: "fix-login", made: false } });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: "the branch fix-login is there already; fix-login-2 is free", free: "fix-login-2" });
    assert.deepEqual(branches(repo), before);
    const m = await create({ cwd: repo, worktree: { name: "fix-login", made: true } });
    assert.equal(m.status, 200, await m.clone().text());
    assert.equal((await m.json()).worktree.name, "fix-login-2");
  });

  // (fails before: yes — as above)
  test("refused before anything is made: a bad start, a bad name, a folder outside the roots (GWC-106, GWC-107)", async () => {
    const before = [branches(repo), readdirSync(base).sort()];
    const badStart = await create({ cwd: repo, settings: { loop: { permissions: "bogus" } }, worktree: { name: "never" } });
    assert.equal(badStart.status, 400, await badStart.clone().text());
    const badName = await create({ cwd: repo, worktree: { name: "fix..x" } });
    assert.deepEqual([badName.status, (await badName.json()).error], [409, "“fix..x” is no branch name: it cannot hold “..”"]);
    const app = /** @type {any} */ (shim.app);
    const roots = app.config.agentLoop.roots;
    app.config.agentLoop.roots = [repo];
    try {
      const out = await create({ cwd: repo, worktree: { name: "outside" } });
      assert.equal(out.status, 409);
      assert.match((await out.json()).error, /proj-outside would not be under any folder listed in agentLoop\.roots$/);
    } finally {
      app.config.agentLoop.roots = roots;
    }
    assert.deepEqual([branches(repo), readdirSync(base).sort()], before, "no branch, no folder");
  });

  // (fails before: yes — as above)
  test("a create that fails after the make takes the worktree and its branch back, its reason said (GWC-108)", async () => {
    const sessions = /** @type {any} */ (shim.app).sessions;
    const real = sessions.create;
    sessions.create = () => {
      throw Object.assign(new Error("the archive is closed"), { status: 503 });
    };
    try {
      const r = await create({ cwd: repo, worktree: { name: "lost" } });
      assert.deepEqual([r.status, (await r.json()).error], [503, "the archive is closed"]);
    } finally {
      sessions.create = real;
    }
    assert.equal(existsSync(join(base, "proj-lost")), false);
    assert.equal(branches(repo).includes("lost"), false);
  });

  // (fails before: yes — an existing worktree's chat was a project of its own)
  test("a chat in an existing worktree's folder: the main folder's project, its own folder (GW-D49)", async () => {
    const s = await (await create({ cwd: done })).json();
    assert.equal(s.projectId, projectIdOf(repo));
    same(s.cwd, done);
    same((await rowOf(s.id)).cwd, done);
  });

  // (fails before: yes — a live client's chain in a worktree stood in a project of its own)
  test("a live client in a worktree: its chain in the main folder's project, its row's folder the worktree (GWC-110)", async () => {
    const id = await liveIn(done, "fix the redirect");
    assert.ok(id);
    const row = await rowOf(String(id));
    assert.equal(row.project, projectIdOf(repo));
    same(row.cwd, done);
  });

  // (fails before: yes — the main folder's exclusion let its worktrees in, and a bare prefix excluded a sibling)
  test("Memory's excluded main folder keeps its worktrees out; a folder whose name only begins the same stays in (GWC-111, GW-D48)", async () => {
    const capture = /** @type {any} */ (shim.app).config.memory.capture;
    const sibling = join(base, "projector");
    mkdirSync(sibling, { recursive: true });
    capture.excludeFolders = [repo];
    try {
      assert.equal(await liveIn(done, "in the excluded project's worktree"), null);
      assert.equal(await liveIn(repo, "in the excluded folder"), null);
      assert.ok(await liveIn(sibling, "beside the excluded folder"), "a folder that only begins with its name is not inside it");
    } finally {
      capture.excludeFolders = [];
    }
  });
});
