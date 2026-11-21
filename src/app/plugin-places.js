// @ts-check
// Where a plugin is on (HarnessV4_SpacesPlugins_Plan B3, B5; the Designer's §6 E, "Turn on for: All chats · Work · A
// project…"): your defaults, a project's (a Space's) or a chat's `plugins.on`, each written through its layer's one
// writer, as Settings › MCP servers writes `plugins.mcp`. Turned on at a place, a plugin is on in every chat there unless
// a narrower layer turns it off — a Space of your own's in the projects it shows too (the owner's word of 10-26) —;
// turned off where a broader layer has it on, the place says so with `enabled: false`; its hooks are a switch of their
// own (PL-D3). Uninstalled, it is taken off your defaults, every project and every chat.
import { PLUGINS_ON, mergePluginsOn } from "../services/session-settings.js";

/**
 * A place a plugin is turned on at, as the sheet names it.
 * @typedef {{ place: string, at: "global" | "project" | "session", projectId: string | null, chainId: string | null, label: string }} PluginPlace
 */

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * The places a list setting is kept at — your defaults, a Space of your own, a project, a chat — each read and written
 * through its layer's one writer: `plugins.on` here, `skills.on` (app/skill-places.js) the same way.
 * @param {{ sessions: any, memory: any, config: { get: () => any }, ownName?: (projectId: string) => string | null }} deps
 *   `sessions`: each layer's one writer (`patchDefaults`, `patchProjectSettings`, `patchSettings`) and a chat's facts
 *   (`launchInfo`); `ownName`: a Space of your own's name where the project is one
 * @param {string} knob  the setting's dotted path
 * @param {string} via  who a chat's change is said to come from
 */
export function placeLayers({ sessions, memory, config, ownName = () => null }, knob, via) {
  const [head, tail] = knob.split(".");
  /** A layer's list, nested or dotted; none where it holds none. @param {any} layer @returns {any[]} */
  const listIn = (layer) => {
    const v = layer?.[head]?.[tail] ?? layer?.[knob];
    return Array.isArray(v) ? v : [];
  };
  const archive = () => {
    const a = memory?.archive;
    if (!a) throw refused(503, "no archive: a project's and a chat's settings are kept in it");
    return a;
  };

  /** The place a word names: `all`, `project:<id>` or `chat:<id>`. @param {unknown} place @returns {PluginPlace} */
  function placeOf(place) {
    const s = String(place ?? "").trim();
    if (s === "all") return { place: "all", at: "global", projectId: null, chainId: null, label: "all chats" };
    const m = /^(project|chat):(.+)$/.exec(s);
    if (!m) throw refused(400, "say the place: all, project:<id> or chat:<id>");
    if (m[1] === "project") {
      const p = archive().getProject(m[2]);
      if (!p) throw refused(404, "There is no such project.");
      return { place: `project:${p.id}`, at: "project", projectId: p.id, chainId: null, label: ownName(p.id) || p.name || p.cwd || p.id };
    }
    const info = sessions.launchInfo(m[2]);
    if (!info) throw refused(404, "There is no such chat.");
    return { place: `chat:${m[2]}`, at: "session", projectId: info.projectId || null, chainId: m[2], label: "this chat" };
  }

  /**
   * The lists a place reads, broadest first, its own last, each with the place it is: your defaults, the Space of
   * your own that shows the project (its plugins reach the projects it shows, the owner's word of 10-26), the
   * project's, the chat's. @param {PluginPlace} p @returns {{ place: string, list: any[] }[]}
   */
  function placesOf(p) {
    const out = [{ place: "all", list: listIn(config.get()?.sessions?.defaults) }];
    const project = p.at !== "global" && p.projectId && archive().getProject(p.projectId) ? p.projectId : null;
    const space = project ? archive().spaceOf?.(project) || null : null;
    if (space && space !== project) out.push({ place: `project:${space}`, list: listIn(archive().projectSettings(space)) });
    if (project) out.push({ place: `project:${project}`, list: listIn(archive().projectSettings(project)) });
    if (p.at === "session" && p.chainId) out.push({ place: p.place, list: listIn(archive().chainSettings(p.chainId)) });
    return out;
  }
  /** The lists alone, broadest first, its own last. @param {PluginPlace} p */
  const layersOf = (p) => placesOf(p).map((x) => x.list);

  /** A place's own list written through its one writer; none left, the layer inherits again. @param {PluginPlace} p @param {any[]} next */
  function write(p, next) {
    const change = next.length ? { patch: { [knob]: next } } : { unset: [knob] };
    if (p.at === "global") sessions.patchDefaults(change);
    else if (p.at === "project") sessions.patchProjectSettings(p.projectId, change);
    else sessions.patchSettings(p.chainId, change, { via });
  }

  /**
   * Each list kept at your defaults and each project whose own layer holds one, with its place and label: what a
   * page's "where it is on" reads.
   * @returns {{ place: string, label: string, list: any[] }[]}
   */
  function kept() {
    const out = [{ place: "all", label: "all chats", list: listIn(config.get()?.sessions?.defaults) }];
    const a = memory?.archive;
    for (const pr of a?.projects?.() || []) {
      const list = listIn(a.projectSettings(pr.id));
      if (list.length) out.push({ place: `project:${pr.id}`, label: ownName(pr.id) || pr.name || pr.cwd || pr.id, list });
    }
    return out;
  }

  /**
   * An entry taken off your defaults, every project and every chat that names it (a plugin uninstalled, a skill
   * removed): a chat's own word left behind would turn on again whatever comes back under that name (Hunter's find).
   * @param {(e: any) => boolean} names
   */
  function forget(names) {
    const drop = (/** @type {PluginPlace} */ p, /** @type {any[]} */ list) => {
      if (list.some(names)) write(p, list.filter((e) => !names(e)));
    };
    drop(placeOf("all"), listIn(config.get()?.sessions?.defaults));
    const a = memory?.archive;
    for (const pr of a?.projects?.() || []) drop({ place: `project:${pr.id}`, at: "project", projectId: pr.id, chainId: null, label: "" }, listIn(a.projectSettings(pr.id)));
    for (const c of a?.chainLayers?.() || []) drop({ place: `chat:${c.id}`, at: "session", projectId: null, chainId: c.id, label: "" }, listIn(c.settings));
  }

  return { placeOf, placesOf, layersOf, write, kept, forget };
}

