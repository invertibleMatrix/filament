// @ts-check
// The agent's browser, the app's half (HarnessV4_Browser_Plan BR3): its pages on stand-ins for Electron — parked,
// their protocol attached after the first load, the commands Filament's driver sends and no other, the page's events it
// reads and no other, popups as tabs, downloads and permissions refused, a page kept to the web — put over the pane and
// parked again; the pane's rectangle; the inbound key read from the data folder; and the link, against a stand-in socket
// and against a real Filament.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CDP_EVENTS, CDP_METHODS, PARK_SIZE, PARTITION, RETRY_MS, createLink, createPages, inboundKeyOf, mayGo, paneHears, placeRect } from "../desktop/lib/browser-host.js";
import { loadKey, seal } from "../src/services/config/secrets.js";
import { filamentsOwn } from "../src/core/browser.js";
import { artifactAddress } from "../src/core/artifacts.js";
import { loopbackWords, machineOwn, onLoopback, partitionFor } from "../desktop/lib/machine-browser.js";
import { startApp } from "./helpers/app.js";

class Emitter {
  constructor() {
    /** @type {Record<string, Function[]>} */
    this.l = {};
  }
  /** @param {string} n @param {Function} f */
  on(n, f) {
    (this.l[n] ||= []).push(f);
    return this;
  }
  /** @param {string} n @param {...any} a */
  emit(n, ...a) {
    for (const f of this.l[n] || []) f(...a);
  }
}

