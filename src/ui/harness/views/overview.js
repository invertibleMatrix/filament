// @ts-check
// Overview (proposal_ux §4.6, §5): everything about the chat on one page — what it is doing, what it has used, and how
// it is set up — as three bands of tiles. A tile is a widget's face (widgets/frame.js `featureTile`): the same spec the
// pill in the box's strip is built from, so pressing it opens the same popover, or, for a setup widget, the sheet that
// changes what it owns; no tile acts on one press but Stop. The layout is the person's, one for every chat (§5.5): Edit
// widgets drags a tile within its band or moves it with the arrow keys, gives it another of the sizes it takes, takes it
// off, adds one from the gallery, or resets it all. The page reads the widget context only once the app has built it
// (`attach`); until it first shows, no tile is built, and while it is out of sight nothing is painted.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { menu } from "../lib/ui.js";
import { featureTile } from "../widgets/frame.js";
import { OVERVIEW_BANDS, TILES, WIDGETS, overviewGallery, overviewLayout } from "../widgets/registry.js";
import { engineOf } from "../widgets/overview-setup.js";
import { ago } from "../widgets/kit.js";

/** @typedef {import("../widgets/registry.js").WidgetContext} WidgetContext */
/** @typedef {import("../widgets/registry.js").SavedOverview} SavedOverview */
/** @typedef {import("../widgets/registry.js").BandId} BandId */
/** @typedef {import("../widgets/frame.js").TileSize} TileSize */

/** The sizes in the size menu's words (§5.1). @type {Record<TileSize, string>} */
const SIZE_WORDS = { S: "Small · one cell", M: "Wide · two cells", L: "Large · two by two" };

/**
 * @typedef {object} OverviewIO
 * @property {() => SavedOverview | null} saved  the person's layout as kept
 * @property {(next: SavedOverview | null) => void} keep  a new layout kept (null: the default)
 * @property {typeof h} [mk]  the tests' element maker
 * @property {typeof menu} [menu]  the tests' menu
 * @property {(fn: () => void) => void} [frame]  the next frame (the live figures' paints gather into one per frame)
 */

/**
 * @param {OverviewIO} o
 */
