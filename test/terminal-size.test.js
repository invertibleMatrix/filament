// @ts-check
// A server terminal's view (src/ui/harness/lib/xterm.js) and the shell's size (the owner's of 11-08: typing in the
// Terminal pane landed over earlier lines). The shell takes the size the view comes to rest at — a pane sliding open
// gave it one each frame, from 2 columns up, and a Windows shell wraps its screen again at each — and the size fitted
// before the stream opened; and a view told the Windows console stands behind it grows as that console does. xterm, its
// fit addon, the box's size, the clock and the WebSocket are stand-ins; the server's side is test/terminal.test.js's.
import { test, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { pageEvents } from "./helpers/page-events.js";
import { createTerminalService } from "../src/services/terminal.js";
import { windowsPtyOf } from "../src/adapters/terminal/pty.js";

const g = /** @type {any} */ (globalThis);
const had = { window: g.window, WebSocket: g.WebSocket, getComputedStyle: g.getComputedStyle, ResizeObserver: g.ResizeObserver, document: g.document, location: g.location };
after(() => {
  for (const [k, v] of Object.entries(had)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

/** What the fit addon fits the terminal to: the box's size in cells. */
let fits = { cols: 120, rows: 40 };
/** The terminals made, newest last. @type {FakeTerminal[]} */
let terms = [];
class FakeTerminal {
  cols = 80;
  rows = 24;
  /** @type {any} */ options = {};
  /** xterm measures its cell once its box shows; one opened hidden has none (xterm's charSizeService). */
  measured = false;
  /** @type {any} */ el = null;
  /** @type {((s: { cols: number, rows: number }) => void)[]} */
  resized = [];
  /** What the view's textarea was told to hear. @type {Record<string, () => void>} */
  heard = {};
  textarea = { addEventListener: (/** @type {string} */ type, /** @type {() => void} */ fn) => { this.heard[type] = fn; } };
  constructor() { terms.push(this); }
  loadAddon(/** @type {any} */ fit) { fit.term = this; }
  open(/** @type {any} */ el) { this.el = el; }
  attachCustomKeyEventHandler() {}
  onData() {}
  /** @param {(s: { cols: number, rows: number }) => void} fn */
  onResize(fn) { this.resized.push(fn); }
  /** xterm's: a resize to the size it has measures an unmeasured cell. @param {number} c @param {number} r */
  resize(c, r) {
    if (c === this.cols && r === this.rows) {
      this.measured = this.el.clientWidth > 0;
      return;
    }
    this.cols = c;
    this.rows = r;
    for (const fn of this.resized) fn({ cols: c, rows: r });
  }
  write() {}
  focus() {}
  dispose() {}
}
class FakeFit {
  /** @type {any} */ term = null;
  /** None where the cell is unmeasured, as the addon's. */
  proposeDimensions() { return this.term.measured ? { ...fits } : undefined; }
  fit() {
    const d = this.proposeDimensions();
    if (d) this.term.resize(d.cols, d.rows);
  }
}
/** @type {any[]} */
let sockets = [];
g.window = { Terminal: FakeTerminal, FitAddon: { FitAddon: FakeFit } };
g.WebSocket = class {
  /** @param {string} url */
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    /** @type {(() => void) | null} */
    this.onopen = null;
    /** @type {((e: { data: string }) => void) | null} */
    this.onmessage = null;
    /** @type {any[]} */
    this.sent = [];
    sockets.push(this);
  }
  /** @param {string} m */
  send(m) { this.sent.push(JSON.parse(m)); }
  close() {}
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  /** @param {any} msg */
  hear(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
};
g.getComputedStyle = () => ({ getPropertyValue: () => "" });
/** @type {(() => void)[]} */
let observed = [];
g.ResizeObserver = class {
  /** @param {() => void} fn */
  constructor(fn) { this.fn = fn; }
  observe() { observed.push(this.fn); }
  disconnect() {}
};
g.document = { documentElement: {} };
pageEvents();
g.location = { ...g.location, protocol: "http:", host: "127.0.0.1:1" };
const { showTerminal, SIZE_SETTLE_MS } = await import("../src/ui/harness/lib/xterm.js");

const sizes = (/** @type {any} */ ws) => ws.sent.filter((/** @type {any} */ m) => m.t === "r").map((/** @type {any} */ m) => `${m.c}x${m.r}`);
/** The box's size changing to `cols` × `rows`, as the observer hears it. @param {number} cols @param {number} rows */
const boxTo = (cols, rows) => {
  fits = { cols, rows };
  observed[0]();
};
beforeEach(() => {
  terms = [];
  sockets = [];
  observed = [];
  fits = { cols: 120, rows: 40 };
  mock.timers.enable({ apis: ["setTimeout"] });
});
afterEach(() => mock.timers.reset());

// (fails before: yes — the size was heard only once the stream opened, so a fit before it was lost and the one at its
// opening, the same size, said nothing: the shell stayed 80 × 24 in a 120 × 40 view)
test("a size fitted before the stream opened reaches the shell once it opens", () => {
  showTerminal(/** @type {any} */ ({ clientWidth: 900 }), "t1");
  // Opened in a hidden box: the cell is measured as the box shows, by a resize to the size it has, then fitted.
  observed[0]();
  assert.deepEqual([terms[0].cols, terms[0].rows], [120, 40]);
  const [ws] = sockets;
  ws.open();
  mock.timers.tick(SIZE_SETTLE_MS);
  assert.deepEqual(sizes(ws), ["120x40"]);
});

// (fails before: yes — the owner's of 11-08: the pane sliding open sent 2×50, 2×51, 11×51, 18×51 … 65×51, a size each
// frame, and the Windows shell, wrapping its screen at each, kept its cursor a line from the view's)
test("the shell takes the size the view comes to rest at, never one smaller than a shell's", () => {
  showTerminal(/** @type {any} */ ({ clientWidth: 900 }), "t2");
  const [ws] = sockets;
  // The pane slides open: a box of 2 columns is no size to take; the rest come a frame apart.
  fits = { cols: 2, rows: 50 };
  ws.open();
  boxTo(2, 50);
  assert.deepEqual([terms[0].cols, terms[0].rows], [80, 24], "the view keeps its size while the box is smaller than any shell");
  mock.timers.tick(SIZE_SETTLE_MS);
  assert.deepEqual(sizes(ws), [], "xterm's 80 × 24, never fitted, is not said");
  for (const cols of [24, 38, 51, 60, 65]) {
    boxTo(cols, 51);
    mock.timers.tick(16);
  }
  assert.deepEqual(sizes(ws), [], "nothing while it moves");
  mock.timers.tick(SIZE_SETTLE_MS);
  assert.deepEqual(sizes(ws), ["65x51"], "the size it came to rest at, once");
  // A drag: the same, and a size the shell has is not said again.
  boxTo(50, 51);
  boxTo(65, 51);
  mock.timers.tick(SIZE_SETTLE_MS);
  assert.deepEqual(sizes(ws), ["65x51"]);
});

test("a tab not shown as its stream opens says no size until it shows", () => {
  const hidden = { clientWidth: 0 };
  showTerminal(/** @type {any} */ (hidden), "t3");
  sockets[0].open();
  mock.timers.tick(SIZE_SETTLE_MS);
  assert.deepEqual(sizes(sockets[0]), [], "it leaves the shell the size another view gave it");
  hidden.clientWidth = 900;
  observed[0]();
  mock.timers.tick(SIZE_SETTLE_MS);
  assert.deepEqual(sizes(sockets[0]), ["120x40"]);
});

// (fails before: yes — two views of one terminal, the one last sized held the shell: the other, its size said once,
// never said it again, and typing in it landed over earlier lines)
test("a view the keyboard comes back to gives the shell its size again; one never fitted, none", () => {
  showTerminal(/** @type {any} */ ({ clientWidth: 900 }), "t5");
  const [ws] = sockets;
  ws.open();
  mock.timers.tick(SIZE_SETTLE_MS);
  assert.deepEqual(sizes(ws), ["120x40"]);
  // Another view gave the shell its own size; this one is pressed again.
  terms[0].heard.focus();
  mock.timers.tick(SIZE_SETTLE_MS);
  assert.deepEqual(sizes(ws), ["120x40", "120x40"]);
  showTerminal(/** @type {any} */ ({ clientWidth: 0 }), "t6");
  sockets[1].open();
  terms[1].heard.focus();
  mock.timers.tick(SIZE_SETTLE_MS);
  assert.deepEqual(sizes(sockets[1]), []);
});

// (fails before: yes — the view grew as a Unix terminal does, pulling lines back from its scrollback, where the
// Windows console adds blank rows at its foot: their rows parted, and typing landed a line from the prompt)
test("a view told the Windows console stands behind it grows as that console does", () => {
  showTerminal(/** @type {any} */ ({ clientWidth: 900 }), "t4");
  sockets[0].hear({ t: "w", backend: "conpty", buildNumber: 26200 });
  assert.deepEqual(terms[0].options.windowsPty, { backend: "conpty", buildNumber: 26200 });
  assert.deepEqual(windowsPtyOf("win32", "10.0.26200"), { backend: "conpty", buildNumber: 26200 });
  assert.equal(windowsPtyOf("darwin", "24.1.0"), null);
  assert.equal(windowsPtyOf("linux", "6.6.87.2-microsoft-standard-WSL2"), null);
  // The server says it first, before what the terminal printed.
  /** @type {any[]} */
  const heard = [];
  const fakePty = { onData: (/** @type {(d: string) => void} */ fn) => fn("PS> "), onExit() {}, write() {}, resize() {}, kill() {} };
  const svc = createTerminalService({ spawn: () => fakePty, windowsPty: { backend: "conpty", buildNumber: 26200 } });
  const { id } = svc.create({ cwd: process.cwd() });
  svc.attach(id, (m) => heard.push(m));
  assert.deepEqual(heard.map((m) => m.t), ["w", "b"]);
  assert.deepEqual(heard[0], { t: "w", backend: "conpty", buildNumber: 26200 });
  const plain = createTerminalService({ spawn: () => fakePty });
  /** @type {any[]} */
  const heard2 = [];
  plain.attach(plain.create({ cwd: process.cwd() }).id, (m) => heard2.push(m));
  assert.deepEqual(heard2.map((m) => m.t), ["b"], "away from Windows, nothing more");
  svc.stopAll();
  plain.stopAll();
});

// (fails before: yes — r-doors, 11-12: the view opened its stream at once, and a WebSocket carries nothing of the app's
// key: the stream, a press since, was refused in the app's window. No ticket was asked: `sockets` held a stream before
// any, its address with no `?ticket=`)
test("in the app's window the view's press asks a ticket and its stream shows it; given none, its stream opens bare for Filament to refuse; a view let go meanwhile opens none; a browser's opens at once", async () => {
  const was = { fetch: g.fetch, app: g.filamentApp, focus: FakeTerminal.prototype.focus };
  const key = "k".repeat(43);
  /** What the page asked, each with the key it carried. @type {[string, string, string | null][]} */
  const asked = [];
  let status = 200;
  g.fetch = async (/** @type {any} */ url, /** @type {any} */ init = {}) => {
    asked.push([String(init.method || "GET"), String(url), init.headers?.["x-filament-press"] ?? null]);
    return new Response(JSON.stringify(status === 200 ? { ok: true, ticket: "tk 1" } : { error: "refused", press: true }), { status });
  };
  /** The views handed the keyboard. @type {FakeTerminal[]} */
  const focused = [];
  FakeTerminal.prototype.focus = function () {
    focused.push(this);
  };
  /** The page's promises, run. */
  const settled = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  const box = () => /** @type {any} */ ({ clientWidth: 900 });
  try {
    g.filamentApp = { pressKey: async () => key };
    const first = showTerminal(box(), "t7");
    // The keyboard asked for before its ticket came is handed over once the view is there.
    first.focus();
    assert.deepEqual([sockets.length, terms.length, first.ended()], [0, 0, false], "no stream before its ticket");
    await settled();
    assert.deepEqual(asked, [["POST", "/api/terminal/t7/ticket", key]]);
    assert.equal(sockets[0].url, "ws://127.0.0.1:1/api/terminal/t7/stream?ticket=tk%201");
    assert.deepEqual(focused, [terms[0]]);
    // Its size reaches the shell as a view's that opened at once.
    observed[0]();
    sockets[0].open();
    mock.timers.tick(SIZE_SETTLE_MS);
    assert.deepEqual(sizes(sockets[0]), ["120x40"]);
    // No ticket given: the stream opens bare, which Filament refuses, and the view says its end as of a stream that closed.
    status = 403;
    /** @type {(number | null)[]} */
    const ends = [];
    const bare = showTerminal(box(), "t8", { onExit: (code) => ends.push(code) });
    await settled();
    assert.equal(sockets[1].url, "ws://127.0.0.1:1/api/terminal/t8/stream");
    sockets[1].onclose();
    assert.deepEqual([ends, bare.ended()], [[null], true]);
    // Let go before its ticket came: none is opened.
    status = 200;
    const gone = showTerminal(box(), "t9");
    gone.dispose();
    await settled();
    assert.deepEqual([sockets.length, terms.length, gone.ended()], [2, 2, true]);
    // A browser has no bridge: its stream opens at once, as the gate let its page in.
    delete g.filamentApp;
    showTerminal(box(), "t10");
    assert.equal(sockets[2].url, "ws://127.0.0.1:1/api/terminal/t10/stream");
    assert.equal(asked.length, 3, "and asks no ticket");
  } finally {
    g.fetch = was.fetch;
    FakeTerminal.prototype.focus = was.focus;
    if (was.app === undefined) delete g.filamentApp;
    else g.filamentApp = was.app;
  }
});
