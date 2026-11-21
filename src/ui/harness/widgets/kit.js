// @ts-check
// The instrument kit (HarnessV3 Step 6 design, "Instruments"): the parts every widget popover is drawn with — the
// header with its System-Settings tile, the hero figure, the SVG ring and donut, the stacked bar, the per-turn bar
// strip, inset grouped rows, and the system control set (segmented, switch, slider). The look lives in
// harness/instruments.css under `inst-*`; each widget sets its accent through its class (`--accent`). Charts are SVG strings built from
// numbers and color tokens only (the `html` attribute), so nothing a user typed ever reaches markup. Every builder
// takes the host's `h`, so the tests draw them on the fake DOM.
import { h, morphChildren, standing } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";

/** @typedef {typeof h} Mk */

// ---- figures ------------------------------------------------------------------------------------------------

/** Tokens, chip-sized: 830, 12.4K, 1.2M. @param {number} n */
export function tok(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 1_000_000) return `${(v / 1e6).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(v));
}

/** Dollars: cents from a dime up, more places below it (a single request is often a fraction of a cent), a trailing
 *  zero past the cents dropped ($0.080 reads $0.08). @param {number} v */
export function usd(v) {
  const n = Number(v) || 0;
  if (n === 0) return "$0.00";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 0.1) return `${sign}$${a.toFixed(2)}`;
  if (a < 0.0001) return `${sign}<$0.0001`;
  const s = a >= 0.01 ? a.toFixed(3) : a.toFixed(4);
  return `${sign}$${s.replace(/(\.\d\d\d*?)0+$/, "$1")}`;
}

/** A share as a whole percent, "<1%" for a sliver that is not nothing. @param {number} part @param {number} whole */
export function pct(part, whole) {
  if (!(whole > 0)) return "–";
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/** A span of time in a few words: "40 s", "12 min", "2 h 10 min". @param {number} ms */
export function spanWords(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** Minutes and seconds left, "4:05"; an hour or more as "1h 02m". @param {number} ms */
export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How long ago, in the words a clock would use. @param {number} at @param {number} [now] */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Number(at)) / 1000));
  if (s < 45) return "just now";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(s / 3600);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// ---- SVG ----------------------------------------------------------------------------------------------------

const round = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/**
 * A ring or a donut as SVG markup: the parts are fractions of the whole circle laid clockwise from the top, each with
 * round caps and a small gap between neighbours (a single part has none); the track shows through where nothing is
 * drawn. `notch` marks one fraction on the ring (the compaction line) with a short radial tick. `draw` animates the
 * arcs in (the first paint of an open popover only — a repaint must not replay it). Colors are CSS values the
 * widgets choose (tokens), never user text.
 * @param {{ size: number, width: number, parts: readonly { f: number, color: string }[], notch?: number | null,
 *   notchColor?: string, gap?: number, draw?: boolean, track?: boolean }} o
 * @returns {string}
 */
export function ringSvg(o) {
  const size = o.size;
  const r = (size - o.width) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const parts = o.parts.filter((p) => p.f > 0);
  const gap = parts.length > 1 ? (o.gap ?? Math.max(1.5, o.width * 0.35)) : 0;
  // A round cap overhangs the arc by half the stroke at each end; on a thick ring the dash is shortened by the caps
  // so neighbours keep their gap, but never below a dot, so a sliver still shows.
  const caps = o.width > 3 && parts.length > 1 ? o.width : 0;
  let at = 0;
  const arcs = parts.map((p) => {
    const f = Math.min(1, p.f);
    const len = Math.max(0.01, f * c - gap - caps);
    const offset = at * c + gap / 2 + caps / 2;
    at += f;
    // The color rides `style` (a CSS custom property is not honored in a presentation attribute).
    return `<circle class="inst-arc${o.draw ? " inst-draw" : ""}" cx="${cx}" cy="${cx}" r="${round(r)}" fill="none" stroke-width="${o.width}" stroke-linecap="round" stroke-dasharray="${round(len)} ${round(c)}" stroke-dashoffset="${round(-offset)}" style="--c:${round(c)};stroke:${p.color}" transform="rotate(-90 ${cx} ${cx})"/>`;
  });
  const track = o.track === false ? "" : `<circle class="inst-track" cx="${cx}" cy="${cx}" r="${round(r)}" fill="none" stroke-width="${o.width}"/>`;
  let notch = "";
  if (o.notch != null && o.notch > 0 && o.notch < 1) {
    const a = o.notch * 2 * Math.PI - Math.PI / 2;
    const r1 = r - o.width / 2 - 1.5;
    const r2 = r + o.width / 2 + 1.5;
    notch = `<line class="inst-notch" x1="${round(cx + r1 * Math.cos(a))}" y1="${round(cx + r1 * Math.sin(a))}" x2="${round(cx + r2 * Math.cos(a))}" y2="${round(cx + r2 * Math.sin(a))}" stroke-width="${o.width > 6 ? 2.5 : 1.6}" stroke-linecap="round"${o.notchColor ? ` style="stroke:${o.notchColor}"` : ""}/>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${track}${arcs.join("")}${notch}</svg>`;
}

/**
 * A plan window's color by how it reads (HarnessV3-ACP AC3-6; ui/lib/accounts.js `readsAs`): red when spent, amber from
 * four-fifths and where extra usage covers a spent one, else `ok` (grey on a pill or a tab, the accent in a popover).
 * @param {string | null | undefined} state @param {string} ok
 */
export const stateColor = (state, ok) => (state === "spent" ? "var(--color-sys-red)" : state === "warning" || state === "covered" ? "var(--color-sys-orange)" : ok);

/**
 * A gauge as SVG markup: a half-ring open at the bottom, its track, and an arc filled from the left to `f` (0..1; none
 * drawn for null — a gauge with nothing to read yet). The color is a CSS value the widget chooses (a token), never
 * user text.
 * @param {{ width: number, stroke: number, f: number | null, color: string }} o
 * @returns {string}
 */
export function gaugeSvg(o) {
  const r = (o.width - o.stroke) / 2;
  const cx = o.width / 2;
  const cy = r + o.stroke / 2;
  const height = Math.ceil(cy + o.stroke / 2);
  const arc = `M ${round(cx - r)} ${round(cy)} A ${round(r)} ${round(r)} 0 0 1 ${round(cx + r)} ${round(cy)}`;
  const len = Math.PI * r;
  const fill = o.f == null
    ? ""
    : `<path class="inst-arc" d="${arc}" fill="none" stroke-width="${o.stroke}" stroke-linecap="round" stroke-dasharray="${round(Math.max(0.01, Math.min(1, o.f)) * len)} ${round(len + o.stroke)}" style="stroke:${o.color}"/>`;
  return `<svg viewBox="0 0 ${o.width} ${height}" width="${o.width}" height="${height}" aria-hidden="true"><path class="inst-track" d="${arc}" fill="none" stroke-width="${o.stroke}" stroke-linecap="round"/>${fill}</svg>`;
}

// ---- building blocks ----------------------------------------------------------------------------------------

/** An icon by name, or an empty slot. @param {Mk} mk @param {string} name @param {string} [cls] */
export const icon = (mk, name, cls = "inst-ic") => mk("span", { class: cls, ...(ICONS[name] ? { html: ICONS[name] } : {}) });

/** Children with the empty ones left out — `replaceChildren` would print a null as text. @param {any[]} list */
export const kids = (list) => list.flat(4).filter((k) => k !== null && k !== undefined && k !== false && k !== "");

/**
 * A model's words with their inline marks drawn — `code` and **bold** — as nodes, never markup: a card's excerpt of a
 * reply reads as the conversation draws it, without its backticks and asterisks.
 * @param {Mk} mk @param {string} text
 * @returns {any[]}
 */
export function inlineMarks(mk, text) {
  const s = String(text || "");
  /** @type {any[]} */
  const out = [];
  let at = 0;
  for (const m of s.matchAll(/`([^`\n]+)`|\*\*([^*\n]+)\*\*/g)) {
    const i = m.index ?? 0;
    out.push(s.slice(at, i), m[1] != null ? mk("code", {}, m[1]) : mk("b", {}, m[2]));
    at = i + m[0].length;
  }
  out.push(s.slice(at));
  return kids(out);
}

