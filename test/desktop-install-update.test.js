// @ts-check
// How an update fetched and checked installs, per system (the owner's of 11-07): a Mac's zip handed to Squirrel.Mac from
// a server of the app's own on 127.0.0.1, an AppImage replaced in one rename, a deb through the system's password
// prompt, and how a Linux app starts again; main.js's wiring of them, read as source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { DEB_INSTALL, installDeb, readySquirrel, relaunchOf, replaceAppImage } from "../desktop/lib/install-update.js";
import { updateNote, updateOutNote } from "../desktop/lib/notes.js";

const tmp = () => mkdtempSync(join(tmpdir(), "filament-install-"));

/**
 * Squirrel.Mac, faked as it behaves: told a feed, it asks it, fetches the address the feed answers with, and says
 * update-downloaded once it has the zip — or an error. @param {{ fail?: string, none?: boolean }} [o]
 */
function squirrel(o = {}) {
  const e = new EventEmitter();
  /** @type {any} */
  const seen = { feed: "", got: null, asked: [] };
  return Object.assign(e, {
    seen,
    setFeedURL: (/** @type {any} */ f) => (seen.feed = f),
    checkForUpdates: () =>
      void (async () => {
        if (o.fail) return void e.emit("error", new Error(o.fail));
        const feed = await (await fetch(seen.feed.url)).json();
        seen.asked.push(seen.feed.url, feed.url);
        if (o.none) return void e.emit("update-not-available");
        seen.got = Buffer.from(await (await fetch(feed.url)).arrayBuffer());
        // a guess at the zip's address on the same server is refused
        seen.stranger = (await fetch(new URL("/other/feed", seen.feed.url))).status;
        e.emit("update-downloaded");
      })(),
  });
}

