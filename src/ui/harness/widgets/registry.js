// @ts-check
// The widget registry (HarnessV3 Step 4 D8): which widgets exist, and where each one stands. A widget is a module
// that turns the widget context into a frame spec; placement is data — one table, slot → ids — so moving a widget
// is one line here and adding one is a module and a line. The composer only offers slots; the app builds the one
// context object and mounts this layout into them. Overview (proposal_ux §4.6, §5) is the other
// placement: three bands of tiles, each widget with its band and the sizes it takes, laid out as the person left it.
import { contextWidget } from "./context.js";
import { accountWidget } from "./account.js";
import { memoryWidget } from "./memory.js";
import { spendWidget } from "./spend.js";
import { cacheWidget } from "./cache.js";
import { speedWidget } from "./speed.js";
import { teamWidget } from "./team.js";
import { agentsWidget, turnWidget } from "./overview-now.js";
import { activityWidget, compactionsWidget, filesWidget, goalWidget, modelsWidget, tokensWidget } from "./overview-sofar.js";
import { changesWidget, forkWidget, howKeptWidget, mayWidget, rulesWidget, toldWidget, whoWidget } from "./overview-setup.js";

/**
 * Everything a widget reads and does — built once by the app. A widget never fetches (Facade D17): the session
 * view, the page's shared lists and the composer's live figures are all it reads, and every write goes through the
 * one writer.
 * @typedef {object} WidgetContext
 * @property {() => any} view  the open chat's session view (`{ settings, facts, windows, holder, memory }`), or null
 * @property {() => boolean} hasSession  whether the open chat's session exists yet (a new chat's does not)
 * @property {() => Record<string, any>} knobs  the settings registry's catalogue (the session settings' `knobs`)
 * @property {() => any[]} models  the page's shared model list (loaded at boot)
 * @property {() => LiveFigures} live  the composer's live figures: the reply's record and usage, the streamed output, the typed estimate
 * @property {() => any[]} turns  the open chat's turns as the transcript holds them (`{ n, user, facts, … }`, oldest
 *   first) — the per-turn figures Spend and Cache chart (each turn's `facts`: its tokens, cost and held figure)
 * @property {(change: { patch?: any, unset?: string[] }) => void} write  the one writer: the session's settings route
 * @property {(tokens: number | null) => void} setWindow  the window of the session's model, said by the person where
 *   nobody knew one (the session's window route; null takes it back) — it holds for every chat on that model
 * @property {(text: string) => void} command  a chat command, sent as the next message
 * @property {(line: string) => void} [addLine]  a line put at the top of the message box, nothing sent (`@mem load`)
 * @property {(id: string) => any} [sessionRow]  a chat's row in the page's sessions list, or null
 * @property {(page: "memory" | "upstreams") => void} openPage  one of the dashboard's pages
 * @property {() => any} memoryEngine  where memory's engine stands (`GET /api/memory/engine`, kept by the events feed's
 *   `engine`), or null until the page has read it (HarnessV3-AtHome AH-D2)
 * @property {(msg: string, kind?: string) => void} toast
 * @property {() => void} [summon]  Compact now… (proposal_ux §4.12 step 3, D6): the card that asks how to make room, with
 *   every way and what each leaves, after the chat's last turn — a press never compacts by itself
 * @property {() => void} [foldNow]  the instant fold now, the Context popover's offer: the earlier turns folded between turns, no
 *   model call, with Undo until the next message
 * @property {() => void} [openHow]  the sheet How earlier turns are kept (§4.12 step 4)
 * @property {() => void} stopAndCompact  Stop and compact (HarnessV3-RunawayTurns CW-D6): the running turn is stopped
 *   and the session compacted once it has ended; with no turn running it is Compact now
 * @property {(id: number) => void} undoCompaction  take the session's newest compaction back (its Undo, until the next message)
 * @property {() => Promise<any | null>} preview  the session's compose answer (Step 6 §2.2), cached by the host per
 *   conversation state — the window, the per-turn shapes, the carry forms' sweep, the compaction history and the
 *   compactor's plan (`compaction`: every way of making room, weighed — HarnessV3-Compaction §6); null without a session
 * @property {() => string} [previewKey]  the state that answer is for, as the host's cache names it: the session, its
 *   settings, its ended turns and its compactions. What shows the preview draws again when this moves; "" without a session
 * @property {(n: number) => boolean} scrollToTurn  scroll the conversation to a turn by number (the overview's "Open it
 *   in the chat") — false when the transcript holds no such turn
 * @property {() => void} dryRun  the request the composer would send for the draft, message by message
 * @property {WidgetSubagents} subagents  the open session's agents on the side
 * @property {WidgetMemory} memory  the owner's word on what memory did for the turn
 * @property {WidgetTeam} team  who answers the session: the Team view, and the switch back to your agent
 * @property {WidgetAccounts} accounts  the coding agents' accounts: the chosen agent's, Check now, a reset credit
 *
 * Overview's doors (proposal_ux §4.6) — each opens something, none starts or spends but Stop:
 * @property {() => any} [chat]  the open chat as the page holds it: its turns, its live turn, its goal, its folder's git
 * @property {() => { text: string, status: string }[]} [checklist]  the agent's checklist, as the Plan view reads it
 * @property {(id: string) => void} [openView]  one of the chat's views: chat, overview, side, team, plan
 * @property {(id: string) => void} [openPane]  a pane beside the chat: run, run:calls (the newest call), changes,
 *   next-request
 * @property {(id: string) => void} [openSetup]  one of the setup sheets (setup-sheet.js): who, may, memory, rules, fork,
 *   history
 * @property {() => void} [stopTurn]  Stop: the running turn stopped, as the box's Stop does
 * @property {() => any} [chatChanges]  what the chat's agents changed, as git says it (`totals`, `files`, `note`); null
 *   until it is read — the page reads it again as turns end
 * @property {() => any} [mayAsk]  whom the main agent may ask, as the Agents pane's row reads it (may-ask.js)
 * @property {(id: string) => void} [showWidget]  a widget's back, wherever it stands: its tile on Overview, else its pill
 * @property {(page: string, scope?: string) => void} [openLibrary]  a page of the Library (agents, skills, memory);
 *   Memory's opens on the workspace `scope` names, by its key or folder
 */

