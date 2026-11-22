// @ts-check
// The left bar (proposal_ux §3.2, §4.1): the top bar (Hide, the Settings gear), New chat and Search (→ the command
// center), Your Space once a Space is extended (HarnessV4_Space_Plan S5b: its count the chats' that need you and every
// project's kept rows), then the one scroll region (the owner's of 11-01): Now (now-list.js: what needs you, what works,
// what finished, every project; D7) — under the rest while "Now on top" is off —, Pinned while something is, and
// Projects (the archive's chats grouped by memory project, or by time) under a header with Add project and the
// filter menu (Group by, Sort by, Now on top, Show archived, Rounds and agents, Expand or collapse all: V6) — and the
// Library at the foot (Agents and teams, Skills, Memory, Plugins & Connectors, Artifacts, each with its count: V4), which
// folds as Now does (the owner's word of 10-26). One chat, one place (the Designer's of 10-27, on the owner's words:
// "two same things showing at the same time is not a good design"): a chat Now has a row of its own for stands there and
// not under its project or Pinned, and a pinned chat stands under Pinned alone — so it is selected in one place. It
// rises into Now when its work starts and goes home after its quiet minute, never while the pointer is on the bar, each
// move drawn as a flight (bar-flight.js); folded, Now leaves every chat home, a folded project's head marking one of
// its own at work. Each project's folder takes its chip's colour, the chip a row in Now names it by. A chat row
// carries every state (an error dot, an unread dot, a running spinner, the orange dot of a chat that waits for you, the
// pin on hover, the context menu); wide — the bar dragged past 300 px, or a window 2200 px or wider — each row gets a
// second line, where it works and what it does. A team on the side of a chat stands under its row, "↳ BugHunters" with
// a "side" tag and its state (HarnessV4_Tasks U13-D5). Hidden (Ctrl+B), the bar leaves its rail: New chat, Search, Now with
// its count (pointing at it lists Now; a press opens the row picked), Projects, the Library's five and Settings. A chat
// that has no archive row yet — its first turn is streaming — is drawn as a local row under its project from what the
// developer typed, so a chat is visible from its first message; the archive's row replaces it when the record lands.
// Live marks come from the /api/events fan-out (a run's chain is mapped once through its request record).
import { h, morph, morphChildren, placeChildren, setHtml } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { onBus } from "./lib/bus.js";
import { pageShown, whenPageShown } from "./lib/page-shown.js";
import { atWork, state } from "./state.js";
import { sessionAge, rowMoment, timelineBucket, workingWords, fromAgentsWords, threadsNested, threadOfWords, firstMessageName, whereLine, apartMark, placeSaid, localProject, chipProject, branchWords, placeName, sideChatsUnder, besideNamed, projectCountWords } from "./lib/labels.js";
import { ICONS, glyphOf, icon } from "./lib/icons.js";
import { menu, confirmDialog, dialog, tooltip, popover, toast } from "./lib/ui.js";
import { chipTone, createNow } from "./now-list.js";
import { awayWords, deskGroups, deskListKey, deskMarks, deskProjects, deskRoute, ownKeysOf, readDesk } from "./lib/desk.js";
import { holdersWhileSent, teamLine } from "./lib/now.js";
import { barHold, notePlaces, playMoves } from "./bar-flight.js";
import { WORDS } from "./lib/words.js";
import { agentsCount } from "./lib/agent-cards.js";
import { agentsLabel, teamsOn } from "../lib/teams-on.js";
import { needYouWords, yourCount } from "./lib/your-space.js";
import { deleteOwnSpace, newSpaceSheet } from "./space/new-space.js";
import { ROUTINES, WATCHERS } from "./space/dashboards.js";
import { tabOf } from "./lib/space-dashboards.js";
import { backWords, lanePlaces } from "./lib/space-view.js";
import { gitMovedFor } from "./lib/git-moved.js";
import { updateNotice } from "./lib/update-notice.js";
import { telemetryNotice } from "./lib/telemetry-notice.js";
import { starNotice } from "./lib/star-notice.js";
import { comboOf } from "./shortcuts.js";

const ORG_KEY = "harness.organize";
const INTERNAL_KEY = "harness.sidebar.internal";
const SORT_KEY = "harness.sidebar.sort";
const NOW_TOP_KEY = "harness.sidebar.nowTop";
/** Whose chats the bar lists in the desktop app (the remote desk of 11-22): "here", This computer's alone; else every machine's. */
const MACHINES_KEY = "harness.sidebar.machines";
/** The machines it leaves out, by id (a JSON list). */
const MACHINES_HIDDEN_KEY = "harness.sidebar.machinesHidden";
/** Whether the Library at the foot is open: "0" folded (the owner's word of 10-26), anything else open. */
const LIB_OPEN_KEY = "harness.sidebar.libraryOpen";
/** What a non-interactive row is, in a word, for its badge. */
const KIND_LABEL = { tick: "round", subagent: "agent" };
/**
 * The Library's five (proposal_ux §4.1, §4.15; Plugins, HarnessV4_SpacesPlugins_Plan B5, and Connectors, the
 * Designer's of 10-26, one row since the owner's of 11-09): each page's name, glyph and what it holds.
 */
const LIBRARY = /** @type {const} */ ([
  { id: "agents", label: "Agents and teams", icon: "atSign", tip: "Your agents and teams, and the models each runs on by default" },
  { id: "skills", label: "Skills", icon: "wandSparkles", tip: "What every agent knows how to do" },
  { id: "memory", label: "Memory", icon: "brain", tip: "What Filament knows" },
  { id: "plugins", label: "Plugins & Connectors", icon: "puzzle", tip: "Your connectors (MCP servers) and Claude Code's and Codex's plugins: the tools your chats reach" },
  { id: "artifacts", label: "Artifacts", icon: "shapes", tip: "The pages your agents made" },
]);
/**
 * A Library row's name and what it holds, the agents' page as Settings › Experimental's Teams switch has it
 * (src/ui/lib/teams-on.js): Agents, your agents alone, while teams are off.
 * @param {typeof LIBRARY[number]} it
 */
const libLabel = (it) => (it.id === "agents" ? agentsLabel(state.config) : it.label);
/** @param {typeof LIBRARY[number]} it */
const libTip = (it) => (it.id === "agents" && !teamsOn(state.config) ? "Your agents, and the models each runs on by default" : it.tip);
/** How long the Library's counts stand before a look at the bar reads them again. */
const LIBRARY_FRESH_MS = 120_000;

/** How long a press on the list may hold its redraw. */
const PRESS_HOLD_MS = 3000;
/** How long a pointer resting on the bar holds its moves between Now and the projects. */
const REST_MS = 10_000;
/** How long a name the side model gave a chat takes to write itself in on its row (harness.css `.sess-title.is-named`). */
export const NAMED_MS = 900;
/** How long the page holds such a name over a list read asked before it came: longer than any read takes. */
const NAMED_HOLD_MS = 60_000;

/**
 * A Space's apps and dashboards as rows under it (the owner's idea of 10-29), each as its tab said it — "Pulse · draft",
 * paused, a red dot where a source it reads fails or a script it runs waits for your Keep, its tip their words.
 * @param {any[]} list  `GET /api/spaces`'s apps of one Space @param {number} now
 */
export const appRowsOf = (list, now) =>
  list.map((d) => {
    const t = tabOf(d, now);
    return { key: String(d.name), label: t.label, tip: t.tip, cls: [t.draft ? "is-draft" : "", t.paused ? "is-paused" : ""].filter(Boolean).join(" "), dot: t.fault || t.held, dotSays: t.fault ? "couldn't read" : "waits for your Keep", ic: d.type === "app" ? ICONS.appWindow : ICONS.layoutDashboard };
  });

/**
 * Plugins & Connectors' count: the plugins installed, and the connectors of all chats that are no plugin's — a plugin's
 * come with it, so each thing counts once (the owner's of 11-09); a switch left for a server that is gone (`orphan`) is
 * no connector. Null where a list was not read.
 * @param {any} plugins  `GET /api/plugins/installed` @param {any} connectors  `GET /api/mcp-servers?scope=all`
 * @returns {number | null}
 */
export const pluginsCount = (plugins, connectors) =>
  plugins && connectors
    ? (Array.isArray(plugins.plugins) ? plugins.plugins.length : 0) + (Array.isArray(connectors.servers) ? connectors.servers.filter((/** @type {any} */ s) => s && !s.plugin && !s.orphan).length : 0)
    : null;

/** The empty left bar of a view-only device's page (p4-view-ui): it starts nothing, so it offers no folder nor Space. */
export const VIEW_ONLY_BAR_WORDS = "This device is view-only: it reads this Filament's chats, and starts none.";

/**
 * @param {HTMLElement} host
 * @param {{ onNew: () => void, onOpen: (session: any) => void, onSelectChat: (id: string) => void,
 *   onChanged: () => void, onReveal?: () => void,
 *   onAddProject?: () => void, onRename?: (s: any, title: string) => void, onToast?: (msg: string, kind?: string) => void,
 *   onForkSession?: (s: any) => void, onLoadSession?: (s: any) => void, onSearch?: () => void, onSettings: () => void,
 *   onLibrary?: (page: "agents" | "skills" | "memory" | "artifacts" | "plugins") => void, onSpace?: (project: string, tab?: string) => void,
 *   onSpacePlaces?: (project: string) => void,
 *   onYourSpace?: () => void,
 *   onOpenThread?: (session: any, thread: string) => void, onOpenFolder?: () => void,
 *   besideChat?: (chain: string) => { name: string, main: string } | null,
 *   askedChats?: () => ReadonlyMap<string, { line: string, at: number, working?: boolean }>,
 *   compactingChats?: () => ReadonlyMap<string, { at: number }>,
 *   onHide: () => void, onProjectGone?: (cwd: string) => void, onDeleted?: (id: string) => void, onAtWork?: () => void,
 *   onCommands?: () => void, onComeBacks?: () => void, onSpaces?: () => void, viewOnly?: () => boolean }} cb
 *   `besideChat`: a team beside's chat the page heard of — its team, and the chat it runs beside; `askedChats`: the
 *   page's chats whose message a card stopped, each with its card's question, which Now lists as needing you — or at
 *   work, room made for that message or the message gone again; `compactingChats`: the chats whose compaction is
 *   written between their turns, and when it began, which Now lists under Working; `onDeleted`: a chat
 *   deleted here, gone from the archive; `onAtWork`: who is at work moved — a run began or ended, a turn's holder came
 *   or went (state.js `atWork`); `onCommands`: the five-second read set the running commands right (E38-D4);
 *   `onComeBacks`: it set the chats' come-backs right (the Designer's of 10-27); `onSpaces`: which projects have a Space,
 *   and the Spaces of your own, moved (`spaceFor`); `viewOnly`: the page is a view-only device's, which starts nothing
 *   — no project added, no folder opened, no Space made (p4-view-ui)
 * @param {HTMLElement | null} [rail]  the rail the hidden bar leaves (shell.js); its buttons are drawn here
 */
