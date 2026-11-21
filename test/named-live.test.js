// @ts-check
// A chat the side model names (Settings › Experimental) while its first turn runs: the left bar's Now — the Working
// row — says the new name the moment the header does (the owner's report of 11-07: the header took it at once, Working
// only once the turn ended). Until its turn ends the chat is the page's alone, in no list of the server's, so the row
// is named from the page's chat. The left bar is drawn here, on the stub document, with the feed and the admin API
// stood in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

/** Every element under `el` that wears the class, in order. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((k) => all(k, cls))];

// (fails before: yes — the row read the first message as typed ahead of the chat's name, and the bar's handler of the
// name found no row of the server's to write it in: "please fix the login bug" until the turn's end)
test("a new chat named while its first turn runs: its Working row says the name at once, lit as named", async () => {
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
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const t = Date.now();
  // The chat's first turn runs: the server lists no session for it yet.
  const turn = { id: "r1", kind: "agent-turn", status: "running", startedAt: t - 60_000, endedAt: null, events: 1, meta: { chain: "c1", model: "opus" } };
  g.fetch = async (/** @type {string} */ url) => {
    const u = String(url);
    const body = u.includes("/runs?limit") ? { runs: [turn] } : u.includes("/events?") ? { events: [] } : u.includes("/sessions/holders") ? { holders: [], stretches: [] } : { sessions: [], projects: [], runs: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  /** @param {any} msg */
  const say = (msg) => feed.onmessage({ data: JSON.stringify(msg) });
  try {
    // Imported here: the page's API binds the `fetch` of when it loads.
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const { state } = await import("../src/ui/harness/state.js");
    state.chats.set("p1", /** @type {any} */ ({ id: "p1", chainId: "c1", cwd: "/x", title: "", turns: [{ n: 1, userText: "please fix the login bug" }] }));
    const host = document.createElement("div");
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {} });
    await sb.load();
    await sb.loadRuns();
    const title = () => all(all(host, "now-row").find((r) => r.getAttribute("data-chain") === "c1") || host, "now-title")[0];
    await until(() => title()?.textContent === "please fix the login bug", `its row, named from what was typed: ${title()?.textContent}`);
    say({ type: "named", chainId: "c1", title: "Fixing the login bug" });
    assert.equal(title()?.textContent, "Fixing the login bug", "the side model's name, at once");
    assert.equal(title()?.classList.contains("is-named"), true, "lit as the header is");
    assert.equal(state.chats.get("p1")?.title, "Fixing the login bug", "the page's chat holds it, whichever handler hears it first");
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
});
