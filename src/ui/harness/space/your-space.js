// @ts-check
// Your Space (HarnessV4_Space_Plan S5b, the mock "Space, grown" screen 2): what needs you from every project, in one
// place. A full-frame page over the chat, as a project's Space is: the crumb "Your Space" with Back to chat; its head,
// the day, how many need you and how many work. Left, Today's Needs you — the chats that ask you, as Now has them, the
// drafts that wait for your Send (S5c), then what fails, then the news (what a watch brought, what a watcher told you),
// each with its project's chip; filters that are counts, a press filtering in
// place (lib/your-space.js) —, the rows Filament keeps drawn as a project's Space draws them (needs-rows.js), and under
// them what was done today and what was put off, with Bring back. Right, At a glance: each dashboard you switched there
// from its tab's ⋯, its status tiles in its tab's words, a press opening its tab in its Space; then Working, Now's rows
// at work, and what finished today. Its tabs are Today alone, so it draws none (A1) until a routine or a kept watch of
// any project brings a second (S6): Routines, every project's (space/routines.js), each row with its project's chip;
// and a watcher of any project its own: Watchers, every project's (space/watchers.js), drawn the same way.
// Nothing here starts, sends or spends on one press but Run now and Switch on: a row opens its chat or its tab, Fix it…
// fills the Start. The page
// reads `/api/your-space` as it opens, again as the events stream says a Space moved (`space`), and each minute.
import { h, morphChildren } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { onBus } from "../lib/bus.js";
import { ICONS } from "../lib/icons.js";
import { toast } from "../lib/ui.js";
import { keepingFocus } from "../lib/keep-focus.js";
import { needGroups, whenWords } from "../lib/space-view.js";
import { FILTERS, FILTER_WORDS, filterCounts, glanceWords, headWords, nextByItself, todayRows } from "../lib/your-space.js";
import { chipTone } from "../now-list.js";
import { ageEl, moveAges, needRows } from "./needs-rows.js";
import { routinesFailed, routinesPart, routinesShown } from "./routines.js";
import { watchersFailed, watchersPart, watchersShown } from "./watchers.js";

const TICK_MS = 2_000;
/** How often the page reads Your Space again while it is open and in view: At a glance's sources read at their every. */
const READ_EVERY_MS = 60_000;
/** How long a burst of the Spaces' changes is gathered before it is read again. */
const READ_AFTER_MS = 150;
/** The tab Your Space showed last, while the harness is open: back from a chat, the same tab. @type {"today" | "routines" | "watchers"} */
let lastTab = "today";

/**
 * What Your Space reads and does: Now's groups as the left bar has them, a row of Now opened (its chat, its thread), a
 * project's Space opened (at a dashboard's page with `tab`), the Start with words in a folder, the way back.
 * @typedef {import("../lib/now.js").NowRow} NowRow
 * @typedef {{ now: () => { needs: NowRow[], works: NowRow[], done: NowRow[] }, openRow: (r: NowRow) => void,
 *   openSpace: (project: string, tab?: string) => void, openChat?: (chain: string) => void, startWith?: (cwd: string, words: string) => void,
 *   reproduce?: (cwd: string, report: import("../lib/space-view.js").ReproReport) => void,
 *   askChat?: (chain: string, words: string) => void, onClose: () => void,
 *   handOff?: (from: string, cwd: string, words: string) => void, catalogue?: import("./model-row.js").Catalogue,
 *   modelName?: (id: string) => string }} YourSpaceCallbacks
 *   `handOff`: a row's Hand to an agent… (A4): from a Space of your own, where it runs is asked first; `catalogue`: the
 *   models a routine's sheet offers to run it on
 * @typedef {{ projects: { id: string, name: string, cwd: string, space?: { id: string, name: string } }[], needs: import("../lib/your-space.js").Need[],
 *   dashboards: Record<string, import("./needs-rows.js").RowDashboard[]>,
 *   glance: { project: string, name: string, title: string, paused: boolean, tiles: import("../lib/your-space.js").GlanceTile[] }[],
 *   extended: boolean, runs?: import("./routines.js").Runs }} YourSpaceAnswer
 */

