// @ts-check
// Pop out on top (HarnessV4_DesignPass_Plan UX10): a pane popped out of the right bar is a tab on top of the chat,
// after Plan, its pane full size in the chat's place — no message box under it since the owner's word of 10-24, what
// waits for you kept, words going to the box bringing Chat; Back to the side, or its tab's ×,
// puts it back in its tile. The layout's part (tiles.js), the tile host on the stub document (pane-host.js), the
// header's tabs and the views host on the fake DOM (views/tabs.js, views/host.js), the Browser pane's page kept over a
// pane drawn anew (browser.js), and the page's wiring.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as T from "../src/ui/harness/panes/tiles.js";
import { createPaneHost } from "../src/ui/harness/panes/pane-host.js";
import { threadTabId } from "../src/ui/harness/panes/pane-data.js";
import { refreshBrowser, renderBrowser } from "../src/ui/harness/panes/browser.js";
import { createViews, topOf, viewOf } from "../src/ui/harness/views/host.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { createComposer } from "../src/ui/harness/composer/composer.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { teamIO, modelSelects } from "./helpers/team-view.js";
import { sideIO, sideSeams } from "./helpers/side-view.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
/** @param {string} f */
const src = (f) => readFileSync(new URL(`../src/ui/harness/${f}`, import.meta.url), "utf8");

describe("the layout's part", () => {
  const ROOM = { cols: 2, rows: 2 };
  // (fails before: yes — the layout had no tabs on top: Pop out was a window of its own, the desktop app's alone)
  test("a tab on top stays in its tile, out of what shows; opened again it stays there; kept, arranged around; back, in front with the panes on; closed, off the top", () => {
    const L = T.blankLayout();
    T.openTab(L, "changes", "c:a", ROOM);
    T.openTab(L, "terminal", "c:a", ROOM);
    const shownTabs = () => T.shownOf(L, "c:a", ROOM).flatMap((c) => c.tiles.flatMap((t) => t.tabs));
    assert.deepEqual(shownTabs(), ["changes", "terminal"]);
    assert.equal(T.toTop(L, "terminal"), true);
    assert.equal(T.toTop(L, "terminal"), false, "on top already");
    assert.equal(T.toTop(L, "files"), false, "in no tile");
    assert.deepEqual([L.top, shownTabs(), !!T.tileOf(L, "terminal"), T.onTop(L, "terminal")], [["terminal"], ["changes"], true, true], "its tile keeps it; what shows does not");
    // Its pane's button opens it again: it stays on top, and the panes stay as they were.
    L.shown = false;
    T.openTab(L, "terminal", "c:a", ROOM);
    assert.deepEqual([L.top, L.shown], [["terminal"], false]);
    // Another pane opens around it.
    T.openTab(L, "files", "c:a", ROOM);
    assert.deepEqual(shownTabs(), ["changes", "files"]);
    // Kept with the layout, each once and only while it is in a tile.
    assert.deepEqual(T.readLayout(T.layoutJson(L), () => true).top, ["terminal"]);
    const raw = { ...JSON.parse(T.layoutJson(L)), top: ["terminal", "terminal", "gone", 5, "run"] };
    assert.deepEqual(T.readLayout(JSON.stringify(raw), (id) => id !== "gone").top, ["terminal"]);
    assert.deepEqual(T.readLayout(null, () => true).top, []);
    // Arranged anew, as tabs: it keeps its tile, out of what shows.
    T.arrange(L, "tabs", "c:a", ROOM);
    assert.deepEqual([L.top, !!T.tileOf(L, "terminal"), shownTabs()], [["terminal"], true, ["changes", "files"]]);
    // Back to the side: in front in its tile, that tile the one in use, the panes on.
    L.shown = false;
    assert.equal(T.fromTop(L, "terminal"), true);
    assert.equal(T.fromTop(L, "terminal"), false);
    const at = /** @type {any} */ (T.tileOf(L, "terminal"));
    assert.deepEqual([L.top, at.tile.active, L.focus, L.shown], [[], "terminal", at.tile.id, true]);
    assert.ok(shownTabs().includes("terminal"));
    // Closed while on top: it leaves the top with the layout.
    T.toTop(L, "files");
    T.closeTab(L, "files", "c:a");
    assert.deepEqual([L.top, T.tileOf(L, "files")], [[], null]);
  });
});

