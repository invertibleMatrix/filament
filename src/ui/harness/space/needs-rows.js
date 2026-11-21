// @ts-check
// The rows of Needs you that Filament keeps for a project's dashboards (HarnessV4_Space_Plan S5a), as a project's Space
// and Your Space (S5b) draw them: one row shape — its words, its dashboard's chip (a press opens its tab), its age, why
// it is here —, on a stopped source Fix it… (the Start, its failure in the box: nothing runs until you send) and Read
// again, on each Not now ▾ and Done; under the rows, what was done today and what was put off, each behind its Show,
// each with Bring back. Your Space puts each row's project chip first. A draft (S5c) is a row of its own: "Draft · its
// title", From and the chat that wrote it, Review & send… — its sheet (draft-sheet.js), where alone Send sends — and
// Discard. A routine's failed run (S6) is one too: its words, its Routines chip — a watcher's says Watchers, the page
// it opens, as a routine's does —, why it is here; Open (its run's chat) and Fix… (the Start, the failure in its box). A
// watcher Filament switched off, what its program runs not being what was approved, is a row of its own and no failed run: the server's
// words and reason, Watchers, and Switch on…, its sheet. What a
// watch found or a check says did not work has Reproduce… (S7):
// the Start on a new lane with the Builder. What an agent found when it reproduced one is a row too — Reproduced, with
// Fix it… (the Start in its lane) and Open the lane; Couldn't reproduce, with what it tried, Review & send… where it
// drafted its questions, else Copy the questions. Nothing here sends: Fix it…, Fix… and Reproduce… fill the Start.
// A chat's ask for a press that is yours (E42 SA-D7, the Designer's second pass) is a row too: its title the press in
// its sheet's words, its chat and reason under it, its thing's chip; its button the page's own — Keep…, Switch on…,
// Resume (at once, as the bar's), Tell the chats… —, Not now ▾ and Turn down, a word: ✓ means Done and reads as yes.
// An open row of another machine's Space of the same repository (the remote-agents plan's sp-cross) is a row too: that
// machine named on it, and Done alone, which dismisses it here.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { menu, toast } from "../lib/ui.js";
import { REPRO_TIP, ageWords, askButton, askEnded, askLine, doneByLine, draftFrom, handWords, needChip, notNowChoices, reproFixWords, reproLines, reproQuestions, reproReportOf, routineFixWords, turnDownTitle, untilWords, whenWords } from "../lib/space-view.js";
import { OVERVIEW, ROUTINES, WATCHERS, fixWords } from "./dashboards.js";
import { draftSheet } from "./draft-sheet.js";

/**
 * @typedef {import("../lib/space-view.js").NeedRow & { project?: string }} Need  a row, with its project in Your Space
 * @typedef {{ name: string, title: string, paused: boolean, state?: string }} RowDashboard  a dashboard as a row's chip names it
 * @typedef {{ id: string, name: string, cwd: string, dashboards: RowDashboard[] }} RowPlace  the project a row is of, with
 *   the dashboards its Space shows
 * @typedef {{ place: (n: Need) => RowPlace | null, openTab: (project: string, name: string) => void,
 *   startWith?: (cwd: string, words: string) => void, post: (project: string, path: string, body: any) => Promise<any>,
 *   chip?: (project: string) => HTMLElement | null, askChat?: (chain: string, words: string) => void,
 *   openChat?: (chain: string) => void, reproduce?: (cwd: string, report: import("../lib/space-view.js").ReproReport) => void, plain?: () => boolean,
 *   draftOf?: (n: Need, id: string) => Need | null, keep?: (n: Need) => void, switchOn?: (n: Need) => void,
 *   tell?: (n: Need) => void, handOff?: (p: RowPlace, words: string) => void, watcher?: (n: Need) => boolean }} NeedRowsCtx
 *   `handOff`: Hand to an agent…'s Start, where the page asks a Space of your own where it runs (A4); else `startWith`
 *   in the row's folder
 *   `post`: a write to the row's Space, by its path under `/space/:project`; its answer, or null where it was refused
 *   (said in a toast); `chip`: a row's project chip, first on its line (Your Space); `askChat`: the chat that wrote a
 *   draft opened with words in its box (Ask for a change…); `openChat`: a routine's run opened, a repro's lane;
 *   `reproduce`: Reproduce…'s Start (S7), none where `plain` (its folder no repository); `draftOf`: the draft a repro names, among its Space's rows; `keep`,
 *   `switchOn`, `tell`: an ask's press where this page has its sheet — the Keep sheet, the routine's Switch on…, the
 *   Tell the chats card with the ask's words —, else its button opens the thing's tab in its Space (E42 SA-D7);
 *   `switchOn` is also the press of a watcher Filament switched off, the watcher named by the row's `routine`;
 *   `watcher`: whether the routine a row names is a watcher, as the page's list of them says: its chip opens Watchers
 */

