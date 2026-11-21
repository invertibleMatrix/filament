// @ts-check
// The five-second holders read (sidebar.js `loadHolders`, Facade D11) sets right a holder change the events feed dropped.
// A read asked before the feed said a chat's holder, and answered after, says less than the feed did: taken as it came,
// it undid a take just heard — the page then saw the session free, read its transcript as if an outside client's turn
// had ended, and its waiting message tried to go — or brought a released holder back. The left bar is drawn here, on the
// stub document, with the feed and the admin API stood in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const OUTSIDE = { window: "conv-opencode", client: "opencode", label: "OpenCode", since: 1 };

// (fails before: yes — on e7f453755 a read answered before OpenCode took the session, landing after, deleted its holder)
test("a holders read asked before the feed's word on a chat keeps the feed's word; one asked after it sets right what the feed dropped", async () => {
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
  /** The holders reads on their way, each answered by the test. @type {((body: any) => void)[]} */
  const reads = [];
  let listReads = 0;
  g.fetch = async (/** @type {string} */ url) => {
    if (String(url).includes("/sessions/holders")) {
      const body = await new Promise((r) => reads.push(r));
      return { ok: true, status: 200, json: async () => body };
    }
    if (String(url).includes("/memory/sessions?")) listReads++;
    return { ok: true, status: 200, json: async () => ({ sessions: [], projects: [], runs: [] }) };
  };
  /** @param {any} msg */
  const say = (msg) => feed.onmessage({ data: JSON.stringify(msg) });
  try {
    // Imported here: the page's API binds the `fetch` of when it loads.
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const { state } = await import("../src/ui/harness/state.js");
    const sb = createSidebar(/** @type {any} */ (document.createElement("div")), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {} });
    await sb.load();
    // Asked while nobody held the chat; OpenCode takes it; the answer lands after.
    const first = sb.loadHolders();
    say({ type: "turn", chainId: "c1", holder: OUTSIDE });
    reads.shift()?.({ holders: [] });
    await first;
    assert.equal(state.holders.get("c1")?.window, "conv-opencode", "the take the feed said stands");
    // Asked while OpenCode held it; it lets go; the answer lands after.
    const second = sb.loadHolders();
    const listed = listReads;
    say({ type: "turn", chainId: "c1", holder: null });
    reads.shift()?.({ holders: [{ chainId: "c1", ...OUTSIDE }] });
    await second;
    assert.equal(state.holders.has("c1"), false, "the release the feed said stands");
    // Two reads on their way, the newer answered first: the older still keeps the feed's word it was asked before.
    const older = sb.loadHolders();
    const newer = sb.loadHolders();
    say({ type: "turn", chainId: "c1", holder: OUTSIDE });
    reads.pop()?.({ holders: [{ chainId: "c1", ...OUTSIDE }] });
    await newer;
    reads.shift()?.({ holders: [] });
    await older;
    assert.equal(state.holders.get("c1")?.window, "conv-opencode", "the older read, landing last, undoes nothing");
    // The feed dropped the release: a read asked after its last word sets it right.
    const after = sb.loadHolders();
    reads.shift()?.({ holders: [] });
    await after;
    assert.equal(state.holders.has("c1"), false, "the read's word: nobody holds it");
    // A turn let go reads the list again a moment later: it is drawn before the stub document goes.
    await until(() => listReads > listed, "the list read again once the turn was let go");
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
});
