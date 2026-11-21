// @ts-check
// The panes beside the chat (proposal_ux §3.5, Phase 1): tiles, each a stack of tabs, laid out by tiles.js and fitted
// to the window by lib/layout.js — docked in columns where the chat keeps its room, floating over it as one tile with
// tabs where it does not. A tile's head is its pane's app-icon tile and name with the pane's own controls beside them
// (Changes' scopes, the Terminal's shells), or its tabs when it holds more than one; then Pop out (the desktop app's),
// its ⋯ menu and its close. Tabs and tiles move by drag (tile-drag.js) or the ⋯ menu's Move; the gaps between them size
// them and a double-click evens them out; the panes' left edge sizes them all. Each chat keeps its own panes as it left
// them — which are open, laid out how, on or off, those on top — and a chat never shown starts with none (the owner's of
// 11-05); how they open, where they sit and their widths are the person's across chats. Tool panes draw the chat shown; a
// file's, an artifact's or an agent's thread's tab belongs to the chats it was opened in (tiles.js). A thread's tab is
// the host's to draw (`thread`), and let go when its tile shows another or goes. Each window keeps its own layout
// (sessionStorage, through a reload); a new window starts from the last one any window kept. The conductor's contract
// (openTab, addTab, openFileTab, openArtifactTab, setChat, draw, pulse, refresh, refreshInPlace, setOpen) is kept. Pop out
// (HarnessV4_DesignPass_Plan UX10) puts a tile's tab on top of the chat: a tab after the views' (views/host.js), its pane
// full size in the chat's place (`topFrame`), drawn here as a tile is; Back to the side, or its tab's ×, puts it back in
// its tile. In a window of its own (HarnessV4_BrowserSize_Plan BS4, the desktop app's) puts it in a window — this host
// again, in the harness page showing that tab alone (`only`) —, and the tile it left says so, with Bring back (BS-D8).
import { h, morphChildren, placeChildren, setHtml, standing } from "../../lib/dom.js";
import { store } from "../../lib/store.js";
import { glyphOf, icon } from "../lib/icons.js";
import { button, menu, resizeHandle, tooltip } from "../lib/ui.js";
import { PANE_MIN, PANE_MIN_CONV, dockFor, fitPane, panesWidth, roomHides, rowsFor } from "../lib/layout.js";
import { lastPaneWidth, rememberPaneWidth } from "../state.js";
import { comboOf } from "../shortcuts.js";
import { fileTabId, parseFileTabId, parseResultTabId, parseThreadTabId, closedTabsOf, tabCanOpen } from "./pane-data.js";
import { refreshCodeViewer, renderCodeViewer } from "./code-viewer.js";
import { renderArtifactPane } from "./artifact.js";
import { artifactTabId, markOf, parseArtifactTabId, titleOfName } from "../lib/artifacts.js";
import { possessive } from "../lib/labels.js";
import { dragTab } from "./tile-drag.js";
import * as T from "./tiles.js";

const LAYOUT_KEY = "harness.panes";
/** Each chat's own panes, by its key, the newest last: a chat shown again finds them as it left them. */
const CHATS_KEY = "harness.panes.chats";
const CHATS_MAX = 60;
/** The one tab strip's keys, read to carry its tabs over into the first tile (proposal_ux §3.5). */
const STRIP_TABS_KEY = "harness.sidePane.tabs";
const STRIP_TAB_KEY = "harness.rail";
/** The tabs closed last, newest first: the command center offers them again. */
const CLOSED_KEY = "harness.sidePane.closed";
const CLOSED_MAX = 10;
/** Why a window of its own is greyed in a browser's tab: its windows are the desktop app's (proposal_ux §3.5). */
const POP_NEEDS = "needs the desktop app";
/**
 * A popped window's layout: its one tab in one tile, shown in every chat, kept nowhere (BS4).
 * @param {string} tab @param {(id: string) => boolean} canOpen
 */
const onlyLayout = (tab, canOpen) => T.readLayout(JSON.stringify({ cols: [{ w: 1, tiles: [{ id: "t1", tabs: [tab], active: tab, h: 1 }] }], shown: true, focus: "t1", seq: 1 }), canOpen);
/** A column's and a tile's least size while a gap is dragged. */
const COL_LEAST = 220;
const TILE_LEAST = 96;
/** The pane frame's padding around its tiles, top and bottom. */
const FRAME_PAD = 8;

/**
 * @typedef {{ id: string, label: string, icon: string, tone?: string, render: (body: HTMLElement, ctx: any) => void,
 *   refresh?: (body: HTMLElement, ctx: any) => void, back?: { title: string, run: () => void } }} Pane
 *   `back`: a pane that is a page of the chat's own put beside it (the Plan, HarnessV4_TaskGraphPlus_Design D12): its
 *   Pop out button takes it back there, its words `title`, with Back to the side's glyph
 * @typedef {{ shown: boolean, float: boolean, width: number }} Look  what the shell paints: the panes on screen or not,
 *   floating over the chat or docked beside it, and their width
 * @typedef {{ id: string, el: HTMLElement, head: HTMLElement, lead: HTMLElement, tools: HTMLElement, bar: HTMLElement,
 *   body: HTMLElement, pop: HTMLElement, more: HTMLElement, close: HTMLElement, tab: string, chat: any,
 *   away: boolean, at: T.ShownTile | null, letGo: (() => void) | null }} TileView
 *   `tools`: the pane's own controls, in the head beside its name or in a bar under the tabs; `tab`, `chat`: what the
 *   body shows, drawn for; `away`: the body says its tab is in a window of its own (BS4); `letGo`: what the body's
 *   thread follows, let go when the body shows another
 * @typedef {{ has: (id: string) => boolean, out: (id: string) => void, back: (id: string) => void,
 *   follow?: { get: () => boolean, set: (on: boolean) => void } }} PopOut
 *   the desktop app's Pop out (BS4): which tabs are out, a tab put in a window of its own (or its window shown), one
 *   brought back; in a popped window, its Follow the main window
 */

/**
 * @param {HTMLElement} host  the panes' frame
 * @param {{ panes: Pane[], room: () => { row: number, win: number, height: number }, paint: (look: Look) => void,
 *   dragging?: (on: boolean) => void, onChange?: () => void,
 *   artifact?: { onTell: (text: string) => void, onAsk: (text: string) => void, onFull: (name: string) => void },
 *   thread?: { render: (body: HTMLElement, id: string, head: HTMLElement) => () => void, label: (id: string) => { label: string, icon: string } | null },
 *   result?: { render: (body: HTMLElement, id: string) => () => void, label: (id: string) => string | null },
 *   onClosed?: (id: string) => void, only?: string, pop?: PopOut | null, elsewhere?: (id: string) => void,
 *   top?: { show: (id: string) => void, moved: () => void }, onInsert?: (text: string) => void }} cb
 *   `room`: the split row's width, the window's, and the row's height (the shell's); `paint`: the shell paints the frame;
 *   `onChange`: what shows changed (the header's pane buttons); `onClosed`: you closed a tab yourself. A pane's
 *   `refresh`, where it has one, answers the run's pulse in place of a whole draw: what it holds under the cursor (a
 *   slider mid-drag, a list opened) stays. `artifact`: what an artifact's tab does with its failure's Tell the agent, its
 *   page's ask (AF-D8) and its Open full (HarnessV4_Artifacts_Plan AF-D35). `thread`: an agent's thread drawn into a
 *   tile's body — what it answers lets it go — and its tab's name and glyph, null while the agent is not known. `result`: a
 *   team's result (team_v2_plan §10 O3), drawn and let go the same way, and its team's name. `only`: the one tab a
 *   popped window shows (BS4) — one tile, the whole frame, its layout kept nowhere; `pop`: the desktop app's Pop out,
 *   none in a browser's tab; `elsewhere`: in a popped window, a tab its pane opens — the main window opens it. `top`:
 *   the views host's, a tab on top shown as the chat's view, and the tabs on top moved (UX10). `onInsert`: a file's
 *   tab's Add to chat, which writes its `@path` into the message box.
 */
