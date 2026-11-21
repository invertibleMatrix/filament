// @ts-check
// The session's views (HarnessV3-Views VW-D1): the tabs in the conversation's header and the views they bring — Chat,
// the transcript itself; Overview (overview.js, proposal_ux §4.6), everything about the chat as widgets, with no dock
// (it has no box: a widget's back changes what it owns), its tab shown only while it is on screen and half a minute
// after — the dashboard button under the box brings it (`overviewShown`, the owner's of 10-30); Plan (plan.js); and Team (team.js), who works on the session — each a view of its own in the
// conversation's frame with the dock under it, so the developer talks to the agent from any; and Sub Agents (side.js,
// HarnessV4_Tasks E15 step 5, U12), every agent that works for the session, which has a box of its own and no dock
// (AG-100). Each chat keeps the view it shows (`chat.viewTab`), and its address carries it (router.js); a chat with no
// session yet is the conversation alone. The Plan tab shows while the session has a task graph with tasks in it, and
// while its view is on screen, never taken from under you (`planShown`; the owner's words of
// 10-18: "it should not be visible unless there is a task with task graph running"). The Team tab was in every chat with
// a session (team_v2_plan TV2-D1); since
// HarnessV4_Tasks U13-D5 (10-20) it is the Agents tab's: a team is a row there with its crew under it, its pane the Team
// view (`paint(chat, focus)`), and the Teams row at the list's foot is where the chat is handed to one. The `team`
// address and every way in that named it — the band's "its workers are on the Agents tab", a worker's card, Show Team — open
// the Agents tab on the team's row; the dock shows under the team in charge, as it did under its tab. The tabs say what
// changes out of sight: the Plan tab counts what is open, the Agents tab what works for the chat or needs you — your
// agents, a team's crew, the lead in charge, the teams on the side (`agentsBadge`) — else the answers you have not
// opened (AG-107), and the Chat tab, while another view shows, wears a dot when the agent waits for an answer (orange) or works (blue). The
// Team view's tasks still to come are the Plan view's graph's, and each opens there. A pane popped out of the right bar
// (HarnessV4_DesignPass_Plan UX10) is a view too, `pane:<its tab>`, its tab after Plan, in any chat — a session or not;
// the pane host draws it (`top`), full size, and its tab's × puts it back. The Plan goes the other way too (E41 P4,
// D12): Beside the chat puts its page in the right bar as a pane (`planPane`), and the Plan tab, or that pane's own
// button, takes it back — one place at a time. The message box is not under it (the owner's
// word of 10-24): what waits for you is, and words going to the box bring Chat (views.css; app.js `toBox`). Its address is the
// chat's, and a reload opens the chat on Chat with the panes still on top. The run's events come dozens a second: a
// pulse gathers them into one repaint of the tabs and the view on screen, and while the Team view or the Sub Agents
// view shows work running, the pulses go on, so its clocks move.
import { h } from "../../lib/dom.js";
import { VIEWS } from "../lib/router.js";
import { asksYou, leadingTeam, ownLast, teamBadge } from "../lib/team.js";
import { TEAM_CHARGE, TEAM_HOME, agentsBadge, isTeamItem, mineAtWork, selfTeamItem, teamItems } from "../lib/side.js";
import { FLOW_HOME, flowOfItem, flowRow, isFlowTeam, needsYou } from "../lib/flow.js";
import { WORK_ITEM } from "../lib/agent-work.js";
import { comboOf } from "../shortcuts.js";
import { viewTabs } from "./tabs.js";
import { chooseTask, graphOf, planAtWork, planBadge, planNow, renderPlan } from "./plan.js";
import { createPlanPeek } from "./plan-peek.js";
import { keepingFocus } from "../lib/keep-focus.js";
import { createTeamView } from "./team.js";
import { createSideView } from "./side.js";
import { newestOnRecord } from "../conversation/history.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";

