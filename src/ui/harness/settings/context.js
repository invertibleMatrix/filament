// @ts-check
// Settings › Context, titled How earlier turns are kept (HarnessV4_Tasks U3-8, UX-13; proposal_ux §4.16): how earlier
// turns reach the model where a chat has not chosen its own. The sheet of the same name (how-sheet.js) draws its All new
// chats and a project's levels from here (`mountContext`, `projectContext`). It is the Context tab's section (panes/context-how.js) drawn over your defaults — the global layer's own
// document, `GET|PATCH /api/defaults/settings` — so the two can never say different words: The line, When the chat is
// full, Summaries written by, Other agents' results (sealed or whole, HarnessV4_Envelopes_Plan EN5), and under Advanced Every turn, how room is made, the cold cache, a coding agent's way
// and its fresh start, Filament's copy and the finer knobs (U11). A chat
// takes each of these where it has not chosen its own. Outside clients' requests keep following the dashboard's rules.
// "Applies to" a project says that its chats take these, since a project holds none of them.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { settingChangeWords } from "../lib/labels.js";
import { howSection } from "../panes/context-how.js";
import { appliesTo } from "../lib/applies-to.js";

/** Settings search's words for this page (search.js, HS-D68): the section's parts as it draws them over your
 *  defaults, checked against the drawn page by a test, and the row a project shows instead. */
export const SEARCH_ROWS = Object.freeze([
  { label: "Your line", words: "the line compaction threshold window percent when the chat is full" },
  { label: "Then", words: "ask me just do it ask before making room compact a message past the line" },
  { label: "Back after a break", words: "the cache is cold send as it is just send" },
  { label: "After an update", words: "filament updated mcp server connected tool switched what the chat sends ahead changed send as it is just send" },
  { label: "The way", words: "how it makes room method one summary folded drop old tool results" },
  { label: "A coding agent's way", words: "claude code codex its own compaction" },
  { label: "Summaries written by", words: "writer summary compaction model" },
  { label: "While your agent works", words: "other agents' results envelopes sealed whole a sub-agent's report a team's result a flow's end" },
  // What waits under Advanced (U11) is found by its words there: the search lights Advanced.
  { label: "Advanced", words: "what every request carries every turn tool results one line pointers a fresh start carry Filament's copy keep the copy in step" },
  { label: "How earlier turns reach the model" },
]);

/** A defaults source as the section's parts read a session's: yours is the layer being edited, the dashboard's rules
 *  the one under it. */
const AS_LAYER = Object.freeze({ yours: "session", dashboard: "global", default: "default" });

/**
 * Your defaults as the session view the section reads (`{ settings }`): the document's flat and effective values, a
 * source per knob in a session's words, Filament's loop's rows (`native`), no window — there is no chat to measure.
 * Null until the document is read.
 * @param {any} doc  the defaults' answer
 */
export function defaultsView(doc) {
  if (!doc) return null;
  /** @type {Record<string, string>} */
  const sources = {};
  for (const [path, from] of Object.entries(doc.sources || {})) sources[path] = AS_LAYER[/** @type {keyof typeof AS_LAYER} */ (from)] || "default";
  return {
    settings: { hash: String(doc.hash || ""), native: true, sources, window: null, flat: doc.flat || {}, effective: doc.effective || {} },
    facts: null,
    windows: [],
  };
}

/** Where new chats start, in one line. */
export const START_WORDS = "New chats start from these.";

/** What a write did, for its toast. @param {any} r  the route's answer @param {{ unset?: string[] }} change */
const changeWords = (r, change) => {
  const paths = (r?.changes || []).map((/** @type {any} */ c) => String(c.path));
  if (!paths.length) return "Nothing changed";
  const taken = new Set(change.unset || []);
  return `Your default changed: ${paths.map((p) => (taken.has(p) ? settingChangeWords(p) : settingChangeWords(p, r.flat?.[p]))).join(" · ")} — every chat that has not chosen its own takes it from its next request`;
};

