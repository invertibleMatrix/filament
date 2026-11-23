// @ts-check
// The machines of the harness window (desktop/lib/rail.js, rail-page.js; the owner's remote Filament of 11-06, Part 3; a
// switcher in the top bar in the rail's place since the owner's of 11-08): where each part of the window stands, what
// the popover and the chips draw, another machine's view and its certificate, and the whole run over fake Electron
// pieces — views made, shown, moved, closed, its keys, its looks, its popover.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { LOCAL_ID, colorOf, localMachine, partitionOf } from "../desktop/lib/machines.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { CARRY_MAX, GUEST_MOVES, LOOK_EVERY_MS, MAC_LEFT, TYPED_MS, UNDRAG_COLUMN_CSS, UNDRAG_CSS, WIN_RIGHT, certVerdict, createRail, harnessAt, lentFrame, pageKept, pageState, READ_PAGE, railRows, railState, remotePrefs, showAsk, switchLayout, unreachablePage, updatePage, zoomRows } from "../desktop/lib/rail.js";
import { BAR_H } from "../desktop/lib/frame.js";
import { lanIdentity } from "../src/services/lan-tls.js";
import { PEER_BYTES, PEER_MS, PEERS_MAX, cappedJson, tailnetFilaments } from "../desktop/lib/tailnet-peers.js";
import { chatRoute } from "../desktop/lib/watch.js";

const ORIGIN = "http://127.0.0.1:20300";
const T0 = Date.UTC(2026, 10, 6, 12, 0);
/** @returns {import("../desktop/lib/machines.js").Machine} */
const machine = (id, name, routes) => ({ id, name, routes, partition: partitionOf(id), addedAt: T0 });
const BOX = machine("m-box", "Workstation", [{ kind: "url", url: "http://localhost:20310" }, { kind: "url", url: "https://box.tail1234.ts.net" }]);
const MAC = machine("m-mac", "Mac mini", [{ kind: "url", url: "https://mac.tail1234.ts.net" }]);
const made = /** @type {string[]} */ ([]);
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const RAIL_PRELOAD = "H:\\webshop\\desktop\\rail-preload.cjs";
const MACHINE_PRELOAD = "H:\\webshop\\desktop\\machine-preload.cjs";
/** What a page's chip last heard (lib/rail.js `pageState`). @param {any} wc */
const stateOf = (wc) => wc.sent.filter((/** @type {any[]} */ x) => x[0] === "filament:machines").at(-1)?.[1];

describe("where each part stands", () => {
  // (fails before: yes — the owner's of 11-08: the rail took a column, and another machine's page a title row of its own)
  test("another machine showing: its view over the whole window, as This computer's page stands — no column, no title row of the app's", () => {
    assert.deepEqual(switchLayout({ width: 1440, height: 920 }, { remote: false }), { over: null, view: null });
    assert.deepEqual(switchLayout({ width: 1440, height: 920 }, { remote: true }), { over: null, view: { x: 0, y: 0, width: 1440, height: 920 } });
    assert.deepEqual(switchLayout({ width: 40.4, height: -3 }, { remote: true }).view, { x: 0, y: 0, width: 40, height: 0 }, "nothing below zero");
  });
  test("the popover or the Add sheet: the app's page over the whole window, the rest standing as it was under it", () => {
    const content = { width: 1440, height: 920 };
    assert.deepEqual(switchLayout(content, { remote: false, over: true }), { over: { x: 0, y: 0, width: 1440, height: 920 }, view: null });
    assert.deepEqual(switchLayout(content, { remote: true, over: true }), { over: { x: 0, y: 0, width: 1440, height: 920 }, view: { x: 0, y: 0, width: 1440, height: 920 } });
  });
  // (fails before: yes — the owner's of 11-08: another machine's page knew nothing of the controls over it)
  test("the room the window's controls take, lent to another machine's page: as This computer's page said it, else the system's; at its zoom; none in full screen", () => {
    assert.deepEqual(lentFrame({ platform: "darwin" }), { left: MAC_LEFT, right: 0 });
    assert.deepEqual(lentFrame({ platform: "win32" }), { left: 0, right: WIN_RIGHT });
    assert.deepEqual(lentFrame({ platform: "linux" }), { left: 0, right: WIN_RIGHT });
    assert.deepEqual(lentFrame({ platform: "darwin", area: { left: 84, right: 0 } }), { left: 84, right: 0 }, "the page's own word first");
    assert.deepEqual(lentFrame({ platform: "win32", area: { left: 0, right: 138 }, zoom: 1.25 }), { left: 0, right: 110.4 }, "in that page's pixels");
    assert.deepEqual(lentFrame({ platform: "win32", area: { left: -5, right: NaN } }), { left: 0, right: 0 });
    assert.equal(lentFrame({ platform: "darwin", full: true }), null);
  });
});

describe("what the switcher draws", () => {
  test("each machine in its order, its state — one not asked yet reconnecting —, the one showing, its key, its chats that wait on you, its colour and icon", () => {
    const list = [localMachine(ORIGIN), BOX, { ...MAC, color: "teal", icon: "laptop" }, ...Array.from({ length: 8 }, (_, i) => machine(`m-${i}`, `Box ${i}`, []))];
    const rows = railRows(list, (id) => (id === LOCAL_ID ? { status: "online", silentSince: null, why: null } : id === "m-mac" ? { status: "offline", silentSince: T0, why: "nothing listens" } : null), "m-mac", (id) => (id === "m-box" ? 4 : id === "m-mac" ? -2 : 0));
    assert.deepEqual(rows[0], { id: LOCAL_ID, name: "This computer", status: "online", why: null, active: false, slot: 1, local: true, waiting: 0, color: "purple", icon: "monitor" });
    assert.deepEqual(rows[1], { id: "m-box", name: "Workstation", status: "reconnecting", why: null, active: false, slot: 2, local: false, waiting: 4, color: colorOf(BOX), icon: "monitor" });
    assert.deepEqual(rows[2], { id: "m-mac", name: "Mac mini", status: "offline", why: "nothing listens", active: true, slot: 3, local: false, waiting: 0, color: "teal", icon: "laptop" }, "the ones chosen for it");
    assert.equal(rows[8].slot, 9);
    assert.equal(rows[9].slot, null, "past the ninth no key");
    assert.equal(railRows([BOX], () => null, LOCAL_ID)[0].waiting, 0, "no count said: none");
  });
  // (fails before: yes — the owner's of 11-08: a popover of machines in the rail's place)
  test("the popover's rows: names and whys escaped, a menu item each, its icon in its colour, the one showing ticked, its key, its count; each machine's ⋯ — This computer's its Colour and Icon alone; Add a machine last", () => {
    const rows = railRows([localMachine(ORIGIN), { ...machine("m-x", `<img src=x onerror=alert(1)>`, []), color: "pink", icon: "server" }], (id) => (id === "m-x" ? { status: "offline", silentSince: T0, why: `"evil" <b>` } : { status: "online", silentSince: null, why: null }), "m-x", (id) => (id === "m-x" ? 120 : 0));
    const at = { x: 900, y: 10, width: 120, height: 28 };
    const s = railState(rows, { dark: true, colors: { color: "#101010", symbolColor: "#eeeeee" }, bar: BAR_H, at });
    assert.deepEqual([s.bg, s.fg, s.bar, s.dark, s.adding, s.at], ["#101010", "#eeeeee", BAR_H, true, false, at]);
    assert.ok(!s.list.includes("<img") && !s.list.includes("<b>&quot;"), s.list);
    assert.match(s.list, /<div class="row s-offline on" role="none"><button type="button" class="pick" role="menuitemradio" aria-checked="true" data-machine="m-x" title="&lt;img src=x onerror=alert\(1\)&gt; — offline · Ctrl\+2\n&quot;evil&quot; &lt;b&gt;" aria-label="&lt;img src=x onerror=alert\(1\)&gt;, offline, 120 waiting on you">/);
    assert.match(s.list, /<i class="dot"><\/i><span class="mi c-pink"><svg [^>]+>(?:(?!<\/svg>).)*<\/svg><\/span><span class="nm"><b>&lt;img src=x onerror=alert\(1\)&gt;<\/b><small>offline — &quot;evil&quot; &lt;b&gt;<\/small><\/span><span class="ct">99\+<\/span><span class="tick"><svg/);
    assert.ok(s.list.includes(`<span class="mi c-pink">${ICONS.server}</span>`), "its icon, in its colour");
    assert.match(s.list, /<kbd>Ctrl\+2<\/kbd><\/button><button type="button" class="more" data-more="m-x" title="&lt;img src=x onerror=alert\(1\)&gt;: Colour, Icon, Disconnect, Remove…" aria-label="More for &lt;img/);
    assert.match(s.list, /<div class="row s-online" role="none"><button [^>]*aria-checked="false" data-machine="local"[^>]*><i class="dot"><\/i><span class="mi c-purple"><svg [^>]+>(?:(?!<\/svg>).)*<\/svg><\/span><span class="nm"><b>This computer<\/b><\/span><span class="tick"><\/span><kbd>Ctrl\+1<\/kbd><\/button><button type="button" class="more" data-more="local" title="This computer: Colour, Icon"/, "connected: no line under its name; no count, no tick; its ⋯ its Colour and Icon");
    assert.match(s.list, /<div class="sep" role="separator"><\/div><button type="button" class="pick add" role="menuitem" data-add=""><svg[^]*<b>Add a machine…<\/b><\/span><\/button>$/);
    const here = railState(railRows([localMachine(ORIGIN), MAC], () => ({ status: "online", silentSince: null, why: null }), LOCAL_ID), { dark: false, mod: "⌘" });
    assert.match(here.list, /title="Mac mini — connected · ⌘2"/);
    assert.deepEqual([here.bg, here.fg, here.at, here.dark], ["#f3f3f3", "#1a1a1a", null, false], "no colours said yet: the theme's; no chip pressed");
  });
  // (fails before: yes — the owner's of 11-08: no page had a chip to hear)
  test("what a harness page hears for its chip: shown once another is kept, the machine it is — its state, colour and icon —, the others' count, open, its lent frame — nothing of another machine's name", () => {
    const rows = railRows([localMachine(ORIGIN), { ...BOX, color: "green", icon: "server" }, MAC], (id) => (id === "m-mac" ? { status: "offline", silentSince: T0, why: "secret why" } : { status: "online", silentSince: null, why: null }), "m-box", (id) => (/** @type {Record<string, number>} */ ({ local: 2, "m-box": 5, "m-mac": 1 }))[id] ?? 0);
    assert.deepEqual(pageState(rows, LOCAL_ID), { shown: true, name: "This computer", status: "online", color: "purple", icon: "monitor", waiting: 6, open: false, frame: null });
    assert.deepEqual(pageState(rows, "m-box", { open: true, frame: { left: 0, right: 138 } }), { shown: true, name: "Workstation", status: "online", color: "green", icon: "server", waiting: 3, open: true, frame: { left: 0, right: 138 } });
    assert.ok(!/Mac mini|secret/.test(JSON.stringify(pageState(rows, "m-box"))), "another machine's name and why stay the app's");
    assert.deepEqual(pageState(railRows([localMachine(ORIGIN)], () => null, LOCAL_ID), LOCAL_ID), { shown: false, name: "This computer", status: "reconnecting", color: "purple", icon: "monitor", waiting: 0, open: false, frame: null });
  });
});

describe("another machine's view", () => {
  test("sandboxed, isolated, no Node and no preload, in its machine's partition", () => {
    const p = remotePrefs(BOX);
    assert.deepEqual(p, { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, partition: "persist:machine-m-box" });
    assert.ok(!("preload" in p));
    assert.throws(() => remotePrefs(localMachine(ORIGIN)), /no other machine/);
    assert.equal(harnessAt({ url: "https://box.tail1234.ts.net/ui/pair.html" }), "https://box.tail1234.ts.net/ui/harness.html");
  });
  // (fails before: yes — no SSH route)
  test("through an SSH tunnel its harness names the alias, which an editor here opens its folders by; an alias that is none, and another kind, name none", () => {
    assert.equal(harnessAt({ kind: "ssh", url: "http://127.0.0.1:5555", alias: "filtest", port: 20300 }), "http://127.0.0.1:5555/ui/harness.html?ssh=filtest");
    assert.equal(harnessAt({ kind: "ssh", url: "http://127.0.0.1:5555", alias: "kai@box.local", port: 20300 }), "http://127.0.0.1:5555/ui/harness.html?ssh=kai%40box.local");
    assert.equal(harnessAt({ kind: "ssh", url: "http://127.0.0.1:5555", alias: "-oX&pane=x", port: 20300 }), "http://127.0.0.1:5555/ui/harness.html");
    assert.equal(harnessAt({ kind: "url", url: "http://127.0.0.1:5555", alias: "filtest" }), "http://127.0.0.1:5555/ui/harness.html");
    assert.equal(new URLSearchParams(new URL(harnessAt({ kind: "ssh", url: "http://127.0.0.1:5555", alias: "kai@box.local", port: 1 })).search).get("ssh"), "kai@box.local", "read back as it was");
  });
  test("its certificate: the pinned one alone on a host its network routes name; any other host Chromium's own check", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-rail-tls-"));
    made.push(dir);
    const id = lanIdentity(dir, { name: "Workstation" });
    const other = lanIdentity(join(dir, "other"), { name: "Another" });
    const box = machine("m-box", "Workstation", [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: id.fingerprint }, { kind: "url", url: "https://box.tail1234.ts.net" }]);
    assert.equal(certVerdict(box, { hostname: "192.168.0.9", certificate: { data: id.cert } }), 0);
    assert.equal(certVerdict(box, { hostname: "192.168.0.9", certificate: { data: other.cert } }), -2, "another certificate: refused");
    assert.equal(certVerdict(box, { hostname: "192.168.0.9", certificate: { data: "not a certificate" } }), -2);
    assert.equal(certVerdict(box, { hostname: "192.168.0.9" }), -2);
    assert.equal(certVerdict(box, { hostname: "box.tail1234.ts.net", certificate: { data: other.cert } }), -3, "a host no pin names: as any site");
    // (fails before: yes — s4g: a certificate the machine renewed was refused, and the window paired again) Renewed by
    // the same key, learned at the pinned one's check above: taken; a new key's is not.
    const renewed = lanIdentity(dir, { now: id.notAfter - 29 * 86_400_000 });
    assert.equal(renewed.renewed, true);
    assert.equal(certVerdict(box, { hostname: "192.168.0.9", certificate: { data: renewed.cert } }), 0, "its key, renewed");
    const anew = lanIdentity(dir, { newKey: true });
    assert.equal(certVerdict(box, { hostname: "192.168.0.9", certificate: { data: anew.cert } }), -2, "a new key: refused");
    // A pin never met here has no key learned: its renewal is refused until it is met once.
    const third = lanIdentity(join(dir, "third"), { name: "Third" });
    const unmet = machine("m-third", "Third", [{ kind: "lan", url: "https://192.168.0.10:20343", fingerprint: third.fingerprint }]);
    assert.equal(certVerdict(unmet, { hostname: "192.168.0.10", certificate: { data: lanIdentity(join(dir, "third"), { now: third.notAfter - 29 * 86_400_000 }).cert } }), -2);
  });
  // (fails before: yes — the owner's of 11-08: with no rail, a machine that cannot be reached would leave no way back)
  test("one that cannot be reached: the app's own page, each why escaped; its top row drags the window; its one script Switch machine's press, where the view's bridge is", () => {
    const url = unreachablePage("Work<station>", [{ url: "http://localhost:20310", why: "nothing listens at <http://localhost:20310>" }], { dark: true });
    assert.match(url, /^data:text\/html;charset=utf-8,/);
    const html = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    assert.match(html, /Work&lt;station&gt; cannot be reached/);
    assert.match(html, /<li>nothing listens at &lt;http:\/\/localhost:20310&gt;<\/li>/);
    assert.match(html, new RegExp(`every ${LOOK_EVERY_MS / 1000} s`));
    assert.match(html, /\.bar\{position:fixed;left:0;right:0;top:0;height:48px;-webkit-app-region:drag\}/);
    assert.match(html, /<button type="button" id="switch" hidden>Switch machine<\/button>/);
    const scripts = html.match(/<script[^>]*>[^<]*<\/script>/g) || [];
    assert.equal(scripts.length, 1);
    assert.equal((html.match(/<script/g) || []).length, 1, "that one alone");
    const run = (/** @type {any} */ bridge) => {
      const b = { hidden: true, /** @type {any} */ onclick: null, getBoundingClientRect: () => ({ left: 600, top: 400, width: 120, height: 30 }) };
      vm.runInNewContext(scripts[0].replace(/^<script>|<\/script>$/g, ""), { window: { filamentMachines: bridge }, document: { getElementById: (/** @type {string} */ id) => (id === "switch" ? b : null) } });
      return b;
    };
    assert.equal(run(undefined).hidden, true, "no bridge: no button");
    /** @type {any[]} */
    const opened = [];
    const b = run({ open: (/** @type {any} */ r) => opened.push(r) });
    assert.equal(b.hidden, false);
    /** @type {any} */ (b).onclick();
    assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{ x: 600, y: 400, width: 120, height: 30 }]);
    assert.match(decodeURIComponent(unreachablePage("x", [], { dark: false, bar: 0 })), /height:0px;-webkit-app-region:drag/, "full screen: no bar");
  });

  // (fails before: yes — the remote desk of 11-22, s4c: a machine on a wire this app does not speak said nothing of which
  // side to update)
  test("one on a wire this app does not speak: the app's own page says which side to update and how, its act and Switch machine its one script's, where the view's bridge is", () => {
    const html = (/** @type {string} */ url) => decodeURIComponent(url.slice(url.indexOf(",") + 1));
    const there = html(updatePage("Work<station>", "there", "Work<station> runs Filament 0.9.40, too old for this app: update Filament on Work<station>.", { dark: true }));
    assert.match(there, /<div class="title">Update Filament on Work&lt;station&gt;<\/div><div class="line">Work&lt;station&gt; runs Filament 0\.9\.40, too old for this app: update Filament on Work&lt;station&gt;\.<\/div>/);
    assert.match(there, /The Filament app on Work&lt;station&gt; updates itself \(its tray's Check for updates\), and a server with filament update\./);
    assert.match(there, /<button type="button" id="act" hidden>Open its page<\/button><button type="button" id="switch" hidden>Switch machine<\/button>/);
    assert.match(there, /\.bar\{position:fixed;left:0;right:0;top:0;height:48px;-webkit-app-region:drag\}/);
    const here = html(updatePage("Studio", "here", "Studio runs Filament 9.0.0, too new for this app: update this app.", { dark: false, bar: 0 }));
    assert.match(here, /<div class="title">Update this app<\/div>/);
    assert.match(here, /<button type="button" id="act" hidden>Update this app<\/button>/);
    assert.match(here, /height:0px;-webkit-app-region:drag/);
    assert.equal((here.match(/<script/g) || []).length, 1, "one script alone");
    const script = (/** @type {string[]} */ (here.match(/<script>[^<]*<\/script>/)))[0].replace(/^<script>|<\/script>$/g, "");
    const run = (/** @type {any} */ bridge) => {
      const el = (/** @type {DOMRect} */ r) => ({ hidden: true, /** @type {any} */ onclick: null, getBoundingClientRect: () => r });
      const a = el(/** @type {any} */ ({ left: 1, top: 2, width: 3, height: 4 }));
      const b = el(/** @type {any} */ ({ left: 600, top: 400, width: 120, height: 30 }));
      vm.runInNewContext(script, { window: { filamentMachines: bridge }, document: { getElementById: (/** @type {string} */ id) => (id === "act" ? a : id === "switch" ? b : null) } });
      return { a, b };
    };
    const none = run(undefined);
    assert.deepEqual([none.a.hidden, none.b.hidden], [true, true], "no bridge: no buttons");
    /** @type {any[]} */
    const did = [];
    const got = run({ update: () => did.push("update"), open: (/** @type {any} */ r) => did.push(r) });
    assert.deepEqual([got.a.hidden, got.b.hidden], [false, false]);
    /** @type {any} */ (got.a).onclick();
    /** @type {any} */ (got.b).onclick();
    assert.deepEqual(JSON.parse(JSON.stringify(did)), ["update", { x: 600, y: 400, width: 120, height: 30 }]);
  });
});

/** A fake webContents: what it loaded, the CSS put into it, what it was sent, its handlers. */
function fakeContents() {
  /** @type {Map<string, Function[]>} */
  const on = new Map();
  return {
    loads: /** @type {string[]} */ ([]),
    css: /** @type {string[]} */ ([]),
    removed: /** @type {string[]} */ ([]),
    sent: /** @type {any[]} */ ([]),
    focused: 0,
    closed: false,
    /** @type {any} */ opener: null,
    /** @param {string} ev @param {Function} fn */
    on(ev, fn) {
      on.set(ev, [...(on.get(ev) ?? []), fn]);
      return this;
    },
    /** @param {string} ev @param {...any} a */
    emit(ev, ...a) {
      for (const fn of on.get(ev) ?? []) fn(...a);
    },
    /** @param {string} u */
    loadURL(u) {
      this.loads.push(u);
      const fail = this.loadFails.shift();
      return fail ? Promise.reject(fail) : Promise.resolve();
    },
    /** What the next loads reject with, as Electron's loadURL does. @type {Error[]} */
    loadFails: [],
    loading: false,
    isLoading() {
      return this.loading;
    },
    getURL() {
      return this.loads.at(-1) ?? "";
    },
    /** @param {string} ev @param {Function} fn */
    removeListener(ev, fn) {
      on.set(ev, (on.get(ev) ?? []).filter((x) => x !== fn));
      return this;
    },
    /** The scripts run in its page, and what the next answers (the rig's `claim`). @type {string[]} */
    scripts: [],
    /** @type {() => Promise<any>} */
    claim: async () => undefined,
    /** @param {string} code */
    executeJavaScript(code) {
      this.scripts.push(code);
      return this.claim();
    },
    /** Its page as the app reads it in a world of its own (lib/rail.js `readPage`): none unless a test says. @type {string | null} */
    storage: null,
    /** @type {[number, string][]} */
    isolated: [],
    /** @param {number} world @param {{ code: string }[]} scripts */
    executeJavaScriptInIsolatedWorld(world, scripts) {
      this.isolated.push([world, scripts[0].code]);
      return Promise.resolve(this.storage);
    },
    zoom: 1,
    getZoomFactor() {
      return this.zoom;
    },
    /** What the next inserts do: "" answer with a key, "refuse" reject, "hang" never answer. @type {string[]} */
    inserts: [],
    /** @param {string} c */
    insertCSS(c) {
      this.css.push(c);
      const how = this.inserts.shift() || "";
      if (how === "refuse") return Promise.reject(new Error("the page went"));
      if (how === "hang") return new Promise(() => {});
      return Promise.resolve(`key-${this.css.length}`);
    },
    /** @param {string} k */
    removeInsertedCSS(k) {
      this.removed.push(k);
      return Promise.resolve();
    },
    /** @param {string} ch @param {any} s */
    send(ch, s) {
      this.sent.push([ch, s]);
    },
    focus() {
      this.focused++;
    },
    isDestroyed() {
      return this.closed;
    },
    close() {
      this.closed = true;
    },
    /** @param {any} fn */
    setWindowOpenHandler(fn) {
      this.opener = fn;
    },
  };
}

