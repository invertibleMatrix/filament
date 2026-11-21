// @ts-check
// Mounting the widget layout (HarnessV3 Step 4 D8): each slot the page offers gets the widgets the layout places
// there, built on the frame from the one widget context. The host draws every widget's covered settings from that
// context (a session's own settings — none before the session exists), repaints the widgets — all of them when the
// session view moves, only the ones that read the live figures (`liveNow`) when those move, wherever the layout put
// them — and closes their popovers together. Overview (views/overview.js) is a surface beside the slots: it holds the
// same widgets as tiles, and paints, closes and opens a back with them.
import { featureWidget, widgetSettingsRows } from "./frame.js";
import { WIDGETS, DEFAULT_LAYOUT, widgetsFor } from "./registry.js";

/**
 * A surface beside the slots (Overview): what the host asks of it. `show` answers whether it opened the widget's back.
 * @typedef {{ paint: () => void, paintLive: () => void, close: () => void, show: (id: string) => boolean }} WidgetSurface
 */

/**
 * @param {Record<string, HTMLElement | null | undefined>} slots  slot name → the element the slot's pills go into
 * @param {import("./registry.js").WidgetContext} ctx
 * @param {import("./frame.js").WidgetIO & { layout?: Readonly<Record<string, readonly string[]>> }} [io]
 */
export function mountWidgets(slots, ctx, io = {}) {
  const layout = io.layout || DEFAULT_LAYOUT;
  /** @type {(covers: import("./frame.js").WidgetCovers) => any[] | null} */
  const rows = (covers) =>
    ctx.hasSession() ? widgetSettingsRows(covers.paths, ctx.view()?.settings || {}, { change: ctx.write, toast: ctx.toast }, ctx.knobs(), covers.labels) : null;
  const frameIO = { rows, ...io };
  /** @type {Record<string, ReturnType<typeof featureWidget>[]>} */
  const mounted = {};
  for (const [slot, host] of Object.entries(slots)) {
    if (!host) continue;
    mounted[slot] = widgetsFor(slot, layout).map((id) => {
      const w = featureWidget(WIDGETS[id](ctx, frameIO), frameIO);
      host.append(w.el);
      return w;
    });
  }
  /** @type {WidgetSurface[]} the surfaces beside the slots */
  const surfaces = [];
  return {
    /** The mounted widgets, slot by slot (the tests and a future layout editor read them). */
    widgets: mounted,
    /** The frame's io the slots' widgets were built with: a surface builds its own with it. */
    io: frameIO,
    /** A surface that holds widgets of its own, painted, closed and asked to open a back with the slots'. @param {WidgetSurface} s */
    add(s) {
      surfaces.push(s);
    },
    /** Repaint every widget. */
    paint() {
      for (const list of Object.values(mounted)) for (const w of list) w.paint();
      for (const s of surfaces) s.paint();
    },
    /** Repaint the widgets that read the composer's live figures — many times a second while a reply streams. */
    paintLive() {
      for (const list of Object.values(mounted)) for (const w of list) if (w.spec.liveNow) w.paint();
      for (const s of surfaces) s.paintLive();
    },
    /** Close every open widget popover. */
    close() {
      for (const list of Object.values(mounted)) for (const w of list) w.close();
      for (const s of surfaces) s.close();
    },
    /**
     * Open one widget's back (a shortcut's door, a link's): on a surface that shows it, else its pill's popover wherever
     * the layout put it.
     * @param {string} id
     */
    show(id) {
      if (surfaces.some((s) => s.show(id))) return;
      for (const list of Object.values(mounted)) for (const w of list) if (w.spec.id === id) w.show();
    },
  };
}
