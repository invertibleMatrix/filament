// @ts-check
// The tuning control (HarnessV3 §15 item 92; AgentPlanUX §5.7): the chip beside the model and the model's whole
// tuning in one popover, the way Cursor's model panel shows it. The chip's face is the reasoning meter — as many bars
// as the model has levels, lit up to the one in force — with a bolt while fast mode is on and the window when it is not
// the standard one. The popover holds only what this model offers: Reasoning as a meter of its levels (Auto first),
// Extended thinking where the wire takes it (the levels it unlocks are marked, and picking one turns it on), Speed
// where the model has fast mode, the Context window where it offers more than one. A choice writes at once through
// the composer — a family of variant ids moves the model name, a model Filament tunes moves its settings (lib/families.js
// `planWrite`) — and the popover stays open while you tune. The chip hides for a model with nothing to tune. The
// person's own choice persists (`filament.harness.lastEffort`, `harness.lastTuning`) and seeds only a new chat (D6).
import { h, morphChildren, standing } from "../../lib/dom.js";
import { store } from "../../lib/store.js";
import { ICONS } from "../lib/icons.js";
import { popover } from "../lib/ui.js";
import { LEVELS as WORDS, levelWords, familyName, vendorOf, windowWords, tuningFace, speedCaption, windowAgainst, priceLine, needsThinking, locate } from "../lib/families.js";
import { modelTile } from "./model.js";

const KEY = "harness.lastEffort";
const TUNING_KEY = "harness.lastTuning";
export const LEVELS = [
  { id: "", label: "Default", bars: 0 },
  { id: "low", label: "Low", bars: 1 },
  { id: "medium", label: "Medium", bars: 2 },
  { id: "high", label: "High", bars: 3 },
  { id: "xhigh", label: "Extra high", bars: 4 },
  { id: "max", label: "Max", bars: 5 },
];

/**
 * A stored model name that ends in an effort level (`model-high`, as `/set model.name` may hold it): its base and
 * level, or null. A trailing level is a lane only when the catalogue doesn't know the name
 * whole without knowing its base — `qwen-max` is a model whose id merely ends like one — and never when a family
 * holds the name as one of its own ids (a provider's `qwen3-max` beside its `qwen3`, Cursor's `grok-4.7-high`).
 * @param {string} name @param {(id: string) => boolean} known  whether the model catalogue has this id
 * @param {import("../lib/families.js").Family[]} [families]  the catalogue's families, once the page has them
 * @returns {{ base: string, effort: string } | null}
 */
export function splitEffortLane(name, known, families = []) {
  const at = families.length ? locate(families, name) : null;
  if (at && !Object.keys(at.fromName).length) return null;
  const level = LEVELS.find((l) => l.id && String(name).toLowerCase().endsWith(`-${l.id}`));
  if (!level) return null;
  const base = String(name).slice(0, -(level.id.length + 1));
  return base && !(known(name) && !known(base)) ? { base, effort: level.id } : null;
}

/** @typedef {import("../lib/families.js").Tuning} Tuning */
/** @typedef {import("../lib/families.js").Family} Family */

/** The person's last tuning — what a new chat starts from: the effort under `KEY`, the rest under `TUNING_KEY`. @returns {Tuning} */
export function lastTuning() {
  const effort = String(store.get(KEY) || "");
  /** @type {any} */
  let rest = {};
  try { rest = JSON.parse(String(store.get(TUNING_KEY) || "{}")) || {}; } catch {}
  return {
    effort: effort && effort in WORDS ? effort : null,
    speed: rest.speed === "fast" || rest.speed === "flex" ? rest.speed : "standard",
    thinking: rest.thinking === "on" ? "on" : "off",
    window: Number(rest.window) || 0,
  };
}
/** @param {Tuning} t */
const remember = (t) => {
  store.set(KEY, t.effort || "");
  store.set(TUNING_KEY, JSON.stringify({ speed: t.speed, thinking: t.thinking, window: t.window || 0 }));
};
/**
 * The effort a new chat starts from, chosen apart from a chat (the welcome tour's Default model): the rest of the last
 * tuning stays, but for `thinkingOn` — a level that runs capped without extended thinking turns it on, as the
 * composer's pick does. "" is the model's own. @param {string} level @param {boolean} [thinkingOn]
 */
