// @ts-check
// A branch's new commits as a watcher's trigger (the plan of 11-11, its w3): its tip read within moments of a commit,
// whichever worktree made it; a move from the commit a watcher last looked at heard as one event — the commits added,
// what a rewrite dropped, a move back —; its first look where it listens from; a restart caught up from there; never the
// watcher's own commits.
// (fails before: yes — nothing watched a branch, a commit trigger woke nothing, and a watcher's cursor kept no head)
// The review of 11-11 (fails before: yes, each — a watch held its repository's folders open, so none could be renamed
// on Windows; a branch named in another case read as there, then deleted as its refs were packed; a look could fetch
// what a partial clone lacked; a commit made elsewhere during an own turn and pulled later was taken for its own; a
// look that threw was never tried again, one in flight at the stop still heard, and a move past the commits read was
// judged by the newest alone; a watcher that could not read its branch said so nowhere).
// Its own by its chats' commands, not their turns (fails before: yes, each marked so below — a chat's whole turn was its
// own time, so another's commit made while it was at work, or while another chat a second watcher wakes was, was looked
// at and never heard; and a commit its background command or its sub-agent made after its turn was news to it).
// A background command's own time its first and last two minutes (fails before: yes, each marked so below — its whole
// run was its chat's, so a commit the person made while a dev server of the chat's ran was never heard).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_BRANCH, watchEventOf } from "../src/core/watchers.js";
import { routineFields, rowWords } from "../src/core/routines.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createEventBus } from "../src/services/events.js";
import { branchHead, commitsBetween, commitsMade, commonDirOf, watchBranch } from "../src/adapters/git/watch.js";
import { onShellsChange, runningShellsOf, startCommandShell } from "../src/adapters/tools/hands.js";
import { createCommitWatch } from "../src/app/watchers/commits.js";
import { createOwnTimes } from "../src/app/watchers/own-times.js";
import { gate, removeDirs, scaledMs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-git-watch-${tag}-`));
  made.push(d);
  return d;
};
/** A repository on main with one commit, and its git. @param {string} tag */
const repo = (tag) => {
  const dir = fresh(tag);
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  let n = 0;
  /** A commit of a new file, its subject given; `at`, its committer's time where not now. @param {string} subject @param {string} [cwd] @param {number} [at] */
  const commit = (subject, cwd = dir, at = undefined) => {
    n += 1;
    writeFileSync(join(cwd, `f${n}.txt`), `${n}\n`);
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd });
    const env = at ? { ...process.env, GIT_COMMITTER_DATE: `@${Math.floor(at / 1000)} +0000` } : process.env;
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", subject], { cwd, env });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  };
  const first = commit("init");
  return { dir, git, commit, first };
};
const A = "a".repeat(40);
const B = "b".repeat(40);

describe("a branch's move in words (core)", () => {
  /** @param {any} over */
  const words = (over) => watchEventOf({ kind: "commit", at: 5, after: 3, place: "/r", branch: "main", from: A, to: B, added: [], more: 0, dropped: 0, gone: false, ...over }, { kind: "commit", branch: "main" }, () => "");
  test("new commits, newest first, by short id and subject; a rewrite, a move back, a commit gone; its id the move's", () => {
    const e = words({ added: [{ sha: "1234567890".repeat(4), subject: "Fix login" }, { sha: "abcdef0123".repeat(4), subject: "Add tests" }] });
    assert.equal(e.summary, "2 new commits on main: 1234567 Fix login; abcdef0 Add tests");
    assert.deepEqual([e.kind, e.ref, e.at], ["commit", B, 5]);
    assert.match(e.id, /^commit:[0-9a-f]+:aaaaaaaaaaaa\.\.bbbbbbbbbbbb:3$/);
    assert.notEqual(words({ after: 9 }).id, words({}).id, "the same move again, from a later cursor, is another");
    assert.equal(words({ from: null, added: [{ sha: A, subject: "Cut" }] }).summary, "main was made, with 1 new commit: aaaaaaa Cut");
    assert.equal(words({ from: null }).summary, "main was made, at bbbbbbb");
    const deleted = words({ to: null });
    assert.deepEqual([deleted.summary, deleted.ref], ["main was deleted; it was at aaaaaaa", undefined]);
    assert.equal(words({ added: [{ sha: A, subject: "One" }], more: 3 }).summary, "4 new commits on main: aaaaaaa One (and 3 more)");
    assert.equal(words({ added: [{ sha: A, subject: "Redo" }], dropped: 2 }).summary, "main was rewritten: 2 commits dropped, 1 new: aaaaaaa Redo");
    assert.equal(words({ dropped: 1 }).summary, "main moved back 1 commit, to bbbbbbb");
    assert.equal(words({ gone: true }).summary, "main moved to bbbbbbb; the commit it was at (aaaaaaa) is gone, so what changed is unknown");
    const long = words({ added: Array.from({ length: 30 }, (_, i) => ({ sha: A, subject: `Change number ${i} with a subject long enough to fill the line` })) });
    assert.ok(long.summary.length <= 300 && /\(and \d+ more\)$/.test(long.summary), long.summary);
  });
});

describe("a branch read and watched (git)", () => {
  test("its tip, none where it has no such branch; what a move added, dropped, or that its start is gone", async () => {
    const r = repo("read");
    assert.deepEqual(await branchHead(r.dir, "main"), { ok: true, head: r.first });
    assert.deepEqual(await branchHead(r.dir, "nope"), { ok: true, head: null });
    const second = r.commit("Second");
    const third = r.commit("Third");
    const m = await commitsBetween(r.dir, r.first, third);
    assert.ok(m.ok && !m.gone);
    assert.deepEqual([m.added.map((c) => c.subject), m.more, m.dropped], [["Third", "Second"], 0, 0]);
    assert.ok(m.added[0].at > 0 && Math.abs(m.added[0].at - Date.now()) < 120_000, "its committer's time, in ms");
    const cut = await commitsBetween(r.dir, r.first, third, { most: 1 });
    assert.ok(cut.ok && !cut.gone && cut.added.length === 1 && cut.more === 1);
    r.git("reset", "-q", "--hard", second);
    const back = await commitsBetween(r.dir, third, second);
    assert.ok(back.ok && !back.gone && back.added.length === 0 && back.dropped === 1);
    assert.deepEqual(await commitsBetween(r.dir, "c".repeat(40), second), { ok: true, gone: true });
    const gone = await branchHead(join(r.dir, "missing"), "main");
    assert.equal(gone.ok, false);
    // As the disk names it, case and all: a watch on a case-sensitive disk finds it.
    const common = await commonDirOf(r.dir);
    assert.ok(common && existsSync(join(common, "refs", "heads")), String(common));
    r.git("checkout", "-q", "--detach");
    r.commit("Cut one");
    const cut2 = r.commit("Cut two");
    r.git("branch", "release", cut2);
    const made = await commitsMade(r.dir, "release", cut2);
    assert.ok(made.ok);
    assert.deepEqual(made.added.map((c) => c.subject), ["Cut two", "Cut one"], "only what no other branch holds");
  });

  test("a commit is heard within moments, whichever worktree made it and whichever the watch is placed in; read slowly where its refs cannot be looked at", async (t) => {
    const r = repo("watch");
    /** @type {string[]} */
    const heads = [];
    /** How long after each commit its tip was heard, in ms. @type {number[]} */
    const took = [];
    const w = watchBranch(r.dir, "main", { onHead: (h) => void (h && heads.push(h)) });
    /** @param {string} sha @param {string} what @param {string[]} [by] */
    const heardIn = async (sha, what, by = heads) => {
      const t0 = Date.now();
      await until(() => by.at(-1) === sha, what, { timeoutMs: 5000 });
      took.push(Date.now() - t0);
    };
    try {
      await until(() => heads.length === 1, "the first read");
      assert.equal(heads[0], r.first);
      assert.equal(w.mode(), "poll");
      await heardIn(r.commit("Second"), "the commit heard");
      // A worktree of it on main's branch? A branch is checked out once: the worktree commits on its own, and main moves as
      // it is merged there.
      const wt = join(fresh("wt"), "tree");
      r.git("worktree", "add", "-q", "-b", "side", wt);
      const side = r.commit("From the side", wt);
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "merge", "-q", "--ff-only", "side"], { cwd: r.dir });
      await heardIn(side, "main moved by a merge of the worktree's commit");
      // packed: the branch's ref in packed-refs alone.
      r.git("pack-refs", "--all");
      await heardIn(r.commit("Third"), "a commit after the refs were packed");
      // A watch placed in the linked worktree looks at the same refs: a commit made in the main folder is heard there.
      /** @type {string[]} */
      const inTree = [];
      const placed = watchBranch(wt, "main", { onHead: (h) => void (h && inTree.push(h)) });
      try {
        await until(() => inTree.length === 1, "the first read from the worktree");
        assert.equal(placed.mode(), "poll");
        const fourth = r.commit("Seen from the worktree");
        await heardIn(fourth, "main's commit heard by the watch placed in the worktree", inTree);
        await until(() => heads.at(-1) === fourth, "and by the one in the main folder", { timeoutMs: 5000 });
      } finally {
        placed.stop();
      }
      assert.equal(new Set(heads).size, heads.length, "each tip once");
      t.diagnostic(`heard ${took.join(", ")} ms after each commit (its refs looked at every second)`);
    } finally {
      w.stop();
    }
    /** @type {string[]} */
    const slow = [];
    const s = watchBranch(r.dir, "main", { onHead: (h) => void (h && slow.push(h)), slow: true, slowMs: 100 });
    try {
      await until(() => slow.length === 1, "the slow first read");
      assert.equal(s.mode(), "slow");
      const fifth = r.commit("Fifth");
      await until(() => slow.at(-1) === fifth, "the slow read's commit");
    } finally {
      s.stop();
    }
  });

  test("a watched repository's folder can be renamed: the watch holds nothing of it open, says it gone, and reads on once it is back", async () => {
    const r = repo("rename");
    /** @type {(string | null)[]} */
    const heads = [];
    /** @type {(string | null)[]} */
    const errors = [];
    const w = watchBranch(r.dir, "main", { onHead: (h) => void heads.push(h), onError: (e) => void errors.push(e), slowMs: 100 });
    try {
      await until(() => heads.length === 1, "the first read");
      const moved = `${r.dir}-moved`;
      made.push(moved);
      // On Windows a folder held open cannot be renamed, nor one above it.
      renameSync(r.dir, moved);
      await until(() => errors.at(-1) === "the folder is gone", "the folder said gone");
      renameSync(moved, r.dir);
      await until(() => errors.at(-1) === null, "read again once it is back");
      await until(() => w.mode() === "poll", "its refs looked at again");
      const second = r.commit("After it came back");
      await until(() => heads.at(-1) === second, "a commit heard once it is back", { timeoutMs: 5000 });
      assert.deepEqual(heads, [r.first, second], "its tip the same across the move: heard once");
    } finally {
      w.stop();
    }
  });

  test("a branch is read by its exact name: one that differs only by case is refused where the disk tells no case apart, the same loose and packed", async () => {
    const r = repo("case");
    let insensitive = false;
    try {
      insensitive = r.git("config", "--type=bool", "--get", "core.ignorecase") === "true";
    } catch {}
    const loose = await branchHead(r.dir, "MAIN");
    r.git("pack-refs", "--all");
    const packed = await branchHead(r.dir, "MAIN");
    assert.deepEqual(packed, loose, "the same answer, its ref loose or packed");
    assert.deepEqual(loose, insensitive ? { ok: false, error: "it is named main, not MAIN" } : { ok: true, head: null });
    assert.deepEqual(await branchHead(r.dir, "main"), { ok: true, head: r.first }, "its own name, packed");
    r.git("branch", "release/1.2");
    assert.deepEqual(await branchHead(r.dir, "release/1.2"), { ok: true, head: r.first });
    assert.deepEqual(await branchHead(r.dir, "release"), { ok: true, head: null }, "a folder of branches is no branch");
  });

  test("a look fetches nothing: a commit a partial clone lacks is gone to it, never brought from its remote", async () => {
    const src = repo("lazy-src");
    const second = src.commit("Second");
    const part = repo("lazy-part");
    part.git("remote", "add", "origin", src.dir);
    part.git("config", "remote.origin.promisor", "true");
    part.git("config", "remote.origin.partialclonefilter", "blob:none");
    part.git("config", "extensions.partialclone", "origin");
    const has = () => {
      try {
        execFileSync("git", ["cat-file", "-e", `${second}^{commit}`], { cwd: part.dir, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    assert.equal(has(), false, "the clone lacks it");
    assert.deepEqual(await commitsBetween(part.dir, second, part.first), { ok: true, gone: true });
    assert.equal(has(), false, "and still does: nothing was fetched");
  });
});

/**
 * A Space whose one watcher watches `branch` in a repository. Its chats: run1, a routine's run there; run2, a run in
 * another repository; c1, the chat that proposed it; c2, another chat there.
 * `afterHeard`: called as each hearing is kept; `watch`, the branch watch's own options — its refs looked at ten times a
 * second unless it says —; `second`, a second watcher of the same branch (r2); `commonOf`, how the commit watch finds a
 * folder's repository. Its store is over a folder: `reopen`, Filament started again — a store read anew from it —, and
 * `filed`, the watcher as its file holds it now.
 * @param {string} tag @param {{ wakes?: "new" | "chat" | "you", branch?: string, between?: any, afterHeard?: (id: string, n: number) => unknown, watch?: any, second?: boolean, commonOf?: any }} [o]
 */
const rig = (tag, { wakes = "new", branch = "main", between = undefined, afterHeard = undefined, watch = undefined, second = false, commonOf = undefined } = {}) => {
  const r = repo(tag);
  const elsewhere = repo(`${tag}-else`);
  const space = fresh(`${tag}-space`);
  let store = createSpaceStore({ dir: space });
  const f = routineFields({ title: "Commits", text: "Review what landed.", trigger: { kind: "commit", branch, place: r.dir }, wakes }, { create: true });
  assert.ok(f.ok, JSON.stringify(f));
  store.routinePropose("p1", f.fields, { chain: "c1", byName: "Lead", model: "m", nameOf: () => "Lead" });
  store.routineOn("p1", "r1");
  if (second) {
    const two = store.routinePropose("p1", f.fields, { chain: "c1", byName: "Lead", model: "m", nameOf: () => "Lead" });
    store.routineOn("p1", two.id);
  }
  /** @type {any[][]} */
  const woke = [];
  /** Each hearing kept, by its watcher: its id and its events' words. @type {[string, string[]][]} */
  const heardBy = [];
  /** @type {string[]} */
  const logged = [];
  /** @type {Record<string, { run: boolean, folder: string }>} */
  const chats = { run1: { run: true, folder: r.dir }, run2: { run: true, folder: elsewhere.dir }, c1: { run: false, folder: r.dir }, c2: { run: false, folder: r.dir } };
  /** The keeper of each chat's own times, as the server makes one: a test says a chat's turns, runs and commands to it. */
  const own = createOwnTimes();
  const make = () =>
    createCommitWatch({
      store,
      own,
      heard: async (project, id, events) => {
        const n = store.watchHeard(project, id, events);
        if (n) woke.push([...events]);
        if (n) heardBy.push([id, events.map((/** @type {any} */ e) => e.summary)]);
        await afterHeard?.(id, n);
        return n;
      },
      folderOf: () => null,
      chatOf: (chain) => chats[chain] ?? null,
      ...(between ? { between } : {}),
      ...(commonOf ? { commonOf } : {}),
      watch: (/** @type {string} */ p, /** @type {string} */ b, /** @type {any} */ o) => watchBranch(p, b, { ...o, pollMs: 100, ...watch }),
      retryMs: 50,
      log: (_, msg) => void logged.push(msg),
    });
  const w = () => store.get("p1").routines[0];
  return {
    ...r,
    elsewhere,
    get store() {
      return store;
    },
    reopen: () => void (store = createSpaceStore({ dir: space })),
    filed: () => createSpaceStore({ dir: space }).get("p1").routines[0],
    woke,
    heardBy,
    logged,
    chats,
    own,
    make,
    w,
  };
};

describe("a watcher hears its branch's new commits", () => {
  test("its first look is where it listens from; each move after it one event; a restart catches up from its head", async () => {
    const r = rig("hear");
    let cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      assert.equal(r.woke.length, 0, "the first look wakes nothing");
      const second = r.commit("Fix login");
      await until(() => r.woke.length === 1, "the commit heard");
      assert.equal(r.woke[0][0].summary, `1 new commit on main: ${second.slice(0, 7)} Fix login`);
      assert.equal(r.w().seen?.head, second);
      cw.stop();
      // Filament off: two commits; started again — its store read anew from its folder —, it hears them from where it was.
      const third = r.commit("Third");
      const fourth = r.commit("Fourth");
      r.reopen();
      assert.equal(r.w().seen?.head, second, "its head read back from its file");
      cw = r.make();
      cw.sync();
      await until(() => r.woke.length === 2, "the commits made while it was off");
      assert.equal(r.woke[1][0].summary, `2 new commits on main: ${fourth.slice(0, 7)} Fourth; ${third.slice(0, 7)} Third`);
      // Moved back: heard as that.
      r.git("reset", "-q", "--hard", third);
      await until(() => r.woke.length === 3, "the move back");
      assert.equal(r.woke[2][0].summary, `main moved back 1 commit, to ${third.slice(0, 7)}`);
    } finally {
      cw.stop();
    }
  });

  test("never its own: a commit made while a run, or the chat it wakes, was at work is no news; another's after is", async () => {
    const r = rig("own", { wakes: "chat" });
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      r.own.turnBegan("run1");
      const ran = r.commit("A run's commit");
      await until(() => r.w().seen?.head === ran, "the run's commit looked at");
      r.own.turnEnded("run1");
      r.own.turnBegan("c1");
      const chat = r.commit("The woken chat's commit");
      await until(() => r.w().seen?.head === chat, "the chat's commit looked at");
      r.own.turnEnded("c1");
      assert.equal(r.woke.length, 0, "its own commits wake nothing");
      // Seconds apart from those turns: whole seconds on a commit's time.
      await new Promise((ok) => setTimeout(ok, 2200));
      const theirs = r.commit("The person's commit");
      await until(() => r.woke.length === 1, "another's commit heard");
      assert.equal(r.woke[0][0].summary, `1 new commit on main: ${theirs.slice(0, 7)} The person's commit`);
      // A chat of the project that is none of its own, at work: its commit is news.
      r.own.turnBegan("c2");
      const other = r.commit("Another chat's commit");
      await until(() => r.woke.length === 2, "another chat's commit heard");
      assert.match(r.woke[1][0].summary, /Another chat's commit/);
      assert.equal(r.w().seen?.head, other);
      r.own.turnEnded("c2");
      // A run at work in another repository: a commit here is news.
      r.own.turnBegan("run2");
      r.commit("While a run works elsewhere");
      await until(() => r.woke.length === 3, "a commit while a run works in another repository");
      r.own.turnEnded("run2");
      // A commit a run's turn made long before, brought in only now — after the branch's tip before it was seen —, is
      // news: a pull, a merge of old work.
      const t = Date.now();
      r.own.turnBegan("run1", t - 3_600_000);
      r.own.turnEnded("run1", t - 3_000_000);
      r.commit("Made an hour ago, pulled now", r.dir, t - 3_300_000);
      await until(() => r.woke.length === 4, "an old commit brought in");
      assert.match(r.woke[3][0].summary, /Made an hour ago, pulled now/);
    } finally {
      cw.stop();
    }
  });

  test("a branch made, deleted and made again; the same move made again is heard again", async () => {
    const r = rig("made", { branch: "release" });
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === NO_BRANCH, "its first look: no release yet");
      r.git("checkout", "-q", "--detach");
      const cut1 = r.commit("Cut one");
      const cut2 = r.commit("Cut two");
      r.git("branch", "release", cut2);
      await until(() => r.woke.length === 1, "release made");
      assert.equal(r.woke[0][0].summary, `release was made, with 2 new commits: ${cut2.slice(0, 7)} Cut two; ${cut1.slice(0, 7)} Cut one`);
      r.git("branch", "-q", "-D", "release");
      await until(() => r.woke.length === 2, "release deleted");
      assert.equal(r.woke[1][0].summary, `release was deleted; it was at ${cut2.slice(0, 7)}`);
      r.git("branch", "release", r.first);
      await until(() => r.woke.length === 3, "release made again, at a commit main holds");
      assert.equal(r.woke[2][0].summary, `release was made, at ${r.first.slice(0, 7)}`);
      // Forward, back and forward again: the last is heard though the move is the first's again.
      r.git("branch", "-q", "-f", "release", cut2);
      await until(() => r.woke.length === 4, "release forward");
      r.git("branch", "-q", "-f", "release", r.first);
      await until(() => r.woke.length === 5, "release back");
      r.git("branch", "-q", "-f", "release", cut2);
      await until(() => r.woke.length === 6, "release forward again");
      assert.equal(r.woke[5][0].summary, r.woke[3][0].summary);
    } finally {
      cw.stop();
    }
  });

  test("Pause all switched on during a look keeps its head for after; a read that failed is tried again", async () => {
    /** @type {{ pause: boolean, fail: number, store: any }} */
    const hold = { pause: false, fail: 0, store: null };
    const r = rig("race", {
      between: async (/** @type {[string, string, string]} */ ...a) => {
        if (hold.fail > 0) {
          hold.fail -= 1;
          return { ok: false, error: "git was busy" };
        }
        const m = await commitsBetween(...a);
        if (hold.pause) {
          hold.pause = false;
          hold.store.pauseAll(true);
        }
        return m;
      },
    });
    hold.store = r.store;
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      hold.pause = true;
      const second = r.commit("As Pause all came on");
      await until(() => cw.watched().get(`${r.dir}\nmain`) === second && !hold.pause, "the look that met Pause all");
      await cw.settled();
      assert.deepEqual([r.w().seen?.head, r.woke.length], [r.first, 0], "nothing heard, its head kept");
      r.store.pauseAll(false);
      cw.sync();
      await until(() => r.woke.length === 1, "heard once Pause all is off");
      hold.fail = 1;
      r.commit("Read once it fails");
      await until(() => r.woke.length === 2, "heard as the read is tried again");
      assert.match(r.woke[1][0].summary, /Read once it fails/);
    } finally {
      cw.stop();
    }
  });

  test("paused it looks at nothing and, resumed, listens from then; Pause all holds its looks, its head kept", async () => {
    const r = rig("pause");
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      r.store.routinePause("p1", "r1", true);
      cw.sync();
      assert.equal(cw.watched().size, 0, "paused: its branch is let go");
      const second = r.commit("While paused");
      r.store.routinePause("p1", "r1", false);
      assert.equal(r.w().seen?.head, undefined, "resumed: it starts over");
      cw.sync();
      await until(() => r.w().seen?.head === second, "resumed: its new first look");
      assert.equal(r.woke.length, 0, "what came while it was paused is not made up");
      r.store.pauseAll(true);
      const third = r.commit("Under Pause all");
      await until(() => cw.watched().get(`${r.dir}\nmain`) === third, "the watch read the commit");
      await cw.settled();
      assert.deepEqual([r.w().seen?.head, r.woke.length], [second, 0], "Pause all: nothing looked at, its head kept");
      r.store.pauseAll(false);
      cw.sync();
      await until(() => r.woke.length === 1, "Pause all off: heard");
      assert.match(r.woke[0][0].summary, /Under Pause all/);
    } finally {
      cw.stop();
    }
  });
});

