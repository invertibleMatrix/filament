// @ts-check
// Another machine's chats' browser in this app (b-remote): with "Let <machine> use this app's browser" on, Electron
// main holds a link to that machine's browser host — over a way where it answers, its certificate pinned on the
// network, with the window's sign-in there — and that machine's agent drives the pages this app holds for it. Off, or
// the machine disconnected or gone, no link; refused (401, 403), it stops and its row says so; dropped, it is made
// again a little later each time, and its pages close with it. A machine's pages are drawn over its own view's Browser
// pane alone, while that view shows.
// (fails before: yes — the app held this computer's browser alone)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MACHINE_RETRY_MS, createMachineBrowsers, placeOnMachine } from "../desktop/lib/machine-browser.js";

const PRINT = `${"AB:".repeat(31)}CD`;
const LAN = { kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT };
const TAIL = { kind: "url", url: "https://box.tail1234.ts.net" };
/** @param {Record<string, any>} [o] @returns {any} */
const box = (o = {}) => ({ id: "m-box", name: "Workstation", routes: [LAN, TAIL], partition: "persist:machine-m-box", addedAt: 1, ...o });
/** @param {Record<string, any>} [o] @returns {any} */
const mac = (o = {}) => ({ id: "m-mac", name: "Mac mini", routes: [{ kind: "ssh", url: "ssh://mac/20300" }], partition: "persist:machine-m-mac", addedAt: 2, ...o });

/** @param {{ list?: any[], cookie?: string, route?: (m: any) => any }} [o] */
function rig({ list = [box(), mac()], cookie = "__Host-filament_device=fdt_box", route = (m) => m.routes[0] } = {}) {
  let kept = list;
  /** @type {any[]} */
  const rows = [];
  /** @type {any[]} */
  const dials = [];
  /** @type {any[]} */
  const made = [];
  /** @type {[Function, number][]} */
  const waits = [];
  /** @type {any[]} */
  const cookies = [];
  /** @type {string[]} */
  const lines = [];
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((res) => setImmediate(res));
  };
  const mb = createMachineBrowsers({
    machines: () => kept,
    cookieOf: async (partition, origin) => (cookies.push([partition, origin]), cookie),
    keep: (id, on) => {
      const had = kept.find((m) => m.id === id);
      if (!had) return null;
      const { browser: _b, ...rest } = had;
      const got = on ? { ...rest, browser: true } : rest;
      kept = kept.map((m) => (m === had ? got : m));
      return got;
    },
    pagesFor: (m, send) => {
      const p = {
        machine: m,
        send,
        /** @type {any[]} */ handled: [],
        closed: 0,
        destroyed: 0,
        /** @param {any} msg */
        async handle(msg) {
          p.handled.push(msg);
          if (msg.op === "fail") throw new Error("the app has no tab t9 now");
          return msg.op === "open" ? null : { done: msg.op };
        },
        closeAll: () => void p.closed++,
        destroy: () => void p.destroyed++,
        /** Where its profile's localhost goes (b-tunnel). @type {any[]} */ proxied: [],
        /** @param {any} conf */
        proxy: async (conf) => void p.proxied.push(conf),
      };
      made.push(p);
      return /** @type {any} */ (p);
    },
    // The proxy its pages' localhost goes to over the link (b-tunnel), a stand-in.
    proxyFor: /** @type {any} */ ((/** @type {any} */ m, /** @type {any} */ send) => {
      const x = { machine: m, send, stopped: /** @type {string[]} */ ([]), auth: { user: "filament", password: "pw" }, start: async () => 40001, take: () => {}, stop: (/** @type {string} */ why) => void x.stopped.push(why) };
      return x;
    }),
    pick: /** @type {any} */ (async (/** @type {any} */ m) => ({ route: route(m), name: null, version: null, tried: [{ url: "x", why: "nothing listens" }] })),
    dial: /** @type {any} */ ((/** @type {any} */ o) => {
      const d = { ...o, /** @type {string[]} */ sent: [], closed: 0 };
      dials.push(d);
      return { send: (/** @type {string} */ t) => void d.sent.push(JSON.parse(t)), close: () => void d.closed++ };
    }),
    log: (line) => void lines.push(line),
    wait: /** @type {any} */ ((/** @type {Function} */ fn, /** @type {number} */ ms) => (waits.push([fn, ms]), waits.length)),
    clear: () => {},
    changed: (row) => void rows.push(row),
  });
  return { rows, mb, dials, made, waits, cookies, lines, settle, setList: (/** @type {any[]} */ l) => void (kept = l), list: () => kept };
}

