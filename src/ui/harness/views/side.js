// @ts-check
// The Agents tab (HarnessV4_Tasks E15 step 5; U12, the owner's words of 10-18: "rename the Side to Sub Agents as
// this is what those essentialy are … team workers also go there"; U13-D5, 10-20: the Sub Agents and Teams tabs made
// one): every agent that works for the session, in one place, and every team — the one in charge of the chat in a
// part of its own on top, each on its side by what it needs of you and among that part's agents by when it began (the
// owner's 10-24) — a row with its crew under it, whose pane is the
// team's board or card (views/team.js, `io.teams`); a Teams row at the list's foot opens what a team is and each one. On the left the session's agents by what they need of you (U12-D3) — Needs you, Working, Done, the older done
// under Earlier — each a row: its card's face (U12-D4), its name and a tag of who started it (U12-D2), what it was
// asked, the one fact that matters now — while it works, the call it is in — its cost and time; with none yet, what a
// new thread is. The gear beside the list's title opens this chat's own settings for its agents over Library's (the
// owner's of 11-05; proposal_ux §4.7): whom the main agent may ask — the row the Agents pane held —, Who runs on what,
// and the seat (U12-D5; the owner's 10-25): Agents run on, this chat's list in force on a chip tagged with whose it is,
// a line that says whose it is, Use the default where it is the chat's own, and a meter of its agents at work; a team's
// seats are set in the Team tab alone (the owner's word of 10-18). The sheet is the chat's it opened on: the view
// leaving, or another chat shown, closes it. On the right,
// Threads or Watch all: Threads is the open one's thread, the part a thread's pane beside the chat draws too
// (panes/thread.js, subagent-viewer.js): what it was shown, each question and its work as it streams, the changes it
// made with Apply, and its own box — one of a coding agent's own is a thread to read, with no box (AG-153); one that
// failed offers Retry, its question asked again in that same thread (the owner's word of 10-24) — or, on
// Start…, the launcher (U12-D6; U13 W3, regrouped): the quick starts as tiles — Catch me up, Review my last change,
// Try it in a copy — chosen and never sent: Catch me up's puts its question in the box, and Send asks it (the owner's
// word of 10-18: a press starts nothing); the box, who gets the words an @ chip in it whose menu groups the saved
// agents and the teams, a team with its crown, and for a team how beside it — On the side or In charge, each of which
// opens the team's Brief, where Send starts it (an agent has no how: it runs at its card's level, OA1); under the box an agent's chips (U12-D7)
// — its model, its effort, what it sees with each size, what it may do (only lower), where its answer goes, More —
// Enhance, pictures and files, Enter. The main agent's
// composer is not here (AG-100), nor any bar of the main agent's: its Stop there stopped the main agent when the owner
// meant an agent's thread (the owner's word of 10-29) — the chat has its own Stop. Watch all
// (side-watch.js) is every agent at work at once, a tile each. Nothing a thread says reaches the main agent unless you
// send it. The view
// is built when it first shows and painted in place after: the list's rows are drawn again on a pulse, the thread only
// when another opens, the box never under the cursor.
import { h, morphChildren, placeChildren, setHtml } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { menu, sheet } from "../lib/ui.js";
import { keepingFocus } from "../lib/keep-focus.js";
import { guestConversation, subagentConversation } from "../subagent-viewer.js";
import { guestOf } from "../lib/guest-thread.js";
import { createModelSelect } from "../composer/model.js";
import { createAttachments, pdfRefused } from "../composer/attachments.js";
import { createPoolChip } from "../widgets/pool.js";
import { createRunsOn } from "../widgets/runs-on.js";
import { answerControls, answersKey, askWhat, questionOf } from "../conversation/decisions.js";
import { askWords, yourAsk } from "../lib/team.js";
import { prettyModel } from "../lib/families.js";
import { cardIcon } from "../lib/agent-cards.js";
import { WAYS, chargeWords, leadLook, usualWay } from "../lib/brief.js";
import { possessive } from "../lib/labels.js";
import { fmt } from "../../lib/format.js";
import { WORDS } from "../lib/words.js";
import { comboOf } from "../shortcuts.js";
import { group, segmented } from "../widgets/kit.js";
import { mayAskRow, chatParallelRow } from "../widgets/may-ask.js";
import { createWatchAll } from "./side-watch.js";
import { FLOW_HOME } from "../lib/flow.js";
import { state } from "../state.js";
import { agentsPage, teamsOn } from "../../lib/teams-on.js";
import { WORK_ITEM } from "../lib/agent-work.js";
import { markFailureSeen } from "../lib/failures-seen.js";
import {
  BTW_START, DONE_SHOWN, NO_SESSION_YET, TEAM_HOME, answerKey, cardGroups, chosen, draftOn, effortChoices, enhanceWords, exchangeKey, guestRow, isGuest, isTeamItem, launchBody, lineParts, lineStop, mayChoices,
  noPatchWhy, quickStarts, rowIcon, seatsFrom, seatsLine, seesChoices, shortcutsOf, sideBadge, sideGroups, sideRow, teamLine, unopened, watchRows, whoTag, withTeams,
  dropOf,
} from "../lib/side.js";

/** @typedef {typeof h} Mk */
/** @typedef {import("../lib/side.js").SideDraft} SideDraft */
/**
 * The teams' part of the tab — the host's (U13-D5): `el` the pane a team's row shows (the Team view), `items` the
 * teams as rows, `paint` that pane for a row's id, `home` whether the list's foot offers the Teams row (a team's own
 * chat sends no team of its own), `flows` whether it offers the Flows row (HarnessV4_Flow_Plan F5): a flow drawn by
 * hand or from a saved one. A flow's own row is among the items. `work`: the words of the row of your agent's own work,
 * drawn as a flow (HarnessV4_OneAgent_Plan L47), null while it sent none.
 * @typedef {{ el: any, items: () => import("../lib/side.js").TeamItem[], paint: (chat: any, id: string) => void, home: () => boolean, flows?: () => boolean,
 *   work?: () => string | null }} TeamsPart
 */
/**
 * A thread drawn in the tab. `followUp`: its box takes the keys — null for a thread with no box of its own.
 * @typedef {{ id: string, chain: string, conv: { head: any, body: any, foot: any, mount: (scrolls: any) => void, close: () => void },
 *   followUp: (() => void) | null, askKey: string | null }} Shown
 */

/**
 * What the Agents tab reads and does — the host's.
 * @typedef {{
 *   rows: () => import("../lib/subagents.js").SubagentRow[],
 *   own: () => import("../lib/subagents.js").GuestRow[],
 *   chainId: () => string,
 *   cards: () => import("../lib/agent-cards.js").AgentCard[],
 *   starts: () => import("../lib/subagents.js").StartRow[],
 *   facts: () => import("../lib/side.js").SideFacts,
 *   readSizes: (patches: boolean) => void,
 *   models: () => any[],
 *   families?: () => any[],
 *   accounts?: () => any[],
 *   pool: () => { rows: unknown, source: string, main: string, most?: number | null } | null,
 *   poolFacts?: import("../widgets/pool.js").PoolChipIO["facts"],
 *   setPool: (rows: import("../lib/pool.js").PoolRow[] | null) => void,
 *   whoRuns?: () => import("../widgets/runs-on.js").RunsOnIO | null,
 *   priceOf: (model: string) => string,
 *   fallsToMain: () => boolean,
 *   launch: (body: ReturnType<typeof launchBody> | { start: string, prompt: string, images?: any[] }) => Promise<import("../lib/subagents.js").SubagentRow>,
 *   enhance: (prompt: string, o: { readOnly?: boolean, view?: string }) => Promise<import("../lib/subagents.js").Enhanced>,
 *   retry?: (id: string) => Promise<import("../lib/subagents.js").SubagentRow>,
 *   cache: () => import("../lib/subagents.js").CacheState,
 *   modelProblem: (model: string) => Promise<string | null>,
 *   answer: (id: string, a: import("../conversation/decisions.js").WorkerAnswer) => Promise<boolean>,
 *   always: (id: string, offer: import("../lib/labels.js").Offer, ask: number | null) => Promise<boolean>,
 *   mainDoor: import("../subagent-viewer.js").MainDoor,
 *   beside: () => string[],
 *   openBeside?: (id: string) => void,
 *   stop?: (id: string) => void,
 *   remove?: (d: import("../lib/side.js").ThreadDrop) => Promise<boolean>,
 *   mayAsk?: () => import("../widgets/may-ask.js").MayAsk | null,
 *   chatParallel?: () => { off: () => void } | null,
 *   agentsOwn?: () => boolean,
 *   resetAgents?: () => void,
 *   openLibrary?: () => void,
 *   held: import("../lib/held-asks.js").HeldAsks | null,
 *   toast: (msg: string, kind?: string) => void,
 *   offered: { seen: () => boolean, mark: () => void },
 *   teams?: TeamsPart,
 *   teamsList?: () => any[],
 *   brief?: (fill: { team: string, way: "side" | "charge", ask?: string }) => void,
 *   runsOn?: (team: string, pick: { model?: string, workers?: string }) => Promise<import("../lib/beside.js").BesideOn | null>,
 *   lastPicks?: (team: string) => import("../lib/brief.js").Picks | null,
 *   seats?: () => string[],
 *   onPane?: (id: string) => void,
 *   now?: () => number,
 * }} SideIO  `rows`: the open session's agents; `own`: its coding agents' own agents, rows to read; `cards`, `starts`:
 *   your saved agents and the starts' rows;
 *   `families`, `accounts`: the catalogue's families and the coding agents' accounts, which the model picker shows as
 *   the chat's does — prices, levels, a plan's room; `facts`: what the session says of a thread about to start, and
 *   `readSizes` asks the host to read the sizes it
 *   shows (with the two changes' where `patches`); `pool`: the session's seats for sub-agents — the setting's value, its
 *   layer and the main agent's model — or null where there is no session; `poolFacts`: what its rows lend now, for its
 *   editor; `setPool`: the list as its editor left it, or null to clear the session's own; `whoRuns`: Who runs on what's
 *   reading of the session, null where there is none (each of its calls reads the open chat anew); `priceOf`: a model's price
 *   in a line, "" where nobody states one;
 *   `fallsToMain`: no seat is set for sub-agents, so one whose card names none runs on the main agent's;
 *   `launch`: the launch route; `modelProblem`: why a model could not run an agent now, or null; `answer`/`always`: a
 *   thread's waiting call answered; `beside`: the threads in front in the panes
 *   beside the chat; `openBeside`: a thread put there; `stop`: one of Filament's agents stopped; `remove`: a row deleted, the person asked first (the
 *   owner's ask of 10-23) — whether it went; `held`: the words held for agents still at work; `offered`: whether the offer to pick a cheaper model
 *   was used before, kept by the page; `mayAsk`: the gear's row of whom the agent may use, as the page reads and writes
 *   it — null where the chat has none yet; `agentsOwn`: whether anything the gear sets is this chat's own;
 *   `resetAgents`: all of it dropped at once, Library's holding again; `openLibrary`: Library › Agents and teams, where
 *   the defaults are; `teams`: the teams' rows and their pane; `teamsList`: the teams Start… offers in its Who;
 *   `brief`: a team's Brief opened, filled with its way and the box's words — Send there starts it; `runsOn`: what a
 *   team would run on now, as its Brief asks; `lastPicks`: its Brief's picks of its last run in this browser; `seats`:
 *   this chat's models for agents, in order; `onPane`: the pane changed to another row's
 */

