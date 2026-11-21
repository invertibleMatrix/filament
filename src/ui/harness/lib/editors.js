// @ts-check
// The editors a folder or a file opens in, by their URL schemes, and the one you chose last: the header's Open in menu
// chooses it, and every open button on the page follows that choice (HarnessV4_Git_Plan GW-D25). The same menu opens the
// folder in the system's file manager, named by the platform Filament runs on (`fileManagerName`). On another machine's
// page (the owner's remote Filament of 11-06) a path names that machine's disk: an editor opens it over SSH, by the alias
// the rail reached the machine by, and none opens it where there is no alias (`editorsHere`).
import { store } from "../../lib/store.js";
import { h } from "../../lib/dom.js";
import { icon } from "./icons.js";
import { tooltip } from "./ui.js";
import { remotePage, sshAlias } from "./api.js";

const EDITOR_KEY = "harness.editor";
/** percent-encode a path segment-by-segment, keeping the slashes that structure it @param {string} p */
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
/** A path as Remote - SSH takes it, from the root: a drive's (`C:/w`) under a `/` too. @param {string} p */
const rooted = (p) => encPath(p.startsWith("/") ? p : `/${p}`);
/**
 * scheme builders: the forward-slash path of a folder or a file is appended by the opener; with `alias`, the machine's
 * SSH alias, the address that opens it over SSH (`ssh`: the editor has one — VS Code's and Cursor's Remote - SSH).
 * @typedef {{ id: string, label: string, ssh: boolean, url: (p: string, alias?: string) => string }} Editor
 * @type {readonly Editor[]}
 */
export const EDITORS = Object.freeze([
  { id: "vscode", label: "VS Code", ssh: true, url: (p, alias = "") => (alias ? `vscode://vscode-remote/ssh-remote+${alias}${rooted(p)}` : `vscode://file/${encPath(p)}`) },
  { id: "cursor", label: "Cursor", ssh: true, url: (p, alias = "") => (alias ? `cursor://vscode-remote/ssh-remote+${alias}${rooted(p)}` : `cursor://file/${encPath(p)}`) },
  { id: "jetbrains", label: "JetBrains", ssh: false, url: (p) => `jetbrains://idea/navigate/reference?project=&path=${encodeURIComponent(p)}` },
]);

/**
 * The editors that open a path from this page: each one on this machine's page; on another machine's, those that open it
 * over SSH where the rail reached that machine by an alias, and none where it did not.
 * @returns {readonly Editor[]}
 */
export const editorsHere = () => (!remotePage() ? EDITORS : sshAlias() ? EDITORS.filter((e) => e.ssh) : []);

/** The editor chosen last among those that open here, else the first of them; null where none does. */
export const chosenEditor = () => {
  const here = editorsHere();
  return here.find((e) => e.id === store.get(EDITOR_KEY)) || here[0] || null;
};

/**
 * The system's file manager, by the platform Filament runs on — its server's, where the folder is and where the file
 * manager opens: Explorer, Finder, else the file manager.
 * @param {string | null | undefined} platform  Node's `process.platform`, as `/api/state` says it
 */
export const fileManagerName = (platform) => (platform === "win32" ? "Explorer" : platform === "darwin" ? "Finder" : "file manager");

/** Remember an editor as the one chosen. @param {string} id */
export const chooseEditor = (id) => store.set(EDITOR_KEY, id);

/**
 * Open a folder or a file in an editor, the chosen one unless named: false where there is no path to open, or no editor
 * opens it from this page.
 * @param {string} path @param {string} [id]
 */
export function openInEditor(path, id) {
  const p = String(path || "").replace(/\\/g, "/");
  const ed = editorsHere().find((e) => e.id === id) || chosenEditor();
  if (!p || !ed) return false;
  window.open(ed.url(p, sshAlias()), "_self");
  return true;
}

/**
 * A button that opens a folder or a file in the editor chosen last, its tooltip naming that editor: the Changes pane's
 * rows and the Space's places. `cls` is the host's own class beside the shared look. Where no editor opens it from this
 * page, the button stands hidden.
 * @param {string} path @param {string} what  its words, "Open Filament" @param {string} cls
 */
export function editorButton(path, what, cls) {
  const b = h("button", { class: `ghost icon ${cls}${chosenEditor() ? "" : " hidden"}`, type: "button", "aria-label": what, html: icon("fileCode2") });
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    openInEditor(path);
  });
  tooltip(b, { title: () => `${what} in ${chosenEditor()?.label || "an editor"}` });
  return b;
}
