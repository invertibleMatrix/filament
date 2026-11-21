// @ts-check
// What a build of the desktop app is (10-28): `npm run dist:win` writes desktop/build-info.json into the app it builds
// — the version, the commit and its subject, whether changes not committed went in, and when — and leaves none in the
// checkout. The app says its own in its log as it starts, so a report tells one rebuild of a version from another. A
// run from the checkout has none: it is no build. Plain Node.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The file's name, beside desktop/main.js. */
export const BUILD_FILE = "build-info.json";
const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {{ version: string, commit: string, subject: string, dirty: boolean, builtAt: string, official?: true }} Build */

/**
 * A build's facts as read from a file, or none: anything not a build's is none.
 * @param {unknown} v @returns {Build | null}
 */
export function asBuild(v) {
  const b = /** @type {any} */ (v);
  if (!b || typeof b !== "object" || typeof b.builtAt !== "string" || !Number.isFinite(Date.parse(b.builtAt))) return null;
  return { version: String(b.version || ""), commit: String(b.commit || ""), subject: String(b.subject || ""), dirty: b.dirty === true, builtAt: b.builtAt };
}

/**
 * Filament's version, as its package.json says it: the installed app's and a checkout's alike — Electron's own
 * `app.getVersion()` is Electron's version in a checkout. "" where it does not read.
 * @param {string} root  the folder holding package.json
 */
export function appVersion(root) {
  try {
    return String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version || "");
  } catch {
    return "";
  }
}

/** The build this app is, from desktop/build-info.json; none from a checkout. @param {string} [dir]  the desktop folder */
export function readBuild(dir = DESKTOP) {
  try {
    return asBuild(JSON.parse(readFileSync(join(dir, BUILD_FILE), "utf8")));
  } catch {
    return null;
  }
}

/**
 * The checkout's facts as it builds: package.json's version, git's commit and subject, whether anything is not
 * committed (`git status --porcelain`), and now. Without git, the commit and subject are empty. `official: true` where
 * FILAMENT_OFFICIAL_BUILD=1 is set as it builds — the release CI's builds alone (.github/workflows/build.yml) —, and
 * nothing said otherwise: anonymous telemetry is on by default in an official build alone (services/telemetry.js).
 * @param {{ root: string, git?: (args: string[]) => string | null, now?: Date, env?: Record<string, string | undefined> }} o
 * @returns {Build}
 */
export function buildFacts({ root, git = (args) => gitOut(root, args), now = new Date(), env = process.env }) {
  const version = String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version || "");
  const commit = (git(["rev-parse", "--short=10", "HEAD"]) || "").trim();
  const subject = (git(["log", "-1", "--format=%s"]) || "").trim();
  const status = git(["status", "--porcelain", "--untracked-files=no"]);
  return { version, commit, subject, dirty: !!status && status.trim() !== "", builtAt: now.toISOString(), ...(env.FILAMENT_OFFICIAL_BUILD === "1" ? { official: /** @type {const} */ (true) } : {}) };
}

/** @param {string} root @param {string[]} args @returns {string | null} */
function gitOut(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

/**
 * `run` with the build's facts in the checkout's desktop/build-info.json, where electron-builder packs it with the app,
 * and the file gone after, whatever `run` did.
 * @template T @param {string} root @param {Build} build @param {() => T} run @returns {T}
 */
export function withBuildFile(root, build, run) {
  const file = join(root, "desktop", BUILD_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(build, null, 2)}\n`);
  try {
    return run();
  } finally {
    rmSync(file, { force: true });
  }
}

/**
 * A build in a few words: when it was built, its commit and subject, and whether changes not committed went in —
 * "the build of 28 Oct, 23:10 · a1b2c3d4e5 · cleanup (and changes not committed yet)".
 * @param {Build} b @param {string} [locale]
 */
export function buildWords(b, locale) {
  const at = new Date(b.builtAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const what = [b.commit, b.subject && (b.subject.length > 72 ? `${b.subject.slice(0, 71)}…` : b.subject)].filter(Boolean).join(" · ");
  return `the build of ${at}${what ? ` · ${what}` : ""}${b.dirty ? " (and changes not committed yet)" : ""}`;
}
