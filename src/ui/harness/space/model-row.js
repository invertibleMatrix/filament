// @ts-check
// The model an agent starts on, the person's to choose before it does (the owner's word of 10-31: no agent runs behind
// the person's back, nor on a model they did not see): the composer's picker on the model shown, the provider serving it
// as the picker's tabs name it, and a line — why this one, or why it cannot run now, as the Agents page checks it
// (`/subagents/model-problem`). With `effort` (the owner's of 11-04: "a proper model picker with efforts selection
// too"), the effort beside it on a chip, never a list of names (the owner's of 11-06): the agents' own, as every agent's
// model picker has it (lib/effort-chip.js) — or, for what a new chat starts on, the message box's — with the levels that
// model takes and its own default; none where it takes none. A button's sheet asks it of a second look and of a check; a routine's sheet of its runs; a
// Space's settings and Settings › Space of what a Space's agents run on.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { createModelSelect } from "../composer/model.js";
import { createEffortControl } from "../composer/effort.js";
import { effortChip } from "../lib/effort-chip.js";
import { fitLevel, levelsIn, locate } from "../lib/families.js";

/**
 * @typedef {{ models: () => any[], families?: () => any[], accounts?: () => any[] }} Catalogue  what the picker lists, as
 *   the composer's: the models, their families, the coding agents' accounts
 */

/** Why a model cannot run an agent now, or null where nothing says so. @param {string} model @returns {Promise<string | null>} */
export const problemOf = (model) =>
  api(`/subagents/model-problem?model=${encodeURIComponent(model)}`).then(
    (r) => (r?.problem ? String(r.problem) : null),
    () => null,
  );

/** A model's provider, as the picker's tabs name it: its row's upstream; "" where the catalogue has no row of it. @param {Catalogue | undefined} catalogue @param {string} model */
export const providerOf = (catalogue, model) => {
  const row = (catalogue?.models() || []).find((m) => String(m?.id ?? m) === model);
  return String(row?.upstreamName || row?.upstream || "");
};

/**
 * The efforts a model takes, least first, as its family says them — the composer's tuning offers the same, but for
 * "none" and "minimal", which a Space keeps none of (core/space-settings.js `SPACE_EFFORTS`, `levelsIn`) —; null where
 * it takes none, or the catalogue does not know it.
 * @param {Catalogue | undefined} catalogue @param {string} model @returns {string[] | null}
 */
export function levelsOf(catalogue, model) {
  const levels = levelsIn(catalogue?.families?.() || [], model);
  return levels?.length ? levels : null;
}

/**
 * An effort kept as the model moves: the same level where the new one takes it, else the nearest under it, else its
 * lowest (`fitLevel`); "" where it takes none, or none was asked. @param {Catalogue | undefined} catalogue @param {string} model @param {string} want
 */
export const fitEffort = (catalogue, model, want) => {
  const levels = levelsOf(catalogue, model);
  return levels?.length ? fitLevel(levels, want || null) || "" : "";
};

/**
 * The row. `show` puts a model in it with its line, and checks it can run; the picker's pick goes to `onPick` — the
 * caller shows it, and saves it where it is kept —, its Use the default to `onDefault`. Ready: a model is shown, and
 * its check answered with nothing against it. `effort`: the effort's chip beside the model, its pick to `onPick`; the
 * model's own default is "" — `show`'s third word sets it. `effort.tuning`: the message box's chip, for what a new chat
 * starts on (the welcome tour), where the agents' is otherwise.
 * @param {{ lead?: string, named: string, cls?: string, catalogue?: Catalogue, modelSelect?: typeof createModelSelect,
 *   blank?: string, defaultDesc?: string, onPick: (model: string) => void, onDefault?: () => void,
 *   effort?: { onPick: (level: string) => void, named?: string, tuning?: boolean } | null,
 *   changed?: (ready: boolean) => void, alive?: () => boolean }} o  `lead`: the row's words before the picker; `named`: the
 *   picker's, for a screen reader; `cls`: its line's class; `blank`: the chip's words while no model is shown;
 *   `changed`: told whenever it may have changed; `alive`: whether what holds it is still open — a check answered after
 *   is dropped
 */
