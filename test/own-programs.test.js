// @ts-check
// A program Filament starts by a bare name is the PATH's, never the one a project's folder holds under that name
// (src/adapters/tools/own-programs.js). On Windows a bare name is looked for in the folder the program runs in before
// the PATH; the switch Windows has for it is read from the starting process's own environment, so each case here runs
// in a process of its own, started without the switch.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeDirs } from "./helpers/wait.js";

const WIN = process.platform === "win32";
const SWITCH = "NoDefaultCurrentDirectoryInExePath";
const url = (/** @type {string} */ rel) => pathToFileURL(fileURLToPath(new URL(rel, import.meta.url))).href;
const OWN = url("../src/adapters/tools/own-programs.js");
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));

/**
 * A script run by a Node of its own, started with this process's environment less the switch — plus `env` —, and what
 * it printed as JSON.
 * @param {string} body @param {Record<string, string>} [env]
 */
function inOwnProcess(body, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "filament-own-programs-"));
  made.push(dir);
  const file = join(dir, "run.mjs");
  writeFileSync(file, body);
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== SWITCH.toLowerCase()));
  const r = spawnSync(process.execPath, [file], { env: { ...base, ...env }, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `the script ran: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// (fails before: yes — nothing set the switch: with it unset, `spawn("hostname", { cwd })` ran the folder's
// hostname.exe — git, rg and an MCP server's program go the same way —, and a name nothing on the PATH answers to ran
// the folder's <name>.exe; probed on Node 24.12 with a copy of a system program under each name)
test("Windows: a bare name started in a folder that holds a program of that name starts the PATH's, and one the PATH has not starts nothing", { skip: !WIN }, () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-planted-"));
  made.push(dir);
  // whoami.exe prints "machine\user": told from hostname's own answer by its backslash.
  const planted = join(process.env.SystemRoot || "C:\\Windows", "System32", "whoami.exe");
  copyFileSync(planted, join(dir, "hostname.exe"));
  copyFileSync(planted, join(dir, "zzfilamentnone.exe"));
  // From the process's first thread, and from a thread of its own, as git is started (git/spawn-pool.js): the switch
  // is the process's, whichever thread starts the program.
  const RUN = `(name) => {
    const r = require("node:child_process").spawnSync(name, [], { cwd: ${JSON.stringify(dir)}, encoding: "utf8", windowsHide: true });
    return r.error ? "error " + r.error.code : String(r.stdout).trim();
  }`;
  const [named, unfound, set, threaded] = inOwnProcess(`
    import { createRequire } from "node:module";
    import { Worker } from "node:worker_threads";
    const require = createRequire(import.meta.url);
    const own = await import(${JSON.stringify(OWN)});
    const run = ${RUN};
    const threaded = await new Promise((done, failed) => {
      const w = new Worker(${JSON.stringify(`const run = ${RUN}; require("node:worker_threads").parentPort.postMessage([run("hostname"), run("zzfilamentnone")]);`)}, { eval: true });
      w.once("message", done);
      w.once("error", failed);
    });
    console.log(JSON.stringify([run("hostname"), run("zzfilamentnone"), own.SET_HERE, threaded]));
  `);
  assert.equal(set, true, "the switch was set by the import");
  assert.equal(named.toLowerCase(), hostname().toLowerCase(), "the PATH's hostname answered, not the folder's");
  assert.equal(unfound, "error ENOENT", "a name the PATH has not is not found, the folder's program of that name left alone");
  assert.deepEqual([threaded[0].toLowerCase(), threaded[1]], [hostname().toLowerCase(), "error ENOENT"], "and so from another thread");
});

// (fails before: yes — the module did not exist)
test("the switch is set on Windows alone, and only where the person's environment has none", async () => {
  const { FOLDER_SWITCH, OWN_VALUE, pathProgramsOnly, withoutOwnSwitch } = await import(OWN);
  assert.equal(FOLDER_SWITCH, SWITCH);
  /** @type {Record<string, string | undefined>} */
  const none = {};
  assert.equal(pathProgramsOnly(none, "win32"), true);
  assert.deepEqual(none, { [SWITCH]: OWN_VALUE });
  const theirs = { NODEFAULTCURRENTDIRECTORYINEXEPATH: "1" };
  assert.equal(pathProgramsOnly(theirs, "win32"), false, "the person's own stands as it is, in whatever case it is named");
  assert.deepEqual(theirs, { NODEFAULTCURRENTDIRECTORYINEXEPATH: "1" });
  // Handed on: the person's own; Filament's own is not, told by its value.
  assert.deepEqual(withoutOwnSwitch({ ...theirs, A: "b" }), { ...theirs, A: "b" });
  assert.deepEqual(withoutOwnSwitch({ ...none, A: "b" }), { A: "b" });
  /** @type {Record<string, string | undefined>} */
  const elsewhere = {};
  assert.equal(pathProgramsOnly(elsewhere, "linux"), false);
  assert.deepEqual(elsewhere, {}, "elsewhere a bare name is the PATH's already");
});

// (fails before: yes — the module did not exist; an agent's process, git and the person's terminal are handed
// Filament's whole environment)
test("Windows: what Filament set for itself is handed to no agent, no git and no terminal of the person's; their own switch is handed on", { skip: !WIN }, () => {
  const body = `
    const own = await import(${JSON.stringify(OWN)});
    const { agentEnv } = await import(${JSON.stringify(url("../src/adapters/agents/agent-process.js"))});
    const { baseEnv } = await import(${JSON.stringify(url("../src/adapters/git/snapshot.js"))});
    const { spawnTerminal } = await import(${JSON.stringify(url("../src/adapters/terminal/pty.js"))});
    const has = (env) => Object.keys(env).some((k) => k.toLowerCase() === ${JSON.stringify(SWITCH.toLowerCase())});
    let shell = null;
    spawnTerminal({ spawn: (x) => ((shell = x.env), {}) });
    console.log(JSON.stringify([own.SET_HERE, has(process.env), has(agentEnv().env), has(baseEnv()), has(shell)]));
  `;
  assert.deepEqual(inOwnProcess(body), [true, true, false, false, false], "Filament's own: in its process, in none it starts with its environment");
  assert.deepEqual(inOwnProcess(body, { [SWITCH]: "1" }), [false, true, true, true, true], "the person's own: theirs to hand on");
});

// (fails before: yes — neither named it)
test("whatever starts Filament imports the switch before anything else", () => {
  for (const file of ["../bin/filament.js", "../src/server.js"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    const first = text.split(/\r?\n/).find((l) => /^import\b/.test(l)) || "";
    assert.match(first, /^import "[./a-z-]*adapters\/tools\/own-programs\.js";/, `${file}: its first import`);
  }
});