export const rememberEffort = (level, thinkingOn = false) =>
  remember({ ...lastTuning(), effort: level && level in WORDS ? level : null, ...(thinkingOn ? { thinking: /** @type {const} */ ("on") } : {}) });

/** What each level means, under the meter. */
const CAPTIONS = /** @type {Record<string, string>} */ ({
  none: "Answers straight away, without reasoning first.",
  minimal: "The lightest reasoning: the quickest replies.",
  low: "Quick reasoning: fast and inexpensive.",
  medium: "Balanced reasoning for everyday work.",
  high: "Deep reasoning for hard problems.",
  xhigh: "Extended reasoning for the hardest problems.",
  max: "Reasons as long as it needs: the slowest and most thorough.",
});
const SPEED_WORDS = /** @type {Record<string, string>} */ ({ standard: "Standard", fast: "Fast", flex: "Flex" });

/**
 * The chip's meter: one bar per level the model takes, rising left to right, lit up to the one in force. Drawn around
 * the box's middle so its mass sits on the label's optical centre.
 * @param {number} lit @param {number} of
 */
const meterGlyph = (lit, of) => {
  const n = Math.max(2, Math.min(7, of || 5));
  const gap = n > 5 ? 1 : 1.5, span = 13, w = (span - gap * (n - 1)) / n;
  let bars = "";
  for (let i = 0; i < n; i++) {
    const hgt = 4 + (8 * (i + 1)) / n;
    const x = 1.5 + i * (w + gap);
    bars += `<rect x="${x.toFixed(2)}" y="${(13.5 - hgt).toFixed(2)}" width="${w.toFixed(2)}" height="${hgt.toFixed(2)}" rx="${Math.min(1, w / 2).toFixed(2)}" fill="currentColor" opacity="${i < lit ? 1 : 0.3}"/>`;
  }
  return `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">${bars}</svg>`;
};

/** The popover's foot: where the level in force comes from, in words. @param {string | null} note */
const footWords = (note) => (!note ? "This session" : note === "the new chat" ? "Held for the new chat" : /^from /i.test(note) ? `F${note.slice(1)}` : `From ${note}`);


/**
 * A segmented control in the Instruments look whose buttons may carry a glyph. Arrow keys move the choice.
 * @param {{ options: { id: string, label: string, icon?: string, title?: string }[], value: string, ariaLabel: string, onChange: (id: string) => void }} o
 */
function seg(o) {
  const at = o.options.findIndex((x) => x.id === o.value);
  return h("div", {
    class: "inst-seg tp-seg", role: "radiogroup", "aria-label": o.ariaLabel,
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step || !o.options.length) return;
      e.preventDefault();
      e.stopPropagation();
      o.onChange(o.options[(Math.max(0, at) + step + o.options.length) % o.options.length].id);
    },
  }, ...o.options.map((x, i) => h("button", {
    class: `inst-seg-btn${i === at ? " is-on" : ""}`, type: "button", role: "radio",
    "aria-checked": i === at ? "true" : "false", tabindex: i === at || (at < 0 && i === 0) ? "0" : "-1",
    ...(x.title ? { title: x.title } : {}),
    onclick: () => o.onChange(x.id),
  }, x.icon ? h("span", { class: "tp-seg-ic", html: /** @type {any} */ (ICONS)[x.icon] || "" }) : null, x.label)));
}

/**
 * @param {{ onTune?: (want: Tuning, changed: keyof Tuning) => void, onReset?: () => void }} [cb]
 * @param {{ keeps?: boolean, foot?: boolean, named?: string, side?: "top" | "bottom", align?: "start" | "end" }} [o]
 *   `keeps` false: a level chosen for something other than a new chat (a Space's agents, a routine — space/model-row.js),
 *   so the person's last tuning is neither read nor written; `foot` false: no foot, where Auto says the model's own;
 *   `named`: the chip's words for a screen reader; `side`, `align`: where its popover opens
 * @returns {{ el: HTMLElement, value: () => string, tuning: () => Tuning, family: () => Family | null, set: (v: string) => void,
 *   setFamily: (f: Family | null, t: Tuning | null) => void, setNote: (note: string | null) => void, open: () => void,
 *   pick: (key: "effort" | "window", value: string | number | null) => boolean }}
 */