// (fails before: yes — the owner's of 11-07: there was no Mac update; the updater ran Windows' installer alone)
test("a Mac's zip goes to Squirrel.Mac from a server of the app's own: a feed that names the zip, the zip itself, nothing else; it closes after", async () => {
  const dir = tmp();
  try {
    const zip = join(dir, "Filament-0.9.1-mac-arm64.zip");
    writeFileSync(zip, "PK the new app");
    const s = squirrel();
    /** @type {string[]} */
    const said = [];
    await readySquirrel({ autoUpdater: /** @type {any} */ (s), zip, log: (l) => said.push(l) });
    assert.equal(s.seen.feed.serverType, "default");
    assert.match(s.seen.feed.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/feed$/, "on the loopback, behind a token");
    assert.equal(s.seen.asked[1], s.seen.feed.url.replace(/feed$/, "Filament-0.9.1-mac-arm64.zip"));
    assert.equal(String(s.seen.got), "PK the new app");
    assert.equal(s.seen.stranger, 404);
    assert.deepEqual(said, ["updates: handing Filament-0.9.1-mac-arm64.zip to Squirrel.Mac"]);
    assert.equal(s.listenerCount("update-downloaded") + s.listenerCount("error"), 0, "its listeners go");
    await assert.rejects(fetch(s.seen.feed.url), "the server is closed");
    await assert.rejects(readySquirrel({ autoUpdater: /** @type {any} */ (squirrel({ fail: "Cannot update while running on a read-only volume" })), zip }), /^Error: Squirrel\.Mac: Cannot update while running on a read-only volume$/);
    await assert.rejects(readySquirrel({ autoUpdater: /** @type {any} */ (squirrel({ none: true })), zip }), /found no update at the feed/);
    const silent = Object.assign(new EventEmitter(), { setFeedURL: () => {}, checkForUpdates: () => {} });
    await assert.rejects(readySquirrel({ autoUpdater: /** @type {any} */ (silent), zip, timeoutMs: 30 }), /did not ready the update in 0 minutes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an AppImage is replaced in one rename, runnable, its path kept; one that can't be leaves the old whole and nothing beside it", () => {
  const dir = tmp();
  try {
    const old = join(dir, "Filament-0.9.0-linux-x86_64.AppImage"),
      next = join(dir, "updates-Filament-0.9.1-linux-x86_64.AppImage");
    writeFileSync(old, "the old image");
    writeFileSync(next, "the new image");
    assert.deepEqual(replaceAppImage(next, old), { ok: true });
    assert.equal(readFileSync(old, "utf8"), "the new image");
    if (process.platform !== "win32") assert.equal(statSync(old).mode & 0o777, 0o755);
    assert.ok(!existsSync(`${old}.new`));
    const denied = replaceAppImage(next, old, { rename: () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } });
    assert.deepEqual(denied, { ok: false, why: `the AppImage at ${old} can't be replaced (EACCES)` });
    assert.deepEqual(readdirSync(dir).sort(), [old, next].map((f) => f.split(/[\\/]/).pop()).sort(), "no .new left");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a deb installs through pkexec and apt; a prompt dismissed, a refusal, no pkexec and apt's failure each say why", async () => {
  /** @param {{ code?: number, error?: any }} o */
  const spawned = (o) => {
    /** @type {any[]} */
    const calls = [];
    const spawnImpl = /** @type {any} */ ((/** @type {string} */ file, /** @type {string[]} */ args) => {
      calls.push([file, ...args]);
      const child = new EventEmitter();
      setImmediate(() => (o.error ? child.emit("error", o.error) : child.emit("close", o.code)));
      return child;
    });
    return { spawnImpl, calls };
  };
  const SUM = createHash("sha512").update("the deb").digest("base64");
  const ok = spawned({ code: 0 });
  assert.deepEqual(await installDeb("/u/Filament-0.9.1-linux-amd64.deb", SUM, { spawnImpl: ok.spawnImpl }), { ok: true });
  // (fails before: yes — the review of 11-07: root ran apt on the file in the person's own folder, checked when it came)
  assert.deepEqual(ok.calls, [["pkexec", "/bin/sh", "-c", DEB_INSTALL, "filament-update", "/u/Filament-0.9.1-linux-amd64.deb", Buffer.from(SUM, "base64").toString("hex")]]);
  assert.deepEqual(await installDeb("/u/f.deb", SUM, spawned({ code: 126 })), { ok: false, why: "the password prompt was dismissed" });
  assert.deepEqual(await installDeb("/u/f.deb", SUM, spawned({ code: 127 })), { ok: false, why: "the system did not allow it" });
  assert.deepEqual(await installDeb("/u/f.deb", SUM, spawned({ code: 4 })), { ok: false, why: "/u/f.deb changed since it was checked against its release: it was not installed" });
  assert.deepEqual(await installDeb("/u/f.deb", SUM, spawned({ code: 3 })), { ok: false, why: "/u/f.deb could not be copied to install it" });
  assert.deepEqual(await installDeb("/u/f.deb", SUM, spawned({ code: 100 })), { ok: false, why: "apt-get exited with code 100" });
  assert.deepEqual(await installDeb("/u/f.deb", SUM, spawned({ error: Object.assign(new Error("x"), { code: "ENOENT" }) })), { ok: false, why: "this system has no pkexec to ask for the password: install it with sudo apt install /u/f.deb" });
  // how the app starts again: an AppImage from its own file, a deb's from its program, with its arguments
  assert.deepEqual(relaunchOf("appimage", { appImage: "/home/a/F.AppImage", execPath: "/tmp/.mount_x/filament-desktop", argv: ["/tmp/.mount_x/filament-desktop", "--hidden"] }), { execPath: "/home/a/F.AppImage", args: ["--hidden"] });
  assert.deepEqual(relaunchOf("deb", { execPath: "/opt/Filament/filament-desktop", argv: ["/opt/Filament/filament-desktop"] }), { execPath: "/opt/Filament/filament-desktop", args: [] });
});

// Where a shell with sha512sum is there (Linux, a Mac with coreutils, Git Bash): the root step run as it is, apt-get a
// stand-in on PATH that says what it was given.
const shell = spawnSync("sh", ["-c", "command -v sha512sum && command -v mktemp"], { encoding: "utf8" });
test("the deb's root step installs a copy of its own, checked against the release's SHA-512, and nothing that changed", { skip: shell.status !== 0 ? "no sh with sha512sum here" : false }, () => {
  const dir = tmp();
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "apt-get"), '#!/bin/sh\necho "apt-get $*"; cat "$3"\n', { mode: 0o755 });
    const deb = join(dir, "Filament-0.9.1-linux-amd64.deb");
    writeFileSync(deb, "the deb");
    const hex = createHash("sha512").update("the deb").digest("hex");
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
    const run = (/** @type {string} */ sum) => spawnSync("sh", ["-c", DEB_INSTALL, "filament-update", deb.replace(/\\/g, "/"), sum], { encoding: "utf8", env });
    const good = run(hex);
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /^apt-get install -y \S+\/update\.deb\nthe deb$/, "apt is given the copy, which holds the deb");
    assert.equal(run(createHash("sha512").update("another").digest("hex")).status, 4, "a file that is not the one checked is not installed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the notes: out says nothing is fetched until asked, a store's opens its store; ready says a Quit installs it, but a deb's", () => {
  assert.deepEqual(updateOutNote("0.9.1", "nsis"), { title: "Filament 0.9.1 is out", text: "Update from Filament's notice or the tray: it downloads, then asks before it installs.", tone: "info" });
  assert.equal(updateOutNote("0.9.1", "mac-store").text, "Update it from the App Store: Filament's notice opens it.");
  assert.equal(updateOutNote("0.9.1", "windows-store").text, "Update it from the Microsoft Store: Filament's notice opens it.");
  assert.equal(updateNote("0.9.1", "mac").text, "Restart to update, from Filament's notice or the tray — or it installs as you quit.");
  assert.equal(updateNote("0.9.1", "deb").text, "Restart to update, from Filament's notice or the tray.");
});

test("main.js: the kind from how the app was installed, the releases' repository from the build, Squirrel readied as the zip is checked, and a Mac's Restart to update ends the app by Squirrel", () => {
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /kindOf\(\{ mas: !!process\.mas, windowsStore: !!process\.windowsStore, appImage: process\.env\.APPIMAGE \|\| "", packageType: resource\("package-type"\) \}\)/);
  assert.match(main, /repo: releasesRepoOf\(resource\("app-update\.yml"\)\) \?\? repoOf\(ownPackage\(\)\),/);
  assert.match(main, /prepare: updateKind === "mac" \? \(u\) => readySquirrel\(\{ autoUpdater, zip: u\.file/);
  assert.match(main, /const squirrel = updateAs \? installUpdate\(updateAs === "restart"\) : false;/);
  // (fails before: yes — the review of 11-07: a Squirrel that failed left an app with no tray, no Filament and no window,
  // and an error of Squirrel's with nothing listening threw in the app)
  assert.match(main, /if \(squirrel\) \{\n\s+autoUpdater\.once\("error", \(\) => app\.quit\(\)\);\n\s+autoUpdater\.quitAndInstall\(\);\n\s+\} else app\.quit\(\);/);
  assert.match(main, /if \(updater && updateKind === "mac"\) autoUpdater\.on\("error", /);
  assert.match(main, /if \(id === "update-get"\) return getUpdate\(\);\n\s+if \(id === "update"\) return restartToUpdate\(\);/);
  // a Linux update is put in place before the app quits, and the app quits only where it was
  assert.match(main, /if \(!r\.ok\) \{[\s\S]*?return;\n\s+\}\n\s+relaunch = relaunchOf\(u\.kind,[\s\S]*?\n\s+\}\n\s+return quit\(\{ update: "restart" \}\);/);
  // (fails before: yes — the same review: a deb was installed over the running app before Filament was asked to stop, so
  // Keep it running ran on replaced files; two presses ran two password prompts and two apts)
  const restart = main.slice(main.indexOf("async function restartNow()"), main.indexOf("return quit({ update: \"restart\" });"));
  assert.ok(restart.indexOf("if (!(await stopAsked())) return;") >= 0 && restart.indexOf("if (!(await stopAsked())) return;") < restart.indexOf("installDeb(u.file, u.sha512)"), "Filament stops, asked, before anything is replaced");
  assert.match(restart, /if \(!r\.ok\) \{\n\s+sup\.start\(\);/, "where it failed, Filament starts again");
  assert.match(main, /const restartToUpdate = \(\) => \(restarting \|\|= restartNow\(\)\.finally\(\(\) => \(restarting = null\)\)\);/);
  assert.match(main, /async function leave\(\) \{\n\s+if \(quitting\) return;\n\s+if \(!\(await stopAsked\(\)\)\) return;/, "a Quit asks the same way");
});
