// @ts-check
// Where a skill is on (HarnessV4_Skills_Plan S1-6, the Designer's Library › Skills of 10-27: "Applies to" along the
// top, a switch per skill for the place picked): your defaults, a Space of your own (its projects too), a project or a
// chat's `skills.on`, each written through its layer's one writer, as a plugin's is (app/plugin-places.js). Turned on
// at a place, a skill is on in every chat there unless a narrower layer turns it off; turned off where a broader layer
// has it on, the place says so with `enabled: false`. Removed from Library › Skills, it is taken off your defaults,
// every project and every chat.
import { SKILLS_ON, mergeSkillsOn } from "../services/session-settings.js";
import { placeLayers } from "./plugin-places.js";

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/** Whether an entry names a skill, without case. @param {any} e @param {string} name */
const names = (e, name) => typeof e?.name === "string" && e.name.toLowerCase() === name.toLowerCase();

/**
 * @param {{ sessions: any, memory: any, config: { get: () => any }, ownName?: (projectId: string) => string | null }} deps
 *   as `placeLayers` takes them
 */
export function createSkillPlaces(deps) {
  const { placeOf, placesOf, layersOf, write, kept, forget } = placeLayers(deps, SKILLS_ON, "Skills");

  const api = {
    /**
     * A skill turned on or off at a place: the place's own entry is what makes the difference from the layers beneath
     * it, and goes where it makes none; `on: null` takes the place's own word back, to what it inherits. → where it
     * stands at that place now.
     * @param {string} name @param {{ place: unknown, on: unknown }} o
     */
    turn(name, { place, on }) {
      if (on !== null && typeof on !== "boolean") throw refused(400, "say on: true, false, or null for what it inherits");
      const p = placeOf(place);
      const layers = layersOf(p);
      const own = layers.pop() || [];
      const beneath = mergeSkillsOn(layers).some((x) => names(x, name));
      // Off beneath by a broader place's word: turning it on here says so, since an entry that only names it keeps
      // what is beneath.
      const offBeneath = !beneath && layers.some((l) => l.some((e) => names(e, name)));
      const rest = own.filter((e) => !names(e, name));
      const entry = on === null ? null : on ? (beneath ? null : { name, ...(offBeneath ? { enabled: true } : {}) }) : beneath ? { name, enabled: false } : null;
      write(p, entry ? [...rest, entry] : rest);
      return api.at(name, p.place);
    },

    /**
     * Where a skill stands at a place: on or not, whether the place itself says so, and the place beneath that turns it
     * on where it is on from there (`from`).
     * @param {string} name @param {unknown} place
     */
    at(name, place) {
      const p = placeOf(place);
      const layers = placesOf(p);
      const on = mergeSkillsOn(layers.map((l) => l.list)).some((x) => names(x, name));
      const here = (layers.at(-1)?.list || []).some((e) => names(e, name));
      let from = null;
      if (on && !here)
        for (let i = layers.length - 2; i >= 0; i--) {
          const e = layers[i].list.find((x) => names(x, name));
          if (e && e.enabled !== false) {
            from = layers[i].place;
            break;
          }
        }
      return { place: p.place, label: p.label, on, here, from };
    },

    /** The skills on at a place, by name, as its chats get them. @param {unknown} place */
    onAt(place) {
      return mergeSkillsOn(layersOf(placeOf(place))).map((x) => x.name);
    },

    /** The place a word names, with its label. @param {unknown} place */
    placeOf(place) {
      const p = placeOf(place);
      return { place: p.place, label: p.label, projectId: p.projectId, chainId: p.chainId };
    },

    /**
     * Where each skill is turned on or off — your defaults and each project whose own layer names it —, by its name
     * without case, for a skill's page. A chat's own switch is the chat's to show.
     * @returns {Record<string, { place: string, label: string, on: boolean }[]>}
     */
    everywhere() {
      /** @type {Record<string, { place: string, label: string, on: boolean }[]>} */
      const out = {};
      for (const { place, label, list } of kept())
        for (const e of list) if (typeof e?.name === "string") (out[e.name.toLowerCase()] ||= []).push({ place, label, on: e.enabled !== false });
      return out;
    },

    /** A removed skill taken off your defaults, every project and every chat that names it. @param {string} name */
    forget(name) {
      forget((e) => names(e, name));
    },
  };
  return api;
}
