// @ts-check
// The harness's client-side state: the open chats, the current one, the sessions list and the models. Everything
// sensitive is a module variable or sessionStorage (a draft); nothing but folder and model preferences reaches
// localStorage. A chat's shape is the one the transcript renders; `live` is what a streaming reply fills. The
// conversation itself lives on the server (the session's archive chain); a chat here is a view onto it.
import { store } from "../lib/store.js";

/** @typedef {object} Chat
 * @property {string} id  the chat's own id on this page (a session gets its chain id at creation; the chat keeps its own)
 * @property {"new"|"open"|"fork"} kind  started here · an archived session opened · a fork opened
 * @property {string | null} chainId  the session — the archive chain — once it exists (created at the first send, or opened)
 * @property {Promise<string> | null} [making]  the session being made for the chat's first send (app.js `ensureSession`): a send meanwhile waits for it, and makes none of its own
 * @property {Promise<string | null> | null} [picking]  the folder asked for where the chat's folder is not on this machine (app.js `readySession`): a send that met the same folder waits for it, and opens no picker of its own
 * @property {string} [runOn]  where a new chat runs (Run on, the remote desk's s2c): "" this computer, "auto", or another machine's id — held until its first send, which starts it there (app.js `runOnFirst`)
 * @property {string} [runOnName]  that machine's name, as the chip says it before its machines are read
 * @property {boolean} [runOnBusy]  its first send is under way there: another Enter is refused, in words
 * @property {{ machine: string, name: string, chat: string, work: any, folder: string }} [runOnStarted]  a chat started
 *   there for it whose first message did not go: the next send from the folder, to that machine, goes to it
 * @property {string} [runOnSaw]  the machine Auto's chip named last ("" none): a send whose pick read anew is another says so first
 * @property {string} [runOnTold]  the machine and model a send said the model does not answer on: the next send there goes on its stand-in
 * @property {string} [runOnBack]  its words a Run on send gave back while another folder's Start held the draft: back in its box when shown
 * @property {string} cwd  the project folder this chat works in (per chat, not per message)
 * @property {string | null} [projectId]  the project the archive filed its session in at its create (app.js `makeSession`, GW-D54), before the list names it
 * @property {{ branch: string, counts: any } | null} [git]  the project's git status, for the status panel
 * @property {number} [gitAt]  when that status was fetched
 * @property {number} [goalAt]  when the session's goal was last looked up (0: look again now)
 * @property {string} model
 * @property {string | null} load  `chainId:view` — a session loaded as memory material on the first turn ("Load into a new task")
 * @property {{ from: string, fromTitle: string | null, atTurn: number, worktree?: string } | null} forkedFrom
 * @property {any[]} turns  the transcript's turns (earlier turns from the server's transcript, then the ones sent here)
 * @property {any | null} live  the streaming turn (see conversation/timeline.js)
 * @property {import("./lib/agent-tasks.js").AgentTask[]} [agentTasks]  its coding agent's own tasks, the whole list as its turn last said it (HarnessV4_Tasks U1)
 * @property {number} [agentTasksAt]  when the events feed last said that list (app.js `setAgentTasks`): a read of the transcript asked before then keeps it
 * @property {import("./conversation/watch-line.js").ChatWatcher[]} [watchers]  the watchers that watch it or wake it, the whole list as the server last said it (conversation/watch-line.js)
 * @property {number} [watchersAt]  when the events feed last said that list (app.js `setWatchers`): a read of the transcript asked before then keeps it
 * @property {Record<string, any[]>} [reviews]  the turns its watchers reviewed, by their numbers, the whole map as the server last said it (conversation/history.js `reviewsMoved`)
 * @property {number} [reviewsAt]  when the events feed last said that map (app.js `setReviews`): a read of the transcript asked before then keeps it
 * @property {any | null} [waiting]  the harness queue (Step 3 D14): a send waiting while the chat is held (its move, a coding agent's own turn)
 * @property {import("./composer/queue.js").QueueState} [queue]  what waits for this chat's turn to end (Views V3)
 * @property {(hash: string | null | undefined) => void} [settingsFollow]  reads the settings document again when the events feed says it moved elsewhere (BUG-10 P9; live-topic.js `settingsFollower`)
 * @property {boolean} [hydrateAfterSend]  the end of its running turn reloads the transcript: its turn is drawn from the transcript's copy (a silent reply given up, a connection that dropped), or the events feed came back meanwhile
 * @property {boolean} [compactAfter]  Stop and compact was asked (HarnessV4_Tasks U2): the server compacts the session once its running turn has ended, and this page waits for its answer
 * @property {number} [compactAsked]  the compactions this page asked for between its turns whose answers it waits for (app.js `compactNow`): what is sent meanwhile waits for them
 * @property {boolean} [roomWait]  what was sent while a compaction was written waits in its queue for the room (app.js `sendMessage`): it goes once the room is made (`roomMade`), or waits paused where none was (`roomNotMade`)
 * @property {{ message: string, files: any[], ask: import("./conversation/interaction.js").Ask, work: import("./conversation/interaction.js").AskWork | null } | null} [summoned]  the compaction card `/compaction` brought up (the owner's words of 10-18), after the last turn: the chat's figures when it came, the message it holds, and its Compact while it runs
 * @property {ReturnType<typeof setTimeout>} [forceTimer]  the Force stop offer after a stop sent through the session, where no turn of this page's carries it
 * @property {Set<string>} [subagentSent]  the kept sub-agent reports the developer sent on (`<id>:<exchange>`), as the session records them — what an arrival row reads once the registry has forgotten the sub-agent
 * @property {any} [graphLive]  the session's task graph as the page's feed last brought it (HarnessV3-TaskGraph G2-10): the newest by its rev
 * @property {Map<string, import("./views/task-graph.js").TaskProgress>} [taskProgress]  each running graph task's newest step, from its sub-agent's run
 * @property {string} [viewTab]  the session's view on screen, Chat or Plan (HarnessV3-Views VW-D1): views/host.js; the address carries it
 * @property {Set<string>} [cardsOpen]  the saved agents' answers whose card stands open in the chat (`<id>:<exchange>`): one the page opened itself — Catch me up's — or the person did (HarnessV4_Tasks E15 step 7)
 * @property {number} [shownAt]  when the page last showed it: the chats shown last are kept, older ones let go (lib/release.js)
 * @property {number} [unseenAt]  when the feed last told of a turn on its session while another chat was shown (a wake, a resume, another tab's), or while its own first read was on its way: showing it — or that read landing — reads the transcript again, and a read asked after then clears it (lib/release.js)
 * @property {number} [readsAsked]  how many reads of its transcript the page has asked (app.js `hydrate`)
 * @property {number} [readDrawn]  the newest of those drawn, by its place among them: one asked before it, landing after, draws nothing over it
 * @property {import("./lib/transcript-since.js").ServedTurns | null} [served]  the turns of the read drawn last as the server sent them, and their version: the next read is sent the turns written since (lib/transcript-since.js)
 * @property {number} [movedAt]  when the release of a move another page asked for was heard (app.js `sessionLetGo`, `heardMove`, or the feed's coming back): the first read asked since has the chat in the transcript's folder, and clears it
 * @property {Map<string, { words: string }>} [subagentOverruled]the saved agents' answers the developer overruled (`<id>:<exchange>`), each with the first line of their words: an answer's card says so (HarnessV4_Tasks E15 step 3)
 * @property {import("./composer/overrule-line.js").Overruling[]} [overruling]  whose answers the chat's next message to the main agent overrules: the line over the box
 * @property {Set<string>} [subagentHeld]  the kept sub-agent reports still waiting to be sent on (`<id>:<exchange>`), as the session keeps them across a restart — an arrival row keeps its Send from them once the registry has forgotten the sub-agent
 * @property {any[]} [asked]  the marks of the saved agents asked before the chat's first turn (HarnessV4_Tasks E15 AG-24): their cards stand where
 *   that turn will; once a turn is read from the server, the turns hold them
 * @property {any[]} [visuals]  the pictures its helpers drew that no turn launched, as the session keeps them (HarnessV4_Visuals_Plan VS-D48): each by its call's id, title, size, and the helper and exchange that drew it
 * @property {any[]} [made]  the artifacts its agent published, each by its call (HarnessV4_Artifacts_Plan AF-D38)
 * @property {any[]} [helpersMade]  the artifacts its helpers published, by helper and exchange (AFC-100)
 * @property {boolean} following  the transcript's scroll state
 * @property {number} createdAt
 * @property {string} [title]  the session's name as the archive has it
 * @property {string | null} [permissions]  the document's effective `loop.permissions`, as the composer's picker shows it
 * @property {any} [settings]  the effective settings document at the last hydrate (the fork dialog reads `fork.*`)
 * @property {any | null} [paused]  the parked question the server reports for this session
 * @property {boolean} [muted]  memory stays out of this session's window (`memory.enabled: false`)
 * @property {string} [forkNote]  the head note of a fork opened here
 * @property {string} [loadTitle]  the title of the session a new task loads as material
 * @property {Record<string, any>} [held]  the Start board's changes over your defaults (D15, HarnessV3-NewTask), flat dotted paths, held until the first send
 * @property {string | null} [heldPerm]  the held changes' own `loop.permissions`, for the picker's standing
 * @property {boolean} [permTouched]  the person picked a mode for this chat: it is sent at creation; untouched, the chat follows "New chats start in" (HS-D48)
 * @property {string | null} [pickedPerm]  that mode, which the composer's one switch shows again when the chat is selected
 * @property {{ folder: string, path?: string, cwd?: string, name?: string, branch?: string, make?: boolean, typed?: boolean, fromMessage?: string, off?: string[], copy?: string[] }} [worksIn]
 *   where in its folder's repository the chat will work, held until the first send (HarnessV4_Git_Plan step 5): a
 *   place (`path`, the chat's folder in it `cwd`), or a new worktree (`make`, its `name`, `typed` when you typed it,
 *   the paths of its project's list left off for it `off` and those it copies `copy`, HarnessV4_Four_Plan FO-D34);
 *   `folder`, the chooser's folder it was chosen for
 * @property {{ project: string, id: string }} [spaceTask]  the task of its project's Space it was started on (Start a chat
 *   on this…, proposal_ux §4.14): the chat takes it at its first send
 * @property {{ space: string }} [from]  the Space of your own it was handed from to run elsewhere
 *   (HarnessV4_SpacesPlugins_Plan A4): its session remembers it, and that Space's What happened says when it finishes
 * @property {{ settings: { effective: any, flat: any, sources: any, window: { tokens: number | null, source: string | null, model: string | null } | null, engine: any, hash: string | null, usage: { usd: number, requests: number, input: number, output: number, cacheRead: number, cacheWrite: number, savedUsd: number, unpriced: number, turns: number, last: any } | null, derived: any[], knobs?: any }, facts: any, windows: any, holder: any, memory: any }} [view]  the session view (Facade D7), created by the first applySessionView — `usage` and `derived` since Step 6 §2.2, read by the Spend and Cache widgets; `memory` what memory did for the newest turn (HarnessV3-Memory M6-1)
 * @property {{ at: string, turn: number, what: string, line: string, from: number, to: number, files: number } | null} [rewind]  the rewind that stands until the next message (rewind.js): its line's Undo, or the files-only line
 * @property {{ put: string, was: string } | null} [rewindDraft]  the rewound message put back in the box, and the draft it went above, which the rewind's Undo restores
 * @property {Set<string>} [rewoundShown]  the rewound lines whose turns are open, greyed
 */

