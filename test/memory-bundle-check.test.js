// @ts-check
// The check `npm run dist:win` makes before it builds an installer and of the app it built (HarnessV3-AtHome AH-D2):
// Filament installs its memory engine from the bundle it carries alone, so no installer goes out without a whole one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appBundleRoot, checkBundle, isMain, main, TARGET, targetOf } from "../scripts/check-memory-bundle.mjs";
import { distDir, distWin, installerFiles } from "../scripts/dist-win.mjs";
import { dist, madeIn, notarizes, platformOfWord, PLATFORMS, signedState, signedWords, STAPLER_PAUSE_MS, STAPLER_TRIES } from "../scripts/dist.mjs";
import { DEFAULT_VERSION, EMBEDDING_MODEL, engineSource } from "../src/adapters/sidecar/install.js";

const HERE = `${process.platform}-${process.arch}`;
const sha256 = (/** @type {Buffer} */ b) => createHash("sha256").update(b).digest("hex");
const FILES = () => ({
  [process.platform === "win32" ? "uv.exe" : "uv"]: "MZ the bundle's uv",
  "python/20250902/cpython-3.12.11-install_only_stripped.tar.gz": "a Python archive",
  "wheels/mnemosyne_memory-3.15.1-py3-none-any.whl": "the mnemosyne wheel",
  "requirements.txt": "mnemosyne-memory==3.15.1 --hash=sha256:00\n",
  "fastembed/models--qdrant--bge-small-en-v1.5-onnx-q/snapshots/abc123/model_optimized.onnx": "the model's weights",
});
/** A whole bundle for this machine under `root`; `edit` changes the manifest. @param {string} root */
function bundleAt(root, { edit = (/** @type {any} */ m) => m } = {}) {
  const dir = join(root, HERE),
    files = FILES();
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const manifest = { format: 1, platform: process.platform, arch: process.arch, builtAt: "2026-10-28T00:00:00.000Z", uv: "0.8.17", python: "3.12.11", mnemosyne: DEFAULT_VERSION, source: engineSource(DEFAULT_VERSION), embeddings: true, model: EMBEDDING_MODEL, files: Object.fromEntries(Object.entries(files).map(([rel, body]) => [rel, sha256(Buffer.from(body))])) };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(edit(manifest)));
  return dir;
}
const tmp = () => mkdtempSync(join(tmpdir(), "filament-bundlecheck-"));

