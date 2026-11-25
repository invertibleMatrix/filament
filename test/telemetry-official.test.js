// @ts-check
// Anonymous telemetry is on by default in official builds alone: a build is official when FILAMENT_OFFICIAL_BUILD=1 is
// set as it is built (the release CI's), and the dist scripts then write `official: true` into the build-info.json the
// app reads; a build made from a checkout, or packaged anywhere else, sends nothing unless its person turns it on. The
// person's own choice in Settings wins over the build's default either way. Every send goes to an injected fetch: no
// test reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFacts } from "../desktop/lib/build-info.js";
import { dist } from "../scripts/dist.mjs";
import { markerOf } from "../scripts/dist-server.mjs";
import { INSTALL_NO, createTelemetry, officialBuild, takeInstallChoice } from "../src/services/telemetry.js";
import { createEventBus } from "../src/services/events.js";
import { normalizeConfig, sparseConfig } from "../src/services/config/store.js";
import { telemetrySwitchOn, telemetryWords } from "../src/ui/harness/settings/data-privacy.js";

const tmp = () => mkdtempSync(join(tmpdir(), "filament-telemetry-official-"));
const NOW = new Date("2026-11-21T10:00:00.000Z");
const OFFICIAL = { FILAMENT_OFFICIAL_BUILD: "1" };

/** A root with package.json, and git answering as a checkout's would. @param {string} root */
const facts = (root, /** @type {Record<string, string | undefined>} */ env) => {
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
  /** @type {Record<string, string>} */
  const answers = { "rev-parse": "abc1234567\n", log: "a commit\n", status: "" };
  return buildFacts({ root, git: (args) => answers[args[0]], now: NOW, env });
};

