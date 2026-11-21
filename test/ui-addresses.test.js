// @ts-check
// The pages' addresses (HarnessV4_Tasks C23; HarnessV4_Overnight_Plan OV-D30, OV-D31): a folder under /ui is not found,
// in words, and nothing is answered before a file's bytes are read; the pages, the console's address and the docs are
// served as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serveDoc, serveStatic } from "../src/http/static.js";
import { startApp } from "./helpers/app.js";

/**
 * What the pages' server answers a path, on a response that records its heads and its body.
 * @param {(res: any, path: string, port: number) => unknown} serve @param {string} path
 */
const served = async (serve, path) => {
  /** @type {number[]} */
  const heads = [];
  /** @type {any} */
  let body = null;
  // A page is answered once its files' stamp is read (static.js `uiStamp`).
  await serve({ writeHead: (/** @type {number} */ s) => heads.push(s), end: (/** @type {any} */ b) => (body = b), setHeader() {}, writableEnded: false, destroyed: false }, path, 20300);
  return { heads, body: body == null ? "" : String(body) };
};

test("a folder under /ui is not found, in words, and no 200 is answered before it (fails before: yes — its head went out as 200, then its read threw)", async () => {
  for (const path of ["/ui/harness", "/ui/pages", "/ui/harness/lib", "/ui/."]) {
    const r = await served(serveStatic, path);
    assert.deepEqual(r.heads, [404], path);
    assert.equal(JSON.parse(r.body).error, `not found: ${path} is a folder, not a page`);
  }
});

test("a name not on disk is not found, as before; a page and a script are answered once, with their bytes (fails before: no)", async () => {
  const missing = await served(serveStatic, "/ui/nothing-here.js");
  assert.deepEqual(missing.heads, [404]);
  assert.equal(JSON.parse(missing.body).error, "not found");
  for (const path of ["/", "/ui", "/ui/index.html", "/ui/harness.html", "/ui//harness.html", "/ui/harness/app.js"]) {
    const r = await served(serveStatic, path);
    assert.deepEqual(r.heads, [200], path);
    assert.ok(r.body.length > 100, path);
  }
});

// (fails before: yes — the bug hunt of 10-30, HTTP-2: the cache was keyed by the path as asked, so on Windows each case
// of a file's name, and its stream spelled out, held another copy of its bytes, and /ui answers anyone who asks)
test("a file is held once, however its address spells it: another case of its name or its stream adds nothing", { skip: process.platform !== "win32" && "a name answers in another case on Windows alone" }, async () => {
  const size = (await served(serveStatic, "/ui/harness/vendor/mermaid/mermaid.mjs")).body.length;
  assert.ok(size > 1_000_000, "a big file, so a copy shows");
  const before = process.memoryUsage().arrayBuffers;
  const spellings = ["MERMAID.mjs", "Mermaid.mjs", "mErmaid.mjs", "meRmaid.mjs", "merMaid.mjs", "mermAid.mjs", "mermaId.mjs", "mermaiD.mjs", "mermaid.MJS", "MeRmAiD.MjS", "mermaid.mjs::$DATA"];
  for (const name of spellings) assert.deepEqual((await served(serveStatic, `/ui/HARNESS/vendor/mermaid/${name}`)).heads, [200], name);
  const grew = process.memoryUsage().arrayBuffers - before;
  assert.ok(grew < size, `${spellings.length} spellings held ${Math.round(grew / 1e6)} MB more, a file of ${Math.round(size / 1e6)} MB`);
});

test("the docs: a doc is read before its head; a missing one is not found (fails before: no)", async () => {
  const doc = await served(serveDoc, "/docs/ARCHITECTURE.md");
  assert.deepEqual(doc.heads, [200]);
  assert.match(doc.body, /^# /m);
  const missing = await served(serveDoc, "/docs/NO-SUCH-DOC.md");
  assert.deepEqual(missing.heads, [404]);
});

test("through the front door: a folder's address, with or without its slash, is a 404 in words; the console and the harness are served (fails before: yes — 200 with 0 bytes)", async () => {
  const t = await startApp();
  try {
    for (const path of ["/ui/harness/", "/ui/harness", "/ui/pages"]) {
      const r = await fetch(t.url + path);
      assert.equal(r.status, 404, path);
      assert.match((await r.json()).error, /is a folder, not a page$/, path);
    }
    for (const path of ["/", "/ui", "/ui/", "/ui/harness.html"]) {
      const r = await fetch(t.url + path);
      assert.equal(r.status, 200, path);
      assert.match(String(r.headers.get("content-type")), /^text\/html/, path);
      assert.equal(r.headers.get("content-security-policy"), `frame-src http://*.art.localhost:${t.port}; frame-ancestors 'self'`, path);
      assert.ok((await r.text()).length > 100, path);
    }
  } finally {
    await t.stop();
  }
});