describe("the tile host", () => {
  /** A host on the stub document: its panes count their draws and refreshes. @param {any} [more] */
  function hosted(more = {}) {
    const { document, restore } = stubDocument();
    const g = /** @type {any} */ (globalThis);
    const saved = { local: g.localStorage, session: g.sessionStorage };
    /** @param {Map<string, string>} kept */
    const storage = (kept) => ({ getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) });
    g.localStorage = storage(new Map());
    g.sessionStorage = storage(new Map());
    const frame = document.createElement("aside");
    document.body.append(frame);
    /** @type {string[]} */
    const renders = [];
    const counts = { refreshes: 0 };
    /** @param {string} id @param {string} label */
    const pane = (id, label) => ({
      id,
      label,
      icon: "squareTerminal",
      render: (/** @type {any} */ body) => {
        renders.push(id);
        const el = document.createElement("div");
        el.className = `the-${id}`;
        body.append(el);
      },
      refresh: () => void counts.refreshes++,
    });
    /** @type {any[]} */
    const looks = [];
    const told = { shown: /** @type {string[]} */ ([]), moved: 0 };
    const host = createPaneHost(/** @type {any} */ (frame), {
      panes: [pane("terminal", "Terminal"), pane("files", "Files")],
      room: () => ({ row: 1600, win: 1920, height: 900 }),
      paint: (look) => void looks.push(look),
      top: { show: (id) => void told.shown.push(id), moved: () => void told.moved++ },
      ...more,
    });
    return {
      document,
      frame,
      host,
      renders,
      counts,
      looks,
      told,
      done: () => {
        g.localStorage = saved.local;
        g.sessionStorage = saved.session;
        restore();
      },
    };
  }
  /** @param {any} root @param {string} label */
  const btn = (root, label) => root.querySelector(`.tile-btn[aria-label='${label}']`);

  // (fails before: yes — Pop out put the tab in a window of its own, the desktop app's, and was greyed in a browser's tab)
  test("Pop out: the tab on top, the right bar without it; drawn full size where the views host shows it, its head's buttons; kept as it was across views; Back to the side", () => {
    const t = hosted({ pop: null });
    try {
      t.host.setChat({ id: "p1", chainId: "c1" });
      t.host.openTab("terminal");
      assert.equal(t.looks.at(-1).shown, true);
      const moved = t.told.moved;
      btn(t.frame, "Pop out").dispatch("click");
      assert.deepEqual(t.told.shown, ["terminal"], "its tab on top shown");
      assert.equal(t.told.moved, moved + 1, "the views host told once");
      assert.deepEqual(t.host.tops(), [{ id: "terminal", label: "Terminal", title: "Terminal", icon: "squareTerminal", tone: "var(--color-sys-gray)" }]);
      assert.equal(t.looks.at(-1).shown, false, "nothing left beside the chat: the right bar hides");
      assert.equal(t.host.whereIs("terminal"), "top");
      assert.equal(t.frame.querySelector(".the-terminal"), null, "the tile let its pane go: a page shows in one place at a time");
      // The views host shows it: drawn in the frame the host gave, its head as a tile's.
      t.host.showTop("terminal");
      const top = t.host.topFrame.querySelector(".tile-top");
      assert.ok(top.querySelector(".the-terminal"));
      assert.equal(top.querySelector(".tile-name").textContent, "Terminal");
      assert.deepEqual(top.querySelectorAll(".tile-btn").map((/** @type {any} */ b) => b.getAttribute("aria-label")), ["Back to the side", "Own window", "Close"]);
      assert.ok(btn(top, "Own window").classList.contains("is-off"), "a window of its own is the desktop app's: greyed, with why");
      assert.deepEqual(t.renders, ["terminal", "terminal"]);
      assert.deepEqual(t.host.front(), ["terminal"], "on screen");
      // Another view, then back: what it held stays, read again in place; the run's pulse reaches it with the bar hidden.
      t.host.showTop("");
      assert.ok(top.classList.contains("hidden"));
      assert.deepEqual(t.host.front(), []);
      t.host.showTop("terminal");
      assert.deepEqual([t.renders.length, t.counts.refreshes], [2, 1], "not drawn anew");
      assert.equal(t.host.refreshInPlace(), true);
      assert.equal(t.counts.refreshes, 2);
      t.host.showTop("files");
      assert.ok(top.classList.contains("hidden"), "a tab not on top shows nothing");
      t.host.showTop("terminal");
      // Ctrl+Alt+B with the right bar empty: the first pane not on top.
      t.host.setOpen(true);
      assert.deepEqual([t.host.whereIs("files"), t.host.whereIs("terminal")], ["front", "top"]);
      // Back to the side: in front in its tile again, the bar on, its view on top gone.
      btn(top, "Back to the side").dispatch("click");
      assert.deepEqual([t.host.tops(), t.host.whereIs("terminal"), t.looks.at(-1).shown], [[], "front", true]);
      assert.ok(t.frame.querySelector(".the-terminal"));
      assert.equal(t.host.topFrame.querySelector(".tile-top"), null);
      // Popped again and closed from its head: closed as in the bar, among the tabs closed lately.
      btn(t.frame, "Pop out").dispatch("click");
      t.host.showTop("terminal");
      btn(t.host.topFrame, "Close").dispatch("click");
      assert.deepEqual([t.host.tops(), t.host.whereIs("terminal")], [[], "none"]);
      assert.deepEqual(t.host.closedTabs().map((c) => c.id), ["terminal"]);
    } finally {
      t.done();
    }
  });

  // (fails before: yes — E41 P4 D12: the Plan beside the chat had no way back to its tab but its ×; the Hunter of p4d:
  // hidden, the panes said it was nowhere, and the views could refresh it only with every other pane)
  test("a pane that is a page of the chat's own: Back to its tab in its head, never Pop out; held however the panes stand; refreshed alone", () => {
    /** @type {string[]} */
    const backs = [];
    const counts = { plan: 0, files: 0 };
    /** @param {string} id @param {Record<string, any>} [more] */
    const own = (id, more = {}) => ({
      id,
      label: id,
      icon: "network",
      render: (/** @type {any} */ body) => body.append(/** @type {any} */ (globalThis).document.createElement("div")),
      refresh: () => void counts[/** @type {"plan" | "files"} */ (id)]++,
      ...more,
    });
    const t = hosted({ panes: [own("plan", { back: { title: "Back to its tab: the plan full size again", run: () => void backs.push("plan") } }), own("files")] });
    try {
      t.host.setChat({ id: "p1", chainId: "c1" });
      t.host.openTab("plan");
      assert.equal(btn(t.frame, "Pop out"), null, "it pops out nowhere: its place is its tab");
      btn(t.frame, "Back to its tab").dispatch("click");
      assert.deepEqual([backs, t.host.tops()], [["plan"], []], "its own way back, run; nothing on top");
      t.host.openTab("files");
      assert.equal(t.host.holds("plan"), true);
      t.host.setOpen(false);
      assert.deepEqual([t.host.whereIs("plan"), t.host.holds("plan")], ["none", true], "hidden: held all the same");
      t.host.setOpen(true);
      counts.plan = counts.files = 0;
      t.host.refreshTab("plan");
      assert.deepEqual(counts, { plan: 1, files: 0 }, "it alone");
      t.host.close("plan");
      assert.equal(t.host.holds("plan"), false);
    } finally {
      t.done();
    }
  });

  // (fails before: yes — no tab on top existed for a thread to follow its chats in)
  test("an agent's thread on top: only in the chat it was popped out in; opened in another, beside the chat there, on top once popped out, unasked it stays; Own window in the app; Alt+W closes it in this chat", () => {
    /** @type {string[]} */
    const released = [];
    /** @type {any[]} */
    const calls = [];
    const pop = { has: () => false, out: (/** @type {string} */ id) => void calls.push(["out", id]), back: (/** @type {string} */ id) => void calls.push(["back", id]) };
    const t = hosted({
      pop,
      thread: {
        render: (/** @type {any} */ body, /** @type {string} */ id) => {
          const el = /** @type {any} */ (globalThis).document.createElement("div");
          el.className = "the-thread";
          body.append(el);
          return () => void released.push(id);
        },
        label: () => ({ label: "Scout", icon: "bot" }),
      },
    });
    const id = threadTabId("sa_1");
    try {
      const a = { id: "p1", chainId: "c1" };
      const b = { id: "p2", chainId: "c2" };
      t.host.setChat(a);
      t.host.openTab(id);
      btn(t.frame, "Pop out").dispatch("click");
      assert.deepEqual(released, ["sa_1"], "the tile let its thread go");
      t.host.showTop(id);
      assert.ok(t.host.topFrame.querySelector(".the-thread"));
      assert.deepEqual(t.host.tops().map((x) => [x.id, x.label, x.icon]), [[id, "Scout", "bot"]]);
      // Another chat: it is not that chat's; its view on top let go. The views host draws that chat's tabs on top as the
      // page switches it next — told here, it would draw them on the chat left (the review of 3b0b53c4c).
      const before = t.told.moved;
      t.host.setChat(b);
      assert.deepEqual([t.host.tops(), released, t.told.moved], [[], ["sa_1", "sa_1"], before]);
      // Opened there too (its card's Open beside): beside that chat, its own panes; popped out, on top there; the page
      // opening it unasked leaves the view.
      t.host.openTab(id);
      assert.deepEqual([t.host.whereIs(id), t.host.tops()], ["front", []], "each chat's own panes: on top in the chat it was popped out in");
      btn(t.frame, "Pop out").dispatch("click");
      assert.deepEqual([t.told.shown.at(-1), t.host.tops().map((x) => x.id)], [id, [id]]);
      const n = t.told.shown.length;
      t.host.openTab(id, { asked: false });
      assert.equal(t.told.shown.length, n);
      // Own window: back in its tile, and in a window of its own from there.
      t.host.showTop(id);
      const own = btn(t.host.topFrame, "Own window");
      assert.ok(!own.classList.contains("is-off"));
      own.dispatch("click");
      assert.deepEqual([calls, t.host.tops(), t.host.whereIs(id)], [[["out", id]], [], "front"]);
      // On top again, Alt+W in it: closed in this chat; the chat it was first opened in keeps it on top.
      btn(t.frame, "Pop out").dispatch("click");
      t.host.showTop(id);
      const doc = /** @type {any} */ (t.document);
      doc.activeElement = btn(t.host.topFrame, "Close");
      assert.equal(t.host.closeFocused(), true);
      delete doc.activeElement;
      assert.deepEqual(t.host.tops(), []);
      t.host.setChat(a);
      assert.deepEqual(t.host.tops().map((x) => x.id), [id]);
    } finally {
      t.done();
    }
  });

  /** The page read again: another host on the storage as the first left it. @param {any} t */
  const reloaded = (t) => {
    const frame = t.document.createElement("aside");
    t.document.body.append(frame);
    /** @param {string} id @param {string} label */
    const quiet = (id, label) => ({ id, label, icon: "squareTerminal", render: () => {} });
    const thread = { render: () => () => {}, label: () => ({ label: "Scout", icon: "bot" }) };
    return createPaneHost(frame, { panes: [quiet("terminal", "Terminal"), quiet("files", "Files")], room: () => ({ row: 1600, win: 1920, height: 900 }), paint: () => {}, thread });
  };
  const CHATS = "filament.harness.panes.chats";
  /** The chats whose panes are kept, by key. */
  const keptChats = () => Object.keys(JSON.parse(/** @type {any} */ (globalThis).localStorage.getItem(CHATS) || "{}")).sort();

  // (fails before: yes — the owner's of 11-05: the panes were the window's, one layout for every chat: a pane opened in
  // one chat showed in all of them, hidden in one, hidden in all)
  test("each chat keeps its own panes: opened in one, not in another; hidden or closed in one, there alone; laid out as it left them; one never shown starts with none; kept through a reload", () => {
    const t = hosted();
    try {
      const a = { id: "p1", chainId: "c1" };
      const b = { id: "p2", chainId: "c2" };
      const where = () => [t.host.whereIs("terminal"), t.host.whereIs("files"), t.host.open];
      t.host.setChat(a);
      t.host.openTab("terminal");
      t.host.openTab("files");
      assert.deepEqual([...where(), t.host.tiles().length], ["front", "front", true, 2]);
      t.host.setChat(b);
      assert.deepEqual([...where(), t.looks.at(-1).shown], ["none", "none", false, false], "a chat never shown: no pane, the panes off");
      t.host.openTab("files");
      assert.deepEqual([...where(), t.host.tiles().length], ["none", "front", true, 1]);
      t.host.setChat(a);
      assert.deepEqual([...where(), t.host.tiles().length], ["front", "front", true, 2], "as it left them: two tiles");
      t.host.setOpen(false);
      t.host.setChat(b);
      assert.deepEqual(where(), ["none", "front", true], "hidden in the other chat alone");
      t.host.close("files");
      t.host.setChat(a);
      assert.deepEqual([t.host.open, t.host.holds("terminal"), t.host.holds("files"), t.looks.at(-1).shown], [false, true, true, false], "hidden as it left them, its panes kept");
      t.host.setChat(b);
      assert.deepEqual([t.host.whereIs("files"), t.host.holds("files"), t.host.holds("terminal")], ["none", false, false], "closed there alone");
      assert.deepEqual(keptChats(), ["c:c1"], "a chat with no pane takes no place among those kept");
      // The page read again: each chat's as it was left.
      const r = reloaded(t);
      r.setChat(b);
      assert.deepEqual([r.open, r.holds("files")], [false, false]);
      r.setChat(a);
      assert.deepEqual([r.open, r.holds("terminal"), r.holds("files")], [false, true, true]);
      r.setOpen(true);
      assert.deepEqual([r.whereIs("terminal"), r.whereIs("files"), r.tiles().length], ["front", "front", 2]);
    } finally {
      t.done();
    }
  });

  // (fails before: yes — there was one layout for every chat, kept under no chat)
  test("the panes every chat shared become the first chat's shown, its own items alone; a chat not sent yet keeps its panes, and once sent keeps them under its session's key; a page's own are another page's", () => {
    const t = hosted();
    const g = /** @type {any} */ (globalThis);
    try {
      const mine = threadTabId("sa_1");
      const theirs = threadTabId("sa_9");
      g.localStorage.setItem("filament.harness.panes", JSON.stringify({ v: 1, cols: [{ w: 1, tiles: [{ id: "t1", tabs: ["terminal", mine, theirs], active: "terminal", h: 1 }] }], arrange: "column", place: "auto", widths: {}, owners: { [mine]: ["c:c1", "c:c2"], [theirs]: ["c:c9"] }, shown: true, focus: "t1", seq: 1, held: [], top: [] }));
      const r = reloaded(t);
      r.setChat({ id: "p1", chainId: "c1" });
      assert.deepEqual([r.whereIs("terminal"), r.holds(mine), r.holds(theirs), r.arrange], ["front", true, false, "column"], "the first chat's: the shared panes and its own thread, not another chat's");
      // An item other chats held too is this one's alone now: closed, it goes, and can open again.
      r.close(mine);
      assert.deepEqual([r.holds(mine), r.closedTabs().map((x) => x.id)], [false, [mine]]);
      r.openTab(mine);
      r.setChat({ id: "p9", chainId: "c9" });
      assert.deepEqual([r.whereIs("terminal"), r.holds(theirs), r.open, r.arrange], ["none", false, false, "column"], "another: none, how panes open the person's still");
      // A chat not sent yet: its panes and its thread kept while another shows, then under its session's key once sent.
      const draft = { id: "p5", chainId: /** @type {string | null} */ (null) };
      const draftThread = threadTabId("sa_5");
      r.setChat(draft);
      r.openTab("files");
      r.openTab(draftThread);
      r.setChat({ id: "p1", chainId: "c1" });
      r.setChat(draft);
      assert.deepEqual([r.whereIs("files"), r.holds(draftThread), keptChats()], ["front", true, ["c:c1", "p:p5"]]);
      draft.chainId = "c5";
      r.setChat(draft);
      assert.deepEqual([r.whereIs("files"), r.holds(draftThread), keptChats()], ["front", true, ["c:c1", "c:c5"]], "re-keyed, not another chat's");
      // A page's own chats left behind: the next page drops them.
      r.setChat({ id: "p6", chainId: null });
      r.openTab("terminal");
      assert.ok(keptChats().includes("p:p6"));
      const next = reloaded(t);
      assert.deepEqual(keptChats(), ["c:c1", "c:c5"]);
      next.setChat({ id: "p6", chainId: null });
      assert.equal(next.open, false, "another page's chat that never was sent: none");
    } finally {
      t.done();
    }
  });

  // (fails before: yes — the review of 3b0b53c4c: a chat left around its first send came back with no pane, its panes
  // kept under its page's key and looked for under its session's)
  test("a chat left around its first send keeps its panes: sent before it was left, or while another showed", () => {
    const t = hosted();
    try {
      const other = { id: "p1", chainId: "c1" };
      const sent = { id: "p7", chainId: /** @type {string | null} */ (null) };
      t.host.setChat(sent);
      t.host.openTab("terminal");
      // Its session made, the panes not told yet.
      sent.chainId = "c7";
      t.host.setChat(other);
      t.host.setChat(sent);
      assert.equal(t.host.whereIs("terminal"), "front", "sent, then left");
      const late = { id: "p8", chainId: /** @type {string | null} */ (null) };
      t.host.setChat(late);
      t.host.openTab("files");
      t.host.setChat(other);
      // Sent while another showed.
      late.chainId = "c8";
      t.host.setChat(late);
      assert.deepEqual([t.host.whereIs("files"), keptChats()], ["front", ["c:c7", "c:c8"]], "under its session's key now, its page's gone");
    } finally {
      t.done();
    }
  });

  // (fails before: yes — the review of 3b0b53c4c: a chat came back after one with no pane showing its panes as drawn
  // when it was left, and what they held ran on meanwhile)
  test("a chat comes back drawn for itself: what was drawn for it is let go while another shows", () => {
    /** @type {string[]} */
    const released = [];
    const t = hosted({
      thread: {
        render: (/** @type {any} */ body, /** @type {string} */ id) => {
          body.append(/** @type {any} */ (globalThis).document.createElement("div"));
          return () => void released.push(id);
        },
        label: () => ({ label: "Scout", icon: "bot" }),
      },
    });
    try {
      const a = { id: "p1", chainId: "c1" };
      const b = { id: "p2", chainId: "c2" };
      t.host.setChat(a);
      t.host.openTab("terminal");
      t.host.openTab(threadTabId("sa_3"));
      const drawn = t.renders.length;
      t.host.setChat(b);
      assert.deepEqual([released, t.frame.querySelector(".the-terminal")], [["sa_3"], null], "its thread let go, its pages gone");
      t.host.setChat(a);
      assert.equal(t.renders.length, drawn + 1, "the Terminal drawn anew, for it");
    } finally {
      t.done();
    }
  });
});