/** Each view's tab: its word, glyph and line, and the shortcut that brings it. @type {Record<string, { label: string, icon: string, tip: string, shortcut: string }>} */
const TABS = {
  chat: { label: "Chat", icon: "messageSquare", tip: "The conversation", shortcut: "view-chat" },
  overview: { label: "Overview", icon: "layoutDashboard", tip: "Everything about this chat: what it is doing, what it has used, and how it is set up", shortcut: "view-overview" },
  plan: { label: "Plan", icon: "listTodo", tip: "The plan: the task graph and the checklist", shortcut: "view-plan" },
  // Its tab is the Agents tab's since U13-D5: never shown, its address kept.
  team: { label: "Teams", icon: "users", tip: "Teams: a lead and its workers, on the side of this chat or in charge of it", shortcut: "view-team" },
  // Sub Agents, the owner's name of 10-18 (HarnessV4_Tasks U12-D1), and the Teams tab, made one (U13-D5); its id and address stay `side`.
  side: { label: "Agents", icon: "users", tip: "Everyone working for this chat: whom you asked, the jobs given, the teams in charge or on the side, those on their own", shortcut: "view-side" },
};
/** The Agents tab's words while Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js). */
const SIDE_TIP_ALONE = "Everyone working for this chat: whom you asked, the jobs given, those on their own";

/** How long a pulse gathers the run's events before the views repaint, ms. */
const PULSE_MS = 1200;
/** How long the Overview tab stays once its view is left, for Chat or any other (the owner's of 10-30), ms. */
export const OVERVIEW_STAYS_MS = 30_000;

/**
 * @typedef {{ el: any, list: () => { id: string, label: string, icon: string, title: string }[], show: (id: string) => void,
 *   back: (id: string) => void }} TopIO  the panes on top (UX10), the pane host's: where their panes show, those on top
 *   in the chat shown, the one on screen ("" for none), and one put back beside the chat — each by its tab's id
 */

/** A pane on top's view (UX10): this, then its tab's id. */
export const TOP_VIEW = "pane:";
/** A pane on top's tab, from its view; "" for any other view. @param {any} id */
export const topOf = (id) => (typeof id === "string" && id.startsWith(TOP_VIEW) ? id.slice(TOP_VIEW.length) : "");

/**
 * The view a chat shows: a pane on top while it shows one (in any chat; the host keeps it to the panes on top), its own
 * while it has a session, else the conversation; the Teams view's is the Agents tab's. @param {any} chat
 */
export const viewOf = (chat) => (topOf(chat?.viewTab) ? chat.viewTab : chat?.chainId && VIEWS.includes(chat.viewTab) ? (chat.viewTab === "team" ? "side" : chat.viewTab) : "chat");

/**
 * Whether the Plan tab shows: while the Plan view is on screen, and while the session has a task graph with tasks in it
 * (`graphOf`). A checklist alone has its card in the conversation and
 * the status capsule, which opens the view all the same.
 * @param {any} chat @param {any} graph  the graph as the Plan view draws it, or null
 */
export const planShown = (chat, graph) => viewOf(chat) === "plan" || (Array.isArray(graph?.tasks) && graph.tasks.length > 0);

/**
 * Whether the Team tab shows: never since U13-D5 — a team is the Agents tab's row, and its Teams row is where the chat is
 * handed to one, in every chat with a session (team_v2_plan TV2-D1, the owner's words of 10-19: "bring the team tab back
 * so that session can be handed off right from that tab").
 * @param {any} _chat
 */
export const teamShown = (_chat) => false;

/**
 * What a team's row asks of the Team view, by its id: a flow's row and the Flows row are the flow pane's; your agent's
 * own work, its picture's (HarnessV4_OneAgent_Plan L47). @param {string} id
 */
const focusOf = (id) => (id === WORK_ITEM ? "work" : id === FLOW_HOME || flowOfItem(id) ? `flow:${id}` : id === TEAM_CHARGE ? "charge" : id === TEAM_HOME ? "home" : id.startsWith("team:side:") ? `side:${id.slice(10)}` : "");

/**
 * What the Chat tab says while another view shows: the newest turn waits for the developer's answer, or the agent
 * works; else nothing.
 * @param {any} chat @returns {import("./tabs.js").Badge | null}
 */
export function chatBadge(chat) {
  const newest = newestOnRecord(chat?.turns);
  return newest?.paused ? { dot: "asks", words: "waiting for your answer" } : chat?.live ? { dot: "works", words: "working" } : null;
}

