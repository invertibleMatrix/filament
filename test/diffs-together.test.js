// @ts-check
// A change's files read together, each as it reads alone. A view of the session's uncommitted files asked git four or
// five times a file, one file after another — up to two hundred files, eight hundred processes — and a range's or a
// turn's patches one `git diff` a file. Now the files no rename names come from one listing and one diff, split at
// each file's `diff --git` line, and git is asked once which of the rest it tracks: each file's patch byte for byte the
// one its own call gave, and the cases a diff of many could answer otherwise asked alone.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import cp, { execFileSync } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { diffOf, diffsOf, statusOf } from "../src/adapters/git/inspect.js";
import { changesSince, diffFiles, diffPatch, withPatches } from "../src/adapters/git/changes.js";
import { git, gitProgram } from "../src/adapters/git/snapshot.js";
import { SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";
import { changesView } from "../src/app/sessions/changes-view.js";
import { fewAtOnce } from "../src/core/at-once.js";
import { removeDirs } from "./helpers/wait.js";

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

/** A git, by its file's name: `git` as the PATH names it, or the real git a launcher would start. @param {unknown} file */
const isGit = (file) => /^git(\.exe)?$/i.test(basename(String(file)));
/**
 * How many git processes `fn` starts: those `git()` starts on its pool's threads, told on their channel, and any
 * started on this thread through execFile.
 * @param {() => Promise<unknown>} fn
 */
const gitsIn = async (fn) => {
  // The git to start is found first (`gitProgram`): its own `--exec-path` is not `fn`'s.
  await gitProgram();
  const real = cp.execFile;
  let n = 0;
  /** @type {any} */ (cp).execFile = (/** @type {any[]} */ ...a) => (isGit(a[0]) && n++, /** @type {any} */ (real)(...a));
  syncBuiltinESMExports();
  const pooled = (/** @type {any} */ m) => void (m.event === "start" && isGit(m.file) && n++);
  subscribe(SPAWN_CHANNEL, pooled);
  try {
    await fn();
  } finally {
    unsubscribe(SPAWN_CHANNEL, pooled);
    /** @type {any} */ (cp).execFile = real;
    syncBuiltinESMExports();
  }
  return n;
};

/** Lines enough that a patch runs past the cap, and a few changed far apart. */
const longText = (/** @type {string} */ tag) => Array.from({ length: 3000 }, (_, i) => `${tag} line ${i}`).join("\n") + "\n";

describe("a change's files read together, each as alone", { skip: !hasGit && "needs git" }, () => {
  let dir = "";
  /** The commits the tree went through: the first, and one with many kinds of change. */
  let first = "";
  let second = "";
  before(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-diffs-")));
    run(dir, ["init", "-q", "-b", "main"]);
    run(dir, ["config", "core.autocrlf", "false"]);
    const put = (/** @type {string} */ p, /** @type {string | Buffer} */ body) => {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), body);
    };
    for (let i = 0; i < 30; i++) put(`many/m${i}.txt`, `file ${i}\nkeep\nchange me\n`);
    put("crlf.txt", "one\r\ntwo\r\nthree\r\n");
    put("blank-end.txt", "a\nb\nc\n\n");
    put("no-eol.txt", "x");
    put("sp ace.txt", "s\n");
    put("ünï 日本.txt", "u\n");
    put("bin.dat", Buffer.from([1, 0, 2, 3]));
    put("del.txt", "d\n");
    put("staged-del.txt", "sd\n");
    put("ren-old.txt", "a body long enough that a rename of it is seen as one\nline two\nline three\n");
    put("a[1].txt", "pattern\n");
    put("a1.txt", "plain\n");
    put("was-folder/inner.txt", "in\n");
    put("long.txt", longText("old"));
    run(dir, ["add", "."]);
    run(dir, ["commit", "-q", "-m", "first"]);
    first = run(dir, ["rev-parse", "HEAD"]);
    // The working tree: modified, CRLF, a last hunk ending in a blank line, no newline at the end, names git quotes,
    // binary, deleted (staged and not), renamed, a name git reads as a pattern beside one it matches, a folder become a
    // file, a new staged file, a patch past the cap, untracked text, binary and too large.
    for (let i = 0; i < 30; i++) put(`many/m${i}.txt`, `file ${i}\nkeep\nchanged ${i}\n`);
    put("crlf.txt", "one\r\nTWO\r\nthree\r\n");
    put("blank-end.txt", "A\nb\nc\n\n");
    put("no-eol.txt", "y");
    put("sp ace.txt", "S\n");
    put("ünï 日本.txt", "U\n");
    put("bin.dat", Buffer.from([1, 0, 9, 9]));
    rmSync(join(dir, "del.txt"));
    run(dir, ["rm", "-q", "staged-del.txt"]);
    run(dir, ["mv", "ren-old.txt", "ren-new.txt"]);
    put("a[1].txt", "pattern!\n");
    put("a1.txt", "plain!\n");
    run(dir, ["rm", "-q", "-r", "was-folder"]);
    put("was-folder", "now a file\n");
    run(dir, ["add", "was-folder"]);
    put("staged-add.txt", "new\n");
    run(dir, ["add", "staged-add.txt"]);
    put("long.txt", longText("new"));
    put("u1.txt", "untracked\n");
    put("u-bin.dat", Buffer.from([0, 1, 2]));
    put("u-big.txt", "z".repeat(600 * 1024));
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-q", "-m", "second"]);
    second = run(dir, ["rev-parse", "HEAD"]);
    run(dir, ["reset", "-q", "--soft", first]);
    run(dir, ["reset", "-q"]);
    // Staged again as above: the deletions, the rename, the folder become a file, the new file.
    run(dir, ["rm", "-q", "--cached", "staged-del.txt", "ren-old.txt", "was-folder/inner.txt"]);
    run(dir, ["add", "ren-new.txt", "staged-add.txt", "was-folder"]);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  // (fails before: no — the same patches; it pins them, each against its own call)
  test("each uncommitted file's diff is the one its own call reads, byte for byte", async () => {
    const st = await statusOf(dir);
    const files = (st.files || []).map((f) => ({ path: f.path, oldPath: f.oldPath, untracked: f.kind === "untracked" }));
    assert.ok(files.length > 40, `${files.length} files`);
    const together = await diffsOf(dir, files);
    // Each file's own call, a few at once: one after another, their two hundred git processes ran past the test's two
    // minutes under a full suite's load (7.5 s idle), and what went on reading after it was cut was counted by the test
    // after it.
    const alone = await fewAtOnce(files, (f) => diffOf(dir, f.path, { oldPath: f.oldPath }));
    for (const [i, f] of files.entries()) assert.deepEqual(together[i], alone[i], f.path);
    const named = new Map(together.map((d) => [d.path, d]));
    assert.match(String(named.get("ren-new.txt")?.patch), /rename from ren-old\.txt/, "a rename read as one");
    assert.match(String(named.get("ünï 日本.txt")?.patch), /^diff --git "a\/\\303\\274/, "a name git quotes");
    assert.ok(named.get("long.txt")?.truncated, "clipped at the cap");
    assert.ok(named.get("bin.dat")?.binary && named.get("u-bin.dat")?.binary);
    assert.equal(named.get("blank-end.txt")?.patch.endsWith("\n c"), true, "trimmed as git's answer for it alone");
  });

  // (fails before: yes — 4 or 5 git processes a file: over two hundred here)
  test("a view of the uncommitted files asks git a few times, not a few times a file", async () => {
    /** @type {any} */
    let view = null;
    const gits = await gitsIn(async () => {
      view = await changesView({ source: "uncommitted", folder: dir, turn: 0, rounds: null });
    });
    assert.ok(view.files > 40 && view.text.includes("diff --git a/many/m29.txt b/many/m29.txt"));
    assert.ok(gits > 0 && gits <= 24, `${gits} git processes for ${view.files} files`);
  });

  // (fails before: no — the same patches; it pins them) Between two commits and from a commit to the working tree.
  test("each changed file's patch between two commits, and since one, is the one its own diff gives", async () => {
    for (const [from, to] of /** @type {[string, string | null][]} */ ([[first, second], [first, null]])) {
      const d = await diffFiles(dir, from, to);
      assert.ok(d.ok && d.files.length > 40);
      const together = await withPatches(dir, from, to, d.files, 2000);
      // Each file's own diff, a few at once, as the test before reads each file's own call.
      const alone = await fewAtOnce(d.files, (f) => (f.binary ? Promise.resolve(null) : diffPatch(dir, from, to, f.oldPath ? [f.oldPath, f.path] : f.path, { maxLines: 2000 })));
      for (const [i, f] of d.files.entries()) {
        if (f.binary) continue;
        assert.deepEqual({ patch: together[i].patch, truncated: together[i].truncated, lines: together[i].lines }, alone[i], `${to ? "commits" : "since"}: ${f.path}`);
      }
    }
    // A file that was a folder, asked without the folder's file (a turn's files less an agent's own): a diff of it
    // alone shows the folder's file going too, and so does its patch here.
    const d = await diffFiles(dir, first, second);
    const got = await withPatches(dir, first, second, d.files.filter((f) => f.path !== "was-folder/inner.txt"), 2000);
    const was = got.find((f) => f.path === "was-folder");
    assert.equal(was?.patch, (await diffPatch(dir, first, second, "was-folder", { maxLines: 2000 })).patch);
    assert.match(String(was?.patch), /diff --git a\/was-folder\/inner\.txt/);
  });

  // (fails before: yes — one git diff a file)
  test("a range's patches come from one diff, not one a file", async () => {
    /** @type {any} */
    let since = null;
    const gits = await gitsIn(async () => {
      since = await changesSince(dir, first, { patch: true });
    });
    assert.ok(since.ok && since.files.length > 40);
    assert.ok(gits > 0 && gits <= 16, `${gits} git processes for ${since.files.length} files`);
  });

  // (fails before: yes — the bug hunt of 10-30, GIT-4: git's answer past what one call says, 8 MB, was taken for a
  // failure, and the file's patch read as no change: empty, not cut)
  test("a patch past what one git call says is cut there and said cut, never read as no change", async () => {
    const big = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-diffs-big-")));
    try {
      run(big, ["init", "-q", "-b", "main"]);
      run(big, ["config", "core.autocrlf", "false"]);
      writeFileSync(join(big, "big.txt"), "start\n");
      writeFileSync(join(big, "small.txt"), "s\n");
      run(big, ["add", "."]);
      run(big, ["commit", "-q", "-m", "first"]);
      // Some 11 MB of patch.
      writeFileSync(join(big, "big.txt"), Array.from({ length: 160_000 }, (_, i) => `line ${i} ${"x".repeat(60)}`).join("\n") + "\n");
      writeFileSync(join(big, "small.txt"), "s\nt\n");
      const r = await git(["diff-index", "-p", "HEAD", "--", "big.txt"], { cwd: big });
      assert.deepEqual([r.code, r.cut, /timed out/.test(String(r.error))], [-1, true, false], "cut where it ran past, no timeout");
      const p = await diffPatch(big, "HEAD", null, "big.txt");
      assert.deepEqual([p.truncated, p.lines, p.patch.split("\n").length], [true, 0, 2000], "clipped as any long patch is; its whole count not known");
      assert.match(p.patch, /^diff --git a\/big\.txt b\/big\.txt\n/);
      const [b, s] = await diffsOf(big, [{ path: "big.txt" }, { path: "small.txt" }]);
      assert.deepEqual([b.truncated, b.patch === p.patch], [true, true]);
      assert.deepEqual([s.truncated, s.patch.endsWith("\n+t")], [false, true], "the file beside it, as it reads alone");
      assert.deepEqual(await diffOf(big, "big.txt"), b);
    } finally {
      // On Windows the git a cut stopped may stand in the folder a moment longer.
      await removeDirs(big);
    }
  });
});
