// @ts-check
// Pop out (HarnessV4_BrowserSize_Plan BS4): a tile's pane in a window of its own — the harness page showing that one
// tab. The app's half (desktop/lib/pop-out.js): the tab it is asked for, the place it keeps, the address it opens. The
// page's half (src/ui/harness/panes/pop-out.js): the tab a window shows alone, the app's word of the tabs out, the line
// between the windows and Follow the main window. And the tile host on the stub document: Pop out on a tile, the tile a
// tab left saying where it is, and a popped window's one tile — its layout kept nowhere, Bring back, a tab its pane
// opens handed to the main window.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { POP_SIZE, popPlaceName, popRoute, popTab, popUrl } from "../desktop/lib/pop-out.js";
import { createPopped, followSwitch, followable, mainLine, popBridgeOf, popTabOf } from "../src/ui/harness/panes/pop-out.js";
import { createPaneHost } from "../src/ui/harness/panes/pane-host.js";
import { stubDocument } from "./helpers/dom-stub.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the app's half", () => {
  test("the tab it opens a window for, the place it keeps, the address: a tool pane's own place, every item's one", () => {
    assert.equal(popTab("browser"), "browser");
    const file = 'file:["C:/work/shop","src/app.js"]';
    assert.equal(popTab(file), file);
    for (const bad of ["", 5, null, "a\nb", "x".repeat(2001)]) assert.equal(popTab(bad), null, String(bad).slice(0, 20));
    assert.deepEqual([popPlaceName("browser"), popPlaceName("next-request"), popPlaceName(file), popPlaceName("artifact:shop-tracker-1a2b")], ["pop:browser", "pop:next-request", "pop:item", "pop:item"]);
    assert.equal(popRoute("#/task/c-1%2F2"), "#/task/c-1%2F2");
    assert.equal(popRoute("#/"), "#/");
    for (const bad of ["javascript:alert(1)", "#/task/a b", "/ui/harness.html", 7, `#/${"a".repeat(400)}`]) assert.equal(popRoute(bad), "", String(bad).slice(0, 20));
    const url = popUrl("http://127.0.0.1:20300", file, "#/task/c1");
    assert.equal(url, `http://127.0.0.1:20300/ui/harness.html?pane=${encodeURIComponent(file)}#/task/c1`);
    assert.equal(popTabOf(new URL(url).search), file, "the page reads back the tab the app opened it for");
    assert.equal(popUrl("http://127.0.0.1:20300", "browser", "javascript:x"), "http://127.0.0.1:20300/ui/harness.html?pane=browser");
    assert.ok(POP_SIZE.width >= 800 && POP_SIZE.height >= 600);
  });
});

