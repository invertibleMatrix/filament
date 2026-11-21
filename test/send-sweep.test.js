// @ts-check
// The temp folders a send, a capture and a change coming back are bundled in (adapters/git/send.js `bundleSnapshot`,
// `captureCopy`; remote-agents.js `takeBack`), where a crash left one: swept by the next send, a day on. A file of its
// own: the sweep runs once an hour in a process, and this test's send is its first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleSnapshot } from "../src/adapters/git/send.js";

// (fails before: yes — the re-read of 11-11, its finding 12: only `filament-capture-*` was ever swept, and only by a
// capture: a send's and a coming back's folder a crash left — a project's bundle each — stayed in the temp folder for good)
test("the temp folders a crash left — a send's, a capture's, a change coming back's — are swept by the next send once a day old; a newer one, and a folder of another's name, stay", async (t) => {
  const old = Date.now() / 1000 - 25 * 3600;
  /** A folder in the temp folder, a bundle in it, last written `at` (seconds). @param {string} prefix @param {number | null} at */
  const left = (prefix, at) => {
    const d = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    writeFileSync(join(d, "copy.bundle"), "what a crash left\n");
    if (at) utimesSync(d, at, at);
    return d;
  };
  const stale = ["filament-send-", "filament-capture-", "filament-back-"].map((p) => left(p, old));
  const fresh = ["filament-send-", "filament-capture-", "filament-back-"].map((p) => left(p, null));
  const others = [left("filament-sendings-", old), left("other-filament-send-", old)];

  const dir = mkdtempSync(join(tmpdir(), "filament-sweep-repo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
  const b = await bundleSnapshot(dir, { machine: "m", project: "p" });
  assert.ok(b.ok && b.dir, b.ok ? "" : b.error);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  // The sweep is not waited for by the send: a moment for it.
  for (let i = 0; i < 100 && stale.some((d) => existsSync(d)); i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(stale.map((d) => existsSync(d)), [false, false, false], "a day old: swept");
  assert.deepEqual(fresh.map((d) => existsSync(d)), [true, true, true], "newer: one may be in use");
  assert.deepEqual(others.map((d) => existsSync(d)), [true, true], "another's name: not Filament's to remove");
  assert.equal(existsSync(b.dir), true, "this send's own");
});
