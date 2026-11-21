#!/usr/bin/env node
// @ts-check
// `npm run dist [-- <electron-builder's flags>]`: the desktop app and what people install it from, built for this
// machine's system (the owner's of 11-07: Windows, macOS and Linux, each built on its own), only with the memory engine
// it carries (HarnessV3-AtHome AH-D2), in dist/<windows|mac|linux>/<version>/ — the version package.json says (the
// owner's of 10-28: a build of a version that is there already replaces it, another version gets a folder of its own).
// `npm run dist:win`, `dist:mac` and `dist:linux` name the system, and are refused in words on another one: a Mac app is
// signed only on a Mac, and every system's memory engine bundle is built on the machine it is for.
//
// The bundle electron-builder packs (vendor/memory-engine/<platform>-<arch>) is checked whole first, and nothing is
// built without it; electron-builder runs with the flags given, the build's facts in desktop/build-info.json for it to
// pack (desktop/lib/build-info.js; `official: true` where FILAMENT_OFFICIAL_BUILD=1 is set, as the release CI sets it)
// and that file gone after; then the copy inside the app is checked, and the files
// made from an app that fails that are removed — nothing without its engine is left in dist/. On a Mac it says last
// whether the app is signed and notarized: an app that is neither opens only on the Mac that built it.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appBundleRoot, checkBundle, elsewhere, isMain, targetOf, VENDOR_BUNDLES, wholeWords } from "./check-memory-bundle.mjs";
import { buildFacts, withBuildFile } from "../desktop/lib/build-info.js";
import { ptyHelpersRunnable } from "./pty-helper.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * What each system's build is: the word `npm run dist:<word>` names it by, its folder under dist/, electron-builder's
 * flags, the folder the app is unpacked in, the app in it, and the update file electron-builder writes beside the
 * builds (desktop/lib/updates.js reads it from the release).
 * @typedef {{ word: string, folder: "windows" | "mac" | "linux", name: string, flags: string[], unpacked: string, app: string, feed: string }} Platform
 * @type {Record<string, Platform>}
 */
export const PLATFORMS = {
  win32: { word: "win", folder: "windows", name: "Windows", flags: ["--win", "--x64"], unpacked: "win-unpacked", app: "Filament.exe", feed: "latest.yml" },
  darwin: { word: "mac", folder: "mac", name: "macOS", flags: ["--mac", "--arm64"], unpacked: "mac-arm64", app: "Filament.app", feed: "latest-mac.yml" },
  linux: { word: "linux", folder: "linux", name: "Linux", flags: ["--linux", "--x64"], unpacked: "linux-unpacked", app: "filament-desktop", feed: "latest-linux.yml" },
};

/** The system a word names (win, mac, linux), or null. @param {string | undefined} word */
export const platformOfWord = (word) => Object.keys(PLATFORMS).find((p) => PLATFORMS[p].word === word) || null;

/** Where one system's build of one version goes: dist/<windows|mac|linux>/<version>. @param {string} root @param {"windows" | "mac" | "linux"} folder @param {string} version */
export const distDir = (root, folder, version) => join(root, "dist", folder, version);

/** package.json's version: the one place it is set. @param {string} root */
export const versionOf = (root) => String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version || "");

/**
 * What a build made in `out` for people to install, with their blockmaps, and the update file the installed apps
 * check a download by: the files of this version by electron-builder.yml's artifactName (Filament-<version>-…), and
 * the platform's latest*.yml. @param {string} out @param {string} version @param {Platform} p
 */
export const madeIn = (out, version, p) => (existsSync(out) ? readdirSync(out).filter((n) => n.startsWith(`Filament-${version}-`) || n === p.feed).sort().map((n) => join(out, n)) : []);

/** Whether a Mac build is to be notarized: electron-builder notarizes where one of these is set (electron-builder.yml). @param {Record<string, string | undefined>} env */
export const notarizes = (env) => !!(env.APPLE_API_KEY || env.APPLE_KEYCHAIN_PROFILE || env.APPLE_ID);

/** Whether electron-builder's flags say what to publish. @param {string[]} args */
export const namesPublish = (args) => args.some((a) => /^(--publish|-p)(=|$)/.test(a));

