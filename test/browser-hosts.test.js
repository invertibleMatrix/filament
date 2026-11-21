// @ts-check
// Several hosts of the agent's browser, one chosen per chat (b-hosts): this machine's desktop app (`here`), a viewer's
// app — the desktop app of a paired full device that views this machine, by its device (`device:<id>`) — and Chrome on
// this machine (`headless`). A chat's new page opens in the app of whoever drives it — the caller of its newest turn —
// while that app is linked, else in this machine's app, else in Chrome, its sub-agents' with it; a page open stays on
// its host, and every op on it goes there. A host that goes takes its own pages alone, and an app that links in has
// Chrome's pages of the chats it drives. Stand-ins answer for each host as a page would; the turn route and
// GET /api/browser run over stood-in parts with the chats' browsers real.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NO_HOST, createBrowserHost } from "../src/app/browser/host.js";
import { createBrowsers } from "../src/app/browser/registry.js";
import * as adminBrowser from "../src/http/admin/browser.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { until } from "./helpers/wait.js";

const HERE = "here";
const HEADLESS = "headless";
/** A viewer's app's host. @param {string} id */
const dev = (id) => `device:${id}`;
const settle = () => new Promise((r) => setTimeout(r, 10));

/** Callers as the admin gate finds them (http/guards.js `whoIs`). */
const LOCAL = { kind: "local" };
const ADMIN = { kind: "admin" };
const TAILNET = { kind: "tailnet", login: "me@example.com" };
/** @param {string} id @param {"full" | "view" | "agent"} scope */
const deviceWho = (id, scope) => ({ kind: "device", scope, device: { id, name: `Device ${id}`, scope, grants: { agents: true } } });
const FULL = deviceWho("D1", "full");
const VIEW = deviceWho("V1", "view");
const AGENTS = deviceWho("A1", "agent");

/**
 * What a stand-in page answers an op: a navigation with its load's events after it, the frame tree a blank page's, a
 * cast taken.
 * @param {any} m @returns {{ result: any, events: any[] }}
 */
function answer(m) {
  if (m.op === "cast") return { result: { casting: m.on === true, way: "screencast" }, events: [] };
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
 * A stand-in app over its link: each request answered a moment later, kept in `sent`; `take` is what the host set
 * handed back as it attached the link, and `say` a word of the app's own.
 */
function app() {
  /** @type {any[]} */
  const sent = [];
  const me = {
    sent,
    /** @type {(m: any) => void} */
    take: () => {},
    link: {
      send: (/** @type {any} */ m) => {
        sent.push(m);
        setTimeout(() => {
          const { result, events } = answer(m);
          me.take({ n: m.n, ok: true, result });
          for (const e of events) me.take(e);
        }, 1);
      },
      close: () => {},
    },
    /** @param {any} e */
    say: (e) => me.take(e),
    /** The tabs it opened. */
    opened: () => sent.filter((m) => m.op === "open").map((m) => String(m.tab)),
    /** @param {string} op */
    ops: (op) => sent.filter((m) => m.op === op),
  };
  return me;
}

/** A stand-in for Chrome on this machine (headless-host.js): found or not, the tabs it holds, and how often it stopped. */
function chrome() {
  /** @type {any[]} */
  const sent = [];
  /** @type {Set<(e: any) => void>} */
  const listeners = new Set();
  /** @type {Set<string>} */
  const tabs = new Set();
  let found = true;
  let stops = 0;
  /** @param {any} e */
  const say = (e) => [...listeners].forEach((fn) => fn(e));
  return {
    sent,
    /** @param {boolean} v */
    find: (v) => void (found = v),
    get stops() {
      return stops;
    },
    get available() {
      return found;
    },
    get pages() {
      return tabs.size;
    },
    opened: () => sent.filter((m) => m.op === "open").map((m) => String(m.tab)),
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
      stops++;
      const had = tabs.size > 0;
      tabs.clear();
      if (had) say({ op: "lost", why: "gone" });
    },
  };
}

/** A page that watches a chat's browser: the frames it was handed and where the cast stood. */
function watcher() {
  /** @type {any[]} */
  const frames = [];
  /** @type {any[]} */
  const states = [];
  return { frames, states, frame: (/** @type {any} */ f) => frames.push(f), state: (/** @type {any} */ s) => states.push(s) };
}