const TITLE = "Start…";
const LEAD = "Ask an agent, or send a team. Your agent keeps working, and hears nothing unless you send it.";
/** The same while Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js). */
const LEAD_ALONE = "Ask an agent. Your agent keeps working, and hears nothing unless you send it.";
const FORK_MODEL = "A live copy runs on your agent's model: the cache it reads is that model's";
const FORK_EFFORT = "A live copy thinks as your agent's request it copies: the cache it reads is that request's";
/** What a team picked in Start… says over the box: its Brief starts it. */
export const TEAM_BRIEF = "On the side… or In charge… opens its Brief with your words: its models and how hard each thinks are picked there, and Send there starts it.";
/** Each start's glyph on its tile (services/subagent-starts.js), else its card's. @type {Readonly<Record<string, string>>} */
const START_ICONS = Object.freeze({ ask: "messageCircle", job: "hammer", review: "eye", catchup: "history" });
/** The @ menu's groups, each in its own colour; the teams in gold, as everything in charge is. */
const GROUP_TONES = Object.freeze({ agents: "var(--color-sys-blue)", teams: "var(--color-sys-yellow)" });
/** The new thread, where a chat's open thread is kept. */
const NEW = "";
/** The list with nothing in it yet. */
// The lead line over the box says your agent hears nothing unless you send it: said once (the Designer's review of 10-24).
export const NO_THREADS = "Nobody works for this chat yet. Start… asks an agent or gives one a job.";
/** What the Teams row at the list's foot opens. */
const TEAMS_ROW = "Put one in charge of this chat, or send one on the side";
/** The Flows row's line (HarnessV4_Flow_Plan F5). */
const FLOWS_ROW = "Your agents and teams in steps: draw one by hand or from a saved one";
/** The Flows row's words as the switch has it. */
const flowsRow = () => (teamsOn(state.config) ? FLOWS_ROW : "Your agents in steps: draw one by hand or from a saved one");
/** The name of the row of your agent's own work, drawn as a flow (HarnessV4_OneAgent_Plan L47). */
export const WORK_ROW = "Your agent's work";
/** What the list is, under its title. */
export const LIST_LINE = "The agents you or your agent asked, the teams in charge or on the side, and those on their own.";
/** The same while the switch is off. */
export const LIST_LINE_ALONE = "The agents you or your agent asked, and those on their own.";
/** What Watch all is, over its tiles. */
const WATCH_LINE = "Every agent that works for this chat, live. A tile opens its thread; nothing here launches an agent.";
/**
 * The list's foot's last part (U12-D5; the owner's 10-25: it bore Library's box's name, "Models for agents", over this
 * chat's list, and the two read as one box showing different models): what this chat's agents run on, by its own name.
 */
export const SEATS_NAME = WORDS.chatSeats;
/** Its editor's head, opened from the corner or the narrow bar. */
const SEATS_EDITOR = WORDS.chatSeatsEditor;
/** What its Use the default does: the chat's own list dropped, its agents on its model (a list is a chat's own alone). */
const SEATS_BACK = "Drop this chat's own list: its agents then run on its model, as its main agent does";
/** What its count counts. */
const SEATS_USE = "This chat's agents at work on these models, and the room for more now where a model has a limit across your chats";
/**
 * The gear's sheet (the owner's of 11-05: the list's foot, a corner of settings, moved behind a gear): this chat's own
 * settings for its agents, over Library's — whom its agent may use, who runs on what, what everyone else runs on.
 */
export const GEAR_TITLE = "Agents in this chat";
/** What the sheet is, under its title: overrides for this chat alone, over Library's. */
export const GEAR_LINE = "Overrides for this chat only. Every agent and team starts as Library › Agents and teams sets it; a change here holds in this chat alone, and Use the default on its row takes it back.";
/** The same while Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js). */
const GEAR_LINE_ALONE = "Overrides for this chat only. Every agent starts as Library › Agents sets it; a change here holds in this chat alone, and Use the default on its row takes it back.";
/** The gear's tooltip, as the switch has it. */
const gearTip = () => (teamsOn(state.config) ? "This chat's agent settings: whom your agent may use, and what its agents and teams run on" : "This chat's agent settings: whom your agent may use, and what its agents run on");

/**
 * @param {SideIO} io
 * @param {{ h?: Mk, menu?: typeof menu, conversation?: typeof subagentConversation, guest?: typeof guestConversation,
 *   modelSelect?: typeof createModelSelect, attachments?: typeof createAttachments, poolChip?: typeof createPoolChip,
 *   runsOn?: typeof createRunsOn, place?: (parent: any, wanted: any[]) => void, drawIn?: (parent: any, nodes: any[]) => void,
 *   sheet?: typeof sheet }} [o]  the tests' seams:
 *   the page's `h`, the menu, the gear's sheet, the thread part and the one for a coding agent's own agent, the model picker, the
 *   attachments and the lists' chips (each draws with the page's own document), how a waiting call's answers are put in
 *   their row, and how a part drawn again at each pulse goes into its place — in place (dom.js `morphChildren`), the
 *   elements under a resting pointer the ones that stood (the owner's of 11-01: buttons blinking, clicks lost)
 * @returns {{ el: any, paint: (chat: any) => void, open: (id: string, o?: { followUp?: boolean }) => void,
 *   fresh: (tag?: string) => void, begin: (start: string) => void, ask: (chat: any, question: string, files?: any[]) => Promise<string | null>,
 *   badge: (chat: any) => import("./tabs.js").Badge | null, seen: (chat: any, id: string, exchange: number) => void,
 *   pane: (chat: any) => string, aim: (chat: any, id: string) => void, close: () => void }}
 */
