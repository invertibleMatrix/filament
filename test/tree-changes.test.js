// @ts-check
// Harness B2 and HarnessV4_Git_Plan step 1: what each agent's hands changed, read back from the rounds a turn records —
// per place and per agent, the snapshots around its hands and the files its own calls named — as names, line counts
// and (on request) clipped patches. Every repository is a throwaway under the temp folder — never this one.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { snapshotTree, placeOf } from "../src/adapters/git/snapshot.js";
import { parseNameStatus, parseNumstat, diffFiles, ownChangesOf, roundFilesOf, inPlaces, turnsChanged, EMPTY_TREE } from "../src/adapters/git/changes.js";
import { fewAtOnce } from "../src/core/at-once.js";
import { createTurnTree } from "../src/app/turn-tree.js";
import { Archive } from "../src/services/memory/archive.js";
import { treeCard } from "../src/ui/harness/conversation/turn.js";
import { forkTreeWords } from "../src/ui/harness/lib/labels.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
// A git that just ran may hold its folder a moment on Windows: removing it waits until it can.
after(() => removeDirs(...made.reverse()));
function repo(prefix = "filament-b2-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}
/** A folder no repository holds. @param {string} prefix */
const plain = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
/** The place a folder is in, as git spells it. @param {string} dir */
const top = (dir) => run(dir, ["rev-parse", "--show-toplevel"]);
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

/**
 * A chain's record as the turn tree reads and writes it, in memory: each round's rows by the turn they were taken in,
 * the places it follows, the folder's snapshots on the turn rows.
 */
function chainRecord() {
  /** @type {(import("../src/services/memory/archive.js").RoundChange & { turnId: number })[]} */
  const rows = [];
  /** @type {string[]} */
  const places = [];
  /** @type {any[]} */
  const trees = [];
  /** What the turn's record said its snapshots did not hold, each time it said it. @type {any[]} */
  const unheld = [];
  return {
    rows,
    places,
    trees,
    unheld,
    recordRoundChange: (/** @type {number} */ turnId, /** @type {any} */ c) => rows.push({ turnId, ...c }),
    recordTreeSnapshot: (/** @type {number} */ turnId, /** @type {any} */ o) => trees.push({ turnId, ...o }),
    recordTreeUnheld: (/** @type {number} */ turnId, /** @type {any} */ note) => unheld.push(note && { turnId, ...note }),
    lastInPlace: (/** @type {string} */ _chain, /** @type {string} */ place) => rows.filter((r) => r.place === place && r.after).at(-1)?.after || null,
    placesOf: () => [...places],
    followPlace: (/** @type {string} */ _chain, /** @type {string} */ place) => void (places.includes(place) || places.push(place)),
    /** A turn's rows as the archive reads them back, or every turn's. @param {number | null} [turnId] */
    of: (turnId = null) => rows.filter((r) => turnId == null || r.turnId === turnId).map(({ turnId: n, ...r }) => ({ ...r, turn: n })),
  };
}
/** @param {import("../src/adapters/git/changes.js").OwnFile[]} files */
const named = (files) => files.map((f) => [f.agent, f.path, f.status, f.added, f.removed, !!f.also]);

// (fails before: yes — the helper is new: a long chat's reads ran one after another, two seconds for thirty turns)
test("reads a few at a time: never more at once than asked, the answers in the items' order", async () => {
  let running = 0;
  let most = 0;
  /** @type {(() => void)[]} */
  const opens = [];
  const gates = [0, 1, 2, 3, 4].map(() => new Promise((r) => opens.push(() => r(undefined))));
  const done = fewAtOnce([0, 1, 2, 3, 4], async (n, i) => {
    running++;
    most = Math.max(most, running);
    await gates[n];
    running--;
    return `${i}:${n * 10}`;
  }, 2);
  for (const open of [...opens].reverse()) open();
  assert.deepEqual(await done, ["0:0", "1:10", "2:20", "3:30", "4:40"]);
  assert.equal(most, 2);
  assert.deepEqual(await fewAtOnce([], async () => 1), []);
});

test("git's -z listings parse: statuses with rename scores, numstat with binaries and renames", () => {
  const NUL = "\u0000";
  const ns = parseNameStatus(["M", "a.txt", "A", "sub/new.txt", "R087", "old.md", "docs/new.md", "D", "gone.txt", ""].join(NUL));
  assert.deepEqual(ns, [
    { path: "a.txt", oldPath: null, status: "modified" },
    { path: "sub/new.txt", oldPath: null, status: "added" },
    { path: "docs/new.md", oldPath: "old.md", status: "renamed" },
    { path: "gone.txt", oldPath: null, status: "deleted" },
  ]);
  const num = parseNumstat(["3\t1\ta.txt", "-\t-\timg.png", "0\t0\t", "old.md", "docs/new.md", ""].join(NUL));
  assert.deepEqual(num.get("a.txt"), { added: 3, removed: 1, binary: false });
  assert.deepEqual(num.get("img.png"), { added: 0, removed: 0, binary: true });
  assert.deepEqual(num.get("docs/new.md"), { added: 0, removed: 0, binary: false });
  assert.equal(parseNameStatus("").length, 0);
  assert.equal(parseNumstat("").size, 0);
});

// (fails before: yes — a file was named by the folder it was written from: one in another repository, or in a
// worktree inside the folder, was read in the wrong place or in none)
test("a file as a call named it, in the places a turn wrote in: the innermost that holds it", () => {
  const outer = join(tmpdir(), "filament-b2-places", "repo");
  const inner = join(outer, "wt");
  assert.deepEqual(inPlaces([outer, inner], outer, "src/a.js"), { place: outer, path: "src/a.js" });
  assert.deepEqual(inPlaces([outer, inner], outer, join(inner, "b.js")), { place: inner, path: "b.js" }, "the worktree inside the folder, not the folder");
  assert.deepEqual(inPlaces([outer], null, join(outer, "x", "c.js")), { place: outer, path: "x/c.js" });
  assert.equal(inPlaces([outer], null, "relative.js"), null, "relative to no folder: nowhere");
  assert.equal(inPlaces([inner], outer, "a.js"), null, "a place that does not hold it");
});

describe("the changes adapter against a throwaway repository", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let head;
  /** @type {string} */
  let first;
  /** @type {string} */
  let second;
  before(async () => {
    dir = repo();
    head = run(dir, ["rev-parse", "HEAD"]);
    // Round 1 writes a file and edits another; round 2 renames one and adds an image.
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.txt"), "b1\nb2\n");
    const s1 = await snapshotTree(dir, { name: "c1/5-1" });
    assert.equal(s1.changed, true, s1.error || "");
    first = String(s1.commit);
    rmSync(join(dir, "sub", "b.txt"));
    writeFileSync(join(dir, "sub", "c.txt"), "b1\nb2\n");
    writeFileSync(join(dir, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    const s2 = await snapshotTree(dir, { name: "c1/5-2", previous: first });
    assert.equal(s2.changed, true, s2.error || "");
    second = String(s2.commit);
  });

  test("between two snapshots: names, statuses, counts; a binary is counted as none; a rename is one file; narrowed to paths", async () => {
    const r1 = await diffFiles(dir, head, first);
    assert.deepEqual(
      r1.files.map((f) => [f.path, f.status, f.added, f.removed]),
      [
        ["a.txt", "modified", 1, 0],
        ["sub/b.txt", "added", 2, 0],
      ],
    );
    const r2 = await diffFiles(dir, first, second);
    const png = /** @type {any} */ (r2.files.find((f) => f.path === "img.png"));
    assert.deepEqual([png.status, png.binary, png.added, png.removed], ["added", true, 0, 0]);
    const ren = /** @type {any} */ (r2.files.find((f) => f.path === "sub/c.txt"));
    assert.deepEqual([ren.status, ren.oldPath, ren.added, ren.removed], ["renamed", "sub/b.txt", 0, 0]);
    assert.deepEqual((await diffFiles(dir, first, second, { paths: ["img.png"] })).files.map((f) => f.path), ["img.png"]);
    assert.ok(r2.files.every((f) => !("patch" in f)), "no patch unless asked");
  });

  // (fails before: yes — a round's files were the diff of the whole folder around it: a file nobody's call named in
  // that round was listed as the round's)
  test("one round's own files: only those its agent named; patches on request, clipped with the cut said", async () => {
    const place = top(dir);
    /** @type {import("../src/services/memory/archive.js").RoundChange} */
    const row = { place, round: 1, agent: "", before: head, after: first, base: "round", own: ["a.txt"], command: false };
    const own = await roundFilesOf(row);
    assert.deepEqual(own.files.map((f) => f.path), ["a.txt"], "sub/b.txt changed in the round too, but no call of its named it");
    const clipped = await roundFilesOf(row, { patch: true, maxPatchLines: 4 });
    const a = /** @type {any} */ (clipped.files[0]);
    assert.ok(a.patch.startsWith("diff --git a/a.txt b/a.txt"), a.patch);
    assert.deepEqual([a.truncated, a.patch.split("\n").length, a.lines > 4], [true, 4, true]);
    const both = { ...row, own: ["a.txt", "sub/b.txt"] };
    const one = await roundFilesOf(both, { patch: true, path: "sub/b.txt" });
    assert.deepEqual(one.files.map((f) => f.path), ["sub/b.txt"]);
    assert.match(String(one.files[0].patch), /\+b1\n\+b2/);
    assert.equal(one.files[0].truncated, false);
    assert.deepEqual(await roundFilesOf({ ...row, place: join(dir, "gone") }), { files: [], error: "the folder is gone" });
  });

  test("a snapshot with no parent (a repository that had no HEAD) diffs against the empty tree", async () => {
    const bare = plain("filament-b2-nohead-");
    run(bare, ["init", "-q", "-b", "main"]);
    writeFileSync(join(bare, "first.txt"), "hello\n");
    const s = await snapshotTree(bare, { name: "c2/1-1" });
    assert.equal(s.changed, true, s.error || "");
    assert.equal(s.parent, null);
    const out = await diffFiles(bare, null, String(s.commit));
    assert.deepEqual(
      out.files.map((f) => [f.path, f.status, f.added]),
      [["first.txt", "added", 1]],
    );
    assert.equal(EMPTY_TREE.length, 40);
  });
});

// (fails before: yes — no file had a place: only the chat's folder was ever snapshotted, by its own path)
describe("the place a file is in", { skip: !hasGit && "git is not on PATH" }, () => {
  test("its repository's top folder, from the nearest folder that exists; a worktree is its own; none outside, or in .git", async () => {
    const dir = repo("filament-b2-place-");
    const wt = `${dir}-wt`;
    made.push(wt);
    run(dir, ["worktree", "add", "-q", "--detach", wt]);
    assert.deepEqual(await placeOf(join(dir, "not", "made", "yet.txt")), { place: top(dir), outside: false, error: "" });
    assert.deepEqual(await placeOf(join(wt, "w.txt")), { place: top(wt), outside: false, error: "" });
    assert.notEqual(top(wt), top(dir));
    assert.deepEqual(await placeOf(join(plain("filament-b2-noplace-"), "p.txt")), { place: null, outside: true, error: "not in a git repository" });
    assert.equal((await placeOf(join(dir, ".git", "config"))).outside, true, "inside .git no snapshot covers it");
  });
});

describe("a turn's record: each agent's own files, per place", { skip: !hasGit && "git is not on PATH" }, () => {
  // (fails before: yes — HarnessV4_Git_Plan §1.2: a turn's changes were the diff of the whole folder between its
  // snapshots, so a file written by hand between two of its rounds was the turn's, and nothing said someone else had
  // touched a file of its own)
  test("what someone else writes between two rounds is not the agent's; a file of its own they touched too is marked", async () => {
    const dir = repo("filament-b2-own-");
    const place = top(dir);
    const mem = chainRecord();
    writeFileSync(join(dir, "wip.txt"), "not committed yet\n");
    const t = createTurnTree({ memory: mem, chainId: "c1", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    await t.before(1, { paths: [join(dir, "a.txt")] });
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
    const r1 = await t.take(1, { own: [join(dir, "a.txt")] });
    assert.deepEqual(r1.snapshots.map((s) => s.ref), ["refs/filament/snapshots/c1/1-1"], "the folder's ref carries no place key");
    // By hand, between the rounds.
    writeFileSync(join(dir, "hand.txt"), "by hand\n");
    writeFileSync(join(dir, "a.txt"), "zero\none\ntwo\nthree\n");
    await t.before(2, { paths: [join(dir, "a.txt"), join(dir, "b.txt")] });
    writeFileSync(join(dir, "a.txt"), "zero\none\ntwo\nthree\nfour\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    await t.take(2, { own: [join(dir, "a.txt"), join(dir, "b.txt")] });
    assert.deepEqual(
      mem.rows.map((r) => [r.place, r.round, r.agent, r.base, r.own, r.command]),
      [
        [place, 1, "", "round", ["a.txt"], false],
        [place, 2, "", "round", ["a.txt", "b.txt"], false],
      ],
    );
    assert.deepEqual(mem.trees.map((x) => [x.turnId, x.round]), [[1, 1], [1, 2]], "the folder's snapshots on the turn row, for a fork");
    const out = await ownChangesOf(mem.of(1));
    assert.deepEqual(named(out.files), [
      ["", "a.txt", "modified", 3, 0, true],
      ["", "b.txt", "added", 1, 0, false],
    ]);
    assert.deepEqual([out.totals, out.places, out.during, out.outside, out.errors], [{ files: 2, added: 4, removed: 0 }, [{ place, start: "round" }], [], [], []]);
  });

  // (fails before: no — the rounds were read one after another; read a few at a time, their order and marks must hold)
  test("a long chat's rounds read a few at a time: each file in the order first written, a hand edit between two rounds marked", async () => {
    const dir = repo("filament-b2-long-");
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c9", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    for (let n = 1; n <= 12; n++) {
      const shared = n === 1 || n === 12;
      await t.before(n, { paths: [join(dir, `f${n}.txt`), ...(shared ? [join(dir, "shared.txt")] : [])] });
      writeFileSync(join(dir, `f${n}.txt`), `${n}\n`);
      if (shared) writeFileSync(join(dir, "shared.txt"), `round ${n}\n`);
      await t.take(n, { own: [join(dir, `f${n}.txt`), ...(shared ? [join(dir, "shared.txt")] : [])] });
      if (n === 6) writeFileSync(join(dir, "shared.txt"), "by hand\n");
    }
    const out = await ownChangesOf(mem.of(1));
    assert.deepEqual(named(out.files), [
      ["", "f1.txt", "added", 1, 0, false],
      ["", "shared.txt", "added", 1, 0, true],
      ...Array.from({ length: 11 }, (_, i) => ["", `f${i + 2}.txt`, "added", 1, 0, false]),
    ]);
    assert.deepEqual(out.errors, []);
  });

  // (fails before: yes — a helper's writes in the shared folder were the turn's, with nobody's name on them)
  test("a helper's writes in the shared folder are its rows; a file two of them wrote is marked on each", async () => {
    const dir = repo("filament-b2-helper-");
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c2", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    await t.before(1, { paths: [join(dir, "c.txt")] });
    writeFileSync(join(dir, "c.txt"), "both\n");
    writeFileSync(join(dir, "h.txt"), "helper\n");
    await t.take(1, { own: [join(dir, "c.txt")], writes: [{ by: "sa_1", paths: [join(dir, "h.txt"), join(dir, "c.txt")] }] });
    assert.deepEqual(mem.rows.map((r) => [r.agent, r.own]), [["", ["c.txt"]], ["sa_1", ["h.txt", "c.txt"]]]);
    assert.deepEqual(named((await ownChangesOf(mem.of(1))).files), [
      ["", "c.txt", "added", 1, 0, true],
      ["sa_1", "c.txt", "added", 1, 0, true],
      ["sa_1", "h.txt", "added", 1, 0, false],
    ]);
  });

  // (fails before: yes — a command's files were the turn's like any edit's, and the work in the folder not committed
  // before the turn was counted with them)
  test("what changed while a command ran is apart from the agent's own files, and holds nothing from before the turn", async () => {
    const dir = repo("filament-b2-cmd-");
    const mem = chainRecord();
    writeFileSync(join(dir, "wip.txt"), "before the turn\n");
    const t = createTurnTree({ memory: mem, chainId: "c3", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    await t.before(1, { command: true });
    await t.before(1, { paths: [join(dir, "own.txt")] });
    writeFileSync(join(dir, "made.txt"), "by the command\n");
    writeFileSync(join(dir, "own.txt"), "by its write\n");
    await t.take(1, { own: [join(dir, "own.txt")], command: true });
    assert.deepEqual(mem.rows.map((r) => [r.agent, r.own, r.command]), [["", ["own.txt"], true]]);
    const out = await ownChangesOf(mem.of(1));
    assert.deepEqual(named(out.files), [["", "own.txt", "added", 1, 0, false]]);
    assert.deepEqual(out.during.map((d) => [d.agent, d.path, d.status, d.round]), [["", "made.txt", "added", 1]]);
  });

  /** Each own file with its marks: agent, path, status, also, via. @param {any[]} files */
  const marked = (files) => files.map((f) => [f.agent, f.path, f.status, !!f.also, f.via || null]).sort((a, b) => `${a[0]}|${a[1]}`.localeCompare(`${b[0]}|${b[1]}`));

  // (fails before: yes — what a command changed was "whose, git cannot tell" everywhere: the owner's opus55 edits its
  // worktree through scripts, and its real work there sat under that line; HarnessV4_Git_Plan GW-D57)
  test("in a place only its chat works in, what its commands changed is its own, marked; a file its calls named is not; a helper's stays the helper's", async () => {
    const dir = repo("filament-d57-loop-");
    const place = top(dir);
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c57", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    await t.before(1, { command: true });
    await t.before(1, { paths: [join(dir, "own.txt"), join(dir, "h.txt")] });
    writeFileSync(join(dir, "made.txt"), "by its script\n");
    writeFileSync(join(dir, "own.txt"), "by its write\n");
    writeFileSync(join(dir, "h.txt"), "by the helper\n");
    await t.take(1, { own: [join(dir, "own.txt")], command: true, writes: [{ by: "sa_1", paths: [join(dir, "h.txt")] }] });
    // By hand, between the rounds: a file its script then changes again is marked (GWC-132).
    writeFileSync(join(dir, "made.txt"), "by hand\n");
    await t.before(2, { command: true });
    writeFileSync(join(dir, "made.txt"), "by its script, again\n");
    writeFileSync(join(dir, "own.txt"), "by its write\nand its script\n");
    writeFileSync(join(dir, "made2.txt"), "two\n");
    await t.take(2, { command: true });
    assert.deepEqual(mem.rows.map((r) => [r.round, r.agent, r.base, r.command]), [[1, "", "round", true], [1, "sa_1", "round", false], [2, "", "round", true]]);
    const out = await ownChangesOf(mem.of(1), { alone: new Set([place]) });
    assert.deepEqual(marked(out.files), [
      ["", "made.txt", "added", true, "command"],
      ["", "made2.txt", "added", false, "command"],
      ["", "own.txt", "added", false, null],
      ["sa_1", "h.txt", "added", false, null],
    ]);
    assert.deepEqual([out.during, out.errors, out.totals.files], [[], [], 4]);
    // The same rounds where another chat works too: its commands' changes are apart, as before.
    const shared = await ownChangesOf(mem.of(1));
    assert.deepEqual(marked(shared.files).map((f) => f.slice(0, 2)), [["", "own.txt"], ["sa_1", "h.txt"]]);
    assert.deepEqual([...new Set(shared.during.map((d) => d.path))].sort(), ["h.txt", "made.txt", "made2.txt"]);
    // One file asked for.
    assert.deepEqual(marked((await ownChangesOf(mem.of(1), { alone: new Set([place]), path: "made2.txt", place })).files), [["", "made2.txt", "added", false, "command"]]);
  });

  // (fails before: yes — as above)
  test("a coding agent's command rounds, from where the turn began, are credited; one compared with the last commit is not (GWC-133)", async () => {
    const dir = repo("filament-d57-acp-");
    const place = top(dir);
    const mem = chainRecord();
    writeFileSync(join(dir, "wip.txt"), "uncommitted before the turn\n");
    const t = createTurnTree({ memory: mem, chainId: "c58", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    writeFileSync(join(dir, "made.txt"), "by its script\n");
    await t.take(1, { command: true });
    assert.deepEqual(mem.rows.map((r) => [r.round, r.base]), [[1, "last"]]);
    const out = await ownChangesOf(mem.of(1), { alone: new Set([place]) });
    assert.deepEqual(marked(out.files), [["", "made.txt", "added", false, "command"]], "the work from before the turn is not its");
    // No snapshot before: the round is compared with the last commit, which holds what was uncommitted before.
    const cold = repo("filament-d57-head-");
    writeFileSync(join(cold, "wip.txt"), "uncommitted before\n");
    const mem2 = chainRecord();
    const t2 = createTurnTree({ memory: mem2, chainId: "c59", turnId: 1, turnNo: 1, root: cold });
    writeFileSync(join(cold, "made.txt"), "by its script\n");
    await t2.take(1, { command: true });
    assert.deepEqual(mem2.rows.map((r) => [r.round, r.base]), [[1, "head"]]);
    const cold2 = await ownChangesOf(mem2.of(1), { alone: new Set([top(cold)]) });
    assert.deepEqual([cold2.files, cold2.during.map((d) => d.path).sort()], [[], ["made.txt", "wip.txt"]]);
  });

  // (fails before: yes — the place was followed as the write named it, before the fence refused it: the header
  // said the chat's agent wrote in a worktree it never touched; HarnessV4_Git_Plan step 2's drive)
  test("a write the fence refuses leaves its place unfollowed and unrecorded", async () => {
    const dir = repo("filament-b2-refused-");
    const wt = `${dir}-wt`;
    made.push(wt);
    run(dir, ["worktree", "add", "-q", "-b", "side", wt]);
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c9", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    await t.before(1, { paths: [join(wt, "w.txt")] });
    const r = await t.take(1, { own: [] });
    assert.deepEqual([mem.places, mem.rows, r.snapshots], [[], [], []]);
    await t.before(2, { paths: [join(wt, "w.txt")] });
    writeFileSync(join(wt, "w.txt"), "landed\n");
    await t.take(2, { own: [join(wt, "w.txt")] });
    assert.deepEqual(mem.places, [top(wt)], "a write that landed there is followed");
    assert.deepEqual(mem.rows.map((x) => [x.place, x.round, x.own, x.base]), [[top(wt), 2, ["w.txt"], "round"]]);
  });

  // (fails before: yes — one failed snapshot left the place for the rest of the turn: the owner's turn of 10-31 had
  // git read a file while an edit wrote it ("short read while indexing src/core/trim.js") and took no snapshot in its
  // last 52 minutes, so a fork that checked the files out got them as they stood before; the failed round's files were
  // in no record, so Changes and Rewind never named them)
  test("a round whose snapshot failed is said, and the turn's next round is snapshotted and recorded with what it missed", async () => {
    const dir = repo("filament-snap-again-");
    const place = top(dir);
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c70", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    // Round 1's ref cannot be written: a ref beneath its name holds the spot.
    run(dir, ["update-ref", "refs/filament/snapshots/c70/1-1/held", "HEAD"]);
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
    writeFileSync(join(dir, "c.txt"), "c\n");
    const head = run(dir, ["rev-parse", "HEAD"]);
    const r1 = await t.take(1, { own: [join(dir, "a.txt")], writes: [{ by: "sa_1", paths: [join(dir, "c.txt")] }] });
    assert.deepEqual([r1.snapshots, r1.rows], [[], []]);
    assert.deepEqual(r1.errors.map((e) => e.place), [place]);
    assert.match(r1.errors[0].error, /update-ref/);
    writeFileSync(join(dir, "b.txt"), "b\n");
    const r2 = await t.take(2, { own: [join(dir, "b.txt")] });
    assert.deepEqual([r2.snapshots.map((s) => s.ref), r2.errors], [["refs/filament/snapshots/c70/1-2"], []]);
    assert.deepEqual([run(dir, ["show", "refs/filament/snapshots/c70/1-2:a.txt"]), run(dir, ["show", "refs/filament/snapshots/c70/1-2:b.txt"])], ["one\ntwo\nthree", "b"]);
    assert.deepEqual(mem.trees.map((x) => x.round), [2], "the fork's snapshot is round 2's");
    const after = run(dir, ["rev-parse", "refs/filament/snapshots/c70/1-2"]);
    assert.deepEqual(mem.rows.map((r) => [r.round, r.agent, r.own, r.before, r.after, r.base]), [
      [2, "", ["a.txt", "b.txt"], head, after, "last"],
      [2, "sa_1", ["c.txt"], head, after, "last"],
    ], "round 2's record names round 1's files too, each agent's, from where round 1 started");
    // A round that names nothing in the place snapshots it all the same while a failed round's files wait there.
    run(dir, ["update-ref", "refs/filament/snapshots/c70/1-3/held", "HEAD"]);
    writeFileSync(join(dir, "d.txt"), "d\n");
    assert.equal((await t.take(3, { own: [join(dir, "d.txt")] })).errors.length, 1);
    const r4 = await t.take(4, { own: [join(tmpdir(), "filament-outside-none.txt")] });
    assert.deepEqual(r4.snapshots.map((x) => x.ref), ["refs/filament/snapshots/c70/1-4"]);
    assert.deepEqual(mem.rows.filter((r) => r.round === 4 && r.place).map((r) => [r.own, r.before]), [[["d.txt"], after]]);
    // (fails before: yes — D7 of 11-01: a fork checked out the newest snapshot with no word that the turn's later
    // writes, which a failed snapshot left in none, were missing) The turn's record says what no snapshot holds, until
    // one does.
    assert.deepEqual(mem.unheld, [
      { turnId: 1, round: 1, files: ["a.txt", "c.txt"], command: false },
      { turnId: 1, round: 3, files: ["d.txt"], command: false },
    ], "said as each failed; held again by the next round's snapshot, which records the tree");
  });

  // (fails before: yes, by its words alone — a timed-out `git add` was said by whatever git had printed, here a line
  // ending warning; the place was left then as now, as each try would wait as long)
  test("a snapshot that ran past its time leaves the place for the rest of the turn", async () => {
    const dir = repo("filament-snap-slow-");
    // A clean filter that takes three seconds: `git add` of a .slow file waits on it.
    run(dir, ["config", "filter.slow.clean", `node -e "setTimeout(() => process.stdin.pipe(process.stdout), 3000)"`]);
    writeFileSync(join(dir, ".gitattributes"), "*.slow filter=slow\n");
    run(dir, ["add", "."]);
    run(dir, ["commit", "-q", "-m", "attributes"]);
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c71", turnId: 1, turnNo: 1, root: dir });
    writeFileSync(join(dir, "x.slow"), "x\n");
    const r1 = await t.take(1, { own: [join(dir, "x.slow")], timeoutMs: 1000 });
    assert.deepEqual([r1.snapshots, r1.errors.length], [[], 1]);
    assert.match(r1.errors[0].error, /^git add failed: git add timed out$/);
    writeFileSync(join(dir, "b.txt"), "b\n");
    const r2 = await t.take(2, { own: [join(dir, "b.txt")] });
    assert.deepEqual([r2.snapshots, r2.errors, mem.rows], [[], [], []], "not tried again, and said once");
    // (fails before: yes — D7 of 11-01) What the left place's rounds wrote is on the turn's record, round by round.
    assert.deepEqual(mem.unheld, [
      { turnId: 1, round: 1, files: ["x.slow"], command: false },
      { turnId: 1, round: 2, files: ["x.slow", "b.txt"], command: false },
    ]);
  });

  // (fails before: yes — D7 of 11-01: the fork card said "a snapshot is in force" with no time, and nothing of the writes
  // it did not hold)
  test("the fork card says its files' turn, round and time, and what the turns since wrote that no snapshot holds", () => {
    const now = new Date(2026, 10, 1, 18, 0);
    const at = new Date(2026, 10, 1, 14, 5).getTime();
    const hhmm = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const tree = { ref: "refs/filament/snapshots/c1/3-2", turn: 3, round: 2, at };
    assert.deepEqual(forkTreeWords(tree, 4, now), { held: `Files as of turn 3, round 2, ${hhmm} (c1/3-2)`, missing: "" });
    assert.equal(forkTreeWords({ ...tree, unheld: [{ turn: 3, files: ["a.txt", "c.txt"], command: false }] }, 3, now).missing, "Not in them: what turn 3 wrote after — a.txt, c.txt; the folder's snapshot failed then");
    assert.equal(
      forkTreeWords({ ...tree, unheld: [{ turn: 5, files: [], command: true }, { turn: 4, files: ["1", "2", "3", "4", "5", "6"], command: false }] }, 5, now).missing,
      "Not in them: what turns 4 and 5 wrote after — 1, 2, 3, 4, 5 and 1 more, and what commands wrote; the folder's snapshot failed then",
    );
    assert.equal(forkTreeWords({ ref: "r" }, 2, now).held, "Files as of turn 2 (r)", "a snapshot recorded with no round or time");
  });

  // (fails before: yes — the Hunter's of 10-31: the round after a failed one snapshots the place before its command
  // runs, with no ref; its own snapshot, changing nothing, then wrote none, so the failed round's files were kept under
  // no ref and a fork checked the place out as it was before them)
  test("a round that changes nothing after a failed one keeps the failed round's files under its ref, and names them", async () => {
    const dir = repo("filament-snap-still-");
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c72", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    const head = run(dir, ["rev-parse", "HEAD"]);
    run(dir, ["update-ref", "refs/filament/snapshots/c72/1-1/held", "HEAD"]);
    writeFileSync(join(dir, "x.txt"), "x\n");
    assert.equal((await t.take(1, { own: [join(dir, "x.txt")] })).errors.length, 1);
    await t.before(2, { command: true });
    const r2 = await t.take(2, { command: true });
    assert.deepEqual(r2.snapshots.map((x) => x.ref), ["refs/filament/snapshots/c72/1-2"]);
    assert.equal(run(dir, ["show", "refs/filament/snapshots/c72/1-2:x.txt"]), "x");
    assert.deepEqual(mem.trees.map((x) => x.round), [2], "the fork's snapshot is round 2's");
    const after = run(dir, ["rev-parse", "refs/filament/snapshots/c72/1-2"]);
    assert.deepEqual(mem.rows.map((r) => [r.round, r.own, r.command, r.before, r.after, r.base]), [[2, ["x.txt"], true, head, after, "last"]]);
  });

  // (fails before: yes — the Hunter's of 10-31: a pause parked where each place stood, not what a failed snapshot left
  // to name, so the turn that answered it named none of the failed round's files)
  test("a pause parks what a failed snapshot left to name, and the turn that answers it names it", async () => {
    const dir = repo("filament-snap-park-");
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c73", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    run(dir, ["update-ref", "refs/filament/snapshots/c73/1-1/held", "HEAD"]);
    writeFileSync(join(dir, "x.txt"), "x\n");
    assert.equal((await t.take(1, { own: [join(dir, "x.txt")] })).errors.length, 1);
    const parked = JSON.parse(JSON.stringify({ from: t.next(), waiting: t.waiting() }));
    const again = createTurnTree({ memory: mem, chainId: "c73", turnId: 1, turnNo: 1, root: dir, ...parked });
    writeFileSync(join(dir, "y.txt"), "y\n");
    const r2 = await again.take(2, { own: [join(dir, "y.txt")] });
    assert.deepEqual(r2.snapshots.map((x) => x.ref), ["refs/filament/snapshots/c73/1-2"]);
    assert.deepEqual(mem.rows.map((r) => [r.round, r.own]), [[2, ["x.txt", "y.txt"]]]);
    assert.equal(again.waiting(), null, "nothing waits once it is named");
  });

  // (fails before: yes — the Hunter's of 10-31: a failed round whose start the repository does not have was recorded
  // from it all the same, "last", so Changes and Rewind read a commit git does not have)
  test("a failed round's files are recorded from HEAD where its start is one the repository does not have", async () => {
    const dir = repo("filament-snap-gone-");
    const mem = chainRecord();
    mem.lastInPlace = () => "0123456789abcdef0123456789abcdef01234567";
    const t = createTurnTree({ memory: mem, chainId: "c74", turnId: 1, turnNo: 1, root: dir });
    const head = run(dir, ["rev-parse", "HEAD"]);
    run(dir, ["update-ref", "refs/filament/snapshots/c74/1-1/held", "HEAD"]);
    writeFileSync(join(dir, "x.txt"), "x\n");
    assert.equal((await t.take(1, { own: [join(dir, "x.txt")] })).errors.length, 1);
    writeFileSync(join(dir, "y.txt"), "y\n");
    await t.take(2, { own: [join(dir, "y.txt")] });
    const after = run(dir, ["rev-parse", "refs/filament/snapshots/c74/1-2"]);
    assert.deepEqual(mem.rows.map((r) => [r.own, r.before, r.after, r.base]), [[["x.txt", "y.txt"], head, after, "head"]]);
  });

  // (fails before: yes — the Hunter's of 10-31: a snapshot that failed as the turn began was said nowhere, and one that
  // ran past the start's shorter leash left the place for the whole turn; a timeout after a place's earlier failure
  // was not told apart, so the turn said the place once and dropped it in silence)
  test("a snapshot that fails as the turn begins is said with the first round's record, a timeout there leaves the place in, and a timeout after an earlier failure is said apart", async () => {
    const dir = repo("filament-snap-start-");
    run(dir, ["config", "filter.slow.clean", `node -e "setTimeout(() => process.stdin.pipe(process.stdout), 3000)"`]);
    writeFileSync(join(dir, ".gitattributes"), "*.slow filter=slow\n");
    run(dir, ["add", "."]);
    run(dir, ["commit", "-q", "-m", "attributes"]);
    const place = top(dir);
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c76", turnId: 1, turnNo: 1, root: dir });
    writeFileSync(join(dir, "x.slow"), "x\n");
    await t.begin({ timeoutMs: 1000 });
    const r1 = await t.take(1, { own: [join(dir, "x.slow")] });
    assert.deepEqual(r1.errors.map((e) => [e.place, e.timedOut === true]), [[place, true]], "the start's timeout, said");
    assert.match(r1.errors[0].error, /timed out/);
    assert.deepEqual(r1.snapshots.map((x) => x.ref), ["refs/filament/snapshots/c76/1-1"], "and the place still snapshotted");
    run(dir, ["update-ref", "refs/filament/snapshots/c76/1-2/held", "HEAD"]);
    writeFileSync(join(dir, "y.txt"), "y\n");
    const r2 = await t.take(2, { own: [join(dir, "y.txt")] });
    assert.deepEqual(r2.errors.map((e) => !!e.timedOut), [false]);
    writeFileSync(join(dir, "x.slow"), "x again\n");
    const r3 = await t.take(3, { own: [join(dir, "x.slow")], timeoutMs: 1000 });
    assert.deepEqual(r3.errors.map((e) => !!e.timedOut), [true], "a timeout after the place's failure says so");
  });

  // (fails before: yes — the Hunter's of 10-31: a place whose failed round's files waited took the chat's folder's
  // turn, so a round that named nothing it wrote no longer snapshotted the folder)
  test("while another place's files wait, a round that names nothing it wrote still snapshots the chat's folder", async () => {
    const dir = repo("filament-snap-folder-");
    const other = repo("filament-snap-other-");
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c75", turnId: 1, turnNo: 1, root: dir });
    const key = createHash("sha1").update(top(other).toLowerCase()).digest("hex").slice(0, 8);
    run(other, ["update-ref", `refs/filament/snapshots/c75/1-1-in-${key}/held`, "HEAD"]);
    writeFileSync(join(other, "x.txt"), "x\n");
    assert.equal((await t.take(1, { own: [join(other, "x.txt")] })).errors.length, 1);
    writeFileSync(join(dir, "c.txt"), "c\n");
    const r2 = await t.take(2, {});
    assert.deepEqual(r2.snapshots.map((x) => x.ref).sort(), ["refs/filament/snapshots/c75/1-2", `refs/filament/snapshots/c75/1-2-in-${key}`]);
  });

  // (fails before: yes — the review of 10-31: a place the chat once followed whose folder is gone failed as every turn
  // began, said with its first round's record, and before every command, said and waiting from then on)
  test("a place the chat followed whose folder is gone is snapshotted no more, and said nowhere", async () => {
    const dir = repo("filament-snap-gone-place-");
    const mem = chainRecord();
    mem.places.push(`${top(dir)}-gone`);
    const t = createTurnTree({ memory: mem, chainId: "c77", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    writeFileSync(join(dir, "x.txt"), "x\n");
    const r1 = await t.take(1, { own: [join(dir, "x.txt")] });
    await t.before(2, { command: true });
    const r2 = await t.take(2, { command: true });
    assert.deepEqual([r1.errors, r2.errors, t.waiting()], [[], [], null]);
    assert.deepEqual(r1.snapshots.map((x) => x.ref), ["refs/filament/snapshots/c77/1-1"]);
  });

  // (fails before: yes — the review of 10-31: a stop while a place was snapshotted before a round's command was said as
  // the place's failure, though the turn's last snapshot then took it)
  test("a snapshot a stop abandoned before a round's command is said nowhere, and the round's own is taken", async () => {
    const dir = repo("filament-snap-stop-");
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c78", turnId: 1, turnNo: 1, root: dir });
    const stop = new AbortController();
    stop.abort();
    await t.before(1, { command: true, signal: stop.signal });
    writeFileSync(join(dir, "x.txt"), "x\n");
    const r = await t.take(1, { command: true });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.snapshots.map((x) => x.ref), ["refs/filament/snapshots/c78/1-1"]);
  });

  // (fails before: yes — only the chat's folder was snapshotted: a write in a sibling worktree was in no record, and
  // the next turn could not tell an edit by hand there from its agent's)
  test("a sibling worktree a write names is followed: its own snapshots, and every later turn begins with it", async () => {
    const dir = repo("filament-b2-side-");
    const wt = `${dir}-wt`;
    made.push(wt);
    run(dir, ["worktree", "add", "-q", "-b", "side", wt]);
    const side = top(wt);
    const mem = chainRecord();
    const t1 = createTurnTree({ memory: mem, chainId: "c4", turnId: 1, turnNo: 1, root: dir });
    await t1.begin();
    await t1.before(1, { paths: [join(wt, "w.txt")] });
    writeFileSync(join(wt, "w.txt"), "in the worktree\n");
    const r1 = await t1.take(1, { own: [join(wt, "w.txt")] });
    assert.deepEqual(mem.places, [side], "the chat follows it");
    assert.deepEqual(mem.rows.map((r) => [r.place, r.own, r.base]), [[side, ["w.txt"], "round"]]);
    assert.match(r1.snapshots[0].ref, /^refs\/filament\/snapshots\/c4\/1-1-in-[0-9a-f]{8}$/, "apart from the folder's: worktrees share their refs");
    assert.equal(run(wt, ["rev-parse", r1.snapshots[0].ref]), r1.snapshots[0].commit);
    assert.deepEqual(mem.trees, [], "a fork checks out the folder's snapshot, never another place's");
    assert.deepEqual(named((await ownChangesOf(mem.of(1))).files), [["", "w.txt", "added", 1, 0, false]]);
    // By hand there between the turns; then a coding agent's command, which Filament does not see before it runs.
    writeFileSync(join(wt, "hand.txt"), "by hand\n");
    const t2 = createTurnTree({ memory: mem, chainId: "c4", turnId: 2, turnNo: 2, root: dir });
    await t2.begin();
    writeFileSync(join(wt, "made.txt"), "by the command\n");
    await t2.take(1, { command: true });
    assert.deepEqual(mem.of(2).map((r) => [r.place, r.base, r.command]), [[side, "last", true]], "the folder had not changed: no row of it");
    const out = await ownChangesOf(mem.of(2));
    assert.deepEqual([out.files, out.during.map((d) => d.path)], [[], ["made.txt"]], "the edit by hand before the turn is not in it");
  });

  // (fails before: yes — a write outside any repository was in no record: the turn's card never named it)
  test("a file outside any repository is kept by its path, with no snapshot and no diff", async () => {
    const dir = plain("filament-b2-out-");
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c5", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    const path = join(dir, "p.txt");
    await t.before(1, { paths: [path] });
    writeFileSync(path, "plain\n");
    const taken = await t.take(1, { own: [path] });
    assert.deepEqual([taken.snapshots, taken.errors], [[], []]);
    assert.deepEqual(mem.rows.map((r) => [r.place, r.base, r.before, r.after, r.own]), [["", "none", null, null, [path]]]);
    const out = await ownChangesOf(mem.of(1));
    assert.deepEqual([out.files, out.outside, out.places], [[], [{ agent: "", path }], []]);
  });

  // (fails before: yes — a coding agent's write in a place no turn had snapshotted was read against nothing: its start
  // was never said)
  test("a coding agent's first write in a place not seen yet starts from its last commit, the next from its snapshot", async () => {
    const dir = repo("filament-b2-head-");
    const other = repo("filament-b2-other-");
    const mem = chainRecord();
    const t = createTurnTree({ memory: mem, chainId: "c6", turnId: 1, turnNo: 1, root: dir });
    await t.begin();
    writeFileSync(join(other, "x.txt"), "x\n");
    await t.take(1, { own: [join(other, "x.txt")] });
    writeFileSync(join(other, "y.txt"), "y\n");
    await t.take(2, { own: [join(other, "y.txt")] });
    assert.deepEqual(mem.rows.map((r) => [r.round, r.base]), [[1, "head"], [2, "last"]]);
    assert.equal(mem.rows[0].before, run(other, ["rev-parse", "HEAD"]));
    assert.equal(mem.rows[1].before, mem.rows[0].after);
    assert.deepEqual((await ownChangesOf(mem.of(1))).places, [{ place: top(other), start: "head" }]);
  });

  test("a turn begins where the chain left each place, with no ref; the turn that answers a pause continues from where it stood", async () => {
    const dir = repo("filament-b2-start-");
    const place = top(dir);
    const mem = chainRecord();
    writeFileSync(join(dir, "wip.txt"), "not committed yet\n");
    const paused = createTurnTree({ memory: mem, chainId: "c7", turnId: 1, turnNo: 1, root: dir });
    await paused.begin();
    const start = paused.next()[place];
    assert.match(String(start), /^[0-9a-f]{40}$/);
    assert.equal(run(dir, ["rev-parse", `${start}^`]), run(dir, ["rev-parse", "HEAD"]), "the work not committed yet, on top of HEAD");
    assert.equal(run(dir, ["for-each-ref", "--points-at", String(start)]), "", "no ref names it");
    const answers = createTurnTree({ memory: mem, chainId: "c7", turnId: 2, turnNo: 2, root: dir, from: paused.next() });
    writeFileSync(join(dir, "d.txt"), "d\n");
    await answers.take(1, { own: [join(dir, "d.txt")] });
    assert.deepEqual(mem.rows.map((r) => [r.before, r.base]), [[start, "last"]]);
    assert.deepEqual(named((await ownChangesOf(mem.of(2))).files), [["", "d.txt", "added", 1, 0, false]]);
  });
});

// (fails before: yes — there was no record of a round: a turn's files were read from the folder's snapshots alone)
// (fails before: yes — the Changes pane's History is new: the owner's words of 10-18 on the whole chat's read it
// replaced, "first it took ages to load the changes and there were so many")
test("the turns that changed files: a file once per place however many rounds named it, a move's rounds never a turn's, a turn whose commands alone changed a folder", () => {
  /** @param {Partial<import("../src/core/types.js").RoundChange>} r @returns {import("../src/core/types.js").RoundChange} */
  const row = (r) => ({ place: "C:/p", round: 1, agent: "", before: null, after: null, base: "round", own: [], command: false, ...r });
  assert.deepEqual(
    turnsChanged([
      row({ turn: 1, own: ["a.txt", "b.txt"] }),
      row({ turn: 1, round: 2, own: ["a.txt"] }),
      row({ turn: 1, place: "C:/q", own: ["a.txt"] }),
      row({ turn: 2, base: "move", own: ["moved.txt"] }),
      row({ turn: 3, command: true }),
      row({ turn: 4, place: "", base: "none", own: ["C:/out/z.txt", "C:/out/z.txt"] }),
      row({ own: ["no-turn.txt"] }),
    ]),
    [
      { n: 4, files: 0, outside: 1, commands: false },
      { n: 3, files: 0, outside: 0, commands: true },
      { n: 1, files: 3, outside: 0, commands: false },
    ],
  );
  assert.deepEqual(turnsChanged([]), []);
});

describe("the archive keeps each round's record", () => {
  const dir = plain("filament-b2-archive-");
  let clock = 1_758_000_000_000;
  /** @type {any} */
  const a = new (/** @type {any} */ (Archive))({ file: join(dir, "a.db"), now: () => (clock += 1000) });
  after(() => a.close());
  let seq = 0;
  /** @param {string} chainId */
  const turn = (chainId) => {
    const { turnId } = a.beginTurn(chainId, { requestId: `r${++seq}`, model: "m", upstream: "u", userMessage: { role: "user", content: [{ type: "text", text: "go" }] } });
    a.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "done" }] }, requestId: `r${seq}` });
    return turnId;
  };
  const sha = (/** @type {string} */ c) => c.repeat(40);

  test("rows in the order taken, a turn's or the chat's; the newest snapshot of a place; gone with the chain, never forked", () => {
    const ch = a.chainForKey("k1", { cwd: "C:\\b2\\proj", client: "c", model: "m" });
    const t1 = turn(ch.id);
    const t2 = turn(ch.id);
    assert.equal(a.addRoundChange(t1, { place: "C:/p", round: 1, agent: "", before: sha("a"), after: sha("b"), base: "round", own: ["x.txt"], command: false }), 1);
    assert.equal(a.addRoundChange(t1, { place: "C:/p", round: 1, agent: "sa_1", before: sha("a"), after: sha("b"), base: "round", own: ["h.txt"], command: true }), 2);
    a.addRoundChange(t2, { place: "C:/q", round: 1, agent: "", before: null, after: sha("c"), base: "head", own: ["y.txt"], command: false });
    a.addRoundChange(t2, { place: "", round: 2, agent: "", before: null, after: null, base: "none", own: ["C:/out/z.txt"], command: false });
    assert.deepEqual(a.roundChanges(ch.id), [
      { place: "C:/p", round: 1, agent: "", before: sha("a"), after: sha("b"), base: "round", own: ["x.txt"], command: false, turn: 1 },
      { place: "C:/p", round: 1, agent: "sa_1", before: sha("a"), after: sha("b"), base: "round", own: ["h.txt"], command: true, turn: 1 },
      { place: "C:/q", round: 1, agent: "", before: null, after: sha("c"), base: "head", own: ["y.txt"], command: false, turn: 2 },
      { place: "", round: 2, agent: "", before: null, after: null, base: "none", own: ["C:/out/z.txt"], command: false, turn: 2 },
    ]);
    assert.deepEqual(a.roundChanges(ch.id, { turn: 2 }).map((r) => r.place), ["C:/q", ""]);
    // (fails before: yes — the Changes pane's History is new, the owner's words of 10-18)
    assert.deepEqual(
      turnsChanged(a.roundChanges(ch.id)),
      [{ n: 2, files: 1, outside: 1, commands: false }, { n: 1, files: 2, outside: 0, commands: true }],
      "the turns that changed files, newest first, from the rows alone",
    );
    assert.deepEqual([a.lastInPlace(ch.id, "C:/p"), a.lastInPlace(ch.id, "C:/q"), a.lastInPlace(ch.id, "C:/r")], [sha("b"), sha("c"), null]);
    assert.throws(() => a.addRoundChange(999999, { place: "C:/p", base: "head", own: [] }), /no turn 999999/);
    const fork = a.forkChain(ch.id, { atTurn: 2, key: "k1-fork" });
    assert.deepEqual(a.roundChanges(fork.id), [], "a fork's own turns only: the source's stay the source's");
    a.deleteChain(ch.id);
    assert.equal(a.lastInPlace(ch.id, "C:/p"), null, "deleted with its chain");
  });
});

// (fails before: yes — HarnessV4_Git_Plan GWC-11, GWC-13: the loop snapshotted after a round alone, so what anyone else
// wrote in it was the round's; a helper's writes had no name, and a report taken between rounds waited for the next
// round's record, whose snapshot before its hands already held them)
test("the loop asks for each place as it stands before a hand or a helper writes, names each one's files, and records a delivered report's at once", async () => {
  const root = tmpdir();
  /** @type {any[]} */
  const calls = [];
  /** @type {import("../src/app/turn-tree.js").TurnTree} */
  const tree = {
    begin: async () => {},
    before: async (r, o = {}) => void calls.push(["before", r, o.paths || [], !!o.command]),
    take: async (r, o = {}) => (calls.push(["take", r, o.own || [], !!o.command, (o.writes || []).map((w) => w.by)]), { rows: [], snapshots: [], errors: [] }),
    next: () => ({}),
    waiting: () => null,
  };
  /** @type {any[]} */
  const due = [];
  const late = { text: "[sa_bg reported]", from: "sa_bg", description: "background", kind: "report", spentUsd: 0, toolCalls: 0, roundIds: [], wrote: true, writes: { by: "sa_bg", paths: [join(root, "bg.txt")] } };
  const replies = [
    [toolUse("a1", "agent", { run_in_background: false, description: "helper", prompt: "write h" })],
    [toolUse("w1", "write", { path: "x.txt", content: "x" }), toolUse("b1", "bash", { command: "make" })],
    [{ type: "text", text: "Done." }],
  ];
  let n = 0;
  let blocks = 0;
  const out = await runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "auto",
    root,
    readerModel: "",
    maxTokens: 100,
    call: async () => ({ ok: true, status: 200, json: { content: replies[n++], usage: { input_tokens: 10, output_tokens: 5 } }, id: null }),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => {
      calls.push([name]);
      if (name === "bash") due.push(late);
      return "ok";
    },
    delegateRead: null,
    subagents: {
      run: async (/** @type {any} */ o) => (calls.push(["agent", o.id]), { ok: true, text: "Wrote h.", spentUsd: 0, toolCalls: 1, roundIds: [], wrote: true, writes: { by: "sa_1", paths: [join(root, "h.txt")] }, note: "agent: sa_1 ran" }),
    },
    inbox: /** @type {any} */ ({ take: () => due.splice(0), hold: () => null, owed: () => null, back: () => {} }),
    mailbox: { read: () => [] },
    permissions: null,
    tree,
    onEvent: () => {},
    previewChars: 0,
    sink: { text() {}, thinking() {}, signThinking() {}, endBlock: () => void (blocks += 1), count: () => blocks },
    signal: null,
    resume: null,
  }));
  assert.equal(out.status, "done");
  assert.deepEqual(calls, [
    ["before", 1, [], true],
    ["agent", "a1"],
    ["take", 1, [], false, ["sa_1"]],
    ["before", 2, [join(root, "x.txt")], false],
    ["write"],
    ["before", 2, [], true],
    ["bash"],
    ["take", 2, [join(root, "x.txt")], true, []],
    ["take", 2, [], false, ["sa_bg"]],
  ]);
});

// (fails before: no — a guard: two helpers of one round start together, and the second's snapshot must not stand as
// the round's start once the first is writing)
test("a round's start in a place is taken once, whoever asks first, even when two ask at once", { skip: !hasGit && "git is not on PATH" }, async () => {
  const dir = repo("filament-b2-twice-");
  const mem = chainRecord();
  const t = createTurnTree({ memory: mem, chainId: "c8", turnId: 1, turnNo: 1, root: dir });
  await t.begin();
  const first = t.before(1, { command: true });
  const second = t.before(1, { command: true });
  await first;
  writeFileSync(join(dir, "h.txt"), "by the first helper\n");
  await second;
  await t.take(1, { writes: [{ by: "sa_1", paths: [join(dir, "h.txt")] }] });
  assert.deepEqual(named((await ownChangesOf(mem.of(1))).files), [["sa_1", "h.txt", "added", 1, 0, false]]);
});

// (fails before: yes — HarnessV4_Git_Plan GWC-37, GWC-19: the card listed the folder's whole diff with no place, and a
// turn that wrote only outside any repository had no card; then, HarnessV4_Four_Plan FO-D27, FOC-46, FOC-47: those
// files were rows among git's, and a turn that wrote only there read "1 file changed +0 −0")
test("the turn's card: its agents' own files by place, a mark where someone else changed one too, the files outside any repository counted, the way to Outputs", () => {
  const doc = stubDocument();
  try {
    const folder = "C:/w/app";
    let opened = 0;
    const onOutputs = () => void opened++;
    const card = /** @type {any} */ (
      treeCard({
        tree: {
          folder,
          totals: { files: 2, added: 3, removed: 1 },
          files: [
            { place: "C:/w/app-wt", agent: "sa_1", path: "b.js", status: "added", added: 1, removed: 0 },
            { place: folder, agent: "", path: "src/a.js", status: "modified", added: 2, removed: 1, also: true },
          ],
          during: [{ place: folder, path: "out.log" }, { place: folder, path: "out.log" }],
          outside: [{ agent: "", path: "C:/tmp/notes.txt" }, { agent: "sa_1", path: "C:/tmp/notes.txt" }],
        },
      }, { onOutputs })
    );
    assert.equal(card.querySelector(".tree-sum").textContent, "2 files changed +3 −1", "git's files alone are counted");
    assert.deepEqual(card.querySelectorAll(".tree-file").map((/** @type {any} */ r) => r.textContent), [
      "Msrc/a.jsalso changed by someone else+2−1",
      "Ab.jsin app-wt+1−0",
    ]);
    assert.equal(card.querySelector(".file-outside").textContent, "1 more written outside gitShow in Outputs", "one file, whoever wrote it");
    card.querySelector(".file-outputs").dispatch("click");
    assert.equal(opened, 1);
    assert.equal(card.querySelectorAll(".tree-note")[0].textContent, "1 more changed while its commands ran — by them or by someone else");
    const loose = /** @type {any} */ (treeCard({ tree: { folder, totals: { files: 0, added: 0, removed: 0 }, files: [], outside: [{ agent: "", path: "C:/tmp/x.txt" }] } }, { onOutputs }));
    assert.equal(loose.querySelector(".tree-sum").textContent, "1 file written outside git", "a turn that wrote only outside any repository has its card");
    assert.equal(loose.querySelector(".file-outside").textContent, "Show in Outputs");
    assert.equal(treeCard({ tree: { folder, totals: { files: 0, added: 0, removed: 0 }, files: [], outside: [] } }), null);
  } finally {
    doc.restore();
  }
});

// (fails before: yes — GW-D57: nothing marked a file the agent's commands changed, now counted as its own)
test("the turn's card marks a file its commands changed, not its edit calls (GWC-138)", () => {
  const doc = stubDocument();
  try {
    const folder = "C:/w/app";
    const card = /** @type {any} */ (
      treeCard({
        tree: {
          folder,
          totals: { files: 2, added: 5, removed: 0 },
          files: [
            { place: folder, agent: "", path: "src/a.js", status: "modified", added: 1, removed: 0 },
            { place: folder, agent: "", path: "dist/out.js", status: "added", added: 4, removed: 0, via: "command" },
          ],
          during: [],
          outside: [],
        },
      })
    );
    assert.deepEqual(card.querySelectorAll(".tree-file").map((/** @type {any} */ r) => r.textContent), ["Adist/out.jsvia a command+4−0", "Msrc/a.js+1−0"]);
    assert.match(card.querySelector(".tree-via").getAttribute("title"), /only this chat works in this folder/);
    assert.equal(
      card.querySelectorAll(".tree-note").at(-1).textContent,
      "the files this turn's agents wrote and edited, and what their commands changed where only this chat works, each net over the turn — what someone else changed meanwhile is not the turn's",
    );
  } finally {
    doc.restore();
  }
});

describe("the two admin rows against a real app", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let place;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = repo("filament-b2-app-");
    place = top(root);
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });
  /** A turn of a session in the folder. @param {string} session @param {any[]} messages */
  const askIn = async (session, messages) => {
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, messages }, { "x-filament-cwd": root, "x-session-id": session });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const id = r.headers.get("x-filament-request-id");
    return { text: text(j.content), content: j.content, id, rec: await shim.record(id) };
  };
  const ask = (content) => askIn("b2-session", [{ role: "user", content }]);
  /** A turn's record, as the route answers it. @param {any} rec @param {string} [more] */
  const turnOf = async (rec, more = "") => (await shim.api(`/api/memory/sessions/${rec.memory.chain}/changes?turn=${rec.memory.turn}${more}`)).json();
  /** A turn's files as `[path, status, added, removed]`. @param {any} rec */
  const turnFiles = async (rec) => (await turnOf(rec)).files.map((f) => [f.path, f.status, f.added, f.removed]);

  test("GET /api/runs/:id/changes lists each round's own files; the run and the turn as one change, each file once", async () => {
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("w1", "write", { path: "notes.md", content: "first\nsecond\n" })], "tool_use");
      if (round === 2) return reply([toolUse("e1", "edit", { path: "notes.md", edits: [{ oldText: "second", newText: "third" }] }), toolUse("w2", "write", { path: "sub/x.txt", content: "x\n" })], "tool_use");
      return reply([{ type: "text", text: "Done." }]);
    };
    const r = await ask("write and edit");
    assert.equal(r.text, "Done.");
    // (fails before: yes — the 10-29 speed pass: every read walked each round with git, though the files card and the
    // header read `whole` alone; the rounds now come where asked for)
    const plain = await (await shim.api(`/api/runs/${r.id}/changes`)).json();
    assert.deepEqual([plain.rounds, plain.whole.files.map((f) => f.path)], [null, ["notes.md", "sub/x.txt"]], "no round read where none is asked for");
    const ch = await (await shim.api(`/api/runs/${r.id}/changes?rounds=1`)).json();
    assert.deepEqual([ch.runId, ch.root, ch.folder], [r.id, root, place]);
    assert.deepEqual(
      ch.rounds.map((x) => [x.round, x.place, x.agent, x.base, x.files.map((f) => [f.path, f.status, f.added, f.removed])]),
      [
        [1, place, "", "round", [["notes.md", "added", 2, 0]]],
        [
          2,
          place,
          "",
          "round",
          [
            ["notes.md", "modified", 1, 1],
            ["sub/x.txt", "added", 1, 0],
          ],
        ],
      ],
      JSON.stringify(ch),
    );
    // (fails before: yes — the run had no `whole`: its files card summed the rounds, a file two rounds wrote twice)
    assert.deepEqual(
      ch.whole.files.map((f) => [f.path, f.status, f.added, f.removed]),
      [
        ["notes.md", "added", 2, 0],
        ["sub/x.txt", "added", 1, 0],
      ],
      "the run as one change: notes.md once, with its final content",
    );
    assert.deepEqual([ch.totals, ch.whole.totals, ch.whole.places], [{ files: 2, added: 3, removed: 0 }, { files: 2, added: 3, removed: 0 }, [{ place, start: "round" }]]);
    const withPatch = await (await shim.api(`/api/runs/${r.id}/changes?patch=1&path=notes.md`)).json();
    assert.deepEqual(
      withPatch.rounds.map((x) => x.files.map((f) => f.path)),
      [["notes.md"], ["notes.md"]],
    );
    assert.match(withPatch.rounds[1].files[0].patch, /-second\n\+third/);
    assert.match(withPatch.whole.files[0].patch, /\+first\n\+third/, "the file's patch as one change");
    // (fails before: yes — HarnessV4_Tasks U3, V4-D215: `?round=` was not read, so an edit card's read walked every
    // round of the run — 5–6 s each in a long run, one per card, and the page's other reads waited behind them)
    const own = await (await shim.api(`/api/runs/${r.id}/changes?patch=1&path=notes.md&round=2`)).json();
    assert.deepEqual([own.rounds.map((x) => [x.round, x.files.map((f) => f.path)]), own.whole], [[[2, ["notes.md"]]], null], "the one round asked for");
    assert.match(own.rounds[0].files[0].patch, /-second\n\+third/);
    const missing = await (await shim.api(`/api/runs/${r.id}/changes?round=7`)).json();
    assert.deepEqual([missing.rounds, missing.whole, missing.note], [[], null, "round 7 recorded no change"]);
    const elsewhere = await (await shim.api(`/api/runs/${r.id}/changes?path=${encodeURIComponent(join(tmpdir(), "nowhere.txt"))}`)).json();
    assert.match(elsewhere.note, /^the file is in no repository this run wrote in/);
    // The turn as a whole: notes.md is one added file with its final content, x.txt beside it.
    const t = await turnOf(r.rec);
    assert.deepEqual(
      t.files.map((f) => [f.agent, f.place, f.path, f.status, f.added, f.removed]),
      [
        ["", place, "notes.md", "added", 2, 0],
        ["", place, "sub/x.txt", "added", 1, 0],
      ],
      JSON.stringify(t),
    );
    assert.deepEqual([t.chainId, t.turn, t.folder, t.during, t.outside, t.errors], [r.rec.memory.chain, r.rec.memory.turn, place, [], [], []]);
    assert.match(t.tree.ref, /^refs\/filament\/snapshots\/.+-2$/, "the folder's snapshot in force at the turn, for a fork");
    // Honest empties: a turn past the end, a run that wrote nothing, unknown ids.
    const chain = r.rec.memory.chain;
    const none = await (await shim.api(`/api/memory/sessions/${chain}/changes?turn=${r.rec.memory.turn + 5}`)).json();
    assert.deepEqual([none.files, none.during, none.outside], [[], [], []]);
    assert.match(none.note, /has \d+ turn/);
    assert.equal((await shim.api(`/api/memory/sessions/${chain}/changes`)).status, 400);
    assert.equal((await shim.api(`/api/memory/sessions/nope/changes?turn=1`)).status, 404);
    assert.equal((await shim.api(`/api/runs/nope/changes`)).status, 404);
    round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("r1", "read", { path: "notes.md" })], "tool_use");
      return reply([{ type: "text", text: "Read." }]);
    };
    const r2 = await ask("just read");
    const quiet = await (await shim.api(`/api/runs/${r2.id}/changes`)).json();
    assert.equal(quiet.rounds.length, 0);
    assert.match(quiet.note, /recorded no change of its own/);
    const t2 = await turnOf(r2.rec);
    assert.equal(t2.files.length, 0);
    assert.match(t2.note, /^this turn recorded no change of its own/);
  });

  // (fails before: yes — a session's first writing turn in a folder holding work not committed yet counted that work as
  // its own, and an edit by hand between two turns as the next turn's: the turn's card, the header's +N −N and the
  // run's rounds listed files the agent never touched)
  test("a turn's changes are its own files: work not committed yet, and edits by hand, are not the turn's; the chat as one", async () => {
    writeFileSync(join(root, "wip.txt"), "mine\n");
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("d1", "write", { path: "fresh.txt", content: "new\n" })], "tool_use");
      return reply([{ type: "text", text: "Wrote." }]);
    };
    const first = await askIn("b2-dirty", [{ role: "user", content: "write fresh" }]);
    assert.equal(first.text, "Wrote.");
    assert.deepEqual(await turnFiles(first.rec), [["fresh.txt", "added", 1, 0]]);
    const rounds = await (await shim.api(`/api/runs/${first.id}/changes?rounds=1`)).json();
    assert.deepEqual(rounds.rounds.map((r) => r.files.map((f) => f.path)), [["fresh.txt"]]);
    writeFileSync(join(root, "wip.txt"), "mine\nmore of mine\n");
    round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("d2", "write", { path: "again.txt", content: "again\n" })], "tool_use");
      return reply([{ type: "text", text: "Again." }]);
    };
    const second = await askIn("b2-dirty", [{ role: "user", content: "write again" }]);
    assert.equal(second.rec.memory.chain, first.rec.memory.chain);
    assert.deepEqual(await turnFiles(second.rec), [["again.txt", "added", 1, 0]], "the edit by hand between the turns is not the second's");
    // (fails before: yes — there was no chat's view: only one turn at a time)
    const chat = await (await shim.api(`/api/memory/sessions/${first.rec.memory.chain}/changes?scope=chat`)).json();
    assert.deepEqual([chat.turn, chat.files.map((f) => [f.path, f.status])], [null, [["fresh.txt", "added"], ["again.txt", "added"]]]);
    // (fails before: yes — the Changes pane's History is new, the owner's words of 10-18)
    const listed = await (await shim.api(`/api/memory/sessions/${first.rec.memory.chain}/changes?scope=turns`)).json();
    assert.deepEqual(
      [listed.chainId, listed.turns.map((/** @type {any} */ x) => [x.files, x.outside, x.commands]), listed.turns[0].n > listed.turns[1].n],
      [first.rec.memory.chain, [[1, 0, false], [1, 0, false]], true],
      "each turn's one file, newest first",
    );
    const refused = await shim.api(`/api/memory/sessions/${first.rec.memory.chain}/changes`);
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /scope=turns for the turns that changed files/);
  });

  // (fails before: yes — the turn that answers a permission counted the folder's work not committed yet as its own: in
  // the edit mode a command asks before it runs, and the card of the turn that ran it listed every file in the folder)
  test("the turn that answers a permission: what its command changed is apart, and holds nothing from before", async () => {
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("p1", "bash", { command: `node -e "require('fs').writeFileSync('made.txt','made')"` })], "tool_use");
      return reply([{ type: "text", text: "Made." }]);
    };
    const asked = await askIn("b2-pause", [{ role: "user", content: "make it" }]);
    assert.match(asked.text, /May I run this command\?/);
    const answered = await askIn("b2-pause", [{ role: "user", content: "make it" }, { role: "assistant", content: asked.content }, { role: "user", content: "/allow" }]);
    assert.equal(answered.text, "Made.");
    const t = await turnOf(answered.rec);
    assert.deepEqual([t.files, t.during.map((d) => [d.path, d.status, d.added])], [[], [["made.txt", "added", 1]]]);
  });
});

