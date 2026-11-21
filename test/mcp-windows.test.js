// @ts-check
// HarnessV3-Tools TL-D22 — an MCP server's command found and started on Windows the way a shell does it. Node's spawn
// tries only .exe and .com, so "command": "npx" (every MCP README's) failed to start; a .cmd named with its
// extension ran under `shell: true`, its arguments joined unquoted. Now a bare name is looked up on the server's PATH
// with PATHEXT, a batch file runs through cmd.exe with each argument escaped for it, and a server's own PATH replaces
// the inherited one in any case.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { programSpawn, cmdArgument, withEnv } from "../src/adapters/tools/shell.js";
import { connectMcp } from "../src/adapters/tools/mcp-client.js";
import { removeDirs } from "./helpers/wait.js";

const WIN = process.platform === "win32";
const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

const ENV = { Path: "C:\\bin;C:\\Program Files\\nodejs", PathExt: ".COM;.EXE;.BAT;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe" };
/** @param {string[]} files */
const files = (...files) => (/** @type {string} */ p) => files.some((f) => f.toLowerCase() === p.toLowerCase());
/** @param {string} command @param {string[]} args @param {any} o */
const win = (command, args, o) => programSpawn(command, args, { cwd: "C:\\proj", env: ENV, platform: "win32", ...o });
/** What a batch file's line starts with: Windows' switch against the folder-first search, set for its cmd.exe (own-programs-batch.test.js). */
const OWN = "set NoDefaultCurrentDirectoryInExePath=1&";

// (fails before: yes — there was no lookup: "npx" was spawned as given and Node could not find it)
test("a bare name is found on the PATH with PATHEXT; a batch file runs through cmd.exe, an .exe as itself", () => {
  const isFile = files("C:\\Program Files\\nodejs\\npx.cmd", "C:\\bin\\node.exe", "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(win("npx", ["-y", "pkg@1"], { isFile }), {
    file: "C:\\Windows\\system32\\cmd.exe",
    args: ["/d", "/s", "/c", `"${OWN}C:\\Program^ Files\\nodejs\\npx.cmd ^^^"-y^^^" ^^^"pkg@1^^^""`],
    verbatim: true,
  });
  assert.deepEqual(win("node", ["a b"], { isFile }), { file: "C:\\bin\\node.exe", args: ["a b"], verbatim: false }, "the PATH's order: the first folder that has it");
  assert.equal(win("npx.cmd", [], { isFile }).args[3], `"${OWN}C:\\Program^ Files\\nodejs\\npx.cmd"`, "a name with its extension is looked up as it is");
  assert.deepEqual(win("npx", [], { isFile, env: { ...ENV, PathExt: ".EXE" } }), { file: "npx", args: [], verbatim: false }, "only PATHEXT's extensions are tried");
  assert.deepEqual(win("npx", [], { isFile, env: { Path: ENV.Path } }).file, "cmd.exe", "PATHEXT and ComSpec have defaults");
});

// (fails before: yes — there was no lookup)
test("the folder the server runs in is not searched; a path names a program there, with PATHEXT too", () => {
  const isFile = files("C:\\proj\\npx.cmd", "C:\\proj\\tools\\srv.cmd", "D:\\x\\y.exe");
  assert.deepEqual(win("npx", [], { isFile }), { file: "npx", args: [], verbatim: false }, "a project's own npx.cmd is never picked up by name");
  assert.equal(win(".\\tools\\srv", ["--port", "1"], { isFile }).args[3], `"${OWN}C:\\proj\\tools\\srv.cmd ^^^"--port^^^" ^^^"1^^^""`);
  assert.equal(win("tools/srv.cmd", [], { isFile }).args[3], `"${OWN}C:\\proj\\tools\\srv.cmd"`);
  assert.equal(win("D:\\x\\y", [], { isFile }).file, "D:\\x\\y.exe");
});

test("elsewhere a name is spawned as given", () => {
  assert.deepEqual(programSpawn("npx", ["-y"], { cwd: "/p", env: { PATH: "/usr/bin" }, platform: "linux", isFile: () => true }), { file: "npx", args: ["-y"], verbatim: false });
});