/**
 * The popover's header: the System-Settings tile in the widget's accent, the title and a quiet line, and an optional
 * control at the end.
 * @param {Mk} mk @param {{ icon: string, title: string, sub?: any, trailing?: any }} o
 */
export function head(mk, o) {
  return mk("div", { class: "inst-head" },
    mk("span", { class: "inst-tile", html: ICONS[o.icon] || "" }),
    mk("div", { class: "inst-head-text" }, mk("div", { class: "inst-title" }, o.title), o.sub ? mk("div", { class: "inst-sub" }, o.sub) : null),
    o.trailing || null);
}

/**
 * The hero figure: the number large, its unit quiet beside it, one plain line under.
 * @param {Mk} mk @param {{ value: string, unit?: string, caption?: any, tone?: "" | "warn" | "error" | "good" }} o
 */
export function hero(mk, o) {
  return mk("div", { class: `inst-hero${o.tone ? ` is-${o.tone}` : ""}` },
    mk("div", { class: "inst-hero-line" }, mk("span", { class: "inst-hero-num" }, o.value), o.unit ? mk("span", { class: "inst-hero-unit" }, o.unit) : null),
    o.caption ? mk("div", { class: "inst-hero-cap" }, o.caption) : null);
}

/**
 * A legend: a dot in the part's color, its name, its figure (and a share) at the end.
 * @param {Mk} mk @param {readonly { color: string, label: string, value: string, share?: string, hollow?: boolean }[]} rows
 */
