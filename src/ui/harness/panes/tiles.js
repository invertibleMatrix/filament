// @ts-check
// The panes' layout (proposal_ux §3.5): columns of tiles beside the chat, each tile a stack of tabs. A pane opens by the
// tiling rule — the first a column, the second splits it into two rows, the third a second column, the fourth 2 × 2, a
// fifth and sixth a third column where the window holds one — and joins the tile in use as a tab where the room has no
// place for a tile of its own. Tool panes (Changes, Terminal, …) follow the chat shown; an item pane (a file, an
// artifact) belongs to the chats it was opened in and shows in them alone. What shows is the layout cut to the chat and
// folded to the room: tiles past the columns the window docks, or past the tiles a column has the height for, join the
// last tile that fits as tabs, and floating (no column docks) every tab shares one tile — the layout itself keeps them
// for a wider window. A tab popped out on top (HarnessV4_DesignPass_Plan UX10) stays in its tile, out of what shows: it
// is a tab on top of the chat until it is put back, there again. Pure: no DOM, no storage; the tile host (pane-host.js)
// draws it and keeps it.

/**
 * @typedef {{ id: string, tabs: string[], active: string, h: number }} Tile  `h`: its share of its column's height
 * @typedef {{ tiles: Tile[], w: number }} Column  `w`: its share of the panes' width
 * @typedef {"grid" | "column" | "tabs"} Arrange
 * @typedef {"auto" | "beside" | "over"} Place
 * @typedef {{ cols: Column[], arrange: Arrange, place: Place, widths: Record<string, number>,
 *   owners: Record<string, string[]>, shown: boolean, focus: string, seq: number, held: string[], top: string[] }} Layout
 *   `widths`: the docked panes' width the person dragged, by column count; `owners`: an item tab's chats, the ones it
 *   shows in (none: every chat's — a tab carried over from the one tab strip); `shown`: the panes on screen, or hidden
 *   whole (Ctrl+Alt+B) with the layout kept; `focus`: the tile in use; `seq`: the last tile number given; `held`: the
 *   panes offered by themselves while no tile showed, waiting to join the next tile a pane opens in; `top`: the tabs
 *   popped out on top, in the order popped — each still in its tile, which does not show it.
 * @typedef {{ cols: number, rows: number }} Room  the columns the window docks (0: the panes float) and the tiles a column
 *   has the height for
 * @typedef {{ id: string, tabs: string[], active: string, h: number, from: string[] }} ShownTile  `id`: the layout's tile
 *   it shows; `from`: every layout tile folded into it, that one first
 * @typedef {{ at: number, w: number, tiles: ShownTile[] }} ShownColumn  `at`: its index in the layout
 * @typedef {"left" | "right" | "top" | "bottom"} Edge
 */

/** @type {readonly Arrange[]} */
export const ARRANGES = Object.freeze(["grid", "column", "tabs"]);
/** @type {readonly Place[]} */
export const PLACES = Object.freeze(["auto", "beside", "over"]);
/** The most tiles a column takes by the tiling rule: the rule's grid is two rows high. */
export const GRID_ROWS = 2;
/** The most item tabs the layout keeps across chats: past it, the oldest another chat holds goes. */
export const ITEMS_MAX = 40;

/** @returns {Layout} */
export const blankLayout = () => ({ cols: [], arrange: "grid", place: "auto", widths: {}, owners: {}, shown: false, focus: "", seq: 0, held: [], top: [] });

/**
 * A chat's key among an item tab's owners: its session's, which outlives the page; a chat not sent yet has this page's
 * own (`p:`), re-keyed once it is sent and dropped by the next page.
 * @param {any} chat
 */
export const chatKey = (chat) => (chat?.chainId ? `c:${chat.chainId}` : chat?.id ? `p:${chat.id}` : "");

/** Whether a tab shows in a chat. @param {Layout} L @param {string} id @param {string} chat */
export const showsIn = (L, id, chat) => {
  const o = L.owners[id];
  return !o || o.includes(chat);
};

/** Whether a tab is popped out on top. @param {Layout} L @param {string} id */
export const onTop = (L, id) => L.top.includes(id);

