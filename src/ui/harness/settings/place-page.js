// @ts-check
// A page in New chats over one place (HarnessV4_Settings_Plan HS-D39): "Applies to" at its top (lib/applies-to.js),
// the place's settings read and drawn under it (lib/place-settings.js), and drawn again after each write. The kit is
// the rows' parts those pages share: the row with where its value comes from and its Reset (HS-D40), a heading, a
// switch row, a list kept as lines (HC-85), and the one writer, whose toast says what changed and for whom. Built
// with an injected `h`, `api` and menu, so a page runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { appliesTo } from "../lib/applies-to.js";
import { placeSettings } from "../lib/place-settings.js";
import { keptArea, toggle } from "../lib/fields.js";

/** @typedef {{ id: string, name: string }} Project */
/**
 * @typedef {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void, start?: string | null }} PageCallbacks
 *   `start`: "project:<id>" opens the page on that project (a Space's Project settings), else on All chats
 */
/** @typedef {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, menu?: any, pick?: any }} PageIo */
/** @typedef {ReturnType<typeof placeKit>} Kit */

/**
 * @param {HTMLElement} body @param {PageCallbacks} cb @param {PageIo} io
 * @param {{ say: (project: Project | null) => string, rows: (kit: Kit, project: Project | null) => any[] }} page
 *   `say`: the words beside "Applies to" for the place picked; `rows`: the page's rows over it
 */
export function mountPlacePage(body, cb, io, page) {
  const m = io.h || h;
  const host = m("div", { class: "nset" });
  /** Each pick draws afresh; an older read that lands late draws nothing. */
  let drawn = 0;
  const control = appliesTo({
    onToast: cb.onToast,
    onPick: (scope, project) => {
      control.say(page.say(scope === "all" ? null : project));
      void draw(scope, scope === "all" ? null : project, ++drawn);
    },
  }, io);
  body.replaceChildren(control.el, host);
  control.start(/^project:/.test(String(cb.start || "")) ? String(cb.start).slice("project:".length) : null);

  /** @param {string} scope @param {Project | null} project @param {number} at */
  async function draw(scope, project, at) {
    const place = placeSettings(scope, io);
    try {
      await place.read();
    } catch (/** @type {any} */ e) {
      if (at === drawn) host.replaceChildren(m("p", { class: "set-error" }, `These settings could not be read: ${String(e?.message || e)}`));
      return;
    }
    if (at !== drawn) return;
    /** @type {Map<string, string>} */
    const drafts = new Map();
    const paint = () => { if (at === drawn) host.replaceChildren(...page.rows(placeKit(place, paint, cb, io, drafts), project)); };
    paint();
  }
}

/**
 * The rows' parts over one place. `drafts` holds what is typed in a field that is not a setting yet (a folder to add),
 * so a page drawn again — after a refusal, or another row's write — shows it still.
 * @param {import("../lib/place-settings.js").Place} place @param {() => void} repaint @param {PageCallbacks} cb @param {PageIo} io
 * @param {Map<string, string>} [drafts]
 */
export function placeKit(place, repaint, cb, io, drafts = new Map()) {
  const m = io.h || h;

  /**
   * One change; the toast says what changed or why not; the page is drawn again either way, after `settle` has heard
   * whether it was taken.
   * @param {{ patch?: Record<string, any>, unset?: string[] }} change @param {(ok: boolean) => void} [settle] @returns {Promise<boolean>}
   */
  const write = async (change, settle) => {
    const r = await place.write(change);
    settle?.(r.ok);
    cb.onToast?.(r.words, r.ok ? "" : "err");
    if (r.ok) cb.onChanged?.();
    repaint();
    return r.ok;
  };

  /** Emptied where the value is not this place's: there is nothing here to take away, and the field says so. @param {string} path */
  const notHere = (path) => {
    cb.onToast?.(`${place.from(path)}: there is nothing ${place.projectId ? "of this project's" : "of yours"} to empty`, "err");
    return false;
  };

  /** Where a knob's value comes from, and Reset where this place holds its own. @param {string} path */
  const from = (path) =>
    m("div", { class: "nset-from" },
      m("span", {}, place.from(path)),
      place.own(path) ? m("button", { class: "nset-reset", type: "button", title: place.projectId ? "This project takes all chats' again" : "Back to Filament's default", onclick: () => void write({ unset: [path] }) }, "Reset") : null);

  /**
   * A row: its label, its words and where its value comes from on the left; its control on the right, or under them.
   * @param {string} label @param {string} desc @param {any} control @param {{ path?: string, wide?: boolean }} [o]
   */
  const row = (label, desc, control, o = {}) =>
    m("div", { class: `settings-row nset-row${o.wide ? " is-wide" : ""}` },
      m("div", { class: "settings-row-text" },
        m("div", { class: "settings-row-label" }, label),
        desc ? m("div", { class: "settings-row-desc" }, desc) : null,
        o.path ? from(o.path) : null),
      m("div", { class: o.wide ? "nset-wide" : "shrink-0" }, control));

  /** @param {string} title */
  const head = (title) => m("h3", { class: "nset-h" }, title);

  /** A switch over one knob. @param {string} path @param {string} label @param {string} desc @param {boolean} [dflt]  its value when unset */
  const switchRow = (path, label, desc, dflt = false) => {
    const on = typeof place.value(path) === "boolean" ? place.value(path) : dflt;
    return row(label, desc, toggle(m, on, label, () => void write({ patch: { [path]: !on } })), { path });
  };

  /**
   * A list kept as lines, one entry each. What the field shows is what applies: emptied, this place holds an empty
   * list of its own, and Reset hands it back to the one under it.
   * @param {string} path @param {string} label @param {string} desc @param {string} placeholder @param {boolean} [mono]
   */
  const linesRow = (path, label, desc, placeholder, mono = true) =>
    row(label, desc, keptArea(m, (Array.isArray(place.value(path)) ? place.value(path) : []).join("\n"), async (text) =>
      write({ patch: { [path]: text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) } }),
    { placeholder, "aria-label": label, rows: "3", class: `zc-input set-area${mono ? "" : " nset-prose"}` }), { path, wide: true });

  return { m, place, cb, io, repaint, drafts, write, notHere, row, head, switchRow, linesRow };
}
