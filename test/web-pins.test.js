// @ts-check
// Vendor on publish (the Space Apps plan of 10-29, "Runtime and offline"; the owner's "finish the space work fully"): a
// library a page names from a CDN host is fetched once as it is published — with what it imports, and a font sheet's
// fonts — and kept in that version under `_filament/web/`, so the page draws offline. The page's own files stay as the
// agent wrote them; its address serves them pointed at what was kept, a download writes them so too, and `read` says
// what was kept in a line. What could not be fetched is said, and still loads from the web.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createArtifactStore } from "../src/services/artifacts.js";
import { artifactCall, pinnedFor } from "../src/app/agent/artifacts.js";
import { servedPage } from "../src/core/artifacts.js";
import { PINS_FILE, relativeRef, webAddressesIn } from "../src/core/web-pins.js";
import { createWebPins, keptPathOf } from "../src/services/web-pins.js";
import { createArtifactsHandler } from "../src/http/artifacts.js";
import { downloadOf } from "../src/http/admin/artifacts.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-web-pins-"));
  dirs.push(d);
  return d;
};

const CONFETTI = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js";
const PREACT = "https://esm.sh/preact@10.19.3";
const FONTS_AS_WRITTEN = "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap";
/** What each address answers, as the library hosts would. @type {Record<string, { type: string, body: string, status?: number, url?: string }>} */
const WEB = {
  [CONFETTI]: { type: "application/javascript; charset=utf-8", body: "window.confetti=function(){return 'boom'};" },
  [PREACT]: { type: "application/javascript; charset=utf-8", body: 'export * from "/stable/preact@10.19.3/es2022/preact.mjs";\nexport { default } from "/stable/preact@10.19.3/es2022/preact.mjs";' },
  "https://esm.sh/stable/preact@10.19.3/es2022/preact.mjs": { type: "application/javascript; charset=utf-8", body: "export const h=()=>1;export default h;" },
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap": { type: "text/css; charset=utf-8", body: "@font-face{font-family:Inter;src:url(https://fonts.gstatic.com/s/inter/v13/a.woff2) format('woff2')}" },
  "https://fonts.gstatic.com/s/inter/v13/a.woff2": { type: "font/woff2", body: "wOF2-bytes" },
};

/** A fetch that answers from `web` alone, and says what it was asked. @param {Record<string, any>} web */
function webOf(web) {
  /** @type {string[]} */
  const asked = [];
  /** @type {any} */
  const fetch = async (/** @type {string} */ url) => {
    asked.push(String(url));
    const it = web[String(url)];
    if (!it) return new Response("nope", { status: 404 });
    const res = new Response(it.body, { status: it.status ?? 200, headers: { "content-type": it.type } });
    if (it.url) Object.defineProperty(res, "url", { value: it.url });
    return res;
  };
  return { fetch, asked };
}

const PAGE = `<!doctype html><html><head><link rel="stylesheet" href="${FONTS_AS_WRITTEN}"><script src="${CONFETTI}"></script></head>
<body><script type="module">import { h } from "${PREACT}"; document.body.append(String(h()) + confetti());</script></body></html>`;

/** A store and a session's place in it, its publishes made with what `web` answers. @param {Record<string, any>} [web] */
function world(web = WEB) {
  const root = fresh();
  const store = createArtifactStore({ dataDir: fresh(), log: () => {}, four: () => "k3f9" });
  const at = { who: "c1", by: { chain: "c1", model: "m", folder: root, helper: null }, within: [root], port: 20300, maxBytes: 5_000_000 };
  const net = webOf(web);
  const pins = createWebPins({ dir: join(store.dir, "..", "web-pins-test"), fetch: net.fetch });
  /** @param {any} input */
  const publish = async (input) => {
    const call = { action: "publish", ...input };
    return artifactCall(call, { ...at, pinned: await ownPinned(call) }, store);
  };
  /** What the call's page names, fetched by this test's web (`pinnedFor` with a fetcher of its own). @param {any} call */
  const ownPinned = async (call) => {
    const texts = [call.html, ...(call.files || []).map((/** @type {any} */ f) => f.content)].filter((t) => typeof t === "string");
    const addresses = [...new Set(texts.flatMap(webAddressesIn))];
    return addresses.length ? pins.pin(addresses) : null;
  };
  const answer = createArtifactsHandler({ store, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300 });
  const ask = (/** @type {string} */ name, /** @type {string} */ path) => {
    /** @type {any} */
    const res = { status: 0, headers: {}, body: Buffer.alloc(0), writeHead(/** @type {number} */ s, /** @type {any} */ h) { this.status = s; this.headers = h; }, end(/** @type {any} */ b) { this.body = b ? Buffer.from(b) : Buffer.alloc(0); } };
    answer(/** @type {any} */ ({ method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } }), res, name, new URL(`http://x${path}`));
    return { status: res.status, type: String(res.headers["content-type"] || ""), text: res.body.toString("utf8") };
  };
  return { root, store, at, net, pins, publish, ask };
}

/** A .zip's entries by name, each inflated. @param {Buffer} zip */
const unzip = (zip) => {
  const end = zip.length - 22;
  let at = zip.readUInt32LE(end + 16);
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const [n, extra, note] = [28, 30, 32].map((o) => zip.readUInt16LE(at + o));
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + n).toString("utf8");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + packed);
    out[name] = (method === 8 ? inflateRawSync(body) : body).toString("utf8");
    at += 46 + n + extra + note;
  }
  return out;
};

