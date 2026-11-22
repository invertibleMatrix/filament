// @ts-check
// The window (proposal_ux §3.1): the sidebar, then one frame — the header across its top, and under it the chat beside
// the panes. The sidebar is a flex-none column (264 default/min, half the window max, its width in localStorage); its
// top bar's Hide button or Ctrl+B hides it behind a 48px collapsed rail whose button brings it back (the sidebar draws
// the rail's other buttons), and while it shows, its top bar holds the chat's crumb, the header's tabs at its left
// (`header.crumbIn`, the owner's of 11-01); it auto-collapses below 360 (checked on window-resize idle, never mid-interaction, and
// restored only when the restored state still clears its threshold — no oscillation). Dragged past WIDE_SIDE, or in a
// window WIDE_WINDOW or wider, it is wide (`.wide`): each of its rows gets a second line (§3.2). The panes are the tile host's (panes/pane-host.js): it fits them
// to the window and has the shell paint them — docked beside the chat, their width taken from it, or floating over it
// on a GPU transform, the chat's parts stepping aside by their width. The frame carries the 12px radius + border; 4px
// gaps carry the resize handles. The bottom dock (composer, later the interaction blocks and the queue panel) is a CSS
// grid inside the chat's column whose children stack, so a block appearing does not jump the composer.
import { h } from "../lib/dom.js";
import { icon } from "./lib/icons.js";
import { resizeHandle, tooltip } from "./lib/ui.js";
import { rememberSidebar, lastSidebarOpen, lastSidebarWidth, rememberSidebarWidth } from "./state.js";
import { createHeader } from "./header.js";
import { SIDE_MIN_CONV } from "./lib/layout.js";
import { appFrame, startAppFrame, startLentFrame } from "./lib/app-frame.js";

const COLLAPSED_W = 48;
/** The left bar this wide, or a window this wide, gives each row its second line (proposal_ux §3.2). */
const WIDE_SIDE = 300;
const WIDE_WINDOW = 2200;

/**
 * @param {HTMLElement} root  the element the shell replaces the children of (#app)
 * @param {{ onSidebarReveal?: () => void, onHeader?: any, chatOnly?: boolean, onFullPage?: () => void }} [cb]
 *   `chatOnly`: the chat alone, as another machine's desk shows it (lib/chat-only.js) — no sidebar nor its rail, the
 *   crumb in the header, and no sidebar choice of this page's kept: this machine's own pages keep theirs;
 *   `onFullPage`: there, Open full page beside the header's layout menu — this machine's whole page at this chat
 */
