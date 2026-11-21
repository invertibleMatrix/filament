// @ts-check
// When the app that holds a chat's pages goes (b-handoff): a viewer's app that quits mid-turn, or loses Filament, takes
// its pages with it, and each agent whose pages they were has every one of them opened again at its next call — at its
// address, its size and its id, the one it showed shown again — on the host chosen then: Chrome on this machine with no
// app here. The call at work as it went fails saying so; the next is told where the browser moved. With two viewers
// linked, the chat's pages are in the app of the one driving it, and open again there or here, never in the other's.
// Stand-ins answer for each host as a page would.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createBrowserHost } from "../src/app/browser/host.js";
import { createBrowsers } from "../src/app/browser/registry.js";
import { until } from "./helpers/wait.js";

const HERE = "here";
const HEADLESS = "headless";
/** A viewer's app's host. @param {string} id */
const dev = (id) => `device:${id}`;
const HELPER = { id: "s1", name: "Helper" };

/**
 * What a stand-in page answers an op: a navigation with its load's events after it, the frame tree a blank page's.
 * @param {any} m @returns {{ result: any, events: any[] }}
 */
function answer(m) {
  if (m.op !== "cdp") return { result: null, events: [] };
  if (m.method === "Page.getFrameTree") return { result: { frameTree: { frame: { id: "F", url: "about:blank" } } }, events: [] };
  if (m.method === "Page.navigate")
    return {
      result: { loaderId: "L" },
      events: [
        { op: "event", tab: m.tab, method: "Page.frameNavigated", params: { frame: { id: "F", url: m.params.url } } },
        { op: "event", tab: m.tab, method: "Page.loadEventFired", params: {} },
      ],
    };
  if (m.method === "Accessibility.getFullAXTree") return { result: { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "A page" }, childIds: [] }] }, events: [] };
  return { result: {}, events: [] };
}

/**
 * A stand-in app over its link: each request answered a moment later — but for one `hold` names, never answered —,
 * kept in `sent`; `take` is what the host set handed back as it attached the link.
 * @param {(m: any) => boolean} [hold]
 */
function app(hold = () => false) {
  /** @type {any[]} */
  const sent = [];
  const me = {
    sent,
    /** @type {(m: any) => void} */
    take: () => {},
    link: {
      send: (/** @type {any} */ m) => {
        sent.push(m);
        if (hold(m)) return;
        setTimeout(() => {
          const { result, events } = answer(m);
          me.take({ n: m.n, ok: true, result });
          for (const e of events) me.take(e);
        }, 1);
      },
      close: () => {},
    },
    /** The `open`s it was sent. */
    opens: () => sent.filter((m) => m.op === "open"),
  };
  return me;
}