describe("a page's libraries from the web, kept as it is published", () => {
  // (fails before: yes — nothing was fetched: the page named the CDN, and drew nothing offline)
  test("each library is kept in the version with what it imports; the page's file stays as written; its address points it at what was kept", async () => {
    const w = world();
    const r = await w.publish({ title: "Party", html: PAGE });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.match(r.ok ? r.text : "", /Kept in this version from the web, so it draws offline: css2\?… \(fonts\.googleapis\.com\), confetti\.browser\.min\.js \(cdn\.jsdelivr\.net\), preact@10\.19\.3 \(esm\.sh\) — 5 files, /);
    assert.match(r.ok ? r.text : "", /^Published Party v1 at http:\/\/party-k3f9\.art\.localhost:20300\/ \(\d+ bytes\)/, "its own files alone are counted");
    assert.ok(w.net.asked.includes("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"), "an attribute's &amp; is fetched as &");
    const a = /** @type {any} */ (w.store.get("party-k3f9"));
    const paths = a.versions[0].files.map((/** @type {any} */ f) => f.path).sort();
    assert.deepEqual(paths, [
      "_filament/web/cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js",
      "_filament/web/esm.sh/preact@10.19.3.js",
      "_filament/web/esm.sh/stable/preact@10.19.3/es2022/preact.mjs",
      `_filament/web/fonts.googleapis.com/css2~${/~([0-9a-f]{8})\.css$/.exec(paths.find((/** @type {string} */ p) => p.includes("css2")) || "")?.[1]}.css`,
      "_filament/web/fonts.gstatic.com/s/inter/v13/a.woff2",
      PINS_FILE,
      "index.html",
    ]);
    assert.equal(String(w.store.file(a.name, 1, "index.html")), PAGE, "the page as the agent wrote it");
    // What a kept file names points at the file kept beside it.
    assert.equal(String(w.store.file(a.name, 1, "_filament/web/esm.sh/preact@10.19.3.js")), 'export * from "./stable/preact@10.19.3/es2022/preact.mjs";\nexport { default } from "./stable/preact@10.19.3/es2022/preact.mjs";');
    const sheet = paths.find((/** @type {string} */ p) => p.includes("css2"));
    assert.equal(String(w.store.file(a.name, 1, String(sheet))), "@font-face{font-family:Inter;src:url(../fonts.gstatic.com/s/inter/v13/a.woff2) format('woff2')}");
    // Its address serves the page pointed at them, and each of them.
    const page = w.ask(a.name, "/");
    assert.equal(page.status, 200);
    assert.ok(!/https:\/\/(?:cdn\.jsdelivr\.net|esm\.sh|fonts\.googleapis\.com)/.test(page.text), page.text);
    assert.ok(page.text.includes(`src="/_filament/v/1/_filament/web/cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"`), page.text);
    assert.ok(page.text.includes(`import { h } from "/_filament/v/1/_filament/web/esm.sh/preact@10.19.3.js"`), page.text);
    const lib = w.ask(a.name, "/_filament/v/1/_filament/web/cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js");
    assert.deepEqual([lib.status, lib.type, lib.text], [200, "text/javascript; charset=utf-8", WEB[CONFETTI].body]);
    assert.deepEqual([w.ask(a.name, "/_filament/web/fonts.gstatic.com/s/inter/v13/a.woff2").status, w.ask(a.name, "/_filament/web/fonts.gstatic.com/s/inter/v13/a.woff2").type], [200, "font/woff2"]);
    assert.equal(w.ask(a.name, "/_filament/other").status, 404, "the rest of Filament's prefix is still none of the page's");
  });

  // (fails before: yes — the same)
  test("an old version keeps what it kept: a next version without the library serves none, the old one still its own", async () => {
    const w = world();
    assert.equal((await w.publish({ title: "Party", html: PAGE })).ok, true);
    const r = await w.publish({ id: "party-k3f9", html: "<p>plain now</p>" });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.ok(!(r.ok ? r.text : "").includes("Kept in this version"), "nothing named, nothing kept");
    assert.equal(w.ask("party-k3f9", "/").text, servedPage("<p>plain now</p>", "Party"));
    assert.equal(w.ask("party-k3f9", "/_filament/web/esm.sh/preact@10.19.3.js").status, 404);
    const old = w.ask("party-k3f9", "/_filament/v/1/");
    assert.ok(old.text.includes('"/_filament/v/1/_filament/web/esm.sh/preact@10.19.3.js"'), old.text);
    assert.equal(w.ask("party-k3f9", "/_filament/v/1/_filament/web/esm.sh/preact@10.19.3.js").status, 200);
  });

  // (fails before: yes — the same)
  test("what could not be kept is said, why, and still loads from the web", async () => {
    const w = world({
      ...WEB,
      "https://unpkg.com/away@1.0.0/x.js": { type: "text/javascript", body: "x", url: "https://elsewhere.example/x.js" },
    });
    const html = `<script src="https://cdn.jsdelivr.net/npm/gone@1.0.0/x.js"></script><script src="https://unpkg.com/away@1.0.0/x.js"></script><script src="${CONFETTI}"></script>`;
    const r = await w.publish({ title: "Party", html });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const text = r.ok ? r.text : "";
    assert.match(text, /Kept in this version from the web, so it draws offline: confetti\.browser\.min\.js \(cdn\.jsdelivr\.net\) — 1 file, /);
    assert.match(text, /Not kept, so they load from the web: https:\/\/cdn\.jsdelivr\.net\/npm\/gone@1\.0\.0\/x\.js \(cdn\.jsdelivr\.net answered 404\), https:\/\/unpkg\.com\/away@1\.0\.0\/x\.js \(it led to elsewhere\.example, which is no library host\)\./);
    const page = w.ask("party-k3f9", "/").text;
    assert.ok(page.includes('src="https://cdn.jsdelivr.net/npm/gone@1.0.0/x.js"') && page.includes('src="https://unpkg.com/away@1.0.0/x.js"'), "those stay as written");
    assert.ok(page.includes('src="/_filament/v/1/_filament/web/cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"'));
  });

  // (fails before: yes — the same)
  test("a file fetched once is kept by its address: a later publish with no network keeps the same bytes", async () => {
    const w = world();
    assert.equal((await w.publish({ title: "Party", html: PAGE })).ok, true);
    const before = w.net.asked.length;
    const offline = createWebPins({ dir: join(w.store.dir, "..", "web-pins-test"), fetch: /** @type {any} */ (async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }); }) });
    const again = await offline.pin([CONFETTI, PREACT]);
    assert.deepEqual(again.failed, []);
    assert.deepEqual(Object.keys(again.pins), [CONFETTI, PREACT]);
    assert.equal(again.files.length, 3, "the import kept beside it, from what was kept");
    assert.equal(w.net.asked.length, before);
    const none = await createWebPins({ dir: fresh(), fetch: /** @type {any} */ (async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }); }) }).pin([CONFETTI]);
    assert.deepEqual(none.failed, [{ address: CONFETTI, why: "it could not be fetched (ENOTFOUND)" }]);
  });

  // (fails before: yes — the same)
  test("read says what was kept in a line, never as its files; a download points the page at the files in the .zip", async () => {
    const w = world();
    assert.equal((await w.publish({ title: "Party", html: PAGE })).ok, true);
    const read = artifactCall({ action: "read", id: "party-k3f9" }, w.at, w.store);
    const text = read.ok ? read.text : "";
    assert.match(text, /\nKept from the web as it was published: 5 files, \d+ bytes, for the library addresses its files name, which it loads from here, offline too\./);
    assert.ok(!text.includes("--- _filament/"), text);
    assert.ok(text.includes(`--- index.html (${PAGE.length} characters) ---\n${PAGE}`));
    const a = /** @type {any} */ (w.store.get("party-k3f9"));
    const d = downloadOf(a, 1, /** @type {any} */ (w.store.files(a.name, 1)));
    assert.equal(d.file, "party-k3f9.zip");
    const zip = unzip(d.data);
    assert.ok(zip["index.html"].includes('src="./_filament/web/cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"'), zip["index.html"]);
    assert.equal(zip["_filament/web/cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"], WEB[CONFETTI].body);
  });

  // (fails before: yes — the same)
  test("a folder's page and scripts are read for what they name, before the call", async () => {
    const w = world();
    mkdirSync(join(w.root, "app"), { recursive: true });
    writeFileSync(join(w.root, "app", "index.html"), '<script type="module" src="main.js"></script>');
    writeFileSync(join(w.root, "app", "main.js"), `import { h } from "${PREACT}";\nconsole.log(h());`);
    writeFileSync(join(w.root, "app", "data.json"), JSON.stringify({ see: CONFETTI }));
    // The module's own fetcher, pointed at this test's web.
    const real = globalThis.fetch;
    const net = webOf(WEB);
    globalThis.fetch = net.fetch;
    try {
      const pinned = await pinnedFor({ action: "publish", title: "Folder", folder: "app" }, w.at, w.store);
      assert.deepEqual(Object.keys(pinned?.pins || {}), [PREACT], "a page's scripts are read; its data is not");
      const r = artifactCall({ action: "publish", title: "Folder", folder: "app" }, { ...w.at, pinned }, w.store);
      assert.equal(r.ok, true, r.ok ? "" : r.error);
      assert.ok(w.ask("folder-k3f9", "/main.js").text.startsWith('import { h } from "/_filament/v/1/_filament/web/esm.sh/preact@10.19.3.js";'));
      assert.equal(await pinnedFor({ action: "read", id: "folder-k3f9" }, w.at, w.store), null, "only a publish fetches");
      assert.equal(await pinnedFor({ action: "publish", type: "doc", title: "D", markdown: `![x](${CONFETTI})` }, w.at, w.store), null, "a doc's Markdown is drawn by Filament");
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("what a page names from the web, in words and paths", () => {
  test("only the library hosts' addresses, as written, each once; one a template builds is none", () => {
    const text = `a ${CONFETTI}. b https://example.com/x.js c \`https://cdn.jsdelivr.net/npm/\${name}@1/x.js\` d ${CONFETTI} url(https://fonts.gstatic.com/s/a.woff2)`;
    assert.deepEqual(webAddressesIn(text), [CONFETTI, "https://fonts.gstatic.com/s/a.woff2"]);
  });

  test("a kept file's path: its host and path, its type's extension where its own does not say it, a query hashed", () => {
    assert.equal(keptPathOf(new URL("https://cdn.jsdelivr.net/npm/d3@7/+esm"), "application/javascript"), "cdn.jsdelivr.net/npm/d3@7/+esm.js");
    assert.equal(keptPathOf(new URL("https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"), "application/javascript; charset=utf-8"), "cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js");
    assert.equal(keptPathOf(new URL("https://esm.sh/x@1/es2022/x.mjs"), "application/javascript"), "esm.sh/x@1/es2022/x.mjs");
    assert.match(keptPathOf(new URL("https://unpkg.com/x@1/?module"), "text/javascript"), /^unpkg\.com\/x@1\/index~[0-9a-f]{8}\.js$/);
    assert.equal(relativeRef("a/b/c.js", "a/d.js"), "../d.js");
    assert.equal(relativeRef("a/c.js", "a/b/d.js"), "./b/d.js");
    assert.equal(relativeRef("index.html", "_filament/web/x.js"), "./_filament/web/x.js");
  });

  test("a publish keeps no more than its limit of files, and says so", async () => {
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`https://unpkg.com/m${i}@1/x.js`, { type: "text/javascript", body: `export const n=${i};` }]));
    const r = await createWebPins({ dir: fresh(), fetch: webOf(many).fetch, limits: { files: 3, atOnce: 1 } }).pin(Object.keys(many));
    assert.equal(r.files.length, 3);
    assert.deepEqual(r.failed.map((f) => f.why), ["the page names more than 3 files to keep", "the page names more than 3 files to keep"]);
  });
});
