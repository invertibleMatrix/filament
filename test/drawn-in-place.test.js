// @ts-check
// The parts of the page that draw again while you work keep the elements under the pointer (the owner's of 11-01: "when
// i hover over my mouse over some interactive elements like buttons then those are just suppose to highlight only once
// they quite a lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have
// to press more than once"). Each part drawn again with a new element per row lost the hover of the row under a resting
// pointer, every draw, and a press that began on the old row ended on the new one, where no click goes. Drawn in place
// (dom.js `morphChildren`), a row is the element that stood, its words and its handlers the newest draw's.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

// The page's API keeps the `fetch` it found when it loaded: one that hands each call to the test's stand-in of the
// moment, in place before any of the page loads (its modules are imported in the tests).
/** @type {(url: string, init?: any) => Promise<any>} */
let fetchNow = async (url) => {
  throw new Error(`no stand-in answers ${url}`);
};
const realFetch = globalThis.fetch;
globalThis.fetch = /** @type {any} */ ((/** @type {string} */ url, /** @type {any} */ init) => fetchNow(url, init));
const { createNow } = await import("../src/ui/harness/now-list.js");

/** Every element under `el` that wears the class, in order. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => [...(el.classList?.contains(cls) ? [el] : []), ...[...(el.children || [])].flatMap((k) => all(k, cls))];

/**
 * The left bar over a stand-in Filament, its feed and its reads in the test's hands; put back after `fn`.
 * @param {{ sessions: any[], projects: any[] }} data  what the list's reads answer, as it stands at each read
 * @param {(t: { sb: any, host: any, opened: any[], feed: () => any }) => Promise<void>} fn
 */
async function withBar(data, fn) {
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  const hadFetch = fetchNow;
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  /** @type {any} */
  let feed = null;
  g.EventSource = class {
    constructor() {
      this.onmessage = null;
      feed = this;
    }
    addEventListener() {}
    close() {}
  };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  // Now folded: every chat stays in its project.
  g.localStorage = { getItem: (/** @type {string} */ k) => (k === "harness.sidebar.nowOpen" ? "0" : null), setItem() {}, removeItem() {} };
  fetchNow = async () => ({ ok: true, status: 200, json: async () => ({ sessions: data.sessions, projects: data.projects, runs: [] }) });
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    /** @type {any[]} */
    const opened = [];
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen: (s) => void opened.push(s.title), onChanged() {} });
    await fn({ sb, host, opened, feed: () => feed });
  } finally {
    fetchNow = hadFetch;
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  }
}

/** @type {ReturnType<typeof stubDocument>} */
let doc;
beforeEach(() => {
  doc = stubDocument();
  // A page shown: Now reads nothing while it is hidden.
  /** @type {any} */ (doc.document).visibilityState = "visible";
});
afterEach(() => {
  delete (/** @type {any} */ (doc.document)).visibilityState;
  doc.restore();
});
process.on("exit", () => {
  globalThis.fetch = realFetch;
});

