// @ts-check
// The agent's browser, live, for a pane with no app of its own (the owner's remote Filament of 11-06, Part 4): another
// machine's harness, or a browser's tab, saw the agent's page as a picture read every 2 s, and could only watch. Now
// the app casts the page the pane shows — Chrome's screencast where it is drawn over a pane, the frames it paints where
// it is parked — each frame a JPEG, the newest alone; Filament hands each frame to the pages that watch, an older one
// dropped; the run socket carries them, a frame its socket cannot take yet waiting as the newest alone; and while the
// person has taken the browser over, their clicks and keys reach the page as Chrome's input — a view-only device's
// never. Where no cast is on, the 2 s picture stands in, as before.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { CAST_LONG, CAST_MS, CAST_QUALITY, CAST_SHOT_MS, createPages } from "../desktop/lib/browser-host.js";
import { NO_HOST, createBrowserHost } from "../src/app/browser/host.js";
import { NOT_TAKEN_WORDS, createBrowsers, inputCommand } from "../src/app/browser/registry.js";
import { VIEW_CAST_WORDS, VIEW_INPUT_WORDS, runSocketUpgrade } from "../src/http/admin/run-socket.js";
import { WsDecoder, wsTextFrame } from "../src/http/ws.js";
import { createRunSocket } from "../src/ui/harness/lib/run-socket.js";
import { LINE_PX, VIEW_ONLY_BROWSER_WORDS, lineOf, pagePoint, refreshBrowser, renderBrowser, setBrowserViewOnly } from "../src/ui/harness/panes/browser.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const settle = () => new Promise((r) => setTimeout(r, 5));
/** A JPEG's bytes as the app sends them. @param {string} s */
const b64 = (s) => Buffer.from(s).toString("base64");

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

/** A picture of the app's, named: its JPEG is its name and quality. @param {string} name */
function picture(name) {
  /** @type {any} */
  const img = {
    name,
    resized: null,
    isEmpty: () => false,
    getSize: () => ({ width: 2560, height: 1600 }),
    resize: (/** @type {any} */ o) => ((img.resized = o), img),
    toJPEG: (/** @type {number} */ q) => Buffer.from(`${name}@${q}`),
  };
  return img;
}

/**
 * Stand-ins for the Electron the pages use, with what a cast asks of a page: its protocol's commands and events, its
 * captures.
 * @param {{ startScreencast?: () => Promise<any> }} [o]  how Chrome answers a screencast's start
 */
function fakeElectron({ startScreencast = async () => ({}) } = {}) {
  /** @type {{ windows: any[], views: any[] }} */
  const made = { windows: [], views: [] };
  class Debugger extends Emitter {
    constructor() {
      super();
      this.attached = false;
      /** @type {[string, any][]} */
      this.sent = [];
    }
    attach() {
      this.attached = true;
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
      return m === "Page.startScreencast" ? startScreencast() : {};
    }
    /** The commands of a name sent. @param {string} m */
    of(m) {
      return this.sent.filter(([x]) => x === m).map(([, p]) => p);
    }
  }
  class WebContents extends Emitter {
    constructor() {
      super();
      this.debugger = new Debugger();
      /** What the page shows now, as a capture takes it: its picture's name. */
      this.shows = "capture";
      /** The last picture a capture took, and how many it took. @type {any} */
      this.lastPicture = null;
      this.captures = 0;
      this.destroyed = false;
    }
    async loadURL() {}
    async capturePage() {
      this.captures++;
      return (this.lastPicture = picture(this.shows));
    }
    setWindowOpenHandler() {}
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
    /** @param {any} v */
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
      made.windows.push(this);
    }
    getContentBounds() {
      return { x: 0, y: 0, width: 1440, height: 900 };
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const ses = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} }, on() {} };
  return { electron: { WebContentsView: View, BrowserWindow: Win, session: { fromPartition: () => ses } }, made, Win };
}

/** A clock's waits held until the test lets them go. */
function heldWaits() {
  /** @type {{ ms: number, go: () => void }[]} */
  const waits = [];
  return {
    waits,
    /** @param {number} ms */
    wait: (ms) => new Promise((r) => void waits.push({ ms, go: () => r(undefined) })),
    go: () => {
      for (const w of waits.splice(0)) w.go();
    },
  };
}

/** The frames the app sent Filament. @param {any[]} said */
const framesIn = (said) => said.filter((m) => m.op === "frame");