describe("the page's half", () => {
  test("the tab a window shows alone; the app's bridge, or none", () => {
    assert.equal(popTabOf("?pane=browser"), "browser");
    assert.equal(popTabOf(""), "");
    assert.equal(popTabOf("?x=1"), "");
    assert.equal(popBridgeOf({}), null);
    assert.equal(popBridgeOf({ filamentPanes: { popOut: () => {} } }), null, "a bridge with no Bring back is none");
    assert.ok(popBridgeOf({ filamentPanes: { popOut: async () => true, bringBack: () => {} } }));
  });

  test("the tabs out: asked once, then heard; a change said only when the list moves; out and back go to the app", async () => {
    /** @type {any[]} */
    const said = [];
    /** @type {any} */
    let heard = null;
    const bridge = {
      popOut: async (/** @type {string} */ t, /** @type {string} */ r) => (said.push(["out", t, r]), true),
      bringBack: (/** @type {string} */ t) => void said.push(["back", t]),
      popped: async () => ["browser"],
      onPopped: (/** @type {any} */ fn) => ((heard = fn), () => void (heard = null)),
    };
    let changes = 0;
    const p = createPopped(bridge, () => changes++);
    await flush();
    assert.deepEqual([p.has("browser"), changes], [true, 1]);
    heard(["browser"]);
    assert.equal(changes, 1, "the same list: nothing to draw");
    heard(["files"]);
    assert.deepEqual([p.has("browser"), p.has("files"), changes], [false, true, 2]);
    p.out("files", "#/task/c1");
    p.back("files");
    assert.deepEqual(said, [["out", "files", "#/task/c1"], ["back", "files"]]);
    p.stop();
    assert.equal(heard, null);
  });

  test("the line between the windows: what one says the others hear; none without a channel; Follow the main window off until turned on", () => {
    class FakeChannel {
      /** @type {FakeChannel[]} */
      static all = [];
      /** @param {string} name */
      constructor(name) {
        this.name = name;
        /** @type {Function[]} */
        this.l = [];
        FakeChannel.all.push(this);
      }
      /** @param {any} m */
      postMessage(m) {
        for (const c of FakeChannel.all) if (c !== this && c.name === this.name) for (const f of c.l) f({ data: m });
      }
      /** @param {string} _t @param {Function} f */
      addEventListener(_t, f) {
        this.l.push(f);
      }
      /** @param {string} _t @param {Function} f */
      removeEventListener(_t, f) {
        this.l = this.l.filter((x) => x !== f);
      }
    }
    const main = mainLine(FakeChannel);
    const popped = mainLine(FakeChannel);
    /** @type {any[]} */
    const got = [];
    const off = popped.on((m) => got.push(m));
    main.post({ type: "chat", route: "#/task/c2" });
    off();
    main.post({ type: "chat", route: "#/task/c3" });
    assert.deepEqual(got, [{ type: "chat", route: "#/task/c2" }]);
    const none = mainLine(null);
    none.post({ type: "ask" });
    assert.equal(typeof none.on(() => {}), "function");
    assert.deepEqual(["#/task/c1", "#/task/c1/plan", "#/", "#/settings", "#/task/a b", "javascript:x", 5].map(followable), [true, true, true, false, false, false, false]);
    /** @type {Map<string, string>} */
    const kept = new Map();
    const store = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, v) };
    const f = followSwitch(store);
    assert.equal(f.get(), false, "it keeps its own chat (proposal_ux question 5)");
    f.set(true);
    assert.equal(followSwitch(store).get(), true, "kept through the window's reload");
    assert.equal(followSwitch(null).get(), false);
  });

  test("a popped window names no tab: it never takes its chat's writing from the main window", async () => {
    const g = /** @type {any} */ (globalThis);
    const had = Object.prototype.hasOwnProperty.call(g, "location");
    const was = g.location;
    try {
      g.location = { search: "?pane=browser", hash: "#/task/c1" };
      const popped = await import(new URL("../src/ui/harness/lib/tab.js?popped", import.meta.url).href);
      assert.equal(popped.TAB_ID, "");
      g.location = { search: "", hash: "" };
      const main = await import(new URL("../src/ui/harness/lib/tab.js?main", import.meta.url).href);
      assert.ok(main.TAB_ID.length > 8);
    } finally {
      if (had) g.location = was;
      else delete g.location;
    }
  });
});

/** The storage the page keeps its layout in, counted. */
function fakeStorage() {
  /** @type {Map<string, string>} */
  const kept = new Map();
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    getItem: (/** @type {string} */ k) => kept.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => {
      writes++;
      kept.set(k, String(v));
    },
    removeItem: (/** @type {string} */ k) => void kept.delete(k),
  };
}