export function legend(mk, rows) {
  return mk("div", { class: "inst-legend" }, ...rows.map((r) =>
    mk("div", { class: "inst-legend-row" },
      mk("span", { class: `inst-dot${r.hollow ? " is-hollow" : ""}`, style: r.hollow ? "" : `background:${r.color}` }),
      mk("span", { class: "inst-legend-label" }, r.label),
      mk("span", { class: "inst-legend-val" }, r.value),
      r.share != null ? mk("span", { class: "inst-legend-share" }, r.share) : null)));
}

/**
 * One bar of named parts, each its share of the whole, a hairline gap between them; `total` leaves room unfilled
 * (a bar that is part of a larger whole). A `hatch` part is a ceiling rather than a figure, drawn striped in its
 * color; `notch` marks one fraction of the whole on the bar (the compaction line).
 * @param {Mk} mk @param {readonly { value: number, color: string, label: string, hatch?: boolean }[]} parts
 * @param {{ total?: number, tall?: boolean, notch?: number | null }} [o]
 */
export function stackBar(mk, parts, o = {}) {
  const sum = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  const whole = Math.max(sum, Number(o.total) || 0) || 1;
  const notch = o.notch != null && o.notch > 0 && o.notch < 1 ? mk("span", { class: "inst-stack-notch", style: `left:${round(o.notch * 100)}%`, "aria-hidden": "true" }) : null;
  return mk("div", { class: `inst-stack${o.tall ? " is-tall" : ""}`, role: "img", "aria-label": parts.map((p) => `${p.label} ${Math.round((p.value / whole) * 100)}%`).join(", ") },
    ...kids([
      ...parts.filter((p) => p.value > 0).map((p) => mk("span", { class: `inst-stack-part${p.hatch ? " is-hatch" : ""}`, style: `flex-basis:${round((p.value / whole) * 100)}%;${p.hatch ? `--c:${p.color}` : `background:${p.color}`}`, title: p.label })),
      notch,
    ]));
}

/**
 * A strip of columns, one per item (a turn), height by value against the largest, the newest marked; each column's
 * tooltip says its label. The strip always has at least `slots` columns — a short session fills from the left, the
 * way a calendar chart shows the days still to come — and an empty value keeps its column as a stub, so the rhythm
 * still reads the turns; an item nothing measured (`gap`) keeps its place and draws nothing there, its tooltip
 * saying why: no figure is not a figure of 0. `draw` grows the columns in (the first paint only).
 * @param {Mk} mk @param {readonly { value: number, label: string, mark?: boolean, color?: string, gap?: boolean }[]} items
 * @param {{ height?: number, ariaLabel: string, max?: number, slots?: number, draw?: boolean }} o
 */
