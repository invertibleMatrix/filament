// @ts-check
// A chat's work stretch on the page (the owner's of 11-03): the left bar keeps each chat's stretch as the events feed says
// it begins, goes on with a turn and ends, and as the five-second holders read sets it right — a read asked before the
// feed's word keeps that word —, and its Now counts the chat's row from it. A turn that ends while its stretch goes on
// has not finished the chat: its unread dot waits for the stretch's end. The left bar is drawn here, on the stub
// document, with the feed and the admin API stood in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

/** Every element under `el` that wears the class, in order. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((k) => all(k, cls))];

// (fails before: yes — the page heard no stretch: the bar's Now said the woken turn's own age, "1h"; a read asked before
// the feed's word undid it; and the chat took its "finished" dot as its turn ended, its work going on)
test("the bar keeps each chat's stretch as the feed says it and the holders read sets it right — not over a newer word of the feed's —, counts the chat's row from it, and holds its dot until the stretch ends", async () => {
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
  const sessions = [{ id: "c1", title: "filament_main", when: new Date(t - 60_000).toISOString(), project: "p1", cwd: "/x" }];
  const turn = { id: "r2", kind: "coding-agent", status: "running", startedAt: t - 3_600_000, endedAt: /** @type {number | null} */ (null), events: 1, meta: { chain: "c1", model: "opus" } };
  /** The holders reads on their way, each answered by the test. @type {((body: any) => void)[]} */
  const reads = [];
  /** The chats the page marked unread on the server. @type {string[]} */
  const marked = [];
  g.fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    const u = String(url);
    if (u.includes("/sessions/holders")) {
      const body = await new Promise((r) => reads.push(r));
      return { ok: true, status: 200, json: async () => body };
    }
    if (u.includes("/settings") && /"unread":true/.test(String(init?.body || ""))) marked.push(decodeURIComponent(u.split("/sessions/")[1].split("/")[0]));
    const body = u.includes("/runs?limit") ? { runs: [turn] } : u.includes("/events?") ? { events: [] } : { sessions, projects: [{ id: "p1", name: "/x" }], runs: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  /** @param {any} msg */
  const say = (msg) => feed.onmessage({ data: JSON.stringify(msg) });
  try {
    // Imported here: the page's API binds the `fetch` of when it loads.
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const { state } = await import("../src/ui/harness/state.js");
    const host = document.createElement("div");
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {} });
    await sb.load();
    await sb.loadRuns();
    /** The chat's row's age in the bar's Now. */
    const age = () => String(all(all(host, "now-row").find((r) => r.getAttribute("data-chain") === "c1") || host, "now-age")[0]?.textContent || "");
    await until(() => age() === "1h", `its turn's row, from the turn's start: ${age()}`);
    const since = t - 31 * 3_600_000;
    say({ type: "stretch", chainId: "c1", since });
    assert.deepEqual(state.stretches.get("c1"), { since, waits: null }, "the feed's word kept");
    await until(() => age() === "1d", `its row from the stretch's start: ${age()}`);
    say({ type: "stretch", chainId: "c1", since: null });
    assert.equal(state.stretches.has("c1"), false, "its end: none kept");
    await until(() => age() === "1h", `from its turn's start again: ${age()}`);
    // The feed dropped a word: the holders read sets it right.
    const set = sb.loadHolders();
    reads.shift()?.({ holders: [], stretches: [{ chainId: "c1", since, waits: { commands: 1, agents: 0, tasks: 0, teams: 0 } }] });
    await set;
    assert.deepEqual([...state.stretches], [["c1", { since, waits: { commands: 1, agents: 0, tasks: 0, teams: 0 } }]]);
    await until(() => age() === "1d", `the read's word drawn: ${age()}`);
    // A read asked before the feed's word lands after it: the feed's word stands.
    const older = sb.loadHolders();
    say({ type: "stretch", chainId: "c1", since: null });
    reads.shift()?.({ holders: [], stretches: [{ chainId: "c1", since }] });
    await older;
    assert.equal(state.stretches.has("c1"), false, "the end the feed said stands");
    const newer = sb.loadHolders();
    say({ type: "stretch", chainId: "c1", since });
    reads.shift()?.({ holders: [], stretches: [] });
    await newer;
    assert.equal(state.stretches.get("c1")?.since, since, "so does a start");

    // Its turn ends while the stretch goes on: no dot; the stretch's end gives it one.
    turn.status = "done";
    turn.endedAt = Date.now();
    await sb.loadRuns();
    assert.deepEqual([state.unreadChains.has("c1"), marked], [false, []], "its work goes on: not finished");
    say({ type: "stretch", chainId: "c1", since: null });
    assert.deepEqual([state.unreadChains.has("c1"), marked], [true, ["c1"]], "its stretch over: finished since you looked");
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
});
