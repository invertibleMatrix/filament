// @ts-check
// The bug report's H16 — a terminal Filament runs for an agent (ACP's `terminal/create`). The agent sends a program and
// its arguments; they were joined with spaces and run through a shell, so an argument holding `&` ran a second
// command, and the person was asked about a line that was not the command. Now each argument arrives whole: a POSIX
// shell gets every word quoted, and on Windows a program starts as itself, a batch file through cmd.exe with its
// arguments escaped for it, and one of cmd.exe's own commands on a cmd.exe line with its arguments escaped once.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHELL, resolveShell, terminalSpawn, terminalLine } from "../src/adapters/tools/shell.js";
import { LocalHands } from "../src/adapters/tools/local-hands.js";
import { safeEnv } from "../src/adapters/tools/hands.js";
import { removeDirs, until } from "./helpers/wait.js";

const WIN = process.platform === "win32";
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

const HOSTILE = ["plain", "a b", 'say "hi"', "x&y", "100%", "%PATH%", "^caret", "!bang!", "(paren)", "trail\\", 'tr\\"q', "", "<>|", "semi;colon,comma", "star*q?", "é ü 中"];
const ENV = { Path: "C:\\bin;C:\\Program Files\\nodejs", PathExt: ".COM;.EXE;.BAT;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe" };
/** @param {string[]} files */
const files = (...files) => (/** @type {string} */ p) => files.some((f) => f.toLowerCase() === p.toLowerCase());
/** @param {string} command @param {string[]} args @param {any} [o] */
const win = (command, args, o) => terminalSpawn(command, args, { cwd: "C:\\proj", env: ENV, platform: "win32", isFile: () => false, ...o });

