// @ts-check
// HarnessV4_Tasks C4. Ending a process with what it started (adapters/tools/kill-tree.js). On Windows that is
// taskkill's work, and three kills started it without reading its exit: a hook's command, a terminal's shell and
// memory's engine. With taskkill failing, each kept running while Filament believed it gone. An agent's process and an
// MCP server had the fix already, each in its own copy (test/acp-kill.test.js, test/mcp-client.test.js); all six go
// through the one kill now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { killTree } from "../src/adapters/tools/kill-tree.js";
import { LocalHands } from "../src/adapters/tools/local-hands.js";
import { runHook } from "../src/app/agent/hooks.js";
import { MemoryEngine } from "../src/memory-engine.js";
import { removeDirs, until } from "./helpers/wait.js";

const WIN = process.platform === "win32";
const ONLY_WIN = { skip: !WIN && "taskkill is Windows'" };
const FAKE_ENGINE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
const HOOK = `node "${fileURLToPath(new URL("./fixtures/hook.mjs", import.meta.url))}"`;
// A process that starts another outside its own job, as a shell starts a program, writes that one's id to the file
// it is given, and waits. Killed alone, it leaves the other running.
const PARENT =
  'const c = require("child_process").spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore", detached: true, windowsHide: true }); require("fs").writeFileSync(process.argv[1], String(c.pid)); setTimeout(() => {}, 60000);';

/** @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A scratch folder, removed at the test's end. @param {import("node:test").TestContext} t */
const scratch = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-killtree-"));
  t.after(() => removeDirs(dir));
  return dir;
};

/**
 * A taskkill that refuses every call, first on the PATH for this test: where.exe exits 2 on taskkill's arguments.
 * @param {import("node:test").TestContext} t
 * @returns {{ none: () => void, back: () => void }}  `none`: no taskkill to start at all; `back`: the refusing one
 */
const refusingTaskkill = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-killtree-bin-"));
  copyFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe"), join(dir, "taskkill.exe"));
  const path = process.env.PATH;
  const back = () => void (process.env.PATH = `${dir};${path}`);
  back();
  t.after(async () => {
    process.env.PATH = path;
    await removeDirs(dir);
  });
  return { none: () => void (process.env.PATH = join(dir, "nothing-here")), back };
};

/**
 * A taskkill that hangs, first on the PATH for this test: Node under taskkill's name, made to wait a minute before it
 * reads its arguments; its program (`exe`). It is ended at the test's end, where nothing ended it before.
 * @param {import("node:test").TestContext} t
 */
const hangingTaskkill = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-killtree-hang-"));
  copyFileSync(process.execPath, join(dir, "taskkill.exe"));
  const pidFile = join(dir, "pid");
  const wait = join(dir, "wait.cjs");
  writeFileSync(wait, `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);`);
  const path = process.env.PATH;
  const options = process.env.NODE_OPTIONS;
  process.env.PATH = `${dir};${path}`;
  // NODE_OPTIONS reads a backslash in quotes as an escape.
  process.env.NODE_OPTIONS = `--require "${wait.replace(/\\/g, "/")}"`;
  t.after(async () => {
    process.env.PATH = path;
    if (options === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = options;
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
    if (pid && alive(pid)) process.kill(pid);
    await removeDirs(dir);
  });
  return { exe: join(dir, "taskkill.exe") };
};

/** A running parent and the process it started. @param {import("node:test").TestContext} t */
const family = async (t) => {
  const file = join(scratch(t), "pid");
  const parent = spawn(process.execPath, ["-e", PARENT, file], { stdio: "ignore", windowsHide: true });
  const kid = Number(await until(() => existsSync(file) && readFileSync(file, "utf8"), "the parent to start its child"));
  t.after(() => {
    for (const pid of [parent.pid, kid]) if (pid && alive(pid)) process.kill(pid);
  });
  return { parent, pid: Number(parent.pid), kid };
};