export function barStrip(mk, items, o) {
  const max = Math.max(o.max || 0, ...items.map((i) => i.value), 0) || 1;
  const height = o.height || 52;
  const cols = Math.max(items.length, o.slots || 0, 1);
  return mk("div", { class: `inst-bars${o.draw ? " is-draw" : ""}`, role: "img", "aria-label": o.ariaLabel, style: `height:${height}px;--n:${cols}` },
    ...items.map((it, i) => mk("span", {
      class: `inst-bar${it.mark ? " is-mark" : ""}${it.gap ? " is-gap" : it.value > 0 ? "" : " is-empty"}`,
      style: `height:${it.gap ? 100 : it.value > 0 ? Math.max(6, round((it.value / max) * 100)) : 4}%;--i:${i}${it.color && !it.gap ? `;background:${it.color}` : ""}`,
      title: it.label,
    })),
    // The turns still to come, as dots on the baseline.
    ...Array.from({ length: cols - items.length }, () => mk("span", { class: "inst-bar is-ghost", "aria-hidden": "true" })));
}

/**
 * The turns a per-turn chart draws, oldest first: each model turn once it has its facts, and each chat command
 * Filament answered itself — it made no request, so it keeps its column as a stub and the count agrees with the
 * ledger's turns (and turn N is the same column in every chart). A turn still running has no facts and waits.
 * @param {readonly any[]} turns
 */
export const chartTurns = (turns) => (turns || []).filter((t) => t && (t.command || t.facts));

/**
 * Inset grouped rows (iOS Settings): one rounded card, hairlines between rows.
 * @param {Mk} mk @param {...any} rows
 */
export const group = (mk, ...rows) => mk("div", { class: "inst-group" }, ...kids(rows));

/**
 * One row: an optional colored glyph, the label (and a quiet line under it), a value, and a trailing control. A row
 * with `onClick` is a button, with a chevron unless it has a trailing control.
 * @param {Mk} mk
 * @param {{ icon?: string, iconColor?: string, label: any, sub?: any, value?: any, trailing?: any, onClick?: () => void,
 *   title?: string, chevron?: boolean, cls?: string }} o
 */
export function row(mk, o) {
  const tag = o.onClick ? "button" : "div";
  const lead = o.icon ? mk("span", { class: "inst-row-ic", style: o.iconColor ? `background:${o.iconColor}` : "", html: ICONS[o.icon] || "" }) : null;
  return mk(tag, {
    class: `inst-row${lead ? " has-ic" : ""}${o.onClick ? " is-button" : ""}${o.cls ? ` ${o.cls}` : ""}`,
    ...(o.onClick ? { type: "button", onclick: o.onClick } : {}),
    ...(o.title ? { title: o.title } : {}),
  },
    lead,
    mk("span", { class: "inst-row-text" }, mk("span", { class: "inst-row-label" }, o.label), o.sub ? mk("span", { class: "inst-row-sub" }, o.sub) : null),
    o.value != null ? mk("span", { class: "inst-row-value" }, o.value) : null,
    o.trailing || null,
    o.onClick && o.chevron !== false && !o.trailing ? icon(mk, "chevronRight", "inst-row-chev") : null);
}

/** A section's small title over its content; the title may be a node (its words with a control beside them). @param {Mk} mk @param {any} title @param {...any} content */
export const section = (mk, title, ...content) => mk("div", { class: "inst-section" }, mk("div", { class: "inst-section-title" }, title), ...kids(content));

/** A quiet sentence; `tone` colors it (a warning says so in words too). @param {Mk} mk @param {any} text @param {"" | "warn" | "error" | "good"} [tone] */
export const note = (mk, text, tone = "") => mk("p", { class: `inst-note${tone ? ` is-${tone}` : ""}` }, text);

/**
 * The footer's buttons: quiet capsules, the primary one filled in the accent.
 * @param {Mk} mk @param {readonly ({ label: string, onClick: () => void, primary?: boolean, icon?: string, title?: string, disabled?: boolean } | null | false)[]} buttons
 */
