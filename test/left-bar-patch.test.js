// @ts-check
// The left bar while chats work (the performance audit of 10-29, C1): the bar was drawn anew whole every five seconds by
// the page's tick, at every turn that began or ended in any chat, and twice after each read of the list — each draw
// rebuilt every row and measured every one twice for its moves. Now its rows say their ages again in place, a turn
// that begins or ends draws that chat's rows and its project's marks alone (a chat that comes to Now or goes home is
// still a move, drawn whole), and Now reads a turn's log, or a chat's threads, only where the runs list says it moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { fakeH, fakeDrawIn } from "./helpers/fake-dom.js";
import { until } from "./helpers/wait.js";

/** Every element under `el` that wears the class, in order. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((k) => all(k, cls))];
/** A chat's row in the list. @param {any} host @param {string} chain */
const rowOf = (host, chain) => all(host, "sess-row").find((r) => r.getAttribute("data-chain") === chain) || null;

// (fails before: yes — a turn that began in one chat drew the whole bar again: every row made anew)
test("a turn that begins or ends in a chat that stays home draws its row and its project's mark, not the bar; the tick says the ages in place", async () => {
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
  // Now folded: every chat stays in its project, so a turn that begins moves none.
  g.localStorage = { getItem: (/** @type {string} */ k) => (k === "harness.sidebar.nowOpen" ? "0" : null), setItem() {}, removeItem() {} };
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const sessions = [
    { id: "c1", title: "First chat", when: at, project: "p1", cwd: "/x" },
    { id: "c2", title: "Second chat", when: at, project: "p1", cwd: "/x" },
  ];
  let listReads = 0;
  g.fetch = async (/** @type {string} */ url) => {
    if (String(url).includes("/memory/sessions?limit=200")) listReads++;
    return { ok: true, status: 200, json: async () => ({ sessions, projects: [{ id: "p1", name: "/x" }], runs: [] }) };
  };
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    let atWork = 0;
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onAtWork: () => void atWork++ });
    await sb.load();
    const first = rowOf(host, "c1");
    const second = rowOf(host, "c2");
    const head = all(host, "sess-group")[0]?.children[0];
    assert.ok(first && second && head, `both chats drawn under their project: ${String(host.textContent).slice(0, 300)}`);
    assert.equal(all(head, "proj-live").length, 0, "nobody works in it yet");
    // Another window's turn begins in the first chat.
    const untouched = second.textContent;
    feed.onmessage({ data: JSON.stringify({ type: "turn", chainId: "c1", holder: { window: "w2", client: "opencode", label: "OpenCode" } }) });
    assert.equal(rowOf(host, "c2"), second, "the other chat's row stands as it was drawn");
    assert.equal(second.textContent, untouched);
    // Drawn again in place (the owner's of 11-01: a row made anew under a resting pointer blinked, and lost its press).
    assert.equal(rowOf(host, "c1"), first, "the chat that works is drawn again, in the row that stood");
    assert.equal(all(rowOf(host, "c1"), "live-spin").length, 1, "…with its spinner");
    assert.equal(all(head, "proj-live").length, 1, "its project's head marks it");
    assert.match(String(head.getAttribute("aria-label")), /1 working in it$/);
    assert.equal(atWork, 1);
    // It ends: the same, back.
    const reads = listReads;
    feed.onmessage({ data: JSON.stringify({ type: "turn", chainId: "c1", holder: null }) });
    assert.equal(rowOf(host, "c2"), second);
    assert.equal(all(rowOf(host, "c1"), "live-spin").length, 0);
    assert.equal(all(head, "proj-live").length, 0);
    // A turn let go reads the list again a moment later (its title may have moved), and that draws the bar once.
    sessions[0] = { ...sessions[0], title: "First chat, retitled" };
    await until(() => listReads > reads, "the list read again once the turn was let go");
    await until(() => /First chat, retitled/.test(String(rowOf(host, "c1")?.textContent)), "the read drawn");
    assert.equal(rowOf(host, "c1"), first, "in the row that stood");
    // The tick: each age said again where it stands, no row made anew.
    const rows = [rowOf(host, "c1"), rowOf(host, "c2")];
    const age = all(rows[1], "sess-age")[0];
    age.textContent = "stale";
    sb.paintAges();
    assert.equal(age.textContent, "5m");
    assert.deepEqual([rowOf(host, "c1"), rowOf(host, "c2")], rows);
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
});

// (fails before: yes — the page's five-second tick drew the bar whole, and a read of the list drew it twice: the list's
// own draw, then the page's `onChanged` drew it again)
test("the page's tick and a read of the list draw the bar no more than they must", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const changed = app.slice(app.indexOf("  onChanged: () => {"), app.indexOf("  onReveal: () =>"));
  assert.ok(changed.length > 0);
  assert.doesNotMatch(changed, /sidebar\.draw/, "a read of the list was drawn by the list");
  const tick = app.slice(app.indexOf("  window.setInterval(() => {\n    sidebar."), app.indexOf("}, 5000);"));
  assert.match(tick, /sidebar\.paintAges\(\);/);
  assert.doesNotMatch(tick, /sidebar\.draw/);
});

