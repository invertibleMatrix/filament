// @ts-check
// Runs by itself, on a Space's overview beside its lanes: what the Space does with nobody at it, in one look — every
// routine and watcher not removed (`runs.routines`: a watcher has a `trigger`) and every app and dashboard the Space
// holds, a draft too. One card of rows: an icon by its kind — Routines' clock, the watchers' eye, an app's as its row
// in the left bar has it —, its title, and one quiet line of Filament's own words: when a routine runs, what a watcher
// watches (the chats it names as words, no links: the row is the button), what an app reads by itself (its page's
// foot). At its right, how it stands: a dot and a word (lib/space-view.js `byItselfStands`). The whole row opens its
// page — Routines, Watchers, the app's own. One proposed carries Switch on…, which opens the sheet its own page opens
// (routine-presses.js) and switches nothing; an app whose page offers Keep… carries it, that page's sheet. No pause
// switch here: a pause by a slip of the pointer on an overview is the wrong trade — each page has its own. What failed
// comes first, then what waits for a Switch on or a Keep, then what is on, then what is paused, within each as the
// Space says them; six rows, then "and N more". With none, one line, and Routine… and Watcher…, which fill the Start as
// Add to this Space…'s rows do — on a project with no Space yet their tips say the press makes it (by need, 11-12).
// Drawn in place, each row kept by what it is, so a press under a resting pointer lands as a word moves.
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { barOf, footOf, tabOf } from "../lib/space-dashboards.js";
import { ASK_MAKES_SPACE, byItselfStands, routineMakeWords, watcherMakeWords } from "../lib/space-view.js";
import { KEEP_DOES, ROUTINES, WATCHERS } from "./dashboards.js";
import { routinePresses } from "./routine-presses.js";

/**
 * @typedef {import("./routine-sheet.js").RoutineRow} RoutineRow
 * @typedef {import("./routines.js").Runs} Runs
 * @typedef {import("../lib/space-dashboards.js").SpaceDashboard} SpaceDashboard
 */

/**
 * What the part reads and does: what the Routines and Watchers pages are handed — `place`, the Space's project;
 * `startWith`, the Start filled; `openTab`, a page of the Space by its tab; what a routine's sheet reads and writes —,
 * and `keep`: an app's Keep sheet, as its page opens it; `pages`: the Space's pages in a menu, at the element pressed;
 * `makes`: whether the project has no Space yet, so Routine… and Watcher… make it (by need, 11-12); `now`: the clock.
 * @typedef {import("./routines.js").RoutinesCtx & { keep: (name: string) => void, pages: (anchor: HTMLElement) => void,
 *   makes?: () => boolean, now?: () => number }} ByItselfCtx
 */

/**
 * A row as the list draws it: its key among the rows, its kind, the Space's project and the tab of its page, its
 * icon's markup, its title, its quiet line, its tip, how it stands, and the button at its right — none on most.
 * @typedef {{ key: string, kind: "routine" | "watcher" | "app", project: string, tab: string, icon: string, title: string,
 *   line: string, tip: string, stands: ReturnType<typeof byItselfStands>,
 *   act: { label: string, tip: string, press: () => void } | null }} Row
 */

/** How many rows show before the rest fold under "and N more". */
const SHOWN = 6;