describe("the tile host", () => {
  /** A host on the stub document, its storage counted. @param {any} more */
  function hosted(more = {}) {
    const { document, restore } = stubDocument();
    const g = /** @type {any} */ (globalThis);
    const saved = { local: g.localStorage, session: g.sessionStorage };
    const local = fakeStorage();
    const session = fakeStorage();
    g.localStorage = local;
    g.sessionStorage = session;
    const frame = document.createElement("aside");
    document.body.append(frame);
    /** @type {string[]} */
    const renders = [];
    /** @param {string} id @param {string} label */
    const pane = (id, label) => ({
      id,
      label,
      icon: "globe",
      render: (/** @type {any} */ body) => {
        renders.push(id);
        const el = document.createElement("div");
        el.className = `the-${id}`;
        body.append(el);
      },
    });
    /** @type {any[]} */
    const looks = [];
    const host = createPaneHost(/** @type {any} */ (frame), { panes: [pane("browser", "Browser"), pane("files", "Files")], room: () => ({ row: 1600, win: 1920, height: 900 }), paint: (look) => void looks.push(look), ...more });
    return {
      document,
      frame,
      host,
      renders,
      looks,
      local,
      session,
      done: () => {
        g.localStorage = saved.local;
        g.sessionStorage = saved.session;
        restore();
      },
    };
  }
  /** @param {any} root @param {string} label */
  const btn = (root, label) => root.querySelector(`.tile-btn[aria-label='${label}']`);
  /** A tile's ⋯ opened: its rows by their words. @param {any} t */
  const moreRows = (t) => {
    btn(t.frame, "More").dispatch("click");
    const rows = t.document.querySelectorAll(".zc-menu-item");
    return new Map(rows.map((/** @type {any} */ r) => [(r.querySelector(".zc-menu-label-line") || r.querySelector(".zc-menu-text"))?.textContent, r]));
  };

  // (fails before: yes — Pop out was greyed on every tile, "not built yet" in the app; since UX10 the window is the
  // ⋯'s, In a window of its own, and Pop out puts the tab on top)
  test("in the app: In a window of its own, in the tile's ⋯, puts its tab in a window; the tile says so, shows its window, brings it back", async () => {
    /** @type {Set<string>} */
    const out = new Set();
    /** @type {any[]} */
    const calls = [];
    const pop = { has: (/** @type {string} */ id) => out.has(id), out: (/** @type {string} */ id) => void calls.push(["out", id]), back: (/** @type {string} */ id) => void calls.push(["back", id]) };
    const t = hosted({ pop });
    try {
      t.host.setChat({ id: "p1", chainId: "c1" });
      t.host.openTab("browser");
      assert.deepEqual(t.renders, ["browser"]);
      const popBtn = btn(t.frame, "Pop out");
      assert.ok(popBtn && !popBtn.classList.contains("is-off") && !popBtn.hasAttribute("aria-disabled"), "Pop out is live");
      const rows = moreRows(t);
      assert.ok(rows.has("Pop out"), "the ⋯ has Pop out too");
      const own = rows.get("In a window of its own");
      assert.ok(own && !own.hasAttribute("disabled"));
      own.dispatch("click");
      assert.deepEqual(calls, [["out", "browser"]]);
      // The app says it is out: the tile draws where it is, not the pane — a page shows in one place at a time (BS-D8).
      out.add("browser");
      t.host.popMoved();
      const away = t.frame.querySelector(".tile-away");
      assert.ok(away);
      assert.equal(away.querySelector(".tile-away-words").textContent, "Browser is in a window of its own");
      assert.equal(t.frame.querySelector(".the-browser"), null);
      assert.ok(popBtn.classList.contains("is-on"));
      assert.equal(t.host.refreshInPlace(), true, "the run's pulse leaves it as it is");
      // Pop out on a tab in a window of its own shows its window: it never puts it on top meanwhile.
      popBtn.dispatch("click");
      assert.deepEqual(calls.at(-1), ["out", "browser"]);
      assert.deepEqual(t.host.tops(), []);
      const [show, back] = away.querySelectorAll("button");
      show.dispatch("click");
      back.dispatch("click");
      assert.deepEqual(calls.slice(2), [["out", "browser"], ["back", "browser"]]);
      // Its window closed: the pane drawn here again.
      out.delete("browser");
      t.host.popMoved();
      assert.ok(t.frame.querySelector(".the-browser"));
      assert.deepEqual(t.renders, ["browser", "browser"]);
      // A tab closed here while it is out: its window goes with it.
      out.add("browser");
      t.host.popMoved();
      btn(t.frame, "Close").dispatch("click");
      assert.deepEqual(calls.at(-1), ["back", "browser"]);
    } finally {
      t.done();
    }
  });

  // (UX10: Pop out works in a browser's tab too — on top; only a window of its own is the desktop app's)
  test("in a browser's tab: Pop out puts the tab on top; a window of its own greyed, with why", () => {
    /** @type {string[]} */
    const shown = [];
    const t = hosted({ pop: null, top: { show: (/** @type {string} */ id) => void shown.push(id), moved: () => {} } });
    try {
      t.host.setChat({ id: "p1", chainId: "c1" });
      t.host.openTab("browser");
      const own = moreRows(t).get("In a window of its own");
      assert.ok(own?.hasAttribute("disabled"));
      assert.match(own?.textContent || "", /needs the desktop app/);
      const popBtn = btn(t.frame, "Pop out");
      assert.ok(!popBtn.classList.contains("is-off") && !popBtn.hasAttribute("aria-disabled"));
      popBtn.dispatch("click");
      assert.deepEqual(shown, ["browser"], "its tab on top shown");
      assert.deepEqual(t.host.tops().map((x) => x.id), ["browser"]);
      assert.equal(t.frame.querySelector(".the-browser"), null, "the right bar no longer shows it");
    } finally {
      t.done();
    }
  });

  test("a popped window: its one tab, the whole frame, its layout kept nowhere; Bring back; another tab handed to the main window; Follow the main window", () => {
    /** @type {any[]} */
    const calls = [];
    /** @type {string[]} */
    const handed = [];
    let following = false;
    const pop = {
      has: () => false,
      out: (/** @type {string} */ id) => void calls.push(["out", id]),
      back: (/** @type {string} */ id) => void calls.push(["back", id]),
      follow: { get: () => following, set: (/** @type {boolean} */ on) => void (following = on) },
    };
    const t = hosted({ only: "browser", pop, elsewhere: (/** @type {string} */ id) => void handed.push(id) });
    try {
      t.host.setChat({ id: "p1", chainId: "c1" });
      assert.deepEqual(t.renders, ["browser"], "shown at once, nothing opened");
      assert.deepEqual(t.looks.at(-1), { shown: true, float: false, width: 1600 }, "docked across the whole frame");
      assert.equal(t.host.labelOf("browser"), "Browser");
      t.host.openTab("files");
      t.host.openTab("browser");
      assert.deepEqual(handed, ["files"], "a tab its pane opens goes to the main window");
      assert.equal(t.frame.querySelectorAll(".tile").length, 1);
      t.host.setOpen(false);
      t.host.setArrange("tabs");
      assert.equal(t.host.shown, true, "the panes' switches are the main window's");
      assert.equal(t.local.writes + t.session.writes, 0, "the main window's layout stays as the person left it");
      assert.equal(btn(t.frame, "Pop out"), null);
      assert.ok(btn(t.frame, "Close").classList.contains("hidden"));
      btn(t.frame, "Bring back").dispatch("click");
      assert.deepEqual(calls, [["back", "browser"]]);
      // Its ⋯: Follow the main window, then Bring back.
      btn(t.frame, "More").dispatch("click");
      const rows = t.document.querySelectorAll(".zc-menu-item");
      const words = rows.map((/** @type {any} */ r) => (r.querySelector(".zc-menu-label-line") || r.querySelector(".zc-menu-text"))?.textContent);
      assert.deepEqual(words, ["Follow the main window", "Bring back"]);
      assert.equal(rows[0].getAttribute("aria-checked"), "false");
      rows[0].dispatch("click");
      assert.equal(following, true);
    } finally {
      t.done();
    }
  });
});
