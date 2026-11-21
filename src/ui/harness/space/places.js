// @ts-check
// A project's places, in its Space (proposal_ux §4.14, V5, phase 8; HarnessV4_Git_Plan step 4, GW-D38): each worktree
// git lists, Filament's helper copies left out, with its branch, how far from its base, what is uncommitted and the
// chats at work there (GW-D59); in its "…" menu, Remove where it loses nothing but what git ignores, asked once in a
// sheet that says what goes (GW-D10, GW-D36, GW-D60), greyed with why elsewhere; the worktrees removed since Filament
// started, each with Put back (GW-D37) — a branch that went with one made again. Places belong to a project, not to a turn. Read when the Space opens, on its ⟳, and after a Remove or a Put back;
// never on a live pulse. Each read is handed to the Space too, which draws its lanes from it. Over the list, Filament's own
// footprint in the repository with its Clean up… (footprint.js), read after the places where the read asks for it.
// Each worktree says how old it is and whether the branch it was made from has every commit of its own; where it does
// and nothing is uncommitted, its "…" offers Remove worktree and branch too — never done by itself (the owner's of 11-09).
// What there is to tidy comes first (the owner's of 11-10, where the Plan's Still open card sends the person): Tidy up,
// whose Remove merged… removes the merged worktrees with their branches in one go once the person ticks them in its
// sheet, then the footprint's line with its Clean up….
import { h, morphChildren } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS, icon } from "../lib/icons.js";
import { button, dialog, menu, toast, tooltip } from "../lib/ui.js";
import { branchWords, pathLike } from "../lib/labels.js";
import { gitMovedFor } from "../lib/git-moved.js";
import { agoWords } from "../lib/space-dashboards.js";
import { chatsTitle, clockOf, gitWords, placeKey, placeLine, placeMenu, placeWhy, removeSheet, removedLine, removedToast } from "../panes/changes-data.js";
import { footprintLine } from "./footprint.js";

/** @param {string} s */
const enc = (s) => encodeURIComponent(s);
/** @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * What a worktree's line adds to its place's (the owner's of 11-09): when its last commit was, and — where the line does
 * not say it of the base already — whether the branch it was made from has every commit of its own, said of a clean
 * one only, as "merged" is. "last commit 3 h ago · merged into develop".
 * @param {any} p  a place as `/git/places` answers one @param {number} [now]
 */
export function ageWords(p, now = Date.now()) {
  if (p.main || !p.ok || p.missing) return "";
  const at = p.age?.commit ?? p.age?.folder ?? null;
  const parts = [at ? `${p.age?.commit ? "last commit" : "changed"} ${agoWords(at, now)}` : ""];
  const clean = !!p.uncommitted && !p.uncommitted.files;
  const told = p.base && !p.onBase && p.ahead === 0 && p.mergedInto === p.base;
  if (p.merged && clean && !told) parts.push(`merged into ${p.mergedInto}`);
  return parts.filter(Boolean).join(" · ");
}

/**
 * Remove worktree and branch's sheet (the owner's of 11-09): Remove's, its first paragraph saying the branch goes too and
 * which branch has every commit of it.
 * @param {any} p  a place that offers it @param {string | null} [self] @param {{ moveTo?: string | null }} [o]  as Remove's
 */
export function removeWithBranchSheet(p, self = null, o = {}) {
  const s = removeSheet(p, self, o);
  const gone = `The folder goes, and the branch ${p.branch} with it: ${p.mergedInto} has every commit of it. Put back makes it again where it is now.`;
  return { ...s, title: `Remove the worktree ${p.name} and its branch?`, lines: [gone, ...s.lines.slice(1)] };
}

/** A removed place's line where its branch went with it: "removed 14:02 · the branch fix-x went with it". @param {any} r */
const removedWords = (r) => (r.branchGone ? `removed ${clockOf(r.at)} · the branch ${r.branch} went with it` : removedLine(r));