/** A stand-in for a child process: only what the kill reads. @param {Partial<{ pid: number, exitCode: number | null, signalCode: string | null }>} [o] */
const standIn = (o = {}) => {
  const c = { pid: 4, exitCode: null, signalCode: null, kills: 0, kill: () => void c.kills++, ...o };
  return /** @type {any} */ (c);
};

// (fails before: no — the kill as an agent's process had it, now the one every caller shares)
test("a kill ends the process with what it started, and says nothing", ONLY_WIN, async (t) => {
  const { parent, pid, kid } = await family(t);
  /** @type {string[]} */
  const said = [];
  await killTree(parent, { warn: (w) => said.push(w) });
  await until(() => !alive(pid) && !alive(kid), "the parent and what it started to end");
  assert.deepEqual(said, []);
});

test("a taskkill that fails, or cannot start, leaves the process to the direct kill and says why", ONLY_WIN, async (t) => {
  const path = refusingTaskkill(t);
  /** @type {string[]} */
  const said = [];
  const failed = await family(t);
  await killTree(failed.parent, { warn: (w) => said.push(w) });
  await until(() => !alive(failed.pid), "the parent to end");
  const none = await family(t);
  path.none();
  const killing = killTree(none.parent, { warn: (w) => said.push(w) });
  path.back();
  await killing;
  await until(() => !alive(none.pid), "the parent to end");
  assert.deepEqual(said, ["exited 2", "could not start (spawn taskkill ENOENT)"]);
});

test("no taskkill for a process already gone, on the caller's word or by Node's own; none where there is no taskkill", ONLY_WIN, async (t) => {
  refusingTaskkill(t); // any taskkill started here would be said
  /** @type {string[]} */
  const said = [];
  const warn = (/** @type {string} */ w) => said.push(w);
  const gone = standIn();
  await killTree(gone, { gone: true, warn });
  const exited = standIn({ exitCode: 0 });
  await killTree(exited, { warn });
  const signalled = standIn({ signalCode: "SIGTERM" });
  await killTree(signalled, { warn });
  const elsewhere = standIn();
  await killTree(elsewhere, { platform: "linux", warn });
  const unborn = standIn({ pid: 0 });
  await killTree(unborn, { warn });
  assert.deepEqual([gone.kills, exited.kills, signalled.kills, elsewhere.kills, unborn.kills], [1, 1, 1, 1, 1], "each got the direct kill");
  assert.deepEqual(said, []);
  await killTree(null, { warn });
  // The caller's own kill stands in for the child's: a hook ends its process group that way.
  let own = 0;
  const grouped = standIn();
  await killTree(grouped, { platform: "linux", direct: () => void own++ });
  assert.deepEqual([own, grouped.kills], [1, 0]);
  // And one that throws is the caller's to have guarded: the kill still settles.
  await killTree(standIn(), { platform: "linux", direct: () => { throw new Error("no such process"); } });
});

test("a process that ended while taskkill looked for it is not a failure", ONLY_WIN, async (t) => {
  refusingTaskkill(t);
  /** @type {string[]} */
  const said = [];
  const ended = standIn();
  const killing = killTree(ended, { warn: (w) => said.push(w) });
  ended.exitCode = 0; // Node sees it end before taskkill answers
  await killing;
  assert.deepEqual([said, ended.kills], [[], 0]);
  const stays = standIn();
  await killTree(stays, { warn: (w) => said.push(w) });
  assert.deepEqual([said, stays.kills], [["exited 2"], 1]);
});