/** A stand-in for Chrome on this machine (headless-host.js): found or not, and the tabs it holds. */
function chrome() {
  /** @type {any[]} */
  const sent = [];
  /** @type {Set<(e: any) => void>} */
  const listeners = new Set();
  /** @type {Set<string>} */
  const tabs = new Set();
  let found = true;
  /** @param {any} e */
  const say = (e) => [...listeners].forEach((fn) => fn(e));
  return {
    sent,
    /** @param {boolean} v */
    find: (v) => void (found = v),
    get available() {
      return found;
    },
    get pages() {
      return tabs.size;
    },
    opens: () => sent.filter((m) => m.op === "open"),
    /** @param {string} op @param {Record<string, any>} [payload] */
    call(op, payload = {}) {
      const m = { op, ...payload };
      sent.push(m);
      if (op === "open") tabs.add(String(payload.tab));
      if (op === "close") tabs.delete(String(payload.tab));
      return new Promise((resolve) =>
        setTimeout(() => {
          const { result, events } = answer(m);
          resolve(result);
          for (const e of events) say(e);
        }, 1),
      );
    },
    /** @param {(e: any) => void} fn */
    on(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    stop() {
      const had = tabs.size > 0;
      tabs.clear();
      if (had) say({ op: "lost", why: "gone" });
    },
  };
}

/** The addresses each tab was sent to in `sent`, by tab. @param {any[]} sent */
const loaded = (sent) => Object.fromEntries(sent.filter((m) => m.op === "cdp" && m.method === "Page.navigate").map((m) => [m.tab, m.params.url]));

describe("a viewer gone mid-turn", () => {
  // (fails before: yes — only an agent's shown page opened again, and only where it had no other tab; it came back
  // under a new id at the default size, the call at work failed saying only that the app went, and the next was told
  // the browser "started again", not where it is now)
  test("every page of each agent opens again in Chrome at its address, size and id, the shown one shown; the call at work says the browser went, the next where it moved", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const viewer = app((m) => m.op === "cdp" && m.method === "Page.navigate" && m.params.url === "https://slow.test/");
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    await browsers.call("c1", { action: "resize", width: 800, height: 600 });
    await browsers.call("c1", { action: "tabs", op: "new", url: "two.test/" });
    await browsers.call("c1", { action: "navigate", url: "helper.test/" }, { seat: HELPER });
    const before = (await browsers.stateOf("c1")).tabs;
    assert.equal(before.length, 3);
    const [one, two, helper] = before;
    await browsers.call("c1", { action: "tabs", op: "select", tab: one.id });
    assert.equal(c.opens().length, 0, "nothing in Chrome while the viewer's app holds the chat");

    // A call at work as the viewer's app goes: it fails, and says the pages open again at the next call.
    const working = browsers.call("c1", { action: "navigate", url: "slow.test/" });
    await new Promise((r) => setTimeout(r, 20));
    host.detach(viewer.link);
    await assert.rejects(working, /the app's browser went \(the app quit or lost Filament\)\. The browser went while this call ran \(the app of the device that drove this chat quit, or lost Filament\): your next call opens your pages again at their addresses, on the browser there is now\./);
    assert.deepEqual((await browsers.stateOf("c1")).tabs, [], "its pages went with the app");
    assert.equal(browsers.pageOf("c1"), "https://one.test/", "the gate judges the page the next call shows");

    const next = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(next, new RegExp(`^The browser moved to Chrome on this machine \\(the app of the device that drove this chat quit, or lost Filament\\): tabs ${one.id} \\(https://one\\.test/\\), ${two.id} \\(https://two\\.test/\\) opened again there at their addresses, with the same ids\\. Sign-ins, cookies and anything typed into a page stayed in the browser it left: take a snapshot before acting\\.`));
    assert.match(next, /Page: .*https:\/\/one\.test\//, "the snapshot is of the page it showed");
    assert.deepEqual(c.opens().map((m) => [m.tab, m.width, m.height]), [[one.id, 800, 600], [two.id, 1280, 800]], "the chat's own agent's pages, at their ids and sizes");
    assert.deepEqual(loaded(c.sent), { [one.id]: "https://one.test/", [two.id]: "https://two.test/" });
    const after = await browsers.stateOf("c1");
    assert.deepEqual(after.tabs.map((t) => [t.id, t.url, t.shown]), [[one.id, "https://one.test/", true], [two.id, "https://two.test/", false]]);
    assert.equal(browsers.hostFor("c1"), HEADLESS);

    // The sub-agent's page waits for its own next call.
    assert.equal(browsers.pageOf("c1", HELPER), "https://helper.test/");
    const its = String(await browsers.call("c1", { action: "snapshot" }, { seat: HELPER }));
    assert.match(its, new RegExp(`^The browser moved to Chrome on this machine \\([^)]*\\): tab ${helper.id} \\(https://helper\\.test/\\) opened again there at its address`));
    assert.deepEqual(c.opens().map((m) => m.tab), [one.id, two.id, helper.id]);
    const again = String(await browsers.call("c1", { action: "snapshot" }));
    assert.doesNotMatch(again, /The browser (moved|went|started again)/, "said once");
  });

  // (fails before: yes — the page came back only at an act's or a snapshot's call; tabs list said it had none)
  test("any call of the agent's opens them first: tabs list names them, back at their ids", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    const [one] = (await browsers.stateOf("c1")).tabs;
    host.detach(viewer.link);
    const list = String(await browsers.call("c1", { action: "tabs", op: "list" }));
    assert.match(list, /The browser moved to Chrome on this machine/);
    assert.match(list, new RegExp(`${one.id} \\(shown\\) .*https://one\\.test/`));
  });

  // (fails before: yes — the page it was on loaded again whatever the session's rules said of it now)
  test("a page the session's rules keep the browser from reading now opens blank, said", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "secret.test/" });
    const [tab] = (await browsers.stateOf("c1")).tabs;
    host.detach(viewer.link);
    const r = String(await browsers.call("c1", { action: "snapshot" }, { mayLook: (page) => !page.includes("secret.test") }));
    assert.match(r, new RegExp(`Tab ${tab.id} opened again blank: this session's rules keep the browser from reading the page it was on\\.`));
    assert.deepEqual(loaded(c.sent), {}, "nothing of it loaded");
    assert.equal(c.opens().length, 1);
  });

  // (fails before: yes — only the shown page waited; the agent's other tab was forgotten)
  test("with nowhere to open them, they wait: the call says no browser is here, and they open once one is", async () => {
    const c = chrome();
    c.find(false);
    const host = createBrowserHost({ chrome: c });
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    await browsers.call("c1", { action: "tabs", op: "new", url: "two.test/" });
    host.detach(viewer.link);
    await assert.rejects(browsers.call("c1", { action: "snapshot" }), /no app is connected, and no Chrome or Chromium was found/);
    c.find(true);
    const r = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(r, /tabs t-\w+ \(https:\/\/one\.test\/\), t-\w+ \(https:\/\/two\.test\/\) opened again there/);
    assert.equal(c.opens().length, 2);
  });

  // (fails before: yes — Chrome that quit was said as the browser that "started again" with its tabs gone; and then, the
  // review of b-handoff, as one whose sign-ins stayed, though Chrome here starts on an emptied profile)
  test("the same host started again says so, and what went with it: Chrome's sign-ins too", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const browsers = createBrowsers({ host });
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    c.stop();
    const r = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(r, /^The browser started again in Chrome on this machine \(Chrome on this machine quit\): tab t-\w+ \(https:\/\/one\.test\/\) opened again there at its address, with the same ids\. Sign-ins, cookies and anything typed into a page went with it, as Chrome here starts on an emptied profile: take a snapshot before acting\./);
  });

  // (fails before: yes — the review of b-handoff: a page opened again was kept at its blank start where its new host went
  // before it loaded, and said to have opened at its address)
  test("a host that goes as a page opens again on it keeps the page's address for the call after", async () => {
    const host = createBrowserHost();
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "shop.test/cart" });
    const [tab] = (await browsers.stateOf("c1")).tabs;
    const mine = app((m) => m.op === "cdp" && m.method === "Page.navigate");
    mine.take = host.attach(mine.link);
    host.detach(viewer.link);
    const going = browsers.call("c1", { action: "snapshot" });
    await until(() => mine.sent.some((m) => m.method === "Page.navigate" && m.params.url === "https://shop.test/cart"), "opening again here");
    host.detach(mine.link);
    await assert.rejects(going);
    const again = app();
    again.take = host.attach(again.link);
    const r = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(r, new RegExp(`tab ${tab.id} \\(https://shop\\.test/cart\\) opened again there at its address`));
    assert.deepEqual(loaded(again.sent), { [tab.id]: "https://shop.test/cart" });
  });

  // (fails before: yes — the review of b-handoff: a new tab whose host went as it opened was kept as a page of the
  // agent's, and opened again blank at its next call)
  test("a new tab whose host goes as it opens is no page to open again", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    let holding = false;
    const viewer = app((m) => holding && m.op === "open");
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    const [one] = (await browsers.stateOf("c1")).tabs;
    holding = true;
    const opening = browsers.call("c1", { action: "tabs", op: "new", url: "two.test/" });
    await new Promise((r) => setTimeout(r, 20));
    host.detach(viewer.link);
    await assert.rejects(opening, /the app's browser went/);
    const r = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(r, new RegExp(`tab ${one.id} \\(https://one\\.test/\\) opened again there at its address`));
    assert.deepEqual(c.opens().map((m) => m.tab), [one.id], "the tab that never opened is not opened");
  });

  // (fails before: yes — the review of b-handoff: a call whose host went after its step said nothing of it, and could
  // append a snapshot of another tab of the agent's)
  test("a call that ends well as its host goes says the browser went", async () => {
    const host = createBrowserHost();
    const mine = app();
    mine.take = host.attach(mine.link);
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    await browsers.call("c1", { action: "navigate", url: "here.test/" });
    browsers.drive("c1", dev("D1"));
    await browsers.call("c1", { action: "tabs", op: "new", url: "there.test/" });
    const waiting = browsers.call("c1", { action: "wait", ms: 200, snapshot: true });
    await new Promise((r) => setTimeout(r, 30));
    host.detach(viewer.link);
    const r = String(await waiting);
    assert.match(r, /The browser went while this call ran \(the app of the device that drove this chat quit, or lost Filament\): your next call opens your pages again/);
    assert.doesNotMatch(r, /here\.test/, "no snapshot of the tab left on another host");
  });

  // (fails before: yes — the review of b-handoff: two calls of one agent at once each opened its pages, the second a
  // blank tab of its own besides)
  test("two calls of one agent at once open its pages again once", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    await browsers.call("c1", { action: "tabs", op: "new", url: "two.test/" });
    host.detach(viewer.link);
    await Promise.all([browsers.call("c1", { action: "snapshot" }), browsers.call("c1", { action: "snapshot" })]);
    assert.equal(c.opens().length, 2, "its two pages, and no third");
    assert.equal((await browsers.stateOf("c1")).tabs.length, 2);
  });

  // (fails before: yes — the review of b-handoff: a page that could not open again was said in words that sent the agent
  // to close a tab, though nothing brought the page back after)
  test("a page that cannot open again for want of room is said, with the way to it", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "mine.test/" });
    const [mineTab] = (await browsers.stateOf("c1")).tabs;
    host.detach(viewer.link);
    // The chat's other agents fill its eight tabs in Chrome meanwhile.
    for (let i = 0; i < 8; i++) await browsers.call("c1", { action: "navigate", url: `other${i}.test/` }, { seat: { id: `s${i}`, name: `Helper ${i}` } });
    for (let i = 0; i < 8; i++) void browsers.call("c1", { action: "wait", ms: 300 }, { seat: { id: `s${i}`, name: `Helper ${i}` } });
    await new Promise((r) => setTimeout(r, 20));
    const r = String(await browsers.call("c1", { action: "tabs", op: "list" }));
    assert.match(r, new RegExp(`Tab ${mineTab.id} \\(https://mine\\.test/\\) did not open again \\(.*8 tabs.*\\): navigate there if you still need it\\.`));
  });
});