/** Where a tab sits. @param {Layout} L @param {string} id @returns {{ col: Column, tile: Tile } | null} */
export function tileOf(L, id) {
  for (const col of L.cols) for (const tile of col.tiles) if (tile.tabs.includes(id)) return { col, tile };
  return null;
}

/** A tile by its id. @param {Layout} L @param {string} id @returns {{ col: Column, tile: Tile } | null} */
export function tileById(L, id) {
  for (const col of L.cols) for (const tile of col.tiles) if (tile.id === id) return { col, tile };
  return null;
}

/**
 * Shares made whole: what is missing or not a positive number takes the others' mean, then all of them sum to one.
 * @template {Record<string, any>} T @param {T[]} list @param {keyof T & string} k
 */
function normalize(list, k) {
  if (!list.length) return;
  const ok = list.filter((x) => Number.isFinite(x[k]) && x[k] > 0);
  const fill = ok.length ? ok.reduce((s, x) => s + x[k], 0) / ok.length : 1;
  for (const x of list) if (!(Number.isFinite(x[k]) && x[k] > 0)) /** @type {any} */ (x)[k] = fill;
  const sum = list.reduce((s, x) => s + x[k], 0);
  for (const x of list) /** @type {any} */ (x)[k] = x[k] / sum;
}

/** The mean of the shares, the one a new column or tile takes: as wide or tall as the others. @param {number[]} shares */
const mean = (shares) => (shares.length ? shares.reduce((s, x) => s + x, 0) / shares.length : 1);

/** One shown tile's tabs folded into another's, its tab shown kept where it is the tile in use. @param {ShownTile} into @param {ShownTile} t @param {string} focus */
function fold(into, t, focus) {
  into.tabs.push(...t.tabs);
  into.from.push(...t.from);
  if (t.from.includes(focus)) into.active = t.active;
}

/**
 * What shows of the layout in a chat, in a room: the chat's tabs but those on top, tiles left without any gone, the
 * columns past the room's folded into the last one's last tile and a column's tiles past its height into its last, as
 * tabs; floating (no column docks), one tile with every tab in the layout's order, the tile in use's tab shown. A
 * folded tile's tabs keep that order too, so a tab picked never moves.
 * @param {Layout} L @param {string} chat @param {Room} room
 * @returns {ShownColumn[]}
 */
export function shownOf(L, chat, room) {
  /** @type {ShownColumn[]} */
  let cols = [];
  L.cols.forEach((c, at) => {
    /** @type {ShownTile[]} */
    const tiles = [];
    for (const t of c.tiles) {
      const tabs = t.tabs.filter((id) => showsIn(L, id, chat) && !onTop(L, id));
      if (tabs.length) tiles.push({ id: t.id, tabs, active: tabs.includes(t.active) ? t.active : tabs[0], h: t.h, from: [t.id] });
    }
    if (tiles.length) cols.push({ at, w: c.w, tiles });
  });
  if (!cols.length) return [];
  if (room.cols < 1) {
    const [first, ...rest] = cols.flatMap((c) => c.tiles);
    for (const t of rest) fold(first, t, L.focus);
    first.h = 1;
    return [{ at: cols[0].at, w: 1, tiles: [first] }];
  }
  if (cols.length > room.cols) {
    const keep = cols.slice(0, room.cols);
    const lastCol = keep[keep.length - 1];
    const last = lastCol.tiles[lastCol.tiles.length - 1];
    for (const c of cols.slice(room.cols)) for (const t of c.tiles) fold(last, t, L.focus);
    cols = keep;
  }
  const rows = Math.max(1, room.rows);
  for (const c of cols) {
    if (c.tiles.length > rows) {
      const keep = c.tiles.slice(0, rows);
      const last = keep[keep.length - 1];
      for (const t of c.tiles.slice(rows)) fold(last, t, L.focus);
      c.tiles = keep;
    }
    normalize(c.tiles, "h");
  }
  normalize(cols, "w");
  return cols;
}

/** A new tile holding one tab. @param {Layout} L @param {string} id @param {number} h @returns {Tile} */
const newTile = (L, id, h) => ({ id: `t${++L.seq}`, tabs: [id], active: id, h });