// (fails before: yes — every poll read each followed turn's log again, and each working chat's threads, whether or not
// the runs list said they had moved)
test("Now reads a turn's log, and a chat's threads, only where the runs list says it moved", async () => {
  // Imported here: the page's API binds the `fetch` of when it loads, and the test above stands one in first.
  const { createNow } = await import("../src/ui/harness/now-list.js");
  const t = Date.now();
  /** @type {string[]} */
  const asked = [];
  /** The turn's newest event, as its log holds it. */
  let newest = 0;
  const call = async (/** @type {string} */ p) => {
    asked.push(p.replace(/\?.*$/, ""));
    if (p.startsWith("/sessions/")) return { subagents: [{ id: "sa_1", origin: "owner", status: "running", description: "Look", exchanges: [{ description: "Look", startedAt: t - 10_000, endedAt: null }], startedAt: t - 10_000, progress: {} }] };
    const since = Number(/since=(\d+)/.exec(p)?.[1] || 0);
    return { events: Array.from({ length: Math.max(0, newest - since) }, (_, i) => ({ n: since + i + 1, type: "tool-start", round: 1, id: `c${since + i + 1}`, name: "read" })) };
  };
  const now = createNow({ h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, call: /** @type {any} */ (call), chats: () => ({ title: "Fix it", project: "filament", when: t, unread: false }), unread: () => new Set(), holders: () => new Map(), onOpen() {}, onSeen() {} });
  /** @param {number} events @param {number} subEvents */
  const runs = (events, subEvents) => /** @type {any} */ ((newest = events), [
    { id: "r1", kind: "agent-turn", status: "running", startedAt: t - 60_000, endedAt: null, events, meta: { chain: "a" } },
    { id: "s1", kind: "subagent", status: "running", startedAt: t - 10_000, endedAt: null, events: subEvents, meta: { chain: "a" } },
  ]);
  await now.update(runs(2, 4));
  assert.deepEqual(asked.sort(), ["/runs/r1/events", "/sessions/a/subagents"], "the first poll reads both");
  asked.length = 0;
  await now.update(runs(2, 4));
  assert.deepEqual(asked, [], "nothing moved: nothing read");
  await now.update(runs(5, 4));
  assert.deepEqual(asked, ["/runs/r1/events"], "the turn moved on: its log from where it was read");
  asked.length = 0;
  await now.update(runs(5, 6));
  assert.deepEqual(asked, ["/sessions/a/subagents"], "a thread's run moved: its threads read again");
});

// (fails before: yes — the drive of 11-01: a thread's run ending was the one move not read, nothing of the chat running
// any more, so Now said "1 agent at work" for up to half a minute after the agent had answered)
test("Now reads a chat's threads again as the last of their runs ends: its agent is at work no more", async () => {
  const { createNow } = await import("../src/ui/harness/now-list.js");
  const t = Date.now();
  /** @type {string[]} */
  const asked = [];
  let status = "running";
  const call = async (/** @type {string} */ p) => {
    asked.push(p.replace(/\?.*$/, ""));
    if (p.startsWith("/sessions/")) return { subagents: [{ id: "sa_1", origin: "agent", status, runId: "s1", description: "Ship or wait", exchanges: [{ description: "Ship or wait", runId: "s1", startedAt: t - 10_000, endedAt: status === "running" ? null : t - 1_000 }], startedAt: t - 10_000, progress: {} }] };
    return { events: [] };
  };
  const now = createNow({ h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, call: /** @type {any} */ (call), chats: () => ({ title: "Decide the launch", project: "app", when: t, unread: false }), unread: () => new Set(), holders: () => new Map(), onOpen() {}, onSeen() {} });
  const turn = { id: "r1", kind: "agent-turn", status: "done", startedAt: t - 60_000, endedAt: t - 2_000, events: 3, meta: { chain: "a" } };
  const sub = (/** @type {boolean} */ ended) => ({ id: "s1", kind: "subagent", status: ended ? "done" : "running", startedAt: t - 10_000, endedAt: ended ? t - 1_000 : null, events: ended ? 5 : 4, meta: { chain: "a", subagent: "sa_1" } });
  await now.update(/** @type {any} */ ([turn, sub(false)]));
  assert.deepEqual([now.works, asked.includes("/sessions/a/subagents")], [1, true], "its agent at work: the chat at work with it");
  asked.length = 0;
  // Its run ended; its record says so a moment later — once Filament has captured its work and handed its report on.
  await now.update(/** @type {any} */ ([turn, sub(true)]));
  assert.deepEqual([asked, now.works], [["/sessions/a/subagents"], 1], "its run ended: its threads read again at once, at work as its record says");
  asked.length = 0;
  await now.update(/** @type {any} */ ([turn, sub(true)]));
  assert.deepEqual([asked, now.works], [["/sessions/a/subagents"], 1], "a record behind its run is read again at every poll");
  asked.length = 0;
  status = "done";
  await now.update(/** @type {any} */ ([turn, sub(true)]));
  assert.deepEqual([asked, now.works], [["/sessions/a/subagents"], 0], "its record caught up: at work no more");
  asked.length = 0;
  await now.update(/** @type {any} */ ([turn, sub(true)]));
  assert.deepEqual([asked, now.works], [[], 0], "then nothing moved: nothing read");
});

