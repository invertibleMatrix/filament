// @ts-check
// Where each chat works (HarnessV4_Git_Plan step 2): a place read whole and lightly (`placeInfo`, GW-D20), its base
// branch (GW-D21), a status that never takes the index lock (GW-D23), the two admin rows, the session rows' places,
// and the words the header and the sidebar say (GWC-27, GWC-28, GWC-33 to GWC-36, GWC-55 to GWC-63); step 3's Branch,
// what merging each place would bring (GW-D29), and diffs against the working tree through the plumbing (GW-D31).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { apartInfo, branchFileOf, branchOf, placeInfo, statusOf } from "../src/adapters/git/inspect.js";
import { changesSince, diffFiles } from "../src/adapters/git/changes.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { aheadWords, baseWords, branchWords, localProject, pathLike, uncommittedWords, whereLine, worktreeWords } from "../src/ui/harness/lib/labels.js";

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
after(() => {
  for (const d of made.reverse()) rmSync(d, { recursive: true, force: true });
});
/** A fresh folder under the system's temp, as the filesystem spells it. @param {string} prefix */
const fresh = (prefix) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
/** A repository with one commit on `branch`. @param {string} dir @param {string} [branch] */
const repoIn = (dir, branch = "main") => {
  mkdirSync(dir, { recursive: true });
  run(dir, ["init", "-q", "-b", branch]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
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
const top = (/** @type {string} */ dir) => run(dir, ["rev-parse", "--show-toplevel"]);

describe("a place, read", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {string} */
  let base;
  /** @type {string} */
  let repo;
  /** @type {string} */
  let wt;
  before(() => {
    base = fresh("filament-gp-");
    repo = repoIn(join(base, "proj"));
    wt = join(base, "proj-wt");
    run(repo, ["worktree", "add", "-q", "-b", "feat", wt]);
    commit(wt, "f1.txt");
    commit(wt, "f2.txt");
  });

  // (fails before: yes — there was no read of where a folder works: only `statusOf`'s branch, no worktree, no base)
  test("a main folder on its base: no worktree, its own main, even with its base; the uncommitted files and lines", async () => {
    writeFileSync(join(repo, "a.txt"), "one\nTWO\nthree\n");
    writeFileSync(join(repo, "new.txt"), "fresh\n");
    const p = await placeInfo(repo, { whole: true });
    assert.equal(p.ok, true, p.error || "");
    assert.deepEqual(
      [p.place, p.worktree, p.main, p.branch, p.detached, p.base, p.onBase, p.ahead, p.behind],
      [top(repo), false, top(repo), "main", false, "main", true, 0, 0],
    );
    assert.match(String(p.head), /^[0-9a-f]{7,}$/);
    assert.deepEqual(p.uncommitted, { files: 2, added: 2, removed: 1 }, "the untracked file counts as a file; its lines are not against HEAD");
    run(repo, ["checkout", "-q", "--", "a.txt"]);
    rmSync(join(repo, "new.txt"));
  });

  // (fails before: yes — a linked worktree read as its own repository: no mark, no "worktree of", no ahead)
  test("a linked worktree: whose it is, its branch, how far ahead of main and, once main moves, behind (GWC-33, GWC-34)", async () => {
    const p = await placeInfo(wt, { whole: true });
    assert.deepEqual([p.place, p.worktree, p.main, p.branch, p.base, p.onBase, p.ahead, p.behind], [top(wt), true, top(repo), "feat", "main", false, 2, 0]);
    assert.deepEqual(p.uncommitted, { files: 0, added: 0, removed: 0 });
    commit(repo, "m1.txt");
    const q = await placeInfo(join(wt), { whole: true });
    assert.deepEqual([q.ahead, q.behind], [2, 1]);
    const light = await placeInfo(wt);
    assert.equal(light.base, undefined, "a light read reads no base");
    assert.deepEqual([light.ok, light.worktree, light.main, light.branch], [true, true, top(repo), "feat"]);
  });

  // A lane made a moment ago has nothing of its own yet; one whose commits main took is merged. Both are nothing ahead:
  // the branch's reflog tells them apart. (fails before: yes — a new lane read "merged into main", seen live on S7)
  test("nothing ahead: a branch never moved since it was made is fresh; one merged is not", async () => {
    const lane = join(base, "proj-lane");
    run(repo, ["worktree", "add", "-q", "-b", "repro/play-91", lane]);
    const p = await placeInfo(lane, { whole: true });
    assert.deepEqual([p.branch, p.ahead, p.fresh], ["repro/play-91", 0, true]);
    commit(lane, "lane.txt");
    assert.equal((await placeInfo(lane, { whole: true })).fresh, undefined, "ahead: neither");
    run(repo, ["merge", "-q", "--ff-only", "repro/play-91"]);
    const m = await placeInfo(lane, { whole: true });
    assert.deepEqual([m.ahead, m.fresh], [0, false], "its commit is on main: merged");
    assert.equal((await placeInfo(repo, { whole: true })).fresh, undefined, "the base itself: neither");
    run(repo, ["reset", "-q", "--hard", "HEAD~1"]);
  });

  // (fails before: yes — a detached HEAD read as no branch at all, GWC-28)
  test("a detached HEAD: no branch, the commit it is at", async () => {
    const det = join(base, "proj-det");
    run(repo, ["worktree", "add", "-q", "--detach", det]);
    const p = await placeInfo(det, { whole: true });
    assert.deepEqual([p.branch, p.detached, p.head, p.worktree], [null, true, run(det, ["rev-parse", "--short", "HEAD"]), true]);
    assert.equal(branchWords(p), `detached at ${p.head}`);
    assert.deepEqual([p.base, p.onBase, p.ahead, p.behind], ["main", false, 0, 0], "a detached HEAD is still counted against the base");
  });

  // (fails before: yes — the sidebar's read was light: nothing said a worktree's commits not on main nor its files; the
  // owner's of 10-31: "i might forget if a thread has unapplied work into main branch")
  test("apart: a place kept apart from its base is read whole; the main folder on its base, or with none, reads no more", async () => {
    writeFileSync(join(wt, "loose.txt"), "x\n");
    writeFileSync(join(repo, "loose.txt"), "y\n");
    const w = await apartInfo(wt);
    assert.deepEqual([w.worktree, w.branch, w.base, w.onBase, w.ahead, w.uncommitted?.files], [true, "feat", "main", false, 2, 1]);
    const m = await apartInfo(repo);
    assert.deepEqual([m.worktree, m.base, m.onBase, m.ahead, m.behind, m.uncommitted], [false, "main", true, 0, 0, null], "the base's own folder: its files are not read");
    rmSync(join(wt, "loose.txt"));
    rmSync(join(repo, "loose.txt"));

    const topic = repoIn(fresh("filament-gp-apart-"));
    run(topic, ["checkout", "-q", "-b", "topic"]);
    commit(topic, "t.txt");
    const t = await apartInfo(topic);
    assert.deepEqual([t.worktree, t.branch, t.base, t.onBase, t.ahead, t.uncommitted?.files], [false, "topic", "main", false, 1, 0], "a main folder on another branch is apart too");

    const none = await apartInfo(repoIn(fresh("filament-gp-nobase-"), "dev"));
    assert.deepEqual([none.ok, none.base, none.onBase, none.ahead, none.uncommitted], [true, null, false, null, null], "no base to be apart from: nothing more read");
    const gone = await apartInfo(join(base, "nowhere"));
    assert.deepEqual([gone.ok, gone.ahead, gone.uncommitted], [false, null, null]);
  });

  // (fails before: yes — GWC-58, GWC-27)
  test("a branch with no commit yet; a base of master; a base origin/HEAD names, local or not; no base at all", async () => {
    const unborn = fresh("filament-gp-unborn-");
    run(unborn, ["init", "-q", "-b", "trunk"]);
    writeFileSync(join(unborn, "s.txt"), "staged\n");
    run(unborn, ["add", "s.txt"]);
    const u = await placeInfo(unborn, { whole: true });
    assert.deepEqual([u.ok, u.branch, u.head, u.base, u.ahead, u.behind], [true, "trunk", null, null, null, null]);
    assert.deepEqual(u.uncommitted, { files: 1, added: 1, removed: 0 }, "before the first commit, the staged lines count");
    assert.equal(baseWords(u), "no base branch to compare with (no main, master, trunk, develop or origin/HEAD)");

    const old = repoIn(fresh("filament-gp-master-"), "master");
    run(old, ["checkout", "-q", "-b", "topic"]);
    commit(old, "t.txt");
    const m = await placeInfo(old, { whole: true });
    assert.deepEqual([m.base, m.ahead, m.behind], ["master", 1, 0]);

    const named = repoIn(fresh("filament-gp-named-"), "trunk");
    run(named, ["update-ref", "refs/remotes/origin/trunk", "HEAD"]);
    run(named, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);
    run(named, ["branch", "main"]);
    run(named, ["checkout", "-q", "-b", "work"]);
    commit(named, "w.txt");
    const n = await placeInfo(named, { whole: true });
    assert.deepEqual([n.base, n.ahead], ["trunk", 1], "the branch origin/HEAD names, before a main");
    run(named, ["branch", "-q", "-D", "trunk"]);
    const r = await placeInfo(named, { whole: true });
    assert.deepEqual([r.base, r.ahead], ["origin/trunk", 1], "no local branch of that name: the remote one");

    const tag = repoIn(fresh("filament-gp-tag-"), "dev");
    run(tag, ["tag", "main"]);
    const t = await placeInfo(tag, { whole: true });
    assert.equal(t.base, null, "a tag named main is no base");
    run(tag, ["branch", "trunk"]);
    assert.equal((await placeInfo(tag, { whole: true })).base, "trunk", "the names the Environment block knows (BASE_NAMES)");
  });

  // (fails before: yes — GWC-56, GWC-57)
  test("a folder outside any repository, and one that is gone, are answered in words", async () => {
    const plain = fresh("filament-gp-plain-");
    const p = await placeInfo(plain, { whole: true });
    assert.deepEqual([p.ok, p.place, p.error, p.uncommitted], [false, null, "not in a git repository", null]);
    const g = await placeInfo(join(plain, "gone"));
    assert.deepEqual([g.ok, g.error], [false, "the folder is gone"]);
    assert.equal((await placeInfo("")).error, "no folder was named");
  });

  // (fails before: yes — a plain `git status` refreshed the index: a stale stat rewrote it, under the index lock)
  test("reading a place never rewrites its index (GW-D23, GWC-63)", async () => {
    const dir = repoIn(fresh("filament-gp-lock-"));
    const index = join(dir, ".git", "index");
    const later = new Date(Date.now() + 120_000);
    utimesSync(join(dir, "a.txt"), later, later);
    const before = readFileSync(index);
    await placeInfo(dir, { whole: true });
    await statusOf(dir);
    assert.ok(readFileSync(index).equals(before), "the index is as it was");
    run(dir, ["status", "--porcelain"]);
    assert.ok(!readFileSync(index).equals(before), "a plain git status does rewrite it: the check above can fail");
  });

  // The composer's `+N −N` is the branch's whole, not a turn's (the owner's of 11-08: "it should not show this per turn
  // changes but as a whole changes in current working branch"). (fails before: yes — no read said it: `sinceBase` was
  // never set, and the strip showed the last turn's count)
  test("sinceBase: all a branch holds that its base lacks, committed or not, untracked lines too; on the base, what is uncommitted", async () => {
    const root = fresh("filament-gp-since-");
    const main = repoIn(join(root, "proj"));
    const lane = join(root, "proj-lane");
    run(main, ["worktree", "add", "-q", "-b", "lane", lane]);
    // Two commits on the lane: a new file of three lines, and a.txt's second line changed.
    writeFileSync(join(lane, "b.txt"), "1\n2\n3\n");
    run(lane, ["add", "b.txt"]);
    run(lane, ["commit", "-q", "-m", "b"]);
    writeFileSync(join(lane, "a.txt"), "one\nTWO\n");
    run(lane, ["commit", "-q", "-am", "a"]);
    // Uncommitted: b.txt's last line taken back — a line a commit added and the working tree took back counts none —,
    // and an untracked file of two lines, its last with no newline.
    writeFileSync(join(lane, "b.txt"), "1\n2\n");
    writeFileSync(join(lane, "c.txt"), "x\ny");
    // Main moves on: what it gained is no part of the lane's count.
    commit(main, "m.txt");
    const w = await placeInfo(lane, { whole: true, sinceBase: true });
    assert.equal(w.ok, true, w.error || "");
    assert.deepEqual([w.base, w.onBase, w.ahead, w.behind], ["main", false, 2, 1]);
    assert.deepEqual(w.sinceBase, { files: 3, added: 1 + 2 + 2, removed: 1 }, "a.txt +1 −1, b.txt +2 net, c.txt +2");
    assert.equal((await placeInfo(lane, { whole: true })).sinceBase, undefined, "read only when asked");

    // The base's own folder: what is uncommitted there, the untracked file's lines too.
    writeFileSync(join(main, "a.txt"), "one\n");
    writeFileSync(join(main, "n.txt"), "fresh\n");
    const m = await placeInfo(main, { whole: true, sinceBase: true });
    assert.deepEqual([m.onBase, m.sinceBase], [true, { files: 2, added: 1, removed: 1 }]);
    run(main, ["checkout", "-q", "--", "a.txt"]);
    rmSync(join(main, "n.txt"));
    assert.deepEqual((await placeInfo(main, { whole: true, sinceBase: true })).sinceBase, { files: 0, added: 0, removed: 0 }, "nothing uncommitted: nothing");
  });

  // (fails before: yes — the review of 11-08: a move counted as every line removed and added again, a file touched with
  // its bytes as they were counted as a file changed, and before the first commit an edit not staged counted none)
  test("sinceBase: a file moved counts as moved; one touched with its bytes as they were, as nothing; before the first commit, the working tree", async () => {
    const root = fresh("filament-gp-since2-");
    const main = repoIn(join(root, "proj"));
    const lane = join(root, "proj-lane");
    run(main, ["worktree", "add", "-q", "-b", "lane", lane]);
    run(lane, ["mv", "a.txt", "moved.txt"]);
    run(lane, ["commit", "-q", "-m", "move"]);
    assert.deepEqual((await placeInfo(lane, { whole: true, sinceBase: true })).sinceBase, { files: 1, added: 0, removed: 0 }, "one file moved, no line");

    writeFileSync(join(main, "a.txt"), "one\ntwo\n");
    const later = new Date(Date.now() + 120_000);
    utimesSync(join(main, "a.txt"), later, later);
    assert.deepEqual((await placeInfo(main, { whole: true, sinceBase: true })).sinceBase, { files: 0, added: 0, removed: 0 }, "touched, unchanged: nothing");

    const unborn = fresh("filament-gp-unborn-");
    run(unborn, ["init", "-q", "-b", "main"]);
    writeFileSync(join(unborn, "x.txt"), "a\nb\n");
    run(unborn, ["add", "x.txt"]);
    writeFileSync(join(unborn, "x.txt"), "a\nb\nc\n");
    writeFileSync(join(unborn, "y.txt"), "q\n");
    const u = await placeInfo(unborn, { whole: true, sinceBase: true });
    assert.deepEqual([u.head, u.base, u.sinceBase], [null, null, { files: 2, added: 4, removed: 0 }], "x.txt as it stands, not as staged, and y.txt");
  });
});

describe("the words the header and the sidebar say", () => {
  // (fails before: yes — the words are new)
  test("branch, ahead and behind, base, uncommitted, whose worktree", () => {
    assert.equal(branchWords({ branch: "feat", head: "abc1234" }), "feat");
    assert.equal(branchWords({ branch: null, head: "abc1234" }), "detached at abc1234");
    assert.equal(aheadWords({ onBase: false, ahead: 2, behind: 1 }), "↑2 ↓1");
    assert.equal(aheadWords({ onBase: false, ahead: 0, behind: 3 }), "↓3");
    assert.equal(aheadWords({ onBase: true, ahead: 0, behind: 0 }), "", "on its base: no arrows (GWC-60)");
    assert.equal(aheadWords({ onBase: false, ahead: null, behind: null }), "");
    assert.equal(baseWords({ base: "main", onBase: true, head: "a" }), "main is the base branch");
    assert.equal(baseWords({ base: "main", onBase: false, head: "a", ahead: 1, behind: 0 }), "1 commit ahead of main");
    assert.equal(baseWords({ base: "main", onBase: false, head: "a", ahead: 2, behind: 3 }), "2 commits ahead of main, 3 behind");
    assert.equal(baseWords({ base: "main", onBase: false, head: "a", ahead: 0, behind: 3 }), "3 commits behind main");
    assert.equal(baseWords({ base: "main", onBase: false, head: "a", ahead: 0, behind: 0 }), "even with main");
    assert.equal(baseWords({ base: "main", onBase: false, head: null, ahead: null, behind: null }), "nothing committed yet; the base is main");
    assert.equal(uncommittedWords({ files: 0, added: 0, removed: 0 }), "nothing uncommitted");
    assert.equal(uncommittedWords({ files: 1, added: 0, removed: 0 }), "1 uncommitted file");
    assert.equal(uncommittedWords({ files: 3, added: 12, removed: 4 }), "3 uncommitted files, +12 −4");
    assert.equal(worktreeWords({ worktree: true, main: "H:/filament" }, "H:\\filament-wt"), "worktree of filament (H:\\filament)");
    assert.equal(worktreeWords({ worktree: true, main: null }), "a worktree of a bare repository");
    assert.equal(worktreeWords({ worktree: false, main: "/p" }), "");
    assert.equal(pathLike("/home/x/p", "/home/x/p-wt"), "/home/x/p");
  });

  // (fails before: yes — GWC-36: the sidebar named no place)
  test("the sidebar's line: a worktree folder, another place of the same repository, another repository, more than one", () => {
    const info = {
      "H:\\filament": { ok: true, place: "H:/filament", worktree: false, main: "H:/filament", branch: "main" },
      "H:\\filament-wt": { ok: true, place: "H:/filament-wt", worktree: true, main: "H:/filament", branch: "filament-agent" },
      "H:/filament-wt": { ok: true, place: "H:/filament-wt", worktree: true, main: "H:/filament", branch: "filament-agent" },
      "H:/other": { ok: true, place: "H:/other", worktree: false, main: "H:/other", branch: "dev" },
      "H:/gone": { ok: false, place: null, error: "the folder is gone" },
    };
    const of = (/** @type {string} */ f) => /** @type {any} */ (info)[f] || null;
    assert.equal(whereLine({ cwd: "H:\\filament", places: [] }, of), null, "a main folder alone: the row as today");
    assert.equal(whereLine({ cwd: "H:\\unknown", places: ["H:/filament-wt"] }, of), null, "nothing until its folder is known");
    const inWt = whereLine({ cwd: "H:\\filament-wt", places: [] }, of);
    assert.equal(inWt?.text, "filament-agent");
    assert.equal(inWt?.title, "Works in filament-wt ⑂ filament-agent, worktree of filament (H:\\filament)");
    const wrote = whereLine({ cwd: "H:\\filament", places: ["H:/filament-wt"] }, of);
    assert.equal(wrote?.text, "filament-agent");
    assert.match(String(wrote?.title), /^Its agents also wrote in filament-wt ⑂ filament-agent/);
    assert.equal(whereLine({ cwd: "H:\\filament", places: ["H:/other"] }, of)?.text, "other · dev", "another repository by its name");
    assert.equal(whereLine({ cwd: "H:\\filament-wt", places: ["H:/filament-wt", "H:/other", "H:/gone"] }, of)?.text, "filament-agent +1", "each place once; a gone one left out (GWC-56)");
  });

  // (fails before: yes — a chat sent in a new worktree stood under a project of the worktree's own name until the
  // archive listed it: step 6's drive)
  test("a chat the archive does not list yet stands under the project its create filed it in (GW-D46)", () => {
    const listed = [{ cwd: "H:\\filament", project: "p-filament", projectName: "filament" }];
    assert.deepEqual(localProject({ cwd: "H:\\filament-fix-x", projectId: "p-filament" }, listed), { project: "p-filament", projectName: "H:\\filament-fix-x" },
      "a new worktree's chat: its main folder's project, though no chat works in its folder yet");
    assert.deepEqual(localProject({ cwd: "H:/filament/", projectId: null }, listed), { project: "p-filament", projectName: "filament" }, "before its create answered: a listed chat's of the same folder");
    assert.deepEqual(localProject({ cwd: "H:\\New", projectId: null }, listed), { project: "folder:h:/new", projectName: "H:\\New" }, "else its folder's own group");
    assert.deepEqual(localProject({ cwd: "", projectId: null }, listed), { project: "none", projectName: null });
    assert.match(readFileSync("src/ui/harness/app.js", "utf8"), /chat\.chainId = row\.id;[\s\S]{0,400}?chat\.projectId = row\.projectId \|\| null;/, "the create's answer gives the chat its project");
    assert.match(readFileSync("src/ui/harness/sidebar.js", "utf8"), /\.\.\.localProject\(c, sessions\)/, "the sidebar's local rows take it");
  });
});

describe("the status panel's Git section says every place the chat works in (GW-D55)", () => {
  /** A place as `/git/place` answers one. @param {Record<string, any>} o @returns {any} */
  const place = (o) => ({ ok: true, place: "H:/filament", worktree: false, branch: "main", head: "3f0a75cd", uncommitted: { files: 0, added: 0, removed: 0 }, ...o });
  const wt = place({ place: "H:/filament-wt", worktree: true, branch: "filament-agent", uncommitted: { files: 2, added: 9, removed: 1 } });
  const task = { id: "t1", kind: "local_bash", description: "npm test", background: true, since: Date.now(), tokens: null, tools: null, lastTool: null, summary: null };

  // (fails before: yes — the section read `/git/status` of the chat's own folder alone: the owner's chat opus55, whose
  // folder is H:\filament and whose agent works in H:\filament-wt, said "main · Clean working tree")
  test("the rows: the chat's folder first, then each place its agents wrote in; one git could not read is left out", async () => {
    const { gitRows, gitWord } = await import("../src/ui/harness/conversation/status-panel.js");
    const rows = gitRows({ ...place({}), also: [wt, { ok: false, cwd: "H:/gone", error: "the folder is gone" }] });
    assert.deepEqual(rows, [
      { name: "filament", branch: "main", files: 0, home: true },
      { name: "filament-wt", branch: "filament-agent", files: 2, home: false },
    ]);
    assert.equal(gitWord(rows), "main +1", "the capsule: the folder's branch, and how many more places");
    assert.equal(gitWord(gitRows(place({ also: [] }))), "main");
    assert.deepEqual(gitRows({ ok: false, error: "not in a git repository", also: [wt] }).map((r) => [r.name, r.home]), [["filament-wt", false]],
      "a folder outside git: the place its agent wrote in still shows");
    assert.equal(gitRows(place({ branch: null, head: "abc1234", uncommitted: null }))[0].branch, "detached at abc1234");
    assert.equal(gitRows(place({ uncommitted: null }))[0].files, null, "git could not tell: not counted as clean");
    assert.deepEqual([gitRows(null), gitRows({ ok: false, error: "x" })], [[], []]);
  });

  test("drawn: its own folder alone keeps the short form; another place lists each by its folder", async () => {
    const doc = stubDocument();
    try {
      const { createStatusPanel } = await import("../src/ui/harness/conversation/status-panel.js");
      // The panel floats where Appearance says so; the capsule in the header is the default (proposal_ux D3).
      /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => (k === "filament.harness.statusPanel" ? "auto" : null), setItem: () => {} };
      const panel = createStatusPanel({ onOpenPlan: () => {}, onGoal: () => {}, onOpenChanges: () => {} });
      /** @type {any} */
      const el = panel.el;
      const gitOf = () => el.querySelectorAll(".sp-section").find((/** @type {any} */ s) => s.querySelector(".sp-section-head").textContent.startsWith("Git"));
      panel.set({ agentTasks: { who: "Claude Code", tasks: [task] }, git: { ...place({}), also: [] } });
      assert.equal(el.querySelector(".sp-capsule").textContent, "1 task running · main");
      let git = gitOf();
      assert.equal(git.querySelector(".sp-section-head").textContent, "Gitmain");
      assert.equal(git.querySelector(".sp-goal-text").textContent, "Clean working tree");
      assert.equal(git.querySelectorAll(".sp-git-place").length, 0);

      panel.set({ agentTasks: { who: "Claude Code", tasks: [task] }, git: { ...place({}), also: [wt] } });
      assert.equal(el.querySelector(".sp-capsule").textContent, "1 task running · main +1");
      git = gitOf();
      // (fails before: yes — the count said "2 places", the code's word for a folder or worktree: a person reads folders)
      assert.equal(git.querySelector(".sp-section-head").textContent, "Git2 folders");
      assert.deepEqual(git.querySelectorAll(".sp-git-place").map((/** @type {any} */ r) => r.textContent), ["filamentmainclean", "filament-wtfilament-agent2 files changed"]);
      assert.equal(git.querySelector("button").textContent, "Open changes");

      panel.set({ agentTasks: { who: "Claude Code", tasks: [task] }, git: { ok: false, error: "not in a git repository", also: [wt] } });
      assert.deepEqual(gitOf().querySelectorAll(".sp-git-place").map((/** @type {any} */ r) => r.textContent), ["filament-wtfilament-agent2 files changed"],
        "one place that is not the chat's folder is named, never passed off as the folder");

      // (fails before: yes — the row split the path at forward slashes alone: a Windows folder showed whole; the drive)
      panel.set({ terminals: [{ id: "x", cwd: "C:\\Users\\me\\proj", createdAt: Date.now() }, { id: "y", cwd: "", createdAt: Date.now() }] });
      if (!el.classList.contains("expanded")) el.querySelector(".sp-capsule").dispatch("click");
      assert.deepEqual(el.querySelectorAll(".sp-agent-name").map((/** @type {any} */ b) => b.textContent), ["proj", "terminal"], "a terminal row names its folder");
    } finally {
      doc.restore();
      delete (/** @type {any} */ (globalThis)).localStorage;
    }
  });

  test("the page reads it as the header does: the folder's place and the chat's places (source contract)", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /async function loadGit\(chat, folder, \{ since = 0 \} = \{\}\) \{[\s\S]{0,600}?apiShared\(`\/git\/place\?cwd=\$\{encodeURIComponent\(folder\)\}\$\{chain\}`, \{ since \}\)/);
    assert.doesNotMatch(app, /\/git\/status/, "the panel no longer reads the folder's status alone");
  });
});