/**
 * Where a tab the layout lacks goes, as the arrangement (`how`, the layout's own unless said) and the room say, and it
 * is put there: Grid by the tiling rule (the first column with room for another tile takes it under its last; else a new
 * column at the right where the room docks one more), One column as a tile under the others, Tabs into the tile in use
 * — and into the tile in use, as a tab after the one it shows, wherever the room has no place for a tile. No tile shows
 * yet: a column of its own. Nothing else moves: the tab shown, the tile in use, the panes shown or hidden are the
 * caller's.
 * @param {Layout} L @param {string} id @param {string} chat @param {Room} room @param {Arrange} [how]
 * @returns {Tile}
 */
function place(L, id, chat, room, how = L.arrange) {
  const shown = shownOf(L, chat, room);
  const tiles = shown.flatMap((c) => c.tiles);
  if (!tiles.length) {
    const tile = newTile(L, id, 1);
    L.cols.push({ w: mean(L.cols.map((c) => c.w)), tiles: [tile] });
    return tile;
  }
  /** As a tab of the tile in use, after the tab it shows. */
  const asTab = () => {
    const inUse = tiles.find((t) => t.from.includes(L.focus)) || tiles[tiles.length - 1];
    const at = tileById(L, inUse.from.find((f) => f === L.focus) || inUse.id);
    const tile = /** @type {{ col: Column, tile: Tile }} */ (at).tile;
    const after = tile.tabs.indexOf(tile.active);
    tile.tabs.splice(after < 0 ? tile.tabs.length : after + 1, 0, id);
    return tile;
  };
  /** As a tile under the column's last shown one, as tall as its tiles are. @param {ShownColumn} c */
  const below = (c) => {
    const lastShown = c.tiles[c.tiles.length - 1];
    const at = /** @type {{ col: Column, tile: Tile }} */ (tileById(L, lastShown.id));
    const shares = c.tiles.map((t) => /** @type {{ tile: Tile }} */ (tileById(L, t.id)).tile.h).filter((h) => Number.isFinite(h) && h > 0);
    const tile = newTile(L, id, mean(shares));
    at.col.tiles.splice(at.col.tiles.indexOf(at.tile) + 1, 0, tile);
    return tile;
  };
  if (room.cols < 1 || how === "tabs") return asTab();
  if (how === "column") return shown[0].tiles.length < Math.max(1, room.rows) ? below(shown[0]) : asTab();
  const rows = Math.min(GRID_ROWS, Math.max(1, room.rows));
  const open = shown.find((c) => c.tiles.length < rows);
  if (open) return below(open);
  if (shown.length < room.cols) {
    const tile = newTile(L, id, 1);
    L.cols.splice(shown[shown.length - 1].at + 1, 0, { w: mean(shown.map((c) => L.cols[c.at].w)), tiles: [tile] });
    return tile;
  }
  return asTab();
}

/**
 * Open a tab in a chat and show it: where it is already (an item opened in another chat now shows in this one too),
 * else placed by the arrangement (`place`). It becomes its tile's tab shown, that tile the one in use, and the panes
 * show; the panes offered meanwhile (`held`) join that tile, behind it. An item (`item`) belongs to the chats it is
 * opened in; past ITEMS_MAX, the oldest another chat holds goes. A tab on top stays there, its tile as it was: the host
 * shows it on top (UX10).
 * @param {Layout} L @param {string} id @param {string} chat @param {Room} room @param {{ item?: boolean }} [o]
 * @returns {string} the tile it shows in, or keeps it on top
 */
export function openTab(L, id, chat, room, { item = false } = {}) {
  const at = tileOf(L, id);
  if (item) {
    const owners = L.owners[id];
    if (!at) L.owners[id] = [chat];
    else if (owners && !owners.includes(chat)) owners.push(chat);
    // The newest opened last: the cap takes the oldest first.
    if (L.owners[id]) {
      const keep = L.owners[id];
      delete L.owners[id];
      L.owners[id] = keep;
    }
  }
  if (at && onTop(L, id)) {
    if (item) capItems(L, chat);
    return at.tile.id;
  }
  const tile = at ? at.tile : place(L, id, chat, room);
  tile.active = id;
  L.focus = tile.id;
  L.shown = true;
  for (const w of L.held) if (!tileOf(L, w)) tile.tabs.push(w);
  L.held = [];
  if (item) capItems(L, chat);
  return tile.id;
}