describe("two viewers", () => {
  // (fails before: yes, at the words alone — b-hosts chose the driver's app already; this holds it as the viewers come
  // and go, and says where the pages moved)
  test("the one driving the chat hosts it: the other's going moves nothing, and the driver's pages open again in its app, never in the other's", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const d1 = app();
    d1.take = host.attachViewer("D1", d1.link);
    const d2 = app();
    d2.take = host.attachViewer("D2", d2.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", dev("D2"));
    browsers.drive("c2", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    await browsers.call("c2", { action: "navigate", url: "two.test/" });
    assert.equal(d2.opens().length, 1, "c1's page in its driver's app");
    assert.equal(d1.opens().length, 1, "c2's in its own");

    host.detach(d1.link);
    const stays = String(await browsers.call("c1", { action: "snapshot" }));
    assert.doesNotMatch(stays, /The browser (moved|went|started again)/, "the other viewer's going moves nothing of c1's");
    assert.equal(d2.opens().length, 1);

    // D1 back, the chat driven from D1 now: D2's going sends c1's page to the app of the one driving it.
    const d1b = app();
    d1b.take = host.attachViewer("D1", d1b.link);
    browsers.drive("c1", dev("D1"));
    host.detach(d2.link);
    const moved = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(moved, /^The browser moved to the desktop app of the device that drives this chat \(the app of the device that drove this chat quit, or lost Filament\): tab t-\w+ \(https:\/\/one\.test\/\) opened again there/);
    assert.equal(d1b.opens().length, 1, "in D1's app, which drives c1 now");
    assert.equal(c.opens().length, 0);

    // A chat whose driver's app is gone opens here or in Chrome — never in another viewer's app that does not drive it.
    browsers.drive("c3", dev("D2"));
    await browsers.call("c3", { action: "navigate", url: "three.test/" });
    assert.equal(browsers.hostFor("c3"), HEADLESS);
    const [three] = (await browsers.stateOf("c3")).tabs;
    assert.ok(c.opens().some((m) => m.tab === three.id), "in Chrome");
    assert.ok(!d1b.opens().some((m) => m.tab === three.id), "never in the app of a viewer that does not drive it");
    const mine = app();
    mine.take = host.attach(mine.link);
    assert.equal(browsers.hostFor("c3"), HERE);
  });
});