export const state = {
  key: "",
  /** @type {any[]} */
  models: [],
  /** The families the catalogue's models fall into, each with its price (lib/families.js). @type {any[]} */
  families: [],
  /** @type {any[]} */
  sessions: [],
  sessionsLoadedAt: 0,
  /** @type {any[]}  the archive's project rows (not archived), the tree's groups before any task lands under them */
  projects: [],
  /** @type {Map<string, Chat>} */
  chats: new Map(),
  /** @type {string | null} */
  currentId: null,
  /** @type {Record<string, any>} */
  config: {},
  /** The system Filament runs on, in Node's names (win32, darwin, linux), as `/api/state` says it: the header's Open in
   *  menu names the file manager by it (Explorer, Finder). "" until read. */
  platform: "",
  /** "New chats start in" (Settings › Permissions, HarnessV4_Settings_Plan HS-D48): your defaults' `loop.permissions`,
   *  read at boot and after every saved change. A new chat's switch stands on it until the person picks; null until
   *  read. @type {string | null} */
  newChatMode: null,
  /** Where memory's engine stands (GET /api/memory/engine, then the events feed's `engine`): the Memory widget's pill shows an install's percent (HarnessV3-AtHome AH-D2). Null until read. */
  memoryEngine: /** @type {any} */ (null),
  /** The coding agents' accounts and their plans' windows (GET /api/agent-accounts, read again on the feed's `accounts`): the Account instrument, the plan's notice, the picker's tabs and the limit card read them (HarnessV3-ACP AC3-6). */
  accounts: /** @type {import("../lib/accounts.js").AgentRow[]} */ ([]),
  /** @type {any[]}  live terminal sessions (B4), for the status panel's Terminals section */
  terminals: [],
  /** Chains a background run finished on while the task was not selected; cleared on open. */
  unreadChains: new Set(),
  /** Chains with a live run right now (the sidebar's spinner). */
  runningChains: new Set(),
  /** chainId → the turn's holder snapshot (Facade D11): the `turns` topic keeps it current, the holders route
   *  corrects it on the 5-second tick. The sidebar spins for any holder, named in the server's words. */
  holders: new Map(),
  /** chainId → the compaction running for the session now, as the server last said it (HarnessV4_Tasks U3-5): the
   *  events feed's `compaction-progress` keeps it current, the holders route corrects it on the 5-second tick. */
  compacting: new Map(),
  /** chainId → when the feed last said a word of its compaction: a transcript read asked before it is the older word.
   *  (An Undo's word is kept on its chat, `undoneHeard`: app.js `compactionUndone`.) */
  compactingHeard: new Map(),
  /** chainId → the commands its agents run in the background now (HarnessV4_Background_Plan E38): the `turns` topic's
   *  `commands` keeps it current, the transcript and the holders route's 5-second read correct it.
   *  @type {Map<string, import("./lib/commands.js").CommandRow[]>} */
  commands: new Map(),
  /** chainId → the come-back its agent set, while it waits (agent/come-back.js; the Designer's of 10-27): the `turns`
   *  topic's `come-back` keeps it current, the transcript and the holders route's 5-second read correct it.
   *  @type {Map<string, import("./lib/come-back.js").ComeBack>} */
  comeBacks: new Map(),
  /** chainId → Filament's check-in on its agent idle while its command runs (app/sessions/idle-wake.js; the owner's of
   *  11-08): the `turns` topic's `idle-wake` keeps it current, the transcript and the holders route's read correct it.
   *  @type {Map<string, import("./lib/come-back.js").IdleWake>} */
  idleWakes: new Map(),
  /** chainId → its work stretch while it goes on (sessions/stretch.js; the owner's of 11-03: Now counts the chat's time
   *  from its start, across the turns what its agent waited on woke) — its start, and between its turns what it waits
   *  for: the feed's `stretch` keeps it current, the holders route's 5-second read corrects it.
   *  @type {Map<string, import("./lib/now.js").Stretch>} */
  stretches: new Map(),
  /** chainId → its flows at work, running or holding (the owner's of 10-28: the chat stays under Now's Working while
   *  one runs): the holders route's read says them, read again as the `turns` topic's `flow` says one moved.
   *  @type {Map<string, import("./lib/now.js").FlowAtWork[]>} */
  flows: new Map(),
  /** The Spaces' buttons running now, an app's build among them (the owner's of 10-29): the holders route's read says
   *  them, and Now has a row for each. @type {import("./lib/now.js").AppRun[]} */
  appRuns: /** @type {import("./lib/now.js").AppRun[]} */ ([]),
  /** Chains whose live run is paused on an ask (the left bar's orange dot, and Now's Needs you). */
  pausedChains: new Set(),
  /** Chains whose newest run ended failed (the row's red dot). @type {Set<string>} */
  erroredChains: new Set(),
  /** Chains whose newest run was stopped, or cut off by a restart (a team on the side's row says stopped). @type {Set<string>} */
  stoppedChains: new Set(),
  /** runId → chain, as the run's own meta names it. */
  runChains: new Map(),
  /** The runs list as the left bar's poll last read it (GET /api/runs): Now is made from it. @type {any[]} */
  runs: [],
};

