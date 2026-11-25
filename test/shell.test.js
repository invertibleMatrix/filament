// @ts-check
// HarnessV3-Tools TL1: the shells the command hands run (adapters/tools/shell.js). Which shell is found (Git Bash on
// Windows, cmd.exe without it, bash or sh elsewhere; PowerShell beside it on Windows), that a command reaches Git Bash
// byte for byte, that stopping a command stops everything it started — the forks Windows' process tree loses, and a
// shell started inside another — and how a PowerShell script runs: UTF-8, plain-text errors with the script's own line
// numbers, -Command's exit codes, no file left behind. The cmd.exe fallback runs for real through an injected shell.
// What runs on this machine is skipped where its shell is not here; nothing here stops a process it did not start.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readdirSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findGitBash, resolveShell, resolvePowerShell, msysQuote, psScriptText, SHELL, POWERSHELL, SHELL_TAG, PS_SCRIPT_NAME } from "../src/adapters/tools/shell.js";
import { runHand as runHandRaw, safeEnv, sweepSpills, disposeBackgroundShells, powershellDescription } from "../src/adapters/tools/hands.js";
import { ruleFor, rulesFrom } from "../src/app/agent/rules.js";
import { gate, argSummary } from "../src/app/agent/tools.js";
import { permissionShape } from "../src/services/memory/permissions.js";
import { removeDirs, until } from "./helpers/wait.js";

/** hands.js is untyped JS: its options are real, the inferred signature just does not know them. @type {(name: string, input: any, o: any) => Promise<string>} */
const runHand = /** @type {any} */ (runHandRaw);
const GIT_BASH = SHELL.kind === "git-bash";
const WIN = process.platform === "win32";
const root = mkdtempSync(join(tmpdir(), "filament-shell-"));
after(async () => {
  await disposeBackgroundShells();
  await removeDirs(root);
});

/** A fake filesystem for the resolvers: these files exist, nothing else. @param {string[]} files */
const only = (files) => (/** @type {string} */ p) => files.includes(p);

