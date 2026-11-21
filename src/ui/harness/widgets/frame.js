// @ts-check
// One widget frame (HarnessV3-Facade D8, Step 4 D8): a pill that opens a popover whose sections always come in this
// order — Now (read-only rows about the last turn), This session (the settings the widget covers, drawn with the
// shared editor's knobRow in compact density), Actions (buttons that write through the writer or send a command), and
// a footer link to the inspector tab. The frame knows nothing about any feature: a widget is a spec, and the frame
// hands back `{ el, paint, close }` for whoever hosts it. A widget never fetches (D17): everything comes from the
// widget context. Keyboard: the pill is a button labelled "<Feature>: <state>"; Esc closes and returns focus.
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { popover } from "../lib/ui.js";
import { knobRow, derivedOf } from "../../lib/settings/editor.js";
import { kids } from "./kit.js";

/**
 * A widget's spec. Each builder returns an element, a list of them, or null (an empty section draws nothing —
 * "absent when there is nothing to show").
 * @typedef {{
 *   id: string,
 *   label: string,
 *   state: () => string,
 *   tone?: () => "" | "on" | "warn" | "error",
 *   title?: () => string,
 *   icon?: string,
 *   visible?: () => boolean,
 *   marks?: () => Record<string, boolean>,
 *   face?: (mk: typeof h) => any,
 *   width?: number,
 *   liveNow?: boolean,
 *   now?: () => any,
 *   covers?: WidgetCovers | readonly WidgetCovers[],
 *   actions?: () => any[],
 *   link?: () => { label: string, onClick: () => void } | null,
 *   onOpen?: () => void,
 *   panel?: (mk: typeof h, close: () => void, relayout?: () => void) => any,
 *   repaint?: () => void,
 *   side?: "top" | "bottom",
 *   align?: "start" | "end",
 *   tile?: (mk: typeof h, size: TileSize, back: { open: () => void }) => any,
 *   tileIcon?: string,
 *   tileSub?: () => string,
 *   tileTrail?: (mk: typeof h) => any,
 *   sheet?: () => void,
 *   named?: boolean,
 *   more?: () => string,
 *   empty?: () => boolean,
 * }} WidgetSpec
 * `visible` hides the pill (a widget that has nothing to be about yet); `marks` are extra classes on the pill (the
 * cache's cold mark); `face` replaces the value text with a face of the widget's own (the meter's bar), rebuilt on
 * every paint; `width` is the popover's; `liveNow` says the widget reads the composer's live figures — the host
 * repaints it whenever they move, and the open popover's Now section redraws with it (the settings rows are never
 * rebuilt under the cursor); `covers` names the settings the This session section draws — data, so a widget states
 * what it covers and the host draws every widget's rows the same way. A list of covers draws one section per group,
 * each under its title (Step 5 D8). A widget that is a tool rather than a summary draws its whole popover itself:
 * `panel` builds the body (handed the frame's close, and `relayout` — the popover measured and placed again, for a
 * panel whose height changes while open) and takes the place of the four sections, in the glass card;
 * `repaint` redraws its live parts while it is open, whenever the host repaints the widget. `side` and `align`
 * place the popover against its pill (default: above it, from its start).
 *
 * On Overview a widget is a tile (proposal_ux §5): `tile` draws its face at the size its slot gives — glyph and title
 * are the frame's, then a hero figure, one sentence or one chart, never a form —, given its size and the way to open
 * its back (a face's "Turn on…" opens the switch, never flips it); `tileIcon` is its glyph where the pill has none,
 * `tileSub` the quiet line under its title, `tileTrail` what stands at the head's end (a link, where the setting comes
 * from). Pressing the tile opens its back: the popover its pill opens, or, with `sheet`, the sheet a setup widget
 * changes its settings on.
 *
 * A gauge whose figure alone would be a bare number says what it is (the design pass of 10-24, the Designer's mock
 * chat_strip_controls_in_place): `named` shows its label beside the figure, and `more` the quiet words after it in
 * the strip ("warm 4 min", "recalled"). On Overview, `empty` says a tile has nothing to show yet — no compaction, no
 * file changed —: the page keeps it off until it has, and shows it, dimmed, while its widgets are edited.
 */

/** A tile's size on Overview's grid (§5.1): S 1 × 1, M 2 × 1, L 2 × 2. @typedef {"S" | "M" | "L"} TileSize */

