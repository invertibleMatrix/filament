// @ts-check
// Watchers (the plan of 11-11, its w8): the routines woken by events, on a page of their own beside Routines — a
// project's, in its Space, or every project's on Home, each row with its project's chip. Its head says how many
// listen, with Pause all and Watcher… (the Start, its box begun: an agent proposes one). Each row: an eye — teal where
// it listens, faint where it is proposed or paused, red where its last run failed —, its title and badge, its words'
// first line, then a small grid in Filament's words: what it watches, whom it wakes — or tells, where no agent runs —,
// and what it may guide, each chat's name a link to that chat; and one quiet line for how it stands, the one word of
// its state in colour. At its right, a switch that pauses and resumes one that is on, Switch on… on one proposed (its
// sheet, routine-sheet.js), and its ⋯. A watcher is a routine to the Space, so what a press does is the Routines
// page's (routine-presses.js). The words are Filament's (`runs`, as the server says them): the page builds none.
import { h, morphChildren } from "../../lib/dom.js";
import { toggle } from "../lib/fields.js";
import { ICONS } from "../lib/icons.js";
import { standsFailed, watcherMakeWords } from "../lib/space-view.js";
import { pauseAllButton, routinePresses } from "./routine-presses.js";

/**
 * @typedef {import("./routine-sheet.js").RoutineRow} RoutineRow
 * @typedef {import("./routine-sheet.js").Named} Named
 * @typedef {import("./routines.js").Runs} Runs
 * @typedef {import("./routines.js").RoutinesCtx} RoutinesCtx
 */

/** Whether a Space shows its Watchers (SG-D0): a watcher not removed. @param {Runs | null | undefined} runs */
export const watchersShown = (runs) => !!runs && runs.routines.some((r) => r.state !== "removed" && !!r.trigger);

/** Whether a watcher fails now (`standsFailed`): the dot on the page's row in the left bar and on its tab. @param {Runs | null | undefined} runs */
export const watchersFailed = (runs) => !!runs && runs.routines.some((r) => !!r.trigger && standsFailed(r));

