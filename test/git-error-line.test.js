// @ts-check
// What git said of a failure, in one line (src/adapters/git/snapshot.js `firstLine`). Git prints its warnings before
// the error that stopped it — on Windows a line-ending warning for each file it touched — and every reader under
// src/adapters/git took the first line of what it said, each with a copy of the idiom: a note said "LF will be replaced
// by CRLF the next time Git touches it" where git had said why it failed. The one function says the first line that is
// neither a warning nor a hint of git's, else the first.
// The repository here is a throwaway under the temp folder — never this one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { firstLine, refusedWords, snapshotTree } from "../src/adapters/git/snapshot.js";
import { removeDirs } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
const hasGit = spawnSync("git", ["--version"], { stdio: "ignore", windowsHide: true }).status === 0;
/** @type {string[]} */
const roots = [];
after(() => removeDirs(...roots));

const CRLF = "warning: in the working copy of 'a.txt', LF will be replaced by CRLF the next time Git touches it";

// (fails before: yes — "git refuses the repository this folder is in: warning: in the working copy of 'a.txt', LF will
// be replaced by CRLF the next time Git touches it")
test("git's words where it refuses a repository are its error, not the warning it said first", () => {
  const said = refusedWords({ code: 128, out: "", err: `${CRLF}\nfatal: detected dubious ownership in repository at 'C:/work/app'\nTo add an exception for this directory, call:` });
  assert.equal(said, "git refuses the repository this folder is in: fatal: detected dubious ownership in repository at 'C:/work/app'");
});

// (fails before: yes — the module had no such export: its `clipLine`, and each file's own `firstLine`, said the first line)
test("the line that says why: the first that is neither a warning nor a hint of git's, else the first; 200 characters of it", () => {
  assert.equal(firstLine(`${CRLF}\r\n${CRLF}\r\nerror: open("deep/file.txt"): Filename too long\r\nerror: unable to index file 'deep/file.txt'\r\nfatal: adding files failed`), 'error: open("deep/file.txt"): Filename too long', "the error after the warnings, CRLF line ends or not");
  assert.equal(firstLine(`hint: use --force\nfatal: 'x' already exists`), "fatal: 'x' already exists");
  assert.equal(firstLine(`${CRLF}\nhint: see git help\n\nCONFLICT (content): Merge conflict in a.txt\nmore`), "CONFLICT (content): Merge conflict in a.txt", "a line of no mark of git's is one that says why");
  // What a program git ran said of itself comes before git's own last word, and is the one said.
  assert.equal(firstLine("no-such-git-lfs filter-process: line 1: no-such-git-lfs: command not found\nfatal: the remote end hung up unexpectedly"), "no-such-git-lfs filter-process: line 1: no-such-git-lfs: command not found");
  assert.equal(firstLine(`${CRLF}\n\n`), CRLF, "warnings alone: the first");
  assert.equal(firstLine("EPERM: operation not permitted, rename 'a' -> 'b'"), "EPERM: operation not permitted, rename 'a' -> 'b'", "a line of anything else is said as it is");
  assert.equal(firstLine(`a warning: in the middle of a line\nfatal: later`), "a warning: in the middle of a line", "a warning is one by how its line begins");
  assert.equal(firstLine(`fatal: ${"x".repeat(300)}`).length, 200);
  assert.deepEqual([firstLine(""), firstLine(null), firstLine(undefined)], ["", "", ""]);
});

// (fails before: yes — "git add failed: warning: in the working copy of 'a.txt', LF will be replaced by CRLF the next
// time Git touches it")
test("a snapshot git could not add a file to, after a line-ending warning for another: the note says git's error", { skip: !hasGit && "git is not on PATH" }, async (t) => {
  if (process.platform !== "win32" && process.getuid?.() === 0) return t.skip("root reads every file: nothing here stops git");
  const dir = mkdtempSync(join(tmpdir(), "filament-git-error-line-"));
  roots.push(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  run(dir, ["config", "core.autocrlf", "true"]);
  run(dir, ["config", "core.safecrlf", "warn"]);
  run(dir, ["config", "core.longpaths", "false"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  run(dir, ["-c", "core.safecrlf=false", "add", "."]);
  run(dir, ["commit", "-q", "-m", "init"]);
  // A file git warns of (LF, where it would write CRLF), and one it cannot read: on Windows a path past the length git
  // takes, elsewhere a file nobody may read.
  writeFileSync(join(dir, "a.txt"), "two\n");
  if (process.platform === "win32") {
    // The folder's own path git still opens; the file's in it is past the 260 characters.
    const deep = join(dir, "d".repeat(Math.max(1, 200 - dir.length)));
    mkdirSync(deep);
    writeFileSync(join(deep, `${"f".repeat(100)}.txt`), "deep\n");
  } else {
    writeFileSync(join(dir, "z.txt"), "unread\n");
    chmodSync(join(dir, "z.txt"), 0o000);
  }
  // What git itself says of it, into an index of the test's own: the warning first, then why it failed.
  const own = spawnSync("git", ["add", "-A"], { cwd: dir, encoding: "utf8", windowsHide: true, env: { ...GIT_ENV, GIT_INDEX_FILE: join(dir, ".git", "index-of-the-test") } });
  const lines = String(own.stderr).split(/\r?\n/).filter(Boolean);
  if (own.status === 0 || !/^warning: /.test(lines[0] || "") || !lines.some((l) => /^(error|fatal): /.test(l))) return t.skip(`this git said no warning before its error: ${lines[0] || `exit ${own.status}`}`);
  const s = await snapshotTree(dir, { name: "said", keep: false });
  assert.equal(s.ok, false);
  assert.equal(s.error, `git add failed: ${lines.find((l) => !/^(warning|hint): /.test(l))?.slice(0, 200)}`);
  assert.match(String(s.error), /^git add failed: (error|fatal): /);
});

// (fails before: yes — eleven files defined a first line of their own, and send.js three more in place)
test("no file under src/adapters/git takes the first line of what git said by itself: each asks the one function", () => {
  const folder = fileURLToPath(new URL("../src/adapters/git/", import.meta.url));
  /** @type {string[]} */
  const own = [];
  for (const name of readdirSync(folder).filter((n) => n.endsWith(".js"))) {
    readFileSync(join(folder, name), "utf8")
      .split("\n")
      .forEach((line, i) => {
        // An error's words, or a function's argument, cut at its first line end.
        const cuts = /\b(err|error|message)\b[^;]*\.split\(\/\\r\?\\n\/\)\[0\]/.test(line) || /=> String\(\w+ \|\| ""\)\.split\(\/\\r\?\\n\/\)\[0\]/.test(line);
        if (cuts) own.push(`${name}:${i + 1}`);
      });
  }
  assert.deepEqual(own, []);
});
