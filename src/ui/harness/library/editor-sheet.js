// @ts-check
// The Library's editors as a sheet over the page (the owner's word of 10-21 on the team editor: "this still look so bad.
// it could have been a popup or something"): an agent's card and a team each open in a centred glass sheet, the page
// dimmed behind it and left where it stood — its tile and name at the head with one quiet line, its parts as inset
// groups of rows, macOS System Settings' way (a short label with a quiet line under it on the left, the control on the
// right, or under them where it is a list or a box of words), and a foot that stays put under the scroll: why Save
// waits or what the server refused, Cancel and Save. Esc or × with something changed asks before it throws the changes
// away; Cancel does not ask. Built with an injected `h` and dialog, so it runs on the fake DOM.
import { dialog as openDialog } from "../lib/ui.js";

/** @typedef {typeof import("../../lib/dom.js").h} Mk */

/**
 * One part of an editor: a small title, its rows in one inset group, a quiet line under it. `aside`: what stands beside
 * the title — a shipped agent's "changed" mark and its Put back.
 * @param {Mk} m @param {string} title  "" for none @param {any[]} rows  a null is left out @param {any} [foot] @param {any} [aside]
 */
export function part(m, title, rows, foot = null, aside = null) {
  return m("section", { class: "ed-part", ...(title ? { "aria-label": title } : {}) },
    title ? m("h4", { class: "ed-part-title" }, title, aside) : null,
    m("div", { class: "ed-group" }, ...rows.filter(Boolean)),
    foot ? m("p", { class: "ed-part-foot" }, foot) : null);
}

/**
 * One row of a part: its label and a quiet line under it, then its control — beside them, or under them (`wide`) where
 * it is a list or a box of words.
 * @param {Mk} m @param {{ label: any, sub?: any, wide?: boolean, cls?: string }} o @param {...any} control  a null is left out
 */
export function line(m, o, ...control) {
  const shown = control.filter((c) => c !== null && c !== undefined);
  return m("div", { class: `ed-row${o.wide ? " is-wide" : ""}${o.cls ? ` ${o.cls}` : ""}` },
    m("div", { class: "ed-row-text" },
      m("div", { class: "ed-row-label" }, o.label),
      o.sub ? m("div", { class: "ed-row-sub" }, o.sub) : null),
    shown.length ? m("div", { class: "ed-row-ctl" }, ...shown) : null);
}

/**
 * A part's marks on an agent or a team that ships, set in place (HarnessV4_ShippedAgents_Plan SA4): beside its name,
 * "changed" and Put back, while it differs from how it ships; and under it, while it is yours and Filament's words for it
 * moved since you changed it (SA-D3), a line that says so with Show — Filament's words — and Take Filament's. `label`: the
 * part's name, in its buttons' names; `ships`: Filament's words for it; `back`: puts it back in the editor as it ships.
 * @param {Mk} m @param {{ label: string, ships: any, back: () => void }} o
 * @returns {{ slot: HTMLElement, line: HTMLElement, paint: (mine: boolean, moved: boolean) => void }}
 */
export function shippedMarks(m, o) {
  const slot = m("span", { class: "ed-mine", hidden: "" },
    m("span", { class: "ed-mine-word" }, "changed"),
    m("button", { class: "ed-link", type: "button", "aria-label": `Put back ${o.label}`, title: "As it ships with Filament", onclick: () => o.back() }, "Put back"));
  const was = m("blockquote", { class: "ed-moved-was", hidden: "" }, o.ships);
  let shown = false;
  const show = m("button", { class: "ed-link", type: "button", "aria-label": `Show Filament's ${o.label}`, onclick: () => {
    shown = !shown;
    was.toggleAttribute("hidden", !shown);
    show.replaceChildren(shown ? "Hide" : "Show");
  } }, "Show");
  const take = m("button", { class: "ed-link", type: "button", "aria-label": `Take Filament's ${o.label}`, onclick: () => o.back() }, "Take Filament's");
  const line = m("div", { class: "ed-moved", role: "note", hidden: "" },
    m("p", { class: "ed-moved-line" }, "Filament's words for this changed since you changed it — ", show, " · ", take), was);
  return {
    slot,
    line,
    paint: (mine, moved) => {
      slot.toggleAttribute("hidden", !mine);
      line.toggleAttribute("hidden", !(mine && moved));
    },
  };
}

/**
 * The sheet an editor opens in. `dirty`: whether a close would throw something away — Esc and × then ask first, and
 * the sheet stays unless the person says Discard; `onClose`: it went, however it went.
 * @param {{ m: Mk, dialog?: typeof openDialog, confirm: (o: { title: string, description?: string, confirmLabel?: string, destructive?: boolean }) => Promise<boolean>,
 *   title: string, tile?: any, sub?: string, body: any[], foot: any, dirty: () => boolean, onClose: () => void }} o
 * @returns {{ close: (force?: boolean) => void }}
 */
export function openEditorSheet(o) {
  const open = o.dialog || openDialog;
  let asking = false;
  /** @type {{ close: (force?: boolean) => void }} */
  const d = open({
    title: o.title,
    glyph: o.tile || null,
    description: o.sub || "",
    wide: true,
    cls: "is-ed",
    body: o.m("div", { class: "ed-sheet" }, o.m("div", { class: "ed-body" }, ...o.body.filter(Boolean)), o.foot),
    onClose: o.onClose,
    guard: () => {
      if (!o.dirty()) return true;
      if (!asking) {
        asking = true;
        void o.confirm({ title: "Discard the changes?", description: "What you changed here is not saved.", confirmLabel: "Discard", destructive: true })
          .then((yes) => {
            asking = false;
            if (yes) d.close(true);
          });
      }
      return false;
    },
  });
  return d;
}