/**
 * The section, mounted: the document read once, drawn, and drawn again from each write's answer. `ready` settles when
 * the first read has; `write` is the section's one writer.
 * @param {any} host
 * @param {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void }} cb
 * @param {{ h?: typeof h, drawIn?: (parent: any, nodes: any[]) => void, api?: typeof api, modelSelect?: any, models?: () => any[] }} [io]
 * @returns {{ ready: Promise<void>, write: (change: { patch?: any, unset?: string[] }) => Promise<void> }}
 */
export function mountContext(host, cb, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  /** @type {any} */
  let doc = null;
  /** @type {{ el: any, repaint: (force?: boolean) => void } | null} */
  let section = null;
  const start = m("p", { class: "set-desc set-context-start" }, START_WORDS);
  const box = m("div", { class: "set-context" });
  host.replaceChildren(start, box);
  /** @param {{ patch?: any, unset?: string[] }} change */
  const write = async (change) => {
    try {
      const r = await call("/defaults/settings", { method: "PATCH", body: { ...(change.patch ? { patch: change.patch } : {}), ...(change.unset?.length ? { unset: change.unset } : {}) } });
      doc = r;
      cb.onToast?.(changeWords(r, change));
      section?.repaint(true);
      // An open chat that has not chosen the knob takes it too: its document is read again.
      if (r?.changes?.length) cb.onChanged?.();
    } catch (/** @type {any} */ e) {
      cb.onToast?.(String(e?.message || e), "err");
    }
  };
  /** @type {any} */
  const ctx = {
    view: () => defaultsView(doc),
    hasSession: () => false,
    live: () => ({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false, agent: false }),
    turns: () => [],
    write,
    models: () => io.models?.() || [],
    accounts: { session: () => null },
    // No chat: nothing to weigh, compact or scroll to.
    preview: async () => ({}),
    undoCompaction: () => {},
    scrollToTurn: () => false,
    toast: (/** @type {string} */ msg, /** @type {string} */ kind) => cb.onToast?.(msg, kind),
  };
  const ready = Promise.resolve(call("/defaults/settings")).then(
    (d) => {
      doc = d;
      section = howSection(ctx, { h: m, drawIn: io.drawIn, key: "settings-context", defaults: true, ...(io.modelSelect ? { modelSelect: io.modelSelect } : {}) });
      box.replaceChildren(section.el);
    },
    (e) => { box.replaceChildren(m("p", { class: "set-error" }, `Your defaults could not be read: ${String(e?.message || e)}`)); },
  );
  return { ready, write };
}

/**
 * A project's level: these are a chat's own choices, which a project does not hold (HC-57), so its chats take all
 * chats'.
 * @param {any} host
 */
export function projectContext(host) {
  host.replaceChildren(h("div", { class: "settings-row nset-row" },
    h("div", { class: "settings-row-text" },
      h("div", { class: "settings-row-label" }, "How earlier turns reach the model"),
      h("div", { class: "settings-row-desc" }, "These are a chat's own choices, which a project does not hold: its chats take what All chats sets."))));
}

/**
 * @param {HTMLElement} body
 * @param {import("./page.js").SectionCallbacks} cb
 */
export function renderContext(body, cb) {
  let models = /** @type {any[]} */ ([]);
  // The writer's model picker lists the models that can answer; the list arrives beside the document.
  api("/models?all=1").then((c) => { models = c?.models || c?.data || []; }, () => {});
  // "Applies to" (HarnessV4_Settings_Plan HS-D47): all chats is your defaults; every knob here is a chat's own choice,
  // which a project does not hold, so under a project the page says its chats take all chats' (HC-57).
  const host = h("div", {});
  const control = appliesTo({
    onToast: cb.onToast,
    onPick: (scope, project) => {
      if (scope === "all" || !project) {
        control.say("Every chat that has not chosen its own.");
        mountContext(host, cb, { models: () => models });
        return;
      }
      control.say(`Chats in ${project.name}.`);
      projectContext(host);
    },
  });
  body.replaceChildren(control.el, host);
  control.start();
}
