// @ts-check
// The first-run tips (the owner's of 11-09: "small ftue bubbles floating around these elements … make this ftue system
// such that i should be able to disable any step"): the steps are a file the owner edits by hand,
// src/ui/harness/coach/coach.json, read at each ask so a page reload takes an edit; the steps seen are the data
// folder's (`ui.coach.seen`), in the app and a browser alike. With the file's `replayOnRestart` on, the first ask after
// Filament starts forgets them — and, with `replayWelcomeTour`, that the welcome tour was seen — once per start, so the
// owner sees every tip again after each Restart Filament.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendJson } from "../../app/pipeline/respond.js";
import { changeFields } from "../../app/config-fields.js";

/** The steps' file, beside the page's code that draws them. */
export const COACH_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "harness", "coach", "coach.json");
/** Where a bubble may stand of its target. */
export const COACH_PLACES = Object.freeze(["top", "bottom", "left", "right"]);
/** The steps seen the data folder keeps at most: the newest. */
const SEEN_MOST = 200;
/** How dark the page goes behind a tip where the file names none (the owner's of 11-09: "dim the background"). */
export const COACH_DIM = 0.7;
/** The darkest it may go: the page stays readable behind the bubble. */
const DIM_MOST = 0.9;

/**
 * @typedef {{ id: string, enabled: boolean, group: string, target: string, when: string, after: string,
 *   place: string, title: string, text: string, dim: number | null }} CoachStep  `dim`: its own shade, null for the file's
 */

/** @param {unknown} v */
const words = (v) => (typeof v === "string" ? v.trim() : "");
/** A shade as the file spells one: a number from 0, none, to `DIM_MOST`; null for anything else. @param {unknown} v */
const shadeOf = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= DIM_MOST ? v : null);
/** What a shade that is none says. @param {string} who @param {unknown} v @param {string} then */
const shadeWords = (who, v, then) => `${who}: dim is a number from 0 to ${DIM_MOST}, not ${JSON.stringify(v)}: ${then}`;

/**
 * The steps' file read: its switches, how dark the page goes behind a tip (`dim`, a step's own over it), and its steps,
 * each as the page draws it, and what is wrong with any, in words — a step with no id or no target, or an id named
 * twice, is left out; an `after` that names no step keeps its step from ever showing; a shade out of bounds is the
 * file's own. A file that is not JSON is refused whole, in words.
 * @param {string} text
 * @returns {{ ok: true, enabled: boolean, replayOnRestart: boolean, replayWelcomeTour: boolean, dim: number, steps: CoachStep[], problems: string[] }
 *   | { ok: false, error: string }}
 */
export function readCoach(text) {
  /** @type {any} */
  let doc;
  try {
    doc = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `coach.json is not JSON: ${e?.message || e}` };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, error: "coach.json is not an object of { enabled, steps }" };
  /** @type {string[]} */
  const problems = [];
  if (!Array.isArray(doc.steps)) problems.push("coach.json has no steps list");
  // A shade left out, or null, is none given.
  const unsaid = (/** @type {unknown} */ v) => v === undefined || v === null;
  let dim = COACH_DIM;
  if (!unsaid(doc.dim) && shadeOf(doc.dim) === null) problems.push(shadeWords("coach.json", doc.dim, `${COACH_DIM} is used`));
  else if (!unsaid(doc.dim)) dim = /** @type {number} */ (shadeOf(doc.dim));
  /** @type {CoachStep[]} */
  const steps = [];
  for (const [i, s] of (Array.isArray(doc.steps) ? doc.steps : []).entries()) {
    const id = words(s?.id);
    if (!id) {
      problems.push(`step ${i + 1} has no id: it is left out`);
      continue;
    }
    if (steps.some((x) => x.id === id)) {
      problems.push(`${id} is named twice: the second is left out`);
      continue;
    }
    const target = words(s.target);
    if (!target) {
      problems.push(`${id} names no target: it is left out`);
      continue;
    }
    const place = words(s.place);
    if (place && !COACH_PLACES.includes(place)) problems.push(`${id}: place is one of ${COACH_PLACES.join(", ")}, not ${place}`);
    const own = unsaid(s.dim) ? null : shadeOf(s.dim);
    if (!unsaid(s.dim) && own === null) problems.push(shadeWords(id, s.dim, "the file's is used"));
    steps.push({ id, enabled: s.enabled !== false, group: words(s.group), target, when: words(s.when), after: words(s.after), place: COACH_PLACES.includes(place) ? place : "bottom", title: words(s.title), text: words(s.text), dim: own });
  }
  for (const s of steps) if (s.after && !steps.some((x) => x.id === s.after)) problems.push(`${s.id} comes after ${s.after}, which is no step: it never shows`);
  return { ok: true, enabled: doc.enabled !== false, replayOnRestart: doc.replayOnRestart === true, replayWelcomeTour: doc.replayWelcomeTour !== false, dim, steps, problems };
}

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function coachRoutes(a) {
  const { config } = a;
  /** Whether this start of Filament replayed the tips already: the admin handler is made once per start. */
  let replayed = false;
  /** The file asked: the tests' own where they name one. */
  const file = () => process.env.FILAMENT_COACH_FILE || COACH_FILE;
  /** @returns {string[]} */
  const seenNow = () => {
    const s = config.get()?.ui?.coach?.seen;
    return Array.isArray(s) ? s.map(String) : [];
  };
  return [
    [
      "GET",
      "/coach",
      (r) => {
        /** @type {string} */
        let text;
        try {
          text = readFileSync(file(), "utf8");
        } catch (/** @type {any} */ e) {
          return sendJson(r.res, 200, { enabled: false, steps: [], seen: seenNow(), error: `coach.json could not be read: ${e?.code || e?.message || e}` });
        }
        const c = readCoach(text);
        if (!c.ok) return sendJson(r.res, 200, { enabled: false, steps: [], seen: seenNow(), error: c.error });
        let again = false;
        if (c.replayOnRestart && !replayed) {
          replayed = true;
          again = true;
          changeFields(config, { set: { "ui.coach.seen": [], ...(c.replayWelcomeTour ? { "ui.welcome.seen": false } : {}) } });
        }
        return sendJson(r.res, 200, { enabled: c.enabled, dim: c.dim, steps: c.steps, seen: seenNow(), replayed: again, replayWelcomeTour: again && c.replayWelcomeTour, problems: c.problems });
      },
    ],
    [
      "POST",
      "/coach/seen",
      async (r) => {
        const b = (await r.json()) || {};
        const ids = Array.isArray(b.ids) ? b.ids.map(words).filter(Boolean) : [];
        if (!ids.length) return sendJson(r.res, 400, { error: "name the tips seen: { ids: [id] }" });
        changeFields(config, { set: { "ui.coach.seen": [...new Set([...seenNow(), ...ids])].slice(-SEEN_MOST) } });
        return sendJson(r.res, 200, { seen: seenNow() });
      },
    ],
    // Show tips again (the command center's, Product's review of 11-09): every tip is to see once more.
    [
      "POST",
      "/coach/reset",
      (r) => {
        if (seenNow().length) changeFields(config, { set: { "ui.coach.seen": [] } });
        return sendJson(r.res, 200, { seen: seenNow() });
      },
    ],
  ];
}
