// @ts-check
// What a build of the desktop app is (10-28): `npm run dist:win` packs desktop/build-info.json — the version, the
// commit and its subject, whether changes not committed went in, when — and leaves none in the checkout; the app says
// its own in its log as it starts; a run from the checkout reads as no build (desktop/lib/build-info.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asBuild, BUILD_FILE, buildFacts, buildWords, readBuild, withBuildFile } from "../desktop/lib/build-info.js";
import { distWin } from "../scripts/dist-win.mjs";

const read = (/** @type {string} */ f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const tmp = () => mkdtempSync(join(tmpdir(), "filament-build-info-"));
const NOW = new Date("2026-10-28T18:10:00.000Z");

// (fails before: yes — a build said nothing of what it was; the installed app could not tell one build from another)
test("a build's facts: package.json's version, git's commit and subject, whether changes not committed went in, and when", () => {
  const root = tmp();
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.1.0" }));
    /** @type {Record<string, string | null>} */
    const answers = { "rev-parse": "28d18363d1\n", log: "cleanup\n", status: " M src/x.js\n" };
    const git = (/** @type {string[]} */ args) => answers[args[0]];
    assert.deepEqual(buildFacts({ root, git, now: NOW }), { version: "0.1.0", commit: "28d18363d1", subject: "cleanup", dirty: true, builtAt: "2026-10-28T18:10:00.000Z" });
    answers.status = "";
    assert.equal(buildFacts({ root, git, now: NOW }).dirty, false, "all committed");
    assert.deepEqual(buildFacts({ root, git: () => null, now: NOW }), { version: "0.1.0", commit: "", subject: "", dirty: false, builtAt: NOW.toISOString() }, "no git");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the file is there while electron-builder packs, and gone after — whatever the build did", () => {
  const root = tmp();
  try {
    const build = { version: "0.1.0", commit: "a", subject: "s", dirty: false, builtAt: NOW.toISOString() };
    const file = join(root, "desktop", BUILD_FILE);
    assert.equal(withBuildFile(root, build, () => JSON.parse(readFileSync(file, "utf8")).commit), "a");
    assert.equal(existsSync(file), false);
    assert.throws(() => withBuildFile(root, build, () => { throw new Error("electron-builder failed"); }), /electron-builder failed/);
    assert.equal(existsSync(file), false, "gone after a failed build too");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dist:win packs the build's facts and leaves none in the checkout; electron-builder packs desktop/**; git never takes the file", async () => {
  const root = tmp();
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
    const facts = { version: "9.9.9", commit: "c0ffee", subject: "a change", dirty: true, builtAt: NOW.toISOString() };
    /** @type {any} */
    let during = null;
    /** @type {any} */
    const whole = { ok: true, bundle: { manifest: { mnemosyne: "3.15.1", python: "3.12.16", builtAt: "b", files: { a: "x" } } } };
    const code = await distWin({ root, vendor: join(root, "v"), check: async () => whole, build: () => ((during = readBuild(join(root, "desktop"))), 0), facts: () => facts, env: {}, log: () => {}, error: () => {} });
    assert.equal(code, 0);
    assert.deepEqual(during, facts, "electron-builder saw them");
    assert.equal(existsSync(join(root, "desktop", BUILD_FILE)), false, "and the checkout keeps none");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.match(read("electron-builder.yml"), /\n  - desktop\/\*\*\n/);
  assert.match(read(".gitignore"), /\n\/desktop\/build-info\.json\n/);
});

test("the app reads its own build; a checkout's run, a file that is no build's, or none, read as no build", () => {
  const dir = tmp();
  try {
    assert.equal(readBuild(dir), null, "none");
    writeFileSync(join(dir, BUILD_FILE), "not json");
    assert.equal(readBuild(dir), null);
    writeFileSync(join(dir, BUILD_FILE), JSON.stringify({ commit: "a" }));
    assert.equal(readBuild(dir), null, "no time: no build");
    writeFileSync(join(dir, BUILD_FILE), JSON.stringify({ version: "0.1.0", commit: "a", subject: "s", dirty: true, builtAt: NOW.toISOString(), extra: 1 }));
    assert.deepEqual(readBuild(dir), { version: "0.1.0", commit: "a", subject: "s", dirty: true, builtAt: NOW.toISOString() });
    mkdirSync(join(dir, "empty"));
    assert.equal(readBuild(join(dir, "empty")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(readBuild(), null, "this checkout's desktop folder holds none");
});

test("a build in words; the app says its own as it starts", () => {
  const a = /** @type {any} */ (asBuild({ version: "0.1.0", commit: "c0ffee1234", subject: "Installer quits Filament first", dirty: true, builtAt: NOW.toISOString() }));
  const words = buildWords(a, "en-GB");
  assert.match(words, /^the build of 28 Oct, \d\d:10 · c0ffee1234 · Installer quits Filament first \(and changes not committed yet\)$/);
  assert.match(buildWords({ ...a, commit: "", subject: "", dirty: false }, "en-GB"), /^the build of 28 Oct, \d\d:10$/);
  assert.match(read("desktop/main.js"), /const built = app\.isPackaged \? readBuild\(\) : null;\n  log\.line\(`Filament \$\{app\.getVersion\(\)\}\$\{built \? `, \$\{buildWords\(built\)\}` : app\.isPackaged \? "" : ", from the checkout"\}`\);/);
});