/**
 * A tool pane offered by itself (HarnessV4_Four_Plan FO-D28: it never takes the view): into the tile in use as a tab
 * after the one it shows, not shown, the tile in use the same, the panes hidden if they were. Where no tile shows in
 * the chat it waits (`held`), and joins the next tile a pane opens in — it never takes a tile, nor a turn in the tiling
 * rule, of its own. False where it is open or waiting already.
 * @param {Layout} L @param {string} id @param {string} chat @param {Room} room
 */
export function addTab(L, id, chat, room) {
  if (tileOf(L, id) || L.held.includes(id)) return false;
  if (shownOf(L, chat, room).length) place(L, id, chat, room, "tabs");
  else L.held.push(id);
  return true;
}

/** Past ITEMS_MAX item tabs, the oldest held by other chats alone go. @param {Layout} L @param {string} chat */
function capItems(L, chat) {
  const keys = Object.keys(L.owners);
  let over = keys.length - ITEMS_MAX;
  for (const id of keys) {
    if (over <= 0) break;
    if (L.owners[id].includes(chat)) continue;
    delete L.owners[id];
    const at = tileOf(L, id);
    if (at) detach(L, at, id);
    offTop(L, id);
    over--;
  }
}

/** A tab no longer on top. @param {Layout} L @param {string} id */
function offTop(L, id) {
  const i = L.top.indexOf(id);
  if (i >= 0) L.top.splice(i, 1);
  return i >= 0;
}

/**
 * A tab popped out on top (UX10): last of the tabs on top, its tile keeping it out of what shows. False where it is in no
 * tile, or on top already.
 * @param {Layout} L @param {string} id
 */
export function toTop(L, id) {
  if (!tileOf(L, id) || onTop(L, id)) return false;
  L.top.push(id);
  return true;
}

/**
 * A tab put back from the top: shown in its tile again, that tile the one in use, the panes on screen. False where it
 * was not on top.
 * @param {Layout} L @param {string} id
 */
export function fromTop(L, id) {
  if (!offTop(L, id)) return false;
  activate(L, id);
  L.shown = true;
  return true;
}

/**
 * A tab taken out of its tile: the tile shows its neighbour, and goes with its last tab, the tile beside it in its column
 * taking its room (the one above, else below); a column left empty goes the same way, its room to its neighbour.
 * @param {Layout} L @param {{ col: Column, tile: Tile }} at @param {string} id
 */
function detach(L, at, id) {
  const { col, tile } = at;
  const i = tile.tabs.indexOf(id);
  if (i < 0) return;
  tile.tabs.splice(i, 1);
  if (tile.active === id) tile.active = tile.tabs[i - 1] ?? tile.tabs[i] ?? "";
  if (tile.tabs.length) return;
  const ti = col.tiles.indexOf(tile);
  col.tiles.splice(ti, 1);
  const heir = col.tiles[ti - 1] || col.tiles[ti];
  if (heir) heir.h += tile.h;
  if (L.focus === tile.id) L.focus = heir?.id || "";
  if (col.tiles.length) return;
  const ci = L.cols.indexOf(col);
  L.cols.splice(ci, 1);
  const next = L.cols[ci - 1] || L.cols[ci];
  if (next) next.w += col.w;
  if (!L.focus || !tileById(L, L.focus)) L.focus = next?.tiles[0]?.id || "";
}

/**
 * Close a tab in a chat. An item another chat holds too stays theirs and leaves this chat alone; else the tab leaves
 * the layout (`detach`) and the top, or stops waiting. False where it was not open.
 * @param {Layout} L @param {string} id @param {string} chat
 */
export function closeTab(L, id, chat) {
  const at = tileOf(L, id);
  if (!at) {
    const w = L.held.indexOf(id);
    if (w >= 0) L.held.splice(w, 1);
    return w >= 0;
  }
  const owners = L.owners[id];
  if (owners && owners.includes(chat) && owners.length > 1) {
    owners.splice(owners.indexOf(chat), 1);
    return true;
  }
  delete L.owners[id];
  detach(L, at, id);
  offTop(L, id);
  return true;
}

/** A tab shown in its tile, and that tile the one in use. False where it is not open. @param {Layout} L @param {string} id */
export function activate(L, id) {
  const at = tileOf(L, id);
  if (!at) return false;
  at.tile.active = id;
  L.focus = at.tile.id;
  return true;
}

