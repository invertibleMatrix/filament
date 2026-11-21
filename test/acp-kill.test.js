// @ts-check
// An agent's kill is carried out, not assumed. On Windows the agent's tree goes through taskkill (agents spawn helpers
// a bare kill would leave running); a full-suite run hung twice on an agent the bridge believed gone — nothing had read
// taskkill's exit, and the agent's open pipes held the test file's process. An agent already gone gets no taskkill.
import "./helpers/clean-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AcpProcess } from "../src/acp.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
/** The process module carries no types of its own. */
const Acp = /** @type {any} */ (AcpProcess);
/** @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** @param {() => boolean} ok @param {string} what */
const until = async (ok, what) => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > 10_000) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
/** A started fake agent, its pid, and what it logs; killed at the test's end if it outlived it. @param {import("node:test").TestContext} t */
const agent = async (t) => {
  /** @type {string[]} */
  const lines = [];
  const p = new Acp({ command: process.execPath, args: [FAKE], log: (/** @type {string} */ level, /** @type {string} */ msg) => lines.push(`${level} ${msg}`) }).start();
  const pid = Number(p.child?.pid);
  t.after(() => {
    if (alive(pid)) process.kill(pid);
  });
  await p.initialize();
  return { p, pid, lines };
};

// (fails before: yes — kill() started taskkill and never read its exit: with taskkill failing, the agent kept running
// with its pipes open; one that could not start ended the agent and said nothing)
test("a kill that taskkill fails to carry out, or that cannot start taskkill, still ends the agent and says so in the log", { skip: process.platform !== "win32" && "taskkill is Windows'" }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-acp-kill-"));
  // A taskkill that refuses every call: where.exe exits 2 on taskkill's arguments.
  copyFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe"), join(dir, "taskkill.exe"));
  const path = process.env.PATH;
  process.env.PATH = `${dir};${path}`;
  t.after(() => {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  });
  const failed = await agent(t);
  await failed.p.kill();
  await until(() => !alive(failed.pid), "the agent to end");
  assert.deepEqual(failed.lines, [`warn [acp] agent ${failed.pid}: taskkill exited 2; killing the agent directly`]);
  // No taskkill to start at all.
  const none = await agent(t);
  process.env.PATH = join(dir, "nothing-here");
  const killing = none.p.kill();
  process.env.PATH = `${dir};${path}`;
  await killing;
  await until(() => !alive(none.pid), "the agent to end");
  assert.deepEqual(none.lines, [`warn [acp] agent ${none.pid}: taskkill could not start (spawn taskkill ENOENT); killing the agent directly`]);
});

// (fails before: yes — kill() judged an agent gone by its exit code alone, and one that ended by a signal has none: taskkill
// went after a pid another process may hold by then) — with a guard the mutation pass asked for: a taskkill that worked
// leaves nothing to fall back on, and says nothing
test("a taskkill that works ends the agent and says nothing; an agent already ended by a signal gets no taskkill at all", { skip: process.platform !== "win32" && "taskkill is Windows'" }, async (t) => {
  const worked = await agent(t);
  await worked.p.kill();
  await until(() => !alive(worked.pid), "the agent to end");
  assert.deepEqual(worked.lines, []);
  // Ended by a signal, then killed again with a taskkill that refuses every call on the PATH: none is started.
  const ended = await agent(t);
  ended.p.child.kill();
  await until(() => !!ended.p.exitInfo, "Node to see it end");
  assert.deepEqual([ended.p.child.exitCode, ended.p.child.signalCode], [null, "SIGTERM"], "a signal's end has no exit code");
  const dir = mkdtempSync(join(tmpdir(), "filament-acp-kill-"));
  copyFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe"), join(dir, "taskkill.exe"));
  const path = process.env.PATH;
  process.env.PATH = `${dir};${path}`;
  t.after(() => {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  });
  await ended.p.kill();
  assert.deepEqual(ended.lines, []);
});

// (fails before: no — a guard the mutation pass asked for: Node's spawn throws at once for some errors instead of
// emitting one, and such a taskkill falls back the same way)
test("a taskkill whose spawn throws at once still ends the agent, and says so", { skip: process.platform !== "win32" && "taskkill is Windows'" }, async (t) => {
  const thrown = await agent(t);
  const cp = /** @type {any} */ (childProcess);
  const real = cp.spawn;
  cp.spawn = function (/** @type {any[]} */ ...args) {
    if (args[0] === "taskkill") throw new Error("spawn EPERM");
    return real.apply(this, args);
  };
  syncBuiltinESMExports();
  try {
    await thrown.p.kill();
  } finally {
    cp.spawn = real;
    syncBuiltinESMExports();
  }
  await until(() => !alive(thrown.pid), "the agent to end");
  assert.deepEqual(thrown.lines, [`warn [acp] agent ${thrown.pid}: taskkill could not start (spawn EPERM); killing the agent directly`]);
});