describe("the app casts a page (E-remote Part 4)", () => {
  // (fails before: yes — the app knew no `cast`: "cast is nothing the app's browser does")
  test("a page a pane draws at its own size is Chrome's screencast: started at its size, the page as it is sent at once, each frame numbered with the page's own size, the next asked for no sooner than CAST_MS; stopped as the cast is", async () => {
    const f = fakeElectron();
    /** @type {any[]} */
    const said = [];
    const held = heldWaits();
    const pages = createPages({ electron: f.electron, send: (m) => said.push(m), wait: held.wait });
    await pages.handle({ op: "open", tab: "t1" });
    const win = new f.Win();
    assert.equal(pages.place("t1", win, { x: 0, y: 0, width: 1280, height: 800 }), true);
    const dbg = f.made.views[0].webContents.debugger;
    assert.deepEqual(await pages.handle({ op: "cast", tab: "t1", on: true }), { casting: true, way: "screencast" });
    assert.deepEqual(dbg.of("Page.startScreencast"), [{ format: "jpeg", quality: CAST_QUALITY, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 }]);
    await settle();
    // The page as it is, at once: a page that paints nothing new would cast nothing.
    assert.deepEqual(framesIn(said), [{ op: "frame", tab: "t1", seq: 1, data: b64(`capture@${CAST_QUALITY}`), width: 1280, height: 800, way: "screencast" }]);
    dbg.emit("message", {}, "Page.screencastFrame", { data: "U0NSRUVO", sessionId: 7, metadata: {} });
    assert.deepEqual(framesIn(said).at(-1), { op: "frame", tab: "t1", seq: 2, data: "U0NSRUVO", width: 1280, height: 800, way: "screencast" });
    assert.equal(said.filter((m) => m.op === "event").length, 0, "the screencast's frames are no event of the driver's");
    // Chrome makes its next frame once this one is acked: not before CAST_MS.
    assert.deepEqual(dbg.of("Page.screencastFrameAck"), []);
    assert.deepEqual(held.waits.map((w) => w.ms), [CAST_MS]);
    held.go();
    await settle();
    assert.deepEqual(dbg.of("Page.screencastFrameAck"), [{ sessionId: 7 }]);
    assert.deepEqual(pages.castOf("t1"), { way: "screencast" });
    // Asked again as it is, nothing starts again.
    await pages.handle({ op: "cast", tab: "t1", on: true });
    assert.equal(dbg.of("Page.startScreencast").length, 1);
    assert.deepEqual(await pages.handle({ op: "cast", tab: "t1", on: false }), { casting: false, way: null });
    assert.deepEqual(dbg.of("Page.stopScreencast"), [{}]);
    assert.equal(pages.castOf("t1"), null);
    const before = framesIn(said).length;
    dbg.emit("message", {}, "Page.screencastFrame", { data: "TEFURQ==", sessionId: 8 });
    assert.equal(framesIn(said).length, before, "a frame late after the stop goes nowhere");
    await settle();
    assert.deepEqual(dbg.of("Page.screencastFrameAck").at(-1), { sessionId: 8 }, "and is acked all the same");
    await assert.rejects(pages.handle({ op: "cast", tab: "t9", on: true }), /the app has no tab t9 now/);
  });

  // (fails before: yes — the drive's check 34: a page a pane drew at another scale was cast by Chrome's screencast, whose
  // frame is the view's own size of the page at scale 1 — its corner, stretched —, and a parked one by the frames it
  // paints, which a window no one sees may never paint)
  test("a parked page, or one a pane draws at another scale, is cast by its picture every CAST_SHOT_MS, sent where it changed; at its own size over a pane, the screencast, and its picture again as it parks; closed, no picture is taken", async () => {
    const f = fakeElectron();
    /** @type {any[]} */
    const said = [];
    const held = heldWaits();
    const pages = createPages({ electron: f.electron, send: (m) => said.push(m), wait: held.wait });
    await pages.handle({ op: "open", tab: "t1" });
    const wc = f.made.views[0].webContents;
    assert.deepEqual(await pages.handle({ op: "cast", tab: "t1", on: true }), { casting: true, way: "shots" });
    assert.deepEqual(wc.debugger.of("Page.startScreencast"), [], "a window no one sees gives the screencast nothing");
    await settle();
    assert.deepEqual(framesIn(said).map((m) => [m.seq, m.data, m.way]), [[1, b64(`capture@${CAST_QUALITY}`), "shots"]]);
    assert.deepEqual(wc.lastPicture.resized, { width: 1280, height: 800, quality: "good" }, "at the page's own size");
    assert.deepEqual(held.waits.map((w) => w.ms), [CAST_SHOT_MS]);
    // The page as it was: taken, and sent nowhere; changed: sent.
    held.go();
    await settle();
    assert.equal(wc.captures, 2);
    assert.equal(framesIn(said).length, 1, "a picture as the last one goes nowhere");
    wc.shows = "typed";
    held.go();
    await settle();
    assert.deepEqual(framesIn(said).slice(1).map((m) => [m.seq, m.data]), [[2, b64(`typed@${CAST_QUALITY}`)]]);
    // Over a pane that draws it at half its size: its picture still, the same loop.
    const win = new f.Win();
    pages.place("t1", win, { x: 0, y: 0, width: 640, height: 400 });
    assert.deepEqual(pages.castOf("t1"), { way: "shots" });
    assert.equal(wc.debugger.of("Page.startScreencast").length, 0);
    assert.equal(held.waits.length, 1, "one loop of pictures, not two");
    // Drawn at its own size: the screencast, its picture loop let go; parked again: its picture.
    pages.place("t1", win, { x: 0, y: 0, width: 1280, height: 800 });
    assert.deepEqual(pages.castOf("t1"), { way: "screencast" });
    assert.equal(wc.debugger.of("Page.startScreencast").length, 1);
    await settle();
    const taken = wc.captures;
    held.go();
    await settle();
    assert.equal(wc.captures, taken, "the screencast's page takes no picture every CAST_SHOT_MS");
    pages.parkAll(win);
    assert.deepEqual(pages.castOf("t1"), { way: "shots" });
    assert.deepEqual(wc.debugger.of("Page.stopScreencast"), [{}]);
    await pages.handle({ op: "close", tab: "t1" });
    await settle();
    const after = wc.captures;
    held.go();
    await settle();
    assert.equal(wc.captures, after, "closed, no picture is taken");
    assert.deepEqual(pages.ids(), []);
  });

  test("a page bigger than CAST_LONG is sent shrunk, its points still its own size's; a screencast that does not start casts its picture", async () => {
    const f = fakeElectron({ startScreencast: async () => Promise.reject(new Error("no screencast here")) });
    /** @type {any[]} */
    const said = [];
    /** @type {string[]} */
    const lines = [];
    const pages = createPages({ electron: f.electron, send: (m) => said.push(m), log: (l) => lines.push(l), wait: heldWaits().wait });
    await pages.handle({ op: "open", tab: "big", width: 2560, height: 1600 });
    const win = new f.Win();
    pages.place("big", win, { x: 0, y: 0, width: 2560, height: 1600 });
    await pages.handle({ op: "cast", tab: "big", on: true });
    const wc = f.made.views[0].webContents;
    assert.deepEqual(wc.debugger.of("Page.startScreencast")[0], { format: "jpeg", quality: CAST_QUALITY, maxWidth: CAST_LONG, maxHeight: 1000, everyNthFrame: 1 });
    await settle();
    assert.deepEqual(pages.castOf("big"), { way: "shots" });
    assert.deepEqual(wc.lastPicture.resized, { width: CAST_LONG, height: 1000, quality: "good" });
    assert.ok(lines.some((l) => /screencast did not start \(no screencast here\); its picture is cast instead/.test(l)), lines.join("\n"));
    const first = framesIn(said)[0];
    assert.deepEqual([first.width, first.height], [2560, 1600], "the space its points are in: the page's own");
  });
});

/**
 * Filament's link to a stand-in app: each request answered a moment later — `cast` as `castAnswer` says, a command
 * with nothing, the frame tree as a blank page's.
 * @param {{ castAnswer?: (m: any) => { ok: boolean, result?: any, error?: string } }} [o]
 */
function fakeApp({ castAnswer = (m) => ({ ok: true, result: { casting: m.on === true, way: "screencast" } }) } = {}) {
  const host = createBrowserHost();
  /** @type {any[]} */
  const sent = [];
  /** @type {(m: any) => void} */
  let take = () => {};
  const link = {
    send: (/** @type {any} */ m) => {
      sent.push(m);
      setTimeout(() => {
        if (m.op === "cast") return take({ n: m.n, ...castAnswer(m) });
        if (m.op === "cdp" && m.method === "Page.getFrameTree") return take({ n: m.n, ok: true, result: { frameTree: { frame: { id: "F", url: "about:blank" } } } });
        take({ n: m.n, ok: true, result: m.op === "cdp" ? {} : null });
      }, 1);
    },
    close: () => {},
  };
  take = host.attach(link);
  return { host, sent, link, take: (/** @type {any} */ m) => take(m) };
}
/** The casts Filament asked of the app. @param {any[]} sent */
const castsIn = (sent) => sent.filter((m) => m.op === "cast").map((m) => ({ tab: m.tab, on: m.on }));
/** A page that watches: what it heard. */
function watcher() {
  /** @type {any[]} */
  const states = [];
  /** @type {any[]} */
  const frames = [];
  return { states, frames, state: (/** @type {any} */ s) => void states.push(s), frame: (/** @type {any} */ f) => void frames.push(f) };
}
/** A frame of the app's for a tab. @param {string} tab @param {number} seq @param {string} data */
const frameOf = (tab, seq, data) => ({ op: "frame", tab, seq, data, width: 1280, height: 800, way: "screencast" });

