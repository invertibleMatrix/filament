// @ts-check
// A batch file Filament starts for one of its own programs — an MCP server, a language server, a dashboard's command,
// a script watcher's — starts what it names by a bare name from the PATH, never from the folder it runs in (r-hands,
// 11-12; adapters/tools/shell.js `startFound`). cmd.exe looks for a bare name in its folder before the PATH, and a
// shim starts its interpreter by one: npm's, with no node.exe beside it, runs `node`. Windows' switch against that
// (own-programs.test.js) is read by cmd.exe from its own environment, and the hands' environment is a list of names
// the switch is not on: a project's folder holding `node.cmd` had it run as the person. The batch file's line sets
// the switch first now. An agent's command in a terminal goes without: a shell's lookup is the person's.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { safeEnv } from "../src/adapters/tools/hands.js";
import { connectMcp } from "../src/adapters/tools/mcp-client.js";
import { programSpawn, terminalSpawn, withEnv } from "../src/adapters/tools/shell.js";
import { removeDirs } from "./helpers/wait.js";

const WIN = process.platform === "win32";
const ONLY_WIN = { skip: !WIN && "cmd.exe is Windows'" };
const SWITCH = "NoDefaultCurrentDirectoryInExePath";
const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

/**
 * A project's folder that holds a `node.cmd` of its own, which leaves a file where it ran; and a folder for the PATH,
 * with the batch files a test puts there.
 */
const planted = () => {
  const top = mkdtempSync(join(tmpdir(), "filament-own-batch-"));
  made.push(top);
  const [proj, bin] = [join(top, "proj"), join(top, "bin")];
  mkdirSync(proj);
  mkdirSync(bin);
  const marker = join(proj, "ran.txt");
  writeFileSync(join(proj, "node.cmd"), '@echo off\r\necho ran> "%~dp0ran.txt"\r\necho the folder\'s node.cmd ran\r\n');
  /** The hands' environment with `bin` first on its PATH: no switch in it, whatever this process has. */
  const env = withEnv(safeEnv(), { PATH: `${bin};${process.env.PATH || ""}` });
  return { proj, bin, marker, env };
};
/** A program started as `programSpawn` says. @param {ReturnType<typeof programSpawn>} run @param {{ cwd: string, env: Record<string, string | undefined> }} o */
const start = (run, o) => spawnSync(run.file, run.args, { ...o, encoding: "utf8", windowsHide: true, windowsVerbatimArguments: run.verbatim });

// (fails before: yes — "the folder's node.cmd ran", and the file it leaves was there)
test("a batch file started in a folder that holds a node.cmd runs the PATH's node", ONLY_WIN, () => {
  const { proj, bin, marker, env } = planted();
  assert.equal(Object.keys(env).some((k) => k.toLowerCase() === SWITCH.toLowerCase()), false, "the hands' environment carries no switch");
  writeFileSync(join(bin, "script.js"), 'console.log("the PATH\'s node ran", JSON.stringify(process.argv.slice(2)));\n');
  writeFileSync(join(bin, "zzfilamentshim.cmd"), '@ECHO off\r\nnode "%~dp0script.js" %*\r\n');
  const r = start(programSpawn("zzfilamentshim", ["a b", "x&y"], { cwd: proj, env }), { cwd: proj, env });
  assert.deepEqual([r.stdout.trim(), existsSync(marker), r.status], ['the PATH\'s node ran ["a b","x&y"]', false, 0], r.stderr);
});

// (fails before: no — a guard: the line's first command must not take the batch file's exit code from it)
test("the batch file's exit code is its own: an `exit /b`, and its last command's", ONLY_WIN, () => {
  const { proj, bin, env } = planted();
  writeFileSync(join(bin, "zzfilamentexit.cmd"), "@echo off\r\nexit /b 7\r\n");
  writeFileSync(join(bin, "zzfilamentlast.cmd"), `@echo off\r\n"${process.execPath}" -e "process.exit(3)"\r\n`);
  assert.equal(start(programSpawn("zzfilamentexit", [], { cwd: proj, env }), { cwd: proj, env }).status, 7);
  assert.equal(start(programSpawn("zzfilamentlast", [], { cwd: proj, env }), { cwd: proj, env }).status, 3);
});

// (fails before: yes — the server could not start: the folder's node.cmd ran in node's place, and left its file)
test("an MCP server whose batch file names a bare node connects, in a folder that holds a node.cmd", ONLY_WIN, async () => {
  const { proj, bin, marker } = planted();
  writeFileSync(join(bin, "zzfilamentmcp.cmd"), `@ECHO off\r\nnode "${FIXTURE}" %*\r\n`);
  /** @type {Awaited<ReturnType<typeof connectMcp>> | null} */
  let c = null;
  try {
    c = await connectMcp({ name: "fx", command: "zzfilamentmcp", args: [], env: { PATH: `${bin};${process.env.PATH || ""}` } }, { cwd: proj, timeoutMs: 15_000 });
    assert.ok(c.tools.some((t) => t.tool === "echo"), JSON.stringify(c.tools.map((t) => t.tool)));
  } finally {
    await c?.close();
    assert.equal(existsSync(marker), false, "the folder's node.cmd did not run");
  }
});

// (fails before: yes — a batch file's line named the file alone)
test("the switch is set in the line of a batch file Filament starts for itself, and in no other", () => {
  const env = { Path: "C:\\bin", PathExt: ".COM;.EXE;.BAT;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe" };
  const isFile = (/** @type {string} */ p) => ["c:\\bin\\srv.cmd", "c:\\bin\\tool.exe"].includes(p.toLowerCase());
  const o = { cwd: "C:\\proj", env, platform: "win32", isFile };
  assert.deepEqual(programSpawn("srv", ["--port", "1"], o), { file: env.ComSpec, args: ["/d", "/s", "/c", `"set ${SWITCH}=1&C:\\bin\\srv.cmd ^^^"--port^^^" ^^^"1^^^""`], verbatim: true });
  assert.deepEqual(programSpawn("tool", ["a b"], o), { file: "C:\\bin\\tool.exe", args: ["a b"], verbatim: false }, "an .exe starts as itself: no cmd.exe looks anything up");
  assert.deepEqual(terminalSpawn("srv", ["--port", "1"], o).args, ["/d", "/s", "/c", '"C:\\bin\\srv.cmd ^^^"--port^^^" ^^^"1^^^""'], "an agent's command in a terminal is a shell's");
});