export function createPaneHost(host, cb) {
  /** @param {string} id */
  const paneOf = (id) => cb.panes.find((p) => p.id === id) || null;
  /** A tab the panes can open: one of theirs, a file, an artifact (HarnessV4_Artifacts_Plan AFC-71). @param {string} id */
  const canOpen = (id) => tabCanOpen(id, cb.panes);

  // --- the layout, this window's ---
  const sessionKey = `filament.${LAYOUT_KEY}`;
  const saved = () => {
    try {
      const own = sessionStorage.getItem(sessionKey);
      if (own) return own;
    } catch {}
    return store.get(LAYOUT_KEY);
  };
  /** A popped window's one tab (BS4), or "" in the harness's own window. */
  const only = cb.only || "";
  const pop = cb.pop || null;
  const L = only ? onlyLayout(only, canOpen) : T.readLayout(saved(), canOpen, { tabs: store.get(STRIP_TABS_KEY), tab: store.get(STRIP_TAB_KEY) });
  /** The chats' own panes as kept, by key. @returns {Record<string, string>} */
  const chatsKept = () => {
    try {
      const all = JSON.parse(store.get(CHATS_KEY) || "{}");
      return all && typeof all === "object" && !Array.isArray(all) ? all : {};
    } catch {
      return {};
    }
  };
  /** One chat's panes kept — the newest last, the oldest past CHATS_MAX gone — or let go (null). @param {string} k @param {string | null} json */
  const keepChat = (k, json) => {
    if (only || !k) return;
    const all = chatsKept();
    delete all[k];
    if (json) all[k] = json;
    const ks = Object.keys(all);
    for (const x of ks.slice(0, Math.max(0, ks.length - CHATS_MAX))) delete all[x];
    store.set(CHATS_KEY, JSON.stringify(all));
  };
  /** No chat kept panes of its own yet: the first one shown takes the window's, as every chat shared them. */
  const firstOfAll = !only && store.get(CHATS_KEY) === null;
  // A page's own chats (`p:`, never sent) were another page's.
  if (!only && !firstOfAll) {
    const all = chatsKept();
    if (Object.keys(all).some((k) => k.startsWith("p:"))) store.set(CHATS_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith("p:")))));
  }
  /** A chat's panes to keep, or none where it has no pane: a chat that holds none takes no place among the kept. */
  const chatJson = () => (L.cols.length || L.held.length || L.top.length ? T.layoutJson(L) : null);
  const persist = () => {
    // A popped window's layout is its one tab: the main window's stays as the person left it.
    if (only) return;
    const json = T.layoutJson(L);
    try { sessionStorage.setItem(sessionKey, json); } catch {}
    store.set(LAYOUT_KEY, json);
    if (ready) keepChat(key, chatJson());
  };
  /** @param {string} key */
  const savedList = (key) => { try { return JSON.parse(store.get(key) || "[]"); } catch { return []; } };
  let closed = closedTabsOf(savedList(CLOSED_KEY), cb.panes, CLOSED_MAX);

  /** id → count badge: a pane sets it when its data lands. @type {Map<string, number>} */
  const badges = new Map();
  /** A tab's mark, by its pane, and what it says: something there waits for you. @type {Map<string, string>} */
  const marks = new Map();
  /** An artifact tab's title and mark once its record is read; before, its name's words (AFC-71). @type {Map<string, { label: string, icon: string }>} */
  const artifactLabels = new Map();
  /** @type {Map<string, TileView>} */
  const views = new Map();
  /** The tabs on top's views (UX10), by tab: made as one first shows, kept while it is on top in the chat. @type {Map<string, TileView>} */
  const topViews = new Map();
  /** Where the views host shows a tab on top: each one's view in it, the one on screen alone shown. */
  const topFrame = h("div", { class: "vw vw-pane", role: "tabpanel" });
  /** The tab on top on screen; "" while the chat shows another view. */
  let topShown = "";
  /** The tabs on top as the views host was last told them: none, to start with. */
  let toldTops = "[]";

  /** @type {any} */
  let chat = null;
  /** The chat's key among an item's owners. */
  let key = "";
  /** Nothing is drawn before the first chat: a pane draws for one. */
  let ready = false;
  /** @type {T.Room} */
  let room = { cols: 0, rows: 1 };
  /** @type {T.ShownColumn[]} */
  let shown = [];
  /** The floating pane's width, as the person chose it; null until it first floats. */
  let floatW = lastPaneWidth();
  /** Floating, the window's room hid the pane on a resize (until an ask shows it). */
  let autoOff = false;
  /** As last painted: on screen, floating, the width, and the room it was fitted to. */
  let look = { on: false, float: false, width: 0, row: 0, least: PANE_MIN_CONV };

  // --- the frame: the panes' edge (their width), the tiles ---
  const grid = h("div", { class: "tile-grid" });
  const edge = h("div", { class: "panes-edge", "aria-hidden": "true" });
  const maxFloat = () => Math.max(PANE_MIN, Math.floor(window.innerWidth * 0.6));
  const edgeHandle = resizeHandle({
    axis: "x",
    invert: true, // on the panes' left: dragging left widens them
    min: () => (look.float ? PANE_MIN : Math.max(1, shown.length) * PANE_MIN),
    max: () => (look.float ? maxFloat() : Math.max(PANE_MIN, look.row - look.least)),
    get: () => look.width,
    // A drag is the person choosing: the panes take the width they drag to, kept as theirs — the floating pane's, or the
    // docked panes' for as many columns as show.
    set: (px) => {
      const w = Math.round(px);
      if (look.float) floatW = w;
      else L.widths[String(Math.max(1, shown.length))] = w;
      look.width = w;
      cb.paint({ shown: look.on, float: look.float, width: w });
    },
    onEnd: () => {
      if (!look.float) persist();
      else if (floatW !== null) rememberPaneWidth(floatW);
    },
  });
  edge.append(edgeHandle.el);
  host.append(edge, grid);
  /** No transitions while a handle drags, wherever the pointer is let go. @param {HTMLElement} el */
  const dragsSize = (el) =>
    el.addEventListener("pointerdown", () => {
      cb.dragging?.(true);
      const end = () => {
        cb.dragging?.(false);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
  dragsSize(edge);

  /** Every tab knows its label, icon and tone, open or closed. @param {string} id */
  const defOf = (id) => {
    const file = parseFileTabId(id);
    if (file) return { id, label: file.path.split("/").pop() || file.path, title: file.path, icon: "fileCode2", tone: "var(--color-sys-gray)", file, artifact: null, thread: null, result: null, pane: null };
    const artifact = parseArtifactTabId(id);
    if (artifact) {
      const known = artifactLabels.get(id);
      return { id, label: known?.label || titleOfName(artifact), title: known?.label || titleOfName(artifact), icon: known?.icon || markOf(""), tone: "var(--color-sys-purple)", file: null, artifact, thread: null, result: null, pane: null };
    }
    const thread = parseThreadTabId(id);
    if (thread) {
      const known = cb.thread?.label(thread) || null;
      return { id, label: known?.label || "Agent", title: `${known?.label || "Agent"}'s thread`, icon: known?.icon || "bot", tone: "var(--color-sys-indigo)", file: null, artifact: null, thread, result: null, pane: null };
    }
    const result = parseResultTabId(id);
    if (result) {
      const name = cb.result?.label(result) || "A team";
      return { id, label: `${possessive(name)} result`, title: `${possessive(name)} result`, icon: "users", tone: "var(--color-sys-pink)", file: null, artifact: null, thread: null, result, pane: null };
    }
    const pane = paneOf(id);
    return pane ? { id, label: pane.label, title: pane.label, icon: pane.icon, tone: pane.tone || "var(--color-sys-gray)", file: null, artifact: null, thread: null, result: null, pane } : null;
  };

  /** The chat's key, re-keying its items and its panes once it is sent (held under the page's key until then). */
  const syncKey = () => {
    const k = T.chatKey(chat);
    if (k === key) return;
    const from = key;
    key = k;
    if (chat?.chainId && chat?.id) T.rekey(L, `p:${chat.id}`, k);
    keepChat(from, null);
    persist();
  };
  /**
   * Another chat shown: the one left keeps its panes as they stand, and this one's come back as it left them — none, off,
   * where it was never shown (the owner's of 11-05: a pane opened in one chat stays there, one closed stays closed). A
   * chat sent while another showed finds its panes under its page's key (`page`), its session's from now on. The tiles
   * drawn for the chat left go: the one shown draws its own, and nothing drawn for the other runs on.
   * @param {string} k @param {string} page
   */
  const enterChat = (k, page) => {
    if (ready) keepChat(key, chatJson());
    const all = k ? chatsKept() : {};
    const from = all[k] ? k : page && page !== k && all[page] ? page : "";
    if (from) {
      T.takeChat(L, T.readLayout(all[from], canOpen, {}, from));
      if (from !== k) {
        T.rekey(L, from, k);
        keepChat(from, null);
      }
    } else if (!ready && firstOfAll) T.ownedBy(L, k);
    else T.takeChat(L);
    key = k;
    ready = true;
    for (const v of views.values()) {
      letGoOf(v);
      v.el.remove();
    }
    views.clear();
    drawnShape = "";
    persist();
  };
  /** The views host is told of the tabs on top by its own chat switch, which the page makes next: not here meanwhile. */
  let quietTops = false;

  /** The room as the window has it now. */
  const measure = () => {
    const { row, win, height } = cb.room();
    // A popped window: its one tile, docked across the whole frame.
    if (only) {
      room = { cols: 1, rows: 1 };
      return { row, dock: { cols: 1, least: 0 } };
    }
    const dock = dockFor(L.place, row, win);
    room = { cols: dock.cols, rows: rowsFor(height - FRAME_PAD) };
    return { row, dock };
  };

  /**
   * The panes fitted to the window and painted: what shows of the layout in this chat and room, docked at the columns'
   * width, or floating at the width the person chose, narrowed for the chat. Floating, a resize hides the pane when even
   * its least leaves the chat short; an ask shows it whatever the room; a putting-back (the page itself opened a tab)
   * goes by the room (HarnessV4_Tasks U4); anything else leaves it as it was.
   * @param {"resize" | "ask" | "back"} [why]
   */
  function relayout(why) {
    syncKey();
    const { row, dock } = measure();
    shown = ready ? T.shownOf(L, key, room) : [];
    const wanted = ready && L.shown && shown.length > 0;
    const float = dock.cols < 1;
    let width;
    if (float) {
      // The person's width; the first time the pane floats, 45 % of the row, kept as theirs once it shows.
      const chosen = floatW ?? Math.max(PANE_MIN, Math.min(maxFloat(), Math.round(row * 0.45)));
      if (wanted && floatW === null) {
        floatW = chosen;
        rememberPaneWidth(chosen);
      }
      width = fitPane(chosen, row);
      if (why) autoOff = roomHides(why === "ask", width, row);
    } else {
      autoOff = false;
      width = only ? row : panesWidth(row, Math.max(1, shown.length), L.widths[String(shown.length)], dock.least);
    }
    look = { on: wanted && !autoOff, float, width, row, least: dock.least };
    cb.paint({ shown: look.on, float, width });
    paintTiles();
    paintTop();
    cb.onChange?.();
    tellTops();
  }

  // --- the tiles ---
  /** The structure drawn: which tiles in which columns. Only a new one moves nodes, and only the tiles whose place
   *  changed: an artifact's frame moved in the document loads again from its start. */
  let drawnShape = "";
  function paintTiles() {
    if (!look.on) return;
    const shape = shown.map((c) => c.tiles.map((t) => t.id).join(",")).join("|");
    if (shape !== drawnShape) {
      drawnShape = shape;
      /** Column nodes taken: each column keeps the node its first tile is in, where no column before took it. */
      const taken = new Set();
      /** @type {Node[]} */
      const cols = [];
      shown.forEach((c, ci) => {
        if (ci) cols.push(gapEl("col", ci, 0));
        const had = views.get(c.tiles[0].id)?.el.parentElement || null;
        const col = had && had.classList.contains("tile-col") && !taken.has(had) ? had : h("div", { class: "tile-col" });
        taken.add(col);
        /** @type {Node[]} */
        const kids = [];
        c.tiles.forEach((t, ti) => {
          if (ti) kids.push(gapEl("row", ci, ti));
          kids.push(viewOf(t.id).el);
        });
        placeChildren(col, kids);
        cols.push(col);
      });
      placeChildren(grid, cols);
      const keep = new Set(shown.flatMap((c) => c.tiles.map((t) => t.id)));
      for (const [id, v] of [...views]) {
        if (keep.has(id)) continue;
        letGoOf(v);
        views.delete(id);
      }
    }
    const cols = /** @type {HTMLElement[]} */ ([...grid.children].filter((el) => el.classList.contains("tile-col")));
    shown.forEach((c, ci) => {
      cols[ci].style.flex = `${c.w} 1 0px`;
      for (const t of c.tiles) {
        const v = viewOf(t.id);
        v.at = t;
        v.el.style.flex = `${t.h} 1 0px`;
        paintHead(v);
        drawTile(v, false);
      }
    });
    paintInUse();
  }

  /** The views shown, in order. */
  const shownViews = () => {
    /** @type {TileView[]} */
    const out = [];
    for (const c of shown)
      for (const t of c.tiles) {
        const v = views.get(t.id);
        if (v?.at) out.push(v);
      }
    return out;
  };
  /** The tile in use marked, where more than one shows: the one a pane with no room joins, and Alt+W closes. */
  const paintInUse = () => {
    const vs = shownViews();
    for (const v of vs) v.el.classList.toggle("in-use", vs.length > 1 && !!v.at?.from.includes(L.focus));
  };

  /** The Pop out button's words, as the tab shown stands. @param {TileView | undefined} v */
  const popWords = (v) => {
    if (only) return "Bring back: the pane goes back into the main window";
    const back = v?.at ? paneOf(v.at.active)?.back : null;
    if (back) return back.title;
    return v?.at && isAway(v.at.active) ? "Show its window: this pane is in a window of its own" : "Pop out: this pane full size, in a tab on top";
  };
  /** Whether a tab is in a window of its own, so its tile here says so (BS-D8). @param {string} id */
  const isAway = (id) => !only && !!id && !!pop?.has(id);

  /** A tile's view, made once. @param {string} id @returns {TileView} */
  function viewOf(id) {
    const had = views.get(id);
    if (had) return had;
    const lead = h("div", { class: "tile-lead" });
    const tools = h("div", { class: "tile-tools" });
    const bar = h("div", { class: "tile-bar" });
    const body = h("div", { class: "pane-body tile-body" });
    // Pop out: the tab shown on top of the chat, full size (UX10), in any window; on a tab in a window of its own
    // already (BS4), its window shown. In a popped window: Bring back.
    const popBtn = h("button", { class: "tile-btn", type: "button", "aria-label": only ? "Bring back" : "Pop out", html: icon(only ? "panelRightOpen" : "maximize2") });
    tooltip(popBtn, { title: () => popWords(views.get(id)) });
    popBtn.addEventListener("click", () => {
      if (!v.at) return;
      const back = paneOf(v.at.active)?.back;
      if (only) pop?.back(only);
      // A page of the chat's own put beside it goes back to its place there (D12).
      else if (back) back.run();
      else if (isAway(v.at.active)) pop?.out(v.at.active);
      else toTop(v.at.active);
    });
    const more = h("button", { class: "tile-btn", type: "button", "aria-label": "More", "aria-haspopup": "menu", html: icon("ellipsis") });
    tooltip(more, { title: "More" });
    const close = h("button", { class: `tile-btn${only ? " hidden" : ""}`, type: "button", "aria-label": "Close", html: icon("x") });
    tooltip(close, { title: () => (views.get(id)?.at?.tabs.length || 0) > 1 ? "Close these tabs" : "Close", kbd: () => comboOf("close-context") || "" });
    const head = h("div", { class: "tile-head" }, lead, tools, h("span", { class: "tile-sp" }), popBtn, more, close);
    const el = h("section", { class: "tile", tabindex: "-1", "data-tile": id }, head, bar, body);
    /** @type {TileView} */
    const v = { id, el, head, lead, tools, bar, body, pop: popBtn, more, close, tab: "", chat: null, away: false, at: null, letGo: null };
    more.addEventListener("click", (e) => { e.stopPropagation(); if (v.at) tileMenu(v, v.at); });
    close.addEventListener("click", () => { if (v.at) closeTabs(v.at.tabs); });
    // The tile in use: the one a pane opened with no room joins, and Alt+W closes.
    el.addEventListener("focusin", () => {
      const at = T.tileOf(L, v.tab);
      if (!at || L.focus === at.tile.id) return;
      L.focus = at.tile.id;
      persist();
      paintInUse();
    });
    // A pane alone in its tile moves by its title.
    dragTab(lead, {
      id: () => (v.at && v.at.tabs.length === 1 ? v.at.active : ""),
      label: () => defOf(v.tab)?.label || "",
      icon: () => defOf(v.tab)?.icon || "file",
      frame: host,
      allowed,
      onDrop: dropped,
      onDragging: (on) => cb.dragging?.(on),
    });
    views.set(id, v);
    return v;
  }

  /** A tab's app-icon tile in its pane's colour. @param {{ icon: string, tone: string }} def @param {string} cls */
  const glyph = (def, cls) => h("span", { class: `${cls} tk-tile`, style: `--tone:${def.tone}`, html: glyphOf(def.icon) });
  /** @param {string} id */
  const countOf = (id) => {
    const n = badges.get(id);
    const said = marks.get(id);
    const dot = said ? h("span", { class: "tile-mark", title: said, "aria-label": said }) : null;
    return n != null && n > 0 ? h("span", { class: "tile-count" }, String(n), dot) : dot;
  };

  /** A tile's head: its pane's tile and name, or its tabs; the pane's own controls beside the name or under the tabs. @param {TileView} v */
  function paintHead(v) {
    const t = v.at;
    if (!t) return;
    const multi = t.tabs.length > 1;
    v.el.classList.toggle("multi", multi);
    v.pop.classList.toggle("is-on", isAway(t.active));
    // A page of the chat's own put beside it: Pop out goes back to its place, with Back to the side's glyph (D12). A tab
    // on top's head has its own buttons (`topViewOf`).
    const back = !only && !!paneOf(t.active)?.back;
    if (!v.id.startsWith("top:") && v.pop.dataset.back !== String(back)) {
      v.pop.dataset.back = String(back);
      setHtml(v.pop, icon(back || only ? "panelRightOpen" : "maximize2"));
      v.pop.setAttribute("aria-label", only ? "Bring back" : back ? "Back to its tab" : "Pop out");
    }
    // Drawn in place, each tab by its id: a count landing at each pulse, a mark or a thread's name made the strip anew,
    // its tabs new buttons under a resting pointer (the owner's of 11-01: buttons blinking under a resting pointer,
    // clicks lost).
    if (multi) {
      const strip = h("div", { class: "tile-tabs", role: "tablist", "data-key": "tabs" }, ...t.tabs.map((id) => tabEl(v, t, id)));
      morphChildren(v.lead, [strip]);
      const live = /** @type {HTMLElement} */ (standing(strip));
      if (v.tools.parentElement !== v.bar) v.bar.append(v.tools);
      // More than fit even shrunk: the strip scrolls, the tab shown in sight.
      const on = /** @type {HTMLElement | null} */ (live.querySelector(".tile-tab.on"));
      if (on && live.scrollWidth > live.clientWidth) live.scrollLeft = Math.max(0, on.offsetLeft + on.offsetWidth - live.clientWidth);
    } else {
      const def = defOf(t.active);
      morphChildren(v.lead, def ? [glyph(def, "tile-ic"), h("span", { class: "tile-name", title: def.title }, def.label), countOf(def.id)] : []);
      if (v.tools.parentElement !== v.head) v.head.insertBefore(v.tools, v.lead.nextSibling);
    }
    v.lead.classList.toggle("drags", !multi);
  }

  /**
   * One of a tile's tabs. Its presses ride the draw (`h`'s on*): drawn over the tab that stands for its id, they act
   * on it, where a listener added to this one would be lost with it. Its drag's listeners stay the standing tab's
   * first: they read the tab's id, name and glyph as they fire.
   * @param {TileView} v @param {T.ShownTile} t @param {string} id
   */
  function tabEl(v, t, id) {
    const def = defOf(id);
    const on = id === t.active;
    const x = h("button", {
      class: "tile-tab-x", type: "button", title: "Close tab", "aria-label": "Close tab", "data-no-drag": "", html: icon("x"),
      onclick: (/** @type {MouseEvent} */ e) => { e.stopPropagation(); closeTabs([id]); },
    });
    const tab = h("button", {
      class: `tile-tab${on ? " on" : ""}`, type: "button", role: "tab", "aria-selected": on ? "true" : "false", title: def?.title || id, "data-key": id,
      onclick: () => setTab(id),
      onauxclick: (/** @type {MouseEvent} */ e) => { if (e.button === 1) { e.preventDefault(); closeTabs([id]); } },
      oncontextmenu: (/** @type {MouseEvent} */ e) => {
        e.preventDefault();
        menu([
          { label: "Close tab", icon: "x", onClick: () => closeTabs([id]) },
          { label: "Close other tabs", disabled: t.tabs.length < 2, onClick: () => closeTabs(t.tabs.filter((o) => o !== id)) },
        ], { anchor: /** @type {HTMLElement} */ (e.currentTarget), side: "bottom", align: "start", width: 176 });
      },
    }, def ? glyph(def, "tile-tab-ic") : null, h("span", { class: "tile-tab-label" }, def?.label || id), countOf(id), x);
    dragTab(tab, { id: () => id, label: () => defOf(id)?.label || id, icon: () => defOf(id)?.icon || "file", frame: host, allowed, onDrop: dropped, onDragging: (on) => cb.dragging?.(on) });
    return tab;
  }

  /** The heads again — a count landed, an artifact's title was read — and the tabs on top's names. */
  const paintHeads = () => {
    for (const v of shownViews()) paintHead(v);
    const v = topNow();
    if (v) paintHead(v);
    tellTops();
  };

  /**
   * What a pane is handed: the chat, the doors to other tabs, its count's setter, and `head` — its tile's place for its
   * own controls, beside its name, or under the tabs when the tile holds more than one.
   * @param {string} id @param {TileView} v
   */
  const ctxFor = (id, v) => ({
    chat,
    openTab,
    openFileTab,
    head: v.tools,
    /** @param {number} n */
    setBadge: (n) => {
      const next = n == null || !Number.isFinite(n) || n <= 0 ? null : n;
      // The count as it stands: nothing to draw — a pane's data lands at each pulse, the count the same.
      if (next === (badges.get(id) ?? null)) return;
      if (next === null) badges.delete(id);
      else badges.set(id, next);
      if (v.at) paintHead(v);
    },
  });

  /** What a tile's thread follows, let go. @param {TileView} v */
  const letGoOf = (v) => {
    const fn = v.letGo;
    v.letGo = null;
    fn?.();
  };

  /**
   * A tile's body draws its tab shown, when that tab or the chat moved (`force`: anyway). An artifact's page and an
   * agent's thread stay as they are across draws — a chat switched, the run's pulse: a frame taken out loads again from
   * its start, and whatever its page holds would go; a thread follows its own run.
   * @param {TileView} v @param {boolean} force
   */
  function drawTile(v, force) {
    const id = v.at?.active || "";
    const away = isAway(id);
    if (!force && v.tab === id && v.chat === chat && v.away === away) return;
    v.tab = id;
    v.chat = chat;
    v.away = away;
    const def = defOf(id);
    // In a window of its own (BS4): drawn there, not here — a page shows in one place at a time (BS-D8).
    if (away) {
      if (/** @type {HTMLElement | null} */ (v.body.firstElementChild)?.dataset.away === id) return;
      letGoOf(v);
      v.tools.replaceChildren();
      v.body.replaceChildren(awayEl(id, def?.label || "This pane"));
      return;
    }
    const kept = /** @type {HTMLElement | null} */ (v.body.firstElementChild);
    if (def?.artifact && kept?.dataset.artifactTab === def.artifact) return;
    if (def?.thread && v.letGo && kept?.dataset.thread === def.thread) return;
    if (def?.result && v.letGo && kept?.dataset.result === def.result) return;
    // A file's tab drawn already reads its file again and draws what changed in place: a turn's end drew the viewer
    // anew, its bar's buttons new elements under a resting pointer (the owner's of 11-01: buttons blinking under a
    // resting pointer, clicks lost).
    if (def?.file && kept?.dataset.fileTab === id) {
      refreshCodeViewer(v.body);
      return;
    }
    letGoOf(v);
    v.body.replaceChildren();
    v.tools.replaceChildren();
    if (!def) return;
    const ctx = ctxFor(id, v);
    if (def.thread) v.letGo = cb.thread?.render(v.body, def.thread, v.tools) || null;
    else if (def.result) {
      v.letGo = cb.result?.render(v.body, def.result) || null;
      const el = /** @type {HTMLElement | null} */ (v.body.firstElementChild);
      if (el) el.dataset.result = def.result;
    }
    else if (def.file) {
      renderCodeViewer(v.body, { ...ctx, path: def.file.path, cwd: def.file.cwd, ...(cb.onInsert ? { onInsert: cb.onInsert } : {}) });
      const el = /** @type {HTMLElement | null} */ (v.body.firstElementChild);
      if (el) el.dataset.fileTab = id;
    }
    else if (def.artifact)
      renderArtifactPane(v.body, {
        name: def.artifact,
        onTell: (text) => cb.artifact?.onTell(text),
        onAsk: (text) => cb.artifact?.onAsk(text),
        onFull: (name) => cb.artifact?.onFull(name),
        onLabel: (label, icon) => {
          artifactLabels.set(id, { label, icon });
          paintHeads();
        },
      });
    else def.pane?.render(v.body, ctx);
  }

  /** What a tile shows of its tab in a window of its own: where it is, Show its window, Bring back. @param {string} id @param {string} label */
  const awayEl = (id, label) =>
    h(
      "div",
      { class: "pane-empty tile-away", "data-away": id },
      h("div", { class: "tile-away-words" }, `${label} is in a window of its own`),
      h(
        "div",
        { class: "tile-away-acts" },
        button({ size: "sm", variant: "outline", label: "Show its window", onClick: () => pop?.out(id) }),
        button({ size: "sm", variant: "ghost", label: "Bring back", onClick: () => pop?.back(id) }),
      ),
    );

  /** Every tile shown drawn again, and the tab on top on screen. */
  function draw() {
    if (look.on) for (const v of shownViews()) drawTile(v, true);
    const v = topNow();
    if (v) drawTile(v, true);
  }

  /** The run's event stream fires dozens of times a second, and a full draw per event refetched whatever the panes show
   * (and reset their local state). A pulse coalesces them, and a pane that can refresh in place does (its controls stay
   * as they are); a tab or chat switch still draws at once. */
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pulseTimer = null;
  function pulse() {
    if (!look.on && !topShown) return;
    if (pulseTimer) return;
    pulseTimer = setTimeout(() => { pulseTimer = null; refresh(); }, 1200);
  }
  /** Each tile shown, and the tab on top on screen, refreshed in place where its pane can, drawn again where it cannot. */
  function refresh() {
    syncKey();
    const top = topNow();
    for (const v of [...(look.on ? shownViews() : []), ...(top ? [top] : [])]) if (!refreshTile(v)) drawTile(v, true);
  }
  /** A tile's pane refreshed in place: false where it cannot be. @param {TileView} v */
  function refreshTile(v) {
    // Its tab in a window of its own: refreshed there; here it says so, as it stands.
    if (v.away && v.chat === chat) return true;
    // A file's tab: its viewer reads the file again and draws what changed in place — the pulse drew it anew.
    if (defOf(v.tab)?.file) return /** @type {HTMLElement | null} */ (v.body.firstElementChild)?.dataset.fileTab === v.tab && refreshCodeViewer(v.body);
    const pane = paneOf(v.tab);
    if (!pane?.refresh || v.chat !== chat || !v.body.firstChild) return false;
    pane.refresh(v.body, ctxFor(v.tab, v));
    return true;
  }
  /** The chat's turns were read again: the panes shown follow them now, in place where they can. */
  function refreshInPlace() {
    const top = topNow();
    let any = false;
    for (const v of [...(look.on ? shownViews() : []), ...(top ? [top] : [])]) any = refreshTile(v) || any;
    return any;
  }

  // --- the tabs on top (UX10) ---
  /** The tabs on top in this chat, in the order popped. */
  const topIds = () => (ready && !only ? L.top.filter((id) => canOpen(id) && !!T.tileOf(L, id) && T.showsIn(L, id, key)) : []);
  /** The tabs on top, as the views host draws their tabs. */
  const topTabs = () => topIds().map((id) => {
    const def = defOf(id);
    return { id, label: def?.label || id, title: def?.title || id, icon: def?.icon || "file", tone: def?.tone || "var(--color-sys-gray)" };
  });
  /** The tab on top's view on screen, where one is. */
  const topNow = () => (topShown ? topViews.get(topShown) || null : null);
  /** The views host told, once each time the tabs on top or their names moved. */
  function tellTops() {
    const said = JSON.stringify(topTabs().map((t) => [t.id, t.label, t.icon]));
    if (said === toldTops) return;
    toldTops = said;
    if (!quietTops) cb.top?.moved();
  }

  /** A tab on top's view, made once: its head says what it is, with Back to the side, Own window and Close. @param {string} id @returns {TileView} */
  function topViewOf(id) {
    const had = topViews.get(id);
    if (had) return had;
    const lead = h("div", { class: "tile-lead" });
    const tools = h("div", { class: "tile-tools" });
    const bar = h("div", { class: "tile-bar" });
    const body = h("div", { class: "pane-body tile-body" });
    const back = h("button", { class: "tile-btn", type: "button", "aria-label": "Back to the side", html: icon("panelRightOpen") });
    tooltip(back, { title: "Back to the side: this pane goes back into the right bar" });
    back.addEventListener("click", () => fromTop(id));
    // A window of its own (BS4), the desktop app's: greyed with why in a browser's tab, as everywhere.
    const own = h("button", { class: `tile-btn${pop ? "" : " is-off"}`, type: "button", ...(pop ? {} : { "aria-disabled": "true" }), "aria-label": "Own window", html: icon("pictureInPicture2") });
    tooltip(own, { title: pop ? "Own window: this pane in a window of its own" : `Own window — ${POP_NEEDS}` });
    own.addEventListener("click", () => ownWindow(id));
    const close = h("button", { class: "tile-btn", type: "button", "aria-label": "Close", html: icon("x") });
    tooltip(close, { title: "Close", kbd: () => comboOf("close-context") || "" });
    close.addEventListener("click", () => closeTabs([id]));
    const head = h("div", { class: "tile-head" }, lead, tools, h("span", { class: "tile-sp" }), back, own, close);
    const el = h("section", { class: "tile tile-top", tabindex: "-1", "data-top": id }, head, bar, body);
    /** @type {TileView} */
    const v = { id: `top:${id}`, el, head, lead, tools, bar, body, pop: own, more: back, close, tab: "", chat: null, away: false, at: { id: "", tabs: [id], active: id, h: 1, from: [] }, letGo: null };
    topViews.set(id, v);
    return v;
  }

  /** A tab on top's view let go and gone. @param {string} id */
  const dropTop = (id) => {
    const v = topViews.get(id);
    if (v) {
      letGoOf(v);
      v.el.remove();
      topViews.delete(id);
    }
    if (topShown === id) topShown = "";
  };
  /**
   * A tile drawn with this tab lets it go, emptied: it shows on top now — a page shows in one place at a time — and the
   * tile draws whatever it shows next. @param {string} id
   */
  const leaveTiles = (id) => {
    for (const v of views.values()) {
      if (v.tab !== id) continue;
      letGoOf(v);
      v.body.replaceChildren();
      v.tools.replaceChildren();
      v.tab = "";
    }
  };

  /** The tabs on top's views as the layout and the chat have them: one no longer on top here let go. */
  function paintTop() {
    const keep = new Set(topIds());
    for (const id of [...topViews.keys()]) if (!keep.has(id)) dropTop(id);
    if (topShown && !keep.has(topShown)) topShown = "";
    const v = topNow();
    if (!v) return;
    paintHead(v);
    drawTile(v, false);
  }

  /**
   * The tab on top the chat shows (the views host's, as its view moves), or none: its view shown in `topFrame`, drawn for
   * the chat — what it held kept where it is the one it drew — and the others hidden, as they are.
   * @param {string} id
   */
  function showTop(id) {
    topShown = id && topIds().includes(id) ? id : "";
    if (topShown && !topFrame.contains(topViewOf(topShown).el)) topFrame.append(topViewOf(topShown).el);
    for (const [tid, v] of topViews) v.el.classList.toggle("hidden", tid !== topShown);
    const v = topNow();
    if (!v) return;
    paintHead(v);
    if (v.tab === topShown && v.chat === chat && !v.away) refreshTile(v);
    else drawTile(v, false);
  }

  /**
   * Pop out (UX10): a tab on top of the chat, its pane full size there; its tile no longer shows it. One in a window of
   * its own comes back from there first: a page shows in one place at a time (BS-D8).
   * @param {string} id
   */
  function toTop(id) {
    if (only || !T.tileOf(L, id)) return;
    if (isAway(id)) pop?.back(id);
    syncKey();
    if (T.toTop(L, id)) {
      leaveTiles(id);
      persist();
      relayout();
    }
    cb.top?.show(id);
    topViews.get(id)?.el.focus({ preventScroll: true });
  }

  /** Back to the side: a tab on top in its tile again, in front, the panes on screen. @param {string} id */
  function fromTop(id) {
    if (!T.fromTop(L, id)) return;
    dropTop(id);
    persist();
    relayout("ask");
    views.get(L.focus)?.el.focus({ preventScroll: true });
  }

  /** Own window, from a tab on top: back in its tile, and in a window of its own there (BS4). @param {string} id */
  function ownWindow(id) {
    if (!pop || !T.fromTop(L, id)) return;
    dropTop(id);
    persist();
    relayout("ask");
    pop.out(id);
  }

  // --- opening and closing ---
  /**
   * A pane's tab, a file's or an artifact's, opened and shown: where it is, else by the arrangement (tiles.js) — one on
   * top shows there, asked (UX10).
   * @param {string} id
   * @param {{ asked?: boolean }} [o]  `asked: false`: the panes show only where the window has room for them; one on
   *   top stays where the chat's view is
   */
  function openTab(id, o = {}) {
    if (!canOpen(id)) return;
    // A popped window shows its one tab: another its pane opens — a file from Files — opens in the main window.
    if (only) {
      if (id !== only) cb.elsewhere?.(id);
      return;
    }
    syncKey();
    measure();
    T.openTab(L, id, key, room, { item: !paneOf(id) });
    persist();
    if (T.onTop(L, id)) {
      relayout();
      if (o.asked !== false) cb.top?.show(id);
      return;
    }
    relayout(o.asked === false ? "back" : "ask");
  }

  /**
   * A pane offered by itself: into the tile in use as a tab and nothing more, the view where it is and hidden panes
   * hidden — or, with no tile shown, waiting to join the next one a pane opens in (HarnessV4_Four_Plan FO-D28). False
   * where it is open or waiting already, or no such pane. @param {string} id
   */
  function addTab(id) {
    if (only || !paneOf(id)) return false;
    syncKey();
    measure();
    if (!T.addTab(L, id, key, room)) return false;
    persist();
    relayout();
    return true;
  }

  /** You closed tabs yourself: each told, kept as closed lately, and gone from this chat. @param {string[]} ids */
  function closeTabs(ids) {
    // A popped window's tab closed (Alt+W): it goes back into the main window.
    if (only) {
      if (ids.includes(only)) pop?.back(only);
      return;
    }
    let any = false;
    for (const id of ids) {
      // A tab closed here while it is in a window of its own: its window goes with it.
      if (isAway(id)) pop?.back(id);
      cb.onClosed?.(id);
      const def = defOf(id);
      if (!T.closeTab(L, id, key)) continue;
      any = true;
      badges.delete(id);
      if (def) rememberClosed(id, def.label, def.icon);
    }
    if (!any) return;
    persist();
    relayout();
  }

  /** @param {string} id @param {string} label @param {string} ic */
  const rememberClosed = (id, label, ic) => {
    closed.delete(id);
    closed = new Map([[id, { label, icon: ic, at: Date.now() }], ...closed]);
    for (const k of [...closed.keys()].slice(CLOSED_MAX)) closed.delete(k);
    try {
      store.set(CLOSED_KEY, JSON.stringify([...closed.entries()].map(([k, c]) => ({ id: k, ...c }))));
    } catch {}
  };

  /** A file opened from the Files pane or a chip: its own tab, titled by file name. @param {{ path: string, cwd: string }} f */
  const openFileTab = (f) => openTab(fileTabId(f.cwd || "", f.path || ""));
  /** An artifact opened from its card (HarnessV4_Artifacts_Plan AF-D35): its own tab, titled by its title. @param {string} name */
  const openArtifactTab = (name) => openTab(artifactTabId(name));

  /** A tab shown in its tile, and that tile the one in use. @param {string} id */
  function setTab(id) {
    if (!T.activate(L, id)) return;
    persist();
    relayout();
  }

  /** Where a pane shows: on top of the chat, in front in its tile, behind another tab, or not at all. @param {string} id */
  const whereIs = (id) => {
    if (topIds().includes(id)) return "top";
    if (!look.on) return "none";
    for (const c of shown) for (const t of c.tiles) if (t.tabs.includes(id)) return t.active === id ? "front" : "behind";
    return "none";
  };

  /**
   * A pane's button or key: one in front closes; one behind another tab, or closed, opens in front (proposal_ux §3.3);
   * one on top shows there. Opening never runs anything: the pane shows what is there. @param {string} id
   */
  function toggle(id) {
    if (whereIs(id) === "front") closeTabs([id]);
    else openTab(id);
  }

  /**
   * All the panes shown or hidden, the layout kept (Ctrl+Alt+B). Shown with none open: the first pane not on top.
   * @param {boolean} on @param {{ asked?: boolean }} [o]  `asked: false`: only put back, as the room has it
   */
  function setOpen(on, o = {}) {
    if (only) return;
    if (on) {
      syncKey();
      measure();
      const first = cb.panes.find((p) => !T.onTop(L, p.id));
      if (!T.shownOf(L, key, room).length) return first ? openTab(first.id, o) : undefined;
    }
    L.shown = on;
    persist();
    relayout(on ? (o.asked === false ? "back" : "ask") : undefined);
  }

  /** The tile holding the focus closed — its tab shown (Alt+W), or the tab on top it is in. False where the focus is in no tile. */
  function closeFocused() {
    const el = /** @type {HTMLElement | null} */ (document.activeElement?.closest?.(".tile") || null);
    const onTop = el && topFrame.contains(el) ? el.getAttribute("data-top") : null;
    if (onTop) {
      closeTabs([onTop]);
      return true;
    }
    const v = el && host.contains(el) ? views.get(String(el.dataset.tile)) : null;
    if (!v?.at) return false;
    closeTabs([v.at.active]);
    return true;
  }

  // --- moving and sizing ---
  /** The shown tile with this id, and its column. @param {string} id */
  const shownAt = (id) => {
    for (const c of shown) for (const t of c.tiles) if (t.id === id) return { c, t };
    return null;
  };
  /** The shown tile holding a tab, and its column. @param {string} id */
  const shownWith = (id) => {
    for (const c of shown) for (const t of c.tiles) if (t.tabs.includes(id)) return { c, t };
    return null;
  };

  /**
   * Where a dragged tab may land: joining a tile's tabs (its own tile only where it has others to reorder among); beside
   * a tile in a column of its own only arranged as a grid with a column more to dock; above or below only where the
   * column has the height, and not arranged as tabs; never floating, where every pane is a tab of one tile.
   * @param {string} tile @param {T.Edge | null} edge @param {string} id
   */
  function allowed(tile, edge, id) {
    const to = shownAt(tile);
    const from = shownWith(id);
    if (!to || !from) return false;
    if (!edge) return from.t !== to.t || from.t.tabs.length > 1;
    if (look.float || L.arrange === "tabs") return false;
    const alone = from.t.tabs.length === 1;
    if (alone && from.t === to.t) return false;
    if (edge === "left" || edge === "right") {
      if (L.arrange === "column") return false;
      const cols = shown.length - (alone && from.c.tiles.length === 1 ? 1 : 0);
      return cols < room.cols;
    }
    const n = to.c.tiles.length - (alone && from.c === to.c ? 1 : 0);
    return n < room.rows;
  }
  /** A drop the host allowed, done. @param {string} id @param {import("./tile-drag.js").Drop} to */
  function dropped(id, to) {
    if (!T.moveTab(L, id, to)) return;
    persist();
    relayout();
  }

  /**
   * A tile's ⋯: Move (swap with the tile beside it, or join another tile's tabs), Pop out (on top, UX10), In a window of
   * its own (the desktop app's), Close.
   * @param {TileView} v @param {T.ShownTile} t
   */
  function tileMenu(v, t) {
    // A popped window's: Follow the main window, and Bring back (BS4).
    if (only) {
      const follow = pop?.follow;
      menu([
        ...(follow ? [{ type: "check", label: "Follow the main window", desc: "Show the chat the main window shows, as it moves", checked: follow.get(), onClick: () => follow.set(!follow.get()) }, { type: "separator" }] : []),
        { label: "Bring back", icon: "panelRightOpen", desc: "The pane goes back into the main window", onClick: () => pop?.back(only) },
      ], { anchor: v.more, side: "bottom", align: "end", width: 236 });
      return;
    }
    const ci = shown.findIndex((c) => c.tiles.includes(t));
    const col = shown[ci];
    const ti = col ? col.tiles.indexOf(t) : -1;
    /** The tile beside, in a column next to it: the one at its height, else that column's last. @param {number} d */
    const beside = (d) => {
      const c = shown[ci + d];
      return c ? c.tiles[Math.min(ti, c.tiles.length - 1)] : null;
    };
    const near = { left: beside(-1), right: beside(1), up: col?.tiles[ti - 1] || null, down: col?.tiles[ti + 1] || null };
    /** @param {T.ShownTile | null} o */
    const swapWith = (o) => () => {
      if (!o || !T.swapTiles(L, t.id, o.id)) return;
      persist();
      relayout();
    };
    const others = shown.flatMap((c) => c.tiles).filter((o) => o !== t);
    const multi = t.tabs.length > 1;
    const out = isAway(t.active);
    menu([
      {
        label: "Move", icon: "move", submenu: [
          { label: "Left", icon: "arrowLeft", disabled: !near.left, onClick: swapWith(near.left) },
          { label: "Right", icon: "arrowRight", disabled: !near.right, onClick: swapWith(near.right) },
          { label: "Up", icon: "arrowUp", disabled: !near.up, onClick: swapWith(near.up) },
          { label: "Down", icon: "arrowDown", disabled: !near.down, onClick: swapWith(near.down) },
          ...(others.length ? [{ type: "separator" }] : []),
          ...others.map((o) => {
            const def = defOf(o.active);
            return {
              label: `Into ${def?.label || "the pane"}`, icon: def?.icon, desc: "as its tabs",
              onClick: () => {
                for (const id of t.tabs) T.moveTab(L, id, { tile: o.id });
                persist();
                relayout();
              },
            };
          }),
        ],
      },
      ...(out && pop
        ? [
            { label: "Show its window", icon: "pictureInPicture2", desc: "It is in a window of its own", onClick: () => pop.out(t.active) },
            { label: "Bring back", icon: "panelRightOpen", desc: "Its window closes; the pane shows here again", onClick: () => pop.back(t.active) },
          ]
        : paneOf(t.active)?.back
          ? [{ label: "Back to its tab", icon: "panelRightOpen", desc: /** @type {{ title: string }} */ (paneOf(t.active)?.back).title, onClick: () => paneOf(t.active)?.back?.run() }]
          : [
              { label: "Pop out", icon: "maximize2", desc: "Full size, in a tab on top", onClick: () => toTop(t.active) },
              { label: "In a window of its own", icon: "pictureInPicture2", desc: pop ? "This pane in a window of its own" : POP_NEEDS, disabled: !pop, onClick: () => pop?.out(t.active) },
            ]),
      { type: "separator" },
      ...(multi ? [{ label: "Close other tabs", onClick: () => closeTabs(t.tabs.filter((id) => id !== t.active)) }] : []),
      { label: multi ? "Close these tabs" : "Close", icon: "x", kbd: comboOf("close-context") || "", onClick: () => closeTabs(t.tabs) },
    ], { anchor: v.more, side: "bottom", align: "end", width: 208 });
  }

  /**
   * A gap between two columns (`col`: the right one's index among those shown) or two tiles of a column (`row`: the
   * lower one's): dragging it sizes the two, a double-click evens out the columns, or the column's tiles.
   * @param {"col" | "row"} kind @param {number} ci @param {number} ti
   */
  function gapEl(kind, ci, ti) {
    const el = h("div", { class: `tile-gap ${kind}`, role: "separator", "aria-orientation": kind === "col" ? "vertical" : "horizontal" });
    el.addEventListener("pointerdown", (e) => sizeFrom(e, el, kind, ci, ti));
    el.addEventListener("dblclick", () => even(kind, ci));
    dragsSize(el);
    return el;
  }

  /**
   * A gap dragged: the two beside it sized as the pointer moves, kept when it is let go — where the tiles shown are still
   * the ones it sized (a tab the page opened meanwhile drew them anew). It listens on the window, so it ends wherever the
   * pointer is let go, even where its gap was drawn anew.
   * @param {PointerEvent} e @param {HTMLElement} el @param {"col" | "row"} kind @param {number} ci @param {number} ti
   */
  function sizeFrom(e, el, kind, ci, ti) {
    if (e.button !== 0) return;
    const across = kind === "col";
    const pair = across ? [shown[ci - 1], shown[ci]] : [shown[ci]?.tiles[ti - 1], shown[ci]?.tiles[ti]];
    const [ea, eb] = [/** @type {HTMLElement | null} */ (el.previousElementSibling), /** @type {HTMLElement | null} */ (el.nextElementSibling)];
    if (!pair[0] || !pair[1] || !ea || !eb) return;
    e.preventDefault();
    const sizeOf = (/** @type {HTMLElement} */ x) => (across ? x.getBoundingClientRect().width : x.getBoundingClientRect().height);
    const pa = sizeOf(ea);
    const total = pa + sizeOf(eb);
    const shareOf = (/** @type {any} */ x) => (across ? x.w : x.h);
    const share = shareOf(pair[0]) + shareOf(pair[1]);
    const least = Math.min(across ? COL_LEAST : TILE_LEAST, total / 2);
    const start = across ? e.clientX : e.clientY;
    const sized = drawnShape;
    let a = shareOf(pair[0]);
    el.classList.add("drag");
    try { el.setPointerCapture(e.pointerId); } catch {}
    /** @param {PointerEvent} ev */
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const px = Math.max(least, Math.min(total - least, pa + (across ? ev.clientX : ev.clientY) - start));
      a = (share * px) / total;
      ea.style.flexGrow = String(a);
      eb.style.flexGrow = String(share - a);
    };
    /** @param {PointerEvent} ev */
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      el.classList.remove("drag");
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      if (drawnShape === sized) {
        if (across) {
          const [l, r] = /** @type {T.ShownColumn[]} */ (pair);
          T.setShares(L, { cols: [{ at: l.at, w: a }, { at: r.at, w: share - a }] });
        } else {
          const [u, d] = /** @type {T.ShownTile[]} */ (pair);
          T.setShares(L, { tiles: [{ id: u.id, h: a }, { id: d.id, h: share - a }] });
        }
        persist();
      }
      relayout();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }

  /** The columns shown made one width, or a column's tiles one height. @param {"col" | "row"} kind @param {number} ci */
  function even(kind, ci) {
    if (kind === "col") T.setShares(L, { cols: shown.map((c) => ({ at: c.at, w: 1 / shown.length })) });
    else if (shown[ci]) T.setShares(L, { tiles: shown[ci].tiles.map((t) => ({ id: t.id, h: 1 / shown[ci].tiles.length })) });
    persist();
    relayout();
  }

  return {
    /** The window resized: the panes fitted to it (the shell asks, before its sidebar's rule). */
    relayout: () => relayout("resize"),
    setOpen,
    draw,
    pulse,
    /**
     * A turn's end: each tile shown, and the tab on top, refreshed in place where its pane can — each pane reads again
     * what the turn moved — and drawn again where it cannot, at once; the pulse waiting goes with it. A draw made every
     * pane anew under a resting pointer at each turn's end (the owner's of 11-01: buttons blinking under a resting
     * pointer, clicks lost).
     */
    refresh: () => {
      if (pulseTimer) {
        clearTimeout(pulseTimer);
        pulseTimer = null;
      }
      refresh();
    },
    refreshInPlace,
    /** The chat shown moved: its tabs show, each tile drawn for it. @param {any} c */
    setChat(c) {
      const same = c === chat;
      // The chat left may have been sent meanwhile: its panes go under its session's key first.
      syncKey();
      const k = T.chatKey(c);
      // Another chat, not this one sent for the first time (syncKey re-keys its panes): its own panes.
      if (!only && k !== key && key !== `p:${c?.id}`) enterChat(k, c?.id ? `p:${c.id}` : "");
      chat = c;
      ready = true;
      // The tabs on top as this chat has them: the views host draws them as the page switches it next (app.js
      // selectChat), on this chat — told now, it would draw them on the chat left.
      quietTops = !same;
      try {
        relayout();
      } finally {
        quietTops = false;
      }
      if (same) draw();
    },
    openTab,
    addTab,
    openFileTab,
    openArtifactTab,
    toggle,
    closeFocused,
    /**
     * A pane's tab marked with a dot while something in it waits for you — its words its title — or unmarked (null).
     * @param {string} id @param {string | null} words
     */
    mark(id, words) {
      if ((marks.get(id) || null) === (words || null)) return;
      if (words) marks.set(id, words);
      else marks.delete(id);
      paintHeads();
    },
    /** A tab closed, as its × closes it: the Plan beside the chat going back to its tab (D12). @param {string} id */
    close: (id) => closeTabs([id]),
    /** The panes, for the header's buttons and the command center. */
    panes: () => cb.panes.map((p) => ({ id: p.id, label: p.label, icon: p.icon, tone: p.tone || "var(--color-sys-gray)" })),
    /** Where a pane shows: "front", "behind" another tab, or "none". */
    whereIs,
    /**
     * Whether the layout holds a tab — in a tile, the panes shown or hidden, or on top: the Plan beside the chat is
     * there to come back however the panes stand (one place at a time, D12). @param {string} id
     */
    holds: (id) => ready && !!T.tileOf(L, id) && T.showsIn(L, id, key),
    /** One tab's pane refreshed in place where it shows: the Plan beside the chat as the views repaint. @param {string} id */
    refreshTab: (id) => {
      for (const v of look.on ? shownViews() : []) if (v.tab === id) refreshTile(v);
    },
    /** The tabs in front in the tiles on screen, in order, and the tab on top on screen. */
    front: () => [...(look.on ? shownViews().map((v) => v.at?.active || "").filter(Boolean) : []), ...(topShown ? [topShown] : [])],
    /** The heads drawn again: a thread's agent became known. */
    paintHeads,
    /** The tabs closed lately, newest first, that can open again. */
    closedTabs: () => [...closed.entries()].filter(([id]) => canOpen(id) && !T.tileOf(L, id)).map(([id, c]) => ({ id, ...c })),
    /** A tab's name as its tile says it ("" for none the panes open): a popped window's title. @param {string} id */
    labelOf: (id) => defOf(id)?.label || "",
    /** The tabs out moved (BS4): each tile shown says its tab is in a window of its own, or draws its pane again. */
    popMoved() {
      const top = topNow();
      for (const v of [...(look.on ? shownViews() : []), ...(top ? [top] : [])]) {
        paintHead(v);
        drawTile(v, false);
      }
    },
    /** The tabs on top in this chat, in the order popped, each with its name and glyph (UX10). */
    tops: topTabs,
    toTop,
    fromTop,
    showTop,
    /** Where a tab on top's pane shows: the views host puts it in the conversation's frame. */
    topFrame,
    /** How new panes open, and how the open ones are laid out anew. @param {T.Arrange} how */
    setArrange(how) {
      if (only) return;
      syncKey();
      measure();
      T.arrange(L, how, key, room);
      persist();
      relayout();
    },
    /** Where the panes sit: beside the chat while it keeps its room (Auto), Beside, or Over the chat. @param {T.Place} where */
    setPlace(where) {
      if (only) return;
      L.place = where;
      persist();
      relayout("ask");
    },
    get arrange() { return L.arrange; },
    get place() { return L.place; },
    /** The columns the window docks now (0: the panes float). */
    get columns() { return room.cols; },
    /** The panes are on, as the person left them (hidden by the window's room or not). */
    get open() { return L.shown; },
    /** On screen. */
    get shown() { return look.on; },
    get floating() { return look.float; },
    /** The tiles shown, in order: the focus key's stops. */
    tiles: () => shownViews().map((v) => v.el),
  };
}