/**
 * The accounts door (HarnessV3-ACP AC3-6): the coding agents' accounts as the page keeps them (`lib/accounts.js`), and
 * what a person can ask of one — each through its route, after which the page holds the account as it then stands; a
 * refusal is said in a toast.
 * @typedef {object} WidgetAccounts
 * @property {() => import("../../lib/accounts.js").AgentRow | null} session  the agent the composer's model runs on and
 *   its account; null where that model is no coding agent's
 * @property {(upstream: string) => Promise<void>} check  *Check now*: the agent asked afresh, of that account and each
 *   other account of its agent at once
 * @property {(upstream: string) => Promise<string | null>} useResetCredit  one of a Codex account's reset credits, once
 *   the person confirms it on the app's sheet: Codex's word on it, null where none came
 * @property {() => import("../../lib/accounts.js").AgentRow[]} rows  every agent's accounts, the session's agent's
 *   others among them (HarnessV3-ACP AC3-7)
 * @property {(upstream: string, then?: { label: string, run: () => void }) => void} signIn  the sign-in sheet for an
 *   account: the sign-in under way, else a new one; `then`, what the sheet offers once it is signed in
 * @property {(upstream: string) => void} switchTo  the session's model moved to the same model on another account of
 *   its agent, as *Continue on* moves it, nothing sent; refused in a toast while a turn runs
 * @property {() => void} manage  where the accounts are kept: Settings → Coding agents
 */

/**
 * The team door (HarnessV3-Views VW-D7): the Team view, and the switch back to your agent — which the app confirms on
 * its sheet, and which waits while the session is busy.
 * @typedef {object} WidgetTeam
 * @property {() => void} open  the Team view
 * @property {() => boolean} [on]  Settings › Experimental's Teams switch (src/ui/lib/teams-on.js): off, no door hands
 *   the chat to a team
 * @property {() => void} back  back to your agent, through the switch's sheet
 * @property {() => string | null} wait  why a switch must wait now (a turn runs, a question waits, workers work), else null
 */

/**
 * The memory door (HarnessV3-Memory M6-4, M6-D1, M6-D2): the owner's word on a memory or a question of memory's, as
 * the open session's — each through its route, after which the app reads the turn's memory again into the view. A
 * route's refusal comes back as its answer (`ok: false`, `error`).
 * @typedef {object} WidgetMemory
 * @property {(id: string) => Promise<any>} confirm  a memory proved right: the user's word from now on
 * @property {(id: string, text: string) => Promise<any>} correct  what is true now replaces it
 * @property {(id: string) => Promise<any>} forget  it was never true: retired, kept as history
 * @property {(id: string, answer: "accept" | "reject") => Promise<any>} answer  one of memory's questions answered
 */