/**
 * Move a tab: onto a tile's tabs (at `index`, else after the tab it shows), or to a tile's edge — a column of its own
 * beside the tile's (left, right) or a tile above or below it in its column (top, bottom), taking half of that column's
 * or tile's room. A tab alone in its tile moved to that tile's own edge stays where it is. False where nothing moved.
 * @param {Layout} L @param {string} id @param {{ tile: string, edge?: Edge, index?: number }} to
 */
export function moveTab(L, id, to) {
  const from = tileOf(L, id);
  const target = tileById(L, to.tile);
  if (!from || !target) return false;
  if (!to.edge) {
    if (from.tile === target.tile) {
      const tabs = target.tile.tabs;
      const i = tabs.indexOf(id);
      const at = Math.max(0, Math.min(to.index ?? tabs.length, tabs.length));
      tabs.splice(i, 1);
      tabs.splice(at > i ? at - 1 : at, 0, id);
    } else {
      // Taken out first: its tile and column may go with it, never the target's.
      detach(L, from, id);
      const into = /** @type {{ tile: Tile }} */ (tileById(L, to.tile)).tile;
      const after = into.tabs.indexOf(into.active);
      const at = to.index ?? (after < 0 ? into.tabs.length : after + 1);
      into.tabs.splice(Math.max(0, Math.min(at, into.tabs.length)), 0, id);
    }
    const into = /** @type {{ tile: Tile }} */ (tileById(L, to.tile)).tile;
    into.active = id;
    L.focus = into.id;
    return true;
  }
  if (from.tile === target.tile && from.tile.tabs.length === 1) return false;
  detach(L, from, id);
  const d = /** @type {{ col: Column, tile: Tile }} */ (tileById(L, to.tile));
  if (to.edge === "top" || to.edge === "bottom") {
    d.tile.h /= 2;
    const tile = newTile(L, id, d.tile.h);
    d.col.tiles.splice(d.col.tiles.indexOf(d.tile) + (to.edge === "bottom" ? 1 : 0), 0, tile);
    L.focus = tile.id;
  } else {
    d.col.w /= 2;
    const tile = newTile(L, id, 1);
    L.cols.splice(L.cols.indexOf(d.col) + (to.edge === "right" ? 1 : 0), 0, { w: d.col.w, tiles: [tile] });
    L.focus = tile.id;
  }
  return true;
}

/**
 * Swap what two tiles hold: their tabs and the tab each shows trade places, their sizes stay — the tile ⋯ menu's
 * Move left / right / up / down. False where either is missing or they are one.
 * @param {Layout} L @param {string} a @param {string} b
 */
export function swapTiles(L, a, b) {
  const x = tileById(L, a);
  const y = tileById(L, b);
  if (!x || !y || x.tile === y.tile) return false;
  [x.tile.tabs, y.tile.tabs] = [y.tile.tabs, x.tile.tabs];
  [x.tile.active, y.tile.active] = [y.tile.active, x.tile.active];
  if (L.focus === a) L.focus = b;
  else if (L.focus === b) L.focus = a;
  return true;
}

/**
 * The shares the person dragged, as the shown columns and tiles have them: each written to its column (by index) or
 * tile (by id). Shares of the ones not shown (another chat's) stay theirs.
 * @param {Layout} L @param {{ cols?: { at: number, w: number }[], tiles?: { id: string, h: number }[] }} shares
 */
export function setShares(L, { cols = [], tiles = [] }) {
  for (const c of cols) if (L.cols[c.at] && Number.isFinite(c.w) && c.w > 0) L.cols[c.at].w = c.w;
  for (const t of tiles) {
    const at = tileById(L, t.id);
    if (at && Number.isFinite(t.h) && t.h > 0) at.tile.h = t.h;
  }
}

/**
 * Arrange the chat's tabs anew, and set how the ones after them open: Grid by the tiling rule in the order they show
 * (each in a tile of its own as far as the room goes), One column as tiles one under another, Tabs in one tile. The
 * tile in use keeps the tab it shows in use; another chat's items, and the tabs on top, keep their tiles, after the
 * chat's.
 * @param {Layout} L @param {Arrange} how @param {string} chat @param {Room} room
 */