/** @typedef {{ title?: string, paths: readonly string[], labels?: Readonly<Record<string, string>> }} WidgetCovers  the knobs, in order, each in plain words when a label is given; `title` heads the group's section */

/** A widget's covers as groups, in order. @param {WidgetCovers | readonly WidgetCovers[] | undefined} covers @returns {readonly WidgetCovers[]} */
export const coverGroups = (covers) => (!covers ? [] : Array.isArray(covers) ? covers : [/** @type {WidgetCovers} */ (covers)]);

/**
 * The builders the frame draws with: `h` and `popover` (the page's, by default), `rows` — the settings rows for what a
 * widget covers, which the host supplies (it holds the context those rows read and write through) —, and `drawIn`, how
 * a live part's newest draw goes into the part on the page: in place (dom.js `morphChildren`), so a press or a hover on
 * a face, a tile or an open popover lands on the element that stood (the owner's of 11-01: buttons blinking under a
 * resting pointer, clicks lost). A test injects them to run without a DOM — its own `h`'s nodes with its own `drawIn`.
 * @typedef {{ h?: typeof h, popover?: typeof popover, rows?: (covers: WidgetCovers) => any[] | null,
 *   drawIn?: (parent: any, nodes: any[]) => void }} WidgetIO
 */

/**
 * The pill and its popover.
 * @param {WidgetSpec} spec
 * @param {WidgetIO} [io]
 * @returns {{ el: HTMLElement, paint: () => void, close: () => void, show: () => void, spec: WidgetSpec }}  `show` opens the
 *   popover from elsewhere (a shortcut) — nothing while the pill is hidden or already open
 */
export function featureWidget(spec, io = {}) {
  const mk = io.h || h;
  const drawIn = io.drawIn || morphChildren;
  const toneOf = spec.tone || (() => "");
  const faceEl = mk("span", { class: spec.face ? "widget-face" : "widget-value" }, spec.face ? spec.face(mk) : spec.state());
  // The feature's name rides beside the value; where the pill stands decides whether it shows (the composer's
  // strip reads "Memory On", the typing row the face alone).
  const moreEl = mk("span", { class: "widget-more" });
  const el = mk("button", {
    class: `widget-pill widget-${spec.id}${spec.named ? " is-named" : ""}`,
    type: "button",
    "aria-haspopup": "dialog",
  }, mk("span", { class: "widget-ic", ...(spec.icon && ICONS[spec.icon] ? { html: ICONS[spec.icon] } : {}) }), mk("span", { class: "widget-label" }, spec.label), faceEl, moreEl);

  const back = widgetBack(spec, io, el, place(spec));
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    back.toggle();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && back.isOpen()) {
      e.preventDefault();
      back.close();
      el.focus(); // Esc returns focus to the pill (AgentPlanUX §3.4)
    }
  });
  // The frame repaints the pill's face when the feature says its words moved — many times a second while a reply
  // streams: the button itself stays, so the focus and the listeners survive a live value, and the face is drawn in
  // place, each part of it under the pointer the element it was.
  const paint = () => {
    const shown = spec.visible ? spec.visible() : true;
    el.classList.toggle("hidden", !shown);
    if (!shown) back.close();
    const tone = toneOf();
    el.classList.toggle("warn", tone === "warn");
    el.classList.toggle("error", tone === "error");
    el.classList.toggle("on", tone === "on");
    for (const [mark, on] of Object.entries(spec.marks?.() || {})) el.classList.toggle(mark, !!on);
    el.title = spec.title?.() || titleOf(spec);
    const more = spec.more?.() || "";
    // A pill showing its glyph alone is named by its tooltip's sentence, not by its label with nothing after it; a
    // figure's word after it is heard with it.
    el.setAttribute("aria-label", String(spec.state() ?? "") ? `${titleOf(spec)}${more ? ` ${more}` : ""}` : spec.title?.() || spec.label);
    // A face leaves out a part it has nothing for (null), which would be drawn as text.
    drawIn(faceEl, [spec.face ? spec.face(mk) : spec.state()].flat().filter((part) => part != null));
    drawIn(moreEl, more ? [more] : []);
    back.repaint();
  };
  paint();
  const show = () => {
    if (!back.isOpen() && !el.classList.contains("hidden")) back.open();
  };
  return { el, paint, close: back.close, show, spec };
}