/** @param {ByItselfCtx} ctx */
export function byItselfPart(ctx) {
  const now = ctx.now || Date.now;
  /** @type {Runs | null} */
  let runs = null;
  /** @type {SpaceDashboard[]} */
  let apps = [];
  /** The rows past the first six, as last drawn: where "and N more" goes is by what they are. @type {Row[]} */
  let rest = [];
  let drawn = "";
  const count = h("span", { class: "sp-sec-count" });
  const list = h("div", { class: "sbi-list", role: "list", "aria-label": "Runs by itself" });
  const more = h("button", { class: "sp-quiet sbi-more", type: "button", hidden: "", onclick: () => openMore() });
  // Routine… and Watcher…, each with its tip: on a project with no Space yet the tip says the press makes it (`draw`).
  const makers = ctx.startWith
    ? [{ tip: "The Start here, its box begun: an agent proposes the routine, and it runs only once you switch it on", el: h("button", { class: "ghost sm sbi-make", type: "button", onclick: () => make(routineMakeWords) }, "Routine…") },
        { tip: "The Start here, its box begun: an agent proposes the watcher, and it listens only once you switch it on", el: h("button", { class: "ghost sm sbi-make", type: "button", onclick: () => make(watcherMakeWords) }, "Watcher…") }]
    : [];
  const none = h("div", { class: "sbi-none" }, h("span", { class: "sp-quiet" }, "Nothing runs by itself here yet."), ...makers.map((m) => m.el));
  const el = h("section", { class: "sp-sec sp-by-itself", "aria-label": "Runs by itself", hidden: "" },
    h("div", { class: "sp-sec-h" }, h("h3", { class: "sp-sec-name" }, "Runs by itself"), count, h("span", { class: "sb-sp" })),
    list, more, none);
  // Switch on…'s sheet is the one a routine's own page opens, of the routine as the Space says it now.
  const { open } = routinePresses(ctx, () => runs?.routines || []);

  /** The Space's project, for a page of its own. */
  const here = () => ctx.place("")?.id || "";

  /** Routine… or Watcher…: the Start in the Space's folder, its box begun. @param {(place: string) => string} words */
  function make(words) {
    const own = ctx.place("");
    if (own && ctx.startWith) ctx.startWith(own.cwd, words(own.name));
  }

  /**
   * "and N more": Watchers where every row past the six is a watcher, Routines where a routine is among them; else an
   * app is, which neither page lists — the Space's pages, from the line.
   */
  function openMore() {
    if (!rest.length) return;
    if (rest.every((r) => r.kind === "watcher")) ctx.openTab(here(), WATCHERS);
    else if (rest.some((r) => r.kind === "routine")) ctx.openTab(here(), ROUTINES);
    else ctx.pages(more);
  }

  /** A routine's row, a watcher's too. @param {RoutineRow} r @returns {Row} */
  function routineRow(r) {
    const w = r.words;
    const kind = r.trigger ? "watcher" : "routine";
    return {
      key: `${kind}:${r.project}|${r.id}`,
      kind,
      project: r.project,
      tab: r.trigger ? WATCHERS : ROUTINES,
      icon: r.trigger ? ICONS.eye : ICONS.clock3,
      title: r.title,
      // What a watcher watches, the chats it names as words; a routine's when, as its row on Routines says it.
      line: r.trigger && w.watches ? w.watches.map((p) => (typeof p === "string" ? p : p.name)).join("") : w.when,
      // How its last run went and what comes next, as its own page says them.
      tip: [w.last, w.next, w.skipped].filter(Boolean).join(" · ") || w.heard,
      stands: byItselfStands({ kind, state: r.state, paused: r.paused, pausedWhy: r.pausedWhy, tone: w.tone }),
      act: r.state === "proposed" ? { label: "Switch on…", tip: w.press.on, press: () => open(r, false) } : null,
    };
  }

  /** An app's row, a dashboard's too. @param {SpaceDashboard} d @param {number} at @returns {Row} */
  function appRow(d, at) {
    const t = tabOf(d, at);
    return {
      key: `app:${d.name}`,
      kind: "app",
      project: here(),
      tab: d.name,
      icon: d.type === "app" ? ICONS.appWindow : ICONS.layoutDashboard,
      title: d.title,
      line: footOf(d, at),
      // What its row in the left bar says of it.
      tip: t.tip,
      stands: byItselfStands({ kind: "app", draft: t.draft, paused: t.paused, fault: t.fault, held: t.held }),
      // Keep… where its page's bar offers it: a draft, and one whose scripts wait for a Keep.
      act: barOf(d, at).press === "keep" ? { label: "Keep…", tip: KEEP_DOES, press: () => ctx.keep(d.name) } : null,
    };
  }

  /** @param {Row} r */
  const rowEl = (r) =>
    h("div", { class: `sbi-row is-${r.kind} is-${r.stands.tone}`, role: "listitem", "data-key": r.key },
      h("button", { class: "sbi-face", type: "button", title: r.tip || null, onclick: () => ctx.openTab(r.project, r.tab) },
        h("span", { class: "sbi-ic", "aria-hidden": "true", html: r.icon }),
        h("span", { class: "sbi-words" },
          h("span", { class: "sbi-title", title: r.title }, r.title),
          h("span", { class: "sbi-line", title: r.line }, r.line)),
        h("span", { class: "sbi-stands" }, h("span", { class: "sbi-dot" }), h("span", { class: "sbi-word" }, r.stands.word))),
      ...(r.act ? [h("button", { class: "sm sbi-go", type: "button", title: r.act.tip, onclick: r.act.press }, r.act.label)] : []));

  function draw() {
    const at = now();
    const all = [...(runs?.routines || []).filter((r) => r.state !== "removed").map(routineRow), ...apps.map((d) => appRow(d, at))];
    // By how each stands; within one standing, as the Space says them (the sort keeps their order).
    const rows = all.slice().sort((a, b) => a.stands.rank - b.stands.rank);
    const shown = rows.slice(0, SHOWN);
    rest = rows.slice(SHOWN);
    count.replaceChildren(rows.length ? String(rows.length) : "");
    none.hidden = !!rows.length;
    for (const m of makers) m.el.setAttribute("title", `${m.tip}${ctx.makes?.() ? ASK_MAKES_SPACE : ""}`);
    more.hidden = !rest.length;
    more.replaceChildren(rest.length ? `and ${rest.length} more` : "");
    // Drawn again where a row's words moved, and in place, each row kept by what it is, so its face and its Switch on…
    // stand under a resting pointer as the words of the others move.
    const key = JSON.stringify(shown.map((r) => [r.key, r.icon, r.title, r.line, r.tip, r.stands, r.act?.label, r.act?.tip]));
    if (key === drawn) return;
    drawn = key;
    morphChildren(list, shown.map(rowEl));
  }

  return {
    el,
    /**
     * What runs by itself, as the Space now says it: its routines and watchers, and its apps and dashboards.
     * @param {Runs | null | undefined} next @param {SpaceDashboard[]} dashboards
     */
    paint(next, dashboards) {
      runs = next || null;
      apps = Array.isArray(dashboards) ? dashboards : [];
      el.hidden = false;
      draw();
    },
  };
}