describe("a watcher's looks, as moves pile up", () => {
  test("its own commits stay its own when several moves wait behind one look (Pause all held them)", async () => {
    const r = rig("pile", { wakes: "chat" });
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      r.own.turnBegan("c1");
      r.store.pauseAll(true);
      const y = r.commit("The chat's first");
      await until(() => cw.watched().get(`${r.dir}\nmain`) === y, "the first read");
      // Seconds apart: the first is older than the tip the look meets, by more than a commit's whole second.
      await new Promise((ok) => setTimeout(ok, 2200));
      const z = r.commit("The chat's second");
      await until(() => cw.watched().get(`${r.dir}\nmain`) === z, "the second read");
      r.own.turnEnded("c1");
      r.store.pauseAll(false);
      cw.sync();
      await until(() => r.w().seen?.head === z, "both looked at");
      assert.equal(r.woke.length, 0, "the chat it wakes made both: neither is news");
    } finally {
      cw.stop();
    }
  });

  test("a move heard whose head was not kept (Pause all came on as it was heard) is the same move when looked at again", async () => {
    const hold = { pause: true };
    /** @type {any} */
    let store = null;
    const r = rig("again", {
      afterHeard: () => {
        if (!hold.pause) return;
        hold.pause = false;
        store.pauseAll(true);
      },
    });
    store = r.store;
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      r.commit("Heard as Pause all came on");
      await until(() => r.woke.length === 1 && !hold.pause, "heard");
      await cw.settled();
      assert.equal(r.w().seen?.head, r.first, "its head not kept under Pause all");
      r.store.pauseAll(false);
      cw.sync();
      await cw.settled();
      await until(() => r.w().seen?.head !== r.first, "looked at again");
      assert.equal(r.woke.length, 1, "the same move: heard once");
    } finally {
      cw.stop();
    }
  });

  test("two watchers of one branch: a commit that comes while the first is heard is the next look's, for each once", async () => {
    let gitOf = /** @type {any} */ (null);
    /** @type {string | null} */
    let late = null;
    const r = rig("two", {
      second: true,
      afterHeard: async (id) => {
        if (id !== "r1" || late) return;
        late = gitOf.commit("Came while r1 was heard");
        await until(() => gitOf.cw.watched().get(`${gitOf.dir}\nmain`) === late, "the late commit read");
      },
    });
    const cw = r.make();
    gitOf = { commit: r.commit, dir: r.dir, cw };
    try {
      cw.sync();
      await until(() => r.store.get("p1").routines.every((x) => x.seen?.head === r.first), "both first looks kept");
      r.commit("Before");
      await until(() => r.store.get("p1").routines.every((x) => x.seen?.head === late) && !!late, "both at the late commit");
      await cw.settled();
      const of = (/** @type {string} */ id) => r.heardBy.filter(([w]) => w === id).map(([, words]) => words.join(" | "));
      for (const id of r.store.get("p1").routines.map((x) => x.id)) {
        const words = of(id);
        assert.equal(words.length, 2, `${id}: ${JSON.stringify(words)}`);
        assert.match(words[0], /1 new commit on main: \w+ Before$/);
        assert.match(words[1], /1 new commit on main: \w+ Came while r1 was heard$/);
      }
    } finally {
      cw.stop();
    }
  });

  test("a place that becomes a repository after its watch began: its refs are looked at from then, and a run's commits there are its own", async () => {
    const dir = fresh("late");
    const store = createSpaceStore({ dir: fresh("late-space") });
    const f = routineFields({ title: "Commits", text: "Review.", trigger: { kind: "commit", branch: "main", place: dir } }, { create: true });
    assert.ok(f.ok);
    store.routinePropose("p1", f.fields, { chain: "c1", byName: "Lead", model: "m", nameOf: () => "Lead" });
    store.routineOn("p1", "r1");
    /** @type {any[]} */
    const woke = [];
    /** @type {import("../src/adapters/git/watch.js").BranchWatch | null} */
    let branch = null;
    const own = createOwnTimes();
    const cw = createCommitWatch({
      store,
      own,
      heard: (project, id, events) => {
        const n = store.watchHeard(project, id, events);
        if (n) woke.push(...events);
        return n;
      },
      folderOf: () => null,
      chatOf: (chain) => (chain === "run1" ? { run: true, folder: dir } : null),
      // No repository yet: looked for again every `slowMs`.
      watch: (p, b, o) => (branch = watchBranch(p, b, { ...o, pollMs: 100, slowMs: 100 })),
    });
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" }).trim();
    const w = () => store.get("p1").routines[0];
    try {
      cw.sync();
      await until(() => branch?.mode() === "slow" && w().seen?.trouble?.why, "no repository there yet: read slowly, its trouble kept in git's words");
      git("init", "-q", "-b", "main");
      writeFileSync(join(dir, "a.txt"), "a\n");
      git("add", ".");
      git("commit", "-q", "-m", "First");
      await until(() => /^[0-9a-f]{40}$/.test(w().seen?.head || ""), "its first look at the new repository");
      await until(() => branch?.mode() === "poll", "its refs looked at, now that it is a repository");
      assert.equal(w().seen?.trouble, undefined, "its trouble gone as it reads");
      own.turnBegan("run1");
      writeFileSync(join(dir, "b.txt"), "b\n");
      git("add", ".");
      git("commit", "-q", "-m", "A run's");
      const head = git("rev-parse", "HEAD");
      await until(() => w().seen?.head === head, "the run's commit looked at");
      own.turnEnded("run1");
      assert.equal(woke.length, 0, "the run's own: no news");
    } finally {
      cw.stop();
    }
  });
});

