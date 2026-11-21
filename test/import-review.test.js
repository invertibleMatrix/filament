// @ts-check
// Import app… and an app's folder, as a review of the Space work found them: the folder its download marks, a folder
// zipped on a Mac, a .zip naming one file twice or a Windows device, the copies of the web a download keeps, a folder
// whose app.json is not Filament's, a video's .ts segments and a type imported as a value.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appJsonOf } from "../src/core/app-folder.js";
import { artifactPath, artifactTypeOf } from "../src/core/artifacts.js";
import { PINS_FILE, pinsOf } from "../src/core/web-pins.js";
import { unzipOf, zipOf } from "../src/services/zip.js";
import { appFromZip, importApp } from "../src/services/app-import.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { artifactCall, publishFolderApp } from "../src/app/agent/artifacts.js";
import { downloadOf } from "../src/http/admin/artifacts.js";
import { keptPathOf } from "../src/services/web-pins.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fresh() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "filament-import-review-")));
  dirs.push(d);
  return d;
}
const file = (/** @type {string} */ path, /** @type {string | Buffer} */ data) => ({ path, data: Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8") });
const APP = { title: "Pulse", sources: { log: { command: ["node", "log.mjs"], rows: "rows", key: "id" } } };
const store = () => createArtifactStore({ dataDir: fresh(), log: () => {}, four: () => "ab12" });

/** A project whose `app` folder holds `files`; and a publish from it. @param {Record<string, string | Buffer>} files */
function project(files) {
  const root = fresh();
  mkdirSync(join(root, "app"), { recursive: true });
  for (const [p, data] of Object.entries(files)) {
    mkdirSync(join(root, "app", ...p.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(root, "app", ...p.split("/")), data);
  }
  const s = store();
  /** @param {any} input */
  const publish = (input) => artifactCall({ action: "publish", ...input }, { who: "c1", by: { chain: "c1", model: "m", folder: root, helper: null }, within: [root], port: 20300, maxBytes: 1_000_000 }, s);
  return { root, store: s, publish };
}

describe("the folder a download marks", () => {
  // (fails before: yes — found reviewing the Space work: an app published from a folder named app had every "app" in its text marked, --type=application/json among them)
  test("only where it is a path: app/x, ./app/x, app\\x and the whole value; never inside a word or a sentence", () => {
    const json = appJsonOf({
      title: "T",
      content: {
        howto: "Open the app's page",
        state: "Kept by the app",
        sources: { x: { command: ["node", "app/r.mjs", "--type=application/json", "./app/s.mjs", "app\\t.mjs", "app", "webapp/r.mjs", "my-app/r.mjs", "lib/app/r.mjs"] } },
      },
      folder: "app",
    });
    assert.deepEqual(json, {
      title: "T",
      howto: "Open the app's page",
      state: "Kept by the app",
      sources: { x: { command: ["node", "{{folder}}/r.mjs", "--type=application/json", "./{{folder}}/s.mjs", "{{folder}}\\t.mjs", "{{folder}}", "webapp/r.mjs", "my-app/r.mjs", "lib/app/r.mjs"] } },
    });
  });

  test("a folder of several parts is marked where it is followed by a space too", () => {
    const json = appJsonOf({ title: "T", content: { sources: { x: { command: ["sh", "-c", "cd .filament/apps/runs && node r.mjs"] } } }, folder: ".filament/apps/runs" });
    assert.deepEqual(json.sources, { x: { command: ["sh", "-c", "cd {{folder}} && node r.mjs"] } });
  });
});

describe("an app's .zip as other tools make it", () => {
  // (fails before: yes — found reviewing the Space work: Finder's Compress put __MACOSX/ beside the app's folder, and the import said it held no app.json at its top)
  test("a folder zipped on a Mac: its __MACOSX/ and .DS_Store left out", () => {
    const z = zipOf([
      file("pulse/app.json", JSON.stringify(APP)),
      file("pulse/index.html", "<p>pulse</p>"),
      file("pulse/.DS_Store", Buffer.from([0, 0, 0, 1, 0x42, 0x75, 0x64, 0x31])),
      file("__MACOSX/pulse/._app.json", Buffer.from([0, 5, 22, 7])),
      file("__MACOSX/pulse/._index.html", Buffer.from([0, 5, 22, 7])),
    ]);
    const got = /** @type {any} */ (appFromZip(z, { maxBytes: 1e6 }));
    assert.equal(got.ok, true, got.error);
    assert.deepEqual([got.top, got.files.map((/** @type {any} */ f) => f.path).sort()], ["pulse", ["app.json", "index.html"]]);
  });

  // (fails before: yes — found reviewing the Space work: app.json and APP.JSON both written, the raw one over the rewritten one on NTFS)
  test("a .zip naming one file twice in two cases is refused in words, nothing written", () => {
    const to = fresh();
    const z = zipOf([file("app.json", JSON.stringify(APP)), file("APP.JSON", JSON.stringify({ title: "Other" })), file("index.html", "<p>x</p>")]);
    const got = /** @type {any} */ (importApp(z, to, { maxBytes: 1e6 }));
    assert.equal(got.ok, false);
    assert.match(got.error, /^Not imported: it names app\.json twice \(as app\.json and APP\.JSON\)/);
    assert.equal(existsSync(join(to, ".filament")), false, "nothing written");
  });

  // (fails before: yes — found reviewing the Space work: a file named nul or con went into a device, or threw mid-write and left half a folder)
  test("a .zip holding a name Windows keeps for a device is refused in words, nothing written", () => {
    for (const bad of ["nul", "CON.txt", "lib/aux.js", "com1", "Lpt9.log", "prn/x.js"]) {
      const to = fresh();
      const z = zipOf([file("app.json", JSON.stringify(APP)), file("index.html", "<p>x</p>"), file("a.js", "1"), file(bad, "x")]);
      const got = /** @type {any} */ (importApp(z, to, { maxBytes: 1e6 }));
      assert.equal(got.ok, false, bad);
      assert.match(got.error, new RegExp(`^Not imported: ${bad.replace(/\./g, "\\.")} has a name Windows keeps for a device`), bad);
      assert.deepEqual(readdirSync(to), [], `${bad}: nothing written`);
    }
    // A name that only begins like one is a name like any other.
    for (const fine of ["console.js", "nullable.ts", "com10.txt", "auxiliary/x.js", "lpt.js"]) assert.equal(artifactPath(fine).ok, true, fine);
  });
});

describe("a download's copies of the web, imported", () => {
  // (fails before: yes — found reviewing the Space work: an app downloaded with its libraries kept needed the network once imported)
  test("the imported draft keeps the libraries its download kept, and its pins, so it draws offline as the download did", () => {
    const lib = "https://cdn.jsdelivr.net/npm/tiny@1/x.js";
    const from = project({ "index.html": `<!doctype html><script type="module">import "${lib}";</script>`, "app.json": JSON.stringify(APP), "log.mjs": "1" });
    const pinned = { files: [file("_filament/web/cdn.jsdelivr.net/npm/tiny@1/x.js", "export const x = 1;")], pins: { [lib]: "cdn.jsdelivr.net/npm/tiny@1/x.js" }, failed: [], late: 0 };
    const pub = /** @type {any} */ (
      artifactCall({ action: "publish", folder: "app" }, { who: "c1", by: { chain: "c1", model: "m", folder: from.root, helper: null }, within: [from.root], port: 20300, maxBytes: 1e6, pinned }, from.store)
    );
    assert.equal(pub.ok, true, pub.error);
    const a = /** @type {any} */ (from.store.get("pulse-ab12"));
    const dl = downloadOf(a, 1, /** @type {any} */ (from.store.files(a.name, 1)));
    assert.ok(/** @type {any} */ (unzipOf(dl.data, { maxBytes: 1e6 })).files.some((/** @type {any} */ f) => f.path === "_filament/web/cdn.jsdelivr.net/npm/tiny@1/x.js"), "the download keeps it");
    const cwd = fresh();
    const made = /** @type {any} */ (importApp(dl.data, cwd, { maxBytes: 1e6 }));
    assert.equal(made.ok, true, made.error);
    const to = store();
    const got = /** @type {any} */ (publishFolderApp({ store: to, folder: made.folder, cwd, project: "p1", maxBytes: 1e6, port: 20300 }));
    assert.equal(got.ok, true, got.error);
    const paths = /** @type {any} */ (to.get(got.name)).versions[0].files.map((/** @type {any} */ f) => f.path);
    assert.ok(paths.includes("_filament/web/cdn.jsdelivr.net/npm/tiny@1/x.js"), `the draft keeps the library: ${paths.join(", ")}`);
    assert.deepEqual(pinsOf(to.file(got.name, 1, PINS_FILE)), { [lib]: "cdn.jsdelivr.net/npm/tiny@1/x.js" }, "and its pin");
    assert.equal(String(to.file(got.name, 1, "_filament/web/cdn.jsdelivr.net/npm/tiny@1/x.js")), "export const x = 1;");
    assert.match(String(to.file(got.name, 1, "index.html")), /import "https:\/\/cdn\.jsdelivr\.net\/npm\/tiny@1\/x\.js"/, "its page names the address as written, which its pin serves");
  });

  // (fails before: yes — found reviewing the Space work: a kept copy named aux.js, which a publish could keep, failed the whole import)
  test("a download whose copies of the web hold a name Windows keeps for a device is imported, its page loading them from the web", () => {
    const lib = "https://cdn.jsdelivr.net/npm/x@1/aux.js";
    const kept = "cdn.jsdelivr.net/npm/x@1/aux.js";
    const page = `<script type="module">import "/_filament/v/1/_filament/web/${kept}";</script>`;
    const z = zipOf([
      file("app.json", JSON.stringify(APP)),
      file("index.html", page),
      file("log.mjs", "1"),
      file(`_filament/web/${kept}`, 'import "./b.js";'),
      file("_filament/web/cdn.jsdelivr.net/npm/x@1/b.js", "export const b = 1;"),
      file(PINS_FILE, JSON.stringify({ pins: { [lib]: kept } })),
    ]);
    const cwd = fresh();
    const made = /** @type {any} */ (importApp(z, cwd, { maxBytes: 1e6 }));
    assert.equal(made.ok, true, made.error);
    assert.ok(!existsSync(join(cwd, ...made.folder.split("/"), ".filament-web")), "none of its copies is kept, so none is missing");
  });
});

describe("a file kept from the web", () => {
  // (fails before: yes — found reviewing the Space work: a library's aux.js was kept as aux.js, which no folder on Windows can hold, so its download could not be imported)
  test("is never kept under a name Windows keeps for a device", () => {
    assert.equal(keptPathOf(new URL("https://cdn.jsdelivr.net/npm/x@1/aux.js"), "application/javascript"), "cdn.jsdelivr.net/npm/x@1/_aux.js");
    assert.equal(keptPathOf(new URL("https://cdn.jsdelivr.net/npm/x@1/nul/con.css"), "text/css"), "cdn.jsdelivr.net/npm/x@1/_nul/_con.css");
    assert.equal(keptPathOf(new URL("https://cdn.jsdelivr.net/npm/x@1/console.js"), "application/javascript"), "cdn.jsdelivr.net/npm/x@1/console.js");
  });
});

describe("a folder whose app.json is another tool's", () => {
  // (fails before: yes — found reviewing the Space work: a Heroku or Expo project's app.json made its folder an app)
  test("with no type asked, it publishes as a page and keeps its app.json among its files", () => {
    for (const json of [{ name: "my-site", description: "A site", env: { SECRET: { generator: "secret" } }, buildpacks: [{ url: "heroku/nodejs" }] }, { expo: { name: "Mobile", slug: "mobile" } }]) {
      const w = project({ "index.html": "<p>site</p>", "app.json": JSON.stringify(json) });
      const r = /** @type {any} */ (w.publish({ title: "My site", folder: "app" }));
      assert.equal(r.ok, true, r.error);
      const a = /** @type {any} */ (w.store.get("my-site-ab12"));
      assert.equal(a.type, "page", JSON.stringify(json));
      assert.deepEqual(a.versions[0].files.map((/** @type {any} */ f) => f.path).sort(), ["app.json", "index.html"]);
    }
  });

  test("one that names Filament's fields still makes its folder an app", () => {
    const w = project({ "index.html": "<p>x</p>", "app.json": JSON.stringify({ title: "Notes", howto: "Write a note" }) });
    const r = /** @type {any} */ (w.publish({ folder: "app" }));
    assert.equal(r.ok, true, r.error);
    assert.equal(/** @type {any} */ (w.store.get("notes-ab12")).type, "app");
  });
});

describe("a page's .ts files", () => {
  // A video's segment: MPEG-TS packets begin with the sync byte 0x47, and hold NULs and bytes no UTF-8 has.
  const SEGMENT = Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xff, 0xfe, 0x80, 0x47, 0x1f, 0xff, 0x10]);

  // (fails before: yes — found reviewing the Space work: an HLS page's seg0.ts went through the TypeScript stripper, its publish refused or its bytes re-encoded)
  test("a .ts file that is not text is a video's segment: kept byte for byte, served as video/mp2t", () => {
    const w = project({ "index.html": "<video src='live.m3u8'></video>", "live.m3u8": "#EXTM3U\nseg0.ts\n", "seg0.ts": SEGMENT });
    const r = /** @type {any} */ (w.publish({ title: "Live", folder: "app" }));
    assert.equal(r.ok, true, r.error);
    const kept = /** @type {Buffer} */ (w.store.file("live-ab12", 1, "seg0.ts"));
    assert.deepEqual([...kept], [...SEGMENT], "its bytes as they were");
    assert.equal(artifactTypeOf("seg0.ts", kept), "video/mp2t");
    assert.equal(artifactTypeOf("app.ts", Buffer.from("export const a = 1;")), "text/javascript; charset=utf-8", "TypeScript is JavaScript once its types are out");
  });

  // (fails before: yes — found reviewing the Space work: a type imported without `type` was left in by the stripper, and the browser threw that the file does not export it)
  test("a type imported without `type` is refused in words that say the fix", () => {
    const rows = "export interface Row { key: string }\nexport type Key = string;\nexport const keyOf = (r: Row): Key => r.key;\n";
    const one = project({ "index.html": "<script type='module' src='app.ts'></script>", "rows.ts": rows, "app.ts": 'import { Row } from "./rows.ts";\nconst r: Row = { key: "a" };\n' });
    const r = /** @type {any} */ (one.publish({ title: "Rows", folder: "app" }));
    assert.equal(r.ok, false);
    assert.equal(r.error, "Not published: app.ts imports Row from ./rows.ts, which is a type: write `import type { Row }`.");
    const mixed = project({ "index.html": "<script type='module' src='lib/app.ts'></script>", "rows.ts": rows, "lib/app.ts": 'import { keyOf, Key } from "../rows.ts";\nexport const k: Key = keyOf({ key: "a" });\n' });
    const m = /** @type {any} */ (mixed.publish({ title: "Rows", folder: "app" }));
    assert.equal(m.ok, false);
    assert.equal(m.error, "Not published: lib/app.ts imports Key from ../rows.ts, which is a type: write `type Key` in its braces.");
  });

  test("types imported with `type`, values, and what it cannot tell, go through", () => {
    const rows = "export interface Row { key: string }\nexport const keyOf = (r: Row): string => r.key;\nexport interface Both { a: 1 }\nexport const Both = 1;\n";
    for (const app of [
      'import type { Row } from "./rows.ts";\nexport const r: Row = { key: "a" };\n',
      'import { type Row, keyOf } from "./rows.ts";\nexport const k = keyOf({ key: "a" } as Row);\n',
      'import { Both } from "./rows.ts";\nexport const b = Both;\n',
      'import { Row } from "./elsewhere.ts";\nexport const r = Row;\n',
      '// import { Row } from "./rows.ts";\nexport const a = 1;\n',
    ]) {
      const w = project({ "index.html": "<script type='module' src='app.ts'></script>", "rows.ts": rows, "app.ts": app });
      const r = /** @type {any} */ (w.publish({ title: "Rows", folder: "app" }));
      assert.equal(r.ok, true, `${app}: ${r.error}`);
    }
  });
});