describe("Filament hands the cast to the pages that watch", () => {
  // (fails before: yes — the registry had no `watch`; a page with no app read a picture every 2 s)
  test("the tab the pane shows is cast while a page watches, its frames handed to each, an older one dropped; another tab shown is cast instead; the last stop ends it", async () => {
    const app = fakeApp();
    const browsers = createBrowsers({ host: app.host });
    const w1 = watcher();
    const stop1 = browsers.watch("c1", w1);
    assert.deepEqual(w1.states, [{ on: false, tab: null }], "no tab yet: nothing to cast");
    await browsers.person("c1", { act: "new" });
    const t1 = String(browsers.shownTab("c1"));
    await settle();
    assert.deepEqual(castsIn(app.sent), [{ tab: t1, on: true }]);
    assert.deepEqual(w1.states.slice(1), [{ on: false, tab: t1 }, { on: true, tab: t1 }]);
    app.take(frameOf(t1, 2, "B"));
    app.take(frameOf(t1, 1, "A"));
    app.take(frameOf("t-nobody", 9, "X"));
    assert.deepEqual(w1.frames.map((x) => x.data), ["B"], "an older frame, and one of no chat's tab, dropped");
    assert.deepEqual(w1.frames[0], { tab: t1, seq: 2, data: "B", width: 1280, height: 800, way: "screencast" });
    // A second page sees the page at once, on the one cast.
    const w2 = watcher();
    const stop2 = browsers.watch("c1", w2);
    assert.deepEqual(w2.states, [{ on: true, tab: t1 }]);
    assert.deepEqual(w2.frames.map((x) => x.data), ["B"]);
    assert.equal(castsIn(app.sent).length, 1);
    app.take(frameOf(t1, 3, "C"));
    assert.deepEqual([w1.frames.at(-1).data, w2.frames.at(-1).data], ["C", "C"]);
    // Another tab shown: the first stops, the new one is cast; a late frame of the first goes nowhere.
    await browsers.person("c1", { act: "new" });
    const t2 = String(browsers.shownTab("c1"));
    assert.notEqual(t2, t1);
    await settle();
    assert.deepEqual(castsIn(app.sent).slice(1), [{ tab: t1, on: false }, { tab: t2, on: true }]);
    app.take(frameOf(t1, 4, "D"));
    assert.equal(w1.frames.at(-1).data, "C");
    app.take(frameOf(t2, 1, "E"));
    assert.equal(w2.frames.at(-1).data, "E", "a new tab's frames from its first");
    await browsers.person("c1", { act: "select", tab: t1 });
    await settle();
    assert.deepEqual(castsIn(app.sent).slice(3), [{ tab: t2, on: false }, { tab: t1, on: true }]);
    stop1();
    assert.equal(castsIn(app.sent).length, 5, "one still watches");
    stop2();
    assert.deepEqual(castsIn(app.sent).at(-1), { tab: t1, on: false }, "the last stop ends the cast");
    stop2();
    assert.equal(castsIn(app.sent).length, 6);
  });

  test("the app's going ends the cast, said; an app older than the cast says so, and the pane reads its picture", async () => {
    const app = fakeApp();
    const browsers = createBrowsers({ host: app.host });
    await browsers.person("c1", { act: "new" });
    const w = watcher();
    browsers.watch("c1", w);
    await settle();
    assert.equal(w.states.at(-1).on, true);
    app.host.detach(app.link);
    assert.deepEqual(w.states.at(-1), { on: false, tab: null, why: NO_HOST });
    const old = fakeApp({ castAnswer: () => ({ ok: false, error: "cast is nothing the app's browser does" }) });
    const olds = createBrowsers({ host: old.host });
    await olds.person("c1", { act: "new" });
    const w2 = watcher();
    olds.watch("c1", w2);
    await settle();
    assert.deepEqual(w2.states.at(-1), { on: false, tab: olds.shownTab("c1"), why: "cast is nothing the app's browser does" });
    await olds.stateOf("c1");
    await settle();
    assert.equal(castsIn(old.sent).length, 1, "an app older than the cast is asked no more");
  });

  // (fails before: yes — a cast the app refused once stayed off until the tab shown moved)
  test("a cast the app refused another way is asked again at the pane's next read, and on once the app takes it", async () => {
    let refuse = true;
    const app = fakeApp({ castAnswer: (m) => (refuse && m.on ? { ok: false, error: "no tab t-x in the app yet" } : { ok: true, result: { casting: m.on === true, way: "screencast" } }) });
    const browsers = createBrowsers({ host: app.host });
    await browsers.person("c1", { act: "new" });
    const t1 = String(browsers.shownTab("c1"));
    const w = watcher();
    browsers.watch("c1", w);
    await settle();
    assert.deepEqual(w.states.at(-1), { on: false, tab: null, why: "no tab t-x in the app yet" });
    refuse = false;
    await browsers.stateOf("c1");
    await settle();
    assert.deepEqual(castsIn(app.sent).filter((c) => c.on), [{ tab: t1, on: true }, { tab: t1, on: true }]);
    assert.deepEqual(w.states.at(-1), { on: true, tab: t1 });
  });

  // (fails before: yes — nothing took a person's click from outside the app)
  test("the person's input: refused while the agent has the browser; theirs, it reaches the tab the pane shows as Chrome's input", async () => {
    const app = fakeApp();
    const browsers = createBrowsers({ host: app.host });
    await browsers.person("c1", { act: "new" });
    const t1 = browsers.shownTab("c1");
    const press = { kind: "mouse", type: "mousePressed", x: 200, y: 100, button: "left", buttons: 1, clickCount: 1, modifiers: 0 };
    await assert.rejects(browsers.input("c1", press), { message: NOT_TAKEN_WORDS });
    await assert.rejects(browsers.input("c9", press), { message: NOT_TAKEN_WORDS });
    await browsers.person("c1", { act: "take" });
    const cdps = () => app.sent.filter((m) => m.op === "cdp" && /^Input\./.test(m.method)).map((m) => [m.tab, m.method, m.params]);
    await browsers.input("c1", press);
    await browsers.input("c1", { kind: "key", type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 8, text: "A" });
    await browsers.input("c1", { kind: "text", text: "hello" });
    assert.deepEqual(cdps(), [
      [t1, "Input.dispatchMouseEvent", { type: "mousePressed", x: 200, y: 100, modifiers: 0, button: "left", buttons: 1, clickCount: 1 }],
      [t1, "Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 8, text: "A", unmodifiedText: "A" }],
      [t1, "Input.insertText", { text: "hello" }],
    ]);
    await assert.rejects(browsers.input("c1", { kind: "eval", expression: "1" }), /no click, key or text the browser takes/);
    await browsers.person("c1", { act: "give" });
    await assert.rejects(browsers.input("c1", press), { message: NOT_TAKEN_WORDS });
    // The press held as the browser went back is let go at the page; nothing else reaches it.
    await settle();
    assert.deepEqual(cdps().slice(3), [[t1, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 200, y: 100, modifiers: 0, button: "left", buttons: 0, clickCount: 1 }]]);
  });

  // (fails before: yes — the hunt of p4-browser: a button held as the browser went back to the agent, as the cast went
  // off, or as the page that pressed it went, stayed down at the page: its release was refused, or never came)
  test("a button the person holds is let go at the page as the hand ends — given back, the cast off or moved, the page that pressed it gone; a late release says nothing", async () => {
    const app = fakeApp();
    const browsers = createBrowsers({ host: app.host });
    await browsers.person("c1", { act: "new" });
    const t1 = browsers.shownTab("c1");
    const releases = () => app.sent.filter((m) => m.op === "cdp" && m.params?.type === "mouseReleased").map((m) => [m.tab, m.params.x, m.params.y, m.params.button, m.params.buttons]);
    const press = { kind: "mouse", type: "mousePressed", x: 200, y: 100, button: "left", buttons: 1, clickCount: 1 };
    const move = { kind: "mouse", type: "mouseMoved", x: 260, y: 140, button: "left", buttons: 1 };
    const release = { kind: "mouse", type: "mouseReleased", x: 260, y: 140, button: "left", buttons: 0, clickCount: 1 };
    const a = watcher();
    const stopA = browsers.watch("c1", a);
    await browsers.person("c1", { act: "take" });
    // Given back with the button down: let go where it last moved.
    await browsers.input("c1", press, a);
    await browsers.input("c1", move, a);
    await browsers.person("c1", { act: "give" });
    await settle();
    assert.deepEqual(releases(), [[t1, 260, 140, "left", 0]]);
    await browsers.input("c1", release, a);
    assert.equal(releases().length, 1, "the pane's release after: nothing more, nothing said");
    await assert.rejects(browsers.input("c1", press, a), { message: NOT_TAKEN_WORDS });
    // A press and its own release: nothing let go after.
    await browsers.person("c1", { act: "take" });
    await browsers.input("c1", press, a);
    await browsers.input("c1", release, a);
    assert.equal(releases().length, 2);
    // The page that pressed it gone: let go; another page's stop lets go none of its.
    const b = watcher();
    const stopB = browsers.watch("c1", b);
    const c = watcher();
    browsers.watch("c1", c);
    await browsers.input("c1", press, a);
    stopB();
    await settle();
    assert.equal(releases().length, 2, "another watcher's stop");
    stopA();
    await settle();
    assert.deepEqual(releases().at(-1), [t1, 200, 100, "left", 0], "let go while another page still watches the cast");
    // The cast moved to another tab with the button down on the first: let go there.
    await browsers.input("c1", press, c);
    await browsers.person("c1", { act: "new" });
    await settle();
    assert.notEqual(browsers.shownTab("c1"), t1);
    assert.deepEqual(releases().at(-1), [t1, 200, 100, "left", 0]);
    assert.equal(releases().length, 4);
  });

  test("an input from a page is kept to what Chrome's input may be: its kinds and types alone, its points and text inside their bounds", () => {
    assert.deepEqual(inputCommand({ kind: "mouse", type: "mouseWheel", x: 99999, y: -5, deltaX: 3, deltaY: 1e9, button: "nope", modifiers: 99, clickCount: 7 }), {
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseWheel", x: 4096, y: 0, modifiers: 15, button: "none", buttons: 0, clickCount: 3, deltaX: 3, deltaY: 10_000 },
    });
    assert.equal(inputCommand({ kind: "mouse", type: "mouseDragged", x: 1, y: 1 }), null);
    assert.equal(inputCommand({ kind: "key", type: "keyPress", key: "a" }), null);
    assert.deepEqual(inputCommand({ kind: "key", type: "keyUp", key: "a", text: "a" })?.params, { type: "keyUp", key: "a", code: "", windowsVirtualKeyCode: 0, modifiers: 0 }, "a key's release types nothing");
    assert.equal(/** @type {any} */ (inputCommand({ kind: "text", text: "x".repeat(20_000) }))?.params.text.length, 10_000);
    assert.equal(inputCommand({ kind: "text", text: "" }), null);
    assert.equal(inputCommand(null), null);
    assert.equal(inputCommand({ kind: "cdp", method: "Runtime.evaluate" }), null);
  });
});