/**
 * Whether a chat's agent is at work now, as the left bar's spinner says it: the runs say its newest run goes on (or
 * waits on you, paused), this page holds its live turn, or something else holds the chat — another tab's turn, its
 * move (Facade D11). @param {string | null | undefined} chainId @param {any} [chat]  the page's chat, where it has one
 */
export const atWork = (chainId, chat = null) => !!chat?.live || (!!chainId && (state.runningChains.has(chainId) || state.holders.has(chainId)));

/** A fresh chat id on this page: `harness-<uuid>`. The session's own id is the chain's, once it exists. */
export const newChatId = () => `harness-${crypto.randomUUID()}`;

// --- the session view (Facade D7): one source per chat for what the session's screens show ---

/** The view's shape: `{ settings: { effective, flat, sources, window, engine, hash }, facts, windows, holder, memory }`.
 *  `facts` are the newest finished turn's; `windows` the transcript's top-level rows (D10); `holder` who holds the
 *  session's turn (Facade D11) — the transcript's read says it, the events feed's `turn` keeps it current, the holders
 *  resync sets right a change the feed dropped; `memory` what memory did for the newest turn (HarnessV3-Memory M6-1),
 *  read again when a change touches it (M7-D37). The composer's controls, the widgets and the waiting queue read it;
 *  nothing keeps a second copy of what it holds. */
