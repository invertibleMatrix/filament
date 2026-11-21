// @ts-check
// The left bar where a project has a Space only once the person made one (the owner's of 10-29: "by default there is no
// space and one can right click to make one and similarly one can right click and delete one"): its Space row only
// where `/api/spaces` names it, and the project's menu — its ⋯, or a right-click on its row — with Open its page (where
// the first thing added makes its Space: by need, 11-12), Make a Space and Bring back where it has none, Open its Space
// and Delete Space… where it has one, and Folders and worktrees… always.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** Every element under one, in order. @param {any} el @returns {any[]} */
const all = (el) => [el, ...[...(el.children || [])].flatMap(all)];

// (fails before: yes — every project's group had its Space row)
test("a project's Space row stands only where it has a Space", async () => {
  await drawBar({ open: {} }, ({ list }) => {
    assert.deepEqual(spaceRows(list), [], "none made: no row");
  });
  await drawBar({ open: { p1: 0 } }, ({ list }) => {
    assert.deepEqual(spaceRows(list), ["p1"], "made, with no task yet: its row");
  });
});

// (fails before: yes — a right-click on a project's row did nothing of Filament's, and its menu had no Make a Space)
test("right-click on a project: Make a Space, or Bring back its Space where one was deleted; once made, Open and Delete Space…", async () => {
  await drawBar({ open: {} }, ({ list, menuOf, sb }) => {
    const items = menuOf(list);
    // (fails before: yes — by need, 11-12: a project with no Space had no row that opens its page, where the first thing
    // added makes its Space)
    assert.equal(items[0], "Open its pageIts lanes and folders; the first thing you add there makes its Space", items.join(" | "));
    // (fails before: yes — the Designer's walk of 10-29: Make a Space said nothing of what a Space is)
    assert.equal(items[1], "Make a SpaceA board of tasks, What happened, and the apps its chats make: every chat in it can see and change it", items.join(" | "));
    assert.ok(items.includes("Folders and worktrees…"));
    assert.ok(!items.includes("Open its Space") && !items.includes("Delete Space…") && !items.includes("Bring back its Space"));
    assert.deepEqual([sb.hasSpace("p1"), sb.spaceWaits("p1")], [false, false]);
  });
  await drawBar({ open: {}, back: { p1: Date.now() - 60_000 } }, ({ list, menuOf, sb }) => {
    const items = menuOf(list);
    // Its deleted Space waits: its page adds nothing until it is back, or a new one made.
    assert.deepEqual(items.slice(0, 3).map((x) => x.replace(/^(Make a Space).*/, "$1")), ["Open its pageIts lanes and folders, and its deleted Space, to bring back or make anew", "Make a Space", "Bring back its Space"], items.join(" | "));
    // (fails before: yes — the bar said nothing of a deleted Space that waits: Watch this chat… asks it)
    assert.deepEqual([sb.hasSpace("p1"), sb.spaceWaits("p1")], [false, true]);
  });
  await drawBar({ open: { p1: 2 } }, ({ list, menuOf, sb }) => {
    const items = menuOf(list);
    assert.ok(items.includes("Open its Space") && items.includes("Delete Space…"), items.join(" | "));
    assert.ok(!items.some((x) => x.startsWith("Make a Space")) && !items.includes("Bring back its Space") && !items.some((x) => x.startsWith("Open its page")));
    assert.deepEqual([sb.hasSpace("p1"), sb.spaceWaits("p1")], [true, false]);
  });
});

// (fails before: yes — there was no such row)
test("Open its page opens the project's page and makes nothing", async () => {
  /** @type {string[]} */
  const opened = [];
  await drawBar({ open: {} }, async ({ list, menuOf, pressed, posts }) => {
    menuOf(list);
    await pressed("Open its page");
    assert.deepEqual(posts(), [], "nothing posted: the first thing added there makes its Space");
  }, { onSpace: (/** @type {string} */ id) => opened.push(id) });
  assert.deepEqual(opened, ["p1"]);
});

// (fails before: yes — there was no Make a Space to press)
test("Make a Space posts the project's Space, then opens it", async () => {
  /** @type {string[]} */
  const opened = [];
  await drawBar({ open: {} }, async ({ list, menuOf, pressed, posts }) => {
    menuOf(list);
    await pressed("Make a Space");
    assert.deepEqual(posts(), [["POST", "/api/space/p1"]]);
  }, { onSpace: (/** @type {string} */ id) => opened.push(id) });
  assert.deepEqual(opened, ["p1"]);
});

