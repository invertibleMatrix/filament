// @ts-check
// A list of models, first choice first, as the Library's editors take one (the owner's words of 10-19: "assign each
// specialized agent a model as a priority list"): an agent's models, a team's lead's and its crew's. Each row is a
// model picker with Take out, then a row to add one more, up to a most. `note(name)` puts a line under a row — why that
// model cannot run an agent now — or nothing. An editor names what runs where none is picked (`none`: "Same as the
// main agent") on the add row's picker, and the add row after a pick as a backup (`next`: "Add a backup"). Given
// `efforts`, each row says how hard an agent thinks on its model beside it (lib/effort-chip.js; the owner's word of
// 11-05: rows are model · account · effort) — the default the main agent's.
import { prettyModel } from "../lib/families.js";
import { effortChip } from "../lib/effort-chip.js";

/** What a row with no effort thinks at: in Library, no one main agent's — each chat's, where it runs. */
const LIBRARY_EFFORT = Object.freeze({ level: "", words: "The main agent's", desc: "As the main agent thinks in the chat it runs in, unless that chat sets its own" });

/**
 * How hard an agent thinks on each of a list's models, in the list's order, the rest dropped: what an editor sends, so
 * an edit sends them where they changed and a copy keeps them (the review of 11-05: a list sent without them read as
 * none). @param {readonly string[]} models @param {Record<string, string> | undefined} efforts
 */
export const effortsIn = (models, efforts) => Object.fromEntries(models.filter((x) => efforts?.[x]).map((x) => [x, String(efforts?.[x])]));

/**
 * @param {{ m: typeof import("../../lib/dom.js").h, models: string[], most: number, catalogue: () => any[],
 *   pick: typeof import("../composer/model.js").createModelSelect, changed: () => void, add?: string, first?: string,
 *   none?: string, next?: string, note?: (name: string, at: number) => any, cls?: string, efforts?: Record<string, string>,
 *   families?: () => readonly any[], inherit?: () => import("../lib/effort-chip.js").Inherit, menu?: Parameters<typeof effortChip>[0]["menu"] }} o
 *   `models`: the list, changed in place; `changed`: a row was picked, changed or taken out; `add`: the add row's word
 *   while the list is empty; `first`: the first row's ("" for none); `none`: the add row's picker's words while the
 *   list is empty — what runs then; `next`: its words once the list has a row, in place of "then"; `cls`: a class of
 *   the caller's beside the list's own; `efforts`: how hard it thinks on each model, by name, changed in place — a
 *   model's dropped as it leaves the list; `families`: the catalogue's, for the levels a model takes; `inherit`: what a
 *   row that says none thinks at, and why; `menu`: the test's stand-in
 * @returns {{ el: HTMLElement, paint: () => void }}
 */
export function modelList({ m, models, most, catalogue, pick, changed, add = "Add a model", first = "first", none = "", next = "", note = () => null, cls = "", efforts, families, inherit, menu }) {
  const el = m("div", { class: `tset-models-ed${cls ? ` ${cls}` : ""}` });
  /** @param {number} i  the row's place: one past the end adds */
  const chip = (i) => {
    const words = i < models.length ? "" : models.length ? next : none;
    const sel = pick({
      ...(words ? { blank: words } : {}),
      onChange: (name) => {
        if (!name) return;
        const had = models.indexOf(name);
        if (i < models.length) models[i] = name;
        else if (had < 0) models.push(name);
        // A model named twice is named once, where it was picked.
        if (had >= 0 && had !== i && i < models.length) models.splice(had, 1);
        kept();
        paint();
        changed();
      },
    });
    sel.setModels(catalogue());
    if (i < models.length) sel.set(models[i]);
    return sel.el;
  };
  /** The efforts of the models the list holds, the rest dropped. */
  const kept = () => {
    if (efforts) for (const k of Object.keys(efforts)) if (!models.includes(k)) delete efforts[k];
  };
  /** How hard it thinks on a row's model, where the list says efforts. @param {string} name */
  const effortOf = (name) =>
    efforts
      ? effortChip({
          label: `How hard it thinks on ${prettyModel(name)}`,
          value: efforts[name] || "",
          onChange: (level) => {
            if (level) efforts[name] = level;
            else delete efforts[name];
            changed();
          },
          model: () => name,
          families: () => families?.() || [],
          inherit: () => inherit?.() || LIBRARY_EFFORT,
          mk: m,
          ...(menu ? { menu } : {}),
        }).el
      : null;
  /** A row's word before its picker, none where it is "". @param {string} s */
  const word = (s) => (s ? m("span", { class: "tset-model-n" }, s) : null);
  const paint = () => {
    el.replaceChildren(
      ...models.flatMap((name, i) => [
        m("div", { class: "tset-model-row", "data-model": name },
          word(i ? "then" : first),
          chip(i),
          effortOf(name),
          m("button", { class: "sm ghost tset-del", type: "button", "aria-label": `Take ${prettyModel(name)} out`, onclick: () => { models.splice(i, 1); kept(); paint(); changed(); } }, "Take out")),
        note(name, i),
      ].filter(Boolean)),
      ...(models.length < most ? [m("div", { class: "tset-model-row is-add" }, word(models.length ? (next ? "" : "then") : add), chip(models.length))] : []));
  };
  paint();
  return { el, paint };
}
