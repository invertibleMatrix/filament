// @ts-check
// A commit's guard against private words (scripts/privacy-check.mjs): the words come from a file outside the repository,
// a staged diff's added lines and new paths are read with their line numbers, a hit is found without regard to case,
// and installing it keeps the hooks a clone already has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { addedLines, blockedPushes, hitsIn, termsFrom, termsPath, withBlock } from "../scripts/privacy-check.mjs";

test("the terms: one per line, blank lines and comments left out", () => {
  assert.deepEqual(termsFrom("# who\nAcme Corp\n\n  box-7  \r\n#x\n"), ["Acme Corp", "box-7"]);
  assert.deepEqual(termsFrom(""), []);
  assert.equal(termsPath({ FILAMENT_PRIVATE_TERMS: "/k/terms" }), "/k/terms");
  assert.match(termsPath({}), /\.filament-private-terms$/);
});

test("a staged diff: its added lines with their numbers, a new path as a line of its own, removed lines never", () => {
  const diff = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -3,2 +3,3 @@",
    "-old words",
    "+new words",
    "+more words",
    "@@ -10 +11,0 @@",
    "-gone",
    "diff --git a/notes/box-7.md b/notes/box-7.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/notes/box-7.md",
    "@@ -0,0 +1 @@",
    "+hello",
    "diff --git a/old.md b/old.md",
    "deleted file mode 100644",
    "--- a/old.md",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-Acme Corp was here",
  ].join("\n");
  assert.deepEqual(addedLines(diff), [
    { file: "src/a.js", line: 0, text: "src/a.js" },
    { file: "src/a.js", line: 3, text: "new words" },
    { file: "src/a.js", line: 4, text: "more words" },
    { file: "notes/box-7.md", line: 0, text: "notes/box-7.md" },
    { file: "notes/box-7.md", line: 1, text: "hello" },
  ]);
});

test("hits: any case, each term on each line, nothing where none is held", () => {
  const lines = [{ file: "a.js", line: 2, text: "Made at ACME CORP on Box-7" }, { file: "b.js", line: 9, text: "clean" }];
  assert.deepEqual(hitsIn(lines, ["acme corp", "box-7"]), [{ file: "a.js", line: 2, term: "acme corp" }, { file: "a.js", line: 2, term: "box-7" }]);
  assert.deepEqual(hitsIn(lines, []), []);
});

test("a push: a ref whose commits descend from a blocked root stops, one on another history and a deletion pass", () => {
  const roots = { a1: ["old0"], b2: ["new0"], c3: ["new0", "OLD0"] };
  const rootsOf = (/** @type {string} */ sha) => roots[/** @type {keyof typeof roots} */ (sha)] || [];
  const stdin = [
    "refs/heads/main b2 refs/heads/main 0000000000000000000000000000000000000000",
    "refs/heads/old a1 refs/heads/old 0000000000000000000000000000000000000000",
    "refs/heads/merged c3 refs/heads/merged 0000000000000000000000000000000000000000",
    "(delete) 0000000000000000000000000000000000000000 refs/heads/gone e4",
    "",
  ].join("\n");
  assert.deepEqual(blockedPushes(stdin, rootsOf, ["old0\n", ""]), [{ ref: "refs/heads/old", root: "old0" }, { ref: "refs/heads/merged", root: "OLD0" }]);
  assert.deepEqual(blockedPushes(stdin, rootsOf, []), [], "no blocked root set: nothing stops");
});

test("--push reads the clone's blocked roots and its history, and exits 1 only for a ref from the private history", () => {
  const dir = mkdtempSync(join(tmpdir(), "privacy-push-"));
  const script = resolve("scripts/privacy-check.mjs");
  const git = (/** @type {string[]} */ args) => execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
  try {
    git(["init", "-q", "-b", "old"]);
    git(["commit", "-q", "--allow-empty", "--no-verify", "-m", "old root"]);
    git(["commit", "-q", "--allow-empty", "--no-verify", "-m", "old work"]);
    const oldRoot = git(["rev-list", "--max-parents=0", "old"]);
    const oldTip = git(["rev-parse", "old"]);
    git(["checkout", "-q", "--orphan", "public"]);
    git(["commit", "-q", "--allow-empty", "--no-verify", "-m", "public root"]);
    const publicTip = git(["rev-parse", "public"]);
    const push = (/** @type {string} */ sha) =>
      spawnSync(process.execPath, [script, "--push"], { cwd: dir, input: `refs/heads/x ${sha} refs/heads/x ${"0".repeat(40)}\n`, encoding: "utf8" });
    assert.equal(push(oldTip).status, 0, "no blocked root configured: the push goes");
    git(["config", "--add", "privacy.blockedRoot", oldRoot]);
    const stopped = push(oldTip);
    assert.equal(stopped.status, 1);
    assert.match(stopped.stderr, new RegExp(`refs/heads/x descends from ${oldRoot.slice(0, 12)}`));
    assert.equal(push(publicTip).status, 0, "a commit on the public history goes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install keeps a hook's own lines and replaces only its block", () => {
  const dir = mkdtempSync(join(tmpdir(), "privacy-"));
  try {
    const file = join(dir, "post-commit");
    writeFileSync(file, "#!/bin/sh\n# BEGIN Other tool\necho other\n# END Other tool\n");
    const once = withBlock(file, "--staged");
    assert.match(once, /^#!\/bin\/sh\n# BEGIN Other tool\necho other\n# END Other tool\n# BEGIN Filament privacy check\n/);
    writeFileSync(file, once);
    const twice = withBlock(file, "--staged");
    assert.equal(twice, once, "a second install changes nothing");
    assert.equal(twice.match(/BEGIN Filament privacy check/g)?.length, 1);
    assert.match(withBlock(join(dir, "none"), '--message "$1"'), /^#!\/bin\/sh\n# BEGIN Filament privacy check\n[\s\S]*--message "\$1" \|\| exit 1/);
    assert.equal(readFileSync(file, "utf8"), once);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