describe("the header's tabs and the views host", () => {
  /** @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
  const all = (n, pred, out = []) => {
    if (n && typeof n === "object") {
      if (pred(n)) out.push(n);
      for (const k of n.kids || []) all(k, pred, out);
    }
    return out;
  };
  /** @param {any} n @param {string} cls */
  const one = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls))[0];
  /** @param {any} n @param {string} id */
  const tabOf = (n, id) => buttonsOf(n).find((b) => b.attrs["data-view"] === id);
  /** The tabs that show: each one's word and whether it is on screen. @param {any} n */
  const tabsOn = (n) => buttonsOf(n).filter((b) => !b.classList.contains("hidden")).map((b) => [textOf(one(b, "view-tab-label")), b.attrs["aria-selected"]]);
  /** A chat with a session. @param {string} id */
  const sessionChat = (id) => ({ id, chainId: `chain-${id}`, title: id, turns: [], live: null, viewTab: /** @type {string | undefined} */ (undefined), view: { settings: { effective: { engine: {} } } } });

  /** The pane host's side, as the views host reads it. */
  function topIO() {
    /** @type {{ id: string, label: string, icon: string, title: string }[]} */
    let list = [];
    /** @type {string[]} */
    const shown = [];
    /** @type {string[]} */
    const back = [];
    const io = { el: fakeH("div", { class: "vw vw-pane" }), list: () => list, show: (/** @type {string} */ id) => void shown.push(id), back: (/** @type {string} */ id) => void back.push(id) };
    return { io, set: (/** @type {typeof list} */ l) => void (list = l), shown, back };
  }
  /** @param {any} top */
  function hostOf(top) {
    const frame = fakeH("div", { class: "conv-frame" });
    const slot = fakeH("div", { class: "view-tabs-slot" });
    /** @type {any[]} */
    const shown = [];
    const views = createViews({
      frame,
      slot,
      overview: { el: fakeH("div", {}), setShown: () => {}, paint: () => {} },
      mk: fakeH,
      api: async () => null,
      openAgent: () => {},
      openRunLog: () => {},
      onShow: (chat) => void shown.push([chat.id, chat.viewTab]),
      loadRun: async () => {},
      later: () => {},
      team: teamIO(),
      side: /** @type {any} */ (sideIO()),
      sideSeams: sideSeams().seams,
      drawIn: fakeDrawIn, place: (p, k) => p.replaceChildren(...k),
      modelSelect: modelSelects().make,
      top,
    });
    return { frame, slot, shown, views };
  }
  const TERMINAL = { id: "terminal", label: "Terminal", icon: "squareTerminal", title: "Terminal" };

  // (fails before: yes — the header's tabs were the views' alone)
  test("a pane on top: a tab after Plan with its ×; its view in the frame; the × and Delete put it back; gone, the chat shows Chat", () => {
    const top = topIO();
    const { frame, slot, shown, views } = hostOf(top.io);
    assert.ok(frame.kids.includes(top.io.el), "its frame is in the conversation's");
    const a = sessionChat("on-top");
    views.setChat(a);
    assert.equal(top.shown.at(-1), "", "no pane on top: none shown");
    top.set([TERMINAL]);
    views.topsMoved();
    assert.deepEqual(tabsOn(slot).map((x) => x[0]), ["Chat", "Agents", "Terminal"], "after the views' (Plan shows with a task graph; Overview while its view does, the owner's of 10-30)");
    const tab = tabOf(slot, "pane:terminal");
    assert.ok(tab.classList.contains("is-top"));
    views.showTop("terminal");
    assert.deepEqual([views.view, a.viewTab, frame.classList.contains("view-pane"), top.shown.at(-1), tab.attrs["aria-selected"]], ["pane:terminal", "pane:terminal", true, "terminal", "true"]);
    assert.deepEqual(shown.at(-1), ["on-top", "pane:terminal"], "the address follows (router.js keeps it the chat's)");
    assert.equal(frame.classList.contains("view-plan") || frame.classList.contains("view-overview"), false);
    // Chat, then its tab again.
    tabOf(slot, "chat").dispatch("click");
    assert.deepEqual([views.view, frame.classList.contains("view-pane"), top.shown.at(-1)], ["chat", false, ""]);
    tab.dispatch("click");
    assert.equal(views.view, "pane:terminal");
    // Its ×, and Delete on its tab: the pane host's to put back.
    one(tab, "view-tab-x").dispatch("click");
    assert.deepEqual([top.back, views.view], [["terminal"], "pane:terminal"], "the × alone never switches the view");
    slot.kids[0].dispatch("keydown", { key: "Delete" });
    assert.deepEqual(top.back, ["terminal", "terminal"]);
    // The pane host put it back and says so: the tab goes, the chat shows Chat, the address follows.
    top.set([]);
    views.topsMoved();
    assert.deepEqual([views.view, frame.classList.contains("view-pane"), tabOf(slot, "pane:terminal")], ["chat", false, undefined]);
    assert.deepEqual(shown.at(-1), ["on-top", "chat"]);
    views.show("pane:files");
    assert.equal(views.view, "chat", "a pane not on top is no view");
    assert.deepEqual([topOf("pane:x"), topOf("plan"), topOf(undefined), viewOf({ chainId: null, viewTab: "pane:x" }), viewOf({ chainId: "c", viewTab: "plan" })], ["x", "", "", "pane:x", "plan"]);
  });

  // (fails before: yes — the owner's word of 11-02: "When browser expanded to show as full screen in a tab then the
  // Watch Live button should not show in that tab")
  test("the Browser on top says so on the frame, and the browser's line is not drawn over it: another pane on top keeps it", () => {
    const top = topIO();
    const { frame, views } = hostOf(top.io);
    views.setChat(sessionChat("browser-on-top"));
    top.set([TERMINAL, { id: "browser", label: "Browser", icon: "globe", title: "Browser" }]);
    views.topsMoved();
    views.showTop("browser");
    assert.deepEqual([frame.classList.contains("view-pane"), frame.classList.contains("view-browser")], [true, true]);
    views.showTop("terminal");
    assert.deepEqual([frame.classList.contains("view-pane"), frame.classList.contains("view-browser")], [true, false], "Watch live opens the Browser from another pane");
    views.show("chat");
    assert.equal(frame.classList.contains("view-browser"), false);
    assert.match(readFileSync("src/ui/harness.css", "utf8"), /\n\.conv-frame\.view-browser > \.dock \.browser-line \{ display: none; \}/);
  });

  // (fails before: yes — a chat with no session had no tabs at all)
  test("a chat with no session yet: Chat and its panes on top alone; Chat comes back; the tabs leave with the last", () => {
    const top = topIO();
    const { slot, views } = hostOf(top.io);
    const draft = { ...sessionChat("draft"), chainId: null };
    views.setChat(draft);
    assert.deepEqual(slot.kids, []);
    top.set([{ id: "files", label: "Files", icon: "folder", title: "Files" }]);
    views.topsMoved();
    assert.deepEqual(tabsOn(slot), [["Chat", "true"], ["Files", "false"]]);
    views.showTop("files");
    assert.equal(views.view, "pane:files");
    views.show("plan");
    assert.equal(views.view, "pane:files", "no session: no Plan");
    views.show("chat");
    assert.equal(views.view, "chat");
    top.set([]);
    views.topsMoved();
    assert.deepEqual(slot.kids, []);
  });
});