// (fails before: buildFacts said nothing of who built it, and dist-server.mjs had no markerOf)
test("the build's facts say official only where FILAMENT_OFFICIAL_BUILD=1 is set as it is built; a server's marker carries it", () => {
  const root = tmp();
  try {
    const plain = { version: "1.2.3", commit: "abc1234567", subject: "a commit", dirty: false, builtAt: NOW.toISOString() };
    assert.deepEqual(facts(root, OFFICIAL), { ...plain, official: true });
    for (const env of [{}, { FILAMENT_OFFICIAL_BUILD: "0" }, { FILAMENT_OFFICIAL_BUILD: "true" }, { FILAMENT_OFFICIAL_BUILD: "" }])
      assert.deepEqual(facts(root, env), plain, `nothing said: ${JSON.stringify(env)}`);

    const o = { version: "1.2.3", target: "linux-x64", engine: true, node: "v24.11.0", glibc: "2.35", releases: { owner: "o", repo: "r" } };
    const marker = markerOf({ ...o, facts: facts(root, OFFICIAL) });
    assert.equal(marker.official, true);
    assert.equal(marker.kind, "server");
    assert.equal(marker.file, "filament-server-1.2.3-linux-x64.tar.gz");
    assert.equal("official" in markerOf({ ...o, facts: facts(root, {}) }), false, "an unofficial server build says nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// (fails before: the desktop build's file never said official)
test("npm run dist packs desktop/build-info.json with official: true where the variable is set, and without it otherwise", async () => {
  for (const env of [OFFICIAL, {}]) {
    const root = tmp();
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
      /** @type {any} */
      let packed = null;
      /** @type {any} */
      const whole = { ok: true, bundle: { manifest: { mnemosyne: "3.15.1", python: "3.12.16", builtAt: "b", files: { a: "x" } } } };
      const code = await dist({
        platform: "win32",
        machine: "win32",
        root,
        vendor: join(root, "v"),
        env,
        check: async () => whole,
        ptyHelpers: () => [],
        build: () => ((packed = JSON.parse(readFileSync(join(root, "desktop", "build-info.json"), "utf8"))), 0),
        log: () => {},
        error: () => {},
      });
      assert.equal(code, 0);
      assert.equal(packed?.official === true, env === OFFICIAL, JSON.stringify(packed));
      if (env !== OFFICIAL) assert.equal("official" in packed, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** The installs a Filament can run from, each as its folder holds build-info.json. @param {string} at */
function installs(at) {
  const made = {
    official: { server: { kind: "server", official: true }, desktop: null },
    officialDesktop: { server: null, desktop: { version: "1.2.3", builtAt: NOW.toISOString(), official: true } },
    unofficialServer: { server: { kind: "server" }, desktop: null },
    unofficialDesktop: { server: null, desktop: { version: "1.2.3", builtAt: NOW.toISOString() } },
    saysItInWords: { server: { kind: "server", official: "true" }, desktop: null },
    checkout: { server: null, desktop: null },
  };
  /** @type {Record<string, string>} */
  const roots = {};
  for (const [name, { server, desktop }] of Object.entries(made)) {
    const root = join(at, name);
    mkdirSync(join(root, "desktop"), { recursive: true });
    if (server) writeFileSync(join(root, "build-info.json"), JSON.stringify(server));
    if (desktop) writeFileSync(join(root, "desktop", "build-info.json"), JSON.stringify(desktop));
    roots[name] = root;
  }
  return roots;
}

// (fails before: no officialBuild — every install that was not a checkout counted as one that sends)
test("an official build is one whose build-info.json says official: true, a server's or the desktop app's; any other, and a checkout, is not", () => {
  const at = tmp();
  try {
    const roots = installs(at);
    assert.equal(officialBuild(roots.official), true);
    assert.equal(officialBuild(roots.officialDesktop), true);
    assert.equal(officialBuild(roots.unofficialServer), false);
    assert.equal(officialBuild(roots.unofficialDesktop), false);
    assert.equal(officialBuild(roots.saysItInWords), false, "true alone, not a word");
    assert.equal(officialBuild(roots.checkout), false);
    assert.equal(officialBuild(join(at, "nowhere")), false);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

/** A Filament's telemetry, armed as bin/filament.js arms it, on the install at `root` with the person's stored choice. */
async function sendsFrom(/** @type {string} */ root, /** @type {boolean | null} */ enabled) {
  /** @type {any[]} */
  const sent = [];
  const cfg = { upstreams: [], telemetry: { enabled, noticeSeen: true } };
  const t = createTelemetry({
    armed: true,
    onByDefault: officialBuild(root),
    config: { get: () => cfg },
    usage: { dailyStore: { list: () => [] } },
    events: createEventBus(),
    context: () => ({ version: "1.2.3", platform: "linux", arch: "x64", install: "server", locale: "en-US", timeZone: "UTC" }),
    env: {},
    every: () => ({ unref() {} }),
    stopEvery: () => {},
    fetchImpl: /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => (sent.push(JSON.parse(init.body)), { ok: true, status: 204 })),
  });
  await t.look();
  return { sent: sent.length, view: t.view() };
}

// (fails before: an unofficial packaged build sent by default, and a checkout's stored "on" was never heard)
test("the default: on in an official build, off in an unofficial packaged build and in a checkout — and the stored choice wins in each", async () => {
  const at = tmp();
  try {
    const roots = installs(at);
    for (const [name, on] of /** @type {[string, boolean][]} */ ([["official", true], ["officialDesktop", true], ["unofficialServer", false], ["unofficialDesktop", false], ["checkout", false]])) {
      const byDefault = await sendsFrom(roots[name], null);
      assert.equal(byDefault.sent, on ? 1 : 0, `${name}, nothing chosen`);
      assert.equal(byDefault.view.why, on ? null : "unofficial", name);
      assert.equal(byDefault.view.onByDefault, on, name);
      assert.equal((await sendsFrom(roots[name], false)).sent, 0, `${name}, turned off`);
      assert.equal((await sendsFrom(roots[name], false)).view.why, "setting", name);
      assert.equal((await sendsFrom(roots[name], true)).sent, 1, `${name}, turned on`);
    }
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

// (fails before: the setting's default was true, so a stored "on" equalled it and was never written to config.json)
test("the setting has no fixed default: a person's on is kept in config.json as their off is, and nothing chosen keeps nothing", () => {
  assert.equal(normalizeConfig({}).telemetry.enabled, null);
  assert.equal(sparseConfig(normalizeConfig({ telemetry: { enabled: true } })).telemetry?.enabled, true);
  assert.equal(sparseConfig(normalizeConfig({ telemetry: { enabled: false } })).telemetry?.enabled, false);
  assert.equal(sparseConfig(normalizeConfig({})).telemetry?.enabled, undefined);
});

// (fails before: the switch drew the stored value alone, and Settings had no words for a build that sends nothing by default)
test("Settings' switch shows what this build does where nothing is chosen, and says why it is off in plain words", () => {
  assert.equal(telemetrySwitchOn(null, { onByDefault: true }), true);
  assert.equal(telemetrySwitchOn(null, { onByDefault: false }), false);
  assert.equal(telemetrySwitchOn(undefined, null), false);
  assert.equal(telemetrySwitchOn(false, { onByDefault: true }), false);
  assert.equal(telemetrySwitchOn(true, { onByDefault: false }), true);
  assert.equal(
    telemetryWords({ why: "unofficial" }),
    "Official builds from filamentdev.com send anonymous usage counts unless you turn them off; builds you make yourself, as this one is, send nothing unless you turn them on.",
  );
});

test("Filament passes its build's default to the service, and the release CI sets FILAMENT_OFFICIAL_BUILD=1 on every job that builds", () => {
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /onByDefault: officialBuild\(join\(__dirname, "\.\."\)\) \|\| process\.env\.FILAMENT_TELEMETRY === "1"/);
  assert.match(server, /armed: !!sendsTelemetry,/);
  const yml = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
  for (const job of ["windows", "mac", "linux", "server", "server-arm64", "server-windows"]) {
    const body = yml.split(new RegExp(`^  ${job}:\\r?\\n`, "m"))[1]?.split(/^  [\w-]+:\r?\n/m)[0] || "";
    assert.match(body, /^    env:\r?\n(?:      .*\r?\n)*      FILAMENT_OFFICIAL_BUILD: \$\{\{ github\.repository_owner == 'invertibleMatrix' && '1' \|\| '0' \}\}$/m, job);
  }
  assert.equal((yml.match(/FILAMENT_OFFICIAL_BUILD/g) || []).length, 6, "set on the six build jobs alone");
});

// (fails before: the installer asked nothing, and services/telemetry.js had no takeInstallChoice)
test("the Windows installer's no: taken once from the data folder, made the setting where nothing is chosen, and asked only on a first install a person runs", () => {
  const dir = tmp();
  try {
    assert.equal(takeInstallChoice(dir), false, "no file: the installer said nothing");
    assert.equal(takeInstallChoice(null), false);
    writeFileSync(join(dir, INSTALL_NO), "no\r\n");
    assert.equal(takeInstallChoice(dir), true);
    assert.equal(existsSync(join(dir, INSTALL_NO)), false, "read once: the file goes");
    assert.equal(takeInstallChoice(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const server = readFileSync("src/server.js", "utf8");
  const wired = server.indexOf('if (takeInstallChoice(dataDir) && typeof config.get()?.telemetry?.enabled !== "boolean") changeFields(config, { set: { "telemetry.enabled": false } });');
  assert.ok(wired > 0 && wired < server.indexOf("const telemetry = createTelemetry({"), "the server makes it the setting before telemetry is made, and a choice already made stands");
  const nsh = readFileSync("build/installer.nsh", "utf8");
  const install = nsh.slice(nsh.indexOf("!macro customInstall"), nsh.indexOf("!macro customUnInstall"));
  const ask = install.slice(install.indexOf("${ifNot} ${isUpdated}\n    IfSilent filamentAsked"));
  const question = /^\$\{ifNot\} \$\{isUpdated\}\n {4}IfSilent filamentAsked\n {4}\$\{ifNot\} \$\{FileExists\} "\$APPDATA\\Filament\\config\.json"\n {6}MessageBox MB_YESNO\|MB_ICONQUESTION "([^"]*)" IDYES filamentAsked\n/.exec(ask);
  assert.ok(question, "an update, a silent install and one over a data folder ask nothing");
  assert.ok(question[1].includes("https://filamentdev.com/telemetry") && question[1].includes("https://filamentdev.com/privacy"), "the question links every field and the privacy policy");
  assert.ok(!/[^\x20-\x7e]/.test(question[1]), "its words are ASCII: NSIS reads a script without a BOM in the system's code page");
  assert.match(ask, /FileOpen \$R0 "\$APPDATA\\Filament\\telemetry-off" w\n/, "a no leaves the file the first start reads");
});