export function modelRow({ lead = "", named, cls = "", catalogue, modelSelect = createModelSelect, blank = "Choose a model", defaultDesc, onPick, onDefault, effort = null, changed = () => {}, alive = () => true }) {
  let model = "";
  let level = "";
  /** @type {string | null} */
  let problem = null;
  let pending = false;
  let asking = 0;
  const at = h("span", { class: "sp-model-at" });
  at.hidden = true;
  const line = h("span", { class: `sp-model-why${cls ? ` ${cls}` : ""}` });
  const ready = () => !!model && !pending && !problem;
  const picker = modelSelect({
    onChange: (name) => onPick(name),
    ...(onDefault ? { onUseDefault: onDefault, ...(defaultDesc ? { defaultDesc } : {}) } : {}),
    blank,
  });
  picker.el.setAttribute("aria-label", named);
  picker.setModels(catalogue?.models() || []);
  picker.setFamilies(catalogue?.families?.() || []);
  picker.setAccounts(catalogue?.accounts?.() || []);
  const effortNamed = effort?.named || `${named}: its effort`;
  /** A level picked on either chip, kept and told. @param {string} l */
  const pickLevel = (l) => {
    level = l;
    effort?.onPick(l);
  };
  // The message box's chip — Auto, the model's own, and the meter of its levels —, its pick told here alone, never kept
  // as the tuning a new chat starts from: the caller keeps it.
  const tuner = effort?.tuning
    ? createEffortControl({ onTune: (t) => pickLevel(String(t.effort || "")) }, { keeps: false, foot: false, named: effortNamed, side: "bottom", align: "start" })
    : null;
  // The agents' chip, as Library's, a flow's and the pool's: its default first, then the levels the model takes.
  const agentChip = effort && !effort.tuning
    ? effortChip({
      label: effortNamed,
      onChange: pickLevel,
      model: () => model,
      families: () => catalogue?.families?.() || [],
      // "" is the model's own, as a Space keeps it (core/space-settings.js).
      inherit: () => ({ level: "", words: "The model's own", desc: "It thinks as its model does by itself" }),
      own: false,
    })
    : null;
  /** Whether the model shown takes an effort: its chip shows. */
  let takes = false;
  /** The effort's chip on the model shown: hidden where it takes none. */
  const paintLevels = () => {
    if (!effort) return;
    const fam = tuner && model ? locate(catalogue?.families?.() || [], model)?.family : null;
    // The message box's chip, every level the model takes, as the message box offers them (None and Minimal too); the
    // agents', those an agent keeps.
    const levels = tuner ? [...(fam?.effort?.levels || [])] : levelsOf(catalogue, model) || [];
    takes = !!model && levels.length > 0;
    // What it shows is what it says it is: a level this model does not take reads as its own default, here and in `effort`.
    if (levels.length) level = levels.includes(level) ? level : "";
    if (agentChip) {
      agentChip.set(level);
      agentChip.el.hidden = !takes;
    }
    // The effort alone: speed, thinking and the window are the message box's to tune.
    tuner?.setFamily(
      fam && takes ? { ...fam, effort: { ...fam.effort, levels, capWithoutThinking: null }, speed: null, thinking: null, window: null } : null,
      { effort: level || null, speed: "standard", thinking: "off", window: 0 },
    );
  };
  const effortEl = tuner?.el || agentChip?.el || null;
  return {
    row: h("div", { class: "sp-model" }, ...(lead ? [h("span", { class: "sp-model-l" }, lead)] : []), picker.el, ...(effortEl ? [effortEl] : []), at, line),
    /**
     * The model shown — "" none —, its line, and its effort ("" its own default); its provider, and whether it can run,
     * follow. @param {string} name @param {string} words @param {string} [effortShown]
     */
    show(name, words, effortShown = "") {
      const n = ++asking;
      model = String(name || "");
      level = String(effortShown || "");
      problem = null;
      pending = !!model;
      picker.set(model);
      paintLevels();
      const via = model ? providerOf(catalogue, model) : "";
      at.textContent = via ? `via ${via}` : "";
      at.hidden = !via;
      line.textContent = words;
      changed(ready());
      if (!model) return;
      void problemOf(model).then((cannot) => {
        if (n !== asking || !alive()) return;
        pending = false;
        problem = cannot;
        if (cannot) line.textContent = `Can't run now: ${cannot}`;
        changed(ready());
      });
    },
    model: () => model,
    /** The effort shown: "" the model's own default. */
    effort: () => (effort && takes ? level : ""),
    /** The catalogue read again, where it came after the row was made: the picker lists it, the effort its levels. */
    relist() {
      picker.setModels(catalogue?.models() || []);
      picker.setFamilies(catalogue?.families?.() || []);
      picker.setAccounts(catalogue?.accounts?.() || []);
      picker.set(model);
      paintLevels();
    },
    ready,
    /** Words in its line until another model is shown: why what it is for did not start. @param {string} words */
    say: (words) => void (line.textContent = words),
    /** Held on the model shown, the reason on its title; null frees it. @param {string | null} why */
    hold: (why) => {
      picker.setLocked(why);
      const b = /** @type {HTMLButtonElement | null} */ (agentChip?.el || tuner?.el.querySelector("button") || null);
      if (b) b.disabled = !!why;
    },
  };
}
