// @ts-check
// An app published from its folder (the Space Apps plan of 10-29, "app folders"; the owner's "finish the space work
// fully"): Filament reads the folder's app.json itself — what the app is called, what it reads and what its buttons run —,
// the call's own fields winning, so "publish .filament/apps/pipeline" is the whole call; and a .ts file of a page or an
// app has its types taken out as it is published, so the browser runs it with no build step.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../src/services/artifacts.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { CONTENT_JSON, artifactTypeOf, isTextFile } from "../src/core/artifacts.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-app-folder-"));
  dirs.push(d);
  return d;
};

const APP_JSON = {
  type: "app",
  title: "Ticker",
  description: "Ticks, and says how far it got",
  icon: "rocket",
  folder: "ignored/by/filament",
  sources: { one: { command: ["node", "app/reads/one.mjs"], rows: "rows", key: "key" } },
  actions: { tick: { label: "Tick…", on: "one", command: ["node", "app/actions/tick.mjs"], says: "Tick?" } },
};
const TS = "interface Row { key: string }\nexport const keyOf = (r: Row): string => r.key;\n";

/** A project folder whose app/ holds a page, an app.json and a .ts beside it. @param {Record<string, string>} [more] */
function project(more = {}) {
  const root = fresh();
  mkdirSync(join(root, "app"), { recursive: true });
  const files = { "index.html": '<!doctype html><title>T</title><script type="module" src="app.ts"></script>', "app.json": JSON.stringify(APP_JSON), "app.ts": TS, ...more };
  for (const [p, data] of Object.entries(files)) writeFileSync(join(root, "app", p), data);
  const store = createArtifactStore({ dataDir: fresh(), log: () => {}, four: () => "ab12" });
  /** @param {any} input */
  const publish = (input) => artifactCall({ action: "publish", ...input }, { who: "c1", by: { chain: "c1", model: "m", folder: root, helper: null }, within: [root], port: 20300, maxBytes: 1_000_000 }, store);
  return { root, store, publish };
}
/** @param {any} store @param {string} name @param {number} v @param {string} path */
const fileOf = (store, name, v, path) => String(store.file(name, v, path) ?? "");

describe("an app published from its folder", () => {
  // (fails before: yes — the call had to repeat app.json's fields, and without a title or a type it was refused)
  test("folder alone: app.json says its title, words, icon, reads and buttons; app.json itself is not one of its files", () => {
    const w = project();
    const r = w.publish({ folder: "app" });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const a = /** @type {any} */ (w.store.get("ticker-ab12"));
    assert.deepEqual([a.type, a.title, a.description, a.icon], ["app", "Ticker", "Ticks, and says how far it got", "rocket"]);
    assert.deepEqual(JSON.parse(fileOf(w.store, a.name, 1, CONTENT_JSON)), { sources: APP_JSON.sources, actions: APP_JSON.actions });
    assert.deepEqual(a.versions[0].files.map((/** @type {any} */ f) => f.path).sort(), ["app.ts", CONTENT_JSON, "index.html"].sort());
  });

  test("the call's own fields win; a next version by id and folder reads app.json again", () => {
    const w = project();
    assert.equal(w.publish({ folder: "app", title: "My ticker", actions: { stop: { label: "Stop…", on: "one", command: ["node", "x.mjs"], says: "Stop?" } } }).ok, true);
    const a = /** @type {any} */ (w.store.get("my-ticker-ab12"));
    assert.equal(a.title, "My ticker");
    assert.deepEqual(Object.keys(JSON.parse(fileOf(w.store, a.name, 1, CONTENT_JSON)).actions), ["stop"]);
    writeFileSync(join(w.root, "app", "app.json"), JSON.stringify({ ...APP_JSON, title: undefined, actions: { ...APP_JSON.actions, again: { ...APP_JSON.actions.tick, label: "Again…" } } }));
    const next = w.publish({ id: a.name, folder: "app" });
    assert.equal(next.ok, true, next.ok ? "" : next.error);
    assert.deepEqual(Object.keys(JSON.parse(fileOf(w.store, a.name, 2, CONTENT_JSON)).actions), ["tick", "again"]);
    assert.equal(/** @type {any} */ (w.store.get(a.name)).title, "My ticker", "app.json without a title leaves it");
  });

  test("a page's folder with an app.json stays a page where the call says so, app.json a file of it", () => {
    const w = project();
    const r = w.publish({ type: "page", title: "Plain", folder: "app" });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const a = /** @type {any} */ (w.store.get("plain-ab12"));
    assert.equal(a.type, "page");
    assert.ok(a.versions[0].files.some((/** @type {any} */ f) => f.path === "app.json"));
  });

  test("an app.json that does not read is said, with its folder", () => {
    const w = project({ "app.json": "{ title: Ticker" });
    const r = w.publish({ folder: "app" });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /^Not published: app\/app\.json does not read as JSON \(.+\)\. It says the app: \{ "title", "sources", "watch", "actions" \}\.$/);
    const list = project({ "app.json": "[1]" });
    assert.match(/** @type {any} */ (list.publish({ folder: "app" })).error, /^Not published: app\/app\.json is a list; it is one object: \{ "title", "sources", "watch", "actions" \}\.$/);
  });
});

describe("a .ts file has its types taken out at publish", () => {
  // (fails before: yes — it was kept as written, and the browser would not run it)
  test("a folder's, and one given beside html: kept under its name, plain JavaScript, served as JavaScript", () => {
    const w = project();
    assert.equal(w.publish({ folder: "app" }).ok, true);
    const ts = fileOf(w.store, "ticker-ab12", 1, "app.ts");
    assert.doesNotMatch(ts, /interface|: Row|: string/);
    assert.match(ts, /export const keyOf = \(r\s*\)\s*=> r\.key;/);
    const page = w.publish({ type: "page", title: "Typed", html: "<p>x</p>", files: [{ path: "lib/n.mts", content: "export const n: number = 1;\n" }, { path: "types.d.ts", content: "declare const x: number;\n" }] });
    assert.equal(page.ok, true, page.ok ? "" : page.error);
    assert.match(fileOf(w.store, "typed-ab12", 1, "lib/n.mts"), /^export const n\s+= 1;/);
    assert.equal(fileOf(w.store, "typed-ab12", 1, "types.d.ts"), "declare const x: number;\n", "a declaration file runs nowhere: kept as written");
    assert.equal(artifactTypeOf("app.ts"), "text/javascript; charset=utf-8");
    assert.equal(artifactTypeOf("lib/n.mts"), "text/javascript; charset=utf-8");
    assert.ok(isTextFile("app.ts"), "read shows it");
  });

  test("TypeScript that is more than types — an enum, JSX — is refused, naming the file and why", () => {
    const w = project({ "app.ts": "enum Mode { A, B }\nexport const m = Mode.A;\n" });
    const r = w.publish({ folder: "app" });
    assert.equal(r.ok, false);
    assert.equal(r.ok ? "" : r.error, "Not published: app.ts is TypeScript Filament cannot run by taking its types out (TypeScript enum is not supported in strip-only mode). Write it with types alone — no enum, namespace or JSX —, or publish its built .js.");
  });
});