/**
 * The session's agents on the side, as the widgets read them (HarnessV3 §15 item 86): the page's shared list (the
 * status panel reads the same). A widget never fetches.
 * @typedef {object} WidgetSubagents
 * @property {() => import("../lib/subagents.js").SubagentRow[]} rows  the session's agents on the side, newest first
 * @property {() => any[]} models  the catalogue one can run on
 * @property {() => string} sessionModel  the model the session runs on — theirs too for the nameless row of its pool
 * @property {() => import("../lib/subagents.js").CacheState} cache  how warm the main agent's cache is, counted down to now
 */

/**
 * @typedef {{ rec: any, usage: any, facts: any, liveOut: number, estimate: number, streaming: boolean, liveHeld?: number,
 *   liveOutBase?: number, liveWindow?: number | null, liveExact?: boolean, agent?: boolean,
 *   speed?: import("../lib/speed.js").SpeedFigure | null, call?: { input: number, cacheRead: number, cacheWrite: number, at: number, ttlMs?: number } | null,
 *   usedAt?: number | null }} LiveFigures
 *   `liveHeld`: what the running turn holds now — the loop's own measure of what a round sends (its round-start's
 *   `context`), or a coding agent's own count as it works (its run's `held`, HarnessV3-ACP AC3-5); `liveOutBase`: the
 *   streamed output when that figure came — the meter adds only what streamed after it (BUG-20); `liveWindow`: the
 *   window the agent names; `liveExact` false: Filament's estimate stands in for the agent's count; `agent`: the
 *   session's model is a coding agent's, which keeps its own context and compacts it itself; `speed`: how fast the
 *   model writes (HarnessV3-AtHome AH-S1); `call`: the shown chat's newest model call its runs said (`round-cache`) —
 *   its prompt as the provider counted it, and when — the Cache instrument's last request while no newer one is booked;
 *   its `ttlMs`, the cache lifetime its writes asked for where the provider said (a coding agent's own markers);
 *   `usedAt`: the running turn's newest use of the cache the page saw — its start, else the newest moment its model wrote
 */

/** @typedef {(ctx: WidgetContext, io?: import("./frame.js").WidgetIO) => import("./frame.js").WidgetSpec} WidgetBuilder */

/** Every widget by its id. @type {Readonly<Record<string, WidgetBuilder>>} */
export const WIDGETS = Object.freeze({
  account: accountWidget,
  context: contextWidget,
  memory: memoryWidget,
  spend: spendWidget,
  cache: cacheWidget,
  speed: speedWidget,
  team: teamWidget,
  turn: turnWidget,
  agents: agentsWidget,
  tokens: tokensWidget,
  activity: activityWidget,
  files: filesWidget,
  compactions: compactionsWidget,
  models: modelsWidget,
  goal: goalWidget,
  who: whoWidget,
  may: mayWidget,
  kept: howKeptWidget,
  rules: rulesWidget,
  told: toldWidget,
  fork: forkWidget,
  changes: changesWidget,
});

/**
 * Where each widget stands, slot by slot, in order (HarnessV3 Step 6 design): the composer's typing row (`bar`,
 * beside the model — the figures watched while typing, the agent's plan (HarnessV3-ACP AC3-6) and the window, and who
 * answers what you type: HarnessV3-Views VW-D7) and the strip under the composer — how Filament treats the conversation
 * on its left (`strip`), how fast the model writes and what it costs on its right (`meters`: HarnessV3-AtHome AH-S1).
 * The View and Compaction pills left the strip (HarnessV4_Tasks U3-4, UX-1):
 * what they held is the context ring's popover and the Context tab's section. The Watch pill stands there only while
 * a card that watches is switched on in the chat (HarnessV4_Tasks E15 step 7). The Task graph pill left it with the
 * graph's switch (the owner's words of 10-29): the task graph is always on. The Memory pill left it too (the owner's
 * of 10-30): its Overview tile opens the same card, and where the chat works stands in its
 * place (header.js `place`).
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const DEFAULT_LAYOUT = Object.freeze({
  bar: Object.freeze(["account", "context", "team"]),
  strip: Object.freeze([]),
  meters: Object.freeze(["speed", "cache", "spend"]),
});

/**
 * The widgets a slot holds under a layout, in order; an id the registry does not know is left out.
 * @param {string} slot @param {Readonly<Record<string, readonly string[]>>} [layout]
 */
