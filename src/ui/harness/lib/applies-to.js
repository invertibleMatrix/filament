// @ts-check
// "Applies to" (HarnessV4_Settings_Plan HS-D6): the one control at the top of Library › Plugins & Connectors' connectors and of every page
// in New chats. All chats is your defaults; each Space of yours is a button of its own (the owner's word of 10-26:
// "Work", "Personal" — past three they fold into A Space ▾); A project ▾ picks one of the sidebar's projects (archived
// ones and your Spaces left out), whose own layer the page then shows and writes. The page hears each pick and says,
// beside the control, what it means there. A page may open on a project or Space already picked: a Space's Project
// settings (proposal_ux §4.16). Built with an injected `h`, `api` and menu, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "./api.js";
import { menu } from "./ui.js";

/**
 * A place the control picks: a project, or a Space of yours (`space`) with how many projects it shows (`shows`).
 * @typedef {{ id: string, name: string, space?: boolean, shows?: number }} Project
 */

/** How many Spaces of yours stand as buttons of their own; more fold into A Space ▾. */
export const SPACES_SHOWN = 3;

/**
 * @param {{ onPick: (scope: string, project: Project | null) => void, onToast?: (msg: string, kind?: string) => void, label?: string }} o
 *   `onPick` hears "all", or `project:<id>` with the project or Space, once at the start and on every pick; `label`, the
 *   words before it where the page names what it sets (Skills: "Always on in"), else "Applies to".
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, menu?: typeof menu }} [io]
 * @returns {{ el: HTMLElement, say: (words: string) => void, start: (project?: string | null) => void }}
 *   `say`: the words beside the control; `start`: the first pick, made once the page has mounted its parts — All chats,
 *   or the project or Space of that id once the lists have named it (All chats where they name none)
 */
export function appliesTo(o, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openMenu = io.menu || menu;
  /** @type {Project[]} */
  let projects = [];
  /** @type {Project[]} */
  let spaces = [];
  let read = false;
  /** @type {Project | null} */
  let project = null;
  let scope = "all";
  const allBtn = m("button", { class: "set-seg-btn", type: "button", role: "tab", onclick: () => go("all") }, "All chats");
  const projectBtn = m("button", { class: "set-seg-btn set-scope-project", type: "button", role: "tab", "aria-haspopup": "menu", onclick: () => void pick() }, "A project ▾");
  /** The Spaces' buttons, drawn once they are read: one each, or A Space ▾ past SPACES_SHOWN. @type {HTMLElement[]} */
  let spaceBtns = [];
  const label = o.label || "Applies to";
  const seg = m("div", { class: "set-seg", role: "tablist", "aria-label": label }, allBtn, projectBtn);
  const note = m("span", { class: "set-scope-note" });
  const el = m("div", { class: "set-scope" }, m("span", {}, label), seg, note);

  const folded = () => spaces.length > SPACES_SHOWN;
  /** @param {HTMLElement} b @param {boolean} on */
  const mark = (b, on) => {
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  };

  /** The Spaces' buttons, between All chats and A project ▾. */
  function drawSpaces() {
    spaceBtns = folded()
      ? [m("button", { class: "set-seg-btn set-scope-space", type: "button", role: "tab", "aria-haspopup": "menu", onclick: () => pickSpace() }, "A Space ▾")]
      : spaces.map((s) => m("button", { class: "set-seg-btn set-scope-space", type: "button", role: "tab", "data-space": s.id, onclick: () => { project = s; go(`project:${s.id}`); } }, s.name));
    seg.replaceChildren(allBtn, ...spaceBtns, projectBtn);
    paint();
  }

  /** @param {string} next */
  function go(next) {
    scope = next;
    paint();
    o.onPick(scope, scope === "all" ? null : project);
  }

  /** The buttons as the pick stands. */
  function paint() {
    const onAll = scope === "all";
    const onSpace = !onAll && !!project?.space;
    mark(allBtn, onAll);
    if (folded()) {
      mark(spaceBtns[0], onSpace);
      spaceBtns[0].replaceChildren(`${onSpace && project ? project.name : "A Space"} ▾`);
    } else spaceBtns.forEach((b, i) => mark(b, onSpace && spaces[i]?.id === project?.id));
    mark(projectBtn, !onAll && !onSpace);
    projectBtn.replaceChildren(`${project && !onAll && !onSpace ? project.name : "A project"} ▾`);
  }

  /**
   * The projects and your Spaces, read once; false where the projects' read failed, which is said unless `quiet` (the
   * page's first read, for the Spaces' buttons).
   */
  async function readPlaces(quiet = false) {
    if (read) return true;
    try {
      // Your Spaces where Filament keeps none: no buttons of their own, every project as it was.
      const [r, own] = await Promise.all([call("/memory/projects"), call("/spaces/own").catch(() => null)]);
      const known = new Set((r?.projects || []).filter((/** @type {any} */ p) => !p.archived).map((/** @type {any} */ p) => String(p.id)));
      spaces = (Array.isArray(own?.spaces) ? own.spaces : [])
        .filter((/** @type {any} */ s) => s && known.has(String(s.project)))
        .map((/** @type {any} */ s) => ({ id: String(s.project), name: String(s.name || s.project), space: true, shows: (s.shows || []).filter((/** @type {any} */ p) => known.has(String(p))).length }));
      const isSpace = new Set(spaces.map((s) => s.id));
      projects = (r?.projects || []).filter((/** @type {any} */ p) => known.has(String(p.id)) && !isSpace.has(String(p.id))).map((/** @type {any} */ p) => ({ id: String(p.id), name: String(p.name || p.cwd || p.id) }));
      read = true;
      drawSpaces();
      return true;
    } catch (e) {
      if (!quiet) o.onToast?.(String(/** @type {any} */ (e)?.message || e), "err");
      return false;
    }
  }

  async function pick() {
    if (!(await readPlaces())) return;
    openMenu(projects.length
      ? projects.map((p) => ({ type: "radio", label: p.name, checked: scope === `project:${p.id}`, onClick: () => { project = p; go(`project:${p.id}`); } }))
      : [{ type: "label", label: "No projects yet: a chat's folder makes one" }], { anchor: projectBtn });
  }

  /** A Space ▾, past SPACES_SHOWN of them. */
  function pickSpace() {
    openMenu(spaces.map((s) => ({ type: "radio", label: s.name, checked: scope === `project:${s.id}`, onClick: () => { project = s; go(`project:${s.id}`); } })), { anchor: spaceBtns[0] });
  }

  /** @param {string | null} [want] */
  async function start(want = null) {
    if (!want) {
      go("all");
      // The Spaces' buttons come once they are read; the pick stands.
      await readPlaces(true);
      return;
    }
    await readPlaces();
    const p = [...spaces, ...projects].find((x) => x.id === want);
    if (p) project = p;
    go(p ? `project:${p.id}` : "all");
  }

  return { el, say: (words) => note.replaceChildren(words), start: (want) => void start(want) };
}
