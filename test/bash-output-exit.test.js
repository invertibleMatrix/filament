// @ts-check
// bash_output reports a command's exit together with its last line (BUG-23, 2026-09-30). A waiting read returned the
// moment output landed; a command's last line reaches the pipe a few milliseconds before the process exits, so the
// read said "still running" with the final output — and on a loaded machine the full suite's shell test failed on
// exactly that gap. A read that ends on output now gives the exit a short moment, inside the wait it was given.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runHand, disposeBackgroundShells } from "../src/adapters/tools/hands.js";

after(() => disposeBackgroundShells());
const root = tmpdir();
const idOf = (/** @type {string} */ text) => (/bg_[0-9a-z]+/.exec(text) || [""])[0];

// (fails before: "[bg_… still running]\nLAST" — the exit landed 150 ms after the line the read returned on)
test("a waiting bash_output that ends on a command's last line reports its exit too", async () => {
  const cmd = `node -e "setTimeout(()=>{console.log('LAST');setTimeout(()=>{},150)},600)"`;
  const start = String(await runHand("bash_background", { command: cmd, grace: 0.1 }, { root }));
  const id = idOf(start);
  assert.ok(id, start);
  const out = String(await runHand("bash_output", { id, wait: 5 }, { root }));
  assert.match(out, /LAST/);
  assert.match(out, /exited with code 0/, out);
});

test("a waiting read on a command that keeps running still returns promptly after its output", async () => {
  const cmd = `node -e "setTimeout(()=>console.log('FIRST'),300);setTimeout(()=>{},8000)"`;
  const start = String(await runHand("bash_background", { command: cmd, grace: 0.1 }, { root }));
  const id = idOf(start);
  assert.ok(id, start);
  const t0 = Date.now();
  const out = String(await runHand("bash_output", { id, wait: 10 }, { root }));
  const took = Date.now() - t0;
  assert.match(out, /FIRST/);
  assert.match(out, /still running/);
  assert.ok(took < 3000, `the read returned ${took} ms after it started — the settle is a moment, not the whole wait`);
  await runHand("bash_kill", { id }, { root });
});
