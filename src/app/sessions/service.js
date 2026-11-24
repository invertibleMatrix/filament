// @ts-check
// Native sessions (HarnessV2 §3, D1): the archive chain IS the session, the server composes every request from it,
// and the harness is a view. This service is what the admin rows call: create a session, run a turn (compose, hand
// the body to the pipeline, stamp the turn), read the transcript, read and change the settings document, compact,
// fork. One live turn per session; a second sender gets 409 and the steer mailbox.
import { randomBytes } from "node:crypto";
import { outputCeiling, findRoute, findUpstream, renderUpstreamModel, priceCardFor, upstreamSupports, oneMToAdd } from "../../core/routing.js";
import { agentKey, agentTitle } from "../../core/catalogues.js";
import { leadingTeams, teamsOn } from "../../core/teams-on.js";
import { isAgentUpstream } from "../../core/schema.js";
import { nameIn, CARRY_WORDS } from "../../core/context-words.js";
import { engineFor, engineProblemFor, codingAgentOf, agentModeOf, agentSessionOf, harnessRunsLoop, upstreamsOffProblem } from "../engine.js";
import { COMPACTION_HEADER, EARLIER_TRY_HEADER, LINE_HEADER, SEEN_HEADER, STANDS_ON_HEADER, standsOn, standsOnHeader } from "../../adapters/agents/compactions.js";
import { agentHeld, agentLine, agentWay, endedAtOf, hadSession, heldWords, namedWindow, ownShareOf, seedRoom, seenBy, startsFromOurs } from "./agent-line.js";
import { REWIND_WAYS, planFiles, putBack, putForward, rewindNote, roundsFrom } from "./rewind.js";
import { resolveRange } from "../hunt-range.js";
import { isRangeBlock } from "../../core/hunt-range.js";
import { placeOf } from "../../adapters/git/snapshot.js";
import { AGENT_CACHE_MS, cacheClock, resumeWords, writtenTtlMs, routeCacheTtl, ttlMsOf } from "./cache-clock.js";
import { handedNote, handedOf, switchWords } from "./switch-question.js";
import { MOVE_WINDOW, createChatMove, movedBoundary, movedSince } from "./move.js";
import { AGENT_WORK } from "../../adapters/agents/acp/bridge.js";
import { modeAsks } from "../../adapters/agents/acp/configure.js";
import { changeConfig } from "../config-change.js";
import { mergeRules, parseModelSuffix } from "../../core/shaping.js";
import { sessionWindowFor } from "../../core/model-families.js";
import { modelCapsFor, placeOfName, turnModelName } from "../../core/model-caps.js";
import { exactRowKey } from "../../core/pricing.js";
import { capturedOut, clientLabel, personTextAt, projectOf } from "../../services/memory/brain.js";
import { calibFactor } from "../../services/token-calib.js";
import { pinHashOf } from "../../core/fold.js";
import { textOfMessage, askLine, useLine, withoutAskLine, ownTurnText } from "../../core/messages.js";
import { lazy } from "../../core/lazy.js";
import { PAUSE_KINDS, parseAgentModel, realFolder, loopConfig, disabledTools, folderVerdict, outsideRootsWords, shareKeptOut } from "../agent/turn.js";
import { rulesFrom, permissionOf, mirrorLearnedRule } from "../agent/rules.js";
import { ALWAYS_MAX, ALWAYS_RUN, folderIs, keepsOf, keptOf, withKept, withoutKept } from "../agent/chat-always.js";
import { plain } from "../agent/grants.js";
import { SHELL } from "../../adapters/tools/shell.js";
import { shapeText } from "../../services/memory/permissions.js";
import { loopToolArgs, askOf, shownCommand, shownChange, madeChange } from "../agent/tools.js";
import { browserOffered } from "../agent/browser-tool.js";
import { agentPrint, loopPrint, printChanges } from "../agent/prefix.js";
import { markUndoable } from "../agent/subagents.js";
import { adaptTurn, wireFormatOf } from "../../core/turn-adapter.js";
import { toolsOfTurn, resultsOf, saidOf, workSteps, isModelMessage, kindOfName, WORK_PAGE } from "../../core/tool-vocab.js";
import { flattenMessages, isUserTurn } from "../../core/wire/flatten.js";
import { memoryToolDefs } from "../memory-tools.js";
import { Archive, apartTurn, isRetired } from "../../services/memory/archive.js";
import { projectIdOf, projectNameOf } from "../../core/project-id.js";
import { projectFolderOf, repositoryFolderOf } from "../../services/project-folder.js";
import { compose } from "./compose.js";
import { LINE_MAX, LINE_MIN, afterOwnCompaction, compactionBases, compactionHead, copyTurns, copyWindow, earlierOf, linePercentOf, madeDuring, messagesTranscript, ofCopyAlone, ownWriter, sessionsWentOn, summaryTranscript, usableWindow } from "./compaction.js";
import { copyBehind } from "./agent-copy.js";
import { ASSUMED_WINDOW, createCompactor, summaryEstimate, learningWords, learningDetail, compactionSettingsOf, smallWords, sameModel } from "./compactor.js";
import { afterSummaryCandidates, backAfterSummary, handoverFor } from "./reattach.js";
import { createBlockWeights, estimateTokens, keepNamed, tailWithinTokens } from "../../core/tokens.js";
import { cacheSaid } from "../../core/cache-facts.js";
import { teamsSpendOf, usageOf } from "../../services/spend.js";
import { compactedShapeOf, cutOffBefore, modelTurnsOf, rawMessages, refusedTurn, statusResults } from "./shapes.js";
import { mediaWeights, readPdfs } from "../pipeline/dispatch/pdfs.js";
import { LEAD_WORDS_CHARS, compactionWords, leadNow, newestCompaction, runningWork } from "../../core/run-work.js";
import { SHIPPED_CREW, teamRow } from "../../core/roster.js";
import { eventsOf } from "./cut-turns.js";
import { NOTHING_TO_RESUME, RESUME_LINE, isResumeMessage } from "./resume-cut.js";
import { changesView } from "./changes-view.js";
import { recall as recallFromArchive, recallTurn } from "./recall.js";
import { instructionsBlock } from "../agent/instructions.js";
import { SKILL_TOOL, SKILL_TOOL_NAME, loadSkills, skillsSections } from "../agent/skills.js";

/** The names of the skills on in a document (`skills.on`, merged). @param {any} eff @returns {string[]} */
const onNames = (eff) => (Array.isArray(eff?.skills?.on) ? eff.skills.on : []).map((/** @type {any} */ s) => String(s?.name));
import { draftEngine, startAnatomy } from "./draft-start.js";
import { storedEnvironment } from "../agent/environment.js";
import { KNOBS, readsAlong, BUILT_PHASE, RESULTS_BY_FORM, CARRY_FORMS, COMPACTION_METHODS, COMPACTION_WRITERS, RULE_VERDICTS, resolveChainSettings, resolveSettings, spaceLayerOf, globalLayer, harnessGlobalLayer, ownDefaults, applyPatch, flatten, scopeOf, sessionEngineOf, teamMembersOf, agentTeamsOf } from "../../services/session-settings.js";
import { chatCommandOf } from "../commands/recognize.js";
import { setAsksLess } from "../commands/settings.js";
import { memAsksLess } from "../commands/mem.js";
import { parseStatusCommand } from "../commands/status.js";
import { parseAgentCommand, slashWordOf } from "../commands/acp.js";
import { renewOnWrite } from "../../services/session-turns.js";
import { cancelComeBack, comeBackOf, dropIdleNotes, peekShellExits, runningShellsOf, tellShellExits, untellShellExits, wakeDue, wakeKindOf } from "../../adapters/tools/hands.js";
import { commandsOf } from "../agent/commands.js";
import { IDLE_BESIDE_WAKE_LINE, LETTER_WAKE_LINE, WAKE_HELD, WAKE_ROOM, isWakeMessage, wakeLineFor } from "./wake.js";
import { DRIVE_MS, afterTurn, driveOf, goalRoundLine, goalRoundOf, haltLine, wordsOf } from "../../core/goal-drive.js";
import { TURN_BY, byOfTurn, turnBy } from "../../core/turn-by.js";
import { createStretches } from "./stretch.js";
import { isSyncMessage } from "../../core/space.js";
import { isRecordBlock, isTeamResult, recordBlock } from "../../core/beside.js";
import { THREAD_LINK, briefFrom, isThreadBrief } from "../../core/threads.js";
import { WAKE_HEAD, guidanceParts, isGuidance, isWatchWake } from "../../core/watchers.js";
import { flowAskLine, isFlowDrive, isFlowEnd, isFlowNews, isFlowSaid, isFlowStart, isHandoffBlock } from "../../core/flow.js";
import { openGraphText, planAskLine, planReadyOf } from "../../core/task-graph.js";
import { copiedBoundary } from "./copies.js";
import { copyPath } from "../../core/worktree-copy.js";
import { specKey } from "../../adapters/tools/mcp-client.js";

/** The estimator's learned factor for a model's routed upstream, when its replies ever stated real usage. */
const calibFactorFor = (cfg, model) => {
  const m = parseAgentModel(model)?.model || model;
  const r = findRoute(cfg, m);
  const up = r && findUpstream(cfg, r.upstream);
  if (!up) return null;
  const wire = renderUpstreamModel(r.upstreamModel, m, r.captures || []) || m;
  return calibFactor(up.id, parseModelSuffix(wire, cfg.rules).base);
};

/** The document's top-level sections (`model`, `loop`, `context`, …): what a project row's `settings_json` holds beside its display flags. */
const SECTIONS = new Set(Object.keys(KNOBS).map((p) => p.split(".")[0]));
/** What a fork's transcript strategy makes of the inherited turns (§6.7). */
const FORK_TRANSCRIPTS = Object.freeze(["ditto", "folds", "brief"]);
const FORK_RESULTS = Object.freeze(["keep", "line", "dedupe-to-tail", "pointer"]);
/** The developer's sub-agent marks a session keeps between its turns (subagentMark); the oldest go first. */
const SUBAGENT_MARKS = 100;
/** The newest marks of the teams beside a chat its transcript keeps: each one's fire and each result (team_v2_plan §5.4). */
const TEAM_MARKS = 100;
/** A lead's window where Filament knows none for its model: its record fills half of it at most (§9 Q4). */
const RECORD_WINDOW = 200_000;
/** The composer's forms a record tries, the fullest first, until one fits half the lead's window. */
const RECORD_FORMS = Object.freeze(["plain", "fold+2", "fold"]);
/** The kinds of message a session's queue keeps across a restart, each as the registry gave it (subagents.js
 *  `SavedDelivery`): the registry reads them back by their kind — a launch's notice, a worker's question and the
 *  developer's words to a sub-agent (HarnessV4_Tasks decision 10) it drops with the sub-agent they told of, never
 *  reading them back as its report. */
const QUEUE_KINDS = /** @type {readonly any[]} */ (Object.freeze(["report", "notice", "task", "overrule", "applied", "ask", "check", "told", "result", "shell"]));
/** Who handed a waiting result in: a team, a flow, another chat's letter, the fork that weighed a message aside, or a
 *  sub-agent's letter. */
const QUEUE_VIA = /** @type {readonly any[]} */ (Object.freeze(["team", "flow", "chat", "steer", "agent"]));
/** The lines of what the page said a session keeps (pageSaid); the oldest go first. */
const PAGE_LINES = 100;
/** How often a turn waiting on a worktree's copy says its progress, at most (FO-D36). */
const COPY_SAY_MS = 250;
/** How long a message sent the moment a reply lands waits for that turn's last bookkeeping, at most (`settledTurn`). */
const SETTLE_MS = 5000;
/**
 * How long a room made for the person's message (the page's Compact and send) waits for that message's turn before the
 * chat's wakes and goal round are asked again (`roomFor`): the page sends it at once, in about a second and a half on
 * the owner's of 11-09.
 */
export const ROOM_SEND_MS = 30_000;
/** How often a turn in a copy another machine sent holds it again (services/copies.js `lease`, held for hours). */
const COPY_RENEW_MS = 60 * 60_000;
/**
 * What a turn of Filament's own — a wake, a goal's round, a resume — tells the agent while the plan it offered still waits
 * on its card for the person (the owner's of 11-10): the card stands until their next message of their own.
 */
/**
 * Why Filament starts no turn by itself in a chat (`notByItself`), by its cause: the person archived the chat, or its
 * project (r-itself, 11-12). The rule's words, as the log and a cut turn's mark keep them; a refusal names the cause
 * (`archivedSaid`), and the page says each to the person in theirs (ui/harness/lib/labels.js `openTurnWords`).
 */
export const ARCHIVED_CHAT = "the person archived it";
export const ARCHIVED_PROJECT = "its project is archived";
/**
 * What is archived, as a refusal of a turn of Filament's own begins — and as a team's card says why Then notify sent
 * nothing by itself (app/teams-beside.js). @param {string | null} why  `notByItself`'s
 */
export const archivedSaid = (why) => (why === ARCHIVED_PROJECT ? "the chat's project is archived" : "the chat is archived");
export const PLAN_OFFER_WAITS = "[Filament: the plan you offered still waits on its card for the person — Plan first, or Just do it. Change nothing of that work until they choose: answer what came, and end your turn.]";
/** The characters of one line of what the page said that are kept. */
const PAGE_LINE_CHARS = 1000;
/** The newest turns a live state's `after` looks in for the turn after a run (`liveState`). */
const NEXT_LOOKED = 20;
/** What the page says, by kind: a note (a toast), an error (an error toast, the error it drew on a turn), a status
 *  line. */
const PAGE_KINDS = Object.freeze(["note", "error", "status"]);
/** A send's own name, as the page makes it (`sendId`): letters, digits, `-` and `_`. */
const SEND_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** The row of the send menu a turn's message went by, as the page's `x-filament-via` head says it (api.js `viaHeader`). */
const VIA = /^row=([a-z][a-z-]{0,39}); by=(key|click|auto)$/;
/**
 * The send menu's row a turn's message went by, for its row to keep (the owner's of 11-09: so the rows' use can be
 * counted): `{ row, by }` from the head, null where there is none or it is not of its form.
 * @param {unknown} head @returns {{ row: string, by: string } | null}
 */
const viaOf = (head) => {
  const m = typeof head === "string" ? VIA.exec(head) : null;
  return m ? { row: m[1], by: m[2] } : null;
};
/** What a turn of the loop paused on, by its park's kind, as the record says it. @type {Record<string, string>} */
const PAUSE_WORDS = Object.freeze({ ask: "question", permission: "permission" });
/**
 * A team's worker's seat's name and the model and effort its team runs it on, as its kept thread holds them: only where
 * it has each. @param {any} t  its team, as its thread keeps it
 */
const seatOf = (t) => ({ ...(t.seat ? { seat: String(t.seat) } : {}), ...(t.model ? { model: String(t.model) } : {}), ...(t.effort ? { effort: String(t.effort) } : {}) });

/**
 * A turn's composed stamp as the transcript says it: all of it but `shapes`, each earlier turn's shape as the turn's
 * request went out, which the turns kept before it stopped being stored still carry. That is a copy of every turn
 * before it, which made the answer grow with the square of the chat, and no page reads it there: the request's
 * composition report says the shapes (`GET /api/requests/:id/composition`).
 * @param {any} stamp  the turn's `meta.composed`
 */
function composedSaid(stamp) {
  if (!stamp || typeof stamp !== "object" || !("shapes" in stamp)) return stamp || null;
  const { shapes: _shapes, ...said } = stamp;
  return said;
}

/**
 * A compaction a turn made, as the turn's record, its stamp and its answer name it: its row's id, the turns it stands
 * for, its kind and its method.
 * @param {{ id: number, fromTurn: number, toTurn: number, kind: string, method: string }} made  the compactor's result
 */
const madeStamp = (made) => ({ id: made.id, fromTurn: made.fromTurn, toTurn: made.toTurn, kind: made.kind, method: made.method });

/**
 * Which turn carried each sub-agent message (HarnessV3-FixRound decision 23): `agentId:exchange:kind` → the turn
 * whose stamp (`carried`) names it.
 * @param {readonly { n: number, carried?: any }[]} turns  the chain's turns in outline (`turnOutline`)
 */
function carriedTurns(turns) {
  /** @type {Map<string, number>} */
  const by = new Map();
  for (const t of turns)
    for (const c of Array.isArray(t.carried) ? t.carried : []) by.set(`${c.agentId}:${c.exchange}:${c.kind}`, t.n);
  return by;
}

/**
 * What a between-turns mark learns from the turn that carried its message: an arrival, the turn its report went with
 * (`carriedBy`); a launch, that the main agent was told (`told`).
 * @param {any} m @param {Map<string, number>} by
 */
function carriedFacts(m, by) {
  const n = by.get(`${m.agentId}:${m.exchange}:${m.event === "arrival" ? "report" : "notice"}`);
  if (n == null) return {};
  return m.event === "arrival" ? { carriedBy: n } : { told: true };
}

/**
 * A thread's brief where a turn opened with one (core/threads.js), read past what rode ahead of it: the turn the
 * service took as a brief (`meta.brief`), and a chat's first turn whatever the links say — a chat whose starter went, a
 * fork, a chat started before the mark. Null for any other turn: a later message that opens as a brief would is the
 * person's paste.
 * @param {any} t  a turn as `turnBodies` reads it @returns {{ content?: unknown } | null}
 */
function briefSaidIn(t) {
  if (t.meta?.brief !== true && Number(t.n) !== 1) return null;
  const ahead = Number(t.meta?.deliveries) || 0;
  const said = ahead && Array.isArray(t.user?.content) ? { content: t.user.content.slice(ahead) } : t.user;
  return isThreadBrief(said) ? said : null;
}

/** The turn number of a chain's newest turn, or 0. @param {any[]} turns */
const lastN = (turns) => (turns.length ? Number(turns[turns.length - 1].n) || 0 : 0);

/**
 * Who began a turn whose row holds no mark of it, as its words read (core/turn-by.js `byOfTurn`'s `unmarked`): a thread's
 * brief its chat's first turn opens with (`briefSaidIn`), whenever it began; Filament's own lines only for a turn begun
 * before turns were marked (`since`, the archive's `bySince`) — one begun since with no mark is the person's, whatever
 * its words say (a wake's line they pasted is theirs).
 * @param {number} since @returns {(t: any) => import("../../core/turn-by.js").TurnBy | null}
 */
const unmarkedBy = (since) => (t) =>
  briefSaidIn(t) ? "thread"
  : !(Number(t.startedAt) < since) ? null
  : isResumeMessage(t.user) ? "resume"
  : isWakeMessage(t.user) ? "wake"
  : goalRoundOf(t.user) ? "goal"
  : isSyncMessage(t.user) ? "sync"
  : isTeamResult(t.user) || isFlowEnd(t.user) || isFlowDrive(t.user) ? "beside"
  : isWatchWake(t.user) ? "watch"
  : Array.isArray(t.user?.content) && t.user.content.some(isFlowSaid) ? "flow"
  : null;
/**
 * Who began a turn (core/turn-by.js), the one reader: its row's mark, its words read only where it holds none
 * (`unmarkedBy`). @param {any} t  a turn as `turnBodies` reads it @param {number} since  the archive's `bySince`
 */
const turnByOf = (t, since) => byOfTurn(t, unmarkedBy(since));
/**
 * Whether a turn began with a message of the person's: not one its coding agent or Filament began by itself — a wake,
 * a goal's round, a resume, a sync, a team's or a flow's result, a flow's line, a thread's brief, a watcher's turn, a
 * routine's run, a Space ask's run, a team's opening (the plan of 11-11), as `turnByOf` reads who began it.
 * @param {any} t  a turn as `turnBodies` reads it @param {number} since  the archive's `bySince`
 */
const fromThePerson = (t, since) => TURN_BY[turnByOf(t, since)].person;
/** How many of a chat's newest turns are looked through for the newest that Filament did not start by itself (`personLast`). */
const PERSON_LOOK = 500;

/**
 * Whether the plan its agent offered on a card still waits for the person (the owner's of 11-10): the newest message of
 * theirs carries it, not stopped. A turn its coding agent or Filament began by itself since (`fromThePerson`) leaves it
 * waiting, as the page draws it (history.js `cardStands`).
 * @param {readonly any[]} turns  the chain's turns, oldest first @param {number} since  the archive's `bySince`
 */
function planOfferWaits(turns, since) {
  const theirs = turns.findLast((t) => fromThePerson(t, since));
  return !!theirs?.meta?.planOffer && !theirs.meta.stopped;
}

/**
 * The reply a waiting question came in, as the page draws it while the question waits (HarnessV3-Launch LD-D7, RD1 b):
 * its words and thoughts. The archive parks it for the resume, so the asking turn's own row never holds it; its calls
 * are the run's cards, and a thought's signature stays with the pause. A reply that only asked brings nothing.
 * @param {any} m  the loop's assistant message (Anthropic-shaped)
 * @returns {{ reply?: { role: "assistant", content: any[] } }}
 */
function pausedReply(m) {
  const content = (Array.isArray(m?.content) ? m.content : []).flatMap((/** @type {any} */ b) =>
    b?.type === "text" && b.text ? [{ type: "text", text: String(b.text) }]
    : b?.type === "thinking" && b.thinking ? [{ type: "thinking", thinking: String(b.thinking) }]
    : []);
  return content.length ? { reply: { role: "assistant", content } } : {};
}

/**
 * What a card shows of a waiting permission beside its question (HarnessV3-Views V6-9): a command whole, from the call
 * that waits, and the reason it asks, as the loop parked it; a change to a file as its diff, against the file as it
 * stands now (HarnessV3-ACP, AC3's drive D5). Nothing for a call that does neither.
 * @param {any} p  the chain's pause
 */
function shownPause(p) {
  const name = String(p.pending?.name || "");
  const command = shownCommand(name, p.pending?.input);
  const change = shownChange(name, p.pending?.input, String(p.root || ""));
  return {
    ...(command ? { command, ...(p.reason ? { reason: String(p.reason) } : {}) } : {}),
    ...(change ? { changes: [change] } : {}),
  };
}

/**
 * A turn's pre-send clock (BUG-19, HarnessV3-FixRound F3 item 17): when the page sent the turn, when the route had
 * it, and how long each phase took until the pipeline took it — the record's `view.timing`, so a delay is
 * diagnosable from the server's side. Wall-clock, as the page's stamp is (not the service's injectable `now`).
 * @param {{ receivedAt?: number, bodyAt?: number, sentAt?: number | null } | null} [arrival]
 */
export function turnClock(arrival = null) {
  const receivedAt = Number(arrival?.receivedAt) || Date.now();
  const sentAt = Number(arrival?.sentAt) > 0 ? Number(arrival?.sentAt) : null;
  /** @type {Record<string, number>} */
  const phases = {};
  let last = receivedAt;
  const bodyAt = Number(arrival?.bodyAt);
  if (bodyAt >= receivedAt) {
    phases.body = bodyAt - receivedAt;
    last = bodyAt;
  }
  return {
    /** The phase that just ended. @param {string} name */
    mark(name) {
      const t = Date.now();
      phases[name] = t - last;
      last = t;
    },
    /** The clock at the hand-off to the pipeline. */
    done: () => ({ receivedAt, sentAt, gapMs: sentAt != null ? receivedAt - sentAt : null, phases: { ...phases }, handoffMs: Date.now() - receivedAt }),
  };
}

/** A refusal the row answers with its status. @param {number} status @param {string} message @param {Record<string, any>} [extra] */
export function refusal(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, extra });
}

/** The ways a coding agent's session can be told to make room for one compaction (HarnessV3-ACP AC5-5). */
const AGENT_WAYS = Object.freeze(/** @type {const} */ (["own", "self", "ours"]));

/**
 * What a coding agent's session of the chat follows (HarnessV3-ACP AC5-1): the chat's newest compaction of Filament's,
 * 0 before any, and the newer one each agent's session stands on where a compaction of Filament's copy alone
 * (`ofCopyAlone`) moved it — an agent's own in the middle of a turn, or the summary Filament wrote for the copy, which
 * moves the sessions of the agents that had not seen all it stands for (HarnessV4_Tasks A8, `compactionBases`).
 * `headers`: as a harness turn names them, for the bridge of whichever agent serves it; `of(upstream)`: the compaction
 * that agent's session stands on.
 * @param {readonly { [k: string]: any }[]} compactions @param {readonly { n: number, startedAt?: any, meta?: any }[]} turns
 */
function basesOf(compactions, turns) {
  const { base, rows } = compactionBases(compactions, turns);
  return {
    headers: { [COMPACTION_HEADER]: String(base), ...(rows.size ? { [STANDS_ON_HEADER]: standsOnHeader(rows) } : {}) },
    /** @param {string} upstream */
    of: (upstream) => standsOn(base, rows, upstream),
  };
}

/**
 * The background tasks a coding agent's own turn answers (AC3-9), as the bridge named them: the newest 20, their
 * words bounded.
 * @param {any} list @returns {{ id: string, status: string, summary: string }[]}
 */
const ownTasksOf = (list) =>
  (Array.isArray(list) ? list : []).slice(-20).map((t) => ({
    id: String(t?.id || "").slice(0, 120),
    status: String(t?.status || "").slice(0, 40),
    summary: String(t?.summary || "").trim().slice(0, 600),
  }));

/**
 * A memory call whose coded refusal becomes the row's answer: `not-found` → 404, `invalid` → 400. Anything uncoded —
 * a missing archive, a bug — goes on as it was, to the admin edge.
 * @template T @param {() => T} fn @returns {T}
 */
function viaMemory(fn) {
  try {
    return fn();
  } catch (/** @type {any} */ e) {
    throw e?.code === "not-found" ? refusal(404, e.message) : e?.code === "invalid" ? refusal(400, e.message) : e;
  }
}

/**
 * One line of a session-settings operation as the change it records — `{ path, to }`, `to` absent when the knob
 * inherits again — or null for a line that is not one: memory's `changeLines` writes each as its path and the value as
 * JSON, or "inherits again".
 * @param {unknown} line @returns {{ path: string, to?: any } | null}
 */
export function settingsChangeOfLine(line) {
  const s = String(line ?? "");
  const at = s.indexOf(": ");
  if (at < 1) return null;
  const path = s.slice(0, at), raw = s.slice(at + 2);
  if (raw === "inherits again") return { path };
  try { return { path, to: JSON.parse(raw) }; } catch { return null; }
}

/**
 * One rule in force as the permission switch lists it (HarnessV3-AtHome AH-D7): `from` is the layer a written rule
 * comes from, `learned` for what Always allow remembered, or `chat` for a command the chat keeps always allowed
 * (d-allow, agent/chat-always.js): its `tool` the hand's family (bash, powershell), its `pattern` the command as kept.
 * @typedef {{ tool: string, pattern: string, verdict: "allow" | "ask" | "deny" | "review", from: "session" | "project" | "learned" | "chat" }} RuleInForce
 */

/**
 * `skip` is there while Filament writes the summary the turn waits on: Send without it (skipWait) lets it go.
 * `ended` settles once the turn has given the session back: a message sent the moment its reply lands waits for it.
 * @typedef {{ startedAt: number, requestId: string | null, res: import("node:http").ServerResponse, cancel: AbortController, skip?: AbortController | null,
 *   ended?: Promise<void>, use?: { tag?: string, key?: string, name: string }[], plain?: boolean, worded?: boolean, flowing?: boolean, flowOffer?: boolean, planning?: boolean, planOffer?: import("../../core/task-graph.js").PlanOffer,
 *   planOfferRow?: string, since?: number }} LiveTurn  `use`: the
 *   agents and teams its message and its notes named with an `@` (HarnessV4_OneAgent_Plan OA2) — at its end, those the
 *   main agent did not use are said on it; `plain`: its message is the person's own, `worded` with words of theirs, not
 *   pictures alone; `flowing` a /flow; `flowOffer`: its main agent offered Run as a flow under its reply (OA6);
 *   `planning` a /plan's or its
 *   answer's, read-only, its graph's changes held for the person's Approve; `planOffer`: its main agent offered to plan
 *   the work first, on a card under its reply (the owner's plan mode of 11-06), written to the row `planOfferRow` as it
 *   was made; `since`: the chat's newest turn number before this turn's rows
 * @typedef {{ memory: any, config: { get: () => any, set?: (cfg: any) => void, save?: () => void, version?: () => number }, pipeline: { handle: (req: any, res: any, format: any, pre: any) => Promise<void> },
 *   ops: { record: (kind: string, title: string, o?: any) => any, list?: (q: any) => any[] }, log: (level: string, msg: string) => void,
 *   forkSession: (chainId: string, args: any) => Promise<any>, sessionTurns?: import("../../services/session-turns.js").SessionTurns | null,
 *   subagents?: { peekQueued: (chainId: string) => readonly { text: string, from: string, kind: string, exchange?: number }[], ackQueued: (chainId: string, sent: readonly any[]) => void,
 *     lettersOwed?: (chainId: string) => { n: number, wakes: boolean, fresh: boolean }[], backQueued?: (chainId: string, sent: readonly any[], letters?: readonly { n: number, wakes: boolean, fresh: boolean }[]) => void,
 *     reportsDue?: (chainId: string) => boolean, dueKinds?: (chainId: string) => string[], lettersDue?: (chainId: string) => boolean, pauseLetGo?: (chainId: string) => void,
 *     wakingWork?: (chainId: string) => number,
 *     held?: (chainId: string) => import("../agent/held-launch.js").HoldView[],
 *     askables?: (tags: unknown) => import("../agent/tools.js").Askable[], asks?: (chainId: string) => import("../agent/tools.js").Askable[],
 *     placesFor?: (asks: readonly import("../agent/tools.js").Askable[]) => import("../agent/tools.js").Askable[],
 *     modelsOf?: (chainId: string | null, members: readonly { tag: string, card?: string, own?: { model?: string } }[], leadModel: string | null | undefined, sub?: any) => import("../agent/prompt.js").TeamModels,
 *     overruleFrames?: (chainId: string, list: unknown) => { text: string, from: string, description: string, kind: string, exchange?: number }[],
 *     overruled?: (chainId: string, frames: readonly any[], words: string) => void, overrule?: (chainId: string, list: unknown, words: string) => number,
 *     usesOf?: (tags: unknown) => { tag: string, name: string }[], heard?: (chainId: string, text: unknown, o?: { add?: boolean }) => string[],
 *     usedSince?: (chainId: string, since: number) => Set<string>,
 *     carried: (chainId: string, turn: number, carried: readonly { agentId: string, exchange: number, kind: string }[]) => void,
 *     forkCall: (chainId: string, instruction: string, o?: any) => Promise<any>, cacheOf: (chainId: string) => any,
 *     atWork?: () => string[] } | null,
 *   records?: { detail: (id: string) => any, on?: (ev: "event", fn: (e: any) => void) => any,
 *     speedOf?: (model: string) => { ttftMs: number, tps: number, calls: number } | null,
 *     callTimeOf?: (model: string, kind: "compact") => { ms: number, calls: number } | null } | null,
 *   publish?: ((chainId: string, event: any) => void) | null,
 *   parks?: { letGo: (chainId: string) => void } | null,
 *   runs?: (Pick<import("../../services/runs.js").RunLog, "hasRun"> & Partial<Pick<import("../../services/runs.js").RunLog, "runningIn" | "events">>) | null,
 *   modelProblem?: ((name: string) => string | null) | null,
 *   environment?: ((root: string) => Promise<import("../agent/environment.js").EnvironmentFacts>) | null,
 *   teams?: import("../../services/teams.js").TeamStore | null,
 *   besides?: (() => { usesOf: (keys: unknown) => { key: string, name: string }[], heard: (mainId: string, text: unknown, o?: { add?: boolean }) => string[],
 *     usedSince: (mainId: string, since: number) => Set<string>, owing?: (mainId: string) => number } | null) | null,
 *   flows?: (() => Pick<import("../flow-runner.js").FlowRunner, "asked" | "roster"> | null) | null,
 *   agentSelf?: ReturnType<typeof import("../agent-self.js").createAgentSelf> | null,
 *   agentTasks?: ((chainId: string) => import("../../adapters/agents/acp/bridge.js").AgentTask[]) | null,
 *   agentTaskStop?: ((chainId: string, taskId: string) => { ok: true } | { ok: false, why: string }) | null,
 *   mcpTests?: Map<string, { ok: boolean, words: string }> | null,
 *   spaceMade?: ((project: string) => boolean) | null,
 *   chatWatchers?: ((chainId: string) => import("../../core/routines.js").ChatWatcher[]) | null,
 *   chatWatching?: Pick<ReturnType<typeof import("../chat-watchers.js").createChatWatchers>, "reviews" | "guide" | "woke"> | null,
 *   copies?: import("./copies.js").WorktreeCopies | null,
 *   copyLease?: { start: (copy: string, chat: string) => string, end: (copy: string, until: number) => void } | null,
 *   agentTakesMcp?: ((upstreamId: string) => boolean) | null,
 *   graphKept?: ((chainId: string) => import("../../core/task-graph.js").Kept | null) | null,
 *   graphWhere?: ((chainId: string, crew: import("../../core/task-graph.js").Crew, o?: { starting?: boolean }) => string | null) | null,
 *   stillOpen?: Pick<import("../agent/still-open.js").StillOpen, "lines" | "told" | "untold" | "undone"> & Partial<Pick<import("../agent/still-open.js").StillOpen, "refresh" | "folded">> | null,
 *   sideOffers?: { offered: (chainId: string) => (import("../../core/task-graph.js").SideOffer & { tasks: { id: string, name: string, writes: string[] }[] }) | null } | null,
 *   plans?: { turn: (chainId: string, on: boolean) => void, carryRefusal?: (chainId: string) => string | null,
 *     carry?: (from: string, to: string, o: { title?: string, toTitle?: string }) => { ok: true, tasks: number, files: number } | { ok: false, error: string } } | null,
 *   withPlugins?: ((doc: any, where: { project?: string | null, chat?: string | null, cwd?: string }) => any) | null,
 *   wakeComing?: ((chainId: string) => boolean) | null,
 *   wakeEnded?: ((chainId: string, kept: boolean) => void) | null,
 *   graphChecks?: ((chainId: string) => number) | null,
 *   goalRound?: ((chainId: string) => void) | null,
 *   roomMade?: ((chainId: string) => void) | null,
 *   roomHoldMs?: number,
 *   idleWake?: Pick<import("./idle-wake.js").IdleWaker, "ended" | "began" | "stopped" | "cancel" | "next" | "list"> | null,
 *   letters?: { heard: (chainId: string, typed: unknown) => void } | null,
 *   turnEnded?: ((chainId: string, t: { turn: number | null, failed: boolean, stopped: boolean, since: number | null }) => void) | null,
 *   weightsKept?: number,
 *   now?: () => number }} SessionsDeps
 *   `roomMade` asks a chat's wakes and its goal's round again once the room made for it is no person's message's (the
 *   server's wakers; the owner's of 11-09): none ran while it was made (`roomNow`). `roomHoldMs`: how long a room made
 *   for a message waits for it (ROOM_SEND_MS).
 *   `idleWake` is the idle wake (idle-wake.js, the owner's of 11-08): a turn that ends well while a background command of
 *   its agent's runs arms it, any turn's start drops it, and so does the person's Stop (`idleStop`). Absent, an idle
 *   agent waits for its command's end.
 *   `letters` hears each message of the person's taken into their chat (app/letters.js `heard`): the chats it tags are
 *   its agent's to write to. Absent, no chat's agent writes letters.
 *   `turnEnded` hears each turn of a chat that ended, on every engine (the watchers, app/watchers/events.js, the plan of
 *   11-11): its number, whether it failed or the person stopped it, and its start. Absent, nothing hears it.
 *   `goalRound` sends a chat its driving goal's next round, once the turn whose end owed it lets go (core/goal-drive.js; the
 *   server's waker). Absent, no goal is driven past its turn.
 *   `wakeComing`: whether a turn that wakes a chat's agent is on its way — the waker's (wake.js), or its coding agent's
 *   own (AC3-9) —, which keeps its work stretch going (stretch.js). Absent, none is. `graphChecks`: how many of a
 *   chat's task graph's checks Filament runs now, whose verdict wakes its agent — they keep its stretch going too.
 *   `wakeEnded` hears a chat's turn that ended (the server's waker, wake.js `ended`): one the model's history keeps
 *   (`kept`), or one Filament started by itself that failed before its model did any work and gave back what it carried
 *   (`carriedEnded`), which the waker wakes the chat for again, a few times. Absent, what went back waits for the chat's
 *   next turn.
 *   `weightsKept`: how many blocks' weights the compositions keep (`keptWeights`), about 250 bytes each: a long chat's
 *   tens of thousands several times over, 150,000 unless said.
 *   `withPlugins` adds what the plugins on at a chat's place bring to its document (HarnessV4_SpacesPlugins_Plan B3,
 *   app/plugins.js `into`): the board, the instructions row and the fit read what a turn reads. Absent, no plugin.
 *   `graphKept` says what is kept behind each task of a session's graph (HarnessV4_TaskNotes_Plan E33): the graph that
 *   comes back after a summary marks it. Absent, nothing is marked. `graphWhere`: where its planner stands, the
 *   running and paused tasks' checkpoints in it (HarnessV4_TaskGraphPlus_Plan E41 P1), after that graph — `starting`, as
 *   the turn starting now says it, a turn more on each running task of its own (a switch's handover). `stillOpen`:
 *   what is still open in a chat for its main agent (agent/still-open.js), last in what comes back after a summary,
 *   which its main agent hears once the summary lands. Absent, nothing is said open. `sideOffers`: the side-by-side
 *   card (Phase 5) — its agent suggests it (the owner's of 11-10), and the transcript draws the one that stands after the
 *   turn that suggested it. Absent, none is drawn.
 *   `subagents` is the registry: reports that reached an idle session open its next turn's message, and a compaction
 *   summary may be written by a fork of the session's warm request (`forkCall`, `cacheOf`); a sub-agent whose end comes
 *   to a chat's main agent (`wakingWork`) keeps its work stretch going (stretch.js).
 *   `records` is the request log (`usage`): the transcript asks it whether the turn that took a pause still runs (HarnessV3-Views V6-12). Absent, a pause shows until that turn ends. Its live
 *   records of a running compaction's calls are that compaction's progress.
 *   `publish` says a session's news with its id, on the events feed every page holds (server.js: `compactions`): each
 *   running compaction's progress (HarnessV3-FailurePoints §5.1 item 3; HarnessV4_Tasks U3-5) and cost, a summary of
 *   Filament's copy landed, a rewind and its undo, a question ended with no answer's turn (`question-over`), and its
 *   work stretch begun, gone on with a turn or ended (`stretch`, stretch.js). Absent, it is not said.
 *   `parks` are the agent loop's paused turns in this process (agent/turn.js `letGo`): one whose question ended with no
 *   answer's turn is let go with its in-process work. Absent, none is kept.
 *   `runs` is the run log: each transcript row says whether its turn has a run (HarnessV3-Launch LD-D13), so the page
 *   never asks for one that a command's turn never had. Absent, no row claims one.
 *   `modelProblem` is the loop's refusal rule for a model behind it (`plainModelProblem` with the app's destinations):
 *   the New Task board offers delegate_read only where the loop would. Absent, every named reader counts as fine.
 *   `environment` is the app's capture of a folder's Environment section (HarnessV3-SystemPrompt SP-D7): the board weighs
 *   the section the session's first turn will send. Absent, the board weighs a prompt without one, as the loop sends it.
 *   `teams` are the teams a session's engine can name (HarnessV3-AtHome P2): the settings answer lists them and says
 *   whether the chosen one can lead. Absent, no team exists and a session that names one is told so.
 *   `agentSelf` asks a coding agent to write Filament's summary of its own session (HarnessV3-ACP AC5-4: Self), or to
 *   compact it its own way (AC5-5: own). Absent, an agent's session makes room on Filament's copy.
 *   `agentTasks` are the tasks the session's coding agent runs now (Claude's, HarnessV3-FailurePoints §5.1 item 2): the
 *   transcript carries them; each change rides the events feed. Absent, the transcript says none.
 *   `agentTaskStop` stops one of them alone, where its agent lets Filament (HarnessV4_Tasks E6). Absent, none is stopped.
 *   `mcpTests` are the MCP servers' last tests in Settings › MCP servers, by `specKey` (HarnessV4_Settings_Plan HC-26):
 *   the New Task board dots each server it names. Absent, no server shows a test.
 *   `copies` are the worktree templates' copies (HarnessV4_Four_Plan E19): a chat's turn waits for the one running into
 *   its worktree, and the transcript draws each as a row. Absent, nothing is copied and nothing waits.
 *   `config.version` is the store's count of saves and reloads: a preview composed while it moved is not shared with
 *   one asked after (`preview`). Absent, the configuration object in force alone says it.
 */

/** @param {SessionsDeps} deps */
export function createSessions({ memory, config, pipeline, ops, log, forkSession, sessionTurns = null, subagents = null, records = null, publish = null, parks = null, runs = null, modelProblem = null, environment = null, teams = null, besides = null, flows = null, agentSelf = null, agentTasks = null, agentTaskStop = null, mcpTests = null, spaceMade = null, chatWatchers = null, chatWatching = null, copies = null, copyLease = null, agentTakesMcp = null, graphKept = null, graphWhere = null, stillOpen = null, sideOffers = null, plans = null, withPlugins = null, wakeComing = null, wakeEnded = null, graphChecks = null, goalRound = null, roomMade = null, roomHoldMs = ROOM_SEND_MS, idleWake = null, letters = null, turnEnded = null, weightsKept = 150_000, now = Date.now }) {
  /** A document with what its plugins on bring (B3), as a turn's request reads it. @param {any} doc @param {{ project?: string | null, chat?: string | null, cwd?: string }} where */
  const pluginsIn = (doc, where) => (withPlugins && doc ? withPlugins(doc, where) : doc);
  // One turn at a time in a chat is SessionTurns' (HarnessV3 Step 3 D12), keyed by the chain key and shared with the
  // chat's move. This map is only the harness's own plumbing: catching the request id the pipeline mints while the
  // turn runs (the writeHead watcher below). With `sessionTurns` null (a built-alone test) the harness guards itself
  // and nothing else.
  /** @type {Map<string, LiveTurn>} */
  const liveTurns = new Map();
  /**
   * A live turn for `res`, and what gives the session back: `ended` settles when the turn's `finally` calls `gaveBack`.
   * @param {import("node:http").ServerResponse} res @returns {{ live: LiveTurn, gaveBack: () => void }}
   */
  const liveTurnFor = (res) => {
    let gaveBack = () => {};
    const ended = new Promise((r) => (gaveBack = () => r(undefined)));
    return { live: { startedAt: now(), requestId: null, res, cancel: new AbortController(), ended }, gaveBack };
  };
  /**
   * The session's turn whose reply was sent whole, with only its bookkeeping left (its rows stamped): a
   * message sent the moment that reply lands waits for the turn to give the session back — a few seconds at most, then
   * it is answered as ever (409). A turn still replying is not waited for.
   * @param {string} chainId
   */
  const settledTurn = async (chainId) => {
    const live = liveTurns.get(chainId);
    if (!live?.ended || !live.res.writableEnded) return;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let t;
    await Promise.race([live.ended, new Promise((r) => (t = setTimeout(r, SETTLE_MS)))]);
    clearTimeout(t);
  };
  /** When this Filament started: a turn still running before it, with no reply, was cut off, and none will come
   *  (`cutOffBefore`, `modelTurnsOf`). */
  const bootAt = now();
  /** The lock for a harness turn — taken and released around the whole turn. The request id reaches the holder
   *  through the head watcher (`watchHead`: a renew with the id). `own`: a turn a coding agent began by itself
   *  (HarnessV3-ACP AC3-9), which the holder says. No silence gives it back (HarnessV4_Tasks A1): the turn is the
   *  server's, and only its end below gives the session back. */
  const takeLock = (/** @type {string} */ chainKey, /** @type {{ own?: { agent: string } | null }} */ { own = null } = {}) => {
    if (!sessionTurns) return null;
    const got = sessionTurns.acquire(chainKey, { window: "harness", client: "harness", own });
    return got.ok ? got.token : null;
  };
  /** The 409s a harness send gets while the chat is held (D12/D14): each names the holder. The harness's own turn keeps
   *  today's words and steer info, and the page that sent into it — one that had lost its own turn — follows that turn
   *  again; the chat's move the page turns into its waiting queue, as it does a turn a coding agent began by itself
   *  (AC3-9), whose note waits for its end. */
  const ownTurnRefusal = (/** @type {string | null} */ requestId, /** @type {number | undefined} */ startedAt) =>
    refusal(409, "a turn is already running in this session — steer it through its run, or wait for it to end", {
      requestId,
      startedAt,
      holder: { window: "harness", client: "harness", label: clientLabel("harness"), requestId, since: startedAt },
    });
  const otherTurnRefusal = (/** @type {any} */ holder) =>
    refusal(
      409,
      holder?.own
        ? `${holder.own.agent} is running a turn of its own in this session — it can be stopped from the harness, or waited out`
        : "this chat is moving to another folder — the message goes once it has moved",
      { holder },
    );
  /**
   * Who runs a turn in the session now (§5), as the transcript and the live route say it: the lock's holder — the
   * chat's move, or the harness's own turn with the request id the head watcher caught. Null when none.
   * @param {{ id: string, key: string }} chain
   */
  const liveOf = (chain) => {
    const held = sessionTurns?.holder(chain.key) || null;
    const own = liveTurns.get(chain.id) || null;
    if (held) return { window: held.window, client: held.client, label: held.label, requestId: held.requestId ?? own?.requestId ?? null, startedAt: held.since, idleMs: held.idleMs, phase: held.phase ?? null, own: held.own ?? null };
    return own ? { window: "harness", client: "harness", label: clientLabel("harness"), requestId: own.requestId, startedAt: own.startedAt, idleMs: now() - own.startedAt } : null;
  };
  /**
   * The request id is minted inside the pipeline and travels out only as a response header; the second tab that
   * follows a harness turn's run needs it while the turn is live, so the head write is watched for it — and the
   * holder's snapshot renews with it, so a waiting window sees whose request runs.
   * @param {import("node:http").ServerResponse} res @param {string} chainKey @param {LiveTurn} live
   * @param {string | null | undefined} lock
   */
  const watchHead = (res, chainKey, live, lock) => {
    /** @type {any} */
    const writeHead = res.writeHead.bind(res);
    /** @type {any} */ (res).writeHead = (/** @type {any[]} */ ...args) => {
      const h = args.find((x) => x && typeof x === "object" && !Array.isArray(x));
      if (h && h["x-filament-request-id"]) {
        live.requestId = String(h["x-filament-request-id"]);
        if (sessionTurns && lock) sessionTurns.renew(chainKey, lock, { requestId: live.requestId });
      }
      return writeHead(...args);
    };
    if (sessionTurns && lock) renewOnWrite(res, sessionTurns, chainKey, lock);
  };
  /**
   * The chain's parked question or permission while it still waits; null when none. An expired park (nobody answered
   * in time) is a park no longer, and neither is one of a kind no turn pauses on (turn.js `PAUSE_KINDS`). @param {any} chain
   */
  const pausedNow = (chain) => {
    const p = chain.meta?.paused;
    return p && PAUSE_KINDS.includes(p.kind) && !(Number(p.expires) > 0 && Number(p.expires) <= now()) ? p : null;
  };
  /**
   * The question the session's turn paused on, read as it stands now (`meta.paused` alone): while it waits for the
   * person's answer, nothing is written into the session's history — the answer goes on in that turn, which makes room
   * by itself. Null when none. @param {string} chainId
   */
  const askingNow = (chainId) => pausedNow({ meta: archive().metaOf(chainId, ["paused"]) || {} });
  /** Each session's question watched for its lapse (`watchLapse`): when it was asked, and the timer at its end. */
  const lapses = /** @type {Map<string, { at: number, timer: ReturnType<typeof setTimeout> }>} */ (new Map());
  /**
   * The question a turn of the session paused on ended with no answer's turn — left for a coding agent (`unanswered`),
   * taken away by a rewind (`rewound`), or out of time (`lapsed`): that turn is over, and what waited on its question
   * goes — what the registry held for the turn's end (`pauseLetGo`), the loop's park with its in-process work
   * (`parks.letGo`), and the asker of a coding agent's own turn, told on the feed (`question-over`).
   * @param {string} chainId @param {"unanswered" | "rewound" | "lapsed"} why
   */
  const questionOver = (chainId, why) => {
    clearTimeout(lapses.get(chainId)?.timer);
    lapses.delete(chainId);
    subagents?.pauseLetGo?.(chainId);
    parks?.letGo(chainId);
    publish?.(chainId, { type: "question-over", why });
  };
  /**
   * The question a turn of the session paused on, watched for its lapse from now on: unanswered when its time is out
   * (`expires`), it ends there (`questionOver`). Watched from the end of the turn that asked, and from the first look of
   * what waits on it — a park from before a restart. The question waiting, or null. @param {string} chainId
   */
  const watchLapse = (chainId) => {
    const p = askingNow(chainId);
    const at = Number(p?.at) || 0;
    if (!p || !(Number(p.expires) > 0) || lapses.get(chainId)?.at === at) return p;
    clearTimeout(lapses.get(chainId)?.timer);
    const timer = setTimeout(() => lapsed(chainId, at), Math.max(0, Number(p.expires) - now()));
    timer.unref?.();
    lapses.set(chainId, { at, timer });
    return p;
  };
  /**
   * A watched question's time is out: still the one asked then, unanswered, it ended there. One answered, let go or
   * asked anew since is nothing to this watch. @param {string} chainId @param {number} at
   */
  const lapsed = (chainId, at) => {
    if (lapses.get(chainId)?.at !== at) return;
    lapses.delete(chainId);
    try {
      if (!archive().hasChain(chainId)) return;
      const p = archive().metaOf(chainId, ["paused"])?.paused;
      if (!p || (Number(p.at) || 0) !== at) return;
      if (pausedNow({ meta: { paused: p } })) return void watchLapse(chainId);
      questionOver(chainId, "lapsed");
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chainId}: the lapse of its question was not heard (${e?.message || e})`);
    }
  };
  /** Whether the person pressed Stop and no turn has begun since (`meta.lastStop`, FO-D50). @param {any} chain */
  const stoppedSince = (chain) => {
    const s = chain.meta?.lastStop;
    return !!s && Number(s.turn) >= archive().newestTurnN(chain.id);
  };
  /**
   * Why Filament starts no turn by itself in a chat, whenever it is asked, or null (the review of 11-11: the rule stood
   * in the start's sweep alone, so a chat archived while its command or its sub-agent ran still took wakes, goal rounds,
   * come-backs and idle check-ins): the person archived it — out of their tree, nothing goes on in it by itself until
   * they bring it back, with Unarchive or by writing in it (`backFromArchive`). Or they archived its project
   * (r-itself, 11-12: the project's flag hid it from the tree and held nothing, so its chats went on taking wakes,
   * goal rounds and a restart's resume): an archived project runs nothing by itself until they bring it back — its
   * chats' own marks untouched, and a message of theirs in one taken as in any chat, bringing no project back. The
   * one rule the wake's gate, the goal round's and the resume's (`turn`), the idle check-in (`idleHeld`), the start's
   * sweep (server.js `liveSkip`) and its plan of the cut turns (resume-cut.js `resumePlan`) all ask. What the chat is
   * owed stays owed, and rides its next turn. The day's cutoff and Go on after a restart are none of it: they weigh
   * what a restart gives back, at the start alone (server.js `startSkip`).
   * @param {any} chain  its meta's `archived` is read, and its project's flag by its `id` (one row, archive.js `projectArchivedOf`)
   */
  const notByItself = (chain) => (chain?.meta?.archived ? ARCHIVED_CHAT : chain?.id != null && archive().projectArchivedOf(String(chain.id)) ? ARCHIVED_PROJECT : null);
  /**
   * The pause a decision still waits on, as the transcript says it (HarnessV3-Views V6-12): not while the turn that
   * answers it runs — the resume marks it with its request (`answeredBy`), and the request log says whether that
   * request is in flight. A mark left by a request that ended without its bookkeeping (Filament stopped mid-turn)
   * names none in flight: the pause waits again. A turn begun in the session since the pause was parked is its
   * answer from its first moment, before memory has prepared it and the resume has marked it (V6-18).
   * @param {any} chain
   */
  const waitingNow = (chain) => {
    const p = pausedNow(chain);
    if (!p) return null;
    const live = liveOf(chain);
    if (live && Number(live.startedAt) > Number(p.at)) return null;
    return p.answeredBy && records?.detail(String(p.answeredBy))?.status === "pending" ? null : p;
  };

  const archive = () => {
    if (!memory.archive) throw new Error(`no archive: native sessions need it. ${memory.archiveWhy()}`);
    return memory.archive;
  };
  /**
   * When the archive began keeping who begins each turn (archive `bySince`): an unmarked turn begun before is read by its
   * words (`unmarkedBy`). An archive that says none has every turn read by its words.
   */
  const bySince = () => {
    const s = Number(archive().bySince?.());
    return Number.isFinite(s) ? s : Infinity;
  };
  /** @param {string} id */
  const chainOf = (id) => {
    const chain = archive().getChain(String(id || ""));
    if (!chain) throw new Error("no such session");
    return chain;
  };
  /**
   * The session's id where the archive holds it, refused as `chainOf` refuses: for a writer that reads nothing else
   * of the chain, so it is not read whole (its meta grows with the chat). @param {string} id
   */
  const chainIdOf = (id) => {
    const chainId = String(id || "");
    if (!archive().hasChain(chainId)) throw new Error("no such session");
    return chainId;
  };
  /** When the person last wrote in the chat (`personAt` in its meta), for a start's sweep: bookkeeping, logged where it fails. @param {string} chainId */
  const keepPersonAt = (chainId) => {
    try {
      archive().mergeMeta(chainId, { personAt: now() });
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chainId}: when the person last wrote could not be kept (${e?.message || e})`);
    }
  };
  /**
   * The person wrote in a chat they archived: it comes back out of the archive — the chat is in use again, as writing
   * in an archived conversation brings it back in any messenger —, so what its agent starts from here and ends its
   * turn on wakes it (`notByItself`). Written as the page's Unarchive writes it (memory `patchSessionSettings`): the
   * chat's mark and its teams' beside follow, the lists read it again, the feed says its settings moved, and the
   * start's hold on it goes (server.js `unarchived`). A team's own chat lies archived with the chat it runs beside,
   * by that chat's word: written in, it brings that chat back, and comes back with it. Logged where it fails: their
   * message goes all the same.
   * @param {any} chain  the chat they wrote in
   */
  const backFromArchive = (chain) => {
    try {
      const id = (chain.kind === "team" && archive().mainOf(chain.id)) || chain.id;
      const r = memory.patchSessionSettings(id, { patch: { display: { archived: false } } }, { via: "the person's message" });
      if (r.errors.length) log("warn", `sessions: session ${chain.id}: the person wrote in it, and it could not be brought back from the archive (${r.errors.join("; ")})`);
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chain.id}: the person wrote in it, and it could not be brought back from the archive (${e?.message || e})`);
    }
  };
  /** A goal's round owed, or owed no more, kept in the chat's meta: bookkeeping, logged where it fails. @param {string} chainId @param {boolean} owed */
  const keepGoalOwed = (chainId, owed) => {
    try {
      if (archive().hasChain(chainId)) archive().mergeMeta(chainId, { goalOwed: owed || undefined });
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chainId}: its goal's owed round could not be kept for a restart (${e?.message || e})`);
    }
  };
  /**
   * The chats a driving goal's next round is owed to (core/goal-drive.js): a turn's end owes it, the round's turn takes it.
   * Kept with the chat (`goalOwed` in its meta), so a restart owes it still (sessions/owed-wakes.js, the nudge map of 11-10).
   * @type {Set<string>}
   */
  const goalOwed = new (class extends Set {
    /** @param {string} chainId */
    add(chainId) {
      if (!this.has(chainId)) keepGoalOwed(chainId, true);
      return super.add(chainId);
    }
    /** @param {string} chainId */
    delete(chainId) {
      const had = super.delete(chainId);
      if (had) keepGoalOwed(chainId, false);
      return had;
    }
  })();
  /**
   * What keeps a chat's work stretch going (stretch.js): what ends and wakes its agent where no turn of it runs — its
   * agents' commands running, its sub-agents whose end comes to its main agent (`wakingWork`, a graph's tasks among
   * them), its coding agent's own background tasks, its teams beside it whose result goes to it by itself (`owing`) —
   * and a turn that wakes it on its way (`wakeComing`: the waker's, or its coding agent's own). An end that wakes nobody
   * — the person's Stop of a command, a restart's word, a wake refused — keeps nothing.
   * @param {string} chainId @returns {import("./stretch.js").Waits}
   */
  const waitsOf = (chainId) => ({
    commands: runningShellsOf(chainId).length,
    agents: subagents?.wakingWork?.(chainId) || 0,
    tasks: (agentTasks?.(chainId) || []).filter((t) => t.background === true).length,
    teams: besides?.()?.owing?.(chainId) || 0,
    // …its task graph's checks Filament runs, whose verdict wakes its agent (the owner's of 11-06)…
    checks: graphChecks?.(chainId) || 0,
    // …or a driving goal's round, owed until its turn takes it.
    coming: !!wakeComing?.(chainId) || goalOwed.has(String(chainId)),
  });
  // Each chat's work stretch (stretch.js): Now counts the chat's time from its start, across the turns what it waited on
  // woke, and the page hears each move of it with the chat's news. It is bookkeeping: what fails in it is logged, and
  // never fails a turn or a read.
  const stretches = createStretches({ archive: () => memory.archive || null, waits: waitsOf, moved: (chainId, since, waits) => publish?.(chainId, { type: "stretch", since, ...(waits ? { waits } : {}) }), now });
  /**
   * Its stretch's step, where what fails is logged and goes no further. @param {string} chainId @param {string} what
   * @param {() => void} step
   */
  const stretchStep = (chainId, what, step) => {
    try {
      step();
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chainId}: its work stretch was not ${what} (${e?.message || e})`);
    }
  };
  /** A turn of the chat ended: its stretch with it where nothing keeps it (stretch.js). @param {string} chainId */
  const stretchEnded = (chainId) => stretchStep(chainId, "weighed at its turn's end", () => stretches.ended(chainId));
  /** The idle wake's step (idle-wake.js): bookkeeping, logged where it fails, never failing a turn. @param {string} chainId @param {() => void} step */
  const idleStep = (chainId, step) => {
    try {
      step();
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chainId}: its idle wake was not kept (${e?.message || e})`);
    }
  };
  /**
   * Whether the chat may not be woken for its idle agent now (idle-wake.js `blocked`): gone, a turn holds it, a question
   * waits for the person's answer, the person stopped it and no turn has begun since, or they archived it
   * (`notByItself`) — each a wake would be refused for, its check-in then riding a later message. @param {string} chainId
   */
  const idleHeld = (chainId) => {
    const chain = archive().getChain(String(chainId));
    return !chain || liveTurns.has(chain.id) || !!sessionTurns?.holder(chain.key) || !!pausedNow(chain) || stoppedSince(chain) || !!notByItself(chain);
  };
  /**
   * A turn ended well: the idle wake armed where a command of its agent's runs (idle-wake.js `ended`) — not where the
   * person stopped it, nor where it paused on a question for them: their answer or message goes on.
   * @param {string} chainId @param {LiveTurn} live @param {any[]} mine  the turn's archived rows
   */
  const idleTurnEnded = (chainId, live, mine) =>
    idleStep(chainId, () => {
      if (!idleWake) return;
      const chain = archive().getChain(chainId);
      if (!chain || live.cancel.signal.aborted || mine.at(-1)?.meta?.stopped || pausedNow(chain) || stoppedSince(chain)) return void idleWake.cancel(chainId);
      idleWake.ended(chainId);
    });
  /**
   * A turn ended, told to whoever hears turns end (the watchers): its number, failed — its last row has no reply and says
   * so —, stopped by the person, and its start, its first row's. Bookkeeping: logged where it fails, never failing a turn.
   * @param {string} chainId @param {LiveTurn} live @param {any[]} mine  the turn's archived rows
   */
  const turnHeard = (chainId, live, mine) => {
    if (!turnEnded || !mine.length) return;
    try {
      const last = mine[mine.length - 1];
      const since = Number(mine[0]?.started_at);
      turnEnded(chainId, { turn: Number.isInteger(last?.n) ? last.n : null, failed: !last?.final_hash && !!last?.meta?.failed, stopped: !!last?.meta?.stopped || live.cancel.signal.aborted, since: since > 0 ? since : null });
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chainId}: its turn's end was not heard (${e?.message || e})`);
    }
  };
  /**
   * The session's head (`chainHead`: its id, its key, where it stands), refused as `chainOf` refuses: for a reader of
   * those alone, so the chain is not read whole. @param {string} id
   */
  const headOf = (id) => {
    const head = archive().chainHead(String(id || ""));
    if (!head) throw new Error("no such session");
    return head;
  };
  /**
   * The turns a model sees: finished, or cut off before their reply by a restart (2b-C D8), and not Filament's own
   * answers (`@mem`, `/help`, a refusal — `meta.command`), which are about Filament rather than the conversation. The
   * transcript keeps them; no request carries them.
   * @param {string} chainId
   */
  const modelTurns = (chainId) => modelTurnsOf(archive().turnBodies(chainId), bootAt);
  /**
   * What the blocks of the sessions' turns weigh, kept across their compositions (`createBlockWeights`): a preview
   * composes a history again for every form and for its compactor's plan, each view and each turn composes it once
   * more, and a long chat's history is tens of thousands of tool calls and results. The turns are read from the archive
   * anew each time, every block a new copy, so a block is known by the archive's name for it (`contentName`) — one keeper
   * for the archive they are read from, whichever session reads them. After each composition it is cut back to
   * `weightsKept` blocks (`keepNamed`), those read longest ago first: a block under a summary or taken back, which no
   * composition reads again, before any the newest one read.
   * @type {{ a: any, weights: import("../../core/tokens.js").BlockWeights } | null}
   */
  let keptWeights = null;
  /**
   * The composer, weighing with the kept weights (`keptWeights`), cut back after it.
   * @param {Omit<Parameters<typeof compose>[0], "weights">} args
   */
  const composeKept = async (args) => {
    const a = archive();
    const weights = keptWeights && keptWeights.a === a ? keptWeights.weights : createBlockWeights((b) => a.contentName(b));
    keptWeights = { a, weights };
    try {
      return await compose({ ...args, weights });
    } finally {
      keepNamed(weights, weightsKept);
    }
  };
  /**
   * The loop's tool arguments for a session's document (Step 3 D7): the one derivation (`loopToolArgs`) the loop
   * itself uses, so the adapter rebuilds another window's calls against what the request will really carry — a team's
   * lead's when `lead` (HarnessV3-AtHome AH-O7). The
   * reader model is the loop's choice at turn time, so `delegate_read` is not declared here — another window's call
   * to it folds rather than ride a tool this request may not carry. MCP tools are discovered when the loop starts
   * and never appear here. `skill`: the chat's document as a turn's request is situated (`pluginsIn`), where the skill
   * tool is read from it.
   * @param {any} doc  the effective settings document
   * @param {{ lead: boolean, skill?: any }} o
   */
  const composeToolArgs = (doc, { lead, skill = null }) => {
    const al = loopConfig(config.get().agentLoop || {}, doc?.loop || null);
    const webDoc = doc?.plugins?.web || null;
    // The memory family passes through by name only (never rebuilt), so declaring it here keeps another window's
    // memory call from folding when the request carries it — memory-prepare attaches them to composed turns when
    // autopilot tools are on. Over-declaring is harmless: a name nobody called costs nothing.
    const memCfg = memory?.cfg?.() || {};
    const memTools = memory?.archive && memCfg.autopilot?.tools !== false
      ? memoryToolDefs("anthropic")
      : [];
    // The skill tool where the loop offers it (agent/turn.js `skillOn`): the session has it on, and the Library or the
    // plugins on hold a skill (the hunt of 11-08: a coding agent's turn that loaded one with Filament's tool folded).
    let skillOn = false;
    if (skill && !disabledTools(al.tools).includes(SKILL_TOOL_NAME))
      try {
        const s = loadSkills(skill);
        skillOn = s.skills.length + s.library.length > 0;
      } catch {
        // A folder that can't be read offers no skill tool here: the call folds, as the loop's turn would read none.
      }
    return [
      ...loopToolArgs({
        disabled: disabledTools(al.tools),
        web: webDoc ? { fetch: webDoc.fetch === true, search: webDoc.search === true } : null,
        // Memory gives the loop's every request the recall tool (memory-prepare.js).
        recall: !!memory?.archive,
        lead,
        // A lead's tools name its team's members.
        members: lead ? teamMembersOf(doc, teams) : null,
        graph: true,
        // A lead that reads along has its own worker and wait (HarnessV3-TaskGraph-v2 §12), and so has the agent with
        // its graph's sub-agents, its tasks too: the set the loop sends.
        supervise: readsAlong(doc),
        // The agent's browser, on the session's switch (HarnessV4_Browser_Plan BR-D5).
        browser: browserOffered(doc, disabledTools(al.tools)),
        // A harness chat's own agent may come back to it later (agent/come-back.js); a lead's chat goes on with its team.
        comeBack: !lead,
      }),
      ...memTools,
      ...(skillOn ? [SKILL_TOOL] : []),
    ];
  };
  /**
   * A coding agent's turn with each call of Filament's own tools by that tool's own name, as the loop has it
   * (`mcp__filament__checklist` → checklist): the adapter reads the rest in its own vocabulary.
   * @param {any} t
   */
  const filamentNamed = (t) => {
    /** @param {any} m */
    const bare = (m) => (Array.isArray(m?.content) && m.content.some((/** @type {any} */ b) => b?.type === "tool_use" && /^mcp__filament__/.test(String(b.name)))
      ? { ...m, content: m.content.map((/** @type {any} */ b) => (b?.type === "tool_use" ? { ...b, name: String(b.name).replace(/^mcp__filament__/, "") } : b)) }
      : m);
    return { ...t, user: bare(t.user), work: (t.work || []).map(bare), final: t.final ? bare(t.final) : t.final };
  };
  /**
   * The turns for one composition, another window's and the other engine's rebuilt (D7, HarnessV3-AtHome AH-O7):
   * translated to Anthropic and the tools in force when every call maps, folded as a whole when anything doesn't (the
   * composer's report says which). The harness's own turns made under the engine in force ride as stored — D6's rule:
   * the requesting window's turns never go through the adapter. Those the other engine made — the agent loop's under
   * a team's lead, a lead's under the loop — go through it with the tools they were made with, so a call passes by
   * name only to the very tool that took it: a write folds under a lead, and a sub-agent's launch folds either way.
   * A turn no engine stamped is the loop's: the harness runs on it. Who leads is draftEngine's answer, the one the
   * New Task board reads. The flags ride the turn's in-memory meta (`adapted`); nothing is written back to the archive.
   * A turn folded as a whole carries the same fold with its calls counted in one line too (`tallied`, shapes.js).
   * They are the turns of Filament's copy: the one a coding agent compacted its own context in the middle of, where
   * the copy starts from that summary, comes from the compaction on — cut first, as archived (`copyTurns`). The turns
   * rebuilt are the ones the copy sends under `compactions`: those past its summary. The rest come back as the archive
   * listed them, their messages unopened (HarnessV4_Tasks C29).
   * A coding agent's turn (its facts' `agentSession`, true or false where a coding agent ran it) was made with that
   * agent's tools, never the loop's: where the loop reads the composition (`loop`), it goes through the adapter too,
   * each call of Filament's own tools by that tool's own name, so the loop is sent only calls of its own tools — Bash as
   * its bash, the checklist as its plan — or the turn folds (the owner's of 11-08: a switch to the loop sent it the
   * agent's tool names as they were). Another agent's fresh session reads them as they ran.
   * @param {any[]} turns  finished, non-command turns (the composer's input)
   * @param {any} doc  the effective settings document
   * @param {any} chain  the session's chain: its key names the turns archived before the window stamps
   * @param {readonly any[]} compactions  the compactions the composition stands on; none reads every turn whole
   * @param {{ loop?: boolean }} [o]
   */
  const adaptForCompose = (turns, doc, chain, compactions, { loop = false } = {}) => {
    const lead = draftEngine(config.get(), String(doc?.model?.name || chain.model || "").trim(), sessionEngineOf(doc), teams, chain.kind === "team").kind === "team";
    const asTools = (/** @type {any[]} */ set) => set.map((d) => ({ name: d.name, schema: d.input_schema }));
    /** The chat's document as its turn's request is situated, the skills read from it — read when a turn needs it. */
    let situated;
    const skill = () => (situated ??= pluginsIn(doc, { project: chain.project_id, chat: chain.id, cwd: cwdOf(chain) }));
    /** The tools in force, derived when a turn needs them. @type {{ name: string, schema: any }[] | null} */
    let tools = null;
    /** The other engine's tools — what its turns were made with — derived when a turn needs them. @type {{ name: string, schema: any }[] | null} */
    let other = null;
    const now = lead ? "team" : "loop";
    /** A rebuilt turn's messages as a turn's parts. @param {any} t @param {any[]} messages */
    const parts = (t, messages) => {
      const [user, ...rest] = messages;
      let final = rest.length ? rest.pop() : null;
      // The adapter drops thinking-only messages; when what it dropped was the reply itself, the split must not
      // promote a tool result to the final. Without a final the body no longer ends with the assistant's reply, so
      // the composer folds the turn (its invalid-trajectory fallback) and says so — never a mis-split rendering.
      if (t.final && (!final || final.role !== "assistant")) final = null;
      return { user, work: rest, final };
    };
    // A turn the copy's summary stands for is not sent, so it is neither rebuilt nor opened.
    const { fromN } = copyWindow(turns, compactions);
    // The turns an import brought (sink.js `importedThrough`) were made with that agent's tools too, as a coding agent's
    // are here (the hunt of 11-08: a chat imported from Claude Code sent the loop its Read and Bash by Claude's names).
    const imported = Number(chain.meta?.importedThrough) || 0;
    return copyTurns(turns, compactions).map((t) => {
      if (t.n < fromN) return t;
      const win = t.meta?.window ?? Archive.turnWindow(t, { key: chain.key });
      const own = win === "harness" && (t.meta?.format ?? "anthropic") === "anthropic";
      // A coding agent's turn was made with that agent's tools whoever led it: its stamp (a team's, where the agent led
      // one as itself) names no engine of the loop's, so it crosses as a turn no engine stamped does.
      const agents = own && (typeof t.meta?.facts?.agentSession === "boolean" || t.n <= imported);
      const coder = loop && agents;
      const crossed = own && !coder && ((agents ? null : t.meta?.engine?.kind) ?? "loop") !== now;
      if (own && !crossed && !coder) return t;
      const r = adaptTurn(coder ? filamentNamed(t) : t, { format: "anthropic", tools: (tools ??= asTools(composeToolArgs(doc, { lead, skill: skill() }))), ...(crossed ? { madeWith: (other ??= asTools(composeToolArgs(doc, { lead: !lead, skill: skill() }))) } : {}) });
      if (!r.messages.length) return t;
      return { ...t, ...parts(t, r.messages), ...(r.tallied ? { tallied: parts(t, r.tallied) } : {}), ...(r.talliedBare ? { talliedBare: parts(t, r.talliedBare) } : {}), meta: { ...t.meta, adapted: r.mode, ...(r.mode === "folded" && r.reason ? { adaptedWhy: r.reason } : {}) } };
    });
  };
  /**
   * Whether the model of a composition that seeds no coding agent has filament_recall: one that takes no tools is
   * offered none (memory-prepare.js), so nothing composed for it names the tool, as for a coding agent that takes no MCP
   * tools (`seedOf`; the owner's of 11-09, D6). @param {any} cfg @param {string} model @returns {{ recall?: false }}
   */
  const recallOf = (cfg, model) => {
    const said = modelCapsFor(cfg, parseAgentModel(model)?.model || model)?.tools;
    return said && !said.available ? { recall: false } : {};
  };
  /**
   * The composer bound to one session's document and one request's shape: `compose` for the request itself, and
   * `measure` for the compactor — the same composition, answering only what the request would weigh, whole and per
   * turn (the compactor weighs every way of making room with it before it writes anything). `calib` names the model
   * whose learned estimator factor applies.
   * @param {any} chain @param {any} eff
   * `fixed` is what rides beside the body (`fixedOf`): the line, and the compactor's measure, weigh the whole request.
   * `asks`: the turn's message asks before room is made, so a composition past the line says so (compose.js).
   * `seed`: the form a fresh agent session's start carries the earlier turns in (`seedOf`), null for every turn whole.
   * @param {{ newUser: any, model: string, calib: string, window: number | null, maxTokens?: number, stream?: boolean, fixed?: number, agentHolds?: boolean, asks?: boolean, seed?: Formed | null }} o
   */
  const measuredCompose = (chain, eff, { newUser, model, calib, window, maxTokens = 0, stream = true, fixed = 0, agentHolds = false, asks = false, seed = null }) => {
    const cfg = config.get();
    const media = mediaWeights(cfg, calib);
    const args = { settings: eff, ...(seed || recallOf(cfg, model)), newUser, model, factor: calibFactorFor(cfg, calib), media, ...(maxTokens > 0 ? { maxTokens } : {}), stream, window, fixed, agentHolds, asks };
    /** @param {any[]} turns @param {any[]} compactions */
    const run = async (turns, compactions) => {
      // The PDFs it carries read first: every composition weighs what is sent of them, and counts their pages.
      if (media) await readPdfs({ messages: [...turns.flatMap(rawMessages), newUser] });
      return composeKept({ ...args, turns, compactions });
    };
    return {
      compose: run,
      /** @type {import("./compactor.js").MeasureFn} */
      measure: async ({ turns, compactions }) => {
        const c = await run(turns, compactions);
        return { sent: c.report.sentTokens + c.report.fixedTokens, earlier: c.report.earlierTokens, perTurn: c.report.turns.map((t) => ({ n: t.n, tokens: t.tokens })) };
      },
    };
  };
  /** The form a fresh agent session carries the earlier turns in, as the session chose it: Words unless chosen. @param {any} eff */
  const carryOf = (eff) => (CARRY_FORMS.includes(eff.context?.carry) ? String(eff.context.carry) : "words");
  /**
   * A form of the earlier turns and the result policy with it: the form's own (`RESULTS_BY_FORM`) unless a layer chose
   * `context.results`.
   * @typedef {{ form: string, results: string, recall?: boolean }} Formed
   * @param {string} form @param {any} eff @param {{ sources: Record<string, string> }} settings @returns {Formed}
   */
  const formed = (form, eff, settings) => ({
    form,
    results: settings.sources["context.results"] !== "default" ? String(eff.context?.results || "keep") : RESULTS_BY_FORM[/** @type {keyof typeof RESULTS_BY_FORM} */ (form)] || "keep",
  });
  /**
   * The form a coding agent's session is composed in (HarnessV4_Tasks U3-7, UX-12). The agent keeps its own history,
   * so Filament's composition only seeds a fresh agent session — a switch into the agent, a start after Filament's
   * compaction or after its session was lost — and what that start carries of the earlier turns is its own choice
   * (`context.carry`, Words unless chosen). Another engine's session sends every turn whole (null). `form`: this
   * turn's own, where a switch chose one (HarnessV4_Tasks A7).
   * @param {any} eff @param {{ sources: Record<string, string> }} settings @param {string | null} agentUp
   * @param {string | null} [form]
   * @returns {Formed | null}
   */
  const seedOf = (eff, settings, agentUp, form = null) =>
    agentUp
      ? {
          ...formed(form && CARRY_FORMS.includes(form) ? form : carryOf(eff), eff, settings),
          // An agent that takes no MCP tools has no filament_recall: its counts say to re-run a tool (the review of 8bcb358fc).
          ...(agentTakesMcp && agentTakesMcp(agentUp) === false ? { recall: false } : {}),
        }
      : null;
  /**
   * Why the agent's session of the chat is gone by the person's own act, where it is: the chat moved to another folder
   * since the agent's last turn — its sessions are by folder — a Compact now since or not, or they rewound turns it
   * answered and none of its turns ran since. Its fresh session is the same agent on the same model, handed the turns
   * whole (`lostFormOf`; the hunt of carry-move: a Compact now after the move, or a rewind, seeded the session's Words).
   * @param {any} meta  the chat's @param {string | null} agentUp @param {readonly any[]} all  the chat's turns, rewound ones among them
   * @param {readonly any[]} viewed  those the model reads (`modelTurnsOf`) @returns {"move" | "rewind" | null}
   */
  const lostBy = (meta, agentUp, all, viewed) => {
    if (!agentUp) return null;
    const last = viewed.at(-1);
    const seen = Number(last?.n) || 0;
    if (all.some((t) => !!t.meta?.rewound && t.n > seen && t.meta?.facts?.upstream === agentUp)) return "rewind";
    return last?.meta?.facts?.upstream === agentUp && movedSince(meta, last?.n) ? "move" : null;
  };
  /**
   * The form a lost session's fresh one carries: the turns whole, what the lost one held (the owner's word of 11-06),
   * unless a layer chose a form (`context.carry`).
   * @param {any} settings @param {any} eff
   */
  const lostFormOf = (settings, eff) => (settings.sources["context.carry"] !== "default" ? carryOf(eff) : "plain");
  const compactor = createCompactor({ memory, config, ops, log, subagents, speedOf: (model) => records?.speedOf?.(model) || null, timeOf: (model, kind) => records?.callTimeOf?.(model, kind) || null, teams, graphKept, graphWhere, stillOpen, skillsLoaded: (id) => skillsLoaded(id), now });
  /**
   * How a coding agent's session makes room now (HarnessV3-ACP AC5-3 to AC5-5): the session's way — `chosen`, for this
   * once — with the agent as the summary's writer where that way is Self (the agent writing Filament's summary of the
   * session it holds open), whether the agent writes one now (`writes`: in a fork of its session, or in the session),
   * and whether it compacts that session its own way (`owns`: keeping a fork of it from before, for Undo, or not).
   * @param {any} eff @param {import("./agent-line.js").AgentHeld | null} at @param {import("../agent-self.js").AgentSessionRef} ref
   * @param {string} model  the session's @param {"own" | "self" | "ours" | null} [chosen]
   */
  /**
   * The cache of a model Filament calls as a session's next message is sent (HarnessV4_Tasks C26; cache-clock.js), from
   * the session's newest turn the model reads (`last`). By the request the loop keeps warm while one is there (a later
   * read of it renews its life), else by what that turn's replies read and wrote of the provider's cache, for the
   * life its writes had (`writtenTtlMs`) — a lifetime chosen since moves only the next turn's — else the one its
   * markers asked for: the chat's, else the route's rules'. Null where another model or upstream answered that turn: the
   * cache is not this model's to go on in — and where that turn's usage said no cache numbers (core/cache-facts.js)
   * and no kept request says otherwise: nothing says there is a cache, or that there is none.
   * @param {{ id: string }} chain @param {any} cfg @param {string} model  the session's, its engine prefix aside
   * @param {any} last @param {unknown} [chose]  the chat's `model.cacheTtl`, which a turn's markers ask for over the rules'
   */
  const modelCache = (chain, cfg, model, last, chose = null) => {
    const facts = last.meta?.facts || null;
    const r = findRoute(cfg, model);
    const wire = r ? renderUpstreamModel(r.upstreamModel, model, r.captures || []) || model : null;
    // A turn of Filament's loop says its upstream is the loop's own (`agent-loop`, agent/turn.js): its requests went by
    // the model's route. Read as anything else, no loop chat ever had a cache to ask about.
    const via = facts?.upstream === "agent-loop" ? r?.upstream : facts?.upstream;
    if (!facts || !r || via !== r.upstream || !(sameModel(cfg, facts.model, wire) || sameModel(cfg, facts.model, model))) return null;
    const kept = subagents?.cacheOf(chain.id) || null;
    const live = kept && kept.state !== "none" && sameModel(cfg, kept.model, model) ? kept : null;
    const t = facts.tokens || {};
    if (!cacheSaid(t) && live?.state !== "warm" && live?.state !== "cold") return null;
    return cacheClock({
      endedAt: endedAtOf(last),
      ttlMs: live?.ttlMs || writtenTtlMs(t) || ttlMsOf(chose === "5m" || chose === "1h" ? chose : routeCacheTtl(cfg, model)),
      now: now(),
      cached: live ? live.state !== "uncached" : (Number(t.cacheRead) || 0) + (Number(t.cacheWrite) || 0) > 0,
      leftMs: live?.state === "warm" ? live.leftMs : null,
    });
  };
  /**
   * What the model that answered the chat's last turn — its newest but a coding agent's own, as a switch reads it — can
   * write before the chat moves on to another (the owner's of 11-08: a switch's card offers a handoff): Filament's
   * summary by the loop's model, from its cache while it is warm; a coding agent's written in the session it holds
   * (`self`). Always Filament's summary, the head the copy starts from: an agent's own compaction is none — it hands a
   * summary over only where its agent says one and its session held the whole chat (the review of fd62160df). What
   * `compact` takes with `by: "last"`. Null where it can write none: no turn since the newest compaction, no turn
   * naming its model, the model switched to (`to`) itself, a model no route reaches, an agent holding no session of the
   * chat open that writes one — and where its summary would leave the chat no smaller (`handoffShrinks`).
   * @param {any} chain @param {any} cfg @param {any} settings  the session's, as the turn reads them
   * @param {any[]} all  the chat's turns, every one @param {any[]} turns  the chat's turns the model reads
   * @param {any[]} compactions @param {string} cwd @param {string} to  the model the chat moves to
   * @returns {Promise<import("./switch-question.js").Handoff | null>}
   */
  const handoffOf = async (chain, cfg, settings, all, turns, compactions, cwd, to) => {
    const head = compactionHead(compactions);
    if (!turns.some((t) => t.n > (head ? Number(head.to_turn) : 0))) return null;
    const last = turns.findLast((t) => !t.meta?.own) || turns.at(-1);
    const name = String(last?.model || "").trim();
    if (!name || sameModel(cfg, name, to)) return null;
    const inner = parseAgentModel(name)?.model || name;
    const up = agentSessionOf(cfg, inner);
    if (up) {
      const found = findUpstream(cfg, up);
      const ref = { upstream: up, chainId: chain.id, cwd, base: basesOf(compactions, turns).of(up) };
      if (!agentSelf?.how(ref)) return null;
      if (!(await handoffShrinks(chain, cfg, settings, all, turns, compactions, name, null))) return null;
      return { way: "self", by: found ? agentTitle(found) : up, cache: cacheClock({ endedAt: endedAtOf(last), ttlMs: AGENT_CACHE_MS, now: now() }) };
    }
    // Its route by the model's own name, the effort the turn ran at aside, as the turn's own went (the hunt of 11-08: a
    // turn at an effort names "m-1-high", which no route of "m-1" matched); its cache is read by that name too.
    const base = parseModelSuffix(inner, cfg.rules).base;
    const routed = findRoute(cfg, base) ? base : findRoute(cfg, inner) ? inner : null;
    // Nor one no upstream of its route can answer now: its press would fail after the call (the hunt of 11-08).
    if (!routed || upstreamsOffProblem(cfg, routed)) return null;
    if (!(await handoffShrinks(chain, cfg, settings, all, turns, compactions, name, { writer: "session" }))) return null;
    return { way: "summary", by: inner, cache: modelCache(chain, cfg, routed, last, settings.effective.model?.cacheTtl) };
  };
  /**
   * Whether a switch's handoff would make the chat smaller (the owner's of 11-09: on a short chat the model that
   * answered last wrote its summary, and the compactor refused it after the call as leaving the chat no smaller — the
   * tokens spent, and the card back): the plan `compact` weighs with `by: "last"` — the chat as that model's session,
   * its writer the handoff's (`once`) —, its summary's figure under what the chat holds now, the compactor's own
   * refusal turned round. What fails to weigh offers none, said in the log.
   * @param {any} chain @param {any} cfg @param {any} settings @param {any[]} all @param {any[]} turns  the turns the model reads
   * @param {any[]} compactions @param {string} name  the model that answered last
   * @param {{ writer: string } | null} once
   */
  const handoffShrinks = async (chain, cfg, settings, all, turns, compactions, name, once) => {
    try {
      const eff = onceDoc({ ...settings.effective, model: { ...settings.effective.model, name } }, once);
      const inner = parseAgentModel(name)?.model || name;
      const window = (inner && sessionWindowFor(cfg, inner, eff.model?.window).tokens) || null;
      const agentUp = agentSessionOf(cfg, inner);
      const lostTo = lostBy(chain.meta, agentUp, all, turns);
      const w = measuredCompose(chain, eff, { seed: seedOf(eff, settings, agentUp, lostTo ? lostFormOf(settings, eff) : null), newUser: { role: "user", content: [{ type: "text", text: "" }] }, model: name, calib: inner, window, fixed: await fixedOf(chain, eff) });
      const at = agentUp && !lostTo ? agentHeld({ turns, compactions, upstream: agentUp, window }) : null;
      const p = await compactor.plan({ chain, doc: eff, turns: adaptForCompose(turns, eff, chain, compactions), compactions, sessionModel: inner, window: at?.window ?? window, measure: w.measure, root: loopRootOf(chain), ...(at ? { held: at.held } : {}) });
      // One no writer could make is not offered either — the compactor would refuse it at the press; the agent's own
      // summary needs no writer of Filament's, as compact's selfCan reads it.
      const s = p.methods.summary;
      if (!(s.possible || (once == null && s.status === 400))) return false;
      return s.after < p.now;
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: ${chain.id}: a switch's handoff by ${name} was not weighed, and is not offered (${e?.message || e})`);
      return false;
    }
  };
  const agentRoom = (eff, at, ref, model, chosen = null) => {
    const writes = agentSelf?.how(ref) || null;
    const self = writes ? agentSelf : null;
    const owns = agentSelf?.compacts(ref) || null;
    const way = agentWay(chosen || compactionSettingsOf(eff).agent, { warm: !!at && now() - at.endedAt < AGENT_CACHE_MS, self: !!self, own: !!owns });
    /** @type {import("./compactor.js").SelfWriter | null} */
    const writer = self && way.way === "self" ? { model, write: (instruction, signal) => self.write({ ...ref, instruction, signal }) } : null;
    return { way, writer, owns, writes };
  };
  /**
   * What the page shows of a coding agent's session's compaction (HarnessV3-ACP AC5-8): the session's way
   * (`chosen`), and the way Compact now takes as `compact` takes it — the session's where Filament weighs what the
   * agent holds (`weighed`), else Filament's methods on its copy — and whether the suggestion chose it; the ways the
   * agent has now, for this once (`own`, `self`: forked or in its session, as `agentRoom` says; `opens`: its session is
   * opened again first); until when its cache
   * is warm (`warmUntil`, ms since the epoch: the suggestion's Self turns Ours then); and what it holds of its window,
   * past the line or not — nothing (`unsaid`) after its own compaction that named no figure after it. `share`: its own
   * prompt and tools, which it holds beside whatever a way of Filament's leaves (HarnessV4_Tasks C33); null where no
   * turn has measured it.
   * @param {any} eff @param {import("./agent-line.js").AgentHeld | null} at @param {import("../agent-self.js").AgentSessionRef} ref
   * @param {string} model  the session's
   * @param {number | null} share
   */
  const agentPlan = (eff, at, ref, model, share) => {
    const room = agentRoom(eff, at, ref, model);
    const chosen = compactionSettingsOf(eff).agent;
    const way = at ? room.way.way : "ours";
    return {
      chosen,
      way,
      suggested: way !== chosen,
      weighed: !!at,
      own: room.owns,
      self: room.writes,
      // No process holds the chat's session now (a restart, an idle agent let go), or the agent lost it under a prompt:
      // a way of the agent's own opens it again first (HarnessV4_Tasks C33).
      opens: !!(room.owns || room.writes) && agentSelf?.closed(ref) === true,
      share,
      warmUntil: at ? at.endedAt + AGENT_CACHE_MS : 0,
      held: at && !at.unsaid ? at.held : null,
      window: at?.window ?? null,
      estimated: !!at?.estimated,
      unsaid: !!at?.unsaid,
      over: !!(at && agentLine(at, eff.context?.compaction)?.over),
    };
  };
  /**
   * The agent's own compaction of a session (HarnessV3-ACP AC5-5), through the compactor: `ref` names the agent's chat.
   * It is said while it runs as Filament's own writing is (HarnessV4_Tasks U3-5) — who compacts, and its summary as it
   * streams it — through `door`; null where its events are drawn elsewhere (a typed `/compact`'s turn draws them).
   * `stoppable` where `stopCompaction` can stop it.
   * @param {Omit<Parameters<typeof compactor.own>[0], "agent"> & { ref: import("../agent-self.js").AgentSessionRef, door: "line" | "manual" | null, stoppable?: boolean }} o
   */
  const ownCompaction = async ({ ref, door, stoppable = false, ...o }) => {
    const agent = /** @type {NonNullable<typeof agentSelf>} */ (agentSelf);
    const progress = door ? compactionJob(o.chain.id, door, { own: true, stoppable }) : null;
    progress?.onStep({ message: `${agentTitle(findUpstream(config.get(), ref.upstream) || { id: ref.upstream })} compacts its own session` });
    try {
      return await compactor.own({
        ...o,
        by: agentTitle(findUpstream(config.get(), ref.upstream) || { id: ref.upstream }),
        blockAfter: (toTurn) => blockAfterOwn(o.chain.id, toTurn),
        onEvent: (ev) => {
          progress?.onAgent(ev);
          o.onEvent?.(ev);
        },
        agent: (ask) => agent.compact({ ...ref, ...ask }),
      });
    } finally {
      progress?.end();
    }
  };
  /**
   * The agent's own compaction running for a session, asked on request (AC5-5): a turn sent meanwhile goes to the very
   * session it compacts, so it waits for it to end (`turn`), then composes from what it left. @type {Map<string, Promise<void>>}
   */
  const owning = new Map();
  /**
   * The writer of a summary that stands for part of a history — /autofit's cut, a fork's brief: the compactor's choice
   * under the document, weighed by the transcript it will read. Never a fork of the warm cache, which holds the whole
   * window, not the part. Refuses when nothing can write one.
   * @param {any} eff @param {string} inner the session's model @param {(string | null)[]} transcript the transcript's parts
   */
  const summaryWriter = (eff, inner, transcript) => {
    const tokens = estimateTokens(transcript.filter(Boolean).join("\n\n"));
    const w = compactor.writerFor({ doc: eff, sessionModel: inner, cache: null, transcriptTokens: tokens, outTokens: summaryEstimate(tokens, []) });
    if (!w.chosen) throw refusal(400, w.error || "no model to summarize with: set model.name or context.compaction.model");
    return { ...w.chosen, fork: false };
  };
  /**
   * The session's working folder: a fork checked out into a worktree works there (the rewind is the point of it);
   * otherwise the folder the chain remembers as its own, else its project's — a chat in a worktree stands in the main
   * folder's project and works in its worktree (HarnessV4_Git_Plan GW-D46, GW-D47).
   * @param {any} chain
   */
  const cwdOf = (chain) => {
    if (chain.meta?.tree?.worktree) return String(chain.meta.tree.worktree);
    if (typeof chain.meta?.cwd === "string" && chain.meta.cwd) return chain.meta.cwd;
    const project = chain.project_id ? archive().getProject(chain.project_id) : null;
    return String(project?.cwd || "");
  };
  /**
   * Why the chat cannot move to another place now, in words (HarnessV4_Git_Plan GW-D83); null when it can: no turn of
   * it runs, none of its helpers works, no question waits for an answer — its answer would go on in the old folder.
   * @param {any} chain
   */
  const busyOf = (chain) => {
    const held = sessionTurns?.holder(chain.key) || null;
    if (held?.window === MOVE_WINDOW) return "the chat is moving already";
    if (held || liveTurns.has(chain.id)) return "a turn of this chat runs";
    if (subagents?.atWork?.().includes(String(chain.id))) return "a helper of this chat is at work";
    if ((agentTasks?.(chain.id) || []).some((/** @type {any} */ t) => AGENT_WORK.has(t.kind))) return "its coding agent's own agents are at work";
    if (pausedNow(chain)) return "a question waits for your answer";
    return null;
  };
  const chatMove = createChatMove({ memory, config, sessionTurns, cwdOf, busyOf, log, now, copies, templateOf: (place) => worktreeTemplate(place).copy });
  /**
   * The folder the agent loop works in for this session, judged and resolved as the loop judges it (`folderVerdict`):
   * where what comes back after a summary is read from (HarnessV3-AtHome AH-D9 b). "" for a session Filament does not
   * run, or a folder the loop would refuse — nothing is read from it.
   * @param {any} chain
   */
  const loopRootOf = (chain) => {
    if (!chain.meta?.native) return "";
    const v = folderVerdict(config.get(), cwdOf(chain));
    return v.ok ? v.root : "";
  };
  /**
   * What the agent loop sends beside the history on every request of this session: its system prompt and tool
   * schemas, the loop's window event's `fixed` (HarnessV3-Tools TL-D9). Weighed the way the New Task board weighs a
   * draft (`startAnatomy`), with the Environment the session froze on its first turn — the app's capture when it has
   * none yet — and its MCP servers' tools (`mcpWeightOf`). 0 for a session the loop does not run. The folder is
   * resolved as the loop resolves its root, links and junctions followed. A network share the folder rules keep out
   * (`shareKeptOut`) is never asked: the loop refuses a turn there, so nothing of its rides beside the history, and
   * nothing is read from the folder to weigh it.
   * @param {any} chain @param {any} eff  the session's effective settings
   */
  const loopFixedOf = async (chain, eff) => {
    if (shareKeptOut(config.get(), cwdOf(chain))) return 0;
    const cwd = realFolder(cwdOf(chain));
    const env = storedEnvironment(chain.meta?.environment, cwd) || (environment ? await environment(cwd).catch(() => null) : null);
    return startAnatomy({ cfg: config.get(), eff: pluginsIn(eff, { project: chain.project_id, chat: chain.id, cwd: cwdOf(chain) }), cwd, projectId: chain.project_id, spaceMade, memory, modelProblem, environment: env, teams, modelsOf: (members, lead) => subagents?.modelsOf?.(chain.id, members, lead) ?? null }).loopFixed + mcpWeightOf(chain, eff);
  };
  /**
   * What rides beside the composed history on this session's next request (HarnessV3-Launch LD-D6): the loop's part
   * on a session Filament runs; nothing on a client's (its client sends its own prompt and tools, which Filament does not
   * weigh). The one rule the line, the preview, the map and /autofit share.
   * @param {any} chain @param {any} eff
   */
  const fixedOf = async (chain, eff) => (chain.meta?.native ? await loopFixedOf(chain, eff) : 0);
  /**
   * What the session's MCP servers add to every request — their tools and the prompt's sentence naming them
   * (HarnessV3-Tools TL-D22): as the newest turn that connected them measured it (`meta.mcpWeight`, each server's
   * share), for the servers the session still has, unchanged. A server no turn has connected yet weighs nothing here —
   * its tools are known only once the loop connects it. A session a team leads adds it as well: its lead carries the
   * servers as any agent does (HarnessV4_Tasks decision 9; HarnessV3-AtHome P2 kept them its workers'). The servers of
   * its plugins on count as yours (B3).
   * @param {any} chain @param {any} given  the session's effective settings
   */
  const mcpWeightOf = (chain, given) => {
    const eff = pluginsIn(given, { project: chain.project_id, chat: chain.id, cwd: cwdOf(chain) });
    const keys = new Set((Array.isArray(eff?.plugins?.mcp) ? eff.plugins.mcp : []).filter((m) => m && typeof m === "object").map((m) => specKey(m)));
    return (Array.isArray(chain.meta?.mcpWeight) ? chain.meta.mcpWeight : []).reduce((n, w) => n + (keys.has(String(w?.key)) ? Number(w?.tokens) || 0 : 0), 0);
  };
  /**
   * The compaction that can still be undone (HarnessV3-Compaction §3.3, "until the next message is sent"): the
   * session's newest, when Filament's harness wrote it and no turn has started since — a failed try's retry starts its
   * turn again, and is answered from it too (archive `lastStartedAt`). A fork's brief, or its folded
   * inheritance, is how it began, not a compaction to take back. A compaction at a turn's start
   * is past undoing the moment that turn starts — the turn was answered from it. One a coding agent made of its own
   * context in the middle of a turn is the agent's, in a session that went on from it: nothing takes it back. A
   * summary Filament wrote for its copy alone (`detail.copy`) is not in the count: it moved no session, so the
   * compaction before it can still be taken back. The row, or null.
   * @param {string} chainId
   */
  const undoableCompaction = (chainId) => {
    const rows = compactionsOf(chainId).filter((c) => !c.detail?.copy);
    const newest = rows.reduce((/** @type {any} */ best, c) => (!best || Number(c.id) > Number(best.id) ? c : best), null);
    if (!newest || newest.window !== "harness" || newest.kind === "brief" || newest.kind === "fork" || madeDuring(newest) != null) return null;
    return archive().lastStartedAt(chainId) > Number(newest.created_at) ? null : newest;
  };
  /**
   * Compaction rows with the whole summary text (the composer prepends it; a cap would cut the summary), and what came
   * back after it — the files and plan a summary's row carries (HarnessV3-AtHome AH-D9 b) — as the text the head
   * sends. A fold compaction's row has none: it marked turns instead. A row of door `now` is a preview no
   * window adopted: it is archived to be read, and is no compaction here (HarnessV3-Launch RD-D4). Each text is opened when it is first read (core/lazy.js): a session's whole history of compactions is
   * listed, and the head's summary is the one a composition reads.
   * @param {string} id
   * @returns {{ from_turn: number, to_turn: number, kind: string, method?: string | null, text: string | null, attached: string | null, [k: string]: any }[]}
   */
  const compactionsOf = (id) => {
    // A summary written before a rewind that took a turn it stands for stands no more: it, and what came back after it
    // — the agent's reply that ended its turns among them — would tell the agent of work the person took back. The
    // turns before the rewind come whole, or after an older summary; an Undo of the rewind brings it back. One written
    // after the rewind read the turns that stood then, and stands.
    const rewound = archive().rewoundOf?.(id) || [];
    const undone = (/** @type {any} */ c) => {
      const from = Number(c.from_turn) || 1;
      const to = Math.max(Number(c.to_turn) || 0, madeDuring(c) ?? 0);
      return rewound.some((r) => r.n >= from && r.n <= to && r.at >= (Number(c.created_at) || 0));
    };
    return archive()
      .getCompactions(id)
      .filter((c) => c.detail?.door !== "now" && !undone(c))
      .map((c) => {
        /** A stored message's text, or null where the row names none. @param {string | null | undefined} hash */
        const textAt = (hash) => {
          const m = hash ? archive().getMessage(hash) : null;
          return m ? textOfMessage(m.message) : null;
        };
        return lazy(lazy({ ...c }, "text", () => textAt(c.summary_hash)), "attached", () => textAt(c.detail?.attached?.hash));
      });
  };

  /** The knob catalogue the editors draw from: every knob's type, default, phase, liveness and own words. */
  function knobCatalog() {
    return Object.fromEntries(Object.entries(KNOBS).map(([path, k]) => [path, { type: k.type, default: k.default, phase: k.phase, live: k.phase <= BUILT_PHASE, doc: k.doc, ...(k.options ? { options: k.options } : {}), ...(k.nullable ? { nullable: true } : {}), ...(k.scope ? { scope: k.scope } : {}), ...(k.reach ? { reach: k.reach } : {}) }]));
  }

  /**
   * What every reading of a session's settings starts from: its layers resolved — the whole settings answer
   * (`settingsOf`) and the transcript's few fields both build on it.
   * @param {any} chain  the session's chain, as read
   */
  function settingsBase(chain) {
    return { resolved: /** @type {import("../../services/session-settings.js").Resolved} */ (resolveChainSettings(archive(), config.get(), chain.id)) };
  }

  /**
   * The three layers resolved for a session: the global config in the document's vocabulary, the project's
   * `settings_json`, the chain's `settings_json`.
   * @param {string} id
   */
  function settingsOf(id) {
    const chain = chainOf(id);
    const { resolved } = settingsBase(chain);
    return {
      chainId: chain.id,
      projectId: chain.project_id || null,
      native: !!chain.meta?.native,
      ...resolved,
      knobs: knobCatalog(),
      builtPhase: BUILT_PHASE,
      usage: usageOf(chain, teamsSpendOf(archive(), chain.id)),
      window: windowOf(chain, resolved.effective),
      price: priceOf(chain, resolved.effective),
      cache: cacheSettingOf(chain, resolved.effective),
      engine: engineOf(chain, resolved.effective),
      rulesInForce: rulesInForceOf(chain, resolved),
    };
  }

  /**
   * The document a session runs under, its layers resolved — `settingsOf(id).effective`, refused as `settingsOf` refuses
   * a session the archive does not hold — without the rest of the Settings page's answer: its catalogues, the rules in
   * force read off the project's list, the teams, the price. What reads a knob or two asks this:
   * a sub-agent's tool round, a poll of the chat's agents, a graph task's end.
   * @param {string} id
   */
  function effectiveOf(id) {
    const resolved = resolveChainSettings(archive(), config.get(), String(id || ""));
    if (!resolved) throw new Error("no such session");
    return resolved.effective;
  }

  /**
   * The rules in force for a session, as the composer's permission switch lists them (HarnessV3-AtHome AH-D7): the
   * written `loop.rules` in the order the gate reads them (first match wins), each from the layer the list comes from,
   * then what Always allow remembered — the project's confirmed permissions, each once (its mirror on the project's
   * list is the same rule). Before them the chat's own (d-allow): the commands it keeps always allowed for the folder
   * it works in now — one kept for another folder runs nothing here, and is listed when the chat is back there.
   * `privacy.bashDeny` is a privacy setting, not a remembered rule, and stays on its knob; the
   * review rules `loop.secondLook` stands for are its switch's, which Settings › Permissions says (SG-D13).
   * @param {any} chain @param {import("../../services/session-settings.js").Resolved} resolved
   * @returns {RuleInForce[]}
   */
  function rulesInForceOf(chain, resolved) {
    const layer = /** @type {"session" | "project"} */ (resolved.sources["loop.rules"]);
    const kept = keptOf(chain.meta?.[ALWAYS_RUN]);
    const here = kept.length ? folderIs(cwdOf(chain)) : null;
    /** @type {RuleInForce[]} */
    const out = [
      ...kept.filter((k) => here?.(k.folder)).map((k) => ({ tool: k.hand, pattern: k.command, verdict: /** @type {const} */ ("allow"), from: /** @type {const} */ ("chat") })),
      ...rulesFrom({ loop: resolved.effective.loop }).filter((r) => !r.shipped).map((r) => ({ tool: r.tool, pattern: r.pattern, verdict: r.verdict, from: r.learned ? /** @type {const} */ ("learned") : layer })),
    ];
    const listed = (/** @type {string} */ tool, /** @type {string} */ pattern) => out.some((r) => r.from === "learned" && r.tool === tool && r.pattern === pattern);
    const confirmed = chain.project_id ? archive().items.list({ projectId: chain.project_id, kind: "permission", status: "confirmed", limit: 500 }) : [];
    for (const it of confirmed) {
      const p = permissionOf(it.text);
      if (p && !listed(p.tool, p.shape)) out.push({ tool: p.tool, pattern: p.shape, verdict: "allow", from: "learned" });
    }
    return out;
  }

  /**
   * Forget one rule in force (HarnessV3-AtHome AH-D7), as the permission switch's Forget asks; the gate asks again next
   * time. What Always allow remembered is dismissed through memory's owner word — kept with its history, never deleted —
   * and its mirror leaves the project's list; a written rule leaves the layer it came from, and a list it empties is
   * unset, so the layers below speak again; a command the chat keeps always allowed (d-allow) leaves its meta, which
   * each verdict reads: it asks again at the turn's next request. `verdict` and `from`, when given (the page sends the
   * row as listed), narrow it to that row.
   * @param {string} id @param {{ tool: string, pattern: string, verdict?: string | null, from?: string | null }} rule
   */
  async function forgetRule(id, { tool, pattern, verdict = null, from = null }) {
    const chain = chainOf(id);
    if (verdict != null && !RULE_VERDICTS.includes(verdict)) throw refusal(400, `verdict is ${RULE_VERDICTS.join(", ")}, not "${verdict}"`);
    if (from != null && !["session", "project", "learned", "chat"].includes(from)) throw refusal(400, `from is session, project or learned, or chat for a command the chat keeps always allowed, not "${from}"`);
    const named = (/** @type {any} */ r) => r && r.tool === tool && r.pattern === pattern && (verdict == null || r.verdict === verdict);
    const hits = settingsOf(chain.id).rulesInForce.filter((r) => named(r) && (from == null || r.from === from));
    if (!hits.length) throw refusal(404, `no rule ${tool}(${pattern})${verdict ? ` ${verdict}` : ""} is in force for this session`);
    const learned = hits.some((r) => r.from === "learned");
    if (learned && chain.project_id) await takeBackPermission(chain.project_id, { tool, pattern }, { chain: chain.id, from: "the permission switch" });
    // What is left on the layers: the written rows named, and a learned entry no confirmed item stands behind any more.
    for (const at of /** @type {const} */ (["session", "project"])) {
      const stored = at === "session" ? archive().chainSettings(chain.id) : chain.project_id ? archive().projectSettings(chain.project_id) : null;
      const list = Array.isArray(stored?.loop?.rules) ? stored.loop.rules : [];
      const leaves = (/** @type {any} */ r) => named(r) && (r.learned === true ? learned : hits.some((h) => h.from === at));
      if (!list.some(leaves)) continue;
      const left = list.filter((/** @type {any} */ r) => !leaves(r));
      const change = left.length ? { patch: { loop: { rules: left } } } : { unset: ["loop.rules"] };
      const w = at === "session" ? memory.patchSessionSettings(chain.id, change, { via: "forget" }) : viaMemory(() => memory.patchProjectSettings(chain.project_id, change));
      if (w.errors.length) throw refusal(400, w.errors.join("; "), { errors: w.errors });
    }
    // The chat's own: the command of that hand kept for the folder the chat works in, which is the one listed.
    const mine = hits.filter((r) => r.from === "chat");
    if (mine.length) {
      const folder = cwdOf(chain);
      archive().updateMeta(chain.id, (meta) => {
        const left = mine.reduce((kept, r) => withoutKept(kept, { command: r.pattern, hand: r.tool, folder }), keptOf(meta[ALWAYS_RUN]));
        if (left.length) meta[ALWAYS_RUN] = left;
        else delete meta[ALWAYS_RUN];
      });
    }
    return { ok: true, forgot: hits, ...writeAnswer(settingsOf(chain.id)) };
  }

  /**
   * What Always allow remembered in a project, taken back: its confirmed permission items dismissed through memory's
   * owner word — kept with their history, never deleted — which takes the rule's mirror off the project's list too.
   * @param {string} projectId @param {{ tool: string, pattern: string }} rule @param {{ chain?: string, from: string }} o
   */
  async function takeBackPermission(projectId, { tool, pattern }, { chain, from }) {
    const items = archive().items.list({ projectId, kind: "permission", status: "confirmed", limit: 500 }).filter((it) => {
      const p = permissionOf(it.text);
      return p && p.tool === tool && p.shape === pattern;
    });
    if (!items.length) return;
    if (!memory.isOpen?.()) throw refusal(503, "memory has not started: what Always allow remembered is forgotten through it — try again when it has");
    const owner = memory.scope({ role: "owner", ...(chain ? { chain } : { project: projectId }) });
    for (const it of items) await owner.setStatus(it.id, "dismissed", { reason: `forgotten from ${from}: the gate asks again` });
  }

  /**
   * Stop one task the chat's coding agent runs beside its work (HarnessV4_Tasks E6): a sub-agent its agent lets Filament
   * stop alone — a background one working on after its turn, or one under a turn that goes on. Its end comes as the
   * agent says it, in the tasks' list on the events feed.
   * @param {string} id @param {string} taskId
   */
  function stopAgentTask(id, taskId) {
    const chain = chainOf(id);
    const r = agentTaskStop ? agentTaskStop(chain.id, String(taskId)) : { ok: false, why: "no coding agent runs this chat's tasks" };
    if (!r.ok) throw refusal(409, `not stopped: ${r.why}`);
    return { ok: true };
  }

  /**
   * Always allow in this project, chosen where the agent asks (HarnessV4_Tasks E3, decision 8): the call's shape — a
   * command's head (`npm test`), a kind of file — runs without asking in the chat's project from now on. The offer
   * waiting for the shape is confirmed, or one is made and confirmed, through memory's owner word as the Memory page
   * confirms one; its rule then stands on the project's list, and the permission switch lists it with its Forget.
   * @param {string} id @param {{ tool: unknown, shape: unknown }} o  the offer the call's question carried
   */
  async function alwaysAllow(id, { tool, shape }) {
    const chain = chainOf(id);
    const text = shapeText(tool, shape);
    if (!text) throw refusal(400, `tool and shape are the always-allow a call's question offers — bash and a command's head (npm test), or write or edit and a kind of file (*.md) — not ${JSON.stringify(tool)} and ${JSON.stringify(shape)}`);
    const projectId = chain.project_id && chain.project_id !== "none" ? String(chain.project_id) : null;
    if (!projectId) throw refusal(409, "this chat is in no project, and an always-allow is kept for a project");
    if (!memory.isOpen?.()) throw refusal(503, "memory has not started: Always allow is kept through it — try again when it has");
    const made = archive().items.add({ projectId, chainId: chain.id, kind: "permission", text, status: "inferred", importance: 0.8, origin: "owner" });
    const owner = memory.scope({ role: "owner", chain: chain.id });
    const ref = `i${made.id}`;
    const was = owner.claim(ref);
    if ("error" in was) throw refusal(500, `the always-allow for "${text}" could not be read back: ${was.error}`);
    if (was.status !== "confirmed") {
      if (isRetired(was.status)) await owner.setStatus(made.id, "confirmed", { reason: "Always allow in this project, where the agent asked" });
      else await owner.confirm(ref);
    }
    const now = owner.claim(ref);
    const rule = "error" in now ? null : mirrorLearnedRule(archive(), now);
    return { ok: true, itemId: made.id, ...(rule ? { rule } : {}), ...writeAnswer(settingsOf(chain.id)) };
  }

  /**
   * Always allow in this chat, chosen where the agent asks (d-allow, agent/chat-always.js): the commands the call's
   * question offered to keep run without asking in this chat from now on, through the hand and in the folder they were
   * asked in. Nothing is kept on the page's word: each command is read again by the rule that made the offer
   * (`keepsOf`) and must be one part of a command, as an offer names them; the folder must be the chat's own now; and
   * a chat another machine's agents started keeps none. No reader of what only reads is at hand here, so such a
   * command, which no offer names, would be kept: it runs unasked as it is. Kept on the chat's meta in one step, each
   * command once, never past what a chat keeps (`ALWAYS_MAX`); every verdict reads it there, so it holds for the
   * turn's next request, and the permission switch lists it with its Forget.
   * @param {string} id @param {unknown} keeps  what the call's question carried: { hand, folder, commands }
   */
  function alwaysAllowInChat(id, keeps) {
    const chain = chainOf(id);
    const k = /** @type {any} */ (keeps && typeof keeps === "object" ? keeps : {});
    const hand = k.hand === "bash" || k.hand === "powershell" ? /** @type {"bash" | "powershell"} */ (k.hand) : null;
    /** @type {string[]} */
    const sent = Array.isArray(k.commands) && k.commands.length <= ALWAYS_MAX && k.commands.every((/** @type {unknown} */ c) => typeof c === "string" && c.trim() !== "") ? k.commands : [];
    if (!hand || typeof k.folder !== "string" || !k.folder || !sent.length) throw refusal(400, `keeps is what a call's question offers to always allow in this chat: { hand: "bash" or "powershell", folder, commands: [a command, …] }`);
    if (typeof chain.meta?.agentDevice === "string") throw refusal(409, "another machine's agents started this chat, and it keeps no always-allow: their commands are answered one by one");
    const folder = cwdOf(chain);
    if (!folderIs(folder)(k.folder)) throw refusal(400, `${k.folder} is not this chat's folder: a command is always allowed in the folder it was asked in`);
    const named = (/** @type {string} */ c) => (c.length > 200 ? `${c.slice(0, 200)}…` : c);
    const commands = sent.map((c) => {
      const read = keepsOf(c, hand, { at: { root: folder, shell: SHELL.kind }, readsOnly: () => null });
      const why = "why" in read ? read.why : read.commands.length !== 1 || read.commands[0] !== plain(c) ? "it is more than one command: each is kept alone" : null;
      if (why) throw refusal(400, `\`${named(c)}\` cannot be always allowed in this chat: ${why}`);
      return /** @type {{ commands: string[] }} */ (read).commands[0];
    });
    let full = false;
    archive().updateMeta(chain.id, (meta) => {
      const now = withKept(keptOf(meta[ALWAYS_RUN]), { hand, folder: k.folder, commands }, Date.now());
      if (now) meta[ALWAYS_RUN] = now;
      else full = true;
    });
    if (full) throw refusal(409, `this chat keeps ${ALWAYS_MAX} commands already: Forget one in the permission switch first`);
    return { ok: true, kept: commands, ...writeAnswer(settingsOf(chain.id)) };
  }

  /**
   * Forget one of a project's own rules (HarnessV4_Settings_Plan HC-56, HC-82), as Settings › Permissions asks for that
   * project: a written rule leaves the project's list, a remembered one is taken back as the permission switch does it,
   * and a list it empties is unset, so the rules for all chats speak there again.
   * @param {string} projectId @param {{ tool: string, pattern: string, verdict?: string | null }} rule
   */
  async function forgetProjectRule(projectId, { tool, pattern, verdict = null }) {
    const project = archive().getProject(String(projectId || ""));
    if (!project) throw refusal(404, "no such project");
    if (verdict != null && !RULE_VERDICTS.includes(verdict)) throw refusal(400, `verdict is ${RULE_VERDICTS.join(", ")}, not "${verdict}"`);
    const named = (/** @type {any} */ r) => r && r.tool === tool && r.pattern === pattern && (verdict == null || r.verdict === verdict);
    const list = (() => {
      const rules = archive().projectSettings(project.id)?.loop?.rules;
      return Array.isArray(rules) ? rules : [];
    })();
    const hits = list.filter(named);
    if (!hits.length) throw refusal(404, `no rule ${tool}(${pattern})${verdict ? ` ${verdict}` : ""} is in this project's list`);
    if (hits.some((r) => r.learned === true)) await takeBackPermission(project.id, { tool, pattern }, { from: "Settings › Permissions" });
    // The mirror may have gone with the permission; what is left of the written rows goes now.
    const now = archive().projectSettings(project.id)?.loop?.rules;
    const left = (Array.isArray(now) ? now : []).filter((/** @type {any} */ r) => !named(r));
    if (left.length !== (Array.isArray(now) ? now.length : 0)) patchProjectSettings(project.id, left.length ? { patch: { loop: { rules: left } } } : { unset: ["loop.rules"] });
    return { ok: true, forgot: hits, ...projectSettingsOf(project.id) };
  }

  /** The price card of the model in force (USD per million tokens) — resolved as the window is, through the route
   *  the name takes, and at the fast rate when the session's requests go out fast (model.fast on a model that has a
   *  fast mode there, or the rules' `always`); null when nothing prices it. @param {any} chain @param {any} eff */
  function priceOf(chain, eff) {
    const cfg = config.get();
    const name = String(eff?.model?.name || chain.model || "").trim();
    const inner = parseAgentModel(name)?.model || name;
    if (!inner) return null;
    const caps = modelCapsFor(cfg, inner);
    const mode = caps?.rules?.speed?.mode;
    const fast = !!caps?.fast.available && mode !== "never" && (mode === "always" || eff?.model?.fast === true);
    // The flex tier (Providers P5) at its price where the session asks for it and the model has one; fast wins.
    const flex = !fast && !!caps?.flex.available && eff?.model?.flex === true;
    return priceCardFor(cfg, inner, { fast, flex });
  }

  /**
   * The chat's prompt-cache lifetime as the Cache widget offers it (`model.cacheTtl`): the one its next turn asks for —
   * the chat's choice, else the route's rules — who said it, and whether the chat can choose: a chat of Filament's own,
   * whose turns Filament's agent sends and marks, on a route that speaks Anthropic's format with markers on. A coding
   * agent keeps its own markers, and a client's chat opened here (not `native`) sends its own requests. `same`: whether
   * the chat's next request goes where its ledger's last one went (`at`: that request's moment) — the same upstream,
   * and for a model Filament calls the same model, as a provider caches by model —: what that request left in a cache
   * is the next one's to read only then. Left out where the ledger's last request names no upstream (one kept before
   * it did) or no route answers the chat's model. `atMost`: on a coding agent, the longest its cache can be kept
   * (`AGENT_CACHE_MS`, the clock the cold question asks by) — a request of its that said no lifetime (one an older
   * Filament booked, an agent that says none) is cold past it, whichever lifetime it had.
   * @param {any} chain @param {any} eff
   * @returns {{ ttl: "5m" | "1h", from: "chat" | "rules", settable: boolean, same?: { at: number, is: boolean }, atMost?: number } | null}
   */
  function cacheSettingOf(chain, eff) {
    const cfg = config.get();
    const name = String(eff?.model?.name || chain.model || "").trim();
    const inner = parseAgentModel(name)?.model || name;
    if (!inner) return null;
    const chose = eff?.model?.cacheTtl === "5m" || eff?.model?.cacheTtl === "1h" ? eff.model.cacheTtl : null;
    const r = findRoute(cfg, inner);
    const up = r ? findUpstream(cfg, r.upstream) : null;
    const format = r?.format && r.format !== "auto" ? r.format : up && upstreamSupports(up, "anthropic") ? "anthropic" : "openai";
    const marks = mergeRules(cfg.rules, up?.rules, r?.rules).cache?.ensureBreakpoints !== "off";
    const last = chain.meta?.spend?.last || null;
    const wire = r ? renderUpstreamModel(r.upstreamModel, inner, r.captures || []) || inner : null;
    const same = last?.upstream && r ? { at: Number(last.at) || 0, is: last.upstream === r.upstream && ((!!up && isAgentUpstream(up)) || sameModel(cfg, last.model, wire) || sameModel(cfg, last.model, inner)) } : null;
    return { ttl: chose || routeCacheTtl(cfg, inner), from: chose ? "chat" : "rules", settable: !!chain.meta?.native && !!up && !isAgentUpstream(up) && format === "anthropic" && marks, ...(same ? { same } : {}), ...(up && isAgentUpstream(up) ? { atMost: AGENT_CACHE_MS } : {}) };
  }

  /**
   * What a chat sends ahead of its history as it stands, and the print it last sent (agent/prefix.js; the owner's of
   * 11-06): a coding agent's (`agentPrintSent`) or the loop's (`prefixSent`), its plugins and skills merged as the
   * pipeline merges them for its turn. `newest` is the newest compaction the chat stands on; `changes` what moved, in
   * words — none where the loop compacted since its last print, whose history is small to write again.
   * @param {any} chain @param {any} eff @param {boolean} agent @param {any[]} compactions
   */
  function printOf(chain, eff, agent, compactions) {
    const key = agent ? "agentPrintSent" : "prefixSent";
    const newest = Math.max(0, ...compactions.map((/** @type {any} */ k) => Number(k?.id) || 0));
    const doc = pluginsIn(eff, { project: chain.project_id, chat: chain.id, cwd: cwdOf(chain) });
    const now = agent ? agentPrint(doc) : loopPrint(doc);
    const was = chain.meta?.[key] || null;
    const changes = agent || Number(was?.head ?? 0) === newest ? printChanges(was, now) : [];
    return { key, now, was, newest, changes };
  }

  /**
   * Why Memory settings leave a draft's chat of the harness out, in their words (memory/brain.js `capturedOut`) — or
   * null: the reason memory's situate will give each turn the chat sends, which carries the harness's client
   * (`x-filament-client`), the name `turnModelName` gives its model and the chat's folder (`x-filament-cwd`). A chat
   * that stands is asked of memory (`chatLeftOut`), which knows the chat a team's chat runs beside.
   * @param {any} eff  the chat's document @param {string} name  its model @param {string} cwd  the folder it works in
   */
  function excludedOf(eff, name, cwd) {
    const cfg = config.get();
    return capturedOut(cfg.memory?.capture || {}, { client: "harness", model: turnModelName(cfg, eff, name), place: () => projectOf({ cwdHint: cwd, mayAsk: (f) => memory.mayAsk?.(f) ?? true }) });
  }

  /**
   * Which engine answers the session (HarnessV3 Step 5 D9), resolved here so the widget never reads the config: the
   * mode, whether Filament runs the session's turns through this engine at all
   * (`active`, app/engine.js's answer — a harness session's alone: an outside client's turns go to the model it names), the team the session names, and why its engine cannot run (`problem`), the
   * teams it can choose (HarnessV3-AtHome P2) — each with the lead in charge and its members by name —, the crew every
   * shipped team seats (`shippedCrew`: who a graph task's seat is where no team that leads names it), and the coding agent the name reaches (`coder`, its upstream's id, or
   * null — the page reads the agent's session as the agent counts it, HarnessV3-ACP AC3-5). The answers are for the
   * name the session's turns carry — the loop's model for an `agent/` name, as `windowOf` reads it: a name that
   * reaches a coding agent keeps its own turn. `leftOut`: why Memory settings leave the chat out, in their words
   * (memory's `chatLeftOut`: a harness chat's as its turns go out, a team's chat beside a chat they leave out among them;
   * an outside client's as its own requests reach memory), or null — Overview names memory only where it works in the
   * chat; `learnsNothing`: where it works in the chat, why memory learns nothing from it now (memory's
   * `learningOffWhy`), or null — the Memory pill says it. `agentTeams`: the teams its main agent may start on the side
   * by itself, by key, as its team tool reads them (`agentTeamsOf`: a key no team has is dropped, and a list of none
   * but those is the default).
   * @param {any} chain @param {any} eff
   */
  function engineOf(chain, eff) {
    const cfg = config.get();
    const e = sessionEngineOf(eff);
    const name = String(eff?.model?.name || chain.model || "").trim();
    const native = !!chain.meta?.native;
    const out = memory.chatLeftOut?.(chain.id, native ? (name ? turnModelName(cfg, eff, name) : "") : null) ?? null;
    const named = { model: parseAgentModel(name)?.model || name, agent: null };
    const teamChat = chain.kind === "team";
    const runs = engineFor(e, cfg, named, teams, teamChat);
    return {
      mode: e.mode,
      active: native && !!(runs.agent || runs.lead),
      team: e.team,
      problem: engineProblemFor(e, cfg, named, teams, teamChat),
      teams: (teams?.list() || []).map(teamRow),
      // While Settings › Experimental's Teams switch is off its main agent may start none (core/teams-on.js).
      agentTeams: teamsOn(cfg) ? agentTeamsOf(eff, (k) => teams?.find(k)?.key ?? null) : [],
      shippedCrew: SHIPPED_CREW,
      coder: named.model ? codingAgentOf(cfg, named.model) : null,
      leftOut: out,
      learnsNothing: out ? null : memory.learningOffWhy?.(chain.id) ?? null,
    };
  }

  /**
   * The window of the model in force (HarnessV3 Step 4 D4): the resolution every request of this session uses — the
   * loop's model for an `agent/` name — and where its number came from. The page's meter reads this, never the model
   * list.
   * @param {any} chain @param {any} eff
   */
  function windowOf(chain, eff) {
    const cfg = config.get();
    const name = String(eff?.model?.name || chain.model || "").trim();
    const inner = parseAgentModel(name)?.model || name;
    const w = sessionWindowFor(cfg, inner, eff?.model?.window);
    const place = inner ? placeOfName(cfg, inner) : null;
    const key = place?.up ? exactRowKey(place.sent, place.up.pricing) : null;
    // The name that runs it in 1M on Claude Code, where there is one to add (routing's `oneMToAdd`, the models list's
    // rule too); a window that is the agent's own word is the one it runs in, so nothing is added to reach it.
    const add = place?.up && w.source !== "agent" ? oneMToAdd(place.up, place.sent, w.tokens) : null;
    return {
      tokens: w.tokens || null,
      source: w.tokens ? w.source || null : null,
      model: inner || null,
      // The name its upstream is sent: the one a coding agent counts its own window by (the Context card's word where
      // the two differ).
      sent: place?.sent || null,
      // Whether the person can say the window here (`setWindow`), and whether the word in force is one said so: the
      // row that names this model itself (HarnessV4_Tasks C33).
      settable: !!place?.up,
      own: !!key && place?.up.pricing[key]?.contextTokens != null,
      ...(add ? { add } : {}),
    };
  }

  /**
   * The window of the session's model, said by the person where nobody knew one (HarnessV4_Tasks C33): written on the
   * row that names this model at its upstream — the operator's word, which every reader takes first — so it is the
   * window of every session on that model, and a coding agent's session there has a line. `tokens: null` takes the
   * word back, from that row alone: a wider row's word is the dashboard's to change.
   * @param {string} id @param {{ tokens?: number | null }} [o]
   */
  function setWindow(id, { tokens = null } = {}) {
    const chain = chainOf(id);
    const cfg = config.get();
    const eff = effectiveOf(chain.id);
    const name = String(eff.model?.name || chain.model || "").trim();
    const inner = parseAgentModel(name)?.model || name;
    const place = inner ? placeOfName(cfg, inner) : null;
    if (!place?.up) throw refusal(409, "the session's model reaches no upstream, so there is no row to keep its window on");
    const n = tokens == null ? null : Math.floor(Number(tokens));
    if (n != null && !(n >= 1000 && n <= 100_000_000)) throw refusal(400, "a window is a number of tokens, 1,000 or more");
    const key = exactRowKey(place.sent, place.up.pricing);
    const has = !!key && place.up.pricing[key]?.contextTokens != null;
    if (n == null && !has) throw refusal(409, sessionWindowFor(cfg, inner, eff.model?.window).source === "operator"
      ? "this window is said on a wider row of the upstream's model table: the dashboard's Model tune page changes it"
      : "nobody has said this model's window here: there is nothing to take back");
    if (n != null && has && Number(place.up.pricing[key].contextTokens) === n) return { ok: true, changed: false, ...writeAnswer(settingsOf(chain.id)) };
    const { set, save } = config;
    if (!set || !save) throw refusal(501, "this configuration is read-only here: the window cannot be written");
    const next = structuredClone(cfg);
    const up = next.upstreams.find((/** @type {any} */ u) => u.id === place.up.id);
    up.pricing = up.pricing && typeof up.pricing === "object" ? up.pricing : {};
    const at = key || place.sent;
    if (n == null) {
      delete up.pricing[at].contextTokens;
      if (!Object.keys(up.pricing[at]).length) delete up.pricing[at];
    } else up.pricing[at] = { ...(up.pricing[at] || {}), contextTokens: n };
    changeConfig({ set: (c) => set.call(config, c), save: () => save.call(config) }, next);
    ops.record?.("config", n == null ? `the window you said for ${place.sent} at ${place.up.id} was taken back` : `${place.sent} at ${place.up.id} has the window you said: ${n.toLocaleString()} tokens`, { sub: "model-window", detail: { upstream: place.up.id, model: place.sent, tokens: n } });
    return { ok: true, changed: true, ...writeAnswer(settingsOf(chain.id)) };
  }

  /**
   * The session layer's writer as this service answers it (D7): the write itself is memory's one writer, with its
   * mirror and its audit line; what stays here is the HTTP answer's shape, `settingsOf` added. Unknown keys are
   * refused by name and nothing is written.
   * @param {string} id @param {{ patch?: any, unset?: string[] }} change @param {{ audit?: boolean, via?: string, title?: string | null }} [o]
   */
  function patchSettings(id, { patch = {}, unset = [] } = {}, { audit = true, via = "settings", title = null } = {}) {
    const chain = chainOf(id);
    const r = memory.patchSessionSettings(chain.id, { patch, unset: Array.isArray(unset) ? unset.map(String) : [] }, { via, audit, title });
    if (r.errors.length) throw refusal(400, r.errors.join("; "), { errors: r.errors });
    return { ok: true, changes: r.changes, ...writeAnswer(settingsOf(chain.id)) };
  }

  /**
   * The session's compaction line as its meter reads it, and — `tokens` named — set in tokens (HarnessV4_Tasks C33: a
   * coding agent's own word for where it makes room, typed in a harness chat). The line is kept as the session's own
   * percent of the window it is read against (the agent's own, where it has named one), so it is the line of every
   * session the chat's agent opens; `auto` gives it back to the layers below. Refused in words where nobody knows the
   * window, or the tokens are past it or off the band a line may take (`LINE_MIN` to `LINE_MAX` of the window).
   * @param {string} id @param {{ tokens?: number | null, auto?: boolean, via?: string }} [o]
   * @returns {{ percent: number, tokens: number | null, window: number | null, own: boolean, changed: boolean }}
   */
  function lineOf(id, { tokens = null, auto = false, via = "/autocompact" } = {}) {
    const chain = chainOf(id);
    const cfg = config.get();
    const eff = effectiveOf(chain.id);
    const modelName = String(eff.model?.name || chain.model || "").trim();
    const inner = parseAgentModel(modelName)?.model || modelName;
    const agentUp = agentSessionOf(cfg, inner);
    const named = (inner && sessionWindowFor(cfg, inner, eff.model?.window).tokens) || null;
    // The window the agent is handed its line as a share of (`turn`): the one it named, else what it holds against.
    const turns = agentUp ? modelTurns(chain.id) : [];
    const window = (agentUp ? namedWindow(turns, agentUp) || agentHeld({ turns, compactions: compactionsOf(chain.id), upstream: agentUp, window: named })?.window : null) || named;
    const said = () => {
      const now = settingsOf(chain.id);
      const percent = linePercentOf(now.effective.context?.compaction);
      return { percent, tokens: window ? usableWindow(window, { thresholdPercent: percent }) : null, window, own: now.sources["context.compaction.thresholdPercent"] === "session" };
    };
    if (!auto && tokens == null) return { ...said(), changed: false };
    if (!auto && !window) throw refusal(409, "nobody knows this model's window, so a line in tokens has nothing to be a share of: say the window in the Context popover first");
    if (!auto && Number(tokens) > Number(window)) throw refusal(400, `${Number(tokens).toLocaleString()} tokens is past this model's window, ${Number(window).toLocaleString()}`);
    const asked = auto ? null : Math.round((Number(tokens) / Number(window)) * 100);
    const edge = asked == null || (asked >= LINE_MIN && asked <= LINE_MAX) ? null : asked < LINE_MIN ? LINE_MIN : LINE_MAX;
    if (edge != null) {
      const at = usableWindow(Number(window), { thresholdPercent: edge }).toLocaleString();
      throw refusal(400, `${Number(tokens).toLocaleString()} tokens is ${asked}% of this model's ${Number(window).toLocaleString()}-token window, and the ${edge === LINE_MIN ? "lowest" : "highest"} line is ${edge}%: ${at} tokens here`);
    }
    const r = auto
      ? memory.patchSessionSettings(chain.id, { unset: ["context.compaction.thresholdPercent"] }, { via })
      : memory.patchSessionSettings(chain.id, { patch: { "context.compaction.thresholdPercent": asked } }, { via });
    if (r.errors?.length) throw refusal(400, r.errors.join("; "), { errors: r.errors });
    return { ...said(), changed: r.changes.length > 0 };
  }

  /**
   * The runs of a session's newest turns, newest first: each turn's newest request (HarnessV4_Tasks E15 step 5: where
   * a coding agent's own agents are read from, app/agent-guests.js). None for a session the archive does not hold.
   * @param {string} id @param {number} limit
   * @returns {string[]}
   */
  function turnRuns(id, limit) {
    if (!memory.archive) return [];
    const turns = memory.archive.getTurns(String(id || ""));
    return turns.slice(-Math.max(1, limit)).reverse().map((t) => String((t.requestIds || []).at(-1) || "")).filter(Boolean);
  }

  /**
   * What a write answers with: the settings document as it stands after the write, minus the catalogues that a
   * write never changes — so a screen that wrote shows the result without reading the document again.
   * @param {ReturnType<typeof settingsOf>} s
   */
  function writeAnswer(s) {
    // `usage`, `derived` and `price` ride along (Step 6 §2.2): a write can move the derivations (and, with the model,
    // the price card), and the harness view's loader (`viewSettingsOf`) expects this answer to carry the same fields
    // a full read does — a field left out here reads as null on the page after every write.
    return { hash: s.hash, native: s.native, effective: s.effective, flat: s.flat, sources: s.sources, layers: s.layers, window: s.window, engine: s.engine, usage: s.usage, derived: s.derived, price: s.price, cache: s.cache, rulesInForce: s.rulesInForce };
  }

  /**
   * The settings history of a session (§10.3), from the operation log: its own document's changes (and the presets it
   * took, while there were presets), and the changes to its project's layer (which it inherits). Newest first; capped
   * by the log's retention.
   * @param {string} id @param {{ limit?: number }} [o]
   */
  function settingsHistory(id, { limit = 100 } = {}) {
    const chain = chainOf(id);
    if (!ops.list) return { chainId: chain.id, entries: [], note: "the operation log is not wired" };
    const rows = ops.list({ kinds: ["config", "archive"], limit: 2000 });
    const entries = [];
    for (const o of rows) {
      const d = o.detail || {};
      const mine = o.ref?.chainId === chain.id || d.chainId === chain.id;
      const project = chain.project_id && o.sub === "project-settings" && d.projectId === chain.project_id;
      if (!mine && !project) continue;
      if (!["session-settings", "project-settings", "preset-save", "session-override", "session-create"].includes(String(o.sub))) continue;
      const changes = Array.isArray(d.changes) ? d.changes : Array.isArray(d.knobs) ? d.knobs : o.sub === "session-create" ? [`created${d.preset ? ` with preset ${d.preset}` : ""}${d.model ? `, model ${d.model}` : ""}`] : [];
      entries.push({ id: o.id, at: o.ts, layer: project ? "project" : "session", sub: o.sub, title: o.title, changes });
      if (entries.length >= limit) break;
    }
    return { chainId: chain.id, entries, capped: rows.length >= 2000 };
  }

  /**
   * Change a project's layer (memory's writer does the work — repo facts only now, D3); the row keeps its answer.
   * @param {string} projectId @param {{ patch?: any, unset?: string[] }} change
   */
  function patchProjectSettings(projectId, { patch = {}, unset = [] } = {}) {
    const r = viaMemory(() => memory.patchProjectSettings(projectId, { patch, unset: Array.isArray(unset) ? unset.map(String) : [] }));
    if (r.errors.length) throw refusal(400, r.errors.join("; "), { errors: r.errors });
    return { ok: true, projectId: String(projectId), changes: r.changes, layer: r.layer };
  }

  /**
   * The project a folder's worktree template is kept on (FO-D31): its repository's main folder's, whichever folder of
   * it or of its worktrees the folder is; a folder outside git, its own (GW-D46).
   * @param {string} cwd
   */
  const projectOfFolder = (cwd) => {
    const folder = String(cwd || "").trim();
    if (!folder) throw refusal(400, "cwd is required: a folder of the project");
    const real = realFolder(folder);
    const home = repositoryFolderOf(real) || projectFolderOf(real);
    return { home, projectId: projectIdOf(home) };
  };

  /**
   * The project a chat started in a folder would be in (`projectOfFolder`), and whether Filament knows it already: a
   * thread's agent asks the person before a folder becomes a project (app/threads.js). @param {string} cwd
   * @returns {{ home: string, projectId: string, known: boolean }}
   */
  function folderProject(cwd) {
    const p = projectOfFolder(cwd);
    return { ...p, known: !!archive().getProject(p.projectId) };
  }

  /**
   * A folder's worktree template (HarnessV4_Four_Plan FO-D31): its repository's project's list (`worktree.copy`) over
   * your defaults', and where the list comes from — "project", "global" (your defaults) or "default" (none). Computed,
   * not ensured.
   * @param {string} cwd
   * @returns {{ projectId: string, project: string, copy: string[], from: string }}
   */
  function worktreeTemplate(cwd) {
    const { home, projectId } = projectOfFolder(cwd);
    const a = archive();
    const project = a.getProject(projectId);
    const resolved = resolveSettings({ global: harnessGlobalLayer(config.get()), project: project ? a.projectSettings(project.id) || {} : {} });
    const copy = resolved.flat["worktree.copy"];
    return { projectId, project: project?.name || home, copy: Array.isArray(copy) ? copy.map(String) : [], from: String(resolved.sources["worktree.copy"] || "default") };
  }

  /**
   * Save a folder's worktree template on its project (FO-D35), the project made where it is new: the list as given,
   * an empty one too (nothing is copied, your defaults' list no longer applies). Refused in words for a path the list
   * cannot hold (FOC-68).
   * @param {string} cwd @param {unknown} copy
   */
  function saveWorktreeTemplate(cwd, copy) {
    if (!Array.isArray(copy)) throw refusal(400, "copy is required: a list of paths from the repository's top folder");
    const { home } = projectOfFolder(cwd);
    const project = archive().ensureProject(home);
    patchProjectSettings(project.id, { patch: { worktree: { copy: [...new Set(copy.map(copyPath))] } } });
    return worktreeTemplate(cwd);
  }

  /**
   * What `create` would write, worked out but not written (D15; the Start board's draft-start): the folder validated —
   * there, and one an agent may work in — and the given settings and model — the exact layer the chain would hold.
   * `create` itself runs the same function before it writes, so the two can never drift. A new chat starts from your
   * defaults: there are no presets (the owner's of 11-07). A client written before them sends `preset` none, or
   * "plain", which was the defaults named; any other name is refused in words, never dropped — a start that asked for
   * a read-only preset must not quietly start with every tool.
   * @param {{ cwd: string, model?: string | null, settings?: any, preset?: string | null, unmade?: boolean, theirs?: boolean, ownCopy?: string }} args
   *   `unmade`: the Start board's draft of a chat outside a project, whose folder of Filament's own (app/everything.js)
   *   is made at its first send — weighed where it will be, its fence judged by Everything's own check; never `create`'s.
   *   `theirs`: a chat another machine's agents start, or one made from theirs — the one kind Filament's copies folder
   *   is a root for (`folderVerdict`'s `person`). `ownCopy`: the folder of the copy placed for the person's chat that
   *   their machine's app starts (http/admin/sessions.js, services/copies.js `ownedAt`), a root for it (`folderVerdict`'s `copy`)
   */
  function draftOf({ cwd, model = null, settings = null, preset, unmade = false, theirs = false, ownCopy = "" }) {
    if (preset != null && !["none", "plain"].includes(String(preset).trim().toLowerCase()))
      throw refusal(400, `there are no presets: a new chat starts from your defaults, and what it changes rides as its settings ("${String(preset)}" names none)`);
    const folder = String(cwd || "").trim();
    if (!folder) throw refusal(400, "cwd is required: the folder the session works in");
    // Judged as Filament's own loop judges its working folder (`folderVerdict`), for whichever agent the chat runs: a
    // coding agent works in the folder its chat names, so a chat in a folder outside the roots agentLoop.roots lists is
    // not made, nor one on a network share no listed root names. With none listed, any folder is.
    const verdict = unmade ? null : folderVerdict(config.get(), folder, { person: !theirs, copy: theirs ? "" : ownCopy });
    if (verdict?.why === "missing") throw refusal(400, `the folder does not exist on this machine: ${folder}`);
    if (verdict?.why === "outside") throw refusal(403, outsideRootsWords(folder));
    const real = verdict ? verdict.root : folder;
    // The project's id is its folder's hash (core/project-id), the folder being the main folder's for a worktree
    // (HarnessV4_Git_Plan GW-D46): computed, not ensured — a draft writes nothing, so a folder's first draft does not
    // conjure its project row.
    const home = projectFolderOf(real);
    const projectId = projectIdOf(home);
    const layer = settings && typeof settings === "object" ? settings : {};
    const merged = applyPatch({}, { patch: { ...layer, ...(model ? { model: { ...(layer.model || {}), name: String(model) } } : {}) } }, { at: "session" });
    if (merged.errors.length) throw refusal(400, merged.errors.join("; "), { errors: merged.errors });
    return { cwd: real, home, projectId, layer: merged.layer };
  }

  /**
   * A new session: the folder validated, its project row ensured (D3), the chain created with the harness as client
   * and the given session layer (plus `model.name`).
   * @param {{ cwd: string, model?: string | null, title?: string | null, autoTitle?: boolean, settings?: any, kind?: string, preset?: string | null, parentId?: string | null, beside?: string | null, from?: { space: string } | null, thread?: string | null, agents?: boolean, ownCopy?: string }} args
   *   `preset`: none, as `draftOf` reads it. `autoTitle` (no `title`): named by the first line of its first message
   *   that reaches the model, never by a command Filament answers (backlog 18) — the archive writes it when that turn
   *   begins. `beside`: the chat a team's chat runs beside
   *   (kind `team`, team_v2_plan §5.3), tied to it by a `beside` link as it is made — Filament's own, never a route's.
   *   `from`: the Space of your own it was handed from (HarnessV4_SpacesPlugins_Plan A4), kept in its meta: that
   *   Space's What happened says when it finishes (app/space-news.js).
   *   `thread`: the chat whose agent started this one (core/threads.js), an interactive chat tied to it by a `thread`
   *   link as it is made — Filament's own, never a route's.
   *   `agents`: another machine's agents' device starts it (http/admin/sessions.js) — `draftOf`'s `theirs`; one made
   *   from a chat of theirs is theirs without it. `ownCopy`: as `draftOf` reads it.
   */
  function create({ cwd, model = null, title = null, autoTitle = false, settings = null, kind = "interactive", preset, parentId = null, beside = null, from = null, thread = null, agents = false, ownCopy = "" }) {
    const a = archive();
    if (kind === "team" ? !beside || !a.hasChain(String(beside)) : kind !== "interactive" && kind !== "fork") throw refusal(400, `kind must be interactive or fork, not "${kind}"`);
    if (thread != null && (kind !== "interactive" || !a.hasChain(String(thread)))) throw refusal(400, "a thread is an interactive chat started from one that is there");
    // A chat made from another machine's agents' chat — a team's beside it, one it names its parent, a thread its agent
    // started — is theirs as that chat is (the remote-agents plan's f-fence2): their device kept on it, so the person's
    // folders never count its own (archive `chatFolders`), and memory's recall and tools off while it runs fenced, as
    // their chat's (archive.js `fenced`).
    const madeFrom = beside || parentId || thread;
    const theirs = madeFrom ? a.metaOf(String(madeFrom), ["agentDevice", "agentFrom"]) : null;
    const device = theirs?.agentDevice;
    const draft = draftOf({ cwd, model, settings, preset, theirs: agents || typeof device === "string", ownCopy });
    const real = draft.cwd;
    // The project is the folder's, or its main folder's for a worktree (GW-D46); the chat's own folder is `meta.cwd`.
    const project = a.ensureProject(draft.home);
    const tmpKey = `n:new-${randomBytes(6).toString("base64url")}`;
    const chain = a.chainForKey(tmpKey, { project: project.id, cwd: draft.home, client: "harness", model: model ? String(model) : null, kind, parentId });
    a.rekeyChain(chain.id, `n:${chain.id}`);
    if (kind === "team") a.link(chain.id, String(beside), "beside", 1);
    if (thread != null) a.link(chain.id, String(thread), THREAD_LINK, 1);
    if (title && String(title).trim()) a.setTitle(chain.id, String(title).trim().slice(0, 200));
    const named = !!(title && String(title).trim());
    a.mergeMeta(chain.id, { native: true, cwd: real, ...(autoTitle && !named ? { autoTitle: true } : {}), ...(from?.space && from.space !== project.id ? { from: { space: String(from.space) } } : {}), ...(typeof device === "string" ? { agentDevice: device, ...(typeof theirs?.agentFrom === "string" ? { agentFrom: theirs.agentFrom } : {}) } : {}) });
    // The layer goes through the one writer (D7): validated, mirrored (memory.enabled, privacy, the model
    // column). It records only the session's creation (nothing else happened). The draft already passed the writer's
    // own validation, so a refusal here is a broken invariant, said loudly rather than leaving a session that silently
    // lacks its first layer.
    if (Object.keys(flatten(draft.layer)).length) {
      const w = memory.patchSessionSettings(chain.id, { patch: draft.layer }, { via: "session create", audit: false });
      if (w.errors.length) throw new Error(`session ${chain.id}: its first layer was refused after the draft accepted it (${w.errors.join("; ")})`);
    }
    memory.sessionLists?.clear?.();
    ops.record("archive", `session ${chain.id} created (${project.name || real})`, {
      sub: "session-create",
      detail: { chainId: chain.id, projectId: project.id, model: model || null, kind },
      ref: { chainId: chain.id },
    });
    const s = settingsOf(chain.id);
    return { id: chain.id, key: `n:${chain.id}`, projectId: project.id, cwd: real, model: s.effective.model?.name || null, kind, title: title || null, settingsHash: s.hash };
  }

  /**
   * A start checked as `create` checks it, nothing written: the folder and the settings — the same refusal
   * thrown. A new worktree is made for a chat only once its start passed this (HarnessV4_Git_Plan GW-D45).
   * @param {{ cwd: string, model?: string | null, settings?: any, preset?: string | null }} args
   */
  function check({ cwd, model = null, settings = null, preset }) {
    draftOf({ cwd, model, settings, preset });
  }

  /**
   * The New Task board's answer (HarnessV3-NewTask NT-D5/D6): the session `create` would make from the same body —
   * its resolution and where each value comes from — and its first request weighed part by part (`startAnatomy`), with
   * the developer's draft `text` as the newest message. Writes nothing and calls no model (NT-D11): the board asks on
   * every pause in typing. `create` runs the same `draftOf` before it writes, so the board shows what the first
   * send makes. The folder's Environment comes from the app's capture, whose short cache the first turn then reuses
   * (HarnessV3-SystemPrompt SP-D7).
   * @param {{ cwd: string, model?: string | null, settings?: any, preset?: string | null, text?: string, unmade?: boolean, outside?: boolean, ownCopy?: string }} args
   *   `unmade`, `ownCopy`: as `draftOf` reads them; `outside`: a chat outside a project, in Everything's folder — the answer says
   *   so, and counts the memories it draws on that hold everywhere
   */
  async function draftStart(args) {
    const a = archive();
    const draft = draftOf(args);
    const project = a.getProject(draft.projectId);
    const resolved = resolveSettings({
      global: harnessGlobalLayer(config.get()),
      space: spaceLayerOf(a, project?.id),
      project: project ? a.projectSettings(project.id) || {} : {},
      session: draft.layer,
    });
    // A capture that fails leaves the section out, as the loop's own keeper does.
    const env = environment ? await environment(draft.cwd).catch(() => null) : null;
    const asks = subagents?.askables?.(resolved.effective?.subagents?.ask) || [];
    // What the start gives each setting this draft changes, before the change (the design pass of 10-24, UX5): a row's
    // ↺ puts it back, and a change made back to it is no change.
    const changed = Object.keys(flatten(args.settings || {}));
    const bare = changed.length
      ? resolveSettings({ global: harnessGlobalLayer(config.get()), space: spaceLayerOf(a, project?.id), project: project ? a.projectSettings(project.id) || {} : {}, session: draftOf({ ...args, settings: null }).layer }).flat
      : {};
    return {
      cwd: draft.cwd,
      projectId: draft.projectId,
      // The project a worktree's folder stands in is its repository's (GW-D46): the Start names its defaults by it.
      projectName: project?.name || projectNameOf(draft.home),
      flat: resolved.flat,
      sources: resolved.sources,
      base: Object.fromEntries(changed.filter((p) => Object.hasOwn(bare, p)).map((p) => [p, bare[p]])),
      // The teams its agent may start by itself, as its team tool will read them (`agentTeamsOf`): a key no team has is
      // left out, a list of none but those is the default; none while Settings › Experimental's Teams switch is off.
      agentTeams: teamsOn(config.get()) ? agentTeamsOf(resolved.effective, (k) => teams?.find(k)?.key ?? null) : [],
      // The chat it makes is the harness's, in the draft's folder: where Memory settings leave it out, none of memory's
      // parts ride its start.
      ...startAnatomy({ cfg: config.get(), eff: pluginsIn(resolved.effective, { project: draft.projectId, cwd: draft.cwd }), cwd: draft.cwd, projectId: draft.projectId, spaceMade, text: String(args.text || ""), memory, modelProblem, environment: env, teams, asks, places: subagents?.placesFor?.(asks) || [], modelsOf: (members, lead) => subagents?.modelsOf?.(null, members, lead, resolved.effective?.subagents) ?? null, mcpTested: (spec) => mcpTests?.get(specKey(spec)) ?? null, excluded: excludedOf(resolved.effective, String(resolved.effective?.model?.name || "").trim(), draft.cwd), outside: !!args.outside }),
      ...(args.outside ? { outside: true } : {}),
    };
  }

  /**
   * A project's settings (D5/D13): its repo-knob layer, resolved against the global one so the panel can say where
   * each value comes from.
   * @param {string} projectId
   */
  function projectSettingsOf(projectId) {
    const a = archive();
    const project = a.getProject(String(projectId || ""));
    if (!project) throw refusal(404, "no such project");
    const layer = a.projectSettings(project.id) || {};
    // The Space that shows the project passes its connectors, plugins and skills down, as each chat of it gets them.
    const resolved = resolveSettings({ global: harnessGlobalLayer(config.get()), space: spaceLayerOf(a, project.id), project: layer });
    /** The repo knobs only: what a project's layer may hold (D3). */
    const knobs = Object.fromEntries(Object.entries(knobCatalog()).filter(([path]) => scopeOf(path) === "repo"));
    return {
      projectId: project.id,
      name: project.name || project.cwd || project.id,
      cwd: project.cwd || null,
      layer,
      resolved: { effective: resolved.effective, flat: resolved.flat, sources: resolved.sources, layers: resolved.layers },
      knobs,
    };
  }

  /**
   * Your defaults for sessions (HarnessV4_Tasks U3-8, UX-13): the global layer as a document — every knob it may hold
   * (never a session's own state), resolved, each with where it comes from: `yours` (`sessions.defaults`, what
   * Settings › Context wrote), `dashboard` (the config's rules, mirrored) or `default` (built in). A new chat starts
   * from these.
   */
  function defaultsOf() {
    const cfg = config.get();
    const own = ownDefaults(cfg);
    const mirror = globalLayer(cfg);
    const resolved = resolveSettings({ global: harnessGlobalLayer(cfg) });
    /** @type {Record<string, any>} */
    const flat = {};
    /** @type {Record<string, "yours" | "dashboard" | "default">} */
    const sources = {};
    for (const [path, v] of Object.entries(resolved.flat)) {
      if (scopeOf(path) === "session") continue;
      flat[path] = v;
      sources[path] = path in own ? "yours" : path in mirror ? "dashboard" : "default";
    }
    const layer = cfg.sessions?.defaults && typeof cfg.sessions.defaults === "object" ? cfg.sessions.defaults : {};
    return {
      layer,
      flat,
      sources,
      effective: resolved.effective,
      hash: resolved.hash,
    };
  }

  /**
   * Change your defaults: the change read as any layer's is (a knob the global layer may hold, a value it takes — a
   * refusal writes nothing), kept in the config. Every session that has not chosen the knob takes it from its next
   * request.
   * @param {{ patch?: any, unset?: string[] }} change
   */
  function patchDefaults({ patch = {}, unset = [] } = {}) {
    const cfg = config.get();
    const cur = cfg.sessions?.defaults && typeof cfg.sessions.defaults === "object" ? cfg.sessions.defaults : {};
    const r = applyPatch(cur, { patch, unset: Array.isArray(unset) ? unset.map(String) : [] }, { at: "global" });
    if (r.errors.length) throw refusal(400, r.errors.join("; "), { errors: r.errors });
    if (r.changes.length) {
      const { set, save } = config;
      if (!set || !save) throw refusal(501, "this configuration is read-only here: your defaults cannot be written");
      changeConfig({ set: (c) => set.call(config, c), save: () => save.call(config) }, { ...structuredClone(cfg), sessions: { ...(cfg.sessions || {}), defaults: r.layer } });
      ops.record?.("config", `your session defaults changed (${r.changes.length} setting${r.changes.length === 1 ? "" : "s"})`, { sub: "session-defaults", detail: { changes: r.changes.map((/** @type {any} */ c) => c.path) } });
    }
    return { ok: true, changes: r.changes, ...defaultsOf() };
  }

  /**
   * The user's message as content blocks: a string becomes one text block; a block list is taken as sent.
   * @param {any} content
   */
  function contentBlocks(content) {
    if (typeof content === "string") return content.trim() ? [{ type: "text", text: content }] : null;
    if (Array.isArray(content) && content.length && content.every((b) => b && typeof b === "object" && typeof b.type === "string")) return content;
    return null;
  }

  /**
   * A message's blocks to send again (a resume's, TG2-D85): its words and pictures, no tool result.
   * @param {any} message
   */
  function messageBlocks(message) {
    const c = message?.content;
    return Array.isArray(c) ? c.filter((b) => b && typeof b === "object" && b.type !== "tool_result") : [{ type: "text", text: String(c ?? "") }];
  }

  /**
   * What the harness gets for writing into a session that is no chat of its own: a client's is its client's — an
   * outside client gets a plain proxy plus memory — so the harness goes on in a fork of it, made at its newest finished
   * turn (`fork`: the route and that turn; none while no turn has finished).
   * @param {any} chain @param {string} why  what the harness does instead
   * @param {{ fork?: boolean }} [o]
   */
  function clientSessionRefusal(chain, why, { fork: forks = true } = {}) {
    const owner = chain.client && chain.client !== "harness" ? `${clientLabel(chain.client)}'s` : "no chat of the harness's own";
    const done = forks ? archive().getTurns(chain.id).filter((t) => t.ended_at != null).at(-1) : null;
    return refusal(409, `this session is ${owner}: ${why}`, {
      client: true,
      ...(done ? { fork: { method: "POST", path: `/api/sessions/${encodeURIComponent(chain.id)}/fork`, atTurn: Number(done.n) } } : {}),
    });
  }

  /**
   * The chain of a chat of the harness's own, else the refusal of a client's that says what the harness does instead.
   * @param {string} id @param {string} why
   */
  function ownChat(id, why) {
    const chain = chainOf(id);
    if (!chain.meta?.native) throw clientSessionRefusal(chain, why);
    return chain;
  }

  /**
   * One turn: compose the request from the archive and the settings, hand it to the pipeline as `/v1/messages`
   * traffic addressed to this chain, then stamp the turn with the settings hash and the composition. The reply goes
   * to `res` in the Anthropic wire shape (SSE when `stream`), exactly as a `/v1/messages` client would get it.
   * @param {string} id
   * @param {{ content: any, stream?: boolean, permissions?: string | null, allow?: boolean, modeSwitch?: boolean, settingsPatch?: any, load?: string | null, runEvents?: boolean, sendAsIs?: boolean, unattended?: boolean, overrules?: unknown, use?: unknown, useTeams?: unknown, flow?: boolean, parallel?: boolean, plan?: boolean, carry?: string, resume?: boolean, wake?: boolean, goal?: boolean, sync?: boolean, beside?: boolean, byFilament?: boolean, thread?: boolean, watch?: boolean, works?: boolean, by?: unknown, sendId?: unknown }} input
   *   `by`: who begins the turn (core/turn-by.js `turnBy`), the person's message where it names none; each boolean below
   *   names its kind as an older caller did, read as that kind — two kinds at once, or a `by` no kind is, refused 400.
   *   `routine`, `ask` and `team`: a routine's run, a Space ask's run, a team's opening, each its chat's first message,
   *   taken only in the chat Filament made for it (`meta.routine`, `meta.ask`, a team's own chat beside)
   *   `sendId`: the page's own name for this send, which the turn keeps (`sends`): a page whose reply's head never came
   *   knows its turn by it
   *   `allow`: the person's press on the card of the call the chat's turn waits on — true for Allow, the one way it
   *   runs; false for Deny, which answers it "Not run" in its words whatever they say; without it a message answers it
   *   "Not run" too, unless it is /allow alone
   *   `overrules` ([{ agentId, exchange, name?, question? }]): the saved agents' answers the message overrules
   *   `along` ([tag]): the saved agents the message names past its start (an `@tag` in its words): Filament asks each of
   *   them the message once the turn can no longer be refused, and the turn waits for their answers
   *   `carry`: the form a switch's fresh agent session carries the earlier turns in — the switch card's answer
   *   (HarnessV4_Tasks A7), one of `context.carry`'s forms
   *   `resume`: Filament's own turn going on with one a restart cut off (HarnessV3-TaskGraph-v2 TG2-D83): its message is
   *   `RESUME_LINE`, whatever `content` says; the chat's newest turn must be that cut one; it asks no cold-cache question
   *   `wake`: Filament's own turn as a background command ended (HarnessV4_Four_Plan E21, FO-D49): its message is
   *   `WAKE_LINE`, the end rides ahead of it; refused (`extra.wake`) while a turn holds the chat ("held"), a question
   *   waits ("asking"), the person pressed Stop with no turn begun since ("stopped"), or no end waits untold ("told");
   *   it asks no cold-cache question
   *   `goal`: Filament's own turn as a driving goal's next round (core/goal-drive.js, the owner's of 11-05): its message is
   *   the round's line; refused (`extra.wake`) as a wake is — "held", "asking", "stopped" — and "told" where no round is
   *   owed or the goal drives no more; it asks no cold-cache question
   *   `sync`: a sync from the project's Space that the person ran (proposal_ux §4.14): its message is the sync's,
   *   `content`, which must read as one (`isSyncMessage`); refused (`extra.sync`) while a question waits for the
   *   person's answer ("asking"), which it would otherwise answer; it asks no cold-cache question — the person ran it
   *   `beside`: a team's result reaching the main agent (team_v2_plan §5.4): its message is the result's, `content`,
   *   which must read as one (`isTeamResult`); refused (`extra.beside`) while a question waits for the person's answer
   *   ("asking"); it asks no cold-cache question — the person pressed Notify, or switched it on
   *   `byFilament`: Filament's own turn in a flow's team box's chat (flow-runner.js): it asks no question, as a wake
   *   does; never the person's Send as it is — the print a coding agent's session goes on with is kept only where it
   *   opens — nor a message of theirs; refused (`extra.byFilament`) while a question waits for the person's answer
   *   ("asking"), which it would otherwise answer
   *   `thread`: a thread's brief (core/threads.js), its first message: its starter's agent's words, which `content`
   *   must carry as Filament's one block, no word beside it read as the person's; a turn of Filament's own as
   *   `byFilament` is, taken only in a chat linked as a thread, from the starter the link names, while its only turns
   *   are briefs with no reply
   *   `watch`: a watcher's wake of the chat that proposed it (app/routines.js `wakeChat`): `content` must read as one
   *   (core/watchers.js `isWatchWake`); a turn of Filament's own as `byFilament` is, refused (`extra.watch`) while room
   *   is made for the chat or for the message it was made for ("room"), a question waits for the person's answer
   *   ("asking"), or the person pressed Stop with no turn begun since ("stopped") — its runner keeps what it heard;
   *   its turn is read-only whatever the chat's own mode, and so is the answer to a question it asked — refused
   *   ("unheld") where the chat's coding agent runs in a mode its model's name sets in which it asks nothing —,
   *   unless `works`: its watcher writes, and the turn runs as any message posted to the chat would
   *   `by: "guide"`: a watcher's guidance to the chat it watches (app/watchers/guidance.js): `content` must read as one
   *   (core/watchers.js `isGuidance`); a turn of Filament's own, in the chat's own mode, refused (`extra.guide`) on a
   *   wake's conditions ("room", "asking", "stopped") — its sender keeps it and sends it as the chat lets go
   *   The `x-filament-via` head (api.js `viaHeader`): the send menu's row the message went by, kept on the turn's row
   * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res
   * @param {{ receivedAt?: number, bodyAt?: number, sentAt?: number | null } | null} [arrival] the route's stamps (turnClock)
   * @param {{ commands?: boolean, unpressed?: string | null }} [o]  `commands: false`: a message that is one of Filament's chat commands — `/set`,
   *   `@mem`, `/compact`, a coding agent's `/sessions` — is refused, not answered: another machine's agents' turn
   *   (the remote-agents plan's f-fence), whose commands would change the chat's settings or read this machine's memory.
   *   Its message with no `allow` answers a waiting permission as Deny does, and the chats it tags are not its agent's to
   *   write letters to. `unpressed`: why its caller presses nothing (guards.js `pressRefused`), whose `/set` that lets the
   *   agent do more unasked, and whose `@mem` that makes an Always allow, is refused in those words
   */
  async function turn(id, input, req, res, arrival = null, { commands = true, unpressed = null } = {}) {
    const clock = turnClock(arrival);
    const chain = chainOf(id);
    if (!chain.meta?.native) throw clientSessionRefusal(chain, "the harness goes on in a fork of it");
    // Who begins the turn (core/turn-by.js): the input's `by`, or the boolean an older caller names its kind by — read
    // once, here; every rule after asks it by a trait, and each kind's own gate below is that kind's.
    const begun = turnBy(input);
    if ("error" in begun) throw refusal(400, begun.error);
    const by = begun.by;
    const who = TURN_BY[by];
    // Another machine's agents send a chat words (the remote-agents plan's f-fence): the turns Filament starts by itself
    // are none of theirs to start.
    if (!commands && !who.person) throw refusal(403, `another machine's agents send a chat words: ${who.what} is Filament's own to start`);
    // One turn at a time (D12): the harness's own second send keeps today's rule (409 and the steer mailbox); the
    // chat's move answers 409 with the holder, which the harness page turns into its waiting queue (D14) — it sends by
    // itself when the move is done. So does a turn a coding agent began by itself (AC3-9). A turn whose reply has
    // landed whole is waited for while it gives the session back (`settledTurn`).
    if (liveTurns.get(chain.id)?.res.writableEnded) await settledTurn(chain.id);
    const held = sessionTurns?.holder(chain.key) || null;
    const own = liveTurns.get(chain.id);
    // Filament's turn as a background command ended (E21, FO-D16, FO-D49): only where nothing else will tell the agent
    // — a turn that holds the chat hears it at its next step, an answer to a waiting question at the resumed loop's
    // next step — and only while such an end still waits untold. After the person pressed Stop, Filament never starts
    // the agent again by itself: their next message carries the end (FO-D50).
    // So does another agent's report that came for the agent while no turn ran (the owner's of 10-28): it rides ahead of
    // Filament's line, as the queued reports open every turn's message.
    const waking = by === "wake";
    // Nor in a chat the person archived, or one of a project they archived (`notByItself`), whatever came, and whether
    // or not a turn holds it now: final for the waker, and what came waits for the chat's next turn.
    // Asked once, for the three turns it holds back: a wake here, a goal's round and a resume below.
    const alone = by === "wake" || by === "goal" || by === "resume" ? notByItself(chain) : null;
    if (waking && alone) throw refusal(409, `${archivedSaid(alone)}, and Filament starts no turn in it by itself: its next turn carries what came`, { wake: "archived" });
    if (waking && (held || own)) throw refusal(409, WAKE_HELD, { wake: "held" });
    // Nor while room is made for the chat, nor before the person's message it was made for has gone (the owner's of
    // 11-09: a letter's wake ran on the session being compacted away, its cold context read whole, ahead of that
    // message). Final for the waker: that message's turn carries what came, and the room's end asks again where none
    // follows (`roomFor`).
    if (waking && roomNow(chain.id)) throw refusal(409, WAKE_ROOM, { wake: "room" });
    if (waking && pausedNow(chain)) throw refusal(409, "a question waits for an answer: the answer's turn hears the command's end", { wake: "asking" });
    if (waking && stoppedSince(chain)) throw refusal(409, "the chat was stopped: the next message carries the command's end", { wake: "stopped" });
    // A chat with no turn yet has no work of its agent's to go on with: its first message carries the report.
    const reportsWait = waking && !!subagents?.reportsDue?.(chain.id) && archive().newestTurnN(chain.id) > 0;
    // …and a letter from another chat that came while no turn ran (app/letters.js): it waits sealed, and the turn's list
    // of envelopes names it. Nor a chat with no turn yet, as for a report (a9e2a7944, the owner's of 10-28, kept for
    // letters as they came, fad4b1a52): its agent has nothing it was doing to go on with, and the letter's sender is
    // told so — "That chat has had no turn yet: nothing wakes it" (letters.js) — so its person's first message opens it.
    const lettersWait = waking && !!subagents?.lettersDue?.(chain.id) && archive().newestTurnN(chain.id) > 0;
    if (waking && !wakeDue(chain.id) && !reportsWait && !lettersWait) throw refusal(409, "no background command has ended untold, and no report or letter waits for a chat that has had a turn", { wake: "told" });
    // Filament's own turn as a goal's next round (core/goal-drive.js, the owner's of 11-05): only while that round is owed
    // and the goal still drives, and as a wake is — never over a turn, a question or the person's Stop.
    // A refusal that is final takes the owed round back (the waker sends no other): the turn it waits on decides again.
    const goaling = by === "goal";
    // Nor in a chat the person archived (`notByItself`): the round stays owed, and the chat's next turn decides again.
    if (goaling && alone) throw refusal(409, `${archivedSaid(alone)}, and Filament starts no turn in it by itself: the goal's round stays owed`, { wake: "archived" });
    if (goaling && (held || own)) throw refusal(409, WAKE_HELD, { wake: "held" });
    // The round stays owed: the room's end asks for it again (`roomFor`).
    if (goaling && roomNow(chain.id)) throw refusal(409, WAKE_ROOM, { wake: "room" });
    if (goaling && pausedNow(chain)) throw (goalOwed.delete(chain.id), refusal(409, "a question waits for an answer: its turn decides the goal's next round", { wake: "asking" }));
    if (goaling && stoppedSince(chain)) throw (holdGoal(chain.id, "stopped"), refusal(409, "the chat was stopped: the goal waits for /goal go", { wake: "stopped" }));
    const goalNow = goaling ? memory.goalFor?.(chain.id) : null;
    const driving = goaling ? driveOf(goalNow) : null;
    if (goaling && (!goalOwed.has(chain.id) || !driving || driving.halted)) throw (goalOwed.delete(chain.id), refusal(409, "no round of a driving goal is owed to this chat", { wake: "told" }));
    // A chat Memory settings left out since the round was owed: the goal rides none of its requests, and its round
    // would say "go on toward the goal" with no goal beside it — the drive halts, saying why.
    const goalOut = goaling ? memory.chatLeftOut?.(chain.id) || null : null;
    if (goalOut) throw (haltGoal(chain.id, { kind: "leftout", why: goalOut }), refusal(409, `memory leaves this chat out (${goalOut}): the goal's drive halted`, { wake: "told" }));
    const shellsCame = waking ? wakeKindOf(chain.id) : null;
    // What came of the agents' side, each kind once (the nudge map of 11-10: a check's verdict, the agent's own command
    // task's end, an apply's verdict all woke it as "another agent's report"): one kind says itself, several say what came.
    const agentsCame = reportsWait ? subagents?.dueKinds?.(chain.id) || ["report"] : [];
    const agentsKind = agentsCame.length === 1 ? agentsCame[0] : agentsCame.length ? "mixed" : "report";
    /** What came ahead of the wake's line, as its words say it (`wakeLineFor`). */
    const cameKind = reportsWait ? (shellsCame ? "mixed" : agentsKind) : shellsCame;
    // A check-in's line says that nothing came since only where its turn carries the check-in alone: no letter waits,
    // whose line follows it, and no word is queued for the agent, which rides ahead of it though it woke nothing.
    const idleBeside = cameKind === "idle" && (lettersWait || !!subagents?.peekQueued(chain.id)?.length);
    /** The wake's words: what came ahead of it, then a letter's line where one waits. */
    const wakeWords = [...(!lettersWait || reportsWait || wakeDue(chain.id) ? [idleBeside ? IDLE_BESIDE_WAKE_LINE : wakeLineFor(cameKind)] : []), ...(lettersWait ? [LETTER_WAKE_LINE] : [])];
    // A sync's message (proposal_ux §4.14) is Filament's: never one the person typed, nor an answer to their question.
    const syncing = by === "sync";
    if (syncing && !isSyncMessage({ content: input?.content })) throw refusal(400, "a sync's turn carries a sync's message");
    if (syncing && !held && !own && pausedNow(chain)) throw refusal(409, "a question waits for the person's answer: the sync goes once the answer's turn ends", { sync: "asking" });
    // A team's result (team_v2_plan §5.4) is Filament's message too, sent on the person's word — and so is a flow's end,
    // which goes the same way (HarnessV4_Flow_Plan FL-D11), and the turn a flow started In place opens to drive it
    // (HarnessV4_OneAgent_Plan OA4).
    const besiding = by === "beside";
    if (besiding && !isTeamResult({ content: input?.content }) && !isFlowEnd({ content: input?.content }) && !isFlowDrive({ content: input?.content }))
      throw refusal(400, "a team's result turn carries a team's result, a flow's end, or a flow's start in place");
    if (besiding && !held && !own && pausedNow(chain)) throw refusal(409, "a question waits for the person's answer: the team's result goes once the answer's turn ends", { beside: "asking" });
    // Filament's own turn in a flow's team box's chat — its line to go on, or what sent the box back (flow-runner.js): it
    // goes past the questions as a wake does, and is neither the person's Send as it is nor a message of theirs (the
    // owner's of 11-09: as Send as it is, a team led by a coding agent kept a print its session never loaded).
    // A thread's brief (core/threads.js) is Filament's to post as well: its starter's agent's words, the chat's first
    // message, never the person's nor a command of theirs. Taken only in a chat the archive links as a thread, from the
    // starter that link names, and only as Filament's one block: a message the turn would read a word of as the
    // person's (`personTextAt`, which a chat command is read from too) is refused. A brief whose turn failed is taken
    // again (the page's Retry): the chat's turns are briefs with no reply.
    const threading = by === "thread";
    if (threading && !isThreadBrief({ content: input?.content })) throw refusal(400, "a thread's brief turn carries a thread's brief");
    if (threading) {
      const from = archive().threadsOf(chain.id).from;
      if (!from) throw refusal(409, "a thread's brief goes to a chat started as a thread, and this is none");
      if (briefFrom({ content: input?.content }) !== from) throw refusal(400, "a thread's brief names the chat whose agent started it");
      if (personTextAt({ messages: [{ role: "user", content: contentBlocks(input?.content) }] }, 0).trim())
        throw refusal(400, "a thread's brief is one block of Filament's, its agent's words after the head: this one carries words beside it");
      const newest = archive().turnBodies(chain.id, { last: 1 })[0] || null;
      if (newest && (newest.final || !(newest.meta?.brief === true || briefSaidIn(newest)))) throw refusal(409, "a thread's brief is its first message, and this chat has turns: write it a letter instead");
    }
    // A watcher's wake of the chat that proposed it (app/routines.js `wakeChat`, the plan of 11-11) is Filament's to post
    // too: the watcher's block, what it heard and its words — a turn beside the person's, never a message of theirs. It
    // starts where a command's end would: not while room is made for the chat or before the message it was made for has
    // gone, not over a question that waits for the person, not after their Stop until they write again. Its runner
    // keeps what it heard, and sends it as the chat lets go.
    const watching = by === "watch";
    if (watching && !isWatchWake({ content: input?.content })) throw refusal(400, "a watcher's wake turn carries a watcher's wake");
    if (watching && !held && !own && roomNow(chain.id)) throw refusal(409, "room is being made for this chat: the watcher's turn goes once it is made", { watch: "room" });
    if (watching && !held && !own && pausedNow(chain)) throw refusal(409, "a question waits for the person's answer: the watcher's turn goes once the answer's turn ends", { watch: "asking" });
    if (watching && !held && !own && stoppedSince(chain)) throw refusal(409, "the chat was stopped: the watcher's turn goes after the person's next message", { watch: "stopped" });
    // A watcher's guidance to the chat it watches, which is at rest (app/watchers/guidance.js): Filament's block and the
    // reviewer's words, never a message of the person's. It starts where a watcher's wake would, and where it does not
    // its sender keeps it and sends it as the chat lets go. It runs in the chat's own mode: what it asks for is the
    // chat's own work.
    const guiding = by === "guide";
    if (guiding && !isGuidance({ content: input?.content })) throw refusal(400, "a watcher's guidance turn carries a watcher's guidance");
    if (guiding && !held && !own && roomNow(chain.id)) throw refusal(409, "room is being made for this chat: the watcher's guidance goes once it is made", { guide: "room" });
    if (guiding && !held && !own && pausedNow(chain)) throw refusal(409, "a question waits for the person's answer: the watcher's guidance goes once the answer's turn ends", { guide: "asking" });
    if (guiding && !held && !own && stoppedSince(chain)) throw refusal(409, "the chat was stopped: the watcher's guidance goes after the person's next message", { guide: "stopped" });
    // A routine's run, a Space ask's run and a team's opening are Filament's first message to a chat it made for each
    // (app/routines.js, which marks the chat `routine`; app/space-asks.js, `ask`; app/teams-beside.js, a team's own chat
    // beside, `beside`): taken only in such a chat, while it has no turn. Never the person's — nor sent again: the page
    // offers no Retry of one (the transcript's `opening`).
    if (by === "routine" && !chain.meta?.routine) throw refusal(409, "a routine's run goes to the chat Filament made for it, and this is none");
    if (by === "ask" && !chain.meta?.ask) throw refusal(409, "an app's ask runs in the chat Filament made for it, and this is none");
    if (by === "team" && (chain.kind !== "team" || !chain.meta?.beside)) throw refusal(409, "a team's opening goes to the team's own chat beside, and this is none");
    if (who.opens && archive().newestTurnN(chain.id) > 0) throw refusal(409, `${who.what} is its chat's first message, and this chat has turns`);
    // Filament's own turn going on with one a restart cut off (TG2-D83): Filament's words, not the client's.
    const resuming = by === "resume";
    // Nor in a chat the person archived (`notByItself`): the start's plan holds its cut turn (resume-cut.js
    // `resumePlan`), and one asked for all the same is refused here. The chat's next turn has the cut turn's work.
    if (resuming && alone) throw refusal(409, `${archivedSaid(alone)}, and Filament starts no turn in it by itself: its next turn goes on from what the cut turn had done`);
    // …and any other turn of Filament's own waits out a question for the person, as a team's result does: it would be read
    // as the answer to it (the review of 54f63529f) — the flow keeps its line, and sends it once the answer's turn ends. A
    // resume goes on in its row, as an answer does.
    if (!who.person && !resuming && !held && !own && pausedNow(chain)) throw refusal(409, `a question waits for the person's answer: ${who.what} goes once the answer's turn ends`, { byFilament: "asking" });
    // What started it came from outside the chat, with nobody there: its turn reads only, whatever the chat's own mode
    // (below, where the turn's mode is said). Decided here from who begins the turn itself, never from the body's
    // `permissions`, which is a press. `works` — its watcher writes — has the turn run in the chat's own mode: no more
    // than any message posted to this chat would do, so it needs no press.
    const watchReads = watching && input?.works !== true;
    if (held?.own) throw otherTurnRefusal(held);
    if (held?.window === "harness" || own) throw ownTurnRefusal(held?.requestId ?? own?.requestId ?? null, held?.since ?? own?.startedAt);
    if (held) throw otherTurnRefusal(held);
    let content = resuming ? [{ type: "text", text: RESUME_LINE }] : waking ? wakeWords.map((text) => ({ type: "text", text })) : driving ? [{ type: "text", text: goalRoundLine(driving.round + 1, driving.cap) }] : contentBlocks(input?.content);
    if (!content) throw refusal(400, "content is required: a string, or a list of content blocks");
    // A command read as the turn reads one below (`typedCommand`), whichever engine answers: refused before anything moves.
    if (!commands) {
      const said = personTextAt({ messages: [{ role: "user", content }] }, 0);
      if (chatCommandOf(said, { memory, situated: memory.isOpen() }) || parseStatusCommand(said.trim()) || parseAgentCommand(said.trim()))
        throw refusal(400, "another machine's agents send a chat words: Filament's chat commands are the person's, typed here");
    }
    // A `/set` or an `/unset` that lets the agent do more unasked is a press (commands/settings.js `setAsksLess`): this
    // computer's caller without the desktop app's key is refused it in `unpressed`'s words, as the settings rows are.
    // So is an `@mem confirm` or `@mem correct` that makes an Always allow (commands/mem.js `memAsksLess`), as the
    // Memory page's rows are: what a row refuses unpressed, the same act typed as chat words is refused here.
    if (unpressed) {
      const typed = chatCommandOf(personTextAt({ messages: [{ role: "user", content }] }, 0), { memory, situated: memory.isOpen() });
      if ((typed?.kind === "settings" && setAsksLess(typed.cmd)) || (typed?.kind === "mem" && memAsksLess(memory, typed.cmd))) throw refusal(403, unpressed, { press: true });
    }
    if (input?.settingsPatch && typeof input.settingsPatch === "object" && Object.keys(input.settingsPatch).length)
      patchSettings(chain.id, { patch: input.settingsPatch }, { via: "turn" });
    const cfg = config.get();
    const settings = settingsOf(chain.id);
    const eff = settings.effective;
    // A session opened from another client's chain has no document of its own yet: its turns keep the chain's model.
    const modelName = String(eff.model?.name || chain.model || "").trim();
    if (!modelName) throw refusal(400, "the session has no model: set model.name (in the turn's settingsPatch, or on the session's settings)");
    const model = turnModelName(cfg, eff, modelName);
    const inner = parseAgentModel(modelName)?.model || modelName;
    // A turn held to reading is held by what the chat's agent asks Filament before it acts. A coding agent in the mode
    // its chat's model sets (`…@bypassPermissions`, read off the name its turn sends as acp-turn.js renders it: engine.js
    // `agentModeOf` — a route's own model may set one the name does not show, the second read of 11-12) runs in that
    // mode, and where it asks nobody there (acp/configure.js `modeAsks`) nothing would hold it: the watcher's turn is
    // refused, its failure to say. An agent that offers no mode in which it asks is known only once its session is
    // open: that one is not told here.
    if (watchReads) {
      const up = agentSessionOf(cfg, inner);
      const named = up ? agentModeOf(cfg, parseAgentModel(model)?.model || model) : null;
      if (named && !modeAsks(named, findUpstream(cfg, up)?.acp || {}))
        throw refusal(409, `this chat's coding agent runs in the mode its model's name sets (${named}), in which it asks Filament nothing before it acts: a turn held to reading cannot be held here`, { watch: "unheld", mode: named });
    }
    const cwd = cwdOf(chain);
    // A chat another machine's agents started in a copy here holds it while its turn runs (services/copies.js `lease`):
    // one whose copy went to a newer launch, or went, is refused, its folder no longer what its agent worked in.
    const copy = copyLease ? archive().metaOf(chain.id, ["copy"])?.copy : null;
    if (typeof copy === "string" && copy) {
      const no = /** @type {NonNullable<typeof copyLease>} */ (copyLease).start(copy, chain.id);
      if (no) throw refusal(410, `this chat works in a copy another machine sent: ${no}`);
    }
    // The lock is taken LAST, right before the try that releases it — the refusals above must never hold it
    // (only its release frees it: a refused turn leaking it would hold the session until Filament restarts). Lost the
    // race? The answer is the same 409 family as above, not a free run.
    const lock = takeLock(chain.key);
    clock.mark("lock");
    if (sessionTurns && !lock) {
      const again = sessionTurns.holder(chain.key);
      throw again?.window === "harness" && !again.own ? ownTurnRefusal(again.requestId, again.since) : otherTurnRefusal(again);
    }
    // The message the room was made for has come — the person's, or another machine's agents' in their own chat, whose
    // Compact and send holds it as the person's does: what a wake waited with goes in its turn. No turn of Filament's
    // own is that message (a sync's or a team's result took it once, and a wake could run ahead of the person's).
    if (who.person) roomTaken(chain.id);
    // A message of the person's own — a command they typed and an answer to what waits among them: not Filament's own
    // turns (core/turn-by.js), one nobody is there for (`unattended`), nor another machine's agents' (`commands: false`).
    // One rule for what reads it: when they last wrote, so a start wakes no chat they left over a day ago
    // (sessions/owed-wakes.js `staleWords`), and a driving goal's halt (`typedHalt`) — FabeleHelper's of 11-10.
    const personWrote = who.person && input?.unattended !== true && commands;
    if (personWrote) keepPersonAt(chain.id);
    // …and a chat they archived is in use again (`backFromArchive`). No turn of Filament's own brings one back; nor
    // does their message bring back a project they archived, whose flag is the left bar's to set.
    if (personWrote && chain.meta?.archived) backFromArchive(chain);
    // `cancel` is the turn's own stop (cancelTurn): it reaches the turn from here to the end — while it composes and
    // while it waits for the model's first byte, when no request id exists yet to cancel by.
    const { live, gaveBack } = liveTurnFor(res);
    liveTurns.set(chain.id, live);
    watchHead(res, chain.key, live, lock);
    /** Its copy held again while the turn runs, however long. @type {ReturnType<typeof setInterval> | null} */
    let renew = null;
    try {
      if (typeof copy === "string" && copy && copyLease) {
        const lease = copyLease;
        renew = setInterval(() => void lease.start(copy, chain.id), COPY_RENEW_MS);
        renew.unref?.();
      }
      memory.assertPrivacy(chain.id);
      // The chat's work stretch goes on with this turn, or begins with it: Filament's own turn as what its agent waited on
      // came — a command's end, a report, a team's result — or as a cut turn goes on, goes on with it.
      // The round is taken, and counted: the next one is owed only by this one's end.
      if (goaling && driving) {
        goalOwed.delete(chain.id);
        memory.setGoal(chain.id, { ...goalNow, drive: { ...driving, round: driving.round + 1 } });
      }
      stretchStep(chain.id, "begun", () => stretches.began(chain.id, { woken: who.woken }));
      // Any turn drops the idle wake (idle-wake.js); its back-off goes on only where Filament's check-in alone woke it.
      idleStep(chain.id, () => idleWake?.began(chain.id, { idle: shellsCame === "idle" }));
      // The agent compacting its own session on request (HarnessV3-ACP AC5-5): this turn goes to that session, and
      // waits for it — said while it does, as a compaction at the line is. Its stop reaches it there too.
      const owned = owning.get(chain.id);
      if (owned) {
        if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, { kind: "compacting", method: "own", since: now() });
        await Promise.race([owned, new Promise((r) => live.cancel.signal.addEventListener("abort", r, { once: true }))]);
        if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, null);
        if (live.cancel.signal.aborted) throw refusal(409, "the turn was stopped from the harness before it was sent to the model");
      }
      const copying = copies?.running(chain.id) || null;
      if (copying) await waitForCopy(chain, lock, live, copying);
      // A block its first message waits for — a hunt's range, read from git as its lead starts (the plan's p6) — set in
      // after the record and a flow's hand-off, ahead of the person's words.
      const opening = who.line ? null : openings.get(chain.id);
      if (opening) {
        openings.delete(chain.id);
        opening.taken();
        const block = await Promise.race([opening.block.catch(() => null), new Promise((r) => live.cancel.signal.addEventListener("abort", () => r(null), { once: true }))]);
        if (live.cancel.signal.aborted) throw refusal(409, "the turn was stopped from the harness before it was sent to the model");
        if (block) {
          const at = content.findIndex((/** @type {any} */ b) => !isRecordBlock(b) && !isHandoffBlock(b));
          content = at < 0 ? [...content, block] : [...content.slice(0, at), block, ...content.slice(at)];
        }
      }
      const all = archive().turnBodies(chain.id);
      // A resume goes on with the chat's newest turn, which a restart cut off or a clean stop failed (TG2-D85); with
      // neither, there is nothing to go on with. A failed turn that did no work drops out of the history, as Retry
      // expects: Filament's turn carries its message again, ahead of Filament's line.
      if (resuming) {
        const last = all.length ? all[all.length - 1] : null;
        const cut = !!last && cutOffBefore(last, bootAt);
        if (!last || last.final || !(cut || last.meta?.failed)) throw refusal(409, NOTHING_TO_RESUME);
        if (!cut && !last.work?.length) content = [...messageBlocks(last.user), { type: "text", text: RESUME_LINE }];
      }
      // A turn of Filament's own while the plan its agent offered still waits on its card (the owner's of 11-10): the agent
      // is told so, ahead of Filament's line — which still ends the message, where its readers find it.
      if (!who.person && planOfferWaits(all, bySince())) content = [{ type: "text", text: PLAN_OFFER_WAITS }, ...content];
      const completed = all.filter((t) => t.finished && !t.meta?.command && !t.meta?.rewound);
      // The history the model reads: the finished turns, those that failed after doing work (HarnessV3-FailurePoints
      // §6 item 1), and those a restart cut off before their reply (2b-C D8).
      const viewed = modelTurnsOf(all, bootAt);
      const cutOff = viewed.filter((t) => t.meta?.cutOff).length;
      // Those the model's provider refused are left out, Filament's line in their place where they did work.
      const refused = all.filter((t) => !t.meta?.command && !t.meta?.rewound && refusedTurn(t));
      const refusedDone = refused.filter((t) => t.finished).length;
      const refusedLines = viewed.filter((t) => t.meta?.refused).length;
      const failedKept = viewed.length - (completed.length - refusedDone) - refusedLines - cutOff;
      const unanswered = all.filter((t) => !t.finished).length - cutOff - failedKept - (refused.length - refusedDone);
      let compactions = compactionsOf(chain.id);
      const window = sessionWindowFor(cfg, inner, eff.model?.window).tokens || null;
      clock.mark("archive");
      let turnsNow = viewed;
      // What the developer typed, as memory reads the person's words, and the chat command it is, as the chat-command
      // stage will read it (commands/recognize.js). One Filament answers itself reaches no model: its turn is neither
      // compacted at its start nor stopped for size below (HarnessV3-Launch LD-D6). `/status`, `/cost` and `/help`
      // are answered in every chat the harness opens — an API model's by the stage, a coding agent's by its own turn.
      const typed = personTextAt({ messages: [{ role: "user", content }] }, 0);
      const own = chatCommandOf(typed, { memory, situated: memory.isOpen() });
      const agentUp = agentSessionOf(cfg, inner);
      // A coding agent's session also has Filament's agent commands (`/compact`, `/sessions`…, commands/acp.js): none
      // reaches the agent's model as a message.
      const typedCommand = !!own || !!parseStatusCommand(typed.trim()) || (!!agentUp && !!parseAgentCommand(typed.trim()));
      // A `/goal accept` or `/goal go`: the goal's drive as it stood, so that its end drives only where the command
      // changed it — a refused one starts nothing (core/goal-drive.js).
      const goalStarts = own?.kind === "goal" && (own.cmd.action === "accept" || own.cmd.action === "go");
      const driveBefore = goalStarts ? JSON.stringify(memory.goalFor?.(chain.id)?.drive ?? null) : "";
      // A message that answers a turn still waiting — a question, a permission — goes on in that turn: it asks nothing
      // first (HarnessV4_Tasks C26: a turn that is running makes room by itself). Only Filament's loop asks one, and only
      // its turn answers it: the person's message to a coding agent leaves it unanswered and ends its park (`leaves`),
      // once the turn can no longer be refused. The permission switch sent to a coding agent is its words too, as any
      // message is: no header of the loop's goes with it.
      const parked = pausedNow(chain);
      const leaves = !!parked && !!agentUp && !typedCommand;
      const modeSwitch = !agentUp && input?.modeSwitch === true;
      // The person's press on the card (`allow`): Allow is the one way the call it waits on runs — their words never are —
      // and Deny's words never run it, /allow among them. Null where the message is no press, and Deny where it is another
      // machine's agents' (`commands: false`), whose press comes through the asks route alone: their words never run it.
      const press = !!parked && !leaves ? (typeof input?.allow === "boolean" ? input.allow : commands ? null : false) : null;
      const answering = (!!parked && !leaves) || modeSwitch;
      // A turn nobody is at the page for (`unattended`: Filament's replay of a session's turns in a copy,
      // replay-compare.js) has no one to answer a question: it asks none, and makes room by the session's method.
      const unattended = input?.unattended === true;
      // A coding agent's session (HarnessV3-ACP AC5-3): the agent composes its own context and compacts it itself, and
      // Filament's composition only seeds a fresh agent session. Its line is the share of the agent's window the session
      // chose, against what the agent last said it holds (`agentHeld`); the composition's line below is not for it.
      // The word is the finished turns', and that of a turn a restart cut off or that failed after doing work, whose
      // agent session holds what it had read (HarnessV4_Tasks A2, B1): the turns the model reads (`viewed`). Where the
      // agent's bridge keeps no session the chat's next turn goes on in (`none`), though the chat's last turn was this
      // agent's and Filament has not compacted since, nothing the agent said it held stands. `lost` where it had one —
      // a turn of the chat ran in it, and its record is gone or an undo left none standing there: the person is asked
      // first (C26). A turn stopped before its session was up left none to lose, and the next asks nothing of it.
      const ref = agentUp ? { upstream: agentUp, chainId: chain.id, cwd, base: basesOf(compactions, viewed).of(agentUp) } : null;
      // Another coding agent's own turn (`meta.own`, AC3-9) is that agent's work reporting back: nothing of this agent's
      // session, its line or its cache — nor of the loop's, every such turn another's there (the review of cb2d2d1f0:
      // Codex's cache was read off Claude's turn, and the loop's found none to read).
      const othersOwn = (/** @type {any} */ t) => !!t.meta?.own && t.meta?.facts?.upstream !== agentUp;
      const seen = viewed.filter((t) => !othersOwn(t));
      const done = completed.filter((t) => !othersOwn(t));
      // The turn the chat last went on from: the newest finished one but a coding agent's own — Claude's own turn after
      // the person moved the chat away from it is that agent's work reporting back, not the chat moving back to it (the
      // owner's of 11-08: the switch's card came again at the person's next message).
      const movedRow = done.findLast((t) => !t.meta?.own) || done.at(-1) || null;
      const lastUp = movedRow?.meta?.facts?.upstream;
      const fromOurs = !!agentUp && !typedCommand && startsFromOurs({ turns: seen, compactions, upstream: agentUp });
      // The person rewound turns this agent answered, and none of its turns ran since (rewind.js): its session holds
      // what the conversation no longer does, so it is let go of, and this turn starts a fresh one from Filament's copy.
      const lastSeen = Number(seen.at(-1)?.n) || 0;
      const rewoundAway = !!ref && !typedCommand && all.some((t) => !!t.meta?.rewound && t.n > lastSeen && t.meta?.facts?.upstream === agentUp);
      if (rewoundAway && agentSelf?.holds(ref)) agentSelf.forget(ref);
      // A switch into the agent: another engine answered last (HarnessV3-ACP AC-R1). Not where a turn of this agent's that
      // failed after doing work, or that a restart cut off, came since (`madeAlready`): that turn was the switch, and the
      // chat goes on from it. This agent's own turn since is no such turn — the chat went on elsewhere, and the session
      // it ran in missed that (the review of cb2d2d1f0: it went on with none of it handed over).
      const madeAlready = !!movedRow && seen.some((t) => t.n > movedRow.n && !t.meta?.own && !t.meta?.refused && t.meta?.facts?.upstream === agentUp);
      const none = !!ref && !typedCommand && (rewoundAway || ((lastUp === agentUp || madeAlready) && !fromOurs && agentSelf?.holds(ref) === false));
      // The chat's last turn on this agent was refused by the model's provider: the bridge lets that session go, and this
      // turn starts a new one from the composition, which leaves the refused turn out. Nothing was lost to ask about.
      const lastTurnDone = done.at(-1);
      const refusedLast = none && !rewoundAway && !!lastTurnDone && refusedTurn(lastTurnDone);
      const lost = none && !refusedLast && !rewoundAway && hadSession(done, /** @type {string} */ (agentUp));
      // Lost because the chat moved to another place since the agent's last turn (HarnessV4_Git_Plan §12): the agent's
      // sessions are by folder, and the question names the move.
      const movedTo = lost ? movedSince(chain.meta, done.at(-1)?.n) : null;
      const switchedIn = !!agentUp && !typedCommand && !madeAlready && !!lastUp && lastUp !== agentUp;
      const at = agentUp && !typedCommand && !none && !switchedIn ? agentHeld({ turns: seen, compactions, upstream: agentUp, window }) : null;
      const agentAt = at ? agentLine(at, eff.context?.compaction) : null;
      // The turn starts a fresh agent session from this composition: a switch into the agent, a chat the agent keeps no
      // session of, or one Filament compacted the chat under since its last turn (AC5-1). The composition is what the
      // agent will hold, so its line is the agent's line then.
      const seeds = switchedIn || none || (!at && fromOurs);
      const agentName = agentUp ? agentTitle(findUpstream(cfg, agentUp) || { id: agentUp }) : "";
      // The switch (HarnessV4_Tasks A7): another login of the same agent (`agentKey`) is an account switch, where the
      // turns since the newest compaction go whole — what the session on the other account held, every call one of the
      // same agent's tools — on the same model or another, as the card recommends (the owner's of 11-08, G7: the card
      // said Whole and the server Words on another model). The form is the card's answer (`carry`), else that, else the
      // session's own (`context.carry`). The login that answered last is read switched off too: a move off one whose plan
      // ran out is an account switch still (the hunt of 11-08).
      const fromUp = switchedIn ? (cfg.upstreams || []).find((/** @type {any} */ u) => u.id === String(lastUp)) || null : null;
      const toUp = agentUp ? findUpstream(cfg, agentUp) || null : null;
      const accountSwitch = !!fromUp && !!toUp && isAgentUpstream(fromUp) && agentKey(fromUp) === agentKey(toUp);
      const lastModel = switchedIn ? String(movedRow?.meta?.facts?.model || "") || null : null;
      const toRoute = switchedIn ? findRoute(cfg, model) : null;
      const sentAs = toRoute ? renderUpstreamModel(toRoute.upstreamModel, model, toRoute.captures || []) || model : null;
      const modelKept = accountSwitch && !!lastModel && !!sentAs && sameModel(cfg, lastModel, sentAs);
      const chosenForm = typeof input?.carry === "string" && CARRY_FORMS.includes(input.carry) ? input.carry : null;
      const sessionForm = carryOf(eff);
      const switchForm = accountSwitch ? "plain" : sessionForm;
      // A session the agent lost — the chat moved to another folder, where its sessions are by folder, or the agent let it
      // go — is the same agent on the same model: its fresh one is handed the turns whole, what the lost one held (the
      // owner's word of 11-06: a move carried five sub-agents' reports as one counted line). The card's answer stands,
      // and so does a form a layer chose (`context.carry`).
      const lostForm = lostFormOf(settings, eff);
      // So does one lost to a move or a rewind, a Compact now since or not (`lostBy`, the hunt of carry-move).
      const lostTo = seeds && !switchedIn ? lostBy(chain.meta, agentUp, all, viewed) : null;
      // Any other fresh start — after Filament's compaction among them, which a lost session's Compact and send makes
      // first — carries the card's answer where one came, else the session's own (the review of 8bcb358fc).
      const form = switchedIn ? chosenForm || switchForm : lost || lostTo ? chosenForm || lostForm : seeds ? chosenForm : null;
      // Back on an agent whose session of the chat is still up (the bridge's, by upstream, folder and the newest
      // compaction): it goes on in it, handed the turns it missed in that form — not a fresh one.
      const resumes = switchedIn && !!ref && agentSelf?.holds(ref) === true;
      /** Why the turn starts a fresh agent session from the composition, where it does. */
      const freshWhy = accountSwitch
        ? `you switched to ${agentName} from ${agentTitle(/** @type {any} */ (fromUp))}, another account of the same agent`
        : switchedIn
        ? "another model answered last"
        : rewoundAway
          ? `you rewound turns ${agentName} answered`
        : refusedLast
          ? `${agentName} refused the chat's last turn`
        : lost
          ? movedTo
            ? `the chat moved to ${movedTo}, where ${agentName} has no session of it yet`
            : `${agentName} keeps no session of this chat any more`
          : none
            ? `${agentName} has no session of this chat yet`
            : "Filament compacted its copy of the chat since the agent's last turn";
      // What a message does past the line (`context.compaction.mode`, C26): `ask` stops it with the ways to make room,
      // `auto` makes room by the session's method and sends. Filament's own turns — a wake, a goal's next round, a
      // resume, a sync, a team's result, a flow's line — ask nothing either, as they pass the switch's, the change's and
      // the cold questions below: nobody sees the card, and a goal's round counted at its start would be spent (the hunt
      // of 11-08, T1 #4).
      const asks = eff.context?.compaction?.mode === "ask" && !answering && !unattended && who.person;
      // The line the agent is handed (HarnessV4_Tasks A3): Filament weighs the session between turns only, so an agent
      // that takes a line of its own acts on it in the middle of one — under `ask` too, where it is a message that
      // asks and a running turn that makes room. The share the session chose of the window the agent named, else of
      // Filament's for the model; none while nobody knows a window.
      const lineWindow = agentUp ? namedWindow(viewed, agentUp) || at?.window || window : null;
      const agentsLine = lineWindow ? usableWindow(lineWindow, eff.context?.compaction) : null;
      // What will read the session, and its cache as the message is sent (cache-clock.js): what the question shows,
      // whichever it is. A coding agent's cache is counted where that agent answered last and its session goes on,
      // for the longest life a cache has; a model Filament calls has its own (`modelCache`).
      /** @type {import("./cache-clock.js").Reader} */
      const reads = agentUp ? { kind: "agent", name: agentName, from: seeds ? "copy" : "session" } : { kind: "model", name: inner, from: "copy" };
      const lastTurn = typedCommand ? null : seen.at(-1) || null;
      const idleMs = lastTurn && endedAtOf(lastTurn) ? Math.max(0, now() - endedAtOf(lastTurn)) : 0;
      const cache = !lastTurn
        ? null
        : !agentUp
          ? modelCache(chain, cfg, inner, lastTurn, eff.model?.cacheTtl)
          : lastUp === agentUp && !seeds
            ? cacheClock({ endedAt: at?.endedAt || endedAtOf(lastTurn), ttlMs: AGENT_CACHE_MS, now: now() })
            : null;
      // A switch asks first, every time (HarnessV4_Tasks A7): the card says what happens now and which form of the
      // turns the fresh session carries, Whole first where the account changed and the model did not. Not a turn that
      // answers a waiting one, nor one nobody is there for; the card's answer names its form (`carry`), and Send as it
      // is (`sendAsIs`) goes with the one it suggests. Nor Filament's own turns — a wake, a goal's next round, a resume, a
      // sync, a team's result, a flow's line in its team box's chat — which go with that one too, as they pass the
      // change's and the cold questions below: the picker writes the model at once, and a card on them would hold the
      // chat for an answer nobody gives (the owner's of 11-08: a wake after a pick waited for the person, a goal's round
      // stalled).
      if (switchedIn && !answering && !unattended && who.person && input?.sendAsIs !== true && !chosenForm) {
        /** @type {import("./switch-question.js").SwitchQuestion} */
        const q = {
          from: { upstream: String(lastUp), name: fromUp && isAgentUpstream(fromUp) ? agentTitle(fromUp) : lastModel || String(lastUp), model: lastModel },
          to: { upstream: String(agentUp), name: agentName, model: sentAs },
          account: accountSwitch,
          sameModel: modelKept,
          resumes,
          // The copy starts from a summary: Filament's, or an agent's own (HarnessV4_Tasks A8).
          compacted: !!compactionHead(compactions),
          suggested: switchForm,
          session: sessionForm,
          window: lineWindow,
          usable: agentsLine,
          own: ownShareOf(viewed, String(agentUp), cwd) ?? (accountSwitch ? ownShareOf(viewed, String(lastUp), cwd) : null),
          // None where the agent goes on in its own session: a summary first would move the copy's head, and drop it.
          handoff: resumes ? null : await handoffOf(chain, cfg, settings, all, viewed, compactions, cwd, model),
        };
        throw refusal(409, switchWords(q), { switchQuestion: q });
      }
      // A switch into a model Filament calls (the owner's of 11-08: the card should offer a handoff, and a switch into
      // the loop asked nothing): the chat's last turn was a coding agent's, or another model's — by its name and by the
      // model its route sent, so an effort, an alias or another provider of the same model is none. Its instructions
      // and tools are built for the model now, the conversation read from Filament's copy; asked once the composition
      // says what it weighs (below). The turn read is the newest the model reads but an agent's own — a turn that failed
      // after doing work on the new model is the switch made already —, the one the handoff and `compact`'s `by: "last"`
      // read (the review of fd62160df: the card came again, offering the new model's own summary).
      const lastRow = !agentUp && !typedCommand ? viewed.findLast((t) => !t.meta?.own) || viewed.at(-1) || null : null;
      const rowUp = lastRow?.meta?.facts?.upstream;
      const outUp = lastRow && rowUp ? findUpstream(cfg, String(rowUp)) || null : null;
      const fromAgent = !!outUp && isAgentUpstream(outUp);
      const nowRoute = lastRow ? findRoute(cfg, inner) : null;
      const nowWire = nowRoute ? renderUpstreamModel(nowRoute.upstreamModel, inner, nowRoute.captures || []) || inner : null;
      const lastWire = String(lastRow?.meta?.facts?.model || "") || null;
      const fromModel = !!lastRow && !fromAgent && !!lastRow.model && !sameModel(cfg, String(lastRow.model), model) && !(lastWire && nowWire && sameModel(cfg, lastWire, nowWire));
      const loopIn = (fromAgent || fromModel) && !answering && !unattended && who.person && input?.sendAsIs !== true;
      // What does not fit is said apart (`why`) from what a client does next: a page with the answers as buttons shows
      // the first alone.
      if (at && agentAt?.over && asks) {
        const why = heldWords(at, agentAt.usable);
        throw refusal(409, `${why} — choose how to make room and send again (Compact and send), or set context.compaction.mode to auto`, { needsCompaction: true, why, sentTokens: at.held, usable: agentAt.usable, window: at.window, estimated: at.estimated, reads, cache });
      }
      // What the chat sends ahead of its history (agent/prefix.js; the owner's of 11-06): the build's words and tools and
      // the chat's MCP servers, tools, skills, web and browser, as they stand, against the print it last sent. In the
      // loop every request sends them as they are now, so a print that moved writes the whole history to the provider's
      // cache again; a coding agent's session that goes on can keep what it already loaded in its old form (the bridge
      // hands a reopened session the chat's MCP servers as they are, but a resumed Claude Code session keeps the tool
      // definitions its transcript holds), so only a fresh one surely reads them. Either asks first (`context.compaction.changeQuestion`). A compaction since the loop's last print made
      // the history it writes again small: nothing is asked of it.
      const print = typedCommand ? null : printOf(chain, eff, !!agentUp, compactions);
      const changeAsks = !!print && !answering && !unattended && who.person && input?.sendAsIs !== true && compactionSettingsOf(eff).changeQuestion;
      const changes = print && changeAsks && (!agentUp || !seeds) ? print.changes : [];
      // A session whose cache has gone cold asks first (the cold question, `context.compaction.resumeQuestion`), where
      // the message could go as it is — unless it is the answer Send as it is (`sendAsIs`), answers a waiting turn, or
      // is a turn nobody is there for. What it sends ahead changed too: the same question says so (`changes`).
      // An agent's session that goes on is asked here; a model Filament calls, and a lost session's fresh start, once
      // the composition says what they will read (below).
      // A resume after a restart goes as it is, as Send as it is would (TG2-D83): its every other question stops it.
      // So does a wake (E21, FO-D16): the developer asked for the chat to go on — and a sync, which the person ran.
      const coldAsks = !typedCommand && !answering && !unattended && who.person && input?.sendAsIs !== true && compactionSettingsOf(eff).resumeQuestion;
      const agentCold = coldAsks && cache?.state === "cold";
      if (agentUp && !seeds && !agentAt?.over && (agentCold || changes.length)) {
        /** @type {import("./cache-clock.js").ResumeQuestion} */
        const q = { why: agentCold ? "cold" : "changed", ...(changes.length ? { changes } : {}), idleMs: cache?.idleMs ?? idleMs, held: at?.held ?? null, estimated: !!at?.estimated, window: at?.window ?? null, usable: agentAt?.usable ?? null, reads, cache };
        throw refusal(409, resumeWords(q), { resumeQuestion: q });
      }
      // Sub-agents' reports that reached the session while no turn ran open this turn's message, ahead of what the
      // developer typed — archived with it, so every later request carries the same bytes. A chat command's turn is
      // Filament's, not the model's: the reports wait for a turn a model reads. So does an answer to a waiting question
      // or permission, which the loop reads whole as the answer (HarnessV3-AtHome AH-F3): the resumed loop's inbox
      // opens with the queue, and its next round delivers them. They leave the queue once the turn can no longer be
      // refused.
      const carriesNone = typedCommand || (!!parked && !leaves);
      const queued = carriesNone ? [] : subagents?.peekQueued(chain.id) || [];
      // The developer's words overrule what saved agents answered the agent (`overrules`, HarnessV4_Tasks E15 step 3):
      // Filament says whose answers, ahead of the words. They are composed here and recorded once the turn can no longer
      // be refused; an answer to a waiting question hands them to the resumed loop the way it takes the queue. A chat
      // command's turn overrules nothing.
      const overrules = typedCommand ? [] : subagents?.overruleFrames?.(chain.id, input?.overrules) || [];
      const framed = carriesNone ? [] : overrules;
      // The main agent's background shells that exited while no turn ran (HarnessV3-Tools TL-D24) follow them, a line
      // each, and are told once the turn can no longer be refused, as the reports leave their queue. An answer carries
      // none either: the resumed loop tells them at its next round boundary.
      const shellOwner = { session: chain.id, agent: null };
      const exits = carriesNone ? [] : peekShellExits(shellOwner);
      // The saved agents this turn's main agent may ask are named with the message itself, first of Filament's blocks
      // (HarnessV4_Tasks E15 step 3, AG-74): a model weighing two ways has its instructions' rule far behind it, and
      // the message in front of it. Only where the turn's agent holds the tool that asks them: Filament's loop with its
      // agent tool on, or a coding agent, whose tool the session's list is. Archived with the message, as the reports
      // are; a command's turn and an answer to a waiting question carry none, nor does a coding agent's own command
      // ("/review"): the agent reads one only at the start of its prompt.
      // A coding agent reaches Filament's tools over its MCP connection alone: one that takes none over HTTP has neither the
      // agent tool nor the team tool, and is told so (the bug round of 10-23).
      const agentReach = !!agentUp && (agentTakesMcp ? agentTakesMcp(agentUp) !== false : true);
      const toolOn = agentReach || (!agentUp && harnessRunsLoop(cfg, inner) && !disabledTools(loopConfig(cfg.agentLoop || {}, eff?.loop || null).tools).includes("agent"));
      const mayAsk = carriesNone || !toolOn || (!!agentUp && !!slashWordOf(typed.trim())) ? [] : subagents?.asks?.(chain.id) || [];
      const asking = mayAsk.length ? [askLine(mayAsk.map((a) => a.tag))] : [];
      // The agents and teams the developer named with an `@` past the message's start (HarnessV4_OneAgent_Plan OA2,
      // L27: "there should be a process mid way instead of it immediately going to tagged agent"): nothing starts at
      // Send — the line ahead of the words tells the main agent to use them, through Filament's agent and team tools,
      // when the work is ready for them, or says which of those tools this chat has off. None for a command's turn, an
      // answer to what waits (read whole as the answer), or Filament's own; a team's own chat starts no teams.
      const plain = who.person && !typedCommand && !answering;
      // `/flow <words>` (HarnessV4_OneAgent_Plan OA3, OA-D6, L22): the developer asks the main agent to design a flow from
      // their words. The page sends the words with `flow` on; the line ahead of them gives the rules of a flow and the
      // developer's agents and teams, or says the chat has the flow tool off. Its names are the flow's, not ones to use
      // now. A team's own chat draws none.
      const flowing = plain && input?.flow === true;
      if (flowing && chain.kind === "team") throw refusal(400, "a team's own chat draws no flow: ask for one in its main chat");
      const useAgents = plain && !flowing ? subagents?.usesOf?.(input?.use) || [] : [];
      const useTeams = plain && !flowing && chain.kind !== "team" ? besides?.()?.usesOf(input?.useTeams) || [] : [];
      const use = [...useAgents, ...useTeams];
      const loopOff = disabledTools(loopConfig(cfg.agentLoop || {}, eff?.loop || null).tools);
      const teamOff = !!agentUp ? !agentReach : !harnessRunsLoop(cfg, inner) || loopOff.includes("team");
      const uses = use.length ? [useLine(use, { off: { agent: !toolOn, team: teamOff } })] : [];
      const flowRuns = flowing ? flows?.() || null : null;
      // A model that takes no tools runs Filament's loop in words alone (agent/turn.js `wordsOnly`): no flow tool, no
      // task graph.
      const toolsSaid = agentUp ? null : modelCapsFor(cfg, inner)?.tools || null;
      const wordsOnly = !!toolsSaid && !toolsSaid.available;
      // Why the flow tool is out of reach, where it is: the words say what helps (the bug round of 10-23).
      const flowOff = !flowRuns ? "none" : agentUp && !agentReach ? "agent" : !agentUp && !harnessRunsLoop(cfg, inner) ? "plain" : wordsOnly ? "words" : loopOff.includes("flow") ? "switch" : false;
      // While Settings › Experimental's Teams switch is off the line names no team, and the roster it reads holds none.
      const teamsHere = teamsOn(cfg);
      const roster = flowRuns ? flowRuns.roster() : { cards: [], teams: [] };
      const flowAsks = flowing ? [flowAskLine(teamsHere ? roster : { ...roster, teams: [] }, { off: flowOff, teams: teamsHere })] : [];
      // Why the chat's agent has no task graph, where it has none: a /plan's line says so.
      const graphOff = agentUp && !agentReach ? "agent" : !agentUp && !harnessRunsLoop(cfg, inner) ? "plain" : wordsOnly ? "words" : false;
      // Parallelize tasks on (the owner's of 11-09), Settings › Experimental's or the chat's own (`subagents.parallelize`,
      // the owner's of 11-16): the person's consent — the agent starts what can run at once itself, and no card asks
      // them. None where the agent has no task graph.
      const ownParallel = eff?.subagents?.parallelize ?? null;
      const parallelOn = !graphOff && (ownParallel == null ? cfg?.experimental?.parallelizeTasks === true : ownParallel === true);
      // `/plan [words]` (the owner's of 11-05): the developer asks the main agent to plan the work whole before any of it
      // starts — the checklist for a short job, the graph for complex work, the plan's summary kept behind it — and to end
      // its reply with the summary; the line ahead of the message says how, or that the chat's agent has no task graph.
      // The turn's end stamps what the plan left, and the page's card opens the Plan.
      // How deep it goes is in the person's words, which their agent reads — nothing here reads them (the owner's of
      // 11-06: not everyone speaks English). Parallelize tasks is Settings › Experimental's, for every chat (the owner's
      // of 11-08), read here as the agent's prompt says it (the review of 11-09): no page's
      // word, which another client never sends and a page that has not heard the switch move sends wrong. None where a
      // team leads the chat — its lead, a coding agent's too, plans its workers' tasks in parallel already.
      const sideOn = parallelOn && input?.plan === true && !draftEngine(cfg, modelName, sessionEngineOf(eff), teams, chain.kind === "team").team;
      const planAsks = plain && input?.plan === true ? [planAskLine({ off: graphOff, side: sideOn })] : [];
      if (planAsks.length && chain.kind === "team") throw refusal(400, "a team's own chat runs its lead's plan: ask for /plan in its main chat");
      // Where the plan starts from — the time and the graph's rev —, kept on the turn: an answer to a question its agent
      // asked first goes on in the same turn, and its end weighs the plan from there.
      const planOn = planAsks.length > 0 && !graphOff;
      // The row it goes on: the question's, found by its request — a command sent while it waited is a row of its own
      // after it —, or the one a resume goes on (the review of c9eb95f24).
      const goesOn = answering ? (parked ? all.find((t) => (t.requestIds || []).map(String).includes(String(parked.requestId))) : null) || all.at(-1) : resuming ? all.at(-1) : null;
      const planAnswered = goesOn && (goesOn.meta?.plan === true || goesOn.meta?.planHeld === true) ? goesOn.meta : null;
      const planFrom = planOn ? { planSince: now(), planRev: Number(archive().metaOf(chain.id, ["graph"])?.graph?.rev ?? -1) } : planAnswered && Number(planAnswered.planSince) > 0 ? { planSince: Number(planAnswered.planSince), planRev: Number(planAnswered.planRev ?? -1) } : null;
      // A turn of Filament's own — a report that woke the agent, a goal's round, a resume — while a plan waits for the
      // person's Approve (11-06), and an answer to a question one asked: it plans on, read-only, and its start lets
      // nothing go — only a message of the person's own can. Their own turn's answer is theirs, as the turn is.
      // A resume goes on its row's way, as an answer does: held where that turn was (`planAnswered`).
      const heldGraph = archive().metaOf(chain.id, ["graph"])?.graph;
      const planHeld = !planFrom && (planAnswered ? planAnswered.planHeld === true : !resuming && !who.person && !!heldGraph?.planning && !heldGraph.closed);
      // A rewind that took back the files alone, or the conversation alone (rewind.js `rewindNote`): the agent is told
      // with the message that what it knew no longer stands — the person's next message, though a turn of the agent's
      // own since ended its Undo (`standingRewind`). Its Undo ends with this turn.
      const rewound = carriesNone ? null : rewindOf(chain);
      const rewindNotes = rewound?.note ? [String(rewound.note)] : [];
      // A driving goal halts at a message of the person's own (core/goal-drive.js; the owner's of 11-10, "Match the
      // decision": the round cap, a time cap, and a halt when the person types): their message's turn runs as ever, and no
      // round starts by itself until /goal go. Filament's own turns, a command's, an answer to what waits and another
      // machine's agents' message are not their words. The agent hears why its drive halted — the person wrote, or the
      // rounds or the time ran out — in one line ahead of the message, once: on this turn, or the next that carries any.
      const goalHere = carriesNone ? null : driveOf(memory.goalFor?.(chain.id));
      const typedHalt = personWrote && plain && !!goalHere && !goalHere.halted;
      const goalSaid = typedHalt && goalHere ? haltLine({ ...goalHere, halted: { kind: "typed", at: now() } }) : haltLine(goalHere);
      const goalNotes = goalSaid ? [goalSaid] : [];
      // Parallelize tasks rides no message of the person's own (the owner's of 11-09): the agent's prompt says it once —
      // the loop's system prompt, a coding agent's context — where a line rode ahead of each (piece D, SIDE_BY_SIDE_LINE,
      // whose readers still leave it out of the messages that carried it).
      const reports = [...asking, ...uses, ...flowAsks, ...planAsks, ...rewindNotes, ...goalNotes, ...queued.map((d) => d.text), ...framed.map((d) => d.text), ...exits.map((x) => x.text)];
      // Of what came for the main agent, the flows the person started beside the chat (OA-D8): Filament's word, not an
      // agent's message, and the row says so.
      const flowStarts = queued.filter((d) => isFlowStart(d.text)).length;
      // And the word of a flow it drives In place that waited for this turn (OA4): Filament's too.
      const flowNews = queued.filter((d) => isFlowNews(d.text)).length;
      // Which sub-agent exchange each carried message belongs to: the session's rows say which turn took it.
      const carried = [...queued, ...framed].filter((d) => Number.isInteger(d.exchange)).map((d) => ({ agentId: d.from, exchange: Number(d.exchange), kind: d.kind }));
      const newUser = { role: "user", content: reports.length ? [...reports.map((text) => ({ type: "text", text })), ...content] : content };
      // This message again, after the turn it began failed or was cut off: the history holds that try, then the
      // message, and the chat one turn — the try's, in whose row the new one goes on (the archive's `beginTurn`, by
      // the message's key). A coding agent's session, which counts the chat's turns it has seen, is told
      // (HarnessV4_Tasks B8).
      const newest = all.at(-1);
      const earlierTry = !!newest && !newest.final && viewed.at(-1)?.turnId === newest.turnId && archive().pinOfTurn(newest) === pinHashOf(newUser);
      const composeWith = measuredCompose(chain, eff, {
        seed: seedOf(eff, settings, agentUp, form),
        newUser,
        model,
        calib: model,
        window,
        // The session's own cap, else the model's stated maximum output, else the 128,000 floor.
        maxTokens: Number(eff.model?.maxTokens) > 0 ? Number(eff.model?.maxTokens) : outputCeiling(config.get(), model),
        stream: input?.stream !== false,
        fixed: await fixedOf(chain, eff),
        // A coding agent's session that goes on: the agent holds the conversation, and the composition is Filament's
        // copy of it (compose.js `agentHolds`). One this turn starts fresh reads the composition itself.
        agentHolds: !!agentUp && !seeds,
        asks,
      });
      let adapted = adaptForCompose(turnsNow, eff, chain, compactions, { loop: !agentUp });
      let c = await composeWith.compose(adapted, compactions);
      clock.mark("compose");
      // What the model the chat moves to is handed from the model that answered last (`from`; `handoverFor`, below), as
      // the copy stands when it is read: the switch's card into the loop says what it will carry from it. `after`: the
      // newest turn the side moved to holds already (`ranTo`), whose own it is not handed again. A letter it names says
      // filament_recall brings its words back only to a model that has the tool: a coding agent that reaches Filament's
      // tools, the loop on a model that takes them (the owner's of 11-09, D6). Where its planner stands is said as the
      // turn starting now says it, its quiet warning in it (sw-quiet): the turn's start keeps the count as it goes.
      const handoverOf = (/** @type {string} */ from, /** @type {number} */ after) =>
        handoverFor({ doc: eff, turns: copyTurns(turnsNow, compactions), head: compactionHead(compactions), root: loopRootOf(chain), window: lineWindow || window || ASSUMED_WINDOW, graph: chain.meta?.graph, teams: leadingTeams(config.get(), chain.kind === "team", teams), kept: graphKept?.(chain.id) ?? null, where: graphWhere ? (crew) => graphWhere(chain.id, crew, { starting: true }) : null, open: stillOpen?.lines(chain.id, { others: !resumes }) ?? null, owed: Object.keys(chain.meta?.letters?.asks || {}), from, whole: !agentUp ? 0 : form === "plain" ? Infinity : form === "fold+2" ? 2 : 0, after, recall: agentUp ? agentReach : !wordsOnly });
      // The newest turn a side ran of the chat (`up`, the loop's "agent-loop"): not a coding agent's own, which reports
      // back to a session that missed the turns before it, nor one refused, whose session went.
      const ranTo = (/** @type {string} */ up) => Number(seen.findLast((t) => !t.meta?.own && !t.meta?.refused && t.meta?.facts?.upstream === up)?.n) || 0;
      // The cold question where Filament's composition is what will be read (C26): a model Filament calls whose cache
      // has gone cold, and a lost agent session's fresh start. Asked where the message could go as it is: past the
      // line the turn makes room below, or asks for it — but a lost session's is asked past the line too: its card names
      // the form the fresh one carries and offers the others, which may fit (the hunt of carry-card). A model's warm
      // cache whose print moved asks the same way, the history its write: a cache that is cold, or none, is written
      // whole whatever the print. Filament's own loop asks as any model Filament calls does (the owner's of 11-06), its
      // cache read through the route its turns went by.
      // The switch into a model Filament calls asks here, past the line or not, where the model that answered last can
      // write a summary first, from its cache while it is warm (`handoff`, `compact` with `by: "last"`), for this one to
      // start from: Send as it is reads the copy as composed — room made where it does not fit —, or the handoff. Where
      // none can be written there is nothing to choose, and nothing is asked (the review of fd62160df) — nor where its
      // summary would leave the chat no smaller (the owner's of 11-09).
      const loopHandoff = loopIn && lastRow ? await handoffOf(chain, cfg, settings, all, viewed, compactions, cwd, model) : null;
      if (loopHandoff && lastRow) {
        const held = c.report.sentTokens + c.report.fixedTokens;
        // Past the line as the composition's own is: at it, or over.
        const fits = !c.report.usable || held < c.report.usable;
        // From a coding agent, what the loop will be handed, read from the handover as the message would go now (the
        // bug hunt of 11-09: the card said the plan, the task graph and what is still open whatever it held).
        const handed = fromAgent ? handoverOf(agentTitle(/** @type {any} */ (outUp)), ranTo("agent-loop")) : null;
        /** @type {import("./switch-question.js").SwitchQuestion} */
        const q = {
          from: { upstream: String(rowUp || ""), name: fromAgent ? agentTitle(/** @type {any} */ (outUp)) : parseAgentModel(String(lastRow.model))?.model || String(lastRow.model), model: lastWire },
          to: { upstream: harnessRunsLoop(cfg, inner) ? "agent-loop" : String(nowRoute?.upstream || ""), name: inner, model: nowWire },
          account: false,
          sameModel: false,
          resumes: false,
          loop: true,
          fromAgent,
          // The model answered an earlier turn of the chat: what it cached of it then may still be warm.
          answeredBefore: viewed.some((t) => t.n < lastRow.n && !!t.model && sameModel(cfg, String(t.model), model)),
          compacted: !!compactionHead(compactions),
          suggested: fits ? "send" : "handoff",
          session: sessionForm,
          window: c.report.window,
          usable: c.report.usable,
          own: null,
          held,
          handoff: loopHandoff,
          ...(handed ? { handed: handedOf(handed) } : {}),
        };
        throw refusal(409, switchWords(q), { switchQuestion: q });
      }
      const coldNow = coldAsks && (lost || (!agentUp && cache?.state === "cold"));
      const changedNow = !agentUp && changes.length > 0 && cache?.state === "warm";
      if ((coldAsks && lost) || (!c.report.overLine && !c.report.needsCompaction && (coldNow || changedNow))) {
        /** @type {import("./cache-clock.js").ResumeQuestion} */
        // A lost session's question names the form its fresh one carries (the owner's of 11-06: the card said "all of
        // Filament's copy" of a copy that had left every tool's output out); its card sends one chosen back (`carry`).
        const q = { why: !coldNow ? "changed" : lost ? "lost" : "cold", ...(movedTo ? { moved: movedTo } : {}), ...(lost && c.report.form ? { carry: String(c.report.form) } : {}), ...(changes.length && !agentUp ? { changes } : {}), idleMs, held: c.report.sentTokens + c.report.fixedTokens, estimated: true, window: c.report.window, usable: c.report.usable, reads, cache };
        throw refusal(409, resumeWords(q), { resumeQuestion: q });
      }
      // The compaction line (§6.8): the compactor makes room by the session's method, then the turn
      // composes again from what it wrote. `ask` stops the turn below instead (needsCompaction). Not for a command
      // Filament answers: no model reads the request, and `/autofit` is the developer's own way to make room. A coding
      // agent's session makes room at the agent's line by the session's way, the compaction weighed by what the agent
      // holds: this turn starts its fresh agent session from what Filament wrote (AC5-1), or goes on in the session the
      // agent compacted its own way (AC5-5) — no fork: this turn ends the undo at once. A fresh agent session is
      // weighed at the composition's line, by Filament's methods: the agent holds none of the chat yet (`seeds`).
      /** @type {Awaited<ReturnType<typeof compactor.run>> | Awaited<ReturnType<typeof compactor.own>> | null} */
      let compacted = null;
      const room = at && ref ? agentRoom(eff, at, ref, inner) : null;
      /** Why the agent could not make room its way, when that was the way: Filament made room on its copy instead. */
      let agentFailed = null;
      /** The person let Filament's summary go (Send without it): no failure of the compaction's, their word. */
      let skipped = false;
      if ((agentUp ? !!agentAt?.over || (seeds && c.report.overLine) : c.report.overLine) && !typedCommand && !asks) {
        // Said while it runs (decision 1 of the codebase pass): a summary can take minutes, and until the request is
        // sent the page has no run to draw — the holder's phase is what tells it, and any tab following the session.
        // A summary Filament writes can be let go from there (`skippable`, the filament-agent plan's D6).
        const since = now();
        const method = compactionSettingsOf(eff).method;
        /** @param {string} m @param {boolean} [skippable] */
        const saying = (m, skippable = false) => {
          if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, { kind: "compacting", method: m, since, ...(skippable ? { skippable: true } : {}) });
        };
        saying(room?.way.way === "own" ? "own" : method);
        try {
          if (room?.way.way === "own" && ref) {
            compacted = await ownCompaction({ chain, turns: adapted, compactions, model: inner, ref, door: "line", trigger: "line", fork: false, signal: live.cancel.signal });
            if (!compacted.ok && compacted.status !== 409 && !live.cancel.signal.aborted) {
              agentFailed = compacted.error;
              compacted = null;
            }
          }
          if (!compacted) {
            // The turn waits on what Filament writes: a summary that fails or is let go gives way to fold, which makes
            // room at once (D6) — where Filament's composition is what goes out. An agent's session past its own line
            // goes on as it is instead: the agent compacts by itself there. The agent writing its own summary has
            // Filament's writer after it before fold.
            live.skip = new AbortController();
            const skip = live.skip.signal;
            saying(method, method !== "fold");
            const progress = compactionJob(chain.id, "line");
            try {
              /** @type {Parameters<typeof compactor.run>[0]} */
              const ours = {
                chain, doc: eff, turns: adapted, compactions, sessionModel: inner, window: at?.window ?? window, measure: composeWith.measure, trigger: "line", signal: live.cancel.signal, root: loopRootOf(chain),
                skip, fallback: !at, job: progress.job, onStep: progress.onStep,
                ...(at ? { held: at.held, orFold: true } : {}),
              };
              const self = agentFailed ? null : room?.writer || null;
              compacted = await compactor.run({ ...ours, self, fallback: !at && !self });
              if (self && !compacted.ok && !live.cancel.signal.aborted && !skip.aborted) {
                agentFailed = compacted.error;
                compacted = await compactor.run(ours);
              }
              progress.landed(compacted);
            } finally {
              progress.end();
            }
          }
        } finally {
          skipped = !!live.skip?.signal.aborted;
          live.skip = null;
          if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, null);
        }
        clock.mark("compaction");
        if (live.cancel.signal.aborted) throw refusal(409, "the turn was stopped from the harness before it was sent to the model");
        // A failed compaction is tolerated twice (the body goes out at the line; /autofit is the net), the third time
        // in a row the turn is refused in words rather than sent to fail upstream. An agent goes on as it is: it
        // compacts by itself at its own line. A summary the person let go with nothing to fold counts neither way, and
        // goes out: they chose to send it.
        if (!agentUp) {
          const prior = Number(chain.meta?.compactionFailures) || 0;
          const failures = compacted.ok ? 0 : skipped ? prior : prior + 1;
          archive().mergeMeta(chain.id, { compactionFailures: failures || undefined });
          if (!compacted.ok && !skipped && failures >= 3)
            throw refusal(502, `compaction failed ${failures} times in a row (${compacted.error}), and the history no longer fits the window — pick another model or method for context.compaction, or compact by hand`, { failures });
        }
        if (compacted.ok) {
          compactions = compactionsOf(chain.id);
          turnsNow = modelTurns(chain.id);
          adapted = adaptForCompose(turnsNow, eff, chain, compactions, { loop: !agentUp });
          c = await composeWith.compose(adapted, compactions);
          clock.mark("recompose");
          c.report.notes.push(compacted.note);
          if (at && agentAt && room)
            c.report.notes.push(`agent: ${heldWords(at, agentAt.usable)} — ${agentFailed ? `${agentFailed}, so Filament made room on its copy instead` : room.way.why}; ${compacted.method === "own" ? "this turn goes on in the session it compacted" : "this turn starts a fresh agent session from the compaction"}`);
          else if (seeds) c.report.notes.push(`agent: ${freshWhy}, so this turn starts a fresh agent session from the composition — it was past the line, so Filament made room on its copy first`);
        } else
          c.report.notes.push(
            at
              ? `compaction skipped: ${agentFailed ? `${agentFailed}, and on Filament's copy: ` : ""}${compacted.error} — the agent goes on as it is, and compacts by itself at its own line`
              : `compaction skipped: ${compacted.error} — the request went out at the line`,
          );
      }
      // Stopped while it composed (a compaction summary can take minutes): nothing was sent, and nothing is frozen,
      // recorded or counted as a failed compaction.
      if (live.cancel.signal.aborted) throw refusal(409, "the turn was stopped from the harness before it was sent to the model");
      // A switch into a coding agent, or a chat the agent keeps no session of, said on the turn where it happens
      // (HarnessV4_Tasks U3-7, UX-12; C26): its fresh session starts from Filament's copy, the earlier turns in the form
      // the session chose (`context.carry`). One that made room first, or stops below for want of it, has its own
      // words; one that starts from Filament's compaction is said by the agent's bridge.
      if ((switchedIn || none || (seeds && fromOurs && (!!chosenForm || !!lostTo))) && !compacted && !c.report.needsCompaction) {
        // Where a switch's form came from (HarnessV4_Tasks A7): the card's answer, an account switch — on the same model or
        // another (G7, the hunt of 11-08: the note named context.carry for Whole on another model) —, or the session's choice.
        // A lost session's: the card's answer, the session's choice, else the same agent on the same model (11-06); a
        // start after Filament's compaction says the card's answer where one came.
        const whence =
          switchedIn && chosenForm ? "chosen on the switch's card"
          : switchedIn && accountSwitch ? `an account switch on ${modelKept ? "the same model" : "another model"} carries them whole`
          : chosenForm ? "chosen on the card"
          : (lost || lostTo) && settings.sources["context.carry"] === "default" ? `${lostTo === "rewind" ? "a rewind" : movedTo || lostTo ? "a move" : "a lost session"} keeps the agent and its model, so the turns go whole`
          : "context.carry";
        const carried = `${nameIn(CARRY_WORDS, c.report.form)} (${whence})`;
        c.report.notes.push(
          resumes
            ? `agent: ${freshWhy}, and ${agentName}'s own session of this chat is still up: it goes on in it, handed the turns it missed from Filament's copy as ${carried}`
            : `agent: ${freshWhy}, so this turn starts a fresh agent session from Filament's copy of the chat, earlier turns carried as ${carried}`,
        );
      }
      // `compaction.mode: ask` (§5.4) or a request with no room for a reply: the turn stops here, in words, instead
      // of compacting by itself or sending a request the provider must refuse; nothing was sent, nothing frozen. A
      // command Filament answers goes on: it sends the provider nothing, and it may be how the developer makes room. A
      // coding agent's session was judged at the agent's line above: the agent never reads this composition whole — but
      // where the turn starts it fresh, when the composition is its seed (`seeds`).
      if (c.report.needsCompaction && !typedCommand && (!agentUp || seeds)) {
        const whole = c.report.sentTokens + c.report.fixedTokens;
        const parts = c.report.fixedTokens ? ` (its prompt and tools ≈${c.report.fixedTokens.toLocaleString()}, the history ≈${c.report.sentTokens.toLocaleString()})` : "";
        // A fresh agent session says whose copy is weighed and why it is read whole: the meter's figure is what the
        // agent that answered last held of its own context, and says nothing of this one. An estimate, said so.
        const weighs = seeds
          ? `${freshWhy}, so this turn starts a fresh agent session from Filament's copy of the chat, which weighs ≈${whole.toLocaleString()}${parts} of the agent's ${c.report.window.toLocaleString()}-token window`
          : `${c.report.fixedTokens ? `the request weighs ${whole.toLocaleString()}${parts}` : `the history weighs ${whole.toLocaleString()}`} of the ${c.report.window.toLocaleString()}-token window`;
        const why = `${weighs}, ${whole >= c.report.usable ? `past the ${c.report.usable.toLocaleString()}-token compaction line` : `leaving under the 1,024-token reply floor`}`;
        // A switch's form goes back with the question (`carry`, HarnessV4_Tasks A7): the answer sends it again, so the
        // form chosen on the switch's card is the one its fresh session carries once room is made — and so is a lost
        // session's, picked on its card or its own (the review of 8bcb358fc).
        throw refusal(409, `${why} — choose how to make room and send again (Compact and send)${asks ? ", or set context.compaction.mode to auto" : ""}`, { needsCompaction: true, why, sentTokens: whole, usable: c.report.usable, window: c.report.window, estimated: true, reads, cache, ...((switchedIn || lost) && form ? { carry: form } : {}) });
      }
      /**
       * The compactions this turn makes, in the order made — at its line, again for a seed its coding agent refused for
       * its size, in the middle of it for room in the whole chat — for its record, its stamp and its answer.
       */
      const stamps = compacted?.ok ? [madeStamp(compacted)] : [];
      // The question the loop's turn paused on goes unanswered: the person went on with a coding agent. Its park ends
      // here, said once — on the turn that asked, where the transcript draws it, and on this turn's record — and that
      // turn is over: what waited on its question goes (`questionOver`).
      if (leaves && parked) {
        const asked = all.find((t) => (t.requestIds || []).map(String).includes(String(parked.requestId)));
        archive().mergeMeta(chain.id, { paused: undefined });
        if (asked) archive().mergeTurnMeta(asked.turnId, { unanswered: { by: agentName, at: now() } });
        c.report.notes.push(`agent: the ${PAUSE_WORDS[parked.kind] || "question"} ${asked ? `turn ${asked.n}` : "the loop's turn"} waited on was left unanswered — this message went to ${agentName}`);
        questionOver(chain.id, "unanswered");
      }
      // The letters this turn's start takes as told, as they stand before it does (`carriedEnded` puts them back).
      const lettersTold = typedCommand ? [] : subagents?.lettersOwed?.(chain.id) || [];
      if (queued.length) subagents?.ackQueued(chain.id, queued);
      // A message of the person's own: the chats it tags are its agent's to write letters to, and its letters since they
      // last wrote count from none again (app/letters.js). Another machine's agents' message (`commands: false`) is not
      // the person's: it opens no chat here to letters.
      if (commands && who.person) letters?.heard(chain.id, typed);
      if (framed.length) subagents?.overruled?.(chain.id, framed, typed);
      else if (overrules.length) subagents?.overrule?.(chain.id, input?.overrules, typed);
      const exitsTold = exits.length ? tellShellExits(shellOwner, exits.map((x) => x.id)) : null;
      if (rewound) archive().mergeMeta(chain.id, { rewind: undefined });
      // The person's words halt the goal's drive, and its line is told: no turn after carries it again.
      if (typedHalt) haltGoal(chain.id, { kind: "typed" });
      if (goalNotes.length) haltTold(chain.id);
      // The print this turn sends ahead of its history, kept for the person's next message (above): every request of
      // the loop's sends it as it stands, with the newest compaction it stands on — not a message that answers a turn
      // at work, which goes on with what that turn was sent. A coding agent's session reads it only as it opens — a
      // fresh one, or one Filament compacted; never one the chat goes back to (`resumes`), nor the agent's own
      // compaction, which keeps its session — or keeps what it had where the person said Send as it is: its print is
      // kept then, and where it kept none yet.
      const opens = (seeds && !resumes) || (!!compacted?.ok && compacted.method !== "own");
      const printGoes = agentUp ? opens || input?.sendAsIs === true || !print?.was : !answering;
      // Kept with the compaction the chat stands on as it sends: a compaction at the send, the newer one.
      const head = compacted?.ok && Number(compacted.id) > 0 ? Number(compacted.id) : print?.newest;
      if (print && printGoes) archive().mergeMeta(chain.id, { [print.key]: { ...print.now, head, at: now() } });
      // Whom it named with an `@`, for its end: those the main agent did not use are said on the turn (OA-D12).
      live.use = use;
      // Whether its main agent may offer Run as a flow under its reply (OA6): a message of the person's own, no /flow.
      live.plain = plain;
      live.worded = !!String(typed || "").trim();
      live.flowing = flowing;
      live.planning = !!planFrom || planHeld;
      // Its tasks calls start nothing, and what they change waits for the person's Approve (11-06).
      if (live.planning) plans?.turn(chain.id, true);
      // The saved agents and teams the developer's message names, in plain words or with an `@`: its agent may ask,
      // send or start them while it is their newest (the owner's 10-19 list: "the main agent spawns these when asked in
      // plain words"; HarnessV4_OneAgent_Plan OA2: teams the same). A turn of Filament's own, an answer or a command
      // leaves the names of the message before.
      if (plain) {
        subagents?.heard?.(chain.id, typed);
        if (chain.kind !== "team") besides?.()?.heard(chain.id, typed);
        // A /flow opens its drafting until the developer's next message; any other message closes it (OA3, L26).
        if (chain.kind !== "team") flows?.()?.asked(chain.id, flowing ? typed : null);
      }
      if (cutOff) c.report.notes.push(`${cutOff} turn${cutOff === 1 ? "" : "s"} cut off before ${cutOff === 1 ? "its" : "their"} reply (running when Filament last stopped) in the history, Filament's line as the reply`);
      if (failedKept) c.report.notes.push(`${failedKept} turn${failedKept === 1 ? "" : "s"} that failed after doing work in the history, ${failedKept === 1 ? "its" : "their"} work kept and why ${failedKept === 1 ? "it" : "they"} failed as the reply`);
      if (unanswered) c.report.notes.push(`${unanswered} unanswered turn${unanswered === 1 ? "" : "s"} (no final reply archived) left out of the history`);
      if (refused.length) c.report.notes.push(`${refused.length} turn${refused.length === 1 ? "" : "s"} the model's provider refused left out of the history${refusedLines ? `, ${refusedLines === refused.length ? "each" : `${refusedLines} of them`} as Filament's line on what it wrote` : ""}`);
      const prevHash = all.length ? all[all.length - 1].meta?.settingsHash ?? null : null;
      const boundary = prevHash != null && prevHash !== settings.hash;
      res.setHeader("x-filament-session", chain.id);
      res.setHeader("x-filament-settings-hash", settings.hash);
      if (boundary) res.setHeader("x-filament-settings-boundary", String(prevHash));
      // What rode ahead of the message (the turn's `deliveries` and `shellExits` stamp, below) is in the head too: the
      // page that sent the turn labels its message at once, not after a reload (HarnessV3-Readiness RD1 c).
      if (reports.length) res.setHeader("x-filament-deliveries", String(reports.length));
      if (asking.length) res.setHeader("x-filament-asking", String(asking.length));
      // The line naming whom the message named for the main agent to use: the page marks the message at once.
      if (uses.length) res.setHeader("x-filament-use", String(use.length));
      // A /flow's line: the page marks the message as asking for a flow.
      if (flowAsks.length) res.setHeader("x-filament-flow", "1");
      // The head says whether a card can follow: the agent has a task graph to plan on ("graph"), or plans in its reply.
      if (planAsks.length) res.setHeader("x-filament-plan", planOn ? "graph" : "off");
      if (flowStarts) res.setHeader("x-filament-flow-starts", String(flowStarts));
      if (flowNews) res.setHeader("x-filament-flow-news", String(flowNews));
      if (exits.length) res.setHeader("x-filament-shell-exits", String(exits.length));
      // Of them, a watch's lines and a come-back's note, said apart from ends (the Hunter's find of 10-27), the person's
      // Cancel of a come-back (the Designer's of 10-27), and Filament's check-in on a command that runs on (idle-wake.js).
      if (exits.some((x) => x.kind === "lines")) res.setHeader("x-filament-shell-watch", String(exits.filter((x) => x.kind === "lines").length));
      if (exits.some((x) => x.kind === "wake")) res.setHeader("x-filament-shell-wake", String(exits.filter((x) => x.kind === "wake").length));
      if (exits.some((x) => x.kind === "idle")) res.setHeader("x-filament-shell-idle", String(exits.filter((x) => x.kind === "idle").length));
      if (exits.some((x) => x.kind === "cancel")) res.setHeader("x-filament-shell-cancel", String(exits.filter((x) => x.kind === "cancel").length));
      // A rewind's line rode with it: the page says word of your rewind at once. So does a goal's halt's.
      if (rewindNotes.length) res.setHeader("x-filament-rewind-note", "1");
      if (goalNotes.length) res.setHeader("x-filament-goal-halt", "1");
      // A mode the turn names is fixed for its request; with none, the loop reads the session's at each call, so a
      // switch reaches a running turn and a resumed one (HarnessV3-AtHome AH-F1). `modeSwitch`: this message is the
      // permission switch answering a waiting call — said by a house header a client cannot send.
      // A /plan's turn, and an answer to a question it asked, is read-only (the owner's plan mode of 11-06): its agent reads
      // and plans, and changes nothing until the person approves — the loop's and a coding agent's alike; so is a turn of
      // Filament's own while the plan waits (`planHeld`). The person's next message names no mode, so the chat's own
      // returns.
      // A watcher's turn that reads only (`watchReads`) goes the same road, and so does what goes on in its row: the
      // answer to a question it asked, a resume of it — one a restart cut off before its row said how it ran (`wake`)
      // is held, the safe way.
      const wakeRan = goesOn?.meta?.wake;
      const watchHeld = goesOn ? wakeRan === "reads" || (resuming && !wakeRan && isWatchWake(goesOn.user)) : watchReads;
      const permissions = planAsks.length || planAnswered || planHeld || watchHeld ? "read-only" : String(input?.permissions || "").trim();
      const load = String(input?.load || "").trim();
      /**
       * The coding agent refused this turn's seed for its size (HarnessV3-FailurePoints D9): Filament compacts its copy of
       * the chat by the session's method, to fit under what the agent refused — the composition's whole weight, more
       * than the agent takes whatever window Filament knows for it — or under what the agent said it takes, where its
       * refusal said so (`seedRoom`, HarnessV4_Tasks B5) — and composes the turn again: the request a new agent
       * session is seeded from, which the turn's stamp then carries, with every compaction the turn made. Said on the
       * turn's lock while it runs, with the compaction's job, and let go from the page as at the line: a summary gives
       * way to fold.
       * @type {import("../../adapters/agents/turn-bridge.js").Reseed}
       */
      const reseed = async (told) => {
        const refused = c.report.sentTokens + c.report.fixedTokens;
        const room = seedRoom({ sent: refused, max: told.max, counted: told.counted });
        const heard = told.max ? `; ${agentUp} says it takes ${told.max.toLocaleString()}${told.counted ? ` and counted ${told.counted.toLocaleString()}` : ""}` : "";
        const method = compactionSettingsOf(eff).method;
        live.skip = new AbortController();
        const skip = live.skip.signal;
        if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, { kind: "compacting", method, since: now(), ...(method !== "fold" ? { skippable: true } : {}) });
        const progress = compactionJob(chain.id, "line");
        /** @type {Awaited<ReturnType<typeof compactor.run>>} */
        let made;
        try {
          made = await compactor.run({
            chain, doc: eff, turns: adapted, compactions, sessionModel: inner, window: room, measure: composeWith.measure, trigger: "line", signal: live.cancel.signal, root: loopRootOf(chain),
            skip, fallback: true, orFold: true, job: progress.job, onStep: progress.onStep,
          });
          progress.landed(made);
        } finally {
          progress.end();
          live.skip = null;
          if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, null);
        }
        if (!made.ok) return { error: made.error };
        compactions = compactionsOf(chain.id);
        adapted = adaptForCompose(modelTurns(chain.id), eff, chain, compactions, { loop: !agentUp });
        c = await composeWith.compose(adapted, compactions);
        stamps.push(madeStamp(made));
        // The record says what this composition adds: the compaction, and why it was made.
        const said = [made.note, `agent: ${agentUp} refused the seed for its size (≈${refused.toLocaleString()} tokens${heard}), so Filament made room on its copy, and a fresh agent session starts from the compaction`];
        c.report.notes.push(...said);
        // The fresh session is seeded with this composition: what the first one said of a session's place is gone.
        const headers = Object.fromEntries(Object.entries(pre.headers || {}).filter(([k]) => k !== SEEN_HEADER && k !== STANDS_ON_HEADER));
        return { body: c.body, headers: { ...headers, ...basesOf(compactions, viewed).headers }, composition: { ...c.report, notes: said, settingsHash: settings.hash, compactions: [...stamps], timing: pre.composition.timing } };
      };
      /**
       * Room in the whole chat in the middle of this turn (HarnessV4_Tasks C33): Filament's own loop found its
       * conversation at the line, the earlier turns the bigger part of it. They give way by the session's own method
       * and writer, as at a send — a summary that fails, or that the person lets go, gives way to fold — and the turn
       * is composed again: the loop takes every message ahead of its own from that composition. Said on the turn's
       * lock while it runs, with the compaction's job. → those messages and the compaction made (`madeStamp`, which the
       * pipeline puts on the turn's record), or why nothing was made.
       * @type {NonNullable<import("../pipeline/context.js").PreParsed["earlier"]>}
       */
      const earlier = async () => {
        const method = compactionSettingsOf(eff).method;
        live.skip = new AbortController();
        const skip = live.skip.signal;
        if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, { kind: "compacting", method, since: now(), ...(method !== "fold" ? { skippable: true } : {}) });
        const progress = compactionJob(chain.id, "line");
        /** @type {Awaited<ReturnType<typeof compactor.run>>} */
        let made;
        try {
          made = await compactor.run({
            chain, doc: eff, turns: adapted, compactions, sessionModel: inner, window, measure: composeWith.measure, trigger: "line", signal: live.cancel.signal, root: loopRootOf(chain),
            skip, fallback: true, job: progress.job, onStep: progress.onStep,
          });
          progress.landed(made);
        } finally {
          progress.end();
          live.skip = null;
          if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, null);
        }
        if (!made.ok) return { error: made.error };
        compactions = compactionsOf(chain.id);
        adapted = adaptForCompose(modelTurns(chain.id), eff, chain, compactions, { loop: !agentUp });
        c = await composeWith.compose(adapted, compactions);
        const stamp = madeStamp(made);
        stamps.push(stamp);
        // The composition ends with the turn's own message, which the loop holds as it was sent.
        return { history: c.body.messages.slice(0, -1), ...stamp, note: made.note };
      };
      // The model the chat moved to is handed what stands (the owner's of 11-08: a switch lost the plan, the skills loaded,
      // what was still open and the task graph's notes): into a coding agent from another engine — past its card — or
      // into Filament's loop from a coding agent. Read after any room this turn made, so it stands on the copy's head as
      // the turn sends it; said with the turn's first prompt or request, where the list of what is open goes. The turns a
      // coding agent's form carries whole (`whole`) show their own files, plan and skills: Whole every one, Folded the
      // newest two with fold+2. A coding agent's own tasks are named whose they are, but to a session the chat goes back
      // to (`resumes`), whose own they are (the review of cb2d2d1f0: it was told it could neither read nor stop them).
      // The loop's reads the turn its card read (`lastRow`): a coding agent's turn that failed after doing work is the
      // chat's move, and the loop's own that did is the handover made already (the review of cb2d2d1f0).
      // It reads the turns as they ran, never as the adapter made them for this request: a turn folded there keeps no
      // call to read the files, the plan or the skills from (the hunt of 11-08).
      const loopFrom = !agentUp && !typedCommand && !!rowUp && rowUp !== "agent-loop" ? outUp : null;
      // A switch whose first prompt went as the agent's own command handed nothing over (acp-turn.js `handoverOwed`):
      // this agent's next prompt is handed what stands (the hunt of 11-08).
      const owedFrom = !!agentUp && !typedCommand && lastUp === agentUp && typeof movedRow?.meta?.handoverOwed === "string" ? String(movedRow.meta.handoverOwed) : null;
      const movedFrom = switchedIn
        ? fromUp && isAgentUpstream(fromUp) ? agentTitle(fromUp) : lastModel || String(lastUp)
        : loopFrom && isAgentUpstream(loopFrom)
          ? agentTitle(loopFrom)
          : owedFrom;
      // A side the chat goes back to is handed only what came after its newest turn there (the bug hunt of 11-09: it was
      // handed its own files and skills again): a coding agent's session that goes on — not one this turn's compaction
      // opens afresh (`opens`) —, and the loop, whose copy keeps its own turns with what it was handed then. What was owed
      // keeps the turn the switch read (acp-turn.js `handoverAfter`), while the session it went on in goes on still.
      const after = switchedIn
        ? resumes && !opens ? ranTo(String(agentUp)) : 0
        : loopFrom
          ? ranTo("agent-loop")
          : owedFrom && !opens ? Number(movedRow?.meta?.handoverAfter) || 0 : 0;
      const handover = movedFrom ? handoverOf(movedFrom, after) : null;
      if (handover?.text) c.report.notes.push(`agent: the chat moved from ${movedFrom}: its first ${agentUp ? "prompt" : "request"} is handed what stands (~${handover.tokens.toLocaleString()} tokens: ${handedNote(handover)})`);
      const copyHead = agentUp ? compactionHead(compactions) : null;
      /** @type {import("../pipeline/context.js").PreParsed} */
      const pre = {
        raw: JSON.stringify(c.body),
        body: c.body,
        notes: [],
        api: "session",
        responsesBody: null,
        headers: {
          "x-filament-chain": chain.id,
          "x-filament-cwd": cwd,
          "x-filament-client": "harness",
          ...(permissions ? { "x-filament-permissions": permissions } : {}),
          ...(modeSwitch ? { "x-filament-mode-switch": "1" } : {}),
          ...(press !== null ? { "x-filament-allow": press ? "1" : "0" } : {}),
          // The chat's newest compaction, 0 before any (HarnessV3-ACP AC5-1): a coding agent's session follows it, a
          // fresh one from this composition once the chat is compacted, the one from before when an undo takes one
          // back. With it, the newer one each agent's session stands on where one of Filament's copy alone moved it
          // (HarnessV4_Tasks A8): the bridge of whichever agent serves the turn reads its own.
          ...basesOf(compactions, viewed).headers,
          // Filament's copy starts from a coding agent's own summary (C28), or from the one Filament wrote for the copy
          // alone (C29): a session that goes on is told its place in it, the turns of the person's it has seen as this
          // request holds them (`seenBy`).
          ...(copyHead && sessionsWentOn(copyHead) ? { [SEEN_HEADER]: `${copyHead.id}:${seenBy({ messages: c.body.messages, places: c.places, turns: turnsNow, upstream: /** @type {string} */ (agentUp) })}` } : {}),
          ...(agentsLine ? { [LINE_HEADER]: String(agentsLine) } : {}),
          ...(earlierTry ? { [EARLIER_TRY_HEADER]: "1" } : {}),
          ...(load ? { "x-filament-memory-load": load } : {}),
        },
        composition: { ...c.report, settingsHash: settings.hash, compactions: [...stamps], timing: clock.done() },
        // What the body's blocks weigh, as the composition weighed them: the loop's turn weighs its conversation by them.
        weights: keptWeights?.weights ?? null,
        settings: eff,
        signal: live.cancel.signal,
        // What the turn waits on before its request is sent, said on its lock: memory's lookups, which the page may let
        // go, and a coding agent's start (HarnessV3-FailurePoints §5.1 items 2 and 3).
        ...(sessionTurns && lock ? { lock: { turns: sessionTurns, key: chain.key, token: lock } } : {}),
        // The page asked for its turn's run events in the reply (HarnessV3-Responsiveness R3).
        ...(input?.runEvents === true ? { runEvents: true } : {}),
        // The page's own name for the send, kept on the turn it begins or goes on in.
        ...(typeof input?.sendId === "string" && SEND_ID.test(input.sendId) ? { send: input.sendId } : {}),
        // A thread's brief: the turn it begins is marked as one (the archive's `brief`), none of the person's.
        ...(threading ? { brief: true } : {}),
        // Who began it, where it is not the person (core/turn-by.js): the turn it begins keeps it (the archive's `by`).
        ...(who.person ? {} : { by }),
        // Nobody is at the page for it: a coding agent's request its mode asks about is refused at once
        // (HarnessV4_Overnight_Plan OV-D34).
        ...(unattended ? { unattended: true } : {}),
        // What the model the chat moved to is handed, with its first prompt or request (`handoverFor`), and the turn its
        // session held already (`after`), which what is owed past an agent's own command keeps.
        ...(handover?.text && movedFrom ? { handover: { from: movedFrom, text: handover.text, ...(after ? { after } : {}) } } : {}),
        // A coding agent's turn: its seed made to fit, should the agent refuse it for its size (D9) — or, where the
        // message asks before room is made, the refusal left as the turn's own (C26).
        ...(agentUp ? { reseed: asks ? /** @type {const} */ ("ask") : reseed } : {}),
        // Filament's own loop: the earlier turns give way while the turn runs, where they are the bigger part (C33).
        ...(!agentUp ? { earlier } : {}),
      };
      const before = lastN(all);
      live.since = before;
      // What this turn's message carried that waited untold until it went: told only by a turn the model's history keeps
      // (`carriedEnded`). `byItself`: Filament started the turn, so no one is there to send it again.
      const carriedNow = { queued, letters: lettersTold, exits: exitsTold, halt: goalNotes.length > 0, byItself: !who.person };
      /** The turn the pipeline archived: the rows past the last one we saw, else (a re-sent message reopened an older turn) the one carrying this request's id. */
      const rowsOf = () => {
        const rows = archive().getTurns(chain.id, { from: before + 1 });
        return !rows.length && live.requestId ? archive().getTurns(chain.id).filter((t) => (t.requestIds || []).includes(live.requestId)) : rows;
      };
      try {
        await pipeline.handle(req, res, "anthropic", pre);
      } catch (e) {
        // A stage threw: the turn ends here, and what it carried is weighed as at any end.
        carriedEnded(chain, live, rowsOf, { ...carriedNow, failed: true });
        throw e;
      }
      const a = archive();
      const mine = rowsOf();
      const via = viaOf(req?.headers?.["x-filament-via"]);
      const stamp = {
        settingsHash: settings.hash,
        // How many of the user message's leading blocks Filament put there, not typed: the first `asking` of them the
        // line that names whom the agent may ask, then the line naming whom the message named for it to use (`use`),
        // then a /flow's line (`flow`) or a /plan's (`plan`), then sub-agents' messages, the last `shellExits` of
        // them background shells' exits.
        ...(reports.length ? { deliveries: reports.length } : {}),
        ...(asking.length ? { asking: asking.length } : {}),
        ...(uses.length ? { use } : {}),
        ...(flowAsks.length ? { flow: true } : {}),
        ...(planAsks.length ? { plan: true, ...(planFrom ? planFrom : {}) } : {}),
        // A turn held while its plan waits (11-06), for its answer's sake.
        ...(planHeld && !planAnswered ? { planHeld: true } : {}),
        // How a watcher's turn ran — held to reading, or as the chat works —, for what goes on in its row.
        ...(watchHeld ? { wake: "reads" } : watching ? { wake: "works" } : {}),
        // Then the line on a rewind that took one side back (rewind.js), said apart on the row, and the one on why the
        // goal's drive halted (core/goal-drive.js `haltLine`).
        ...(rewindNotes.length ? { rewindNote: true } : {}),
        ...(goalNotes.length ? { goalHalt: true } : {}),
        // Of the agents' messages, the starts of the person's flows (OA-D8): Filament's, said apart on the row.
        ...(flowStarts ? { flowStarts } : {}),
        // And the word of a flow it drives In place (OA4).
        ...(flowNews ? { flowNews } : {}),
        // Those of them, and of the notes' named, the main agent did not use in the turn (OA-D12): said on it.
        ...unusedOf(chain, live, mine),
        ...(exits.length ? { shellExits: exits.length } : {}),
        // Of those, a watch's lines, a come-back's note, the person's Cancel of one and Filament's check-in: no command's end.
        ...(exits.some((x) => x.kind === "lines") ? { shellWatch: exits.filter((x) => x.kind === "lines").length } : {}),
        ...(exits.some((x) => x.kind === "wake") ? { shellWake: exits.filter((x) => x.kind === "wake").length } : {}),
        ...(exits.some((x) => x.kind === "idle") ? { shellIdle: exits.filter((x) => x.kind === "idle").length } : {}),
        ...(exits.some((x) => x.kind === "cancel") ? { shellCancel: exits.filter((x) => x.kind === "cancel").length } : {}),
        ...(carried.length ? { carried } : {}),
        // Whose answers the message overrules, by name: the message's row says so.
        ...(overrules.length ? { overrules: overrules.map((d) => ({ agentId: d.from, exchange: Number(d.exchange) || 0, name: d.description })) } : {}),
        // The send menu's row the message went by while the turn before it ran, as the page said it.
        ...(via ? { via } : {}),
        composed: {
          form: c.report.form,
          results: c.report.results,
          historyTokens: c.report.historyTokens,
          sentTokens: c.report.sentTokens,
          turns: c.report.turns.length,
          // Each completed turn's shape as this request went out (§10.3 "exactly what the model had") is the request
          // record's (`view.shapes`, its composition report): a copy on every turn grew with the square of the chat, and
          // nothing read it there.
          ...(c.report.head ? { head: c.report.head } : {}),
          ...(stamps.length ? { compactions: stamps } : {}),
        },
      };
      for (const t of mine) a.mergeTurnMeta(t.id, stamp);
      // Run as a flow (OA6): its main agent offered it, and the turn ended with its reply — its last row says so.
      if (flowOfferOf(live, mine)) a.mergeTurnMeta(mine[mine.length - 1].id, { flowOffer: true });
      // A plan offered on a card (the owner's plan mode of 11-06), written to its row as it was made (`offerPlanInTurn`):
      // the turn ended with its reply — its last row says so. One that failed or was cut off keeps it where it was written.
      if (live.planOffer && endedWithReply(live, mine)) {
        const last = mine[mine.length - 1].id;
        if (live.planOfferRow && live.planOfferRow !== last) a.mergeTurnMeta(live.planOfferRow, { planOffer: undefined });
        a.mergeTurnMeta(last, { planOffer: live.planOffer });
      }
      // A /plan that ended with its reply — its own, or an answer's to a question it asked first —: what its plan made on
      // the graph, for the card that opens the Plan. None where it made none.
      const ready = live.planning && planFrom && endedWithReply(live, mine) ? planReadyOf(a.metaOf(chain.id, ["graph"])?.graph, { since: planFrom.planSince, rev: planFrom.planRev }) : null;
      if (ready && ready.tasks + ready.steps > 0) a.mergeTurnMeta(mine[mine.length - 1].id, { planReady: ready });
      if (carried.length && mine.length) subagents?.carried(chain.id, mine[mine.length - 1].n, carried);
      // What the message carried is told where the model's history keeps the turn; else it goes back, before the goal's
      // round is weighed: a wake that tries again is one the round waits for.
      carriedEnded(chain, live, () => mine, { ...carriedNow, failed: Number(res?.statusCode) >= 400 });
      // A driving goal's next round (core/goal-drive.js), or its halt: by the reply's mark, the person's Stop, its cap. A
      // command's turn drives only where it started the drive — a `/goal accept` or `/goal go` that changed it —: a
      // `/help` between rounds, or a refused `/goal go`, moves nothing.
      const drives = !typedCommand || (goalStarts && JSON.stringify(memory.goalFor?.(chain.id)?.drive ?? null) !== driveBefore);
      // A planning turn posts no round (the review of 11-06): the goal's rounds wait with the plan, for the person's
      // Approve — its Stop and its marks halt the drive as ever.
      if (drives) goalTurnEnded(chain, live, mine, { command: typedCommand, planning: !!live.planning });
      // A background command of its agent's still running: Filament checks in if nothing else comes (idle-wake.js).
      idleTurnEnded(chain.id, live, mine);
      // The watchers hear it ended (the plan of 11-11).
      turnHeard(chain.id, live, mine);
      // Filament's copy of an agent's chat moves on, in the background: the agent compacted and handed no summary over,
      // or the copy as this turn composed it was past the line (C29).
      if (agentUp) await followCopy(chain, { overLine: !!c.report.overLine });
      return { requestId: live.requestId, turn: mine.length ? mine[mine.length - 1].n : null, settingsHash: settings.hash, boundary, report: { ...c.report, compactions: stamps } };
    } finally {
      liveTurns.delete(chain.id);
      if (live.planning) plans?.turn(chain.id, false);
      if (sessionTurns && lock) sessionTurns.release(chain.key, lock);
      // Its copy stays its own a while, for a follow-up (`grace`) — past a question it paused on, which its answer's
      // turn goes on from in the same copy.
      if (renew) clearInterval(renew);
      if (typeof copy === "string" && copy) {
        const waits = archive().metaOf(chain.id, ["paused"])?.paused;
        copyLease?.end(copy, waits && PAUSE_KINDS.includes(waits.kind) ? Number(waits.expires) || Infinity : 0);
      }
      gaveBack();
      stretchEnded(chain.id);
      // A question the turn paused on is watched for its lapse from its end.
      try {
        watchLapse(chain.id);
      } catch (/** @type {any} */ e) {
        log("warn", `sessions: session ${chain.id}: its question's lapse is not watched (${e?.message || e})`);
      }
    }
  }

  /**
   * Whom a turn named with an `@` — its message and its notes — and its main agent did not use in it, for its stamp
   * (HarnessV4_OneAgent_Plan OA-D12): a saved agent it launched or followed up on, or a team it fired, since the turn
   * began, counts as used. `{ unused: [] }` where it named some and used them all, so a page that reads the turn knows it
   * was counted; nothing where it named none, or the turn was stopped, or ended without its reply.
   * @param {any} chain @param {LiveTurn} live @param {any[]} mine  the turn's archived rows
   * @returns {{ unused?: { tag?: string, key?: string, name: string }[] }}
   */
  function unusedOf(chain, live, mine) {
    const named = live.use || [];
    const last = mine.at(-1);
    if (!named.length || live.cancel.signal.aborted || !last?.final_hash || last.meta?.stopped) return {};
    const agents = subagents?.usedSince?.(chain.id, live.startedAt) || new Set();
    const teams = besides?.()?.usedSince(chain.id, live.startedAt) || new Set();
    return { unused: named.filter((n) => (n.tag ? !agents.has(n.tag) : !teams.has(String(n.key)))) };
  }

  /**
   * A note into a chat's running turn named agents or teams with an `@` (HarnessV4_OneAgent_Plan OA2 case 6): they join
   * whom the turn named, for its end to say which went unused. A chat with no harness turn running keeps nothing.
   * @param {string} id @param {readonly { tag?: string, key?: string, name: string }[]} named
   */
  function useInTurn(id, named) {
    const live = liveTurns.get(chainOf(id).id);
    if (!live || !named.length) return;
    const had = live.use || [];
    live.use = [...had, ...named.filter((n) => !had.some((h) => (n.tag ? h.tag === n.tag : h.key === n.key)))];
  }

  /**
   * Whether a turn's row says its main agent offered Run as a flow (HarnessV4_OneAgent_Plan OA6, OA-D14): it did, and
   * the turn ended with its reply, not stopped.
   * @param {LiveTurn} live @param {any[]} mine  the turn's archived rows
   */
  function flowOfferOf(live, mine) {
    return !!live.flowOffer && endedWithReply(live, mine);
  }

  /**
   * A turn's end, for what its message carried that waited untold until it went (the owner's of 11-11: "delivery is at
   * least once") — the queued reports and notices, the background commands' ends and a come-back's note, the letters its
   * start took as told, the line on why a goal's drive halted. Each was marked told once the turn could no longer be
   * refused; it is told where the model's history keeps the turn (shapes.js `modelTurnsOf`). A turn that ended with
   * nothing the history keeps — it failed, or was stopped, before its model did any work — gives them back to where
   * they waited, untold, so the chat's next turn carries them and a restart still knows them owed. One Filament started
   * by itself is then tried again by the waker, a few times, each after a longer wait (wake.js `ended`); the person's own
   * is theirs to send again, and one they stopped is not tried again, nor does it give back a come-back's note or a
   * check-in, which their Stop drops. Not a command Filament answered, which carried none; nor a turn paused on a
   * question, which goes on with its answer; nor one the model's provider refused, whose words would be refused again.
   * Bookkeeping: what fails in it is logged, and never fails the turn.
   * @param {any} chain @param {LiveTurn} live @param {() => any[]} rowsOf  the turn's archived rows
   * @param {{ queued: readonly any[], letters: readonly { n: number, wakes: boolean, fresh: boolean }[], exits: ReturnType<typeof tellShellExits> | null, halt: boolean, byItself: boolean, failed: boolean }} o
   *   `halt`: it carried the line on why the goal's drive halted; `byItself`: Filament started it; `failed`: it answered
   *   with a failure, or threw — a turn with no row at all gives back only then
   */
  function carriedEnded(chain, live, rowsOf, { queued, letters, exits, halt, byItself, failed }) {
    try {
      const rows = rowsOf();
      const stands = archive().getChain(chain.id);
      if (!stands || rows.some((t) => t.meta?.command || refusedTurn(t)) || pausedNow(stands)) return;
      if (!rows.length && !failed && !live.cancel.signal.aborted) return;
      const kept = modelTurnsOf(/** @type {any[]} */ (rows.map((t) => ({ meta: t.meta || {}, finished: t.final_hash != null, work: t.work || [], final: null }))), bootAt).length > 0;
      if (kept) return void wakeEnded?.(chain.id, true);
      const stopped = live.cancel.signal.aborted || rows.some((t) => t.meta?.stopped) || stoppedSince(stands);
      const back = exits && stopped ? { ...exits, items: exits.items.filter((x) => x.kind !== "wake" && x.kind !== "idle") } : exits;
      if (queued.length || letters.length) subagents?.backQueued?.(chain.id, queued, letters);
      if (back?.items.length) untellShellExits({ session: chain.id, agent: null }, back);
      if (halt) haltUntold(chain.id);
      const n = queued.length + letters.length + (back?.items.length || 0);
      if (n || halt) log("info", `sessions: session ${chain.id}: its turn ${stopped ? "was stopped" : "failed"} before its model did any work; what its message carried (${n} item${n === 1 ? "" : "s"}${halt ? ", and the line on why its goal's drive halted" : ""}) waits untold again, for its next turn`);
      if (byItself && !stopped) wakeEnded?.(chain.id, false);
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chain.id}: what its turn carried was not weighed at its end (${e?.message || e})`);
    }
  }

  /**
   * A turn's end, for its chat's driving goal (core/goal-drive.js, the owner's of 11-05): halted by the reply's mark or the
   * person's Stop, its next round owed and sent (`goalRound`, the waker's) — or neither, where something wakes the agent
   * by itself. An end that owes no round takes back one an earlier end owed and no turn took (the review of 11-11): this
   * end decides. Bookkeeping: what fails in it is logged, and never fails the turn.
   * @param {any} chain @param {LiveTurn} live @param {any[]} mine  the turn's archived rows
   * @param {{ command: boolean, planning?: boolean }} o  `command`: the turn was a command Filament answered — its answer
   *   names the marks, and is never the agent's; `planning`: a planning turn — its Stop and marks halt the drive, but it
   *   posts no round
   */
  function goalTurnEnded(chain, live, mine, { command, planning = false }) {
    try {
      const goal = memory.goalFor?.(chain.id);
      const drive = driveOf(goal);
      if (!drive) return void goalOwed.delete(chain.id);
      const last = mine.at(-1);
      const stopped = live.cancel.signal.aborted || !!last?.meta?.stopped;
      const reply = !endedWithReply(live, mine) ? null : command ? "" : wordsOf(archive().getMessage(last.final_hash)?.message);
      // What wakes the agent by itself — not the goal's own round, which this decides.
      const w = waitsOf(chain.id);
      const next = afterTurn(drive, { stopped, reply, waits: w.agents + w.tasks + w.teams > 0 || !!wakeComing?.(chain.id), now: now() });
      // Left out by Memory settings while it drove: the round it would owe halts it instead (the owner's of 11-05).
      const out = next.post ? memory.chatLeftOut?.(chain.id) || null : null;
      if (out) {
        haltGoal(chain.id, { kind: "leftout", why: out });
        return;
      }
      // Its time ran out: a come-back its agent set goes with it, as with the person's Stop — a drive whose turns only
      // wait would else go on past its time by them, one come-back after another (the review of 11-11) —, and the line
      // on why it halted says so, as the tool's answer had said it would come.
      const timed = next.drive.halted?.kind === "time" && !drive.halted;
      const had = timed && (!!comeBackOf(chain.id) || peekShellExits({ session: chain.id, agent: null }).some((x) => x.kind === "wake"));
      if (had) {
        cancelComeBack(chain.id);
        log("info", `sessions: session ${chain.id}: its goal's drive halted as its time ran out, and the come-back its agent had set was dropped with it`);
      }
      const driven = had && next.drive.halted ? { ...next.drive, halted: { ...next.drive.halted, comeBack: true } } : next.drive;
      if (driven !== drive) memory.setGoal(chain.id, { ...goal, drive: driven });
      if (driven.halted && !drive.halted) publish?.(chain.id, { type: "goal", drive: driven });
      if (!next.post || !goalRound || planning) return void goalOwed.delete(chain.id);
      goalOwed.add(chain.id);
      goalRound(chain.id);
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chain.id}: its goal's next round was not weighed (${e?.message || e})`);
    }
  }

  /**
   * A driving goal halted by the person — their hold, their Stop, or their note into its running turn (`typed`, the
   * owner's of 11-10) — at once, mid-round too (core/goal-drive.js): no round starts by itself until `/goal go`, and one
   * owed is owed no more. → the drive halted, or null where none drove.
   * @param {string} chainId @param {"held" | "stopped" | "typed"} kind
   */
  function holdGoal(chainId, kind) {
    return haltGoal(chainId, { kind });
  }

  /**
   * A driving goal's halt told to the agent (core/goal-drive.js `haltLine`): a turn carried its line, and none after does.
   * @param {string} chainId
   */
  function haltTold(chainId) {
    const goal = memory.goalFor?.(chainId);
    const drive = driveOf(goal);
    if (!drive?.halted || drive.halted.told) return;
    memory.setGoal(chainId, { ...goal, drive: { ...drive, halted: { ...drive.halted, told: true } } });
  }

  /**
   * A driving goal's halt, untold again: the turn that carried its line failed before its model did any work
   * (`carriedEnded`), so the chat's next turn carries it. Nothing where the drive is no longer halted so.
   * @param {string} chainId
   */
  function haltUntold(chainId) {
    const goal = memory.goalFor?.(chainId);
    const drive = driveOf(goal);
    if (!drive?.halted?.told) return;
    const { told: _told, ...halted } = drive.halted;
    memory.setGoal(chainId, { ...goal, drive: { ...drive, halted } });
  }

  /**
   * A driving goal halted now, for the person or by Filament (`leftout`: Memory settings left its chat out), its owed
   * round owed no more. → the drive halted, or null where none drove.
   * @param {string} chainId @param {{ kind: import("../../core/goal-drive.js").Halt["kind"], why?: string }} h
   */
  function haltGoal(chainId, { kind, why }) {
    goalOwed.delete(chainId);
    const goal = memory.goalFor?.(chainId);
    const drive = driveOf(goal);
    if (!drive || drive.halted) return null;
    const next = { ...drive, halted: { kind, ...(why ? { why } : {}), at: now() } };
    memory.setGoal(chainId, { ...goal, drive: next });
    publish?.(chainId, { type: "goal", drive: next });
    return next;
  }

  /**
   * Whether a turn ended with its reply: not stopped, its last row's final kept.
   * @param {LiveTurn} live @param {any[]} mine  the turn's archived rows
   */
  function endedWithReply(live, mine) {
    const last = mine.at(-1);
    return !live.cancel.signal.aborted && !!last?.final_hash && !last.meta?.stopped;
  }

  /**
   * The main agent offers Run as a flow under the reply of the person's turn that runs in a chat (HarnessV4_OneAgent_Plan
   * OA6, OA-D14): a button whose press sends `/flow` with the words of their message. Once a reply; never on a /flow's
   * turn, a command's, an answer's or Filament's own; a team's own chat draws no flow. → the chat's id.
   * @param {string} id @returns {string}
   */
  function offerFlowInTurn(id) {
    const chain = archive().getChain(String(id || ""));
    if (!chain) throw refusal(404, "no such chat");
    if (chain.kind === "team") throw refusal(400, "a team's own chat draws no flow");
    const live = liveTurns.get(chain.id);
    if (!live) throw refusal(409, "no turn of the person's runs in this chat to offer it under");
    if (live.flowing) throw refusal(409, "their message is /flow already: draft its flow (action draft)");
    if (!live.plain) throw refusal(409, "this turn answers no message of the person's: the button sends their words");
    // The button sends their words, and the page draws none where they sent pictures alone (conversation/turn.js).
    if (!live.worded) throw refusal(409, "their message has no words, only pictures: the button sends their words, so there is none to offer");
    if (live.flowOffer) throw refusal(409, "this reply offers it already: one a reply");
    if (live.planOffer) throw refusal(409, "this reply offers a plan first already: one card a reply");
    live.flowOffer = true;
    return chain.id;
  }

  /**
   * A plan offered under the reply (the owner's plan mode of 11-06): the agent weighed the person's message as complex
   * work and asks, on a card, whether to plan it first — at the depth it suggests, its tasks side by side or not —, or
   * just do it. Once a reply; never on a /plan's turn or its answer's, a command's, an answer's or Filament's own; a
   * team's own chat runs its lead's plan. → the chat's id.
   * @param {string} id @param {import("../../core/task-graph.js").PlanOffer} offer @returns {string}
   */
  function offerPlanInTurn(id, offer) {
    const chain = archive().getChain(String(id || ""));
    if (!chain) throw refusal(404, "no such chat");
    if (chain.kind === "team") throw refusal(400, "a team's own chat runs its lead's plan: no card offers one");
    const live = liveTurns.get(chain.id);
    if (!live) throw refusal(409, "no turn of the person's runs in this chat to offer it under");
    if (live.planning) throw refusal(409, "you are planning already: this turn is the plan the person chose — make it, and end your reply with its summary");
    if (!live.plain) throw refusal(409, "this turn answers no message of the person's: the card's Plan sends their words");
    if (!live.worded) throw refusal(409, "their message has no words, only pictures: the card's Plan sends their words, so there is none to offer");
    if (live.planOffer) throw refusal(409, "this reply offers it already: one a reply");
    if (live.flowOffer) throw refusal(409, "this reply offers Run as a flow already: one card a reply");
    if (live.flowing) throw refusal(409, "their message is /flow: do what it asks — no card offers a plan on it");
    live.planOffer = { depth: offer.depth, side: offer.side === true };
    // Written to the turn's row as it is made (the owner's of 11-10): a restart, or a failure after it, keeps the card.
    // The row is the chat's newest open one, past those before the turn; the turn's end writes its last row besides.
    const row = archive().openTurn(chain.id);
    if (row && Number(row.n) > (live.since ?? Infinity)) {
      archive().mergeTurnMeta(row.id, { planOffer: live.planOffer });
      live.planOfferRow = row.id;
    }
    return chain.id;
  }

  /**
   * Cancel the harness's own running turn (the Stop, D16's harness branch): composing, waiting for the model's first
   * byte or streaming. The turn's request is cancelled as `/requests/:id/cancel` would — but it needs no request id,
   * which only exists once the reply's head is written. → whether a turn was running.
   * @param {string} id
   */
  function cancelTurn(id) {
    const live = liveTurns.get(chainOf(id).id);
    if (!live) return false;
    live.cancel.abort();
    return true;
  }

  /**
   * A turn waits for the copy of its project's template into the chat's worktree (HarnessV4_Four_Plan FO-D36): said as
   * its phase, with the copy's progress every `COPY_SAY_MS` at most. Send without it (`skipWait`) goes on while the
   * copy carries on; the turn's Stop ends the wait, never the copy (FOC-73).
   * @param {any} chain @param {string | null | undefined} lock @param {LiveTurn} live
   * @param {import("./copies.js").CopyJob} job
   */
  async function waitForCopy(chain, lock, live, job) {
    const since = now();
    live.skip = new AbortController();
    /** @param {import("./copies.js").CopyProgress | null} p */
    const say = (p) => {
      if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, { kind: "copying", method: null, since, skippable: true, ...(p ? { copy: p } : {}) });
    };
    say(job.progress);
    let said = now();
    const off = job.on((p) => {
      if (now() - said < COPY_SAY_MS) return;
      said = now();
      say(p);
    });
    /** @param {AbortSignal} s */
    const aborted = (s) => new Promise((r) => s.addEventListener("abort", r, { once: true }));
    try {
      await Promise.race([job.done, aborted(live.skip.signal), aborted(live.cancel.signal)]);
    } finally {
      off();
      live.skip = null;
      if (sessionTurns && lock) sessionTurns.setPhase(chain.key, lock, null);
    }
    if (live.cancel.signal.aborted) throw refusal(409, "the turn was stopped from the harness before it was sent to the model");
  }

  /**
   * Send without it: what the session's running turn waits on is let go, and the turn goes on at once — a summary
   * Filament writes (the filament-agent plan's D6: folded, where what goes out is Filament's composition), memory's
   * lookups and its capture (HarnessV3-FailurePoints §5.1 item 3: without them), or a worktree's copy (FO-D36: it
   * carries on). → whether it waited on any.
   * @param {string} id
   */
  function skipWait(id) {
    const chain = headOf(id);
    const skip = liveTurns.get(chain.id)?.skip;
    if (skip && !skip.signal.aborted) {
      skip.abort();
      return true;
    }
    return !!sessionTurns?.sendWithout(chain.key);
  }

  /**
   * Where a coding agent's own turn sits in the chat's history, as its session's next prompt counts the person's turns
   * (acp/prompt.js `composePrompt`): the chat composed as it stands, the turn's words last. Past turns the chat had with
   * another model since the session's last, its bridge keeps them owed and the cycle heard (the review of cb2d2d1f0: it
   * counted the other model's turn as seen, and the catch-up handed the session its own cycle instead). Null where it
   * cannot be composed: the bridge counts the cycle as next.
   * @param {any} chain @param {any} newUser @param {string} model
   */
  async function ownPlace(chain, newUser, model) {
    try {
      const eff = effectiveOf(chain.id);
      const compactions = compactionsOf(chain.id);
      const c = await measuredCompose(chain, eff, { newUser, model, calib: model, window: null, agentHolds: true }).compose(adaptForCompose(modelTurns(chain.id), eff, chain, compactions), compactions);
      return flattenMessages("anthropic", { messages: c.body.messages }).filter(isUserTurn).length || null;
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chain.id}: the agent's own turn was not placed in the chat (${e?.message || e})`);
      return null;
    }
  }

  /**
   * A turn a coding agent began by itself (HarnessV3-ACP AC3-9): Claude went on, between the session's turns, on the
   * agent session a harness chat holds — a background task it launched ended — and the chat shows that cycle as a turn
   * of its own, which the bridge listens to: no prompt goes out. Asked for by Filament alone (a house call: the bridge's
   * hook, app/own-turns.js) and run as a harness turn is — the lock, the Stop, the run's events in the reply — with
   * Filament's words for what the agent read as its message (`ownTurnText`). Refused with `{ busy: true }` while any
   * turn runs in the session: the asker asks again once it is free — and with `asking` too while a question a turn
   * paused on waits for the person's answer: the asker asks again once the question ends — the answer's turn has
   * ended, or it ended with none (`question-over`).
   * @param {string} id
   * @param {{ upstream: string, sessionId: string, model: string, tasks?: any[] }} input
   * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res
   */
  async function ownTurn(id, input, req, res) {
    const chain = chainOf(id);
    const upstream = String(input?.upstream || "");
    const sessionId = String(input?.sessionId || "");
    const model = String(input?.model || "");
    if (!upstream || !sessionId || !model) throw refusal(400, "upstream, sessionId and model are required");
    const up = findUpstream(config.get(), upstream);
    if (!up) throw refusal(404, `no upstream "${upstream}"`);
    const busy = () => refusal(409, "a turn runs in this session", { busy: true });
    if (sessionTurns?.holder(chain.key) || liveTurns.has(chain.id)) throw busy();
    // Nor between a question a turn paused on and its answer (`asking`): the asker waits for the question to end — the
    // answer's turn, or none (`questionOver`), its lapse watched from here.
    if (watchLapse(chain.id)) throw refusal(409, "a question waits for the person's answer: the agent's own turn goes once the question ends", { busy: true, asking: true });
    const agent = agentTitle(up);
    const tasks = ownTasksOf(input?.tasks);
    const lock = takeLock(chain.key, { own: { agent } });
    if (sessionTurns && !lock) throw busy();
    const { live, gaveBack } = liveTurnFor(res);
    liveTurns.set(chain.id, live);
    watchHead(res, chain.key, live, lock);
    try {
      memory.assertPrivacy(chain.id);
      // Its agent's own task woke it: the chat's work stretch goes on with it where one is kept.
      stretchStep(chain.id, "begun", () => stretches.began(chain.id, { woken: true }));
      idleStep(chain.id, () => idleWake?.began(chain.id));
      const body = { model, stream: true, messages: [{ role: "user", content: [{ type: "text", text: ownTurnText(agent, tasks) }] }] };
      const place = await ownPlace(chain, body.messages[0], model);
      res.setHeader("x-filament-session", chain.id);
      /** @type {import("../pipeline/context.js").PreParsed} */
      const pre = {
        raw: JSON.stringify(body),
        body,
        notes: [],
        api: "session",
        responsesBody: null,
        headers: { "x-filament-chain": chain.id, "x-filament-cwd": cwdOf(chain), "x-filament-client": "harness" },
        composition: null,
        settings: effectiveOf(chain.id),
        signal: live.cancel.signal,
        runEvents: true,
        ownCycle: { upstream, sessionId, agent, tasks, place },
      };
      const before = archive().newestTurnN(chain.id);
      await pipeline.handle(req, res, "anthropic", pre);
      // A driving goal's next round, as after any turn of the chat's: what the agent's own task woke it to may end it.
      const mine = archive().getTurns(chain.id, { from: before + 1 });
      goalTurnEnded(chain, live, mine, { command: false });
      idleTurnEnded(chain.id, live, mine);
      turnHeard(chain.id, live, mine);
      // The agent may have compacted its own context in the cycle it began: the copy moves on as after any turn (C29).
      await followCopy(chain);
      return { requestId: live.requestId };
    } finally {
      liveTurns.delete(chain.id);
      if (sessionTurns && lock) sessionTurns.release(chain.key, lock);
      gaveBack();
      stretchEnded(chain.id);
    }
  }

  /**
   * The developer's sub-agent sent off or reporting back while no turn of the session ran: recorded on the session
   * with the turn it follows, so its transcript draws it between that turn and the next — now and after a restart
   * (a running turn carries its marks on its own timeline instead). A kept report sent on is recorded here whether a
   * turn runs or not; the transcript hands it to the arrival row, never as a row. The newest SUBAGENT_MARKS are kept.
   * @template {Record<string, any>} M
   * @param {string} id @param {M} mark
   * @returns {M & { afterTurn: number }}
   */
  function subagentMark(id, mark) {
    const chainId = chainIdOf(id);
    const a = archive();
    return a.appendMeta(chainId, "subagentMarks", { ...mark, afterTurn: a.newestTurnN(chainId) }, SUBAGENT_MARKS);
  }

  /**
   * What the page told the person about the session, in its own words (the filament-agent plan's Phase 4b): its toasts,
   * the errors it drew, its status lines, each with when the page said it — so an agent reads them
   * (`filament_memory_load`, view `page`) where the person had to describe them. Each text is archived as a message of
   * its own (encrypted at rest when the archive is) and the session keeps the list; the newest PAGE_LINES stay. A line
   * of no known kind, or with no words, is not kept.
   * @param {string} id @param {unknown} lines  `[{ at, kind, text }]`, oldest first
   * @returns {{ kept: number }}
   */
  function pageSaid(id, lines) {
    const chain = chainOf(id);
    const a = archive();
    let kept = 0;
    for (const l of (Array.isArray(lines) ? lines : []).slice(-PAGE_LINES)) {
      const text = String(l?.text ?? "").trim().slice(0, PAGE_LINE_CHARS);
      if (!text || !PAGE_KINDS.includes(l?.kind)) continue;
      const { hash } = a.putMessage("user", { role: "user", content: [{ type: "text", text }] });
      a.appendMeta(chain.id, "pageSaid", { at: typeof l.at === "number" && Number.isFinite(new Date(l.at).getTime()) ? l.at : now(), kind: l.kind, hash }, PAGE_LINES);
      kept++;
    }
    return { kept };
  }

  /**
   * The archive's hash of each text a session keeps for its agents — a waiting message, a report kept aside, a thread's
   * words — by the text, for the list it was last kept in: a list kept again (at every message that comes or is taken,
   * at every change of an agent) archives none of the texts it kept last time anew, nor serializes and hashes them. A
   * message stays in the archive once there (its rows are content-addressed; none is deleted), so its hash stands. Each
   * keep holds the texts it kept alone: a list kept empty holds none, nor does a chat deleted (`forgetKeptTexts`).
   * @type {Map<string, { a: any, hashes: Map<string, string> }>}
   */
  const keptTexts = new Map();
  /**
   * The list `key`'s texts as this keep archives them: each the hash the archive keeps it under, as `putMessage` says it.
   * `any`: whether the list keeps any text; one that keeps none lets go of what it kept.
   * @param {any} a  the archive @param {string} key @param {boolean} [any] @returns {(text: string) => string}
   */
  const textsKept = (a, key, any = true) => {
    const was = keptTexts.get(key);
    const old = was && was.a === a ? was.hashes : null;
    /** @type {Map<string, string>} */
    const hashes = new Map();
    if (any) keptTexts.set(key, { a, hashes });
    else keptTexts.delete(key);
    return (text) => {
      let hash = hashes.get(text) ?? old?.get(text);
      if (hash === undefined) hash = /** @type {string} */ (a.putMessage("user", { role: "user", content: [{ type: "text", text }] }).hash);
      hashes.set(text, hash);
      return hash;
    };
  };

  /**
   * A waiting message's facts beside its words, as the registry gave them or the session kept them: its kind and what
   * that kind carries, the files it wrote, and its envelope where it came sealed — who sent it, and whether its chat is
   * still owed a wake (`wakes`) or the telling of it (`fresh`). Its subject goes with its words, archived.
   * @param {any} d @returns {Omit<import("../agent/subagents.js").SavedDelivery, "text" | "subject">}
   */
  const queueFacts = (d) => ({
    from: String(d.from || ""),
    description: String(d.description || ""),
    kind: QUEUE_KINDS.includes(d.kind) ? d.kind : "report",
    ...(d.kind === "shell" ? { code: Number.isInteger(d.code) ? d.code : null } : {}),
    ...(Number.isInteger(d.ask) ? { ask: d.ask } : {}),
    ...(d.task ? { task: String(d.task) } : {}),
    ...(d.state ? { state: String(d.state) } : {}),
    ...(Number.isInteger(d.exchange) ? { exchange: d.exchange } : {}),
    ...(d.sent ? { sent: true } : {}),
    ...(d.wrote ? { wrote: true } : {}),
    ...(Array.isArray(d.writes?.paths) ? { writes: { by: String(d.writes.by || ""), paths: d.writes.paths.map(String), ...(d.writes.command ? { command: true } : {}) } } : {}),
    ...(d.seal ? { seal: true } : {}),
    ...(d.sender ? { sender: String(d.sender) } : {}),
    ...(QUEUE_VIA.includes(d.via) ? { via: d.via } : {}),
    ...(Number.isInteger(d.envelope) && d.envelope > 0 ? { envelope: d.envelope } : {}),
    ...(d.wakes ? { wakes: true } : {}),
    ...(d.fresh ? { fresh: true } : {}),
  });

  /**
   * The messages from the sub-agent machinery still waiting for the session's loop, kept across a restart: each text,
   * and a sealed one's subject, archived as a message of its own (encrypted at rest like any other when the archive
   * is), the session keeping the list of them. An empty list clears it.
   * @param {string} id @param {readonly import("../agent/subagents.js").SavedDelivery[]} list
   */
  function saveSubagentQueue(id, list) {
    const chainId = chainIdOf(id);
    const a = archive();
    const hashOf = textsKept(a, `${chainId}\nqueue`, list.length > 0);
    const entries = list.map((d) => ({ hash: hashOf(String(d.text || "")), ...(d.subject ? { subjectHash: hashOf(String(d.subject)) } : {}), ...queueFacts(d) }));
    a.mergeMeta(chainId, { subagentQueue: entries.length ? entries : undefined });
  }

  /**
   * What `saveSubagentQueue` kept, texts restored; an entry whose message is gone (or was cut at the archive's size
   * cap) is left out.
   * @param {string} id @returns {import("../agent/subagents.js").SavedDelivery[]}
   */
  function loadSubagentQueue(id) {
    const chain = chainOf(id);
    const a = archive();
    const textOf = (/** @type {unknown} */ hash) => {
      const m = hash ? a.getMessage(String(hash))?.message : null;
      return Array.isArray(m?.content) ? String(m.content.find((/** @type {any} */ b) => b?.type === "text")?.text || "") : "";
    };
    /** @type {import("../agent/subagents.js").SavedDelivery[]} */
    const out = [];
    for (const e of Array.isArray(chain.meta?.subagentQueue) ? chain.meta.subagentQueue : []) {
      const text = textOf(e?.hash);
      const subject = textOf(e?.subjectHash);
      if (text) out.push({ text, ...(subject ? { subject } : {}), ...queueFacts(e) });
    }
    return out;
  }

  /**
   * The reports the developer kept aside and has not sent on, kept across a restart (BUG-26's check): each text
   * archived as a message of its own, like the queue's, the session keeping the list. An empty list clears it.
   * @param {string} id @param {readonly { agentId: string, exchange: number, description: string, text: string }[]} list
   */
  function saveSubagentHeld(id, list) {
    const chainId = chainIdOf(id);
    const a = archive();
    const hashOf = textsKept(a, `${chainId}\nheld`, list.length > 0);
    const entries = list.map((h) => ({
      hash: hashOf(String(h.text || "")),
      agentId: String(h.agentId || ""),
      exchange: Number(h.exchange) || 0,
      description: String(h.description || ""),
    }));
    a.mergeMeta(chainId, { subagentHeld: entries.length ? entries : undefined });
  }

  /**
   * What `saveSubagentHeld` kept, texts restored; an entry whose message is gone is left out.
   * @param {string} id @returns {{ agentId: string, exchange: number, description: string, text: string }[]}
   */
  function loadSubagentHeld(id) {
    const chain = chainOf(id);
    const a = archive();
    /** @type {{ agentId: string, exchange: number, description: string, text: string }[]} */
    const out = [];
    for (const e of Array.isArray(chain.meta?.subagentHeld) ? chain.meta.subagentHeld : []) {
      const m = a.getMessage(String(e?.hash || ""))?.message;
      const text = Array.isArray(m?.content) ? String(m.content.find((/** @type {any} */ b) => b?.type === "text")?.text || "") : "";
      if (text && e.agentId) out.push({ agentId: String(e.agentId), exchange: Number(e.exchange) || 0, description: String(e.description || ""), text });
    }
    return out;
  }

  /**
   * A sub-agent's conversation as the archive keeps it, by the array it was made from: a thread kept again while its
   * conversation did not move archives nothing anew. @type {WeakMap<any[], { a: any, n: number, hash: string }>}
   */
  const convoLists = new WeakMap();
  /**
   * A sub-agent's conversation archived (10-26): each message once, by its hash — encrypted at rest when the archive
   * is — and the list of their hashes as one message of its own, whose hash the thread keeps.
   * @param {any} a  the archive @param {any[]} convo @returns {string}
   */
  function keptConvo(a, convo) {
    const was = convoLists.get(convo);
    if (was && was.a === a && was.n === convo.length) return was.hash;
    const hashes = convo.map((m) => a.putMessage(m?.role === "assistant" ? "assistant" : "user", m).hash);
    const hash = a.putMessage("system", { role: "system", content: JSON.stringify({ convo: hashes }) }).hash;
    convoLists.set(convo, { a, n: convo.length, hash });
    return hash;
  }
  /**
   * A conversation `keptConvo` archived, or null where it is not there whole: a message gone, or kept cut at the
   * archive's size cap. @param {any} a  the archive @param {unknown} hash @returns {any[] | null}
   */
  function convoKept(a, hash) {
    const list = hash ? a.getMessage(String(hash)) : null;
    /** @type {unknown} */
    let hashes = null;
    try {
      hashes = JSON.parse(String(list?.message?.content || "")).convo;
    } catch {
      return null;
    }
    if (!Array.isArray(hashes) || !hashes.length) return null;
    const out = [];
    for (const h of hashes) {
      const m = a.getMessage(String(h));
      if (!m || m.truncated) return null;
      out.push(m.message);
    }
    return out;
  }

  /**
   * One sub-agent's thread as the session keeps it across a restart (HarnessV4_Tasks E15 step 5, BW-10), in place of
   * what it kept of that sub-agent: who it is, each message to it with its answer, and its conversation (10-26). Its
   * texts — the card's words, a team's line, each message and each answer — and each message of its conversation are
   * archived as messages of their own (encrypted at rest when the archive is), and the session keeps the list, in the
   * order the sub-agents began. Past `max` threads the one idle the longest goes; one that runs always stays. One whose
   * work waits for the developer's Apply (the owner's of 10-28: past the newest 30 it went from Changes) stays too, and
   * so does one whose mark as applied can be undone, for a day (`markUndoable`) — its work held for the undo, which the thread alone can make —, and
   * neither counts toward `max` (the owner's of 11-04: 75 marked threads held every place, and each new thread put out
   * the one before it, a Product agent's among them).
   * @param {string} id @param {import("../agent/subagents.js").SavedThread} thread @param {number} max
   */
  function saveSubagentThread(id, thread, max) {
    const chainId = chainIdOf(id);
    const a = archive();
    const hashOf = textsKept(a, `${chainId}\nthread\n${thread.id}`);
    const keep = (/** @type {unknown} */ text) => (text ? hashOf(String(text)) : null);
    const { thinks, ...card } = thread.card;
    const { convo, ...rest } = thread;
    const entry = {
      ...rest,
      ...(convo?.length ? { convoHash: keptConvo(a, convo) } : {}),
      card: { ...card, thinksHash: keep(thinks) },
      team: thread.team ? { key: thread.team.key, name: thread.team.name, role: thread.team.role, wordsHash: keep(thread.team.words), ...seatOf(thread.team) } : null,
      exchanges: thread.exchanges.map(({ prompt, outcome, ...x }) => {
        const { report = "", ...figures } = outcome || {};
        return { ...x, promptHash: keep(prompt), outcome: outcome ? { ...figures, reportHash: keep(report) } : null };
      }),
    };
    const last = (/** @type {any} */ t) => Number(t.exchanges?.at(-1)?.startedAt) || Number(t.startedAt) || 0;
    const waits = (/** @type {any} */ t) => (Array.isArray(t.work?.files) && t.work.files.length > 0) || !!markUndoable(t);
    const counts = (/** @type {any} */ t) => !waits(t);
    // The other threads stay as they are kept: the list is read and written back in one step, its meta parsed once.
    a.updateMeta(chainId, (meta) => {
      const kept = Array.isArray(meta.subagentThreads) ? meta.subagentThreads.filter((/** @type {any} */ t) => t?.id) : [];
      const at = kept.findIndex((/** @type {any} */ t) => t.id === entry.id);
      const list = at < 0 ? [...kept, entry] : kept.map((/** @type {any} */ t, /** @type {number} */ i) => (i === at ? entry : t));
      while (list.filter(counts).length > Math.max(1, max)) {
        const idle = list.filter((t) => counts(t) && t.status !== "running" && t.id !== entry.id);
        if (!idle.length) break;
        const oldest = idle.reduce((o, t) => (last(t) < last(o) ? t : o));
        list.splice(list.indexOf(oldest), 1);
        keptTexts.delete(`${chainId}\nthread\n${oldest.id}`);
      }
      meta.subagentThreads = list;
    });
  }

  /**
   * A thread the person deleted (the owner's ask of 10-23) leaves what `saveSubagentThread` kept.
   * @param {string} id @param {string} agentId
   */
  function forgetSubagentThread(id, agentId) {
    const chain = chainOf(id);
    const kept = Array.isArray(chain.meta?.subagentThreads) ? chain.meta.subagentThreads : [];
    const rest = kept.filter((/** @type {any} */ t) => t?.id !== agentId);
    if (rest.length !== kept.length) archive().mergeMeta(chain.id, { subagentThreads: rest.length ? rest : undefined });
    keptTexts.delete(`${chain.id}\nthread\n${agentId}`);
  }

  /**
   * A chat deleted (server.js `onSessionsDeleted`): what `textsKept` held of its waiting messages, its reports kept aside
   * and its threads goes with it. → how many lists let go. @param {string} chainId
   */
  function forgetKeptTexts(chainId) {
    const of = `${chainId}\n`;
    let n = 0;
    for (const key of keptTexts.keys())
      if (key.startsWith(of)) {
        keptTexts.delete(key);
        n++;
      }
    return n;
  }
  /** How many lists `textsKept` holds texts of, for a test. */
  const keptTextLists = () => keptTexts.size;

  /**
   * What `saveSubagentThread` kept, texts restored, the oldest first. A text whose message is gone reads empty; a
   * conversation not there whole is null. `held`: the threads the registry holds already, left out before a text or a
   * conversation of theirs is read.
   * @param {string} id @param {((agentId: string) => boolean) | null} [held]
   * @returns {import("../agent/subagents.js").SavedThread[]}
   */
  function loadSubagentThreads(id, held = null) {
    const a = archive();
    const kept = a.metaOf(chainIdOf(id), ["subagentThreads"])?.subagentThreads;
    const text = (/** @type {unknown} */ hash) => {
      const m = hash ? a.getMessage(String(hash))?.message : null;
      return Array.isArray(m?.content) ? String(m.content.find((/** @type {any} */ b) => b?.type === "text")?.text || "") : "";
    };
    return (Array.isArray(kept) ? kept : [])
      .filter((/** @type {any} */ t) => t?.id && t.card && !held?.(t.id))
      .map((/** @type {any} */ t) => {
        const { thinksHash, ...card } = t.card;
        const { convoHash, ...rest } = t;
        return {
          ...rest,
          convo: convoHash ? convoKept(a, convoHash) : null,
          card: { ...card, thinks: text(thinksHash) },
          team: t.team ? { key: t.team.key, name: t.team.name, role: t.team.role, words: text(t.team.wordsHash), ...seatOf(t.team) } : null,
          exchanges: (Array.isArray(t.exchanges) ? t.exchanges : []).map((/** @type {any} */ e) => {
            const { promptHash, outcome, ...x } = e;
            const { reportHash = null, ...figures } = outcome || {};
            return { ...x, prompt: text(promptHash), outcome: outcome ? { ...figures, report: text(reportHash) } : null };
          }),
        };
      });
  }

  /**
   * A compaction's summary on its boundary row, as the page opens it (Show summary): its first 4,000 characters, on
   * the transcript's row and on the one a Compact or an /autofit hands the page to draw at once.
   * @param {string | null | undefined} text
   */
  const boundaryText = (text) => (text ? { text: String(text).slice(0, 4000) } : {});

  /**
   * What moved at each settings boundary, in the settings history's own lines (the session's writes between the two
   * turns, from the operation log): `changes: [{ path, to }]` on the boundary, `to` absent when the knob inherits
   * again. A boundary the log has rolled past keeps no list — the row then says only that settings changed.
   * @param {string} chainId @param {any[]} boundaries  mutated
   */
  function attachSettingsChanges(chainId, boundaries) {
    const marks = boundaries.filter((b) => b.type === "settings");
    if (!marks.length || !ops.list) return;
    const mine = ops.list({ kinds: ["archive"], limit: 2000 })
      .filter((o) => o.sub === "session-settings" && (o.ref?.chainId === chainId || o.detail?.chainId === chainId));
    if (!mine.length) return;
    for (const b of marks) {
      const from = Number(b.since) || 0, to = Number(b.at) || 0;
      /** @type {Map<string, { path: string, to?: any }>} */
      const moved = new Map();
      // Oldest first, so a knob written twice between the turns reads as its last value.
      for (const o of [...mine].reverse()) {
        const t = Date.parse(o.ts);
        if (!(t > from && t <= to + 2000)) continue;
        for (const line of Array.isArray(o.detail?.changes) ? o.detail.changes : []) {
          const c = settingsChangeOfLine(line);
          if (c) moved.set(c.path, c);
        }
      }
      if (moved.size) b.changes = [...moved.values()];
    }
  }

  /**
   * One visual the agent drew in a turn (HarnessV4_Visuals_Plan E16, VS-D9), whole: its title, its code and the lines
   * shown while it is drawn — kept on the turn as it was drawn, so a running turn's are there too.
   * @param {string} id @param {number} n  the turn's number @param {string} vid  the visual's id
   */
  function turnVisual(id, n, vid) {
    const chain = chainOf(id);
    const a = archive();
    const t = Number.isInteger(Number(n)) ? a.turnBodies(chain.id, { ns: [Number(n)] })[0] : null;
    if (!t) throw refusal(404, "no such turn");
    const v = a.turnVisual(t.turnId, String(vid));
    if (!v) throw refusal(404, "no such visual in this turn");
    return { n: t.n, ...v };
  }

  /**
   * One visual the session keeps itself (VS-D48), whole: a helper's that no turn launched — one the developer asked, one
   * that started by itself.
   * @param {string} id @param {string} vid  the visual's id
   */
  function sessionVisual(id, vid) {
    const chain = chainOf(id);
    const v = archive().chainVisual(chain.id, String(vid));
    if (!v) throw refusal(404, "no such visual in this session");
    return v;
  }

  /**
   * A stretch of one turn's work, as a page draws it (`workSteps`): what the model said in order, each message with
   * the calls it made as cards and what they returned — from the message at `from`, `WORK_PAGE` messages on, then
   * past them to the next message of the model's, so no call is cut from what it returned.
   * `next` is where the next stretch begins (null at the work's end), `total` how many messages the work has. A
   * call's input rides with its long strings cut, as what it returned rides cut: the archive keeps both whole.
   * @param {string} id @param {number} n  the turn's number @param {{ from?: number }} [o]
   */
  function turnWork(id, n, { from = 0 } = {}) {
    const chain = chainOf(id);
    const a = archive();
    const t = Number.isInteger(Number(n)) ? a.turnBodies(chain.id, { ns: [Number(n)] })[0] : null;
    if (!t) throw refusal(404, "no such turn");
    const start = Math.max(0, Math.floor(Number(from)) || 0);
    const { total, messages } = a.turnWork(t.turnId, { from: start, to: start + WORK_PAGE });
    let end = start + messages.length;
    while (end < total) {
      const [m] = a.turnWork(t.turnId, { from: end, to: end + 1 }).messages;
      if (isModelMessage(m)) break;
      messages.push(m);
      end++;
    }
    const kept = messages.filter(Boolean);
    const format = t.meta?.format ?? wireFormatOf([t.user, ...kept, t.final]) ?? "anthropic";
    return {
      n: t.n,
      total,
      from: start,
      next: end < total ? end : null,
      work: workSteps(kept, format),
    };
  }

  /** The edit and write calls of the turns read last, by the turn's row and how many messages its work had then
   *  (HarnessV4_Four_Plan FO-D9): a page of a hundred cards reads its turn once.
   *  @type {Map<string, Map<string, { name: string, input: any }>>} */
  const turnEdits = new Map();
  /** How many turns' calls `turnEdits` keeps. */
  const TURN_EDITS_KEPT = 4;

  /**
   * One edit or write call's change as the call made it (HarnessV4_Four_Plan E22): read from its input, which the
   * archive keeps whole (`madeChange`), for a card whose file no snapshot of its turn holds — a file outside every git
   * place, or a turn with no run on record. 404 in words, with `why`: "later" for a call the work of a turn still
   * running does not hold yet (it is written as the turn goes), "absent" for one an ended turn's does not hold (a
   * helper's call is kept with the helper), "none" for one whose record holds no change.
   * @param {string} id @param {number} n  the turn's number @param {string} callId
   */
  function callChange(id, n, callId) {
    const chain = chainOf(id);
    const a = archive();
    const t = Number.isInteger(Number(n)) ? a.turnBodies(chain.id, { ns: [Number(n)] })[0] : null;
    if (!t) throw refusal(404, "no such turn");
    const { total } = a.turnWork(t.turnId, { from: 0, to: 0 });
    const key = `${t.turnId}:${total}`;
    let calls = turnEdits.get(key);
    if (calls) turnEdits.delete(key);
    else {
      const { messages } = a.turnWork(t.turnId);
      const kept = messages.filter(Boolean);
      const format = t.meta?.format ?? wireFormatOf([t.user, ...kept, t.final]) ?? "anthropic";
      calls = new Map();
      for (const c of toolsOfTurn(kept, format)) {
        const kind = kindOfName(c.name);
        if (c.id && (kind === "write" || kind === "edit" || kind === "edit-many")) calls.set(String(c.id), { name: c.name, input: c.input });
      }
    }
    turnEdits.set(key, calls);
    while (turnEdits.size > TURN_EDITS_KEPT) turnEdits.delete(/** @type {string} */ (turnEdits.keys().next().value));
    const call = calls.get(String(callId));
    if (!call) throw refusal(404, "the turn's record does not hold this call", { why: t.endedAt == null ? "later" : "absent" });
    const made = madeChange(call.name, call.input);
    if (!made) throw refusal(404, "this call's record holds no change", { why: "none" });
    return { n: t.n, id: String(callId), ...made };
  }

  /** Where each call's result stands in the work of the turns read last, by the turn's row and how many messages its
   *  work had then: a card opened again reads the one message that holds its result, never the whole work again.
   *  Places alone, never the results. @type {Map<string, Map<string, number>>} */
  const turnResults = new Map();
  /** How many turns' places `turnResults` keeps. */
  const TURN_RESULTS_KEPT = 4;
  /** How much of one result a card is sent whole; past it the answer says it was cut (`cut`) and its whole length. */
  const RESULT_WHOLE_CHARS = 2_000_000;

  /**
   * One call's result whole, as the archive keeps it, for a card whose transcript carried its head alone
   * (`RESULT_PREVIEW_CHARS`, the owner's of 11-15: "fold the tool calls such that long text is not held in memory, and
   * clicking that tool call may simply ask for wait until that part is loaded from disk"): its text read as the
   * preview's was (`resultsOf`), cut past `RESULT_WHOLE_CHARS`. The work is read a message at a time, so no more of
   * it is held at once than one message. 404 in words, with `why`: "later" for a call whose result the work of a turn
   * still running does not hold yet, "absent" for one an ended turn's does not hold.
   * @param {string} id @param {number} n  the turn's number @param {string} callId
   * @returns {{ n: number, id: string, result: string, chars: number, cut: boolean }}
   */
  function callResult(id, n, callId) {
    const chain = chainOf(id);
    const a = archive();
    const t = Number.isInteger(Number(n)) ? a.turnBodies(chain.id, { ns: [Number(n)] })[0] : null;
    if (!t) throw refusal(404, "no such turn");
    // The work's messages by their hashes, each opened alone, as `turnWork` opens them (one the archive no longer holds
    // is null).
    /** @type {string[]} */
    const work = a.getTurn(t.turnId)?.work ?? [];
    const messageAt = (/** @type {number} */ i) => (work[i] == null ? null : a.getMessage(work[i])?.message ?? null);
    // The format as the transcript reads it (`turnWork`): the turn's own, else the first message that shows one.
    let format = t.meta?.format ?? wireFormatOf([t.user]);
    /** @param {any} m */
    const resultsIn = (m) => resultsOf(m, (format ??= wireFormatOf([m])) ?? "anthropic");
    const key = `${t.turnId}:${work.length}`;
    let places = turnResults.get(key);
    if (places) turnResults.delete(key);
    else {
      places = new Map();
      // A result given twice is its last, as the transcript pairs it.
      for (let i = 0; i < work.length; i++) for (const r of resultsIn(messageAt(i))) places.set(String(r.id), i);
    }
    turnResults.set(key, places);
    while (turnResults.size > TURN_RESULTS_KEPT) turnResults.delete(/** @type {string} */ (turnResults.keys().next().value));
    const at = places.get(String(callId));
    const text = at == null ? null : resultsIn(messageAt(at)).findLast((r) => String(r.id) === String(callId))?.text;
    if (text == null) throw refusal(404, "the turn's record does not hold this call's result", { why: t.endedAt == null ? "later" : "absent" });
    const cut = text.length > RESULT_WHOLE_CHARS;
    return { n: t.n, id: String(callId), result: cut ? text.slice(0, RESULT_WHOLE_CHARS) : text, chars: text.length, cut };
  }

  /**
   * A chat's threads (core/threads.js), each named as the sessions list names it — its title, else its first words —
   * in one read: the chat whose agent started it, and those its own agent started, the newest first. A chat deleted
   * since is left out, but for its starter, whose id stands still. @param {string} chainId
   * @returns {{ from: { id: string, title: string } | null, started: { id: string, title: string }[] }}
   */
  function threadsNamed(chainId) {
    const a = archive();
    const link = a.threadsOf?.(chainId) || { from: null, started: [] };
    const ids = [...(link.from ? [link.from] : []), ...link.started];
    if (!ids.length) return { from: null, started: [] };
    const rows = new Map(a.listChains({ ids, archived: "all", limit: ids.length }).map((/** @type {any} */ c) => [String(c.id), c]));
    /** @param {string} id */
    const named = (id) => {
      const c = rows.get(id);
      return c ? { id, title: String(c.title || c.preview || "") } : null;
    };
    return {
      from: link.from ? named(link.from) ?? { id: link.from, title: "" } : null,
      started: link.started.flatMap((id) => named(id) ?? []),
    };
  }

  /**
   * The transcript for rendering: turns with their messages, the settings in force, the boundaries (a settings hash
   * that changed between two turns; a compaction; the developer's sub-agent sent off or back between turns), the live
   * turn when one runs, the parked question when one waits.
   * `work`: true carries each turn's work whole, and its calls as cards (`tools`); false carries how many messages
   * it has (`workCount`), opening none; "held" is a page's reading — the count, the work's tool legs and calls as
   * the archive kept them (`tally`; null for a turn written before they were kept), and for a turn that answers the
   * question before it the reply that asked (`opens`, its words: the page draws them on the asking turn) — with
   * each turn's work asked for apart, a stretch at a time (`turnWork`). A long session's work is hundreds of
   * megabytes; no page holds it at once, and none is asked to.
   * Every answer names the version of the turns it was read at (`version`, the archive's `turnsVersion`). `written`, a
   * version a page holds, with neither `since` nor `limit`: the turns begun or changed past it, and only those —
   * no message of another opened (a long chat's whole read is megabytes, and a page reads its chat at each turn's
   * end); whether a rewind stands is read from the turns' outline the answer holds (`standingRewind`), no turn's row —
   * with every turn's id in order (`ids`), the ids of those whose newest request has a run now (`runs`, each row's `run`
   * for the turns not sent: a run file the retention sweep removed leaves its turn out), and `written` again; the rest
   * of the answer is whole.
   * A version of no read of this archive's opening — before a restart — is answered whole.
   * @param {string} id @param {{ since?: number | null, limit?: number | null, work?: boolean | "held", written?: string | null }} [o]
   */
  function transcript(id, { since = null, limit = null, work = true, written = null } = {}) {
    const chain = chainOf(id);
    const a = archive();
    const project = chain.project_id ? a.getProject(chain.project_id) : null;
    // Read before any turn is: a write between the two would be read again next time, never missed.
    const version = a.turnsVersion();
    const past = written && since == null && limit == null ? a.turnsWrittenAt(written) : null;
    // What is read across every turn — the boundaries, what each carried, the rewound lines, each window's newest —
    // comes from the turns in outline: no message opened, no turn's meta parsed whole. The turns the answer carries
    // are read whole below, and only those.
    const all = a.turnOutline(chain.id);
    const compactions = compactionsOf(chain.id);
    /** @type {any[]} */
    const boundaries = [];
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1].settingsHash, cur = all[i].settingsHash;
      if (prev && cur && prev !== cur) boundaries.push({ type: "settings", beforeTurn: all[i].n, from: prev, to: cur, at: all[i].startedAt, since: all[i - 1].startedAt });
    }
    attachSettingsChanges(chain.id, boundaries);
    const undoable = undoableCompaction(chain.id);
    // One a coding agent made in the middle of a turn is drawn after that turn: Filament's copy starts inside it.
    for (const c of compactions)
      boundaries.push({
        type: "compaction", id: c.id, afterTurn: madeDuring(c) ?? (Number(c.to_turn) || 0), fromTurn: Number(c.from_turn) || 1, toTurn: Number(c.to_turn) || 0, kind: c.kind, method: c.method,
        chars: c.text ? c.text.length : 0, at: c.created_at, detail: c.detail || null, undoable: !!undoable && Number(undoable.id) === Number(c.id),
        ...boundaryText(c.text),
      });
    // The chat's moves to another place (HarnessV4_Git_Plan GW-D77), each after the turn it followed; the newest goes
    // back from its row while no turn has run since (GW-D79).
    const moves = Array.isArray(chain.meta?.moves) ? chain.meta.moves : [];
    const turnsNow = all.at(-1)?.n || 0;
    moves.forEach((m, i) => boundaries.push(movedBoundary(m, { newest: i === moves.length - 1, turns: turnsNow })));
    // The copies of its project's worktree template into a worktree it was made in or moved to (HarnessV4_Four_Plan
    // FO-D37), each after the turn it followed; one still running reads so while its job runs.
    const live = copies?.running(chain.id)?.id || null;
    for (const c of Array.isArray(chain.meta?.copies) ? chain.meta.copies : []) boundaries.push(copiedBoundary(c, c.id === live));
    // A kept report the developer sent on is no row of its own: its arrival row reads it (`subagentSent`), after a
    // restart as well, when the registry no longer knows the sub-agent.
    /** @type {string[]} */
    const subagentSent = [];
    // An answer the developer overruled is no row either: the answer's card reads it, with the first line of their
    // words, the newest where they overruled it twice.
    /** @type {Record<string, { at: number, words: string }>} */
    const subagentOverruled = {};
    const carriedBy = carriedTurns(all);
    for (const m of Array.isArray(chain.meta?.subagentMarks) ? chain.meta.subagentMarks : [])
      if (m?.event === "sent") subagentSent.push(`${m.agentId}:${m.exchange}`);
      else if (m?.event === "overruled") subagentOverruled[`${m.agentId}:${Number(m.exchange) || 0}`] = { at: Number(m.at) || 0, words: String(m.words || "") };
      else boundaries.push({ ...m, type: "subagent", ...carriedFacts(m, carriedBy) });
    // The teams beside it (team_v2_plan §5.4): where each was fired and where its result came, after the turn each
    // followed; the page draws their cards from the teams' own state.
    for (const m of Array.isArray(chain.meta?.teamMarks) ? chain.meta.teamMarks : []) boundaries.push({ ...m, type: "team" });
    // Each switch of who answers (Bug Hunter #13): the page's dividers read them beside the turns' own stamps.
    for (const m of Array.isArray(chain.meta?.engineMarks) ? chain.meta.engineMarks : []) boundaries.push({ ...m, type: "engine" });
    // The side-by-side card (Phase 5), while it stands: after the turn in which the agent suggested it (11-10).
    const side = sideOffers?.offered(chain.id) || null;
    if (side) boundaries.push({ type: "side", ...side, afterTurn: side.turn });
    // The cards for sub-agents that change files, held while Parallelize tasks is off (held-launch.js): the one waiting
    // and the newest answered, each after the turn it was held in — a page loaded anew draws them as the feed did.
    for (const h of subagents?.held?.(chain.id) || []) boundaries.push({ ...h, type: "held", afterTurn: h.turn ?? turnsNow });
    // A kept report still waiting to be sent on: its arrival row keeps its Send after a restart too.
    const subagentHeld = (Array.isArray(chain.meta?.subagentHeld) ? chain.meta.subagentHeld : []).map((/** @type {any} */ e) => `${e.agentId}:${Number(e.exchange) || 0}`);
    // The chats linked to it as threads (core/threads.js): the one whose agent started it and those its own agent
    // started, each named as the sessions list names it — the header's chip reads them, whatever the list holds.
    const threads = threadsNamed(chain.id);
    /**
     * The chat whose agent wrote the brief a turn opened with (`briefSaidIn`): the starter the link names while it
     * stands, else the one the brief's block names — the turn is a brief with no link. Null for a turn that is none.
     * @param {any} t
     */
    const briefOfTurn = (t) => {
      const said = briefSaidIn(t);
      return said ? { from: threads.from?.id ?? briefFrom(said) } : null;
    };
    // The turns past `since`, the newest `limit` of them, or those written past the version held, chosen by the
    // archive's query, their messages read in one go: the work too where the answer carries it whole.
    const turns = a.turnBodies(chain.id, {
      after: since != null && Number.isFinite(Number(since)) ? Number(since) : null,
      last: limit != null && Number(limit) > 0 ? Number(limit) : null,
      written: past,
      open: work === true ? "all" : "ends",
    });
    // The settings in force as the transcript says them: the resolution, the window and the engine — not the whole
    // settings answer (`settingsOf`), whose catalogues and lists it never carries.
    const { resolved } = settingsBase(chain);
    // A rewound line's range (D11): every turn of the line carries the same line id; the row renders once, with
    // the range — first to last — and the client of the window that rewound it (§5's "in <client>"). The client is
    // read from `windowsOf` (Facade D10), so a session whose window list was never stored names it too.
    const rewoundLines = new Map();
    for (const t of all) {
      const line = t.rewoundLine;
      if (!line) continue;
      const cur = rewoundLines.get(line);
      rewoundLines.set(line, { from: Math.min(cur?.from ?? t.n, t.n), to: Math.max(cur?.to ?? t.n, t.n) });
    }
    // The windows list for the rewound rows and a client's name on the page (Facade D10): one row per window, its client
    // and the client's words.
    const windowsMeta = a.windowsOf(chain.id) || {};
    /** @type {Map<string, string | null>} window → its client id */
    const clientOfWindow = new Map(Object.entries(windowsMeta).map(([w, v]) => [w, (/** @type {any} */ (v))?.client ?? null]));
    const windows = [...clientOfWindow].map(([window, client]) => ({ window, client, clientLabel: clientLabel(client) }));
    const rewoundClient = (/** @type {string} */ by) => (by === "harness" ? "harness" : clientOfWindow.get(by) || null);
    /**
     * A newer try of a turn that failed runs in its row now (HarnessV4_Tasks B8; the owner's of 11-10, chat Fable52): a
     * request of this Filament's marks it running until its record closes, so the earlier try's failure — its words, and
     * the facts' error the page draws as the turn's — is behind it, and the page follows the turn as the open one it is.
     * A mark from before this Filament started is a cut-off's (`cutOffBefore`). @param {any} t
     */
    const tryingAgain = (t) => !t.final && Number(t.meta?.running) >= bootAt;
    /** The turn's facts, without an earlier try's failure while a newer one runs (`tryingAgain`). @param {any} t */
    const factsNow = (t) => {
      const f = t.meta?.facts || null;
      return f && tryingAgain(t) ? { ...f, error: null, errorDetail: null, limit: null, needsRoom: null, signIn: null } : f;
    };
    // Who began each turn, as the one reader reads it (`turnByOf`): the marks the page draws by are of it.
    const marked = bySince();
    const begunBy = new Map(turns.map((t) => [t, turnByOf(t, marked)]));
    /** What woke the chat at a watcher's turn, as that turn keeps it (`watch`); nothing where it keeps none. @param {any} t */
    const wokeOf = (t) => {
      const watch = chatWatching?.woke(t.meta?.watch) ?? null;
      return watch ? { watch } : {};
    };
    /**
     * A guidance turn's parts, for its card (`guide`): what a Space keeps of it, by the turn's number; else its
     * message's own two parts (core/watchers.js `guidanceParts`), which name no watcher to press. @param {any} t
     */
    const guideOf = (t) => {
      const kept = chatWatching?.guide(chain.id, t.n) ?? null;
      if (kept) return { guide: kept };
      const said = guidanceParts(t.user);
      return said ? { guide: { title: said.title, text: said.text } } : {};
    };
    return {
      chainId: chain.id,
      title: chain.title || null,
      kind: chain.kind,
      projectId: chain.project_id || null,
      cwd: cwdOf(chain),
      model: resolved.effective.model?.name || chain.model || null,
      turns: turns.map((t) => ({
        n: t.n,
        turnId: t.turnId,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        requestIds: t.requestIds || [],
        // The page's own names of the sends the turn holds (each try of its message's), oldest first.
        ...(Array.isArray(t.meta?.sends) && t.meta.sends.length ? { sends: t.meta.sends } : {}),
        // Whether the turn's newest request has a run to look up: an agent turn's, not a command's.
        run: !!(runs && t.requestIds?.length && runs.hasRun(t.requestIds[t.requestIds.length - 1])),
        user: t.user,
        // The user message's first `deliveries` text blocks are sub-agents' messages and (the last `shellExits` of
        // them) background shells' exits that rode with it: the page draws the typed text alone, and a note for these.
        ...(Number(t.meta?.deliveries) > 0 ? { deliveries: Number(t.meta.deliveries) } : {}),
        ...(Number(t.meta?.asking) > 0 ? { asking: Number(t.meta.asking) } : {}),
        // Whom the message named with an `@` for the main agent to use (one line of the deliveries, after `asking`), and
        // those of them, and of its notes', it did not use (HarnessV4_OneAgent_Plan OA2).
        ...(Array.isArray(t.meta?.use) && t.meta.use.length ? { use: t.meta.use } : {}),
        ...(Array.isArray(t.meta?.unused) ? { unused: t.meta.unused } : {}),
        // A /flow's message: one line of the deliveries, after `use`, asks the main agent for a flow (OA3); a /parallel's
        // of before 11-10, when the box still took it, for a re-plan whose independent tasks could run in parallel (Phase 5)
        // — under Parallelize tasks (`parallelOn`), for its agent to start them itself.
        ...(t.meta?.flow === true ? { flow: true } : {}),
        ...(t.meta?.parallel === true ? { parallel: true } : {}),
        ...(t.meta?.parallelOn === true ? { parallelOn: true } : {}),
        // A /plan's message, and what its plan left once it ended with its reply (`planReady`): the page's card opens the Plan.
        ...(t.meta?.plan === true ? { plan: true } : {}),
        ...(t.meta?.planReady ? { planReady: t.meta.planReady } : {}),
        // A plan its agent offered under the reply (11-06): the card.
        ...(t.meta?.planOffer ? { planOffer: t.meta.planOffer } : {}),
        ...(t.meta?.side === true ? { side: true } : {}),
        // Its main agent offered Run as a flow under the reply (OA6): the page draws the button.
        ...(t.meta?.flowOffer === true ? { flowOffer: true } : {}),
        // Of the agents' messages, the starts of the person's flows beside the chat (OA-D8).
        ...(Number(t.meta?.flowStarts) > 0 ? { flowStarts: Number(t.meta.flowStarts) } : {}),
        // And the word of a flow it drives In place that waited for the message (OA4).
        ...(Number(t.meta?.flowNews) > 0 ? { flowNews: Number(t.meta.flowNews) } : {}),
        ...(Number(t.meta?.shellExits) > 0 ? { shellExits: Number(t.meta.shellExits) } : {}),
        ...(Number(t.meta?.shellWatch) > 0 ? { shellWatch: Number(t.meta.shellWatch) } : {}),
        ...(Number(t.meta?.shellWake) > 0 ? { shellWake: Number(t.meta.shellWake) } : {}),
        ...(Number(t.meta?.shellIdle) > 0 ? { shellIdle: Number(t.meta.shellIdle) } : {}),
        ...(Number(t.meta?.shellCancel) > 0 ? { shellCancel: Number(t.meta.shellCancel) } : {}),
        // A rewind's line rode with it (rewind.js): one of the deliveries, after a /flow's; then the goal's halt's
        // (core/goal-drive.js `haltLine`).
        ...(t.meta?.rewindNote === true ? { rewindNote: true } : {}),
        ...(t.meta?.goalHalt === true ? { goalHalt: true } : {}),
        // Whose answers the message overrules (the last of the deliveries before the shells' exits), by name.
        ...(Array.isArray(t.meta?.overrules) && t.meta.overrules.length ? { overrules: t.meta.overrules } : {}),
        ...(work === true ? { work: t.work } : { workCount: t.workCount }),
        ...(work === "held"
          ? { tally: t.meta?.tally || null, ...(t.meta?.resumes && t.workCount ? { opens: saidOf(a.turnWork(t.turnId, { from: 0, to: 1 }).messages[0]) } : {}) }
          : {}),
        final: t.final,
        open: !t.final,
        // The visuals the agent drew in it (HarnessV4_Visuals_Plan E16), each by its id, title and size: the page
        // fetches a visual's code as it draws it (`turnVisual`).
        ...(Array.isArray(t.meta?.visuals) && t.meta.visuals.length ? { visuals: t.meta.visuals.map(({ hash: _hash, ...v }) => v) } : {}),
        // A restart or a crash cut it off before its reply (2b-C D8): the page says so, and what the next start kept
        // of it from its run's log (`meta.cut`, app/sessions/cut-turns.js; HarnessV4_Tasks U1).
        ...(cutOffBefore(t, bootAt) ? { cutOff: true, ...(t.meta?.cut ? { cut: { rounds: Number(t.meta.cut.rounds) || 0, tools: Number(t.meta.cut.tools) || 0, logged: Number(t.meta.cut.logged) || 0, ...(t.meta.cut.resume ? { resume: t.meta.cut.resume } : {}) } } : {}) } : {}),
        // Who began it, where it is not the person (core/turn-by.js, `turnByOf`): each mark the page draws a message of
        // Filament's own by is of it.
        ...(begunBy.get(t) !== "person" ? { by: begunBy.get(t) } : {}),
        // The turn Filament sent to go on with one a restart cut off (TG2-D83): its message is Filament's, drawn so. So
        // is the one it sent as a background command ended (E21, FO-D49, `woke`), and a sync's from the project's Space
        // (proposal_ux §4.14, `synced`).
        ...(begunBy.get(t) === "resume" ? { resumed: true } : {}),
        ...(begunBy.get(t) === "wake" ? { woke: true } : {}),
        // …and the one it sent as a driving goal's next round (core/goal-drive.js), with its round.
        ...(begunBy.get(t) === "goal" && goalRoundOf(t.user) ? { goalRound: goalRoundOf(t.user) } : {}),
        ...(begunBy.get(t) === "sync" ? { synced: true } : {}),
        // A team beside's result the person sent on (team_v2_plan §5.4), and a team's lead's first message, whose first
        // block is the main chat's record: the page folds it under What the lead read.
        ...(begunBy.get(t) === "beside" && isTeamResult(t.user) ? { teamResult: true } : {}),
        // A flow's end (HarnessV4_Flow_Plan FL-D11): Filament's message, drawn as a team's result is. So is the one that
        // opened the turn a flow started In place (HarnessV4_OneAgent_Plan OA4).
        ...(begunBy.get(t) === "beside" && isFlowEnd(t.user) ? { flowEnd: true } : {}),
        ...(begunBy.get(t) === "beside" && isFlowDrive(t.user) ? { flowDrive: true } : {}),
        // A thread's brief (core/threads.js): its starter's agent's words, which the page draws as theirs. The chat's
        // first turn's or one the service took as a brief (`briefSaidIn`), read past what rode ahead of it (an ask
        // line where a saved agent may be asked), and naming the chat the archive links it to, else the one its block
        // names: words typed later that open as a brief would are the person's own.
        ...(begunBy.get(t) === "thread" && briefOfTurn(t) ? { brief: briefOfTurn(t) } : {}),
        // A watcher's wake of this chat (core/watchers.js `isWatchWake`): Filament's turn beside the person's, drawn as
        // the watcher's — which one, and what it heard, as the wake kept them on the turn (`watch`; app/routines.js).
        ...(begunBy.get(t) === "watch" ? { watched: true, ...wokeOf(t) } : {}),
        // A watcher's guidance sent to this chat as a turn (core/watchers.js `isGuidance`): Filament's too, drawn as
        // the watcher's, with its parts for the card (`guide`).
        ...(begunBy.get(t) === "guide" ? { guided: true, ...guideOf(t) } : {}),
        // The first message of a chat Filament made for it — a routine's run, a Space ask's, a team's opening (the
        // table's `opens`): taken once, while that chat has no turn, so the page offers no way to send it again
        // (r-doors, 11-12: its Retry posted it as the person's message).
        ...(TURN_BY[/** @type {import("../../core/turn-by.js").TurnBy} */ (begunBy.get(t))].opens ? { opening: true } : {}),
        ...(chain.kind === "team" && Array.isArray(t.user?.content) && isRecordBlock(t.user.content[0]) ? { record: true } : {}),
        // A flow's team box: its first message carries the flow's hand-off, which the page folds too.
        ...(chain.kind === "team" && Array.isArray(t.user?.content) && t.user.content.some(isHandoffBlock) ? { handoff: true } : {}),
        // A hunt's first message carries its range (the plan's p6): Filament's, never the person's words, which the page
        // draws alone.
        ...(chain.kind === "team" && Array.isArray(t.user?.content) && t.user.content.some(isRangeBlock) ? { range: true } : {}),
        // The flow's own word to its team box — go on, or sent back from its gate (HarnessV4_Flow_Plan F5): the page draws it as the flow's.
        ...(chain.kind === "team" && begunBy.get(t) === "flow" ? { flowSaid: true } : {}),
        // It failed: why, in one line and in its fields, and what it had said (HarnessV3-FailurePoints §5.2).
        ...(!t.final && t.meta?.failed && !tryingAgain(t) ? { failed: t.meta.failed } : {}),
        summary: t.summary || null,
        shape: compactedShapeOf(t),
        ...(Array.isArray(t.meta?.capped) && t.meta.capped.length ? { capped: t.meta.capped.length } : {}),
        settingsHash: t.meta?.settingsHash || null,
        composed: composedSaid(t.meta?.composed),
        tree: t.meta?.tree || null,
        // Which client ran the turn and which window typed it (D1): the client is a label, the window the identity.
        // `clientLabel` (Facade D13) is the server's words for it — the page never maps an id.
        client: t.meta?.client || null,
        clientLabel: clientLabel(t.meta?.client || null),
        // The turn's facts (Facade D2): the numbers and notes the fold stored at the record's close; null until one
        // of the turn's records has closed.
        facts: factsNow(t),
        // A command answer's card (Facade D4): the structure the harness draws instead of the text.
        ...(t.meta?.card ? { card: t.meta.card } : {}),
        window: t.meta?.window ?? Archive.turnWindow(t, { key: chain.key }),
        // Who answered the turn (HarnessV3-AtHome AH-O7): the agent loop alone, or a team's lead and its name then —
        // the page draws a divider where it changes.
        ...(t.meta?.engine ? { engine: t.meta.engine } : {}),
        // A turn a coding agent began by itself (HarnessV3-ACP AC3-9): whose, and the background tasks it answers —
        // the page draws them where a person's message would be.
        ...(t.meta?.own ? { own: t.meta.own } : {}),
        // The turn's tool calls as cards (D8), read from its work in its own wire format — a turn without a run (an
        // outside client's) draws these; a turn with a run keeps its richer run events.
        ...(work === true ? { tools: t.work.length ? toolsOfTurn(t.work, t.meta?.format ?? wireFormatOf([t.user, ...t.work, t.final]) ?? "anthropic") : [] } : {}),
        // A rewound line (Step 3 D11): kept in the archive, out of every request, openable as a fork.
        ...(t.meta?.rewound
          ? {
              rewound: {
                line: t.meta.rewound.line,
                by: t.meta.rewound.by,
                // A rewind in place's side (rewind.js): its files went back too, or stayed.
                ...(t.meta.rewound.what ? { what: t.meta.rewound.what } : {}),
                ...(rewoundLines.get(t.meta.rewound.line) || {}),
                client: rewoundClient(String(t.meta.rewound.by)),
                clientLabel: clientLabel(rewoundClient(String(t.meta.rewound.by))),
              },
            }
          : {}),
        // A turn stopped from the harness (Step 3 D16, §5): the final text says it; the field makes it visible data.
        ...(t.meta?.stopped ? { stopped: t.meta.stopped } : {}),
        // The note the reply ended on (LD-D7): the final's closing words, for clients that draw no card — the page
        // leaves the copy out where it draws the card.
        ...(t.meta?.notice ? { notice: t.meta.notice } : {}),
        // A turn that answered the question the turn before it asked (the pause's kind): its work opens with the reply
        // that asked, whose words the page draws on the asking turn.
        ...(t.meta?.resumes ? { resumes: t.meta.resumes } : {}),
        // A turn whose question was left unanswered: the person went on with a coding agent (`by`, its name) instead.
        ...(t.meta?.unanswered ? { unanswered: { by: String(t.meta.unanswered.by || "") } } : {}),
        // A chat command Filament answered itself (`@mem`, `/compact`, `/help` …): the final is Filament's text, never a model's.
        // One a coding agent answered in a chat of its own, read from its files (`commandBy`: the agent's name), says so.
        ...(t.meta?.command ? { command: true, ...(t.meta.commandBy ? { commandBy: String(t.meta.commandBy) } : {}) } : {}),
      })),
      total: all.length,
      version,
      ...(past != null ? { written, ids: all.map((t) => t.id), runs: all.filter((t) => runs && t.request != null && runs.hasRun(t.request)).map((t) => t.id) } : {}),
      boundaries,
      subagentSent,
      subagentHeld,
      subagentOverruled,
      // The chats linked to it as threads, named (`threadsNamed`): the header's chip.
      ...(threads.from || threads.started.length ? { threads } : {}),
      // The visuals the session keeps itself (HarnessV4_Visuals_Plan VS-D48): a helper's that no turn launched, each by
      // who drew it and in which exchange; the page fetches one's code as it draws it (`sessionVisual`).
      ...(Array.isArray(chain.meta?.visuals) && chain.meta.visuals.length ? { visuals: chain.meta.visuals.map(({ hash: _hash, ...v }) => v) } : {}),
      // The windows list (Facade D10): the page names a client's chat from it.
      windows,
      // The rewind that stands, while Undo can take it back (rewind.js): its line in the transcript draws it.
      ...((() => {
        const r = standingRewind(chain, all);
        return r ? { rewind: { turn: r.turn, what: r.what, line: r.line || null, from: r.from, to: r.to ?? null, files: Array.isArray(r.spots) ? r.spots.length : 0 } } : {};
      })()),
      // A waiting question names itself and its choices (TL-D11): a page loaded after the turn paused draws them. A
      // permission names its tool and the words it asked in — the card says them, and the reply's copy is left out
      // (LD-D7) — the always-allow waiting for its shape (HarnessV3-Views V3), and a command whole with the reason it
      // asks (V6-9). With the work, the reply that asked comes too: its words show above the card while it waits (RD1
      // b). Only while it waits: not while the turn that answers it runs (HarnessV3-Views V6-12).
      paused: waitingNow(chain)
        ? {
            kind: chain.meta.paused.kind || null,
            requestId: chain.meta.paused.requestId || null,
            at: chain.meta.paused.at || null,
            expires: chain.meta.paused.expires || null,
            ...(chain.meta.paused.kind === "ask"
              ? askOf(chain.meta.paused.pending?.input)
              : { question: chain.meta.paused.question || null, tool: chain.meta.paused.pending?.name || null, ...(chain.meta.paused.offer ? { offer: chain.meta.paused.offer } : {}), ...(chain.meta.paused.keeps ? { keeps: chain.meta.paused.keeps } : {}), ...(chain.meta.paused.review ? { review: chain.meta.paused.review } : {}), ...(chain.meta.paused.look ? { look: chain.meta.paused.look } : {}), ...shownPause(chain.meta.paused) }),
            ...(work ? pausedReply(chain.meta.paused.dangling) : {}),
          }
        : null,
      live: liveOf(chain),
      // What the session's coding agent runs now beside its work — its sub-agents, its shells — as its last word said
      // (HarnessV3-FailurePoints §5.1 item 2); the events feed's `turns` topic says each change after, as the session's
      // topic does.
      agentTasks: agentTasks?.(chain.id) || [],
      // The commands its agents run in the background now (HarnessV4_Background_Plan E38-D4); the events feed's `turns`
      // topic says each start and end after.
      commands: commandsOf(chain.id),
      // The come-back its agent set, while it waits (agent/come-back.js; the Designer's of 10-27); the `turns` topic says
      // each change after.
      comeBack: comeBackOf(chain.id),
      // The watchers that watch it and those that wake it, for the line over its box (core/routines.js `chatWatchers`);
      // the `turns` topic says the list again at each change of a Space that moves it.
      watchers: chatWatchers?.(chain.id) || [],
      // The turns its watchers reviewed, by their numbers — apart from the turns, which a read of what was written
      // since leaves out where nothing of theirs changed; the `turns` topic says the map again where it moves.
      reviews: chatWatching?.reviews(chain.id) || {},
      // …and Filament's check-in on its agent idle while its command runs (idle-wake.js), while one is due.
      idleWake: idleWake?.next(chain.id) ?? null,
      // The compaction running for the session now, as the events feed says it (HarnessV4_Tasks U3-5): a page opened
      // while it runs draws it at once; the feed says each change after, and its end.
      compacting: compactionOf(chain.id),
      settings: { hash: resolved.hash, effective: resolved.effective, sources: resolved.sources, window: windowOf(chain, resolved.effective), engine: engineOf(chain, resolved.effective) },
      meta: { muted: !!chain.meta?.muted, pinned: !!chain.meta?.pinned, archived: !!chain.meta?.archived, unread: !!chain.meta?.unread, native: !!chain.meta?.native, agent: chain.meta?.agent || null, ...(chain.meta?.fork ? { fork: chain.meta.fork } : {}), ...(chain.meta?.replayOf ? { replayOf: chain.meta.replayOf } : {}) },
      project: project ? { id: project.id, name: project.name, cwd: project.cwd } : null,
    };
  }

  /**
   * Who runs a turn in the session now, exactly as its transcript says it (`live`), read without its turns: what a page
   * that follows a running chat asks again and again. `after`: a run of the session's, and the turn the conversation
   * carries after its turn — never a chat command Filament answered, nor a rewound one (`turnAfter`) — by its newest
   * request (`next`), null while none came: the turn an answer to its pause resumed, read where it ended before anyone
   * looked for it live (another machine's agents, remote-agents.js `resumedThere`). The run is looked for in the newest
   * NEXT_LOOKED turns, never the whole chat. A session that is not there is refused as the transcript refuses it.
   * @param {string} id @param {{ after?: string | null }} [o]
   */
  function liveState(id, { after = null } = {}) {
    const chain = headOf(id);
    if (!after) return { live: liveOf(chain) };
    const asked = archive().getTurns(chain.id, { last: NEXT_LOOKED }).find((t) => Array.isArray(t.requestIds) && t.requestIds.includes(String(after)));
    const next = asked ? archive().turnAfter(chain.id, asked.id) : null;
    return { live: liveOf(chain), next: Array.isArray(next?.requestIds) && next.requestIds.length ? String(next.requestIds.at(-1)) : null };
  }

  /**
   * A compaction's writer for this once (HarnessV4_Tasks C26: the card's choice): the session's settings with it laid
   * over; nothing is written. `writer` is who writes this compaction's summary — the same model (session) or the side
   * model (model) — and `model` names the side model for it (`context.compaction.model`, the writer set to model). A
   * model no route reaches, a writer that is neither, or a model named with the same model's writer is refused in words.
   * @param {any} eff @param {{ model?: string | null, writer?: string | null } | null | undefined} once
   */
  const onceDoc = (eff, once) => {
    const model = once?.model == null ? "" : String(once.model).trim();
    const writer = once?.writer == null ? null : String(once.writer);
    if (!model && writer == null) return eff;
    if (writer != null && !COMPACTION_WRITERS.includes(writer)) throw refusal(400, `once.writer must be one of ${COMPACTION_WRITERS.join(", ")}`);
    if (model && writer === "session") throw refusal(400, "once.model names the side model: it goes with writer model, or none");
    if (model && !findRoute(config.get(), parseAgentModel(model)?.model || model)) throw refusal(400, `once.model: no route reaches "${model}"`);
    const context = eff.context || {};
    return { ...eff, context: { ...context, compaction: { ...context.compaction, ...(model ? { model } : {}), writer: model ? "model" : writer } } };
  };

  /**
   * Compact now: make room by the session's compaction method — or `method`, for this one compaction — through the
   * compactor (summary or fold). The turns stay in the archive; the next request starts
   * from what it wrote. `within` is the response of the turn the caller runs inside — a typed `/compact`
   * compacts in its own turn (HarnessV3-Launch RD-D4), and that turn is no reason to refuse it; its stop reaches the
   * compaction. A coding agent's session makes room its session's way, or `way` for this once (HarnessV3-ACP AC5-4,
   * AC5-5): own — the agent compacts its session itself, told what to keep (`words`), its events to `onEvent` — self,
   * or ours; a way the agent does not have now is refused, saying so (`extra.lacks`), and one that fails says why,
   * never made another way.
   * `onceTurnEnds` is Stop and compact's second half (HarnessV3-RunawayTurns CW-D6; HarnessV4_Tasks U2): a turn
   * running in the session is waited for, with no clock, in place of the refusal, and the session is compacted once it
   * has ended; the asker hanging up (`signal`) ends the wait, and nothing is compacted for it. A turn that began in
   * the meantime is refused as ever.
   * Outside a turn the compaction has a stop of its own (`stopCompaction`, HarnessV4_Tasks U3-5): stopped, nothing is
   * written, and the refusal says so (`extra.stopped`).
   * `once` is the writer chosen for this compaction alone (`onceDoc`): a summary's that Filament writes, so it goes
   * with a method named, never with an agent's own way.
   * `by: "last"` runs the compaction as the model that answered the chat's last turn — its newest but a coding agent's
   * own, as a switch reads it —, where the person has picked
   * another since (the owner's of 11-08: a switch's handoff, written by the outgoing model while its cache is warm): the
   * loop's model writes Filament's summary, forking its warm cache with the writer session; a coding agent compacts its
   * own session (way own) or writes the summary in it (way self). A chat whose last turn names no model is refused.
   * `sending`: the person's message goes once the room is made (the page's Compact and send): no wake or goal round runs
   * before it (`roomFor`, the owner's of 11-09).
   * @param {string} id
   * @param {{ method?: string | null, within?: any, way?: string | null, words?: string, onEvent?: ((ev: any) => void) | null, onceTurnEnds?: boolean, signal?: AbortSignal | null,
   *   once?: { model?: string | null, writer?: string | null } | null, by?: "last" | null, sending?: boolean }} [o]
   */
  async function compact(id, { method = null, within = null, way = null, words = "", onEvent = null, onceTurnEnds = false, signal = null, once = null, by = null, sending = false } = {}) {
    const chain = chainOf(id);
    if (!chain.meta?.native) throw clientSessionRefusal(chain, "its client owns the history and compacts it", { fork: false });
    if (once && (once.model != null || once.writer != null) && method !== "summary") throw refusal(400, "once (a writer) is a summary's that Filament writes: name the method summary with it");
    if (method != null && !COMPACTION_METHODS.includes(/** @type {any} */ (method))) throw refusal(400, `method must be one of ${COMPACTION_METHODS.join(", ")}`);
    if (way != null && !AGENT_WAYS.includes(/** @type {any} */ (way))) throw refusal(400, `way must be one of ${AGENT_WAYS.join(", ")}`);
    if (way != null && way !== "ours" && method != null) throw refusal(400, "a method is Filament's, on its copy: name way ours with it, or no way");
    if (onceTurnEnds) await turnOver(chain, signal);
    if (heldByOther(chain, within)) throw refusal(409, "a turn is running in this session; compact when it ends");
    // A turn that paused on a question holds the session as a running one does; Stop and compact's wait, which ends
    // with the turn's lock, finds the question here.
    if (askingNow(chain.id)) throw refusal(409, "a question waits for your answer: answer it first, then compact");
    const cfg = config.get();
    const settings = settingsOf(chain.id);
    const all = archive().turnBodies(chain.id);
    const completed = modelTurnsOf(all, bootAt);
    const lastName = by === "last" ? String((completed.findLast((t) => !t.meta?.own) || completed.at(-1))?.model || "").trim() : "";
    if (by === "last" && !lastName) throw refusal(409, "no turn of this chat names the model that answered it: compact with the session's own");
    // The model that answered last, called no more — no route reaches it, or every upstream its route tries is switched
    // off —: refused before anything is weighed, in words, where its call would fail after (the hunt of 11-08).
    const lastInner = lastName ? parseAgentModel(lastName)?.model || lastName : "";
    const lastOff = !lastInner ? null
      : findRoute(cfg, parseModelSuffix(lastInner, cfg.rules).base) || findRoute(cfg, lastInner) ? upstreamsOffProblem(cfg, lastInner)
        : "no route reaches it now. Pick another on the Routes page.";
    if (lastOff) throw refusal(409, `${lastInner}, the model that answered last, cannot write the summary now: ${lastOff}`);
    const asLast = lastName ? { ...settings.effective, model: { ...settings.effective.model, name: lastName } } : settings.effective;
    const eff = onceDoc(asLast, once);
    const modelName = String(eff.model?.name || chain.model || "").trim();
    const inner = parseAgentModel(modelName)?.model || modelName;
    const compactions = compactionsOf(chain.id);
    const head = compactionHead(compactions);
    // Under the head already: Filament's summary, or the one the agent handed over as it compacted its own context —
    // said apart (`extra.covered`), where a card's Compact and send, or a switch's handoff, has what it asked for
    // already: its room made by a press whose send was refused (the hunt of 11-09).
    if (!completed.some((t) => t.n > (head ? Number(head.to_turn) : 0)))
      throw refusal(409, !head ? "nothing to compact: the session has no completed turns"
        : ownWriter(head) ? `nothing to compact: the agent compacted its own context after turn ${head.to_turn}, and no turn has finished since`
          : `nothing to compact: every completed turn is already under the summary of turns ${head.from_turn}–${head.to_turn}`, head ? { covered: true } : {});
    const window = (inner && sessionWindowFor(cfg, inner, eff.model?.window).tokens) || null;
    const agentUp = agentSessionOf(cfg, inner);
    // A session the agent lost to a move or a rewind holds nothing the chat goes on in: its next turn starts a fresh one,
    // the turns whole, and the composition is weighed so (the hunt of carry-move) — as at a turn's start (`none`).
    const lostTo = lostBy(chain.meta, agentUp, all, completed);
    const w = measuredCompose(chain, eff, { seed: seedOf(eff, settings, agentUp, lostTo ? lostFormOf(settings, eff) : null), newUser: { role: "user", content: [{ type: "text", text: "" }] }, model: modelName || "preview", calib: inner, window, fixed: await fixedOf(chain, eff) });
    // A coding agent's session is weighed by what the agent holds (HarnessV3-ACP AC5-3), and makes room its session's
    // way (AC5-4, AC5-5): the agent compacts its session itself, or writes the summary itself, where that is the way —
    // Filament on its copy if the agent can't, unless the way was named for this once. A method named for this once is
    // Filament's, on its copy.
    if (way != null && !agentUp) throw refusal(400, "way is for a coding agent's session");
    const at = agentUp && !lostTo ? agentHeld({ turns: completed, compactions, upstream: agentUp, window }) : null;
    const ref = agentUp ? { upstream: agentUp, chainId: chain.id, cwd: cwdOf(chain), base: basesOf(compactions, completed).of(agentUp) } : null;
    const room = ref && method == null && (at || way) ? agentRoom(eff, at, ref, inner, /** @type {any} */ (way)) : null;
    // Ours is always there: Filament's copy, by the method named or the session's (the bug report's L29).
    if (way != null && way !== "ours" && room?.way.way !== way)
      throw refusal(409, way === "own" ? "the agent cannot compact this session its own way now: it has no compaction of its own that Filament can ask for, or holds no open session of this chat" : "the agent cannot write Filament's summary of this session now: it holds no open session of this chat, or writes none", { lacks: way });
    // Compact and send: the person's message goes once the room is made, ahead of a wake (`roomFor`).
    const release = claimCompaction(chain, { sending });
    const stopper = compactionStop(chain, within);
    const stop = stopper.signal;
    try {
      /** Why the agent could not make room its way, when that was the way: Filament made room on its copy instead. */
      let agentFailed = null;
      /** @type {Awaited<ReturnType<typeof compactor.run>> | Awaited<ReturnType<typeof compactor.own>> | null} */
      let r = null;
      if (room?.way.way === "own" && ref) {
        // A turn sent meanwhile waits for it (`owning`): it goes to the session the agent compacts.
        /** @type {() => void} */
        let ended = () => {};
        owning.set(chain.id, new Promise((done) => (ended = done)));
        try {
          // A typed `/compact` draws the agent's events in its own turn (`onEvent`): no second word of them here.
          r = await ownCompaction({ chain, turns: adaptForCompose(completed, eff, chain, compactions), compactions, model: inner, ref, door: onEvent ? null : "manual", stoppable: stopper.own, trigger: "manual", words, fork: room.owns === "fork", signal: stop, onEvent });
        } finally {
          owning.delete(chain.id);
          ended();
        }
        if (!r.ok && way !== "own" && r.status !== 409 && !stop.aborted) {
          agentFailed = r.error;
          r = null;
        }
      }
      if (!r) {
        const progress = compactionJob(chain.id, "manual", { stoppable: stopper.own });
        try {
          /** @type {Parameters<typeof compactor.run>[0]} */
          const ours = {
            chain, doc: eff, turns: adaptForCompose(completed, eff, chain, compactions), compactions, sessionModel: inner, window: at?.window ?? window, measure: w.measure, trigger: "manual", method, signal: stop,
            guard: () =>
              heldByOther(chain, within) ? "a turn started while the compaction ran; nothing was written — compact when it ends"
                : askingNow(chain.id) ? "a question was asked while the compaction ran; nothing was written — answer it first, then compact"
                  : null,
            root: loopRootOf(chain), job: progress.job, onStep: progress.onStep,
            ...(at ? { held: at.held } : {}),
            // A coding agent's session with no model to write a summary folds, which calls none, as at its line — unless
            // a method was named for this once (the bug report's L30).
            ...(agentUp && method == null ? { orFold: true } : {}),
          };
          r = await compactor.run({ ...ours, self: agentFailed ? null : room?.writer || null });
          // A way named for this once is that way or none (the bug report's L29): a Self that failed says why.
          if (room?.writer && way !== "self" && !agentFailed && !r.ok && r.status !== 409) {
            agentFailed = r.error;
            r = await compactor.run(ours);
          }
          progress.landed(r);
        } finally {
          progress.end();
        }
      }
      if (!r.ok) throw refusal(r.status, agentFailed ? `${agentFailed}; on Filament's copy: ${r.error}` : r.error, stopper.stopped() ? { stopped: true } : {});
      const made = r;
      const row = compactionsOf(chain.id).find((c) => Number(c.id) === Number(made.id));
      const detail = row?.detail || null;
      const done = { id: made.id, fromTurn: made.fromTurn, toTurn: made.toTurn, kind: made.kind, method: made.method, chars: made.chars, detail };
      // The boundary the page draws at once: the row's own id and detail, its summary as the transcript's row carries
      // it (so it opens without a re-read), and — nothing has been sent since — Undo.
      // The agent compacted its own session and handed no summary over: the copy's is written after it (C29).
      const copyWriter = made.method === "own" && !made.chars ? await followCopy(chain, { claimed: true }) : null;
      const said = copyWriter?.model ? `${made.note}; ${copyWriter.model} now writes one for the copy, in the background` : copyWriter?.small ? `${made.note}; no summary is written for the copy yet: ${copyWriter.small}` : made.note;
      const note = agentFailed ? `${said} — ${agentFailed}, so Filament made room on its copy instead` : said;
      return { ok: true, compaction: done, note, learning: made.learning, boundary: { type: "compaction", id: made.id, afterTurn: made.toTurn, fromTurn: made.fromTurn, toTurn: made.toTurn, kind: made.kind, method: made.method, chars: made.chars, detail, undoable: true, ...boundaryText(row?.text) } };
    } finally {
      stopper.done();
      release();
    }
  }

  /**
   * Stop the compaction being written for a session outside a turn — Compact's, /autofit's (HarnessV4_Tasks U3-5,
   * UX-8): its model call is cancelled, or the agent's own compaction, nothing is written, and the door that asked
   * for it answers that it was stopped. One a turn writes is that turn's: it stops with the turn, and is refused here
   * in those words.
   * @param {string} id
   */
  function stopCompaction(id) {
    const chain = chainOf(id);
    const mine = compactionStops.get(chain.id);
    if (!mine) throw refusal(409, compactionOf(chain.id) || compacting.has(chain.id) ? "this compaction is part of a running turn: stop the turn to stop it" : "no compaction is being written for this session");
    // The summary of the copy alone, stopped by the person: the copy stays as it is until the agent next compacts.
    const copy = copying.get(chain.id);
    const ofCopy = copy?.stop === mine;
    if (ofCopy) archive().mergeMeta(chain.id, { copyHeld: copy.through });
    mine.abort();
    return { ok: true, ...(ofCopy ? { copy: true } : {}) };
  }

  /**
   * What comes back after a coding agent's own summary, handed over as it compacted in the middle of a turn
   * (agent-copy.js `followOwnCompaction`; the owner's of 11-08: none came back, and the model the chat moved to lost the
   * files, the plan, the task graph and what was still open), and after one it made on request or at its line
   * (compactor.js `own`): the block a summary of Filament's brings back, of the turns up to `toTurn`, read as the copy
   * holds them — kept with the row, for what starts from the copy. One made in the middle of turn `cut.during` stands
   * for that turn's work up to the call `cut.cutAfter` too, and the copy keeps the rest (compaction.js
   * `afterOwnCompaction`): what came before it is summarized, and what after it kept (the review of cb2d2d1f0: the
   * files and the plan the turn read before Claude compacted were neither shown nor brought back). Null where it
   * cannot be read: the row is written without it.
   * @param {string} id @param {number} toTurn @param {{ during: number, cutAfter: string | null, by?: string } | null} [cut]
   */
  function blockAfterOwn(id, toTurn, cut = null) {
    try {
      const chain = chainOf(id);
      const eff = effectiveOf(chain.id);
      const modelName = String(eff.model?.name || chain.model || "").trim();
      const inner = parseAgentModel(modelName)?.model || modelName;
      const compactions = compactionsOf(chain.id);
      const raw = modelTurns(chain.id);
      const fell = cut ? raw.find((t) => t.n === cut.during) : null;
      const rest = fell ? afterOwnCompaction(fell, { detail: cut }) : null;
      // Its rest as a turn kept after it, the turn summarized to its end: a kept turn's files and plan are its own to show.
      const split = !!rest && rest !== fell;
      const turns = adaptForCompose(split ? [...raw, { ...rest, n: Number(cut?.during) + 1 }] : raw, eff, chain, compactions);
      const window = (inner && sessionWindowFor(config.get(), inner, eff.model?.window).tokens) || ASSUMED_WINDOW;
      return backAfterSummary({ doc: eff, turns, toTurn: split ? Number(cut?.during) : toTurn, head: compactionHead(compactions), root: loopRootOf(chain), window, graph: chain.meta?.graph, teams: leadingTeams(config.get(), chain.kind === "team", teams), kept: graphKept?.(chain.id) ?? null, where: graphWhere ? (crew) => graphWhere(chain.id, crew) : null, open: stillOpen?.lines(chain.id) ?? null, owed: Object.keys(chain.meta?.letters?.asks || {}) });
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${id}: the block after the agent's own summary was not read (${e?.message || e})`);
      return null;
    }
  }

  /**
   * The skills a coding agent loaded with Filament's skill tool in the turns Filament's copy holds since its head, by
   * name and the turn of each, the newest first (reattach.js `afterSummaryCandidates`): what its own compaction may take
   * with it (c-skills). The running turn is not among them: its own are the turn's to add. [] where they cannot be read.
   * @param {string} id @returns {{ name: string, turn: number }[]}
   */
  function skillsLoaded(id) {
    try {
      const chain = chainOf(id);
      const compactions = compactionsOf(chain.id);
      return afterSummaryCandidates(copyTurns(modelTurns(chain.id), compactions), Infinity, compactionHead(compactions)).skills;
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${id}: the skills its turns loaded were not read (${e?.message || e})`);
      return [];
    }
  }

  /** The summaries being written for sessions' copies alone (`followCopy`): each one's stop, the last turn it takes, and what asked for it. @type {Map<string, { stop: AbortController, through: number, why: "agent" | "line" }>} */
  const copying = new Map();
  /**
   * Filament's copy of a coding agent's chat moves on (HarnessV4_Tasks C29): asked after each turn of such a session,
   * and after the agent's own compaction on request. Where the agent compacted its own context at a point the copy has
   * not followed (`copyBehind`), or the copy was past the session's line as the turn composed it (`overLine`), and the
   * session keeps its copy in step (`context.compaction.follow`), a summary is written for the copy alone (compactor.js
   * `copy`) — in the background: nothing waits on it, the agent's session goes on as it is, and the next message is
   * sent whether it has landed or not. It is said while it runs as any compaction is, with its stop
   * (`stopCompaction`); stopped, the copy stays as it is until the agent next compacts (`chain.meta.copyHeld`), and
   * the line asks again once the copy starts past that point. A compaction asked for meanwhile takes its place
   * (`claimCompaction`; `claimed`: asked by the one that holds the claim). With nothing to summarize or no model to
   * write with, nothing is started; nor where the turns weigh no more than a summary would — a summary then costs a
   * call and leaves the copy no smaller (`small`, in words). → the model that writes it, `small`, or null where
   * nothing is written now.
   * @param {any} chain @param {{ overLine?: boolean, claimed?: boolean }} [o]
   * @returns {Promise<{ model: string, small?: undefined } | { small: string, model?: undefined } | null>}
   */
  async function followCopy(chain, { overLine = false, claimed = false } = {}) {
    /** One job a session; a compaction asked for comes first, unless it is the one asking. */
    const taken = () => copying.has(chain.id) || (!claimed && compacting.has(chain.id));
    if (taken()) return null;
    const settings = settingsOf(chain.id);
    const eff = settings.effective;
    if (!compactionSettingsOf(eff).follow) return null;
    const cfg = config.get();
    const modelName = String(eff.model?.name || chain.model || "").trim();
    const inner = parseAgentModel(modelName)?.model || modelName;
    const agentUp = agentSessionOf(cfg, inner);
    if (!agentUp) return null;
    const compactions = compactionsOf(chain.id);
    const finished = modelTurns(chain.id);
    const head = compactionHead(compactions);
    const from = head ? Number(head.to_turn) || 0 : 0;
    const held = Number(archive().getChain(chain.id)?.meta?.copyHeld) || 0;
    const behind = copyBehind({ turns: finished, compactions, held });
    const why = behind ? "agent" : overLine && held <= from ? "line" : null;
    const newest = finished.at(-1);
    if (!why || !newest) return null;
    // All but the newest finished turn the copy holds: with none to stand for, no model is asked. Nor where those
    // turns weigh no more than a summary would (`small`): the copy keeps them, and is asked again after each turn.
    const turns = adaptForCompose(finished, eff, chain, compactions);
    // Weighed as the copy holds them: the composition a fresh session of the agent would start from.
    const { measure } = measuredCompose(chain, eff, {
      seed: seedOf(eff, settings, agentUp),
      newUser: { role: "user", content: [{ type: "text", text: "" }] }, model: modelName || "preview", calib: inner, window: sessionWindowFor(cfg, inner, eff.model?.window).tokens || null,
    });
    const reads = await compactor.copyRead({ turns, compactions, measure });
    if (!reads || taken()) return null;
    if (!reads.worth) return { small: smallWords(reads) };
    const writer = compactor.writerFor({ doc: eff, sessionModel: inner, cache: null, transcriptTokens: reads.read, outTokens: reads.out }).chosen;
    if (!writer) return null;
    const by = behind?.by || agentTitle(findUpstream(cfg, agentUp) || { id: agentUp });
    const stop = new AbortController();
    copying.set(chain.id, { stop, through: newest.n - 1, why });
    compactionStops.set(chain.id, stop);
    const progress = compactionJob(chain.id, "copy", { stoppable: true });
    /** The copy's summary says whose it is at every step. @type {import("./compactor.js").StepSink} */
    const onStep = (s) => progress.onStep({ ...s, message: `Filament's copy: ${s.message}` });
    onStep({ message: `${writer.model} summarizes the turns before the newest — ${why === "agent" ? `${by} compacted its own context and handed no summary over` : "the copy passed the session's line"}` });
    void (async () => {
      try {
        const made = await compactor.copy({
          chain, doc: eff, reads, sessionModel: inner, why, by,
          fresh: () => compactionsOf(chain.id), signal: stop.signal, job: progress.job, onStep,
        });
        progress.landed(made);
        if (made.ok) {
          const row = compactionsOf(chain.id).find((c) => Number(c.id) === Number(made.id));
          publish?.(chain.id, {
            type: "compaction-landed",
            boundary: { type: "compaction", id: made.id, afterTurn: made.toTurn, fromTurn: made.fromTurn, toTurn: made.toTurn, kind: made.kind, method: made.method, chars: made.chars, at: now(), detail: row?.detail || null, undoable: false, ...boundaryText(row?.text) },
          });
        } else if (made.status !== 409) {
          // A summary that failed is said where the page shows the chat, and kept on the operation log.
          ops.record("compaction", `session ${chain.id}: the summary for Filament's copy was not written`, { sub: "copy", detail: { chainId: chain.id, error: made.error, trigger: why }, ref: { chainId: chain.id } });
          publish?.(chain.id, { type: "compaction-landed", error: `Filament's copy keeps its turns: ${made.error}` });
        }
      } catch (/** @type {any} */ e) {
        log("warn", `sessions: ${chain.id} the summary for Filament's copy failed: ${e.message}`);
      } finally {
        progress.end();
        copying.delete(chain.id);
        if (compactionStops.get(chain.id) === stop) compactionStops.delete(chain.id);
      }
    })();
    return { model: writer.model };
  }

  /**
   * Undo compaction (HarnessV3-Compaction §3.3): the newest compaction Filament's harness wrote in this session, while
   * no turn has started since — its row goes, a fold compaction's marks with it, and the next request is
   * composed as if it never ran (one cache rewrite; the archive never lost a turn). Refused while a turn runs, a
   * question a turn paused on waits for the person's answer or a compaction is being written, and for any other row,
   * in words. The answer names the compaction that can be undone
   * now (`undoable`, its id or null), so the page offers its Undo at once (HarnessV3-FixRound decision 24).
   * @param {string} id @param {number | string} compactionId
   */
  async function undoCompaction(id, compactionId) {
    const chain = chainOf(id);
    const cid = Number(compactionId);
    if (!Number.isInteger(cid) || cid < 1) throw refusal(400, "a compaction id is required");
    if (heldByOther(chain)) throw refusal(409, "a turn is running in this session; undo when it ends");
    if (compacting.has(chain.id)) throw refusal(409, "a compaction is being written for this session; wait for it");
    // A turn that paused on a question holds the session as a running one does: its answer goes on from the history
    // as it stands.
    if (askingNow(chain.id)) throw refusal(409, "a question waits for your answer: answer it first, then undo");
    const target = undoableCompaction(chain.id);
    if (!target || Number(target.id) !== cid)
      throw refusal(409, "only the newest compaction Filament made here can be undone, and only until the next message is sent");
    const row = archive().undoCompaction(chain.id, cid);
    if (!row) throw refusal(404, "no such compaction in this session");
    // The agent's own compaction is taken back: a summary still being written for the copy because of it has nothing
    // to follow.
    if (row.method === "own" && copying.get(chain.id)?.why === "agent") copying.get(chain.id)?.stop.abort();
    // Its session from before stands: the next message says no compaction (the owner's of 11-08 made one always said).
    if (row.method === "own") stillOpen?.undone(chain.id);
    const span = `turns ${row.from_turn}–${row.to_turn}`;
    ops.record("compaction", `session ${chain.id}: the compaction of ${span} undone`, {
      sub: "undo",
      detail: { chainId: chain.id, id: cid, fromTurn: row.from_turn, toTurn: row.to_turn, kind: row.kind, method: row.method, unmarked: row.unmarked },
      ref: { chainId: chain.id },
    });
    const next = undoableCompaction(chain.id);
    // Every page that holds the chat takes the row back from the feed (`compaction-undone`), as the one that undid it
    // does from this answer.
    publish?.(chain.id, { type: "compaction-undone", id: cid, undoable: next ? Number(next.id) : null });
    return { ok: true, undone: { id: cid, fromTurn: Number(row.from_turn) || 1, toTurn: Number(row.to_turn) || 0, kind: row.kind, method: row.method, unmarked: row.unmarked }, undoable: next ? Number(next.id) : null, note: `compaction of ${span} undone: the next request sees those turns as it did before` };
  }

  /**
   * The person's message a rewind goes back to before (rewind.js): a turn of theirs that stands — not Filament's own
   * answer, nor one on a rewound line already, which opens as a fork instead.
   * @param {any} chain @param {number | string} turn
   */
  const rewindTarget = (chain, turn) => {
    const n = Number(turn);
    if (!Number.isInteger(n) || n < 1) throw refusal(400, "turn is required: the number of your message's turn, from 1");
    const turns = archive().getTurns(chain.id);
    const t = turns.find((/** @type {any} */ x) => x.n === n);
    if (!t || t.meta?.command) throw refusal(404, `this chat has no message of yours at turn ${n}`);
    if (t.meta?.rewound) throw refusal(409, `turn ${n} is on a rewound line already: open it as a fork instead`);
    const live = turns.filter((/** @type {any} */ x) => x.n >= n && !x.meta?.rewound);
    return { n, turns, live };
  };
  /** What a rewind from turn `n` on does to the files, read now. @param {any} chain @param {number} n */
  const rewindFiles = async (chain, n) => {
    const rounds = roundsFrom(memory.roundsOf(chain.id).rounds, n);
    const alone = memory.placesAlone ? memory.placesAlone(chain.id, rounds.map((/** @type {any} */ r) => r.place)) : null;
    return planFiles(rounds, { alone });
  };
  /** The rewind a session's next message has still to carry (`meta.rewind`, `rewindTo`), or null. @param {any} chain */
  const rewindOf = (chain) => {
    const r = chain.meta?.rewind;
    return r && typeof r === "object" ? r : null;
  };
  /**
   * The rewind that stands in a session (`meta.rewind`), while Undo can take it back: until a turn Filament did not
   * answer starts once it began — the person's, a coding agent's own (`ownTurn`), one an import's Sync brought in. Its
   * `at` is when `rewindTo` began, before its first wait, so a turn that started while its files were put back, or in
   * that millisecond, is after it. Each turn's start is its row's (`started_at`, the archive's clock, as `at` is the
   * service's: both milliseconds), read from the chat's outline — `turns`, where the caller holds it, else read here —
   * so no turn's body is read.
   * @param {any} chain @param {readonly { startedAt: any, command: boolean }[]} [turns]  the chat's turns in outline (`turnOutline`)
   */
  const standingRewind = (chain, turns) => {
    const r = rewindOf(chain);
    if (!r) return null;
    const since = (turns || archive().turnOutline(chain.id)).some((t) => !t.command && (Number(t.startedAt) || 0) >= (Number(r.at) || 0));
    return since ? null : r;
  };
  /** A file plan as the page reads it. @param {import("./rewind.js").FilesPlan} plan */
  const plannedFiles = (plan) => ({
    files: plan.files.map(({ place, path, oldPath, kind, also }) => ({ place, path, ...(oldPath ? { oldPath } : {}), kind, ...(also ? { also: true } : {}) })),
    left: plan.left,
    outside: plan.outside,
    cannot: plan.cannot,
    errors: plan.errors,
  });

  /**
   * What a rewind to before the person's message of `turn` would do (the Designer's confirm): the turns that leave the
   * conversation, and each file that goes back, with how — read now, nothing moved. While a question a turn paused on
   * waits, `asking` says so, with the turn that asked, which the conversation's rewind takes away with its question
   * (none where it does not reach it): the files alone are refused then (`rewindTo`).
   * @param {string} id @param {number | string} turn
   */
  async function rewindPreview(id, turn) {
    const chain = chainOf(id);
    const { n, live } = rewindTarget(chain, turn);
    const plan = await rewindFiles(chain, n);
    const busy = heldByOther(chain) ? "a turn is running in this session; rewind when it ends" : compacting.has(chain.id) ? "a compaction is being written for this session; wait for it" : null;
    const waits = askingNow(chain.id);
    const asked = waits ? live.find((/** @type {any} */ t) => (t.requestIds || []).map(String).includes(String(waits.requestId))) : null;
    // The chat's folder as git spells its place, so the page tells its own files from another place's.
    const cwd = cwdOf(chain);
    const folder = cwd ? (await placeOf(cwd)).place : null;
    return { turn: n, conversation: { from: n, to: live.at(-1)?.n ?? n, turns: live.length }, ...plannedFiles(plan), folder, ...(waits ? { asking: { turn: asked ? Number(asked.n) : null } } : {}), ...(busy ? { busy } : {}) };
  }

  /**
   * Rewind in place (rewind.js): to before the person's message of `turn`, taking back `what` — the files and the
   * conversation, the conversation alone, or the files alone. The files are snapshotted first; the turns are kept,
   * marked as a rewound line. Undo takes it back until the next message (`undoRewind`). A rewind that took one side
   * back tells the agent of it with the next message (`rewindNote`); a coding agent's session that held the turns
   * starts fresh from Filament's copy then. Refused while a turn runs or a compaction is being written; while a
   * question a turn paused on waits, the turn that asked goes with the conversation, its question with it, and a rewind
   * of the files alone is refused.
   * @param {string} id @param {{ turn: number | string, what?: string }} o
   */
  async function rewindTo(id, { turn, what = "both" }) {
    const chain = chainOf(id);
    if (!chain.meta?.native) throw clientSessionRefusal(chain, "the harness rewinds a fork of it");
    if (!REWIND_WAYS.includes(/** @type {any} */ (what))) throw refusal(400, `what is one of ${REWIND_WAYS.join(", ")}`);
    if (heldByOther(chain)) throw refusal(409, "a turn is running in this session; rewind when it ends");
    if (compacting.has(chain.id)) throw refusal(409, "a compaction is being written for this session; wait for it");
    const { n, live } = rewindTarget(chain, turn);
    if (what !== "files" && !live.length) throw refusal(409, `nothing to rewind: turn ${n} has no turn of the conversation from it on`);
    // A question a turn paused on waits: a rewind of the conversation takes the turns from the newest back, the turn
    // that asked among them, and its question goes with it (`paused`, kept for Undo). One that would keep that turn
    // while it rewrote under it — the files alone, put back under the turn that goes on from them with the answer — is
    // refused, as a compaction is.
    const asking = askingNow(chain.id);
    const takesAsking = !!asking && what !== "files" && live.some((/** @type {any} */ t) => (t.requestIds || []).map(String).includes(String(asking.requestId)));
    if (asking && !takesAsking) throw refusal(409, "a question waits for your answer: answer it first, then rewind");
    // The rewind's time is when it begins, before its first wait: a turn that starts from then on — while its files are
    // worked out or put back, a coding agent's own (`ownTurn`, which nothing here holds off), or in the same millisecond
    // — is after it, and ends its Undo (`standingRewind`).
    const at = now();
    const plan = await rewindFiles(chain, n);
    /** @type {{ places: { place: string, pre: string }[], spots: import("./rewind.js").Spot[] }} */
    let moved = { places: [], spots: [] };
    if (what !== "conversation" && plan.files.length) {
      const r = await putBack(plan, { name: `${chain.id}/rewind-${n}-${now().toString(36)}` });
      if (!r.ok) throw refusal(409, r.error);
      moved = r;
    }
    if (what === "files" && !moved.spots.length)
      throw refusal(409, `nothing to put back: ${plan.cannot.length || plan.outside.length ? `the files this chat changed from turn ${n} on cannot be put back` : `the files are as they were before turn ${n}`}`);
    const line = what === "files" ? null : memory.markRewound(chain.id, { from: n, by: "harness", what });
    const kept = what === "conversation" ? plan.files.map((f) => f.path) : [];
    const note = rewindNote({ what, turn: n, to: line?.to ?? null, spots: moved.spots, kept });
    // A rewind whose note no message has carried yet — its Undo ended by a turn of the agent's own, or standing still —
    // hands its note on: the next message says both, oldest first.
    const owed = [rewindOf(chainOf(chain.id))?.note, note].filter(Boolean).join("\n");
    const record = { at, turn: n, what, line: line?.line || null, from: n, to: line?.to ?? null, places: moved.places, spots: moved.spots, ...(owed ? { note: owed } : {}), ...(takesAsking ? { paused: asking } : {}) };
    archive().mergeMeta(chain.id, { rewind: record, ...(takesAsking ? { paused: undefined } : {}) });
    // The turn that asked went with its question: it is over, and what waited on its question goes.
    if (takesAsking) questionOver(chain.id, "rewound");
    const span = line ? (line.to !== n ? `turns ${n}–${line.to}` : `turn ${n}`) : null;
    const files = moved.spots.length ? `${moved.spots.length} file(s)` : null;
    ops.record("archive", `session ${chain.id}: rewound to before turn ${n}${span ? ` (${span} out of the conversation)` : ""}${files ? `, ${files} put back` : ""}`, {
      sub: "rewind",
      detail: { chainId: chain.id, turn: n, what, line: record.line, to: record.to, files: moved.spots.length, places: moved.places.map((p) => p.place) },
      ref: { chainId: chain.id },
    });
    publish?.(chain.id, { type: "rewind", turn: n, what, line: record.line });
    return { ok: true, turn: n, what, line: record.line, from: n, to: record.to, files: moved.spots.length, undoable: true, note: `rewound to before turn ${n}${span ? `: ${span} out of the conversation` : ""}${files ? `${span ? "," : ":"} ${files} put back` : ""}` };
  }

  /**
   * Undo the rewind that stands (`rewindTo`), until the next message: its files as the snapshot taken before it holds
   * them, and its turns back in the conversation — a question one of them asked waiting again. Refused while a turn
   * runs, and once a message was sent since.
   * @param {string} id
   */
  async function undoRewind(id) {
    const chain = chainOf(id);
    if (heldByOther(chain)) throw refusal(409, "a turn is running in this session; undo when it ends");
    const r = standingRewind(chain);
    if (!r) throw refusal(409, "no rewind to undo here: Undo lasts until the next message, and the rewound turns open as a fork after it");
    if (Array.isArray(r.spots) && r.spots.length) {
      const back = await putForward(r.spots, Array.isArray(r.places) ? r.places : []);
      if (!back.ok) throw refusal(409, `the rewind stands: ${back.error}`);
    }
    if (r.line) for (const t of archive().getTurns(chain.id)) if (t.meta?.rewound?.line === r.line) archive().mergeTurnMeta(t.id, { rewound: undefined });
    // The question the rewind took away with its turn waits again with it.
    archive().mergeMeta(chain.id, { rewind: undefined, ...(r.paused ? { paused: r.paused } : {}) });
    ops.record("archive", `session ${chain.id}: the rewind to before turn ${r.turn} undone`, { sub: "rewind-undo", detail: { chainId: chain.id, turn: r.turn, what: r.what, line: r.line, files: (r.spots || []).length }, ref: { chainId: chain.id } });
    publish?.(chain.id, { type: "rewind-undone", turn: r.turn, line: r.line });
    return { ok: true, turn: r.turn, what: r.what, files: (r.spots || []).length, note: `the rewind to before turn ${r.turn} undone` };
  }

  /**
   * Each running compaction, said while it runs (HarnessV3-FailurePoints §5.1 item 3) on the events feed every page
   * holds (HarnessV4_Tasks U3-5: `publish`), from every door — a turn at its line, Compact, /autofit: its step (who
   * writes the summary, the slice pass's "summarizing slice 2"), and its model calls as the request log sees them
   * stream — their thinking and text so far, and when the newest came. A compaction is a job: its calls carry its id
   * (`x-filament-job`), so the log's live records of it are told from the session's other calls. A coding agent
   * compacting its own session is one too (`own`): the summary it streams is its text so far (`written`). `stoppable`
   * where `stopCompaction` stops it. Its end says `progress: null`. `row` is the compaction it wrote, once it has
   * one (`landed`), and each finished call keeps what its record says it cost (`paid`, `list`: U3-11).
   * @typedef {{ chainId: string, job: string, door: string, since: number, step: string | null, percent: number | null,
   *   calls: Map<string, { thinking: number, text: number, done: boolean, paid?: number | null, list?: number | null }>, lastAt: number | null, own: boolean,
   *   stoppable: boolean, written: number, row: number | null, planned: number | null }} CompactionJob
   *   `planned`: the calls a slice pass said it expects to make, before it began
   * @type {Map<string, CompactionJob>}
   */
  const compactionJobs = new Map();
  /**
   * Compactions over, their row written, with a call whose record has not finished (HarnessV4_Tasks U3-11, V4-D89):
   * a reply reaches its caller a beat before the request log closes its record, and the record is what says the
   * call's cost. Kept until the last one finishes — no clock: a record ends when its call does. @type {Map<string, CompactionJob>}
   */
  const settling = new Map();
  /**
   * What a compaction cost: its calls' records summed — what was paid (a plan pays $0) and the same tokens at list
   * price, each null where no call's record says it — over `calls` calls, a failed try's among them. Null where
   * nothing is known of any.
   * @param {CompactionJob} j
   * @returns {{ paid: number | null, list: number | null, calls: number } | null}
   */
  const costOfJob = (j) => {
    /** @type {number | null} */
    let paid = null;
    /** @type {number | null} */
    let list = null;
    for (const c of j.calls.values()) {
      if (typeof c.paid === "number") paid = (paid ?? 0) + c.paid;
      if (typeof c.list === "number") list = (list ?? 0) + c.list;
    }
    const round = (/** @type {number | null} */ v) => (v == null ? null : Math.round(v * 1e6) / 1e6);
    return paid == null && list == null ? null : { paid: round(paid), list: round(list), calls: j.calls.size };
  };
  /**
   * The row takes its compaction's cost (`detail.cost`) once every call's record has finished, and the events feed says
   * it (`compaction-cost` with the session's id, on `compactions`), so a page that drew the row puts it there. Written
   * once; nothing is written of a part, of a compaction that wrote no row, or of a row undone meanwhile.
   * @param {CompactionJob} j
   */
  const settle = (j) => {
    if (j.row == null) return void settling.delete(j.job);
    for (const c of j.calls.values()) if (!c.done) return void settling.set(j.job, j);
    const row = j.row;
    j.row = null;
    settling.delete(j.job);
    const cost = costOfJob(j);
    if (!cost) return;
    try {
      if (archive().mergeCompactionDetail(row, { cost })) publish?.(j.chainId, { type: "compaction-cost", id: row, cost });
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: ${j.chainId} compaction ${row}: its cost was not written (${e.message})`);
    }
  };
  let compactionSeq = 0;
  /** The stop of each compaction written outside a turn (Compact, /autofit), which `stopCompaction` aborts. @type {Map<string, AbortController>} */
  const compactionStops = new Map();
  /**
   * The stop of a compaction written on request, taken once the session's one write is claimed: the stop of the turn
   * it runs inside (`within`: a typed command's), else one of its own (`own`), which `stopCompaction` aborts until
   * `done`. `stopped` says whether its own stop ended it.
   * @param {any} chain @param {any} within
   */
  const compactionStop = (chain, within) => {
    const host = within ? liveTurns.get(chain.id) : null;
    if (host && host.res === within) return { signal: /** @type {AbortSignal} */ (host.cancel.signal), own: false, stopped: () => false, done: () => {} };
    const mine = new AbortController();
    compactionStops.set(chain.id, mine);
    // Its own stop alone: the summary for the copy that follows an agent's compaction registers its own meanwhile.
    return { signal: mine.signal, own: true, stopped: () => mine.signal.aborted, done: () => void (compactionStops.get(chain.id) === mine && compactionStops.delete(chain.id)) };
  };
  /** @param {CompactionJob} j */
  const compactionNow = (j) => {
    let thinking = 0, text = 0, running = 0, done = 0;
    for (const c of j.calls.values()) {
      thinking += c.thinking;
      text += c.text;
      if (c.done) done++;
      else running++;
    }
    return {
      door: j.door, since: j.since, step: j.step, percent: j.percent, calls: { running, done, ...(j.planned ? { planned: j.planned } : {}) }, thinkingChars: thinking, textChars: text + j.written, lastByteAt: j.lastAt,
      ...(j.own ? { own: true } : {}),
      ...(j.stoppable ? { stoppable: true } : {}),
    };
  };
  /** The compaction running for a session now, as it was last said; null when none is. @param {string} chainId */
  const compactionOf = (chainId) => {
    for (const j of compactionJobs.values()) if (j.chainId === chainId) return compactionNow(j);
    return null;
  };
  /** Every compaction running now, by its session: the page's resync (`GET /sessions/holders`). */
  const compactionsNow = () => [...compactionJobs.values()].map((j) => ({ chainId: j.chainId, progress: compactionNow(j) }));
  /**
   * Every chat's work stretch going now — a turn of the chat's runs, or something keeps it — its start, and between its
   * turns what it waits for (stretch.js): the page's resync (`GET /sessions/holders`). One found over ends here. None
   * where it could not be read: the read goes on without them.
   * @returns {import("./stretch.js").StretchRow[]}
   */
  const stretchesNow = () => {
    /** @type {import("./stretch.js").StretchRow[]} */
    let rows = [];
    stretchStep("*", "read", () => (rows = stretches.going((chainId) => liveTurns.has(chainId))));
    return rows;
  };
  /**
   * Something of a chat's ended, or a wake came to nothing — its commands moved, the waker let go of it —: where no turn
   * of it runs, its work stretch ends unless something still keeps it. @param {string} chainId
   */
  const stretchCheck = (chainId) => {
    if (!liveTurns.has(String(chainId || ""))) stretchStep(String(chainId || ""), "weighed", () => stretches.settle(String(chainId || "")));
  };
  /** @param {CompactionJob} j @param {boolean} [ended] */
  const sayCompaction = (j, ended = false) => publish?.(j.chainId, { type: "compaction-progress", progress: ended ? null : compactionNow(j) });
  /**
   * A compaction's job begins: the id its calls carry, `onStep` for where it is, `onAgent` for a coding agent's own
   * word of its compaction (how much of its summary it has written), `end` when it is over.
   * @param {string} chainId @param {"line" | "manual" | "autofit" | "copy"} door  `copy`: the summary of the copy alone (`followCopy`)
   * @param {{ own?: boolean, stoppable?: boolean }} [o]
   */
  const compactionJob = (chainId, door, { own = false, stoppable = false } = {}) => {
    /** @type {CompactionJob} */
    const j = { chainId, job: `compaction-${now().toString(36)}-${++compactionSeq}`, door, since: now(), step: null, percent: null, calls: new Map(), lastAt: null, own, stoppable, written: 0, row: null, planned: null };
    compactionJobs.set(j.job, j);
    sayCompaction(j);
    return {
      job: j.job,
      /** @type {import("./compactor.js").StepSink} */
      onStep: (s) => {
        j.step = String(s.message || "");
        j.percent = s.percent ?? null;
        if (Number(s.planned) > 0) j.planned = Number(s.planned);
        sayCompaction(j);
      },
      /** @param {any} ev */
      onAgent: (ev) => {
        if (ev?.type !== "compaction" || ev.written == null) return;
        j.written = Number(ev.written) || 0;
        j.lastAt = now();
        sayCompaction(j);
      },
      /** The row the compaction wrote: its cost goes there once its calls' records have finished (U3-11). @param {{ ok?: boolean, id?: number | null } | null | undefined} made */
      landed: (made) => {
        if (made?.ok !== false && Number(made?.id) > 0) j.row = Number(made?.id);
      },
      end: () => {
        // Another compaction of the session's still runs (one asked for took a copy's summary's place): it is the one said.
        const other = compactionJobs.delete(j.job) ? [...compactionJobs.values()].find((x) => x.chainId === j.chainId) : null;
        if (other) sayCompaction(other);
        else sayCompaction(j, true);
        settle(j);
      },
    };
  };
  // The request log's records of a compaction's calls (`jobId`): what each has streamed while it runs, what it wrote
  // once it ends (a finished record keeps its counts, not the live ones), and what it cost — which a call's record
  // may say after the compaction is over (`settling`).
  records?.on?.("event", (/** @type {any} */ e) => {
    const r = e?.record;
    const running = r?.jobId ? compactionJobs.get(String(r.jobId)) : null;
    const j = running || (r?.jobId ? settling.get(String(r.jobId)) : null);
    if (!j || !r.id) return;
    const c = j.calls.get(String(r.id)) || { thinking: 0, text: 0, done: false };
    if (r.liveOutChars != null) {
      c.thinking = Number(r.liveThinkChars) || 0;
      c.text = Math.max(0, Number(r.liveOutChars) - c.thinking);
    } else if (r.textChars != null || r.thinkingChars != null) {
      c.thinking = Number(r.thinkingChars) || 0;
      c.text = Number(r.textChars) || 0;
    }
    // The last byte is when the output last grew: the log's word of it can come up to a second later (`quietMs`).
    if (e.type === "first-byte" || e.type === "progress") j.lastAt = now() - (Number(e.quietMs) || 0);
    c.done = r.status !== "pending";
    if (c.done) {
      c.paid = typeof r.cost === "number" ? r.cost : null;
      c.list = typeof r.listCost === "number" ? r.listCost : null;
    }
    j.calls.set(String(r.id), c);
    if (running) sayCompaction(j);
    else settle(j);
  });

  /** Sessions a compaction summary is being written for right now: one writer per session, whichever door asked. */
  const compacting = new Set();
  /**
   * Sessions whose room was made for the person's message, which goes once it is (the page's Compact and send, the
   * owner's of 11-09), until that message's turn takes the session (`roomTaken`) — `roomHoldMs` at most, past which its
   * wakes and goal rounds are asked again (`roomMade`), as where no message was to follow.
   * @type {Map<string, ReturnType<typeof setTimeout>>}
   */
  const roomFor = new Map();
  /**
   * Whether room is being made for the chat — a summary written, or its coding agent compacting its own session — or was
   * made for the person's message that has not gone yet: no wake or goal round runs then (`turn`). @param {string} chainId
   */
  const roomNow = (chainId) => compacting.has(chainId) || owning.has(chainId) || roomFor.has(chainId);
  /** The room's wakes and goal rounds, asked again (`roomMade`, the server's wakers). @param {string} chainId */
  const askAgain = (chainId) => {
    try {
      roomMade?.(chainId);
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: session ${chainId}: what waited for its room was not asked again (${e?.message || e})`);
    }
  };
  /** The person's message the room was made for took the session: nothing is asked again. @param {string} chainId */
  const roomTaken = (chainId) => {
    if (!roomFor.has(chainId)) return;
    clearTimeout(roomFor.get(chainId));
    roomFor.delete(chainId);
  };
  /**
   * The room's writing ended: where a message is to follow (`sending`), what waited waits for it, `roomHoldMs` at most;
   * else it is asked again now. @param {string} chainId @param {boolean} sending
   */
  const roomEnded = (chainId, sending) => {
    roomTaken(chainId);
    if (!sending) return askAgain(chainId);
    const t = setTimeout(() => {
      roomFor.delete(chainId);
      askAgain(chainId);
    }, roomHoldMs);
    t.unref?.();
    roomFor.set(chainId, t);
  };
  /**
   * Claim the session's one compaction write; the returned function releases it. `sending`: the person's message goes
   * once the room is made (`roomEnded`). @param {any} chain @param {{ sending?: boolean }} [o]
   */
  const claimCompaction = (chain, { sending = false } = {}) => {
    if (compacting.has(chain.id)) throw refusal(409, "a compaction is already being written for this session; wait for it");
    // A summary being written for the copy alone gives way: what is asked for now stands for those turns.
    copying.get(chain.id)?.stop.abort();
    compacting.add(chain.id);
    return () => {
      compacting.delete(chain.id);
      roomEnded(chain.id, sending);
    };
  };
  /**
   * The end of the turn that holds a session, waited for with no clock (Stop and compact): at once where none holds it,
   * else when its lock is free — the turn ended, or its stop or its Force stop ended it. The asker hanging up ends the
   * wait in words.
   * @param {any} chain @param {AbortSignal | null} signal
   */
  const turnOver = (chain, signal) =>
    new Promise((resolve, reject) => {
      if (!sessionTurns) return resolve(undefined);
      const left = () => {
        un();
        reject(refusal(409, "the page that asked to compact once the turn ends left before it did; nothing was compacted"));
      };
      const un = sessionTurns.onChange(chain.key, (holder) => {
        if (holder || signal?.aborted) return;
        un();
        signal?.removeEventListener("abort", left);
        resolve(undefined);
      });
      if (signal?.aborted) return left();
      signal?.addEventListener("abort", left, { once: true });
    });
  /**
   * Whether a turn other than the caller's own holds the session. A summary takes minutes, so a write checks this
   * before it summarizes AND right before its row lands — a turn that started meanwhile owns the history's head.
   * `within` is the response of the turn the caller runs inside (a typed command's), never counted against it.
   * @param {any} chain @param {any} [within]
   */
  const heldByOther = (chain, within = null) => {
    const own = liveTurns.get(chain.id);
    return !!(sessionTurns?.holder(chain.key) || own) && !(own && within && own.res === within);
  };

  /**
   * `/autofit` (2026-09-28): make this session's next request fit its model's window — deliberately, when the person
   * says so. It summarizes exactly
   * as many of the oldest completed turns as the window needs to hold `margin` (default 0.85) of the compaction line —
   * never more — weighs the REAL summary before writing it, deepens the cut once if the summary came back fatter than
   * the first guess, and writes one compaction. `status` writes nothing and only says the numbers. A session whose
   * requests come from another client is answered with its numbers and the honest limit: the client owns
   * the history. `within` is the response of the turn the caller runs inside — a typed `/autofit` is answered in its
   * own turn, and that turn is no reason to refuse it.
   * @param {string} id @param {{ margin?: number | null, status?: boolean, within?: any }} [o]
   */
  async function autofit(id, { margin = null, status = false, within = null } = {}) {
    const m = Number(margin);
    const fallback = Number(config.get()?.rules?.autofit?.margin) || 0.85; // the command's default, under Rules → autofit
    const share = Number.isFinite(m) && m > 0 ? Math.min(0.95, Math.max(0.3, m)) : fallback;
    const chain = chainOf(id);
    const settings = settingsOf(chain.id);
    const eff = settings.effective;
    const modelName = String(eff.model?.name || chain.model || "").trim();
    const inner = parseAgentModel(modelName)?.model || modelName;
    const measures = await preview(id, { prompt: true });
    const cur = measures.current || {};
    const windowTokens = Number(cur.window) || 0;
    const usable = Number(cur.usable) || 0;
    // The request is the loop's own part and the history composed (HarnessV3-Tools TL-D9), as the preview weighs it
    // (`fixedOf`, LD-D6) — a fit that weighed less than the loop does would leave a session the loop still stops at
    // the window. A client's session carries its client's prompt and tools, which Filament does not weigh.
    const fixed = Number(cur.fixed) || 0;
    const nowTokens = Number(cur.whole) || 0;
    const fmt = (/** @type {number} */ n) => n.toLocaleString("en-US");
    /** A request's weight in words, the loop's part named when there is one. */
    const weighs = (/** @type {number} */ n) => `${fmt(n)}${fixed ? ` (its prompt and tools ≈${fmt(fixed)}, the history ≈${fmt(n - fixed)})` : ""}`;
    const turnsWord = (/** @type {number} */ a, /** @type {number} */ b) => (a === b ? `turn ${a}` : `turns ${a}–${b}`);
    // The head with its TEXT (compose's report carries only the range): the same newest-with-text row compact() uses.
    const headRow = compactionHead(compactionsOf(chain.id));
    const numbers = { window: windowTokens || null, usable: usable || null, now: nowTokens || null, fixed, turns: measures.turns, head: cur.head || null };
    if (!windowTokens || !usable) return { ok: true, action: "unknown", ...numbers, note: `no context window is known for ${inner || "this model"} — set one on its upstream's Tune sheet (Destinations) to judge by` };
    const target = Math.floor(usable * share);
    const pct = `${Math.round(share * 100)}%`;
    if (!chain.meta?.native)
      return {
        ok: true,
        action: status ? "status" : "outside",
        ...numbers,
        note: `this session's requests come from its own client — the client owns the history, and Filament reshapes nothing between them. The numbers: ${fmt(nowTokens)} of a ${fmt(windowTokens)}-token window; compaction line ${fmt(usable)}. Compact on the client's side, or continue the session in the harness.`,
      };
    if (nowTokens <= target)
      return { ok: true, action: status ? "status" : "none", ...numbers, note: `already inside the margin: ${weighs(nowTokens)} of a ${fmt(windowTokens)}-token window (line ${fmt(usable)}), target ${fmt(target)} (${pct} of the line). Nothing to do.` };
    // The loop's part alone past the target: no cut of the history can reach it, so none is offered or written.
    if (fixed >= target) {
      const mcp = mcpWeightOf(chain, eff); // the servers' part of it (TL-D22), named when there is one
      return {
        ok: true,
        action: status ? "status" : "none",
        ...numbers,
        note: `the loop's own part of every request — its prompt and tools${mcp ? ` (its MCP servers' ≈${fmt(mcp)})` : ""}, ≈${fmt(fixed)} tokens — is past the ${fmt(target)} target (${pct} of the ${fmt(usable)} line) on its own: compacting the history cannot reach it. Hold a larger margin (/autofit 95), switch tools off (loop.tools)${mcp ? " or MCP servers (plugins.mcp)" : ""}, or use a model with a larger window.`,
      };
    }
    // The turns past the compaction head, oldest first, in the SHAPED tokens the request actually carries.
    const headTo = Number(headRow?.to_turn) || 0;
    const headFrom = headRow ? Number(headRow.from_turn) || 1 : null;
    const past = (cur.perTurn || []).filter((t) => Number(t.n) > headTo);
    if (!past.length) return { ok: true, action: status ? "status" : "none", ...numbers, note: `over the target but every completed turn is already under the summary of ${turnsWord(headFrom ?? 1, headTo)}: compacting again would only re-summarize the same words. Fold the earlier turns from the compaction card (/compaction) or start a fork.` };
    /** The fewest turns after turn `after` whose tokens cover `need` — every remaining turn when nothing fewer does. */
    const coverTo = (/** @type {number} */ after, /** @type {number} */ need) => {
      let upTo = null;
      for (const t of past) {
        if (Number(t.n) <= after) continue;
        upTo = Number(t.n);
        need -= Number(t.tokens) || 0;
        if (need <= 0) break;
      }
      return upTo;
    };
    // ~800 tokens is the first guess for the summary that replaces them — on purpose (a summary is brief): the real
    // summary is weighed before anything is written, and a light guess deepens the cut once.
    let upTo = coverTo(headTo, nowTokens + 800 - target) ?? Number(past[past.length - 1].n);
    if (status) {
      const folded = past.filter((t) => Number(t.n) <= upTo);
      const frees = folded.reduce((n, t) => n + (Number(t.tokens) || 0), 0);
      const numbersNote = `${weighs(nowTokens)} of a ${fmt(windowTokens)}-token window; line ${fmt(usable)}`;
      return {
        ok: true,
        action: "status",
        ...numbers,
        wouldCompact: { fromTurn: headTo + 1, toTurn: upTo, turns: folded.length, frees },
        note:
          nowTokens - frees + 800 <= target
            ? `${numbersNote}; compacting ${turnsWord(headTo + 1, upTo)} (≈${fmt(frees)} tokens) would hold the next request under ${fmt(target)} (${pct} of the line).`
            : `${numbersNote}; even compacting every completed turn (${turnsWord(headTo + 1, upTo)}, ≈${fmt(frees)} tokens) would leave the next request over ${fmt(target)} (${pct} of the line). Fold the earlier turns from the compaction card (/compaction), or use a model with a larger window.`,
      };
    }
    // Only a write waits for the session — and never on the turn the caller itself runs in — or for the answer to the
    // question a turn paused on.
    if (heldByOther(chain, within)) throw refusal(409, "a turn is running in this session; /autofit when it ends");
    if (askingNow(chain.id)) throw refusal(409, "a question waits for your answer: answer it first, then /autofit");
    const fromTurn = headFrom ?? 1;
    const byN = new Map(adaptForCompose(modelTurns(chain.id), eff, chain, compactionsOf(chain.id)).map((t) => [Number(t.n), t]));
    const lead = headRow ? earlierOf(headRow) : null;
    const listTo = (/** @type {number} */ to) => past.filter((t) => Number(t.n) <= to).map((t) => byN.get(Number(t.n))).filter(Boolean);
    // A coding agent's copy of the chat is summarized from its turns' folds (compaction.js `readTurn`).
    const folded = !!agentSessionOf(config.get(), inner);
    const writer = summaryWriter(eff, inner, [summaryTranscript(lead, listTo(upTo), folded)]);
    /** How the newest summary was written (one call, or the slice pass's slices), for the row's detail. */
    let how = "call";
    /** @type {ReturnType<typeof compactionJob> | null} */
    let progress = null;
    /** @type {ReturnType<typeof compactionStop> | null} */
    let stopper = null;
    const summarizeTo = async (/** @type {number} */ to) => {
      const w = await compactor.writeSummary({ chain, list: listTo(to), lead, whole: false, writer, folded, signal: stopper?.signal ?? null, job: progress?.job ?? null, onStep: progress?.onStep ?? null });
      if (!w.text) throw refusal(502, "the compaction model returned an empty summary; nothing was written");
      how = w.how;
      return w.text;
    };
    /** What comes back after the summary of the turns up to `to` (HarnessV3-AtHome AH-D9 b), read from the loop's folder. */
    const backAfter = (/** @type {number} */ to) => backAfterSummary({ doc: eff, turns: [...byN.values()], toTurn: to, head: headRow, root: loopRootOf(chain), window: windowTokens, graph: chain.meta?.graph, teams: leadingTeams(config.get(), chain.kind === "team", teams), kept: graphKept?.(chain.id) ?? null, where: graphWhere ? (crew) => graphWhere(chain.id, crew) : null, open: stillOpen?.lines(chain.id) ?? null, owed: Object.keys(chain.meta?.letters?.asks || {}) });
    // What the folder holds, read while the summary is written: the block after it says it.
    void stillOpen?.refresh?.(chain.id);
    /** What the next request weighs with this summary and its block standing — composed, not guessed, and nothing written. */
    const weigh = async (/** @type {number} */ to, /** @type {string} */ text, /** @type {{ text: string }} */ back) =>
      Number((await preview(id, { prompt: true, pending: { fromTurn, toTurn: to, text, attached: back.text || null } })).current?.whole) || 0;
    const release = claimCompaction(chain);
    const stop = (stopper = compactionStop(chain, within));
    progress = compactionJob(chain.id, "autofit", { stoppable: stop.own });
    const began = now();
    try {
      let text = await summarizeTo(upTo);
      // The block weighed is the block written: the figure the fit names is the next request's own.
      let back = backAfter(upTo);
      let after = await weigh(upTo, text, back);
      const deeper = after > target ? coverTo(upTo, after - target) : null;
      if (deeper != null) {
        upTo = deeper;
        text = await summarizeTo(upTo);
        back = backAfter(upTo);
        after = await weigh(upTo, text, back);
      }
      if (stop.signal.aborted) throw refusal(409, "stopped before anything was written");
      if (heldByOther(chain, within)) throw refusal(409, "a turn started while /autofit summarized; nothing was written — run it again when the turn ends");
      if (askingNow(chain.id)) throw refusal(409, "a question was asked while /autofit summarized; nothing was written — answer it first, then run it again");
      // How long the fit took to write (HarnessV4_Tasks U3-5): every summary of its cut, and their weighing.
      const detail = { before: nowTokens, after, exact: true, model: writer.model, how, ms: Math.max(0, now() - began) };
      const row = archive().addCompaction(chain.id, { fromTurn, toTurn: upTo, summaryText: text, kind: "autofit", window: "harness", method: "summary", detail, attached: back.text ? back : null });
      stillOpen?.told(chain.id);
      progress.landed(row);
      // The turns it stands for are learned now (HarnessV3-Memory M7-D27), as after every compaction a window adopts.
      const learning = memory?.compacted ? memory.compacted(chain.id, { door: "autofit" }) : null;
      ops.record("compaction", `session ${chain.id}: turns ${fromTurn}–${upTo} compacted by /autofit`, { sub: "autofit", detail: { chainId: chain.id, fromTurn, toTurn: upTo, chars: text.length, model: writer.model, method: "summary", ...learningDetail(learning) }, ref: { chainId: chain.id } });
      const folded = `${turnsWord(headTo + 1, upTo)}${headRow ? ` (with the summary of ${turnsWord(fromTurn, headTo)})` : ""}`;
      return {
        ok: true,
        action: "compacted",
        ...numbers,
        after,
        compaction: { id: row.id, fromTurn, toTurn: upTo, chars: text.length, kind: "autofit", method: "summary" },
        // A typed /autofit answers inside its own turn, so there is no later message yet — but that turn is running:
        // the page learns whether it can be undone from the transcript, not from here.
        boundary: { type: "compaction", id: row.id, afterTurn: upTo, fromTurn, toTurn: upTo, kind: "autofit", method: "summary", chars: text.length, detail, ...boundaryText(text) },
        note: `compacted ${folded} into one summary: the next request weighs ~${weighs(after)} of the ${fmt(windowTokens)}-token window (line ${fmt(usable)}), ${after > target ? `still over the ${pct}-of-the-line target (${fmt(target)}) — run /autofit again, or fold the earlier turns from the compaction card (/compaction)` : `under the ${pct}-of-the-line target (${fmt(target)})`}${learningWords(learning)}.`,
        learning,
      };
    } catch (/** @type {any} */ e) {
      // Stopped (HarnessV4_Tasks U3-5): the cancelled call's error is no failure of the fit's.
      if (stop.signal.aborted) throw refusal(409, "stopped before anything was written", stop.stopped() ? { stopped: true } : {});
      throw e;
    } finally {
      stop.done();
      release();
      progress.end();
    }
  }

  /**
   * The shape preview and the context map's data (§10.3, §8.1 `GET …/compose?dry=1`): the history composed as the
   * next turn would see it, under the session's own settings — and in each form a fresh agent session can carry
   * (`context.carry`: its own fresh start, a switch into one) — without sending, writing or summarising anything. The compaction at the
   * line is reported as `wouldCompact` rather than run. `current` is the map: every completed turn's shape and tokens, the
   * compaction head, the turns already under a summary. With `prompt` the current run also returns the composed
   * request itself — every message as the composer hands it to the pipeline, the developer's draft (`text`) as the
   * newest user message — the dry-run turn (HarnessV2 §14). The composer's body carries no system text or tools:
   * the agent loop adds its system prompt (the instructions row shows it) and its tools on the way out, and memory
   * adds recall when it is on, so the dry run says so rather than guess at them. `pending` is a summary not yet
   * written, weighed as if it stood with what comes back after it — `/autofit` measures its real summary before it
   * writes one. With `compaction`
   * the answer carries the compactor's plan (HarnessV3-Compaction §6): every way of making room weighed — what each
   * would leave, cost and call, who would write a summary and whether the warm cache could — asked
   * for by the harness's one preview per conversation state, not by every caller (it composes the history five more
   * times). A session whose requests come from another client gets none (§7.3): its client owns the history, decides
   * when to compact, and its own model writes that summary.
   * `once` weighs the plan as a side model chosen for one compaction would make it (`onceDoc`).
   * @param {string} id @param {{ forms?: string[], prompt?: boolean, text?: string, pending?: { fromTurn: number, toTurn: number, text: string, attached?: string | null } | null, compaction?: boolean,
   *   once?: { model?: string | null, writer?: string | null } | null }} [o]
   */
  async function preview(id, { forms = [], prompt = false, text = "", pending = null, compaction = false, once = null } = {}) {
    const asked = { forms, prompt, text, pending, compaction, once };
    // A number JSON cannot say keys apart from the null it would be written as.
    const key = JSON.stringify([String(id || ""), asked, archive().writes()], (_k, v) => (typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? `#${v === 0 ? "-0" : v}` : v));
    const cfg = config.get();
    const version = config.version?.() ?? null;
    const running = previewsNow.get(key);
    if (running && running.cfg === cfg && running.version === version) return running.answer;
    const answer = composedPreview(id, asked).finally(() => {
      if (previewsNow.get(key)?.answer === answer) previewsNow.delete(key);
    });
    previewsNow.set(key, { cfg, version, answer });
    return answer;
  }
  /**
   * The previews being composed now, by what each was asked and how far the archive had been written when it began: one
   * asked the same while it runs — nothing written to the archive since, the same configuration in force — is that one's
   * answer, not a second composition (a long chat's compactor plan takes a minute). Only while it runs: no answer is
   * kept after, for what it reads beside the archive moves on its own — the files a summary would bring back, how warm
   * a cache is still.
   * @type {Map<string, { cfg: any, version: number | null, answer: Promise<any> }>}
   */
  const previewsNow = new Map();
  /** @param {string} id @param {Parameters<typeof preview>[1] & {}} o */
  async function composedPreview(id, { forms = [], prompt = false, text = "", pending = null, compaction = false, once = null }) {
    const chain = chainOf(id);
    const cfg = config.get();
    const settings = settingsOf(chain.id);
    // The plan as a writer chosen for one compaction would make it (`onceDoc`): the card's figures.
    const eff = onceDoc(settings.effective, once);
    const modelName = String(eff.model?.name || chain.model || "").trim();
    const inner = parseAgentModel(modelName)?.model || modelName;
    const window = (inner && sessionWindowFor(cfg, inner, eff.model?.window).tokens) || null;
    const all = archive().turnBodies(chain.id);
    const completed = modelTurnsOf(all, bootAt);
    const compactions = [...compactionsOf(chain.id), ...(pending ? [{ from_turn: pending.fromTurn, to_turn: pending.toTurn, text: pending.text, kind: "autofit", attached: pending.attached ?? null }] : [])];
    const probe = { role: "user", content: [{ type: "text", text: prompt ? String(text || "") : "" }] };
    // The loop's part, weighed once: the same beside every form's history (LD-D6).
    const fixed = await fixedOf(chain, eff);
    const run = async (/** @type {any} */ doc, /** @type {Formed | null} */ seed, withPrompt = false) => {
      const c = await composeKept({ turns: adaptForCompose(completed, doc, chain, compactions, { loop: !agentSessionOf(cfg, inner) }), compactions, settings: doc, ...(seed || recallOf(cfg, modelName)), newUser: probe, model: modelName || "preview", window, factor: calibFactorFor(cfg, inner), media: mediaWeights(cfg, inner), fixed });
      const r = c.report;
      return {
        ...(withPrompt ? { prompt: {
          messages: Array.isArray(c.body?.messages) ? c.body.messages : [],
          tokens: r.sentTokens,
          added: "the agent loop adds its system prompt (see Instructions) and its tools on the way out; memory adds recall when it is on",
        } } : {}),
        form: r.form,
        results: r.results,
        // `tokens` is the composed history (the body); `fixed` what rides beside it; `whole` the request — the one
        // figure the meter, the map and the line share (LD-D6).
        tokens: r.sentTokens,
        fixed: r.fixedTokens,
        whole: r.sentTokens + r.fixedTokens,
        historyTokens: r.historyTokens,
        window: r.window,
        usable: r.usable,
        wouldCompact: r.overLine,
        head: r.head,
        underSummary: r.underSummary,
        // The recall tool rides on every request of a chat Filament runs wherever memory's archive is open, memory on or
        // off (memory-prepare.js); a coding agent's reaches memory its own way.
        recall: !!memory?.archive && !agentSessionOf(cfg, inner),
        perTurn: r.turns.map((t) => ({ n: t.n, shape: t.shape, tokens: t.tokens, stubs: t.stubs, ...(t.fallback ? { fallback: t.fallback } : {}), ...(t.adapted ? { adapted: t.adapted } : {}) })),
        notes: r.notes,
      };
    };
    // A compaction written after the newest model turn began: that turn's request no longer says what the session
    // holds, so the meter shows this preview's `whole` until the next reply (LD-D6, F20). An Undo that takes it back
    // leaves the newest request true again.
    const lastStart = Math.max(0, ...completed.map((/** @type {any} */ t) => Number(t.startedAt) || 0));
    // One a coding agent made in the middle of that turn is in the turn's own count, and one Filament wrote for its
    // copy alone changed nothing the session holds (`ofCopyAlone`).
    const compactedSince = compactions.some((c) => Number(c.created_at) > lastStart && !ofCopyAlone(c));
    // A coding agent's session is weighed by what the agent holds (HarnessV3-ACP AC5-3).
    const agentUp = agentSessionOf(cfg, inner);
    const at = agentUp && !pending ? agentHeld({ turns: completed, compactions, upstream: agentUp, window }) : null;
    const lastAnswered = completed.at(-1)?.meta?.facts?.upstream || null;
    const current = {
      // A fresh session after a move or a rewind carries the turns whole (the hunt of carry-move).
      ...await run(eff, seedOf(eff, settings, agentUp, lostBy(chain.meta, agentUp, all, completed) ? lostFormOf(settings, eff) : null), prompt),
      compactedSince,
      // What an agent holds after a compaction since its newest turn (AC5-8): after its own, what it said it holds
      // (null where it named nothing after it); after one of Filament's, null — its next turn starts a fresh agent
      // session from the composition (`whole`).
      ...(agentUp && compactedSince ? { agentHeld: at ? { held: at.unsaid ? null : at.held, window: at.window } : null } : {}),
      // A switch into the agent (HarnessV4_Tasks U3-10): another engine answered last, so the session's agent holds
      // none of the chat — its next turn starts a fresh session from the composition (`whole`), the turn's own test
      // (`switchedIn`). The newest turn's count is the other engine's, in its window, and says nothing of this one.
      ...(agentUp && !pending && !at && lastAnswered && lastAnswered !== agentUp ? { freshStart: { why: "switch" } } : {}),
      // What the chat sends ahead of its history changed since it last sent it (the owner's of 11-06), where the next
      // message asks of it: the question on, and an agent's session going on (a fresh one reads it all anew). The
      // loop's next request writes the whole history to the cache again; an agent's session keeps what it already loaded.
      ...(!pending && compactionSettingsOf(settings.effective).changeQuestion && (!agentUp || at) ? { printChanged: printOf(chain, settings.effective, !!agentUp, compactionsOf(chain.id)).changes } : {}),
    };
    /** @type {Record<string, any>} */
    const byForm = {};
    // The sweep weighs the forms a fresh agent session can carry (`context.carry`): a coding agent's own fresh start,
    // and a switch into one from any chat (the switch card's figures).
    const previewed = CARRY_FORMS;
    // The dry-run turn asks for the prompt, not the sweep, unless it names forms too.
    const asked = forms.length ? forms : prompt ? [] : previewed;
    for (const form of asked)
      byForm[form] = previewed.includes(form)
        ? await run(eff, formed(form, eff, settings))
        : { form, error: `not previewed: "${form}" is no form a fresh agent session carries` };
    const undoable = pending ? null : undoableCompaction(chain.id);
    /** @type {any} */
    let plan;
    // A client's chat has no plan: its client owns the history and compacts it, on its own model.
    if (compaction && chain.meta?.native) {
      const w = measuredCompose(chain, eff, { seed: seedOf(eff, settings, agentUp), newUser: probe, model: modelName || "preview", calib: inner, window, fixed });
      plan = { native: true, ...(await compactor.plan({ chain, doc: eff, turns: adaptForCompose(completed, eff, chain, compactions), compactions, sessionModel: inner, window: at?.window ?? window, measure: w.measure, root: loopRootOf(chain), ...(at ? { held: at.held } : {}) })) };
      if (agentUp && !pending) plan.agent = agentPlan(eff, at, { upstream: agentUp, chainId: chain.id, cwd: cwdOf(chain), base: basesOf(compactions, completed).of(agentUp) }, inner, ownShareOf(completed, agentUp, cwdOf(chain)));
    }
    return {
      chainId: chain.id,
      turns: completed.length,
      ...(plan ? { compaction: plan } : {}),
      // Each compaction by its figures. A row with a summary rides along by the summary it names — its text is not
      // opened for the list (HarnessV4_Tasks C30 item 5: a quote of it went to no page); a pending one carries its
      // text. A fold compaction has no text by design (it marked turns) and rides along with its method, as
      // does a coding agent's own (its summary is in its session, HarnessV3-ACP AC5-5).
      compactions: compactions
        .filter((c) => ("summary_hash" in c ? c.summary_hash != null : c.text != null) || c.method === "fold" || c.method === "own")
        .map((c) => ({
          id: c.id, fromTurn: Number(c.from_turn) || 1, toTurn: Number(c.to_turn) || 0, kind: c.kind, method: c.method, at: c.created_at, detail: c.detail || null,
          undoable: !!undoable && Number(undoable.id) === Number(c.id),
        })),
      current,
      forms: byForm,
    };
  }

  /** The run of the turn running in a session now — the newest, where the log lists several — or null. @param {any} chain */
  const liveRunOf = (chain) =>
    (/** @type {any} */ (runs)?.runningIn?.(chain.id) || []).slice().sort((/** @type {any} */ x, /** @type {any} */ y) => (Number(y.startedAt) || 0) - (Number(x.startedAt) || 0))[0] || null;

  /**
   * The turn running in a session now, as a reader beside it is shown it (HarnessV4_Tasks E13-1, BW-6): rebuilt from
   * its run's log (core/run-work.js `runningWork`) — a loop's turn and a coding agent's write the same log. Its
   * message, its earlier rounds folded (a line for each result) and its newest round whole, as plain text — every round
   * whole for the context window's view (`whole`). It starts where the turn's newest compaction left the agent's window
   * (`newestCompaction`; the owner's words of 10-19: "the context window only contains the content since last
   * compaction"): the rounds before it are gone, and its summary stands in their place, or a line that says the log kept
   * none. `mark`: what the reader was last shown; where it is this run, only what the log gained since, and no message.
   * Null with no turn running.
   * @typedef {{ run: string, event: number, rounds: number, tools: number, again: boolean, startedAt: number, text: string, compacted: import("../../core/run-work.js").RunCompaction | null }} RunningView
   *   `event`: the log's newest event, the next look's mark; `again`: a later look at the same run; `text`: "" where
   *   nothing moved since; `compacted`: the compaction it starts from, null where the turn made none
   * @param {any} chain @param {{ run: string | null, event: number } | null} mark @param {{ whole?: boolean }} [o]
   * @returns {RunningView | null}
   */
  const runningView = (chain, mark, { whole = false } = {}) => {
    const log = /** @type {any} */ (runs);
    const live = liveRunOf(chain);
    if (!live || !log?.events) return null;
    const again = !!mark && mark.run === live.id;
    const events = eventsOf(log, live.id);
    const cut = newestCompaction(events);
    const seen = again ? Number(mark?.event) || 0 : 0;
    const w = runningWork(events, { since: Math.max(seen, cut?.at || 0) });
    const turnId = again ? null : archive().turnOfRequest(chain.id, live.id);
    const asked = turnId == null ? null : archive().getMessage(archive().getTurn(turnId)?.user_hash)?.message;
    const said = asked ? [{ role: "user", content: [{ type: "text", text: textOfMessage(withoutAskLine(asked)) }] }] : [];
    // The compaction is said to a reader not yet told of it.
    const room = cut && cut.at > seen ? [{ role: "user", content: [{ type: "text", text: compactionWords(cut) }] }] : [];
    const older = whole ? w.older : statusResults(w.older).messages;
    return { run: live.id, event: w.event, rounds: w.rounds, tools: w.tools, again, startedAt: Number(live.startedAt) || 0, text: messagesTranscript([...said, ...room, ...older, ...w.newest]), compacted: cut };
  };

  /**
   * The question a session's turn stopped on, while it still waits for the developer's answer (`waitingNow`), as a
   * reader beside the session is told it (HarnessV4_Tasks E15, the plan's case 31). The turn stands among the
   * finished ones as far as its question, which is its reply: the reader is told it has not ended, and what the round
   * that asked said — the archive parks that round for the resume, so the turn's own row never holds it. Null when
   * nothing waits.
   * @typedef {{ kind: string, at: number, question: string, said: string }} WaitingView  `at`: when it began to wait
   * @param {any} chain @returns {WaitingView | null}
   */
  const waitingView = (chain) => {
    const p = waitingNow(chain);
    if (!p) return null;
    const said = (pausedReply(p.dangling).reply?.content || []).flatMap((/** @type {any} */ b) => (b.type === "text" ? [b.text] : [])).join("\n\n");
    return { kind: String(p.kind || "ask"), at: Number(p.at) || 0, question: String(p.question || ""), said };
  };

  /**
   * What a sub-agent launched from this session is shown of it (subagents.js): the completed turns composed in `form`
   * by the composer every request of the session goes through — compactions as they stand — and rendered as plain
   * text. Local: no model is called, nothing is written.
   *
   * Beside them, where asked (HarnessV4_Tasks E13-1):
   * - `running`: the turn running now (`runningView`); given a mark, what it did since.
   * - `changes`: a change as a patch (changes-view.js): what the turn running now has changed so far (`running`),
   *   the last finished turn's (`turn`), everything uncommitted in the session's folder (`uncommitted`), or everything
   *   since a commit, tag or branch (`since:<ref>`).
   * - `after`: only the turns finished after that turn (a later look). They are rendered from the archive as they
   *   are: a compaction that has covered them since is left aside.
   * `form` null renders no finished turn. `turn` is the newest finished turn's number — with `running.run` and
   * `running.event`, the mark of this look. `waiting`: the question the session's turn stopped on, while it waits
   * (`waitingView`). Null when the session has no completed turn and nothing beside was asked.
   * @typedef {{ text: string, turns: number, turn: number, running: RunningView | null, waiting: WaitingView | null, changes: import("./changes-view.js").ChangesView | null }} SessionView
   *   `turns`: how many finished turns `text` renders
   * @param {string} id @param {string | null} form
   * @param {{ running?: boolean | { run: string | null, event: number } | null, changes?: string | null, after?: number, resultChars?: number }} [o]
   *   `resultChars`: how much of each tool result the text keeps (2,000 characters; Infinity: all of it)
   * @returns {Promise<SessionView | null>}
   */
  /**
   * The turn a view "since your last message" begins after (HarnessV4_Tasks E15 step 7, AG-206): the one before the
   * newest turn a message of the developer's began — finished or running now; never an answer of Filament's own to a
   * chat command, a turn an agent began by itself, or one taken back. 0: from the session's start.
   * @param {string} id
   */
  function sinceMessage(id) {
    const chain = chainOf(id);
    const mine = archive().turnBodies(chain.id).findLast((/** @type {any} */ t) => !t.meta?.command && !t.meta?.own && !t.meta?.rewound);
    return mine ? Math.max(0, Number(mine.n) - 1) : 0;
  }

  async function contextView(id, form, { running = false, changes = null, after = 0, resultChars = 2000 } = {}) {
    const chain = chainOf(id);
    const completed = modelTurns(chain.id);
    if (!completed.length && form && !running && !changes) return null;
    const turn = Number(completed.at(-1)?.n) || 0;
    const since = Math.max(0, Number(after) || 0);
    const shown = form ? (since ? completed.filter((/** @type {any} */ t) => Number(t.n) > since) : completed) : [];
    let text = "";
    if (form && shown.length) {
      const cfg = config.get();
      const settings = settingsOf(chain.id);
      const eff = settings.effective;
      const modelName = String(eff.model?.name || chain.model || "").trim();
      const inner = parseAgentModel(modelName)?.model || modelName;
      const probe = { role: "user", content: [{ type: "text", text: "" }] };
      const standing = since ? [] : compactionsOf(chain.id);
      const c = await composeKept({ turns: adaptForCompose(shown, eff, chain, standing), compactions: standing, settings: eff, ...formed(form, eff, settings), newUser: probe, model: modelName || "preview", window: (inner && sessionWindowFor(cfg, inner, eff.model?.window).tokens) || null, factor: calibFactorFor(cfg, inner), media: mediaWeights(cfg, inner) });
      const messages = Array.isArray(c.body?.messages) ? c.body.messages : [];
      text = messagesTranscript(messages.at(-1)?.role === "user" ? messages.slice(0, -1) : messages, resultChars);
    }
    /** The turn a turn's patch is read from: the last finished one, or the one running now (0 with none). */
    const patched = () => {
      if (changes !== "running") return changes === "turn" ? turn : 0;
      const live = liveRunOf(chain);
      const row = live ? archive().turnOfRequest(chain.id, live.id) : null;
      return row == null ? 0 : Number(archive().getTurn(row)?.n) || 0;
    };
    /** What that turn's rounds recorded (HarnessV4_Git_Plan step 1). @param {number} n */
    const roundsOf = (n) => {
      try {
        return n ? memory.roundsOf(chain.id, { turn: n }).rounds : null;
      } catch {
        return null;
      }
    };
    const of = changes ? patched() : 0;
    const ofTurn = changes ? roundsOf(of) : null;
    /** The places only this session works in (HarnessV4_Git_Plan GW-D57). @param {any[] | null} rounds */
    const aloneIn = (rounds) => (rounds?.length && memory.placesAlone ? memory.placesAlone(chain.id, rounds.map((x) => x.place)) : null);
    return {
      text,
      turns: shown.length,
      turn,
      running: running ? runningView(chain, running === true ? null : running) : null,
      waiting: waitingView(chain),
      changes: changes ? await changesView({ source: changes, folder: cwdOf(chain) || null, turn: of, rounds: ofTurn, alone: aloneIn(ofTurn) }) : null,
    };
  }

  /**
   * One finished turn of a chat as a woken watcher reads it (app/watchers/packet.js, the plan of 11-11): what it
   * answers — the person's newest message to the chat up to it (`fromThePerson`, never a chat command), or the brief
   * the chat was started with where it is a thread and they wrote none since (`brief`: another chat's agent wrote it,
   * never the person); none where there is neither —, its reply, and memory's summary of it. Null where the chat has
   * no such turn. A turn kept apart is its chat's own alone (archive.js `apartTurn`): to any other reader (`own`
   * false) it is `apart`, nothing of it read, and no turn kept apart gives the message it answers.
   * @param {string} id @param {number} n @param {{ own?: boolean }} [o]  `own`: the chat itself reads it
   * @returns {{ person: string | null, brief?: boolean, reply: string, notes: string | null, apart?: boolean } | null}
   */
  function turnRead(id, n, { own = false } = {}) {
    const chain = chainOf(id);
    const turns = archive().turnBodies(chain.id, { to: n });
    const t = turns.find((/** @type {any} */ x) => Number(x.n) === n);
    if (!t) return null;
    if (!own && apartTurn(t)) return { person: null, reply: "", notes: null, apart: true };
    const since = bySince();
    const theirs = turns.findLast((/** @type {any} */ x) => !x.meta?.command && !x.meta?.rewound && (own || !apartTurn(x)) && (fromThePerson(x, since) || turnByOf(x, since) === "thread"));
    const brief = !!theirs && turnByOf(theirs, since) === "thread";
    const person = theirs ? textOfMessage(withoutAskLine(theirs.user)).trim() : "";
    return { person: person || null, ...(brief && person ? { brief: true } : {}), reply: t.final ? textOfMessage(t.final).trim() : "", notes: t.summary ? String(t.summary) : null };
  }

  /**
   * A watcher's wake that failed, as its turn in the chat it woke keeps it (app/routines.js `wakeChat`), for the
   * person's Retry of it (r-doors, 11-12): the wake's own block as Filament wrote it — read here from the chat's
   * record, never taken from a page —, and what the turn keeps of who woke it (`watch`). Null where the chat has no
   * such turn, no watcher began it, or it ended with its reply: a wake that was answered has nothing to send again.
   * @param {string} id @param {number} n
   * @returns {{ text: string, watch: any } | null}
   */
  function wakeOf(id, n) {
    const chain = chainOf(id);
    const t = archive().turnBodies(chain.id, { ns: [n] })[0];
    if (!t || t.finished || turnByOf(t, bySince()) !== "watch") return null;
    const said = typeof t.user?.content === "string" ? [{ type: "text", text: t.user.content }] : Array.isArray(t.user?.content) ? t.user.content : [];
    const block = said.find((/** @type {any} */ b) => b?.type === "text" && String(b.text).startsWith(WAKE_HEAD));
    return block ? { text: String(block.text), watch: t.meta?.watch ?? null } : null;
  }

  /**
   * What one finished turn of a chat changed, as a patch (changes-view.js): its agents' own files in every place its
   * rounds wrote in, as the Changes pane's Turn shows it — for a watcher woken by that turn's end. Null for a turn
   * kept apart, to any reader but its chat (`own`), as `turnRead` reads it.
   * @param {string} id @param {number} n @param {{ own?: boolean }} [o]
   */
  async function turnPatch(id, n, { own = false } = {}) {
    const chain = chainOf(id);
    if (!own && apartTurn(archive().getTurns(chain.id, { from: n, to: n })[0])) return null;
    /** @type {any[] | null} */
    let rounds = null;
    try {
      rounds = memory.roundsOf(chain.id, { turn: n }).rounds;
    } catch {
      rounds = null;
    }
    const alone = rounds?.length && memory.placesAlone ? memory.placesAlone(chain.id, rounds.map((x) => x.place)) : null;
    return changesView({ source: "turn", folder: cwdOf(chain) || null, turn: n, rounds, alone });
  }

  /**
   * The main agent's context window as it stands (the owner's words of 10-19: "since the last compaction to the last
   * round even in a running turn"), for a sub-agent's view `window`. Where Filament's loop runs the turn, its request as
   * it stands (`messages`, the registry's): exact — the summary the window starts from, the turns since and this
   * turn's rounds, as they were sent. Else rebuilt from the archive and the run's log: the finished turns since the
   * last compaction as the next request carries them — in the form asked on Filament's loop, whole for a coding agent,
   * which keeps its own — then the turn running now from its own newest compaction on (`runningView`), every
   * round whole, a call by its target and a result by its first lines. A coding agent that compacted its own context
   * in the running turn and gave its summary holds no finished turn any more: that summary stands for them. Tool
   * results are whole wherever the source keeps them. Fit to half the reader's window (`model`; none: as it is), the
   * oldest part left out past it. Local: no model is called, nothing is written.
   * @typedef {{ text: string, turns: number, turn: number, exact: boolean, cut: boolean, mark: { run: string | null, event: number }, waiting: WaitingView | null }} WindowView
   *   `turns`: the finished turns it holds; `turn`: the newest finished turn's number; `exact`: it is the loop's
   *   request; `cut`: its oldest part was left out; `mark`: where a later look at the running turn starts
   * @param {string} id @param {{ messages?: any[] | null, model?: string | null }} [o]
   * @returns {Promise<WindowView>}
   */
  async function windowView(id, { messages = null, model = null } = {}) {
    const chain = chainOf(id);
    const completed = modelTurns(chain.id);
    const turn = Number(completed.at(-1)?.n) || 0;
    const head = compactionHead(compactionsOf(chain.id));
    const live = runningView(chain, null, { whole: true });
    const exact = Array.isArray(messages) && messages.length > 0;
    // Its own compaction in the turn running now left the agent none of the finished turns.
    const own = !exact && live?.compacted?.own && live.compacted.summary ? live.compacted : null;
    let turns = own ? 0 : completed.filter((/** @type {any} */ t) => Number(t.n) > (Number(head?.to_turn) || 0)).length;
    let text = "";
    if (exact) text = messagesTranscript(/** @type {any[]} */ (messages), Infinity);
    else {
      const done = own ? null : await contextView(chain.id, "plain", { resultChars: Infinity });
      if (!done?.text) turns = 0;
      text = [done?.text || "", live?.text ? `[Filament: the turn running now, as its run's log stands — a call by its target, a result by its first lines:]\n\n${live.text}` : ""].filter(Boolean).join("\n\n");
    }
    const reader = parseAgentModel(String(model || ""))?.model || String(model || "");
    const room = reader ? Math.floor(((sessionWindowFor(config.get(), reader, null).tokens) || RECORD_WINDOW) / 2) : 0;
    const cut = room > 0 && estimateTokens(text) > room;
    return {
      text: cut ? `…[Filament: the oldest part of the window is left out, to fit yours]\n${tailWithinTokens(text, room)}` : text,
      turns,
      turn,
      exact,
      cut,
      mark: { run: live?.run ?? null, event: live?.event ?? 0 },
      waiting: waitingView(chain),
    };
  }

  /**
   * The full record of a chat a team's lead starts from (team_v2_plan §5.3, TV2-D4): its finished turns as the
   * composer builds a request from them, compactions as they stand — the fullest form that fits half the lead's
   * window (§9 Q4), the oldest part left out where none does — then its running turn as far as the run log has it, and
   * the question it waits on. Local: no model is called, nothing is written.
   * @param {string} id @param {{ model: string, team: string }} o  `model`: the lead's, whose window it fits
   */
  async function recordFor(id, { model, team }) {
    return (await recordParts(id, { model, team })).text;
  }

  /**
   * Blocks a chat's next turn waits for and sets in ahead of the person's words, by chat (`openingAfter`).
   * @type {Map<string, { block: Promise<any>, taken: () => void }>}
   */
  const openings = new Map();
  /**
   * A block the chat's next turn waits for before it is sent, set in after its record and a flow's hand-off, ahead of
   * the person's words (the plan's p6: a hunt's range, read from git as its lead starts, so its fire need not wait):
   * `block` resolves to it, or to null for none; a stop while it waits stops the turn. → `taken`, which resolves once
   * a turn holds the chat and waits for it; `drop`, which lets go of one no turn took.
   * @param {string} id @param {Promise<any>} block
   */
  function openingAfter(id, block) {
    /** @type {() => void} */
    let taken = () => {};
    const took = new Promise((r) => (taken = () => r(undefined)));
    openings.set(id, { block, taken });
    return { taken: took, drop: () => void (openings.get(id)?.block === block && openings.delete(id)) };
  }

  /**
   * A hunt's range as this chat's folder holds it (app/hunt-range.js, the plan's p6): none named, what is uncommitted
   * and the files this chat changed — read from its turns' rounds from its first on, as a rewind reads "the files this
   * chat changed from turn n on" — else the diff, commits or files named. Read-only: nothing is written.
   * @param {string} id @param {unknown} spec @param {{ label?: string }} [o]  `label`: what a list of files is, in words
   */
  async function huntRange(id, spec, { label = "" } = {}) {
    const chain = chainOf(id);
    const rounds = roundsFrom(memory.roundsOf(chain.id).rounds, 1);
    const alone = memory.placesAlone ? memory.placesAlone(chain.id, rounds.map((/** @type {any} */ r) => r.place)) : null;
    return resolveRange({ folder: cwdOf(chain) || null, spec, rounds, alone, label });
  }

  /**
   * What a team's lead would read of a chat, said before Send (the Brief's What its lead reads, team_v2_plan §10 O1):
   * the record as recordFor builds it, its size, the finished turns it holds and how, the running turn's rounds, a
   * question waiting, the chat's compactions and the lead's window. Local: no model is called, nothing is written.
   * @param {string} id @param {{ model: string, team: string }} o
   */
  async function recordFacts(id, { model, team }) {
    const r = await recordParts(id, { model, team });
    return {
      text: r.text,
      tokens: estimateTokens(r.text),
      turns: r.turns,
      form: r.form,
      cut: r.cut,
      running: r.running ? { rounds: r.running.rounds } : null,
      waiting: !!r.waiting,
      compactions: compactionsOf(chainOf(id).id).length,
      window: r.window,
    };
  }

  /** recordFor's parts: the block and what went into it. @param {string} id @param {{ model: string, team: string }} o */
  async function recordParts(id, { model, team }) {
    const chain = chainOf(id);
    const inner = parseAgentModel(String(model || ""))?.model || String(model || "");
    const window = (inner && sessionWindowFor(config.get(), inner, null).tokens) || RECORD_WINDOW;
    const budget = Math.floor(window / 2);
    const runningNow = runningView(chain, null);
    const waiting = waitingView(chain);
    // The running turn: its newest round whole; a quarter of the budget at most, its oldest part left out past it.
    const runRoom = Math.floor(budget / 4);
    const running = runningNow?.text ? { rounds: runningNow.rounds, tools: runningNow.tools, text: estimateTokens(runningNow.text) > runRoom ? `…\n${tailWithinTokens(runningNow.text, runRoom)}` : runningNow.text } : null;
    // Its task graph as it stands now, whole while it has open tasks (g3b, the owner's of 11-09): the turns hold it only
    // as tasks calls as old as they are. By itself: a lead reads the whole chat, and nothing has to remember to ask. As a
    // compaction hands it back — what is kept behind its tasks marked, where the main agent stands after it — and, as the
    // running turn, a quarter of the budget at most, its oldest part left out past it.
    const whole = openGraphText(chain.meta?.graph, "agent", graphKept?.(chain.id) ?? null, graphWhere?.(chain.id, "agent") ?? null);
    const graph = whole && estimateTokens(whole) > runRoom ? `…\n${tailWithinTokens(whole, runRoom)}` : whole;
    const fixed = estimateTokens(`${running?.text || ""}${waiting ? waiting.question + waiting.said : ""}${graph || ""}`) + 600;
    /** @type {{ form: string, text: string, turns: number }} */
    let pick = { form: "plain", text: "", turns: 0 };
    for (const form of RECORD_FORMS) {
      const v = await contextView(chain.id, form);
      pick = { form, text: v?.text || "", turns: v?.turns || 0 };
      if (estimateTokens(pick.text) + fixed <= budget) break;
    }
    const cut = estimateTokens(pick.text) + fixed > budget;
    const text = cut ? `…\n${tailWithinTokens(pick.text, Math.max(0, budget - fixed))}` : pick.text;
    const block = recordBlock({ team, title: chain.title || "", turns: pick.turns, text, form: pick.form, cut, running, waiting: waiting ? { question: waiting.question, said: waiting.said } : null, graph });
    return { text: block, turns: pick.turns, form: pick.form, cut, running, waiting, window };
  }

  /**
   * A team beside's chat as its card reads it (team_v2_plan §5.3): whether a turn holds it, whether a question waits
   * for the person, and its newest turn — its reply's words where it ended with one, and whether a restart or a clean
   * stop cut it (the start marks a team's turn either cut, resume-cut.js `resumePlan`). A main chat's too, as a flow
   * it drives In place reads its turn's end (HarnessV4_OneAgent_Plan OA4): whether it failed and why, and whether the
   * person stopped it. A turn failed with no reply: the failure it kept with its work, or — one that failed before it
   * did any — its newest request's, which its facts keep as the page reads it.
   * A team's card is looked at again as its workers move: the chat's head and the two keys of its meta read here
   * (its parked question, its last stop), and its newest turn alone. `turns`, how many it has, is counted where it is
   * read.
   * @param {string} id
   */
  function besideFacts(id) {
    const a = archive();
    const head = headOf(id);
    const chain = { ...head, meta: a.metaOf(head.id, ["paused", "lastStop"]) };
    const busy = !!sessionTurns?.holder(chain.key) || liveTurns.has(chain.id);
    const last = a.turnBodies(chain.id, { last: 1 })[0] || null;
    const final = last?.final ? textOfMessage(last.final).trim() : "";
    const failure = !last || final ? null : last.meta?.failed ? String(last.meta.failed.cause || "") : last.meta?.facts?.error ? String(last.meta.facts.error) : null;
    const facts = {
      busy,
      asking: !!waitingNow(chain),
      last: last
        ? {
            n: Number(last.n) || 0,
            final: !!final,
            text: final,
            cut: cutOffBefore(last, bootAt) || !!last.meta?.cut,
            failed: failure != null,
            why: failure || "",
            stopped: !!last.meta?.stopped || (Number(chain.meta?.lastStop?.turn) > 0 && Number(chain.meta.lastStop.turn) === Number(last.n)),
            endedAt: Number(last.endedAt) || null,
            // The pictures drawn in it — its lead's and its crew's (HarnessV4_DesignPass_Plan, case 13): a team's result
            // names them to the agent it reaches, which opens one by its name.
            drew: (Array.isArray(last.meta?.visuals) ? last.meta.visuals : []).filter((/** @type {any} */ v) => v?.id).map((/** @type {any} */ v) => ({ id: String(v.id), title: String(v.title || ""), bytes: Number(v.bytes) || 0, turn: Number(last.n) || 0 })),
          }
        : null,
    };
    return lazy(facts, "turns", () => a.turnOutline(chain.id).length);
  }

  /**
   * Where a chat's lead is now, for a team's board on its main chat's Teams tab (team_v2_plan §10 O2): read off its
   * running turn's run log (`leadNow`) — its rounds, its newest words, its newest round's calls — with what the chat
   * has spent; with no turn running, its newest turn's reply as its words. Local: nothing is written.
   * @param {string} id
   * @returns {{ running: boolean, rounds: number, words: string, calls: { name: string, subject: string, open: boolean }[], startedAt: number | null, usd: number }}
   */
  function leadFacts(id) {
    const chain = chainOf(id);
    const usd = usageOf(chain).usd;
    const log = /** @type {any} */ (runs);
    const live = liveRunOf(chain);
    if (live && log?.events) return { running: true, ...leadNow(eventsOf(log, live.id)), startedAt: Number(live.startedAt) || null, usd };
    const last = archive().turnBodies(chain.id, { last: 1 })[0] || null;
    const text = last?.final ? textOfMessage(last.final).trim() : "";
    return { running: false, rounds: 0, words: text.length > LEAD_WORDS_CHARS ? `…${text.slice(-LEAD_WORDS_CHARS)}` : text, calls: [], startedAt: null, usd };
  }

  /**
   * A team beside fired, or its result in (team_v2_plan §5.4): recorded on its main chat with the turn it follows, so
   * the transcript draws its card there — now and after a restart. The newest TEAM_MARKS are kept.
   * @param {string} id @param {{ event: "fired" | "result", id: string, at: number }} mark
   */
  function teamMark(id, mark) {
    const chain = chainOf(id);
    const a = archive();
    return a.appendMeta(chain.id, "teamMarks", { ...mark, afterTurn: a.newestTurnN(chain.id) }, TEAM_MARKS);
  }

  /**
   * Where a sub-agent launched from this session works, its model unless told otherwise, and the client the session
   * runs in: a team's worker asks the developer only where that client's page can answer. `full`: the model as the chat
   * names it, a coding agent's with its agent — what a team beside's lead runs on where nothing else is named.
   * Read off the chain's head and the two keys of its meta that place it — its meta is not parsed whole for it, nor the
   * Settings page's answer built: the registry asks it at every launch and every poll of the chat's agents. The client
   * is read where it is read (the archive's head does not carry it): a worker's host asks it, once a run.
   * @param {string} id
   */
  function launchInfo(id) {
    const a = archive();
    const head = a.chainHead(String(id || ""));
    if (!head) return null;
    const modelName = String(effectiveOf(head.id).model?.name || head.model || "").trim();
    const info = { cwd: cwdOf({ project_id: head.project_id, meta: a.metaOf(head.id, ["tree", "cwd"]) }), model: parseAgentModel(modelName)?.model || modelName, full: modelName, projectId: head.project_id || null, kind: head.kind || null };
    return lazy(info, "client", () => /** @type {string | null} */ (a.getChain(head.id)?.client || null));
  }

  /**
   * Fork: the memory fork (turns ≤ atTurn by hash, optional worktree) plus the session layer, so the fork runs under
   * the same document (§5.7 `fork.settings: inherit`), then the fork strategy (§6.7) on the inherited turns: `ditto`
   * none · `folds` every one folded, as one fold compaction of them all · `brief` one lineage summary as a compaction
   * row, which stands for every inherited turn. Neither row is undone: it is how the fork began.
   * `results` starts the fork's document with that policy. Nothing is rewritten; the fork's window is a rendering.
   * `plan`: the chat's plan goes with it (the owner's plan mode of 11-06, piece E) — its task graph, with the notes and
   * files kept behind it, and it closes here; refused before the fork is made where it cannot go now. → `plan`: what
   * went, or why it did not after all.
   * @param {string} id @param {{ atTurn: number, worktree?: boolean | string, strategy?: string | null, results?: string | null, settings?: string | null, plan?: boolean }} args
   */
  async function fork(id, { atTurn, worktree = false, strategy = null, results = null, settings: settingsMode = null, plan = false }) {
    const chain = chainOf(id);
    const n = Number(atTurn);
    if (!Number.isInteger(n) || n < 1) throw refusal(400, "atTurn must be a whole number ≥ 1");
    const eff = effectiveOf(chain.id);
    const transcriptMode = String(strategy || eff.fork?.transcript || "ditto");
    if (!FORK_TRANSCRIPTS.includes(transcriptMode)) throw refusal(400, `strategy must be one of ${FORK_TRANSCRIPTS.join(", ")}`);
    const resultsMode = results == null ? null : String(results);
    if (resultsMode != null && !FORK_RESULTS.includes(resultsMode)) throw refusal(400, `results must be one of ${FORK_RESULTS.join(", ")}`);
    const layerMode = String(settingsMode || eff.fork?.settings || "inherit");
    if (!["inherit", "project"].includes(layerMode)) throw refusal(400, "settings must be inherit or project");
    // The archive refuses the same two cases inside the transaction; judged here first so the answer is a 400/409
    // rather than a 500, and before `brief` spends a model call.
    const upTo = archive().getTurns(chain.id, { to: n });
    const lastN = upTo.length ? Number(upTo[upTo.length - 1].n) : 0;
    if (lastN < n) throw refusal(400, lastN ? `the session has ${lastN} turn${lastN === 1 ? "" : "s"}; cannot fork at turn ${n}` : "the session has no turns to fork from");
    if (upTo[upTo.length - 1].ended_at == null) throw refusal(409, `turn ${n} is still open (no final answer yet); fork at a finished turn`);
    // The plan goes only from where it stands: the chat's newest turn, nothing of it at work here.
    if (plan) {
      if (!plans?.carry || !plans.carryRefusal) throw refusal(400, "this Filament carries no plan into a new chat");
      const newest = archive().getTurns(chain.id).at(-1);
      if (newest && Number(newest.n) !== n) throw refusal(409, "the plan goes on from where it stands: fork at the chat's newest turn to carry it");
      const why = plans.carryRefusal(chain.id) || busyOf(chain);
      if (why) throw refusal(409, why);
    }
    // `brief` needs the lineage summary before the fork exists (a model call that may fail): written first, so a
    // failure leaves no half-made fork behind. It continues from the newest summary the session has of the turns up
    // to the fork point — one a coding agent wrote in the middle of a later turn knows that turn, and is passed over —
    // and reads the turns since; with none since, that summary is the brief.
    let brief = null;
    if (transcriptMode === "brief") {
      const modelName = String(eff.model?.name || chain.model || "").trim();
      const inner = parseAgentModel(modelName)?.model || modelName;
      const before = compactionsOf(chain.id).filter((c) => Number(c.to_turn) <= n && (madeDuring(c) ?? 0) <= n);
      const turns = adaptForCompose(modelTurns(chain.id).filter((t) => t.n <= n), eff, chain, before);
      const { head, inWindow } = copyWindow(turns, before);
      if (head && !inWindow.length) brief = { text: String(head.text), model: head.detail?.model || null, how: "kept" };
      else {
        const lead = head ? earlierOf(head) : null;
        const folded = !!agentSessionOf(config.get(), inner);
        const writer = summaryWriter(eff, inner, [summaryTranscript(lead, inWindow, folded)]);
        const { text, how } = await compactor.writeSummary({ chain, list: inWindow, lead, whole: false, writer, folded });
        if (!text) throw refusal(502, "the summary model returned nothing; the fork was not made");
        brief = { text, model: writer.model, how };
      }
    }
    // The fork is the harness's own chat, keyed as `create` keys one.
    const out = await forkSession(chain.id, { atTurn: n, worktree });
    const forkId = out?.chainId;
    if (forkId) archive().rekeyChain(forkId, `n:${forkId}`);
    /** @type {{ transcript: string, results: string | null, settings: string, shaped: number, brief: { chars: number } | null }} */
    const applied = { transcript: transcriptMode, results: resultsMode, settings: layerMode, shaped: 0, brief: null };
    if (forkId) {
      const a = archive();
      // The fork's own layer: forkChain carried the source's over (HarnessV3 Step 1).
      const layer = layerMode === "inherit" ? a.chainSettings(forkId) : {};
      const next = structuredClone(layer || {});
      if (resultsMode) next.context = { ...(next.context || {}), results: resultsMode };
      // Always accept in this chat is the chat's alone (the review of fe6b8d579): a fork asks on its card again.
      const ownParallel = next.subagents?.parallelize != null;
      if (ownParallel) {
        delete next.subagents.parallelize;
        if (!Object.keys(next.subagents).length) delete next.subagents;
      }
      // The fork's own layer names its model when the source's did not (a session opened from another client's chain).
      if (Object.keys(flatten(next)).length) a.setChainSettings(forkId, next);
      else if (layerMode === "project" || ownParallel) a.setChainSettings(forkId, null);
      a.mergeMeta(forkId, { native: true, cwd: cwdOf(chain), forkStrategy: { transcript: transcriptMode, results: resultsMode || undefined } });
      memory.assertPrivacy(forkId);
      const inherited = modelTurns(forkId);
      if (transcriptMode === "folds" && inherited.length)
        applied.shaped = a.compactTurns(forkId, { turnIds: inherited.map((t) => t.turnId), shape: "fold", kind: "fork", method: "fold", fromTurn: inherited[0].n, toTurn: inherited[inherited.length - 1].n, window: "harness", detail: { model: null, how: "local" } }).marked;
      if (transcriptMode === "brief" && brief) {
        const toTurn = inherited.length ? inherited[inherited.length - 1].n : n;
        a.addCompaction(forkId, { fromTurn: 1, toTurn, summaryText: brief.text, kind: "brief", window: "harness", method: "summary", detail: { model: brief.model, how: brief.how } });
        applied.brief = { chars: brief.text.length };
      }
      if (transcriptMode !== "ditto" || resultsMode)
        ops.record("archive", `session ${forkId}: forked from ${chain.id} at turn ${n} as ${transcriptMode}${resultsMode ? `, results ${resultsMode}` : ""}`, {
          sub: "fork-strategy",
          detail: { chainId: forkId, from: chain.id, atTurn: n, ...applied },
          ref: { chainId: forkId },
        });
    }
    // The plan, carried (piece E): the fork exists by now, so a carry that fails says why beside it. Judged again as it
    // goes (the review of 58cfe9b31): a turn that began while the brief was written, or ran, keeps the plan here.
    const late = plan && forkId ? busyOf(chain) || (Number(archive().getTurns(chain.id).at(-1)?.n) !== n ? "a turn of this chat ran meanwhile" : null) : null;
    const carried = plan && forkId && plans?.carry ? (late ? { ok: false, error: `${late}: the plan stays in this chat` } : plans.carry(chain.id, forkId, { title: String(chain.title || ""), toTitle: String(archive().getChain(forkId)?.title || chain.title || "") })) : null;
    return { ...out, settingsCopied: layerMode === "inherit", strategy: applied, ...(carried ? { plan: carried } : {}) };
  }

  /**
   * The recall row (§6.4): what `filament_recall` would answer, for the inspector and for tests.
   * @param {string} id @param {{ turn?: any, result?: any }} input
   */
  function recallFor(id, input) {
    const chain = chainOf(id);
    if (input?.turn != null) {
      const r = recallTurn(archive(), chain.id, Number(input.turn));
      if (!r) throw refusal(404, `no turn ${input.turn} in this session`);
      return { ok: true, ...r };
    }
    const text = recallFromArchive(archive(), chain.id, input || {});
    if (text.startsWith("{")) {
      try {
        const j = JSON.parse(text);
        if (j.error) throw refusal(404, j.error);
      } catch (e) {
        if (/** @type {any} */ (e)?.status) throw e;
      }
    }
    return { ok: true, text, chars: text.length };
  }

  /**
   * What the loop's system prompt would end with under the session's document as it stands (HarnessV2 §5.6): the
   * instruction files found and missing, the session text, the skills catalogue — for the inspector and the skills
   * panel. Reads the files now; the turn reads them again when it runs.
   * @param {string} id
   */
  function instructionsFor(id) {
    const chain = chainOf(id);
    const cwd = cwdOf(chain);
    if (!cwd) throw refusal(409, "the session has no working folder on record");
    const eff = pluginsIn(effectiveOf(chain.id), { project: chain.project_id, chat: chain.id, cwd });
    const skillSet = loadSkills(eff);
    const block = instructionsBlock(eff, cwd, { extra: skillsSections(skillSet.skills, { plugins: skillSet.plugins }) });
    return {
      cwd,
      files: block.files,
      missing: block.missing,
      sessionChars: block.sessionChars,
      hash: block.hash,
      chars: block.text.length,
      text: block.text,
      skills: { on: onNames(eff), list: skillSet.skills.map((k) => ({ name: k.name, description: k.description, triggers: k.triggers, path: k.path, folder: k.folder, chars: k.chars })), problems: skillSet.problems },
    };
  }

  /**
   * The skills a chat offers its coding agent's skill tool (HarnessV4_Skills_Plan S1-1), as its document stands now —
   * its skills and its plugins on — with the folder it works in. Null for a chat with no folder on record.
   * @param {string} id
   */
  function skillsOf(id) {
    const chain = chainOf(id);
    const cwd = cwdOf(chain);
    if (!cwd) return null;
    const eff = pluginsIn(effectiveOf(chain.id), { project: chain.project_id, chat: chain.id, cwd });
    return { ...loadSkills(eff), cwd };
  }

  return {
    recallFor,
    instructionsFor,
    skillsOf,
    create,
    check,
    folderProject,
    draftStart,
    projectSettingsOf,
    worktreeTemplate,
    saveWorktreeTemplate,
    turn,
    cancelTurn,
    useInTurn,
    offerFlowInTurn,
    offerPlanInTurn,
    /** The chats whose harness turn runs now: a clean stop notes them (HarnessV3-TaskGraph-v2 TG2-D85). */
    running: () => [...liveTurns.keys()],
    skipWait,
    ownTurn,
    transcript,
    turnWork,
    callChange,
    callResult,
    turnVisual,
    sessionVisual,
    turnRuns,
    subagentMark,
    pageSaid,
    saveSubagentQueue,
    loadSubagentQueue,
    saveSubagentHeld,
    loadSubagentHeld,
    saveSubagentThread,
    forgetSubagentThread,
    forgetKeptTexts,
    keptTextLists,
    loadSubagentThreads,
    settingsOf,
    effectiveOf,
    patchSettings,
    setWindow,
    lineOf,
    forgetRule,
    alwaysAllow,
    alwaysAllowInChat,
    stopAgentTask,
    forgetProjectRule,
    settingsHistory,
    preview,
    contextView,
    windowView,
    recordFor,
    recordFacts,
    huntRange,
    openingAfter,
    besideFacts,
    turnRead,
    wakeOf,
    turnPatch,
    leadFacts,
    teamMark,
    sinceMessage,
    /**
     * Whether a question the session's turn paused on waits for the person's answer (`askingNow`), watched for its lapse
     * from this look on (`watchLapse`): what the registry holds for it goes when it ends. @param {string} id
     */
    asking: (id) => !!watchLapse(String(id)),
    launchInfo,
    patchProjectSettings,
    defaultsOf,
    patchDefaults,
    compact,
    blockAfterOwn,
    skillsLoaded,
    stopCompaction,
    compactionsNow,
    stretchesNow,
    stretchCheck,
    /** Whether a driving goal's next round is owed to a chat (core/goal-drive.js): the round's waker asks. @param {string} chainId */
    goalOwed: (chainId) => goalOwed.has(String(chainId)),
    /**
     * The round's waker let go of a chat with no round sent (wake.js `idle`). `gaveUp`: its post was refused for good,
     * threw, or a turn held the chat throughout — the round is owed no more (the review of 11-11: it stayed owed, and the
     * chat read as waiting on it until Filament restarted), and the end of the chat's next turn decides again. Not where
     * room is being made, whose end asks for it again. Its work stretch is weighed either way.
     * @param {string} chainId @param {boolean} gaveUp
     */
    goalLetGo: (chainId, gaveUp) => {
      if (gaveUp) goalOwed.delete(String(chainId));
      stretchCheck(String(chainId));
    },
    /**
     * A goal's round the chat kept owed as Filament last stopped, owed again as it starts (sessions/owed-wakes.js): its
     * waker asks for it once the start sweeps. Not where its drive no longer drives, nor where its time ran out while
     * Filament was not running, which halts it as a turn's end would (core/goal-drive.js DRIVE_MS), its line telling the
     * agent at its next turn. @param {string} chainId @returns {boolean}  whether it is owed
     */
    oweGoal: (chainId) => {
      const id = String(chainId);
      const drive = driveOf(memory.goalFor?.(id));
      // Owed no more either way, kept so too: the set never held it, so its delete would keep nothing (FabeleHelper's).
      if (!drive || drive.halted) return (keepGoalOwed(id, false), false);
      if (typeof drive.since === "number" && now() - drive.since >= DRIVE_MS) return (haltGoal(id, { kind: "time" }), keepGoalOwed(id, false), false);
      goalOwed.add(id);
      return true;
    },
    /**
     * Whether the person stopped the chat's newest turn and no turn has begun since (`stoppedSince`): Filament starts
     * its agent by itself for nothing then (FO-D50) — the start's sweep wakes it for nothing it was owed. @param {string} chainId
     */
    stoppedNow: (chainId) => {
      const meta = archive().metaOf(String(chainId), ["lastStop"]);
      return !!meta && stoppedSince({ id: String(chainId), meta });
    },
    /** Why Filament starts no turn by itself in the chat now, or null (`notByItself`): the start's sweep and its plan of the cut turns ask, as the wake's gate does. @param {string} chainId */
    notByItself: (chainId) => notByItself({ id: String(chainId), meta: archive().metaOf(String(chainId), ["archived"]) }),
    /**
     * When the person last wrote in the chat, as the start's cutoff measures it (owed-wakes.js `staleWords`): the moment
     * kept as their message came (`personAt`); for a chat that kept none — one from before chats kept it —, when its
     * newest turn that Filament did not start by itself began (`turnAt`, `fromThePerson`, of its newest PERSON_LOOK
     * turns), so Filament's own turns in a chat the person left make it no fresher (the review of 11-11: the chat's
     * `last_at` stood in, which every turn moves). A chat that holds no turn of theirs there — one Filament made for a
     * routine's run, an ask's, a thread, each begun by Filament — says when its first turn began (`beganAt`): the
     * cutoff measures such a chat from when it was given its work. 0 where nothing says. @param {string} chainId
     * @returns {{ personAt: number, turnAt: number, beganAt?: number }}
     */
    personLast: (chainId) => {
      const id = String(chainId);
      const personAt = Number(archive().metaOf(id, ["personAt"])?.personAt) || 0;
      if (personAt) return { personAt, turnAt: 0 };
      const since = bySince();
      const turnAt = Number(archive().turnBodies(id, { last: PERSON_LOOK }).findLast((t) => fromThePerson(t, since))?.startedAt) || 0;
      return turnAt ? { personAt: 0, turnAt } : { personAt: 0, turnAt: 0, beganAt: Number(archive().getTurns(id, { from: 1, to: 1 })[0]?.started_at) || 0 };
    },
    idleHeld,
    /** Every chat's check-in that is due (idle-wake.js): the holders read's, for the page. */
    idleWakesNow: () => idleWake?.list() ?? [],
    /**
     * The person stopped the chat: its idle wake dropped, its back-off from the start, and a check-in that waits untold
     * goes too (hands.js `dropIdleNotes`). @param {string} chainId
     */
    idleStop: (chainId) =>
      idleStep(String(chainId), () => {
        idleWake?.stopped(String(chainId));
        dropIdleNotes(String(chainId));
      }),
    holdGoal,
    /**
     * The person wrote in the chat outside a message of theirs — a note they typed into its running turn (the steer
     * route, FabeleHelper's of 11-10) —: kept as when they last wrote, as their message keeps it (`personWrote`).
     * @param {string} chainId
     */
    personNoted: (chainId) => keepPersonAt(String(chainId)),
    undoCompaction,
    rewindPreview,
    rewindTo,
    undoRewind,
    autofit,
    fork,
    /**
     * Where the chat would move and what would go with it (HarnessV4_Git_Plan §12, GW-D84); a client's chat is refused
     * as its move is, so the sheet says so before it draws a plan.
     * @param {string} id @param {Parameters<typeof chatMove.read>[1]} to
     */
    moveRead: async (id, to) => chatMove.read(ownChat(id, "the harness moves a fork of it").id, to),
    /**
     * Move the chat to another place, its own uncommitted files with it (GW-D71); a client's chat works in its client's
     * folder, so the harness moves a fork of it.
     * @param {string} id @param {Parameters<typeof chatMove.move>[1]} o
     */
    move: async (id, o) => chatMove.move(ownChat(id, "the harness moves a fork of it").id, o),
    /** Take its newest move back (GW-D79). */
    moveBack: chatMove.back,
    /** @param {string} id */
    live: (id) => {
      const head = archive().chainHead(String(id || ""));
      return head ? liveOf(head) : null;
    },
    liveState,
    liveCount: () => (sessionTurns ? sessionTurns.count : liveTurns.size),
  };
}
