// @ts-check
// A checkout runs on its own data folder and port (the owner's of 10-28, once the installed app became the Filament
// used day to day): run from a git checkout, Filament defaults to Filament-dev beside the installed app's folder and
// listens on 20301, so a Filament being worked on never opens the installed one's chats, memory and keys, and both run at
// once. The installed app, which holds no .git, keeps Filament on 20300.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_PORT, appDataDir, defaultPort, isCheckout, loadConfig, resolveDataDir } from "../src/services/config/store.js";
import { portOf } from "../desktop/lib/start.js";
import { appIdOf, oldAppIdOf, oldLogonEntry } from "../desktop/lib/logon.js";
import { createRequire } from "node:module";

// electron-builder's own UUID, which it derives an installer's GUID with (a development dependency, as electron-builder is)
const { UUID } = createRequire(import.meta.url)("builder-util-runtime");

const read = (/** @type {string} */ f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// The user's application-data folder, a temporary one here: nothing under the real one is read or made.
const root = mkdtempSync(join(tmpdir(), "filament-data-dir-"));
const was = { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, FILAMENT_DATA_DIR: process.env.FILAMENT_DATA_DIR };
process.env.APPDATA = root;
process.env.XDG_CONFIG_HOME = root;
delete process.env.FILAMENT_DATA_DIR;
after(() => {
  for (const [k, v] of Object.entries(was)) if (v == null) delete process.env[k];
  else process.env[k] = v;
  rmSync(root, { recursive: true, force: true });
});
const win = process.platform === "win32";
const installed = join(root, win ? "Filament" : "filament");
const dev = join(root, win ? "Filament-dev" : "filament-dev");

// (fails before: yes — every run took the installed app's folder, a checkout's included)
test("run from a checkout, the data folder is Filament-dev beside the installed app's; the installed app keeps Filament; one given, or FILAMENT_DATA_DIR, wins", () => {
  assert.equal(appDataDir(), installed);
  assert.equal(appDataDir({ dev: true }), dev);
  assert.equal(resolveDataDir(undefined, { checkout: true }), dev);
  assert.equal(resolveDataDir(undefined, { checkout: false }), installed);
  assert.equal(resolveDataDir("D:\\given", { checkout: true }), "D:\\given");
  process.env.FILAMENT_DATA_DIR = join(root, "from-env");
  try {
    assert.equal(resolveDataDir(undefined, { checkout: true }), join(root, "from-env"));
  } finally {
    delete process.env.FILAMENT_DATA_DIR;
  }
  // with nothing said, this run is a checkout's
  assert.equal(resolveDataDir(), dev);
});

test("a checkout is a folder holding .git — a git folder, or a worktree's .git file; the installed app's holds none", () => {
  const plain = join(root, "app");
  mkdirSync(plain);
  assert.equal(isCheckout(plain), false, "the installed app's resources/app");
  const repo = join(root, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  assert.equal(isCheckout(repo), true);
  const worktree = join(root, "worktree");
  mkdirSync(worktree);
  writeFileSync(join(worktree, ".git"), "gitdir: ../repo/.git/worktrees/w\n");
  assert.equal(isCheckout(worktree), true);
  assert.equal(isCheckout(), true, "the folder these tests run in");
});

// (fails before: yes — a new Filament-dev config held 20300, the installed app's port)
test("the checkout's folder starts on 20301 — its first config holds it, and the desktop app reads it before there is one; any other folder on 20300", () => {
  assert.equal(DEV_PORT, 20301);
  assert.equal(defaultPort(dev), 20301);
  if (win) assert.equal(defaultPort(dev.toUpperCase()), 20301, "Windows reads a path without its case");
  assert.equal(defaultPort(installed), 20300);
  assert.equal(defaultPort(join(root, "throwaway")), 20300);

  assert.equal(portOf(dev), 20301, "the desktop app, before the folder has a config");
  const made = loadConfig(dev);
  assert.equal(made.created, true);
  assert.equal(made.config.server.port, 20301);
  assert.equal(JSON.parse(readFileSync(join(dev, "config.json"), "utf8")).server.port, 20301, "written, as it differs from the default");
  assert.equal(loadConfig(dev).config.server.port, 20301, "and read back");
  assert.equal(portOf(dev), 20301);

  const other = join(root, "other");
  assert.equal(loadConfig(other).config.server.port, 20300);
  assert.equal(portOf(other), 20300);
  // a port set in Settings is kept
  writeFileSync(join(dev, "config.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(dev, "config.json"), "utf8")), server: { port: 20444 } }));
  assert.equal(portOf(dev), 20444);
});

// (fails before: yes — both apps were filament.desktop to Windows, one taskbar button and one Start-at-logon entry)
test("a checkout's desktop app is another app to Windows: its own id, so its taskbar button and Start-at-logon entry are never the installed app's", () => {
  const main = read("desktop/main.js");
  assert.match(main, /import \{ isCheckout, resolveDataDir \} from "\.\.\/src\/config\.js";/);
  assert.match(main, /app\.setAppUserModelId\(appIdOf\(isCheckout\(\)\)\);/);
  assert.equal(appIdOf(true), "com.filamentdev.desktop.dev");
  assert.equal(appIdOf(false), "com.filamentdev.desktop");
  assert.match(read("electron-builder.yml"), /^appId: com\.filamentdev\.desktop$/m, "the installed app's id is the one electron-builder gives its shortcuts");
  // (fails before: yes — the review of 11-07: on Linux a window's app id is package.json's desktopName, which was unset,
  // so a dock could show a running Filament apart from the entry it was launched from)
  const yml = read("electron-builder.yml");
  const exe = /^linux:\n(?: {2}.*\n|\s*\n)*? {2}executableName: (\S+)$/m.exec(yml)?.[1];
  assert.equal(exe, "filament-desktop");
  assert.match(yml, new RegExp(`^extraMetadata:\\n(?: {2}.*\\n)*? {2}desktopName: ${exe}\\.desktop$`, "m"), "the .desktop entry electron-builder names by linux.executableName");
});

// (fails before: yes — the app's id was filament.desktop, and an id changed leaves Windows' login item under the old one)
test("the app's id is com.filamentdev.desktop: the installer keeps its old id, so an installed Filament upgrades in place, and the login item under the old id moves once", () => {
  // The GUID electron-builder derives from an app id with no guid set (NsisTarget.js: UUID.v5 of the id in its own
  // namespace): the old id's, under which the installed Filament's uninstall key stands.
  const derived = UUID.v5("filament.desktop", UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3"));
  assert.equal(derived, "f1a146da-8fb9-54f2-a195-f42a9d2d8ce4");
  assert.match(read("electron-builder.yml"), new RegExp(`^ {2}guid: ${derived}$`, "m"), "the GUID electron-builder derived from filament.desktop");
  assert.equal(oldAppIdOf(false), "filament.desktop");
  assert.equal(oldAppIdOf(true), "filament.desktop.dev");
  const items = [{ name: "com.filamentdev.desktop", enabled: true }, { name: "filament.desktop", enabled: true }];
  assert.deepEqual(oldLogonEntry(items, "filament.desktop"), { name: "filament.desktop", enabled: true });
  assert.deepEqual(oldLogonEntry([{ name: "filament.desktop", enabled: false }], "filament.desktop"), { name: "filament.desktop", enabled: false });
  assert.equal(oldLogonEntry([{ name: "com.filamentdev.desktop" }], "filament.desktop"), null);
  assert.equal(oldLogonEntry(undefined, "filament.desktop"), null, "a system that lists none (macOS, Linux)");
  const main = read("desktop/main.js");
  assert.match(main, /oldLogonEntry\(app\.getLoginItemSettings\(\{ path: item\.path, args: item\.args \}\)\.launchItems, oldAppIdOf\(isCheckout\(\)\)\)/);
  assert.match(main, /app\.setLoginItemSettings\(\{ openAtLogin: false, name: old\.name, path: item\.path, args: item\.args \}\);\n\s+if \(old\.enabled\) setLogon\(true\);/);
});

// (fails before: yes — run from the checkout, these would read the empty Filament-dev)
test("the scripts that work on the installed app's Filament keep its folder from a checkout; reset takes the run's own", () => {
  for (const f of ["scripts/copy-providers.mjs", "scripts/memory-bench.mjs", "scripts/memory-curator-live.mjs"]) {
    const s = read(f);
    assert.match(s, /\|\| appDataDir\(\);/, f);
    assert.doesNotMatch(s, /resolveDataDir/, f);
  }
  assert.match(read("scripts/reset.mjs"), /resolveDataDir\(/, "npm run reset in a checkout clears Filament-dev, never the installed app's");
});

test("the browser-window launcher in tray/ follows the same rule", () => {
  const ps = read("tray/filament-app.ps1");
  assert.match(ps, /\$devDir = Join-Path \$env:APPDATA "Filament-dev"/);
  assert.match(ps, /elseif \(Test-Path \(Join-Path \$root "\.git"\)\) \{ \$devDir \}/);
  assert.match(ps, /\$port = if \(\$dataDir -eq \$devDir\) \{ 20301 \} else \{ 20300 \}/);
});