/** A socket the run socket's upgrade writes to, its writes kept; a test says when it cannot take more. */
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    /** @type {Buffer[]} */
    this.out = [];
    this.writableNeedDrain = false;
    this.writableLength = 0;
    this.writableEnded = false;
    this.destroyed = false;
  }
  /** @param {any} b */
  write(b) {
    this.out.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
    return true;
  }
  /** @param {any} [b] */
  end(b) {
    if (b) this.write(b);
    this.writableEnded = true;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
  /** The messages written after the handshake, parsed. */
  said() {
    const dec = new WsDecoder();
    return dec.feed(Buffer.concat(this.out.slice(1))).filter((f) => f.opcode === 1).map((f) => JSON.parse(f.text));
  }
  /** A message of the page's. @param {any} m */
  ask(m) {
    this.emit("data", wsTextFrame(JSON.stringify(m)));
  }
}

/** The chats' browsers, stood in for the run socket: each watch kept, each input heard. */
function fakeCasts() {
  /** @type {{ chain: string, w: any, stopped: boolean }[]} */
  const watches = [];
  /** @type {[string, any, unknown][]} */
  const inputs = [];
  let refuse = "";
  return {
    watches,
    inputs,
    /** @param {string} why */
    refuseWith: (why) => void (refuse = why),
    /** @param {string} chain @param {any} w */
    watch(chain, w) {
      const at = { chain, w, stopped: false };
      watches.push(at);
      return () => void (at.stopped = true);
    },
    /** @param {string} chain @param {any} ev @param {unknown} [by] */
    async input(chain, ev, by) {
      if (refuse) throw new Error(refuse);
      inputs.push([chain, ev, by]);
    },
  };
}

/**
 * The run socket's upgrade on a stand-in socket. `who`: this computer, or a device by its token, as a proxy here hands
 * on its request.
 * @param {any} browsers @param {{ device?: string }} [o]
 */
function upgraded(browsers, { device = "" } = {}) {
  const devices = {
    /** @param {string} token */
    verify: (token) => (token === "tok-view" ? { id: "dv", scope: "view" } : token === "tok-full" ? { id: "df", scope: "full" } : null),
    onRevoke: () => () => {},
  };
  const config = { get: () => ({ server: { host: "127.0.0.1", maxBodyBytes: 1 << 20, loopbackTrust: "legacy" } }) };
  const headers = { host: "127.0.0.1:20300", connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...(device ? { "x-forwarded-for": "100.64.0.7", cookie: `filament_device=${device}` } : {}) };
  const req = /** @type {any} */ ({ url: "/api/runs/socket", headers, socket: { remoteAddress: "127.0.0.1" } });
  const sock = new FakeSocket();
  const took = runSocketUpgrade({ config, runs: /** @type {any} */ ({}), browsers, devices: /** @type {any} */ (devices) })(req, /** @type {any} */ (sock), Buffer.alloc(0));
  assert.equal(took, true);
  assert.match(String(sock.out[0]), /^HTTP\/1\.1 101/);
  return sock;
}