/** Stand-ins for the Electron the pages use: windows, views, a page's protocol, the profile. */
function fakeElectron() {
  /** @type {{ windows: any[], views: any[], partition: string }} */
  const made = { windows: [], views: [], partition: "" };
  class Debugger extends Emitter {
    /** @param {any} wc */
    constructor(wc) {
      super();
      this.wc = wc;
      this.attached = false;
      /** @type {[string, any][]} */
      this.sent = [];
      /** @type {string[]} */
      this.loadsAtAttach = [];
    }
    /** @param {string} v */
    attach(v) {
      this.attached = true;
      this.version = v;
      this.loadsAtAttach = [...this.wc.loads];
    }
    isAttached() {
      return this.attached;
    }
    detach() {
      this.attached = false;
    }
    /** @param {string} m @param {any} p */
    async sendCommand(m, p) {
      this.sent.push([m, p]);
      return { done: m };
    }
  }
  class WebContents extends Emitter {
    constructor() {
      super();
      /** @type {string[]} */
      this.loads = [];
      this.destroyed = false;
      this.debugger = new Debugger(this);
      /** @type {any} */
      this.openHandler = null;
    }
    /** @param {string} u */
    async loadURL(u) {
      this.loads.push(u);
    }
    async capturePage() {
      /** @type {any[]} */
      const resized = [];
      this.resized = resized;
      const img = {
        isEmpty: () => false,
        getSize: () => ({ width: 1600, height: 1000 }),
        resize: (/** @type {any} */ o) => (resized.push(o), img),
        toJPEG: (/** @type {number} */ q) => Buffer.from(`jpeg ${q}`),
      };
      return img;
    }
    /** @param {any} f */
    setWindowOpenHandler(f) {
      this.openHandler = f;
    }
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      this.destroyed = true;
    }
  }
  class View {
    /** @param {any} o */
    constructor(o) {
      this.opts = o;
      this.webContents = new WebContents();
      /** @type {any} */
      this.bounds = null;
      made.views.push(this);
    }
    /** @param {any} b */
    setBounds(b) {
      this.bounds = b;
    }
  }
  class ContentView {
    constructor() {
      /** @type {any[]} */
      this.children = [];
    }
    /** @param {any} v  a view moves: it is in one window at a time */
    addChildView(v) {
      for (const w of made.windows) w.contentView.children = w.contentView.children.filter((/** @type {any} */ x) => x !== v);
      this.children.push(v);
    }
    /** @param {any} v */
    removeChildView(v) {
      this.children = this.children.filter((x) => x !== v);
    }
  }
  class Win {
    /** @param {any} [o] */
    constructor(o = {}) {
      this.opts = o;
      this.contentView = new ContentView();
      this.destroyed = false;
      /** Where its content lies on the screen. */
      this.content = { x: 100, y: 50, width: 1440, height: 900 };
      made.windows.push(this);
    }
    getContentBounds() {
      return this.content;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class Profile extends Emitter {
    constructor() {
      super();
      /** @type {any} */
      this.perm = null;
      /** @type {any} */
      this.check = null;
      /** @type {string[]} */
      this.cleared = [];
      /** The listener every request of the profile asks. @type {any} */
      this.before = null;
      this.webRequest = { onBeforeRequest: (/** @type {any} */ f) => (this.before = f) };
    }
    /** @param {any} f */
    setPermissionRequestHandler(f) {
      this.perm = f;
    }
    /** @param {any} f */
    setPermissionCheckHandler(f) {
      this.check = f;
    }
    async clearStorageData() {
      this.cleared.push("storage");
    }
    async clearCache() {
      this.cleared.push("cache");
    }
    async clearAuthCache() {
      this.cleared.push("auth");
    }
  }
  const ses = new Profile();
  const session = { fromPartition: (/** @type {string} */ p) => ((made.partition = p), ses) };
  return { electron: { WebContentsView: View, BrowserWindow: Win, session }, made, ses, Win };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe("the app's pages", () => {
  test("a page is parked at a laptop's size in the one profile, its protocol attached after its first load, told it has the focus", async () => {
    const f = fakeElectron();
    /** @type {any[]} */
    const said = [];
    const pages = createPages({ electron: f.electron, send: (m) => said.push(m) });
    assert.equal(await pages.handle({ op: "open", tab: "t1" }), null);
    const [view] = f.made.views;
    const [park] = f.made.windows;
    assert.equal(f.made.partition, PARTITION);
    assert.equal(view.opts.webPreferences.session, f.ses);
    assert.equal(view.opts.webPreferences.sandbox, true);
    assert.equal(view.opts.webPreferences.backgroundThrottling, false);
    assert.equal(park.opts.show, false);
    assert.equal(park.opts.paintWhenInitiallyHidden, true);
    assert.equal(park.opts.webPreferences.backgroundThrottling, false);
    assert.deepEqual(park.contentView.children, [view]);
    assert.deepEqual(view.bounds, { x: 0, y: 0, ...PARK_SIZE });
    const dbg = view.webContents.debugger;
    assert.deepEqual(dbg.loadsAtAttach, ["about:blank"], "attached after the blank page loaded");
    assert.equal(dbg.version, "1.3");
    assert.deepEqual(dbg.sent[0], ["Emulation.setFocusEmulationEnabled", { enabled: true }]);
    dbg.emit("message", {}, "Page.loadEventFired", { timestamp: 1 });
    dbg.emit("message", {}, "Network.dataReceived", { requestId: "r" });
    assert.deepEqual(said, [{ op: "event", tab: "t1", method: "Page.loadEventFired", params: { timestamp: 1 } }], "the events the driver reads, those alone");
    assert.equal(await pages.handle({ op: "open", tab: "t1" }), null);
    assert.equal(f.made.views.length, 1, "a tab is opened once");
  });

  test("the commands Filament's driver sends reach the page, and no other", async () => {
    const f = fakeElectron();
    const pages = createPages({ electron: f.electron, send: () => {} });
    await pages.handle({ op: "open", tab: "t1" });
    assert.deepEqual(await pages.handle({ op: "cdp", tab: "t1", method: "Page.navigate", params: { url: "https://a.test/" } }), { done: "Page.navigate" });
    await assert.rejects(pages.handle({ op: "cdp", tab: "t1", method: "Page.setDownloadBehavior", params: { behavior: "allow", downloadPath: "C:/" } }), /Page\.setDownloadBehavior is no command the agent's browser takes/);
    await assert.rejects(pages.handle({ op: "cdp", tab: "t9", method: "Page.reload" }), /the app has no tab t9 now/);
    await assert.rejects(pages.handle({ op: "format" }), /format is nothing the app's browser does/);
    // The picture is the app's own capture, at the size the driver asks.
    assert.deepEqual(await pages.handle({ op: "capture", tab: "t1", width: 1280, height: 800 }), { data: Buffer.from("jpeg 70").toString("base64"), mediaType: "image/jpeg" });
    assert.deepEqual(f.made.views[0].webContents.resized, [{ width: 1280, height: 800, quality: "good" }]);
    await assert.rejects(pages.handle({ op: "capture", tab: "t9", width: 1, height: 1 }), /the app has no tab t9 now/);
  });

  test("every command the driver sends is one the app takes, and every event it reads one the app forwards", () => {
    const src = readFileSync(new URL("../src/app/browser/driver.js", import.meta.url), "utf8");
    const named = [...new Set([...src.matchAll(/"([A-Z][A-Za-z]+\.[a-z][A-Za-z]+)"/g)].map((m) => m[1]))];
    const sent = [...new Set([...src.matchAll(/cdp\("([A-Za-z.]+)"/g)].map((m) => m[1]))];
    assert.ok(sent.length >= 20, sent.join(","));
    assert.deepEqual(sent.filter((m) => !CDP_METHODS.has(m)), [], "commands the app would refuse");
    assert.deepEqual(named.filter((m) => !CDP_METHODS.has(m) && !CDP_EVENTS.has(m)), [], "events the app would keep back");
  });

  test("a page stays on the web; its popup is a tab of its chat; a download, a camera or a place is refused", async () => {
    const f = fakeElectron();
    /** @type {any[]} */
    const said = [];
    const pages = createPages({ electron: f.electron, send: (m) => said.push(m), newId: () => "t-pop" });
    await pages.handle({ op: "open", tab: "t1" });
    const wc = f.made.views[0].webContents;
    let stopped = 0;
    wc.emit("will-navigate", { preventDefault: () => stopped++ }, "file:///C:/Users/x/secret.txt");
    wc.emit("will-navigate", { preventDefault: () => stopped++ }, "https://shop.test/next");
    assert.equal(stopped, 1);
    assert.deepEqual(said.at(-1), { op: "note", tab: "t1", words: "The page tried to go to file:///C:/Users/x/secret.txt; the browser opens web pages alone." });
    assert.deepEqual(wc.openHandler({ url: "https://pay.test/checkout" }), { action: "deny" });
    await settle();
    assert.deepEqual(pages.ids(), ["t1", "t-pop"]);
    // At its opener's size, said to Filament (HarnessV4_BrowserSize_Plan case 22).
    assert.deepEqual(said.at(-1), { op: "popup", tab: "t-pop", from: "t1", url: "https://pay.test/checkout", ...PARK_SIZE });
    // (fails before: yes — the bug round of 10-23) Blank until Filament keeps it: it loads the address itself.
    assert.deepEqual(f.made.views[1].webContents.loads, ["about:blank"]);
    assert.deepEqual(wc.openHandler({ url: "javascript:alert(1)" }), { action: "deny" });
    await settle();
    assert.equal(pages.ids().length, 2, "no tab for an address that is no web page's");
    /** @type {boolean[]} */
    const grants = [];
    f.ses.perm(wc, "media", (/** @type {boolean} */ ok) => grants.push(ok));
    f.ses.perm(wc, "geolocation", (/** @type {boolean} */ ok) => grants.push(ok));
    assert.deepEqual(grants, [false, false]);
    assert.equal(f.ses.check(wc, "notifications"), false);
    let kept = true;
    f.ses.emit("will-download", { preventDefault: () => (kept = false) }, { getFilename: () => "setup.exe" }, wc);
    assert.equal(kept, false);
    assert.deepEqual(said.at(-1), { op: "note", tab: "t1", words: "The page started a download (setup.exe); the browser takes no downloads, so it was not kept." });
    wc.emit("render-process-gone", {}, { reason: "crashed" });
    assert.deepEqual(said.at(-1), { op: "gone", tab: "t1", why: "its page's process ended (crashed)" });
    assert.deepEqual(pages.ids(), ["t-pop"]);
    await pages.handle({ op: "clear" });
    assert.deepEqual(f.ses.cleared, ["storage", "cache", "auth"]);
  });

  // (fails before: yes — the bug hunt of 10-30, DESK-1: a page's link, a redirect or a frame took the agent's browser to
  // Filament's own address, where its API trusts this machine)
  test("Filament's own address is reached by nothing of the profile: a page's link or redirect stopped and said, its popup refused, any request to it cancelled", async () => {
    const f = fakeElectron();
    /** @type {any[]} */
    const said = [];
    const pages = createPages({ electron: f.electron, send: (m) => said.push(m), newId: () => "t-pop", own: (url) => filamentsOwn(url, 20300) });
    await pages.handle({ op: "open", tab: "t1" });
    const wc = f.made.views[0].webContents;
    let stopped = 0;
    wc.emit("will-navigate", { preventDefault: () => stopped++ }, "http://127.0.0.1:20300/api/keys");
    wc.emit("will-redirect", { preventDefault: () => stopped++ }, "http://localhost:20300/");
    wc.emit("will-navigate", { preventDefault: () => stopped++ }, "http://localhost:5173/");
    assert.equal(stopped, 2, "another port of this machine goes");
    assert.deepEqual(said.splice(0), [
      { op: "note", tab: "t1", words: "The page tried to go to http://127.0.0.1:20300/api/keys, Filament's own address; the browser never opens it." },
      { op: "note", tab: "t1", words: "The page tried to go to http://localhost:20300/, Filament's own address; the browser never opens it." },
    ]);
    assert.deepEqual(wc.openHandler({ url: "http://127.0.0.1:20300/" }), { action: "deny" });
    await settle();
    assert.deepEqual(pages.ids(), ["t1"], "no tab for it");
    assert.deepEqual(said.splice(0), [{ op: "note", tab: "t1", words: "The page tried to go to http://127.0.0.1:20300/, Filament's own address; the browser never opens it." }]);
    // Every request of the profile is asked: Filament's cancelled — a script's, a frame's, a page's own, that one said —,
    // another's let go.
    const asked = (/** @type {string} */ url, /** @type {string} */ resourceType) => {
      /** @type {any} */
      let answer = null;
      f.ses.before({ url, resourceType, webContents: wc }, (/** @type {any} */ r) => (answer = r));
      return answer;
    };
    assert.deepEqual(asked("http://127.0.0.1:20300/api/keys", "xhr"), { cancel: true });
    assert.deepEqual(asked("http://127.0.0.1:20300/", "subFrame"), { cancel: true });
    assert.deepEqual(said.splice(0), [], "a script's or a frame's is said by none");
    assert.deepEqual(asked("http://[::1]:20300/", "mainFrame"), { cancel: true });
    assert.deepEqual(said.splice(0), [{ op: "note", tab: "t1", words: "The page tried to go to http://[::1]:20300/, Filament's own address; the browser never opens it." }]);
    assert.deepEqual(asked("http://localhost:5173/", "mainFrame"), { cancel: false });
    assert.deepEqual(asked(artifactAddress("chart-ab12", 20300), "mainFrame"), { cancel: false });
    assert.deepEqual(asked("https://shop.test/", "script"), { cancel: false });
  });

  // (fails before: yes — the review of b-headless: the app knew Filament's main port alone, and its doors — the network's,
  // the artifacts', the tailnet's — were let through)
  test("where Filament says it is reached (`own`) is Filament's too: its doors' ports, its names, the addresses serving it", async () => {
    const f = fakeElectron();
    /** @type {any[]} */
    const said = [];
    const pages = createPages({ electron: f.electron, send: (m) => said.push(m), own: (url) => filamentsOwn(url, 20300) });
    await pages.handle({ op: "open", tab: "t1" });
    const wc = f.made.views[0].webContents;
    const asked = (/** @type {string} */ url, /** @type {string} */ resourceType) => {
      /** @type {any} */
      let answer = null;
      f.ses.before({ url, resourceType, webContents: wc }, (/** @type {any} */ r) => (answer = r));
      return answer;
    };
    const doors = ["https://127.0.0.1:20343/api/keys", "https://192.168.1.4:20344/x/", "http://127.0.0.1:20345/api/state", "https://box.tail0.ts.net/api/state"];
    for (const url of doors) assert.deepEqual(asked(url, "xhr"), { cancel: false }, `${url}: not told yet`);
    assert.equal(await pages.handle({ op: "own", ports: [20300, 20343, 20344, 20345], names: ["192.168.1.4"], origins: ["https://box.tail0.ts.net"] }), null);
    for (const url of doors) assert.deepEqual(asked(url, "xhr"), { cancel: true }, url);
    let stopped = 0;
    wc.emit("will-navigate", { preventDefault: () => stopped++ }, "http://127.0.0.1:20345/");
    assert.equal(stopped, 1);
    assert.deepEqual(said.splice(0), [{ op: "note", tab: "t1", words: "The page tried to go to http://127.0.0.1:20345/, Filament's own address; the browser never opens it." }]);
    assert.deepEqual(asked("http://localhost:5173/", "mainFrame"), { cancel: false }, "another port of this machine goes");
    assert.deepEqual(asked("https://192.168.1.4:5173/", "mainFrame"), { cancel: false });
  });

  // (fails before: yes — b-remote: every page was in the one profile, and a page could reach this computer's localhost)
  test("another machine's pages: a profile of that machine's; nothing of this computer's own at any port, said in words; that machine's Filament once it says where it is reached; the web as here", async () => {
    const f = fakeElectron();
    /** @type {any[]} */
    const said = [];
    // No link carries that machine's localhost here (b-tunnel's `tunneled`, false): this computer's is refused.
    const pages = createPages({ electron: f.electron, send: (m) => said.push(m), newId: () => "t-pop", partition: partitionFor("m-box"), own: (url) => machineOwn(url, { ports: [20300], names: ["127.0.0.1"], origins: [] }, false) });
    await pages.handle({ op: "open", tab: "t1" });
    assert.equal(f.made.partition, "persist:filament-browser-m-box");
    assert.notEqual(partitionFor("m-box"), PARTITION);
    assert.notEqual(partitionFor("m-box"), partitionFor("m-mac"));
    const wc = f.made.views[0].webContents;
    const asked = (/** @type {string} */ url, /** @type {string} */ resourceType) => {
      /** @type {any} */
      let answer = null;
      f.ses.before({ url, resourceType, webContents: wc }, (/** @type {any} */ r) => (answer = r));
      return answer;
    };
    const home = ["http://localhost:5173/", "http://127.0.0.2:8080/x", "http://[::1]:3000/", "http://[::ffff:127.0.0.1]:9229/json", "ws://localhost:9222/devtools", "http://0.0.0.0:8000/", "http://app.localhost/", "http://chart-ab12.art.localhost:20300/"];
    for (const url of home) assert.deepEqual(asked(url, "xhr"), { cancel: true }, url);
    assert.deepEqual(said.splice(0), [], "a script's is said by none");
    assert.deepEqual(asked("http://localhost:5173/", "mainFrame"), { cancel: true });
    assert.deepEqual(said.splice(0), [{ op: "note", tab: "t1", words: loopbackWords("http://localhost:5173/") }]);
    assert.match(loopbackWords("http://localhost:5173/"), /^The page tried to go to http:\/\/localhost:5173\/: this chat's browser runs in the Filament app on the developer's own computer/);
    let stopped = 0;
    wc.emit("will-navigate", { preventDefault: () => stopped++ }, "http://127.0.0.1:3000/");
    wc.emit("will-redirect", { preventDefault: () => stopped++ }, "http://localhost:8080/");
    wc.emit("will-navigate", { preventDefault: () => stopped++ }, "https://shop.test/next");
    assert.equal(stopped, 2);
    assert.deepEqual(said.splice(0), [
      { op: "note", tab: "t1", words: loopbackWords("http://127.0.0.1:3000/") },
      { op: "note", tab: "t1", words: loopbackWords("http://localhost:8080/") },
    ]);
    assert.deepEqual(wc.openHandler({ url: "http://localhost:4000/" }), { action: "deny" });
    await settle();
    assert.deepEqual(pages.ids(), ["t1"], "no tab for it");
    assert.deepEqual(said.splice(0), [{ op: "note", tab: "t1", words: loopbackWords("http://localhost:4000/") }]);
    // That machine's Filament, as it says where it is reached: refused as here, in the same words.
    const there = ["https://192.168.0.9:20343/api/keys", "https://box.tail1234.ts.net/api/state"];
    for (const url of there) assert.deepEqual(asked(url, "xhr"), { cancel: false }, `${url}: not told yet`);
    await pages.handle({ op: "own", ports: [20300, 20343], names: ["192.168.0.9"], origins: ["https://box.tail1234.ts.net"] });
    for (const url of there) assert.deepEqual(asked(url, "xhr"), { cancel: true }, url);
    assert.deepEqual(asked("https://192.168.0.9:20343/", "mainFrame"), { cancel: true });
    assert.deepEqual(said.splice(0), [{ op: "note", tab: "t1", words: "The page tried to go to https://192.168.0.9:20343/, Filament's own address; the browser never opens it." }]);
    for (const url of ["https://shop.test/", "https://192.168.0.9:5173/", "http://10.0.0.4:3000/"]) assert.deepEqual(asked(url, "mainFrame"), { cancel: false }, url);
    assert.deepEqual([onLoopback("file:///C:/x"), onLoopback("not a url"), onLoopback("https://localhost.test/"), onLoopback("http://128.0.0.1/")], [false, false, false, false]);
  });

  // (fails before: yes — b-remote: a machine's view, raised in the window, stood over the pages drawn over its pane)
  test("a window's pages lifted back on top of its views, its veil over them while it lies there; a page parked stays parked", async () => {
    const f = fakeElectron();
    const pages = createPages({ electron: f.electron, send: () => {}, veilPreload: "veil.cjs" });
    await pages.handle({ op: "open", tab: "t1" });
    await pages.handle({ op: "open", tab: "t2" });
    const harness = new f.Win();
    const [v1, v2] = f.made.views;
    assert.equal(pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 }), true);
    const view = { machine: "m-box" };
    harness.contentView.addChildView(view);
    pages.lift(harness);
    assert.deepEqual(harness.contentView.children, [view, v1]);
    assert.ok(!harness.contentView.children.includes(v2), "parked: not drawn");
    assert.equal(pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 }, { lock: true }), true);
    const veil = harness.contentView.children.at(-1);
    assert.notEqual(veil, v1, "the veil on top");
    harness.contentView.addChildView(view);
    pages.lift(harness);
    assert.deepEqual(harness.contentView.children.slice(-3), [view, v1, veil]);
    assert.equal(pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 }), true);
    harness.contentView.addChildView(view);
    pages.lift(harness);
    assert.deepEqual(harness.contentView.children.slice(-2), [view, v1], "unlocked: the veil stays down");
    pages.parkAll(harness);
    harness.contentView.addChildView(view);
    pages.lift(harness);
    assert.deepEqual(harness.contentView.children.at(-1), view, "parked: nothing lifted");
    harness.destroy();
    pages.lift(harness);
  });

  test("a page goes over the pane and back to its parking; one page a window; closing, the link's end and Quit let them go", async () => {
    const f = fakeElectron();
    const pages = createPages({ electron: f.electron, send: () => {} });
    await pages.handle({ op: "open", tab: "t1" });
    await pages.handle({ op: "open", tab: "t2" });
    const [park] = f.made.windows;
    const harness = new f.Win();
    const [v1, v2] = f.made.views;
    assert.equal(pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 }), true);
    assert.deepEqual(harness.contentView.children, [v1]);
    // (fails before: yes — the page took the pane's 500 × 600, the owner's "limited to seeing it in the aspect ratio of
    // how harness present it", 10-23) Its own 1280 × 800, drawn at 500 / 1280 and centred in the pane.
    assert.deepEqual(v1.bounds, { x: 300, y: 183, width: 500, height: 313 });
    assert.equal(pages.place("t2", harness, { x: 300, y: 40, width: 500, height: 600 }), true);
    assert.deepEqual(harness.contentView.children, [v2], "the window's other page parked");
    assert.ok(park.contentView.children.includes(v1));
    assert.deepEqual(v1.bounds, { x: 0, y: 0, ...PARK_SIZE });
    assert.equal(pages.place("t9", harness, { x: 0, y: 0, width: 10, height: 10 }), false);
    pages.parkAll(harness);
    assert.deepEqual(harness.contentView.children, []);
    assert.equal(park.contentView.children.length, 2);
    await pages.handle({ op: "close", tab: "t1" });
    assert.equal(v1.webContents.destroyed, true);
    assert.equal(v1.webContents.debugger.attached, false);
    assert.deepEqual(park.contentView.children, [v2]);
    pages.closeAll();
    assert.deepEqual(pages.ids(), []);
    assert.equal(v2.webContents.destroyed, true);
    pages.destroy();
    assert.equal(park.destroyed, true);
  });
});

