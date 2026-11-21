// @ts-check
// The shelf (the Space Apps plan of 10-29, "Runtime and offline"; the owner's "finish the space work fully"): the
// browser libraries every artifact's address serves at `/_filament/lib/` — Preact with htm, Chart.js, d3, three.js and
// a few of its addons, marked, DOMPurify — so an app's page loads them with no network. Built by
// scripts/vendor-shelf.mjs at the exact versions it names, each folder with its licences; the artifact guide names each
// by its path, and only the files the shelf lists are served.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SHELF_AT, SHELF_DIR, shelf, shelfPath } from "../src/services/shelf.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createArtifactsHandler } from "../src/http/artifacts.js";
import { ARTIFACT_GUIDE } from "../src/app/agent/artifacts.js";
import { PROMPT_VERSION } from "../src/app/agent/prompt.js";

const libs = shelf().libraries;

describe("the shelf", () => {
  // (fails before: yes — there was no shelf: a page loaded its libraries from a CDN, or drew nothing offline)
  test("it holds the six libraries, each file it names on disk and listed, each folder with its licences at its version", () => {
    assert.deepEqual(libs.map((l) => l.name), ["Preact", "Chart.js", "d3", "three.js", "marked", "DOMPurify"]);
    const named = libs.flatMap((l) => [l.module, ...(l.script ? [l.script] : []), ...(l.addons || [])]);
    for (const f of named) {
      assert.ok(shelf().files.includes(f), `${f} is listed`);
      assert.ok(existsSync(join(SHELF_DIR, ...f.split("/"))), `${f} is on disk`);
    }
    for (const l of libs) {
      const folder = l.module.split("/")[0];
      const licence = readFileSync(join(SHELF_DIR, folder, "LICENSE.txt"), "utf8");
      assert.ok(licence.includes(l.version), `${folder}'s licences name ${l.version}`);
      assert.ok(shelf().files.includes(`${folder}/LICENSE.txt`));
    }
    // The script that builds it names the same versions.
    const script = readFileSync(join(SHELF_DIR, "..", "..", "..", "..", "..", "scripts", "vendor-shelf.mjs"), "utf8");
    for (const l of libs) assert.ok(script.includes(`"${l.version}"`), `vendor-shelf.mjs builds ${l.name} ${l.version}`);
  });

  // (fails before: yes — the same)
  test("each module loads and exports what the guide says it does; three's addons import the shelf's own three", async () => {
    const load = (/** @type {string} */ p) => import(pathToFileURL(join(SHELF_DIR, ...p.split("/"))).href);
    const by = Object.fromEntries(libs.map((l) => [l.name, l]));
    const preact = await load(by.Preact.module);
    for (const n of ["h", "render", "html", "Component", "Fragment", "useState", "useEffect", "useMemo", "useRef"]) assert.ok(n in preact, `preact's ${n}`);
    assert.equal(typeof preact.html`<b>${"x"}</b>`, "object", "htm's tag makes Preact's nodes");
    assert.ok("select" in (await load(by.d3.module)) && "scaleLinear" in (await load(by.d3.module)));
    const marked = await load(by.marked.module);
    assert.equal(marked.marked.parse("# hi *there*").trim(), "<h1>hi <em>there</em></h1>");
    assert.ok("default" in (await load(by.DOMPurify.module)));
    assert.ok("Scene" in (await load(by["three.js"].module)));
    const chart = await load(by["Chart.js"].module);
    assert.ok(chart.Chart && chart.default === chart.Chart, "Chart, the default export too");
    for (const a of by["three.js"].addons || []) {
      const text = readFileSync(join(SHELF_DIR, ...a.split("/")), "utf8");
      assert.ok(/from"\.\/three\.js"/.test(text) && !/class \w+ extends \w+\{constructor\(\)\{super\(\);this\.isScene/.test(text), `${a} imports ./three.js, never a copy of its own`);
    }
  });

  // (fails before: yes — the same)
  test("every artifact's address serves it: its list at its top, each file it lists with a tag asked again by, nothing else", () => {
    const d = mkdtempSync(join(tmpdir(), "filament-shelf-"));
    try {
      const store = createArtifactStore({ dataDir: d, log: () => {} });
      const answer = createArtifactsHandler({ store, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300 });
      const ask = (/** @type {string} */ path, /** @type {Record<string, string>} */ headers = {}) => {
        /** @type {any} */
        const res = { status: 0, headers: {}, body: Buffer.alloc(0), writeHead(/** @type {number} */ s, /** @type {any} */ h) { this.status = s; this.headers = h; }, end(/** @type {any} */ b) { this.body = b ? Buffer.from(b) : Buffer.alloc(0); } };
        answer(/** @type {any} */ ({ method: "GET", headers, socket: { remoteAddress: "127.0.0.1" } }), res, "any-k3f9", new URL(`http://x${path}`));
        return res;
      };
      const top = ask(SHELF_AT);
      assert.equal(top.status, 200);
      const listed = JSON.parse(top.body.toString("utf8")).libraries;
      assert.equal(listed[0].module, `${SHELF_AT}preact@11/preact.js`);
      assert.equal(listed[1].script, `${SHELF_AT}chart.js@4/chart.umd.js`);
      const mod = ask(`${SHELF_AT}preact@11/preact.js`);
      assert.deepEqual([mod.status, mod.headers["content-type"]], [200, "text/javascript; charset=utf-8"]);
      assert.equal(mod.body.length, readFileSync(/** @type {string} */ (shelfPath("preact@11/preact.js"))).length);
      assert.match(mod.headers["content-security-policy"], /^default-src 'none'; /, "the artifact's policy, as every answer");
      assert.equal(ask(`${SHELF_AT}preact@11/preact.js`, { "if-none-match": mod.headers.etag }).status, 304);
      assert.equal(ask(`${SHELF_AT}three@0.186/OrbitControls.js`).status, 200);
      for (const p of ["shelf.json", "README.txt", "../core/shelf.js", "%2e%2e/%2e%2e/server.js", "preact@11/nope.js"]) assert.equal(ask(`${SHELF_AT}${p}`).status, 404, p);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the guide named the CDN hosts alone)
  test("the guide names each library by its path, first; the prompt's version moved with it", () => {
    for (const l of libs) assert.ok(ARTIFACT_GUIDE.page.includes(`import … from "${SHELF_AT}${l.module}"`), l.name);
    assert.ok(ARTIFACT_GUIDE.page.indexOf("Filament's shelf") < ARTIFACT_GUIDE.page.indexOf("Any other library loads at an exact version"));
    assert.match(ARTIFACT_GUIDE.page, /Filament fetches it once as you publish — with what it imports, and a font sheet's fonts — and keeps it in that version, so the page draws offline too/);
    assert.equal(PROMPT_VERSION, 129);
  });
});
