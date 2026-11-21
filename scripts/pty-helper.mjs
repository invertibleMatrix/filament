#!/usr/bin/env node
// @ts-check
// node-pty's spawn-helper made runnable (the owner's Mac of 11-08: an agent's Install opened no terminal, and its
// Connect then said the agent wasn't on the computer). Every terminal on a Mac starts through that helper — the
// Terminal pane's, an install's, a sign-in's — and node-pty 1.1.0's package carries it without its execute bits, which
// nothing of node-pty's own install sets: each terminal failed with "posix_spawnp failed". A Linux prebuild's is set
// too, where node-pty carries one: a server's tarball packs each helper with the bits it finds. Run after every install
// (package.json's postinstall, a checkout's and an npm install of Filament's alike) and before every build
// (scripts/dist.mjs), so an app is packed, and signed, with it runnable. It never fails an install.
import { chmodSync, existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** node-pty's folder as `root` finds it (hoisted or not), or null. @param {string} root */
const ptyDir = (root) => {
  try {
    return dirname(createRequire(join(root, "package.json")).resolve("node-pty/package.json"));
  } catch {
    return null;
  }
};

/** node-pty's helpers under `root`: the prebuilt ones for each Mac and Linux machine, and one built from source. @param {string} root */
export function ptyHelpers(root) {
  const pty = ptyDir(root);
  if (!pty) return [];
  const prebuilt = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"].map((d) => join(pty, "prebuilds", d, "spawn-helper"));
  return [...prebuilt, join(pty, "build", "Release", "spawn-helper")].filter((f) => existsSync(f));
}

/**
 * Each of node-pty's helpers runnable: the execute bits set where they are not. → the ones it changed. On Windows,
 * none: a file there has no such bits, and its terminals start through no helper.
 * @param {{ root?: string, platform?: string }} [o]
 * @returns {string[]}
 */
export function ptyHelpersRunnable({ root = ROOT, platform = process.platform } = {}) {
  if (platform === "win32") return [];
  /** @type {string[]} */
  const changed = [];
  for (const f of ptyHelpers(root)) {
    const mode = statSync(f).mode & 0o777;
    if ((mode & 0o111) === 0o111) continue;
    chmodSync(f, mode | 0o111);
    changed.push(f);
  }
  return changed;
}

/** Run as itself, by real paths (check-memory-bundle.mjs's `isMain`, which an install loads none of the engine's code for). */
const ran = () => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (ran()) {
  try {
    for (const f of ptyHelpersRunnable()) console.log(`node-pty's helper made runnable: ${f}`);
  } catch (e) {
    console.warn(`node-pty's helper could not be made runnable (${/** @type {any} */ (e)?.message || e}): a Mac's terminals won't start until it is (chmod +x it)`);
  }
}