// HarnessV4_BrowserSize_Plan BS1, the owner's word of 10-23: "it feels like when agent are driving the internal browser
// they are limited to seeing it in the aspect ratio of how harness present it". Each page keeps its own size.
describe("the page's own size (E31 BS1)", () => {
  const OVERRIDE = "Emulation.setDeviceMetricsOverride";
  /** The size and scale each override told the page, in order. @param {any} view */
  const told = (view) => view.webContents.debugger.sent.filter((/** @type {any} */ [m]) => m === OVERRIDE || m === "Emulation.clearDeviceMetricsOverride").map((/** @type {any} */ [m, p]) => (m === OVERRIDE ? `${p.width}x${p.height}@${Math.round(p.scale * 1e4) / 1e4}` : "fit"));

  // (fails before: yes — the page took the pane's rectangle, and jumped back to 1280 × 800 parked)
  test("parked at its size, drawn over the pane at it — scaled to fit, centred — whatever the pane's shape; told again only when it changes", async () => {
    const f = fakeElectron();
    const pages = createPages({ electron: f.electron, send: () => {} });
    await pages.handle({ op: "open", tab: "t1" });
    await pages.handle({ op: "open", tab: "ph", width: 390, height: 844 });
    const [v1, vp] = f.made.views;
    assert.deepEqual([v1.bounds, vp.bounds], [{ x: 0, y: 0, width: 1280, height: 800 }, { x: 0, y: 0, width: 390, height: 844 }], "parked at its own size");
    assert.deepEqual(told(v1), ["1280x800@1"], "held at its size once its protocol attached");
    assert.deepEqual(vp.webContents.debugger.sent.slice(0, 2).map((/** @type {any} */ [m]) => m), ["Emulation.setFocusEmulationEnabled", OVERRIDE]);
    const harness = new f.Win();
    // A tall, narrow column, then a wide tile: the page's shape stays, only its scale moves.
    pages.place("t1", harness, { x: 900, y: 60, width: 400, height: 700 });
    assert.deepEqual(v1.bounds, { x: 900, y: 285, width: 400, height: 250 });
    pages.place("t1", harness, { x: 0, y: 0, width: 1000, height: 300 });
    assert.deepEqual(v1.bounds, { x: 260, y: 0, width: 480, height: 300 });
    pages.place("t1", harness, { x: 0, y: 0, width: 1000, height: 300 });
    assert.deepEqual(told(v1), ["1280x800@1", "1280x800@0.3125", "1280x800@0.375"], "the same place again tells it nothing");
    // A window bigger than the page: drawn bigger (case 18) — a scale the probe of 10-23 found the page holding.
    pages.place("ph", harness, { x: 0, y: 0, width: 1600, height: 1688 });
    assert.deepEqual([vp.bounds, told(vp).at(-1)], [{ x: 410, y: 0, width: 780, height: 1688 }, "390x844@2"]);
    assert.deepEqual(pages.sizeOf("ph"), { width: 390, height: 844, fit: false, scale: 2 });
    pages.parkAll(harness);
    assert.deepEqual([vp.bounds, told(vp).at(-1)], [{ x: 0, y: 0, width: 390, height: 844 }, "390x844@1"], "parked: its own size at scale 1");
  });

  // (fails before: yes — the agent's protocol click at the page's own point missed under a scale: BS0's probe)
  test("the agent's mouse lands at the page's own point: its points times the scale; its keys, quads and layout as they are", async () => {
    const f = fakeElectron();
    const pages = createPages({ electron: f.electron, send: () => {} });
    await pages.handle({ op: "open", tab: "t1" });
    const [v1] = f.made.views;
    const sent = v1.webContents.debugger.sent;
    const harness = new f.Win();
    pages.place("t1", harness, { x: 0, y: 0, width: 400, height: 250 });
    await pages.handle({ op: "cdp", tab: "t1", method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 1040, y: 720, button: "left", clickCount: 1 } });
    await pages.handle({ op: "cdp", tab: "t1", method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "a" } });
    await pages.handle({ op: "cdp", tab: "t1", method: "DOM.getContentQuads", params: { backendNodeId: 7 } });
    assert.deepEqual(sent.slice(-3), [
      ["Input.dispatchMouseEvent", { type: "mousePressed", x: 325, y: 225, button: "left", clickCount: 1 }],
      ["Input.dispatchKeyEvent", { type: "keyDown", key: "a" }],
      ["DOM.getContentQuads", { backendNodeId: 7 }],
    ]);
    pages.parkAll(harness);
    await pages.handle({ op: "cdp", tab: "t1", method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 1040, y: 720 } });
    assert.deepEqual(sent.at(-1), ["Input.dispatchMouseEvent", { type: "mouseMoved", x: 1040, y: 720 }], "parked, at scale 1: as given");
  });

  test("a size set: drawn again where it shows, parked at it where not, kept inside the limits; Fit the pane takes the pane's size, as before", async () => {
    const f = fakeElectron();
    const pages = createPages({ electron: f.electron, send: () => {} });
    await pages.handle({ op: "open", tab: "t1" });
    const [v1] = f.made.views;
    assert.deepEqual(await pages.handle({ op: "size", tab: "t1", width: 820, height: 1180 }), { width: 820, height: 1180, fit: false });
    assert.deepEqual(v1.bounds, { x: 0, y: 0, width: 820, height: 1180 }, "parked at it");
    const harness = new f.Win();
    pages.place("t1", harness, { x: 10, y: 10, width: 410, height: 590 });
    assert.deepEqual(v1.bounds, { x: 10, y: 10, width: 410, height: 590 });
    assert.deepEqual(await pages.handle({ op: "size", tab: "t1", width: 5000, height: 300 }), { width: 2560, height: 320, fit: false }, "the app keeps to the limits");
    assert.deepEqual(v1.bounds, { x: 10, y: 279, width: 410, height: 51 }, "drawn again in the pane at once");
    // Fit the pane: the pane's rectangle, no override, the agent's points as given.
    assert.deepEqual(await pages.handle({ op: "size", tab: "t1", fit: true }), { width: 2560, height: 320, fit: true });
    assert.deepEqual(v1.bounds, { x: 10, y: 10, width: 410, height: 590 });
    assert.equal(told(v1).at(-1), "fit");
    await pages.handle({ op: "cdp", tab: "t1", method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 100, y: 50 } });
    assert.deepEqual(v1.webContents.debugger.sent.at(-1), ["Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 50 }]);
    await assert.rejects(pages.handle({ op: "size", tab: "t9", width: 800, height: 600 }), /the app has no tab t9 now/);
  });

  test("a popup takes the size of the page that opened it", async () => {
    const f = fakeElectron();
    /** @type {any[]} */
    const said = [];
    const pages = createPages({ electron: f.electron, send: (m) => said.push(m), newId: () => "t-pop" });
    await pages.handle({ op: "open", tab: "t1", width: 390, height: 844 });
    f.made.views[0].webContents.openHandler({ url: "https://pay.test/" });
    await settle();
    assert.deepEqual(said.at(-1), { op: "popup", tab: "t-pop", from: "t1", url: "https://pay.test/", width: 390, height: 844 });
    assert.deepEqual(f.made.views[1].bounds, { x: 0, y: 0, width: 390, height: 844 });
  });

  // (fails before: yes — BS0's probe: a page just opened refuses its first capture for a moment, and the call failed)
  test("a capture the app refuses is asked for again a few seconds, then said with its words", async () => {
    const f = fakeElectron();
    let t = 0;
    const pages = createPages({ electron: f.electron, send: () => {}, clock: () => t, wait: async (ms) => void (t += ms) });
    await pages.handle({ op: "open", tab: "t1" });
    const wc = f.made.views[0].webContents;
    const real = wc.capturePage.bind(wc);
    let refusals = 3;
    wc.capturePage = async () => {
      if (refusals-- > 0) throw new Error("Current display surface not available for capture");
      return real();
    };
    assert.deepEqual(await pages.handle({ op: "capture", tab: "t1", width: 1280, height: 800 }), { data: Buffer.from("jpeg 70").toString("base64"), mediaType: "image/jpeg" });
    assert.equal(t, 600, "three tries 200 ms apart");
    wc.capturePage = async () => {
      throw new Error("Current display surface not available for capture");
    };
    t = 0;
    await assert.rejects(pages.handle({ op: "capture", tab: "t1", width: 1, height: 1 }), { message: "the app took no picture of the page in 5 s: Current display surface not available for capture" });
    assert.equal(t, 5000);
  });

  // (fails before: yes — the owner's look of 10-24: a page drawn over the pane at 0.41 came back as a picture of its own
  // size with the page in its top-left 41% — Electron's capture of the override's surface — and one drawn larger, cut)
  test("a page drawn over the pane at another scale is Chrome's own screenshot of it at its size; parked, Electron's capture", async () => {
    const f = fakeElectron();
    /** @type {string[]} */
    const decoded = [];
    /** @type {any[]} */
    const resized = [];
    /** @type {any} */
    const shotImg = { isEmpty: () => false, getSize: () => ({ width: 2560, height: 1600 }), resize: (/** @type {any} */ o) => (resized.push(o), shotImg), toJPEG: (/** @type {number} */ q) => Buffer.from(`shot ${q}`) };
    const nativeImage = { createFromBuffer: (/** @type {Buffer} */ b) => (decoded.push(b.toString()), shotImg) };
    let t = 0;
    // The clock moves at once; the wait itself ends a task later, so an answer already on its way comes first.
    const pages = createPages({ electron: { ...f.electron, nativeImage }, send: () => {}, clock: () => t, wait: (ms) => ((t += ms), new Promise((r) => setTimeout(r, 0))) });
    await pages.handle({ op: "open", tab: "t1" });
    await pages.handle({ op: "open", tab: "ph", width: 390, height: 844 });
    const [v1, vp] = f.made.views;
    /** Chrome's screenshot as `answer` gives it; the page's other commands as before. @param {any} v @param {() => Promise<any>} answer */
    const shotBy = (v, answer) => {
      const d = v.webContents.debugger;
      d.sendCommand = async (/** @type {string} */ m, /** @type {any} */ p) => (d.sent.push([m, p]), m === "Page.captureScreenshot" ? answer() : { done: m });
    };
    const png = async () => ({ data: Buffer.from("png").toString("base64") });
    shotBy(v1, png);
    shotBy(vp, png);
    const shots = (/** @type {any} */ v) => v.webContents.debugger.sent.filter((/** @type {any} */ [m]) => m === "Page.captureScreenshot").length;
    const picture = (/** @type {string} */ tab) => pages.handle({ op: "capture", tab, width: 1280, height: 800 });
    const said = (/** @type {string} */ s) => ({ data: Buffer.from(s).toString("base64"), mediaType: "image/jpeg" });
    assert.deepEqual(await picture("t1"), said("jpeg 70"), "parked at scale 1: Electron's capture, as before");
    assert.equal(shots(v1), 0);
    const harness = new f.Win();
    pages.place("t1", harness, { x: 900, y: 60, width: 400, height: 700 });
    assert.equal(pages.sizeOf("t1")?.scale, 0.3125);
    assert.deepEqual(await picture("t1"), said("shot 70"));
    assert.deepEqual([shots(v1), decoded, resized], [1, ["png"], [{ width: 1280, height: 800, quality: "good" }]], "the page's own picture, at the size asked");
    pages.place("ph", harness, { x: 0, y: 0, width: 1600, height: 1688 });
    assert.deepEqual([await picture("ph"), shots(vp)], [said("shot 70"), 1], "drawn larger (at 2): Chrome's too");
    // Chrome's screenshot refused, or never answering: a page drawn smaller is Electron's capture cut by the scale.
    /** @type {any[]} */
    const crops = [];
    v1.webContents.capturePage = async () => {
      /** @type {any} */
      const img = { isEmpty: () => false, getSize: () => ({ width: 2560, height: 1600 }), crop: (/** @type {any} */ r) => (crops.push(r), img), resize: () => img, toJPEG: (/** @type {number} */ q) => Buffer.from(`cut ${q}`) };
      return img;
    };
    pages.place("t1", harness, { x: 900, y: 60, width: 400, height: 700 });
    shotBy(v1, async () => { throw new Error("no frame"); });
    assert.deepEqual(await picture("t1"), said("cut 70"));
    shotBy(v1, () => new Promise(() => {}));
    assert.deepEqual(await picture("t1"), said("cut 70"));
    assert.deepEqual(crops, [{ x: 0, y: 0, width: 800, height: 500 }, { x: 0, y: 0, width: 800, height: 500 }], "its corner at 0.3125: the page's part");
    // One drawn larger has no such cut: said, as a refused capture is.
    pages.place("ph", harness, { x: 0, y: 0, width: 1600, height: 1688 });
    shotBy(vp, async () => { throw new Error("no frame"); });
    t = 0;
    await assert.rejects(picture("ph"), { message: "the app took no picture of the page in 5 s: no frame" });
    pages.parkAll(harness);
    const asked = shots(vp);
    assert.deepEqual([await picture("ph"), shots(vp)], [said("jpeg 70"), asked], "parked again: Electron's capture, Chrome's not asked");
  });

  // (fails before: yes — the drive's check 34 with the app's window in sight: a press from a cast, its pictures Chrome's
  // screenshots every 200 ms, reached the page while Chrome drew it at scale 1 and landed at 0.32 of its point)
  test("a mouse's point waits for Chrome's screenshot under way, and a screenshot for a mouse's; one that never answers holds neither past its time", async () => {
    const f = fakeElectron();
    const shotImg = { isEmpty: () => false, getSize: () => ({ width: 2560, height: 1600 }), resize: () => shotImg, toJPEG: () => Buffer.from("shot") };
    const nativeImage = { createFromBuffer: () => shotImg };
    /** The waits under way, each ended by the test. @type {(() => void)[]} */
    const timers = [];
    const pages = createPages({ electron: { ...f.electron, nativeImage }, send: () => {}, wait: () => new Promise((r) => timers.push(() => r(undefined))) });
    await pages.handle({ op: "open", tab: "t1" });
    const [v1] = f.made.views;
    // Electron's capture, cut by the scale where Chrome's screenshot never answers.
    v1.webContents.capturePage = async () => ({ ...shotImg, crop: () => shotImg });
    const d = v1.webContents.debugger;
    /** The answers each command waits for, by method, in the order asked. @type {Map<string, (() => void)[]>} */
    const held = new Map();
    d.sendCommand = (/** @type {string} */ m, /** @type {any} */ p) => {
      d.sent.push([m, p]);
      if (m !== "Page.captureScreenshot" && m !== "Input.dispatchMouseEvent") return Promise.resolve({ done: m });
      return new Promise((r) => held.set(m, [...(held.get(m) || []), () => r(m === "Page.captureScreenshot" ? { data: Buffer.from("png").toString("base64") } : {})]));
    };
    const answer = (/** @type {string} */ m) => held.get(m)?.shift()?.();
    const mice = () => d.sent.filter(([m]) => m === "Input.dispatchMouseEvent").map(([, p]) => [p.type, p.x, p.y]);
    const shots = () => d.sent.filter(([m]) => m === "Page.captureScreenshot").length;
    pages.place("t1", new f.Win(), { x: 0, y: 0, width: 400, height: 250 });
    assert.equal(pages.sizeOf("t1")?.scale, 0.3125);
    // A screenshot under way: the press waits for it, then goes at the scale.
    const picture = pages.handle({ op: "capture", tab: "t1", width: 1280, height: 800 });
    await settle();
    const press = pages.handle({ op: "cdp", tab: "t1", method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 1040, y: 720, button: "left", clickCount: 1 } });
    await settle();
    assert.deepEqual([shots(), mice()], [1, []], "no mouse while Chrome draws the page at scale 1");
    answer("Page.captureScreenshot");
    await picture;
    await settle();
    assert.deepEqual(mice(), [["mousePressed", 325, 225]]);
    // A press under way: the next screenshot waits for it.
    const next = pages.handle({ op: "capture", tab: "t1", width: 1280, height: 800 });
    await settle();
    assert.equal(shots(), 1, "no screenshot while a press is on its way");
    answer("Input.dispatchMouseEvent");
    await press;
    await settle();
    assert.equal(shots(), 2);
    answer("Page.captureScreenshot");
    await next;
    // A screenshot that never answers: the press waits for its time, then goes.
    const stuck = pages.handle({ op: "capture", tab: "t1", width: 1280, height: 800 });
    await settle();
    const late = pages.handle({ op: "cdp", tab: "t1", method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: 1040, y: 720, button: "left", clickCount: 1 } });
    await settle();
    assert.deepEqual(mice(), [["mousePressed", 325, 225]]);
    for (const fire of timers.splice(0)) fire();
    await settle();
    assert.deepEqual(mice(), [["mousePressed", 325, 225], ["mouseReleased", 325, 225]]);
    answer("Input.dispatchMouseEvent");
    await late;
    assert.deepEqual(await stuck, { data: Buffer.from("shot").toString("base64"), mediaType: "image/jpeg" }, "the picture Electron's, cut");
    held.delete("Page.captureScreenshot");
    // Its keys never wait.
    const typing = pages.handle({ op: "capture", tab: "t1", width: 1280, height: 800 });
    await settle();
    await pages.handle({ op: "cdp", tab: "t1", method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "a" } });
    assert.deepEqual(d.sent.at(-1), ["Input.dispatchKeyEvent", { type: "keyDown", key: "a" }]);
    answer("Page.captureScreenshot");
    await typing;
  });
});

