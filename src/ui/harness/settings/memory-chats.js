// @ts-check
// Settings › Memory › a project (HarnessV4_Settings_Plan HS-3, HS-D47; the owner's of 11-09: "memory system is core").
// Memory is on in every chat, its parts with it: no row here turns one off for every new chat — memory's one off
// switch is Settings › Experimental's. "Applies to" picks the place (settings/place-page.js): under All chats one line
// says what a project holds; under a project, whether it is left out of memory — its folder in
// `memory.capture.excludeFolders`, so its chats get no capture, no recall and no sub-agent brief — and whether memory
// reads its chats and they are searchable (`privacy.learn`, `privacy.index`, knobs a project holds). Built with an
// injected `h`, `api` and menu, so it runs on the fake DOM.
import { api } from "../lib/api.js";
import { toggle } from "../lib/fields.js";
import { mountPlacePage } from "./place-page.js";

/** Settings search's words for these rows (search.js, HS-D68): each row drawn, checked against the code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { label: "A project's memory", words: "project exclude private" },
  { label: "Leave this project out of memory", words: "exclude excluded folder private client work recall capture" },
  { label: "Memory reads its chats", words: "learn learner privacy" },
  { label: "Searchable", words: "search index session search privacy" },
]);

/** The switch that leaves a project out, by its row's name. */
const LEAVE_OUT = "Leave this project out of memory";

/** A folder as memory's exclusion compares it (brain.js `capturedFolder`): slashes forward, none at the end, any case. @param {unknown} p */
const folderKey = (p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * @param {HTMLElement} host
 * @param {import("./place-page.js").PageCallbacks} [cb]
 * @param {import("./place-page.js").PageIo} [io]
 */
export function renderMemoryChats(host, cb = {}, io = {}) {
  mountPlacePage(host, cb, io, {
    say: (project) => (project ? `Chats in ${project.name}.` : "Every chat."),
    rows: memoryChatRows,
  });
}

/**
 * @param {import("./place-page.js").Kit} kit @param {import("./place-page.js").Project | null} project
 */
export function memoryChatRows(kit, project) {
  const { head, row, switchRow } = kit;
  if (!project) return [head("A project"), row("A project's memory", "Pick a project above to leave it out of memory, or to keep its chats from being read or searched.", null)];
  return [
    head("This project"),
    leaveOutRow(kit, project),
    switchRow("privacy.learn", "Memory reads its chats", "Memory reads a finished chat of this project and keeps what will matter later. Off: it learns nothing from them; they still get what memory holds.", true),
    switchRow("privacy.index", "Searchable", "This project's chats are in the search index, where memory's session search finds them. Off: they are taken out of it; on again, they are indexed again.", true),
  ];
}

/**
 * Leave this project out of memory (the owner's of 11-09): its folder written into `memory.capture.excludeFolders`,
 * the configuration's, and taken out again — read from `GET /api/state`, kept through `PATCH /api/config/fields` with
 * the version read, so a list changed elsewhere since is refused, not overwritten. A folder above it in the list keeps
 * it out too, which this switch cannot undo: it says so.
 * @param {import("./place-page.js").Kit} kit @param {import("./place-page.js").Project} project
 */
function leaveOutRow(kit, project) {
  const { m, place, cb, io } = kit;
  const call = io.api || api;
  const folder = String(place.doc()?.cwd || "");
  const key = folderKey(folder);
  const control = m("div", { class: "shrink-0" });
  const words = m("div", { class: "settings-row-desc" });
  /** Its words, and why it stays out where a folder above it is left out. @param {string} [more] */
  const say = (more = "") =>
    words.replaceChildren(key
      ? `Its chats get no memory: nothing is recalled into them, nothing is learned from them, and their sub-agents' briefs carry none — in Filament and in every app that works in ${folder}. Each chat keeps its own turns all the same.${more ? ` ${more}` : ""}`
      : "This project has no folder memory knows, so it cannot be left out here.");
  say();
  const paint = async () => {
    if (!key) return;
    /** @type {any} */
    let st;
    try {
      st = await call("/state");
    } catch (/** @type {any} */ e) {
      return void control.replaceChildren(m("span", { class: "set-error" }, `Not read: ${String(e?.body?.error || e?.message || e)}`));
    }
    /** @type {string[]} */
    const list = (Array.isArray(st?.config?.memory?.capture?.excludeFolders) ? st.config.memory.capture.excludeFolders : []).map(String);
    const own = list.some((f) => folderKey(f) === key);
    const above = list.find((f) => { const k = folderKey(f); return !!k && k !== key && key.startsWith(`${k}/`); });
    say(above ? `It is out now: ${above} is left out of memory, and this project is inside it.` : "");
    const out = own || !!above;
    control.replaceChildren(toggle(m, out, LEAVE_OUT, async () => {
      if (!own && above) return void cb.onToast?.(`It stays out: ${above} is left out of memory, and ${project.name} is inside it`, "err");
      const next = out ? list.filter((f) => folderKey(f) !== key) : [...list, folder];
      try {
        await call("/config/fields", { method: "PATCH", body: { set: { "memory.capture.excludeFolders": next }, base: st?.configVersion } });
        cb.onToast?.(out ? `${project.name} is in memory again from its chats' next request` : `${project.name} is left out of memory from its chats' next request`);
        cb.onChanged?.();
      } catch (/** @type {any} */ e) {
        cb.onToast?.(e?.body?.stale ? "Not changed: memory's folders were changed elsewhere since this page read them, and show that now" : `Not changed: ${String(e?.body?.error || e?.message || e)}`, "err");
      }
      void paint();
    }));
  };
  void paint();
  return m("div", { class: "settings-row nset-row" },
    m("div", { class: "settings-row-text" }, m("div", { class: "settings-row-label" }, LEAVE_OUT), words),
    control);
}