export function arrange(L, how, chat, room) {
  L.arrange = how;
  /** @type {string[]} */
  const order = [];
  /** @type {Tile[]} */
  const theirs = [];
  /** @param {string} id */
  const ours = (id) => showsIn(L, id, chat) && !onTop(L, id);
  const inUse = tileById(L, L.focus)?.tile || null;
  const lead = inUse && ours(inUse.active) ? inUse.active : "";
  const actives = new Set(L.cols.flatMap((c) => c.tiles.map((t) => t.active)));
  for (const c of L.cols)
    for (const t of c.tiles) {
      order.push(...t.tabs.filter(ours));
      const rest = t.tabs.filter((id) => !ours(id));
      if (rest.length) theirs.push({ id: t.id, tabs: rest, active: rest.includes(t.active) ? t.active : rest[0], h: t.h });
    }
  L.cols = [];
  const fit = { cols: Math.max(1, room.cols), rows: Math.max(1, room.rows) };
  for (const id of order) {
    const tile = place(L, id, chat, fit);
    // The next one joining this tile goes after it: the order stays the order they showed in.
    tile.active = id;
    L.focus = tile.id;
  }
  // Each tile shows the first of its tabs that showed before, and the tile in use keeps the tab it showed.
  for (const c of L.cols) for (const t of c.tiles) t.active = t.tabs.find((id) => actives.has(id)) ?? t.tabs[0];
  if (lead) activate(L, lead);
  if (theirs.length) {
    if (!L.cols.length) L.cols.push({ w: 1, tiles: [] });
    const last = L.cols[L.cols.length - 1];
    last.tiles.push(...theirs.map((t) => ({ ...t, h: mean(last.tiles.map((x) => x.h)) })));
  }
}

/**
 * A chat sent for the first time: its items, held under this page's key, are its session's now.
 * @param {Layout} L @param {string} from @param {string} to
 * @returns {boolean} whether any moved
 */
export function rekey(L, from, to) {
  let moved = false;
  if (!from || !to || from === to) return false;
  for (const owners of Object.values(L.owners)) {
    const i = owners.indexOf(from);
    if (i < 0) continue;
    moved = true;
    if (owners.includes(to)) owners.splice(i, 1);
    else owners[i] = to;
  }
  return moved;
}

/**
 * A chat's own panes put in a layout (the owner's of 11-05: each chat keeps its panes as it left them): its tiles, its
 * items, the panes on or off, the tile in use, the panes waiting and those on top — another layout's, or none (a chat
 * never shown: no tile, the panes off). How panes open and are laid out, where they sit and their widths stay the
 * person's, across chats.
 * @param {Layout} L @param {Layout} [from]
 */
export function takeChat(L, from = blankLayout()) {
  L.cols = from.cols;
  L.owners = from.owners;
  L.shown = from.shown;
  L.focus = from.focus;
  L.seq = from.seq;
  L.held = from.held;
  L.top = from.top;
}

/**
 * The layout made one chat's alone: the items other chats held leave it, and those it holds are its alone — closed, one
 * goes. The panes every chat shared, before each kept its own, become the first chat's shown.
 * @param {Layout} L @param {string} chat
 */
export function ownedBy(L, chat) {
  for (const [id, owners] of Object.entries(L.owners)) {
    if (owners.includes(chat)) {
      L.owners[id] = [chat];
      continue;
    }
    delete L.owners[id];
    const at = tileOf(L, id);
    if (at) detach(L, at, id);
    offTop(L, id);
  }
}

/** The layout as it is stored. @param {Layout} L */
export const layoutJson = (L) =>
  JSON.stringify({ v: 1, cols: L.cols, arrange: L.arrange, place: L.place, widths: L.widths, owners: L.owners, shown: L.shown, focus: L.focus, seq: L.seq, held: L.held, top: L.top });

/**
 * The layout as stored, checked: the tabs it cannot open any more left out, each tab once, tiles and columns emptied
 * by that gone, shares made whole, the items of chats never sent dropped (those chats were another page's). Nothing
 * stored: the one tab strip's open tabs carried over into one tile (`legacy.tabs`, its JSON), showing the tab it
 * showed (`legacy.tab`), and hidden — as the strip always started.
 * @param {string | null | undefined} raw @param {(id: string) => boolean} canOpen
 * @param {{ tabs?: string | null, tab?: string | null }} [legacy]
 * @param {string} [own]  a chat of this page's own (`p:`) whose items stay: its own panes, read again before it is sent
 * @returns {Layout}
 */
