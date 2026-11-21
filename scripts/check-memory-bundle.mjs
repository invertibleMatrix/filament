#!/usr/bin/env node
// @ts-check
// The memory engine bundle an installer carries (HarnessV3-AtHome AH-D2), checked by `npm run dist`
// (scripts/dist.mjs) before it builds one and in the app it built. Filament installs its engine from that bundle
// alone, so an installer without a whole one is a Filament whose memory has no engine.
//
// Before the build: the bundle electron-builder packs — `vendor/memory-engine` in this checkout, whatever
// FILAMENT_MEMORY_BUNDLE says — is there for this machine (Windows x64, macOS on Apple Silicon, Linux x64), holds the
// Mnemosyne this Filament pins, built from its fork's commit, and every file is as its manifest says. After it (`--app
// dist/<windows|mac|linux>/<version>/<the unpacked app's folder>`): the same of the copy inside the app, so a file the
// packager left out is caught before the installer is handed on. `npm run dist:server` (scripts/dist-server.mjs) checks
// the same before it packs a server's tarball, and the copy it unpacks from that tarball after — for its own target,
// Linux x64 or Linux arm64, whichever it is built on.
//
//   node scripts/check-memory-bundle.mjs [--app <the unpacked app's folder>]
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleDamage, bundleFor, EMBEDDING_MODEL } from "../src/adapters/sidecar/install.js";

/** What each system's build is for, and the one machine it builds on: a bundle is built on the machine it is for. */
export const TARGETS = /** @type {Record<string, string>} */ ({ win32: "win32-x64", darwin: "darwin-arm64", linux: "linux-x64" });

/** The machine a system's build is for; "" for a system Filament is not built for. @param {string} [platform] */
export const targetOf = (platform = process.platform) => TARGETS[platform] || "";

/** What this machine's build is for. */
export const TARGET = targetOf();

/** The bundles electron-builder packs (electron-builder.yml's files): this checkout's, never another folder. */
export const VENDOR_BUNDLES = fileURLToPath(new URL("../vendor/memory-engine", import.meta.url));

/**
 * The bundle inside an app electron-builder made (no asar), from the folder it is unpacked in: the app's own folder is
 * resources/app — on a Mac inside the .app's Contents.
 * @param {string} app @param {string} [platform]
 */
export const appBundleRoot = (app, platform = process.platform) =>
  platform === "darwin" ? join(app, "Filament.app", "Contents", "Resources", "app", "vendor", "memory-engine") : join(app, "resources", "app", "vendor", "memory-engine");

/**
 * Where FILAMENT_MEMORY_BUNDLE sends `npm run engine:bundle` elsewhere than the folder the installer packs, in words;
 * "" when it doesn't.
 * @param {Record<string, string | undefined>} [env]
 */
export function elsewhere(env = process.env, vendor = VENDOR_BUNDLES) {
  const named = env.FILAMENT_MEMORY_BUNDLE;
  return named && resolve(named) !== resolve(vendor)
    ? ` (FILAMENT_MEMORY_BUNDLE names ${named}, where npm run engine:bundle builds; the installer carries ${vendor} alone: build without it set)`
    : "";
}

/**
 * Whether the bundle under `root` is one an installer may carry, or why not.
 * @param {{ root?: string, machine?: string, target?: string, inApp?: boolean, inTarball?: boolean, say?: (line: string) => void }} [o]
 *   `inApp`: the copy inside a built app, whose damage is the packager's; `inTarball`: the copy unpacked from a
 *   server's tarball (scripts/dist-server.mjs), whose damage is that script's
 * @returns {Promise<{ ok: true, bundle: NonNullable<ReturnType<typeof bundleFor>["bundle"]> } | { ok: false, why: string }>}
 */
export async function checkBundle({ root = VENDOR_BUNDLES, machine = `${process.platform}-${process.arch}`, target = TARGET, inApp = false, inTarball = false, say = () => {} } = {}) {
  if (!target) return { ok: false, why: `Filament's installers are for ${Object.values(TARGETS).join(", ")}, each built on that machine; this machine is ${machine}` };
  if (machine !== target)
    return { ok: false, why: `the installer is for ${target} and is built on ${target}, where its memory engine bundle is built; this machine is ${machine}` };
  const { bundle, why } = bundleFor(root);
  if (!bundle) return { ok: false, why };
  // An install warms the model its bundle carries: one built for another model would ship that one with this Filament.
  const m = bundle.manifest;
  if (m.embeddings && m.model !== EMBEDDING_MODEL)
    return { ok: false, why: `the memory engine bundle at ${bundle.dir} carries the embedding model ${m.model}, and this Filament's memory searches by ${EMBEDDING_MODEL}: build it again with npm run engine:bundle` };
  say(`checking the ${Object.keys(bundle.manifest.files).length} files of the memory engine bundle at ${bundle.dir}`);
  const damage = await bundleDamage(bundle);
  if (damage)
    return {
      ok: false,
      why: inApp
        ? `the memory engine bundle inside the app is not whole: ${damage}; the packager left it out or changed it (see electron-builder.yml's files)`
        : inTarball
          ? `the memory engine bundle inside the server's tarball is not whole: ${damage}; scripts/dist-server.mjs left it out or changed it`
          : `the memory engine bundle at ${bundle.dir} is damaged: ${damage}; build it again with npm run engine:bundle`,
    };
  return { ok: true, bundle };
}

/** The bundle checked whole, in a line. @param {any} bundle @param {string} [where] */
export const wholeWords = (bundle, where = "") => {
  const m = bundle.manifest;
  // A Mac's says whom its programs were signed by (scripts/build-memory-bundle.mjs); others sign none.
  const signed = m.signed === undefined ? "" : m.signed ? `, signed by ${m.signed}` : ", unsigned";
  return `The memory engine bundle is whole: mnemosyne ${m.mnemosyne} on Python ${m.python}, built ${m.builtAt}, ${Object.keys(m.files).length} files${signed}${where}.`;
};

/** @param {string[]} argv @returns {Promise<number>} the exit code */
export async function main(argv, { log = console.log, error = console.error, vendor = VENDOR_BUNDLES, env = process.env } = {}) {
  const at = argv.indexOf("--app");
  const app = at >= 0 ? argv[at + 1] : "";
  if (at >= 0 && !app) {
    error("Usage: node scripts/check-memory-bundle.mjs [--app <the unpacked app's folder>]");
    return 2;
  }
  const r = await checkBundle({ root: app ? appBundleRoot(resolve(app)) : vendor, inApp: !!app, say: log });
  if (!r.ok) {
    error(app ? `The app at ${app} can't be handed on: ${r.why}.` : `No installer without the memory engine: ${r.why}${elsewhere(env, vendor)}.`);
    return 1;
  }
  log(wholeWords(r.bundle, app ? ` inside ${app}` : ""));
  return 0;
}

/**
 * Whether this module is the one Node was asked to run: by real paths, so a checkout reached through a junction or a
 * link still runs it (Node loads its main module by its real path; argv keeps the one typed).
 * @param {string} url  the module's import.meta.url
 */
export const isMain = (url, argv1 = process.argv[1]) => {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
};

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
