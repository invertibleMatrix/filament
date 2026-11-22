// @ts-check
// The chat alone (the remote desk of 11-22, s1i): another machine's desktop app shows a chat of this Filament's in its
// own window's main area, beside its own left bar, at `?only=chat` — the page then is that chat with its header and
// panes, no sidebar nor its rail, no full-frame screen (one asked for goes to the app's whole page of this machine, else
// back to the chat), the desk's look at `&theme=` worn without being kept. The real shell and header are drawn on the
// stub document; app.js's wiring is read from its source.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { stubDocument } from "./helpers/dom-stub.js";
import { chatOnlyOf, fullPageOf, themeHintOf } from "../src/ui/harness/lib/chat-only.js";
import { DESK } from "../src/http/admin/remote.js";

const g = /** @type {any} */ (globalThis);
/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {Record<string, any>} */
const had = {};
/** What the page's store was told. @type {[string, string][]} */
const stored = [];
/** @type {Map<string, string>} */
const kept = new Map();
const mq = { matches: false, addEventListener() {} };
const STUBS = {
  EventSource: class { addEventListener() {} close() {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void (stored.push([k, v]), kept.set(k, v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ sessions: [], projects: [], runs: [] }) }),
};
before(() => {
  doc = stubDocument();
  for (const [k, v] of Object.entries(STUBS)) {
    had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
    g[k] = v;
  }
  g.window.matchMedia = () => mq;
  const d = /** @type {any} */ (doc.document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
});
after(() => {
  for (const k of Object.keys(STUBS)) {
    if (had[k] === undefined) delete g[k];
    else g[k] = had[k];
  }
  delete g.window.matchMedia;
  doc.restore();
});

/** The shell as app.js makes it. @param {{ chatOnly?: boolean, onFullPage?: () => void }} [o] */
const drawn = async (o = {}) => {
  const { createShell } = await import("../src/ui/harness/shell.js");
  const noop = () => {};
  const root = document.createElement("div");
  const shell = /** @type {any} */ (createShell(/** @type {any} */ (root), { ...o, onHeader: { onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null } }));
  doc.document.body.append(root);
  return { shell, root };
};

const APP = readFileSync("src/ui/harness/app.js", "utf8");

test("the page is the chat alone at ?only=chat — never with a popped pane's ?pane=, never at another word", () => {
  assert.equal(chatOnlyOf("?only=chat"), true);
  assert.equal(chatOnlyOf("?only=chat&theme=light"), true);
  assert.equal(chatOnlyOf("only=chat"), true, "as URLSearchParams reads a search without its ?");
  for (const s of ["", "?", "?only=Chat", "?only=chats", "?only=", "?chat", "?only=chat&pane=terminal", "?pane=x&only=chat"]) assert.equal(chatOnlyOf(s), false, s);
  assert.equal(chatOnlyOf(/** @type {any} */ (undefined)), false, "no address: a whole page");
});

test("the desk's look is light or dark, else none; and the app's way to the whole page is its preload's, else none", () => {
  assert.equal(themeHintOf("?only=chat&theme=light"), "light");
  assert.equal(themeHintOf("?only=chat&theme=dark"), "dark");
  for (const s of ["", "?theme=", "?theme=system", "?theme=Dark", "?theme=sepia", "?theme=<b>"]) assert.equal(themeHintOf(s), null, s);
  /** @type {string[]} */
  const asked = [];
  const full = fullPageOf({ filamentMachines: { full: (/** @type {any} */ r) => void asked.push(r) } });
  assert.ok(full);
  full("#/c/abc");
  full(/** @type {any} */ (7));
  assert.deepEqual(asked, ["#/c/abc", "7"], "a route, as words");
  assert.equal(fullPageOf({}), null, "a browser's page: no app to ask");
  assert.equal(fullPageOf({ filamentMachines: { full: "yes" } }), null);
  assert.equal(fullPageOf(null), null);
});

// (fails before: yes — no chat alone: the page drew its sidebar, or its rail, whatever another machine's desk showed it beside)
test("the chat alone: no sidebar, no gutter, no collapsed rail, Show sidebar does nothing and keeps nothing", async () => {
  stored.length = 0;
  const { shell, root } = await drawn({ chatOnly: true });
  assert.equal(root.classList.contains("chat-only"), true);
  assert.equal(shell.sidebarHost.style.width, "0px");
  assert.equal(shell.collapsedRail.style.width, "0px", "not the 48 px rail a folded sidebar leaves");
  assert.equal(/** @type {any} */ (root.querySelector(".side-gutter")).style.display, "none");
  assert.equal(shell.sidebarOpen, false, "F6's stops and Ctrl+B read it shut");
  shell.setSidebar(true);
  assert.equal(shell.sidebarHost.style.width, "0px", "Show sidebar shows none");
  assert.equal(shell.sidebarOpen, false);
  assert.deepEqual(stored.filter(([k]) => /sidebar/i.test(k)), [], "and this machine's own pages keep their choice");
  // The stylesheet hides the three, whatever widths a paint leaves them.
  const css = readFileSync("src/ui/harness.css", "utf8");
  assert.match(css, /\.app-shell\.chat-only > :is\(\.side-frame, \.side-gutter, \.collapsed-rail\) \{ display: none; \}/);
});

// (fails before: yes — the chat alone had no way to this machine's whole page)
test("Open full page stands beside the header's layout menu where the app gives a way, and asks for it", async () => {
  let asked = 0;
  const { shell } = await drawn({ chatOnly: true, onFullPage: () => void asked++ });
  const btn = shell.header.el.querySelector(".hdr-full");
  assert.ok(btn, "the button");
  assert.equal(btn.getAttribute("aria-label"), "Open full page");
  const right = shell.header.layoutSlot.parentNode;
  assert.equal(right.childNodes[right.childNodes.indexOf(shell.header.layoutSlot) + 1], btn, "after the layout menu");
  btn.dispatch("click");
  assert.equal(asked, 1);
  const bare = await drawn({ chatOnly: true });
  assert.equal(bare.shell.header.el.querySelector(".hdr-full"), null, "a browser's chat alone: no app, no button");
  const whole = await drawn({ onFullPage: () => {} });
  assert.equal(whole.shell.header.el.querySelector(".hdr-full"), null, "a whole page is the full page");
  assert.equal(whole.root.classList.contains("chat-only"), false);
  assert.notEqual(whole.shell.collapsedRail.style.width, "0px", "and keeps its rail as ever");
});

// (fails before: yes — the page wore this machine's kept theme, whatever the desk's)
test("the desk's look is worn without being kept, and the kept one comes back when it goes", async () => {
  const { hintTheme, setThemePref, themePref } = await import("../src/ui/harness/theme.js");
  const dark = () => document.documentElement.classList.contains("theme-zai-dark");
  setThemePref("light");
  assert.equal(dark(), false);
  stored.length = 0;
  hintTheme("dark");
  assert.equal(dark(), true, "the desk's dark");
  assert.equal(themePref(), "light", "this machine's choice stands");
  assert.deepEqual(stored, [], "and nothing is kept");
  hintTheme(/** @type {any} */ ("sepia"));
  assert.equal(dark(), false, "a look it does not know: the kept one");
  hintTheme("dark");
  hintTheme(null);
  assert.equal(dark(), false, "none: the kept one again");
  setThemePref("system");
});

// (fails before: yes — the review of s1i: Ctrl+Shift+L kept a theme the page went on not wearing)
test("the theme's key keeps nothing while the page wears a look it was given", async () => {
  const { hintTheme, setThemePref, themePref, themeHinted, watchTheme } = await import("../src/ui/harness/theme.js");
  /** @type {any[]} */
  const keyHeard = [];
  const was = g.window.addEventListener;
  g.window.addEventListener = (/** @type {string} */ type, /** @type {any} */ fn) => void (type === "keydown" && keyHeard.push(fn));
  try {
    watchTheme();
  } finally {
    g.window.addEventListener = was;
  }
  assert.equal(keyHeard.length, 1);
  const press = () => {
    let stopped = false;
    keyHeard[0]({ key: "L", code: "KeyL", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, preventDefault: () => void (stopped = true) });
    return stopped;
  };
  setThemePref("light");
  hintTheme("dark");
  assert.equal(themeHinted(), true);
  stored.length = 0;
  assert.equal(press(), false, "left alone");
  assert.equal(themePref(), "light");
  assert.deepEqual(stored, []);
  hintTheme(null);
  assert.equal(themeHinted(), false);
  assert.equal(press(), true, "with none given, the key switches as ever");
  assert.equal(themePref(), "dark", "light → dark, the next in the cycle");
  setThemePref("system");
});

// (fails before: yes — the chat alone opened in this machine's kept theme and turned at app.js's start)
test("harness.html wears the desk's look before the first paint, on the chat alone only", () => {
  const html = readFileSync("src/ui/harness.html", "utf8");
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(inline);
  /** @param {string} search @param {string | null} keptTheme */
  const paint = (search, keptTheme) => {
    const classes = new Set(["theme-zai-dark"]);
    const classList = { toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => void (on ? classes.add(c) : classes.delete(c)) };
    vm.runInNewContext(inline[1], { URLSearchParams, location: { search }, localStorage: { getItem: () => keptTheme }, window: { matchMedia: () => ({ matches: false }) }, document: { documentElement: { classList } } });
    return [...classes].join(" ");
  };
  assert.equal(paint("?only=chat&theme=light", "dark"), "theme-zai-light");
  assert.equal(paint("?only=chat&theme=dark", "light"), "theme-zai-dark");
  assert.equal(paint("?only=chat&theme=sepia", "dark"), "theme-zai-dark", "a look it does not know: the kept one");
  assert.equal(paint("?only=chat", "dark"), "theme-zai-dark");
  assert.equal(paint("?theme=light", "dark"), "theme-zai-dark", "a whole page wears its own");
  assert.equal(paint("?only=chat&pane=terminal&theme=light", "dark"), "theme-zai-dark", "a popped pane's window too");
});

test("app.js: the chat alone is read once, wears the desk's look, and the shell draws it", () => {
  assert.match(APP, /import \{ DESK_KEYS, chatOnlyOf, deskKeyOf, fullPageOf, themeHintOf \} from "\.\/lib\/chat-only\.js";/);
  assert.match(APP, /const CHAT_ONLY = !POPPED && chatOnlyOf\(\);\nconst fullPage = CHAT_ONLY \? fullPageOf\(\) : null;\nif \(CHAT_ONLY\) hintTheme\(themeHintOf\(\)\);/);
  assert.match(APP, /const shell = createShell\(must\("app"\), \{\n  chatOnly: CHAT_ONLY,\n  \.\.\.\(fullPage \? \{ onFullPage: \(\) => fullPage\(location\.hash \|\| backTo\(\)\) \} : \{\}\),/);
});

// (fails before: yes — a screen asked for on the chat alone covered the chat another machine's desk showed; the review of
// s1i: the address sent was the one the page's start had rewritten, `#/`, and the chat's own Context sheet was refused too)
test("app.js: a screen asked for on the chat alone opens the whole page at it, else says where; the chat stays", () => {
  const route = APP.indexOf("if (CHAT_ONLY && isScreen(route.kind)) {");
  assert.ok(route > 0, "applyRoute refuses screens on the chat alone, the Context page not among them");
  assert.match(APP.slice(route, route + 300), /\{\n    if \(fullPage\) fullPage\(routeFor\(route\)\);\n    else toast\("[^"]+"\);\n    location\.replace\(backTo\(\)\);\n    return;\n  \}/);
  assert.ok(route > APP.indexOf("if (POPPED && (isScreen(route.kind) || route.kind === \"context\")) {"), "after a popped pane's own refusal");
});

test("the address the whole page opens at is the route asked for, rebuilt — every screen's", async () => {
  const { parseRoute, routeFor, isScreen } = await import("../src/ui/harness/lib/router.js");
  for (const h of ["#/settings/general", "#/settings/remote", "#/control-room/abc", "#/artifacts", "#/artifacts/x1", "#/library/skills", "#/library/connectors", "#/space/p1", "#/space/p1/board", "#/your-space"]) {
    const r = parseRoute(h);
    assert.ok(isScreen(r.kind), h);
    assert.equal(routeFor(r), h);
  }
  assert.equal(isScreen(parseRoute("#/context/map").kind), false, "the Context page is the chat's own sheet");
});

// (fails before: yes — the chat alone swept old chats and opened the welcome tour and the first-run tips over the chat;
// the review of s1i: Ctrl+Shift+] clicked the hidden sidebar's next row, Alt+N opened what needs you next, Ctrl+N left
// the chat for the Start, all out of the desk's sight)
test("app.js: no sweep, tour or tips on the chat alone; what goes through the hidden list or leaves the chat is off, in Ctrl+K and by its key", () => {
  assert.match(APP, /if \(!POPPED && !CHAT_ONLY && !viewOnlyPage\(\)\) startHourlySweep\(/);
  assert.match(APP, /if \(!POPPED && !CHAT_ONLY && !viewOnlyPage\(\) && state\.config\) \{\n    const toured =/);
  assert.match(APP, /if \(!POPPED && !CHAT_ONLY && !viewOnlyPage\(\)\) void tourAsked\.catch\(\(\) => \{\}\)\.then\(\(\) => coach\.start\(\)\)/);
  assert.match(APP, /if \(!POPPED && !CHAT_ONLY && !viewOnlyPage\(\)\) void coach\.reload\(\)/);
  const off = /const CHAT_ONLY_OFF = new Set\(\[([^\]]*)\]\);/.exec(APP);
  assert.ok(off);
  assert.deepEqual(JSON.parse(`[${off[1]}]`).sort(), ["new", "new-task", "next-needs", "open-workspace", "sidebar", "task-next", "task-prev", "tips", "welcome"]);
  assert.match(APP, / {2}\]\.filter\(\(a\) => !CHAT_ONLY \|\| !CHAT_ONLY_OFF\.has\(a\.id\)\),\n {2}onOpenTask:/, "Ctrl+K's actions");
  assert.match(APP, / {2}if \(!run\) return;\n {2}e\?\.preventDefault\(\);\n(?:[^\n]*\n){3} {2}if \(viewOnlyPage\(\) && VIEW_ONLY_KEYS_OFF\.has\(id\)\) return;\n {2}if \(CHAT_ONLY && CHAT_ONLY_OFF\.has\(id\)\) return;/, "the keys — the desk's handed to it first, where the desk shows the chat (desk-in-place.test.js)");
  assert.match(APP, /if \(rail\.closeFocused\(\)\) return;\n {6}if \(viewOnlyPage\(\) \|\| CHAT_ONLY\) return;\n {6}pushNextAddress = true;\n {6}newChat\(\);/, "Alt+W closes a pane, never the chat");
  assert.match(APP, /id: "theme", [^\n]*when: \(\) => !themeHinted\(\),/, "no theme's switch while the page wears the desk's look");
  // It is a tab of its own: it claims its chat as any page does (claimWriting's refusal is a popped pane's and a view-only page's alone).
  assert.match(APP, /function claimWriting\(how = "open"\) \{[\s\S]{0,300}?if \(POPPED \|\| viewOnlyPage\(\)\) return;/);
});

test("GET /remote/me's desk flags say the page shows a chat alone", () => {
  assert.ok(DESK.includes("chat-only"));
});