/** The rail over fakes: a window, its views, the partitions' sessions, the looks' timer, the routes as `answers` says. */
/**
 * @param {{ kept?: any[], answers?: Record<string, any>, zoom?: number, inserts?: string[], check?: any, keep?: any, claim?: () => Promise<any>,
 *   menu?: (rows: any[]) => void, confirm?: (q: any) => Promise<boolean>, ownId?: () => string | null, peers?: () => Promise<any>,
 *   waiting?: (id: string) => number, busy?: (id: string) => boolean, platform?: string, browserOf?: (id: string) => any, onGuest?: (g: any) => void, updateHere?: () => void }} [o]
 */
function rig({ kept = [BOX, MAC], answers = /** @type {Record<string, any>} */ ({}), zoom = 1, inserts = /** @type {string[]} */ ([]), check, keep, claim, menu, confirm, ownId, peers, waiting, busy, platform = "win32", browserOf, onGuest, updateHere } = {}) {
  let list = [localMachine(ORIGIN), ...kept];
  /** @type {any[]} */
  const views = [];
  class View {
    /** @param {any} o */
    constructor(o) {
      this.prefs = o.webPreferences;
      this.webContents = fakeContents();
      if (claim) this.webContents.claim = claim;
      /** @type {any} */ this.bounds = null;
      this.visible = true;
      views.push(this);
    }
    /** @param {any} b */
    setBounds(b) {
      this.bounds = b;
    }
    getBounds() {
      return this.bounds;
    }
    /** @param {boolean} v */
    setVisible(v) {
      this.visible = v;
    }
    setBackgroundColor() {}
  }
  /** @type {Map<string, Function[]>} */
  const winOn = new Map();
  const win = {
    webContents: fakeContents(),
    size: [1440, 920],
    /** @type {any[]} */ children: [],
    contentView: {
      /** @param {any} v */
      addChildView(v) {
        win.children = [...win.children.filter((x) => x !== v), v];
      },
      /** @param {any} v */
      removeChildView(v) {
        win.children = win.children.filter((x) => x !== v);
      },
    },
    getContentSize: () => win.size,
    full: false,
    isFullScreen: () => win.full,
    isDestroyed: () => false,
    /** @param {string} ev @param {Function} fn */
    on(ev, fn) {
      winOn.set(ev, [...(winOn.get(ev) ?? []), fn]);
    },
    /** @param {string} ev */
    emit(ev) {
      for (const fn of winOn.get(ev) ?? []) fn();
    },
  };
  /** @type {Record<string, any>} */
  const sessions = {};
  /** @type {any[]} */
  const guarded = [];
  /** @type {Function[]} */
  const ticks = [];
  /** The colours the window's controls were dressed in. @type {any[]} */
  const tinted = [];
  let now = T0;
  win.webContents.zoom = zoom;
  win.webContents.inserts = [...inserts];
  const r = createRail({
    win,
    View,
    sessionOf: (p) =>
      (sessions[p] ??= {
        /** @param {Function} fn */
        setCertificateVerifyProc(fn) {
          this.verify = fn;
          // Each set clears the verdicts Chromium kept.
          this.sets = (this.sets || 0) + 1;
        },
        cleared: 0,
        clearStorageData() {
          this.cleared++;
          this.cookies.jar = [];
          return Promise.resolve();
        },
        /** Its cookies, as Electron's cookies API reads and writes them. */
        cookies: {
          /** @type {any[]} */ jar: [],
          /** @param {{ url: string }} q */
          async get(q) {
            return this.jar.filter((/** @type {any} */ k) => !k.url || k.url === q.url);
          },
          /** One of the same address and name replaced, as Electron's. @param {any} k */
          async set(k) {
            const at = this.jar.findIndex((/** @type {any} */ x) => x.url === k.url && x.name === k.name);
            if (at >= 0) this.jar.splice(at, 1);
            this.jar.push(k);
          },
        },
      }),
    railPage: "file:///H:/webshop/desktop/rail.html",
    railPreload: RAIL_PRELOAD,
    machinePreload: MACHINE_PRELOAD,
    machines: () => list,
    localWatched: () => ({ status: "online", silentSince: null, why: null }),
    look: () => ({ dark: true, colors: null }),
    guard: (contents, o) => guarded.push({ contents, o }),
    grants: (ses, originOf) => void (ses.originOf = originOf),
    pick: async (m) => {
      const a = answers[m.id];
      return typeof a === "function" ? a(m) : (a ?? { route: null, name: null, version: null, tried: [{ url: String(m.routes[0]?.url), why: "nothing listens" }] });
    },
    now: () => now,
    every: /** @type {any} */ ((fn) => (ticks.push(fn), ticks.length)),
    stopEvery: /** @type {any} */ (() => void ticks.splice(0)),
    platform,
    tint: (c) => void tinted.push(c),
    ...(waiting ? { waiting } : {}),
    ...(busy ? { busy } : {}),
    ...(check ? { check } : {}),
    ...(keep ? { keep } : {}),
    ...(menu ? { menu } : {}),
    ...(confirm ? { confirm } : {}),
    ...(ownId ? { ownId } : {}),
    ...(peers ? { peers } : {}),
    ...(browserOf ? { browserOf } : {}),
    ...(onGuest ? { onGuest } : {}),
    ...(updateHere ? { updateHere } : {}),
  });
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((res) => setImmediate(res));
  };
  return {
    r,
    win,
    views,
    sessions,
    guarded,
    ticks,
    answers,
    settle,
    /** One look of the timer's, waited for. */
    tick: async () => {
      ticks[0]();
      await settle();
    },
    railView: () => views.find((v) => v.prefs.preload === RAIL_PRELOAD),
    tinted,
    viewOf: (/** @type {string} */ partition) => views.find((v) => v.prefs.partition === partition),
    /** @param {any[]} l */
    setList: (l) => void (list = l),
    later: (/** @type {number} */ ms) => void (now += ms),
  };
}
const answered = (/** @type {any} */ route) => ({ route, name: null, version: null, tried: [] });

