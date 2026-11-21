// @ts-check
// The performance Hunter's find of 10-25: the sidebar draws its list anew whole — every five seconds by the page's
// tick, and at every run's mark and holder that moves —, and a row replaced while a pointer was down on it lost its
// click: the click goes to what the press and the release share, no longer the row, so a press that spanned a redraw
// did nothing and had to be made again. A press on the list now holds the redraw until it ends, just after its click.
// (fails before: yes — the row pressed was replaced by the redraw under the press)
// The list is drawn in place since (the owner's of 11-01: buttons blinking under a resting pointer): a redraw keeps the
// row, its look made the newest; a mark the test puts on the row says whether a draw has run over it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

test("a press on the list holds its redraw until the release, whose click reaches the row pressed", async () => {
  const doc = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  /** @type {Record<string, Function[]>} */
  const onDocument = {};
  const d = /** @type {any} */ (document);
  d.addEventListener = (/** @type {string} */ type, /** @type {Function} */ fn) => { (onDocument[type] ||= []).push(fn); };
  d.removeEventListener = () => {};
  g.EventSource = class { addEventListener() {} close() {} };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.fetch = async () => ({ ok: true, status: 200, json: async () => ({ sessions: [{ id: "c1", title: "First chat", when: Date.now(), project: "p1", cwd: "/x" }], projects: [{ id: "p1", name: "/x" }], runs: [] }) });
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    /** @type {string[]} */
    const opened = [];
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen: (/** @type {any} */ s) => { opened.push(s.id); }, onChanged() {} });
    await sb.load();
    /** The chat's row as the list holds it now. @param {any} el @returns {any} */
    const rowIn = (el) => (el.classList?.contains("sess-row") && String(el.textContent).includes("First chat") ? el : [...(el.children || [])].map(rowIn).find(Boolean) || null);
    const listOf = (/** @type {any} */ el) => (el.className === "sess-list" ? el : [...(el.children || [])].map(listOf).find(Boolean) || null);
    const list = listOf(host);
    const first = rowIn(host);
    assert.ok(list && first, "the list and the chat's row are drawn");
    first.setAttribute("data-probe", "1");
    sb.draw();
    const drawn = rowIn(host);
    assert.equal(drawn, first, "a redraw with no press keeps the row");
    assert.equal(drawn.getAttribute("data-probe"), null, "drawn over in place");
    // Pressed: the tick's redraw waits.
    drawn.setAttribute("data-probe", "1");
    list.dispatch("pointerdown", { target: drawn });
    sb.draw();
    assert.equal(rowIn(host), drawn, "held: the row pressed is the one on screen");
    assert.equal(drawn.getAttribute("data-probe"), "1", "held: nothing drawn over it");
    // Released: the click reaches the row pressed, then the held redraw runs.
    for (const fn of onDocument.pointerup || []) fn({ type: "pointerup" });
    drawn.dispatch("click");
    assert.deepEqual(opened, ["c1"], "the click opened the chat");
    assert.equal(rowIn(host), drawn, "the click came first");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(drawn.getAttribute("data-probe"), null, "the held redraw ran once the press ended");
    assert.equal(rowIn(host), drawn, "in place");
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
});