export function createSideView(io, o = {}) {
  const mk = o.h || h;
  const openMenu = o.menu || menu;
  const place = o.place || placeChildren;
  const drawIn = o.drawIn || morphChildren;
  const conversation = o.conversation || subagentConversation;
  const guest = o.guest || guestConversation;
  const poolChip = o.poolChip || createPoolChip;
  const now = io.now || Date.now;
  /** @type {any} the chat on screen */
  let chat = null;
  /** The thread drawn now. @type {Shown | null} */
  let shown = null;
  /** The thread's part says Loading while the agents' list is not the chat's yet (`paintThread`). */
  let holding = false;
  /** The chat whose draft the new thread's box holds. @type {any} */
  let boxFor = null;
  let launching = false;
  let enhancing = false;
  /** Enter was pressed against the chips' stop: it is drawn stronger until the draft moves. */
  let pressed = false;
  /** Why the thread's model could not run an agent now, by model; undefined while it is asked. @type {Map<string, string | null | undefined>} */
  const problems = new Map();
  /** What the team picked in Start… runs on, read once for its models and its last picks. @type {{ key: string, on: import("../lib/beside.js").BesideOn | null, done: boolean }} */
  let teamOn = { key: "", on: null, done: false };

  const el = mk("div", { class: "sd" });
  /** The view's parts, built when it first shows. @type {any} */
  let ui = null;
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "sd-ic") => mk("span", { class: cls, html: /** @type {any} */ (ICONS)[name] || ICONS.bot });

  /**
   * What a chat keeps of its Sub Agents tab: the open thread (`NEW`: the new thread's box), the new thread's draft and
   * its words, the question a tile put in the box while it stands as put (`filled`), a start asked for before the
   * starts were read (`begin`), the brief Enhance wrote and what it replaced, which answers were opened, whether its
   * older done threads are unfolded, and how the agents show: one thread, or Watch all.
   * @param {any} c
   * @returns {{ open: string, draft: SideDraft | null, text: string, filled: string | null, begin: string | null,
   *   before: { text: string, how: string, read: number } | null, title: string | null, files: any[],
   *   watch: { live: Set<string>, opened: Set<string> }, earlier: boolean, mode: "threads" | "watch" }}
   */
  const stateOf = (c) => (c.side ||= { open: NEW, draft: null, text: "", filled: null, begin: null, before: null, title: null, files: [], watch: { live: new Set(), opened: new Set() }, earlier: false, mode: "threads" });

  const shortcuts = () => shortcutsOf(io.starts(), io.cards());
  /** The chat's draft: on the first start that takes your words until the person chooses. @param {ReturnType<typeof stateOf>} st @returns {SideDraft} */
  const draftOf = (st) => {
    if (st.draft && io.cards().some((c) => c.tag === st.draft?.tag)) return st.draft;
    const first = shortcuts().find((s) => !s.task);
    const draft = first ? draftOn(first.id, first.tag) : draftOn(null, (io.cards().find((c) => c.always) || io.cards()[0])?.tag || "");
    // Kept only once the starts are read: until then the next paint looks again.
    if (first) st.draft = draft;
    return draft;
  };
  /** The draft resolved against its card and start, or null while the cards are not read. @param {ReturnType<typeof stateOf>} st */
  const resolved = (st) => {
    const draft = draftOf(st);
    const card = io.cards().find((c) => c.tag === draft.tag);
    if (!card) return null;
    const start = draft.start ? io.starts().find((s) => s.id === draft.start) || null : null;
    return chosen(draft, card, start, io.facts());
  };
  /** A choice made on a chip: the draft takes it, and the box paints. @param {Partial<SideDraft>} change */
  const choose = (change) => {
    const st = stateOf(chat);
    st.draft = { ...draftOf(st), ...change };
    pressed = false;
    paintFresh();
  };

  // ---- the parts ------------------------------------------------------------------------------------------------------
  const build = () => {
    /** A chip under the box: its glyph, its words, the menu it opens. @param {string} cls @param {string} title @param {string} icon @param {(anchor: any) => void} open */
    const part = (cls, title, icon, open) => {
      const words = mk("span", { class: "sd-part-words" });
      const ic = glyph(icon, "sd-part-ic");
      const b = mk("button", { class: `sd-part ${cls}`, type: "button", title, "aria-haspopup": "menu", onclick: () => open(b) }, ic, words, mk("span", { class: "sd-caret", html: ICONS.chevronDown }));
      return { el: b, words, ic };
    };
    const models = (o.modelSelect || createModelSelect)({
      onChange: (name) => choose({ model: name }),
      onUseDefault: () => choose({ model: "" }),
      defaultDesc: "The card's model, else the default models for sub-agents",
    });
    // Its sends hand an agent pictures and text files: a PDF goes with a message to the chat.
    const atts = (o.attachments || createAttachments)({ onReject: (msg) => io.toast(msg, "err") }, { pdfs: false });
    const task = mk("textarea", { class: "sd-task", rows: "2", "aria-label": "Your words for the agent" });
    const enhanceWord = mk("span", {}, "Enhance");
    const enhance = mk("button", { class: "sd-enhance", type: "button", onclick: () => void enhanceNow() }, mk("span", { class: "sd-enhance-ic", html: ICONS.sparkles }), enhanceWord);
    const send = mk("button", { class: "sd-send", type: "button", title: "Send (Enter)", "aria-label": "Send", html: ICONS.arrowUp, onclick: () => void launch() });
    const attach = mk("button", { class: "sd-attach", type: "button", title: "Add pictures or files", "aria-label": "Add pictures or files", html: ICONS.paperclip, onclick: () => atts.input.click?.() });
    task.addEventListener("input", () => {
      stateOf(chat).text = task.value;
      pressed = false;
      syncBox();
    });
    task.addEventListener("keydown", (/** @type {any} */ e) => {
      // An input method's Enter ends its word (Chinese, Japanese): it never sends (HC-117).
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        void launch();
      }
    });
    // A screenshot pasted or a file dropped goes with the words, as on a message that starts with a tag.
    task.addEventListener("paste", (/** @type {any} */ e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => String(f.type).startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void atts.add(files);
    });
    // The agent the words go to (U12-D6): an @ chip at the box's head, its menu every saved agent by what it is for.
    const agentIc = glyph("bot", "sd-agent-ic");
    const agentName = mk("span", { class: "sd-agent-name" });
    const agent = mk("button", { class: "sd-agent", type: "button", title: "Who gets your words", "aria-haspopup": "menu", onclick: () => openCards(agent) },
      agentIc, mk("span", { class: "sd-agent-at" }, "@"), agentName, mk("span", { class: "sd-caret", html: ICONS.chevronDown }));
    // A team's two ways, beside who (U13 W3), each opening its Brief; an agent does what its card's level lets it.
    const how = mk("div", { class: "sd-how", role: "group", "aria-label": "How" });
    const box = mk("div", { class: "sd-box" }, mk("div", { class: "sd-box-head" }, agent, how), atts.el, task,
      mk("div", { class: "sd-box-bar" }, attach, atts.input, mk("span", { class: "sd-box-gap" }), enhance, send));
    box.addEventListener("dragover", (/** @type {any} */ e) => e.preventDefault());
    box.addEventListener("drop", (/** @type {any} */ e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.length) void atts.add(e.dataTransfer.files);
    });

    const sees = part("is-sees", "What it sees of this session", "eye", openSees);
    const may = part("is-may", "What it may do", "lock", openMay);
    const answer = part("is-answer", "Where its answer goes", "cornerDownLeft", openAnswer);
    const effort = part("is-effort", "How hard it thinks", "gauge", openEffort);
    const more = part("is-more", "More choices for this thread", "slidersHorizontal", openMore);
    // Runs on · Effort · Sees · May · Answer to (U13 W3), then More.
    const chips = mk("div", { class: "sd-chips", role: "group", "aria-label": "What the next message does" }, mk("span", { class: "sd-model" }, models.el), effort.el, sees.el, may.el, answer.el, more.el);
    const shorts = mk("div", { class: "sd-shortcuts", role: "radiogroup", "aria-label": "Quick starts" });
    const notes = mk("div", { class: "sd-notes", role: "status", "aria-live": "polite" });
    const enhanced = mk("div", { class: "sd-enhanced hidden" });
    const leadEl = mk("p", { class: "sd-lead" }, LEAD);
    const freshEl = mk("div", { class: "sd-fresh" },
      mk("div", { class: "sd-fresh-top" }, mk("div", { class: "sd-hello" }, mk("h2", { class: "sd-title" }, TITLE), leadEl),
        mk("div", { class: "sd-quick" }, mk("span", { class: "sd-cap" }, "Quick starts"), shorts)),
      mk("div", { class: "sd-fresh-foot" }, notes, enhanced, box, chips));

    const groups = mk("div", { class: "sd-groups" });
    const newKbd = comboOf("subagent");
    const newBtn = mk("button", { class: "sd-new", type: "button", title: "Ask an agent: choose who, how and what — nothing goes until Send", onclick: () => fresh() },
      mk("span", { class: "sd-new-ic", html: ICONS.plus }), "Start…", newKbd ? mk("kbd", { class: "sd-new-kbd" }, newKbd) : null);
    /** The gear: this chat's agent settings in a sheet (`openGear`), marked where any is the chat's own. @param {string} cls */
    const gearOf = (cls) => mk("button", { class: `sd-gear ${cls}`, type: "button", title: gearTip(), "aria-label": GEAR_TITLE, "aria-haspopup": "dialog", onclick: () => openGear() },
      mk("span", { class: "sd-gear-ic", html: ICONS.settings }));
    const gear = gearOf("is-head");
    const barGear = gearOf("is-bar");
    const listLineEl = mk("p", { class: "sd-list-line" }, LIST_LINE);
    const listHead = mk("div", { class: "sd-list-head" }, mk("div", { class: "sd-list-top" }, mk("h2", { class: "sd-list-title" }, "Everyone working for this chat"), gear), listLineEl);
    // A team's row shows its pane here: the Team view, moved in once (U13-D5).
    const teamBox = mk("div", { class: "vw-team sd-team hidden", role: "region", "aria-label": "The team" });
    // Narrow, the list is a menu in the thread's head (views.css folds the column away), and the side list's chip
    // stands beside it.
    const threadsWords = mk("span", { class: "sd-threads-words" }, "Start…");
    const threads = mk("button", { class: "sd-threads", type: "button", title: "Everyone working for this chat", "aria-haspopup": "menu", onclick: () => openThreads(threads) }, mk("span", { class: "sd-threads-ic", html: ICONS.listTree }), threadsWords, mk("span", { class: "sd-caret", html: ICONS.chevronDown }));
    const threadHead = mk("div", { class: "sd-head" });
    const scroll = mk("div", { class: "sd-scroll" });
    const asks = mk("div", { class: "sd-asks hidden" });
    const footSlot = mk("div", { class: "sd-foot" });
    const threadEl = mk("div", { class: "sd-conv" }, threadHead, scroll, asks, footSlot);

    // The seat (U12-D5; the owner's 10-25): what this chat's agents run on — its list in force, under a name of its own,
    // its chip's tag and a line saying whose list it is, Use the default where it is the chat's own, and how many are at
    // work. Its chip opens the list's editor as the model picker's does; it stands in the gear's sheet. A team's Workers
    // have their one picker in the Team tab.
    const sideIO = {
      rows: () => io.pool()?.rows,
      source: () => io.pool()?.source || "default",
      main: () => io.pool()?.main || "",
      models: () => io.models(),
      families: () => io.families?.() || [],
      accounts: () => io.accounts?.() || [],
      facts: io.poolFacts,
      // A row that says no effort thinks as the main agent does (the owner's word of 11-05).
      inherit: () => ({ level: io.facts().defaultEffort || "model", desc: "The main agent's effort, as this chat sets it" }),
      label: SEATS_EDITOR,
      tag: () => seatsFrom(io.pool()?.source || "default").tag,
      defaultWords: SEATS_BACK,
      onChange: (/** @type {any} */ rows) => io.setPool(rows),
      onUseDefault: () => io.setPool(null),
    };
    const pool = poolChip(sideIO);
    const seatBack = mk("span", { class: "sd-seat-back" });
    const seatFrom = mk("p", { class: "sd-seat-from" });
    const seatCount = mk("span", { class: "sd-seat-count" });
    const seatFill = mk("span", { class: "sd-meter-fill" });
    const seatMeter = mk("div", { class: "sd-meter", role: "meter", "aria-label": "This chat's agents at work, of the room it has", "aria-valuemin": "0", "aria-valuemax": "100" }, seatFill);
    // The gear's sheet (proposal_ux §4.7; the owner's of 11-05): whom the main agent may ask, Who runs on what (each
    // agent's and team's models in this chat), then the seat.
    const footRows = mk("div", { class: "sd-foot-rows" });
    const runsSlot = mk("div", { class: "sd-runs-on hidden" });
    const seats = mk("div", { class: "sd-seats", role: "group", "aria-label": "Who your agent may use, and what this chat's agents run on" },
      footRows,
      runsSlot,
      mk("div", { class: "sd-seat", role: "group", "aria-label": SEATS_NAME },
        mk("div", { class: "sd-seat-head" }, mk("span", { class: "sd-seat-name" }, SEATS_NAME), seatBack),
        pool.el,
        seatFrom,
        mk("div", { class: "sd-seat-use", title: SEATS_USE }, seatMeter, seatCount)));
    // Threads, or Watch all: every agent at work at once (side-watch.js).
    const modes = segmented(mk, {
      options: [
        { id: "threads", label: "List", title: () => (teamsOn(state.config) ? "One agent's thread or one team: what it was asked, its work as it streams, its answer" : "One agent's thread: what it was asked, its work as it streams, its answer") },
        { id: "watch", label: "Tiles", title: "Every agent at work for this chat, live, a tile each" },
      ],
      value: () => stateOf(chat).mode,
      onChange: (id) => setMode(id === "watch" ? "watch" : "threads"),
      ariaLabel: "How the agents show",
    });
    const watchLine = mk("span", { class: "sd-bar-line" }, WATCH_LINE);
    const watch = createWatchAll({ open: (id) => open(id), ...(io.openBeside ? { beside: io.openBeside } : {}), ...(io.stop ? { stop: io.stop } : {}) }, { h: mk, ...(o.place ? { place: o.place } : {}), ...(o.drawIn ? { drawIn: o.drawIn } : {}) });
    // The open thread in a pane beside the chat, its own tab there (panes/thread.js).
    const besideBtn = mk("button", { class: "inst-link sd-beside", type: "button", title: "This thread in a pane beside the chat, where the chat stays in sight", onclick: () => {
      const id = stateOf(chat).open;
      if (id) io.openBeside?.(id);
    } }, "Open beside");
    const bar = mk("div", { class: "sd-bar" }, modes.el, watchLine, mk("span", { class: "sd-bar-gap" }), besideBtn, threads, barGear);
    const pane = mk("section", { class: "sd-thread", "aria-label": "The thread" }, bar, freshEl, threadEl, teamBox, watch.el);
    el.replaceChildren(mk("div", { class: "sd-main" }, mk("aside", { class: "sd-list", "aria-label": "Everyone working for this chat" }, listHead, newBtn, groups), pane));
    // The sheet's foot: back to Library's for all of it, and where Library's are set.
    const gearReset = mk("button", { class: "inst-btn sd-gear-reset", type: "button", title: "Drop everything this chat sets for its agents: Library's settings hold again", onclick: () => io.resetAgents?.() }, "Reset all for this chat");
    const gearLibrary = mk("button", { class: "inst-btn sd-gear-lib", type: "button", title: `The defaults every chat starts from: ${agentsPage(state.config)}`, onclick: () => { ui.sheet?.close(); io.openLibrary?.(); } }, "Edit defaults in Library");
    const gearDone = mk("button", { class: "inst-btn is-primary sd-gear-done", type: "button", onclick: () => ui.sheet?.close() }, "Done");
    const gearFoot = mk("div", { class: "sd-gear-foot" }, gearReset, ...(io.openLibrary ? [gearLibrary] : []), mk("span", { class: "sd-gear-gap" }), gearDone);
    ui = {
      models, atts, task, enhance, enhanceWord, send, agent, agentIc, agentName, how, chips, sees, may, answer, effort, more, shorts, notes, enhanced, freshEl, leadEl, listLineEl, groups, newBtn,
      threadsWords, threadEl, threadHead, scroll, asks, footSlot, pane, pool, seats, seatBack, seatFrom, seatCount, seatFill, seatMeter, seatsKey: "",
      gear, barGear, gearFoot, gearReset, sheet: /** @type {{ close: () => void } | null} */ (null), sheetFor: "",
      footRows, footKey: "", runsSlot, runs: /** @type {{ el: HTMLElement, paint: () => void } | null} */ (null), modes, watchLine, watch, besideBtn, teamBox, teamIn: false, pane_: "",
    };
  };

  /**
   * The gear's sheet (the owner's of 11-05): what was the list's foot — whom the agent may use, Who runs on what, the
   * seat — over what it is, overrides for this chat alone, with the way to Library's defaults and back to them all.
   */
  function openGear() {
    if (ui.sheet || !chat?.chainId) return;
    ui.footKey = "";
    ui.seatsKey = "";
    ui.sheetFor = String(chat.chainId);
    ui.sheet = (o.sheet || sheet)({
      label: GEAR_TITLE,
      class: "sd-gear-sheet",
      head: mk("div", { class: "sd-gear-head" }, mk("b", { class: "sd-gear-title" }, GEAR_TITLE), mk("p", { class: "sd-gear-line" }, teamsOn(state.config) ? GEAR_LINE : GEAR_LINE_ALONE)),
      body: ui.seats,
      foot: ui.gearFoot,
      onClose: () => {
        ui.sheet = null;
        ui.sheetFor = "";
      },
    });
    paintSeats();
  }

  // ---- the chips' menus ---------------------------------------------------------------------------------------------------
  /** @param {any} anchor */
  function openSees(anchor) {
    const c = resolved(stateOf(chat));
    if (!c) return;
    io.readSizes(true);
    const s = seesChoices(c, io.facts());
    const since = mk("input", { class: "sd-since-in", type: "text", value: s.since, placeholder: "v1.2, a commit, a branch", "aria-label": "Everything since this commit, tag or branch" });
    const take = () => {
      const ref = String(since.value || "").trim();
      choose({ changes: ref ? `since:${ref}` : null });
      m.close();
    };
    since.addEventListener("keydown", (/** @type {any} */ e) => {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); take(); }
    });
    const m = openMenu([
      { type: "label", label: "What it sees of this session" },
      ...s.views.map((v) => ({ type: "radio", label: v.name, desc: v.off || v.line, checked: v.on, disabled: !!v.off, onClick: () => choose({ view: v.id }) })),
      ...(s.running ? [{ type: "check", label: "And the turn running now", desc: s.running.line, checked: s.running.on, onClick: () => choose({ running: !s.running?.on }) }] : []),
      { type: "separator" },
      { type: "label", label: "A change, as a patch" },
      ...s.changes.map((x) => ({ type: "radio", label: x.name, desc: x.line, checked: x.on, onClick: () => choose({ changes: x.id || null }) })),
      { type: "node", node: mk("div", { class: `sd-since${s.since ? " is-on" : ""}` }, mk("span", { class: "sd-since-label" }, "Everything since"), since, mk("button", { class: "sd-since-go", type: "button", onclick: take }, "Use")) },
    ], { anchor, width: 380 });
  }
  /** @param {any} anchor */
  function openMay(anchor) {
    const c = resolved(stateOf(chat));
    if (!c) return;
    const m = mayChoices(c);
    openMenu([
      { type: "label", label: "What it may do" },
      ...m.choices.map((x) => ({ type: "radio", label: x.name, desc: x.line, checked: x.on, onClick: () => choose(x.id === "folder" ? { folder: true } : { may: x.id, folder: false }) })),
      ...(m.note ? [{ type: "separator" }, { type: "label", label: m.note }] : []),
    ], { anchor, width: 340 });
  }
  /** @param {any} anchor */
  function openAnswer(anchor) {
    const c = resolved(stateOf(chat));
    if (!c) return;
    openMenu([
      { type: "label", label: "Where its answer goes" },
      { type: "radio", label: "Stays with you", desc: "Send it to your agent from under the answer, when you want", checked: !c.deliver, onClick: () => choose({ deliver: false, pause: false, inform: false }) },
      { type: "radio", label: "Goes to your agent when done", desc: "Its next step reads it, else its next turn", checked: c.deliver, onClick: () => choose({ deliver: true }) },
    ], { anchor, width: 340 });
  }
  /** How hard it thinks (U12-D7): the session's default, the model's own, each level. @param {any} anchor */
  function openEffort(anchor) {
    const c = resolved(stateOf(chat));
    if (!c || c.fork) return;
    openMenu([
      { type: "label", label: "How hard it thinks" },
      ...effortChoices(c, io.facts()).map((x) => ({ type: "radio", label: x.name, ...(x.line ? { desc: x.line } : {}), checked: x.on, onClick: () => choose({ effort: x.id }) })),
      { type: "separator" },
      { type: "label", label: "A model that takes fewer levels thinks at its highest below this one; the thread says which" },
    ], { anchor, width: 340 });
  }
  /** @param {any} anchor */
  function openMore(anchor) {
    const st = stateOf(chat);
    const c = resolved(st);
    if (!c) return;
    const f = io.facts();
    const needs = "Only for an answer that goes to your agent";
    openMenu([
      { type: "check", label: "Your agent waits for it", desc: !c.deliver ? needs : f.turnRuns ? "The running turn holds its next step until this answers" : "No turn runs now, so there is nothing to hold", checked: c.pause, disabled: !c.deliver || !f.turnRuns, onClick: () => choose({ pause: !c.pause }) },
      { type: "check", label: "Tell your agent it began", desc: c.deliver ? "It hears the task at once, and leaves that work to this one" : needs, checked: c.inform, disabled: !c.deliver, onClick: () => choose({ inform: !c.inform }) },
    ], { anchor, align: "end", width: 340 });
  }
  /** The teams Start… offers: none in a team's own chat, which sends no team of its own. */
  const teamsHere = () => (io.teams && !io.teams.home() ? [] : io.teamsList?.() || []);
  /** The team the draft picked, where it is still one; else null. @param {ReturnType<typeof stateOf>} st */
  const teamOf = (st) => {
    const key = st.draft?.team;
    return key ? teamsHere().find((t) => t.key === key) || null : null;
  };
  /**
   * Who gets the words (U12-D6; one kind of agent, HarnessV4_OneAgent_Plan OA1): the agents, one list (the owner's word
   * of 10-24), then the teams, each with its crown. The box's @ chip.
   * @param {any} anchor
   */
  function openCards(anchor) {
    const draft = draftOf(stateOf(chat));
    const teams = teamsHere();
    const by = new Map(cardGroups(io.cards()).map((g) => [g.id, g]));
    /** @param {"agents"} id */
    const section = (id) => {
      const g = by.get(id);
      if (!g) return [];
      return [{ type: "label", label: g.title },
        // The agent already chosen stays on its start: picked again, nothing changes.
        ...g.cards.map((c) => ({ type: "radio", label: c.name, desc: c.goodFor, icon: cardIcon(c), tone: GROUP_TONES[id], checked: !draft.team && draft.tag === c.tag, onClick: () => { if (draft.team || draft.tag !== c.tag) pick(null, c.tag); } }))];
    };
    /** @param {any} t */
    const team = (t) => ({ type: "radio", label: t.name, desc: t.line || "", icon: "crown", tone: GROUP_TONES.teams, checked: draft.team === t.key, onClick: () => pickTeam(t.key) });
    openMenu([
      ...section("agents"),
      ...(teams.length ? [{ type: "label", label: "Teams: a lead and its workers" }, ...teams.map(team)] : []),
    ], { anchor, width: 360 });
  }
  /** The session's agents by what they need of you, the coding agents' own among them, and the teams (U13-D5). */
  const groups = () => withTeams(sideGroups(io.rows(), io.own()), io.teams?.items() || [], (r) => String(r.id));
  /**
   * A row's words: one of the coding agents' own says its calls and its time, any other its cost.
   * @param {import("../lib/subagents.js").SubagentRow | import("../lib/subagents.js").GuestRow} r @param {number} t
   */
  const wordsOf = (r, t) => (isGuest(r) ? guestRow(r, t) : sideRow(r, t));

  /** The list as a menu, where the window has no room for the column. @param {any} anchor */
  function openThreads(anchor) {
    const st = stateOf(chat);
    const t = now();
    const work = io.teams?.work?.() || null;
    openMenu([
      { label: "Start…", icon: "plus", onClick: () => fresh() },
      ...groups().flatMap((g) => [{ type: "label", label: g.title },
        ...g.entries.map((e) => {
          if ("item" in e) {
            const x = e.item;
            return { type: "radio", label: `${x.name}: ${x.task}`, icon: (x.look || leadLook(x.key)).icon, desc: [x.tag, x.fact].join(" · "), checked: st.open === x.id, onClick: () => open(x.id) };
          }
          const r = e.row;
          const w = wordsOf(r, t);
          return { type: "radio", label: `${w.name}: ${w.task}`, icon: rowIcon(r), desc: [whoTag(r), w.fact, w.where, w.right].filter(Boolean).join(" · "), checked: st.open === r.id, onClick: () => open(r.id) };
        })]),
      ...(io.teams?.home() ? [{ type: "separator" }, { type: "radio", label: "Teams", icon: "users", desc: TEAMS_ROW, checked: st.open === TEAM_HOME, onClick: () => open(TEAM_HOME) }] : []),
      ...(io.teams?.flows?.() ? [{ type: "radio", label: "Flows", icon: "waypoints", desc: flowsRow(), checked: st.open === FLOW_HOME, onClick: () => open(FLOW_HOME) }] : []),
      ...(work ? [{ type: "radio", label: WORK_ROW, icon: "waypoints", desc: work, checked: st.open === WORK_ITEM, onClick: () => open(WORK_ITEM) }] : []),
    ], { anchor, width: 360 });
  }
  /**
   * A start or a card chosen for the chat's new thread: the draft follows it. A start that brings its own question puts
   * it in the box, as words of yours to send or change — never over words you wrote; the question a tile put there and
   * you left as it was goes with the next choice.
   * @param {ReturnType<typeof stateOf>} st @param {string | null} start @param {string} tag
   */
  const choosing = (st, start, tag) => {
    st.draft = draftOn(start, tag);
    const task = start ? shortcuts().find((s) => s.id === start)?.task || "" : "";
    if (st.text.trim() && st.text !== st.filled) return;
    st.text = task;
    st.filled = task || null;
    if (boxFor === chat && ui) ui.task.value = task;
  };
  /** A tile or a card chosen in the tab: the draft begins again on it, and the cursor is in the box. @param {string | null} start @param {string} tag */
  const pick = (start, tag) => {
    choosing(stateOf(chat), start, tag);
    pressed = false;
    paintFresh();
    ui?.task.focus?.();
  };
  /** A team picked in Who (U13 W3): the box's words go to its Brief, which its two ways open. @param {string} key */
  const pickTeam = (key) => {
    const st = stateOf(chat);
    st.draft = { ...draftOf(st), team: key };
    pressed = false;
    paintFresh();
    ui?.task.focus?.();
  };
  /** A team's Brief, opened on a way with the box's words: Send there starts it. @param {any} team @param {"side" | "charge"} way */
  const briefOf = (team, way) => {
    const ask = String(ui?.task.value || "").trim();
    io.brief?.({ team: team.key, way, ...(ask ? { ask } : {}) });
  };

  // ---- the new thread ---------------------------------------------------------------------------------------------------
  const syncBox = () => {
    const st = stateOf(chat);
    const c = resolved(st);
    const empty = !String(ui.task.value || "").trim();
    // A team: Send opens its Brief on its usual way, the box's words in it; nothing starts here.
    const team = teamOf(st);
    const stop = team ? "" : c ? lineStop(c, io.facts()) : "";
    ui.send.toggleAttribute("disabled", empty || launching || enhancing || (!c && !team) || !!stop);
    ui.send.setAttribute("title", team ? "Open its Brief (Enter): Send there starts it" : "Send (Enter)");
    ui.enhance.toggleAttribute("disabled", empty || launching || enhancing);
    ui.enhance.classList.toggle("busy", enhancing);
    ui.enhanceWord.replaceChildren(enhancing ? "Enhancing" : "Enhance");
    ui.enhance.setAttribute("title", enhanceWords(io.cache()));
    ui.task.readOnly = enhancing || launching;
  };

  /**
   * What a team picked in Start… runs on, as its Brief opens on it (the owner's 10-21: they forgot the Brief picks its
   * models): read once for its own models and its last picks, the notes painted again once it is — for the chat on
   * screen, whose session it is read for (the copies hunt of 10-23: another chat's note stood in this one's). Null until then.
   * @param {any} team
   */
  const teamNote = (team) => {
    const picks = io.lastPicks?.(team.key) || null;
    const key = JSON.stringify([chat?.chainId || "", team.key, team.leadModels || team.leadModel || null, team.models || null, picks?.model || "", picks?.workers || ""]);
    if (teamOn.key !== key && io.runsOn) {
      teamOn = { key, on: null, done: false };
      void io.runsOn(team.key, { model: picks?.model || "", workers: picks?.workers || "" }).then((on) => {
        if (teamOn.key !== key) return;
        teamOn = { key, on, done: true };
        if (chat && ui && stateOf(chat).open === NEW) paintNotes();
      });
    }
    const on = teamOn.key === key ? teamOn.on : null;
    if (!on) return null;
    // This chat's list as it holds one: none, and its crew runs on each card's, else its lead's (lib/side.js `teamLine`).
    const seats = io.seats?.() || [];
    return mk("p", { class: "sd-note sd-team-line", "data-key": "team" }, glyph("crown", "sd-team-line-ic"),
      mk("span", {}, teamLine({ team, on, picks, seats })));
  };

  /** The notes over the box: why it does not go yet, a model that cannot run it, the price where none was chosen. */
  const paintNotes = () => {
    const st = stateOf(chat);
    const c = resolved(st);
    /** @type {any[]} */
    const out = [];
    const team = teamOf(st);
    if (team) {
      const line = teamNote(team);
      if (line) out.push(line);
      out.push(mk("p", { class: "sd-note", "data-key": "brief" }, TEAM_BRIEF));
    }
    else if (c) {
      const stop = lineStop(c, io.facts());
      if (stop) out.push(mk("p", { class: `sd-note is-stop${pressed ? " is-pressed" : ""}`, "data-key": "stop" }, stop));
      const problem = c.model ? problems.get(c.model) : null;
      if (c.model && !problems.has(c.model)) {
        const model = c.model;
        problems.set(model, undefined);
        io.modelProblem(model).then((p) => problems.set(model, p), () => problems.set(model, null)).then(() => { if (chat && ui && stateOf(chat).open === NEW) paintNotes(); });
      }
      if (problem) out.push(mk("p", { class: "sd-note is-warn", "data-key": "problem" }, `${prettyModel(c.model)} cannot run it now: ${problem}`));
      // No model is set for agents on the side, and neither the card nor the person names one: the main agent's runs it.
      const price = !c.picked && !c.fork && io.fallsToMain() && !io.cards().find((x) => x.tag === c.tag)?.model ? io.priceOf(c.model) : "";
      if (price)
        out.push(mk("p", { class: "sd-note", "data-key": "price" }, `It runs on your agent's model, ${prettyModel(c.model)} (${price.replace(/^[A-Z]/, (ch) => ch.toLowerCase())}).`,
          ...(io.offered.seen() ? [] : [" ", mk("button", { class: "sd-link", type: "button", onclick: () => { io.offered.mark(); ui.models.open?.(); paintNotes(); } }, "Pick another for this thread")])));
      const gap = noPatchWhy(c, io.facts());
      if (gap) {
        const other = gap.other;
        out.push(mk("p", { class: "sd-note is-warn", "data-key": "gap" }, gap.words,
          ...(other ? [" ", mk("button", { class: "sd-link", type: "button", onclick: () => choose({ changes: other.id }) }, other.name)] : [])));
      }
      if (c.folder) out.push(mk("p", { class: "sd-note is-warn", "data-key": "folder" }, "It works in the session's folder, where your agent works: nothing waits for Apply. ",
        mk("button", { class: "sd-link", type: "button", onclick: () => choose({ may: "read", folder: false }) }, "Read only instead")));
    }
    drawIn(ui.notes, out);
  };

  const paintEnhanced = () => {
    const st = stateOf(chat);
    const b = st.before;
    ui.enhanced.classList.toggle("hidden", !b);
    if (!b) return void drawIn(ui.enhanced, []);
    drawIn(ui.enhanced, [
      mk("span", { class: "sd-enhanced-ic", html: ICONS.sparkles }),
      mk("span", { class: "sd-enhanced-words" },
        ...(st.title ? [mk("b", {}, st.title), " "] : []),
        b.how === "fork" ? `Rewritten by the main agent from what it knows${b.read ? `, ${fmt.k(b.read)} tokens read from its cache` : ""}; nothing joined its conversation.` : "Rewritten from this session, folded: the main agent's cache was cold."),
      mk("button", { class: "sd-link", type: "button", onclick: () => {
        ui.task.value = st.text = b.text;
        st.before = null;
        st.title = null;
        paintEnhanced();
        syncBox();
      } }, "Undo")]);
  };

  /**
   * The new thread's pane, in place: the tiles, the @ chip, the chips' words, the notes; the box keeps what is typed.
   * Painted at each pulse of the chat's agents: its tiles, its ways and its notes' links drawn in place (`drawIn`).
   */
  function paintFresh() {
    if (!ui || !chat) return;
    const st = stateOf(chat);
    if (boxFor !== chat) {
      // The box is one, and each chat's draft its own: the one it held is put by, this chat's taken out.
      if (boxFor) stateOf(boxFor).files = ui.atts.list();
      boxFor = chat;
      ui.task.value = st.text;
      ui.atts.restore(st.files);
      pressed = false;
      // The chips' sizes at once; the two changes', which git is read for, behind them — there when the menu opens.
      io.readSizes(false);
      io.readSizes(true);
    }
    // A start asked for before the starts were read is chosen once they are (`begin`).
    const asked = st.begin ? shortcuts().find((s) => s.id === st.begin) : null;
    if (asked) {
      st.begin = null;
      choosing(st, asked.id, asked.tag);
    }
    const draft = draftOf(st);
    const f = io.facts();
    const team = teamOf(st);
    // The quick starts (U13 W3): a tile chosen again lets go, and Start… is back on asking.
    const asking = shortcuts().find((s) => s.id === BTW_START) || null;
    keepingFocus(ui.shorts, () => drawIn(ui.shorts,
      quickStarts(shortcuts()).map((s) => {
        const on = !team && draft.start === s.id;
        return mk("button", {
          class: `sd-short${on ? " is-on" : ""}`, type: "button", role: "radio", "aria-checked": on ? "true" : "false", "data-key": s.id,
          ...(s.task ? { title: `${s.name}: its question goes in the box, to send or change` } : {}),
          onclick: () => (on ? pick(asking?.id ?? null, asking?.tag ?? s.tag) : pick(s.id, s.tag)),
        },
          mk("span", { class: "sd-short-name" }, glyph(START_ICONS[s.id] || cardIcon(io.cards().find((c) => c.tag === s.tag)), "sd-short-ic"), s.name),
          mk("span", { class: "sd-short-sub" }, s.sub));
      })));
    const c = resolved(st);
    ui.chips.classList.toggle("hidden", !!team);
    ui.enhance.classList.toggle("hidden", !!team);
    ui.agent.classList.toggle("is-team", !!team);
    if (team) {
      // A team (U13 W3): its crown and name, and its two ways — each opens its Brief, the usual one ringed. In
      // charge's tip is the team's: one that changes no file says what the server holds the chat to (d-side, 11-12).
      setHtml(ui.agentIc, ICONS.crown);
      ui.agentName.replaceChildren(team.name);
      ui.task.setAttribute("placeholder", `Tell ${possessive(team.name)} lead what the team is to do`);
      const usual = usualWay(team);
      ui.how.setAttribute("role", "group");
      keepingFocus(ui.how, () => drawIn(ui.how, (/** @type {const} */ (["side", "charge"])).map((way) =>
        mk("button", { class: `sd-way${way === usual ? " is-usual" : ""}`, type: "button", "data-key": way, title: `${way === "charge" ? chargeWords(team).short : WAYS[way].short} Opens its Brief; Send there starts it`, onclick: () => briefOf(team, way) },
          glyph(way === "side" ? "columns2" : "crown", "sd-way-ic"), `${WAYS[way].label}…`))));
    } else if (c) {
      const w = lineParts(c, f);
      const card = io.cards().find((x) => x.tag === c.tag);
      setHtml(ui.agentIc, /** @type {any} */ (ICONS)[cardIcon(card)] || ICONS.bot);
      ui.agentName.replaceChildren(w.who);
      ui.task.setAttribute("placeholder", `Tell ${c.name} what you need`);
      // One kind of agent (OA1): it may do what its card's level lets it, the May chip lowering it.
      drawIn(ui.how, []);
      ui.sees.words.replaceChildren(w.sees);
      ui.may.words.replaceChildren(w.may);
      ui.may.el.setAttribute("title", "What it may do: only lower than its card");
      setHtml(ui.may.ic, c.level === "read" && !c.folder ? ICONS.lock : ICONS.pencil);
      ui.answer.words.replaceChildren(w.answer);
      ui.effort.words.replaceChildren(w.effort);
      ui.effort.el.toggleAttribute("disabled", c.fork);
      ui.effort.el.setAttribute("title", c.fork ? FORK_EFFORT : "How hard it thinks");
      ui.effort.el.classList.toggle("is-default", !c.effortPicked);
      ui.more.words.replaceChildren(w.more);
      ui.models.setModels(io.models());
      // The picker the chat's box has, whole: each model's price and levels, a plan's room on its coding agent's tab.
      ui.models.setFamilies?.(io.families?.() || []);
      ui.models.setAccounts?.(io.accounts?.() || []);
      ui.models.setLocked(c.fork ? FORK_MODEL : null);
      ui.models.set(c.model);
      ui.models.setNote(c.fork ? "your agent's" : c.picked ? null : "the card's, else a default model");
    }
    paintNotes();
    paintEnhanced();
    syncBox();
  }

  async function enhanceNow() {
    const st = stateOf(chat);
    const mine = chat;
    const text = String(ui.task.value || "").trim();
    const c = resolved(st);
    if (!text || enhancing || !c) return;
    enhancing = true;
    syncBox();
    try {
      const out = await io.enhance(text, { readOnly: c.level === "read", view: c.view });
      const to = stateOf(mine);
      to.before = { text, how: out.how, read: Number(out.usage?.cacheRead) || 0 };
      to.title = out.title;
      to.text = out.text;
      if (chat === mine) ui.task.value = out.text;
    } catch (e) {
      io.toast(`Enhance failed: ${/** @type {any} */ (e)?.message || e}`, "err");
    } finally {
      enhancing = false;
      if (chat === mine) paintFresh();
    }
  }

  /** The words go: one agent, asked by its card's tag; its thread opens. A refusal leaves the box as it was. */
  async function launch() {
    const st = stateOf(chat);
    const mine = chat;
    const text = String(ui.task.value || "").trim();
    const c = resolved(st);
    // A team starts from its Brief: Send opens it on its usual way, the words in it.
    const team = teamOf(st);
    if (team) {
      if (text) briefOf(team, usualWay(team));
      return;
    }
    if (!text || launching || enhancing || !c) return;
    if (lineStop(c, io.facts())) {
      pressed = true;
      return paintNotes();
    }
    launching = true;
    syncBox();
    const files = ui.atts.list();
    const texts = files.filter((/** @type {any} */ a) => a.kind !== "image").map((/** @type {any} */ a) => `\n\nFile: ${a.name}\n\`\`\`\n${a.text}\n\`\`\``).join("");
    const images = files.filter((/** @type {any} */ a) => a.kind === "image").map((/** @type {any} */ a) => ({ name: String(a.name || "picture"), mediaType: String(a.type || "image/png"), data: a.data }));
    try {
      const row = await io.launch(launchBody(c, `${text}${texts}`, { title: st.title, images }));
      const to = stateOf(mine);
      to.text = "";
      to.filled = null;
      to.before = null;
      to.title = null;
      to.files = [];
      // Where an answer goes and what the main agent is told are one thread's choices: the next begins on the
      // start alone — or, after one that brought its own question, on the first that takes your words.
      const start = to.draft?.start ?? null;
      to.draft = start && shortcuts().find((s) => s.id === start)?.task ? null : draftOn(start, to.draft?.tag || c.tag);
      to.open = row.id;
      if (chat === mine) {
        ui.task.value = "";
        ui.atts.clear();
      }
      if (row.shares) io.toast(`It works in the session's folder: no copy could be made (${row.shares}).`);
    } catch (e) {
      io.toast(`Not sent: ${/** @type {any} */ (e)?.message || e}`, "err");
    } finally {
      launching = false;
      if (chat === mine) paint(chat);
    }
  }

  // ---- the list, the seats, the thread -------------------------------------------------------------------------------
  /**
   * The list's rows, kept across paints by what each stands for (the owner's word of 10-22: a row under the pointer
   * blinked four or five times a second, as each pulse drew the list anew and the hovered row was a new one). A row keeps
   * its element while it stands in the list: its attributes are set in place, its insides drawn again only when what
   * they show moved — in place, each part of it under the pointer the element it was (the owner's of 11-01: a running
   * agent's row moved its clock every second) —, and the list's children are placed, never all replaced.
   * @type {Map<string, { el: any, at: Record<string, string | null>, look: string, go: (() => void) | null, drops: (() => import("../lib/side.js").ThreadDrop | null) | null }>}
   */
  const kept = new Map();
  /** What this paint of the list drew: the rest is let go after it, so a row that comes back is drawn anew. */
  const drawn = new Set();
  /**
   * One node of the list, kept.
   * @param {string} key  what it stands for, one in the list
   * @param {string} tag
   * @param {Record<string, string | null>} at  its attributes, the same names at every paint (null: it has none)
   * @param {(() => void) | null} go  what a press does
   * @param {unknown[]} look  what its insides show
   * @param {() => any[]} kids  its insides, drawn when `look` moved
   * @param {(() => import("../lib/side.js").ThreadDrop | null) | null} [drops]  what deleting it is, for a right-click or
   *   the Delete key (the owner's ask of 10-23)
   */
  const keepNode = (key, tag, at, go, look, kids, drops = null) => {
    const k = `${tag} ${key}`;
    drawn.add(k);
    let slot = kept.get(k);
    if (!slot) {
      /** @type {{ el: any, at: Record<string, string | null>, look: string, go: (() => void) | null, drops: (() => import("../lib/side.js").ThreadDrop | null) | null }} */
      const made = { el: mk(tag, {}), at: {}, look: "", go, drops };
      made.el.addEventListener("click", () => made.go?.());
      made.el.addEventListener("contextmenu", (/** @type {any} */ e) => {
        const d = made.drops?.();
        if (!d) return;
        e.preventDefault();
        openMenu([{ label: d.label, icon: "trash2", variant: "destructive", ...(d.busy ? { disabled: true, desc: d.busy } : {}), onClick: () => void drop(d) }], { anchor: made.el });
      });
      made.el.addEventListener("keydown", (/** @type {any} */ e) => {
        if (e.key !== "Delete") return;
        const d = made.drops?.();
        if (!d) return;
        e.preventDefault();
        if (d.busy) io.toast(d.busy);
        else void drop(d);
      });
      kept.set(k, made);
      slot = made;
    }
    slot.go = go;
    slot.drops = drops;
    for (const [name, v] of Object.entries(at)) {
      if (slot.at[name] === v) continue;
      if (v == null) slot.el.removeAttribute(name);
      else slot.el.setAttribute(name, v);
    }
    slot.at = at;
    const shows = JSON.stringify(look);
    if (shows !== slot.look) {
      slot.look = shows;
      drawIn(slot.el, kids().filter((x) => x != null));
    }
    return slot.el;
  };
  const letGoUndrawn = () => {
    for (const k of kept.keys()) if (!drawn.has(k)) kept.delete(k);
  };
  /**
   * A row deleted, the person asked first (the host's `remove`): where it was open, the tab goes back to Start….
   * @param {import("../lib/side.js").ThreadDrop} d
   */
  const drop = async (d) => {
    const c = chat;
    if (!c || !io.remove || !(await io.remove(d))) return;
    const st = stateOf(c);
    if (st.open === d.at) st.open = NEW;
    if (ui && chat === c) paint(c);
  };

  const paintList = () => {
    const st = stateOf(chat);
    const t = now();
    ui.newBtn.classList.toggle("is-on", st.open === NEW);
    const all = groups();
    drawn.clear();
    /** @param {any} r */
    const rowEl = (r) => {
      const w = wordsOf(r, t);
      const on = st.open === r.id;
      const icon = rowIcon(r);
      const who = whoTag(r);
      // An answer of yours not opened yet: the sidebar's unread dot, until its thread opens (`unopened`).
      const unread = !isGuest(r) && unopened(r, st.watch);
      return keepNode(`row ${r.id}`, "button", { class: `sd-row${on ? " is-on" : ""}${unread ? " is-unread" : ""}`, type: "button", "data-id": r.id, "aria-current": on ? "true" : "false", title: `${w.name}: ${w.task}${unread ? " — its answer is not opened yet" : ""}` }, () => open(r.id),
        [isGuest(r), icon, w.name, who, w.task, w.tone, w.fact, w.where, w.right, unread],
        () => [
          mk("span", { class: `sd-av${isGuest(r) ? " is-own" : ""}`, html: /** @type {any} */ (ICONS)[icon] || ICONS.bot }),
          mk("span", { class: "sd-row-text" },
            mk("span", { class: "sd-row-top" }, mk("span", { class: "sd-row-name" }, w.name), mk("span", { class: "sd-row-who" }, who),
              unread ? mk("span", { class: "sd-unread", role: "img", "aria-label": "not opened yet" }) : null),
            mk("span", { class: "sd-row-task" }, w.task),
            mk("span", { class: "sd-row-meta" },
              mk("span", { class: `sd-row-fact is-${w.tone}` }, mk("span", { class: `sd-dot is-${w.tone}` }), mk("span", { class: "sd-row-fact-words" }, w.fact)),
              w.where ? mk("span", { class: "sd-row-where" }, w.where) : null,
              w.right ? mk("span", { class: "sd-row-right" }, w.right) : null)),
        ],
        () => dropOf({ kind: "agent", row: r }));
    };
    /** A team's row (U13-D5): its lead's face, its name and how it works for the chat, what it was asked, its state; its crew under it. @param {import("../lib/side.js").TeamItem} x */
    const teamEl = (x) => {
      const on = st.open === x.id;
      const look = x.look || leadLook(x.key);
      return [
        keepNode(`team ${x.id}`, "button", { class: `sd-row sd-team-row is-${x.way}${on ? " is-on" : ""}`, type: "button", "data-id": x.id, "aria-current": on ? "true" : "false", title: `${x.name}: ${x.task}` }, () => open(x.id),
          [look.tone, look.icon, x.name, x.way, x.tag, x.task, x.tone, x.fact],
          () => [
            mk("span", { class: `sd-av is-team t-${look.tone}`, html: /** @type {any} */ (ICONS)[look.icon] || ICONS.users }),
            mk("span", { class: "sd-row-text" },
              mk("span", { class: "sd-row-top" }, mk("span", { class: "sd-row-name" }, x.name), mk("span", { class: `sd-row-tag is-${x.way}` }, x.tag)),
              mk("span", { class: "sd-row-task" }, x.task),
              mk("span", { class: "sd-row-meta" },
                mk("span", { class: `sd-row-fact is-${x.tone}` }, mk("span", { class: `sd-dot is-${x.tone}` }), mk("span", { class: "sd-row-fact-words" }, x.fact)))),
          ],
          () => dropOf({ kind: "item", item: x })),
        ...x.crew.map((c) => keepNode(`crew ${x.id} ${c.id}`, "button", { class: `sd-row sd-crew-row${st.open === c.id ? " is-on" : ""}`, type: "button", "data-id": c.id, title: c.thread ? `${c.name}: its thread` : `${c.name}: its team's board` }, () => open(c.thread ? c.id : x.id),
          [look.tone, c.icon, c.name, c.tone, c.fact],
          () => [
            mk("span", { class: `sd-av is-crew t-${look.tone}`, html: /** @type {any} */ (ICONS)[c.icon] || ICONS.bot }),
            mk("span", { class: "sd-crew-name" }, c.name),
            mk("span", { class: `sd-row-fact is-${c.tone}` }, c.fact),
          ])),
      ];
    };
    const homeEl = io.teams?.home()
      ? keepNode("teams", "button", { class: `sd-row sd-teams-row${st.open === TEAM_HOME ? " is-on" : ""}`, type: "button", "data-id": TEAM_HOME, "aria-current": st.open === TEAM_HOME ? "true" : "false" }, () => open(TEAM_HOME), [], () => [
          mk("span", { class: "sd-av is-team", html: ICONS.users }),
          mk("span", { class: "sd-row-text" }, mk("span", { class: "sd-row-top" }, mk("span", { class: "sd-row-name" }, "Teams")), mk("span", { class: "sd-row-task" }, TEAMS_ROW)),
        ])
      : null;
    // The Flows row (HarnessV4_Flow_Plan F5, F6): a flow drawn by hand or from a saved one, and the saved flows.
    const flowsEl = io.teams?.flows?.()
      ? keepNode("flows", "button", { class: `sd-row sd-teams-row sd-flows-row${st.open === FLOW_HOME ? " is-on" : ""}`, type: "button", "data-id": FLOW_HOME, "aria-current": st.open === FLOW_HOME ? "true" : "false" }, () => open(FLOW_HOME), [flowsRow()], () => [
          mk("span", { class: "sd-av is-team t-cyan", html: ICONS.waypoints }),
          mk("span", { class: "sd-row-text" }, mk("span", { class: "sd-row-top" }, mk("span", { class: "sd-row-name" }, "Flows")), mk("span", { class: "sd-row-task" }, flowsRow())),
        ])
      : null;
    // Your agent's own work, drawn as a flow (HarnessV4_OneAgent_Plan L47): first at the foot, while it sent any.
    const work = io.teams?.work?.() || null;
    const workEl = work
      ? keepNode("work", "button", { class: `sd-row sd-teams-row sd-work-row${st.open === WORK_ITEM ? " is-on" : ""}`, type: "button", "data-id": WORK_ITEM, "aria-current": st.open === WORK_ITEM ? "true" : "false", title: `${WORK_ROW}: ${work}` }, () => open(WORK_ITEM), [work], () => [
          mk("span", { class: "sd-av is-team t-cyan", html: ICONS.waypoints }),
          mk("span", { class: "sd-row-text" }, mk("span", { class: "sd-row-top" }, mk("span", { class: "sd-row-name" }, WORK_ROW), mk("span", { class: "sd-row-tag is-flow" }, "as a flow")), mk("span", { class: "sd-row-task" }, work)),
        ])
      : null;
    const feet = [...(workEl ? [workEl] : []), ...(homeEl ? [homeEl] : []), ...(flowsEl ? [flowsEl] : [])];
    const footWords = () => (st.open === TEAM_HOME ? "Teams" : st.open === FLOW_HOME ? "Flows" : st.open === WORK_ITEM ? WORK_ROW : "");
    if (!all.some((g) => g.entries.length)) {
      place(ui.groups, [mk("p", { class: "sd-none" }, NO_THREADS), ...feet]);
      letGoUndrawn();
      ui.threadsWords.replaceChildren(footWords() || "Start…");
      return;
    }
    keepingFocus(ui.groups, () => place(ui.groups, [...all.flatMap((g) => {
      // Past the newest done — agents, teams and flows alike, by when each began — the rest fold under Earlier,
      // unfolded while the open thread, or a crew line of a team among them, is there.
      const older = g.id === "done" ? g.entries.length - DONE_SHOWN : 0;
      const opens = (/** @type {(typeof g.entries)[number]} */ e) => ("item" in e ? e.item.id === st.open || e.item.crew.some((c) => c.id === st.open) : e.row.id === st.open);
      const holdsOpen = older > 0 && g.entries.slice(DONE_SHOWN).some(opens);
      const fold = older > 0 && !st.earlier && !holdsOpen;
      const entries = fold ? g.entries.slice(0, DONE_SHOWN) : g.entries;
      const toggle = older > 0 && !holdsOpen
        ? keepNode("earlier", "button", { class: "sd-earlier", type: "button", "aria-expanded": fold ? "false" : "true" }, () => { st.earlier = !st.earlier; paintList(); }, [fold, older],
          () => [fold ? `Earlier · ${older}` : "Fewer", mk("span", { class: "sd-caret", html: fold ? ICONS.chevronDown : ICONS.chevronUp })])
        : null;
      const n = g.entries.length;
      return [
        keepNode(`head ${g.id}`, "div", { class: `sd-group is-${g.id}`, role: "heading", "aria-level": "3" }, null, [g.title, n],
          () => [mk("span", { class: "sd-group-title" }, g.title), mk("span", { class: "sd-group-n" }, String(n))]),
        ...entries.flatMap((e) => ("item" in e ? teamEl(e.item) : [rowEl(e.row)])),
        ...(toggle ? [toggle] : []),
      ];
    }), ...feet]));
    letGoUndrawn();
    const openItem = isTeamItem(st.open) ? all.flatMap((g) => g.items).find((x) => x.id === st.open) : null;
    const openRow = st.open && !openItem ? [...io.rows(), ...io.own()].find((r) => r.id === st.open) : null;
    ui.threadsWords.replaceChildren(openItem ? openItem.name : footWords() || (openRow ? wordsOf(openRow, t).name : st.open ? "Agent" : "Start…"));
  };

  /**
   * The list's foot row (proposal_ux §4.7): whom the main agent may ask, with the menu that changes it for this chat —
   * drawn again only when what it says moves, so an open menu's anchor stays —, and under it, while the chat's own
   * Parallelize tasks is on (the card's Always accept in this chat), that row with its way back.
   */
  const paintFootRows = () => {
    const a = io.mayAsk?.() || null;
    const par = a ? io.chatParallel?.() || null : null;
    // The chat in the key: a row drawn for one chat never stands, with its writes, in another's (the review of 9355b6724).
    const key = JSON.stringify(a && [chat?.chainId || null, a.tags, a.sub, a.own, a.off, a.teams || [], a.cards.map((c) => [c.tag, c.name]), !!par]);
    if (key === ui.footKey) return;
    ui.footKey = key;
    ui.footRows.classList.toggle("hidden", !a);
    keepingFocus(ui.footRows, () => ui.footRows.replaceChildren(...(a ? [group(mk, mayAskRow(mk, a, openMenu), par ? chatParallelRow(mk, par) : null)] : [])));
  };

  /**
   * The seat under the list (U12-D5; the owner's 10-25), drawn again only when it changes: its chip, whose list it is —
   * with Use the default where it is the chat's own — and how many of this chat's agents are at work on it, with its
   * meter where its models have a limit. No session, no seat.
   */
  const paintSeats = () => {
    paintFootRows();
    // Who runs on what, while the sheet shows: made once the open chat's settings are read — its io reads the open chat
    // at each call —, unfolded, as it is what the sheet is for. Closed, it builds nothing.
    const r = ui.sheet ? io.whoRuns?.() || null : null;
    if (r && !ui.runs) {
      ui.runs = (o.runsOn || createRunsOn)(r, { h: mk, poolChip, open: true });
      ui.runsSlot.replaceChildren(ui.runs.el);
    }
    ui.runsSlot.classList.toggle("hidden", !r);
    if (r) ui.runs?.paint();
    const p = io.pool();
    const any = !!p || !ui.footRows.classList.contains("hidden");
    ui.seats.classList.toggle("hidden", !any);
    // No session, nothing to set: no gear.
    const own = any && !!io.agentsOwn?.();
    for (const g of [ui.gear, ui.barGear]) {
      g.classList.toggle("hidden", !any);
      g.classList.toggle("is-own", own);
      g.setAttribute("title", own ? `${gearTip()}. Some are this chat's own` : gearTip());
    }
    ui.gearReset.classList.toggle("hidden", !own || !io.resetAgents);
    if (!any && ui.sheet) ui.sheet.close();
    if (!p) return;
    const f = io.facts();
    const key = JSON.stringify([p.rows ?? null, p.source, p.main, f.seats ?? null]);
    if (key === ui.seatsKey) return;
    ui.seatsKey = key;
    const from = seatsFrom(p.source);
    drawIn(ui.seatBack, from.own
      ? [mk("button", { class: "inst-link sd-seat-default", type: "button", title: SEATS_BACK, onclick: () => io.setPool(null) }, "Use the default")]
      : []);
    drawIn(ui.seatFrom, [from.lead, from.tail].filter((x) => x !== ""));
    const line = seatsLine(f.seats);
    const share = Math.round((line?.share || 0) * 100);
    ui.seatCount.replaceChildren(line?.words || "");
    ui.seatMeter.classList.toggle("hidden", line?.share == null);
    ui.seatMeter.classList.toggle("is-full", !!line?.full);
    ui.seatFill.setAttribute("style", `width:${share}%`);
    ui.seatMeter.setAttribute("aria-valuenow", String(share));
    ui.pool.paint();
  };

  const letGo = () => {
    shown?.conv.close();
    shown = null;
  };

  /**
   * A thread's part: one of a coding agent's own is read from its turn's run, and has no box; any other is the
   * conversation Filament holds.
   * @param {string} chain @param {string} id
   * @returns {Pick<Shown, "conv" | "followUp">}
   */
  const threadOf = (chain, id) => {
    if (guestOf(id)) return { conv: guest({ id, toast: io.toast }), followUp: null };
    const conv = conversation({ chainId: chain, id, toast: io.toast, main: io.mainDoor, held: io.held, onAskSelf: (tag) => fresh(tag) });
    return { conv, followUp: () => conv.focusFollowUp() };
  };

  /** The open thread's part, mounted once for it; a team's pane for a team's row; the new thread's pane otherwise. */
  const paintThread = () => {
    const st = stateOf(chat);
    const chain = io.chainId();
    const team = isTeamItem(st.open) && !!io.teams;
    ui.teamBox.classList.toggle("hidden", !team);
    if (ui.pane_ !== st.open) {
      ui.pane_ = st.open;
      io.onPane?.(st.open);
    }
    if (team && io.teams) {
      ui.freshEl.classList.add("hidden");
      ui.threadEl.classList.add("hidden");
      letGo();
      if (!ui.teamIn) {
        ui.teamBox.replaceChildren(io.teams.el);
        ui.teamIn = true;
      }
      io.teams.paint(chat, st.open);
      return;
    }
    const isNew = st.open === NEW;
    ui.freshEl.classList.toggle("hidden", !isNew);
    ui.threadEl.classList.toggle("hidden", isNew);
    if (isNew) {
      letGo();
      return paintFresh();
    }
    // The agents' list not the chat's yet — the chat still opening, or the list still the chat left's (app.js
    // `selectChat` draws the views before `refreshStatus` gives the list the chat's chain) —: no thread of Filament's is
    // made, which would read its agent under another chain and say it gone (a Now row's open). It says Loading, as a
    // thread's own first state does, and the list's change paints it once the chain lands. A coding agent's own needs none.
    const own = String(chat?.chainId || "");
    if ((!own || chain !== own) && !guestOf(st.open)) {
      letGo();
      if (!holding) {
        ui.threadHead.replaceChildren();
        ui.scroll.replaceChildren(mk("div", { class: "sav-loading gradient" }, "Loading"));
        ui.footSlot.replaceChildren();
        ui.asks.classList.add("hidden");
        ui.asks.replaceChildren();
        holding = true;
      }
      return;
    }
    if (!shown || shown.id !== st.open || shown.chain !== chain) {
      letGo();
      holding = false;
      const { conv, followUp } = threadOf(chain, st.open);
      ui.threadHead.replaceChildren(conv.head);
      ui.scroll.replaceChildren(conv.body);
      ui.footSlot.replaceChildren(conv.foot);
      // Its strip is painted whole at its first paint, even when it shows none: the strip of the thread shown before
      // — a failed one's Retry… — never stands over it (HarnessV4_AgentTools_Plan AT-D10).
      shown = { id: st.open, chain, conv, followUp, askKey: null };
      conv.mount(ui.scroll);
    }
    // A call of its agent that waits for you is answered here: the dock, which asks elsewhere, is not in this tab. A
    // worker's question to its lead is its lead's (HarnessV3-TaskGraph-v2 TG2-D49).
    const row = io.rows().find((r) => r.id === st.open) || null;
    const asking = row?.status === "running" ? yourAsk(row.progress) : null;
    const failed = !asking && row && (row.status === "failed" || row.status === "aborted") ? row : null;
    const key = asking ? answersKey(asking) : failed ? `failed:${failed.id}:${failed.exchanges.length}` : "";
    if (key !== shown.askKey) {
      shown.askKey = key;
      ui.asks.classList.toggle("hidden", !asking && !failed);
      if (failed) {
        ui.asks.replaceChildren(mk("div", { class: "ask-strip sd-retry", role: "group", "aria-label": "It failed" },
          mk("span", { class: "ask-what" }, failed.status === "aborted" ? "It was cut off before it answered." : "It failed before it answered."),
          mk("button", { class: "inst-btn", type: "button", title: "Ask it the same question again, in this thread", onclick: () => retry(failed) }, "Retry")));
      } else if (!asking || !row) ui.asks.replaceChildren();
      else {
        const w = askWords(asking);
        const name = row.card?.name || "It";
        ui.asks.replaceChildren(mk("div", { class: "ask-strip", role: "group", "aria-label": `${name} asks you` },
          mk("span", { class: "ask-who-name" }, name),
          askWhat(mk, asking, w.verb),
          w.what ? mk("code", { class: "ask-cmd", title: w.whole }, w.what) : null,
          answerControls(mk, { id: row.id, who: name, n: asking.n, offer: asking.offer || null, answer: io.answer, always: io.always, ...questionOf(asking), ...(o.place ? { place: o.place } : {}) }).el));
      }
    }
    if (row && row.status !== "running") st.watch.opened.add(answerKey(row));
    // Opened here, where its Retry is, a failure is seen: Now's row for it goes (lib/failures-seen.js).
    if (failed) markFailureSeen(failed);
  };

  function paint(/** @type {any} */ c) {
    // The gear's sheet is the chat's it opened on: another chat shown closes it, which would write to that one.
    if (ui?.sheet && String(c?.chainId || "") !== ui.sheetFor) ui.sheet.close();
    chat = c;
    if (!chat?.chainId) return;
    if (!ui) build();
    // Its words as Settings › Experimental's Teams switch has them.
    const teams = teamsOn(state.config);
    ui.leadEl.replaceChildren(teams ? LEAD : LEAD_ALONE);
    ui.listLineEl.replaceChildren(teams ? LIST_LINE : LIST_LINE_ALONE);
    const st = stateOf(chat);
    // The Teams row's pane while the switch is off — an address, a way into the teams, a pane left on it as the switch
    // moved — is the new thread's, in List and in Tiles.
    if (st.open === TEAM_HOME && !teams) st.open = NEW;
    watchRows(io.rows(), st.watch);
    paintSeats();
    paintMode();
    paintList();
  }

  /** Threads or Watch all: the one shown painted, the other let go. */
  function paintMode() {
    const st = stateOf(chat);
    const all = st.mode === "watch";
    ui.modes.paint();
    ui.watchLine.classList.toggle("hidden", !all);
    ui.besideBtn.classList.toggle("hidden", all || st.open === NEW || isTeamItem(st.open) || !io.openBeside);
    ui.watch.el.classList.toggle("hidden", !all);
    if (all) {
      ui.freshEl.classList.add("hidden");
      ui.threadEl.classList.add("hidden");
      ui.teamBox.classList.add("hidden");
      letGo();
      ui.watch.paint(io.rows(), io.own(), now());
    } else paintThread();
  }

  /** @param {"threads" | "watch"} mode */
  function setMode(mode) {
    if (!chat?.chainId) return;
    const st = stateOf(chat);
    if (st.mode === mode) return;
    st.mode = mode;
    if (ui) paint(chat);
  }

  /** The threads whose Retry is on its way: a second press sends nothing more. @type {Set<string>} */
  const retrying = new Set();
  /**
   * A failed thread asked again (the owner's word of 10-24: Retry goes on with the thread that failed, never a new
   * one): its question once more, on the same agent, as the thread's next exchange — from where its conversation
   * stands.
   * @param {import("../lib/subagents.js").SubagentRow} r
   */
  function retry(r) {
    if (!io.retry || retrying.has(r.id)) return;
    retrying.add(r.id);
    io.retry(r.id).then(
      () => paint(chat),
      (/** @type {any} */ e) => io.toast(String(e?.message || e), "err"),
    ).finally(() => retrying.delete(r.id));
  }

  /** @param {string} id @param {{ followUp?: boolean }} [o2] */
  function open(id, o2 = {}) {
    if (!chat?.chainId) return;
    stateOf(chat).open = id;
    stateOf(chat).mode = "threads";
    if (!ui) return;
    paint(chat);
    if (o2.followUp) shown?.followUp?.();
  }

  /**
   * `/btw <question>` from the chat's own box (HarnessV4_Tasks E15 step 5, BW-16): a launch that names the Ask start,
   * whose fields the server fills from its own table — what `/subagent start=ask` is for any other client, so it needs
   * nothing this tab reads when it first shows — and its thread is the one that shows. It throws where the launch is
   * refused, in the server's words.
   * @param {any} c  the chat the words were typed in
   * @param {string} question
   * @param {any[]} [files]  what was attached: pictures go as pictures, any other file as its text
   * @returns {Promise<string | null>}  why it cannot start, or null once its thread is open
   */
  async function ask(c, question, files = []) {
    if (!c?.chainId) return NO_SESSION_YET;
    const pdf = files.find((/** @type {any} */ a) => a.kind === "pdf");
    if (pdf) return pdfRefused(pdf.name);
    const texts = files.filter((/** @type {any} */ a) => a.kind !== "image").map((/** @type {any} */ a) => `\n\nFile: ${a.name}\n\`\`\`\n${a.text}\n\`\`\``).join("");
    const images = files.filter((/** @type {any} */ a) => a.kind === "image").map((/** @type {any} */ a) => ({ name: String(a.name || "picture"), mediaType: String(a.type || "image/png"), data: a.data }));
    const row = await io.launch({ start: BTW_START, prompt: `${question}${texts}`, ...(images.length ? { images } : {}) });
    stateOf(c).open = row.id;
    stateOf(c).mode = "threads";
    if (ui && chat === c) paint(c);
    return null;
  }

  /** The new thread's box; with a `tag`, it begins on that card. @param {string} [tag] */
  function fresh(tag) {
    if (!chat?.chainId) return;
    const st = stateOf(chat);
    st.open = NEW;
    st.mode = "threads";
    if (tag) st.draft = draftOn(null, tag);
    if (!ui) return;
    paint(chat);
    ui.task.focus?.();
  }

  /**
   * A new thread on a start, its tile chosen — Catch me up's, from the quiet line over the chat's box and the command
   * center: its question stands in the box, and nothing goes until Send. Before the starts are read, it is chosen once
   * they are.
   * @param {string} start
   */
  function begin(start) {
    if (!chat?.chainId) return;
    const st = stateOf(chat);
    st.open = NEW;
    st.mode = "threads";
    st.begin = start;
    if (!ui) return;
    paint(chat);
    ui.task.focus?.();
  }

  return {
    el,
    paint,
    open,
    fresh,
    begin,
    ask,
    /** What the tab says while another view shows; an answer shown beside the chat is opened too. @param {any} c */
    badge(c) {
      if (!c?.chainId) return null;
      const st = stateOf(c);
      const rows = io.rows();
      watchRows(rows, st.watch);
      for (const id of io.beside()) {
        const there = rows.find((r) => r.id === id);
        if (there && there.status !== "running") st.watch.opened.add(answerKey(there));
      }
      return sideBadge(rows, st.watch);
    },
    /**
     * An answer seen in the chat, its thread never opened: its card there hidden (the owner's of 11-01). Opened, as its
     * thread's showing makes it — its row's dot goes, and the tab counts it no more.
     * @param {any} c @param {string} id @param {number} exchange
     */
    seen(c, id, exchange) {
      if (c?.chainId) stateOf(c).watch.opened.add(exchangeKey(id, exchange));
    },
    /** What the pane shows for a chat: a thread's id, a team's row's, or "" for the new thread. @param {any} c */
    pane: (c) => (c?.chainId ? stateOf(c).open : ""),
    /** A chat's pane aimed at a row before the tab shows: it paints there when it does. @param {any} c @param {string} id */
    aim(c, id) {
      if (!c?.chainId) return;
      stateOf(c).open = id;
      stateOf(c).mode = "threads";
    },
    /** The view left the screen: the thread it followed is let go, and drawn again when it comes back; the gear's sheet closes. */
    close() {
      ui?.sheet?.close();
      letGo();
      if (boxFor && ui) stateOf(boxFor).files = ui.atts.list();
      boxFor = null;
    },
  };
}
