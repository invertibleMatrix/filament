// @ts-check
// A line Filament hands cmd.exe keeps its own quotes (r-hands, 11-12; adapters/tools/shell.js `cmdLine`). cmd.exe
// keeps a line's quotes only where it holds exactly two of them: with `/c` alone, a line that starts with a quoted
// program and quotes an argument too lost its first quote and its last, and ran the program's path up to its first
// space. The loop's shell where there is no Git Bash, and a hook's on Windows, were started so; the terminal's had
// `/d /s /c "<line>"`, which every one of them has now.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand } from "../src/adapters/tools/hands.js";
import { resolveShell } from "../src/adapters/tools/shell.js";
import { runHook } from "../src/app/agent/hooks.js";
import { removeDirs } from "./helpers/wait.js";

const WIN = process.platform === "win32";
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

// (fails before: yes — `cmdLine` is not a function)
test("cmd.exe's arguments for a line: no AutoRun, and the line inside the pair of quotes /s strips", async () => {
  const { cmdLine } = await import("../src/adapters/tools/shell.js");
  assert.deepEqual(cmdLine('"C:\\Program Files\\nodejs\\node.exe" "my script.js"'), ["/d", "/s", "/c", '""C:\\Program Files\\nodejs\\node.exe" "my script.js""']);
  assert.deepEqual(cmdLine("echo a & echo b"), ["/d", "/s", "/c", '"echo a & echo b"']);
});

describe("cmd.exe run for real", { skip: !WIN && "Windows only" }, () => {
  const cmd = resolveShell({ platform: "win32", env: { SystemRoot: String(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows") }, isFile: (p) => existsSync(p) && !/bash\.exe$/i.test(p) });
  /** A folder with a space in its name, holding a program and a file each with a space in theirs; and the line that names both. */
  const quoted = () => {
    const top = mkdtempSync(join(tmpdir(), "filament-cmdline-"));
    made.push(top);
    const dir = join(top, "with space");
    mkdirSync(dir);
    copyFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "findstr.exe"), join(dir, "find str.exe"));
    writeFileSync(join(dir, "my file.txt"), "a needle here\r\nand a line without\r\n");
    return { dir, line: `"${join(dir, "find str.exe")}" "needle" "${join(dir, "my file.txt")}"` };
  };

  // (fails before: yes — rejected, exit 1: "'…\with' is not recognized as an internal or external command")
  test("the loop's shell runs a line that starts with a quoted program and quotes its arguments too", async () => {
    const { dir, line } = quoted();
    assert.equal(cmd.kind, "cmd");
    assert.equal(String(await runHand("bash", { command: line }, { root: dir, shell: cmd })).trim(), "a needle here");
    // And what it ran before, it runs as it did: two quotes alone, a program found by its name, its own operators.
    assert.equal(String(await runHand("bash", { command: `"${join(dir, "find str.exe")}" needle *.txt` }, { root: dir, shell: cmd })).trim(), "my file.txt:a needle here");
    assert.equal(String(await runHand("bash", { command: 'findstr "needle" "my file.txt" & echo after' }, { root: dir, shell: cmd })).trim().split(/\r?\n/).join("|"), "a needle here|after");
    await assert.rejects(() => runHand("bash", { command: `"${join(dir, "find str.exe")}" "no such word" "${join(dir, "my file.txt")}"` }, { root: dir, shell: cmd }), (e) => /** @type {any} */ (e).exitCode === 1, "the program's own exit code");
  });

  // (fails before: yes — block, exit 1: "'…\with' is not recognized as an internal or external command")
  test("a hook's command that starts with a quoted program and quotes its arguments too runs", async () => {
    const { dir, line } = quoted();
    const r = await runHook({ on: "turn-end", command: line }, { event: "turn-end", cwd: dir });
    assert.deepEqual([r.verdict, r.exit, r.note], ["allow", 0, "a needle here"]);
  });
});