// (fails before: yes — the bug hunt of 10-30: nothing ended the wait for a taskkill that hung, so the kill, and every
// stop that waited for it — memory's engine's among them — hung with it)
test("a taskkill that hangs holds the kill no longer than its time: the process goes to the direct kill, and why is said", ONLY_WIN, async (t) => {
  const fake = hangingTaskkill(t);
  // The hanging one is the taskkill the kill starts: the first found in the folder, then on the PATH, as Node's spawn
  // looks. Whether it gets as far as saying it started is node's start against the kill's half second, which a loaded
  // machine loses: the kill ends it at its time, up or not.
  assert.equal(execFileSync("where", ["taskkill"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/)[0], fake.exe, "the hanging taskkill is the one started");
  /** @type {string[]} */
  const said = [];
  const child = standIn();
  const killed = killTree(child, { warn: (w) => said.push(w), waitMs: 500 }).then(() => "settled");
  const out = await Promise.race([killed, new Promise((r) => setTimeout(() => r("still waiting"), 8_000))]);
  assert.equal(out, "settled", "the kill settles once taskkill's time is up");
  assert.deepEqual([said, child.kills], [["did not finish in 1 s"], 1]);
});

// (fails before: yes — the hook's kill started taskkill and never read its exit: with taskkill failing nothing was
// killed at all, the turn waited for the hook's own end, and its note said only that it did not finish in time)
test("a hook whose tree taskkill could not end has its shell killed and ends there, and its note says so", ONLY_WIN, async (t) => {
  refusingTaskkill(t);
  const cwd = scratch(t);
  const base = { event: /** @type {const} */ ("pre-tool"), tool: "bash", input: { command: "ls" }, round: 1, turn: 1, session: "s1", cwd };
  const t0 = Date.now();
  // Its command outlives the shell that started it by a few seconds, holding the hook's pipes.
  const slow = await runHook({ on: "pre-tool", command: `${HOOK} sleep 6000`, timeoutMs: 300 }, base);
  const took = Date.now() - t0;
  assert.equal(slow.verdict, "block");
  assert.equal(slow.timedOut, true);
  assert.equal(slow.note, "the hook did not finish within 300 ms; Filament could not end what it started (taskkill exited 2) and killed its shell alone");
  assert.ok(took < 4_000, `the hook's end did not wait for what was left of it (${took} ms)`);
});

// (fails before: yes — with taskkill failing the terminal's shell kept running, and the terminal never exited)
test("a terminal whose tree taskkill could not end has its shell killed, and the log says so", ONLY_WIN, async (t) => {
  refusingTaskkill(t);
  /** @type {string[]} */
  const lines = [];
  const hands = new LocalHands({ log: (level, msg) => lines.push(`${level} ${msg}`) });
  /** @type {any} */
  const term = { output: "", exit: null };
  const ran = hands.runTerminal(/** @type {any} */ ({ command: process.execPath, args: ["-e", "setTimeout(()=>{},60000)"], cwd: scratch(t) }), term);
  const pid = Number(term.child.pid);
  t.after(() => {
    if (alive(pid)) process.kill(pid);
  });
  hands.kill(term);
  await ran;
  assert.ok(term.exit, "the terminal exited");
  assert.deepEqual(lines, [`warn terminal ${pid}: taskkill exited 2; killing its shell directly`]);
  // One that has exited gets no kill at all.
  hands.kill(term);
  assert.equal(lines.length, 1);
});

// (fails before: no for the engine's end — the direct kill went first; yes for the order and the words: taskkill ran
// after the engine was already dead, when its tree can no longer be found, and its failure was never read)
test("memory's engine is ended by its tree while it still runs; a taskkill that fails is said in the log", ONLY_WIN, async (t) => {
  refusingTaskkill(t);
  /** @type {string[]} */
  const lines = [];
  const e = new MemoryEngine(/** @type {any} */ ({ command: process.execPath, args: [FAKE_ENGINE], env: { FAKE_SIDECAR_HANG_ON: "get" }, writeConfig: false, log: (/** @type {string} */ level, /** @type {string} */ msg) => lines.push(`${level} ${msg}`) }));
  t.after(() => e.stop());
  await e.ensure();
  const pid = Number(e.status().pid);
  const hung = e.get("m1");
  hung.catch(() => {});
  await until(() => e.status().pending === 1, "the call to be in flight");
  await e.restart();
  await until(() => !alive(pid), "the hung engine to end");
  assert.ok(lines.includes(`warn memory engine ${pid}: taskkill exited 2; killing the engine directly`), lines.join(" | "));
});
