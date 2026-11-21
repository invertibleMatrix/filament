import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runHand, resolveInside, HandError, RESULT_BUDGET_BYTES, guardResult, disposeSpills } from "../src/hands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { takeShellExits, shellNow } from "../src/adapters/tools/hands.js";
import { until } from "./helpers/wait.js";

const root = mkdtempSync(join(tmpdir(), "filament-hands-"));
test.after(() => {
  disposeSpills(); // the spills' removal timers are unref'd: they would die with this process, the files kept
  rmSync(root, { recursive: true, force: true });
});

test("sandbox: paths resolve inside the root, traversal and absolute escapes refused", () => {
  assert.equal(resolveInside(root, "a.txt"), join(root, "a.txt"));
  assert.throws(() => resolveInside(root, "../escape.txt"), HandError);
  assert.throws(() => resolveInside(root, join(root, "..", "escape.txt")), HandError);
  // (fails before: yes — the refusal named the old engine's worker file tools)
  assert.throws(() => resolveInside(null, "a.txt"), (e) => e instanceof HandError && e.message === "no folder is configured for this session's file tools");
});

test("sandbox: fenced false allows paths outside the root (Full Access mode)", async () => {
  const outside = join(root, "..", "outside.txt");
  writeFileSync(outside, "outside content");
  test.after(() => { try { rmSync(outside, { force: true }); } catch {} });
  // fenced: false resolves but does not refuse
  const abs = resolveInside(root, "../outside.txt", { fenced: false });
  assert.equal(abs, resolve(outside));
  // runHand passes fenced through
  const text = await runHand("read", { path: "../outside.txt" }, { root, fenced: false });
  assert.ok(typeof text === "string");
  // fenced: true (default) still refuses
  assert.throws(() => resolveInside(root, "../outside.txt"), HandError);
});