export function readLayout(raw, canOpen, legacy = {}, own = "") {
  const L = blankLayout();
  /** @type {any} */
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.cols)) return carried(L, canOpen, legacy);
  if (ARRANGES.includes(data.arrange)) L.arrange = data.arrange;
  if (PLACES.includes(data.place)) L.place = data.place;
  for (const [k, v] of Object.entries(data.widths && typeof data.widths === "object" ? data.widths : {}))
    if (/^[123]$/.test(k) && Number.isFinite(v) && v > 0) L.widths[k] = Math.round(v);
  /** Items whose every chat was another page's: gone with them. */
  const orphans = new Set();
  for (const [id, v] of Object.entries(data.owners && typeof data.owners === "object" ? data.owners : {})) {
    if (!Array.isArray(v)) continue;
    const keep = [...new Set(v.filter((c) => typeof c === "string" && (c.startsWith("c:") || (!!own && c === own))))];
    if (keep.length) L.owners[id] = keep;
    else orphans.add(id);
  }
  const seen = new Set();
  const ids = new Set();
  let seq = Number.isInteger(data.seq) && data.seq > 0 ? data.seq : 0;
  for (const c of data.cols) {
    if (!c || !Array.isArray(c.tiles)) continue;
    /** @type {Tile[]} */
    const tiles = [];
    for (const t of c.tiles) {
      if (!t || !Array.isArray(t.tabs)) continue;
      /** @type {string[]} */
      const tabs = [];
      for (const tab of t.tabs) {
        if (typeof tab !== "string" || seen.has(tab) || orphans.has(tab) || !canOpen(tab)) continue;
        seen.add(tab);
        tabs.push(tab);
      }
      if (!tabs.length) continue;
      let id = typeof t.id === "string" && /^t\d+$/.test(t.id) && !ids.has(t.id) ? t.id : "";
      if (!id) id = `t${++seq}`;
      ids.add(id);
      seq = Math.max(seq, Number(id.slice(1)));
      tiles.push({ id, tabs, active: tabs.includes(t.active) ? t.active : tabs[0], h: Number(t.h) });
    }
    if (!tiles.length) continue;
    normalize(tiles, "h");
    L.cols.push({ w: Number(c.w), tiles });
  }
  normalize(L.cols, "w");
  for (const id of Object.keys(L.owners)) if (!seen.has(id)) delete L.owners[id];
  L.seq = seq;
  L.focus = typeof data.focus === "string" && ids.has(data.focus) ? data.focus : L.cols[0]?.tiles[0]?.id || "";
  L.shown = data.shown === true && L.cols.length > 0;
  for (const id of Array.isArray(data.held) ? data.held : [])
    if (typeof id === "string" && !seen.has(id) && !L.held.includes(id) && !(id in L.owners) && canOpen(id)) L.held.push(id);
  // The tabs on top: those still in a tile, each once.
  for (const id of Array.isArray(data.top) ? data.top : []) if (typeof id === "string" && seen.has(id) && !L.top.includes(id)) L.top.push(id);
  return L;
}

/**
 * The one tab strip's tabs in a first tile (proposal_ux §3.5: "today's open tabs carry over into the first tile").
 * @param {Layout} L @param {(id: string) => boolean} canOpen @param {{ tabs?: string | null, tab?: string | null }} legacy
 */
function carried(L, canOpen, legacy) {
  /** @type {any} */
  let saved = null;
  try {
    saved = legacy.tabs ? JSON.parse(legacy.tabs) : null;
  } catch {
    saved = null;
  }
  const tabs = [...new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string" && canOpen(id)) : [])];
  if (!tabs.length) return L;
  const active = legacy.tab && tabs.includes(legacy.tab) ? legacy.tab : tabs[0];
  L.cols = [{ w: 1, tiles: [{ id: "t1", tabs, active, h: 1 }] }];
  L.seq = 1;
  L.focus = "t1";
  return L;
}
