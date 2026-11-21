// @ts-check
// The bash hand answers when the command's shell exits, even if a process the command started still holds the output
// pipe (BUG-17, 2026-09-30). The hand finished only on the pipe's close, so a command that left a process running
// (a server started in the background, a watcher a test runner left behind) held the turn for the whole timeout —
// the 10-minute test run of run muo3iumr. Now the shell's exit ends the call after a moment for the output to drain,
// the result says what still holds the pipe, and that process is left running, never killed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runHand } from "../src/adapters/tools/hands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { removeDirs, until } from "./helpers/wait.js";

const LINGER = fileURLToPath(new URL("./fixtures/linger.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "filament-linger-"));
const flag = join(dir, "release.flag");
// The lingering process exits when the flag appears: the test never leaves it behind.
after(async () => {
  try {
    writeFileSync(flag, "go");
  } catch {}
  // The folder is the lingering process's working directory: it goes once the process has seen the flag and left
  // (removing it first deleted the flag too, and the process lingered its full 20 s holding the folder).
  if (lingered) await until(() => existsSync(`${flag}.exited`), "the lingering process to see the flag and exit");
  await removeDirs(dir);
});
let lingered = false;

// (fails before: the call waited for the pipe until its own timeout — 8 s here, 600 s in the incident)
test("a command that leaves a process holding its output answers when its shell exits, and says so", async () => {
  const command =
    SHELL.kind === "cmd"
      ? `start /b "" node "${LINGER}" "${flag}" & echo started`
      : `node "${LINGER}" "${flag}" & echo started`;
  const t0 = Date.now();
  lingered = true;
  const out = String(await runHand("bash", { command, timeout: 8 }, { root: dir }));
  const took = Date.now() - t0;
  assert.ok(took < 5000, `answered ${took} ms after it started — at the shell's exit, not the command's timeout`);
  assert.match(out, /started/, "the output that arrived is kept");
  assert.doesNotMatch(out, /timed out/);
  assert.match(out, /still holds its output open/, `the result says what held the pipe: ${out}`);
});

test("a command whose output closes with it answers as before, with no note", async () => {
  const out = String(await runHand("bash", { command: "echo plain" }, { root: dir }));
  assert.match(out, /plain/);
  assert.doesNotMatch(out, /still holds its output open/);
});