describe("the run socket carries the cast", () => {
  // (fails before: yes — the socket knew no `cast`: it said nothing)
  test("a cast's state and frames, keyed by it; a frame the socket cannot take yet waits as the newest alone; a stop and the socket's close end the watch", async () => {
    const casts = fakeCasts();
    const sock = upgraded(casts);
    try {
      sock.ask({ op: "cast", key: "c", chain: "c1" });
      assert.equal(casts.watches.length, 1);
      const { w } = casts.watches[0];
      assert.equal(casts.watches[0].chain, "c1");
      w.state({ on: true, tab: "t1" });
      const f = (/** @type {number} */ seq) => ({ tab: "t1", seq, data: `F${seq}`, width: 1280, height: 800, way: "screencast" });
      w.frame(f(1));
      assert.deepEqual(sock.said(), [{ key: "c", cast: { on: true, tab: "t1" } }, { key: "c", frame: f(1) }]);
      // The network is slow: frames 2 and 3 never go, 4 goes once it drains.
      sock.writableNeedDrain = true;
      w.frame(f(2));
      w.frame(f(3));
      w.frame(f(4));
      assert.equal(sock.said().length, 2);
      sock.writableNeedDrain = false;
      sock.emit("drain");
      await settle();
      assert.deepEqual(sock.said().slice(2), [{ key: "c", frame: f(4) }]);
      sock.ask({ op: "stop", key: "c" });
      assert.equal(casts.watches[0].stopped, true);
      w.frame(f(5));
      assert.equal(sock.said().length, 3, "nothing after its stop");
      sock.ask({ op: "cast", key: "d", chain: "c2" });
      sock.destroy();
      assert.equal(casts.watches[1].stopped, true, "the socket's close ends its casts");
    } finally {
      sock.destroy();
    }
  });

  test("the person's input goes to the chat's browser — a refusal said back —, a view-only device's never; a Filament with no browser says it casts none", async () => {
    const casts = fakeCasts();
    const here = upgraded(casts);
    const full = upgraded(casts, { device: "tok-full" });
    const view = upgraded(casts, { device: "tok-view" });
    try {
      const click = { kind: "mouse", type: "mousePressed", x: 10, y: 20, button: "left", clickCount: 1 };
      here.ask({ op: "input", key: "c", input: click });
      assert.equal(casts.inputs.length, 0, "an input of no cast's goes nowhere");
      for (const s of [here, full, view]) s.ask({ op: "cast", key: "c", chain: "c1" });
      here.ask({ op: "input", key: "c", input: click });
      full.ask({ op: "input", key: "c", input: click });
      view.ask({ op: "input", key: "c", input: click });
      await settle();
      assert.deepEqual(casts.inputs.map(([chain, ev]) => [chain, ev.type, ev.x]), [["c1", "mousePressed", 10], ["c1", "mousePressed", 10]]);
      // (fails before: yes — the hunt of p4-browser) Each sent as its cast's own watcher, which a button it holds goes with.
      assert.deepEqual(casts.inputs.map(([, , by]) => by), [casts.watches[0].w, casts.watches[1].w]);
      casts.refuseWith(NOT_TAKEN_WORDS);
      here.ask({ op: "input", key: "c", input: click });
      await settle();
      assert.deepEqual(here.said(), [{ key: "c", refused: NOT_TAKEN_WORDS }]);
    } finally {
      for (const s of [here, full, view]) s.destroy();
    }
    const none = upgraded(null);
    try {
      none.ask({ op: "cast", key: "c", chain: "c1" });
      assert.deepEqual(none.said(), [{ key: "c", cast: { on: false, tab: null, why: "this Filament casts no browser" } }]);
    } finally {
      none.destroy();
    }
  });

  // (fails before: yes — a view-only device watched the chat's browser live, which its routes refuse it)
  test("a view-only device sees none of the chat's browser: its cast is off and why, nothing watched, its input refused", async () => {
    const casts = fakeCasts();
    const view = upgraded(casts, { device: "tok-view" });
    try {
      view.ask({ op: "cast", key: "c", chain: "c1" });
      view.ask({ op: "input", key: "c", input: { kind: "mouse", type: "mousePressed", x: 1, y: 1 } });
      await settle();
      assert.equal(casts.watches.length, 0, "no watch of the chat's browser");
      assert.equal(casts.inputs.length, 0);
      assert.deepEqual(view.said(), [{ key: "c", cast: { on: false, tab: null, why: VIEW_CAST_WORDS } }, { key: "c", refused: VIEW_INPUT_WORDS }]);
    } finally {
      view.destroy();
    }
  });

  // (fails before: yes — a cast asked of a socket shut began a watch nothing would stop, and a frame held of the tab
  // before went out after the tab changed)
  test("a socket shut begins no watch; a frame held while the socket was slow goes nowhere once its tab is no longer the cast's", async () => {
    const casts = fakeCasts();
    const sock = upgraded(casts);
    try {
      sock.ask({ op: "cast", key: "c", chain: "c1" });
      const { w } = casts.watches[0];
      w.state({ on: true, tab: "t1" });
      sock.writableNeedDrain = true;
      w.frame({ tab: "t1", seq: 2, data: "F2", width: 1280, height: 800, way: "shots" });
      w.state({ on: true, tab: "t2" });
      sock.writableNeedDrain = false;
      sock.emit("drain");
      await settle();
      assert.deepEqual(sock.said(), [{ key: "c", cast: { on: true, tab: "t1" } }, { key: "c", cast: { on: true, tab: "t2" } }], "t1's frame held goes nowhere");
      sock.destroy();
      assert.equal(casts.watches[0].stopped, true);
      sock.ask({ op: "cast", key: "d", chain: "c2" });
      assert.equal(casts.watches.length, 1, "a socket shut takes no new watch");
    } finally {
      sock.destroy();
    }
  });
});

