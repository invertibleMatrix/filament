// @ts-check
// WP-J.2: the working tree forks with the conversation. After a round in which the loop's hands wrote, the repository
// is captured as a commit on a hidden ref (HEAD, the index and `git status` untouched); the snapshot hangs off the
// archive turn; a fork at a turn carries the snapshot in force there and, on request, a detached worktree of it.
// Every repository here is a throwaway under the temp folder — never this one.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { snapshotTree, addWorktree, listSnapshots, snapshotExists, refNameOf, repoOf, noSparse, SNAPSHOT_REF_PREFIX } from "../src/adapters/git/snapshot.js";
import { Archive } from "../src/services/memory/archive.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** A throwaway repository with one commit. */
function repo(prefix = "filament-j2-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  run(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}
const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
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

// (fails before: yes — the bug round of 10-23: only git's English words were known, so a git too old for --sparse
// that speaks German never snapshot at all)
test("a git too old for --sparse is known by its usage exit, in any language", () => {
  assert.equal(noSparse({ code: 129, err: "Fehler: unbekannte Option `sparse'" }), true);
  assert.equal(noSparse({ code: 129, err: "" }), true);
  assert.equal(noSparse({ code: 1, err: "error: unknown option `sparse'" }), true, "the English words, whatever the code");
  assert.equal(noSparse({ code: 128, err: "fatal: Unable to create '/r/.git/index.lock': File exists." }), false);
  assert.equal(noSparse({ code: 0, err: "" }), false);
});

test("ref names: anything git refuses is folded, the shape stays readable", () => {
  assert.equal(refNameOf("c_abc/12-3"), "c_abc/12-3");
  assert.equal(refNameOf("..bad name..lock"), "bad-name-lock");
  assert.equal(refNameOf("a//b"), "a/b");
  assert.equal(refNameOf(""), "snapshot");
  assert.equal(refNameOf("spaces here?"), "spaces-here");
});

describe("the snapshot adapter against a throwaway repository", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let head;
  /** @type {string[]} */
  const worktrees = [];
  before(() => {
    dir = repo();
    head = run(dir, ["rev-parse", "HEAD"]);
  });
  after(() => {
    for (const w of worktrees) {
      try {
        run(dir, ["worktree", "remove", "--force", w]);
      } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("a tree equal to HEAD is no snapshot; a write becomes a commit on the hidden ref with HEAD, the index and status untouched", async () => {
    const same = await snapshotTree(dir, { name: "c1/t1-1" });
    assert.equal(same.ok, true);
    assert.equal(same.changed, false, "nothing written after all");
    assert.equal(same.ref, null);
    writeFileSync(join(dir, "b.txt"), "two\n");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "c.txt"), "three\n");
    const s = await snapshotTree(dir, { name: "c1/t1-1" });
    assert.equal(s.ok, true, s.error || "");
    assert.equal(s.changed, true);
    assert.equal(s.ref, `${SNAPSHOT_REF_PREFIX}c1/t1-1`);
    assert.match(String(s.commit), /^[0-9a-f]{40}$/);
    assert.equal(run(dir, ["rev-parse", "HEAD"]), head, "HEAD did not move");
    assert.equal(run(dir, ["status", "--porcelain"]), "?? b.txt\n?? sub/", "the developer's status is what it was: untracked files, nothing staged");
    assert.equal(run(dir, ["ls-files"]), "a.txt", "the repository's index is untouched");
    assert.equal(run(dir, ["branch", "--list"]).replace(/^\*\s*/, ""), "main", "no branch was made");
    assert.equal(run(dir, ["rev-parse", `${s.commit}^`]), head, "the first snapshot's parent is HEAD");
    assert.equal(run(dir, ["show", `${s.commit}:sub/c.txt`]), "three", "the snapshot holds the new files");
    assert.equal(run(dir, ["log", "-1", "--format=%an <%ae>", String(s.commit)]), "Filament <filament@localhost>", "Filament's own identity, not the developer's");
    assert.equal(await snapshotExists(dir, s.ref || ""), true);
    assert.equal(await snapshotExists(dir, `${SNAPSHOT_REF_PREFIX}nope`), false);
  });

  test("snapshots chain through `previous`; an unchanged tree against the previous snapshot is no commit; the list names them", async () => {
    const first = (await listSnapshots(dir))[0];
    writeFileSync(join(dir, "b.txt"), "two, edited\n");
    const s2 = await snapshotTree(dir, { name: "c1/t2-1", previous: first.commit });
    assert.equal(s2.changed, true);
    assert.equal(run(dir, ["rev-parse", `${s2.commit}^`]), first.commit, "the parent is the previous snapshot");
    const s3 = await snapshotTree(dir, { name: "c1/t2-2", previous: s2.commit });
    assert.equal(s3.changed, false, "the same tree again");
    assert.equal(s3.tree, s2.tree);
    const list = await listSnapshots(dir);
    assert.deepEqual(list.map((x) => x.name).sort(), ["c1/t1-1", "c1/t2-1"]);
    assert.ok(list.every((x) => x.ref.startsWith(SNAPSHOT_REF_PREFIX) && /^[0-9a-f]{40}$/.test(x.commit)));
  });

  test("a worktree checks a snapshot out detached beside the repository (or where told); an existing folder and a missing ref are refused in words", async () => {
    const [first] = (await listSnapshots(dir)).filter((x) => x.name === "c1/t1-1");
    const w = await addWorktree(dir, { ref: first.ref, suffix: "c1" });
    assert.equal(w.ok, true, "ok" in w && !w.ok ? w.error : "");
    if (!w.ok) return;
    worktrees.push(w.path);
    assert.equal(w.path, `${dir.replace(/[\\/]+$/, "")}-fork-c1`);
    assert.equal(readFileSync(join(w.path, "b.txt"), "utf8").replace(/\r\n/g, "\n"), "two\n", "the files as the snapshot had them, not as the folder has them now");
    assert.equal(run(w.path, ["rev-parse", "HEAD"]), first.commit, "checked out at the snapshot commit");
    assert.equal(run(w.path, ["branch", "--show-current"]), "", "detached");
    const again = await addWorktree(dir, { ref: first.ref, suffix: "c1" });
    assert.equal(again.ok, false);
    assert.match("error" in again ? again.error : "", /the worktree folder exists already/);
    const gone = await addWorktree(dir, { ref: `${SNAPSHOT_REF_PREFIX}nope`, suffix: "x" });
    assert.match("error" in gone ? gone.error : "", /is not in this repository/);
    const told = join(tmpdir(), `filament-j2-told-${Date.now().toString(36)}`);
    const w2 = await addWorktree(dir, { ref: first.ref, dest: told });
    assert.equal(w2.ok, true);
    if (w2.ok) {
      worktrees.push(w2.path);
      assert.equal(w2.path, told);
    }
  });

  /**
   * `fn` run with the system's temp folder a folder of its own, and the hooks' folders a command of Filament's made
   * there and left (`hooks`): the shared one holds other test files' hooks' folders, their commands running meanwhile.
   * @template T @param {() => Promise<T>} fn @returns {Promise<{ value: T, hooks: string[] }>}
   */
  const ownTemp = async (fn) => {
    const own = mkdtempSync(join(tmpdir(), "filament-j2-temp-"));
    /** @type {Record<string, string | undefined>} */
    const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    for (const k of Object.keys(saved)) process.env[k] = own;
    try {
      assert.equal(tmpdir(), own, "the command's temp folder is the test's own");
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

  // (fails before: yes — the bug hunt of 10-30, GIT-7: the fork's checkout ran the repository's post-checkout hook, so a
  // husky install or a notification the repository wires fired for each of Filament's copies)
  test("a fork's worktree runs none of the repository's hooks and leaves nothing beside it; git's own checkout of the same snapshot runs them", async () => {
    const own = repo("filament-j2-hooks-");
    const beside = mkdtempSync(join(tmpdir(), "filament-j2-hooks-beside-"));
    try {
      // A hook that leaves a mark where it runs.
      writeFileSync(join(own, ".git", "hooks", "post-checkout"), "#!/bin/sh\necho ran > hook-ran\n", { mode: 0o755 });
      writeFileSync(join(own, "b.txt"), "two\n");
      const s = await snapshotTree(own, { name: "hooks/t1-1" });
      assert.equal(s.ok, true, s.error || "");
      const made = await ownTemp(() => addWorktree(own, { ref: String(s.ref), dest: join(beside, "fork") }));
      const w = made.value;
      assert.equal(w.ok, true, "error" in w ? w.error : "");
      if (!w.ok) return;
      assert.equal(readFileSync(join(w.path, "b.txt"), "utf8").replace(/\r\n/g, "\n"), "two\n", "the snapshot is checked out");
      assert.equal(existsSync(join(w.path, "hook-ran")), false, "no hook ran in the fork");
      assert.deepEqual(readdirSync(beside), ["fork"], "nothing beside the fork");
      assert.deepEqual(made.hooks, [], "the hooks' folder went with the command");
      // The same hook runs for a worktree git makes by itself: the mark above means something.
      run(own, ["worktree", "add", "-q", "--detach", join(beside, "control"), String(s.commit)]);
      assert.equal(existsSync(join(beside, "control", "hook-ran")), true, "git's own worktree add runs it");
    } finally {
      rmSync(beside, { recursive: true, force: true });
      rmSync(own, { recursive: true, force: true });
    }
  });

  // (fails before: no — a guard: Git LFS brings its content through the repository's filter, which stays on with the
  // hooks off. Its filter writes LFS's own hooks into whatever folder the hooks are pointed at, making it if it is not
  // there: a folder named beside the fork would be left there, full of them.)
  test("a fork of a repository on Git LFS checks the content out, not its pointer, and leaves no hooks' folder beside it", { skip: !hasLfs && "git-lfs is not on PATH" }, async () => {
    const own = repo("filament-j2-lfs-");
    const beside = mkdtempSync(join(tmpdir(), "filament-j2-lfs-beside-"));
    try {
      run(own, ["lfs", "install", "--local"]);
      writeFileSync(join(own, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
      const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
      writeFileSync(join(own, "big.bin"), bytes);
      run(own, ["add", "."]);
      run(own, ["commit", "-q", "-m", "lfs"]);
      writeFileSync(join(own, "big.bin"), Buffer.concat([bytes, bytes]));
      const s = await snapshotTree(own, { name: "lfs/t1-1" });
      assert.equal(s.ok, true, s.error || "");
      assert.match(run(own, ["cat-file", "-p", `${s.commit}:big.bin`]), /^version https:\/\/git-lfs\.github\.com\/spec\/v1/, "the snapshot holds LFS's pointer");
      const made = await ownTemp(() => addWorktree(own, { ref: String(s.ref), dest: join(beside, "fork") }));
      const w = made.value;
      assert.equal(w.ok, true, "error" in w ? w.error : "");
      if (!w.ok) return;
      assert.deepEqual(readFileSync(join(w.path, "big.bin")), Buffer.concat([bytes, bytes]), "the fork holds the content the snapshot took");
      assert.deepEqual(readdirSync(beside), ["fork"], "nothing beside the fork");
      assert.deepEqual(made.hooks, [], "the hooks' folder went with the command, LFS's hooks with it");
    } finally {
      rmSync(beside, { recursive: true, force: true });
      rmSync(own, { recursive: true, force: true });
    }
  });

  test("an inherited GIT_DIR does not redirect the snapshot into another repository", async () => {
    const other = repo("filament-j2-other-");
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = join(other, ".git");
    try {
      writeFileSync(join(dir, "redirect.txt"), "here\n");
      const s = await snapshotTree(dir, { name: "c1/t9-1" });
      assert.equal(s.ok, true, s.error || "");
      /** @type {Record<string, string | undefined>} */
      const cleanEnv = { ...GIT_ENV };
      delete cleanEnv.GIT_DIR;
      const inRepo = (cwd) => spawnSync("git", ["rev-parse", "--verify", "-q", `${SNAPSHOT_REF_PREFIX}c1/t9-1`], { cwd, encoding: "utf8", env: cleanEnv, windowsHide: true });
      assert.equal(inRepo(dir).stdout.trim(), s.commit, "the ref is in the folder's own repository");
      assert.equal(inRepo(other).status, 1, "and not in the one GIT_DIR pointed at");
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("a `previous` this repository does not have is dropped, not fatal: HEAD becomes the parent and the chain goes on", async () => {
    writeFileSync(join(dir, "again.txt"), "more\n");
    const s = await snapshotTree(dir, { name: "c1/t10-1", previous: "0123456789abcdef0123456789abcdef01234567" });
    assert.equal(s.ok, true, s.error || "");
    assert.equal(s.changed, true);
    assert.equal(run(dir, ["rev-parse", `${s.commit}^`]), head, "HEAD stood in for the unknown parent");
  });

  test("a sparse checkout snapshots a file written outside its cone", async () => {
    const sparse = repo("filament-j2-sparse-");
    try {
      mkdirSync(join(sparse, "keep"));
      writeFileSync(join(sparse, "keep", "k.txt"), "kept\n");
      run(sparse, ["add", "."]);
      run(sparse, ["commit", "-q", "-m", "two"]);
      run(sparse, ["sparse-checkout", "set", "keep"]);
      mkdirSync(join(sparse, "outside"), { recursive: true });
      writeFileSync(join(sparse, "outside", "o.txt"), "out of cone\n");
      const s = await snapshotTree(sparse, { name: "c1/t11-1" });
      assert.equal(s.ok, true, s.error || "");
      assert.equal(s.changed, true);
      assert.equal(run(sparse, ["show", `${s.commit}:outside/o.txt`]).replace(/\r/g, ""), "out of cone");
      assert.equal(run(sparse, ["show", `${s.commit}:a.txt`]).replace(/\r/g, ""), "one", "a tracked file outside the cone survives, not deleted");
    } finally {
      rmSync(sparse, { recursive: true, force: true });
    }
  });

  test("the snapshot starts no fsmonitor the repository configures (fails before: yes — `git add` ran it, a command planted in .git/config)", async () => {
    const own = repo("filament-j2-fsmon-");
    try {
      const mark = join(own, "fsmonitor-ran");
      const hook = join(own, "fsmonitor.sh");
      writeFileSync(hook, `#!/bin/sh\necho ran > '${mark.replaceAll("\\", "/")}'\nexit 1\n`, { mode: 0o755 });
      run(own, ["config", "core.fsmonitor", hook.replaceAll("\\", "/")]);
      writeFileSync(join(own, "a.txt"), "changed\n");
      const s = await snapshotTree(own, { name: "fsmonitor" });
      assert.equal(s.ok, true, s.error || "");
      assert.equal(s.changed, true);
      assert.equal(existsSync(mark), false, "the configured fsmonitor did not run");
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  test("no git: said in words, nothing thrown", async () => {
    const plain = mkdtempSync(join(tmpdir(), "filament-j2-nogit-"));
    try {
      const r = await repoOf(plain);
      assert.equal(r.repo, null);
      assert.match(r.error, /not a git repository/);
      const s = await snapshotTree(plain, { name: "x" });
      assert.equal(s.ok, false);
      assert.match(String(s.error), /not a git repository \(no snapshot without one\)/);
      const w = await addWorktree(plain, { ref: "refs/x" });
      assert.equal(w.ok, false);
      assert.equal(await snapshotExists(plain, "refs/x"), false);
      assert.deepEqual(await listSnapshots(plain), []);
      const missing = await snapshotTree(join(plain, "does-not-exist"), { name: "x" });
      assert.match(String(missing.error), /does not exist/);
      // (fails before: yes — the bug round of 10-23) A `.git` git will not read is a repository refused, not none: a
      // worktree whose records are gone, here.
      const stale = join(plain, "stale");
      mkdirSync(join(stale, "deep"), { recursive: true });
      writeFileSync(join(stale, ".git"), `gitdir: ${join(plain, "gone", ".git", "worktrees", "x")}\n`);
      const refused = await repoOf(join(stale, "deep"));
      assert.equal(refused.repo, null);
      assert.match(refused.error, /^git refuses the repository this folder is in: fatal: not a git repository/);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("the archive: a snapshot per turn, the fork carries the one in force", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-j2-archive-"));
  let clock = 1_758_000_000_000;
  // The Archive class is on the untyped list until its JSDoc lands (as in archive-fork.test.js).
  /** @type {any} */
  const a = new (/** @type {any} */ (Archive))({ file: join(dir, "a.db"), now: () => (clock += 1000) });
  after(() => {
    a.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const user = (t) => ({ role: "user", content: [{ type: "text", text: t }] });
  const final = (t) => ({ role: "assistant", content: [{ type: "text", text: t }] });
  let seq = 0;
  const turn = (chainId, t) => {
    const { turnId } = a.beginTurn(chainId, { requestId: `r${++seq}`, model: "m", upstream: "u", userMessage: user(t) });
    a.finishTurn(turnId, { finalMessage: final(`answer ${t}`), requestId: `r${seq}` });
    return turnId;
  };

  test("setTurnTree/treeAtTurn: the newest snapshot at or before a turn; forkChain records it; none stays null", () => {
    const ch = a.chainForKey("k1", { cwd: "C:\\j2\\proj", client: "c", model: "m" });
    const t1 = turn(ch.id, "one");
    const t2 = turn(ch.id, "two");
    const t3 = turn(ch.id, "three");
    assert.equal(a.treeAtTurn(ch.id, 3), null, "nothing yet");
    a.setTurnTree(t1, { ref: "refs/filament/snapshots/x/1-1", commit: "a".repeat(40), round: 1 });
    a.setTurnTree(t1, { ref: "refs/filament/snapshots/x/1-2", commit: "b".repeat(40), round: 2 });
    a.setTurnTree(t3, { ref: "refs/filament/snapshots/x/3-1", commit: "c".repeat(40), round: 1 });
    assert.deepEqual(a.getTurn(t1).meta.tree, { snapshotRef: "refs/filament/snapshots/x/1-2", commit: "b".repeat(40), at: a.getTurn(t1).meta.tree.at, round: 2 }, "the newest of the turn wins");
    assert.equal(a.treeAtTurn(ch.id, 1)?.snapshotRef, "refs/filament/snapshots/x/1-2");
    assert.equal(a.treeAtTurn(ch.id, 2)?.snapshotRef, "refs/filament/snapshots/x/1-2", "turn 2 wrote nothing: turn 1's snapshot is in force");
    assert.equal(a.treeAtTurn(ch.id, 2)?.turn, 1);
    assert.equal(a.treeAtTurn(ch.id, 3)?.snapshotRef, "refs/filament/snapshots/x/3-1");
    assert.throws(() => a.setTurnTree(999999, { ref: "r", commit: "c" }), /no turn 999999/);
    const f2 = a.forkChain(ch.id, { atTurn: 2, key: "k-fork-2" });
    assert.deepEqual(f2.meta.tree, { snapshotRef: "refs/filament/snapshots/x/1-2", commit: "b".repeat(40), turn: 1 });
    const f3 = a.forkChain(ch.id, { atTurn: 3, key: "k-fork-3" });
    assert.equal(f3.meta.tree.snapshotRef, "refs/filament/snapshots/x/3-1");
    const bare = a.chainForKey("k2", { cwd: "C:\\j2\\proj", client: "c", model: "m" });
    turn(bare.id, "only");
    const f0 = a.forkChain(bare.id, { atTurn: 1, key: "k-fork-0" });
    assert.deepEqual(f0.meta.tree, { snapshotRef: null }, "no snapshot anywhere: the reserved shape from J.1");
    void t2;
  });

  // (fails before: yes — D7 of 11-01: the snapshot in force said nothing of what its turn, or a later one, wrote in the
  // folder that no snapshot held)
  test("treeAtTurn says what the snapshot's turn and the turns since wrote that no snapshot holds; a snapshot after holds it", () => {
    const ch = a.chainForKey("k-unheld", { cwd: "C:\\j2\\proj", client: "c", model: "m" });
    const t1 = turn(ch.id, "one");
    const t2 = turn(ch.id, "two");
    a.setTurnTree(t1, { ref: "refs/filament/snapshots/u/1-1", commit: "a".repeat(40), round: 1 });
    a.mergeTurnMeta(t1, { treeUnheld: { round: 2, files: ["a.txt"], command: false } });
    a.mergeTurnMeta(t2, { treeUnheld: { round: 1, files: [], command: true } });
    const at2 = a.treeAtTurn(ch.id, 2);
    assert.deepEqual([at2?.turn, at2?.round, at2?.unheld], [1, 1, [{ round: 1, files: [], command: true, turn: 2 }, { round: 2, files: ["a.txt"], command: false, turn: 1 }]]);
    assert.deepEqual(a.treeAtTurn(ch.id, 1)?.unheld, [{ round: 2, files: ["a.txt"], command: false, turn: 1 }]);
    a.setTurnTree(t2, { ref: "refs/filament/snapshots/u/2-2", commit: "b".repeat(40), round: 2 });
    assert.deepEqual([a.treeAtTurn(ch.id, 2)?.turn, a.treeAtTurn(ch.id, 2)?.unheld], [2, undefined], "turn 2's snapshot holds what it and turn 1 wrote");
    assert.equal(a.getTurn(t2).meta.treeUnheld, undefined);
  });
});

describe("the agent loop snapshots after writing rounds; a fork rewinds conversation and files together", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let plainRoot;
  /** @type {string} */
  let head;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  /** @type {string[]} */
  const worktrees = [];
  before(async () => {
    root = repo("filament-j2-loop-");
    head = run(root, ["rev-parse", "HEAD"]);
    plainRoot = mkdtempSync(join(tmpdir(), "filament-j2-plain-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      summarizer: "",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root, plainRoot], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const w of worktrees) {
      try {
        run(root, ["worktree", "remove", "--force", w]);
      } catch {}
      rmSync(w, { recursive: true, force: true });
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(plainRoot, { recursive: true, force: true });
  });
  const SESSION = { "x-filament-cwd": "", "x-session-id": "j2-session" };
  const ask = async (content, headers) => {
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, messages: [{ role: "user", content }] }, headers);
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const id = r.headers.get("x-filament-request-id");
    return { text: text(j.content), id, rec: await shim.record(id) };
  };
  const eventsOf = async (runId) => (await (await shim.api(`/api/runs/${runId}/events?since=0&limit=5000`)).json()).events;
  /** @type {string} */
  let chain = "";
  /** @type {any[]} */
  const snaps = [];

  test("turn 1 writes: one snapshot event, the ref named after the session and turn, HEAD and status untouched, the turn row knows", async () => {
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("w1", "write", { path: "notes.md", content: "first draft\n" })], "tool_use");
      return reply([{ type: "text", text: "Wrote the notes." }]);
    };
    const r = await ask("write a notes file", { ...SESSION, "x-filament-cwd": root });
    assert.equal(r.text, "Wrote the notes.");
    chain = r.rec.memory.chain;
    assert.ok(chain);
    const ev = await eventsOf(r.id);
    const snap = ev.filter((e) => e.type === "snapshot");
    assert.equal(snap.length, 1, JSON.stringify(ev.map((e) => e.type)));
    assert.equal(snap[0].round, 1);
    assert.equal(snap[0].ref, `${SNAPSHOT_REF_PREFIX}${chain}/${r.rec.memory.turn}-1`);
    assert.match(snap[0].after, /^[0-9a-f]{40}$/);
    // The round's record: the place, its agent, the snapshots around its hands, the files its own calls named.
    assert.deepEqual([snap[0].place, snap[0].agent, snap[0].base, snap[0].own, snap[0].command], [run(root, ["rev-parse", "--show-toplevel"]), "", "round", ["notes.md"], false]);
    assert.ok(!("files" in snap[0]), "names only on the event: no counts, no patch");
    assert.ok((r.rec.changes || []).some((c) => c === `agent: working tree snapshotted after round 1 (${snap[0].ref})`), JSON.stringify(r.rec.changes));
    assert.equal(run(root, ["rev-parse", "HEAD"]), head, "HEAD did not move");
    assert.equal(run(root, ["status", "--porcelain"]), "?? notes.md", "the developer sees an untracked file and nothing staged");
    assert.equal(run(root, ["show", `${snap[0].after}:notes.md`]).replace(/\r/g, ""), "first draft", "the snapshot holds the written file");
    const detail = await (await shim.api(`/api/memory/sessions/${chain}`)).json();
    assert.equal(detail.turns.length, 1);
    const tree = /** @type {any} */ (shim.app).memory.archive.getTurn(r.rec.memory.turn).meta.tree;
    assert.equal(tree.snapshotRef, snap[0].ref);
    assert.equal(tree.commit, snap[0].after);
    assert.equal(tree.round, 1);
    snaps.push(snap[0]);
  });

  test("turn 2 only reads: no snapshot; turn 3 writes again: a second snapshot whose parent is the first", async () => {
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("r1", "read", { path: "notes.md" })], "tool_use");
      return reply([{ type: "text", text: "Read it." }]);
    };
    const r2 = await ask("read the notes back", { ...SESSION, "x-filament-cwd": root });
    assert.equal(r2.text, "Read it.");
    assert.equal((await eventsOf(r2.id)).filter((e) => e.type === "snapshot").length, 0, "a reading round is no snapshot");
    assert.ok(!(r2.rec.changes || []).some((c) => /snapshot/.test(c)));
    round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("e1", "edit", { path: "notes.md", edits: [{ oldText: "first draft", newText: "second draft" }] })], "tool_use");
      return reply([{ type: "text", text: "Edited." }]);
    };
    const r3 = await ask("change first to second", { ...SESSION, "x-filament-cwd": root });
    assert.equal(r3.text, "Edited.");
    const snap = (await eventsOf(r3.id)).filter((e) => e.type === "snapshot");
    assert.equal(snap.length, 1);
    assert.equal(run(root, ["rev-parse", `${snap[0].after}^`]), snaps[0].after, "the chain's snapshots are each other's parents");
    assert.equal(snap[0].before, snaps[0].after, "the folder before the round stood where the chain left it");
    assert.equal(run(root, ["show", `${snap[0].after}:notes.md`]).replace(/\r/g, ""), "second draft");
    assert.equal(run(root, ["rev-parse", "HEAD"]), head);
    assert.equal(run(root, ["status", "--porcelain"]), "?? notes.md");
    snaps.push(snap[0]);
    const names = (await listSnapshots(root)).map((s) => s.name).sort();
    assert.equal(names.length, 2);
    assert.ok(names.every((n) => n.startsWith(`${chain}/`)));
  });

  test("fork at turn 1 with a worktree: the files as turn 1 left them, beside the repository; at turn 2 the snapshot in force is still turn 1's", async () => {
    const r = await shim.api(`/api/sessions/${chain}/fork`, { method: "POST", body: { atTurn: 1, worktree: true } });
    const body = await r.text();
    assert.equal(r.status, 200, body);
    const fork = JSON.parse(body);
    assert.equal(fork.tree.snapshotRef, snaps[0].ref);
    assert.equal(fork.tree.commit, snaps[0].after);
    assert.equal(fork.tree.turn, 1);
    assert.ok(fork.tree.worktree, JSON.stringify(fork.tree));
    worktrees.push(fork.tree.worktree);
    assert.equal(fork.tree.worktree, `${root.replace(/[\\/]+$/, "")}-fork-${fork.chainId}`);
    assert.equal(readFileSync(join(fork.tree.worktree, "notes.md"), "utf8").replace(/\r/g, ""), "first draft\n", "the worktree has turn 1's file, not the folder's current second draft");
    assert.equal(readFileSync(join(root, "notes.md"), "utf8").replace(/\r/g, ""), "second draft\n", "the working folder itself is untouched");
    assert.equal(run(fork.tree.worktree, ["rev-parse", "HEAD"]), snaps[0].after);
    const meta = /** @type {any} */ (shim.app).memory.archive.getChain(fork.chainId).meta;
    assert.equal(meta.tree.worktree, fork.tree.worktree, "the fork's row remembers its worktree");
    assert.equal(meta.tree.snapshotRef, snaps[0].ref);
    const truth = await (await shim.api(`/api/sessions/${fork.chainId}`)).json();
    assert.equal(JSON.stringify(truth).includes(snaps[0].ref), true, "the inspector's read side sees the ref");
    // At turn 2 nothing was written: the snapshot in force is turn 1's. Without `worktree` nothing is checked out.
    const r2 = await shim.api(`/api/sessions/${chain}/fork`, { method: "POST", body: { atTurn: 2 } });
    const f2 = await r2.json();
    assert.equal(r2.status, 200, JSON.stringify(f2));
    assert.equal(f2.tree.snapshotRef, snaps[0].ref);
    assert.equal(f2.tree.turn, 1);
    assert.equal(f2.tree.worktree, undefined);
    // At turn 3, into a folder the caller names.
    const told = join(tmpdir(), `filament-j2-told-${Date.now().toString(36)}`);
    const r3 = await shim.api(`/api/sessions/${chain}/fork`, { method: "POST", body: { atTurn: 3, worktree: told } });
    const f3 = await r3.json();
    assert.equal(r3.status, 200, JSON.stringify(f3));
    assert.equal(f3.tree.snapshotRef, snaps[1].ref);
    assert.equal(f3.tree.worktree, told);
    worktrees.push(told);
    assert.equal(readFileSync(join(told, "notes.md"), "utf8").replace(/\r/g, ""), "second draft\n");
    // The same fork turn again into the default folder: a second fork gets its own folder (named by its chain id).
    const r4 = await shim.api(`/api/sessions/${chain}/fork`, { method: "POST", body: { atTurn: 1, worktree: true } });
    const f4 = await r4.json();
    assert.equal(r4.status, 200);
    assert.ok(f4.tree.worktree && f4.tree.worktree !== fork.tree.worktree);
    worktrees.push(f4.tree.worktree);
    // A folder that exists already is a note, not a failure: the conversation still forks.
    const r5 = await shim.api(`/api/sessions/${chain}/fork`, { method: "POST", body: { atTurn: 1, worktree: told } });
    const f5 = await r5.json();
    assert.equal(r5.status, 200);
    assert.ok(f5.chainId);
    assert.equal(f5.tree.worktree, null);
    assert.match(f5.tree.note, /the worktree folder exists already/);
    assert.equal(f5.tree.snapshotRef, snaps[0].ref, "the ref is still on the fork for a later checkout");
  });

  // (fails before: yes — HarnessV4_Git_Plan GWC-19: the file was in no record, only a note that the folder took no
  // snapshot)
  test("a folder with no git: the write runs, its record keeps the file by its path, and a fork with a worktree says there is no snapshot", async () => {
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("w1", "write", { path: "plain.txt", content: "no repo here\n" })], "tool_use");
      return reply([{ type: "text", text: "Written without git." }]);
    };
    const r = await ask("write a file here", { "x-filament-cwd": plainRoot, "x-session-id": "j2-plain" });
    assert.equal(r.text, "Written without git.");
    assert.equal(existsSync(join(plainRoot, "plain.txt")), true, "the hand wrote regardless");
    const snap = (await eventsOf(r.id)).filter((e) => e.type === "snapshot");
    assert.deepEqual(snap.map((e) => [e.place, e.base, e.after, e.ref, e.own]), [["", "none", null, null, [join(plainRoot, "plain.txt")]]]);
    assert.ok(!(r.rec.changes || []).some((c) => /snapshot/.test(c)), JSON.stringify(r.rec.changes));
    const t = await (await shim.api(`/api/memory/sessions/${r.rec.memory.chain}/changes?turn=1`)).json();
    assert.deepEqual([t.files, t.outside, t.folder], [[], [{ agent: "", path: join(plainRoot, "plain.txt") }], null]);
    const f = await (await shim.api(`/api/sessions/${r.rec.memory.chain}/fork`, { method: "POST", body: { atTurn: 1, worktree: true } })).json();
    assert.ok(f.chainId, "the conversation forks");
    assert.equal(f.tree.snapshotRef, null);
    assert.equal(f.tree.worktree, null);
    assert.match(f.tree.note, /turn 1 has no working-tree snapshot/);
  });

  test("agentLoop.treeSnapshots off: a writing round takes no snapshot", async () => {
    const st = await (await shim.api("/api/state")).json();
    const put = await shim.api("/api/config", { method: "PUT", body: { ...st.config, agentLoop: { ...st.config.agentLoop, treeSnapshots: false } } });
    assert.equal(put.status, 200, await put.text());
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("w2", "write", { path: "notes.md", content: "third draft\n" })], "tool_use");
      return reply([{ type: "text", text: "Third." }]);
    };
    const r = await ask("write a third draft", { ...SESSION, "x-filament-cwd": root });
    assert.equal(r.text, "Third.");
    assert.equal((await eventsOf(r.id)).filter((e) => e.type === "snapshot").length, 0);
    assert.ok(!(r.rec.changes || []).some((c) => /snapshot/.test(c)), JSON.stringify(r.rec.changes));
    assert.equal((await listSnapshots(root)).length, 2, "still the two from before");
  });
});