/** The chats whose folder a place is, named: "the folder of “fix it”", or nothing. @param {any} p */
const homeWords = (p) => {
  const home = (p.chats || []).filter((/** @type {any} */ c) => c.home).map((/** @type {any} */ c) => `“${c.name || "an untitled chat"}”`);
  return home.length ? `the folder of ${home.length > 2 ? `${home.slice(0, 2).join(", ")} and ${home.length - 2} more` : home.join(" and ")}` : "";
};

/**
 * What git ignores in a worktree that goes with it, in a row of Remove merged…'s sheet (the reviewer's of 11-10), as
 * Remove's own sheet names it (goesWords): "with it go dist/, node_modules (a link: only the link goes), and 2 more".
 * @param {{ names: { path: string, link: boolean }[], more: number } | null} goes
 */
export function goesLine(goes) {
  if (!goes) return "git could not list what it ignores there: whatever that is goes with it";
  if (!goes.names.length) return "nothing git ignores is in it";
  const named = goes.names.map((g) => (g.link ? `${g.path.replace(/\/$/, "")} (a link: only the link goes)` : g.path));
  return `with it go ${named.join(", ")}${goes.more ? `, and ${goes.more} more` : ""}`;
}

/**
 * The main folder of each folder's repository as last read: where the folder is the worktree removed, the section
 * reads there, so its Put back stays in reach (GWC-87). @type {Map<string, string>}
 */
const mainOf = new Map();

/**
 * A folder's repository's places (`GET /api/git/places`), read in its main folder where the folder itself is gone
 * (GWC-87); a refusal comes back in the answer's own shape, in words.
 * @param {string} at @returns {Promise<any>}
 */
async function readPlaces(at) {
  /** @type {any} */
  let got = null;
  for (const cwd of [...new Set([at, mainOf.get(placeKey(at))].filter(Boolean))]) {
    try {
      got = await api(`/git/places?cwd=${enc(String(cwd))}`);
      break;
    } catch (e) {
      got = { ok: false, error: said(e), places: [], removed: [] };
      if (/** @type {any} */ (e)?.status !== 404) break;
    }
  }
  if (got?.ok && got.main) mainOf.set(placeKey(at), got.main);
  return got;
}

/**
 * How many places a repository has, in a line: "the main folder and 2 worktrees · 1 removed".
 * @param {any} a  `/git/places`' answer
 */
export function placesWords(a) {
  const worktrees = (a?.places || []).filter((/** @type {any} */ p) => !p.main).length;
  const removed = (a?.removed || []).length;
  return [
    worktrees ? `the main folder and ${worktrees} worktree${worktrees === 1 ? "" : "s"}` : "the main folder alone",
    removed ? `${removed} removed` : "",
  ].filter(Boolean).join(" · ");
}

/**
 * The section and its read. `folder`: the folder whose repository is read; `self`: the chat open, which the rows call
 * "this chat", null where none is; `editorButton`: the open button; `onMoved`: a worktree removed or put back, for the
 * header and the sidebar to read again; `onRead`: each answer, for the host's own use of it. `moved`: whether the feed's
 * `git-moved` (lib/git-moved.js) says the places this section shows moved, for the host to read them again. `load`
 * with `footprint` reads Filament's footprint after the places: the Space's opening, its ⟳, a Clean up — no other read.
 * @param {{ folder: () => string, self?: string | null, editorButton: (path: string, what: string) => HTMLElement,
 *   onMoved: () => void, onRead?: (answer: any) => void }} o
 * @returns {{ el: HTMLElement, load: (o?: { footprint?: boolean }) => Promise<void>, moved: (msg: any) => boolean }}
 */