export function widgetsFor(slot, layout = DEFAULT_LAYOUT) {
  return (layout[slot] || []).filter((id) => Object.hasOwn(WIDGETS, id));
}

/** @typedef {import("./frame.js").TileSize} TileSize */
/** @typedef {"now" | "sofar" | "setup"} BandId */

/** Overview's three bands (proposal_ux §4.6), in order: live at the top, history in the middle, settings last. */
export const OVERVIEW_BANDS = Object.freeze([
  Object.freeze({ id: /** @type {BandId} */ ("now"), title: "Right now", sub: "live, as the agent works" }),
  Object.freeze({ id: /** @type {BandId} */ ("sofar"), title: "This chat so far", sub: "since it started" }),
  Object.freeze({ id: /** @type {BandId} */ ("setup"), title: "How it is set up", sub: "change it here · each setting says where it comes from: this chat beats the project, the project beats yours · ↺ puts this chat's own back" }),
]);

/**
 * Each widget Overview can hold: its band and the sizes it takes (§5.1; its default first). The default layout is this
 * table's order, band by band.
 * @type {Readonly<Record<string, { band: BandId, sizes: readonly TileSize[] }>>}
 */
export const TILES = Object.freeze({
  context: { band: "now", sizes: ["L", "M"] },
  turn: { band: "now", sizes: ["M"] },
  speed: { band: "now", sizes: ["S", "M"] },
  cache: { band: "now", sizes: ["S", "M"] },
  account: { band: "now", sizes: ["M"] },
  agents: { band: "now", sizes: ["M"] },
  tokens: { band: "sofar", sizes: ["M", "S"] },
  activity: { band: "sofar", sizes: ["M", "S"] },
  memory: { band: "sofar", sizes: ["M"] },
  files: { band: "sofar", sizes: ["M"] },
  compactions: { band: "sofar", sizes: ["S", "M"] },
  spend: { band: "sofar", sizes: ["S", "M"] },
  models: { band: "sofar", sizes: ["M"] },
  goal: { band: "sofar", sizes: ["M"] },
  who: { band: "setup", sizes: ["M"] },
  may: { band: "setup", sizes: ["M"] },
  // Five rows each, changed in place (the design pass of 10-24): two cells high.
  kept: { band: "setup", sizes: ["L", "M"] },
  rules: { band: "setup", sizes: ["L", "M"] },
  told: { band: "setup", sizes: ["M"] },
  fork: { band: "setup", sizes: ["S"] },
  changes: { band: "setup", sizes: ["S"] },
});

/**
 * The person's Overview, as kept (one for every chat, §5.5): each band's order, the sizes changed, and the widgets taken
 * off. What it does not say is the default's.
 * @typedef {{ order?: Record<string, string[]>, sizes?: Record<string, string>, off?: string[] }} SavedOverview
 */

/**
 * Overview's tiles band by band, from what the person kept: the band's order as left, then the band's other widgets in
 * the default's order — so a widget a later version adds shows up —, less those taken off; each at its kept size where
 * the widget takes it, else its default. Whatever the saved words are, the answer only holds widgets the registry
 * knows, once each, in their own band.
 * @param {SavedOverview | null | undefined} saved
 * @returns {Record<BandId, { id: string, size: TileSize }[]>}
 */
export function overviewLayout(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  const off = new Set(Array.isArray(s.off) ? s.off : []);
  const shows = (/** @type {string} */ id) => Object.hasOwn(TILES, id) && Object.hasOwn(WIDGETS, id) && !off.has(id);
  /** @type {Record<BandId, { id: string, size: TileSize }[]>} */
  const out = { now: [], sofar: [], setup: [] };
  for (const band of OVERVIEW_BANDS) {
    const kept = Array.isArray(s.order?.[band.id]) ? s.order[band.id] : [];
    const ids = [...new Set([...kept, ...Object.keys(TILES)])].filter((id) => shows(id) && TILES[id].band === band.id);
    out[band.id] = ids.map((id) => {
      const want = /** @type {TileSize} */ (s.sizes?.[id]);
      return { id, size: TILES[id].sizes.includes(want) ? want : TILES[id].sizes[0] };
    });
  }
  return out;
}

/** The widgets Overview can add now: those taken off. @param {SavedOverview | null | undefined} saved */
export function overviewGallery(saved) {
  const shown = new Set(Object.values(overviewLayout(saved)).flat().map((t) => t.id));
  return Object.keys(TILES).filter((id) => Object.hasOwn(WIDGETS, id) && !shown.has(id));
}
