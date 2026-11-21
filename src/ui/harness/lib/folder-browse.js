// @ts-check
// Browse for a folder (HarnessV4_Settings_Plan HC-84): the computer's own dialog, the desktop app's or raised by the
// server; where none can open — a server with no dialog (a headless Linux), or a page on another machine than
// Filament's (the owner's remote Filament of 11-06), whose dialog would open on that machine's screen —, the server's
// folder list in the page: its roots, then the subfolders of whatever was picked. The sidebar's Add project, a chat's
// project folder, New Space and the settings pages' folder lists share it.
import { h } from "../../lib/dom.js";
import { api, pickFolderNative } from "./api.js";

/**
 * A path box's example, in the shape of the system Filament runs on — where the folder is (the owner's of 11-09: a
 * Windows path on a Mac): `parts` on `drive` on Windows, in the home folder on a Mac or Linux. Not read yet: from the
 * root, with no drive.
 * @param {string | null | undefined} platform  Node's `process.platform`, as `/api/state` says it
 * @param {string} [parts]  the example's own folders, `/` between them
 * @param {string} [drive]  Windows' drive letter
 */
export const pathExample = (platform, parts = "path/to/the/project", drive = "H") =>
  platform === "win32" ? `${drive}:\\${parts.split("/").join("\\")}` : platform === "darwin" ? `/Users/you/${parts}` : platform === "linux" ? `/home/you/${parts}` : `/${parts}`;

/**
 * Where the caller shows no input: the list says the folder it stands in and offers it under `words`; pressed, the list
 * folds and `onChoose` has the folder.
 * @typedef {{ words: string, onChoose: (path: string) => void }} Choose
 */

/**
 * The folder each list last listed, and what it listed: a folder the server will not list leaves the list there (the
 * hunt of p4-local-only: a refusal took Up and the choice away, and New Space's hidden input kept the folder refused).
 * @type {WeakMap<HTMLElement, { path: string, r: any }>}
 */
const listed = new WeakMap();

/**
 * The folder list in the page, under the path in `input`: a way up, then each subfolder; picking one fills the input
 * and lists its own. With `choose`, the folder it stands in first, and the press that takes it. A folder the server
 * will not list is said over the last one listed, which the input goes back to.
 * @param {HTMLInputElement} input @param {HTMLElement} host
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, choose?: Choose }} [io]
 */
export async function browseDirs(input, host, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  host.classList.remove("hidden");
  const path = input.value.trim();
  /** @param {string} p */
  const go = (p) => { input.value = p; input.dispatchEvent(new Event("input")); void browseDirs(input, host, io); };
  const choose = io.choose;
  /** The list of the folder at `p`, as `r` lists it; `refused`, the words of a folder below it the server would not list. @param {string} p @param {any} r @param {string} [refused] */
  const paint = (p, r, refused = "") => {
    const at = choose
      ? m("div", { class: "browse-at" },
        m("span", { class: "pane-note" }, p || "Choose a folder"),
        p ? m("button", { class: "ghost sm", type: "button", onclick: () => { host.classList.add("hidden"); choose.onChoose(p); } }, choose.words) : null)
      : null;
    const up = r.parent ? m("button", { class: "browse-dir", type: "button", onclick: () => go(r.parent) }, "↑ up") : null;
    // replaceChildren prints a null as text: at the roots there is no way up, and nothing stands in for it (LD-D19).
    host.replaceChildren(...(refused ? [m("p", { class: "pane-note browse-refused", role: "alert" }, refused)] : []), ...(at ? [at] : []), ...(up ? [up] : []), ...(r.dirs || []).map((/** @type {any} */ d) => m("button", { class: "browse-dir", type: "button", onclick: () => go(d.path) }, d.name)));
    if (!r.dirs?.length) host.append(m("p", { class: "pane-note" }, "No subfolders here."));
  };
  try {
    const r = await call(`/files/dirs${path ? `?path=${encodeURIComponent(path)}` : ""}`);
    listed.set(host, { path, r });
    paint(path, r);
  } catch (e) {
    const words = String(/** @type {any} */ (e)?.message || e);
    const last = listed.get(host);
    if (!last || last.path === path) return void host.replaceChildren(m("p", { class: "pane-note browse-refused" }, words));
    input.value = last.path;
    input.dispatchEvent(new Event("input"));
    paint(last.path, last.r, words);
  }
}

/**
 * Browse's whole act: the computer's dialog first. A pick fills `input`; a cancel stops there; only a dialog that
 * could not open shows the list in `host`, after `onError` has said why — on another machine's page none is asked
 * for, and a server that has none says so: the list shows unsaid (`pickFolderNative`).
 * @param {HTMLInputElement} input @param {HTMLElement} host @param {(words: string) => void} onError
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, pick?: typeof pickFolderNative, choose?: Choose }} [io]
 * @returns {Promise<"picked" | "failed" | false>}
 */
export async function browseFolder(input, host, onError, io = {}) {
  const r = await (io.pick || pickFolderNative)(input, onError);
  if (r !== "failed") { host.classList.add("hidden"); return r; }
  await browseDirs(input, host, io);
  return r;
}
