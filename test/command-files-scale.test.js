// @ts-check
// What a session's commands changed, in a folder only it works in, joins its agent's own files (git/changes.js
// `placeChanges`), each file added to the agent's set where it stands: a set made anew for each file cost what it had
// grown to, for every file of every command, so a turn whose commands touched a build's thousands of files held the
// server for minutes (the owner's of 11-17: 344 s; 253 s of a profiled 266 s on that one line). What it gives is
// unchanged — test/agent-changes.test.js holds its words —; here, how long it holds the server at a build's size.
// (fails before: yes — 20,000 files took 13 s for one command, and about twice that for each further one that touched
// them)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { changesView } from "../src/app/sessions/changes-view.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args @param {string} [input] */
const git = (cwd, args, input) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 }).trim();

test("a session alone in its folder whose commands touched 20,000 files: its patch's words come at once, every file its commands', named", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-chg-many-"));
  made.push(dir);
  git(dir, ["init", "-q"]);
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "first"]);
  const base = git(dir, ["rev-parse", "HEAD"]);
  // A build's output, as a command leaves it: 20,000 files under one folder (one blob, its tree made by git itself).
  const blob = git(dir, ["hash-object", "-w", "--stdin"], "built\n");
  const N = 20_000;
  const built = git(dir, ["mktree"], Array.from({ length: N }, (_, i) => `100644 blob ${blob}\tf${String(i).padStart(5, "0")}.bin`).join("\n") + "\n");
  const top = git(dir, ["mktree"], `${git(dir, ["ls-tree", "HEAD"])}\n040000 tree ${built}\tLibrary\n`);
  const after1 = git(dir, ["commit-tree", top, "-p", base, "-m", "after the build"]);
  const place = git(dir, ["rev-parse", "--show-toplevel"]);
  // Three of the turn's commands, each round seeing the same build's files changed.
  /** @type {import("../src/services/memory/archive.js").RoundChange[]} */
  const rounds = [1, 2, 3].map((round) => ({ place, round, agent: "", before: base, after: after1, base: "round", own: [], command: true }));
  // What it holds the server for: its git calls run beside it, the loop free; its own work between them is what counts.
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const v = await changesView({ source: "turn", folder: dir, turn: 3, rounds, alone: new Set([place]) });
  delay.disable();
  assert.equal(v.files, N, String(v.note));
  assert.match(v.text, new RegExp(`\\(Filament: ${N.toLocaleString("en-US").replace(/,/g, ",?")} of these changed through its commands`));
  assert.ok(delay.max < 2e9, `the loop held ${(delay.max / 1e6).toFixed(0)} ms at once`);
});
