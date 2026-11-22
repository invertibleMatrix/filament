// @ts-check
// The chat's crumb in the sidebar's top row while the sidebar shows (the owner's of 11-01: "on left side we have this
// empty space in collapse button and settings button ... when the side bar is open we move the git worktree related
// thing and chat menu ... over there but when side bar is collapsed or hidden we show that exactly the way they
// currently show ... when side bar is opened we move the tabs to the left as well and the reason being on macbook laptop
// we have this notch and dynamic island in the center that will get in the way"). The real shell, header and sidebar
// are drawn on the stub document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

const g = /** @type {any} */ (globalThis);
/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {Record<string, any>} */
const had = {};
const STUBS = {
  EventSource: class { addEventListener() {} close() {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ sessions: [], projects: [], runs: [] }) }),
};
before(() => {
  doc = stubDocument();
  for (const [k, v] of Object.entries(STUBS)) {
    had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
    g[k] = v;
  }
  const d = /** @type {any} */ (doc.document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
});
after(() => {
  for (const k of Object.keys(STUBS)) {
    if (had[k] === undefined) delete g[k];
    else g[k] = had[k];
  }
  doc.restore();
});

/** The shell, a stand-in for the sidebar's room, and where the crumb stands. */
const drawn = async () => {
  const { createShell } = await import("../src/ui/harness/shell.js");
  const noop = () => {};
  const root = document.createElement("div");
  const shell = /** @type {any} */ (createShell(/** @type {any} */ (root), { onHeader: { onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null } }));
  doc.document.body.append(root);
  const slot = /** @type {any} */ (document.createElement("div"));
  shell.setCrumbSlot(slot);
  const left = shell.header.el.querySelector(".c-left");
  const crumb = shell.header.el.querySelector(".c-crumb") || slot.querySelector(".c-crumb");
  return { shell, slot, left, crumb: () => crumb };
};

// (fails before: yes — the crumb stood in the header whatever the sidebar did, the tabs centred in the room it left)
test("the sidebar shown: the crumb stands in its top row and the tabs at the header's left; hidden, both as before", async () => {
  const { shell, slot, left, crumb } = await drawn();
  // The stub's row measures nothing, so the window reads too narrow and the sidebar folds by itself: as folded.
  assert.equal(left.children[0], crumb(), "folded: the crumb first in the header's left, as ever");
  assert.equal(shell.header.el.classList.contains("crumb-away"), false);
  shell.setSidebar(true);
  assert.equal(crumb().parentNode, slot, "shown: in the sidebar's top row");
  assert.ok(slot.contains(shell.titleEl) && slot.contains(shell.folderIn), "the one crumb, its fields with it — never a copy");
  // …and the linked chats' chip after them (thread-ui.test.js), hidden in a chat no thread links.
  assert.deepEqual(left.children.map((/** @type {any} */ c) => c.className), ["c-mid", "c-thread hidden"], "the header's left holds the tabs");
  assert.equal(shell.header.el.classList.contains("crumb-away"), true, "the tabs stand at its left (`.crumb-away`)");
  shell.setSidebar(false);
  assert.equal(left.children[0], crumb(), "hidden: back in the header, before the tabs");
  assert.equal(slot.children.length, 0);
  assert.equal(shell.header.el.classList.contains("crumb-away"), false);
});

// (fails before: yes — no crumb in the sidebar to keep from a screen)
test("under a full-frame screen the crumb in the sidebar is inert, as the header is; a chat menu open on it closes as it moves", async () => {
  const { shell, slot } = await drawn();
  shell.setSidebar(true);
  shell.setScreen(true);
  assert.equal(slot.inert, true);
  shell.setScreen(false);
  assert.equal(slot.inert, false);
  // The chat menu, opened on the name, with the crumb in the sidebar; the sidebar hidden (Ctrl+B) takes the crumb back.
  const name = /** @type {any} */ (shell.titleEl).parentNode;
  name.dispatch("click", { detail: 0 });
  assert.ok(doc.document.body.querySelector(".zc-menu"), "the chat menu is open");
  shell.setSidebar(false);
  assert.equal(doc.document.body.querySelector(".zc-menu"), null, "closed with the move, never left where the name was");
});

// (fails before: yes — the room between Hide and Settings was an empty spacer)
test("the sidebar's top row: Hide, the room for the crumb, Settings; the page hands that room to the shell", async () => {
  const { createSidebar } = await import("../src/ui/harness/sidebar.js");
  const host = /** @type {any} */ (document.createElement("div"));
  const sb = /** @type {any} */ (createSidebar(host, /** @type {any} */ ({ onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {} })));
  const top = host.querySelector(".sess-top");
  assert.deepEqual(top.children.map((/** @type {any} */ c) => c.getAttribute("aria-label") || c.className), ["Hide sidebar", "sess-top-crumb", "Settings"]);
  assert.equal(sb.crumbSlot, top.children[1]);
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /\}, shell\.collapsedRail\);[\s\S]{0,300}?shell\.setCrumbSlot\(sidebar\.crumbSlot\);/);
  const css = readFileSync("src/ui/harness.css", "utf8");
  assert.match(css, /\.sess-top-crumb \{ position: relative; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; \}/, "it takes the row's room, cut as it needs");
  assert.match(css, /\.app-shell\.screen-up \.sess-top-crumb \{ visibility: hidden; \}/);
  assert.match(css, /\.c-bar\.crumb-away \.c-mid \{ justify-content: flex-start; \}/);
  // The shell moves it whenever it paints the sidebar's state: the folded rail and a hidden bar are one there.
  // A Mac's window buttons at that row's left end keep it in the header (the owner's of 11-08), painted again as they show.
  const shell = readFileSync("src/ui/harness/shell.js", "utf8");
  assert.match(shell, /const sideHidden = chatOnly \|\| !userOpen \|\| autoCollapsed;[\s\S]*?header\.crumbIn\(sideHidden \|\| lightsAtLeft\(\) \? null : crumbSlot\);/);
  assert.match(shell, /function lightsAtLeft\(\) \{\n\s*return document\.documentElement\.classList\.contains\("app-frame-left"\);/);
  assert.match(shell, /onShown: \(\) => \{\n(?:\s*\/\/[^\n]*\n)?\s*paintLayout\(\);\n\s*if \(titleBar\) return;/);
});

