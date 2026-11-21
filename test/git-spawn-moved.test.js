// @ts-check
// The git calls that read bytes, or ran per key typed, start on the spawn pool's threads too (`adapters/git/
// spawn-pool.js`): a sub-agent's work read as bytes (`gitBytes`, worktree.js), a rewind's two reads a file
// (`catFile`, rewind.js — a few hundred starts on the server's thread for a big rewind), and the name search's
// `git ls-files` (workspace.js). What each answers is what it answered on the server's thread, byte for byte. Every
// repository here is a throwaway under the temp folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gitProgram } from "../src/adapters/git/snapshot.js";
import { changedFiles, diffTaskWork } from "../src/adapters/git/worktree.js";
import { putBack } from "../src/app/sessions/rewind.js";
import { searchNames } from "../src/adapters/tools/workspace.js";
import { SPAWN_CHANNEL } from "../src/adapters/git/spawn-pool.js";

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
const skip = !hasGit && "git is not on PATH";
/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const raw = (cwd, args) => execFileSync("git", args, { cwd, env: ENV, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => raw(cwd, args).toString("utf8").trim();
/** Bytes no text decoding keeps whole: a NUL, a lone continuation byte, an 0xFF. */
const BINARY = Buffer.from([0, 1, 2, 0x80, 0xff, 0xfe, 10, 13, 10]);

/** A repository with two commits: the first, and one that changes, adds and removes files of every kind. */
const repo = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-moved-")));
  made.push(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  run(dir, ["config", "core.autocrlf", "false"]);
  writeFileSync(join(dir, "text.txt"), "one\ntwo\n");
  writeFileSync(join(dir, "ünï 日本.txt"), "ünïcode\n");
  writeFileSync(join(dir, "bin.dat"), BINARY);
  writeFileSync(join(dir, "gone.txt"), "gone\n");
  run(dir, ["add", "-A"]);
  run(dir, ["commit", "-qm", "first"]);
  const first = run(dir, ["rev-parse", "HEAD"]);
  writeFileSync(join(dir, "text.txt"), "one\nTWO\nthree\n");
  writeFileSync(join(dir, "ünï 日本.txt"), "ünïcode 日本\n");
  writeFileSync(join(dir, "bin.dat"), Buffer.concat([BINARY, BINARY]));
  rmSync(join(dir, "gone.txt"));
  writeFileSync(join(dir, "new.txt"), "new\n");
  run(dir, ["add", "-A"]);
  run(dir, ["commit", "-qm", "second"]);
  return { dir, first, second: run(dir, ["rev-parse", "HEAD"]) };
};

/** A git, by its file's name: `git` as the PATH names it, or the real git a launcher would start (`gitProgram`). @param {unknown} file */
const isGit = (file) => /^git(\.exe)?$/i.test(basename(String(file)));
/**
 * What `fn` gives, the git processes it started on this thread, and those it started on the pool's threads.
 * @template T @param {import("node:test").TestContext} t @param {() => Promise<T>} fn
 */
const where = async (t, fn) => {
  // The git to start is found before `fn` runs: its own `--exec-path` is not `fn`'s.
  await gitProgram();
  const execFile = t.mock.method(childProcess, "execFile");
  const spawn = t.mock.method(childProcess, "spawn");
  syncBuiltinESMExports();
  /** @type {string[]} */
  const pooled = [];
  /** The programs those were: git as `gitProgram` finds it, each. @type {Set<string>} */
  const programs = new Set();
  const on = (/** @type {any} */ m) => {
    if (m.event !== "start" || !isGit(m.file)) return;
    programs.add(String(m.file));
    pooled.push(m.args.find((/** @type {string} */ a, /** @type {number} */ i, /** @type {string[]} */ all) => a !== "-c" && all[i - 1] !== "-c"));
  };
  subscribe(SPAWN_CHANNEL, on);
  try {
    const value = await fn();
    const here = [...execFile.mock.calls, ...spawn.mock.calls].filter((c) => isGit(/** @type {any} */ (c.arguments)[0])).length;
    // (fails before: yes — the review of 11-03: the rewind's and the search's gits were the PATH's, Git for Windows'
    // launcher, whose stop or timeout left the real git running)
    assert.deepEqual([...programs], [(await gitProgram()).file], "each git is the one gitProgram finds");
    return { value, here, pooled };
  } finally {
    unsubscribe(SPAWN_CHANNEL, on);
    execFile.mock.restore();
    spawn.mock.restore();
    syncBuiltinESMExports();
  }
};

// (fails before: yes — gitBytes started each git on the server's thread)
test("a sub-agent's work read as bytes starts its gits on the pool's threads, and reads what git says byte for byte", { skip }, async (t) => {
  const { dir, first, second } = repo();
  const files = await where(t, () => changedFiles(dir, first, second));
  assert.deepEqual([files.here, files.pooled], [0, ["diff", "diff"]]);
  assert.deepEqual(
    files.value.map((f) => [f.path, f.status, f.added, f.removed, f.binary]),
    [
      ["bin.dat", "M", 0, 0, true],
      ["gone.txt", "D", 0, 1, false],
      ["new.txt", "A", 1, 0, false],
      ["text.txt", "M", 2, 1, false],
      ["ünï 日本.txt", "M", 1, 1, false],
    ],
  );
  const diff = await where(t, () => diffTaskWork(dir, first, second));
  assert.deepEqual([diff.here, diff.pooled], [0, ["diff"]]);
  assert.equal(diff.value, raw(dir, ["-c", "core.fsmonitor=false", "diff", "--no-renames", "--no-color", "--no-ext-diff", first, second]).toString("utf8"));
});

// (fails before: yes — a rewind read each file twice through git cat-file on the server's thread)
test("a rewind reads each file's bytes on the pool's threads, and puts back what the commit holds byte for byte", { skip }, async (t) => {
  const { dir, first } = repo();
  const paths = ["text.txt", "ünï 日本.txt", "bin.dat"];
  const plan = {
    files: paths.map((path) => ({ place: dir, path, oldPath: null, from: first, kind: /** @type {const} */ ("changed"), also: false, paths: [path] })),
    left: [],
    outside: [],
    cannot: [],
    errors: [],
  };
  const r = await where(t, () => putBack(plan, { name: "moved/1" }));
  assert.equal(r.value.ok, true, JSON.stringify(r.value));
  assert.equal(r.here, 0, "no git started on this thread");
  assert.equal(r.pooled.filter((c) => c === "cat-file").length, 2 * paths.length, "two reads a file, on the pool");
  for (const path of paths) assert.deepEqual(readFileSync(join(dir, path)), raw(dir, ["cat-file", "blob", `${first}:${path}`]), path);
});

// (fails before: yes — the search's git ls-files started on the server's thread at each key typed)
test("the name search lists a repository's files with a git started on the pool's threads", { skip }, async (t) => {
  const { dir } = repo();
  const r = await where(t, () => searchNames(dir, ""));
  assert.deepEqual([r.here, r.pooled], [0, ["ls-files"]]);
  assert.deepEqual(r.value.files.map((f) => f.path).sort(), ["bin.dat", "new.txt", "text.txt", "ünï 日本.txt"]);
});