export function createOverview(o) {
  const mk = o.mk || h;
  const openMenu = o.menu || menu;
  const nextFrame = o.frame || ((fn) => { requestAnimationFrame(() => fn()); });
  /** @type {WidgetContext | null} */
  let ctx = null;
  /** @type {import("../widgets/frame.js").WidgetIO} */
  let io = {};
  let shown = false;
  let editing = false;
  /** Whether the bands on screen were built for the layout as kept now. */
  let built = false;
  let livePending = false;
  /** @type {{ id: string, band: BandId, tile: ReturnType<typeof featureTile> }[]} */
  let tiles = [];
  /** This chat so far's line, which says when the chat started. @type {HTMLElement | null} */
  let sinceEl = null;

  const badgeName = mk("span", { class: "ov-engine-name" });
  const badgeLine = mk("span", { class: "ov-engine-line" });
  const badge = mk("span", { class: "ov-engine" }, mk("span", { class: "ov-engine-dot" }), badgeName, badgeLine);
  const editBtn = mk("button", { class: "ov-head-btn", type: "button", onclick: () => setEditing(!editing) });
  const resetBtn = mk("button", { class: "ov-head-btn is-quiet hidden", type: "button", title: "Every widget back where it was, at its size", onclick: () => { o.keep(null); rebuild(); } }, "Reset");
  const head = mk("header", { class: "ov-head" },
    mk("div", { class: "ov-head-text" },
      mk("h1", { class: "ov-title" }, "Overview"),
      mk("p", { class: "ov-sub" }, "Everything about this chat: what it is doing, what it has used, and how it is set up. Press a widget to change what it owns.")),
    mk("div", { class: "ov-head-tools" }, badge, resetBtn, editBtn));
  const bandsEl = mk("div", { class: "ov-bands" });
  const scroll = mk("div", { class: "ov-scroll" }, mk("div", { class: "ov-inner" }, head, bandsEl));
  const el = mk("div", { class: "ov", role: "region", "aria-label": "Overview" }, scroll);

  /** The kept layout, whatever it says, as an object to change. @returns {Required<SavedOverview>} */
  const kept = () => {
    const s = o.saved() || {};
    return {
      order: { ...(s.order || {}) },
      sizes: { ...(s.sizes || {}) },
      off: Array.isArray(s.off) ? [...s.off] : [],
    };
  };
  /** A change to the layout, kept, and the bands built again. @param {(s: Required<SavedOverview>) => void} fn */
  const change = (fn) => {
    const s = kept();
    fn(s);
    o.keep(s);
    rebuild();
  };
  /** A tile moved within its band by `by` places. @param {string} id @param {number} by */
  const move = (id, by) => change((s) => {
    const band = TILES[id].band;
    const ids = overviewLayout(o.saved())[band].map((t) => t.id);
    const at = ids.indexOf(id);
    const to = Math.max(0, Math.min(ids.length - 1, at + by));
    if (at < 0 || to === at) return;
    ids.splice(at, 1);
    ids.splice(to, 0, id);
    s.order[band] = ids;
  });
  /** A tile put before or after another of its band (a drop). @param {string} id @param {string} target @param {boolean} after */
  const place = (id, target, after) => change((s) => {
    const band = TILES[id].band;
    const ids = overviewLayout(o.saved())[band].map((t) => t.id).filter((x) => x !== id);
    const at = ids.indexOf(target);
    if (at < 0) return;
    ids.splice(after ? at + 1 : at, 0, id);
    s.order[band] = ids;
  });
  /** @param {string} id @param {TileSize} size */
  const resize = (id, size) => change((s) => { s.sizes[id] = size; });
  /** @param {string} id */
  const takeOff = (id) => change((s) => {
    s.off = [...new Set([...s.off, id])];
  });
  /** @param {string} id */
  const add = (id) => change((s) => {
    s.off = s.off.filter((x) => x !== id);
  });

  /** The widget's name, as its tile says it. @param {string} id */
  const nameOf = (id) => tiles.find((t) => t.id === id)?.tile.spec.label || id;

  /**
   * A tile's edit bar: its grip — dragged, or moved with the arrow keys —, its size (a menu of the sizes it takes, where
   * it takes more than one) and ×.
   * @param {string} id @param {TileSize} size
   */
  const editBar = (id, size) => {
    const sizes = TILES[id].sizes;
    const grip = mk("button", {
      class: "ov-edit-grip",
      type: "button",
      title: "Drag within its band, or move it with the arrow keys",
      "aria-label": `Move ${nameOf(id)}: arrow keys`,
      html: ICONS.gripVertical,
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        const by = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
        if (!by) return;
        e.preventDefault();
        move(id, by);
        /** @type {HTMLElement | null} */ (bandsEl.querySelector(`[data-widget="${id}"] .ov-edit-grip`))?.focus();
      },
    });
    const sizeBtn = mk("button", {
      class: "ov-edit-size",
      type: "button",
      title: sizes.length > 1 ? "Its size" : "It takes this size alone",
      "aria-label": `${nameOf(id)}'s size: ${SIZE_WORDS[size]}`,
      ...(sizes.length > 1 ? {} : { disabled: "" }),
      onclick: (/** @type {Event} */ e) => {
        e.stopPropagation();
        openMenu(sizes.map((s) => ({ type: "radio", label: SIZE_WORDS[s], checked: s === size, onClick: () => { if (s !== size) resize(id, s); } })), { anchor: /** @type {HTMLElement} */ (e.currentTarget), align: "end", width: 200 });
      },
    }, size);
    const x = mk("button", { class: "ov-edit-x", type: "button", title: "Take it off the page; + Add a widget brings it back", "aria-label": `Take ${nameOf(id)} off`, html: ICONS.x, onclick: () => takeOff(id) });
    return mk("div", { class: "ov-edit" }, grip, mk("span", { class: "grow" }), sizeBtn, x);
  };

  /** The dragged tile's id while a drag runs. @type {string | null} */
  let dragging = null;
  /** @param {HTMLElement} el @param {string} id */
  const draggable = (el, id) => {
    el.setAttribute("draggable", "true");
    el.addEventListener("dragstart", (e) => {
      dragging = id;
      e.dataTransfer?.setData("text/plain", id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      el.classList.add("is-dragging");
    });
    el.addEventListener("dragend", () => {
      dragging = null;
      el.classList.remove("is-dragging");
      for (const t of bandsEl.querySelectorAll(".is-drop-before, .is-drop-after")) t.classList.remove("is-drop-before", "is-drop-after");
    });
    /** Whether the drop lands after this tile: past its middle, along the row. @param {DragEvent} e */
    const after = (e) => {
      const r = el.getBoundingClientRect();
      return e.clientX > r.left + r.width / 2;
    };
    el.addEventListener("dragover", (e) => {
      if (!dragging || dragging === id || TILES[dragging].band !== TILES[id].band) return;
      e.preventDefault();
      const a = after(e);
      el.classList.toggle("is-drop-after", a);
      el.classList.toggle("is-drop-before", !a);
    });
    el.addEventListener("dragleave", () => el.classList.remove("is-drop-before", "is-drop-after"));
    el.addEventListener("drop", (e) => {
      if (!dragging || dragging === id || TILES[dragging].band !== TILES[id].band) return;
      e.preventDefault();
      place(dragging, id, after(e));
    });
  };

  /** + Add a widget: the gallery, the widgets taken off the page — each back in its band. @param {HTMLElement} anchor */
  const gallery = (anchor) => {
    const ids = overviewGallery(o.saved());
    const band = (/** @type {string} */ id) => OVERVIEW_BANDS.find((b) => b.id === TILES[id].band)?.title || "";
    const items = ids.length
      ? ids.map((id) => {
          const spec = ctx ? WIDGETS[id](ctx, io) : null;
          return { label: spec?.label || id, icon: spec?.tileIcon || spec?.icon || "plus", desc: band(id), onClick: () => add(id) };
        })
      : [{ type: "label", label: "Every widget is on the page" }];
    openMenu(items, { anchor, side: "top", align: "end", width: 260 });
  };

  /** The bands built again from the layout as kept: the tiles, each at its size, and the gallery's tile last. */
  const build = () => {
    for (const t of tiles) t.tile.close();
    tiles = [];
    const c = /** @type {WidgetContext} */ (ctx);
    const layout = overviewLayout(o.saved());
    bandsEl.replaceChildren(...OVERVIEW_BANDS.map((band) => {
      const grid = mk("div", { class: "ov-grid", "data-band": band.id });
      for (const { id, size } of layout[band.id]) {
        const tile = featureTile(WIDGETS[id](c, io), io, { size });
        tiles.push({ id, band: band.id, tile });
        if (editing) {
          tile.el.classList.add("is-editing");
          tile.el.append(editBar(id, size), mk("span", { class: "ov-empty-note" }, "Off the page until it has something"));
          draggable(tile.el, id);
        }
        grid.append(tile.el);
      }
      if (band.id === "setup")
        grid.append(mk("button", { class: "ov-tile ov-S ov-add", type: "button", onclick: (/** @type {Event} */ e) => gallery(/** @type {HTMLElement} */ (e.currentTarget)) },
          mk("span", { class: "ov-add-ic", html: ICONS.plus }), mk("span", {}, "Add a widget")));
      const sub = mk("span", { class: "ov-band-sub" }, band.sub);
      if (band.id === "sofar") sinceEl = sub;
      return mk("section", { class: `ov-band ov-band-${band.id}`, "aria-label": band.title },
        mk("h2", { class: "ov-band-head" }, mk("span", { class: "ov-band-title" }, band.title), sub),
        grid);
    }));
    built = true;
  };
  const rebuild = () => {
    built = false;
    if (shown && ctx) paint();
  };

  /** @param {boolean} on */
  const setEditing = (on) => {
    editing = on;
    el.classList.toggle("is-editing", on);
    rebuild();
  };

  /** Whether the Edit button's face says Done: drawn again only when that moves. @type {boolean | null} */
  let editFace = null;
  // Painted at every frame of a reply, as its tiles are: the Edit button's face only as editing turns on or off, so its
  // glyph under a resting pointer stays the element it was (the owner's of 11-01: buttons blinking, clicks lost).
  const paintHead = () => {
    const e = engineOf(/** @type {WidgetContext} */ (ctx));
    badgeName.replaceChildren(e.name);
    badgeLine.replaceChildren(...(e.coder ? ["greyed parts say why"] : []));
    badge.classList.toggle("is-coder", e.coder);
    if (editFace !== editing) {
      editFace = editing;
      editBtn.replaceChildren(...(editing ? [mk("span", { class: "ov-head-ic", html: ICONS.check }), "Done"] : [mk("span", { class: "ov-head-ic", html: ICONS.pencil }), "Edit widgets"]));
    }
    editBtn.classList.toggle("is-on", editing);
    resetBtn.classList.toggle("hidden", !editing);
    const since = sinceWords(/** @type {WidgetContext} */ (ctx));
    sinceEl?.replaceChildren(since ? `since it started, ${since}` : "since it started");
  };

  function paint() {
    if (!shown || !ctx) return;
    if (!built) build();
    paintHead();
    for (const t of tiles) paintTile(t.tile);
  }

  /**
   * A tile painted, and kept off the page while it has nothing to show (the design pass of 10-24: no compaction yet, no
   * file changed): while the widgets are edited it stays, dimmed, so it can be placed. @param {{ el: HTMLElement, paint: () => void, spec: import("../widgets/frame.js").WidgetSpec }} tile
   */
  function paintTile(tile) {
    tile.paint();
    const empty = !!tile.spec.empty?.();
    tile.el.classList.toggle("hidden", empty && !editing);
    tile.el.classList.toggle("is-empty", empty && editing);
  }

  // Tab reaches each tile; the arrow keys move between them in the page's order, Home and End to the first and last.
  el.addEventListener("keydown", (e) => {
    const at = /** @type {HTMLElement} */ (e.target);
    if (!at.classList?.contains("ov-tile-open")) return;
    const presses = /** @type {HTMLElement[]} */ ([...bandsEl.querySelectorAll(".ov-tile-open")]);
    const i = presses.indexOf(at);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? presses.length - 1 : null;
    if (to == null || i < 0) return;
    e.preventDefault();
    presses[Math.max(0, Math.min(presses.length - 1, to))]?.focus();
  });

  return {
    el,
    /**
     * The app's widget context and the frame's io, once both are built: the page draws from then on.
     * @param {WidgetContext} c @param {import("../widgets/frame.js").WidgetIO} frameIO
     */
    attach(c, frameIO) {
      ctx = c;
      io = frameIO;
      built = false;
      paint();
    },
    /** On screen or not: out of sight it paints nothing, and its popovers close. @param {boolean} on */
    setShown(on) {
      if (on === shown) {
        if (on) paint();
        return;
      }
      shown = on;
      if (!on) {
        for (const t of tiles) t.tile.close();
        if (editing) setEditing(false);
        return;
      }
      paint();
    },
    /** Every tile painted again: the chat's view moved, or another chat shows. */
    paint,
    /** The tiles that read the live figures, painted once in the next frame however often the figures move. */
    paintLive() {
      if (!shown || livePending) return;
      livePending = true;
      nextFrame(() => {
        livePending = false;
        if (!shown) return;
        for (const t of tiles) if (t.tile.spec.liveNow) paintTile(t.tile);
      });
    },
    close() {
      for (const t of tiles) t.tile.close();
    },
    /** A widget's back opened from its tile, when the page shows and holds it; false otherwise. @param {string} id */
    show(id) {
      const t = shown ? tiles.find((x) => x.id === id) : null;
      if (!t) return false;
      t.tile.el.scrollIntoView?.({ block: "nearest" });
      t.tile.open();
      return true;
    },
    /** Whether the page is in edit mode (the tests read it). */
    get editing() { return editing; },
  };
}

/**
 * How long ago the chat started, from its first turn: "3 days ago"; "" before one has a time.
 * @param {WidgetContext} c
 */
function sinceWords(c) {
  const first = (c.turns() || []).find((t) => Number(t?.facts?.startedAt) > 0);
  return first ? ago(Number(first.facts.startedAt)) : "";
}
