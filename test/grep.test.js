// @ts-check
// HarnessV3-Tools TL4 (TL-D8): grep shows matching lines with the context asked for, or the files that match, or
// each file's count; sorted by path, paths relative to the task folder, paged with offset — the same from ripgrep
// and from the walker that stands in where there is none. rg's own words reach the model when it refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand as runHandRaw, HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { removeDirs, until } from "./helpers/wait.js";
import { searchHits } from "../src/ui/harness/conversation/tools/render.js";

/** hands.js is untyped JS: its options are real, the inferred signature just does not know them. @type {(name: string, input: any, o: any) => Promise<string>} */
const runHand = /** @type {any} */ (runHandRaw);
const root = mkdtempSync(join(tmpdir(), "filament-grep-"));
test.after(() => removeDirs(root));
/** @param {string} rel @param {string} text */
const put = (rel, text) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};
put("src/a.js", "alpha\nbeta one\ngamma\ndelta\nbeta two\n");
put("src/sub/b.ts", "x\r\nbeta crlf\r\ny\r\n");
put("docs/n.md", "beta in docs\n");
put("Z.txt", "beta upper\n");
put(".hidden/h.js", "beta hidden\n");
put("ml/m.txt", "start {\n  body\n}\nstart {\n}\nend\n");

/** Both searches: ripgrep, and the walker that runs where there is no rg. */
const ENGINES = /** @type {const} */ ([["rg", false], ["walker", true]]);
/** @param {boolean} noRg */
const grepWith = (noRg) => (/** @type {any} */ input, /** @type {any} */ o = {}) => runHand("grep", input, { root, noRg, ...o });