/**
 * @param {{ frame: any, slot: any, overview: { el: any, setShown: (on: boolean) => void, paint: () => void }, openAgent: (id: string) => void,
 *   reviewAgent?: ((id: string) => void) | null, opening?: ((chat: any) => boolean) | null,
 *   openRunLog: () => void, onShow: (chat: any) => void, loadRun: (turn: any) => Promise<void>,
 *   team: Omit<import("./team.js").TeamIO, "graph" | "openTask">, side: import("./side.js").SideIO, mk?: typeof h,
 *   place?: (parent: any, wanted: any[]) => void, drawIn?: (parent: any, nodes: any[]) => void, modelSelect?: any,
 *   api?: (path: string) => Promise<any>,
 *   later?: (fn: () => void, ms: number) => void, onPainted?: (chat: any) => void,
 *   sideSeams?: Parameters<typeof createSideView>[1], hunt?: import("./plan.js").PlanHunt | null,
 *   sideRun?: { model: () => string, models: () => any[], families?: () => any[], accounts?: () => any[] } | null,
 *   top?: TopIO | null, send?: ((text: string) => void) | null,
 *   besidePlan?: { open: (o?: { asked?: boolean }) => void, close: () => void, shown: () => boolean, inSight?: () => boolean, refresh?: () => void } | null,
 *   planWatch?: ReturnType<typeof import("../lib/plan-watch.js").createPlanWatch> | null,
 *   planWork?: ((words: string | null) => void) | null,
 *   carryPlan?: ((chat: any, tasks: number) => void) | null, openChain?: ((chainId: string) => void) | null }} o
 *   `carryPlan`: the Plan's Continue in a new chat (piece E), `openChain` the chat a carried plan went on in. `send`: the person's words to the chat — a steer while a turn runs — the Plan page's Run them in parallel;
 *   `besidePlan`: the Plan as a pane beside the chat (HarnessV4_TaskGraphPlus_Design D12) — put there (`asked: false`:
 *   only where the window has room for it), taken back, whether it is there (a page shows in one place at a time, so the
 *   Plan tab takes it back first), whether it is in sight — on screen, in front in its tile or shown on top — and drawn
 *   again once the run its plan is read from lands; `planWatch`: what the chat's task graph did since the last pulse
 *   (lib/plan-watch.js, `watchPlan`); `planWork`: the work under way on the chat's plan, in words (plan.js
 *   `planAtWork`), told at each paint of the badges — null while the Plan tab shows it, or the chat has no session —
 *   for the header's Plan button (the owner's of 11-10)
 *   `frame` the conversation's frame, `slot` the header's place for the tabs; `overview` the Overview page (overview.js),
 *   shown and painted while its tab is on; `onShow` hears a switch (the address
 *   follows it); `loadRun` reads an earlier turn's run onto it, resolving once it is read or failed (the transcript's
 *   own reader); `team` what the Team view reads and does, but for the graph's tasks, which are the host's; `side`
 *   what the Sub Agents view reads and does; `hunt` starts a Reviewer hunting a done task of the Plan view's graph
 *   (HarnessV4_DesignPass_Plan UX9); `top` the panes popped out on top (UX10), the pane host's; `onPainted` hears
 *   each paint of the tabs' badges, with its chat, so what shows the plan the Plan tab counts (the status capsule)
 *   paints with it; `opening` says a chat's transcript is on its way — the session's answer is asked for once it has
 *   landed, and the page draws the views again then; `mk`, `place`, `drawIn`, `modelSelect`, `api`, `later` and
 *   `sideSeams` are the tests' seams
 */
