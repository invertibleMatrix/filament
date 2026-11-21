// @ts-check
// The Browser pane (HarnessV4_Browser_Plan BR4) on the stub document: the chat's browser as it stands — its address,
// its tabs, who has it — the person's acts, the page put over the stage through the app's bridge and parked while
// something of the harness's own covers it (its picture standing in), and a picture alone in a browser tab.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { COVERS, DRIVE_MS, bridgeOf, covers, drives, lineOf, refreshBrowser, renderBrowser } from "../src/ui/harness/panes/browser.js";
import { createBrowserHost } from "../src/app/browser/host.js";
import { createBrowsers } from "../src/app/browser/registry.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
/** @param {any} root @param {string} sel */
const one = (root, sel) => root.querySelector(sel);

/** The chat's browser as the server tells it. @param {any} [more] */
const stateOf = (more = {}) => ({ available: true, tabs: [{ id: "t1", url: "https://shop.test/login", title: "Shop", shown: true }], active: "t1", taken: false, takenAt: null, sites: [], busy: null, lastUrl: "", ...more });

/** The admin API's stand-in: each call kept, a GET answered with the state, a POST with the state after it. */
function fakeApi(start = stateOf()) {
  /** @type {[string, any][]} */
  const calls = [];
  let st = start;
  return {
    calls,
    set: (/** @type {any} */ s) => (st = s),
    api: async (/** @type {string} */ path, /** @type {any} */ init) => {
      calls.push([path, init?.body ?? null]);
      if (init?.method === "POST") {
        if (init.body.act === "take") st = { ...st, taken: true, hand: init.body.hand === true };
        if (init.body.act === "give") st = { ...st, taken: false, hand: false };
        return { ok: true, state: st };
      }
      return st;
    },
  };
}
function fakeBridge() {
  /** @type {any[]} */
  const said = [];
  return { said, place: async (/** @type {string} */ tab, /** @type {any} */ rect) => (said.push(["place", tab, rect]), true), park: () => void said.push(["park"]) };
}
/** A stand-in for the desktop app that holds the chat's pages: each tab a page that answers every command, its loads said. */
function fakeApp() {
  const host = createBrowserHost();
  /** @type {(m: any) => void} */
  let take = () => {};
  const send = (/** @type {any} */ m) =>
    void setTimeout(() => {
      if (m.op !== "cdp") return take({ n: m.n, ok: true, result: null });
      if (m.method === "Page.getFrameTree") return take({ n: m.n, ok: true, result: { frameTree: { frame: { id: "F", url: "about:blank" } } } });
      if (m.method !== "Page.navigate") return take({ n: m.n, ok: true, result: {} });
      take({ n: m.n, ok: true, result: { loaderId: "L" } });
      take({ op: "event", tab: m.tab, method: "Page.frameNavigated", params: { frame: { id: "F", url: m.params?.url } } });
      take({ op: "event", tab: m.tab, method: "Page.loadEventFired", params: {} });
    }, 1);
  take = host.attach({ send, close: () => {} });
  return host;
}