/** A WebSocket stood in for the page's run socket: what the page sends kept, the server's words handed in. */
class FakeWs {
  constructor() {
    this.readyState = 0;
    /** @type {string[]} */
    this.sent = [];
    /** @type {((e?: any) => void) | null} */ this.onopen = null;
    /** @type {((e: { data: string }) => void) | null} */ this.onmessage = null;
    /** @type {((e?: any) => void) | null} */ this.onclose = null;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  /** @param {string} text */
  send(text) {
    this.sent.push(text);
  }
  /** @param {any} m */
  hear(m) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("the page's run socket carries its casts", () => {
  test("a cast asked beside a run's follow, on one socket: its state, frames and refusals routed by key; input sent keyed while open; its stop, and the socket's end", () => {
    /** @type {FakeWs[]} */
    const made = [];
    const rs = createRunSocket({ open: () => /** @type {any} */ (made[made.length] = new FakeWs()) });
    /** @type {any[]} */
    const heard = [];
    const unfollow = rs.tap("r1", { since: 0 }, { frame: (j) => heard.push(["run", j]), missing: () => {}, end: () => {}, drop: () => heard.push(["run-drop"]) });
    const c = rs.cast("c1", { state: (s) => heard.push(["state", s]), frame: (f) => heard.push(["frame", f.seq]), refused: (w) => heard.push(["refused", w]), drop: () => heard.push(["drop"]) });
    assert.equal(made.length, 1, "one socket");
    c.input({ kind: "mouse", type: "mouseMoved", x: 1, y: 1 });
    const ws = made[0];
    assert.deepEqual(ws.sent, [], "nothing before it opens: a click late is no click");
    ws.open();
    assert.deepEqual(ws.sent.map((t) => JSON.parse(t)), [
      { op: "follow", key: "1", run: "r1", since: 0, words: false },
      { op: "cast", key: "2", chain: "c1" },
    ]);
    ws.hear({ key: "2", cast: { on: true, tab: "t1" } });
    ws.hear({ key: "2", frame: { tab: "t1", seq: 3, data: "x", width: 1, height: 1 } });
    ws.hear({ key: "2", refused: NOT_TAKEN_WORDS });
    ws.hear({ key: "1", data: { type: "hello" } });
    assert.deepEqual(heard, [["state", { on: true, tab: "t1" }], ["frame", 3], ["refused", NOT_TAKEN_WORDS], ["run", { type: "hello" }]]);
    // (fails before: yes — the review of its first cut: a key's own `key`, the key pressed, was spread over the follow's)
    c.input({ kind: "key", type: "keyUp", key: "a", op: "follow" });
    assert.deepEqual(JSON.parse(ws.sent.at(-1) || ""), { op: "input", key: "2", input: { kind: "key", type: "keyUp", key: "a", op: "follow" } }, "keyed as the cast, its own fields apart");
    c.stop();
    assert.deepEqual(JSON.parse(ws.sent.at(-1) || ""), { op: "stop", key: "2" });
    c.input({ kind: "text", text: "late" });
    assert.equal(JSON.parse(ws.sent.at(-1) || "").op, "stop", "a stopped cast sends nothing");
    const again = rs.cast("c1", { state: () => {}, frame: () => {}, refused: () => {}, drop: () => heard.push(["drop2"]) });
    ws.close();
    assert.deepEqual(heard.slice(-2), [["run-drop"], ["drop2"]], "the socket's end drops its follows and its casts");
    again.stop();
    unfollow();
  });
});

/** The admin API's stand-in for the pane: each call kept, a GET the state, a take or give moving it. @param {any} start */
function fakeApi(start) {
  /** @type {[string, any][]} */
  const calls = [];
  let st = start;
  return {
    calls,
    api: async (/** @type {string} */ path, /** @type {any} */ init) => {
      calls.push([path, init?.body ?? null]);
      if (init?.method === "POST") {
        if (init.body.act === "take") st = { ...st, taken: true, hand: false };
        if (init.body.act === "give") st = { ...st, taken: false };
        return { ok: true, state: st };
      }
      return st;
    },
  };
}
/** The pane's cast, stood in: its ears, the input it sent, whether it stopped. @param {(tap: any) => void} [atStart] */
function fakeCast(atStart = () => {}) {
  /** @type {{ chain: string, tap: any, stopped: boolean } | null} */
  let at = null;
  /** @type {any[]} */
  const inputs = [];
  return {
    inputs,
    get at() {
      return at;
    },
    cast: (/** @type {string} */ chain, /** @type {any} */ tap) => {
      const mine = { chain, tap, stopped: false };
      at = mine;
      atStart(tap);
      return { stop: () => void (mine.stopped = true), input: (/** @type {any} */ ev) => void inputs.push(ev) };
    },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
/** @param {any} root @param {string} sel */
const one = (root, sel) => root.querySelector(sel);
const tabbed = { available: true, tabs: [{ id: "t1", url: "https://shop.test/", title: "Shop", shown: true, size: { width: 1280, height: 800 } }], active: "t1", taken: false, sites: [], busy: null, lastUrl: "" };

describe("the pane with no app of its own", () => {
  test("a point on the picture is the page's own: drawn whole and centred in its box, the edge's nearest outside it", () => {
    const page = { width: 1280, height: 800 };
    assert.deepEqual(pagePoint({ x: 100, y: 50 }, { x: 0, y: 0, width: 640, height: 400 }, page), { x: 200, y: 100, inside: true });
    // Its box taller than the page: the page drawn 640 × 400 with 100 above and below.
    assert.deepEqual(pagePoint({ x: 100, y: 150 }, { x: 0, y: 0, width: 640, height: 600 }, page), { x: 200, y: 100, inside: true });
    assert.deepEqual(pagePoint({ x: 100, y: 20 }, { x: 0, y: 0, width: 640, height: 600 }, page), { x: 200, y: 0, inside: false });
    assert.deepEqual(pagePoint({ x: 700, y: 30 }, { x: 300, y: 20, width: 640, height: 400 }, page), { x: 800, y: 20, inside: true });
    assert.equal(pagePoint({ x: 1, y: 1 }, { x: 0, y: 0, width: 0, height: 0 }, page), null);
    assert.equal(lineOf({ available: true, tabs: [{}] }, { inApp: false, live: true }), "The page, live. Take over to use it yourself.");
    assert.equal(lineOf({ available: true, taken: true, tabs: [{}] }, { inApp: false, live: true }), "You have the browser: click and type on the page. The agent waits until you give it back.");
  });

  // (fails before: yes — outside the app the page was a picture read every 2 s, whatever else there was)
  test("the page live from the cast: frames drawn, an older one dropped, no picture read while it is on; off, the 2 s picture again; the pane's end stops it", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      const f = fakeApi(tabbed);
      // On at once, as a cast already under way answers.
      const c = fakeCast((tap) => tap.state({ on: true, tab: "t1" }));
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: f.api, bridge: null, cast: c.cast, doc: /** @type {any} */ (document) });
      await flush();
      assert.equal(c.at?.chain, "c1");
      const pic = one(body, ".brw-picture");
      assert.equal(pic.src, undefined, "no picture read while the cast is on");
      c.at?.tap.frame({ tab: "t1", seq: 2, data: "QkI=", width: 1280, height: 800 });
      assert.equal(pic.src, "data:image/jpeg;base64,QkI=");
      assert.equal(pic.classList.contains("hidden"), false);
      c.at?.tap.frame({ tab: "t1", seq: 1, data: "QUE=", width: 1280, height: 800 });
      assert.equal(pic.src, "data:image/jpeg;base64,QkI=", "an older frame is dropped");
      c.at?.tap.frame({ tab: "t2", seq: 1, data: "Q0M=", width: 390, height: 844 });
      assert.equal(pic.src, "data:image/jpeg;base64,Q0M=", "another tab's from its first");
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(one(body, ".brw-line").textContent, "The page, live. Take over to use it yourself.");
      assert.equal(pic.src, "data:image/jpeg;base64,Q0M=");
      // Off: an app that casts nothing — the picture, read every 2 s, is the last resort.
      c.at?.tap.state({ on: false, tab: "t1", why: "cast is nothing the app's browser does" });
      assert.match(String(pic.src), /^\/api\/sessions\/c1\/browser\/shot\?at=\d+$/);
      assert.match(one(body, ".brw-line").textContent, /^A picture of the page, read every 2 s/);
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(c.at?.stopped, true);
    } finally {
      restore();
    }
  });

  test("a cast whose socket goes: the picture stands in, and the next read watches again", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      let asked = 0;
      const c = fakeCast((tap) => {
        asked++;
        tap.state({ on: true, tab: "t1" });
      });
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: fakeApi(tabbed).api, bridge: null, cast: c.cast, doc: /** @type {any} */ (document) });
      await flush();
      c.at?.tap.drop();
      assert.match(String(one(body, ".brw-picture").src), /\/shot\?at=/);
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(asked, 2);
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
    } finally {
      restore();
    }
  });

  // (fails before: yes — a page outside the app could take the browser over and do nothing with it)
  test("taken over, the person's press, release, moves, wheel, keys and paste on the picture reach the page at its own points; not taken, nothing does; a refusal is said once a while", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      const f = fakeApi(tabbed);
      const c = fakeCast((tap) => tap.state({ on: true, tab: "t1" }));
      /** @type {string[]} */
      const toasts = [];
      let now = 10_000;
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: f.api, bridge: null, cast: c.cast, doc: /** @type {any} */ (document), onToast: (m) => void toasts.push(m), now: () => now });
      await flush();
      const stage = one(body, ".brw-stage");
      const pic = one(body, ".brw-picture");
      pic.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 600, right: 640, bottom: 600 });
      c.at?.tap.frame({ tab: "t1", seq: 1, data: "QQ==", width: 1280, height: 800 });
      const at = { clientX: 100, clientY: 150, button: 0, buttons: 1, detail: 1 };
      stage.dispatch("pointerdown", at);
      assert.equal(c.inputs.length, 0, "the agent's: watched, not used");
      one(body, ".brw-take").dispatch("click");
      await flush();
      assert.equal(one(body, ".brw-line").textContent, "You have the browser: click and type on the page. The agent waits until you give it back.");
      stage.dispatch("pointerdown", at);
      stage.dispatch("pointerdown", { ...at, clientY: 20 });
      stage.dispatch("pointerup", { ...at, buttons: 0 });
      stage.dispatch("wheel", { clientX: 100, clientY: 150, deltaX: 0, deltaY: 120 });
      stage.dispatch("keydown", { key: "a", code: "KeyA", keyCode: 65 });
      stage.dispatch("keydown", { key: "Backspace", code: "Backspace", keyCode: 8 });
      stage.dispatch("keydown", { key: "v", code: "KeyV", keyCode: 86, ctrlKey: true });
      stage.dispatch("keyup", { key: "a", code: "KeyA", keyCode: 65, shiftKey: true });
      stage.dispatch("paste", { clipboardData: { getData: () => "pasted words" } });
      assert.deepEqual(
        c.inputs,
        [
          { kind: "mouse", type: "mousePressed", x: 200, y: 100, button: "left", buttons: 1, clickCount: 1, modifiers: 0 },
          { kind: "mouse", type: "mouseReleased", x: 200, y: 100, button: "left", buttons: 0, clickCount: 1, modifiers: 0 },
          { kind: "mouse", type: "mouseWheel", x: 200, y: 100, deltaX: 0, deltaY: 120, modifiers: 0 },
          { kind: "key", type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 0, text: "a" },
          { kind: "key", type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, modifiers: 0 },
          { kind: "key", type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 8 },
          { kind: "text", text: "pasted words" },
        ],
        "a press off the page, and Ctrl+V's keys (its paste comes as the paste), go nowhere",
      );
      // Moves: the first at once, then the newest of those within MOVE_MS.
      c.inputs.length = 0;
      stage.dispatch("pointermove", { clientX: 10, clientY: 110, buttons: 0 });
      stage.dispatch("pointermove", { clientX: 20, clientY: 110, buttons: 0 });
      stage.dispatch("pointermove", { clientX: 30, clientY: 110, buttons: 1 });
      assert.deepEqual(c.inputs.map((e) => [e.type, e.x, e.button]), [["mouseMoved", 20, "none"]]);
      await new Promise((r) => setTimeout(r, 80));
      assert.deepEqual(c.inputs.map((e) => [e.type, e.x, e.button]), [["mouseMoved", 20, "none"], ["mouseMoved", 60, "left"]]);
      c.at?.tap.refused("The browser is the agent's.");
      c.at?.tap.refused("The browser is the agent's.");
      now += 6000;
      c.at?.tap.refused("Again.");
      assert.deepEqual(toasts, ["The browser: The browser is the agent's.", "The browser: Again."]);
      // Given back: nothing more goes.
      one(body, ".brw-take").dispatch("click");
      await flush();
      c.inputs.length = 0;
      stage.dispatch("pointerdown", at);
      stage.dispatch("keydown", { key: "a", code: "KeyA", keyCode: 65 });
      assert.deepEqual(c.inputs, []);
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
    } finally {
      restore();
    }
  });

  // (fails before: yes — a double click went as two single ones (a pointer's `detail` is 0), a swipe cut off held the
  // button down, a wheel in lines scrolled a pixel a line, and a press on the picture of the tab before went to the next)
  test("taken over: a double and a triple click counted by the pane, a pointer cancelled lets the button go, a wheel in lines or pages in pixels, a press on another tab's picture nowhere", async () => {
    const { document, restore } = stubDocument();
    try {
      const body = document.createElement("div");
      document.body.append(body);
      const c = fakeCast((tap) => tap.state({ on: true, tab: "t1" }));
      let now = 10_000;
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: fakeApi({ ...tabbed, taken: true }).api, bridge: null, cast: c.cast, doc: /** @type {any} */ (document), now: () => now });
      await flush();
      const stage = one(body, ".brw-stage");
      const pic = one(body, ".brw-picture");
      pic.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 400, right: 640, bottom: 400 });
      // A frame of a tab the cast is not on (the tab before, late): the picture shows it, and nothing goes to it.
      c.at?.tap.frame({ tab: "t0", seq: 1, data: "QQ==", width: 1280, height: 800 });
      stage.dispatch("pointerdown", { clientX: 100, clientY: 50, button: 0, buttons: 1 });
      assert.equal(c.inputs.length, 0, "a press on another tab's picture goes nowhere");
      assert.equal(stage.classList.contains("brw-yours"), false);
      c.at?.tap.frame({ tab: "t1", seq: 1, data: "QQ==", width: 1280, height: 800 });
      assert.equal(stage.classList.contains("brw-yours"), true, "the page the person's: touches are its own");
      const click = (/** @type {any} */ o = {}) => {
        stage.dispatch("pointerdown", { clientX: 100, clientY: 50, button: 0, buttons: 1, detail: 0, ...o });
        stage.dispatch("pointerup", { clientX: 100, clientY: 50, button: 0, buttons: 0, detail: 0, ...o });
      };
      const counts = () => c.inputs.filter((e) => e.type === "mousePressed").map((e) => e.clickCount);
      click();
      now += 200;
      click({ clientX: 102 });
      now += 200;
      click();
      now += 200;
      click();
      assert.deepEqual(counts(), [1, 2, 3, 3], "within CLICK_MS and CLICK_PX: two, three, and three at the most");
      assert.deepEqual(c.inputs.filter((e) => e.type === "mouseReleased").map((e) => e.clickCount), [1, 2, 3, 3], "a release says its press's count");
      c.inputs.length = 0;
      now += 200;
      click({ clientX: 120 });
      now += 200;
      click({ clientX: 120, button: 2 });
      now += 600;
      click({ clientX: 120, button: 2 });
      assert.deepEqual(counts(), [1, 1, 1], "farther, another button, or later: one");
      // A pointer cancelled mid-drag: the button goes up where it last was on the page.
      c.inputs.length = 0;
      now += 1000;
      stage.dispatch("pointerdown", { clientX: 100, clientY: 50, button: 0, buttons: 1 });
      stage.dispatch("pointermove", { clientX: 150, clientY: 60, button: 0, buttons: 1 });
      stage.dispatch("pointercancel", { clientX: 0, clientY: 0, button: 0, buttons: 0 });
      stage.dispatch("pointercancel", { clientX: 0, clientY: 0, button: 0, buttons: 0 });
      assert.deepEqual(
        c.inputs.filter((e) => e.type !== "mouseMoved").map((e) => [e.type, e.x, e.y, e.button]),
        [["mousePressed", 200, 100, "left"], ["mouseReleased", 300, 120, "left"]],
        "released once, at the move's point",
      );
      // Wheels: pixels as they are, lines as LINE_PX each, pages as the page's height.
      c.inputs.length = 0;
      stage.dispatch("wheel", { clientX: 100, clientY: 50, deltaX: 0, deltaY: 120, deltaMode: 0 });
      stage.dispatch("wheel", { clientX: 100, clientY: 50, deltaX: 1, deltaY: 3, deltaMode: 1 });
      stage.dispatch("wheel", { clientX: 100, clientY: 50, deltaX: 0, deltaY: -1, deltaMode: 2 });
      assert.deepEqual(c.inputs.map((e) => [e.deltaX, e.deltaY]), [[0, 120], [LINE_PX, 3 * LINE_PX], [0, -800]]);
      body.remove();
      refreshBrowser(/** @type {any} */ (body));
    } finally {
      restore();
    }
  });

  // (fails before: yes — a pane under a full-frame screen or in a tab behind kept the cast streaming, and a view-only
  // device's pane asked every 1.5 s for what the server refuses it)
  test("the cast is watched while the stage is before the person alone; a view-only device's pane says so and asks nothing", async () => {
    const { document, restore } = stubDocument();
    /** @type {Map<string, () => void>} */
    const heard = new Map();
    // The document as the pane hears it: whether the tab is shown, and its visibilitychange.
    const doc = Object.create(document);
    doc.visibilityState = "visible";
    doc.addEventListener = (/** @type {string} */ type, /** @type {() => void} */ fn) => void heard.set(type, fn);
    doc.removeEventListener = (/** @type {string} */ type) => void heard.delete(type);
    try {
      const body = document.createElement("div");
      const frame = document.createElement("div");
      frame.append(body);
      document.body.append(frame);
      const f = fakeApi(tabbed);
      let watches = 0;
      const c = fakeCast((tap) => {
        watches++;
        tap.state({ on: true, tab: "t1" });
      });
      renderBrowser(/** @type {any} */ (body), { chat: { chainId: "c1" }, api: f.api, bridge: null, cast: c.cast, doc });
      await flush();
      assert.equal(watches, 1);
      const pic = one(body, ".brw-picture");
      // A full-frame screen over the panes leaves them inert: the cast stops, and no picture is read in its place.
      frame.setAttribute("inert", "");
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(c.at?.stopped, true, "the stage not before the person: the cast stopped");
      assert.equal(pic.src, undefined, "and no picture read meanwhile");
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(watches, 1);
      frame.removeAttribute("inert");
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(watches, 2, "back before the person: watched again");
      // The tab put behind: stopped at once; brought back: watched at once.
      doc.visibilityState = "hidden";
      heard.get("visibilitychange")?.();
      assert.equal(c.at?.stopped, true);
      doc.visibilityState = "visible";
      heard.get("visibilitychange")?.();
      await flush();
      assert.equal(watches, 3);
      // The page turns view-only: the cast stops, the pane says why, and nothing more is asked.
      setBrowserViewOnly(true);
      assert.equal(c.at?.stopped, true);
      assert.equal(one(body, ".brw-pane").classList.contains("hidden"), true);
      assert.equal(one(body, ".brw-view-only").classList.contains("hidden"), false);
      assert.equal(one(body, ".brw-view-only").textContent, VIEW_ONLY_BROWSER_WORDS);
      const asked = f.calls.length;
      refreshBrowser(/** @type {any} */ (body));
      await flush();
      assert.equal(f.calls.length, asked, "no read of the chat's browser");
      assert.equal(watches, 3, "no cast");
      // A pane drawn on a view-only page asks nothing from the first.
      const body2 = document.createElement("div");
      document.body.append(body2);
      const f2 = fakeApi(tabbed);
      const c2 = fakeCast();
      renderBrowser(/** @type {any} */ (body2), { chat: { chainId: "c1" }, api: f2.api, bridge: null, cast: c2.cast, doc });
      await flush();
      assert.deepEqual([f2.calls.length, c2.at], [0, null]);
      assert.equal(one(body2, ".brw-view-only").classList.contains("hidden"), false);
      // No longer view-only: each reads again.
      setBrowserViewOnly(false);
      await flush();
      assert.equal(watches, 4);
      assert.equal(f2.calls.length, 1);
      assert.equal(one(body, ".brw-pane").classList.contains("hidden"), false);
      body.remove();
      body2.remove();
      refreshBrowser(/** @type {any} */ (body));
      refreshBrowser(/** @type {any} */ (body2));
      await flush();
      assert.equal(heard.size, 0, "its listener goes with the pane");
    } finally {
      setBrowserViewOnly(false);
      restore();
    }
  });
});