describe("the rail, run", () => {
  test("nothing kept: no app page made, nothing put into this computer's page, its chip told it shows none, no machine to show", async () => {
    const t = rig({ kept: [] });
    await t.settle();
    assert.equal(t.views.length, 0);
    assert.deepEqual(t.win.webContents.css, []);
    assert.deepEqual(stateOf(t.win.webContents), { shown: false, name: "This computer", status: "online", color: "purple", icon: "monitor", waiting: 0, open: false, frame: null });
    assert.equal(t.r.select(LOCAL_ID), false);
    assert.equal(t.r.openPop(LOCAL_ID, { x: 1, y: 1, width: 1, height: 1 }), false, "no popover with nothing to switch to");
    assert.equal(t.ticks.length, 0, "no looks");
  });

  // (fails before: yes — the owner's of 11-08: a rail stood at the window's left, and This computer's page made room for it)
  test("a machine kept: no rail, no room taken in this computer's page — its chip told it is This computer, and the others' count; told again only what moved, or as its page asks", async () => {
    const t = rig({ waiting: (id) => (id === "m-box" ? 2 : 0) });
    await t.settle();
    assert.equal(t.railView(), undefined, "no app page until the popover or the sheet");
    assert.deepEqual(t.win.webContents.css, []);
    assert.equal(t.win.children.length, 0, "nothing over this computer's page");
    assert.deepEqual(stateOf(t.win.webContents), { shown: true, name: "This computer", status: "online", color: "purple", icon: "monitor", waiting: 2, open: false, frame: null });
    const n = t.win.webContents.sent.length;
    t.r.refresh();
    await t.tick();
    assert.equal(t.win.webContents.sent.length, n, "nothing moved: nothing said");
    t.r.told(LOCAL_ID);
    assert.equal(t.win.webContents.sent.length, n + 1, "its page loaded anew asks: told again");
    assert.equal(t.ticks.length, 1, "the machines asked while one is kept");
  });

  // (fails before: yes — the owner's of 11-08: its view stood below the app's title row and beside the rail, and had no chip)
  test("another machine shown: its view made in its partition with its one bridge, guarded on its own origin, opened at its harness where it answers, over the whole window — the controls' room lent it", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) } });
    await t.settle();
    assert.equal(t.r.select("m-box"), true);
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    assert.ok(v, "made");
    assert.deepEqual(v.prefs, { ...remotePrefs(BOX), preload: MACHINE_PRELOAD }, "of the app's bridges its one alone");
    assert.deepEqual(v.webContents.loads, ["https://box.tail1234.ts.net/ui/harness.html"]);
    const g = t.guarded.find((x) => x.contents === v.webContents);
    assert.equal(g.o.originOf(), "https://box.tail1234.ts.net");
    assert.deepEqual(g.o.prefs, remotePrefs(BOX), "a window it opens is that machine's too, and has no bridge");
    assert.equal(t.sessions["persist:machine-m-box"].originOf(), "https://box.tail1234.ts.net", "its permissions by its own origin");
    assert.deepEqual(v.bounds, { x: 0, y: 0, width: 1440, height: 920 });
    assert.equal(v.visible, true);
    assert.equal(t.railView(), undefined, "no app page under it: no title row of the app's");
    assert.equal(t.win.children.at(-1), v, "on top");
    assert.ok(v.webContents.focused > 0, "the keys go to it");
    assert.deepEqual(stateOf(v.webContents), { shown: true, name: "Workstation", status: "online", color: colorOf(BOX), icon: "monitor", waiting: 0, open: false, frame: { left: 0, right: WIN_RIGHT } });
    // Back to this computer: its view hidden, kept live.
    t.r.select(LOCAL_ID);
    assert.equal(v.visible, false);
    assert.equal(v.webContents.closed, false);
    assert.ok(t.win.webContents.focused > 0);
    t.r.select("m-box");
    await t.settle();
    assert.equal(v.webContents.loads.length, 1, "shown again: not loaded again");
    // The window resized: it follows.
    t.win.size = [1000, 700];
    t.win.emit("resize");
    assert.deepEqual(v.bounds, { x: 0, y: 0, width: 1000, height: 700 });
  });

  // (fails before: yes — no machine could be shown at an address of its harness: the new-chat menu's project there
  // opened nothing, pk-list)
  test("a machine shown at an address of its harness: opened at it where its view is new, moved to it in place where its page shows; an address that is none of its harness's opens nothing", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) } });
    await t.settle();
    assert.equal(t.r.openOn("m-box", "#/new/%2FUsers%2Fkai%2Fwebshop"), true);
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    assert.deepEqual(v.webContents.loads, ["https://box.tail1234.ts.net/ui/harness.html#/new/%2FUsers%2Fkai%2Fwebshop"], "opened at it");
    assert.equal(t.r.active(), "m-box", "shown");
    t.r.select(LOCAL_ID);
    assert.equal(t.r.openOn("m-box", "#/new/%2FUsers%2Fkai%2Fnotes"), true);
    await t.settle();
    assert.deepEqual(v.webContents.loads.at(-1), "https://box.tail1234.ts.net/ui/harness.html#/new/%2FUsers%2Fkai%2Fnotes", "its page moved to it");
    assert.equal(t.r.active(), "m-box");
    // A notification's chat there (main.js `showMachine`), its thread's too, whatever its id holds.
    t.r.select(LOCAL_ID);
    assert.equal(t.r.openOn("m-box", chatRoute({ chain: "chat 7/#x", thread: "s2" })), true);
    await t.settle();
    assert.equal(v.webContents.loads.at(-1), "https://box.tail1234.ts.net/ui/harness.html#/task/chat%207%2F%23x/side", "its chat opened in its page");
    assert.equal(t.r.active(), "m-box");
    const n = v.webContents.loads.length;
    for (const bad of ["javascript:alert(1)", "https://elsewhere.example/#/", "#/new/a b", "", "#/x#/y"]) assert.equal(t.r.openOn("m-box", bad), false, bad);
    assert.equal(t.r.openOn(LOCAL_ID, "#/new/x"), false, "this computer's page opens its own");
    assert.equal(t.r.openOn("m-none", "#/new/x"), false);
    assert.equal(v.webContents.loads.length, n, "nothing loaded for them");
  });

  // (fails before: yes — the review of pk-list: openOn read the view's committed address, so a pick while its page
  // loaded was kept for a later open, and one made while the machine did not answer opened its page there whenever it
  // came back)
  test("a machine shown at an address while its page loads takes it at once; one asked while it does not answer opens there if it answers within a minute, never later", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) } });
    await t.settle();
    t.r.select("m-box");
    const v = t.viewOf("persist:machine-m-box");
    // Its page sent there, its address not yet its own: the newest address is loaded all the same.
    v.webContents.getURL = () => "";
    assert.equal(t.r.openOn("m-box", "#/new/%2FUsers%2Fkai%2Fwebshop"), true);
    await t.settle();
    assert.equal(v.webContents.loads.at(-1), "https://box.tail1234.ts.net/ui/harness.html#/new/%2FUsers%2Fkai%2Fwebshop");

    const late = rig();
    await late.settle();
    assert.equal(late.r.openOn("m-mac", "#/new/%2FUsers%2Fkai%2Fa"), true);
    await late.settle();
    const mac = late.viewOf("persist:machine-m-mac");
    assert.match(String(mac.webContents.loads.at(-1)), /^data:text\/html/, "it does not answer: the app's page");
    late.later(30_000);
    late.answers["m-mac"] = answered(MAC.routes[0]);
    await late.tick();
    assert.equal(mac.webContents.loads.at(-1), "https://mac.tail1234.ts.net/ui/harness.html#/new/%2FUsers%2Fkai%2Fa", "answered within the minute: opened at it");

    const later = rig();
    await later.settle();
    assert.equal(later.r.openOn("m-mac", "#/new/%2FUsers%2Fkai%2Fb"), true);
    await later.settle();
    later.later(61_000);
    later.answers["m-mac"] = answered(MAC.routes[0]);
    await later.tick();
    assert.equal(later.viewOf("persist:machine-m-mac").webContents.loads.at(-1), "https://mac.tail1234.ts.net/ui/harness.html", "past the minute: its page opens where it would");
  });

  // (fails before: yes — b-remote: a machine's view had no way to the pages this app holds for its chats)
  test("a machine's Browser pane: its view's main frame at its own Filament's address alone; the pages this app holds for it lifted over its view as it shows, parked as it goes from sight", async () => {
    /** @type {any[]} */
    const lifted = [];
    /** @type {string[]} */
    const parked = [];
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) }, browserOf: (id) => ({ lift: (/** @type {any} */ w) => lifted.push([id, w.children.at(-1)]), parkAll: () => parked.push(id) }) });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const box = t.viewOf("persist:machine-m-box");
    assert.deepEqual(t.r.machinePane(box.webContents, { url: "https://box.tail1234.ts.net/ui/harness.html", parent: null }), { id: "m-box", bounds: { x: 0, y: 0, width: 1440, height: 920 } });
    assert.equal(t.r.machinePane(box.webContents, { url: "https://elsewhere.example/ui/harness.html", parent: null }), null, "a page it went to elsewhere");
    assert.equal(t.r.machinePane(box.webContents, { url: "https://box.tail1234.ts.net/ui/harness.html", parent: {} }), null, "a frame in its page");
    assert.equal(t.r.machinePane(t.win.webContents, { url: `${ORIGIN}/ui/harness.html`, parent: null }), null, "This computer's page: main.js paneOf's");
    assert.equal(t.r.machinePane(box.webContents, null), null);
    assert.ok(lifted.length > 0 && lifted.every(([id, top]) => id === "m-box" && top === box), "lifted, each time, straight over its view");
    assert.ok(!parked.includes("m-box"), "not parked while it shows");
    t.r.select(LOCAL_ID);
    assert.ok(parked.includes("m-box"), "parked as its view goes from sight");
    assert.equal(t.r.pageOf("m-box"), box.webContents, "its page, for the pane's word back");
  });

  // (fails before: no — the review of p3-shell: the test asked one unpinned host alone, and a check over the machine as
  // first read would have passed it)
  test("its certificate checked by the machine as kept now: paired again, the new certificate alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-rail-repair-"));
    made.push(dir);
    const first = lanIdentity(join(dir, "first"), { name: "Workstation" });
    const second = lanIdentity(join(dir, "second"), { name: "Workstation" });
    const lan = (/** @type {string} */ fingerprint) => machine("m-box", "Workstation", [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint }, { kind: "url", url: "https://box.tail1234.ts.net" }]);
    const t = rig({ kept: [lan(first.fingerprint), MAC], answers: { "m-box": answered({ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: first.fingerprint }) } });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const ses = t.sessions["persist:machine-m-box"];
    const said = (/** @type {string} */ hostname, /** @type {string} */ data) => {
      /** @type {number[]} */
      const out = [];
      ses.verify({ hostname, certificate: { data } }, (/** @type {number} */ n) => out.push(n));
      return out[0];
    };
    assert.deepEqual([said("192.168.0.9", first.cert), said("192.168.0.9", second.cert), said("box.tail1234.ts.net", second.cert)], [0, -2, -3]);
    // Paired again on the network, its listener's certificate made anew: the one kept now is the one taken.
    t.setList([localMachine(ORIGIN), lan(second.fingerprint), MAC]);
    t.r.refresh();
    assert.deepEqual([said("192.168.0.9", first.cert), said("192.168.0.9", second.cert)], [-2, 0]);
  });

  test("one that does not answer: the app's page says why, the looks try again, and it opens once it answers", async () => {
    const t = rig();
    await t.settle();
    t.r.select("m-mac");
    await t.settle();
    const v = t.viewOf("persist:machine-m-mac");
    assert.equal(v.webContents.loads.length, 1);
    assert.match(v.webContents.loads[0], /^data:text\/html/);
    assert.match(decodeURIComponent(v.webContents.loads[0]), /Mac mini cannot be reached[\s\S]*<li>nothing listens<\/li>/);
    assert.equal(t.guarded.find((x) => x.contents === v.webContents).o.originOf(), null, "the app's page: no origin is its own");
    await t.tick();
    assert.equal(v.webContents.loads.length, 1, "the same whys: not drawn again");
    assert.equal(stateOf(v.webContents).status, "reconnecting");
    t.later(31_000);
    await t.tick();
    assert.equal(stateOf(v.webContents).status, "offline");
    t.answers["m-mac"] = answered(MAC.routes[0]);
    await t.tick();
    assert.deepEqual(v.webContents.loads.at(-1), "https://mac.tail1234.ts.net/ui/harness.html");
    assert.equal(stateOf(v.webContents).status, "online");
    // A navigation cut, a frame's that failed, while its page stands: nothing (the review of p3-shell: asked after the
    // page went, they proved nothing).
    v.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "x", true);
    v.webContents.emit("did-fail-load", {}, -105, "x", "x", false);
    assert.equal(v.webContents.loads.at(-1), "https://mac.tail1234.ts.net/ui/harness.html");
    // Its page failed to load (the machine went as it loaded): the app's page again.
    v.webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://mac.tail1234.ts.net/ui/harness.html", true);
    assert.match(decodeURIComponent(v.webContents.loads.at(-1)), /https:\/\/mac\.tail1234\.ts\.net did not load \(ERR_NAME_NOT_RESOLVED\)/);
  });

  // (fails before: yes — the remote desk of 11-22, s4c: a machine on a wire this app does not speak was offline after a
  // wait, with no word of which side to update)
  test("one on a wire this app does not speak: its update page at once, not offline after a wait; Open its page opens it there and it stays; Update this app is this app's; it opens once it speaks", async () => {
    /** @type {string[]} */
    const asked = [];
    const t = rig({ updateHere: () => void asked.push("here") });
    await t.settle();
    const gap = (/** @type {"there" | "here"} */ side) => ({ route: null, name: "Workstation", version: "0.9.40", tried: [{ url: String(BOX.routes[0].url), why: "Workstation runs Filament 0.9.40, too old for this app: update Filament on Workstation." }], update: { side, route: BOX.routes[0] } });
    t.answers["m-box"] = gap("there");
    t.r.select("m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    assert.equal(v.webContents.loads.length, 1);
    assert.match(decodeURIComponent(v.webContents.loads[0]), /<div class="title">Update Filament on Workstation<\/div><div class="line">Workstation runs Filament 0\.9\.40, too old for this app/);
    assert.equal(stateOf(v.webContents).status, "offline", "said at once, no wait");
    await t.tick();
    assert.equal(v.webContents.loads.length, 1, "the same words: not drawn again");
    // Open its page: its own harness, where it answered, which stays through the looks.
    t.r.updateOn("m-box");
    assert.deepEqual(v.webContents.loads.at(-1), "http://localhost:20310/ui/harness.html");
    await t.tick();
    assert.equal(v.webContents.loads.length, 2, "its page stays while it answers there");
    // (the review of s4c) A look that got no answer between: the page stays, and stays as it answers there again.
    t.answers["m-box"] = { route: null, name: null, version: null, tried: [{ url: String(BOX.routes[0].url), why: "no answer from http://localhost:20310 in 5 s" }] };
    await t.tick();
    t.answers["m-box"] = gap("there");
    await t.tick();
    assert.equal(v.webContents.loads.length, 2, "one missed look takes nothing away");
    t.r.updateOn("m-box");
    assert.equal(v.webContents.loads.length, 2, "its page shows: no such press there");
    // Updated: it speaks this app's wire, and its page stands where it was.
    t.answers["m-box"] = answered(BOX.routes[0]);
    await t.tick();
    assert.equal(v.webContents.loads.length, 2);
    assert.equal(stateOf(v.webContents).status, "online");
    // A wire too new for this app: its page goes for the update page, whose act is this app's update.
    t.answers["m-box"] = gap("here");
    await t.tick();
    assert.match(decodeURIComponent(v.webContents.loads.at(-1)), /<div class="title">Update this app<\/div>/);
    const loads = v.webContents.loads.length;
    t.r.updateOn("m-box");
    assert.deepEqual(asked, ["here"]);
    assert.equal(v.webContents.loads.length, loads, "nothing loads there");
    t.r.updateOn("m-mac");
    assert.deepEqual(asked, ["here"], "a view with no update page: nothing");
    // The app: the press heard from that machine's view alone; this app's update, This computer's Settings › About.
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    assert.match(main, /ipcMain\.on\("filament:machines-update", \(e\) => \{\n\s+const id = rail\?\.hearsPage\(e\.sender, e\.senderFrame\);\n\s+if \(id && id !== LOCAL_ID\) rail\?\.updateOn\(id\);\n\s+\}\);/);
    assert.match(main, /\n\s+updateHere: \(\) => void openWindow\("harness", "#\/settings\/about"\),\n/);
  });

  // (fails before: yes — the review of p3-shell: with no route answering, a page standing stayed, its harness asking on
  // at an address another machine now answers, its cookie with each ask)
  test("another machine answers at its page's address: the page goes at once, its cookie sent there no more", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[0]) } });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    // The tunnel down a moment: the page stays, its harness reconnecting by itself.
    t.answers["m-box"] = { route: null, name: null, version: null, tried: [{ url: "http://localhost:20310", why: "nothing listens at http://localhost:20310" }, { url: "https://box.tail1234.ts.net", why: "no answer" }] };
    await t.tick();
    assert.equal(v.webContents.loads.length, 1);
    // Another program took the tunnel's port, answering as another machine.
    t.answers["m-box"] = { route: null, name: null, version: null, tried: [{ url: "http://localhost:20310", why: "http://localhost:20310 is Laptop (m-other), not Workstation: nothing was sent there", wrong: true }, { url: "https://box.tail1234.ts.net", why: "no answer" }] };
    await t.tick();
    assert.match(v.webContents.loads.at(-1), /^data:text\/html/);
    assert.match(decodeURIComponent(v.webContents.loads.at(-1)), /is Laptop \(m-other\), not Workstation/);
    assert.equal(t.guarded.find((x) => x.contents === v.webContents).o.originOf(), null, "no origin its own: no permission, no stay");
    assert.equal(stateOf(v.webContents).status, "offline");
  });

  // (fails before: yes — the hunt of p3-add: a window a machine's page opened stood on at its address after another
  // machine took it, or after the page moved to another address, its cookie in it)
  test("the windows a machine's pages opened go as its page leaves their address: another machine there, its page moved, its page that did not load", async () => {
    const popup = () => ({ destroyed: false, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; }, on() {} });
    const t = rig({ answers: { "m-box": answered(BOX.routes[0]) } });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    const { o } = t.guarded.find((x) => x.contents === v.webContents);
    const wrong = popup();
    o.onChild(wrong);
    await t.tick();
    assert.equal(wrong.destroyed, false, "still answering there: it stays");
    t.answers["m-box"] = { route: null, name: null, version: null, tried: [{ url: "http://localhost:20310", why: "http://localhost:20310 is Laptop (m-other), not Workstation: nothing was sent there", wrong: true }] };
    await t.tick();
    assert.equal(wrong.destroyed, true, "another machine at its address");
    // Back where it answers, then moved to another address: the window opened at the first goes.
    t.answers["m-box"] = answered(BOX.routes[0]);
    await t.tick();
    assert.equal(o.originOf(), "http://localhost:20310");
    const moved = popup();
    o.onChild(moved);
    t.answers["m-box"] = { route: BOX.routes[1], name: null, version: null, tried: [{ url: "http://localhost:20310", why: "nothing listens at http://localhost:20310" }] };
    await t.tick();
    assert.equal(o.originOf(), "https://box.tail1234.ts.net");
    assert.equal(moved.destroyed, true, "its page moved");
    const failed = popup();
    o.onChild(failed);
    v.webContents.emit("did-fail-load", {}, -202, "ERR_CERT_AUTHORITY_INVALID", "https://box.tail1234.ts.net/ui/harness.html", true);
    assert.equal(failed.destroyed, true, "its page did not load");
  });

  // (fails before: yes — s4a: a better way back — this computer's own after the tailnet, the home network after it — was
  // no reason to move, and a page that moved lost what it kept for this tab: its drafts, its queued messages)
  test("its address stops answering and another does: moved there; a better one back: moved there once nothing is lost — no turn at work there, no hand on it of late or out of sight, no files held —; what it kept for this tab goes with it", async () => {
    let working = false;
    const kept = (/** @type {[string, string][]} */ pairs, held = "") => JSON.stringify({ held, pairs });
    // Opened over this computer's own address, its best way: its first load starts from nothing.
    const t = rig({ answers: { "m-box": answered(BOX.routes[0]) }, busy: () => working });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    const frame = (/** @type {string} */ url) => ({ url, parent: null });
    const LOCAL = "http://localhost:20310/ui/harness.html";
    const TAIL = "https://box.tail1234.ts.net/ui/harness.html";
    assert.deepEqual(v.webContents.loads, [LOCAL]);
    assert.deepEqual(t.r.carryFor(v.webContents, frame(LOCAL)), [], "its first load there: nothing carried");
    assert.equal(t.r.carryFor(v.webContents, frame(LOCAL)), null, "loaded again there: what it kept there is its own");
    await t.tick();
    assert.equal(v.webContents.loads.length, 1, "still answering there: it stays");
    // Its address closed, the tailnet's answers: moved there, what its page kept for this tab with it.
    v.webContents.storage = kept([["filament.draft", "half a thought"]]);
    const gone = { route: BOX.routes[1], name: null, version: null, tried: [{ url: "http://localhost:20310", why: "nothing listens at http://localhost:20310" }] };
    t.answers["m-box"] = gone;
    await t.tick();
    assert.deepEqual(v.webContents.loads, [LOCAL, TAIL]);
    assert.equal(t.guarded.find((x) => x.contents === v.webContents).o.originOf(), "https://box.tail1234.ts.net", "its own origin moves with it");
    assert.ok(v.webContents.isolated.length && v.webContents.isolated.every(([w]) => w > 0), "read in a world of the app's own, none of the page's scripts in it");
    assert.equal(t.r.carryFor(v.webContents, frame(LOCAL)), null, "for its page at the address it moved to alone");
    assert.equal(t.r.carryFor(t.win.webContents, frame(TAIL)), null, "for its own view alone");
    assert.equal(t.r.carryFor(v.webContents, { url: TAIL, parent: {} }), null, "for its main frame alone");
    assert.deepEqual(t.r.carryFor(v.webContents, frame(TAIL)), [["filament.draft", "half a thought"]], "handed to its page there");
    assert.equal(t.r.carryFor(v.webContents, frame(TAIL)), null, "once: loaded again there, it keeps its own");
    // Its own address back — the better way — while a turn is at work there: its own address asked too, and while it
    // answers the page stays where it is.
    working = true;
    /** @type {string[][]} */
    const asked = [];
    t.answers["m-box"] = (/** @type {any} */ m) => (asked.push(m.routes.map((r) => r.url)), answered(m.routes[0]));
    await t.tick();
    assert.equal(v.webContents.loads.length, 2);
    assert.deepEqual(asked, [["http://localhost:20310", "https://box.tail1234.ts.net"], ["https://box.tail1234.ts.net"]]);
    // The turn ended, and the person's hand on it just now — a key, a press, a scroll —: left as it is. A pointer
    // passing over it is no hand on it.
    working = false;
    for (const type of ["keyDown", "mouseDown", "mouseWheel"]) {
      t.later(TYPED_MS);
      v.webContents.emit("input-event", {}, { type });
      await t.tick();
      assert.equal(v.webContents.loads.length, 2, type);
    }
    t.later(TYPED_MS);
    v.webContents.emit("input-event", {}, { type: "mouseMove" });
    // Files attached and not sent — which no reload keeps —: left as it is, its own address answering.
    v.webContents.storage = kept([["filament.draft", "a whole thought"]], "files");
    await t.tick();
    assert.equal(v.webContents.loads.length, 2, "files held in it");
    // (fails before: yes — the review of s4a: a pane its page popped out, where the person worked, closed under them) A
    // window of its page's open, which a move closes: left as it is.
    v.webContents.storage = kept([["filament.draft", "a whole thought"]]);
    /** @type {Function[]} */
    const closing = [];
    const pane = { destroyed: false, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; }, on(/** @type {string} */ ev, /** @type {Function} */ fn) { if (ev === "closed") closing.push(fn); } };
    t.guarded.find((x) => x.contents === v.webContents).o.onChild(pane);
    await t.tick();
    assert.deepEqual([v.webContents.loads.length, pane.destroyed], [2, false], "a window of its open");
    // The files sent and the window closed: moved to the better way, what it kept with it.
    closing.forEach((fn) => fn());
    await t.tick();
    assert.equal(v.webContents.loads.at(-1), LOCAL);
    assert.deepEqual(t.r.carryFor(v.webContents, frame(LOCAL)), [["filament.draft", "a whole thought"]], "where it loaded before: what it kept since, never what that address kept then");
    // Its page cannot be read: off a way that stopped answering it moves all the same, starting from nothing there; to a
    // better way it does not.
    v.webContents.storage = null;
    t.answers["m-box"] = gone;
    await t.tick();
    assert.equal(v.webContents.loads.at(-1), TAIL);
    assert.deepEqual(t.r.carryFor(v.webContents, frame(TAIL)), [], "its move off a way that stopped answering, unread: it starts from nothing there");
    t.answers["m-box"] = (/** @type {any} */ m) => answered(m.routes[0]);
    await t.tick();
    assert.equal(v.webContents.loads.at(-1), TAIL, "unread: no move to a better way");
    // Out of sight it moves back whatever was pressed in it last.
    v.webContents.storage = kept([["filament.queue", "[]"]]);
    t.r.select(LOCAL_ID);
    v.webContents.emit("input-event", {}, { type: "keyDown" });
    await t.tick();
    assert.equal(v.webContents.loads.at(-1), LOCAL, "out of sight: moved");
    assert.deepEqual(t.r.carryFor(v.webContents, frame(LOCAL)), [["filament.queue", "[]"]]);
    // (fails before: yes — the review of s4a: what the page kept went to whoever answered at its address) Another
    // machine answers at its address: the page moves, nothing of it read or carried.
    t.r.select("m-box");
    v.webContents.storage = kept([["filament.draft", "for Workstation alone"]]);
    const reads = v.webContents.isolated.length;
    t.answers["m-box"] = { route: BOX.routes[1], name: null, version: null, tried: [{ url: "http://localhost:20310", why: "http://localhost:20310 is Laptop (m-other), not Workstation: nothing was sent there", wrong: true }] };
    await t.tick();
    assert.equal(v.webContents.loads.at(-1), TAIL);
    assert.equal(v.webContents.isolated.length, reads, "not read");
    assert.deepEqual(t.r.carryFor(v.webContents, frame(TAIL)), []);
    // (fails before: yes — the review of p3-shell: its own address behind the one that answered was never asked, and the
    // page stood on a dead address, the rail saying connected.) On the tailnet, a turn at work there, its address gone
    // and the better one answering: moved all the same — its own gone, no reason to stay.
    working = true;
    t.answers["m-box"] = (/** @type {any} */ m) => (m.routes.length === 1 ? { route: null, name: null, version: null, tried: [{ url: m.routes[0].url, why: "no answer" }] } : answered(m.routes[0]));
    await t.tick();
    assert.equal(v.webContents.loads.at(-1), LOCAL);
  });

  test("a page as it is read: whether it holds files, its keys and values, strings each, within a bound; anything else none", () => {
    assert.deepEqual(pageKept(JSON.stringify({ held: "", pairs: [["a", "1"], ["b", ""]] })), { held: false, pairs: [["a", "1"], ["b", ""]] });
    assert.deepEqual(pageKept(JSON.stringify({ held: "files", pairs: [] })), { held: true, pairs: [] });
    for (const bad of [null, 7, "not json", JSON.stringify([["a", "1"]]), JSON.stringify({ pairs: [] }), JSON.stringify({ held: "", pairs: [["a"]] }), JSON.stringify({ held: "", pairs: [["a", 1]] }), JSON.stringify({ held: "", pairs: [["a", "x".repeat(CARRY_MAX)]] })])
      assert.equal(pageKept(bad), null, String(bad).slice(0, 40));
  });

  // (fails before: yes — the review of s4a: a message queued in the second before the read was written to the tab after
  // it, and not carried)
  test("a page read: its queues written first, at once — the harness hears it —, then what it holds and its storage", () => {
    const store = new Map([["filament.draft", "a"]]);
    const page = {
      Event: class {
        /** @param {string} type */
        constructor(type) {
          this.type = type;
        }
      },
      dispatchEvent: (/** @type {any} */ e) => (e.type === "filament:keep" && store.set("filament.queue", "[1]"), true),
      document: { documentElement: { dataset: { filamentHeld: "files" } } },
      sessionStorage: { get length() { return store.size; }, key: (/** @type {number} */ i) => [...store.keys()][i], getItem: (/** @type {string} */ k) => store.get(k) ?? null },
    };
    assert.deepEqual(pageKept(vm.runInNewContext(READ_PAGE, page)), { held: true, pairs: [["filament.draft", "a"], ["filament.queue", "[1]"]] });
    assert.match(readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8"), /\naddEventListener\("filament:keep", \(\) => keepQueues\(true\)\);\n/);
  });

  test("Ctrl+1..9 from any page of the window shows that slot's machine; other keys are the page's", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) } });
    await t.settle();
    const press = (/** @type {any} */ wc, /** @type {any} */ input) => {
      const e = { prevented: false, preventDefault() { this.prevented = true; } };
      wc.emit("before-input-event", e, { type: "keyDown", control: true, ...input });
      return e.prevented;
    };
    assert.equal(press(t.win.webContents, { key: "2", code: "Digit2" }), true);
    assert.equal(t.r.active(), "m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    assert.equal(press(v.webContents, { key: "1", code: "Digit1" }), true, "from that machine's page too");
    assert.equal(t.r.active(), LOCAL_ID);
    t.r.openPop(LOCAL_ID, { x: 10, y: 10, width: 100, height: 28 });
    assert.equal(press(t.railView().webContents, { key: "&", code: "Digit3" }), true, "a French keyboard's Ctrl+1..9, from the popover too");
    assert.equal(t.r.active(), "m-mac");
    assert.equal(t.railView().visible, false, "the popover gone with the page it was opened over");
    assert.equal(press(t.win.webContents, { key: "9", code: "Digit9" }), false, "an empty slot: the page's");
    assert.equal(press(t.win.webContents, { key: "2", code: "Digit2", shift: true }), false);
    assert.equal(t.r.active(), "m-mac");
    // (fails before: yes — the hunt of p3-add: the agent's browser placed in the window took Ctrl+1..9 as its page's)
    const e = { prevented: false, preventDefault() { this.prevented = true; } };
    t.r.keys(e, { type: "keyDown", control: true, key: "1", code: "Digit1" });
    assert.deepEqual([e.prevented, t.r.active()], [true, LOCAL_ID], "a key another page of the window heard");
  });

  test("a machine removed: its view closed, this computer shown; the last one gone: the chip hidden, no looks", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) } });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    t.setList([localMachine(ORIGIN), MAC]);
    t.win.emit("focus");
    assert.equal(v.webContents.closed, true);
    assert.ok(!t.win.children.includes(v));
    assert.equal(t.r.active(), LOCAL_ID);
    t.setList([localMachine(ORIGIN)]);
    t.r.refresh();
    await t.settle();
    assert.equal(stateOf(t.win.webContents).shown, false);
    assert.equal(t.ticks.length, 0);
    assert.equal(t.r.select("m-mac"), false);
  });

  // (fails before: yes — the owner's of 11-08: no room was lent to another machine's page)
  test("the room lent to another machine's page: This computer's page's word on it at its zoom, in the machine's page's own pixels; again as a zoom moves; none in full screen", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) }, platform: "darwin", zoom: 1.25 });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    assert.deepEqual(stateOf(v.webContents).frame, { left: MAC_LEFT, right: 0 }, "nothing said yet: a Mac's own");
    t.r.frameArea({ left: 80, right: 0 });
    assert.deepEqual(stateOf(v.webContents).frame, { left: 100, right: 0 }, "said in This computer's page's pixels at its zoom: 80 × 1.25");
    v.webContents.zoom = 2;
    t.r.zoomed();
    assert.deepEqual(stateOf(v.webContents).frame, { left: 50, right: 0 }, "in the machine's page's own pixels");
    t.r.frameArea({ left: "x", right: 1e9 });
    assert.deepEqual(stateOf(v.webContents).frame, { left: 0, right: 1250 }, "a word that is no number: none; one past any window: held");
    t.win.full = true;
    t.win.emit("enter-full-screen");
    assert.equal(stateOf(v.webContents).frame, null, "full screen: none");
    assert.equal(stateOf(t.win.webContents).frame, null, "This computer's page reads its own");
  });

  // (fails before: yes — the owner's Mac of 11-08: another machine's Chat, Agents and Plan took no press, its title only at
  // its left edge: a Mac's window takes a press on a view as a drag where the page under it drags, Electron #28057)
  test("a Mac: while another machine's page, the popover or the Add sheet lies over This computer's page, its drag regions are off; on again with nothing over it, and put back after its page loads anew", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) }, platform: "darwin", inserts: ["", "", "", "", "refuse"] });
    await t.settle();
    const page = t.win.webContents;
    assert.deepEqual(page.css, [], "nothing over it: as it is");
    t.r.select("m-box");
    await t.settle();
    assert.deepEqual(page.css, [UNDRAG_CSS], "another machine's page over it");
    assert.match(UNDRAG_CSS, /^\*, \*::before, \*::after \{ -webkit-app-region: no-drag !important; \}$/);
    t.r.select(LOCAL_ID);
    await t.settle();
    assert.deepEqual(page.removed, ["key-1"], "This computer's page shown: its own again");
    t.r.openAdd();
    await t.settle();
    assert.equal(page.css.length, 2, "the Add sheet over it");
    t.r.closeAdd();
    await t.settle();
    assert.deepEqual(page.removed, ["key-1", "key-2"]);
    t.r.select("m-box");
    await t.settle();
    t.r.openPop("m-box", { x: 600, y: 4, width: 120, height: 30 });
    await t.settle();
    assert.equal(page.css.length, 3, "the popover over the machine's page: still the one");
    // Its page loaded anew under the machine's: the CSS is put in again, and the one put in before taken out — it may
    // have landed in the new page before its dom-ready, and would stay once nothing covers it (the review of 11-09).
    page.emit("dom-ready");
    await t.settle();
    assert.equal(page.css.length, 4);
    assert.deepEqual(page.removed, ["key-1", "key-2", "key-3"], "the one before taken out");
    t.r.pick(LOCAL_ID);
    await t.settle();
    assert.deepEqual(page.removed, ["key-1", "key-2", "key-3", "key-4"], "the CSS in now taken out");
    // One its page refused: nothing to take out, nothing thrown.
    t.r.select("m-box");
    await t.settle();
    t.r.select(LOCAL_ID);
    await t.settle();
    assert.equal(page.css.length, 5);
    assert.deepEqual(page.removed, ["key-1", "key-2", "key-3", "key-4"]);

  });

  // (fails before: yes — the owner's of 11-09: in Windows' window the Mac's Settings gear and machine chip took no press;
  // its hit test asks This computer's page's drag regions first, whatever view lies over it)
  test("Windows and Linux: while another machine's page or the Add sheet lies over This computer's page, its drag regions are off too; on again with nothing over it", async () => {
    for (const platform of ["win32", "linux"]) {
      const w = rig({ answers: { "m-box": answered(BOX.routes[1]) }, platform });
      await w.settle();
      const page = w.win.webContents;
      assert.deepEqual(page.css, [], `${platform}: nothing over it, as it is`);
      w.r.select("m-box");
      await w.settle();
      assert.deepEqual(page.css, [UNDRAG_CSS], `${platform}: another machine's page over it`);
      w.r.select(LOCAL_ID);
      await w.settle();
      assert.deepEqual(page.removed, ["key-1"], `${platform}: This computer's page shown, its own again`);
      w.r.openAdd();
      await w.settle();
      assert.equal(page.css.length, 2, `${platform}: the Add sheet over it`);
    }
  });

  // (fails before: yes — the owner's MacBook of 11-09 stayed "192.168.0.77" in the window, the name it paired with)
  test("a machine answering by another name is kept by it, once; one that answers by its kept name, by none, or not at all is left as it is", async () => {
    /** @type {string[][]} */
    const renamed = [];
    /** @type {any} */
    let t = null;
    const keep = {
      add: (/** @type {any} */ m) => m,
      remove: () => false,
      rename: (/** @type {string} */ id, /** @type {string} */ name) => {
        renamed.push([id, name]);
        const got = { ...BOX, name };
        t.setList([localMachine(ORIGIN), got, MAC]);
        return got;
      },
    };
    t = rig({ keep, answers: { "m-box": { route: BOX.routes[1], name: "  Kai’s MacBook Air ", version: "0.9.70", tried: [] }, "m-mac": { route: MAC.routes[0], name: "Mac mini", version: "0.9.70", tried: [] } } });
    await t.settle();
    assert.deepEqual(renamed, [["m-box", "Kai’s MacBook Air"]], "the Mac mini answers by its own: nothing");
    await t.tick();
    assert.equal(renamed.length, 1, "kept by it: not again");
    t.answers["m-box"] = answered(BOX.routes[1]);
    t.answers["m-mac"] = { route: null, name: "Elsewhere", version: null, tried: [{ url: MAC.routes[0].url, why: "nothing listens" }] };
    await t.tick();
    assert.equal(renamed.length, 1, "no name, or no answer: as it is");

    // (fails before: yes — the review of 11-09: kept as it came, a name past 64 with a space at the cut was another on
    // each look, and a bidi control or a line break went into the menus)
    t.answers["m-box"] = { route: BOX.routes[1], name: `‮${"a".repeat(63)}
 b-tail`, version: "0.9.70", tried: [] };
    await t.tick();
    assert.deepEqual(renamed.at(-1), ["m-box", "a".repeat(63)], "cleaned as a pairing cleans it: the control gone, the cut's space with it");
    await t.tick();
    assert.equal(renamed.length, 2, "the name kept is the one compared: once");
  });

  // (fails before: yes — the review of 11-09: a machines file that could not be written threw out of the ask, and the
  // machine's page never opened)
  test("a new name the machines file cannot keep holds no page from opening, and is not tried again on each look", async () => {
    let tries = 0;
    const keep = { add: (/** @type {any} */ m) => m, remove: () => false, rename: () => { tries++; throw new Error("EPERM: operation not permitted, rename"); } };
    const t = rig({ keep });
    await t.settle();
    assert.equal(tries, 0, "no answer yet: nothing to keep");
    t.answers["m-box"] = { route: BOX.routes[1], name: "Kai’s MacBook Air", version: "0.9.70", tried: [] };
    t.r.select("m-box");
    await t.settle();
    assert.equal(tries, 1, "the ask that opens its page met the new name");
    const v = t.viewOf("persist:machine-m-box");
    assert.equal(v?.webContents.loads.length, 1, "its page opened all the same");
    await t.tick();
    assert.equal(tries, 1, "the same name: not tried again");
    t.answers["m-box"] = { route: BOX.routes[1], name: "Studio", version: "0.9.70", tried: [] };
    await t.tick();
    assert.equal(tries, 2, "another name: tried");
  });

  test("the View menu's zoom: the roles' keys, the focused page zoomed by half a level or back to its own size, and the rail told after", () => {
    let level = 0;
    let told = 0;
    /** @type {any} */
    let page = { isDestroyed: () => false, getZoomLevel: () => level, setZoomLevel: (/** @type {number} */ l) => void (level = l) };
    const rows = zoomRows({ page: () => page, zoomed: () => void told++ });
    assert.deepEqual(rows.map((r) => [r.label, r.accelerator]), [["Actual Size", "CommandOrControl+0"], ["Zoom In", "CommandOrControl+Plus"], ["Zoom Out", "CommandOrControl+-"]]);
    rows[1].click();
    rows[1].click();
    assert.deepEqual([level, told], [1, 2]);
    rows[2].click();
    assert.deepEqual([level, told], [0.5, 3]);
    rows[0].click();
    assert.deepEqual([level, told], [0, 4]);
    page = null;
    rows[1].click();
    assert.equal(told, 4, "no page focused: nothing");
  });

  // (fails before: yes — the review of p3-shell: a removed machine's windows lived on, its cookie in them)
  test("the windows a machine's pages opened go with it", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) } });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    const popup = () => ({ destroyed: false, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; }, on() {} });
    const a = popup();
    const b = popup();
    const { o } = t.guarded.find((x) => x.contents === v.webContents);
    o.onChild(a);
    o.onChild(b);
    t.setList([localMachine(ORIGIN), MAC]);
    t.r.refresh();
    assert.deepEqual([a.destroyed, b.destroyed], [true, true]);
  });

  test("the browser page placed after it goes under the machine showing, and under the app's page while the popover shows; the window closed: every view closed", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) } });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const page = { webContents: fakeContents() };
    t.win.contentView.addChildView(page);
    t.r.raise();
    assert.equal(t.win.children.at(-1), t.viewOf("persist:machine-m-box"));
    t.r.openPop("m-box", { x: 1, y: 1, width: 1, height: 1 });
    t.win.contentView.addChildView(page);
    t.r.raise();
    assert.deepEqual(t.win.children.slice(-2), [t.viewOf("persist:machine-m-box"), t.railView()]);
    t.win.emit("closed");
    assert.ok(t.views.every((v) => v.webContents.closed));
    assert.equal(t.r.select(LOCAL_ID), false);
  });

  // (fails before: yes — the owner's of 11-08: a popover of machines under a chip in the rail's place)
  test("the popover: opened from the page showing alone, under its chip at its zoom, over everything with the keys; picked, that machine shown; Escape, a resize, the window left close it", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) }, zoom: 1.5 });
    await t.settle();
    assert.equal(t.r.openPop("m-box", { x: 1, y: 1, width: 1, height: 1 }), false, "a page behind the one showing: no");
    assert.equal(t.railView(), undefined);
    assert.equal(t.r.openPop(LOCAL_ID, { x: 800, y: 10, width: 100, height: 28 }), true);
    const pop = t.railView();
    assert.deepEqual(pop.prefs, { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: RAIL_PRELOAD });
    assert.deepEqual(pop.webContents.loads, ["file:///H:/webshop/desktop/rail.html"]);
    assert.deepEqual(pop.bounds, { x: 0, y: 0, width: 1440, height: 920 });
    assert.equal(pop.visible, true);
    assert.equal(t.win.children.at(-1), pop);
    assert.ok(pop.webContents.focused > 0, "its keys");
    const s = pop.webContents.sent.at(-1);
    assert.equal(s[0], "filament:rail-state");
    assert.deepEqual(s[1].at, { x: 1200, y: 15, width: 150, height: 42 }, "the chip's rectangle in the window's units: its page at 1.5");
    assert.match(s[1].list, /data-machine="m-box"/);
    assert.equal(stateOf(t.win.webContents).open, true, "the chip says its popover is open");
    // Its page asks nothing else of the app: no navigation, no window; heard from its own page alone.
    const e = { prevented: false, preventDefault() { this.prevented = true; } };
    pop.webContents.emit("will-navigate", e, "https://elsewhere.example");
    assert.ok(e.prevented);
    assert.deepEqual(pop.webContents.opener(), { action: "deny" });
    assert.ok(t.r.hears(pop.webContents, "file:///H:/webshop/desktop/rail.html"));
    assert.ok(!t.r.hears(pop.webContents, "https://evil.example/"), "another page in its view: not heard");
    assert.ok(!t.r.hears(t.win.webContents, "file:///H:/webshop/desktop/rail.html"), "another view: not heard");
    // A pick: closed, that machine shown, the keys its.
    assert.equal(t.r.pick("m-box"), true);
    await t.settle();
    assert.equal(pop.visible, false);
    assert.equal(t.r.active(), "m-box");
    const v = t.viewOf("persist:machine-m-box");
    assert.equal(t.win.children.at(-1), v);
    assert.equal(stateOf(t.win.webContents).open, false);
    // Opened from that machine's page, and closed: Escape (its page's close), a resize, the window left — the keys back
    // to the page under it, but not as the window is left.
    for (const [close, refocus] of /** @type {[() => void, boolean][]} */ ([[() => t.r.closePop(), true], [() => t.win.emit("resize"), true], [() => t.win.emit("blur"), false]])) {
      assert.equal(t.r.openPop("m-box", { x: 10, y: 10, width: 10, height: 10 }), true);
      assert.equal(stateOf(v.webContents).open, true);
      const keys = v.webContents.focused;
      close();
      assert.equal(pop.visible, false);
      assert.equal(stateOf(v.webContents).open, false);
      assert.equal(v.webContents.focused > keys, refocus);
    }
    // Its view kept behind This computer's page: its chip opens nothing.
    t.r.select(LOCAL_ID);
    assert.equal(t.r.openPop("m-box", { x: 10, y: 10, width: 10, height: 10 }), false, "a view behind the page showing: no");
    assert.equal(pop.visible, false);
    t.r.select("m-box");
    // The machine showing picked: closed, nothing else.
    t.r.openPop("m-box", { x: 10, y: 10, width: 10, height: 10 });
    t.r.pick("m-box");
    assert.deepEqual([pop.visible, t.r.active()], [false, "m-box"]);
    // The Add sheet from it: the popover gone, the sheet over the window.
    t.r.openPop("m-box", { x: 10, y: 10, width: 10, height: 10 });
    t.r.openAdd();
    assert.deepEqual([pop.visible, pop.webContents.sent.at(-1)[1].adding, pop.webContents.sent.at(-1)[1].at], [true, true, null]);
    assert.equal(t.r.openPop("m-box", { x: 1, y: 1, width: 1, height: 1 }), false, "not over the sheet");
  });

  // (fails before: yes — the owner's of 11-08)
  test("a chip's word heard from This computer's page and the machines' views' main frames alone, each as its machine", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) } });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    assert.equal(t.r.hearsPage(t.win.webContents, { parent: null }), LOCAL_ID);
    assert.equal(t.r.hearsPage(v.webContents, { parent: null }), "m-box");
    assert.equal(t.r.hearsPage(v.webContents, { parent: {} }), null, "a frame inside it: not its page");
    assert.equal(t.r.hearsPage(fakeContents(), null), null);
    t.r.openPop("m-box", { x: 1, y: 1, width: 1, height: 1 });
    assert.equal(t.r.hearsPage(t.railView().webContents, null), null, "the app's own page: no chip of its own");
  });

  // (fails before: yes — the owner's of 11-08: the controls kept This computer's colours over another machine's page)
  test("the window's controls wear the colours of the page showing: another machine's as it asked, This computer's again as it shows", async () => {
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) } });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    assert.deepEqual(t.tinted, [], "nothing asked yet: as they were");
    t.r.tintFrom("m-box", { color: "#FAFAFA", symbolColor: "#111111" });
    assert.deepEqual(t.tinted, [{ color: "#fafafa", symbolColor: "#111111" }]);
    t.r.tintFrom("m-box", { color: "red", symbolColor: "#111111" });
    t.r.tintFrom(LOCAL_ID, { color: "#000000", symbolColor: "#111111" });
    t.r.tintFrom("m-mac", { color: "#000000", symbolColor: "#111111" });
    assert.equal(t.tinted.length, 1, "two #rrggbb alone, from a machine's view alone");
    t.r.select(LOCAL_ID);
    assert.equal(t.tinted.at(-1), null, "This computer's own again");
    t.r.select("m-box");
    assert.deepEqual(t.tinted.at(-1), { color: "#fafafa", symbolColor: "#111111" });
    // A machine whose page has asked nothing — what came for it before its view was is not kept: This computer's.
    t.r.select("m-mac");
    assert.equal(t.tinted.at(-1), null);
    // One removed and added again: its new page wears nothing its old one asked.
    t.setList([localMachine(ORIGIN), MAC]);
    t.r.refresh();
    t.setList([localMachine(ORIGIN), BOX, MAC]);
    t.r.refresh();
    t.r.select("m-box");
    assert.equal(t.tinted.at(-1), null);
  });
});

