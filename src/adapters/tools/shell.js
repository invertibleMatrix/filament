// @ts-check
// The shells the agent's command tools run (HarnessV3-Tools TL-D1–D4): which one, how a command reaches it byte for
// byte, and how a running command is stopped with everything it started.
//
// On Windows the `bash` tool runs Git Bash: every model writes bash, and cmd.exe under a tool called "bash" had the
// agent writing grep, ls and /h/ paths into a shell that has none of them (HarnessV3-SystemPrompt). cmd.exe is the
// fallback on a machine without Git for Windows. The `powershell` tool runs PowerShell (pwsh when it is on the PATH,
// else Windows PowerShell 5.1) for what is PowerShell's on Windows: processes, services, the registry, .NET.
// Elsewhere `bash` is /bin/bash, or /bin/sh where there is none.
import { statSync, writeFileSync, rmSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { win32, join } from "node:path";
import { tmpdir } from "node:os";

/**
 * @typedef {object} Shell
 * @property {"git-bash" | "cmd" | "bash" | "sh"} kind
 * @property {string} name  as the tool's description and the Environment name it
 * @property {string} file  the program spawned
 */
/**
 * @typedef {object} PowerShell
 * @property {"pwsh" | "powershell"} kind  PowerShell 7 (pwsh), or Windows PowerShell 5.1
 * @property {string} name
 * @property {string} file
 */

const isFileAt = (/** @type {string} */ p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
/** A variable as Windows reads it: its names are case-insensitive, a plain object's keys are not. */
const winEnv = (/** @type {Record<string, string | undefined>} */ env, /** @type {string} */ name) => {
  const k = Object.keys(env).find((x) => x.toUpperCase() === name);
  return k ? env[k] : undefined;
};
const winPath = (/** @type {Record<string, string | undefined>} */ env) =>
  String(winEnv(env, "PATH") || "")
    .split(";")
    .map((d) => d.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);

/**
 * Git for Windows' bash launcher, `<Git>\bin\bash.exe`: it sets MSYSTEM and the PATH as Git means them. Found from the
 * first git on the PATH (Git keeps git in `<Git>\cmd`, `<Git>\bin` or `<Git>\mingw64\bin`), then in the usual install
 * folders. Never WSL's `System32\bash.exe`, which runs Linux.
 * @param {{ env?: Record<string, string | undefined>, isFile?: (path: string) => boolean }} [o]
 * @returns {string | null}
 */
export function findGitBash({ env = process.env, isFile = isFileAt } = {}) {
  /** @type {string[]} */
  const tops = [];
  const gitDir = winPath(env).find((d) => isFile(win32.join(d, "git.exe")));
  if (gitDir) tops.push(win32.dirname(gitDir), win32.dirname(win32.dirname(gitDir)));
  for (const [name, under] of /** @type {const} */ ([["PROGRAMFILES", "Git"], ["PROGRAMW6432", "Git"], ["LOCALAPPDATA", "Programs\\Git"]])) {
    const base = winEnv(env, name);
    if (base) tops.push(win32.join(base, under));
  }
  for (const top of tops) {
    const launcher = win32.join(top, "bin", "bash.exe");
    if (isFile(launcher)) return launcher;
  }
  return null;
}

/**
 * The shell the `bash` tool runs (TL-D1): Git Bash, else cmd.exe, on Windows; /bin/bash, else /bin/sh, elsewhere.
 * @param {{ platform?: string, env?: Record<string, string | undefined>, isFile?: (path: string) => boolean }} [o]
 * @returns {Shell}
 */
export function resolveShell({ platform = process.platform, env = process.env, isFile = isFileAt } = {}) {
  if (platform === "win32") {
    const gitBash = findGitBash({ env, isFile });
    if (gitBash) return { kind: "git-bash", name: "Git Bash", file: gitBash };
    return { kind: "cmd", name: "cmd.exe", file: win32.join(winEnv(env, "SYSTEMROOT") || "C:\\Windows", "System32", "cmd.exe") };
  }
  if (isFile("/bin/bash")) return { kind: "bash", name: "bash", file: "/bin/bash" };
  return { kind: "sh", name: "sh", file: "/bin/sh" };
}

/**
 * The PowerShell the `powershell` tool runs (TL-D4), on Windows only: pwsh when it is on the PATH, else Windows
 * PowerShell 5.1 from System32. Null elsewhere, and on a Windows without either.
 * @param {{ platform?: string, env?: Record<string, string | undefined>, isFile?: (path: string) => boolean }} [o]
 * @returns {PowerShell | null}
 */
export function resolvePowerShell({ platform = process.platform, env = process.env, isFile = isFileAt } = {}) {
  if (platform !== "win32") return null;
  const pwshDir = winPath(env).find((d) => isFile(win32.join(d, "pwsh.exe")));
  if (pwshDir) return { kind: "pwsh", name: "PowerShell 7 (pwsh)", file: win32.join(pwshDir, "pwsh.exe") };
  const legacy = win32.join(winEnv(env, "SYSTEMROOT") || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return isFile(legacy) ? { kind: "powershell", name: "Windows PowerShell 5.1", file: legacy } : null;
}

/** The shell this Filament's `bash` tool runs. */
export const SHELL = Object.freeze(resolveShell());
/** The PowerShell this Filament's `powershell` tool runs; null where there is no such tool. */
export const POWERSHELL = (() => {
  const ps = resolvePowerShell();
  return ps ? Object.freeze(ps) : null;
})();
/** The Git Bash a stop scans with (TL-D3) — whichever shell ran the command, since any of them may have started bash. */
const GIT_BASH = SHELL.kind === "git-bash" ? SHELL.file : null;

/**
 * A command as one argument the MSYS runtime reads back exactly (TL-D2). Node leaves an argument without a space
 * unquoted, and MSYS then globs it, expands its braces and `~`, strips its single quotes and splits it at a newline
 * (probed 2026-10-02). In double quotes with every `\` and `"` escaped, 28 hostile strings round-tripped exactly.
 * @param {string} s
 */
export const msysQuote = (s) => `"${String(s).replace(/[\\"]/g, "\\$&")}"`;

/**
 * One word on a POSIX shell's line, as the shell gives it back: as it is when nothing in it is special, else in single
 * quotes.
 * @param {unknown} s
 */
export function shellQuote(s) {
  const v = String(s ?? "");
  return /^[A-Za-z0-9_\/.:=@%+-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * A program and its arguments as one POSIX shell line, each word as the shell gives it back: what a person is asked
 * about for a terminal an agent wants, and the line such a shell runs (`terminalSpawn`).
 * @param {string} command @param {readonly string[]} args
 */
export const terminalLine = (command, args) => [command, ...args].map(shellQuote).join(" ");

/** cmd.exe's metacharacters, each escaped with a caret (cross-spawn's set). */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
/** An argument quoted as the C runtime splits a line: backslashes before a quote, and before the closing one, doubled. */
const crtQuoted = (/** @type {string} */ arg) =>
  `"${String(arg)
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, "$1$1")}"`;
/**
 * One argument on a cmd.exe line that runs a batch file (TL-D22): quoted as the C runtime splits it — backslashes
 * before a quote, and before the closing one, doubled (cross-spawn's patterns, https://qntm.org/cmd) — then every
 * metacharacter escaped twice: once for the /c line, once for the batch file's own `%*` or `%1`, which cmd parses
 * again. cross-spawn escapes twice only for shims under node_modules\.bin, but npx.cmd and every global npm shim
 * forward `%*` too: escaped once, an `x&y` ran `y` as a second command there (probed 2026-10-02, 16 hostile
 * arguments through a shim in each place; twice, all 16 arrived exactly).
 * @param {string} arg
 */
export const cmdArgument = (arg) => crtQuoted(arg).replace(CMD_META, "^$1").replace(CMD_META, "^$1");
/** One argument of a command cmd.exe runs itself: as it is when plain, else quoted and its metacharacters escaped once. */
const cmdWord = (/** @type {string} */ arg) => (/^[\w@+:./\\-]+$/.test(arg) ? arg : crtQuoted(arg).replace(CMD_META, "^$1"));
/**
 * cmd.exe's arguments for one line, for a spawn with windowsVerbatimArguments (r-hands, 11-12): `/d` — no AutoRun —,
 * then `/s /c` and the line inside the pair of quotes /s strips, so the line's own quotes stay. Without /s cmd.exe
 * keeps a line's quotes only where it holds exactly two: one that starts with a quoted program and quotes an argument
 * too lost its first quote and its last — `"C:\Program Files\nodejs\node.exe" "my script.js"` ran `C:\Program`
 * (probed 11-12: the loop's own cmd.exe and a hook's were started with `/c` alone; the terminal's had the pair). One
 * way for every line Filament hands cmd.exe.
 * @param {string} line
 */
export const cmdLine = (line) => ["/d", "/s", "/c", `"${line}"`];
/**
 * Windows' switch against the folder-first search, by its name (own-programs.js `FOLDER_SWITCH`; not imported from
 * there: that module sets the switch for the process that imports it), set ahead of a batch file's line.
 */
const PATH_ONLY = "set NoDefaultCurrentDirectoryInExePath=1&";
/** cmd.exe's own commands: it runs them itself, before any program of the same name. */
const CMD_BUILTINS = new Set(
  "assoc break call cd chdir cls color copy date del dir dpath echo endlocal erase exit for ftype goto if md mkdir mklink move path pause popd prompt pushd rd rem ren rename rmdir set setlocal shift start time title type ver verify vol".split(
    " ",
  ),
);

/**
 * `base` with `over` laid on it, as the platform reads names: on Windows a name in `over` replaces the one in `base`
 * in any case, so a server's `PATH` replaces the inherited `Path` instead of standing beside it, where which one the
 * lookup or the child read was down to key order.
 * @param {Record<string, string | undefined>} base @param {Record<string, string | undefined> | null | undefined} over
 * @param {string} [platform]
 */
export function withEnv(base, over, platform = process.platform) {
  const out = { ...base };
  if (platform === "win32")
    for (const name of Object.keys(over || {})) for (const k of Object.keys(out)) if (k !== name && k.toUpperCase() === name.toUpperCase()) delete out[k];
  return { ...out, ...(over || {}) };
}

/**
 * How to start a program a settings file names — an MCP server's `command` (TL-D22) — the way a shell finds it. On
 * Windows a bare name is looked up on the PATH with each of PATHEXT's extensions, so `npx` is npx.cmd: Node's spawn
 * tries only .exe and .com, and "command": "npx" from any README failed to start. A batch file (.cmd, .bat) runs
 * through cmd.exe with its arguments escaped for it (`cmdArgument`); `shell: true` would join them unquoted. The
 * folder the program runs in is not searched, as cmd.exe would: a folder Filament opens may be anyone's, so a program
 * in it is named by its path (`./tools/server.cmd`). Not found, the name is spawned as given and fails in Node's
 * words: Node's own search would look in that folder for `<name>.exe`, and does not in a process that has Windows'
 * switch against it, which Filament sets at its start (own-programs.js). Nor does the batch file's own cmd.exe look
 * there for what the file starts by a bare name (`startFound`, `own`). Elsewhere it is spawned as given.
 * @param {string} command @param {readonly string[]} args
 * @param {{ cwd: string, env?: Record<string, string | undefined>, platform?: string, isFile?: (path: string) => boolean }} o
 * @returns {{ file: string, args: string[], verbatim: boolean }}  `verbatim`: spawn with windowsVerbatimArguments
 */
export function programSpawn(command, args, { cwd, env = process.env, platform = process.platform, isFile = isFileAt }) {
  const plain = { file: command, args: [...args], verbatim: false };
  if (platform !== "win32" || !command) return plain;
  const file = findProgram(command, { cwd, env, isFile });
  return file ? startFound(file, args, env, { own: true }) : plain;
}

/**
 * The file `programSpawn` starts for a program's name, or null where nothing answers to it: on Windows as a shell
 * finds it (`findProgram`); elsewhere a path where it points, a bare name on the PATH.
 * @param {string} command
 * @param {{ cwd: string, env?: Record<string, string | undefined>, platform?: string, isFile?: (path: string) => boolean }} o
 * @returns {string | null}
 */
export function programFile(command, { cwd, env = process.env, platform = process.platform, isFile = isFileAt }) {
  if (!command) return null;
  if (platform === "win32") return findProgram(command, { cwd, env, isFile });
  if (command.startsWith("/")) return isFile(command) ? command : null;
  for (const dir of command.includes("/") ? [cwd] : String(env.PATH || "").split(":").filter(Boolean)) {
    const file = join(dir, command);
    if (isFile(file)) return file;
  }
  return null;
}

/**
 * How a terminal an agent asks for starts (ACP's `terminal/create` with arguments, the bug report's H16): each argument
 * arrives as it was sent. Elsewhere than Windows a POSIX shell runs `terminalLine`, so a builtin runs too. On Windows
 * one of cmd.exe's own commands (`echo`, `dir`) runs on a cmd.exe line, its arguments quoted and escaped once; any
 * other name starts as `programSpawn` starts it, found on the PATH, then in the folder it runs in, where cmd.exe would
 * find it too (a project's `gradlew`). Not found, it is spawned as given and fails in Node's words.
 * @param {string} command @param {readonly string[]} args
 * @param {{ cwd: string, env?: Record<string, string | undefined>, platform?: string, isFile?: (path: string) => boolean }} o
 * @returns {{ file: string, args: string[], verbatim: boolean }}  `verbatim`: spawn with windowsVerbatimArguments
 */
export function terminalSpawn(command, args, { cwd, env = process.env, platform = process.platform, isFile = isFileAt }) {
  if (platform !== "win32") return { file: "/bin/sh", args: ["-c", terminalLine(command, args)], verbatim: false };
  if (CMD_BUILTINS.has(command.toLowerCase())) {
    const line = [command, ...args.map(cmdWord)].join(" ");
    return { file: winEnv(env, "COMSPEC") || "cmd.exe", args: cmdLine(line), verbatim: true };
  }
  const file = command ? findProgram(command, { cwd, env, isFile, here: true }) : null;
  return file ? startFound(file, args, env) : { file: command, args: [...args], verbatim: false };
}

/**
 * The file a program's name opens on Windows, as a shell finds it: a bare name on the PATH with each of PATHEXT's
 * extensions (then in the folder it runs in, with `here`), a path where it points. Null when nothing answers to it.
 * @param {string} command
 * @param {{ cwd: string, env: Record<string, string | undefined>, isFile: (path: string) => boolean, here?: boolean }} o
 * @returns {string | null}
 */
function findProgram(command, { cwd, env, isFile, here = false }) {
  const exts = String(winEnv(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const names = exts.includes(win32.extname(command).toLowerCase()) ? [command] : exts.map((e) => command + e);
  const where = /[\\/:]/.test(command) ? [win32.resolve(cwd)] : [...winPath(env), ...(here ? [win32.resolve(cwd)] : [])];
  for (const dir of where)
    for (const name of names) {
      const file = win32.resolve(dir, name);
      if (isFile(file)) return file;
    }
  return null;
}

/**
 * A program found on Windows, as it starts: an .exe as itself, a batch file through cmd.exe with its arguments escaped
 * for it (`cmdArgument`).
 * `own`: one of Filament's own programs — an MCP server, a language server, a dashboard's command, a script watcher's
 * (`programSpawn`) —, whose cmd.exe sets Windows' switch before the file runs (r-hands, 11-12). cmd.exe looks for a
 * bare name in the folder it runs in before the PATH, and a shim starts its interpreter by one: npm's, with no
 * node.exe beside it, runs `node`. In a project's folder that started the folder's own `node.cmd` as the person
 * (probed 11-12: a shim calling `node`, a `node.cmd` in the folder that wrote a file — written; with the switch, not,
 * and the PATH's node ran). The switch Filament sets for its own process (own-programs.js) never reached this cmd.exe:
 * the hands' environment is a list of names (hands.js `safeEnv`) and the switch is not on it. cmd.exe reads it from
 * its own environment at each search, so the line sets it first, here, for every caller; the batch file's exit code
 * and its arguments come through as they did (probed with `exit /b`, a last command's code, npm's own shim and 16
 * hostile arguments). What the file starts inherits it, as Filament's own process has it. An agent's terminal
 * (`terminalSpawn`) goes without: its command is a shell's, which finds a folder's program as the person's does.
 * @param {string} file @param {readonly string[]} args @param {Record<string, string | undefined>} env
 * @param {{ own?: boolean }} [o]
 * @returns {{ file: string, args: string[], verbatim: boolean }}
 */
function startFound(file, args, env, { own = false } = {}) {
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args: [...args], verbatim: false };
  const line = [file.replace(CMD_META, "^$1"), ...args.map(cmdArgument)].join(" ");
  return { file: winEnv(env, "COMSPEC") || "cmd.exe", args: cmdLine(`${own ? PATH_ONLY : ""}${line}`), verbatim: true };
}

/**
 * The variable that marks a shell started on Windows and everything it starts (TL-D3): `FILAMENT_SHELL_<16 hex>=1`.
 * A shell started inside another keeps the outer's tag beside its own (hands' `safeEnv` lets the tags through), so
 * stopping the outer one stops the inner one's processes too — an agent running Filament's own tests is that case.
 */
export const SHELL_TAG = /^FILAMENT_SHELL_[0-9a-f]{16}$/;

/** A PowerShell script's temporary file: `filament-ps-<base36 time>-<4 chars>.ps1`, in the system's temp folder. */
export const PS_SCRIPT_NAME = /^filament-ps-[0-9a-z]+-[0-9a-z]+\.ps1$/;
const PS_ARGS = Object.freeze(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]);
/**
 * The fixed command a PowerShell script runs under (TL-D4, probed 2026-10-02). The script is dot-sourced from a file:
 * `-EncodedCommand` writes errors as `#< CLIXML` and repeats the whole script in each Write-Error, and `-Command -`
 * reads stdin in the OEM code page and line by line. From a file, errors are plain text with the script's own line
 * numbers, and `using` may open it. Output is UTF-8, progress records are off. The exit code is `-Command`'s: `exit N`
 * gives N, a script whose last command failed gives 1 (the file's last line records that `$?`), else 0.
 * @param {string} file
 */
const psCommand = (file) =>
  [
    "$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; $FILAMENT_OK = $null",
    `. '${file.replaceAll("'", "''")}'; $FILAMENT_RAN = $?`,
    "if ($FILAMENT_OK -eq $false) { exit 1 } elseif ($null -ne $FILAMENT_OK) { exit 0 } elseif ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $FILAMENT_RAN) { exit 1 } else { exit 0 }",
  ].join("\n");
/**
 * The script as its file holds it: a BOM (5.1 reads a file without one in the ANSI code page), then a blank line — a
 * trailing backtick continues onto it, not onto the record — and the line that records the last command's `$?`.
 * @param {string} script
 */
export const psScriptText = (script) => `\uFEFF${script}\n\n$FILAMENT_OK = $?\n`;

/**
 * How a command is spawned in `shell`. Windows gets the command line verbatim: cmd.exe does not read the C runtime's
 * `\"` quoting Node would add — it gets the line as every cmd.exe of Filament's does (`cmdLine`) —, and Git Bash gets
 * `msysQuote`'s; `argv0` keeps the launcher's own path (it has a space) out of the line. POSIX shells lead a process
 * group, so a stop takes the group.
 * @param {Shell | PowerShell} shell @param {string} command @param {string | null} scriptFile  PowerShell's
 * @returns {{ args: string[], options: import("node:child_process").SpawnOptions }}
 */
function invocation(shell, command, scriptFile) {
  switch (shell.kind) {
    case "git-bash":
      return { args: ["-c", msysQuote(command)], options: { windowsVerbatimArguments: true, argv0: "bash" } };
    case "cmd":
      return { args: cmdLine(command), options: { windowsVerbatimArguments: true } };
    case "pwsh":
    case "powershell":
      return { args: [...PS_ARGS, psCommand(/** @type {string} */ (scriptFile))], options: {} };
    default:
      return { args: ["-c", command], options: { detached: true } };
  }
}

/**
 * Start `command` in `shell`, in `cwd`, stdin closed and both output streams piped. Answers the process and `stop`,
 * which stops it with everything it started. A PowerShell script goes through a temporary file, removed when the
 * process exits. Throws when the shell cannot be spawned at all.
 * @param {Shell | PowerShell} shell @param {string} command
 * @param {{ cwd: string, env: Record<string, string | undefined>, platform?: string }} o
 */
export function startCommand(shell, command, { cwd, env, platform = process.platform }) {
  const tag = platform === "win32" ? `FILAMENT_SHELL_${randomBytes(8).toString("hex")}` : null;
  const ps = shell.kind === "pwsh" || shell.kind === "powershell";
  const scriptFile = ps ? join(tmpdir(), `filament-ps-${Date.now().toString(36)}-${randomBytes(3).toString("hex").slice(0, 4)}.ps1`) : null;
  const removeScript = () => {
    if (scriptFile)
      try {
        rmSync(scriptFile, { force: true });
      } catch {}
  };
  // Its owner's alone (pwsh runs on Linux too, whose temp folder is every account's): the script is the command.
  if (scriptFile) writeFileSync(scriptFile, psScriptText(command), { encoding: "utf8", mode: 0o600 });
  const { args, options } = invocation(shell, command, scriptFile);
  let proc;
  try {
    proc = spawn(shell.file, args, { cwd, env: tag ? { ...env, [tag]: "1" } : env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...options });
  } catch (e) {
    removeScript();
    throw e;
  }
  if (scriptFile) {
    proc.once("exit", removeScript);
    proc.once("error", removeScript);
  }
  // A stopped command's output pipes are let go once the stop has run: a process no stop reaches (one that cleared
  // its environment, so carries no tag, or left the process group) holds no Filament handle open, and its next write
  // fails on the broken pipe.
  const stop = async () => {
    await stopTree(proc, tag, platform);
    proc.stdout?.destroy();
    proc.stderr?.destroy();
  };
  return { proc, stop };
}

const TASKKILL = () => win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows", "System32", "taskkill.exe");
/**
 * One pass of the stop (TL-D3), in bash builtins only (no PATH is needed): every process MSYS knows whose environment
 * carries the tag `$1`. One that runs the MSYS runtime (msys-2.0.dll in its maps) is killed there and then the MSYS
 * way — kill -9 waits out a fork in progress, where taskkill killed the parent mid-fork and left the half-born child
 * running for good, invisible to MSYS and lost to Windows' tree (probed: 2 of 8 stops of a forking loop leaked one;
 * none this way). A Windows program a bash started (node, npm) is not killed here but named by its Windows id, for
 * taskkill /T to take with the processes it started, which MSYS never sees. "msys" stands for each killed.
 */
const TAG_STOP =
  'for d in /proc/[0-9]*; do while IFS= read -r -d "" v; do if [ "$v" = "$1=1" ]; then rt=; while read -r m; do case "$m" in *msys-2.0.dll*) rt=1; break;; esac; done 2>/dev/null < "$d/maps"; if [ -n "$rt" ]; then kill -9 "${d#/proc/}" 2>/dev/null; echo msys; else read -r w < "$d/winpid"; echo "$w"; fi; break; fi; done 2>/dev/null < "$d/environ"; done';
const SCAN_TIMEOUT_MS = 5_000;

/**
 * Run one pass of TAG_STOP for `tag`: whether it found any tagged process, and the Windows ids of the Windows
 * programs among them, left for taskkill. Nothing found when the pass cannot run.
 * @param {string} tag @param {string} gitBash
 * @returns {Promise<{ found: boolean, programs: string[] }>}
 */
const stopTagged = (tag, gitBash) =>
  new Promise((done) => {
    let out = "";
    const finish = () => {
      clearTimeout(timer);
      const lines = out.split(/\s+/).filter(Boolean);
      done({ found: lines.length > 0, programs: lines.filter((w) => /^\d+$/.test(w)) });
    };
    const timer = setTimeout(() => {
      try {
        scan?.kill();
      } catch {}
      // Its output pipe is let go with it: the kill ends Git Bash's launcher alone, and the bash that launcher started,
      // still scanning, held the pipe — and the process of Filament, or of a test, with it — until it ended (11-11).
      scan?.stdout?.destroy();
      finish();
    }, SCAN_TIMEOUT_MS);
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let scan;
    try {
      // spawn, not execFile: execFile passes on neither argv0 nor the verbatim line's need for it.
      scan = spawn(gitBash, ["-c", msysQuote(TAG_STOP), "_", tag], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, windowsVerbatimArguments: true, argv0: "bash" });
      scan.stdout?.on("data", (d) => (out += d));
      scan.on("close", finish);
      scan.on("error", finish);
    } catch {
      finish();
    }
  });

/** taskkill /F /T over `pids`: each with the native processes under it. @param {string[]} pids */
const taskkill = (pids) =>
  new Promise((done) => {
    try {
      execFile(TASKKILL(), ["/F", "/T", ...pids.flatMap((p) => ["/PID", p])], { windowsHide: true }, () => done(undefined));
    } catch {
      done(undefined);
    }
  });

/**
 * Stop a started command with everything it started (TL-D3). POSIX: its process group. Windows: first every MSYS
 * process carrying its tag, killed the MSYS way (TAG_STOP) — Git Bash's forks are orphaned in Windows' process tree,
 * so /T from the shell alone misses them — then taskkill /T over the tagged Windows programs and the shell itself.
 * The pass repeats while it still finds any (a fork that kill -9 waited out is the next pass's), three at most. Only
 * the process Filament spawned — while Node still holds it, so its id cannot have been reused — and processes carrying
 * its random tag are ever stopped.
 * @param {import("node:child_process").ChildProcess} proc @param {string | null} tag @param {string} platform
 */
async function stopTree(proc, tag, platform) {
  if (platform !== "win32") {
    try {
      if (proc.pid != null) process.kill(-proc.pid, "SIGKILL");
    } catch {}
    return;
  }
  for (let round = 0; round < 3; round++) {
    const { found, programs } = GIT_BASH && tag ? await stopTagged(tag, GIT_BASH) : { found: false, programs: [] };
    const live = proc.pid != null && proc.exitCode === null && proc.signalCode === null;
    const pids = [...(live ? [String(proc.pid)] : []), ...programs];
    if (pids.length) await taskkill(pids);
    if (!found) return;
  }
}
