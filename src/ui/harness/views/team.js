// @ts-check
// The Team view (HarnessV3-Views VW-D5, V3): who works on the session, live — once a tab of its own (team_v2_plan
// TV2-D1), the Agents tab's pane for a team's row since U13-D5 (`paint(chat, focus)`: the team in charge, a team on the
// side alone, or the home). The head says who
// answers — a team by who runs it (its lead, with its members: HarnessV4_Tasks E15 step 6, AG-174), its line — or,
// with no team, that the task graph's tasks run on workers of their own; and the session's Seats for
// team workers, the models a team's workers and the graph's tasks run on (E23-D6: the sub-agents' seats are the Sub
// Agents tab's) — then the lead's card (what it does now, its newest words, a team's orders this turn and its
// figures; "Your agent"'s card is gone, M4: the status capsule and Overview say it), a card for each of a team's workers
// and each agent doing a task of the graph (`teamWork`: the agents on the side are the Sub Agents tab's, where a team's workers are too — the owner's words of
// 10-18) — asking first, then running, then the newest done; older ones fold under Earlier — with the session's graph's
// tasks still to come between the work going on and the work done — waiting, or ready, each opening on the Plan view's
// graph (HarnessV3-TaskGraph G3-7). It paints in place: each
// card is kept by its sub-agent's id, or its task's, and only its parts change on a pulse — a task's is built again
// when what it says changes — so a Deny's words, an open Earlier or a focused button survive the run's events. A
// working worker's card has Message, a box of its own for your words to it past its lead (HarnessV4_Tasks decision
// 10), kept through the pulses so half-typed words stay. The
// words are lib/team.js's; every write and answer goes through the host (app.js), which confirms a switch with its
// sheet. Under it all, the teams beside this chat (team_v2_plan §5.2, views/beside.js): a card for each team that runs
// or ran beside it. With no team leading, the tab is the Teams home (team_v2_plan §10 O1, views/teams-home.js): what a
// team is, the two ways — On the side, In charge — and the teams as squads, each with Brief…, which opens the one sheet
// every team starts from (views/brief.js).
import { h, morphChildren, placeChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { formatWorkedFor } from "../lib/labels.js";
import { prettyModel, vendorOf } from "../lib/families.js";
import { contextGauge, rowWords } from "../lib/subagents.js";
import { failureCard, failureWords } from "../lib/failure.js";
import { poolRows } from "../lib/pool.js";
import { answerControls, answersKey, questionChoices, questionOf } from "../conversation/decisions.js";
import { createBesideView } from "./beside.js";
import { createTeamsHome } from "./teams-home.js";
import { backCostWords, leadLook } from "../lib/brief.js";
import { ago, gaugeSvg, inlineMarks, kids, ringSvg, segmented, stateColor, usd } from "../widgets/kit.js";
import { accountName, fullestOf, gaugeOf, glanceOf, readsAs, summaryWords } from "../../lib/accounts.js";
import {
  STATE_WORDS, askWords, asksYou, callLine, cardFigures, checkLine, cardOrder, cardState, compactionCount, crewOf, leadAskLine, leadWord, leaderState,
  leaderWaits, leadingSince, leadingTeam, newestWords, orderRows, plansOf, readAlongLine, repeatWords, runByLine, sendBackTitles,
  switchWait, attemptBadge, attemptTries, taskTries, teamWork, timesWords, waitingTasks, whoOf, whoOfTask, ownLast,
} from "../lib/team.js";

/** @typedef {typeof h} Mk */
/** @typedef {(parent: any, wanted: any[]) => void} Place */

/**
 * What the Team view reads and does — the host's.
 * @typedef {{
 *   rows: () => any[],
 *   face: () => { fill: number | null, color: string, text: string },
 *   model: () => string,
 *   models: () => any[],
 *   account: (model: string) => any,
 *   write: (change: any) => void,
 *   open: (id: string) => void,
 *   stop: (id: string) => void,
 *   sendBack: (task: string, fresh: boolean) => void,
 *   answer: (id: string, a: import("../conversation/decisions.js").WorkerAnswer) => Promise<boolean>,
 *   always: (id: string, offer: import("../lib/labels.js").Offer, ask: number | null) => Promise<boolean>,
 *   message?: (id: string, words: string) => Promise<boolean>,
 *   back: () => void,
 *   backCost?: () => { tokens: number, usd: number | null } | null,
 *   home?: import("./teams-home.js").TeamsHomeIO,
 *   beside?: import("./beside.js").BesideIO,
 *   flows?: () => import("../lib/flow.js").Flow[],
 *   flow?: { el: any, paint: (chat: any, id: string) => void },
 *   work?: { el: any, paint: (chat: any) => void, row: () => string | null },
 *   graph: () => any,
 *   openTask: (id: string) => void,
 *   now?: () => number,
 * }} TeamIO  `rows`: the session's sub-agents; `face`: the session's window as the context ring shows it; `model`: the
 *   session's model, the lead's or your agent's; `models`: what a worker may run on; `account`: the page's account
 *   row of the coding agent a model runs on, or null for a model that is none (HarnessV3-ACP AC6-7); `write`: the
 *   session's one settings writer; `open`: a sub-agent's conversation, in the viewer; `sendBack`: a failed graph task
 *   sent back by the developer themselves — to its last worker, or fresh to a new one; `answer`/`always`: a worker's
 *   waiting call answered; `message`: your words to a working worker, past its lead — true once it took them, else
 *   the host said why; `back`: a switch back to your own agent, which the host confirms with its sheet; `backCost`: what
 *   it costs, once — the conversation cached again (team_v2_plan §10 O4) — or null while unknown; `home`: the
 *   Teams home's reads and presses, with no team leading; `flows`: the chat's flows (HarnessV4_Flow_Plan F5), and
 *   `flow` the pane a flow's row shows (views/flow.js `createFlowPane`); `work`: the picture of your agent's own work
 *   and its row's words (views/agent-work.js, HarnessV4_OneAgent_Plan L47); `graph`: the session's task graph as the Plan view draws it,
 *   or null; `openTask`: a task, chosen on the Plan view's graph
 */

/** The states a card's badge can wear, each a class (the graph's colours, and orange while it asks). */
const CARD_STATES = Object.freeze(["asking", "running", "review", "done", "stopped", "failed"]);
/** The leader's. */
const LEAD_STATES = Object.freeze(["asking", "running", "waiting", "ready"]);
/**
 * The paces of a lead's looks the Team tab offers, in seconds (engine.lookSeconds; HarnessV3-TaskGraph-v2 TG2-D48); 0 is
 * whenever something is new, and 300 the default.
 */
const LOOK_PACES = Object.freeze([0, 30, 60, 300, 600]);
/** A pace in the tab's words: "30 s", "1 min", "5 min". @param {number} n */
const paceLabel = (n) => (n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} s`);
/** What stands over the lead's two controls, Reads along and Looks: what they are, then what each is for. */
const FOLLOW = Object.freeze({
  head: "How the lead follows its workers",
  note: "Reads along is whether it sees each worker's steps as it works, or only its report; Looks is how often it looks.",
});
/** A task still to come, by its state (lib/team.js's waitingTasks). */
const TASK_WORDS = Object.freeze({ waiting: "waiting", ready: "ready" });

/** @param {any} el @param {readonly string[]} all @param {string} on */
const stateClass = (el, all, on) => { for (const s of all) el.classList.toggle(`is-${s}`, s === on); };
/** @param {string} s */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * @param {TeamIO} io
 * @param {{ h?: Mk, place?: Place, later?: (fn: () => void, ms: number) => void, drawIn?: (parent: any, nodes: any[]) => void }} [o]
 *   the tests' fake DOM, its `place` and the timer
 * @returns {{ el: any, paint: (chat: any, focus?: string) => void, reveal: (id: string) => void }}
 */
export function createTeamView(io, o = {}) {
  const mk = o.h || h;
  const place = o.place || placeChildren;
  // Painted at every pulse of the chat's agents: the lead's card, the workers' and the head's live parts are drawn in
  // place, under a resting pointer the elements they were (the owner's of 11-01: buttons blinking, clicks lost).
  const drawIn = o.drawIn || morphChildren;
  const now = io.now || Date.now;
  const later = o.later || ((fn, ms) => { setTimeout(fn, ms); });
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "inst-ic") => mk("span", { class: cls, html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  /** A model's tile and name. @param {string} id */
  const modelTag = (id) => {
    const v = vendorOf(id);
    return mk("span", { class: "ag-model", title: id }, mk("span", { class: "mp-tile is-sm", style: `--tile:${v.hue}`, "aria-hidden": "true" }, v.mark), prettyModel(id));
  };
  /** A figure: its glyph, its text, and what it is. @param {any} lead @param {string} text @param {string} title */
  const fig = (lead, text, title) => mk("span", { class: "ag-fig", title }, lead, text);
  /** A ring for a share of a window, its colour turning orange near the top. @param {number} f @param {number} size @param {number} width @param {string} [color] */
  const ring = (f, size, width, color) =>
    mk("span", { class: "mini-ring", html: ringSvg({ size, width, parts: [{ f: Math.max(0.001, f), color: color || (f >= 0.85 ? "var(--color-sys-orange)" : "var(--color-sys-blue)") }] }) });

  /** @type {any} the chat on screen */
  let chat = null;

  // ---- the head: who answers ---------------------------------------------------------------------------------------
  const head = {
    tile: mk("span", { class: "tv-tile-slot" }),
    title: mk("div", { class: "tv-title" }),
    sub: mk("div", { class: "tv-sub" }),
    problem: mk("div", { class: "tv-problem", role: "status" }),
    plans: mk("div", { class: "tv-plans", role: "group", "aria-label": "The plans the team draws on" }),
    /** What the tile shows now: its key, so a pulse leaves it be. */
    tileKey: "",
  };
  const settingsOf = () => chat?.view?.settings || {};
  // The lead reads along with its workers (HarnessV3-TaskGraph-v2 §12, TG2-D21): the switch, with the pace of its looks
  // beside it while it is on. Both are the session's (engine.supervise, engine.lookSeconds); a switch reaches the
  // next turn, a pace the next look. They stand under the lead's card, in one row under what they are for; each
  // choice's effect is its tip.
  const readsOn = () => settingsOf().effective?.engine?.supervise !== false;
  const reads = segmented(mk, {
    options: [
      { id: "on", label: "On", title: "While its workers run, Filament shows the lead a look at each one — its plan, every round since the last look — and it corrects one that heads wrong with a message" },
      { id: "off", label: "Off", title: "The lead reads a line of status for each worker when its wait returns, then their reports" },
    ],
    value: () => (readsOn() ? "on" : "off"),
    onChange: (id) => { if ((id === "on") !== readsOn()) io.write({ patch: { engine: { supervise: id === "on" } } }); },
    ariaLabel: "The lead reads along with its workers",
  });
  const pace = () => { const n = Number(settingsOf().effective?.engine?.lookSeconds); return Number.isFinite(n) ? n : 300; };
  const paces = segmented(mk, {
    options: LOOK_PACES.map((n) => ({ id: String(n), label: n ? paceLabel(n) : "Any move", title: n ? `A look at most every ${paceLabel(n)} while something is new, unless a sign makes one due at once${n === 300 ? " — the default" : ""}` : "A look whenever something is new" })),
    value: () => String(pace()),
    onChange: (id) => { if (Number(id) !== pace()) io.write({ patch: { engine: { lookSeconds: Number(id) } } }); },
    ariaLabel: "The pace of the lead's looks",
  });
  /**
   * The chat's list: what a coding agent alone launches Filament's agents on where a launch names none, and what a team's
   * crew and a plan's tasks run on (U13-D14) — set on the Agents tab, not here.
   */
  const pool = () => poolRows(settingsOf().flat?.["subagents.pool"]);
  /** Why a switch must wait now, else null (lib/team.js's switchWait). @type {string | null} */
  let wait = null;
  const backBtn = mk("button", { class: "inst-btn", type: "button", onclick: () => { if (!wait) io.back(); } }, "Back to your agent");
  const ctl = (/** @type {string} */ label, /** @type {any} */ control) => mk("div", { class: "tv-ctl" }, mk("span", { class: "tv-ctl-label" }, label), control);
  const readsCtl = ctl("Reads along", reads.el);
  const paceCtl = ctl("Looks", paces.el);
  const followRow = mk("div", { class: "tv-follow-row" });
  const followEl = mk("section", { class: "tv-follow", role: "group", "aria-label": FOLLOW.head },
    mk("div", { class: "tv-follow-head" }, mk("h3", { class: "tv-follow-h" }, FOLLOW.head), mk("p", { class: "tv-follow-note" }, FOLLOW.note)),
    followRow);
  const headEl = mk("div", { class: "tv-head" }, head.tile, mk("div", { class: "tv-head-text" }, head.title, head.sub, head.plans, head.problem));
  // A team in charge (team_v2_plan §10 O4): its head and its lead in one gold frame, how the lead follows its workers
  // under its card, Back to your agent at its foot with what it costs, once.
  const backNote = mk("span", { class: "tv-back-note" });
  const backRow = mk("div", { class: "tv-back" }, backBtn, backNote);
  const chargeEl = mk("section", { class: "tv-charge", "aria-label": "The team in charge of this chat" });

  /**
   * One coding agent's plan the team draws on (HarnessV3-ACP AC6-7, AC6-D6): its fullest window's gauge, the agent and
   * its glance, amber or red as the window warns or is spent; its sentence on hover.
   * @param {any} r  the page's row for the agent
   */
  const planPill = (r) => {
    const g = glanceOf(r.account);
    return mk("span", { class: `tv-plan${g.tone ? ` is-${g.tone}` : ""}`, role: "img", title: summaryWords(r, now()), "aria-label": summaryWords(r, now()) },
      mk("span", { class: "tv-plan-gauge", html: gaugeSvg({ width: 18, stroke: 2.6, f: gaugeOf(r.account), color: stateColor(readsAs(r.account, fullestOf(r.account)), "var(--color-sys-gray)") }) }),
      mk("span", { class: "tv-plan-name" }, accountName(r)),
      g.figure ? mk("span", { class: "tv-plan-fig" }, [g.tag, g.figure].filter(Boolean).join(" ")) : null);
  };

  /** @param {import("../lib/team.js").Leading | null} team */
  const paintHead = (team) => {
    const model = io.model();
    const tileKey = team ? `team:${team.key}` : `model:${model}`;
    if (tileKey !== head.tileKey) {
      head.tileKey = tileKey;
      const v = vendorOf(model);
      const look = team ? leadLook(team.key) : null;
      // A team's lead as the squads draw it (§10 O4): its portrait, gold-ringed, the crown on it.
      head.tile.replaceChildren(look
        ? mk("span", { class: `pf s48 t-${look.tone} ring-gold`, "aria-hidden": "true" }, glyph(look.icon, "pf-ic"), glyph("crown", "pf-crown"))
        : mk("span", { class: "mp-tile tv-tile", style: `--tile:${v.hue}`, "aria-hidden": "true" }, v.mark));
    }
    drawIn(head.title, team
      ? [team.name, mk("span", { class: "tv-charge-tag" }, glyph("crown", "tv-charge-ic"), "In charge of this chat")]
      : ["No team leads this chat"]);
    // With no team, the graph's tasks run on workers of their own; a coding agent's sub-agents run as the loop's do (the
    // owner's of 11-06).
    const who = model ? prettyModel(model) : "The chat's model";
    const alone = `${who} works on it, and the task graph's tasks run on workers of their own.`;
    head.sub.replaceChildren(team ? runByLine(team) : alone);
    head.problem.replaceChildren(...(team?.problem ? [`It cannot lead now: ${team.problem}. Its turns go to the model meanwhile.`] : []));
    // Each coding agent the team runs on, its lead or its workers, once: its windows are its account's, not a card's.
    drawIn(head.plans, team ? plansOf([io.account(model), ...pool().map((r) => io.account(r.model || model))]).map(planPill) : []);
    reads.paint();
    paces.paint();
    backBtn.toggleAttribute("disabled", !!wait);
    backBtn.setAttribute("aria-disabled", wait ? "true" : "false");
    backBtn.setAttribute("title", wait || "Your own agent answers from your next message; the whole conversation stays");
    backNote.replaceChildren(...kids([backCostWords(io.backCost?.() || null)]));
    place(followRow, kids(team ? [readsCtl, readsOn() ? paceCtl : null] : []));
  };

  // ---- with no team leading: the Teams home (team_v2_plan §10 O1) ------------------------------------------------
  const home = io.home ? createTeamsHome(io.home, { h: mk, place, drawIn }) : null;

  // ---- the leader's card --------------------------------------------------------------------------------------------
  const ld = {
    tile: mk("span", { class: "ld-tile-slot" }),
    role: mk("div", { class: "ag-role" }),
    title: mk("div", { class: "ag-task" }),
    badge: mk("span", { class: "tg-badge" }),
    words: mk("p", { class: "ld-words" }),
    orders: mk("div", { class: "ld-orders", role: "group", "aria-label": "Its orders this turn" }),
    figs: mk("div", { class: "ag-figs" }),
    ring: mk("div", { class: "ld-ring" }),
    kv: mk("dl", { class: "ld-kv" }),
    tileKey: "",
    ordersKey: "",
  };
  const ldTop = mk("div", { class: "ag-top" }, ld.tile, mk("div", { class: "ag-who" }, ld.role, ld.title), ld.badge);
  const ldMain = mk("div", { class: "ld-main" });
  const leaderEl = mk("section", { class: "ag-card ld-card" }, ldMain, mk("div", { class: "ld-figs" }, ld.ring, ld.kv));

  /** @param {import("../lib/team.js").Leading | null} team @param {any[]} rows @param {number} t */
  const paintLeader = (team, rows, t) => {
    const turns = chat.turns || [];
    const newest = ownLast(turns);
    const liveTurn = chat.live?.turn && chat.live.turn === newest ? chat.live : null;
    const model = io.model();
    const tileKey = team ? "crown" : `model:${model}`;
    if (tileKey !== ld.tileKey) {
      ld.tileKey = tileKey;
      const v = vendorOf(model);
      ld.tile.replaceChildren(team ? glyph("crown", "team-tile ld-tile") : mk("span", { class: "mp-tile ld-tile", style: `--tile:${v.hue}`, "aria-hidden": "true" }, v.mark));
    }
    const s = leaderState({
      live: !!chat.live,
      paused: asksYou(newest),
      waits: !!chat.live && leaderWaits(newest?.aligned),
      atWork: rows.filter((r) => r.origin === "agent" && r.status === "running").length,
      team: !!team,
    });
    leaderEl.classList.toggle("is-solo", !team);
    stateClass(leaderEl, LEAD_STATES, s.state);
    ld.role.replaceChildren(team ? leadWord(team) : "Your agent");
    ld.title.replaceChildren(s.title);
    ld.badge.replaceChildren(s.badge);
    stateClass(ld.badge, LEAD_STATES, s.state);
    leaderEl.setAttribute("aria-label", `${team ? `The ${team.name} lead` : "Your agent"}: ${s.title}`);
    const words = newestWords(liveTurn?.reply?.blocks || newest?.blocks || [], newest?.note || null);
    drawIn(ld.words, inlineMarks(mk, words));
    // A team's orders this turn: each launch the lead made, by its seat and its task, with its worker's state now; a
    // click brings its card. The worker's id is the chip's tip's: a name for a log, not for the page.
    const orders = team && newest ? orderRows(newest.aligned, rows) : [];
    const ordersKey = orders.map((x) => `${x.agentId}:${x.state}`).join(",");
    if (ordersKey !== ld.ordersKey) {
      ld.ordersKey = ordersKey;
      ld.orders.replaceChildren(mk("span", { class: "ld-orders-label" }, "This turn"), ...orders.map((x) =>
        mk("button", { class: `ld-order is-${x.state}`, type: "button", title: `${x.word} ${x.agentId}: ${x.task} — ${STATE_WORDS[x.state]}`, onclick: () => reveal(x.agentId) },
          glyph(x.icon, "role-tile is-xs"), mk("span", { class: "ld-order-seat" }, x.word), mk("span", { class: "ld-order-name" }, x.task), mk("i", { class: `tg-dot is-${x.state}` }))));
    }
    const startedAt = Number(newest?.startedAt);
    const endedAt = liveTurn ? t : Number(newest?.endedAt);
    const ms = Number.isFinite(startedAt) && Number.isFinite(endedAt) ? Math.max(0, endedAt - startedAt) : null;
    drawIn(ld.figs, kids([
      model ? modelTag(model) : null,
      ms != null ? fig(glyph("timer", "ag-fig-ic"), formatWorkedFor(ms), liveTurn ? "This turn so far" : "Its newest turn took") : null,
    ]));
    place(ldMain, kids([ldTop, words ? ld.words : null, orders.length ? ld.orders : null, ld.figs]));
    // Its window, as the context ring shows it; then the round, the compactions, the spend and the time.
    const face = io.face();
    drawIn(ld.ring, [
      mk("span", { class: "ld-ring-svg", html: ringSvg({ size: 52, width: 5, parts: face.fill != null ? [{ f: Math.max(0.001, face.fill), color: face.color }] : [] }) }),
      mk("span", { class: "ld-ring-num" }, face.text || "—")]);
    ld.ring.setAttribute("title", face.fill != null ? `Its window: ${face.text} full` : "Its window: not known yet");
    const settings = settingsOf();
    const n = compactionCount(turns);
    const since = team ? leadingSince(turns, team.key) : Number(turns.find((x) => !x.command)?.startedAt) || null;
    const spent = Number(settings.usage?.usd);
    const round = Number(newest?.aligned?.maxRound) || 0;
    drawIn(ld.kv, [
      mk("dt", {}, liveTurn ? "Round" : "Rounds"), mk("dd", {}, round ? String(round) : "—"),
      mk("dt", {}, "Compactions"), mk("dd", {}, n ? timesWords(n) : "none"),
      mk("dt", {}, "Spent"), mk("dd", { title: "The session's spend, its agents' and workers' included" }, Number.isFinite(spent) ? usd(spent) : "—"),
      mk("dt", {}, team ? "Leading" : "Since"),
      mk("dd", {}, since ? (team ? formatWorkedFor(t - since) : new Date(since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : team ? "next turn" : "—")]);
  };

  // ---- the cards ----------------------------------------------------------------------------------------------------
  /**
   * @typedef {{ id: string, el: any, word: any, tryN: any, task: any, badge: any, top: any, live: any, report: any,
   *   fail: any, failKey: string, figs: any, folds: any, tries: any, triesCount: any, triesList: any, triesKey: string, open: any,
   *   stop: any, acts: any, actsKey: string, foot: any, bar: any, ask: any, askKey: string,
   *   tell: any, tellBox: any, tellIn: any, telling: boolean, again: () => void }} Card
   *   `tell`: Message, and `tellBox` the box it opens (`telling`); `again`: the card painted again as it was last
   */
  /** @type {Map<string, Card>} */
  const cards = new Map();

  /** A card, built once for its sub-agent. @param {any} row @returns {Card} */
  const makeCard = (row) => {
    const id = String(row.id);
    const who = whoOf(row);
    const word = mk("span", { class: "ag-role-word" }, who.word);
    const tryN = mk("span", { class: "ag-try" });
    const task = mk("div", { class: "ag-task" });
    const badge = mk("span", { class: "tg-badge" });
    const top = mk("div", { class: "ag-top" },
      glyph(who.icon, `role-tile${who.worker ? "" : " is-sub"}`),
      mk("div", { class: "ag-who" }, mk("div", { class: "ag-role", title: `${who.word} ${id}` }, word, tryN), task),
      badge);
    // Its task's earlier tries, folded: built once, so the fold stays as the developer left it through the pulses.
    const triesCount = mk("span", { class: "tv-h-fig" });
    const triesList = mk("div", { class: "ag-tries-list" });
    const open = mk("button", { class: "inst-link", type: "button", onclick: () => io.open(id) });
    const stop = mk("button", { class: "ag-stop", type: "button", title: "Stop it now; what it finished is kept as its report", onclick: () => io.stop(id) }, glyph("square", "ag-stop-ic"), "Stop");
    // Your words to it now, past its lead (HarnessV4_Tasks decision 10): Send hands them to it at its next step, and its
    // lead is told. A send the host refuses keeps them in the box; the host says why.
    const tellIn = mk("textarea", { class: "ag-tell-in", rows: "2", "aria-label": `Your words for ${who.word} ${id}`, placeholder: `What ${who.word} should hear now. It reads this at its next step, and its lead is told` });
    const tellSend = mk("button", { class: "tg-act is-primary", type: "button" }, "Send");
    const tellCancel = mk("button", { class: "tg-act", type: "button" }, "Cancel");
    /** @type {Card} */
    const card = {
      id,
      el: mk("section", { class: `ag-card${who.worker ? " is-worker" : ""}`, "data-id": id }),
      word,
      tryN,
      task,
      badge,
      top,
      live: mk("div", { class: "ag-live" }),
      report: mk("p", { class: "ag-report" }),
      fail: null,
      failKey: "",
      figs: mk("div", { class: "ag-figs" }),
      folds: mk("div", { class: "ag-compact" }),
      tries: mk("details", { class: "ag-tries" }, mk("summary", {}, glyph("chevronRight", "ag-tries-chev"), "Earlier tries", triesCount), triesList),
      triesCount,
      triesList,
      triesKey: "",
      open,
      stop,
      acts: mk("div", { class: "tg-acts" }),
      actsKey: "",
      foot: mk("div", { class: "ag-foot" }),
      bar: mk("span", { class: "tg-node-bar ag-bar", "aria-hidden": "true" }, mk("span", { class: "tg-node-bar-fill" })),
      ask: null,
      askKey: "",
      tell: mk("button", { class: "ag-msg", type: "button", "aria-expanded": "false", title: `Tell ${who.word} ${id} something now, past its lead: it reads it at its next step, and its lead is told what you said` }, glyph("messageSquare", "ag-msg-ic"), "Message"),
      tellBox: mk("div", { class: "ag-tell", role: "group", "aria-label": `Tell ${who.word} ${id}` }, tellIn, mk("div", { class: "ag-tell-acts" }, tellCancel, tellSend)),
      tellIn,
      telling: false,
      again: () => {},
    };
    const shut = () => {
      card.telling = false;
      card.again();
    };
    let sending = false;
    const send = async () => {
      const text = String(tellIn.value || "").trim();
      if (!text || sending || !io.message) return;
      sending = true;
      tellSend.toggleAttribute("disabled", true);
      const ok = await io.message(id, text).catch(() => false);
      sending = false;
      tellSend.toggleAttribute("disabled", false);
      if (!ok) return;
      tellIn.value = "";
      shut();
    };
    card.tell.addEventListener("click", () => {
      card.telling = !card.telling;
      card.again();
      if (card.telling) tellIn.focus();
    });
    tellCancel.addEventListener("click", shut);
    tellSend.addEventListener("click", () => void send());
    tellIn.addEventListener("keydown", (/** @type {any} */ e) => {
      // An input method's Enter ends its word (Chinese, Japanese): it never sends (HC-117).
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        void send();
      } else if (e.key === "Escape") {
        e.preventDefault();
        shut();
      }
    });
    return card;
  };

  /**
   * Its question, kept while the same call waits: the answers' state and a half-typed why survive the pulses. A command
   * shows whole, wrapped, then why it asks (HarnessV3-Views V6-9); another call, on the head's line, then the question.
   * @param {Card} card @param {any} row
   */
  const askBlock = (card, row) => {
    const a = row.progress.asking;
    const key = answersKey(a);
    if (card.ask && card.askKey === key) return card.ask;
    const who = whoOf(row);
    const w = askWords(a);
    // A question another machine's chat asks is its own words, said once (the review of the s-asks hunt's fix).
    const question = questionChoices(a) != null;
    const words = a.command ? a.reason : question ? "" : a.question;
    card.askKey = key;
    card.ask = mk("div", { class: "ag-ask", role: "group", "aria-label": `${who.word} ${row.id} asks you` },
      mk("div", { class: "ag-ask-q" }, glyph(question ? "circleHelp" : "shieldAlert", "ag-ask-ic"), mk("span", question ? { class: "is-question" } : {}, cap(w.verb)), !a.command && w.what ? mk("code", { title: w.whole }, w.what) : null),
      a.command ? mk("pre", { class: "ag-ask-cmd" }, a.command) : null,
      words ? mk("div", { class: "ag-ask-sub" }, ...inlineMarks(mk, words)) : null,
      answerControls(mk, { id: card.id, who: `the ${who.word.toLowerCase()}`, n: a.n, offer: a.offer || null, answer: io.answer, always: io.always, place, ...questionOf(a) }).el);
    return card.ask;
  };

  /**
   * @param {Card} card @param {any} row @param {number} t @param {any} task  the graph task it works, or null
   * @param {import("../lib/team.js").Try[]} tries  the times its task was worked before the try it shows
   * @param {"agent" | "team"} crew  who plans the graph
   */
  const paintCard = (card, row, t, task, tries, crew) => {
    const st = cardState(row, task);
    const name = rowWords(row).name;
    stateClass(card.el, CARD_STATES, st);
    // Its task's try, as the graph counts them: a worker that took it or went on with it.
    // Or the attempt at its brief it is, of the ones its lead launched at once (TG2-D53).
    const attempt = attemptBadge(row);
    card.tryN.replaceChildren(...(task?.agent === row.id && Number(task.tries) > 1 ? [`try ${task.tries}`] : attempt ? [attempt] : []));
    card.task.replaceChildren(name);
    card.task.setAttribute("title", name);
    card.badge.replaceChildren(STATE_WORDS[st]);
    stateClass(card.badge, CARD_STATES, st);
    card.el.setAttribute("aria-label", `${whoOf(row).word} ${card.id}: ${name}, ${STATE_WORDS[st]}`);
    if (st !== "asking") { card.ask = null; card.askKey = ""; }
    /** @type {any} */
    let body = null;
    if (st === "asking") body = askBlock(card, row);
    else if (st === "running" && row.waiting) {
      // Launched with no room (team_v2_plan §5.7): it starts by itself once there is.
      drawIn(card.live, [mk("p", { class: "ag-call is-wait", title: "It starts by itself once a slot frees" }, `Waiting for a slot: ${row.waiting.words}`)]);
      body = card.live;
    } else if (st === "running") {
      const p = row.progress || {};
      // Its running model call, or the wait the call is in: a long quiet call reads as work, a stuck one as stuck.
      const call = callLine(p, t);
      // Where its lead reads along (TG2-D22): its signs since the lead's last look, and the lead's messages it read.
      const along = readAlongLine(p);
      // Filament's check of its report while it runs, or that it went back to work, its check failed (TG2-D45).
      const check = checkLine(p, t);
      // Its question to its lead (TG2-D49): the lead's to answer, so no Allow or Deny. So is its plan (TG2-D50). A
      // question waits for its answer (TG2-D58).
      const leadAsk = leadAskLine(p);
      const leadAskTitle = p.asking?.plan
        ? "Its lead answers go, or its corrections; with no answer in 3 minutes it goes on with its plan"
        : p.held && !p.asking
          ? "Its lead reviews its plan: it reads and plans first, and its changes and commands wait for its lead's go"
          : "Its lead answers it, and it waits for that answer; if its lead's turn ends first, it goes on with its pick";
      drawIn(card.live, kids([
        check ? mk("p", { class: "ag-call" }, ...inlineMarks(mk, check)) : null,
        leadAsk ? mk("p", { class: "ag-lead-ask", title: leadAskTitle }, ...inlineMarks(mk, leadAsk)) : null,
        p.tool ? mk("span", { class: "ag-tool", title: `${p.tool.name} ${p.tool.args || ""}` }, mk("b", {}, p.tool.name), p.tool.args ? ` ${p.tool.args}` : "") : null,
        p.words ? mk("p", { class: "ag-words" }, ...inlineMarks(mk, p.words)) : null,
        call ? mk("p", { class: `ag-call${p.wait ? " is-wait" : ""}` }, call) : null,
        along ? mk("p", { class: "ag-along", title: "What its lead sees next, and how many of its lead's messages it has read" }, along) : null,
      ]));
      body = check || leadAsk || p.tool || p.words || call || along ? card.live : null;
    } else {
      const last = row.exchanges?.at(-1) || null;
      // Its task failed: why, in the task's words.
      const why = st === "failed" && task?.agent === row.id ? String(task.why || "") : "";
      if (why || (!last?.report && last?.error)) {
        // The one failure card (lib/failure.js): the cause, what it had done and what is kept — its own failure's two
        // parts where the task failed in its words — and a failure that repeats, called out.
        const own = last?.failure && (!why || why === last.error) ? last.failure : null;
        const words = failureWords({ error: why || last?.error, failure: own, repeat: task?.agent === row.id ? repeatWords(task) : "" });
        const key = JSON.stringify(words);
        if (key !== card.failKey) {
          card.failKey = key;
          card.fail = failureCard(mk, words, { inset: true });
        }
        body = card.fail;
      } else {
        const said = String(last?.report || "").replace(/\s+/g, " ").trim();
        drawIn(card.report, inlineMarks(mk, said));
        body = said ? card.report : null;
      }
    }
    // Its task failed, and it is the developer's to send back themselves: to this worker, or fresh to a new one.
    const failedTask = st === "failed" && task?.state === "failed" && task.agent === row.id ? String(task.id) : "";
    const actsKey = failedTask ? `${failedTask}:${crew}` : "";
    if (actsKey !== card.actsKey) {
      card.actsKey = actsKey;
      const titles = sendBackTitles(failedTask, crew);
      card.acts.replaceChildren(...(failedTask ? [
        mk("button", { class: "tg-act", type: "button", title: titles.fresh, onclick: () => io.sendBack(failedTask, true) }, "Start fresh"),
        mk("button", { class: "tg-act is-primary", type: "button", title: titles.back, onclick: () => io.sendBack(failedTask, false) }, "Send back"),
      ] : []));
    }
    // The times its task was worked before: a line each, with how it ended and why, and its conversation.
    const triesKey = JSON.stringify(tries);
    if (triesKey !== card.triesKey) {
      card.triesKey = triesKey;
      card.triesCount.replaceChildren(String(tries.length));
      card.triesList.replaceChildren(...tries.map((x) => mk("div", { class: "ag-try-row", title: `Worked by ${x.agent}` },
        mk("i", { class: `tg-dot is-${x.state}` }),
        mk("span", { class: "ag-try-how" }, x.ms != null ? `${x.how} after ${formatWorkedFor(x.ms)}` : x.how),
        x.cause ? mk("span", { class: "ag-try-why", title: x.cause }, x.cause) : null,
        mk("button", { class: "inst-link", type: "button", title: `Open ${x.agent}'s conversation`, onclick: () => io.open(x.agent) }, "Open"))));
    }
    const f = cardFigures(row, t);
    const live = st === "running" || st === "asking";
    // Its window's ring says on hover what its context holds and where it compacts, and turns as its thread's gauge
    // does nearing that line and past it (lib/subagents.js `contextGauge`); with no line known, orange near the top.
    const held = live ? contextGauge(row.progress) : null;
    const heldColor = held?.line ? (held.tone === "error" ? "var(--color-sys-red)" : held.tone === "warn" ? "var(--color-sys-orange)" : "var(--color-sys-blue)") : undefined;
    drawIn(card.figs, kids([
      f.fill != null ? fig(ring(f.fill, 18, 3, heldColor), `${Math.round(f.fill * 100)}%`, held?.title || `Its window: ${Math.round(f.fill * 100)}% full`) : null,
      f.rounds != null ? fig(glyph("repeat", "ag-fig-ic"), String(f.rounds), `${f.rounds} ${f.rounds === 1 ? "round" : "rounds"}`) : null,
      f.spent != null ? fig(null, usd(f.spent), live ? "Spent so far" : "Spent") : null,
      f.ms != null ? fig(glyph("timer", "ag-fig-ic"), formatWorkedFor(f.ms), live ? "Running for" : "Took") : null,
      row.model ? modelTag(String(row.model)) : null,
    ]));
    // Its running exchange's compactions: how often, the newest's when and how.
    const folds = live ? row.progress?.compactions || [] : [];
    const newestFold = folds.at(-1);
    drawIn(card.folds, newestFold ? [glyph("foldVertical", "ag-compact-ic"), `Compacted ${timesWords(folds.length)} · ${ago(newestFold.at, t)}${newestFold.how ? ` · ${cap(String(newestFold.how))}` : ""}`] : []);
    drawIn(card.open, [live ? "Open" : "Open conversation", glyph("chevronRight", "inst-link-chev")]);
    // Message, while a worker works (decision 10); its box, while open, under what it does now.
    const tells = row.status === "running" && whoOf(row).worker && !!io.message;
    if (!tells) card.telling = false;
    card.tell.setAttribute("aria-expanded", card.telling ? "true" : "false");
    place(card.foot, kids([card.open, tells ? card.tell : null, row.status === "running" ? card.stop : null, failedTask ? card.acts : null]));
    place(card.el, kids([card.top, body, card.telling ? card.tellBox : null, card.figs, newestFold ? card.folds : null, tries.length ? card.tries : null, card.foot, st === "running" ? card.bar : null]));
    card.again = () => paintCard(card, row, t, task, tries, crew);
  };

  /** @type {Map<string, { el: any, key: string }>} the graph's tasks still to come, by id */
  const taskCards = new Map();
  /**
   * A task of the graph not started yet, as a card (HarnessV3-TaskGraph G3-7): who is to do it, its id and name, its
   * state and what it waits on; a click shows it on the Plan view's graph.
   * @param {import("../lib/team.js").WaitingTask} w
   * @param {readonly import("../lib/team.js").TeamMember[] | null} members  the members of the team that leads
   * @param {readonly import("../lib/team.js").CrewSeat[] | null} shippedCrew  who a seat of the shipped teams' crew is
   *   where no member names it
   */
  const taskCard = (w, members, shippedCrew) => {
    const who = whoOfTask(w.by, members, shippedCrew);
    const key = JSON.stringify([w.by, who.word, who.icon, w.name, w.state, w.line]);
    const had = taskCards.get(w.id);
    if (had?.key === key) return had.el;
    const el = mk("button", {
      class: `ag-card is-task is-${w.state}`,
      type: "button",
      "data-task": w.id,
      title: "Show it on the task graph",
      "aria-label": `${who.word}'s task ${w.id}: ${w.name}, ${TASK_WORDS[w.state]} — ${w.line}`,
      onclick: () => io.openTask(w.id),
    },
      mk("span", { class: "ag-top" },
        glyph(who.icon, `role-tile${who.worker ? "" : " is-sub"}`),
        mk("span", { class: "ag-who" },
          mk("span", { class: "ag-role" }, mk("span", { class: "ag-role-word" }, who.word), mk("span", { class: "ag-id" }, w.id)),
          mk("span", { class: "ag-task", title: w.name }, w.name)),
        mk("span", { class: `tg-badge is-${w.state}` }, TASK_WORDS[w.state])),
      mk("span", { class: "ag-wait" }, w.line));
    taskCards.set(w.id, { el, key });
    return el;
  };

  const workersH = mk("h3", { class: "tv-h" });
  const grid = mk("div", { class: "tv-grid" });
  const emptyNote = mk("p", { class: "tv-empty" });
  const workersEl = mk("section", { class: "tv-section" }, workersH, grid);
  /** The cards folded under Earlier now, by id. @type {Set<string>} */
  const folded = new Set();
  const earlierCount = mk("span", { class: "tv-h-fig" });
  const earlierGrid = mk("div", { class: "tv-grid is-done" });
  const earlierEl = mk("details", { class: "tv-earlier" },
    mk("summary", {}, glyph("chevronRight", "tv-earlier-chev"), "Earlier", earlierCount),
    earlierGrid);

  /**
   * @param {any[]} rows @param {any} graph  the session's task graph, or null
   * @param {import("../lib/team.js").WaitingTask[]} tasks  its tasks still to come @param {number} t @param {boolean} team
   * @param {"agent" | "team"} crew  who plans the graph
   * @param {readonly import("../lib/team.js").TeamMember[] | null} members  the members of the team that leads
   * @param {readonly import("../lib/team.js").CrewSeat[] | null} shippedCrew  the settings answer's
   * @returns {{ workers: boolean, earlier: boolean }}
   */
  const paintCards = (rows, graph, tasks, t, team, crew, members, shippedCrew) => {
    // A task's workers are one card, its newest's: the ones before it are its tries, listed under it. So are the attempts
    // at a brief once one won, under the winner's (TG2-D53).
    const byTask = taskTries(rows, graph);
    const byAttempt = attemptTries(byTask.rows);
    const shown = byAttempt.rows;
    const tries = new Map([...byTask.tries, ...byAttempt.tries]);
    const { live, done, earlier } = cardOrder(shown);
    for (const id of [...cards.keys()]) if (!shown.some((r) => String(r.id) === id)) cards.delete(id);
    for (const id of [...taskCards.keys()]) if (!tasks.some((w) => w.id === id)) taskCards.delete(id);
    /** The graph's tasks by id: a worker's card wears its task's review or failure. @type {Map<string, any>} */
    const byId = new Map((graph?.tasks || []).map((/** @type {any} */ x) => [String(x.id), x]));
    /** @param {any} r */
    const cardFor = (r) => {
      let c = cards.get(String(r.id));
      if (!c) { c = makeCard(r); cards.set(c.id, c); }
      paintCard(c, r, t, r.task ? byId.get(String(r.task)) || null : null, tries.get(String(r.id)) || [], crew);
      return c.el;
    };
    place(grid, [...live.map(cardFor), ...tasks.map((w) => taskCard(w, members, shippedCrew)), ...done.map(cardFor)]);
    place(earlierGrid, earlier.map(cardFor));
    folded.clear();
    for (const r of earlier) folded.add(String(r.id));
    earlierCount.replaceChildren(String(earlier.length));
    const asks = live.filter((r) => cardState(r) === "asking").length;
    const waiting = tasks.length;
    const atWork = live.length;
    const now = [
      atWork ? `${atWork} at work` : "",
      asks ? `${asks} ${asks === 1 ? "asks" : "ask"} you` : "",
      waiting ? `${waiting} waiting` : "",
    ].filter(Boolean).join(" · ");
    workersH.replaceChildren(team ? "Its workers" : "The graph's tasks", mk("span", { class: "tv-h-fig" }, now || (shown.length ? String(shown.length) : "")));
    // A team that has given out no work yet says so; your agent alone shows no empty section.
    emptyNote.replaceChildren("The lead has given out no work yet: its workers show here as it does.");
    const any = rows.length > 0 || tasks.length > 0;
    place(workersEl, kids([workersH, any ? grid : team ? emptyNote : null]));
    return { workers: any || team, earlier: !!earlier.length };
  };

  const el = mk("div", { class: "tv" });
  /** The teams beside this chat (views/beside.js), where the host offers them. */
  const beside = io.beside ? createBesideView(io.beside, { h: mk, place, drawIn }) : null;

  /** A card brought into sight, and marked a moment. @param {string} id */
  function reveal(id) {
    const c = cards.get(String(id));
    if (!c) return;
    if (folded.has(c.id)) earlierEl.setAttribute("open", "");
    c.el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    c.el.classList.add("is-flash");
    later(() => c.el.classList.remove("is-flash"), 1200);
  }

  return {
    el,
    /**
     * @param {any} c
     * @param {string} [focus]  what the Agents tab's row asks: "charge" the team in charge of the chat, "side:<id>" one
     *   team on its side, "home" what a team is and every team, "flow:<row>" a flow's row or the Flows row, "work" your
     *   agent's own work as a flow; "" everything,
     *   as the tab once was
     */
    paint(c, focus = "") {
      chat = c;
      if (!chat?.chainId) { place(el, []); return; }
      // A flow's row, or the Flows row: the flow's pane alone (HarnessV4_Flow_Plan F5).
      if (io.flow && focus.startsWith("flow:")) {
        io.flow.paint(chat, focus.slice(5));
        place(el, [io.flow.el]);
        return;
      }
      // Your agent's own work, drawn as a flow (HarnessV4_OneAgent_Plan L47): its picture alone.
      if (io.work && focus === "work") {
        io.work.paint(chat);
        place(el, [io.work.el]);
        return;
      }
      const t = now();
      const settings = settingsOf();
      const team = leadingTeam(settings.engine);
      const rows = io.rows();
      wait = switchWait(chat, rows);
      paintHead(team);
      if (team) paintLeader(team, rows, t);
      const graph = io.graph();
      const crew = crewOf(settings.engine);
      const shown = paintCards(teamWork(rows), graph, waitingTasks(graph, crew), t, !!team, crew, team?.members || null, settings.engine?.shippedCrew || null);
      const one = focus.startsWith("side:") ? focus.slice(5) : null;
      beside?.paint(chat, one);
      // A team's own chat: its board or its card, as its main chat's Agents tab shows them — never a second picture of
      // its workers (the owner's words of 10-19: "if i went on the left side bar and clicked the running hunter and
      // then went into team page then i would see different activity"). One team on the side: that team alone.
      if (beside?.isTeamChat() || (one && beside)) {
        place(el, [beside.el]);
        return;
      }
      // With no team leading, the home: what a team is and the two ways, the teams on the side, the squads. Asked for
      // by a row of the Agents tab, the teams on the side are their own rows there.
      if (!team && home) {
        home.paint(chat);
        place(el, kids([home.top, !focus && beside?.has() ? beside.el : null, shown.workers ? workersEl : null, shown.earlier ? earlierEl : null, home.roster]));
        return;
      }
      if (team) place(chargeEl, [headEl, leaderEl, followEl, backRow]);
      place(el, kids([team ? chargeEl : headEl, shown.workers ? workersEl : null, shown.earlier ? earlierEl : null, focus ? null : beside?.el ?? null]));
    },
    reveal,
  };
}