describe("the Browser pane", () => {
  // (fails before: yes — the old pane's stop parked every page the window showed, the new pane's too: moved on top or
  // back to the side, the page went and stayed gone)
  test("a pane drawn anew keeps its page over the window: the old one's late stop parks nothing; the new one's does", async () => {
    const { document, restore } = stubDocument();
    try {
      /** @type {any[]} */
      const said = [];
      const bridge = { place: async (/** @type {string} */ tab) => (said.push(["place", tab]), true), park: () => void said.push(["park"]) };
      const st = { available: true, tabs: [{ id: "t1", url: "https://shop.test/", title: "Shop", shown: true }], active: "t1", taken: false, sites: [], busy: null };
      /** @param {number} width */
      const mount = (width) => {
        const body = document.createElement("div");
        document.body.append(body);
        renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: async () => st, bridge, doc: /** @type {any} */ (document) });
        body.querySelector(".brw-stage").getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 600, right: width, bottom: 600 });
        return body;
      };
      const tile = mount(500);
      await flush();
      assert.deepEqual(said, [["place", "t1"]]);
      // Popped on top: the tile lets its pane go; the one on top places the page there.
      tile.remove();
      const onTop = mount(1200);
      await flush();
      assert.deepEqual(said, [["place", "t1"], ["place", "t1"]]);
      // The tile's pane stops late: the page stays where the new one put it.
      refreshBrowser(/** @type {any} */ (tile));
      await flush();
      assert.equal(said.filter((x) => x[0] === "park").length, 0);
      // The one on top goes (back to the side): it parks.
      onTop.remove();
      refreshBrowser(/** @type {any} */ (onTop));
      await flush();
      assert.deepEqual(said.at(-1), ["park"]);
    } finally {
      restore();
    }
  });
});