// (fails before: yes — GW-D57: a chat alone in its folder had what its commands changed shown apart, "whose, git cannot
// tell", though no one else works there; the routes read no chat's folder)
describe("a chat alone in its folder, against a real app (GW-D57)", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** A worktree of `root`, in a folder of its own beside. @type {string} */
  let wt;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = repo("filament-gw57-");
    const beside = plain("filament-gw57-wt-");
    wt = join(beside, "wt");
    run(root, ["worktree", "add", "-q", "-b", "wt", wt]);
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root, beside], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });
  /** A turn of a session in a folder. @param {string} session @param {string} content @param {string} [cwd] */
  const askIn = async (session, content, cwd = root) => {
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, messages: [{ role: "user", content }] }, { "x-filament-cwd": cwd, "x-session-id": session });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const id = r.headers.get("x-filament-request-id");
    return { text: text(j.content), id, rec: await shim.record(id) };
  };
  /** Files as `[path, via]`, by path. @param {any[]} files */
  const vias = (files) => files.map((f) => [f.path, f.via || ""]).sort((a, b) => a[0].localeCompare(b[0]));

  test("its commands' files are its own, marked, in the run's and the turn's answers; once another chat works there, they are apart again", async () => {
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("w1", "write", { path: "src.txt", content: "a\n" })], "tool_use");
      if (round === 2) return reply([toolUse("b1", "bash", { command: `node -e "require('fs').writeFileSync('built.txt','built\\n')"` })], "tool_use");
      return reply([{ type: "text", text: "Built." }]);
    };
    const r = await askIn("gw57-one", "write and build");
    assert.equal(r.text, "Built.");
    const run = await (await shim.api(`/api/runs/${r.id}/changes`)).json();
    assert.deepEqual([vias(run.whole.files), run.whole.during], [[["built.txt", "command"], ["src.txt", ""]], []], JSON.stringify(run.whole));
    const turnOf = async () => (await shim.api(`/api/memory/sessions/${r.rec.memory.chain}/changes?turn=${r.rec.memory.turn}`)).json();
    const t = await turnOf();
    assert.deepEqual([vias(t.files), t.during], [[["built.txt", "command"], ["src.txt", ""]], []]);
    // A second chat in the folder: whose the command's file is, git cannot tell again.
    round = 0;
    brain = () => (++round === 1 ? reply([toolUse("w2", "write", { path: "other.txt", content: "b\n" })], "tool_use") : reply([{ type: "text", text: "Wrote." }]));
    assert.equal((await askIn("gw57-two", "write other")).text, "Wrote.");
    const shared = await turnOf();
    assert.deepEqual([vias(shared.files), shared.during.map((d) => d.path)], [[["src.txt", ""]], ["built.txt"]]);
  });

  // (fails before: yes — the answer's folder was the project's, its main folder: the files card said "in wt" of the
  // chat's own files)
  test("a chat in a worktree: its turn's folder is the worktree, not its project's main folder (GW-D47)", async () => {
    let round = 0;
    brain = () => (++round === 1 ? reply([toolUse("w3", "write", { path: "mine.txt", content: "m\n" })], "tool_use") : reply([{ type: "text", text: "Wrote." }]));
    const r = await askIn("gw57-wt", "write mine", wt);
    assert.equal(r.text, "Wrote.");
    const t = await (await shim.api(`/api/memory/sessions/${r.rec.memory.chain}/changes?turn=${r.rec.memory.turn}`)).json();
    assert.deepEqual([t.folder, t.files.map((f) => [f.place, f.path])], [top(wt), [[top(wt), "mine.txt"]]]);
  });
});