const viewSubs = new WeakMap();

/** @param {any} chat */
function viewOf(chat) {
  if (!chat.view) {
    chat.view = {
      settings: { effective: null, flat: null, sources: null, window: null, engine: null, hash: null },
      facts: null,
      windows: null,
      holder: null,
      memory: null,
    };
  }
  return chat.view;
}

/**
 * The one updater (D7): merge `part` — any of `settings`, `facts`, `windows`, `holder`, `memory` (what memory did for
 * the newest finished turn, HarnessV3-Memory M6-1) — into the chat's session view, then notify each subscriber once.
 * Callers hand whole sections; nothing here computes.
 * @param {any} chat @param {{ settings?: any, facts?: any, windows?: any, holder?: any, memory?: any }} part
 */
export function applySessionView(chat, part) {
  if (!chat) return;
  const view = viewOf(chat);
  if (part.settings !== undefined) view.settings = { ...view.settings, ...part.settings };
  if ("facts" in part) view.facts = part.facts ?? null;
  if ("windows" in part) view.windows = part.windows ?? null;
  if ("holder" in part) view.holder = part.holder ?? null;
  if ("memory" in part) view.memory = part.memory ?? null;
  for (const fn of viewSubs.get(chat) || []) fn(view);
}

/**
 * Subscribe to a chat's session view; the returned function unsubscribes.
 * @param {any} chat @param {(view: any) => void} fn
 */
