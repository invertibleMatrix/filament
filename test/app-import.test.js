// @ts-check
// Import app… and the apps a project's folder brings (the Space Apps plan of 10-29, phase 4): an app travels as a
// folder — its app.json and its page —, in a .zip (its download from Filament, which now carries its app.json, or its
// folder zipped). An import unpacks it into the project's .filament/apps/ and adds it to the project's Space as a
// draft, with no chat: nothing runs until it is kept, and it carries no secret's value.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { pageAlone, pageUnalone } from "../src/core/artifacts.js";
import { appJsonOf, unpinnedText } from "../src/core/app-folder.js";
import { pinnedText, relativeRef } from "../src/core/web-pins.js";
import { unzipOf, zipOf } from "../src/services/zip.js";
import { appFromZip, folderApps, folderNameOf, importApp, notYetAdded } from "../src/services/app-import.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { ARTIFACT_GUIDE, artifactCall, publishFolderApp } from "../src/app/agent/artifacts.js";
import { downloadOf } from "../src/http/admin/artifacts.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createRouter } from "../src/http/router.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fresh() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "filament-app-import-")));
  dirs.push(d);
  return d;
}
const NOW = Date.UTC(2026, 9, 29, 16, 0);
const file = (/** @type {string} */ path, /** @type {string} */ text) => ({ path, data: Buffer.from(text, "utf8") });

describe("a .zip read back", () => {
  // (fails before: yes — Filament wrote a .zip and read none)
  test("its files as written, stored or deflated; one that climbs out, is cut, is sealed or holds too much refused in words", () => {
    const files = [file("index.html", "<p>hi</p>"), file("lib/app.js", "x".repeat(5000)), { path: "empty.txt", data: Buffer.alloc(0) }];
    const z = zipOf(files);
    assert.deepEqual(unzipOf(z, { maxBytes: 1e6 }), { ok: true, files });
    assert.deepEqual(unzipOf(Buffer.from("no zip here"), { maxBytes: 1e6 }), { ok: false, error: "it is not a .zip" });
    assert.match(/** @type {any} */ (unzipOf(zipOf([file("../evil.js", "x")]), { maxBytes: 1e6 })).error, /"..\/evil.js" is no path inside it/);
    assert.match(/** @type {any} */ (unzipOf(zipOf([file("/etc/x", "x")]), { maxBytes: 1e6 })).error, /is no path inside it/);
    assert.match(/** @type {any} */ (unzipOf(zipOf([file("C:/x", "x")]), { maxBytes: 1e6 })).error, /is no path inside it/);
    assert.match(/** @type {any} */ (unzipOf(z, { maxBytes: 100 })).error, /holds more than Filament takes/);
    assert.match(/** @type {any} */ (unzipOf(z, { maxBytes: 1e6, maxFiles: 2 })).error, /more than 2 files/);
    // A byte changed in a stored file's body: its CRC no longer matches.
    const bad = zipOf([file("a.txt", "abc")]);
    bad[30 + "a.txt".length] ^= 1;
    assert.match(/** @type {any} */ (unzipOf(bad, { maxBytes: 1e6 })).error, /a\.txt does not unpack as it says it is/);
    // The central directory's flag for a password.
    const sealed = zipOf([file("a.txt", "abc")]);
    const dirAt = sealed.readUInt32LE(sealed.length - 22 + 16);
    sealed.writeUInt16LE(sealed.readUInt16LE(dirAt + 8) | 1, dirAt + 8);
    assert.equal(/** @type {any} */ (unzipOf(sealed, { maxBytes: 1e6 })).error, "a.txt is sealed with a password");
    assert.equal(crc32(Buffer.from("abc")) >>> 0, 0x352441c2, "Node's CRC-32 is the .zip's");
  });
});

describe("a page alone and its copies of the web, undone", () => {
  test("the look and script a download writes in are taken out again; a page without them is as it was", () => {
    for (const html of ["<!doctype html><html><body><p>x</p></body></html>", "<!doctype html>\n<html><head><style>p{}</style></head><body></body></html>"])
      assert.equal(pageUnalone(pageAlone(html, "T", "L{}", "S()")), html);
    assert.equal(pageUnalone("<p>no look</p>"), "<p>no look</p>");
  });

  test("each address a download pointed at its copy points at the web again, the longest copy's first", () => {
    const pins = { "https://cdn.jsdelivr.net/npm/a@1/x.js": "cdn.jsdelivr.net/npm/a@1/x.js", "https://cdn.jsdelivr.net/npm/a@1/x.js.map": "cdn.jsdelivr.net/npm/a@1/x.js.map" };
    const text = 'import "https://cdn.jsdelivr.net/npm/a@1/x.js"; // https://cdn.jsdelivr.net/npm/a@1/x.js.map';
    for (const path of ["index.html", "lib/deep/app.js"]) {
      const pointed = pinnedText(text, pins, (p) => relativeRef(path, `_filament/web/${p}`));
      assert.notEqual(pointed, text);
      assert.equal(unpinnedText(pointed, pins, path), text);
    }
  });
});

