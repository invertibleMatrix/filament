// @ts-check
// A commit's guard against private words (scripts/privacy-check.mjs): the words come from a file outside the repository,
// a staged diff's added lines and new paths are read with their line numbers, a hit is found without regard to case,
// and installing it keeps the hooks a clone already has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addedLines, hitsIn, termsFrom, termsPath, withBlock } from "../scripts/privacy-check.mjs";

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