/** A watcher's words' first line, as its row says it. @param {string} task */
const firstOf = (task) => String(task || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";

/** @param {RoutinesCtx} ctx */
export function watchersPart(ctx) {
  /** @type {Runs | null} */
  let runs = null;
  let drawn = "";
  const headWords = h("span", { class: "srt-head-words" });
  const pause = pauseAllButton(ctx, () => !!runs?.pausedSince);
  const makeBtn = h("button", { class: "ghost sm swt-make", type: "button", title: "The Start here, its box begun: an agent proposes the watcher, and it listens only once you switch it on", onclick: () => make() },
    h("span", { class: "sp-btn-ic", html: ICONS.plus }), "Watcher…");
  makeBtn.hidden = ctx.all;
  // The Routines head's look: the same line, the same Pause all.
  const head = h("div", { class: "srt-head swt-head", role: "status" }, h("span", { class: "srt-head-dot" }), headWords, h("span", { class: "sb-sp" }), pause.el, makeBtn);
  const list = h("div", { class: "swt-list", role: "list", "aria-label": "Watchers" });
  // What one can watch, said by where it happens: no list of the kinds, which grow.
  const WATCHES = "It can watch a chat, the project's files and commits, a connection, or what a program posts or prints";
  const none = h("p", { class: "sp-quiet swt-none" }, ctx.all ? `No watcher yet: Watcher…, on a project's page, asks an agent of it for one. ${WATCHES}.` : `No watcher yet: Watcher… asks an agent here for one. ${WATCHES}, and it listens only once you switch it on.`);
  const el = h("section", { class: "swt", "aria-label": "Watchers", hidden: "" }, head, list, none);
  const { write, open, more, backItems } = routinePresses(ctx, () => runs?.routines || []);

  /** Watcher…: the Start in the project's folder, its box begun — a project's Space's alone. */
  function make() {
    const own = ctx.all ? null : ctx.place("");
    if (own && ctx.startWith) ctx.startWith(own.cwd, watcherMakeWords(own.name));
  }

  /** Words with the chats they name, each chat a link that opens it. @param {Named} parts */
  const named = (parts) =>
    parts.map((p) =>
      typeof p === "string" ? p : h("button", { class: "swt-chat", type: "button", title: `Open ${p.name}`, onclick: () => ctx.openChat(p.chain) }, p.name));

  /** A line of its grid: a label, and its words. @param {string} label @param {Named} parts */
  const line = (label, parts) => h("div", { class: "swt-line" }, h("dt", { class: "swt-k" }, label), h("dd", { class: "swt-v" }, ...named(parts)));

  /**
   * How it stands, in one quiet line: its last run, the one word of its state in its colour, with its answer's first
   * line; where it never ran, whether it heard anything; how many turns it reviewed today; then what waits or why it
   * is paused, and its trouble.
   * @param {RoutineRow} r
   */
  function stands(r) {
    const w = r.words;
    const last = w.lastParts;
    const parts = [
      ...(last ? [h("span", { class: "swt-last" }, last.head, h("span", { class: `swt-state${last.tone ? ` is-${last.tone}` : ""}` }, last.word), last.tail)] : []),
      ...(last && w.said ? [h("span", { class: "swt-said" }, `“${w.said}”`)] : []),
      ...(!last && w.heard ? [h("span", { class: "swt-heard" }, w.heard)] : []),
      ...(w.reviewed ? [h("span", { class: "swt-reviewed" }, w.reviewed)] : []),
      ...(w.next ? [h("span", { class: "swt-next" }, w.next)] : []),
      ...(w.skipped ? [h("span", { class: "swt-skip" }, w.skipped)] : []),
    ];
    if (!parts.length) return [];
    return [h("div", { class: "swt-stands" }, ...(r.last?.state === "running" ? [h("span", { class: "sp-spin", html: ICONS.loader })] : []), ...parts.flatMap((p, i) => (i ? [" · ", p] : [p])))];
  }

  /** A watcher's row. @param {RoutineRow} r */
  function row(r) {
    const w = r.words;
    const chip = ctx.all && ctx.chip ? ctx.chip(r.project) : null;
    const task = firstOf(r.task);
    const badge = r.state === "proposed" ? "Proposed" : !r.paused ? "" : r.pausedWhy ? "Paused by Filament" : "Paused";
    // Its menu at the ⋯ that stands: the rows are drawn in place, so the one pressed is the one on the page. Pause is
    // its switch's; Fix… is in the menu where its last run failed.
    const dots = h("button", { class: "ghost icon swt-more", type: "button", "aria-label": `More for ${r.title}`, title: `More for ${r.title}`, "aria-haspopup": "menu", html: ICONS.ellipsis,
      onclick: (/** @type {Event} */ e) => more(r, /** @type {HTMLElement} */ (e.currentTarget), { pause: false, fixes: true }) });
    // One that is on: a switch, on while it listens — one press pauses it, one resumes it, and its tip says which.
    // One proposed: Switch on…, its sheet.
    /** @type {typeof h} */
    const tipped = (tag, attrs, ...kids) => h(tag, { ...attrs, title: r.paused ? w.press.resume : w.press.pause }, ...kids);
    const act = r.state === "proposed"
      ? h("button", { class: "sm primary swt-go", type: "button", title: w.press.on, onclick: () => open(r, false) }, "Switch on…")
      : toggle(tipped, !r.paused, `${r.title} listens`, () => void write(r, "/pause", { paused: !r.paused }));
    const tone = r.state === "proposed" ? "is-proposed" : r.paused ? "is-paused" : w.tone ? `is-${w.tone}` : "is-on";
    return h("div", { class: `swt-row ${tone}`, role: "listitem", "data-watcher": r.id, "data-project": r.project, "data-key": `watcher:${r.project}|${r.id}` },
      h("span", { class: "swt-eye", "aria-hidden": "true", html: ICONS.eye }),
      h("div", { class: "swt-words" },
        h("div", { class: "swt-t" }, h("b", { class: "swt-title" }, r.title), ...(chip ? [" ", chip] : []), ...(badge ? [h("span", { class: "swt-badge" }, badge)] : [])),
        // One that tells only you may have no words of its own.
        ...(task ? [h("div", { class: "swt-task", title: r.task }, task)] : []),
        h("dl", { class: "swt-grid" },
          ...(w.watches ? [line("Watches", w.watches)] : []),
          ...(w.wakes ? [line(w.wakes.label, w.wakes.parts)] : []),
          ...(w.guides ? [line("May", w.guides)] : [])),
        ...stands(r)),
      h("div", { class: "swt-acts" }, act, dots));
  }

  function draw() {
    if (!runs) return;
    const paused = !!runs.pausedSince;
    // An agent's Pause all names it and its line (HarnessV4_AgentsSpace_Plan SA-D3), as the head does.
    const by = paused && runs.pausedBy ? `${runs.pausedBy.byName} switched Pause all on: ${runs.pausedBy.line} · ` : "";
    headWords.textContent = runs.listening || (paused ? `${by}Pause all is on: nothing starts by itself until you resume.` : "No watcher listens yet.");
    head.classList.toggle("is-paused", paused);
    // Resume is there while Pause all is on, whatever else is: its way back.
    pause.paint(!runs.listening && !paused);
    const rows = runs.routines.filter((r) => r.state !== "removed" && !!r.trigger);
    none.hidden = !!rows.length;
    // Drawn again where a row's words moved, and in place, each row kept by its watcher, so a menu open on one keeps
    // its button and a row's switch stands under a resting pointer as the words of the others move.
    const key = JSON.stringify(rows.map((r) => [r.id, r.project, r.title, r.task, r.state, r.paused, r.pausedWhy, r.words, r.madeName, r.last?.chain]));
    if (key === drawn) return;
    drawn = key;
    morphChildren(list, rows.map(row));
  }

  return {
    el,
    /** The watchers, as the Space now says them. @param {Runs | null | undefined} next */
    paint(next) {
      runs = next || null;
      draw();
    },
    /** The view shown or not. @param {boolean} on */
    show(on) {
      el.hidden = !on;
    },
    /** Add to this Space…'s lines for the watchers removed, each its way back as it was. @param {string} project */
    backItems: (project) => backItems(project, (r) => !!r.trigger),
  };
}