// (fails before: yes — there was no check: dist:win built an installer with whatever vendor/ held, or nothing)
test("a whole bundle for this release passes; none, another version's, a damaged one or another machine is refused, saying why", async () => {
  const root = tmp();
  try {
    const none = await checkBundle({ root, machine: HERE, target: HERE });
    assert.deepEqual(none, { ok: false, why: `this Filament has no memory engine bundle for ${HERE} in ${root}: reinstall Filament, or in a checkout build it with npm run engine:bundle` });
    const dir = bundleAt(root);
    /** @type {string[]} */
    const said = [];
    const whole = await checkBundle({ root, machine: HERE, target: HERE, say: (l) => said.push(l) });
    assert.equal(whole.ok, true);
    assert.deepEqual(said, [`checking the 5 files of the memory engine bundle at ${dir}`]);
    writeFileSync(join(dir, "requirements.txt"), "changed");
    assert.deepEqual(await checkBundle({ root, machine: HERE, target: HERE }), { ok: false, why: `the memory engine bundle at ${dir} is damaged: requirements.txt differs from its manifest; build it again with npm run engine:bundle` });
    assert.deepEqual(await checkBundle({ root, machine: HERE, target: HERE, inApp: true }), { ok: false, why: "the memory engine bundle inside the app is not whole: requirements.txt differs from its manifest; the packager left it out or changed it (see electron-builder.yml's files)" });
    bundleAt(root, { edit: (m) => ({ ...m, mnemosyne: "3.14.0" }) });
    assert.match(/** @type {any} */ (await checkBundle({ root, machine: HERE, target: HERE })).why, /holds mnemosyne 3\.14\.0, and this Filament runs 3\.15\.1: build it again with npm run engine:bundle$/);
    // (fails before: yes — a bundle built before the model moved passed, and its installer shipped the model it had)
    bundleAt(root, { edit: (m) => ({ ...m, model: "BAAI/bge-small-en-v1.5" }) });
    assert.deepEqual(await checkBundle({ root, machine: HERE, target: HERE }), { ok: false, why: `the memory engine bundle at ${dir} carries the embedding model BAAI/bge-small-en-v1.5, and this Filament's memory searches by ${EMBEDDING_MODEL}: build it again with npm run engine:bundle` });
    bundleAt(root, { edit: (m) => ({ ...m, embeddings: false, model: "" }) });
    assert.equal((await checkBundle({ root, machine: HERE, target: HERE })).ok, true, "a bundle with embeddings off carries no model");
    assert.deepEqual(await checkBundle({ root, machine: "darwin-arm64", target: "win32-x64" }), { ok: false, why: "the installer is for win32-x64 and is built on win32-x64, where its memory engine bundle is built; this machine is darwin-arm64" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the command: before the build, the bundle the packager packs, whatever FILAMENT_MEMORY_BUNDLE says; with --app, the copy inside the app; its exit code says which way", { skip: HERE !== TARGET ? `the installer is built on ${TARGET}` : false }, async () => {
  const app = tmp();
  /** @type {string[]} */
  const out = [];
  const io = { log: (/** @type {string} */ l) => out.push(l), error: (/** @type {string} */ l) => out.push(`! ${l}`) };
  try {
    const vendor = join(app, "vendor-bundles");
    // (fails before: yes — the packaging Hunter's find: the check followed FILAMENT_MEMORY_BUNDLE, the packager does not)
    bundleAt(join(app, "elsewhere"));
    assert.equal(await main([], { ...io, vendor, env: { FILAMENT_MEMORY_BUNDLE: join(app, "elsewhere") } }), 1, "a whole bundle elsewhere is not the one packed");
    assert.equal(out.at(-1), `! No installer without the memory engine: this Filament has no memory engine bundle for win32-x64 in ${vendor}: reinstall Filament, or in a checkout build it with npm run engine:bundle (FILAMENT_MEMORY_BUNDLE names ${join(app, "elsewhere")}, where npm run engine:bundle builds; the installer carries ${vendor} alone: build without it set).`);
    bundleAt(vendor);
    assert.equal(await main([], { ...io, vendor, env: {} }), 0);
    assert.equal(await main(["--app"], io), 2, "--app names the app's folder");
    assert.equal(await main(["--app", app], io), 1, "an app with no bundle inside");
    bundleAt(appBundleRoot(app));
    assert.equal(await main(["--app", app], io), 0);
    assert.equal(out.at(-1), `The memory engine bundle is whole: mnemosyne ${DEFAULT_VERSION} on Python 3.12.11, built 2026-10-28T00:00:00.000Z, 5 files inside ${app}.`);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

// (fails before: yes — the packaging Hunter's find: a failed after-check left the installer it condemned in dist, and
// flags after `npm run dist:win --` went to the check, not electron-builder)
test("dist:win: no build without the bundle; electron-builder with the flags given; an installer whose app fails the after-check is removed", async () => {
  const root = tmp();
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
    const out = join(root, "dist", "windows", "9.9.9");
    const [exe, map] = installerFiles(out, "9.9.9");
    /** @type {any[]} */
    const said = [], built = [], removed = [], checked = [];
    const io = { log: (/** @type {string} */ l) => said.push(l), error: (/** @type {string} */ l) => said.push(`! ${l}`), remove: (/** @type {string} */ f) => (removed.push(f), rmSync(f)) };
    const whole = { ok: true, bundle: { manifest: { mnemosyne: "3.15.1", python: "3.12.11", builtAt: "b", files: { a: "x" } } } };
    /** @param {any[]} answers */
    const checks = (...answers) => async (/** @type {any} */ o) => (checked.push([o.root, !!o.inApp]), answers.shift());
    const build = (/** @type {string[]} */ args, /** @type {string} */ _root, /** @type {string} */ to) => (built.push(args), assert.equal(to, out), mkdirSync(to, { recursive: true }), writeFileSync(exe, "MZ"), writeFileSync(map, "m"), 0);
    // no bundle: nothing is built
    assert.equal(await distWin({ ...io, root, vendor: join(root, "v"), check: checks({ ok: false, why: "none here" }), build, env: {} }), 1);
    assert.deepEqual([built, said.at(-1)], [[], "! No installer without the memory engine: none here."]);
    // whole, and whole in the app: built with the flags given, the installer kept
    assert.equal(await distWin({ ...io, args: ["--dir"], root, vendor: join(root, "v"), check: checks(whole, whole), build, env: {} }), 0);
    assert.deepEqual(built, [["--dir"]]);
    assert.deepEqual(checked.slice(-2), [[join(root, "v"), false], [appBundleRoot(join(out, "win-unpacked")), true]]);
    assert.ok(existsSync(exe));
    // whole, but not in the app: the installer and its blockmap go, and it says why
    assert.equal(await distWin({ ...io, root, vendor: join(root, "v"), check: checks(whole, { ok: false, why: "uv.exe is missing" }), build, env: {} }), 1);
    assert.deepEqual(removed, [exe, map]);
    assert.ok(!existsSync(exe) && !existsSync(map));
    assert.equal(said.at(-1), `! The app at ${join(out, "win-unpacked")} can't be handed on: uv.exe is missing.`);
    // electron-builder that fails: its code, nothing checked after
    const n = checked.length;
    assert.equal(await distWin({ ...io, root, vendor: join(root, "v"), check: checks(whole), build: () => 7, env: {} }), 7);
    assert.equal(checked.length, n + 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// (fails before: yes — every build went to dist\ itself, one over the other, whatever its version; the owner's of 10-28)
test("dist:win builds into dist\\windows\\<version>\\: a version built again replaces its folder, the others stay; package.json's version must be one", async () => {
  const root = tmp();
  try {
    const at = (/** @type {string} */ v) => join(root, "dist", "windows", v);
    mkdirSync(at("0.1.0"), { recursive: true });
    writeFileSync(join(at("0.1.0"), "Filament-0.1.0-setup-x64.exe"), "the 0.1.0 build");
    mkdirSync(join(at("0.2.0-alpha.1"), "win-unpacked"), { recursive: true });
    writeFileSync(join(at("0.2.0-alpha.1"), "stale.txt"), "left by the last build of this version");
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.2.0-alpha.1" }));
    /** @type {any} */
    const whole = { ok: true, bundle: { manifest: { mnemosyne: "3.15.1", python: "3.12.16", builtAt: "b", files: { a: "x" } } } };
    /** @type {string[]} */
    const said = [];
    /** @type {any} */
    let seen = null;
    const build = (/** @type {string[]} */ _args, /** @type {string} */ _root, /** @type {string} */ to) => {
      seen = { to, stale: existsSync(join(to, "stale.txt")) };
      mkdirSync(join(to, "win-unpacked"), { recursive: true });
      writeFileSync(join(to, "Filament-0.2.0-alpha.1-setup-x64.exe"), "MZ");
      return 0;
    };
    const code = await distWin({ root, vendor: join(root, "v"), check: async () => whole, build, env: {}, log: (l) => said.push(l), error: (l) => said.push(`! ${l}`), facts: () => ({ version: "0.2.0-alpha.1", commit: "", subject: "", dirty: false, builtAt: new Date().toISOString() }) });
    assert.equal(code, 0);
    assert.deepEqual(seen, { to: at("0.2.0-alpha.1"), stale: false }, "into its version's folder, the last build of it gone first");
    assert.ok(said.includes(`Replacing the build of 0.2.0-alpha.1 at ${at("0.2.0-alpha.1")}.`));
    assert.equal(said.at(-1), `Filament 0.2.0-alpha.1's installer: ${join(at("0.2.0-alpha.1"), "Filament-0.2.0-alpha.1-setup-x64.exe")} — run it to install, or to upgrade the Filament installed.`);
    assert.equal(readFileSync(join(at("0.1.0"), "Filament-0.1.0-setup-x64.exe"), "utf8"), "the 0.1.0 build", "another version's build is left alone");
    assert.equal(distDir(root, "mac", "0.2.0"), join(root, "dist", "mac", "0.2.0"));
    // a version that is no version builds nothing and removes nothing
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "../0.1.0" }));
    assert.equal(await distWin({ root, vendor: join(root, "v"), check: async () => whole, build: () => assert.fail("built"), env: {}, log: () => {}, error: (l) => said.push(`! ${l}`) }), 1);
    assert.match(said.at(-1) || "", /^! package\.json's version is no version to build: "\.\.\/0\.1\.0"/);
    assert.ok(existsSync(join(at("0.1.0"), "Filament-0.1.0-setup-x64.exe")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.match(readFileSync(new URL("../scripts/dist.mjs", import.meta.url), "utf8"), /\.\.\.p\.flags, `--config\.directories\.output=\$\{out\}`, \.\.\.args\]/, "electron-builder is told the folder");
  assert.deepEqual(PLATFORMS.win32.flags, ["--win", "--x64"]);
});

// (fails before: yes — the owner's of 11-07: dist:win built Windows alone, and the check refused any other machine)
test("dist on macOS and Linux: each system's own folder, flags and engine; a build for another system is refused in words, naming this one's", async () => {
  const root = tmp();
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
    /** @type {any} */
    const whole = { ok: true, bundle: { manifest: { mnemosyne: "3.15.1", python: "3.12.16", builtAt: "b", files: { a: "x" } } } };
    /** @type {string[]} */
    const said = [];
    /** @type {any[]} */
    const checked = [];
    /** @type {string[]} */
    const helped = [];
    const io = {
      root, vendor: join(root, "v"), env: {}, log: (/** @type {string} */ l) => said.push(l), error: (/** @type {string} */ l) => said.push(`! ${l}`), facts: () => ({ version: "1.0.0", commit: "", subject: "", dirty: false, builtAt: new Date().toISOString() }),
      ptyHelpers: (/** @type {string} */ at, /** @type {string} */ system) => (helped.push(`${system} ${at === root} after ${flags.length} builds`), helped.length === 1 ? ["/pty/spawn-helper"] : []),
    };
    const check = async (/** @type {any} */ o) => (checked.push([o.root, o.target, !!o.inApp]), whole);
    // a Mac's: the disk image and the zip, the bundle inside Filament.app, and whether it is signed
    const mac = distDir(root, "mac", "1.0.0");
    /** @type {any[]} */
    const flags = [];
    const macBuild = (/** @type {string[]} */ _a, /** @type {string} */ _r, /** @type {string} */ to, /** @type {any} */ p) => {
      flags.push(p.flags);
      mkdirSync(join(to, "mac-arm64", "Filament.app"), { recursive: true });
      for (const f of ["Filament-1.0.0-mac-arm64.dmg", "Filament-1.0.0-mac-arm64.zip", "latest-mac.yml", "builder-debug.yml"]) writeFileSync(join(to, f), "x");
      return 0;
    };
    /** @type {string[]} */
    const asked = [];
    const unsignedApp = (/** @type {string} */ app) => (asked.push(app), { who: "", stapled: false });
    assert.equal(await dist({ ...io, platform: "darwin", machine: "darwin", check, build: macBuild, signedAs: unsignedApp }), 0);
    assert.deepEqual(asked, [join(mac, "mac-arm64", "Filament.app")], "its signature asked once");
    // (fails before: yes — the owner's Mac of 11-08: node-pty's helper packed as npm left it, not runnable, and no
    // terminal of the app's started)
    assert.deepEqual(helped, ["darwin true after 0 builds"], "node-pty's helper made runnable before electron-builder packs it");
    assert.ok(said.includes("node-pty's helper made runnable: /pty/spawn-helper"));
    assert.deepEqual(flags, [["--mac", "--arm64"]]);
    assert.deepEqual(checked, [[join(root, "v"), "darwin-arm64", false], [appBundleRoot(join(mac, "mac-arm64"), "darwin"), "darwin-arm64", true]]);
    assert.equal(appBundleRoot("/m", "darwin"), join("/m", "Filament.app", "Contents", "Resources", "app", "vendor", "memory-engine"));
    assert.deepEqual(madeIn(mac, "1.0.0", PLATFORMS.darwin), ["Filament-1.0.0-mac-arm64.dmg", "Filament-1.0.0-mac-arm64.zip", "latest-mac.yml"].map((f) => join(mac, f)), "electron-builder's own files are not handed on");
    assert.deepEqual(said.slice(-3), [
      `To offer it as an update: the release CI drafts on a tag v1.0.0 (docs/releasing.md), or one made by hand with Filament-1.0.0-mac-arm64.dmg, Filament-1.0.0-mac-arm64.zip, latest-mac.yml attached.`,
      `Filament 1.0.0 for macOS: ${join(mac, "Filament-1.0.0-mac-arm64.dmg")} — open it and drag Filament to Applications.`,
      "It is not signed with a Developer ID: it opens on this Mac alone (docs/releasing.md says how to sign it).",
    ]);
    // One that can't be made runnable builds nothing, saying why (the review of the change).
    const denied = Object.assign(new Error("denied"), { code: "EPERM" });
    assert.equal(await dist({ ...io, platform: "darwin", machine: "darwin", check, build: () => assert.fail("built"), ptyHelpers: () => { throw denied; } }), 1);
    assert.match(said.at(-1) || "", /^! node-pty's helper can't be made runnable \(EPERM\): the app's terminals would not start\./);
    // Linux's: the AppImage and the deb, the bundle in resources/app
    const linux = distDir(root, "linux", "1.0.0");
    const linuxBuild = (/** @type {string[]} */ _a, /** @type {string} */ _r, /** @type {string} */ to) => {
      mkdirSync(join(to, "linux-unpacked"), { recursive: true });
      for (const f of ["Filament-1.0.0-linux-x86_64.AppImage", "Filament-1.0.0-linux-amd64.deb", "latest-linux.yml"]) writeFileSync(join(to, f), "x");
      return 0;
    };
    checked.length = 0;
    assert.equal(await dist({ ...io, platform: "linux", machine: "linux", check, build: linuxBuild }), 0);
    assert.deepEqual(checked.at(-1), [join(linux, "linux-unpacked", "resources", "app", "vendor", "memory-engine"), "linux-x64", true]);
    assert.deepEqual(said.slice(-2), [`Filament 1.0.0's AppImage: ${join(linux, "Filament-1.0.0-linux-x86_64.AppImage")} — chmod +x it, then run it.`, `Filament 1.0.0's deb, for Debian and Ubuntu: ${join(linux, "Filament-1.0.0-linux-amd64.deb")} — sudo apt install ./Filament-1.0.0-linux-amd64.deb`]);
    // another system's build: refused before anything is checked or built, this machine's command named
    const n = checked.length;
    assert.equal(await dist({ ...io, platform: "darwin", machine: "win32", check, build: () => assert.fail("built") }), 1);
    assert.equal(said.at(-1), "! Filament's macOS app is built on macOS: its memory engine bundle is built on the machine it is for, and a Mac app is signed on a Mac. This machine is win32: npm run dist:win builds its own; GitHub Actions builds all three (docs/releasing.md).");
    // a notarized Mac build with a bundle built unsigned: refused before electron-builder runs, saying why
    const unsignedBundle = /** @type {any} */ (async () => ({ ok: true, bundle: { manifest: { ...whole.bundle.manifest, signed: null } } }));
    assert.equal(await dist({ ...io, env: { APPLE_API_KEY: "/k.p8" }, platform: "darwin", machine: "darwin", check: unsignedBundle, build: () => assert.fail("built") }), 1);
    assert.match(said.at(-1) || "", /^! No notarized build with an unsigned memory engine bundle: /);
    assert.match(said.at(-2) || "", /, unsigned\.$/, "the bundle's own line says it");
    assert.deepEqual([notarizes({}), notarizes({ APPLE_API_KEY: "k" }), notarizes({ APPLE_KEYCHAIN_PROFILE: "p" }), notarizes({ APPLE_ID: "a" })], [false, true, true, true]);
    // (fails before: yes — the review of 11-07: with no Developer ID in the keychain electron-builder only warns, and
    // notarizes nothing, so a build to be notarized passed unsigned and a tag's run drafted it as a release)
    // (fails before: yes — 11-08: a bundle signed by a build from before then left the programs inside its wheels and
    // Python archive as they came, and Apple refused 67 of them ten minutes in)
    const signedOutside = /** @type {any} */ (async () => ({ ok: true, bundle: { manifest: { ...whole.bundle.manifest, signed: "Developer ID Application: Ada (X)" } } }));
    assert.equal(await dist({ ...io, env: { APPLE_KEYCHAIN_PROFILE: "filament-notary" }, platform: "darwin", machine: "darwin", check: signedOutside, build: () => assert.fail("built") }), 1);
    assert.equal(said.at(-1), "! No notarized build with this memory engine bundle: it was built before the programs inside its wheels and Python archive were signed, and notarization refuses those. Build it again with npm run engine:bundle (docs/releasing.md).");
    assert.equal(await dist({ ...io, platform: "darwin", machine: "darwin", check: signedOutside, build: macBuild, signedAs: unsignedApp }), 0, "a build not to be notarized takes it");
    const signedBundle = /** @type {any} */ (async () => ({ ok: true, bundle: { manifest: { ...whole.bundle.manifest, signed: "Developer ID Application: Ada (X)", signedInside: true } } }));
    /** @type {string[]} */
    const gone = [];
    const notarized = { ...io, env: { APPLE_API_KEY: "/k.p8" }, platform: "darwin", machine: "darwin", check: signedBundle, build: macBuild, remove: (/** @type {string} */ f) => gone.push(f) };
    assert.equal(await dist({ ...notarized, signedAs: () => ({ who: "", stapled: false }) }), 1);
    assert.match(said.at(-1) || "", /^! The app was to be notarized, but electron-builder found no Developer ID Application certificate in the keychain/);
    assert.deepEqual(gone, madeIn(mac, "1.0.0", PLATFORMS.darwin), "nothing it made is left to hand on");
    gone.length = 0;
    // (fails before: yes — the run of 11-08, 42432141670: Apple notarized the app and electron-builder stapled it, stapler
    // validate then said no three times, and the build removed a notarized app's disk image and zip) Signed, a build to be
    // notarized was, or electron-builder ended non-zero: stapler's no is said, in its words, and nothing is removed.
    assert.equal(await dist({ ...notarized, signedAs: () => ({ who: "Developer ID Application: Ada (X)", stapled: false, said: "Filament.app does not have a ticket stapled to it." }) }), 0);
    assert.deepEqual(gone, [], "nothing it made is removed");
    assert.equal(
      said.at(-1),
      `Signed by Developer ID Application: Ada (X) and notarized (electron-builder sent it to Apple and stapled the ticket), but stapler validate didn't confirm the ticket here. Check it on a Mac before handing it on: xcrun stapler validate Filament.app, or spctl -a -vv Filament.app (source=Notarized Developer ID). stapler said: "Filament.app does not have a ticket stapled to it."`,
    );
    // (fails before: yes — the run of 11-08: stapler, asked again for the last line, said no of the app it had passed,
    // and the line said a notarized app was not)
    asked.length = 0;
    const staples = [true, false];
    const stapledOnce = (/** @type {string} */ app) => (asked.push(app), { who: "Developer ID Application: Ada (X)", stapled: staples.shift() ?? false });
    assert.equal(await dist({ ...notarized, signedAs: stapledOnce }), 0, "signed and stapled: it passes");
    assert.equal(asked.length, 1, "asked once");
    assert.equal(said.at(-1), "Signed by Developer ID Application: Ada (X), and notarized: it opens on any Mac.");
    assert.equal(await dist({ ...io, platform: "freebsd", machine: "freebsd", check, build: () => assert.fail("built") }), 1);
    assert.equal(said.at(-1), "! Filament is built for Windows, macOS and Linux; this machine is freebsd.");
    assert.equal(checked.length, n);
    assert.deepEqual([platformOfWord("mac"), platformOfWord("win"), platformOfWord("linux"), platformOfWord("--dir")], ["darwin", "win32", "linux", null]);
    // the bundle check: each system's machine, and none for a system Filament is not built for
    assert.deepEqual([targetOf("win32"), targetOf("darwin"), targetOf("linux"), targetOf("freebsd")], ["win32-x64", "darwin-arm64", "linux-x64", ""]);
    assert.deepEqual(await checkBundle({ root, machine: "darwin-x64", target: "darwin-arm64" }), { ok: false, why: "the installer is for darwin-arm64 and is built on darwin-arm64, where its memory engine bundle is built; this machine is darwin-x64" });
    assert.deepEqual(await checkBundle({ root, machine: "freebsd-x64", target: "" }), { ok: false, why: "Filament's installers are for win32-x64, darwin-arm64, linux-x64, each built on that machine; this machine is freebsd-x64" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual([pkg.scripts.dist, pkg.scripts["dist:mac"], pkg.scripts["dist:linux"]], ["node scripts/dist.mjs", "node scripts/dist.mjs mac", "node scripts/dist.mjs linux"]);
});

// (fails before: yes — a Mac build said nothing of its signature, and one that opens on no other Mac looked handed on)
test("a Mac build says whether it is signed with a Developer ID and notarized, from codesign and stapler", () => {
  const run = (/** @type {string} */ sig, /** @type {number} */ staple) => (/** @type {string} */ file) =>
    file === "codesign" ? { status: 0, stdout: "", stderr: sig } : { status: staple, stdout: "", stderr: "" };
  const id = "Executable=/x\nAuthority=Developer ID Application: Ada Lovelace (ABCDE12345)\nAuthority=Developer ID Certification Authority\n";
  assert.equal(signedWords("/A.app", { run: run(id, 0) }), "Signed by Developer ID Application: Ada Lovelace (ABCDE12345), and notarized: it opens on any Mac.");
  assert.match(signedWords("/A.app", { run: run(id, 65) }), /^Signed by Developer ID Application: Ada Lovelace \(ABCDE12345\), not notarized: macOS refuses it on another Mac until it is/);
  assert.match(signedWords("/A.app", { run: run("Signature=adhoc\n", 1) }), /^It is not signed with a Developer ID: it opens on this Mac alone/);
  assert.deepEqual(signedState("/A.app", { run: run(id, 0) }), { who: "Developer ID Application: Ada Lovelace (ABCDE12345)", stapled: true, said: "" });
  assert.deepEqual(signedState("/A.app", { run: run("Signature=adhoc\n", 0) }), { who: "", stapled: false, said: "" }, "a ticket on an app no Developer ID signed counts for nothing");
  // (fails before: yes — stapler said no once of a stapled app on the runner of 11-08) A no is asked again; a yes ends it.
  /** @type {number[]} */
  const answers = [65, 0];
  let asks = 0;
  /** @type {number[]} */
  const paused = [];
  const pause = (/** @type {number} */ ms) => void paused.push(ms);
  const stapler = (/** @type {number | undefined} */ status) => (asks++, { status: status ?? 65, stdout: "", stderr: "Processing: /A.app\nA.app does not have a ticket stapled to it.\n" });
  const flaky = (/** @type {string} */ file) => (file === "codesign" ? { status: 0, stdout: "", stderr: id } : stapler(answers.shift()));
  assert.equal(signedState("/A.app", { run: flaky, pause }).stapled, true);
  assert.equal(asks, 2);
  // (fails before: yes — the run of 11-08, 42432141670: three asks back to back all said no, and none of its words was
  // kept) The asks are spaced, and the last no's words are kept.
  assert.deepEqual(paused, [STAPLER_PAUSE_MS], "a pause before an ask again");
  asks = 0;
  paused.length = 0;
  const unstapled = signedState("/A.app", { run: (/** @type {string} */ file) => (file === "codesign" ? { status: 0, stdout: "", stderr: id } : stapler(65)), pause });
  assert.deepEqual([unstapled.stapled, unstapled.said], [false, "Processing: /A.app A.app does not have a ticket stapled to it."]);
  assert.equal(asks, STAPLER_TRIES, "an app with no ticket is asked no more than that");
  assert.equal(paused.length, STAPLER_TRIES - 1, "none after the last");
  assert.ok(STAPLER_PAUSE_MS >= 5_000, "seconds apart");
});

// (fails before: yes — the dist-layout Hunter's finds of 10-29: a build of the version with a file still open (its
// Filament.exe running) made the replace throw a stack, as did an installer that couldn't be removed; `-- --dir` ended
// naming an installer it never built)
test("dist:win: a build it can't replace, or an installer it can't remove, is said in words; with --dir it names the app, not an installer", async () => {
  const root = tmp();
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.3.0" }));
    const out = distDir(root, "windows", "0.3.0");
    const [exe] = installerFiles(out, "0.3.0");
    mkdirSync(join(out, "win-unpacked"), { recursive: true });
    /** @type {any} */
    const whole = { ok: true, bundle: { manifest: { mnemosyne: "3.15.1", python: "3.12.16", builtAt: "b", files: { a: "x" } } } };
    /** @type {string[]} */
    const said = [];
    const io = { root, vendor: join(root, "v"), env: {}, log: (/** @type {string} */ l) => said.push(l), error: (/** @type {string} */ l) => said.push(`! ${l}`), facts: () => ({ version: "0.3.0", commit: "", subject: "", dirty: false, builtAt: new Date().toISOString() }) };
    const busy = () => {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    };
    let built = 0;
    // the last build of it held open: nothing built, and why
    assert.equal(await distWin({ ...io, check: async () => whole, build: () => (built++, 0), clear: busy }), 1);
    assert.equal(built, 0);
    assert.equal(said.at(-1), `! The build of 0.3.0 at ${out} can't be replaced (EBUSY): a program has a file of it open — its Filament.exe running, or a window on the folder. Close it and build again.`);
    // --dir: the app alone, and said so
    const appOnly = (/** @type {string[]} */ _a, /** @type {string} */ _r, /** @type {string} */ to) => (mkdirSync(join(to, "win-unpacked"), { recursive: true }), 0);
    assert.equal(await distWin({ ...io, args: ["--dir"], check: async () => whole, build: appOnly }), 0);
    assert.equal(said.at(-1), `Filament 0.3.0, unpacked, no installer built: ${join(out, "win-unpacked", "Filament.exe")}`);
    // an installer whose app fails the after-check and that can't be removed: said, never left as one to hand on
    const withExe = (/** @type {string[]} */ _a, /** @type {string} */ _r, /** @type {string} */ to) => (mkdirSync(join(to, "win-unpacked"), { recursive: true }), writeFileSync(exe, "MZ"), 0);
    let n = 0;
    const firstWhole = async () => (n++ === 0 ? whole : { ok: false, why: "uv.exe is missing" });
    assert.equal(await distWin({ ...io, check: firstWhole, build: withExe, remove: busy }), 1);
    assert.ok(said.includes(`! Couldn't remove ${exe} (EBUSY): it would install a Filament without its memory engine — don't hand it on.`), said.join("\n"));
    assert.equal(said.at(-1), `! The app at ${join(out, "win-unpacked")} can't be handed on: uv.exe is missing.`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// (fails before: yes — the packaging Hunter's find: the guard compared argv's path, as typed, with the real one Node
// loads the module by, so through a junction the script did nothing and exited 0)
test("a script run through a junction or a link is still the one Node runs", { skip: process.platform !== "win32" ? "junctions are Windows'" : false }, () => {
  const at = tmp();
  try {
    const real = fileURLToPath(new URL("../scripts/", import.meta.url));
    symlinkSync(real, join(at, "linked"), "junction");
    const typed = join(at, "linked", "check-memory-bundle.mjs");
    const url = new URL("../scripts/check-memory-bundle.mjs", import.meta.url).href;
    assert.notEqual(pathToFileURL(typed).href, url, "the path typed is not the module's");
    assert.equal(isMain(url, typed), true);
    assert.equal(isMain(url, join(real, "dist-win.mjs")), false);
    assert.equal(isMain(url, undefined), false);
  } finally {
    // The junction itself first, never followed: what it points at is this checkout's scripts.
    const link = join(at, "linked");
    try {
      unlinkSync(link);
    } catch {
      try {
        rmdirSync(link);
      } catch {}
    }
    if (!existsSync(link)) rmSync(at, { recursive: true, force: true });
  }
});

test("dist:win is the script; the installer's files carry the vendor bundle; engine:bundle builds it; the scripts run by their real paths (source contract)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["dist:win"], "node scripts/dist-win.mjs");
  assert.equal(pkg.scripts["engine:bundle"], "node scripts/build-memory-bundle.mjs");
  const yml = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  // each system packs its own bundle alone: its files add to the shared ones
  for (const [system, target] of [["win", "win32-x64"], ["mac", "darwin-arm64"], ["linux", "linux-x64"]])
    assert.match(yml, new RegExp(`^${system}:\\n(?: {2}.*\\n|\\s*\\n)*? {2}files:\\n {4}- vendor/memory-engine/${target}/\\*\\*$`, "m"), system);
  assert.doesNotMatch(yml, /^ {2}- vendor\/memory-engine/m, "no bundle among the shared files");
  assert.equal(appBundleRoot("C:\\app", "win32"), join("C:\\app", "resources", "app", "vendor", "memory-engine"));
  for (const s of ["check-memory-bundle.mjs", "dist-win.mjs", "dist.mjs", "build-memory-bundle.mjs"])
    assert.match(readFileSync(new URL(`../scripts/${s}`, import.meta.url), "utf8"), /^if \(isMain\(import\.meta\.url\)\)/m, s);
});