/**
 * @param {{ sessions: any, memory: any, config: { get: () => any }, ownName?: (projectId: string) => string | null }} deps
 *   as `placeLayers` takes them
 */
export function createPluginPlaces(deps) {
  const { placeOf, placesOf, layersOf, write, kept, forget } = placeLayers(deps, PLUGINS_ON, "Plugins");

  const api = {
    /**
     * A plugin turned on or off at a place, its hooks switched there: the place's own entry is what makes the
     * difference from the layers beneath it, and goes where it makes none. → where it stands at that place now.
     * @param {string} id @param {{ place: unknown, on: unknown, hooks?: unknown }} o
     */
    turn(id, { place, on, hooks }) {
      if (typeof on !== "boolean") throw refused(400, "say on: true or false");
      if (hooks != null && typeof hooks !== "boolean") throw refused(400, "hooks is true or false");
      const p = placeOf(place);
      const layers = layersOf(p);
      const own = layers.pop() || [];
      const beneath = mergePluginsOn(layers).find((x) => x.id === id) || null;
      // Off beneath by a broader place's word (a project that turned it off under its Space): turning it on here says
      // so, since an entry that only names it keeps what is beneath.
      const offBeneath = !beneath && layers.some((l) => l.some((e) => e?.id === id));
      const wantHooks = on && (typeof hooks === "boolean" ? hooks : !!own.find((e) => e?.id === id)?.hooks);
      const rest = own.filter((e) => e?.id !== id);
      /** @type {any} */
      let entry = null;
      if (on) entry = beneath && beneath.hooks === wantHooks ? null : { id, ...(offBeneath ? { enabled: true } : {}), ...(wantHooks ? { hooks: true } : beneath?.hooks ? { hooks: false } : {}) };
      else entry = beneath ? { id, enabled: false } : null;
      write(p, entry ? [...rest, entry] : rest);
      return api.at(id, p.place);
    },

    /** The plugins on at a place, as its chats get them: what the place's Connectors list shows the servers of. @param {unknown} place */
    onAt(place) {
      return mergePluginsOn(layersOf(placeOf(place)));
    },

    /** Where a plugin stands at a place: on or not, its hooks, and whether the place itself says so. @param {string} id @param {unknown} place */
    at(id, place) {
      const p = placeOf(place);
      const layers = layersOf(p);
      const now = mergePluginsOn(layers).find((x) => x.id === id) || null;
      const own = (layers.at(-1) || []).some((e) => e?.id === id);
      return { place: p.place, label: p.label, on: !!now, hooks: !!now?.hooks, here: own };
    },

    /** The project a place reads beneath it — a chat's, a project's own —; null for your defaults. @param {unknown} place */
    projectOf(place) {
      return placeOf(place).projectId;
    },

    /**
     * The narrowest place, of those a chat at `place` reads, whose own list turns the plugin on — where its values are
     * set for it (Finish setup… on a chat's row, the Designer's of 10-26); null where it is not on there.
     * @param {string} id @param {unknown} place
     */
    placeOn(id, place) {
      const layers = placesOf(placeOf(place));
      for (let i = layers.length - 1; i >= 0; i--) {
        const e = layers[i].list.find((x) => x?.id === id);
        if (e) return e.enabled === false ? null : layers[i].place;
      }
      return null;
    },

    /**
     * Where each plugin is turned on — your defaults and each project whose own layer names it —, by its id, for the
     * Plugins page. A chat's own switch is the chat's to show.
     * @returns {Record<string, { place: string, label: string, on: boolean, hooks: boolean }[]>}
     */
    everywhere() {
      /** @type {Record<string, { place: string, label: string, on: boolean, hooks: boolean }[]>} */
      const out = {};
      for (const { place, label, list } of kept())
        for (const e of list) if (e && typeof e.id === "string") (out[e.id] ||= []).push({ place, label, on: e.enabled !== false, hooks: e.hooks === true });
      return out;
    },

    /** An uninstalled plugin taken off your defaults and every project that names it. @param {string} id */
    forget(id) {
      forget((e) => e?.id === id);
    },
  };
  return api;
}
