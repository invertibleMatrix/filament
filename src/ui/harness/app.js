// @ts-check
// The harness application: the shell's frames filled with the three regions, the hash router (`#/` a new task,
// `#/task/<chainId>` a session — `/plan`, `/team` or `/side` after it, its view; settings and the control room
// arrive with their screens and render the conversation meanwhile), and the turn's conductor — send (a plain message, a
// resume, or a steer into a live run's mailbox), the stream into the transcript, the run's events onto the
// same turn, the footer from the record, stop, fork, open. A task is a native session (HarnessV2 §3): the
// server holds the transcript and composes every request from it; the chat here is a view — created at the
// first send, hydrated from `/transcript` on open and on reload. The conductor owns every async edge; the
// regions own only their DOM; the shell owns the window.
import { h } from "../lib/dom.js";
import { fmt } from "../lib/format.js";
import { FORK_TRANSCRIPT_WORDS } from "../lib/context-words.js";
import { api, apiShared, postTurn, newSendId, followRun, setRemotePage, setViewOnlyApi, VIEW_ONLY_REFUSED, whenReadOnly } from "./lib/api.js";
import { viewOnlyNow } from "../lib/api.js";
import { browseFolder, pathExample } from "./lib/folder-browse.js";
import { applyWords } from "./lib/stream.js";
import { TAB_ID, acting, whenShown, writerClaim } from "./lib/tab.js";
import { createWaitingQueue, waitingStore, waitingOwes, holderFromView, waitingToast, MOVE_WINDOW } from "./waiting.js";
import { settingsFollower } from "./live-topic.js";
import { state, chatOf, putChat, newChatId, recentFolders, rememberFolder, forgetFolder, lastModel, rememberModel, newChatModelPref, startModel, applySessionView, onSessionView, draftFor, saveDraft, keepStartWords, draftFilesFor, saveDraftFiles, startKept, atWork } from "./state.js";
import { settingsRead, viewSettingsOf } from "./view-settings.js";
import { watchTheme, setThemePref, hintTheme, themeHinted } from "./theme.js";
import { DESK_KEYS, chatOnlyOf, deskKeyOf, fullPageOf, themeHintOf } from "./lib/chat-only.js";
import { createDeskGuest } from "./lib/desk-guest.js";
import { createShell } from "./shell.js";
import { createTimeline, LIVE_LOST_WORDS } from "./conversation/timeline.js";
import { fileWords, rewindButton, turnsWords } from "./conversation/rewound.js";
import { askOf, askQuestion, carryChoices, switchChoices, withoutAsked } from "./conversation/interaction.js";
import { createStatusCapsule, createStatusPanel } from "./conversation/status-panel.js";
import { waitingOn } from "./conversation/waiting-on.js";
import { createChargeBand } from "./conversation/in-charge.js";
import { turnNow } from "./lib/overview.js";
import { deskRoute, mergeKey } from "./lib/desk.js";
import { HERE, folderKey, readPlaces, runOnTune, startThere, worksInFolder } from "./lib/run-on.js";
import { cancelledWords } from "./lib/come-back.js";
import { setTabTitle, setTitleLead, notifyRunEnded, ensureNotificationPermission } from "./notify.js";
import { createPopped, followSwitch, followable, mainLine, popBridgeOf, popTabOf } from "./panes/pop-out.js";
import { createComposer, VIEW_ONLY_WORDS } from "./composer/composer.js";
import { attachmentBlock, pdfRefused } from "./composer/attachments.js";
import { queueState, queueAdd, queueUnheard, turnEnded, turnSettled, openedIdle, queueRestored, awayNext, awayBack, queuedText, queuedFiles, queuedOverrules, queuedAnswer, queuedVia } from "./composer/queue.js";
import { keptQueues, keptLostWords } from "./composer/kept-queue.js";
import { switchAnswer, switchWords } from "./composer/mode.js";
import { mountWidgets } from "./widgets/host.js";
import { carryControl } from "./widgets/carry.js";
import { askChoices, choiceCompaction, sessionKind, compactionParts, isClientView } from "./widgets/compaction.js";
import { callOf } from "./widgets/cache.js";
import { rowsAhead } from "./widgets/runs-on.js";
import { NOT_STARTED } from "./lib/setting-intents.js";
import { createModelSelect, firstModel, machinesOf } from "./composer/model.js";
import { recordHeld, factsHeld, factsAfterCompaction, factsOfFreshStart, windowFace, windowFacts } from "./widgets/context.js";
import { group, row, tok, usd } from "./widgets/kit.js";
import { NAMED_MS, createSidebar } from "./sidebar.js";
import { createPaneHost } from "./panes/pane-host.js";
import { ARRANGE_WORDS, PANE_KEYS, PLACE_WORDS, createPaneButtons } from "./panes/pane-buttons.js";
import { ARRANGES, PLACES } from "./panes/tiles.js";
import { createViews, topOf, viewOf } from "./views/host.js";
import { createPlanWatch } from "./lib/plan-watch.js";
import { huntBrief } from "./views/task-graph.js";
import { askOpenAgain, planOf } from "./views/plan.js";
import { createDecisions, dockKeys } from "./conversation/decisions.js";
import { asksYou, carryOnWords, compactionCount, crewOf, engineStamp, leadingTeam, ownLast, readingTeam, rebuildCost, sentBackWords, switchWait, toldWords, yourAsk } from "./lib/team.js";
import { openBrief } from "./views/brief.js";
import { PICKS_PREF, picksOf } from "./lib/brief.js";
import { familyName, locate, prettyModel, priceLine } from "./lib/families.js";
import { NO_SESSION_YET, SIDE_EFFORTS, isGuest, ownGearPaths, rowIcon, sideTeamItem } from "./lib/side.js";
import { craftOpenedWords, craftLineOf } from "./lib/craft.js";
import { chatsToLet, keptOf, noteUnseenTurn, readSince, readsOnShow } from "./lib/release.js";
import { pageShown, whenPageShown, stillWhileHidden } from "./lib/page-shown.js";
import { withReadRuns } from "./lib/turn-reads.js";
import { readCalls } from "./lib/run-calls.js";
import { transcriptWhole, writtenSince } from "./lib/transcript-since.js";
import { openHowSheet, repaintContextHow } from "./how-sheet.js";
import { chatDeleted, paintBand, renderChanges, refreshChanges, reviewAgent, showChanges } from "./panes/changes.js";
import { agentsMark } from "./panes/agents-band.js";
import { renderOutputs, refreshOutputs } from "./panes/outputs.js";
import { refreshTerminal, renderTerminal, setTerminalsViewOnly } from "./panes/terminal.js";
import { refreshBrowser, renderBrowser, setBrowserViewOnly } from "./panes/browser.js";
import { renderRun, refreshRun, showRunPart } from "./panes/run-pane.js";
import { renderNextRequest, refreshNextRequest, draftMoved } from "./panes/next-request.js";
import { refreshFiles, renderFiles } from "./panes/files.js";
import { fileWhere, parseThreadTabId, resultTabId, threadTabId } from "./panes/pane-data.js";
import { showLines } from "./panes/code-viewer.js";
import { renderThreadPane, threadOnceListed } from "./panes/thread.js";
import { renderControlRoom } from "./control-room.js";
import { renderArtifactView } from "./artifact-view.js";
import { renderArtifactsPage } from "./artifacts-page.js";
import { artifactFrame, artifactsPlaced, artifactsPlacedAgain, passArtifactLinks } from "./artifact-frame.js";
import { openOut } from "./artifact-acts.js";
import { sessionStartBody, chipStanding } from "./session-start.js";
import { dialog, closeOverlays, confirmDialog, sheet, toast as noticeToast } from "./lib/ui.js";
import { crashNoticeOf, addressWithoutCrash, CRASH_NOTICE_MS } from "./lib/crash-notice.js";
import { compactionWords, compactionFacts, firstMessageName, fromAgentsWords, threadsLinked, pauseOf, keptToast, againOf, agentQueuesWords, agentTakesWords, placeName, rowMoment, forkTreeWords, possessive, steerForkOf, STEER_FORK_USAGE, steerForkRefusal, letGoOfLog } from "./lib/labels.js";
import { moveSheet } from "./move-sheet.js";
import { stopReached, runToForce, forceOutcome } from "./lib/stops.js";
import { watchLive, LIVE_QUIET_MS } from "./lib/live-watch.js";
import { keepPageSaid, pageSaid, toastSaid } from "./lib/page-said.js";
import { createRunDraw } from "./lib/run-draw.js";
import { createReplayHold } from "./lib/replay-hold.js";
import { createHeldSteers } from "./lib/held-steers.js";
import { pictureUrl, SENT_TYPES } from "./lib/picture-view.js";
import { createSpeedMeter, pausesWriting } from "./lib/speed.js";
import { isScreen, libraryOf, newChatFolder, onScreen, parseRoute, routeFor } from "./lib/router.js";
import { chatLinks } from "./lib/chat-open.js";
import { createCatalogueKeeper, CONSOLE_WINDOW } from "./lib/catalogue.js";
import { renderSettings } from "./settings/page.js";
import { renderLibrary } from "./library/page.js";
import { leaveSpace, placesFirst, renderSpace, spaceForAsk } from "./space/space.js";
import { renderYourSpace } from "./space/your-space.js";
import { ROUTINES, WATCHERS } from "./space/dashboards.js";
import { pickPlace, placeChoices } from "./space/pick-place.js";
import { givenWorktreeChoice, newWorktreeChoice } from "./conversation/works-in.js";
import { projectFolderOf, readStanding } from "./conversation/empty.js";
import { WATCH_CHAT_WORDS, boxFilesOf, readTaskFiles, reproLane, reproduceWords } from "./lib/space-view.js";
import { holdJump } from "./settings/search.js";
import { startHourlySweep } from "./settings/general.js";
import { openSetupSheet, OLD_TABS } from "./setup-sheet.js";
import { createOverview } from "./views/overview.js";
import { keyedRead, chatState } from "./lib/chat-reads.js";
import { prefs } from "./prefs.js";
import { createInspectorCallbacks } from "./context-callbacks.js";
import { openDryRun } from "./panes/inspector/inspector.js";
import { createCommandCenter } from "./command-center.js";
import { transcriptTurns, reviewsMoved, withReadWork, mergedTurns, meterTurnOf, placeBoundary, holdsRow, carryMarks, afterCompactionUndo, afterCompactionPlaced, newerCompaction, undoEnded, afterCompactionCost, withoutMove, withCopy, runningOn, endedOn, unsent, stoppedToAsk, heldInRow, forkable, nextNumber, renumbered, turnNumbered, newestOnRecord } from "./conversation/history.js";
import { createFind } from "./find.js";
import { matchShortcut } from "./shortcuts.js";
import { chipActions } from "./conversation/tools/layout.js";
import { guideHands } from "./conversation/turn.js";
import { applyFailure, createSubagentStore, drewIn, drewKept, madeIn, poolSeatsNow, rebaseFailure, subagentRoutes } from "./lib/subagents.js";
import { RESUME_WORDS, besideRoutes, createBesideStore, resultAttachment, workersWords } from "./lib/beside.js";
import { FLOW_TEAM_CHAT, FLOW_USAGE, FLOW_WORD, createFlowList, flowItem, flowRoutes, flowWordsOf, isFlowTeam } from "./lib/flow.js";
import { createFlowCards, createFlowDock, createFlowPane, createFlowStatus } from "./views/flow.js";
import { createWorkPane } from "./views/agent-work.js";
import { workOf } from "./lib/agent-work.js";
import { openBoxSheet, openSaveSheet } from "./views/flow-sheet.js";
import { renderResultPane } from "./panes/team-result.js";
import { createBoardStore } from "./lib/boards.js";
import { besideActions } from "./conversation/beside-marks.js";
import { sideActions } from "./conversation/side-offer.js";
import { heldActions, heldGone } from "./conversation/held-launch.js";
import { routineActions } from "./conversation/routine-card.js";
import { JUST_DO_TEXT, PLAN_GO_TEXT, PLAN_TEAM_CHAT, planSendText, planWordsOf } from "./lib/plan-ask.js";
import { poolFamilies, poolLine, poolNext, poolPatch, poolRows } from "./lib/pool.js";
import { onBus } from "./lib/bus.js";
import { gitMovedFor } from "./lib/git-moved.js";
import { holdWhileShown } from "../lib/put-away.js";
import { TEAMS_OFF, teamsOn } from "../lib/teams-on.js";
import { followTurnMemory } from "../lib/claims.js";
import { followEngine } from "../lib/engine.js";
import { accountName, followAccounts, noticeOf, othersOf, resetOutcomeWords } from "../lib/accounts.js";
import { listenerSet } from "../lib/listeners.js";
import { openSignIn } from "./sign-in.js";
import { openSshSetup } from "./ssh-setup.js";
import { openInstall } from "./install-sheet.js";
import { openWelcome, stepAt, tourOpensItself, keysIn } from "./views/welcome.js";
import { createCoach } from "./coach/coach.js";
import { keepCodingAgents } from "./lib/coding-agents.js";
import { createAgentCardList, cardMarksKept, teamUsesIn, usesIn } from "./lib/agent-cards.js";
import { createHeldAsks } from "./lib/held-asks.js";
import { store } from "../lib/store.js";
import { createClosedCards } from "./lib/closed-cards.js";
import { overrulesSent } from "./composer/overrule-line.js";
import { MAY_ASK_SUB, mayAskOff } from "./widgets/may-ask.js";
import { createCatchUp } from "./conversation/catch-up.js";
import { createCrafterLine } from "./conversation/crafter-line.js";
import { browserLineOf, createBrowserLine, usingWords } from "./conversation/browser-line.js";
import { createBrowserUse } from "./lib/browser-use.js";
import { createEnvelopeLine, envelopeLineOf } from "./conversation/envelope-line.js";
import { createWatchLine, watchLineOf } from "./conversation/watch-line.js";
import { renderExplain } from "./conversation/explain.js";
import { WORDS } from "./lib/words.js";

// The harness owns its look (harness.css). Dashboard theme/accent keys stay on the console.

/**
 * What the chats the page let go of take back when they open again, by their session (lib/release.js): the view each
 * showed and the cards opened on it. @type {Map<string, ReturnType<typeof keptOf>>}
 */
const letGo = new Map();

/**
 * The chats opened whose transcript is on its way (openSession). Its transcript is the first request out: the page has
 * six connections to Filament, and the status's looks, the agents' lists and the writing claim went out first and held
 * it behind them. Until it lands they wait, and nothing weighs a next request for turns not read yet.
 * @type {WeakSet<any>}
 */
const opening = new WeakSet();

/**
 * The moves to another folder this page asked for (the sheet's Move, a row's Move back), by their chat: each its own mark
 * (`movingMark`), from the press until the move's own end has read the chat (`movedTo`) or the server refused it. While
 * one stands, the feed's release of the chat's move reads nothing beside that end; a move another page asked for is read
 * at its release (`sessionLetGo`).
 * @type {WeakMap<any, Set<object>>}
 */
const movingHere = new WeakMap();
/** A move this page asks for, marked on its chat until it is `done`. @param {any} chat */
function movingMark(chat) {
  const mark = {};
  movingHere.set(chat, (movingHere.get(chat) || new Set()).add(mark));
  return { done: () => void movingHere.get(chat)?.delete(mark) };
}
/** Whether a move this page asked for is on its way for the chat. @param {any} chat */
const movesHere = (chat) => !!movingHere.get(chat)?.size;
/**
 * The chats whose move to another folder the events feed told of, until its release: shown or not, the release has the
 * chat's next read in the folder it moved to (`movedAt`, `heardMove`). A move this page asked for is read at its own end.
 * @type {WeakSet<any>}
 */
const movingHeard = new WeakSet();

/** The page's elements, or a boot-time failure that says which one is missing. @param {string} id */
function must(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`harness: #${id} is missing from harness.html`);
  return /** @type {any} */ (el);
}

const toastEl = /** @type {HTMLElement} */ (must("toast"));
let toastTimer = null;
/** @param {string} msg @param {string} [kind] */
function toast(msg, kind = "") {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), kind === "err" ? 6000 : 3200);
  toastSaid(msg, kind);
}
// What the page tells the person in words is kept with the chat it concerns (the filament-agent plan's Phase 4b).
keepPageSaid({
  chainNow: () => {
    const id = chatOf(state.currentId)?.chainId;
    return id ? String(id) : null;
  },
  post: (chainId, lines) => api(`/sessions/${encodeURIComponent(chainId)}/page`, { method: "POST", body: { lines } }),
  store: sessionStorage,
});

// ---------------------------------------------------------------------------------------------------
// Pop out (HarnessV4_BrowserSize_Plan BS4): this page in a window of its own shows one pane alone (`?pane=`) — the
// whole window, no sidebar, header or chat — for the chat it opened at, or the main window's while it follows it. It
// names no tab (lib/tab.js): the main window's hold on its chat stays. The main window says its chat on the line
// between them, and opens what a popped pane hands it (a file from Files).
// ---------------------------------------------------------------------------------------------------
/** The tab this window shows alone, popped out of the main window, or "" in the main window. */
const POPPED = popTabOf();
const popBridge = popBridgeOf();
const windowsLine = mainLine();
const follows = POPPED ? followSwitch() : null;
/**
 * The chat alone (`?only=chat`, lib/chat-only.js): another machine's desk shows this page's chat beside its own left
 * bar — no sidebar, no full-frame screen (one asked for opens this machine's whole page there, where the desk can), its
 * look the desk's (`?theme=`), kept nowhere. It is a tab of its own: it writes its chat as any page does.
 */
const CHAT_ONLY = !POPPED && chatOnlyOf();
const fullPage = CHAT_ONLY ? fullPageOf() : null;
if (CHAT_ONLY) hintTheme(themeHintOf());
/**
 * What the chat alone neither offers in Ctrl+K nor runs by its key, by id: what goes through the sidebar it hides (the
 * chats before and after, what needs you next, the sidebar itself) or leaves the chat for a new one (New chat, Open
 * Workspace, the tour that starts one) — the desk showing it picks its chat — and the tips.
 */
const CHAT_ONLY_OFF = new Set(["new", "new-task", "next-needs", "task-prev", "task-next", "sidebar", "open-workspace", "welcome", "tips"]);
/** Where the desk shows the chat alone, its way to hand the desk a key of its list's (chat-only.js `DESK_KEYS`). */
const toDesk = CHAT_ONLY ? deskKeyOf() : null;
/** What `/welcome` says on the chat alone: the tour starts chats, which the desk's list picks, so it runs on the whole page. */
const TOUR_CHAT_ONLY_WORDS = "The welcome tour runs on this machine's whole page, not on a chat shown alone.";

// A view-only device (the owner's remote Filament of 11-06, p4-view-ui): its page reads this Filament and offers nothing
// the server would refuse it — no Send, New chat, Start or terminal (`paintViewOnly`).
/** The paired device this page is, as /api/state says it; null on this computer's page, or the admin token's.
 *  @type {{ id: string, name: string, scope: string } | null} */
let device = null;
/** The page is a view-only device's. */
const viewOnlyPage = () => device?.scope === "view";
/** The shortcuts a view-only device's page takes no action on: each opens what writes the chat. */
const VIEW_ONLY_KEYS_OFF = new Set(["model", "mode", "effort", "fork", "subagent"]);

// ---------------------------------------------------------------------------------------------------
// The shell and the regions
// ---------------------------------------------------------------------------------------------------
const shell = createShell(must("app"), {
  chatOnly: CHAT_ONLY,
  ...(fullPage ? { onFullPage: () => fullPage(location.hash || backTo()) } : {}),
  onSidebarReveal: () => shell.setSidebar(true),
  onHeader: {
    onFork: () => {
      const c = chatOf(state.currentId);
      const last = forkAt(c);
      if (c && last) forkModal(c, last);
      else toast("Nothing to fork yet: fork after the chat's first reply");
    },
    onReload: () => reloadSession(),
    // A view-only device's page: the chat menu copies and reloads alone (p4-view-ui).
    viewOnly: () => viewOnlyPage(),
    // The agents' cards closed in this chat, and bringing them back (E37): each card hears the store and paints again.
    closedCards: () => closedCards.count(chatOf(state.currentId)?.chainId),
    onShowClosedCards: () => {
      if (closedCards.reopen(chatOf(state.currentId)?.chainId)) subagentStore.touch();
    },
    onRenamed: (title) => {
      // The chat's own name, which the header and the tab are painted from again (`setTitle`): a send, or a message given
      // back, never brings the old one back.
      const c = chatOf(state.currentId);
      if (c) c.title = title;
      titleEl.textContent = title;
      toast("Chat renamed");
      sidebar.load();
    },
    onArchived: () => sidebar.load(),
    onToast: (msg, kind) => toast(msg, kind),
    // The Help menu's Welcome tour: none on the chat alone, as Ctrl+K offers none there.
    ...(CHAT_ONLY ? {} : { onWelcome: () => openTour() }),
    // The Open in menu's file manager: named by the system Filament runs on, opened by Filament where the folder is.
    platform: () => state.platform,
    onOpenFolder: (path) => revealFile(path, "The folder did not open"),
    getChat: () => chatOf(state.currentId),
    // The branch's `+N −N` under the box and the place card open Changes, where each place the agents wrote in has its
    // group (GW-D22).
    onOpenChanges: () => {
      showChanges({ scope: "turn" });
      rail.openTab("changes");
    },
    // Changes' place heads say the branch and how far from its base as the header read them: they follow its read.
    onPlace: () => rail.refreshInPlace(),
    onMove: () => {
      const c = chatOf(state.currentId);
      if (c?.chainId) openMoveSheet(c);
    },
    // Watch this chat…: a watcher lives in a project's Space, and a chat's agent is given the space tool only where its
    // project has one, so a chat of no project has none. In a project with no Space yet the press makes it first, as an
    // add on its page does (by need, 11-12: space/space.js `spaceForAsk`) — never where its deleted Space waits, which
    // the row says. The ask goes into the box under what is typed there, for the person to send: the chat's own agent
    // proposes the watcher.
    watchable: () => {
      const p = projectOfChat(chatOf(state.currentId));
      return !p ? "project" : sidebar.hasSpace(p) ? true : sidebar.spaceWaits(p) ? "deleted" : "make";
    },
    onWatch: async () => {
      const id = state.currentId;
      const p = projectOfChat(chatOf(id));
      // A chat left while its Space was being made keeps its box as it was: the ask is not the next chat's.
      if (p && !sidebar.hasSpace(p) && (!(await spaceForAsk(p)) || state.currentId !== id)) return;
      const draft = composer.draft().trim();
      composer.fill(draft ? `${draft}\n\n${WATCH_CHAT_WORDS}` : WATCH_CHAT_WORDS);
    },
  },
});
// A popped pane's window: the pane alone (panes.css `.pane-window`).
if (POPPED) shell.root.classList.add("pane-window");
const folderIn = /** @type {HTMLInputElement} */ (shell.folderIn);
const folderLeaf = /** @type {HTMLElement} */ (shell.folderLeaf);
const titleEl = /** @type {HTMLElement} */ (shell.titleEl);
const headerModule = shell.header;

/** An error's text for a toast: its message when it has one. @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * What the Changes pane reads beside the host's context (the Designer's of 10-29): the chat's sub-agents and the door to
 * one's view, its agent's model, and the band's doors for a copy's Apply.
 * @param {any} ctx @returns {import("./panes/changes.js").ChangesCtx}
 */
function changesCtx(ctx) {
  return {
    ...ctx,
    subagents: () => (ctx.chat?.chainId && subagentStore.chainId() === String(ctx.chat.chainId) ? subagentStore.rows() : []),
    openSubagent: (/** @type {string} */ id) => openSubagent(id),
    model: (/** @type {any} */ chat) => baseModelOf(chat?.model || composer.modelName() || ""),
    band: (/** @type {any} */ chat) => bandCtx(chat),
  };
}

/** A model's name as the families say it, else as it reads. @param {string} id */
const modelWords = (id) => {
  const at = locate(state.families, id);
  return at ? familyName(at.family) : prettyModel(id);
};

/**
 * What the agents band does (agents-band.js, the Designer's of 10-27; its parts drawn in the Changes pane's copy blocks
 * since 10-29): a sub-agent's thread, its stop, its waiting diff, its Apply's dry run and the Apply, which says what it
 * did. The chat's chain is read at each use: a new chat's first send gives it one.
 * @param {any} chat @returns {import("./panes/agents-band.js").BandDoors}
 */
function bandCtx(chat) {
  const chainOf = () => String(chat?.chainId || "");
  const routes = () => subagentRoutes(chainOf());
  return {
    openSubagent: (id) => openSubagent(id),
    openChat: (c) => openChain(c),
    stopSubagent: (id) => stopSubagent(id),
    diffOf: (id) => routes().changes(id),
    preview: (id, choices) => routes().preview(id, choices),
    apply: async (id, choices) => {
      try {
        await routes().apply(id, choices);
        await subagentStore.refresh();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: applyFailure(e), conflicts: /** @type {any} */ (e)?.body?.conflicts };
      }
    },
    compare: (id, path) => routes().compare(id, path),
    // Send back to rebase (the Designer's of 10-27): its row works again at once.
    rebase: async (id) => {
      try {
        await routes().rebase(id);
        await subagentStore.refresh();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: rebaseFailure(e) };
      }
    },
    // Mark as applied and its undo (10-29): its row says so, or waits again, at once.
    markApplied: (id) => markThenRead(() => routes().markApplied(id)),
    unmarkApplied: (id) => markThenRead(() => routes().unmarkApplied(id)),
    reread: () => (subagentStore.chainId() === chainOf() ? subagentStore.refresh() : Promise.resolve()),
    modelName: (id) => modelWords(id),
  };
}

/**
 * A mark as applied, or its undo, then the list read again; a refusal in its own words.
 * @param {() => Promise<unknown>} act @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function markThenRead(act) {
  try {
    await act();
    await subagentStore.refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(/** @type {any} */ (e)?.message || e) };
  }
}

/**
 * The agents band drawn again where it shows, and the Changes tab's mark while a sub-agent of the chat shown has work
 * waiting in its copy, asks you something, or left a file with conflict markers that still has them.
 */
function paintAgents() {
  paintBand();
  const chat = chatOf(state.currentId);
  const chain = String(chat?.chainId || "");
  const words = agentsMark(chain && subagentStore.chainId() === chain ? subagentStore.rows() : [], atWork(chain, chat));
  rail.mark("changes", words);
  paneButtons?.mark("changes", words);
}

/**
 * What the Outputs pane reads beside the host's context (HarnessV4_Four_Plan E20): the chat's sub-agents, to name a
 * helper, and Show in folder.
 * @param {any} ctx
 */
function outputsCtx(ctx) {
  return {
    ...ctx,
    subagents: () => (ctx.chat?.chainId && subagentStore.chainId() === String(ctx.chat.chainId) ? subagentStore.rows() : []),
    reveal: (/** @type {string} */ path) => revealFile(path),
    toast: (/** @type {string} */ msg, /** @type {string} */ kind) => toast(msg, kind),
  };
}

/** You closed Outputs yourself: it is not put back by itself (HarnessV4_Four_Plan FO-D28). */
const OUTPUTS_CLOSED = "harness.outputs.closed";
/** Outputs opened and shown, from a Show line: put back by itself again from here on. */
function openOutputs() {
  store.set(OUTPUTS_CLOSED, "0");
  rail.openTab("outputs");
}
/** A chat showed a file written outside git: Outputs joins the tabs, the view where it was (FO-D28). */
function offerOutputs() {
  if (store.get(OUTPUTS_CLOSED) !== "1") rail.addTab("outputs");
}
/**
 * Show in folder (FO-D25), and a folder opened in the file manager (the header's Open in): what kept the file manager
 * from opening is said in a toast, after the words for what did not happen.
 * @param {string} path @param {string} [failed]
 */
async function revealFile(path, failed = "Not shown in its folder") {
  try {
    await api("/files/reveal", { method: "POST", body: { path } });
  } catch (e) {
    toast(`${failed}: ${errText(e)}`, "err");
  }
}

// The panes beside the chat (proposal_ux §3.5) hold what sits beside the conversation (HarnessV3-Views VW-D2): the
// work's changes, files and runs first, then the request's anatomy and the developer's tools, each in its colour. The
// plan is a view of its own, and goes beside the chat as a pane when the person puts it there (D12).
/** The header's pane buttons, once the panes are made. @type {ReturnType<typeof createPaneButtons> | null} */
let paneButtons = null;
/** The tabs out in windows of their own, as the app says them (BS4); none in a browser's tab. */
const popped = popBridge ? createPopped(popBridge, () => rail.popMoved()) : null;
/** The Plan's page beside the chat, by the pane body it is drawn in: the run's pulse paints it in place. @type {WeakMap<HTMLElement, { paint: () => void }>} */
const planPanes = new WeakMap();
/** The chat a pane pops out at: the one shown, on its Chat view. @param {any} [c] */
const popRoute = (c = chatOf(state.currentId)) => (c?.chainId ? routeFor("task", { id: c.chainId }) : routeFor("home"));
/** The browser's line over the box (painted with paintBrowserLine): made before the panes, which tell it as they move whether the Browser pane is in sight. */
const browserLine = createBrowserLine({ onOpen: () => rail.openTab("browser") });
const rail = createPaneHost(shell.paneHost, {
  panes: [
    { id: "changes", label: "Changes", icon: "fileDiff", tone: "var(--color-sys-orange)", render: (body, ctx) => renderChanges(body, changesCtx(ctx)), refresh: (body, ctx) => refreshChanges(body, changesCtx(ctx)) },
    // What the agents wrote that git does not show (HarnessV4_Four_Plan E20): Changes keeps to git's files.
    { id: "outputs", label: "Outputs", icon: "package", tone: "var(--color-sys-teal)", render: (body, ctx) => renderOutputs(body, outputsCtx(ctx)), refresh: (body, ctx) => refreshOutputs(body, outputsCtx(ctx)) },
    // The run's pulse leaves the tree as it stands: the folders open, the filter, Show changed files only.
    { id: "files", label: "Files", icon: "folder", tone: "var(--color-sys-blue)", render: (body, ctx) => renderFiles(body, filesCtx(ctx)), refresh: (body, ctx) => refreshFiles(body, filesCtx(ctx)) },
    // The run's pulse leaves the terminals where they stream, and looks now and then for one started elsewhere.
    { id: "terminal", label: "Terminal", icon: "squareTerminal", tone: "var(--color-sys-green)", render: (body, ctx) => renderTerminal(body, terminalCtx(ctx)), refresh: (body, ctx) => refreshTerminal(body, terminalCtx(ctx)) },
    // The chat's browser (HarnessV4_Browser_Plan BR4): the page the agent works on, live in the desktop app, a picture
    // in a browser tab; the run's pulse reads it again in place, so the page is never put back.
    { id: "browser", label: "Browser", icon: "globe", tone: "var(--color-sys-cyan)", render: (body, ctx) => renderBrowser(body, { ...ctx, onToast: toast }), refresh: (body) => refreshBrowser(body) },
    // This run in three depths (proposal_ux M1, R2): Rounds, Calls (the Prompt pane's, and the newest reply's record the
    // Context pane held), For developers (Devtools, and what Filament did).
    { id: "run", label: "Run", icon: "activity", tone: "var(--color-sys-indigo)", render: (body, ctx) => renderRun(body, runCtx(ctx)), refresh: (body, ctx) => refreshRun(body, runCtx(ctx)) },
    // What the next message sends, part by part and turn by turn (proposal_ux M5): the inspector's Context Map.
    { id: "next-request", label: "Next request", icon: "waypoints", tone: "var(--color-sys-pink)", render: (body, ctx) => renderNextRequest(body, nextRequestCtx(ctx)), refresh: (body, ctx) => refreshNextRequest(body, nextRequestCtx(ctx)) },
    // The Plan beside the chat (HarnessV4_TaskGraphPlus_Design D12): the Plan view's page, drawn narrow, staying while
    // you chat; its Pop out button takes it back to its tab, as the Plan tab itself does.
    {
      id: "plan", label: "Plan", icon: "network", tone: "var(--color-sys-blue)",
      render: (body, ctx) => { planPanes.set(body, views.planPane(body, ctx.chat)); },
      refresh: (body) => planPanes.get(body)?.paint(),
      back: { title: "Back to its tab: the plan full size again", run: () => views.planBack() },
    },
  ],
  room: () => shell.room(),
  paint: (look) => shell.paintPanes(look),
  dragging: (on) => shell.dragging(on),
  onChange: () => { paneButtons?.paint(); browserLine.inSight(rail.front().includes("browser")); },
  // An artifact's tab (HarnessV4_Artifacts_Plan AF-D35): its failure's words, and what its page asks on a click
  // (AF-D8), go into the message box of the chat beside it, selected, never sent; Open full is its full view.
  artifact: { onTell: (text) => composer.add(text), onAsk: (text) => composer.add(text), onFull: (name) => { location.hash = routeFor("artifact", { id: name }); } },
  // An agent's thread beside the chat (proposal_ux §4.7): the part the Sub Agents tab draws, in a tile of its own; the
  // tile's head opens the same thread in the tab.
  thread: {
    render: (body, id, head) => {
      /** @type {ReturnType<typeof renderThreadPane> | null} */
      let pane = null;
      // Made once the agents' list is the chat's own (panes/thread.js `threadOnceListed`): asked at each change — at the
      // page's start no chat is chosen yet, and on a chat's open the list is still the chat left's.
      const mine = () => {
        const c = String(chatOf(state.currentId)?.chainId || "");
        return !!c && subagentStore.chainId() === c;
      };
      const held = threadOnceListed(body, {
        id,
        mine,
        onChange: (fn) => subagentStore.onChange(fn),
        make: () => {
          pane = renderThreadPane(body, { chainId: subagentStore.chainId(), id, toast, main: mainDoor, held: heldAsks, onAskSelf: (tag) => views.side.fresh(tag), head, onOpen: () => views.side.open(id), answer: (aid, words) => answerWorker(aid, words), always: (aid, offer, ask) => alwaysWorker(aid, offer, ask) });
          besideThreads.set(id, pane);
          return pane;
        },
      });
      return () => {
        held.close();
        if (pane && besideThreads.get(id) === pane) besideThreads.delete(id);
      };
    },
    label: (id) => {
      const r = subagentStore.row(id) || subagentStore.own().find((g) => g.id === id) || null;
      return r ? { label: isGuest(r) ? r.agent || "Agent" : r.card?.name || r.description || "Agent", icon: rowIcon(r) } : null;
    },
  },
  // A team's result beside the chat (team_v2_plan §10 O3, Open beside): read once; its foot follows its card's row.
  result: {
    render: (body, id) =>
      renderResultPane(body, {
        // A tab the page opens again at its start is drawn before the chat is read: nothing is asked of no chat, and
        // the pane reads again once the teams beside are read.
        load: () => {
          const chain = besideStore.knownChat(id)?.main || besideStore.chainId();
          return chain ? besideRoutes(chain).result(id) : Promise.reject(new Error("its chat is still opening"));
        },
        row: () => besideStore.row(id),
        watch: (fn) => besideStore.onChange(fn),
        send: () => besideIO.notify(id),
        verify: () => besideIO.verify(id),
        ask: () => besideIO.open(id),
        openFile: (where) => chipActions.open?.(where.replace(/:\d+(?:[-–]\d+)?$/, "")),
      }),
    label: (id) => besideStore.row(id)?.team.name || besideStore.knownChat(id)?.name || null,
  },
  onClosed: (id) => { if (id === "outputs") store.set(OUTPUTS_CLOSED, "1"); },
  // Pop out (BS4): a tab in a window of its own; in a popped window, its one tab, its Follow the main window — turned
  // on, it asks the main window's chat at once — and a tab its pane opens, handed to the main window.
  only: POPPED || undefined,
  pop: popped
    ? {
        has: (id) => popped.has(id),
        out: (id) => popped.out(id, popRoute()),
        back: (id) => popped.back(id),
        ...(follows ? { follow: { get: follows.get, set: (/** @type {boolean} */ on) => { follows.set(on); if (on) windowsLine.post({ type: "ask" }); } } } : {}),
      }
    : null,
  elsewhere: POPPED ? (id) => windowsLine.post({ type: "open", id }) : undefined,
  // Pop out (HarnessV4_DesignPass_Plan UX10): a tab on top of the chat, the views' — its pane full size there.
  top: { show: (id) => views.showTop(id), moved: () => views.topsMoved() },
  // A file's tab (the code viewer): its Add to chat, as the Files pane's.
  onInsert: (text) => composer.fill(composer.draft() + text),
});
if (POPPED) setTitleLead(rail.labelOf(POPPED) || "A pane");
// The line between the windows: the main one answers a popped one's ask with its chat and opens the tab it hands; a
// popped one that follows goes where the main one says.
windowsLine.on((m) => {
  if (!POPPED) {
    if (m?.type === "ask") sayChat(true);
    else if (m?.type === "open" && typeof m.id === "string") rail.openTab(m.id);
    return;
  }
  if (m?.type === "chat" && follows?.get() && followable(m.route) && m.route !== location.hash) location.hash = m.route;
});
/** The chat the main window shows, as it was last said on the line. */
let saidChat = "";
/**
 * The main window says its chat on the line, once each time it moves — or again, asked.
 * @param {boolean} [again] @param {any} [chat]  the chat it shows now
 */
function sayChat(again = false, chat = chatOf(state.currentId)) {
  if (POPPED) return;
  const route = popRoute(chat);
  if (!again && route === saidChat) return;
  saidChat = route;
  windowsLine.post({ type: "chat", route });
}
/**
 * The coding agent a chat runs on, by name, where one does — its parts Filament cannot shape are greyed with why — else
 * "". @param {any} chat
 */
function coderNameOf(chat) {
  return chat?.view?.settings?.engine?.coder ? chosenAgent()?.agentName || "The coding agent" : "";
}
/** What the Files pane reads beside the host's context: Add to chat, which writes the file's `@path` into the message box. @param {any} ctx */
function filesCtx(ctx) {
  return { ...ctx, onInsert: (/** @type {string} */ text) => composer.fill(composer.draft() + text) };
}
/** What the Terminal pane reads beside the host's context: its toasts, and the folder a new terminal opens in. @param {any} ctx */
function terminalCtx(ctx) {
  return { ...ctx, onToast: toast, getFolder: () => chatOf(state.currentId)?.cwd || folderIn.value.trim() };
}
/** What the Run pane reads beside the pane's own: the page's configuration, and the chat's coding agent. @param {any} ctx */
function runCtx(ctx) {
  return { ...ctx, config: state.config, coder: () => coderNameOf(ctx.chat) };
}
/** What the Next request pane reads: the page's cached compose answer, your draft, and the way to read the chat again. @param {any} ctx */
function nextRequestCtx(ctx) {
  return {
    chat: ctx.chat,
    preview: () => plainPreview(),
    draft: () => composer.draft(),
    onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => toast(msg, kind),
    reload: () => { const c = sessionChat(); if (c) void refreshSessionDoc(c); },
    coder: () => coderNameOf(ctx.chat),
  };
}
/**
 * A pane beside the chat, opened at a part (Overview's links): `run:calls` opens the Run pane at its Calls. A pane that
 * shows already is drawn again at that part.
 * @param {string} id
 */
function openPaneAt(id) {
  const [pane, part] = id.split(":");
  if (pane === "run") showRunPart(part || "rounds");
  rail.openTab(pane);
  if (pane === "run") rail.refreshInPlace();
}
// A window's resize fits the panes first; the sidebar's rule then goes by the chat they leave (shell.js).
shell.onRoom(() => rail.relayout());
paneButtons = createPaneButtons({ host: rail, slot: headerModule.paneSlot, layoutSlot: headerModule.layoutSlot, header: headerModule.el });
// A file chip in a tool card opens that file as its own side-pane tab: in the current chat's folder, or, a whole path
// outside it, in its own (HarnessV4_Four_Plan FO-D26). A file's tag with its lines (`#L10-40`) opens it at them.
chipActions.open = (path, range = "") => {
  const f = fileWhere(chatOf(state.currentId)?.cwd || "", path);
  rail.openFileTab(f);
  // Asked once its tab shows: a viewer drawn already and shown again scrolls to them at once.
  if (range) showLines(f.cwd, f.path, range);
};
// A file as the files route reads it, where the chip opens it: an image a card shows comes back as a data URL.
chipActions.readFile = (path) => {
  const f = fileWhere(chatOf(state.currentId)?.cwd || "", path);
  return api(`/files/read?cwd=${encodeURIComponent(f.cwd)}&path=${encodeURIComponent(f.path)}`);
};

// The open session's sub-agents (HarnessV3 §15 item 86): one store feeds the status panel, the Agents widget and the
// transcript's chips; each opens a sub-agent's conversation in the viewer.
const subagentStore = createSubagentStore();
// The teams beside the open chat (team_v2_plan §5.3, §5.4): the Team tab's cards and the transcript's marks read them.
const besideStore = createBesideStore();
// The working ones' live boards on the Teams tab (team_v2_plan §10 O2): each team chat's workers, kept live by the bus,
// where its lead is and the room on every model, read again every few seconds while the tab shows.
const boardStore = createBoardStore({
  list: (tid) => subagentRoutes(tid).list(),
  lead: (main, tid) => besideRoutes(main).lead(tid),
  slots: () => api("/subagents/slots"),
  // Wherever the Agents tab shows: a team on the side is a row there, its crew under it (U13-D5).
  shown: () => views.shows("side") && document.visibilityState === "visible",
});
onBus((msg) => boardStore.heard(msg));
// Your saved agents (HarnessV4_Tasks E15 step 2): the `@` panel lists them, a tag at a message's start asks one, and
// the Agents tab beside the chat holds the conversations of those asked in the open session.
const agentCards = createAgentCardList();
/**
 * Every team, for a chat whose settings are not read — a new chat's, before its first message makes its session: its
 * message names teams too (the copies hunt of 10-23: "@bug-hunter" there was held as no agent's, then sent unsaid).
 * Read at the start and again when a team is saved. @type {{ key: string, name: string }[]}
 */
let teamsKnown = [];
/** Every team as Library holds it, its lead's and its workers' models and efforts with it: Who runs on what's. @type {any[]} */
let teamsWhole = [];
const readTeams = () =>
  api("/teams")
    .then((/** @type {any} */ t) => {
      teamsWhole = [...(t?.shipped || []), ...(t?.saved || [])].filter((/** @type {any} */ x) => x && x.key);
      teamsKnown = teamsWhole.map((/** @type {any} */ x) => ({ key: String(x.key), name: String(x.name || x.key) }));
    })
    .catch(() => {});
/**
 * The teams a chat's message may name: its settings' list, else every team; none while Settings › Experimental's Teams
 * switch is off (src/ui/lib/teams-on.js). @param {any} chat @returns {any[]}
 */
const teamsOf = (chat) => {
  if (!teamsOn(state.config)) return [];
  const e = chat?.view?.settings?.engine;
  return Array.isArray(e?.teams) ? e.teams : teamsKnown;
};
/**
 * The teams a chat may send or put in charge, from its engine as the page last read it: none while Settings ›
 * Experimental's Teams switch is off. The engine's own list stays whole: a team that leads a chat is drawn from it.
 * @param {any} engine @returns {any[]}
 */
const sendable = (engine) => (teamsOn(state.config) && Array.isArray(engine?.teams) ? engine.teams : []);
// What you type to an agent that still works (HarnessV4_Tasks E15 step 5, AG-101): held, and sent once it answers —
// from its thread in the Sub Agents tab, the Agents tab beside the chat or the sheet, whichever shows it.
const heldAsks = createHeldAsks();
/**
 * Whom the open chat's main agent may ask by itself, as the Sub Agents tab's foot row reads and writes it (HarnessV4_Tasks E15
 * step 3, AG-44): the chat's own list, or its project's, else the ticks on the cards — read here so a tick shows at
 * once. A coding agent's chat has it too: its agent asks through Filament's agent tool. Null for a chat not made yet
 * (its Start board has the row).
 * @returns {import("./widgets/may-ask.js").MayAsk | null}
 */
const mayAskOf = () => {
  const chat = chatOf(state.currentId);
  const st = chat?.view?.settings;
  if (!chat?.chainId || !st?.effective) return null;
  const from = String(st.sources?.["subagents.ask"] || "");
  const own = from === "session";
  const kept = Array.isArray(st.flat?.["subagents.ask"]) ? st.flat["subagents.ask"] : [];
  /** @param {{ patch?: any, unset?: string[] }} change */
  const write = async (change) => {
    await writeSessionSettings(chat, change);
    views.side.paint();
  };
  return {
    tags: own || from === "project" ? kept : agentCards.asks(),
    sub: own ? "this chat's own" : from === "project" ? "this project's own" : MAY_ASK_SUB,
    own,
    cards: agentCards.all(),
    defaults: agentCards.asks(),
    off: mayAskOff(st, chipActions.outsideClient?.() || null),
    onChange: (tags) => void write({ patch: setPath("subagents.ask", tags) }),
    onDefault: () => void write({ unset: ["subagents.ask"] }),
    // As the team tool reads them (the engine answer's `agentTeams`): a team that is gone stands in no list, and none
    // while teams are off.
    teams: teamsOn(state.config) ? teamNames(st.engine?.agentTeams) : [],
    onTeams: () => { location.hash = routeFor("library", { page: "agents" }); },
  };
};
/** The gear's paths this chat holds of its own (lib/side.js `ownGearPaths`). @param {any} chat @returns {string[]} */
const agentsOwnOf = (chat) => ownGearPaths(chat?.view?.settings?.sources);
/**
 * The chat's own Parallelize tasks, switched on by the card's Always accept in this chat, as the gear's row reads it:
 * on, with its way back — the chat asks first again, as Settings › Experimental says. Null where it is not on.
 * @returns {{ off: () => void } | null}
 */
const chatParallelOf = () => {
  const chat = sessionChat();
  if (!chat?.chainId || chat.view?.settings?.flat?.["subagents.parallelize"] !== true) return null;
  return { off: () => void writeSessionSettings(chat, { unset: ["subagents.parallelize"] }).then(() => views.side.paint()) };
};
/**
 * Each chat's settings write on its way, the newest: the gear's Reset all waits for it — a list whose popover the press
 * closed is written first, and dropped with the rest (the review of 9355b6724).
 * @type {Map<string, Promise<unknown>>}
 */
const settingsWrites = new Map();
/** The gear's Reset all for this chat: every one of them this chat holds, dropped in one write; Library's hold again. */
async function resetChatAgents() {
  const c = sessionChat();
  if (!c?.chainId) return;
  await settingsWrites.get(String(c.chainId));
  const unset = agentsOwnOf(c);
  if (!unset.length) return;
  if (await writeSessionSettings(c, { unset })) toast("This chat's agents run as Library sets them again");
  views.side.paint();
}
/** The teams a list names (`subagents.teams`, by key), by their names; a key no team has, as it is. @param {unknown} keys */
const teamNames = (keys) => (Array.isArray(keys) ? keys.map((k) => teamsKnown.find((t) => t.key === String(k))?.name || String(k)) : []);
/**
 * The session's main agent, for a thread's "Send to main agent" (HarnessV4_Tasks E15 step 5, BW-8): what it does now,
 * the outside client that writes its turns where one does, and its turn begun through the page's own send — the one
 * door a turn starts by, so the card that asks before a message is sent shows where it always shows.
 * @type {import("./subagent-viewer.js").MainDoor}
 */
const mainDoor = {
  state: () => {
    const m = mainNow();
    return m.live ? "works" : m.paused ? "asks" : "idle";
  },
  outside: () => chipActions.outsideClient?.() || null,
  start: (line) => {
    views.show("chat");
    void sendOrQueue(line);
  },
  // A picture's words from a thread with no box of its own (HarnessV4_Visuals_Plan VS-D51): into the message box, as
  // the chat's own pictures' go; where that box is not on screen, the toast says where they went.
  write: (text) => {
    composer.add(text);
    if (viewOf(chatOf(state.currentId)) !== "chat") toast("Written into the chat's message box: it is sent only when you send it");
  },
};
/** The threads drawn beside the chat now, by their agent's id: a follow-up's box takes the keys there. @type {Map<string, ReturnType<typeof renderThreadPane>>} */
const besideThreads = new Map();
// A thread's tab is named by its agent's card: the heads follow once the list knows it.
subagentStore.onChange(() => { if (rail.front().some((t) => parseThreadTabId(t))) rail.paintHeads(); });
/**
 * A saved agent's thread beside the chat (AG-12; proposal_ux §4.7): its own tab, shown where the window has room for
 * the panes. Answers whether it shows there, in front.
 * @param {string} id
 */
const showBeside = (id) => {
  rail.openTab(threadTabId(id), { asked: false });
  return rail.whereIs(threadTabId(id)) === "front";
};
/**
 * "Open beside", pressed: the thread in its own tab beside the chat — over it where the window has no room. Where it
 * shows beside, the chat comes into the view it left, the Agents tab, so the main agent's chat and the thread are seen
 * side by side, not the one thread twice (the owner's of 11-19: "it should open the Chat window as well so that the sub
 * agent pane shows beside the main agent"). On top, the view is the thread's. @param {string} id
 */
const openBeside = (id) => {
  if (!subagentStore.chainId()) return;
  rail.openTab(threadTabId(id));
  if (rail.whereIs(threadTabId(id)) === "front") views.show("chat");
};
/**
 * An agent's conversation, asked for (AG-104): the one door every card, chip and row opens. A saved agent you asked
 * opens beside the chat where the window has room for the pane; any other, and that one in a narrower window, as its
 * thread in the Sub Agents tab. Nothing opens over the page. `followUp`: its box to ask again takes the keys.
 * @param {string} id @param {{ followUp?: boolean }} [o]
 */
const openSubagent = (id, { followUp = false } = {}) => {
  if (!subagentStore.chainId()) return;
  if (subagentStore.row(id)?.asked && showBeside(id)) {
    if (followUp) besideThreads.get(id)?.focusFollowUp();
    return;
  }
  views.side.open(id, { followUp });
};
/** What a run says of a coding agent's own agent that its row shows: it began, made a call, holds more, ended. */
const OWN_AGENT_MOVES = new Set(["subagent-start", "subagent-tool-start", "subagent-held", "subagent-end"]);
/**
 * One of the open session's coding agent's own agents moved, as its running turn's run says (a sub-agent event that
 * names no agent of Filament's): the list that holds their rows is read again, once for a burst (HarnessV4_Tasks E15
 * step 5).
 * @param {any} chat @param {any} e
 */
const ownAgentMoved = (chat, e) => {
  if (OWN_AGENT_MOVES.has(e?.type) && !e.agentId && chat?.chainId === subagentStore.chainId()) subagentStore.soon();
};
/** @param {string} id */
const stopSubagent = (id) => {
  const chainId = subagentStore.chainId();
  if (!chainId) return;
  subagentRoutes(chainId).stop(id).then(() => subagentStore.refresh(), (e) => toast(errText(e), "err"));
};
/**
 * A row of the Agents tab deleted, the person asked once (the owner's ask of 10-23: "right click threads in Agents tab
 * and be able to delete those for cleanup"): an agent's thread, a team's chat on the side, or a flow with what it ran.
 * Its list is read again. → whether it went.
 * @param {import("./lib/side.js").ThreadDrop} d
 */
async function removeThread(d) {
  const chainId = sessionChat()?.chainId;
  if (!chainId || d.busy) return false;
  const yes = await confirmDialog({ title: d.title, description: d.description, confirmLabel: "Delete", destructive: true });
  if (!yes) return false;
  try {
    if (d.kind === "agent") await subagentRoutes(chainId).remove(d.id);
    else if (d.kind === "team") await besideRoutes(chainId).remove(d.id);
    else await flowRoutes(chainId).remove(d.id, { runs: true });
  } catch (e) {
    toast(errText(e), "err");
    return false;
  }
  if (d.kind === "agent") subagentStore.refresh();
  else if (d.kind === "team") {
    besideStore.refresh();
    sidebar.load();
  } else {
    flowList.drop(d.id);
    subagentStore.refresh();
    besideStore.refresh();
  }
  toast(d.done);
  return true;
}
/**
 * Stop one of the coding agent's own tasks from the status panel (HarnessV4_Tasks E6): a sub-agent its agent lets
 * Filament stop alone. Its row goes when the agent says it ended. @param {string} id
 */
const stopAgentTask = (id) => {
  const chat = chatOf(state.currentId);
  if (!chat?.chainId) return;
  api(`/sessions/${encodeURIComponent(chat.chainId)}/agent-tasks/${encodeURIComponent(id)}/stop`, { method: "POST" }).then(
    () => toast("Stopping that sub-agent. The main agent and its other work go on"),
    (e) => toast(errText(e), "err"),
  );
};
/**
 * A sub-agent of the open chat by the name its card gives it ("Reviewer"), from the agent a command names
 * (`subagent:<id>`); "" where the store holds none of that id. @param {string} agent
 */
function subagentName(agent) {
  const id = String(agent || "").replace(/^subagent:/, "");
  const r = subagentStore.rows().find((/** @type {any} */ x) => String(x.id) === id);
  return r ? String(r.card?.name || r.description || "").replace(/\s+/g, " ").trim().slice(0, 40) : "";
}
/** Which commands a chat runs, as one word to compare: Now is drawn again where it changes (E38). @param {any[] | undefined} list */
const commandIds = (list) => (list || []).map((c) => c.id).join(",");
/**
 * A chat's running commands as the server says them (HarnessV4_Background_Plan E38-D4): kept, and the open chat's
 * status drawn again — at the 2 s re-read (`tick`), their moving words alone where the same commands show, so a press
 * on Stop never lands on a row just drawn again (E38's live look). @param {string} chainId @param {unknown} list
 * @param {{ tick?: boolean }} [o]
 */
function setCommands(chainId, list, { tick = false } = {}) {
  const rows = Array.isArray(list) ? list : [];
  const was = commandIds(state.commands.get(chainId));
  if (rows.length) state.commands.set(chainId, rows);
  else state.commands.delete(chainId);
  // Now says them too: drawn again where one started or ended.
  if (commandIds(rows) !== was) sidebar.refreshNow();
  const chat = chatOf(state.currentId);
  if (chat?.chainId !== chainId) return;
  if (!tick) return paintStatus(chat);
  statusPanel.commands(rows);
  statusCapsule.commands(rows);
}
/**
 * Their newest lines read again while the status shows them (E38-D4), and after a Stop. @param {any} chat
 * @param {{ tick?: boolean }} [o]
 */
async function readCommands(chat, { tick = false } = {}) {
  if (!chat?.chainId) return;
  const chainId = String(chat.chainId);
  try {
    const r = await api(`/sessions/${encodeURIComponent(chainId)}/commands`);
    setCommands(chainId, r?.commands, { tick });
  } catch {} // the next tick reads again; the feed says each start and end
}
/**
 * The person's Stop on a running command (E38-D3): asked first, as Pause all is; its agent is told with its next turn.
 * Its row goes as the feed says it ended. @param {string} id @param {string} command
 */
async function stopCommand(id, command) {
  const chat = chatOf(state.currentId);
  if (!chat?.chainId) return;
  const yes = await confirmDialog({
    title: `Stop “${command}”?`,
    description: "It stops now, with everything it started. Its agent is told you stopped it, with its next turn; it is not woken for it.",
    confirmLabel: "Stop",
    destructive: true,
  });
  if (!yes) return;
  try {
    await api(`/sessions/${encodeURIComponent(chat.chainId)}/commands/${encodeURIComponent(id)}/stop`, { method: "POST" });
    toast(`Stopped “${command}”`);
  } catch (e) {
    toast(errText(e), "err");
  }
  void readCommands(chat);
}
/**
 * A chat's come-back as the server says it (the Designer's of 10-27), null once none waits: kept, Now drawn again where
 * it changed, and the open chat's status drawn again. @param {string} chainId @param {any} comeBack
 */
function setComeBack(chainId, comeBack) {
  const c = comeBack && Number(comeBack.at) > 0 ? { at: Number(comeBack.at), note: String(comeBack.note || "") } : null;
  const was = JSON.stringify(state.comeBacks.get(chainId) || null);
  if (c) state.comeBacks.set(chainId, c);
  else state.comeBacks.delete(chainId);
  if (JSON.stringify(c) !== was) sidebar.refreshNow();
  const chat = chatOf(state.currentId);
  if (chat?.chainId === chainId) paintStatus(chat);
}
/**
 * A chat's check-in on its agent idle while its command runs, as the server says it (app/sessions/idle-wake.js, the
 * owner's of 11-08), null once none is due: kept as a come-back is. @param {string} chainId @param {any} wake
 */
function setIdleWake(chainId, wake) {
  const w = wake && Number(wake.at) > 0 ? { at: Number(wake.at), commands: Array.isArray(wake.commands) ? wake.commands : [] } : null;
  const was = JSON.stringify(state.idleWakes.get(chainId) || null);
  if (w) state.idleWakes.set(chainId, w);
  else state.idleWakes.delete(chainId);
  if (JSON.stringify(w) !== was) sidebar.refreshNow();
  const chat = chatOf(state.currentId);
  if (chat?.chainId === chainId) paintStatus(chat);
}
/**
 * A chat's coding agent's own tasks as the server says them (HarnessV4_Tasks U1), the whole list at every change, on the
 * events feed with the chat's id — whoever holds its session: this page's turn, another tab's, its move, or none while
 * a task the agent left runs on. Kept on the page's chat on that session, when it was heard with it (a read of the
 * transcript asked before then holds an older list, `hydrate`), and the status drawn again where it is the chat
 * shown. They ride the feed: a page holds no stream for the chat it shows (HarnessV3-Responsiveness R3) — one held idle
 * there would be one of the six connections a browser gives this host.
 * @param {string} chainId @param {unknown} list
 */
function setAgentTasks(chainId, list) {
  const chat = chatByChain(chainId);
  if (!chat) return;
  chat.agentTasks = Array.isArray(list) ? list : [];
  chat.agentTasksAt = Date.now();
  if (chatOf(state.currentId) === chat) paintStatus(chat);
}
/**
 * A chat's watchers as the server says them (the plan of 11-11, its w8) — those that watch it and those that wake it —,
 * the whole list at each change of its Space's routines, on the events feed with the chat's id. Kept on the page's
 * chat, when it was heard with it (a read of the transcript asked before then holds an older list, `hydrate`), and the
 * lines over the box drawn again where it is the chat shown.
 * @param {string} chainId @param {unknown} list
 */
function setWatchers(chainId, list) {
  const chat = chatByChain(chainId);
  if (!chat) return;
  chat.watchers = Array.isArray(list) ? list : [];
  chat.watchersAt = Date.now();
  if (chatOf(state.currentId) === chat) paintWatchLine();
}
/**
 * The turns of a chat its watchers reviewed, as the server says them by their numbers (the plan of 11-11, its w8): the
 * whole map at each change, on the events feed with the chat's id — a review lands when its watcher's run ends, after
 * the turn it read. Kept on the page's chat, when it was heard with it (a read of the transcript asked before then
 * holds an older map, `hydrate`), and put on its turns: where it is the chat shown, each turn whose reviews moved has
 * its chip drawn in the footer that stands, and no other row is touched.
 * @param {string} chainId @param {unknown} byTurn
 */
function setReviews(chainId, byTurn) {
  const chat = chatByChain(chainId);
  if (!chat) return;
  chat.reviews = /** @type {Record<string, any[]>} */ (byTurn && typeof byTurn === "object" ? byTurn : {});
  chat.reviewsAt = Date.now();
  const moved = reviewsMoved(chat.turns || [], chat.reviews);
  if (chatOf(state.currentId) === chat) for (const t of moved) transcript.drawReviews(t);
}
/**
 * The person's Cancel on the open chat's come-back (the Designer's of 10-27): one press, no question — its title says
 * what it does. Its agent is told with its next turn; the toast names the time cancelled.
 */
async function cancelComeBack() {
  const chat = chatOf(state.currentId);
  if (!chat?.chainId) return;
  const chainId = String(chat.chainId);
  try {
    const r = await api(`/sessions/${encodeURIComponent(chainId)}/come-back/cancel`, { method: "POST" });
    if (r?.comeBack) toast(cancelledWords(r.comeBack));
    setComeBack(chainId, null);
  } catch (e) {
    toast(errText(e), "err");
    // None was set any more — its time came, or another window cancelled it — so the page's word was stale; a tab that
    // follows the chat read-only is refused with the come-back still set.
    const err = /** @type {any} */ (e);
    if (err?.status === 409 && err.body?.readOnly !== true) setComeBack(chainId, null);
  }
}
/** Run in background from the status panel (BUG-12's Detach, renamed on the owner's word of 10-27): the main agent goes
 *  on; the sub-agent's report reaches it when it finishes. The window keeps the other choice (report to me). @param {string} id */
const detachSubagent = (id) => {
  const chainId = subagentStore.chainId();
  if (!chainId) return;
  subagentRoutes(chainId).detach(id, true).then(() => {
    toast("In the background now — the main agent carries on; this agent keeps running and its report reaches the main agent when it finishes (the turn waits for that report before it ends)");
    subagentStore.refresh();
  }, (e) => toast(errText(e), "err"));
};
chipActions.openSubagent = openSubagent;
chipActions.stopSubagent = stopSubagent;
// A saved agent's card: the two marks the open chat holds of it, its answer whole where the chat holds only the list's
// clipped one, and Ask again — in its own thread while Filament holds it, else anew by its tag from the box.
// Every card drawn reads its marks as the agents' list moves: the chat's are read once for all of them, each hearing.
chipActions.cardMarks = (id, exchange) => {
  const chat = chatOf(state.currentId);
  return subagentStore.shared("cardMarks", () => cardMarksKept(chat))(id, exchange);
};
chipActions.cardAnswer = async (id, exchange) => {
  const chainId = subagentStore.chainId();
  if (!chainId) return "";
  const whole = await subagentRoutes(chainId).detail(id);
  return String(whole?.exchanges?.[exchange]?.report || "");
};
chipActions.askAgain = (id, tag, question) => {
  if (subagentStore.row(id)) return openSubagent(id, { followUp: true });
  composer.fill(`@${tag} ${question}`);
};
// Who writes this session's turns, when it is not Filament's own page: a report can be queued only for turns Filament's
// session turn makes, so an answer is copied over to such a client by hand.
chipActions.outsideClient = () => {
  const last = chatOf(state.currentId)?.turns.findLast((/** @type {any} */ t) => !t.past && !unsent(t));
  return last?.client && last.client !== "harness" ? String(last.clientLabel || last.client) : null;
};
// The card of an agent the main agent asked (HarnessV4_Tasks E15 step 3): Overrule turns the box's next message into
// one that overrules its answer, and the card reads the words it was overruled with from the chat.
chipActions.overrule = (o) => {
  if (!composer.overrule(o)) toast("Your draft is for a saved agent — send or clear it, then overrule");
};
chipActions.overruledOf = (id, exchange) => chatOf(state.currentId)?.subagentOverruled?.get(`${id}:${exchange}`) || null;
// A running command sent to the background (HarnessV4_Four_Plan E21): the card ends as the call's end lands; what
// kept it from moving is said in a toast, and the card's button is pressable again.
chipActions.toBackground = async (runId, callId) => {
  try {
    await api(`/runs/${encodeURIComponent(runId)}/calls/${encodeURIComponent(callId)}/background`, { method: "POST", body: {} });
    return null;
  } catch (e) {
    const why = errText(e);
    toast(`Not sent to the background: ${why}`, "err");
    return why;
  }
};
// A sub-agent's calls an ended turn's read left apart, read as its card opens (lib/run-calls.js).
chipActions.readCalls = (runId, of) => readCalls(api, runId, of);
/**
 * An overrule went out with the developer's words: the cards say so at once, as the session's record will after a
 * reload. @param {any} chat @param {readonly { agentId: string, exchange: number }[]} list @param {string} words
 */
function noteOverruled(chat, list, words) {
  if (!list.length) return;
  const line = String(words || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  for (const o of list) (chat.subagentOverruled ||= new Map()).set(`${o.agentId}:${Number(o.exchange) || 0}`, { words: line });
  subagentStore.touch();
}
// A report the developer kept aside: its transcript row reads the exchange's delivery from the store, sends it on and
// follows the store until it is sent. A sub-agent the registry forgot (a restart) is known only by the session's
// record of the reports sent on (the transcript's `subagentSent`) and of the ones it still keeps (`subagentHeld`).
chipActions.subagentDelivery = (id, exchange) => {
  const row = subagentStore.row(id);
  if (row) return row.exchanges[exchange]?.delivery ?? null;
  const chat = chatOf(state.currentId);
  const key = `${id}:${exchange}`;
  return chat?.subagentSent?.has(key) ? "sent" : chat?.subagentHeld?.has(key) ? "held" : undefined;
};
chipActions.sendSubagent = async (id, exchange) => {
  const chainId = subagentStore.chainId();
  if (!chainId) return;
  try {
    const out = await subagentRoutes(chainId).send(id, exchange);
    const chat = chatOf(state.currentId);
    if (chat?.chainId === chainId) {
      (chat.subagentSent ||= new Set()).add(`${id}:${exchange}`);
      chat.subagentHeld?.delete(`${id}:${exchange}`);
    }
    toast(out.into === "turn" ? "Sent — the running turn reads it at its next step" : "Sent — it opens the main agent's next turn");
    await subagentStore.refresh();
  } catch (e) {
    toast(errText(e), "err");
    throw e;
  }
};
chipActions.watchSubagents = (fn) => subagentStore.onChange(fn);
// A sub-agent's row, for the card of a call whose run stopped hearing of it: its end is the list's.
chipActions.subagentRow = (id) => subagentStore.row(id);
// What a helper drew in one exchange, for its card's "Drew" line (HarnessV4_Visuals_Plan VS-D50): the page's list says
// it while Filament holds the agent; else the session's record of where each is kept — on the turn that launched it,
// or on the session itself.
chipActions.drewOf = (id, exchange) => {
  const chat = chatOf(state.currentId);
  return chat?.chainId ? { chain: chat.chainId, drew: drewIn(subagentStore.row(id), chat, id, exchange, subagentStore.shared("drewKept", () => drewKept(chat))) } : null;
};
// …and a picture opened under that card: its ask and its Tell write into the message box (VS-D51).
chipActions.visualWords = (text) => composer.add(text);
// What a helper published in one exchange, for its card's "Made" line (HarnessV4_Artifacts_Plan AFC-100); one named
// there opens in its own side-pane tab.
chipActions.madeOf = (id, exchange) => madeIn(subagentStore.row(id), chatOf(state.currentId) || {}, id, exchange);
chipActions.openArtifact = (name) => rail.openArtifactTab(name);
// An envelope's card (HarnessV4_Envelopes_Plan EN5): whether the session's envelope of that number is still sealed, as
// the store says, and the later turn of the open chat whose run opened it; Open goes to whoever sent it — a team's chat
// beside this one, or a flow.
chipActions.envelopeState = (n) => {
  const chat = chatOf(state.currentId);
  for (const t of chat?.turns || []) {
    const at = t.aligned?.opened?.get?.(n);
    if (at) return { sealed: false, later: { turn: Number(t.n) || 0, round: at.round, by: at.by } };
  }
  return { sealed: subagentStore.sealed(n), later: null };
};
chipActions.openTeam = (id) => { void openBesideChat(id); };
chipActions.openFlow = (id) => openFlowRow(id);
// …and the chat that wrote a letter (app/letters.js).
chipActions.openChat = (chain) => openChain(chain);
// …and a sub-agent's chat on another machine, where the desktop app opens that machine's pages: in place beside the bar
// where it can, else on that machine's whole page (s2e).
chipActions.openOnMachine = typeof (/** @type {any} */ (globalThis).filamentApp?.openOn) === "function" ? (m, chat) => sidebar.openOnMachine(m, deskRoute({ chain: chat, thread: null })) : null;
// …and whether that list was answered: only then is a sub-agent it has no row of one Filament holds no longer.
chipActions.subagentsKnown = () => subagentStore.known();
// …and how such a one ended, as its own run's log says.
chipActions.subagentLogged = (sub) => subagentStore.logged(sub);
// …and an answer the list carries as a head, in its agent's cards' form.
chipActions.subagentCard = (id, exchange) => subagentStore.card(id, exchange);
// A sub-agent's own worktree: what the store says waits to be applied (null when the registry forgot it — the
// repository still holds the work, so Apply goes on working). Its Apply is in Changes' agents band and its thread.
chipActions.subagentWork = (id) => {
  const w = subagentStore.row(id)?.work;
  return w ? { pending: w.pending, applied: w.applied, hand: !!w.lastApplied?.hand, found: !!w.lastApplied?.hand && w.lastApplied.by === "found", undo: !!w.lastApplied?.undo } : null;
};
// A card's or a mark's "Review ›": the agent's row in Changes, open on its Apply (the Designer's of 10-27).
chipActions.reviewSubagent = (id) => {
  reviewAgent(`sub:${id}`);
  rail.openTab("changes");
};
onBus((msg) => {
  if (msg?.type !== "subagent-mark" || msg.mark?.event !== "overruled") return;
  // The session recorded an overrule — this page's, or another's on the same session: its card says so.
  for (const chat of state.chats.values())
    if (chat.chainId && chat.chainId === msg.chainId) (chat.subagentOverruled ||= new Map()).set(`${msg.mark.agentId}:${Number(msg.mark.exchange) || 0}`, { words: String(msg.mark.words || "") });
  subagentStore.touch();
});
onBus(markHeard);
/**
 * The developer's sub-agent sent off or back: the session recorded it, and the transcript draws it where it stands at
 * once (a reload draws it from the transcript's boundaries). A chat the page keeps but does not show takes it too, drawn
 * as it is shown: one whose turn runs is not read again until its turn ends, and its cards, short of their answer's
 * mark, waited on the agents' list at each showing.
 * @param {any} msg
 */
function markHeard(msg) {
  if (msg?.type !== "subagent-mark" || (msg.mark?.event !== "dispatch" && msg.mark?.event !== "arrival")) return;
  const chat = msg.chainId ? chatByChain(String(msg.chainId)) : null;
  if (!chat?.chainId) return;
  const mark = { ...msg.mark, type: "subagent" };
  if (!chat.turns.length) {
    // Asked before the chat's first turn (AG-24): the cards stand where that turn will.
    const same = (/** @type {any} */ x) => x.agentId === mark.agentId && x.exchange === mark.exchange && x.event === mark.event;
    if (!(chat.asked ||= []).some(same)) chat.asked.push(mark);
    transcript.drawAsked(chat);
  } else {
    const home = placeBoundary(chat.turns, mark);
    if (home) transcript.drawBoundaries(home);
  }
  // A saved agent's card reads its answer from the mark it came back with: the cards drawn look again.
  if (mark.asked) subagentStore.touch();
}
// A team beside moved (team_v2_plan §5.4): its main chat's list is read again, and a fire's or a result's mark stands in
// the open transcript at once (a reload draws it from the transcript's boundaries).
onBus((msg) => {
  if (msg?.type !== "beside") return;
  besideStore.heard(msg);
  if (!msg.mark) return;
  const chat = chatOf(state.currentId);
  if (!chat?.chainId || chat.chainId !== msg.main || !chat.turns.length) return;
  const home = placeBoundary(chat.turns, { ...msg.mark, type: "team" });
  if (home) transcript.drawBoundaries(home);
});
/**
 * A team beside's press, through its route; its row stands in the list at once, and a refusal is said in its words.
 * @param {(r: ReturnType<typeof besideRoutes>) => Promise<any>} fn @returns {Promise<any>}
 */
async function besidePress(fn) {
  // A team's own chat presses on its own row, which its main chat's routes answer.
  const chain = besideStore.main() || besideStore.chainId();
  if (!chain) return null;
  try {
    const out = await fn(besideRoutes(chain));
    if (out?.team) besideStore.put(out.team);
    return out;
  } catch (e) {
    toast(errText(e), "err");
    return null;
  }
}
/** A team beside's own conversation, opened: its lead, its workers, its questions. @param {string} id */
function openBesideChat(id) {
  const r = besideStore.row(id);
  return openSession({ id, title: r?.title || "", cwd: sessionChat()?.cwd || "" }, { push: true });
}
/**
 * What Verify… fills BugHunters' Brief with: the team's result as claims to check, else null (said in a toast).
 * @param {string} id
 */
async function verifyFill(id) {
  const chain = besideStore.chainId();
  if (!chain) return null;
  try {
    return await besideRoutes(chain).verifyAsk(id);
  } catch (e) {
    toast(errText(e), "err");
    return null;
  }
}
/** What the Teams tab's teams on the side read and do (views/beside.js). @type {import("./views/beside.js").BesideIO} */
const besideIO = {
  // A flow's team box is the flow's: its row is the flow's, on the Agents tab (HarnessV4_Flow_Plan F5).
  rows: () => besideStore.rows().filter((r) => !isFlowTeam(r)),
  brief: (fill) => openBriefNow(fill),
  set: (id, patch) => { void besidePress((r) => r.set(id, patch)); },
  // Send to your agent… (team_v2_plan §10 O3, the mock's D4): its result in this chat's message box, an attachment
  // beside the person's words; the box's Send sends it, as the box sends anything. One press never sends.
  notify: (id) => { void resultToBox(id); },
  // Open beside (§10 O3): its result whole, in a tile beside the chat.
  openResult: (id) => { rail.openTab(resultTabId(id)); },
  // Verify…: BugHunters' Brief, filled with the team's result; Send there starts it.
  verify: (id) => { void verifyFill(id).then((v) => { if (v) openBriefNow({ team: v.team, ask: v.ask, of: v.of, way: "side" }); }); },
  stop: (id) => { void besidePress((r) => r.stop(id)); },
  open: (id) => { void openBesideChat(id); },
  main: () => besideStore.main(),
  self: () => besideStore.self(),
  openMain: () => {
    const id = besideStore.main();
    if (id) void openSession((state.sessions || []).find((/** @type {any} */ s) => s.id === id) || { id, title: "", cwd: "" }, { push: true });
  },
  // Resume… (§9 Q8): its conversation, its message box filled to go on; Send goes on.
  resume: (id) => { void openBesideChat(id).then((c) => { if (c && chatOf(state.currentId) === c) composer.fill(RESUME_WORDS); }); },
  // A working team's live board (§10 O2): its workers and lead as the board store holds them; a worker's question
  // answered in its team's chat, from here; a worker's thread in its team chat's Agents tab.
  board: {
    rows: (tid) => boardStore.rows(tid),
    known: (tid) => boardStore.known(tid),
    lead: (tid) => boardStore.lead(tid),
    set: (id, patch) => { void besidePress((r) => r.set(id, patch)); },
    stop: (id) => { void besidePress((r) => r.stop(id)); },
    open: (id) => { void openBesideChat(id); },
    here: (tid) => String(sessionChat()?.chainId || "") === tid,
    openWorker: (tid, id) => {
      void openBesideChat(tid).then((c) => {
        if (!c || chatOf(state.currentId) !== c) return;
        views.show("side");
        views.side.open(id);
      });
    },
    answer: (tid, id, words) => answerInTeam(tid, id, words),
    // Always allow: the rule is the project's — a team on the side works in its main chat's folder — then a yes.
    always: async (tid, id, offer, ask) => { const chat = sessionChat(); return !!chat && (await confirmOffer(chat, offer)) && (await answerInTeam(tid, id, { allow: true, words: "", ask })); },
    usd: (n) => usd(n),
  },
  room: () => boardStore.room(),
  openSlots: () => { location.hash = routeFor("settings", { section: "providers" }); },
};
/**
 * A team's result into the open chat's message box (team_v2_plan §10 O3): read whole, put in as an attachment. Said in
 * a toast where it cannot be read, or where the open chat is not the team's main chat.
 * @param {string} id
 */
async function resultToBox(id) {
  const main = besideStore.chainId();
  const chat = sessionChat();
  if (!main || chat?.chainId !== main) return;
  try {
    const res = await besideRoutes(main).result(id);
    if (chatOf(state.currentId) !== chat) return;
    composer.attach(resultAttachment(res, main));
  } catch (e) {
    toast(errText(e), "err");
  }
}
/**
 * A team's result that went from the box (team_v2_plan §10 O3): its card says so from now on.
 * @param {any[]} attachments @param {"steered" | "sent"} how
 */
function teamSent(attachments, how) {
  for (const a of attachments) {
    if (a?.kind !== "team" || !a.team?.id) continue;
    void besideRoutes(a.team.main).sent(a.team.id, { n: a.team.n, how }).then((out) => besideStore.put(out?.team)).catch((e) => toast(errText(e), "err"));
  }
}
/**
 * A message's teams' results, for a note to a running turn (team_v2_plan §10 O3): they are words, so they go in ahead
 * of the person's (`words`); the bubble names each (`named`); the rest of its files (`others`) are the run's to take.
 * @param {any[]} attachments @param {string} text
 */
function teamWords(attachments, text) {
  const teamed = attachments.filter((a) => a.kind === "team");
  const words = [...teamed.map((a) => String(a.text || "")), text].filter(Boolean).join("\n\n");
  return { teamed, others: attachments.filter((a) => a.kind !== "team"), words, named: teamed.map((a) => String(a.name)) };
}
/**
 * A worker's question in a team chat on the side, answered from its board (team_v2_plan §10 O2): Allow runs its call,
 * Deny answers it Not run in its words — the ask its bar showed (`ask`). True once the server took it; a refusal is said.
 * @param {string} tid @param {string} id @param {import("./conversation/decisions.js").WorkerAnswer} a @returns {Promise<boolean>}
 */
async function answerInTeam(tid, id, a) {
  try {
    await subagentRoutes(tid).answer(id, answerWords(a), { allow: a.allow, ask: a.ask });
    await boardStore.refresh(tid);
    return true;
  } catch (e) {
    toast(errText(e), "err");
    return false;
  }
}
besideActions.row = (id) => besideStore.row(id);
besideActions.watch = (fn) => besideStore.onChange(fn);
besideActions.set = besideIO.set;
besideActions.notify = besideIO.notify;
besideActions.open = besideIO.open;
besideActions.openResult = besideIO.openResult;
// Verify… from a transcript's mark opens BugHunters' Brief, filled; Send there starts it.
besideActions.verify = besideIO.verify;

// The side-by-side card (Phase 5): the graph's, after the turn whose end offered it. It reads the chat's graph as the
// page last heard it, and its Accept and Ignore answer with the graph, which the page takes at once.
/** Each graph the page takes, heard by the cards drawn. @type {ReturnType<typeof listenerSet<void>>} */
const graphHeard = listenerSet();
sideActions.offer = (chainId) => {
  const g = chatByChain(chainId)?.graphLive || null;
  return { known: !!g, at: g?.offer?.at ?? null };
};
sideActions.watch = (fn) => graphHeard.on(() => fn());
// The chat's own model, as the side-run sheet's picker starts on it: the shown chat with none takes the box's.
sideActions.model = (chainId) => {
  const chat = chatByChain(chainId);
  return baseModelOf(chat?.model || (chat && chat === chatOf(state.currentId) ? composer.modelName() : "") || "");
};
sideActions.facts = (chainId) => api(`/sessions/${encodeURIComponent(chainId)}/graph/side-run`);
sideActions.accept = async (chainId, body) => {
  const out = await api(`/sessions/${encodeURIComponent(chainId)}/graph/side-run`, { method: "POST", body });
  const chat = chatByChain(chainId);
  if (chat && out?.graph) takeGraph(chat, out.graph);
  return out;
};
sideActions.ignore = async (chainId, at) => {
  const out = await api(`/sessions/${encodeURIComponent(chainId)}/graph/side-offer/ignore`, { method: "POST", body: { at } });
  const chat = chatByChain(chainId);
  if (chat && out?.graph) takeGraph(chat, out.graph);
  return out;
};
sideActions.said = (words) => toast(words);

// The card for sub-agents that change files (the owner's of 11-14): while Parallelize tasks is off, a launch of one waits
// on it. The page keeps each card as it last heard it — the feed's `held`, or the transcript's read where the feed said
// nothing newer — with when it heard it, by its own clock: the card counts down from the time left the server said.
/** The cards heard, by chat and card. @type {Map<string, { hold: any, heard: number }>} */
const heldHeard = new Map();
/** The cards drawn hear each word of one. @type {ReturnType<typeof listenerSet<void>>} */
const heldMoved = listenerSet();
// A card answered moves up from under its turn to where its agent asked (timeline.js `heldMoved`).
heldMoved.on(() => transcript.heldMoved());
/**
 * A card's word, kept unless the page holds a later one (an answered card is never taken back to waiting).
 * @param {any} hold @returns {boolean} whether it was kept
 */
function takeHeld(hold) {
  if (!hold?.id || !hold.chainId) return false;
  const key = `${hold.chainId}\n${hold.id}`;
  const had = heldHeard.get(key);
  if (had && had.hold.state !== "waiting" && hold.state === "waiting") return false;
  heldHeard.set(key, { hold, heard: Date.now() });
  return true;
}
heldActions.view = (chainId, id) => heldHeard.get(`${chainId}\n${id}`) || null;
heldActions.watch = (fn) => heldMoved.on(() => fn());
heldActions.answer = async (chainId, id, said) => {
  const out = await api(`/sessions/${encodeURIComponent(chainId)}/held-launches/${encodeURIComponent(id)}`, { method: "POST", body: { answer: said } });
  if (takeHeld(out?.hold)) heldMoved.hand();
  // Always accept in this chat switched the chat's own Parallelize tasks on: its settings read again, so the Agents
  // tab's gear shows it with its way back.
  const chat = said === "always" ? chatByChain(chainId) : null;
  if (chat) { await refreshSessionDoc(chat); views.side.paint(); }
  return out;
};
heldActions.said = (words) => toast(words);
// The chat's cards read again — after a refusal, or a clock run out with no word —: each as the server has it, and one
// the page still holds waiting that the server no longer has (a restart forgot it, its turn with it) stands answered,
// nothing started. Only a card heard before the read asked: one the feed brought while it was under way is newer than
// the read's answer.
heldActions.refresh = async (chainId) => {
  const asked = Date.now();
  const out = await api(`/sessions/${encodeURIComponent(chainId)}/held-launches`).catch(() => null);
  if (!Array.isArray(out?.holds)) return;
  const has = new Set(out.holds.map((/** @type {any} */ h) => h?.id));
  for (const h of out.holds) takeHeld(h);
  for (const [key, gone] of heldGone(heldHeard, chainId, has, asked, Date.now())) heldHeard.set(key, gone);
  heldMoved.hand();
};
onBus((msg) => {
  if (msg?.type !== "held" || !msg.hold) return;
  if (!takeHeld(msg.hold)) return;
  // A new card stands in its chat's transcript at once; one heard again repaints where it is drawn.
  const chat = chatByChain(String(msg.chainId || msg.hold.chainId));
  if (chat?.turns?.length) {
    // A card whose turn the archive did not number stands after the newest turn on record.
    const home = placeBoundary(chat.turns, { ...msg.hold, type: "held", afterTurn: msg.hold.turn ?? Infinity });
    if (home && chat === chatOf(state.currentId)) transcript.drawBoundaries(home);
  }
  heldMoved.hand();
});

// A routine or a watcher an agent proposed, proposed right in its chat (the owner's of 11-12): the card under the call
// reads its one routine, follows its Space on the feed, and writes as the Space's sheet does — a refusal said in a toast.
const routinePath = (/** @type {string} */ project, /** @type {string} */ id) => `/space/${encodeURIComponent(project)}/routines/${encodeURIComponent(id)}`;
routineActions.here = () => {
  const chat = chatOf(state.currentId);
  return { chain: chat?.chainId || null, project: projectOfChat(chat) };
};
routineActions.read = async (project, id) => {
  try {
    return await api(routinePath(project, id));
  } catch (e) {
    const err = /** @type {any} */ (e);
    if (err?.status === 404) return { gone: err.body?.none ? "Its project has no Space now: what it proposed went with it." : "It is no longer in its Space." };
    throw e;
  }
};
routineActions.watch = (project, fn) => onBus((m) => {
  if (m?.type === "space" && (m.project === project || m.project === "*")) fn();
});
routineActions.write = async (project, id, method, path, body) => {
  try {
    return (await api(`${routinePath(project, id)}${path}`, { method, ...(body === undefined ? {} : { body }) })) || {};
  } catch (e) {
    toast(errText(e), "err");
    return null;
  }
};
routineActions.askChat = (chain, words) => askInChat(chain, words);
routineActions.openChat = (chain) => openChain(chain);
routineActions.openSpace = (project, watcher) => { location.hash = routeFor("space", { id: project, tab: watcher ? WATCHERS : ROUTINES }); };
routineActions.viewOnly = () => viewOnlyNow();

// ---------------------------------------------------------------------------------------------------
// Flows beside the chat (HarnessV4_Flow_Plan F5, F6; HarnessV4_OneAgent_Plan OA3): the person's agents and teams in
// steps. `/flow <words>` asks the main agent to design one (OA-D6); its draft stands over the box — Start is the one
// press that runs it — and so does what a flow waits for; each flow is a row of the Agents tab; its line is in the
// header. The main agent hears of a flow at its Start and at its end (OA-D8, FL-D10).
// ---------------------------------------------------------------------------------------------------
const flowList = createFlowList();
onBus((msg) => flowList.heard(msg));
// Run as a flow (OA6): the main agent offered it in the turn that runs — its end draws the button under the reply.
onBus((msg) => {
  if (msg?.type !== "flow-offer") return;
  const turn = chatByChain(String(msg.chainId || ""))?.live?.turn;
  if (turn) turn.flowOffer = true;
});
// A plan offered first (the owner's plan mode of 11-06): its agent offered it in the turn that runs — its end draws the
// card under the reply.
onBus((msg) => {
  if (msg?.type !== "plan-offer") return;
  const turn = chatByChain(String(msg.chainId || ""))?.live?.turn;
  if (turn) turn.planOffer = { depth: String(msg.depth || "standard"), side: msg.side === true };
});
/** The saved flows as last read, null until then. @type {import("./lib/flow.js").SavedFlow[] | null} */
let savedFlowsList = null;
let savedFlowsReading = false;
/** The saved flows read again: Agents › Flows lists them. */
function loadSavedFlows() {
  const chain = flowList.chainId();
  if (savedFlowsReading || !chain) return;
  savedFlowsReading = true;
  flowRoutes(chain).saved()
    .then((r) => { savedFlowsList = Array.isArray(r?.flows) ? r.flows : []; }, () => { savedFlowsList = []; })
    .finally(() => { savedFlowsReading = false; views.side.paint(); });
}
/**
 * A flow's press, through its route: the flow it answers stands in the list at once; a refusal is said in its words.
 * @param {(r: import("./lib/flow.js").FlowRoutes) => Promise<any>} fn @returns {Promise<any>}
 */
async function flowPress(fn) {
  const chain = flowList.chainId();
  if (!chain) return null;
  try {
    const out = await fn(flowRoutes(chain));
    if (out?.flow) flowList.put(out.flow);
    else void flowList.refresh();
    return out ?? { ok: true };
  } catch (e) {
    toast(errText(e), "err");
    return null;
  }
}
/** The teams the open chat may send. */
const chatTeams = () => sendable(sessionChat()?.view?.settings?.engine);
/** The Agents tab on a flow's row. @param {string} id */
const openFlowRow = (id) => views.side.open(flowItem(id));
/** What a flow's cards read and do (views/flow.js). @type {import("./views/flow.js").FlowIO} */
const flowIO = {
  rows: () => flowList.rows(),
  cards: () => agentCards.all(),
  teams: chatTeams,
  // What moved in a flow a moment ago, played on its card; what a box at work does now (the Designer's of 10-28).
  changes: (id) => flowList.changes(id),
  live: (b) => {
    if (b.run?.sub) {
      const p = subagentStore.row(b.run.sub)?.progress;
      return p ? { round: Number(p.round) || 0, tool: p.tool || null, words: String(p.words || "") } : null;
    }
    const r = b.run?.team ? besideStore.row(b.run.team) : null;
    return r ? { team: workersWords(r) } : null;
  },
  seats: () => Number(subagentStore.seats()?.max) || null,
  uncommitted: () => flowList.uncommitted(),
  recount: () => flowList.recount(),
  press: flowPress,
  editBox: (f, step, index) => {
    openBoxSheet({
      flow: f, step, index, cards: () => agentCards.all(), teams: chatTeams,
      models: () => state.models || [],
      families: () => state.families || [],
      accounts: () => state.accounts || [],
      write: async (steps) => !!(await flowPress((r) => r.edit(f.id, { steps }))),
    });
  },
  save: (f) => {
    openSaveSheet({
      name: f.title,
      save: async (name) => {
        const out = await flowPress((r) => r.keep(f.id, { name }));
        if (!out?.saved) return false;
        savedFlowsList = null;
        toast(`Saved as a flow: ${out.saved.name}. Agents › Flows starts it on other words`);
        return true;
      },
    });
  },
  openThread: (id) => views.side.open(id),
  openTeam: (id) => { void openBesideChat(id); },
  openFlow: openFlowRow,
  // Discard puts the words back in the box where it is empty: nothing typed is lost.
  putBack: (words) => { if (!composer.draft().trim()) composer.fill(words); },
  saved: () => savedFlowsList,
  teamsOn: () => teamsOn(state.config),
  loadSaved: () => loadSavedFlows(),
  created: (f) => openFlowRow(f.id),
};
const flowCards = createFlowCards(flowIO);
const flowPane = createFlowPane(flowIO, flowCards);
// A box at work says what its agent does now, in place: as the agents' lists move, and each second for its clock.
subagentStore.onChange(() => flowCards.live());
besideStore.onChange(() => flowCards.live());
setInterval(() => flowCards.live(), 1000);
/**
 * Your agent's own work, drawn as a flow (HarnessV4_OneAgent_Plan L47): the open chat's threads and its coding agent's own
 * agents, a step per reply of your agent; your messages name the replies.
 */
const workPane = createWorkPane({
  work: () => workOf({ rows: subagentStore.rows(), own: subagentStore.own(), turns: sessionChat()?.turns || [] }),
  cards: () => agentCards.all(),
  openThread: (id) => views.side.open(id),
  // A box whose words the list carries as heads: its thread's exchanges in the cards' form, as the list carried them
  // before — never the context it was handed, which the box does not show.
  whole: async (thread) => {
    const chainId = subagentStore.chainId();
    const sa = chainId ? await subagentRoutes(chainId).card(thread) : null;
    return sa ? sa.exchanges.map((x) => ({ asked: String(x.prompt || ""), answer: String(x.report || "") })) : null;
  },
});
/**
 * The flows painted where they show: over the box, in the header, on the Agents tab. Called only once the dock and the
 * header's line stand (the list's listener is added after them).
 */
function paintFlows() {
  const chat = chatOf(state.currentId);
  const mine = !!chat?.chainId && flowList.chainId() === String(chat.chainId);
  flowCards.keep(flowList.rows());
  flowDock.paint(mine ? chat : null);
  flowStatus.paint(mine ? flowList.rows() : [], String(chat?.chainId || ""));
  views.drawTeam();
}
// A box picked, or edit mode turned on: the card shows it at once.
flowCards.onStale(() => paintFlows());
// Each change to a session's task graph rides the feed with its rev (HarnessV3-TaskGraph G2-10): the chat keeps the
// newest, so a change between turns draws live and an older one never draws over a newer one.
onBus((msg) => {
  if (msg?.type !== "graph" || !msg.chainId || !msg.graph) return;
  for (const chat of state.chats.values()) if (chat.chainId === msg.chainId) takeGraph(chat, msg.graph);
});
/**
 * A session's task graph as it now stands, onto its chat — never an older one over a newer one. The side-by-side card
 * it offers (Phase 5) stands after the turn that offered it, and the cards drawn hear it.
 * @param {any} chat @param {any} graph
 */
function takeGraph(chat, graph) {
  if (chat.graphLive && (Number(chat.graphLive.rev) || 0) >= (Number(graph.rev) || 0)) return;
  chat.graphLive = graph;
  const shown = chat === chatOf(state.currentId);
  if (graph.offer && chat.turns?.length) {
    const home = placeBoundary(chat.turns, { type: "side", ...graph.offer, afterTurn: graph.offer.turn });
    if (home && shown) transcript.drawBoundaries(home);
  }
  graphHeard.hand();
  if (shown) views.pulse();
}
/** The graph tasks whose send-back is on its way: a second click waits for the first's answer. @type {Set<string>} */
const sendingBack = new Set();
/**
 * The developer's own send-back of a failed graph task (HarnessV4_Tasks U1), or their start of one they stopped
 * (HarnessV4_Tasks B4): its last worker goes on with it, or —
 * `fresh` — a new one takes it. The graph's work starts under a turn alone, so where none runs the planner's next
 * turn goes out with it, in the developer's words; a held graph is left to them.
 * @param {string} id @param {boolean} fresh
 */
async function sendTaskBack(id, fresh) {
  const chat = sessionChat();
  const chainId = chat?.chainId;
  const key = `${chainId}\n${id}`;
  if (!chainId || sendingBack.has(key)) return;
  sendingBack.add(key);
  try {
    const out = await api(`/sessions/${encodeURIComponent(chainId)}/graph/tasks/${encodeURIComponent(id)}/start`, { method: "POST", body: fresh ? { fresh: true } : {} });
    const crew = crewOf(chat.view?.settings?.engine);
    if (out.graph) takeGraph(chat, out.graph);
    const carries = out.waits === "turn" && chatOf(state.currentId) === chat && !composer.live().streaming && !asksYou(newestOnRecord(chat.turns));
    toast(sentBackWords(id, { fresh, waits: carries ? null : out.waits, resumes: out.resumes || null, crew }));
    if (carries) void sendOrQueue(carryOnWords(id, { resumes: out.resumes || null, crew, again: out.again === true }), { ours: true });
  } catch (e) {
    toast(errText(e), "err");
  } finally {
    sendingBack.delete(key);
  }
}
// A graph task's sub-agent or worker at work: its round, its newest tool and the call it asks you about, for its card's
// live line — never kept in the graph.
onBus((msg) => {
  if (msg?.type !== "subagent-progress" || !msg.task) return;
  const chat = chatOf(state.currentId);
  if (!chat?.chainId || chat.chainId !== msg.chainId) return;
  (chat.taskProgress ||= new Map()).set(String(msg.task), { agent: String(msg.id || ""), round: Number(msg.progress?.round) || 0, tool: msg.progress?.tool || null, asking: msg.progress?.asking || null });
  views.pulse();
});
// A turn carried the messages those marks waited with (HarnessV3-FixRound decision 23): their rows say which turn.
onBus((msg) => {
  if (msg?.type !== "subagent-carried") return;
  const chat = chatOf(state.currentId);
  if (!chat?.chainId || chat.chainId !== msg.chainId) return;
  for (const t of carryMarks(chat.turns, msg)) transcript.drawBoundaries(t);
});
// Where memory's engine stands (HarnessV3-AtHome AH-D2): the Memory widget's pill shows an install's percent.
followEngine(onBus, { read: () => api("/memory/engine"), onSaid: (now) => { state.memoryEngine = now; widgets.paint(); } });
/** Whether the accounts were read once: a fresh start's model waits for them (`pickFirstModel`). */
let accountsRead = false;
// The coding agents' accounts and their plans' windows (HarnessV3-ACP AC3-6), read again whenever one moves.
followAccounts(onBus, { read: () => api("/agent-accounts"), onSaid: (rows) => { state.accounts = rows; accountsRead = true; accountsMoved(); pickFirstModel(); } });
/**
 * A fresh install has no remembered model: the first the picker offers is selected (`firstModel`), so the very first
 * send works — a plain route, which in the harness runs the agent loop (the pipeline wraps it). Once both the catalogue
 * and the accounts are read, so the choice is never a coding agent the picker hides (the owner's of 10-30).
 */
function pickFirstModel() {
  if (composer.modelName() || !accountsRead || !state.models.length) return;
  const name = firstModel(state.models, state.accounts);
  if (!name) return;
  composer.setModel(name);
  rememberModel(baseModelOf(name));
}

/**
 * The coding agent a model runs on, and its account as the page keeps it (HarnessV3-ACP AC3-6): the catalogue's row
 * names its upstream; a name the list doesn't carry is the session's model in force, whose agent the session's view
 * names (`engine.coder`). Null for any other model.
 * @param {string} name
 */
const agentOf = (name) => {
  const row = state.models.find((/** @type {any} */ m) => m?.id === name);
  const upstream = row ? (row.codingAgent ? row.upstream : null) : chatOf(state.currentId)?.view?.settings?.engine?.coder || null;
  return upstream ? state.accounts.find((r) => r.upstream === upstream) || null : null;
};
/** The coding agent the composer's model runs on, and its account. */
const chosenAgent = () => agentOf(composer.modelName());
/** Who hears each new read of the accounts besides the composer and the widgets: the sign-in sheet, Settings' section. */
const accountsHeard = listenerSet();
/** The accounts or the model moved: the Account instrument, the plan's notice over the box and the picker's tabs follow. */
const accountsMoved = () => {
  widgets.paint();
  views.draw();
  composer.setPlanNotice(noticeOf(chosenAgent()));
  composer.setAccounts(state.accounts);
  accountsHeard.hand(undefined);
};
/** One agent's account as a route answered it, in place of the page's copy. @param {any} row */
const keepAccount = (row) => {
  if (!row?.upstream) return;
  state.accounts = state.accounts.some((r) => r.upstream === row.upstream) ? state.accounts.map((r) => (r.upstream === row.upstream ? row : r)) : [...state.accounts, row];
  accountsMoved();
};
/**
 * Ask of one agent's account through its route: the account as it then stands replaces the page's copy at once (a
 * check that changed nothing announces nothing on the feed), what a check found is said — the plan as it was, or why
 * none was read — and a refusal is said in a toast. The route's answer, or null. `beside`: an account checked beside
 * the session's (`checkAgent`), which says only a check that came to nothing, by its name.
 * @param {string} upstream @param {"check" | "reset-credit"} what @param {import("../lib/accounts.js").AgentRow | null} [beside]
 */
async function accountWord(upstream, what, beside = null) {
  if (viewOnlyPage()) {
    toast(VIEW_ONLY_REFUSED, "err");
    return null;
  }
  try {
    const r = await api(`/agent-accounts/${encodeURIComponent(upstream)}/${what}`, { method: "POST" });
    keepAccount(r?.agent);
    if (beside) {
      if (r?.checked?.said && !r.checked.read) toast(`${accountName(beside)}: ${r.checked.said}`);
    } else if (r?.checked?.said) toast(r.checked.said);
    return r;
  } catch (e) {
    keepAccount(/** @type {any} */ (e)?.body?.agent);
    toast(`${what === "check" ? `Couldn't check ${beside ? accountName(beside) : "the account"}` : "Couldn't use a reset credit"}: ${errText(e)}`, "err");
    return null;
  }
}
/**
 * Check now on the Account instrument (the owner's words of 10-18: "it only refreshes the current active account but
 * does not refresh the limits of other available accounts on that coding agent"): the session's account and each other
 * account of its agent asked at once. The session's says what its check found, as one asked alone does; another's
 * gauge under Switch account shows what it found, and only a check that came to nothing says so, by its name.
 * @param {string} upstream
 */
async function checkAgent(upstream) {
  const r = state.accounts.find((x) => x.upstream === upstream);
  await Promise.all([accountWord(upstream, "check"), ...(r ? othersOf(state.accounts, r) : []).map((x) => accountWord(x.upstream, "check", x))]);
}
/**
 * The model a session goes on with on another agent upstream: the same model there (`<its prefix>/<the same model>`),
 * else its first; null, said in a toast, where it offers none.
 * @param {string} upstream
 */
function modelOn(upstream) {
  const tail = (/** @type {string} */ id) => id.slice(id.indexOf("/") + 1);
  const offered = state.models.filter((/** @type {any} */ m) => m?.upstream === upstream && m.codingAgent && m.source !== "effort-variant");
  const model = offered.find((/** @type {any} */ m) => tail(String(m.id)) === tail(composer.modelName())) || offered[0];
  if (!model) toast("That agent offers no model right now — its models are read again once it starts", "err");
  return model ? String(model.id) : null;
}
/**
 * Go on with a turn its plan stopped on another agent upstream (HarnessV3-ACP AC3-6): the session's model becomes the
 * same model on that upstream (`modelOn`); the agent's new session is seeded from Filament's copy, and the turn's words
 * go again. False where they do not go — a turn runs in the chat or a message waits for it, before the model is written
 * or after, the model could not be written, one Continue on is under way already, or the turn has nothing to send
 * again —: the card gives itself back. One under way is the chat's `continuing`, its write's stop: the card's Cancel
 * stops it (`stopContinue`), or the countdown's where one is armed. A countdown armed (`armResume`) is held while the
 * model is written, sending nothing: where the words go it is let go, else it stands again. A send refused before its
 * first wait (the tab turned read-only meanwhile, a chat switched away from could not be readied) is a way not taken;
 * one refused later (the chat could not be readied, the page had lost its own running turn, the chat is its client's)
 * arms the countdown again and gives the card back (`limitBack`). Either way it is armed only where its time is still
 * to come: one that passed meanwhile would send "continue" at once in place of the way taken — into what refused the
 * words or the model's write, or behind the turn the card is to be answered after —, and the card is the way on; a card
 * dismissed meanwhile takes the countdown with it. A model written stays the session's: a refusal after it says so,
 * with the send's own words (`refusal`) — the toast holds one message —, and a send that throws is refused in its words.
 * @param {any} chat @param {any} turn @param {string} upstream @returns {Promise<boolean>}
 */
async function continueOn(chat, turn, upstream) {
  if (chatOf(state.currentId) !== chat || chat.continuing || turnRunsIn(chat)) return false;
  const again = againOf(turn);
  if (!again.text && !again.attachments.length && !again.brief) {
    toast(again.wake || again.once ? SENT_ONCE : "Nothing of this message can go again from here — what went with it is not kept on the page: send it again from the box", "err");
    return false;
  }
  const name = modelOn(upstream);
  if (!name) return false;
  // A Cancel stops the write — the countdown's where one is armed, else the card's own (`stopContinue`): no clock ends
  // it, and a Continue on stopped is a way not taken.
  const stop = new AbortController();
  holdResume(chat, () => stop.abort());
  chat.continuing = stop;
  const written = await writeSessionSettings(chat, { patch: { model: { name } } }, { signal: stop.signal }).catch((e) => (toast(errText(e), "err"), false));
  chat.continuing = null;
  /** Nothing went: the countdown held stands again, where its card does and its time is still to come. */
  const standAgain = () => {
    if (chat.resume?.held) armResume(chat, turn.shimDismissed || chat.resume.at <= Date.now() ? null : chat.resume.at);
  };
  if (!written) return (standAgain(), false);
  if (chat.live || chat.waiting) {
    toast(`The session runs on ${name} now, but ${chat.live ? "a turn began in this chat meanwhile — answer the card once it ends" : "a message waits for this chat now — answer the card once that one has gone"}`, "err");
    return (standAgain(), false);
  }
  const moved = () => (refusal ? toast(`The session runs on ${name} now, but the message did not go: ${refusal}`, "err") : toast(`The session runs on ${name} now`));
  const sending = sendAgain(chat, turn);
  const sent = sending.catch((e) => refuse(errText(e)));
  // A send refused before it went has answered already: of the two, the race takes the one settled first.
  if ((await Promise.race([sending, null]).catch(() => false)) === false) return (moved(), standAgain(), false);
  const held = chat.resume?.held ? chat.resume.at : null;
  armResume(chat, null);
  void sent.then((s) => {
    if (s !== false) return;
    moved();
    if (held != null && held > Date.now() && !chat.resume && !turn.shimDismissed) armResume(chat, held);
    transcript.limitBack(turn);
  });
  return true;
}
/**
 * The limit card's Cancel of a Continue on under way where no countdown is armed: its model's write is stopped, and the
 * way is not taken (`continueOn`). @param {any} chat
 */
function stopContinue(chat) {
  chat.continuing?.abort();
}
/** A thread's brief asked to go again while its chat's turn runs, a message waits for it or room is made: it is no note into a turn, and waits in no queue. */
const BRIEF_AGAIN_LATER = "A thread's brief goes again once nothing runs or waits in its chat: Retry then";
/**
 * A way on asked of a message of Filament's that does not go again by it (labels.js `againOf`): a card's answer on the
 * first message of a chat Filament made for it, or on a watcher's wake that keeps nothing of who woke it (`once`);
 * Continue on of either, or of any watcher's wake — it sends a message again on another account, and a wake is none.
 */
const SENT_ONCE = "This message is Filament's own, sent for a run it started: it does not go again this way — Retry where its failure offers it, or start that run again where it started";
/**
 * A watcher's wake that failed, sent again by a way on (`againOf`'s `wake`; r-doors, 11-12: its Retry posted the wake's
 * words as the person's message, and the turn ran in the chat's own mode): Filament is asked for the watcher's run
 * again, by the turn's number — no word of the wake goes from the page, which Filament reads from the chat's own
 * record —, and the turn it starts comes as a watcher's does, by the chat's follow. True once it began; false where it
 * was refused, in the server's words (`refusal`), said where the chat is shown.
 * @param {any} chat @param {{ project: string, id: string, turn: number }} wake
 */
async function wakeAgain(chat, wake) {
  refusal = "";
  try {
    await api(`/space/${encodeURIComponent(wake.project)}/routines/${encodeURIComponent(wake.id)}/run`, { method: "POST", body: { again: wake.turn } });
    return true;
  } catch (e) {
    return refuse(errText(e), chatOf(state.currentId) === chat);
  }
}
/**
 * A turn's message sent again by a way on (Retry, a card's answers, Continue on), in the turn's own chat: its words and
 * the pictures and files that went with them (`againOf`), so a message of pictures alone goes again too — and the saved
 * agents' answers it overruled, so it overrules them as it did when first sent (the owner's of 11-01: only Not now kept
 * them). A turn read back from its record names them by the record's own fields, which are what the server reads.
 * A thread's brief goes again as the brief it was (`sendMessage`'s `brief`): Filament's block, with no words for the
 * page to read a command, a tag or a note from. A watcher's wake has no words to send: the answer that asks for it
 * asks its watcher's run again before it comes here (`sendAsked`, `wakeAgain`).
 * Answers the send, which settles once its turn has run — or at once, where it was refused — and false with nothing to
 * send. @param {any} chat @param {any} turn @param {Parameters<typeof sendMessage>[3]} [o]
 */
function sendAgain(chat, turn, o = {}) {
  const again = againOf(turn);
  if (again.brief) return sendMessage("", [], "normal", { ...o, replaces: turn, ...sendsIn(chat), brief: { block: again.brief, view: turn.brief } });
  const overrules = turn.overrules?.length ? { overrules: turn.overrules } : {};
  return again.text || again.attachments.length ? sendMessage(again.text, again.attachments, "normal", { ...o, ...overrules, replaces: turn, ...sendsIn(chat) }) : Promise.resolve(false);
}

/**
 * Words sent for the person from outside the box — a card's command, a decision's answer, a line from a sub-agent's view
 * to the main agent, a widget's command, Run as a flow, the Plan page's sentence, a Deny's words to a coding agent — and
 * Filament's own (a task's carry-on, Resume's "continue"), in the chat shown: where they are to wait (`sendMessage`'s
 * "queue": a message waits on the chat's row, a turn runs that takes no words now), they wait in the chat's queue as
 * words typed in the box do.
 * @param {string} text @param {{ ours?: boolean, allow?: boolean }} [o]  `allow`: a permission card's press, Allow (true)
 *   or Deny (false), which waits in the queue with its words
 */
async function sendOrQueue(text, o = {}) {
  const sent = await sendMessage(text, [], "normal", o);
  if (sent === "queue") {
    const answer = queuedAnswer(o);
    composer.enqueue([Object.keys(answer).length ? { text, files: [], ...answer } : text]);
  }
  return sent;
}

/**
 * The turn the header's Fork and its shortcut fork at: the chat's newest turn the session forks at (history.js
 * `forkable`: on record, ended with its answer) — one read from the transcript as much as one this page sent (a bare
 * past card is no turn). @param {any} chat
 */
function forkAt(chat) {
  return (chat?.turns || []).findLast((/** @type {any} */ t) => (!t.past || t.history) && forkable(t)) || null;
}

/**
 * Where an answer's message goes: its own chat, which need not be the one shown by the time it goes — a card's Compact
 * and send waits for its compaction, a minute and more, and the person may open another chat meanwhile. Shown, the
 * send is the composer's own; not shown, it goes as the queue of a chat not shown sends (`sendMessage`'s `chat`).
 * @param {any} chat
 */
const sendsIn = (chat) => (chatOf(state.currentId) === chat ? {} : { chat });
/**
 * Not now on the card that stopped a message before it was sent (the owner's of 11-01: "if we press Not Now on
 * compaction card then the message should not go in transcript. it should return back into composer with everything
 * like if file is attached that should also be back"): the message is on no record, so its row goes, as a way on that
 * sends it again takes it (`withoutAsked`), and the message is in the box again — its words as they were typed, its
 * pictures and files, the saved agents' answers it overruled — ahead of what the box holds. Its words kept as the
 * session's draft for a refresh (C33) stand in the box once the chat was opened again: as they were, they give way to
 * the words as typed; typed on, the box stays as the person left it — once, not twice. A chat it was the only message
 * of is drawn again, its Start with it, and named as it is again. False where the message is on record (a seed its
 * agent refused) or the chat is not shown: the card closes and the row stays.
 * @param {any} chat @param {any} turn
 */
function takeBackAsked(chat, turn) {
  const unasked = chatOf(state.currentId) === chat ? withoutAsked(chat.turns, turn) : null;
  if (!unasked) return false;
  chat.turns = unasked;
  // Nothing ran, so nothing finished: the left bar's Now, which listed it as needing you, lets it go home — before
  // anything draws the bar again, where the chat, asked no more, would stand as the open chat's row, "finished". A stop
  // heard while the page was out of sight marked the chat unread (`sayEnded`), which Done reads as finished: it is read.
  if (chat.chainId) {
    if (state.unreadChains.has(String(chat.chainId))) markRead({ id: String(chat.chainId) });
    sidebar.homeChat(String(chat.chainId));
  }
  if (unasked.length) transcript.dropTurn(turn);
  else drawChat(chat);
  const again = againOf(turn);
  const kept = again.text.trim();
  const box = composer.draft().trim();
  if (kept && box === kept) composer.setDraft("");
  // Typed on: the box goes on past them at a word's end — "ok" is not the start of "okay".
  const word = /[\p{L}\p{N}_]/u;
  const typedOn = !!kept && box.length > kept.length && box.startsWith(kept) && !(word.test(kept.at(-1) || "") && word.test(box[kept.length]));
  composer.takeBack(typedOn ? "" : turn.typed ?? again.text, again.attachments, turn.overrules);
  // The chat's name — the message may have been what named it — and the status under the box, which said the turn
  // stopped, read the chat as it is now.
  setTitle(chat);
  sidebar.drawOpen();
  paintStatus(chat);
  return true;
}
/**
 * The chats whose message a card stopped before it was sent, with the card's question and when it stopped: the left
 * bar's Now lists each as needing you, never as finished (the owner's of 11-01: "Now lists that chat under Done ·
 * finished, though nothing was sent"). A chat's newest turn alone: a way on, or Not now, takes the stopped one off. The
 * page at work for that message is said too, under Working (the review of 11-01): room made for it on its card's
 * Compact and send (`turn.makingRoom`), and the message gone again with its answer on its way (`turn.again`) — the
 * server holds no turn while room is made, nor before it hears the message.
 * @returns {Map<string, { line: string, at: number, working?: boolean }>}
 */
function askedChats() {
  /** @type {Map<string, { line: string, at: number, working?: boolean }>} */
  const out = new Map();
  for (const c of state.chats.values()) {
    const t = c.chainId ? c.turns?.at(-1) : null;
    if (!t) continue;
    const ask = askOf(t.reply?.errorBody, null);
    if (ask && t.makingRoom) out.set(String(c.chainId), { line: "making room", at: t.makingRoom, working: true });
    else if (ask) out.set(String(c.chainId), { line: askQuestion(ask), at: Number(t.askedAt) || Date.now() });
    else if (t.again && !t.reply && c.live) out.set(String(c.chainId), { line: t.again.line, at: t.again.at, working: true });
  }
  return out;
}
/**
 * The chats whose compaction is written between their turns — a Compact, /autofit —, and when it began: the left bar's
 * Now lists each under Working while it is (the owner's of 11-21: "when open a chat and compact this, then it should
 * move from project to Working section"). The server's word, every chat's (`state.compacting`); and this page's ask
 * before its first word comes (`compactAsked`), its start not said yet (0). Not the summary of Filament's copy alone
 * (C29), which nobody asked for, nor one at a turn's line, nor where this page's turn runs: the turn's row says it.
 * @returns {Map<string, { at: number }>}
 */
function compactingChats() {
  /** @type {Map<string, { at: number }>} */
  const out = new Map();
  for (const [chain, p] of state.compacting) {
    if (!p || p.door === "copy" || p.door === "line" || chatByChain(String(chain))?.live) continue;
    out.set(String(chain), { at: Number(p.since) || 0 });
  }
  for (const c of state.chats.values()) {
    if (c.chainId && !c.live && Number(c.compactAsked) > 0 && !out.has(String(c.chainId))) out.set(String(c.chainId), { at: 0 });
  }
  return out;
}
/**
 * The mark of a message a card stopped as it goes again, on the turn that takes its place (`turn.again`): Now says it
 * at work until the server's word of the turn comes — room was made for it, else it is sending.
 * @param {any} stopped
 */
function againMark(stopped) {
  return { at: Date.now(), line: stopped.makingRoom ? "making room" : "sending" };
}
/**
 * The card's Compact and send (HarnessV4_Tasks C26, U11): the way chosen on it (`choiceCompaction`), with the side model
 * picked there for this once; then the refused message again, past the cold question — the card was its answer — with a
 * switch's form (`carry`, A7). While room is made the turn says so (`makingRoom`), and the left bar's Now with it; an
 * answer that could not go answers false, or the words of why, and the card asks again.
 * @param {any} chat @param {any} turn @param {string | null} choice @param {{ model?: string } | null} once
 * @param {string | null} carry
 * @returns {Promise<boolean | string>}
 */
async function compactAndSend(chat, turn, choice, once, carry) {
  if (turnRunsIn(chat) || !chat.chainId) return false;
  const c = choiceCompaction(choice, once?.model ?? null);
  turn.makingRoom = Date.now();
  sidebar.refreshNow();
  /** @type {boolean | string} */
  let made = false;
  try {
    made = await compactSession(chat, c.method, c.way, c.once, { sending: true });
  } finally {
    if (made !== true) {
      turn.makingRoom = 0;
      sidebar.refreshNow();
    }
  }
  if (made !== true) return made || false;
  // The message goes again in the turn's place (`sendAsked`), or waits in the chat's queue. A send refused before it
  // took that place — another tab took the chat over while room was made — leaves the message where it was, its card's
  // question standing with why: room is made for it no more (the review of 11-01: Now said so until a reload).
  try {
    return await sendAsked(chat, turn, { sendAsIs: true, carry });
  } finally {
    if (turn.makingRoom && chat.turns.includes(turn)) {
      turn.makingRoom = 0;
      sidebar.refreshNow();
    }
    // Its message went, and what waited for the room goes at its turn's end; refused, what waited goes now.
    roomMade(chat);
  }
}
/**
 * A switch's handoff (the owner's of 11-08): the model that answered the chat's last turn writes its summary first —
 * Filament's by the loop's model, from its cache while it is warm; a coding agent's in its own session (the compaction
 * `by: "last"`) —, then the refused message goes past the card, the side switched to starting from the summary. While it
 * is written the turn says so (`makingRoom`), as Compact and send's does; one that could not be written answers the words
 * of why, and the card asks again.
 * @param {any} chat @param {any} turn @param {import("./conversation/interaction.js").Handoff} handoff
 * @returns {Promise<boolean | string>}
 */
async function handoffAndSend(chat, turn, handoff) {
  if (turnRunsIn(chat) || !chat.chainId) return false;
  turn.makingRoom = Date.now();
  sidebar.refreshNow();
  /** @type {boolean | string} */
  let made = false;
  try {
    made = await compactNow(chat, { ...(handoff.way === "summary" ? { method: "summary", once: { writer: "session" } } : { way: handoff.way }), by: "last", sending: true });
  } finally {
    if (made !== true) {
      turn.makingRoom = 0;
      sidebar.refreshNow();
    }
  }
  if (made !== true) return made || false;
  try {
    return await sendAsked(chat, turn, { sendAsIs: true });
  } finally {
    if (turn.makingRoom && chat.turns.includes(turn)) {
      turn.makingRoom = 0;
      sidebar.refreshNow();
    }
    roomMade(chat);
  }
}
/**
 * The compaction card brought up by `/compaction` (the owner's words of 10-18: "make a command to summon the compaction
 * card if i need to so that i don't have to wait for it to show up itself") and by the ring's Compact now… (proposal_ux
 * D6): the card that asks before a message, after the chat's last turn, with the chat's figures as the ring shows them
 * (`windowFace`) and the message typed after the word, which goes once room is made, or as it is. Brought up again, it
 * keeps a message it held where none came with the word. While a turn of Filament's loop runs and no message comes with
 * it, it asks to make room at the turn's next step (`midTurn`). A chat with no session has nothing to compact; a coding
 * agent's running turn compacts its own context, and a message waits for any turn to end: each says so, and the draft
 * goes back to the box. The card comes into sight.
 * @param {string} message @param {any[]} files
 */
function summonCompactionCard(message, files) {
  const chat = chatOf(state.currentId);
  if (!chat?.chainId) {
    toast("Nothing to compact yet: a chat has its session from its first message", "err");
    return false;
  }
  // A turn that waits for your answer — its question, a permission — is answered first: room made
  // between a question and its answer would be made inside that turn.
  if (asksYou(newestOnRecord(chat.turns))) {
    toast("Your agent's turn waits for your answer: answer it first, then bring the card up", "err");
    return false;
  }
  const midTurn = !!chat.live;
  if (midTurn && (message || files.length)) {
    toast("A turn is running in this chat — bring the card up with your message once it ends", "err");
    return false;
  }
  if (midTurn && (chat.live.runKind === "coding-agent" || codingAgentModel(chat.model))) {
    toast("A coding agent compacts its own context as it works — bring the card up once its turn ends", "err");
    return false;
  }
  if (chat.summoned?.work) {
    toast("The card is making room already", "err");
    return false;
  }
  // An outside client's chat: its client owns the history and compacts it (the ring offers no Compact now… there).
  if (isClientView(chat.view)) {
    toast("This chat is its client's: its client owns the history and compacts it", "err");
    return false;
  }
  const words = midTurn ? "" : message || chat.summoned?.message || "";
  const held = midTurn ? [] : message || files.length ? files : chat.summoned?.files || [];
  const face = windowFace(chat.view, composer.live());
  chat.summoned = {
    message: words,
    files: held,
    ask: { kind: "summoned", sends: !!(words || held.length), ...(midTurn ? { midTurn: true } : {}), tokens: face.known || face.tokens > 0 ? face.tokens : null, estimated: face.estimated || !face.known, window: face.window, usable: face.line?.tokens ?? null },
    work: null,
  };
  transcript.drawSummoned(chat, { reveal: true });
  return true;
}
/**
 * The session onto another account of its agent (HarnessV3-ACP AC3-7): its model becomes the same model on that
 * account (`modelOn`), as Continue on moves it, and nothing is sent; a chat with no session yet holds it for its
 * create call. Refused while a turn runs: the account in force is the one the turn spends.
 * @param {string} upstream
 */
async function switchAccount(upstream) {
  const chat = chatOf(state.currentId);
  const to = state.accounts.find((r) => r.upstream === upstream);
  if (!chat || !to) return;
  if (chat.live) {
    toast("Switch accounts once the turn ends: it runs on the account it started on", "err");
    return;
  }
  const name = modelOn(upstream);
  if (!name) return;
  if (chat.chainId) {
    if (!(await writeSessionSettings(chat, { patch: { model: { name } } }))) return;
  } else {
    composer.setModel(name);
    transcript.startChanged();
  }
  toast(`The next turn runs on ${accountName(to)}`);
}
/**
 * The page's accounts as the sign-in sheet and Settings → Coding agents read them (HarnessV3-ACP AC3-7).
 * @type {import("../lib/accounts.js").AccountKeeper}
 */
const accountKeeper = {
  rows: () => state.accounts,
  listen: (fn) => accountsHeard.on(fn),
  check: (upstream) => accountWord(upstream, "check").then(() => {}),
  keep: (row) => keepAccount(row),
};
/**
 * The sign-in sheet for an account (HarnessV3-ACP AC3-7); `then`, what it offers once signed in.
 * @param {string} upstream @param {{ label: string, run: () => void }} [then]
 */
const signInTo = (upstream, then) => void openSignIn(upstream, { keeper: accountKeeper, onToast: toast, then });
/** Settings → Coding agents' entries as the page keeps them (HarnessV3-ACP AC3-8): read while the section or an install sheet shows. */
const agentsKeeper = keepCodingAgents(onBus, () => api("/coding-agents"));
/** The install sheet for a coding agent (HarnessV3-ACP AC3-8). @param {string} id */
const installAgent = (id) => void openInstall(id, { agents: agentsKeeper, accounts: accountKeeper, signIn: (upstream) => signInTo(upstream), onToast: toast });

/**
 * A sheet that hands the welcome tour back as it closes (`back`): a tick later, and only where no other sheet took its
 * place — an install's Sign in closes the install's sheet and opens the sign-in's, which hands it back in turn.
 * @param {() => void} back
 */
const sheetThen = (back) => (/** @type {Parameters<typeof sheet>[0]} */ o) =>
  sheet({ ...o, onClose: () => { o.onClose?.(); setTimeout(() => { if (!document.querySelector(".zc-sheet-overlay")) back(); }, 0); } });
/**
 * The welcome tour (views/welcome.js, the owner's FTUE of 11-05), at the step it was left on: opened by itself while
 * nothing can answer, and once on a data folder whose harness has no chat yet (`tourOpensItself`); from the command
 * center, the help menu, Settings › General and `/welcome` at any time. Finished, skipped or closed, it is seen for the
 * data folder (`ui.welcome.seen`), in the app and a browser alike. Its first chat, its
 * folder and its examples start a chat as Ctrl+N and Open folder… do, on the model and in the folder it set.
 */
function openTour() {
  // Each step writes a setting, and a view-only device's page writes none (p4-view-ui); the chat alone runs none, by
  // any door (its chats are the desk's list's to start). One open is the tour: the tips' replay and the tour's own
  // opening may both ask for it as the page starts.
  if (viewOnlyPage() || CHAT_ONLY || document.querySelector(".wel-sheet")) return;
  openWelcome({
    step: stepAt(prefs.get("welcomeStep")),
    // Where a new chat starts now: Your work and Ready say it.
    folder: folderIn.value.trim(),
    agents: agentsKeeper,
    accounts: accountKeeper,
    signIn: (upstream, back) => void openSignIn(upstream, { keeper: accountKeeper, onToast: toast }, { sheet: sheetThen(back) }),
    install: (id, back) =>
      void openInstall(id, { agents: agentsKeeper, accounts: accountKeeper, signIn: (upstream) => void openSignIn(upstream, { keeper: accountKeeper, onToast: toast }, { sheet: sheetThen(back) }), onToast: toast }, { sheet: sheetThen(back) }),
    // Kept by the step's name: a step put in before it moves no tour left there (`stepAt`).
    onStep: (_i, id) => prefs.set("welcomeStep", id),
    onDone: () => void welcomeSeen(),
    // A chat not sent yet takes the model the tour set: a new one starts, as Ctrl+N's.
    onExample: (text) => {
      if (!chatOf(state.currentId)?.chainId) { pushNextAddress = true; newChat(); leaveScreen(); }
      composer.fill(text);
      composer.focus?.();
    },
    onStart: () => { pushNextAddress = true; newChat(); leaveScreen(); composer.focus?.(); },
    // Your work's folder: a chat starts in it, as Open folder…'s does — the screen under the tour left only as it
    // closes (Start your first chat): a new address now would close every overlay, the tour with them.
    pickFolder: (path) => (path ? Promise.resolve(path) : pickProjectFolder()).then((p) => { if (p) { pushNextAddress = true; newChat({ cwd: p }); } return p || null; }),
    folders: () => recentFolders(),
    onSettings: (section) => { location.hash = routeFor("settings", { section }); },
    // Your chats brought chats in: they are sessions now, and the sidebar lists them.
    onSessions: () => { sidebar.load(); },
    onToast: toast,
  });
}
/**
 * The first-run tips (coach/coach.js, the owner's FTUE of 11-09): bubbles beside the controls a newcomer meets, from the
 * tips' file the owner edits by hand (coach/coach.json). Their conditions are the page's: `subagent`, the chat shown has
 * an agent working for it; `context-half`, its context ring is half way to the compaction line.
 */
const coach = createCoach({
  api,
  onToast: (msg, kind) => toast(msg, kind),
  skipWords: () => keysIn("Tips are off. The command center (Ctrl+K) › Show tips again brings them back."),
});
coach.when("subagent", () => !!sessionChat() && subagentStore.rows().length > 0);
coach.when("context-half", () => {
  const c = sessionChat();
  const f = c ? windowFace(c.view, composer.live()) : null;
  return !!f?.line && f.fill != null && f.fill >= f.line.f / 2;
});
/**
 * The tips read (at the start, and as the events feed comes back from a restart): where the file replays them on each
 * start (`replayOnRestart`, the owner's switch for trying them out), the welcome tour opens again from its first step.
 * @param {any} a  GET /coach's answer
 */
function coachRead(a) {
  if (!a?.replayed || !a.replayWelcomeTour) return;
  state.config = { ...(state.config || {}), ui: { ...(state.config?.ui || {}), welcome: { ...(state.config?.ui?.welcome || {}), seen: false } } };
  prefs.set("welcomeStep", 0);
  openTour();
}

/** The tour seen, for the data folder: it opens by itself no more. */
async function welcomeSeen() {
  if (state.config?.ui?.welcome?.seen) return;
  try {
    await api("/config/fields", { method: "PATCH", body: { set: { "ui.welcome.seen": true } } });
    state.config = { ...(state.config || {}), ui: { ...(state.config?.ui || {}), welcome: { ...(state.config?.ui?.welcome || {}), seen: true } } };
  } catch {}
}

/** The longest a timer waits (2^31 − 1 ms, about 24.8 days): a reset further off is waited for in steps. */
const LONGEST_WAIT = 2_147_483_647;

/**
 * Resume at the reset (HarnessV3-ACP AC3-6): a second after `at`, "continue" goes out in the chat — at once where it is
 * open and idle, else through its queue (sent when its turn ends, or waiting there until it is opened again). A
 * countdown in this tab only; null lets it go — its card's Cancel, which stops what holds it too (`holdResume`). The
 * chat's limit cards say it as it stands, and once it fires the way it took (`resumeTook`): each offers none again —
 * given back where its "continue" is refused.
 * @param {any} chat @param {number | null} at
 */
function armResume(chat, at) {
  if (at != null && viewOnlyPage()) return void toast(VIEW_ONLY_REFUSED, "err");
  if (at == null && chat.resume?.held) chat.resume.stop?.();
  if (chat.resume) window.clearTimeout(chat.resume.timer);
  chat.resume = null;
  if (at != null) {
    const wait = at - Date.now() + 1000;
    const fire = () => {
      chat.resume = null;
      const here = chatOf(state.currentId) === chat && !chat.live;
      const took = resumeTook(chat, here ? "“continue” went at the reset" : "“continue” goes once this chat's turn ends");
      if (!here) return queueNext(chat, ["continue"], "The plan is free again — “continue” goes out when this turn ends");
      void sendOrQueue("continue", { ours: true }).then((sent) => {
        if (sent === false) resumeTook(chat, null, took);
        else if (sent === "queue") resumeTook(chat, "“continue” waits in this chat's queue", took);
      });
    };
    chat.resume = { at, timer: window.setTimeout(wait > LONGEST_WAIT ? () => armResume(chat, at) : fire, Math.max(0, Math.min(LONGEST_WAIT, wait))) };
  }
  transcript.paintResume(chat);
}

/**
 * The way the chat's countdown took (`armResume`), on its limit cards' turns (`limitTaken`): each card not yet taken
 * says it, in these words, and offers none again; null gives back the ones it took, its "continue" refused. → the turns
 * it took. @param {any} chat @param {string | null} said
 * @param {any[]} [took]  the turns it took: by default, the chat's limit cards' not yet taken
 */
function resumeTook(chat, said, took = (chat.turns || []).filter((/** @type {any} */ t) => t.facts?.limit && !t.limitTaken)) {
  for (const t of took) if (!t.limitTaken || t.limitTaken.by === "resume") t.limitTaken = said ? { by: "resume", said } : undefined;
  transcript.paintResume(chat);
  return took;
}
/**
 * A countdown held while a Continue on writes the session's model (`continueOn`): it sends nothing meanwhile, and the
 * card still says it — its Cancel lets it go, as an armed one's does, and stops the write that holds it (`stop`): no
 * clock ends that write, the person's Cancel does. @param {any} chat @param {() => void} [stop]
 */
function holdResume(chat, stop = () => {}) {
  if (!chat.resume) return;
  window.clearTimeout(chat.resume.timer);
  chat.resume = { at: chat.resume.at, timer: 0, held: true, stop };
}

/**
 * One of a Codex account's reset credits, once the person says so on the sheet: Codex's word on it after.
 * @param {string} upstream
 */
async function useResetCredit(upstream) {
  if (viewOnlyPage()) {
    toast(VIEW_ONLY_REFUSED, "err");
    return null;
  }
  const a = state.accounts.find((r) => r.upstream === upstream)?.account;
  const n = a?.resetCredits?.available || 0;
  const yes = await confirmDialog({
    title: "Use a reset credit?",
    description: `It resets ${a?.identity?.label || "the plan"}'s windows now — ${n === 1 ? "it's the last one" : `one of ${n}`}. A credit used can't be taken back.`,
    confirmLabel: "Use a reset credit",
  });
  if (!yes) return null;
  const r = await accountWord(upstream, "reset-credit");
  if (r) toast(resetOutcomeWords(r.outcome));
  return r ? String(r.outcome || "") : null;
}

// What the chat is doing (proposal_ux §4.2, D3): the status capsule in the header, or — Appearance's other choice — the
// panel floating over the chat. Both draw the same sections and do the same things.
/** @type {import("./conversation/status-panel.js").StatusIO} */
const statusIO = {
  onOpenPlan: () => views.show("plan"),
  onOpenChanges: () => rail.openTab("changes"),
  onGoal: (command) => { const c = chatOf(state.currentId); if (c) composer.fill(command); },
  // Hold acts at once, mid-round too: the box would steer a typed /goal hold into the running round as a note.
  onGoalHold: () => { const c = chatOf(state.currentId); if (c) void holdGoalNow(c); },
  onOpenTerminal: () => rail.openTab("terminal"),
  onStopTerminal: (id) => api(`/terminal/${encodeURIComponent(id)}/kill`, { method: "POST" }).catch((e) => toast(errText(e), "err")),
  onOpenSubagent: openSubagent,
  onStopSubagent: stopSubagent,
  onDetachSubagent: detachSubagent,
  onStopAgentTask: stopAgentTask,
  onOpenSide: () => views.show("side"),
  onStopCommand: (id, command) => void stopCommand(id, command),
  onCopyCommandOutput: (path) => {
    navigator.clipboard?.writeText(path).then(() => toast("Copied the path of its output's file"), () => toast(path));
  },
  onCommandsTick: () => void readCommands(chatOf(state.currentId), { tick: true }),
  onCancelComeBack: () => void cancelComeBack(),
};
const statusPanel = createStatusPanel(statusIO);
const statusCapsule = createStatusCapsule(statusIO);
shell.convFrame.append(statusPanel.el);
// A team in charge (team_v2_plan §10 O4; U13 W3): a band at the top of the chat, over every tab — "its crew is on the
// Agents tab" opens the team there, and Back to your agent goes through the switch's sheet.
const chargeBand = createChargeBand({
  open: () => views.show("team"),
  back: () => confirmSwitch(sessionChat()),
  wait: (chat) => switchWait(chat, subagentStore.rows()),
  own: () => !!besideStore.main(),
});
shell.convFrame.prepend(chargeBand.el);
// A flow's line in the header (HarnessV4_Flow_Plan §4.8): a press opens the flow on the Agents tab.
const flowStatus = createFlowStatus({ open: openFlowRow });
headerModule.statusSlot.append(flowStatus.el);
subagentStore.onChange(() => {
  paintStatus(chatOf(state.currentId));
  paintAgents();
  widgets.paint();
  paintDock();
  transcript.paintOrders();
  transcript.paintAgentEnds();
});
// The list says an agent has answered: what is held for it goes, whichever view shows — one the server refused waits
// for its thread's Send again — and the Sub Agents tab's list and badge follow.
subagentStore.onChange(() => {
  const chain = subagentStore.chainId();
  if (chain) for (const r of subagentStore.rows()) if (r.status !== "running" && heldAsks.of(chain, r.id)?.error === null) void heldAsks.settled(chain, r.id);
  views.pulse();
});

/**
 * A card's answer while a turn runs in its chat, or while a message waits on its row (`armWaiting`) — a card's message
 * goes once that one has gone (`sendMessage`): said, and the card is given back. @param {any} chat
 */
const turnRunsIn = (chat) => {
  if (chat.live) toast("A turn is running in this chat — answer the card once it ends", "err");
  else if (chat.waiting) toast("A message already waits for this chat — answer the card once that one has gone", "err");
  else if (compactingBetween(chat)) toast("A compaction is being written for this chat — answer the card once it is done", "err");
  return !!(chat.live || chat.waiting || compactingBetween(chat));
};

/**
 * A summoned card's message, sent past the card (`/compaction`'s Compact, or Send as it is): the words typed after the
 * word in the box, past the cold question (`sendAsIs`: the card was its answer). A turn running in the chat by the time
 * it goes — one begun while the compaction made room — takes it as no note: it waits for that turn's end in the chat's
 * queue, the card's answer with it, as a stopped message's does (`sendAsked`) — the chat's own queue where the chat is
 * not shown. A send the server refuses — a turn of the chat's own the page did not follow, a client's chat — puts it back
 * in the box it came from; where the chat is not shown, it waits first in that chat's queue, paused with the send's
 * words, never in a box nobody sees. The card is gone; nothing of the message is lost. (The send itself never holds
 * it: a message waiting on the chat's row refuses a Send as it is.)
 * @param {any} chat @param {{ message: string, files: any[] }} s @param {{ chat?: any }} [o]
 */
async function sendSummoned(chat, s, o = {}) {
  const it = { text: s.message, files: s.files, sendAsIs: true };
  if (chat.live) return queueNext(chat, [it], "A turn began in this chat meanwhile — your message waits in the queue, and goes when it ends");
  if ((await sendMessage(s.message, s.files, "normal", { sendAsIs: true, ...o, boxed: !o.chat })) !== false) return;
  if (chatOf(state.currentId) === chat) composer.takeBack(s.message, s.files);
  else awayBack(queueOf(chat), it, refusal, refusalAgain);
}

/**
 * A turn's message sent again by an answer on its row — a card's (the message it stopped), Retry's (a turn that
 * failed) —, the answer's own wait over where it had one: Compact and send's compaction, a minute and more; the way to
 * stop being asked's write. By then its chat may have moved on, as a card you brought up may have (`sendSummoned`). A
 * turn running in the chat by then — one begun meanwhile from the box, or by Resume — takes it as no note: it waits for
 * that turn's end in the chat's queue, whole, with what the card answered (`sendAsIs`, a switch's `carry`) and the saved
 * agents' answers it overruled, and a row on
 * no record gives way to it — as it does where such a turn begins while the chat is made ready for it. A send refused
 * before it goes — a message waiting on the chat's row, another tab writing the session, the session's model not
 * written for it, nothing of the message kept on the page — answers the words of why, said where the chat is shown, and
 * the row's card or Retry is given back, to be pressed again; one refused once it went (the page had lost its own
 * running turn, a client's chat) stands again on its row, its card with it. The send tells the moment its message goes
 * (`sendMessage`'s `went`); its own answer before then is what it came to. True where the message went or waits.
 * @param {any} chat @param {any} turn @param {{ sendAsIs?: boolean, carry?: string | null }} [o]
 * @returns {Promise<boolean | string>}
 */
async function sendAsked(chat, turn, o = {}) {
  const again = againOf(turn);
  // A watcher's wake goes again as its watcher's run, which waits in no queue: Filament says where its chat cannot
  // take it now. A message of Filament's that is never sent again (`once`) says so, whichever answer asked.
  if (again.wake) return (await wakeAgain(chat, again.wake)) || refusal;
  if (!again.text && !again.attachments.length && !again.brief) {
    refuse(again.once ? SENT_ONCE : "Nothing of this message can go again from here — what went with it is not kept on the page: send it again from the box", chatOf(state.currentId) === chat);
    return refusal;
  }
  // A thread's brief waits in no queue, whose messages go as the person's: it goes again once the chat's turn has ended.
  if (again.brief && chat.live) {
    refuse(BRIEF_AGAIN_LATER, chatOf(state.currentId) === chat);
    return refusal;
  }
  /** It waits for the running turn's end in the chat's queue — put there here, or by the send itself (`queued`) — and
   *  its row gives way. @param {boolean} queued */
  const waits = (queued) => {
    const unasked = withoutAsked(chat.turns, turn);
    if (unasked) {
      chat.turns = unasked;
      transcript.dropTurn(turn);
    }
    if (!queued) queueNext(chat, [{ text: again.text, files: again.attachments, ...(turn.overrules?.length ? { overrules: turn.overrules } : {}), ...(o.sendAsIs ? { sendAsIs: true } : {}), ...(o.carry ? { carry: o.carry } : {}) }], "A turn began in this chat meanwhile — your message waits in the queue, and goes when it ends");
    return true;
  };
  if (chat.live) return waits(false);
  /** @type {() => void} */
  let went = () => {};
  const going = new Promise((r) => (went = () => r(true)));
  const sending = sendAgain(chat, turn, { ...o, went });
  // A send that throws is refused in its words.
  void sending.catch((e) => refuse(errText(e)));
  // The message going out, or the send's answer before it did: refused — the chat made ready or not —, or a turn begun
  // in the chat while it was made ready ("queue"; another chat shown by then, the send queued it in its own chat).
  const first = await Promise.race([going, sending.catch(() => false)]);
  if (first === true) return true;
  if (first === false) return refusal || false;
  return waits(first !== "queue");
}

/** The words a new chat's box was given back from before, as they were: the Start says so until they change. */
let keptBack = "";
/**
 * Run on's reads of the machines (GET /api/remote-work/places), by folder: each kept `RUN_ON_KEPT_MS` for the chip, one
 * read at a time; a send reads them again.
 * @type {Map<string, { at: number, value: import("./lib/run-on.js").Places | null, p: Promise<import("./lib/run-on.js").Places | null> | null }>}
 */
const runOnReads = new Map();
const RUN_ON_KEPT_MS = 30_000;
/** A folder as Run on's reads key it. */
const runOnKey = folderKey;
/** The folder the chip reads the machines for: the one the chat shown's Works in names (run-on.js `worksInFolder`). @param {string} folder */
const runOnAt = (folder) => worksInFolder(chatOf(state.currentId)?.worksIn, folder);
/**
 * The machines a chat in the folder may run on, as this computer reads them — kept a moment, `fresh` asked again.
 * Null where they could not be read. @param {string} folder @param {boolean} [fresh]
 */
function runOnPlaces(folder, fresh = false) {
  const k = runOnKey(folder);
  const had = runOnReads.get(k);
  if (had?.p) return had.p;
  if (had && !fresh && Date.now() - had.at < RUN_ON_KEPT_MS) return Promise.resolve(had.value);
  const p = api(`/remote-work/places?folder=${encodeURIComponent(folder)}`)
    .then((r) => readPlaces(r))
    .catch(() => null)
    .then((value) => {
      runOnReads.set(k, { at: Date.now(), value, p: null });
      return value;
    });
  runOnReads.set(k, { at: had?.at || 0, value: had?.value ?? null, p });
  return p;
}
/** The chats at work on each other machine, as the desk's Now says them: Auto weighs them. @returns {Map<string, number>} */
function runOnRunning() {
  try {
    return new Map(sidebar.deskMachines().map((m) => [m.id, m.rows.works.length]));
  } catch {
    return new Map();
  }
}
/**
 * Run on's hooks for the Start (empty.js `RunOnHooks`): the draft's choice, held on it — the chat shown, before its first
 * send —; the machines; Settings › Remote access, where a machine's Run on is switched on.
 * @type {import("./conversation/empty.js").RunOnHooks}
 */
const runOnHooks = {
  on: () => {
    const c = chatOf(state.currentId);
    return !!c && !c.chainId && !c.making;
  },
  get: () => chatOf(state.currentId)?.runOn || HERE,
  set: (choice, name) => {
    const c = chatOf(state.currentId);
    // A send under way goes where it was sent.
    if (!c || c.chainId || c.runOnBusy) return;
    c.runOn = choice;
    c.runOnName = name;
    // Auto picked again picks afresh; the chip names what it picks, and the send holds to it.
    delete c.runOnSaw;
    // A chat started there whose message did not go is the person's, in the desk's list: another choice is no longer it.
    if (c.runOnStarted && c.runOnStarted.machine !== choice) delete c.runOnStarted;
  },
  // What Auto's chip names: a send whose pick, read anew, is another says so before anything goes.
  saw: (id) => {
    const c = chatOf(state.currentId);
    if (c && !c.chainId) c.runOnSaw = id;
  },
  places: (folder, fresh) => runOnPlaces(runOnAt(folder), fresh),
  known: (folder) => runOnReads.get(runOnKey(runOnAt(folder)))?.value ?? null,
  tried: (folder) => runOnReads.has(runOnKey(runOnAt(folder))) && !runOnReads.get(runOnKey(runOnAt(folder)))?.p,
  running: () => runOnRunning(),
  model: () => {
    try {
      return composer.modelName() || "";
    } catch {
      return "";
    }
  },
  settings: () => {
    location.hash = routeFor("settings", { section: "remote" });
  },
};
/**
 * A new chat's first message run on another machine (Run on, the remote desk's s2c): run-on.js `startThere`, with the
 * composer's model read as the send begins — the chip's machine, Auto's pick and a model missing there said before
 * anything goes —, then its clean clone, or a copy of this folder sent with your work, asked first; the chat started
 * there, the message sent, the chat opened in place. Until then the message is back in this chat's box, and why said;
 * where the person went to another chat meanwhile, its Start keeps it. The chip says where the draft runs after.
 * @param {any} chat @param {string} text @param {any[]} attachments
 * @returns {Promise<boolean | undefined>}  false, refused; undefined, it went, or the words wait for the chat
 */
async function runOnFirst(chat, text, attachments) {
  if (chat.runOnBusy) return refuse("Your chat is starting on another machine: send this in it once it opens");
  if (attachments?.length) return refuse("Run on sends your words alone with the first message: send it, then attach the files in the chat there");
  const folder = folderIn.value.trim() || chat.cwd || "";
  if (!folder) return refuse("Run on sends a project to the machine: choose its folder first");
  const call = /** @type {any} */ (globalThis).filamentMachines?.call;
  if (typeof call !== "function") return refuse("Run on starts a chat on another machine from the desktop app alone");
  const shown = () => chatOf(state.currentId) === chat;
  try {
    return await startThere(chat, { text, folder, model: composer.modelName() || "", tune: runOnTune(composer.effortValue(), composer.heldSettings(), chat.held) }, {
      places: (f) => runOnPlaces(f, true),
      running: () => runOnRunning(),
      shown,
      refuse: (words) => refuse(words),
      keep: (words) => keepStartWords(chat, words),
      toast,
      load: () => sidebar.load(),
      api,
      call: (/** @type {any} */ p) => call(p),
      allow: (/** @type {any} */ ask) => allowRunOnSend(ask),
      // Opened in place where the person still looks at this chat; else the desk's list has it.
      open: (m, chain) => (shown() ? sidebar.openOnMachine(m, deskRoute({ chain, thread: null })) : toast(`Your chat started on ${m.name}: it is in the list`)),
      // Its record read now: Bring back looks at the chat once its turn ends, however soon.
      recorded: () => sidebar.workStarted(),
    });
  } finally {
    if (shown()) transcript.refreshRunOn();
  }
}

/**
 * The person's yes before Run on sends a project (POST /api/remote-work's 409 `ask`, app/remote-work.js `WorkAsk`): the
 * machine, the project, how many files and how much, those in no commit (the first named), what stays here and why, and
 * the files Git LFS keeps, whose content stays here. Send alone sends it. @param {any} ask @returns {Promise<boolean>}
 */
function allowRunOnSend(ask) {
  const n = (/** @type {unknown} */ v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const bytes = n(ask?.bytes);
  const size = bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const list = (/** @type {unknown} */ v, /** @type {number} */ count) => {
    const all = Array.isArray(v) ? v.map(String) : [];
    const more = Math.max(0, count - Math.min(all.length, 6));
    return `${all.slice(0, 6).join(", ")}${more ? `, and ${more} more` : ""}`;
  };
  const fresh = n(ask?.freshCount);
  const left = Array.isArray(ask?.left) ? ask.left : [];
  const lines = [
    `${n(ask?.files)} files, ${size}, go to ${String(ask?.machine || "that machine")}, your uncommitted work with them, for your chat to work in there.`,
    fresh ? `${fresh} of them ${fresh === 1 ? "is" : "are"} in no commit here, and ${fresh === 1 ? "goes" : "go"} on your yes: ${list(ask?.fresh, fresh)}.` : "",
    left.length ? `What stays here: ${left.slice(0, 6).map((/** @type {any} */ l) => `${String(l?.path)} (${String(l?.why)})`).join("; ")}${left.length > 6 ? `; and ${left.length - 6} more` : ""}.` : "",
    n(ask?.lfs) ? `Git LFS keeps ${n(ask.lfs)} file${n(ask.lfs) === 1 ? "" : "s"} of it, whose content stays here: a build there that needs ${n(ask.lfs) === 1 ? "it" : "them"} fails.` : "",
    "Asked once for this project and machine, and again for a new file in no commit.",
  ].filter(Boolean);
  return new Promise((resolve) => {
    let answered = false;
    /** @param {boolean} yes */
    const answer = (yes) => {
      if (answered) return;
      answered = true;
      d.close();
      resolve(yes);
    };
    const d = dialog({
      title: `Send ${String(ask?.project || "this project")} to ${String(ask?.machine || "that machine")}?`,
      body: h("div", { class: "flex flex-col gap-2" }, ...lines.map((l) => h("p", {}, l))),
      actions: [
        { label: "Cancel", variant: "outline", onClick: () => answer(false) },
        { label: "Send", onClick: () => answer(true) },
      ],
      onClose: () => answer(false),
    });
  });
}

/** The other machines a project's repository is on too, by their names, as the desk lists their chats. @param {string} cwd */
function alsoOnMachines(cwd) {
  try {
    const k = runOnKey(cwd);
    const p = (state.projects || []).find((x) => runOnKey(x?.cwd) === k);
    const key = mergeKey(p?.remoteKey);
    return key ? sidebar.deskMachines().filter((m) => m.recent.some((c) => c.merge === key)).map((m) => m.name) : [];
  } catch {
    return [];
  }
}
/** The Space a chat in a folder works in, as the left bar knows it once it is made (`sidebar.spaceFor`). @type {(cwd: string) => { name: string, own: boolean } | null} */
let spaceForFolder = () => null;
const transcript = createTimeline(shell.convFrame, {
  // The Start says the Space its folder works in (the Designer's walk of 10-29).
  spaceOf: (cwd) => spaceForFolder(cwd),
  // The new chat's menu lists the machines the desktop app keeps, with their projects as the app reads them there; one
  // picked opens a new chat in that machine's page, in its folder (pk-list, the owner's of 11-10). Only the app's own
  // page has the bridge: a browser's, or another machine's page, lists none.
  ...(typeof /** @type {any} */ (window).filamentApp?.machineProjects === "function"
    ? {
        otherMachines: () => /** @type {any} */ (window).filamentApp.machineProjects(),
        ...(typeof (/** @type {any} */ (window).filamentApp.machineNames) === "function" ? { machineNames: () => /** @type {any} */ (window).filamentApp.machineNames() } : {}),
        openOn: (/** @type {string} */ machine, /** @type {string} */ cwd) => void /** @type {any} */ (window).filamentApp.openOn?.(machine, routeFor("home", { folder: cwd })),
      }
    : {}),
  // Run on (the remote desk's s2c): where a new chat runs, beside its project — the app's own page alone, whose desk
  // bridge starts a chat on another machine as this window's device there.
  ...(typeof (/** @type {any} */ (globalThis).filamentMachines?.call) === "function" ? { runOn: runOnHooks, alsoOn: (/** @type {string} */ cwd) => alsoOnMachines(cwd) } : {}),
  onFork: (chat, turn, opts) => forkModal(chat, turn, opts),
  // Rewind in place (the Designer's design of 10-27): Rewind on your message's hover and the files card's Undo open
  // the confirm; Undo on the rewind's line takes it back; Show them opens its turns, greyed.
  onRewind: (chat, turn, o) => rewindConfirm(chat, turn, o || {}),
  onUndoRewind: (chat) => void undoRewindIn(chat),
  onShowRewound: (chat, line) => {
    const shown = (chat.rewoundShown ||= new Set());
    if (shown.has(line)) shown.delete(line);
    else shown.add(line);
    drawChat(chat);
  },
  // A rewound line's "Open as a fork" (Step 3 D11): the row the route minted, opened like any other fork.
  onOpenFork: (chat, fork) => {
    openFork(chat, { ...fork, chainId: fork.chainId || fork.id });
  },
  // Retry while this chat's turn runs would go as a note into it, not as a new turn, and while a message waits on its
  // row it goes once that one has gone: said, and the Retry stands — as it does where the send refuses it (`sendAsked`).
  onRetry: (chat, turn) => {
    if (viewOnlyPage()) {
      toast(VIEW_ONLY_WORDS, "err");
      return false;
    }
    if (chat.live) {
      toast("This chat's turn is still running — Retry once it ends.");
      return false;
    }
    if (turnRunsIn(chat)) return false;
    return sendAsked(chat, turn);
  },
  // The card that asks before a message is sent (HarnessV4_Tasks C26; HarnessV3-Compaction §3.3, U3-6). Compact and
  // send: the way chosen on it (`choiceCompaction`) — a coding agent's own ("way:own", "way:self"), or one of the three
  // kinds, which in an agent's session run on Filament's copy — with the side model picked there for this once; then
  // the refused message again, past the cold question: the card was its answer. A switch's form goes with it (`carry`,
  // A7). An answer that could not go answers false, or the words of why — a compaction stopped or failed (U11), a send
  // refused (`sendAsked`) — and the card is given back with them on it.
  onCompact: (chat, turn, choice, once, carry) => compactAndSend(chat, turn, choice, once, carry),
  // A switch's card (HarnessV4_Tasks A7): the form chosen on it goes with the refused message again, and the fresh
  // session carries the turns in it; a send refused gives the card back with why (`sendAsked`). Into a model Filament
  // calls, Send as it is sends it past the card; on either, the handoff has the model that answered last write its
  // summary first (`handoffAndSend`, the owner's of 11-08).
  onSwitch: (chat, turn, form, ask) => {
    if (turnRunsIn(chat)) return false;
    if (form === "handoff" && ask?.switch?.handoff) return handoffAndSend(chat, turn, ask.switch.handoff);
    if (form === "send") return sendAsked(chat, turn, { sendAsIs: true });
    return sendAsked(chat, turn, { carry: form });
  },
  // A switch's card lists the forms its new session can carry, each weighed by the session's one preview
  // (`switchChoices`); one into a model Filament calls lists Send as it is and the handoff, weighed by the server.
  switchOptions: async (chat, ask) => {
    const s = ask.switch;
    if (sessionChat() !== chat || !chat.chainId || ask.kind !== "switched" || !s) return null;
    if (s.loop) return switchChoices(null, s);
    return composePreview().then((pv) => switchChoices(pv, s), (e) => (toast(errText(e), "err"), null));
  },
  // A lost session's card lists the forms its new session can carry, each weighed by the same preview
  // (`carryChoices`; the owner's of 11-06).
  carryOptions: async (chat, ask) => {
    if (sessionChat() !== chat || !chat.chainId || ask.kind !== "lost") return null;
    return composePreview().then((pv) => carryChoices(pv, ask), (e) => (toast(errText(e), "err"), null));
  },
  // The card's ways: the session's plan — the one cached preview, or one weighed with the side model picked on the
  // card — each way with what it leaves, costs and takes, the one the session chose or the cache favours recommended.
  askOptions: async (chat, ask, once) => {
    if (sessionChat() !== chat || !chat.chainId) return null;
    /** @type {any} */
    let pv = null;
    try {
      pv = await onceWeighed(chat, once);
    } catch (e) {
      toast(errText(e), "err");
      return null;
    }
    const plan = pv?.compaction;
    if (!plan?.native || !plan.methods) return null;
    const agentName = agentOf(chat.model)?.agentName || "The agent";
    return {
      // What the chat sends ahead changed, on its own card or a cold one: a compaction of Filament's is recommended.
      ways: askChoices({ plan, agent: !!plan.agent, agentName, now: Date.now(), chosen: sessionKind(chat.view), changed: ask.kind === "changed" || !!ask.changes?.length }),
      // The card's sentence names the agent that makes room, or starts fresh from Filament's summary (U11).
      ...(plan.agent ? { agentName } : {}),
      writable: true,
      same: String(plan.writers?.session?.model || ""),
      writer: String(plan.writers?.side?.model || ""),
    };
  },
  // The card's writer for this once: any model, a coding agent's among them, each under its own source.
  writerPicker: (onPick) => {
    const sel = createModelSelect({ onChange: onPick });
    sel.setModels(state.models || []);
    return { el: sel.el, set: (name) => sel.set(name) };
  },
  // Send as it is sends the words again past the cold question. The card's way to stop being asked switches off the
  // question it asked — a cold cache's (`context.compaction.resumeQuestion`), what the chat sends ahead changed
  // (`context.compaction.changeQuestion`), or a message that does not fit, which then makes room by itself
  // (`context.compaction.mode`) — says where to switch it back, and sends the words again once the switch is written,
  // as they are where it asked to send them so: a cold question that said what changed asks nothing more. Each sends
  // through `sendAsked`: a send refused gives the card back with why. A lost session's card sends the form picked on it
  // (`carry`).
  onSendAsIs: (chat, turn, carry) => {
    if (turnRunsIn(chat)) return false;
    return sendAsked(chat, turn, { sendAsIs: true, carry });
  },
  // A lost session's card sends the form picked on it with Just send too (the hunt of carry-card).
  onNeverAsk: async (chat, turn, kind, carry) => {
    const cold = kind === "cold" || kind === "lost";
    const changed = kind === "changed";
    if (turnRunsIn(chat) || !(await writeSessionSettings(chat, { patch: { context: { compaction: changed ? { changeQuestion: false } : cold ? { resumeQuestion: false } : { mode: "auto" } } } }))) return false;
    toast(changed ? "This chat no longer asks when what it sends ahead changed. Switch it back: How earlier turns are kept › After an update" : cold ? "This chat no longer asks when its cache is cold. Switch it back: How earlier turns are kept › Back after a break" : "This chat makes room by itself from now on. Switch it back: How earlier turns are kept › Then");
    return sendAsked(chat, turn, cold || changed ? { sendAsIs: true, carry } : {});
  },
  // The card `/compaction` brought up (the owner's words of 10-18). Compact: the way chosen on it, as the card that asks
  // before a message makes room, then the message it holds, past the cold question — the card was its answer. Send as
  // it is: the message, now. Dismiss: the message back in the box.
  onSummonedCompact: async (chat, choice, once) => {
    const s = chat.summoned;
    if (!s || !chat.chainId) return false;
    // Brought up while a turn ran: the turn folds its older rounds at its next step; one that ended meanwhile is
    // compacted as any chat between turns is, by the way chosen.
    if (s.ask.midTurn && chat.live) {
      if (!(await steerCompact(chat))) return false;
      if (chat.summoned === s) chat.summoned = null;
      transcript.drawSummoned(chat);
      return true;
    }
    // One that paused for your answer meanwhile is answered first: no room is made inside it.
    if (asksYou(newestOnRecord(chat.turns))) return "Your agent's turn waits for your answer: answer it first, then make room";
    if (turnRunsIn(chat)) return false;
    const c = choiceCompaction(choice, once?.model ?? null);
    const made = await compactSession(chat, c.method, c.way, c.once, { sending: s.ask.sends === true });
    if (made !== true) {
      roomNotMade(chat);
      return made || false;
    }
    if (chat.summoned === s) chat.summoned = null;
    transcript.drawSummoned(chat);
    // Its message goes first, and what waited for the room goes at its turn's end, as any queue does.
    if (s.ask.sends) {
      chat.roomWait = false;
      void sendSummoned(chat, s, sendsIn(chat));
    } else roomMade(chat);
    return true;
  },
  onSummonedSend: (chat) => {
    const s = chat.summoned;
    if (!s || turnRunsIn(chat)) return false;
    chat.summoned = null;
    transcript.drawSummoned(chat);
    void sendSummoned(chat, s);
    return true;
  },
  onSummonedDismiss: (chat) => {
    const s = chat.summoned;
    chat.summoned = null;
    transcript.drawSummoned(chat);
    if (s?.ask.sends && chatOf(state.currentId) === chat) composer.takeBack(s.message, s.files);
  },
  // Not now on the card that stopped a message before it was sent: the message back in the box, its row gone.
  onTakeBack: (chat, turn) => takeBackAsked(chat, turn),
  // Send without it (the filament-agent plan's D6, HarnessV3-FailurePoints §5.1 item 3): what the running turn waits
  // on — a summary Filament writes, memory's recall or capture — is let go, and the turn goes on at once. The button
  // leaves with the phase; a refusal says why (the wait ended meanwhile).
  onSkipWait: (chat) => {
    if (!chat.chainId) return;
    api(`/sessions/${encodeURIComponent(String(chat.chainId))}/wait/skip`, { method: "POST" }).catch((e) => toast(errText(e), "err"));
  },
  // A message the developer takes back from the running turn before its run took it (HarnessV4_Tasks C34).
  onSteerBack: (turn, s, edit) => void takeBackSteer(turn, s, edit),
  // A turn its agent's plan stopped (HarnessV3-ACP AC3-6): the limit card's ways on.
  accountRows: () => state.accounts,
  onContinue: (chat, turn, upstream) => continueOn(chat, turn, upstream),
  onContinueCancel: (chat) => stopContinue(chat),
  resumeAt: (chat) => chat.resume?.at ?? null,
  onResume: (chat, at) => armResume(chat, at),
  onResetCredit: (upstream) => useResetCredit(upstream),
  // A turn its agent's login refused (HarnessV3-ACP AC3-7): signed in on the sheet, the turn goes again from it.
  onSignIn: (upstream, resend) => signInTo(upstream, { label: "Send again", run: resend }),
  // The turn that asked points at the dock, where its decision stands (HarnessV3-Views V3).
  onPauseChange: () => paintDock(),
  onToDecision: () => decisions.focus(),
  // The lead's order rows take their workers' states from the session's list; a row brings its card (VW-D8).
  agentRows: () => subagentStore.rows(),
  agentRowsKnown: () => subagentStore.known(),
  agentLogged: (sub) => subagentStore.logged(sub),
  agentCard: (id, exchange) => subagentStore.card(id, exchange),
  onRevealAgent: (id) => views.reveal(id),
  onWatchRun: () => {
    rail.openTab("run");
  },
  // A turn's files card opens Changes on that turn, its file open (HarnessV4_Git_Plan GWC-37).
  onChanges: (turn, f) => {
    showChanges({ scope: "turn", turn, file: { path: f.path, place: f.place, agent: f.agent } });
    rail.openTab("changes");
  },
  // What a turn wrote outside any repository is Outputs' (HarnessV4_Four_Plan FO-D27, FO-D28).
  onOutputs: () => openOutputs(),
  onOutsideSeen: () => offerOutputs(),
  // "Explain this request" (HarnessV2 §10.5): the composition report for exactly this reply's request.
  onExplain: async (chat, turn) => {
    if (!turn.requestId) return;
    try {
      const report = await api(`/requests/${encodeURIComponent(turn.requestId)}/composition`);
      const d = dialog({ title: `How request ${turn.requestId} was composed`, wide: true, body: renderExplain(report), actions: [{ label: "Close", variant: "default", onClick: () => d.close() }] });
    } catch (e) {
      toast(errText(e), "err");
    }
  },
  onOpenPlan: () => views.show("plan"),
  // A card button (Facade FB): its command is chat text — the page sends it as the person's next message.
  onCommand: (chat, command) => {
    if (typeof command === "string" && command.trim()) void sendOrQueue(command.trim());
  },
  // Run as a flow (HarnessV4_OneAgent_Plan OA6): the press is the person's /flow with the words of the message the
  // agent offered it under — while a turn runs it waits in the queue, as a typed /flow does.
  onRunAsFlow: (chat, words) => {
    const text = `${FLOW_WORD} ${String(words || "").trim()}`;
    void sendOrQueue(text);
  },
  // A plan offered first (the owner's plan mode of 11-06): Plan is the person's /plan at the depth the card shows, the
  // message it plans the one right above — never sent again; Just do it, a plain go. The plan's card: Approve lets the
  // plan start, Amend puts /plan in the box for what to change.
  onPlanOffer: (chat, o) => {
    paintDock();
    void sendOrQueue(planSendText(o.depth));
  },
  onJustDo: () => void sendOrQueue(JUST_DO_TEXT),
  onApprovePlan: () => void sendOrQueue(PLAN_GO_TEXT),
  onAmendPlan: () => composer.fill("/plan "),
  // A chat the memory note names, as the sessions list holds it: its summary is the list's, never the record's.
  sessionRow: (id) => (state.sessions || []).find((/** @type {any} */ s) => s.id === id) || null,
  onAddLine: (line) => addLine(line),
  onUndoCompaction: (chat, b) => { undoCompactionIn(chat, Number(b.id)); },
  onMoveBack: (chat, b) => { void moveBackIn(chat, b); },
  // The Session inspector's place is Overview now (R1); a row that names its tab opens the sheet that holds it.
  onInspector: (chat, tab) => openOverviewAt(tab),
  getFolder: () => folderIn.value.trim(),
  setFolder: (p) => setChooserFolder(p),
  // The Start board (D15, HarnessV3-NewTask): the choice is held on the current, unborn chat until its first send.
  chatOf: () => chatOf(state.currentId),
  // The live line's "the turn reached Claude Code 17m ago" (proposal_ux §4.3): the chat's coding agent, by name.
  coderName: () => coderNameOf(chatOf(state.currentId)),
  onHeld: ({ patch }) => {
    const chat = chatOf(state.currentId);
    if (!chat || chat.chainId) return;
    chat.held = patch || {};
    // The picker shows the held changes' own mode — display only; with none, "New chats start in".
    const perm = chat.held["loop.permissions"];
    chat.heldPerm = typeof perm === "string" && perm ? perm : null;
    showStanding(chat);
  },
  onQuote: (text, kind) => composer.fill(`> ${kind}: ${text}\n\n`),
  // A visual's button, and its failure's Tell the agent (HarnessV4_Visuals_Plan VS-D7, VS-D8): the words go into the
  // message box, under what is there; only the person sends.
  onVisualAsk: (text) => composer.add(text),
  onVisualTell: (text) => composer.add(text),
  // A page the agent published opens in the side pane, in a tab of its own (HarnessV4_Artifacts_Plan AF-D35).
  onOpenArtifact: (name) => rail.openArtifactTab(name),
  onToast: (msg) => toast(msg),
  onPrompt: () => openPaneAt("run:calls"),
  // The Start board's view of the page (HarnessV3-NewTask NT-D6): the create body the first send would carry — the
  // same `sessionStartBody` ensureSession posts, over the folder chip and the composer's held choices — so the board
  // weighs exactly the session the send will create. With no folder chosen the send works in Everything (readySession),
  // and the board's ask says so (`outside`): the server weighs that folder without making it.
  start: {
    body: () => {
      const chat = chatOf(state.currentId);
      const folder = folderIn.value.trim() || chat?.cwd || "";
      if (!chat || chat.chainId) return null;
      const body = sessionStartBody(chat, folder, composer.modelName() || chat.model || lastModel(), "", composer.permissionMode?.() || "", composer.effortValue(), composer.heldSettings());
      return folder ? body : { ...body, outside: true };
    },
    text: () => composer.draft(),
    kept: () => !!keptBack && composer.draft() === keptBack,
    clearKept: () => {
      const c = chatOf(state.currentId);
      composer.setDraft("");
      if (c) saveDraft(c, "");
      keptBack = "";
    },
    viewOnly: () => viewOnlyPage(),
    permission: () => composer.permissionMode?.() || "",
    setPermission: (id) => {
      const chat = chatOf(state.currentId);
      composer.setPermissionMode(id);
      composer.setPermissionNote(null);
      // The picker's touch (D15), made from the board.
      if (chat && !chat.chainId) { chat.permTouched = true; chat.pickedPerm = id; }
    },
    models: () => state.models || [],
    families: () => state.families || [],
    teams: () => (teamsOn(state.config) ? teamsWhole : []),
    teamsOn: () => teamsOn(state.config),
    mainModel: () => composer.modelName() || chatOf(state.currentId)?.model || "",
    modelWords: () => composer.modelWords(),
    agentName: () => chosenAgent()?.agentName || "",
    // A task not started has no session: its rows are read over no running agent, with the model it would start on.
    poolFacts: (rows) => poolFactsOf(chatOf(state.currentId), rows),
    agents: () => ({ cards: agentCards.all(), asks: agentCards.asks(), find: (tag) => agentCards.find(tag) }),
    manageAgents: () => { location.hash = routeFor("library", { page: "agents" }); },
    manageMcp: () => { location.hash = routeFor("library", { page: "connectors" }); },
    manageSkills: () => { location.hash = routeFor("library", { page: "skills" }); },
    teamNames: (keys) => teamNames(keys),
  },
});

/** Overview's layout as you left it (prefs), or null for the default's. */
function overviewSaved() {
  try {
    const v = JSON.parse(String(prefs.get("overviewLayout") || "{}"));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
// Overview (proposal_ux §4.6): the chat's widgets as tiles in three bands, laid out as you left them — one layout for
// every chat. It draws once the widget context is built (`attach`, after the widgets mount).
const overview = createOverview({
  saved: overviewSaved,
  keep: (next) => { prefs.set("overviewLayout", JSON.stringify(next || {})); },
});

// The session's views (HarnessV3-Views VW-D1): the tabs in the header, and the Overview, Plan, Team and Sub Agents views
// in the frame after the transcript — a task's run log is the Run pane. The dock's
// decisions follow the view: in the Team view a worker's card asks, so its line leaves the dock.
const views = createViews({
  frame: shell.convFrame,
  slot: shell.header.viewsSlot,
  overview,
  openAgent: (id) => openSubagent(id),
  // A side run's change kept for the developer's Apply: its row in Changes, open on its Apply (10-28).
  reviewAgent: (id) => chipActions.reviewSubagent?.(id),
  // A chat being opened: the session's row waits for its transcript, which `hydrate` draws the views again after.
  opening: (c) => opening.has(c),
  openRunLog: () => rail.openTab("run"),
  // The Plan page's Run them in parallel (E41 P4 case 19): the person's own sentence, a steer while a turn runs —
  // queued where the turn takes no words now, as every send of the page's own is.
  send: (text) => { void sendOrQueue(text); },
  // Continue in a new chat (the owner's plan mode of 11-06, piece E): the chat forked at its newest turn, the plan
  // carried; and the chat a carried plan went on in.
  carryPlan: (chat, tasks) => {
    const turn = forkAt(chat);
    // The plan goes on from the chat's newest turn on record, as the session judges it (the review of 58cfe9b31): one
    // that failed or still runs has no answer to fork at.
    if (!turn || Number(turn.n) !== nextNumber(chat.turns) - 1) return toast("Nothing to fork yet: continue in a new chat once the chat's newest turn has its answer", "err");
    forkModal(chat, turn, { plan: tasks });
  },
  openChain: (id) => openChain(id),
  // Beside the chat (D12): the Plan as a pane in the right bar, one place at a time — held by the layout however the
  // panes stand, shown or hidden; in sight where it is on screen — in front in its tile, or the pane shown on top.
  besidePlan: {
    open: (o) => rail.openTab("plan", o),
    close: () => rail.close("plan"),
    shown: () => rail.holds("plan"),
    inSight: () => rail.front().includes("plan"),
    refresh: () => rail.refreshTab("plan"),
  },
  // The chat's task graph, live (the owner's of 11-04): its first graph opens the Plan beside the chat, a task done shows.
  planWatch: createPlanWatch(),
  // Work under way on the plan (the owner's of 11-10): the header's Plan button out of ⋯ while the Plan is out of sight.
  planWork: (words) => paneButtons?.works("plan", words),
  onShow: (chat) => { syncAddress(chat); paintDock(); },
  loadRun: (turn) => transcript.loadRun(turn),
  onPainted: (c) => { if (c === chatOf(state.currentId)) paintStatus(c); },
  team: {
    rows: () => subagentStore.rows(),
    face: () => windowFace(chatOf(state.currentId)?.view || null, composer.live()),
    model: () => baseModelOf(sessionChat()?.model || composer.modelName() || ""),
    // A worker runs on the agent loop, or as a coding agent (HarnessV3-ACP AC6-1): every model is one it can run on.
    models: () => state.models || [],
    account: (model) => agentOf(model),
    write: (change) => { const c = sessionChat(); if (c) writeSessionSettings(c, change); },
    open: (id) => openSubagent(id),
    stop: (id) => stopSubagent(id),
    sendBack: (id, fresh) => { sendTaskBack(id, fresh); },
    answer: (id, words) => answerWorker(id, words),
    always: (id, offer, ask) => alwaysWorker(id, offer, ask),
    message: (id, words) => messageWorker(id, words),
    back: () => confirmSwitch(sessionChat()),
    // What Back to your agent costs, once (team_v2_plan §10 O4): the conversation cached again, as the switch's sheet says.
    backCost: () => {
      const c = sessionChat();
      const held = c ? windowFace(c.view, composer.live()).tokens : 0;
      if (!(held > 0)) return null;
      const cost = rebuildCost(held, /** @type {any} */ (c?.view?.settings)?.price);
      return { tokens: held, usd: cost ? cost.usd : null };
    },
    home: {
      teams: () => sendable(sessionChat()?.view?.settings?.engine),
      model: () => baseModelOf(sessionChat()?.model || composer.modelName() || ""),
      seats: () => seatsOf(sessionChat()),
      brief: (fill) => openBriefNow(fill),
      newTeam: () => { agentsStart = "new-team"; location.hash = routeFor("library", { page: "agents" }); },
      library: () => { location.hash = routeFor("library", { page: "agents" }); },
      armed: () => { const c = sessionChat(); const a = c ? handOvers.get(String(c.chainId)) : null; return a ? { team: a.team, name: a.name } : null; },
      disarm: () => { const c = sessionChat(); if (c) disarmHandOver(String(c.chainId), true); },
    },
    beside: besideIO,
    // The chat's flows, each a row of the Agents tab, and the pane a flow's row shows (HarnessV4_Flow_Plan F5).
    flows: () => flowList.rows(),
    flow: flowPane,
    // Your agent's own work, drawn as a flow: the Agents tab's foot row and its pane (L47).
    work: workPane,
  },
  // The Sub Agents tab (HarnessV4_Tasks E15 step 5, U12): a thread is one agent asked by its tag, every choice of its
  // chips named.
  side: {
    rows: () => subagentStore.rows(),
    own: () => subagentStore.own(),
    chainId: () => subagentStore.chainId(),
    cards: () => agentCards.all(),
    // Start…'s teams (U13 W3): a team picked there opens its Brief, which starts it.
    teamsList: () => sendable(sessionChat()?.view?.settings?.engine),
    brief: (fill) => openBriefNow(fill),
    starts: () => sideStarts,
    // What a team picked there runs on, as its Brief would open: its own models, else its last run's picks here.
    runsOn: async (team, pick) => {
      const c = sessionChat();
      if (!c?.chainId || unbriefable(c)) return null;
      try { return await besideRoutes(String(c.chainId)).runsOn(team, pick); } catch { return null; }
    },
    lastPicks: (team) => picksOf(store.get(PICKS_PREF), team),
    seats: () => seatsOf(sessionChat()),
    facts: () => sideFacts(),
    readSizes: (patches) => readSideSizes(patches),
    // An agent runs on the agent loop, or as a coding agent: every model is one it can run on.
    models: () => state.models || [],
    families: () => state.families || [],
    accounts: () => state.accounts || [],
    pool: () => sidePoolOf(),
    poolFacts: (rows) => poolFactsOf(sessionChat(), rows),
    setPool: (rows) => { void writeSidePool(rows); },
    whoRuns: () => runsOnOf(),
    priceOf: (model) => {
      const at = locate(state.families, model);
      return at ? priceLine(at.family) : "";
    },
    // Said only once the chat's settings are read: before, nothing is known of its list (settingsRead).
    fallsToMain: () => {
      const s = chatOf(state.currentId)?.view?.settings;
      return settingsRead(s) && !poolRows(s.effective.subagents?.pool)[0].model;
    },
    launch: async (body) => {
      const chain = subagentStore.chainId();
      const row = await subagentRoutes(chain).spawn(body);
      // A start that brings its own question is Catch me up: the quiet line over the box has done its part, and its
      // answer stands open in the chat too (AG-207).
      if ("start" in body && sideStarts.some((s) => s.id === body.start && s.task)) {
        caughtUp(chain);
        const chat = chatOf(state.currentId);
        if (chat?.chainId === chain) (chat.cardsOpen ||= new Set()).add(`${row.id}:0`);
      }
      await subagentStore.refresh();
      return row;
    },
    enhance: (prompt, o) => subagentRoutes(subagentStore.chainId()).enhance(prompt, o),
    // A failed thread's Retry goes on in that thread (the owner's word of 10-24).
    retry: async (id) => {
      const row = await subagentRoutes(subagentStore.chainId()).retry(id);
      await subagentStore.refresh();
      return row;
    },
    cache: () => subagentStore.cache(),
    modelProblem: async (model) => String((await api(`/subagents/model-problem?model=${encodeURIComponent(model)}`))?.problem || "") || null,
    answer: (id, words) => answerWorker(id, words),
    always: (id, offer, ask) => alwaysWorker(id, offer, ask),
    mainDoor,
    beside: () => rail.front().map(parseThreadTabId).filter((x) => x != null),
    openBeside,
    stop: (id) => stopSubagent(id),
    remove: (d) => removeThread(d),
    mayAsk: () => mayAskOf(),
    chatParallel: () => chatParallelOf(),
    agentsOwn: () => agentsOwnOf(sessionChat()).length > 0,
    resetAgents: () => void resetChatAgents(),
    openLibrary: () => { location.hash = routeFor("library", { page: "agents" }); },
    held: heldAsks,
    toast,
    offered: { seen: () => store.get(SIDE_OFFERED) === "on", mark: () => store.set(SIDE_OFFERED, "on") },
  },
  // A done task's Hunt for bugs on the Plan tab (HarnessV4_DesignPass_Plan UX9), and the Reviewers sent to hunt from the
  // chat's tasks as the open session's list holds them: each task's box counts its own.
  hunt: {
    start: (t, model) => huntTask(t, model),
    hunters: (chainId) => (chainId && chainId === subagentStore.chainId() ? subagentStore.rows().filter((r) => !!r.hunts) : []),
    models: () => state.models || [],
    families: () => state.families || [],
    accounts: () => state.accounts || [],
  },
  // The side-run sheet's picker (10-28): the chat agent's own model first, then the composer's list, coding agents included.
  sideRun: {
    model: () => baseModelOf(chatOf(state.currentId)?.model || composer.modelName() || ""),
    models: () => state.models || [],
    families: () => state.families || [],
    accounts: () => state.accounts || [],
  },
  // The panes popped out on top (UX10): a tab each after Plan, the pane host's to draw.
  top: { el: rail.topFrame, list: () => rail.tops(), show: (id) => rail.showTop(id), back: (id) => rail.fromTop(id) },
});
// The Team tab paints again as the teams beside this chat move; the working ones' boards are followed.
besideStore.onChange(() => {
  const self = besideStore.self();
  const live = (/** @type {any} */ r) => r.state === "working" || r.state === "asking";
  boardStore.follow(besideStore.main() || besideStore.chainId() || "", [...besideStore.rows(), ...(self ? [self] : [])].filter(live).map((r) => r.id));
  views.drawTeam();
});
boardStore.onChange(() => views.drawTeam());

// The dock (the composer's grid) mounts into the conversation frame after the transcript's scroller and the views,
// inside the frame, below the scroll region.
shell.convFrame.append(shell.dock);

// A dotted path becomes the patch's nested document, the shape the settings writer takes. @param {string} path @param {any} value */
const setPath = (path, value) => path.split(".").reduceRight((v, k) => ({ [k]: v }), value);

const composer = createComposer(shell.dock, {
  getChat: () => chatOf(state.currentId),
  // A pane on top keeps no box under it (the owner's word of 10-24): words or the keys going to the box bring Chat.
  toBox: () => {
    if (topOf(viewOf(chatOf(state.currentId)))) views.show("chat");
  },
  // A queued message goes with what it answers and nothing more — a card's question, a waiting call's switch its row
  // held (`queuedAnswer`) — and the row it was sent by (`queuedVia`).
  onSend: (text, attachments, modifier, o) => sendMessage(text, attachments, modifier, { modeSwitch: o?.modeSwitch === true, queued: o?.queued === true, overrules: o?.overrules || [], sendAsIs: o?.sendAsIs === true, carry: o?.carry || null, boxed: o?.queued !== true, fresh: o?.queued !== true, via: o?.via || null }),
  whyRefused: () => ({ said: refusal, again: refusalAgain }),
  onStop: () => stopCurrent(),
  onForceStop: () => forceStopCurrent(),
  agentCards: () => agentCards.all(),
  // The box's @ list and + menu open a team's Brief (team_v2_plan §10 O5): its Send starts the team.
  teams: () => teamsOf(chatOf(state.currentId)),
  // A draft that opens with a team's name fills its ask (U13-D13); the box keeps the draft until the team starts.
  onBrief: (team, ask, typed) => openBriefNow(team ? { team, ...(ask ? { ask } : {}) } : {}, typed || ""),
  canBrief: () => !unbriefable(sessionChat()),
  // Why not, for a draft that opens with a team's name where none can be briefed (the line over the box says it).
  whyNoBrief: () => unbriefable(sessionChat()),
  askFacts: () => askFacts(),
  onAsk: (ask) => askAgents(ask),
  // `/btw <question>` (HarnessV4_Tasks E15 step 5, BW-16): the Sub Agents tab's Ask launch with these words, working or
  // idle; its thread shows, and the session's own send never hears of it.
  onSide: async ({ question, files }) => {
    try {
      const why = await views.side.ask(question, files);
      if (why) toast(why, "err");
      return !why;
    } catch (e) {
      toast(`Not asked: ${errText(e)}`, "err");
      return false;
    }
  },
  // `/compaction` (the owner's words of 10-18): the compaction card, brought up now, holding the message after the word.
  onCompactionCard: ({ message, files }) => summonCompactionCard(message, files),
  // `/craft <words>` (the owner's word of 10-27): a crafter chat of its own, in this chat's folder and with its model,
  // opened at once; this chat carries on, a turn running in it or not.
  onCraft: ({ words }) => openCrafter({ words }),
  // `/rewind` and Esc Esc in an empty box: the list of your messages to go back to (the Designer's §1).
  onRewind: () => void rewindList(),
  // `/welcome` on the chat alone sends nothing either: it says where the tour runs.
  onWelcome: () => (CHAT_ONLY ? toast(TOUR_CHAT_ONLY_WORDS) : openTour()),
  isFile: (word) => projectFileNamed(word),
  onAskDraft: (on) => { if (on) readAskSizes(); },
  onToast: (msg) => toast(msg),
  onOpenOverview: () => views.show("overview"),
  onLive: () => {
    widgets.paintLive();
    draftMoved();
    // The draft's estimate moved: an unborn chat's Start board weighs the message too (NT-D5).
    if (!chatOf(state.currentId)?.chainId) transcript.startChanged();
  },
  onHeldChange: () => transcript.startChanged(),
  // The controls are views of the session's settings (Facade D6): a change writes at once through the one
  // writer. A chat with no session yet holds the choice — the composer keeps it, the create call sends it.
  onSettingChange: async (path, value) => {
    const chat = chatOf(state.currentId);
    if (!chat) return;
    if (!chat.chainId) {
      // The picker's touch (D15); its "Use the default" takes the touch back, and the chip shows what the chat
      // stands on again: the held changes' mode, else "New chats start in".
      if (path === "loop.permissions") {
        chat.permTouched = value !== null;
        chat.pickedPerm = value === null ? null : String(value);
        if (value === null) showStanding(chat);
      }
      transcript.startChanged();
      return;
    }
    const wrote = await writeSessionSettings(chat, value === null ? { unset: [path] } : { patch: setPath(path, value) });
    if (!wrote || path !== "loop.permissions" || chatOf(state.currentId) !== chat) return;
    // A permission waits and the switch moved (HarnessV3-AtHome AH-F1): the switch is the answer — the waiting call is
    // judged again under the mode now in force. Not while a turn runs: its next call reads the mode by itself. A
    // worker's waiting call is answered by it too, the turn running or not (HarnessV3-Views V3).
    const mode = chat.view?.settings?.effective?.loop?.permissions;
    const answer = loopSwitchAnswer(chat, mode);
    if (answer) sendMessage(answer, [], "normal", { modeSwitch: true, ours: true });
    switchWorkers(mode);
    switchAgent(chat, mode);
  },
  // A model or tuning choice (HarnessV3 §15 item 92): the name and every setting it moves, as one change.
  onSettingsWrite: (change) => {
    const chat = chatOf(state.currentId);
    if (chat?.chainId) writeSessionSettings(chat, change);
  },
  onTakeOver: () => claimWriting("take"),
  // Whose plan the next turn spends follows the model chosen (HarnessV3-ACP AC3-6).
  onModel: () => accountsMoved(),
  onPlanDetails: () => widgets.show("account"),
  // The permission switch's Forget (HarnessV3-AtHome AH-D7): the row as listed goes to the server, which dismisses a
  // remembered permission (kept, never deleted) or takes a written rule off its layer; the answer is the document after.
  onForgetRule: async (rule) => {
    const chat = sessionChat();
    if (!chat) return;
    if (followsStill()) {
      toast(readOnlyWords(), "err");
      return;
    }
    try {
      const doc = await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/rules/forget`, { method: "POST", body: rule });
      applySessionView(chat, { settings: viewSettingsOf(doc) });
      toast("Forgotten — the agent asks again next time");
    } catch (e) {
      toast(errText(e), "err");
    }
  },
});
// The chat's status capsule, first in the strip under the box: in the header it was easy to miss (the owner's word of
// 10-29).
composer.status.append(statusCapsule.el);
// Where the chat works and what its branch holds that its base lacks, under the box too (the owner's of 10-30): the
// header reads them.
composer.place.append(shell.header.place);

// The cards moved, or the ticks on them: the box's line, the Sub Agents tab's foot rows, and an unborn chat's Start
// board, which weighs the tool those ticks add.
agentCards.onChange(() => {
  composer.meter();
  views.side.paint();
  if (!chatOf(state.currentId)?.chainId) transcript.startChanged();
});
agentCards.load();
void readTeams();

/**
 * A bug hunt on a done task of the Plan tab's graph (HarnessV4_DesignPass_Plan UX9), the Reviewer's: briefed on what the task did
 * (`huntBrief`), on the model picked — else its own — and its report delivered to the chat's agent, as any delivered
 * report goes: sealed while it works, with its next turn while it is stopped (UX-D8). Who started, or null where it did
 * not, said in a toast.
 * @param {any} t @param {string} model
 * @returns {Promise<{ agent: string, name: string, model: string } | null>}
 */
async function huntTask(t, model) {
  const chat = sessionChat();
  if (!chat?.chainId) return null;
  if (followsStill()) {
    toast(readOnlyWords(), "err");
    return null;
  }
  const brief = huntBrief(t);
  try {
    // Its range is its task's files (the plan's p6): the server reads each one's lines from git into the brief's head.
    const row = await subagentRoutes(String(chat.chainId)).spawn({ prompt: brief.prompt, description: brief.description, as: "reviewer", deliver: true, hunts: String(t.id), ...(brief.range.length ? { range: brief.range } : {}), ...(model ? { model } : {}) });
    void subagentStore.refresh();
    const name = row.card?.name || "Reviewer";
    toast(`${name} started on ${prettyModel(row.model)}: its findings come back to this chat`);
    return { agent: row.id, name, model: row.model };
  } catch (e) {
    toast(errText(e), "err");
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// A message that starts with a saved agent's tag (HarnessV4_Tasks E15 step 2): the line over the box says who gets it
// and what they are shown, and the send is one launch per tag — never the session's own send, its queue or the
// running turn's mailbox (L-94).
// ---------------------------------------------------------------------------------------------------
/** What each view would hand an agent in the open session, and the running turn's size: read when a draft becomes the
 *  agents', kept a short while. @type {{ chain: string, at: number, tokens: Record<string, number> | null, running: number }} */
let askSizes = { chain: "", at: 0, tokens: null, running: 0 };
const ASK_SIZES_MS = 20_000;
function readAskSizes() {
  const chain = String(chatOf(state.currentId)?.chainId || "");
  if (!chain || (askSizes.chain === chain && Date.now() - askSizes.at < ASK_SIZES_MS)) return;
  askSizes = { chain, at: Date.now(), tokens: askSizes.chain === chain ? askSizes.tokens : null, running: askSizes.chain === chain ? askSizes.running : 0 };
  // The line shows the views' sizes and the running turn's, never a change's: it waits for no patch.
  subagentRoutes(chain).views({ changes: false }).then((v) => {
    if (askSizes.chain !== chain) return;
    askSizes = { chain, at: Date.now(), tokens: v.tokens, running: Number(v.running?.tokens) || 0 };
    composer.meter();
  }, () => {});
}
// ---------------------------------------------------------------------------------------------------
// The Sub Agents tab's new thread (HarnessV4_Tasks E15 step 5): what a thread about to start would be shown, sized — the
// views and the running turn when the box shows, the two changes behind them, which git is read for — and the three
// shortcuts' rows, the server's table. Kept a short while, per session.
// ---------------------------------------------------------------------------------------------------
/** The browser's note that the offer to pick another model for a thread was used once. */
const SIDE_OFFERED = "harness.sideModelOffered";
/** @type {{ chain: string, at: number, patchesAt: number, tokens: Record<string, number> | null, forkable: boolean, running: number, rounds: number,
 *   patches: { turn: import("./lib/subagents.js").PatchSize, uncommitted: import("./lib/subagents.js").PatchSize } | null }} */
let sideSizes = { chain: "", at: 0, patchesAt: 0, tokens: null, forkable: false, running: 0, rounds: 0, patches: null };
/** The shortcuts' rows: the same in every session. @type {import("./lib/subagents.js").StartRow[]} */
let sideStarts = [];
const SIDE_SIZES_MS = 20_000;
/** @param {boolean} patches  the two changes' sizes too */
function readSideSizes(patches) {
  const chain = String(chatOf(state.currentId)?.chainId || "");
  if (!chain) return;
  if (sideSizes.chain !== chain) sideSizes = { chain, at: 0, patchesAt: 0, tokens: null, forkable: false, running: 0, rounds: 0, patches: null };
  const now = Date.now();
  if (now - (patches ? sideSizes.patchesAt : sideSizes.at) < SIDE_SIZES_MS) return;
  sideSizes = { ...sideSizes, ...(patches ? { patchesAt: now } : { at: now }) };
  subagentRoutes(chain).views({ changes: patches }).then((v) => {
    if (v.starts?.length) sideStarts = v.starts;
    if (sideSizes.chain === chain)
      sideSizes = { ...sideSizes, tokens: v.tokens, forkable: !!v.fork?.available, running: Number(v.running?.tokens) || 0, rounds: Number(v.running?.rounds) || 0, ...(patches && v.changes ? { patches: v.changes } : {}) };
    views.side.paint();
  }, () => {});
}
/**
 * A pool's rows as a launch would read them now, for the pool's editor (step 8): over the chat's running agents
 * where it is a session, with its main agent's model for the nameless row.
 * @param {any} chat @param {import("./lib/pool.js").PoolRow[]} rows
 */
function poolFactsOf(chat, rows) {
  return poolSeatsNow({ pool: rows, session: String(chat?.chainId || ""), main: baseModelOf(chat?.model || composer.modelName() || "") });
}

/**
 * The session's Agents on the side (AG-143, step 8; HarnessV4_Tasks E23-D6) — the value of `subagents.pool`, its
 * layer and the main agent's model — for the Agents tab's seats; null for a task
 * not started, whose Start board's card sets it.
 * @returns {{ rows: unknown, source: string, main: string } | null}
 */
function sidePoolOf() {
  const c = sessionChat();
  const s = c?.view?.settings;
  // Its settings not read yet (a turn's mark gave their hash alone): no seat, rather than the main agent's model.
  if (!c?.chainId || !settingsRead(s)) return null;
  return { rows: s.flat?.["subagents.pool"], source: String(s.sources?.["subagents.pool"] || "default"), main: baseModelOf(c.model || composer.modelName() || "") };
}

/**
 * The session's Agents on the side as an editor left them, or null to clear its own list.
 * @param {import("./lib/pool.js").PoolRow[] | null} rows
 */
async function writeSidePool(rows) {
  const c = sessionChat();
  if (!c?.chainId) return;
  const own = String(c.view?.settings?.sources?.["subagents.pool"] || "") === "session";
  if (!rows && !own) return void toast("This chat has no list of its own to drop: it already uses the default");
  // An order (U13-D15): each model's limit, on its row under its provider, holds how many run on it.
  if (!(await writeSessionSettings(c, rows ? { patch: poolPatch(c.view?.settings?.flat || {}, rows) } : { unset: ["subagents.pool"] }))) return;
  toast(`Agents in this chat run on ${poolLine(poolRows(c.view?.settings?.flat?.["subagents.pool"]), baseModelOf(c.model || composer.modelName() || ""))}`);
}

/**
 * This chat's own rows for its agents or its teams as Who runs on what left them (the owner's plan of 11-05), or null
 * where none is left: the whole map, written at once.
 * @param {"subagents.byCard" | "subagents.byTeam"} path @param {Record<string, any> | null} next
 */
async function writeChatRows(path, next) {
  const c = sessionChat();
  if (!c?.chainId) return;
  const key = path === "subagents.byCard" ? "byCard" : "byTeam";
  let wrote = false;
  await chatRowsAhead.write(`${c.chainId} ${path}`, next, async () => {
    wrote = await writeSessionSettings(c, next ? { patch: { subagents: { [key]: next } } } : { unset: [path] });
  });
  if (wrote) toast(next ? "This chat's agents run on its rows for them from their next start" : "Library's rows hold again in this chat");
  // Refused: painted again once its rows are no longer read ahead, as the server holds them (the review of 1cf449e2f).
  else applySessionView(c, { settings: {} });
}
/** This chat's rows for its agents or its teams written and not answered yet: a second edit builds on the first. */
const chatRowsAhead = rowsAhead();
/** This chat's rows for its agents or its teams: the newest written, else as its settings say. @param {string} path */
const chatRowsOf = (path) => {
  const c = sessionChat();
  return chatRowsAhead.read(`${c?.chainId} ${path}`, c?.view?.settings?.flat?.[path] ?? null);
};

/**
 * Who runs on what, on the Agents tab (widgets/runs-on.js): the chat's agents and teams, this chat's rows for them,
 * Library's, and its list for everyone else. Null for a chat whose settings are not read yet.
 * @returns {import("./widgets/runs-on.js").RunsOnIO | null}
 */
function runsOnOf() {
  const c = sessionChat();
  const s = c?.view?.settings;
  if (!c?.chainId || !settingsRead(s)) return null;
  return {
    cards: () => agentCards.all(),
    card: (tag) => agentCards.find(tag),
    teams: () => (teamsOn(state.config) ? teamsWhole : []),
    byCard: () => chatRowsOf("subagents.byCard"),
    byTeam: () => chatRowsOf("subagents.byTeam"),
    setByCard: (next) => { void writeChatRows("subagents.byCard", next); },
    setByTeam: (next) => { void writeChatRows("subagents.byTeam", next); },
    // What the server runs (the review of 11-05): the team in charge's lead is the main agent — not one that cannot lead,
    // whose turns go to the model —; a team beside takes this chat's list along only where it is its own; a Brief's pick
    // for the crew in charge comes first.
    leading: () => {
      const engine = sessionChat()?.view?.settings?.engine;
      return engine?.problem ? null : leadingTeam(engine)?.key ?? null;
    },
    ownList: () => String(sessionChat()?.view?.settings?.sources?.["subagents.pool"] || "") === "session",
    pick: () => {
      const flat = sessionChat()?.view?.settings?.flat || {};
      const model = String(flat["engine.teamWorkers"] || "");
      const effort = String(flat["engine.teamEffort"] || "");
      return model || effort ? { model, effort } : null;
    },
    everyone: () => sidePoolOf()?.rows,
    main: () => sidePoolOf()?.main || "",
    models: () => state.models || [],
    families: () => state.families || [],
    accounts: () => state.accounts || [],
    facts: (rows) => poolFactsOf(sessionChat(), rows),
    inherit: () => ({ level: sideFacts().defaultEffort, desc: "The main agent's effort, as this chat sets it" }),
  };
}

/** @returns {import("./lib/side.js").SideFacts} */
function sideFacts() {
  const chat = chatOf(state.currentId);
  const eff = chat?.view?.settings?.effective;
  const mine = !!chat?.chainId && sideSizes.chain === chat.chainId;
  const cache = subagentStore.cache();
  const main = String(composer.modelName() || chat?.model || lastModel() || "");
  return {
    // What a card that names no model runs on here: the seat of the session's pool a launch would take now, the
    // main agent's for its nameless row (AG-11, AG-233, AG-260).
    defaultModel: poolNext(poolRows(eff?.subagents?.pool), main, chat?.chainId ? subagentStore.nextSeat() : null),
    // How hard an agent launched with no effort thinks here (HarnessV4_Tasks U12-D7): as hard as the main agent (the
    // owner's word of 11-05).
    defaultEffort: SIDE_EFFORTS.includes(String(eff?.model?.effort)) ? String(eff.model.effort) : "model",
    // A live copy runs on the model of the request it copies.
    mainModel: String(cache.model || main),
    turnRuns: !!chat?.live || !!chat?.view?.holder,
    forkable: !!cache.forkable || (mine && sideSizes.forkable),
    warm: cache.state === "warm",
    tokens: mine ? sideSizes.tokens : null,
    runningTokens: mine ? sideSizes.running : 0,
    runningRounds: mine ? sideSizes.rounds : 0,
    patches: mine ? sideSizes.patches : null,
    limit: chat?.chainId ? subagentStore.limit() || null : null,
    seats: chat?.chainId ? subagentStore.seats() : null,
  };
}
/**
 * Whether the main agent works now, or waits for your answer: what a thread's "Send to main agent" reads.
 * @returns {{ live: boolean, paused: boolean }}
 */
function mainNow() {
  const chat = chatOf(state.currentId);
  return { live: !!chat?.live, paused: asksYou(newestOnRecord(chat?.turns)) };
}

/** @returns {import("./composer/ask-line.js").AskFacts} */
function askFacts() {
  const chat = chatOf(state.currentId);
  const mine = !!chat?.chainId && askSizes.chain === chat.chainId;
  return {
    // What a card that names no model runs on here: the seat of the session's pool a launch would take now, the
    // main agent's for its nameless row (AG-11, AG-233, AG-260).
    defaultModel: poolNext(poolRows(chat?.view?.settings?.effective?.subagents?.pool), String(composer.modelName() || chat?.model || lastModel() || ""), chat?.chainId ? subagentStore.nextSeat() : null),
    // A chat with no session yet has nothing to show an agent.
    tokens: chat?.chainId ? (mine ? askSizes.tokens : null) : {},
    running: !!chat?.live || !!chat?.view?.holder,
    runningTokens: mine ? askSizes.running : 0,
    limit: chat?.chainId ? subagentStore.limit() : null,
    refusedPictures: (model) => subagentStore.refusedPictures(model),
    families: poolFamilies(poolRows(chat?.view?.settings?.effective?.subagents?.pool), String(composer.modelName() || chat?.model || lastModel() || "")),
  };
}
/** Whether a word names a file of the open chat's project exactly: its path, or its name. @param {string} word */
async function projectFileNamed(word) {
  const cwd = chatOf(state.currentId)?.cwd || folderIn.value.trim();
  if (!cwd) return false;
  const r = await api(`/files/search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(word)}&limit=20`);
  const want = word.toLowerCase();
  return (Array.isArray(r?.files) ? r.files : []).some((/** @type {any} */ f) => {
    const path = String(f?.path ?? f ?? "").replace(/\\/g, "/").toLowerCase();
    return path === want || path.split("/").at(-1) === want;
  });
}
/**
 * Ask saved agents: one launch per tag, each blind to the others — all start, or none does (AG-3). The question's text
 * files go into it as a normal message's do, its pictures beside it; `changes` is the range the draft named
 * (`since:v1.2`), handed to each as a patch. False puts the draft back in the box; a text is what is left to ask (an
 * agent refused as the others started). `models`: one agent asked once on each of these (step 8, AG-241) — one
 * launch per model, all or none.
 * @param {{ tags: string[], question: string, changes?: string | null, files: any[], models?: string[] }} ask @returns {Promise<boolean | string | void>}
 */
async function askAgents({ tags, question, changes = null, files, models }) {
  let chat = chatOf(state.currentId);
  // A send goes where the field it was typed under says.
  if (!chat) chat = newChat({ cwd: folderIn.value.trim() });
  if (followsStill()) return refuse(readOnlyWords());
  // An agent asked is handed pictures and text: a PDF goes with a message to the chat.
  const pdf = files.find((a) => a.kind === "pdf");
  if (pdf) return refuse(pdfRefused(pdf.name));
  // A chat to run on another machine starts there with a message: agents are asked in it once it opens.
  if (!chat.chainId && (chat.runOn || chat.runOnBusy)) return refuse("Run on starts the chat there with a message: send your first message, then ask your agents in the chat there");
  // A chat with no session yet: the session is made as a first message makes it (AG-24). No message of it reaches the
  // main agent, so the question's first line is its name — and the page's list of its agents follows it from here.
  if (!chat.chainId) {
    const ready = await readySession(chat, { title: question.split("\n")[0].trim(), opens: true });
    if (!ready) return false;
    chat = ready.chat;
    if (chat.id === state.currentId) setTitle(chat);
    refreshStatus(chat);
    sidebar.load();
  }
  const texts = files.filter((a) => a.kind !== "image").map((a) => `\n\nFile: ${a.name}\n\`\`\`\n${a.text}\n\`\`\``).join("");
  const images = files.filter((a) => a.kind === "image").map((a) => ({ name: String(a.name || "picture"), mediaType: String(a.type || "image/png"), data: a.data }));
  const chain = String(chat.chainId);
  try {
    const out = await subagentRoutes(chain).ask({ prompt: `${question}${texts}`, as: tags, ...(models ? { models } : {}), ...(images.length ? { images } : {}), ...(changes ? { changes } : {}) });
    // The first agent asked shows beside the chat, where there is room: a send never opens the sheet over the chat.
    if (chatOf(state.currentId)?.chainId === chain) {
      await subagentStore.refresh();
      if (out.subagents[0]) showBeside(out.subagents[0].id);
    }
    if (!out.refused.length) return;
    toast(out.refused.map((r) => `@${r.tag}${r.model ? ` on ${prettyModel(r.model)}` : ""}: ${r.error}`).join(" · "), "err");
    // What is left to ask: the agents that did not start — one asked on several models is asked again as written.
    return `${[...new Set(out.refused.map((r) => `@${r.tag}`))].join(" ")} ${changes ? `${changes} ` : ""}${question}`;
  } catch (e) {
    subagentStore.refresh();
    return refuse(errText(e));
  }
}

// ---------------------------------------------------------------------------------------------------
// The dock's decisions (HarnessV3-Views VW-D1, VW-D6, V3): what waits for the developer stands over the composer, in
// whichever view shows — the session's own pause, each worker's question on one line.
// ---------------------------------------------------------------------------------------------------
const decisions = createDecisions({
  // The session's pause answered in words; none leaves the answer to the composer.
  answer: (chat, text) => { if (text) void sendOrQueue(text); else composer.focus(); },
  // The card's press goes with its message: Allow alone runs the call; Deny's words are the agent's to read.
  permit: (chat, a) => { void sendOrQueue(answerWords(a), { allow: a.allow }); },
  always: (chat, offer) => { void confirmOffer(chat, offer); },
  alwaysInChat: (chat, keeps) => { void keepInChat(chat, keeps); },
  workerAnswer: (id, words) => answerWorker(id, words),
  workerAlways: (id, offer, ask) => alwaysWorker(id, offer, ask),
  reveal: (id) => views.reveal(id),
  agentAnswer: (chat, ask, a) => answerAgent(chat, ask, a),
  agentPlan: (chat, ask, x) => planAgent(chat, ask, x),
  agentPermission: (chat, ask, x) => { void permitAgent(chat, ask, x); },
  open: (url) => { void openOut(url); },
  // A decision that appears takes the keys while the developer types nothing (HarnessV4_Tasks U1) — on a page that
  // answers: a view-only device's has no dock (paintViewOnly).
  keys: () => viewOnlyPage() ? null : dockKeys({ draft: composer.draft(), modal: !!document.querySelector('[aria-modal="true"]'), active: document.activeElement, body: document.body, box: composer.box }),
});
composer.asks.append(decisions.el);
// The flows that wait for you stand over the box, a draft whole (HarnessV4_Flow_Plan F5).
const flowDock = createFlowDock(flowIO, flowCards);
composer.asks.append(flowDock.el);
flowList.onChange(() => paintFlows());

// Catch me up (HarnessV4_Tasks E15 step 7, AG-206 and AG-207): the sessions that moved while nobody looked — marked
// unread when opened, or a turn of theirs ended while the window was hidden — get a quiet line over the box. Its button
// opens Catch me up in the Sub Agents tab, the question to the Reviewer in the box: Send asks it, and its card stands open in
// the chat (a press starts no agent — the owner's word of 10-18).
/** The sessions that moved while nobody looked. @type {Set<string>} */
const movedChains = new Set();
const catchUpLine = createCatchUp({
  onCatchUp: () => catchUp(),
  onDismiss: () => caughtUp(chatOf(state.currentId)?.chainId),
});
composer.asks.append(catchUpLine.el);
function paintCatchUp() {
  const id = chatOf(state.currentId)?.chainId || "";
  catchUpLine.paint(!viewOnlyPage() && !!id && movedChains.has(id));
}
/** Someone reads or writes the session: its line goes. @param {string | null | undefined} chainId */
function caughtUp(chainId) {
  if (!chainId || !movedChains.delete(chainId)) return;
  paintCatchUp();
}
/** Catch me up, ready to send: a new thread in the Sub Agents tab on its start, the server's question in the box. */
function catchUp() {
  if (chatOf(state.currentId)?.chainId) views.side.begin("catchup");
}
// Whoever types is caught up.
composer.box.addEventListener("input", () => caughtUp(chatOf(state.currentId)?.chainId));
// The crafter's line over the box (the owner's yes of 10-27): in a crafter chat, the way back to the chat /craft was
// typed in; in that chat, the crafters opened from it while they work or wait for you. From the sessions list, painted
// with the chat, when the list arrives, and when a run begins or ends.
const crafterLine = createCrafterLine({ onOpen: (id) => openChain(id) });
composer.asks.append(crafterLine.el);
function paintCrafterLine() {
  crafterLine.paint(craftLineOf(chatOf(state.currentId)?.chainId, state.sessions || [], {
    working: (id) => state.runningChains.has(id) || state.holders.has(id),
    waiting: (id) => state.pausedChains.has(id),
  }));
}
// The browser's line over the box (the owner's of 11-02): while the chat's agents drive its browser, who and what — its
// button opens the Browser pane, where the page shows live. Each chat's browser as Filament tells it (lib/browser-use.js).
// Painted with the chat, at each move of its browser, as a run begins or ends, as an agent of its starts or ends, as
// the page's own turn ends, and once more where it goes unless another call comes; its button goes while the Browser
// pane is in sight (the panes' onChange).
composer.asks.append(browserLine.el);
const browserUse = createBrowserUse({
  read: (chain) => api(`/sessions/${encodeURIComponent(chain)}/browser`),
  onMoved: (chain) => { if (!chain || chatOf(state.currentId)?.chainId === chain) paintBrowserLine(); },
});
onBus((msg) => browserUse.heard(msg));
subagentStore.onChange(() => paintBrowserLine());
/** @type {ReturnType<typeof setTimeout> | null} */
let browserLater = null;
/** When the paint armed is due: armed again only as that moves (the line is asked at each frame of a turn). */
let browserDue = 0;
function paintBrowserLine() {
  const chat = chatOf(state.currentId);
  const chain = chat?.chainId || "";
  // At work: its turn, or an agent of its that runs — one in the background after its turn ended drives it too. The
  // list of its agents counts only once it is this chat's and has answered.
  const agents = !!chain && subagentStore.chainId() === chain && subagentStore.known() ? subagentStore.running().length > 0 : null;
  const working = !!chain && (atWork(chain, chat) || agents === true);
  if (chain && !working && agents === false) browserUse.rests(chain);
  if (working) browserUse.want(chain);
  const line = chain ? browserLineOf(browserUse.of(chain), working, Date.now(), browserUse.restedAt(chain)) : null;
  browserLine.paint(line);
  // The header's Browser button out of ⋯ while the line stands and the pane is out of sight (the owner's of 11-10).
  paneButtons?.works("browser", line ? usingWords(line) : null);
  const due = line?.until || 0;
  if (due === browserDue) return;
  if (browserLater) clearTimeout(browserLater);
  browserDue = due;
  browserLater = due ? setTimeout(() => { browserLater = null; browserDue = 0; paintBrowserLine(); }, Math.max(0, due - Date.now()) + 50) : null;
}
// The envelopes' line over the box (the owner's of 11-02): the envelopes that wait sealed for the chat's agent, gone as
// it opens them. From the shown chat's list, which Filament says again at each seal and each opening (EN5).
const envelopeLine = createEnvelopeLine();
composer.asks.append(envelopeLine.el);
subagentStore.onChange(() => envelopeLine.paint(envelopeLineOf(subagentStore.envelopes())));
// The watchers' lines over the box (the plan of 11-11, its w8): a watcher that watches the chat shown, and one that
// wakes it, each a line with its press — Pause, Resume, or Open where several are behind it. From the chat's list,
// which its transcript brings and the events feed says whole at each change of its Space's routines (`setWatchers`).
const watchedLine = createWatchLine({ onPress: watchPress });
const watchingLine = createWatchLine({ onPress: watchPress });
composer.asks.append(watchedLine.el, watchingLine.el);
/** The guidance cards drawn in the chat shown (turn.js `guideCard`), each told when its watchers are said again. @type {Set<() => void>} */
const watchersHeard = new Set();
function paintWatchLine() {
  const list = chatOf(state.currentId)?.watchers || [];
  watchedLine.paint(watchLineOf(list, "watched"));
  watchingLine.paint(watchLineOf(list, "watches"));
  for (const heard of [...watchersHeard]) heard();
}
/**
 * A line's press, and a guidance card's. Pause and Resume are its watcher's own write, the one its row's switch sends:
 * the feed says the list again once its Space has it, and the line and the cards follow. Open goes to its Space's
 * Watchers.
 * @param {{ press: import("./conversation/watch-line.js").WatchLine["press"], of: { id: string, project: string } }} line
 */
async function watchPress({ press, of }) {
  if (press === "open") {
    location.hash = routeFor("space", { id: of.project, tab: WATCHERS });
    return;
  }
  try {
    await api(`/space/${encodeURIComponent(of.project)}/routines/${encodeURIComponent(of.id)}/pause`, { method: "POST", body: { paused: press === "pause" } });
  } catch (e) {
    toast(errText(e), "err");
  }
}
// A guidance card's hands (turn.js `guideHands`): the shown chat's watchers, as the lines over the box read them, each
// time they are said again, and the lines' own press for its Pause and Resume.
guideHands.watchers = () => chatOf(state.currentId)?.watchers ?? null;
guideHands.watch = (heard) => {
  watchersHeard.add(heard);
  return () => void watchersHeard.delete(heard);
};
guideHands.press = watchPress;
// A card the page says stands open before anyone touched it, kept with its chat.
chipActions.cardOpen = {
  get: (id, exchange) => chatOf(state.currentId)?.cardsOpen?.has(`${id}:${exchange}`) === true,
  set: (id, exchange, open) => {
    const chat = chatOf(state.currentId);
    if (!chat) return;
    if (open) (chat.cardsOpen ||= new Set()).add(`${id}:${exchange}`);
    else chat.cardsOpen?.delete(`${id}:${exchange}`);
  },
};
// The agents' cards the person hid, kept by this browser per chat (E37); the chat menu brings them back. A card hidden
// is its answer seen: the Agents tab counts it no more (the owner's of 11-01). One whose agent runs again stands, and
// says so: the chat menu's count leaves it out (the Hunter's of 11-01).
const closedCards = createClosedCards(store);
chipActions.cardClosed = {
  has: (id, exchange) => closedCards.has(chatOf(state.currentId)?.chainId, id, exchange),
  close: (id, exchange) => {
    closedCards.close(chatOf(state.currentId)?.chainId, id, exchange);
    views.side.seen(id, exchange);
  },
  standing: (row, id, exchange, on) => closedCards.standing(chatOf(state.currentId)?.chainId, row, id, exchange, on),
};

/**
 * The permission switch's words as the answer to the loop's waiting permission (HarnessV3-AtHome AH-F1), or null: none
 * while a turn runs — its next call reads the mode by itself — nor while a coding agent is the chat's model, which
 * answers no question of the loop's. @param {any} chat @param {string} mode
 */
const loopSwitchAnswer = (chat, mode) => (chat.live || coderNameOf(chat) ? null : switchAnswer(newestOnRecord(chat.turns), mode));

/**
 * The dock painted for the chat on screen, and the composer's words for who answers: a team's lead takes the
 * messages (VW-D8).
 */
function paintDock() {
  const chat = chatOf(state.currentId);
  const team = leadingTeam(chat?.view?.settings?.engine);
  // A coding agent the chat's model: the loop's question waits for Filament's agent, and nothing answers it here.
  const coder = coderNameOf(chat);
  decisions.paint({ chat, rows: chat?.chainId ? subagentStore.rows() : [], view: views.view, team, coder });
  // The turn's pointer to the dock says what the dock does, as the chat's model changes.
  transcript.paintPointers();
  // A team in charge that changes no file holds the chat to reading, whatever its mode: the mode chip says the mode in
  // force — in a team's own chat too, which has no Back to your agent.
  const reads = readingTeam(chat?.view?.settings?.engine);
  composer.setReading(reads ? { name: reads.name, own: !!besideStore.main() } : null);
  composer.setTeam({ lead: !!team && !team.problem, name: team?.name || "" });
  // The band says a team runs the chat, with Back to your agent (team_v2_plan §10 O4; U13 W3).
  chargeBand.paint(chat);
}

/**
 * Always allow in this project, chosen where the agent asks: the call's shape runs without asking in this project from
 * now on, and the permission switch lists it, with its Forget (HarnessV3-AtHome AH-D7). The memory item waiting for
 * the shape is confirmed; at a shape's first ask, none waits yet, and the session's route makes the rule
 * (HarnessV4_Tasks E3). True once the rule stands.
 * @param {any} chat @param {import("./lib/labels.js").Offer | null | undefined} offer @returns {Promise<boolean>}
 */
async function confirmOffer(chat, offer) {
  if (!offer?.shape || (!offer.itemId && !chat?.chainId)) return false;
  try {
    if (offer.itemId) await api(`/memory/items/${offer.itemId}`, { method: "POST", body: { status: "confirmed" } });
    else await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/rules/always`, { method: "POST", body: { tool: offer.tool, shape: offer.shape } });
    const what = offer.tool === "bash" ? offer.shape : `${offer.tool === "write" ? "writing" : "editing"} ${offer.shape === "(no extension)" ? "files without an extension" : `${offer.shape} files`}`;
    toast(`Always allowed in this project: ${what}. The permission switch lists it, with Forget`);
    refreshSessionDoc(chat);
    return true;
  } catch (e) {
    toast(errText(e), "err");
    return false;
  }
}

/**
 * Always allow in this chat, chosen where the agent asks (d-allow): the commands the card offered to keep run without
 * asking in this chat from now on — the server reads each again before it keeps it —, and the permission switch lists
 * them, each with its Forget. True once they are kept; a refusal is said, and the command's Allow still runs it once.
 * @param {any} chat @param {import("./lib/labels.js").Keeps | null | undefined} keeps @returns {Promise<boolean>}
 */
async function keepInChat(chat, keeps) {
  if (!keeps?.commands?.length || !chat?.chainId) return false;
  try {
    const said = await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/rules/always`, { method: "POST", body: { keeps } });
    toast(keptToast(Array.isArray(said?.kept) && said.kept.length ? said.kept : keeps.commands));
    refreshSessionDoc(chat);
    return true;
  } catch (e) {
    toast(errText(e), "err");
    return false;
  }
}

/**
 * A permission's answer as the words that go with it: Deny's own, else "yes" or "no" for the transcript. The press
 * (`allow`) decides; nothing reads these for a yes.
 * @param {import("./conversation/interaction.js").PermissionAnswer} a
 */
function answerWords(a) {
  return a.words || (a.allow ? "yes" : "no");
}

/**
 * A worker's waiting call answered, from its card or its line in the dock: Allow runs it, Deny answers it Not run in
 * its words; a question another machine's chat asks, by its choice (`a.choice`) or the person's words. True once the
 * server took the answer; a refusal is said, and the controls come back. `a.ask`: the number of the ask its card drew,
 * which the answer settles alone.
 * @param {string} id @param {import("./conversation/decisions.js").WorkerAnswer} a
 * @returns {Promise<boolean>}
 */
async function answerWorker(id, a) {
  const chainId = subagentStore.chainId();
  if (!chainId) return false;
  try {
    await subagentRoutes(chainId).answer(id, answerWords(a), { allow: a.allow, ask: a.ask, choice: a.choice ?? null });
    await subagentStore.refresh();
    return true;
  } catch (e) {
    toast(errText(e), "err");
    return false;
  }
}

/**
 * Your words to a working worker, past its lead (HarnessV4_Tasks decision 10): it reads them at its next step, and its
 * lead is told; the toast says when each hears them. True once it took them; else the toast says why not.
 * @param {string} id @param {string} words @returns {Promise<boolean>}
 */
async function messageWorker(id, words) {
  const chainId = subagentStore.chainId();
  if (!chainId) return false;
  try {
    const out = await subagentRoutes(chainId).message(id, words);
    toast(toldWords(subagentStore.rows().find((r) => r.id === id) || { id }, out));
    return true;
  } catch (e) {
    toast(errText(e), "err");
    return false;
  }
}

/** A worker's Always allow: the rule for its call's shape made, then the call answered yes — the ask its card drew.
 *  @param {string} id @param {import("./lib/labels.js").Offer} offer @param {number | null} ask @returns {Promise<boolean>} */
async function alwaysWorker(id, offer, ask) {
  const chat = sessionChat();
  return !!chat && (await confirmOffer(chat, offer)) && (await answerWorker(id, { allow: true, words: "", ask }));
}

/**
 * A coding agent's question answered on its run (HarnessV3-ACP AC2-4): "" once the run took the answer, else why not —
 * an answer that doesn't fit the question, a question no longer waiting, a tab that only follows the session.
 * @param {any} chat @param {any} ask  the run's `ask` event @param {any} a @returns {Promise<string>}
 */
async function answerAgent(chat, ask, a) {
  const runId = String(ask.runId || chat?.live?.runId || "");
  if (!runId) return "This turn's run is gone, so its question can't be answered";
  try {
    await api(`/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body: { ask: ask.id, ...a } });
    return "";
  } catch (e) {
    return errText(e);
  }
}

/**
 * A coding agent's request the session's switch asked about, answered (HarnessV3-ACP AC3-2): Allow runs it once, Deny
 * keeps it from running. An agent's permission takes no words, so Deny's go to the agent as the person's message too —
 * into its running turn where it takes one, else queued for the turn's end.
 * @param {any} chat @param {any} ask  the run's `ask` event @param {{ allow: boolean, words: string }} x
 */
async function permitAgent(chat, ask, { allow, words }) {
  const why = await answerAgent(chat, ask, { outcome: "answered", answers: { permission: { chosen: [allow ? "allow" : "deny"], ...(words ? { words } : {}) } } });
  if (why) {
    toast(why, "err");
    return;
  }
  if (!allow && words) await sendOrQueue(words);
}

/**
 * A coding agent's plan answered with one of its own ways on (HarnessV3-ACP AC3-3): "" once the run took it, else why
 * not. A yes under Read-only first moves the switch to Ask before changes, as the card says: Read-only would refuse
 * every edit the plan needs. A way to keep planning ends the agent's turn, so the person's words with it go as their
 * next message once it has ended.
 * @param {any} chat @param {any} ask  the run's `ask` event @param {{ choice: string, words: string }} x
 * @returns {Promise<string>}
 */
async function planAgent(chat, ask, { choice, words }) {
  const way = (ask.form?.questions?.[0]?.choices || []).find((/** @type {any} */ c) => c.id === choice);
  const back = /^reject/i.test(String(way?.kind || ""));
  if (!back && chat.view?.settings?.effective?.loop?.permissions === "read-only" && !(await writeSessionSettings(chat, { patch: setPath("loop.permissions", "ask") })))
    return "The switch stayed at Read-only, so the plan wasn't answered";
  const why = await answerAgent(chat, ask, { outcome: "answered", answers: { permission: { chosen: [choice] } } });
  if (!why && words) queueNext(chat, [words], `${ask.form?.agent || "The agent"} keeps planning — your words go to it next`);
  return why;
}

/**
 * The permission switch moved while a coding agent's requests wait on it (HarnessV3-ACP AC3-2, AH-F1): each is judged
 * again under the mode now in force — one it settles ends, one it still asks about waits on. A switch to Ask settles
 * none; a request answered meanwhile is not waiting any more, and the server's refusal of it is no news.
 * @param {any} chat @param {string | null | undefined} mode
 */
function switchAgent(chat, mode) {
  if (!switchWords(mode)) return;
  for (const a of newestOnRecord(chat.turns)?.waiting || []) if (a.form?.judged) void answerAgent(chat, a, { outcome: "switched" });
}

/**
 * The permission switch moved: each worker's waiting call is judged again under the mode now in force (AH-F1, V3) —
 * a call answered meanwhile is not waiting any more, and the server's refusal of it is no news. A worker's question to
 * its lead asks for no permission (HarnessV3-TaskGraph-v2 TG2-D49): the switch leaves it be.
 * @param {string | null | undefined} mode
 */
function switchWorkers(mode) {
  const words = switchWords(mode);
  const chainId = subagentStore.chainId();
  const asking = subagentStore.rows().filter((/** @type {any} */ r) => r.status === "running" && yourAsk(r.progress));
  if (!words || !chainId || !asking.length) return;
  const routes = subagentRoutes(chainId);
  Promise.allSettled(asking.map((/** @type {any} */ r) => routes.answer(r.id, words, { modeSwitch: true }))).then((out) => {
    const failed = out.find((x) => x.status === "rejected" && !/409/.test(errText(x.reason)));
    if (failed?.status === "rejected") toast(errText(failed.reason), "err");
    subagentStore.refresh();
  });
}

// ---- the Brief (team_v2_plan §10 O1) -------------------------------------------------------------------------------
/** The models of a chat's list, in order: its team crews run on them (U13-D14). @param {any} c @returns {string[]} */
function seatsOf(c) {
  const s = c?.view?.settings || {};
  return poolRows(s.flat?.["subagents.pool"]).map((r) => String(r.model || "")).filter(Boolean);
}
/** The Brief open now: one at a time. @type {{ close: () => void } | null} */
let briefOpen = null;
/**
 * Why no team can be briefed from this chat now, else null: a chat not yet begun has none to work with, and a team's own
 * chat keeps its team — a team is briefed from its main chat (found by the Bug Hunter, 10-19).
 * @param {any} chat
 */
function unbriefable(chat) {
  if (!teamsOn(state.config)) return TEAMS_OFF;
  if (!chat?.chainId) return "A team works with a chat: send this chat's first message, then brief a team";
  if (besideStore.main() || besideStore.knownChat(String(chat.chainId))) return "This is a team's own chat: brief a team from its main chat";
  return null;
}

/**
 * A team's Brief, over the chat on screen, filled as a press asks: the Teams tab's Brief… and Send a team…, Verify…,
 * Who runs this chat's teams, a draft that opens with the team's name (U13-D13). Opening it starts nothing; its Send
 * does.
 * @param {import("./views/brief.js").BriefFill} [fill] @param {string} [typed]  the draft that opened it, which leaves
 *   the box once the team starts
 */
function openBriefNow(fill = {}, typed = "") {
  const chat = sessionChat();
  const why = unbriefable(chat);
  if (why || !chat) {
    toast(why || "", "err");
    return;
  }
  briefOpen?.close();
  const chain = String(chat.chainId);
  /** @returns {any} */
  const settings = () => chat.view?.settings || {};
  // The team started: the draft that opened its Brief leaves the box, where the box still holds it.
  const started = () => {
    if (!typed || chatOf(state.currentId) !== chat || composer.draft().trim() !== typed.trim()) return;
    composer.setDraft("");
    saveDraft(chat, "");
  };
  briefOpen = openBrief({
    teams: () => { const e = settings().engine; return Array.isArray(e?.teams) ? e.teams : []; },
    chat: () => {
      const s = settings();
      const turns = chat.turns || [];
      const tokens = Number(windowFace(chat.view || null, chatOf(state.currentId) === chat ? composer.live() : null).tokens) || 0;
      return {
        title: chat.title || "",
        model: baseModelOf(chat.model || composer.modelName() || ""),
        live: !!chat.live,
        round: Number(chat.live?.turn?.aligned?.maxRound) || null,
        paused: asksYou(ownLast(turns)),
        workersAtWork: subagentStore.rows().some((/** @type {any} */ r) => r.team && r.status === "running"),
        tokens,
        compactions: compactionCount(turns),
        turns: turns.filter((/** @type {any} */ t) => !t.command).length,
        cost: rebuildCost(tokens, s.price),
        agentEffort: SIDE_EFFORTS.includes(String(s.effective?.model?.effort)) ? String(s.effective.model.effort) : "model",
      };
    },
    models: () => state.models || [],
    families: () => state.families || [],
    accounts: () => state.accounts || [],
    seats: () => seatsOf(chat),
    reads: async (team, model) => { try { return await besideRoutes(chain).reads(team, model); } catch { return null; } },
    preview: async (team, model) => {
      try {
        return String((await besideRoutes(chain).reads(team, model, true))?.text || "");
      } catch (e) {
        toast(errText(e), "err");
        return null;
      }
    },
    runsOn: async (team, pick) => { try { return await besideRoutes(chain).runsOn(team, pick); } catch { return null; } },
    fire: async (body) => {
      const out = await besidePress((r) => r.fire(body));
      if (!out?.team) return false;
      started();
      toast(`The ${out.team.team.name} works on the side of this chat`);
      views.side.open(sideTeamItem(String(out.team.id)));
      return true;
    },
    handOver: async (o) => {
      const ok = await handOver(chat, o);
      if (ok) started();
      return ok;
    },
    stopTurn: () => { if (chatOf(state.currentId) === chat) void stopCurrent(); },
    usd: (n) => usd(n),
  }, fill);
}

/**
 * The hand-overs that wait for a chat's running turn to end, by chat (team_v2_plan §10 O1, decision 2): kept with the
 * tab, so a reload keeps them and a closed window takes them, as it takes a chat's draft. One goes while its chat is
 * on this window's screen (`lookAtHandOvers`).
 * @type {Map<string, { team: string, name: string, words: string, workers: string | null, workersEffort?: string | null }>}
 */
const handOvers = new Map();
const HANDOVER_KEY = "filament.handovers";
try {
  for (const [k, v] of Object.entries(JSON.parse(sessionStorage.getItem(HANDOVER_KEY) || "{}"))) handOvers.set(k, /** @type {any} */ (v));
} catch {}
const keepHandOvers = () => {
  try {
    sessionStorage.setItem(HANDOVER_KEY, JSON.stringify(Object.fromEntries(handOvers)));
  } catch {}
};
/** @type {any} */
let handOverTimer = null;
/**
 * A waiting hand-over's words back in its chat's box, as its draft (state.js `saveDraft`): the hand-over that held them
 * does not go — the person cancelled it, or its write was refused as it fired — and they are the person's to send or
 * to drop. What the box holds stays, after them.
 * @param {string} chain @param {string} words
 */
function handOverWordsBack(chain, words) {
  if (!String(words || "").trim()) return;
  const shown = String(chatOf(state.currentId)?.chainId || "") === chain;
  const had = shown ? composer.draft() : draftFor({ chainId: chain });
  const draft = had && !had.startsWith(words) ? `${words}\n\n${had}` : had || words;
  saveDraft({ chainId: chain }, draft);
  if (shown) composer.setDraft(draft);
}
/**
 * A waiting hand-over taken off: fired, or its chat gone — or cancelled (`said`), whose words go back to the chat's box:
 * by the person, or by Settings › Experimental's Teams switch, off (`off`).
 * @param {string} chain @param {boolean} [said] @param {boolean} [off]
 */
function disarmHandOver(chain, said = false, off = false) {
  const had = handOvers.get(chain);
  handOvers.delete(chain);
  handOverAsked.delete(chain);
  keepHandOvers();
  if (!handOvers.size && handOverTimer) {
    clearInterval(handOverTimer);
    handOverTimer = null;
  }
  if (had && said) {
    handOverWordsBack(chain, had.words);
    toast(off
      ? `The ${had.name} does not take over: teams are off in Settings › Experimental (Teams), and your words are back in its chat's box`
      : `The ${had.name} does not take over: your agent keeps this chat, and your words are back in its box`);
  }
  views.drawTeam();
}
/** Settings › Experimental's Teams switch as the page last drew it: off, its default, until the configuration lands. */
let teamsWere = false;
/** Whether the configuration has landed, so the switch is known: a waiting hand-over waits for it (`lookAtHandOvers`). */
let teamsHeard = false;
/**
 * The configuration landed or was read again (src/ui/lib/teams-on.js). With its Teams switch off, a hand-over waiting for
 * a turn's end is taken off, its words back in its chat's box — one kept across a reload too, which the page restored
 * before it knew the switch. Where the switch moved, what offers a team is drawn again — the left bar's Library row, the
 * Agents tab, the Start board, the Library's page where it shows.
 */
function teamsSwitched() {
  const on = teamsOn(state.config);
  teamsHeard = true;
  if (!on) for (const chain of [...handOvers.keys()]) disarmHandOver(chain, true, true);
  if (on === teamsWere) return;
  teamsWere = on;
  sidebar.teamsSwitched();
  views.drawTeam();
  views.side.paint();
  transcript.startChanged();
  const route = parseRoute(location.hash);
  if (booted && route.kind === "library" && route.page === "agents") applyRoute(route);
}
/** When each waiting hand-over's chat was last asked after, off screen. @type {Map<string, number>} */
const handOverAsked = new Map();
/** How often a waiting hand-over's chat off screen is asked after: one deleted elsewhere takes its hand-over with it. */
const HANDOVER_ASK_MS = 60_000;
/**
 * The waiting hand-overs looked at: one whose chat is on screen and free goes now — its words back in the chat's box
 * where its write is refused —; one whose chat is on no screen of this window waits for it to be opened here; one whose
 * chat is gone — deleted in another tab or the console — goes with it (found by the Bug Hunter, 10-19: it stayed for
 * good, its timer ticking). None goes before the configuration lands: Settings › Experimental's Teams switch is not
 * known until then.
 */
function lookAtHandOvers() {
  if (!teamsHeard) return;
  for (const [chain, o] of [...handOvers]) {
    const chat = chatOf(state.currentId);
    if (!chat || String(chat.chainId) !== chain) {
      if (Date.now() - (handOverAsked.get(chain) || 0) < HANDOVER_ASK_MS) continue;
      handOverAsked.set(chain, Date.now());
      void api(`/sessions/${encodeURIComponent(chain)}/settings`).catch((e) => {
        if (/404/.test(errText(e)) && handOvers.has(chain)) disarmHandOver(chain);
      });
      continue;
    }
    if (switchWait(chat, subagentStore.rows())) continue;
    disarmHandOver(chain);
    void handOverNow(chat, o).then((went) => { if (!went) handOverWordsBack(chain, o.words); });
  }
}
const armHandOvers = () => {
  if (!handOverTimer && handOvers.size) handOverTimer = setInterval(lookAtHandOvers, 2000);
};
armHandOvers();

/**
 * In charge's Send: the team leads the chat, and the person's words are its lead's first message — now, or once the
 * running turn (and its workers) are done. → "now", "after", or false where it could not.
 * @param {any} chat @param {{ team: string, words: string, workers: string | null, workersEffort?: string | null }} o
 * @returns {Promise<"now" | "after" | false>}
 */
async function handOver(chat, o) {
  const t = (chat.view?.settings?.engine?.teams || []).find((/** @type {any} */ x) => x.key === o.team);
  const name = String(t?.name || o.team);
  const wait = switchWait(chat, subagentStore.rows());
  if (wait && asksYou(ownLast(chat.turns))) {
    toast(wait, "err");
    return false;
  }
  if (wait) {
    handOvers.set(String(chat.chainId), { ...o, name });
    keepHandOvers();
    armHandOvers();
    toast(`The ${possessive(name)} lead takes over when this turn ends, with this chat open in this window — your words go to it first`);
    views.show("team");
    views.drawTeam();
    return "after";
  }
  return (await handOverNow(chat, { ...o, name })) ? "now" : false;
}

/**
 * The hand-over done: the chat's engine set to the team — its workers' model and how hard they think where the Brief
 * picked them — then the words sent as its lead's first message.
 * @param {any} chat @param {{ team: string, name: string, words: string, workers: string | null, workersEffort?: string | null }} o
 */
async function handOverNow(chat, o) {
  const patch = {
    // Its workers' model for this run, else the team's own: an earlier run's is not kept (U13-D8) — the pick comes
    // before the team's own models and the chat's list; the chat's list stays as it is.
    engine: { mode: "team", team: o.team, teamWorkers: o.workers || null, teamEffort: o.workersEffort || null },
  };
  const from = leadingTeam(chat.view?.settings?.engine)?.key ?? null;
  const wrote = await writeSessionSettings(chat, { patch });
  if (!wrote) return false;
  markEngine(chat, from, o.team);
  // The words are its lead's first message, sent from the chat on screen. A chat left while the team was set, or a
  // send refused, keeps them in its box for the person's Send: never lost, never said sent (found by the Bug Hunter).
  const shown = chatOf(state.currentId) === chat;
  if (shown) views.show("chat");
  const sent = shown ? await sendMessage(o.words, [], "normal", { boxed: true }) : false;
  if (sent === false || sent === "queue") {
    saveDraft(chat, o.words);
    if (chatOf(state.currentId) === chat) composer.setDraft(o.words);
    toast(`The ${possessive(o.name)} lead leads ${shown ? "this" : "that"} chat now — your words wait in its box: Send gives them to it`);
    return true;
  }
  toast(`The ${possessive(o.name)} lead runs this chat now: Back to your agent is on the band at its top`);
  return true;
}

/**
 * A switch of who answers, marked after the chat's newest turn at once, as the server marks it (Bug Hunter #13): the
 * divider and "Leading for" read it before the page reads the chat again, where the server's mark takes its place.
 * @param {any} chat @param {string | null} from @param {string | null} to  a team's key, null for your agent
 */
function markEngine(chat, from, to) {
  const last = newestOnRecord(chat?.turns);
  if (!last || from === to) return;
  last.boundariesAfter = [...(last.boundariesAfter || []), { type: "engine", from, to, at: Date.now(), afterTurn: last.n }];
  if (chatOf(state.currentId) === chat) widgets.paint();
}

/**
 * The chat given back to your agent (VW-D5), confirmed on a sheet: the conversation carries over whole, and the
 * provider's cache rebuilds once — its price when the window's figure and the price card are known. The switch waits
 * for the session to be idle (switchWait), asked again here, as the sheet opens on what may have changed. A team takes
 * a chat from its Brief (`handOver`), never from here.
 * @param {any} chat
 */
function confirmSwitch(chat) {
  if (!chat?.chainId) return;
  const wait = switchWait(chat, subagentStore.rows());
  if (wait) {
    toast(wait, "err");
    return;
  }
  const s = chat.view?.settings || {};
  const held = windowFace(chat.view, composer.live()).tokens;
  const cost = rebuildCost(held, s.price);
  const go = async () => {
    d.close();
    const from = leadingTeam(chat.view?.settings?.engine)?.key ?? null;
    // What a Brief picked for a crew is its run's alone (U13-D8): your agent back drops it.
    const wrote = await writeSessionSettings(chat, { unset: ["engine.mode", "engine.team", "engine.teamWorkers", "engine.teamEffort"] });
    if (wrote) markEngine(chat, from, null);
    if (wrote) toast("Your agent answers from your next message");
  };
  const d = dialog({
    title: "Back to your agent?",
    description: "Your agent reads the whole conversation and answers from your next message. What the workers finished stays on their cards.",
    body: group(h,
      row(h, {
        icon: "refreshCw",
        iconColor: "var(--color-sys-orange)",
        label: "The cache rebuilds once",
        sub: held > 0 ? `${tok(held)} tokens of this conversation, written to the cache again` : "This conversation is written to the cache again",
        ...(cost ? { value: `≈ ${usd(cost.usd)}` } : {}),
      })),
    actions: [
      { label: "Cancel", variant: "outline", onClick: () => d.close() },
      { label: "Back to your agent", onClick: () => { void go(); } },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------
// The widgets (HarnessV3 Step 4 D8): one context object, and the layout mounted into the slots the composer and the
// header offer. A widget reads the session view, the page's shared lists and the composer's live figures, and acts
// only through this object — it never fetches, and it never holds a chat of its own.
// ---------------------------------------------------------------------------------------------------
/** The open chat when its session exists — every widget action is about that session. */
const sessionChat = () => {
  const c = chatOf(state.currentId);
  return c?.chainId ? c : null;
};
/**
 * The conversation state a compose preview answers for: the chain, the settings hash, the turns that have ended and the
 * epoch a compaction moves. A running turn is in the chat's list from its start and counts at its end, when what the
 * next request holds has moved: counted from its start, a preview read while it ran was served again after it, a turn
 * behind (the open Context section read "sends 55.4K now" after a turn that left 76K, live drive of 2026-10-11).
 * @param {any} c
 */
const previewKeyOf = (c) => `${c.chainId}|${c.view?.settings?.hash || ""}|${(c.turns || []).length - (c.live ? 1 : 0)}|${previewCache.epoch}`;
/**
 * The compose preview, one cached answer per conversation state (Step 6 §2.2 Context/Strategies/Compaction;
 * `previewKeyOf`), so a settings write or a turn's end serves a fresh compose while an open popover keeps its figure
 * until the host repaints it. A widget never fetches (D17) — the host does, once per state, and every widget reads
 * the same answer.
 * @returns {Promise<any | null>}
 */
function composePreview() {
  const c = sessionChat();
  if (!c) return Promise.resolve(null);
  const key = previewKeyOf(c);
  if (previewCache.key === key) {
    if (previewCache.data) return Promise.resolve(previewCache.data);
    if (previewCache.promise) return previewCache.promise;
  }
  previewCache.key = key;
  previewCache.data = null;
  // A slow fetch that outlives its state (a turn ended, a setting moved) must not land its answer under the
  // newer key — the guard holds the cache to the state it was asked for.
  const asked = key;
  // The compactor's plan rides the one preview (HarnessV3-Compaction §6): every way of making room, weighed.
  previewCache.promise = /** @type {Promise<any>} */ (api(`/sessions/${encodeURIComponent(String(c.chainId))}/compose?dry=1&compaction=1`))
    .then((p) => { if (previewCache.key === asked) previewCache.data = p; return p; })
    .catch((e) => { if (previewCache.key === asked) previewCache.promise = null; throw e; });
  return previewCache.promise;
}
/** @type {{ key: string, promise: Promise<any> | null, data: any | null, epoch: number }} */
const previewCache = { key: "", promise: null, data: null, epoch: 0 };

/**
 * The compose preview without the compactor's plan, one per conversation state (`previewKeyOf`): what the Next request
 * pane weighs — the parts, the window, the line and the turns. The plan weighs every way of making room, which takes a
 * long chat over a minute (220 turns: 85 s, against 0.6 s without it); the pane needs none of it, so it takes the full
 * preview where that has landed for the state, else this one.
 * @returns {Promise<any | null>}
 */
function plainPreview() {
  const c = sessionChat();
  if (!c) return Promise.resolve(null);
  const key = previewKeyOf(c);
  if (previewCache.key === key && previewCache.data) return Promise.resolve(previewCache.data);
  if (plainCache.key === key && plainCache.promise) return plainCache.promise;
  plainCache.key = key;
  plainCache.promise = /** @type {Promise<any>} */ (api(`/sessions/${encodeURIComponent(String(c.chainId))}/compose?dry=1`))
    .catch((e) => { if (plainCache.key === key) plainCache.promise = null; throw e; });
  return plainCache.promise;
}
/** @type {{ key: string, promise: Promise<any> | null }} */
const plainCache = { key: "", promise: null };

/**
 * The compose preview weighed with a side model picked for one compaction — the card that asks — fetched each time,
 * never cached; without one, the one cached preview (`composePreview`).
 * @param {any} chat @param {{ model?: string } | null} once
 * @returns {Promise<any | null>}
 */
function onceWeighed(chat, once) {
  return once?.model ? api(`/sessions/${encodeURIComponent(String(chat.chainId))}/compose?dry=1&compaction=1&onceModel=${encodeURIComponent(once.model)}`) : composePreview();
}

/**
 * What memory did for the session's newest finished model turn (HarnessV3-Memory M6-1), read into the session view
 * (M6-D1: the app reads, the memory widget draws): after each turn and when a session opens. A read overtaken by a
 * newer one is dropped; memory closed, or a turn it does not hold, leaves the view's `memory` empty and the widget says
 * the turn's figures.
 * @param {any} chat
 */
async function readTurnMemory(chat) {
  // A popped pane's window shows no widget, the memory widget's reader among them.
  if (POPPED) return;
  const n = [...(chat.turns || [])].reverse().find((t) => t && !t.command && t.facts)?.n;
  const mine = (chat.memoryRead = (chat.memoryRead || 0) + 1);
  if (!chat.chainId || !n) return applySessionView(chat, { memory: null });
  let mem = null;
  try {
    mem = await api(`/memory/sessions/${encodeURIComponent(chat.chainId)}/turns/${n}/memory`);
  } catch {}
  if (mine === chat.memoryRead) applySessionView(chat, { memory: mem });
}
// What memory changes after the turn (the learner files from it, the curator retires what it showed, a question is
// asked) is read into the open session's turn memory when it touches what that shows (HarnessV3-Memory M7-D37).
followTurnMemory(onBus, {
  shown: () => sessionChat()?.view?.memory ?? null,
  read: () => {
    const c = sessionChat();
    if (c) void readTurnMemory(c);
  },
});
/**
 * The owner's word through a memory route, as the open session's (M6-D2): its answer, then the turn read again. A
 * refusal in words (a 4xx with `error`) is the answer too; anything else throws.
 * @param {string} path @param {any} body
 */
async function memoryWord(path, body) {
  const c = sessionChat();
  let out;
  try {
    out = await api(path, { method: "POST", body: { ...body, ...(c?.chainId ? { session: c.chainId } : {}) } });
  } catch (/** @type {any} */ e) {
    if (!e?.body?.error) throw e;
    out = { ok: false, ...e.body };
  }
  if (c) await readTurnMemory(c);
  return out;
}

/**
 * A compaction changed the conversation without moving the cache's key (no settings write, no new turn — the
 * boundary row is the only trace), so the epoch moves it: the next preview() composes fresh. Compact now and a
 * client compaction that lands as a boundary event both come through here.
 */
/** What the chat's agents changed, as git says it (Overview's Files changed), read again as turns start and end. */
const changesRead = keyedRead(
  (chain) => api(`/memory/sessions/${encodeURIComponent(chain)}/changes?scope=chat`),
  () => overview.paint(),
  (e) => ({ files: [], totals: { files: 0, added: 0, removed: 0 }, note: `What this chat changed could not be read: ${String(/** @type {any} */ (e)?.message || e)}` }),
);
/**
 * One of Overview's setup sheets over the chat (setup-sheet.js): a write there reads the chat's settings again, and the
 * sheet that points to another opens it.
 * @param {string} id
 */
function openSetup(id) {
  const c = sessionChat();
  if (!c) return;
  openSetupSheet(id, {
    chainId: String(c.chainId),
    onToast: toast,
    draft: () => composer.draft(),
    onChanged: () => void refreshSessionDoc(c),
    open: (other) => openSetup(other),
    hand: () => handOf(c),
  });
}
/**
 * The teams a chat can be handed to (widgets/hand.js; R4, team_v2_plan TV2-D1), from its engine as the page last read
 * it: the Team tab and Who runs this chat draw them.
 * @param {any} c @returns {import("./widgets/hand.js").HandIO}
 */
function handOf(c) {
  const engine = c.view?.settings?.engine;
  return {
    team: leadingTeam(engine),
    teams: sendable(engine),
    wait: null,
    // A team put in charge goes through its Brief (team_v2_plan §10 O1): the first words to its lead, what it reads,
    // what it costs — and, while a turn runs, its hand-over waits for the turn's end.
    lead: (team) => openBriefNow({ team: team.key, way: "charge" }),
    newTeam: () => { agentsStart = "new-team"; location.hash = routeFor("library", { page: "agents" }); },
  };
}
/**
 * Overview, at what one of the Session inspector's tabs held (R1): its setup sheet, or — the Context Map — the Next
 * request pane; a tab it never had opens Overview alone.
 * @param {string} [tab]
 */
function openOverviewAt(tab) {
  views.show("overview");
  const at = tab ? /** @type {Record<string, string>} */ (OLD_TABS)[tab] || "" : "";
  if (at === "next-request") openPaneAt("next-request");
  else if (at) openSetup(at);
}

/**
 * A line put at the top of the message box, once — `@mem load <id>` from a memory note or the Memory widget, as the
 * `/` panel puts a past chat's (composer.js `prefixLine`): nothing is sent, and a turn running now is never steered by
 * it (the bug hunt of 10-27: the press sent the command, which a running turn took as a note to its agent).
 * @param {string} line
 */
function addLine(line) {
  const draft = composer.draft();
  if (!draft.split("\n").includes(line)) composer.fill(`${line}\n${draft.replace(/^\n+/, "")}`);
  composer.focus();
}

function bustPreview() {
  previewCache.epoch++;
  previewCache.data = null;
}

/** @type {import("./widgets/registry.js").WidgetContext} */
const widgetContext = {
  view: () => chatOf(state.currentId)?.view || null,
  hasSession: () => !!sessionChat(),
  knobs: () => chatOf(state.currentId)?.view?.settings?.knobs || {},
  models: () => state.models || [],
  live: () => composer.live(),
  turns: () => chatOf(state.currentId)?.turns || [],
  write: (change) => { const c = sessionChat(); if (c) writeSessionSettings(c, change); },
  setWindow: (tokens) => { const c = sessionChat(); if (c) writeSessionWindow(c, tokens); },
  command: (text) => { void sendOrQueue(text); },
  addLine: (line) => addLine(line),
  sessionRow: (id) => (state.sessions || []).find((/** @type {any} */ s) => s.id === id) || null,
  openPage: (page) => { window.open(`/ui/index.html#${page}`, "_blank", "noopener"); },
  memoryEngine: () => state.memoryEngine,
  toast: (msg, kind) => toast(msg, kind),
  // Compact now… (proposal_ux D6): the card that asks, with every way and what each leaves; a press never compacts.
  summon: () => { summonCompactionCard("", []); },
  // The instant fold's offer (the owner's rules of 10-31): Fold now, between turns.
  foldNow: () => { const c = sessionChat(); if (c && !c.live) void compactNow(c, { method: "fold" }); },
  openHow: () => openHow(),
  stopAndCompact: () => stopAndCompact(),
  undoCompaction: (id) => { const c = sessionChat(); if (c) undoCompactionIn(c, Number(id)); },
  preview: () => composePreview(),
  previewKey: () => { const c = sessionChat(); return c ? previewKeyOf(c) : ""; },
  // A turn is in the conversation: the Chat view comes first.
  scrollToTurn: (n) => {
    views.show("chat");
    return transcript.scrollToTurn(Number(n));
  },
  dryRun: () => {
    const c = sessionChat();
    if (!c) return;
    openDryRun(createInspectorCallbacks({ chainIdOf: () => c.chainId, reload: () => refreshSessionDoc(c), onToast: toast, draft: () => composer.draft() }));
  },
  subagents: {
    rows: () => subagentStore.rows(),
    // A sub-agent runs on the agent loop, or as a coding agent (HarnessV3-ACP AC6-1): every model is one it can run on.
    models: () => state.models || [],
    sessionModel: () => baseModelOf(sessionChat()?.model || composer.modelName() || ""),
    cache: () => subagentStore.cache(),
  },
  memory: {
    confirm: (id) => memoryWord(`/memory/items/${encodeURIComponent(String(id).replace(/^i/, ""))}`, { status: "confirmed" }),
    correct: (id, text) => memoryWord(`/memory/items/${encodeURIComponent(String(id).replace(/^i/, ""))}/correct`, { text, reason: "corrected in the harness" }),
    forget: (id) => memoryWord("/memory/forget", { id, reason: "retired in the harness" }),
    answer: (id, answer) => memoryWord(`/memory/inbox/${encodeURIComponent(id)}`, { answer }),
  },
  team: {
    open: () => views.show("team"),
    on: () => teamsOn(state.config),
    back: () => confirmSwitch(sessionChat()),
    wait: () => switchWait(sessionChat(), subagentStore.rows()),
  },
  accounts: {
    session: () => chosenAgent(),
    check: (upstream) => checkAgent(upstream),
    useResetCredit: (upstream) => useResetCredit(upstream),
    rows: () => state.accounts,
    signIn: (upstream, then) => signInTo(upstream, then),
    switchTo: (upstream) => void switchAccount(upstream),
    manage: () => { location.hash = routeFor("settings", { section: "agents" }); },
  },
  // Overview's doors (proposal_ux §4.6): each opens something; Stop is the one that acts, and it never starts or spends.
  chat: () => chatOf(state.currentId) || null,
  checklist: () => { const c = chatOf(state.currentId); return c ? planOf(c, null).plan : []; },
  openView: (id) => views.show(id),
  openPane: (id) => openPaneAt(id),
  openSetup: (id) => openSetup(id),
  stopTurn: () => { void stopCurrent(); },
  chatChanges: () => { const c = sessionChat(); return c ? changesRead.get(String(c.chainId), chatState(c)) : null; },
  mayAsk: () => mayAskOf(),
  showWidget: (id) => widgets.show(id),
  openLibrary: (page, scope) => { location.hash = routeFor("library", { page, scope: scope || "" }); },
};
const widgets = mountWidgets(composer.slots, widgetContext);
overview.attach(widgetContext, widgets.io);
widgets.add(overview);

// Find brings in what it would search: the work of turns far from the screen, then the answers of theirs and of every
// card the list carries as heads, once drawn (the store's `cardsHeard`).
const find = createFind(shell.convFrame, { root: () => shell.convFrame.querySelector(".transcript"), prepare: () => transcript.readWork().then((n) => subagentStore.cardsHeard().then((heard) => n + (heard ? 1 : 0))), reveal: (needle) => transcript.revealWork(needle), letGo: () => transcript.foldWork() });

/**
 * The command center's doors to the panes (proposal_ux §3.5, N1): each pane opened in front, a file or artifact closed
 * lately opened again, and the layout's choices other than the one in force.
 */
const paneActions = () => {
  const panes = rail.panes();
  const tools = new Set(panes.map((p) => p.id));
  return [
    ...panes.map((p) => ({ id: `pane-${p.id}`, label: `Open pane: ${p.label}`, icon: p.icon, tone: p.tone, shortcut: PANE_KEYS[p.id], run: () => rail.openTab(p.id) })),
    ...rail.closedTabs().filter((c) => !tools.has(c.id)).map((c) => ({ id: `reopen-${c.id}`, label: `Reopen: ${c.label}`, icon: c.icon, tone: "var(--color-sys-gray)", run: () => rail.openTab(c.id) })),
    ...ARRANGES.filter((a) => a !== rail.arrange).map((a) => ({ id: `arrange-${a}`, label: `Layout: ${ARRANGE_WORDS[a].label}`, icon: ARRANGE_WORDS[a].icon, tone: "var(--color-sys-indigo)", run: () => rail.setArrange(a) })),
    ...PLACES.filter((p) => p !== rail.place).map((p) => ({ id: `place-${p}`, label: `Layout: ${PLACE_WORDS[p].label}`, icon: PLACE_WORDS[p].icon, tone: "var(--color-sys-indigo)", run: () => rail.setPlace(p) })),
  ];
};

/**
 * The open chat as Ctrl+K reads it to change its settings in words (the design pass of 10-24, UX7; lib/setting-intents.js):
 * the line and its window, the permission, the model and its tuning (the composer's chips' own), memory and whom its
 * agent may use. A chat not started has none: New chat's screen holds its controls.
 * @returns {import("./lib/setting-intents.js").SettingFacts}
 */
const settingFacts = () => {
  const chat = sessionChat();
  const view = chat?.view;
  const st = view?.settings;
  if (!chat || !st?.effective) return { chat: false };
  const wf = windowFacts(view, composer.live());
  const cp = compactionParts(widgetContext);
  const may = mayAskOf();
  return {
    chat: true,
    client: isClientView(view),
    line: { percent: cp.percent(), window: wf.window },
    permission: String(st.effective.loop?.permissions || "edit"),
    ...composer.tuneFacts(),
    memory: { on: st.effective.memory?.enabled !== false, source: String(st.sources?.["memory.enabled"] || "default") },
    may: may ? { tags: [...may.tags], cards: may.cards.filter((c) => !c.partOf).map((c) => ({ tag: c.tag, name: c.name })) } : null,
    mayOff: may?.off || "",
  };
};

/**
 * A Ctrl+K setting row run (UX7): written for this chat the way its own control writes it — the settings route, the
 * tune popover's choice, the model chip's pick, the Your agent may use list — or the compaction card brought up.
 * @param {import("./lib/setting-intents.js").SettingRow} row
 */
async function runSetting(row) {
  const chat = sessionChat();
  if (!chat) return toast(NOT_STARTED);
  const c = row.change;
  if ("summon" in c) return summonCompactionCard("", []);
  let done = false;
  if ("write" in c) done = await writeSessionSettings(chat, c.write);
  else if ("tune" in c) done = composer.tune(c.tune, c.value);
  else if ("family" in c) done = composer.pickFamilyById(c.family);
  else if ("may" in c) { const m = mayAskOf(); if (m) { m.onChange(c.may); done = true; } }
  if (done) toast(`${row.label}, for this chat`);
}

const commandCenter = createCommandCenter({
  // A view-only device's page changes no setting: Ctrl+K offers none (p4-view-ui).
  settings: () => (viewOnlyPage() ? null : settingFacts()),
  onSetting: (row) => { void runSetting(row); },
  // The other machines the left bar lists, searched through the app, a chat of theirs opened there (the remote desk).
  machines: () => sidebar.deskMachines(),
  ...(typeof (/** @type {any} */ (globalThis).filamentMachines?.call) === "function" ? { deskCall: (/** @type {any} */ p) => /** @type {any} */ (globalThis).filamentMachines.call(p) } : {}),
  // Named as its row named it: a machine gone from the bar since is still said by its name.
  onOpenThere: (machine, chain, name) => sidebar.openOnMachine({ id: machine, name: name || sidebar.deskMachines().find((m) => m.id === String(machine).toLowerCase())?.name || machine }, deskRoute({ chain, thread: null })),
  actions: () => [
    { id: "new", label: WORDS.newChat, icon: "messageCirclePlus", tone: "var(--color-sys-blue)", shortcut: "new-task", when: () => !viewOnlyPage(), run: () => newChat() },
    { id: "next-needs", label: "Open what needs you next", icon: "inbox", tone: "var(--color-sys-orange)", shortcut: "next-needs", run: () => openNextNeeds() },
    // The open chat's project's Space (proposal_ux §4.14, §4.17).
    { id: "space", label: "Go to the Space", icon: "squareKanban", tone: "var(--color-sys-purple)", when: () => !!projectOfChat(chatOf(state.currentId)), run: () => { const id = projectOfChat(chatOf(state.currentId)); if (id) location.hash = routeFor("space", { id }); } },
    { id: "settings", label: "Settings", icon: "settings", tone: "var(--color-sys-gray)", shortcut: "settings", run: () => { location.hash = routeFor("settings", { section: "general" }); } },
    { id: "sidebar", label: "Toggle sidebar", icon: "panelLeftOpen", tone: "var(--color-sys-indigo)", shortcut: "sidebar", run: () => shell.setSidebar(!shell.sidebarOpen) },
    { id: "pane", label: "Show or hide panes", icon: "panelRight", tone: "var(--color-sys-indigo)", shortcut: "pane", run: () => togglePane() },
    ...paneActions(),
    { id: "find", label: WORDS.findInChat, icon: "search", tone: "var(--color-sys-orange)", shortcut: "find", run: () => findInTask() },
    { id: "view-chat", label: "Show Chat", icon: "messageSquare", tone: "var(--color-sys-indigo)", shortcut: "view-chat", when: () => !!chatOf(state.currentId)?.chainId, run: () => views.show("chat") },
    { id: "view-overview", label: "Show Overview", icon: "layoutDashboard", tone: "var(--color-sys-indigo)", shortcut: "view-overview", when: () => !!chatOf(state.currentId)?.chainId, run: () => views.show("overview") },
    { id: "view-plan", label: "Show Plan", icon: "listTodo", tone: "var(--color-sys-indigo)", shortcut: "view-plan", when: () => !!chatOf(state.currentId)?.chainId, run: () => views.show("plan") },
    { id: "view-team", label: "Show the teams", icon: "users", tone: "var(--color-sys-indigo)", shortcut: "view-team", when: () => teamsOn(state.config) && !!chatOf(state.currentId)?.chainId, run: () => views.show("team") },
    { id: "view-side", label: "Show Agents", icon: "users", tone: "var(--color-sys-indigo)", shortcut: "view-side", when: () => !!chatOf(state.currentId)?.chainId, run: () => views.show("side") },
    { id: "side-new", label: "Ask on the side", icon: "plus", tone: "var(--color-sys-indigo)", shortcut: "subagent", when: () => !viewOnlyPage() && !!chatOf(state.currentId)?.chainId, run: () => views.side.fresh() },
    { id: "catch-up", label: "Catch me up…", icon: "history", tone: "var(--color-sys-indigo)", when: () => !viewOnlyPage() && !!chatOf(state.currentId)?.chainId, run: () => catchUp() },
    { id: "theme", label: "Switch theme to dark/light", icon: "moon", tone: "var(--color-sys-purple)", shortcut: "theme", when: () => !themeHinted(), run: () => setThemePref(document.documentElement.classList.contains("theme-zai-dark") ? "light" : "dark") },
    { id: "task-prev", label: WORDS.previousChat, icon: "chevronUp", tone: "var(--color-sys-gray)", shortcut: "task-prev", run: () => sidebar.cycleTask(-1) },
    { id: "task-next", label: WORDS.nextChat, icon: "chevronDown", tone: "var(--color-sys-gray)", shortcut: "task-next", run: () => sidebar.cycleTask(1) },
    { id: "console", label: "Open Filament console", icon: "externalLink", tone: "var(--color-sys-teal)", run: () => window.open("/ui/", CONSOLE_WINDOW) },
    { id: "welcome", label: "Welcome tour", icon: "sparkles", tone: "var(--color-sys-blue)", when: () => !viewOnlyPage(), run: () => openTour() },
    // The first-run tips once more (Product's review of 11-09): each shows again as its moment comes.
    { id: "tips", label: "Show tips again", icon: "sparkles", tone: "var(--color-sys-blue)", when: () => !viewOnlyPage() && !POPPED, run: () => void coach.reset().then(() => toast("Tips show again, each as its moment comes"), (e) => toast(e?.message || String(e), "err")) },
  ].filter((a) => !CHAT_ONLY || !CHAT_ONLY_OFF.has(a.id)),
  onOpenTask: (id) => openSession({ id, title: "", cwd: "" }, { push: true }),
  getFolder: () => chatOf(state.currentId)?.cwd || folderIn.value.trim(),
  getChat: () => chatOf(state.currentId),
  onInsert: (text) => composer.fill(composer.draft() + text),
});

/** The shortcuts that open a dialog of their own: the command center, the fork's, the folder's. */
const OPENS_DIALOG = new Set(["command-center", "command-center-alt", "fork", "open-workspace"]);

// The shortcut registry is the one place a key is matched, so a rebind takes effect. Listeners
// elsewhere own only the keys that are not shortcuts (task cycling, row navigation).
window.addEventListener("keydown", (e) => onShortcutKey(e));
/**
 * A key the registry names a shortcut, run; `asked`: a shortcut run by its id, no key pressed here — one the chat shown in
 * place beside the bar handed over (lib/desk-guest.js). @param {KeyboardEvent | null} e @param {string} [asked]
 */
function onShortcutKey(e, asked = "") {
  const id = asked || (e ? matchShortcut(e) : "");
  if (!id) return;
  const run = {
    "command-center": () => commandCenter.open(),
    "command-center-alt": () => commandCenter.open(),
    settings: () => { location.hash = routeFor("settings", { section: "general" }); },
    find: () => findInTask(),
    "view-chat": () => views.show("chat"),
    "view-overview": () => views.show("overview"),
    "view-plan": () => views.show("plan"),
    "view-team": () => { if (teamsOn(state.config)) views.show("team"); },
    "view-side": () => views.show("side"),
    sidebar: () => shell.setSidebar(!shell.sidebarOpen),
    pane: () => togglePane(),
    "pane-float": () => floatOrDock(),
    changes: () => rail.toggle("changes"),
    terminal: () => rail.toggle("terminal"),
    "focus-next": () => moveFocus(1),
    "focus-prev": () => moveFocus(-1),
    // A view-only device's page starts no chat (p4-view-ui).
    "new-task": () => { if (viewOnlyPage()) return; pushNextAddress = true; newChat(); },
    model: () => composer.openModel(),
    mode: () => composer.cycleMode(),
    effort: () => composer.openEffort(),
    // A new thread in the Sub Agents tab; a chat with no session yet has no tab, and the header's widget says why.
    // With no session there is nothing to read on the side yet: say so, in `/btw`'s words there (AG-144).
    subagent: () => (chatOf(state.currentId)?.chainId ? views.side.fresh() : toast(NO_SESSION_YET)),
    "task-prev": () => sidebar.cycleTask(-1),
    "task-next": () => sidebar.cycleTask(1),
    "next-needs": () => openNextNeeds(),
    back: () => history.back(),
    forward: () => history.forward(),
    // Open Workspace: pick a folder natively and start a chat in it — the same door the composer's recovery uses.
    "open-workspace": () => openFolder(),
    // Close Current Context: the pane holding the focus (proposal_ux §3.5); else back to a fresh task, the chat staying
    // in the sidebar.
    "close-context": () => {
      if (rail.closeFocused()) return;
      if (viewOnlyPage() || CHAT_ONLY) return;
      pushNextAddress = true;
      newChat();
    },
    // (zoom-in/out/reset stay with watchTheme's own listener — the one place the font-size keys are handled.)
    fork: () => {
      const c = chatOf(state.currentId);
      const last = forkAt(c);
      if (c && last) forkModal(c, last);
    },
  }[id];
  if (!run) return;
  e?.preventDefault();
  // The chat alone another machine's desk shows hands it the keys of the list beside it — none while a dialog of its own
  // is open, which holds the keys here as it would on the whole page: the desk opens nothing over it.
  if (toDesk && DESK_KEYS.includes(id)) return void (document.querySelector('.zc-dialog[aria-modal="true"]') || toDesk(id));
  // A view-only device's page: no model, mode or effort to pick, no fork, no question on the side (p4-view-ui).
  if (viewOnlyPage() && VIEW_ONLY_KEYS_OFF.has(id)) return;
  if (CHAT_ONLY && CHAT_ONLY_OFF.has(id)) return;
  // One dialog at a time, as the command center opens no second over itself: a dialog open holds the keys until it
  // closes, so a shortcut that opens a dialog opens none over it. A sheet is no dialog: one opens over it, as ever.
  if (OPENS_DIALOG.has(id) && document.querySelector('.zc-dialog[aria-modal="true"]')) return;
  run();
}

/**
 * The sheet How earlier turns are kept (proposal_ux §4.12 step 4) for the open chat: its own level where it has a
 * session, and your defaults. A default written there reaches the open chat at once.
 * @param {import("./how-sheet.js").HowLevel} [level]
 */
function openHow(level) {
  const c = sessionChat();
  openHowSheet({
    how: c ? widgetContext : null,
    chainId: c ? String(c.chainId) : null,
    models: () => state.models || [],
    onToast: (msg, kind) => toast(msg, kind),
    onChanged: () => { const x = sessionChat(); if (x) void refreshSessionDoc(x); },
    ...(level ? { level } : {}),
  });
}

/**
 * The project a chat belongs to: its session's, as the list names it, else the project whose folder it is; null where
 * neither names one yet.
 * @param {any} chat
 */
function projectOfChat(chat) {
  const listed = chat?.chainId ? (state.sessions || []).find((/** @type {any} */ s) => s.id === chat.chainId)?.project : null;
  if (listed && listed !== "none") return String(listed);
  const key = (/** @type {unknown} */ p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const p = chat?.cwd ? (state.projects || []).find((/** @type {any} */ x) => x.cwd && key(x.cwd) === key(chat.cwd)) : null;
  return p ? String(p.id) : null;
}

/**
 * The Start in a project's folder, the Space's New chat here… and, on a new worktree, its New lane…: one press fills it,
 * nothing runs until Send (rule 1).
 * @param {string} cwd @param {boolean} lane
 * @param {string | null} [model]  the Space's model, where it has one (the owner's of 11-04): the chat starts on it
 */
function newChatIn(cwd, lane, model = null) {
  pushNextAddress = true;
  newChat({ cwd, ...(model ? { model } : {}), ...(lane ? { worksIn: newWorktreeChoice(cwd, composer.draft?.() || "") } : {}) });
  leaveScreen();
}

/**
 * The Space's Start a chat on this… (proposal_ux §4.14): the Start in the task's folder, the task's words in its box;
 * the chat takes the task — its own, in Doing — as its first send makes it (`ensureSession`). Nothing runs until Send
 * (rule 1).
 * @param {string} project @param {{ id: string, title: string, line: string }} task @param {string} cwd
 * @param {{ space: string } | null} [from]  handed from a Space of your own to run here (A4)
 * @param {string | null} [model]  the Space's model, where it has one (the owner's of 11-04)
 */
function startOnTask(project, task, cwd, from = null, model = null) {
  pushNextAddress = true;
  const chat = newChat({ cwd, ...(model ? { model } : {}) });
  chat.spaceTask = { project, id: task.id };
  if (from) chat.from = from;
  const words = task.line ? `${task.title}\n\n${task.line}` : task.title;
  saveDraft(chat, words);
  composer.setDraft(words);
  leaveScreen();
  void boxTaskFiles(project, task, () => chatOf(state.currentId) === chat);
}

/**
 * A board task's files in the box of the chat it went to (the owner's of 11-02), read from its Space once that chat is
 * on screen, each taken as a dropped file is — while the chat stays on screen. Those a box does not take stay on the
 * card, said in words; one that could not be read is said, and the rest go in all the same. Nothing is sent.
 * @param {string} project @param {{ id: string, files?: import("./lib/space-view.js").TaskFile[] }} task @param {() => boolean} still
 */
async function boxTaskFiles(project, task, still) {
  const { takes, left } = boxFilesOf(task);
  if (left.length) toast(`${left.join(", ")} ${left.length === 1 ? "stays" : "stay"} on the card: a chat takes pictures, PDFs and text files`);
  if (!takes.length) return;
  const { files, failed } = await readTaskFiles(project, task.id, takes, (url) => fetch(url));
  for (const w of failed) toast(w, "err");
  if (files.length && still()) await composer.attachFiles(files);
}

/**
 * The Start in a folder with words in its box: the Space's Catch me up… (HarnessV4_Space_Plan SG-D3) — on a new
 * worktree with `lane`, a card a dashboard put on the board picked up (S4c), named by the words; a lane's name for a
 * pulled issue's Start a chat on this (the Space Apps plan of 10-29: "lin-42"). Nothing runs until Send (rule 1).
 * @param {string} cwd @param {string} words @param {boolean | string} [lane]
 * @param {{ space: string } | null} [from]  handed from a Space of your own to run here (A4)
 * @param {string | null} [model]  the Space's model, where it has one (the owner's of 11-04)
 */
function startWithWords(cwd, words, lane = false, from = null, model = null) {
  pushNextAddress = true;
  const chat = newChat({ cwd, ...(model ? { model } : {}), ...(lane ? { worksIn: typeof lane === "string" ? givenWorktreeChoice(cwd, lane) : newWorktreeChoice(cwd, words) } : {}) });
  if (from) chat.from = from;
  saveDraft(chat, words);
  composer.setDraft(words);
  leaveScreen();
}

/**
 * Work that starts in a Space but may belong to a project (HarnessV4_SpacesPlugins_Plan A4): from a Space of your own,
 * where the chat runs is asked first — the Space itself, a project, another Space (space/pick-place.js) —, and a chat
 * that runs elsewhere remembers the Space, whose What happened says each time it finishes; from a project's Space, the
 * chat starts in `cwd` and asks nothing. A task of the board goes with the chat (`task`). Nothing runs until Send (rule 1).
 * @param {string} from  the Space's project @param {string} cwd @param {string} words
 * @param {{ id: string, title: string, line: string } | null} [task]
 * @param {string | null} [model]  the Space's model, where it has one (the owner's of 11-04): the chat starts on it,
 *   wherever it runs
 */
async function handFromSpace(from, cwd, words, task = null, model = null) {
  const own = sidebar.ownSpaces();
  if (!own.some((o) => o.project === from)) return task ? startOnTask(from, task, cwd, null, model) : startWithWords(cwd, words, false, null, model);
  const projects = (state.projects || []).map((/** @type {any} */ p) => ({ id: String(p.id), name: String(p.name || p.cwd || p.id), cwd: String(p.cwd || "") }));
  const what = words.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
  const p = await pickPlace({ here: from, choices: placeChoices(from, projects, own), what: what.length > 160 ? `${what.slice(0, 159)}…` : what });
  if (!p) return;
  const origin = p.id === from ? null : { space: from };
  if (task) startOnTask(from, task, p.cwd, origin, model);
  else startWithWords(p.cwd, words, false, origin, model);
}

/**
 * Reproduce… (HarnessV4_Space_Plan S7-D2, the mock's screen 14): the Start in the report's project folder on a new lane
 * `repro/<key>`, its box addressed to the Builder — where Agents has it — with the report's words, and the chat's agents
 * working in the lane itself (Their own worktree for edits off, with its ↺): the failing test lands in the lane. Nothing
 * runs until Send (rule 1).
 * @param {string} cwd @param {import("./lib/space-view.js").ReproReport} report
 * @param {string | null} [model]  the Space's model, where it has one (the owner's of 11-04)
 */
function reproduceIn(cwd, report, model = null) {
  const builder = agentCards.all().some((c) => c.tag === "builder");
  const words = reproduceWords(report, { builder });
  pushNextAddress = true;
  const chat = newChat({ cwd, ...(model ? { model } : {}), worksIn: givenWorktreeChoice(cwd, reproLane(report.title)), held: { "subagents.worktree": false } });
  saveDraft(chat, words);
  composer.setDraft(words);
  leaveScreen();
}

/**
 * A chat opened with words first in its box: a draft's Ask for a change… (HarnessV4_Space_Plan S5c, S5-D9) in the chat
 * that wrote it; a board task sent to a chat of a lane, its files with it (`task`). What its box held stays, after
 * them. Nothing is sent until Send (rule 1).
 * @param {string} chain @param {string} words
 * @param {{ project: string, task: import("./lib/space-view.js").SpaceTask }} [task]
 */
function askInChat(chain, words, task) {
  const had = draftFor({ chainId: chain });
  saveDraft({ chainId: chain }, had && !had.startsWith(words) ? `${words}\n\n${had}` : had || words);
  openChain(chain);
  if (task) void boxTaskFiles(task.project, task.task, () => chatOf(state.currentId)?.chainId === chain);
}

/**
 * What a Space's sheets offer an agent to run on — a button's second look and check, a routine's runs —, the person's
 * pick there (the owner's word of 10-31): the composer's catalogue, read as it stands.
 * @type {import("./space/model-row.js").Catalogue}
 */
const spaceModels = { models: () => state.models || [], families: () => state.families || [], accounts: () => state.accounts || [] };

/** A model's name as the picker says it ("Opus 5.5"), from the catalogue's families. @param {string} id */
const modelNameOf = (id) => {
  const at = locate(state.families, id);
  return at ? familyName(at.family) : prettyModel(id);
};
// The models a proposal card's Runs on lists, and their names, as the Space's sheet has them.
routineActions.catalogue = spaceModels;
routineActions.modelName = modelNameOf;

/**
 * What a project's Space reads and does (space/space.js): the project, its chats as the left bar knows them, the ways out.
 * The model its agents run on, as its page last read it (`runsOn`, the owner's of 11-04): every chat it starts starts on
 * it — its effort stays the composer's, as for any new chat; what runs by itself runs at the Space's.
 */
const spaceCallbacks = () => {
  /** @type {string | null} */
  let model = null;
  return /** @type {import("./space/space.js").SpaceCallbacks} */ ({
  // A model that cannot run now — a plan used up — is no model to start a chat on: the composer's stands then.
  runsOn: (on) => { model = on?.model && !on.problem ? on.model : null; },
  project: (id) => {
    const p = (state.projects || []).find((/** @type {any} */ x) => String(x.id) === id);
    return p ? { id: String(p.id), name: String(p.name || p.cwd || p.id), cwd: String(p.cwd || "") } : null;
  },
  look: {
    chat: (id) => {
      const s = (state.sessions || []).find((/** @type {any} */ x) => x.id === id);
      return s ? { title: String(s.title || s.preview || ""), when: rowMoment(s), line: String(s.state || s.preview || "") } : null;
    },
    now: (id) => sidebar.nowOf(id),
    failed: (id) => !!state.erroredChains?.has(id),
    modelName: modelNameOf,
  },
  // A Space of your own that shows projects (A7): Project…'s lists, a shown project's chats that ask you, its Space.
  projects: () => (state.projects || []).map((/** @type {any} */ p) => ({ id: String(p.id), name: String(p.name || p.cwd || p.id), cwd: String(p.cwd || "") })),
  ownSpaces: () => sidebar.ownSpaces(),
  asking: (project) => sidebar.nowGroups().needs.filter((r) => (state.sessions || []).find((/** @type {any} */ s) => s.id === r.chain)?.project === project),
  openRow: (r) => sidebar.openNow(r),
  openSpace: (id, tab) => { location.hash = routeFor("space", { id, tab }); },
  openChat: (id) => openChain(id),
  newChat: (cwd, lane) => newChatIn(cwd, lane, model),
  startOn: (project, task, cwd) => startOnTask(project, task, cwd, null, model),
  startWith: (cwd, words, lane) => startWithWords(cwd, words, lane, null, model),
  handOff: (from, cwd, words, task) => void handFromSpace(from, cwd, words, task, model),
  reproduce: (cwd, report) => reproduceIn(cwd, report, model),
  askChat: (chain, words, task) => askInChat(chain, words, task),
  openArtifact: (name) => { location.hash = routeFor("artifact", { id: name }); },
  catalogue: spaceModels,
  // A dashboard's page in its Space's tab: what it asks an agent is the Space page's to do (`more.ask`: its sheet, a run
  // here, or the Start — the owner's of 11-04); its failure's Tell the agent fills the Start in the Space's own folder,
  // where the app lives — a Space of your own asks nowhere else (the owner's of 11-04: Summarize opened a chat that
  // was not the Space's).
  dashboardFrame: (name, title, cwd, onAct, _from, more = {}) => {
    const tell = (/** @type {string} */ text) => startWithWords(cwd, text, false, null, model);
    const ask = more.ask || tell;
    // An app's page is the agent's own code: it never asks Filament to fill the screen (AFC-114) — a game fills it
    // itself, on the person's press, as its frame lets it —, and may stop its running button. A broken version offers
    // the one before it.
    const frame = artifactFrame(name, { title, onTell: tell, onAsk: ask, mayFill: () => !more.app, within: "space", onAct, onStop: more.onStop, app: more.app, back: more.back });
    return { el: frame.el, setTitle: frame.setTitle, again: () => frame.showVersion(null), version: (v) => frame.showVersion(v), repaint: frame.repaint };
  },
  // Project settings (§4.16): the page opens with the project chosen in its Applies to.
  projectSettings: (id, section) => {
    holdJump({ section, start: `project:${id}` });
    location.hash = routeFor("settings", { section });
  },
  onMoved: () => {
    headerModule.refreshGit();
    sidebar.placesMoved();
    askOpenAgain();
  },
  onClose: () => { location.hash = backTo(); },
  // Settings › Space, where every Space's defaults are (the owner's of 11-04).
  spaceDefaults: () => { location.hash = routeFor("settings", { section: "space" }); },
  });
};

/** Pick a folder natively and start a chat in it: Ctrl+O, and the empty left bar's Open folder…. */
function openFolder() {
  // A view-only device's page starts no chat, nor lists this machine's folders for one (p4-view-ui).
  if (viewOnlyPage()) return;
  pickProjectFolder().then((p) => { if (p) { pushNextAddress = true; newChat({ cwd: p }); leaveScreen(); } }).catch(() => {});
}

/** Alt+N (proposal_ux §4.1): the newest thing that needs you, opened — the chat, or its thread. */
function openNextNeeds() {
  if (!sidebar.openNext()) toast("Nothing needs you now");
}

/** Another machine's chat shown in place beside the left bar, through the desktop app (lib/desk-guest.js): made once the bar is. @type {ReturnType<typeof createDeskGuest> | null} */
let deskGuest = null;
/**
 * A chat of another machine's opened on its whole page (the app's `openOn`); one the app would not open — that machine
 * gone from the window since the list was drawn — said, not left a press that did nothing.
 * @param {string} machine @param {string} route @param {string} [name]  its name as the press read it
 */
function openWholeOn(machine, route, name = "That machine") {
  const app = /** @type {any} */ (globalThis).filamentApp;
  if (typeof app?.openOn !== "function") return;
  void Promise.resolve(app.openOn(machine, route)).then(
    (ok) => void (ok === false && toast(`${name} is not in this window now: its chat did not open`, "err")),
    () => {},
  );
}
// The app's Add sheet's Set it up over SSH: this page's setup sheet, the host typed there in its field (ssh-setup.js).
/** @type {any} */ (globalThis).filamentApp?.onSshSetup?.((/** @type {{ alias: string }} */ p) => void openSshSetup({ alias: p.alias, onToast: toast }));
const sidebar = createSidebar(shell.sidebarHost, {
  // Another machine's chat opened from the bar: shown in place beside it where the app and that machine can, else on
  // that machine's whole page.
  openThere: (m, route) => {
    // A full-frame screen goes for it, as for a chat of this computer's (`onSelectChat`).
    leaveScreen();
    if (deskGuest) void deskGuest.open(m, route);
    else openWholeOn(m.id, route, m.name);
  },
  // A click here that opens a task leaves a full-frame screen (Settings, a control room) for it — and opens on its Chat,
  // whatever tab it was left on (the owner's words of 10-29: "every click should open the chat tab"); an address that
  // names a view, Back and Forward keep theirs.
  // A view-only device's page offers no New chat (`paintViewOnly`), and starts none.
  onNew: () => { if (viewOnlyPage()) return; pushNextAddress = true; newChat(); leaveScreen(); },
  // Its unread mark goes with the open (`markRead`), in one write.
  onOpen: (s) => {
    openSession(s, { push: true, view: "chat" });
    leaveScreen();
  },
  onSelectChat: (id) => { selectChat(id, { view: "chat" }); leaveScreen(); },
  // The list was read and drawn (`load`): what of the page reads the list follows — the bar itself is not drawn again.
  onChanged: () => {
    paintImportedFrom(chatOf(state.currentId));
    paintFromAgents(chatOf(state.currentId));
    paintCrafterLine();
  },
  onReveal: () => shell.setSidebar(true),
  onHide: () => shell.setSidebar(false),
  // A chat deleted takes its waiting hand-over with it (found by the Bug Hunter, 10-19: it stayed, its timer ticking),
  // and the page's chat on it; the Changes pane on screen reads again without it.
  onDeleted: (id) => { if (handOvers.has(id)) disarmHandOver(id); leaveDeleted(id); chatDeleted(id); },
  // A run began or ended, a turn's holder came or went: the views paint again — the Plan tab draws the agent's own task
  // paused once its turn has ended (state.js `atWork`).
  onAtWork: () => { views.pulse(); paintCrafterLine(); paintBrowserLine(); paintAgents(); },
  // The Plan's Still open card reads the chat's commands as they stand (views/plan.js `askedFor`).
  onCommands: () => { const c = chatOf(state.currentId); if (c) paintStatus(c); views.pulse(); },
  onComeBacks: () => { const c = chatOf(state.currentId); if (c) paintStatus(c); },
  // Which projects have a Space moved: the Start's line on its folder's, said again.
  onSpaces: () => transcript.refreshSpace(),
  onToast: (msg, kind) => toast(msg, kind),
  onAddProject: () => addProjectDialog(),
  // A row's Fork… forks the session at its last turn; the transcript's per-turn fork picks the turn.
  onForkSession: async (s) => {
    const was = state.currentId;
    await forkSessionRow(s);
    if (state.currentId !== was) leaveScreen();
  },
  // A fresh task that receives the session as memory material on its first turn (the row itself opens it in place).
  onLoadSession: (s) => { loadIntoNewTask(s); leaveScreen(); },
  // A thread a row of Now names: its chat, then the thread in Sub Agents.
  onOpenThread: (s, id) => {
    openSession(s, { push: true });
    views.show("side");
    views.side.open(id);
    leaveScreen();
  },
  onOpenFolder: () => openFolder(),
  viewOnly: () => viewOnlyPage(),
  // A team beside's chat a row of Now names: its team and the chat it runs beside (team_v2_plan §5.3).
  besideChat: (chain) => besideStore.knownChat(chain),
  // The chats whose message a card stopped: Now lists each as needing you (the owner's of 11-01).
  askedChats: () => askedChats(),
  compactingChats: () => compactingChats(),
  onSearch: () => commandCenter.open(),
  onSettings: () => { location.hash = routeFor("settings", { section: "general" }); },
  // The Library (proposal_ux §4.1, V4): its pages are Settings' and the Artifacts page until phase 7 gives them theirs.
  onLibrary: (page) => { location.hash = page === "artifacts" ? routeFor("artifacts") : routeFor("library", { page }); },
  // A project's Space (proposal_ux §4.14): its row under the project, or its menu; an app's row under it, that app.
  onSpace: (id, tab) => { location.hash = routeFor("space", { id, tab }); },
  // Its folders and worktrees (the project's menu): on its Space's page, Places open — a project with no Space has them too.
  // Its page on screen, an app's too, the sheet opens over it and the address stays: a new one would close the sheet.
  onSpacePlaces: (id) => {
    placesFirst(id);
    const at = parseRoute(location.hash);
    if (at.kind !== "space" || at.id !== id) location.hash = routeFor("space", { id });
  },
  // Your Space (HarnessV4_Space_Plan S5b): its row at the bar's top, once a Space is extended.
  onYourSpace: () => { location.hash = routeFor("your-space"); },
  // A project was deleted: the recents and the header chip stop pointing at its folder, so the next New task
  // cannot land on the ghost (the empty-state chooser revalidates what it lists on open, for deletions made elsewhere).
  onProjectGone: (cwd) => {
    const gone = String(cwd || "").trim();
    if (!gone) return;
    forgetFolder(gone);
    if (folderIn.value.trim() === gone) {
      folderIn.value = "";
      folderIn.dispatchEvent(new Event("input"));
      transcript.refreshFolder();
    }
  },
}, shell.collapsedRail);
spaceForFolder = (cwd) => sidebar.spaceFor(cwd);
// This computer's page in the desktop app: another machine's chat shows in place over the column beside the bar (the
// remote desk of 11-22); the bar marks its row, and a key of the bar's pressed in it is run here.
if (!CHAT_ONLY && !POPPED) {
  const machines = /** @type {any} */ (globalThis).filamentMachines;
  deskGuest = createDeskGuest({
    bridge: machines,
    stage: shell.contentCol,
    openWhole: (machine, route, name) => openWholeOn(machine, route, name),
    onMoved: (g) => sidebar.showingThere(g),
    onShown: (s) => shell.setGuest(s),
    say: (words) => toast(words),
  });
  machines?.onKey?.((/** @type {string} */ id) => {
    if (!DESK_KEYS.includes(id)) return;
    onShortcutKey(null, id);
    deskGuest?.handed();
  });
}
// The chat's crumb stands in the sidebar's top row while the sidebar shows (the owner's of 11-01).
shell.setCrumbSlot(sidebar.crumbSlot);

/** Show or hide panes (Ctrl+Alt+B): one press shows panes the window's room hid, as it shows hidden ones. */
function togglePane() {
  rail.setOpen(!rail.shown);
}

/**
 * Float or dock the panes (Ctrl+Alt+F): docked, they go over the chat; floating, they dock beside it — on Auto where the
 * chat keeps its room there, else Beside — or the toast says the window is too narrow for that.
 */
function floatOrDock() {
  if (!rail.floating) {
    rail.setPlace("over");
    return;
  }
  for (const where of /** @type {const} */ (["auto", "beside"])) {
    rail.setPlace(where);
    if (!rail.floating) return;
  }
  toast("The window is too narrow to dock the panes beside the chat");
}

/**
 * The focus key (F6, proposal_ux §4.5): the focus moves on from the part of the window holding it — the sidebar, the
 * open tab, each pane shown in turn — and Shift+F6 back. A part takes it on itself, or on the message box in Chat.
 * @param {number} dir
 */
function moveFocus(dir) {
  const stops = /** @type {HTMLElement[]} */ ([shell.sidebarOpen ? shell.sidebarHost : null, shell.convFrame, ...rail.tiles()].filter((x) => !!x));
  const n = stops.length;
  const at = stops.findIndex((el) => el.contains(document.activeElement));
  const next = stops[at < 0 ? (dir > 0 ? 0 : n - 1) : (at + dir + n) % n];
  if (next === shell.convFrame && viewOf(chatOf(state.currentId)) === "chat") {
    composer.focus();
    return;
  }
  if (!next.hasAttribute("tabindex")) next.setAttribute("tabindex", "-1");
  next.focus();
}

/** Find in the task: the words are the conversation's, so the Chat view comes first. */
function findInTask() {
  views.show("chat");
  find.open();
}

/** The sidebar's Add-project: name a folder as a project in the archive — it is a project before any task lands under it. */
function addProjectDialog() {
  const input = h("input", { class: "zc-input", type: "text", placeholder: pathExample(state.platform), spellcheck: "false" });
  const browse = h("button", { class: "ghost sm", type: "button" }, "Browse…");
  const dirs = h("div", { class: "browse-dirs hidden" });
  // The OS dialog first. A cancel stops there; only a dialog that could not open falls back to the inline browser.
  browse.addEventListener("click", () => void browseFolder(input, dirs, (m) => toast(m, "err")));
  const commit = async (d) => {
    const p = input.value.trim();
    if (!p) { input.focus(); return; }
    try {
      // The server checks the folder exists (a typo must not become a project) and answers with the row.
      const row = await api("/memory/projects", { method: "POST", body: { cwd: p } });
      rememberFolder(row?.cwd || p);
      d.close();
      sidebar.load();
      toast(`Project added: ${row?.name || p}`);
    } catch (e) {
      toast(errText(e), "err");
      input.focus();
    }
  };
  const d = dialog({
    title: "Add project",
    description: "The folder appears in Projects; its chats show under it as they happen.",
    body: h("div", { class: "flex flex-col gap-2" }, input, browse, dirs),
    actions: [
      { label: "Cancel", variant: "outline", onClick: () => d.close() },
      { label: "Add", onClick: () => commit(d) },
    ],
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(d); } });
  input.focus();
}

/** The first send of a task with no project: the picker modal (recent projects and folders, a path, Browse — the OS
 *  dialog, else the folder list). Resolves with the chosen cwd, or null when dismissed — the composer then restores what
 *  was typed. */
function pickProjectFolder() {
  return new Promise((resolve) => {
    // Resolve BEFORE close(): the dialog's own onClose also resolves, and a close-then-resolve order let its
    // null win the race and drop the pick (the send restored what was typed instead of continuing).
    const done = (/** @type {string | null} */ p) => { resolve(p); try { d.close(); } catch {} };
    const input = h("input", { class: "zc-input", type: "text", placeholder: pathExample(state.platform), spellcheck: "false" });
    const recent = h("div", { class: "pick-recent" });
    // The known projects and the folders this browser remembers, deduped — one click instead of a path.
    api("/memory/projects").then((p) => {
      const cwds = [...new Set([
        ...(p?.projects || []).filter((/** @type {any} */ x) => !x.archived).map((/** @type {any} */ x) => String(x.cwd || "")).filter(Boolean),
        ...recentFolders(),
      ])].slice(0, 8);
      if (!cwds.length) return;
      recent.replaceChildren(h("div", { class: "muted small" }, "Recent"), ...cwds.map((c) =>
        h("button", { class: "ghost sm pick-recent-row", type: "button", title: c, onclick: () => done(c) }, c)));
    }).catch(() => {});
    const browse = h("button", { class: "ghost sm", type: "button" }, "Browse…");
    const dirs = h("div", { class: "browse-dirs hidden" });
    // The OS dialog first; where it cannot open — a server with none, another machine's page — the list in the page.
    browse.addEventListener("click", () => void browseFolder(input, dirs, (m) => toast(m, "err")));
    const commit = () => { const p = input.value.trim(); if (!p) { input.focus(); return; } done(p); };
    const d = dialog({
      title: "This chat needs a project folder",
      description: "Chats run under a project: pick a recent one, browse for a folder, or paste a path.",
      body: h("div", { class: "flex flex-col gap-2" }, input, browse, dirs, recent),
      actions: [
        { label: "Cancel", variant: "outline", onClick: () => done(null) },
        { label: "Use this folder", onClick: commit },
      ],
      onClose: () => resolve(null),
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
    input.focus();
  });
}

/**
 * Fork… on a chat's row: at the chat's newest turn the session forks at, as the header's Fork (`forkAt`), read from
 * its transcript — the row's count of finished turns is no turn's number once a turn failed between them.
 * @param {{ id: string, title?: string, cwd?: string, turns?: number }} s
 */
async function forkSessionRow(s) {
  if (!Number(s?.turns)) { toast("That chat has no finished turn to fork from", "err"); return; }
  try {
    const at = forkAt({ turns: transcriptTurns(await api(`/sessions/${encodeURIComponent(s.id)}/transcript?work=0`)) });
    if (!at) { toast("That chat has no finished turn to fork from", "err"); return; }
    const fork = await api(`/sessions/${encodeURIComponent(s.id)}/fork`, { method: "POST", body: { atTurn: Number(at.n) } });
    openFork({ cwd: s.cwd || "", model: "", title: s.title || "", turns: [] }, fork);
  } catch (e) {
    toast(errText(e), "err");
  }
}

/**
 * The session as the server has it: its turns (the archived user message, the work, the final answer — read-only
 * here), the boundaries between them, the settings in force, a parked question, a turn running elsewhere. Replaces
 * the chat's earlier turns in place; the turns sent from this page stay.
 * @param {any} chat @param {{ whole?: boolean }} [o]  `whole`: every turn read again (Reload), not those written since
 */
async function hydrate(chat, { whole = false } = {}) {
  if (!chat.chainId) return;
  // The transcript alone (Facade FB): a turn's numbers and notes come from its facts (D2), its card rides beside
  // it — no request records are fetched for the footers.
  const asked = Date.now();
  // Reads of one chat can be on their way at once (it opens as another tab's turn is heard, a turn's end reads it as
  // Reload does): one asked before the read drawn last holds less than that one, and draws nothing over it.
  const mine = (chat.readsAsked = (chat.readsAsked || 0) + 1);
  // Each turn's work is held back (a long session's is hundreds of megabytes): the timeline reads a turn's as its
  // row nears the screen, and what this page had read of a turn stays with it. The turns the chat holds are sent again
  // only where written since (lib/transcript-since.js): a long chat's whole read is megabytes, at each turn's end.
  const chainId = String(chat.chainId);
  const held = whole ? null : chat.served;
  const sent = await api(`/sessions/${encodeURIComponent(chainId)}/transcript?work=held${writtenSince(held, chainId)}`);
  if ((chat.readDrawn || 0) > mine) return;
  // A read drawn while this one was on its way (one asked before it, a Reload's) holds the turns on screen: the turns
  // written since are put in among those, never among the ones this read was asked with, which they replaced.
  const base = held && chat.served;
  const read = transcriptWhole(sent, base, chainId);
  // One that cannot be put together with those is read again past them; one that cannot with the turns it was asked
  // with, whole.
  if (!read) return hydrate(chat, { whole: base === held });
  chat.readDrawn = mine;
  chat.served = read.served;
  const tr = read.tr;
  opening.delete(chat);
  // …and what it had read of an ended turn's run, its changes and the meter's record (lib/turn-reads.js): a reading
  // makes every turn anew, and each would read them all again. The way a limit card took goes with them (`keptOfTurn`).
  const turns = withReadRuns(withReadWork(transcriptTurns(tr), chat.turns), chat.turns, keptOfTurn);
  // The compaction running for it now (HarnessV4_Tasks U3-5): a page opened while one runs draws it at once. The
  // feed's word, where it came after this read was asked, is the newer one.
  if ((state.compactingHeard.get(String(chat.chainId)) || 0) < asked) noteCompacting(String(chat.chainId), tr.compacting || null);
  // What its coding agent runs now beside its work (HarnessV4_Tasks U1): the events feed says each change after
  // (`setAgentTasks`), and its word, where it came after this read was asked, is the newer list.
  if ((Number(chat.agentTasksAt) || 0) < asked) chat.agentTasks = Array.isArray(tr.agentTasks) ? tr.agentTasks : [];
  // The watchers that watch it or wake it (the plan of 11-11, its w8): the feed says the list again at each change of
  // its Space's routines (`setWatchers`), and its word, where it came after this read was asked, is the newer list.
  if ((Number(chat.watchersAt) || 0) < asked) chat.watchers = Array.isArray(tr.watchers) ? tr.watchers : [];
  if (chatOf(state.currentId) === chat) paintWatchLine();
  // The turns its watchers reviewed, by their numbers: the feed says the map again where it moves (`setReviews`), and
  // its word, where it came after this read was asked, is the newer one. Put on the turns once they are merged.
  if ((Number(chat.reviewsAt) || 0) < asked) chat.reviews = tr.reviews || {};
  // The commands its agents run in the background now (HarnessV4_Background_Plan E38): the feed says each change after.
  if (Array.isArray(tr.commands)) {
    const was = commandIds(state.commands.get(String(chat.chainId)));
    if (tr.commands.length) state.commands.set(String(chat.chainId), tr.commands);
    else state.commands.delete(String(chat.chainId));
    // Now says them too: the holders read that follows sees nothing new (E38's live look, after a reload).
    if (commandIds(tr.commands) !== was) sidebar.refreshNow();
  }
  // The come-back its agent set, while it waits (the Designer's of 10-27): the feed says each change after.
  if ("comeBack" in tr) setComeBack(String(chat.chainId), tr.comeBack);
  // …and Filament's check-in on its agent idle while its command runs (the owner's of 11-08).
  if ("idleWake" in tr) setIdleWake(String(chat.chainId), tr.idleWake);
  chat.subagentSent = new Set(Array.isArray(tr.subagentSent) ? tr.subagentSent : []);
  chat.subagentHeld = new Set(Array.isArray(tr.subagentHeld) ? tr.subagentHeld : []);
  // The answers the developer overruled, each with the first line of their words (HarnessV4_Tasks E15 step 3).
  chat.subagentOverruled = new Map(Object.entries(tr.subagentOverruled || {}).map(([key, v]) => [key, { words: String(/** @type {any} */ (v)?.words || "") }]));
  // The pictures its helpers drew that no turn launched (HarnessV4_Visuals_Plan VS-D48): the session keeps them.
  chat.visuals = Array.isArray(tr.visuals) ? tr.visuals : [];
  // The pages its agent published, each by its call (HarnessV4_Artifacts_Plan AF-D38): a turn read from its archived
  // work finds each card's place by them.
  chat.made = Array.isArray(tr.artifacts) ? tr.artifacts : [];
  // …and its helpers', by helper and exchange (AFC-100): a card names them after Filament has let its helper go.
  chat.helpersMade = Array.isArray(tr.helpersMade) ? tr.helpersMade : [];
  // The chats linked to it as threads, named (core/threads.js): the header's chip reads them (`paintThreads`).
  chat.threads = tr.threads || null;
  // The agents asked in a session that has no turn yet (AG-24): with a turn, the turns hold their marks.
  chat.asked = turns.length ? [] : (Array.isArray(tr.boundaries) ? tr.boundaries : []).filter((/** @type {any} */ b) => b?.type === "subagent");
  // The cards for sub-agents that change files, as the read says them, where the feed said nothing later.
  for (const b of Array.isArray(tr.boundaries) ? tr.boundaries : []) if (b?.type === "held") takeHeld({ ...b, chainId: b.chainId || chat.chainId });
  // A turn this page sent is already on screen with its live blocks; the server's copy of it is the same turn — but
  // a turn whose reply the page gave up is drawn from the server's copy (keptPageTurns). In turn order: another
  // tab's turns can come after this page's (mergedTurns).
  chat.turns = mergedTurns(chat.turns, turns);
  reviewsMoved(chat.turns, chat.reviews);
  // What this page heard after this read was asked — an Undo (`compactionUndone`), whose compaction the read holds
  // still; a compaction it placed (`placeCompaction`, a turn's end), which the read lacks; a message it sent, which ended
  // every Undo (`sendMessage`) — is told it again, in the order heard. One heard before it is in the read; no read drawn
  // later was asked before this one.
  chat.undoneHeard = (chat.undoneHeard || []).filter((/** @type {any} */ u) => u.at >= asked);
  chat.rowsHeard = (chat.rowsHeard || []).filter((/** @type {any} */ p) => p.at >= asked);
  for (const h of [...chat.rowsHeard, ...chat.undoneHeard].sort((a, b) => a.at - b.at)) {
    if (h.sent) undoEnded(chat.turns);
    else if (h.row) afterCompactionPlaced(chat.turns, h.row, { asRead: !!h.asRead });
    else afterCompactionUndo(chat.turns, h.id, h.next);
  }
  chat.title = tr.title || "";
  // A move another page asked for, heard at its release (`sessionLetGo`): a read asked since has the chat in the
  // transcript's folder, the one it moved to, as the page that asked has it (`movedTo`). Any other read keeps the folder
  // the page holds.
  const moved = !!chat.movedAt && chat.movedAt <= asked;
  if (moved) chat.movedAt = 0;
  const cwdWas = chat.cwd;
  chat.cwd = (moved && tr.cwd) || chat.cwd || tr.cwd || "";
  chat.model = chat.model || tr.model || "";
  chat.paused = tr.paused || null;
  // The rewind that stands, while its Undo can take it back (the Designer's rewind in place): its line draws it.
  chat.rewind = tr.rewind || null;
  // The session view (Facade D7): the hydrate is one of its updaters. Settings come from the settings document
  // (the registry rides along), windows and the holder from the transcript — nothing keeps a
  // second copy of what the view holds.
  applySessionView(chat, {
    windows: tr.windows || [],
    // The transcript's live holder carries `startedAt`, the view's contract is `since` — normalized here, so
    // the queue's line and the chip's "working for" read a real figure until the events feed's next holder lands.
    holder: tr.live?.window ? { ...tr.live, since: tr.live.since ?? tr.live.startedAt } : null,
  });
  // The newest finished turn's facts ride the hydrate too (D7): the widgets' Now section survives a reload.
  const newestFacts = [...turns].reverse().find((t) => t.facts)?.facts;
  if (newestFacts) applySessionView(chat, { facts: newestFacts });
  readTurnMemory(chat);
  // A turn running elsewhere (another tab, a reload mid-run) is painted live from the start — the open fold with its
  // timer — never as an unanswered turn; then a turn of the harness's is followed here by its run. A message on no record
  // comes after it (`newestOnRecord`).
  const last = newestOnRecord(chat.turns);
  const following = !!(tr.live && !chat.live && last?.past && last.status === "open");
  if (following) {
    last.status = "streaming";
    last.startedAt = tr.live.startedAt || last.startedAt;
  }
  // The read holds every turn heard before it was asked (lib/release.js `readSince`) — except one of this harness's that
  // has taken the session and not yet written its message: still to be read, as followElsewhere reads again.
  if (!(tr.live?.window === "harness" && !following && !chat.live)) readSince(chat, asked);
  // Drawn where it shows: a chat read while another is shown (its turn ended in the background) is drawn when it is
  // shown again, as its run's events are — drawn here, it took the transcript over from the chat on screen.
  if (chatOf(state.currentId) === chat) drawChat(chat);
  // The folder came with the transcript: the header follows the chat shown, drawn there before it came.
  if (chat.id === state.currentId) headerModule.setChat(chat);
  // A move's folder, the folder's own change: its leaf, the tool cards' paths and the git chips follow it (`movedTo`).
  if (chat.cwd !== cwdWas && moved && chat.id === state.currentId) folderIn.dispatchEvent(new Event("change"));
  // The harness queue across a reload (D14): a waiting send saved before the reload comes back as its row — with
  // the queue re-armed while the chat is still held (its move, a coding agent's own turn), or sent at once when that
  // has ended.
  if (chat.chainId && !chat.waiting) {
    const owes = waitingOwes(wstore.read(String(chat.chainId)), tr.live);
    if (owes && !chat.turns.some((t) => t.status === "waiting")) {
      const payload = owes.payload;
      const files = payload.attachments || [];
      /** @type {any} */
      const turn = {
        n: nextNumber(chat.turns),
        userText: payload.text || "(attachments)",
        // The message whole, as its send drew it: its pictures and chips, and what a way on sends again (`againOf`).
        attachments: files.map((/** @type {any} */ a) => ({ name: a.name, size: a.size, kind: a.kind })),
        sent: [...files],
        userContent: [...files.map((/** @type {any} */ a) => attachmentBlock(a)), ...(payload.text ? [{ type: "text", text: payload.text }] : [])],
        blocks: [],
        steers: [],
        status: "waiting",
        segments: [],
        requestId: null,
        runId: null,
        boundaries: [],
        boundariesAfter: [],
      };
      chat.turns.push(turn);
      transcript.startTurn(turn);
      armWaiting(chat, turn, payload);
      // Its footer, once armed: the queue's line, Cancel, and Stop it and go first where it waits on a coding agent's own
      // turn.
      transcript.drawFoot(turn);
    }
  }
  // Only the transcript's open tail is followed: a turn that has taken the session but not yet written its message
  // has no row of its own here, and the run must not draw onto the turn before it (followElsewhere reads again).
  if (following && (!tr.live.window || tr.live.window === "harness")) followLiveTurn(chat, tr.live);
  else if (!tr.live && chat.paused) {
    const last = newestOnRecord(chat.turns);
    if (last && last.past) {
      // A waiting question comes back named, with its choices (TL-D11); a permission with its tool, the words it
      // asked in — the card says them, and the reply's copy of them is left out (LD-D7) — and the always-allow
      // waiting for its shape (HarnessV3-Views V3) and a command whole with the reason it asks (V6-9).
      last.paused = pauseOf(chat.paused);
      transcript.pause(last);
    }
  }
  // The view's arming (D7): the subscription that repaints the composer's faces, and the settings document.
  armSessionView(chat);
  if (chatOf(state.currentId) === chat) {
    setTitle(chat);
    if (chat.model) composer.setModel(chat.model);
    composer.setSessionView(chat.view, !!chat.chainId);
    widgets.paint();
    paintMeter(chat);
    views.draw();
    // The side pane follows the turns read: Changes' Turn shows the newest, which a pane drawn before they came lacked.
    rail.refreshInPlace();
  }
}

/**
 * The meter after the session's settings moved (HarnessV4_Tasks U3-10): a model switched to a coding agent that holds
 * none of the chat changes whose figure the ring shows, with no turn in between. Once per settings hash, never while a
 * turn runs (the running turn's own figures hold the meter).
 * @param {any} chat
 */
function meterFollows(chat) {
  const hash = String(chat.view?.settings?.hash || "");
  if (!hash || chat._meterHash === hash) return;
  const first = chat._meterHash === undefined;
  chat._meterHash = hash;
  if (!first && !chat.live) paintMeter(chat);
}

/** Records fetched for the meter, per turn: a reload asks for its newest turn's record once. */
const meterRecords = new WeakMap();
/**
 * What else the page keeps of a turn, onto the same turn of a fresh reading (lib/turn-reads.js `withReadRuns`): the
 * meter's record, the way its limit card took (`limitTaken`) and its banner dismissed (`shimDismissed`) — the page's own
 * words, which no reading holds; a reload offers the card's ways, and shows the banner, again.
 * @param {any} from @param {any} to
 */
function keptOfTurn(from, to) {
  if (meterRecords.get(from)) meterRecords.set(to, meterRecords.get(from));
  if (from.limitTaken && !to.limitTaken) to.limitTaken = from.limitTaken;
  if (from.shimDismissed) to.shimDismissed = true;
}

/**
 * The meter shows what the session holds now, not zero (HarnessV3-Launch LD-D6): the newest finished model turn that
 * measured something — its record when this page has it (the request's anatomy rides on it), else its facts, which
 * outlive the record ring (Facade D2) — until the session changes without a turn: once a compaction was written since
 * that turn, the figure is the server's measure of the next request (factsAfterCompaction). A reloaded turn asks for
 * its record once — the ring may still hold it. A chat with no finished turn holds nothing.
 * @param {any} chat
 */
function paintMeter(chat) {
  const recOf = (/** @type {any} */ t) => t.rec || meterRecords.get(t) || null;
  const newest = meterTurnOf(chat.turns, (t) => (recOf(t) ? recordHeld(recOf(t), t.rec ? t.reply?.usage : null) : t.facts ? factsHeld(t.facts) : null));
  const rec = newest ? recOf(newest) : null;
  composer.setFacts(newest?.facts || null);
  composer.setRecord(rec, rec && newest.rec ? newest.reply?.usage || null : null);
  composer.setCall(chat.lastCall || null);
  composer.setUsedAt(chat.live?.usedAt || null);
  // A popped pane's window shows no composer, so no meter: it reads nothing for one.
  if (POPPED) return;
  if (newest && !rec && newest.requestId && !meterRecords.has(newest)) {
    meterRecords.set(newest, null);
    api(`/requests/${encodeURIComponent(newest.requestId)}`)
      .then((r) => {
        if (!r) return;
        meterRecords.set(newest, r);
        if (chatOf(state.currentId) === chat && !chat.live) paintMeter(chat);
      })
      .catch(() => {});
  }
  // The figure is the preview's `current`, which the server weighs without the compactor's plan: the plain preview
  // (a long chat's plan took over a minute to weigh, for a meter that never reads it). A chat whose transcript has not
  // landed is weighed once it has: a preview asked before is for a state the chat is not in once its turns are read.
  if (chat.live || opening.has(chat) || sessionChat() !== chat) return;
  plainPreview()
    .then((p) => {
      // …or, after a switch into a coding agent that holds none of the chat, Filament's copy (U3-10).
      const after = factsAfterCompaction(p?.current) || factsOfFreshStart(p?.current);
      if (!after || chat.live || chatOf(state.currentId) !== chat) return;
      composer.setRecord(null, null);
      composer.setFacts(after);
    })
    .catch(() => {});
}

/**
 * The meter follows the running turn (BUG-20): the loop's own measure of what each round sends, or a coding agent's
 * own count of its context as it works (HarnessV3-ACP AC3-5). Kept on the turn, with the output streamed when it came,
 * and shown while its chat is. The speed gauge hears where the writing stops: a round's tools start, or its next round.
 * Each model call's prompt (`round-cache`) is the Cache instrument's last request from then on: kept on the chat, so it
 * holds past the turn's end until the session's ledger books a newer one.
 * @param {any} chat @param {any} live @param {any} e  one of the turn's run events
 */
function meterHears(chat, live, e) {
  if (e?.type === "round-cache") {
    const call = callOf(e);
    if (!call) return;
    chat.lastCall = call;
    if (chatOf(state.currentId) === chat) composer.setCall(call);
    return;
  }
  // A round's own count of what it wrote is the gauge's figure from then on: the words it streamed are measured first,
  // so the count covers them and the next round's words start after it.
  if (e?.type === "round-written") {
    if (live.meterRaf) { cancelAnimationFrame(live.meterRaf); live.meterRaf = 0; }
    measureNow(chat, live);
    live.speed.wrote(Number(e.output) || 0, e.ms == null ? null : Number(e.ms));
    paintSpeed(chat);
    return;
  }
  // The calls a round writes, as the model writes their input (a file's whole text, an edit): writing all the same, so
  // the gauge counts it with the words and thinking (the owner's word of 10-27).
  if (e?.type === "round-writing") {
    (live.callChars ||= {})[String(e.round)] = Number(e.chars) || 0;
    measureReply(chat, live);
    return;
  }
  if (pausesWriting(e)) live.speed?.pause();
  if (e?.type === "round-start" && Number(e.context) > 0) live.meter = { tokens: Number(e.context), base: live.out || 0 };
  else if (e?.type === "held" && Number(e.tokens) > 0) live.meter = { tokens: Number(e.tokens), window: e.window ?? null, exact: e.exact !== false, base: live.out || 0 };
  else return;
  if (chat.live === live && chatOf(state.currentId) === chat) composer.setLiveHeld(live.meter.tokens, live.meter);
}

/** The chats whose Browser pane opened by itself, on their agent's first browser call: once each (BR-D11). @type {Set<string>} */
const browserOpened = new Set();
/**
 * A chat's agent calls its browser: the Browser pane opens beside the chat shown, once a chat — closed again, it stays
 * closed — so the person sees what the agent does there.
 * @param {any} chat @param {any} e  one of the turn's run events
 */
function browserHears(chat, e) {
  if (e?.type !== "tool-start" || e.name !== "browser" || !chat?.chainId || browserOpened.has(chat.chainId)) return;
  if (chatOf(state.currentId) !== chat) return;
  browserOpened.add(chat.chainId);
  rail.openTab("browser");
}

/** A running turn's meter, its chat shown again: its output so far, and its newest live figure. @param {any} live */
function meterBack(live) {
  composer.setLiveOut(live.out || 0);
  if (live.meter) composer.setLiveHeld(live.meter.tokens, live.meter);
}

/**
 * The streaming reply, measured once a frame: its output folds into the meter's held figure (the real usage
 * reconciles it at the end — the output becomes part of the NEXT request's prompt), and its speed is read from the
 * stream (HarnessV3-AtHome AH-S1). A turn running in a chat not shown keeps both for when it is.
 * @param {any} chat @param {any} live
 */
function measureReply(chat, live) {
  if (live.meterRaf) return;
  live.meterRaf = requestAnimationFrame(() => {
    live.meterRaf = 0;
    measureNow(chat, live);
  });
}

/** The streaming reply, measured now: its words and thinking, and the input of the calls its rounds wrote. @param {any} chat @param {any} live */
function measureNow(chat, live) {
  const calls = Object.values(live.callChars || {}).reduce((/** @type {number} */ n, /** @type {any} */ c) => n + (Number(c) || 0), 0);
  const chars = calls + (live.reply?.blocks || []).reduce((/** @type {number} */ n, /** @type {any} */ b) => n + (b.text || "").length, 0);
  live.out = fmt.tokens(chars);
  const at = Date.now();
  (live.speed ||= createSpeedMeter()).sample(at, chars);
  // The model writing is the cache in use: the Cache instrument counts its life from the newest moment, to the second.
  if (chars !== (live.measuredChars ?? 0) && at - (Number(live.usedAt) || 0) >= 1000) live.usedAt = at;
  live.measuredChars = chars;
  if (chat.live !== live || chatOf(state.currentId) !== chat) return;
  composer.setLiveOut(live.out);
  composer.setUsedAt(live.usedAt);
  paintSpeed(chat);
}

/** How often the speed gauge is drawn again while a reply runs (ms): often enough that its figure glides. */
const SPEED_TICK_MS = 150;
/**
 * The speed gauge shows the shown chat's (AH-S1): its running reply's, once that has written enough to say a figure,
 * else its last reply's average.
 * @param {any} chat
 */
function paintSpeed(chat) {
  if (chatOf(state.currentId) !== chat) return;
  const live = chat.live;
  const now = live?.speed?.read(Date.now()) || null;
  composer.setSpeed(now && (now.rate != null || now.average != null) ? now : chat.speed || null);
  // While the reply runs the figure is drawn again on its own, so it glides between the stream's pieces instead of
  // standing still and then snapping (the owner's word of 10-27); it stops with the turn, or when the chat goes.
  if (live?.speed && !live.speedTick)
    live.speedTick = setTimeout(() => {
      live.speedTick = 0;
      if (chat.live === live) paintSpeed(chat);
    }, SPEED_TICK_MS);
}

/**
 * The reply ended: its speed settles to its average while it wrote, kept muted on the strip until the next reply
 * (AH-S1). Filament's own answer to a command was no model writing: the chat keeps the reply's before it.
 * @param {any} chat @param {any} live @param {boolean} model  a model wrote the reply
 */
function settleSpeed(chat, live, model) {
  const settled = model ? live.speed?.settle() || null : null;
  if (settled) chat.speed = settled;
  paintSpeed(chat);
}

/**
 * The open chat's session was let go — the events feed's release, or the holders resync's for one the feed dropped —
 * after a holder whose work the page drew none of as it ran: a chat's move another page asked for (`MOVE_WINDOW`: its
 * "Moved to …" row and its change rounds are the transcript's; the move this page asked for reads the chat at its own
 * end, `movedTo`). The chat is read again now, in the folder it moved to (`movedAt`), and the left bar with it. The
 * chat's own send, should one run meanwhile, reads it at its end. A harness turn is followed by its run, and its release
 * reads nothing more.
 * @param {any} chat @param {any} was  the holder the view had
 */
function sessionLetGo(chat, was) {
  if (was?.window !== MOVE_WINDOW || movesHere(chat)) return;
  chat.movedAt = Date.now();
  if (chat.live) {
    chat.hydrateAfterSend = true;
    return;
  }
  hydrate(chat).catch(() => {});
  sidebar.load();
}
/**
 * The open chat is an outside client's, whose turn ended — the events feed's word with no holder, as no lock holds a
 * client's chat (the server hears it of memory): the turn its client sent is on record now, and the chat is read again.
 * The chat's own send, should one run meanwhile, reads it at its end; the left bar reads its list on the same word.
 * @param {any} chat
 */
function clientTurnEnded(chat) {
  if (chat.live) {
    chat.hydrateAfterSend = true;
    return;
  }
  // Out of sight, the read waits for the page to show again (`catchUpOnShow`).
  if (!pageShown()) return void catchUpOnShow();
  hydrate(chat).catch(() => {});
}
/**
 * The open chat's view after the five-second holders read (D11), where the feed dropped a holder change: set right as
 * the feed's own `turn` would have — a take (the queue waits, another harness tab's turn is drawn) or a release (the
 * queue is freed, and a move the page drew none of is read, `sessionLetGo`). The read keeps no holder older than the
 * feed's word (sidebar.js `loadHolders`); a chat whose own turn runs has its holder from that turn. A chat being opened
 * is being read: its read sets its view, and another harness tab's turn that holds it is read once that read has
 * landed, where the read did not follow it (`noteUnseenTurn`, openSession) — never by a read beside it, which drew the
 * turn twice.
 * @param {any} c  the chat shown
 */
function resyncHolder(c) {
  if (!c?.chainId || c.live) return;
  const held = state.holders.get(String(c.chainId)) || null;
  if (opening.has(c)) return void (held?.window === "harness" && noteUnseenTurn(c, null, Date.now()));
  const was = c.view?.holder || null;
  if ((held?.window || null) === (was?.window || null)) return;
  applySessionView(c, { holder: held });
  if (held?.window === "harness") followElsewhere(c);
  else sessionLetGo(c, was);
}
// A chat's running commands, the whole list at each start and end (HarnessV4_Background_Plan E38-D4): the open chat's
// status draws them; the left bar's Now reads the same list.
onBus((msg) => {
  if (msg?.type === "commands" && msg.chainId) setCommands(String(msg.chainId), msg.commands);
});
// A chat's come-back at each set, replace, Cancel, Stop and its time coming (the Designer's of 10-27): the open chat's
// status says it; the left bar's Now reads the same map.
onBus((msg) => {
  if (msg?.type === "come-back" && msg.chainId) setComeBack(String(msg.chainId), msg.comeBack);
  if (msg?.type === "idle-wake" && msg.chainId) setIdleWake(String(msg.chainId), msg.idleWake);
});
// A chat named by the side model (Settings › Experimental): its name now, which the header writes in where it shows.
onBus((msg) => {
  if (msg?.type !== "named" || !msg.chainId || !msg.title) return;
  const chat = chatByChain(String(msg.chainId));
  if (!chat) return;
  chat.title = String(msg.title);
  if (chat !== chatOf(state.currentId)) return;
  setTitle(chat);
  titleEl.classList.add("is-named");
  setTimeout(() => titleEl.classList.remove("is-named"), NAMED_MS);
});
// A chat's coding agent's own tasks, the whole list at every change (HarnessV4_Tasks U1): the chat's status lists them.
onBus((msg) => {
  if (msg?.type === "agent-tasks" && msg.chainId) setAgentTasks(String(msg.chainId), msg.tasks);
});
// A chat's watchers, the whole list at each change of its Space's routines: the lines over its box say them.
onBus((msg) => {
  if (msg?.type === "watchers" && msg.chainId) setWatchers(String(msg.chainId), msg.watchers);
});
// …and the turns of a chat its watchers reviewed, the whole map at each review: the chip under each turn says them.
onBus((msg) => {
  if (msg?.type === "reviews" && msg.chainId) setReviews(String(msg.chainId), msg.reviews);
});
// Every holder change, for every session, rides the events feed (Facade D11): it is where the open chat's view hears
// its holder — the release included, which the waiting queue sends on.
/**
 * A holder the feed said of a chat the page keeps, shown or not: a move's take is kept (`movingHeard`), and its release
 * marks the move — the chat's next read has it in the folder it moved to (`movedAt`, hydrate). Another holder ends it.
 * @param {any} chat @param {any} holder
 */
function heardMove(chat, holder) {
  if (!chat) return;
  if (holder?.window === MOVE_WINDOW) return void movingHeard.add(chat);
  if (movingHeard.delete(chat) && !holder && !movesHere(chat)) chat.movedAt = Date.now();
}
onBus((msg) => {
  if (msg?.type !== "turn") return;
  if (msg.chainId) heardMove(chatByChain(String(msg.chainId)), msg.holder || null);
  const shown = chatOf(state.currentId);
  // The chat shown follows its turns as they come once its first read has landed (openSession).
  const chat = shown && !opening.has(shown) ? shown : null;
  if (!chat?.chainId || chat.chainId !== msg.chainId) {
    // A chat the page keeps but does not show: its turn (a wake, a resume, another tab's) is read when it is shown. The
    // chat being opened reads it once its first read has landed, where that read did not hold it — never by a read
    // beside it, which drew the turn twice.
    if (msg.chainId) noteUnseenTurn(chatByChain(String(msg.chainId)), chat, Date.now());
    return;
  }
  const was = chat.view?.holder || null;
  applySessionView(chat, { holder: msg.holder || null });
  // The page's own turn compacting before its request (decision 1 of the codebase pass): said on the live fold.
  if (chat.live && (msg.holder?.window === "harness" || !msg.holder)) transcript.phase(chat.live.turn, msg.holder?.phase || null);
  // Another harness tab's turn (the tab that writes the session, decision 22): drawn here as it runs.
  if (msg.holder?.window === "harness" && !chat.live) followElsewhere(chat);
  if (!msg.holder) sessionLetGo(chat, was);
  // An outside client's chat, which nothing held: its client's turn ended.
  if (!msg.holder && !was && isClientView(chat.view)) clientTurnEnded(chat);
});

// Each running compaction, for every session, rides the events feed with its session's id (HarnessV4_Tasks U3-5):
// its step, what its calls have written, the last byte — then its end (`progress: null`). The open chat's is the
// Compacting row after its last turn; another chat's is kept for when it is opened.
onBus((msg) => {
  if (msg?.type !== "compaction-progress" || !msg.chainId) return;
  state.compactingHeard.set(String(msg.chainId), Date.now());
  noteCompacting(String(msg.chainId), msg.progress || null);
});

// What a compaction cost reaches its row a beat after the row is drawn (HarnessV4_Tasks U3-11): its calls' records
// finish after its summary lands, and the server says the sum on the same feed. The row takes it where this page holds
// the chat; the Compactions list reads it with its rows.
onBus((msg) => {
  if (msg?.type !== "compaction-cost" || !msg.chainId || !msg.cost) return;
  const chat = chatByChain(String(msg.chainId));
  if (!chat) return;
  const open = chatOf(state.currentId) === chat;
  for (const t of afterCompactionCost(chat.turns, Number(msg.id), msg.cost)) if (open) transcript.drawBoundaries(t);
  if (!open) return;
  bustPreview();
  repaintContextHow(true);
});

// A compaction undone in another tab (`compaction-undone`): its row leaves this page's transcript too, and the Undo
// moves to the compaction the server names, as the tab that undid it draws them; that tab hears it too, which changes
// nothing there (`afterCompactionUndo` holds).
onBus((msg) => {
  if (msg?.type !== "compaction-undone" || !msg.chainId) return;
  const chat = chatByChain(String(msg.chainId));
  if (chat) compactionUndone(chat, Number(msg.id), msg.undoable == null ? null : Number(msg.undoable));
});

// Each request a session books moves its ledger (`spend`): the Spend and Cache read it from the view, so a running
// turn's cost follows its model calls rather than waiting for the turn's end. Another chat's view is read when it is
// opened.
onBus((msg) => {
  if (msg?.type !== "spend" || !msg.chainId || !msg.usage) return;
  const chat = chatByChain(String(msg.chainId));
  if (chat?.view?.settings) applySessionView(chat, { settings: { usage: msg.usage } });
});

// A summary Filament wrote for its copy of a coding agent's chat, in the background (HarnessV4_Tasks C29): nobody asked
// for it, so its row comes on the feed — drawn where this page holds the chat — or the reason it was not written.
onBus((msg) => {
  if (msg?.type !== "compaction-landed" || !msg.chainId) return;
  const chat = chatByChain(String(msg.chainId));
  if (!chat) return;
  const open = chatOf(state.currentId) === chat;
  if (msg.error) return void (open && toast(String(msg.error), "err"));
  if (!msg.boundary) return;
  placeCompaction(chat, msg.boundary);
  if (!open) return;
  widgets.paint();
  repaintContextHow(true);
});

/**
 * What the server says of a session's compaction now; null when none runs. @param {string} chainId @param {any} progress
 */
function noteCompacting(chainId, progress) {
  const began = !state.compacting.has(chainId);
  if (progress) state.compacting.set(chainId, progress);
  else if (!state.compacting.delete(chainId)) return;
  // Begun or over, the left bar's Now moves the chat (`compactingChats`); its progress between moves nothing there.
  if (began || !progress) sidebar.refreshNow();
  const chat = chatOf(state.currentId);
  if (chat?.chainId && String(chat.chainId) === chainId) {
    paintCompacting(chat);
    paintStatus(chat);
  }
  if (!progress) roomMade(chatByChain(chainId));
}

/**
 * A compaction is being written for the chat between its turns (`state.compacting`), or this page asked for one and its
 * answer is on its way (`compactAsked`, `compactNow`: the feed's first word of it comes after the server's claim): a
 * message sent now would meet the context before it. The summary of Filament's copy alone (C29) is none such — the
 * agent's session goes on as it is, and the next message goes whether it has landed or not. @param {any} chat
 */
function compactingBetween(chat) {
  if (!chat?.chainId || chat.live) return false;
  if (Number(chat.compactAsked) > 0) return true;
  const p = state.compacting?.get(String(chat.chainId));
  return !!p && p.door !== "copy";
}

/**
 * The header's folder is another than the chat's, which has begun: the person's new message from the box opens a new
 * chat there (`readySession`'s `opens`), and no compaction of this chat's holds it. @param {any} chat
 */
function opensElsewhere(chat) {
  const chip = String(folderIn?.value || "").trim();
  return !!chip && chip !== chat.cwd && !!(chat.chainId || chat.making || chat.turns?.some((/** @type {any} */ t) => !t.past));
}

/**
 * The room is made (`noteCompacting`'s end, the summoned card's Compact): what was sent while the compaction was written
 * and waits in the chat's queue for it (`sendMessage`'s `roomWait`) goes now — the shown chat's from its box's queue,
 * another's from its own. A message the page sends itself once the room is made goes first, and the queue at its turn's
 * end: a card's Compact and send (`makingRoom`), the summoned card's Compact (`work`), a turn begun meanwhile.
 * @param {any} chat
 */
function roomMade(chat) {
  if (!chat?.roomWait || compactingBetween(chat) || chat.turns?.some((/** @type {any} */ t) => t.makingRoom) || chat.summoned?.work) return;
  chat.roomWait = false;
  if (chat.live) return;
  if (chatOf(state.currentId) === chat) composer.goOn();
  else void drainElsewhere(chat);
}

/**
 * This page's compaction did not make the room — it failed, or was stopped (the review of bf2fbda19: what waited for it
 * stood in a queue nothing would send): what was sent meanwhile waits, paused, saying so, for Continue — sent now, it
 * would meet the card that asks before a message. @param {any} chat
 */
function roomNotMade(chat) {
  // Another compaction is still written (one asked beside it, another tab's): what waited waits for that one.
  if (!chat?.roomWait || compactingBetween(chat)) return;
  chat.roomWait = false;
  const st = queueOf(chat);
  if (!st.items.length) return;
  st.paused = true;
  st.why = "refused";
  st.said = "The compaction did not make room: what you sent meanwhile waits here";
  st.again = true;
  if (chatOf(state.currentId) === chat) composer.setQueue(st);
}

/**
 * The compactions running now, as the five-second resync read them (`GET /sessions/holders`): a start or an end the
 * feed dropped is corrected here, so no row stands for a compaction that is over. @param {any} r  the route's answer
 */
function syncCompacting(r) {
  if (!r || !Array.isArray(r.compacting)) return;
  const running = new Map(r.compacting.map((/** @type {any} */ c) => [String(c.chainId), c.progress]));
  for (const id of [...state.compacting.keys()]) if (!running.has(id)) noteCompacting(id, null);
  for (const [id, progress] of running) noteCompacting(id, progress);
}

/**
 * The open chat's Compacting row (UX-8), with its stop: the compaction's own where the server says it has one
 * (Compact's, /autofit's), else the turn's it runs in — a turn at its line, a typed command — which stops with it.
 * @param {any} chat
 */
function paintCompacting(chat) {
  const p = chat?.chainId ? state.compacting.get(String(chat.chainId)) || null : null;
  if (!p) return transcript.compacting(null);
  // The summary of Filament's copy alone (C29): stopped, the copy stays as it is until the agent next compacts.
  if (p.stoppable && p.door === "copy") return transcript.compacting(p, { onStop: () => stopCompaction(chat), stopTitle: "Stop writing: Filament's copy keeps its turns as they are, until the agent next compacts" });
  if (p.stoppable) return transcript.compacting(p, { onStop: () => stopCompaction(chat), stopTitle: "Stop writing: nothing is compacted" });
  if (chat.live) return transcript.compacting(p, { onStop: () => stopCurrent(), stopTitle: "Stop the turn: its compaction stops with it, and your message is not sent" });
  transcript.compacting(p);
}

/** Stop the compaction being written for a chat outside a turn: the Compact that asked for it answers that it was stopped. @param {any} chat */
async function stopCompaction(chat) {
  try {
    const r = await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/compact/stop`, { method: "POST", body: {} });
    // Nobody waits on the summary of Filament's copy: its stop is answered here.
    if (r?.copy) toast("Stopped: Filament's copy keeps its turns as they are, until the agent next compacts");
  } catch (e) {
    toast(errText(e), "err");
  }
}

/** How many failed reads running a catch-up tries before it leaves the transcript as drawn: about 12 s of backing off. */
const FOLLOW_TRIES = 8;
/**
 * Another tab's turn on the open session, drawn here live (decision 22: a following tab draws everything) — and, as the
 * chat is shown again, a turn that ran on it while another chat was shown (`readsOnShow`). Its holder
 * rides the feed the moment the turn takes the session, a beat before the turn's message is in the transcript: the
 * transcript is read until it shows the open turn (the hydrate then follows its run, and settles it at the end) or the
 * turn is over (the last read drew it whole), backing off to two seconds between reads. One catch-up per chat. Out of
 * sight it reads nothing (the owner's Mac of 11-14: a page kept hidden read a long chat's transcript every two seconds
 * while another window's turn held it): the chat shown is read once as the page shows again (`catchUpOnShow`). A turn
 * its coding agent began by itself is followed out of sight still: the page that follows it says its end out loud.
 * @param {any} chat
 */
async function followElsewhere(chat) {
  if (chat.catchingUp) return;
  chat.catchingUp = true;
  try {
    let failed = 0;
    for (let wait = 250; ; wait = Math.min(2000, wait * 2)) {
      if (chat.live || chatOf(state.currentId) !== chat) return;
      if (!pageShown() && !chat.view?.holder?.own) return void catchUpOnShow();
      try {
        await hydrate(chat);
        if (chat.live || chat.view?.holder?.window !== "harness") return;
        failed = 0;
      } catch (e) {
        // A failed read is read again, backing off as these reads do, while the chat is shown — as a turn's run is polled
        // again (followLiveTurn): a turn that ends elsewhere asks for no read here, so nothing else would draw it. A
        // session that does not exist is read no more, and a failure FOLLOW_TRIES reads running leaves the transcript as
        // drawn, for the next holder change to ask again.
        if (String(/** @type {any} */ (e)?.status) === "404" || /404|no such session/i.test(errText(e))) return;
        if (++failed >= FOLLOW_TRIES) return;
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    chat.catchingUp = false;
  }
}
/**
 * The chat on screen read again once the page shows again, where a read of it waited while the page was out of sight
 * (lib/page-shown.js): what ran on it meanwhile is drawn, and a turn another window still runs on it is followed from
 * there (`followElsewhere`). However many reads waited, it is one. A chat being opened reads itself (openSession).
 */
function catchUpOnShow() {
  whenPageShown("the chat shown", () => {
    const c = chatOf(state.currentId);
    if (c?.chainId && !c.live && !opening.has(c)) void followElsewhere(c);
  });
}
// The open chat's settings document moved elsewhere (the dashboard, another tab, a `/set`): the feed says so with the
// new hash, the view reads the document again unless it holds that hash, and every widget repaints from it (BUG-10
// P9). Another chat's view is read when it is opened.
onBus((msg) => {
  if (msg?.type !== "settings") return;
  const chat = chatOf(state.currentId);
  if (!chat?.chainId || chat.chainId !== msg.chainId) return;
  chat.settingsFollow ||= settingsFollower({ held: () => chat.view?.settings?.hash || null, read: () => refreshSessionDoc(chat) });
  chat.settingsFollow(msg.hash);
});
// A team saved, edited or deleted elsewhere (another tab's Agents page): the open chat's settings document lists the
// teams by name, so it is read again, and the Team view and widget repaint from it. The document's hash is the
// session's own settings', which a team's save does not move: the read is not skipped for holding it.
onBus((msg) => {
  if (msg?.type !== "teams-changed") return;
  void readTeams();
  const chat = chatOf(state.currentId);
  if (chat?.chainId) refreshSessionDoc(chat);
});

// Which tab writes the open session (HarnessV3-FixRound decision 22). The server keeps one writing tab per session;
// this page asks for the session it shows and paints the answer — the composer says where it is open, this computer's
// other window or another machine by its name. The writing follows the person (the owner's of 11-14: his PC's chat
// open in his MacBook's window too, "the Take Over button above the composer keeps hopping around on both machines"):
// what the person types, sends or presses here takes it over (lib/tab.js `acting`), and a session another window let
// go is free — nobody's until a window shows it or the person writes in one, so a window nobody uses never takes it. The
// page asks when it shows another session (or none), when its session is born, and when its events stream (re)opens
// (the server let go of whatever it wrote when the stream closed: a window that wrote it asks for it again, any other
// only asks who writes it); and a write of its own refused, it asks who writes it.
/** The server's last answer: the session this tab asked about, the tab that writes it and where that one is, and whether it is this one. */
let writing = { chainId: /** @type {string | null} */ (null), you: true, writer: /** @type {string | null} */ (null), where: /** @type {any} */ (null) };
/** Where this page is, as the server last said it: this computer, or a paired machine. @type {any} */
let writingHere = null;
// What a write made as the person acts here takes over: the chat on screen alone (lib/tab.js `takeNow`).
whenShown(() => chatOf(state.currentId)?.chainId || null);
const claim = writerClaim({
  send: (chainId, how) => api("/tabs/open", { method: "PUT", body: { chainId, ...(how === "take" ? { take: true } : how === "peek" ? { peek: true } : {}) } }),
  onAnswer: (answer) => {
    writing = { chainId: answer?.chainId ?? null, you: answer?.you === true, writer: answer?.writer ?? null, where: answer?.where ?? null };
    if (answer?.here) writingHere = answer.here;
    paintWriting();
  },
});
/**
 * Ask for the session on screen: to write it if none does (`open`), to take it (`take`), or only who writes it (`peek`).
 * @param {"peek" | "open" | "take"} [how]
 */
function claimWriting(how = "open") {
  // A popped pane's window is no tab of its own (BS4): the main window writes its chat. A view-only device's page
  // writes none, and claims none (the server refuses it the claim).
  if (POPPED || viewOnlyPage()) return;
  claim(chatOf(state.currentId)?.chainId || null, how);
}
/** Another tab writes the open session: this one follows it. */
function readOnlyNow() {
  const chainId = chatOf(state.currentId)?.chainId || null;
  return !!chainId && writing.chainId === chainId && !writing.you && !!writing.writer;
}
/**
 * Whether what this window would write now waits or is refused: another tab writes the open session and the person is
 * not acting here. The person acting here takes it over, and the write goes (its request takes it at the server too).
 */
function followsStill() {
  if (!readOnlyNow()) return false;
  if (!acting()) return true;
  claimWriting("take");
  return false;
}
/** Where the open session is written from, in words: on another machine by its name, else in another window. */
const openWhere = () => (writing.where?.name && writing.where.key !== writingHere?.key ? `on ${writing.where.name}` : "in another window");
/** What a write refused here is told, where the person did not act. */
const readOnlyWords = () => `This chat is open ${openWhere()} — type or send here to take it over`;
function paintWriting() {
  composer.setReadOnly(readOnlyNow(), `Open ${openWhere()} — type here to take it over`);
}
/** The events feed's first hello is the page's start; each after it, a reconnect (a sleep, Filament restarting). */
let feedHeard = false;
/**
 * The events feed came back: what it said while it was down was never heard — a turn that ran, a wake, a resume after a
 * restart, a coding agent's tasks that changed (`setAgentTasks`). The chats the page keeps are read again as they are
 * shown (lib/release.js `noteUnseenTurn`), the open one now, where nothing of its own runs — or, while its first read is
 * on its way, once that read has landed (openSession); one whose own turn runs is read at that turn's end
 * (`hydrateAfterSend`).
 */
function afterFeedGap() {
  const shown = chatOf(state.currentId);
  const drawing = shown && !opening.has(shown) ? shown : null;
  const at = Date.now();
  for (const c of state.chats.values()) {
    // A move the feed told of may have ended while it was down: its chat's next read has it where it moved.
    if (movingHeard.has(c) && !movesHere(c)) c.movedAt = at;
    if (c.live) c.hydrateAfterSend = true;
    else noteUnseenTurn(c, drawing, at);
  }
  if (drawing?.chainId && !drawing.live) followElsewhere(drawing);
  // Filament may have started again: the tips' file is read anew, and replays where it says so.
  if (!POPPED && !CHAT_ONLY && !viewOnlyPage()) void coach.reload().then(coachRead);
}
onBus((msg) => {
  if (msg?.type === "hello") {
    // The page's start asks for the chat it shows. A reconnect asks again for one this window wrote — the server let
    // it go as the stream closed —, and only who writes any other: a window nobody uses never takes a chat back.
    const wrote = !feedHeard || (writing.you && writing.chainId === (chatOf(state.currentId)?.chainId || null));
    if (feedHeard) afterFeedGap();
    feedHeard = true;
    return claimWriting(wrote ? "open" : "peek");
  }
  if (msg?.type !== "writer") return;
  const chainId = chatOf(state.currentId)?.chainId || null;
  if (!chainId || chainId !== msg.chainId) return;
  // Let go (no tab): the session is free, and this window takes it only as the person writes in it.
  writing = { chainId, you: !!msg.tab && msg.tab === TAB_ID, writer: msg.tab || null, where: msg.tab ? msg.where ?? null : null };
  paintWriting();
});
whenReadOnly(() => claimWriting("peek"));

/** The run log's word on a run, for the live view's watchdog: its meta, or null when the log knows no such run.
 *  @param {string} id */
const runLookup = (id) => api(`/runs/${encodeURIComponent(id)}`).then((r) => r?.run || null, (e) => {
  if (/404/.test(errText(e))) return null;
  throw e;
});
/** The newest run event a live turn has heard. @param {any} live */
const cursorOf = (live) => Number(live.events[live.events.length - 1]?.n) || 0;

/**
 * A live turn's run is known: a message sent from now on steers it (sendMessage), and the composer says so while the
 * turn's chat is the one shown. A chat switched back to finds the kind on its live turn (selectChat). A coding
 * agent's run says whether its agent takes words into its running turn (HarnessV3-ACP AC3-1) or at its next step
 * (AC-D6) or queues them as Claude Code does (HarnessV3-FailurePoints §7.2), whether a note can interrupt it instead
 * (FP-D8), and names the agent — the one a queued note waits at, and the one whose own turn a message waits behind
 * (AC3-9).
 * @param {any} chat @param {any} live @param {{ kind: string, meta?: any }} run  the run's start: its kind and meta
 */
function runKnown(chat, live, run) {
  live.runKind = run.kind;
  live.steer = run.meta?.steer || null;
  live.pictures = run.meta?.steerImages === true;
  live.interrupts = run.meta?.interrupts === true;
  live.agent = run.meta?.agent ? String(run.meta.agent) : null;
  live.own = run.meta?.own?.agent || null;
  live.unfollowed = false;
  if (chat.live === live && chatOf(state.currentId) === chat) composer.setLive(true, liveRun(live));
}

/**
 * What the composer is told of a live turn's run: none until it is known — or, for a turn followed from elsewhere
 * whose run the server does not hold, that there is none to follow (HarnessV4_Tasks U4). @param {any} live
 */
const liveRun = (live) => (live?.runKind ? { kind: live.runKind, steer: live.steer || null, own: live.own || null, interrupts: !!live.interrupts, pictures: !!live.pictures } : live?.unfollowed ? { kind: "", unfollowed: true } : null);

/**
 * Notes a turn ended before its agent took them — a coding agent's (HarnessV3-ACP AC3-1), and Filament's loop's, whose
 * notes a stop left unread were only marked so and never sent (the owner's of 11-09): they go out as the next message,
 * in the order sent, and their bubbles say so. A veto or a compact left unread was about the turn that ended, and goes
 * nowhere; nor does a note the person did not type. The tab that writes the session sends them; one that follows it leaves them to that tab.
 * @param {any} chat @param {any} live @param {any} e  the run's `steer-unread`
 */
function agentUnheard(chat, live, e) {
  if (e?.type !== "steer-unread" || (live.runKind !== "coding-agent" && live.runKind !== "agent-turn") || (writing.chainId === chat.chainId && !writing.you)) return;
  const ids = new Set(e.ids || []);
  // Only what the person typed: a note with a sender (`from`: a watcher's guidance, Filament's own word) is none of
  // their messages, and never goes out as one — a watcher's guidance Filament sends on itself (app/watchers/guidance.js).
  const list = live.turn.steers.filter((/** @type {any} */ s) => ids.has(s.id) && s.kind === "note" && !s.next && !s.from);
  if (!list.length) return;
  for (const s of list) s.next = true;
  transcript.markSteers(live.turn);
  const said = list.length === 1 ? "The turn ended before the agent took your message — it goes out as the next one" : `The turn ended before the agent took ${list.length} messages — they go out next, in order`;
  // The turn each starts says it is a note sent again, which nobody pressed for (`via`, the owner's of 11-09): its first
  // send's row is on the run's `steer` event already.
  const via = { row: "unread-note", by: /** @type {const} */ ("auto") };
  // Its pictures go with it (HarnessV4_Tasks C22).
  if (!list.some((/** @type {any} */ s) => s.files?.length)) return unheardNext(chat, list.map((/** @type {any} */ s) => ({ text: s.text, files: [], via })), said);
  void Promise.all(list.map(steerFiles)).then((files) => unheardNext(chat, list.map((/** @type {any} */ s, i) => ({ text: s.text, files: files[i], via })), said));
}

/**
 * Notes the turn ended before its agent read them, into the chat's queue as its next messages (queue.js `queueUnheard`):
 * they go whatever ended the turn, a stop's too — they were sent into it, and their toast says they go (the hunt of
 * 11-09: a stop's pause held them for Continue) —, and at once where the run said so only after the turn's end. Another
 * chat shown, they wait in their own chat's queue, which sends them as `endedElsewhere` would.
 * @param {any} chat @param {import("./composer/queue.js").QueuedMessage[]} texts @param {string} said  why, for the toast
 */
function unheardNext(chat, texts, said) {
  if (chatOf(state.currentId) !== chat) {
    if (queueUnheard(queueOf(chat), texts, !chat.live)) void drainElsewhere(chat);
    return;
  }
  composer.enqueueUnheard(texts);
  toast(said);
}

/**
 * A steered message's pictures as the box attaches them: the page's own bytes, or — kept beside the run's log by their
 * ref (V4-D303) — read back from there. One neither holds is left out.
 * @param {any} s  its bubble @returns {Promise<any[]>}
 */
async function steerFiles(s) {
  const names = Array.isArray(s.files) ? s.files : [];
  const out = [];
  for (const [i, name] of names.entries()) {
    const shot = s.shots?.[i];
    const own = /^data:([^;]+);base64,(.+)$/s.exec(String(shot?.src || ""));
    if (own) {
      out.push({ kind: "image", name: String(name), type: own[1], data: own[2], size: Math.floor((own[2].length * 3) / 4) });
      continue;
    }
    if (!shot?.ref) continue;
    try {
      const res = await fetch(pictureUrl(String(shot.ref)));
      if (!res.ok) continue;
      const blob = await res.blob();
      const data = await new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => resolve(String(rd.result).split(",")[1] || "");
        rd.onerror = () => reject(rd.error);
        rd.readAsDataURL(blob);
      });
      if (data) out.push({ kind: "image", name: String(name), type: blob.type || "image/png", data, size: blob.size });
    } catch {}
  }
  return out;
}

/**
 * A message taken back from the running turn before its run took it (HarnessV4_Tasks C34): the run lets it go and its
 * bubble leaves; for Edit its words and pictures are back in the box, before what the box held, to change and send
 * again. One the run took meanwhile stays, and the run's words say why.
 * @param {any} turn @param {any} s  its bubble @param {boolean} edit
 */
async function takeBackSteer(turn, s, edit) {
  const chat = chatOf(state.currentId);
  const live = chat?.live;
  if (!live || live.turn !== turn || !live.runId) return void toast("The turn has ended: nothing waits on it any more", "err");
  if (followsStill()) return void refuse(readOnlyWords());
  // Read before it is let go: the run's copy of a kept picture outlives the message, the page's own bytes are the bubble's.
  const files = edit ? await steerFiles(s) : [];
  try {
    await api(`/runs/${encodeURIComponent(live.runId)}/steer/${encodeURIComponent(String(s.id))}`, { method: "DELETE" });
  } catch (e) {
    return void toast(errText(e), "err");
  }
  turn.steers = turn.steers.filter((/** @type {any} */ x) => x.id !== s.id);
  transcript.markSteers(turn);
  if (edit) composer.takeBack(String(s.text || ""), files);
  if (edit && files.length < (s.files?.length || 0)) toast("A picture of it could not be read back — attach it again", "err");
}

/**
 * A turn that runs on another socket (a second tab, or this page after a reload mid-run): its run is followed
 * from the ring so the cards arrive live, and its words beside them (HarnessV3-Launch LD-D16), drawn as the sending
 * page draws its reply; when the run ends the transcript is fetched again for the final text. Its run is known once
 * the stream names it, as a send's own turn learns it: a message sent before then is held for it, one sent after
 * steers it. A turn still composing has no request yet: the poll that watches for its end follows its run once the
 * transcript names the request. A turn with no run (a plain model) is polled until the server no longer names it
 * live, and what was held for it goes out as the next message.
 * @param {any} chat @param {{ requestId: string | null, startedAt: number }} liveInfo
 */
/**
 * The word a turn's end is said in out of sight (`sayEnded`): a question or a yes it paused on, else how it ended — but
 * a message a card stopped waits for your answer, as a question does: nothing ran, so it neither completed nor failed
 * (the owner's of 11-01). @param {any} turn @returns {"done" | "error" | "paused" | "question"}
 */
function endWord(turn) {
  if (turn.paused) return turn.paused.kind === "question" ? "question" : "paused";
  if (stoppedToAsk(turn.reply)) return "question";
  return turn.status === "error" ? "error" : "done";
}
/**
 * A turn that ended while the tab was hidden, said out loud — the notification, its chime — and the row takes the
 * unread dot. @param {any} chat @param {string} status  done, error, paused or question
 */
function sayEnded(chat, status) {
  notifyRunEnded({
    title: chatTitle(chat),
    status,
    chainId: chat.chainId || undefined,
    onFocus: () => { if (chat.chainId) openSession({ id: chat.chainId, title: chatTitle(chat), cwd: chat.cwd }); },
  });
  ensureNotificationPermission();
}

/**
 * @param {any} chat @param {any} liveInfo
 * @param {boolean} [mine] this page's own send, followed again after its connection dropped: its end in a chat not shown
 *   sends that chat's next queued message, as the send's own end does; a turn found as a chat is read leaves its queue paused
 */
function followLiveTurn(chat, liveInfo, mine = false) {
  const turn = newestOnRecord(chat.turns);
  if (!turn || !turn.past) return;
  turn.status = "streaming";
  turn.requestId = liveInfo.requestId || turn.requestId;
  turn.elsewhere = true;
  // Its run's log is read by the follow below, from its first event: the timeline's read of a past turn's cards would
  // read the same log again beside it, and each copy aligned onto the turn started the other's alignment over. A turn
  // whose run the live state names no run for yet — a reply asked for whole names it only as it ends — is the
  // timeline's to read meanwhile, as a past turn's cards are, and followed once the poll names it.
  if (liveInfo.requestId) turn.runRead = Promise.resolve();
  const aborter = new AbortController();
  /** @type {any} */
  const live = { turn, aborter, reply: null, runId: null, follower: null, events: [], stopSent: false, chat, elsewhere: true, usedAt: Number(liveInfo.startedAt) || Date.now(), held: createHeldSteers({ post: steerPost }) };
  chat.live = live;
  transcript.startLive(live);
  if (chatOf(state.currentId) === chat) composer.setLive(true, null);
  nowIn(chat);
  if (chatOf(state.currentId) === chat) composer.setUsedAt(live.usedAt);
  // The turn drawn from its run's whole log, once a frame however many events land (the bug report's X1). What the
  // events say to the composer is said once they are drawn: a steer the log carries first is the turn's only then.
  const runDraw = createRunDraw((landed) => {
    transcript.applyEvents(turn, live.events);
    for (const e of landed) agentUnheard(chat, live, e);
    nowIn(chat);
    // The panes and the views are the shown chat's: a turn running in a chat not shown leaves them as they are (a
    // switch draws them).
    if (chatOf(state.currentId) === chat) {
      rail.pulse();
      views.pulse();
    }
  });
  // Followed from its first event, a long run's replay passes every step it took: the turn's draws and its words wait
  // out of sight until it is in, then land at once (lib/replay-hold.js; the owner's of 11-16, tool calls "rapidly
  // showing up and hiding" under the newest words). Its words are drawn first, as a follow's first frame draws them.
  const replay = createReplayHold({
    onHold: () => {
      runDraw.hold();
      transcript.loading(turn, true);
    },
    onEnd: () => {
      if (chat.live === live && live.reply) transcript.drawBlocks(live, { redraw: true });
      transcript.loading(turn, false);
      runDraw.release();
      runDraw.now();
    },
  });
  const settle = async () => {
    if (chat.live !== live) return;
    runDraw.now(); // what landed last is drawn while the turn is live, as the rest was
    transcript.flushBlocks(live); // and the reply's last words, which its pace may hold back
    replay.end(); // and the words a replay still passing held back, drawn whole
    // Its follow heard the run's end: its log is all here and aligned, and the turn keeps the alignment alone (labels.js
    // `letGoOfLog`), which the reading below takes for the turn it makes anew (lib/turn-reads.js) rather than reading
    // the log a third time.
    if (live.whole && !live.holed && turn.alignCache) letGoOfLog(turn.alignCache, live.events);
    chat.live = null;
    live.watch?.stop();
    nowIn(chat);
    // The words stopped: a frame still pending measures them now, for the speed the reply settles to.
    if (live.meterRaf) { cancelAnimationFrame(live.meterRaf); live.meterRaf = 0; measureNow(chat, live); }
    if (turn.liveLost) transcript.liveLost(turn, false);
    // The read a turn's end owes (`hydrateAfterSend`: its reply drawn from the transcript's copy, the feed came back
    // meanwhile) is the one below, asked once the turn is over.
    chat.hydrateAfterSend = false;
    // Where it ends: shown, the composer hears it; else its own queue does, once the transcript says how it ended.
    const unshown = chatOf(state.currentId) !== chat;
    // A message still held never met a run that could read it: it goes out as the next one (decision 2).
    requeueHeld(chat, live, live.held.release());
    if (chatOf(state.currentId) === chat) composer.setLive(false, null, "done");
    try { await hydrate(chat); } catch {}
    const endedAs = turnNumbered(chat.turns, turn.n)?.status;
    if (mine && unshown) endedElsewhere(chat, chat.paused ? "paused" : endedAs === "error" || endedAs === "stopped" ? endedAs : "done");
    // The transcript says what the turn was: Filament's own answer to a command keeps the speed of the reply before it.
    settleSpeed(chat, live, !newestOnRecord(chat.turns)?.command);
    // A turn its agent began by itself (HarnessV3-ACP AC3-9) is no tab's send: the tab that writes the session says
    // its end out loud, as a send's own end is said.
    if (turn.own && document.hidden && !(writing.chainId === chat.chainId && !writing.you)) {
      sayEnded(chat, turnNumbered(chat.turns, turn.n)?.status === "error" ? "error" : "done");
    }
    sidebar.load();
  };
  /** @param {string} runId */
  const followTheRun = (runId) => {
    turn.requestId = runId;
    live.watch?.stop();
    /** The stream named the run: the composer says what a message does to it, and what was held goes to it. @param {any} run */
    const onRun = (run) => {
      if (chat.live === live) replay.begin(run?.events, cursorOf(live));
      if (live.runId || chat.live !== live) return;
      live.runId = runId;
      turn.runId = runId;
      runKnown(chat, live, run);
      deliverHeld(chat, live);
    };
    // The server holds no such run (it is not registered yet, or its log was swept; HarnessV4_Tasks U4, fable51's F4):
    // the follow is let go, so the poll follows again once the transcript names the turn's request, and the composer
    // stops saying the turn is starting — what is typed waits for its end.
    const onMissing = () => {
      if (chat.live !== live || live.runId) return;
      live.watch?.stop();
      live.watch = null;
      live.follower = null;
      live.unfollowed = true;
      if (chatOf(state.currentId) === chat) composer.setLive(true, liveRun(live));
    };
    /** @param {any} e */
    const onEvent = (e) => {
      live.watch?.heard();
      const newest = live.events[live.events.length - 1];
      if (e?.n != null && newest?.n != null && e.n <= newest.n) return; // a follow again overlaps the last one's tail
      live.events.push(e);
      ownAgentMoved(chat, e);
      meterHears(chat, live, e);
      browserHears(chat, e);
      runDraw.add(e);
      replay.heard(e?.n);
    };
    // The words so far, then each piece. A whole set lands on the blocks already drawn, any of which it may have grown;
    // while a replay passes, they wait with its draws.
    const onWords = (/** @type {any} */ w) => {
      live.reply = applyWords(live.reply, w);
      replay.brought();
      if (!replay.holding) transcript.drawBlocks(live, { redraw: Array.isArray(w.blocks) });
      measureReply(chat, live);
    };
    const onRunEnd = () => {
      if (chat.live === live) live.whole = true;
      settle();
    };
    // A log with a hole is no whole log: the turn keeps it, and a later reading reads it again.
    const onGap = () => void (live.holed = true);
    const follow = (/** @type {number} */ since) => followRun(runId, { since, words: true, onRun, onEvent, onWords, onGap, onMissing, onRunEnd, onDone: () => {} });
    live.follower = follow(0);
    // The watchdog (F3 item 16): a view that heard nothing while the run's log grew follows the run again from its
    // cursor, and is said to be lost only where a look later finds it behind still (HarnessV4_Tasks B15).
    const followAgain = () => {
      live.follower?.stop();
      live.follower = follow(cursorOf(live));
    };
    live.watch = watchLive({
      runId: () => (chat.live === live ? runId : null),
      cursor: () => cursorOf(live),
      lookup: runLookup,
      onBehind: followAgain,
      onLost: () => {
        if (!turn.liveLost) pageSaid("status", LIVE_LOST_WORDS, String(chat.chainId || ""));
        transcript.liveLost(turn, true);
        followAgain();
      },
      onBack: () => transcript.liveLost(turn, false),
    });
  };
  if (liveInfo.requestId) followTheRun(liveInfo.requestId);
  // The run may end without an event this page sees (no run at all, or the ring swept): the session is the truth. Its
  // live state alone is read, the turn the transcript says runs: the transcript's newest turn came with it, unread.
  const poll = async () => {
    if (chat.live !== live) return;
    try {
      const st = await api(`/sessions/${encodeURIComponent(chat.chainId)}/live-state`);
      if (!st.live) return settle();
      if (!live.follower && st.live.requestId) followTheRun(String(st.live.requestId));
    } catch {}
    setTimeout(poll, 2500);
  };
  setTimeout(poll, 2500);
}

/** The header's Reload session: fetch the session's transcript again. */
async function reloadSession() {
  const c = chatOf(state.currentId);
  if (!c?.chainId) { toast("Send a message first: this chat has no session yet"); return; }
  try {
    await hydrate(c, { whole: true });
    toast("Session reloaded");
  } catch (e) {
    toast(errText(e), "err");
  }
}

// ---------------------------------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------------------------------
/**
 * The session view's arming, shared by the hydrate and a session's birth (D7): the settings document into the
 * view, and the per-chat subscription that repaints the composer.
 * @param {any} chat
 */
function armSessionView(chat) {
  if (!chat.chainId) return;
  // The views draw from the view too — the Plan view who plans the graph, the Team view the team's mode — so a change
  // made elsewhere (`/team`) reaches them.
  if (!chat._viewSub) chat._viewSub = onSessionView(chat, () => { if (chatOf(state.currentId) === chat) { composer.setSessionView(chat.view, !!chat.chainId); widgets.paint(); views.pulse(); paintDock(); repaintContextHow(); meterFollows(chat); } });
  refreshSessionDoc(chat);
}

// The settings document's fields the session view holds — view-settings.js, pure and pinned by a test. A write
// answers with the same fields (the sessions service's `writeAnswer`), so reading the document and writing it
// update the view the same way; the knob catalogue rides the full read only — a write never changes it.

/**
 * The one writer behind the composer's controls and the widgets (Facade D6): a change goes to the settings
 * route at once — the inspector, `/settings` and any other client in the session see it on their next read.
 * The answer is the document after the write, and it becomes the session view. `signal`: the write's stop — a Stop of
 * the person's, never a clock; one stopped says nothing, and answers that nothing was written.
 * @param {any} chat @param {{ patch?: any, unset?: string[] }} change @param {{ signal?: AbortSignal }} [o]
 */
async function writeSessionSettings(chat, change, { signal } = {}) {
  if (!chat.chainId) return false;
  // A view-only device's page: its words, never the server's refusal (p4-view-ui).
  if (followsStill() || viewOnlyPage()) {
    toast(viewOnlyPage() ? VIEW_ONLY_WORDS : readOnlyWords(), "err");
    applySessionView(chat, { settings: {} }); // the chip moved before the write: paint it back
    return false;
  }
  try {
    const sent = api(`/sessions/${encodeURIComponent(String(chat.chainId))}/settings`, { method: "PATCH", body: change, ...(signal ? { signal } : {}) });
    settingsWrites.set(String(chat.chainId), sent.catch(() => null));
    const doc = await sent;
    applySessionView(chat, { settings: viewSettingsOf(doc) });
    // The list says how many agents the pool runs at once and which seat a launch takes next: a pool that changed is
    // read again, and so is one whose Workers changed — set or cleared, they count apart or with it (E23-D6).
    if (change.patch?.subagents?.pool || change.unset?.some((p) => p === "subagents.pool")) void subagentStore.refresh();
    return true;
  } catch (e) {
    if (!signal?.aborted) toast(String(/** @type {any} */ (e)?.message || e), "err");
    // The chip moved before the write (a pick paints at once): the unchanged view paints it back.
    applySessionView(chat, { settings: {} });
    return false;
  }
}

/**
 * The window of the session's model as the person says it (HarnessV4_Tasks C33), or taken back with null: kept on the
 * model's own row, so the answer is the session's settings with the window in force.
 * @param {any} chat @param {number | null} tokens
 */
async function writeSessionWindow(chat, tokens) {
  if (!chat.chainId) return;
  if (followsStill() || viewOnlyPage()) return toast(viewOnlyPage() ? VIEW_ONLY_REFUSED : readOnlyWords(), "err");
  try {
    const doc = await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/window`, { method: "PUT", body: { tokens } });
    applySessionView(chat, { settings: viewSettingsOf(doc) });
    toast(tokens == null ? "The window you said was taken back" : `Window saved: ${tokens.toLocaleString()} tokens, for every chat on this model`);
  } catch (e) {
    toast(String(/** @type {any} */ (e)?.message || e), "err");
  }
}

/** The settings document, fetched fresh into the session view (D7: one place loads; the widgets only read). */
async function refreshSessionDoc(chat) {
  if (!chat.chainId) return;
  try {
    const doc = await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/settings`);
    applySessionView(chat, { settings: viewSettingsOf(doc) });
  } catch {}
}

/**
 * Compact while a turn runs (BUG-21): an agent turn takes a `compact` steer and folds its older rounds at the loop's
 * next step, by the line's own machinery, the newest rounds whole; the session's archive compaction still waits for
 * the turn to end. A turn whose run id is not known yet says so. Answers false: nothing was archived.
 * @param {any} chat @param {string | null} method
 */
async function compactMidTurn(chat, method) {
  await steerCompact(chat, method);
  return false;
}

/**
 * The `compact` steer into a running turn of Filament's loop (BUG-21): its older rounds fold into one summary at the
 * loop's next step, the newest whole. Each outcome is said in a toast; answers whether the turn took it.
 * @param {any} chat @param {string | null} [method]  a method asked for, which applies between turns only
 * @returns {Promise<boolean>}
 */
async function steerCompact(chat, method = null) {
  const live = chat.live;
  // A coding agent compacts its own context as it works: the fold is the loop's (HarnessV3-ACP AC1-5); Filament makes
  // room in an agent's session between its turns (AC5).
  if (live && (live.runKind === "coding-agent" || codingAgentModel(chat.model))) {
    toast("A coding agent compacts its own context as it works — compact this session once its turn ends");
    return false;
  }
  // The turn's first moment: its run id rides the reply's head a beat after the send. Wait a little for it rather
  // than refuse a Compact that works a second later (the UI/UX review, 2026-09-30).
  for (let i = 0; i < 30 && live && chat.live === live && !live.runId; i++) await new Promise((r) => setTimeout(r, 100));
  if (live && chat.live === live && live.runId) {
    try {
      await api(`/runs/${encodeURIComponent(live.runId)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
      toast(`Compacting at the loop's next step — this turn's older rounds fold into one summary, the newest stay whole${method ? " (a method choice applies to a compaction between turns)" : ""}`);
      return true;
    } catch (e) {
      toast(errText(e), "err");
      return false;
    }
  }
  toast(
    chat.live !== live ? "The turn just ended — press Compact again to compact the session"
      : "The turn hasn't opened its run yet — try Compact again in a few seconds",
  );
  return false;
}

/**
 * Compact now — the Context and Compaction widgets' action and the banner's remedy: make room by the session's
 * compaction method — in a coding agent's session, its way — or `method` or the agent's `way` for this once
 * (HarnessV3-Compaction; HarnessV3-ACP AC5-8). The boundary row lands after the turn the compaction ends on, when this
 * page holds it, with Undo on it until the next message. While an agent turn runs, the loop folds that turn's older
 * rounds at its next step instead (compactMidTurn). Answers whether the compaction was written.
 * `once`: the writer chosen for this compaction alone — the same model, or a side model (the card that asks before a
 * message: `choiceCompaction`); `sending`: the card's Compact and send, whose message goes on once room is made
 * (compactNow).
 * @param {any} chat @param {string | null} [method] @param {"own" | "self" | "ours" | null} [way]
 * @param {{ writer?: "session" | "model", model?: string } | null} [once] @param {{ sending?: boolean }} [o]
 */
async function compactSession(chat, method = null, way = null, once = null, { sending = false } = {}) {
  if (chat.live) return compactMidTurn(chat, method);
  return compactNow(chat, { method, way, once, sending });
}

/**
 * The compaction, asked of the server and placed on the page. `onceTurnEnds` is Stop and compact's (`stopAndCompact`):
 * the server waits for the session's running turn to end, with no clock, then compacts. `sending`: the card's Compact
 * and send (HarnessV4_Tasks U11) — its message goes on at once, so the toast says room was made and what it came to,
 * and that the message is on its way where its chat is shown (another chat shown, the message may wait in its own
 * chat's queue, or be refused there, said in that queue); one that could not answers the words of why, for the card to
 * say, in place of a toast. `by: "last"`: written as the model that answered the chat's last turn — a switch's handoff.
 * @param {any} chat @param {{ method?: string | null, way?: "own" | "self" | "ours" | null, onceTurnEnds?: boolean, once?: { writer?: "session" | "model", model?: string } | null, sending?: boolean, by?: "last" | null }} [o]
 * @returns {Promise<true | false | string>}
 */
async function compactNow(chat, { method = null, way = null, onceTurnEnds = false, once = null, sending = false, by = null } = {}) {
  if (viewOnlyPage()) {
    if (sending) return VIEW_ONLY_WORDS;
    toast(VIEW_ONLY_REFUSED, "err");
    return false;
  }
  // What is sent meanwhile waits for it from now (`compactingBetween`), and goes, or waits paused, as it ends.
  chat.compactAsked = (Number(chat.compactAsked) || 0) + 1;
  // The left bar's Now lists it under Working from the ask (`compactingChats`): the server's first word comes after.
  sidebar.refreshNow();
  /** @type {boolean | string} */
  let made = false;
  try {
    return (made = await compactAsk(chat, { method, way, onceTurnEnds, once, sending, by }));
  } finally {
    chat.compactAsked = Math.max(0, (Number(chat.compactAsked) || 1) - 1);
    sidebar.refreshNow();
    if (made === true) roomMade(chat);
    else roomNotMade(chat);
  }
}

/** `compactNow`'s ask, and what its answer says. @param {any} chat @param {{ method: string | null, way: string | null, onceTurnEnds: boolean, once: any, sending: boolean, by?: string | null }} o */
async function compactAsk(chat, { method, way, onceTurnEnds, once, sending, by = null }) {
  try {
    // `sending`: the server holds the chat's wakes for the message (the owner's of 11-09), which goes first.
    const r = await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/compact`, { method: "POST", body: { ...(method ? { method } : {}), ...(way ? { way } : {}), ...(method && once ? { once } : {}), ...(onceTurnEnds ? { onceTurnEnds: true } : {}), ...(by ? { by } : {}), ...(sending ? { sending: true } : {}) } });
    toast(sending
      ? `Room made${compactionFacts(r.compaction)}${chatOf(state.currentId) === chat ? " — your message is on its way" : ""}`
      : `${compactionWords(r.compaction)}${compactionFacts(r.compaction) || (r.compaction.chars ? ` (${fmt.n(r.compaction.chars)} chars)` : "")} — Undo is on its row until you send`);
    placeCompaction(chat, r.boundary);
    widgets.paint();
    repaintContextHow(true);
    // The meter reads the next request as the server composes it now, not the last request's figure (LD-D6, F20).
    if (chatOf(state.currentId) === chat) paintMeter(chat);
    return true;
  } catch (e) {
    // Stopped from its row (U3-5), or from the card: the person's word, not a failure.
    const stopped = /** @type {any} */ (e)?.body?.stopped === true;
    // Room made already for the message — a Compact and send's, or a handoff's summary, whose press made it and whose send
    // after was refused —: every turn is under it, and the message goes on from it (the hunt of 11-09: the second press
    // was refused as nothing to compact, for good).
    if (sending && /** @type {any} */ (e)?.body?.covered === true) return true;
    if (sending) return stopped ? "Stopped: nothing was compacted, and your message waits here." : `Room was not made: ${errText(e)}. Your message waits here.`;
    if (stopped) toast("Compaction stopped: nothing was written");
    else toast(errText(e), "err");
    return false;
  }
}

// A worktree template's copy (HarnessV4_Four_Plan FO-D37): its row where this page holds the chat, running, then
// done. One told before this page knew the chat's id is read with its first turn's end (`turn.copies`).
onBus((msg) => {
  if (msg?.type !== "worktree-copy" || !msg.chainId || !msg.boundary) return;
  const chat = chatByChain(String(msg.chainId));
  if (chat) placeCopy(chat, msg.boundary);
});

/** A copy's row onto the chat's turns, in the place of the same copy's. @param {any} chat @param {any} b */
function placeCopy(chat, b) {
  const home = withCopy(chat.turns, b);
  if (home && chatOf(state.currentId) === chat) transcript.drawBoundaries(home);
}

/**
 * A compaction the server just wrote, placed on the page — Compact now's, and a command's that compacted inside its own
 * turn (`/compact`, `/autofit`: HarnessV3-Launch RD-D4). Its row lands after the turn it ends on, when this page holds
 * that turn, with the Undo the server gave it.
 * @param {any} chat @param {any} boundary
 */
function placeCompaction(chat, boundary) {
  // A compaction moves neither the settings hash nor the turn count — the epoch is what tells the compose cache
  // the conversation changed (the head card and the tally must not quote the world before the summary).
  bustPreview();
  // A read that landed first — as the turn finished, another page's turn followed, the feed back — holds it already,
  // with its Undo as the server gave it; one an Undo was heard for, here or in another tab, stays gone.
  if (holdsRow(chat.turns, boundary) || chat.undoneIds?.has(Number(boundary.id))) return;
  // A read asked before it lacks it, and is told it (`hydrate`).
  (chat.rowsHeard ||= []).push({ at: Date.now(), row: boundary });
  // One older than a compaction the page holds takes no Undo from it.
  const stale = newerCompaction(chat.turns, boundary.id);
  undoOnlyOn(chat, boundary);
  const after = turnNumbered(chat.turns, boundary.afterTurn);
  if (after) {
    after.boundariesAfter = [...(after.boundariesAfter || []), { ...boundary, at: Date.now(), ...(stale && boundary.undoable ? { undoable: false } : {}) }];
    if (chatOf(state.currentId) === chat) transcript.drawBoundaries(after);
  }
}

/**
 * Only the newest compaction can be undone: of the chat's compaction rows, `row`'s copy alone offers Undo — the rows
 * before it lose theirs. One of Filament's copy alone moved no session and takes no Undo from another, and one older
 * than a compaction the page holds — a read that was asked first, landing last — takes none from that one.
 * @param {any} chat @param {any} row
 */
function undoOnlyOn(chat, row) {
  if (row.detail?.copy || newerCompaction(chat.turns, row.id)) return;
  for (const t of chat.turns) {
    let moved = false;
    for (const b of [...(t.boundaries || []), ...(t.boundariesAfter || [])]) {
      if (b.type !== "compaction") continue;
      const on = b.id != null && row.id != null && Number(b.id) === Number(row.id);
      if (!!b.undoable === on) continue;
      b.undoable = on;
      moved = true;
    }
    if (moved && chatOf(state.currentId) === chat) transcript.drawBoundaries(t);
  }
}

/**
 * Undo a compaction (the timeline row's and the Compaction widget's Undo): the server takes the row and its marks
 * back, or refuses in words (a turn since, not the newest). The row leaves the transcript, the compaction now on top
 * offers its Undo as the server names it, the preview composes afresh, and every widget repaints. Answers whether it
 * was undone.
 * @param {any} chat @param {number} id
 */
async function undoCompactionIn(chat, id) {
  try {
    const r = await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/compactions/${encodeURIComponent(String(id))}/undo`, { method: "POST", body: {} });
    toast(`Undone: turns ${r.undone.fromTurn}–${r.undone.toTurn} are back as they were`);
    compactionUndone(chat, id, r.undoable == null ? null : Number(r.undoable));
    return true;
  } catch (e) {
    toast(errText(e), "err");
    return false;
  }
}

/**
 * A compaction undone, by this page or in another tab (`compaction-undone` on the feed): its row leaves the
 * transcript, the compaction now on top offers its Undo as the server names it (`next`; null for none), the compose
 * preview is read afresh — the one cached is of the history before the Undo, the chat shown or not — and the open
 * chat's widgets repaint. The word is kept on the chat (`undoneHeard`): a transcript read asked before it holds the
 * compaction still, and is told it again (`hydrate`); and its id (`undoneIds`, never used again), which no row the page
 * places after takes back (`placeCompaction`, a turn's end). @param {any} chat @param {number} id @param {number | null} next
 */
function compactionUndone(chat, id, next) {
  (chat.undoneHeard ||= []).push({ at: Date.now(), id, next });
  (chat.undoneIds ||= new Set()).add(Number(id));
  const open = chatOf(state.currentId) === chat;
  for (const t of afterCompactionUndo(chat.turns, id, next)) if (open) transcript.drawBoundaries(t);
  bustPreview();
  if (!open) return;
  widgets.paint();
  repaintContextHow(true);
  // The history is back as the last request sent it: so is the meter's figure, unless an older compaction stands.
  paintMeter(chat);
}

/**
 * The chat in the place it moved to, or back to (HarnessV4_Git_Plan §12): its folder is the server's answer, and the
 * transcript, the header's chips and the panes are read again from there. The move this page asked for ends here, its
 * mark with it (`movingMark`).
 * @param {any} chat @param {string} cwd @param {string} said @param {{ done: () => void }} mark
 */
async function movedTo(chat, cwd, said, mark) {
  chat.cwd = cwd;
  try {
    await hydrate(chat);
  } catch (e) {
    toast(errText(e), "err");
    // The read that tells the header the chat failed: its chip says the folder the chat moved to all the same — the old
    // one there would be read as a folder chosen for a new chat (`readySession`).
    if (chatOf(state.currentId) === chat) headerModule.setChat(chat);
  }
  mark.done();
  // The folder's own change: its leaf, the tool cards' paths and the git chips follow it.
  if (chatOf(state.currentId) === chat) folderIn.dispatchEvent(new Event("change"));
  sidebar.load();
  toast(said);
}

/**
 * Move the chat to a worktree, from its sheet (HarnessV4_Git_Plan §12, GW-D74): each move the sheet posts is this page's
 * from Move's press, by its own mark, until its own end has read the chat (`movedTo`) or the server refused it.
 * @param {any} c
 */
function openMoveSheet(c) {
  /** The mark of the move the sheet posted last: its answer is the one `onMoved` hears. @type {{ done: () => void }} */
  let mark = { done: () => {} };
  moveSheet({
    chat: c,
    title: chatTitle(c),
    onToast: (msg, kind) => toast(msg, kind),
    hear: onBus,
    onMoving: (move) => {
      const own = (mark = movingMark(c));
      move.catch(() => own.done());
    },
    onMoved: (done) => {
      const running = (done.running || []).map((/** @type {any} */ s) => s.command);
      void movedTo(c, done.cwd, `Moved to ${placeName(done.cwd)}${running.length ? ` — still running in the old folder: ${running.join(", ")}` : ""}`, mark);
    },
  });
}

/** Take the chat's newest move back, from its row (HarnessV4_Git_Plan GW-D79). @param {any} chat @param {any} b */
async function moveBackIn(chat, b) {
  // The move is this page's from the press, by its own mark: the feed's release of it reads nothing beside its own end.
  const mark = movingMark(chat);
  try {
    const r = await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/move/back`, { method: "POST", body: { id: String(b.id) } });
    // The row goes with the move: a turn this page keeps its own copy of would hold it through the hydrate.
    withoutMove(chat.turns, String(b.id));
    await movedTo(chat, r.cwd, `Moved back to ${placeName(r.cwd)}${r.left ? ` — ${r.left}` : ""}`, mark);
  } catch (e) {
    mark.done();
    toast(errText(e), "err");
  }
}

/**
 * Show on an unborn chat's switch what it stands on (D15, HarnessV4_Settings_Plan HS-D48; `chipStanding`), and
 * nothing for a chat that is not on screen.
 * @param {import("./state.js").Chat} chat
 */
function showStanding(chat) {
  if (chat.chainId || chat.id !== state.currentId) return;
  const { mode, note } = chipStanding(chat, state.newChatMode);
  composer.setPermissionMode(mode);
  composer.setPermissionNote(note);
}

/** Read "New chats start in" (HS-D48) from your defaults, and show it on the unborn chat that stands on it. A read
 *  that fails keeps what was read before: the create call sends no mode, so the server's value decides anyway. */
async function loadNewChatMode() {
  try {
    const mode = (await api("/defaults/settings"))?.flat?.["loop.permissions"];
    state.newChatMode = typeof mode === "string" && mode ? mode : null;
  } catch {
    return;
  }
  const chat = chatOf(state.currentId);
  if (chat) showStanding(chat);
}

/**
 * The chat's session on the server, created at the first send (`POST /api/sessions`): the folder becomes the
 * project, the model the session's `model.name`, and the chat starts from your defaults with the Start board's (D15,
 * HarnessV3-NewTask) held changes over them, in the same body — `loop.permissions` only when a mode was picked for the
 * chat (HarnessV4_Settings_Plan HS-D48), and `model.effort`. The address follows.
 * The session is named by the server: the first line of its first message that reaches the model (`autoTitle`), never
 * a command Filament answers (backlog 18) — so a send's create call carries no title of its own. A session made for a
 * question to saved agents has no such message yet: its `title` is the question.
 * @param {any} chat @param {string} model
 * @param {string} [permissions]  the composer's permission mode, written into the document's `loop.permissions`
 * @param {string} [effort]  the composer's effort level, written into `model.effort`
 * @param {string} [title]  the session's name, where its first message is not what names it
 * The rest of the composer's held tuning (fast mode, the window, extended thinking) rides the same body.
 * One session per chat: a send while the chat's session is being made — another Enter, a question to saved agents —
 * waits for that one (`chat.making`), and makes none of its own.
 */
async function ensureSession(chat, model, permissions = "", effort = "", title = "") {
  if (chat.chainId) return chat.chainId;
  chat.making ||= makeSession(chat, model, permissions, effort, title).finally(() => {
    chat.making = null;
  });
  return chat.making;
}

/**
 * The chat's session made (`ensureSession`): created on the server, then the chat's own — its id, its model, its
 * drafts, the folder it works in, its view.
 * @param {any} chat @param {string} model @param {string} permissions @param {string} effort @param {string} title
 * @returns {Promise<string>}
 */
async function makeSession(chat, model, permissions, effort, title) {
  const row = await api("/sessions", { method: "POST", body: sessionStartBody(chat, chat.cwd, model, title, permissions, effort, composer.heldSettings()) });
  if (title) chat.title = row.title || title;
  // What was typed while the session was made goes with the chat to its session's draft, and the files attached with
  // it. It is read before the chat's folder can move to a worktree: the Start's words are kept with the folder they were
  // typed in (state.js startKept), and words of another folder's Start stay that Start's.
  const typed = draftFor(chat);
  if (typed) saveDraft(chat, "");
  const attached = draftFilesFor(chat);
  if (attached.length) saveDraftFiles(chat, []);
  // Where the chat works (HarnessV4_Git_Plan step 5): the place picked for it, or the worktree made for it, is its
  // folder from now on; the header's folder follows.
  if (chat.worksIn) {
    delete chat.worksIn;
    if (row.cwd) {
      chat.cwd = row.cwd;
      if (chat.id === state.currentId) headerModule.setChat(chat);
    }
  }
  chat.chainId = row.id;
  chat.model = model;
  if (chat.id === state.currentId) claimWriting();
  // The project the archive filed it in: its sidebar row stands there before the archive lists it, where a chat in a
  // new worktree has no other chat in its folder to borrow it from (HarnessV4_Git_Plan GW-D54).
  chat.projectId = row.projectId || null;
  // A chat started on a task of its project's Space takes it: the chat's own, in Doing (proposal_ux §4.14).
  if (chat.spaceTask) {
    const t = chat.spaceTask;
    delete chat.spaceTask;
    api(`/space/${encodeURIComponent(t.project)}/tasks/${encodeURIComponent(t.id)}`, { method: "PATCH", body: { chain: row.id, column: "doing" } })
      .catch((e) => toast(`The Space's task was not given to this chat: ${String(e?.message || e)}`, "err"));
  }
  saveDraft(chat, typed);
  saveDraftFiles(chat, attached);
  applySessionView(chat, { settings: { hash: row.settingsHash || null } });
  // A session now: its view tabs come to the header.
  if (chat.id === state.currentId) views.setChat(chat);
  // The session was born mid-send (D7): its view layer arms now — the document, and the subscription that paints the
  // composer's faces — so the pills and the caret appear without waiting for a reload.
  armSessionView(chat);
  if (chat.id === state.currentId && !onScreen(location.hash)) syncAddress(chat);
  return chat.chainId;
}

/** The model a new chat starts on (HarnessV4_Settings_Plan HS-D16): the one chosen in Settings › General while the
 *  picker offers it, else the one in the composer — the one used last (HC-90, HC-91). */
const newChatModel = () => (newChatModelPref() ? startModel(state.models) : "") || composer.modelName?.() || lastModel() || "";

/**
 * @param {{ cwd?: string | null, model?: string | null, worksIn?: any, held?: Record<string, any> | null }} [opts]
 *   `worksIn`: where the chat works, chosen before its Start draws (works-in.js; the Space's New lane…);
 *   `held`: the changes its Start holds from the first (Reproduce…'s, HarnessV4_Space_Plan S7-D2)
 */
function newChat({ cwd = null, model = null, worksIn = null, held = null } = {}) {
  // A chat started with no folder named (New task, its shortcut, the left bar's New) opens in the project's own folder,
  // on whatever branch that folder is on — never in the worktree the chat shown before worked in, which the chooser
  // still holds and names by its project (the owner's of 11-08: "by default when Works in This folder is selected it
  // should just open the main project folder ... and not some worktree branch"). Another worktree is the Start's to
  // choose.
  const carried = cwd == null ? folderIn.value.trim() : "";
  const placed = carried ? projectFolderOf(carried) : null;
  if (cwd == null) cwd = placed ?? null;
  // A chat started in a folder (Open folder…, a project's New chat, its Space's) moves the Start's chooser there too, so
  // its chip, its Works in and the board weigh the folder the first send uses (the design pass of 10-24: the chooser
  // said "Choose a project" over a chat in proj, Works in said nothing, and the board weighed the chooser's folder).
  const into = String(cwd ?? "").trim();
  if (into && into !== folderIn.value.trim()) {
    folderIn.value = into;
    folderIn.dispatchEvent(new Event("input"));
  }
  const chat = putChat({
    id: newChatId(),
    cwd: (cwd ?? folderIn.value).trim(),
    model: model ?? newChatModel(),
    ...(worksIn ? { worksIn } : {}),
    // A change the Start holds from the first (Reproduce…'s "Their own worktree for edits" off, S7-D2): its row shows
    // the dot and ↺, as one the person made does.
    ...(held ? { held, heldPerm: typeof held["loop.permissions"] === "string" ? held["loop.permissions"] : null } : {}),
  });
  selectChat(chat.id);
  sidebar.drawOpen();
  // A carried folder the page cannot place yet — the list not read, as the page opens — is asked of the server, and
  // the chat moves once it says. The project's folder may be on no disk: a worktree's subfolder stands in the same
  // subfolder of the main folder (brain.js `projectOf`), which may be on the worktree's branch alone; the chat then
  // stays, or goes back, where it was carried from. Each only while it is the chat shown, unborn, in the folder it was
  // put in, and nobody chose a folder meanwhile.
  if (placed !== null) {
    const sets = chooserSets;
    const stillIn = (/** @type {string} */ at) =>
      chooserSets === sets && chatOf(state.currentId) === chat && !chat.chainId && !chat.making && String(chat.cwd || "").trim() === at && folderIn.value.trim() === at;
    const there = (/** @type {string} */ p) => api("/files/exists", { method: "POST", body: { paths: [p] } }).then((r) => r?.ok?.[0] !== false, () => true);
    if (placed) void there(placed).then((ok) => { if (!ok && stillIn(placed)) setChooserFolder(carried); });
    else
      void readStanding([carried]).then(async () => {
        const to = projectFolderOf(carried);
        if (to && (await there(to)) && stillIn(carried)) setChooserFolder(to);
      });
  }
  return chat;
}

/** How many times the Start chooser's folder was set: a folder chosen while the server is asked — the same one too — stays. */
let chooserSets = 0;
/**
 * The Start chooser's folder set: the header's field, and the chat shown while it has no session — none being made for
 * it either —, as its send would take it (readySession); the header reads its place.
 * @param {string} p
 */
function setChooserFolder(p) {
  chooserSets++;
  folderIn.value = p;
  folderIn.dispatchEvent(new Event("input"));
  const c = chatOf(state.currentId);
  if (c && !c.chainId && !c.making && !(c.turns || []).some((/** @type {any} */ t) => !t.past)) {
    c.cwd = p;
    // The Start's words are kept with its folder (state.js startKept): a folder changed with words in the box takes
    // them, and the files attached with them.
    const words = composer.draft();
    if (words) saveDraft(c, words);
    const attached = composer.files();
    if (attached.length) saveDraftFiles(c, attached);
    headerModule.refreshGit();
  }
  transcript.refreshFolder();
}

/** The chats past the few shown last that hold nothing of the page's own leave `state.chats` (lib/release.js). */
function letChatsGo() {
  const known = new Set((state.sessions || []).map((/** @type {any} */ s) => String(s.id)));
  for (const id of chatsToLet(state.chats.values(), { current: state.currentId, known })) {
    const chat = state.chats.get(id);
    if (!chat) continue;
    const chain = String(chat.chainId);
    letGo.delete(chain);
    letGo.set(chain, keptOf(chat));
    if (letGo.size > 200) letGo.delete(/** @type {string} */ (letGo.keys().next().value));
    state.chats.delete(id);
  }
}

/** The chat the transcript draws now, and the turns it drew: every whole drawing goes through `drawChat`. */
let drawnChat = { chat: /** @type {any} */ (null), turns: /** @type {any[] | null} */ (null) };
/** A chat's transcript drawn whole: every turn's row made again, its markdown read again. @param {any} chat */
function drawChat(chat) {
  drawnChat = { chat, turns: chat.turns };
  transcript.render(chat);
}

/**
 * @param {string} id
 * @param {{ view?: string }} [opts]  `view`: the view it opens on, rather than the one it was left on — Chat, from the
 *   left bar
 */
function selectChat(id, opts = {}) {
  // A chat of this computer's chosen: another machine's shown in place beside the bar goes (lib/desk-guest.js).
  deskGuest?.close();
  state.currentId = id;
  const chat = chatOf(id);
  if (!chat) return;
  if (opts.view) chat.viewTab = opts.view;
  chat.shownAt = Date.now();
  letChatsGo();
  // The chat on screen chosen again (its row in the left bar, its Now row): the person never left it.
  const again = drawnChat.chat === chat;
  // The find bar's matches are marked in the transcript it searched: another chat's opens without it.
  if (!again) find.close();
  // The chat on screen chosen again — its row in the left bar, a Now row — stands as it is drawn: drawn whole again, up
  // to sixty turns were made anew for nothing. Its turns read anew are drawn whole (`hydrate`).
  if (drawnChat.chat !== chat || drawnChat.turns !== chat.turns) drawChat(chat);
  paintCompacting(chat);
  // A turn ran on its session while another chat was shown (lib/release.js `noteUnseenTurn`): read again and drawn
  // whole, and followed where it runs still — a turn of the harness's by its run (hydrate). A chat being opened is
  // being read.
  if (readsOnShow(chat) && !opening.has(chat)) followElsewhere(chat);
  sidebar.drawOpen();
  rail.setChat(chat);
  views.setChat(chat);
  // A message a card stopped keeps its words as the draft for a refresh: while its row stands they are the row's, not
  // the box's too (`heldInRow`, the owner's of 11-09).
  const kept = draftFor(chat);
  const held = heldInRow(chat.turns, kept) === true;
  const back = held ? "" : kept;
  // Its box as it was left, the files attached in it with its words: another chat's never go with its send.
  composer.setDraft(back, draftFilesFor(chat));
  // A new chat's Start says when its box holds words kept from before (the Designer's second walk of 10-29).
  keptBack = chat.chainId ? "" : back;
  transcript.refreshSpace();
  composer.meter();
  // …and the held words stay the draft for a refresh, as the card left them: the box saves what it holds as it is
  // drawn, its empty words over them. Words typed since are the draft from then.
  if (held) saveDraft(chat, kept);
  paintCatchUp();
  paintCrafterLine();
  paintBrowserLine();
  paintWatchLine();
  // The composer is the SELECTED chat's own: switching chats resets its live face to this chat's state — a run in
  // another chat must not leave its Stop button stuck here. Events since the switch (this chat's own send, a turn of
  // the harness's taking its session) set it again as they happen. Its queue is the chat's own too (HarnessV3-Views
  // V3): what waited for a turn that went on while another chat was shown waits on, paused, for Continue — a switch
  // never sends. The chat on screen chosen again was never left: its queue stands as it was, even where no turn shows
  // as running for a moment (a message waiting on its row, a turn's end before the composer hears it).
  if (!again && !chat.live && !(chat.roomWait && compactingBetween(chat))) openedIdle(queueOf(chat));
  composer.setQueue(queueOf(chat));
  composer.setLive(!!chat.live, liveRun(chat.live));
  // The meter and the speed gauge are the shown chat's: a turn running here shows its own figures as they stand now,
  // never the chat shown before (AC3-5).
  paintMeter(chat);
  if (chat.live) meterBack(chat.live);
  paintSpeed(chat);
  if (chat.model) composer.setModel(chat.model);
  // The composer's faces follow the selected chat (D6/D9): a session shows its view; a New task hides the
  // pills and the caret until its own session exists (FC 15).
  composer.setSessionView(chat.view || null, !!chat.chainId);
  // An unborn chat's mode is its own (HS-D48), never the one the switch showed for the chat before.
  showStanding(chat);
  widgets.paint();
  paintDock();
  headerModule.setChat(chat);
  setTitle(chat);
  refreshStatus(chat);
  // This tab now shows this chat's session (or none): it asks to write it, and lets go of the one it wrote — a chat
  // being opened, once its transcript has landed (openSession).
  if (!opening.has(chat)) claimWriting();
  paintWriting();
  // A settings or control-room link is an overlay over the conversation, not a replacement for it. Selecting the
  // chat underneath must not rewrite the address, or a direct link to either is lost on load.
  if (onScreen(location.hash)) { pushNextAddress = false; return; }
  syncAddress(chat);
}

function setTitle(chat) {
  const title = chat.forkedFrom
    ? `Forked from ${chat.forkedFrom.fromTitle || "a chat"} · turn ${chat.forkedFrom.atTurn}${chat.forkedFrom.worktree ? ` · ${chat.forkedFrom.worktree}` : ""}`
    : chat.kind === "open"
      ? (chatTitle(chat) === "untitled" ? "opened chat" : chatTitle(chat))
      : chat.load && chatTitle(chat) === "untitled"
        ? "new chat with a past chat loaded"
      : chatTitle(chat) === "untitled" && !chat.turns.filter((t) => !t.past).length
        ? WORDS.newChat
        : chatTitle(chat);
  titleEl.textContent = title;
  paintImportedFrom(chat);
  paintFromAgents(chat);
  setTabTitle(title, !!chat.live);
}
/**
 * Where an imported chat came from, said once, on the title's hover (HarnessV4_Import_Plan IM-59), from the sessions
 * list's row: painted with the title, and again when the list arrives.
 * @param {any} chat
 */
function paintImportedFrom(chat) {
  const from = chat?.chainId ? (state.sessions || []).find((/** @type {any} */ s) => s.id === chat.chainId)?.importedFrom : null;
  if (from) titleEl.setAttribute("title", `Imported from ${from}`);
  else titleEl.removeAttribute("title");
}
/**
 * A chat another machine's agents started here says whose after its name — "From MacBook's agents" — from the sessions
 * list's row (the remote-agents plan's s-ui): painted with the title, and again when the list arrives.
 * @param {any} chat
 */
function paintFromAgents(chat) {
  const words = fromAgentsWords(chat?.chainId ? (state.sessions || []).find((/** @type {any} */ s) => s.id === chat.chainId) : null);
  headerModule.fromEl.title = words;
  headerModule.fromEl.setAttribute("aria-label", words);
  headerModule.fromEl.classList.toggle("hidden", !words);
  paintThreads(chat);
}
/**
 * The chats linked to this one by a thread (core/threads.js): the one whose agent started it, and those its own agent
 * started, newest first — the header's chip after the views opens each. Read from the transcript (`chat.threads`, every
 * one, whatever the list holds), and from the sessions list's `threadOf`, which hears of a thread started since and of a
 * chat named since.
 * @param {any} chat
 */
function paintThreads(chat) {
  headerModule.setThreads(threadsLinked(chat?.chainId, chat?.threads, state.sessions || []));
}

/**
 * A task is being read: its unread mark, local and persisted, goes — in one write. The sessions list's row says whether
 * it is unread; a chat the list holds no row for (a team's, beside its main chat) says so on the row it was opened from.
 * @param {{ id: string, unread?: boolean }} s  the row opened
 */
function markRead(s) {
  const chainId = s?.id;
  if (!chainId) return;
  const row = (state.sessions || []).find((/** @type {any} */ x) => x.id === chainId);
  // It moved while nobody looked: the line that offers to catch you up.
  if (row?.unread || state.unreadChains.has(chainId)) movedChains.add(chainId);
  // A view-only device's page keeps its own: the chat's mark is written from a page that may.
  // Opening a chat is no act of writing it: its mark takes nothing over (lib/api.js `taking`).
  if (!viewOnlyPage() && ((row ? row.unread : s.unread) || state.unreadChains.has(chainId))) api(`/sessions/${encodeURIComponent(chainId)}/settings`, { method: "PATCH", body: { patch: { display: { unread: false } } }, take: false }).catch(() => {});
  state.unreadChains.delete(chainId);
  if (row) row.unread = false;
}

/**
 * Open a session: the chat IS the chain — its earlier turns come from the server's transcript, read-only, and the
 * next message is the session's next turn. No copy, no second row. A chat already open on that chain is selected.
 * `view` is the view its address named (`#/task/<id>/plan`).
 * @param {{ id: string, title?: string, cwd?: string, model?: string }} s @param {{ push?: boolean, view?: string }} [opts]
 */
async function openSession(s, opts = {}) {
  const open = chatByChain(s.id);
  if (open) {
    pushNextAddress = !!opts.push;
    selectChat(open.id, { view: opts.view });
    markRead(s);
    return open;
  }
  pushNextAddress = !!opts.push;
  markRead(s);
  // A chat the page let go of opens as it was left: its view, where no address names one, and its cards opened.
  const was = letGo.get(String(s.id));
  letGo.delete(String(s.id));
  const chat = putChat({
    id: newChatId(),
    kind: "open",
    chainId: s.id,
    cwd: s.cwd || "",
    model: s.model || "",
    title: s.title || "",
    viewTab: opts.view || was?.viewTab || "chat",
    ...(was?.cardsOpen.length ? { cardsOpen: new Set(was.cardsOpen) } : {}),
  });
  opening.add(chat);
  selectChat(chat.id);
  try {
    await hydrate(chat);
  } catch (e) {
    // A session that does not exist is said, not swallowed. Its chat goes; an empty one takes its place only while it is
    // the chat on screen — a person who went on to another while it was read stays where they went.
    if (String(/** @type {any} */ (e)?.status) === "404" || /404|no such session/i.test(errText(e))) {
      const shown = chatOf(state.currentId) === chat;
      toast(shown ? `No chat “${s.id}” in the archive: starting an empty one` : `No chat “${s.id}” in the archive`, "err");
      state.chats.delete(chat.id);
      if (shown) newChat();
    } else toast(`The chat's transcript could not be loaded (${errText(e)}): use Reload session before sending`, "err");
  }
  opening.delete(chat);
  // What waited for the transcript goes now, for the chat still shown; one switched away from reads it when shown again.
  if (chatOf(state.currentId) === chat) {
    refreshStatus(chat);
    claimWriting();
    // A turn heard while the read was on its way, which the read may not hold (`noteUnseenTurn`): read now, and
    // followed where it runs still — unless the read follows it already.
    if (readsOnShow(chat)) followElsewhere(chat);
  }
  return chat;
}

/**
 * "Load into a new task": a fresh task that receives the session as memory material on its first turn
 * (`x-filament-memory-load`, D11). The chat has no session until its first send, so the source's row and address stay
 * the source's.
 * @param {{ id: string, title?: string, cwd?: string }} s
 */
function loadIntoNewTask(s) {
  pushNextAddress = true;
  const chat = putChat({
    id: newChatId(),
    kind: "new",
    cwd: s.cwd || folderIn.value.trim(),
    model: newChatModel(),
    load: `${s.id}:chat`,
    title: "",
  });
  chat.loadTitle = s.title || "";
  selectChat(chat.id);
  toast(`“${s.title || s.id}” will be loaded as material into this chat's first turn`);
  return chat;
}

// ---------------------------------------------------------------------------------------------------
// The turn's conductor
// ---------------------------------------------------------------------------------------------------
/**
 * A model id minus its effort lane, kept whole when the trailing `-max` is the model's own name (`qwen-max`):
 * judged against the catalogue, so a remembered default never names a model that does not exist.
 * @param {string} id
 */
function baseModelOf(id) {
  const stripped = String(id || "").replace(/-(low|medium|high|xhigh|max)$/, "");
  if (stripped === id) return id;
  const known = (/** @type {any} */ x) => state.models.some((/** @type {any} */ m) => (m?.id ?? m) === x);
  return known(id) && !known(stripped) ? id : stripped;
}

/** The waiting-send store (D14): a queued message survives a reload of the page. */
const wstore = waitingStore(sessionStorage);
/** Where a chat's waiting messages are kept while the page loads afresh (HarnessV4_Tasks U4): the tab's own storage. */
const kept = keptQueues(sessionStorage);
/** What the tab holds of each chat's waiting messages, as this page last wrote it. @type {WeakMap<object, any[]>} */
const keptNow = new WeakMap();
/** How often the page looks whether a chat's waiting messages changed since it last kept them. */
const QUEUE_KEEP_MS = 1000;
/**
 * What waits in the page alone is kept with the tab: each chat's queue, and the messages held for a run the page has
 * not learned yet, in the order they would have gone. The chat's queue takes them back when it is made (`queueOf`).
 * Written afresh as the page goes away — a reload, the browser putting it away, the tab closed —, so a copy never
 * outlives its queue, and each second where it changed: a page whose process crashes runs no pagehide, and Filament
 * loads it again (lib/crash-notice.js). A chat this page never opened is left alone — its copy is the one the page
 * before made. @param {boolean} [always] written whether or not it changed
 */
function keepQueues(always = false) {
  for (const chat of state.chats.values()) {
    const held = chat.live?.held.texts() || [];
    if (!chat.chainId || (!chat.queue && !held.length)) continue;
    const items = [...queueOf(chat).items, ...held];
    const was = keptNow.get(chat);
    if (!always && was && was.length === items.length && was.every((it, i) => it === items[i])) continue;
    kept.keep(String(chat.chainId), items);
    keptNow.set(chat, items);
  }
}
addEventListener("pagehide", () => keepQueues(true));
// The desktop app about to read the tab's storage, the page moving to a better way to its machine (desktop/lib/rail.js
// `READ_PAGE`): written now, not up to a second late.
addEventListener("filament:keep", () => keepQueues(true));
setInterval(() => keepQueues(), QUEUE_KEEP_MS);


/**
 * The harness queue (Step 3 D14): arm a turn row that waits while the chat is held — its move, a coding agent's turn
 * of its own — the line, Cancel, the send-by-itself, and Stop while the turn that holds the session is a coding agent's
 * own. The row is spent, and its copy kept for a reload cleared, the moment its message goes (`sendMessage`'s `goes`),
 * not at the end of the turn it starts; where a turn running in the chat takes no words as it would go, the message
 * joins the chat's queue and the row gives way to it, as it does where the message goes as a note into that turn. The
 * message goes as it was sent: its words as typed, and what went with them (`opts`: a switch's answer, a card's, the
 * answers it overrules). Used by the 409 path and by the reload restore.
 * @param {any} chat @param {any} turn
 * @param {{ text: string, attachments?: any[], holder: any, opts?: { allow?: boolean, modeSwitch?: boolean, sendAsIs?: boolean, overrules?: import("./composer/overrule-line.js").Overruling[], carry?: string | null } }} payload
 */
function armWaiting(chat, turn, payload) {
  const { text, attachments = [], holder, opts = {} } = payload;
  const content = [];
  for (const a of attachments) content.push(attachmentBlock(a));
  if (text) content.push({ type: "text", text });
  if (!content.length) content.push({ type: "text", text: "" });
  /** Lets go of the session view the row's Stop follows (`offerStop`). */
  let unwatch = () => {};
  /** The row is spent — its message went, or was cancelled: its line and buttons go, where they are drawn. */
  const spent = () => {
    unwatch();
    turn.waitingText = null;
    turn.cancelWait = null;
    turn.stopIt = null;
    transcript.drawFoot(turn);
  };
  /** Whether its message has gone: the page may still give it back (`send`). */
  let gone = false;
  /** Whether a coding agent's turn of its own held the chat while it waited: that turn is on record by the time it goes. */
  let ownRan = !!holder?.own;
  /**
   * The message goes: as a turn of its own — or, another holder having taken the session first (the two-tabs rule),
   * waiting again on a row of its own, whose queue is the chat's then. This row is spent the moment it goes, and its
   * copy kept for a reload goes with it: a reload while its turn runs sends nothing again.
   */
  const goes = () => {
    gone = true;
    if (chat.waiting === q) {
      wstore.clear(String(chat.chainId));
      chat.waiting = null;
    }
    turn.status = "done";
    spent();
  };
  /**
   * The message went another way than as a turn of its own — into the chat's queue, or as a note into the chat's running
   * turn: its row gives way, and its copy kept for a reload goes with it.
   */
  const gaveWay = () => {
    unwatch();
    if (chat.waiting === q) {
      wstore.clear(String(chat.chainId));
      chat.waiting = null;
    }
    chat.turns = chat.turns.filter((/** @type {any} */ t) => t !== turn);
    transcript.dropTurn(turn);
  };
  /**
   * A turn runs in the chat that takes no words as the message would go — its own send's, or one followed here
   * (`sendMessage`'s "queue"): the message joins the chat's queue whole, as every message told so does, and goes as that
   * turn ends — first, ahead of what was sent while it waited, which was sent after it; the queue keeps its own copy. It
   * waits as it was sent: its files, the answers it overrules, and what it answers (`queuedAnswer`: a card's question, a
   * switch's form, a waiting call's permission switch) go with it; words alone, as words.
   */
  const queued = () => {
    gaveWay();
    const kept = { ...(opts.overrules?.length ? { overrules: opts.overrules } : {}), ...queuedAnswer(opts) };
    composer.enqueueFirst(attachments.length || Object.keys(kept).length ? { text, files: attachments, ...kept } : text);
  };
  const q = createWaitingQueue({
    content,
    holder,
    shown: () => chatOf(state.currentId) === chat,
    // The view's holder is the one source (D7): the events feed keeps it current — its release to null included,
    // which must reach the queue as it is — and the holders resync corrects a release the feed dropped. The captured
    // holder only covers a chat whose view was never applied.
    free: async () => {
      const held = holderFromView(chat, holder);
      // A harness turn holds the chat — another tab's, or a coding agent's own: drawn here as it runs, as the feed's word
      // draws it (`followElsewhere`). A word heard while this page's own send was out found the chat live, and drew none.
      if (held?.window === "harness" && !chat.live && chatOf(state.currentId) === chat) void followElsewhere(chat);
      return held;
    },
    send: async () => {
      if (readOnlyNow()) return holder; // another tab writes the session now: wait, quietly, until this one does
      // The turn it waited on is over: nothing of it is left to stop as the message goes. Its turn is drawn in this
      // row's place, numbered after the turns before it (`replaces`): one row for the message, as a reload shows it.
      offerStop(null);
      // A coding agent's own turn ran while it waited: the chat is read first, so the turn this message starts is
      // numbered after that one (`mergedTurns`), not as it.
      if (ownRan) {
        ownRan = false;
        await hydrate(chat).catch(() => {});
        // The read took its time: a row cancelled meanwhile sends nothing, and one whose chat is no longer shown waits
        // to be shown again — the queue sends into the chat on screen alone — and reads it again then: a hidden chat's
        // view hears no holder change, and another turn of the agent's own may run meanwhile.
        if (turn.status !== "waiting") return null;
        if (chatOf(state.currentId) !== chat) {
          ownRan = true;
          return holder;
        }
      }
      const sent = await sendMessage(text, attachments, undefined, { ...opts, goes, replaces: turn });
      if (sent === false) {
        // The page refused it — before it went (its own live guard), or once it had: a turn of the harness's own held
        // the session, and the row its send drew is gone again. It waits again here.
        if (gone) back();
        return holder;
      }
      if (sent === "queue") {
        queued();
        return null;
      }
      // An answer with no row of its own (a note into the chat's running turn): its row gives way to it.
      if (!gone) gaveWay();
      return null;
    },
    onTick: (t) => {
      // The line's minutes and idle seconds move on: its words change in place, the footer — its Cancel under the
      // pointer — standing as drawn. The composer waits with the row, unless a turn followed here runs in the chat (`free`):
      // the composer is that turn's, its Stop and what is typed meanwhile.
      if (turn.waitingText !== t) {
        turn.waitingText = t;
        transcript.waitingLine(turn);
      }
      if (chatOf(state.currentId) === chat && !chat.live) composer.setLive(false, null, "waiting");
    },
  });
  const stopOwn = () =>
    q.stop(`/sessions/${encodeURIComponent(String(chat.chainId))}/stop`, (why) =>
      toast(`The turn could not be stopped${why ? ` — ${String(why).slice(0, 200)}` : ""}`, "err"),
    );
  /**
   * A coding agent's turn of its own (HarnessV3-ACP AC3-9) is the harness's to stop, and the message then goes first;
   * a chat's move goes on to its end, and the message waits it out. Looked at again as the session view hears the
   * holder change — the events feed's every change, the holders resync's —: the row is drawn again where what it offers
   * changed.
   * @param {any} held
   */
  const offerStop = (held) => {
    if (held?.own) ownRan = true;
    const next = held?.own ? stopOwn : null;
    if (turn.stopIt === next) return;
    turn.stopIt = next;
    transcript.drawFoot(turn);
  };
  const cancel = () => {
    q.cancel();
    if (chat.waiting === q) chat.waiting = null;
    wstore.clear(String(chat.chainId));
    turn.status = "stopped";
    // Withdrawn before it went: on no record, as it waited (history.js `unsent`).
    turn.withdrawn = true;
    spent();
    // What was sent behind it waits in the chat's queue (`sendMessage`): it goes on now, meeting the chat as this
    // message would have.
    if (chatOf(state.currentId) === chat) composer.goOn();
  };
  /** The row waits: the chat's queue is this one, its line and Cancel stand, and its Stop follows the view's holder. */
  const arm = () => {
    chat.waiting = q;
    turn.waitingText = q.text;
    turn.cancelWait = cancel;
    turn.stopIt = holderFromView(chat, holder)?.own ? stopOwn : null;
    unwatch = onSessionView(chat, () => offerStop(holderFromView(chat, holder)));
  };
  /**
   * Given back once it had gone: the row waits again as it was armed, kept for a reload again — drawn again where it
   * gave way to the row its send drew, which the refusal took away.
   */
  const back = () => {
    gone = false;
    wstore.save(String(chat.chainId), payload);
    turn.status = "waiting";
    if (!chat.turns.includes(turn)) {
      // After the chat's turns on record as they stand now (`nextNumber`): a turn that took the chat meanwhile may hold
      // the number it had.
      turn.n = nextNumber(chat.turns);
      chat.turns.push(turn);
      transcript.startTurn(turn);
    }
    arm();
    transcript.drawFoot(turn);
  };
  arm();
}

/**
 * What the last send said where it refused (HarnessV4_Tasks U4): the queue's pause repeats it under its head, since a
 * toast passes. Empty where the send was taken, or refused without a word of its own.
 */
let refusal = "";
/** Whether Continue can send the refused message as it is: false where the send refused the message itself. */
let refusalAgain = true;
/**
 * A send refuses, in words: kept for the queue, and said now unless the page already shows why. `again`: false where
 * what is refused is the message itself — what it says, what it answers —, which only an edit or a removal lifts.
 * @param {string} words @param {boolean} [shown] @param {boolean} [again]
 */
const refuse = (words, shown = true, again = true) => {
  refusal = words;
  refusalAgain = again;
  if (shown) toast(words, "err");
  return false;
};

/**
 * A chat made ready for a message: a model that can answer, the project's folder, and the session itself — made here
 * when the message is the chat's first. Answers the chat that takes the message and its model; null once it has said
 * why not (`refuse`). A chat with no session — none being made for it either — and no turn of its own takes the folder
 * the header holds. `opens`: the person's new message from the box — where the header holds another folder than a chat
 * with a session (or a turn of its own), it opens a new chat there: the session works where it was made. Any other send
 * answers this chat (the queue's next message, a card's or a decision's answer, Resume's "continue") and goes in it, in
 * its own folder. `title` names a session made here; without one the server names it by its first message.
 * @param {import("./state.js").Chat} chat @param {{ title?: string, opens?: boolean }} [o]
 * @returns {Promise<{ chat: import("./state.js").Chat, model: string } | null>}
 */
async function readySession(chat, { title = "", opens = false } = {}) {
  /** @param {string} words @param {boolean} [shown] */
  const no = (words, shown = true) => {
    refuse(words, shown);
    return null;
  };
  // The model before the folder (HarnessV3-Launch LD-D4): a send no model can take is said at once, not after the
  // folder's modal. The folder never changes the model: a new task the header's folder starts keeps the same one.
  const model = composer.modelName() || chat.model || lastModel();
  if (!model) {
    // With no model at all, the picker opens on its Connect a model (LD-D4).
    composer.openModel?.();
    return no(state.models.length ? "Choose a model first" : "No model can answer yet: connect one in the console, from the model picker");
  }
  const chip = folderIn.value.trim();
  if (chip && chip !== chat.cwd) {
    if (!chat.chainId && !chat.making && !chat.turns.some((/** @type {any} */ t) => !t.past)) chat.cwd = chip;
    else if (opens) chat = newChat({ cwd: chip, model: composer.modelName() || chat.model });
  }
  if (!chat.cwd) {
    // "Work outside a project" (the owner's of 10-30: it asked for a folder, in a modal): the chat works in Everything,
    // the folder of Filament's own whose project gathers such chats, made the first time — the bar shows it then.
    let home;
    try {
      home = await api("/memory/projects/everything", { method: "POST", body: {} });
    } catch (e) {
      return no(`this chat has no folder, and Everything's could not be made: ${errText(e)}`);
    }
    // The chip is the chat shown's: one switched to while Everything was made keeps its own.
    if (chatOf(state.currentId) === chat) {
      folderIn.value = home.cwd;
      folderIn.dispatchEvent(new Event("input"));
    }
    chat.cwd = home.cwd;
    sidebar.load();
  }
  rememberFolder(chat.cwd);
  // The remembered default is the base model — unless the id only LOOKS suffixed (`qwen-max`), in which case the
  // whole id is the model and remembering a stripped form would name one that does not exist.
  rememberModel(baseModelOf(model));
  chat.following = true; // a new turn re-arms the tail follow, whatever the last read did
  // The session exists before its first turn; a model or permission mode picked since the last turn travels as a
  // settings change — the document is the one truth of what the loop may do (D10), never a per-turn override.
  const perm = composer.permissionMode?.() || "";
  try {
    await ensureSession(chat, model, perm, composer.effortValue(), title);
  } catch (e) {
    // A typed folder that is not on this machine (a name where a path was meant): the picker recovers the send
    // in place instead of dead-ending it — one picker for the chat: a send that met the same folder waits for the one
    // the first was given (`chat.picking`).
    if (/the folder does not exist/.test(errText(e))) {
      const picked = await (chat.picking ||= pickProjectFolder().finally(() => {
        chat.picking = null;
      }));
      if (!picked) return no("No project folder was chosen", false);
      folderIn.value = picked;
      folderIn.dispatchEvent(new Event("input"));
      chat.cwd = picked;
      rememberFolder(picked);
      try {
        await ensureSession(chat, model, perm, composer.effortValue(), title);
      } catch (e2) {
        return no(`the session could not be created: ${errText(e2)}`);
      }
    } else {
      return no(`the session could not be created: ${errText(e)}`);
    }
  }
  // A session that names no model (a chat an import brought: the other agent's model is no route of Filament's): its
  // first message here takes the composer's, written as the session's setting like a choice of the picker.
  if (!chat.model && !(await writeSessionSettings(chat, { patch: { model: { name: model } } }))) return null;
  // The document is the one truth (D6): the controls wrote the model, the effort and the mode at once, so the
  // send carries no settings of its own.
  chat.model = model;
  return { chat, model };
}

/**
 * A chat not shown made ready for its queued message (the owner's of 10-30), or for the message a card's answer sends
 * again once the person has opened another chat (`sendsIn`): its session, its model and its folder as its turn just
 * left them — none of the box's, which are the chat shown's. Null once it has said why not, in words
 * its queue's pause repeats (no toast: the chat shown is another).
 * @param {import("./state.js").Chat} chat
 * @returns {{ chat: import("./state.js").Chat, model: string } | null}
 */
function readyAway(chat) {
  if (!chat.chainId) return (refuse("this chat has no session yet", false), null);
  if (!chat.model) return (refuse("this chat has no model to answer it", false), null);
  if (!chat.cwd) return (refuse("this chat has no project folder", false), null);
  chat.following = true;
  return { chat, model: chat.model };
}

/**
 * @param {string} text @param {any[]} attachments @param {string} [modifier]
 * @param {{ allow?: boolean | null, modeSwitch?: boolean, sendAsIs?: boolean, queued?: boolean, overrules?: import("./composer/overrule-line.js").Overruling[], carry?: string | null, replaces?: any, chat?: any, goes?: (() => void) | null, went?: (() => void) | null, boxed?: boolean, ours?: boolean, fresh?: boolean, via?: import("./composer/queue.js").SendVia | null, brief?: { block: string, view?: any } | null }} [o]  `allow`:
 *   the person's press on the card of the call the turn waits on — Allow (true) or Deny (false), none for words; `modeSwitch`:
 *   the message is the permission switch answering a waiting call; `sendAsIs`: it goes past the cold-cache question, the card's answer (HarnessV4_Tasks C26); `queued`: the queue
 *   sent it, and takes it back where the send refuses it (HarnessV4_Tasks U4, V4-D192); `overrules`: the saved agents'
 *   answers the message overrules (HarnessV4_Tasks E15 step 3) — they go with it as a turn, as a note into the
 *   running turn, or held with it for a run not known yet; `carry`: the form a switch's fresh agent session carries
 *   the earlier turns in, the switch card's answer (HarnessV4_Tasks A7); `replaces`: the turn whose message this sends
 *   again — one a card stopped before it was sent, or a waiting row's, gives its row to this one (`withoutAsked`); `chat`: a chat not shown
 *   whose queue sends its next message (`drainElsewhere`), or whose card's answer sends its message again (`sendsIn`)
 *   — its own model and folder, the transcript, the composer and the title left to the chat shown; `goes`: told the
 *   moment the message goes out as a turn of its own, its row drawn and its request on its way — the waiting row it
 *   waited on is spent then (`armWaiting`), not at the end of the turn it starts; `went`: told at that same moment, and
 *   nothing more — an answer on a row learns its message went, where the send answers only at its turn's end
 *   (`sendAsked`); `boxed`: the box sent it, and takes it
 *   back where the send refuses it (composer.js) — no other way of sending does; `ours`: words Filament wrote (a task's
 *   carry-on, Resume's "continue", a switch's answer), which a refusal asks nothing of the person to send again;
 *   `fresh`: the person's new message, typed in the box and sent from it (not the queue's) — the one send the header's
 *   other folder takes to a new chat (`readySession`'s `opens`); `via`: the row of the box's ⌄ menu it went by while a
 *   turn ran, and how it was pressed (the owner's of 11-09) — the steer carries it to the run's log, and the turn it
 *   starts says it in its request's head; `brief`: a thread's brief sent again as the brief it was (`sendAgain`) — its
 *   `block` is the message, with no words (`text` is "") and nothing attached, its row drawn as the brief's (`view`),
 *   and the server takes it as its starter's agent's (`postTurn`'s `thread`); it is no note into a running turn and
 *   waits in no queue, so where a message would, it is refused in words
 */
async function sendMessage(text, attachments, modifier, { allow = null, modeSwitch = false, sendAsIs = false, queued = false, overrules = [], carry = null, replaces = null, chat: away = null, goes = null, went = null, boxed = false, ours = false, fresh = false, via = null, brief = null } = {}) {
  refusal = "";
  refusalAgain = true;
  // A view-only device's page sends nothing: a send that reaches here from a door left standing is refused in its words.
  if (viewOnlyPage()) return refuse(VIEW_ONLY_WORDS, !away);
  // A message its queue sends is out of the tab's copy before it goes: a page whose process goes down before the next
  // second's look never brings it back to send twice (`keepQueues`).
  if (queued) keepQueues();
  const typed = text;
  // `/flow <words>` (HarnessV4_OneAgent_Plan OA3, OA-D6, L22): the words go to the main agent as its message, with
  // Filament's line asking it to design a flow from them. The word alone says what to type after it; a team's own chat
  // draws none; a turn waiting for your answer is answered first; while a turn runs it waits in the queue, whole, and
  // goes as a message of its own at the turn's end — never a note into the turn.
  const flowAsk = flowWordsOf(text);
  if (flowAsk != null) {
    // A chat not shown is judged as itself — the team chats the page heard of — and its refusal is said in its queue.
    if (!flowAsk) return refuse(FLOW_USAGE, !away, false);
    if (away ? besideStore.knownChat(String(away.chainId || ""))?.main : besideStore.main()) return refuse(FLOW_TEAM_CHAT, !away, false);
    const at = away || chatOf(state.currentId);
    if (at?.live?.turn?.paused) return refuse("Your agent's turn waits for your answer: answer it first, then type /flow", !away);
    if (at?.live) {
      toast("/flow waits in the queue: it goes to your agent as a message of its own once this turn ends");
      return "queue";
    }
    text = flowAsk;
  }
  // `/plan [words]` (the owner's of 11-05): the message goes to the main agent as typed, with Filament's line asking it to
  // plan the work whole before any of it starts — the checklist for a short job, the task graph for complex work —; the
  // card after its reply opens the Plan. A turn waiting for your answer is answered first; while a turn runs it waits in
  // the queue, whole, and goes as a message of its own at the turn's end.
  const planAsk = flowAsk == null ? planWordsOf(text) : null;
  if (planAsk != null) {
    if (away ? besideStore.knownChat(String(away.chainId || ""))?.main : besideStore.main()) return refuse(PLAN_TEAM_CHAT, !away, false);
    const at = away || chatOf(state.currentId);
    if (at?.live?.turn?.paused) return refuse("Your agent's turn waits for your answer: answer it first, then type /plan", !away);
    if (at?.live) {
      toast("/plan waits in the queue: it goes to your agent as a message of its own once this turn ends");
      return "queue";
    }
  }
  // `/goal …` while a turn runs (core/goal-drive.js): `/goal hold` holds the goal at once — never a note into the round
  // it would stop —, and any other waits in the queue for the turn's end, as a command of its own.
  const goalAsk = flowAsk == null && planAsk == null ? /^\/goal(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim()) : null;
  if (goalAsk) {
    const at = away || chatOf(state.currentId);
    if (at?.live && /^(?:hold|pause)$/i.test(String(goalAsk[1] || "").trim())) {
      void holdGoalNow(at);
      return;
    }
    if (at?.live && !at.live.turn?.paused) {
      toast("/goal waits in the queue: Filament answers it once this turn ends");
      return "queue";
    }
  }
  // `/steer-fork <message>` (the owner's of 11-05): the message goes into the running turn as the ⌄ menu's Weigh aside
  // first sends it — a fork of the turn weighs it before the agent reads it. One a queue sends went in it as its turn
  // ran (Send when it's done, a turn followed with no run yet): that turn has ended, and its words go as the next message.
  const forkAsk = flowAsk == null && planAsk == null && !goalAsk ? steerForkOf(text) : null;
  if (forkAsk != null) {
    if (!forkAsk) return refuse(STEER_FORK_USAGE, !away, false);
    text = forkAsk;
    if (!queued && !away) modifier = "fork";
  }
  // The saved agents and teams the message names with an `@` past its start (HarnessV4_OneAgent_Plan OA2, L27: "there
  // should be a process mid way instead of it immediately going to tagged agent"): nothing starts at Send. They go with
  // it — as a turn, as a note into the running turn, or held with it for a run not known yet — and Filament tells the
  // main agent to use them. A team's key is the team's, where a saved agent's tag holds the same word (U13-D13).
  let chat = away || chatOf(state.currentId);
  // A send goes where the field it was typed under says.
  if (!chat) chat = newChat({ cwd: folderIn.value.trim() });
  const teamsNow = teamsOf(chat);
  // A /flow's names are the flow's: none is for the agent to use now.
  const useCards = flowAsk ? [] : usesIn(text, agentCards.all(), teamsNow);
  const useTags = useCards.map((c) => c.tag);
  const useTeamRows = flowAsk ? [] : teamUsesIn(text, agentCards.all(), teamsNow);
  const useKeys = useTeamRows.map((/** @type {any} */ t) => String(t.key));
  // Read-only is the chat shown's: a chat not shown that another tab writes refuses its send at the server, in words.
  if (!away && followsStill()) return refuse(readOnlyWords());
  // Whoever sends is caught up.
  caughtUp(chat.chainId);
  // A thread's brief again (`brief`) is no note into a running turn and waits in no queue, whose messages go as the
  // person's: refused in words where a message would take either way.
  if (brief && (chat.live || chat.waiting || compactingBetween(chat))) return refuse(BRIEF_AGAIN_LATER, !away);
  // A coding agent's turn (HarnessV3-ACP AC3-1): what is typed goes into its running turn, or in at its next step
  // (AC-D6), where its agent takes words so, as a note — its run says so — and waits in the queue for the turn's end
  // where it doesn't. Until the run is known it is held, as for the loop.
  const agentTurn = !!chat.live && !chat.live.turn.paused && (chat.live.runKind === "coding-agent" || (!chat.live.runKind && codingAgentModel(chat.model)));
  // A message to weigh aside first: only a running turn of Filament's own agent forks, and the message comes back to
  // the box, saying why, where none runs.
  const weigh = modifier === "fork";
  if (weigh && (agentTurn || !chat.live || chat.live.turn.paused)) return refuse(steerForkRefusal(agentTurn ? "agent" : chat.live ? "paused" : "idle"), !away, false);
  if (agentTurn && chat.live.runKind && !agentTakesWords(chat.live.steer)) {
    toast(agentQueuesWords(chat.live.own));
    return "queue";
  }
  // A live run: the composer is the mailbox — Enter a note, Ctrl+Enter a veto. The answer to a PAUSED turn
  // is an ordinary next message (the loop resumes from it), so a pause is not steering.
  if (chat.live && chat.live.runId && !chat.live.turn.paused) {
    const kind = modifier === "veto" && !agentTurn ? "veto" : "note";
    // An agent that queues what is typed (HarnessV3-FailurePoints §7.2): the bubble says where the note waits, from
    // the first moment. Interrupt and send (FP-D8) is the menu's, and only where the run says it can be interrupted.
    const interrupt = modifier === "interrupt" && agentTurn && chat.live.interrupts === true;
    const how = agentTurn && chat.live.steer === "queued" ? { queuedAt: chat.live.agent || "the agent", ...(interrupt ? { interrupt: true } : {}) } : {};
    // Pictures go into a run that reads them, with the words (the composer sends them here only then); any other
    // file, or a run that reads none, and the message goes back to the box whole.
    // A team's result is words (team_v2_plan §10 O3): it goes in ahead of the person's, and the bubble names it.
    const team = teamWords(attachments, text);
    if (team.others.length && !(chat.live.pictures && team.others.every((a) => a.kind === "image")))
      return refuse("This turn takes words only while it runs — your message is back in the box with its files");
    const images = team.others.map((a) => ({ name: String(a.name || "picture"), mediaType: String(a.type || "image/png"), data: a.data }));
    // The bubble draws them from the page's own bytes until the run's log names each by its ref (V4-D303).
    const files = images.length || team.named.length ? { files: [...team.named, ...images.map((p) => p.name)], shots: [...team.named.map(() => null), ...images.map((p) => (SENT_TYPES.has(p.mediaType) ? { src: `data:${p.mediaType};base64,${p.data}` } : null))] } : {};
    // Whose answers the note overrules: the bubble says so, and the cards.
    const over = overrules.length ? { overrules: overrules.map((o) => ({ name: o.name })) } : {};
    try {
      const out = await steerPost(chat.live.runId, { kind, text: team.words, ...(interrupt ? { interrupt: true } : {}), ...(images.length ? { images } : {}), ...(overrules.length ? { overrules } : {}), ...(kind === "note" && useTags.length ? { use: useTags } : {}), ...(kind === "note" && useKeys.length ? { useTeams: useKeys } : {}), ...(weigh ? { weigh: true } : {}), ...(via ? { via } : {}) });
      transcript.addSteer(chat.live.turn, { id: out?.message?.id || `local-${Date.now()}`, kind, text, read: false, unread: false, ...how, ...files, ...over });
      // It named some with an `@` for the turn to use: the turn's end says which it did not (OA-D12).
      if (out?.use?.length) chat.live.turn.useNoted = true;
      noteOverruled(chat, overrules, text);
      teamSent(team.teamed, "steered");
    } catch (e) {
      // A 409 means no loop is listening: the message would never be heard. Say so on the bubble, not only in a toast.
      transcript.addSteer(chat.live.turn, { id: `local-${Date.now()}`, kind, text, read: false, unread: false, undelivered: true, ...files });
      return refuse(/409/.test(errText(e)) ? "No run is listening — the message was not delivered" : errText(e));
    }
    return;
  }
  // A turn followed from elsewhere with no run to follow (HarnessV4_Tasks U4): nothing can take a note, so the
  // message waits in the queue for the turn's end, as the composer says.
  if (chat.live?.unfollowed && !chat.live.runId && !chat.live.turn.paused) return "queue";
  if (chat.live && !chat.live.turn.paused) {
    // No run to steer yet (HarnessV3-CodebasePass decision 2): the turn is still composing, compacting at its line or
    // reading memory. The message is held, drawn as waiting for the run, and sent the moment the run is known.
    const kind = modifier === "veto" && !agentTurn ? "veto" : "note";
    // A team's result is words (§10 O3): held with them, ahead of them — and said sent only once the run takes it
    // (`deliverHeld`); a turn that ends with no run gives it back to the queue, still a team's result (found by the Bug
    // Hunter, 10-19: it was said sent the moment it was held).
    const team = teamWords(attachments, text);
    const m = chat.live.held.hold(kind, team.words, overrules, { teams: team.teamed, typed: text, ...(kind === "note" ? { use: useTags, useTeams: useKeys } : {}), weigh });
    // The row it went by goes with it to the run (`steerPost`).
    if (via) Object.assign(m, { via });
    transcript.addSteer(chat.live.turn, { id: m.id, kind, text, held: true, read: false, unread: false, ...(team.named.length ? { files: team.named, shots: team.named.map(() => null) } : {}), ...(overrules.length ? { overrules: overrules.map((o) => ({ name: o.name })) } : {}) });
    return;
  }
  // A message waits for the chat on its row (`armWaiting`): the chat has one such row. What is typed meanwhile waits in
  // the chat's queue behind it, and goes as the turn that message starts ends; a card's answer, or a way on's, goes once
  // that message has gone — the queue would send it as words alone — and a switch's answer goes as none: the message
  // that waits goes under the mode in force. The row's own send goes.
  if (chat.waiting && replaces?.status !== "waiting") {
    if (modeSwitch) return;
    if (replaces || sendAsIs || carry) return refuse("A message already waits for this chat: send this once that one has gone", !away);
    if (!queued && !away) toast("Queued behind the message waiting for this chat");
    return "queue";
  }
  // A compaction written between the chat's turns — Compact now's, a card's Compact, another tab's — has not made its
  // room yet: a message sent meanwhile met the context as it was, and the card that asks before a message stood again
  // over the compaction at work (the owner's of 11-05). It waits in the chat's queue and goes once the room is made
  // (`roomMade`), or waits paused where none was (`roomNotMade`). A card's own message goes as it is (`sendAsIs`, a
  // switch's `carry`): the compaction was its answer; the card's other answers and Retry are refused in words meanwhile
  // (`turnRunsIn`). A new message that opens a new chat in the header's other folder goes there (`opensElsewhere`).
  if (!sendAsIs && !carry && !modeSwitch && compactingBetween(chat) && !(fresh && opensElsewhere(chat))) {
    chat.roomWait = true;
    if (!queued && !away) toast(queueOf(chat).paused ? "A compaction is being written for this chat — your message waits in the queue, paused: Continue sends it once the compaction is done" : "A compaction is being written for this chat — your message waits in the queue, and goes once it is done");
    return "queue";
  }
  // Run on another machine (the remote desk's s2c): a new chat's first message from the box starts its chat there and
  // opens it in place; nothing is made here. It goes as plain words: what this page would make of a command, a brief or
  // the agents it names is not sent there.
  if (!away && fresh && !chat.chainId && !chat.making && (chat.runOn || chat.runOnBusy)) {
    if (brief || flowAsk != null || planAsk != null || goalAsk || forkAsk != null || useCards.length || useTeamRows.length)
      return refuse("Run on sends plain words as the chat's first message: once the chat opens there, send /flow, /plan, /goal, /steer-fork or @names in it", true, false);
    return runOnFirst(chat, text, attachments);
  }
  const ready = away ? readyAway(chat) : await readySession(chat, { opens: fresh });
  if (!ready) return false;
  chat = ready.chat;
  // A turn began in the chat while it was made ready — the send whose session this one waited for (`ensureSession`):
  // the message waits in the chat's queue for that turn's end, as no second turn beside it. A "queue" answer goes to the
  // box's queue, the chat shown's: where another chat is shown by now, the chat's own queue takes it here, whole — its
  // words as typed, what went with them, what it answers — and the send answers that it is taken. A brief waits in none.
  if (brief && chat.live) return refuse(BRIEF_AGAIN_LATER, !away);
  if (chat.live && !chat.live.turn.paused) {
    if (chatOf(state.currentId) !== chat) {
      queueAdd(queueOf(chat), [{ text: typed, files: attachments, ...(overrules.length ? { overrules } : {}), ...queuedAnswer({ sendAsIs, carry, modeSwitch, allow }) }]);
      return;
    }
    if (!queued && !away) toast("A turn began in this chat meanwhile — your message waits in the queue, and goes when it ends");
    return "queue";
  }
  // The message a card stopped goes now: its row and card give way to this turn, before it takes a number — in the
  // row's own place, the chat not drawn again around it (HarnessV4_Tasks U11: the card used to vanish in a redraw).
  const unasked = withoutAsked(chat.turns, replaces);
  if (unasked) {
    chat.turns = unasked;
    transcript.dropTurn(replaces);
  }
  // Where the send goes nowhere (a turn of the harness's own, a client's chat), the row comes back with its message: a
  // waiting row's own send is armed on its row again (`armWaiting`), any other row stands again as it was.
  const gaveWay = unasked && !goes ? replaces : null;

  const content = [];
  for (const a of attachments) content.push(attachmentBlock(a));
  if (text) content.push({ type: "text", text });
  // A thread's brief again: Filament's one block is the message whole.
  if (brief) content.push({ type: "text", text: brief.block });
  if (!content.length) content.push({ type: "text", text: "" });
  // The chat's first message carries its load: a message on no record before it (`unsent`) was not the first.
  const first = !chat.turns.some((t) => !t.past && !unsent(t));
  /** @type {any} */
  const turn = {
    // Numbered after the newest turn on record (`nextNumber`), a guess the session's own number replaces as the head
    // names it (`renumbered`); a message on none (`unsent`) numbers none, and one still waiting is numbered again as
    // it goes.
    n: nextNumber(chat.turns),
    userText: brief ? brief.block : text || "(attachments)",
    // A thread's brief again: its row is the brief's, as the record's turn draws it (history.js `briefTurn`), and a
    // Retry of this one sends the same block (`againOf`).
    ...(brief ? { by: "thread", brief: brief.view || { from: null, title: "", text: "" }, briefBlock: brief.block } : {}),
    // The send's own name, which the turn it begins or goes on in keeps: a read knows the turn by it where the reply's
    // head never came (`servedAs`).
    sendId: newSendId(),
    attachments: attachments.map((a) => ({ name: a.name, size: a.size, kind: a.kind })),
    // What went with the words, whole: a way on sends it again with them (`againOf`).
    sent: [...attachments],
    // What was typed, where Filament's words went in its place (a /flow's): a message a card stopped goes back to the box
    // as it was typed (`takeBackAsked`).
    ...(typed !== text ? { typed } : {}),
    userContent: content,
    blocks: [],
    steers: [],
    status: "streaming",
    segments: [],
    requestId: null,
    runId: null,
    boundaries: [],
    boundariesAfter: [],
    // Who answers it (HarnessV3-AtHome AH-O7): the transcript stamps it so; the conversation's dividers and the lead's
    // footer read it while it runs (VW-D8).
    engine: engineStamp(chat.view?.settings?.engine),
    // Whose answers the message overrules, whole: its row says them by name, and a message a card stopped goes back to
    // the box with them (`takeBackAsked`).
    ...(overrules.length ? { overrules: [...overrules] } : {}),
    // A message a card stopped, gone again in this turn's place: the left bar's Now says it at work until the server's
    // word of the turn comes (`askedChats`).
    ...(unasked ? { again: againMark(replaces) } : {}),
  };
  // The next message goes out: a compaction before it answers this turn now, and can no longer be undone.
  for (const t of chat.turns)
    if ([...(t.boundaries || []), ...(t.boundariesAfter || [])].some((b) => b.type === "compaction" && b.undoable)) {
      for (const b of [...(t.boundaries || []), ...(t.boundariesAfter || [])]) if (b.type === "compaction") b.undoable = false;
      transcript.drawBoundaries(t);
    }
  // …and a read asked before it, landing after, is told so (`hydrate`).
  (chat.rowsHeard ||= []).push({ at: Date.now(), sent: true });
  chat.turns.push(turn);
  transcript.startTurn(turn);
  // The title and the composer are the chat shown's: a queued message a chat not shown sends leaves them be.
  if (chatOf(state.currentId) === chat) {
    setTitle(chat);
    composer.setLive(true, null);
    composer.meter();
  }

  const aborter = new AbortController();
  /** @type {any} */
  const live = { turn, aborter, reply: null, runId: null, follower: null, events: [], stopSent: false, meterRaf: 0, usedAt: Date.now(), held: createHeldSteers({ post: steerPost }) };
  chat.live = live;
  // Its chat named first: the transcript attaches the live reply of the chat it shows alone, and draws a chat not
  // shown once it is opened (its render's `startLive`).
  live.chat = chat;
  transcript.startLive(live);
  sidebar.drawOpen();
  nowIn(chat);
  if (chatOf(state.currentId) === chat) composer.setUsedAt(live.usedAt);

  /** The send done, its turn ended and its run's end drawn: the turn keeps its log's alignment alone (labels.js
   *  `letGoOfLog`), as an ended turn the transcript read does. A log whose newest event is no `run-end` may bring more,
   *  and a paused turn has not ended: either keeps its log, as one with a hole does. */
  const letGoOfRun = () => {
    if (chat.live === live || live.holed || !turn.alignCache || live.events[live.events.length - 1]?.type !== "run-end") return;
    if (turn.status === "done" || turn.status === "error" || turn.status === "stopped") letGoOfLog(turn.alignCache, live.events);
  };
  /** A gap said in the log, by any of its reads: the turn keeps its log, and a later reading reads it again. */
  const holedLog = () => void (live.holed = true);
  /** The turn drawn from its run's whole log. `landed`, the events since the last draw: what they say to the composer is
   *  said once they are drawn, since a steer the log carries first is the turn's only then. @param {any[]} landed */
  const drawRun = (landed) => {
    transcript.applyEvents(turn, live.events);
    for (const e of landed) agentUnheard(chat, live, e);
    letGoOfRun(); // a run that outlived its reply ends here
    nowIn(chat);
    const shown = chatOf(state.currentId) === chat;
    // The panes, the views and the status panel are the shown chat's: a turn running in a chat not shown refreshed them
    // for nothing, and read its goal and its place for a panel that drew neither. The terminals are the server's, shown
    // whatever chat is; the goal and the place are read again as the chat is shown.
    if (shown) {
      rail.pulse();
      views.pulse();
    }
    if (shown) refreshStatus(chat);
    else {
      loadTerminals();
      chat.goalAt = 0;
      chat.gitAt = 0;
    }
  };
  // Once a frame, however many events land (the bug report's X1).
  const runDraw = createRunDraw(drawRun);
  /** One of the turn's run events — carried by the reply itself (R3), or from a follow of the run. @param {any} e */
  const onRunEvent = (e) => {
    live.watch?.heard();
    const newest = live.events[live.events.length - 1];
    if (e?.n != null && newest?.n != null && e.n <= newest.n) return; // a follow that overlaps what the reply carried
    live.events.push(e);
    ownAgentMoved(chat, e);
    meterHears(chat, live, e);
    browserHears(chat, e);
    runDraw.add(e);
  };
  let detected = false;
  // The reply carries the run's events (its head says so, R3): no lookup and no second stream while it lasts — the
  // page's connections to Filament are six, and a turn used to take two of them.
  let carried = false;
  // The head names a run to look up (LD-D13): a command Filament answered itself has none, and a lookup was a 404.
  let hasRun = false;
  let runEnded = false;
  /** @param {any} e */
  const carriedEvent = (e) => {
    if (e?.type === "run-start" && e.kind) runKnown(chat, live, e);
    if (!detected) {
      detected = true;
      live.runId = turn.requestId;
      turn.runId = turn.requestId;
      deliverHeld(chat, live);
    }
    if (e?.type === "run-end") runEnded = true;
    onRunEvent(e);
  };
  const detectRun = async (requestId, attempt = 0) => {
    // An agent turn's run shares the request id. No run → the chat is a pure transcript. A run
    // that ended before this answer came back (a fast loop, a permission ask on round one) is replayed from the
    // persisted events — the cards never depend on the race between the reply and this lookup (§4.5 replay).
    if (detected) return;
    let runInfo = null;
    try {
      runInfo = await api(`/runs/${encodeURIComponent(requestId)}`);
    } catch (e) {
      // The loop publishes run-start as it begins; a lookup that lands first sees a 404 for a moment.
      if (/404/.test(errText(e)) && attempt < 3 && chat.live === live) { setTimeout(() => detectRun(requestId, attempt + 1), 400); return; }
      return;
    }
    if (!runInfo?.run || detected) return;
    detected = true;
    live.runId = requestId;
    turn.runId = requestId;
    runKnown(chat, live, runInfo.run);
    deliverHeld(chat, live);
    const ended = !!runInfo.run.endedAt || runInfo.run.status !== "running";
    if (ended && chat.live !== live) {
      // The reply is over and so is the run: one page of events is the whole story.
      try {
        const page = await api(`/runs/${encodeURIComponent(requestId)}/events?since=0&limit=5000`);
        if (page?.gap) holedLog();
        live.events = page?.events || [];
        drawRun([]);
      } catch {}
      return;
    }
    live.follower = followRun(requestId, {
      since: 0,
      onEvent: onRunEvent,
      onGap: (gap) => {
        holedLog();
        toast(`The run log dropped events ${gap.requested + 1}–${gap.firstAvailable - 1} (the ring filled); the transcript shows what it has`, "err");
      },
      onDone: () => {},
    });
  };
  // The watchdog (F3 item 16, BUG-25): a live view that heard no run event for 30 s while the run's log grew follows
  // the run again from the cursor (the reply keeps its own read; the two overlap by number only), and is said to be
  // lost, under the newest work, only where a look later finds it behind still (HarnessV4_Tasks B15). A reply that
  // carries the run's events and still says anything, its ping included, is no silent stream: every event before its
  // last word has arrived with it. A run that ended while the reply stays silent after a follow again (decision 14):
  // the reply is the one thing stuck — the page stops reading it and draws the turn from the transcript.
  live.replyAt = Date.now();
  const followAgain = () => {
    live.lostOnce = true;
    live.follower?.stop();
    live.follower = followRun(String(live.runId), { since: cursorOf(live), onEvent: carriedEvent, onGap: holedLog, onDone: () => {} });
  };
  live.watch = watchLive({
    runId: () => (chat.live === live ? live.runId : null),
    cursor: () => cursorOf(live),
    lookup: runLookup,
    aliveAt: () => (carried ? live.replyAt : 0),
    onBehind: followAgain,
    onLost: () => {
      if (!turn.liveLost) pageSaid("status", LIVE_LOST_WORDS, String(chat.chainId || ""));
      transcript.liveLost(turn, true);
      followAgain();
    },
    onBack: () => transcript.liveLost(turn, false),
    onEnded: () => {
      if (chat.live !== live || !live.lostOnce || Date.now() - live.replyAt < LIVE_QUIET_MS) return;
      live.replyLost = true;
      aborter.abort();
    },
  });
  /**
   * The page lets go of this send's live view before its end — the turn it shows runs on at the server, where the page
   * follows it again: what landed is drawn, the watch and any follow end, and a message held for the run goes out as
   * the next one, said so. @param {string} said
   */
  const letLiveGo = (said) => {
    runDraw.now();
    transcript.flushBlocks(live);
    live.watch.stop();
    live.follower?.stop();
    if (live.meterRaf) cancelAnimationFrame(live.meterRaf);
    requeueHeld(chat, live, live.held.release(), said);
    chat.live = null;
    nowIn(chat);
  };
  /** The harness's own running turn, when it refused this send (its 409's holder). @type {any} */
  let ownTurn = null;
  /** An outside client's chat refused this send: its 409's words, and the fork that goes on from it. @type {any} */
  let clientsOwn = null;

  // The words a card stopped go out now, by its answer: they are no draft any more.
  if (draftFor(chat) === typed) saveDraft(chat, "");
  // The message goes out now: a waiting row it went from is spent (`armWaiting`).
  goes?.();
  went?.();
  // Put away mid-turn (the back/forward cache), the page lets the reply go (ui/lib/put-away.js): the turn runs on, the
  // server's (HarnessV2 D1), and the page brought back loads afresh and follows it as any reload does.
  const letGo = holdWhileShown(() => {
    live.putAway = true;
    aborter.abort();
  });
  try {
    const r = await postTurn({
      chainId: String(chat.chainId),
      content,
      sendId: turn.sendId,
      allow,
      modeSwitch,
      sendAsIs,
      overrules: overrulesSent(overrules),
      carry,
      use: useTags,
      useTeams: useKeys,
      flow: flowAsk != null,
      plan: planAsk != null,
      thread: !!brief,
      // Parallelize tasks rides no message: the session reads Settings › Experimental's switch for a /plan, a team's lead aside, and the agent's prompt says the rest once (the owner's of 11-09; the review of 11-09).
      load: first && chat.load ? chat.load : null,
      via,
      signal: aborter.signal,
      onHeaders: (id, marks) => {
        turn.requestId = id;
        // The number the session gave the turn, where another tab's turn took the one this send guessed: the turn takes
        // it, and its end reads the turns the page does not hold.
        if (renumbered(chat.turns, turn, marks.turn)) chat.hydrateAfterSend = true;
        // The turn was taken: the session records the overrule with it, and the cards say so now.
        if (marks.status === 200) noteOverruled(chat, overrules, text);
        // A team's result in it: its card says it went (team_v2_plan §10 O3).
        if (marks.status === 200) teamSent(attachments, "sent");
        // Whom its words named with an `@` for the main agent to use (HarnessV4_OneAgent_Plan OA2): its row says so now.
        if (marks.use) turn.use = [...useCards.map((c) => ({ tag: c.tag, name: c.name })), ...useTeamRows.map((/** @type {any} */ t) => ({ key: String(t.key), name: String(t.name || t.key) }))];
        // A /flow's message (OA3): Filament's line asking for a flow rode ahead of it; its row says so now.
        if (marks.flow) turn.flow = true;
        // A /plan's message: Filament's line asking for a plan rode ahead of it; its row says so now.
        if (marks.plan) turn.plan = true;
        if (marks.planCard) turn.planCard = true;
        // The box's side by side line rode ahead of it (11-06): one of its deliveries, no agent's message.
        if (marks.side) turn.side = true;
        // The flows you started beside the chat, told to the main agent with this message (OA-D8).
        if (marks.flowStarts) turn.flowStarts = marks.flowStarts;
        // The word of a flow it drives In place that waited for this message (OA4).
        if (marks.flowNews) turn.flowNews = marks.flowNews;
        // A rewind's line rode with it; and the rewind's Undo ended with this message (rewind.js).
        if (marks.rewindNote) turn.rewindNote = true;
        // The line on why the goal's drive halted rode with it (core/goal-drive.js `haltLine`).
        if (marks.goalHalt) turn.goalHalt = true;
        if (marks.status === 200 && chat.rewind) {
          chat.rewind = null;
          chat.rewindDraft = null;
          transcript.rewindEnded(chat);
        }
        // A command answer names its card in the headers (Facade D4): the text blocks stay unpainted — the card
        // draws them at the end, and doubled text would flash for the whole stream.
        if (marks.cardKind) turn.cardKind = marks.cardKind;
        // What rode ahead of the message — sub-agents' messages, background shells' exits — as the server took it
        // (HarnessV3-Readiness RD1 c): said under the message now, as the transcript says it after a reload.
        if (marks.deliveries) {
          turn.deliveries = marks.deliveries;
          if (marks.asking) turn.asking = marks.asking;
          if (marks.shellExits) turn.shellExits = marks.shellExits;
          if (marks.shellWatch) turn.shellWatch = marks.shellWatch;
          if (marks.shellWake) turn.shellWake = marks.shellWake;
          if (marks.shellIdle) turn.shellIdle = marks.shellIdle;
          if (marks.shellCancel) turn.shellCancel = marks.shellCancel;
          transcript.drawDelivered(turn);
        }
        if (marks.settingsHash) applySessionView(chat, { settings: { hash: marks.settingsHash } });
        // The settings document changed since the last turn: the boundary row sits above this turn.
        if (marks.boundary && marks.settingsHash && marks.boundary !== (chat.view?.settings?.hash || null)) {
          turn.boundaries.push({ type: "settings", beforeTurn: turn.n, from: marks.boundary, to: marks.settingsHash, at: Date.now() });
          transcript.drawBoundaries(turn);
        }
        hasRun = marks.run;
        if (id) {
          if (marks.runEvents) carried = true;
          else if (marks.run) detectRun(id);
        }
      },
      onRunEvent: carriedEvent,
      onEvent: (j, reply) => {
        live.replyAt = Date.now();
        live.reply = reply;
        transcript.drawBlocks(live);
        measureReply(chat, live);
      },
    });
    // Something else holds the chat (Step 3 D14) — its move, a coding agent's turn of its own: the message waits with
    // the chat and sends itself when that ends. The row keeps the message; the queue's line updates under it. A second
    // send queues alongside, never cancels an older one — waiting sends go out in order, and the row survives a reload
    // (sessionStorage). A thread's brief again (`brief`) waits on no row, which sends its message as the person's: its
    // turn says the refusal, to Retry.
    const holder = r.reply?.httpStatus === 409 ? r.reply.errorBody?.holder || null : null;
    // An outside client's chat is its client's alone: nothing holds it to wait for, and the harness goes on in a fork of
    // it (its 409's `fork`, where it has a finished turn) — below.
    if (r.reply?.httpStatus === 409 && r.reply.errorBody?.client === true) clientsOwn = r.reply.errorBody;
    // The harness's own turn holds it: this page had lost its own running turn (a reload before the turn's message
    // landed — its agent compacting first, minutes at a time). Not a queue's row, whose guess of the next turn's number
    // would be the running turn's own: the page follows that turn again below, and the message goes back to the box.
    else if (holder?.window === "harness" && !holder.own) ownTurn = holder;
    else if (holder && !brief) {
      applySessionView(chat, { holder });
      turn.status = "waiting";
      turn.error = null;
      // It waits as it was sent: its words as typed (a /flow's are Filament's once it goes), and what went with them.
      const opts = { ...(typeof allow === "boolean" ? { allow } : {}), ...(modeSwitch ? { modeSwitch } : {}), ...(sendAsIs ? { sendAsIs } : {}), ...(overrules.length ? { overrules } : {}), ...(carry ? { carry } : {}) };
      const waits = { text: typed, attachments, holder, opts };
      wstore.save(String(chat.chainId), waits);
      armWaiting(chat, turn, waits);
      if (!away) toast(waitingToast(holder));
    } else {
      turn.reply = r.reply;
      // When a card stopped it, as the left bar's Now says how long it has waited for you (`askedChats`).
      if (stoppedToAsk(r.reply)) turn.askedAt = Date.now();
      turn.cardKind = r.cardKind || turn.cardKind || null;
      // A message a card stopped before it was sent (HarnessV4_Tasks C33) is on no record: its words are kept as the
      // session's draft, so a refresh, which shows no card, has them in the box. Words typed since stay the draft.
      if (stoppedToAsk(r.reply) && !brief && !attachments.length && !(chatOf(state.currentId) === chat && composer.draft())) saveDraft(chat, text);
      // A stop steer never aborts the read (the loop ends the turn in its words): a turn the developer stopped from
      // here is stopped all the same, and the queue waits (BUG-07); the record confirms it when the turn is drawn.
      turn.status = r.reply.error ? "error" : aborter.signal.aborted || live.stopSent ? "stopped" : "done";
      turn.error = r.reply.error;
      // Refused in words because another tab writes the session: this page's view of it was stale.
      if (r.reply.errorBody?.readOnly === true) claimWriting("peek");
      if (turn.paused) turn.status = "paused";
    }
  } catch (/** @type {any} */ e) {
    if (live.putAway) return;
    if (e?.name === "AbortError" && live.replyLost) {
      // The watchdog gave up a silent reply after the run ended: the turn is drawn from the transcript, as a reload draws it.
      turn.status = "done";
      turn.fromTranscript = true;
      chat.hydrateAfterSend = true;
    } else if (e?.name === "AbortError") {
      turn.status = "stopped";
    } else {
      turn.status = "error";
      turn.error = String(e?.message || e);
      // A connection that broke ends nothing at the server, where the turn runs on (HarnessV2 D1): asked below.
      live.dropped = !!chat.chainId;
    }
    if (live.reply) transcript.drawBlocks(live);
  } finally {
    letGo();
  }
  // The error the page drew on the turn is kept with the chat (Phase 4b): a connection that broke is the page's alone.
  if (turn.status === "error" && turn.error) pageSaid("error", turn.error, String(chat.chainId || ""));
  // This chat's own turn refused the send: the row the send drew goes, the page follows that turn again — as a reload
  // does once the turn's message lands (followElsewhere) — and the message goes back where it came from (the box, the
  // queue, its waiting row), nothing lost: sent again, it steers the turn, or starts the next one if the turn has ended.
  if (ownTurn) {
    letLiveGo("A turn was already running in this chat — the message goes out as the next one");
    chat.turns = [...chat.turns.filter((t) => t !== turn), ...(gaveWay ? [gaveWay] : [])];
    // Drawn where it shows; switched away from meanwhile, it is drawn whole when shown again.
    if (chatOf(state.currentId) === chat) drawChat(chat);
    if (chatOf(state.currentId) === chat) setTitle(chat);
    applySessionView(chat, { holder: ownTurn });
    if (chatOf(state.currentId) === chat) composer.setLive(false, null);
    // A chat not shown says it in its queue's paused line (`refusal`), not in a toast over the chat shown. A waiting row's
    // message is back on its row (`armWaiting`), which sends it itself.
    if (!away)
      toast(
        queued
          ? "This chat's turn is still running — following it now. Your message is back in the queue: Continue sends it when the turn ends."
          : goes
            ? "This chat's turn is still running — following it now. Your message waits on its row again, and sends itself when the turn ends."
            : gaveWay
              ? "This chat's turn is still running — following it now. Your message stays on its row: send it again once the turn ends."
              : boxed
                ? "This chat's turn is still running — following it now. Your message is back in the box: send it at its next step, or when it's done."
                : ours
                  ? "This chat's turn is still running — following it now. Nothing was sent."
                  : "This chat's turn is still running — following it now. Your message was not sent: send it again once the turn ends.",
      );
    // A chat whose first read is on its way is followed once that read has landed, where it did not hold the turn
    // (`noteUnseenTurn`, openSession): a read beside it would draw the turn twice.
    if (opening.has(chat)) noteUnseenTurn(chat, null, Date.now());
    else followElsewhere(chat);
    refusal = "A turn was already running in this chat";
    return false;
  }
  // An outside client's chat refused the send: the row the send drew goes — nothing of it is on record — and the message
  // goes back where it came from. Where the chat has a finished turn, the fork the server names is offered at it, the
  // message going with it into the fork's box.
  if (clientsOwn) {
    letLiveGo("This chat is its client's: the message goes nowhere");
    chat.turns = [...chat.turns.filter((t) => t !== turn), ...(gaveWay ? [gaveWay] : [])];
    if (chatOf(state.currentId) === chat) drawChat(chat);
    if (chatOf(state.currentId) === chat) composer.setLive(false, null);
    const said = String(clientsOwn.error || "this chat is its client's");
    const fork = clientsOwn.fork && Number(clientsOwn.fork.atTurn) >= 1 ? clientsOwn.fork : null;
    if (!away) {
      const where = gaveWay ? "Your message stays on its row" : queued ? "Your message is back in the queue" : goes ? "Your message waits on its row" : boxed ? "Your message is back in the box" : ours ? "Nothing was sent" : "Your message was not sent";
      toast(`${said[0].toUpperCase()}${said.slice(1)}. ${where}${fork ? `, and goes with a fork of turn ${fork.atTurn}` : ""}.`, "err");
      if (fork && chatOf(state.currentId) === chat) forkModal(chat, { n: Number(fork.atTurn) }, { prefill: text });
    }
    refusal = "This chat is its client's";
    // Its client's turn may have ended while this send waited on the refusal (`clientTurnEnded`): the read it owes.
    if (chat.hydrateAfterSend) {
      chat.hydrateAfterSend = false;
      hydrate(chat).catch(() => {});
      sidebar.load();
    }
    return false;
  }
  // A turn that still runs at the server after its connection broke (a network blip, a laptop waking) is followed
  // again, as a reload follows it: the server's turn now (`past`), drawn afresh and followed from its run's start,
  // words and all (`followLiveTurn`, whose end draws the transcript's copy and tells the queue).
  const head = live.dropped ? await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/transcript?work=0&limit=1`).catch(() => null) : null;
  const runsOn = head ? runningOn(head, chat.turns, turn) : null;
  if (runsOn) {
    letLiveGo("The connection dropped before the run could read your message — it goes out as the next one");
    Object.assign(turn, { past: true, status: "streaming", error: null, blocks: [], segments: [], liveLost: false });
    if (chatOf(state.currentId) === chat) drawChat(chat);
    if (!away) toast("The connection dropped — the turn runs on, and this page follows it again");
    followLiveTurn(chat, runsOn, true);
    return;
  }
  // No turn of this send's left running: one that ended while the connection was down is drawn from the transcript, and
  // one the server never took stays the error it is (keptPageTurns).
  if (live.dropped) {
    turn.fromTranscript = true;
    chat.hydrateAfterSend = true;
    // One that finished at the server while the connection was down is no failure (HarnessV4_Tasks U4): the broken
    // connection was the page's alone, so the turn ends as done and the queue goes on instead of pausing as "failed".
    if (endedOn(head, chat.turns, turn) === "done") {
      turn.status = "done";
      turn.error = null;
    }
  }
  runDraw.now(); // what landed last is drawn before the end reads what the turn drew and said
  turn.reply = turn.reply || live.reply;
  for (const b of live.reply?.blocks || []) if (!turn.blocks.includes(b)) turn.blocks.push(b);
  live.watch.stop();
  if (turn.liveLost) transcript.liveLost(turn, false);
  chat.live = null;
  letGoOfRun();
  // A frame left pending past the end: the stream stopped, so it measures now, for the speed the reply settles to.
  if (live.meterRaf) { cancelAnimationFrame(live.meterRaf); live.meterRaf = 0; measureNow(chat, live); }
  // A reply that carried the run's events but closed before its run-end (a dropped connection): the rest comes from
  // the run's log, from the last event the reply brought.
  if (carried && detected && !runEnded && turn.requestId) {
    live.follower?.stop(); // the watchdog's follow, if it ran: one follow at a time
    live.follower = followRun(turn.requestId, { since: Number(live.events[live.events.length - 1]?.n) || 0, onEvent: onRunEvent, onGap: holedLog, onDone: () => {} });
  }
  // The follower closes itself at run-end; a run that outlives the reply by a moment still gets its last events.
  // Stopping it here was the race that lost every card of a fast turn. A hard stop stays as a 30 s safety net.
  if (live.follower) setTimeout(() => live.follower?.stop(), 30_000);
  // A run this reply belongs to may not have been detected yet (the lookup lost the race with a fast reply):
  // ask once more now that the id is certain, so the cards come from the persisted events.
  if (turn.requestId && hasRun && !detected) await detectRun(turn.requestId);
  // A message still held now never met a run that could read it: it goes out as the next message (decision 2).
  requeueHeld(chat, live, live.held.release());
  // A send that met the chat held waits on its row (`armWaiting`): no turn of the chat's ended, and its queue waits on.
  const endedBy = turn.status === "waiting" ? "waiting" : turn.status === "stopped" ? "stopped" : turn.status === "error" ? "error" : turn.paused ? "paused" : "done";
  // The composer is the shown chat's: a turn that ends while another chat is shown leaves its queue to that chat.
  if (chatOf(state.currentId) === chat) composer.setLive(false, null, endedBy);
  else endedElsewhere(chat, endedBy);
  // The live dot in the tab title belongs to a running turn only — the shown chat's: a turn that ends in another chat
  // (a crafter pausing for a yes while its source chat is shown, the drive of 10-27) leaves the header's title alone.
  if (chatOf(state.currentId) === chat) setTitle(chat);
  await transcript.finish(live, turn.status === "paused" ? "done" : turn.status);
  // The number its record says, where the head named none: a command's turn is numbered as it ends.
  if (renumbered(chat.turns, turn, turn.rec?.memory?.turn)) chat.hydrateAfterSend = true;
  // finish() read the record: a stop the loop never read reads done now, and the queue it paused goes on.
  if (chatOf(state.currentId) === chat) composer.settled(turn.status);
  else if (turnSettled(queueOf(chat), turn.status)) void drainElsewhere(chat);
  // It read what the turn was, too: a model's reply settles its speed, Filament's own answer to a command does not.
  settleSpeed(chat, live, !turn.command);
  // A message gone out since this turn — the queue's next, drained as it ended — ended every Undo: the rows its end
  // places take none, whatever a read served before that message took the session said.
  const sentSince = newestOnRecord(chat.turns) !== turn;
  // A compaction a command wrote inside its own turn (`/compact`, `/autofit` — HarnessV3-Launch RD-D4), with its Undo,
  // or one a coding agent made of its own context during the turn (C28): finish() read it from the transcript, and it
  // lands on its row now, as Compact now's does — not with the next message.
  if (turn.compactions?.length) {
    for (const b of turn.compactions) placeCompaction(chat, sentSince && b.undoable ? { ...b, undoable: false } : b);
    widgets.paint();
  }
  for (const b of turn.copies || []) placeCopy(chat, b);
  // The read this send's end owes (`hydrateAfterSend`): its turn is drawn from the transcript's copy — a silent reply
  // given up, a connection that dropped — or the events feed came back while it ran.
  if (chat.hydrateAfterSend) {
    chat.hydrateAfterSend = false;
    hydrate(chat).catch(() => {});
    sidebar.load();
  }
  // The view follows the turn (D7): the newest finished turn's facts, and the settings document, refetched — a
  // command may have turned knobs, and every model turn moved the ledger (`usage`, Step 6 §2.3) that Spend and
  // Cache read, as a compaction on the way moved the window.
  if (turn.facts) applySessionView(chat, { facts: turn.facts });
  refreshSessionDoc(chat);
  readTurnMemory(chat);
  // The panes follow the turn in place, each reading again what it moved: drawn anew, they put new elements under a
  // resting pointer at each turn's end (the owner's of 11-01).
  rail.refresh();
  views.draw();
  if (turn.paused) transcript.pause(turn);
  if (document.hidden) sayEnded(chat, endWord(turn));
  if (document.hidden && chat.chainId) {
    movedChains.add(chat.chainId);
    paintCatchUp();
  }
  chat.goalAt = 0; // the turn may have set, spent or met the goal: the panel looks again now
  refreshStatus(chat);
  if (chatOf(state.currentId) === chat) paintMeter(chat);
  // Each compaction the composer made for this turn — at its line, for a seed its coding agent refused, in the middle of
  // it — is a boundary row after the turn it ended on (a fold leaves the newest turns whole), where a read places it
  // (`placeBoundary`): finish() read the rows by the ids the turn's record names (`composedCompactions`). A read that
  // landed as the turn finished (another page's message following on, the feed back) holds them already; one undone
  // since that read — here or in another tab (`undoneIds`) — stays gone; the Undo is the newest's, as that read gave it,
  // and nobody's once a message has gone since (`sentSince`).
  const undone = chat.undoneIds || new Set();
  for (const row of turn.composedCompactions || []) {
    if (undone.has(Number(row.id))) continue;
    if (row.undoable && !sentSince) undoOnlyOn(chat, row);
    const placed = row.undoable && (sentSince || newerCompaction(chat.turns, row.id)) ? { ...row, undoable: false } : row;
    // A read asked before it lacks it, and is told it (`hydrate`) — one this page holds already too: a read keeps no
    // compaction row it lacks (history.js `mergedTurns`).
    (chat.rowsHeard ||= []).push({ at: Date.now(), row: placed, asRead: true });
    if (holdsRow(chat.turns, row)) continue;
    const home = placeBoundary(chat.turns, placed);
    if (home) transcript.drawBoundaries(home);
  }
  sidebar.load();
  nowIn(chat);
  // The turn may have written in a new place or moved a branch (HarnessV4_Git_Plan GWC-59), and its branch's count with
  // them: the strip's `+N −N` is the place's.
  if (chatOf(state.currentId) === chat) headerModule.refreshGit();
}

/**
 * Where the shown chat's agent works now, on the header (HarnessV4_Git_Plan GW-D65): its running turn's newest
 * `place`; nothing once the turn ended.
 * @param {any} chat
 */
function nowIn(chat) {
  if (chatOf(state.currentId) !== chat) return;
  headerModule.setNow(chat.live?.turn?.aligned?.place || null);
  // Back to your agent greys as a turn starts and comes back as it ends (the 9 plausible of 10-19: it waited for the
  // next repaint of anything else).
  chargeBand.paint(chat);
  // The browser's line goes as the turn ends, for the same reason: the runs list may have moved before it did.
  paintBrowserLine();
}

/** One message into a run's mailbox (the composer's Enter and Ctrl+Enter; `interrupt`: the menu's Interrupt and send, a
 *  note that interrupts its coding agent; `images`: the pictures it carries into a run that reads them).
 *  `overrules`: the saved agents' answers a note overrules (HarnessV4_Tasks E15 step 3) — Filament tells the agent
 *  whose, with the note. `use`, `useTeams`: the agents' tags and the teams' keys the note's words name with an `@` past
 *  their start (HarnessV4_OneAgent_Plan OA2): nothing starts — the running turn reads Filament's line beside the note,
 *  telling it to use them, and the answer names them (`use`).
 *  `weigh`: the person asked that a fork of the turn weigh the note first (the ⌄ menu's Weigh aside first, `/steer-fork`).
 *  `via`: the row of the ⌄ menu it went by, and whether by a key or a click (the owner's of 11-09): its steer event keeps it.
 *  @param {string} runId @param {{ kind: string, text: string, interrupt?: boolean, images?: { name: string, mediaType: string, data: string }[], overrules?: import("./composer/overrule-line.js").Overruling[], use?: string[], useTeams?: string[], weigh?: boolean, via?: import("./composer/queue.js").SendVia }} m */
const steerPost = (runId, m) =>
  api(`/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: m.kind, text: m.text, from: "harness", ...(m.interrupt ? { interrupt: true } : {}), ...(m.images?.length ? { images: m.images } : {}), ...(m.overrules?.length ? { overrules: overrulesSent(m.overrules) } : {}), ...(m.use?.length ? { use: m.use } : {}), ...(m.useTeams?.length ? { useTeams: m.useTeams } : {}), ...(m.weigh ? { weigh: true } : {}), ...(m.via ? { via: m.via } : {}) } });

/** A model a coding agent serves: its turns run no loop of Filament's; its run says whether it takes words mid-turn.
 *  @param {string} name */
const codingAgentModel = (name) => !!state.models.find((/** @type {any} */ m) => m?.id === name)?.codingAgent;

/**
 * The run is known: the messages held for it go to its mailbox in the order typed, each bubble swapped for the one
 * the mailbox answered with (the event log matches that id). One the run refused — it had already ended — goes out as
 * the next message instead (HarnessV3-CodebasePass decision 2); so do all of them where the run is a coding agent's
 * that takes no words mid-turn (HarnessV3-ACP AC3-1).
 * @param {any} chat @param {any} live
 */
async function deliverHeld(chat, live) {
  if (!live.held.size()) return;
  if (live.runKind === "coding-agent" && !agentTakesWords(live.steer)) return requeueHeld(chat, live, live.held.release(), agentQueuesWords(live.own));
  const refused = [];
  for (const r of await live.held.flush(String(live.runId))) {
    live.turn.steers = live.turn.steers.filter((/** @type {any} */ s) => s.id !== r.held.id);
    if (r.out) {
      transcript.addSteer(live.turn, { id: r.out?.message?.id || r.held.id, kind: r.held.kind, text: r.held.text, read: false, unread: false, ...(r.held.overrules?.length ? { overrules: r.held.overrules.map((/** @type {any} */ o) => ({ name: o.name })) } : {}) });
      noteOverruled(chat, r.held.overrules || [], r.held.text);
      teamSent(r.held.teams || [], "steered");
      if (r.out?.use?.length) live.turn.useNoted = true;
    } else refused.push(r.held);
  }
  transcript.markSteers(live.turn);
  requeueHeld(chat, live, refused);
}

/**
 * Held messages no run will read: off the turn, into the chat's queue (`queueNext`) — one that carries a team's result
 * as the person's words with the result beside them again, so the next turn sends it, and says so. No run heard the row
 * one was sent by (`via`, the owner's of 11-09): the turn it starts says it.
 * @param {any} chat @param {any} live @param {{ id: string, text: string, overrules?: any[], teams?: any[], typed?: string, via?: import("./composer/queue.js").SendVia }[]} list
 * @param {string} [said]  why, for the toast: by default, the turn ended before its run read them
 */
function requeueHeld(chat, live, list, said) {
  if (!list.length) return;
  const gone = new Set(list.map((m) => m.id));
  live.turn.steers = live.turn.steers.filter((/** @type {any} */ s) => !gone.has(s.id));
  transcript.markSteers(live.turn);
  const queued = list.map((m) => (m.teams?.length
    ? { text: m.typed ?? "", files: m.teams, ...(m.overrules?.length ? { overrules: m.overrules } : {}), ...queuedVia(m) }
    : m.overrules?.length || m.via ? { text: m.text, files: [], ...(m.overrules?.length ? { overrules: m.overrules } : {}), ...queuedVia(m) } : m.text));
  queueNext(chat, queued, said || (list.length === 1 ? "The turn ended before its run could read your message — it goes out as the next one" : `The turn ended before its run could read ${list.length} messages — they go out next, in order`));
}

/**
 * Messages for the next turn, into the chat's queue: sent as the next message when the turn ends, or kept there while
 * a stop or an error has paused the queue. Another chat shown, they wait in their own chat's queue, which says so when
 * it is opened again.
 * @param {any} chat @param {(string | import("./composer/queue.js").QueuedMessage)[]} texts @param {string} said  why, for the toast
 */
function queueNext(chat, texts, said) {
  if (chatOf(state.currentId) !== chat) return queueAdd(queueOf(chat), texts);
  composer.enqueue(texts);
  toast(said);
}

/**
 * The chat's own queue (HarnessV3-Views V3), made the first time it is asked for — and taking back, then, what it held
 * when the page last went away (HarnessV4_Tasks U4): first, in order, paused for Continue.
 * @param {any} chat @returns {import("./composer/queue.js").QueueState}
 */
/**
 * A chat not shown whose own turn ended done sends its next queued message (the owner's of 10-30: one queued in a chat
 * whose turn ended while they were in another waited there, paused, for Continue): as the composer's drain sends the
 * shown chat's, one per turn end — the turn it starts sends the next as it ends — but as the chat's own send, its
 * model and folder, never into the chat shown. A turn of its own that runs after all, or a send it refused, puts the
 * message back first, the refusal paused in its words. A turn that went on elsewhere sends nothing: its queue waits.
 * @param {any} chat
 */
async function drainElsewhere(chat) {
  if (chat.live || chatOf(state.currentId) === chat) return;
  const st = queueOf(chat);
  const next = awayNext(st);
  if (!next) return;
  const ok = await sendMessage(queuedText(next), queuedFiles(next), "normal", { queued: true, overrules: queuedOverrules(next), ...queuedAnswer(next), ...queuedVia(next), chat });
  if (ok === "queue") awayBack(st, next);
  else if (ok === false) awayBack(st, next, refusal, refusalAgain);
}

/**
 * A turn of this page's ended in a chat not shown — its send's, or that send followed again after its connection
 * dropped: its queue hears the ending, and sends its next message where the turn ended done, and the one Stop and send put
 * first whatever ended it, as the shown composer's queue does (the bug hunt of 10-30). A stop or a failure pauses it,
 * saying so; a question keeps it for the person, whom opening the chat tells they were away. A send that met the chat
 * held waits on its row (`waiting`), and its queue waits behind it.
 * @param {any} chat @param {"done" | "stopped" | "error" | "paused" | "waiting"} endedBy
 */
function endedElsewhere(chat, endedBy) {
  const st = queueOf(chat);
  const now = st.now;
  if (turnEnded(st, endedBy) && (now || endedBy === "done")) void drainElsewhere(chat);
}

function queueOf(chat) {
  if (chat.queue) return chat.queue;
  const st = (chat.queue = queueState());
  // A chat with no session yet has nothing kept: its first send makes the session.
  if (!chat.chainId) return st;
  const back = kept.take(String(chat.chainId));
  queueRestored(st, back.items);
  // Taken back, it is kept again at once: the page's process going down before the next second's look would lose the
  // queue the crash notice says waits (Fable 5.2's review of 11-17).
  if (back.items.length) kept.keep(String(chat.chainId), [...st.items]);
  if (back.lost.length) toast(keptLostWords(back.lost), "err");
  return st;
}

/** What the page says when the session's stop found no turn to stop: a Stop that did nothing never looks like one that did. */
const NOTHING_TO_STOP = "No turn is running in this session: there was nothing to stop";

async function stopCurrent() {
  if (viewOnlyPage()) return void toast(VIEW_ONLY_REFUSED, "err");
  const chat = chatOf(state.currentId);
  const live = chat?.live;
  if (!live) {
    // No turn of this page's: a turn of the session's the page lost its hold of, still running on the server (the turn
    // is the server's, HarnessV2 D1): the session's stop finds it there by its run. What it found is said, and the page
    // reads the session again.
    const chainId = chat?.chainId;
    if (!chainId) return;
    try {
      const out = await api(`/sessions/${encodeURIComponent(String(chainId))}/stop`, { method: "POST" });
      offerForceForRun(chat, runToForce(out));
      toast(stopReached(out) ? `Stopping the turn running in this session${chat.compactAfter ? " — the session is compacted once it has ended" : ""}` : NOTHING_TO_STOP);
      if (!stopReached(out) && chatOf(state.currentId) === chat) composer.setLive(false, null, "done");
      hydrate(chat).catch(() => {});
    } catch (e) {
      toast(errText(e), "err");
    }
    return;
  }
  if (live.runId) {
    if (live.stopSent) return;
    live.stopSent = true;
    composer.setStopping(true, !!chat.compactAfter); // the button stands down until the turn ends (BUG-09)
    try {
      const out = await api(`/runs/${encodeURIComponent(live.runId)}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } });
      transcript.addSteer(live.turn, { id: out?.message?.id || `local-stop-${Date.now()}`, kind: "stop", text: "", read: false, unread: false });
      offerForceLater(chat, live);
      return; // the loop cuts what is running and ends the turn in its words; the stream says so
    } catch {
      live.stopSent = false;
      composer.setStopping(false);
      // fall through to the session's stop
    }
  }
  // No run id yet (the turn is still composing, or its head is on its way): the session's stop reaches the turn
  // whether or not its request has started — the turn is the server's (HarnessV2 D1). When it lands as a steer (the
  // head was just written, or the route found the turn's run itself), the loop ends the turn in its words and the
  // stream says so: keep reading. Otherwise the turn was cancelled before it was sent, or nothing ran — said, so a
  // stop the server had nothing to take is not read as one that landed — and the page stops reading.
  if (live.stopSent) return;
  live.stopSent = true;
  composer.setStopping(true, !!chat.compactAfter);
  /** @type {any} */
  let out = null;
  try {
    out = await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/stop`, { method: "POST" });
  } catch (e) {
    toast(errText(e), "err");
  }
  if (out?.stopped === "steered") return offerForceLater(chat, live);
  if (out && !stopReached(out)) toast(NOTHING_TO_STOP);
  live.aborter.abort();
}

/**
 * A crafter chat opened (app/crafter-chats.js): from the chat shown — its folder and model — with the person's words,
 * or for a made skill (its page's Craft it in a chat…); the page goes to it. False, with why, where it could not open.
 * @param {{ words?: string, skill?: string | null }} o
 */
async function openCrafter({ words = "", skill = null }) {
  const at = chatOf(state.currentId);
  const cwd = at?.cwd || folderIn.value.trim() || recentFolders()[0] || "";
  const model = composer.modelName() || at?.model || lastModel() || "";
  if (!cwd) return refuse("Pick the project folder first: the crafter chat works in it");
  if (!model) return refuse("Choose a model first: the crafter chat runs on it");
  try {
    const r = await api("/skills/craft", { method: "POST", body: { words, skill, chain: at?.chainId || null, cwd, model } });
    // Its first message waits in its box for your Send — a model to change first, words to add (rule 1).
    if (r.draft) saveDraft({ chainId: r.id }, r.draft);
    await openSession({ id: r.id, title: r.title, cwd }, { push: true });
    // The list learns the new chat — its row in the sidebar, and the crafter's line over its box (onChanged).
    void sidebar.load();
    toast(craftOpenedWords(r.title, !!r.draft));
    return true;
  } catch (e) {
    return refuse(`The crafter chat did not open: ${errText(e)}`);
  }
}

/** How long a stop may leave an agent turn running before Force stop is offered (HarnessV3-FixRound F2 item 13). */
const FORCE_OFFER_MS = 5000;

/**
 * A stop usually ends the turn within a second; one the loop cannot act on yet (a hook, a reader, a compaction, a
 * snapshot is running) leaves it live. After FORCE_OFFER_MS with the same turn still running, Force stop is offered
 * (HarnessV3-FixRound decision 25).
 * @param {any} chat @param {any} live
 */
function offerForceLater(chat, live) {
  clearTimeout(live.forceTimer);
  live.forceTimer = setTimeout(() => {
    if (chat.live !== live || live.forceSent) return;
    if (chatOf(state.currentId) === chat) composer.offerForce(true);
  }, FORCE_OFFER_MS);
}

/**
 * The same offer after a stop that went through the session with no turn of this page's under it (one this page lost
 * its hold of): Force stop is offered while the run that stop steered still runs, as the run log says (HarnessV4_Tasks
 * U2). Where the stop steered no run, none is offered.
 * @param {any} chat @param {string | null} runId  `runToForce` of the stop's answer
 */
function offerForceForRun(chat, runId) {
  clearTimeout(chat.forceTimer);
  if (!runId) return;
  chat.forceTimer = setTimeout(async () => {
    const run = await runLookup(runId).catch(() => null);
    if (!run || run.endedAt != null || chatOf(state.currentId) !== chat || !composer.live().streaming) return;
    composer.offerForce(true);
  }, FORCE_OFFER_MS);
}

/**
 * Force stop: the server ends the turn now, whatever its loop or its agent is waiting on; what finished stays. By the
 * turn's run where this page knows it; else through the session, which forces the run its stop would have steered
 * (HarnessV4_Tasks A5) — a turn this page lost its hold of, or one whose run is not named yet.
 */
async function forceStopCurrent() {
  const chat = chatOf(state.currentId);
  const live = chat?.live;
  if (!chat?.chainId || live?.forceSent) return;
  if (live) live.forceSent = true;
  composer.offerForce(false);
  try {
    if (live?.runId) {
      await api(`/runs/${encodeURIComponent(live.runId)}/steer`, { method: "POST", body: { kind: "stop", force: true, from: "harness" } });
      live.turn.stopped = { by: "harness", forced: true };
      return;
    }
    const did = forceOutcome(await api(`/sessions/${encodeURIComponent(String(chat.chainId))}/stop`, { method: "POST", body: { force: true } }));
    if (did === "forced" && live) live.turn.stopped = { by: "harness", forced: true };
    if (did === "nothing") toast(NOTHING_TO_STOP);
  } catch (e) {
    if (live) live.forceSent = false;
    toast(errText(e), "err");
    if (!live || chat.live === live) composer.offerForce(true);
  }
}

/**
 * Stop and compact (HarnessV3-RunawayTurns CW-D6; HarnessV4_Tasks U2): one action for a turn that runs away with the
 * session's room. Compact alone is refused while a turn runs, so the server is asked to compact once the running
 * turn has ended, and the turn is stopped; Force stop is offered after it as after any stop. With no turn running it
 * is Compact. One at a time per chat: a second press while the first waits does nothing.
 */
function stopAndCompact() {
  if (viewOnlyPage()) return void toast(VIEW_ONLY_REFUSED, "err");
  const chat = chatOf(state.currentId);
  if (!chat?.chainId) return;
  if (!composer.live().streaming) return void compactSession(chat);
  if (chat.compactAfter) return;
  chat.compactAfter = true;
  compactNow(chat, { onceTurnEnds: true }).finally(() => { chat.compactAfter = false; });
  stopCurrent();
}

// ---------------------------------------------------------------------------------------------------
// Rewind in place (the owner's word of 10-27; the Designer's design; app/sessions/rewind.js)
// ---------------------------------------------------------------------------------------------------
/** Why the chat cannot rewind now, in the Designer's words; null where it can. @param {any} chat */
function rewindRefusal(chat) {
  if (!chat?.chainId || !(chat.turns || []).some((/** @type {any} */ t) => t.n != null && t.status !== "streaming" && !unsent(t))) return "Nothing to rewind yet: rewind after the chat's first reply";
  if (chat.live || chat.view?.holder) return "A turn is running in this chat: rewind once it ends, or stop it first";
  return null;
}

/**
 * The messages of yours a rewind can go back to, newest first: not one Filament or a coding agent began (the turn's
 * `by`), nor one rewound already, nor one on no record (`unsent`). @param {any} chat
 */
const rewindable = (chat) =>
  (chat.turns || []).filter((/** @type {any} */ t) => t.n != null && !unsent(t) && !t.rewound && !t.commandText && !t.by && String(t.userText || "").trim()).reverse();

/** "12 min ago", for the list and the confirm's head. @param {any} at */
function rewindAgo(at) {
  const ms = Date.now() - (Number(at) || 0);
  if (!Number(at) || ms < 0) return "";
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} days ago`;
}

/** A message in a line: its words, clipped. @param {any} text @param {number} n */
const clipLine = (text, n) => {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * `/rewind` and Esc Esc in an empty box (the Designer's §1): your messages, newest first, each with the files its turn
 * changed; picking one opens the confirm. Nothing moves here.
 */
async function rewindList() {
  const chat = chatOf(state.currentId);
  const why = rewindRefusal(chat);
  if (why) return void toast(why, "err");
  const mine = rewindable(chat);
  if (!mine.length) return void toast("Nothing to rewind yet: rewind after the chat's first reply", "err");
  /** @type {Map<number, number>} */
  const counts = new Map();
  /** @type {any} */
  let d = null;
  const rows = mine.map((/** @type {any} */ t) => {
    const files = h("span", { class: "rw-pick-files muted" });
    const b = h("button", { class: "rw-pick", type: "button", onclick: () => { d.close(); rewindConfirm(chat, t); } },
      h("span", { class: "rw-pick-n muted" }, `Turn ${t.n}`),
      h("span", { class: "rw-pick-text" }, clipLine(t.userText, 70)),
      files,
      h("span", { class: "rw-pick-ago muted" }, rewindAgo(t.startedAt)));
    return { t, b, files };
  });
  const list = h("div", { class: "rw-picks", role: "listbox" }, ...rows.map((r) => r.b));
  // ↑↓ move through the list, Enter picks (the button's own), Esc closes (the dialog's).
  list.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const at = rows.findIndex((r) => r.b === document.activeElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? -1 : at) + (e.key === "ArrowDown" ? 1 : -1)))];
    next?.b.focus();
  });
  d = dialog({
    title: "Rewind to an earlier message",
    description: "Pick the message to go back to. Nothing moves until you confirm.",
    body: list,
    cls: "rw-dialog",
    wide: true,
    actions: [{ label: "Cancel", variant: "outline", onClick: () => d.close() }],
  });
  rows[0]?.b.focus();
  // "3 files" from the turns' record alone, no git (the changes route's `scope=turns`).
  api(`/memory/sessions/${encodeURIComponent(String(chat?.chainId))}/changes?scope=turns`).then((/** @type {any} */ r) => {
    for (const t of r?.turns || []) counts.set(Number(t.n), Number(t.files) || 0);
    for (const row of rows) {
      const n = counts.get(Number(row.t.n)) || 0;
      row.files.textContent = n ? (n === 1 ? "1 file" : `${n} files`) : "";
    }
  }).catch(() => {});
}

/**
 * The rewind's confirm (the Designer's §2–3): what goes back — files and conversation (the default), the conversation
 * alone, or the files alone (the files card's Undo) — read from the server before the button wakes; Fork instead
 * (Edit's fork, the text filled in), Cancel, and the button that rewinds. The message goes back in the box for either
 * conversation choice, above a draft already there. While a question waits for the person's answer (the read's
 * `asking`) it says so up front: the conversation's rewind takes the question away with the turn that asked, and the
 * files alone are not offered — the files card's Undo chooses files and conversation instead.
 * @param {any} chat @param {any} turn @param {{ what?: string }} [opts]
 */
function rewindConfirm(chat, turn, opts = {}) {
  const why = rewindRefusal(chat);
  if (why) return void toast(why, "err");
  // A message withdrawn before it went has no turn of the session's to go back to.
  if (unsent(turn)) return void toast("This message never went: there is nothing of it to rewind", "err");
  const n = Number(turn.n);
  const chainId = String(chat.chainId);
  let what = opts.what === "files" || opts.what === "conversation" ? opts.what : "both";
  /** @type {any} */
  let plan = null;
  let busy = false;
  const ago = rewindAgo(turn.startedAt);
  const head = h("div", { class: "rw-from muted small" }, `“${clipLine(turn.userText, 60)}” · turn ${n}${ago ? `, ${ago}` : ""}`);
  const ways = /** @type {const} */ ([["both", "Files and conversation"], ["conversation", "Conversation only"], ["files", "Files only"]]);
  const seg = ways.map(([id, label]) => h("button", { class: "rw-way", type: "button", "aria-pressed": "false", onclick: () => choose(id) }, label));
  const conv = h("div", { class: "rw-sec" });
  const files = h("div", { class: "rw-sec" });
  const more = h("div", { class: "rw-more muted small" });
  const note = h("div", { class: "rw-note muted small" }, "Reading what would change…");
  const askSlot = h("div", { class: "rw-ask" });
  /** @type {any} */
  const d = dialog({
    title: "Rewind to before this message?",
    body: h("div", { class: "rw-body" }, head, askSlot, h("div", { class: "rw-label" }, "Goes back"), h("div", { class: "rw-ways", role: "group" }, ...seg), conv, files, more, note),
    cls: "rw-dialog",
    wide: true,
    actions: [
      // Fork instead forks at this turn: one that failed has no answer to fork at (`forkable`).
      ...(forkable(turn) ? [{ label: "Fork instead", variant: /** @type {const} */ ("ghost"), onClick: () => { d.close(); forkModal(chat, turn, { prefill: turn.userText || "", precheck: true }); } }] : []),
      { label: "Cancel", variant: "outline", onClick: () => d.close() },
      { label: rewindButton(what), onClick: () => void go() },
    ],
  });
  const main = /** @type {HTMLButtonElement | null} */ (d.el.querySelector(".zc-dialog-foot button:last-child"));
  // Enter presses the main button: the focus starts there, not on Fork instead.
  main?.focus();
  // ←/→ change the choice; Enter presses the main button.
  d.el.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      e.preventDefault();
      const at = ways.findIndex(([id]) => id === what);
      choose(ways[(at + (e.key === "ArrowRight" ? 1 : ways.length - 1)) % ways.length][0]);
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      void go();
    }
  });
  const span = () => (plan ? turnsWords(plan.conversation.from, plan.conversation.to) : `turn ${n}`);
  const canFiles = () => !!plan && plan.files.length > 0;
  /** Whether the files alone go back: none while a question waits for its answer. */
  const filesAlone = () => canFiles() && !plan.asking;
  /** No rewind of the conversation takes the question that waits: answered first, then rewound. */
  const askingStays = () => !!plan?.asking && plan.asking.turn == null;
  /** @param {string} id */
  function choose(id) {
    if (busy) return;
    if (id !== "conversation" && plan && !canFiles()) return;
    if (id === "files" && plan && !filesAlone()) return;
    what = id;
    paint();
  }
  function paint() {
    seg.forEach((b, i) => {
      const id = ways[i][0];
      b.setAttribute("aria-pressed", String(id === what));
      b.classList.toggle("on", id === what);
      const off = !!plan && id !== "conversation" && !canFiles();
      const asked = !off && !!plan?.asking && id === "files";
      b.toggleAttribute("disabled", off || asked || busy);
      b.title = off ? filesCannot() : asked ? "A question waits for your answer: the files can't go back alone while it waits" : "";
    });
    if (main) {
      main.textContent = busy ? "Rewinding…" : rewindButton(what);
      main.disabled = busy || !plan || !!plan.busy || (what === "files" && !filesAlone()) || askingStays();
    }
    if (!plan) return;
    // A question waits for its answer: said up front, before what goes back.
    askSlot.replaceChildren(...(plan.asking ? [h("div", { class: "rw-asking small" }, askingStays()
      ? "A question waits for your answer: answer it first, then rewind."
      : `A question from turn ${plan.asking.turn} waits for your answer: rewinding the conversation takes it away with its turn. The files can't go back alone while it waits.`)] : []));
    // Conversation.
    conv.replaceChildren(h("div", { class: "rw-sec-head" }, "Conversation"),
      what === "files"
        ? h("div", { class: "muted small" }, `It stays. With your next message, Filament tells the agent the files went back to before turn ${n}.`)
        : h("div", { class: "muted small" }, `${span()[0].toUpperCase()}${span().slice(1)} ${plan.conversation.to > plan.conversation.from ? "leave" : "leaves"} the conversation. They're kept: Show them on the rewind's line, or open them as a fork. Your message goes back in the box.`));
    // Files.
    const rows = plan.files.map((/** @type {any} */ f) => {
      const leaf = String(f.path).split("/").pop() || f.path;
      const where = f.place && plan.folder && f.place !== plan.folder ? ` in ${String(f.place).split(/[\\/]/).pop()}` : "";
      return h("div", { class: "rw-file" },
        h("span", { class: "rw-file-leaf" }, leaf),
        leaf !== f.path ? h("span", { class: "rw-file-path muted" }, f.path) : null,
        h("span", { class: "rw-file-act" }, `${fileWords(f, n)}${where}`),
        f.also ? h("div", { class: "rw-file-also" }, "⚠ also changed by someone else — those edits go too") : null);
    });
    const left = plan.left.length
      ? h("details", { class: "rw-left" }, h("summary", { class: "muted small" }, `Left as they are: ${plan.left.length === 1 ? "1 file" : `${plan.left.length} files`} that changed while commands ran — by them or by someone else`),
          ...plan.left.map((/** @type {any} */ f) => h("div", { class: "rw-file muted small" }, f.path)))
      : null;
    const cannot = plan.cannot.map((/** @type {any} */ f) => h("div", { class: "rw-file muted small" }, `${f.path}: can't go back — ${f.why}`));
    const outside = plan.outside.length ? h("div", { class: "muted small" }, `${plan.outside.length === 1 ? "1 file" : `${plan.outside.length} files`} written outside git can't be put back`) : null;
    const errs = plan.errors.map((/** @type {any} */ x) => h("div", { class: "muted small" }, `In ${x.place}: can't go back — ${x.error}`));
    const n2 = plan.files.length;
    files.replaceChildren(h("div", { class: "rw-sec-head" }, n2 ? `Files · ${n2 === 1 ? "1 goes back as it was" : `${n2} go back as they were`} before turn ${n}` : "Files"),
      ...(what === "conversation"
        ? [h("div", { class: "muted small" }, n2 ? `They stay as they are now: ${n2 === 1 ? "1 file keeps" : `${n2} files keep`} what ${span()} changed. With your next message, Filament tells the agent so.` : `${span()[0].toUpperCase()}${span().slice(1)} changed no files.`)]
        : n2
          ? [...rows, left, ...cannot, outside, ...errs]
          : [h("div", { class: "muted small" }, filesCannot()), left, ...cannot, outside, ...errs]).filter((x) => x != null));
    // The lines that apply: a coding agent's own copy of the conversation.
    const agent = coderNameOf(chat);
    more.replaceChildren(...(what !== "files" && agent
      ? [h("div", {}, `${agent} holds its own copy of the conversation: your next message starts a fresh session from Filament's copy of the turns before turn ${n}. Its prompt cache starts cold.`)]
      : []));
    note.textContent = plan.busy ? plan.busy : what === "conversation" ? "Undo, on the rewind's line, brings the turns back until you send your next message." : "Filament snapshots the folder first: Undo, on the rewind's line, puts it all back until you send your next message.";
  }
  function filesCannot() {
    if (!plan) return "";
    if (plan.errors.length && !plan.files.length) return `Files can't go back: ${plan.errors[0].error}`;
    return `${span()[0].toUpperCase()}${span().slice(1)} changed no files that can go back: only the conversation goes back.`;
  }
  async function go() {
    if (busy || !plan || plan.busy || (what === "files" && !filesAlone()) || askingStays()) return;
    busy = true;
    paint();
    try {
      const r = await api(`/sessions/${encodeURIComponent(chainId)}/rewind`, { method: "POST", body: { turn: n, what } });
      d.close();
      // Your message back in the box, for either conversation choice, above what you had typed (§5).
      if (what !== "files" && chat.id === state.currentId) {
        const typed = composer.draft();
        const text = String(turn.userText || "");
        composer.setDraft(typed.trim() ? `${text}\n\n${typed}` : text);
        chat.rewindDraft = { put: composer.draft(), was: typed };
      }
      chat.rewind = { turn: n, what, line: r.line || null, from: r.from, to: r.to ?? null, files: Number(r.files) || 0 };
      await hydrate(chat);
    } catch (e) {
      busy = false;
      paint();
      note.textContent = errText(e);
    }
  }
  paint();
  api(`/sessions/${encodeURIComponent(chainId)}/rewind?turn=${n}`).then((/** @type {any} */ p) => {
    plan = p;
    if (what !== "conversation" && !canFiles()) what = opts.what === "files" ? "files" : "conversation";
    else if (what === "files" && plan.asking) what = "both";
    paint();
  }).catch((e) => {
    note.textContent = errText(e);
  });
}

/** Undo on the rewind's line, until the next message (§4): the files and the turns as they were; the box too. @param {any} chat */
async function undoRewindIn(chat) {
  try {
    await api(`/sessions/${encodeURIComponent(chat.chainId)}/rewind/undo`, { method: "POST", body: {} });
    // The message the rewind put in the box leaves it, while the box is still as the rewind left it.
    const put = chat.rewindDraft;
    if (put && chat.id === state.currentId && composer.draft() === put.put) composer.setDraft(put.was || "");
    chat.rewindDraft = null;
    chat.rewind = null;
    await hydrate(chat);
  } catch (e) {
    toast(errText(e), "err");
  }
}

// ---------------------------------------------------------------------------------------------------
// Fork
// ---------------------------------------------------------------------------------------------------
function forkModal(chat, turn, opts = {}) {
  const n = turn.n || 1;
  const chainId = chat.chainId;
  if (!chainId) {
    toast("Nothing to fork yet: fork after the chat's first reply", "err");
    return;
  }
  const wt = h("input", { type: "checkbox", ...(opts.precheck ? { checked: "" } : {}) });
  const wtRow = h("label", { class: "check hidden" }, wt, " Also check out the files as they were");
  const note = h("div", { class: "muted small" }, "Files are not rewound: this turn has no working-tree snapshot.");
  /** What the turns wrote that the snapshot does not hold: said where they did. */
  const miss = h("div", { class: "fork-miss small hidden" });
  // What the fork inherits of the transcript (HarnessV2 §6.7), in the words everywhere says (U3, UX-4); the session's
  // `fork.transcript` is the default pick.
  const eff = chat.view?.settings?.effective || {};
  const chosen = String(eff.fork?.transcript || "ditto");
  // A plan carried (piece E) carries the conversation as a brief, the plan the work: chosen before the control is
  // drawn, so what it shows is what goes (the review of 58cfe9b31).
  const planTasks = Number(opts.plan) || 0;
  let carry = planTasks && FORK_TRANSCRIPT_WORDS.some((x) => x.id === "brief") ? "brief" : FORK_TRANSCRIPT_WORDS.some((x) => x.id === chosen) ? chosen : "ditto";
  // "Carry earlier turns as": the control a sub-agent's launch and a fresh agent session share (U3-7, UX-12).
  const strat = carryControl(h, { options: FORK_TRANSCRIPT_WORDS, value: () => carry, onChange: (id) => { carry = id; } });
  const results = h("select", { class: "fork-select" },
    h("option", { value: "" }, "As this chat sends them"),
    h("option", { value: "keep" }, "As is"),
    h("option", { value: "line" }, "One line, with its recall id"));
  const stratRow = h("div", { class: "fork-carry" }, strat.el, h("label", { class: "fork-row" }, h("span", { class: "muted small" }, "Tool results"), results));
  // The plan carried (piece E), offered from the Plan's Continue in a new chat: its tasks, the notes and files kept
  // behind them; it closes here. A brief carries the conversation, the plan the work.
  const planBox = h("input", { type: "checkbox", checked: "" });
  const planRow = planTasks ? h("label", { class: "check fork-plan" }, planBox, ` Carry the plan — ${planTasks} task${planTasks === 1 ? "" : "s"}, with the notes and files kept behind them; it closes here`) : null;
  let busy = false;
  // A real dialog (on the overlay stack): Esc and the backdrop close it, and one Esc cannot fall through to the
  // control room underneath — the raw .modal it replaces never answered Esc at all.
  /** @type {any} */
  const d = dialog({
    title: "Fork this chat from here?",
    description: "A new chat starts with the conversation up to this message.",
    body: h("div", { class: "fork-body" }, planRow, stratRow, wtRow, note, miss),
    actions: [
      { label: "Cancel", variant: "outline", onClick: () => d.close() },
      {
        label: "Fork",
        onClick: async () => {
          if (busy) return; // a slow fork must not be clicked into two forks
          busy = true;
          note.textContent = carry === "brief" ? "forking… (writing the brief with the compaction model)" : "forking…";
          try {
            const fork = await api(`/sessions/${encodeURIComponent(chainId)}/fork`, { method: "POST", body: { atTurn: n, worktree: wt.checked, strategy: carry, results: results.value || null, ...(planRow && planBox.checked ? { plan: true } : {}) } });
            d.close();
            openFork(chat, fork, opts.prefill || "");
            // The fork was made, and the plan could not go after all: said, the plan as it was here.
            if (fork?.plan && !fork.plan.ok) toast(`The plan stayed in this chat: ${fork.plan.error}`, "err");
          } catch (err) {
            note.textContent = errText(err);
            busy = false;
          }
        },
      },
    ],
  });
  // A worktree is offered when a snapshot of the folder is in force at the fork turn (the loop wrote under it or an
  // earlier one): the changes route names it (`tree`), by the chain's turn number — when it was taken, and what the
  // turns since wrote that it does not hold (`forkTreeWords`). Its head alone (`head=1`): what the turn changed is a
  // git read this dialog never shows.
  api(`/memory/sessions/${encodeURIComponent(chainId)}/changes?turn=${n}&head=1`).then((t) => {
    const tree = t?.tree;
    if (tree?.ref) {
      wtRow.classList.remove("hidden");
      const said = forkTreeWords(tree, n);
      note.textContent = said.held;
      miss.textContent = said.missing;
      miss.classList.toggle("hidden", !said.missing);
    } else note.textContent = "no working-tree snapshot at that turn — the conversation forks, the files do not";
  }).catch(() => (note.textContent = ""));
}

/** A chat's display title: its first typed message, else the continued session's title or first earlier message, clipped. */
function chatTitle(chat) {
  // The session's name as the archive has it (its title, else its first message); a chat that has no session yet
  // is named by what was typed into it first. A new task that only loaded a session as material is not that
  // session: until something is typed it has no name of its own (setTitle says what it is).
  const typed = firstMessageName(chat.turns, (x) => !x.past);
  const archived = chat.title || firstMessageName(chat.turns, (x) => x.history);
  const t = archived || typed;
  return t ? (t.length > 48 ? t.slice(0, 47) + "…" : t) : "untitled";
}

async function openFork(fromChat, fork, prefill = "") {
  pushNextAddress = true;
  // With the files checked out beside the repository, the fork's hands work there: the rewind is the point of it
  // (the server sends the fork's turns to that folder; the chip shows it).
  const chat = putChat({
    id: newChatId(),
    kind: "fork",
    chainId: fork.chainId,
    cwd: fork.tree?.worktree || fromChat.cwd,
    model: fromChat.model,
    forkedFrom: { from: fork.forkedFrom, fromTitle: chatTitle(fromChat), atTurn: fork.atTurn, worktree: fork.tree?.worktree || "" },
  });
  const treeNote = fork.tree?.worktree ? ` · the files are checked out at ${fork.tree.worktree}` : fork.tree?.note ? ` · ${fork.tree.note}` : "";
  chat.forkNote = `⑂ forked at turn ${fork.atTurn} of “${chatTitle(fromChat)}” — ${fork.copied?.turns ?? "?"} turns, ${fork.copied?.blocks ?? "?"} blocks carried over${treeNote}. Your next message continues it.`;
  selectChat(chat.id);
  try {
    await hydrate(chat);
  } catch (e) {
    toast(errText(e), "err");
  }
  // The message it goes on with is the fork's draft, kept with the chat: the address the fork opens at shows it again
  // (`selectChat`, which puts the chat's own draft in the box).
  if (prefill) {
    saveDraft(chat, prefill);
    if (chatOf(state.currentId) === chat) composer.setDraft(prefill);
  }
  sidebar.load();
  if (fork.tree?.note && !fork.tree?.worktree) toast(fork.tree.note, "err");
  toast("Fork created: your next message continues from that turn");
}

// ---------------------------------------------------------------------------------------------------
// The status panel
// ---------------------------------------------------------------------------------------------------
/** The status's model, drawn in the capsule and the floating panel: the plan the Plan tab counts (`planOf`: the live
 *  turn's, or after it the newest turn's that ran), the goal from the session's truth, the session's sub-agents from
 *  the store. The views paint it with their badges (`onPainted`), so a turn this page follows, one that ended and one
 *  read after a reload move it as they move the tab. Its coding agent's own tasks while they run, under that agent's
 *  name (HarnessV4_Tasks U1). The capsule's words read what the turn does now (`turnNow`), the compaction running and
 *  when the running turn reached its coding agent.
 *  @param {any} chat */
function paintStatus(chat) {
  // The header's status is the open chat's alone (the owner's 10-26: a fork showed its source's "Working · step 42",
  // there for a few seconds and gone, again and again): a turn this page runs in another chat paints at each of its
  // frames, and the open chat's own paint took it away.
  if (chat !== chatOf(state.currentId)) return;
  const plan = chat ? planOf(chat, null).plan : [];
  const agentTasks = chat?.agentTasks?.length ? { who: agentOf(chat.model)?.agentName || "The agent", tasks: chat.agentTasks } : null;
  const coder = coderNameOf(chat);
  /** @type {import("./conversation/status-panel.js").StatusModel} */
  const model = {
    plan, subagents: subagentStore.rows(), subagentsQueued: subagentStore.queued(), agentTasks, goal: chat?.goal || null, git: chat?.git || null, terminals: state.terminals || [],
    turn: chat ? turnNow(chat) : null,
    compacting: chat?.chainId ? state.compacting.get(String(chat.chainId)) || null : null,
    coder: coder ? { name: coder, sentAt: Number(chat?.live?.turn?.aligned?.sentAt) || null } : null,
    // The commands its agents run in the background (HarnessV4_Background_Plan E38), a sub-agent's under its name.
    commands: chat?.chainId ? state.commands.get(String(chat.chainId)) || [] : [],
    cwd: chat?.cwd || "",
    nameOf: (agent) => subagentName(agent),
    // The come-back its agent set, while it waits (the Designer's of 10-27).
    comeBack: chat?.chainId ? state.comeBacks.get(String(chat.chainId)) || null : null,
    // Filament's check-in on its agent idle while its command runs (the owner's of 11-08).
    idleWake: chat?.chainId ? state.idleWakes.get(String(chat.chainId)) || null : null,
  };
  statusPanel.set(model);
  statusCapsule.set(model);
  // The turn is over and its work goes on (conversation/waiting-on.js, the owner's of 10-29): said after the last turn,
  // where the eye is, so the chat never reads as done while what its agent waits on runs — and whether the person's
  // Stop left it to their next message.
  const newest = [...(chat?.turns || [])].reverse().find((t) => t && !t.rewound && !unsent(t));
  transcript.waitingOn(chat?.chainId ? waitingOn({
    phase: model.turn?.phase || "none",
    compacting: !!model.compacting,
    commands: model.commands || [],
    agents: (model.subagents || []).filter((r) => !r.team && r.status === "running").length,
    comeBack: model.comeBack || null,
    stopped: newest?.status === "stopped" || !!newest?.stopped,
  }) : null, { onStop: (id, command) => void stopCommand(id, command) });
}

/** The status panel for a chat, and the looks that keep it true. @param {any} chat */
function refreshStatus(chat) {
  // A chat being opened lets go of the lists of the chat shown before at once, and reads its own once its transcript
  // has landed (openSession).
  const held = !!chat && opening.has(chat);
  const chain = held ? null : chat?.chainId || null;
  if (chat && chat.id === state.currentId) subagentStore.setChain(chain);
  if (chat && chat.id === state.currentId) besideStore.setChain(chain);
  if (chat && chat.id === state.currentId) flowList.setChain(chain, chat.cwd);
  paintStatus(chat);
  // The looks wait for its transcript too; a popped pane's window shows no status panel, and looks for none.
  if (held || POPPED) return;
  loadTerminals();
  if (chat?.chainId) loadGoal(chat);
  const folder = chat?.cwd || folderIn.value.trim();
  if (folder) loadGit(chat, folder);
}

/** Terminals live on the server, not the chat: fetched on a quiet timer so the panel's Terminals section stays
 *  true while a pane is closed. Nothing is fetched when the last look found none and nobody opened one since. */
let termSeq = 0;
let termAt = 0;
async function loadTerminals() {
  // A popped pane's window shows no status panel: its Terminals pane reads its own. A view-only device reads none.
  if (POPPED || viewOnlyPage()) return;
  // While terminals run the panel must see them end; with none, a look every 10 s is plenty and a busy stream
  // never turns into a poll.
  if (Date.now() - termAt < ((state.terminals || []).length ? 5000 : 10000)) return;
  termAt = Date.now();
  const seq = ++termSeq;
  try {
    const r = await api("/terminal");
    if (seq !== termSeq) return;
    state.terminals = (r.terminals || []).filter((/** @type {any} */ t) => !t.exited);
    paintStatus(chatOf(state.currentId));
  } catch {}
}

/** The goal is the session's, not the turn's — looked up once a moment, and afresh at each turn's end (where a /goal
 *  reply lands). Never per event: every run event repaints the panel, and a look per event was a session read and a
 *  request on the page's six connections for each one — hundreds in a long turn. @param {any} chat */
async function loadGoal(chat) {
  if (chat.goalAt && Date.now() - chat.goalAt < 5000) return;
  chat.goalAt = Date.now();
  try {
    // The goal's own read: the session's whole row was read for it, once every five seconds while the chat was open.
    const truth = await apiShared(`/sessions/${encodeURIComponent(chat.chainId)}/goal`);
    // Whether it is pinned, from the same read: the chat menu's Pin or Unpin.
    chat.pinned = !!truth?.pinned;
    const goal = truth?.goal || null;
    if (!goal) return;
    chat.goal = {
      status: goal.status,
      text: goal.text,
      // Its drive (core/goal-drive.js): its round, or why it halted — never what it spent.
      drive: goal.drive ? { words: String(goal.drive.words || ""), halted: !!goal.drive.halted } : null,
    };
    if (chat.id !== state.currentId) return; // switched away while the truth was in flight
    paintStatus(chat);
  } catch {}
}

/**
 * Hold the chat's driving goal at once (core/goal-drive.js): the round under way ends, and no other starts by itself
 * until `/goal go`. Said in a toast; the panel reads the goal again.
 * @param {any} chat
 */
async function holdGoalNow(chat) {
  if (!chat?.chainId) return;
  try {
    const r = await api(`/sessions/${encodeURIComponent(chat.chainId)}/goal/hold`, { method: "POST", body: {} });
    toast(r?.drive ? `Goal held at round ${r.drive.round}: no round starts by itself until /goal go` : "The goal starts no round by itself now");
  } catch (/** @type {any} */ e) {
    toast(e?.status === 409 ? "The goal starts no round by itself now" : errText(e), e?.status === 409 ? undefined : "err");
  }
  chat.goalAt = 0;
  void loadGoal(chat);
}
// A driving goal halted — the agent's mark, a Stop, a hold, its cap (core/goal-drive.js): the panel reads it again now,
// past the read's five seconds.
onBus((msg) => {
  if (msg?.type !== "goal" || !msg.chainId) return;
  for (const chat of state.chats.values()) {
    if (chat.chainId !== msg.chainId) continue;
    chat.goalAt = 0;
    if (chat.id === state.currentId) void loadGoal(chat);
  }
});

/**
 * Where the chat works, for the panel's Git section: its folder's place and every place its agents wrote in, as the
 * header reads them (`/git/place`, HarnessV4_Git_Plan GW-D55). Fetched once a moment, never per event. `since`: when
 * the feed said the place moved — a read on its way that began before is not the answer; the newest read alone draws.
 * @param {any} chat @param {string} folder @param {{ since?: number }} [o]
 */
async function loadGit(chat, folder, { since = 0 } = {}) {
  // The panel is the shown chat's: a chat not shown is read once it is shown, never read and its answer dropped.
  if (chat.id !== state.currentId) return;
  if (chat.gitAt && Date.now() - chat.gitAt < 8000) return;
  chat.gitAt = Date.now();
  const mine = (chat.gitSeq = (chat.gitSeq || 0) + 1);
  try {
    const chain = chat.chainId ? `&chain=${encodeURIComponent(chat.chainId)}` : "";
    // The header's read of the same place, where one is on its way (`apiShared`).
    const p = await apiShared(`/git/place?cwd=${encodeURIComponent(folder)}${chain}`, { since });
    if (chat.id !== state.currentId || mine !== chat.gitSeq) return;
    chat.git = p || null;
    refreshStatus(chat);
  } catch { if (mine === chat.gitSeq) chat.git = null; }
}
// A git mark read again behind the answer the page was given moved (`git-moved`, the slowness of 11-02): the header's
// chip, the panel's Git section and a new chat's Works in ask again where they show that place, answered at once.
onBus((msg) => {
  if (msg?.type !== "git-moved") return;
  headerModule.gitMoved(msg);
  transcript.placesMoved(msg);
  const chat = chatOf(state.currentId);
  const folder = chat?.cwd || folderIn.value.trim();
  if (!chat || !folder || !gitMovedFor(msg, "place", [folder, ...(/** @type {any} */ (chat.git)?.also || []).flatMap((/** @type {any} */ x) => [x.cwd, x.place])])) return;
  chat.gitAt = 0;
  void loadGit(chat, folder, { since: Date.now() });
});

// ---------------------------------------------------------------------------------------------------
// The hash router: `#/` a new task, `#/task/<chainId>` a session, `#/task/<chainId>/plan` its Plan view. The address
// is the restore: a reload reopens the hashed task on its view. Settings and the control room render the conversation
// until their screens exist.
// ---------------------------------------------------------------------------------------------------
/** The address a chat owns: its chain and view once archived, else home. A user-driven open pushes a history
 * entry (the back button returns to the previous task); internal churn — a switch of view among it — replaces.
 * @param {any} chat */
let pushNextAddress = false;
function syncAddress(chat) {
  const hash = chat?.chainId ? routeFor("task", { id: chat.chainId, view: chat.viewTab }) : routeFor("home");
  // A popped pane that follows the main window goes with it (BS4).
  sayChat(false, chat);
  if (pushNextAddress && location.hash !== hash) {
    history.pushState(null, "", hash);
    pushNextAddress = false;
    return;
  }
  pushNextAddress = false;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

/** The chat already open on a chain, if any. @param {string} chainId */
function chatByChain(chainId) {
  return [...state.chats.values()].find((c) => c.chainId === chainId) || null;
}

/**
 * A chat deleted here: the page's chat on its session goes with it — the one on screen makes way for a new chat, as one
 * the archive has no session for does — so nothing more is sent into a session that is gone, and the left bar draws no
 * row for it from the page's copy. What waited to be sent into it goes too: its waiting send and the tab's copy of it,
 * and the files its box kept.
 * @param {string} chainId
 */
function leaveDeleted(chainId) {
  const chat = chatByChain(chainId);
  if (!chat) return;
  chat.waiting?.cancel();
  chat.waiting = null;
  wstore.clear(String(chainId));
  kept.keep(String(chainId), []);
  saveDraftFiles(chat, []);
  state.chats.delete(chat.id);
  if (state.currentId === chat.id) newChat();
}

/** Where an overlay returns to: the task underneath it, or home when that chat has no chain yet. */
function backTo() {
  const chat = chatOf(state.currentId);
  return chat?.chainId ? routeFor("task", { id: chat.chainId, view: chat.viewTab }) : routeFor("home");
}

/** A task opened from the sidebar while a full-frame screen is on: the screen lies over the conversation, so the
 *  task would open unseen. The address goes to the task, and the screen with it. */
function leaveScreen() {
  if (onScreen(location.hash)) location.hash = backTo();
}

/** Whether the open artifact's full view was opened from the Artifacts page, which its Back goes to. */
let artifactFromList = false;

/**
 * A chat the Artifacts page names — the one that made an artifact, or that a change is asked in — opened over the
 * screen, which leaves for it. @param {string} chain
 */
function openChain(chain) {
  const row = (state.sessions || []).find((/** @type {any} */ s) => s.id === chain) || { id: chain, title: "", cwd: "" };
  openSession(row, { push: true });
  leaveScreen();
}
/** What Library › Agents and teams opens on, once: the Team view's New team asks for a new team's editor (HarnessV3-Views V5-5). */
let agentsStart = /** @type {string | null} */ (null);
/** The Agents page's start, taken: the next visit opens on the list. */
const takeAgentsStart = () => {
  const s = agentsStart;
  agentsStart = null;
  return s;
};

/** Whether the start has read the page's lists and applied its first address (`boot`). */
let booted = false;

/** @param {ReturnType<typeof parseRoute>} route */
function applyRoute(route) {
  // A popped pane's window shows its pane for a chat, never a full-frame screen (a shortcut to Settings there).
  if (POPPED && (isScreen(route.kind) || route.kind === "context")) {
    location.replace(backTo());
    return;
  }
  // The chat alone shows no screen either: this machine's whole page opens at it where the desk can open one, else it
  // says where one is, and the chat stays as it was. The Context page is the chat's own Overview there, as ever.
  if (CHAT_ONLY && isScreen(route.kind)) {
    if (fullPage) fullPage(routeFor(route));
    else toast("This page shows one chat alone: open Filament's full page for that");
    location.replace(backTo());
    return;
  }
  // The room tears itself down when its element goes, but only if it was removed from the parent it was mounted in.
  // Settings renders into the same frame, so the room must go first or it stays mounted over the settings page.
  const frame = shell.mainFrame;
  if (route.kind !== "control-room") frame.querySelector(":scope > .control-room")?.remove();
  if (route.kind !== "settings") frame.querySelector(":scope > .settings")?.remove();
  if (route.kind !== "library") frame.querySelector(":scope > .library")?.remove();
  // A Space left keeps your look now, not at its next tick: one opened again at once reads it (the Hunter on S1).
  if (route.kind !== "space") {
    leaveSpace();
    frame.querySelector(":scope > .space:not(.your-space)")?.remove();
  }
  if (route.kind !== "your-space") frame.querySelector(":scope > .your-space")?.remove();
  if (route.kind !== "artifact") frame.querySelector(":scope > .artifact-view")?.remove();
  if (route.kind !== "artifacts") frame.querySelector(":scope > .artifacts-page")?.remove();
  // Only an open made from the Artifacts page's own list goes back to it; any other route ends that.
  if (route.kind !== "artifact") artifactFromList = false;
  // A full-frame screen owns the frame, the header and the panes with it: they wait under it as they are — a pane's
  // page keeps what it holds, and the window's room fits them meanwhile — until the chat returns.
  shell.setScreen(isScreen(route.kind));
  sidebar.atLibrary(route.kind === "library" ? route.page : route.kind === "artifacts" || route.kind === "artifact" ? "artifacts" : null);
  sidebar.atSpace(route.kind === "space" ? route.id : null, route.kind === "space" ? route.tab : null);
  sidebar.atYourSpace(route.kind === "your-space");
  // A Settings page the Library took over keeps its address: it opens there, as the page it became.
  const moved = route.kind === "settings" ? libraryOf(route.section) : null;
  if (moved) {
    if (moved.start && !agentsStart) agentsStart = moved.start;
    location.replace(routeFor("library", { page: moved.page }));
    return;
  }
  if (route.kind === "library") {
    renderLibrary(frame, route, {
      onClose: () => { location.hash = backTo(); },
      onToast: toast,
      getChain: () => chatOf(state.currentId)?.chainId || "",
      // A team, an agent or a list of seats changed: the open session's Team view and widget show it now.
      onChanged: () => { const c = chatOf(state.currentId); if (c) refreshSessionDoc(c); },
      start: route.page === "agents" ? takeAgentsStart() : null,
      // A made skill's Craft it in a chat… (the owner's word of 10-27): its crafter chat, opened.
      onCraft: (skill) => void openCrafter({ skill }),
    });
    return;
  }
  if (route.kind === "space") {
    renderSpace(frame, route, spaceCallbacks());
    return;
  }
  if (route.kind === "your-space") {
    renderYourSpace(frame, {
      now: () => sidebar.nowGroups(),
      openRow: (r) => sidebar.openNow(r),
      openSpace: (id, tab) => { location.hash = routeFor("space", { id, tab }); },
      // A routine's run (S6): its chat.
      openChat: (id) => openChain(id),
      startWith: (cwd, words) => startWithWords(cwd, words),
      handOff: (from, cwd, words) => void handFromSpace(from, cwd, words),
      // Reproduce… on a row of every project's Needs you (S7-D1).
      reproduce: (cwd, report) => reproduceIn(cwd, report),
      askChat: (chain, words) => askInChat(chain, words),
      catalogue: spaceModels,
      modelName: modelNameOf,
      onClose: () => { location.hash = backTo(); },
    });
    return;
  }
  if (route.kind === "settings") {
    renderSettings(frame, route.section, {
      onClose: () => { location.hash = backTo(); },
      onToast: toast,
      getChain: () => chatOf(state.currentId)?.chainId || "",
      // A team made, changed or deleted, or the members' model: the open session's Team view and widget show it now.
      onChanged: () => { const c = chatOf(state.currentId); if (c) refreshSessionDoc(c); },
      // An import brought chats in: they are sessions now, and the sidebar lists them.
      onSessions: () => { sidebar.load(); },
      // General's Welcome tour: the tour over the page.
      onWelcome: () => openTour(),
      accounts: accountKeeper,
      agents: agentsKeeper,
      signIn: (upstream) => signInTo(upstream),
      install: installAgent,
      useResetCredit: (upstream) => useResetCredit(upstream),
    });
    return;
  }
  if (route.kind === "context") {
    // The Session inspector's old address (R1): the open chat's Overview, at the sheet that holds what the tab held.
    const c = chatOf(state.currentId);
    location.replace(c?.chainId ? routeFor("task", { id: c.chainId, view: "overview" }) : backTo());
    if (c?.chainId) openOverviewAt(route.tab);
    return;
  }
  if (route.kind === "control-room") {
    const room = renderControlRoom(frame, route.id, { onClose: () => { location.hash = backTo(); } });
    room.el.dataset.run = route.id;
    return;
  }
  if (route.kind === "artifacts") {
    renderArtifactsPage(frame, {
      onClose: () => { location.hash = backTo(); },
      onOpen: (name) => { artifactFromList = true; location.hash = routeFor("artifact", { id: name }); },
      // A tile's words in a new task's message box (AFC-45): the person finishes the sentence and sends.
      onNew: (words) => { pushNextAddress = true; newChat(); leaveScreen(); composer.fill(words); },
      onSession: openChain,
    });
    return;
  }
  if (route.kind === "artifact") {
    renderArtifactView(frame, route.id, {
      fromList: artifactFromList,
      onClose: () => { location.hash = artifactFromList ? routeFor("artifacts") : backTo(); },
      // Its failure's words go into the open chat's message box (AFC-25); only the person sends.
      onTell: (text) => { location.hash = backTo(); composer.add(text); },
      // A change asked for goes into the message box of the chat that made it, or a new task's (AF-D16, AFC-84).
      onAsk: (chain, words) => {
        if (chain) openChain(chain);
        else { pushNextAddress = true; newChat(); leaveScreen(); }
        composer.add(words);
      },
      onSession: openChain,
    });
    return;
  }
  if (route.kind === "task") {
    const open = chatByChain(route.id);
    if (open && open.id === state.currentId) {
      // A pane on top has the chat's address (UX10): coming back to it — from Settings, say — keeps the pane.
      if (!(route.view === "chat" && topOf(viewOf(open)))) views.show(route.view);
      return;
    }
    if (open) {
      open.viewTab = route.view;
      selectChat(open.id);
      return;
    }
    const row = (state.sessions || []).find((s) => s.id === route.id) || { id: route.id, title: "", cwd: "" };
    openSession(row, { view: route.view });
    return;
  }
  // A new chat in a folder named by its address — this page opened from another machine's new-chat menu (pk-list) —:
  // its Start in that folder, the address taken over by home's, so Back does not open it again. Only a project this
  // Filament knows, never a share: a link in a chat's words can name any folder, and the page asks none unbidden (the
  // review of pk-list). Any other folder opens a plain new chat, and says why.
  if (route.kind === "home" && route.folder) {
    const known = newChatFolder(route.folder, state.projects);
    if (known) newChat({ cwd: known });
    else {
      newChat();
      toast(`No project at ${route.folder} on this machine: a new chat opens at an address only in one of its projects`, "err");
    }
    leaveScreen();
    return;
  }
  // home, settings, control-room: the conversation view (the settings and control-room screens arrive later).
  const current = chatOf(state.currentId);
  if (!current || current.turns.some((t) => !t.past) || current.live) {
    if (!current) newChat();
    return;
  }
  if (current.chainId) newChat(); // a finished task's chat does not squat the home route
}

// A new route is a new page: what floated over the old one (a widget's popover, a menu, a sheet) goes with it — a
// shortcut to Settings left the memory popover open over it (M6-7).
window.addEventListener("hashchange", () => {
  closeOverlays();
  const route = parseRoute(location.hash);
  // A new chat in a folder, asked while the page starts (the desktop app sends its page there as it opens it), waits
  // for the projects that say whether the folder is one: the start applies the address it then finds.
  if (!booted && route.kind === "home" && route.folder) return;
  applyRoute(route);
});
// A tagged chat's link, wherever it shows — the box, a bubble, a reply — opens the chat, or says it is no longer kept.
chatLinks(document);

/**
 * The device /api/state says this page is (the owner's remote Filament of 11-06), wherever /state is read: read from
 * another machine, no dialog, file manager or editor is asked of the machine Filament runs on as if it were yours
 * (lib/api.js `remotePage`); a view-only device's page offers nothing that writes (p4-view-ui), painted as it is first
 * heard and wherever it changes. @param {any} st
 */
function heardDevice(st) {
  setRemotePage(st.viewer === "remote");
  const was = viewOnlyPage();
  device = st.device || null;
  if (!deviceHeard || viewOnlyPage() !== was) paintViewOnly();
  deviceHeard = true;
}
/** /api/state has said what this page is. */
let deviceHeard = false;

/**
 * The page as /api/state said it (p4-view-ui): on a view-only device's, the box reads only and sends nothing, the left
 * bar offers no New chat, a new chat's page says it starts none in place of the chooser and the Start, the Terminal
 * pane that it opens none, and the Browser pane that it shows none of the chat's browser; a reply's Fork and Retry and
 * a message's Rewind are hidden by the page's `view-only` class (harness.css), each turn drawn once; the welcome tour
 * opens on none. A full device's and this computer's are as they were.
 */
function paintViewOnly() {
  const on = viewOnlyPage();
  document.documentElement.classList.toggle("view-only", on);
  // The page's client asks no write of the server: what a door left standing would ask is refused in the page's words.
  setViewOnlyApi(on);
  composer.setViewOnly(on);
  // What waits for an answer over the box is answered from a page that may: none stands on this one.
  decisions.el.style.display = on ? "none" : "";
  flowDock.el.style.display = on ? "none" : "";
  setTerminalsViewOnly(on);
  setBrowserViewOnly(on);
  for (const b of Array.from(document.querySelectorAll(".sess-new, .rail-new"))) b.classList.toggle("hidden", on);
  // The left bar's Add project and the Spaces' +, and its Open folder… and New Space… while it has no chat to list.
  sidebar.draw();
  transcript.refreshFolder();
}

// ---------------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------------
/**
 * A page Filament loaded again because its process went says so, once (lib/crash-notice.js): its words come off the
 * address at once, so a reload of its own says nothing, and are said as the person is next at the window — its first
 * key or pointer — for `CRASH_NOTICE_MS`, so a window that went down unattended still says it when they come back. The
 * chat the load left out is offered back.
 */
function sayCrash() {
  const crashed = crashNoticeOf(location.search);
  if (!crashed) return;
  history.replaceState(history.state, "", addressWithoutCrash(location.href));
  const heard = new AbortController();
  const say = () => {
    heard.abort();
    const away = crashed.away;
    noticeToast(crashed.words, "err", { ms: CRASH_NOTICE_MS, ...(away ? { action: { label: "Open that chat", onClick: () => void (location.hash = routeFor("task", { id: away })) } } : {}) });
  };
  for (const type of ["pointerdown", "pointermove", "keydown"]) addEventListener(type, say, { capture: true, signal: heard.signal });
}

async function boot() {
  sayCrash();
  stillWhileHidden();
  watchTheme();
  // A link to an artifact of this machine's, wherever it is pressed, opens under this page's pass where it needs one.
  passArtifactLinks(document);
  void artifactsPlaced();
  // The header's folder field with its memory.
  const folders = recentFolders();
  shell.foldersDatalist.replaceChildren(...folders.map((f) => h("option", { value: f })));
  folderIn.setAttribute("list", "harness-folders");
  folderIn.value = folders[0] || "";
  const leafOf = (p) => (p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p || "No folder";
  const drawLeaf = () => {
    folderLeaf.textContent = leafOf(folderIn.value.trim());
    folderIn.title = folderIn.value.trim();
  };
  folderIn.addEventListener("input", drawLeaf);
  folderIn.addEventListener("change", () => { drawLeaf(); transcript.refreshFolder(); const c = chatOf(state.currentId); if (c) { c.gitAt = 0; refreshStatus(c); } });
  drawLeaf();
  // A remembered folder that left the disk (its project was deleted under it, or the folder itself went) must not
  // open the day pointing at a ghost: clear the chip — the first send asks for the project properly instead.
  const firstChip = folderIn.value.trim();
  if (firstChip)
    api("/files/exists", { method: "POST", body: { paths: [firstChip] } })
      .then((r) => {
        if (r?.ok?.[0] === false) {
          forgetFolder(firstChip);
          if (folderIn.value.trim() === firstChip) {
            folderIn.value = "";
            folderIn.dispatchEvent(new Event("input"));
            drawLeaf();
            transcript.refreshFolder();
          }
        }
      })
      .catch(() => {});
  const model = startModel(state.models);
  if (model) composer.setModel(model);
  // The sessions list paints first and never waits for the rest: a cold model discovery across every upstream took
  // four seconds on the owner's machine (HarnessV2 F16) and the sidebar used to sit behind it. The models land in
  // the composer whenever they arrive; the state and the spend pill likewise.
  const sessionsReady = sidebar.load();
  /** @param {any} st */
  const tookState = (st) => {
    state.config = st.config || {};
    state.platform = String(st.platform || "");
    heardDevice(st);
    teamsSwitched();
  };
  /**
   * /api/state read again after a read that failed, a second and then twice as long each time to half a minute, until
   * it lands: until then the page does not know whether it is a view-only device's (the review of p4-view-ui). One the
   * server refuses is asked no more. @param {number} ms
   */
  const stateAgain = (ms) =>
    void setTimeout(() => void api("/state").then(tookState, (/** @type {any} */ e) => {
      const status = Number(e?.status) || 0;
      if (!(status >= 400 && status < 500)) stateAgain(Math.min(ms * 2, 30_000));
    }), ms);
  const stateReady = api("/state")
    .then(tookState)
    .catch(() => stateAgain(1000));
  // The picker's tab labels are the upstream's name as the dashboard spells it (SpaceX), not its id. The rows
  // are objects kept by reference, so this can run before or after the list lands — the menu reads them live.
  const nameModels = () => {
    const names = new Map((state.config?.upstreams || []).map((/** @type {any} */ u) => [u.id, u.name || u.id]));
    for (const m of state.models) if (m?.upstream && names.has(m.upstream)) m.upstreamName = names.get(m.upstream);
  };
  // Another machine's models this Filament keeps (the remote-agents plan's m-ui): the picker's tab for each, before its
  // listing has a model too, from the configuration — which, like the names, can land before or after the list — and
  // what the list said of each listing.
  /** @type {Record<string, any>} */
  let listings = {};
  const nameMachines = () => composer.setMachines(machinesOf(state.config?.upstreams, listings));
  // The catalogue and the families the picker offers (what each model can do, as the Upstreams page tuned it). The
  // selected model and its tuning are the session's, so a re-read changes what is offered, never what is chosen.
  const catalogue = createCatalogueKeeper({
    read: () => api("/models?all=1"),
    // The picker's tab labels follow the upstreams' names, which the same save may have changed.
    before: () => api("/state").then((st) => { state.config = st.config || {}; heardDevice(st); teamsSwitched(); }),
    paint: (models) => {
      state.models = models.models || models.data || [];
      nameModels();
      listings = models.upstreams || {};
      nameMachines();
      composer.setModels(state.models);
      composer.setFamilies(models.families || []);
      state.families = models.families || [];
      // A fresh install's model, once the accounts are read too. Only a read that is painted picks.
      pickFirstModel();
      // An unborn chat's Start board weighs the model the catalogue gave it, or says none can answer yet (LD-D4).
      if (!chatOf(state.currentId)?.chainId) transcript.startChanged();
    },
  });
  // A save or reload anywhere (the dashboard tunes a model's reasoning, fast mode or windows) re-reads it; so does
  // coming back to a tab whose copy is older than 30 s, and — for a tab left open whose stream reconnected and missed
  // a save — any copy older than five minutes. A read that failed counts as stale.
  // A save, or the discovery a save started (Providers P0), changes what the picker offers.
  onBus((msg) => { if (msg?.type === "config-changed" || msg?.type === "models-discovered") catalogue.refresh(); });
  // …and the open chat's window with it (the owner's of 11-10): the session's settings document says the window its
  // Context popover and meter draw, which a model's Tune or a list asked again moves without moving the document's hash.
  onBus((msg) => {
    if (msg?.type !== "config-changed" && msg?.type !== "models-discovered") return;
    const chat = chatOf(state.currentId);
    if (chat?.chainId) void refreshSessionDoc(chat);
  });
  // Your defaults live in the configuration: a save may have changed "New chats start in".
  onBus((msg) => { if (msg?.type === "config-changed") void loadNewChatMode(); });
  void loadNewChatMode();
  // …and where it reads this machine's artifacts: Any program, or the owner key, says whether their addresses carry a pass;
  // a feed that came back may be a Filament started again, its run's pass new (the hunt on x41). Its first hello is
  // the page's start, which read them already.
  let artifactsHello = false;
  onBus((msg) => {
    if (msg?.type === "config-changed") void artifactsPlacedAgain();
    else if (msg?.type === "hello") {
      if (artifactsHello) void artifactsPlacedAgain();
      artifactsHello = true;
    }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") catalogue.refreshIfOlder(30_000); });
  window.setInterval(() => { if (document.visibilityState === "visible") catalogue.refreshIfOlder(5 * 60_000); }, 60_000);
  /** How many models answer as the page started (`answers`, the server's own rule: readiness.js), for the welcome tour: null where the read failed. */
  const modelsRead = catalogue.load().then((c) => (c?.models || c?.data || []).filter((/** @type {any} */ m) => m.answers).length, () => null);
  stateReady.then(() => {
    nameModels();
    nameMachines();
  });
  await Promise.all([sessionsReady, stateReady]);
  // A first open with no folder remembered (a new browser, or its folder gone): the project used last, else the newest
  // chat's folder — the chip said "project" while one existed (the Designer's review of 10-24). Nothing starts until
  // you send.
  if (!folderIn.value.trim()) {
    const lastProject = [...(state.projects || [])].filter((p) => p?.cwd).sort((a, b) => (Number(b.lastSeen) || 0) - (Number(a.lastSeen) || 0))[0]?.cwd;
    const lastChat = [...(state.sessions || [])].filter((s) => s?.cwd).sort((a, b) => String(b.when || "").localeCompare(String(a.when || "")))[0]?.cwd;
    const first = String(lastProject || lastChat || "");
    if (first) {
      folderIn.value = first;
      folderIn.dispatchEvent(new Event("change"));
    }
  }
  loadTerminals(); // the status panel's Terminals section is true from boot, not only after a turn
  // General's Auto-archive old chats sweeps from here, at the start and once an hour, Settings open or not (the owner's
  // settings cleanup of 11-09) — not in a pane's own window, nor on a view-only device's page, which may archive nothing,
  // nor on the chat alone another machine's desk shows (this machine's own pages sweep).
  if (!POPPED && !CHAT_ONLY && !viewOnlyPage()) startHourlySweep({ onToast: toast });
  // A chat exists before any route runs, so a settings overlay always has a conversation underneath it. The route is
  // read first: newChat rewrites the address, and a bookmarked task would be lost if it were read after.
  const initial = parseRoute(location.hash);
  // The Start's kept words come back in the folder they were typed for, not the folder used last (state.js startKept).
  const kept = startKept();
  if (!chatOf(state.currentId)) newChat(kept?.cwd ? { cwd: kept.cwd } : {});
  /** Whether the tour opened by itself, asked: the tips wait for it. @type {Promise<unknown>} */
  let tourAsked = Promise.resolve();
  booted = true;
  applyRoute(initial);
  // The welcome tour opens by itself while nothing can answer — no coding agent connected, no model listed (the owner's
  // of 11-08) — and once on a data folder with no chat yet, archived ones counted, where the chats were read (the
  // owner's FTUE of 11-05): `tourOpensItself`. A pane's own window and a view-only device's page never open it — nor a
  // page whose state never read, which can't tell it is one; nor the chat alone another machine's desk shows.
  if (!POPPED && !CHAT_ONLY && !viewOnlyPage() && state.config) {
    const toured = state.config?.ui?.welcome?.seen !== false;
    const listed = !toured && state.sessionsLoadedAt && !(state.sessions || []).length;
    tourAsked = Promise.all([
      listed ? api("/memory/sessions?limit=1&kind=interactive,fork&archived=all").then((r) => (r?.sessions || []).length, () => null) : null,
      modelsRead,
      api("/coding-agents").then((l) => (l?.entries || []).filter((/** @type {any} */ e) => e.state === "connected").length, () => null),
    ]).then(([chats, models, connected]) => { if (tourOpensItself({ toured, chats, models, connected })) openTour(); });
  }
  // The first-run tips: on a full page that may write, never a pane's own window — read once the tour has opened or
  // not, so no tip flashes by before it. A tip waits while the tour, or any sheet, covers its control: the Start
  // board's show as the tour hands over to it.
  if (!POPPED && !CHAT_ONLY && !viewOnlyPage()) void tourAsked.catch(() => {}).then(() => coach.start()).then(coachRead);
  // The resync also corrects the open chat's view where the feed dropped a holder change (`resyncHolder`).
  const resyncHolders = () =>
    sidebar.loadHolders().then((r) => {
      syncCompacting(r);
      resyncHolder(chatOf(state.currentId));
    });
  // Read once at the start too: what runs now — a turn elsewhere, a background command (E38) — shows at once, not at
  // the first tick five seconds on (the live look found Now saying "Nothing running" while two commands ran).
  resyncHolders();
  // A live dot refresh, quietly — the pills too, for what time alone changes (the cache going cold). An open popover
  // keeps its own clock and is not repainted under the pointer. The bar's rows say their ages again in place: what
  // else they show is drawn as it moves (a run's mark, a turn's holder), and drawing the bar anew whole every five
  // seconds measured each of its rows twice.
  // Out of sight, the reads wait, and run once as the page shows again (lib/page-shown.js): the runs list waits by
  // itself (sidebar.js `loadRuns`), the holders here.
  window.setInterval(() => {
    sidebar.paintAges();
    sidebar.loadRuns();
    whenPageShown("the holders resync", resyncHolders);
    if (!document.querySelector(".widget-pill.is-open")) widgets.paintLive();
  }, 5000);
  // The speed gauge reads the stream while it pauses too (AH-S1): a reply that stops writing turns from its rate to
  // its average without waiting for its next words.
  window.setInterval(() => {
    const c = chatOf(state.currentId);
    if (c?.live?.speed) paintSpeed(c);
  }, 500);
}

boot();
