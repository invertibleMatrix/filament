// @ts-check
// Routines (HarnessV4_Space_Plan S6, the mock "Space, grown" screen 11): what runs by itself, and what you run — a
// project's, in its Space's Routines tab, or every project's in Your Space's, each row with its project's chip. Its head
// says how many run by itself and the soonest next time, with Pause all (S6-D4) — "Paused since 14:20" and Resume while
// it is on — and Routine… (the Start, its box begun: an agent proposes one). Then three parts, by when they run: On a
// schedule — each routine with when it runs and what it may do, its words' first line, its run under way or its last,
// a time it skipped, its next time; Switch on… on one proposed (its sheet, routine-sheet.js), Run now on one on, Open
// on a run under way, Fix… on one that failed; its ⋯ —; When something arrives — the kept dashboards' watches, each
// with its dashboard (a press opens its tab), how often, its last and next look —; When you press Run — memory's
// how-tos of the project, each with Run… (the Start, the how-to in its box). Each part is there only where it has rows
// (SG-D0). The watchers — routines woken by events — are listed on a page of their own (watchers.js), never here; what
// a press does to a row is theirs and this page's alike (routine-presses.js). The words are Filament's (`runs`, as the
// server says them); nothing here starts but Switch on and Run now, each a press.
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { sheet } from "../lib/ui.js";
import { LOOK_AFTER, LOOK_AFTER_OWN, lookAfterWords, procedureWords, routineMakeWords, standsFailed } from "../lib/space-view.js";
import { FIX_DOES, pauseAllButton, routinePresses } from "./routine-presses.js";

/**
 * What runs by itself, as the server says it: the head's words, Pause all's moment, the routines and the kept watches.
 * The watchers are among the routines, each with its `trigger`, and have a head of their own: `listening`.
 * @typedef {import("./routine-sheet.js").RoutineRow} RoutineRow
 * @typedef {{ project: string, dashboard: string, title: string, key: string, rule: string, to: string, every: string,
 *   paused: boolean, last: number | null, nextAt: number | null, lastWords: string, nextWords: string, archived?: true }} WatchRow
 *   `archived`: its project is archived, and `nextWords` says so whole, as a routine's row does
 * @typedef {{ head: string, listening?: string, pausedSince: number | null, pausedBy?: { chain: string, byName: string, line: string } | null,
 *   routines: RoutineRow[], watches: WatchRow[] }} Runs  `pausedBy`: the chat whose agent switched Pause all on
 * @typedef {{ id: number, goal: string, steps: number, text: string, at: number, from: string }} Procedure  a how-to
 *   memory keeps of a project (`GET /space/:project/procedures`)
 * @typedef {{ id: string, name: string, cwd: string }} Place
 */

/**
 * What the view reads and does. `all`: Your Space's, every project's, each row with its chip (`chip`). `write`: a write
 * to a project's Space by its path under `/space/:project`, its answer — or null, its refusal said in a toast.
 * `procedures`: a project's how-tos; none in Your Space's. `catalogue`: the models a routine's sheet offers to run it on;
 * `modelName`: a model's name as the picker says it.
 * @typedef {{ all: boolean, place: (project: string) => Place | null, chip?: (project: string) => HTMLElement | null,
 *   write: (project: string, method: string, path: string, body?: any) => Promise<any>,
 *   pauseAll: (on: boolean) => Promise<boolean>, startWith?: (cwd: string, words: string) => void,
 *   openChat: (chain: string) => void, askChat?: (chain: string, words: string) => void,
 *   openTab: (project: string, name: string) => void, procedures?: (project: string) => Promise<Procedure[]>,
 *   lookAfter?: () => void, catalogue?: import("./model-row.js").Catalogue, modelName?: (id: string) => string }} RoutinesCtx
 */

/** Whether a Space shows its Routines (SG-D0): a routine at times not removed, or a kept watch. @param {Runs | null | undefined} runs */
export const routinesShown = (runs) => !!runs && (runs.routines.some((r) => r.state !== "removed" && !r.trigger) || runs.watches.length > 0);

/** Whether a routine at times fails now (`standsFailed`): the dot on the page's row in the left bar and on its tab. @param {Runs | null | undefined} runs */
export const routinesFailed = (runs) => !!runs && runs.routines.some((r) => !r.trigger && standsFailed(r));

