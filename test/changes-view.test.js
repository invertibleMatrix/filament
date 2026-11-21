// @ts-check
// The Changes tab's read, by place (the Designer's of 10-29, on the owner's words: "what agents are writing where into
// which worktree and what branches and what uncommitted files are there sitting"): each place's uncommitted files, who
// wrote each since its last commit, the chat's sub-agents' copies and the repository's other worktrees where someone
// writes — one read of each place serving every ask for a few seconds.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { attribute, commitTimes, filesOf, namedFiles, writersOf } from "../src/core/changes-view.js";
import { lastCommits, placeChanges } from "../src/adapters/git/inspect.js";
import { Archive } from "../src/services/memory/archive.js";
import { MemoryService } from "../src/services/memory/index.js";
import { gitRoutes } from "../src/http/admin/git.js";
import { createRouter } from "../src/http/router.js";

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
/** @param {string} prefix */
const fresh = (prefix) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
/** A repository on main with a.txt and b.txt committed. @param {string} dir */
const repoIn = (dir) => {
  mkdirSync(dir, { recursive: true });
  run(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  writeFileSync(join(dir, "b.txt"), "b\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "init"]);
  return dir;
};
const top = (/** @type {string} */ dir) => run(dir, ["rev-parse", "--show-toplevel"]);

describe("whose each file is, pure", () => {
  const files = filesOf(
    [
      { path: "a.txt", oldPath: null, index: " ", worktree: "M", kind: "unstaged" },
      { path: "src/new.js", oldPath: null, index: " ", worktree: "?", kind: "untracked" },
      { path: "c.txt", oldPath: "b.txt", index: "R", worktree: " ", kind: "staged" },
      { path: "gone.txt", oldPath: null, index: " ", worktree: "D", kind: "unstaged" },
      { path: "x.log", oldPath: null, index: " ", worktree: "!", kind: "ignored" },
    ],
    new Map([["a.txt", { added: 3, removed: 1, binary: false }], ["c.txt", { added: 0, removed: 0, binary: false }], ["gone.txt", { added: 0, removed: 4, binary: false }]]),
  );

  // (fails before: yes — nothing read a place's files with whose they were)
  test("each uncommitted file: its letter and counts, an untracked one new, what git ignores left out", () => {
    assert.deepEqual(files.map((f) => [f.path, f.status, f.added, f.removed, f.untracked]), [
      ["a.txt", "M", 3, 1, false],
      ["src/new.js", "A", null, null, true],
      ["c.txt", "R", 0, 0, false],
      ["gone.txt", "D", 0, 4, false],
    ]);
  });

  test("a file is its writers' whose own calls named it — or its old name — after its last commit, each once, the newest first", () => {
    const rounds = [
      { chain: "c2", agent: "", own: ["A.TXT"], at: 5000 },
      { chain: "c1", agent: "sa_1", own: ["src/new.js", "a.txt"], at: 4000 },
      { chain: "c1", agent: "", own: ["a.txt", "b.txt"], at: 3000 },
      { chain: "c1", agent: "", own: ["a.txt"], at: 2500 },
      { chain: "c3", agent: "", own: ["gone.txt"], at: 1000 },
    ];
    const lastAt = new Map([["gone.txt", 1500]]);
    const got = attribute(files, rounds, lastAt);
    const by = (/** @type {string} */ p) => got.find((f) => f.path === p)?.by.map((w) => `${w.chain}/${w.agent || "main"}@${w.at}`);
    assert.deepEqual(by("a.txt"), ["c2/main@5000", "c1/sa_1@4000", "c1/main@3000"], "case folded, each agent once, its newest");
    assert.deepEqual(by("src/new.js"), ["c1/sa_1@4000"]);
    assert.deepEqual(by("c.txt"), ["c1/main@3000"], "by its old name");
    assert.deepEqual(by("gone.txt"), [], "written before its last commit: what sits is not that write");
    assert.deepEqual(namedFiles(files, rounds), ["a.txt", "src/new.js", "c.txt", "gone.txt"]);
    assert.deepEqual(writersOf(got).map((w) => [w.chain, w.agent, w.files, w.added, w.removed]), [["c2", "", 1, 3, 1], ["c1", "sa_1", 2, 3, 1], ["c1", "", 2, 3, 1]]);
  });

  test("a log's commit times: each path's newest", () => {
    assert.deepEqual([...commitTimes("@@20\na.txt\nb.txt\n\n@@10\na.txt\nc.txt\n")], [["a.txt", 20000], ["b.txt", 20000], ["c.txt", 10000]]);
  });
});

describe("the archive's rounds in a place", () => {
  test("every chain's rounds in one place since a moment, the newest first", () => {
    const dir = fresh("filament-cv-archive-");
    let clock = 1_758_000_000_000;
    /** @type {any} */
    const a = new (/** @type {any} */ (Archive))({ file: join(dir, "a.db"), now: () => (clock += 1000) });
    try {
      let seq = 0;
      const turn = (/** @type {string} */ chainId) => a.beginTurn(chainId, { requestId: `r${++seq}`, model: "m", upstream: "u", userMessage: { role: "user", content: [{ type: "text", text: "go" }] } }).turnId;
      const c1 = a.chainForKey("k1", { cwd: "C:\\p", client: "c", model: "m" }).id;
      const c2 = a.chainForKey("k2", { cwd: "C:\\p", client: "c", model: "m" }).id;
      const t1 = turn(c1);
      a.addRoundChange(t1, { place: "C:/p", round: 1, agent: "", before: null, after: "a".repeat(40), base: "head", own: ["old.txt"], command: false });
      const mid = clock + 1;
      a.addRoundChange(t1, { place: "C:/p", round: 2, agent: "sa_1", before: null, after: "b".repeat(40), base: "head", own: ["x.txt"], command: true });
      a.addRoundChange(turn(c2), { place: "C:/p", round: 1, agent: "", before: null, after: "c".repeat(40), base: "head", own: ["y.txt"], command: false });
      a.addRoundChange(t1, { place: "C:/q", round: 3, agent: "", before: null, after: "d".repeat(40), base: "head", own: ["z.txt"], command: false });
      assert.deepEqual(a.roundChangesIn("C:/p", mid).map((/** @type {any} */ r) => [r.chain === c1 ? "c1" : "c2", r.agent, r.own, r.command]), [["c2", "", ["y.txt"], false], ["c1", "sa_1", ["x.txt"], true]]);
    } finally {
      a.close();
    }
  });

  // (fails before: yes — found driving the Apply, 10-29: an Apply kept its files as a round of the chat's newest turn,
  // so in a chat with no turn yet — a sub-agent launched before any message — they were no one's in Changes)
  test("an Apply in a chat with no turn yet is kept as its sub-agent's in the place; no turn's rounds count it", () => {
    const dir = fresh("filament-cv-noturn-");
    let clock = 1_758_000_000_000;
    /** @type {any} */
    const a = new (/** @type {any} */ (Archive))({ file: join(dir, "a.db"), now: () => (clock += 1000) });
    try {
      const c1 = a.chainForKey("k1", { cwd: "C:\\p", client: "c", model: "m" }).id;
      const c2 = a.chainForKey("k2", { cwd: "C:\\p", client: "c", model: "m" }).id;
      /** The memory service's own, over this archive. */
      const memory = /** @type {any} */ ({ archive: a, log: () => {}, recordRoundChange: MemoryService.prototype.recordRoundChange });
      const applied = (/** @type {string} */ chain, /** @type {string} */ agent, /** @type {string[]} */ own) => MemoryService.prototype.recordApplied.call(memory, chain, { place: "C:/p", agent, own });
      assert.ok(applied(c1, "sa_1", ["made.txt"]), "kept, with no turn");
      assert.ok(applied(c2, "sa_2", ["other.txt"]), "a second chat's, beside it");
      a.beginTurn(c1, { requestId: "r1", model: "m", upstream: "u", userMessage: { role: "user", content: [{ type: "text", text: "go" }] } });
      assert.ok(applied(c1, "sa_3", ["later.txt"]), "and with one, as before");
      assert.deepEqual(a.roundChangesIn("C:/p", 0).map((/** @type {any} */ r) => [r.chain === c1 ? "c1" : "c2", r.agent, r.own]), [["c1", "sa_3", ["later.txt"]], ["c2", "sa_2", ["other.txt"]], ["c1", "sa_1", ["made.txt"]]]);
      assert.deepEqual(a.roundChanges(c1).map((/** @type {any} */ r) => [r.turn, r.agent, r.base]), [[1, "sa_3", "apply"]], "the turn's rounds: its own alone");
      a.deleteChain(c1);
      assert.deepEqual(a.roundChangesIn("C:/p", 0).map((/** @type {any} */ r) => r.agent), ["sa_2"], "a deleted chat's go with it");
    } finally {
      a.close();
    }
  });
});

describe("a place read for Changes", { skip: !hasGit && "git is not on PATH" }, () => {
  test("its branch, base, ahead and behind, when its last commit was, and each uncommitted file with its counts; the commit times of named files", async () => {
    const repo = repoIn(join(fresh("filament-cv-place-"), "proj"));
    run(repo, ["switch", "-q", "-c", "feature"]);
    writeFileSync(join(repo, "f.txt"), "f\n");
    run(repo, ["add", "f.txt"]);
    run(repo, ["commit", "-q", "-m", "f"]);
    writeFileSync(join(repo, "a.txt"), "one\nTWO\nthree\n");
    writeFileSync(join(repo, "new.txt"), "n\n");
    renameSync(join(repo, "b.txt"), join(repo, "c.txt"));
    run(repo, ["add", "-A", "b.txt", "c.txt"]);
    const p = await placeChanges(repo);
    assert.deepEqual([p.ok, p.branch, p.base, p.ahead, p.behind, typeof p.headAt], [true, "feature", "main", 1, 0, "number"]);
    assert.deepEqual(p.files.map((f) => [f.path, f.status, f.added, f.removed]).sort(), [["a.txt", "M", 2, 1], ["c.txt", "R", 0, 0], ["new.txt", "A", null, null]]);
    assert.deepEqual(p.uncommitted, { files: 3, added: 2, removed: 1 });
    const { times } = await lastCommits(top(repo), 0, ["a.txt", "f.txt"]);
    assert.deepEqual([...times.keys()].sort(), ["a.txt", "f.txt"]);
    assert.ok((times.get("f.txt") || 0) >= (times.get("a.txt") || 0));
    const none = await placeChanges(fresh("filament-cv-none-"));
    assert.deepEqual([none.ok, none.files], [false, []]);
  });
});

describe("GET /api/git/changes", { skip: !hasGit && "git is not on PATH" }, () => {
  /** A route context over a real repository: the archive's rounds and chats as given. @param {string} root @param {any} o */
  const routes = (root, o) => {
    let reads = 0;
    const rows = gitRoutes({
      config: { get: () => ({ agentLoop: { roots: [root] }, server: {} }) },
      memory: {
        archive: {
          roundChangesIn: (/** @type {string} */ place) => (reads++, (o.rounds[place] || [])),
          getChain: (/** @type {string} */ id) => o.chats[id] || null,
        },
        placesOf: () => o.places || [],
        chatsIn: (/** @type {string[]} */ folders) => new Map(folders.map((f) => [f, o.homes?.[f] || []])),
      },
      subagents: { list: () => o.subs || [], atWork: () => o.busy || [] },
    });
    /** @param {string} path */
    const call = async (path) => {
      const m = createRouter(rows)("GET", path.split("?")[0]);
      assert.ok(m, `GET ${path} matched a row`);
      const got = { status: 0, body: /** @type {any} */ (null) };
      const res = { headersSent: false, writableEnded: false, setHeader() {}, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))) };
      await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => ({}) }, {});
      return got;
    };
    return { call, reads: () => reads };
  };
  /**
   * The clock stands still while a test asks: a place's read serves every ask for `CHANGES_TTL_MS` after it came, and
   * what a call reads after it — the repository's worktrees, the other places, each git processes — takes longer than
   * that under a full suite's load.
   * @param {import("node:test").TestContext} t
   */
  const stillClock = (t) => t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

  // (fails before: yes — there was no such read; Changes read Branch's, with no writer named)
  test("the chat's folder, its sub-agent's copy and the repository's worktree where another chat writes: each file with whose it is", async () => {
    const base = fresh("filament-cv-route-");
    const repo = repoIn(join(base, "proj"));
    const copy = join(base, "proj-sa");
    run(repo, ["worktree", "add", "-q", "--detach", copy]);
    const other = join(base, "proj-docs");
    run(repo, ["worktree", "add", "-q", "-b", "docs", other]);
    const quiet = join(base, "proj-quiet");
    run(repo, ["worktree", "add", "-q", "-b", "quiet", quiet]);
    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
    writeFileSync(join(repo, "mine.txt"), "m\n");
    writeFileSync(join(repo, "by-hand.txt"), "h\n");
    writeFileSync(join(copy, "retry.js"), "r\n");
    writeFileSync(join(other, "README.md"), "docs\n");
    writeFileSync(join(quiet, "q.txt"), "q\n");
    const now = Date.now() + 60_000;
    const [p, c, d] = [top(repo), top(copy), top(other)];
    const r = routes(base, {
      rounds: {
        [p]: [{ chain: "c1", agent: "", own: ["a.txt", "mine.txt"], at: now }, { chain: "c2", agent: "", own: ["a.txt"], at: now - 1000 }],
        [d]: [{ chain: "c3", agent: "", own: ["README.md"], at: now }],
      },
      chats: { c1: { title: "Fix the pane", model: "m1" }, c2: { title: "Fix login", model: "m2" }, c3: { title: "Docs pass", model: "m3" } },
      subs: [{ id: "sa_1", may: "edit", work: { folder: copy }, startedAt: now - 5000, endedAt: null }, { id: "sa_2", may: "read", work: null }],
      homes: { [d]: [{ id: "c3", home: true }] },
      busy: ["c3"],
    });
    const got = await r.call(`/git/changes?cwd=${encodeURIComponent(repo)}&chain=c1`);
    assert.equal(got.status, 200);
    const b = got.body;
    assert.deepEqual(b.places.map((/** @type {any} */ x) => [x.kind, x.sub || null, x.place]), [["folder", null, p], ["copy", "sa_1", c], ["other", null, d]], "the quiet worktree is left out: no one writes there");
    const files = (/** @type {any} */ x) => Object.fromEntries(x.files.map((/** @type {any} */ f) => [f.path, f.by.map((/** @type {any} */ w) => `${w.chain}/${w.agent || "main"}`)]));
    assert.deepEqual(files(b.places[0]), { "a.txt": ["c1/main", "c2/main"], "by-hand.txt": [], "mine.txt": ["c1/main"] });
    assert.deepEqual(files(b.places[1]), { "retry.js": ["c1/sa_1"] }, "the copy's own");
    assert.deepEqual(files(b.places[2]), { "README.md": ["c3/main"] });
    assert.deepEqual(b.places[0].writers.map((/** @type {any} */ w) => [w.chain, w.agent, w.files]), [["c1", "", 2], ["c2", "", 1]]);
    assert.deepEqual([b.places[0].branch, b.places[2].branch, b.places[1].detached], ["main", "docs", true]);
    assert.deepEqual(Object.keys(b.chats).sort(), ["c1", "c2", "c3"]);
    assert.deepEqual([b.homes[d], b.atWork], [["c3"], ["c3"]]);
  });

  test("one read of a place serves every ask for a few seconds; Read again reads anew; a folder in no repository says so", async (t) => {
    stillClock(t);
    const base = fresh("filament-cv-cache-");
    const repo = repoIn(join(base, "proj"));
    const r = routes(base, { rounds: {}, chats: {} });
    const at = `/git/changes?cwd=${encodeURIComponent(repo)}&chain=c1`;
    await r.call(at);
    const first = r.reads();
    writeFileSync(join(repo, "late.txt"), "l\n");
    const again = await r.call(at);
    assert.equal(r.reads(), first, "served from the read before");
    assert.deepEqual(again.body.places[0].files.map((/** @type {any} */ f) => f.path), []);
    const anew = await r.call(`${at}&fresh=1`);
    assert.deepEqual(anew.body.places[0].files.map((/** @type {any} */ f) => f.path), ["late.txt"]);
    const plain = fresh("filament-cv-plain-");
    const none = await routes(plain, { rounds: {}, chats: {} }).call(`/git/changes?cwd=${encodeURIComponent(plain)}`);
    assert.deepEqual([none.body.ok, none.body.error, none.body.places], [false, "not in a git repository", []]);
  });

  // (fails before: yes — the drive of 10-29: a sub-agent's last round wrote a file just before it ended, and its copy's
  // read taken a moment before served the page's read at its end: "4 files wait", three listed)
  test("a sub-agent's copy is read anew once it moved — a round on, or ended — though its last read is a moment old", async (t) => {
    stillClock(t);
    const base = fresh("filament-cv-moved-");
    const repo = repoIn(join(base, "proj"));
    const copy = join(base, "proj-sa");
    run(repo, ["worktree", "add", "-q", "--detach", copy]);
    writeFileSync(join(copy, "part1.txt"), "1\n");
    const sa = { id: "sa_1", may: "edit", status: "running", progress: { round: 1 }, work: { folder: copy, sig: "s", pending: 0, applied: 0 }, startedAt: 1, endedAt: null };
    const r = routes(base, { rounds: {}, chats: {}, subs: [sa] });
    const at = `/git/changes?cwd=${encodeURIComponent(repo)}&chain=c1`;
    const copyFiles = async () => (await r.call(at)).body.places.find((/** @type {any} */ p) => p.kind === "copy").files.map((/** @type {any} */ f) => f.path);
    assert.deepEqual(await copyFiles(), ["part1.txt"]);
    writeFileSync(join(copy, "part2.txt"), "2\n");
    assert.deepEqual(await copyFiles(), ["part1.txt"], "the same round: the read a moment old serves");
    Object.assign(sa, { status: "done", progress: null, endedAt: 2, work: { ...sa.work, pending: 2 } });
    assert.deepEqual(await copyFiles(), ["part1.txt", "part2.txt"], "it ended: read anew");
  });
});