// HarnessV4_BrowserSize_Plan BS3, the owner's word of 10-23: "whenever the browser tab is in control of an agent and we
// hover the mouse in that window it should shows a faded take over button that will allow user to interact with the
// content as well and if the mouse moves out for few seconds like maybe 5 seconds than control is lost again".
describe("the developer's hand on the page (E31 BS3)", () => {
  /** A page placed in a window, the pointer, the clock and the watch in the test's hand. */
  async function handed() {
    const f = fakeElectron();
    let t = 0;
    /** @type {{ x: number, y: number } | null} */
    let at = null;
    /** @type {any} */
    let tick = null;
    /** @type {any[]} */
    const told = [];
    /** @type {any[]} */
    const stopped = [];
    const pages = createPages({
      electron: f.electron,
      send: () => {},
      clock: () => t,
      pointer: () => at,
      tellPane: (_w, m) => told.push(m),
      veilPreload: "C:/app/desktop/veil-preload.cjs",
      every: (fn) => ((tick = fn), "the watch"),
      stopEvery: (x) => void stopped.push(x),
    });
    await pages.handle({ op: "open", tab: "t1" });
    const harness = new f.Win();
    return {
      f,
      pages,
      harness,
      told,
      stopped,
      view: f.made.views[0],
      /** The pointer at a point of the window's content, or off every window. @param {number | null} x @param {number} [y] */
      point: (x, y = 0) => void (at = x === null ? null : { x: harness.content.x + x, y: harness.content.y + y }),
      /** The clock at `ms`, and the watch's tick. @param {number} ms */
      tickAt: (ms) => {
        t = ms;
        tick?.();
      },
    };
  }
  // (fails before: yes — nothing lay over an agent's page: the developer's mouse reached it at any time)
  test("while an agent drives, a see-through veil lies on the page's drawn place, on top; once made, and gone when it does not", async () => {
    const { f, pages, harness, view } = await handed();
    assert.equal(pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 }, { lock: true }), true);
    const veil = f.made.views[1];
    assert.deepEqual(harness.contentView.children, [view, veil], "the veil over the page");
    assert.deepEqual(veil.bounds, { x: 300, y: 183, width: 500, height: 313 }, "on the page's drawn place, not the pane's");
    assert.deepEqual([veil.opts.webPreferences.sandbox, veil.opts.webPreferences.contextIsolation, veil.opts.webPreferences.nodeIntegration], [true, true, false]);
    assert.equal(veil.opts.webPreferences.preload, "C:/app/desktop/veil-preload.cjs");
    assert.notEqual(veil.opts.webPreferences.partition, PARTITION, "not the pages' profile");
    assert.match(veil.webContents.loads[0], /^data:text\/html;charset=utf-8,/);
    assert.match(decodeURIComponent(veil.webContents.loads[0]), /Take over/);
    let stopped = 0;
    veil.webContents.emit("will-navigate", { preventDefault: () => stopped++ }, "https://evil.test/");
    assert.equal(stopped, 1, "the veil goes nowhere");
    pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 });
    assert.deepEqual(harness.contentView.children, [view], "the agent's turn over: the page is the developer's to use");
    pages.place("t1", harness, { x: 0, y: 0, width: 640, height: 400 }, { lock: true });
    assert.deepEqual([harness.contentView.children, veil.bounds], [[view, veil], { x: 0, y: 0, width: 640, height: 400 }]);
    assert.equal(f.made.views.length, 2, "the window's one veil, made once");
    pages.parkAll(harness);
    assert.deepEqual(harness.contentView.children, [], "parked, its veil off with it");
  });

  // (fails before: yes — the hunt of p3-add: Ctrl+1..9 pressed in the agent's page, or on its veil, was the page's alone)
  test("a key pressed in a page or on its veil is handed on with the window it stands in, the rail's to take", async () => {
    const f = fakeElectron();
    /** @type {any[]} */
    const heard = [];
    const pages = createPages({ electron: f.electron, send: () => {}, keys: (w, e, input) => heard.push([w, e, input.key]) });
    await pages.handle({ op: "open", tab: "t1" });
    const harness = new f.Win();
    const view = f.made.views[0];
    const e = { preventDefault() {} };
    view.webContents.emit("before-input-event", e, { type: "keyDown", control: true, key: "2" });
    assert.notEqual(heard[0][0], harness, "parked: not the harness window's");
    pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 }, { lock: true });
    view.webContents.emit("before-input-event", e, { type: "keyDown", control: true, key: "2" });
    const veil = f.made.views[1];
    veil.webContents.emit("before-input-event", e, { type: "keyDown", control: true, key: "3" });
    assert.deepEqual(heard.slice(1), [[harness, e, "2"], [harness, e, "3"]]);
  });

  // (fails before: yes — the owner's report of 10-30: an agent closed its tab while the pane showed it under the veil;
  // the window kept the veil over nothing, its Take over under the pointer where the pane had been, whether the pane
  // was opened and closed again or not)
  test("a page closed, its link to Filament gone, or shown in another window takes its veil with it", async () => {
    const { f, pages, harness } = await handed();
    const rect = { x: 300, y: 40, width: 500, height: 600 };
    pages.place("t1", harness, rect, { lock: true });
    await pages.handle({ op: "close", tab: "t1" });
    assert.deepEqual(harness.contentView.children, [], "the agent closed its tab: no veil left over nothing");
    pages.parkAll(harness);
    assert.deepEqual(harness.contentView.children, [], "the pane, with no page to show, parks nothing and leaves nothing");
    await pages.handle({ op: "open", tab: "t2" });
    pages.place("t2", harness, rect, { lock: true });
    pages.closeAll();
    assert.deepEqual(harness.contentView.children, [], "the link went: its pages and the veil over them");
    // A pane popped out (BS4) shows the page in a window of its own: the window it left keeps no veil.
    await pages.handle({ op: "open", tab: "t3" });
    const page = f.made.views.at(-1);
    const popped = new f.Win();
    pages.place("t3", harness, rect, { lock: true });
    pages.place("t3", popped, rect, { lock: true });
    assert.deepEqual(harness.contentView.children, [], "the window it left");
    assert.deepEqual(popped.contentView.children, [page, f.made.views.at(-1)], "the window it is shown in: the page, its own veil over it");
  });

  // (fails before: yes — the owner's ask: there was no Take over on the page, nor a give-back of its own)
  test("its Take over: the page in the developer's hand, the pane told; 5 s with the pointer off the page and no key, and it goes back", async () => {
    const { f, pages, harness, view, told, stopped, point, tickAt } = await handed();
    pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 }, { lock: true });
    const veil = f.made.views[1];
    assert.equal(pages.veilPressed({}), false, "a press from no veil of the app's");
    point(310, 190);
    assert.equal(pages.veilPressed(veil.webContents), true);
    assert.deepEqual(harness.contentView.children, [view], "the veil off: the developer's mouse on the page");
    assert.deepEqual(told, [{ state: "take", tab: "t1" }]);
    assert.deepEqual(pages.handOf(), { tab: "t1", away: false });
    pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 }, { lock: true });
    assert.deepEqual(harness.contentView.children, [view], "in their hand, no veil, whatever the pane asks");
    tickAt(0);
    assert.equal(told.length, 1, "over the page: held, nothing said");
    // The pointer leaves: the seconds go down, each said once.
    point(900, 190);
    tickAt(1000);
    tickAt(1800);
    tickAt(2000);
    tickAt(2100);
    tickAt(3000);
    assert.deepEqual(told.slice(1), [{ state: "away", tab: "t1", left: 5 }, { state: "away", tab: "t1", left: 4 }, { state: "away", tab: "t1", left: 3 }]);
    // A key typed into the page starts the 5 s again; a mouse's move off it does not.
    view.webContents.emit("input-event", {}, { type: "mouseMove" });
    view.webContents.emit("input-event", {}, { type: "keyDown", key: "a" });
    assert.deepEqual(told.at(-1), { state: "away", tab: "t1", left: 5 });
    // Back over the page: held.
    point(799, 495);
    tickAt(3500);
    assert.deepEqual(told.at(-1), { state: "held", tab: "t1" });
    assert.deepEqual(pages.handOf(), { tab: "t1", away: false });
    point(null);
    tickAt(10_000);
    tickAt(14_999);
    assert.equal(pages.handOf()?.away, true);
    tickAt(15_000);
    assert.deepEqual(told.at(-1), { state: "over", tab: "t1", why: "over" });
    assert.deepEqual([pages.handOf(), stopped], [null, ["the watch"]]);
    pages.place("t1", harness, { x: 300, y: 40, width: 500, height: 600 }, { lock: true });
    assert.deepEqual(harness.contentView.children, [view, veil], "the veil back while the agent drives");
  });

  test("Give back at the pane stops the watch, said to nobody; another page, the page gone or the window closed end the hand, said", async () => {
    const { f, pages, harness, told, stopped, tickAt } = await handed();
    const rect = { x: 300, y: 40, width: 500, height: 600 };
    pages.place("t1", harness, rect, { lock: true });
    const veil = f.made.views[1];
    pages.veilPressed(veil.webContents);
    pages.handOff(new f.Win());
    assert.ok(pages.handOf(), "another window's Give back is no word of this one's");
    pages.handOff(harness);
    assert.deepEqual([pages.handOf(), stopped, told.at(-1)], [null, ["the watch"], { state: "take", tab: "t1" }]);
    // Another tab shown in the pane.
    await pages.handle({ op: "open", tab: "t2" });
    pages.place("t1", harness, rect, { lock: true });
    pages.veilPressed(veil.webContents);
    pages.place("t2", harness, rect, { lock: true });
    assert.deepEqual(told.at(-1), { state: "over", tab: "t1", why: "gone" });
    assert.deepEqual(harness.contentView.children.at(-1), veil, "the new page under the veil while the agent drives");
    // The page closed under the hand.
    pages.veilPressed(veil.webContents);
    await pages.handle({ op: "close", tab: "t2" });
    tickAt(100);
    assert.deepEqual([told.at(-1), pages.handOf()], [{ state: "over", tab: "t2", why: "gone" }, null]);
    // The window closes.
    pages.place("t1", harness, rect, { lock: true });
    pages.veilPressed(veil.webContents);
    pages.forgetWindow(harness);
    assert.deepEqual([told.at(-1), pages.handOf()], [{ state: "over", tab: "t1", why: "gone" }, null]);
    assert.equal(veil.webContents.destroyed, true, "its veil let go");
    assert.deepEqual(harness.contentView.children, []);
  });
});