/** @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * A card of At a glance (case 4): a kept dashboard's title and chip, each status tile's line as its tab says it; a press
 * opens it in its Space. Home's, and a Space of your own's for the projects it shows (A7).
 * @param {YourSpaceAnswer["glance"][number]} d @param {number} now
 * @param {{ open: () => void, chip?: HTMLElement | null }} o
 */
export function glanceCard(d, now, { open, chip = null }) {
  const lines = d.paused
    ? [h("p", { class: "sp-quiet ys-g-line" }, "Paused: resume it in its Space")]
    : d.tiles.length
      ? d.tiles.map((t) => {
          const w = glanceWords(t, now);
          return h("p", { class: `ys-g-line${t.stale ? " is-stale" : ""}` },
            h("span", { class: "ys-g-title" }, t.title),
            ...(w.value ? [" ", h("b", { class: `ys-g-value${w.tone ? ` is-${w.tone}` : ""}` }, w.value)] : []),
            ...(w.under ? [h("span", { class: `ys-g-under${!w.value && w.tone ? ` is-${w.tone}` : ""}` }, w.value ? ` · ${w.under}` : ` ${w.under}`)] : []),
            ...(w.faint ? [h("span", { class: "sp-quiet ys-g-faint" }, ` · ${w.faint}`)] : []));
        })
      : [h("p", { class: "sp-quiet ys-g-line" }, "Its live version has no status tile: its page shows the rest")];
  // Keyed by its dashboard: the cards are drawn in place each minute, and one made anew stood under a resting pointer
  // (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
  return h("div", { class: "ys-card", role: "button", tabindex: "0", title: `Open ${d.title} in its Space`, "data-dashboard": d.name, "data-key": `glance:${d.project}|${d.name}`, onclick: open,
      onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } } },
    h("div", { class: "ys-card-h" }, h("span", { class: "ys-card-title" }, d.title), ...(chip ? [chip] : [])),
    ...lines);
}

/**
 * Draw Your Space over the frame. Its tick and its reads end once the page has left it, or on `stop`.
 * @param {HTMLElement} host  the main frame @param {YourSpaceCallbacks} cb
 */