/** @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e);
/** Why a sent draft has no Bring back. */
const GONE = "What left this machine is not Filament's to call back: its service may let you delete it";

/** A row's age, its moment kept so the minute moves its words alone. @param {number} at @param {number} now */
export const ageEl = (at, now) => h("span", { class: "sp-need-age", "data-at": String(at) }, ageWords(at, now));

/** The ages under a host moved in place, as the minute passes: a menu open on a row keeps its button. @param {HTMLElement} host @param {number} now */
export function moveAges(host, now) {
  for (const el of Array.from(host.querySelectorAll(".sp-need-age"))) el.replaceChildren(ageWords(Number(el.getAttribute("data-at")), now));
}

/** @param {NeedRowsCtx} o */
export function needRows(o) {
  /** A row done, put off, or brought back; a draft discarded; an ask turned down. @param {Need} n @param {{ done?: true, later?: number, back?: true, discard?: true, turnDown?: true }} body */
  const to = (n, body) => {
    const p = o.place(n);
    return p ? o.post(p.id, `/needs/${encodeURIComponent(n.id)}`, body) : Promise.resolve(null);
  };

  /**
   * A draft's Review & send…: its sheet, which reads and writes the row's Space itself — its refusals said in the
   * sheet, not a toast — and the Space follows the events stream.
   * @param {Need} n @param {RowPlace} p
   */
  function review(n, p) {
    const base = `/space/${encodeURIComponent(p.id)}`;
    draftSheet({
      row: /** @type {any} */ (n),
      request: async (method, path, body) => {
        try {
          return { ok: true, got: (await api(`${base}${path}`, { method, ...(body === undefined ? {} : { body }) })) || {} };
        } catch (e) {
          return { ok: false, error: said(e) };
        }
      },
      askChat: o.askChat,
    });
  }

  /**
   * A draft's row (S5c, the mock's screen 2): "Draft · its title", its From, the chat that wrote it and when, its
   * project's chip where Your Space draws it; Review & send… and Discard, which Done today's Bring back undoes.
   * @param {Need} n @param {number} now
   */
  function draftRow(n, now) {
    const p = o.place(n);
    const d = /** @type {import("../lib/space-view.js").Draft} */ (n.draft);
    const own = n.project && o.chip ? o.chip(n.project) : null;
    return h("div", { class: "sp-need is-out is-draft", role: "listitem", "data-need": n.id, "data-key": `need:${n.id}` },
      h("span", { class: "sp-need-dot sp-need-pen", "aria-hidden": "true", html: ICONS.pencil }),
      h("span", { class: "sp-need-words" },
        h("span", { class: "sp-need-t", title: d.to ? `${n.text} — to ${d.to}` : n.text }, h("span", { class: "sp-draft-word" }, "Draft · "), n.text),
        h("span", { class: "sp-need-f" }, ...(own ? [own, " · "] : []), draftFrom(d), ` · by ${d.byName || "a chat"} · `, ageEl(n.at, now))),
      h("span", { class: "sp-need-acts" },
        ...(p ? [h("button", { class: "sm", type: "button", title: "Read it, change its words, and send it: nothing leaves until you press Send", onclick: () => review(n, p) }, "Review & send…")] : []),
        h("button", { class: "ghost sm sp-need-discard", type: "button", title: "Discard it: it moves to Done today, where Bring back puts it back", onclick: () => void to(n, { discard: true }) }, "Discard")));
  }

  /** Not now ▾ (S5-D3): until 09:00 this morning in the night, tomorrow 09:00, Monday 09:00. @param {Need} n @param {HTMLElement} anchor */
  function notNow(n, anchor) {
    menu(notNowChoices(Date.now()).map((c) => ({ label: c.label, icon: "clock3", desc: "It hides until then and comes back by itself; Show under the list brings it back sooner", onClick: () => void to(n, { later: c.until }) })),
      { anchor, side: "bottom", align: "end", width: 280 });
  }

  /**
   * A stopped source read again: its row goes once it reads, or once its scripts wait for a Keep — no failure, said as
   * it is —; one that fails still says so. @param {RowPlace} p @param {string} name @param {string} source
   */
  async function readAgain(p, name, source) {
    const got = await o.post(p.id, `/dashboards/${encodeURIComponent(name)}/read`, { source });
    const s = got?.sources?.[source];
    if (s?.error) toast(s.off === "held" ? `${source}: ${s.error}` : `${source} still fails: ${s.error}`, s.off === "held" ? "" : "err");
  }

  /** A stopped source's Fix it…: the Start in the project's folder, its failure in the box. @param {Need} n @param {RowPlace} p @param {RowDashboard} d @param {string} source */
  function fix(n, p, d, source) {
    if (!o.startWith) return;
    const head = `${n.title} stopped reading ${source}: `;
    o.startWith(p.cwd, fixWords(/** @type {any} */ (d), { source, said: n.text.startsWith(head) ? n.text.slice(head.length) : n.text }, p.name));
  }

  /** Not now ▾, on any row: its menu at the button that stands, the rows being drawn in place. @param {Need} n */
  const laterBtn = (n) =>
    h("button", { class: "ghost sm sp-need-later", type: "button", "aria-haspopup": "menu", title: "Hide it until a moment: it comes back by itself", onclick: (/** @type {Event} */ e) => notNow(n, /** @type {HTMLElement} */ (e.currentTarget)) },
      "Not now", h("span", { class: "sp-need-chev", html: ICONS.chevronDown }));
  /** Done, on any row but a draft's. @param {Need} n */
  const doneBtn = (n) => h("button", { class: "ghost icon sp-need-done", type: "button", "aria-label": "Done", title: "Done: it moves to Done today, where Bring back undoes it", html: ICONS.check, onclick: () => void to(n, { done: true }) });

  /**
   * A routine's failed run (S6, case 8): its words, its project's chip where Your Space draws it, Routines — a press
   * opens that tab —, its age and why it is here; Open, the chat it ran in; Fix…, the Start in its project's folder with
   * the failure in the box; Not now ▾ and Done. A run of it that ends well takes the row away.
   * What a watcher that tells only the person heard (the plan of 11-11, its w5) is its row too, and no failure: what
   * it heard, how many and when; no chat ran, so nothing to open or fix — Not now ▾ and Done.
   * A watcher's guidance held past what Filament sends by itself (app/watchers/guidance.js) is its row as well: whom it
   * would guide and why it waits, its words whole under them where the row's own line cut them, and Send it, which sends
   * that one now. A watcher's row — told, held or failed — has the chip Watchers, which opens its Space's Watchers.
   * @param {Need} n @param {number} now
   */
  function routineRow(n, now) {
    const p = o.place(n);
    const own = n.project && o.chip ? o.chip(n.project) : null;
    const chain = n.routine?.chain || "";
    const guide = n.routine?.guide;
    const told = !!n.routine?.told || !!guide;
    const watcher = told || !!n.routine?.watcher || !!o.watcher?.(n);
    const src = () => [h("span", { class: "sp-fed-src-ic", html: watcher ? ICONS.eye : ICONS.clock3 }), watcher ? "Watchers" : "Routines"];
    const srcTip = watcher ? "Open this Space's Watchers" : "Open this Space's Routines";
    const head = `“${n.title}” failed: `;
    const fixIt = () => {
      if (!p || !o.startWith) return;
      o.startWith(p.cwd, routineFixWords({ title: n.title, why: n.text.startsWith(head) ? n.text.slice(head.length) : n.text, ran: n.why.replace(/^a (?:routine|watcher) of this Space, /, ""), watcher }, p.name));
    };
    return h("div", { class: `sp-need is-out ${told ? "is-told" : "is-routine"}`, role: "listitem", "data-need": n.id, "data-key": `need:${n.id}` },
      h("span", { class: "sp-need-dot" }),
      h("span", { class: "sp-need-words" },
        h("span", { class: "sp-need-t", title: n.text }, n.text),
        h("span", { class: "sp-need-f" },
          ...(own ? [own, " · "] : []),
          p
            ? h("button", { class: "sp-fed-src sp-need-src", type: "button", title: srcTip, onclick: () => o.openTab(p.id, watcher ? WATCHERS : ROUTINES) }, ...src())
            : h("span", { class: "sp-fed-src sp-need-src" }, ...src()),
          " · ", ageEl(n.at, now)),
        ...(n.why ? [h("span", { class: "sp-need-why" }, told ? n.why : `why: ${n.why}`)] : []),
        // Its words whole, where the line above holds a part of them: said once where that line says them all.
        ...(guide && !n.text.includes(guide.text.trim()) ? [h("span", { class: "sp-need-guide" }, guide.text)] : [])),
      h("span", { class: "sp-need-acts" },
        ...(guide && p ? [h("button", { class: "sm sp-need-guide-send", type: "button", title: `Send these words to ${guide.name} now, as the watcher's guidance`, onclick: () => void o.post(p.id, `/needs/${encodeURIComponent(n.id)}/guide`, {}) }, "Send it")] : []),
        ...(!told && p && o.startWith ? [h("button", { class: "sm", type: "button", title: "The Start in its folder, the failure in its box: nothing runs until you send", onclick: fixIt }, "Fix…")] : []),
        ...(!told && chain && o.openChat ? [h("button", { class: "ghost sm", type: "button", title: "The chat it ran in", onclick: () => o.openChat?.(chain) }, "Open")] : []),
        laterBtn(n),
        doneBtn(n)));
  }

  /**
   * A watcher Filament switched off, what its program runs not being what its Switch on approved
   * (`routine.unapproved`): no run failed, so it is no failed run's row. Its head and its reason as the server says them, its project's chip
   * where Your Space draws it, Watchers, its age; Switch on… — its sheet, which shows what it runs now and switches
   * nothing by itself; where this page has no sheet, its Space's Watchers —; Not now ▾ and Done.
   * @param {Need} n @param {number} now
   */
  function unapprovedRow(n, now) {
    const p = o.place(n);
    const own = n.project && o.chip ? o.chip(n.project) : null;
    const src = () => [h("span", { class: "sp-fed-src-ic", html: ICONS.eye }), "Watchers"];
    return h("div", { class: "sp-need is-out is-unapproved", role: "listitem", "data-need": n.id, "data-key": `need:${n.id}` },
      h("span", { class: "sp-need-dot" }),
      h("span", { class: "sp-need-words" },
        h("span", { class: "sp-need-t", title: n.text }, n.text),
        h("span", { class: "sp-need-f" },
          ...(own ? [own, " · "] : []),
          p
            ? h("button", { class: "sp-fed-src sp-need-src", type: "button", title: "Open this Space's Watchers", onclick: () => o.openTab(p.id, WATCHERS) }, ...src())
            : h("span", { class: "sp-fed-src sp-need-src" }, ...src()),
          " · ", ageEl(n.at, now)),
        ...(n.why ? [h("span", { class: "sp-need-why" }, n.why)] : [])),
      h("span", { class: "sp-need-acts" },
        ...(p
          ? [h("button", {
              class: "sm primary sp-need-on", type: "button",
              title: o.switchOn ? "Its sheet, which shows what it runs now: nothing is switched on until you press Switch on there" : "Its Space's Watchers, where its Switch on… shows what it runs now: this press switches nothing on",
              onclick: () => (o.switchOn ? o.switchOn(n) : o.openTab(p.id, WATCHERS)),
            }, "Switch on…")]
          : []),
        laterBtn(n),
        doneBtn(n)));
  }

  /**
   * What an agent found when it was asked to reproduce a report (S7-D4, the mock's screen 14): Reproduced — its failing
   * test, how to run it; Fix it…, the Start in its lane's folder with them in the box — or Couldn't reproduce — what it
   * tried, its questions; Review & send… where it drafted them, else Copy the questions —; Open the lane, the chat that
   * sent it; Not now ▾ and Done.
   * @param {Need} n @param {number} now
   */
  function reproRow(n, now) {
    const p = o.place(n);
    const r = /** @type {import("../lib/space-view.js").Repro} */ (n.repro);
    const own = n.project && o.chip ? o.chip(n.project) : null;
    // Its draft of the questions while it waits to be sent; once sent or discarded, the questions are the row's to copy
    // again, and its line says what became of them (found by the Hunter on S7).
    const asked = r.draft && o.draftOf ? o.draftOf(n, r.draft) : null;
    const draft = asked && asked.state !== "done" ? asked : null;
    const how = !asked ? "" : draft ? "drafted" : asked.outcome === "sent" ? "sent" : "";
    // Fix it… starts in its lane's folder; one not recorded starts in the project's, said so (found by the Hunter on S7).
    const fixIn = r.cwd || p?.cwd || "";
    const copy = () => {
      const text = reproQuestions(r);
      const done = () => toast(r.questions.length === 1 ? "Copied the question" : `Copied the ${r.questions.length} questions`);
      // A page with no clipboard to write says where the words are instead.
      if (!navigator.clipboard?.writeText) return toast("This page cannot copy: the questions are on the row", "err");
      navigator.clipboard.writeText(text).then(done, () => toast("The questions were not copied: the page was not allowed to", "err"));
    };
    return h("div", { class: `sp-need is-out is-repro${r.reproduced ? " is-reproduced" : " is-not-reproduced"}`, role: "listitem", "data-need": n.id, "data-key": `need:${n.id}` },
      h("span", { class: "sp-need-dot" }),
      h("span", { class: "sp-need-words" },
        h("span", { class: "sp-need-t", title: n.text }, n.text),
        ...reproLines(r, how).map((line) => h("span", { class: "sp-need-line" }, line)),
        h("span", { class: "sp-need-f" }, ...(own ? [own, " · "] : []), `${r.byName || "an agent"} · `, ageEl(n.at, now))),
      h("span", { class: "sp-need-acts" },
        ...(r.reproduced && fixIn && o.startWith
          ? [h("button", { class: "sm primary", type: "button", title: r.cwd ? "The Start in its lane's folder, the failing test and how to run it in the box: nothing runs until you send" : "Its lane's folder was not recorded, so the Start is in the project's folder, the failing test and how to run it in the box: nothing runs until you send", onclick: () => o.startWith?.(fixIn, reproFixWords({ id: n.id, title: n.title, repro: r })) }, "Fix it…")]
          : []),
        ...(!r.reproduced && draft && p ? [h("button", { class: "sm primary", type: "button", title: "Its draft that asks the reporter: nothing leaves until you press Send", onclick: () => review(draft, p) }, "Review & send…")] : []),
        ...(!r.reproduced && !draft && r.questions.length ? [h("button", { class: "ghost sm sp-need-copy", type: "button", title: "Copy its questions for the reporter, a line each", onclick: copy }, "Copy the questions")] : []),
        ...(o.openChat ? [h("button", { class: "ghost sm", type: "button", title: "The chat that reproduced it, in its lane", onclick: () => o.openChat?.(r.chain) }, "Open the lane")] : []),
        laterBtn(n),
        doneBtn(n)));
  }

  /**
   * An ask's press (E42 SA-D7): Keep… and Switch on… open their sheet where this page has it, else the thing's tab;
   * Resume acts at once, as the bar's does — there is no sheet —; Tell the chats… opens the card with its words.
   * @param {Need} n @param {RowPlace | null} p
   */
  function askPress(n, p) {
    const a = n.ask;
    if (!a || !p) return;
    if (a.what === "keep") return o.keep ? o.keep(n) : o.openTab(p.id, n.dashboard);
    if (a.what === "on") return o.switchOn ? o.switchOn(n) : o.openTab(p.id, o.watcher?.(n) ? WATCHERS : ROUTINES);
    if (a.what === "tell") return o.tell ? o.tell(n) : o.openTab(p.id, OVERVIEW);
    if (a.all)
      // Pause all is this Filament's, not one Space's: its own switch; every Space hears it and reads again.
      return void api("/spaces/pause", { method: "POST", body: { on: false } }).catch((e) => toast(said(e), "err"));
    if (a.dashboard) return void o.post(p.id, `/dashboards/${encodeURIComponent(a.dashboard)}/pause`, { paused: false });
    if (a.routine) return void o.post(p.id, `/routines/${encodeURIComponent(a.routine)}/pause`, { paused: false });
  }

  /**
   * A chat's ask for a press that is yours (E42 SA-D7, the Designer's second pass): its title, the press in its sheet's
   * words; under it its chat and its reason — a Tell's words —; its thing's chip — a dashboard's opens its tab,
   * Routines, a watcher's Watchers —, none for a Tell; its age. Its press, Not now ▾, and Turn down.
   * @param {Need} n @param {number} now
   */
  function askRow(n, now) {
    const p = o.place(n);
    const a = /** @type {import("../lib/space-view.js").Ask} */ (n.ask);
    const own = n.project && o.chip ? o.chip(n.project) : null;
    const paused = a.what === "resume" ? " · paused" : "";
    const watcher = !!a.routine && !!o.watcher?.(n);
    const tab = watcher ? WATCHERS : ROUTINES;
    const tabChip = () => [h("span", { class: "sp-fed-src-ic", html: watcher ? ICONS.eye : ICONS.clock3 }), watcher ? "Watchers" : "Routines"];
    const chip = a.dashboard
      ? p
        ? h("button", { class: "sp-fed-src sp-need-src", type: "button", title: `Open ${n.title}`, onclick: () => o.openTab(p.id, /** @type {string} */ (a.dashboard)) }, h("span", { class: "sp-fed-src-ic", html: ICONS.layoutDashboard }), `${n.title}${paused}`)
        : h("span", { class: "sp-fed-src sp-need-src" }, h("span", { class: "sp-fed-src-ic", html: ICONS.layoutDashboard }), `${n.title}${paused}`)
      : a.routine || a.all
        ? p
          ? h("button", { class: "sp-fed-src sp-need-src", type: "button", title: watcher ? "Open this Space's Watchers" : "Open this Space's Routines", onclick: () => o.openTab(p.id, tab) }, ...tabChip())
          : h("span", { class: "sp-fed-src sp-need-src" }, ...tabChip())
        : null;
    const label = askButton(n);
    const titles = { keep: "Its Keep sheet, at the version it asks for: nothing runs until you keep it", on: "Its Switch on… sheet: nothing runs until you switch it on", resume: "It acts at once, as the bar's Resume does: there is no sheet", tell: "The Tell the chats card, its words quoted as its chat's: nothing is sent until Tell them" };
    return h("div", { class: "sp-need is-out is-ask", role: "listitem", "data-need": n.id, "data-key": `need:${n.id}` },
      h("span", { class: "sp-need-dot" }),
      h("span", { class: "sp-need-words" },
        h("span", { class: "sp-need-t", title: n.text }, n.text),
        h("span", { class: "sp-need-line" }, askLine(n)),
        h("span", { class: "sp-need-f" }, ...(own ? [own, " · "] : []), ...(chip ? [chip, " · "] : []), ageEl(n.at, now))),
      h("span", { class: "sp-need-acts" },
        ...(label && p ? [h("button", { class: "sm sp-need-ask", type: "button", title: titles[a.what], onclick: () => askPress(n, p) }, label)] : []),
        laterBtn(n),
        h("button", { class: "ghost sm sp-need-turn", type: "button", title: turnDownTitle(n), onclick: () => void to(n, { turnDown: true }) }, "Turn down")));
  }

  /**
   * An open row of another machine's Space of the same repository (the remote-agents plan's sp-cross): its words, that
   * machine and its row's title there, its age and why it is there; Done alone, which dismisses it here — it is dealt
   * with on that machine, and goes from here by itself once it is closed there.
   * @param {Need} n @param {number} now
   */
  function machineRow(n, now) {
    const m = /** @type {NonNullable<Need["machine"]>} */ (n.machine);
    const own = n.project && o.chip ? o.chip(n.project) : null;
    const name = m.name || "another machine";
    return h("div", { class: "sp-need is-out is-machine", role: "listitem", "data-need": n.id, "data-key": `need:${n.id}` },
      h("span", { class: "sp-need-dot" }),
      h("span", { class: "sp-need-words" },
        h("span", { class: "sp-need-t", title: n.text }, n.text),
        h("span", { class: "sp-need-f" },
          ...(own ? [own, " · "] : []),
          h("span", { class: "sp-fed-src sp-need-src", title: `A row of ${name}'s Space of this repository: it is dealt with there` }, h("span", { class: "sp-fed-src-ic", html: ICONS.network }), `On ${name}${n.title ? ` · ${n.title}` : ""}`),
          " · ", ageEl(n.at, now)),
        ...(n.why ? [h("span", { class: "sp-need-why" }, `why: ${n.why}`)] : [])),
      h("span", { class: "sp-need-acts" },
        h("button", { class: "ghost icon sp-need-done", type: "button", "aria-label": "Done", title: `Done: dismissed here alone — it stays open on ${name}`, html: ICONS.check, onclick: () => void to(n, { done: true }) })));
  }

  /**
   * A row: its words, its project's chip where Your Space draws it, its dashboard — a press opens its tab — and its
   * age, and why it is here; on a stopped source Fix it… and Read again; on what a watch found or a check says did not
   * work, Hand to an agent… and Reproduce…; on each, Not now ▾ and Done.
   * @param {Need} n @param {number} now
   */
  function row(n, now) {
    if (n.kind === "machine" && n.machine) return machineRow(n, now);
    if (n.kind === "draft" && n.draft) return draftRow(n, now);
    if (n.kind === "routine") return n.routine?.unapproved ? unapprovedRow(n, now) : routineRow(n, now);
    if (n.kind === "repro" && n.repro) return reproRow(n, now);
    if (n.kind === "ask" && n.ask) return askRow(n, now);
    const p = o.place(n);
    const dashboards = p?.dashboards || [];
    const chip = needChip(n, /** @type {any} */ (dashboards));
    const d = dashboards.find((x) => x.name === n.dashboard);
    const source = n.kind === "source" && d ? n.source || "" : "";
    const own = n.project && o.chip ? o.chip(n.project) : null;
    return h("div", { class: `sp-need is-out is-${n.kind}`, role: "listitem", "data-need": n.id, "data-key": `need:${n.id}` },
      h("span", { class: "sp-need-dot" }),
      h("span", { class: "sp-need-words" },
        h("span", { class: "sp-need-t", title: n.text }, n.text),
        h("span", { class: "sp-need-f" },
          ...(own ? [own, " · "] : []),
          chip.tab && p
            ? h("button", { class: "sp-fed-src sp-need-src", type: "button", title: `Open ${n.title}`, onclick: () => o.openTab(p.id, n.dashboard) }, h("span", { class: "sp-fed-src-ic", html: ICONS.layoutDashboard }), chip.label)
            : h("span", { class: "sp-fed-src sp-need-src is-gone", title: "Taken out of its Space: Add to this Space… puts it back" }, h("span", { class: "sp-fed-src-ic", html: ICONS.layoutDashboard }), chip.label),
          " · ", ageEl(n.at, now)),
        ...(n.why ? [h("span", { class: "sp-need-why" }, `why: ${n.why}`)] : [])),
      h("span", { class: "sp-need-acts" },
        ...(source && d && p && o.startWith
          ? [h("button", { class: "sm", type: "button", title: "The Start with this failure, its source and the dashboard named: nothing runs until you send", onclick: () => fix(n, p, d, source) }, "Fix it…")]
          : []),
        ...(source && p ? [h("button", { class: "ghost sm", type: "button", title: `Run ${source} again now: the row goes once it reads`, onclick: () => void readAgain(p, n.dashboard, source) }, "Read again")] : []),
        // Hand to an agent… (S5d, SG-D25): what a watch found, or a check that says a button did not work, in the Start's
        // box in the project's folder; the row stays until you mark it Done (S5d-D1). A stopped source has Fix it….
        ...((n.kind === "watch" || n.kind === "check") && p && o.startWith
          ? [h("button", { class: `${n.kind === "check" ? "" : "ghost "}sm sp-need-hand`, type: "button", title: o.handOff ? "Asks where its chat runs, then the Start with this row in its box: nothing runs until you send" : "The Start here, this row in its box: nothing runs until you send", onclick: () => (o.handOff ? o.handOff(p, handWords(n, p.name)) : o.startWith?.(p.cwd, handWords(n, p.name))) }, "Hand to an agent…")]
          : []),
        // Reproduce… (S7-D1): the Start on a new lane with the Builder, which writes a failing test and fixes nothing.
        ...((n.kind === "watch" || n.kind === "check") && p && o.reproduce && !o.plain?.()
          ? [h("button", { class: "ghost sm sp-need-repro", type: "button", title: REPRO_TIP, onclick: () => o.reproduce?.(p.cwd, reproReportOf(n, p.name)) }, "Reproduce…")]
          : []),
        laterBtn(n),
        doneBtn(n)));
  }

  /**
   * A row's title in Done today and Put off: a row an agent closed has one quiet line under it — its name, which opens
   * its chat, and its line, in What happened's own form (E42 SA-D5, the Designer's second pass); one the person closed
   * reads as ever. @param {Need} n
   */
  function pastTitle(n) {
    const title = h("span", { class: "sp-past-t", title: n.text }, n.text);
    const by = n.state === "done" ? n.doneBy : null;
    if (!by || !doneByLine(n)) return title;
    const who = by.byName || "An agent";
    return h("span", { class: "sp-past-tl" }, title,
      h("span", { class: "sp-quiet sp-past-line", title: doneByLine(n) },
        o.openChat ? h("button", { class: "sb-more sp-past-by", type: "button", title: "The chat that marked it done", onclick: () => o.openChat?.(by.chain) }, who) : who,
        `: ${by.line}`));
  }

  /**
   * Under the rows: "Done today: 2 · Show", "1 later · Show"; Show lists them, each with its moment and Bring back — the
   * way back from Done and from Not now. Hidden where there are none. Each part and row keyed: the foot is drawn in
   * place as its page moves, and its Show made anew stood under a resting pointer (the owner's of 11-01: buttons
   * blinking under a resting pointer, clicks lost).
   * @param {HTMLElement} host @param {{ done: Need[], later: Need[] }} g @param {number} now
   * @param {{ show: "" | "done" | "later", toggle: (which: "done" | "later") => void, where?: (n: Need) => string, back?: string }} w
   *   `show`: which list is open; `where`: a row's place before its dashboard's title (Your Space: its project); `back`:
   *   where Bring back puts it, in its tooltip's words
   */
  function foot(host, g, now, w) {
    host.hidden = !g.done.length && !g.later.length;
    /** @param {"done" | "later"} which @param {string} words */
    const part = (which, words) => h("span", { class: "sp-needs-part", "data-key": `part:${which}` }, `${words} · `,
      h("button", { class: "sb-more sp-needs-show", type: "button", "aria-expanded": String(w.show === which), onclick: () => w.toggle(which) }, w.show === which ? "Hide" : "Show"));
    const list = w.show === "done" ? g.done : w.show === "later" ? g.later : [];
    /** Where a row came from; an ask's, its chat (the Designer: "Deploy fixer · kept 15:06"). @param {Need} n */
    const from = (n) => [w.where?.(n) || "", n.kind === "ask" && n.ask ? n.ask.byName || "a chat" : n.title].filter(Boolean).join(" · ");
    /**
     * How a done row ended: a draft sent or discarded (S5c), an ask kept, turned down, gone (E42), another machine's row
     * put off or closed there, or its Space no longer read from there (sp-cross), else done. @param {Need} n
     */
    const ended = (n) =>
      n.kind === "ask" ? askEnded(n).words
      : n.machine?.closed ? (n.machine.gone ? `no longer in ${n.machine.name || "its machine"}'s Spaces` : `put off or closed on ${n.machine.name || "its machine"}`)
      : n.kind !== "draft" ? "done" : n.outcome === "sent" ? "sent" : "discarded";
    /**
     * Whether Bring back is its way back: not for a sent draft, an ask its press answered or whose thing moved, nor a row
     * closed on its machine, which comes back once it is open there again. @param {Need} n
     */
    const backs = (n) => (n.kind === "ask" ? n.state !== "done" || askEnded(n).back : n.machine?.closed ? n.state !== "done" : ended(n) !== "sent");
    return [
      h("div", { class: "sp-needs-parts", "data-key": "parts" },
        ...(g.done.length ? [part("done", `Done today: ${g.done.length}`)] : []),
        ...(g.later.length ? [part("later", `${g.later.length} later`)] : [])),
      ...(list.length
        ? [h("div", { class: "sp-needs-past", role: "list", "aria-label": w.show === "done" ? "Done today" : "Put off", "data-key": "past" },
            ...list.map((n) => h("div", { class: "sp-past", role: "listitem", "data-need": n.id, "data-key": `past:${n.id}` },
              pastTitle(n),
              h("span", { class: "sp-quiet sp-past-when", ...(ended(n) === "sent" && n.kind === "draft" ? { title: GONE } : n.kind === "ask" && !backs(n) ? { title: askEnded(n, !!o.watcher?.(n)).title } : {}) }, n.state === "done" ? `${from(n)} · ${ended(n)} ${whenWords(n.doneAt ?? n.at, now)}` : `${from(n)} · until ${untilWords(n.until ?? now, now)}`),
              // A sent draft has no way back from here: what left this machine is the service's now (S5c-D5). Where its
              // service put it, when its answer said (S5c-D14; seen live: "sent" twice, a second "Sent" in Bring back's place).
              ...(backs(n)
                ? [h("button", { class: "ghost sm sp-past-back", type: "button", title: `Back in ${w.back || "Needs you here"}, as it was`, onclick: () => void to(n, { back: true }) }, n.state === "done" ? "Bring back" : "Bring back now")]
                : n.draft?.sent?.link
                  ? [h("a", { class: "sb-more sp-past-sent", href: n.draft.sent.link, target: "_blank", rel: "noopener noreferrer", title: `${n.draft.sent.link} — ${GONE}` }, "Open")]
                  : []))))]
        : []),
    ];
  }

  return { row, foot };
}