for (const [engine, noRg] of ENGINES) {
  const grep = grepWith(noRg);

  // (fails before: rg printed absolute paths in its own order, the walker paths below the folder searched, trimmed)
  test(`${engine}: matching lines sorted by path, relative to the task folder, as the file has them; hidden files skipped unless named`, async () => {
    assert.equal(await grep({ pattern: "beta" }), "Z.txt:1:beta upper\ndocs/n.md:1:beta in docs\nsrc/a.js:2:beta one\nsrc/a.js:5:beta two\nsrc/sub/b.ts:2:beta crlf");
    assert.equal(await grep({ pattern: "beta", path: "src/a.js" }), "src/a.js:2:beta one\nsrc/a.js:5:beta two", "one file searched still names it");
    assert.equal(await grep({ pattern: "  body", path: "ml" }), "ml/m.txt:2:  body", "the line as the file has it, indentation and all");
    assert.equal(await grep({ pattern: "beta", path: ".hidden" }), ".hidden/h.js:1:beta hidden");
  });

  // (fails before: there was no output mode)
  test(`${engine}: output files and count, paged with offset`, async () => {
    assert.equal(await grep({ pattern: "beta", output: "files" }), "Z.txt\ndocs/n.md\nsrc/a.js\nsrc/sub/b.ts");
    assert.equal(await grep({ pattern: "beta", output: "count" }), "Z.txt:1\ndocs/n.md:1\nsrc/a.js:2\nsrc/sub/b.ts:1\n[5 matching lines in 4 files]");
    assert.equal(await grep({ pattern: "beta", output: "files", limit: 2 }), "Z.txt\ndocs/n.md\n[Files 1-2 shown; there are more. Use offset=2 to continue, or narrow the pattern or the path.]");
    assert.equal(await grep({ pattern: "beta", output: "files", limit: 2, offset: 2 }), "src/a.js\nsrc/sub/b.ts");
    assert.equal(await grep({ pattern: "beta", output: "count", limit: 1, offset: 2 }), "src/a.js:2\n[Files 3-3 shown; there are more. Use offset=3 to continue, or narrow the pattern or the path.]");
    assert.equal(await grep({ pattern: "beta", output: "files", offset: 9 }), "[4 files in all; offset 9 is past the end.]");
    await assert.rejects(() => grep({ pattern: "beta", output: "lines" }), /output is content, files or count — not lines/);
  });

  // (fails before: no context)
  test(`${engine}: context around each match as path-line-text, groups apart with --, neighbours joined`, async () => {
    assert.equal(
      await grep({ pattern: "beta", context: 1 }),
      "Z.txt:1:beta upper\n--\ndocs/n.md:1:beta in docs\n--\nsrc/a.js-1-alpha\nsrc/a.js:2:beta one\nsrc/a.js-3-gamma\nsrc/a.js-4-delta\nsrc/a.js:5:beta two\n--\nsrc/sub/b.ts-1-x\nsrc/sub/b.ts:2:beta crlf\nsrc/sub/b.ts-3-y",
    );
    assert.equal(await grep({ pattern: "beta", path: "src/a.js", after: 1 }), "src/a.js:2:beta one\nsrc/a.js-3-gamma\n--\nsrc/a.js:5:beta two");
    assert.equal(await grep({ pattern: "beta", path: "src/a.js", context: 2, before: 0 }), "src/a.js:2:beta one\nsrc/a.js-3-gamma\nsrc/a.js-4-delta\nsrc/a.js:5:beta two", "before overrides context's side");
    assert.equal(await grep({ pattern: "beta", output: "files", context: 3 }), "Z.txt\ndocs/n.md\nsrc/a.js\nsrc/sub/b.ts", "context is content's alone");
    put("ctx/far.txt", [...Array.from({ length: 60 }, (_, i) => `b${i + 1}`), "mid", ...Array.from({ length: 60 }, (_, i) => `a${i + 1}`)].join("\n"));
    const wide = (await grep({ pattern: "mid", path: "ctx", context: 999 })).split("\n");
    assert.deepEqual([wide.length, wide[0], wide.at(-1)], [101, "ctx/far.txt-11-b11", "ctx/far.txt-111-a50"], "at most 50 lines on each side");
  });

  // (fails before: no offset — past the limit the model could only narrow)
  test(`${engine}: offset pages the matches; a match outside the page shows as context inside its window`, async () => {
    assert.equal(await grep({ pattern: "beta", limit: 2 }), "Z.txt:1:beta upper\ndocs/n.md:1:beta in docs\n[Matches 1-2 shown; there are more. Use offset=2 to continue, or narrow the pattern or the path.]");
    assert.equal(await grep({ pattern: "beta", limit: 2, offset: 2 }), "src/a.js:2:beta one\nsrc/a.js:5:beta two\n[Matches 3-4 shown; there are more. Use offset=4 to continue, or narrow the pattern or the path.]");
    assert.equal(await grep({ pattern: "beta", limit: 2, offset: 4 }), "src/sub/b.ts:2:beta crlf");
    assert.equal(await grep({ pattern: "beta", offset: 5 }), "[5 matches in all; offset 5 is past the end.]");
    assert.equal(
      await grep({ pattern: "beta", limit: 1, offset: 3, context: 3 }),
      "src/a.js-2-beta one\nsrc/a.js-3-gamma\nsrc/a.js-4-delta\nsrc/a.js:5:beta two\n[Matches 4-4 shown; there are more. Use offset=4 to continue, or narrow the pattern or the path.]",
    );
  });

  // (fails before: no multiline)
  test(`${engine}: multiline lets a match span lines; each match is one entry, even where rg joins neighbours`, async () => {
    const pattern = "start \\{.*?\\}";
    assert.equal(await grep({ pattern, path: "ml" }), "(no matches)", "without it a match stays on its line");
    assert.equal(await grep({ pattern, path: "ml", multiline: true }), "ml/m.txt:1:start {\nml/m.txt:2:  body\nml/m.txt:3:}\nml/m.txt:4:start {\nml/m.txt:5:}");
    assert.equal(await grep({ pattern, path: "ml", multiline: true, limit: 1 }), "ml/m.txt:1:start {\nml/m.txt:2:  body\nml/m.txt:3:}\n[Matches 1-1 shown; there are more. Use offset=1 to continue, or narrow the pattern or the path.]");
    assert.equal(await grep({ pattern, path: "ml", multiline: true, offset: 1 }), "ml/m.txt:4:start {\nml/m.txt:5:}");
    put("mlcr/w.txt", "open (\r\n  inner\r\n)\r\nrest\r\n");
    assert.equal(await grep({ pattern: "open \\(.*?\\)", path: "mlcr", multiline: true }), "mlcr/w.txt:1:open (\nmlcr/w.txt:2:  inner\nmlcr/w.txt:3:)", "a match across CRLF lines shows the lines without their CR");
  });

  test(`${engine}: a cut at the budget continues with offset exactly where it stopped`, async () => {
    put("wide/m.txt", Array.from({ length: 90 }, (_, i) => `hit ${i} ${"g".repeat(450)}`).join("\n"));
    const first = await grep({ pattern: "hit", path: "wide" }, { maxBytes: 8000 });
    const shown = Number(/\n\[Matches 1-(\d+) shown — past this result's budget\. Use offset=(\d+) to continue/.exec(first)?.[1]);
    assert.ok(shown > 3 && shown < 90, first.slice(-200));
    assert.ok((await grep({ pattern: "hit", path: "wide", offset: shown }, { maxBytes: 8000 })).startsWith(`wide/m.txt:${shown + 1}:hit ${shown} g`));
    put("wide/ctx.txt", [...Array.from({ length: 50 }, () => "c".repeat(480)), "the one", ...Array.from({ length: 50 }, () => "c".repeat(480))].join("\n"));
    assert.match(await grep({ pattern: "the one", path: "wide/ctx.txt", context: 50 }, { maxBytes: 8000 }), /\n\[The first match's context alone is past this result's budget: ask for fewer lines around it\.\]$/);
  });

  // (fails before: a search stopped at its timeout returned what it had, as if that were all)
  test(`${engine}: a search stopped at its time says so`, async () => {
    assert.match(await grep({ pattern: "beta" }, { grepTimeoutMs: 0 }), /\n\[The search stopped after 0 ms; what it found by then is shown\. Narrow the pattern or the path\.\]$/);
  });
}

// (fails before: yes — the walk ran on the proxy's own thread: a pattern that backtracks without end on one line held
// every timer and request for seconds, and the search's time was looked at only between files)
test("walker: a pattern that backtracks without end is stopped at the search's time, with what it found; the proxy's thread stays free", async () => {
  put("slow/a.txt", "aaa\n");
  put("slow/b.txt", `${"a".repeat(29)}b\n`);
  let last = Date.now();
  let worst = 0;
  const tick = setInterval(() => {
    worst = Math.max(worst, Date.now() - last);
    last = Date.now();
  }, 20);
  const t0 = Date.now();
  try {
    const out = await grepWith(true)({ pattern: "(a+)+$", path: "slow" }, { grepTimeoutMs: 300 });
    assert.equal(out, "slow/a.txt:1:aaa\n[The search stopped after 300 ms; what it found by then is shown. Narrow the pattern or the path.]");
    await new Promise((r) => setTimeout(r, 50)); // a tick held back by a stall lands first, and counts it
  } finally {
    clearInterval(tick);
  }
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  assert.ok(worst < 1000, `the proxy's thread stalled ${worst} ms`);
  await until(() => !process.getActiveResourcesInfo().includes("MessagePort"), "the walker's thread ended with the search, not left to run the pattern out", { timeoutMs: 1500 });
});

// (fails before: rg's refusal came back as "grep failed (exit 2)", the walker's as a stray SyntaxError)
test("a pattern the search cannot parse is refused in the search's own words", async () => {
  await assert.rejects(() => grepWith(false)({ pattern: "(foo" }), /grep failed: regex parse error: .*unclosed group/);
  await assert.rejects(() => grepWith(true)({ pattern: "(foo" }), /grep failed: Invalid regular expression/);
});

// (fails before: no type)
test("type is ripgrep's file kinds: rg filters by it, the walker refuses it in words rather than ignore it", async () => {
  assert.equal(await grepWith(false)({ pattern: "beta", type: "js" }), "src/a.js:2:beta one\nsrc/a.js:5:beta two");
  await assert.rejects(() => grepWith(true)({ pattern: "beta", type: "js" }), /type needs ripgrep \(rg\), which this machine does not have: use glob instead/);
  await assert.rejects(() => grepWith(false)({ pattern: "beta", type: "nosuchtype" }), /grep failed: unrecognized file type: nosuchtype/);
});

// (fails before: the developer's RIPGREP_CONFIG_PATH reached the search — a --max-count in it hid matches)
test("the developer's own rg config never changes what the search shows", async () => {
  const cfg = join(root, "rg.conf");
  writeFileSync(cfg, "--max-count=1\n--fixed-strings\n");
  const had = process.env.RIPGREP_CONFIG_PATH;
  process.env.RIPGREP_CONFIG_PATH = cfg;
  try {
    assert.equal(await grepWith(false)({ pattern: "beta (one|two)", path: "src" }), "src/a.js:2:beta one\nsrc/a.js:5:beta two");
  } finally {
    if (had === undefined) delete process.env.RIPGREP_CONFIG_PATH;
    else process.env.RIPGREP_CONFIG_PATH = had;
  }
});

test("the grep tool says what it does", () => {
  const t = HAND_TOOLS.find((x) => x.name === "grep");
  const props = /** @type {any} */ (t?.input_schema).properties;
  for (const k of ["output", "context", "before", "after", "type", "multiline", "offset"]) assert.ok(props[k], k);
  assert.deepEqual(props.output.enum, ["content", "files", "count"]);
  assert.match(String(t?.description), /path:line:text/);
  assert.match(String(t?.description), /offset/);
});

// (fails before: the card counted the context lines, the -- and the new notices as hits)
test("the search card counts the matching lines: not the context, the separators or the notices", async () => {
  const shown = await grepWith(false)({ pattern: "beta", context: 1, limit: 3 });
  assert.deepEqual(searchHits(shown, false), ["Z.txt:1:beta upper", "docs/n.md:1:beta in docs", "src/a.js:2:beta one"]);
  assert.equal(searchHits(await grepWith(false)({ pattern: "beta", output: "count" }), false).length, 4, "a count's files are its hits");
  assert.deepEqual(searchHits("(no matches)", false), []);
  assert.deepEqual(searchHits("a-1-b.txt\nc.txt\n2 paths limit reached (9 found). Use limit=4 for more, or a narrower pattern.", true), ["a-1-b.txt", "c.txt"], "a listing's paths are all hits");
});

// (fails before: yes — the bug hunt of 10-30: rg's line for a match on a line of 257 MiB was held whole, and shown cut)
test("rg: a match on a line past 256 MiB is left out, and the answer says so; the matches around it are shown", { timeout: 120_000, skip: spawnSync("rg", ["--version"]).status !== 0 && "no rg here" }, async () => {
  const big = mkdtempSync(join(tmpdir(), "filament-grep-long-"));
  try {
    const fd = openSync(join(big, "one.txt"), "w");
    const piece = Buffer.from("x".repeat(2 ** 20));
    writeSync(fd, "needle ");
    for (let i = 0; i < 257; i++) writeSync(fd, piece);
    writeSync(fd, "\nneedle two\n");
    closeSync(fd);
    assert.equal(
      await runHand("grep", { pattern: "needle" }, { root: big, noRg: false }),
      "one.txt:2:needle two\n[A line of the search's output past 256 MiB — a match on a line as long in its file, or a line around one — was left out: Filament reads no line that long.]",
    );
  } finally {
    await removeDirs(big);
  }
});