describe("the pane's bridge and the link", () => {
  test("the pane's rectangle: CSS pixels times the page's zoom, inside the window, or nothing", () => {
    assert.deepEqual(placeRect({ x: 300, y: 40.4, width: 500, height: 600 }, 1, { width: 1440, height: 900 }), { x: 300, y: 40, width: 500, height: 600 });
    assert.deepEqual(placeRect({ x: 300, y: 40, width: 500, height: 600 }, 1.25, { width: 1440, height: 900 }), { x: 375, y: 50, width: 625, height: 750 });
    assert.deepEqual(placeRect({ x: 1200, y: 0, width: 500, height: 2000 }, 1, { width: 1440, height: 900 }), { x: 1200, y: 0, width: 240, height: 900 }, "cut to the window");
    assert.equal(placeRect({ x: 0, y: 0, width: 4, height: 600 }, 1, { width: 1440, height: 900 }), null);
    assert.equal(placeRect({ x: "a", y: 0, width: 400, height: 600 }, 1, { width: 1440, height: 900 }), null);
    assert.equal(placeRect(null, 1, { width: 1440, height: 900 }), null);
    assert.equal(paneHears(true, "http://127.0.0.1:20300/ui/harness.html#/task/c1", "http://127.0.0.1:20300"), true);
    assert.equal(paneHears(false, "http://127.0.0.1:20300/ui/harness.html", "http://127.0.0.1:20300"), false, "another window");
    assert.equal(paneHears(true, "http://evil.test/", "http://127.0.0.1:20300"), false, "a page not Filament's");
    // A visual's frame in the harness (a sandboxed srcdoc), were a bridge in it: its origin is opaque, never Filament's,
    // so it is handed no press key (the xd-key hunt's plausible).
    assert.equal(paneHears(true, "about:srcdoc", "http://127.0.0.1:20300"), false, "a visual's frame");
    assert.equal(paneHears(true, "about:blank", "http://127.0.0.1:20300"), false, "a blank frame");
    assert.equal(mayGo("https://a.test"), true);
    assert.equal(mayGo("about:blank"), true);
    assert.equal(mayGo("chrome://settings"), false);
  });

  test("the inbound key is read from the data folder as Filament keeps it, sealed or not, and nothing is written", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-desktop-key-"));
    try {
      assert.equal(inboundKeyOf(dir), "", "no config yet");
      writeFileSync(join(dir, "config.json"), JSON.stringify({ server: { inboundKeys: ["sk-filament-plain"] } }));
      assert.equal(inboundKeyOf(dir), "sk-filament-plain");
      const key = /** @type {Buffer} */ (loadKey(dir));
      writeFileSync(join(dir, "config.json"), JSON.stringify({ server: { inboundKeys: [seal("sk-filament-sealed", key)] } }));
      const before = readFileSync(join(dir, "config.json"), "utf8");
      assert.equal(inboundKeyOf(dir), "sk-filament-sealed");
      assert.equal(readFileSync(join(dir, "config.json"), "utf8"), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the link connects with the key, hears Filament, says its end once, and tries again a little later each time", () => {
    /** @type {any[]} */
    const sockets = [];
    class FakeSocket {
      /** @param {string} url @param {any} o */
      constructor(url, o) {
        this.url = url;
        this.o = o;
        /** @type {string[]} */
        this.sent = [];
        /** @type {any} */
        this.onopen = null;
        /** @type {any} */
        this.onclose = null;
        /** @type {any} */
        this.onmessage = null;
        sockets.push(this);
      }
      /** @param {string} t */
      send(t) {
        this.sent.push(t);
      }
      close() {
        this.onclose?.();
      }
    }
    /** @type {{ fn: () => void, ms: number }[]} */
    const timers = [];
    /** @type {any[]} */
    const heard = [];
    /** @type {string[]} */
    const lines = [];
    let downs = 0;
    let key = "";
    const link = createLink({
      url: () => "ws://127.0.0.1:20300/api/browser/host",
      key: () => key,
      onMessage: (m) => heard.push(m),
      onDown: () => downs++,
      log: (l) => lines.push(l),
      WebSocket: FakeSocket,
      wait: (fn, ms) => (timers.push({ fn, ms }), timers.length),
      clear: () => {},
    });
    link.start();
    assert.equal(sockets.length, 0, "no key, no try");
    assert.deepEqual(timers.map((t) => t.ms), [RETRY_MS[0]]);
    key = "sk-k";
    timers.shift()?.fn();
    const s = sockets[0];
    assert.equal(s.url, "ws://127.0.0.1:20300/api/browser/host");
    assert.deepEqual(s.o, { headers: { authorization: "Bearer sk-k" } });
    s.close();
    assert.equal(downs, 0, "never up: no end to tell");
    assert.deepEqual(timers.map((t) => t.ms), [RETRY_MS[1]]);
    timers.shift()?.fn();
    const s2 = sockets[1];
    s2.onopen();
    assert.equal(link.up, true);
    link.send({ n: 1, ok: true, result: null });
    assert.deepEqual(s2.sent, ['{"n":1,"ok":true,"result":null}']);
    s2.onmessage({ data: '{"n":4,"op":"open","tab":"t1"}' });
    s2.onmessage({ data: "not json" });
    assert.deepEqual(heard, [{ n: 4, op: "open", tab: "t1" }]);
    s2.close();
    assert.equal(downs, 1);
    assert.deepEqual(timers.map((t) => t.ms), [RETRY_MS[0]], "up once, the waits start again");
    link.stop();
    timers.shift()?.fn();
    assert.equal(sockets.length, 2, "stopped: no more tries");
    assert.equal(lines.filter((l) => /no inbound key/.test(l)).length, 1);
    assert.ok(lines.includes("the browser's link to Filament is up") && lines.includes("the browser's link to Filament went"), lines.join("\n"));
  });

  test("against a real Filament: the link takes its key from the data folder, and Filament has a browser while it holds", async () => {
    const shim = await startApp({ key: "sk-filament-desk" });
    try {
      const link = createLink({ url: () => `${shim.url.replace(/^http/, "ws")}/api/browser/host`, key: () => inboundKeyOf(shim.dataDir), onMessage: () => {} });
      link.start();
      for (let i = 0; i < 100 && !link.up; i++) await new Promise((r) => setTimeout(r, 20));
      assert.equal(link.up, true);
      assert.equal((await (await shim.api("/api/browser")).json()).available, true);
      link.stop();
      for (let i = 0; i < 100 && (await (await shim.api("/api/browser")).json()).available; i++) await new Promise((r) => setTimeout(r, 20));
      assert.equal((await (await shim.api("/api/browser")).json()).available, false);
    } finally {
      await shim.stop();
    }
  });
});