// (fails before: yes — nothing wired a tab on top)
test("the page's wiring: the pane host tells the views host, the views host draws the pane host's frame; the chat's address keeps the pane on top; no box under it, what waits for you kept", () => {
  const app = src("app.js");
  assert.match(app, /top: \{ show: \(id\) => views\.showTop\(id\), moved: \(\) => views\.topsMoved\(\) \},/);
  assert.match(app, /top: \{ el: rail\.topFrame, list: \(\) => rail\.tops\(\), show: \(id\) => rail\.showTop\(id\), back: \(id\) => rail\.fromTop\(id\) \},/);
  assert.match(app, /if \(!\(route\.view === "chat" && topOf\(viewOf\(open\)\)\)\) views\.show\(route\.view\);/, "back from Settings, the pane is still on screen");
  const css = src("views/views.css");
  assert.match(css, /\.conv-frame\.view-pane > \.vw-pane \{ display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column;/);
  // (fails before: yes — the owner's word of 10-24, "i wonder if the composer needs to be shown when browser is popped
  // into the tab": the box and its strip stood under the pane, a fifth of the window's height off a page scaled to fit)
  assert.match(css, /\.conv-frame\.view-pane > \.dock :is\(\.composer-shell, \.composer-strip\) \{ display: none; \}/, "the box and its strip give their room");
  assert.doesNotMatch(css, /view-pane[^{]*(> \.dock \{ display: none|composer-asks)/, "what waits for you stays: a question, a proposal, a site's permission");
  assert.match(app, /toBox: \(\) => \{\n    if \(topOf\(viewOf\(chatOf\(state\.currentId\)\)\)\) views\.show\("chat"\);\n  \},/, "words going to the box bring Chat");
  assert.match(css, /\.view-tabs-top \{ display: contents; \}/);
});

// (fails before: yes — the box had no word for the app before it took words or the keys)
test("the box asks to be on screen before it takes words or the keys — focused, added to, a message taken back — and not for a draft put back", () => {
  const d = stubDocument();
  try {
    const host = /** @type {any} */ (d.document.createElement("div"));
    let asked = 0;
    const c = createComposer(host, { onSend: () => true, onStop: () => {}, getChat: () => ({ chainId: "c1", turns: [] }), toBox: () => void asked++ });
    c.setDraft("kept");
    assert.equal(asked, 0, "a draft put back stays where it is");
    c.focus();
    c.add("a picture's words");
    c.takeBack("the message taken back");
    assert.equal(asked, 3);
    assert.match(c.draft(), /the message taken back[\s\S]*a picture's words/);
  } finally {
    d.restore();
  }
});