describe("the two rows and the session rows against a real app", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let base;
  /** @type {string} */
  let repo;
  /** @type {string} */
  let wt;
  /** @type {string} */
  let outside;
  before(async () => {
    base = fresh("filament-gp-app-");
    repo = repoIn(join(base, "proj"));
    wt = join(base, "proj-wt");
    run(repo, ["worktree", "add", "-q", "-b", "agent", wt]);
    commit(wt, "w1.txt");
    commit(wt, "w2.txt");
    outside = repoIn(fresh("filament-gp-outside-"));
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

  // (fails before: yes — the row is new)
  test("GET /api/git/place is fenced like every git row: no cwd 400, a missing folder 404, one outside the roots 403", async () => {
    assert.equal((await shim.api("/api/git/place")).status, 400);
    assert.equal((await shim.api(`/api/git/place?cwd=${enc(join(base, "nope"))}`)).status, 404);
    assert.equal((await shim.api(`/api/git/place?cwd=${enc(outside)}`)).status, 403);
  });

  // (fails before: yes — the header had only /git/status: no worktree, no base, no other places; a gone one was said
  // in words until the owner's words of 10-18: "if it is gone then why do i need to know about it. i had Removed that
  // deliberately")
  test("GET /api/git/place reads the folder whole and, with the chat, its other places: a refused one in words, a gone one left out (GWC-55, GWC-56)", async () => {
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }, { "x-filament-cwd": repo, "x-session-id": "gp-session" });
    assert.equal(r.status, 200, await r.clone().text());
    const chain = (await shim.record(r.headers.get("x-filament-request-id"))).memory.chain;
    const memory = /** @type {any} */ (shim.app).memory;
    const gone = join(base, "gone-wt");
    for (const p of [top(wt), top(outside), gone]) memory.followPlace(chain, p);
    const p = await (await shim.api(`/api/git/place?cwd=${enc(repo)}&chain=${enc(chain)}`)).json();
    assert.deepEqual([p.ok, p.worktree, p.branch, p.onBase, p.uncommitted?.files], [true, false, "main", true, 0], JSON.stringify(p));
    assert.deepEqual(
      p.also.map((/** @type {any} */ x) => [x.cwd, x.ok, x.worktree, x.branch, x.ahead, !!x.refused, x.error]),
      [
        [top(wt), true, true, "agent", 2, false, null],
        [top(outside), false, false, null, null, true, `${top(outside)} is not under any folder listed in agentLoop.roots`],
      ],
      "the gone one is not shown: nothing is there to read or to do",
    );
    const plain = await (await shim.api(`/api/git/place?cwd=${enc(repo)}`)).json();
    assert.deepEqual(plain.also, [], "no chat, no other places");
    const rows = await (await shim.api("/api/memory/sessions?limit=20&kind=interactive,fork")).json();
    assert.deepEqual(rows.sessions.find((/** @type {any} */ s) => s.id === chain)?.places, [top(wt), top(outside), gone], "the session row carries its places (GWC-36)");
  });

  // (fails before: yes — the row is new; GWC-62: one read per folder)
  test("GET /api/git/where reads many folders lightly, each answered alone; too many is refused", async () => {
    const asked = [repo, wt, outside, join(base, "gone"), wt];
    const r = await (await shim.api(`/api/git/where?${asked.map((f) => `cwd=${enc(f)}`).join("&")}`)).json();
    assert.deepEqual(Object.keys(r.places).sort(), [...new Set(asked)].sort(), "each folder once");
    assert.deepEqual([r.places[repo].ok, r.places[repo].worktree, r.places[repo].branch, r.places[repo].base], [true, false, "main", undefined]);
    assert.deepEqual([r.places[wt].worktree, r.places[wt].main, r.places[wt].branch], [true, top(repo), "agent"]);
    assert.deepEqual([r.places[outside].ok, r.places[outside].refused], [false, true]);
    assert.equal(r.places[join(base, "gone")].error, "the folder is gone");
    const many = Array.from({ length: 101 }, (_, i) => `cwd=${enc(join(base, `f${i}`))}`).join("&");
    assert.equal((await shim.api(`/api/git/where?${many}`)).status, 400);
  });

  // (fails before: yes — `apart` is new: the sidebar could not say a worktree's work not on main)
  test("GET /api/git/where?apart=1 reads a worktree whole and the main folder on its base by its base alone", async () => {
    writeFileSync(join(wt, "apart.txt"), "x\n");
    try {
      const r = await (await shim.api(`/api/git/where?apart=1&cwd=${enc(repo)}&cwd=${enc(wt)}&cwd=${enc(outside)}`)).json();
      assert.deepEqual([r.places[wt].worktree, r.places[wt].onBase, r.places[wt].ahead, r.places[wt].uncommitted?.files], [true, false, 2, 1], JSON.stringify(r.places[wt]));
      assert.deepEqual([r.places[repo].onBase, r.places[repo].ahead, r.places[repo].uncommitted], [true, 0, null]);
      assert.deepEqual([r.places[outside].refused, r.places[outside].ahead, r.places[outside].uncommitted], [true, null, null], "refused: its whole fields unread");
      const light = await (await shim.api(`/api/git/where?cwd=${enc(wt)}`)).json();
      assert.equal(light.places[wt].ahead, undefined, "without apart, as light as before");
    } finally {
      rmSync(join(wt, "apart.txt"));
    }
  });

  // (fails before: yes — the row is new: Review's /git/diff read the folder alone, unstaged or staged)
  test("GET /api/git/branch reads every place of the chat against its base, a refused one in words, a gone one left out; a file's diff by its part (GW-D29, GWC-25, GWC-26, GWC-69)", async () => {
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }, { "x-filament-cwd": repo, "x-session-id": "gb-session" });
    assert.equal(r.status, 200, await r.clone().text());
    const chain = (await shim.record(r.headers.get("x-filament-request-id"))).memory.chain;
    const memory = /** @type {any} */ (shim.app).memory;
    const gone = join(base, "gone-wt-2");
    for (const p of [top(wt), top(outside), gone]) memory.followPlace(chain, p);
    writeFileSync(join(wt, "loose.txt"), "a\nb\n");
    const b = await (await shim.api(`/api/git/branch?cwd=${enc(repo)}&chain=${enc(chain)}`)).json();
    assert.deepEqual(
      b.places.map((/** @type {any} */ p) => [p.cwd, p.ok, p.branch, p.commits?.length ?? null, p.files?.committed?.totals.files ?? null, p.error]),
      [
        [repo, true, "main", 0, null, null],
        [top(wt), true, "agent", 2, 2, null],
        [top(outside), false, null, 0, null, `${top(outside)} is not under any folder listed in agentLoop.roots`],
      ],
      JSON.stringify(b.places.map((/** @type {any} */ p) => p.error)),
    );
    const w = b.places[1];
    assert.deepEqual(w.commits.map((/** @type {any} */ c) => c.subject), ["w2.txt", "w1.txt"], "newest first");
    assert.deepEqual(w.files.uncommitted.files.map((/** @type {any} */ f) => [f.path, f.status, f.added]), [["loose.txt", "added", 2]]);
    const committed = await (await shim.api(`/api/git/branch?cwd=${enc(repo)}&place=${enc(top(wt))}&part=committed&path=w1.txt`)).json();
    assert.match(committed.patch, /\+w1\.txt/);
    const loose = await (await shim.api(`/api/git/branch?cwd=${enc(repo)}&place=${enc(top(wt))}&path=loose.txt`)).json();
    assert.deepEqual([loose.untracked, /\+b$/m.test(loose.patch)], [true, true]);
    assert.equal((await shim.api(`/api/git/branch?cwd=${enc(repo)}&place=${enc(outside)}&path=x`)).status, 403, "a place outside the roots");
    assert.equal((await shim.api(`/api/git/branch?cwd=${enc(repo)}&path=../x`)).status, 403, "a path that climbs out");
  });
});

