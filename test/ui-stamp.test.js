// @ts-check
// The UI's files kept by the browser across opens (the slowness of 11-02: every open of a chat asked for its 329 module
// files and styles anew, 11 MB, each with `no-cache` and nothing to check it against, through the six connections the
// page's reads wait on). A page names its own files under a stamp of the files as they stand (`/ui/b/<stamp>/…`): a file
// asked under the stamp of now is kept for good (`immutable`), one asked under another stamp is checked each time, and
// a file that changes changes the stamp, so the next page asks for it anew.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStatic, uiStamp } from "../src/http/static.js";
import { startApp } from "./helpers/app.js";

/**
 * What the pages' server answers a path: its status, its heads and its body.
 * @param {string} path
 */
const served = async (path) => {
  /** @type {{ status: number, heads: Record<string, string>, body: string }} */
  const out = { status: 0, heads: {}, body: "" };
  await serveStatic(
    /** @type {any} */ ({
      writeHead: (/** @type {number} */ s, /** @type {any} */ h = {}) => {
        out.status = s;
        out.heads = h;
      },
      end: (/** @type {any} */ b) => (out.body = b == null ? "" : String(b)),
      setHeader() {},
      writableEnded: false,
      destroyed: false,
    }),
    path,
    20300,
  );
  return out;
};

// (fails before: yes — the page named its files at /ui/…, each answered `no-cache`)
test("a page names its own files under the stamp of now, and a file asked under it is kept for good", async () => {
  const page = await served("/ui/harness.html");
  assert.equal(page.status, 200);
  assert.equal(page.heads["cache-control"], "no-cache", "the page itself is checked each time: it names the stamp");
  const stamp = await uiStamp();
  assert.match(stamp, /^[0-9a-f]{12}$/);
  assert.ok(page.body.includes(`<script type="module" src="/ui/b/${stamp}/harness/app.js"></script>`), "its script under the stamp");
  assert.ok(page.body.includes(`<link rel="stylesheet" href="/ui/b/${stamp}/harness.css" />`), "its styles under the stamp");
  assert.ok(!/(?:src|href)="\/ui\/(?!b\/)/.test(page.body), "nothing of its own named without it");
  const app = await served(`/ui/b/${stamp}/harness/app.js`);
  assert.equal(app.status, 200);
  assert.equal(app.heads["cache-control"], "private, max-age=31536000, immutable");
  assert.equal(app.body, (await served("/ui/harness/app.js")).body, "the same bytes as its plain address");
  // A module the page imports is named relative to it: it is under the stamp too, and kept.
  assert.equal((await served(`/ui/b/${stamp}/lib/dom.js`)).heads["cache-control"], "private, max-age=31536000, immutable");
  assert.equal((await served(`/ui/b/${stamp}/nothing-here.js`)).status, 404);
  // Under another stamp — a page served before a file changed — it is checked each time, never kept.
  const old = await served("/ui/b/000000000000/harness/app.js");
  assert.equal(old.status, 200);
  assert.equal(old.heads["cache-control"], "no-cache");
  assert.equal((await served("/ui/harness/app.js")).heads["cache-control"], "no-cache", "its plain address as before");
  assert.equal((await served(`/ui/b/${stamp}/../harness.html`)).status, 400, "no way out of the folder");
});

test("the stamp follows the files: one written, grown or touched changes it; nothing changed, it stays", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ui-stamp-"));
  try {
    writeFileSync(join(dir, "a.js"), "export const a = 1;\n");
    const first = await uiStamp(dir);
    assert.equal(await uiStamp(dir), first, "nothing changed");
    writeFileSync(join(dir, "a.js"), "export const a = 22;\n");
    const grown = await uiStamp(dir);
    assert.notEqual(grown, first, "a file changed");
    utimesSync(join(dir, "a.js"), new Date(), new Date(Date.now() + 5_000));
    const touched = await uiStamp(dir);
    assert.notEqual(touched, grown, "its time moved");
    writeFileSync(join(dir, "b.css"), "body{}\n");
    const added = await uiStamp(dir);
    assert.notEqual(added, touched, "a file added");
    // A module deep in a subfolder, as the harness's are (the review of 11-02).
    mkdirSync(join(dir, "harness", "lib"), { recursive: true });
    writeFileSync(join(dir, "harness", "lib", "c.js"), "export const c = 1;\n");
    const deep = await uiStamp(dir);
    assert.notEqual(deep, added, "a file added in a subfolder");
    writeFileSync(join(dir, "harness", "lib", "c.js"), "export const c = 12;\n");
    assert.notEqual(await uiStamp(dir), deep, "a file in a subfolder changed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("through the front door: the harness and the console name their files under the stamp, and a stamped file is kept", async () => {
  const t = await startApp();
  try {
    for (const path of ["/ui/harness.html", "/", "/ui/tray-card.html"]) {
      const r = await fetch(t.url + path);
      assert.equal(r.status, 200, path);
      assert.equal(r.headers.get("content-security-policy"), `frame-src http://*.art.localhost:${t.port}; frame-ancestors 'self'`, path);
      const html = await r.text();
      const m = html.match(/src="\/ui\/b\/([0-9a-f]{12})\//);
      assert.ok(m, path);
      const css = await fetch(`${t.url}/ui/b/${m[1]}/harness.css`);
      assert.equal(css.status, 200);
      assert.equal(css.headers.get("cache-control"), "private, max-age=31536000, immutable");
      assert.match(String(css.headers.get("content-type")), /^text\/css/);
    }
  } finally {
    await t.stop();
  }
});