// (fails before: yes — the bug hunt of 10-30, TOOL-1: the fence walked up from a path on a drive that is not there to
// the first folder that is, and `dirname("Q:\\")` is "Q:\\": the walk never ended, and the server's thread with it)
test("sandbox: a path on a drive that is not there is refused at once, by the root's fence and by an added folder's", { skip: process.platform !== "win32" && "drive letters are Windows'" }, () => {
  const gone = [..."ZYXWVUTSRQPONMLKJIHGF"].find((d) => !existsSync(`${d}:\\`));
  assert.ok(gone, "a drive letter nothing answers to");
  // In a process of its own: a walk that never ends holds the thread it runs on, a test's clock with it.
  const calls = [[root, `${gone}:\\x.txt`, {}], [root, `${gone}:\\notes\\x.txt`, { reads: [`${gone}:\\notes`] }]];
  const script = `import { resolveInside } from ${JSON.stringify(new URL("../src/adapters/tools/fs-fence.js", import.meta.url).href)};
console.log(JSON.stringify(${JSON.stringify(calls)}.map(([root, p, o]) => { try { return resolveInside(root, p, o); } catch (e) { return e.message; } })));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000 });
  assert.equal(r.error, undefined, "it answered within 20 s");
  assert.deepEqual(JSON.parse(r.stdout), [`"${gone}:\\x.txt" resolves outside the allowed task folder`, `"${gone}:\\notes\\x.txt" is on a drive or share that is not there`]);
});

// (fails before: yes — the bug hunt of 10-30, TOOL-3: a drive-relative path on another drive than the root's was read
// from Filament's own folder, the process's, where a shell the hands start in the root reads it from that drive's root)
test("sandbox: a drive-relative path is read as the hands' shell reads it: on the root's drive from the root, on another from that drive's root", { skip: process.platform !== "win32" && "drive letters are Windows'" }, () => {
  const drive = root.slice(0, 1);
  const other = drive.toUpperCase() === "Q" ? "R" : "Q";
  const real = process.cwd;
  process.cwd = () => `${other}:\\filament`; // Filament runs from that drive
  try {
    assert.equal(resolveInside(root, `${other}:notes.txt`, { fenced: false }), `${other}:\\notes.txt`);
    assert.equal(resolveInside(root, `${drive}:notes.txt`), join(root, "notes.txt"));
  } finally {
    process.cwd = real;
  }
});

test("read: continuation notices, offsets, missing and binary files", async () => {
  writeFileSync(join(root, "notes.txt"), Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"));
  const all = await runHand("read", { path: "notes.txt" }, { root });
  assert.match(all, /line 1/); assert.match(all, /line 10/); assert.ok(!all.includes("Use offset="), "small file: no notice");
  const part = await runHand("read", { path: "notes.txt", offset: 7, limit: 2 }, { root });
  assert.match(part, /line 7/); assert.match(part, /Use offset=9 to continue/); assert.ok(!part.includes("line 6"));
  await assert.rejects(() => runHand("read", { path: "nope.txt" }, { root }), HandError);
  writeFileSync(join(root, "bin.dat"), Buffer.from([0, 1, 2, 3]));
  await assert.rejects(() => runHand("read", { path: "bin.dat" }, { root }), HandError);
});

test("write: creates folders and files; edit: exact, fuzzy-widened, uniqueness, overlap, CRLF/BOM survive", async () => {
  assert.match(await runHand("write", { path: "src/deep/new.js", content: "const a = 1;\n" }, { root }), /Successfully wrote to src\/deep\/new\.js/);
  assert.equal(readFileSync(join(root, "src/deep/new.js"), "utf8"), "const a = 1;\n");
  // exact multi-edit, applied together against the original
  writeFileSync(join(root, "code.js"), "alpha\nbeta\ngamma\nbeta\n");
  assert.match(await runHand("edit", { path: "code.js", edits: [{ oldText: "alpha", newText: "ALPHA" }, { oldText: "gamma", newText: "GAMMA" }] }, { root }), /replaced 2 blocks? in code\.js/);
  assert.equal(readFileSync(join(root, "code.js"), "utf8"), "ALPHA\nbeta\nGAMMA\nbeta\n");
  // uniqueness enforced
  await assert.rejects(() => runHand("edit", { path: "code.js", edits: [{ oldText: "beta", newText: "x" }] }, { root }), /Found 2 occurrences.*more context/);
  // fuzzy: trailing whitespace on the middle line, smart quotes in the needle
  writeFileSync(join(root, "fuzzy.txt"), "one\ntwo  \nthree\n");
  await runHand("edit", { path: "fuzzy.txt", edits: [{ oldText: "one\ntwo\nthree", newText: "ONE\nTWO\nTHREE" }] }, { root });
  assert.equal(readFileSync(join(root, "fuzzy.txt"), "utf8"), "ONE\nTWO\nTHREE\n");
  // malformed args shim: edits as a JSON string
  writeFileSync(join(root, "shim.txt"), "keep\nchange me\n");
  await runHand("edit", { path: "shim.txt", edits: JSON.stringify([{ oldText: "change me", newText: "changed" }]) }, { root });
  assert.equal(readFileSync(join(root, "shim.txt"), "utf8"), "keep\nchanged\n");
  // CRLF preserved, BOM preserved
  writeFileSync(join(root, "crlf.txt"), "\uFEFFfirst\r\nsecond\r\n");
  await runHand("edit", { path: "crlf.txt", edits: [{ oldText: "first", newText: "1st" }] }, { root });
  const crlf = readFileSync(join(root, "crlf.txt"), "utf8");
  assert.ok(crlf.startsWith("\uFEFF")); assert.ok(crlf.includes("1st\r\nsecond\r\n"));
  // overlap refused
  writeFileSync(join(root, "ov.txt"), "abcdef\n");
  await assert.rejects(() => runHand("edit", { path: "ov.txt", edits: [{ oldText: "abcd", newText: "x" }, { oldText: "cdef", newText: "y" }] }, { root }), /overlap/);
});

// (fails before: yes — the file was read as UTF-8 and written back: its é, one Latin-1 byte, came back as U+FFFD)
test("edit: a file that is not UTF-8 text is refused, its bytes as they were; UTF-8 with its BOM still edits", async () => {
  const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x6f, 0x6e, 0x65, 0x0a]);
  writeFileSync(join(root, "latin1.txt"), latin1);
  await assert.rejects(
    () => runHand("edit", { path: "latin1.txt", edits: [{ oldText: "one", newText: "two" }] }, { root }),
    (/** @type {any} */ e) => e instanceof HandError && e.message === "latin1.txt is not UTF-8 text, and an edit would rewrite the bytes it does not touch: change it with a command that keeps its encoding.",
  );
  assert.deepEqual(readFileSync(join(root, "latin1.txt")), latin1);
  writeFileSync(join(root, "utf8.txt"), "\uFEFFcafé\none\n");
  await runHand("edit", { path: "utf8.txt", edits: [{ oldText: "one", newText: "two" }] }, { root });
  assert.equal(readFileSync(join(root, "utf8.txt"), "utf8"), "\uFEFFcafé\ntwo\n");
});

test("edit: a call in Claude Code's spelling is refused in its words, and its replace_all replaces every one", async () => {
  writeFileSync(join(root, "spelled.txt"), "beta\nbeta\n");
  const claude = (/** @type {any} */ e) => runHand("edit", { path: "spelled.txt", edits: [e] }, { root });
  await assert.rejects(() => claude({ old_string: "beta", new_string: "x" }), /set replace_all to replace every one/);
  await assert.rejects(() => claude({ old_string: "zeta", new_string: "x" }), /old_string not found in spelled\.txt/);
  await assert.rejects(() => claude({ old_string: "", new_string: "x" }), /each needs old_string and new_string/);
  await assert.rejects(() => runHand("edit", { path: "spelled.txt", edits: [{ oldText: "beta", newText: "x" }] }, { root }), /set replaceAll to replace every one/, "ours, in ours");
  assert.match(await claude({ old_string: "beta", new_string: "B", replace_all: true }), /replaced 2 blocks in spelled\.txt/);
  assert.equal(readFileSync(join(root, "spelled.txt"), "utf8"), "B\nB\n");
});

test("bash: output, merged stderr, exit codes, timeout kill, sandboxed cwd", async () => {
  // In the shell this machine's bash hand runs: cmd.exe only on a Windows without Git Bash (shell.js).
  const cmd = SHELL.kind === "cmd";
  const echo = await runHand("bash", { command: "echo hello-hands" }, { root });
  assert.match(echo, /hello-hands/);
  await assert.rejects(() => runHand("bash", { command: cmd ? "echo oops 1>&2 & exit /b 3" : "echo oops 1>&2; exit 3" }, { root }), /oops[\s\S]*exited with code 3/);
  await assert.rejects(() => runHand("bash", { command: cmd ? "ping -n 10 127.0.0.1 > nul" : "sleep 10", timeout: 1 }, { root }), /timed out after 1 seconds?/);
  mkdirSync(join(root, "cwdcheck"), { recursive: true });
  // Git Bash's pwd says /c/…; `pwd -W` says the folder as Windows names it, with forward slashes.
  const cwd = await runHand("bash", { command: cmd ? "cd" : SHELL.kind === "git-bash" ? "pwd -W" : "pwd" }, { root });
  assert.ok(cwd.toLowerCase().replace(/\\/g, "/").includes(resolve(root).toLowerCase().replace(/\\/g, "/")), `runs inside the root: ${cwd}`);
});

// (fails before: yes — a chat's build past its timeout was killed halfway: "Command timed out after 1 seconds", and
// nothing of it went on)
test("bash: a chat's command past its timeout goes on in the background, its exit told; one that never ends stops at its ceiling", async () => {
  const owner = { session: "s-past-timeout", agent: null };
  const gate = "past-timeout.go";
  const waits = `node -e "const fs=require('fs');setInterval(()=>fs.existsSync('${gate}')&&process.exit(0),50)"`;
  const moved = String(await runHand("bash", { command: waits, timeout: 1 }, { root, owner }));
  assert.match(moved, /ran past its timeout of 1 second, so Filament sent it to the background rather than stop it/);
  assert.match(moved, /stops it if it still runs an hour after it started/);
  const id = /background shell (bg_\w+)/.exec(moved)?.[1] || "";
  assert.ok(id && shellNow(id, owner).running, `still running as ${id}`);
  writeFileSync(join(root, gate), "");
  const exit = await until(() => takeShellExits(owner).find((x) => x.id === id), "its exit, told", { timeoutMs: 20_000 });
  assert.match(exit.text, /exited with code 0/);

  const hangs = await runHand("bash", { command: `node -e "setInterval(()=>{},1000)"`, timeout: 1 }, { root, owner, ceilingMs: 3000 });
  assert.match(String(hangs), /stops it if it still runs 3 seconds after it started/);
  const hung = /background shell (bg_\w+)/.exec(String(hangs))?.[1] || "";
  const stopped = await until(() => takeShellExits(owner).find((x) => x.id === hung), "its stop at the ceiling, told", { timeoutMs: 20_000 });
  assert.match(stopped.text, /still ran 3 seconds after it started, past its timeout, and Filament stopped it/);
  assert.equal(shellNow(hung, owner).running, false);
  // (fails before: yes — the review of 2e9d58b0c: bash_output, which saw the end first, said its kill's exit code)
  assert.match(String(await runHand("bash_output", { id: hung }, { root, owner })), /stopped by Filament: it still ran 3 seconds after it started, past its timeout/);

  // (fails before: no on Windows, where the shell's close came at its exit all the same — a guard of the same review's
  // reading: where a process it started holds its output, its close waits on that process, and its end was told only
  // then) The shell exits at 2 s; what it started holds the pipe 10 s more.
  const child = `node -e "require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},12000)'],{stdio:'inherit'});setTimeout(()=>process.exit(0),2000)"`;
  const leaves = String(await runHand("bash", { command: child, timeout: 1 }, { root, owner }));
  const left = /background shell (bg_\w+)/.exec(leaves)?.[1] || "";
  const t0 = Date.now();
  const told = await until(() => takeShellExits(owner).find((x) => x.id === left), "its exit, with a process of it still holding the pipe", { timeoutMs: 9_000 });
  assert.match(told.text, /exited with code 0/);
  assert.ok(Date.now() - t0 < 9_000, "told at its own exit, not the held pipe's close");
});

test("grep: literal and regex, caps with notices, walker fallback shape", async () => {
  mkdirSync(join(root, "pkg"), { recursive: true });
  writeFileSync(join(root, "pkg/a.ts"), "function flux() {}\nfunction capacitor() {}\n");
  writeFileSync(join(root, "pkg/b.md"), "flux notes\n");
  const re = await runHand("grep", { pattern: "flux", glob: "*.ts" }, { root });
  assert.match(re, /a\.ts:1:function flux/); assert.ok(!re.includes("b.md"), "glob filters");
  const lit = await runHand("grep", { pattern: "capacitor()", literal: true }, { root });
  assert.match(lit, /capacitor\(\)/);
  const none = await runHand("grep", { pattern: "nothing-matchable-xyz" }, { root });
  assert.match(none, /no matches/);
  writeFileSync(join(root, "many.txt"), Array.from({ length: 150 }, () => "needle line").join("\n"));
  const capped = await runHand("grep", { pattern: "needle", path: "many.txt" }, { root });
  assert.match(capped, /\n\[Matches 1-100 shown; there are more\. Use offset=100 to continue, or narrow the pattern or the path\.\]$/);
});

test("review regressions: mid-line exact edits, CRLF newText, symlink escape, huge-file gate, walker glob", async () => {
  // BUG-1: an exact match mid-line must splice precisely, never widen to the whole line
  writeFileSync(join(root, "mid.js"), "const r = compute(1) + 2;\nconsole.log(r);\n");
  await runHand("edit", { path: "mid.js", edits: [{ oldText: "compute(1)", newText: "calc(1)" }] }, { root });
  assert.equal(readFileSync(join(root, "mid.js"), "utf8"), "const r = calc(1) + 2;\nconsole.log(r);\n", "mid-line rename splices exactly");
  // BUG-2: CRLF inside newText must not double-carriage
  writeFileSync(join(root, "crlf2.txt"), "first\r\nsecond\r\n");
  await runHand("edit", { path: "crlf2.txt", edits: [{ oldText: "first", newText: "one\r\ntwo" }] }, { root });
  assert.equal(readFileSync(join(root, "crlf2.txt"), "utf8"), "one\r\ntwo\r\nsecond\r\n", "no \r\r\n");
  // mixed-endings file: only \n for touched lines, no wholesale churn
  writeFileSync(join(root, "mixed.txt"), "keep\nx\r\nkeep\n");
  await runHand("edit", { path: "mixed.txt", edits: [{ oldText: "x", newText: "X" }] }, { root });
  assert.equal(readFileSync(join(root, "mixed.txt"), "utf8"), "keep\nX\r\nkeep\n", "mixed line endings preserved");
  // BUG-4: huge files refused before reading
  writeFileSync(join(root, "huge.txt"), "x".repeat(11 * 1024 * 1024));
  await assert.rejects(() => runHand("read", { path: "huge.txt" }, { root }), /MB/);
  await assert.rejects(() => runHand("edit", { path: "huge.txt", edits: [{ oldText: "a", newText: "b" }] }, { root }), /too large/);
  rmSync(join(root, "huge.txt"), { force: true });
  // BUG-5: a symlink (or junction) inside the root must not reach outside it
  const outside = mkdtempSync(join(tmpdir(), "filament-hands-out-"));
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET");
  const { symlinkSync } = await import("node:fs");
  let linked = false;
  try { symlinkSync(join(outside, "secret.txt"), join(root, "leak.txt"), "file"); linked = true; } catch { /* Windows without developer mode: junctions still testable via dir */ }
  if (linked) {
    await assert.rejects(() => runHand("read", { path: "leak.txt" }, { root }), /through a link|outside/);
    await assert.rejects(() => runHand("edit", { path: "leak.txt", edits: [{ oldText: "TOP", newText: "PWNED" }] }, { root }), /through a link|outside/);
    assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "TOP SECRET", "the outside file is untouched");
  }
  try { symlinkSync(outside, join(root, "leakdir"), "dir"); linked = true; await assert.rejects(() => runHand("read", { path: "leakdir/secret.txt" }, { root }), /through a link|outside/); } catch { /* junction/dir symlink may need admin on some setups */ }
  rmSync(outside, { recursive: true, force: true });
  // walker fallback: path-scoped globs match, and the fallback runs when rg is forced off
  mkdirSync(join(root, "walker", "src"), { recursive: true });
  writeFileSync(join(root, "walker", "src", "a.ts"), "function flux() {}\n");
  writeFileSync(join(root, "walker", "readme.md"), "flux notes\n");
  const scoped = await runHand("grep", { pattern: "flux", path: "walker", glob: "src/*.ts" }, { root, noRg: true });
  assert.match(scoped, /a\.ts:1/); assert.ok(!scoped.includes("readme.md"), "path-scoped glob works in the walker");
});

test("a caller's budget: every hand cuts itself inside it — whole lines, a notice naming the next step — so no later slice takes the notice", async () => {
  const budget = RESULT_BUDGET_BYTES;
  const bytes = (/** @type {string} */ s) => Buffer.byteLength(s);
  // read: whole lines up to the budget, then the offset to continue from — and the offset continues exactly there
  const lines = Array.from({ length: 1500 }, (_, i) => `row ${String(i + 1).padStart(4, "0")} ${"r".repeat(40)}`);
  writeFileSync(join(root, "long.txt"), `${lines.join("\n")}\n`);
  const r1 = await runHand("read", { path: "long.txt" }, { root, maxBytes: budget });
  assert.ok(bytes(r1) <= budget, `${bytes(r1)} bytes`);
  const m = /\n\[Showing lines 1-(\d+) of 1500\. Use offset=(\d+) to continue\.\]$/.exec(r1);
  assert.ok(m, r1.slice(-120));
  const shown = Number(m[1]);
  assert.equal(Number(m[2]), shown + 1);
  const catN = (/** @type {string[]} */ ls, from = 1) => ls.map((l, i) => `${String(from + i).padStart(6)}\t${l}`).join("\n");
  assert.equal(r1.slice(0, -m[0].length), catN(lines.slice(0, shown)), "whole lines, none cut, numbered");
  assert.ok((await runHand("read", { path: "long.txt", offset: shown + 1 }, { root, maxBytes: budget })).startsWith(`${catN([lines[shown]], shown + 1)}\n`));
  assert.ok(bytes(await runHand("read", { path: "long.txt" }, { root })) > budget, "without a budget the hands keep their own 50 KB");
  // a line wider than the whole budget: its head, marked, never cut inside a character, and the way past it
  writeFileSync(join(root, "minified.js"), `${"é".repeat(20000)}\nnext line\n`);
  const wide = await runHand("read", { path: "minified.js" }, { root, maxBytes: budget });
  assert.ok(bytes(wide) <= budget, `${bytes(wide)} bytes`);
  assert.match(wide, /^ {5}1\té+\n\[Line 1 of 2 is 40,000 bytes; its first [\d,]+ are shown\. Search inside it with grep, or use offset=2 to continue after it\.\]$/);
  assert.equal(await runHand("read", { path: "minified.js", offset: 2 }, { root, maxBytes: budget }), "     2\tnext line");
  // bash: the tail within the budget, the whole output in the spill file the notice names
  const many = await runHand("bash", { command: `node -e "for(let i=0;i<3000;i++)console.log('out '+i+' '+'b'.repeat(30))"` }, { root, maxBytes: budget });
  assert.ok(bytes(many) <= budget, `${bytes(many)} bytes`);
  assert.match(many, /out 2999 b{30}\n/, "the end is kept");
  assert.match(many, /\nFull output \(first \d+ MB, kept 30 minutes\): \S*filament-bash-/);
  // one line longer than the whole budget keeps its END, where an error would be
  const oneLine = await runHand("bash", { command: `node -e "process.stdout.write('y'.repeat(60000)+'THE-END')"` }, { root, maxBytes: budget });
  assert.ok(bytes(oneLine) <= budget, `${bytes(oneLine)} bytes`);
  assert.match(oneLine, /^y+THE-END\nFull output/);
  // grep and glob hold it too, with their own notices
  mkdirSync(join(root, "wide"), { recursive: true });
  writeFileSync(join(root, "wide/matches.txt"), Array.from({ length: 90 }, (_, i) => `hit ${i} ${"g".repeat(450)}`).join("\n"));
  const g = await runHand("grep", { pattern: "hit", path: "wide" }, { root, maxBytes: budget });
  assert.ok(bytes(g) <= budget, `${bytes(g)} bytes`);
  assert.match(g, /\n\[Matches 1-(\d+) shown — past this result's budget\. Use offset=\1 to continue, or narrow the pattern or the path\.\]$/);
  for (let i = 0; i < 400; i++) writeFileSync(join(root, "wide", `${"n".repeat(80)}-${i}.txt`), "");
  const gl = await runHand("glob", { pattern: "*.txt", path: "wide", limit: 2000 }, { root, maxBytes: 8000 });
  assert.ok(bytes(gl) <= 8000, `${bytes(gl)} bytes`);
  assert.match(gl, /\n\[\d+ of 401 paths shown — past this result's budget\. Use a narrower pattern or path\.\]$/);
});

test("the last guard: a result that took no budget is cut loudly past the budget and its room, in bytes, never quietly", () => {
  const room = 512;
  assert.equal(guardResult("small"), "small");
  const fits = "x".repeat(RESULT_BUDGET_BYTES + room);
  assert.equal(guardResult(fits), fits, "the budget plus its room (the cap's pointer) passes whole");
  const over = guardResult("x".repeat(RESULT_BUDGET_BYTES * 2));
  assert.ok(over.startsWith(`${"x".repeat(RESULT_BUDGET_BYTES + room)}\n`));
  assert.match(over, /\n…\[Filament: this result ran past the 24,512 bytes one result may carry and was cut here; ask for less \(a narrower range, search or query\) and call again\]$/);
  // Counted in bytes, like every source's own cut, and never inside a character.
  const wide = guardResult("語".repeat(20_000));
  const kept = wide.slice(0, wide.indexOf("\n…[Filament"));
  assert.equal(kept, "語".repeat(Math.floor((RESULT_BUDGET_BYTES + room) / 3)));
});

test("privacy.redact inside the hands: applied to what a hand read before its cut — no secret half-shown at an edge, and a longer mark never pushes the result past its budget", async () => {
  const budget = RESULT_BUDGET_BYTES;
  const bytes = (/** @type {string} */ s) => Buffer.byteLength(s);
  const redact = (/** @type {string} */ t) => t.replace(/SECRET-TOKEN-XYZ/g, "[redacted]");
  // read: the whole file is redacted, so a line's secret never survives and line numbers hold across reads
  writeFileSync(join(root, "env.txt"), "a=1\nkey=SECRET-TOKEN-XYZ\nb=2\n");
  assert.equal(await runHand("read", { path: "env.txt" }, { root, maxBytes: budget, redact }), "     1\ta=1\n     2\tkey=[redacted]\n     3\tb=2");
  // bash: one line longer than the budget whose kept END would begin inside the secret — the mark is cut, not the secret
  const straddle = await runHand("bash", { command: `node -e "process.stdout.write('a'.repeat(30000)+'SECRET-TOKEN-XYZ'+'b'.repeat(23480))"` }, { root, maxBytes: budget, redact });
  assert.ok(!/OKEN|TOKEN|XYZ/.test(straddle), "no part of the secret at the cut");
  assert.ok(bytes(straddle) <= budget, `${bytes(straddle)} bytes`);
  // bash: a mark four times the size of what it replaces, many times over, still leaves the output inside the budget
  const inflating = await runHand("bash", { command: `node -e "for(let i=0;i<3000;i++)console.log('x SECRET-TOKEN-XYZ '+i)"` }, { root, maxBytes: budget, redact: (t) => t.replace(/x /g, "[a longer redaction mark] ") });
  assert.ok(bytes(inflating) <= budget, `${bytes(inflating)} bytes`);
  assert.match(inflating, /\nFull output \(first \d+ MB, kept 30 minutes\): /, "and its notice is still there");
  // grep: each match is redacted before its line cap, so a secret straddling the 500-character cut never shows half —
  // secrets every 17 characters across the cut, so one straddles it whatever the path prefix's length
  mkdirSync(join(root, "g2"), { recursive: true });
  writeFileSync(join(root, "g2/wide.txt"), `${"p".repeat(380)}${"SECRET-TOKEN-XYZ-".repeat(20)}\n`);
  for (const noRg of [false, true]) {
    const g = await runHand("grep", { pattern: "p", path: "g2" }, { root, maxBytes: budget, redact, noRg });
    assert.ok(!/SECRET|TOKEN/.test(g) && g.includes("[redacted]"), `noRg ${noRg}: ${g.slice(-120)}`);
  }
  // glob: the paths are what the hand read
  writeFileSync(join(root, "g2", "SECRET-TOKEN-XYZ.txt"), "");
  assert.match(await runHand("glob", { pattern: "*.txt", path: "g2" }, { root, redact }), /\[redacted\]\.txt/);
});

test("the shell's tails: a huge last line with a final newline keeps its end; a line cap that cuts before the byte budget still names a file holding it all; a background shell's early output takes the budget", async () => {
  const budget = RESULT_BUDGET_BYTES;
  const bytes = (/** @type {string} */ s) => Buffer.byteLength(s);
  const nl = await runHand("bash", { command: `node -e "console.log('z'.repeat(60000)+'LAST')"` }, { root, maxBytes: budget });
  assert.match(nl, /^z+LAST\nFull output/, "the final newline is not a line of its own, so the long line is what is kept");
  const short = await runHand("bash", { command: `node -e "for(let i=0;i<2500;i++)console.log(i)"` }, { root, maxBytes: budget });
  assert.match(short, /\n2499\nFull output \(first \d+ MB, kept 30 minutes\): (\S+)$/, "2,500 short lines fit the bytes but not the line cap");
  const file = /: (\S+)$/.exec(short)?.[1] || "";
  assert.equal(readFileSync(file, "utf8").trim().split(/\r?\n/).length, 2500, "the file holds every line");
  const bg = await runHand("bash_background", { command: `node -e "for(let i=0;i<3000;i++)console.log('boot '+i+' '+'s'.repeat(30))"`, grace: 3 }, { root, maxBytes: budget });
  assert.ok(bytes(bg) <= budget, `${bytes(bg)} bytes`);
  assert.match(bg, /earlier characters of this output are not shown — past this result's budget/);
  assert.match(bg, /boot 2999 s{30}/, "the newest lines are the ones kept");
  // the grep walker (no rg) takes the budget like rg's path
  mkdirSync(join(root, "g3"), { recursive: true });
  writeFileSync(join(root, "g3/m.txt"), Array.from({ length: 90 }, (_, i) => `hit ${i} ${"g".repeat(450)}`).join("\n"));
  const walked = await runHand("grep", { pattern: "hit", path: "g3" }, { root, maxBytes: budget, noRg: true });
  assert.ok(bytes(walked) <= budget, `${bytes(walked)} bytes`);
  assert.match(walked, /\n\[Matches 1-(\d+) shown — past this result's budget\. Use offset=\1 to continue, or narrow the pattern or the path\.\]$/);
  const capped = await runHand("grep", { pattern: "hit", path: "g3", limit: 100 }, { root, maxBytes: 400_000, noRg: true });
  assert.ok(!capped.includes("there are more"), "90 matches are under the 100 limit");
  writeFileSync(join(root, "g3/n.txt"), Array.from({ length: 150 }, (_, i) => `hit ${i}`).join("\n"));
  assert.match(await runHand("grep", { pattern: "hit", path: "g3/n.txt", noRg: true }, { root }), /\n\[Matches 1-100 shown; there are more\. Use offset=100 to continue, or narrow the pattern or the path\.\]$/);
  assert.match(await runHand("grep", { pattern: "hit", path: "g3/n.txt", limit: 20, noRg: true }, { root }), /\n\[Matches 1-20 shown; there are more\. Use offset=20 to continue, or narrow the pattern or the path\.\]$/);
});

// A file over the read cap cannot be opened at any offset (the cap is checked before slicing), so the refusal points
// at the shell's own slicing in the shell the bash hand runs — cmd.exe has no sed (HarnessV3-FixRound F1 item 8), Git
// Bash does (HarnessV3-Tools TL-D1). (fails before: yes — every platform was told "sed -n '1,500p'")
test("read: a file over the cap names the shell's slice command, and no read offset", async () => {
  const { tooBigToRead } = await import("../src/adapters/tools/hands.js");
  const win = tooBigToRead("logs/big.log", 12 * 1048576, { kind: "cmd", name: "cmd.exe", file: "cmd.exe" });
  assert.match(win, /^logs\/big\.log is 12 MB, over the read tool's 10 MB cap, so read cannot open it at any offset\./);
  assert.match(win, /powershell -NoProfile -Command "Get-Content -LiteralPath 'logs\/big\.log' \| Select-Object -Skip 0 -First 500"/);
  assert.doesNotMatch(win, /sed/);
  for (const kind of /** @type {const} */ (["git-bash", "bash", "sh"])) {
    const bash = tooBigToRead("logs/big.log", 12 * 1048576, { kind, name: kind, file: kind });
    assert.match(bash, /sed -n '1,500p' "logs\/big\.log"/, kind);
    assert.doesNotMatch(bash, /powershell|Get-Content/, kind);
  }
  writeFileSync(join(root, "big.log"), Buffer.alloc(11 * 1048576, 0x61));
  await assert.rejects(() => runHand("read", { path: "big.log", offset: 1, limit: 10 }, { root }), (e) => {
    assert.ok(e instanceof HandError);
    assert.equal(e.message, tooBigToRead("big.log", 11 * 1048576));
    return true;
  });
});

// (fails before: yes — the bug hunt of 10-30, the tools' Lows: a POSIX shell was told the path in double quotes, where
// it expands `$` and backticks, so the slice command read another file or ran what the name held)
test("read: the slice command a POSIX shell is told reads a path with $ or a backtick in it as written", async () => {
  const { tooBigToRead } = await import("../src/adapters/tools/hands.js");
  const bash = /** @type {const} */ ({ kind: "bash", name: "bash", file: "bash" });
  assert.match(tooBigToRead("logs/$HOME/`id`.log", 12 * 1048576, bash), /sed -n '1,500p' 'logs\/\$HOME\/`id`\.log' \(then/);
  assert.match(tooBigToRead("it's.log", 12 * 1048576, bash), /sed -n '1,500p' "it's\.log" \(then/, "a path the shell reads as written keeps its double quotes");
  assert.match(tooBigToRead("\\\\server\\share\\big.log", 12 * 1048576, bash), /sed -n '1,500p' '\\\\server\\share\\big\.log' \(then/, "a UNC path's first two backslashes are kept");
  assert.match(tooBigToRead("say \"hi\" $x.log", 12 * 1048576, bash), /sed -n '1,500p' 'say "hi" \$x\.log' \(then/);
  if (SHELL.kind === "cmd") return;
  // The command as the bash hand runs it: the lines of the file the name names.
  const dir = join(root, "cost $HOME `x`");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "big.log"), "first\nsecond\n");
  const command = /with the bash tool: (sed -n .*) \(then '501,1000p' and on\)$/.exec(tooBigToRead(join(dir, "big.log"), 12 * 1048576))?.[1];
  assert.ok(command);
  assert.deepEqual((await runHand("bash", { command }, { root })).trim().split(/\r?\n/), ["first", "second"]);
});

// (fails before: yes — the bug hunt of 10-30, the tools' Lows: a command's spilled output and a background command's log
// were written with the process's default mode, so on Linux any account could read them in the shared temp folder)
test("a command's spill files and a background command's log are their owner's alone (0o600)", async () => {
  const { startCommandShell, stopShell } = await import("../src/adapters/tools/hands.js");
  /** @type {[string, any][]} */
  const made = [];
  const realStream = fs.createWriteStream;
  const realWrite = fs.writeFileSync;
  fs.createWriteStream = /** @type {any} */ ((/** @type {any} */ p, /** @type {any} */ o) => (made.push([String(p), o]), realStream(p, o)));
  fs.writeFileSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any} */ d, /** @type {any} */ o) => (made.push([String(p), o]), realWrite(p, d, o)));
  syncBuiltinESMExports();
  const owner = { session: "spill-mode", agent: null };
  try {
    await runHand("bash", { command: `node -e "for(let i=0;i<3000;i++)console.log('out '+i+' '+'b'.repeat(30))"` }, { root, maxBytes: RESULT_BUDGET_BYTES });
    await runHand("bash", { command: `node -e "for(let i=0;i<2500;i++)console.log(i)"` }, { root, maxBytes: RESULT_BUDGET_BYTES });
    const s = startCommandShell(`node -e "console.log('bg')"`, root, owner, { onEnd: () => {} });
    await stopShell(s.id, owner);
    // A PowerShell command goes through a script file in the same folder.
    const { POWERSHELL, startCommand } = await import("../src/adapters/tools/shell.js");
    if (POWERSHELL) await startCommand(POWERSHELL, "Write-Output 'ps'", { cwd: root, env: process.env }).stop();
  } finally {
    fs.createWriteStream = realStream;
    fs.writeFileSync = realWrite;
    syncBuiltinESMExports();
  }
  const spills = made.filter(([p]) => /filament-bash-[0-9a-z]+-[0-9a-z]+\.log$/.test(p));
  assert.ok(spills.length >= 3, `the byte budget's stream, the line cap's file and the background log: ${JSON.stringify(spills)}`);
  for (const [p, o] of spills) assert.equal(o?.mode, 0o600, p);
  for (const [p, o] of made.filter(([p]) => /filament-ps-[0-9a-z]+-[0-9a-f]+\.ps1$/.test(p))) assert.equal(o?.mode, 0o600, p);
});

// (fails before: yes — the bug hunt of 10-30: a path with a ' ended PowerShell's quoted string, and the command the
// refusal named did not parse)
test("read: the slice command cmd.exe is told runs on a path with a quote in it", { skip: process.platform !== "win32" && "cmd.exe and PowerShell are Windows'" }, async () => {
  const { tooBigToRead } = await import("../src/adapters/tools/hands.js");
  const dir = join(root, "it's here");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "big.log"), "first\nsecond\n");
  const advice = tooBigToRead(join(dir, "big.log"), 12 * 1048576, { kind: "cmd", name: "cmd.exe", file: "cmd.exe" });
  const command = /with the bash tool: (powershell .*") \(raise -Skip to page on\)$/.exec(advice)?.[1];
  assert.ok(command, advice);
  const r = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${command}"`], { encoding: "utf8", windowsVerbatimArguments: true, timeout: 60_000 });
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), ["first", "second"], r.stderr);
});