describe("Branch: what merging a place would bring (step 3)", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {string} */
  let repo;
  /** @type {string} */
  let wt;
  before(() => {
    const base = fresh("filament-gb-");
    repo = repoIn(join(base, "proj"));
    wt = join(base, "proj-wt");
    run(repo, ["worktree", "add", "-q", "-b", "feat", wt]);
    commit(wt, "f1.txt");
    writeFileSync(join(wt, "pic.bin"), Buffer.from([0, 1, 2, 3, 0, 5, 6, 7, 8, 9]));
    run(wt, ["add", "pic.bin"]);
    run(wt, ["commit", "-q", "-m", "a picture"]);
    writeFileSync(join(wt, "a.txt"), "one\nTWO\n");
    writeFileSync(join(wt, "staged.txt"), "s1\n");
    run(wt, ["add", "staged.txt"]);
    writeFileSync(join(wt, "staged.txt"), "s1\ns2\n");
    writeFileSync(join(wt, "new.txt"), "n1\nn2\nn3\n");
    writeFileSync(join(wt, "blob.dat"), Buffer.from([0, 0, 1, 2]));
  });

  // (fails before: yes — the read is new)
  test("a branch: its commits ahead, where it left its base, what they changed, and what is uncommitted, untracked by name", async () => {
    const p = await branchOf(wt);
    assert.equal(p.ok, true, p.error || "");
    assert.deepEqual([p.branch, p.base, p.ahead, p.moreCommits], ["feat", "main", 2, 0]);
    assert.deepEqual(p.commits.map((c) => c.subject), ["a picture", "f1.txt"]);
    assert.equal(p.from, run(wt, ["merge-base", "main", "HEAD"]).slice(0, 8));
    assert.deepEqual(
      p.files.committed?.files.map((f) => [f.path, f.status, f.binary]),
      [["f1.txt", "added", false], ["pic.bin", "added", true]],
    );
    assert.deepEqual(
      p.files.uncommitted?.files.map((f) => [f.path, f.status, f.added, f.removed, f.binary]).sort(),
      [
        ["a.txt", "modified", 1, 1, false],
        ["blob.dat", "added", 0, 0, true],
        ["new.txt", "added", 3, 0, false],
        ["staged.txt", "added", 2, 0, false],
      ],
      "a staged file read against HEAD with what was changed since; an untracked one by its own name with its lines",
    );
    assert.deepEqual(p.files.uncommitted?.totals, { files: 4, added: 6, removed: 1 });
  });

  // (fails before: yes — the read is new; GWC-25)
  test("the base itself: no commits ahead and no committed files, only what is uncommitted", async () => {
    const p = await branchOf(repo);
    assert.deepEqual([p.onBase, p.commits, p.files.committed, p.files.uncommitted?.files], [true, [], null, []]);
  });

  // (fails before: yes — the reads are new; GWC-30)
  test("a file of the branch with its diff: committed from where it left the base, uncommitted against HEAD as one diff", async () => {
    const f1 = await branchFileOf(wt, "f1.txt", { part: "committed" });
    assert.match(f1.patch, /\+f1\.txt/);
    const pic = await branchFileOf(wt, "pic.bin", { part: "committed" });
    assert.deepEqual([pic.binary, pic.size, pic.patch], [true, 10, ""], "a binary file says its size, no patch");
    const st = await branchFileOf(wt, "staged.txt", { part: "uncommitted" });
    assert.match(st.patch, /\+s1\n\+s2/, "what was staged and what was changed since, one diff");
    const blob = await branchFileOf(wt, "blob.dat", { part: "uncommitted" });
    assert.deepEqual([blob.untracked, blob.binary, blob.size], [true, true, 4]);
    assert.match(String((await branchFileOf(wt, "../x", { part: "committed" })).error), /outside the allowed/);
    assert.equal((await branchFileOf(repo, "a.txt", { part: "committed" })).error, null, "on the base: nothing committed to show, no error");
  });

  // (fails before: yes — the bug hunt of 10-30, GIT-1: git names a repository inside the place whole, `nested/`, even
  // file by file, and reading it as a file threw EISDIR out of the read and out of its own)
  test("a repository inside the place is one uncommitted entry with no lines, never read as a file", async () => {
    const dir = repoIn(fresh("filament-gb-nested-"));
    const nested = join(dir, "nested");
    mkdirSync(nested);
    run(nested, ["init", "-q"]);
    writeFileSync(join(nested, "n.txt"), "n\n");
    writeFileSync(join(dir, "loose.txt"), "l1\nl2\n");
    const p = await branchOf(dir);
    assert.equal(p.ok, true, p.error || "");
    assert.deepEqual(p.files.uncommitted?.files.map((f) => [f.path, f.status, f.added]), [["loose.txt", "added", 2], ["nested/", "added", 0]]);
    const f = await branchFileOf(dir, "nested/", { part: "uncommitted" });
    assert.deepEqual([f.ok, f.untracked, f.patch, f.error], [true, true, "", null]);
  });

  // (fails before: yes — the changes since a commit ran the porcelain `git diff`, which refreshed the index: a file
  // whose time alone changed rewrote it, under the index lock (GW-D31))
  test("the changes since a commit never rewrite the index, and a file whose time alone changed is in no list", async () => {
    const dir = repoIn(fresh("filament-gb-lock-"));
    const index = join(dir, ".git", "index");
    const later = new Date(Date.now() + 120_000);
    utimesSync(join(dir, "a.txt"), later, later);
    const before = readFileSync(index);
    const since = await changesSince(dir, "HEAD", { patch: true });
    assert.deepEqual([since.ok, since.files], [true, []]);
    assert.deepEqual((await diffFiles(dir, run(dir, ["rev-parse", "HEAD"]), null)).files, []);
    assert.ok(readFileSync(index).equals(before), "the index is as it was");
    run(dir, ["diff", "HEAD", "--stat"]);
    assert.ok(!readFileSync(index).equals(before), "the porcelain git diff does rewrite it: the check above can fail");
  });
});