class FakeRes {
  status = 0;
  body = "";
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  setHeader() {}
  getHeader() {}
  /** @param {number} s */
  writeHead(s) {
    this.status = s;
    this.headersSent = true;
    return this;
  }
  /** @param {string} c */
  write(c) {
    this.body += c;
  }
  end(c = "") {
    this.body += c;
    this.writableEnded = true;
  }
  on() {}
}

/**
 * The chat's turn route (`POST /sessions/:id/turns`) over stood-in parts, the chats' browsers real: each turn sent with
 * its caller as the admin gate found it, and the turns the sessions service was handed.
 * @param {ReturnType<typeof createBrowsers>} browsers
 */
function turnRoute(browsers) {
  /** @type {{ id: string, input: any }[]} */
  const turns = [];
  const a = {
    memory: { archive: { metaOf: () => ({}) } },
    sessions: {
      turn: async (/** @type {string} */ id, /** @type {any} */ input, /** @type {any} */ _req, /** @type {FakeRes} */ res) => {
        turns.push({ id, input });
        res.writeHead(200);
        res.end("{}");
      },
    },
    config: { get: () => ({}) },
    browsers,
  };
  const route = createRouter(sessionRoutes(a));
  /** @param {string} chain @param {any} who @param {any} [body] */
  const send = async (chain, who, body = { content: "go on" }) => {
    const m = route("POST", `/sessions/${chain}/turns`);
    assert.ok(m, "the turn has its row");
    const res = new FakeRes();
    await m.handler({ req: { headers: {}, method: "POST", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL(`http://x/sessions/${chain}/turns`), path: `/sessions/${chain}/turns`, method: "POST", params: m.params, json: async () => body, who }, a);
    assert.equal(res.status, 200, res.body);
  };
  return { send, turns };
}

describe("the hosts", () => {
  // (fails before: yes — there was one app link: no viewer's app could be attached, and no word said which host it was)
  test("one link per host, the newest wins in each; each host's word comes tagged with its key, whatever it says", async () => {
    const host = createBrowserHost();
    /** @type {string[]} */
    const heard = [];
    host.on((e) => void heard.push(`${e.op} ${e.host}`));
    const d1 = app();
    d1.take = host.attachViewer("D1", d1.link);
    const d2 = app();
    d2.take = host.attachViewer("D2", d2.link);
    assert.equal(host.linked(dev("D1")), true);
    assert.equal(host.linked(dev("D2")), true);
    assert.equal(host.linked(HERE), false);
    const again = app();
    again.take = host.attachViewer("D1", again.link);
    assert.deepEqual(heard, [`lost ${dev("D1")}`], "D1's link before it went; D2's stays");
    host.detach(d1.link);
    assert.equal(host.linked(dev("D1")), true, "the old link's close is not the new one's");
    d2.say({ op: "event", tab: "t9", method: "Page.loadEventFired", params: {}, host: HERE });
    assert.equal(heard.at(-1), `event ${dev("D2")}`, "the host it came from, not the one it names");
    host.detach(d2.link);
    assert.equal(host.linked(dev("D2")), false);
    assert.equal(heard.at(-1), `lost ${dev("D2")}`);
    await assert.rejects(host.call("open", { tab: "t1" }, { host: dev("D2") }), /the app's browser went/);
    const p = host.call("open", { tab: "t2" }, { host: dev("D1") });
    assert.deepEqual(again.sent.at(-1), { n: 1, op: "open", tab: "t2" });
    assert.equal(await p, null);
  });
});

describe("who drives a chat", () => {
  // (fails before: yes — nothing read a turn's caller for the browser: there was no driverOf, and no chat had a driver)
  test("the caller of its newest turn: this computer, the admin token and the tailnet from here, a full device from its app; Filament's own turn changes nothing", async () => {
    assert.equal(adminBrowser.driverOf(/** @type {any} */ (LOCAL)), HERE);
    assert.equal(adminBrowser.driverOf(/** @type {any} */ (ADMIN)), HERE);
    assert.equal(adminBrowser.driverOf(/** @type {any} */ (TAILNET)), HERE);
    assert.equal(adminBrowser.driverOf(/** @type {any} */ (FULL)), dev("D1"));
    assert.equal(adminBrowser.driverOf(null), null);
    const host = createBrowserHost();
    const mine = app();
    mine.take = host.attach(mine.link);
    const theirs = app();
    theirs.take = host.attachViewer("D1", theirs.link);
    const browsers = createBrowsers({ host });
    const r = turnRoute(browsers);
    assert.equal(browsers.hostFor("c1"), HERE, "a chat nobody drove: this machine's app");
    await r.send("c1", FULL);
    assert.equal(browsers.hostFor("c1"), dev("D1"));
    // A command's end, a goal's round and a restart's resume are Filament's: the person drives on.
    for (const own of [{ wake: true }, { goal: true }, { resume: true }]) await r.send("c1", LOCAL, own);
    assert.equal(browsers.hostFor("c1"), dev("D1"));
    for (const who of [LOCAL, ADMIN, TAILNET]) {
      await r.send("c1", FULL);
      await r.send("c1", who);
      assert.equal(browsers.hostFor("c1"), HERE, who.kind);
    }
    assert.equal(r.turns.length, 10, "every turn went on to the chat");
  });

  // (fails before: yes — there was no driverOf, nor a chat's driver to keep as it was)
  test("a view-only device never drives a chat", async () => {
    assert.equal(adminBrowser.driverOf(/** @type {any} */ (VIEW)), null);
    const host = createBrowserHost();
    const mine = app();
    mine.take = host.attach(mine.link);
    const viewing = app();
    viewing.take = host.attachViewer("V1", viewing.link);
    const full = app();
    full.take = host.attachViewer("D1", full.link);
    const browsers = createBrowsers({ host });
    const r = turnRoute(browsers);
    await r.send("c1", VIEW);
    assert.equal(browsers.hostFor("c1"), HERE, "its turn drives nothing: the chat stays this machine's");
    await r.send("c2", FULL);
    await r.send("c2", VIEW);
    assert.equal(browsers.hostFor("c2"), dev("D1"), "the full device that drove it drives it still");
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    await browsers.call("c2", { action: "navigate", url: "two.test/" });
    assert.deepEqual(viewing.opened(), [], "no page in the view device's app");
    assert.equal(mine.opened().length, 1);
    assert.equal(full.opened().length, 1);
  });

  // (fails before: yes — there was no driverOf, and no host but this machine's app and Chrome to choose from)
  test("another machine's agents' chat is never hosted in a device's app: their turns drive it from this machine", async () => {
    assert.equal(adminBrowser.driverOf(/** @type {any} */ (AGENTS)), HERE);
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    // An app linked under the agents' device's own id: none of their chat's pages go there.
    const theirs = app();
    theirs.take = host.attachViewer("A1", theirs.link);
    const browsers = createBrowsers({ host });
    const r = turnRoute(browsers);
    await r.send("ag", AGENTS);
    assert.equal(browsers.hostFor("ag"), HEADLESS, "Chrome on this machine, with no app of this machine's");
    await browsers.call("ag", { action: "navigate", url: "agents.test/" });
    assert.equal(c.opened().length, 1);
    assert.deepEqual(theirs.opened(), []);
    const mine = app();
    mine.take = host.attach(mine.link);
    assert.equal(browsers.hostFor("ag"), HERE);
    // One a full device drove before: the agents' turn after it drives it from here, not from any device's app.
    const full = app();
    full.take = host.attachViewer("D1", full.link);
    await r.send("ag", FULL);
    await r.send("ag", AGENTS);
    assert.equal(browsers.hostFor("ag"), HERE);
    await browsers.call("ag", { action: "tabs", op: "new", url: "agents.test/two" });
    assert.deepEqual(theirs.opened(), []);
    assert.deepEqual(full.opened(), []);
    assert.equal(mine.opened().length, 2, "its page from Chrome opened again here, and its new one beside it");
  });
});

describe("each chat's host", () => {
  // (fails before: yes — every chat's pages were on the one host: no viewer's app, no driver)
  test("two chats driven from two places at once: each one's pages in its own driver's app, its sub-agents' with them", async () => {
    const host = createBrowserHost();
    const mine = app();
    mine.take = host.attach(mine.link);
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c1", HERE);
    browsers.drive("c2", dev("D1"));
    const [one, two] = await Promise.all([browsers.call("c1", { action: "navigate", url: "one.test/" }), browsers.call("c2", { action: "navigate", url: "two.test/" })]);
    assert.match(String(one), /^Opened https:\/\/one\.test\/\./);
    assert.match(String(two), /^Opened https:\/\/two\.test\/\./);
    const t1 = (await browsers.stateOf("c1")).tabs[0].id;
    const t2 = (await browsers.stateOf("c2")).tabs[0].id;
    assert.deepEqual(mine.opened(), [t1]);
    assert.deepEqual(viewer.opened(), [t2]);
    assert.ok(mine.sent.every((m) => m.tab === t1), "nothing of c2's in this machine's app");
    assert.ok(viewer.sent.every((m) => m.tab === t2), "nothing of c1's in the device's app");
    assert.ok(mine.sent.some((m) => m.method === "Page.navigate" && m.params.url === "https://one.test/"));
    assert.ok(viewer.sent.some((m) => m.method === "Page.navigate" && m.params.url === "https://two.test/"));
    await browsers.call("c2", { action: "navigate", url: "two.test/helper" }, { seat: { id: "s1", name: "Helper" } });
    assert.equal(viewer.opened().length, 2, "its sub-agent's page in the app its chat's is in");
    assert.equal(mine.opened().length, 1);
    assert.equal(browsers.pageOf("c2", { id: "s1", name: "Helper" }), "https://two.test/helper");
  });

  // (fails before: yes — there was one host: a link that went took every chat's tabs)
  test("a viewer's app that goes takes its own pages alone: the other host's go on, and its chat's next call opens on the host chosen now", async () => {
    const host = createBrowserHost();
    const mine = app();
    mine.take = host.attach(mine.link);
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    browsers.drive("c2", dev("D1"));
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    await browsers.call("c2", { action: "navigate", url: "two.test/" });
    host.detach(viewer.link);
    assert.equal((await browsers.stateOf("c2")).tabs.length, 0, "the device's chat's tab went with its app");
    assert.equal((await browsers.stateOf("c1")).tabs.length, 1, "this machine's chat's stays");
    const stays = String(await browsers.call("c1", { action: "snapshot" }));
    assert.doesNotMatch(stays, /The browser (moved|started again)/);
    assert.match(stays, /Page: .*https:\/\/one\.test\//);
    assert.equal(mine.opened().length, 1, "c1's page was not opened again");
    const moved = String(await browsers.call("c2", { action: "snapshot" }));
    assert.match(moved, /The browser moved to this machine's desktop app \(the app of the device that drove this chat quit, or lost Filament\): tab t-\w+ \(https:\/\/two\.test\/\) opened again there at its address/);
    assert.equal(mine.opened().length, 2, "c2's page opened again in this machine's app: its driver's is gone");
    assert.equal(browsers.hostFor("c2"), HERE);
  });

  // (fails before: yes — any host's word reached any tab of its id: there was one host)
  test("a host's word reaches its own tabs alone: another host's event, frame, close or popup naming a tab of this one's moves nothing", async () => {
    const host = createBrowserHost();
    const mine = app();
    mine.take = host.attach(mine.link);
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    await browsers.call("c1", { action: "navigate", url: "one.test/" });
    const [tab] = (await browsers.stateOf("c1")).tabs;
    const w = watcher();
    const stop = browsers.watch("c1", w);
    await settle();
    viewer.say({ op: "event", tab: tab.id, method: "Page.frameNavigated", params: { frame: { id: "F", url: "https://elsewhere.test/" } } });
    viewer.say({ op: "frame", tab: tab.id, seq: 1, data: "QQ==", width: 10, height: 10, way: "screencast" });
    viewer.say({ op: "popup", tab: "t-from-d1", from: tab.id, url: "https://pop.test/" });
    viewer.say({ op: "gone", tab: tab.id });
    await settle();
    const st = await browsers.stateOf("c1");
    assert.deepEqual(st.tabs.map((t) => [t.id, t.url]), [[tab.id, "https://one.test/"]]);
    assert.equal(w.frames.length, 0);
    assert.deepEqual(viewer.ops("close").map((m) => m.tab), ["t-from-d1"], "the device's own popup closed in its app");
    mine.say({ op: "frame", tab: tab.id, seq: 1, data: "QQ==", width: 10, height: 10, way: "screencast" });
    assert.equal(w.frames.length, 1, "its own host's frame reaches the page that watches");
    stop();
  });

  // (fails before: yes — there was no driver, no host but one, and nowhere a choice to make)
  test("a chat's new page: its driver's app while linked, else this machine's, else Chrome, else none in words", async () => {
    const c = chrome();
    c.find(false);
    const host = createBrowserHost({ chrome: c });
    const browsers = createBrowsers({ host });
    browsers.drive("d1", dev("D1"));
    browsers.drive("d2", dev("D2"));
    assert.equal(browsers.hostFor("none"), null);
    await assert.rejects(browsers.call("d1", { action: "navigate", url: "x.test" }), { message: NO_HOST });
    c.find(true);
    assert.deepEqual([browsers.hostFor("none"), browsers.hostFor("d1")], [HEADLESS, HEADLESS]);
    await browsers.call("d1", { action: "navigate", url: "in-chrome.test/" });
    assert.equal(c.opened().length, 1, "Chrome holds the page with no app linked");
    const mine = app();
    mine.take = host.attach(mine.link);
    assert.deepEqual([browsers.hostFor("none"), browsers.hostFor("d1"), browsers.hostFor("d2")], [HERE, HERE, HERE]);
    await browsers.call("none", { action: "navigate", url: "here.test/" });
    assert.equal(mine.opened().length, 1);
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    assert.deepEqual([browsers.hostFor("none"), browsers.hostFor("d1"), browsers.hostFor("d2")], [HERE, dev("D1"), HERE], "another device's app is no one else's fallback");
    await browsers.call("d2", { action: "navigate", url: "d2.test/" });
    assert.equal(mine.opened().length, 2, "D2's chat in this machine's app, never D1's");
    host.detach(mine.link);
    assert.deepEqual([browsers.hostFor("none"), browsers.hostFor("d1"), browsers.hostFor("d2")], [HEADLESS, dev("D1"), HEADLESS]);
    host.detach(viewer.link);
    c.find(false);
    assert.equal(browsers.hostFor("d1"), null);
    await assert.rejects(browsers.call("d2", { action: "navigate", url: "x.test" }), { message: NO_HOST });
  });

  // (fails before: yes — a chat's pages were wherever the one host was; nothing kept a tab on the host it opened on)
  test("a page open stays on its host as the driver changes, and every op on it — the cast, the person's hand — goes there; a new page opens in the new driver's app", async () => {
    const host = createBrowserHost();
    const mine = app();
    mine.take = host.attach(mine.link);
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    const browsers = createBrowsers({ host });
    await browsers.call("c1", { action: "navigate", url: "shop.test/" });
    const [first] = (await browsers.stateOf("c1")).tabs;
    browsers.drive("c1", dev("D1"));
    const before = viewer.sent.length;
    const read = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(read, /Page: .*https:\/\/shop\.test\//);
    assert.equal(viewer.sent.length, before, "nothing of the open page goes to the new driver's app");
    assert.ok(mine.sent.some((m) => m.tab === first.id && m.method === "Accessibility.getFullAXTree"));
    await browsers.call("c1", { action: "tabs", op: "new", url: "two.test/" });
    const [second] = viewer.opened();
    assert.ok(second, "the chat's new page opened in its driver's app");
    assert.deepEqual(mine.opened(), [first.id]);
    // The pane watches: the shown tab's own host casts it.
    const w = watcher();
    const stop = browsers.watch("c1", w);
    await settle();
    assert.deepEqual(viewer.ops("cast").map((m) => [m.tab, m.on]), [[second, true]]);
    assert.equal((await browsers.person("c1", { act: "select", tab: first.id })).ok, true);
    await settle();
    assert.deepEqual(viewer.ops("cast").map((m) => [m.tab, m.on]), [[second, true], [second, false]]);
    assert.deepEqual(mine.ops("cast").map((m) => [m.tab, m.on]), [[first.id, true]]);
    assert.equal(w.states.at(-1).tab, first.id);
    // The person takes it over: their click goes to the page's own host.
    await browsers.person("c1", { act: "take" });
    await browsers.input("c1", { kind: "mouse", type: "mousePressed", x: 5, y: 6, button: "left", buttons: 1, clickCount: 1 });
    assert.ok(mine.sent.some((m) => m.method === "Input.dispatchMouseEvent" && m.tab === first.id && m.params.type === "mousePressed"));
    assert.ok(!viewer.sent.some((m) => m.method === "Input.dispatchMouseEvent"));
    // Given back, the button held is let go on that page, at that host.
    await browsers.person("c1", { act: "give" });
    await settle();
    assert.ok(mine.sent.some((m) => m.method === "Input.dispatchMouseEvent" && m.tab === first.id && m.params.type === "mouseReleased"));
    stop();
  });
});

describe("Chrome beside the apps", () => {
  // (fails before: yes — an app that linked in stopped Chrome, every page of it gone, the device's chat's among them)
  test("this machine's app that links in has Chrome's pages of the chats no device drives; Chrome keeps the others, and stops once it holds none", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const browsers = createBrowsers({ host });
    browsers.drive("theirs", dev("D1"));
    await browsers.call("ours", { action: "navigate", url: "ours.test/" });
    await browsers.call("theirs", { action: "navigate", url: "theirs.test/" });
    assert.equal(c.pages, 2);
    const mine = app();
    mine.take = host.attach(mine.link);
    assert.equal(c.pages, 1, "the chat this machine drives left Chrome");
    assert.equal(c.stops, 0, "Chrome holds a page still: it runs on");
    const [theirsTab] = (await browsers.stateOf("theirs")).tabs;
    assert.ok(theirsTab, "the device's chat keeps its page in Chrome");
    const sentBefore = c.sent.length;
    const still = String(await browsers.call("theirs", { action: "snapshot" }));
    assert.doesNotMatch(still, /The browser (moved|started again)/);
    assert.ok(c.sent.length > sentBefore, "its snapshot read in Chrome");
    assert.ok(!mine.sent.some((m) => m.tab === theirsTab.id));
    const ours = String(await browsers.call("ours", { action: "snapshot" }));
    assert.match(ours, /The browser moved to this machine's desktop app \(the app of whoever drives this chat connected, and holds its pages now\): tab t-\w+ \(https:\/\/ours\.test\/\) opened again there/);
    assert.equal(mine.opened().length, 1, "our page opened again in this machine's app");
    await browsers.call("theirs", { action: "tabs", op: "close", tab: theirsTab.id });
    await until(() => c.stops === 1, "Chrome stopped with its last page");
    assert.equal(c.pages, 0);
  });

  // (fails before: yes — no viewer's app could link in, and Chrome stopped for an app alone)
  test("a viewer's app that links in has Chrome's pages of the chats its device drives; with no app of this machine's, Chrome runs on for the rest", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const browsers = createBrowsers({ host });
    browsers.drive("theirs", dev("D1"));
    await browsers.call("ours", { action: "navigate", url: "ours.test/" });
    await browsers.call("theirs", { action: "navigate", url: "theirs.test/" });
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    assert.equal(c.pages, 1);
    assert.equal(c.stops, 0, "Chrome is this machine's chats' browser still");
    const theirs = String(await browsers.call("theirs", { action: "snapshot" }));
    assert.match(theirs, /The browser moved to the desktop app of the device that drives this chat \(the app of whoever drives this chat connected, and holds its pages now\): tab t-\w+ \(https:\/\/theirs\.test\/\) opened again there/);
    assert.equal(viewer.opened().length, 1, "in the device's app now");
    const ours = String(await browsers.call("ours", { action: "snapshot" }));
    assert.doesNotMatch(ours, /The browser (moved|started again)/);
    assert.equal(c.opened().length, 2, "nothing opened again in Chrome");
  });
});

describe("GET /api/browser", () => {
  // (fails before: yes — it said whether any host was there, for nobody's chat, and named no host)
  test("says whether a browser is there for the caller's chat, and what holds its pages", async () => {
    const c = chrome();
    const host = createBrowserHost({ chrome: c });
    const browsers = createBrowsers({ host });
    const route = createRouter(adminBrowser.browserRoutes({ browsers, browserHost: host }));
    /** @param {any} who @param {string} [query] */
    const get = async (who, query = "") => {
      const m = route("GET", "/browser");
      assert.ok(m);
      const res = new FakeRes();
      await m.handler({ req: { headers: {} }, res, url: new URL(`http://x/browser${query}`), params: m.params, who }, {});
      return JSON.parse(res.body);
    };
    assert.deepEqual(await get(LOCAL), { available: true, version: "", host: "headless" });
    const mine = app();
    mine.take = host.attach(mine.link);
    mine.say({ op: "hello", version: "1.2.3" });
    assert.deepEqual(await get(LOCAL), { available: true, version: "1.2.3", host: "app" });
    assert.deepEqual(await get(FULL), { available: true, version: "1.2.3", host: "app" }, "the device's app is not linked: this machine's");
    const viewer = app();
    viewer.take = host.attachViewer("D1", viewer.link);
    viewer.say({ op: "hello", version: "9.9.0" });
    assert.deepEqual(await get(FULL), { available: true, version: "9.9.0", host: "device" });
    assert.deepEqual(await get(LOCAL), { available: true, version: "1.2.3", host: "app" });
    browsers.drive("c1", dev("D1"));
    assert.deepEqual(await get(LOCAL, "?chat=c1"), { available: true, version: "9.9.0", host: "device" }, "the chat's, whoever asks");
    host.detach(viewer.link);
    host.detach(mine.link);
    c.find(false);
    assert.deepEqual(await get(FULL, "?chat=c1"), { available: false, version: "", host: null });
  });
});