export function createShell(root, cb = {}) {
  root.classList.add("app-shell");
  const chatOnly = cb.chatOnly === true;
  if (chatOnly) root.classList.add("chat-only");

  // --- the frames ---
  const sidebarHost = h("aside", { class: "side-frame", id: "sessions" });
  const sideGutter = h("div", { class: "side-gutter" });
  const sidebarOpenBtn = h("button", {
    class: "ghost icon collapsed-mark",
    type: "button",
    "aria-label": "Show sidebar",
    html: icon("panelLeftOpen"),
    onclick: () => cb.onSidebarReveal?.(),
  });
  tooltip(sidebarOpenBtn, { title: "Show sidebar", kbd: "Ctrl+B" });
  const collapsedRail = h("aside", { class: "collapsed-rail" },
    h("div", { class: "collapsed-strip" }, sidebarOpenBtn));

  const dragStrip = h("div", { class: "drag-strip", "aria-hidden": "true" });

  const header = createHeader(cb.onHeader || {});
  const { folderIn, folderLeaf, foldersDatalist, titleEl } = header;
  if (chatOnly && cb.onFullPage) {
    const onFull = cb.onFullPage;
    const fullBtn = h("button", { class: "ghost icon hdr-full", type: "button", "aria-label": "Open full page", html: icon("maximize2"), onclick: () => onFull() });
    tooltip(fullBtn, { title: "Open this machine's full page at this chat" });
    header.layoutSlot.after(fullBtn);
  }

  // The chat's column: the transcript, the views and the dock mount here (app.js appends them).
  const convFrame = h("section", { class: "conv-frame frame" });
  // The panes' frame: the tile host fills it.
  const paneHost = h("aside", { class: "pane-frame", id: "rail" });
  const splitRow = h("div", { class: "split-row" }, convFrame, paneHost);
  // The desktop app's window, its controls drawn over the page (lib/app-frame.js): the header is the window's title bar,
  // across the top over the frame, beside the sidebar's top row; a screen over the frame leaves the bar to the window.
  let titleBar = appFrame();
  // The one frame: the header over the chat and the panes; a full-frame screen (Settings, the Context page, a control
  // room, the artifacts) lies over all of it.
  const mainFrame = h("section", { class: "main-frame" }, titleBar ? null : header.el, splitRow);
  const dock = h("div", { class: "dock" });
  const contentCol = h("div", { class: "content-col" }, titleBar ? header.el : dragStrip, mainFrame);

  root.replaceChildren(sidebarHost, sideGutter, collapsedRail, contentCol);

  // --- state ---
  let sidebarW = lastSidebarWidth();
  let userOpen = lastSidebarOpen();
  let autoCollapsed = false;
  /** The panes as the tile host last had them painted. @type {import("./panes/pane-host.js").Look} */
  let panes = { shown: false, float: false, width: 0 };
  /** The sidebar's top row's room between Hide and Settings, once the sidebar is made: the crumb stands there while the
   *  sidebar shows. @type {HTMLElement | null} */
  let crumbSlot = null;

  /** One paint for every width and visibility class — the widths are inline styles, so hiding must also zero them
   * here, never fight them in CSS. Floating panes keep their width closed (the slide-out needs it) and hide
   * off-transform instead. */
  const paintLayout = () => {
    const sideHidden = chatOnly || !userOpen || autoCollapsed;
    root.classList.toggle("sidebar-off", !userOpen);
    root.classList.toggle("auto-side-off", autoCollapsed && userOpen);
    root.classList.toggle("pane-off", !panes.shown);
    root.classList.toggle("pane-float", panes.float);
    root.classList.toggle("pane-float-open", panes.float && panes.shown);
    root.classList.toggle("panes-docked", !panes.float && panes.shown);
    sidebarHost.style.width = sideHidden ? "0px" : `${sidebarW}px`;
    sidebarHost.classList.toggle("wide", sidebarW >= WIDE_SIDE || window.innerWidth >= WIDE_WINDOW);
    // The chat's crumb in the sidebar's top row while it shows, the tabs then at the header's left — clear of a
    // MacBook's notch at the screen's top centre; folded or hidden, in the header as ever (the owner's of 11-01). Where
    // a Mac's close, minimize and zoom take that row's left end, in the header still: beside them the row left it a
    // letter of each name (the owner's of 11-08), and a window stands under the menu bar, its notch above it.
    header.crumbIn(sideHidden || lightsAtLeft() ? null : crumbSlot);
    sideGutter.style.display = sideHidden ? "none" : "";
    collapsedRail.style.width = sideHidden && !chatOnly ? `${COLLAPSED_W}px` : "0px";
    paneHost.style.width = panes.shown || panes.float ? `${panes.width}px` : "0px";
    // The panes' width: docked, the header's buttons over them take it; floating, the chat's parts step aside by it (the
    // transcript, the dock, the views), so nothing of theirs sits under the pane.
    root.style.setProperty("--pane-w", `${panes.width}px`);
  };

  /** Whether a Mac's window buttons stand at the top row's left end (lib/app-frame.js). */
  function lightsAtLeft() {
    return document.documentElement.classList.contains("app-frame-left");
  }

  const maxSidebar = () => Math.max(264, Math.floor(window.innerWidth / 2));
  const sideHandle = resizeHandle({
    axis: "x",
    min: 264,
    max: maxSidebar,
    get: () => sidebarW,
    set: (px) => { sidebarW = Math.round(px); paintLayout(); },
    onEnd: () => rememberSidebarWidth(sidebarW),
  });
  sideGutter.append(sideHandle.el);

  /** Width transitions are off while a handle drags (the acceptance: no lag between 264 and 400). @param {boolean} on */
  const dragging = (on) => root.classList.toggle("dragging", on);
  sideGutter.addEventListener("pointerdown", () => {
    dragging(true);
    const end = () => {
      dragging(false);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });

  /** @param {boolean} on */
  const setSidebar = (on) => {
    // The chat alone has no sidebar to show, and keeps no choice of it.
    if (chatOnly) return;
    userOpen = on;
    autoCollapsed = false;
    rememberSidebar(on);
    paintLayout();
  };

  /** What the window's resize asks of the panes first (the tile host's fitting). @type {(() => void)[]} */
  const roomers = [];
  // The auto-collapse policy runs on window-resize idle (300ms), never on a chat resize — an opened pane must not yank
  // the sidebar. The panes are fitted first; the sidebar then goes by the chat they leave, and when it folds or comes
  // back the panes are fitted again to the row that made. Each restore happens only if the restored state still clears
  // its threshold, so the two states cannot oscillate.
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resizeIdle;
  const applyAutoPolicy = () => {
    for (const f of roomers) f();
    const row = splitRow.clientWidth;
    const conv = panes.shown && !panes.float ? row - panes.width : row;
    const sideWouldLeave = autoCollapsed ? conv - sidebarW - 4 + COLLAPSED_W : conv;
    const was = autoCollapsed;
    autoCollapsed = sideWouldLeave < SIDE_MIN_CONV;
    paintLayout();
    if (autoCollapsed !== was) for (const f of roomers) f();
  };
  window.addEventListener("resize", () => {
    clearTimeout(resizeIdle);
    resizeIdle = setTimeout(applyAutoPolicy, 300);
  });
  paintLayout();
  applyAutoPolicy();
  // The window's controls wear the chrome's colours: the sidebar's ground and its buttons' ink. A page built while they
  // stood over nothing — loaded again in a minimized window, as Filament restarted under it — gives its header the bar's
  // place the moment they show, out of the frame as above.
  const frameOn = {
    colors: () => ({ color: getComputedStyle(sidebarHost).backgroundColor, symbolColor: getComputedStyle(sidebarOpenBtn).color }),
    onShown: () => {
      // Where the buttons stand decides where the crumb does.
      paintLayout();
      if (titleBar) return;
      titleBar = true;
      dragStrip.replaceWith(header.el);
    },
  };
  startAppFrame(frameOn);
  // Another machine's page in the desktop app's window: the room the controls take, lent by the app, as they stand over
  // it too (the owner's of 11-08).
  startLentFrame(frameOn);

  // Ctrl+B and Ctrl+Alt+B are registered shortcuts (app.js), so the shell does not listen for them.

  return {
    root,
    mainFrame,
    sidebarHost,
    collapsedRail,
    header,
    titleEl,
    folderIn,
    folderLeaf,
    foldersDatalist,
    convFrame,
    dock,
    paneHost,
    setSidebar,
    /** The panes painted as the tile host has them. @param {import("./panes/pane-host.js").Look} look */
    paintPanes(look) {
      panes = look;
      paintLayout();
    },
    /**
     * A full-frame screen over the frame, or gone: what it covers waits unseen and inert, as it was — no focus left in
     * it, so keys typed go to the screen and not to a field under it.
     * @param {boolean} on
     */
    setScreen: (on) => {
      mainFrame.classList.toggle("screen-on", on);
      // The header out of the frame, as the window's title bar: under a screen, the bar alone.
      root.classList.toggle("screen-up", on);
      header.el.inert = on;
      splitRow.inert = on;
      // The crumb in the sidebar's row is the chat's, as the header is: unseen and inert under the screen too.
      if (crumbSlot) crumbSlot.inert = on;
    },
    /** The sidebar's room for the crumb, once the sidebar is made (app.js). @param {HTMLElement} el */
    setCrumbSlot(el) {
      crumbSlot = el;
      crumbSlot.inert = root.classList.contains("screen-up");
      paintLayout();
    },
    /** The room the panes are fitted to: the split row's width, the window's, and the row's height. */
    room: () => ({ row: splitRow.clientWidth, win: window.innerWidth, height: splitRow.clientHeight }),
    /** Asked on every window resize, before the sidebar's rule. @param {() => void} f */
    onRoom: (f) => { roomers.push(f); },
    dragging,
    get sidebarOpen() { return userOpen && !chatOnly; },
  };
}
