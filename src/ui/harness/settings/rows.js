// @ts-check
// The settings rows' control primitives (AgentPlanUX §5.10): switch, select, number input, segmented
// tabs, trust pill. Everything is built with h() and styled in settings.css. The pure helper at the
// bottom (the usage range) deliberately imports nothing browser-side.
import { h } from "../../lib/dom.js";

/**
 * A settings row: label and description left, control right. `h`: the builder (a page built on an injected one, the
 * Memory section, passes it). @param {string} label @param {string} desc @param {HTMLElement} control
 * @param {{ wide?: boolean, h?: typeof h }} [o]
 */
export function row(label, desc, control, o = {}) {
  const mk = o.h || h;
  return mk("div", { class: "settings-row" },
    mk("div", { class: "settings-row-text" },
      mk("div", { class: "settings-row-label" }, label),
      desc ? mk("div", { class: "settings-row-desc" }, desc) : null),
    o.wide ? control : mk("div", { class: "shrink-0" }, control));
}

/** A group's `_doc` sentence between the rows. @param {string} doc */
export function groupDoc(doc) {
  return h("p", { class: "set-group-doc" }, doc);
}

/**
 * Switch: h-5 w-9 rounded-full. @param {{ checked: boolean, disabled?: boolean, onChange: (on: boolean) => void,
 * label?: string }} o
 */
export function switchControl(o) {
  const b = h("button", {
    class: `set-switch${o.checked ? " on" : ""}`,
    type: "button",
    role: "switch",
    "aria-checked": o.checked ? "true" : "false",
    "aria-label": o.label || "",
    ...(o.disabled ? { disabled: "" } : {}),
  });
  b.addEventListener("click", () => {
    const on = !b.classList.contains("on");
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
    o.onChange(on);
  });
  return b;
}

/**
 * Select: h-7 rounded-md. options: { value, label }. @param {{ value: string, options: { value: string, label: string }[],
 * disabled?: boolean, onChange: (v: string) => void, label?: string }} o
 */
export function selectControl(o) {
  const s = h("select", { class: "set-select", "aria-label": o.label || "", ...(o.disabled ? { disabled: "" } : {}) },
    ...o.options.map((op) => h("option", { value: op.value, ...(op.value === o.value ? { selected: "" } : {}) }, op.label)));
  s.addEventListener("change", () => o.onChange(s.value));
  return s;
}

/**
 * The FontSizeInput: a w-28 number input; commits on blur and Enter, Esc restores the value it opened with,
 * anything out of range restores the last committed value. @param {{ value: number, min?: number, max?: number,
 * step?: number, onCommit: (n: number) => void, label?: string }} o
 */
export function numberControl(o) {
  const min = o.min ?? 0;
  const max = o.max ?? Number.MAX_SAFE_INTEGER;
  const step = o.step ?? 1;
  const fence = (n) => Math.max(min, Math.min(max, n));
  const input = /** @type {HTMLInputElement} */ (h("input", {
    class: "set-num", type: "number", min: String(min), max: String(max), step: String(step),
    value: String(o.value), "aria-label": o.label || "",
  }));
  let committed = o.value;
  const restore = () => { input.value = String(committed); };
  const commit = () => {
    const n = Number(input.value);
    if (input.value === "" || !Number.isFinite(n)) { restore(); return; }
    committed = fence(n);
    input.value = String(committed);
    o.onCommit(committed);
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); restore(); input.blur(); }
  });
  return input;
}

/**
 * Segmented tabs (settings): h-8 rounded-lg list, sized to its content. @param {{ value: string,
 * options: { value: string, label: string }[], onChange: (v: string) => void }} o
 * @returns {{ el: HTMLElement, set: (v: string) => void }}
 */
export function segmented(o) {
  /** @type {Map<string, HTMLElement>} */
  const btns = new Map();
  const el = h("div", { class: "set-seg", role: "tablist" });
  const paint = (v) => {
    for (const [id, b] of btns) {
      b.classList.toggle("on", id === v);
      b.setAttribute("aria-selected", id === v ? "true" : "false");
    }
  };
  for (const op of o.options) {
    const b = h("button", { class: "set-seg-btn", type: "button", role: "tab" }, op.label);
    b.addEventListener("click", () => { o.onChange(op.value); paint(op.value); });
    btns.set(op.value, b);
    el.append(b);
  }
  paint(o.value);
  return { el, set: paint };
}

/** A trust pill: unproven / proven / deprecated. @param {string} trust */
export function trustPill(trust) {
  const t = ["unproven", "proven", "deprecated"].includes(trust) ? trust : "unproven";
  return h("span", { class: `set-pill ${t}` }, t);
}

/**
 * The usage days inside a range: a day string `YYYY-MM-DD` at or after the cutoff (no cutoff for all
 * time). Pure, so the range picker's arithmetic is testable without the page.
 * @param {Record<string, any>[]} days @param {number} daysBack @param {number} now
 */
export function daysInRange(days, daysBack, now) {
  if (!daysBack) return days;
  const cutoff = new Date(now - (daysBack - 1) * 86400_000).toISOString().slice(0, 10);
  return days.filter((d) => d.day >= cutoff);
}