describe("a watcher's looks: whose a commit is, its trouble, its end (the review of 11-11)", () => {
  test("a commit made elsewhere while a run was at work, pulled in after its turn, is news; a run's own, read only after its turn, is still its own", async () => {
    // Its tip read every 2.5 s: well after the turn in which each commit below came.
    const r = rig("pulled", { watch: { slow: true, slowMs: 2500 } });
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      r.own.turnBegan("run1");
      const own = r.commit("The run's own");
      r.own.turnEnded("run1");
      await until(() => r.w().seen?.head === own, "the run's commit looked at, after its turn");
      assert.equal(r.woke.length, 0, "made here in its turn: its own, though read after it");
      // A teammate's clone, where they commit while a run works here.
      const clone = join(fresh("pulled-clone"), "clone");
      execFileSync("git", ["clone", "-q", r.dir, clone]);
      r.own.turnBegan("run1");
      const theirs = r.commit("A teammate's, made elsewhere", clone);
      r.own.turnEnded("run1");
      // Seconds after the run's turn — whole seconds on a commit's time —, the person pulls it in.
      await new Promise((ok) => setTimeout(ok, 2200));
      r.git("pull", "-q", "--ff-only", clone, "main");
      await until(() => r.w().seen?.head === theirs, "the pulled commit looked at");
      assert.deepEqual(r.woke.map((evs) => evs.map((/** @type {any} */ e) => e.summary)), [[`1 new commit on main: ${theirs.slice(0, 7)} A teammate's, made elsewhere`]], "made in the run's turn, but elsewhere: news as it comes in");
    } finally {
      cw.stop();
    }
  });

  test("a branch that cannot be read is its watcher's trouble — on its cursor, in its file, on its row — until it reads again", async () => {
    const r = rig("trouble", { watch: { slowMs: 100 } });
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      const away = `${r.dir}-away`;
      made.push(away);
      renameSync(r.dir, away);
      await until(() => r.w().seen?.trouble, "its trouble kept");
      assert.equal(r.w().seen?.trouble?.why, "the folder is gone");
      assert.equal(r.filed().seen?.trouble?.why, "the folder is gone", "kept in its file");
      assert.equal(rowWords(r.w(), { now: Date.now() }).skipped, "its branch could not be read: the folder is gone");
      renameSync(away, r.dir);
      await until(() => !r.w().seen?.trouble, "its trouble gone as it reads again");
      assert.deepEqual([r.woke.length, r.w().seen?.head, rowWords(r.w(), { now: Date.now() }).skipped], [0, r.first, ""]);
      r.commit("After it came back");
      await until(() => r.woke.length === 1, "a commit heard once it is back");
    } finally {
      cw.stop();
    }
  });

  test("a branch named in another case has no baseline and wakes nothing as its refs are packed: its row says its name", { skip: process.platform === "linux" && "a disk that tells case apart has no such branch, rightly" }, async () => {
    const r = rig("miscase", { branch: "MAIN" });
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.trouble || r.w().seen?.head, "its first read");
      assert.deepEqual([r.w().seen?.head, r.w().seen?.trouble?.why], [undefined, "it is named main, not MAIN"], "no baseline: its trouble");
      r.git("pack-refs", "--all");
      const second = r.commit("After its refs were packed");
      // Nothing to wait on where nothing is heard: a stretch its refs are looked at several times in.
      await new Promise((ok) => setTimeout(ok, scaledMs(600)));
      assert.deepEqual([r.woke.length, r.w().seen?.head], [0, undefined], `no “deleted”, no “made” (main is at ${second.slice(0, 7)})`);
      assert.equal(rowWords(r.w(), { now: Date.now() }).skipped, "its branch could not be read: it is named main, not MAIN");
    } finally {
      cw.stop();
    }
  });

  test("a look that throws is tried again, as a read that failed is", async () => {
    const hold = { fail: 0 };
    const r = rig("throws", {
      between: async (/** @type {[string, string, string]} */ ...a) => {
        if (hold.fail-- > 0) throw new Error("spawn EMFILE");
        return commitsBetween(...a);
      },
    });
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      hold.fail = 1;
      const second = r.commit("Read once the look throws");
      await until(() => r.woke.length === 1, "heard as the look is tried again");
      assert.match(r.woke[0][0].summary, /Read once the look throws/);
      assert.ok(r.logged.some((m) => m.includes("spawn EMFILE")), "said in the log");
      await until(() => r.w().seen?.head === second && !r.w().seen?.trouble, "its head kept, its trouble gone");
    } finally {
      cw.stop();
    }
  });

  test("a look in flight as Filament stops hears nothing and keeps nothing", async () => {
    const held = gate();
    let reached = false;
    const r = rig("stop", {
      commonOf: async (/** @type {string} */ folder) => {
        reached = true;
        await held.promise;
        return commonDirOf(folder);
      },
    });
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      r.commit("As Filament stops");
      await until(() => reached, "the look reading whose turns were at work");
      // The look under way, and whatever is queued behind it.
      const flight = cw.look(r.dir, "main");
      cw.stop();
      held.open();
      await flight;
      assert.deepEqual([r.woke.length, r.w().seen?.head], [0, r.first], "stopped: nothing heard, nothing written");
    } finally {
      cw.stop();
      held.open();
    }
  });

  test("a move longer than the commits read is judged whole: those past the newest read are not taken for its own", async () => {
    // One commit read of each move, as 200 are of a long one.
    const r = rig("long", { between: (/** @type {string} */ p, /** @type {string} */ f, /** @type {string} */ t) => commitsBetween(p, f, t, { most: 1 }) });
    const cw = r.make();
    try {
      cw.sync();
      await until(() => r.w().seen?.head === r.first, "its first look kept");
      // Old work of another's brought in, then a run's commit on top: one look at both, as Pause all goes off.
      r.store.pauseAll(true);
      const old = r.commit("Made an hour ago, by another", r.dir, Date.now() - 3_600_000);
      await until(() => cw.watched().get(`${r.dir}\nmain`) === old, "the old commit read");
      r.own.turnBegan("run1");
      const own = r.commit("The run's own");
      await until(() => cw.watched().get(`${r.dir}\nmain`) === own, "the run's commit read");
      r.own.turnEnded("run1");
      r.store.pauseAll(false);
      cw.sync();
      await until(() => r.w().seen?.head === own, "both looked at");
      assert.deepEqual(r.woke.map((evs) => evs.map((/** @type {any} */ e) => e.summary)), [["1 new commit on main: (1 more)"]], "the newest its own, the one before it unread: news");
    } finally {
      cw.stop();
    }
  });
});

