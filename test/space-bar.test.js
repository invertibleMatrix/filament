// @ts-check
// A Space's apps in the left bar (the owner's idea of 10-29: "every dashboard or App we create in the Space is shown as
// a child of the Space in the left bar so that the main Space page is clutter free"): each app and dashboard a row under
// its Space's row, as its tab said it — a draft, paused, a red dot where it fails —, and Routines where the Space has a
// routine or a kept watch; a press opens the Space at that app (its address, `#/space/<project>/<app>`), and the row the
// address names is marked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { parseRoute, routeFor } from "../src/ui/harness/lib/router.js";

/** Every element under one, in order. @param {any} el @returns {any[]} */
const all = (el) => [el, ...[...(el.children || [])].flatMap(all)];

// (fails before: yes — the address named the Space alone; its tab was the page's own)
test("a Space's address may name its app, #/space/<project>/<app>; the Board's is the Space's own", () => {
  assert.deepEqual(parseRoute("#/space/p1/deploys-ab12"), { kind: "space", id: "p1", tab: "deploys-ab12" });
  assert.deepEqual(parseRoute("#/space/p1/%40routines"), { kind: "space", id: "p1", tab: "@routines" });
  assert.deepEqual(parseRoute("#/space/p1"), { kind: "space", id: "p1" }, "no app: the Space as before");
  assert.equal(routeFor("space", { id: "p1", tab: "deploys-ab12" }), "#/space/p1/deploys-ab12");
  assert.equal(routeFor("space", { id: "p1", tab: "@routines" }), "#/space/p1/%40routines");
  assert.equal(routeFor("space", { id: "p1", tab: "overview" }), "#/space/p1", "the Board: the Space's own address");
  assert.equal(routeFor("space", { id: "p1" }), "#/space/p1");
  assert.deepEqual(parseRoute(routeFor(parseRoute("#/space/p1/x-1"))), { kind: "space", id: "p1", tab: "x-1" });
});

const AT = Date.now();
/** Two apps of p1 as `/api/spaces` says them: a kept dashboard whose source fails, and an app's draft. */
const APPS = {
  p1: [
    { name: "deploys-ab12", title: "Deploys", type: "dashboard", v: 1, state: "kept", draft: false, paused: false, liveV: 1,
      sources: { deploys: { at: AT - 60_000, error: "npx exited 1: You are not authenticated.", errorAt: AT, fails: 1, stopped: false, rows: 2 } } },
    { name: "pulse-cd34", title: "Pulse", type: "app", v: 1, state: "draft", draft: true, paused: false, liveV: null, sources: {} },
  ],
};

// (fails before: yes — the owner's idea of 10-29: a Space's apps were tabs on its page alone)
test("under a Space's row: Routines, then each app as its tab said it; a press opens its page; the one open is marked", async () => {
  await drawBar({ open: { p1: 0 }, apps: APPS, routines: { p1: { failed: true } } }, async ({ list, bar, opened }) => {
    const rows = all(list).filter((x) => /^(space-row|space-app-row)\b(?!-)/.test(String(x.className)));
    assert.deepEqual(rows.map((r) => [r.getAttribute("data-tab") || "Space", r.querySelector(".sess-title").textContent, String(r.className).replace(/ current$/, ""), !!r.querySelector(".sdb-dot")]), [
      ["Space", "Space", "space-row", false],
      ["@routines", "Routines", "space-app-row", true],
      ["deploys-ab12", "Deploys", "space-app-row", true],
      ["pulse-cd34", "Pulse · draft", "space-app-row is-draft", false],
    ], "right under the Space's row, Routines first as its tab was");
    assert.equal(rows[2].getAttribute("title"), "Couldn't read deploys at " + rows[2].getAttribute("title").slice("Couldn't read deploys at ".length), "a failure's words in its tip");
    assert.match(rows[2].getAttribute("title"), /: npx exited 1: You are not authenticated\.$/);
    assert.equal(rows[2].querySelector(".sdb-dot").getAttribute("aria-hidden"), "true");
    // (fails before: yes — found reviewing: a row focused from the keyboard lost its focus at each redraw of the bar,
    // which keeps it by this mark) Each row is marked as the bar keeps focus and moves by.
    assert.deepEqual(rows.slice(1).map((r) => r.getAttribute("data-flip")), ["space-app:p1:@routines", "space-app:p1:deploys-ab12", "space-app:p1:pulse-cd34"]);
    assert.equal(rows[2].getAttribute("aria-label"), "Deploys, couldn't read");
    // (as the tab was, seen at S6's live look: "a run failed Routines" had the dot's words first)
    assert.deepEqual([rows[1].getAttribute("aria-label"), rows[1].getAttribute("title")], ["Routines, a run failed", "What runs by itself: a run failed"], "its name first");
    // A press: the Space at that page; the Space's own row, its Board.
    rows[2].dispatch("click");
    rows[1].dispatch("keydown", { key: "Enter", currentTarget: rows[1] });
    rows[0].dispatch("click");
    assert.deepEqual(opened, [["p1", "deploys-ab12"], ["p1", "@routines"], ["p1"]]);
    // The address marks its row alone; the Board's marks the Space's.
    const marked = () => all(list).filter((x) => /\bcurrent\b/.test(String(x.className)) && /^space-/.test(String(x.className))).map((x) => x.getAttribute("data-tab") || "Space");
    bar.atSpace("p1", "deploys-ab12");
    assert.deepEqual(marked(), ["deploys-ab12"]);
    bar.atSpace("p1", null);
    assert.deepEqual(marked(), ["Space"]);
    bar.atSpace(null);
    assert.deepEqual(marked(), []);
  });
});

