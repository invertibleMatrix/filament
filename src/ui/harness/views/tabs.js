// @ts-check
// The session's view tabs (HarnessV3-Views VW-D1): a segmented control at the centre of the conversation's header, the
// way macOS switches between the views of one thing — an icon and a word each, a badge for what changes out of sight,
// the view's shortcut in its tooltip. Narrow, the words go and the tooltip names each view (views.css). A tab can be
// hidden while its view has nothing to show (`shown`: the Plan tab without a task graph). A pane popped out on top
// (HarnessV4_DesignPass_Plan UX10) has a tab after the views' (`setTops`), its pane's glyph and name and an × that puts
// it back beside the chat. The arrow keys move between the tabs shown, Home and End to the ends, as in any tab list;
// only the tab on screen is in the Tab order.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { tooltip } from "../lib/ui.js";
import { segStep } from "../widgets/kit.js";

/**
 * @typedef {{ id: string, label: string, icon: string, tip: string | (() => string), kbd: () => string }} ViewTab  `kbd` the shortcut
 *   that brings the view, read as it stands: it can be rebound
 * @typedef {{ text?: string, dot?: "works" | "asks", words: string }} Badge  a figure, a dot or both — `works` blue and
 *   live, `asks` orange — and what it says to a screen reader
 * @typedef {{ id: string, label: string, icon: string, title: string }} TopTab  a pane on top: its view's id, its
 *   pane's name, glyph and whole name
 */

/**
 * @param {{ views: ViewTab[], value: () => string, onChange: (id: string) => void, onBack?: (id: string) => void }} o
 *   `onBack`: a tab on top's ×, its view's id
 * @param {typeof h} [mk]  the page's `h`; the tests' fake DOM
 * @returns {{ el: any, paint: () => void, badge: (id: string, b: Badge | null) => void, shown: (id: string, on: boolean) => void,
 *   setTops: (tops: TopTab[]) => void }}
 */
export function viewTabs(o, mk = h) {
  /** @type {Map<string, { view: ViewTab, tab: any, badge: any }>} */
  const parts = new Map();
  /** The tabs whose views show, in their order: the views', then the panes' on top. */
  const showing = () => [...parts.values()].filter((p) => !p.tab.classList.contains("hidden")).map((p) => p.view);

  const paint = () => {
    const on = o.value();
    for (const [id, p] of parts) {
      p.tab.classList.toggle("is-on", id === on);
      p.tab.setAttribute("aria-selected", id === on ? "true" : "false");
      p.tab.setAttribute("tabindex", id === on ? "0" : "-1");
      p.tab.setAttribute("aria-keyshortcuts", p.view.kbd());
    }
  };
  /** @param {string} id */
  const go = (id) => {
    o.onChange(id);
    paint();
    parts.get(o.value())?.tab.focus();
  };

  const el = mk("div", {
    class: "view-tabs",
    role: "tablist",
    "aria-label": "Views of this session",
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      // Delete on a pane's tab on top: its ×.
      if (e.key === "Delete" && parts.get(o.value())?.tab.classList.contains("is-top")) {
        e.preventDefault();
        o.onBack?.(o.value());
        parts.get(o.value())?.tab.focus();
        return;
      }
      const shown = showing();
      const next = e.key === "ArrowRight" || e.key === "ArrowLeft" ? segStep(shown, o.value(), e.key === "ArrowRight" ? 1 : -1)
        : e.key === "Home" ? shown[0].id
        : e.key === "End" ? shown[shown.length - 1].id
        : "";
      if (!next) return;
      e.preventDefault();
      go(next);
    },
  }, ...o.views.map((v) => tabOf(v)));
  /** The panes on top's tabs, after the views': a box of their own, so drawing them anew leaves the views' as they are. */
  const topsEl = mk("span", { class: "view-tabs-top", role: "none" });
  el.append(topsEl);

  /** A view's tab, kept among the parts; a pane on top's with its ×. @param {ViewTab} v @param {boolean} [top] */
  function tabOf(v, top = false) {
    const badge = mk("span", { class: "view-badge" });
    const x = top
      ? mk("span", { class: "view-tab-x", role: "button", "aria-label": `Back to the side: ${v.label}`, html: ICONS.x || "", onclick: (/** @type {Event} */ e) => { e.stopPropagation(); o.onBack?.(v.id); } })
      : null;
    if (x) tooltip(x, { title: "Back to the side" });
    const tab = mk("button", { class: `view-tab${top ? " is-top" : ""}`, type: "button", role: "tab", "data-view": v.id, "aria-label": v.label, onclick: () => go(v.id) },
      mk("span", { class: "view-tab-ic", html: ICONS[v.icon] || "" }),
      mk("span", { class: "view-tab-label" }, v.label),
      badge,
      ...(x ? [x] : []));
    tooltip(tab, { title: v.tip, kbd: v.kbd });
    parts.set(v.id, { view: v, tab, badge });
    return tab;
  }

  /** The tabs on top as they were last drawn. */
  let tops = "";
  /**
   * The panes on top, a tab each after the views' (UX10): drawn anew only where they moved — one more, one gone, a name.
   * @param {TopTab[]} list
   */
  const setTops = (list) => {
    const said = JSON.stringify(list.map((t) => [t.id, t.label, t.icon, t.title]));
    if (said === tops) return;
    tops = said;
    for (const id of [...parts.keys()]) if (!o.views.some((v) => v.id === id)) parts.delete(id);
    topsEl.replaceChildren(...list.map((t) => tabOf({ id: t.id, label: t.label, icon: t.icon, tip: `${t.title}, popped out of the side — its × puts it back`, kbd: () => "" }, true)));
    paint();
  };
  paint();

  return {
    el,
    paint,
    setTops,
    badge(id, b) {
      const p = parts.get(id);
      if (!p) return;
      p.badge.replaceChildren(...(b?.dot ? [mk("span", { class: "view-dot" })] : []), ...(b?.text ? [b.text] : []));
      p.badge.classList.toggle("is-asks", b?.dot === "asks");
      p.tab.setAttribute("aria-label", b ? `${p.view.label}, ${b.words}` : p.view.label);
    },
    shown(id, on) {
      parts.get(id)?.tab.classList.toggle("hidden", !on);
    },
  };
}