export function actions(mk, buttons) {
  const list = /** @type {{ label: string, onClick: () => void, primary?: boolean, icon?: string, title?: string, disabled?: boolean }[]} */ (buttons.filter(Boolean));
  if (!list.length) return null;
  return mk("div", { class: "inst-actions" }, ...list.map((b) =>
    mk("button", {
      class: `inst-btn${b.primary ? " is-primary" : ""}`,
      type: "button",
      onclick: () => { if (!b.disabled) b.onClick(); },
      ...(b.title ? { title: b.title } : {}),
      ...(b.disabled ? { disabled: "", "aria-disabled": "true" } : {}),
    }, b.icon ? icon(mk, b.icon) : null, b.label)));
}

/**
 * Pages inside one popover (the Control Center module pattern: a row opens its own page over the instrument, a back
 * chevron returns). Each page is a builder, so the page on top can be drawn again with fresh figures (`repaint`);
 * pushing slides the page in from the right, going back from the left — a spring, faded under a reduced-motion
 * preference (instruments.css). A page of another height moves the popover: `onSwap` (the frame's `relayout`) runs
 * after each draw. A pushed page takes the focus on its back button — the row that opened it is gone — and going
 * back gives it to what `returnTo` names on the page returned to (the row that opened it, drawn again). A repaint draws
 * the page on top again in place (`drawIn`, dom.js `morphChildren` by default): its buttons, its switches and a field
 * being typed in stay the elements they were under the pointer and the caret (the owner's of 11-01: buttons blinking
 * under a resting pointer, clicks lost); a page pushed or gone back to comes in whole, sliding.
 * @param {Mk} mk @param {{ onSwap?: () => void, drawIn?: (parent: any, nodes: any[]) => void }} [o]
 * @returns {{ el: any, open: (build: () => any) => void, push: (build: () => any, p?: { returnTo?: string }) => void, back: () => void, repaint: () => void, depth: () => number }}
 */
export function pages(mk, o = {}) {
  const el = mk("div", { class: "inst-pages" });
  /** @type {{ build: () => any, returnTo: string | null }[]} */
  const stack = [];
  const drawIn = o.drawIn || morphChildren;
  /** @param {"" | "fwd" | "back"} dir @param {string | null} [focus] */
  const draw = (dir, focus = null) => {
    const page = stack[stack.length - 1].build();
    if (dir) {
      page.classList?.add?.(`inst-page-in-${dir}`);
      el.replaceChildren(page);
    } else {
      // The page drawn again keeps the way it came in, so a repaint never cuts its slide short.
      const came = ["fwd", "back"].find((d) => el.firstElementChild?.classList?.contains?.(`inst-page-in-${d}`));
      if (came) page.classList?.add?.(`inst-page-in-${came}`);
      drawIn(el, [page]);
    }
    if (dir === "fwd") page.querySelector?.(".inst-back")?.focus?.();
    if (focus) page.querySelector?.(focus)?.focus?.();
    o.onSwap?.();
  };
  return {
    el,
    open: (build) => { stack.length = 0; stack.push({ build, returnTo: null }); draw(""); },
    push: (build, p = {}) => { stack.push({ build, returnTo: p.returnTo || null }); draw("fwd"); },
    back: () => {
      if (stack.length < 2) return;
      const gone = stack.pop();
      draw("back", gone?.returnTo || null);
    },
    repaint: () => { if (stack.length) draw(""); },
    depth: () => stack.length,
  };
}

/** A link-styled button at the foot of a popover. @param {Mk} mk @param {string} label @param {() => void} onClick */
export const link = (mk, label, onClick) => mk("button", { class: "inst-link", type: "button", onclick: onClick }, label, icon(mk, "chevronRight", "inst-link-chev"));

// ---- controls -----------------------------------------------------------------------------------------------

/**
 * Where the arrow keys move a segmented control's choice: from the current option (or, when the current value is not
 * among them, from the list's end) one step, wrapping.
 * @param {readonly { id: string }[]} options @param {string} current @param {number} step  1 or -1
 */
