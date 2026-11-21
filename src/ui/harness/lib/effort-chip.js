// @ts-check
// How hard an agent thinks on the model beside it (the owner's word of 11-05: "include reasoning effort across every
// model picker"): the composer's own pattern — a model chip, and beside it this chip, its level in words — the default's
// quieter. Its menu: the default first, what the agent inherits and why; "The model's own" where the row may name it;
// then the levels the model beside it takes — every agent level where the catalogue does not know that model ("" the
// main agent's), none where it takes none. A level picked that the model does not take stays offered, said as what the
// server does with it. The pick is the caller's to keep: "" the default.
import { h } from "../../lib/dom.js";
import { ICONS } from "./icons.js";
import { menu as openMenu } from "./ui.js";
import { AGENT_LEVELS, LEVEL_ORDER, levelsIn } from "./families.js";
import { effortName } from "./side.js";

/** What a level the model beside it does not take comes to, as the server fits it. */
export const FITS_BELOW = "A model that takes fewer levels thinks at its highest below this one";

/**
 * What it thinks at where none is picked: a level, or `words` where no one level is known — "The main agent's" in
 * Library, which no chat's main agent stands behind — and why.
 * @typedef {{ level: string, desc: string, words?: string }} Inherit
 */
/** The default's words: its own, else its level's. @param {Inherit} i */
const inheritWords = (i) => i.words || effortName(i.level);

/**
 * The choices the chip's menu offers, in order (DOM-free): the default, "The model's own" where `own`, then the levels.
 * @param {{ level: string, levels: readonly string[] | null, inherit: Inherit, own: boolean }} o
 *   `level`: the one picked ("" the default); `levels`: those the model takes — null where the catalogue does not know
 *   it, [] where it takes none
 * @returns {{ id: string, name: string, desc: string, on: boolean }[]}
 */
export function chipChoices({ level, levels, inherit, own }) {
  const offered = levels ?? [...AGENT_LEVELS];
  const extra = level && level !== "model" && !offered.includes(level) ? [level] : [];
  const shown = [...offered, ...extra].sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));
  return [
    { id: "", name: `The default: ${inheritWords(inherit)}`, desc: inherit.desc, on: !level },
    ...(own && (levels === null || levels.length) ? [{ id: "model", name: effortName("model"), desc: "The level its model takes by itself", on: level === "model" }] : []),
    ...shown.map((id) => ({ id, name: effortName(id), desc: extra.includes(id) ? (levels?.length ? FITS_BELOW : "This model takes no effort setting") : "", on: level === id })),
  ];
}

/**
 * The chip. `model`: the model beside it, read at each open — "" the main agent's; `families`: the catalogue's;
 * `inherit`: what it thinks at where none is picked, and why ("The main agent's effort"); `own`: "The model's own"
 * offered; `onChange`: each pick, "" the default.
 * @param {{ label: string, value?: string, onChange: (level: string) => void, model: () => string, families: () => readonly any[],
 *   inherit: () => Inherit, own?: boolean, mk?: typeof h, menu?: typeof openMenu }} o
 * @returns {{ el: HTMLElement, value: () => string, set: (level: string) => void, paint: () => void }}
 */
export function effortChip({ label, value = "", onChange, model, families, inherit, own = true, mk = h, menu = openMenu }) {
  let level = String(value || "");
  const words = mk("span", { class: "ec-words" });
  const el = mk("button", { class: "ec", type: "button", title: label, "aria-label": label, "aria-haspopup": "menu", onclick: () => open() },
    mk("span", { class: "ec-ic", html: ICONS.gauge }), words, mk("span", { class: "ec-caret", html: ICONS.chevronDown }));
  const paint = () => {
    words.textContent = level ? effortName(level) : inheritWords(inherit());
    el.classList.toggle("is-default", !level);
    // The level picked, said with its name: a screen reader reads the title as the chip's description (the review of
    // 5ff8bcb56 — the <select>s it replaced said their value).
    el.setAttribute("title", `${label}: ${words.textContent}`);
  };
  /** @param {string} id */
  const choose = (id) => {
    level = id;
    paint();
    onChange(id);
  };
  const open = () => {
    const levels = levelsIn(families(), model());
    const choices = chipChoices({ level, levels, inherit: inherit(), own });
    menu([
      { type: "label", label },
      ...choices.map((c) => ({ type: "radio", label: c.name, ...(c.desc ? { desc: c.desc } : {}), checked: c.on, onClick: () => choose(c.id) })),
      { type: "separator" },
      { type: "label", label: levels && !levels.length ? "This model takes no effort setting: it thinks as it does" : FITS_BELOW },
    ], { anchor: el, width: 320 });
  };
  paint();
  return {
    el,
    value: () => level,
    /** The level shown, from what is kept ("" the default): told to no one. @param {string} l */
    set(l) {
      level = String(l || "");
      paint();
    },
    paint,
  };
}