/** A routine's words' first line, as its row says it. @param {string} task */
const firstOf = (task) => String(task || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";

/** A row's glyph at its left (the mock's screen 11), its state's dot on its corner. @param {string} icon */
const markOf = (icon) => h("span", { class: "srt-ic", "aria-hidden": "true" }, h("span", { class: "srt-ic-g", html: ICONS[icon] || "" }), h("span", { class: "srt-dot" }));

/** Its next time, short, sits by Run now (the mock's screen 11); why it does not run stays under its words. @param {string} next */
const nextAside = (next) => next.startsWith("next: ");

/** @param {RoutinesCtx} ctx */
export function routinesPart(ctx) {
  /** @type {Runs | null} */
  let runs = null;
  /** @type {Procedure[]} */
  let procs = [];
  /** Why the newest read of the how-tos failed; "" where it did not. */
  let procsError = "";
  let drawn = "";
  const headWords = h("span", { class: "srt-head-words" });
  const pause = pauseAllButton(ctx, () => !!runs?.pausedSince);
  const makeBtn = h("button", { class: "ghost sm srt-make", type: "button", title: "The Start here, its box begun: an agent proposes the routine, and it runs only once you switch it on", onclick: () => make() },
    h("span", { class: "sp-btn-ic", html: ICONS.plus }), "Routine…");
  makeBtn.hidden = ctx.all;
  const head = h("div", { class: "srt-head", role: "status" }, h("span", { class: "srt-head-dot" }), headWords, h("span", { class: "sb-sp" }), pause.el, makeBtn);
  /** @param {string} name @param {string} words */
  const secHead = (name, words) => {
    const count = h("span", { class: "sp-sec-count" });
    return { count, el: h("div", { class: "sp-sec-h" }, h("h3", { class: "sp-sec-name" }, name), count, h("span", { class: "sb-sp" }), h("span", { class: "sp-quiet" }, words)) };
  };
  const schedH = secHead("On a schedule", ctx.all ? "each run a new chat of its project" : "each run a new chat here");
  const schedList = h("div", { class: "srt-list", role: "list", "aria-label": "On a schedule" });
  const schedNone = h("p", { class: "sp-quiet srt-none" }, ctx.all ? "No routine yet: Routine…, on a project's page, asks an agent of it for one." : "No routine yet: Routine… asks an agent here for one; it runs only once you switch it on.");
  const sched = h("section", { class: "sp-sec srt-sec", "aria-label": "On a schedule" }, schedH.el, schedList, schedNone);
  const arriveH = secHead("When something arrives", "no AI until something is new");
  const arriveList = h("div", { class: "srt-list", role: "list", "aria-label": "When something arrives" });
  const arrive = h("section", { class: "sp-sec srt-sec", "aria-label": "When something arrives", hidden: "" }, arriveH.el, arriveList);
  const pressH = secHead("When you press Run", "how-tos memory kept from your chats");
  const pressList = h("div", { class: "srt-list", role: "list", "aria-label": "When you press Run" });
  // Why the how-tos could not be read, in their part: those read before stay listed over it.
  const pressSaid = h("p", { class: "sp-quiet srt-none srt-press-said", hidden: "" });
  const press = h("section", { class: "sp-sec srt-sec", "aria-label": "When you press Run", hidden: "" }, pressH.el, pressList, pressSaid);
  const lookAfter = h("button", { class: "sb-more srt-look-after", type: "button", title: "Tick what you look after: an agent proposes the routines and dashboards; nothing runs until you switch each on", onclick: () => ctx.lookAfter?.() }, "What do you look after…");
  const foot = h("p", { class: "sp-quiet srt-foot" }, lookAfter);
  foot.hidden = !ctx.lookAfter;
  const el = h("section", { class: "srt", "aria-label": "Routines", hidden: "" }, head, sched, arrive, press, foot);
  // What a press does to a routine's row, the Watchers page's too.
  const { open, runNow, fix, more, switchOn, backItems } = routinePresses(ctx, () => runs?.routines || []);

  /** Routine…: the Start in the project's folder, its box begun (screen 11's 7) — a project's Space's alone. */
  function make() {
    const own = ctx.all ? null : ctx.place("");
    if (own && ctx.startWith) ctx.startWith(own.cwd, routineMakeWords(own.name));
  }

  /** A routine's row. @param {RoutineRow} r */
  function routineRow(r) {
    const w = r.words;
    const running = r.last?.state === "running";
    const chip = ctx.all && ctx.chip ? ctx.chip(r.project) : null;
    // Its menu at the ⋯ that stands: the rows are drawn in place, so the one pressed is the one on the page.
    const dots = h("button", { class: "ghost icon srt-more", type: "button", "aria-label": `More for ${r.title}`, title: `More for ${r.title}`, "aria-haspopup": "menu", html: ICONS.ellipsis, onclick: (/** @type {Event} */ e) => more(r, /** @type {HTMLElement} */ (e.currentTarget)) });
    const go = r.state === "proposed"
      ? h("button", { class: "sm primary srt-go", type: "button", title: "Everything it will do, in Filament's words: nothing runs until you switch it on", onclick: () => open(r, false) }, "Switch on…")
      : running && r.last
        ? h("button", { class: "sm srt-go", type: "button", title: "The chat it runs in now", onclick: () => r.last && ctx.openChat(r.last.chain) }, "Open")
        : h("button", { class: "sm srt-go", type: "button", title: w.press.run, onclick: () => void runNow(r) }, "Run now");
    const fixBtn = w.tone === "bad" && ctx.startWith ? h("button", { class: "sm srt-fix", type: "button", title: FIX_DOES, onclick: () => fix(r) }, "Fix…") : null;
    const tone = r.state === "proposed" ? "is-proposed" : r.paused ? "is-paused" : w.tone ? `is-${w.tone}` : "is-on";
    return h("div", { class: `srt-row ${tone}`, role: "listitem", "data-routine": r.id, "data-project": r.project, "data-key": `routine:${r.project}|${r.id}` },
      markOf(r.writes ? "wrench" : r.acts?.length ? "zap" : "calendar"),
      h("div", { class: "srt-words" },
        h("div", { class: "srt-t" }, h("b", { class: "srt-title" }, r.title), ...(chip ? [" ", chip] : []),
          ...(r.state === "proposed" ? [h("span", { class: "srt-badge" }, "Proposed")] : r.paused ? [h("span", { class: "srt-badge" }, "Paused")] : [])),
        h("div", { class: "srt-f" }, `${w.when} · ${w.may}`),
        h("div", { class: "srt-task", title: r.task }, firstOf(r.task)),
        ...(w.last ? [h("div", { class: `srt-last${w.tone ? ` is-${w.tone}` : r.last?.state === "done" ? " is-done" : ""}` }, ...(running ? [h("span", { class: "sp-spin", html: ICONS.loader })] : []), [w.last, w.said ? `“${w.said}”` : ""].filter(Boolean).join(" · "))] : []),
        ...(w.next && !nextAside(w.next) ? [h("div", { class: "srt-last" }, w.next)] : []),
        ...(w.skipped ? [h("div", { class: "srt-skip sp-quiet" }, w.skipped)] : [])),
      h("div", { class: "srt-acts" }, ...(nextAside(w.next) ? [h("span", { class: "srt-next" }, w.next)] : []), ...(fixBtn ? [fixBtn] : []), go, dots));
  }

  /** A kept watch's row: what it watches for and where it writes, its dashboard, how often, its last and next look. @param {WatchRow} wr */
  const watchRow = (wr) => {
    const chip = ctx.all && ctx.chip ? ctx.chip(wr.project) : null;
    return h("div", { class: `srt-row is-watch${wr.paused ? " is-paused" : ""}`, role: "listitem", "data-watch": wr.key, "data-key": `watch:${wr.key}` },
      markOf("activity"),
      h("div", { class: "srt-words" },
        h("div", { class: "srt-t" }, h("b", { class: "srt-title" }, wr.rule), ` → ${wr.to}`, ...(chip ? [" ", chip] : [])),
        h("div", { class: "srt-f" },
          h("button", { class: "sp-fed-src", type: "button", title: `Open ${wr.title}`, onclick: () => ctx.openTab(wr.project, wr.dashboard) }, h("span", { class: "sp-fed-src-ic", html: ICONS.layoutDashboard }), wr.title),
          ` · every ${wr.every}`),
        h("div", { class: "srt-last" }, wr.paused ? "paused: its dashboard's ⋯ resumes it" : `last: ${wr.lastWords}`),
        // Its project archived: why it has no next look, on a line of its own as a routine's row says it.
        ...(wr.archived && !wr.paused ? [h("div", { class: "srt-last" }, wr.nextWords)] : [])),
      ...(wr.paused || wr.archived ? [] : [h("div", { class: "srt-acts" }, h("span", { class: "srt-next" }, `next: ${wr.nextWords}`))]));
  };

  /** A how-to's row: its goal and steps, where it was learned, Run…. @param {Procedure} p */
  const procRow = (p) => {
    const own = ctx.place("");
    return h("div", { class: "srt-row is-press", role: "listitem", "data-procedure": String(p.id), "data-key": `proc:${p.id}` },
      markOf("listTodo"),
      h("div", { class: "srt-words" },
        h("div", { class: "srt-t" }, h("b", { class: "srt-title" }, `How to ${p.goal}`)),
        h("div", { class: "srt-f" }, `${p.steps} step${p.steps === 1 ? "" : "s"}${p.from ? ` · learned from “${p.from}”` : ""}${p.at ? ` on ${new Date(p.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`)),
      h("div", { class: "srt-acts" },
        ...(own && ctx.startWith ? [h("button", { class: "ghost sm srt-go", type: "button", title: "The Start here, the how-to in its box: nothing runs until you send", onclick: () => ctx.startWith?.(own.cwd, procedureWords(p, own.name)) }, "Run…")] : [])));
  };

  function draw() {
    if (!runs) return;
    const paused = !!runs.pausedSince;
    // An agent's Pause all names it and its line (HarnessV4_AgentsSpace_Plan SA-D3), as the head does.
    const by = paused && runs.pausedBy ? `${runs.pausedBy.byName} switched Pause all on: ${runs.pausedBy.line} · ` : "";
    headWords.textContent = runs.head || (paused ? `${by}Pause all is on: nothing starts by itself until you resume.` : "Nothing runs by itself yet.");
    head.classList.toggle("is-paused", paused);
    // Resume is there while Pause all is on, whatever else is: its way back (found writing it — every routine paused one
    // by one left no head, and no Resume).
    pause.paint(!runs.head && !paused);
    // The routines at times: a watcher's row is the Watchers page's.
    const timed = runs.routines.filter((r) => r.state !== "removed" && !r.trigger);
    schedH.count.textContent = timed.length ? String(timed.length) : "";
    schedNone.hidden = !!timed.length;
    // Drawn again where a row's words moved, and in place, each row kept by its routine, so a menu open on one keeps
    // its button and a row's buttons stand under a resting pointer as the words of the others move (the owner's of
    // 11-01: buttons blinking under a resting pointer, clicks lost).
    const key = JSON.stringify([timed.map((r) => [r.id, r.project, r.title, r.task, r.state, r.paused, r.words, r.madeName, r.last?.chain]), runs.watches, procs, procsError, paused]);
    if (key === drawn) return;
    drawn = key;
    morphChildren(schedList, timed.map(routineRow));
    arrive.hidden = !runs.watches.length;
    arriveH.count.textContent = runs.watches.length ? String(runs.watches.length) : "";
    morphChildren(arriveList, runs.watches.map(watchRow));
    press.hidden = !procs.length && !procsError;
    pressH.count.textContent = procs.length ? String(procs.length) : "";
    morphChildren(pressList, procs.map(procRow));
    pressSaid.hidden = !procsError;
    pressSaid.textContent = procsError ? `The how-tos could not be read: ${procsError}` : "";
  }

  return {
    el,
    /** What runs by itself, as the Space now says it. @param {Runs | null | undefined} next */
    paint(next) {
      runs = next || null;
      draw();
    },
    /**
     * The view shown or not; shown, a project's how-tos are read — a read that fails is said in their part.
     * @param {boolean} on @param {string} [project]
     */
    show(on, project) {
      el.hidden = !on;
      if (!on || !project || !ctx.procedures) return;
      void ctx.procedures(project).then((list) => {
        procs = list;
        procsError = "";
        draw();
      }, (e) => {
        procsError = String(e?.message || e);
        draw();
      });
    },
    /** A routine's Switch on… sheet, or a watcher's, opened from elsewhere (routine-presses.js `switchOn`). */
    switchOn,
    /**
     * Add to this Space…'s lines for the routines at times removed, each its way back as it was (S6-D13).
     * @param {string} project
     */
    backItems: (project) => backItems(project, (r) => !r.trigger),
  };
}

/**
 * What do you look after… (S6, screen 3; S6-D9): the kinds of work a Space can look after, in plain words, each a tick;
 * Ask an agent fills the Start in the project's folder with those ticked — set up as routines and dashboards you switch
 * on yourself. Nothing runs from here. It opens only from Add to this Space… and the Routines tab, never by itself.
 * `kinds`: a Space of your own's (LOOK_AFTER_OWN), a project's shown in one (LOOK_AFTER_SHOWN), else a project's;
 * `note`: what it leaves to the Space that shows it, under the kinds; `connected`: whether any connector reaches the place —
 * where none does, a line over the kinds says so, with Connectors… (`onConnect`): a Space of your own's kinds each read
 * an account (the Designer's walk of 10-29: Email could be ticked with nothing connected) —, or why that could not be
 * read (a string), which the line says in its place.
 * @param {{ place: Place, startWith: (cwd: string, words: string) => void, kinds?: typeof LOOK_AFTER, note?: string,
 *   connected?: Promise<boolean | string>, onConnect?: () => void }} o
 */
export function lookAfterSheet({ place, startWith, kinds = LOOK_AFTER, note = "", connected, onConnect }) {
  const { ticked, go, sum, rows } = lookTicks(kinds);
  /** @type {{ close: () => void } | null} */
  let s = null;
  go.addEventListener("click", () => {
    if (!ticked.size) return;
    s?.close();
    startWith(place.cwd, lookAfterWords([...ticked], place.name, kinds));
  });
  const noneWords = h("p", { class: "sp-quiet srt-look-none-words" }, `Nothing is connected to ${place.name} yet, and most of these read an account — your email, your messages, your issues —: connect one first, or the agent will ask you to.`);
  const none = h("div", { class: "srt-look-none", hidden: "" },
    noneWords,
    ...(onConnect ? [h("button", { class: "ghost sm", type: "button", onclick: () => onConnect() }, "Connectors…")] : []));
  void connected?.then((on) => {
    if (typeof on === "string") noneWords.textContent = `Whether anything is connected to ${place.name} could not be read: ${on}. Most of these read an account — your email, your messages, your issues —: connect one first, or the agent will ask you to.`;
    none.hidden = on === true;
  });
  const body = h("div", { class: "sdb-keep-body srt-look-body" },
    // A Space of your own is no project to the person (found by the Hunter on A6).
    h("p", { class: "sdb-keep-lead" }, `What do you look after in ${place.name}? Each tick asks an agent of this ${kinds === LOOK_AFTER_OWN ? "Space" : "project"} to propose routines and apps for it; nothing runs until you switch each on, and each can be changed or removed like any other.`),
    none,
    h("div", { class: "srt-look-list" }, ...rows),
    ...(note ? [h("p", { class: "sp-quiet srt-look-note" }, note)] : []));
  const foot = h("div", { class: "sdb-keep-foot" }, sum, h("span", { class: "sb-sp" }), h("button", { class: "ghost sm", type: "button", onclick: () => s?.close() }, "Not now"), go);
  s = sheet({ label: "What do you look after?", class: "sdb-keep-sheet srt-look-sheet", head: h("b", { class: "sp-sheet-title" }, "What do you look after?"), body, foot });
  return s;
}

/**
 * The kinds as ticks, the sum of those ticked, and the press that asks an agent.
 * @param {typeof LOOK_AFTER} kinds
 */
function lookTicks(kinds) {
  /** @type {Set<string>} */
  const ticked = new Set();
  const go = h("button", { class: "sm primary srt-look-go", type: "button", disabled: "" }, "Ask an agent…");
  const sum = h("span", { class: "sp-quiet srt-look-sum" }, "Tick what you look after.");
  const rows = kinds.map((k) => {
    const box = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", class: "srt-look-box", "aria-label": k.label }));
    const row = h("label", { class: "srt-look-row" }, box, h("span", { class: "srt-look-words" }, h("b", {}, k.label), h("span", { class: "sp-quiet" }, k.line)));
    box.addEventListener("change", () => {
      if (box.checked) ticked.add(k.key);
      else ticked.delete(k.key);
      row.classList.toggle("on", box.checked);
      go.disabled = !ticked.size;
      sum.textContent = ticked.size ? `${ticked.size} ticked: an agent proposes each part; you switch on what you keep.` : "Tick what you look after.";
    });
    return row;
  });
  return { ticked, go, sum, rows };
}
