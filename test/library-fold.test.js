// @ts-check
// The Library at the foot of the left bar folds as Now does (the owner's word of 10-26, the Designer's of the same
// day): open at first, its head a button with the chevron at its right, the state kept across loads and never undone by
// itself; folded, its head alone carries the mark of the Library page open.
// (fails before: yes — the Library's head was a plain line, its six rows always shown)
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { state } from "../src/ui/harness/state.js";

/** @param {(sb: any, host: any, kept: Map<string, string>, opened: string[]) => Promise<void>} body @param {Map<string, string>} [kept] */
async function withSidebar(body, kept = new Map()) {
  const doc = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  g.EventSource = class { addEventListener() {} close() {} };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { kept.set(k, v); }, removeItem: (/** @type {string} */ k) => { kept.delete(k); } };
  g.fetch = async () => ({ ok: true, status: 200, json: async () => ({ sessions: [], projects: [], runs: [] }) });
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    /** @type {string[]} */
    const opened = [];
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onLibrary: (page) => { opened.push(page); } });
    await body(sb, host, kept, opened);
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
}

/** @param {any} el @param {string} cls @returns {any[]} */
const allOf = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((c) => allOf(c, cls))];
const footOf = (/** @type {any} */ host) => allOf(host, "lb-foot")[0];
const headOf = (/** @type {any} */ host) => allOf(footOf(host), "lib-head")[0];
const rowsOf = (/** @type {any} */ host) => allOf(footOf(host), "lib-row").map((r) => allOf(r, "lib-label")[0].textContent);

test("the Library folds from its head, stays folded, and its folded head marks the Library page open", async () => {
  await withSidebar(async (sb, host, kept, opened) => {
    const head = headOf(host);
    assert.equal(head.tagName, "BUTTON");
    assert.deepEqual([head.getAttribute("aria-expanded"), head.getAttribute("title")], ["true", "Fold Library"], "open at first");
    // Plugins and Connectors are one row since the owner's of 11-09. Settings › Experimental's Teams switch off, as it
    // ships: the first row is Agents; on, Agents and teams, and off again Agents (the owner's of 11-17).
    assert.deepEqual(rowsOf(host), ["Agents", "Skills", "Memory", "Plugins & Connectors", "Artifacts"]);
    const config = state.config;
    try {
      state.config = { experimental: { teams: true } };
      sb.teamsSwitched();
      assert.deepEqual(rowsOf(host), ["Agents and teams", "Skills", "Memory", "Plugins & Connectors", "Artifacts"]);
      state.config = { experimental: { teams: false } };
      sb.teamsSwitched();
      assert.equal(rowsOf(host)[0], "Agents");
    } finally {
      state.config = config;
    }
    allOf(footOf(host), "lib-row")[4].dispatch("click");
    assert.deepEqual(opened, ["artifacts"]);

    head.dispatch("click");
    assert.deepEqual([head.getAttribute("aria-expanded"), head.getAttribute("title"), kept.get("harness.sidebar.libraryOpen")], ["false", "Show Library", "0"]);
    assert.deepEqual(rowsOf(host), [], "folded: the head alone");
    assert.equal(head.classList.contains("on"), false, "no Library page open: no mark");

    sb.atLibrary("artifacts");
    assert.deepEqual([head.classList.contains("on"), head.getAttribute("aria-current")], [true, "page"], "folded, the head is lit while a Library page is open");
    assert.deepEqual(rowsOf(host), [], "and it does not open by itself");
    sb.atLibrary(null);
    assert.deepEqual([head.classList.contains("on"), head.getAttribute("aria-current")], [false, null]);

    sb.atLibrary("plugins");
    head.dispatch("click");
    assert.deepEqual([head.getAttribute("aria-expanded"), kept.get("harness.sidebar.libraryOpen")], ["true", "1"]);
    assert.equal(head.classList.contains("on"), false, "open, the row carries the mark, not the head");
    const plugins = allOf(footOf(host), "lib-row")[3];
    assert.deepEqual([plugins.classList.contains("on"), plugins.getAttribute("aria-current")], [true, "page"]);
  });
});

test("folded once, the Library opens folded on the next load", async () => {
  await withSidebar(async (_sb, host) => {
    assert.equal(headOf(host).getAttribute("aria-expanded"), "false");
    assert.deepEqual(rowsOf(host), []);
  }, new Map([["harness.sidebar.libraryOpen", "0"]]));
});
