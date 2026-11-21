// @ts-check
// node-pty's spawn-helper made runnable (scripts/pty-helper.mjs; the owner's Mac of 11-08: an agent's Install opened no
// terminal, and Connect then said the agent wasn't on the computer). node-pty 1.1.0's package carries the helper every
// Mac terminal starts through without its execute bits: after an install, and before a build, they are set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ptyHelpers, ptyHelpersRunnable } from "../scripts/pty-helper.mjs";

/** A folder with node-pty installed in it, its helpers as npm leaves them: read and written, never run. */
function installed() {
  const root = mkdtempSync(join(tmpdir(), "fl-pty-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", type: "module" }));
  const pty = join(root, "node_modules", "node-pty");
  mkdirSync(pty, { recursive: true });
  writeFileSync(join(pty, "package.json"), JSON.stringify({ name: "node-pty", version: "1.1.0", main: "lib/index.js" }));
  const helpers = ["darwin-arm64", "darwin-x64"].map((d) => join(pty, "prebuilds", d, "spawn-helper"));
  for (const f of helpers) {
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "helper");
    chmodSync(f, 0o644);
  }
  mkdirSync(join(pty, "prebuilds", "win32-x64"), { recursive: true });
  return { root, helpers };
}

// (fails before: yes — nothing set them, and every terminal of the Mac app failed with "posix_spawnp failed")
test("node-pty's helpers are made runnable where they are not, once; on Windows nothing is touched", () => {
  const { root, helpers } = installed();
  try {
    assert.deepEqual(ptyHelpers(root), helpers, "each Mac's prebuilt helper, found as node finds node-pty");
    assert.deepEqual(ptyHelpersRunnable({ root, platform: "win32" }), [], "Windows: no mode to set");
    if (process.platform !== "win32") {
      assert.deepEqual(ptyHelpersRunnable({ root, platform: "darwin" }), helpers);
      for (const f of helpers) assert.equal(statSync(f).mode & 0o777, 0o755);
      assert.deepEqual(ptyHelpersRunnable({ root, platform: "darwin" }), [], "runnable already: left as it is");
    }
    assert.deepEqual(ptyHelpers(mkdtempSync(join(tmpdir(), "fl-nopty-"))), [], "no node-pty: none");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// (fails before: yes — the sv-dist hunt's: a Linux prebuild's helper was never made runnable, and a server's tarball
// packed it as node-pty left it, so every terminal there would fail with "posix_spawnp failed")
test("a Linux prebuild's helper is made runnable too, as one built from source is", () => {
  const { root } = installed();
  const linux = ["linux-x64", "linux-arm64"].map((d) => join(root, "node_modules", "node-pty", "prebuilds", d, "spawn-helper"));
  for (const f of linux) {
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "helper");
    chmodSync(f, 0o644);
  }
  try {
    for (const f of linux) assert.ok(ptyHelpers(root).includes(f), `found: ${f}`);
    if (process.platform !== "win32") {
      const changed = ptyHelpersRunnable({ root, platform: "linux" });
      for (const f of linux) {
        assert.ok(changed.includes(f), `made runnable: ${f}`);
        assert.equal(statSync(f).mode & 0o777, 0o755);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every install runs it, a checkout's and an npm install of Filament's: its script is published", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.postinstall, "node scripts/pty-helper.mjs");
  assert.ok(pkg.files.includes("scripts/"));
});
