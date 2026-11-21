// @ts-check
// The desktop app's own title bar (the owner's of 10-28, after Claude's and Codex's desktop apps; every system the
// owner's of 11-08): no title bar of the system's — the harness's top row is the window's, Windows' and Linux's minimize,
// maximize and close drawn over its right end in the page's colours, a Mac's at its left end, centred in it
// (desktop/lib/frame.js, src/ui/harness/lib/app-frame.js, harness.css). In a browser nothing changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAR_H, PANE_BAR_H, frameOf, overlayColors } from "../desktop/lib/frame.js";
import { appFrame, hexOf, startAppFrame, startLentFrame } from "../src/ui/harness/lib/app-frame.js";

const read = (/** @type {string} */ f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// (fails before: yes — every harness window had the system's title bar over the page, its words the chat's title)
test("a harness window has no title bar of the system's: the controls over the top row, as tall as it, in the chrome's colours; a Mac's at its left, centred", () => {
  assert.deepEqual(frameOf({ platform: "win32", dark: true }), { titleBarStyle: "hidden", titleBarOverlay: { color: "#1e1e21", symbolColor: "#a1a1aa", height: 48 } });
  assert.deepEqual(frameOf({ platform: "win32", dark: false }).titleBarOverlay, { color: "#e6e6eb", symbolColor: "#52525b", height: 48 });
  assert.equal(frameOf({ platform: "win32", pane: true }).titleBarOverlay?.height, PANE_BAR_H, "a popped pane's: its head's height");
  // (fails before: yes — the owner's of 11-08: the Mac app showed the system's title bar over Filament's own)
  assert.deepEqual(frameOf({ platform: "linux", dark: true }), frameOf({ platform: "win32", dark: true }), "Linux as Windows");
  assert.deepEqual(frameOf({ platform: "darwin", dark: true }), { titleBarStyle: "hidden", titleBarOverlay: { color: "#1e1e21", symbolColor: "#a1a1aa", height: 48 }, trafficLightPosition: { x: 16, y: 16 } });
  assert.deepEqual(frameOf({ platform: "darwin", pane: true }).trafficLightPosition, { x: 16, y: 11 }, "centred in a popped pane's head");
  // the heights are the page's own rows'
  assert.match(read("src/ui/harness.css"), new RegExp(`--bar-h: ${BAR_H}px;`));
  assert.match(read("src/ui/harness/panes/panes.css"), new RegExp(`\\.tile-head \\{\\n  display: flex; align-items: center; gap: 8px; height: ${PANE_BAR_H}px;`));
});

test("the colours a page sends reach the window's controls only as two #rrggbb", () => {
  assert.deepEqual(overlayColors({ color: "#1E1E21", symbolColor: "#a1a1aa" }), { color: "#1e1e21", symbolColor: "#a1a1aa" });
  for (const bad of [null, {}, { color: "#1e1e21" }, { color: "red", symbolColor: "#ffffff" }, { color: "rgb(1,2,3)", symbolColor: "#ffffff" }, { color: "#1e1e21; x", symbolColor: "#ffffff" }, { color: "#fff", symbolColor: "#ffffff" }])
    assert.equal(overlayColors(bad), null, JSON.stringify(bad));
});

test("the app's main process: the harness and its popped panes get the frame, the dashboard keeps the system's; the colours come only from Filament's own page, read before use", () => {
  const main = read("desktop/main.js");
  assert.match(main, /\.\.\.\(name === "harness" \? frameOf\(\{ dark: nativeTheme\.shouldUseDarkColors \}\) : \{\}\),/);
  assert.match(main, /\.\.\.frameOf\(\{ dark: nativeTheme\.shouldUseDarkColors, pane: true \}\),/);
  // The harness window's colours kept for the rail's page too (the owner's remote Filament of 11-06, Part 3), as read.
  assert.match(main, /ipcMain\.on\("filament:title-bar", \(e, c\) => \{\n    const w = paneOf\(e\),\n      colors = overlayColors\(c\);\n    if \(!w \|\| !colors\) return;\n    if \(w === windows\.get\("harness"\)\) \{\n      chrome = colors;\n      rail\?\.paint\(\);\n[^\n]*\n      if \(rail && rail\.active\(\) !== LOCAL_ID\) return;\n    \}\n    \/\/ A Mac's buttons wear the system's own colours: setTitleBarOverlay is Windows' and Linux's\.\n    if \(process\.platform === "darwin"\) return;\n    try \{\n      w\.setTitleBarOverlay\(colors\);/);
  assert.match(read("desktop/harness-preload.cjs"), /titleBar: \(c\) => ipcRenderer\.send\("filament:title-bar", \{ color: String\(c\?\.color \|\| ""\), symbolColor: String\(c\?\.symbolColor \|\| ""\) \}\),/);
});

test("a computed colour reads as #rrggbb; a see-through one, or one unread, as none", () => {
  assert.equal(hexOf("rgb(30, 30, 33)"), "#1e1e21");
  assert.equal(hexOf("rgba(230, 230, 235, 1)"), "#e6e6eb");
  assert.equal(hexOf("rgb(30 30 33 / 100%)"), "#1e1e21");
  assert.equal(hexOf("#FFF"), "#ffffff");
  assert.equal(hexOf("#a1a1aa"), "#a1a1aa");
  assert.equal(hexOf("rgba(0, 0, 0, 0)"), null, "see-through: the controls would wear a colour the bar has not");
  assert.equal(hexOf("rgb(30 30 33 / 50%)"), null);
  assert.equal(hexOf("color(srgb 0.1 0.1 0.1)"), null, "no page to paint it on");
  // another notation, painted on the page's canvas and read back
  const doc = { createElement: () => ({ getContext: () => ({ fillStyle: "", fillRect() {}, getImageData: () => ({ data: [26, 26, 26, 255] }) }) }) };
  assert.equal(hexOf("color(srgb 0.1 0.1 0.1)", doc), "#1a1a1a");
});

// (fails before: yes — the drive of 10-28: the sidebar's buttons are inked oklab(0.87 0 0 / 0.6), see-through, so no
// colour was read, and the window's controls were never told the bar's)
test("a see-through ink is read as the eye sees it, over the ground it lies on; a see-through ground has none to lie on", () => {
  assert.equal(hexOf("rgba(235, 235, 245, 0.6)", undefined, "#1e1e21"), "#9999a0");
  assert.equal(hexOf("rgb(235 235 245 / 60%)", undefined, "#1e1e21"), "#9999a0");
  assert.equal(hexOf("rgba(235, 235, 245, 0.6)", undefined, "rgba(0, 0, 0, 0.5)"), null);
  // another notation: the ground painted first, the ink over it, read back
  /** @type {string[]} */
  const painted = [];
  const ctx = {
    _fill: "#000000",
    get fillStyle() {
      return this._fill;
    },
    set fillStyle(v) {
      if (/^(#|oklab\()/.test(v)) this._fill = v;
    },
    fillRect() {
      painted.push(this._fill);
    },
    clearRect() {},
    getImageData: () => ({ data: [153, 153, 153, 255] }),
  };
  const doc = { createElement: () => ({ getContext: () => ctx }) };
  assert.equal(hexOf("oklab(0.87 0 0 / 0.6)", doc, "#1e1e21"), "#999999");
  assert.deepEqual(painted, ["#1e1e21", "oklab(0.87 0 0 / 0.6)"]);
  painted.length = 0;
  assert.equal(hexOf("no-such-colour(1)", doc, "#1e1e21"), null, "one the page cannot paint is none, not the ground read back");
});

/** A window whose controls stand over the page, or not; what it was told. @param {boolean} visible */
const world = (visible) => {
  /** @type {any[]} */
  const told = [];
  /** @type {Record<string, () => void>} */
  const on = {};
  /** @type {(() => void)[]} */
  const watchers = [];
  const classes = new Set();
  /** @type {Record<string, string>} */
  const props = {};
  const html = {
    classList: { add: (/** @type {string} */ c) => classes.add(c), toggle: (/** @type {string} */ c, /** @type {boolean} */ v) => (v ? classes.add(c) : classes.delete(c)) },
    style: { setProperty: (/** @type {string} */ k, /** @type {string} */ v) => void (props[k] = v) },
  };
  const wco = { visible, addEventListener: (/** @type {string} */ t, /** @type {() => void} */ f) => void (on[`wco:${t}`] = f) };
  const win = {
    navigator: { windowControlsOverlay: wco },
    filamentApp: { titleBar: (/** @type {any} */ c) => void told.push(c) },
    addEventListener: (/** @type {string} */ t, /** @type {() => void} */ f) => void (on[t] = f),
    matchMedia: () => ({ addEventListener: (/** @type {string} */ t, /** @type {() => void} */ f) => void (on[`media:${t}`] = f) }),
    MutationObserver: class {
      /** @param {() => void} f */
      constructor(f) {
        watchers.push(f);
      }
      observe() {}
    },
  };
  const theme = { color: "rgb(30, 30, 33)", symbolColor: "rgb(161, 161, 170)" };
  return { told, on, watchers, classes, props, wco, win, theme, doc: { documentElement: html } };
};

// (fails before: yes — there was no title bar of the page's: nothing told the window its colours)
test("under the window's controls the page is the title bar: html.app-frame on, the chrome's colour set, the window told the colours — once, then at each change of theme", () => {
  const w = world(true);
  assert.equal(startAppFrame({ colors: () => w.theme, win: w.win, doc: w.doc }), true);
  assert.ok(w.classes.has("app-frame"));
  assert.deepEqual(w.told, [{ color: "#1e1e21", symbolColor: "#a1a1aa" }]);
  assert.equal(w.props["--app-chrome"], "#1e1e21");
  // its own write to html's style, heard back, says nothing again
  for (const f of w.watchers) f();
  w.on.load();
  assert.equal(w.told.length, 1);
  // the theme goes light
  w.theme = { color: "rgb(230, 230, 235)", symbolColor: "rgb(82, 82, 91)" };
  for (const f of w.watchers) f();
  assert.deepEqual(w.told.at(-1), { color: "#e6e6eb", symbolColor: "#52525b" });
  // the system's light and dark, followed
  w.theme = { color: "rgb(30, 30, 33)", symbolColor: "rgb(161, 161, 170)" };
  w.on["media:change"]();
  assert.equal(w.told.length, 3);
  // a see-through ground (a theme still loading) changes nothing
  w.theme = { color: "rgba(0, 0, 0, 0)", symbolColor: "rgb(0, 0, 0)" };
  for (const f of w.watchers) f();
  assert.equal(w.told.length, 3);
  // the buttons' see-through ink, as the eye sees it over the bar
  w.theme = { color: "rgb(30, 30, 33)", symbolColor: "rgba(235, 235, 245, 0.6)" };
  for (const f of w.watchers) f();
  assert.deepEqual(w.told.at(-1), { color: "#1e1e21", symbolColor: "#9999a0" });
  // full screen hides the controls, and the page is no title bar while it lasts
  w.wco.visible = false;
  w.on["wco:geometrychange"]();
  assert.equal(w.classes.has("app-frame"), false);
  w.wco.visible = true;
  w.on["wco:geometrychange"]();
  assert.ok(w.classes.has("app-frame"));
});

// (fails before: yes — the owner's of 11-08: no room was kept at the row's left end, where a Mac's buttons stand)
test("a Mac's buttons at the row's left end: html.app-frame-left on while they stand there, the sidebar's top row, the hidden sidebar's rail and the header's crumb, and a popped pane's head, past them", () => {
  const mac = world(true);
  /** @type {any} */ (mac.wco).getTitlebarAreaRect = () => ({ x: 78, y: 0, width: 1200, height: 48 });
  startAppFrame({ colors: () => mac.theme, win: mac.win, doc: mac.doc });
  assert.ok(mac.classes.has("app-frame") && mac.classes.has("app-frame-left"));
  // full screen hides them
  mac.wco.visible = false;
  mac.on["wco:geometrychange"]();
  assert.equal(mac.classes.has("app-frame-left"), false);
  // Windows' and Linux's stand at the right end: the title bar area starts at the left edge
  const win = world(true);
  /** @type {any} */ (win.wco).getTitlebarAreaRect = () => ({ x: 0, y: 0, width: 1140, height: 48 });
  startAppFrame({ colors: () => win.theme, win: win.win, doc: win.doc });
  assert.ok(win.classes.has("app-frame") && !win.classes.has("app-frame-left"));
  const css = read("src/ui/harness.css");
  assert.match(css, /--wco-l: env\(titlebar-area-x, 0px\);/, "no rail beside the page takes any of it (the owner's of 11-08)");
  assert.doesNotMatch(css, /--rail-in/);
  assert.match(css, /html\.app-frame-left \.sess-top \{ padding-left: calc\(var\(--wco-l\) \+ 6px\); \}/);
  assert.match(css, /html\.app-frame-left \.collapsed-strip \{ height: calc\(var\(--bar-h\) \* 2\); align-items: flex-end;/);
  assert.match(css, /html\.app-frame-left \.app-shell:is\(\.sidebar-off, \.auto-side-off\) \.c-left \{ padding-left: max\(10px, calc\(var\(--wco-l\) - 48px \+ 10px\)\); \}/);
  // (fails before: yes — the owner's Mac of 11-08: the folded rail's hairline ran through the yellow button)
  assert.match(css, /html\.app-frame-left \.collapsed-rail \{ position: relative; border-right-color: transparent; \}/);
  assert.match(css, /html\.app-frame-left \.collapsed-rail::after \{ content: ""; position: absolute; top: var\(--bar-h\); bottom: 0; right: 0; width: 1px;/);
  assert.match(read("src/ui/harness/aqua.css"), /html\.app-frame-left \.collapsed-rail::after \{ background: var\(--aq-hairline\); \}/);
  assert.match(read("src/ui/harness/panes/panes.css"), /html\.app-frame-left \.app-shell\.pane-window \.tile-head \{ padding-left: calc\(var\(--wco-l\) \+ 6px\); \}/);
  assert.match(read("src/ui/harness/shell.js"), /const COLLAPSED_W = 48;/, "the rail's width the header's room counts on");
});

// (fails before: yes — the owner's of 11-08: the app had no word of the room to lend another machine's page)
test("This computer's page tells the app the room its controls take, as they move: lent to the other machines' pages", () => {
  /** @param {{ x: number, width: number }} rect */
  const told = (rect) => {
    const w = world(true);
    /** @type {any[]} */
    const areas = [];
    const win = /** @type {any} */ (w.win);
    win.filamentApp.frameArea = (/** @type {any} */ r) => void areas.push(r);
    win.innerWidth = 1440;
    /** @type {any} */ (w.wco).getTitlebarAreaRect = () => ({ ...rect, y: 0, height: 48 });
    startAppFrame({ colors: () => w.theme, win: w.win, doc: w.doc });
    return { w, areas };
  };
  assert.deepEqual(told({ x: 78, width: 1362 }).areas, [{ left: 78, right: 0 }], "a Mac's at the left");
  const pc = told({ x: 0, width: 1302 });
  assert.deepEqual(pc.areas, [{ left: 0, right: 138 }], "Windows' at the right");
  /** @type {any} */ (pc.w.wco).getTitlebarAreaRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
  pc.w.on["wco:geometrychange"]();
  pc.w.wco.visible = false;
  pc.w.on["wco:geometrychange"]();
  assert.equal(pc.areas.length, 1, "no area read, or none standing: nothing said");
});

// (fails before: yes — the owner's of 11-08: another machine's page in the window knew nothing of the controls over it)
test("another machine's page in the window: the room the app lends it — a Mac's at the left, Windows' at the right —, its colours told for the controls; none lent, no title bar; This computer's page and a browser's untouched", () => {
  const w = world(false);
  /** @type {any[]} */
  const told = [];
  /** @type {(s: any) => void} */
  let hear = () => {};
  const bridge = { onState: (/** @type {any} */ fn) => void (hear = fn), titleBar: (/** @type {any} */ c) => void told.push(c) };
  let shown = 0;
  assert.equal(startLentFrame({ colors: () => w.theme, bridge, win: w.win, doc: w.doc, onShown: () => void shown++ }), true);
  assert.equal(w.classes.size, 0, "nothing until the app says");
  hear({ shown: true, frame: { left: 78, right: 0 } });
  assert.ok(w.classes.has("app-frame") && w.classes.has("app-frame-left"));
  assert.deepEqual([w.props["--wco-l"], w.props["--wco-r"]], ["78px", "0px"]);
  assert.deepEqual(told, [{ color: "#1e1e21", symbolColor: "#a1a1aa" }]);
  assert.equal(w.told.length, 0, "never through This computer's own bridge");
  assert.equal(shown, 1, "the header takes the bar's place");
  hear({ shown: true, frame: { left: 0, right: 110.4 } });
  assert.ok(w.classes.has("app-frame") && !w.classes.has("app-frame-left"));
  assert.deepEqual([w.props["--wco-l"], w.props["--wco-r"]], ["0px", "110.4px"]);
  assert.equal(told.length, 1, "the same colours: not told again");
  w.theme = { color: "rgb(230, 230, 235)", symbolColor: "rgb(82, 82, 91)" };
  for (const f of w.watchers) f();
  assert.deepEqual(told.at(-1), { color: "#e6e6eb", symbolColor: "#52525b" }, "a theme's change told");
  hear({ shown: true, frame: null });
  assert.equal(w.classes.has("app-frame"), false, "full screen: no title bar");
  assert.deepEqual([w.props["--wco-l"], w.props["--wco-r"]], ["", ""]);
  // (fails before: yes — the drive of 11-08: on Windows the window's own overlay reaches another machine's view too, and
  // its colours were never told) Such a page: its room read there, a lent word changing nothing; its colours told the
  // app through its one bridge all the same — it has no filamentApp to tell them.
  const nat = world(true);
  delete (/** @type {any} */ (nat.win)).filamentApp;
  startAppFrame({ colors: () => nat.theme, win: nat.win, doc: nat.doc });
  /** @type {any[]} */
  const natTold = [];
  /** @type {(s: any) => void} */
  let natHear = () => {};
  startLentFrame({ colors: () => nat.theme, bridge: { onState: (/** @type {any} */ fn) => void (natHear = fn), titleBar: (/** @type {any} */ c) => void natTold.push(c) }, win: nat.win, doc: nat.doc });
  natHear({ shown: true, frame: null });
  assert.ok(nat.classes.has("app-frame"), "its own frame stands");
  natHear({ shown: true, frame: { left: 0, right: 138 } });
  assert.equal(nat.props["--wco-r"], undefined, "nothing lent over the overlay's own");
  assert.deepEqual(natTold, [{ color: "#1e1e21", symbolColor: "#a1a1aa" }], "its colours told through its bridge, once");
  nat.theme = { color: "rgb(230, 230, 235)", symbolColor: "rgb(82, 82, 91)" };
  for (const f of nat.watchers) f();
  assert.deepEqual(natTold.at(-1), { color: "#e6e6eb", symbolColor: "#52525b" }, "and again as its theme changes");
  const own = world(true);
  assert.equal(startLentFrame({ colors: () => own.theme, bridge: { onState() {}, open() {} }, win: own.win, doc: own.doc }), false, "This computer's bridge lends no frame");
  assert.equal(startLentFrame({ colors: () => w.theme, bridge: undefined, win: w.win, doc: w.doc }), false, "a browser: none");
  assert.match(read("src/ui/harness/shell.js"), /startAppFrame\(frameOn\);\n[^]*startLentFrame\(frameOn\);/, "the shell starts both, the same way");
});

test("in a browser, or a window with the system's title bar, nothing changes", () => {
  const w = world(false);
  assert.equal(startAppFrame({ colors: () => w.theme, win: w.win, doc: w.doc }), false);
  assert.deepEqual([w.classes.size, w.told.length, Object.keys(w.props).length], [0, 0, 0]);
  assert.equal(appFrame({}), false);
  assert.equal(appFrame(undefined), false);
});

// (fails before: yes — a page loaded again while its window was minimized, as Filament restarted under it after an
// install, saw no controls and stayed a browser's page once they showed: its header in the frame, the controls over its
// ⋯, their ground the window's first colour, not the theme's)
test("a page built while the controls stood over nothing becomes the title bar when they show: html.app-frame on, the colours told, the shell's header moved to the bar", () => {
  const w = world(false);
  let shown = 0;
  assert.equal(startAppFrame({ colors: () => w.theme, win: w.win, doc: w.doc, onShown: () => void shown++ }), false);
  assert.deepEqual([w.classes.size, w.told.length, shown], [0, 0, 0], "nothing while they stand over nothing");
  w.wco.visible = true;
  w.on["wco:geometrychange"]();
  assert.ok(w.classes.has("app-frame"));
  assert.deepEqual(w.told, [{ color: "#1e1e21", symbolColor: "#a1a1aa" }]);
  assert.equal(w.props["--app-chrome"], "#1e1e21");
  assert.equal(shown, 1, "the shell is told");
  // the theme followed from then on
  w.theme = { color: "rgb(22, 22, 22)", symbolColor: "rgb(161, 161, 170)" };
  for (const f of w.watchers) f();
  assert.deepEqual(w.told.at(-1), { color: "#161616", symbolColor: "#a1a1aa" });
  // minimized and back: the class follows them, and the theme is watched once
  w.wco.visible = false;
  w.on["wco:geometrychange"]();
  assert.equal(w.classes.has("app-frame"), false);
  w.wco.visible = true;
  w.on["wco:geometrychange"]();
  assert.ok(w.classes.has("app-frame"));
  assert.equal(w.watchers.length, 1);
  // the shell: its header leaves the frame for the bar's place, once
  const shell = read("src/ui/harness/shell.js");
  assert.match(shell, /onShown: \(\) => \{\n(?:\s*\/\/[^\n]*\n)?\s+paintLayout\(\);\n\s+if \(titleBar\) return;\n\s+titleBar = true;\n\s+dragStrip\.replaceWith\(header\.el\);/);
  assert.doesNotMatch(shell, /if \(titleBar\)\s+startAppFrame/, "the frame is started whatever the controls do at first");
});

test("the page's rows: the header out of the frame as the bar; empty parts drag and every control stays one; the controls' room kept clear; a dialog, a sheet, a picture under the bar; a popped pane's head its bar", () => {
  const shell = read("src/ui/harness/shell.js");
  assert.match(shell, /const mainFrame = h\("section", \{ class: "main-frame" \}, titleBar \? null : header\.el, splitRow\);/);
  assert.match(shell, /const contentCol = h\("div", \{ class: "content-col" \}, titleBar \? header\.el : dragStrip, mainFrame\);/);
  assert.match(shell, /root\.classList\.toggle\("screen-up", on\);/);
  const css = read("src/ui/harness.css");
  assert.match(css, /html\.app-frame :is\(\.c-bar, \.sess-top, \.collapsed-strip\) \{ -webkit-app-region: drag; \}/);
  assert.match(css, /html\.app-frame :is\(\.c-bar, \.sess-top, \.collapsed-strip\) :is\(button, a, input, select, textarea, label, summary, \[role\], \[tabindex\], \[contenteditable="true"\], \[draggable="true"\]\) \{\n  -webkit-app-region: no-drag;/);
  assert.match(css, /html\.app-frame \.c-right \{ padding-right: calc\(var\(--wco-r\) \+ 4px\); \}/);
  assert.match(css, /html\.app-frame :is\(\.zc-menu, \.zc-popover, \.zc-tooltip, \.zc-toast-stack\) \{ -webkit-app-region: no-drag; \}/);
  assert.match(css, /html\.app-frame :is\(\.zc-dialog-overlay, \.zc-sheet-overlay, \.picture-view\) \{ top: var\(--bar-h\); \}/);
  const panes = read("src/ui/harness/panes/panes.css");
  assert.match(panes, /\.app-shell\.pane-window :is\(\.drag-strip, \.c-bar, \.conv-frame, \.panes-edge\) \{ display: none; \}/);
  assert.match(panes, /html\.app-frame \.app-shell\.pane-window \.tile-head \{ -webkit-app-region: drag; padding-right: calc\(var\(--wco-r\) \+ 6px\); \}/);
});
