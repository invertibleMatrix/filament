// @ts-check
// The left bar's row of a chat that waits for you (the performance audit of 10-29, C1): the bar is no longer drawn
// whole every half minute, so what a paused chat waits on — read by Now after the bar drew the pause — is drawn into its
// row by the page's five-second tick, that row alone. Its own file: the page's API binds the `fetch` of when it loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

/** Every element under `el` that wears the class, in order. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((k) => all(k, cls))];
/** A chat's row in the list. @param {any} host @param {string} chain */
const rowOf = (host, chain) => all(host, "sess-row").find((r) => r.getAttribute("data-chain") === chain) || null;

// (fails before: yes — with the bar no longer drawn whole every half minute, a paused chat's row kept the words it
// was first drawn with: the bar draws as the runs list moves a mark, before Now has read what the turn waits on, and
// Now's read of it moves no mark)
test("a paused chat's row says what it waits on once Now has read it: the tick draws that row again, the bar left as it is", async () => {
  const doc = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  d.visibilityState = "visible";
  g.EventSource = class {
    constructor() {
      this.onmessage = null;
    }
    addEventListener() {}
    close() {}
  };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  // Now folded: the paused chat stays in its project, its row wearing the orange dot with what it waits on in its hover.
  g.localStorage = { getItem: (/** @type {string} */ k) => (k === "harness.sidebar.nowOpen" ? "0" : null), setItem() {}, removeItem() {} };
  const t = Date.now();
  const at = new Date(t - 5 * 60_000).toISOString();
  const sessions = [
    { id: "c1", title: "First chat", when: at, project: "p1", cwd: "/x" },
    { id: "c2", title: "Second chat", when: at, project: "p1", cwd: "/x" },
  ];
  const log = [{ n: 1, type: "ask", kind: "question", id: "a1", question: "Which file?", ts: t }];
  /** The turn's log answers only once the test lets it: the bar has drawn by then. */
  let answer = () => {};
  const read = new Promise((r) => (answer = () => r(undefined)));
  g.fetch = async (/** @type {string} */ url) => {
    const u = String(url);
    if (u.includes("/runs/r1/events")) {
      await read;
      return { ok: true, status: 200, json: async () => ({ events: log }) };
    }
    if (u.includes("/runs?")) return { ok: true, status: 200, json: async () => ({ runs: [{ id: "r1", kind: "agent-turn", status: "paused", startedAt: t - 60_000, endedAt: null, events: log.length, meta: { chain: "c1" } }] }) };
    return { ok: true, status: 200, json: async () => ({ sessions, projects: [{ id: "p1", name: "/x" }], runs: [], subagents: [] }) };
  };
  /** The orange dot's hover on a chat's row. @param {any} host @param {string} chain */
  const waitsOn = (host, chain) => String(all(rowOf(host, chain) || {}, "needs")[0]?.getAttribute("title") || "");
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {} });
    await sb.load();
    await sb.loadRuns();
    assert.equal(waitsOn(host, "c1"), "waits for you", "drawn as the run paused, before Now has read what it asks");
    const other = rowOf(host, "c2");
    answer();
    await until(() => {
      sb.paintAges();
      return waitsOn(host, "c1") === "asks: Which file?";
    }, "the tick drawing the paused chat's row with its question");
    assert.equal(rowOf(host, "c2"), other, "the other chat's row stands as it was drawn");
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    delete d.visibilityState;
    doc.restore();
  }
});