/**
 * electron-builder for the system into `out`, with the flags given — and --publish never unless they say otherwise:
 * electron-builder.yml names GitHub for the app's updates, and nothing goes there from a build. Its exit code.
 * @param {string[]} args @param {string} root @param {string} out @param {Platform} p
 */
function electronBuilder(args, root, out, p) {
  if (!namesPublish(args)) args = [...args, "--publish", "never"];
  const r = spawnSync(process.execPath, [join(root, "node_modules", "electron-builder", "cli.js"), ...p.flags, `--config.directories.output=${out}`, ...args], { cwd: root, stdio: "inherit" });
  return r.status ?? 1;
}

/**
 * Whether the Mac app is signed with a Developer ID, and notarized, in a line — or why it is not, so a build that would
 * not open on another Mac says so where it is built. Elsewhere none.
 * @param {string} app  the .app @param {{ run?: (file: string, args: string[]) => { status: number | null, stdout: string, stderr: string } }} [o]
 */
export function signedWords(app, { run = (file, args) => spawnSync(file, args, { encoding: "utf8" }) } = {}) {
  return wordsOfSigned(signedState(app, { run }));
}

/**
 * What `signedWords` says of a state `signedState` found; `sent`: electron-builder notarized the app, as a build with
 * Apple's sign-in in its environment does or ends non-zero (`notarizes`).
 * @param {{ who: string, stapled: boolean, said?: string }} s @param {boolean} [sent]
 */
export function wordsOfSigned({ who, stapled, said = "" }, sent = false) {
  if (!who) return "It is not signed with a Developer ID: it opens on this Mac alone (docs/releasing.md says how to sign it).";
  if (stapled) return `Signed by ${who}, and notarized: it opens on any Mac.`;
  if (sent) return `Signed by ${who} and notarized (electron-builder sent it to Apple and stapled the ticket), but stapler validate didn't confirm the ticket here. Check it on a Mac before handing it on: xcrun stapler validate Filament.app, or spctl -a -vv Filament.app (source=Notarized Developer ID).${said ? ` stapler said: "${said}"` : ""}`;
  return `Signed by ${who}, not notarized: macOS refuses it on another Mac until it is (set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER; docs/releasing.md).`;
}

/**
 * How many times stapler is asked before an app counts as not stapled, and how long apart: on the runners of 11-08 it
 * said no of a stapled app, once seconds after it said yes, and three times back to back.
 */
export const STAPLER_TRIES = 3;
export const STAPLER_PAUSE_MS = 10_000;

/** The process held still a while: `signedState` asks its programs one after another, synchronously. @param {number} ms */
const sleep = (ms) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Who signed the Mac app with a Developer ID ("" for none), whether its notarization ticket is stapled to it, and what
 * stapler said the last time it said no ("" for a yes).
 * @param {string} app @param {{ run?: (file: string, args: string[]) => { status: number | null, stdout: string, stderr: string }, pause?: (ms: number) => void }} [o]
 */