// (fails before: yes — the review of 11-01, then the drive: in the sidebar's row the folder chip, held near half the
// row, laid its 180 px field out past its box, over the chat's name; and the tabs, alone at the header's left, lost
// their words at the widths that made room for the crumb beside them)
test("in the sidebar's row the folder's field takes the row while it is typed in; alone in the header, the tabs keep their words in the crumb's room", () => {
  const css = readFileSync("src/ui/harness.css", "utf8");
  assert.match(css, /\.sess-top-crumb \{ position: relative; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; \}/);
  assert.match(css, /\.sess-top-crumb \.ws-chip:focus-within \{ position: absolute; inset: 0; max-width: none; z-index: 1; \}/, "laid over the row");
  assert.match(css, /\.sess-top-crumb \.ws-chip:focus-within input \{ flex: 1 1 auto; width: auto; min-width: 0; \}/);
  // (fails before: yes — the review's second read: hidden, the chat's name left the keys' order, and Tab went from the
  // folder past the chat menu)
  assert.doesNotMatch(css, /\.sess-top-crumb \.ws-chip:focus-within ~ \*/, "the chat's name stays under it, in the keys' order");
  const views = readFileSync("src/ui/harness/views/views.css", "utf8");
  // Beside the crumb, as before — the rules as weighty as they were, so a tab popped out on top keeps its own padding.
  assert.match(views, /@container hdr-left \(max-width: 600px\) \{\n\s*:where\(\.c-bar:not\(\.crumb-away\)\) \.view-tab:not\(\.is-on\) \.view-tab-label \{ display: none; \}\n\s*:where\(\.c-bar:not\(\.crumb-away\)\) \.view-tab:not\(\.is-on\) \{ padding: 0 10px; \}\n\}/);
  assert.match(views, /@container hdr-left \(max-width: 440px\) \{\n\s*:where\(\.c-bar:not\(\.crumb-away\)\) \.view-tab-label \{ display: none; \}\n\s*:where\(\.c-bar:not\(\.crumb-away\)\) \.view-tab \{ padding: 0 10px; \}\n\}/);
  // Alone, the crumb's 220 px are theirs.
  assert.match(views, /@container hdr-left \(max-width: 380px\) \{\n\s*:where\(\.c-bar\.crumb-away\) \.view-tab:not\(\.is-on\) \.view-tab-label \{ display: none; \}\n\s*:where\(\.c-bar\.crumb-away\) \.view-tab:not\(\.is-on\) \{ padding: 0 10px; \}\n\}/);
  assert.match(views, /@container hdr-left \(max-width: 220px\) \{\n\s*:where\(\.c-bar\.crumb-away\) \.view-tab-label \{ display: none; \}\n\s*:where\(\.c-bar\.crumb-away\) \.view-tab \{ padding: 0 10px; \}\n\}/);
});