export function createSidebar(host, cb, rail = null) {
  let organizeBy = "workspace";
  let showArchived = false;
  let showInternal = false;
  let nowOnTop = true;
  let sortBy = "updated";
  /** @type {Set<string>} projects archived from the tree; their sessions stay out unless "Archived" is on */
  let archivedProjects = new Set();
  try {
    // "machine" groups by machine first, where the desktop app keeps another (the remote desk of 11-22).
    const org = localStorage.getItem(ORG_KEY);
    organizeBy = org === "grouped" || org === "machine" ? org : "workspace";
    showInternal = localStorage.getItem(INTERNAL_KEY) === "1";
    sortBy = localStorage.getItem(SORT_KEY) === "created" ? "created" : "updated";
    nowOnTop = localStorage.getItem(NOW_TOP_KEY) !== "0";
  } catch {}
  /** @param {string} key @param {string} value */
  const keep = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

  let query = "";
  // Drawn in place (dom.js `morphChildren`; the owner's of 11-01: buttons blinking under a resting pointer, presses
  // lost): a part drawn again is the element that stood, keyed by `data-key`, its words and handlers the newest draw's.
  // So what holds an element of the list finds the one that stands, never one a draw made.
  const list = h("div", { class: "sess-list" });
  /** @type {Map<string, HTMLDetailsElement>} project id → its <details> as it stands, for expand/collapse all */
  const projectEls = new Map();
  /** A project's expand state the developer set by hand — a draw (a run's mark that moved, a list read) rebuilds the
   * list; without this the groups snapped back to their default open/closed each time. */
  const openState = new Map();
  /**
   * What a project's parts that show who is at work in it draw again, by project — its folded head's mark, its Space
   * row's count —, from the last draw's facts into the parts that stand: a turn that begins or ends draws those and its
   * chat's rows, not the bar (`patchChats`). @type {Map<string, (() => void)[]>}
   */
  const atWorkParts = new Map();
  /** How many times the bar was drawn whole: a patch that set off a whole draw has nothing left to do. */
  let draws = 0;
  /**
   * What each chat that waits for you was drawn waiting on (`now.factOf`), by chat: a question that changes while the
   * run stays paused moves nothing the list hears, and the tick draws that chat's rows again (`paintAges`).
   * @type {Map<string, string>}
   */
  const factsSaid = new Map();
  // Now's place in the bar's one scroll region: over the projects, or under them while "Now on top" is off (the owner's of
  // 11-01: a slot of its own, at most 45% of the bar, filled with a chat's dozen agents at work, and the projects under it
  // had a strip of their own to scroll in).
  const nowTop = h("div", { class: "now-slot" });
  const nowBottom = h("div", { class: "now-slot is-foot" });
  // A press on the list or on Now holds their redraw until the press ends (the performance Hunter's find of 10-25, Now's
  // rows the Hunter's of 10-27): the list is drawn anew whole, a chat's rows anew as its turn begins or ends, Now each
  // time its round line moves on, and a row replaced while a pointer is down on it lost its click. Held a few seconds at
  // most, for a release the page never hears. Moves wait while the pointer is on the bar or a menu it opened (the Designer's of 10-27): a
  // pointer that rests REST_MS lets them go, and leaving plays them at once (bar-flight.js barHold).
  let drawHeld = false;
  /** Now's own draw that came during a press, drawn once it ends. @type {(() => void) | null} */
  let nowHeld = null;
  const hold = barHold(host, [list, nowTop, nowBottom], {
    rest: REST_MS,
    press: PRESS_HOLD_MS,
    onLeave: () => now.refresh(),
    // After the release's click, which reaches the row it pressed.
    onRelease: () => {
      if (drawHeld || nowHeld) setTimeout(() => { if (drawHeld) draw(); else if (nowHeld) paintNow(nowHeld); }, 0);
    },
  });
  /** Why the list's last load failed, said in its place until a load succeeds; null if it did. @type {string | null} */
  let loadFailed = null;
  /** The chats' list has been read once: until then nothing is known to be missing, so no draw says the bar is empty. */
  let listRead = false;
  /** The teams' chats on the side of a chat (HarnessV4_Tasks U13-D5), as the sessions list answers `kind=team`: each
   * stands under its chat's row. @type {any[]} */
  let sideChats = [];
  /** Each chat's teams on its side, as the last draw read them. @type {ReturnType<typeof sideChatsUnder>} */
  let under = new Map();
  /** Each chat's threads drawn under its row (labels.js `threadsNested`), as the last draw placed them. @type {Map<string, any[]>} */
  let threadsUnder = new Map();
  /** How deep each thread drawn under its starter stands: 1 under a chat that stands, 2 under a thread of it… @type {Map<string, number>} */
  let threadDepth = new Map();
  /**
   * A list's chats as the bar draws them: each thread under the chat that started it where the list holds it, kept for
   * that chat's rows (`rowsOf`) and for its row's patch (`sessionRow`); the rows that stand in the list come back.
   * @param {any[]} rows
   */
  const nestThreads = (rows) => {
    const { top, under: nested } = threadsNested(rows);
    /** @param {any[]} list @param {number} depth */
    const mark = (list, depth) => {
      for (const s of list) {
        threadDepth.set(String(s.id), depth);
        mark(nested.get(String(s.id)) || [], depth + 1);
      }
    };
    for (const s of top) mark(nested.get(String(s.id)) || [], 1);
    for (const [from, list] of nested) threadsUnder.set(from, list);
    return top;
  };
  /** A chat's row, with the teams on its side under it — but one whose lead asks you, which stands in Now — and its threads. @param {any} s @param {{ timeline?: boolean }} [o] @returns {HTMLElement[]} */
  const rowsOf = (s, o = {}) => [
    sessionRow(s, o),
    ...(under.get(String(s.id)) || []).filter((x) => !now.stands(String(x.s.id))).map(sideRow),
    ...(threadsUnder.get(String(s.id)) || []).flatMap((t) => rowsOf(t, o)),
  ];
  /** A chat of the list by its chain; null for one it does not hold (a team's on the side). @param {string} chain */
  const sessionOf = (chain) => (state.sessions || []).find((x) => x.id === chain) || null;

  /** Set while the bar draws: a move Now hears of meanwhile is this draw's to draw. */
  let drawing = false;
  /** Set while the page's first read of the runs places what already works: still, as the page only just opened. */
  let still = false;
  let runsRead = false;
  /** Whether the bar's moves are drawn: not before the runs were first read, nor while they are. */
  const moving = () => runsRead && !still;
  /** The key of the bar's part that holds the focus, so it is focused again once the bar is drawn anew: it moves with its row. */
  const focusedKey = () => {
    const a = typeof document === "undefined" ? null : document.activeElement;
    return a && host.contains(a) ? a.closest?.("[data-flip]")?.getAttribute("data-flip") || null : null;
  };
  /** @param {string | null} key */
  const refocus = (key) => {
    if (key) /** @type {HTMLElement | null} */ (host.querySelector(`[data-flip="${CSS.escape(key)}"]`))?.focus({ preventScroll: true });
  };

  // --- Now (now-list.js) ---
  /** The chats a send of this page waits in, its answer on its way (state.js `atWork`). */
  const sendingChains = () => [...state.chats.values()].filter((c) => c.live && c.chainId).map((c) => String(c.chainId));
  /** The holder Now read last for each of them, while the server's word is gone (lib/now.js `holdersWhileSent`). @type {Map<string, any>} */
  const keptHolders = new Map();
  /**
   * The chats the side model just named, and when (Settings › Experimental): their rows write the name in, and a list
   * read asked before the name came keeps it (`load`). @type {Map<string, { title: string, at: number }>}
   */
  const justNamed = new Map();
  /**
   * How far a name the side model just gave a chat has written itself in, in ms, for a row that shows it: null once it
   * is written, and for another title.
   * @param {string} chain @param {string} title @returns {number | null}
   */
  const namedSince = (chain, title) => {
    const n = justNamed.get(String(chain));
    if (!n) return null;
    const since = Date.now() - n.at;
    if (since >= NAMED_HOLD_MS) justNamed.delete(String(chain));
    return since < NAMED_MS && n.title === title ? since : null;
  };
  const now = createNow({
    chats: chatFacts,
    unread: () => new Set([...state.unreadChains, ...(state.sessions || []).filter((s) => s.unread).map((s) => String(s.id))]),
    holders: () => holdersWhileSent(state.holders, sendingChains(), keptHolders),
    commands: () => state.commands,
    comeBacks: () => state.comeBacks,
    idleWakes: () => state.idleWakes,
    stretches: () => state.stretches,
    flows: () => state.flows,
    apps: () => state.appRuns,
    asked: () => cb.askedChats?.() || new Map(),
    compacting: () => cb.compactingChats?.() || new Map(),
    onOpen: (r) => { railPop?.close(); openRow(r); },
    onSeen: (chains) => { for (const c of chains) markSeen(c); now.refresh(); draw(); },
    onCount: (needs, works) => {
      paintRailNow(needs, works);
      paintYourRow();
    },
    current: () => [...state.chats.values()].find((c) => c.id === state.currentId)?.chainId || null,
    // No chat's row marked while a Space is on screen: its row in the bar is the mark (`atSpace`).
    marked: () => (spaceAt ? null : [...state.chats.values()].find((c) => c.id === state.currentId)?.chainId || null),
    // A team on the side at work is a line under the chat it works for (the Designer's answer of 10-27).
    beside: (chain) => besideOf(chain),
    // This Now decides where the bar's chats stand: here or under their project, never both.
    place: true,
    held: () => hold.held(),
    onMoved: () => { if (!drawing) draw(); },
    paint: (fn) => paintNow(fn),
    // A chat's row in Now is its row: the same menu and Delete as under its project.
    onMenu: (r, anchor) => { const s = sessionOf(r.chain); if (s) chatMenu(s, anchor); },
    onDelete: (r) => { const s = sessionOf(r.chain); if (s) void deleteChat(s); },
    // The other machines' rows among its own, while the bar lists every machine's (the remote desk of 11-22).
    more: () => deskNow(),
    onOpenMore: (r) => { railPop?.close(); openThere(r); },
    onSeenMore: (rows) => { seenThere(rows); now.refresh(); },
    named: namedSince,
  });

  // --- the desk (the remote desk of 11-22): every other machine's chats beside this computer's, in the desktop app ---
  // The app tells this computer's page alone what its watch found on each machine kept (lib/desk.js reads it); in a
  // browser, and on another machine's page, there is none, and the bar is as it was.
  /** The desk as the app last told it; null until it does. @type {import("./lib/desk.js").Desk | null} */
  let desk = null;
  /** Every machine's chats, or This computer's alone (the filter menu's Machines), and the machines left out. */
  let allMachines = true;
  /** @type {Set<string>} */
  let hiddenMachines = new Set();
  try {
    allMachines = localStorage.getItem(MACHINES_KEY) !== "here";
    const hidden = JSON.parse(localStorage.getItem(MACHINES_HIDDEN_KEY) || "[]");
    hiddenMachines = new Set(Array.isArray(hidden) ? hidden.map(String) : []);
  } catch {}
  /**
   * Another machine's Done rows cleared or opened here, each at the moment it stood at: gone at once, where its machine's
   * list says it next a moment later. @type {Map<string, number>}
   */
  const clearedThere = new Map();
  /** Whether the bar lists the other machines' chats now: the app keeps one, and the person wants them. */
  const deskOn = () => !!desk?.machines.length && allMachines;
  /** Whether the projects' list holds theirs: by project or by machine, not by time nor in the Archived view. */
  const deskListed = () => deskOn() && organizeBy !== "grouped" && !showArchived;
  /** What the list last drew of the desk (lib/desk.js `deskListKey`), "" for none. */
  let deskDrawn = "";
  /** What it would draw of it now. */
  const deskListNow = () => (deskListed() ? deskListKey(desk, now.theirsShown(), deskMarks(deskNow())) : "");
  /** The other machines' Now as the bar draws it: those left out and the Done rows cleared here gone. @returns {import("./lib/desk.js").DeskGroups | null} */
  function deskNow() {
    if (!desk || !deskOn()) return null;
    // Cleared ones let go once their machine's list says them no more, a machine left out too (the review of s1b).
    const every = deskGroups(desk).done;
    for (const [key, at] of clearedThere) if (!every.some((r) => r.key === key && r.at === at)) clearedThere.delete(key);
    const g = deskGroups(desk, hiddenMachines);
    return { ...g, done: g.done.filter((r) => !clearedThere.has(r.key)) };
  }
  /**
   * Another machine's row opened: that machine's page in the window, at its chat (the app's `openOn`), which marks it
   * seen there as it opens it. @param {import("./lib/desk.js").DeskRow} r
   */
  function openThere(r) {
    if (r.group === "done") clearedThere.set(r.key, r.at);
    void (/** @type {any} */ (globalThis).filamentApp?.openOn?.(r.machine.id, deskRoute(r.there)))?.catch?.(() => {});
    now.refresh();
  }
  /** Another machine's Done cleared: each marked seen there, through the app (harness-preload.cjs `seen`). @param {import("./lib/desk.js").DeskRow[]} rows */
  function seenThere(rows) {
    /** @type {Map<string, string[]>} */
    const by = new Map();
    for (const r of rows) {
      clearedThere.set(r.key, r.at);
      by.set(r.machine.id, [...(by.get(r.machine.id) || []), r.there.chain]);
    }
    const bridge = /** @type {any} */ (globalThis).filamentMachines;
    for (const [id, chains] of by) void bridge?.seen?.(id, chains)?.catch?.(() => {});
  }
  {
    const bridge = /** @type {any} */ (globalThis).filamentMachines;
    if (typeof bridge?.onDesk === "function")
      bridge.onDesk((/** @type {unknown} */ d) => {
        desk = readDesk(d);
        now.refresh();
        // Their chats stand under the projects too: the list drawn again where what it shows of them moved — not at each
        // word their agents say, which Now alone draws (the review of s1b).
        if (deskDrawn !== deskListNow()) draw();
      });
  }

  /**
   * Now's own draws — its round line moving on — move its rows, and the list's under it, from where they stood; one
   * that comes while a press holds the bar waits for the release.
   * @param {() => void} fn
   */
  function paintNow(fn) {
    if (!drawing && hold.pressing()) {
      nowHeld = fn;
      return;
    }
    nowHeld = null;
    if (drawing) { fn(); return; }
    const key = focusedKey();
    const before = moving() ? notePlaces(host) : new Map();
    fn();
    refocus(key);
    playMoves(host, fly, before, { homeOf });
    // Now folded or Earlier pressed moves which of the other machines' chats stand in it, and so under the projects.
    if (deskDrawn !== deskListNow()) draw();
  }

  /**
   * A team beside a chat's chat: its team and the chat it works for, as the page heard of it — else as the list of team
   * chats names it, for one started in another window or before the page opened; null for a chat of the bar.
   * @param {string} chain
   */
  function besideOf(chain) {
    return (state.sessions || []).some((x) => x.id === chain) ? null : cb.besideChat?.(chain) || besideNamed(sideChats, chain);
  }

  /** A chat as Now names it: its title, its project, its newest activity. @param {string} chain */
  function chatFacts(chain) {
    const s = (state.sessions || []).find((x) => x.id === chain) || null;
    const c = [...state.chats.values()].find((x) => x.chainId === chain) || null;
    // A team beside a chat is no row of the bar (team_v2_plan §5.3): Now names it by its team and the chat it works for,
    // as it names an agent's thread ("Reviewer · for opus55", the Designer's answer of 10-27).
    const beside = !s ? besideOf(chain) : null;
    if (beside) {
      const main = beside.main !== chain ? chatFacts(beside.main) : null;
      return { title: `${teamLine(beside.name)} · for ${main?.title || "a chat"}`, project: main?.project || "", when: main?.when || 0, unread: false };
    }
    if (!s && !c) return null;
    // The page's chat's name before what was typed: a chat the side model names in its first turn is in no list of the
    // server's until that turn ends (the owner's report of 11-07), as its row under Projects and the header read it.
    const title = s?.title || c?.title || (c && c.kind !== "open" ? typedTitle(c) : "") || s?.preview || (c ? typedTitle(c) : "") || "untitled";
    // Its project as the bar groups it, never its worktree's folder's name (`chipProject`).
    const project = chipProject(s, c, state.sessions || [], state.projects || []);
    // Where it works beside its project and what that place holds not on main yet, as its row under Projects says them.
    const { where, apart } = placeMarks(s || { cwd: c?.cwd || null, places: [] });
    // A fork is named as its row under the project names it, so the row reads the same in either place.
    // Whose agents started it, where another machine's did: a working one stands under Now alone (the s-ui hunt's).
    const from = fromAgentsWords(s);
    return { title: `${s?.fork || s?.kind === "fork" ? "⑂ " : ""}${title}`, project, where, apart, ...(from ? { from } : {}), when: rowMoment(s), unread: !!s?.unread || state.unreadChains.has(chain) };
  }

  /** A row of Now opened: its chat, and a thread's thread in Sub Agents. @param {import("./lib/now.js").NowRow} r */
  function openRow(r) {
    // A Space's button running: its Space, at its dashboard's or app's page.
    if (r.space) {
      cb.onSpace?.(r.space.project, r.space.name);
      return;
    }
    const s = (state.sessions || []).find((x) => x.id === r.chain) || { id: r.chain, title: r.title, cwd: "" };
    markSeen(r.chain);
    if (r.thread) { cb.onOpenThread?.(s, r.thread); return; }
    const chat = [...state.chats.values()].find((c) => c.chainId === r.chain) || null;
    if (chat) cb.onSelectChat(chat.id); else cb.onOpen(s);
  }

  /** A chat seen: its unread dot goes, here and on the session. @param {string} chain */
  function markSeen(chain) {
    state.unreadChains.delete(chain);
    const s = (state.sessions || []).find((x) => x.id === chain);
    // The dot lives on the session's unread flag; clearing only the local mark let the next poll resurrect it.
    if (s?.unread) {
      s.unread = false;
      // A chat's mark takes nothing over (lib/api.js `taking`): seeing a chat is no act of writing it.
      api(`/sessions/${encodeURIComponent(chain)}/settings`, { method: "PATCH", body: { patch: { display: { unread: false } } }, take: false }).catch(() => {});
    }
  }

  // --- the filter menu (V6): grouping, sorting, Now's place, what the list holds, expand or collapse ---
  /** Its button, drawn with the Projects head: one the head held, moved into each draw, left the head under the pointer. */
  const filterBtn = () => {
    const b = h("button", {
      class: "ghost icon row-act lb-act-btn", type: "button", "aria-label": "Filter and sort", html: ICONS.listFilter,
      onclick: (/** @type {MouseEvent} */ e) => {
        e.stopPropagation();
        filterMenu(/** @type {HTMLElement} */ (e.currentTarget));
      },
    });
    tooltip(b, { title: "Group, sort and filter" });
    return b;
  };
  /**
   * The filter menu's Machines, where the app keeps another machine (the remote desk of 11-22): This computer's chats
   * alone or every machine's, and each other machine's in or out of the list.
   */
  const machinesItems = () => {
    if (!desk?.machines.length) return [];
    const scope = (/** @type {boolean} */ all) => () => {
      allMachines = all;
      keep(MACHINES_KEY, all ? "all" : "here");
      now.refresh();
      draw();
    };
    return [
      { type: "separator" },
      { type: "label", label: "Machines" },
      { type: "radio", label: desk.here.name, checked: !allMachines, onClick: scope(false) },
      { type: "radio", label: "All machines", checked: allMachines, onClick: scope(true) },
      ...(allMachines
        ? desk.machines.map((m) => ({
          type: "check", label: m.name, inset: true, checked: !hiddenMachines.has(m.id),
          onClick: () => {
            if (hiddenMachines.has(m.id)) hiddenMachines.delete(m.id);
            else hiddenMachines.add(m.id);
            keep(MACHINES_HIDDEN_KEY, JSON.stringify([...hiddenMachines]));
            now.refresh();
            draw();
          },
        }))
        : []),
    ];
  };
  /** @param {HTMLElement} anchor  the button pressed */
  const filterMenu = (anchor) => {
    const anyClosed = [...projectEls.values()].some((d) => !d.open);
    menu([
      { type: "label", label: "Group by" },
      { type: "radio", label: "Project", checked: organizeBy === "workspace" || (organizeBy === "machine" && !deskOn()), onClick: () => { organizeBy = "workspace"; keep(ORG_KEY, organizeBy); draw(); } },
      ...(deskOn() ? [{ type: "radio", label: "Machine", checked: organizeBy === "machine", onClick: () => { organizeBy = "machine"; keep(ORG_KEY, organizeBy); draw(); } }] : []),
      { type: "radio", label: "Time", checked: organizeBy === "grouped", onClick: () => { organizeBy = "grouped"; keep(ORG_KEY, organizeBy); draw(); } },
      { type: "separator" },
      { type: "label", label: "Sort by" },
      { type: "radio", label: "Updated", checked: sortBy === "updated", onClick: () => { sortBy = "updated"; keep(SORT_KEY, sortBy); draw(); } },
      { type: "radio", label: "Created", checked: sortBy === "created", onClick: () => { sortBy = "created"; keep(SORT_KEY, sortBy); draw(); } },
      { type: "separator" },
      { type: "switch", label: "Now on top", checked: nowOnTop, onClick: () => { nowOnTop = !nowOnTop; keep(NOW_TOP_KEY, nowOnTop ? "1" : "0"); draw(); } },
      { type: "switch", label: "Show archived", checked: showArchived, onClick: () => { showArchived = !showArchived; load(query); } },
      { type: "switch", label: "Rounds and agents", checked: showInternal, onClick: () => { showInternal = !showInternal; keep(INTERNAL_KEY, showInternal ? "1" : "0"); load(query); } },
      ...machinesItems(),
      ...(organizeBy !== "grouped" && projectEls.size
        ? [{ type: "separator" }, {
          label: anyClosed ? "Expand all" : "Collapse all", icon: anyClosed ? "maximize2" : "minimize2",
          onClick: () => { for (const [id, d] of projectEls) { d.open = anyClosed; openState.set(id, anyClosed); } },
        }]
        : []),
    ], { anchor, side: "bottom", align: "end", width: 220 });
  };

  const scrollRegion = h("div", { class: "sess-scroll" }, nowTop, list, nowBottom);
  /** The layer the bar's moves fly on, over both lists (bar-flight.js). */
  const fly = h("div", { class: "lb-fly", "aria-hidden": "true" });
  // The top fade reads as a smudge when the list rests at its top — it switches on with the first scroll.
  scrollRegion.addEventListener("scroll", () => {
    scrollRegion.classList.toggle("scrolled", scrollRegion.scrollTop > 0);
  }, { passive: true });

  // The top bar lines up with the conversation's header: Hide sidebar on the left (the collapsed rail brings it
  // back), Settings on the right, and between them the chat's crumb — project › chat — while the bar shows (the owner's
  // of 11-01): the shell moves it here from the header, and back as the bar hides.
  const crumbSlot = h("div", { class: "sess-top-crumb" });
  const hideBtn = h("button", { class: "ghost icon sess-top-btn", type: "button", "aria-label": "Hide sidebar", html: ICONS.panelLeftClose, onclick: () => cb.onHide() });
  tooltip(hideBtn, { title: "Hide sidebar", kbd: "Ctrl+B" });
  const gearBtn = h("button", { class: "ghost icon sess-top-btn", type: "button", "aria-label": "Settings", html: ICONS.settings, onclick: () => cb.onSettings() });
  tooltip(gearBtn, { title: "Settings", kbd: "Ctrl+," });

  // --- the Library (V4): the five kinds of kept things, each with its count ---
  /** @type {Record<string, HTMLElement>} */
  const libCount = {};
  /** @type {Record<string, HTMLElement>} */
  const libRow = {};
  /** @type {Record<string, HTMLElement>} */
  const libName = {};
  const libRows = LIBRARY.map((it) => {
    libCount[it.id] = h("span", { class: "lib-count" });
    libName[it.id] = h("span", { class: "lib-label" }, libLabel(it));
    const row = h("button", { class: "lib-row", type: "button", onclick: () => cb.onLibrary?.(it.id) },
      h("span", { class: "lib-ic", html: /** @type {any} */ (ICONS)[it.icon] }), libName[it.id], libCount[it.id]);
    tooltip(row, { title: () => libTip(it) });
    libRow[it.id] = row;
    return row;
  });
  /** The project whose Space is open, for its row's mark, and the app, dashboard or Routines it shows ("": its Board),
   *  for that row's instead; null on any other page. */
  let spaceAt = /** @type {string | null} */ (null);
  let spaceTab = "";
  /** @param {string | null} id @param {string | null} [tab] */
  function atSpace(id, tab = null) {
    const t = id && tab && tab !== "overview" ? tab : "";
    if (spaceAt === id && spaceTab === t) return;
    const was = spaceAt;
    spaceAt = id;
    spaceTab = t;
    // A Space on screen is the bar's one mark (the Designer's walk of 10-29: after Make Space, Home life's Board row was
    // marked inside its folded group while a chat of recipes stayed marked): its group opens, as if pressed — a fold by
    // hand after stays —, and the chat behind it is unmarked until it is left, which draws the rows again.
    if (id) openState.set(id, true);
    if (!was !== !id) {
      now.refresh();
      return void draw();
    }
    const det = id ? projectEls.get(id) : null;
    if (det && !det.open) det.open = true;
    for (const el of list.querySelectorAll(".space-row")) el.classList.toggle("current", el.getAttribute("data-space") === id && !t);
    for (const el of list.querySelectorAll(".space-app-row")) el.classList.toggle("current", el.getAttribute("data-space") === id && el.getAttribute("data-tab") === t);
  }

  /**
   * The Library's page open now, marked on its row and the rail's button; null where none is.
   * @param {string | null} page
   */
  function atLibrary(page) {
    libPage = LIBRARY.some((it) => it.id === page) ? page : null;
    for (const it of LIBRARY) {
      const on = it.id === page;
      for (const el of [libRow[it.id], railLib[it.id]]) {
        if (!el) continue;
        el.classList.toggle("on", on);
        if (on) el.setAttribute("aria-current", "page");
        else el.removeAttribute("aria-current");
      }
    }
    paintLibrary();
  }
  // The Library folds as Now does (the Designer's of 10-26): open at first, its state kept, and never opened by itself —
  // folded, its head alone carries the mark of the Library page open.
  let libOpen = true;
  try { libOpen = localStorage.getItem(LIB_OPEN_KEY) !== "0"; } catch {}
  /** The Library's page open now, for the folded head's mark. @type {string | null} */
  let libPage = null;
  const libChev = h("span", { class: "now-chev" });
  const libHead = h("button", {
    class: "lb-sec now-head lib-head",
    type: "button",
    onclick: () => {
      libOpen = !libOpen;
      try { localStorage.setItem(LIB_OPEN_KEY, libOpen ? "1" : "0"); } catch {}
      paintLibrary();
    },
  }, h("span", { class: "lb-sec-name" }, "Library"), h("span", { class: "grow" }), libChev);
  const library = h("nav", { class: "lb-foot", "aria-label": "Library" });
  function paintLibrary() {
    libHead.setAttribute("aria-expanded", String(libOpen));
    libHead.setAttribute("title", libOpen ? "Fold Library" : "Show Library");
    setHtml(libChev, libOpen ? ICONS.chevronDown : ICONS.chevronRight);
    const lit = !libOpen && libPage !== null;
    libHead.classList.toggle("on", lit);
    if (lit) libHead.setAttribute("aria-current", "page");
    else libHead.removeAttribute("aria-current");
    // Its head and rows are kept, so only what comes or goes moves: one put back with the rest lost the pointer's hover.
    placeChildren(library, [libHead, ...(libOpen ? libRows : [])]);
  }
  paintLibrary();

  // --- Your Space (HarnessV4_Space_Plan S5b): a first row once a Space keeps a dashboard or holds a row of its own
  // (S5-D6, SG-D0) — its count the chats' that need you and every project's open rows; a press opens it. Now under it
  // stays the chats' alone, so the bar never floods with outside rows. ---
  /** Each project's open rows in Needs you, and whether Your Space shows, as `/api/spaces` last said. */
  /** @type {Record<string, number>} */
  let spaceNeeds = {};
  let extended = false;
  let atYours = false;
  const yourCountEl = h("span", { class: "ys-row-count" });
  const yourRow = h("button", { class: "sess-search-row ys-row", type: "button", hidden: "", onclick: () => cb.onYourSpace?.() },
    h("span", { class: "sess-search-ic ys-row-ic", html: ICONS.house }),
    h("span", { class: "sess-search ys-row-label" }, "Home"),
    yourCountEl);
  tooltip(yourRow, { title: "What needs you from every project, and the dashboards you show there" });
  /** How many need you, across the chats and every project's kept rows. */
  const yourNeeds = () => yourCount(now.needs, spaceNeeds);
  function paintYourRow() {
    yourRow.hidden = !extended || !cb.onYourSpace;
    const n = yourNeeds();
    yourCountEl.textContent = needYouWords(n);
    yourRow.classList.toggle("has-needs", n > 0);
    yourRow.classList.toggle("current", atYours);
    if (atYours) yourRow.setAttribute("aria-current", "page");
    else yourRow.removeAttribute("aria-current");
    yourRow.setAttribute("aria-label", n ? `Home, ${needYouWords(n)}` : "Home");
  }
  /** Your Space open now, marked on its row. @param {boolean} on */
  function atYourSpace(on) {
    atYours = on;
    paintYourRow();
  }

  host.append(
    h("div", { class: "sess-top" }, hideBtn, crumbSlot, gearBtn),
    h("div", { class: "sess-head" },
      h("button", { class: "sess-new", type: "button", title: WORDS.newChat, "aria-label": WORDS.newChat, onclick: () => cb.onNew() },
        h("span", { class: "sess-new-ic", html: ICONS.messageCirclePlus }),
        h("span", { class: "sess-new-label" }, WORDS.newChat),
        h("span", { class: "sess-new-hint" }, comboOf("new-task"))),
      h("button", { class: "sess-search-row", type: "button", "aria-label": WORDS.search, onclick: () => cb.onSearch?.() },
        h("span", { class: "sess-search-ic", html: ICONS.search }),
        h("span", { class: "sess-search" }, WORDS.search),
        h("span", { class: "sess-new-hint" }, "Ctrl+K")),
      yourRow),
    scrollRegion,
    // The desktop app's update, where it offers one (lib/update-notice.js): above the Library, out of the chats' way.
    updateNotice().el,
    // Anonymous usage stats, said once (lib/telemetry-notice.js): nothing is sent until it has been.
    telemetryNotice({ api, viewOnly: () => !!cb.viewOnly?.(), onToast: cb.onToast }).el,
    // A star on GitHub, asked once after a few hours of use (lib/star-notice.js).
    starNotice({ api, viewOnly: () => !!cb.viewOnly?.() }).el,
    library,
    fly,
  );

  /** When the Library's counts were read; a look at the bar after LIBRARY_FRESH_MS reads them again. */
  let libraryAt = 0;
  /** A Library row's count, on its row and the rail's button: blank where its list was not read. @param {string} id @param {number | null} v */
  const paintCount = (id, v) => {
    const it = LIBRARY.find((x) => x.id === id);
    if (!it) return;
    libCount[id].textContent = v == null ? "" : v.toLocaleString("en-US");
    railLib[id]?.setAttribute("aria-label", v == null ? libLabel(it) : `${libLabel(it)}, ${v}`);
  };
  /** The reads of Plugins & Connectors' count asked: an answer to one asked before the last is let go. */
  let pluginsAsked = 0;
  /** Plugins & Connectors' count, read and drawn (`pluginsCount`): with the others, and again when the feed says one moved. */
  async function readPluginsCount() {
    const mine = ++pluginsAsked;
    const [plugins, connectors] = await Promise.all([
      api("/plugins/installed").catch(() => null),
      // The connectors' rows its page opens on: all chats', yours and the plugins' on everywhere (the Designer's of 10-26).
      api("/mcp-servers?scope=all").catch(() => null),
    ]);
    if (mine === pluginsAsked) paintCount("plugins", pluginsCount(plugins, connectors));
  }
  /** The reads of the agents' count asked: an answer to one asked before the last is let go. */
  let agentsAsked = 0;
  /**
   * The agents' count, read and drawn: with the others, and again when Settings › Experimental's Teams switch moves —
   * your teams count in it while teams are on.
   */
  async function readAgentsCount() {
    const mine = ++agentsAsked;
    const [agents, teams] = await Promise.all([api("/agents").catch(() => null), teamsOn(state.config) ? api("/teams").catch(() => null) : null]);
    if (mine === agentsAsked) paintCount("agents", agentsCount(agents, teams));
  }
  /** The Library's counts: each list's length, read once the chats are in and again when stale. A list that cannot be
   * read leaves its count blank, never a guess. */
  async function readLibrary() {
    if (Date.now() - libraryAt < LIBRARY_FRESH_MS) return;
    libraryAt = Date.now();
    const count = (/** @type {any} */ x) => (Array.isArray(x) ? x.length : 0);
    void readPluginsCount();
    void readAgentsCount();
    const [skills, scopes, artifacts] = await Promise.all([
      api("/skills?place=all").catch(() => null),
      api("/memory/claims/scopes").catch(() => null),
      api("/artifacts").catch(() => null),
    ]);
    paintCount("skills", skills ? count(skills.skills) : null);
    paintCount("memory", scopes ? (scopes.scopes || []).reduce((/** @type {number} */ t, /** @type {any} */ s) => t + (Number(s.claims) || 0), 0) : null);
    paintCount("artifacts", artifacts ? count(artifacts.artifacts) : null);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void readLibrary(); });

  // --- the rail: what the hidden bar leaves (§3.2) ---
  /** @type {Record<string, HTMLElement>} */
  const railLib = {};
  const railBadge = h("span", { class: "rail-badge hidden" });
  const railNow = h("button", { class: "ghost icon collapsed-mark rail-now", type: "button", "aria-label": "Now", html: ICONS.inbox }, railBadge);
  /** @type {{ el: HTMLElement, close: () => void } | null} */
  let railPop = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let railLeave;
  /** Now's rows beside the rail: pointing at Now shows them; a row pressed opens what it names. */
  function showRailNow() {
    clearTimeout(railLeave);
    if (railPop?.el.isConnected) return;
    const body = h("div", { class: "now now-pop-body" });
    now.fill(body);
    // Your Space's row on top, as the bar has it (S5b).
    const n = yourNeeds();
    const yours = extended && cb.onYourSpace
      ? h("button", { class: `ys-row ys-pop-row${n ? " has-needs" : ""}`, type: "button", onclick: () => { railPop?.close(); cb.onYourSpace?.(); } },
          h("span", { class: "ys-row-ic", html: ICONS.house }), h("span", { class: "ys-row-label" }, "Home"), h("span", { class: "ys-row-count" }, needYouWords(n)))
      : null;
    const card = h("div", { class: "now-pop" },
      ...(yours ? [yours] : []),
      h("div", { class: "now-pop-head" }, h("span", { class: "now-pop-ic", html: ICONS.inbox }), "Now", h("span", { class: "grow" }), h("span", { class: "now-pop-note" }, "every project")),
      body.childNodes.length ? body : h("div", { class: "now-pop-empty" }, "Nothing running, and nothing waits for you"));
    railPop = popover(railNow, card, { side: "right", width: 300, label: "Now", onClose: () => { railPop = null; } });
    railPop.el.addEventListener("pointerenter", () => clearTimeout(railLeave));
    railPop.el.addEventListener("pointerleave", leaveRailNow);
  }
  function leaveRailNow() {
    clearTimeout(railLeave);
    railLeave = setTimeout(() => railPop?.close(), 260);
  }
  /** The rail's Now: its count of what needs you, orange; a dot while something only works. @param {number} needs @param {number} works */
  function paintRailNow(needs, works) {
    railBadge.textContent = needs ? String(needs) : "";
    railBadge.classList.toggle("hidden", !needs && !works);
    railBadge.classList.toggle("is-dot", !needs && works > 0);
    railNow.classList.toggle("has-needs", needs > 0);
    railNow.setAttribute("aria-label", needs ? `Now, ${needs} need${needs === 1 ? "s" : ""} you` : works ? `Now, ${works} working` : "Now");
  }
  if (rail) {
    railNow.addEventListener("pointerenter", showRailNow);
    railNow.addEventListener("pointerleave", leaveRailNow);
    railNow.addEventListener("click", () => (railPop?.el.isConnected ? railPop.close() : showRailNow()));
    /** @param {string | (() => string)} label @param {string} glyph @param {() => void} run @param {string} [kbd] @param {string} [cls] */
    const btn = (label, glyph, run, kbd = "", cls = "") => {
      const b = h("button", { class: `ghost icon collapsed-mark${cls ? ` ${cls}` : ""}`, type: "button", "aria-label": typeof label === "function" ? label() : label, html: /** @type {any} */ (ICONS)[glyph], onclick: run });
      tooltip(b, kbd ? { title: label, kbd } : { title: label });
      return b;
    };
    for (const it of LIBRARY) railLib[it.id] = btn(() => libLabel(it), it.icon, () => cb.onLibrary?.(it.id));
    rail.append(h("div", { class: "rail-btns" },
      // New chat's key as the registry has it: Ctrl+N in the desktop app, another in a browser tab (the owner's of 11-09).
      btn(WORDS.newChat, "messageCirclePlus", () => cb.onNew(), comboOf("new-task"), "rail-new"),
      btn(WORDS.search, "search", () => cb.onSearch?.(), "Ctrl+K"),
      railNow,
      btn("Projects", "folder", () => cb.onReveal?.(), "Ctrl+B"),
      h("span", { class: "grow" }),
      ...LIBRARY.map((it) => railLib[it.id]),
      btn("Settings", "settings", () => cb.onSettings(), "Ctrl+,")));
  }

  // --- data ---
  // The tree is the archive's projects (every folder named, with or without chats yet) joined with the sessions
  // grouped under them. The developer's own chats and forks by default; ticks and imported sub-agent transcripts on
  // request (they stay one click away for the inspectors). The Archived view is everything archived:
  // the archived sessions plus the archived projects with all of theirs. Out of sight, a read waits for the page to show
  // again, and is read once then (lib/page-shown.js): each turn's end anywhere asked for it, in a page kept hidden all
  // day. The page's first read never waits: its start waits on it.
  async function load(q = "") {
    if (listRead && !pageShown()) return void whenPageShown("the left bar's list", () => load(q));
    const kinds = showInternal ? "interactive,fork,tick,subagent" : "interactive,fork";
    const base = `/memory/sessions?limit=200&kind=${kinds}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    const askedAt = Date.now();
    try {
      const [r, p, sides] = await Promise.all([
        api(`${base}${showArchived ? "&archived=only" : ""}`),
        // In the desktop app, each with its repository's remote, which another machine's chats stand with it by (the
        // remote desk of 11-22).
        api(typeof (/** @type {any} */ (globalThis).filamentMachines?.onDesk) === "function" ? "/memory/projects?remotes=1" : "/memory/projects").catch(() => null),
        // A search or the Archived view lists the chats alone; a team's chats stand under theirs in the list of all.
        q || showArchived ? null : api("/memory/sessions?limit=100&kind=team").catch(() => null),
      ]);
      state.sessions = r.sessions || [];
      // A name the side model gave after this read was asked: the read may hold the name before it, which never stands.
      for (const s of state.sessions) {
        const n = justNamed.get(String(s.id));
        if (n && n.at >= askedAt) s.title = n.title;
      }
      sideChats = sides?.sessions || [];
      state.sessionsLoadedAt = Date.now();
      if (p) {
        const all = /** @type {any[]} */ (p.projects || []);
        state.projects = all.filter((x) => !x.archived);
        archivedProjects = new Set(all.filter((x) => x.archived).map((x) => String(x.id)));
      }
      if (showArchived && archivedProjects.size) {
        const seen = new Set(state.sessions.map((s) => s.id));
        const more = await Promise.all([...archivedProjects].map((id) => api(`${base}&archived=all&project=${encodeURIComponent(id)}`).catch(() => null)));
        for (const m of more) for (const s of m?.sessions || []) if (!seen.has(s.id)) { seen.add(s.id); state.sessions.push(s); }
      }
    } catch (e) {
      loadFailed = `the sessions list failed: ${String(/** @type {any} */ (e)?.message || e)}`;
      draw();
      return;
    }
    listRead = true;
    loadFailed = null;
    draw();
    cb.onChanged();
    readWhere();
    now.refresh();
    void readLibrary();
  }

  // --- where each chat works (HarnessV4_Git_Plan GWC-36, GWC-62) ---
  // One light read per folder (`/git/where`, GW-D20), kept a minute: the rows draw without it and gain their line when
  // it lands. A read that fails leaves its folders unknown for that minute.
  const WHERE_FRESH_MS = 60_000;
  /** The folders one read asks at most: the server takes 100, and the address stays short. */
  const WHERE_PER_READ = 40;
  /** Each folder's read, and whether it was read `apart` (what it holds apart from its base). @type {Map<string, { at: number, info: any, apart: boolean }>} */
  const whereCache = new Map();
  let whereAsking = false;
  /** Asked again while a read was on its way — the list and the Spaces land apart —: what it names is read after it. */
  let whereAgain = false;
  /** A worktree was removed or put back since the last read began: every folder is read again. */
  let whereStale = false;
  /** The folders the feed said moved (`git-moved`) since the last read began: each read again, answered at once. @type {Set<string>} */
  const whereMoved = new Set();
  /** A folder's light read, or null while unknown. @param {string} folder */
  const whereOf = (folder) => whereCache.get(folder)?.info || null;
  /**
   * Where a chat works and what its place holds not on main yet, as its rows say them (the owner's of 10-31: "i might
   * forget if a thread has unapplied work into main branch"): `whereLine`'s place — led by the chat's own folder
   * wherever it wears the mark, a main folder off its base too, so the mark stands beside its own branch —, and the
   * mark (`apartMark`); each null where none.
   * @param {{ cwd?: string | null, places?: string[] }} row
   */
  function placeMarks(row) {
    const apart = apartMark(row.cwd ? whereOf(row.cwd) : null);
    return { where: whereLine(row, whereOf, { lead: !!apart }), apart };
  }
  /**
   * A folder the rows read moved (`git-moved`, lib/git-moved.js): the server read it again behind the answer the rows
   * were given, and it differs. Read again now — answered at once —, after the read on its way where one is.
   * @param {any} msg
   */
  function whereHeard(msg) {
    let hit = false;
    for (const [f, e] of whereCache)
      if (gitMovedFor(msg, e.apart ? "apart" : "light", [f])) {
        whereMoved.add(f);
        hit = true;
      }
    if (hit) readWhere();
  }
  /** A worktree removed or put back (GW-D38): every folder read again now, each row's line kept until its answer. */
  function placesMoved() {
    whereStale = true;
    readWhere();
  }
  /**
   * Reads the folders the rows name — and the chats of this page the archive does not list yet, which Now names — that
   * are unknown or a minute old; draws again, Now too, when what the rows say of one changed (`placeSaid`). A chat's own
   * folder is read `apart` — a worktree, or a branch off the base, whole: the rows' mark of work not on main yet —; a
   * place its agents only wrote in is named by its branch, and read lightly (the review's find of 10-31: each folder
   * read whole is several git processes more, every minute, in every window).
   */
  async function readWhere() {
    if (whereAsking) {
      whereAgain = true;
      return;
    }
    whereAgain = false;
    if (whereStale) {
      whereStale = false;
      for (const e of whereCache.values()) e.at = -Infinity;
    }
    const t = Date.now();
    const own = new Set([...(state.sessions || []).map((s) => s.cwd), ...[...state.chats.values()].map((c) => c.cwd)].filter(Boolean));
    // And each Space's project's folder, read lightly: its row counts its lanes from its repository's main folder
    // (`spaceRows`), a chat in it or none.
    const spaced = [...ownSpaces.map((o) => o.folder), ...(state.projects || []).filter((p) => hasSpace(p.id)).map((p) => p.cwd)];
    const named = new Set([...own, ...(state.sessions || []).flatMap((s) => s.places || []), ...spaced].filter(Boolean));
    const due = [...named].filter((f) => {
      const e = whereCache.get(f);
      return !e || !(t - e.at < WHERE_FRESH_MS) || (own.has(f) && !e.apart) || whereMoved.has(f);
    });
    whereMoved.clear();
    if (!due.length) return;
    whereAsking = true;
    let changed = false;
    try {
      for (const apart of [true, false]) {
        const folders = due.filter((f) => own.has(f) === apart);
        for (let i = 0; i < folders.length; i += WHERE_PER_READ) {
          const part = folders.slice(i, i + WHERE_PER_READ);
          /** @type {Record<string, any>} */
          let places = {};
          try {
            places = (await api(`/git/where?${apart ? "apart=1&" : ""}${part.map((f) => `cwd=${encodeURIComponent(f)}`).join("&")}`))?.places || {};
          } catch {} // unknown for a minute, drawn without the line
          for (const f of part) {
            const info = places[f] || null;
            if (placeSaid(whereOf(f)) !== placeSaid(info)) changed = true;
            whereCache.set(f, { at: Date.now(), info, apart });
          }
        }
      }
    } finally {
      whereAsking = false;
    }
    if (changed) {
      draw();
      now.refresh();
    }
    if (whereStale || whereMoved.size || whereAgain) readWhere();
  }

  /**
   * A turn of a chat not on screen finished: its row takes the unread dot, the session's unread flag too, so a reload
   * keeps it. @param {string} chain
   */
  function markFinished(chain) {
    const cur = [...state.chats.values()].find((c) => c.chainId === chain);
    if (cur && cur.id === state.currentId) return;
    state.unreadChains.add(chain);
    api(`/sessions/${encodeURIComponent(chain)}/settings`, { method: "PATCH", body: { patch: { display: { unread: true } } }, take: false }).catch(() => {});
  }
  /** The chats whose turn ended while their work stretch went on: their dot waits for its end (`stretchesLeft`). @type {Set<string>} */
  const finishedLater = new Set();
  /**
   * The chats whose work stretch the feed or a read said over: one whose turn ended in it, and runs no turn now, takes
   * its dot, as it finished. @param {Iterable<string>} had  the chats with a stretch before
   */
  function stretchesLeft(had) {
    let marked = false;
    for (const chain of had) {
      if (state.stretches.has(chain) || !finishedLater.delete(chain) || state.runningChains.has(chain)) continue;
      markFinished(chain);
      marked = true;
    }
    if (marked) draw();
  }

  /**
   * The runs list drives the live marks and Now; the run→chain map is built once per run. Out of sight, it waits for the
   * page to show again, and is read once then (lib/page-shown.js): the page's tick and each burst of the feed's asked.
   */
  async function loadRuns() {
    if (!pageShown()) return void whenPageShown("the runs list", loadRuns);
    try {
      const r = await api("/runs?limit=50");
      const runs = r.runs || [];
      // A run names its session in its own meta (agent turns, sub-agents, a replay-compare's fork): read off the
      // list this poll already has, never a record per run. Fetching each run's full record every 5 s held the
      // browser's connections (BUG-14/15/19): a steer typed mid-turn reached the server 30–60 s late, a sub-agent
      // window stayed on "Loading…".
      for (const run of runs) {
        if (state.runChains.has(run.id)) continue;
        state.runChains.set(run.id, run.kind === "replay-compare" ? run.meta?.fork || run.meta?.source || null : run.meta?.chain ? String(run.meta.chain) : null);
      }
      const running = new Set();
      const paused = new Set();
      /** @type {Set<string>} the chains whose newest run ended failed (the list is newest-first) */
      const errored = new Set();
      /** @type {Set<string>} the chains whose newest run was stopped, or cut off by a restart */
      const stopped = new Set();
      const seen = new Set();
      for (const run of runs) {
        const chain = state.runChains.get(run.id);
        // A second look or a check (S3b, S5d) answers where it was asked, never in its chat: no working mark there, and
        // no unread dot once it ends (seen live: a check left its chat a dot that opened on nothing new). Nor a fork that
        // weighs the person's message aside (`weighs`): what it makes of it is under their message.
        if (!chain || seen.has(chain) || run.meta?.second || run.meta?.weighs) continue;
        seen.add(chain); // the newest run per chain is its latest word
        if (run.status === "running") running.add(chain);
        if (run.status === "paused") { paused.add(chain); running.add(chain); }
        if (run.status === "error") errored.add(chain);
        if (run.status === "stopped" || run.status === "aborted") stopped.add(chain);
      }
      const was = new Set([...state.runningChains, ...state.pausedChains]);
      for (const chain of was) {
        if (running.has(chain) || paused.has(chain)) continue;
        // A turn of a chat whose work stretch goes on has not finished it (the owner's of 11-03): its dot waits for the
        // stretch's end.
        if (state.stretches.has(chain)) finishedLater.add(chain);
        else markFinished(chain);
      }
      const wasMarks = new Set([...state.runningChains, ...state.pausedChains, ...state.erroredChains, ...[...state.stoppedChains].map((c) => `stopped:${c}`)]);
      const nowMarks = new Set([...running, ...paused, ...errored, ...[...stopped].map((c) => `stopped:${c}`)]);
      state.runningChains = running;
      state.pausedChains = paused;
      state.erroredChains = errored;
      state.stoppedChains = stopped;
      state.runs = runs;
      // The poll redraws only when a mark actually moved: a quiet poll rebuilt the whole list — and reset every group's
      // expand state — every 5 s. The row ages are said again in place (`paintAges`).
      const same = wasMarks.size === nowMarks.size && [...nowMarks].every((x) => wasMarks.has(x));
      if (!same) draw();
      if (!same) cb.onAtWork?.();
      // The first read places what already works without a flight: nothing moved, the page only just opened.
      still = !runsRead;
      void now.update(runs);
      still = false;
      runsRead = true;
    } catch {}
  }

  // The events fan-out flips the marks the moment anything lands — the stream carries the bus's record/op
  // topics, run lifecycle rides the ops and record finishes (a run's end closes a record), and the `turns`
  // topic (Facade D11) says who holds each harness chat's turn, so the sidebar spins for any tab's turn at once.
  /** @type {any} */
  let runsTimer = null;
  // A burst of events during a run asks for the runs list once, a moment after the burst, not once per event.
  const loadRunsSoon = () => {
    if (runsTimer) return;
    runsTimer = setTimeout(() => { runsTimer = null; loadRuns(); }, 750);
  };
  // A turn let go anywhere asks for the list once, a moment later: a chat another tab started, or ran a turn in beside
  // this page, shows without a reload (HarnessV3-FixRound decision 29).
  /** @type {any} */
  let listTimer = null;
  const loadSoon = () => {
    if (listTimer) return;
    listTimer = setTimeout(() => { listTimer = null; load(query); }, 750);
  };
  /** Each project's open tasks on its Space's board (`GET /api/spaces`), which its Space row counts: a project it names
   *  has a Space (10-29: one the person made), the others none, and no row. @type {Record<string, number>} */
  let spaceOpen = {};
  /** The projects whose deleted Space Bring back may still have, and when each was deleted. @type {Record<string, number>} */
  let spaceBack = {};
  /** A folder as the bar compares it: either slash, no slash at its end, any case. @param {unknown} p */
  const folderKey = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  /** Whether a project has a Space. @param {string} id */
  const hasSpace = (id) => Object.prototype.hasOwnProperty.call(spaceOpen, id);
  /** Whether a project has no Space and a deleted one that waits for Bring back: nothing added makes one over it. @param {string} id */
  const spaceWaits = (id) => !hasSpace(id) && !!spaceBack[id];
  /** The Spaces of your own, oldest first, as `GET /api/spaces` last said (HarnessV4_SpacesPlugins_Plan A6): each is a
   *  group of the bar's Spaces section, not of Projects. @type {{ project: string, name: string, folder: string }[]} */
  let ownSpaces = [];
  /** Each Space's apps and dashboards, as their tabs had them, and whether it has Routines and a run of them failed, and
   *  Watchers the same: rows under its Space's (the owner's idea of 10-29). @type {Record<string, any[]>} */
  let spaceApps = {};
  /** @type {Record<string, { failed: boolean }>} */
  let spaceRoutines = {};
  /** @type {Record<string, { failed: boolean }>} */
  let spaceWatchers = {};
  /** @type {any} */
  let spacesTimer = null;
  /** The counts asked again at the moment they change by themselves (a row put off comes back). @type {any} */
  let nextTimer = null;
  const loadSpaces = async () => {
    try {
      const r = await api("/spaces");
      // Your Space's row: whether it shows, and every project's open rows it counts (S5b).
      spaceNeeds = r?.needs && typeof r.needs === "object" ? r.needs : {};
      extended = r?.extended === true;
      paintYourRow();
      // No event comes when a row's moment passes: the server said when, and the row asks then (found by the Hunter on
      // S5a: the count stayed as it was).
      clearTimeout(nextTimer);
      const soon = Number(r?.next) || 0;
      nextTimer = soon ? setTimeout(() => void loadSpaces(), Math.min(Math.max(1000, soon - Date.now() + 500), 2 ** 31 - 1)) : null;
      const own = Array.isArray(r?.own) ? r.own : [];
      const ownMoved = JSON.stringify(own) !== JSON.stringify(ownSpaces);
      ownSpaces = own;
      spaceBack = r?.back && typeof r.back === "object" ? r.back : {};
      const next = r?.open && typeof r.open === "object" ? r.open : {};
      const apps = r?.apps && typeof r.apps === "object" ? r.apps : {};
      const routines = r?.routines && typeof r.routines === "object" ? r.routines : {};
      const watchers = r?.watchers && typeof r.watchers === "object" ? r.watchers : {};
      // What their rows say, not when each source last read: a dashboard reading draws nothing again.
      const said = (/** @type {Record<string, any[]>} */ a, /** @type {any} */ rt, /** @type {any} */ wt) => JSON.stringify([Object.entries(a).map(([id, l]) => [id, appRowsOf(l, Date.now())]), rt, wt]);
      const appsMoved = said(apps, routines, watchers) !== said(spaceApps, spaceRoutines, spaceWatchers);
      spaceApps = apps;
      spaceRoutines = routines;
      spaceWatchers = watchers;
      if (!ownMoved && !appsMoved && JSON.stringify(next) === JSON.stringify(spaceOpen)) return;
      spaceOpen = next;
      draw();
      cb.onSpaces?.();
      // A Space made or named since the folders were read: its row counts its lanes from its project's folder's read.
      void readWhere();
    } catch {}
  };
  // A Space's change asks for the counts once, a moment after a burst of them.
  const loadSpacesSoon = () => {
    if (spacesTimer) return;
    spacesTimer = setTimeout(() => { spacesTimer = null; void loadSpaces(); }, 750);
  };
  void loadSpaces();
  /**
   * When the feed said each chat's holder, while a holders read asked before then is on its way (`holdersAsked`, the
   * times those reads were asked): that read's word on the chat is older than the feed's (`loadHolders`).
   * @type {Map<string, number>}
   */
  const holderHeard = new Map();
  /** When the feed said each chat's work stretch, while a holders read asked before then is on its way: as `holderHeard`. @type {Map<string, number>} */
  const stretchHeard = new Map();
  /** @type {number[]} */
  const holdersAsked = [];
  onBus((msg) => {
    // A chat named by the side model: its row's title written in where it stands, nothing else drawn. The page's chat
    // takes it here too, whichever of the page's handlers hears it first: in its first turn it is in no list yet.
    if (msg?.type === "named" && msg.chainId && msg.title) {
      const chain = String(msg.chainId);
      for (const c of state.chats.values()) if (c.chainId === chain) c.title = String(msg.title);
      const s = (state.sessions || []).find((/** @type {any} */ x) => x.id === chain);
      if (s) s.title = String(msg.title);
      justNamed.set(chain, { title: String(msg.title), at: Date.now() });
      patchChats([chain]);
    }
    // A version published or an artifact deleted may be a Space's app: its row comes, moves or goes.
    if (msg?.type === "space" || (msg?.type === "artifact" && (msg.v || msg.change === "deleted"))) loadSpacesSoon();
    if (msg?.type === "op" || msg?.type === "start" || msg?.type === "finish") loadRunsSoon();
    if (msg?.type === "turn") {
      if (holdersAsked.length) holderHeard.set(String(msg.chainId), Date.now());
      if (msg.holder) state.holders.set(msg.chainId, msg.holder);
      else state.holders.delete(msg.chainId);
      patchChats([msg.chainId]);
      cb.onAtWork?.();
      if (!msg.holder) loadSoon();
    }
    // A flow moved — started, a step on, asking, ended (the owner's of 10-28): the flows at work read again, once a burst.
    if (msg?.type === "flow") flowsSoon();
    // Your connectors or a plugin's places saved in the config, or a plugin installed or uninstalled (http/admin/plugins.js),
    // from this page, another or an agent: Plugins & Connectors counts again, not two minutes later.
    if (msg?.type === "config-changed" || msg?.type === "plugins-changed") void readPluginsCount();
    if (msg?.type === "git-moved") whereHeard(msg);
    // A thread's record moved, which the runs list may never show — a check Filament ran ended (the review of 11-01):
    // Now reads that chat's threads at its next poll.
    if (msg?.type === "subagent" && msg.chainId) now.threadsMoved(String(msg.chainId));
    // A chat's running commands, the whole list (HarnessV4_Background_Plan E38-D4): Now keeps the chat under Working.
    if (msg?.type === "commands" && msg.chainId) {
      if (Array.isArray(msg.commands) && msg.commands.length) state.commands.set(String(msg.chainId), msg.commands);
      else state.commands.delete(String(msg.chainId));
      now.refresh();
    }
    // A chat's work stretch begun, gone on with a turn or past its end, or ended (the owner's of 11-03): Now's time for
    // the chat counts from its start, and the chat stays under Working while it goes on, saying what keeps it. A holders
    // read asked before this word keeps it (`stretchHeard`).
    if (msg?.type === "stretch" && msg.chainId) {
      const chain = String(msg.chainId);
      if (holdersAsked.length) stretchHeard.set(chain, Date.now());
      const had = state.stretches.has(chain);
      if (Number(msg.since) > 0) state.stretches.set(chain, { since: Number(msg.since), waits: msg.waits || null });
      else state.stretches.delete(chain);
      if (had) stretchesLeft([chain]);
      now.refresh();
    }
  });

  /**
   * Every chat's come-back as the holders read says them (the Designer's of 10-27): a set, a Cancel or a time that came
   * which the feed dropped is set right here, and Now and the open chat's status drawn again where one moved.
   * @param {any[]} list  the read's `comeBacks`: `{ chainId, comeBack }` each
   */
  function syncComeBacks(list) {
    const was = JSON.stringify([...state.comeBacks].sort());
    state.comeBacks = new Map(list.filter((x) => x?.chainId && x.comeBack).map((x) => [String(x.chainId), x.comeBack]));
    if (JSON.stringify([...state.comeBacks].sort()) === was) return;
    now.refresh();
    cb.onComeBacks?.();
  }

  /**
   * Every chat's check-in on its agent idle while its command runs (app/sessions/idle-wake.js), as the holders read says
   * them: one the feed's word missed is set right here, as a come-back is.
   * @param {any[]} list  the read's `idleWakes`: `{ chainId, idleWake }` each
   */
  function syncIdleWakes(list) {
    const was = JSON.stringify([...state.idleWakes].sort());
    state.idleWakes = new Map(list.filter((x) => x?.chainId && x.idleWake).map((x) => [String(x.chainId), x.idleWake]));
    if (JSON.stringify([...state.idleWakes].sort()) === was) return;
    now.refresh();
    cb.onComeBacks?.();
  }

  /**
   * Every chat's flows at work as the holders read says them (the owner's of 10-28): a chat stays under Working while
   * one runs, and one that asks you needs you. Now, and who is at work, drawn again where one moved.
   * @param {any[]} list  the read's `flows`: FlowAtWork each
   */
  function syncFlows(list) {
    const was = JSON.stringify([...state.flows].sort());
    /** @type {Map<string, import("./lib/now.js").FlowAtWork[]>} */
    const next = new Map();
    for (const x of list) if (x?.chainId && x.id) next.set(String(x.chainId), [...(next.get(String(x.chainId)) || []), x]);
    state.flows = next;
    if (JSON.stringify([...state.flows].sort()) === was) return;
    now.refresh();
    draw();
    cb.onAtWork?.();
  }
  /** A flow's word read once a burst of them is over: the holders read says every chat's flows at work. */
  let flowsTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  const flowsSoon = () => {
    if (flowsTimer) return;
    flowsTimer = setTimeout(() => { flowsTimer = null; void loadHolders(); }, 300);
  };

  /**
   * The resync (D11): the stream drops events on a congested socket, so the tick reads GET /api/sessions/holders.
   * The events make the spinner immediate; the tick makes it right after a dropped event.
   * A chat whose holder the feed said after the read was asked keeps the feed's word (`holderHeard`): the read's is
   * older, and would undo a take or a release just heard. Resolves with the route's answer, which also lists the
   * compactions running now (HarnessV4_Tasks U3-5); null when the read failed.
   */
  async function loadHolders() {
    const asked = Date.now();
    holdersAsked.push(asked);
    try {
      const r = await api("/sessions/holders");
      const rows = r?.holders || [];
      const newer = (/** @type {string} */ chain) => (holderHeard.get(String(chain)) || 0) >= asked;
      const seen = new Set(rows.map((/** @type {any} */ h) => h.chainId));
      /** The chats whose holder came, went or changed. @type {Set<string>} */
      const moved = new Set();
      for (const chain of [...state.holders.keys()]) {
        if (!seen.has(chain) && !newer(chain)) { state.holders.delete(chain); moved.add(chain); }
      }
      for (const h of rows) {
        if (newer(h.chainId)) continue;
        const prev = state.holders.get(h.chainId) || null;
        if (!prev || prev.window !== h.window) moved.add(h.chainId);
        state.holders.set(h.chainId, { window: h.window, client: h.client, label: h.label, since: h.since, own: h.own || null });
      }
      if (moved.size) {
        patchChats(moved);
        cb.onAtWork?.();
      }
      // The commands running in the background, each chat's (HarnessV4_Background_Plan E38-D4): a start or an end the
      // feed dropped is set right here.
      if (Array.isArray(r?.commands)) {
        const was = JSON.stringify([...state.commands].map(([c, l]) => [c, l.map((x) => x.id)]).sort());
        state.commands = new Map(r.commands.filter((/** @type {any} */ x) => x?.chainId && x.commands?.length).map((/** @type {any} */ x) => [String(x.chainId), x.commands]));
        const is = JSON.stringify([...state.commands].map(([c, l]) => [c, l.map((x) => x.id)]).sort());
        if (is !== was) {
          now.refresh();
          cb.onCommands?.();
        }
      }
      // And each chat's come-back while it waits (the Designer's of 10-27).
      if (Array.isArray(r?.comeBacks)) syncComeBacks(r.comeBacks);
      // …and each chat's check-in on its idle agent (the owner's of 11-08).
      if (Array.isArray(r?.idleWakes)) syncIdleWakes(r.idleWakes);
      // And each chat's work stretch going on (the owner's of 11-03): one the feed's word missed — not one whose word the
      // feed said after this read was asked, which keeps the feed's (`stretchHeard`).
      if (Array.isArray(r?.stretches)) {
        const was = JSON.stringify([...state.stretches].sort());
        const had = [...state.stretches.keys()];
        const fresh = (/** @type {string} */ chain) => (stretchHeard.get(chain) || 0) >= asked;
        /** @type {Map<string, import("./lib/now.js").Stretch>} */
        const next = new Map();
        for (const x of r.stretches) if (x?.chainId && Number(x.since) > 0 && !fresh(String(x.chainId))) next.set(String(x.chainId), { since: Number(x.since), waits: x.waits || null });
        for (const [chain, s] of state.stretches) if (fresh(chain)) next.set(chain, s);
        state.stretches = next;
        stretchesLeft(had);
        if (JSON.stringify([...state.stretches].sort()) !== was) now.refresh();
      }
      // And each chat's flows at work (the owner's of 10-28).
      if (Array.isArray(r?.flows)) syncFlows(r.flows);
      // And the Spaces' buttons running (the owner's of 10-29): Now's own rows.
      if (Array.isArray(r?.appRuns)) {
        const was = JSON.stringify(state.appRuns);
        state.appRuns = r.appRuns.filter((/** @type {any} */ x) => x?.project && x.name);
        if (JSON.stringify(state.appRuns) !== was) now.refresh();
      }
      return r;
    } catch {
      return null;
    } finally {
      // What the feed said before every read still on its way was asked outranks none of them.
      holdersAsked.splice(holdersAsked.indexOf(asked), 1);
      const oldest = holdersAsked.length ? Math.min(...holdersAsked) : Infinity;
      for (const [chain, at] of holderHeard) if (at < oldest) holderHeard.delete(chain);
      for (const [chain, at] of stretchHeard) if (at < oldest) stretchHeard.delete(chain);
    }
  }

  // --- rows ---

  /** The first thing the developer typed in a chat — the row's title until the archive names it. @param {any} c */
  const typedTitle = (c) => firstMessageName(c.turns, (/** @type {any} */ t) => !t.past).slice(0, 48);

  /**
   * Chats of this tab that have a turn but no archive row yet (the first turn is still streaming, or the archive is
   * catching up): drawn as rows from what the developer typed, never invented, under their project (`localProject`).
   * @param {any[]} sessions
   */
  function localRows(sessions) {
    const known = new Set(sessions.map((s) => s.id));
    const rows = [];
    for (const c of state.chats.values()) {
      if (!c.turns.some((/** @type {any} */ t) => !t.past)) continue;
      if (c.chainId && known.has(c.chainId)) continue;
      const at = new Date(c.createdAt || Date.now()).toISOString();
      rows.push({ id: c.chainId || `local:${c.id}`, title: c.forkedFrom ? `fork @ turn ${c.forkedFrom.atTurn}` : c.title || typedTitle(c) || (c.kind === "open" ? "opened session" : c.load ? "new chat with a loaded session" : "new chat"),
        ...localProject(c, sessions), cwd: c.cwd || null,
        when: at, created: at, turns: c.turns.length, local: c });
    }
    return rows;
  }

  /**
   * A row's second line on a wide bar (§3.2): where it works — the place when not its repository's main folder, else
   * its branch — and what it does now, in the words Now uses; the two apart, so the place's mark stands beside it.
   * @param {any} s @param {{ busy: boolean, paused: boolean, failed: boolean, unread: boolean }} st @param {any} where
   *   `busy`: a turn runs, the open chat's among them.
   * @returns {{ place: string, rest: string }}
   */
  function twoLine(s, st, where) {
    const place = where ? where.text : s.cwd ? branchWords(whereOf(s.cwd)) : "";
    const doing = st.paused ? now.factOf(s.id) || "waits for you" : st.busy ? "working" : st.failed ? "failed" : st.unread ? "finished · unread" : "idle";
    return { place, rest: doing };
  }

  /** A row's age, said again in place as time goes (`paintAges`): the moment it counts from rides the element. @param {any} when */
  function ageEl(when) {
    return h("span", { class: "sess-age", "data-when": when ? String(when) : null }, sessionAge(when));
  }

  /**
   * The rows' ages said again where they stand: time alone moved them, and the bar is not drawn anew for it. A chat that
   * waits for you on something else now than its rows say has those rows drawn again.
   */
  function paintAges() {
    for (const el of list.querySelectorAll(".sess-age")) {
      const when = el.getAttribute("data-when");
      if (!when) continue;
      const words = sessionAge(when);
      if (el.textContent !== words) el.textContent = words;
    }
    const moved = [...factsSaid].filter(([id, said]) => state.pausedChains.has(id) && (now.factOf(id) || "") !== said).map(([id]) => id);
    if (moved.length) patchChats(moved);
  }

  /** @param {any} s
   * @param {{ timeline?: boolean }} [o]
   */
  function sessionRow(s, o = {}) {
    const chat = s.local || [...state.chats.values()].find((c) => c.chainId === s.id) || null;
    // Not while a Space is on screen: its row is the mark (`atSpace`).
    const current = !spaceAt && !!chat && chat.id === state.currentId;
    // The spinner serves any holder (Facade D11): a run of this page's own, or another tab's turn, a coding agent's
    // own, a chat's move — whose words ("Claude Code is working on its own") are the server's, from the `turns` topic
    // or the holders tick.
    const holder = state.holders.get(s.id) || null;
    const busy = atWork(s.id, chat);
    const running = busy && !current;
    const paused = state.pausedChains.has(s.id);
    const unread = state.unreadChains.has(s.id) || s.unread;
    const failed = state.erroredChains?.has(s.id);
    if (paused) factsSaid.set(String(s.id), now.factOf(s.id) || "");
    else factsSaid.delete(String(s.id));

    // A chat that waits for you wears Now's orange dot (proposal_ux §4.1), what it waits on in its hover.
    const lead = paused && !current
      ? h("span", { class: "row-dot needs", title: now.factOf(s.id) || "waits for you" })
      : holder && !current
        ? h("span", { class: "live-spin", html: ICONS.loader, title: workingWords(holder) })
        : running
          ? h("span", { class: "live-spin", html: ICONS.loader })
          : failed
            ? h("span", { class: "row-dot err", title: "the last run failed" })
            : unread
              ? h("span", { class: "row-dot unread" })
              : o.timeline && !s.pinned
                ? h("span", { class: "row-dot" })
                : null;
    const pin = h("button", {
      class: `ghost icon row-act pin ${s.pinned ? "on" : ""}`,
      type: "button",
      title: s.pinned ? "Unpin chat" : "Pin chat",
      html: ICONS.pin,
      onclick: async (e) => {
        e.stopPropagation();
        try {
          await api(`/sessions/${encodeURIComponent(s.id)}/settings`, { method: "PATCH", body: { patch: { display: { pinned: !s.pinned } } } });
          s.pinned = !s.pinned;
          load(query);
        } catch (err) {
          cb.onToast?.(String(/** @type {any} */ (err)?.message || err), "err");
        }
      },
    });
    // No Pin on a view-only device's page: it writes the chat's settings.
    const leadSlot = h("span", { class: "row-lead" }, lead, cb.viewOnly?.() ? null : pin);

    // The archive's label (title, else the first message) names an opened session; only a chat that started here
    // and has no row yet is labelled by what was typed into it.
    const label = s.title || (chat && chat.kind !== "open" ? typedTitle(chat) : "") || s.preview || (chat ? typedTitle(chat) : "") || "untitled";
    // A thread (core/threads.js) under the chat that started it stands a step in for each (`nestThreads`), its glyph
    // before its name; apart from that chat, its byline names it.
    const depth = threadDepth.get(String(s.id)) || 0;
    const threadOf = depth ? "" : threadOfWords(s, state.sessions || []);
    // Named by the side model a moment ago: the name writes itself in. A draw meanwhile patches the row in place, its
    // writing going on; no delay is set on it, which would set the writing ahead.
    const since = namedSince(String(s.id), label);
    const title = h("span", { class: `sess-title${since != null ? " is-named" : ""}` },
      depth ? h("span", { class: "row-thread-ic", role: "img", "aria-label": "Thread", html: ICONS.messagesSquare, title: "A thread: the chat above's agent started it" }) : null,
      s.fork || s.kind === "fork" ? "⑂ " : "", label);
    // Where it works, and the mark of what its place holds not on main yet (`placeMarks`), beside it in either width of
    // the bar — beside the title it cut the title short.
    const { where, apart } = placeMarks(s);
    const mark = () => (apart ? h("span", { class: "row-apart", title: apart.title }, apart.text) : null);
    const two = twoLine(s, { busy, paused, failed: !!failed, unread: !!unread }, where);
    const twoText = [two.place, two.rest].filter(Boolean).join(" · ");
    // A chat another machine's agents started here (the remote-agents plan's s-ui): whose, on a line under its name —
    // beside it, the words cut a narrow bar's title to its first letters, as the place's mark once did.
    const from = fromAgentsWords(s);
    const body = h("span", { class: "sess-main" },
      h("span", { class: "row-title-line" }, title,
        KIND_LABEL[s.kind] ? h("span", { class: "row-archived", title: `a ${KIND_LABEL[s.kind]}'s transcript, not one of your chats` }, KIND_LABEL[s.kind]) : null,
        s.archived ? h("span", { class: "row-archived" }, "archived") : null),
      from
        ? h("span", { class: "row-from", title: "Another machine's agents started this chat here" },
          h("span", { class: "row-where-ic", html: icon("bot") }), h("span", { class: "row-where-text" }, from))
        : null,
      threadOf
        ? h("span", { class: "row-from row-thread", title: "Another chat's agent started this chat as its thread" },
          h("span", { class: "row-where-ic", html: ICONS.messagesSquare }), h("span", { class: "row-where-text" }, threadOf))
        : null,
      where
        ? h("span", { class: "row-where", title: where.title },
          h("span", { class: "row-where-ic", html: icon("gitBranch") }), h("span", { class: "row-where-text" }, where.text), mark())
        : null,
      // Wide (§3.2): every row's second line, where it works and what it does; the bar's width shows or hides it.
      twoText && !o.timeline
        ? h("span", { class: `row-two${paused ? " needs" : ""}`, title: [where?.title, apart?.title].filter(Boolean).join("\n") || twoText },
          two.place, mark(), two.place && two.rest ? ` · ${two.rest}` : two.rest)
        : null,
      o.timeline
        ? h("span", { class: "row-sub" }, h("span", { class: "row-proj" }, s.projectName || s.cwd || ""), ageEl(s.when))
        : null);
    const age = o.timeline ? null : ageEl(s.when);

    return h("div", {
      class: `sess-row ${s.pinned ? "pinned" : ""} ${current ? "current" : ""} ${o.timeline ? "tl" : ""} ${where ? "where" : ""} ${from || threadOf ? "from" : ""} ${twoText && !o.timeline ? "has-two" : ""}${depth ? " is-thread" : ""}`,
      ...(depth ? { style: `--thread-depth: ${depth}` } : {}),
      role: "button",
      tabindex: "0",
      // Its key in either place, so a move between Now and here is drawn as one (bar-flight.js), and a draw keeps it.
      "data-key": `chat:${s.id}`,
      "data-flip": `chat:${s.id}`,
      "data-chain": String(s.id),
      onclick: () => {
        markSeen(s.id);
        if (chat) cb.onSelectChat(chat.id); else cb.onOpen(s);
      },
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); /** @type {HTMLElement} */ (e.currentTarget).click(); }
        else if (e.key === "Delete" && !cb.viewOnly?.()) { e.preventDefault(); deleteChat(s); }
      },
      // Its menu on the row that stands.
      oncontextmenu: (/** @type {MouseEvent} */ e) => {
        e.preventDefault();
        chatMenu(s, /** @type {HTMLElement} */ (e.currentTarget));
      },
    }, leadSlot, body, age);
  }

  /**
   * A team on the side of the chat above, a line under its row (HarnessV4_Tasks U13-D5; mock-v3-agents): "↳ BugHunters",
   * a "side" tag, its state; pressed, the team's own chat opens.
   * @param {{ s: any, name: string, state: string, words: string }} x
   */
  function sideRow(x) {
    const s = x.s;
    const chat = [...state.chats.values()].find((c) => c.chainId === s.id) || null;
    const current = !spaceAt && !!chat && chat.id === state.currentId;
    const lead = x.state === "works"
      ? h("span", { class: "live-spin", html: ICONS.loader })
      : x.state === "asks"
        ? h("span", { class: "row-dot needs", title: "its lead asks you" })
        : x.state === "stopped"
          ? h("span", { class: "row-dot err", title: "its last turn failed" })
          : h("span", { class: "row-ic", html: ICONS.circleCheck });
    return h("div", {
      class: `sess-row sess-side is-${x.state}${current ? " current" : ""}`,
      role: "button",
      tabindex: "0",
      "data-key": `side:${s.id}`,
      "data-flip": `side:${s.id}`,
      title: `${x.name}, on the side of the chat above: ${x.words}`,
      onclick: () => {
        markSeen(s.id);
        if (chat) cb.onSelectChat(chat.id); else cb.onOpen(s);
      },
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); /** @type {HTMLElement} */ (e.currentTarget).click(); }
      },
      oncontextmenu: (/** @type {MouseEvent} */ e) => {
        e.preventDefault();
        chatMenu(s, /** @type {HTMLElement} */ (e.currentTarget));
      },
    },
    h("span", { class: "row-lead" }, lead),
    h("span", { class: "sess-main" }, h("span", { class: "row-title-line" }, h("span", { class: "sess-title" }, `↳ ${x.name}`), h("span", { class: "row-side" }, "side"))),
    h("span", { class: "sess-age" }, x.words));
  }

  /** A row's menu (right-click). @param {any} s @param {HTMLElement} anchor */
  function chatMenu(s, anchor) {
    // A view-only device's page writes nothing: its paths and ids to copy alone (p4-view-ui).
    if (cb.viewOnly?.()) {
      menu([
        { label: "Copy path", icon: "copy", onClick: () => navigator.clipboard?.writeText(s.cwd || "").catch(() => {}) },
        { label: "Copy session ID", icon: "copy", onClick: () => navigator.clipboard?.writeText(s.id).catch(() => {}) },
      ], { anchor, side: "bottom", align: "start", width: 208 });
      return;
    }
    menu([
      { label: s.pinned ? "Unpin" : "Pin", icon: "pin", onClick: () => api(`/sessions/${encodeURIComponent(s.id)}/settings`, { method: "PATCH", body: { patch: { display: { pinned: !s.pinned } } } }).then(() => load(query)).catch((e) => cb.onToast?.(errOf(e), "err")) },
      { label: "Rename…", icon: "pencil", onClick: () => renameChat(s) },
      { label: s.archived ? "Unarchive" : "Archive", icon: "archive", onClick: () => api(`/sessions/${encodeURIComponent(s.id)}/settings`, { method: "PATCH", body: { patch: { display: { archived: !s.archived } } } }).then(() => load(query)).catch((e) => cb.onToast?.(errOf(e), "err")) },
      // Unread, it waits under Now's Done until it is opened: the person's own press, so it moves at once.
      { label: "Mark as unread", icon: "circle", onClick: () => api(`/sessions/${encodeURIComponent(s.id)}/settings`, { method: "PATCH", body: { patch: { display: { unread: true } } } }).then(() => { s.unread = true; state.unreadChains.add(s.id); now.refresh(true); draw(); }).catch((e) => cb.onToast?.(errOf(e), "err")) },
      { type: "separator" },
      { label: "Copy path", icon: "copy", onClick: () => navigator.clipboard?.writeText(s.cwd || "").catch(() => {}) },
      { label: "Copy session ID", icon: "copy", onClick: () => navigator.clipboard?.writeText(s.id).catch(() => {}) },
      { type: "separator" },
      { label: "Fork…", icon: "trending", onClick: () => cb.onForkSession?.(s) },
      // The older "continue": a fresh chat that receives this session as memory material on its first request.
      // Opening the row itself continues the session in place.
      { label: "Load into a new chat", icon: "messageCirclePlus", onClick: () => cb.onLoadSession?.(s) },
      { label: "Delete chat…", icon: "trash2", variant: "destructive", onClick: () => deleteChat(s) },
    ], { anchor, side: "bottom", align: "start", width: 208 });
  }

  /** @param {any} e */
  const errOf = (e) => String(/** @type {any} */ (e)?.message || e);

  /** @param {any} s */
  async function deleteChat(s) {
    const yes = await confirmDialog({ title: "Delete this chat?", description: "The session and its archive leave with it; this cannot be undone.", confirmLabel: "Delete", destructive: true });
    if (!yes) return;
    try {
      await api(`/memory/sessions/${encodeURIComponent(s.id)}/delete`, { method: "POST" });
      cb.onDeleted?.(String(s.id));
      cb.onToast?.("Chat deleted");
      load(query);
    } catch (e) {
      cb.onToast?.(String(/** @type {any} */ (e)?.message || e), "err");
    }
  }

  /** @param {any} s */
  async function renameChat(s) {
    const input = h("input", { class: "zc-input", type: "text", value: s.title || "", placeholder: "the chat's name" });
    const commit = async () => {
      const title = input.value.trim();
      if (!title || title === (s.title || "")) { d.close(); return; }
      try {
        await api(`/sessions/${encodeURIComponent(s.id)}/settings`, { method: "PATCH", body: { patch: { display: { title } } } });
        d.close();
        load(query);
      } catch (e) {
        cb.onToast?.(String(/** @type {any} */ (e)?.message || e), "err");
      }
    };
    const d = dialog({
      title: "Rename chat",
      body: h("div", { class: "flex flex-col gap-2" }, input),
      actions: [
        { label: "Cancel", variant: "outline", onClick: () => d.close() },
        { label: "Rename", onClick: () => commit() },
      ],
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
    });
    input.focus();
  }

  /**
   * Sessions grouped by their memory project. A project is the archive's record (its id, its dossier, its learned
   * items, its settings) under the one folder rule — a folder named with "Add project" is a project before any chat
   * lands under it, so the archive's project rows seed the groups and the sessions fill them. Sessions that named no
   * folder land under the archive's "none" project.
   * @param {any[]} sessions
   */
  function projectGroups(sessions) {
    const byProject = new Map();
    for (const p of state.projects || []) {
      if (!p?.id || p.id === "none") continue;
      byProject.set(p.id, { id: p.id, name: p.name || p.cwd || p.id, cwd: p.cwd || "", lastSeen: p.last_seen || 0, rows: [] });
    }
    for (const s of sessions) {
      const key = s.project || "none";
      if (!byProject.has(key)) byProject.set(key, { id: key, name: s.projectName || s.cwd || "(no folder)", cwd: s.cwd || "", lastSeen: 0, rows: [] });
      byProject.get(key).rows.push(s);
    }
    const groups = [...byProject.values()];
    for (const g of groups) g.rows.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || byTime(a, b));
    // Newest activity first; a project with no chats yet sorts by when it was named.
    const stamp = (g) => (g.rows[0] ? Date.parse(String((sortBy === "created" ? g.rows[0].created : g.rows[0].when) || g.rows[0].when || "")) || 0 : Number(g.lastSeen) || 0);
    groups.sort((a, b) => stamp(b) - stamp(a));
    return groups;
  }

  /** Newest first by the chosen stamp. @param {any} a @param {any} b */
  const byTime = (a, b) => String((sortBy === "created" ? b.created : b.when) || b.when || "").localeCompare(String((sortBy === "created" ? a.created : a.when) || a.when || ""));

  /** The Projects header: its name, Add project and the filter menu. */
  const projectsHeader = () => {
    const addBtn = h("button", {
      class: "ghost icon row-act lb-act-btn",
      type: "button",
      "aria-label": "Add project",
      html: ICONS.plus,
      onclick: (/** @type {Event} */ e) => {
        e.stopPropagation();
        cb.onAddProject?.();
      },
    });
    tooltip(addBtn, { title: "Add project" });
    return h("div", { class: "projects-head lb-sec", "data-key": "head:projects", "data-flip": "head:projects" },
      h("span", { class: "projects-title lb-sec-name" }, organizeBy === "grouped" ? WORDS.chats : "Projects"), cb.viewOnly?.() ? null : addBtn, filterBtn());
  };

  /** Pinned's head, a section of the bar like the others. */
  const pinnedHeader = () => h("div", { class: "lb-sec pinned-head", "data-key": "head:pinned", "data-flip": "head:pinned" }, h("span", { class: "lb-sec-name" }, "Pinned"));

  /** The Spaces head (A6): between Pinned and Projects, its + New Space…. */
  const spacesHeader = () => {
    const addBtn = h("button", {
      class: "ghost icon row-act lb-act-btn",
      type: "button",
      "aria-label": "New Space…",
      html: ICONS.plus,
      onclick: (/** @type {Event} */ e) => {
        e.stopPropagation();
        openNewSpace();
      },
    });
    tooltip(addBtn, { title: "New Space…: a Space of your own, belonging to no project" });
    // A view-only device's page makes no Space (p4-view-ui).
    return h("div", { class: "projects-head lb-sec spaces-head", "data-key": "head:spaces", "data-flip": "head:spaces" }, h("span", { class: "projects-title lb-sec-name" }, "Spaces"), cb.viewOnly?.() ? null : addBtn);
  };

  /** New Space…: its sheet; once made, the bar reads it and its Space opens. */
  function openNewSpace() {
    newSpaceSheet({
      onDone: (row) => {
        cb.onToast?.(`${row.name} is made: its files go in ${row.folder}`);
        void loadSpaces();
        load(query);
        cb.onSpace?.(row.project);
      },
    });
  }

  /** A Space of your own's name and reach, changed on its sheet. @param {{ project: string }} o */
  async function changeOwnSpace(o) {
    try {
      const all = await api("/spaces/own");
      const space = (all?.spaces || []).find((/** @type {any} */ x) => x.project === o.project);
      if (!space) throw new Error("That Space is gone.");
      newSpaceSheet({ space, onDone: (row) => { cb.onToast?.(`${row.name} is changed`); void loadSpaces(); load(query); } });
    } catch (e) {
      cb.onToast?.(errOf(e), "err");
    }
  }

  /**
   * A project's group in the bar — or a Space of your own's, under Spaces (A6): its name, its count of chats, its ⋯; open,
   * its Space row first, then its chats.
   * @param {{ id: string, name: string, cwd: string, rows: any[] }} g @param {boolean} open  open where nothing was set by hand
   * @param {{ project: string, name: string, folder: string } | null} [own]
   */
  function groupEl(g, open, own = null) {
    const body = h("div", { class: "sess-group-body" });
    const leaf = own ? own.name : (g.name || "").split(/[\\/]/).pop() || g.name;
    // Its folder in its chip's colour: the chip a row of it shows in Now, named as Now names it.
    const named = placeName(String(g.rows[0]?.projectName || g.rows[0]?.cwd || g.name || ""));
    const remembered = openState.get(g.id);
    // Its chats at home: not one that stands in Now, nor a pinned one, which stands under Pinned. Its count is those, what
    // it opens to, and its tooltip says where the rest stand (the Designer's of 10-27, on the Hunter's find).
    const home = g.rows.filter((s) => !s.pinned && !now.stands(String(s.id)));
    const inNow = g.rows.filter((s) => now.stands(String(s.id))).length;
    // The other machines' chats of its repository (the remote desk of 11-22) stand with its own, counted with them.
    const theirs = own ? [] : deskJoined.get(String(g.id)) || [];
    const counted = projectCountWords(home.length + theirs.length, inNow, g.rows.length - home.length - inNow);
    /** Its folder's glyph, open or folded. @param {boolean} opened */
    const folderIc = (opened) => (own ? ICONS.layoutGrid : opened ? ICONS.folderOpen : ICONS.folder);
    /** Its head, its mark as who is at work in it stands now. @param {boolean} opened */
    const summaryOf = (opened) => {
      const mark = foldedMark(home);
      return h("summary", {
        "data-flip": `project:${g.id}`,
        "aria-label": [leaf, ...(own ? [] : counted.split(" · ")), ...(mark ? [String(mark.getAttribute("title"))] : [])].join(", "),
        // Right-click: its ⋯'s menu (10-29: Make a Space is there).
        oncontextmenu: (/** @type {MouseEvent} */ e) => {
          if (own) return;
          e.preventDefault();
          projectMenu(g, /** @type {HTMLElement} */ (e.currentTarget));
        },
      },
        h("span", { class: `${own ? "proj-ic own-space-ic" : "proj-ic"} c-${chipTone(named)}`, html: folderIc(opened) }),
        h("span", { class: "proj" }, leaf),
        mark,
        own ? null : h("span", { class: "proj-count", "data-key": "count", title: counted }, String(home.length + theirs.length)),
        own ? ownSpaceMenuBtn(own) : projectMenuBtn(g));
    };
    const opened = !!(remembered ?? open);
    const det = h("details", {
      class: `sess-group${own ? " own-space" : ""}`, "data-key": `project:${g.id}`, "data-project": g.id, ...(opened ? { open: "" } : {}),
      ontoggle: (/** @type {Event} */ e) => {
        const d = /** @type {HTMLDetailsElement} */ (e.currentTarget);
        openState.set(g.id, d.open);
        const ic = d.querySelector(".proj-ic");
        if (ic) setHtml(/** @type {HTMLElement} */ (ic), folderIc(d.open));
      },
    }, summaryOf(opened), body);
    // A Space of your own's first row is its Board: the group's head is the Space (the Designer's redesign of 10-29). Its
    // rows are its Board and its apps alone — never its chats (the owner's of 11-05): one at work or waiting on you stands
    // in Now, and the rest are found by search and on the Space's page.
    body.replaceChildren(...keptSpaceRows(g, own, "", !!own), ...(own ? [] : nestThreads(home).flatMap((s) => rowsOf(s))));
    // The other machines' chats of its repository after its own (the remote desk of 11-22).
    body.append(...theirs.map(deskChatRow));
    // Who is at work in it moved and no chat came or went: its folded head's mark again, on the head that stands.
    partOf(g.id, () => {
      const live = projectEls.get(g.id);
      const summary = live?.querySelector(":scope > summary");
      if (live && summary) morph(summary, summaryOf(live.open));
    });
    return det;
  }

  /** One of a project's parts that show who is at work in it (`atWorkParts`). @param {string} id @param {() => void} paint */
  function partOf(id, paint) {
    atWorkParts.set(id, [...(atWorkParts.get(id) || []), paint]);
  }

  /**
   * A project's Space row (`spaceRows`), kept with its project's parts: its count of chats working is drawn again as a
   * turn begins or ends (`patchChats`).
   * @param {{ id: string, rows: any[] }} g @param {{ project: string, name: string, folder: string } | null} [own]
   * @param {string} [name] @param {boolean} [board]  a Space of your own's Board, in its group
   */
  function keptSpaceRows(g, own = null, name = "", board = false) {
    const rows = spaceRows(g, own, name, board);
    const key = rows[0]?.getAttribute("data-key");
    if (key) partOf(g.id, () => {
      const live = [...list.querySelectorAll(".space-row")].find((x) => x.getAttribute("data-key") === key);
      const next = spaceRows(g, own, name, board)[0];
      if (live && next) morph(live, next);
    });
    return rows;
  }

  /**
   * Who is at work in these chats moved — a turn began or ended, here or in another window — and none of them came to
   * Now or went home: their rows are drawn again where they stand, with their projects' marks and Space rows, and nothing
   * else. The bar was drawn anew whole for each, every row of it measured twice for its moves. A chat that comes or goes
   * is a move, which Now has the bar draw whole (`onMoved`); a press holds the patch as it holds a draw.
   * @param {Iterable<string>} chains
   */
  function patchChats(chains) {
    const was = draws;
    // The chat open may work now: Now marks its row too, and says when a chat came or went.
    now.refresh();
    if (draws !== was || drawHeld || loadFailed) return;
    if (hold.pressing()) {
      drawHeld = true;
      return;
    }
    const key = focusedKey();
    const shown = shownSessions();
    for (const chain of new Set(chains)) {
      const s = shown.find((x) => x.id === chain);
      if (!s) continue;
      for (const row of list.querySelectorAll(".sess-row")) if (row.getAttribute("data-chain") === chain) morph(row, sessionRow(s, { timeline: row.classList.contains("tl") }));
      for (const paint of atWorkParts.get(String(s.project || "none")) || []) paint();
    }
    refocus(key);
  }

  /** The chats the list shows: this tab's that have no row yet, and the archive's, its archived projects' kept out but in the Archived view. */
  function shownSessions() {
    const all = state.sessions || [];
    return [...localRows(all), ...all.filter((s) => showArchived || !archivedProjects.has(String(s.project || "")))];
  }

  /** A chat's own chat on this page, or the local row's. @param {any} s */
  const chatFor = (s) => s.local || [...state.chats.values()].find((c) => c.chainId === s.id) || null;

  /**
   * A folded project's mark for a chat of its at work that stands home — Now folded, or a move waiting for the pointer —
   * shown only while the project is folded: the orange dot of one that waits for you, else the spinner. A pinned chat
   * stands under Pinned, and marks it there.
   * @param {any[]} home  the project's chats at home
   */
  function foldedMark(home) {
    if (home.some((s) => state.pausedChains.has(s.id))) return h("span", { class: "proj-live row-dot needs", title: "A chat in it waits for you" });
    const n = home.filter((s) => atWork(s.id, chatFor(s))).length;
    return n ? h("span", { class: "proj-live live-spin", html: ICONS.loader, title: `${n} working in it` }) : null;
  }

  /** What the last draw laid out by: a draw that changes it — the grouping, Now's place, the archive — draws still. */
  let laidOut = "";

  /** The bar drawn anew, Now and the list together: each move between them is drawn as a flight (bar-flight.js). */
  function draw() {
    if (hold.pressing()) {
      drawHeld = true;
      return;
    }
    drawHeld = false;
    draws++;
    factsSaid.clear();
    const layout = `${organizeBy}|${nowOnTop}|${showArchived}`;
    const before = moving() && layout === laidOut ? notePlaces(host) : new Map();
    laidOut = layout;
    const key = focusedKey();
    drawing = true;
    try {
      drawLists();
    } finally {
      drawing = false;
    }
    refocus(key);
    playMoves(host, fly, before, { homeOf });
  }

  /** Where a chat with no row of its own in the list goes and comes from: its folded project's head; null where none. @param {string} chain */
  function homeOf(chain) {
    const s = sessionOf(chain);
    const det = s ? projectEls.get(String(s.project || "none")) : null;
    return det && !det.open ? det.querySelector("summary") : null;
  }

  function drawLists() {
    atWorkParts.clear();
    morphChildren(list, listNodes());
    // Each project's group as it stands: the parts a turn draws again, and expand or collapse all, act on it.
    projectEls.clear();
    for (const det of list.querySelectorAll("details.sess-group")) projectEls.set(String(det.getAttribute("data-project")), /** @type {HTMLDetailsElement} */ (det));
  }

  /** What the list holds: its heads, Pinned, the Spaces and each project's group, or by time — or why it is empty. */
  function listNodes() {
    // The chat open may have changed: Now marks its row too — and draws one a press held, which it may not see moved.
    now.refresh();
    if (nowHeld) paintNow(nowHeld);
    deskDrawn = deskListNow();
    // Now sits on top, or under the projects when the filter menu says so; never while no folder is open yet — but
    // where another machine's chats show (the review of s1b: a laptop that only drives a workstation listed none).
    const hasAny = !!((state.sessions || []).length || (state.projects || []).length || [...state.chats.values()].some((c) => c.cwd)) || deskOn();
    placeChildren(nowOnTop ? nowTop : nowBottom, hasAny ? [now.el] : []);
    placeChildren(nowOnTop ? nowBottom : nowTop, []);
    if (loadFailed) return [h("div", { class: "muted pad" }, loadFailed)];
    const sessions = shownSessions();
    const hasProjects = sessions.length || (state.projects || []).length || [...state.chats.values()].some((c) => c.cwd) || deskListed();
    // A draw before the list is read (the Spaces' read answered first): the bar holds nothing yet, rather than saying it
    // has nothing.
    if (!hasProjects && !listRead) return [];
    if (!hasProjects && cb.viewOnly?.())
      return [h("div", { class: "lb-empty" }, h("div", { class: "lb-empty-title" }, "No chats yet"), h("div", { class: "lb-empty-line" }, VIEW_ONLY_BAR_WORDS))];
    if (!hasProjects) {
      // Empty (§4.1): no project yet — open a folder to start; Now stays hidden.
      return [h("div", { class: "lb-empty" },
        h("div", { class: "lb-empty-title" }, "Open a folder to start"),
        h("button", { class: "lb-empty-btn", type: "button", onclick: () => cb.onOpenFolder?.() }, "Open folder…", h("span", { class: "sess-new-hint" }, "Ctrl+O")),
        // Or a Space of your own, which needs no project (A6).
        h("button", { class: "lb-empty-btn", type: "button", onclick: () => openNewSpace() }, "New Space…"))];
    }
    // By time, a project's Space stands under Spaces too, named for its project, its apps under it: it has no project's
    // group to stand in (found reviewing the left bar's apps, 10-29).
    const projectSpaces = () => {
      const ownIds = new Set(ownSpaces.map((o) => o.project));
      return projectGroups(sessions).filter((g) => !ownIds.has(g.id) && hasSpace(g.id)).flatMap((g) => keptSpaceRows(g, null, (g.name || "").split(/[\\/]/).pop() || g.name));
    };
    if (!sessions.length && organizeBy === "grouped") {
      return [spacesHeader(), ...ownSpaces.flatMap((o) => spaceRows({ id: o.project, rows: [] }, o)), ...projectSpaces(), projectsHeader(), h("div", { class: "muted pad" }, query ? "No matching chats" : "No chats yet")];
    }
    // A chat that stands in Now is drawn there alone (the Designer's of 10-27).
    const home = (/** @type {any} */ s) => !now.stands(String(s.id));
    const pinned = sessions.filter((s) => s.pinned && home(s));
    // Each chat's row, with the teams on its side under it.
    under = sideChatsUnder(sideChats, { running: state.runningChains, paused: state.pausedChains, errored: state.erroredChains, stopped: state.stoppedChains });
    // And each thread under the chat that started it, in whichever list holds them both (`nestThreads`).
    threadsUnder = new Map();
    threadDepth = new Map();
    if (organizeBy === "grouped") {
      const rest = sessions.filter((s) => !s.pinned && home(s)).sort(byTime);
      const nodes = [];
      if (pinned.length) {
        nodes.push(pinnedHeader());
        nodes.push(...nestThreads(pinned).flatMap((s) => rowsOf(s, { timeline: true })));
      }
      // By time, a Space of your own is its Space's row alone: its chats stand in the timeline (A6).
      nodes.push(spacesHeader());
      for (const o of ownSpaces) nodes.push(...keptSpaceRows({ id: o.project, rows: sessions.filter((s) => s.project === o.project) }, o));
      nodes.push(...projectSpaces());
      nodes.push(projectsHeader());
      const order = ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "Older"];
      /** @type {Map<string, any[]>} */
      const buckets = new Map(order.map((k) => [k, /** @type {any[]} */ ([])]));
      for (const s of nestThreads(rest)) {
        const bucket = buckets.get(timelineBucket(s.when)) || buckets.get("Older") || [];
        bucket.push(s);
      }
      for (const k of order) {
        const rows = buckets.get(k) || [];
        if (!rows.length) continue;
        nodes.push(h("div", { class: "sess-group-label", "data-key": `when:${k}`, "data-flip": `when:${k}` }, k));
        nodes.push(...rows.flatMap((s) => rowsOf(s, { timeline: true })));
      }
      return nodes;
    }
    const everyGroup = projectGroups(sessions);
    // The Spaces of your own stand under Spaces, between Pinned and Projects (A6): one with no chat yet too.
    const ownIds = new Set(ownSpaces.map((o) => o.project));
    const groups = everyGroup.filter((g) => !ownIds.has(g.id));
    const nodes = [];
    if (pinned.length) {
      nodes.push(pinnedHeader());
      nodes.push(...nestThreads(pinned).flatMap((s) => rowsOf(s)));
    }
    nodes.push(spacesHeader());
    ownSpaces.forEach((o, i) => {
      const g = everyGroup.find((x) => x.id === o.project) || { id: o.project, name: o.name, cwd: o.folder, lastSeen: 0, rows: [] };
      nodes.push(groupEl(g, i < 2 && g.rows.length > 0, o));
    });
    nodes.push(projectsHeader());
    // The other machines' chats (the remote desk of 11-22): by project, those of a repository a project here has under it
    // and the rest in groups of their own after; by machine, each machine's under its name, This computer's first.
    deskJoined = new Map();
    deskMarked = deskMarks(deskNow());
    const byMachine = organizeBy === "machine" && deskListed();
    const theirs = deskListed() ? deskChatsHome() : null;
    if (theirs && !byMachine) deskJoined = theirs.joined;
    if (byMachine && desk) nodes.push(machineLabel(desk.here, ""));
    // The first two open where nothing was set by hand; a pinned chat stands under Pinned, and opens no project.
    for (const g of groups) nodes.push(groupEl(g, groups.indexOf(g) < 2));
    if (theirs && !byMachine) nodes.push(...theirs.apart.map((dg) => deskGroupEl(dg)));
    if (byMachine && desk) {
      for (const m of desk.machines) {
        if (hiddenMachines.has(m.id)) continue;
        nodes.push(machineLabel(m, awayWords(m)));
        const own = deskChatsHome(m.id);
        nodes.push(...own.apart.map((dg) => deskGroupEl(dg)));
        if (!own.apart.length) nodes.push(h("div", { class: "muted pad desk-none", "data-key": `desk-none:${m.id}` }, m.recent.length ? "Its chats stand in Now" : "No chats there yet"));
      }
    }
    return nodes;
  }

  // --- the other machines' chats under the projects (the remote desk of 11-22) ---
  /** Each project here's other machines' chats, by its id, as the last draw found them (`deskChatsHome`). @type {Map<string, import("./lib/desk.js").DeskChat[]>} */
  let deskJoined = new Map();
  /** Which of theirs wait on you or work, as the last draw found them (lib/desk.js `deskMarks`). @type {Map<string, "needs" | "works">} */
  let deskMarked = new Map();
  /**
   * The other machines' chats that stand under the projects: not one Now shows (one chat, one place — Now folded, or
   * past its Done's newest three, shows it not, and it stands here), a hidden machine's none. With `only`, that
   * machine's alone, each of its projects apart; else those of a repository a project here has stand under it
   * (lib/desk.js `deskProjects`, by its `mergeKey`).
   * @param {string} [only] @returns {ReturnType<typeof deskProjects>}
   */
  function deskChatsHome(only) {
    const hidden = only ? new Set((desk?.machines || []).map((m) => m.id).filter((id) => id !== only)) : hiddenMachines;
    return deskProjects(desk, only ? new Map() : ownKeysOf(state.projects || []), hidden, { merge: !only, inNow: now.theirsShown() });
  }

  /**
   * A machine's head when the list is grouped by machine: its icon in its colour and its name, greyed with why while
   * it does not answer. @param {{ id: string, name: string, color: string, icon: string }} m @param {string} away
   */
  function machineLabel(m, away) {
    return h("div", { class: `sess-group-label desk-machine${away ? " is-away" : ""}`, "data-key": `machine:${m.id}`, "data-flip": `machine:${m.id}`, title: away || m.name },
      h("span", { class: `desk-machine-ic c-${m.color}`, html: glyphOf(m.icon) }), h("span", { class: "desk-machine-name" }, m.name));
  }

  /**
   * A project of the other machines' that has none here — a repository's on every machine as one, else one machine's —:
   * its folder in its chip's colour, its name, its machines' icons; its chats under it, each opening on its machine.
   * @param {ReturnType<typeof deskProjects>["apart"][number]} dg
   */
  function deskGroupEl(dg) {
    const id = `desk:${dg.key}`;
    const opened = !!(openState.get(id) ?? false);
    const leaf = dg.name.split(/[\\/]/).pop() || dg.name;
    const det = h("details", {
      class: "sess-group desk-group", "data-key": `project:${id}`, "data-project": id, ...(opened ? { open: "" } : {}),
      ontoggle: (/** @type {Event} */ e) => {
        const d = /** @type {HTMLDetailsElement} */ (e.currentTarget);
        openState.set(id, d.open);
        const ic = d.querySelector(".proj-ic");
        if (ic) setHtml(/** @type {HTMLElement} */ (ic), d.open ? ICONS.folderOpen : ICONS.folder);
      },
    },
      h("summary", { "data-flip": `project:${id}`, title: `${dg.name} — on ${dg.machines.map((m) => m.name).join(", ")}` },
        h("span", { class: `proj-ic c-${chipTone(leaf)}`, html: opened ? ICONS.folderOpen : ICONS.folder }),
        h("span", { class: "proj" }, leaf),
        h("span", { class: "desk-group-machines" }, ...dg.machines.map((m) => h("span", { class: `desk-machine-ic c-${m.color}`, html: glyphOf(m.icon), title: m.name }))),
        h("span", { class: "proj-count", "data-key": "count" }, String(dg.chats.length))),
      h("div", { class: "sess-group-body" }, ...dg.chats.map(deskChatRow)));
    return det;
  }

  /**
   * Another machine's chat under a project: its machine's icon in its colour and its name on its line — greyed while
   * that machine does not answer —, its unread dot, its age; pressed, it opens on its machine. Nothing of this computer's
   * acts on it: no menu, no pin, no Delete. @param {import("./lib/desk.js").DeskChat} c
   */
  function deskChatRow(c) {
    const away = awayWords(c.machine);
    const open = () => {
      void (/** @type {any} */ (globalThis).filamentApp?.openOn?.(c.machine.id, deskRoute(c.there)))?.catch?.(() => {});
    };
    return h("div", {
      class: `sess-row from desk-row${away ? " is-away" : ""}`,
      role: "button",
      tabindex: "0",
      "data-key": c.key,
      "data-flip": c.key,
      "data-machine": c.machine.id,
      title: [c.title, `on ${c.machine.name}`, c.from ? `from ${c.from}` : "", away].filter(Boolean).join(" · "),
      onclick: open,
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      },
    },
      // Its mark as its row under its own machine's projects wears it: waiting on you, at work (Now folded), unread.
      h("span", { class: "row-lead" },
        deskMarked.get(c.key) === "needs"
          ? h("span", { class: "row-dot needs", title: "waits for you" })
          : deskMarked.get(c.key) === "works"
            ? h("span", { class: "live-spin", html: ICONS.loader })
            : c.unread
              ? h("span", { class: "row-dot unread" })
              : null),
      h("span", { class: "sess-main" },
        h("span", { class: "row-title-line" }, h("span", { class: "sess-title" }, c.title)),
        h("span", { class: `row-from desk-on c-${c.machine.color}` },
          h("span", { class: "row-where-ic", html: glyphOf(c.machine.icon) }), h("span", { class: "row-where-text" }, c.from ? `${c.machine.name} · from ${c.from}` : c.machine.name))),
      ageEl(c.when ? new Date(c.when).toISOString() : ""));
  }

  /**
   * A project's Space row (proposal_ux §4.1, §4.14; mock-leftbar: "the projects, each with its Space"): first over
   * every project's chats — "5 tasks · 2 lanes · 1 working": the board's tasks neither done nor parked, its lanes as its
   * page counts them — its repository's main folder always, and each folder or worktree of it one of its chats works
   * in, the chat's folder or one its agents wrote in, as the rows' reads know them (`lanePlaces`) —;
   * pressed, its Space opens. The chats of no project have no Space, so no row; nor a project whose Space was not made
   * (10-29: none until the person makes one from its menu). `own`: a Space of your own, where its row
   * stands alone (the bar by time, A6): its name, its glyph and its ⋯, as its group has them by project (found by the
   * Hunter on A6: the row was the project's, with no menu). `name`: a project's Space by time, under Spaces, named for
   * its project (10-29); under its project it is "Space". `board`: a Space of your own's row in its group, its Board — the
   * group's head is the Space, with its ⋯ (the Designer's redesign of 10-29).
   * @param {{ id: string, rows: any[] }} g @param {{ project: string, name: string, folder: string } | null} [own]
   * @param {string} [name] @param {boolean} [board]
   */
  function spaceRows(g, own = null, name = "", board = false) {
    if (!g.id || g.id === "none" || !cb.onSpace || (!own && !hasSpace(g.id))) return [];
    // Its lanes, by its page's own rule (lib/space-view.js `lanePlaces`): none said until the project's folder is read,
    // nor where git reads no repository there, as its page says none.
    const at = whereOf(own?.folder || (state.projects || []).find((p) => p.id === g.id)?.cwd || /** @type {any} */ (g).cwd || "");
    const works = g.rows.filter((s) => !s.archived && !KIND_LABEL[s.kind]).flatMap((s) => [s.cwd, ...(s.places || [])]).map((f) => (f ? whereOf(f) : null)).filter((w) => w?.ok);
    const lanes = at?.ok ? lanePlaces(at.main, works) : [];
    const open = Number(spaceOpen[g.id]) || 0;
    const working = g.rows.filter((s) => state.runningChains.has(s.id) || state.holders.has(s.id)).length;
    const row = h("div", {
      class: `space-row${spaceAt === g.id && !spaceTab ? " current" : ""}`,
      role: "button",
      tabindex: "0",
      "data-space": g.id,
      "data-key": `space:${g.id}`,
      "data-flip": `space:${g.id}`,
      title: own ? (board ? `${own.name}'s Board: its tasks, who works there and what happened` : `${own.name}: its board, its routines and what happened`) : "The project's Space: its lanes, its board and its logbook",
      onclick: () => cb.onSpace?.(g.id),
      onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); cb.onSpace?.(g.id); } },
    },
    h("span", { class: "row-lead" }, h("span", { class: own ? "space-row-ic own-space-ic" : "space-row-ic", html: own && !board ? ICONS.layoutGrid : ICONS.squareKanban })),
    h("span", { class: "sess-main" }, h("span", { class: "row-title-line" }, h("span", { class: "sess-title" }, board ? "Board" : own ? own.name : name || "Space"))),
    h("span", { class: "space-row-facts" }, [open ? `${open} task${open === 1 ? "" : "s"}` : "", lanes.length ? `${lanes.length} lane${lanes.length === 1 ? "" : "s"}` : "", working ? `${working} working` : ""].filter(Boolean).join(" · ")),
    ...(own && !board ? [ownSpaceMenuBtn(own)] : []));
    // Under it, what the Space shows besides its Board (the owner's idea of 10-29: "every dashboard or App we create in
    // the Space is shown as a child of the Space in the left bar"): Routines, Watchers, then each app and dashboard as
    // its tab said it; a press opens its page.
    const routines = spaceRoutines[g.id];
    const watchers = spaceWatchers[g.id];
    const kids = [
      ...(routines ? [{ key: ROUTINES, label: "Routines", tip: routines.failed ? "What runs by itself: a run failed" : "What runs by itself, and what you run", cls: "", dot: !!routines.failed, dotSays: "a run failed", ic: ICONS.clock3 }] : []),
      ...(watchers ? [{ key: WATCHERS, label: "Watchers", tip: watchers.failed ? "What listens for events: a run failed" : "What listens for events, and whom each wakes", cls: "", dot: !!watchers.failed, dotSays: "a run failed", ic: ICONS.eye }] : []),
      ...appRowsOf(spaceApps[g.id] || [], Date.now()),
    ];
    return [row, ...kids.map((k) => {
      const go = () => cb.onSpace?.(g.id, k.key);
      return h("div", {
        class: `space-app-row${k.cls ? ` ${k.cls}` : ""}${spaceAt === g.id && spaceTab === k.key ? " current" : ""}`,
        role: "button",
        tabindex: "0",
        "data-space": g.id,
        "data-tab": k.key,
        // What the bar keeps focus and moves by, as it draws again.
        "data-key": `space-app:${g.id}:${k.key}`,
        "data-flip": `space-app:${g.id}:${k.key}`,
        title: k.tip,
        // Its name first, then the dot's words: "Deploys, couldn't read" (seen at S6's live look on the tabs).
        ...(k.dot ? { "aria-label": `${k.label}, ${k.dotSays}` } : {}),
        onclick: go,
        onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(); } },
      },
      h("span", { class: "row-lead" }, h("span", { class: "space-app-ic", html: k.ic })),
      h("span", { class: "sess-main" }, h("span", { class: "row-title-line" }, h("span", { class: "sess-title" }, k.label), ...(k.dot ? [h("span", { class: "sdb-dot", "aria-hidden": "true" })] : []))));
    })];
  }

  /**
   * A Space of your own's ⋯ (A6): open it, its name and reach, its folder's path, and Delete Space… — its own two-step
   * press, which says its folder stays. No Archive: a Space of your own is kept or deleted.
   * @param {{ project: string, name: string, folder: string }} o
   */
  function ownSpaceMenuBtn(o) {
    return h("button", { class: "ghost icon row-act", type: "button", title: "Space menu", html: ICONS.ellipsis, onclick: (/** @type {MouseEvent} */ e) => {
      e.stopPropagation();
      // On the button that stands, whichever draw made the handler.
      const b = /** @type {HTMLElement} */ (e.currentTarget);
      menu([
        cb.onSpace ? { label: "Open its Space", icon: "squareKanban", onClick: () => cb.onSpace?.(o.project) } : null,
        { label: "Name and what it reads…", icon: "pencil", onClick: () => void changeOwnSpace(o) },
        { label: "Copy path", icon: "copy", onClick: () => navigator.clipboard?.writeText(o.folder).catch(() => {}) },
        { type: "separator" },
        {
          label: "Delete Space…", icon: "trash2", variant: "destructive",
          onClick: async () => {
            try {
              if (!(await deleteOwnSpace(o, confirmDialog))) return;
              cb.onToast?.(`${o.name} deleted: its folder stays, with your files`);
              cb.onProjectGone?.(o.folder);
              void loadSpaces();
              load(query);
            } catch (e) { cb.onToast?.(errOf(e), "err"); }
          },
        },
      ], { anchor: b, side: "bottom", align: "end" });
    } });
  }

  /** @param {{ id: string, name: string, cwd?: string }} g */
  function projectMenuBtn(g) {
    return h("button", { class: "ghost icon row-act", type: "button", title: "project menu", html: ICONS.ellipsis, onclick: (/** @type {MouseEvent} */ e) => {
      e.stopPropagation();
      projectMenu(g, /** @type {HTMLElement} */ (e.currentTarget));
    } });
  }

  /**
   * A project's menu, from its ⋯ or a right-click on its row: its Space — Open, or where it has none (10-29: none until
   * the person makes one) Open its page, where the first thing added makes it (by need, 11-12), Make a Space and Bring
   * back; Delete Space… where it has one —, its folders and worktrees, its path, Archive and Delete.
   * @param {{ id: string, name: string, cwd?: string }} g @param {HTMLElement} anchor
   */
  function projectMenu(g, anchor) {
    const real = !!g.id && g.id !== "none";
    const has = real && hasSpace(g.id);
    const back = real && !has ? Number(spaceBack[g.id]) || 0 : 0;
    const name = (g.name || "").split(/[\\/]/).pop() || g.name || "this project";
    menu([
      has && cb.onSpace ? { label: "Open its Space", icon: "squareKanban", onClick: () => cb.onSpace?.(g.id) } : null,
      // Its page, with no Space: its lanes and folders, and where a Space is made by adding to it — or, while its
      // deleted one waits, brought back.
      real && !has && cb.onSpace ? { label: "Open its page", icon: "folder", desc: back ? "Its lanes and folders, and its deleted Space, to bring back or make anew" : "Its lanes and folders; the first thing you add there makes its Space", onClick: () => cb.onSpace?.(g.id) } : null,
      // What a Space is, where it is made (the Designer's walk of 10-29).
      real && !has && cb.onSpace ? { label: "Make a Space", icon: "squareKanban", desc: "A board of tasks, What happened, and the apps its chats make: every chat in it can see and change it", onClick: () => void makeSpace(g.id, name) } : null,
      back && cb.onSpace ? { label: "Bring back its Space", icon: "rotateCcw", onClick: () => void bringSpaceBack(g.id, name) } : null,
      real && cb.onSpacePlaces ? { label: "Folders and worktrees…", icon: "gitFork", onClick: () => cb.onSpacePlaces?.(g.id) } : null,
      g.cwd ? { label: "Copy path", icon: "copy", onClick: () => navigator.clipboard?.writeText(String(g.cwd)).catch(() => {}) } : null,
      { type: "separator" },
      has ? { label: "Delete Space…", icon: "trash2", variant: "destructive", onClick: () => void deleteSpace(g.id, name) } : null,
      // Archive hides the project from the tree and keeps everything; Delete is the destructive second step. Archived,
      // nothing in it runs by itself (r-itself, 11-12): its chats take no turn Filament starts, its Space's routines
      // and watchers stand still, until Unarchive in Settings › Archived.
      real ? {
        label: "Archive project", icon: "archive",
        onClick: async () => {
          try {
            await api(`/memory/projects/${encodeURIComponent(g.id)}/archive`, { method: "POST", body: { archived: true } });
            cb.onToast?.("Project archived: its chats stay in the archive, and nothing in it runs by itself until you bring it back");
            load(query);
          } catch (e) { cb.onToast?.(errOf(e), "err"); }
        },
      } : null,
      real ? {
        label: "Delete project", icon: "trash2", variant: "destructive",
        onClick: async () => {
          // Its Space goes with it, said before the press (HarnessV4_SpacesPlugins_Plan A5): nothing when nobody used it.
          const goes = await api(`/space/${encodeURIComponent(g.id)}/goes`).then((/** @type {any} */ x) => String(x?.words || "")).catch(() => "");
          const description = ["Every session under it, their turns, learned items and its dossier go with it.", goes, "The folder and its files stay. This cannot be undone."].filter(Boolean).join(" ");
          const yes = await confirmDialog({ title: "Delete this project?", description, confirmLabel: "Delete", destructive: true });
          if (!yes) return;
          try {
            await api(`/memory/projects/${encodeURIComponent(g.id)}/delete`, { method: "POST" });
            // The folder stops being a place the next chat points at: the recents and the header chip forget it.
            if (g.cwd) cb.onProjectGone?.(g.cwd);
            cb.onToast?.("Project deleted");
            load(query);
          } catch (e) { cb.onToast?.(errOf(e), "err"); }
        },
      } : { type: "separator" },
    ], { anchor, side: "bottom", align: "end" });
  }

  /**
   * Make a Space (10-29): made — with its old board's tasks, where it had a Space before —, its row in the bar, opened.
   * @param {string} id @param {string} name
   */
  async function makeSpace(id, name) {
    try {
      const r = await api(`/space/${encodeURIComponent(id)}`, { method: "POST" });
      const n = Number(r?.tasks) || 0;
      cb.onToast?.(n ? `${name}'s Space is made: ${n} task${n === 1 ? "" : "s"} came back from its old board` : `${name}'s Space is made`);
      await loadSpaces();
      cb.onSpace?.(id);
    } catch (e) { cb.onToast?.(errOf(e), "err"); }
  }

  /**
   * Delete Space… (10-29): what it holds said first, and that Bring back has it for 30 days; the project and its chats
   * stay.
   * @param {string} id @param {string} name
   */
  async function deleteSpace(id, name) {
    const goes = await api(`/space/${encodeURIComponent(id)}/goes`).then((/** @type {any} */ x) => String(x?.words || "")).catch(() => "");
    const description = [
      goes.replace(/^Its Space goes too: /, "It holds "),
      "Its routines and kept dashboards stop, a button running in one too; the project and its chats stay, and its chats have no space tool from their next message.",
      "Bring it back as it was from the project's menu, for 30 days.",
    ].filter(Boolean).join(" ");
    const yes = await confirmDialog({ title: `Delete ${name}'s Space?`, description, confirmLabel: "Delete Space", destructive: true });
    if (!yes) return;
    try {
      await api(`/space/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast(`${name}'s Space is deleted: Bring back has it for 30 days, in the project's menu`, "", { action: { label: "Undo", title: "Bring it back as it was", onClick: () => void bringSpaceBack(id, name, false) } });
      void loadSpaces();
    } catch (e) { cb.onToast?.(errOf(e), "err"); }
  }

  /**
   * Bring back its Space: as it was when it was deleted, opened — not by the delete's Undo, which stays where it was.
   * @param {string} id @param {string} name @param {boolean} [open]
   */
  async function bringSpaceBack(id, name, open = true) {
    try {
      const got = await api(`/space/${encodeURIComponent(id)}/back`, { method: "POST" });
      cb.onToast?.(backWords(`${name}'s Space is back`, got?.takenOut));
      await loadSpaces();
      if (open) cb.onSpace?.(id);
    } catch (e) { cb.onToast?.(errOf(e), "err"); }
  }

  /**
   * The previous or next chat in the bar (Ctrl+Shift+[ and ]): Now's and the list's, in the order they stand — this
   * computer's alone: another machine's would show that machine in the window (the review of s1b). @param {number} dir
   */
  function cycleChat(dir) {
    const inNow = [...now.el.querySelectorAll(".now-row[data-chain]")];
    const inList = [...list.querySelectorAll(".sess-row:not(.desk-row)")];
    const rows = nowOnTop ? [...inNow, ...inList] : [...inList, ...inNow];
    if (!rows.length) return;
    const idx = rows.findIndex((r) => r.classList.contains("current") || r.classList.contains("is-current"));
    const next = rows[(idx + dir + rows.length) % rows.length];
    if (next) /** @type {HTMLElement} */ (next).click();
  }

  /** Alt+N: the newest thing that needs you, opened; false when nothing does. */
  function openNext() {
    const r = now.next();
    if (!r) return false;
    openRow(r);
    return true;
  }

  return {
    load, draw, drawOpen: draw, loadRuns, loadHolders, cycleTask: cycleChat, placesMoved, openNext, atLibrary, atSpace, atYourSpace, paintAges,
    /**
     * Settings › Experimental's Teams switch moved: the agents' row named as it has it, and its count read again where
     * the Library's were read, your teams in it while teams are on.
     */
    teamsSwitched: () => {
      const it = /** @type {typeof LIBRARY[number]} */ (LIBRARY.find((x) => x.id === "agents"));
      libName.agents.textContent = libLabel(it);
      railLib.agents?.setAttribute("aria-label", libLabel(it));
      if (libraryAt) void readAgentsCount();
    },
    /** The room in the top bar between Hide and Settings, where the chat's crumb stands while the bar shows. */
    crumbSlot,
    /** A chat Now has nothing left to show of — Not now gave its message back — home under its project at once. @param {string} chain */
    homeChat: (chain) => now.home(chain),
    /** Now's three groups as they stand, for Your Space's Today (S5b). */
    nowGroups: () => now.groups(),
    /** Now drawn again, alone: a chat's background commands started or ended as its transcript said (E38). */
    refreshNow: () => now.refresh(),
    /** A row of Now opened, as the bar opens it: its chat, or its thread. @param {import("./lib/now.js").NowRow} r */
    openNow: (r) => openRow(r),
    /** Now's row of a chat, its own before its threads': what a Space's lane says of it. @param {string} chain */
    nowOf: (chain) => now.rowOf(chain),
    /** The Spaces of your own as the bar lists them (E50): where work handed from one may go (A4). */
    ownSpaces: () => ownSpaces.map((o) => ({ project: String(o.project), name: String(o.name), folder: String(o.folder || "") })),
    /** Whether a project has a Space, as the bar last read it: the chat menu's Watch this chat… asks. */
    hasSpace,
    /** Whether a project's deleted Space waits for Bring back, as the bar last read it: Watch this chat… is off then. */
    spaceWaits,
    /**
     * The Space a chat in this folder works in, as the bar knows it: a Space of your own's, or a project's that has one —
     * named as its group is —; null where none (the Designer's walk of 10-29: the Start said nothing of it).
     * @param {string} cwd @returns {{ name: string, own: boolean } | null}
     */
    spaceFor: (cwd) => {
      const at = folderKey(cwd);
      if (!at) return null;
      const own = ownSpaces.find((o) => folderKey(o.folder) === at);
      if (own) return { name: String(own.name), own: true };
      const p = (state.projects || []).find((x) => folderKey(x.cwd) === at);
      return p && hasSpace(String(p.id)) ? { name: String(p.name || "").split(/[\\/]/).pop() || String(p.name), own: false } : null;
    },
  };
}