// (fails before: yes — Now drew its rows with replaceChildren, a new element for every row at every draw)
test("Now drawn again keeps its rows and its lines, and a press acts on the newest draw", async () => {
  const t = Date.now();
  /** @param {string} id @param {string} chain */
  const turn = (id, chain) => ({ id, kind: "agent-turn", status: "running", startedAt: t - 60_000, endedAt: null, events: 1, meta: { chain, model: "opus" } });
  const sub = { id: "s1", kind: "subagent", status: "running", startedAt: t - 30_000, endedAt: null, events: 1, meta: { chain: "c1" } };
  /** @param {string} id @param {string} task */
  const hunter = (id, task) => ({ id, origin: "agent", status: "running", team: { key: "bug-hunter", name: "Bug Hunter", role: "hunter" }, card: { tag: "hunter", name: "Hunter" }, description: task, exchanges: [{ description: task, startedAt: t - 20_000, endedAt: null }], startedAt: t - 20_000, progress: {} });
  /** @param {string} p */
  const call = async (p) => (p.startsWith("/sessions/c1/subagents") ? { subagents: [hunter("sa_1", "Hunt the parser")] } : { events: [] });
  /** @type {Record<string, any>} */
  const chats = { c1: { title: "Fix the rail", project: "filament", when: t, unread: false }, c2: { title: "Release notes", project: "site", when: t, unread: false } };
  /** @type {string[]} */
  const opened = [];
  /** @type {string[]} */
  const menus = [];
  const now = createNow({
    call: /** @type {any} */ (call), chats: (c) => chats[c] || null, unread: () => new Set(), holders: () => new Map(),
    onOpen: (r) => void opened.push(r.title), onSeen: () => {}, onMenu: (r, anchor) => void menus.push(`${r.title}@${anchor?.getAttribute?.("data-chain")}`),
  });
  doc.document.body.append(now.el);
  await now.update(/** @type {any} */ ([turn("r1", "c1"), sub, turn("r2", "c2")]));
  const rowsOf = () => /** @type {any[]} */ (now.el.querySelectorAll(".now-row"));
  const before = rowsOf();
  const head = now.el.querySelector(".now-head");
  const line = now.el.querySelector(".now-under");
  assert.equal(before.length, 2);
  assert.ok(line, "the worker's line under its lead");
  chats.c2 = { ...chats.c2, title: "Release notes, rewritten" };
  now.refresh();
  const after = rowsOf();
  assert.deepEqual(after.map((r) => r.getAttribute("data-chain")), before.map((r) => r.getAttribute("data-chain")));
  after.forEach((r, i) => assert.equal(r, before[i], `the row of ${r.getAttribute("data-chain")} is the element that stood`));
  assert.equal(now.el.querySelector(".now-head"), head, "and Now's head");
  assert.equal(now.el.querySelector(".now-under"), line, "and the line under its lead");
  const c2 = after.find((r) => r.getAttribute("data-chain") === "c2");
  assert.match(String(c2.textContent), /Release notes, rewritten/);
  c2.dispatch("click");
  c2.dispatch("keydown", { key: "Enter" });
  c2.dispatch("contextmenu");
  assert.deepEqual(opened, ["Release notes, rewritten", "Release notes, rewritten"], "a press acts on the newest draw");
  assert.deepEqual(menus, ["Release notes, rewritten@c2"], "its menu opens on the row that stands");
});

// (fails before: yes — the bar drew its list with replaceChildren, a new element for every row, head and button at every
// draw: the projects' rows 18 times, their buttons 24 times and the heads' buttons 3 times in 25 s of one busy turn)
test("the left bar drawn again keeps its rows, heads and buttons, and a press acts on the newest draw", async () => {
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const data = {
    sessions: [
      { id: "c1", title: "First chat", when: at, project: "p1", cwd: "/x" },
      { id: "c2", title: "Second chat", when: at, project: "p1", cwd: "/x" },
    ],
    projects: [{ id: "p1", name: "/x" }],
  };
  await withBar(data, async ({ sb, host, opened }) => {
    await sb.load();
    const rowOf = (/** @type {string} */ chain) => all(host, "sess-row").find((r) => r.getAttribute("data-chain") === chain) || null;
    const parts = () => ({
      rows: [rowOf("c1"), rowOf("c2")],
      group: all(host, "sess-group")[0],
      acts: all(host, "row-act"),
      heads: all(host, "projects-head"),
    });
    const before = parts();
    assert.ok(before.rows.every(Boolean) && before.group, `both chats drawn under their project: ${String(host.textContent).slice(0, 300)}`);
    assert.ok(before.acts.length >= 4, "each row's pin, the project's ⋯, Add project and Filter and sort");
    data.sessions = [{ ...data.sessions[0] }, { ...data.sessions[1], title: "Second chat, renamed" }];
    await sb.load();
    const after = parts();
    after.rows.forEach((r, i) => assert.equal(r, before.rows[i], `the row of ${r?.getAttribute("data-chain")} is the element that stood`));
    assert.equal(after.group, before.group, "and its project's group");
    assert.deepEqual(after.acts, before.acts, "and every button on the rows and heads");
    assert.deepEqual(after.heads, before.heads, "and the heads");
    assert.match(String(after.rows[1].textContent), /Second chat, renamed/);
    after.rows[1].dispatch("click");
    assert.deepEqual(opened, ["Second chat, renamed"], "a press acts on the newest draw");
    // The tick still says each age where it stands.
    const age = all(after.rows[1], "sess-age")[0];
    age.textContent = "stale";
    sb.paintAges();
    assert.equal(age.textContent, "5m");
  });
});