// (fails before: yes — the owner's leftover of 11-01: Enter kept the folder and stayed in the field, and Escape did
// nothing, so in the sidebar's row the field stayed laid over the chat's name until a press somewhere else)
test("the folder's field: Enter keeps what was typed and leaves it; Escape puts back the folder it held and leaves it", async () => {
  const { shell } = await drawn();
  const f = shell.folderIn;
  /** @type {string[]} */
  const did = [];
  f.blur = () => void did.push("left");
  f.dispatchEvent = (/** @type {Event} */ e) => void did.push(e.type);
  const key = (/** @type {string} */ k, more = {}) => {
    let stopped = false;
    f.dispatch("keydown", { key: k, isComposing: false, preventDefault: () => { stopped = true; }, ...more });
    return stopped;
  };
  f.value = "H:\\app";
  f.dispatch("focus");
  f.value = "H:\\app\\server";
  assert.equal(key("Enter"), true);
  assert.deepEqual([f.value, did], ["H:\\app\\server", ["left"]], "kept as typed: leaving it commits it, as a press elsewhere does");
  did.length = 0;
  f.dispatch("focus");
  f.value = "H:\\elsewh";
  assert.equal(key("Escape"), true);
  assert.deepEqual([f.value, did], ["H:\\app\\server", ["input", "left"]], "the folder it held, its leaf drawn again");
  did.length = 0;
  f.dispatch("focus");
  assert.equal(key("Escape"), true);
  assert.deepEqual(did, ["left"], "nothing typed: it only leaves");
  did.length = 0;
  f.dispatch("focus");
  f.value = "H:\\日本";
  assert.deepEqual([key("Enter", { isComposing: true }), key("a"), key("Tab"), did], [false, false, false, []], "an IME's Enter, and any other key, are the field's own");
  // (fails before: yes — the review of 11-01: a folder picked from the list commits at once, and Escape put the old one
  // back in the field alone, the page left on the one picked; and a folder the page set while the field had focus — a
  // chat switched by its key — was taken back to the one before)
  did.length = 0;
  f.value = "H:\\app";
  f.dispatch("focus");
  f.value = "H:\\lib";
  f.dispatch("input", { isTrusted: true });
  f.dispatch("change", { isTrusted: true });
  key("Escape");
  assert.deepEqual([f.value, did], ["H:\\app", ["input", "change", "left"]], "the folder it held, committed again");
  did.length = 0;
  f.dispatch("focus");
  f.value = "H:\\other-chat";
  f.dispatch("input", { isTrusted: false });
  f.value = "H:\\typo";
  key("Escape");
  assert.deepEqual([f.value, did], ["H:\\other-chat", ["input", "left"]], "the page's own word on the field is what Escape puts back");
});

// (fails before: yes — the review of 11-01: the chip's hover card, open over the field as it was pressed, took the first
// Escape for itself)
test("the folder's field: its hover card goes as the field takes focus, and comes to no field typed in", async () => {
  const { shell } = await drawn();
  const f = shell.folderIn;
  const chip = f.parentNode;
  const card = () => doc.document.body.querySelector(".ws-card");
  const after = () => new Promise((r) => setTimeout(r, 350));
  f.value = "H:\\app";
  chip.dispatch("pointerenter");
  await after();
  assert.ok(card(), "the pointer on the chip: its card");
  f.dispatch("focus");
  assert.equal(card(), null, "the field taken: the card goes");
  chip.dispatch("pointerleave");
  chip.dispatch("pointerenter");
  await after();
  assert.equal(card(), null, "typed in: none comes");
  f.dispatch("blur");
  chip.dispatch("pointerleave");
  chip.dispatch("pointerenter");
  await after();
  assert.ok(card(), "left: the card comes again");
  chip.dispatch("pointerleave");
});
