// @ts-check
// One place's settings, for the pages in New chats (HarnessV4_Settings_Plan HS-D39): all chats — your defaults,
// `GET|PATCH /api/defaults/settings` — or one project's own layer, `GET|POST /api/projects/:id/settings`. A page reads
// its rows through it — each knob's value there, whether the place may hold the knob, whether it holds its own, where
// the value comes from in words (HS-D40) — and writes through it: one change, then the place as it now stands, and
// the words its toast says. Built with an injected `api`, so a page runs on the fake DOM.
import { api } from "./api.js";
import { flattenLayer, nestLayer } from "../../lib/settings/editor.js";
import { settingChangeWords } from "./labels.js";

/** Where a value comes from, as a row says it under All chats. */
const FROM_ALL = Object.freeze({ yours: "Set for all chats", dashboard: "From the console's rules", default: "Filament's default" });
/** And under a project. */
const FROM_PROJECT = Object.freeze({ project: "Set for this project", global: "From all chats", default: "Filament's default" });

/** @typedef {{ tool: string, pattern: string, verdict: string, learned?: boolean }} Rule */

/**
 * @param {string} scope  "all", or `project:<id>`
 * @param {{ api?: (path: string, o?: any) => Promise<any> }} [io]
 */
export function placeSettings(scope, io = {}) {
  const call = io.api || api;
  const projectId = scope.startsWith("project:") ? scope.slice("project:".length) : null;
  const route = projectId ? `/projects/${encodeURIComponent(projectId)}/settings` : "/defaults/settings";
  /** @type {any} */
  let doc = null;
  const flat = () => (projectId ? doc?.resolved?.flat : doc?.flat) || {};
  const sources = () => (projectId ? doc?.resolved?.sources : doc?.sources) || {};
  const read = async () => { doc = await call(route); };
  const name = () => (projectId ? String(doc?.name || projectId) : "all chats");

  /**
   * One change, written, then the place read again; the toast's words, or what refused it.
   * @param {{ patch?: Record<string, any>, unset?: string[] }} change  `patch` as dotted paths
   * @returns {Promise<{ ok: true, words: string } | { ok: false, words: string }>}
   */
  async function write(change) {
    const patch = nestLayer(change.patch || {});
    const body = { ...(Object.keys(patch).length ? { patch } : {}), ...(change.unset?.length ? { unset: change.unset } : {}) };
    try {
      const r = await call(route, { method: projectId ? "POST" : "PATCH", body });
      if (projectId) await read();
      else doc = r;
      return { ok: true, words: changedWords(r?.changes || [], change.unset || []) };
    } catch (/** @type {any} */ e) {
      await read().catch(() => {});
      return { ok: false, words: String(e?.message || e) };
    }
  }

  /** @param {{ path: string }[]} changes @param {string[]} unset */
  function changedWords(changes, unset) {
    const paths = changes.map((c) => String(c.path));
    if (!paths.length) return "Nothing changed";
    const taken = new Set(unset);
    const what = paths.map((p) => (taken.has(p) ? settingChangeWords(p) : settingChangeWords(p, flat()[p]))).join(" · ");
    return projectId
      ? `${what} in ${name()} — its chats that have not chosen their own take it from their next request`
      : `Your default changed: ${what} — every chat that has not chosen its own takes it from its next request`;
  }

  return {
    projectId,
    read,
    name,
    /** The document as read, for what only one place has. */
    doc: () => doc,
    /** The value in force here. @param {string} path */
    value: (path) => flat()[path],
    /** Whether this place may hold the knob: a project holds only the knobs of a repo (HarnessV4 D3). @param {string} path */
    holds: (path) => (projectId ? Object.hasOwn(doc?.knobs || {}, path) : Object.hasOwn(flat(), path)),
    /** Whether this place holds its own value. @param {string} path */
    own: (path) => sources()[path] === (projectId ? "project" : "yours"),
    /** The place's own value as written, apart from what it adds to (a list that adds up). @param {string} path */
    ownValue: (path) => flattenLayer(doc?.layer || {})[path],
    /** Under a project, the value all chats give it. @param {string} path */
    under: (path) => (projectId ? flattenLayer(doc?.resolved?.layers?.global || {})[path] : undefined),
    /** Where the value comes from, in the row's words. @param {string} path */
    from: (path) => {
      const s = String(sources()[path] || "default");
      return (projectId ? FROM_PROJECT : FROM_ALL)[/** @type {never} */ (s)] || FROM_ALL.default;
    },
    write,
    /**
     * Forget one rule of this place's (HC-56, HC-82): under a project the server takes a remembered permission back
     * as the chat's switch does and drops the rule from the project's list; for all chats the list is written without
     * it, and unset when it empties.
     * @param {Rule} rule
     * @returns {Promise<{ ok: boolean, words: string }>}
     */
    async forgetRule(rule) {
      if (projectId) {
        try {
          await call(`/projects/${encodeURIComponent(projectId)}/rules/forget`, { method: "POST", body: { tool: rule.tool, pattern: rule.pattern, verdict: rule.verdict } });
          await read();
          return { ok: true, words: `Forgotten in ${name()}: the next such call asks` };
        } catch (/** @type {any} */ e) {
          return { ok: false, words: String(e?.message || e) };
        }
      }
      const list = (Array.isArray(flat()["loop.rules"]) ? flat()["loop.rules"] : []).filter((/** @type {Rule} */ r) => !(r.tool === rule.tool && r.pattern === rule.pattern && r.verdict === rule.verdict));
      const r = await write(list.length ? { patch: { "loop.rules": list } } : { unset: ["loop.rules"] });
      return r.ok ? { ok: true, words: "Forgotten for all chats: the next such call asks" } : r;
    },
  };
}

/** @typedef {ReturnType<typeof placeSettings>} Place */
