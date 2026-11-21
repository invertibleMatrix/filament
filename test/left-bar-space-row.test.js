// @ts-check
// By time, a project's Space stands under Spaces, named for its project (10-29), and says how many of its chats work. A
// turn that begins or ends draws that chat's rows and its project's parts alone (left-bar-patch.test.js): the Space row
// is one of its parts, or it says nobody works until the bar is next drawn whole. A file of its own: the page's one
// events stream and its API's `fetch` are the first bar's of a file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

/** Every element under `el` that wears the class, in order. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((k) => all(k, cls))];
/** A chat's row in the list. @param {any} host @param {string} chain */
const rowOf = (host, chain) => all(host, "sess-row").find((r) => r.getAttribute("data-chain") === chain) || null;

// (fails before: yes — the project's Space row under Spaces was drawn without its project's parts: a turn that began
// drew the chat's row alone, and the Space row said nobody worked in it)
test("by time, a project's Space row under Spaces says a turn that begins or ends in its chats, the bar not drawn again", async () => {
  const doc = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  /** @type {any} */
  let feed = null;
  g.EventSource = class {
    constructor() {
      /** @type {((e: { data: string }) => void) | null} */
      this.onmessage = null;
      feed = this;
    }
    addEventListener() {}
    close() {}
  };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  // By time, Now folded: the chats stand in the timeline, and a turn that begins moves none.
  g.localStorage = { getItem: (/** @type {string} */ k) => (k === "harness.sidebar.nowOpen" ? "0" : k === "harness.organize" ? "grouped" : null), setItem() {}, removeItem() {} };
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const sessions = [
    { id: "c1", title: "First chat", when: at, project: "p1", cwd: "/x" },
    { id: "c2", title: "Second chat", when: at, project: "p1", cwd: "/x" },
  ];
  let listReads = 0;
  g.fetch = async (/** @type {string} */ url) => {
    if (String(url).includes("/memory/sessions?limit=200")) listReads++;
    // The project made its Space: `/spaces` names it, with no task open.
    const body = String(url).endsWith("/spaces") ? { open: { p1: 0 } } : { sessions, projects: [{ id: "p1", name: "/x" }], runs: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onSpace() {} });
    await sb.load();
    const spaceRow = () => all(host, "space-row").find((r) => r.getAttribute("data-space") === "p1") || null;
    await until(() => spaceRow() && rowOf(host, "c1"), "the chats and the project's Space drawn by time");
    assert.equal(String(spaceRow().textContent).trim(), "x", "named for its project; nobody works in it yet");
    const second = rowOf(host, "c2");
    // Another window's turn begins in the first chat.
    feed.onmessage({ data: JSON.stringify({ type: "turn", chainId: "c1", holder: { window: "w2", client: "opencode", label: "OpenCode" } }) });
    assert.equal(rowOf(host, "c2"), second, "the bar is not drawn again");
    assert.match(String(spaceRow().textContent), /1 working/, "its Space row says the chat that works");
    // It ends: the row says so, and the list is read again a moment later (its title may have moved).
    const reads = listReads;
    feed.onmessage({ data: JSON.stringify({ type: "turn", chainId: "c1", holder: null }) });
    assert.doesNotMatch(String(spaceRow().textContent), /working/);
    sessions[1] = { ...sessions[1], title: "Second chat, retitled" };
    await until(() => listReads > reads, "the list read again once the turn was let go");
    await until(() => /Second chat, retitled/.test(String(rowOf(host, "c2")?.textContent)), "the read drawn");
    // In place (the owner's of 11-01: a row made anew under a resting pointer blinked, and lost its press).
    assert.equal(rowOf(host, "c2"), second, "in the row that stood");
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
});