export function onSessionView(chat, fn) {
  if (!chat) return () => {};
  if (!viewSubs.has(chat)) viewSubs.set(chat, new Set());
  /** @type {Set<(view: any) => void>} */ (viewSubs.get(chat)).add(fn);
  return () => /** @type {Set<(view: any) => void>} */ (viewSubs.get(chat))?.delete(fn);
}

const FOLDERS_KEY = "harness.folders";
const MODEL_KEY = "harness.model";
const NEW_CHAT_MODEL_KEY = "harness.newChatModel";
const SIDEBAR_KEY = "harness.sidebar.collapsed";
const SIDEBAR_W_KEY = "harness.sidebar.width";
const PANE_W_KEY = "harness.pane.width";

/** Recent project folders, newest first (the header field's memory). @returns {string[]} */
export function recentFolders() {
  try {
    return JSON.parse(store.get(FOLDERS_KEY) || "[]").filter((x) => typeof x === "string").slice(0, 12);
  } catch {
    return [];
  }
}
/** @param {string} folder */
export function rememberFolder(folder) {
  const f = String(folder || "").trim();
  if (!f) return;
  store.set(FOLDERS_KEY, JSON.stringify([f, ...recentFolders().filter((x) => x !== f)].slice(0, 12)));
}
/** A folder that is gone (its project was deleted, or the folder left the disk) leaves the recents. @param {string} folder */
export function forgetFolder(folder) {
  const f = String(folder || "").trim();
  if (!f) return;
  store.set(FOLDERS_KEY, JSON.stringify(recentFolders().filter((x) => x !== f)));
}
export const lastModel = () => store.get(MODEL_KEY) || "";
/** @param {string} m */
export const rememberModel = (m) => store.set(MODEL_KEY, String(m || ""));
/** "New chats start on" (Settings › General, HarnessV4_Settings_Plan HS-D16): a model chosen there, or "" for the one
 *  used last — today's way, the default. */
