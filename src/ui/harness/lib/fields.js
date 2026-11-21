// @ts-check
// The settings pages' own controls, built with the page's `h` so a page runs on the fake DOM (HarnessV4_Settings_Plan
// HS-D4, HC-85): a text field and a text area kept when left or on Enter (Ctrl+Enter in the area, where Enter is a new
// line) and put back by Esc or by a refusal; segmented buttons; a switch. Each takes its look from settings.css.
import { h } from "../../lib/dom.js";

/**
 * A text field kept on Enter or when left; Esc puts it back, and so does a save that answers false.
 * @param {typeof h} m @param {string} value @param {(v: string) => Promise<boolean>} save
 * @param {Record<string, any>} [attrs]  its own attributes; `class` replaces the plain field's
 */
export function keptField(m, value, save, attrs = {}) {
  const f = /** @type {any} */ (m("input", { class: "zc-input", type: "text", value, spellcheck: "false", autocomplete: "off", ...attrs }));
  return keep(f, value, save, (e) => e.key === "Enter");
}

/**
 * A text area kept when left or on Ctrl+Enter; Esc puts it back, and so does a save that answers false.
 * @param {typeof h} m @param {string} value @param {(v: string) => Promise<boolean>} save
 * @param {Record<string, any>} [attrs]
 */
export function keptArea(m, value, save, attrs = {}) {
  const f = /** @type {any} */ (m("textarea", { class: "zc-input set-area", spellcheck: "false", rows: "3", ...attrs }));
  f.value = value;
  return keep(f, value, save, (e) => e.key === "Enter" && (e.ctrlKey || e.metaKey));
}

/**
 * The keeping, for either: what was kept last is what Esc and a refusal put back. A value on its way is not sent again:
 * a page drawn again after a save takes the field away, and the blur that follows would send it twice.
 * @param {any} f @param {string} value @param {(v: string) => Promise<boolean>} save @param {(e: KeyboardEvent) => boolean} commits
 */
function keep(f, value, save, commits) {
  let was = value;
  /** @type {string | null} */
  let sending = null;
  const commit = async () => {
    const v = String(f.value || "").trim();
    if (v === was.trim() || v === sending) return;
    sending = v;
    try {
      if (await save(v)) was = v;
      else f.value = was;
    } finally {
      sending = null;
    }
  };
  f.onkeydown = (/** @type {KeyboardEvent} */ e) => {
    if (commits(e)) { e.preventDefault(); void commit(); }
    else if (e.key === "Escape") { e.preventDefault(); f.value = was; }
  };
  f.onblur = () => void commit();
  return f;
}

/**
 * Segmented buttons, the chosen one lit.
 * @param {typeof h} m @param {readonly { value: string, label: string, title?: string }[]} options @param {string} value
 * @param {(v: string) => void} onChange @param {string} label  what the group chooses, for a screen reader
 */
export function segment(m, options, value, onChange, label) {
  return m("div", { class: "set-seg", role: "tablist", "aria-label": label },
    ...options.map((op) =>
      m("button", { class: `set-seg-btn${op.value === value ? " on" : ""}`, type: "button", role: "tab", "aria-selected": op.value === value ? "true" : "false", ...(op.title ? { title: op.title } : {}), onclick: () => onChange(op.value) }, op.label)));
}

/**
 * A switch: on or off, its click the caller's.
 * @param {typeof h} m @param {boolean} on @param {string} label @param {() => void} onClick
 */
export function toggle(m, on, label, onClick) {
  return m("button", { class: `set-switch${on ? " on" : ""}`, type: "button", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": label, onclick: onClick });
}
