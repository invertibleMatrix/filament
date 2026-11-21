// @ts-check
// New Space (HarnessV4_SpacesPlugins_Plan A6, the Designer's §6 B): a Space of your own — what one is, in plain words,
// and its name first (the Designer's redesign of 10-29); where its files go and what it may read are one line under it,
// behind Change…: its folder, Documents\Filament Spaces\<name> unless Change… picks one; the files it may read: its own
// folder, its folder and these…, or the whole computer, each said plainly, with what narrows it (agentLoop.roots, a
// listener open beyond this machine) said under them. Make Space makes it, and nothing runs. The same sheet changes
// one, all of it open: its name and what it may read; its folder stays where it is. Every refusal is Filament's, said
// on the sheet.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { browseFolder } from "../lib/folder-browse.js";
import { sheet } from "../lib/ui.js";

/**
 * A Space of your own as `GET /api/spaces/own` lists it.
 * @typedef {{ project: string, name: string, folder: string, at: number, reach: "folder" | "these" | "computer",
 *   folders: string[], shows: string[] }} OwnSpace
 */

/** What the folded line says of each reach, after where its files go. */
const REACH_LINE = /** @type {const} */ ({
  folder: "Its chats work there, and ask you before they read anything elsewhere.",
  these: "Its chats work there, and read the folders you named without asking.",
  computer: "Its chats read any file on this computer without asking.",
});

/** The three reaches, each with its plain words (A2, SP-D3, SP-D5). */
const REACHES = /** @type {const} */ ([
  ["folder", "Its own folder", "Its chats read and change files in its folder. Anything elsewhere asks you first."],
  ["these", "Its folder and these…", "It also reads the folders you name here, without asking. A change there asks you first."],
  ["computer", "The whole computer", "Reads any file on this computer without asking. It changes files outside its folder only after asking you, or freely in Full access."],
]);

/**
 * A name as its folder is called, as Filament makes it (core/space.js `spaceFolderName`, which a test holds this to): the
 * characters a folder cannot hold made spaces, no dot or space at either end, a name Windows keeps for a device given
 * " Space" (found by the Hunter on A6: "con" and ":" were shown other than made). @param {string} name
 */
export function folderName(name) {
  const n = String(name || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (!n) return "Space";
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n) ? `${n} Space` : n;
}

/**
 * The sheet, open. `space`: one to change; none makes a new one. `onDone`: the Space as Filament answered, once made or
 * changed; the sheet is closed by then.
 * @param {{ space?: OwnSpace | null, onDone?: (row: OwnSpace) => void }} o
 */