export const newChatModelPref = () => store.get(NEW_CHAT_MODEL_KEY) || "";
/** @param {string} m  "" goes back to the one used last */
export const setNewChatModelPref = (m) => store.set(NEW_CHAT_MODEL_KEY, String(m || ""));
/**
 * The model a new chat starts on: the one chosen for new chats while the picker offers it, else the one used last
 * (HC-90, HC-91). Before the catalogue is read, a chosen model is taken at its word.
 * @param {readonly any[]} models  the catalogue's rows, or none yet
 */
export function startModel(models) {
  const chosen = newChatModelPref();
  if (chosen && (!models.length || models.some((x) => String(x?.id ?? x) === chosen))) return chosen;
  return lastModel();
}
export const lastSidebarOpen = () => store.get(SIDEBAR_KEY) !== "1";
/** @param {boolean} on */
export const rememberSidebar = (on) => store.set(SIDEBAR_KEY, on ? "0" : "1");
/** The sidebar's dragged width: default and minimum 264, capped at half the window. @param {number} fallback @returns {number} */
export const lastSidebarWidth = (fallback = 264) => clampWidth(store.get(SIDEBAR_W_KEY), 264, fallback);
/** @param {number} px */
export const rememberSidebarWidth = (px) => store.set(SIDEBAR_W_KEY, String(Math.round(px)));
/** The floating pane's dragged width, or null where none was kept: the panes take one from the window the first time. @returns {number | null} */
export function lastPaneWidth() {
  const n = Number(store.get(PANE_W_KEY));
  return Number.isFinite(n) && n >= 280 ? n : null;
}
/** @param {number} px */
export const rememberPaneWidth = (px) => store.set(PANE_W_KEY, String(Math.round(px)));

/** A stored width is a number inside its fence, else the fallback. @param {string | null} raw @param {number} min @param {number} fallback */
function clampWidth(raw, min, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, Math.max(min, Math.floor(window.innerWidth / 2)));
}

/**
 * Where a chat's draft is kept (HarnessV4_Tasks C33): under its session, so the words come back after a refresh, which
 * makes the page's chats anew; a chat with no session yet is the one the Start board shows.
 * @param {{ chainId?: string | null } | null | undefined} chat
 */
const draftKey = (chat) => `filament.harness.draft.${chat?.chainId || "new"}`;
/** @param {string | undefined} p */
const placeOf = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
/**
 * The Start's kept words and the folder they were typed for, or null. The Start's words are kept with their folder, so a
 * refresh makes the Start there again and another folder's Start never shows them (a Space's New app in one folder, sent
 * from another, would make the app in the wrong place). A draft kept before was its words alone: it reads with no folder.
 * @returns {{ text: string, cwd: string } | null}
 */
export const startKept = () => {
  let raw = null;
  try {
    raw = sessionStorage.getItem(draftKey(null));
  } catch {}
  if (!raw) return null;
  try {
    const kept = JSON.parse(raw);
    if (kept && typeof kept.text === "string") return { text: kept.text, cwd: typeof kept.cwd === "string" ? kept.cwd : "" };
  } catch {}
  return { text: raw, cwd: "" };
};
/**
 * A chat's draft: the words typed and not sent, or a message a card stopped before it was sent. It survives a refresh;
 * a sent one is forgotten. The Start's shows only in the folder it was typed for.
 * @param {{ chainId?: string | null, cwd?: string } | null | undefined} chat
 */
export const draftFor = (chat) => {
  if (!chat?.chainId) {
    const kept = startKept();
    return kept && (!kept.cwd || placeOf(kept.cwd) === placeOf(chat?.cwd)) ? kept.text : "";
  }
  try {
    return sessionStorage.getItem(draftKey(chat)) || "";
  } catch {
    return "";
  }
};
/**
 * Keeps a chat's draft, or forgets it with no text. Another folder's Start opens with its box empty, which the composer
 * saves as it draws: that never forgets the words kept for the Start of the folder they were typed in.
 * @param {{ chainId?: string | null, cwd?: string } | null | undefined} chat @param {string} text
 */