const RUNS = { command: ["node", ".filament/apps/runs/runs.mjs"], rows: "runs", key: "id" };
const APP_JSON = { title: "Runs", description: "CI's runs", icon: "rocket", sources: { runs: RUNS }, secrets: { GITHUB_TOKEN: "Reads the runs" } };

/** A project folder with an app under .filament/apps/runs. @param {any} [json] */
function projectWithApp(json = APP_JSON) {
  const cwd = fresh();
  const at = join(cwd, ".filament", "apps", "runs");
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "app.json"), JSON.stringify(json));
  writeFileSync(join(at, "index.html"), "<!doctype html><title>Runs</title><main></main>");
  writeFileSync(join(at, "runs.mjs"), "console.log('{\"runs\":[]}')");
  return cwd;
}

describe("an app from a .zip", () => {
  test("its folder zipped whole: its files inside its one top folder; one with no app.json or no page refused in words", () => {
    const z = zipOf([file("runs/app.json", JSON.stringify(APP_JSON)), file("runs/index.html", "<p>x</p>"), file("runs/runs.mjs", "1")]);
    const got = /** @type {any} */ (appFromZip(z, { maxBytes: 1e6 }));
    assert.deepEqual([got.ok, got.top, got.json.title, got.files.map((/** @type {any} */ f) => f.path).sort()], [true, "runs", "Runs", ["app.json", "index.html", "runs.mjs"]]);
    assert.match(/** @type {any} */ (appFromZip(zipOf([file("index.html", "x")]), { maxBytes: 1e6 })).error, /^Not imported: it holds no app\.json at its top\. An app's download from Filament has one/);
    assert.match(/** @type {any} */ (appFromZip(zipOf([file("app.json", "{}")]), { maxBytes: 1e6 })).error, /^Not imported: it holds no index\.html beside app\.json/);
    assert.match(/** @type {any} */ (appFromZip(zipOf([file("app.json", "{"), file("index.html", "x")]), { maxBytes: 1e6 })).error, /^Not imported: its app\.json does not read as JSON/);
  });

  // (fails before: yes — an app's download carried no app.json, and its pages kept Filament's look written in)
  test("its download from Filament carries its app.json, its folder written {{folder}}; imported, its page is as published and its commands name where it now is", () => {
    const from = projectWithApp();
    const art = createArtifactStore({ dataDir: fresh(), log: () => {}, now: () => NOW, four: () => "ab12" });
    const pub = /** @type {any} */ (artifactCall({ action: "publish", folder: ".filament/apps/runs" }, { who: "c1", by: { chain: "c1", model: "m", folder: from, helper: null }, within: [from], port: 20300, maxBytes: 1e6 }, art));
    assert.equal(pub.ok, true, pub.error);
    const a = /** @type {any} */ (art.get("runs-ab12"));
    assert.equal(a.versions[0].by.dir, join(from, ".filament", "apps", "runs"), "the folder it came from, kept with its version");
    const dl = downloadOf(a, 1, /** @type {any} */ (art.files("runs-ab12", 1)));
    assert.equal(dl.file, "runs-ab12.zip");
    const inZip = /** @type {any} */ (unzipOf(dl.data, { maxBytes: 1e6 })).files;
    const json = JSON.parse(inZip.find((/** @type {any} */ f) => f.path === "app.json").data.toString("utf8"));
    assert.deepEqual(json, { title: "Runs", description: "CI's runs", icon: "rocket", sources: { runs: { ...RUNS, command: ["node", "{{folder}}/runs.mjs"] } }, secrets: { GITHUB_TOKEN: "Reads the runs" } });
    assert.match(inZip.find((/** @type {any} */ f) => f.path === "index.html").data.toString("utf8"), /<!--filament:alone-->/, "it still opens alone");
    const to = fresh();
    const made = /** @type {any} */ (importApp(dl.data, to, { maxBytes: 1e6 }));
    assert.deepEqual(made, { ok: true, folder: ".filament/apps/runs", title: "Runs" });
    const here = join(to, ".filament", "apps", "runs");
    assert.equal(readFileSync(join(here, "index.html"), "utf8"), "<!doctype html><title>Runs</title><main></main>", "its page as published");
    assert.equal(existsSync(join(here, "content.json")), false, "Filament's content.json left: app.json says it");
    assert.deepEqual(JSON.parse(readFileSync(join(here, "app.json"), "utf8")).sources.runs.command, ["node", ".filament/apps/runs/runs.mjs"]);
    // Again: beside it, never over it — and its commands name that folder.
    const again = /** @type {any} */ (importApp(dl.data, to, { maxBytes: 1e6 }));
    assert.equal(again.folder, ".filament/apps/runs-2");
    assert.deepEqual(JSON.parse(readFileSync(join(to, ".filament", "apps", "runs-2", "app.json"), "utf8")).sources.runs.command, ["node", ".filament/apps/runs-2/runs.mjs"]);
  });

  test("a folder zipped from .filament/apps/ whole has the folder its commands named put where it now is", () => {
    const z = zipOf([file("runs/app.json", JSON.stringify(APP_JSON)), file("runs/index.html", "<p>x</p>")]);
    const to = fresh();
    mkdirSync(join(to, ".filament", "apps", "runs"), { recursive: true });
    const made = /** @type {any} */ (importApp(z, to, { maxBytes: 1e6 }));
    assert.equal(made.folder, ".filament/apps/runs-2");
    assert.deepEqual(JSON.parse(readFileSync(join(to, ".filament", "apps", "runs-2", "app.json"), "utf8")).sources.runs.command, ["node", ".filament/apps/runs-2/runs.mjs"]);
    assert.equal(folderNameOf("Build pipeline!"), "build-pipeline");
    assert.equal(folderNameOf("ÉÉÉ"), "app");
  });
});

describe("added to a project's Space with no chat", () => {
  /** A runner over a store where c1 is p1's chat; `cwd` p1's folder. @param {string} cwd */
  function world(cwd) {
    const artifacts = createArtifactStore({ dataDir: fresh(), log: () => {}, now: () => NOW, four: () => "ab12" });
    const spaces = createSpaceStore({ dir: null, now: () => NOW });
    const run = async () => ({ ok: /** @type {const} */ (true), out: '{"runs":[]}' });
    const runner = createDashboardRunner({ spaces, artifacts, folderOf: () => cwd, projectOfChain: (c) => (c === "c1" ? "p1" : null), now: () => NOW, run });
    return { artifacts, spaces, runner };
  }

  // (fails before: yes — a version no chat made was no project's, so the Space showed none)
  test("its folder published as a draft of that project's Space alone: made by no chat, its secrets by name, nothing kept", () => {
    const cwd = projectWithApp();
    const w = world(cwd);
    const got = /** @type {any} */ (publishFolderApp({ store: w.artifacts, folder: ".filament/apps/runs", cwd, project: "p1", maxBytes: 1e6, port: 20300 }));
    assert.deepEqual([got.ok, got.name, got.v, got.title], [true, "runs-ab12", 1, "Runs"]);
    const by = /** @type {any} */ (w.artifacts.get("runs-ab12")).versions[0].by;
    assert.deepEqual([by.chain, by.project, by.dir], [null, "p1", join(cwd, ".filament", "apps", "runs")]);
    const d = /** @type {any} */ (w.runner.shown("p1")[0]);
    assert.deepEqual([d.name, d.type, d.state, d.newest.secrets], ["runs-ab12", "app", "draft", ["GITHUB_TOKEN"]]);
    assert.deepEqual(w.runner.shown("p2"), [], "another project's Space shows none of it");
    assert.equal(w.runner.keep("p1", "runs-ab12", 1).ok, true, "kept like any draft");
  });

  test("its folder's apps: each with app.json and a page; those an app came from — by folder, or by title — not offered again", () => {
    const cwd = projectWithApp();
    mkdirSync(join(cwd, ".filament", "apps", "half"), { recursive: true });
    writeFileSync(join(cwd, ".filament", "apps", "half", "index.html"), "<p>no app.json</p>");
    const found = folderApps(cwd);
    assert.deepEqual(found.map((x) => [x.folder, x.title, x.description]), [[".filament/apps/runs", "Runs", "CI's runs"]]);
    assert.deepEqual(folderApps(join(cwd, "nowhere")), []);
    assert.equal(notYetAdded(found, [], []).length, 1);
    assert.equal(notYetAdded(found, [{ versions: [{ by: { dir: found[0].where.toUpperCase() } }] }], []).length, 0, "by the folder it came from");
    assert.equal(notYetAdded(found, [{ versions: [{ by: {} }] }], ["Runs"]).length, 0, "by its title, where it came before folders were kept");
  });

  test("its routes: the folder's apps offered, one added; a .zip imported and added; a folder of no app refused", async () => {
    const cwd = projectWithApp();
    const w = world(cwd);
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: { maxBodyBytes: 1e6, port: 20300 } }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "proj", cwd } : null) } },
      spaces: w.spaces,
      dashboards: w.runner,
      artifacts: w.artifacts,
    });
    /** @param {string} method @param {string} path @param {any} [json] */
    const call = async (method, path, json) => {
      const m = createRouter(rows)(method, path);
      assert.ok(m, `${method} ${path} matched a row`);
      const got = { status: 0, body: /** @type {any} */ (null) };
      const res = { headersSent: false, writableEnded: false, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void Object.assign(got, { body: JSON.parse(String(b)) }) };
      await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => json }, {});
      return got;
    };
    assert.deepEqual((await call("GET", "/space/p1/folder-apps")).body, { apps: [{ folder: ".filament/apps/runs", title: "Runs", description: "CI's runs" }] });
    const added = await call("POST", "/space/p1/folder-apps", { folder: ".filament/apps/runs" });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.name, "runs-ab12");
    assert.deepEqual((await call("GET", "/space/p1/folder-apps")).body.apps, [], "added: not offered again");
    assert.equal((await call("POST", "/space/p1/folder-apps", { folder: "../elsewhere" })).status, 404);
    const zip = zipOf([file("pulse/app.json", JSON.stringify({ title: "Pulse", sources: { log: { command: ["git", "log", "-1", "--format=%H"], fields: ["sha"], key: "sha" } } })), file("pulse/index.html", "<p>pulse</p>")]);
    const imported = await call("POST", "/space/p1/import-app", { data: zip.toString("base64") });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.deepEqual([imported.body.title, imported.body.folder], ["Pulse", ".filament/apps/pulse"]);
    assert.ok(imported.body.space.dashboards.some((/** @type {any} */ d) => d.name === imported.body.name && d.state === "draft"), "a draft of this Space");
    const broken = await call("POST", "/space/p1/import-app", { data: zipOf([file("app.json", JSON.stringify({ title: "Bad", sources: { x: { command: "not a list" } } })), file("index.html", "x")]).toString("base64") });
    assert.equal(broken.status, 400);
    assert.match(broken.body.error, /^It is unpacked in \.filament\/apps\/bad, but not published/);
    assert.equal((await call("POST", "/space/p1/import-app", { data: "" })).status, 400);
  });
});