describe("which shell runs", () => {
  test("Git Bash is found from the git on the PATH — Git's cmd, bin or mingw64\\bin — then in the usual install folders; never WSL's bash", () => {
    const launcher = "C:\\Tools\\Git\\bin\\bash.exe";
    for (const gitDir of ["C:\\Tools\\Git\\cmd", "C:\\Tools\\Git\\bin", "C:\\Tools\\Git\\mingw64\\bin"])
      assert.equal(findGitBash({ env: { Path: `C:\\Windows\\System32;${gitDir}` }, isFile: only([win32.join(gitDir, "git.exe"), launcher]) }), launcher, gitDir);
    assert.equal(findGitBash({ env: { PATH: '"C:\\Tools\\Git\\cmd"' }, isFile: only(["C:\\Tools\\Git\\cmd\\git.exe", launcher]) }), launcher, "a quoted PATH entry");
    const pf = "C:\\Program Files\\Git\\bin\\bash.exe";
    assert.equal(findGitBash({ env: { PATH: "", ProgramFiles: "C:\\Program Files" }, isFile: only([pf]) }), pf, "no git on the PATH: Program Files");
    const user = "C:\\Users\\ada\\AppData\\Local\\Programs\\Git\\bin\\bash.exe";
    assert.equal(findGitBash({ env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" }, isFile: only([user]) }), user, "a per-user install");
    assert.equal(findGitBash({ env: { PATH: "C:\\Windows\\System32" }, isFile: only(["C:\\Windows\\System32\\bash.exe"]) }), null, "WSL's bash is not Git Bash");
  });

  test("the bash tool's shell: Git Bash, else cmd.exe, on Windows; /bin/bash, else /bin/sh, elsewhere", () => {
    const env = { PATH: "C:\\Git\\cmd", SystemRoot: "D:\\Win" };
    assert.deepEqual(resolveShell({ platform: "win32", env, isFile: only(["C:\\Git\\cmd\\git.exe", "C:\\Git\\bin\\bash.exe"]) }), { kind: "git-bash", name: "Git Bash", file: "C:\\Git\\bin\\bash.exe" });
    assert.deepEqual(resolveShell({ platform: "win32", env, isFile: only([]) }), { kind: "cmd", name: "cmd.exe", file: "D:\\Win\\System32\\cmd.exe" });
    assert.deepEqual(resolveShell({ platform: "linux", env: {}, isFile: only(["/bin/bash"]) }), { kind: "bash", name: "bash", file: "/bin/bash" });
    assert.deepEqual(resolveShell({ platform: "darwin", env: {}, isFile: only([]) }), { kind: "sh", name: "sh", file: "/bin/sh" });
  });

  test("the powershell tool's PowerShell: pwsh on the PATH, else Windows PowerShell 5.1; none elsewhere", () => {
    const legacy = "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const env = { PATH: "C:\\PS7", SYSTEMROOT: "D:\\Win" };
    assert.deepEqual(resolvePowerShell({ platform: "win32", env, isFile: only(["C:\\PS7\\pwsh.exe", legacy]) }), { kind: "pwsh", name: "PowerShell 7 (pwsh)", file: "C:\\PS7\\pwsh.exe" });
    assert.deepEqual(resolvePowerShell({ platform: "win32", env, isFile: only([legacy]) }), { kind: "powershell", name: "Windows PowerShell 5.1", file: legacy });
    assert.equal(resolvePowerShell({ platform: "win32", env, isFile: only([]) }), null);
    assert.equal(resolvePowerShell({ platform: "linux", env, isFile: only(["C:\\PS7\\pwsh.exe"]) }), null);
    assert.match(powershellDescription({ kind: "powershell", name: "", file: "" }), /It is Windows PowerShell 5\.1: no &&, \|\| \(use ; and if \(\$\?\) \{ … \}\), no ternary, no \?\?/);
    assert.match(powershellDescription({ kind: "pwsh", name: "", file: "" }), /It is PowerShell 7 \(pwsh\): &&, \|\|, the ternary and \?\? work\./);
  });
});

describe("a command reaches Git Bash byte for byte (TL-D2)", () => {
  test("the quoting: in double quotes, every backslash and double quote escaped", () => {
    assert.equal(msysQuote('say "hi" C:\\x\\'), '"say \\"hi\\" C:\\\\x\\\\"');
    assert.equal(msysQuote("it's src/* {a,b} ~"), '"it\'s src/* {a,b} ~"', "nothing else is touched: inside double quotes MSYS globs and expands nothing");
  });

  // (fails before: Node left a command without a space unquoted, and MSYS globbed it, expanded its braces and ~,
  // stripped its single quotes and split it at a newline — probed 2026-10-02)
  test("hostile text comes back exactly through a quoted heredoc", { skip: !GIT_BASH && "no Git Bash on this machine" }, async () => {
    const hostile = ["*.js", "src/*", "{a,b}", "~", "it's", 'say "hi"', "back\\slash", "trailing\\", 'quote\\"mid', "C:\\path\\", "%PATH% !x ^y &z |w <v >u", "tab\there", "line1\nline2", "日本 héllo ✓", "$HOME `id` $(echo x)", "\\\\server\\share\\*", 'a\\\\"b', "'single' \"double\" 'mixed\""];
    for (const s of hostile) {
      const out = await runHand("bash", { command: `cat <<'FILAMENT_EOF'\n${s}\nFILAMENT_EOF` }, { root });
      assert.equal(out, s, JSON.stringify(s));
    }
  });
});

/**
 * The processes whose command line carries `marker`, as Windows lists them — read only, never stopped here.
 * @param {string} marker
 * @returns {{ ProcessId: number, Name: string }[]}
 */
const running = (marker) =>
  JSON.parse(
    execFileSync(
      String(POWERSHELL?.file),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.Name -ne 'powershell.exe' -and $_.Name -ne 'pwsh.exe' } | Select-Object ProcessId, Name)`],
      { encoding: "utf8", windowsHide: true },
    ).trim() || "[]",
  );
/** A sleep length no other process on the machine carries: 40 seconds and a random fraction, so a leak ends on its own. */
const marker = () => `40.${String(Math.random()).slice(2, 11).padEnd(9, "7")}`;

describe("stopping a command stops everything it started (TL-D3)", { skip: !(GIT_BASH && POWERSHELL) && "needs Git Bash and PowerShell" }, () => {
  // (fails before: taskkill /T from the shell missed what bash forked — Windows' process tree loses MSYS forks)
  test("a timeout takes the shell and its forks", async () => {
    const m = marker();
    await assert.rejects(() => runHand("bash", { command: `(sleep ${m} &) ; sleep ${m}; echo never`, timeout: 2 }, { root }), /timed out after 2 seconds/);
    await until(() => running(m).length === 0, "the forked sleeps to be gone", { timeoutMs: 8000 });
  });

  // (fails with one round: a fork that lands between the scan and its kill outlives the stop)
  test("a command forking as fast as it can is stopped with every fork, those that land while the stop runs too", async () => {
    const m = marker();
    await assert.rejects(() => runHand("bash", { command: `while :; do (sleep ${m} &); done`, timeout: 2 }, { root }), /timed out after 2 seconds/);
    // Some 150 forks, each killed the MSYS way, take this machine about 11 s (x25's probe of 11-24): 25 s still ends well
    // before a fork's 40 s sleep would end it alone.
    await until(() => running(m).length === 0, "every forked sleep to be gone", { timeoutMs: 25_000 });
  });

  // (fails when every tagged process is killed the MSYS way: a Windows program's own children are not MSYS's to see.
  // The inner node is detached: Node's job object would otherwise end it with its parent, however that one died.)
  test("a Windows program the command started is stopped with the programs it started in turn", async () => {
    const m = marker();
    const command = `node -e "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 40000)', '${m}'], { stdio: 'ignore', detached: true }); setTimeout(() => {}, 60000)"`;
    await assert.rejects(() => runHand("bash", { command, timeout: 3 }, { root }), /timed out after 3 seconds/);
    await until(() => running(m).length === 0, "node and the node it started to be gone", { timeoutMs: 8000 });
  });

  // (fails before: what a process printed after the call answered — here one no stop reaches, ticking until the stop
  // lets the pipes go — still reached the answered call's live tail)
  test("an answered call reads no more: nothing printed after it answered reaches the call", async () => {
    const m = marker();
    let answered = false;
    /** @type {string[]} */
    const late = [];
    const command = `(env -i /usr/bin/bash -c ': ${m}; while :; do echo tick; /usr/bin/sleep 0.02; done' &); sleep ${m}`;
    const call = runHand("bash", { command, timeout: 1 }, { root, onOutput: (/** @type {string} */ t) => answered && late.push(t) });
    await assert.rejects(() => call.finally(() => (answered = true)), /timed out after 1 seconds/);
    await until(() => running(m).length === 0, "the ticking process to die on the pipe let go", { timeoutMs: 10_000 });
    assert.deepEqual(late, []);
  });

  // (fails before: the untagged process kept the call's pipe — and with it the test's own process — open for good)
  // It is silent through the stop, then writes every half second: a write that lands while the stop still runs (it
  // runs longer under load) is drained unread, and the first after the pipe is let go is the one it dies on.
  test("a process no stop reaches — it cleared its environment, so carries no tag — dies on the pipe the stop let go", async () => {
    const m = marker();
    const command = `(env -i /usr/bin/bash -c ': ${m}; /usr/bin/sleep 2.5; for i in {1..80}; do echo late; /usr/bin/sleep 0.5; done' &); sleep ${m}`;
    await assert.rejects(() => runHand("bash", { command, timeout: 1 }, { root }), /timed out after 1 seconds/);
    await until(() => running(m).length === 0, "the untagged process to die on its next write", { timeoutMs: 10_000 });
  });

  test("the turn's stop takes them too", async () => {
    const m = marker();
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 1500).unref();
    await assert.rejects(() => runHand("bash", { command: `(sleep ${m} &) ; sleep ${m}` }, { root, signal: stop.signal }), /stopped with the turn/);
    await until(() => running(m).length === 0, "the forked sleeps to be gone", { timeoutMs: 8000 });
  });

  test("bash_kill stops a background shell with what it left running under nohup, and says so only once it has", async () => {
    const m = marker();
    const started = await runHand("bash_background", { command: `nohup sleep ${m} >/dev/null 2>&1 & sleep ${m}`, grace: 1 }, { root });
    const id = String(/bg_[0-9a-z]+/.exec(started)?.[0]);
    await until(() => running(m).filter((p) => p.Name === "sleep.exe").length === 2, "both sleeps to run", { timeoutMs: 8000 });
    assert.equal(await runHand("bash_kill", { id }, { root }), `Background shell ${id} stopped.`);
    assert.deepEqual(running(m), [], "nothing left the moment bash_kill answered");
  });

  // (fails before the tags pass safeEnv: the inner Filament's shell lost the outer tag, and its forks outlived the stop)
  test("a shell started inside another — an agent running Filament's own tests — is stopped with the outer one", async () => {
    const m = marker();
    const inner = join(root, "inner.mjs");
    const hands = pathToFileURL(fileURLToPath(new URL("../src/adapters/tools/hands.js", import.meta.url))).href;
    writeFileSync(inner, `import { runHand } from ${JSON.stringify(hands)};\nawait runHand("bash", { command: "(sleep ${m} &) ; sleep ${m}", timeout: 60 }, { root: ${JSON.stringify(root)} }).catch(() => {});\n`);
    await assert.rejects(() => runHand("bash", { command: `node "${inner.replace(/\\/g, "/")}"`, timeout: 4 }, { root }), /timed out after 4 seconds/);
    await until(() => running(m).length === 0, "the inner shell's forks to be gone", { timeoutMs: 8000 });
  });
});

describe("a shell's tag passes the scrubbed environment; nothing else of Filament's does", () => {
  test("FILAMENT_SHELL_<16 hex> is kept, every other FILAMENT_ variable dropped", () => {
    const keys = ["FILAMENT_SHELL_0123456789abcdef", "FILAMENT_SHELL_token", "FILAMENT_OTHER"];
    for (const k of keys) process.env[k] = "1";
    try {
      const env = safeEnv();
      assert.equal(env.FILAMENT_SHELL_0123456789abcdef, "1");
      assert.ok(!("FILAMENT_SHELL_token" in env), "a name that only looks like a tag is not one");
      assert.ok(!("FILAMENT_OTHER" in env));
      assert.ok(SHELL_TAG.test("FILAMENT_SHELL_0123456789abcdef") && !SHELL_TAG.test("FILAMENT_SHELL_0123"));
    } finally {
      for (const k of keys) delete process.env[k];
    }
  });
});

describe("the powershell hand (TL-D4)", { skip: !POWERSHELL && "no PowerShell on this machine" }, () => {
  const ps = (/** @type {string} */ command, /** @type {any} */ extra = {}) => runHand("powershell", { command, ...extra }, { root });
  /** @param {string} command */
  const failure = async (command) => {
    try {
      await ps(command);
    } catch (/** @type {any} */ e) {
      return { code: e.exitCode, text: String(e.message) };
    }
    return { code: 0, text: "" };
  };
  const scripts = () => readdirSync(tmpdir()).filter((n) => PS_SCRIPT_NAME.test(n)).length;
  /** @type {number} */
  let before0 = 0;
  before(() => {
    before0 = scripts();
  });

  // (fails before: no such hand; probed — -EncodedCommand wrote errors as #< CLIXML, -Command - read stdin in the OEM code page)
  test("UTF-8 out, the task folder as its working folder, `using` allowed on the first line", async () => {
    assert.equal(await ps("'héllo ✓ 日本'"), "héllo ✓ 日本\r");
    assert.equal((await ps("(Get-Location).Path")).trim().toLowerCase(), root.toLowerCase());
    assert.equal(await ps("using namespace System.Text\n[StringBuilder]::new('sb').ToString()"), "sb\r");
  });

  test("-Command's exit codes: exit N, 1 when the last command failed, 0 when a failure was not last", async () => {
    assert.deepEqual((await failure("'x'\nexit 3")).code, 3);
    const last = await failure("'x'\nGet-Item C:\\nope-not-here");
    assert.equal(last.code, 1);
    assert.match(last.text, /Cannot find path 'C:\\nope-not-here'/);
    assert.equal((await failure("throw 'boom'")).code, 1);
    assert.equal((await failure("cmd /c exit 5")).code, 1, "a native failure last is -Command's 1");
    assert.equal((await failure("if ($true) {\n 'a'\n")).code, 1, "a parse error fails");
    assert.equal(await ps("cmd /c exit 5\n'after'"), "after\r", "a failure that was not last is not the script's");
    assert.equal(await ps("'a' `"), "a\r", "a trailing backtick does not swallow the line that records the exit");
  });

  test("errors are plain text with the script's own line numbers, never CLIXML", async () => {
    const e = await failure("'one'\n'two'\nGet-Item C:\\nope3");
    assert.match(e.text, /filament-ps-[0-9a-z]+-[0-9a-z]+\.ps1:3 char:1/, e.text);
    assert.doesNotMatch(e.text, /CLIXML|<Objs/);
  });

  test("a timeout stops it; no script file is left behind", async () => {
    const t0 = Date.now();
    await assert.rejects(() => ps("Start-Sleep -Seconds 30", { timeout: 1 }), /timed out after 1 seconds?/);
    assert.ok(Date.now() - t0 < 6000, "answered at the timeout");
    await until(() => scripts() === before0, "the script files to be removed", { timeoutMs: 8000 });
  });
});

