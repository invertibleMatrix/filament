// @ts-check
// A hook that was killed ends, whatever still holds its pipes (r-hands, 11-12; app/agent/hooks.js). The kill takes
// the hook's shell with what it started — on Windows by its tree, elsewhere by its process group — and a process the
// hook started that neither reaches (its parent had exited, so no tree leads to it; it left the group) keeps the
// hook's output open. The hook ended only at its pipes' close: past its time, or stopped with the turn, it held the
// turn until that process ended by itself, Stop included. Now a killed hook ends once its pipes had the moment the
// bash hand gives a shell's (hands.js `EXIT_DRAIN_MS`, test/bash-exit-drain.test.js), and that process is left running.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runHook } from "../src/app/agent/hooks.js";
import { removeDirs, until } from "./helpers/wait.js";

const LINGER = fileURLToPath(new URL("./fixtures/linger.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "filament-hook-settle-"));
// A program that starts the lingering process outside its own tree and its own process group, with this program's
// output for its own, and exits at once: what a hook's command leaves behind when it starts a server or a watcher.
const SPAWNER = join(dir, "spawner.cjs");
writeFileSync(SPAWNER, 'require("node:child_process").spawn(process.execPath, process.argv.slice(2), { detached: true, stdio: ["ignore", "inherit", "inherit"], windowsHide: true }).unref();\n');
/** The flags of the lingering processes started: each exits when its flag appears, so none is left behind. @type {string[]} */
const flags = [];
after(async () => {
  for (const flag of flags) {
    try {
      writeFileSync(flag, "go");
    } catch {}
  }
  // The folder goes once each has seen its flag and left (as test/bash-exit-drain.test.js does).
  for (const flag of flags) await until(() => existsSync(`${flag}.exited`), "the lingering process to see the flag and exit");
  await removeDirs(dir);
});

/**
 * A hook whose command starts a process that outlives the kill holding the hook's output, and then keeps its shell
 * busy; and whether it had ended 8 s after it started (the lingering process holds on for 20).
 * @param {string} name @param {{ timeoutMs?: number, stopAfterMs?: number }} o
 */
async function killedHook(name, { timeoutMs = 20_000, stopAfterMs = 0 }) {
  const flag = join(dir, `${name}.flag`);
  flags.push(flag);
  const stop = new AbortController();
  if (stopAfterMs) setTimeout(() => stop.abort(), stopAfterMs);
  const command = `node "${SPAWNER}" "${LINGER}" "${flag}" && node -e "setTimeout(()=>{},30000)"`;
  const t0 = Date.now();
  const hook = runHook({ on: "turn-end", command, timeoutMs }, { event: "turn-end", cwd: dir }, { signal: stop.signal }).then((r) => ({ ...r, took: Date.now() - t0 }));
  /** @type {NodeJS.Timeout | undefined} */
  let waited;
  const ended = await Promise.race([hook, new Promise((r) => (waited = setTimeout(() => r(null), 8_000)))]);
  clearTimeout(waited);
  // Either way the lingering process is let go, and the hook, which ends with it at the latest, is waited for.
  writeFileSync(flag, "go");
  await hook;
  return /** @type {Awaited<typeof hook> | null} */ (ended);
}

// (fails before: yes — still waiting 8 s after it started: the hook ended only when the lingering process did)
test("a hook past its time ends once it was killed, while a process it started still holds its output", async () => {
  const r = await killedHook("timed-out", { timeoutMs: 500 });
  assert.ok(r, "the hook ended within 8 s of its start");
  assert.deepEqual([r.verdict, r.timedOut, r.note], ["block", true, "the hook did not finish within 500 ms"]);
  assert.ok(r.took < 6_000, `it ended ${r.took} ms after it started: at its time, the kill and a moment for its pipes`);
});

// (fails before: yes — still waiting 8 s after it started: Stop did not end the hook, so it did not end the turn)
test("a hook stopped with the turn ends once it was killed, while a process it started still holds its output", async () => {
  const r = await killedHook("stopped", { stopAfterMs: 500 });
  assert.ok(r, "the hook ended within 8 s of its start");
  assert.deepEqual([r.verdict, r.timedOut, r.note], ["block", false, "the hook was stopped with the turn before it finished"]);
  assert.ok(r.took < 6_000, `it ended ${r.took} ms after it started`);
});