test("an app's app.json from its content: its words and parts, a glance line without its kind, its folder marked", () => {
  const json = appJsonOf({ title: "T", content: { sources: { s: { command: ["node", "apps/t/x.js"] } }, glance: [{ kind: "status", title: "S", from: "s", field: "a" }], tiles: [] }, folder: "apps/t" });
  assert.deepEqual(json, { title: "T", sources: { s: { command: ["node", "{{folder}}/x.js"] } }, glance: [{ title: "S", from: "s", field: "a" }] });
});

// (fails before: yes — found reviewing Import app…, 10-29: the guide named no .filament-web/, so an agent working in an
// imported app's folder had no word that it is Filament's, to be left as it is)
test("the app guide says an imported app's .filament-web/ is Filament's: no file of its page, left as it is", () => {
  const g = /** @type {any} */ (ARTIFACT_GUIDE).app;
  assert.match(g, /imported from a download keeps the copies of the web it carried in `\.filament-web\/`, Filament's/);
  assert.match(g, /leave it as it is, neither edit nor delete it, and keep nothing of yours there/);
  // Its draft says how it starts as its page says it now: on its page, the tabs gone (10-29).
  assert.match(g, /saying Keep… on its page runs it\./);
  assert.doesNotMatch(g, /in its tab/);
  for (const s of ["team-pulse", "pipeline", "reader"]) {
    const page = readFileSync(new URL(`../starters/apps/${s}/app.js`, import.meta.url), "utf8");
    assert.match(page, /Keep… on its page .*Resume on its page/, s);
    assert.doesNotMatch(page, /in its tab/, s);
  }
});