describe("cmd.exe, the fallback without Git for Windows, run for real", { skip: !WIN && "Windows only" }, () => {
  const cmd = resolveShell({ platform: "win32", env: { SystemRoot: String(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows") }, isFile: (p) => existsSync(p) && !/bash\.exe$/i.test(p) });
  test("the injected shell is cmd.exe; quoted arguments survive it; exit codes and the folder are its", async () => {
    assert.equal(cmd.kind, "cmd");
    assert.equal((await runHand("bash", { command: "echo %CD%" }, { root, shell: cmd })).trim().toLowerCase(), root.toLowerCase());
    assert.equal((await runHand("bash", { command: 'node -e "console.log(\'two\', 1 + 1)"' }, { root, shell: cmd })).trim(), "two 2");
    await assert.rejects(() => runHand("bash", { command: "echo oops 1>&2 & exit /b 3" }, { root, shell: cmd }), (e) => {
      assert.equal(/** @type {any} */ (e).exitCode, 3);
      assert.match(String(/** @type {any} */ (e).message), /oops/);
      return true;
    });
  });
});

describe("a PowerShell script file a crash left behind is swept like a spill file", () => {
  test("past 30 minutes it goes; a younger one may be another Filament's and stays", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-sweep-ps-"));
    const old = join(dir, "filament-ps-mabc1234-9f8e.ps1");
    const young = join(dir, "filament-ps-mabc1299-1a2b.ps1");
    const other = join(dir, "notes-ps-old.ps1");
    for (const f of [old, young, other]) writeFileSync(f, "x");
    const now = Date.now();
    utimesSync(old, new Date(now - 40 * 60_000), new Date(now - 40 * 60_000));
    utimesSync(other, new Date(now - 40 * 60_000), new Date(now - 40 * 60_000));
    assert.equal(sweepSpills({ dir, now }), 1);
    assert.deepEqual([existsSync(old), existsSync(young), existsSync(other)], [false, true, true]);
    return removeDirs(dir);
  });
});

describe("a rule on bash speaks for powershell, and the gate asks for it (TL-D5)", () => {
  test("a deny on any segment refuses the script; privacy.bashDeny too", () => {
    const deny = [{ tool: "bash", pattern: "rm *", verdict: /** @type {const} */ ("deny") }];
    assert.equal(ruleFor(deny, "powershell", { command: "Get-Date; rm -r build" })?.verdict, "deny");
    assert.equal(ruleFor(deny, "powershell", { command: "Get-Date\nrm -r build" })?.verdict, "deny", "a new line is a segment");
    assert.equal(ruleFor(rulesFrom({ privacy: { bashDeny: ["curl *"] } }), "powershell", { command: "curl http://x" })?.verdict, "deny");
  });

  test("an allow covers a plain command, never a subexpression; a learned bash permission covers it too", () => {
    const allow = [{ tool: "bash", pattern: "npm test*", verdict: /** @type {const} */ ("allow") }];
    assert.equal(ruleFor(allow, "powershell", { command: "npm test" })?.verdict, "allow");
    assert.equal(ruleFor(allow, "powershell", { command: "npm test $(Remove-Item x)" })?.verdict, "gate", "$( ) is never covered");
    const learned = [{ tool: "bash", pattern: "npm test", verdict: /** @type {const} */ ("allow"), learned: true }];
    assert.equal(ruleFor(learned, "powershell", { command: "npm test -- --grep x" })?.verdict, "allow");
    assert.deepEqual(permissionShape("powershell", { command: "npm test -- --watch" }), { tool: "bash", shape: "npm test", text: "bash: npm test" }, "approvals count as bash's");
  });

  test("the gate: read-only refuses, edit asks in PowerShell's words, auto runs", () => {
    assert.equal(gate("read-only", "powershell", { command: "Get-Process" }).verdict, "refuse");
    const g = gate("edit", "powershell", { command: "Get-Process" });
    assert.equal(g.verdict, "ask");
    assert.equal(/** @type {any} */ (g).question, "May I run this PowerShell script? `Get-Process` — answer /allow to run it, or say what to do instead.");
    assert.equal(gate("auto", "powershell", { command: "Get-Process" }).verdict, "run");
    assert.equal(argSummary("powershell", { command: "Get-Process   -Name node" }), "Get-Process -Name node");
  });
});

test("psScriptText: a BOM, the script, a blank line a trailing backtick may take, the line that records the exit", () => {
  assert.equal(psScriptText("'a'"), "\uFEFF'a'\n\n$FILAMENT_OK = $?\n");
});
