// @ts-check
// HarnessV4_Tasks C10: a PowerShell script that only reads runs without asking, as a bash command does (LD-D11).
// `readOnlyPowerShell` decides, conservatively — what it cannot read is a no, with the reason — and the gate, a coding
// agent's switch and the learned permissions act on it. Until it, the reader knew bash alone: every script of the
// `powershell` hand asked, and every command of Codex on Windows, which wraps each in `powershell.exe -Command`.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOnlyPowerShell } from "../src/adapters/tools/read-only-powershell.js";
import { powershellCommand } from "../src/adapters/agents/codex/items.js";
import { gate, handsIn } from "../src/app/agent/tools.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { permissionShape } from "../src/services/memory/permissions.js";

const WIN = process.platform === "win32";

describe("readOnlyPowerShell (HarnessV4_Tasks C10)", () => {
  let base = "";
  let root = "";
  let program = "";
  /** @type {Record<string, string>} */
  let ENV = {};
  /** @param {string} script @param {any} [o] */
  const reads = (script, o = {}) => readOnlyPowerShell(script, { root, env: ENV, ...o });
  /** @param {string} script @param {any} [o] */
  const why = (script, o = {}) => {
    const v = reads(script, o);
    return v.ok ? "(it passed)" : v.why;
  };

  before(() => {
    // base/work is the working folder: two files, src/ and its two, linked/ holding a link out, nest/ holding a link
    // back inside (alias → src), and tools/. base/outside is outside; base/ps holds a file named as PowerShell is;
    // base/home is the person's home, base/bin the PATH.
    base = mkdtempSync(join(tmpdir(), "filament-rops-"));
    root = join(base, "work");
    for (const d of ["src", "nest", "linked", "tools"]) mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, "a.txt"), "a\n");
    writeFileSync(join(root, "b.md"), "b\n");
    writeFileSync(join(root, "src", "x.js"), "x\n");
    writeFileSync(join(root, "src", "y.js"), "y\n");
    for (const d of ["outside", "ps", "home", "bin"]) mkdirSync(join(base, d));
    writeFileSync(join(base, "outside", "secret.txt"), "s\n");
    symlinkSync(join(base, "outside"), join(root, "linked", "out"), "junction");
    symlinkSync(join(root, "src"), join(root, "nest", "alias"), "junction");
    program = join(base, "ps", "powershell.exe");
    writeFileSync(program, "");
    writeFileSync(join(root, "tools", "pwsh.exe"), "");
    ENV = { PATH: join(base, "bin"), USERPROFILE: join(base, "home"), HOME: join(base, "home") };
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  // (fails before: yes — there was no reader of PowerShell: the gate read a `bash` call alone, and bash's reader
  // answered any other shell with "its syntax is not read here")
  test("the cmdlets that read files, list folders and shape a pipeline pass, with their own parameters", () => {
    for (const script of [
      "Get-Content a.txt",
      "Get-Content -Path a.txt -TotalCount 5",
      "Get-Content -LiteralPath 'src/x.js' -Tail 3 -Encoding utf8",
      'Get-Content "a.txt" -Raw',
      "get-content A.TXT -First 2",
      "Get-ChildItem",
      "Get-ChildItem src -Filter *.js -Name",
      "Get-ChildItem -Path src -Recurse -File -Force",
      "Get-ChildItem nest -Recurse",
      "Get-ChildItem src *.js",
      "Get-Item a.txt",
      "Test-Path src -PathType Container",
      "Resolve-Path src/x.js -Relative",
      "Get-Location",
      "Select-String -Path src/*.js -Pattern 'x$' -CaseSensitive",
      "Select-String foo a.txt -SimpleMatch -Context 2",
      "Get-Content a.txt | Select-Object -First 3",
      "Get-Content a.txt | Select-String -Pattern 'a' | Measure-Object -Line",
      "Get-ChildItem src -Recurse | Select-String 'x' -List | Select-Object -ExpandProperty Path",
      "Get-ChildItem src | Sort-Object Length -Descending | Format-Table Name -AutoSize | Out-String -Width 200",
      "Get-Content a.txt; Get-Content b.md",
      "Get-Content a.txt\nGet-Content b.md\n",
      "Get-Content a.txt |\n  Select-Object -Last 2",
      "Get-Content a.txt && Get-Content b.md || Write-Output 'neither'",
      "Get-Content a.txt 2>$null",
      "Get-Content a.txt 2>&1 | Out-Null",
      "Get-ChildItem *> $null",
      "Get-Content a.txt -ErrorAction SilentlyContinue",
      "Write-Output 'it''s here' plain [int]5",
      "Write-Host '--- a.txt ---' -NoNewline",
      "Get-Content nosuch.txt",
    ])
      assert.deepEqual(reads(script), { ok: true }, script);
  });

  // (fails before: yes — the same: no script was read, so none had its reason)
  test("what writes, runs something or cannot be read asks, each with its reason", () => {
    /** @type {[string, RegExp][]} */
    const cases = [
      ["Remove-Item a.txt", /`Remove-Item` is not one of the PowerShell commands known to only read/],
      ["Get-Content a.txt; Set-Content a.txt 'x'", /`Set-Content` is not one/],
      ["Get-Content a.txt | Out-File b.md", /`Out-File` is not one/],
      ["Get-ChildItem | ForEach-Object { Remove-Item $_ }", /a brace \(a script block\)/],
      ["Get-ChildItem | % Delete", /`%` is not one/],
      ["rg foo", /`rg` is not one/],
      ["node -v", /`node` is not one/],
      ["Get-Content a.txt > out.txt", /output into a file: only \$null keeps nothing/],
      ["Get-Content a.txt 2> err.txt", /output into a file/],
      ["Get-Content a.txt 2>&2", /a redirection other than into the success stream/],
      ["Get-Content $env:USERPROFILE\\x", /a `\$`/],
      ['Get-Content "$(Remove-Item a.txt)"', /a `\$` inside double quotes/],
      ["Get-Content (Join-Path src x.js)", /a parenthesis/],
      ["Get-Content a.txt,b.md", /a comma/],
      ["Get-Content @args", /an `@` that starts a word/],
      ["Get-Content a.txt # and more", /a comment/],
      ["Get-Content a.txt `\n-Wait", /a backtick/],
      ["& notepad", /an `&`/],
      ["Get-Content a.txt &", /an `&`/],
      ["Get-Content < a.txt", /a `<`/],
      ["'a.txt'", /a string where a command stands/],
      ["Get-Content a'.txt'", /a quote inside a word/],
      ["Get-Content 'a.txt", /an unclosed quote/],
      ["Get-Content a.txt \u2013Wait", /a typographic quote or dash/],
      ["Get-Content \u2018a.txt\u2019", /a typographic quote or dash/],
      ["Get-Content a.txt\u00a0-Wait", /no plain letter/],
      ["Get-Content a.txt -Wait", /Get-Content -Wait is not a parameter known to only read/],
      ["Get-Content a.txt -Stream Zone.Identifier", /-Stream is not a parameter/],
      ["Get-Content a.txt -Tot 5", /-Tot is not a parameter known to only read \(each is read by its whole name\)/],
      ["Get-Content -Path:a.txt", /a parameter joined to its value by a colon/],
      ["Get-Content a.txt --% x", /`--` ends PowerShell's reading/],
      ["Get-Content a.txt -TotalCount", /-TotalCount needs a value/],
      ["Get-Content a.txt -TotalCount five", /-totalcount takes a whole number/],
      ["Get-Content -Path -Raw", /-Path needs a value, and -Raw reads as a parameter/],
      ["Get-Content -Path a.txt -Path b.md", /-Path is given twice/],
      ["Get-Content a.txt b.md", /takes no further word without a parameter's name \(b\.md\)/],
      ["Get-Content", /Get-Content with no path: it would ask for one/],
      ["Get-Location here", /Get-Location takes no word without a parameter's name/],
      ["Get-ChildItem -FollowSymlink", /-FollowSymlink is not a parameter/],
      ["Get-Content a.txt -ErrorAction Inquire", /only silentlycontinue, continue, stop, ignore are read here/],
      ["Write-Output src | Get-ChildItem", /Get-ChildItem would take its paths from the pipeline/],
      ["Get-ChildItem src | Get-Content", /Get-Content would take its paths from the pipeline/],
      ["Get-Content a.txt | ; Get-Content b.md", /an empty command/],
      ["Get-Content a.txt\n| Select-Object -First 1", /an empty command/],
      ["", /no command/],
      [" ;\n", /no command/],
    ];
    for (const [script, reason] of cases) assert.match(why(script), reason, script);
  });

  // (fails before: yes — the same)
  test("a path is read inside the working folder only: no other drive or provider, no link out, no name Windows reads otherwise", () => {
    /** @type {[string, RegExp][]} */
    const cases = [
      [`Get-Content ${join(base, "outside", "secret.txt")}`, /is outside the working folder/],
      ["Get-Content ../outside/secret.txt", /is outside the working folder/],
      ["Get-Content src/../../outside/secret.txt", /`\.\.` after a name/],
      ["Get-Content linked/out/secret.txt", /reaches outside the working folder through a link/],
      ["Get-Content -LiteralPath linked/out/secret.txt", /through a link/],
      ["Get-Content ~/notes.txt", /starts at a home folder/],
      ["Get-Content //server/share/x.txt", /is a share or a device/],
      ["Get-Content Env:PATH", /a `:` names a provider's drive/],
      ["Get-ChildItem HKLM:/SOFTWARE", /a `:` names a provider's drive/],
      ["Get-Content a.txt:secret", /another stream of a file/],
      ["Get-Content NUL", /names a Windows device/],
      ["Get-Content src/con.txt", /names a Windows device/],
      ["Get-Content ''", /an empty path/],
      ["Get-Content src/*/x.js", /a wildcard before the last part/],
      ["Get-Content 'linked/*'", /its folder holds a link, and the wildcard may pick it/],
      ["Select-String foo -Path linked/*.txt", /its folder holds a link/],
      ["Get-Content nosuch/*.txt", /its folder cannot be read/],
    ];
    for (const [script, reason] of cases) assert.match(why(script), reason, script);
    // A wildcard is read inside quotes too (`-Path` reads it itself), and by its letters under -LiteralPath.
    assert.deepEqual(reads("Get-Content 'src/*.js'"), { ok: true });
    assert.deepEqual(reads("Get-Content -LiteralPath 'src/[x].js'"), { ok: true });
    assert.match(why("Get-Content -LiteralPath 'src/*/x.js'"), /\(it passed\)/, "no wildcard there: a name that is not there reads nothing");
  });

  // (fails before: yes — HarnessV4_Overnight_Plan OC-56, OC-57: a folder added to the working folder was outside it)
  test("a folder added to the working folder (loop.addedFolders) reads as the working folder does; a link there that leads elsewhere does not", () => {
    const added = join(base, "added");
    mkdirSync(added);
    writeFileSync(join(added, "note.txt"), "n\n");
    const r = { reads: [added] };
    assert.match(why("Get-Content ../added/note.txt"), /is outside the working folder$/);
    for (const script of ["Get-Content ../added/note.txt", `Get-Content '${join(added, "note.txt")}'`, "Get-ChildItem ../added", "Get-ChildItem ../added -Recurse", "Select-String n -Path ../added/note.txt"])
      assert.deepEqual(reads(script, r), { ok: true }, script);
    assert.match(why("Get-Content ../outside/secret.txt", r), /is outside the working folder and the folders added to it$/);
    symlinkSync(join(base, "outside"), join(added, "away"), "junction");
    assert.match(why("Get-Content ../added/away/secret.txt", r), /reaches outside the working folder through a link/);
    assert.match(why("Get-ChildItem ../added -Recurse", r), /is a link that leads outside the working folder and the folders added to it/);
    mkdirSync(join(root, "hop"));
    symlinkSync(added, join(root, "hop", "on"), "junction");
    assert.deepEqual(reads("Get-ChildItem hop", r), { ok: true }, "a link in the working folder that leads into an added folder stays where it may read");
    assert.match(why("Get-ChildItem hop"), /hop[\\/]on is a link that leads outside the working folder$/, "without the folder added, it leads out");
  });

  test("a path's Windows forms: a drive's own folder, a backslash, a name that ends in a dot (fails before: yes — the same)", { skip: !WIN && "Windows paths" }, () => {
    assert.deepEqual(reads("Get-Content src\\x.js"), { ok: true });
    assert.deepEqual(reads(`Get-Content '${join(root, "src", "x.js")}'`), { ok: true }, "written whole, inside");
    assert.match(why(`Get-Content ${root.slice(0, 2)}a.txt`), /names a drive's current folder/);
    assert.match(why("Get-Content 'src\\.. '"), /ends in a dot or a space, which Windows drops/);
    assert.match(why("Get-Content a.txt."), /ends in a dot or a space/);
    assert.match(why("Get-Content \\\\.\\C:\\x"), /is a share or a device/);
    assert.match(why("Get-Content C:\\Windows\\win.ini"), /is outside the working folder/);
  });

  // (fails before: yes — the same) Windows PowerShell walks into a folder's link when it recurses, and a listing piped
  // on is read file by file: what a listing holds may not lead outside.
  test("a listing asks when what it lists holds a link that leads outside; a link that stays inside is followed", () => {
    assert.match(why("Get-ChildItem linked"), /Get-ChildItem: linked[\\/]out is a link that leads outside the working folder/);
    assert.match(why("Get-ChildItem -Recurse"), /linked[\\/]out is a link that leads outside/);
    assert.match(why("Get-ChildItem -Depth 2"), /is a link that leads outside/, "-Depth recurses");
    assert.match(why("Get-ChildItem *"), /its folder holds a link|is a link that leads outside/, "a wildcard lists each folder it picks");
    assert.deepEqual(reads("Get-ChildItem nest"), { ok: true }, "nest/alias leads to src, inside");
    assert.deepEqual(reads("Get-ChildItem nest -Recurse"), { ok: true });
    assert.deepEqual(reads("Get-ChildItem"), { ok: true }, "the folder itself holds no link");
    assert.deepEqual(reads("Get-ChildItem a.txt"), { ok: true }, "a file lists itself");
    // A link inside that leads to a folder whose own link leads out: followed, and found.
    mkdirSync(join(root, "deep"));
    symlinkSync(join(root, "linked"), join(root, "deep", "on"), "junction");
    try {
      assert.match(why("Get-ChildItem deep -Recurse"), /linked[\\/]out is a link that leads outside/);
      assert.deepEqual(reads("Get-ChildItem deep"), { ok: true }, "one level: the link is listed by its own name");
    } finally {
      rmSync(join(root, "deep"), { recursive: true, force: true });
    }
  });

  // (fails before: yes — every folder of a recursive listing was resolved again, each looking at every folder above it:
  // a listing of node_modules held Filament for seconds) The walk resolves the folder it starts at and the links it
  // meets, nothing else, and finds what it found before: a link out deep down, a link inside followed.
  test("a recursive listing resolves its start and its links alone, and still finds a link out deep down", () => {
    const big = join(root, "big");
    for (let i = 0; i < 40; i++) mkdirSync(join(big, `d${i}`, "a", "b"), { recursive: true });
    symlinkSync(join(root, "src"), join(big, "d7", "a", "inside"), "junction");
    const real = fs.realpathSync;
    let calls = 0;
    /** @type {any} */ (fs).realpathSync = (/** @type {any[]} */ ...a) => (calls++, /** @type {any} */ (real)(...a));
    syncBuiltinESMExports();
    try {
      assert.deepEqual(reads("Get-ChildItem big -Recurse"), { ok: true }, "121 folders and a link back inside");
      assert.ok(calls < 10, `${calls} paths resolved for 121 folders`);
      symlinkSync(join(base, "outside"), join(big, "d33", "a", "b", "away"), "junction");
      assert.match(why("Get-ChildItem big -Recurse"), /big[\\/]d33[\\/]a[\\/]b[\\/]away is a link that leads outside the working folder$/);
    } finally {
      fs.realpathSync = real;
      syncBuiltinESMExports();
      rmSync(big, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the same)
  test("PowerShell's aliases are read on Windows alone: elsewhere `cat` and `ls` are programs", () => {
    for (const script of ["cat a.txt", "gc a.txt | select -First 1", "ls src", "dir src | sort Name | ft Name", "type a.txt", "echo hi", "pwd", "sls x src/x.js"]) {
      assert.deepEqual(reads(script, { platform: "win32", env: {} }), { ok: true }, script);
      assert.match(why(script, { platform: "linux", env: {} }), /is not one of the PowerShell commands known to only read/, script);
    }
    assert.deepEqual(reads("Get-Content a.txt | Select-Object -First 1", { platform: "linux", env: {} }), { ok: true }, "the whole names are PowerShell's everywhere");
  });

  // (fails before: yes — the same) A script is read where it runs: Codex names the folder with each command.
  test("the folder a script runs in: inside the working folder, with no link on the way", () => {
    assert.deepEqual(reads("Get-Content x.js", { cwd: "src" }), { ok: true });
    assert.deepEqual(reads("Get-Content ../a.txt", { cwd: join(root, "src") }), { ok: true }, "`..` from it stays inside");
    assert.deepEqual(reads("Get-Content a.txt", { cwd: "." }), { ok: true });
    assert.match(why("Get-Content secret.txt", { cwd: join(base, "outside") }), /it runs in .*outside, outside the working folder/);
    assert.match(why("Get-Content secret.txt", { cwd: "linked/out" }), /outside the working folder/);
    assert.match(why("Get-Content x.js", { cwd: "nest/alias" }), /reached through a link/);
    assert.match(why("Get-Content x.js", { cwd: "gone" }), /which is not there/);
  });

  // (fails before: yes — the same) What runs the script, and what PowerShell loads before it, must be out of the
  // agent's reach: a file it wrote could stand in for either.
  test("the program that runs it and the folders PowerShell loads from are nothing the agent could write", () => {
    assert.deepEqual(reads("Get-Content a.txt", { program }), { ok: true }, "a PowerShell outside the working folder");
    assert.match(why("Get-Content a.txt", { program: join(root, "tools", "pwsh.exe") }), /leads into the working folder/);
    assert.match(why("Get-Content a.txt", { program: join(base, "ps", "gone", "powershell.exe") }), /cannot be read/);
    assert.match(why("Get-Content a.txt", { program: join(base, "ps") }), /is not PowerShell/);
    assert.match(why("Get-Content a.txt", { program: "tools/pwsh.exe" }), /is found from the folder the script runs in/);
    assert.match(why("Get-Content a.txt", { program: process.execPath }), /is not PowerShell/);
    // By its bare name, or the agent's own: found along the PATH.
    assert.deepEqual(reads("Get-Content a.txt", { program: "powershell.exe" }), { ok: true });
    const sep = WIN ? ";" : ":";
    assert.match(why("Get-Content a.txt", { env: { ...ENV, PATH: `${join(base, "bin")}${sep}${join(root, "tools")}` } }), /the PATH searches .*tools \(inside the working folder\), where a file could stand in for PowerShell/);
    assert.match(why("Get-Content a.txt", { program: "pwsh", env: { ...ENV, PATH: `tools${sep}${join(base, "bin")}` } }), /the PATH searches tools \(relative to the folder a script runs in\)/);
    assert.match(why("Get-Content x.js", { cwd: "tools" }), /pwsh\.exe stands in the folder the script runs in/);
    // The profile and the modules: the person's Documents, a OneDrive's, PSModulePath.
    assert.match(why("Get-Content a.txt", { platform: "win32", env: { ...ENV, USERPROFILE: root } }), /PowerShell loads your profile and modules from .*Documents.WindowsPowerShell, inside the working folder/);
    assert.match(why("Get-Content a.txt", { platform: "win32", env: { ...ENV, OneDrive: join(root, "src") } }), /loads your profile and modules from/);
    assert.match(why("Get-Content a.txt", { platform: "linux", env: { ...ENV, HOME: root } }), /loads your profile and modules from .*powershell, inside the working folder/);
    assert.match(why("Get-Content a.txt", { env: { ...ENV, PSModulePath: `${join(base, "bin")}${sep}${join(root, "tools")}` } }), /PowerShell's module path searches .*tools, inside the working folder/);
    assert.match(why("Get-Content a.txt", { env: { ...ENV, psmodulepath: "Modules" } }), /module path searches Modules, relative to the folder a script runs in/);
    assert.deepEqual(reads("Get-Content a.txt", { env: { ...ENV, PSModulePath: join(base, "bin") } }), { ok: true });
  });

  test("the working folder must be there", () => {
    assert.deepEqual(readOnlyPowerShell("Get-Content a.txt", { root: join(base, "nowhere"), env: ENV }), { ok: false, why: "the working folder does not exist" });
  });

  // (fails before: yes — the gate asked its reader about `bash` alone: a powershell call was a command nobody read,
  // asked about in every mode but Full access and refused whole in read-only)
  test("the gate runs a PowerShell script that only reads in every mode, and says why another asks or is refused", () => {
    /** @type {any} */
    const reader = (/** @type {string} */ command, /** @type {string} */ name) => {
      assert.equal(name, "powershell", "the gate says which shell the command is for");
      return reads(command);
    };
    for (const mode of /** @type {const} */ (["read-only", "ask", "edit"]))
      assert.deepEqual(gate(mode, "powershell", { command: "Get-Content a.txt" }, null, undefined, reader, root), { verdict: "run", readOnly: true }, mode);
    const asked = gate("edit", "powershell", { command: "Remove-Item a.txt" }, null, undefined, reader, root);
    assert.equal(asked.verdict, "ask");
    assert.match(String(/** @type {any} */ (asked).question), /^May I run this PowerShell script\? `Remove-Item a\.txt` — Filament cannot tell that it only reads inside the working folder: `Remove-Item` is not one of the PowerShell commands known to only read\. Answer \/allow/);
    const refused = gate("read-only", "powershell", { command: "Remove-Item a.txt" }, null, undefined, reader, root);
    assert.equal(refused.verdict, "refuse");
    assert.match(String(/** @type {any} */ (refused).text), /this session is read-only, and Filament cannot tell that this command only reads inside the working folder: `Remove-Item`/);
    assert.deepEqual(gate("auto", "powershell", { command: "Remove-Item a.txt" }, null, undefined, reader, root), { verdict: "run" }, "Full access runs it unread");
    // In the background a command is not read: it asks as before.
    assert.equal(gate("ask", "bash_background", { command: "cat a.txt" }, null, undefined, () => assert.fail("not read"), root).verdict, "ask");
    assert.ok(handsIn("read-only").includes("powershell") || !handsIn("auto").includes("powershell"), "read-only's hands hold powershell where the machine has one");
  });

  // (fails before: yes — the switch read a coding agent's command with bash's reader whatever its call's name)
  test("a coding agent's PowerShell script is read by its program and folder: one that only reads runs, another asks with the reason", () => {
    const permits = createAgentPermits({ rules: [], modeNow: () => "ask", learned: null });
    const ran = permits.judge([{ name: "powershell", input: { command: "Get-Content a.txt | Select-Object -First 2", program, cwd: "." } }], root);
    assert.deepEqual([ran.verdict, ran.how], ["run", "ran without asking: it only reads"]);
    const asked = permits.judge([{ name: "powershell", input: { command: "Remove-Item -Recurse src", program } }], root);
    assert.deepEqual([asked.verdict, asked.tool, asked.command], ["ask", "powershell", "Remove-Item -Recurse src"]);
    assert.match(String(asked.reason), /Filament cannot tell that it only reads inside the working folder: `Remove-Item` is not one/);
    const elsewhere = permits.judge([{ name: "powershell", input: { command: "Get-Content secret.txt", program, cwd: join(base, "outside") } }], root);
    assert.equal(elsewhere.verdict, "ask");
    assert.match(String(elsewhere.reason), /it runs in .*outside, outside the working folder/);
    const planted = permits.judge([{ name: "powershell", input: { command: "Get-Content a.txt", program: join(root, "tools", "pwsh.exe") } }], root);
    assert.match(String(planted.reason), /leads into the working folder/);
    const readOnly = createAgentPermits({ rules: [], modeNow: () => "read-only", learned: null });
    assert.equal(readOnly.judge([{ name: "powershell", input: { command: "Get-ChildItem src", program } }], root).verdict, "run");
    assert.equal(readOnly.judge([{ name: "powershell", input: { command: "Remove-Item a.txt", program } }], root).verdict, "refuse");
    // A session's rule on a command speaks for the script, now that it is the script: a deny refuses a read too.
    const ruled = createAgentPermits({ rules: [{ tool: "bash", pattern: "Get-Content *", verdict: "deny" }], modeNow: () => "auto", learned: null });
    assert.equal(ruled.judge([{ name: "powershell", input: { command: "Get-Content a.txt", program } }], root).verdict, "refuse");
  });
});

describe("Codex's command read back from its wrapper (HarnessV4_Tasks C10)", () => {
  // (fails before: yes — there was no such reading: Codex's whole line was a `bash` command whose program was
  // PowerShell)
  test("the script and the program of a command Codex wraps in PowerShell, as Codex words its argv", () => {
    const ps = '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe"';
    const exe = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    assert.deepEqual(powershellCommand(`${ps} -Command 'Get-Content a.txt'`), { program: exe, script: "Get-Content a.txt" });
    assert.deepEqual(powershellCommand(`${ps} -NoProfile -ExecutionPolicy Bypass -Command "Get-Content 'a b.txt'"`), { program: exe, script: "Get-Content 'a b.txt'" });
    assert.deepEqual(powershellCommand(`pwsh -NoLogo -c Get-Location`), { program: "pwsh", script: "Get-Location" });
    assert.deepEqual(powershellCommand(`powershell.exe -Command Get-Content a.txt`), { program: "powershell.exe", script: "Get-Content a.txt" }, "PowerShell joins the words after -Command");
    // What a double-quoted word escapes is read back: `\"`, `\\`, `\$` and a backtick's.
    assert.deepEqual(powershellCommand(`powershell -Command "Write-Output \\"a\\" \\$x C:\\\\t"`), { program: "powershell", script: 'Write-Output "a" $x C:\\t' });
    // One word in pieces, as shlex writes a word that holds both quotes.
    assert.deepEqual(powershellCommand(`powershell -Command 'Write-Output '"'"'it'"'"`), { program: "powershell", script: "Write-Output 'it'" });
    for (const not of [
      "cat a.txt",
      "bash -lc 'cat a.txt'",
      `${ps} -File build.ps1`,
      `${ps} -EncodedCommand RwBlAHQALQBDAG8AbgB0AGUAbgB0AA==`,
      `${ps} -Command -`,
      `${ps} -Command`,
      `${ps} -WindowStyle Hidden -Command 'Get-Content a.txt'`,
      `${ps} Get-Content a.txt`,
      "powershell -Command Get-Content a.txt | Out-File b.txt",
      "powershell -Command Get-Content $HOME",
      "powershell -Command 'Get-Content a.txt",
      "C:\\Windows\\powershell.exe -Command 'Get-Content a.txt'",
      "",
    ])
      assert.equal(powershellCommand(not), null, not);
  });

  // (fails before: yes — every simple command of Codex on Windows had one shape, the wrapper's program: an always-allow
  // learned from five harmless ones covered `Remove-Item` too)
  test("a shell handed its script on the line has no shape to learn; the script it carries has its own", () => {
    for (const command of [
      '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'Get-Content a.txt\'',
      "powershell -NoProfile -Command Get-Content a.txt",
      "pwsh -c Get-Location",
      "powershell.exe -EncodedCommand RwBl",
      "bash -lc 'rm -rf build'",
      "sh -c ls",
      "/bin/zsh -lc 'npm test'",
      "cmd /c del x",
      "cmd.exe /d /s /C dir",
    ])
      assert.equal(permissionShape("bash", { command }), null, command);
    assert.equal(permissionShape("bash", { command: "bash build.sh" })?.shape, "bash", "a script file is still the shell's own shape");
    assert.equal(permissionShape("bash", { command: "powershell -File build.ps1" })?.shape, "powershell");
    assert.equal(permissionShape("bash", { command: "powershell -ExecutionPolicy Bypass -File build.ps1" })?.shape, "powershell", "-ex… is its policy, not a script");
    assert.deepEqual(permissionShape("powershell", { command: "Get-Content a.txt -TotalCount 5", program: "powershell.exe", cwd: "." }), { tool: "bash", shape: "get-content", text: "bash: get-content" });
    assert.equal(permissionShape("powershell", { command: "Remove-Item x" })?.shape, "remove-item");
    assert.equal(permissionShape("powershell", { command: "if (Test-Path x) { Remove-Item x }" }), null, "a block: its first word says nothing of what it runs");
    assert.equal(permissionShape("powershell", { command: "ForEach-Object -InputObject x { Remove-Item x }" }), null);
    assert.equal(permissionShape("bash", { command: "echo {a,b}" })?.shape, "echo", "a brace is a block in PowerShell alone");
  });
});