describe("adding a machine", () => {
  const PIN = Array.from({ length: 32 }, () => "AA").join(":");
  const BOXC = { ok: true, url: "https://192.168.0.9:20343", code: "ABCD-EFGH", fingerprint: PIN, route: { kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PIN }, machine: { id: "M-New", name: "Studio", version: "0.9.0" } };
  // (fails before: yes — the rail had no way to add a machine)
  test("the sheet: over the whole window and everything in it, another machine kept or not yet; closed, the window as it was", async () => {
    const t = rig({ kept: [] });
    await t.settle();
    t.r.openAdd();
    const rail = t.railView();
    assert.ok(rail, "the app's page is made for the sheet");
    assert.deepEqual(rail.bounds, { x: 0, y: 0, width: 1440, height: 920 });
    assert.equal(rail.visible, true);
    assert.equal(t.win.children.at(-1), rail, "over everything");
    assert.ok(rail.webContents.focused > 0, "the sheet takes the keys");
    const s = rail.webContents.sent.at(-1)[1];
    assert.equal(s.adding, true);
    assert.equal(s.at, null, "no popover under it");
    assert.deepEqual(t.win.webContents.css, [UNDRAG_CSS], "this computer's page drags nowhere under it: the sheet's top row drags");
    t.r.closeAdd();
    assert.equal(rail.visible, false);
    assert.equal(rail.webContents.sent.at(-1)[1].adding, false);
    await t.settle();
    assert.deepEqual(t.win.webContents.removed, ["key-1"], "closed: this computer's page as it was");

    const k = rig();
    await k.settle();
    k.r.select("m-box");
    await k.settle();
    k.r.openAdd();
    assert.deepEqual(k.win.children.slice(-2), [k.viewOf("persist:machine-m-box"), k.railView()], "over the machine showing too");
    const st = k.railView().webContents.sent.at(-1)[1];
    assert.match(st.list, /data-add=""><svg[^]*Add a machine…/, "the popover's last item opens it");
    k.r.closeAdd();
    assert.equal(k.win.children.at(-1), k.viewOf("persist:machine-m-box"));
    assert.equal(k.railView().visible, false);
  });

  test("check: who answers, said to the sheet — nothing made, nothing kept", async () => {
    /** @type {any[]} */
    const kept = [];
    const t = rig({ kept: [], check: async () => BOXC, keep: { add: (m) => (kept.push(m), m), remove: () => false } });
    await t.settle();
    t.r.openAdd();
    const got = await t.r.add({ op: "check", link: "192.168.0.9:20343" });
    assert.deepEqual(got, { ok: true, id: "m-new", url: BOXC.url, name: "Studio", fingerprint: PIN, kept: false, code: true });
    assert.equal(t.views.filter((v) => v.prefs.partition).length, 0);
    assert.deepEqual(kept, []);
    const asked = await rig({ kept: [], check: async () => ({ ok: false, ask: "fingerprint", url: BOXC.url, seen: "CC:DD", words: "compare" }) }).r.add({ op: "pair", link: "x" });
    assert.equal(asked.ask, "fingerprint", "a pair whose certificate is not yet said the same stops there");
  });

  test("pair: claimed from a page of that machine in its own partition, its certificate the new one meanwhile; then kept, shown, the sheet closed", async () => {
    /** @type {any[]} */
    const kept = [];
    const t = rig({
      kept: [],
      check: async () => BOXC,
      // Kept: the machines file now lists it, as lib/machines.js writes it.
      keep: {
        add: (/** @type {any} */ m) => {
          kept.push(m);
          const k = machine(m.id, m.name, m.routes);
          t.setList([localMachine(ORIGIN), k]);
          return k;
        },
        remove: () => false,
      },
      claim: async () => ({ status: 200, body: { machine: { id: "m-new" } } }),
    });
    await t.settle();
    t.r.openAdd();
    const v = /** @type {Promise<any>} */ (t.r.add({ op: "pair", link: "192.168.0.9:20343" }));
    await t.settle();
    const view = t.viewOf("persist:machine-m-new");
    assert.ok(view, "its view, in its own partition");
    assert.equal(view.prefs.preload, MACHINE_PRELOAD, "of the app's bridges its one alone");
    assert.equal(view.webContents.loads[0], "https://192.168.0.9:20343/.well-known/filament");
    assert.ok(t.sessions["persist:machine-m-new"].sets >= 1, "its partition's certificate check set before its page loads");
    const got = await v;
    assert.deepEqual(got, { ok: true, name: "Studio" });
    assert.equal(view.webContents.scripts.length, 1);
    assert.match(view.webContents.scripts[0], /^fetch\("\/api\/remote\/claim"/);
    assert.match(view.webContents.scripts[0], /ABCD-EFGH/);
    assert.deepEqual(kept, [{ id: "m-new", name: "Studio", routes: [BOXC.route], partition: "persist:machine-m-new" }]);
    assert.equal(view.webContents.loads.at(-1), "https://192.168.0.9:20343/ui/harness.html", "its harness opened");
    assert.equal(t.r.active(), "m-new", "shown");
    const s = t.railView().webContents.sent.at(-1)[1];
    assert.equal(s.adding, false, "the sheet closed");
    assert.equal(stateOf(view.webContents).shown, true, "its chip stands");
    assert.ok(t.ticks.length > 0, "and is looked at");
  });

  // (fails before: yes — no SSH route)
  test("through an SSH tunnel: kept with no code and no claim — ssh's sign-in let this computer in —, its harness opened with its alias, shown, the sheet closed", async () => {
    const route = { kind: "ssh", url: "http://127.0.0.1:5555", alias: "filtest", port: 20300 };
    const SSHC = { ok: true, url: route.url, code: "", fingerprint: "", route, machine: { id: "m-new", name: "Studio", version: "" }, ssh: "filtest" };
    /** @type {any[]} */
    const kept = [];
    const t = rig({
      kept: [],
      check: async () => SSHC,
      keep: {
        add: (/** @type {any} */ m) => {
          kept.push(m);
          const k = machine(m.id, m.name, m.routes);
          t.setList([localMachine(ORIGIN), k]);
          return k;
        },
        remove: () => false,
      },
      claim: async () => assert.fail("no claim through a tunnel"),
    });
    await t.settle();
    t.r.openAdd();
    assert.deepEqual(await t.r.add({ op: "check", link: "ssh://filtest" }), { ok: true, id: "m-new", url: route.url, name: "Studio", fingerprint: "", kept: false, code: false, ssh: "filtest" });
    assert.deepEqual(kept, [], "Continue keeps nothing");
    const got = await t.r.add({ op: "pair", link: "ssh://filtest", code: "", expect: "m-new" });
    assert.deepEqual(got, { ok: true, name: "Studio" });
    assert.deepEqual(kept, [{ id: "m-new", name: "Studio", routes: [route], partition: "persist:machine-m-new" }]);
    const view = t.viewOf("persist:machine-m-new");
    assert.deepEqual(view.webContents.loads, ["http://127.0.0.1:5555/ui/harness.html?ssh=filtest"], "its harness and nothing else: no claim's page");
    assert.equal(view.webContents.scripts.length, 0, "no claim run");
    assert.equal(t.r.active(), "m-new", "shown");
    assert.equal(t.railView().webContents.sent.at(-1)[1].adding, false, "the sheet closed");
    const again = rig({ kept: [], check: async () => SSHC, keep: { add: () => { throw new Error("the machines file is not writable"); }, remove: () => false } });
    assert.deepEqual(await again.r.add({ op: "pair", link: "ssh://filtest" }), { ok: false, words: "Not kept: the machines file is not writable" });
    const moved = rig({ kept: [], check: async () => SSHC });
    assert.match((await moved.r.add({ op: "pair", link: "ssh://filtest", expect: "m-old" })).words, /^Another machine answers at http:\/\/127\.0\.0\.1:5555 now — Studio —/, "Add goes to the machine Continue showed alone");
  });

  // (fails before: yes — the review of 5739eb5b1: the rail painted once every machine had answered, so an SSH host that is down held every machine's state back for its ssh's whole wait)
  test("a look paints each machine as it answers: one slow to answer holds no other's state back", async () => {
    /** @type {Function[]} */
    const later = [];
    const t = rig({ kept: [BOX, MAC], answers: { "m-box": answered(BOX.routes[0]), "m-mac": () => new Promise((r) => later.push(r)) } });
    await t.settle();
    assert.ok(later.length >= 1, "the Mac's ask still on its way");
    t.r.openPop(LOCAL_ID, { x: 1, y: 1, width: 1, height: 1 });
    const list = String(t.railView().webContents.sent.at(-1)[1].list);
    assert.match(list, /class="row s-online" role="none"><button [^>]*data-machine="m-box"/, "the one that answered: painted already");
    for (const r of later) r({ route: null, name: null, version: null, tried: [{ url: MAC.routes[0].url, why: "ssh to mac did not come up" }] });
    await t.settle();
    assert.match(String(t.railView().webContents.sent.at(-1)[1].list), /class="row s-reconnecting" role="none"><button [^>]*data-machine="m-mac"/);
  });

  test("through an SSH tunnel, a machine kept already: the partition it had, the SSH way first; a look from before never loads its old way over it", async () => {
    const lanWay = { kind: "url", url: "https://box.tail1234.ts.net" };
    const had = { ...machine("m-box", "Workstation", [lanWay]), partition: "persist:machine-m-box.2" };
    const route = { kind: "ssh", url: "http://127.0.0.1:5555", alias: "filtest", port: 20300 };
    /** @type {Function[]} */
    const later = [];
    /** @type {any[]} */
    const kept = [];
    const t = rig({
      kept: [had],
      answers: { "m-box": () => new Promise((r) => later.push(r)) },
      check: async () => ({ ok: true, url: route.url, code: "", fingerprint: "", route, machine: { id: "m-box", name: "Workstation", version: "" }, ssh: "filtest" }),
      keep: {
        add: (/** @type {any} */ m) => {
          kept.push(m);
          const k = { ...machine(m.id, m.name, [route, lanWay]), partition: m.partition };
          t.setList([localMachine(ORIGIN), k]);
          return k;
        },
        remove: () => false,
      },
    });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    assert.ok(later.length >= 1, "its view opening: an ask on its way");
    assert.deepEqual(await t.r.add({ op: "pair", link: "ssh://filtest" }), { ok: true, name: "Workstation" });
    assert.equal(kept[0].partition, "persist:machine-m-box.2", "the partition it had");
    const view = t.viewOf("persist:machine-m-box.2");
    assert.equal(view.webContents.loads.at(-1), "http://127.0.0.1:5555/ui/harness.html?ssh=filtest");
    for (const r of later) r(answered(lanWay));
    await t.settle();
    assert.equal(view.webContents.loads.at(-1), "http://127.0.0.1:5555/ui/harness.html?ssh=filtest", "the ask from before moved nothing");
  });

  test("a claim refused: the words to the sheet, nothing kept, a new machine's view gone; one kept already opens again where it is", async () => {
    /** @type {any[]} */
    const kept = [];
    const t = rig({ kept: [], check: async () => BOXC, keep: { add: (m) => (kept.push(m), m), remove: () => false }, claim: async () => ({ status: 403, body: { error: "no" } }) });
    await t.settle();
    t.r.openAdd();
    const got = await t.r.add({ op: "pair", link: "x" });
    assert.equal(got.ok, false);
    assert.match(got.words, /That code is wrong or has run out\. Make a new one on Studio/);
    assert.deepEqual(kept, []);
    assert.ok(t.viewOf("persist:machine-m-new").webContents.closed);
    assert.equal(t.railView().webContents.sent.at(-1)[1].adding, true, "the sheet stays, for another code");

    const again = { ...BOXC, machine: { id: "m-box", name: "Workstation", version: "" } };
    const k = rig({ check: async () => again, claim: async () => { throw new Error("the page went"); }, answers: { "m-box": answered(BOX.routes[1]) } });
    await k.settle();
    k.r.select("m-box");
    await k.settle();
    const box = k.viewOf("persist:machine-m-box");
    const said = await k.r.add({ op: "pair", link: "x" });
    assert.match(said.words, /Not paired: https:\/\/192\.168\.0\.9:20343 did not answer as Workstation \(the page went\)/);
    await k.settle();
    assert.equal(box.webContents.closed, false, "a machine kept keeps its view");
    assert.equal(box.webContents.loads.at(-1), harnessAt(BOX.routes[1]), "and opens again where it answers");
  });

  test("a machine kept, paired again: its new way first while the claim is made, its certificate checked by it", async () => {
    const pinned = { ...BOXC, machine: { id: "m-box", name: "Workstation", version: "" } };
    /** @type {() => void} */
    let answer = () => {};
    /** @type {any[]} */
    const kept = [];
    const k = rig({
      check: async () => pinned,
      // The claim answers once the test has looked at the certificate check meanwhile.
      claim: () => new Promise((r) => (answer = () => r({ status: 200, body: { machine: { id: "m-box" } } }))),
      keep: { add: (/** @type {any} */ m) => (kept.push(m), m), remove: () => false },
    });
    await k.settle();
    assert.equal((await k.r.add({ op: "check", link: "x" })).kept, true, "the sheet says it is in this window already");
    const p = k.r.add({ op: "pair", link: "x" });
    await k.settle();
    const verify = k.sessions["persist:machine-m-box"].verify;
    const verdict = (/** @type {string} */ hostname) => {
      let n = 0;
      verify({ hostname, certificate: { data: "not a certificate" } }, (/** @type {number} */ x) => (n = x));
      return n;
    };
    assert.equal(verdict("192.168.0.9"), -2, "the host the new way names is pinned while the claim is made");
    assert.equal(verdict("box.tail1234.ts.net"), -3, "its other ways as they were");
    answer();
    assert.deepEqual(await p, { ok: true, name: "Workstation" });
    assert.deepEqual(kept, [{ id: "m-box", name: "Workstation", routes: [pinned.route], partition: "persist:machine-m-box" }], "kept: lib/machines.js puts the new way first, the old ones after; reached at another host before, its partition the one it had");
    assert.match(k.viewOf("persist:machine-m-box").webContents.scripts[0], /^fetch\("\/api\/remote\/sign-out",\{method:"POST"/, "this window's old device signed out there first");
  });

  // Chromium keeps each certificate's verdict for its partition's life — a refusal and an old yes alike — and no call of
  // Electron's forgets it (measured on Electron 45: closeAllConnections, the check set again or to null, clearCache,
  // setSSLConfig, clearHostResolverCache; another partition asks afresh).
  // (fails before: yes — the pairing was made in the partition that kept the refusal: ERR_FAILED in the drive)
  test("paired again with a certificate it was never paired with: a partition anew, this window's sign-in carried there; the one it left cleared", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-rail-add-"));
    made.push(dir);
    const first = lanIdentity(join(dir, "first"), { name: "Workstation" });
    const second = lanIdentity(join(dir, "second"), { name: "Workstation" });
    const url = "https://192.168.0.9:20343";
    const lan = (/** @type {string} */ fingerprint) => machine("m-box", "Workstation", [{ kind: "lan", url, fingerprint }]);
    /** @type {(x: any) => void} */
    let answer = () => {};
    /** @type {any[]} */
    const kept = [];
    const t = rig({
      kept: [lan(first.fingerprint)],
      answers: { "m-box": answered({ kind: "lan", url, fingerprint: first.fingerprint }) },
      check: async () => ({ ok: true, url, code: "ABCD-EFGH", fingerprint: second.fingerprint, route: { kind: "lan", url, fingerprint: second.fingerprint }, machine: { id: "m-box", name: "Workstation", version: "" } }),
      claim: () => new Promise((r) => (answer = r)),
      keep: {
        add: (/** @type {any} */ m) => {
          kept.push(m);
          const k = { ...machine(m.id, m.name, m.routes), partition: m.partition };
          t.setList([localMachine(ORIGIN), k]);
          return k;
        },
        remove: () => false,
      },
    });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const old = t.sessions["persist:machine-m-box"];
    old.cookies.jar = [{ name: "__Host-filament-device", value: "the-old-sign-in", path: "/", secure: true, httpOnly: true, sameSite: "strict" }];
    const verdict = (/** @type {any} */ ses, /** @type {string} */ data) => {
      let n = 1;
      ses.verify({ hostname: "192.168.0.9", certificate: { data } }, (/** @type {number} */ x) => (n = x));
      return n;
    };
    const p = t.r.add({ op: "pair", link: "x" });
    await t.settle();
    const fresh = t.sessions["persist:machine-m-box.1"];
    assert.ok(fresh, "a partition anew");
    const view = t.viewOf("persist:machine-m-box.1");
    assert.equal(view.webContents.loads[0], `${url}/.well-known/filament`, "the claim made there");
    assert.ok(t.viewOf("persist:machine-m-box").webContents.closed, "the view in the partition it had closed");
    assert.deepEqual(fresh.cookies.jar.map((/** @type {any} */ k) => [k.url, k.name, k.value, k.secure, k.httpOnly]), [[url, "__Host-filament-device", "the-old-sign-in", true, true]], "this window's sign-in carried, for the claim to sign it out");
    assert.deepEqual([verdict(fresh, first.cert), verdict(fresh, second.cert)], [-2, 0], "the new certificate alone in it");
    answer({ status: 200, body: { machine: { id: "m-box" } } });
    assert.deepEqual(await p, { ok: true, name: "Workstation" });
    assert.match(view.webContents.scripts[0], /^fetch\("\/api\/remote\/sign-out"/, "signed out there first");
    assert.equal(kept[0].partition, "persist:machine-m-box.1", "kept with it");
    assert.equal(old.cleared, 1, "the partition it left cleared, the old certificate's yes with it");
    assert.equal(view.webContents.loads.at(-1), `${url}/ui/harness.html`);

    // Refused: the partition anew goes with what it holds, and the machine opens again in the one it had.
    const k = rig({
      kept: [lan(first.fingerprint)],
      answers: { "m-box": answered({ kind: "lan", url, fingerprint: first.fingerprint }) },
      check: async () => ({ ok: true, url, code: "ABCD-EFGH", fingerprint: second.fingerprint, route: { kind: "lan", url, fingerprint: second.fingerprint }, machine: { id: "m-box", name: "Workstation", version: "" } }),
      claim: async () => ({ status: 403, body: { error: "no" } }),
    });
    await k.settle();
    k.r.select("m-box");
    await k.settle();
    assert.equal((await k.r.add({ op: "pair", link: "x" })).ok, false);
    await k.settle();
    assert.ok(k.viewOf("persist:machine-m-box.1").webContents.closed);
    assert.equal(k.sessions["persist:machine-m-box.1"].cleared, 1);
    const back = k.views.filter((/** @type {any} */ v) => v.prefs.partition === "persist:machine-m-box" && !v.webContents.closed);
    assert.equal(back.length, 1, "a view in the partition it had");
    assert.equal(back[0].webContents.loads.at(-1), `${url}/ui/harness.html`, "opened again where it answers");

    // Paired again with a certificate it had: the partition it had.
    const same = rig({ kept: [lan(first.fingerprint)], check: async () => ({ ok: true, url, code: "ABCD-EFGH", fingerprint: first.fingerprint, route: { kind: "lan", url, fingerprint: first.fingerprint }, machine: { id: "m-box", name: "Workstation", version: "" } }), claim: async () => ({ status: 200, body: { machine: { id: "m-box" } } }), keep: { add: (/** @type {any} */ m) => (kept.push(m), m), remove: () => false } });
    await same.settle();
    assert.equal((await same.r.add({ op: "pair", link: "x" })).ok, true);
    assert.equal(kept.at(-1).partition, "persist:machine-m-box");
    assert.equal(same.sessions["persist:machine-m-box.1"], undefined);
  });

  // (fails before: yes — the review of s4a: the way a machine is reached became the best that answers, not the one it
  // was paired at, and the sign-in made there stood there alone — its home network's ended by the pairing, or never had,
  // and the machine showed signed out; and the sign-in its other ways held stood on at the machine with nothing here
  // holding it once they took the new one)
  test("paired again at a way of its: the sign-in its other ways held brought there for the claim to sign out; the one made given its pinned and tailnet ways, and an internet one where a sign-in stood — none to plain http, nothing sent", async () => {
    const TAIL = "https://box.tail1234.ts.net";
    const HOME = "https://192.168.0.9:20343";
    const WEB = "https://box.example.com";
    const KEPT = "https://studio.example.org";
    const kept = machine("m-box", "Workstation", [{ kind: "lan", url: HOME, fingerprint: "AA:BB" }, { kind: "url", url: TAIL }, { kind: "url", url: "http://127.0.0.1:5555" }, { kind: "url", url: WEB }, { kind: "url", url: KEPT }]);
    /** @type {any} */
    let ses = null;
    /** @type {string[]} */
    let atClaim = [];
    const sign = (/** @type {string} */ url, /** @type {string} */ value, more = {}) => ({ url, name: "__Host-filament_device", value, path: "/", secure: true, httpOnly: true, sameSite: "strict", ...more });
    const t = rig({
      kept: [kept],
      check: async () => ({ ok: true, url: TAIL, code: "ABCD-EFGH", fingerprint: "", route: { kind: "url", url: TAIL }, machine: { id: "m-box", name: "Workstation", version: "" } }),
      // The claim signs out the sign-in it is sent with, and its answer sets the one it made, as the machine's Filament does.
      claim: async () => {
        atClaim = (await ses.cookies.get({ url: TAIL })).map((/** @type {any} */ k) => k.value);
        await ses.cookies.set(sign(TAIL, "fdt_new", { expirationDate: 2e9 }));
        return { status: 200, body: { machine: { id: "m-box" } } };
      },
      keep: { add: (/** @type {any} */ m) => m, remove: () => false },
    });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    ses = t.sessions["persist:machine-m-box"];
    await ses.cookies.set(sign(HOME, "fdt_old", { expirationDate: 1e9 }));
    await ses.cookies.set(sign(KEPT, "fdt_old"));
    assert.equal((await t.r.add({ op: "pair", link: TAIL })).ok, true);
    await t.settle();
    const view = t.views.find((/** @type {any} */ v) => v.prefs.partition === "persist:machine-m-box" && v.webContents.scripts.length);
    assert.match(view.webContents.scripts.at(-1), /^fetch\("\/api\/remote\/sign-out"/, "the claim signs out first");
    assert.deepEqual(atClaim, ["fdt_old"], "with the sign-in its other ways held");
    const at = (/** @type {string} */ url) => ses.cookies.jar.filter((/** @type {any} */ k) => k.url === url);
    assert.deepEqual(at(HOME), [sign(HOME, "fdt_new", { expirationDate: 2e9 })], "the home network's: the one made");
    assert.deepEqual(at(TAIL), [sign(TAIL, "fdt_new", { expirationDate: 2e9 })], "where it was made: as made");
    assert.deepEqual(at(KEPT).map((/** @type {any} */ k) => k.value), ["fdt_new"], "an internet way where one stood: the one made");
    assert.deepEqual([at(WEB), at("http://127.0.0.1:5555")], [[], []], "an internet way where none stood, and plain http: none");
  });

  // (fails before: yes — the id was read after the claim, and the rail's room too)
  test("refused before any claim: an id that is none, this computer's own Filament, a full window, another machine than Continue showed — no view, nothing sent", async () => {
    const at = (/** @type {string} */ id) => async () => ({ ...BOXC, machine: { id, name: "Studio", version: "" } });
    const remote = (/** @type {any} */ t) => t.views.filter((/** @type {any} */ v) => v.prefs.partition);
    for (const id of ["LOCAL", "../etc", ""]) {
      const t = rig({ kept: [], check: at(id), claim: async () => { throw new Error("claimed"); } });
      await t.settle();
      const got = await t.r.add({ op: "pair", link: "x" });
      assert.match(got.words, /gives no id a machine is kept by: nothing was sent/, JSON.stringify(id));
      assert.equal(remote(t).length, 0, `${JSON.stringify(id)}: no view made`);
    }
    const own = rig({ kept: [], check: at("m-self"), ownId: () => "m-self" });
    assert.match((await own.r.add({ op: "check", link: "x" })).words, /is this computer's own Filament, in this window already as This computer/);
    const many = Array.from({ length: 31 }, (_, i) => machine(`m-${i}`, `Box ${i}`, [{ kind: "url", url: `https://b${i}.tail1234.ts.net` }]));
    const full = rig({ kept: many, check: at("m-new") });
    await full.settle();
    assert.match((await full.r.add({ op: "pair", link: "x" })).words, /^This window holds 32 machines at most: remove one first \(its ⋯ in the machines menu\)/);
    assert.equal((await rig({ kept: many, check: at("m-3") }).r.add({ op: "check", link: "x" })).ok, true, "one kept already may be paired again");
    const moved = rig({ kept: [], check: at("m-other") });
    const said = await moved.r.add({ op: "pair", link: "x", expect: "m-new" });
    assert.match(said.words, /^Another machine answers at https:\/\/192\.168\.0\.9:20343 now — Studio —, not the one shown: nothing was sent/);
    assert.equal(remote(moved).length, 0);
  });

  // (fails before: yes — the view was made on a window gone)
  test("the window closed while who answers is asked: nothing made", async () => {
    /** @type {(x: any) => void} */
    let done = () => {};
    const t = rig({ kept: [], check: () => new Promise((r) => (done = r)) });
    await t.settle();
    const p = t.r.add({ op: "pair", link: "x" });
    t.win.emit("closed");
    done(BOXC);
    assert.deepEqual(await p, { ok: false, words: "The window closed." });
    assert.equal(t.views.filter((v) => !v.prefs.preload).length, 0);
  });

  // (fails before: yes — the claim failed on the app's page it cut off, and a failed load brought that page over it)
  test("the claim's page waited for itself: an earlier navigation it cuts off is not its failure, and no app page comes over it", async () => {
    /** @type {() => void} */
    let answer = () => {};
    const k = rig({
      check: async () => ({ ...BOXC, machine: { id: "m-box", name: "Workstation", version: "" } }),
      claim: () => new Promise((r) => (answer = () => r({ status: 200, body: { machine: { id: "m-box" } } }))),
      keep: { add: (/** @type {any} */ m) => m, remove: () => false },
      answers: { "m-box": answered(BOX.routes[1]) },
    });
    await k.settle();
    k.r.select("m-box");
    await k.settle();
    const wc = k.viewOf("persist:machine-m-box").webContents;
    const claimAt = "https://192.168.0.9:20343/.well-known/filament";
    // Its page failed on the certificate made anew, and the app's page was on its way: the claim's load cuts it off.
    wc.loadFails = [new Error("ERR_ABORTED (-3) loading 'data:text/html;charset=utf-8,cannot%20be%20reached'")];
    wc.loading = true;
    const p = k.r.add({ op: "pair", link: "x" });
    await k.settle();
    assert.equal(wc.loads.at(-1), claimAt);
    wc.emit("did-fail-load", {}, -2, "ERR_FAILED", "https://box.tail1234.ts.net/ui/harness.html", true);
    await k.settle();
    assert.equal(wc.loads.at(-1), claimAt, "no app page over the claim's");
    assert.equal(wc.scripts.length, 0, "nothing claimed before its page loaded");
    wc.loading = false;
    wc.emit("did-finish-load");
    await k.settle();
    assert.equal(wc.scripts.length, 1, "the claim made once its own page loaded");
    answer();
    assert.deepEqual(await p, { ok: true, name: "Workstation" });
  });

  // (fails before: yes — an opening ask's answer loaded the harness over the claim's page)
  test("an ask from before a pairing leaves the view to it: the claim's page is not moved under it", async () => {
    /** @type {(x: any) => void} */
    let open = () => {};
    /** @type {() => void} */
    let answer = () => {};
    const k = rig({
      check: async () => ({ ...BOXC, machine: { id: "m-box", name: "Workstation", version: "" } }),
      claim: () => new Promise((r) => (answer = () => r({ status: 200, body: { machine: { id: "m-box" } } }))),
      keep: { add: (/** @type {any} */ m) => m, remove: () => false },
      answers: { "m-box": () => new Promise((r) => (open = r)) },
    });
    await k.settle();
    k.r.select("m-box");
    await k.settle();
    const p = k.r.add({ op: "pair", link: "x" });
    await k.settle();
    const box = k.viewOf("persist:machine-m-box");
    assert.equal(box.webContents.loads.at(-1), "https://192.168.0.9:20343/.well-known/filament");
    // Its answer from before: the claim's address passed over, another answering — which moved the page at once.
    open({ route: BOX.routes[1], name: null, version: null, tried: [{ url: "https://192.168.0.9:20343", why: "no answer in 5 s" }] });
    await k.settle();
    assert.equal(box.webContents.loads.at(-1), "https://192.168.0.9:20343/.well-known/filament", "the claim's page stands");
    answer();
    assert.deepEqual(await p, { ok: true, name: "Workstation" });
    assert.equal(box.webContents.loads.at(-1), "https://192.168.0.9:20343/ui/harness.html", "its harness opens where it was paired");
  });

  test("a machine's menu: Remove, asked first — its view and storage gone, the window as it is now; This computer's its Colour and Icon alone", async () => {
    /** @type {string[]} */
    const removed = [];
    /** @type {any[]} */
    let rows = /** @type {any[]} */ ([]);
    let yes = false;
    const t = rig({ keep: { add: (m) => m, remove: (id) => (removed.push(id), true) }, menu: (r) => void (rows = r), confirm: async () => yes });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    t.r.machineMenu("local");
    assert.deepEqual(rows.map((r) => r.label ?? "-"), ["Colour", "Icon"], "This computer: its Colour and Icon alone");
    t.r.machineMenu("m-box");
    assert.deepEqual(rows.map((r) => r.label ?? "-"), ["Colour", "Icon", "-", "Disconnect Workstation", "-", "Remove Workstation from this window…"]);
    rows[5].click();
    await t.settle();
    assert.deepEqual(removed, [], "asked first: no");
    yes = true;
    t.setList([localMachine(ORIGIN), MAC]);
    const ses = t.sessions["persist:machine-m-box"];
    /** @type {boolean | null} */
    let closedFirst = null;
    ses.clearStorageData = function () {
      this.cleared++;
      closedFirst = t.viewOf("persist:machine-m-box").webContents.closed;
      return Promise.resolve();
    };
    rows[5].click();
    await t.settle();
    assert.deepEqual(removed, ["m-box"]);
    assert.equal(t.sessions["persist:machine-m-box"].cleared, 1, "its cookie and storage cleared");
    assert.equal(closedFirst, true, "after its page closed: none left to write again");
    assert.ok(t.viewOf("persist:machine-m-box").webContents.closed);
    assert.equal(t.r.active(), LOCAL_ID);
  });

  // (fails before: yes — the owner's of 11-08: a machine could be removed, never only disconnected — its notifications kept coming)
  test("a machine's menu: Disconnect — its page and windows closed, nothing asked of it, its sign-in kept, said disconnected; picked again or Connect in its menu, connected", async () => {
    /** @type {string[]} */
    const said = [];
    /** @type {string[]} */
    const asked = [];
    /** @type {any[]} */
    let rows = [];
    let list = [localMachine(ORIGIN), BOX, MAC];
    /** @type {any} */
    let t = null;
    const off = (/** @type {string} */ id, /** @type {boolean} */ on) => {
      said.push(`${id} ${on ? "off" : "on"}`);
      list = list.map((m) => (m.id !== id ? m : on ? { ...m, off: true } : { ...m, off: undefined }));
      t.setList(list);
      return list.find((m) => m.id === id) ?? null;
    };
    t = rig({ answers: { "m-box": (/** @type {any} */ m) => (asked.push(m.id), answered(BOX.routes[1])) }, keep: { add: (m) => m, remove: () => false, off }, menu: (r) => void (rows = r) });
    await t.settle();
    t.r.select("m-box");
    await t.settle();
    const v = t.viewOf("persist:machine-m-box");
    const popup = { destroyed: false, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; } };
    t.guarded.find((/** @type {any} */ g) => g.contents === v.webContents).o.onChild(popup);
    t.r.machineMenu("m-box");
    assert.deepEqual(rows.map((r) => r.label ?? "-"), ["Colour", "Icon", "-", "Disconnect Workstation", "-", "Remove Workstation from this window…"]);
    rows[3].click();
    await t.settle();
    assert.deepEqual(said, ["m-box off"]);
    assert.ok(v.webContents.closed, "its page closed: no notification of its own");
    assert.equal(popup.destroyed, true, "the windows it opened too");
    assert.equal(t.r.active(), LOCAL_ID, "This computer shown in its place");
    assert.equal(t.sessions["persist:machine-m-box"].cleared, 0, "its sign-in kept");
    const before = asked.length;
    await t.tick();
    await t.tick();
    assert.equal(asked.length, before, "nothing asked of it");
    assert.equal(stateOf(t.win.webContents).shown, true, "still kept: the chip stays");
    t.r.openPop(LOCAL_ID, { x: 10, y: 10, width: 100, height: 28 });
    const list1 = String(t.railView().webContents.sent.at(-1)[1].list);
    assert.match(list1, /<div class="row s-disconnected" role="none"><button [^>]*data-machine="m-box" title="Workstation — disconnected · Ctrl\+2\nPick it to connect again\." aria-label="Workstation, disconnected"><i class="dot"><\/i><span class="mi c-[a-z]+"><svg [^>]+>(?:(?!<\/svg>).)*<\/svg><\/span><span class="nm"><b>Workstation<\/b><small>disconnected — pick it to connect again<\/small>/);
    assert.match(list1, /data-more="m-box" title="Workstation: Colour, Icon, Connect, Remove…"/);
    // Picked: connected again, its page opened anew.
    assert.equal(t.r.pick("m-box"), true);
    await t.settle();
    assert.deepEqual(said, ["m-box off", "m-box on"]);
    assert.equal(t.r.active(), "m-box");
    const again = t.views.filter((/** @type {any} */ x) => x.prefs.partition === "persist:machine-m-box").at(-1);
    assert.ok(again !== v && !again.webContents.closed && again.visible, "a page of its own again");
    assert.ok(asked.length > before);
    // Off again; its menu says Connect, which shows it.
    t.r.machineMenu("m-box");
    rows[3].click();
    await t.settle();
    t.r.machineMenu("m-box");
    assert.deepEqual(rows.map((r) => r.label ?? "-"), ["Colour", "Icon", "-", "Connect Workstation", "-", "Remove Workstation from this window…"]);
    rows[3].click();
    await t.settle();
    assert.deepEqual(said.slice(2), ["m-box off", "m-box on"]);
    assert.equal(t.r.active(), "m-box");
    // Another machine disconnected while this one shows: nothing moves here.
    t.r.machineMenu("m-mac");
    rows[3].click();
    assert.equal(t.r.active(), "m-box");
    // The app's side: kept in its file; its tunnel let go; the tray says it, counting nothing; the fleet's watch skips it (lib/watch.js).
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    assert.match(main, /off: \(id, off\) => \{\n\s+const got = setMachineOff\(machinesFile, id, off, [^\n]+\n\s+machineBrowsers\.sync\(\);\n\s+return got;/);
    assert.match(main, /const kept = readKept\(machinesFile\);\n\s+tunnels\.only\(kept\.filter\(\(m\) => !m\.off\)/);
    assert.match(main, /if \(k\.off\) return \[\{ id: k\.id, name: k\.name, status: \/\*\* @type \{const\} \*\/ \("disconnected"\), refused: false, needs: 0, color: colorOf\(k\) \}\];/);
  });

  // (fails before: yes — the remote desk of 11-22: every machine looked the same but for its name)
  test("a machine's menu: its Colour and Icon, the one it wears checked; a pick kept and every chip told at once — This computer's too", async () => {
    /** @type {any[]} */
    let rows = [];
    let list = [localMachine(ORIGIN), BOX, MAC];
    /** @type {any[]} */
    const looks = [];
    /** @type {any} */
    let t = null;
    const look = (/** @type {string} */ id, /** @type {any} */ l) => {
      looks.push([id, l]);
      list = list.map((m) => (m.id === id ? { ...m, ...l } : m));
      t.setList(list);
      return list.find((m) => m.id === id) ?? null;
    };
    t = rig({ keep: { add: (m) => m, remove: () => false, look }, menu: (r) => void (rows = r) });
    await t.settle();
    t.r.machineMenu("m-box");
    const [colour, icon] = rows;
    assert.deepEqual(colour.submenu.map((/** @type {any} */ r) => r.label), ["Blue", "Orange", "Green", "Purple", "Teal", "Pink", "Indigo", "Yellow"]);
    assert.deepEqual(colour.submenu.filter((/** @type {any} */ r) => r.checked).map((/** @type {any} */ r) => r.label.toLowerCase()), [colorOf(BOX)], "the one it wears");
    assert.ok(colour.submenu.every((/** @type {any} */ r) => r.type === "radio" && /^#[0-9a-f]{6}$/.test(r.swatch)), "each with its swatch");
    assert.deepEqual(icon.submenu.map((/** @type {any} */ r) => [r.label, !!r.checked]), [["Desktop", true], ["Laptop", false], ["Server", false], ["Cloud", false], ["Home", false], ["Terminal", false]]);
    colour.submenu[4].click();
    await t.settle();
    assert.deepEqual(looks, [["m-box", { color: "teal" }]]);
    assert.equal(stateOf(t.win.webContents).shown, true);
    t.r.machineMenu("local");
    rows[1].submenu[1].click();
    await t.settle();
    assert.deepEqual(looks.at(-1), ["local", { icon: "laptop" }]);
    assert.equal(stateOf(t.win.webContents).icon, "laptop", "This computer's chip told at once");
    // The app's side: kept in its file, the tray and the desk dressed anew at once.
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    assert.match(main, /look: \(id, l\) => \{\n\s+const got = setMachineLook\(machinesFile, id, l, [^\n]+\n\s+if \(got\) dressedAnew\(\);\n\s+return got;/);
    assert.match(main, /menu: \(rows\) => Menu\.buildFromTemplate\(dressRows\(rows\)\)\.popup\(\{ window: w \}\),/, "each swatch drawn as its dot");
  });
});

describe("the tailnet's machines (p2-tailscale)", () => {
  const STATUS = {
    BackendState: "Running",
    Self: { DNSName: "desktop-1.tail1234.ts.net.", UserID: 1 },
    User: { 1: { LoginName: "me@example.com" }, 2: { LoginName: "friend@example.com" } },
    Peer: {
      f: { HostName: "phone", DNSName: "phone.tail1234.ts.net.", Online: true, UserID: 2 },
      a: { HostName: "Studio", DNSName: "studio.tail1234.ts.net.", Online: true, UserID: 1 },
      b: { HostName: "laptop", DNSName: "laptop.tail1234.ts.net.", Online: true, UserID: 1 },
      c: { HostName: "nas", DNSName: "nas.tail1234.ts.net.", Online: true, UserID: 1 },
      d: { HostName: "old", DNSName: "old.tail1234.ts.net.", Online: false, UserID: 1 },
      e: { HostName: "odd", DNSName: "odd.tail1234.ts.net/x.", Online: true, UserID: 1 },
      g: { HostName: "proxy", DNSName: "proxy.tail1234.ts.net.", Online: true, UserID: 1 },
    },
  };
  /** @param {{ status?: any, out?: string, timedOut?: boolean, answers?: Record<string, any> }} [o] */
  const look = async ({ status = STATUS, out, timedOut = false, answers = {} } = {}) => {
    /** @type {any[]} */
    const ran = [];
    /** @type {string[]} */
    const asked = [];
    let waiting = 0;
    let most = 0;
    const got = await tailnetFilaments({
      cli: () => "C:\\Program Files\\Tailscale\\tailscale.exe",
      exec: async (file, args, o) => (ran.push({ file, args, o }), { code: 0, out: out ?? JSON.stringify(status), err: "", timedOut }),
      ask: async (url, { timeoutMs }) => {
        asked.push(url);
        assert.equal(timeoutMs, PEER_MS);
        most = Math.max(most, ++waiting);
        await new Promise((r) => setImmediate(r));
        waiting--;
        const a = answers[url];
        if (a instanceof Error) throw a;
        return a ?? { status: 404, json: null };
      },
    });
    return { got, ran, asked, most };
  };

  // (fails before: yes — no tailnet-peers.js; the sheet listed nothing of the tailnet)
  test("the online machines are asked who they are at their https address, all at once; those that answer as a Filament are listed, named as Tailscale names them, yours first", async () => {
    const { got, ran, asked, most } = await look({
      answers: {
        "https://studio.tail1234.ts.net": { status: 200, json: { id: "6F1C-ABC", name: "Workstation, I promise", version: "1.4.0" } },
        "https://laptop.tail1234.ts.net": { status: 200, json: { id: "", name: "No id" } },
        "https://nas.tail1234.ts.net": new Error("ECONNREFUSED"),
        "https://phone.tail1234.ts.net": { status: 200, json: { id: "PH-1" } },
        "https://proxy.tail1234.ts.net": { status: 302, json: { id: "PX-1", name: "Led elsewhere" } },
      },
    });
    assert.deepEqual(ran.map((r) => r.args), [["status", "--json"]]);
    assert.ok(ran[0].o.timeoutMs > 0, "the command line bounded");
    assert.deepEqual(asked.sort(), ["https://laptop.tail1234.ts.net", "https://nas.tail1234.ts.net", "https://phone.tail1234.ts.net", "https://proxy.tail1234.ts.net", "https://studio.tail1234.ts.net"], "the offline one and an odd name never asked");
    assert.equal(most, 5, "all at once");
    assert.deepEqual(got, {
      found: [
        { url: "https://studio.tail1234.ts.net", host: "studio.tail1234.ts.net", id: "6f1c-abc", name: "Studio", owner: "", version: "1.4.0" },
        { url: "https://phone.tail1234.ts.net", host: "phone.tail1234.ts.net", id: "ph-1", name: "phone", owner: "friend@example.com", version: "" },
      ],
      words: "",
    }, "its own word on its name taken for nothing; another's machine said so, after yours");
  });

  test("none listed, said why: no Tailscale here says nothing; signed out, unread, none online, none a Filament", async () => {
    let ran = 0;
    assert.deepEqual(await tailnetFilaments({ cli: () => null, exec: async () => (ran++, { code: 0, out: "{}", err: "", timedOut: false }) }), { found: [], words: "" });
    assert.equal(ran, 0, "no command line run where none is installed");
    assert.match((await look({ status: { ...STATUS, BackendState: "NeedsLogin" } })).got.words, /^Tailscale is not connected here/);
    assert.match((await look({ out: "", timedOut: true })).got.words, /^Tailscale could not be read here: it did not answer/);
    const none = await look({ status: { ...STATUS, Peer: { d: STATUS.Peer.d } } });
    assert.deepEqual([none.got.words, none.asked], ["No other machine of your tailnet is online.", []]);
    assert.match((await look()).got.words, /^No machine of your tailnet answers as a Filament: on the one to add, turn on Share on my tailnet/);
  });

  test("a tailnet of hundreds — exit nodes, machines shared in —: yours asked first, no more than PEERS_MAX", async () => {
    /** @type {Record<string, any>} */
    const Peer = {};
    for (let i = 0; i < 20; i++) Peer[`x${i}`] = { HostName: `exit${i}`, DNSName: `exit${i}.tail1234.ts.net.`, Online: true, UserID: 2 };
    for (let i = 0; i < PEERS_MAX; i++) Peer[`p${i}`] = { HostName: `m${i}`, DNSName: `m${i}.tail1234.ts.net.`, Online: true, UserID: 1 };
    const { asked } = await look({ status: { ...STATUS, Peer } });
    assert.equal(asked.length, PEERS_MAX);
    assert.ok(asked.every((u) => /^https:\/\/m\d+\./.test(u)), "none of the others while yours fill it");
  });

  test("an answer is read to PEER_BYTES at most: one longer is no answer", async () => {
    const body = (/** @type {string} */ text, chunk = 1024) =>
      new ReadableStream({
        start(c) {
          const b = Buffer.from(text);
          for (let i = 0; i < b.length; i += chunk) c.enqueue(new Uint8Array(b.subarray(i, i + chunk)));
          c.close();
        },
      });
    assert.deepEqual(await cappedJson(body(JSON.stringify({ id: "a" })), PEER_BYTES), { id: "a" });
    assert.equal(await cappedJson(body(JSON.stringify({ id: "a", pad: "x".repeat(PEER_BYTES) })), PEER_BYTES), null);
    assert.equal(await cappedJson(body("not json"), PEER_BYTES), null);
    assert.equal(await cappedJson(null, PEER_BYTES), null);
  });

  test("the sheet is handed what was found, each marked where a machine of this window is reached at its address — not by the id it says; asked from the app's page alone", async () => {
    const studio = machine("6f1c-abc", "Studio Mac", [{ kind: "url", url: "https://studio.tail1234.ts.net" }]);
    const t = rig({
      kept: [studio],
      peers: async () => ({
        found: [
          { url: "https://studio.tail1234.ts.net", host: "studio.tail1234.ts.net", id: "6f1c-abc", name: "Studio", owner: "", version: "" },
          { url: "https://evil.tail1234.ts.net", host: "evil.tail1234.ts.net", id: "6f1c-abc", name: "evil", owner: "friend@example.com", version: "" },
          { url: "https://phone.tail1234.ts.net", host: "phone.tail1234.ts.net", id: "ph-1", name: "phone", owner: "", version: "" },
        ],
        words: "",
      }),
    });
    await t.settle();
    const got = await t.r.tailnet();
    assert.deepEqual(
      got.found.map((/** @type {any} */ f) => [f.host, f.kept]),
      [
        ["studio.tail1234.ts.net", true],
        ["evil.tail1234.ts.net", false],
        ["phone.tail1234.ts.net", false],
      ],
      "another machine saying a kept machine's id is not it",
    );
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    assert.match(main, /ipcMain\.handle\("filament:rail-tailnet", \(e\) => \(rail\?\.hears\(e\.sender, e\.senderFrame\?\.url\) \? rail\.tailnet\(\)/);
  });
});

// (fails before: yes — the hunt of p3-add: the bridge dropped `expect`, so Pair never named the machine Continue showed)
test("the app's page's bridge hands the app every step's fields, Pair's machine included; a step without one sends none", async () => {
  const src = readFileSync(new URL("../desktop/rail-preload.cjs", import.meta.url), "utf8");
  /** @type {Record<string, any>} */
  const bridge = {};
  /** @type {any[]} */
  const invoked = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (/** @type {string} */ k, /** @type {any} */ v) => void (bridge[k] = v) },
    ipcRenderer: { invoke: async (/** @type {string} */ ch, /** @type {any} */ arg) => (invoked.push([ch, arg ?? null]), { ok: true }), send() {}, on() {} },
  };
  vm.runInNewContext(src, { require: (/** @type {string} */ m) => (m === "electron" ? electron : null) });
  await bridge.filamentRail.add({ op: "pair", link: "https://box.tail1234.ts.net", code: "ABCD-EFGH", fingerprint: "AA:BB", expect: "m-box", more: "dropped" });
  await bridge.filamentRail.add({ op: "check", link: "https://box.tail1234.ts.net" });
  await bridge.filamentRail.tailnet("ignored");
  // Read as JSON: the preload's objects are its own context's.
  assert.deepEqual(JSON.parse(JSON.stringify(invoked)), [
    ["filament:rail-add", { op: "pair", link: "https://box.tail1234.ts.net", code: "ABCD-EFGH", fingerprint: "AA:BB", expect: "m-box" }],
    ["filament:rail-add", { op: "check", link: "https://box.tail1234.ts.net", code: "", fingerprint: "" }],
    ["filament:rail-tailnet", null],
  ]);
});

// (fails before: yes — the review of s4a: what a page carried was put back untested, and the answer main gives it too)
test("a machine's page loading: what main hands it is its tab's storage before its own scripts run, the address's own let go; none handed, its own kept; main always answers", () => {
  const src = readFileSync(new URL("../desktop/machine-preload.cjs", import.meta.url), "utf8");
  const run = (/** @type {() => any} */ answer, /** @type {Record<string, string>} */ had) => {
    const store = new Map(Object.entries(had));
    /** @type {string[]} */
    const asked = [];
    /** @type {string[]} */
    const bridges = [];
    const sessionStorage = { clear: () => store.clear(), setItem: (/** @type {string} */ k, /** @type {string} */ v) => void store.set(k, v) };
    const electron = {
      contextBridge: { exposeInMainWorld: (/** @type {string} */ k) => void bridges.push(k) },
      ipcRenderer: { sendSync: (/** @type {string} */ ch) => (asked.push(ch), answer()), send() {}, on() {}, invoke: async () => null },
    };
    vm.runInNewContext(src, { require: (/** @type {string} */ m) => (m === "electron" ? electron : null), sessionStorage });
    return { store: Object.fromEntries(store), asked, bridges };
  };
  const old = { "filament.queue.s1": '["sent since"]', "filament.draft": "from its last visit" };
  assert.deepEqual(run(() => [["filament.draft", "half a thought"]], old), { store: { "filament.draft": "half a thought" }, asked: ["filament:machines-carry"], bridges: ["filamentMachines", "filamentBrowser"] });
  assert.deepEqual(run(() => [], old).store, {}, "nothing carried: what the address kept let go");
  assert.deepEqual(run(() => null, old).store, old, "loaded again where it last loaded: its own");
  const lost = run(() => {
    throw new Error("main went");
  }, old);
  assert.deepEqual([lost.store, lost.bridges], [old, ["filamentMachines", "filamentBrowser"]], "no answer: its own, its bridges made all the same");
  // Main answers each ask, whatever the rail says or throws: a sync ask left unanswered holds the page.
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.on\("filament:machines-carry", \(e\) => \{\s+let pairs = null;\s+try \{\s+pairs = rail\?\.carryFor\(e\.sender, e\.senderFrame\) \?\? null;\s+\} catch \{\}\s+e\.returnValue = pairs;\s+\}\);/);
});

// (fails before: yes — the owner's of 11-08: another machine's page had no bridge, so no chip and no title bar)
test("a machine's page's bridges: its chip's state, its press, its colours, and its Browser pane's — nothing else of the app's; This computer's page has the same chip's, and the desk", async () => {
  const loadPreload = (/** @type {string} */ file, /** @type {Record<string, any>} */ answers = {}) => {
    const src = readFileSync(new URL(`../desktop/${file}`, import.meta.url), "utf8");
    /** @type {Record<string, any>} */
    const bridge = {};
    /** @type {any[]} */
    const sent = [];
    /** @type {Map<string, Function>} */
    const heard = new Map();
    /** What it asked of main, and with what. @type {any[]} */
    const invoked = [];
    const electron = {
      contextBridge: { exposeInMainWorld: (/** @type {string} */ k, /** @type {any} */ v) => void (bridge[k] = v) },
      ipcRenderer: {
        send: (/** @type {string} */ ch, /** @type {any} */ arg, /** @type {any[]} */ ...more) => void sent.push([ch, arg ?? null, ...more]),
        invoke: async (/** @type {string} */ ch, /** @type {any} */ arg) => (invoked.push([ch, arg ?? null]), answers[ch] ?? null),
        on: (/** @type {string} */ ch, /** @type {Function} */ fn) => void heard.set(ch, fn),
        removeListener: (/** @type {string} */ ch) => void heard.delete(ch),
      },
    };
    vm.runInNewContext(src, { require: (/** @type {string} */ m) => (m === "electron" ? electron : null) });
    return { bridge, sent, heard, invoked };
  };
  const m = loadPreload("machine-preload.cjs");
  // Its Browser pane's too (b-remote), the shape This computer's has, so the pane draws a page the app holds for it.
  assert.deepEqual(Object.keys(m.bridge), ["filamentMachines", "filamentBrowser"], "no other bridge");
  // Showing a chat alone beside This computer's list (s1j): its way to its whole page, and the list's keys by their id;
  // and the app's update page's act (s4c).
  assert.deepEqual(Object.keys(m.bridge.filamentMachines).sort(), ["deskKey", "full", "onState", "open", "titleBar", "update"]);
  assert.deepEqual(Object.keys(m.bridge.filamentBrowser).sort(), Object.keys(loadPreload("harness-preload.cjs").bridge.filamentBrowser).sort());
  m.bridge.filamentMachines.open({ x: "12", y: 3, width: 40, height: 28, more: "dropped" });
  m.bridge.filamentMachines.titleBar({ color: "#101010", symbolColor: 7, extra: 1 });
  /** @type {any[]} */
  const got = [];
  const stop = m.bridge.filamentMachines.onState((/** @type {any} */ s) => got.push(s));
  m.heard.get("filament:machines")?.({}, { shown: true });
  stop();
  assert.equal(m.heard.has("filament:machines"), false, "stopped");
  m.bridge.filamentMachines.full({ toString: () => "#/settings" });
  m.bridge.filamentMachines.deskKey("x".repeat(60));
  m.bridge.filamentMachines.update("words dropped");
  assert.deepEqual(JSON.parse(JSON.stringify(m.sent)), [
    ["filament:machines-open", { x: 12, y: 3, width: 40, height: 28 }],
    ["filament:machines-title-bar", { color: "#101010", symbolColor: "7" }],
    ["filament:machines-ready", null],
    ["filament:machines-full", "#/settings"],
    ["filament:machines-key", "x".repeat(40)],
    ["filament:machines-update", null],
  ]);
  assert.deepEqual(got, [{ shown: true }]);
  const h = loadPreload("harness-preload.cjs");
  assert.deepEqual(Object.keys(h.bridge.filamentMachines).sort(), ["call", "hideChat", "onDesk", "onEvent", "onGuest", "onKey", "onState", "open", "placeChat", "seen", "showChat"], "This computer's controls wear its colours through its own bridge");
  h.bridge.filamentMachines.open({ x: 1, y: 2, width: 3, height: 4 });
  h.bridge.filamentApp.frameArea({ left: "78", right: 0, top: 9 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.sent)), [
    ["filament:machines-open", { x: 1, y: 2, width: 3, height: 4 }],
    ["filament:frame-area", { left: 78, right: 0 }],
  ]);
  // (fails before: yes — the remote desk of 11-22) The desk: every other machine's rows, This computer's page's alone —
  // as it stands when the page starts to listen, then as it moves.
  assert.ok(!("onDesk" in m.bridge.filamentMachines), "another machine's page hears no other machine's rows");
  const first = { here: { id: "local", name: "This computer", color: "purple", icon: "monitor" }, machines: [] };
  const d = loadPreload("harness-preload.cjs", { "filament:desk": first });
  /** @type {any[]} */
  const desks = [];
  const stopDesk = d.bridge.filamentMachines.onDesk((/** @type {any} */ x) => desks.push(x));
  await new Promise((r) => setImmediate(r));
  d.heard.get("filament:desk")?.({}, { ...first, machines: [{ id: "m-box" }] });
  stopDesk();
  assert.equal(d.heard.has("filament:desk"), false, "stopped");
  assert.deepEqual(desks, [first, { ...first, machines: [{ id: "m-box" }] }]);
  // (fails before: yes — s1b) The desk's Done cleared: those chats of a machine marked seen there, through main, fifty at most.
  assert.ok(!("seen" in m.bridge.filamentMachines), "another machine's page marks no other machine's chats");
  await d.bridge.filamentMachines.seen("m-box", ["c1", 7, ...Array.from({ length: 60 }, (_, i) => `x${i}`)]);
  const asked = d.invoked.find((x) => x[0] === "filament:desk-seen");
  assert.deepEqual([asked?.[1].id, asked?.[1].chains.length, asked?.[1].chains.slice(0, 2)], ["m-box", 50, ["c1", "7"]]);
  // (fails before: yes — s1e) The desk's operations through main (desktop/lib/desk.js): its fields alone, as plain
  // values — no path, no headers, nothing that is not a word, a number or a yes —; and its machines' frames as they come.
  assert.ok(!("call" in m.bridge.filamentMachines) && !("onEvent" in m.bridge.filamentMachines), "another machine's page has no desk bridge");
  await d.bridge.filamentMachines.call({ op: "answer", machine: "m-box", chat: "c1", ask: "r1.2", allow: false, choice: 2, words: "no", path: "/remote/devices", headers: { cookie: "x" }, content: { evil: true }, url: "https://elsewhere", mode: null });
  assert.deepEqual(JSON.parse(JSON.stringify(d.invoked.find((x) => x[0] === "filament:desk-call")?.[1])), { op: "answer", machine: "m-box", chat: "c1", ask: "r1.2", allow: false, choice: "2", words: "no" });
  /** @type {any[]} */
  const frames = [];
  const stopFrames = d.bridge.filamentMachines.onEvent((/** @type {any} */ f) => frames.push(f));
  d.heard.get("filament:desk-event")?.({}, { machine: "m-box", type: "hello" });
  stopFrames();
  assert.equal(d.heard.has("filament:desk-event"), false, "stopped");
  assert.deepEqual(frames, [{ machine: "m-box", type: "hello" }]);
  // main.js hears each from a harness page of the window alone, as its machine.
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  // The desk told to Filament's own page in the harness window alone, and asked for by that page alone — not a popped
  // pane's, which never hears it move (the hunt on s1e).
  assert.match(main, /if \(w && !w\.isDestroyed\(\) && paneHears\(true, w\.webContents\.getURL\(\), origin\)\) w\.webContents\.send\("filament:desk", d\);/);
  assert.match(main, /ipcMain\.handle\("filament:desk", \(e\) => \(deskPage\(e\) \? \(deskNow \?\? deskOf\(\)\) : null\)\);/);
  // Seen there: This computer's page alone, a machine kept and connected, its chats' ids as ids.
  assert.match(main, /ipcMain\.handle\("filament:desk-seen", async \(e, p\) => \{\n\s+const id = String\(p\?\.id \?\? ""\);\n\s+if \(!deskPage\(e\) \|\| !readKept\(machinesFile\)\.some\(\(k\) => k\.id === id && !k\.off\)\) return false;\n\s+const chains = [^\n]+\.filter\(\(c\) => \/\^\[A-Za-z0-9\]\[A-Za-z0-9_\.:-\]\{0,99\}\$\/\.test\(c\)\)\.slice\(0, 50\);\n\s+await Promise\.all\(chains\.map\(\(c\) => fleet\.markSeen\(id, c\)\)\);/);
  assert.match(main, /ipcMain\.on\("filament:machines-open", \(e, rect\) => \{\n\s+const id = rail\?\.hearsPage\(e\.sender, e\.senderFrame\);\n\s+if \(id\) rail\?\.openPop\(id, rect\);/);
  assert.match(main, /ipcMain\.on\("filament:machines-title-bar", \(e, c\) => \{\n\s+const id = rail\?\.hearsPage\(e\.sender, e\.senderFrame\);\n\s+if \(id\) rail\?\.tintFrom\(id, c\);/);
  assert.match(main, /ipcMain\.on\("filament:frame-area", \(e, r\) => void \(rail\?\.hearsPage\(e\.sender, e\.senderFrame\) === LOCAL_ID && rail\.frameArea\(r\)\)\);/);
  assert.match(main, /ipcMain\.on\("filament:rail-select", \(e, id\) => void \(rail\?\.hears\(e\.sender, e\.senderFrame\?\.url\) && rail\.pick\(String\(id\)\)\)\);/);
  assert.match(main, /machinePreload: join\(ROOT, "desktop", "machine-preload\.cjs"\),/);
  // (fails before: yes — s1j) Another machine's chat shown in place: This computer's page asks it with plain fields alone,
  // and hears where it went and the keys it hands over; another machine's page has none of it.
  for (const k of ["showChat", "placeChat", "hideChat", "onGuest", "onKey"]) assert.ok(!(k in m.bridge.filamentMachines), k);
  await d.bridge.filamentMachines.showChat({ machine: "m-box", route: "#/task/c1", rect: { x: "280", y: 0, width: 900, height: 700, more: 1 }, theme: "sepia", url: "https://elsewhere" });
  assert.deepEqual(JSON.parse(JSON.stringify(d.invoked.find((x) => x[0] === "filament:desk-show")?.[1])), { machine: "m-box", route: "#/task/c1", rect: { x: 280, y: 0, width: 900, height: 700 }, theme: "dark", focus: false });
  await d.bridge.filamentMachines.showChat({ machine: "m-box", route: "#/task/c1", focus: "yes" });
  await d.bridge.filamentMachines.showChat({ machine: "m-box", route: "#/task/c1", focus: true });
  assert.deepEqual(d.invoked.filter((x) => x[0] === "filament:desk-show").map((x) => x[1].focus), [false, false, true], "the keys its: true alone");
  d.bridge.filamentMachines.placeChat({ x: 1, y: 2, width: 3, height: 4, z: 9 });
  d.bridge.filamentMachines.placeChat(null);
  d.bridge.filamentMachines.placeChat({ x: 1, y: 2, width: 3, height: 4 }, true);
  d.bridge.filamentMachines.hideChat();
  assert.deepEqual(JSON.parse(JSON.stringify(d.sent.filter((x) => String(x[0]).startsWith("filament:desk-")))), [
    ["filament:desk-place", { x: 1, y: 2, width: 3, height: 4 }, false],
    ["filament:desk-place", null, false],
    ["filament:desk-place", { x: 1, y: 2, width: 3, height: 4 }, true],
    ["filament:desk-hide", null],
  ]);
  /** @type {any[]} */
  const went = [];
  const stopGuest = d.bridge.filamentMachines.onGuest((/** @type {any} */ g) => went.push(g));
  d.heard.get("filament:desk-guest")?.({}, { id: "m-box", hash: "#/task/c9", more: 1 });
  d.heard.get("filament:desk-guest")?.({}, { id: "m-box", hash: null });
  stopGuest();
  assert.deepEqual(JSON.parse(JSON.stringify(went)), [{ id: "m-box", hash: "#/task/c9" }, { id: "m-box", hash: null }]);
  /** @type {string[]} */
  const keys = [];
  const stopKeys = d.bridge.filamentMachines.onKey((/** @type {string} */ k) => keys.push(k));
  d.heard.get("filament:desk-key")?.({}, "command-center");
  stopKeys();
  assert.deepEqual(keys, ["command-center"]);
  // Heard by main from the harness window's own page alone — This computer's, not a popped pane's —, a machine's view's
  // asks as that machine, and its keys only while its chat shows in place, one of DESK_KEYS.
  for (const said of [
    `const deskPage = (e) => {\n    const w = windows.get("harness");\n    return w && !w.isDestroyed() && paneOf(e) === w && rail?.hearsPage(e.sender, e.senderFrame) === LOCAL_ID ? w : null;`,
    `ipcMain.handle("filament:desk-show", (e, p) => {\n    const w = deskPage(e);`,
    `return !!ask && !!rail?.showChat(ask.id, ask.hash, ask.rect, ask.theme, ask.focus);`,
    `ipcMain.on("filament:desk-place", (e, rect, keys) => {\n    const w = deskPage(e);\n    if (w) rail?.placeChat(rect ? deskRect(w, rect) : null, keys === true);`,
    `ipcMain.on("filament:desk-hide", (e) => void (deskPage(e) && rail?.hideChat()));`,
    // (fails before: yes — any machine's view, one out of sight or kept from before, pulled the window to its whole page)
    `ipcMain.on("filament:machines-full", (e, route) => {\n    const id = rail?.hearsPage(e.sender, e.senderFrame);\n    if (id && id !== LOCAL_ID && rail?.guest() === id) rail?.openOn(id, String(route ?? ""));`,
    `if (!id || id === LOCAL_ID || rail?.guest() !== id || !DESK_KEYS.includes(String(key)) || !w || w.isDestroyed()) return;\n    w.webContents.focus();\n    w.webContents.send("filament:desk-key", String(key));`,
    // Its Browser pane's pages placed over it where it shows in place too.
    `active: rail?.showing() ?? null,`,
  ])
    assert.ok(main.includes(said), said.slice(0, 60));
});

describe("the app's page", () => {
  const src = readFileSync(new URL("../desktop/rail-page.js", import.meta.url), "utf8");
  /** @returns {{ popPlace: Function, drawRail: Function, hearRail: Function, addFlow: Function, paintSheet: Function, hearSheet: Function, drawPeers: Function, peerLook: Function, peerPick: Function }} */
  const load = () => {
    const box = { module: { exports: {} } };
    vm.runInNewContext(src, box);
    return /** @type {any} */ (box.module.exports);
  };
  const el = (/** @type {Record<string, any>} */ o = {}) => ({ innerHTML: "", ...o });
  // (fails before: yes — the owner's of 11-08: a popover of machines in the rail's place)
  test("draws the state as the app sent it: its colours, the popover's rows under the chip — kept inside the window — the keys on the machine showing as it opens; the sheet over all", () => {
    const { drawRail, popPlace } = load();
    /** @type {Record<string, string>} */
    const props = {};
    const roots = new Set();
    const classes = new Set();
    /** @type {string[]} */
    const focused = [];
    const pick = (/** @type {string} */ id, /** @type {boolean} */ checked) => ({ getAttribute: (/** @type {string} */ k) => (k === "data-machine" ? id : k === "aria-checked" ? String(checked) : null), focus: () => void focused.push(id) });
    const picks = [pick("local", false), pick("m-box", true)];
    const list = el({ querySelectorAll: () => picks });
    /** @type {any} */
    const pop = { offsetWidth: 300, style: {} };
    /** @type {any} */
    const doc = {
      documentElement: {
        style: { setProperty: (/** @type {string} */ k, /** @type {string} */ v) => void (props[k] = v) },
        classList: { toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => void (on ? roots.add(c) : roots.delete(c)) },
      },
      getElementById: (/** @type {string} */ id) => (id === "pop-list" ? list : id === "pop" ? pop : null),
      body: { classList: { toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => void (on ? classes.add(c) : classes.delete(c)), contains: (/** @type {string} */ c) => classes.has(c) } },
      activeElement: null,
      defaultView: { innerWidth: 1440, innerHeight: 920 },
    };
    drawRail(doc, { list: "<div>rows</div>", at: { x: 1300, y: 10, width: 120, height: 28 }, dark: true, bg: "#101010", fg: "#eeeeee", bar: 48 });
    assert.deepEqual(props, { "--bg": "#101010", "--fg": "#eeeeee", "--bar": "48px" });
    assert.ok(roots.has("dark"));
    assert.equal(list.innerHTML, "<div>rows</div>");
    assert.ok(classes.has("pop"));
    assert.deepEqual({ ...pop.style }, { left: "1132px", top: "44px", maxHeight: "868px" }, "under the chip, kept inside the window");
    assert.deepEqual(focused, ["m-box"], "opened: the keys on the machine showing");
    // Drawn again while open: the keys stay where they were.
    doc.activeElement = picks[0];
    drawRail(doc, { list: "<div>rows</div>", at: { x: 1300, y: 10, width: 120, height: 28 }, dark: false });
    assert.deepEqual(focused, ["m-box", "local"]);
    assert.ok(!roots.has("dark"));
    // The sheet: over all, the popover gone.
    drawRail(doc, { list: "", at: null, adding: true, bar: 0 });
    assert.deepEqual([classes.has("pop"), classes.has("adding"), props["--bar"]], [false, true, "0px"]);
    assert.deepEqual({ ...popPlace({ x: 20, y: 10, width: 100, height: 28 }, { width: 1440, height: 300 }) }, { left: 20, top: 44, maxHeight: 248 });
    assert.deepEqual({ ...popPlace({ x: -50, y: 10, width: 100, height: 28 }, { width: 200, height: 100 }) }, { left: 8, top: 44, maxHeight: 120 }, "a narrow window: at its edge, its least height");
  });
  test("an item pressed asks the app for its machine, its ⋯ for its menu, Add a machine for the sheet; a press outside the popover closes it; elsewhere nothing", () => {
    const { hearRail } = load();
    /** @type {Record<string, Function>} */
    const on = {};
    const classes = new Set(["pop"]);
    /** @type {string[]} */
    const said = [];
    hearRail(
      { addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => void (on[ev] = fn), body: { classList: { contains: (/** @type {string} */ c) => classes.has(c) } } },
      { select: (/** @type {string} */ id) => said.push(`select ${id}`), menu: (/** @type {string} */ id) => said.push(`menu ${id}`), openAdd: () => said.push("add"), close: () => said.push("close") },
    );
    const target = (/** @type {Record<string, any>} */ hits, id = "") => ({ id, closest: (/** @type {string} */ q) => hits[q] ?? null });
    on.click({ target: target({ "[data-machine]": { getAttribute: () => "m-box" } }) });
    on.click({ target: target({ "[data-more]": { getAttribute: () => "m-mac" } }) });
    on.click({ target: target({ "[data-add]": {} }) });
    on.click({ target: target({}, "scrim") });
    on.click({ target: target({}, "pop") });
    classes.delete("pop");
    on.click({ target: target({}, "scrim") });
    assert.deepEqual(said, ["select m-box", "menu m-mac", "add", "close"]);
  });
  test("the popover's keys, as a menu's: the arrows, Home and End move between its items, Escape closes it — not while the sheet is open", () => {
    const { hearRail } = load();
    /** @type {Record<string, Function>} */
    const on = {};
    const classes = new Set(["pop"]);
    /** @type {string[]} */
    const said = [];
    /** @type {any} */
    const doc = {
      activeElement: null,
      addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => void (on[ev] = fn),
      body: { classList: { contains: (/** @type {string} */ c) => classes.has(c) } },
      getElementById: (/** @type {string} */ id) => (id === "pop" ? { querySelectorAll: () => items } : null),
    };
    const items = ["a", "b", "c"].map((n) => ({ n, focus() { doc.activeElement = this; } }));
    hearRail(doc, { select() {}, close: () => said.push("close") });
    const key = (/** @type {string} */ k) => {
      let stopped = 0;
      on.keydown({ key: k, preventDefault: () => stopped++ });
      return stopped;
    };
    const at = () => doc.activeElement?.n ?? null;
    doc.activeElement = items[0];
    const went = ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "Home", "End"].map((k) => (key(k), at()));
    assert.deepEqual(went, ["b", "c", "a", "c", "a", "c"], "round, both ways");
    doc.activeElement = null;
    key("ArrowUp");
    assert.equal(at(), "c", "none focused: Up the last");
    assert.equal(key("x"), 0, "another key: the page's");
    assert.equal(key("Escape"), 1);
    assert.deepEqual(said, ["close"]);
    classes.add("adding");
    key("Escape");
    assert.deepEqual(said, ["close"], "the sheet's Escape is its own");
  });

  // (fails before: yes — the rail had no way to add a machine)
  test("the Add sheet's steps: who answers first; a certificate nothing vouches for, compared before anything is sent; then Pair; refusals said", async () => {
    const { addFlow } = load();
    /** @type {any[]} */
    const asked = [];
    /** @type {any[]} */
    const answers = [];
    /** @type {any[]} */
    const shown = [];
    let closed = 0;
    const flow = addFlow({ add: async (/** @type {any} */ i) => (asked.push({ ...i }), answers.shift()), closeAdd: () => closed++ }, (/** @type {any} */ v) => shown.push(v));
    flow.reset();
    await flow.go();
    assert.match(shown.at(-1).words, /^Paste the link, or type the address/);
    assert.equal(shown.at(-1).err, true);
    assert.deepEqual(asked, [], "nothing asked with no address");
    flow.edit("192.168.0.9:20343", "");
    answers.push({ ok: false, ask: "fingerprint", url: "https://192.168.0.9:20343", seen: "AA:BB", words: "compare it" });
    await flow.go();
    assert.deepEqual(asked.at(-1), { op: "check", link: "192.168.0.9:20343", code: "", fingerprint: "" });
    assert.deepEqual([shown.at(-1).phase, shown.at(-1).seen, shown.at(-1).words], ["compare", "AA:BB", "compare it"]);
    flow.notSame();
    assert.equal(shown.at(-1).phase, "enter");
    assert.match(shown.at(-1).words, /^Nothing was sent./);
    answers.push({ ok: false, ask: "fingerprint", url: "https://192.168.0.9:20343", seen: "AA:BB", words: "compare it" });
    await flow.go();
    answers.push({ ok: true, url: "https://192.168.0.9:20343", name: "Studio", fingerprint: "AA:BB", kept: false, code: false });
    await flow.go();
    assert.deepEqual(asked.at(-1), { op: "check", link: "192.168.0.9:20343", code: "", fingerprint: "AA:BB" }, "It is the same: the fingerprint said, to pin");
    assert.equal(shown.at(-1).phase, "ready");
    assert.equal(shown.at(-1).who.name, "Studio");
    await flow.go();
    assert.match(shown.at(-1).words, /^Type the code Settings › Remote access shows on Studio/, "no code: asked for before a pairing");
    flow.edit("192.168.0.9:20343", "ABCD-EFGH");
    answers.push({ ok: false, words: "That code is wrong or has run out." });
    await flow.go();
    assert.deepEqual(asked.at(-1), { op: "pair", link: "192.168.0.9:20343", code: "ABCD-EFGH", fingerprint: "AA:BB" });
    assert.deepEqual([shown.at(-1).phase, shown.at(-1).words, shown.at(-1).err], ["ready", "That code is wrong or has run out.", true], "another code may follow");
    answers.push({ ok: true, name: "Studio" });
    flow.edit("192.168.0.9:20343", "WXYZ-2345");
    await flow.go();
    assert.equal(shown.at(-1).words, "Paired with Studio.");
    flow.edit("192.168.0.10:20343", "WXYZ-2345");
    assert.deepEqual([shown.at(-1).phase, shown.at(-1).who], ["enter", null], "another address starts over");
    flow.cancel();
    assert.equal(closed, 1);
  });

  // (fails before: yes — no SSH route)
  test("the sheet through an SSH tunnel: no code asked, its field held, Add for Pair; who answers said through the tunnel", async () => {
    const { addFlow, paintSheet } = load();
    /** @type {any[]} */
    const asked = [];
    /** @type {any[]} */
    const answers = [{ ok: true, id: "m-new", url: "http://127.0.0.1:5555", name: "Studio", fingerprint: "", kept: false, code: false, ssh: "filtest" }, { ok: true, name: "Studio" }];
    /** @type {any[]} */
    const shown = [];
    const flow = addFlow({ add: async (/** @type {any} */ i) => (asked.push({ ...i }), answers.shift()), closeAdd: () => {} }, (/** @type {any} */ v) => shown.push(v));
    flow.reset();
    flow.edit("ssh://filtest", "");
    await flow.go();
    assert.equal(shown.at(-1).phase, "ready");
    const { doc, els } = sheetDoc();
    /** @type {[string, boolean][]} */
    const prose = [];
    els["add-who-print"].classList = { toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => void prose.push([c, on]) };
    paintSheet(doc, shown.at(-1));
    assert.deepEqual([els["add-go"].textContent, els["add-code"].disabled, els["add-who"].hidden], ["Add", true, false]);
    assert.deepEqual(prose.at(-1), ["prose", true], "words in the fingerprint's place: drawn as words");
    assert.equal(els["add-who-name"].textContent, "Studio answers through an SSH tunnel to filtest");
    assert.match(els["add-who-print"].textContent, /^No code: ssh signed in with your keys/);
    const going = flow.go();
    assert.equal(shown.at(-1).words, "Adding Studio…");
    await going;
    assert.deepEqual(asked.at(-1), { op: "pair", link: "ssh://filtest", code: "", fingerprint: "", expect: "m-new" }, "no code asked for");
    assert.equal(shown.at(-1).words, "Added Studio.");
    paintSheet(doc, { phase: "ready", busy: false, words: "", err: false, who: { name: "Studio", url: "https://192.168.0.9:20343", fingerprint: "AA:BB", kept: true }, seen: "" });
    assert.deepEqual([els["add-go"].textContent, els["add-code"].disabled, els["add-who-name"].textContent], ["Pair", false, "Studio answers at https://192.168.0.9:20343"], "a network machine: Pair, and its code");
    assert.deepEqual(prose.at(-1), ["prose", false], "a fingerprint: drawn as one");
    assert.match(els["add-who-kept"].textContent, /^It is in this window already: pairing again/);
  });

  // (fails before: yes — Enter accepted a fingerprint unread, an answer after Cancel painted the new sheet, Pair named no machine)
  test("the sheet's guards: Enter never says a fingerprint is the same; an answer from before the sheet opened anew is not shown; Pair names the machine shown", async () => {
    const { addFlow, hearSheet } = load();
    /** @type {any[]} */
    const asked = [];
    /** @type {any[]} */
    const answers = [];
    /** @type {any[]} */
    const shown = [];
    const flow = addFlow({ add: async (/** @type {any} */ i) => (asked.push({ ...i }), answers.shift()), closeAdd: () => {} }, (/** @type {any} */ v) => shown.push(v));
    flow.reset();
    flow.edit("192.168.0.9:20343", "");
    answers.push({ ok: false, ask: "fingerprint", url: "https://192.168.0.9:20343", seen: "AA:BB", words: "compare it" });
    await flow.go({ byEnter: true });
    assert.equal(shown.at(-1).phase, "compare", "Enter continues");
    await flow.go({ byEnter: true });
    assert.equal(asked.length, 1, "but says no fingerprint is the same");
    assert.match(shown.at(-1).words, /^Compare the fingerprint with the one that machine shows/);
    answers.push({ ok: true, id: "m-studio", url: "https://192.168.0.9:20343", name: "Studio", fingerprint: "AA:BB", kept: false, code: true });
    await flow.go();
    assert.deepEqual([asked.at(-1).fingerprint, shown.at(-1).phase], ["AA:BB", "ready"], "the button says it");
    answers.push({ ok: true, name: "Studio" });
    await flow.go();
    assert.equal(asked.at(-1).expect, "m-studio", "Pair names the machine Continue showed");

    /** @type {() => void} */
    let release = () => {};
    const later = addFlow({ add: () => new Promise((r) => (release = () => r({ ok: false, words: "old words" }))), closeAdd: () => {} }, (/** @type {any} */ v) => shown.push(v));
    later.reset();
    later.edit("192.168.0.9:20343", "");
    const p = later.go();
    later.reset();
    const n = shown.length;
    release();
    await p;
    assert.equal(shown.length, n, "nothing painted over the sheet opened anew");
    assert.deepEqual([shown.at(-1).phase, shown.at(-1).busy, shown.at(-1).words], ["enter", false, ""]);

    /** @type {Record<string, Function>} */
    const on = {};
    /** @type {Record<string, any>} */
    const els = {};
    const doc = {
      getElementById: (/** @type {string} */ id) => (els[id] ??= { value: "", addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => void (on[`${id}:${ev}`] = fn) }),
      addEventListener: () => {},
      body: { classList: { contains: () => true } },
    };
    /** @type {any[]} */
    const went = [];
    hearSheet(doc, { edit: () => {}, go: (/** @type {any} */ o) => went.push(o?.byEnter), cancel: () => {}, notSame: () => {} });
    on["add-form:keydown"]({ key: "Enter", target: { tagName: "INPUT" } });
    on["add-form:submit"]({ preventDefault() {} });
    on["add-form:keydown"]({ key: "Enter", target: { tagName: "BUTTON" } });
    on["add-form:submit"]({ preventDefault() {} });
    assert.deepEqual(went, [true, false], "Enter in a field said apart; on the button itself, a press");
  });

  test("Add a machine opens the sheet; a right-click on a machine opens its menu, This computer's too (its Colour and Icon)", () => {
    const { hearRail } = load();
    /** @type {Record<string, Function>} */
    const on = {};
    /** @type {string[]} */
    const said = [];
    hearRail({ addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => void (on[ev] = fn) }, { select: (/** @type {string} */ id) => said.push(`select ${id}`), openAdd: () => said.push("add"), menu: (/** @type {string} */ id) => said.push(`menu ${id}`) });
    on.click({ target: { closest: (/** @type {string} */ q) => (q === "[data-add]" ? {} : null) } });
    const box = { getAttribute: () => "m-box" };
    let stopped = 0;
    on.contextmenu({ target: { closest: (/** @type {string} */ q) => (q === "[data-machine]" ? box : null) }, preventDefault: () => stopped++ });
    on.contextmenu({ target: { closest: (/** @type {string} */ q) => (q === "[data-machine]" ? { getAttribute: () => "local" } : null) }, preventDefault: () => stopped++ });
    assert.deepEqual(said, ["add", "menu m-box", "menu local"]);
    assert.equal(stopped, 2, "no browser menu over the popover's items");
  });

  /** A page's elements, faked as far as the sheet's tailnet list goes. */
  const sheetDoc = () => {
    /** @type {Record<string, any>} */
    const els = {};
    const make = (/** @type {string} */ tag) => {
      /** @type {any} */
      const e = { tag, textContent: "", hidden: false, disabled: false, value: "", children: [], on: {}, classList: { toggle() {} } };
      e.append = (/** @type {any[]} */ ...c) => void e.children.push(...c);
      e.replaceChildren = (/** @type {any[]} */ ...c) => void (e.children = c);
      e.addEventListener = (/** @type {string} */ ev, /** @type {Function} */ fn) => void (e.on[ev] = fn);
      e.focus = () => void (doc.focused = e);
      e.querySelectorAll = (/** @type {string} */ q) => (q === "button" ? e.children.filter((/** @type {any} */ c) => c.tag === "button") : []);
      return e;
    };
    /** @type {any} */
    const doc = { focused: null, createElement: make, getElementById: (/** @type {string} */ id) => els[id] ?? null };
    for (const id of ["add-peers", "add-peers-said", "add-peers-list", "add-link", "add-code", "add-go", "add-back", "add-print", "add-print-fp", "add-who", "add-who-name", "add-who-print", "add-who-kept", "add-said"]) els[id] = make(id);
    return { doc, els };
  };
  const turn = () => new Promise((r) => setImmediate(r));

  // (fails before: yes — the sheet had no list of the tailnet's machines)
  test("the tailnet's machines drawn: a button each, its name as text, its address, one added marked; none and nothing to say, hidden", () => {
    const { drawPeers } = load();
    const { doc, els } = sheetDoc();
    /** @type {string[]} */
    const picked = [];
    const pick = (/** @type {string} */ u) => picked.push(u);
    drawPeers(doc, null, pick);
    assert.deepEqual([els["add-peers"].hidden, els["add-peers-said"].textContent], [false, "Looking for Filament on your tailnet…"]);
    drawPeers(
      doc,
      {
        found: [
          { url: "https://studio.tail1234.ts.net", host: "studio.tail1234.ts.net", name: "<img src=x onerror=alert(1)>", kept: true },
          { url: "https://phone.tail1234.ts.net", host: "phone.tail1234.ts.net", name: "", owner: "friend@example.com", kept: false },
        ],
        words: "",
      },
      pick,
    );
    const [a, b] = els["add-peers-list"].children;
    assert.equal(els["add-peers"].hidden, false);
    assert.match(els["add-peers-said"].textContent, /^On your tailnet — press one/);
    assert.deepEqual([a.tag, a.type, a.className, a.children[0].textContent, a.children[1].textContent], ["button", "button", "peer", "<img src=x onerror=alert(1)>", "studio.tail1234.ts.net · added"], "a name is text, never markup");
    assert.deepEqual([b.children[0].textContent, b.children[1].textContent], ["phone.tail1234.ts.net", "phone.tail1234.ts.net · shared by friend@example.com"], "no name: its address; another's machine said so");
    b.on.click();
    assert.deepEqual(picked, ["https://phone.tail1234.ts.net"]);
    drawPeers(doc, { found: [], words: "No other machine of your tailnet is online." }, pick);
    assert.deepEqual([els["add-peers"].hidden, els["add-peers-said"].textContent, els["add-peers-list"].children.length], [false, "No other machine of your tailnet is online.", 0]);
    drawPeers(doc, { found: [], words: "" }, pick);
    assert.equal(els["add-peers"].hidden, true, "no Tailscale here: nothing shown");
    els["add-link"].disabled = true;
    drawPeers(doc, { found: [{ url: "https://x.y.ts.net", host: "x.y.ts.net", name: "X" }], words: "" }, pick);
    assert.equal(els["add-peers-list"].children[0].disabled, true, "drawn mid-step: not pressed");
  });

  test("the sheet asks the tailnet as it opens: hidden first, Looking… once slow, an answer for a sheet since closed or opened anew not drawn; a step under way holds its buttons", async () => {
    const { peerLook, paintSheet, drawPeers } = load();
    const { doc, els } = sheetDoc();
    /** @type {{ fn: Function, ms: number }[]} */
    const timers = [];
    /** @type {any[]} */
    const stopped = [];
    /** @type {Function[]} */
    const answer = [];
    const bridge = { tailnet: () => new Promise((r) => answer.push(r)) };
    const look = peerLook(doc, bridge, () => {}, { later: (/** @type {Function} */ fn, /** @type {number} */ ms) => (timers.push({ fn, ms }), timers.length), stop: (/** @type {any} */ t) => stopped.push(t) });
    els["add-peers"].hidden = false;
    els["add-peers-said"].textContent = "On your tailnet — from the last time";
    look.open();
    assert.equal(els["add-peers"].hidden, true, "the last sheet's list gone at once");
    assert.ok(timers[0].ms > 0 && timers[0].ms <= 300);
    timers[0].fn();
    assert.equal(els["add-peers-said"].textContent, "Looking for Filament on your tailnet…");
    await turn();
    answer[0]({ found: [{ url: "https://studio.tail1234.ts.net", host: "studio.tail1234.ts.net", name: "Studio" }], words: "" });
    await turn();
    assert.deepEqual(stopped, [1]);
    assert.equal(els["add-peers-list"].children.length, 1);
    look.open();
    look.close();
    await turn();
    timers[1].fn();
    answer[1]({ found: [{ url: "https://a.b.ts.net", host: "a.b.ts.net", name: "A" }, { url: "https://c.d.ts.net", host: "c.d.ts.net", name: "C" }], words: "" });
    await turn();
    assert.deepEqual([els["add-peers"].hidden, els["add-peers-list"].children.length], [true, 0], "closed meanwhile: neither Looking… nor its answer drawn");
    look.open();
    await turn();
    look.open();
    await turn();
    answer[2]({ found: [{ url: "https://old.b.ts.net", host: "old.b.ts.net", name: "Old" }], words: "" });
    answer[3]({ found: [], words: "No other machine of your tailnet is online." });
    await turn();
    assert.deepEqual([els["add-peers-said"].textContent, els["add-peers-list"].children.length], ["No other machine of your tailnet is online.", 0], "opened anew: the old ask's answer not drawn");
    const refused = peerLook(doc, { tailnet: async () => { throw new Error("no handler"); } }, () => {}, { later: (/** @type {Function} */ fn) => (fn(), 0), stop: () => {} });
    refused.open();
    assert.equal(els["add-peers"].hidden, false, "Looking…");
    await turn();
    await turn();
    assert.equal(els["add-peers"].hidden, true, "an ask refused: nothing shown");

    drawPeers(doc, { found: [{ url: "https://s.t.ts.net", host: "s.t.ts.net", name: "S" }], words: "" }, () => {});
    paintSheet(doc, { phase: "enter", busy: true, words: "", err: false, who: null, seen: "" });
    assert.equal(els["add-peers-list"].children[0].disabled, true, "a step under way: its buttons held");
    paintSheet(doc, { phase: "enter", busy: false, words: "", err: false, who: null, seen: "" });
    assert.equal(els["add-peers-list"].children[0].disabled, false);
  });

  test("a machine of the tailnet pressed: its address in the field as if typed, the code's field next; not mid-step", () => {
    const { peerPick } = load();
    const { doc, els } = sheetDoc();
    /** @type {string[][]} */
    const edits = [];
    const pick = peerPick(doc, { edit: (/** @type {string} */ l, /** @type {string} */ c) => edits.push([l, c]) });
    els["add-code"].value = "ABCD-EFGH";
    pick("https://studio.tail1234.ts.net");
    assert.deepEqual([els["add-link"].value, edits, doc.focused], ["https://studio.tail1234.ts.net", [["https://studio.tail1234.ts.net", "ABCD-EFGH"]], els["add-code"]]);
    els["add-link"].disabled = true;
    pick("https://phone.tail1234.ts.net");
    assert.equal(els["add-link"].value, "https://studio.tail1234.ts.net");
    assert.equal(edits.length, 1);
  });
});

// The remote desk of 11-22 (s1j): another machine's chat shown in place over This computer's column beside its list.
describe("another machine's chat shown in place", () => {
  const COL = { x: 280, y: 0, width: 1160, height: 920 };
  const BOX_PAGE = "https://box.tail1234.ts.net/ui/harness.html";
  /** A rig whose box answers, and what This computer's page was told of the chat shown in place. @param {Record<string, any>} [o] */
  const desk = async (o = {}) => {
    /** @type {any[]} */
    const told = [];
    const t = rig({ answers: { "m-box": answered(BOX.routes[1]) }, onGuest: (g) => void told.push(g), ...o });
    await t.settle();
    return { ...t, told, box: () => t.viewOf("persist:machine-m-box") };
  };

  // (fails before: yes — a chat of another machine's opened its whole page over the window, This computer's list with it)
  test("its view over the column alone, its page the chat alone in the desk's look; another chat moves its page, a look loads it anew; This computer's column alone undragged", async () => {
    const t = await desk();
    assert.equal(t.r.showChat("m-box", "#/task/c1", COL, "light", true), true);
    await t.settle();
    const v = t.box();
    assert.deepEqual(v.webContents.loads, [`${BOX_PAGE}?only=chat&theme=light#/task/c1`], "opened there as it answered, at the chat");
    assert.equal(t.r.active(), LOCAL_ID, "This computer still shows");
    assert.equal(t.r.guest(), "m-box");
    assert.equal(t.r.showing(), "m-box");
    assert.deepEqual(v.bounds, COL);
    assert.equal(v.visible, true);
    assert.equal(t.win.children.at(-1), v, "over This computer's page");
    assert.deepEqual(t.win.webContents.css, [UNDRAG_COLUMN_CSS], "that page's column drags no more; its list's top row still does");
    assert.ok(v.webContents.focused > 0, "the keys its");
    // Another chat of its: moved within its page, the same address but its hash — no load anew.
    assert.equal(t.r.showChat("m-box", "#/task/c2/plan", COL, "light"), true);
    assert.equal(v.webContents.loads.at(-1), `${BOX_PAGE}?only=chat&theme=light#/task/c2/plan`);
    // The desk's look moved: its page in the new one, the keys left where they are.
    const keys = v.webContents.focused;
    assert.equal(t.r.showChat("m-box", "#/task/c2", COL, "dark"), true);
    assert.equal(v.webContents.loads.at(-1), `${BOX_PAGE}?only=chat&theme=dark#/task/c2`);
    assert.equal(v.webContents.focused, keys, "not asked: not taken");
    assert.equal(t.views.filter((x) => x.prefs.partition === "persist:machine-m-box").length, 1, "one view all along");
  });

  test("out of sight while something of This computer's page lies over the column, back as it goes; let go, its view kept out of sight and the column the page's again", async () => {
    const t = await desk();
    t.r.showChat("m-box", "#/task/c1", COL, "dark");
    await t.settle();
    const v = t.box();
    t.r.placeChat(null);
    assert.equal(v.visible, false);
    assert.equal(t.r.guest(), null, "not in sight");
    assert.equal(t.r.showing(), LOCAL_ID);
    await t.settle();
    assert.deepEqual(t.win.webContents.removed, ["key-1"], "the column drags again under the menu");
    const moved = { ...COL, x: 48, width: 1392 };
    const keys = v.webContents.focused;
    t.r.placeChat(moved);
    assert.deepEqual([v.visible, v.bounds], [true, moved], "back, where the column is now (its bar folded)");
    assert.deepEqual(t.win.webContents.css, [UNDRAG_COLUMN_CSS, UNDRAG_COLUMN_CSS]);
    assert.equal(v.webContents.focused, keys, "the keys left where they are");
    // (fails before: yes — nothing gave the keys back to it once a dialog of This computer's page it opened was gone)
    t.r.placeChat(moved, true);
    assert.equal(v.webContents.focused, keys + 1, "the keys its again, where it stood");
    t.r.placeChat(null, true);
    assert.equal(v.webContents.focused, keys + 1, "out of sight: not");
    t.r.placeChat(moved);
    const focused = t.win.webContents.focused;
    t.r.hideChat();
    assert.equal(v.visible, false);
    assert.equal(t.r.guest(), null);
    assert.equal(t.win.webContents.focused, focused + 1, "the keys This computer's page's");
    await t.settle();
    assert.deepEqual(t.win.webContents.removed, ["key-1", "key-2", "key-3"], "each time out of sight, and let go");
    assert.equal(v.webContents.closed, false, "kept for the next");
    assert.deepEqual(t.told, [], "the page let it go itself: nothing to tell it");
    // Shown again in the same look: its page moves to the chat, no load anew.
    t.r.showChat("m-box", "#/task/c3", COL, "dark");
    assert.deepEqual(v.webContents.loads.slice(-1), [`${BOX_PAGE}?only=chat&theme=dark#/task/c3`]);
    assert.equal(v.visible, true);
  });

  // (fails before: yes — nothing followed a chat's page once it went elsewhere)
  test("its page's own address followed — another chat of its, Back — and This computer's page told; another origin's, or a frame's, not", async () => {
    const t = await desk();
    t.r.showChat("m-box", "#/task/c1", COL, "dark");
    await t.settle();
    const v = t.box();
    v.webContents.emit("did-navigate-in-page", {}, `${BOX_PAGE}?only=chat&theme=dark#/task/c9`, true);
    assert.deepEqual(t.told, [{ id: "m-box", hash: "#/task/c9" }]);
    v.webContents.emit("did-navigate-in-page", {}, `${BOX_PAGE}#/task/frame`, false);
    v.webContents.emit("did-navigate-in-page", {}, "https://evil.example/ui/harness.html#/task/x", true);
    assert.equal(t.told.length, 1, "neither");
    // Shown whole by its key or its pick: its whole page, at the chat its page went to; This computer's page told it went.
    assert.equal(t.r.select("m-box"), true);
    assert.equal(v.webContents.loads.at(-1), `${BOX_PAGE}#/task/c9`);
    assert.deepEqual(t.told.at(-1), { id: "m-box", hash: null });
    assert.deepEqual(v.bounds, { x: 0, y: 0, width: 1440, height: 920 }, "over the whole window");
    assert.deepEqual(t.win.webContents.css, [UNDRAG_COLUMN_CSS, UNDRAG_CSS], "This computer's page wholly covered");
  });

  // (fails before: yes — the chat alone had no way to its machine's whole page)
  test("its page asks for its whole page at a screen: shown whole there, its chat gone from the column", async () => {
    const t = await desk();
    t.r.showChat("m-box", "#/task/c1", COL, "dark");
    await t.settle();
    const v = t.box();
    assert.equal(t.r.openOn("m-box", "#/settings/general"), true);
    assert.equal(v.webContents.loads.at(-1), `${BOX_PAGE}#/settings/general`);
    assert.equal(t.r.active(), "m-box");
    assert.deepEqual(t.told, [{ id: "m-box", hash: null }]);
    // Shown in place again later: the chat alone anew.
    t.r.select(LOCAL_ID);
    assert.equal(t.r.showChat("m-box", "#/task/c1", COL, "dark"), true);
    assert.equal(v.webContents.loads.at(-1), `${BOX_PAGE}?only=chat&theme=dark#/task/c1`);
  });

  test("its chip's popover opens under it, where its view stands; its title bar's colours are the window's while it shows; the room the controls take lent over its column alone", async () => {
    const t = await desk();
    t.r.showChat("m-box", "#/task/c1", COL, "dark");
    await t.settle();
    const v = t.box();
    assert.deepEqual(stateOf(v.webContents).frame, { left: 0, right: WIN_RIGHT }, "Windows' buttons over its right end");
    t.r.tintFrom("m-box", { color: "#202020", symbolColor: "#eeeeee" });
    assert.deepEqual(t.tinted.at(-1), { color: "#202020", symbolColor: "#eeeeee" });
    assert.equal(t.r.openPop("m-mac", { x: 1, y: 1, width: 1, height: 1 }), false, "a page not before the person: no");
    assert.equal(t.r.openPop("m-box", { x: 900, y: 6, width: 90, height: 28 }), true);
    assert.deepEqual(t.railView().webContents.sent.at(-1)[1].at, { x: 1180, y: 6, width: 90, height: 28 }, "its chip where its view stands");
    assert.equal(stateOf(v.webContents).open, true);
  });

  test("the room lent: what of the controls' room lies over the column, on Windows and a Mac", () => {
    assert.deepEqual(lentFrame({ platform: "win32", at: COL, width: 1440 }), { left: 0, right: WIN_RIGHT });
    assert.deepEqual(lentFrame({ platform: "win32", at: { ...COL, width: 1000 }, width: 1440 }), { left: 0, right: 0 }, "short of the right end");
    assert.deepEqual(lentFrame({ platform: "darwin", at: COL, width: 1440 }), { left: 0, right: 0 }, "the list under a Mac's buttons");
    assert.deepEqual(lentFrame({ platform: "darwin", at: { x: 48, y: 0, width: 1392, height: 900 }, width: 1440 }), { left: MAC_LEFT - 48, right: 0 }, "the bar folded: what of them is over it");
    assert.deepEqual(lentFrame({ platform: "darwin", area: { left: 90, right: 0 }, zoom: 2, at: { x: 48, y: 0, width: 100, height: 100 }, width: 148 }), { left: 21, right: 0 }, "in its page's pixels");
    assert.equal(lentFrame({ full: true, at: COL, width: 1440 }), null);
  });

  // (fails before: yes — the leak hunt of 11-19: a page moved from chat to chat for long kept what it drew)
  test(`after ${GUEST_MOVES} chats moved to in one page, its view made anew where it is reached — no ask again, nothing told`, async () => {
    const t = await desk();
    for (let i = 1; i <= GUEST_MOVES + 1; i++) t.r.showChat("m-box", `#/task/c${i}`, COL, "dark");
    await t.settle();
    const boxes = () => t.views.filter((x) => x.prefs.partition === "persist:machine-m-box");
    assert.equal(boxes().length, 1, `${GUEST_MOVES + 1} chats: one page`);
    const old = boxes()[0];
    t.r.showChat("m-box", "#/task/next", COL, "dark");
    assert.equal(boxes().length, 2, "made anew");
    assert.equal(old.webContents.closed, true);
    const fresh = boxes()[1];
    assert.deepEqual(fresh.webContents.loads, [`${BOX_PAGE}?only=chat&theme=dark#/task/next`], "at the chat at once");
    assert.deepEqual([fresh.visible, fresh.bounds], [true, COL]);
    assert.deepEqual(t.told, [], "This computer's page still shows it");
    assert.equal(t.r.guest(), "m-box");
  });

  test("refused: This computer, a machine not kept or disconnected, an address none of a harness's, that machine shown whole, or the Add sheet open", async () => {
    const t = await desk();
    assert.equal(t.r.showChat(LOCAL_ID, "#/task/c1", COL, "dark"), false);
    assert.equal(t.r.showChat("m-none", "#/task/c1", COL, "dark"), false);
    for (const bad of ["javascript:alert(1)", "https://elsewhere.example/#/", "#/task/a b", "", "#/x#/y"]) assert.equal(t.r.showChat("m-box", bad, COL, "dark"), false, bad);
    t.r.openAdd();
    assert.equal(t.r.showChat("m-box", "#/task/c1", COL, "dark"), false);
    t.r.closeAdd();
    assert.equal(t.box(), undefined, "no view made for any");
    t.r.select("m-box");
    assert.equal(t.r.showChat("m-box", "#/task/c1", COL, "dark"), false, "its whole page before the person: not made the chat alone under them");
  });

  // (fails before: yes — the desk's look moved while another machine showed whole was refused, and never asked again)
  test("asked while another machine shows whole: it waits out of sight, the keys left there, and is in sight as This computer shows again", async () => {
    const t = await desk();
    t.r.select("m-mac");
    assert.equal(t.r.showChat("m-box", "#/task/c1", COL, "light", true), true);
    await t.settle();
    const v = t.box();
    assert.deepEqual([v.visible, t.r.guest(), t.r.active()], [false, null, "m-mac"]);
    assert.equal(v.webContents.focused, 0);
    assert.equal(v.webContents.loads.at(-1), `${BOX_PAGE}?only=chat&theme=light#/task/c1`);
    t.r.select(LOCAL_ID);
    assert.deepEqual([v.visible, v.bounds, t.r.guest()], [true, COL, "m-box"]);
  });

  test("its machine removed from the window, or This computer's page loaded anew: gone from the column — told, where the page did not let it go", async () => {
    const t = await desk();
    t.r.showChat("m-box", "#/task/c1", COL, "dark");
    await t.settle();
    t.win.webContents.emit("did-navigate");
    assert.equal(t.r.guest(), null);
    assert.equal(t.box().visible, false);
    assert.deepEqual(t.told, [], "the page loaded anew knows of none");
    t.r.showChat("m-box", "#/task/c1", COL, "dark");
    t.setList([localMachine(ORIGIN), MAC]);
    t.r.refresh();
    assert.deepEqual(t.told, [{ id: "m-box", hash: null }]);
    assert.equal(t.r.guest(), null);
  });

  test("what This computer's page asks to show in place, read as the app takes it", () => {
    const place = (/** @type {any} */ r, /** @type {number} */ z) => (r ? { x: r.x * z, y: r.y * z, width: r.width * z, height: r.height * z } : null);
    assert.deepEqual(showAsk({ machine: "m-box", route: "#/task/c1", rect: { x: 10, y: 0, width: 100, height: 50 }, theme: "light" }, 2, { width: 1440, height: 900 }, place), { id: "m-box", hash: "#/task/c1", rect: { x: 20, y: 0, width: 200, height: 100 }, theme: "light", focus: false });
    assert.equal(showAsk({ machine: "m-box", route: "#/task/c1", theme: "sepia" }, 1, { width: 1, height: 1 }, place)?.theme, "dark");
    assert.equal(showAsk({ machine: "m-box", route: "#/task/c1", focus: true }, 1, { width: 1, height: 1 }, place)?.focus, true);
    assert.equal(showAsk({ machine: "m-box", route: "#/task/c1", focus: "yes" }, 1, { width: 1, height: 1 }, place)?.focus, false);
    for (const p of [{ machine: LOCAL_ID, route: "#/" }, { machine: "../x", route: "#/" }, { machine: "m.box", route: "#/" }, { machine: "x".repeat(65), route: "#/" }, { machine: "m-box", route: "#/a b" }, { machine: "m-box", route: `#/${"x".repeat(2000)}` }, null])
      assert.equal(showAsk(p, 1, { width: 1, height: 1 }, place), null, JSON.stringify(p)?.slice(0, 40));
    // (fails before: yes — the hunt on s1e) Any id the machines file keeps: one with an underscore too.
    assert.equal(showAsk({ machine: "m_box", route: "#/task/c1" }, 1, { width: 1, height: 1 }, place)?.id, "m_box");
  });
});