describe("a machine's link for this app's browser", () => {
  test("off: no link; on: one to its browser host over the way it answers, its certificate pinned, the window's sign-in there; its agent's words reach its pages and their answers go back; off again: closed, its pages gone", async () => {
    const t = rig();
    t.mb.sync();
    await t.settle();
    assert.equal(t.dials.length, 0, "off at first: nothing dialled");
    assert.equal(t.made.length, 0, "no pages made");
    assert.deepEqual(t.mb.rowOf("m-box"), { id: "m-box", browser: false, browserLink: "off", browserWords: null });
    const row = t.mb.set("m-box", true);
    assert.equal(row.said, "The agent's pages for your chats on Workstation open in this app");
    assert.equal(row.browserLink, "connecting");
    await t.settle();
    assert.equal(t.list()[0].browser, true, "kept");
    assert.equal(t.made.length, 1);
    assert.equal(t.made[0].machine.id, "m-box", "its pages are that machine's");
    assert.deepEqual(t.cookies, [["persist:machine-m-box", "https://192.168.0.9:20343"]], "the sign-in its partition holds for that origin");
    assert.equal(t.dials.length, 1);
    const d = t.dials[0];
    assert.equal(d.url, "wss://192.168.0.9:20343/api/browser/host");
    assert.deepEqual(d.headers, { cookie: "__Host-filament_device=fdt_box" });
    assert.equal(d.pin, PRINT, "the network's certificate, pinned");
    assert.deepEqual(t.mb.rowOf("m-box"), { id: "m-box", browser: true, browserLink: "connecting", browserWords: "Connecting to Workstation…" });
    // Nothing goes back before it opens.
    t.made[0].send({ op: "note", tab: "t1", words: "x" });
    assert.deepEqual(d.sent, []);
    d.onOpen();
    assert.deepEqual(t.mb.rowOf("m-box"), { id: "m-box", browser: true, browserLink: "connected", browserWords: "Connected: the agent's pages for your chats on Workstation open in this app." });
    assert.equal(t.mb.pagesOf("m-box"), t.made[0]);
    assert.deepEqual(t.mb.all(), [t.made[0]]);
    d.onMessage(JSON.stringify({ n: 1, op: "open", tab: "t1" }));
    d.onMessage(JSON.stringify({ n: 2, op: "cdp", tab: "t1", method: "Page.reload" }));
    d.onMessage(JSON.stringify({ n: 3, op: "fail", tab: "t9" }));
    d.onMessage("not json");
    d.onMessage(JSON.stringify({ op: "open" }));
    await t.settle();
    assert.deepEqual(t.made[0].handled.map((/** @type {any} */ m) => m.n), [1, 2, 3], "its words, those with a number");
    assert.deepEqual(d.sent, [
      { n: 1, ok: true, result: null },
      { n: 2, ok: true, result: { done: "cdp" } },
      { n: 3, ok: false, error: "the app has no tab t9 now" },
    ]);
    t.made[0].send({ op: "event", tab: "t1", method: "Page.loadEventFired", params: {} });
    assert.deepEqual(d.sent.at(-1), { op: "event", tab: "t1", method: "Page.loadEventFired", params: {} });
    const off = t.mb.set("m-box", false);
    assert.equal(off.said, "The agent's pages for your chats on Workstation no longer open in this app");
    assert.deepEqual([off.browser, off.browserLink], [false, "off"]);
    assert.equal(d.closed, 1, "its link closed");
    assert.equal(t.made[0].destroyed, 1, "its pages gone");
    assert.equal(t.mb.pagesOf("m-box"), null);
    assert.equal(t.list()[0].browser, undefined, "kept off");
    d.onMessage(JSON.stringify({ n: 4, op: "open", tab: "t2" }));
    d.onClose({ status: 0, why: "closed here" });
    await t.settle();
    assert.equal(t.made[0].handled.length, 3, "a link let go is heard no more");
    assert.deepEqual(t.waits, [], "nor made again");
  });

  test("over the tailnet's way: checked as any site's, no pin", async () => {
    const t = rig({ list: [box({ browser: true })], route: () => TAIL });
    t.mb.sync();
    await t.settle();
    assert.equal(t.dials[0].url, "wss://box.tail1234.ts.net/api/browser/host");
    assert.equal(t.dials[0].pin, "");
  });

  test("refused — 403, 401 —: stopped for good, said on its row and in the log, its pages closed; on again, or paired again, it dials anew", async () => {
    const t = rig({ list: [box({ browser: true })] });
    t.mb.sync();
    await t.settle();
    t.dials[0].onOpen();
    t.dials[0].onClose({ status: 403, why: "Laptop is a view-only device: it holds no chat's browser" });
    await t.settle();
    assert.equal(t.made[0].closed, 1, "the pages it held go with the link");
    assert.deepEqual(t.mb.rowOf("m-box"), { id: "m-box", browser: true, browserLink: "refused", browserWords: "Workstation refused this app's browser: Laptop is a view-only device: it holds no chat's browser" });
    assert.deepEqual(t.waits, [], "not tried again");
    assert.ok(t.lines.some((l) => /Workstation's link for this app's browser stopped: Workstation refused/.test(l)));
    t.mb.sync();
    await t.settle();
    assert.equal(t.dials.length, 1, "read again, the same way: still stopped");
    // Switched on again: dialled anew, refused 401 this time.
    t.mb.set("m-box", true);
    await t.settle();
    assert.equal(t.dials.length, 2);
    assert.equal(t.made[0].destroyed, 1, "the refused link's pages let go");
    t.dials[1].onClose({ status: 401, why: "the browser's host on another machine is the desktop app of a device paired with this Filament, by its sign-in" });
    await t.settle();
    assert.deepEqual(t.mb.rowOf("m-box"), { id: "m-box", browser: true, browserLink: "refused", browserWords: "Workstation does not know this app's sign-in any more — revoked there, or signed out: pair it again with Add a machine and a code from its Settings › Remote access." });
    assert.equal(t.made[1].closed, 0, "it never opened: no page to close");
    assert.deepEqual(t.waits, []);
    // Paired again: its ways and its partition read anew, dialled again.
    t.setList([box({ browser: true, partition: "persist:machine-m-box.1" })]);
    t.mb.sync();
    await t.settle();
    assert.equal(t.dials.length, 3);
    assert.deepEqual(t.cookies.at(-1), ["persist:machine-m-box.1", "https://192.168.0.9:20343"]);
  });

  test("dropped, or no way answers: made again a little later each time, the last wait holding; once it holds, from the first wait again", async () => {
    const t = rig({ list: [box({ browser: true })] });
    t.mb.sync();
    await t.settle();
    t.dials[0].onClose({ status: 0, why: "connect ECONNREFUSED 192.168.0.9:20343" });
    await t.settle();
    assert.deepEqual(t.mb.rowOf("m-box").browserWords, "Connecting to Workstation: connect ECONNREFUSED 192.168.0.9:20343.");
    for (let i = 1; i <= 4; i++) {
      t.waits.at(-1)?.[0]();
      await t.settle();
      t.dials[i].onClose({ status: 502, why: "Bad Gateway" });
      await t.settle();
    }
    assert.deepEqual(t.waits.map(([, ms]) => ms), [...MACHINE_RETRY_MS, MACHINE_RETRY_MS.at(-1)]);
    assert.equal(t.mb.rowOf("m-box").browserWords, "Connecting to Workstation: Workstation answered 502: Bad Gateway.");
    t.waits.at(-1)?.[0]();
    await t.settle();
    t.dials[5].onOpen();
    t.dials[5].onClose({ status: 0, why: "the socket to 192.168.0.9:20343 closed" });
    await t.settle();
    assert.equal(t.made[0].closed, 1, "its pages closed with the link");
    assert.equal(t.waits.at(-1)?.[1], MACHINE_RETRY_MS[0], "held once: from the first wait again");
    assert.equal(t.mb.rowOf("m-box").browserLink, "connecting");
    // No way answers: tried again too.
    const n = t.waits.length;
    const q = rig({ list: [box({ browser: true })], route: () => null });
    q.mb.sync();
    await q.settle();
    assert.deepEqual(q.dials, []);
    assert.equal(q.waits.length, 1);
    assert.equal(q.mb.rowOf("m-box").browserWords, "Connecting to Workstation: Workstation does not answer: nothing listens.");
    assert.equal(t.waits.length, n);
  });

  // (fails before: yes — the owner's of 11-09: Settings › Remote access said Connecting… from the press on, the link up
  // 34 ms after; nothing told it)
  test("each move of a link's state is said through `changed`, once: up, down and trying again, refused; a retry with the same words says nothing new", async () => {
    const t = rig({ list: [box({ browser: true })] });
    t.mb.sync();
    await t.settle();
    assert.equal(t.rows.length, 0, "dialling: as the press's answer said");
    t.dials[0].onOpen();
    await t.settle();
    assert.deepEqual(t.rows.map((r) => r.browserLink), ["connected"]);
    assert.deepEqual(t.rows[0], t.mb.rowOf("m-box"));
    t.dials[0].onClose({ status: 0, why: "the socket closed" });
    await t.settle();
    assert.deepEqual(t.rows.map((r) => r.browserLink), ["connected", "connecting"]);
    t.waits.at(-1)?.[0]();
    await t.settle();
    t.dials[1].onClose({ status: 502, why: "Bad Gateway" });
    await t.settle();
    assert.equal(t.rows.at(-1)?.browserWords, "Connecting to Workstation: Workstation answered 502: Bad Gateway.");
    const n = t.rows.length;
    t.waits.at(-1)?.[0]();
    await t.settle();
    t.dials[2].onClose({ status: 502, why: "Bad Gateway" });
    await t.settle();
    assert.equal(t.rows.length, n, "the same words: nothing new");
    t.waits.at(-1)?.[0]();
    await t.settle();
    t.dials[3].onClose({ status: 403, why: "Laptop is a view-only device" });
    await t.settle();
    assert.equal(t.rows.at(-1)?.browserLink, "refused");
  });

  test("disconnected in this window, or removed from it: its link closed and its pages gone; connected again, dialled anew", async () => {
    const t = rig({ list: [box({ browser: true })] });
    t.mb.sync();
    await t.settle();
    t.dials[0].onOpen();
    t.setList([box({ browser: true, off: true })]);
    t.mb.sync();
    assert.equal(t.dials[0].closed, 1);
    assert.equal(t.made[0].destroyed, 1);
    assert.deepEqual(t.mb.rowOf("m-box"), { id: "m-box", browser: true, browserLink: "off", browserWords: "Workstation is disconnected in this window: its chats' pages open in this app again once it is connected." });
    t.setList([box({ browser: true })]);
    t.mb.sync();
    await t.settle();
    assert.equal(t.dials.length, 2, "connected again");
    t.setList([]);
    t.mb.sync();
    assert.equal(t.dials[1].closed, 1);
    assert.equal(t.made[1].destroyed, 1);
    assert.equal(t.mb.pagesOf("m-box"), null);
    const gone = t.mb.set("m-box", true);
    assert.deepEqual([gone.failed, gone.said], [true, "No such machine in this window"]);
  });

  test("through an SSH tunnel alone, or with no sign-in held: never dialled, said why", async () => {
    const t = rig({ list: [mac({ browser: true })] });
    t.mb.sync();
    await t.settle();
    assert.deepEqual(t.dials, []);
    assert.deepEqual(t.mb.rowOf("m-mac"), { id: "m-mac", browser: true, browserLink: "refused", browserWords: "This app reaches Mac mini through an SSH tunnel alone, where it is no paired device: turn on Reach this machine on my network or Share on my tailnet there, and add it again by the link it shows." });
    const q = rig({ list: [box({ browser: true })], cookie: "" });
    q.mb.sync();
    await q.settle();
    assert.deepEqual(q.dials, []);
    assert.equal(q.mb.rowOf("m-box").browserWords, "This app holds no sign-in on Workstation: pair it again with Add a machine and a code from its Settings › Remote access.");
    assert.deepEqual(q.waits, []);
  });

  test("the app quits: every link closed, every machine's pages gone", async () => {
    const t = rig({ list: [box({ browser: true }), box({ id: "m-two", name: "Two", browser: true })] });
    t.mb.sync();
    await t.settle();
    t.mb.destroy();
    assert.deepEqual(t.dials.map((d) => d.closed), [1, 1]);
    assert.deepEqual(t.made.map((p) => p.destroyed), [1, 1]);
    assert.deepEqual(t.mb.all(), []);
  });
});