// (fails before: yes — the review of 11-01: a worker whose run had ended while Filament ran the check its brief gave —
// minutes, maybe — read as behind its run: at work no more, and its threads read again at every poll)
test("a thread Filament runs the check of is at work still, and read again no oftener than its runs move", async () => {
  const { createNow } = await import("../src/ui/harness/now-list.js");
  const t = Date.now();
  /** @type {string[]} */
  const asked = [];
  const call = async (/** @type {string} */ p) => {
    asked.push(p.replace(/\?.*$/, ""));
    if (p.startsWith("/sessions/")) return { subagents: [{ id: "sa_1", origin: "agent", status: "running", runId: "s1", description: "Fix the parser", exchanges: [{ description: "Fix the parser", runId: "s1", startedAt: t - 10_000, endedAt: null }], startedAt: t - 10_000, progress: { check: { command: "npm test", began: t - 500 } } }] };
    return { events: [] };
  };
  const now = createNow({ h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, call: /** @type {any} */ (call), chats: () => ({ title: "Fix the parser", project: "app", when: t, unread: false }), unread: () => new Set(), holders: () => new Map(), onOpen() {}, onSeen() {} });
  const list = /** @type {any} */ ([
    { id: "r1", kind: "agent-turn", status: "done", startedAt: t - 60_000, endedAt: t - 2_000, events: 3, meta: { chain: "a" } },
    { id: "s1", kind: "subagent", status: "done", startedAt: t - 10_000, endedAt: t - 1_000, events: 5, meta: { chain: "a", subagent: "sa_1" } },
  ]);
  await now.update(list);
  assert.deepEqual([now.works, asked], [1, ["/sessions/a/subagents"]], "its check runs: at work, the chat with it");
  asked.length = 0;
  await now.update(list);
  assert.deepEqual([now.works, asked], [1, []], "nothing moved: nothing read");
});

// (fails before: yes — the review of 11-01: a check's end moves nothing in the runs list, so its agent read at work up
// to half a minute after its record closed; the feed says so at once)
test("Now reads a chat's threads again at the next poll once the feed says one moved — as a check Filament ran ends", async () => {
  const { createNow } = await import("../src/ui/harness/now-list.js");
  const t = Date.now();
  /** @type {string[]} */
  const asked = [];
  let status = "running";
  /** @type {(() => void) | null} */
  let midRead = null;
  const call = async (/** @type {string} */ p) => {
    asked.push(p.replace(/\?.*$/, ""));
    if (!p.startsWith("/sessions/")) return { events: [] };
    const said = { subagents: [{ id: "sa_1", origin: "agent", status, runId: "s1", description: "Fix the parser", exchanges: [{ description: "Fix the parser", runId: "s1", startedAt: t - 10_000, endedAt: status === "running" ? null : t }], startedAt: t - 10_000, progress: status === "running" ? { check: { command: "npm test", began: t - 500 } } : {} }] };
    midRead?.();
    return said;
  };
  const now = createNow({ h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, call: /** @type {any} */ (call), chats: () => ({ title: "Fix the parser", project: "app", when: t, unread: false }), unread: () => new Set(), holders: () => new Map(), onOpen() {}, onSeen() {} });
  const list = /** @type {any} */ ([
    { id: "r1", kind: "agent-turn", status: "done", startedAt: t - 60_000, endedAt: t - 2_000, events: 3, meta: { chain: "a" } },
    { id: "s1", kind: "subagent", status: "done", startedAt: t - 10_000, endedAt: t - 1_000, events: 5, meta: { chain: "a", subagent: "sa_1" } },
  ]);
  await now.update(list);
  assert.deepEqual([now.works, asked], [1, ["/sessions/a/subagents"]], "its check runs: at work");
  asked.length = 0;
  // The feed says its thread moved while a read asked before is on its way: that read's word is older than the feed's.
  now.threadsMoved("b");
  midRead = () => { midRead = null; now.threadsMoved("a"); };
  now.threadsMoved("a");
  await now.update(list);
  assert.deepEqual([now.works, asked], [1, ["/sessions/a/subagents"]], "the feed's word: read at the next poll, a chat Now reads no threads of left alone");
  asked.length = 0;
  status = "done";
  await now.update(list);
  assert.deepEqual([now.works, asked], [0, ["/sessions/a/subagents"]], "the feed spoke again mid-read: read once more, its check over");
  asked.length = 0;
  await now.update(list);
  assert.deepEqual([now.works, asked], [0, []], "then nothing moved: nothing read");
  // The bar hands Now the feed's word on each thread (the `subagents` topic's `subagent`, published at every change).
  assert.match(readFileSync("src/ui/harness/sidebar.js", "utf8"), /if \(msg\?\.type === "subagent" && msg\.chainId\) now\.threadsMoved\(String\(msg\.chainId\)\);/);
});
