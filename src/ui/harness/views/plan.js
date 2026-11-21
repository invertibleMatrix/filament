// @ts-check
// The Plan view (HarnessV3-Views VW-D4; HarnessV3-TaskGraph TG-D5; one page since HarnessV4_TaskGraphPlus_Design, E41
// P4 — the owner's words of 10-25: "the Plan Page could itself don't need three tabs. Raw does not need to be shown"):
// the agent's plan, full size, on one page — the session's task graph drawn live (task-graph.js) where one exists, one
// canvas of its steps and their lines, the chosen task's card beside or under it by the room the page has, the steps
// down a rail beside the chat; else the
// newest `plan` event's checklist, with the graph's marks; the session's goal with them. The task graph is always on,
// with no switch (the owner's words of 10-29). With no plan yet the view says what a plan is. *Beside the chat* puts
// the page in the right bar, next to the conversation (views/host.js, app.js's `plan` pane). The Plan tab's badge
// counts what is open (`planCount`). A waiting card of the Team view opens its task here.
import { h, takeApart } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { popover, toast } from "../lib/ui.js";
import { statusWord } from "../lib/subagents.js";
import { api, apiShared } from "../lib/api.js";
import { routeFor } from "../lib/router.js";
import { placesFirst } from "../space/space.js";
import { openCleanUp } from "../space/footprint.js";
import { crewOf, leadingTeam, listWords } from "../lib/team.js";
import { link } from "../widgets/kit.js";
import { keepingFocus } from "../lib/keep-focus.js";
import { MARKS } from "../lib/marks.js";
import { atWork, state } from "../state.js";
import { groupsOf } from "../lib/graph-boxes.js";
import { crewWords, drawGraph, huntBusyWords, huntGoTitle, huntGoWords, hunterLine, huntWhat, planText, runningNow, stateChanges } from "./task-graph.js";
import { createModelSelect } from "../composer/model.js";
import { askSentence, openSideRunSheet, sideStartedWords } from "./side-run-sheet.js";
import { planFacts } from "../lib/plan-watch.js";
import { openReader } from "./note-reader.js";
import { PLAN_GO_TEXT } from "../lib/plan-ask.js";
import { armCanvas, zoomAround } from "./canvas-pan.js";

/**
 * What the view keeps of a chat between draws — a run's events draw it again every moment, and the task the developer
 * chose, where they had scrolled and the states the graph last showed must not snap back — wherever the page shows, on
 * its tab or beside the chat (one place at a time). `chosen` lasts the showing it was made in (the owner's of 11-11:
 * "when plan view is shown it should show un selected"): a view made anew — its tab opened, the page put beside the
 * chat, its peek — opens with none, unless a task was chosen from elsewhere for it (`reveal`). `shown` is the task the
 * view last followed into sight; `reveal`, a task chosen from elsewhere (`chooseTask`) or in the peek kept open
 * (`handOver`), which it follows into sight once though it was chosen. `kept`: what the
 * graph keeps behind its tasks as the view read it, for the graph's rev (E33) — the lists asked, the notes and files
 * opened, the notes read whole for a card, whether the graph's own card is open — and `keptRev` how many of those
 * answers have landed. `foldOpen`: the person's own Show them of the finished steps (D16); `opened`: the hunt boxes
 * done the person opened, by their hunted task's id; `steps`: the plan steps the person opened (true) or folded (false)
 * (11-06); `zoom`: the canvas's zoom the person set, or Fit, null as it opens; `pan`: where
 * the canvas was panned to, at which zoom; `canvasH`: the canvas's own height as last laid out, Fit's room down (the
 * owner's of 11-10), none before it was; `inspector`: where the card beside the canvas was scrolled to, and whose it
 * was; `more`: the cards whose folded
 * parts the person opened (D14); `older`: the person's Show the graph, where the agent keeps a checklist now and the
 * session's graph is from before (`pageOf`).
 * @typedef {{ rev: number, lists: Map<string, { list: any, error: string | null }>,
 *   notes: Map<string, { text: string | null, error: string | null }>, graph: boolean }} KeptRead
 * `huntModel`: the model a done task's hunting Reviewer runs on, "" for its own (UX9); `hunts`: the Reviewers started
 * on each task while the page is open — drawn until the chat's list says them; `hunting`: the tasks whose hunt is
 * starting.
 * `sideAsked`: the side-run sheet's Ask your agent instead — which tasks, and when — said in the offer's place until
 * they start. `hand`: the person scrolled the view themselves — it holds where they put it until the work passes a task
 * done (`follow`); `justDone`: the tasks just done, by their ids, and when (`celebrate`). `dir`: the way the canvas is
 * drawn, top to bottom as it opens; `order`: the order the person's Rearrange found, none before it, and the graph it
 * was found on (its `startedAt`); `said`: what it found, in words, and when (the owner's of 11-14).
 * @typedef {{ agent: string, name: string, model: string, at: number }} Hunt
 * @typedef {{ chosen: string | null, shown: string | null, states: Map<string, string> | null, scroll: number, reveal: boolean, kept?: KeptRead, keptRev?: number,
 *   dir: import("../lib/graph-lanes.js").Dir, order: { of: number | null, rows: string[][] } | null, said: { words: string, at: number } | null,
 *   huntModel: string, hunts: Map<string, Hunt[]>, hunting: Set<string>, foldOpen: boolean, opened: Set<string>, steps: Map<string, boolean>, zoom: import("./task-graph.js").Zoom,
 *   pan: import("./task-graph.js").Pan | null, more: Set<string>, older: boolean, sideAsked?: { ids: string[], at: number } | null, hand: boolean,
 *   justDone: Map<string, number>, openShown?: boolean, openGone?: boolean, canvasH?: number, inspector?: { id: string, y: number } }} Kept
 */
/** @type {Map<string, Kept>} chat → what the view keeps */
const kept = new Map();

/** What the view keeps for a chat, made the first time it is asked for. @param {any} c */
const keptFor = (c) => {
  const key = String(c?.chainId || c?.id || "");
  if (!kept.has(key)) kept.set(key, { chosen: null, shown: null, states: null, scroll: 0, reveal: false, dir: "down", order: null, said: null, huntModel: "", hunts: new Map(), hunting: new Set(), foldOpen: false, opened: new Set(), steps: new Map(), zoom: null, pan: null, more: new Set(), older: false, hand: false, justDone: new Map() });
  return /** @type {Kept} */ (kept.get(key));
};

/** How long a task just done stays marked, ms: views.css's `tg-just-done`. */
export const JUST_DONE_MS = 2400;
/** How long the person's own move in the view — the pointer, a key, a scroll — says they are at it, ms. */
const HAND_MS = 2000;
/** How long the canvas bar says what a Rearrange found, ms. */
const SAID_MS = 4000;
/** How long the view stays on a task just done before it follows the work on, ms. */
const DONE_STAY_MS = 1600;
/** The keys that scroll the view. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

/**
 * A task brought into sight within the view's own scroller, by the least move that shows it — its top where
 * it is taller than the view. The scroller alone moves: a browser's scrollIntoView moves every box round it that can
 * scroll, the conversation's frame too while the peek slides in from past its edge.
 * @param {any} scroller @param {any} el
 */
function reveal(scroller, el) {
  const box = el?.getBoundingClientRect?.();
  const port = scroller.getBoundingClientRect?.();
  if (!box || !port) return;
  if (box.top < port.top) scroller.scrollTop += box.top - port.top;
  else if (box.bottom > port.bottom) scroller.scrollTop += Math.min(box.bottom - port.bottom, box.top - port.top);
}

/** The room kept beside a task the canvas brings into sight sideways, px. */
const SIDE_ROOM = 16;
/**
 * A task brought into sight sideways in the canvas (the redesign's pan), by the least move that shows it with a little
 * room beside it — its start where it is wider than the canvas.
 * @param {any} port  the canvas's sideways scroller @param {any} el
 */
export function revealSideways(port, el) {
  const box = el?.getBoundingClientRect?.();
  const view = port?.getBoundingClientRect?.();
  if (!box || !view) return;
  if (box.left < view.left + SIDE_ROOM) port.scrollLeft += box.left - view.left - SIDE_ROOM;
  else if (box.right > view.right - SIDE_ROOM) port.scrollLeft += Math.min(box.right - view.right + SIDE_ROOM, box.left - view.left - SIDE_ROOM);
}

/**
 * The task in progress that started last (the owner's of 11-11: the Plan, shown, goes to "the last task that was
 * started and is in progres"): of the running ones, the newest start — at the same start a task with work of its own
 * before a step with sub-tasks, which starts as its first sub-task does (core/task-graph.js), else the first as the
 * plan lists them; null where none runs.
 * @param {any} graph  the graph as the view draws it
 */
const startedLast = (graph) => {
  const own = (/** @type {any} */ t) => (t.subtasks?.length ? 0 : 1);
  /** @type {any[]} */
  const running = (graph?.tasks || []).filter((/** @type {any} */ t) => t.state === "running");
  return running.sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0) || own(b) - own(a))[0] || null;
};

/**
 * How often the view's time words ("started 3 min ago", the graph's span) may move while nothing else changes, ms: a
 * draw that would show what the last one showed is skipped, so what the cursor hovers or selects stays.
 */
const CLOCK_MS = 30_000;

/** The size of the page's type, px (theme.js sets `--ui-font-size`): the graph's boxes follow it. Unknown without a page. */
const fontSize = () =>
  typeof getComputedStyle === "function" && globalThis.document?.documentElement
    ? parseFloat(getComputedStyle(globalThis.document.documentElement).getPropertyValue("--ui-font-size")) || null
    : null;

/**
 * chain → the session's answer (`/sessions/:id`), asked again once a turn starts or ends, or after 30 s, with who waits
 * for it to land: the view's newest draw, the tab's badge. `stale`: what it was asked for moved while it was on its way
 * (`askAgain`), so the answer is asked for again once it lands.
 * @type {Map<string, { key: string, at: number, answer: any, last: any, asking: boolean, heard: Set<() => void>, stale?: boolean, again: number }>}
 */
const answers = new Map();

/**
 * The session's answer for a chain to be asked for again at the next read — at once, or as the one on its way lands:
 * the Still open card's Undo moved what it says.
 * @param {string} chain
 */
const askAgain = (chain) => {
  const had = answers.get(chain);
  if (!had) return;
  if (had.asking) had.stale = true;
  else had.at = -Infinity;
};

/**
 * Every chat's answer asked for again at its next read: a worktree was removed or put back in the Space — Tidy up, where
 * the Still open card sends the person —, so what the card says of the folders moved (the reviewer's of 11-10).
 */
export const askOpenAgain = () => {
  for (const chain of answers.keys()) askAgain(chain);
};

/** The chains whose answer has landed once: before that, the view says nothing about a plan. @type {Set<string>} */
const landed = new Set();

/**
 * Too early to say there is no plan: the session's first answer is on its way, or it says the session has turns the
 * page has not loaded yet (its transcript is on its way) — a "No plan yet" drawn then is taken back when they land.
 * @param {any} c @param {any} answer
 */
const tooEarly = (c, answer) => !!c?.chainId && (!landed.has(c.chainId) || (!c.turns?.length && Number(answer?.identity?.turns) > 0));

/**
 * What the session's answer was asked for: the chat's turns as they stand, so a turn that starts or ends asks again —
 * and its running commands, so a command that ends between turns leaves the Still open card (the review of 3292ec46d).
 * @param {any} c
 */
const askedFor = (c) => `${c.turns?.length || 0}:${c.turns?.at(-1)?.status || ""}:${c.live ? "live" : ""}:${(state.commands?.get?.(String(c.chainId)) || []).map((/** @type {any} */ r) => r?.id).join(",")}`;

