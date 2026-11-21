// @ts-check
// HarnessV3-SystemPrompt: the loop's Environment section — what the capture reads (the clock, the system, the PATH, the
// folder's git state and project files), what the section says from it, and how it is held still for a session. The
// prompt's sections and the freeze through a real loop turn are in system-prompt.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  clockOf,
  systemOf,
  shFlavor,
  pathToolsOf,
  harnessCommand,
  cliCommand,
  gitFactsOf,
  projectFactsOf,
  captureEnvironment,
  cachedCapture,
  createEnvironmentKeeper,
  environmentText,
  environmentSummary,
  ENVIRONMENT_VERSION,
} from "../src/app/agent/environment.js";
import { HAND_TOOLS, bashDescription } from "../src/adapters/tools/hands.js";
import { SHELL, POWERSHELL } from "../src/adapters/tools/shell.js";

/** @type {string[]} */
const dirs = [];
const tmp = (/** @type {string} */ tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-env-${tag}-`));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
});

/** A whole set of facts to render, with the parts a test changes. @param {any} [o] @returns {any} */
const facts = (o = {}) => ({
  v: ENVIRONMENT_VERSION,
  root: "H:\\proj",
  clock: { weekday: "Friday", date: "2026-10-02", time: "09:05", zone: "Asia/Karachi", offset: "UTC+05:00" },
  system: { name: "Windows 11 Pro", kernel: "10.0.26200", arch: "x64", locale: "en-US" },
  shell: { kind: "cmd", name: "cmd.exe", file: "C:\\Windows\\System32\\cmd.exe", flavor: null },
  powershell: { kind: "powershell", name: "Windows PowerShell 5.1", file: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
  path: { on: ["git", "node", "powershell"], unixOn: [], unixOff: ["grep", "ls", "cat"], wslBash: false, platform: "win32" },
  harness: { command: "node bin/filament.js", listen: "127.0.0.1:20300" },
  git: { repo: "H:/proj", error: null, branch: "main", head: null, upstream: null, ahead: 0, behind: 0, main: "main", user: "Ada", status: [], changed: 0, commits: [] },
  project: null,
  ...o,
});

describe("what the section says", () => {
  // (fails before: the prompt said "bash for commands" and nothing else — on Windows the tool runs cmd.exe)
  test("cmd.exe, the fallback without Git for Windows: named as not bash, its syntax and paths, and the Unix tools this PATH lacks", () => {
    const t = environmentText(facts());
    assert.match(t, /^# Environment\n/);
    assert.match(t, /the bash tool runs cmd\.exe, Windows' command prompt — not bash/);
    assert.match(t, /Paths are Windows paths — H:\\proj, or relative ones like src\\app\.js; Unix forms like \/c\/Users, \/h\/project or ~ are not paths here/);
    assert.match(t, /- Not on PATH: grep, ls, cat — use the read, grep and glob tools for files, or the powershell tool for scripting\./);
    assert.match(environmentText(facts({ powershell: null })), /- Not on PATH: grep, ls, cat — use the read, grep and glob tools for files\.\n/, "no PowerShell, no such tool named");
    assert.match(t, /for the time now, run echo %date% %time%/);
    const some = environmentText(facts({ path: { ...facts().path, unixOn: ["grep"], unixOff: ["ls"] } }));
    assert.match(some, /- Unix tools on PATH: grep — they run, but cmd parses the line: quote with double quotes, never single\. Not on PATH: ls\./);
    assert.doesNotMatch(some, /use the read, grep and glob tools/);
  });

  // (fails before: Windows had cmd.exe under the name bash, and Git Bash only as a hint to run "bash.exe -lc" by hand)
  test("Git Bash, the bash tool on Windows: real bash, the folder in both spellings, which one Windows programs take", () => {
    const gb = environmentText(facts({ shell: { kind: "git-bash", name: "Git Bash", file: "C:\\Program Files\\Git\\bin\\bash.exe", flavor: null } }));
    assert.match(gb, /- Shell: the bash tool runs Git Bash \(C:\\Program Files\\Git\\bin\\bash\.exe\) — real bash on Windows, with grep, sed, awk, find/);
    assert.match(gb, /The working folder is H:\/proj to Windows and \/h\/proj to bash; give Windows programs \(node, npm, git, python\) the H:\/proj form — bash converts \/h\/proj only where it stands alone as an argument/);
    assert.match(gb, /Write \/dev\/null, never NUL\. cmd's built-ins \(dir, type, copy\) are not commands here — cmd \/\/c "…" runs one\./);
    assert.doesNotMatch(gb, /Not on PATH|Unix tools on PATH|WSL/, "Git Bash brings its own Unix tools; the Windows PATH's are cmd's business");
    assert.match(gb, /for the time now, run date;/);
    const unc = environmentText(facts({ root: "\\\\srv\\share\\proj", shell: { kind: "git-bash", name: "Git Bash", file: "C:\\Git\\bin\\bash.exe", flavor: null } }));
    assert.match(unc, /The working folder is \/\/srv\/share\/proj to Windows and \/\/srv\/share\/proj to bash/, "a share has no drive letter to fold");
  });

  test("the powershell tool's line names its edition; WSL's bash and the POSIX shells get their own lines", () => {
    assert.match(environmentText(facts()), /- PowerShell: the powershell tool runs Windows PowerShell 5\.1 \(C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe\) — for processes with their command lines, services, the registry and \.NET; 5\.1 has no &&, \|\|, ternary or \?\?\./);
    const pwsh = environmentText(facts({ powershell: { kind: "pwsh", name: "PowerShell 7 (pwsh)", file: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" } }));
    assert.match(pwsh, /- PowerShell: the powershell tool runs PowerShell 7 \(pwsh\) \(C:\\Program Files\\PowerShell\\7\\pwsh\.exe\) — for processes with their command lines, services, the registry and \.NET\.\n/);
    assert.doesNotMatch(environmentText(facts({ powershell: null })), /- PowerShell:/);
    const wsl = environmentText(facts({ path: { ...facts().path, wslBash: true } }));
    assert.match(wsl, /The bash on PATH is WSL's/);
    const posix = { powershell: null, path: { ...facts().path, platform: "linux", unixOn: [], unixOff: [] }, root: "/home/ada/proj" };
    const sh = environmentText(facts({ ...posix, shell: { kind: "sh", name: "sh", file: "/bin/sh", flavor: "dash" } }));
    assert.match(sh, /- Shell: the bash tool runs \/bin\/sh -c, which is dash here — POSIX sh: bash-only syntax/);
    assert.doesNotMatch(sh, /cmd\.exe|Not on PATH|PowerShell/);
    assert.match(sh, /for the time now, run date;/);
    const bash = environmentText(facts({ ...posix, shell: { kind: "bash", name: "bash", file: "/bin/bash", flavor: null } }));
    assert.match(bash, /- Shell: the bash tool runs \/bin\/bash -c \(not a login shell: your profile's aliases and functions are not loaded\)\.\n/);
  });

  test("the clock, the model and window, the system and Filament itself", () => {
    const t = environmentText(facts(), { model: "brain-1", window: 1_000_000 });
    assert.match(t, /Captured when this session started: Friday 2026-10-02, 09:05 \(Asia\/Karachi, UTC\+05:00\)\. None of it updates/);
    assert.match(t, /- Model: brain-1, through Filament; context window 1,000,000 tokens/);
    assert.match(t, /- System: Windows 11 Pro \(10\.0\.26200, x64\); locale en-US/);
    assert.match(t, /- Filament, the harness you run in: node bin\/filament\.js on 127\.0\.0\.1:20300\. Never stop or restart it — your own turn ends with it\.\n/, "a capture stored before its command line says none");
    const cli = environmentText(facts({ harness: { command: "node bin/filament.js", listen: "127.0.0.1:20300", cli: "node H:/f/bin/filament.js" } }));
    assert.match(cli, /your own turn ends with it\. Its command line: `node H:\/f\/bin\/filament\.js --help` — status, models, keys, coding agents, memory, settings\.\n/);
    assert.doesNotMatch(environmentText(facts()), /- Model:/, "no model, no line (the Prompts page's preview)");
    assert.match(environmentText(facts(), { model: "m" }), /- Model: m, through Filament\n/, "an unknown window is not named");
  });

  test("the folder's git state: clean, changed with the rest counted, tracking, detached, inside a bigger repository, unreadable", () => {
    assert.match(environmentText(facts()), /- Working folder: H:\\proj — a git repository, branch main; main branch: main; git user: Ada\n- Git status at start: clean/);
    const busy = facts({ git: { ...facts().git, upstream: "origin/main", ahead: 2, behind: 1, status: ["M a.js", "?? b.txt"], changed: 7, commits: [{ short: "abc1234", subject: "fix the thing" }] } });
    const t = environmentText(busy);
    assert.match(t, /branch main \(tracking origin\/main: 2 ahead, 1 behind\)/);
    assert.match(t, /- Git status at start: 7 changed — M a\.js, \?\? b\.txt, and 5 more/);
    assert.match(t, /- Recent commits:\n  abc1234 fix the thing/);
    assert.match(environmentText(facts({ git: { ...facts().git, upstream: "origin/main" } })), /\(tracking origin\/main, up to date\)/);
    assert.match(environmentText(facts({ git: { ...facts().git, branch: null, head: "abc1234" } })), /detached at abc1234/);
    assert.match(environmentText(facts({ root: "H:\\proj\\pkg" })), /- Working folder: H:\\proj\\pkg — inside the git repository at H:\\proj,/);
    assert.match(environmentText(facts({ git: { repo: null, error: null } })), /- Working folder: H:\\proj — not a git repository/);
    assert.match(environmentText(facts({ git: { repo: null, error: "git is not installed or not on PATH" } })), /— git: git is not installed or not on PATH/);
    assert.match(environmentText(facts({ root: "" })), /- Working folder: named when a session starts/);
  });

  test("the project: manifests with their package manager, the scripts and how to run them, Make targets, the top level", () => {
    const pj = { manifests: ["package.json", "Makefile"], node: { manager: "pnpm", lock: "pnpm-lock.yaml" }, python: null, scripts: [["test", "vitest run"]], moreScripts: 3, targets: ["build", "lint"], top: ["src/", "package.json"], moreTop: 2 };
    const t = environmentText(facts({ project: pj }));
    assert.match(t, /- Project files: package\.json, Makefile \(pnpm, from pnpm-lock\.yaml\)/);
    assert.match(t, /- Scripts \(pnpm run <name>\):\n  test: vitest run\n  … and 3 more in package\.json/);
    assert.match(t, /- Make targets: build, lint/);
    assert.match(t, /- Top level: src\/, package\.json, and 2 more/);
    assert.match(environmentText(facts({ project: { ...pj, node: { manager: "yarn", lock: "yarn.lock" } } })), /- Scripts \(yarn <name>\):/);
    assert.match(environmentText(facts({ project: { ...pj, node: null } })), /- Scripts \(npm run <name>\):/, "no lockfile: npm's words");
  });

  test("the board's few words", () => {
    assert.deepEqual(environmentSummary(facts()), { system: "Windows 11 Pro", shell: "cmd.exe", zone: "Asia/Karachi", git: "main, clean" });
    assert.equal(environmentSummary(facts({ git: { ...facts().git, changed: 3 } }))?.git, "main, 3 changed");
    assert.equal(environmentSummary(facts({ git: { repo: null, error: null } }))?.git, null);
    assert.equal(environmentSummary(null), null);
  });
});

describe("what the capture reads", () => {
  test("the clock: local date, weekday and time, the zone and the UTC offset", () => {
    const d = new Date(2026, 9, 2, 9, 5);
    const c = clockOf(d, "Asia/Karachi");
    assert.equal(c.date, "2026-10-02");
    assert.equal(c.weekday, "Friday");
    assert.equal(c.time, "09:05");
    assert.equal(c.zone, "Asia/Karachi");
    const off = -d.getTimezoneOffset();
    assert.equal(c.offset, `UTC${off >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`);
  });

  test("the system by its owner's name: Windows' product name, macOS's version file, a distribution's PRETTY_NAME", () => {
    assert.equal(systemOf({ platform: "win32", version: "Windows 11 Pro", release: "10.0.26200", arch: "x64" }).name, "Windows 11 Pro");
    const mac = systemOf({ platform: "darwin", release: "24.1.0", arch: "arm64", readText: () => "<key>ProductVersion</key>\n\t<string>15.1</string>" });
    assert.deepEqual([mac.name, mac.kernel], ["macOS 15.1", "Darwin 24.1.0"]);
    const linux = systemOf({ platform: "linux", release: "6.8.0", arch: "x64", readText: () => 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n' });
    assert.deepEqual([linux.name, linux.kernel], ["Ubuntu 24.04.1 LTS", "Linux 6.8.0"]);
    assert.equal(systemOf({ platform: "linux", release: "6", arch: "x64", readText: () => { throw new Error("no file"); } }).name, "Linux");
  });

  test("what /bin/sh is underneath", () => {
    assert.equal(shFlavor(() => "/usr/bin/dash"), "dash");
    assert.equal(shFlavor(() => "/bin/sh"), null);
    assert.equal(shFlavor(() => { throw new Error("none"); }), null);
  });

  // (fails before: nothing said which tools the shell could reach — the agent ran grep and ls where neither existed)
  test("the PATH, as Windows reads it: PATHEXT, any case, the first folder wins; nothing outside PATHEXT", async () => {
    const a = tmp("path-a");
    const b = tmp("path-b");
    writeFileSync(join(a, "GREP.EXE"), "");
    writeFileSync(join(a, "node.cmd"), "");
    writeFileSync(join(a, "ls.txt"), "");
    writeFileSync(join(b, "node.exe"), "");
    writeFileSync(join(b, "git.exe"), "");
    const p = await pathToolsOf({ env: { Path: `${a};${b}`, PATHEXT: ".EXE;.CMD" }, platform: "win32" });
    assert.deepEqual(p.on, ["git", "node"], "known tools in their fixed order; ls.txt is not a program");
    assert.deepEqual(p.unixOn, ["grep"]);
    assert.ok(p.unixOff.includes("ls") && p.unixOff.includes("sed"));
  });

  test("WSL's bash on the PATH is told for what it is (Git Bash is found by the shell itself — shell.test.js)", async () => {
    const sys = tmp("sysroot");
    writeFileSync(join(sys, "bash.exe"), "");
    assert.equal((await pathToolsOf({ env: { PATH: sys, PATHEXT: ".EXE", SystemRoot: sys }, platform: "win32" })).wslBash, true);
    const other = tmp("otherbash");
    writeFileSync(join(other, "bash.exe"), "");
    assert.equal((await pathToolsOf({ env: { PATH: other, PATHEXT: ".EXE", SystemRoot: sys }, platform: "win32" })).wslBash, false);
  });

  test("on POSIX a file must be executable to count, and the Unix tools are not listed apart", async () => {
    const d = tmp("posix");
    writeFileSync(join(d, "git"), "", { mode: 0o644 });
    const p = await pathToolsOf({ env: { PATH: d }, platform: "linux" });
    assert.deepEqual(p.on, [], "a plain file named git is not a program");
    assert.deepEqual([p.unixOn, p.unixOff], [[], []]);
  });

  // (fails before: yes — an agent had no word of Filament's own command line, and ran the harness's line to ask it)
  test("Filament's command line as the agent's shell runs it: the installed app's shim beside it, else the harness's node and script — slashes forward, its data folder where it is not the default", () => {
    const win = { platform: "win32", electron: false, execPath: "C:\\Program Files\\nodejs\\node.exe", script: "H:\\filament\\bin\\filament.js", exists: () => true };
    assert.equal(cliCommand(win), '"C:/Program Files/nodejs/node.exe" H:/filament/bin/filament.js', "its own script, never the argv of whatever runs it (a test)");
    const app = { ...win, electron: true, execPath: "C:\\Users\\a b\\Filament\\Filament.exe" };
    assert.equal(cliCommand(app), '"C:/Users/a b/Filament/bin/filament"');
    // (fails before: yes — the review of 9fc83b83a: the app run from its checkout named a bin/filament beside Electron's own program, which is none)
    assert.equal(cliCommand({ ...app, execPath: "H:\\f\\node_modules\\electron\\dist\\electron.exe", exists: () => false }), "ELECTRON_RUN_AS_NODE=1 H:/f/node_modules/electron/dist/electron.exe H:/filament/bin/filament.js");
    assert.equal(cliCommand({ ...win, dataDir: "D:\\data dir" }), '"C:/Program Files/nodejs/node.exe" H:/filament/bin/filament.js --data-dir "D:/data dir"');
    assert.equal(cliCommand({ platform: "linux", electron: false, execPath: "/usr/bin/node", script: "/opt/f/bin/filament.js" }), "/usr/bin/node /opt/f/bin/filament.js");
  });

  test("Filament's own command line, quoted where a path has a space", () => {
    assert.equal(harnessCommand(["C:\\Program Files\\nodejs\\node.exe", "H:\\filament\\bin\\filament.js", "--port", "1"]), '"C:\\Program Files\\nodejs\\node.exe" H:\\filament\\bin\\filament.js');
  });

  describe("a real git repository", () => {
    /** @type {string} */
    let repo;
    before(() => {
      repo = tmp("git");
      const g = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
      g("init", "-q", "-b", "main");
      g("config", "user.name", "Ada Test");
      g("config", "user.email", "ada@example.invalid");
      g("config", "commit.gpgsign", "false");
      writeFileSync(join(repo, "a.txt"), "one\n");
      g("add", "a.txt");
      g("commit", "-q", "-m", "first commit");
      writeFileSync(join(repo, "a.txt"), "two\n");
      writeFileSync(join(repo, "new.txt"), "x\n");
      mkdirSync(join(repo, "sub"));
    });

    test("the repository, branch, main branch, user, status and commits", async () => {
      const f = await gitFactsOf(repo);
      assert.equal(f.error, null);
      assert.ok(f.repo, "inside a repository");
      assert.equal(f.branch, "main");
      assert.equal(f.main, "main", "no origin: the local main branch");
      assert.equal(f.user, "Ada Test");
      assert.deepEqual(f.status, ["M a.txt", "?? new.txt"]);
      assert.equal(f.changed, 2);
      assert.deepEqual(f.commits?.map((c) => c.subject), ["first commit"]);
    });

    test("read with optional locks off, so a status never takes the index lock the developer's git needs", async () => {
      /** @type {any[]} */
      const seen = [];
      /** @type {any} */
      const run = async (/** @type {string[]} */ args, /** @type {any} */ o) => {
        seen.push(o.env);
        return args[0] === "rev-parse" ? { code: 0, out: repo, err: "", error: null } : { code: 0, out: "", err: "", error: null };
      };
      await gitFactsOf(repo, { run });
      assert.ok(seen.length >= 2 && seen.every((e) => e?.GIT_OPTIONAL_LOCKS === "0"), JSON.stringify(seen));
    });

    test("outside a repository, a folder that is not there, and git missing", async () => {
      assert.deepEqual(await gitFactsOf(tmp("norepo")), { repo: null, error: null });
      // Settings → Prompts previews the first agent root, which may be gone: git's spawn fails as it does for a missing
      // git, and the line must not blame git.
      assert.deepEqual(await gitFactsOf(join(tmp("norepo"), "gone")), { repo: null, error: "the folder does not exist" });
      /** @type {any} */
      const missing = async () => ({ code: -1, out: "", err: "", error: "git is not installed or not on PATH" });
      assert.deepEqual(await gitFactsOf(repo, { run: missing }), { repo: null, error: "git is not installed or not on PATH" });
    });

    test("a whole capture: the folder's facts, the machine's, and the shell the hands really run", async () => {
      const f = await captureEnvironment(repo, { now: new Date(2026, 0, 5, 9, 30), listen: "127.0.0.1:1", command: "node x.js", cli: "node x.js" });
      assert.equal(f.v, ENVIRONMENT_VERSION);
      assert.equal(f.root, repo);
      assert.equal(f.clock.date, "2026-01-05");
      assert.deepEqual([f.shell.kind, f.shell.name, f.shell.file], [SHELL.kind, SHELL.name, SHELL.file], "the section names the shell the bash hand spawns");
      assert.deepEqual(f.powershell, POWERSHELL ? { ...POWERSHELL } : null, "and the PowerShell the powershell hand spawns");
      assert.equal(f.git?.branch, "main");
      assert.deepEqual(f.project?.top, ["sub/", "a.txt", "new.txt"], "folders first; .git never listed");
      assert.deepEqual(f.harness, { command: "node x.js", listen: "127.0.0.1:1", cli: "node x.js" });
      const machine = await captureEnvironment("");
      assert.deepEqual([machine.git, machine.project, machine.root], [null, null, ""], "the machine alone reads no folder");
    });
  });

  test("the project's files: the manager a lockfile or packageManager names, the scripts cut at 15, the Make targets", () => {
    const d = tmp("proj");
    const scripts = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`s${i}`, `run ${i}${i === 0 ? " " + "x".repeat(200) : ""}`]));
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "p", packageManager: "pnpm@9.1.0", scripts }));
    writeFileSync(join(d, "yarn.lock"), "");
    writeFileSync(join(d, "Makefile"), ".PHONY: build\nbuild: deps\n\tgo build\nVAR := 1\ntest:\n\tgo test\n");
    writeFileSync(join(d, "App.sln"), "");
    const p = projectFactsOf(d);
    assert.deepEqual(p.manifests, ["package.json", "Makefile", "App.sln"]);
    assert.deepEqual(p.node, { manager: "pnpm", lock: "packageManager" }, "packageManager wins over the lockfile");
    assert.equal(p.scripts.length, 15);
    assert.equal(p.moreScripts, 2);
    assert.ok(p.scripts[0][1].length <= 100 && p.scripts[0][1].endsWith("…"), "a long command is cut");
    assert.deepEqual(p.targets, ["build", "test"], "not .PHONY, not a variable");
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "p" }));
    assert.deepEqual(projectFactsOf(d).node, { manager: "yarn", lock: "yarn.lock" });
    for (let i = 0; i < 45; i++) writeFileSync(join(d, `f${String(i).padStart(2, "0")}.txt`), "");
    const many = projectFactsOf(d);
    assert.equal(many.top.length, 40);
    assert.equal(many.moreTop, 49 - 40);
  });
});

describe("held still for a session", () => {
  test("the cache: one capture per folder inside its time; a later ask captures again; a failure is not kept; folders past their time are let go", async () => {
    let t = 0;
    let n = 0;
    /** @type {any} */
    const capture = async (/** @type {string} */ root) => {
      n++;
      if (root === "bad") throw new Error("boom");
      return { root, n };
    };
    const c = cachedCapture(capture, { ttlMs: 1000, now: () => t });
    const [a, b] = await Promise.all([c("x"), c("x")]);
    assert.equal(a, b);
    assert.equal(n, 1, "the board's ask and the first turn share one capture");
    t = 999;
    await c("x");
    assert.equal(n, 1);
    t = 1000;
    await c("x");
    assert.equal(n, 2, "past its time, read again");
    await assert.rejects(c("bad"));
    await assert.rejects(c("bad"));
    assert.equal(n, 4, "a failed capture is asked again, not served from the cache");
    // The board asks as a folder is typed: H, H:, H:/p … each a folder of its own, gone once past its time.
    for (const partial of ["H", "H:", "H:/p", "H:/pr"]) await c(partial);
    assert.equal(c.size, 5, "x and the four typed so far");
    t = 2500;
    await c("H:/proj");
    assert.equal(c.size, 1, "only the folder asked inside its time is held");
  });

  // (fails before: nothing held the section still — a clock in the prompt would rewrite the cached prefix every turn)
  test("the keeper: captured once per session and folder; a stored capture for this folder is used as it is; a failure leaves it out", async () => {
    let n = 0;
    /** @type {any[]} */
    const stored = [];
    /** @type {any} */
    const capture = async (/** @type {string} */ root) => ({ v: ENVIRONMENT_VERSION, root, n: ++n });
    const k = createEnvironmentKeeper({ capture });
    const first = await k.forSession({ key: "s1", root: "R", store: (f) => stored.push(f) });
    const again = await k.forSession({ key: "s1", root: "R", store: (f) => stored.push(f) });
    assert.equal(again, first);
    assert.equal(n, 1);
    assert.deepEqual(stored, [first], "stored once, for the next process");
    const kept = { v: ENVIRONMENT_VERSION, root: "R", n: 99 };
    assert.equal(await k.forSession({ key: "s2", root: "R", stored: kept }), kept, "after a restart: the chain's capture, the same bytes");
    assert.equal(n, 1);
    const other = await k.forSession({ key: "s3", root: "R", stored: { ...kept, root: "elsewhere" } });
    assert.equal(other?.root, "R", "a capture of another folder is not this one's");
    const stale = { ...kept, v: ENVIRONMENT_VERSION + 1 };
    const old = await k.forSession({ key: "s4", root: "R", stored: stale });
    assert.notEqual(old, stale, "another shape is captured again");
    assert.equal(old?.v, ENVIRONMENT_VERSION, "in this shape");
    const failing = createEnvironmentKeeper({ capture: async () => { throw new Error("no"); } });
    /** @type {any[]} */
    const none = [];
    assert.equal(await failing.forSession({ key: "s", root: "R", store: (f) => none.push(f) }), null);
    assert.equal(none.length, 0);
    // A capture that fails once and would work next time: the session keeps going without the section rather than
    // gain it mid-session and move every byte after the system prompt's start; another session captures afresh.
    let tries = 0;
    const flaky = createEnvironmentKeeper({ capture: async (/** @type {string} */ root) => { if (++tries === 1) throw new Error("once"); return /** @type {any} */ ({ v: ENVIRONMENT_VERSION, root }); } });
    assert.equal(await flaky.forSession({ key: "s", root: "R" }), null);
    assert.equal(await flaky.forSession({ key: "s", root: "R" }), null, "held as it was on the first turn");
    assert.equal(tries, 1);
    assert.equal((await flaky.forSession({ key: "t", root: "R" }))?.root, "R");
  });
});

describe("the bash tool", () => {
  // (fails before: "Run a shell command in the task folder" — on Windows the model read bash and wrote grep)
  test("its description names the shell it runs", () => {
    const bash = HAND_TOOLS.find((t) => t.name === "bash");
    assert.equal(bash?.description, bashDescription(SHELL), "this machine's shell");
    assert.match(bashDescription({ kind: "git-bash", name: "Git Bash", file: "x" }), /^Run a bash command in the task folder with Git Bash \(bash on Windows, from Git for Windows\): grep, sed, awk/);
    assert.match(bashDescription({ kind: "cmd", name: "cmd.exe", file: "x" }), /^Run a command in the task folder with cmd\.exe — Windows' command prompt, not bash: write cmd syntax/);
    assert.match(bashDescription({ kind: "bash", name: "bash", file: "/bin/bash" }), /^Run a bash command in the task folder with \/bin\/bash\. Each call/);
    assert.match(bashDescription({ kind: "sh", name: "sh", file: "/bin/sh" }), /^Run a command in the task folder with \/bin\/sh \(POSIX sh/);
    for (const kind of /** @type {const} */ (["git-bash", "cmd", "bash", "sh"]))
      assert.match(bashDescription({ kind, name: "", file: "" }), /Each call starts in the task folder: a cd does not carry over to the next call\./);
  });
});