export const saveDraft = (chat, text) => {
  if (!text && !chat?.chainId) {
    const kept = startKept();
    if (kept?.cwd && placeOf(kept.cwd) !== placeOf(chat?.cwd)) return;
  }
  try {
    if (!text) sessionStorage.removeItem(draftKey(chat));
    else sessionStorage.setItem(draftKey(chat), chat?.chainId ? text : JSON.stringify({ text, cwd: chat?.cwd || "" }));
  } catch {}
};
/**
 * Words given back to a chat with no session yet after its send went elsewhere and did not go (Run on, run-on.js
 * `startThere`), while another chat is shown: kept in the Start's one draft, above what was typed there since, where it
 * holds this chat's folder's words or none. Where it holds another folder's Start, nothing is written over them: false,
 * and the caller keeps the words on the chat.
 * @param {{ chainId?: string | null, cwd?: string }} chat @param {string} text @returns {boolean}
 */
export const keepStartWords = (chat, text) => {
  const kept = startKept();
  if (kept?.text.trim() && kept.cwd && placeOf(kept.cwd) !== placeOf(chat.cwd)) return false;
  const since = (kept?.text || "").trim();
  saveDraft(chat, since && since !== text.trim() ? `${text}\n\n${since}` : text);
  return true;
};
/**
 * The files attached in each chat's box and not sent, under its draft's key: the page's alone — a picture is up to 20 MB,
 * more than the tab's storage takes — so a refresh forgets them. The Start's are kept with the folder they were attached
 * in. @type {Map<string, { files: any[], cwd: string }>}
 */
const keptFiles = new Map();
/**
 * Whether the page holds files attached and not sent, which a reload would lose: said on its root element
 * (`data-filament-held`) for the desktop app, which moves a machine's page to a better way to it only while it holds
 * none (desktop/lib/rail.js `readPage`).
 */
const sayHeld = () => {
  try {
    if (keptFiles.size) document.documentElement.dataset.filamentHeld = "files";
    else delete document.documentElement.dataset.filamentHeld;
  } catch {}
};
/**
 * The files attached in a chat's box and not sent, kept as its words are (`draftFor`): another chat's never go with its
 * send. The Start's show only in the folder they were attached in.
 * @param {{ chainId?: string | null, cwd?: string } | null | undefined} chat @returns {any[]}
 */
export const draftFilesFor = (chat) => {
  const kept = keptFiles.get(draftKey(chat));
  if (!kept || (!chat?.chainId && kept.cwd && placeOf(kept.cwd) !== placeOf(chat?.cwd))) return [];
  return kept.files.slice();
};
/**
 * Keeps the files in a chat's box, or forgets them with none; another folder's Start, opening with none, never forgets
 * the Start's (as `saveDraft` keeps its words).
 * @param {{ chainId?: string | null, cwd?: string } | null | undefined} chat @param {any[]} files
 */
export const saveDraftFiles = (chat, files) => {
  const key = draftKey(chat);
  if (files.length) {
    keptFiles.set(key, { files: files.slice(), cwd: chat?.chainId ? "" : chat?.cwd || "" });
    return sayHeld();
  }
  const kept = keptFiles.get(key);
  if (!chat?.chainId && kept?.cwd && placeOf(kept.cwd) !== placeOf(chat?.cwd)) return;
  keptFiles.delete(key);
  sayHeld();
};

/** @param {string | null} id */
export function chatOf(id) {
  return id ? state.chats.get(id) || null : null;
}

/**
 * Register a chat. `cwd`/`model` come from the chat's creation context (the header field and the picker); both are
 * the per-chat values from then on — a later header change starts a NEW chat, never moves an old one. Nothing is
 * resent from here: the server holds the transcript and composes every request from it (HarnessV2 D1).
 * @param {Partial<Chat> & { id: string }} c
 * @returns {Chat}
 */
export function putChat(c) {
  const chat = /** @type {Chat} */ ({
    kind: "new",
    chainId: null,
    load: null,
    forkedFrom: null,
    turns: [],
    live: null,
    following: true,
    createdAt: Date.now(),
    paused: null,
    ...c,
  });
  state.chats.set(chat.id, chat);
  return chat;
}
