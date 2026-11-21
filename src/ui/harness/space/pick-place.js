// @ts-check
// Where work started in a Space of your own runs (HarnessV4_SpacesPlugins_Plan A4): "fire an agent on this Linear
// issue" belongs to a project, not to the Work Space it was seen in. Start a chat on this…, Hand to an agent… and a
// dashboard row's Ask an agent about this… ask first — this Space itself, one of your projects, or another Space of
// yours —, and the chat remembers the Space it came from, whose What happened says each time it finishes. A project's
// own Space asks nothing: its work runs in its project. Nothing runs until Send.
import { h } from "../../lib/dom.js";
import { dialog } from "../lib/ui.js";
import { ICONS } from "../lib/icons.js";

/**
 * A place a chat may run in: a project, or a Space of your own, by its folder.
 * @typedef {{ id: string, name: string, cwd: string, own: boolean }} RunPlace
 */

/** A folder as two lists compare it. @param {unknown} p */
const key = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * The places offered, in their order: this Space first, then your projects as the bar lists them, then your other
 * Spaces. A project with no folder is left out; one folder is offered once.
 * @param {string} here  this Space's project id
 * @param {readonly { id: string, name: string, cwd: string }[]} projects  every project the bar knows, Spaces of yours among them
 * @param {readonly { project: string, name: string }[]} own  the Spaces of your own
 * @returns {RunPlace[]}
 */
export function placeChoices(here, projects, own) {
  const ownIds = new Map(own.map((o) => [o.project, o.name]));
  /** @type {RunPlace[]} */
  const all = projects.filter((p) => p.cwd).map((p) => ({ id: p.id, name: ownIds.get(p.id) || p.name, cwd: p.cwd, own: ownIds.has(p.id) }));
  const seen = new Set();
  return [...all.filter((p) => p.id === here), ...all.filter((p) => p.id !== here && !p.own), ...all.filter((p) => p.id !== here && p.own)].filter((p) => {
    const k = key(p.cwd);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** What the picker says under its rows where it asks where a chat runs. */
const RUN_NOTE = "The chat starts there, nothing sent until you send; each time it finishes, What happened here says so.";

/**
 * Asks where the chat runs: a row a place, this Space first. → the place picked, or null where the person closed it.
 * The same list picks a project for a Space of your own to show (A7), with its own `title` and `note`.
 * @param {{ here: string, choices: readonly RunPlace[], what: string, title?: string, note?: string }} o  `what`: the
 *   work, in a line, as the sheet names it
 * @returns {Promise<RunPlace | null>}
 */
export function pickPlace({ here, choices, what, title = "Where does this chat run?", note = RUN_NOTE }) {
  return new Promise((resolve) => {
    let done = false;
    /** @param {RunPlace | null} p */
    const end = (p) => {
      if (done) return;
      done = true;
      resolve(p);
      d.close(true);
    };
    // This Space is the default (the owner's of 11-04: work started from a Space should land in it unless said
    // otherwise): its row is first, focused as the sheet opens — Enter takes it — and says so.
    const row = (/** @type {RunPlace} */ p) =>
      h("button", { class: `pkp-row${p.id === here ? " is-here" : ""}`, type: "button", "data-place": p.id, onclick: () => end(p) },
        h("span", { class: `pkp-ic${p.own ? " is-own" : ""}`, "aria-hidden": "true", html: p.own ? ICONS.layoutGrid : ICONS.folder }),
        h("span", { class: "pkp-words" },
          h("b", { class: "pkp-name" }, p.id === here ? `${p.name}, this Space` : p.name),
          h("span", { class: "pkp-folder" }, p.cwd)),
        ...(p.id === here ? [h("span", { class: "pkp-default" }, "Default · Enter")] : []));
    const body = h("div", { class: "pkp-body" },
      h("p", { class: "pkp-what" }, what),
      h("div", { class: "pkp-list", role: "list" }, ...choices.map(row)),
      h("p", { class: "pkp-note sp-quiet" }, note));
    const d = dialog({ title, body, wide: true, onClose: () => { if (!done) { done = true; resolve(null); } } });
    // The focus on this Space's row, not the sheet's close: Enter takes the default, as its row says (found by the
    // review of 11-04: the dialog's first button is its ✕).
    /** @type {HTMLElement | null} */ (body.querySelector(".pkp-row.is-here"))?.focus();
  });
}