/**
 * The session's answer for the chat as it stands — null while it is asked for. Landing, it calls each listener that
 * waited for it. With no `ask`, it is not asked for now: what was heard for the chat as it stands, else null.
 * @param {any} c @param {((path: string) => Promise<any>) | null} ask @param {() => void} onLand
 */
function answerOf(c, ask, onLand) {
  if (!c?.chainId) return null;
  const key = askedFor(c);
  const had = answers.get(c.chainId);
  if (had && had.key === key && (had.asking || Date.now() - had.at < 30_000)) {
    if (had.asking) had.heard.add(onLand);
    return had.answer;
  }
  if (!ask) return had?.key === key ? had.answer : null;
  // `last`: the answer as last heard, kept for what does not go stale with a turn (the goal: `goalOf`). `again`: how many
  // times in a row its Still open was still being read anew (`OPEN_AGAIN_MOST`).
  const entry = { key, at: Date.now(), answer: had?.key === key ? had.answer : null, last: had?.answer || had?.last || null, asking: true, heard: new Set([onLand]), again: had?.key === key ? had.again || 0 : 0 };
  answers.set(c.chainId, entry);
  // `open=fresh`: this read shows the Still open list, so the session waits a moment for its folder's read.
  ask(`/sessions/${encodeURIComponent(c.chainId)}?open=fresh`)
    .then((a) => { entry.answer = a; })
    .catch(() => { /* no session truth yet — the run's events stand alone */ })
    .finally(() => {
      entry.asking = false;
      entry.at = entry.stale ? -Infinity : Date.now();
      landed.add(c.chainId);
      const heard = [...entry.heard];
      if (answers.get(c.chainId) === entry) for (const fn of heard) fn();
      entry.heard.clear();
      // Its Still open was still being read anew past the session's wait — a Clean up, a Tidy up, on a repository of many
      // worktrees —: asked again in a moment, a few times at most, then at the page's own half minute (the review of
      // 4569417b8).
      if (!entry.answer?.open?.stale) entry.again = 0;
      else if (entry.again < OPEN_AGAIN_MOST) {
        entry.again++;
        const go = () => {
          if (answers.get(c.chainId) !== entry || entry.asking) return;
          entry.at = -Infinity;
          for (const fn of heard) fn();
        };
        if (globalThis.window) globalThis.window.setTimeout(go, OPEN_AGAIN_MS);
        else setTimeout(go, OPEN_AGAIN_MS);
      }
    });
  return entry.answer;
}

/** How long the page waits to ask again for an answer whose Still open was still being read anew, and how many times. */
export const OPEN_AGAIN_MS = 3000;
export const OPEN_AGAIN_MOST = 4;

/**
 * The session's goal for the view: the answer's — and, while the answer is asked for again (a turn started or ended),
 * the one last heard, so the goal does not go and come back (HarnessV4_Tasks U4). The graph is not kept so: a turn's
 * events carry a newer one than an old answer could (`planOf`).
 * @param {any} c @param {any} answer  the session's answer, or null while it is asked for
 */
const goalOf = (c, answer) => (answer || answers.get(c?.chainId)?.last || null)?.inForce?.goal || null;

/**
 * What is still open in the chat (app/agent/still-open.js `shown`), as the session's answer says it — the one last heard
 * while it is asked for again, as the goal is (`goalOf`). `lines`: the agent's list; `items`: every item, the ones the
 * agent dismissed too (the owner's of 11-09), null from a server that says the lines alone. `folded`: where the agent
 * was not told the list since, it was Filament's fold of the chat that left it so, not a compaction of the agent's own;
 * `reading`: what the chat's folder holds is still being read — never yet, or anew —, so what was left behind may not
 * be all there (the answer's `stale`).
 * @param {any} c @param {any} answer
 * Each item's `view` is its words on the card (still-open.js `OpenView`), none from a server before 11-10.
 * @returns {{ lines: string[], told: boolean, folded?: true, reading?: true, items: { key: string, line: string, dismissed: boolean, view?: any }[] | null } | null}
 */
const stillOpenOf = (c, answer) => {
  const o = (answer || answers.get(c?.chainId)?.last || null)?.open;
  if (!o || !Array.isArray(o.lines)) return null;
  const items = Array.isArray(o.items) ? o.items.map((/** @type {any} */ i) => ({ key: String(i?.key), line: String(i?.line), dismissed: !!i?.dismissed, ...(i?.view && typeof i.view === "object" ? { view: i.view } : {}) })) : null;
  return { lines: o.lines.map(String), told: o.told !== false, ...(o.folded === true ? { folded: /** @type {const} */ (true) } : {}), ...(o.stale === true ? { reading: /** @type {const} */ (true) } : {}), items };
};

/**
 * The project a chat belongs to, whose Space holds its folders and worktrees: its session's, as the list names it, else
 * the project whose folder it is (app.js `projectOfChat`); null where neither names one.
 * @param {any} c
 */