export function placesSection({ folder, self = null, editorButton, onMoved, onRead }) {
  const el = h("section", { class: "pl-places" });
  let seq = 0;
  /** @type {any} the last answer */
  let answer = null;
  /** The rows a click works on now, by path or removal: "Removing…", "Putting back…". @type {Map<string, string>} */
  const busy = new Map();
  /**
   * The worktrees Remove merged… removed whose answer has not been read since: left off the list until a read leaves
   * them out (the reviewer's of 11-10: each was drawn again as the next one went). @type {Set<string>}
   */
  const gone = new Set();
  // A Clean up moves what the chats' Still open cards say of the folder: the host hears it (the review of 4569417b8).
  const foot = footprintLine({
    onCleaned: () => {
      void load({ footprint: true });
      onMoved();
    },
  });

  /** @param {{ footprint?: boolean }} [o] */
  async function load({ footprint = false } = {}) {
    const mine = ++seq;
    const got = await readPlaces(folder());
    if (mine !== seq) return;
    for (const path of gone) if (!(got?.places || []).some((/** @type {any} */ p) => p.path === path)) gone.delete(path);
    answer = got;
    draw();
    onRead?.(got);
    if (!footprint) return;
    if (got?.ok) await foot.load(String(got.cwd));
    else foot.clear();
  }

  /**
   * Drawn in place, each row kept by its place: the Space reads the places again as its folders move, and a row made
   * anew put a new button under a resting pointer (the owner's of 11-01: buttons blinking under a resting pointer,
   * clicks lost).
   */
  function draw() {
    const a = answer;
    if (!a) return void morphChildren(el, [h("p", { class: "pl-none" }, "Reading the folders…")]);
    if (!a.ok) return void morphChildren(el, [h("p", { class: "pl-none" }, `git could not read this folder: ${gitWords(a.error) || "no answer"}`)]);
    // What there is to tidy first (the owner's of 11-10: the Plan's Still open card sends the person here): the merged
    // worktrees' Remove merged…, then Filament's footprint with its Clean up… — passed as itself, never inside a node
    // made for the draw (`morphChildren`).
    morphChildren(el, [tidyEl(a), foot.el, h("div", { class: "pl-block" }, ...a.places.filter((/** @type {any} */ p) => !gone.has(p.path)).map(placeRow), ...a.removed.map(removedRow))]);
  }

  /**
   * The worktrees Tidy up offers to remove in one go (the owner's of 11-10): merged into their base with nothing
   * uncommitted, so their branch goes with them as Remove worktree and branch's would — never the main folder, one a
   * chat is at work in, or one a click works on now or removed just now.
   * @param {any} a  `/git/places`' answer
   */
  const mergedOf = (a) => (a?.places || []).filter((/** @type {any} */ p) => !p.main && p.ok && !p.missing && p.merged === true && p.removableWithBranch && !busy.has(p.path) && !gone.has(p.path) && !(p.chats || []).some((/** @type {any} */ c) => c.atWork));

  /** Tidy up's row, where worktrees are merged: how many, and Remove merged…. @param {any} a */
  function tidyEl(a) {
    const list = mergedOf(a);
    if (!list.length) return null;
    const into = [...new Set(list.map((/** @type {any} */ p) => String(p.mergedInto || p.base || "")).filter(Boolean))];
    const one = list.length === 1;
    return h("div", { class: "pl-tidy", "data-key": "tidy" },
      h("span", { class: "pl-ic", html: icon("archive") }),
      h("div", { class: "pl-t" },
        h("div", { class: "pl-l1" }, h("span", { class: "pl-tidy-h" }, "Tidy up")),
        h("div", { class: "pl-l2" }, `${list.length} worktree${one ? " is" : "s are"} merged into ${into.join(" or ") || "their base"} with nothing uncommitted: nothing is lost if ${one ? "it goes" : "they go"}`)),
      h("span", { class: "pl-end" }, button({ label: "Remove merged…", variant: "outline", size: "sm", onClick: () => askMerged(list) })));
  }

  /**
   * Remove merged…'s sheet: each merged worktree ticked — unticked, one with nothing of its own yet, as it may be about
   * to be worked in, and a chat's folder, which a chat of Filament's would leave for the main folder and a client's would
   * lose (the reviewer's of 11-10) —,
   * what goes with each said, and where the chats whose folder one is move first, ticked (the owner's of 11-09). Its
   * Remove counts the ticked ones; none ticked, it waits.
   * @param {any[]} list
   */
  function askMerged(list) {
    const main = answer?.places?.find((/** @type {any} */ x) => x.main);
    const moveTo = main ? String(main.name) : null;
    const rows = list.map((p) => {
      const tick = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", onchange: () => count() }));
      tick.checked = !p.fresh && !homeWords(p);
      return { p, tick };
    });
    /** Whether a chat of Filament's own works there, which the move takes to the main folder. @param {any} p */
    const movesOne = (p) => (p.chats || []).some((/** @type {any} */ c) => c.home && c.own !== false);
    const homes = list.filter(movesOne).length;
    const move = moveTo && homes ? /** @type {HTMLInputElement} */ (h("input", { type: "checkbox" })) : null;
    if (move) move.checked = true;
    const picked = () => rows.filter((r) => r.tick.checked).map((r) => r.p);
    const d = dialog({
      title: "Remove the merged worktrees?",
      glyph: h("span", { class: "chg-sheet-glyph", html: icon("gitFork") }),
      description: "Each folder goes, and its branch with it: the branch it was merged into has every commit of it. Put back makes each again.",
      body: h("div", { class: "chg-sheet pl-merged" },
        ...rows.map(({ p, tick }) => h("label", { class: "check pl-merged-row", title: pathLike(p.path, folder()) }, tick,
          h("span", { class: "pl-t" },
            h("span", { class: "pl-name" }, p.name),
            h("span", { class: "pl-l2" }, [p.branch ? `branch ${p.branch}` : "", placeLine(p, self), ageWords(p), homeWords(p)].filter(Boolean).join(" · ")),
            h("span", { class: "pl-l2 pl-goes" }, goesLine(p.goes))))),
        h("p", { class: "pl-merged-says" }, `${rows.some((r) => !r.tick.checked) ? "Unticked: a chat's folder, and one with nothing of its own yet. " : ""}Whatever git ignores in a folder goes with it; Put back brings the branch's files back, not those.`),
        move ? h("label", { class: "check" }, move, ` Move the chats whose folder one is to the main folder, ${moveTo}`) : null),
      actions: [
        { label: "Cancel", variant: "outline", onClick: () => d.close() },
        { label: "Remove", variant: "destructive", onClick: () => { const these = picked(); if (!these.length) return; d.close(); void removeMany(these, { moveChats: !!move?.checked && !move.disabled, to: moveTo }); } },
      ],
    });
    /**
     * Its Remove says how many, and waits while none is ticked; the move's tick waits while no ticked one is a chat's
     * folder (the review of 4569417b8).
     */
    const count = () => {
      if (move) move.disabled = !picked().some(movesOne);
      const go = /** @type {HTMLButtonElement | undefined} */ (Array.from(d.el.querySelectorAll(".zc-dialog-foot button")).at(-1));
      if (!go) return;
      const n = picked().length;
      // Its label's own span, so the button keeps the kit's shape (the reviewer's of 11-10).
      (go.querySelector(".zc-btn-label") || go).textContent = n ? `Remove ${n}` : "Remove";
      go.disabled = !n;
    };
    count();
  }

  /**
   * The ticked worktrees removed with their branches, one after another, each row saying so while it goes; one toast for
   * those removed, one for each that was not, then the places read again.
   * @param {any[]} list @param {{ moveChats: boolean, to: string | null }} o
   */
  async function removeMany(list, { moveChats, to }) {
    for (const p of list) busy.set(p.path, "Waiting…");
    draw();
    let done = 0;
    let moved = 0;
    for (const p of list) {
      busy.set(p.path, "Removing…");
      draw();
      try {
        const r = await api("/git/places/remove", { method: "POST", body: { cwd: answer.cwd, path: p.path, branch: true, ...(moveChats ? { moveChats: true } : {}) } });
        done++;
        gone.add(p.path);
        moved += Array.isArray(r.moved) ? r.moved.length : 0;
        if (r.branchStays) toast(`The branch ${p.branch} stays: ${r.branchStays}`, "err");
        if (r.left) toast(`${p.name}: its folder could not be deleted all the way; what is left is at ${r.left}`, "err");
      } catch (e) {
        toast(`${p.name}: ${said(e)}`, "err");
        moved += Array.isArray(/** @type {any} */ (e)?.body?.moved) ? /** @type {any} */ (e).body.moved.length : 0;
      } finally {
        busy.delete(p.path);
      }
    }
    if (done) toast(`Removed ${done} merged worktree${done === 1 ? "" : "s"} and ${done === 1 ? "its branch" : "their branches"}${moved ? ` · moved ${moved} chat${moved === 1 ? "" : "s"} to ${to}` : ""}`);
    if (done || moved) onMoved();
    await load();
  }

  /** @param {any} p */
  function placeRow(p) {
    const line = [placeLine(p, self), ageWords(p)].filter(Boolean).join(" · ");
    const doing = busy.get(p.path);
    return h("div", { class: "pl-row", "data-place": p.path, "data-key": `place:${p.path}` },
      h("span", { class: "pl-ic", html: icon(p.main ? "folder" : "gitFork") }),
      h("div", { class: "pl-t" },
        h("div", { class: "pl-l1" },
          h("span", { class: "pl-name", title: pathLike(p.path, folder()) }, p.name),
          branchWords(p) ? h("span", { class: "pl-br" }, h("span", { class: "pl-ic", html: icon("gitBranch") }), branchWords(p)) : null),
        line ? h("div", { class: "pl-l2", title: !p.ok && !p.missing ? line : chatsTitle(p.chats, self) }, line) : null),
      h("span", { class: "pl-end" },
        doing ? h("span", { class: "pl-busy" }, doing) : null,
        p.ok && !p.missing ? editorButton(p.path, `Open ${p.name}`) : null,
        placeMenu(p) && !doing ? moreButton(p) : null));
  }

  /** A worktree's "…": Remove, or why not, greyed (GW-D60); on a branch, Remove worktree and branch, or why not (the owner's of 11-09). @param {any} p */
  function moreButton(p) {
    // Its menu at the button that stands: the rows are drawn in place, so the one pressed is the one on the page.
    // Keyed: never drawn over the editor's button beside it, whose click and tooltip are its own listeners (editors.js).
    const b = h("button", { class: "ghost icon pl-more", type: "button", "data-key": "more", "aria-label": `More for ${p.name}`, html: ICONS.ellipsis, onclick: (/** @type {Event} */ e) => {
      e.stopPropagation();
      menu([
        { label: "Remove worktree…", icon: "trash2", variant: "destructive", disabled: !p.removable, desc: placeWhy(p) || undefined, onClick: () => ask(p) },
        ...(p.branch ? [{ label: "Remove worktree and branch…", icon: "trash2", variant: "destructive", disabled: !p.removableWithBranch, desc: p.removableWithBranch ? undefined : String(p.whyBranch || "it is not offered here"), onClick: () => ask(p, { branch: true }) }] : []),
      ], { anchor: /** @type {HTMLElement} */ (e.currentTarget), side: "bottom", align: "end", width: 260 });
    } });
    tooltip(b, { title: "More" });
    return b;
  }

  /** @param {any} r */
  function removedRow(r) {
    const doing = busy.get(r.id);
    return h("div", { class: "pl-row is-removed", "data-removed": r.id, "data-key": `removed:${r.id}` },
      h("span", { class: "pl-ic", html: icon("gitFork") }),
      h("div", { class: "pl-t" },
        h("div", { class: "pl-l1" },
          h("span", { class: "pl-name", title: pathLike(r.path, folder()) }, r.name),
          branchWords(r) ? h("span", { class: "pl-br" }, h("span", { class: "pl-ic", html: icon("gitBranch") }), branchWords(r)) : null),
        h("div", { class: "pl-l2" }, removedWords(r))),
      h("span", { class: "pl-end" },
        button({ label: doing || "Put back", icon: "rotateCcw", variant: "outline", size: "sm", disabled: !!doing, onClick: () => void putBack(r) })));
  }

  /**
   * Remove's sheet: what stays, what goes, whose folder it is (GW-D10); `branch`, the branch's going too. Where chats
   * work there, a tick moves them to the main folder first, ticked (the owner's of 11-09): unticked, the sheet says
   * their folder is gone until Put back.
   * @param {any} p @param {{ branch?: boolean }} [o]
   */
  function ask(p, { branch = false } = {}) {
    const main = answer?.places?.find((/** @type {any} */ x) => x.main);
    const o = { moveTo: main ? String(main.name) : null };
    const s = branch ? removeWithBranchSheet(p, self, o) : removeSheet(p, self, o);
    const paras = s.lines.map((l) => h("p", {}, l));
    const move = s.move;
    const tick = move ? /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", onchange: () => paint() })) : null;
    if (tick) tick.checked = true;
    /** The paragraph of the chats' folder, as the tick stands. */
    const paint = () => {
      if (move && tick) paras[move.at].textContent = tick.checked ? move.line : s.lines[move.at];
    };
    paint();
    const d = dialog({
      title: s.title,
      glyph: h("span", { class: "chg-sheet-glyph", html: icon("gitFork") }),
      description: pathLike(s.path, folder()),
      body: h("div", { class: "chg-sheet" }, ...paras, move && tick ? h("label", { class: "check" }, tick, ` ${move.label}`) : null),
      actions: [
        { label: "Cancel", variant: "outline", onClick: () => d.close() },
        { label: branch ? "Remove both" : "Remove", variant: "destructive", onClick: () => { const moveChats = !!tick?.checked; d.close(); void remove(p, { branch, moveChats, to: o.moveTo }); } },
      ],
    });
  }

  /** @param {any} p @param {{ branch?: boolean, moveChats?: boolean, to?: string | null }} [o] */
  async function remove(p, { branch = false, moveChats = false, to = null } = {}) {
    busy.set(p.path, "Removing…");
    draw();
    /** The chats moved to the main folder, said once. @param {any} list */
    const movedToast = (list) => {
      if (!Array.isArray(list) || !list.length) return false;
      toast(list.length === 1 ? `Moved ${list[0].name ? `“${list[0].name}”` : "its chat"} to ${to}` : `Moved ${list.length} chats to ${to}`);
      return true;
    };
    try {
      const r = await api("/git/places/remove", { method: "POST", body: { cwd: answer.cwd, path: p.path, ...(branch ? { branch: true } : {}), ...(moveChats ? { moveChats: true } : {}) } });
      movedToast(r.moved);
      toast(r.removed?.branchGone ? `Removed ${r.removed.name} · the branch ${r.removed.branch} went with it` : removedToast(r.removed));
      if (r.branchStays) toast(`The branch ${p.branch} stays: ${r.branchStays}`, "err");
      if (r.left) toast(`Its folder could not be deleted all the way; what is left is at ${r.left}`, "err");
      onMoved();
    } catch (e) {
      toast(`${p.name}: ${said(e)}`, "err");
      // Chats moved before one that did not: their folder is the main folder now, which the header and the left bar read.
      if (movedToast(/** @type {any} */ (e)?.body?.moved)) onMoved();
    } finally {
      busy.delete(p.path);
    }
    await load();
  }

  /** @param {any} r */
  async function putBack(r) {
    busy.set(r.id, "Putting back…");
    draw();
    try {
      await api("/git/places/put-back", { method: "POST", body: { cwd: answer.cwd, id: r.id } });
      toast(`Put back ${r.name} ${r.branch ? `on ${r.branch}` : `at ${r.head}`}`);
      onMoved();
    } catch (e) {
      toast(`${r.name}: ${said(e)}`, "err");
    } finally {
      busy.delete(r.id);
    }
    await load();
  }

  draw();
  return { el, load, moved: (msg) => gitMovedFor(msg, "places", [folder(), answer?.cwd, answer?.main]) };
}