/** "<Feature>: <state>", or the feature alone while it says nothing. @param {WidgetSpec} spec */
const titleOf = (spec) => (String(spec.state() ?? "") ? `${spec.label}: ${spec.state()}` : spec.label);

/** Where a widget's popover stands against what opened it (default: above it, from its start). @param {WidgetSpec} spec */
const place = (spec) => ({ side: spec.side || "top", align: spec.align || "start", width: spec.width || 320 });

/**
 * A widget's back (proposal_ux §5.2): the popover its pill opens — and its tile on Overview, the same one —, built
 * from the spec each time it opens: the tool's own `panel`, or the four sections (Now, the settings it covers, its
 * actions, its link). `anchor` is what it stands against; the anchor wears `is-open` while it shows.
 * @param {WidgetSpec} spec @param {WidgetIO} io @param {HTMLElement} anchor
 * @param {{ side: "top" | "bottom", align: "start" | "end", width: number }} at
 * @returns {{ open: () => void, close: () => void, toggle: () => void, isOpen: () => boolean, repaint: () => void }}
 */
export function widgetBack(spec, io, anchor, at) {
  const mk = io.h || h;
  const pop = io.popover || popover;
  const drawIn = io.drawIn || morphChildren;
  /** @type {{ el: any, close: () => void, place?: () => void } | null} */
  let open = null;
  /** The open popover's live parts: its title and its Now section. @type {{ title: any, now: any } | null} */
  let live = null;
  /** The popover went, whichever way: closed here, or by Esc or a press outside it — the next press opens it again. */
  const gone = () => {
    open = null;
    live = null;
    anchor.classList.remove("is-open");
  };
  const close = () => {
    open?.close();
    gone();
  };
  const where = { ...at, label: spec.label, onClose: gone };
  const draw = () => {
    if (spec.panel) {
      const body = mk("div", { class: `widget-panel widget-pop-${spec.id}` }, spec.panel(mk, close, () => open?.place?.()));
      open = pop(anchor, body, where);
      anchor.classList.add("is-open");
      spec.onOpen?.();
      return;
    }
    const actions = (spec.actions?.() || []).filter(Boolean);
    const link = spec.link?.();
    // Each builder runs once per open: a section is drawn only when it has something to show, and a builder's
    // rows are never built twice. The Now section keeps its box so a live widget can redraw inside it.
    const now = spec.now?.();
    const rowsOf = io.rows;
    const sessionSections = rowsOf
      ? coverGroups(spec.covers).map((group) => {
          const rows = (rowsOf(group) || []).filter(Boolean);
          return rows.length ? mk("div", { class: "widget-section widget-session" }, group.title ? mk("div", { class: "widget-group-title" }, group.title) : null, ...rows) : null;
        })
      : [];
    const title = mk("div", { class: "widget-title" }, titleOf(spec));
    const nowBox = now || spec.liveNow ? mk("div", { class: `widget-section widget-now${now ? "" : " hidden"}` }, now) : null;
    const sections = [
      nowBox,
      ...sessionSections,
      actions.length ? mk("div", { class: "widget-section widget-actions" }, ...actions) : null,
      link ? mk("div", { class: "widget-section widget-link" },
        mk("button", { class: "ghost sm", type: "button", onclick: () => { close(); link.onClick(); } }, link.label)) : null,
    ].filter(Boolean);
    const body = mk("div", { class: `widget-pop widget-pop-${spec.id}` }, title, ...sections);
    open = pop(anchor, body, where);
    live = { title, now: nowBox };
    anchor.classList.add("is-open");
    spec.onOpen?.();
  };
  return {
    open: () => { if (!open) draw(); },
    close,
    toggle: () => (open ? close() : draw()),
    isOpen: () => !!open,
    /** The open popover's live parts drawn again, in place: the panel's own repaint, or the title and the Now section. */
    repaint: () => {
      if (!open) return;
      spec.repaint?.();
      if (!live) return;
      drawIn(live.title, [titleOf(spec)]);
      if (spec.liveNow && live.now) {
        const now = spec.now?.();
        drawIn(live.now, [now].flat().filter(Boolean));
        live.now.classList.toggle("hidden", !now);
      }
    },
  };
}