// (fails before: yes — a server's PATH stood beside the inherited Path, and the lookup read the inherited one)
test("withEnv: on Windows a name replaces its namesake in any case; elsewhere case is a different name", () => {
  assert.deepEqual(withEnv({ Path: "a", Other: "o" }, { PATH: "b" }, "win32"), { Other: "o", PATH: "b" });
  assert.deepEqual(withEnv({ Path: "a" }, { PATH: "b" }, "linux"), { Path: "a", PATH: "b" });
  assert.deepEqual(withEnv({ Path: "a" }, null, "win32"), { Path: "a" });
});

test("cmdArgument: quoted for the C runtime, every metacharacter escaped twice", () => {
  assert.equal(cmdArgument("plain"), "^^^\"plain^^^\"");
  assert.equal(cmdArgument("a&b"), "^^^\"a^^^&b^^^\"");
  assert.equal(cmdArgument("end\\"), "^^^\"end\\\\^^^\"", "a trailing backslash is doubled before the closing quote");
  assert.equal(cmdArgument('say "hi"'), "^^^\"say^^^ \\^^^\"hi\\^^^\"^^^\"");
});

// The real thing: cmd.exe, a batch file that forwards %* the way npm's shims do, in a folder with a space.
const HOSTILE = ["plain", "a b", 'say "hi"', "x&y", "100%", "%PATH%", "^caret", "!bang!", "(paren)", "trail\\", 'tr\\"q', "", "<>|", "semi;colon,comma", "star*q?", "é ü 中"];
/** A folder with a space in its name, a node script that prints its arguments, and `<name>.cmd` forwarding to it. */
const shimDir = (/** @type {string} */ name) => {
  const top = mkdtempSync(join(tmpdir(), "filament-mcpwin-"));
  made.push(top);
  const dir = join(top, "with space");
  mkdirSync(dir);
  writeFileSync(join(dir, "echo.js"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  writeFileSync(join(dir, `${name}.cmd`), `@"${process.execPath}" "%~dp0echo.js" %*\r\n`);
  return dir;
};

// (fails before: yes — the name was not found; with .cmd given, shell: true split "a b" and ran "y" after "x&")
test("a batch file found by name gets 16 hostile arguments exactly, through cmd.exe", { skip: !WIN && "Windows only" }, () => {
  const dir = shimDir("argshim");
  const env = withEnv(process.env, { PATH: `${dir};${process.env.PATH || ""}` });
  const run = programSpawn("argshim", HOSTILE, { cwd: tmpdir(), env });
  assert.equal(run.verbatim, true);
  const r = spawnSync(run.file, run.args, { env, encoding: "utf8", windowsVerbatimArguments: run.verbatim, windowsHide: true });
  assert.deepEqual(JSON.parse(r.stdout), HOSTILE, r.stderr);
});

// (fails before: yes — "could not start (spawn fakemcp ENOENT)")
test("an MCP server named by a bare name that is a .cmd connects and answers through cmd.exe", { skip: !WIN && "Windows only" }, async () => {
  const dir = shimDir("unused");
  writeFileSync(join(dir, "fakemcp.cmd"), `@"${process.execPath}" "${FIXTURE}" %*\r\n`);
  // The server's PATH spelled unlike the inherited one (Path from Explorer, PATH under Git Bash): it replaces it.
  const inherited = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  const name = inherited === "PATH" ? "Path" : "PATH";
  const c = await connectMcp({ name: "fx", command: "fakemcp", args: ["--stderr"], env: { [name]: `${dir};${process.env.PATH || ""}` } }, { cwd: tmpdir(), timeoutMs: 15_000 });
  try {
    assert.ok(c.tools.some((t) => t.tool === "echo"), JSON.stringify(c.tools.map((t) => t.tool)));
    assert.equal(await c.call("echo", { text: 'a & b "c" 100%' }), 'echo: a & b "c" 100%');
  } finally {
    await c.close();
  }
});

test("npx on this machine is found as its .cmd", { skip: !WIN && "Windows only" }, (t) => {
  const dir = String(process.env.PATH || "").split(";").find((d) => d && existsSync(win32.join(d, "npx.cmd")));
  if (!dir) return t.skip("no npx.cmd on the PATH");
  const run = programSpawn("npx", ["--version"], { cwd: tmpdir() });
  assert.equal(run.verbatim, true);
  assert.ok(run.args[3].toLowerCase().includes("npx.cmd"), run.args[3]);
  const r = spawnSync(run.file, run.args, { encoding: "utf8", windowsVerbatimArguments: true, windowsHide: true, timeout: 60_000 });
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/, r.stderr);
});