describe("end to end", () => {
  // (fails before: yes — every part of it)
  test("a page with no app sees the agent's page live on the run socket — the app's pane drawing it at half its size, by its picture as it changes —; taken over, its click lands on the page at its own point; its stop ends the cast", async () => {
    const f = fakeElectron();
    const host = createBrowserHost();
    /** @type {(m: any) => void} */
    let take = () => {};
    // The app's pages, linked to Filament as main.js links them.
    const pages = createPages({ electron: f.electron, send: (m) => take(m) });
    const link = {
      send: (/** @type {any} */ m) =>
        void pages.handle(m).then(
          (result) => take({ n: m.n, ok: true, result: result ?? null }),
          (/** @type {any} */ e) => take({ n: m.n, ok: false, error: String(e?.message || e) }),
        ),
      close: () => {},
    };
    take = host.attach(link);
    const browsers = createBrowsers({ host });
    await browsers.person("c1", { act: "new" });
    const tab = String(browsers.shownTab("c1"));
    // Shown over this computer's pane at half its size, too.
    pages.place(tab, new f.Win(), { x: 0, y: 0, width: 640, height: 400 });
    const wc = f.made.views[0].webContents;
    const dbg = wc.debugger;
    const config = { get: () => ({ server: { host: "127.0.0.1", maxBodyBytes: 1 << 20, loopbackTrust: "legacy" } }) };
    const upgrade = runSocketUpgrade({ config, runs: /** @type {any} */ ({}), browsers });
    const server = http.createServer((_q, r) => void r.writeHead(404).end());
    server.on("upgrade", (req, socket, head) => void (upgrade(req, socket, head) || socket.destroy()));
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    const url = `ws://127.0.0.1:${/** @type {any} */ (server.address()).port}/api/runs/socket`;
    const rs = createRunSocket({ open: () => new WebSocket(url) });
    /** @type {any[]} */
    const states = [];
    /** @type {any[]} */
    const frames = [];
    /** @type {string[]} */
    const refused = [];
    const watching = rs.cast("c1", { state: (s) => void states.push(s), frame: (x) => void frames.push(x), refused: (w) => void refused.push(w), drop: () => {} });
    try {
      await until(() => states.some((s) => s.on), "the cast on");
      assert.deepEqual(pages.castOf(tab), { way: "shots" });
      await until(() => frames.length >= 1, "the page as it is");
      assert.deepEqual(frames[0], { tab, seq: 1, data: Buffer.from(`capture@${CAST_QUALITY}`).toString("base64"), width: 1280, height: 800, way: "shots" });
      wc.shows = "typed";
      await until(() => frames.length >= 2, "the page as it changed");
      assert.deepEqual(frames.at(-1), { tab, seq: 2, data: Buffer.from(`typed@${CAST_QUALITY}`).toString("base64"), width: 1280, height: 800, way: "shots" });
      const click = { kind: "mouse", type: "mousePressed", x: 200, y: 100, button: "left", buttons: 1, clickCount: 1, modifiers: 0 };
      watching.input(click);
      await until(() => refused.length, "the refusal");
      assert.deepEqual(refused, [NOT_TAKEN_WORDS]);
      await browsers.person("c1", { act: "take" });
      watching.input(click);
      await until(() => dbg.of("Input.dispatchMouseEvent").length, "the click on the page");
      // The page drawn at half its size here: the app's view takes the point times its scale.
      assert.deepEqual(dbg.of("Input.dispatchMouseEvent"), [{ type: "mousePressed", x: 100, y: 50, modifiers: 0, button: "left", buttons: 1, clickCount: 1 }]);
      watching.stop();
      await until(() => pages.castOf(tab) === null, "the cast's stop");
      const taken = wc.captures;
      await new Promise((r) => setTimeout(r, CAST_SHOT_MS * 2));
      assert.equal(wc.captures, taken, "no picture taken once it stopped");
    } finally {
      watching.stop();
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r(undefined)));
      pages.destroy();
    }
  });
});