export function signedState(app, { run = (file, args) => spawnSync(file, args, { encoding: "utf8" }), pause = sleep } = {}) {
  const sig = run("codesign", ["-dv", "--verbose=2", app]);
  const who = /^Authority=(Developer ID Application: .+)$/m.exec(`${sig.stderr}\n${sig.stdout}`)?.[1] || "";
  let stapled = false,
    said = "";
  for (let i = 0; who && !stapled && i < STAPLER_TRIES; i++) {
    if (i) pause(STAPLER_PAUSE_MS);
    const r = run("xcrun", ["stapler", "validate", app]);
    stapled = r.status === 0;
    said = stapled ? "" : `${r.stderr || ""}\n${r.stdout || ""}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" ") || `exit code ${r.status}`;
  }
  return { who, stapled, said };
}

/** A file or folder gone; Windows' passing locks (a scanner reading a new file) are waited out a moment. @param {string} p */
const removeAll = (p) => rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });

/** Why a removal failed, in a word: its code where it has one. @param {any} e */
const whyNot = (e) => e?.code || e?.message || String(e);

/** What a build ends by saying of what it made, per system. @param {Platform} p @param {string} version @param {string[]} made @param {string} app */
function madeWords(p, version, made, app) {
  const named = (/** @type {RegExp} */ re) => made.find((f) => re.test(f));
  if (p.folder === "windows") {
    const exe = named(/-setup-x64\.exe$/);
    return exe ? [`Filament ${version}'s installer: ${exe} — run it to install, or to upgrade the Filament installed.`] : [`Filament ${version}, unpacked, no installer built: ${join(app, p.app)}`];
  }
  if (p.folder === "mac") {
    const dmg = named(/\.dmg$/);
    return dmg ? [`Filament ${version} for macOS: ${dmg} — open it and drag Filament to Applications.`] : [`Filament ${version}, unpacked, no disk image built: ${join(app, p.app)}`];
  }
  const image = named(/\.AppImage$/),
    deb = named(/\.deb$/);
  if (!image && !deb) return [`Filament ${version}, unpacked, nothing to install built: ${join(app, p.app)}`];
  return [
    ...(image ? [`Filament ${version}'s AppImage: ${image} — chmod +x it, then run it.`] : []),
    ...(deb ? [`Filament ${version}'s deb, for Debian and Ubuntu: ${deb} — sudo apt install ./${deb.split(/[\\/]/).pop()}`] : []),
  ];
}

/**
 * @param {{ platform?: string, machine?: string, args?: string[], root?: string, vendor?: string, check?: typeof checkBundle,
 *   build?: (args: string[], root: string, out: string, p: Platform) => number, clear?: (dir: string) => void, remove?: (file: string) => void,
 *   log?: (line: string) => void, error?: (line: string) => void, env?: Record<string, string | undefined>,
 *   facts?: () => import("../desktop/lib/build-info.js").Build, signedAs?: (app: string) => { who: string, stapled: boolean, said?: string },
 *   ptyHelpers?: (root: string, platform: string) => string[] }} [o]
 *   `platform`: the system to build for (this machine's unless named); `machine`: this machine's; `clear`: the last
 *   build of the version taken away; `remove`: a file made from an app that must not be handed on; `signedAs`: who
 *   signed the Mac app and whether it is notarized, asked once a build; `ptyHelpers`: node-pty's helpers made runnable
 * @returns {Promise<number>} the exit code
 */
