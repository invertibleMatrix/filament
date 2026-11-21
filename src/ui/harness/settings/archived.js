// @ts-check
// Settings › Archived chats (HarnessV4_Settings_Plan HS-6, HS-D74): every chat you archived — its title, its project
// and when it last moved — with Unarchive, and every project you archived, its chats with it. A chat's title opens
// it. The sidebar's Archived filter stays; this is where everything archived is seen at once and brought back.
import { h } from "../../lib/dom.js";
import { api, readEvery } from "../lib/api.js";
import { routeFor } from "../lib/router.js";
import { button } from "../lib/ui.js";
import { sessionAge } from "../lib/labels.js";
import { WORDS } from "../lib/words.js";

/** What the page says with nothing archived. */
export const NOTHING_ARCHIVED = "No archived chats. Archive one from its ⋯ menu in the sidebar.";

/** The words under a chat's title: its project and how long since it last moved. @param {any} s */
export const chatMeta = (s) => [s.projectName || s.cwd || "No project", sessionAge(s.when)].filter(Boolean).join(" · ");

/** The words under a project's name: its folder and how many chats it keeps. @param {any} p */
export const projectMeta = (p) => {
  const n = Number(p.chains) || 0;
  return [p.cwd || "", `${n} chat${n === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
};

/**
 * @param {HTMLElement} body @param {{ onToast?: (msg: string, kind?: string) => void, onSessions?: () => void }} [cb]
 * @param {{ api?: (path: string, o?: any) => Promise<any> }} [io]  the admin API (a test's stand-in)
 */
export function renderArchived(body, cb = {}, io = {}) {
  const call = io.api || api;
  body.replaceChildren(h("p", { class: "set-note" }, "Reading the archive…"));
  const say = (/** @type {unknown} */ e) => cb.onToast?.(String(/** @type {any} */ (e)?.message || e), "err");
  const draw = async () => {
    let chats;
    let projects;
    try {
      // Every archived chat, page after page: the list is where all of them are seen at once.
      const [r, p] = await Promise.all([readEvery("/memory/sessions?kind=interactive,fork&archived=only", "sessions", { read: call }), call("/memory/projects")]);
      chats = r;
      projects = /** @type {any[]} */ (p?.projects || []).filter((x) => x.archived);
    } catch (e) {
      if (!body.isConnected) return;
      body.replaceChildren(h("p", { class: "set-error" }, `The archive could not be read: ${String(/** @type {any} */ (e)?.message || e)}`));
      return;
    }
    if (!body.isConnected) return;
    /** One thing brought back: the list reads again and the sidebar lists it. @param {() => Promise<unknown>} write @param {string} words */
    const bringBack = async (write, words) => {
      try {
        await write();
        cb.onToast?.(words);
        cb.onSessions?.();
        await draw();
      } catch (e) { say(e); }
    };
    const chatRow = (/** @type {any} */ s) => h("div", { class: "settings-row arch-row" },
      h("div", { class: "settings-row-text" },
        h("a", { class: "settings-row-label arch-open", href: routeFor("task", { id: s.id }), title: "Open this chat" }, s.title || s.preview || "untitled"),
        h("div", { class: "settings-row-desc" }, chatMeta(s))),
      h("div", { class: "shrink-0" }, button({
        label: "Unarchive", variant: "outline", size: "sm",
        onClick: () => bringBack(() => call(`/sessions/${encodeURIComponent(s.id)}/settings`, { method: "PATCH", body: { patch: { display: { archived: false } } } }), "chat unarchived — the sidebar lists it again"),
      })));
    const projectRow = (/** @type {any} */ p) => h("div", { class: "settings-row arch-row" },
      h("div", { class: "settings-row-text" },
        h("div", { class: "settings-row-label" }, p.name || p.cwd || p.id),
        h("div", { class: "settings-row-desc" }, projectMeta(p))),
      h("div", { class: "shrink-0" }, button({
        label: "Unarchive", variant: "outline", size: "sm",
        onClick: () => bringBack(() => call(`/memory/projects/${encodeURIComponent(p.id)}/archive`, { method: "POST", body: { archived: false } }), "project unarchived — the sidebar lists it and its chats again, and what runs by itself in it goes again"),
      })));
    body.replaceChildren(
      h("h3", { class: "nset-h" }, WORDS.chats),
      ...(chats.length ? chats.map(chatRow) : [h("p", { class: "nset-note" }, NOTHING_ARCHIVED)]),
      ...(projects.length ? [h("h3", { class: "nset-h" }, "Projects"), ...projects.map(projectRow)] : []),
    );
  };
  void draw();
}
