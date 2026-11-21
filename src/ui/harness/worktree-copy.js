// @ts-check
// A project's worktree template on the page (HarnessV4_Four_Plan E19): the line under New worktree — at the start and
// on the Move sheet — that says what the new worktree gets a copy of, each entry switchable for this worktree alone
// (FO-D34), and the picker that lists what git leaves out of a worktree, measured, to choose the project's list from
// (FO-D35). The list is the project's (`worktree.copy`, FO-D31): read and saved at /git/places/template (FO-D40).
import { h } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { icon } from "./lib/icons.js";
import { dialog } from "./lib/ui.js";
import { placeName, sizeWords } from "./lib/labels.js";

/** The picker's rows shown at most before the filter narrows them; the rest are counted. */
const ROWS_MAX = 200;

/**
 * `path` is `outer` or inside it, as the list's paths are spelled ("/" between parts).
 * @param {string} path @param {string} outer
 */
export const isInside = (path, outer) => path === outer || path.startsWith(`${outer}/`);

/** A path as the list keeps it: "/" between parts, none at either end, no leading "./". @param {string} p */
export const listPath = (p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");

/**
 * What the line says of a template read (`GET /git/places/template`), with the paths left off for this worktree
 * (`off`): each entry ticked or not, its size, or "not here"; the ticked total; where the list comes from. Pure.
 * @param {any} t @param {readonly string[]} off
 * @returns {{ entries: { path: string, on: boolean, missing: boolean, size: string, title: string }[], total: string,
 *   from: string, empty: boolean, paths: string[] }}
 */
export function copyLineWords(t, off) {
  const left = new Set(off);
  const entries = (Array.isArray(t?.entries) ? t.entries : []).map((/** @type {any} */ e) => {
    const missing = !!e.missing;
    const files = Number(e.files) || 0;
    return {
      path: String(e.path),
      on: !missing && !left.has(String(e.path)),
      missing,
      size: missing ? "not here" : sizeWords(Number(e.bytes) || 0),
      title: missing ? `${e.path} is not in this folder: skipped` : `${e.path}: ${files.toLocaleString("en-US")} file${files === 1 ? "" : "s"}${e.link ? ", a link: copied as a link" : ""}`,
    };
  });
  const bytes = (Array.isArray(t?.entries) ? t.entries : []).reduce((/** @type {number} */ n, /** @type {any} */ e) => n + (!e.missing && !left.has(String(e.path)) ? Number(e.bytes) || 0 : 0), 0);
  const on = entries.filter((e) => e.on).length;
  return {
    entries,
    total: on > 1 ? sizeWords(bytes) : "",
    from: t?.from === "global" ? "from your defaults" : "",
    empty: !entries.length,
    // The paths the send copies: those left on, and those not here, which the copy's row then names as skipped.
    paths: entries.filter((e) => e.missing || e.on).map((e) => e.path),
  };
}

/**
 * The line. `folder`: the folder the worktree is made from; `off` and `setOff`: the paths left off for this worktree,
 * held by the caller with its choice; `changed`: the paths the send copies moved.
 * @param {{ folder: () => string, off: () => string[], setOff: (off: string[]) => void, changed?: () => void }} cb
 * @returns {{ el: HTMLElement, refresh: () => void, paths: () => string[] | null }}
 */
export function createCopyLine(cb) {
  const body = h("span", { class: "wt-copy-body" });
  const el = h("div", { class: "works-in-row wt-copy hidden" }, h("span", { class: "works-in-k" }, "Copies"), body);
  /** @type {{ folder: string, t: any } | null} */
  let read = null;
  let seq = 0;

  function paint() {
    const t = read?.t;
    el.classList.toggle("hidden", !t?.ok);
    if (!t?.ok) return void body.replaceChildren();
    const w = copyLineWords(t, cb.off());
    const edit = h("button", { class: "ghost sm wt-copy-edit", type: "button", onclick: () => pick() }, w.empty ? "Choose what to copy…" : "Edit the list…");
    if (w.empty) return void body.replaceChildren(h("span", { class: "wt-copy-none" }, "What git ignores is not copied."), edit);
    const chips = w.entries.map((e) => {
      if (e.missing) return h("span", { class: "wt-copy-entry is-missing", title: e.title }, h("span", { class: "wt-copy-name" }, e.path), h("span", { class: "wt-copy-size" }, e.size));
      const box = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", "aria-label": `Copy ${e.path} into this worktree` }));
      box.checked = e.on;
      box.addEventListener("change", () => {
        const off = new Set(cb.off());
        if (box.checked) off.delete(e.path);
        else off.add(e.path);
        cb.setOff([...off]);
        paint();
        cb.changed?.();
      });
      return h("label", { class: `wt-copy-entry${e.on ? "" : " is-off"}`, title: e.title }, box, h("span", { class: "wt-copy-name" }, e.path), h("span", { class: "wt-copy-size" }, e.size));
    });
    body.replaceChildren(...chips,
      ...(w.total ? [h("span", { class: "wt-copy-total" }, `· ${w.total}`)] : []),
      ...(w.from ? [h("span", { class: "wt-copy-from" }, w.from)] : []),
      edit);
  }

  async function load() {
    const folder = cb.folder();
    if (!folder) {
      read = null;
      return paint();
    }
    const mine = ++seq;
    let t = null;
    try {
      t = await api(`/git/places/template?cwd=${encodeURIComponent(folder)}`);
    } catch {
      t = null;
    }
    if (mine !== seq) return;
    read = { folder, t };
    // A path left off that the list no longer holds is forgotten with it.
    const listed = new Set((t?.entries || []).map((/** @type {any} */ e) => String(e.path)));
    const off = cb.off();
    if (off.some((p) => !listed.has(p))) cb.setOff(off.filter((p) => listed.has(p)));
    paint();
    cb.changed?.();
  }

  function pick() {
    const t = read?.t;
    if (!t?.ok) return;
    copyPicker({ folder: read?.folder || cb.folder(), project: String(t.project || ""), list: Array.isArray(t.copy) ? t.copy : [], onSaved: () => void load() });
  }

  return {
    el,
    refresh: () => void load(),
    // Null until the list was read: the send then leaves the paths to the server, which takes the project's list.
    paths: () => (read?.t?.ok ? copyLineWords(read.t, cb.off()).paths : null),
  };
}

/**
 * What a picker row says of a candidate (`candidates.items[]`): its kind and where it stands, its size and files. Pure.
 * @param {{ path: string, ignored?: boolean, dir?: boolean, link?: boolean, bytes?: number, files?: number, missing?: boolean }} c
 * @param {readonly string[]} chosen  the paths ticked now
 * @returns {{ kind: string, size: string, under: string | null }}
 */
export function candidateWords(c, chosen) {
  const under = chosen.find((p) => p !== c.path && isInside(c.path, p)) || null;
  const files = Number(c.files) || 0;
  const kind = c.missing ? "not in this folder" : `${c.ignored === false ? "not in git" : "ignored by git"}${c.link ? " · a link" : ""}`;
  const size = c.missing ? "" : `${sizeWords(Number(c.bytes) || 0)}${c.dir ? ` · ${files.toLocaleString("en-US")} file${files === 1 ? "" : "s"}` : ""}`;
  return { kind, size, under };
}

/**
 * The picker (FO-D35): what git leaves out of a worktree, biggest first, each a checkbox; the project's list ticked; a
 * filter; a path typed in; Save for the project. The server judges every path again and says what it refuses.
 * @param {{ folder: string, project: string, list: string[], onSaved: (t: any) => void }} o
 */
export function copyPicker({ folder, project, list, onSaved }) {
  const name = placeName(project || folder);
  /** The paths ticked, in the list's order, the newly ticked after. */
  let chosen = list.map(listPath).filter(Boolean);
  /** @type {any[]} */
  let items = [];
  let more = 0;
  /** Words in the candidates' place: while they are measured, or why git could not list them. */
  let note = "Measuring what git leaves out of a worktree…";
  let saving = false;
  const filterIn = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input wt-pick-filter", type: "search", placeholder: "Filter", spellcheck: "false", "aria-label": "Filter the list" }));
  const addIn = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input wt-pick-add", type: "text", placeholder: "A path from the repository's top folder, e.g. Library", spellcheck: "false", "aria-label": "A path to add" }));
  const rows = h("div", { class: "wt-pick-rows", role: "list" }, h("div", { class: "mv-quiet" }, "Measuring what git leaves out of a worktree…"));
  const said = h("div", { class: "mv-said", role: "status" });
  /** @type {any} */
  const d = dialog({
    title: `What a new worktree of ${name} gets a copy of`,
    glyph: h("span", { class: "chg-sheet-glyph", html: icon("copy") }),
    description: "What git leaves out of a worktree, biggest first. Each worktree gets its own copy, never a link; a file git puts there stays as git put it.",
    body: h("div", { class: "chg-sheet wt-pick" },
      filterIn,
      rows,
      h("div", { class: "wt-pick-addrow" }, addIn, h("button", { class: "outline sm", type: "button", onclick: () => add() }, "Add")),
      said),
    wide: true,
    actions: [
      { label: "Cancel", variant: "outline", onClick: () => d.close() },
      { label: `Save for ${name}`, onClick: () => void save() },
    ],
  });

  /** @param {string} path @param {boolean} on */
  function tick(path, on) {
    chosen = on ? (chosen.includes(path) ? chosen : [...chosen, path]) : chosen.filter((p) => p !== path);
    draw();
  }

  function draw() {
    const q = filterIn.value.trim().toLowerCase();
    // The list's own paths the candidates do not hold (typed ones, not here) stand first, ticked.
    const known = new Set(items.map((c) => c.path));
    const own = chosen.filter((p) => !known.has(p)).map((p) => ({ path: p, own: true, missing: false }));
    const all = [...own, ...items].filter((c) => !q || c.path.toLowerCase().includes(q));
    const shown = all.slice(0, ROWS_MAX);
    const row = (/** @type {any} */ c) => {
      const w = candidateWords(c, chosen);
      const box = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", "aria-label": `Copy ${c.path}` }));
      box.checked = chosen.includes(c.path) || !!w.under;
      box.disabled = !!w.under;
      box.addEventListener("change", () => tick(c.path, box.checked));
      return h("label", { class: `wt-pick-row${w.under ? " is-under" : ""}`, role: "listitem", title: w.under ? `copied with ${w.under}` : c.path },
        box,
        h("span", { class: "wt-pick-path" }, c.path),
        h("span", { class: "wt-pick-kind" }, w.under ? `with ${w.under}` : c.own ? "on the list" : w.kind),
        h("span", { class: "wt-pick-size" }, c.own ? "" : w.size));
    };
    const left = all.length - shown.length + (q ? 0 : more);
    const empty = note || (q ? "Nothing here matches." : "git leaves nothing out of a worktree here: every file is in git.");
    rows.replaceChildren(...shown.map(row),
      ...(note || !all.length ? [h("div", { class: "mv-quiet" }, empty)] : []),
      ...(left > 0 ? [h("div", { class: "mv-quiet" }, `and ${left.toLocaleString("en-US")} more — filter to find one, or add its path`)] : []));
  }

  function add() {
    const p = listPath(addIn.value);
    if (!p) return;
    addIn.value = "";
    tick(p, true);
  }
  addIn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add();
  });
  filterIn.addEventListener("input", () => draw());

  async function save() {
    if (saving) return;
    saving = true;
    said.classList.remove("is-err");
    said.textContent = "Saving…";
    try {
      const t = await api("/git/places/template", { method: "POST", body: { cwd: folder, copy: chosen } });
      d.close(true);
      onSaved(t);
    } catch (e) {
      saving = false;
      said.textContent = String(/** @type {any} */ (e)?.message || e);
      said.classList.add("is-err");
    }
  }

  api(`/git/places/template?cwd=${encodeURIComponent(folder)}&all=1`)
    .then((/** @type {any} */ t) => {
      if (!t?.ok || !t.candidates?.ok) note = t?.candidates?.error || t?.error || "git could not list what it leaves out here";
      else {
        note = "";
        items = t.candidates.items || [];
        more = Number(t.candidates.more) || 0;
      }
      draw();
    })
    .catch((e) => {
      note = String(e?.message || e);
      draw();
    });
  draw();
  return d;
}