// (fails before: yes — the bug hunt of 10-30, a Low: the Spaces' read, asked as the bar is made, drew the bar when it
// answered before the chats' list, and the bar said "Open a folder to start" — an install with nothing — until it came)
test("before its list is read the bar says nothing of being empty: a Spaces' read that answers first draws no empty state", async () => {
  const doc = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  g.EventSource = class { addEventListener() {} close() {} };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // What another bar of this file read stays in the page's state: this bar starts as a page does, knowing nothing.
  const { state } = await import("../src/ui/harness/state.js");
  Object.assign(state, { sessions: [], projects: [] });
  state.chats.clear();
  /** @type {() => void} */
  let listIn = () => {};
  const listHeld = new Promise((r) => { listIn = () => r(undefined); });
  g.fetch = fetchNow;
  answer = async (/** @type {string} */ url) => {
    const u = String(url);
    if (u.endsWith("/api/spaces")) return { ok: true, status: 200, json: async () => ({ open: { p1: 0 }, needs: {}, extended: false, next: null, own: [], back: {} }) };
    await listHeld;
    return { ok: true, status: 200, json: async () => ({ sessions: [{ id: "c1", title: "Fix the build", when: Date.now(), project: "p1", cwd: "/code/app" }], projects: [{ id: "p1", name: "/code/app", cwd: "/code/app" }], runs: [] }) };
  };
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onSpace() {}, onSpacePlaces() {}, onYourSpace() {} });
    await new Promise((r) => setTimeout(r, 20));
    const list = all(host).find((x) => x.className === "sess-list");
    const empty = () => all(list).some((x) => x.className === "lb-empty");
    assert.equal(empty(), false, "the Spaces answered; the list not yet");
    const loaded = sb.load();
    listIn();
    await loaded;
    assert.deepEqual([empty(), spaceRows(list)], [false, ["p1"]], "read: the bar is drawn");
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
});

/** What the server answers now: the page's API takes `fetch` once, as it loads, so one fetch hands every bar's to it. */
let answer = /** @type {(url: string, init?: any) => Promise<any>} */ (async () => ({ ok: false, status: 500, json: async () => ({}) }));
const fetchNow = (/** @type {string} */ url, /** @type {any} */ init) => answer(url, init);

/** The projects whose Space row the list draws. @param {any} list */
const spaceRows = (list) => all(list).filter((x) => /^space-row\b(?!-)/.test(String(x.className))).map((x) => x.getAttribute("data-space"));

/**
 * The bar drawn on the stub document with one project, p1, its Spaces as `/api/spaces` says.
 * @param {{ open: Record<string, number>, back?: Record<string, number> }} spaces
 * @param {(w: { list: any, menuOf: (list: any) => string[], pressed: (label: string) => Promise<void>, posts: () => string[][], sb: any }) => void | Promise<void>} check
 * @param {Record<string, any>} [cbs]
 */
async function drawBar(spaces, check, cbs = {}) {
  const doc = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  g.EventSource = class { addEventListener() {} close() {} };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const now = Date.now();
  /** @type {string[][]} */
  const writes = [];
  g.fetch = fetchNow;
  answer = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET");
    if (method !== "GET") writes.push([method, u]);
    const body = u.endsWith("/api/spaces")
      ? { open: spaces.open, needs: {}, extended: false, next: null, own: [], back: spaces.back || {} }
      : method === "POST" && /\/api\/space\/p1$/.test(u)
        ? { ok: true, made: true, tasks: 0 }
        : {
            sessions: [{ id: "c1", title: "Fix the build", when: now, project: "p1", cwd: "/code/app" }],
            projects: [{ id: "p1", name: "/code/app", cwd: "/code/app" }],
            runs: [],
          };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    const sb = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onSpace() {}, onSpacePlaces() {}, onYourSpace() {}, ...cbs });
    await sb.load();
    await new Promise((r) => setTimeout(r, 10));
    const list = all(host).find((x) => x.className === "sess-list");
    assert.ok(list, "the list is drawn");
    /** The menu a right-click on p1's row opens: its items' words. @param {any} l */
    const menuOf = (l) => {
      const summary = all(l).find((x) => x.tagName === "SUMMARY" && x.getAttribute("data-flip") === "project:p1");
      assert.ok(summary, "p1's row");
      summary.dispatch("contextmenu", { currentTarget: summary });
      const m = all(document.body).filter((x) => x.getAttribute?.("role") === "menu").at(-1);
      assert.ok(m, "a menu opened");
      return all(m).filter((x) => x.getAttribute?.("role") === "menuitem").map((x) => String(x.textContent).trim());
    };
    /** An item of the menu open now, pressed. @param {string} label */
    const pressed = async (label) => {
      const m = all(document.body).filter((x) => x.getAttribute?.("role") === "menu").at(-1);
      const item = all(m).find((x) => x.getAttribute?.("role") === "menuitem" && String(x.textContent).trim().startsWith(label));
      assert.ok(item, `the item ${label}`);
      item.dispatch("click");
      await new Promise((r) => setTimeout(r, 10));
    };
    await check({ list, menuOf, pressed, posts: () => writes, sb });
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
}
