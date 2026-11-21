// @ts-check
// The header's pane buttons (proposal_ux §3.3, N4, D2), over the panes: a button for each pane given one — Changes and
// Terminal until the person picks others (right-click the header) — lit while its pane shows in front; ⋯ with the
// other panes, Layout and Show or hide panes; and, where the window has room for two columns, the Layout button named by
// how the panes arrange ("Grid ⌄"). A press opens a pane in front, or closes the one in front; it never runs anything
// (§3.5: a pane shows what is there). A pane at work out of sight — the plan's tasks running, the agent in the browser —
// has its button out of ⋯, after the pinned ones, a dot breathing on it, until its pane shows or the work ends (the
// owner's of 11-10: "it needs to show that something is active and being worked on").
import { h, setHtml } from "../../lib/dom.js";
import { store } from "../../lib/store.js";
import { glyphOf, icon } from "../lib/icons.js";
import { menu, tooltip } from "../lib/ui.js";
import { comboOf } from "../shortcuts.js";
import { ARRANGES, PLACES } from "./tiles.js";

const BUTTONS_KEY = "harness.paneButtons";
/** The panes with a button of their own until the person picks others. */
export const DEFAULT_BUTTONS = Object.freeze(["changes", "terminal"]);
/** A pane's key in the shortcut registry, where it has one. */
export const PANE_KEYS = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({ changes: "changes", terminal: "terminal" }));

/** How the panes arrange, in the Layout menu's words: its name there, the button's word for it, its mark, its line. */
export const ARRANGE_WORDS = Object.freeze({
  grid: { label: "Grid as they open", short: "Grid", icon: "layoutGrid", desc: "a column, two rows, a second column, 2 × 2" },
  column: { label: "One column", short: "Column", icon: "rows2", desc: "each pane under the last" },
  tabs: { label: "Tabs in one pane", short: "Tabs", icon: "appWindow", desc: "every pane a tab of one" },
});
/** Where the panes sit, in the Layout menu's words. */
export const PLACE_WORDS = Object.freeze({
  auto: { label: "Auto", icon: "layoutPanelLeft", desc: "beside the chat while it keeps 640 px, else over it" },
  beside: { label: "Beside", icon: "columns2", desc: "beside the chat while it keeps 480 px" },
  over: { label: "Over the chat", icon: "pictureInPicture2", desc: "one pane floating over the chat" },
});

/**
 * The panes given a button, as kept: known ones only, each once, in the panes' own order; nothing kept, the defaults.
 * @param {string | null | undefined} raw  the stored JSON @param {string[]} known  the panes' ids, in order
 */
export function buttonsOf(raw, known) {
  /** @type {any} */
  let saved = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const want = new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : DEFAULT_BUTTONS);
  return known.filter((id) => want.has(id));
}

/**
 * The panes whose button comes out of ⋯ (the owner's of 11-10: "Plan should come out of this three dot and be placed on
 * top bar if and only if plan view right bar pane is not opened … similar goes for browser"): each at work while its
 * pane is not in sight, with no button of its own, in the panes' order.
 * @param {string[]} known  the panes' ids, in order @param {string[]} pinned  those with a button of their own
 * @param {Iterable<string>} working  the panes at work @param {string[]} inSight  the panes in front, on screen
 */
export function pulledOut(known, pinned, working, inSight) {
  const busy = new Set(working);
  return known.filter((id) => busy.has(id) && !pinned.includes(id) && !inSight.includes(id));
}

/**
 * The Layout menu's rows: Arrange, then Place, the one in force checked.
 * @param {{ arrange: string, place: string, setArrange: (how: any) => void, setPlace: (where: any) => void }} host
 */
export function layoutItems(host) {
  return [
    { type: "label", label: "Arrange" },
    ...ARRANGES.map((a) => ({ type: "radio", icon: ARRANGE_WORDS[a].icon, label: ARRANGE_WORDS[a].label, desc: ARRANGE_WORDS[a].desc, checked: host.arrange === a, onClick: () => host.setArrange(a) })),
    { type: "separator" },
    { type: "label", label: "Place" },
    ...PLACES.map((p) => ({ type: "radio", icon: PLACE_WORDS[p].icon, label: PLACE_WORDS[p].label, desc: PLACE_WORDS[p].desc, checked: host.place === p, onClick: () => host.setPlace(p) })),
  ];
}