export function createViews(o) {
  const mk = o.mk || h;
  const later = o.later || ((fn, ms) => { setTimeout(fn, ms); });
  /** @type {any} the chat on screen */
  let chat = null;
  /** Whether the tabs are in the header: they are while the chat has a session, or a pane on top. */
  let mounted = false;
  /** The panes on top in the chat shown, as the pane host has them. */
  const tops = () => o.top?.list() || [];
  /** Whether a pane is on top in the chat shown. @param {string} id  its tab's */
  const isTop = (id) => !!id && tops().some((t) => t.id === id);
  let pulsing = false;
  /** The earlier turns whose run the views asked for — one ask each, whatever it answered — and whether it is on its
   *  way still. @type {WeakMap<any, boolean>} */
  const asked = new WeakMap();
  /** The Plan view on screen and the chat it was built for; null while the view is empty. @type {{ chat: any, paint: () => void, celebrate: (ids: string[]) => void } | null} */
  let planView = null;
  /** The newest Plan page drawn beside the chat, and the chat it follows. @type {{ chat: any, paint: () => void, celebrate: (ids: string[]) => void } | null} */
  let paneView = null;

  /** Whether a chat's transcript is on its way: the session's answer waits for it (plan.js `viewsAnswer`). @param {any} c */
  const held = (c) => !!o.opening?.(c);
  const planEl = mk("div", { class: "vw vw-plan", role: "tabpanel", "aria-label": "Plan" });
  const team = createTeamView({
    ...o.team,
    graph: () => graphOf(chat, { api: o.api, onLand: drawTeam, held: held(chat) }),
    openTask: (id) => {
      chooseTask(chat, id);
      show("plan");
    },
  }, { h: mk, ...(o.place ? { place: o.place } : {}), ...(o.drawIn ? { drawIn: o.drawIn } : {}), later });
  /**
   * The teams beside this chat, as the Team view reads them: a flow's team box is the flow's row's (HarnessV4_Flow_Plan
   * F5). While Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js) one shows while it works or asks,
   * and goes once it is done: its result card in the conversation still opens it.
   */
  const besides = () => (o.team.beside?.main?.() ? [] : (o.team.beside?.rows() || []).filter((r) => !isFlowTeam(r) && (teamsOn(state.config) || r.state === "working" || r.state === "asking")));
  /** The chat's flows: none in a team's own chat, which draws none. */
  const flows = () => (o.team.beside?.main?.() ? [] : o.team.flows?.() || []);
  /**
   * The row a way into the teams opens: in a team's own chat that team, else the team in charge, else the Teams row —
   * the new thread while Settings › Experimental's Teams switch is off.
   * @param {any} c
   */
  const aimOf = (c) => {
    const self = o.team.beside?.main?.() ? o.team.beside?.self?.() || null : null;
    return self ? selfTeamItem(self.id) : leadingTeam(c?.view?.settings?.engine) ? TEAM_CHARGE : teamsOn(state.config) ? TEAM_HOME : "";
  };
  /** The teams' part of the Agents tab (U13-D5): their rows, and the Team view as their pane. @type {import("./side.js").TeamsPart} */
  const teams = {
    el: team.el,
    items: () => [
      ...teamItems({
        leading: leadingTeam(chat?.view?.settings?.engine),
        live: !!chat?.live,
        paused: asksYou(ownLast(chat?.turns)),
        rows: o.team.rows(),
        beside: besides(),
        self: o.team.beside?.main?.() ? o.team.beside?.self?.() || null : null,
        boards: (tid) => o.team.beside?.board?.rows(tid) || [],
        now: Date.now(),
      }),
      // Each flow beside the chat: a row by what it needs of you, its boxes at work under it (HarnessV4_Flow_Plan F5).
      ...flows().map((f) => flowRow(f, Date.now())),
    ],
    // Its leader's orders and round are read from the newest turn's run: after a reload the view asks for it as the
    // Plan view does, and paints again once it lands — meanwhile it shows everything else.
    paint: (c, id) => {
      readNewest();
      team.paint(c, focusOf(id));
    },
    // The Teams row at the list's foot: none in a team's own chat, nor while teams are off.
    home: () => teamsOn(state.config) && !o.team.beside?.main?.(),
    flows: () => !!o.team.flow && !o.team.beside?.main?.(),
    // Your agent's own work as a flow (L47): its row's words while it sent any; none in a team's own chat, whose agents
    // are the team's (case 12).
    work: () => (o.team.work && !o.team.beside?.main?.() ? o.team.work.row() : null),
  };
  /**
   * Whether the Agents tab shows the team in charge: its row's pane, or the Teams row's while a team leads — which
   * shows the team in charge too (team.js).
   * @param {string} [pane]
   */
  const inCharge = (pane = side.pane(chat)) => viewOf(chat) === "side" && (pane === TEAM_CHARGE || pane === TEAM_HOME) && !!leadingTeam(chat?.view?.settings?.engine);
  /** The dock stands under the team in charge, as it did under the Teams tab: its lead is who you talk to. @param {string} id */
  const onPane = (id) => {
    const on = inCharge(id);
    if (on === o.frame.classList.contains("side-team")) return;
    o.frame.classList.toggle("side-team", on);
    if (mounted) o.onShow(chat);
  };
  const side = createSideView({ ...o.side, teams, onPane }, { h: mk, ...(o.place ? { place: o.place } : {}), ...(o.modelSelect ? { modelSelect: o.modelSelect } : {}), ...o.sideSeams });
  const sideEl = mk("div", { class: "vw vw-side", role: "tabpanel", "aria-label": "Agents" }, side.el);
  const overviewEl = mk("div", { class: "vw vw-overview", role: "tabpanel", "aria-label": "Overview" }, o.overview.el);
  /** Whether the Agents view follows a thread now: it lets go when another view shows. */
  let sideShown = false;
  o.frame.append(planEl, sideEl, overviewEl, ...(o.top ? [o.top.el] : []));

  /** Whether the Overview tab shows; whether its view did at the last draw; the hide on its way, by its number. */
  let overviewTab = false;
  let overviewOn = false;
  let overviewHide = 0;
  /**
   * The Overview tab (the owner's of 10-30): hidden, as the dashboard button under the box is the way in — and Alt+2. It
   * shows while its view is on screen and OVERVIEW_STAYS_MS after that view is left, for Chat or any other, then goes;
   * back on it meanwhile, it stays.
   */
  const overviewShown = () => {
    const on = !!chat?.chainId && viewOf(chat) === "overview";
    if (on !== overviewOn) {
      overviewOn = on;
      const mine = ++overviewHide;
      if (on) overviewTab = true;
      else later(() => {
        if (mine !== overviewHide) return;
        overviewTab = false;
        tabs.shown("overview", false);
      }, OVERVIEW_STAYS_MS);
    }
    return overviewTab;
  };

  /** @param {string} id  a view; `team` the Agents tab on the team's row; `pane:<tab>` a pane on top */
  const show = (id) => {
    // A pane on top shows in any chat, a session or not; so does Chat, coming back from one.
    if (!chat || (topOf(id) ? !isTop(topOf(id)) : !VIEWS.includes(id) || (!chat.chainId && id !== "chat"))) return;
    if (id === "team") {
      side.aim(chat, aimOf(chat));
      id = "side";
      if (viewOf(chat) === id) return draw();
    }
    // The Plan beside the chat comes back to its tab: one place at a time (D12, BS-D8). Its peek goes.
    if (id === "plan" && o.besidePlan?.shown()) o.besidePlan.close();
    if (id === "plan") peek?.close();
    if (viewOf(chat) === id) return;
    chat.viewTab = id;
    draw();
    o.onShow(chat);
  };

  const tabs = viewTabs({
    views: VIEWS.map((id) => {
      const t = TABS[id];
      return { id, label: t.label, icon: t.icon, tip: id === "side" ? () => (teamsOn(state.config) ? t.tip : SIDE_TIP_ALONE) : t.tip, kbd: () => comboOf(t.shortcut) };
    }),
    value: () => viewOf(chat),
    onChange: show,
    onBack: (id) => o.top?.back(topOf(id)),
  }, mk);

  const paintBadges = () => {
    if (!chat?.chainId) return void o.planWork?.(null);
    const n = planBadge(chat, { api: o.api, onLand: paintBadges, held: held(chat) });
    tabs.badge("plan", n ? { text: `${n.done}/${n.all}`, words: `${n.done} of ${n.all} done` } : null);
    tabs.shown("plan", planShown(chat, graphOf(chat, { api: o.api, onLand: paintBadges, held: held(chat) })));
    tabs.shown("team", teamShown(chat));
    const team_ = teamBadge({ live: !!chat.live, paused: asksYou(ownLast(chat.turns)), rows: o.team.rows(), leads: !!leadingTeam(chat.view?.settings?.engine) });
    const fl = flows();
    tabs.badge("side", agentsBadge(side.badge(chat), team_, besides(), mineAtWork(o.team.rows()), { works: fl.filter((f) => f.state === "running" && !needsYou(f)).length, asks: fl.filter((f) => f.state !== "draft" && needsYou(f)).length }));
    tabs.badge("chat", viewOf(chat) === "chat" ? null : chatBadge(chat));
    watchPlan();
    // The plan's work under way, for the header's Plan button where the Plan is out of sight (the owner's of 11-10): on
    // its tab it is in sight; beside the chat, the pane buttons see it in front themselves.
    o.planWork?.(viewOf(chat) === "plan" ? null : planAtWork(chat, { api: o.api, onLand: paintBadges, held: held(chat) }));
    o.onPainted?.(chat);
  };

  /**
   * The chat's task graph, live (the owner's of 11-04: "the goal is to give some live feedback about task completion"),
   * read once the page can say it — the session's answer and the run the plan is read from landed (lib/plan-watch.js);
   * the checklist's items show ticked in the conversation. Its first graph opens the Plan beside the chat, where the
   * window has room — and stays until the person closes it; with no room, the peek shows it. A task done is marked where
   * the Plan is in sight, on its tab or beside the chat, and brought into sight there; where it is in sight nowhere, the
   * peek shows it a moment (plan-peek.js).
   */
  const watchPlan = () => {
    const w = o.planWatch;
    if (!w || !chat?.chainId || unread(chat)) return;
    const facts = planNow(chat, { api: o.api, onLand: paintBadges, held: held(chat) });
    if (!facts) return;
    const told = w.see(chat.chainId, facts, { live: !!facts.fresh });
    const onTab = viewOf(chat) === "plan";
    const inSight = () => onTab || !!o.besidePlan?.inSight?.();
    if (inSight()) peek?.close();
    if (told.first && !inSight()) {
      o.besidePlan?.open({ asked: false });
      if (!inSight()) peek?.show(chat, [], facts);
    }
    if (!told.done.length) return;
    const view = onTab ? (planView?.chat === chat ? planView : null) : inSight() && paneView?.chat === chat ? paneView : null;
    if (view) view.celebrate(told.done);
    else if (!inSight()) peek?.show(chat, told.done, facts);
  };

  /**
   * The turn whose run the plan is read from, while the page has not read it: the newest turn's that ran, unless what it
   * says is there already or comes with the live stream; else null. @param {any} c
   */
  const unread = (c) => {
    for (const t of [...(c?.turns || [])].reverse()) {
      if (t.rewound) continue;
      if (t.aligned || t === c.live?.turn) return null;
      if (!t.runId) continue; // nothing to read: Filament's own answer, an outside client's turn
      return t;
    }
    return null;
  };

  /**
   * After a reload a session's turns are its history, and an earlier turn's run is read as the transcript draws its row
   * near the screen — under the Plan view the transcript is hidden. The views ask, once, for the run the plan is read
   * from (`unread`); they paint again once it lands. Says whether it is on its way. The Plan beside the chat asks for the
   * chat it follows: the right bar takes a new chat before the views do.
   * @param {any} [c]
   */
  const readNewest = (c = chat) => {
    const t = unread(c);
    if (t) {
      if (!asked.has(t)) {
        asked.set(t, true);
        o.loadRun(t).then(() => {
          asked.set(t, false);
          // The Plan beside the chat, which follows the right bar's chat (refreshed only where it shows that one).
          o.besidePlan?.refresh?.();
          if (chat !== c) return;
          paintBadges();
          drawPlan();
          drawTeam();
        });
      }
      return /** @type {boolean} */ (asked.get(t));
    }
    return false;
  };

  /**
   * The Plan view, drawn while it shows and once the run its plan is read from has landed: until then it is blank, as
   * it is until the session's answer lands, never "No plan yet" or a tab the landing flips. It is built once per chat
   * and painted in place after — a pulse that changes nothing it shows leaves it as it is (plan.js) — and the control
   * that had the focus keeps it (lib/keep-focus.js; HarnessV4_Tasks U4).
   *
   * A turn that ended is read the same way, and a view already drawn for this chat stands as it is until that read
   * lands: emptied meanwhile, the whole view went and came back each turn — its goal with it — and took the
   * keyboard's place with it (HarnessV4_Tasks U4).
   */
  const drawPlan = () => keepingFocus(planEl, drawPlanNow);
  const drawPlanNow = () => {
    const reading = readNewest();
    const shows = viewOf(chat) === "plan";
    if (shows && reading && planView?.chat === chat) return;
    if (!shows || reading) {
      planEl.replaceChildren();
      planView = null;
      return;
    }
    if (planView && planView.chat === chat) return planView.paint();
    planEl.replaceChildren();
    planView = { chat, ...renderPlan(planEl, planCtx(chat, false), { h: mk, api: o.api, later, ...(o.modelSelect ? { modelSelect: o.modelSelect } : {}) }) };
  };
  /**
   * What the Plan page is handed, on its tab or beside the chat (`pane`): Beside the chat puts it in the right bar and
   * shows the conversation; Run them in parallel sends the person's sentence.
   * @param {any} c @param {boolean} pane
   */
  const planCtx = (c, pane) => ({
    chat: c,
    openAgent: o.openAgent,
    reviewAgent: o.reviewAgent || null,
    openRunLog: o.openRunLog,
    sendBack: o.team.sendBack,
    hunt: o.hunt || null,
    send: o.send || null,
    sideRun: o.sideRun || null,
    // Continue in a new chat (piece E), from the tab: the fork's dialog with the plan carried; a closed plan's new chat.
    carry: o.carryPlan && !pane ? (/** @type {number} */ tasks) => o.carryPlan?.(c, tasks) : null,
    openChain: o.openChain || null,
    toSide: o.besidePlan
      ? () => {
          o.besidePlan?.open();
          show("chat");
        }
      : null,
    pane,
    // Beside the chat the page waits for the run its plan is read from as the tab does (`drawPlanNow`).
    reading: pane ? () => readNewest(c) : null,
    held: () => held(c),
  });
  /** The plan's peek, where the Plan is in sight nowhere (`watchPlan`): its page as beside the chat, Keep open putting it there. */
  const peek = o.besidePlan
    ? createPlanPeek({
        frame: o.frame,
        mk,
        later,
        draw: (body, c) => renderPlan(body, { ...planCtx(c, true), toSide: null, stay: true }, { h: mk, api: o.api, later, ...(o.modelSelect ? { modelSelect: o.modelSelect } : {}) }),
        keep: () => o.besidePlan?.open(),
      })
    : null;

  /** The teams moved — on the side, in charge, their crews: the Agents tab paints again where it shows, and its badge. */
  const drawTeam = () => {
    if (viewOf(chat) === "side") side.paint(chat);
    paintBadges();
  };

  /** The Agents view, painted in place while it shows (side.js); the thread it follows is let go when it leaves. */
  const drawSide = () => {
    if (viewOf(chat) !== "side") {
      if (sideShown) side.close();
      sideShown = false;
      return;
    }
    sideShown = true;
    side.paint(chat);
  };

  function draw() {
    // A chat kept on the Teams tab, or an address that names it, opens the Agents tab on the team's row.
    if (chat?.chainId && chat.viewTab === "team") {
      chat.viewTab = "side";
      side.aim(chat, aimOf(chat));
    }
    // A pane no longer on top here — put back, closed, another chat's — leaves the chat on Chat.
    const list = tops();
    if (chat && topOf(viewOf(chat)) && !isTop(topOf(viewOf(chat)))) chat.viewTab = "chat";
    // The Plan never on its tab and beside the chat at once (D12): the right bar holds it — put there from another
    // chat, its ⋯ menu or the command center — so this chat shows Chat; the Plan tab takes it back (`show`).
    const beside = !!chat && viewOf(chat) === "plan" && !!o.besidePlan?.shown();
    if (beside) chat.viewTab = "chat";
    const has = !!chat?.chainId;
    const want = has || list.length > 0;
    if (want !== mounted) {
      mounted = want;
      o.slot.replaceChildren(...(want ? [tabs.el] : []));
    }
    tabs.setTops(list.map((t) => ({ id: TOP_VIEW + t.id, label: t.label, icon: t.icon, title: t.title })));
    // Without a session yet, the views are not there: Chat and the panes on top alone.
    const overview = overviewShown();
    if (!has) for (const id of ["overview", "side", "team", "plan"]) tabs.shown(id, false);
    else {
      tabs.shown("overview", overview);
      tabs.shown("side", true);
    }
    tabs.paint();
    o.frame.classList.toggle("view-overview", viewOf(chat) === "overview");
    o.frame.classList.toggle("view-plan", viewOf(chat) === "plan");
    o.frame.classList.toggle("view-side", viewOf(chat) === "side");
    o.frame.classList.toggle("view-pane", !!topOf(viewOf(chat)));
    o.frame.classList.toggle("view-browser", topOf(viewOf(chat)) === "browser");
    o.frame.classList.toggle("side-team", inCharge());
    o.top?.show(topOf(viewOf(chat)));
    drawSide();
    o.overview.setShown(viewOf(chat) === "overview");
    paintBadges();
    drawPlan();
    if (beside && mounted) o.onShow(chat);
  }

  /** Whether the Agents view shows work going on — an agent's, a team's: its clocks move, so the pulses go on while it does. */
  const ticking = () => viewOf(chat) === "side" && (!!chat?.live || o.team.rows().some((r) => r.status === "running") || besides().some((r) => r.state === "working" || r.state === "asking") || flows().some((f) => f.state === "running"));

  /** The run moved: one repaint of the tabs and the view for every event within PULSE_MS. */
  const pulse = () => {
    if (pulsing) return;
    pulsing = true;
    later(() => {
      pulsing = false;
      drawSide();
      if (viewOf(chat) === "overview") o.overview.paint();
      paintBadges();
      drawPlan();
      // The Plan beside the chat hears what the tab hears: the graph's feed, the tasks' steps, who plans it; its peek too.
      o.besidePlan?.refresh?.();
      peek?.refresh();
      if (ticking()) pulse();
    }, PULSE_MS);
  };

  return {
    /** @param {any} c */
    setChat(c) {
      // Another chat's peek never stays over this one; a chat shown again tells nothing of what was done meanwhile.
      if (c !== chat) {
        peek?.close();
        if (c?.chainId) o.planWatch?.forget(c.chainId);
      }
      chat = c;
      draw();
    },
    show,
    /** A pane on top shown as the chat's view (UX10). @param {string} id  its tab's */
    showTop: (id) => show(TOP_VIEW + id),
    /** The panes on top moved — one popped, put back, closed, renamed: the tabs drawn again, and Chat where the one shown went. */
    topsMoved() {
      const gone = !!topOf(viewOf(chat)) && !isTop(topOf(viewOf(chat)));
      draw();
      if (gone && mounted) o.onShow(chat);
    },
    pulse,
    draw,
    /**
     * The Plan's page beside the chat, drawn into its pane's body (D12): narrow, no card of its own; the chat shows
     * meanwhile, never the Plan tab with it. @param {any} body @param {any} c  the chat the pane follows
     */
    planPane: (body, c) => {
      // Opened beside the chat while its tab shows it (the ⋯ menu, the command center): the tab gives way, once the
      // right bar has drawn — one place at a time (D12).
      Promise.resolve().then(() => { if (c === chat && viewOf(chat) === "plan") show("chat"); });
      const view = renderPlan(body, planCtx(c, true), { h: mk, api: o.api, later, ...(o.modelSelect ? { modelSelect: o.modelSelect } : {}) });
      // The newest drawn is the one in sight: a task done is marked there (`watchPlan`).
      paneView = { chat: c, ...view };
      return view;
    },
    /**
     * The pane's Back to its tab: the Plan full size again — in a chat with no session yet, where there is no tab to go
     * back to, the pane closes.
     */
    planBack: () => {
      if (chat?.chainId) show("plan");
      else o.besidePlan?.close();
    },
    /** A sub-agent's card, in the team's pane of the Agents tab: the dock's "who asks" and a turn's order rows bring it. @param {string} id */
    reveal(id) {
      // While Settings › Experimental's Teams switch is off, outside a team's own chat and a chat still set to be led by a
      // team, there is no team's pane to bring it in: its own thread opens.
      if (!teamsOn(state.config) && !o.team.beside?.main?.() && !leadingTeam(chat?.view?.settings?.engine)) {
        if (!chat?.chainId) return;
        side.aim(chat, String(id));
        if (viewOf(chat) === "side") draw();
        else show("side");
        return;
      }
      show("team");
      if (viewOf(chat) === "side") team.reveal(id);
    },
    /** The Agents tab painted again where it shows: the teams beside this chat moved. */
    drawTeam,
    /** Whether this view is the one the open chat shows. @param {string} id */
    shows: (id) => viewOf(chat) === id,
    /** Whether the Agents tab shows a team's row now. */
    showsTeam: () => viewOf(chat) === "side" && isTeamItem(side.pane(chat)),
    /**
     * The Sub Agents view's doors: an agent's thread (`followUp`: its box takes the keys), a new thread (`tag`: on that
     * card), and a paint now, for what the view reads having landed.
     */
    side: {
      /** @param {string} id @param {{ followUp?: boolean }} [o2] */
      open(id, o2) {
        show("side");
        if (viewOf(chat) === "side") side.open(id, o2);
      },
      /** @param {string} [tag] */
      fresh(tag) {
        show("side");
        if (viewOf(chat) === "side") side.fresh(tag);
      },
      /** A new thread on a start, its question in the box until you send it: Catch me up's. @param {string} start */
      begin(start) {
        show("side");
        if (viewOf(chat) === "side") side.begin(start);
      },
      /**
       * `/btw` from the chat's own box (HarnessV4_Tasks E15 step 5, BW-16): the Ask shortcut's launch with these
       * words; the tab shows once its thread is open.
       * @param {string} question @param {any[]} [files]
       * @returns {Promise<string | null>}  why it cannot start, or null
       */
      async ask(question, files) {
        const why = await side.ask(chat, question, files);
        if (!why) show("side");
        return why;
      },
      paint: () => {
        drawSide();
        paintBadges();
      },
      /**
       * An agent's answer seen from its card in the chat — its Hide: opened, and the tab's number painted again.
       * @param {string} id @param {number} exchange
       */
      seen(id, exchange) {
        side.seen(chat, id, exchange);
        drawSide();
        paintBadges();
      },
    },
    /** The view on screen, as the dock reads it: under the team in charge, the Team view's, where a worker's card asks. */
    get view() { return inCharge() ? "team" : viewOf(chat); },
  };
}
