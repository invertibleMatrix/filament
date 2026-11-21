// @ts-check
// The header's Open in button is a menu (the owner's of 11-01: "this button on top bar should be a dropdown and not open
// directly into VS code and add a fourth option there as well which would be open in explorer or finder whatever the os
// platform is"): a press opens the menu and never an editor at once; the menu holds the three editors, the one chosen
// ticked, the folder in the system's file manager — named by the system Filament runs on, as `/api/state` says it — and
// Copy path.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp } from "./helpers/app.js";

const g = /** @type {any} */ (globalThis);
// The page reads `fetch` as its modules load: the header's reads of where a chat works are never answered here.
const realFetch = g.fetch;
g.fetch = () => new Promise(() => {});
/** This browser's preferences: the editor chosen among them. @type {Map<string, string>} */
const kept = new Map();
const hadStorage = g.localStorage;
g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
const { createHeader } = await import("../src/ui/harness/header.js");
const { fileManagerName } = await import("../src/ui/harness/lib/editors.js");

// (fails before: yes — there was no file manager to name)
test("the file manager is named by the system Filament runs on", () => {
  assert.equal(fileManagerName("win32"), "Explorer");
  assert.equal(fileManagerName("darwin"), "Finder");
  assert.equal(fileManagerName("linux"), "file manager");
  assert.equal(fileManagerName(""), "file manager", "not read yet");
  assert.equal(fileManagerName(undefined), "file manager");
});

describe("the header's Open in, in a stand-in page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  /** The editors' addresses the page went to. @type {string[]} */
  const went = [];
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    g.window.open = (/** @type {string} */ url) => void went.push(url);
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    g.fetch = realFetch;
    if (hadStorage === undefined) delete g.localStorage;
    else g.localStorage = hadStorage;
  });
  beforeEach(() => {
    doc.document.body.replaceChildren();
    went.length = 0;
    kept.clear();
  });

  /** The header in the folder, on the system named, and what its menu did. @param {string} folder @param {string} platform */
  const drawn = (folder, platform) => {
    const o = { opened: /** @type {string[]} */ ([]), toasts: /** @type {string[]} */ ([]) };
    const noop = () => {};
    const hd = /** @type {any} */ (createHeader({
      onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, getChat: () => null,
      onToast: (msg) => void o.toasts.push(msg),
      platform: () => platform,
      onOpenFolder: (path) => void o.opened.push(path),
    }));
    doc.document.body.append(hd.el);
    hd.folderIn.value = folder;
    const btn = hd.el.querySelector(".hdr-editor");
    return { o, hd, btn };
  };
  const menuEl = () => /** @type {any} */ (doc.document.body.querySelector(".zc-menu"));
  /** The menu's rows: its label, then each item's words and whether it is ticked. */
  const rows = () => {
    const m = menuEl();
    if (!m) return null;
    return m.children.map((/** @type {any} */ r) =>
      r.classList.contains("zc-menu-label") ? `[${r.textContent}]` : r.classList.contains("zc-menu-sep") ? "—" : `${r.querySelector(".zc-menu-text").textContent}${r.getAttribute("aria-checked") === "true" ? " ✓" : ""}`);
  };
  /** @param {string} words */
  const pick = (words) => menuEl().querySelectorAll(".zc-menu-item").find((/** @type {any} */ r) => r.querySelector(".zc-menu-text").textContent === words).dispatch("click");

  // (fails before: yes — a press went to VS Code at once, and the menu came only on a right-click, without the file manager)
  test("a press opens the menu, no editor: the editors, the one chosen ticked, the folder in Explorer, its path copied", () => {
    const { btn } = drawn("C:/work/app", "win32");
    assert.equal(btn.getAttribute("aria-label"), "Open in");
    assert.equal(btn.getAttribute("aria-haspopup"), "menu");
    btn.dispatch("click");
    assert.deepEqual(went, [], "no editor opened by the press");
    assert.deepEqual(rows(), ["[Open in]", "VS Code ✓", "Cursor", "JetBrains", "—", "Open in Explorer", "Copy path"]);
  });

  // (fails before: yes — no file manager item)
  test("the file manager item opens the folder through Filament; an editor picked is opened and kept as the choice", () => {
    const { o, btn } = drawn("C:/work/app", "win32");
    btn.dispatch("click");
    pick("Open in Explorer");
    assert.deepEqual(o.opened, ["C:/work/app"], "the folder handed to Filament to open");
    assert.deepEqual(went, [], "and no editor");
    assert.equal(menuEl(), null, "the menu closed as it was used");
    btn.dispatch("click");
    pick("Cursor");
    assert.deepEqual(went, ["cursor://file/C%3A/work/app"], "the folder in the editor picked, its path's segments encoded");
    btn.dispatch("click");
    assert.deepEqual(rows()?.slice(1, 4), ["VS Code", "Cursor ✓", "JetBrains"], "the choice kept, as every open button on the page follows it");
  });

  // (fails before: yes — no file manager item, on any system)
  test("on a Mac it is Finder, elsewhere the file manager; a right-click opens the same menu", () => {
    const mac = drawn("/Users/me/app", "darwin");
    mac.btn.dispatch("contextmenu");
    assert.ok(rows()?.includes("Open in Finder"), String(rows()));
    pick("Open in Finder");
    assert.deepEqual(mac.o.opened, ["/Users/me/app"]);
    doc.document.body.replaceChildren();
    const linux = drawn("/home/me/app", "linux");
    linux.btn.dispatch("click");
    assert.ok(rows()?.includes("Open in file manager"), String(rows()));
  });

  // (fails before: yes — no file manager item)
  test("with no folder chosen the file manager item says so and opens nothing", () => {
    const { o, btn } = drawn("", "win32");
    btn.dispatch("click");
    pick("Open in Explorer");
    assert.deepEqual(o.opened, []);
    assert.deepEqual(o.toasts, ["Choose the project folder first"]);
  });

  // (fails before: yes — the review of 11-01: with no folder, Copy path copied nothing and said "Copied", where the rows
  // beside it say to choose the folder first; the chat menu's Copy path did the same)
  test("Copy path, here and in the chat menu: the folder's path copied; with none chosen it says so and copies nothing", async () => {
    /** @type {string[]} */
    const copied = [];
    const had = Object.getOwnPropertyDescriptor(g, "navigator");
    Object.defineProperty(g, "navigator", { configurable: true, writable: true, value: { clipboard: { writeText: (/** @type {string} */ t) => { copied.push(t); return Promise.resolve(); } } } });
    try {
      for (const folder of ["", "C:/work/app"]) {
        doc.document.body.replaceChildren();
        const { o, hd, btn } = drawn(folder, "win32");
        btn.dispatch("click");
        pick("Copy path");
        hd.el.querySelector(".c-title-btn").dispatch("keydown", { key: "Enter", preventDefault() {} });
        pick("Copy path");
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(copied.splice(0), folder ? [folder, folder] : [], folder || "no folder");
        assert.deepEqual(o.toasts, folder ? ["Copied", "Copied"] : ["Choose the project folder first", "Choose the project folder first"], folder || "no folder");
      }
    } finally {
      if (had) Object.defineProperty(g, "navigator", had);
      else delete g.navigator;
    }
  });
});

// (fails before: yes — /api/state did not say the system)
test("/api/state says the system Filament runs on, in Node's names", async () => {
  const shim = await startApp();
  try {
    const st = await (await realFetch(`${shim.url}/api/state`, { headers: shim.headers })).json();
    assert.equal(st.platform, process.platform);
  } finally {
    await shim.stop();
  }
});