describe("a machine's pages over its Browser pane", () => {
  /** @param {string} id */
  const fakePages = (id) => {
    const p = {
      id,
      /** @type {any[]} */ placed: [],
      parked: 0,
      /** @param {string} tab @param {any} win @param {any} rect @param {any} o */
      place: (tab, win, rect, o) => (tab === "t1" ? (p.placed.push([tab, win, rect, o]), true) : false),
      parkAll: () => void p.parked++,
    };
    return p;
  };
  const win = { isDestroyed: () => false };
  const pane = { id: "m-box", bounds: { x: 0, y: 0, width: 1440, height: 920 } };

  test("its own view's pane while it shows: the page at the rectangle the pane measured, scaled by its page's zoom, where its view lies in the window", () => {
    const boxPages = fakePages("m-box");
    const macPages = fakePages("m-mac");
    /** @type {Record<string, any>} */
    const of = { "m-box": boxPages, "m-mac": macPages };
    const pagesOf = (/** @type {string} */ id) => of[id] ?? null;
    assert.equal(placeOnMachine({ pane, active: "m-box", pagesOf, win, zoom: 1.25, ask: { tab: "t1", rect: { x: 800, y: 40, width: 300, height: 400 }, lock: true } }), true);
    assert.deepEqual(boxPages.placed, [["t1", win, { x: 1000, y: 50, width: 375, height: 500 }, { lock: true }]]);
    assert.deepEqual(macPages.placed, [], "never another machine's");
    const lent = { id: "m-box", bounds: { x: 10, y: 20, width: 1000, height: 700 } };
    assert.equal(placeOnMachine({ pane: lent, active: "m-box", pagesOf, win, zoom: 1, ask: { tab: "t1", rect: { x: 900, y: 0, width: 300, height: 400 } } }), true);
    assert.deepEqual(boxPages.placed[1].slice(2), [{ x: 910, y: 20, width: 100, height: 400 }, { lock: false }], "inside its view, where its view lies");
  });

  test("a tab its pages hold not, its view gone from sight, no pages held for it, or no rectangle: refused, its pages parked — the pane casts it", () => {
    const boxPages = fakePages("m-box");
    const pagesOf = (/** @type {string} */ id) => (id === "m-box" ? /** @type {any} */ (boxPages) : null);
    const ask = { tab: "t1", rect: { x: 0, y: 0, width: 300, height: 400 } };
    assert.equal(placeOnMachine({ pane, active: "m-box", pagesOf, win, zoom: 1, ask: { ...ask, tab: "t9" } }), false, "a tab it holds not");
    assert.equal(boxPages.parked, 1);
    assert.equal(placeOnMachine({ pane, active: "local", pagesOf, win, zoom: 1, ask }), false, "its view not showing");
    assert.equal(boxPages.parked, 2);
    assert.equal(placeOnMachine({ pane, active: "m-box", pagesOf, win, zoom: 1, ask: { tab: "t1", rect: null } }), false);
    assert.equal(placeOnMachine({ pane, active: "m-box", pagesOf, win, zoom: 1, ask: { tab: 7, rect: ask.rect } }), false);
    assert.equal(boxPages.parked, 4);
    assert.equal(placeOnMachine({ pane: { ...pane, id: "m-mac" }, active: "m-mac", pagesOf, win, zoom: 1, ask }), false, "a machine whose browser this app holds not");
    assert.equal(placeOnMachine({ pane: null, active: "m-box", pagesOf, win, zoom: 1, ask }), false, "no machine's pane");
    assert.equal(placeOnMachine({ pane, active: "m-box", pagesOf, win: { isDestroyed: () => true }, zoom: 1, ask }), false);
    assert.deepEqual(boxPages.placed, []);
  });
});