describe("a pause on the archive, across a restart", { skip: !hasGit && "git is not on PATH" }, () => {
  // (fails before: yes — the review of 10-31: the pause the archive keeps carried where each place stood, not what a
  // failed snapshot left to name, so the turn that answered it after a restart named none of the failed round's files)
  test("it keeps what a failed snapshot left to name: the turn that answers it after a restart names it", async () => {
    const root = repo("filament-park-restart-");
    let calls = 0;
    const up = await fakeUpstream(async () => {
      calls++;
      if (calls === 1) return reply([toolUse("w0", "write", { path: "first.txt", content: "first\n" })], "tool_use");
      if (calls === 2) return reply([toolUse("w1", "write", { path: "kept.txt", content: "kept\n" }), toolUse("c1", "bash", { command: `node -e "console.log('built')"` })], "tool_use");
      return reply([{ type: "text", text: "Built." }]);
    });
    /** @param {any} cfg */
    const configure = (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    };
    let shim = await startApp({ memory: true, configure, keep: true });
    const dataDir = shim.dataDir;
    try {
      const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
      assert.equal(s.status, 200, await s.clone().text());
      const id = String((await s.json()).id);
      /** @param {string} content */
      const turn = async (content, extra = {}) => {
        const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
        assert.equal(r.status, 200, await r.clone().text());
        return text((await r.json()).content);
      };
      run(root, ["update-ref", `refs/filament/snapshots/${id}/1-1/held`, "HEAD"]);
      assert.match(await turn("write first.txt, then kept.txt, then build"), /May I run this command\?/);
      assert.ok(/** @type {any} */ (shim.app).memory.archive.getChain(id).meta.paused.treeWaiting, "the pause on the archive carries it");
      await shim.stop();
      shim = await startApp({ memory: true, configure, dataDir, keep: true });
      assert.equal(await turn("yes", { allow: true }), "Built.");
      assert.deepEqual(/** @type {any} */ (shim.app).memory.archive.roundChanges(id).map((/** @type {any} */ r) => r.own), [["first.txt", "kept.txt"]], "round 1's file, whose snapshot failed, with the resumed round's");
    } finally {
      await shim.stop();
      await up.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // (fails before: no — a guard the review of 65293f5ae asked for: it read the resumed turn's failed snapshot as one
  // whose note replaced the paused turn's; the turn that answers a pause is a turn of its own, with its own note)
  test("what a fork's files miss, across a pause: the files before it and the resumed rounds'", async () => {
    const root = repo("filament-park-unheld-");
    let calls = 0;
    const up = await fakeUpstream(async () => {
      calls++;
      if (calls === 1) return reply([toolUse("w0", "write", { path: "zero.txt", content: "zero\n" })], "tool_use");
      if (calls === 2) return reply([{ type: "text", text: "Zero." }]);
      if (calls === 3) return reply([toolUse("w1", "write", { path: "first.txt", content: "first\n" })], "tool_use");
      if (calls === 4) return reply([toolUse("w2", "write", { path: "kept.txt", content: "kept\n" }), toolUse("c1", "bash", { command: `node -e "console.log('built')"` })], "tool_use");
      return reply([{ type: "text", text: "Built." }]);
    });
    /** @param {any} cfg */
    const configure = (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    };
    const shim = await startApp({ memory: true, configure });
    try {
      const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
      assert.equal(s.status, 200, await s.clone().text());
      const id = String((await s.json()).id);
      /** @param {string} content */
      const turn = async (content, extra = {}) => {
        const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
        assert.equal(r.status, 200, await r.clone().text());
        return text((await r.json()).content);
      };
      assert.equal(await turn("write zero.txt"), "Zero.");
      for (const r of ["2-1", "2-2", "3-1", "3-2", "3-3"]) run(root, ["update-ref", `refs/filament/snapshots/${id}/${r}/held`, "HEAD"]);
      assert.match(await turn("write first.txt, then kept.txt, then build"), /May I run this command\?/);
      assert.equal(await turn("yes", { allow: true }), "Built.");
      const tree = /** @type {any} */ (shim.app).memory.archive.treeAtTurn(id, 3);
      assert.deepEqual(
        [tree?.turn, (tree?.unheld || []).map((/** @type {any} */ u) => [u.turn, u.files])],
        [1, [[3, ["kept.txt"]], [2, ["first.txt"]]]],
        "the first turn's files, which miss the paused turn's and its answer's",
      );
    } finally {
      await shim.stop();
      await up.close();
    }
  });
});