describe("the Browser pane", () => {
  test("its words: who has the browser, what the agent does, why nothing shows", () => {
    assert.equal(lineOf(null, { inApp: true }), "Reading the chat's browser…");
    assert.match(lineOf({ available: false }, { inApp: false }), /^No browser here yet: open the Filament desktop app, or install Chrome or Chromium/);
    assert.match(lineOf({ available: false }, { inApp: true }), /^Connecting to Filament/);
    assert.equal(lineOf({ available: true, taken: true, tabs: [] }, { inApp: true }), "You have the browser: the agent waits until you give it back.");
    assert.equal(lineOf({ available: true, busy: { words: "click e3" }, tabs: [{}] }, { inApp: true }), "The agent: click e3");
    // (fails before: yes — HarnessV4_AgentTools_Plan AT-D2: a sub-agent had no browser, so nobody else's call was said)
    assert.equal(lineOf({ available: true, busy: { words: "navigate localhost:5173", by: "Designer" }, tabs: [{}] }, { inApp: true }), "Designer: navigate localhost:5173");
    assert.equal(lineOf({ available: true, tabs: [{}] }, { inApp: true }), "");
    assert.match(lineOf({ available: true, tabs: [{}] }, { inApp: false }), /^A picture of the page, read every 2 s/);
    assert.equal(covers({ x: 0, y: 0, width: 100, height: 100 }, [{ x: 90, y: 90, width: 50, height: 50 }]), true);
    assert.equal(covers({ x: 0, y: 0, width: 100, height: 100 }, [{ x: 100, y: 0, width: 50, height: 50 }]), false);
    assert.equal(covers({ x: 0, y: 0, width: 100, height: 100 }, [{ x: 10, y: 10, width: 0, height: 0 }]), false, "a hidden one covers nothing");
    assert.equal(bridgeOf({}), null);
    assert.equal(bridgeOf({ filamentBrowser: { place: () => {}, park: () => {} } })?.park instanceof Function, true);
  });

  test("in the app: the page goes over the stage, parks while a menu covers it — its picture standing in — and comes back", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      const f = fakeApi();
      const bridge = fakeBridge();
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: f.api, bridge, doc: /** @type {any} */ (document) });
      const stage = one(body, ".brw-stage");
      stage.getBoundingClientRect = () => ({ left: 300, top: 80, width: 500, height: 600, right: 800, bottom: 680 });
      await flush();
      assert.deepEqual(f.calls[0], ["/sessions/c1/browser", null]);
      assert.equal(one(body, ".brw-address").value, "https://shop.test/login");
      assert.equal(one(body, ".brw-tab.on .brw-tab-name").textContent, "Shop");
      assert.deepEqual(bridge.said, [["place", "t1", { x: 300, y: 80, width: 500, height: 600 }]]);
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(bridge.said.length, 1, "the same place is not asked again");
      // A menu of the harness's own over the stage: the page parks, its picture stands in.
      const m = document.createElement("div");
      m.className = "zc-menu";
      m.getBoundingClientRect = () => ({ left: 700, top: 100, width: 200, height: 160, right: 900, bottom: 260 });
      document.body.append(m);
      assert.ok(document.querySelectorAll(COVERS).includes(m));
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(bridge.said.at(-1), ["park"]);
      assert.match(String(one(body, ".brw-picture").src), /^\/api\/sessions\/c1\/browser\/shot\?at=\d+$/);
      m.remove();
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(bridge.said.at(-1), ["place", "t1", { x: 300, y: 80, width: 500, height: 600 }]);
      assert.ok(one(body, ".brw-picture").classList.contains("hidden"), "the page itself shows again");
      // (fails before: yes — the review of 11-09: a first-run tip darkens the window round a page left lit) A tip's
      // shade, its box only its hole far from the stage: the page parks, its picture darkened with the rest.
      const shade = document.createElement("div");
      shade.className = "coach-dim";
      shade.getBoundingClientRect = () => ({ left: 20, top: 20, width: 90, height: 40, right: 110, bottom: 60 });
      document.body.append(shade);
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(bridge.said.at(-1), ["park"]);
      shade.remove();
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(bridge.said.at(-1), ["place", "t1", { x: 300, y: 80, width: 500, height: 600 }]);
      // The pane goes (another tab of its tile, the chat switched): the page parks, and the pane stops reading.
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(bridge.said.at(-1), ["park"]);
    } finally {
      restore();
    }
  });

  // (fails before: yes — the owner's report of 10-26: the page stayed over Library, Settings and every other full-frame
  // screen, which leave the panes laid out beneath them, hidden and inert, their rectangle as it was)
  test("in the app: a full-frame screen over the panes parks the page, the chat back places it again; a hidden stage parks it", async () => {
    const { document, restore } = stubDocument();
    const row = document.createElement("div");
    const body = document.createElement("div");
    row.append(body);
    document.body.append(row);
    try {
      const f = fakeApi();
      const bridge = fakeBridge();
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: f.api, bridge, doc: /** @type {any} */ (document) });
      const stage = one(body, ".brw-stage");
      stage.getBoundingClientRect = () => ({ left: 300, top: 80, width: 500, height: 600, right: 800, bottom: 680 });
      await flush();
      const placed = ["place", "t1", { x: 300, y: 80, width: 500, height: 600 }];
      assert.deepEqual(bridge.said, [placed]);
      // Settings opens over the frame: the panes wait beneath it, inert (shell.js `setScreen`).
      row.setAttribute("inert", "");
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(bridge.said.at(-1), ["park"]);
      assert.ok(one(body, ".brw-picture").classList.contains("hidden"), "no picture stands in: nothing of the pane shows");
      row.removeAttribute("inert");
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(bridge.said.at(-1), placed, "the chat back: the page over the stage again");
      // A stage hidden by its styles (a floating pane slid shut) keeps its rectangle: the page parks all the same.
      /** @type {any} */
      let asked = null;
      stage.checkVisibility = (/** @type {any} */ o) => ((asked = o), false);
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(bridge.said.at(-1), ["park"]);
      assert.equal(asked?.visibilityProperty, true, "visibility: hidden counts as not shown");
    } finally {
      // The pane let go whatever was asserted: its timers stop, so a failure fails and does not hang the run.
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
      restore();
    }
  });

  // (fails before: yes — the review of 10-26: a screen opened while the page's place was still on its way to the app
  // parked nothing, and the page landed over the screen until the next check)
  test("in the app: a place still on its way when a screen opens is parked behind it at once, and lands as nothing", async () => {
    const { document, restore } = stubDocument();
    const row = document.createElement("div");
    const body = document.createElement("div");
    row.append(body);
    document.body.append(row);
    try {
      /** @type {any[]} */
      const said = [];
      /** @type {(() => void)[]} */
      const lands = [];
      const bridge = {
        place: (/** @type {string} */ tab) => (said.push(["place", tab]), new Promise((r) => lands.push(() => r(true)))),
        park: () => void said.push(["park"]),
      };
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: fakeApi().api, bridge, doc: /** @type {any} */ (document) });
      one(body, ".brw-stage").getBoundingClientRect = () => ({ left: 300, top: 80, width: 500, height: 600, right: 800, bottom: 680 });
      await flush();
      assert.deepEqual(said, [["place", "t1"]], "asked; the app has not answered");
      row.setAttribute("inert", "");
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(said, [["place", "t1"], ["park"]], "the park goes behind the place on its way");
      lands.shift()?.();
      await flush();
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(said, [["place", "t1"], ["park"]], "its answer marks nothing placed: nothing more to park");
      row.removeAttribute("inert");
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(said.at(-1), ["place", "t1"], "the chat back: placed again");
    } finally {
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
      restore();
    }
  });

  test("the person's acts: take over and give back, an address, a tab shown or closed — each the chat's browser's", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      const f = fakeApi(stateOf({ tabs: [{ id: "t1", url: "https://shop.test/login", title: "Shop", shown: true }, { id: "t2", url: "https://pay.test/", title: "Pay", shown: false, by: "Designer" }] }));
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: f.api, bridge: null, doc: /** @type {any} */ (document) });
      await flush();
      // A sub-agent's tab says whose it is (AT-D2); the chat's own agent's says nothing more.
      assert.deepEqual(body.querySelectorAll(".brw-tab").map((/** @type {any} */ t) => one(t, ".brw-tab-by")?.textContent ?? null), [null, "Designer"]);
      assert.match(String(body.querySelectorAll(".brw-tab")[1].getAttribute("title")), /^Designer's tab: Pay/);
      const take = one(body, ".brw-take");
      assert.equal(one(take, ".zc-btn-label").textContent, "Take over");
      take.dispatch("click");
      await flush();
      assert.deepEqual(f.calls.at(-1), ["/sessions/c1/browser", { act: "take" }]);
      assert.equal(one(take, ".zc-btn-label").textContent, "Give back");
      assert.equal(one(body, ".brw-line").textContent, "You have the browser: the agent waits until you give it back.");
      const address = one(body, ".brw-address");
      address.value = "localhost:5173";
      address.dispatch("keydown", { key: "Enter" });
      await flush();
      assert.deepEqual(f.calls.at(-1), ["/sessions/c1/browser", { act: "navigate", url: "localhost:5173" }]);
      const tabs = body.querySelectorAll(".brw-tab");
      assert.equal(tabs.length, 2);
      tabs[1].dispatch("click");
      await flush();
      assert.deepEqual(f.calls.at(-1), ["/sessions/c1/browser", { act: "select", tab: "t2" }]);
      one(tabs[0], ".brw-tab-x").dispatch("click");
      await flush();
      assert.deepEqual(f.calls.at(-1), ["/sessions/c1/browser", { act: "close", tab: "t1" }]);
      // Outside the app the page is its picture.
      assert.match(String(one(body, ".brw-picture").src), /^\/api\/sessions\/c1\/browser\/shot\?at=\d+$/);
      assert.match(one(body, ".brw-line").textContent, /You have the browser/);
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
      await flush();
    } finally {
      restore();
    }
  });

  // (fails before: yes — the bug round of 10-23: a toast came under the live page, and the tab strip was drawn anew at
  // every read, so a press held across one was lost)
  test("a toast covers the page as a menu does; the tab strip is drawn again only when its tabs change", async () => {
    assert.match(COVERS, /\.zc-toast/);
    assert.match(COVERS, /\.toast\.show/);
    const { document, restore } = stubDocument();
    try {
      const api = fakeApi();
      const body = document.createElement("div");
      document.body.append(body);
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: api.api, bridge: null, doc: /** @type {any} */ (document) });
      await flush();
      const first = one(body, ".brw-tab");
      assert.ok(first);
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(one(body, ".brw-tab"), first, "the same tab, kept");
      api.set(stateOf({ tabs: [{ id: "t1", url: "https://shop.test/login", title: "Shop — signed in", shown: true }] }));
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.notEqual(one(body, ".brw-tab"), first, "a changed title draws it again");
      assert.match(one(body, ".brw-tab-name").textContent, /signed in/);
      body.remove();
    } finally {
      restore();
    }
  });

  // HarnessV4_BrowserSize_Plan BS2. (fails before: yes — nobody could choose the page's size)
  test("the size chip: the shown tab's size, a menu of the four sizes, Custom… and Fit the pane — each the chat's browser's", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      const f = fakeApi(stateOf({ tabs: [{ id: "t1", url: "https://shop.test/login", title: "Shop", shown: true, size: { width: 390, height: 844 }, fit: false }] }));
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: f.api, bridge: null, doc: /** @type {any} */ (document) });
      await flush();
      const chip = one(body, ".brw-size");
      assert.equal(one(chip, ".zc-btn-label").textContent, "390 × 844");
      chip.dispatch("click", { currentTarget: chip });
      const rows = document.querySelectorAll(".zc-menu-item");
      assert.deepEqual(rows.map((/** @type {any} */ r) => [one(r, ".zc-menu-label-line")?.textContent || one(r, ".zc-menu-text")?.textContent, r.getAttribute("aria-checked")]), [
        ["Desktop", "false"], ["Laptop", "false"], ["Tablet", "false"], ["Phone", "true"], ["Custom…", "false"], ["Fit the pane", "false"],
      ]);
      rows[2].dispatch("click");
      await flush();
      assert.deepEqual(f.calls.at(-1), ["/sessions/c1/browser", { act: "size", size: "tablet" }]);
      f.set(stateOf({ tabs: [{ id: "t1", url: "https://shop.test/login", title: "Shop", shown: true, size: { width: 390, height: 844 }, fit: true }] }));
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(one(chip, ".zc-btn-label").textContent, "Fits the pane");
      body.remove();
    } finally {
      restore();
    }
  });

  // (fails before: yes — the bug hunt of 10-30, UIP-11: the site opened with no noopener, so in a browser's tab it held
  // `window.opener` and could send the harness's tab elsewhere — reverse tabnabbing)
  test("⋯'s Open this page in your browser opens the site with no opener", async () => {
    const { document, restore } = stubDocument();
    const g = /** @type {any} */ (globalThis);
    const hadOpen = Object.prototype.hasOwnProperty.call(g.window, "open") ? g.window.open : undefined;
    /** @type {any[][]} */
    const opened = [];
    g.window.open = (/** @type {any[]} */ ...a) => void opened.push(a);
    const body = document.createElement("div");
    try {
      document.body.append(body);
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: fakeApi().api, bridge: null, doc: /** @type {any} */ (document) });
      await flush();
      const more = /** @type {any} */ (body.querySelectorAll(".brw-btn").find((/** @type {any} */ b) => String(b.getAttribute("aria-label")).startsWith("The sites it may act on")));
      more.dispatch("click", { currentTarget: more });
      const item = /** @type {any} */ (document.querySelectorAll(".zc-menu-item").find((/** @type {any} */ r) => /Open this page in your browser/.test(r.textContent)));
      item.dispatch("click");
      assert.deepEqual(opened, [["https://shop.test/login", "_blank", "noopener"]]);
    } finally {
      if (hadOpen === undefined) delete g.window.open;
      else g.window.open = hadOpen;
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
      restore();
    }
  });

  // (fails before: yes — the bug hunt of 10-30, LOOP-2: a team's lead's yes, kept for its team's workers alone, was in no
  // list the developer could read or take back)
  test("⋯ lists a team's lead's yes with the team it holds for, and Forget takes it back", async () => {
    const { document, restore } = stubDocument();
    const fake = fakeApi(stateOf({ sites: ["docs.test"], teamSites: [{ site: "shop.test", team: "Hunters" }] }));
    const body = document.createElement("div");
    try {
      document.body.append(body);
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: fake.api, bridge: null, doc: /** @type {any} */ (document) });
      await flush();
      const more = /** @type {any} */ (body.querySelectorAll(".brw-btn").find((/** @type {any} */ b) => String(b.getAttribute("aria-label")).startsWith("The sites it may act on")));
      more.dispatch("click", { currentTarget: more });
      const items = /** @type {any[]} */ (document.querySelectorAll(".zc-menu-item"));
      const team = items.find((r) => /shop\.test/.test(r.textContent));
      assert.ok(team, items.map((r) => r.textContent).join(" | "));
      assert.match(team.textContent, /Its lead's yes, for the Hunters team's workers/);
      assert.ok(items.some((r) => /docs\.test/.test(r.textContent) && /Forget: it asks again/.test(r.textContent)), "the developer's yes as it was");
      team.dispatch("click");
      await flush();
      assert.deepEqual(fake.calls.filter(([, b]) => b?.act === "forbid").map(([, b]) => b), [{ act: "forbid", site: "shop.test" }]);
    } finally {
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
      restore();
    }
  });

  test("the chip's sizes are the browser's own", async () => {
    const { SIZES } = await import("../src/core/browser.js");
    const { PAGE_SIZES, sizeChipWords } = await import("../src/ui/harness/panes/browser.js");
    assert.deepEqual(Object.fromEntries(PAGE_SIZES.map((s) => [s.name, { width: s.width, height: s.height }])), JSON.parse(JSON.stringify(SIZES)));
    assert.deepEqual([sizeChipWords(null), sizeChipWords({ size: { width: 820, height: 1180 } }), sizeChipWords({ fit: true })], ["1280 × 800", "820 × 1180", "Fits the pane"]);
  });

  // HarnessV4_BrowserSize_Plan BS3. (fails before: yes — the page lay open to the developer's mouse while an agent drove
  // it, and there was no Take over on it)
  test("an agent drives the page: at work, a call under way on the tab shown or run on it within 2 min, nobody holding the browser", () => {
    const now = 10_000_000;
    const busy = { words: "click e3" };
    /** The chat's browser, its tab shown as `tab` says. @param {any} tab @param {any} [more] */
    const st = (tab, more = {}) => ({ available: true, taken: false, busy: null, droveAt: null, tabs: [{ id: "t1", shown: true, droveAt: null, busy: false, ...tab }], ...more });
    assert.equal(drives(st({ busy: true }, { busy }), true, now), true);
    assert.equal(drives(st({ droveAt: now - DRIVE_MS }), true, now), true);
    assert.equal(drives(st({ droveAt: now - DRIVE_MS - 1 }), true, now), false, "a turn that stopped using the browser");
    assert.equal(drives(st({ busy: true }, { busy }), false, now), false, "the chat's agent not at work");
    assert.equal(drives(st({ busy: true }, { busy, taken: true }), true, now), false, "the developer has it");
    assert.equal(drives(st({ busy: true }, { busy, available: false }), true, now), false);
    assert.equal(drives(null, true, now), false);
    // (fails before: yes — the owner's of 11-10: the veil and its Take over lay on a tab the person opened, while the
    // agent worked on another) The tab shown is one no agent's call works on, nor ran on within 2 min.
    assert.equal(drives(st({}, { busy, droveAt: now - 1000 }), true, now), false, "the person's own tab, the agent at work on another");
    assert.equal(drives({ ...st({}, { busy }), tabs: [{ id: "t1", shown: false, busy: true }, { id: "t2", shown: true }] }, true, now), false);
    assert.equal(drives({ ...st({}, { busy }), tabs: [{ id: "t1", shown: true, busy: true }, { id: "t2", shown: false }] }, true, now), true, "the agent's tab shown");
    assert.equal(drives(st({}, { tabs: [] }), true, now), false, "no tab shown");
    const held = { available: true, taken: true, hand: true, tabs: [{}] };
    assert.equal(lineOf(held, { inApp: true }), "You have the browser — it goes back to the agent 5 s after your mouse leaves the page");
    assert.equal(lineOf(held, { inApp: true, hand: { left: 3 } }), "You have the browser — it goes back to the agent in 3 s");
  });

  test("in the app: the page locked while an agent drives; the app's word of the developer's hand takes it, says its seconds, gives it back", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      let t = 10_000_000;
      let working = true;
      const f = fakeApi(stateOf({ droveAt: t - 1000, tabs: [{ id: "t1", url: "https://shop.test/login", title: "Shop", shown: true, droveAt: t - 1000, busy: false }] }));
      /** @type {any[]} */
      const said = [];
      /** @type {any} */
      let heard = null;
      const bridge = {
        place: async (/** @type {string} */ tab, /** @type {any} */ _rect, /** @type {any} */ o) => (said.push(["place", tab, o?.lock === true]), true),
        park: () => void said.push(["park"]),
        onHand: (/** @type {any} */ fn) => ((heard = fn), () => void (heard = null)),
        handOff: () => void said.push(["handOff"]),
      };
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: f.api, bridge, doc: /** @type {any} */ (document), working: () => working, now: () => t });
      one(body, ".brw-stage").getBoundingClientRect = () => ({ left: 300, top: 80, width: 500, height: 600, right: 800, bottom: 680 });
      const again = async () => (refreshBrowser(/** @type {any} */ (body)), await flush());
      await flush();
      assert.deepEqual(said, [["place", "t1", true]], "an agent at work drove it a second ago: locked");
      working = false;
      await again();
      assert.deepEqual(said.at(-1), ["place", "t1", false], "its turn over: the page open to the developer");
      working = true;
      t += DRIVE_MS;
      await again();
      assert.deepEqual(said.at(-1), ["place", "t1", false], "a turn that stopped using the browser 2 min ago");
      t -= DRIVE_MS;
      await again();
      assert.deepEqual(said.at(-1), ["place", "t1", true]);
      // The veil's Take over: Filament told it is by hand; the page open to the mouse.
      heard({ state: "take", tab: "t1" });
      await flush();
      assert.deepEqual(f.calls.at(-1), ["/sessions/c1/browser", { act: "take", hand: true }]);
      assert.deepEqual(said.at(-1), ["place", "t1", false]);
      const line = one(body, ".brw-line");
      assert.equal(line.textContent, "You have the browser — it goes back to the agent 5 s after your mouse leaves the page");
      heard({ state: "away", tab: "t1", left: 3 });
      assert.equal(line.textContent, "You have the browser — it goes back to the agent in 3 s");
      heard({ state: "held", tab: "t1" });
      assert.equal(line.textContent, "You have the browser — it goes back to the agent 5 s after your mouse leaves the page");
      heard({ state: "over", tab: "t1", why: "over" });
      await flush();
      assert.deepEqual(f.calls.at(-1), ["/sessions/c1/browser", { act: "give" }]);
      assert.deepEqual(said.at(-1), ["place", "t1", true], "the agent's again: locked");
      assert.ok(!said.some((s) => s[0] === "handOff"), "the app ended it itself");
      // Give back from the bar while it is in the developer's hand: the app stops its watch.
      heard({ state: "take", tab: "t1" });
      await flush();
      one(body, ".brw-take").dispatch("click");
      await flush();
      assert.deepEqual(f.calls.at(-1), ["/sessions/c1/browser", { act: "give" }]);
      assert.deepEqual(said.slice(-2), [["handOff"], ["place", "t1", true]]);
      body.remove();
      await again();
      assert.equal(heard, null, "the pane gone hears no more");
    } finally {
      restore();
    }
  });

  // (fails before: yes — the owner's of 11-10: Take over lay on a tab the person opened while the agent worked on
  // another, the veil judged by the chat's newest call whichever tab it ran on)
  test("the veil lies on the agents' tabs alone: one a call works on now, or ran on within 2 min — never the person's own", async () => {
    let t = 10_000_000;
    const browsers = createBrowsers({ host: fakeApp(), now: () => t });
    const scout = { seat: { id: "sa_1", name: "Scout" } };
    const state = () => browsers.stateOf("c1");
    /** Whether the pane's veil lies over the tab it shows now, the chat's agent at work. */
    const veiled = async () => drives(await state(), true, t);
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/", snapshot: false });
    assert.equal(await veiled(), true, "the agent's page, a call ran on it a moment ago");
    await browsers.call("c1", { action: "navigate", url: "https://docs.test/", snapshot: false }, scout);
    // The person opens a tab of their own, and goes to an address in it: no agent's call has worked on it.
    assert.deepEqual(await browsers.person("c1", { act: "new" }), { ok: true });
    assert.deepEqual(await browsers.person("c1", { act: "navigate", url: "https://news.test/" }), { ok: true });
    const own = (await state()).tabs.find((x) => x.shown);
    assert.deepEqual([own?.droveAt, own?.busy], [null, false]);
    assert.equal(await veiled(), false, "the person's own tab, the agents drove others a moment ago");
    // Scout at work on its tab: the person's stays open to them; the tab of Scout's call is named.
    const going = browsers.call("c1", { action: "wait", ms: 120 }, scout);
    await new Promise((r) => setTimeout(r, 40));
    const st = await state();
    assert.equal(st.busy?.by, "Scout", "a call at work");
    assert.equal(drives(st, true, t), false, "the person's own tab, Scout at work on its own");
    const scouts = st.tabs.find((x) => x.by === "Scout");
    assert.equal(scouts?.busy, true, "the tab of its call at work");
    assert.equal(st.tabs.filter((x) => x.busy).length, 1);
    // Shown while Scout's call works on it: veiled, however long since the call began.
    await browsers.person("c1", { act: "select", tab: String(scouts?.id) });
    t += DRIVE_MS + 1;
    assert.equal(await veiled(), true, "Scout's tab, its call at work");
    await going;
    t += DRIVE_MS;
    assert.equal(await veiled(), true, "Scout's tab, its call ended 2 min ago");
    t += 1;
    assert.equal(await veiled(), false, "Scout stopped using it");
    await browsers.person("c1", { act: "select", tab: String(own?.id) });
    assert.equal(await veiled(), false);
  });

  test("in the app: the person's own tab shown is not locked while an agent works on another; the agent's tab shown is", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      const t = 10_000_000;
      const tabs = [
        { id: "t1", url: "https://shop.test/login", title: "Shop", shown: false, droveAt: t - 1000, busy: true, by: "Scout" },
        { id: "t2", url: "https://news.test/", title: "News", shown: true, droveAt: null, busy: false },
      ];
      const f = fakeApi(stateOf({ tabs, active: "t2", busy: { words: "click e3", by: "Scout" }, droveAt: t - 1000 }));
      /** @type {any[]} */
      const said = [];
      const bridge = { place: async (/** @type {string} */ tab, /** @type {any} */ _rect, /** @type {any} */ o) => (said.push([tab, o?.lock === true]), true), park: () => {} };
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: f.api, bridge, doc: /** @type {any} */ (document), working: () => true, now: () => t });
      one(body, ".brw-stage").getBoundingClientRect = () => ({ left: 300, top: 80, width: 500, height: 600, right: 800, bottom: 680 });
      await flush();
      assert.deepEqual(said, [["t2", false]], "the person's own tab: no veil, no Take over");
      f.set(stateOf({ tabs: tabs.map((x) => ({ ...x, shown: x.id === "t1" })), active: "t1", busy: { words: "click e3", by: "Scout" }, droveAt: t - 1000 }));
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(said.at(-1), ["t1", true], "Scout's tab, its call at work: veiled");
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
      await flush();
    } finally {
      restore();
    }
  });

  test("a read of the browser on its way as the page is taken does not undo the take; a pane drawn again hears the rest of the hand", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      const f = fakeApi();
      /** @type {(() => void) | null} */
      let release = null;
      /** @type {any[]} */
      const said = [];
      /** @type {any} */
      let heard = null;
      const bridge = { place: async () => true, park: () => {}, onHand: (/** @type {any} */ fn) => ((heard = fn), () => void (heard = null)), handOff: () => void said.push("handOff") };
      // The take's answer held back until the test lets it go.
      const api = async (/** @type {string} */ path, /** @type {any} */ init) => {
        if (init?.body?.act === "take") await new Promise((r) => (release = () => r(null)));
        return f.api(path, init);
      };
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api, bridge, doc: /** @type {any} */ (document), working: () => true, now: () => 0 });
      await flush();
      heard({ state: "take", tab: "t1" });
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.deepEqual(said, [], "a read of before the take is no give-back");
      /** @type {any} */ (release)();
      await flush();
      await flush();
      assert.equal(one(body, ".brw-line").textContent, "You have the browser — it goes back to the agent 5 s after your mouse leaves the page");
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      // A pane drawn anew while the page is in the developer's hand: its seconds and its give-back are heard the same.
      const body2 = document.createElement("div");
      document.body.append(body2);
      renderBrowser(/** @type {any} */ (body2), { chat: { chainId: "c1" }, api: f.api, bridge, doc: /** @type {any} */ (document), working: () => true, now: () => 0 });
      await flush();
      heard({ state: "away", tab: "t1", left: 2 });
      assert.equal(one(body2, ".brw-line").textContent, "You have the browser — it goes back to the agent in 2 s");
      heard({ state: "over", tab: "t1", why: "over" });
      await flush();
      assert.deepEqual(f.calls.at(-1), ["/sessions/c1/browser", { act: "give" }]);
      body2.remove();
      refreshBrowser(/** @type {any} */ (body2));
      await flush();
    } finally {
      restore();
    }
  });

  test("a chat of none: the pane says whose the browser is", () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      renderBrowser(/** @type {any} */ (body), { chat: null, api: async () => ({}), bridge: null, doc: /** @type {any} */ (document) });
      assert.match(one(body, ".pane-empty").textContent, /^The browser is a chat's/);
    } finally {
      restore();
    }
  });
});

// (fails before: yes — the tile's Pop out said "needs the desktop app" inside the desktop app too; then, 10-23, "not
// built yet" there until BS4 built it: test/pop-out.test.js holds it live in the app)
test("Pop out's words are true where they show: in a browser's tab it needs the app, said in one place", () => {
  const host = readFileSync(new URL("../src/ui/harness/panes/pane-host.js", import.meta.url), "utf8");
  assert.match(host, /const POP_NEEDS = "needs the desktop app";/);
  assert.equal(host.split('"needs the desktop app"').length - 1, 1, "said in one place, POP_NEEDS");
  assert.doesNotMatch(host, /not built yet/);
  const was = /** @type {any} */ (globalThis).window;
  try {
    /** @type {any} */ (globalThis).window = { filamentBrowser: { place: async () => true, park: () => {} } };
    assert.ok(bridgeOf(), "the desktop app's harness window has the bridge popOutWhy reads");
    /** @type {any} */ (globalThis).window = {};
    assert.equal(bridgeOf(), null, "a browser's tab has none");
  } finally {
    /** @type {any} */ (globalThis).window = was;
  }
});