// (fails before: yes — the bar drew again only where a Space was made or deleted)
test("a Space with no app and no routine has its row alone; an app published since is drawn as the bar hears of it", async () => {
  /** @type {any} */
  const spaces = { open: { p1: 0 }, apps: {}, routines: {} };
  await drawBar(spaces, async ({ list }) => {
    const kids = () => all(list).filter((x) => /^space-app-row\b/.test(String(x.className))).map((x) => x.getAttribute("data-tab"));
    assert.deepEqual(kids(), []);
    spaces.apps = { p1: [APPS.p1[1]] };
    hear({ type: "artifact", name: "pulse-cd34", v: 1, title: "Pulse" });
    for (let i = 0; i < 60 && !kids().length; i++) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(kids(), ["pulse-cd34"]);
    // A source read again says nothing new to its row: the bar is not drawn again.
    const drawn = list.children[0];
    spaces.apps = { p1: [{ ...APPS.p1[1], sources: { s: { at: Date.now(), rows: 3 } } }] };
    hear({ type: "space", project: "p1", seq: 3 });
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(list.children[0], drawn, "the same rows");
  });
});

// (fails before: yes — found reviewing the left bar's apps, 10-29: by time, a project's Space had no row, there being no
// project's group to stand in, so its apps had none either)
test("by time, a project's Space stands under Spaces, named for its project, its apps under it", async () => {
  await drawBar({ open: { p1: 0 }, apps: { p1: [APPS.p1[1]] }, routines: {}, grouped: true }, async ({ list, opened }) => {
    const rows = all(list).filter((x) => /^(space-row|space-app-row)\b(?!-)/.test(String(x.className)));
    assert.deepEqual(rows.map((r) => [r.getAttribute("data-space"), r.getAttribute("data-tab") || "", r.querySelector(".sess-title").textContent]), [
      ["p1", "", "app"],
      ["p1", "pulse-cd34", "Pulse · draft"],
    ]);
    const top = [...list.children].map((x) => String(x.className));
    const spacesHead = top.findIndex((c) => /\bspaces-head\b/.test(c));
    const chatsHead = top.findIndex((c, i) => i > spacesHead && /^projects-head\b/.test(c));
    assert.deepEqual([top.indexOf("space-row"), top.findIndex((c) => /^space-app-row\b/.test(c))], [spacesHead + 1, spacesHead + 2], "right under Spaces");
    assert.ok(chatsHead > spacesHead + 2, "over the chats by time");
    rows[1].dispatch("click");
    assert.deepEqual(opened, [["p1", "pulse-cd34"]]);
  });
});

// (fails before: yes — found reviewing: from an app's page, the address went to the Space's own, and its change closed
// the sheet that had just opened over the page)
test("Folders and worktrees… from the project's menu, its Space's page on screen: the sheet opens over it, the address stays", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /onSpacePlaces: \(id\) => \{\s+placesFirst\(id\);\s+const at = parseRoute\(location\.hash\);\s+if \(at\.kind !== "space" \|\| at\.id !== id\) location\.hash = routeFor\("space", \{ id \}\);\s+\},/);
});

/** What the server answers now: the page's API takes `fetch` once, as it loads, so one fetch hands every bar's to it. */
let answer = /** @type {(url: string, init?: any) => Promise<any>} */ (async () => ({ ok: false, status: 500, json: async () => ({}) }));
const fetchNow = (/** @type {string} */ url, /** @type {any} */ init) => answer(url, init);
/** The events stream as the bar's bus opened it (once per process), and a message on it. @type {any[]} */
const streams = [];
/** @param {any} msg */
const hear = (msg) => {
  for (const s of streams) s.onmessage?.({ data: JSON.stringify(msg) });
};

/**
 * The bar drawn on the stub document with one project, p1, its Spaces as `/api/spaces` says.
 * @param {{ open: Record<string, number>, apps?: Record<string, any[]>, routines?: Record<string, { failed: boolean }>, grouped?: boolean }} spaces
 *   `grouped`: the bar by time, as its filter menu keeps it
 * @param {(w: { list: any, bar: any, opened: any[] }) => void | Promise<void>} check
 */
async function drawBar(spaces, check) {
  const doc = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage, location: g.location };
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  g.EventSource = class { constructor() { streams.push(this); } addEventListener() {} close() {} };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.localStorage = { getItem: (/** @type {string} */ k) => (spaces.grouped && k === "harness.organize" ? "grouped" : null), setItem() {}, removeItem() {} };
  g.location = { hash: "" };
  const now = Date.now();
  g.fetch = fetchNow;
  answer = async (/** @type {string} */ url) => {
    const u = String(url);
    const body = u.endsWith("/api/spaces")
      ? { open: spaces.open, needs: {}, extended: false, next: null, own: [], back: {}, apps: spaces.apps || {}, routines: spaces.routines || {} }
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
    /** @type {any[]} */
    const opened = [];
    const bar = createSidebar(/** @type {any} */ (host), { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {},
      onSpace: (/** @type {string} */ id, /** @type {string | undefined} */ tab) => void opened.push(tab ? [id, tab] : [id]), onSpacePlaces() {}, onYourSpace() {} });
    await bar.load();
    await new Promise((r) => setTimeout(r, 10));
    const list = all(host).find((x) => x.className === "sess-list");
    assert.ok(list, "the list is drawn");
    await check({ list, bar, opened });
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
}