/**
 * @param {{ host: ReturnType<typeof import("./pane-host.js").createPaneHost>, slot: HTMLElement, layoutSlot: HTMLElement,
 *   header: HTMLElement }} o  `slot`: where the buttons and ⋯ go; `layoutSlot`: the Layout button's place; `header`: its
 *   right-click picks the buttons
 * @returns {{ paint: () => void, mark: (id: string, words: string | null) => void, works: (id: string, words: string | null) => void }}
 */
export function createPaneButtons(o) {
  const { host } = o;
  const ids = () => host.panes().map((p) => p.id);
  let pinned = buttonsOf(store.get(BUTTONS_KEY), ids());

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();
  /** What waits for you in a pane, by its id, its button's dot. @type {Map<string, string>} */
  const marked = new Map();
  /** What goes on in a pane, by its id: out of sight, its button shows with a dot breathing (`works`). @type {Map<string, string>} */
  const working = new Map();
  /** The panes out of ⋯ now. */
  const outNow = () => pulledOut(ids(), pinned, working.keys(), host.front());
  const group = h("span", { class: "pbtns" });
  const more = h("button", { class: "ghost icon pbtn-more", type: "button", "aria-label": "More panes", "aria-haspopup": "menu", html: icon("ellipsis") });
  tooltip(more, { title: "More panes and the layout" });
  more.addEventListener("click", (e) => {
    e.stopPropagation();
    moreMenu();
  });
  o.slot.replaceChildren(group, more);

  const layoutIc = h("span", { class: "pbtn-ic" });
  const layoutWord = h("span", { class: "pbtn-label" });
  const layoutBtn = h("button", { class: "pbtn pbtn-layout hidden", type: "button", "aria-haspopup": "menu" },
    layoutIc, layoutWord, h("span", { class: "pbtn-chev", html: icon("chevronDown") }));
  tooltip(layoutBtn, { title: "How the panes are laid out" });
  layoutBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu(layoutItems(host), { anchor: layoutBtn, side: "bottom", align: "end", width: 272 });
  });
  o.layoutSlot.replaceChildren(layoutBtn);

  // Right-click the header: which panes have a button (proposal_ux §3.3, "Buttons…"). The folder's field keeps its own.
  o.header.addEventListener("contextmenu", (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    const own = new Set(pinned);
    menu([
      { type: "label", label: "Buttons" },
      ...host.panes().map((p) => ({ type: "check", icon: p.icon, label: p.label, checked: own.has(p.id), onClick: () => pin(p.id, !own.has(p.id)) })),
      { type: "separator" },
      { label: "Changes and Terminal only", disabled: same(pinned, [...DEFAULT_BUTTONS]), onClick: () => setPinned([...DEFAULT_BUTTONS]) },
    ], { anchor: o.slot, side: "bottom", align: "end", width: 232 });
  });

  /** @param {string[]} a @param {string[]} b */
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  /** @param {string} id @param {boolean} on */
  const pin = (id, on) => setPinned(on ? [...pinned, id] : pinned.filter((x) => x !== id));
  /** @param {string[]} next */
  function setPinned(next) {
    pinned = buttonsOf(JSON.stringify(next), ids());
    store.set(BUTTONS_KEY, JSON.stringify(pinned));
    paint();
  }

  /** A pane's tooltip: what its press does now, and its key. @param {{ id: string, label: string }} p */
  const tipOf = (p) => (host.whereIs(p.id) === "front" ? `Close ${p.label}` : `Open ${p.label}`);
  /** What goes on in a pane while it is out of sight: its dot's words; "" in sight or at rest. @param {string} id */
  const busyOf = (id) => (host.front().includes(id) ? "" : working.get(id) || "");

  /** A pane's button, made once. @param {{ id: string, label: string, icon: string }} p */
  function buttonOf(p) {
    const had = buttons.get(p.id);
    if (had) return had;
    const b = /** @type {HTMLButtonElement} */ (h("button", { class: "pbtn", type: "button", "data-pane": p.id, onclick: () => host.toggle(p.id) },
      h("span", { class: "pbtn-ic", html: glyphOf(p.icon) }), h("span", { class: "pbtn-label" }, p.label)));
    tooltip(b, { title: () => [tipOf(p), marked.get(p.id), busyOf(p.id)].filter(Boolean).join(" — "), kbd: () => (PANE_KEYS[p.id] ? comboOf(PANE_KEYS[p.id]) : "") });
    buttons.set(p.id, b);
    if (marked.get(p.id)) queueMicrotask(() => mark(p.id, marked.get(p.id) || null));
    return b;
  }

  /** ⋯: the panes without a button — one out of it for its work has one —, Layout, Show or hide panes. */
  function moreMenu() {
    const own = new Set([...pinned, ...outNow()]);
    const rest = host.panes().filter((p) => !own.has(p.id));
    menu([
      ...rest.map((p) => ({
        type: "check", icon: p.icon, tone: p.tone, label: p.label, checked: host.whereIs(p.id) === "front",
        kbd: PANE_KEYS[p.id] ? comboOf(PANE_KEYS[p.id]) : "", onClick: () => host.toggle(p.id),
      })),
      ...(rest.length ? [{ type: "separator" }] : []),
      { label: "Layout", icon: ARRANGE_WORDS[host.arrange].icon, submenu: layoutItems(host) },
      { label: host.shown ? "Hide panes" : "Show panes", icon: "panelRight", kbd: comboOf("pane"), onClick: () => host.setOpen(!host.shown) },
    ], { anchor: more, side: "bottom", align: "end", width: 240 });
  }

  /**
   * The buttons as the panes are now: the pinned ones in order, then those out of ⋯ for their work, each lit while its
   * pane shows in front, a dot breathing on one at work out of sight; Layout where two columns fit.
   */
  function paint() {
    const out = outNow();
    const panes = [...host.panes().filter((p) => pinned.includes(p.id)), ...host.panes().filter((p) => out.includes(p.id))];
    const want = panes.map(buttonOf);
    if (!same(want.map((b) => String(b.dataset.pane)), [...group.children].map((b) => String(/** @type {HTMLElement} */ (b).dataset.pane)))) group.replaceChildren(...want);
    for (const [id, b] of buttons) {
      if (!pinned.includes(id) && !out.includes(id)) { buttons.delete(id); continue; }
      const front = host.whereIs(id) === "front";
      b.classList.toggle("on", front);
      b.classList.toggle("is-out", out.includes(id));
      b.classList.toggle("is-pair", out.length > 1 && out.includes(id));
      b.setAttribute("aria-pressed", front ? "true" : "false");
      busyDot(b, busyOf(id));
    }
    const a = ARRANGE_WORDS[host.arrange];
    layoutBtn.classList.toggle("hidden", host.columns < 2);
    if (layoutWord.textContent !== a.short) {
      layoutWord.textContent = a.short;
      setHtml(layoutIc, glyphOf(a.icon));
    }
  }
  /**
   * A pane's button marked with a dot while something in it waits for you, its words the dot's title; null unmarks it.
   * @param {string} id @param {string | null} words
   */
  function mark(id, words) {
    marked.set(id, words || "");
    const b = buttons.get(id);
    if (!b) return;
    const had = /** @type {HTMLElement | null} */ (b.querySelector(".pbtn-dot"));
    if (!words) { had?.remove(); return; }
    const dot = had || b.appendChild(h("span", { class: "pbtn-dot" }));
    dot.setAttribute("title", words);
    dot.setAttribute("aria-label", words);
  }
  /** A button's dot breathing while work goes on in its pane out of sight, its words the dot's title; "" takes it off. @param {HTMLElement} b @param {string} words */
  function busyDot(b, words) {
    const had = /** @type {HTMLElement | null} */ (b.querySelector(".pbtn-works"));
    if (!words) { had?.remove(); return; }
    const dot = had || b.appendChild(h("span", { class: "pbtn-works" }));
    if (dot.getAttribute("title") === words) return;
    dot.setAttribute("title", words);
    dot.setAttribute("aria-label", words);
  }
  /**
   * A pane at work, its words what goes on there — the plan's tasks running, the agent in the browser (the owner's of
   * 11-10) — or at rest (null): while its pane is out of sight its button shows, out of ⋯ where it has none of its own.
   * Told at every pulse of a turn: the same words move nothing.
   * @param {string} id @param {string | null} words
   */
  function works(id, words) {
    if ((working.get(id) || null) === (words || null)) return;
    if (words) working.set(id, words);
    else working.delete(id);
    paint();
  }
  paint();
  return { paint, mark, works };
}
