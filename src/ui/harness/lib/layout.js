// @ts-check
// The window's widths beside the panes (proposal_ux §3.5). Docked, the panes tile in columns beside the chat: how many
// columns fit and how wide they are both go by the room the chat leaves, the chat keeping READ_MIN on Auto (PANE_MIN_CONV
// when the person put the panes Beside). Where not even one column fits, the panes float over the chat as one pane with
// tabs — fitted to the window as the side pane always was: the width the person chose, narrowed so the chat keeps
// PANE_MIN_CONV beside it, never under PANE_MIN; it hides only when even that leaves the chat short. Floating, the chat's
// parts step aside by the pane's width and FLOAT_INSET (they yield to it), so either way its width is the chat's.

/** The least the chat keeps beside a floating pane, and beside docked panes the person put Beside. */
export const PANE_MIN_CONV = 480;
/** The least the chat keeps beside docked panes on Auto; under it they float. */
export const READ_MIN = 640;
/** The least the conversation's frame keeps beside the sidebar; under it the sidebar collapses. */
export const SIDE_MIN_CONV = 360;
/** A pane's own least width: a floating pane's, and a docked column's when the person drags it narrower. */
export const PANE_MIN = 280;
/** A docked pane column's least width as the rule counts the room: no column starts narrower. */
export const TILE_MIN = 380;
/** A window this wide holds a third pane column. */
export const WIDE_MIN = 3000;
/** A tile's least height: a column holds as many tiles as fit, the rest wait in a tile as tabs. */
export const TILE_MIN_H = 150;

/** Each column count's share of the row, and the span the panes' width keeps to. */
const SHARE = /** @type {Record<number, number>} */ ({ 1: 0.38, 2: 0.6, 3: 0.7 });
const SPAN = /** @type {Record<number, [number, number]>} */ ({ 1: [420, 760], 2: [800, 1400], 3: [1140, 2100] });

/** What the chat gives up beside the floating pane beyond its width: the pane's 8 px from the frame's edge, and the 8 px
 *  the chat's parts keep from it. */
export const FLOAT_INSET = 16;

/**
 * The floating pane's width in a split row this wide: the chosen width, narrowed so the chat keeps PANE_MIN_CONV, never
 * under PANE_MIN. The chosen width stays the person's, for a wider window.
 * @param {number} chosen @param {number} row  the split row's width
 */
export const fitPane = (chosen, row) => Math.min(chosen, Math.max(PANE_MIN, row - FLOAT_INSET - PANE_MIN_CONV));

/** What the chat keeps beside a floating pane this wide. @param {number} paneW @param {number} row */
export const convBeside = (paneW, row) => row - FLOAT_INSET - paneW;

/**
 * Whether the window's room hides the floating pane. A show the person asked for shows it whatever the room, until the
 * next window resize; a resize, and a show that only puts it back where the page itself opened something, go by the
 * room, so a pane the room had hidden stays hidden (HarnessV4_Tasks U4).
 * @param {boolean} asked @param {number} paneW  the pane's fitted width @param {number} row
 */
export const roomHides = (asked, paneW, row) => !asked && convBeside(paneW, row) < PANE_MIN_CONV;

/**
 * How many pane columns dock beside the chat in a split row this wide: none where a column of TILE_MIN would leave the
 * chat under `least` (the panes float), two at most, three on a window WIDE_MIN or wider.
 * @param {number} row @param {number} windowW @param {number} [least]  what the chat keeps: READ_MIN, or PANE_MIN_CONV Beside
 */
export function columnsFor(row, windowW, least = READ_MIN) {
  const free = row - least;
  if (free < TILE_MIN) return 0;
  return Math.max(1, Math.min(windowW >= WIDE_MIN ? 3 : 2, Math.floor(free / TILE_MIN)));
}

/**
 * How the panes sit in a row this wide (proposal_ux D1): docked beside the chat while it keeps its least beside a column
 * — READ_MIN on Auto, PANE_MIN_CONV Beside — and over it otherwise, or always when put Over the chat.
 * @param {"auto" | "beside" | "over"} place @param {number} row @param {number} windowW
 * @returns {{ cols: number, least: number }}  `cols` 0: the panes float
 */
export function dockFor(place, row, windowW) {
  const least = place === "beside" ? PANE_MIN_CONV : READ_MIN;
  return { cols: place === "over" ? 0 : columnsFor(row, windowW, least), least };
}

/**
 * The docked panes' width for this many columns: the person's own width for that many where they dragged one, else the
 * columns' share of the row within their span; either way the chat keeps `least` (and the odd pixel) and no column is
 * under PANE_MIN.
 * @param {number} row @param {number} cols  1 to 3 @param {number | null | undefined} chosen  the person's width for that many
 * @param {number} [least]
 */
export function panesWidth(row, cols, chosen, least = READ_MIN) {
  const n = Math.max(1, Math.min(3, Math.round(cols)));
  const [lo, hi] = SPAN[n];
  const want = chosen && chosen > 0 ? chosen : Math.max(lo, Math.min(hi, row * SHARE[n]));
  return Math.floor(Math.max(n * PANE_MIN, Math.min(want, row - least)));
}

/** How many tiles a column this tall holds, one at least. @param {number} height */
export const rowsFor = (height) => Math.max(1, Math.floor(height / TILE_MIN_H));