/**
 * A widget as a tile on Overview (proposal_ux §5): its glyph in its colour, its title and quiet line, what stands at
 * the head's end, and its face at its size. The whole tile is one press — a button laid under its words, the links on
 * it standing above that button — and the press opens its back: the popover its pill opens, or its sheet. A link on
 * a face acts on its own press, and only opens something; the one act a face holds is Stop, which never starts or
 * spends (§4.6).
 * @param {WidgetSpec} spec
 * @param {WidgetIO} [io]
 * @param {{ size?: TileSize }} [o]
 * @returns {{ el: HTMLElement, paint: () => void, open: () => void, close: () => void, focus: () => void, spec: WidgetSpec, size: TileSize }}
 */
export function featureTile(spec, io = {}, o = {}) {
  const mk = io.h || h;
  const drawIn = io.drawIn || morphChildren;
  const size = o.size || "M";
  const press = mk("button", { class: "ov-tile-open", type: "button", "aria-haspopup": "dialog" });
  const sub = mk("span", { class: "ov-tile-sub" });
  const trail = mk("span", { class: "ov-tile-trail" });
  const face = mk("div", { class: "ov-tile-face" });
  const el = mk("section", { class: `ov-tile ov-${size} ov-w-${spec.id}`, "data-widget": spec.id },
    press,
    mk("div", { class: "ov-tile-head" },
      mk("span", { class: "ov-tile-ic", ...(ICONS[spec.tileIcon || spec.icon || ""] ? { html: ICONS[spec.tileIcon || spec.icon || ""] } : {}) }),
      mk("span", { class: "ov-tile-name" }, mk("span", { class: "ov-tile-title" }, spec.label), sub),
      trail),
    face);
  const back = widgetBack(spec, io, el, { side: "bottom", align: "start", width: spec.width || 340 });
  const opens = { open: () => (spec.sheet ? spec.sheet() : back.open()) };
  press.addEventListener("click", (e) => {
    e.stopPropagation();
    if (spec.sheet) spec.sheet();
    else back.toggle();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && back.isOpen()) {
      e.preventDefault();
      back.close();
      press.focus();
    }
  });
  const paint = () => {
    const tone = spec.tone?.() || "";
    el.classList.toggle("is-warn", tone === "warn");
    el.classList.toggle("is-error", tone === "error");
    press.setAttribute("aria-label", spec.sheet ? `${titleOf(spec)} — change it` : titleOf(spec));
    press.title = spec.title?.() || titleOf(spec);
    // In place, as the pill's face: a live tile is drawn again at every frame of a reply, its Stop and its links with it.
    drawIn(sub, [spec.tileSub?.() || ""]);
    drawIn(trail, kids([spec.tileTrail?.(mk)]));
    drawIn(face, kids([spec.tile ? spec.tile(mk, size, opens) : mk("div", { class: "ov-hero" }, mk("span", { class: "ov-hero-num" }, spec.state() || "—"))]));
    back.repaint();
  };
  paint();
  return { el, paint, open: opens.open, close: back.close, focus: () => press.focus(), spec, size };
}

/**
 * The covered settings of a widget's "This session" section: the shared editor's rows over the session view's
 * resolved document (D8 — there is never a second row implementation). `paths` are drawn in the order given, each
 * named by `labels` in plain words when the feature gives one; `knobs` is the catalogue (the page's shared list —
 * a widget never fetches).
 * @param {readonly string[]} paths @param {any} settings  the view's settings ({ effective, flat, sources })
 * @param {{ change: (change: { patch?: any, unset?: string[] }) => void, toast?: (msg: string, kind?: string) => void }} cb
 * @param {Record<string, any>} knobs
 * @param {Readonly<Record<string, string>>} [labels]
 */
export function widgetSettingsRows(paths, settings, cb, knobs, labels = {}) {
  const doc = { knobs: knobs || {} };
  // The rows read the FLAT resolved map (the editor's contract); the nested `effective` is only a fallback.
  const flat = settings?.flat || settings?.effective || {};
  return paths
    .map((p) => {
      const k = doc.knobs[p];
      if (!k) return null;
      return knobRow(p, k, doc, cb, {
        mode: "session",
        flat,
        sources: settings?.sources || {},
        own: "session",
        filamentRuns: true,
        density: "compact",
        derived: derivedOf(settings),
        ...(labels[p] ? { label: labels[p] } : {}),
      });
    })
    .filter(Boolean);
}