const projectOf = (c) => {
  const listed = c?.chainId ? (state.sessions || []).find((/** @type {any} */ s) => s.id === c.chainId)?.project : null;
  if (listed && listed !== "none") return String(listed);
  const key = (/** @type {unknown} */ p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const p = c?.cwd ? (state.projects || []).find((/** @type {any} */ x) => x.cwd && key(x.cwd) === key(c.cwd)) : null;
  return p ? String(p.id) : null;
};

/**
 * A project's Folders and worktrees, as its menu in the left bar opens them (app.js `onSpacePlaces`): its Space's page,
 * its places' sheet open over it. @param {string} id
 */
const openPlacesIn = (id) => {
  placesFirst(id);
  globalThis.location.hash = routeFor("space", { id });
};

/** How many things the lines name: a line each, and a line's "and 3 more" its three. @param {string[]} lines */
export const openCount = (lines) => lines.reduce((n, l) => n + (Number(/^- and (\d+) more /.exec(l)?.[1]) || 1), 0);

/**
 * One thing open as the card draws it: its key, the agent's line, whether the agent dismissed it, and its view in the
 * person's words (still-open.js `OpenView`).
 * @typedef {{ key: string, line: string, dismissed: boolean, view: { group: "waiting" | "running" | "left", tone: string, title: string, detail: string, act?: string, agent?: string, what?: string, count?: number, size?: string } }} OpenItem
 */
/**
 * The things open as the card draws them: the answer's items, each with its view — an item with none (a server from
 * before 11-10) its line as its title, among what runs; where the answer has lines alone, a line each.
 * @param {{ lines: string[], items: any[] | null }} open @returns {OpenItem[]}
 */
export const openItemsOf = (open) => {
  const plain = (/** @type {string} */ line) => ({ group: /** @type {const} */ ("running"), tone: "run", title: line.replace(/^- /, ""), detail: "" });
  if (!open.items) return open.lines.map((line) => ({ key: line, line, dismissed: false, view: plain(line) }));
  return open.items.map((i) => ({ key: String(i.key), line: String(i.line), dismissed: !!i.dismissed, view: i.view && typeof i.view === "object" ? i.view : plain(String(i.line)) }));
};

/** "1 merged worktree", "3 merged worktrees"; nothing at none. @param {number} n @param {string} one @param {string} [more] */
const countOf = (n, one, more = `${one}s`) => (n ? `${n} ${n === 1 ? one : more}` : "");

/** How the list works, on the ⓘ of the Still open card. */
export const OPEN_INFO = "What this chat has waiting, running and left behind. Filament keeps the list itself and tells the agent again after every compaction, so nothing is lost in a summary. A row goes when what it names ends. The agent can dismiss a row that no longer holds; it comes back if that changes, and Undo puts it back now.";

/**
 * What the view draws for a chat: the newest turn's checklist; the graph — the newest of the running turn's newest
 * `graph` event, the session's answer once it has landed for the chat as it stands (until then the newest one a turn's
 * events carried), and the one the page's feed brought (`graphLive`): each carries the graph's rev, so an older one
 * never draws over a newer one (HarnessV3-TaskGraph G2-10); and which way to plan the agent used last.
 * @param {any} chat @param {any} answer  the session's answer, or null while it is asked for
 * @returns {{ plan: any[], graph: any, planned: "plan" | "graph" | null }}
 */
export function planOf(chat, answer) {
  /** @type {any[]} the turns whose run events are aligned, newest first */
  const turns = [...(chat?.turns || [])].reverse().filter((t) => t?.aligned);
  const live = chat?.live?.turn?.aligned ? chat.live.turn : null;
  if (live && !turns.includes(live)) turns.unshift(live);
  /** @param {any} t @param {"plan" | "graph"} key */
  const newest = (t, key) => [...t.aligned.byRound.values()].map((x) => x[key]).filter((v) => v && (key === "graph" || v.length)).at(-1) || null;
  const ran = turns.map((t) => newest(t, "graph")).find(Boolean) || null;
  const rev = (/** @type {any} */ g) => Number(g.rev) || 0;
  const graph = [live ? newest(live, "graph") : null, answer ? answer.inForce?.graph || null : ran, chat?.graphLive || null].reduce((best, g) => (g && (!best || rev(g) > rev(best)) ? g : best), null);
  return { plan: turns.length ? newest(turns[0], "plan") || [] : [], graph, planned: turns.map((t) => t.aligned.planned).find(Boolean) || null };
}

/**
 * Whether the agent's checklist is the steps of a task on the open graph (the owner's of 11-11), as the graph says it
 * (core/task-graph.js `graphView`): a task of it holds the steps (`stepsOf`), and the checklist as last sent is those
 * steps (`stepsListed`) — not a later list that named the graph's tasks or became tasks of its own. Where a list goes is
 * the graph's to say (`applyPlan`): the page matches no text of its own, which a day of fixes could not keep in step
 * with the graph's rule. The graph is the plan then, its checklist inside it.
 * @param {any} graph
 */
const stepsOnGraph = (graph) => !!graph && !graph.closed && !!graph.stepsOf && graph.stepsListed === true;

/**
 * What the Plan tab counts (HarnessV3-Views VW-D1): done of all while something is open — the graph's tasks, the
 * dropped ones left out, when the agent last planned on the graph, there is no checklist, or the checklist is a task's
 * steps (`stepsOnGraph`); else the checklist's items. Null once nothing is open: every item done, or every task done or dropped,
 * as a closed graph's are.
 * @param {{ plan: any[], graph: any, planned: "plan" | "graph" | null }} d
 * @returns {{ done: number, all: number } | null}
 */
export function planCount({ plan, graph, planned }) {
  const n = graph && (planned === "graph" || !plan.length || stepsOnGraph(graph))
    ? { done: graph.counts.done, all: graph.counts.total - graph.counts.dropped }
    : { done: plan.filter((p) => p.status === "done").length, all: plan.length };
  return n.done < n.all ? n : null;
}

/**
 * What the Plan page shows (D19), by the tab badge's own rule (`planCount`): the graph while the agent planned on it
 * last, there is no checklist, or the checklist is the steps of a task on it (the owner's of 11-11: its box says them,
 * `stepsOnGraph`); else the checklist the agent keeps now, the session's older graph — closed, or left for the checklist — a
 * press away (`older`: the person's Show the graph). `other`: the page shows one of the two, and the other is there to
 * show.
 * @param {{ plan: any[], graph: any, planned: "plan" | "graph" | null }} d @param {boolean} older
 * @returns {{ shows: "graph" | "checklist" | "", other: boolean }}
 */
export function pageOf({ plan, graph, planned }, older) {
  if (graph && (planned !== "plan" || !plan.length || stepsOnGraph(graph))) return { shows: "graph", other: false };
  if (!plan.length) return { shows: "", other: false };
  return graph ? { shows: older ? "graph" : "checklist", other: true } : { shows: "checklist", other: false };
}

/**
 * The session's answer for a chat as the views ask it: not while its transcript is on its way (`held`) — that is the
 * page's first request out, and the session's whole row asked beside it held it behind on the page's six connections;
 * the views are drawn again once it lands, its turns read, and ask then.
 * @param {any} chat @param {{ api?: (path: string) => Promise<any>, onLand: () => void, held?: boolean }} o
 */
const viewsAnswer = (chat, o) => answerOf(chat, o.held ? null : o.api || apiShared, o.onLand);

/**
 * The Plan tab's count for a chat, from what the view would draw. The session's answer, asked for when it is due, calls
 * `onLand` once it lands.
 * @param {any} chat @param {{ api?: (path: string) => Promise<any>, onLand: () => void, held?: boolean }} o
 */
export const planBadge = (chat, o) => planCount(planOf(chat, viewsAnswer(chat, o)));

/**
 * The graph as the view draws it for a chat — for the Team view's tasks still to come. The session's answer, asked for
 * when it is due, calls `onLand` once it lands.
 * @param {any} chat @param {{ api?: (path: string) => Promise<any>, onLand: () => void, held?: boolean }} o
 */
export const graphOf = (chat, o) => planOf(chat, viewsAnswer(chat, o)).graph;

/**
 * The task graph the page shows for a chat, as its live feedback reads it (lib/plan-watch.js) — null while the page
 * cannot say yet: the session's answer, or the turns it says, on their way (`tooEarly`) — and whether the running turn
 * made or moved it (`fresh`: its run carries a graph a round of its own moved, not its checklist's plan call alone). The
 * session's answer, asked for when it is due, calls `onLand` once it lands.
 * @param {any} chat @param {{ api?: (path: string) => Promise<any>, onLand: () => void, held?: boolean }} o
 * @returns {import("../lib/plan-watch.js").PlanFacts | null}
 */
export function planNow(chat, o) {
  if (!chat?.chainId) return null;
  const answer = viewsAnswer(chat, o);
  if (tooEarly(chat, answer)) return null;
  const d = planOf(chat, answer);
  /** @type {any[]} */
  const rounds = chat.live?.turn?.aligned ? [...chat.live.turn.aligned.byRound.values()] : [];
  return { ...planFacts(d, pageOf(d, keptFor(chat).older).shows), fresh: rounds.some((x) => !!x.graph && !x.plan?.length) };
}

/**
 * The work under way on a chat's plan, in words, or null (the owner's of 11-10: "if task graph is running or a checklist
 * task is running then Plan should come out of this three dot"): what of its graph runs, as the page's head counts it
 * (task-graph.js `runningNow`: never the agent's own task between its turns), else the checklist's item its agent is on
 * while it works — one left doing at a turn's end is worked on by nothing. The session's answer, asked for when it is
 * due, calls `onLand` once it lands.
 * @param {any} chat @param {{ api?: (path: string) => Promise<any>, onLand: () => void, held?: boolean }} o
 */
export function planAtWork(chat, o) {
  if (!chat?.chainId) return null;
  const d = planOf(chat, viewsAnswer(chat, o));
  const working = atWork(chat.chainId, chat);
  const n = d.graph ? runningNow(d.graph, { atWork: working, crew: crewOf(chat.view?.settings?.engine), progress: chat.taskProgress || null }) : 0;
  if (n) return `work under way: ${n} running`;
  const doing = working ? d.plan.find((p) => p?.status === "doing") : null;
  return doing ? `work under way: now ${String(doing.text || "an item of the checklist")}` : null;
}

/**
 * A task of the graph chosen from elsewhere — a waiting card of the Team view (HarnessV3-TaskGraph G3-7): the page
 * opens with the task's card, and follows the task into sight on the next draw.
 * @param {any} chat @param {string} id
 */
export function chooseTask(chat, id) {
  Object.assign(keptFor(chat), { chosen: id, reveal: true, scroll: 0 });
}

/**
 * What the page does for a done task's hunt (UX9): `start` launches a Reviewer and answers who started, or null where it
 * did not (the page said why); `hunters` the chat's sub-agents that hunt one of its tasks, as its list holds them (a
 * reload and a restart keep them); the rest feed the model chip.
 * @typedef {{ start: (t: any, model: string) => Promise<{ agent: string, name: string, model: string } | null>,
 *   hunters?: (chainId: string) => import("../lib/subagents.js").SubagentRow[],
 *   models: () => any[], families?: () => any[], accounts?: () => any[] }} PlanHunt
 */

/**
 * Each page's watch of its room, with whether the page went (`gone`): a page off screen is never put back, and as the
 * next page is made its watch is let go of and the page taken apart, each node on its own (`letGoneGo`). What a frame
 * still owes a page held it whole until a frame came — its watch's word that it went, a scroll it was told of, a task's
 * mark turning as it works —, and through its nodes' handlers its graph's drawing: a window that got no frames (hidden,
 * covered, the screen locked) kept every page made meanwhile, a chat shown again making one each time (the owner's of
 * 11-17; in the lab, ~2,200 nodes each time). Taken apart, such a node holds itself alone.
 * @type {Set<{ watch: ResizeObserver, gone: () => boolean, page: Element, ears: AbortController }>}
 */
const watches = new Set();
const letGoneGo = () => {
  for (const w of watches) {
    if (!w.gone()) continue;
    w.watch.disconnect();
    w.ears.abort();
    watches.delete(w);
    takeApart(w.page);
  }
};
/** Where each page's scroller was left, its chat's (`keptFor`): heard by a handler that holds no page. @type {WeakMap<Element, { scroll?: number }>} */
const scrollKept = new WeakMap();
/** @param {Event} e */
function keepScroll(e) {
  const el = /** @type {HTMLElement} */ (e.currentTarget);
  const mem = scrollKept.get(el);
  if (mem) mem.scroll = el.scrollTop;
}

/**
 * Draw the view into `body`, once per chat: `paint` draws it again in place, and only when what it would show changed
 * — the plan, the graph and its tasks' steps, the goal, the task chosen, the room it has, or its time words
 * (`CLOCK_MS`) — so a run's pulse leaves what the cursor hovers or selects as it is (U0's item 10). One page
 * (HarnessV4_TaskGraphPlus_Design, E41 P4): the graph where one exists, its boxes laid out with their lines in one
 * pass on a canvas that zooms and pans, the card beside or under it by the room it has (D15) — a width that would draw
 * otherwise draws again;
 * else the agent's checklist (D19) — the checklist too where the agent keeps one now and the graph is from before, the
 * graph a press away (`pageOf`); else what a plan is. Copy plan copies what the page shows (D1-6); *Beside the chat*
 * puts the page in the right bar (`ctx.toSide`, D12), where it has no card of its own (`ctx.pane`, D14); *Run them in parallel…* opens the side-run sheet (the
 * Designer's of 10-27, built 10-28), whose Run starts the tasks on sub-agents itself on the models `ctx.sideRun` offers,
 * and whose Ask your agent instead sends the chat the person's own sentence — a steer while a turn runs, else the next
 * message (`ctx.send`, case 19); without `ctx.sideRun` the press sends that sentence at once. `ctx.openAgent` opens a
 * sub-agent's conversation, `ctx.openRunLog` the run's log and `ctx.sendBack` sends a failed graph task back in the
 * developer's own name; the chat's `taskProgress` holds each running graph task's newest step, from the page's feed.
 * `ctx.hunt` starts a Reviewer hunting a done task (UX9) — its brief is `huntBrief`'s, its model the one picked here or
 * "" for its own; null where it did not start, the page having said why — lists the models its chip offers, and the
 * chat's Reviewers sent to hunt, which each task's box counts; a right-click on a done task's box opens its hunt in a popup there.
 * `ctx.reading` says the run the plan is read from is on its way (the host's `readNewest`, after a reload): until it
 * lands the page draws nothing, and a page drawn already stands — the tab's host waits so for its own. `ctx.held` says
 * the chat's transcript is on its way: the session's answer is asked for once it has landed (`viewsAnswer`). A page whose
 * nodes left the screen (its chat's view built again, its pane closed) draws no more. Each view made is a showing (the
 * owner's of 11-11): it opens with no task chosen, on the running task that started last (`follow`), and no card opens
 * on its own while it stays shown, on the tab too: the person's press opens one (`graphEl`). `celebrate` marks
 * the graph's tasks just done (lib/plan-watch.js) and brings the newest into sight (`follow`). The last argument is the
 * tests' seam: the page's `h`, the session's answer, the clock, the model picker, the side-run sheet, the popover, the
 * timer, where a drag's moves are heard (`win`), and where the Still open card opens a project's Folders and worktrees
 * (`openPlaces`) and the footprint's sheet (`cleanUp`).
 * @param {any} body
 * @param {{ chat: any, openAgent?: (id: string) => void, reviewAgent?: ((id: string) => void) | null, openRunLog?: () => void,
 *   sendBack?: (task: string, fresh: boolean) => void, hunt?: PlanHunt | null, send?: ((text: string) => void) | null,
 *   toSide?: (() => void) | null, pane?: boolean, reading?: (() => boolean) | null, held?: (() => boolean) | null,
 *   sideRun?: { model: () => string, models: () => any[], families?: () => any[], accounts?: () => any[] } | null,
 *   carry?: ((tasks: number) => void) | null, openChain?: ((chainId: string) => void) | null, stay?: boolean }} ctx  `carry`:
 *   Continue in a new chat, the plan carried into a fork of the chat (the owner's plan mode of 11-06, piece E);
 *   `openChain` opens the chat a closed plan went on in; `stay`: a task just done stays in sight for as long as the view
 *   is up, the work it moved on to beside it where both fit — the peek's, whose title names it (the owner's of 11-07)
 * @param {{ h?: typeof h, api?: (path: string, init?: any) => Promise<any>, now?: () => number, modelSelect?: typeof createModelSelect,
 *   sideSheet?: typeof openSideRunSheet, popover?: typeof popover, later?: (fn: () => void, ms: number) => void,
 *   sheet?: (o: any) => { el: any, scroller: any, close: () => void }, win?: { addEventListener: Function, removeEventListener: Function },
 *   openPlaces?: (project: string) => void, cleanUp?: typeof openCleanUp }} [o]
 *   `sheet`: where a kept note is read whole
 * @returns {{ paint: () => void, celebrate: (ids: string[]) => void, handOver: () => void }}  `handOver`: the peek's pick
 *   becomes the chat's, as its Keep open puts the Plan beside the chat
 */
export function renderPlan(body, ctx, o = {}) {
  const mk = o.h || h;
  const ask = o.api || apiShared;
  const clock = o.now || Date.now;
  const later = o.later || ((fn, ms) => { setTimeout(fn, ms); });
  const c = ctx.chat;
  const mem = keptFor(c);
  /**
   * What a Rearrange found, said until its moment is over: cleared by the view up then, whichever view put it up — a
   * Plan hidden and shown again is a view made anew (the review of 11-14). @param {{ words: string, at: number }} said
   */
  const unsay = (said) =>
    later(() => {
      if (mem.said && mem.said !== said) return;
      mem.said = null;
      paint();
    }, Math.max(0, said.at + SAID_MS - clock()));
  if (mem.said) unsay(mem.said);
  /** The order the person's Rearrange found for the graph shown: none for another graph, a new plan laid out afresh. */
  const orderNow = () => (mem.order && mem.order.of === (d.graph?.startedAt ?? null) ? mem.order.rows : null);
  // A showing (the owner's of 11-11: "when plan view is shown it should show un selected and scroll over to the last
  // task that was started and is in progres"): the view made anew — its tab opened, the page put beside the chat, its
  // peek. The task chosen in the showing before ended with it, unless one was chosen from elsewhere for this one
  // (`reveal`); and its first draw of the graph laid out goes to the running task that started last (`follow`).
  if (!mem.reveal) mem.chosen = null;
  let opening = true;
  // The peek (`ctx.stay`), opening on its own as a task is done, opens with none chosen: the task last pressed on the
  // Plan's tab or beside the chat is that view's, and in the peek it stood pressed, its card and Hunt open (the owner's
  // of 11-08). A press in the peek chooses there alone.
  let peekPick = /** @type {string | null} */ (null);
  const chosenNow = () => (ctx.stay ? peekPick : mem.chosen);
  /** @param {string | null} id */
  const choose = (id) => {
    if (ctx.stay) peekPick = id;
    else mem.chosen = id;
  };

  // What the view draws: the graph, and who plans it.
  // The session's answer, landing, draws this page again — one listener however often it draws meanwhile.
  const heard = () => paint();
  const read = () => {
    const answer = viewsAnswer(c, { api: ask, onLand: heard, held: !!ctx.held?.() });
    const p = planOf(c, answer);
    const members = leadingTeam(c?.view?.settings?.engine)?.members || null;
    return {
      ...p,
      crew: crewOf(c?.view?.settings?.engine),
      members,
      shippedCrew: c?.view?.settings?.engine?.shippedCrew || null,
      goal: goalOf(c, answer),
      open: stillOpenOf(c, answer),
      early: tooEarly(c, answer),
      // Whether the chat's agent works now: between its turns its own running task is drawn between turns.
      atWork: atWork(c?.chainId, c),
    };
  };
  let d = read();
  /** The tasks whose state changed since the last draw: each pops, once. @type {Set<string>} */
  let popped = new Set();
  /** What the last draw showed, as one string: a draw that would show the same is skipped. */
  let drawnKey = "";
  /** The running tasks' newest steps the drawing says (`paintNow`), and the graph's drawing, which takes them where they
   *  alone moved; none while the page shows no graph. @type {ReturnType<typeof drawGraph> | null} */
  let drawnGraph = null;
  let drawnSteps = "";
  /** What a room would change of the newest drawing (task-graph.js `drawGraph`'s `fit`): another answer draws it again. */
  let fit = (/** @type {number} */ _width, /** @type {number | null | undefined} */ _height) => "";
  /** What the newest draw shows (`pageOf`). @type {ReturnType<typeof pageOf>} */
  let page = { shows: "", other: false };

  const inner = mk("div", { class: "pv-inner" });
  const scroll = mk("div", { class: "pv-scroll" }, inner);
  scrollKept.set(scroll, mem);
  scroll.addEventListener("scroll", keepScroll);
  // What the page's own nodes hear, taken back whole as it goes (`letGoneGo`): a node a frame still owes something holds
  // its handlers, and through them the page.
  const ears = new AbortController();
  const hear = { passive: true, signal: ears.signal };
  // Where the right-click hunt's popup stands (UX9): laid over the box it was opened on, and never drawn again — a box
  // is drawn anew at every draw, and a popover whose anchor went is closed with it (lib/ui.js `closeOrphans`).
  const huntAnchor = mk("span", { class: "tg-hunt-anchor", "aria-hidden": "true" });
  const viewEl = mk("div", { class: `plan-view${ctx.pane ? " is-pane" : ""}` }, scroll, huntAnchor);
  body.append(viewEl);
  // Whether the person is at the view (the owner's of 11-04: the current task kept in sight "if user is not interacting
  // with the list"): the pointer moved or pressed in it, a key, a scroll of their own, a moment ago. A pointer resting
  // over the page is none: on its tab the page is all the frame.
  let movedAt = -Infinity;
  const busy = () => clock() - movedAt < HAND_MS;
  const moved = () => { movedAt = clock(); };
  for (const type of ["pointermove", "pointerdown", "keydown"]) viewEl.addEventListener(type, moved, hear);
  // A scroll of the person's own — the wheel, a touch, the keys, the scrollbar pressed — holds the view where they put
  // it; the view's own scrolls are none of these.
  const byHand = () => {
    moved();
    mem.hand = true;
  };
  // The inspector beside the canvas scrolls itself: a wheel, a swipe or a scroll key in it moves neither the page nor
  // the canvas, so the view still follows the work (the reviews of d5aa58d31 and 67038d835: it held the view where
  // nothing had moved).
  const inspectorOf = (/** @type {any} */ t) => t?.closest?.(".pv-inner.is-workspace .tg-body.is-beside > .tg-card") || null;
  // At its end the wheel goes on to the page (views.css), which is the person's own scroll.
  const pastEnd = (/** @type {any} */ card, /** @type {number} */ dy) => (dy < 0 ? Number(card.scrollTop) <= 0 : dy > 0 && Number(card.scrollTop) + Number(card.clientHeight) >= Number(card.scrollHeight) - 1);
  const byHandOff = (/** @type {any} */ e) => { if (!inspectorOf(e?.target)) byHand(); };
  scroll.addEventListener("wheel", (/** @type {any} */ e) => {
    const card = inspectorOf(e?.target);
    if (!card || pastEnd(card, Number(e.deltaY) || 0)) byHand();
  }, hear);
  scroll.addEventListener("touchmove", byHandOff, hear);
  scroll.addEventListener("keydown", (/** @type {any} */ e) => { if (SCROLL_KEYS.has(e.key)) byHandOff(e); }, { signal: ears.signal });
  scroll.addEventListener("pointerdown", (/** @type {any} */ e) => { if (e.target === scroll) byHand(); }, { signal: ears.signal });
  // The canvas moved by hand (the owner's of 11-07): pressed and moved it pans — both ways in its own scroller, a
  // workspace the window's height since the owner's of 11-10 — and the wheel over it zooms about the pointer. The page
  // draws it anew as the work moves, the
  // canvas drawn anew with it: a drag holds the draws until it ends, and one asked meanwhile comes then. Beside the chat
  // the graph is a rail with no canvas: no wheel of its scroller waits on a listener there.
  let holding = false;
  let due = false;
  /** The newest drawing's zoom. */
  let drawnAt = { zoom: 1 };
  /** The canvas drawn at the person's zoom, its scroller where `at` says. @param {number} z @param {{ left: number, top: number }} at */
  const zoomTo = (z, at) => {
    mem.zoom = z;
    mem.pan = { x: at.left, y: at.top, z };
    byHand();
    paint();
  };
  /**
   * The zoom bar's − and +: about the canvas's middle, the point there staying there, as the wheel's about the pointer
   * (the review of 67038d835: they sent it back to its start); a canvas not laid out yet opens at its start.
   * @param {number} z
   */
  const zoomMid = (z) => {
    const v = viewport;
    const box = v?.getBoundingClientRect?.();
    const size = v?.querySelector?.(".tg-canvas-size")?.getBoundingClientRect?.();
    if (!box || !size) {
      mem.zoom = z;
      return void paint();
    }
    zoomTo(z, zoomAround({ z: drawnAt.zoom, z2: z, x: box.left + (Number(v.clientWidth) || 0) / 2, y: box.top + (Number(v.clientHeight) || 0) / 2, view: box, size }));
  };
  if (!ctx.pane) armCanvas(scroll, {
    view: () => viewport,
    inCanvas: (t) => !!viewport && t?.closest?.(".tg-canvas-view") === viewport,
    zoom: () => drawnAt.zoom,
    setZoom: zoomTo,
    hold: (on) => {
      holding = on;
      if (on || !due) return;
      due = false;
      paint();
    },
    // Where it was moved to, kept as it goes: a draw after the drag puts it back.
    moved: () => {
      byHand();
      if (viewport) mem.pan = { x: Number(viewport.scrollLeft) || 0, y: Number(viewport.scrollTop) || 0, z: drawnAt.zoom };
    },
    ...(o.win ? { win: o.win } : {}),
  });
  /**
   * The room the page gives the drawing, px: the scroller's width less its padding — all of it, the canvas a
   * workspace (the owner's of 11-10: it stopped at 1400 px before); 0 until it is laid out.
   */
  const room = () => Math.max(0, (Number(scroll.clientWidth) || 0) - (ctx.pane ? 24 : 40));
  /** Whether the page has been on screen: once it has and is no longer, it draws no more (`gone`). */
  let shown = false;
  const gone = () => {
    if (scroll.isConnected) shown = true;
    return shown && scroll.isConnected === false;
  };
  // The room changes: where it would place the card or Fit's zoom otherwise, the page draws again. The canvas is watched
  // too: its height moves with no draw of the page's — Still open's own list opened, a picture kept behind the graph
  // loaded (the review of d5aa58d31).
  /** @type {any} */
  let watch = null;
  /** The canvas watched now. @type {any} */
  let watched = null;
  if (typeof ResizeObserver === "function") {
    letGoneGo();
    /** @type {{ watch: ResizeObserver, gone: () => boolean, page: Element, ears: AbortController }} */
    let mine;
    watch = new ResizeObserver(() => {
      // A page off screen is never put back (its host draws a new one): it watches no more.
      if (gone()) {
        watches.delete(mine);
        return watch.disconnect();
      }
      if (pageOf(d, mem.older).shows === "graph") paint();
    });
    watches.add((mine = { watch, gone, page: scroll, ears }));
    watch.observe(/** @type {any} */ (scroll));
  }
  /**
   * The newest drawing's canvas watched, the one it replaced no more — from the next frame: a drawing made in the
   * observer's own pass (a re-fit) asked for a notice it cannot give there ("ResizeObserver loop completed with
   * undelivered notifications", an error event on the window).
   */
  const watchCanvas = () => {
    if (!watch || viewport === watched) return;
    if (watched) watch.unobserve(watched);
    const v = (watched = viewport);
    if (!v) return;
    const next = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (/** @type {() => void} */ fn) => setTimeout(fn, 16);
    next(() => { if (watched === v && !gone()) watch.observe(v); });
  };

  /**
   * Copy plan (D1-6): what the page shows — the graph in words, or the checklist.
   * @param {() => string} text
   */
  const copyBtn = (text) =>
    mk("button", {
      class: "tg-ib",
      type: "button",
      title: "Copy plan: the tasks, their needs and states, as text",
      "aria-label": "Copy plan",
      html: ICONS.copy,
      onclick: () => {
        const t = text();
        if (!t) return;
        navigator.clipboard.writeText(t).then(() => toast("Plan copied")).catch(() => toast("Copy failed", "err"));
      },
    });
  /** Beside the chat (D11, D12): the page into the right bar, next to the conversation; none beside the chat itself. */
  const besideBtn = () =>
    ctx.toSide && !ctx.pane
      ? mk("button", { class: "tg-act tg-beside", type: "button", title: "Beside the chat: the plan goes into the right bar, next to the conversation, and stays there while you chat", onclick: () => ctx.toSide?.() },
          mk("span", { class: "tg-act-ic", "aria-hidden": "true", html: ICONS.panelRight }), "Beside the chat")
      : null;
  /**
   * What of the plan is at work on its sub-agents — a task they run, a review, a merge, a command —: a carry waits for
   * it, as the session's refusal says (the review of 58cfe9b31). @param {any} g
   */
  const subAgentsAtWork = (g) => (g.tasks || []).some((/** @type {any} */ t) => (t.state === "running" && t.by !== "you") || t.state === "review" || t.state === "merging");
  /**
   * Continue in a new chat (piece E): the chat forked at its newest turn, its open plan carried into the fork — offered
   * on the tab while the plan is open and nothing of the chat's runs. @param {any} g  the graph drawn
   */
  const carryBtn = (g) =>
    ctx.carry && !ctx.pane && g && !g.closed && g.counts.total - g.counts.dropped - g.counts.done - g.counts.checking > 0 && !d.atWork && !subAgentsAtWork(g)
      ? mk("button", { class: "tg-act tg-carry", type: "button", title: "Continue in a new chat: a fork of this chat at its newest turn takes the plan — its tasks, and the notes and files kept behind them — and it closes here", onclick: () => ctx.carry?.(g.counts.total - g.counts.dropped) },
          mk("span", { class: "tg-act-ic", "aria-hidden": "true", html: ICONS.gitFork }), "Continue in a new chat")
      : null;
  /** The checklist as text. */
  const checklistText = () => d.plan.map((/** @type {any} */ p) => `[${p.status === "done" ? "x" : " "}] ${p.text}`).join("\n");

  /**
   * What the graph keeps behind its tasks (HarnessV4_TaskNotes_Plan E33), for the chosen task's card and the graph's
   * own: each list asked of the session once a graph rev, a note or a text file opened read whole — each answer that
   * lands draws the view again (`mem.keptRev`); a note read whole for its card (a paused task's checkpoint) once.
   * @returns {import("./task-graph.js").KeptPane | null}
   */
  const keptPane = () => {
    const chain = c?.chainId;
    if (!chain) return null;
    const rev = Number(d.graph?.rev) || 0;
    if (!mem.kept || mem.kept.rev !== rev) mem.kept = { rev, lists: new Map(), notes: new Map(), graph: mem.kept?.graph || false };
    const k = mem.kept;
    /** @param {string | null} task @param {Record<string, string>} [more] */
    const path = (task, more = {}) => `/sessions/${encodeURIComponent(chain)}/graph/kept?${new URLSearchParams({ ...(task ? { task } : {}), ...more })}`;
    const landed = () => { mem.keptRev = (mem.keptRev || 0) + 1; paint(); };
    /** @param {string | null} task @param {string} name */
    const key = (task, name) => `${task || ""}\n${name}`;
    /** A note's words, read whole. @param {string | null} task @param {string} name */
    const noteText = (task, name) => ask(path(task, { note: name })).then((/** @type {any} */ r) => String(r.note?.text ?? ""));
    return {
      of: (task) => {
        const had = k.lists.get(task || "");
        if (had) return had;
        const s = { list: /** @type {any} */ (null), error: /** @type {string | null} */ (null) };
        k.lists.set(task || "", s);
        ask(path(task))
          .then((/** @type {any} */ r) => { s.list = { notes: r.notes || [], files: r.files || [] }; })
          .catch((/** @type {any} */ e) => { s.error = String(e?.message || e); })
          .finally(landed);
        return s;
      },
      // Read whole in the reader, a sheet over the page that the view's draws leave be (11-06).
      onOpen: (task, name, kind, meta) => {
        const t = task ? d.graph?.tasks?.find((/** @type {any} */ x) => x.id === task) : null;
        openReader({
          name,
          kind,
          sub: `${meta} · ${task ? `behind ${task}${t?.name ? ` "${t.name}"` : ""}` : "behind the graph"}`,
          load: () => kind === "note"
            ? noteText(task, name)
            : fetch(`/api${path(task, { file: name })}`, { headers: { "x-filament-ui": "1" } }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} ${r.statusText}`)))),
          ...(o.h ? { mk: o.h } : {}),
          ...(o.sheet ? { sheet: o.sheet } : {}),
        });
      },
      fileUrl: (task, name) => `/api${path(task, { file: name })}`,
      graphShown: !!k.graph,
      onGraph: () => { k.graph = !k.graph; landed(); },
      note: (task, title) => {
        const id = key(task, title);
        const had = k.notes.get(id);
        if (had) return had;
        const s = { text: /** @type {string | null} */ (null), error: /** @type {string | null} */ (null) };
        k.notes.set(id, s);
        noteText(task, title).then((text) => { s.text = text; }).catch((/** @type {any} */ e) => { s.error = String(e?.message || e); }).finally(landed);
        return s;
      },
    };
  };

  /**
   * A done task's hunt (UX9): one model chip for the view — moved into the chosen task's card at each draw, so a picker
   * open over it stays put — holding the chat's pick; Hunt bugs starts a Reviewer once at a time per task.
   * @type {any}
   */
  let huntPick = null;
  /**
   * A model chip on the chat's pick, for the card or the right-click popup: each has its own, the card's moved in at
   * each draw and the popup's standing in it while it is open.
   * @param {() => any} self  the chip itself, which shows the pick
   */
  const huntChip = (self) => {
    const pick = (o.modelSelect || createModelSelect)({
      onChange: (name) => { mem.huntModel = name; self()?.set(name); paint(); },
      onUseDefault: () => { mem.huntModel = ""; self()?.set(""); paint(); },
      defaultDesc: "This chat's rows for the Reviewer, else its own models, else this chat's list, else the main agent's model",
      blank: "The Reviewer's model",
    });
    pick.el.setAttribute("aria-label", "The hunting Reviewer runs on");
    return pick;
  };
  /** @param {any} pick @param {PlanHunt} io */
  const fillChip = (pick, io) => {
    pick.setModels(io.models() || []);
    pick.setFamilies(io.families?.() || []);
    pick.setAccounts(io.accounts?.() || []);
    pick.set(mem.huntModel);
  };
  /** The chat's hunting Reviewers as its list says them, each with its task and how it stands: what a draw shows of them. */
  const listedHunters = () => (ctx.hunt?.hunters && c?.chainId ? ctx.hunt.hunters(c.chainId) : []).map((r) => [r.id, r.hunts, r.status]);
  /**
   * The Reviewers sent to hunt from each task (UX9): the chat's list's — which a reload and a restart keep — then those
   * started here that the list has not said yet; oldest first.
   * @returns {Map<string, import("./task-graph.js").Hunter[]>}
   */
  const firedByTask = () => {
    const rows = ctx.hunt?.hunters && c?.chainId ? ctx.hunt.hunters(c.chainId) : [];
    /** @type {Map<string, import("./task-graph.js").Hunter[]>} */
    const out = new Map();
    /** @param {string} task @param {import("./task-graph.js").Hunter} s */
    const add = (task, s) => out.set(task, [...(out.get(task) || []), s]);
    for (const r of rows) {
      if (!r.hunts) continue;
      add(r.hunts, { agent: r.id, name: r.card?.name || "Reviewer", model: r.model, at: Number(r.startedAt) || 0, ...(r.status === "running" ? { running: true } : { ended: statusWord(r.status).toLowerCase() }) });
    }
    for (const [task, list] of mem.hunts) for (const s of list) if (!rows.some((r) => r.id === s.agent)) add(task, s);
    for (const list of out.values()) list.sort((a, b) => a.at - b.at);
    return out;
  };
  /**
   * Start a Reviewer hunting a done task, once at a time per task, on the chat's pick; `then` hears whether it started (the
   * page said why where it did not).
   * @param {any} t @param {(started: boolean) => void} [then]
   */
  const huntStart = (t, then = () => {}) => {
    const io = ctx.hunt;
    if (!io || mem.hunting.has(t.id)) return;
    mem.hunting.add(t.id);
    paint();
    io.start(t, mem.huntModel)
      .then((r) => {
        if (r) mem.hunts.set(t.id, [...(mem.hunts.get(t.id) || []), { ...r, at: clock() }]);
        then(!!r);
      })
      .catch(() => then(false))
      .finally(() => { mem.hunting.delete(t.id); paint(); });
  };
  /** @returns {import("./task-graph.js").HuntPane | null} */
  const huntPane = () => {
    const io = ctx.hunt;
    if (!io || !c?.chainId) return null;
    if (!huntPick) huntPick = huntChip(() => huntPick);
    fillChip(huntPick, io);
    const fired = firedByTask();
    return {
      picker: huntPick.el,
      busy: (id) => mem.hunting.has(id),
      started: (id) => fired.get(id) || [],
      onHunt: (t) => huntStart(t),
      onMenu: (t, el) => openHuntPop(t, el, fired.get(t.id) || []),
    };
  };

  /** The right-click popup's own chip, made once. @type {any} */
  let popPick = null;
  /** The right-click popup while it is open. @type {{ close: () => void } | null} */
  let pop = null;
  /**
   * The right-click popup on a done task's box (UX9, the owner's of 10-29): its Hunt for bugs where the box is — the card
   * may be folded under a narrow graph, or not open — its title, the model chip on the chat's pick, Hunt bugs (Hunt again
   * while a Reviewer sent to hunt from it runs), and those Reviewers. Esc, a press outside it or a start that went through
   * closes it; a refused one gives the button back, the page having said why.
   * @param {any} t @param {any} el  its box @param {import("./task-graph.js").Hunter[]} fired
   */
  const openHuntPop = (t, el, fired) => {
    const io = ctx.hunt;
    if (!io) return;
    pop?.close();
    if (!popPick) popPick = huntChip(() => popPick);
    fillChip(popPick, io);
    const close = () => pop?.close();
    const go = mk("button", { class: "tg-act is-primary", type: "button", title: huntGoTitle(t.id), ...(mem.hunting.has(t.id) ? { disabled: "" } : {}) }, huntGoWords(mem.hunting.has(t.id), fired));
    go.addEventListener("click", () => {
      if (mem.hunting.has(t.id)) return;
      go.setAttribute("disabled", "");
      go.replaceChildren(huntGoWords(true, fired));
      huntStart(t, (started) => {
        if (started) return close();
        go.removeAttribute("disabled");
        go.replaceChildren(huntGoWords(false, fired));
      });
    });
    const still = huntBusyWords(t.id, fired);
    const content = mk("div", { class: "tg-hunt-pop" },
      mk("div", { class: "tg-hunt-pop-h" }, mk("span", { class: "tg-hunt-pop-ic", "aria-hidden": "true", html: ICONS.bug }), mk("span", { class: "tg-hunt-pop-t" }, `Hunt for bugs in ${t.id}`)),
      mk("p", { class: "tg-hunt-pop-name" }, t.name),
      still ? mk("p", { class: "tg-hunt-busy" }, still) : null,
      mk("div", { class: "tg-hunt-acts" }, popPick.el, go),
      mk("p", { class: "tg-card-quiet" }, huntWhat(t.id, crewWords(d.crew).planner)),
      ...fired.map((s) => hunterLine(mk, s, clock(), ctx.openAgent ? (id) => { close(); ctx.openAgent?.(id); } : null)));
    // Laid over the box, in the view's own frame: the popover stands under it as under any trigger.
    const box = el?.getBoundingClientRect?.();
    const frame = viewEl.getBoundingClientRect?.();
    if (box && frame) Object.assign(huntAnchor.style, { top: `${box.top - frame.top}px`, left: `${box.left - frame.left}px`, width: `${box.width}px`, height: `${box.height}px` });
    const opened = (o.popover || popover)(huntAnchor, content, { side: "bottom", align: "start", width: 340, label: `Hunt for bugs in ${t.id}`, onClose: () => { if (pop === opened) pop = null; } });
    pop = opened;
    go.focus?.();
  };

  /**
   * The offer's press (10-28): the side-run sheet for the tasks it named — its Run starts them on sub-agents, its Ask your
   * agent instead sends the person's own sentence and the offer says so; with no sheet to open, that sentence at once.
   * @param {string[]} ids
   */
  const openSide = (ids) => {
    const io = ctx.sideRun;
    // The tasks the sentence names — those ticked in the sheet (the Hunter's of 10-28: an untick still said all).
    const asked = ctx.send
      ? (/** @type {string} */ text, /** @type {string[]} */ named = ids) => {
          ctx.send?.(text);
          mem.sideAsked = { ids: [...named], at: clock() };
          paint();
        }
      : null;
    if (!io || !c?.chainId) return asked?.(askSentence(ids), ids);
    (o.sideSheet || openSideRunSheet)({
      chainId: c.chainId,
      ids,
      tasks: d.graph?.tasks || [],
      model: io.model(),
      models: io.models,
      families: io.families,
      accounts: io.accounts,
      ask: asked,
      started: ({ ids: went, later, refused }) => toast(sideStartedWords(went, later, refused || [])),
    });
  };

  /**
   * The graph drawn with what the view keeps: the chosen task, the folds, the hunt boxes opened, the canvas's zoom and
   * where it was panned, the cards' folded parts, the tasks just done.
   * @param {Map<string, number>} justDone
   */
  const graphEl = (justDone) => {
    const g = drawGraph(d.graph, {
      h: mk,
      chosen: chosenNow(),
      justDone,
      // No card opens on its own, on the tab as beside the chat (the owner's of 11-11: "it should show un selected"): the
      // page's own pick (D17) is the task the view follows into sight, its card the person's to open; choosing the open
      // one again closes it (D14), on the tab the task kept in sight as the canvas narrows or widens (`follow`).
      autoPick: false,
      onChoose: (id) => {
        choose(chosenNow() === id ? null : id);
        pressedId = id;
        paint();
      },
      popped,
      now: clock(),
      onRunLog: ctx.openRunLog || null,
      progress: c?.taskProgress || null,
      onOpenAgent: ctx.openAgent || null,
      onReview: ctx.reviewAgent || null,
      onSendBack: ctx.sendBack || null,
      // A plan that waits for the person's Approve (11-06): the callout's Approve sends it, as the card's does — once the
      // agent's turn has ended and no question of its waits: sent before, it would be a note into the turn, or the
      // question's answer (the review of c9eb95f24).
      onApprove: ctx.send && !d.atWork && !(c?.turns || []).at(-1)?.paused ? () => ctx.send?.(PLAN_GO_TEXT) : null,
      approveLater: !!ctx.send,
      crew: d.crew,
      members: d.members,
      shippedCrew: d.shippedCrew,
      atWork: d.atWork,
      kept: keptPane(),
      hunt: huntPane(),
      width: room(),
      height: mem.canvasH || null,
      font: fontSize(),
      pane: !!ctx.pane,
      fold: { open: mem.foldOpen, onToggle: () => { mem.foldOpen = !mem.foldOpen; paint(); } },
      hunts: {
        open: (id) => mem.opened.has(id),
        // A fix chosen holds its box open: folded by the person, the box lets that choice go too.
        toggle: (id) => {
          const fired = ctx.hunt ? firedByTask() : new Map();
          const inside = (groupsOf(d.graph.tasks, (x) => !!fired.get(x)?.length).get(id) || []).includes(/** @type {string} */ (chosenNow()));
          if (mem.opened.has(id) || inside) {
            mem.opened.delete(id);
            if (inside) choose(null);
          } else mem.opened.add(id);
          paint();
        },
      },
      // A plan's step as the person left it (11-06): folded by them, a sub-task chosen in it lets that choice go too.
      steps: {
        open: (id) => mem.steps.get(id) ?? null,
        toggle: (id, folded) => {
          mem.steps.set(id, folded);
          if (!folded && d.graph.tasks.some((/** @type {any} */ t) => t.id === chosenNow() && t.under === id)) choose(null);
          paint();
        },
      },
      // Fit as far as it reads until the person zooms or presses Fit, kept for the chat; − and + about the canvas's
      // middle, Fit from its start; a pan kept as it goes, drawing nothing.
      zoom: { z: mem.zoom, set: (z) => (typeof z === "number" ? zoomMid(z) : void ((mem.zoom = z), paint())) },
      // The canvas's layout as the person left it (the owner's of 11-14), kept for the chat — the order for the graph it
      // was found on, a new plan laid out afresh — the rail's steps in the same order: turned, the canvas opens at its
      // start and brings the task chosen, else the one at work, into sight; Rearrange's words a moment, then gone.
      arrange: {
        dir: mem.dir,
        order: orderNow(),
        said: mem.said && clock() - mem.said.at < SAID_MS ? mem.said.words : null,
        onDir: (dir) => {
          Object.assign(mem, { dir, pan: null, hand: false });
          pressedId = chosenNow() || current?.id || null;
          paint();
        },
        onRearrange: (rows, words) => {
          const said = { words, at: clock() };
          Object.assign(mem, { order: { of: d.graph.startedAt ?? null, rows }, said });
          paint();
          unsay(said);
        },
      },
      pan: { at: mem.pan, set: (at) => { mem.pan = at; } },
      more: { open: (id) => mem.more.has(id), toggle: (id) => { if (!mem.more.delete(id)) mem.more.add(id); paint(); } },
      tools: ctx.pane ? [] : [copyBtn(() => {
        const fired = ctx.hunt ? firedByTask() : new Map();
        return planText(d.graph, c?.taskProgress || null, (x) => !!fired.get(x)?.length, orderNow());
      }), besideBtn(), carryBtn(d.graph)].filter(Boolean),
      // A plan carried on in a new chat (piece E): its close opens that chat.
      onOpenChain: ctx.openChain || null,
      // The offer's button opens the side-run sheet (10-28); only the agent's own tasks are offered.
      onSideBySide: (ctx.sideRun || ctx.send) && d.crew === "agent" ? openSide : null,
      sideAsked: mem.sideAsked || null,
    });
    fit = g.fit;
    return g;
  };
  /** The task just done that the next draw brings into sight, and when (`celebrate`). @type {{ id: string, at: number } | null} */
  let doneWanted = null;
  /** Until when the view stays on a task just done, by the clock; and the newest stay's number. */
  let stayTill = 0;
  let stays = 0;
  /** The newest draw's task the view follows. @type {{ id: string, el: any } | null} */
  let current = null;
  /** The task the person pressed, which the next draw keeps in sight. @type {string | null} */
  let pressedId = null;
  /** The newest draw's canvas scroller, none on the rail. @type {any} */
  let viewport = null;
  /**
   * A task brought into sight: in the canvas first, both ways, kept where it was panned to; then down the page's own
   * scroller where the canvas stands past it — the rail beside the chat in the page's alone. @param {any} el
   */
  const bring = (el) => {
    panTo(el);
    reveal(scroll, el);
  };
  /** A task brought into sight in the canvas alone, both ways, kept where it was panned to. @param {any} el */
  const panTo = (el) => {
    if (!viewport) return;
    reveal(viewport, el);
    revealSideways(viewport, el);
    mem.pan = { x: Number(viewport.scrollLeft) || 0, y: Number(viewport.scrollTop) || 0, z: drawnAt.zoom };
  };
  /**
   * The work moves down as it goes, and a long plan runs past the view: a task the view follows anew — the card's, else
   * the work's own (the page's own pick, D17), the developer having picked none — or one chosen from elsewhere
   * (`reveal`) is scrolled into sight by the least move that shows it, once, so a scroll of the page's own holds until
   * the view's choice moves on. A scroll of the person's own holds it on (the owner's of 11-04: "keep the current task in
   * focus if user have not scrolled the list itself") until the work passes a task done (`paintNow`), and while they
   * are at the view. A task just done (`celebrate`) is brought into sight however they scrolled, unless they are at the
   * view (the owner's of 11-04: "or agent decides to mark the task done then bring that task in focus again"); the view
   * stays on it a moment — a later one's stay its own — then follows the work on. A view not laid out (it is hidden)
   * follows nothing, and lets the task just done go: shown again later, it does not jump back to it. Only the view's
   * scroller moves (`reveal`).
   *
   * A showing's first draw laid out goes to the running task that started last (`startedLast`, the owner's of 11-11) —
   * its line, a sub-task's own in its step's box, else the row or strip that folds it — whatever the view followed or
   * the person scrolled in a showing before: that scroll holds the view no longer, and the task the view follows is
   * taken as followed, so the next draw stays there and the view moves on as the work does. With no task running it
   * follows as any draw does, from where it was left; so does one opened on a task chosen from elsewhere (`reveal`). On
   * the tab, a task the person pressed stays in sight as its card opens or closes beside the canvas, which narrows or
   * widens, Fit's zoom with it: the canvas's least move that shows it (`panTo`), the page's scroll left as the person
   * has it, and that draw follows nothing else.
   * @param {{ id: string, el: any } | null} cur @param {(id: string) => any} at  where a task stands now
   * @param {string | null} chosen  the developer's pick: the view follows the work away from it only to a task just done
   */
  const follow = (cur, at, chosen) => {
    current = cur;
    const done = doneWanted && clock() - doneWanted.at < JUST_DONE_MS ? doneWanted.id : null;
    doneWanted = null;
    if (!(Number(scroll.clientHeight) > 0)) return;
    const anew = opening;
    opening = false;
    const press = pressedId && viewport ? at(pressedId) : null;
    pressedId = null;
    if (press) {
      panTo(press);
      if (cur) mem.shown = cur.id;
      return;
    }
    const el = done ? at(done) : null;
    if (el && !busy()) {
      // The peek (`ctx.stay`) holds the task done: the work's own first, so the least move that shows the task done
      // leaves it in sight beside it where both fit. The work is left to be shown where the plan is opened next.
      if (ctx.stay) {
        if (cur?.el && cur.id !== done) bring(cur.el);
        bring(el);
        mem.scroll = scroll.scrollTop;
        mem.hand = false;
        stayTill = Infinity;
        ++stays;
        return;
      }
      bring(el);
      mem.scroll = scroll.scrollTop;
      mem.hand = false;
      if (cur) mem.shown = cur.id;
      stayTill = clock() + DONE_STAY_MS;
      const mine = ++stays;
      later(() => { if (mine === stays) followOn(); }, DONE_STAY_MS);
      return;
    }
    const last = anew && !mem.reveal ? startedLast(d.graph) : null;
    const lastEl = last ? at(last.id) : null;
    if (lastEl) {
      bring(lastEl);
      mem.scroll = scroll.scrollTop;
      mem.hand = false;
      if (cur) mem.shown = cur.id;
      return;
    }
    if (!cur || (cur.id === mem.shown && !mem.reveal)) return;
    if (ctx.stay && clock() < stayTill && !mem.reveal) return;
    mem.shown = cur.id;
    if (chosen && !mem.reveal) return;
    if (!mem.reveal && (mem.hand || busy() || clock() < stayTill)) return;
    mem.reveal = false;
    bring(cur.el);
    mem.scroll = scroll.scrollTop;
  };
  /** A moment after a task just done: the work it moved on to, brought into sight as the person left the view. */
  const followOn = () => {
    stayTill = 0;
    if (!current || gone() || page.shows !== "graph" || mem.hand || busy() || chosenNow()) return;
    bring(current.el);
    mem.scroll = scroll.scrollTop;
  };
  /** The tasks just done, each with how long ago, ms: marked until JUST_DONE_MS has passed. */
  const freshDone = () => {
    const now = clock();
    for (const [k, at] of mem.justDone) if (now - at >= JUST_DONE_MS) mem.justDone.delete(k);
    return new Map([...mem.justDone].map(([k, at]) => [k, now - at]));
  };
  /**
   * The graph's tasks just done (lib/plan-watch.js, by their ids): each marked a moment where it stands — its box, else
   * the folded row or chip that holds it — and the newest brought into sight (`follow`); its time up, the view draws
   * them unmarked.
   * @param {string[]} ids
   */
  const celebrate = (ids) => {
    if (!ids.length) return;
    const at = clock();
    for (const id of ids) mem.justDone.set(id, at);
    doneWanted = { id: /** @type {string} */ (ids.at(-1)), at };
    drawnKey = "";
    paint();
    later(paint, JUST_DONE_MS);
  };

  /** The dismissed items whose Undo runs, by key: posted, then until the session's answer read again lands. @type {Set<string>} */
  const undoing = new Set();
  /**
   * Undo (the owner's of 11-09): the agent's dismissal of an item taken back, then the session read again — a read on
   * its way began before it, so not shared — and the line drawn among the live ones; a refusal said in an error toast.
   * @param {string} key
   */
  const undismiss = (key) => {
    const chain = c?.chainId;
    if (!chain || undoing.has(key)) return;
    undoing.add(key);
    paint();
    const heard = () => {
      undoing.delete(key);
      paint();
    };
    (o.api || api)(`/sessions/${encodeURIComponent(chain)}/open/undismiss`, { method: "POST", body: { key } })
      .then(() => {
        askAgain(chain);
        if (ctx.held?.()) return heard();
        const since = Date.now();
        viewsAnswer(c, { api: o.api || ((/** @type {string} */ path) => apiShared(path, { since })), onLand: heard });
      })
      .catch((/** @type {any} */ e) => {
        toast(`Undo: ${String(e?.message || e)}`, "err");
        heard();
      });
  };

  /** What the footprint's sheet does now, opened from the card where the chat is in no project (footprint.js `openCleanUp`): "reading", "cleaning", or "". */
  let cleanDoing = "";

  const goalEl = () => {
    const text = d.goal?.slice || d.goal?.text || "";
    if (!d.goal || !text) return null;
    return mk("div", { class: "plan-goal" },
      mk("h4", { class: "plan-goal-title" }, "Goal"),
      mk("div", { class: "plan-goal-card" },
        mk("span", { class: "plan-goal-status" }, String(d.goal.status || "")),
        mk("p", { class: "plan-goal-slice" }, text)));
  };

  /**
   * What is still open in the chat, first on the page and folded (the owner's of 11-05: "a card on the very top that is
   * collapsed by default but can be expanded"), drawn from each item's view (still-open.js `OpenView`; the owner's of
   * 11-10: the agent's lines read "a mess and un explainable"). Its head counts what waits, what runs and what was left
   * behind; open, what waits — a change to review, a question to answer, a failure, a letter — and what runs, a row each
   * with its title, a line under it and one button: its change in Changes (`ctx.reviewAgent`), its sub-agent's thread
   * (`ctx.openAgent`). What was left behind is one line whose button opens the project's Folders and worktrees, where it is
   * tidied — the card removes nothing; where the chat is in no project, the footprint's Clean up…, and only what that
   * takes is said (`tidied`). What the agent dismissed is folded under them, each with Undo (`undismiss`); what was left
   * behind is counted dismissed or not, the agent's dismissal saying only that it need not hear of it again. While the
   * chat's folder is still being read (`reading`) the card says so, and its head says no "nothing" it cannot know yet.
   * How the list works is the ⓘ's tooltip. Opened, the card stays open for the chat, and so does its fold of dismissed
   * items. `width`: the page's own column, the graph's, the checklist's or the empty page's.
   * @param {"graph" | "checklist" | "empty"} width
   */
  const openEl = (width) => {
    if (!d.open) return null;
    const items = openItemsOf(d.open);
    const waiting = items.filter((i) => !i.dismissed && i.view.group === "waiting");
    const running = items.filter((i) => !i.dismissed && i.view.group === "running");
    const left = tidied(items.filter((i) => i.view.group === "left"));
    const gone = items.filter((i) => i.dismissed && i.view.group !== "left");
    const live = waiting.length + running.length;
    // What the agent hears again after its compaction: what waits and runs, and what was left behind it did not dismiss
    // (the reviewer's of 11-10).
    const heard = live > 0 || left.some((i) => !i.dismissed);
    /** Its one button: Review its change in Changes, or its sub-agent's thread — Answer where it asks. @param {OpenItem} it */
    const actOf = (it) => {
      const v = it.view;
      if (!v.agent) return null;
      if (v.act === "review" && ctx.reviewAgent) return mk("button", { class: "pv-open-act", type: "button", title: "Opens its change in Changes, where Apply brings it into your folder", onclick: () => ctx.reviewAgent?.(String(v.agent)) }, "Review");
      if (v.act === "thread" && ctx.openAgent) return mk("button", { class: "pv-open-act", type: "button", title: "Opens the sub-agent's thread", onclick: () => ctx.openAgent?.(String(v.agent)) }, v.tone === "ask" ? "Answer" : "Open");
      return null;
    };
    /** A row: how it stands, its title and the line under it, its button. @param {OpenItem} it @param {any} end */
    const row = (it, end) =>
      mk("li", { class: `pv-open-row is-${it.view.tone}${it.dismissed ? " is-dismissed" : ""}`, "data-key": it.key },
        mk("span", { class: "pv-open-dot", "aria-hidden": "true" }),
        mk("div", { class: "pv-open-text" },
          mk("div", { class: "pv-open-t", title: it.view.title }, it.view.title),
          it.view.detail ? mk("div", { class: "pv-open-d" }, it.view.detail) : null),
        end);
    /** @param {string} name @param {OpenItem[]} list */
    const group = (name, list) =>
      list.length
        ? mk("section", { class: "pv-open-group" },
            mk("h5", { class: "pv-open-gh" }, name, mk("span", { class: "pv-open-gn" }, String(list.length))),
            mk("ul", { class: "pv-open-list" }, ...list.map((i) => row(i, actOf(i)))))
        : null;
    /** Undo, on an item the agent dismissed. @param {OpenItem} it */
    const undoBtn = (it) => {
      const busy = undoing.has(it.key);
      return mk("button", { class: "pv-open-act is-quiet", type: "button", title: "Take the dismissal back: the agent hears of it again", ...(busy ? { disabled: "" } : {}), onclick: () => undismiss(it.key) }, busy ? "Undoing…" : "Undo");
    };
    return mk("details", { class: `pv-open is-${width}`, ...(mem.openShown ? { open: "" } : {}), ontoggle: (/** @type {any} */ e) => {
      const open = !!e.currentTarget?.open;
      if (open === !!mem.openShown) return;
      mem.openShown = open;
      // Opened or folded, it gives the canvas under it less room or more: Fit's zoom is asked again (`measured`).
      paint();
    } },
      mk("summary", { class: "pv-open-head" },
        mk("span", { class: "pv-open-title" }, "Still open"),
        waiting.length ? mk("span", { class: "pv-open-chip is-wait" }, `${waiting.length} waiting`) : null,
        running.length ? mk("span", { class: "pv-open-chip is-run" }, `${running.length} running`) : null,
        // Its rows are not its things (one row says 4 copies): the line under the groups counts them.
        left.length ? mk("span", { class: "pv-open-chip is-left" }, "left behind") : null,
        // What the agent dismissed is still there, its change in Changes (the owner's of 11-10: the card said nothing
        // waits while 35 files did): counted in the head too.
        gone.length ? mk("span", { class: "pv-open-chip is-gone" }, `${gone.length} dismissed`) : null,
        // Nothing, only once the chat's folder was read: before, the card cannot know it (the re-read of 11-11).
        live || left.length || gone.length ? null : mk("span", { class: "pv-open-none" }, d.open.reading ? "reading…" : "nothing"),
        mk("span", { class: "pv-open-grow" }),
        // In the head, a press on it is its tooltip's, never the card's open and close (the reviewer's of 11-10).
        mk("span", { class: "pv-open-info", role: "img", tabindex: "0", "aria-label": OPEN_INFO, title: OPEN_INFO, html: ICONS.info, onclick: (/** @type {Event} */ e) => {
          e.preventDefault();
          e.stopPropagation();
        } })),
      mk("div", { class: "pv-open-body" },
        // Whose compaction it was, as it was: the agent's own, or Filament's fold of the chat (the re-read of 11-11: a
        // fold of Filament's was said as the agent's).
        d.open.told || !heard ? null : mk("p", { class: "pv-open-due" }, d.open.folded ? "Filament compacted this chat's context since the agent last heard this list: Filament tells it again with your next message." : "The agent compacted its context since it last heard this list: Filament tells it again with your next message."),
        group("Waiting", waiting),
        group("Running", running),
        live ? null : mk("p", { class: "pv-open-empty" }, gone.length ? `Nothing is waiting or running that the agent still hears of. It dismissed ${gone.length === 1 ? "one line" : `${gone.length} lines`}, below.` : "Nothing is waiting or running."),
        // Before what was left behind: a change it dismissed still waits for the person's Apply.
        gone.length
          ? mk("details", { class: "pv-open-gone", ...(mem.openGone ? { open: "" } : {}), ontoggle: (/** @type {any} */ e) => { mem.openGone = !!e.currentTarget?.open; } },
              mk("summary", {}, `Dismissed by the agent · ${gone.length}`),
              // A row it dismissed keeps its button beside Undo: a change it dismissed still waits in Changes.
              mk("ul", { class: "pv-open-list" }, ...gone.map((i) => {
                const act = actOf(i);
                return row(i, act ? mk("span", { class: "pv-open-acts" }, act, undoBtn(i)) : undoBtn(i));
              })))
          : null,
        leftEl(left),
        d.open.reading ? mk("p", { class: "pv-open-empty pv-open-reading" }, "Filament is reading what this chat's folder holds: what was left behind may change in a moment.") : null));
  };
  /**
   * What was left behind that the card has a place to tidy from: in a project, all of it — its Folders and worktrees;
   * in none, what the footprint's Clean up… takes — Filament's copies, its routines' branches, a deleted chat's work —
   * where the chat has a folder. A merged worktree or a fork of a chat in no project is tidied nowhere the card can
   * open, so the card says none of it (the re-read of 11-11: "Left behind" with nothing to press).
   * @param {OpenItem[]} left
   */
  const tidied = (left) => (projectOf(c) ? left : c?.cwd ? left.filter((i) => i.view.what === "copies" || i.view.what === "branch" || i.view.what === "deleted") : []);
  /**
   * What was left behind, in one line (the owner's of 11-10: "this thing about cleanup needs to go somewhere proper
   * place"): how many of Filament's copies and how big, the worktrees and branches merged, the forks and the deleted
   * chats' work, each item on hover; its button opens the project's Folders and worktrees, whose Tidy up removes them —
   * the footprint's Clean up… where the chat is in no project (`tidied`), the session read again after a clean.
   * @param {OpenItem[]} left
   */
  const leftEl = (left) => {
    if (!left.length) return null;
    const of = (/** @type {string} */ what) => left.filter((i) => i.view.what === what);
    const copies = of("copies");
    const parts = [
      ...copies.map((i) => `${countOf(Number(i.view.count) || 0, "Filament copy", "Filament copies")}${i.view.size ? ` (${i.view.size})` : ""}`),
      countOf(of("worktree").length, "merged worktree"),
      countOf(of("branch").length, "merged branch", "merged branches"),
      countOf(of("fork").length, "fork of a deleted chat", "forks of deleted chats"),
      countOf(of("deleted").length, "deleted chat's sub-agent's work", "deleted chats' sub-agents' work"),
    ].filter(Boolean);
    const project = projectOf(c);
    const cwd = String(c?.cwd || "");
    const go = project
      ? mk("button", { class: "pv-open-act", type: "button", title: "Opens the project's Folders and worktrees, as its menu in the left bar and ⋯ on its page do: Tidy up removes the merged worktrees with their branches, Clean up… Filament's copies and its routines' branches — nothing goes until you say so", onclick: () => (o.openPlaces || openPlacesIn)(project) }, "Tidy up ›")
      : mk("button", { class: "pv-open-act", type: "button", title: "Filament's footprint in this repository: what goes and what stays, said before anything goes", ...(cleanDoing ? { disabled: "" } : {}),
          onclick: () => void (o.cleanUp || openCleanUp)(cwd, { busy: (now) => { cleanDoing = now; paint(); }, onCleaned: () => { cleanDoing = ""; askAgain(String(c?.chainId || "")); paint(); } }) },
          cleanDoing === "reading" ? "Reading…" : cleanDoing === "cleaning" ? "Cleaning up…" : "Clean up…");
    return mk("div", { class: "pv-open-left" },
      mk("span", { class: "pv-open-left-ic", "aria-hidden": "true", html: ICONS.archive }),
      mk("div", { class: "pv-open-text", title: left.map((i) => `${i.view.title} — ${i.view.detail}`).join("\n") },
        mk("div", { class: "pv-open-t" }, "Left behind"),
        mk("div", { class: "pv-open-d" }, parts.join(" · "))),
      go);
  };

  /** Each checklist item's mark (D19): the graph's — a tick, the turning arc, a ring; blocked said in words. */
  const ITEM = Object.freeze({ done: "done", doing: "running", pending: "waiting", blocked: "waiting" });
  /**
   * With no graph, the checklist on the same page (D19): the same head — a gray list tile, Checklist, how much is done,
   * the session's goal, Copy plan, Beside the chat and Run log — the items in one grouped card with the graph's marks,
   * and when a graph would show instead.
   */
  const checklistEl = () => {
    const done = d.plan.filter((/** @type {any} */ p) => p.status === "done").length;
    // Between the agent's turns nothing works on its item in progress: its arc still, said so, as the graph draws its own
    // task (task-graph.js `betweenTurns`; the review of 67038d835). A team's lead keeps it apart from the chat's turn.
    const still = !d.atWork && d.crew === "agent";
    const goal = d.goal?.slice || d.goal?.text || "";
    return mk("div", { class: `pv-column tg-view${ctx.pane ? " is-pane" : ""}` },
      mk("div", { class: "tg-head" },
        ctx.pane ? null : mk("span", { class: "tg-tile is-gray", "aria-hidden": "true", html: ICONS.listTodo }),
        mk("div", { class: "tg-ht" },
          mk("div", { class: "tg-title" }, mk("span", { class: "tg-title-name" }, "Checklist"), mk("span", { class: "tg-figs" }, `${done} of ${d.plan.length} done`)),
          goal ? mk("div", { class: "tg-goal" }, goal) : null),
        ctx.pane && !ctx.openRunLog ? null : mk("div", { class: "tg-head-acts" }, ...(ctx.pane ? [] : [copyBtn(checklistText), besideBtn()]), ctx.openRunLog ? link(mk, "Run log", ctx.openRunLog) : null)),
      mk("div", { class: "pv-list" }, ...d.plan.map((/** @type {any} */ p) => {
        const st = /** @type {keyof typeof ITEM} */ (Object.hasOwn(ITEM, p.status) ? p.status : "pending");
        return mk("div", { class: `pv-item is-${st}` },
          mk("span", { class: `tg-mark is-${ITEM[st]}${st === "doing" && still ? " is-still" : ""}`, "aria-hidden": "true", html: MARKS[ITEM[st]] }),
          mk("span", { class: "pv-item-text" }, p.text),
          st === "doing" ? mk("span", { class: `pv-item-w${still ? " is-still" : ""}` }, still ? "between turns" : "now") : st === "blocked" ? mk("span", { class: "pv-item-w is-blocked" }, "blocked") : null);
      })),
      mk("p", { class: "pv-quiet" }, `${keeps()} a checklist for work this short. When work has pieces that wait on each other, or could run in parallel, it keeps a task graph — and the graph shows here instead.`),
      page.other ? olderEl() : null,
      goal ? null : goalEl());
  };
  const keeps = () => (d.crew === "team" ? "The lead keeps" : "The agent keeps");
  /** Where the agent keeps a checklist now and the session's graph is from before: a press shows the graph (`pageOf`). */
  const olderEl = () => {
    const n = d.graph.counts;
    return mk("p", { class: "pv-quiet pv-other" },
      `The session's task graph is from before: ${n.done} of ${n.total - n.dropped} done${d.graph.closed ? ", closed" : ""}. `,
      link(mk, "Show the graph", () => { mem.older = true; paint(); }));
  };
  /** The older graph shown: a press goes back to the checklist the agent keeps now. */
  const backEl = () =>
    mk("div", { class: "tg-view pv-back" },
      mk("p", { class: "pv-quiet pv-other" }, `${keeps()} a checklist now; the task graph is from before. `,
        link(mk, "Back to the checklist", () => { mem.older = false; paint(); })));

  /** No plan yet: what a plan is. */
  const emptyEl = () =>
    mk("div", { class: "pv-empty" },
      mk("span", { class: "pv-empty-ic", html: ICONS.listTodo }),
      mk("h3", { class: "pv-empty-title" }, "No plan yet"),
      mk("p", { class: "pv-empty-sub" }, `When the work has steps, ${d.crew === "team" ? "the lead" : "the agent"} writes its plan here as it goes: a checklist for a short straight list, a graph of tasks when its pieces depend on each other or could run in parallel.`),
      goalEl());

  /** A draw made again for the canvas's height just measured: one, never another from it. */
  let refitting = false;
  /**
   * The canvas's height as laid out now, kept for the chat (the owner's of 11-10: Fit both ways): whether it moved.
   * None on the page, or a page hidden, says nothing.
   */
  const measured = () => {
    const h = viewport && viewport.isConnected !== false ? Number(viewport.clientHeight) || 0 : 0;
    if (!(h > 0) || h === mem.canvasH) return false;
    mem.canvasH = h;
    return true;
  };
  // The view's own redraws (the session's answer landing, a choice) keep the focus too (lib/keep-focus.js).
  const paint = () => {
    if (holding) return void (due = true);
    if (!gone()) keepingFocus(body, paintNow);
  };
  /**
   * The page's drawing made of `kids`, the one it replaces taken apart (dom.js `takeApart`): the page draws itself anew
   * at each change, and while the window got no frames each drawing it threw away stayed whole, a task's mark turning in
   * it (the owner's of 11-17). The model chips the page makes once and moves into each drawing come out of it first,
   * whole: taken apart with it, the chip a drawing between two of a done task's left behind came back an empty button
   * (Fable 5.2's review of 11-17). @param {...any} kids
   */
  const drawAs = (...kids) => {
    const was = Array.from(/** @type {any[]} */ (inner.children || []));
    inner.replaceChildren(...kids);
    const kept = [huntPick?.el, popPick?.el].filter(Boolean);
    for (const el of was) {
      if (el.parentNode === inner) continue;
      for (const k of kept) if (k !== el && el.contains?.(k)) k.remove();
      takeApart(el);
    }
  };
  function paintNow() {
    d = read();
    // The run the plan is read from is on its way: nothing yet, or the page as it stands until it lands.
    if (ctx.reading?.()) {
      if (!drawnKey) {
        drawnGraph = null;
        drawAs();
      }
      return;
    }
    // The agent planned on the graph last: the person's Show the graph of an older one has served.
    if (d.planned === "graph") mem.older = false;
    page = pageOf(d, mem.older);
    // The canvas's own height as laid out now, Fit's room down: a window that grew, Still open opened or folded — read
    // while the workspace still holds it (out of it, a canvas is as tall as its drawing: the review of d5aa58d31).
    measured();
    // The graph's page is one workspace the window's height (the owner's of 11-10): the canvas and the card fill what
    // the head leaves (views.css `.pv-inner.is-workspace`). The checklist, the empty page and the rail scroll whole.
    inner.setAttribute("class", page.shows === "graph" && !ctx.pane ? "pv-inner is-workspace" : "pv-inner");
    // What the room and the type would change of the drawing, as the newest drawing would place itself in them.
    const layout = () => (page.shows === "graph" ? JSON.stringify([fit(room(), mem.canvasH || null), fontSize()]) : "");
    const justDone = freshDone();
    const shows = JSON.stringify([d.plan, d.graph, d.goal, d.open, d.early, d.crew, d.atWork, page, chosenNow(), mem.foldOpen, [...mem.opened], [...mem.steps], mem.zoom, mem.dir, mem.order, mem.said?.words || null, [...mem.more], mem.keptRev || 0, mem.huntModel, [...mem.hunts], [...mem.hunting], listedHunters(), mem.sideAsked || null, [...justDone.keys()], [...undoing], mem.openGone || false, cleanDoing, d.open?.items?.some((/** @type {any} */ i) => i.view?.group === "left") ? projectOf(c) : null, Math.floor(clock() / CLOCK_MS)]);
    // The running tasks' newest steps, from the feed, apart: where they alone moved, the drawing as it stands says them.
    const steps = JSON.stringify(c?.taskProgress ? [...c.taskProgress] : null);
    if (shows + layout() === drawnKey) {
      if (steps === drawnSteps) return;
      // A round, a tool: each line's words and tooltip set where they stand (task-graph.js `patch`), and the view follows
      // the work as a drawing made anew would (the owner's of 11-17: the page drew its whole graph again at each step of
      // each agent, some 33,000 elements a minute while six ran). What else they move — a task's drawn state, what one
      // asks you — draws it anew.
      if (drawnGraph?.patch(c?.taskProgress || null)) {
        drawnSteps = steps;
        follow(drawnGraph.shown || drawnGraph.current, drawnGraph.at, chosenNow());
        return;
      }
    }
    drawnKey = shows + layout();
    drawnSteps = steps;
    // The graph's states as this draw shows them: a task whose state changed since the last draw pops, once — in a
    // drawing made again for the canvas's height, the pops of the one it replaces.
    if (!refitting) {
      const changes = stateChanges(mem.states, d.graph);
      mem.states = changes.states;
      popped = changes.changed;
      // The work passed a task done — by the agent's word, a worker's, its checklist's tick: a scroll of the person's
      // own holds the view no longer (`follow`).
      if ([...popped].some((id) => changes.states.get(id) === "done")) mem.hand = false;
    }
    let place = () => {};
    if (page.shows === "graph") {
      const g = graphEl(justDone);
      drawnGraph = g;
      // The drawing just made says how it places itself: the next draw compares with that.
      drawnKey = shows + layout();
      // The canvas sideways as it was left at this zoom, else at its start; then the task the view follows
      // into sight, down the page and across the canvas.
      viewport = g.viewport;
      watchCanvas();
      drawnAt = { zoom: g.zoom };
      place = () => {
        g.restore();
        // The card beside the canvas scrolls itself, drawn anew at each draw: it stays where the person scrolled the
        // chosen task's card to (the review of 67038d835); another task's opens at its top.
        const card = g.inspector;
        const id = g.shown?.id || "";
        if (card) {
          card.scrollTop = mem.inspector?.id === id ? mem.inspector.y : 0;
          card.addEventListener("scroll", () => { mem.inspector = { id, y: Number(card.scrollTop) || 0 }; }, hear);
        }
        follow(g.shown || g.current, g.at, chosenNow());
      };
      // The session's goal under the graph: the tab of the checklist that held it went (E41 P4).
      const goal = goalEl();
      drawAs(...[openEl("graph")].filter(Boolean), ...(page.other ? [backEl()] : []), g.el, ...(goal ? [goal] : []));
      // The canvas on the page says its height at last (its first draw, or one that moved it): where that changes Fit's
      // zoom, the drawing that fits it comes now, once, before anything is placed — the reveal of a task chosen
      // elsewhere and the pan kept are the drawing's that stays (the review of d5aa58d31: placed first, a reveal was
      // spent on the drawing thrown away). The height is kept for the chat, so the page opened again draws to it at once.
      if (!refitting && measured() && shows + layout() !== drawnKey) {
        refitting = true;
        try {
          paintNow();
        } finally {
          refitting = false;
        }
        return;
      }
    } else if (page.shows === "checklist") {
      drawnGraph = null;
      viewport = null;
      watchCanvas();
      drawAs(...[openEl("checklist")].filter(Boolean), checklistEl());
    } else {
      drawnGraph = null;
      viewport = null;
      watchCanvas();
      drawAs(...(d.early ? [] : [openEl("empty"), emptyEl()].filter(Boolean)));
      scroll.scrollTop = 0;
      return;
    }
    // The view's scroll first, as it was left; then the canvas's and the task the view follows.
    scroll.scrollTop = mem.scroll;
    place();
  }

  paint();
  // The peek's pick is chosen from elsewhere for the showing beside the chat that Keep open makes (`reveal`).
  return { paint, celebrate, handOver: () => void (ctx.stay && Object.assign(mem, { chosen: peekPick, reveal: !!peekPick })) };
}