export function segStep(options, current, step) {
  const found = options.findIndex((o) => o.id === current);
  const at = found >= 0 ? found : step > 0 ? -1 : options.length;
  return options[(at + step + options.length) % options.length].id;
}

/**
 * A segmented control: a radiogroup of buttons, the thumb on the chosen one; the arrow keys move the choice (and the
 * focus with it). `paint` restyles it without rebuilding under the cursor.
 * @param {Mk} mk
 * @param {{ options: readonly { id: string, label: string, title?: string | (() => string) }[], value: () => string, onChange: (id: string) => void, ariaLabel: string }} o
 *   a `title` given as a function is read again at each paint
 * @returns {{ el: any, paint: () => void }}
 */
export function segmented(mk, o) {
  /** Each option's button as made; a draw in place may have drawn it into the one on the page (`standing`). @type {Map<string, any>} */
  const btns = new Map();
  const paint = () => {
    const v = o.value();
    // A value none of them names (a choice offered no more) leaves the first in the tab order: the group is reached.
    const first = o.options.some((x) => x.id === v) ? null : o.options[0]?.id;
    for (const [id, made] of btns) {
      const b = standing(made);
      const on = id === v;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.setAttribute("tabindex", on || id === first ? "0" : "-1");
      const title = o.options.find((x) => x.id === id)?.title;
      if (typeof title === "function") b.setAttribute("title", title());
    }
  };
  const el = mk("div", {
    class: "inst-seg",
    role: "radiogroup",
    "aria-label": o.ariaLabel,
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = segStep(o.options, o.value(), step);
      o.onChange(next);
      paint();
      standing(btns.get(next))?.focus?.();
    },
  }, ...o.options.map((opt) => {
    const b = mk("button", { class: "inst-seg-btn", type: "button", role: "radio", ...(opt.title ? { title: typeof opt.title === "function" ? opt.title() : opt.title } : {}), onclick: () => { o.onChange(opt.id); paint(); } }, opt.label);
    btns.set(opt.id, b);
    return b;
  }));
  paint();
  return { el, paint };
}

/**
 * A row with a switch at its end — the label names what turns on.
 * @param {Mk} mk @param {{ label: string, sub?: string, checked: boolean, onChange: (on: boolean) => void, disabled?: boolean, title?: string }} o
 */
export function switchRow(mk, o) {
  const input = mk("input", {
    class: "ios-switch",
    type: "checkbox",
    role: "switch",
    "aria-label": o.label,
    ...(o.checked ? { checked: "" } : {}),
    ...(o.disabled ? { disabled: "" } : {}),
    onchange: (/** @type {Event} */ e) => o.onChange(!!(/** @type {HTMLInputElement} */ (e.target)).checked),
  });
  input.checked = !!o.checked;
  return row(mk, { label: o.label, sub: o.sub, trailing: input, title: o.title });
}

/**
 * A slider: the track filled in the accent up to the thumb. `onInput` fires while it moves (a live figure beside it);
 * `onChange` once it is let go (the write).
 * @param {Mk} mk
 * @param {{ min: number, max: number, step?: number, value: number, ariaLabel: string, cls?: string, onInput?: (v: number) => void, onChange: (v: number) => void }} o
 */
export function slider(mk, o) {
  const fill = (/** @type {number} */ v) => `--fill:${round(((v - o.min) / (o.max - o.min)) * 100)}%`;
  const input = mk("input", {
    class: `inst-slider${o.cls ? ` ${o.cls}` : ""}`,
    type: "range",
    min: String(o.min),
    max: String(o.max),
    step: String(o.step ?? 1),
    value: String(o.value),
    "aria-label": o.ariaLabel,
    style: fill(o.value),
    oninput: (/** @type {Event} */ e) => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      const v = Number(target.value);
      target.setAttribute("style", fill(v));
      o.onInput?.(v);
    },
    onchange: (/** @type {Event} */ e) => o.onChange(Number(/** @type {HTMLInputElement} */ (e.target).value)),
  });
  input.value = String(o.value);
  return input;
}