export function renderYourSpace(host, cb) {
  host.querySelector(":scope > .your-space")?.remove();
  const root = h("div", { class: "space your-space" });
  host.append(root);
  /** @type {YourSpaceAnswer | null} */
  let answer = null;
  let readError = "";
  let readAt = 0;
  /** The filter pressed; which of the foot's lists is open; whether what finished today shows. */
  /** @type {(typeof FILTERS)[number]} */
  let filter = "all";
  /** @type {"" | "done" | "later"} */
  let needsShow = "";
  let doneOpen = false;

  /** Your Space read again; a failure is said where the rows stand. */
  async function read() {
    readAt = Date.now();
    try {
      answer = await api("/your-space");
      readError = "";
    } catch (e) {
      readError = said(e);
    }
    paint();
  }
  let readTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  const readSoon = () => {
    if (readTimer) return;
    readTimer = setTimeout(() => {
      readTimer = null;
      void read();
    }, READ_AFTER_MS);
  };

  /** A project as the answer names it. @param {string} id */
  const projectOf = (id) => answer?.projects.find((p) => p.id === id) || null;
  /** A project as its chip says it: the Space of your own that shows it first (A7), "Work › app". @param {{ name: string, space?: { name: string } }} p */
  const chipWords = (p) => (p.space ? `${p.space.name} › ${p.name}` : p.name);
  /** A project's chip: its name in its colour, as Now draws it; a press opens its Space. @param {string} id */
  const chip = (id) => {
    const p = projectOf(id);
    if (!p) return null;
    return h("button", { class: `now-proj ys-proj c-${chipTone(p.name)}`, type: "button", title: `Open ${p.name}'s Space`, onclick: (/** @type {Event} */ e) => { e.stopPropagation(); cb.openSpace(p.id); } }, chipWords(p));
  };
  /** A chat row's project chip, by the name Now gives it. @param {string} name */
  const nameChip = (name) => {
    if (!name) return null;
    const p = answer?.projects.find((x) => x.name === name);
    return h("span", { class: `now-proj ys-proj c-${chipTone(name)}` }, p ? chipWords(p) : name);
  };

  const kept = needRows({
    place: (n) => {
      const p = n.project ? projectOf(n.project) : null;
      return p ? { ...p, dashboards: answer?.dashboards?.[p.id] || [] } : null;
    },
    openTab: (project, name) => cb.openSpace(project, name),
    startWith: cb.startWith ? (cwd, words) => cb.startWith?.(cwd, words) : undefined,
    handOff: cb.handOff ? (p, words) => cb.handOff?.(p.id, p.cwd, words) : undefined,
    post: async (project, path, body) => {
      try {
        const got = await api(`/space/${encodeURIComponent(project)}${path}`, { method: "POST", body });
        void read();
        return got || {};
      } catch (e) {
        toast(said(e), "err");
        return null;
      }
    },
    chip,
    // A draft's Ask for a change… (S5c): the chat that wrote it, its box filled.
    askChat: cb.askChat,
    // A routine's failed run (S6): its chat; a repro's lane (S7).
    openChat: cb.openChat,
    // Reproduce… (S7-D1), and the draft a repro names, in its own project.
    reproduce: cb.reproduce ? (cwd, report) => cb.reproduce?.(cwd, report) : undefined,
    draftOf: (n, id) => (answer?.needs || []).find((x) => x.id === id && x.kind === "draft" && x.project === n.project) || null,
    // An ask to switch a routine on (E42 SA-D7): its sheet, here as in its Space; Keep… and Tell the chats… open its Space.
    // A watcher Filament switched off has the same press, the watcher named by its row.
    switchOn: (n) => {
      const id = n.ask?.routine || n.routine?.id;
      if (n.project && id) routines.switchOn(n.project, id);
    },
    // A watcher's row, by its project's list of them: its chip opens that Space's Watchers.
    watcher: (n) => !!answer?.runs?.routines.find((r) => r.project === n.project && r.id === (n.routine?.id || n.ask?.routine))?.trigger,
  });

  // Routines (S6) and Watchers: every project's, each row with its chip; a write goes to the row's Space, then Your
  // Space is read.
  /** @type {import("./routines.js").RoutinesCtx} */
  const runsCtx = {
    all: true,
    place: (id) => projectOf(id),
    chip,
    write: async (project, method, path, body) => {
      try {
        const got = await api(`/space/${encodeURIComponent(project)}${path}`, { method, ...(body === undefined ? {} : { body }) });
        void read();
        return got || {};
      } catch (e) {
        // What it wrote to moved since it was read (a Switch on of a routine its chat changed): read before the answer,
        // so the sheet opens again on what stands.
        if (/** @type {any} */ (e)?.body?.moved) await read();
        toast(said(e), "err");
        return null;
      }
    },
    pauseAll: async (on) => {
      try {
        await api("/spaces/pause", { method: "POST", body: { on } });
        void read();
        return true;
      } catch (e) {
        toast(said(e), "err");
        return false;
      }
    },
    startWith: cb.startWith,
    openChat: (chain) => cb.openChat?.(chain),
    askChat: cb.askChat,
    openTab: (project, name) => cb.openSpace(project, name),
    ...(cb.catalogue ? { catalogue: cb.catalogue } : {}),
    ...(cb.modelName ? { modelName: cb.modelName } : {}),
  };
  const routines = routinesPart(runsCtx);
  const watchers = watchersPart(runsCtx);

  const lineEl = h("p", { class: "sp-line" });
  const top = h("div", { class: "settings-top sp-top" },
    h("span", { class: "sp-crumb" }, h("span", { class: "sp-crumb-ic", html: ICONS.house }), h("span", { class: "sp-crumb-page" }, "Home")),
    h("span", { class: "sp-top-acts" }, h("button", { class: "ghost sm", type: "button", onclick: () => cb.onClose() }, "Back to chat")));
  const head = h("div", { class: "sp-head" },
    h("span", { class: "team-tile sp-tile ys-tile", "aria-hidden": "true", html: ICONS.house }),
    h("div", { class: "sp-head-words" }, h("h2", { class: "sp-title" }, "Home"), lineEl));

  const needsCount = h("span", { class: "sp-sec-count" });
  const needsNone = h("span", { class: "sp-quiet sp-needs-none" }, "Nothing needs you.");
  const filtersEl = h("div", { class: "ys-filters", role: "toolbar", "aria-label": "Show", hidden: "" });
  const needsList = h("div", { class: "sp-needs", role: "list", "aria-label": "Needs you" });
  const needsFoot = h("div", { class: "sp-needs-foot", hidden: "" });
  const needsSec = h("section", { class: "sp-sec ys-needs", "aria-label": "Needs you" },
    h("div", { class: "sp-sec-h" }, h("h3", { class: "sp-sec-name" }, "Needs you"), needsCount, needsNone),
    filtersEl, needsList, needsFoot);

  const cards = h("div", { class: "ys-cards" });
  const glanceSec = h("section", { class: "sp-sec ys-glance", "aria-label": "At a glance", hidden: "" },
    h("div", { class: "sp-sec-h" }, h("h3", { class: "sp-sec-name" }, "At a glance")), cards);
  const worksCount = h("span", { class: "sp-sec-count" });
  const worksList = h("div", { class: "sp-needs", role: "list", "aria-label": "Working" });
  const worksNone = h("span", { class: "sp-quiet sp-needs-none" }, "Nothing running.");
  const doneFoot = h("div", { class: "sp-needs-foot ys-done", hidden: "" });
  const worksSec = h("section", { class: "sp-sec ys-works", "aria-label": "Working" },
    h("div", { class: "sp-sec-h" }, h("h3", { class: "sp-sec-name" }, "Working"), worksCount, worksNone), worksList, doneFoot);
  const cols = h("div", { class: "ys-cols" }, needsSec, h("div", { class: "ys-side" }, glanceSec, worksSec));
  // Today | Routines | Watchers: Routines there once any project has a routine or a kept watch (S6, SG-D0), Watchers
  // once any has a watcher.
  const strip = h("div", { class: "sdb-strip ys-strip", role: "tablist", "aria-label": "Home's tabs", hidden: "" });
  root.append(top, h("div", { class: "sp-scroll" }, head, strip, cols, routines.el, watchers.el));
  /** The strip as drawn: its tabs, the one on, each one's dot. */
  let stripSaid = "";

  /** The tab shown, and the strip with it. @param {"today" | "routines" | "watchers"} next */
  function select(next) {
    const runs = answer?.runs;
    const there = { routines: routinesShown(runs), watchers: watchersShown(runs) };
    const shown = next !== "today" && there[next] ? next : "today";
    // The tab kept is clamped only by an answer read: the first paint, before it, keeps the tab asked for until it lands
    // (found by the Hunter on S6: back from a chat, the page painted before its read and forgot Routines).
    if (answer) lastTab = shown;
    strip.hidden = !there.routines && !there.watchers;
    const failed = { routines: routinesFailed(runs), watchers: watchersFailed(runs) };
    /** @param {"today" | "routines" | "watchers"} key @param {string} label @param {boolean} dot */
    const tabEl = (key, label, dot) => h("button", { class: `sdb-tab${shown === key ? " is-on" : ""}`, type: "button", role: "tab", "aria-selected": String(shown === key), ...(dot ? { "aria-label": `${label}, a run failed` } : {}), "data-tab": key, onclick: () => select(key) },
      ...(dot ? [h("span", { class: "sdb-dot", "aria-hidden": "true" })] : []), label);
    const says = JSON.stringify([shown, there, failed]);
    if (says !== stripSaid) {
      stripSaid = says;
      keepingFocus(strip, () => strip.replaceChildren(tabEl("today", "Today", false), ...(there.routines ? [tabEl("routines", "Routines", failed.routines)] : []), ...(there.watchers ? [tabEl("watchers", "Watchers", failed.watchers)] : [])));
    }
    cols.hidden = shown !== "today";
    routines.show(shown === "routines");
    watchers.show(shown === "watchers");
  }

  /**
   * A chat's row, as Now has it: what it asks or what it does, its project's chip, its title, how long; a press opens it
   * — its chat, or its thread.
   * @param {NowRow} r @param {number} now @param {"needs" | "works" | "done"} as
   */
  const chatRow = (r, now, as) =>
    h("button", { class: `sp-need ys-chat is-${as === "needs" ? r.tone || "asks" : as}`, type: "button", role: "listitem", title: `Open ${r.title}`, "data-chain": r.chain, "data-key": r.key, onclick: () => cb.openRow(r) },
      h("span", { class: "sp-need-dot" }),
      h("span", { class: "sp-need-words" },
        h("span", { class: "sp-need-t" }, as === "needs" ? r.fact || "waits for you" : r.title),
        h("span", { class: "sp-need-f" }, ...[nameChip(r.project)].filter(Boolean), r.project ? " · " : "", as === "needs" ? r.title : r.fact,
          ...(r.at ? [" · ", as === "done" ? `finished ${whenWords(r.at, now)}` : ageEl(r.at, now)] : []))),
      h("span", { class: "sp-need-go" }, "Open ›"));

  /**
   * Today's Needs you: the rows, the filters, the foot. Drawn again where a row or its words moved, and in place, each
   * row kept by its key — a row made anew as another moved put a new button under a resting pointer (the owner's of
   * 11-01: buttons blinking under a resting pointer, clicks lost) —; the minute moves the ages alone.
   */
  function paintNeeds() {
    const now = Date.now();
    const groups = cb.now();
    const g = needGroups(answer?.needs || [], now);
    const rows = todayRows(groups.needs, /** @type {any[]} */ (g.open));
    const counts = filterCounts(rows);
    if (filter !== "all" && !counts[filter]) filter = "all";
    // A read that failed is said: with nothing read yet, why; over an answer read before, after the head's words — the
    // rows it keeps are that earlier read's.
    const words = headWords(now, rows.length, groups.works.length, nextByItself(answer?.runs));
    lineEl.replaceChildren(!readError ? words : answer ? `${words} · the last read failed: ${readError}` : `Home could not be read: ${readError}`);
    needsCount.replaceChildren(rows.length ? String(rows.length) : "");
    needsNone.hidden = !!rows.length;
    needsList.hidden = !rows.length;
    const shown = filter === "all" ? rows : rows.filter((r) => r.filter === filter);
    const key = JSON.stringify([
      // A draft's words too, which a sheet's close keeps, so its Review… opens on them (found by the Hunter on S5c).
      rows.map((r) => (r.kind === "chat" ? [r.row.key, r.row.fact, r.row.tone, r.row.title, r.row.project, r.row.at] : [r.need.id, r.need.text, r.need.at, r.need.project, r.need.draft?.words])),
      // A draft's end too: sent or discarded say so in Done today, and only one of them has Bring back (S5c).
      [g.later, g.done].map((ns) => ns.map((n) => [n.id, n.until, n.doneAt, n.outcome])),
      answer?.projects,
      answer?.dashboards,
      filter,
      needsShow,
      new Date(now).setHours(0, 0, 0, 0),
    ]);
    if (needsList.dataset.key === key) return void moveAges(needsList, now);
    needsList.dataset.key = key;
    // The filters: only where two kinds of row are there to tell apart (A5).
    const kinds = FILTERS.filter((f) => f !== "all" && counts[f]);
    filtersEl.hidden = kinds.length < 2;
    keepingFocus(filtersEl, () => morphChildren(filtersEl, ["all", ...kinds].map((f) => {
      const on = filter === f;
      return h("button", { class: `ys-filter${on ? " is-on" : ""}`, type: "button", "aria-pressed": String(on), "data-filter": f, "data-key": `filter:${f}`, onclick: () => { filter = /** @type {any} */ (f); paintNeeds(); } },
        `${FILTER_WORDS[/** @type {keyof typeof FILTER_WORDS} */ (f)]} ${counts[/** @type {keyof typeof counts} */ (f)]}`);
    })));
    keepingFocus(needsList, () => morphChildren(needsList, shown.map((r) => (r.kind === "chat" ? chatRow(r.row, now, "needs") : kept.row(r.need, now)))));
    if ((needsShow === "done" && !g.done.length) || (needsShow === "later" && !g.later.length)) needsShow = "";
    keepingFocus(needsFoot, () => morphChildren(needsFoot, kept.foot(needsFoot, /** @type {any} */ (g), now, {
      show: needsShow,
      toggle: (which) => {
        needsShow = needsShow === which ? "" : which;
        paintNeeds();
      },
      where: (n) => (n.project ? projectOf(n.project)?.name || "" : ""),
      back: "Needs you",
    })));
  }

  /** At a glance: a card each dashboard switched there, its status tiles' lines; hidden until one is (case 6). */
  let glanceKey = "";
  function paintGlance() {
    const now = Date.now();
    const list = answer?.glance || [];
    glanceSec.hidden = !list.length;
    const key = JSON.stringify([list, answer?.projects, Math.floor(now / 60_000)]);
    if (key === glanceKey) return;
    glanceKey = key;
    keepingFocus(cards, () => morphChildren(cards, list.map((d) => glanceCard(d, now, {
      open: () => cb.openSpace(d.project, d.name),
      chip: chip(d.project),
    }))));
  }

  /** Working: Now's rows at work; under them, what finished today, behind its Show. */
  let worksKey = "";
  function paintWorks() {
    const now = Date.now();
    const groups = cb.now();
    const today = new Date(now).setHours(0, 0, 0, 0);
    const done = groups.done.filter((r) => r.at >= today);
    worksCount.replaceChildren(groups.works.length ? String(groups.works.length) : "");
    worksNone.hidden = !!groups.works.length;
    worksList.hidden = !groups.works.length;
    if (!done.length) doneOpen = false;
    const key = JSON.stringify([groups.works.map((r) => [r.key, r.title, r.fact, r.project, r.at]), done.map((r) => [r.key, r.title, r.at]), doneOpen]);
    if (key === worksKey) return void moveAges(worksList, now);
    worksKey = key;
    // In place, each row kept by its key: a chat's row that moved made the others anew, and their buttons under a
    // resting pointer with them (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
    keepingFocus(worksList, () => morphChildren(worksList, groups.works.map((r) => chatRow(r, now, "works"))));
    doneFoot.hidden = !done.length;
    keepingFocus(doneFoot, () => morphChildren(doneFoot, [
      h("div", { class: "sp-needs-parts", "data-key": "parts" }, h("span", { class: "sp-needs-part" }, `Finished today: ${done.length} · `,
        h("button", { class: "sb-more sp-needs-show", type: "button", "aria-expanded": String(doneOpen), onclick: () => { doneOpen = !doneOpen; paintWorks(); } }, doneOpen ? "Hide" : "Show"))),
      ...(doneOpen ? [h("div", { class: "sp-needs ys-done-list", role: "list", "aria-label": "Finished today", "data-key": "done-list" }, ...done.map((r) => chatRow(r, now, "done")))] : []),
    ]));
  }

  function paint() {
    paintNeeds();
    paintGlance();
    paintWorks();
    routines.paint(answer?.runs);
    watchers.paint(answer?.runs);
    select(lastTab);
  }

  // A Space moved — a row, a switch, a source's read —: read again, a burst once.
  const offBus = onBus((m) => {
    if (m?.type === "space") readSoon();
  });
  void read();
  paint();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(tick);
    offBus();
    if (readTimer) clearTimeout(readTimer);
  };
  // Now's rows move as the left bar learns of them; At a glance's sources read at their every while it is in view.
  const tick = setInterval(() => {
    if (root.isConnected === false) return void stop();
    paint();
    if (document.visibilityState !== "hidden" && Date.now() - readAt > READ_EVERY_MS) void read();
  }, TICK_MS);
  return { root, paint, stop };
}