export async function dist({
  platform = process.platform,
  machine = process.platform,
  args = [],
  root = ROOT,
  vendor = VENDOR_BUNDLES,
  check = checkBundle,
  build = electronBuilder,
  clear = removeAll,
  remove = removeAll,
  log = console.log,
  error = console.error,
  env = process.env,
  facts = () => buildFacts({ root, env }),
  signedAs = (app) => signedState(app),
  ptyHelpers = (at, system) => ptyHelpersRunnable({ root: at, platform: system }),
} = {}) {
  const p = PLATFORMS[platform];
  if (!p) {
    error(`Filament is built for Windows, macOS and Linux; this machine is ${machine}.`);
    return 1;
  }
  if (platform !== machine) {
    const here = PLATFORMS[machine];
    error(`Filament's ${p.name} app is built on ${p.name}: its memory engine bundle is built on the machine it is for${p.folder === "mac" ? ", and a Mac app is signed on a Mac" : ""}. This machine is ${machine}${here ? `: npm run dist:${here.word} builds its own` : ""}; GitHub Actions builds all three (docs/releasing.md).`);
    return 1;
  }
  const version = versionOf(root);
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) {
    error(`package.json's version is no version to build: ${JSON.stringify(version)} (say one like 0.2.0 or 0.2.0-alpha.1).`);
    return 1;
  }
  const before = await check({ root: vendor, target: targetOf(platform), say: log });
  if (!before.ok) {
    error(`No installer without the memory engine: ${before.why}${elsewhere(env, vendor)}.`);
    return 1;
  }
  log(wholeWords(before.bundle));
  // A build that is to be notarized, with a bundle whose programs were never signed: Apple would refuse it minutes in.
  if (p.folder === "mac" && notarizes(env) && !before.bundle.manifest.signed) {
    error(`No notarized build with an unsigned memory engine bundle: it was built with no Developer ID Application certificate in the keychain, and notarization refuses an app whose programs are unsigned. Build it again with npm run engine:bundle once the certificate is there (docs/releasing.md).`);
    return 1;
  }
  // Signed by a build from before 11-08, which left the programs inside its wheels and Python archive as they came.
  if (p.folder === "mac" && notarizes(env) && !before.bundle.manifest.signedInside) {
    error(`No notarized build with this memory engine bundle: it was built before the programs inside its wheels and Python archive were signed, and notarization refuses those. Build it again with npm run engine:bundle (docs/releasing.md).`);
    return 1;
  }
  const out = distDir(root, p.folder, version),
    app = join(out, p.unpacked);
  if (existsSync(out)) {
    log(`Replacing the build of ${version} at ${out}.`);
    try {
      clear(out);
    } catch (e) {
      error(`The build of ${version} at ${out} can't be replaced (${whyNot(e)}): a program has a file of it open — its ${p.app} running, or a window on the folder. Close it and build again.`);
      return 1;
    }
  }
  // The app packs node-pty's helper as it is here: runnable, or a Mac's every terminal fails (scripts/pty-helper.mjs).
  try {
    for (const f of ptyHelpers(root, platform)) log(`node-pty's helper made runnable: ${f}`);
  } catch (e) {
    error(`node-pty's helper can't be made runnable (${whyNot(e)}): the app's terminals would not start. chmod +x node_modules/node-pty/prebuilds/*/spawn-helper, then build again.`);
    return 1;
  }
  const code = withBuildFile(root, facts(), () => build(args, root, out, p));
  if (code !== 0) return code;
  const after = await check({ root: appBundleRoot(app, platform), target: targetOf(platform), inApp: true, say: log });
  if (!after.ok) {
    for (const f of madeIn(out, version, p))
      try {
        remove(f);
        error(`Removed ${f}: it would install a Filament without its memory engine.`);
      } catch (e) {
        error(`Couldn't remove ${f} (${whyNot(e)}): it would install a Filament without its memory engine — don't hand it on.`);
      }
    error(`The app at ${app} can't be handed on: ${after.why}.`);
    return 1;
  }
  log(wholeWords(after.bundle, ` inside ${app}`));
  // A build that was to be notarized and is not signed: electron-builder only warns where it finds no Developer ID in
  // the keychain (a wrong or expired certificate), and notarizes nothing then — the build must not pass for one that
  // opens on any Mac. Signed, it notarized the app and stapled its ticket, or ended non-zero above (@electron/notarize
  // throws at Apple's no and at a staple that fails): stapler validate's no is said in the last line, not taken for
  // Apple's — on the runners of 11-08 it said no of a stapled app, once seconds after a yes and three times in a row,
  // and the build removed a notarized app. Asked once, for this and the build's last line.
  const s = p.folder === "mac" && existsSync(join(app, p.app)) ? signedAs(join(app, p.app)) : null;
  if (s && notarizes(env) && !s.who) {
    for (const f of madeIn(out, version, p))
      try {
        remove(f);
        error(`Removed ${f}: it would not open on another Mac.`);
      } catch (e) {
        error(`Couldn't remove ${f} (${whyNot(e)}): it would not open on another Mac — don't hand it on.`);
      }
    error(`The app was to be notarized, but electron-builder found no Developer ID Application certificate in the keychain to sign it with (security find-identity -v -p codesigning lists what it holds; docs/releasing.md).`);
    return 1;
  }
  const made = madeIn(out, version, p);
  // `-- --dir` builds the app alone: nothing to install, and no update file.
  if (made.some((f) => f.endsWith(p.feed)) && made.length > 1) log(`To offer it as an update: the release CI drafts on a tag v${version} (docs/releasing.md), or one made by hand with ${made.map((f) => f.split(/[\\/]/).pop()).join(", ")} attached.`);
  for (const line of madeWords(p, version, made, app)) log(line);
  if (s) log(wordsOfSigned(s, notarizes(env)));
  return 0;
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const named = platformOfWord(argv[0]);
  process.exitCode = await dist({ ...(named ? { platform: named } : {}), args: named ? argv.slice(1) : argv });
}