describe("whose a commit is: a chat's own only while a command of it that could have made it ran", () => {
  /**
   * A watcher that wakes the chat that proposed it (c1), its commit watch's keeper hearing a bus as the server's does: `turn`, a
   * chat's lock taken or let go, as the server says it; `run`, an event of a run, as its engine publishes it
   * (services/runs.js RUN_EVENT_FIELDS).
   * @param {string} tag
   */
  const heard = (tag) => {
    const r = rig(tag, { wakes: "chat" });
    const cw = r.make();
    const bus = createEventBus();
    const off = r.own.listen(bus);
    return {
      r,
      cw,
      own: r.own,
      /** @param {string} chain */
      turn: (chain, on = true) => void bus.publish("turns", { type: "turn", chainId: chain, holder: on ? { id: `turn-of-${chain}`, window: "harness" } : null }),
      /** @param {string} run @param {Record<string, unknown>} e */
      run: (run, e) => void bus.publish(`run:${run}`, e),
      stop: () => {
        off();
        cw.stop();
        r.own.stop();
      },
    };
  };
  /** A chat's own turn's run begun, as the run log says it. @param {string} chain */
  const began = (chain) => ({ type: "run-start", kind: "agent-turn", title: null, parentId: null, meta: { chain } });
  /**
   * A shell call's start: `command`, as its engine says of one that could have made a commit — unsaid of one it read as
   * only reading. @param {string} id
   */
  const starts = (id, command = false) => ({ type: "tool-start", round: 1, name: "bash", args: "", card: { kind: "shell", title: "Run", subject: "" }, id, ...(command ? { command: true } : {}) });
  /** Its end. @param {string} id @param {Record<string, unknown>} [more] */
  const ends = (id, more = {}) => ({ type: "tool-end", round: 1, name: "bash", ok: true, ms: 1, id, ...more });
  /** Seconds apart: a commit's time is in whole seconds, and a command's time has a second's slack. */
  const apart = () => new Promise((ok) => setTimeout(ok, 2200));

  // (fails before: yes — "timed out … waiting for the person's commit heard": the turn at work took it for the chat's)
  test("the person commits while the chat it wakes is at work and runs no command: heard", async () => {
    const h = heard("idle");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.turn("c1");
      h.run("t1", began("c1"));
      const theirs = h.r.commit("The person's, as the chat reads");
      await until(() => h.r.woke.length === 1, "the person's commit heard while the chat's turn is at work");
      assert.equal(h.r.woke[0][0].summary, `1 new commit on main: ${theirs.slice(0, 7)} The person's, as the chat reads`);
      // A routine's run at work there, none of its commands running: the same.
      h.turn("run1");
      h.run("t2", began("run1"));
      const again = h.r.commit("The person's, as a run reads");
      await until(() => h.r.woke.length === 2, "the person's commit heard while a run's turn is at work");
      assert.equal(h.r.woke[1][0].summary, `1 new commit on main: ${again.slice(0, 7)} The person's, as a run reads`);
    } finally {
      h.stop();
    }
  });

  // (fails before: yes — the same: the turn took it for the chat's)
  test("the person commits while that chat runs a command its engine read as only reading (git log, git diff): heard", async () => {
    const h = heard("reads");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.turn("c1");
      h.run("t1", began("c1"));
      h.run("t1", starts("u1"));
      const theirs = h.r.commit("The person's, as the chat runs git log");
      await until(() => h.r.woke.length === 1, "the person's commit heard while the chat's reading command runs");
      h.run("t1", ends("u1"));
      assert.equal(h.r.woke[0][0].summary, `1 new commit on main: ${theirs.slice(0, 7)} The person's, as the chat runs git log`);
    } finally {
      h.stop();
    }
  });

  // (fails before: its second half — the person's commit seconds after the chat's command, its turn still at work, was
  // taken for the chat's; the first is a guard: the turn took the chat's own for its own too)
  test("the chat's own commit, made while a command of it that could commit ran, is no news; the person's, seconds after that command, is", async () => {
    const h = heard("own");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.turn("c1");
      h.run("t1", began("c1"));
      h.run("t1", starts("u1", true));
      const own = h.r.commit("The chat's own");
      h.run("t1", ends("u1"));
      await until(() => h.r.w().seen?.head === own, "the chat's commit looked at");
      assert.equal(h.r.woke.length, 0, "made while its command ran: its own");
      await apart();
      const theirs = h.r.commit("The person's, after it");
      await until(() => h.r.woke.length === 1, "the person's commit heard, the chat's turn still at work");
      assert.equal(h.r.woke[0][0].summary, `1 new commit on main: ${theirs.slice(0, 7)} The person's, after it`);
    } finally {
      h.stop();
    }
  });

  // (fails before: yes — each chat's turn, at work, took the other's commit for its own: neither watcher heard one)
  test("two chats at work in one repository: the commit one makes by a command is news to the watcher that wakes the other, and none to its own", async () => {
    const h = heard("pair");
    try {
      const f = routineFields({ title: "Commits, for the other", text: "Review what landed.", trigger: { kind: "commit", branch: "main", place: h.r.dir }, wakes: "chat" }, { create: true });
      assert.ok(f.ok, JSON.stringify(f));
      const two = h.r.store.routinePropose("p1", f.fields, { chain: "c2", byName: "Other", model: "m", nameOf: () => "Other" });
      h.r.store.routineOn("p1", two.id);
      const all = () => h.r.store.get("p1").routines;
      h.cw.sync();
      await until(() => all().every((x) => x.seen?.head === h.r.first), "both first looks kept");
      h.turn("c1");
      h.run("t1", began("c1"));
      h.turn("c2");
      h.run("t2", began("c2"));
      h.run("t1", starts("u1", true));
      const first = h.r.commit("The first chat's");
      h.run("t1", ends("u1"));
      await until(() => all().every((x) => x.seen?.head === first), "both looked at the first chat's");
      await apart();
      h.run("t2", starts("u2", true));
      const second = h.r.commit("The second chat's");
      h.run("t2", ends("u2"));
      await until(() => all().every((x) => x.seen?.head === second), "both looked at the second chat's");
      const of = (/** @type {string} */ id) => h.r.heardBy.filter(([w]) => w === id).map(([, words]) => words.join(" | "));
      assert.deepEqual(of("r1"), [`1 new commit on main: ${second.slice(0, 7)} The second chat's`], "the watcher that wakes the first chat hears the second's alone");
      assert.deepEqual(of(two.id), [`1 new commit on main: ${first.slice(0, 7)} The first chat's`], "and the one that wakes the second, the first's alone");
    } finally {
      h.stop();
    }
  });

  // (fails before: yes — "1 !== 0": made after its chat's turn, the background command's commit was news to its watcher)
  test("a background command of the chat commits after its turn ended: no news; once it ended, the person's commit is", async () => {
    const h = heard("background");
    // As the server wires it: a chat's running background commands, said at each one's start, end and stop.
    const stopHearing = onShellsChange((chain) => h.own.shells(chain, runningShellsOf(chain)));
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.turn("c1");
      h.run("t1", began("c1"));
      // Started in the chat's turn, as bash_background or a coding agent's background_command starts one.
      startCommandShell('sleep 3 && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "From the background"', h.r.dir, { session: "c1", agent: null }, { onEnd: () => {} });
      h.run("t1", { type: "run-end", status: "done", summary: null });
      h.turn("c1", false);
      const sha = await until(() => (h.r.git("log", "-1", "--format=%s") === "From the background" ? h.r.git("rev-parse", "HEAD") : null), "the background command's commit", { timeoutMs: 30_000 });
      await until(() => h.r.w().seen?.head === sha, "its commit looked at");
      assert.equal(h.r.woke.length, 0, "made by its background command, its turn seconds over: its own");
      await until(() => runningShellsOf("c1").length === 0, "the command's end");
      await apart();
      const theirs = h.r.commit("The person's, once it ended");
      await until(() => h.r.woke.length === 1, "the person's commit heard once the command ended");
      assert.equal(h.r.woke[0][0].summary, `1 new commit on main: ${theirs.slice(0, 7)} The person's, once it ended`);
    } finally {
      stopHearing();
      h.stop();
    }
  });

  // (fails before: no — a guard: brought in during the chat's turn, it was news then too)
  test("a commit made long before and merged in while the chat's committing command runs is news", async () => {
    const h = heard("merged");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.r.git("checkout", "-q", "-b", "side");
      const old = h.r.commit("Made an hour ago, on the side", h.r.dir, Date.now() - 3_600_000);
      h.r.git("checkout", "-q", "main");
      h.turn("c1");
      h.run("t1", began("c1"));
      h.run("t1", starts("u1", true));
      h.r.git("merge", "-q", "--ff-only", "side");
      h.run("t1", ends("u1"));
      await until(() => h.r.woke.length === 1, "the old commit heard as it comes in");
      assert.equal(h.r.woke[0][0].summary, `1 new commit on main: ${old.slice(0, 7)} Made an hour ago, on the side`);
    } finally {
      h.stop();
    }
  });

  // (fails before: for want of `runEvent` alone — the turn's version of it, in "never its own" above, held)
  test("a commit made in a command of the chat's an hour ago, merged in during another now, is news: its own only since the branch came to the tip it moved from", async () => {
    const h = heard("since");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      const t = Date.now();
      // A run of the chat's an hour ago, a command of it then — as its events said them.
      h.own.runEvent("t0", began("c1"), t - 3_700_000);
      h.own.runEvent("t0", starts("u0", true), t - 3_600_000);
      h.own.runEvent("t0", ends("u0"), t - 3_000_000);
      h.own.runEvent("t0", { type: "run-end", status: "done", summary: null }, t - 2_900_000);
      h.r.git("checkout", "-q", "-b", "side");
      const old = h.r.commit("Made in its command an hour ago", h.r.dir, t - 3_300_000);
      h.r.git("checkout", "-q", "main");
      h.turn("c1");
      h.run("t1", began("c1"));
      h.run("t1", starts("u1", true));
      h.r.git("merge", "-q", "--ff-only", "side");
      h.run("t1", ends("u1"));
      await until(() => h.r.woke.length === 1, "the old commit heard as it comes in");
      assert.equal(h.r.woke[0][0].summary, `1 new commit on main: ${old.slice(0, 7)} Made in its command an hour ago`);
    } finally {
      h.stop();
    }
  });

  // (fails before: its second half — a turn whose run was heard took the person's commit for the chat's; the first
  // pins what is kept: a turn no run of the chat's is heard in is its own time whole)
  test("a turn in which no run of the chat's is heard keeps the turn rule; one whose run is heard is judged by its commands, however often its lock is said again", async () => {
    const h = heard("fallback");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.turn("c1");
      const during = h.r.commit("Made in a turn with no run");
      await until(() => h.r.w().seen?.head === during, "the commit looked at");
      h.turn("c1", false);
      assert.equal(h.r.woke.length, 0, "no run heard: the whole turn is the chat's own time");
      await apart();
      h.turn("c1");
      h.run("t1", began("c1"));
      // Its phase changed: the lock's holder is said again, and no new turn begins.
      h.turn("c1");
      const theirs = h.r.commit("The person's, in a turn with a run");
      await until(() => h.r.woke.length === 1, "the person's commit heard, the turn's run heard");
      assert.equal(h.r.woke[0][0].summary, `1 new commit on main: ${theirs.slice(0, 7)} The person's, in a turn with a run`);
    } finally {
      h.stop();
    }
  });

  // (fails before: yes — the turn took each of the person's commits for the chat's)
  test("a call that never ran, one that waits for the person's yes, and one its run's end cut give the chat no time past what ran", async () => {
    const h = heard("never");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.turn("c1");
      h.run("t1", began("c1"));
      // Refused: its start and its end come together, and nothing ran.
      h.run("t1", starts("u1", true));
      h.run("t1", ends("u1", { ok: false, refused: true }));
      h.r.commit("The person's, after a refused call");
      await until(() => h.r.woke.length === 1, "heard: the refused call ran nothing");
      // Asked: a coding agent's call is said as its permission's question opens, and runs once that is answered.
      h.run("t1", starts("u2", true));
      h.run("t1", { type: "ask", round: 1, kind: "permission", tool: "bash", question: "May I?", waits: true, id: "q1", call: "u2" });
      h.r.commit("The person's, as the chat waits for their yes");
      await until(() => h.r.woke.length === 2, "heard: the call waits, and runs nothing yet");
      h.run("t1", { type: "ask-end", round: 1, id: "q1", call: "u2", outcome: "answered", words: [] });
      const own = h.r.commit("The chat's own, once allowed");
      h.run("t1", ends("u2"));
      await until(() => h.r.w().seen?.head === own, "the chat's commit looked at");
      assert.equal(h.r.woke.length, 2, "made by the call once it ran: its own");
      // Cut: a Force stop ends the run with the call open, and its time ends there.
      h.run("t1", starts("u3", true));
      h.run("t1", { type: "run-end", status: "stopped", summary: null });
      h.turn("c1", false);
      await apart();
      h.r.commit("The person's, after a force stop");
      await until(() => h.r.woke.length === 3, "heard: the run's end ended its open call");
    } finally {
      h.stop();
    }
  });

  // (fails before: yes — "1 !== 0": its sub-agent's commit, made after the chat's turn, was news to its watcher)
  test("a sub-agent's commands are its chat's: the commit one makes is no news, its chat's turn over or not; a coding agent's own sub-agent's the same", async () => {
    const h = heard("sub");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.turn("c1");
      h.run("t1", began("c1"));
      // A sub-agent Filament runs has a run of its own, of its chat's (`meta.chain`), which outlives the turn in the background.
      h.run("s1", { type: "run-start", kind: "subagent", title: null, parentId: "t1", meta: { chain: "c1", subagent: "sa_1" } });
      h.run("t1", { type: "run-end", status: "done", summary: null });
      h.turn("c1", false);
      await apart();
      h.run("s1", starts("u1", true));
      const sub = h.r.commit("Its sub-agent's, after its turn");
      h.run("s1", ends("u1"));
      await until(() => h.r.w().seen?.head === sub, "the sub-agent's commit looked at");
      assert.equal(h.r.woke.length, 0, "made by its sub-agent's command: its own");
      h.run("s1", { type: "run-end", status: "done", summary: null });
      // A coding agent's own sub-agent has no run: its calls are said on its agent's.
      await apart();
      h.turn("c1");
      h.run("t2", { ...began("c1"), kind: "coding-agent" });
      h.run("t2", { type: "subagent-tool-start", round: 1, parent: "task1", id: "k1", name: "Bash", args: "", card: { kind: "shell", title: "Run", subject: "" }, command: true });
      const kid = h.r.commit("Its agent's own sub-agent's");
      h.run("t2", { type: "subagent-tool-end", round: 1, parent: "task1", id: "k1", name: "Bash", ok: true, ms: 1 });
      await until(() => h.r.w().seen?.head === kid, "its commit looked at");
      assert.equal(h.r.woke.length, 0, "made by its agent's sub-agent's command: its own");
      // …and the person's, as that sub-agent only reads: heard.
      await apart();
      h.run("t2", { type: "subagent-tool-start", round: 1, parent: "task1", id: "k2", name: "Read", args: "", card: { kind: "read", title: "Read", subject: "a.txt" } });
      h.r.commit("The person's, as its sub-agent reads");
      await until(() => h.r.woke.length === 1, "the person's commit heard");
    } finally {
      h.stop();
    }
  });

  // (fails before: its second half — "1 !== 0": made in a helper's run after the chat's turn, the commit was news; the
  // first pins what is kept: with the run's `hooks` unread, the turn's run heard gives the commit away as news)
  test("a chat whose session hooks run commands no run says: its turn keeps the turn rule, and a helper's run with such hooks is its time whole", async () => {
    const h = heard("hooks");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.turn("c1");
      h.run("t1", { ...began("c1"), meta: { chain: "c1", hooks: true } });
      const hooked = h.r.commit("Made by a hook of its turn");
      await until(() => h.r.w().seen?.head === hooked, "the hook's commit looked at");
      assert.equal(h.r.woke.length, 0, "its hooks' commands are unsaid: the whole turn is the chat's own time");
      h.run("t1", { type: "run-end", status: "done", summary: null });
      h.turn("c1", false);
      await apart();
      // A sub-agent's run under the same hooks, its chat's turn over: no call of it is said either.
      h.run("s1", { type: "run-start", kind: "subagent", title: null, parentId: "t1", meta: { chain: "c1", subagent: "sa_1", hooks: true } });
      const sub = h.r.commit("Made by a hook of its sub-agent's");
      await until(() => h.r.w().seen?.head === sub, "its commit looked at");
      assert.equal(h.r.woke.length, 0, "a helper's run with hooks: the chat's own time whole");
      h.run("s1", { type: "run-end", status: "done", summary: null });
      await apart();
      const theirs = h.r.commit("The person's, once that run ended");
      await until(() => h.r.woke.length === 1, "the person's commit heard once the helper's run ended");
      assert.equal(h.r.woke[0][0].summary, `1 new commit on main: ${theirs.slice(0, 7)} The person's, once that run ended`);
    } finally {
      h.stop();
    }
  });

  // (fails before: for want of `runEvent` — a pin of the slack past a command's end where a tip has no reflog: with one
  // second of it, as a commit's own time has, "1 !== 0" at the first half)
  test("a tip with no reflog came when it was read: read within two seconds of the command that made it, the commit is its own; read later, news", async () => {
    const r = rig("unlogged", { wakes: "chat" });
    let clock = Date.now();
    /** The tip, as the test says it was read. @type {(head: string | null) => void} */
    let read = () => {};
    /** @type {any[][]} */
    const woke = [];
    const cw = createCommitWatch({
      store: r.store,
      own: r.own,
      heard: (project, id, events) => {
        const n = r.store.watchHeard(project, id, events);
        if (n) woke.push([...events]);
        return n;
      },
      folderOf: () => null,
      chatOf: (chain) => r.chats[chain] ?? null,
      watch: (_place, _branch, o) => {
        read = o.onHead;
        return /** @type {any} */ ({ stop: () => {} });
      },
      // No reflog says when the branch came to a tip.
      cameAt: async () => null,
      now: () => clock,
    });
    try {
      cw.sync();
      read(r.first);
      await cw.settled();
      assert.equal(r.w().seen?.head, r.first, "its first look kept");
      const from = Date.now();
      r.own.runEvent("t1", began("c1"), from);
      r.own.runEvent("t1", starts("u1", true), from);
      const own = r.commit("The chat's own, read late");
      const to = Date.now();
      r.own.runEvent("t1", ends("u1"), to);
      clock = to + 1900;
      read(own);
      await cw.settled();
      assert.equal(r.w().seen?.head, own, "the chat's commit looked at");
      assert.equal(woke.length, 0, "read 1.9 s after its command's end: its own");
      // The clock the tip was read by is ahead: the next command begins past it.
      await apart();
      const next = Date.now();
      r.own.runEvent("t1", starts("u2", true), next);
      const late = r.commit("The chat's own, read too late");
      const end = Date.now();
      r.own.runEvent("t1", ends("u2"), end);
      clock = end + 2100;
      read(late);
      await cw.settled();
      assert.equal(woke.length, 1, "read 2.1 s after its command's end: news");
      assert.equal(woke[0][0].summary, `1 new commit on main: ${late.slice(0, 7)} The chat's own, read too late`);
    } finally {
      cw.stop();
    }
  });

  /**
   * A watcher that wakes c1, its commit watch on a clock the test sets and a branch it reads only as the test says:
   * when a tip came is when it was read (no reflog is read), and a commit's time is the one it is made at. `base`: the
   * clock as the watch began, in whole seconds, after the watcher was switched on — a hearing dated before that is not
   * made up —, so the times the test sets run on from now.
   * @param {string} tag
   */
  const clocked = async (tag) => {
    const r = rig(tag, { wakes: "chat" });
    const t = { now: Math.ceil(Date.now() / 1000) * 1000 + 1000 };
    const base = t.now;
    /** @type {(head: string | null) => void} */
    let read = () => {};
    /** Each hearing's words. @type {string[][]} */
    const woke = [];
    const own = createOwnTimes({ holdMs: 50 });
    const cw = createCommitWatch({
      store: r.store,
      own,
      heard: (project, id, events) => {
        const n = r.store.watchHeard(project, id, events);
        if (n) woke.push(events.map((/** @type {any} */ e) => String(e.summary)));
        return n;
      },
      folderOf: () => null,
      chatOf: (chain) => r.chats[chain] ?? null,
      watch: (_place, _branch, o) => {
        read = o.onHead;
        return /** @type {any} */ ({ stop: () => {} });
      },
      cameAt: async () => null,
      now: () => t.now,
    });
    cw.sync();
    read(r.first);
    await cw.settled();
    assert.equal(r.w().seen?.head, r.first, "its first look kept");
    return {
      cw,
      own,
      woke,
      base,
      /** A commit made at `at`. @param {string} subject @param {number} at */
      commit: (subject, at) => r.commit(subject, r.dir, at),
      /** The branch's tip read at `at`, and looked at. @param {string} sha @param {number} at */
      look: async (sha, at) => {
        t.now = at;
        read(sha);
        await cw.settled();
        assert.equal(r.w().seen?.head, sha, "its tip looked at");
      },
    };
  };

  // (fails before: yes — "timed out … the person's commit heard": the background command's whole run was the chat's)
  test("a background command of the chat's up past its first two minutes (a dev server): the person's commit is heard", async () => {
    const h = heard("devserver");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      // As the hands list it: started ten minutes ago, and running.
      h.own.shells("c1", [{ id: "dev", startedAt: Date.now() - 10 * 60_000 }]);
      const theirs = h.r.commit("The person's, the dev server ten minutes up");
      await until(() => h.r.woke.length === 1, "the person's commit heard, the dev server running");
      assert.equal(h.r.woke[0][0].summary, `1 new commit on main: ${theirs.slice(0, 7)} The person's, the dev server ten minutes up`);
    } finally {
      h.stop();
    }
  });

  // (fails before: no — a guard: the command's whole run was its own time, its first two minutes with it)
  test("a commit made in a background command's first two minutes, looked at as it still runs: its own", async () => {
    const h = heard("devstart");
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      h.own.shells("c1", [{ id: "dev", startedAt: Date.now() - 30_000 }]);
      const sha = h.r.commit("Made in its first two minutes");
      await until(() => h.r.w().seen?.head === sha, "its commit looked at");
      assert.equal(h.r.woke.length, 0, "made in its first two minutes: its own");
    } finally {
      h.stop();
    }
  });

  // (fails before: its first half — "0 !== 1" in words: the person's commit, made as the command had run an hour, was
  // taken for the chat's)
  test("a long background command that commits as it ends: the person's commit an hour before its end, judged then, is heard; its own, looked at after it ended, is not", async () => {
    const c = await clocked("longrun");
    try {
      const { base } = c;
      c.own.shells("c1", [{ id: "long", startedAt: base }], base);
      const theirs = c.commit("The person's, an hour into it", base + 3_600_000);
      await c.look(theirs, base + 3_600_500);
      assert.deepEqual(c.woke, [[`1 new commit on main: ${theirs.slice(0, 7)} The person's, an hour into it`]], "judged as the command runs past its first two minutes: news");
      const own = c.commit("Its own, as its last step", base + 7_199_000);
      c.own.shells("c1", [], base + 7_200_000);
      await c.look(own, base + 7_200_500);
      assert.equal(c.woke.length, 1, "made in its last two minutes and looked at after it ended: its own");
    } finally {
      c.cw.stop();
    }
  });

  // (fails before: no — a guard: the command's whole run was its own time)
  test("a background command of four minutes or less is its chat's whole: what it commits past its first two, looked at after it ended, is its own", async () => {
    const c = await clocked("short");
    try {
      const { base } = c;
      c.own.shells("c1", [{ id: "script", startedAt: base }], base);
      c.commit("Its own, a minute in", base + 60_000);
      const last = c.commit("Its own, two and a half minutes in", base + 150_000);
      c.own.shells("c1", [], base + 230_000);
      await c.look(last, base + 230_500);
      assert.deepEqual(c.woke, [], "both its own");
    } finally {
      c.cw.stop();
    }
  });

  // (fails before: no — the command's whole run was its own time. With its first and last two minutes alone and no
  // wait for its end: "1 !== 0" — the look came while the hands still listed it)
  test("a background command up ten minutes commits as its last step but one: a look before the hands say it ended waits for its end, and the commit is its own", async () => {
    const h = heard("laststep");
    // As the server wires the hands' list, each command started ten minutes before it did.
    const stopHearing = onShellsChange((chain) => h.own.shells(chain, runningShellsOf(chain).map((s) => ({ ...s, startedAt: s.startedAt - 10 * 60_000 }))));
    try {
      h.cw.sync();
      await until(() => h.r.w().seen?.head === h.r.first, "its first look kept");
      // The step after its commit outlasts a poll of the watch: the look comes before its end is said.
      startCommandShell('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "Its last step but one" && sleep 0.5', h.r.dir, { session: "c1", agent: null }, { onEnd: () => {} });
      const sha = await until(() => (h.r.git("log", "-1", "--format=%s") === "Its last step but one" ? h.r.git("rev-parse", "HEAD") : null), "its commit", { timeoutMs: 30_000 });
      await until(() => h.r.w().seen?.head === sha, "its commit looked at");
      await until(() => runningShellsOf("c1").length === 0, "its end");
      assert.equal(h.r.woke.length, 0, "made in its last two minutes: its own");
    } finally {
      stopHearing();
      h.stop();
    }
  });
});