export function newSpaceSheet({ space = null, onDone }) {
  const making = !space;
  /** Where Spaces' folders go, and what narrows reading, as Filament says them. */
  let base = "";
  const name = h("input", { class: "zc-input nsp-name", type: "text", placeholder: "Work, Personal…", spellcheck: "false", maxlength: "60", value: space?.name || "", "aria-label": "Name" });
  /** The folder Change… picked; "" for the default. */
  let picked = "";
  const pickInput = h("input", { type: "text", hidden: "" });
  const folderLine = h("span", { class: "nsp-folder" });
  const summaryWords = h("span", { class: "nsp-summary-words" });
  const sep = () => (base.includes("\\") ? "\\" : "/");
  const paintFolder = () => {
    if (!making) return void folderLine.replaceChildren("Its files and notes are in ", h("span", { class: "sdb-cmd" }, space?.folder || ""), ".");
    const typed = name.value.trim();
    const where = picked || (base ? `${base}${sep()}${typed ? folderName(typed) : "…"}` : "Documents › Filament Spaces");
    folderLine.replaceChildren("Its files and notes go in ", h("span", { class: "sdb-cmd" }, where), ".");
    useDefault.hidden = !picked;
    summaryWords.replaceChildren("Its files go in ", h("span", { class: "sdb-cmd" }, where), `. ${REACH_LINE[reach]}`);
  };
  const change = h("button", { class: "ghost sm nsp-change", type: "button", title: "Pick the folder its files go in" }, "Change…");
  const useDefault = h("button", { class: "ghost sm", type: "button", hidden: "", onclick: () => { picked = ""; paintFolder(); } }, "Use the default");
  // Where the computer's dialog cannot open — a server with none, another machine's page —, the folder list here.
  const pickDirs = h("div", { class: "browse-dirs hidden" });
  change.addEventListener("click", async () => {
    /** @param {string} p */
    const use = (p) => {
      picked = p;
      paintFolder();
    };
    const got = await browseFolder(/** @type {HTMLInputElement} */ (pickInput), pickDirs, (m) => say(m), { choose: { words: "Use this folder", onChoose: use } });
    if (got === "picked") use(/** @type {HTMLInputElement} */ (pickInput).value.trim());
  });
  name.addEventListener("input", paintFolder);

  /** @type {"folder" | "these" | "computer"} */
  let reach = space?.reach || "folder";
  const these = h("textarea", { class: "zc-input nsp-these", rows: "3", spellcheck: "false", placeholder: "One folder a line, from its drive", "aria-label": "The folders it also reads" });
  /** @type {HTMLTextAreaElement} */ (these).value = space?.reach === "these" ? space.folders.join("\n") : "";
  const addFolder = h("button", { class: "ghost sm", type: "button" }, "Add folder…");
  const addInput = h("input", { type: "text", hidden: "" });
  const addDirs = h("div", { class: "browse-dirs hidden" });
  addFolder.addEventListener("click", async () => {
    /** @param {string} p */
    const add = (p) => {
      const t = /** @type {HTMLTextAreaElement} */ (these);
      t.value = [...t.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), p].join("\n");
    };
    const got = await browseFolder(/** @type {HTMLInputElement} */ (addInput), addDirs, (m) => say(m), { choose: { words: "Add this folder", onChoose: add } });
    if (got === "picked") add(/** @type {HTMLInputElement} */ (addInput).value.trim());
  });
  const theseBox = h("div", { class: "nsp-these-box" }, these, h("div", { class: "nsp-these-foot" }, addFolder), addDirs);
  const choices = REACHES.map(([key, title, words]) => {
    const radio = h("input", { type: "radio", name: "nsp-reach", value: key, ...(reach === key ? { checked: "" } : {}) });
    radio.addEventListener("change", () => { reach = key; paintReach(); });
    return h("label", { class: "nsp-reach", "data-reach": key }, radio, h("span", { class: "nsp-reach-words" }, h("b", {}, title), h("span", { class: "sp-quiet" }, words)));
  });
  const paintReach = () => {
    for (const c of choices) c.classList.toggle("on", c.getAttribute("data-reach") === reach);
    theseBox.hidden = reach !== "these";
    paintFolder();
  };
  const limits = h("p", { class: "nsp-limits", hidden: "" });
  const err = h("p", { class: "spc-missing nsp-err", hidden: "", role: "alert" });
  /** A refusal, on the sheet. @param {string} m */
  const say = (m) => { err.textContent = m; err.hidden = !m; };

  // Where its files go and what it may read: one line on a new Space, Change… opening them (the Designer's redesign of
  // 10-29); open at once on one being changed.
  const more = h("div", { class: "nsp-more" },
    h("h4", { class: "sdb-keep-h" }, "Folder"),
    h("div", { class: "srt-sheet-v nsp-folder-v" }, folderLine, ...(making ? [change, useDefault] : [])),
    ...(making ? [pickDirs] : []),
    h("h4", { class: "sdb-keep-h" }, "Files it may read"),
    h("div", { class: "nsp-reaches", role: "radiogroup", "aria-label": "Files it may read" }, ...choices),
    theseBox,
    limits);
  const summary = h("div", { class: "srt-sheet-v nsp-summary" },
    summaryWords,
    h("button", { class: "ghost sm nsp-more-go", type: "button", title: "Where its files go, and what its chats may read", onclick: () => { more.hidden = false; summary.hidden = true; } }, "Change…"));
  more.hidden = making;
  summary.hidden = !making;
  const body = h("div", { class: "sdb-keep-body nsp-body" },
    h("p", { class: "sdb-keep-lead" }, making
      // What a Space of yours is for, beside a project's (the owner's word of 10-26: "your Space is about you; a
      // project's Space is about its code"), in a newcomer's words (the Designer's redesign of 10-29).
      ? "A place of your own — Work, Personal, a hobby — for the apps an agent makes you, your tasks, and the chats that work on them. It belongs to no project: deleting one never touches it."
      : "Its name, and the files its chats may read. Its folder stays where it is."),
    h("h4", { class: "sdb-keep-h" }, "Name"),
    name,
    summary,
    more,
    err);
  const go = h("button", { class: "sm primary nsp-go", type: "button" }, making ? "Make Space" : "Save");
  const foot = h("div", { class: "sdb-keep-foot" },
    h("span", { class: "sp-quiet" }, making ? "Nothing runs until you start a chat in it, or switch a routine on." : "A change reaches its chats at their next turn."),
    h("span", { class: "sb-sp" }),
    h("button", { class: "ghost sm", type: "button", onclick: () => s.close() }, "Cancel"),
    go);
  go.addEventListener("click", async () => {
    if (go.disabled) return;
    const n = name.value.trim();
    if (!n) {
      say("A Space needs a name: Work, Personal…");
      name.focus();
      return;
    }
    const folders = reach === "these" ? /** @type {HTMLTextAreaElement} */ (these).value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : undefined;
    go.disabled = true;
    say("");
    try {
      const row = making
        ? await api("/spaces/own", { method: "POST", body: { name: n, ...(picked ? { folder: picked } : {}), reach, ...(folders ? { folders } : {}) } })
        : await api(`/space/${encodeURIComponent(space?.project || "")}/own`, { method: "PATCH", body: { name: n, reach, ...(folders ? { folders } : {}) } });
      s.close();
      onDone?.(row);
    } catch (/** @type {any} */ e) {
      say(String(e?.message || e));
      go.disabled = false;
    }
  });
  name.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter") { e.preventDefault(); go.click(); } });
  const title = making ? "New Space" : `${space?.name || "Space"}: name and reach`;
  const s = sheet({ label: title, class: "sdb-keep-sheet nsp-sheet", head: h("b", { class: "sp-sheet-title" }, title), body, foot });
  paintReach();
  paintFolder();
  name.focus();
  // Where the folder goes and what narrows reading are Filament's: read once the sheet stands.
  api("/spaces/own").then((/** @type {any} */ r) => {
    base = String(r?.folder || "");
    paintFolder();
    if (r?.limits) {
      limits.textContent = String(r.limits);
      limits.hidden = false;
    }
  }).catch((/** @type {any} */ e) => say(String(e?.message || e)));
  return s;
}

/**
 * Delete a Space of your own, after its own two-step press (A5's words): what goes, and that the folder stays.
 * → whether it was deleted; a refusal is thrown, for the caller to say.
 * @param {{ project: string, name: string, folder: string }} space
 * @param {(o: { title: string, description?: string, confirmLabel?: string, destructive?: boolean }) => Promise<boolean>} confirm
 */
export async function deleteOwnSpace(space, confirm) {
  const yes = await confirm({
    title: `Delete ${space.name}?`,
    description: `Its chats, memory, board, routines and accounts go. Its folder stays, with your files: ${space.folder}. This cannot be undone.`,
    confirmLabel: "Delete Space",
    destructive: true,
  });
  if (!yes) return false;
  await api(`/space/${encodeURIComponent(space.project)}/own`, { method: "DELETE" });
  return true;
}