export function createEffortControl(cb = {}, o = {}) {
  /** @type {Family | null} */
  let family = null;
  /** @type {Tuning} */
  let tuning = o.keeps === false ? { effort: null, speed: "standard", thinking: "off", window: 0 } : lastTuning();
  /** The tuning kept as what a new chat starts from, unless it is chosen for something else. @param {Tuning} t */
  const keep = (t) => void (o.keeps !== false && remember(t));
  /** @type {string | null} */
  let note = null;
  /** @type {{ d: { el: HTMLElement, close: () => void }, draw: () => void } | null} */
  let pop = null;
  /** The level the pointer rests on in the open meter (-1 Auto), lit ahead of a press: kept across a draw, which the
   *  chat's view may bring while it rests there. @type {number | null} */
  let previewAt = null;

  const glyphEl = h("span", { class: "effort-glyph tune-glyph" });
  const labelEl = h("span", { class: "effort-label tune-label" });
  const badges = h("span", { class: "tune-badges" });
  const btn = h("button", { class: "effort-btn tune-chip", type: "button", title: "Tune the model", "aria-label": o.named || "Tune the model: reasoning, speed and context window", "aria-haspopup": "dialog" },
    glyphEl, labelEl, badges);
  const el = h("span", { class: "effort" }, btn);

  // Painted at every view of the chat: the chip's parts drawn in place, the elements under a resting pointer the ones
  // that stood (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
  const paint = () => {
    const face = tuningFace(family, tuning);
    el.classList.toggle("hidden", !face.show);
    morphChildren(glyphEl, [h("span", { class: "tune-glyph-art", html: family?.effort ? meterGlyph(face.lit, face.of) : family?.speed ? ICONS.zap : family?.window ? ICONS.maximize2 : ICONS.sparkles })]);
    labelEl.textContent = face.label;
    morphChildren(badges, [
      face.fast && family?.effort ? h("span", { class: "tune-badge is-fast", "data-key": "fast", title: "Fast mode", html: ICONS.zap }) : null,
      face.thinking && family?.thinking?.via === "setting" ? h("span", { class: "tune-badge is-think", "data-key": "think", title: "Extended thinking", html: ICONS.sparkles }) : null,
      face.window && family?.effort ? h("span", { class: "tune-badge is-window", "data-key": "window", title: `${face.window} context window` }, face.window) : null,
    ]);
    btn.classList.toggle("is-fast", face.fast);
    btn.classList.toggle("is-auto", !!family?.effort && !tuning.effort);
    const words = [face.label && family?.effort ? `Reasoning: ${face.label}` : "", face.fast ? "Fast mode" : "", face.thinking ? "Extended thinking" : "", face.window ? `${face.window} window` : ""].filter(Boolean);
    btn.title = [words.join(" · ") || "Tune the model", note ? `(${note})` : ""].filter(Boolean).join(" ");
  };

  /** @param {Tuning} want @param {keyof Tuning} changed */
  const tune = (want, changed) => {
    tuning = { ...want };
    keep(tuning);
    note = null;
    paint();
    pop?.draw();
    cb.onTune?.(tuning, changed);
  };

  /** Pick a level: a level that runs capped without thinking turns thinking on with it. @param {string | null} level */
  const pickLevel = (level) => {
    const want = { ...tuning, effort: level };
    if (level && tuning.thinking !== "on" && needsThinking(family, level)) want.thinking = "on";
    tune(want, "effort");
  };

  /** The meter's words for a level (or Auto). @param {string | null} level */
  const captionFor = (level) => {
    const f = family;
    if (!level) return f?.effort?.default ? `The model decides how hard to think: its own default is ${levelWords(f.effort.default)}.` : "The model decides how hard to think.";
    const base = CAPTIONS[level] || levelWords(level);
    if (tuning.thinking !== "on" && needsThinking(f, level)) return `${base} Needs extended thinking: choosing it turns thinking on.`;
    return base;
  };

  const effortSection = () => {
    const f = /** @type {Family} */ (family);
    const levels = /** @type {string[]} */ (f.effort.levels || []);
    const autoOk = f.effort.via === "setting" || !!f.effort.plain;
    const at = tuning.effort ? levels.indexOf(tuning.effort) : -1;
    /** The level a caption says: the one the pointer rests on, or the one in force. @param {number | null} i */
    const said = (i) => (i === null ? tuning.effort : i < 0 ? null : levels[i]);
    const lit = previewAt !== null && previewAt < levels.length ? previewAt : null;
    const caption = h("p", { class: "tp-caption" }, captionFor(said(lit)));
    /** @type {HTMLElement[]} */
    const levelEls = [];
    // The popover is drawn in place: the levels and the caption on the page are the ones this draw stands for.
    const preview = (/** @type {number | null} */ i) => {
      previewAt = i;
      levelEls.forEach((b, k) => standing(b).classList.toggle("is-preview", i !== null && k <= i));
      standing(caption).textContent = captionFor(said(i));
    };
    const auto = autoOk ? h("button", {
      class: `tp-auto${at < 0 ? " is-on" : ""}`, type: "button", role: "radio", "aria-checked": at < 0 ? "true" : "false", tabindex: at < 0 ? "0" : "-1",
      title: "Let the model decide", onclick: () => pickLevel(null),
      onpointerenter: () => preview(-1), onpointerleave: () => preview(null),
    }, h("span", { class: "tp-auto-ic", html: ICONS.sparkles }), h("span", { class: "tp-level-name" }, "Auto")) : null;
    levels.forEach((l, i) => {
      const capped = tuning.thinking !== "on" && needsThinking(f, l);
      levelEls.push(h("button", {
        class: `tp-level${at >= 0 && i <= at ? " is-lit" : ""}${i === at ? " is-on" : ""}${capped ? " is-capped" : ""}${lit !== null && i <= lit ? " is-preview" : ""}`,
        type: "button", role: "radio", "aria-checked": i === at ? "true" : "false", tabindex: i === at ? "0" : "-1",
        style: `--k:${((i + 1) / levels.length).toFixed(3)}`,
        title: `${levelWords(l)}${capped ? " — needs extended thinking" : ""}`,
        "aria-label": `${levelWords(l)}${capped ? ", needs extended thinking" : ""}`,
        onclick: () => pickLevel(l),
        onpointerenter: () => preview(i), onpointerleave: () => preview(null),
      }, h("span", { class: "tp-bar" }, capped ? h("span", { class: "tp-bar-mark", html: ICONS.sparkles }) : null), h("span", { class: "tp-level-name" }, /** @type {any} */ (WORDS)[l]?.short || l)));
    });
    // ←/→ walk Auto and the levels; the focus follows the choice.
    const order = [...(autoOk ? [null] : []), ...levels];
    const meter = h("div", {
      class: "tp-meter", role: "radiogroup", "aria-label": "Reasoning effort",
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        const now = order.indexOf(tuning.effort);
        const next = order[Math.min(order.length - 1, Math.max(0, (now < 0 ? 0 : now) + step))];
        if (next !== tuning.effort) pickLevel(next ?? null);
      },
    }, auto, h("div", { class: "tp-levels", style: `--n:${levels.length}` }, ...levelEls));
    return h("div", { class: "inst-section tp-section", "data-key": "effort" },
      h("div", { class: "tp-section-head" }, h("span", { class: "inst-section-title" }, "Reasoning"), h("span", { class: "tp-section-value" }, levelWords(tuning.effort))),
      meter, caption);
  };

  const thinkingSection = () => {
    const f = /** @type {Family} */ (family);
    const on = tuning.thinking === "on";
    const cap = f.effort?.capWithoutThinking;
    const above = (f.effort?.levels || []).filter((/** @type {string} */ l) => needsThinking(f, l)).map((/** @type {string} */ l) => levelWords(l));
    const sub = above.length ? `${above.join(" and ")} need${above.length === 1 ? "s" : ""} it` : "Reasons step by step before it answers";
    /** @param {boolean} next */
    const set = (next) => {
      const want = { ...tuning, thinking: next ? "on" : "off" };
      // Off with a level it caps: the wire would send the cap anyway, so the meter says the level that runs.
      if (!next && cap && needsThinking(f, tuning.effort)) want.effort = cap;
      tune(want, "thinking");
    };
    if (f.thinking.via === "name") {
      return h("div", { class: "inst-section tp-section", "data-key": "thinking" },
        h("div", { class: "tp-section-head" }, h("span", { class: "inst-section-title" }, "Thinking")),
        seg({ options: [{ id: "off", label: "Off" }, { id: "on", label: "On", icon: "sparkles" }], value: tuning.thinking, ariaLabel: "Thinking", onChange: (id) => set(id === "on") }));
    }
    const input = h("input", { class: "ios-switch", type: "checkbox", role: "switch", "aria-label": "Extended thinking", onchange: (/** @type {Event} */ e) => set(!!(/** @type {HTMLInputElement} */ (e.target)).checked) });
    /** @type {HTMLInputElement} */ (input).checked = on;
    return h("div", { class: "inst-group", "data-key": "thinking" },
      h("label", { class: "inst-row has-ic tp-think-row" },
        h("span", { class: "inst-row-ic", style: "background:var(--color-sys-purple)", html: ICONS.sparkles }),
        h("span", { class: "inst-row-text" }, h("span", { class: "inst-row-label" }, "Extended thinking"), h("span", { class: "inst-row-sub" }, sub)),
        input));
  };

  const speedSection = () => {
    const f = /** @type {Family} */ (family);
    const opts = /** @type {string[]} */ (f.speed.options || []);
    const caption = speedCaption(f, tuning.speed);
    return h("div", { class: "inst-section tp-section", "data-key": "speed" },
      h("div", { class: "tp-section-head" }, h("span", { class: "inst-section-title" }, "Speed")),
      seg({ options: opts.map((id) => ({ id, label: SPEED_WORDS[id] || id, ...(id === "fast" ? { icon: "zap" } : {}) })), value: tuning.speed, ariaLabel: "Speed", onChange: (id) => tune({ ...tuning, speed: id }, "speed") }),
      h("p", { class: "tp-caption" }, caption));
  };

  const windowSection = () => {
    const f = /** @type {Family} */ (family);
    const std = Number(f.window.standard) || 0;
    const opts = /** @type {number[]} */ (f.window.options || []);
    const now = tuning.window || (f.window.via === "setting" ? std : 0);
    const shown = now || std;
    // What a window sold as a name of its own costs against the family's cheapest (Kimi's 1M at 2×): said beside it.
    const x = (/** @type {number} */ n) => Number(f.window.multipliers?.[String(n)]) || 0;
    const against = windowAgainst(f);
    const dearer = x(now) > 1 ? ` It costs ${x(now)}× ${against}.` : "";
    const caption = !shown ? "" : (shown > std && std ? `Room to ${windowWords(shown)} tokens before the session compacts.` : `The standard window: the session compacts as it nears ${windowWords(shown)} tokens.`) + dearer;
    return h("div", { class: "inst-section tp-section", "data-key": "window" },
      h("div", { class: "tp-section-head" }, h("span", { class: "inst-section-title" }, "Context window")),
      seg({
        options: opts.map((n) => ({
          id: String(n),
          label: `${n ? windowWords(n) : std ? windowWords(std) : "Standard"}${x(n) > 1 ? ` · ${x(n)}×` : ""}`,
          title: `${n && n !== std ? `${n.toLocaleString("en-US")} tokens` : "The standard window"}${x(n) > 1 ? `, costing ${x(n)}× ${against}` : ""}`,
        })),
        value: String(now), ariaLabel: "Context window",
        onChange: (id) => tune({ ...tuning, window: Number(id) === std && f.window.via === "setting" ? 0 : Number(id) }, "window"),
      }),
      caption ? h("p", { class: "tp-caption" }, caption) : null);
  };

  const content = () => {
    const f = /** @type {Family} */ (family);
    const v = vendorOf(f.id);
    const price = priceLine(f);
    return [
      h("div", { class: "inst-head", "data-key": "head" }, modelTile(f.id),
        h("div", { class: "inst-head-text" }, h("div", { class: "inst-title" }, familyName(f)), h("div", { class: "inst-sub" }, [v.name, price].filter(Boolean).join(" · ") || f.upstream))),
      f.effort ? effortSection() : null,
      f.thinking ? thinkingSection() : null,
      f.speed ? speedSection() : null,
      f.window ? windowSection() : null,
      o.foot === false ? null : h("div", { class: "tp-foot", "data-key": "foot" },
        h("span", { class: "tp-foot-note", title: "Where the reasoning level in force comes from" }, footWords(note)),
        h("button", {
          class: "tp-reset", type: "button", title: "Unset this session's own tuning: your project or global settings apply again",
          onclick: () => { tuning = { effort: null, speed: "standard", thinking: "off", window: 0 }; keep(tuning); paint(); pop?.draw(); cb.onReset?.(); },
        }, h("span", { class: "tp-reset-ic", html: ICONS.rotateCcw }), "Use the defaults")),
    ].filter(Boolean);
  };

  const open = () => {
    if (!family || !tuningFace(family, tuning).show) return;
    const box = h("div", { class: "inst tp" });
    previewAt = null;
    // Drawn again at each view of the chat while it shows, and at each choice: in place, the meter's levels and the
    // choices the elements that stood under the pointer; the focus follows a choice the arrow keys moved.
    const draw = () => {
      const had = /** @type {HTMLElement | null} */ (document.activeElement);
      const refocus = had && box.contains(had) ? had.closest(".tp-meter") ? ".tp-meter [aria-checked='true']" : had.closest(".tp-seg") ? `.tp-seg[aria-label='${had.closest(".tp-seg")?.getAttribute("aria-label")}'] [aria-checked='true']` : null : null;
      morphChildren(box, content());
      if (refocus) /** @type {HTMLElement | null} */ (box.querySelector(refocus))?.focus();
    };
    draw();
    const d = popover(btn, box, { side: o.side || "top", align: o.align || "end", width: 340, label: "Tune the model" });
    if (!d.el.isConnected) { pop = null; return; } // the second click on the chip closed it
    d.el.classList.add("aq-pop", "is-tuning");
    pop = { d, draw };
    /** @type {HTMLElement | null} */ (box.querySelector(".tp-meter [aria-checked='true'], .tp-seg [aria-checked='true'], button"))?.focus();
  };
  btn.onclick = (e) => { e.stopPropagation(); open(); };
  paint();

  return {
    el,
    value: () => tuning.effort || "",
    tuning: () => ({ ...tuning }),
    family: () => family,
    /** The session view's effort in force — painted, never written to the preference (D6). @param {string} v */
    set: (v) => { const id = String(v || "").replace(/^-/, ""); tuning = { ...tuning, effort: id && id in WORDS ? id : null }; paint(); if (pop?.d.el.isConnected) pop.draw(); },
    /** The model the tuning is about and the tuning in force (the session's, or the held one for a new chat). */
    setFamily: (f, t) => {
      family = f;
      if (t) tuning = { ...t };
      paint();
      // An open popover redraws for the model in force; with none (or nothing left to tune) it has nothing to show
      // and closes — a chat switched to by keyboard while it was open lands here with no family.
      if (pop?.d.el.isConnected && family && tuningFace(family, tuning).show) pop.draw();
      else { if (pop?.d.el.isConnected) pop.d.close(); pop = null; }
    },
    /** Whose tuning the control is showing (the session's, "from the model name"), for its title. */
    setNote: (n) => { note = n || null; paint(); },
    open,
    /**
     * A choice made from Ctrl+K (the design pass of 10-24, UX7), as the popover makes it: a reasoning level (null for
     * Auto) or a window, one of the family's options. False where this model has no such choice.
     * @param {"effort" | "window"} key @param {string | number | null} value
     */
    pick: (key, value) => {
      const f = family;
      if (key === "effort") {
        if (!f?.effort) return false;
        const ok = value === null ? f.effort.via === "setting" || !!f.effort.plain : (f.effort.levels || []).includes(String(value));
        if (ok) pickLevel(value === null ? null : String(value));
        return ok;
      }
      const n = Number(value);
      if (!f?.window || !(f.window.options || []).includes(n)) return false;
      const std = Number(f.window.standard) || 0;
      tune({ ...tuning, window: n === std && f.window.via === "setting" ? 0 : n }, "window");
      return true;
    },
  };
}