/** A folder with a node script that prints its arguments as JSON. */
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-term-"));
  made.push(dir);
  writeFileSync(join(dir, "echo.js"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  return dir;
};
/** Run one terminal the way the ACP bridge does, to its end. @param {any} params */
const run = async (params) => {
  /** @type {any} */
  const term = { output: "", exit: null };
  await new LocalHands().runTerminal(params, term);
  return term;
};

test("terminalLine: each word as a POSIX shell gives it back", () => {
  assert.equal(terminalLine("git", ["commit", "-m", "a & b"]), "git commit -m 'a & b'");
  assert.equal(terminalLine("C:\\Program Files\\x.exe", ["it's"]), "'C:\\Program Files\\x.exe' 'it'\\''s'");
});

test("terminalSpawn: cmd.exe's own commands on its line, escaped once; programs found on the PATH, then in the folder; elsewhere a POSIX shell", () => {
  assert.deepEqual(win("echo", ["hi", "a&b"]), { file: "C:\\Windows\\system32\\cmd.exe", args: ["/d", "/s", "/c", '"echo hi ^"a^&b^""'], verbatim: true });
  assert.deepEqual(win("dir", ["/b"], { isFile: files("C:\\bin\\dir.exe") }).args[3], '"dir /b"', "cmd.exe's dir, not a dir.exe on the PATH");
  assert.deepEqual(win("node", ["a b"], { isFile: files("C:\\bin\\node.exe") }), { file: "C:\\bin\\node.exe", args: ["a b"], verbatim: false });
  assert.equal(win("npm", ["x&y"], { isFile: files("C:\\Program Files\\nodejs\\npm.cmd") }).args[3], '"C:\\Program^ Files\\nodejs\\npm.cmd ^^^"x^^^&y^^^""', "a batch file's arguments are escaped twice");
  assert.equal(win("gradlew", ["build"], { isFile: files("C:\\proj\\gradlew.bat") }).args[3], '"C:\\proj\\gradlew.bat ^^^"build^^^""', "a name only the folder has is found there");
  assert.equal(win("git", [], { isFile: files("C:\\proj\\git.cmd", "C:\\bin\\git.exe") }).file, "C:\\bin\\git.exe", "the PATH before the folder");
  assert.deepEqual(win("nothing", ["x"]), { file: "nothing", args: ["x"], verbatim: false }, "not found: spawned as given, failing in Node's words");
  assert.deepEqual(terminalSpawn("git", ["commit", "-m", "a & b"], { cwd: "/p", platform: "linux" }), { file: "/bin/sh", args: ["-c", "git commit -m 'a & b'"], verbatim: false });
});

test("a program's arguments arrive whole, hostile ones included (fails before: yes — joined unquoted through the shell, `x&y` ran `y`)", async () => {
  const dir = folder();
  const t = await run({ command: process.execPath, args: [join(dir, "echo.js"), ...HOSTILE], cwd: dir });
  assert.equal(t.exit?.exitCode, 0, t.output);
  assert.deepEqual(JSON.parse(t.output), HOSTILE);
});

test("a shell's own command gets its arguments as one, and runs no second command (fails before: yes — `echo a&echo INJECTED` echoed twice)", async () => {
  const t = await run({ command: "echo", args: ["a&echo INJECTED"], cwd: folder() });
  assert.equal(t.exit?.exitCode, 0, t.output);
  assert.ok(t.output.includes("a&echo INJECTED"), t.output);
  assert.doesNotMatch(t.output, /^INJECTED\s*$/m);
});

test("a batch file found by name on the agent's PATH, and one only the folder has, get every argument whole (fails before: yes — joined unquoted, and the agent's PATH stood beside the inherited Path)", { skip: !WIN && "Windows only" }, async () => {
  const dir = folder();
  const bin = join(dir, "with space");
  mkdirSync(bin);
  writeFileSync(join(bin, "argshim.cmd"), `@"${process.execPath}" "${join(dir, "echo.js")}" %*\r\n`);
  const name = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") === "PATH" ? "Path" : "PATH";
  const byName = await run({ command: "argshim", args: HOSTILE, cwd: dir, env: [{ name, value: `${bin};${process.env.PATH || ""}` }] });
  assert.deepEqual(JSON.parse(byName.output), HOSTILE, byName.output);
  writeFileSync(join(dir, "localshim.cmd"), `@"${process.execPath}" "%~dp0echo.js" %*\r\n`);
  const here = await run({ command: "localshim", args: HOSTILE, cwd: dir });
  assert.deepEqual(JSON.parse(here.output), HOSTILE, here.output);
});

// (fails before: no — the same text; it pins it: past the limit, the output's last characters, wherever the chunks
// broke and whatever they held)
test("a terminal keeps the last of what its command printed, to the limit, as one string cut at each chunk kept it", async () => {
  const dir = folder();
  // Chunks of many lengths, a pause between them so each comes alone, letters past ASCII and pairs of halves among them.
  writeFileSync(
    join(dir, "chunks.js"),
    "const parts = Array.from({ length: 30 }, (_, i) => `${i}:` + 'aé中😀'.repeat(i % 9) + 'z'.repeat((i * 37) % 300) + '\\n');\n" +
      "let i = 0; const next = () => { if (i < parts.length) process.stdout.write(parts[i++], () => setTimeout(next, 2)); }; next();\n",
  );
  const parts = Array.from({ length: 30 }, (_, i) => `${i}:` + "aé中😀".repeat(i % 9) + "z".repeat((i * 37) % 300) + "\n");
  const all = parts.join("");
  for (const limit of [1, 1000, all.length, all.length + 5]) {
    const t = await run({ command: process.execPath, args: [join(dir, "chunks.js")], cwd: dir, outputByteLimit: limit });
    assert.equal(t.exit?.exitCode, 0);
    assert.equal(t.output, all.slice(-limit), `limit ${limit}`);
    assert.equal(t.truncated, all.length > limit, `limit ${limit}`);
    assert.equal(JSON.parse(JSON.stringify(t)).output, t.output, "it reads as a property of the terminal, as before");
  }
});

// (fails before: yes — 2.3 s of the event loop for the 100 MB here: each chunk past the limit copied all ten megabytes
// kept)
test("a chatty command's output past a big limit costs each chunk its own length, not the limit's", async () => {
  const dir = folder();
  writeFileSync(
    join(dir, "chatty.js"),
    'const b = "x".repeat(16383) + "\\n"; let n = 0;\nconst go = () => { while (n < 6400) { n++; if (!process.stdout.write(b)) return process.stdout.once("drain", go); } };\ngo();\n',
  );
  // The thread's own CPU time: the event loop's busy time counts the stretches a loaded machine leaves it waiting to
  // run, and the full suite's load carried it past the mark with no copying at all.
  const before = process.threadCpuUsage();
  const t = await run({ command: process.execPath, args: [join(dir, "chatty.js")], cwd: dir, outputByteLimit: 10_000_000 });
  const used = process.threadCpuUsage(before);
  const busy = (used.user + used.system) / 1000;
  assert.equal(t.output.length, 10_000_000);
  assert.ok(/^x+\n$/.test(t.output.slice(-16384)) && t.truncated);
  assert.ok(busy < 1000, `${Math.round(busy)} ms of the thread's CPU for 100 MB of output`);
});

test("a command line alone runs in the shell as written, a quoted program first included (fails before: yes — cmd.exe's /s took its first and last quotes)", async () => {
  const t = await run({ command: `"${process.execPath}" -e "process.stdout.write(String(6*7))"`, cwd: folder() });
  assert.equal(t.output.trim(), "42", t.output);
});

// (fails before: yes on Windows — a line went to cmd.exe whatever shell the `bash` tool runs; the chat's switch reads
// a line as that shell's, and cmd.exe takes a single quote for no quote: the file one `cat` was to print named a
// second command, which ran)
test("a command line alone runs in the shell of the `bash` tool, the one the chat's switch reads it as", async () => {
  const dir = folder();
  writeFileSync(join(dir, "a.txt"), "hello\n");
  const t = await run({ command: "cat 'a.txt&echo INJECTED>made.txt'", cwd: dir });
  assert.deepEqual(readdirSync(dir).sort(), ["a.txt", "echo.js"], `no file made: ${t.output}`);
  if (SHELL.kind === "cmd") return;
  assert.match(t.output, /No such file or directory/, "one file to print, of that name or none");
  const which = await run({ command: 'echo "${BASH_VERSION:-none}"', cwd: dir });
  assert.equal(/^\d/.test(which.output.trim()), SHELL.kind !== "sh", `${SHELL.name}: ${which.output}`);
});

// (fails before: no on main — it guards the fix above: every line sent the loop's way, `cmd /c <line>`, lost a line's
// first and last quotes where the `bash` tool's shell is cmd.exe, as before H16's fix)
test("where the `bash` tool's shell is cmd.exe (no Git Bash here), a line runs there as written, a quoted program first included", { skip: !WIN && "Windows only" }, async () => {
  const cmd = resolveShell({ isFile: () => false });
  assert.equal(cmd.kind, "cmd");
  /** @type {any} */
  const term = { output: "", exit: null };
  await new LocalHands({ shell: cmd }).runTerminal(/** @type {any} */ ({ command: `"${process.execPath}" -e "process.stdout.write(String(6*7))"`, cwd: folder() }), term);
  assert.equal(term.output.trim(), "42", term.output);
});

// (fails before: yes — every road gave the command Filament's whole environment: the key and Filament's own variable
// were printed, where the chat's switch had read the command with the bash hand's environment)
test("a command the hands run gets the bash hand's environment, with none of the keys Filament was started with; the agent's own variables come with it", async () => {
  const KEY = "FXL2_PROVIDER_API_KEY";
  const OWN = "FILAMENT_FXL2_OWN";
  const was = { [KEY]: process.env[KEY], [OWN]: process.env[OWN] };
  Object.assign(process.env, { [KEY]: "sk-filament-was-started-with", [OWN]: "filament's own" });
  try {
    assert.deepEqual([KEY in safeEnv(), OWN in safeEnv()], [false, false], "the bash hand's environment leaves both out");
    const dir = folder();
    const print = `process.stdout.write([process.env.${KEY}, process.env.${OWN}].map(String).join(','))`;
    const none = "undefined,undefined";
    // A program and its arguments, as ACP's `terminal/create` sends them.
    const program = await run({ command: process.execPath, args: ["-e", print], cwd: dir });
    assert.equal(program.output, none);
    // A command line, as Cursor's SDK and Filament's MCP server send one.
    const line = await run({ command: `"${process.execPath}" -e "${print}"`, cwd: dir });
    assert.equal(line.output, none);
    if (WIN) {
      /** @type {any} */
      const term = { output: "", exit: null };
      await new LocalHands({ shell: resolveShell({ isFile: () => false }) }).runTerminal(/** @type {any} */ ({ command: `"${process.execPath}" -e "${print}"`, cwd: dir }), term);
      assert.equal(term.output, none, "where the `bash` tool's shell is cmd.exe too");
    }
    // What the agent itself sets for its command is the command's.
    const given = await run({ command: process.execPath, args: ["-e", print], cwd: dir, env: [{ name: KEY, value: "the agent's own" }] });
    assert.equal(given.output, "the agent's own,undefined");
  } finally {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// (fails before: no — the line's shell went with its tree before too; it pins the stop the line's own shell brings)
test("a command line's shell is ended with what it started, and the terminal exits", async () => {
  /** @type {any} */
  const term = { output: "", exit: null };
  const hands = new LocalHands();
  const ran = hands.runTerminal(/** @type {any} */ ({ command: `"${process.execPath}" -e "console.log('up'); setTimeout(()=>{},60000)"`, cwd: folder() }), term);
  await until(() => term.output.includes("up"), "the command to start");
  const t0 = Date.now();
  hands.kill(term);
  await ran;
  assert.ok(term.exit, "the terminal exited");
  assert.ok(Date.now() - t0 < 20_000, `ended by the stop, not by its own end (${Date.now() - t0} ms)`);
});
