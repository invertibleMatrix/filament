// @ts-check
// Sub-agents (HarnessV3 §15 item 86): a fresh agent loop on one task, launched by
// the agent (the loop's `agent` tool), by the developer (the harness's spawn widget, the REST endpoints) or by
// `/subagent` typed in a chat Filament runs. The registry is process-wide. Each sub-agent is its own request through Filament's
// front door — `agent/<model>` carrying the launching session's chain, so it runs under that session's settings
// (tools, rules, hooks, instructions, MCP) — which makes it a record of its own on Traffic and the tray (source
// `subagent`) and a run of its own in the run log (kind `subagent`), its model calls under it. turn.js serves that
// request in host mode (`hostOf`), relays its tool events here (`relay`) and reports how it ended (`finish`).
//
// A sub-agent runs in the foreground (its launcher waits for the report) or in the background (the report is
// delivered later: into the launching session's running loop at its next round, else queued for the session's next
// turn). It keeps its conversation, so a follow-up (`agent_id`) continues the same context; its session keeps what was
// said — each message and answer — and the conversation itself as each exchange ends, so after a restart it is there
// again and its next message goes on in it (10-26); where a restart cut its exchange, or the conversation is not there
// whole, its next message starts a fresh agent that reads what was said (HarnessV4_Tasks E15 step 5, BW-10). The
// developer's own launches can hold the session's running turn until they report (`pause` — only a turn that runs at
// the launch can be held), tell that loop at once what was launched and why (`inform`), or stay aside: the report is
// the developer's until they `send` it on. Their launches and reports are marked in the session's transcript: on the
// running turn's timeline, or between turns when none runs. `enhance` rewrites a task with the main agent's context
// through a fork of its newest request while the provider still caches it — during a turn or after — and nothing of
// the fork goes back into the conversation.
//
// A team's workers (HarnessV3-AtHome P2) are sub-agents in a role, launched by the team's lead through the team's
// tools (team-tools.js), which hand plain JSON: the registry finds the lead's turn by its run (AH-O10). A worker always
// runs in the background, never as a fork, and its report reaches the lead like any other. The registry keeps each
// running exchange's progress from its run's events — the lead's watch — and puts it on the events feed as it
// changes, for the Team view's cards (HarnessV3-Views V3); it carries the lead's messages and stops to a worker's run
// (AH-O5). A worker in a harness session asks the developer: its call waits in place while the registry holds the
// question, which the session's route answers. So does a sub-agent the developer launched themselves, from the page or
// by a command: the question stands in its thread in the Sub Agents tab (HarnessV4_Tasks E15 step 5, AG-165).
//
// A lead's apply of a worker's change is checked (HarnessV3-TaskGraph-v2 TG2-D55): one at a time into a repository,
// Filament runs the folder's checks in a worktree of a snapshot of the folder after it, and undoes an apply that broke
// one, the change going back to its worker rebased onto the folder. The verdict is the apply's answer, or — past the
// time a call may be held — a message at the lead's door. The developer's applies are never checked or held.
//
// A task of the session's task graph (HarnessV3-TaskGraph G2) is done by a sub-agent its runner launches
// (graph-runner.js): its brief is its task, it never forks and takes no follow-up, and its `report` ends it. Its end goes
// to the runner with what Filament saw — its worktree's change and the commands it ran with their exits — never to the
// main agent as a report: the runner moves the task on and tells the agent in the graph's words.
//
// A lead that reads along with its workers (HarnessV3-TaskGraph-v2 §12, `engine.supervise`): its turn opens with its
// looks (looks.js), and each worker that starts under it keeps a mark — what its lead has seen of its run — fed from
// its run log's events (`attach`). A look rides the turn's inbox behind the reports, made when it is read and never
// kept; a due one rings the turn as a report does.
import { randomBytes } from "node:crypto";
import { readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInternalCall } from "../internal-call.js";
import { CHAIN_HEADER } from "../../core/conversation.js";
import { redactSecrets } from "../../core/redact.js";
import { clip, cut, durationWords, keptWords, listed } from "../../core/text.js";
import { findingsOf, mergeFindings, mergedWords } from "../../core/beside.js";
import { callLog } from "../../core/messages.js";
import { callLines, kindOfName, pathsWritten, toolsOfTurn } from "../../core/tool-vocab.js";
import { wireFormatOf } from "../../core/turn-adapter.js";
import { cutReportOfRun } from "../../core/run-work.js";
import { isArtifactName } from "../../core/artifacts.js";
import { parseModelSuffix } from "../../core/shaping.js";
import { callRoom, outputCeiling } from "../../core/routing.js";
import { imageBlock } from "../../core/media.js";
import { attachments, fileBlocks } from "./attach.js";
import { estimateBodyTokens, estimateTokens, fittedMaxTokens } from "../../core/tokens.js";
import { agentsPage, teamsOn } from "../../core/teams-on.js";
import { SUBAGENT_VIEWS, WINDOW_VIEW, globalLayer, mainEffortOf, mcpServerProblem, resolveSettings, sessionEngineOf, teamEffortOf, teamWorkersOf } from "../../services/session-settings.js";
import { teamKey } from "../../services/teams.js";
import { CARD_MAY, CARD_TOOLS, askablesOf, cardsNamedIn, mayLower, placesOf, shippedCard } from "../../services/agent-cards.js";
import { foldedCard, foldedWords, isShippedRoster, memberCard, retiredWords } from "../../core/roster.js";
import { newWatchState, uncheckedAt, watchStep } from "../../core/watch.js";
import { MERGE_RETURNS, commandPassed } from "../../core/task-graph.js";
import { byCardProblem, byTeamProblem, poolName, poolNote, poolOf, poolProblem, poolRoom, poolTotal, seatFree, seatsOf, slotsBusy, takeSeat, waitSeat } from "../../core/pool.js";
import { slotFree, slotOf, slotWords, slotsOf } from "../../core/slots.js";
import { SUBAGENT_EFFORTS } from "../../core/schema.js";
import { changeSource } from "../sessions/changes-view.js";
import { sideLineOf } from "../sessions/compaction.js";
import { ASSUMED_WINDOW } from "../sessions/compactor.js";
import { sessionWindowFor } from "../../core/model-families.js";
import { CHOICES, DEPENDENCY_DIRS, MARK_KEPT_MS, applyTaskWork, compareApply, copyFacts, copyHeldBy, fetchLfsFile, foundWhole, previewApply, captureTaskWork, changedFiles, diffTaskWork, dropMarkHold, dropTaskRefs, folderSnapshot, holdMarkedWork, holdCopyCommit, dropCopyCommit, keepTaskWork, letGoHelpers, markApplied, markHolds, markUnsaved, notApplied, openCheckTree, openTaskWorktree, patchRecorded, pruneTaskWorktrees, rebaseMarks, rebaseTaskWork, releaseTaskWorktree, reposOf, resetLane, reviveTaskWorktree, taskRefs, taskWorkSoFar, taskWorktreePath, unholdMarkedWork, untilCopyFree, widenFor } from "../../adapters/git/worktree.js";
import { sparseWords, widenedWords } from "../../adapters/git/sparse.js";
import { cliCommand } from "./environment.js";
import { capturePatch, dropPatch, holdWork, markPatchUnsaved, movesOf, noteMove, openPatch, parkPatch, patchHeldBy, patchSoFar, promotePatch, revivePatch } from "../../adapters/git/patch.js";
import { copyKind, launchPaths, workspaceKind, workspaceSetting, WORKSPACES } from "./workspace-kind.js";
import { hooksFor } from "./hooks.js";
import { repoOf, snapshotExists } from "../../adapters/git/snapshot.js";
import { FILAMENT, createLooks, newMark, noted, ownMessage, patchWords, whoseStop, wroteWords } from "./looks.js";
import { SIDE_BY_SIDE, WRITING_HANDS } from "./loop.js";
import { FOREGROUND_SHELLS, handsIn, launchKinds, madeChange, permissionMode, workerFor } from "./tools.js";
import { PERMISSION_MODES } from "./prompt.js";
import { RETRY_TRIES, withRetries } from "../../core/retry.js";
import { OUT_HOLD_MS, causeWords, holdWords } from "../../core/provider-cause.js";
import { checkCommandsProblem, checkedRefusal, grantsHit, grantsNote, grantsOf, grantsRefusal, refusalWords, runRefusal, teamCheckWhy, withCardRuns, withTeamCheck } from "./grants.js";
import { CHECK_NOT_RUN, CHECK_RETURNS, FOLDER_NOT_CHECKED, MERGE_NOT_CHECKED, TASK_NOT_CHECKED, TASK_NOT_RUN, bounceText, checkRuled, checkWords, failedAlike, failedRun, folderBackText, folderCheckNote, folderRuled, folderTail, stuckText, taskRuled, undoneNote, undoneText, waitingText } from "./check.js";
import { rulesFrom } from "./rules.js";
import { namesOutside } from "../agent-permits.js";
import { runOwnCommand, runningShells, stopShell, tellLater } from "../../adapters/tools/hands.js";
import { SUBJECT_CHARS, envelopeLine, subjectOf } from "./envelopes.js";
import { ANSWERED_THERE, SEND_COPY, UNREACHABLE_AFTER_MS, UNREACHABLE_AGAIN_MS, createRemoteAgents, fencedThere, sendsKept, unreachableWords, wordsThere } from "./remote-agents.js";
import { unnoticed } from "../../core/notices.js";
import { answeredAs } from "../../core/answering-model.js";
import { countedAs } from "../../services/token-calib.js";
import { convoChars, registryCensus } from "../../services/memory-log.js";
import { ONE_AT_A_TIME_WORDS, createHolds, heldWords } from "./held-launch.js";

/** A message's exchange, kept when it names one. @param {{ exchange?: number }} d */
const exchangeOf = (d) => (Number.isInteger(d.exchange) ? { exchange: Number(d.exchange) } : {});
/** A message's envelope fields, kept where it has them (HarnessV4_Envelopes_Plan EN1). @param {Partial<Delivery>} d */
const envelopeOf = (d) => ({
  ...(d.seal ? { seal: true } : {}),
  ...(d.subject ? { subject: String(d.subject) } : {}),
  ...(d.sender ? { sender: String(d.sender) } : {}),
  ...(d.via === "team" || d.via === "flow" || d.via === "chat" || d.via === "steer" || d.via === "agent" ? { via: d.via } : {}),
  ...(Number.isInteger(d.envelope) && Number(d.envelope) > 0 ? { envelope: Number(d.envelope) } : {}),
});
/**
 * What a waiting message's chat still owes it, kept across a restart: a wake (`wakes`) and the words it says (`about`),
 * the telling of a letter (`fresh`). @param {Partial<Delivery>} d
 */
const owedOf = (d) => ({ ...(d.wakes ? { wakes: true } : {}), ...(d.about === "check" || d.about === "command" || d.about === "merge" || d.about === "card" ? { about: d.about } : {}), ...(d.fresh ? { fresh: true } : {}) });
// An envelope's words (HarnessV4_Envelopes_Plan): kept in envelopes.js, which the loop reads too.
export { SUBJECT_CHARS, envelopeLine, sealedListText, subjectOf } from "./envelopes.js";
/** Characters of a task and of a report the page's cards and the registry's views carry (models get them whole). */
const CARD_CHARS = 4000;
/** Characters of each name of what a message carries — a file the main agent attached, a picture — its card is told. */
const ATTACHED_NAME_CHARS = 200;
/**
 * Characters of a task and of a report the page's list of a chat's agents carries of each exchange (`head`; the owner's
 * of 11-17: the largest chat's list was 2.48 MB, 2.28 MB of it its 468 exchanges' words, read again at each move of an
 * agent): its rows draw a line or two of them, and a card opened or a box picked reads them whole.
 */
const HEAD_CHARS = 600;
/** What a report says first where its run ended before it reported (the transcript audit, 2026-10-23). */
const LOGGED_REPORT = "(It ended before it sent a report. From its run's log, what it had written and the calls it made:)";
/**
 * What a report opens with where another model answered than the one its sub-agent was launched on (`otherModel`,
 * core/answering-model.js `answeredAs`): both names, so whoever reads the report knows whose work it is.
 * @param {{ otherModel?: OtherModel | null }} o
 */
export const otherModelLine = (o) =>
  o.otherModel ? `(Filament: this report came from ${o.otherModel.answered}, not ${o.otherModel.chosen}, the model this sub-agent was launched on: its agent answered on another model. Weigh it as ${o.otherModel.answered}'s work.)\n\n` : "";
/** A report's own words, or what its run's log shows where it ended before it reported. @param {Outcome} o @param {string} none  the words for no report */
const reportWords = (o, none) => (o.fromLog ? `${LOGGED_REPORT}\n\n${o.report}` : o.report || none);
/** A report as whoever launched its sub-agent reads it: the model that answered first, where it is another (`otherModelLine`). @param {Outcome} o @param {string} none */
const reportOf = (o, none) => `${otherModelLine(o)}${reportWords(o, none)}`;
/**
 * A report as Filament's own words carry it: one from a sub-agent on another machine fenced, as that machine's words
 * (remote-agents.js `fencedThere`), so nothing in it closes or forges Filament's notice; any other as `reportOf` says it.
 * @param {{ remote?: { machine: { name: string } } | null }} sa @param {Outcome} o @param {string} none
 */
const reportIn = (sa, o, none) => (sa.remote && o.report ? `${otherModelLine(o)}${fencedThere(sa.remote.machine.name, reportWords(o, none))}` : reportOf(o, none));
/**
 * A tool call's card as another machine's run sends it, as this machine's card draws it: its kind, title and subject, in
 * words that open no notice of Filament's (core/notices.js; the xf-words hunt's). @param {any} c
 */
const cardThere = (c) => ({ kind: thereWord(c?.kind, NAME_THERE), title: thereWord(c?.title), subject: thereWord(c?.subject) });
/** How long a call's name, id or card kind from another machine is drawn here. */
const NAME_THERE = 100;
/**
 * Another machine's word on a card here: no notice of Filament's in it, CARD_CHARS at most, or `n` (the swarm's review of
 * 11-10: a call's words there ran as long as that machine sent them). Made one line first, the notice looked for in what
 * the card draws. @param {unknown} s @param {number} [n]
 */
function thereWord(s, n = CARD_CHARS) {
  return unnoticed(clip(s, n));
}
/**
 * A file's path in Filament's words: one of a change from another machine's copy opens no notice and breaks no line.
 * @param {string} p
 */
const pathWords = (p) => unnoticed(String(p).replace(/\p{Cc}/gu, " "));
/** The flags of a tool call's end a card draws (labels.js `endTool`). */
const END_FLAGS = Object.freeze(["refused", "declined", "vetoed", "stopped", "notRun"]);
/**
 * A tool call's end as another machine's run sends it, with the fields this machine's card draws alone — each a word, a
 * number or a flag —: none names a request, a picture, a file or a shell of this machine's. @param {any} e
 */
const toolEndThere = (e) => {
  /** @type {Record<string, unknown>} */
  const out = { id: thereWord(e.id, NAME_THERE), name: thereWord(e.name, NAME_THERE) };
  if (typeof e.ok === "boolean") out.ok = e.ok;
  for (const k of ["ms", "chars", "exitCode"]) if (typeof e[k] === "number" && Number.isFinite(e[k])) out[k] = e[k];
  for (const k of ["preview", "reason"]) if (typeof e[k] === "string" && e[k]) out[k] = thereWord(e[k]);
  for (const k of END_FLAGS) if (e[k] === true) out[k] = true;
  if (e.card) out.card = cardThere(e.card);
  return out;
};
/** How often the registry looks again for room while a worker waits for a slot (team_v2_plan §5.7), ms. */
const SLOT_LOOK_MS = 15_000;
/** How seldom a session's waiting work is read against its folder outside a turn's end (`settleWaiting`), ms. */
const SETTLE_EVERY_MS = 30_000;
/** How long after a session's kept threads could not be read they are read again (`recall`), ms; and how many reads a
 *  start makes of a chat that owes a turn on another machine its stop (`recallCut`). */
const RECALL_AGAIN_MS = 30_000;
const RECALL_TRIES = 5;
/** Sub-agents the registry holds, conversations included, for follow-ups and the viewer; the oldest ended go first. */
const MAX_KEPT = 100;
/**
 * The characters the ended sub-agents' conversations the registry holds may come to in all: past it the oldest ended
 * let theirs go, each keeping its record and its reports, its next message starting fresh from what was said (the
 * owner's of 11-17: a lead's twelve held 251 MB of the server's heap, each conversation whole — 163.8M characters, one
 * of pictures 88.9M). About 150 MB of heap: a team that size keeps most of its threads whole, a sent-back change and
 * its edit cards' diffs with them, and only one past it lets go (Fable 5.2's review of 11-17: at 24M, ten of twelve went).
 */
export const KEPT_CHARS = 100_000_000;
/** Threads a session keeps of its sub-agents across a restart (BW-10): the newest; a running one always; besides them, every one whose work waits. */
const MAX_THREADS = 30;
/** The files an apply's line to the session's agent names; past them it says how many more. */
const MAX_APPLIED_NAMED = 30;
/** A sub-agent the registry does not know in a session, in the words every refusal of one says. @param {string} id */
export const noSuchSubagent = (id) => `no sub-agent ${id} in this session (the person may have deleted it; a session keeps its newest ${MAX_THREADS}, and every one whose work waits for the person's Apply)`;
/** How an exchange cut by a restart ended, as it says. */
const CUT_BY_RESTART = "Filament restarted before it finished";
/** What an attempt was dropped for whose launch was refused (TG2-D53), in its `dropped`'s place of a winner's id. */
const ATTEMPT_REFUSED = "refused";
/** A graph task's id as the graph takes one (core/task-graph.js): what a Hunter's launch names as the task it hunts in. */
const TASK_ID = /^[a-z][a-z0-9_-]{0,23}$/i;
/** An attempt as it is kept and shown: its place and its fate, never the stop of the moment (TG2-D53). @param {Attempt} a */
const attemptOf = (a) => ({ group: a.group, n: a.n, of: a.of, won: a.won, dropped: a.dropped });
/** Answers one message may overrule. */
const MAX_OVERRULED = 8;
/** A card whose own words say it changes nothing: Filament's read-only line would only repeat them. */
const SAYS_READS = /\b(change|fix(ing)?)\s+nothing\b/i;
/** Why a team's own Lead is not launched by itself (OA-D4). @param {{ name: string, partOf?: string | null }} card */
const partOfWords = (card) => `${card.name} is part of the \`${card.partOf}\` team, as its Lead: it runs only when that team does — start the team, or ask another agent`;
/**
 * What a saved agent's answer is worth to the agent that asked (HarnessV4_Tasks E15 step 3, V4-D289). What it changed
 * is said with its answer, as its level made it (`workText`): kept in its own copy to apply, thrown away with its copy,
 * or nothing.
 */
const ADVICE_WORTH = "Weigh it, and say in your reply what you decided. It does not stand in for the developer's yes; they see this answer as a card and may overrule it.";
/** Ahead of a question the session's agent asks a saved agent by itself. */
const ASKED_BY_AGENT = "[Filament: the session's main agent asks you this by itself, in the middle of its work. The developer sees your answer as a card, and may overrule it.]";
/** Reports kept aside per session across a restart; the oldest go first. */
const MAX_HELD = 20;
/** The context view's ceiling in characters: the newest part of the rendering is kept. */
const VIEW_CHARS = 200_000;
/** Characters of a run's newest words its progress keeps, on one line. */
const WORDS_CHARS = 200;
/** How many of a run's events one read of its log asks for: its ceiling (services/runs.js `events`). */
const RUN_PAGE = 50_000;
/** A running sub-agent's progress reaches the events feed at most once in this many ms (HarnessV3-Views V3). */
export const PROGRESS_MS = 500;
/**
 * How long a team's worker's plan waits for its lead's go (HarnessV3-TaskGraph-v2 TG2-D50), from when it sent it, across
 * a coding agent's calls: then it goes on with its plan. A question has no such clock (TG2-D58): it waits for its answer.
 */
export const ASK_LEAD_SECONDS = 180;
/**
 * What Filament tells a team's worker whose same command failed a third time (HarnessV3-TaskGraph-v2 TG2-D59): its lead
 * knows the project and the plan, and finds the way. @param {string} command
 */
export const stuckWords = (command) => `\`${clip(command, 200)}\` has failed 3 times. If you do not see why, ask your lead with ask_lead: say what you tried and what it showed.`;
/** How a run that did not finish ended, in the words a model and the record read; a stop's are `endedWord`'s. */
const ENDED = {
  "budget-stopped": "stopped at a budget",
  aborted: "was cut off before it finished",
  failed: "failed",
};
const ENHANCE_SYSTEM =
  "You rewrite a task for a sub-agent: a fresh agent with file and shell tools in the same project, which sees nothing of the conversation the task came from. Reply in the form the instruction asks — the title line, then the brief — with no preamble and no tool calls.";
/** What each context view hands a sub-agent, in the words the enhance instruction tells the rewriting model. */
const VIEW_MEANS = Object.freeze({
  folded: "every completed turn folded, tool results trimmed",
  window: "the main agent's context window as it stands, the turn running now included",
});

/**
 * The turn running at a side agent's launch, as its first message says it (HarnessV4_Tasks E13-1, BW-6). The run log
 * keeps a call's target and the head of its result, never the whole of either: the words say so, since the reader has
 * the tools to read for itself.
 * @param {{ rounds: number, tools: number, text: string }} r
 */
const runningBlock = (r) =>
  `<running-turn rounds="${r.rounds}" calls="${r.tools}">\nThe turn the main agent is working on now, as Filament's log of it stands: its message, then each round's words and calls since its last compaction, where it made one — the earlier rounds with a line for each result, the newest whole. A call is shown by its target and a result by its first lines, never the whole of either: read a file yourself where you need it. The turn goes on while you work. Background only — your task follows.\n\n${r.text}\n</running-turn>`;
/**
 * The main agent's context window as a sub-agent's first message opens with it (the view `window`, the owner's words of
 * 10-19): where it comes from, and that its oldest part was left out where it did not fit.
 * @param {WindowView} w
 */
const windowBlock = (w) =>
  `<conversation view="window" turns="${w.turns}">\n${
    w.exact
      ? "The main agent's context window as it stands: the summary it starts from where the session was compacted, the turns since and the turn running now to its newest round, as its request carries them."
      : "The main agent's context window as Filament rebuilds it: from the session's last compaction — its summary first — the finished turns as they were sent, then the turn running now from its own last compaction to its newest round, as the run's log keeps it."
  }${w.cut ? " Its oldest part is left out, to fit your window." : ""}${w.mark.run ? " The turn goes on while you work." : ""} Background only — your task follows.\n\n${w.text}\n</conversation>`;
/**
 * The question the session's turn stopped on, while it waits for the developer (HarnessV4_Tasks E15, the plan's case
 * 31): what the round that asked said, and what it asks.
 * @param {{ question: string, said: string }} w
 */
const waitingLines = (w) => [...(w.said ? ["In the round that asked, it said:", w.said, ""] : []), "It asks:", w.question];
/**
 * The same at a side agent's launch, as its first message says it: the turn stands among the finished ones as far as
 * its question, so the reader is told it has not ended.
 * @param {{ kind: string, question: string, said: string }} w
 */
const waitingBlock = (w) =>
  [`<waiting kind="${w.kind}">`, "The main agent's turn has not ended: it stopped to ask the developer, and nothing runs until they answer. Background only — your task follows.", "", ...waitingLines(w), "</waiting>"].join("\n");
/**
 * A range was named from a point git does not know (AG-81): the exchange that named it ends with these words, and no
 * model is asked — a view that merely could not be read is left out of the message instead.
 */
class NoSuchRange extends Error {}
/**
 * A change as a patch, as a side agent's first message says it (BW-5), or why there is none to show.
 * @param {{ source: string, ref?: string, text: string, files: number, shown?: number, turn?: number | null, note: string | null }} c
 */
const changesBlock = (c) => {
  const head = `<changes source="${c.source}"${c.ref ? ` since="${c.ref}"` : ""} files="${c.files}">`;
  if (c.note) return `${head}\n${c.note}: there is no patch to show. \`git status\` and \`git diff\` in the session's folder show what is uncommitted.\n</changes>`;
  // A turn that runs is read from its snapshots, and it takes one after each round that wrote: what its newest round
  // is writing now is not in them yet.
  const what =
    c.source === "running"
      ? `What turn ${c.turn} of the session, the turn running now, has changed up to its last finished round, as a patch`
      : c.source === "turn"
        ? `What turn ${c.turn} of the session, its last finished turn, changed, as a patch`
        : c.source === "since"
          ? `Everything that changed in the session's folder since \`${c.ref}\` — committed since then, and uncommitted — as a patch`
          : "Everything uncommitted in the session's folder, as a patch";
  // A range may hold anyone's commits; the other three are read as the session's work.
  const whose = c.source === "since" ? "Not your work" : "Not your work: the main agent's";
  return `${head}\n${what} (${c.files} file${c.files === 1 ? "" : "s"}). ${whose}. Background only — your task follows.\n\n${c.text}\n</changes>`;
};
/**
 * What happened in the session since a side agent last looked, ahead of the developer's next message to it (BW-7).
 * `w`: the question the session's turn has stopped on since, while it waits.
 * @param {{ turns: number, text: string }} v @param {{ rounds: number, text: string } | null} r
 * @param {{ question: string, said: string } | null} w
 */
const sinceBlock = (v, r, w) =>
  [
    `<since-your-last-look turns="${v.turns}"${r?.text ? ` rounds="${r.rounds}"` : ""}>`,
    "What happened in the session since you last looked, as Filament renders it: the turns finished since, each folded, and what the turn running now has done since. Background only — the developer's message follows.",
    ...(v.text ? ["", v.text] : []),
    ...(r?.text ? ["", "The turn running now, since then (a call by its target, a result by its first lines):", r.text] : []),
    ...(w ? ["", "The main agent's turn has not ended: it stopped to ask the developer, and nothing runs until they answer.", ...waitingLines(w)] : []),
    "</since-your-last-look>",
  ].join("\n");

/**
 * @typedef {object} WindowView  what a session's `windowView` answers (app/sessions/service.js): the main agent's
 *   context window as it stands
 * @property {string} text
 * @property {number} turns  the finished turns it holds
 * @property {number} turn  the newest finished turn's number: the mark of this look
 * @property {boolean} exact  it is Filament's loop's request as it stands, not rebuilt
 * @property {boolean} cut  its oldest part was left out, to fit the reader's window
 * @property {{ run: string | null, event: number }} mark  where a later look at the running turn starts
 * @property {{ kind: string, at: number, question: string, said: string } | null} waiting
 */
/**
 * @typedef {object} SessionView  what a session's `view` answers (app/sessions/service.js `contextView`)
 * @property {string} text  the finished turns it renders, as plain text
 * @property {number} turns  how many
 * @property {number} [turn]  the newest finished turn's number: the mark of this look
 * @property {{ run: string, event: number, rounds: number, tools: number, again?: boolean, text: string } | null} [running]
 *   the turn running now, from its run's log; `event`: the log's newest event, the mark of this look
 * @property {{ kind: string, at: number, question: string, said: string } | null} [waiting]  the question the session's
 *   turn stopped on, while it waits for the developer: what the round that asked said, and when it began to wait
 * @property {{ source: string, ref?: string, text: string, files: number, shown?: number, turn?: number | null, note: string | null, refused?: boolean } | null} [changes]
 *   a change as a patch, or why there is none
 */
/**
 * Who started an exchange: the session's agent, the developer, a chat command — or nobody (`self`, HarnessV4_Tasks E15
 * step 7): one Filament starts itself, a second look or a steer's fork. It takes no seat from the session's limit, is
 * in no count the session's agent reads, and answers nobody: its report stays aside, as one the developer asked for does. A box of a flow the developer started (`flow`,
 * HarnessV4_Flow_Plan F2) is theirs: it takes their seats, waits for one where none is free (FL-D20), leaves no mark in
 * the chat and no report kept aside — its end is the flow's runner's, which hands it on.
 * @typedef {"agent" | "owner" | "command" | "self" | "flow"} SubagentOrigin
 */
/**
 * @typedef {{ exchange: number, description: string, ok: boolean, status: string, report: string, helper: boolean }} ExchangeEnd
 *   an exchange's end as the watchers hear it: its number, its line, whether it did what it was asked, the loop's word,
 *   its report's head, and whether it was a helper's — a second look, a fork weighing the person's message
 */
/**
 * @typedef {object} SubagentContext  what the registry reads of the sessions it serves (server.js wires it)
 * @property {(chainId: string) => any | null} settings  the session's effective document; null for no such session
 * @property {(chainId: string, path: string) => string | null} [settingFrom]  where a setting of the session's comes
 *   from — "session", "project", "global" or "default" (services/session-settings.js `resolveSettings`' sources); left
 *   out, or null, not known
 * @property {(chainId: string) => { cwd: string, model: string, projectId: string | null, client?: string | null, kind?: string | null } | null} session
 * @property {(chainId: string, form: string | null, o?: { running?: boolean | { run: string | null, event: number } | null, changes?: string | null, after?: number }) => Promise<SessionView | null>} view
 *   the session's completed turns composed in a form (a fold, or whole) and rendered as text, locally (no model call); beside
 *   them, where asked, the turn running now and a change as a patch, and for a later look only what came since
 *   (app/sessions/service.js `contextView`)
 * @property {(chainId: string, o: { messages: any[] | null, model: string | null }) => Promise<WindowView | null>} [windowView]
 *   the main agent's context window as it stands (the view `window`): from the loop's request where one is live
 *   (`messages`), else rebuilt from the archive and the run's log, fit to half the reader's window
 *   (app/sessions/service.js `windowView`)
 * @property {(chainId: string) => number} [sinceMessage]  the turn a view "since the developer's last message" begins
 *   after (app/sessions/service.js `sinceMessage`); 0: from the session's start
 * @property {(chainId: string) => boolean} [asking]  whether a question the session's turn paused on waits for the
 *   person's answer (app/sessions/service.js `asking`): a pause is no end of the turn
 * @property {(o: { chainId: string, projectId: string | null, launchedBy: string | null, task: string, tools: string[], model: string }) => Promise<{ text: string, count: number } | null>} brief
 *   memory's brief for the task (HarnessV3-Memory M7-1): its words and how many memory lines they hold; `launchedBy`, the
 *   run of the turn that launched it (none for the developer's own launch); `model`, the one its calls go out on
 *   (`sentModel`), which Memory settings may leave out
 * @property {(chainId: string, model: string) => string | null} [leftOut]  why Memory settings leave a sub-agent's work
 *   out on the model its calls go out on (`sentModel`), in their words — that model, or the chat it works for — or null
 *   (memory's `subagentLeftOut`)
 * @property {(o: { chainId: string, launchedBy: string | null, agentId: string, agentType: string, model: string, sentModel: string, task: string, report: string, calls: { tool: string, input: string, ok: boolean }[] }) => void} [reported]
 *   what an exchange that ended done found, for memory to read off the request path (HarnessV3-Memory M7-D17)
 * @property {(o: { chainId: string, request: string }) => number} [corrected]  a team's lead said a worker's reported
 *   work fell short (HarnessV3-Memory M7-D50): memory counts the task of that exchange — its run's request — as
 *   corrected by the lead → how many outcomes it marked
 * @property {(model: string) => string | null} modelProblem  why a name cannot run a sub-agent, null when it can
 * @property {(model: string) => import("../../core/pool.js").ModelFacts & { at?: { upstream: string, model: string, name?: string } | null, seen?: { cap: number, from: "headers" | "429", liftsAt?: number } | null }} [modelFacts]
 *   that, and how many agents the model's provider takes at once (what a 429 of its taught — never its rate-limit
 *   headers, a minute's requests: health.learnedCeiling): what a row of the session's pool lends (HarnessV4_Tasks E15 step 8); `at`, the source its name lands on
 *   and the name it receives there, whose slots across Filament it takes (team_v2_plan TV2-D8), and `seen` the ceiling
 *   that provider showed. Left out, a model has no limit and no slots
 * @property {(model: string) => string | null} [agentOf]  the coding agent a name runs as (HarnessV3-ACP AC6-1): the
 *   upstream its route lands on first, when that is an agent's — its sub-agent's run is that agent's turn — else null
 * @property {(name: string, provider: string | null, prefer?: string | null, within?: readonly string[] | null) => Promise<import("../../core/model-choice.js").Choice>} [chooseModel]
 *   the model a launch names as a person says it, at the provider it names (HarnessV4_Tasks E23-D1 to D3): matched
 *   against the picker's models — `within` a list's rows alone (the owner's of 11-19) —, or why it cannot run in words.
 *   Left out, a launch's model runs as named
 * @property {(model: string, wanted: string | null, asked: boolean) => { level: string | null, wire: string, levels: string[] | null, spelled: boolean }} [effortOf]
 *   the effort a model runs at for the level asked, and the name its requests carry for it (E23-D5). Left out, a
 *   sub-agent runs at its model's own
 * @property {(ask: { model?: string | null, provider?: string | null }, seats: (model: string) => string) => Promise<string>} [modelList]
 *   the models a sub-agent can run on, as a launcher reads them (E23-D4)
 * @property {(tag: string) => import("../../services/agent-cards.js").AgentCard | null} [card]  the saved agent a tag
 *   names (HarnessV4_Tasks E15), null for none
 * @property {() => import("../../services/agent-cards.js").AgentCard[]} [cards]  every saved agent: whom a developer's
 *   message names in plain words is read against them
 * @property {() => string[]} [teamNames]  the saved teams' names: a card's name inside one that a message names there is
 *   not named (`heard`)
 * @property {(chainId: string, mark: Mark) => (Mark & { afterTurn: number }) | null} mark  a mark recorded on the
 *   session with the turn it follows — between its turns when no turn runs to carry it, a sent report always; null
 *   for no such session
 * @property {(chainId: string) => boolean} [holdsWriters]  whether a sub-agent the chat's agent launches that may change
 *   files waits on a card for the person's yes — Parallelize tasks off for the chat, its own switch or else Settings ›
 *   Experimental's (held-launch.js, the owner's of 11-14 and 11-16)
 * @property {(chainId: string) => number | null} [newestTurn]  the session's newest turn as its archive numbers it, null
 *   before its first: a card for sub-agents that change files follows it (held-launch.js)
 * @property {(chainId: string, list: SavedDelivery[]) => void} [saveQueue]  the session's messages not yet read by its
 *   loop, kept across a restart (an empty list clears them)
 * @property {(chainId: string) => SavedDelivery[]} [loadQueue]  what `saveQueue` kept
 * @property {(chainId: string, tags: string[]) => void} [keepHeard]  the agents the developer's newest message named,
 *   kept on the chat (the bug round of 10-23)
 * @property {(chainId: string) => unknown} [heardKept]  what `keepHeard` kept
 * @property {(chainId: string, list: HeldReport[]) => void} [saveHeld]  the reports the developer kept aside and has not
 *   sent on, kept across a restart so Send still works once the registry has forgotten the sub-agent (an empty list
 *   clears them)
 * @property {(chainId: string) => HeldReport[]} [loadHeld]  what `saveHeld` kept
 * @property {(chainId: string, thread: SavedThread, max: number) => void} [saveThread]  one sub-agent's thread as the
 *   session keeps it (BW-10), in place of what it kept of that sub-agent; past `max` threads the oldest ended one goes
 * @property {(chainId: string, held?: (agentId: string) => boolean) => SavedThread[]} [loadThreads]  what `saveThread`
 *   kept, the oldest first — less those `held` says the registry holds already, which are not read
 * @property {(chainId: string, agentId: string) => void} [forgetThread]  a thread the person deleted leaves what
 *   `saveThread` kept
 * @property {(agentIds: readonly string[]) => { chainId: string, thread: any }[]} [threadsNamed]  the threads the chats
 *   keep of the sub-agents named, each with the chat that keeps it, read as kept: Filament's footprint in a repository
 *   asks it of the helpers its refs and copies name (`known`)
 * @property {(chainId: string) => boolean} [agentsChat]  whether another machine's agents started the chat
 *   (`meta.agentDevice`), or one up its line — the chat it was made from, forked from, or runs a team beside: it sends
 *   nothing to a machine of this Filament's (`AGENTS_CHAT_MACHINES`)
 * @property {(chainId: string) => boolean} [agentsAsk]  whether the chat is such a chat whose agents' device may not run
 *   without asking here (its grant `unasked` off, read as it stands): Filament runs no command of theirs on its own — no
 *   command task, no check (`AGENTS_ASK`)
 * @property {(chainId: string) => boolean} [agentsFenced]  whether the chat is such a chat whose device holds no Full
 *   control here (services/devices.js `fullControl`, read as it stands): its sub-agents launch with memory off
 * @property {(chainId: string) => string[]} [goneHelpers]  the sub-agents whose threads a deleted chat kept, as its
 *   delete noted them: what it kept in the repositories goes with it (`letGoChatWork`)
 * @property {() => string[]} [folders]  every folder Filament knows a chat of — the projects' —: where a deleted chat's
 *   helpers' copies and refs are looked for when the registry does not hold them
 * @property {(chainId: string, drew: Drew) => string | null} [visualCode]  a picture one of the session's agents drew,
 *   its code whole, from where it is kept (HarnessV4_DesignPass_Plan UX1); null where it is not
 * @property {(chainId: string) => { chain: string, d: Drew, by: string, task: string, at: number }[]} [besidePictures]  the
 *   pictures drawn in the chats of the teams beside a session — their leads' and their crews', each with its team chat
 *   (`chain`, where `visualCode` reads it) — that its agent opens as it opens its helpers' (HarnessV4_DesignPass_Plan,
 *   case 13)
 * @property {(path: string) => string | null} [folderProblem]  why the loop may not work in a folder (the roots rule),
 *   null when it may — a sub-agent's worktree must pass it
 * @property {(o: { chainId: string, agentId: string, task: import("./graph-runner.js").GraphTaskEnd | null, ended: ExchangeEnd }) => void} [exchangeEnded]
 *   every exchange's end, once all of it is told — the graph runner's (HarnessV3-TaskGraph G2): a slot that frees, and
 *   a graph task's end with what Filament saw of it and what the turn that launched it counts; and the watchers' (the
 *   plan of 11-11): how it ended (`ended`)
 * @property {(chainId: string) => (agentId: string) => boolean} [holds]  whether the session's task graph will still
 *   ask for each sub-agent — its review's changes, a merge, an apply by its id (the graph runner's): no prune lets it go.
 *   The graph is read once, asked of every sub-agent a prune may let go
 * @property {(chainId: string) => Promise<void> | null} [flowOwes]  what the session's turn owes a flow its main agent
 *   drives In place (the flow runner's, HarnessV4_OneAgent_Plan OA4): it settles once none is driven; null with none
 * @property {(chainId: string) => boolean} [flowDriven]  whether the session's main agent drives a flow now: its wait says so
 * @property {{ refusal: (chainId: string, id: string) => string | null, took: (chainId: string, id: string, helper: import("../../core/task-graph.js").TaskHelper) => void }} [taskHelper]
 *   a coding agent's launch names a task of its graph (10-28, the graph runner's): why it may not, asked before the launch,
 *   and who works on it once it launched
 * @property {(chainId: string, id: string) => { name: string, graph: number } | { error: string }} [huntedTask]  the task
 *   a Hunter is fired from, as the session's graph holds it at the launch (11-02, the graph runner's): its name and the
 *   graph's start — or why none is fired from it, in words: the graph holds no task of that id, or not a done one
 * @property {(o: { chainId: string, agentId: string, files: import("../../adapters/git/worktree.js").ChangedFile[], marked?: readonly string[], repo?: string }) => void} [workApplied]
 *   a sub-agent's work went into the session's folder by an apply — the developer's, a command's: the graph runner's,
 *   whose task's change that waited for its apply is done then (10-28); `marked`, the files it left with git's conflict
 *   markers, for the developer to resolve; `repo`, the repository it went into, which the graph reads what of it is
 *   still uncommitted in (11-09)
 * @property {(o: { chainId: string, agentId: string }) => string | null} [taskMark]  the session's graph's word on a mark
 *   of a graph task's sub-agent's work as applied (the graph runner's, the bug report of 11-10): null where the mark can
 *   end its task — its change waits for an apply — or no task of the graph waits on it, else why not, in words
 * @property {(o: { chainId: string, agentId: string, reason: string | null }) => { ok: true, id: string, stands: boolean } | { ok: false, error: string } | null} [taskApply]
 *   the session's agent — or a lead — applies a sub-agent's work (the graph runner's, the owner's of 11-02): where its
 *   graph task's change waits for that apply, the task merges by the graph's checked merge (`mergeTask`), and its end is
 *   told with the verdict — `stands` where its planner asked it in as it stood — or a refusal, in words, where the task
 *   holds that worker for another step; null where the work is no graph task's
 * @property {(o: { chainId: string, agentId: string, repo: string, paths: string[] }) => Promise<void> | void} [appliedWrote]
 *   what any apply of a sub-agent's work wrote into `repo` (paths from its top) — none the developer kept as theirs, none
 *   that came in the same — for Changes to keep under its name until committed, across a restart (10-29); awaited
 *   before the apply says itself, so a read of Changes on its word finds them its
 * @property {(o: { chainId: string, agentId: string, taskId: string, note: string, merge?: import("../../core/task-graph.js").MergeBack | null }) => { ok: true, n?: number } | { ok: false, error: string }} [rebaseTask]
 *   a graph task's sub-agent whose change was sent back to rebase (the Designer's of 10-27): the graph runner sends the
 *   task back with `note`, as it sends tasks back, and it goes on in the conversation it has. `merge`: sent back from the
 *   graph's merge, which overlapped the folder's edits (the owner's of 11-09) — by Filament itself, which time (`n`), or
 *   as its planner asked
 * @property {(chainId: string, agentId: string) => boolean} [rebaseWaits]  whether the session's graph still waits for
 *   that sub-agent to go on with a task sent back to it (the graph runner's): one sent back to rebase is due only then
 * @property {(chainId: string, agentId: string) => boolean} [waitsForYou]  whether a graph worker's change waits for
 *   the developer's Apply (the graph runner's, 10-28): its thread is then kept across a restart, as a helper's is
 * @property {(chainId: string, input: import("../letters.js").LetterInput, o?: { agent?: string | null, waits?: boolean }) => { ok: boolean, text: string, sent?: LetterSent, waiting?: import("../letters.js").ReplyWait }} [sendLetter]
 *   a letter of the session's agent to another chat or to a sub-agent of its own, or its answer to one — or, `agent`,
 *   a sub-agent's to the agent that launched it (letters.js `send`)
 * @property {(chainId: string) => void} [reportWaits]  another agent's report or result came for the session's agent
 *   while no turn of it ran: the chat goes on by itself to read it, as it does when a background command ends
 *   (sessions/wake.js; the owner's of 10-28: "if envelope arrives with an intention of you reading it then you should
 *   wake")
 */
/**
 * @typedef {{ ok: true, files: import("../../adapters/git/worktree.js").ChangedFile[], came?: import("../../adapters/git/worktree.js").Came[], repo: string, check?: import("./check.js").FolderCheck, recorded?: true, aside?: { base: string, head: string } }
 *   | { ok: false, error: string, conflicts?: import("../../adapters/git/worktree.js").ApplyConflict[], partial?: true, stuck?: string[], check?: import("./check.js").FolderCheck, takes?: readonly Overlap[], sentBack?: { ok: true, marked: string[], left: import("../../adapters/git/worktree.js").ApplyConflict[], n?: number } | { ok: false, error: string }, graph?: true }} ApplyResult
 *   `repo`: the repository the files went into, whose top their paths start from. `check`: a team lead's apply
 *   (HarnessV3-TaskGraph-v2 TG2-D55) — what came of Filament's check of the folder with it, or how it stands as its call
 *   answers: it waits behind the apply before it, or its check still runs. An apply the check undid is no apply
 *   (`ok: false`). `recorded`: what it wrote is recorded already — the planner's call that answered as it went in
 *   carried it — so nothing of it is recorded with this. `aside`: the commits that hold its change to the files kept as
 *   the folder had them (the agent's `overlap` "mine", 11-09). `takes`: the agent's ways on where its change overlapped
 *   edits in the folder, which this apply would take (`Overlap`); `sentBack`: what came of sending it back to rebase,
 *   with the agent's "send_back" — or, a task graph's merge (`graph`), by Filament itself, which time of two (`n`)
 */
/**
 * What the agent answers for the files where a sub-agent's change overlaps edits in the folder, beside apply_changes
 * (the owner's of 11-09: "apply refuses a change that overlaps a file you edited, with no merge offered"): "markers",
 * all of it with git's conflict markers in those files; "mine", the rest, the folder's version of those kept; "send_back",
 * redone on the folder by the sub-agent (`rebase`). Left out, nothing is applied.
 * @typedef {"markers" | "mine" | "send_back"} Overlap
 */
/** Every way on an overlap, as the agent tool's field takes them. @type {readonly Overlap[]} */
export const OVERLAPS = Object.freeze(["markers", "mine", "send_back"]);
/** The ways on an overlap of a sub-agent's whose copy is on another machine, which a rebase here does not reach. @type {readonly Overlap[]} */
const THERE_OVERLAPS = Object.freeze(["markers", "mine"]);
/** The one a lead's apply takes: Filament checks the folder with each, so nothing goes in half-merged. @type {readonly Overlap[]} */
export const LEAD_OVERLAPS = Object.freeze(["send_back"]);
/**
 * @typedef {object} Cycle  a team lead's apply of a worker's change, checked (HarnessV3-TaskGraph-v2 TG2-D55): what came
 *   of it once it has, and how it stands meanwhile, for a call that answers first
 * @property {Promise<ApplyResult>} verdict
 * @property {{ key: string, repo: string, started: boolean, files: import("../../adapters/git/worktree.js").ChangedFile[] | null, came: import("../../adapters/git/worktree.js").Came[] | null, aside: { base: string, head: string } | null, command: string | null, began: number, done: ApplyResult | null, answered: "late" | "waiting" | null, landed: Promise<void>, land: () => void, callers: number, told: boolean, carried: boolean, back: boolean }} state
 *   `key`: whose change it is; `started`: its turn in the repository's line came; `files`: what went in, once it did —
 *   `landed` settles then (`land`) — how each came, and its change to the files kept as the folder had them set aside
 *   (`came`, `aside`: a graph task's apply with the agent's overlap, 11-09); `command`: the check's command running now, the check running since `began`;
 *   `done`: the verdict, once there; `answered`: a call answered before the verdict — that its check ran, or that it
 *   waited in line — so the verdict reaches the lead's door. A planner's apply of a graph task's change (`landedOf`):
 *   `callers`, its calls that wait for it to go in; `told`, one of them waited as it went in, so what it wrote goes
 *   with that call's answer — `carried` once it did — and with nothing after; `back`, the lead's send_back (11-09),
 *   asked by a call of it, which runs on the verdict
 * @property {AbortController} abort  the lead's turn ended, or Filament stops: the check ends, and the apply stands unchecked
 */
/** A promise that settles once the signal aborts — at once where it has. @param {AbortSignal} signal @returns {Promise<void>} */
const abortOf = (signal) => new Promise((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })));
/**
 * @typedef {object} WorkState  a writing sub-agent's own git worktree (HarnessV3 §15 item 88)
 * @property {string} repo  the developer's repository
 * @property {string} base  what its work is measured against; it moves to the work once that is applied
 * @property {string | null} head  its newest captured work (null before the first capture)
 * @property {import("../../adapters/git/worktree.js").TaskWorktree | import("../../adapters/git/patch.js").PatchWorkspace | null} wt  the folder, while an exchange works in it
 *   (kept after one only when its work could not be captured, so nothing is lost)
 * @property {"patch"} [kind]  a patch workspace (adapters/git/patch.js, the owner's plan of 11-09 for big repos) — no
 *   checkout, until something only a checkout can do moves it to a worktree at the same place; unsaid, a worktree
 * @property {{ kind: "clone" | "sparse", paths: string[] }} [copy]  its worktree is of this kind (workspace-kind.js
 *   `copyKind`), a sparse one's cone holding `paths` too: what its next exchange's copy is asked for, made again or
 *   reset where it is parked; unsaid, a full checkout
 * @property {string | null} [dest]  where its copy is, kept while it is parked between exchanges: its header names it
 * @property {import("../../adapters/git/worktree.js").ChangedFile[]} files  base→head: what waits to be applied
 * @property {Applied[]} applied
 * @property {string | null} error  the newest capture's trouble, in words
 * @property {string | null} [undone]  the head of work whose mark was undone: it waits on the developer's word, and
 *   Filament never finds it in the folder by itself (`settleFound`)
 * @property {true} [there]  its worktree is its copy on another machine (cp-back): never one here; each exchange's end
 *   brings what it changed there back as `head` (`bringBack`), built on the copy sent
 * @property {true} [gone]  its copy there went before what it changed came back, and that with it (`error` says why)
 * @property {{ path: string, why: string }[]} [left]  what it made or changed in its copy there that the newest bring
 *   back left there, each with why (remote-agents.js `takeBack`: a secret's file, one too large, a link out of the
 *   tree): never brought here, said in its report's words and in its Changes (the review of 11-11)
 */
/**
 * @typedef {{ at: number, files: number, by: string, reason?: string, came?: CameCount, hand?: { base: string, head: string } }} Applied  one apply of a sub-agent's work: when,
 *   how many files, who applied it, and — where Filament's check of the change had failed — why it went in anyway
 *   (HarnessV3-TaskGraph-v2 TG2-D45); `came`, how its files came in (the Designer's of 10-27: "1 merged with your edits");
 *   `hand`, a change the developer or the session's agent marked as applied — it came into the folder another way, its
 *   apply refused and brought in by hand (10-29) — Filament writing nothing: what waited, `base`→`head`, so the mark's
 *   undo makes it wait again as it did
 */
/**
 * How an apply's files came in: as the sub-agent left them, merged with the developer's own edits (named), deleted, or
 * already the same in their folder — and, by the developer's choice on a file that overlapped theirs (the Designer's of
 * 10-27, built 10-28), theirs kept, theirs replaced by its, or both with git's markers, each named where there are any.
 * @typedef {{ took: number, merged: string[], deleted: number, same: number, kept?: string[], replaced?: string[], markers?: string[] }} CameCount
 */
/** @param {import("../../adapters/git/worktree.js").Came[] | undefined} list @returns {CameCount} */
export const cameCount = (list) => {
  const named = (/** @type {string} */ how) => (list || []).filter((c) => c.how === how).map((c) => c.path);
  const chosen = /** @type {const} */ (["kept", "replaced", "markers"]).flatMap((how) => (named(how).length ? [[how, named(how)]] : []));
  return {
    took: named("took").length,
    merged: named("merged"),
    deleted: named("deleted").length,
    same: named("same").length,
    ...Object.fromEntries(chosen),
  };
};
/**
 * The folder of a sub-agent's copy that holds its work now: its open copy, else its parked one while that is still its
 * own — a parked copy can be taken for the next agent, moved or dropped, and its old place then shows another agent's
 * files or none (the Hunter's of 10-28: Open its version opened them). A parked patch workspace is its own while its
 * record stands (patch.js `patchHeldBy`). Null with none.
 * @param {{ id: string, work: { wt?: { dest: string } | null, dest?: string | null, kind?: "patch" } | null }} sa
 */
const copyOf = (sa) => sa.work?.wt?.dest ?? (sa.work?.dest && (sa.work.kind === "patch" ? patchHeldBy : copyHeldBy)(sa.work.dest, sa.id) ? sa.work.dest : null);
/**
 * A sub-agent's folder as a patch workspace, where it is one (adapters/git/patch.js); null for a worktree, or none.
 * @param {any} wt @returns {import("../../adapters/git/patch.js").PatchWorkspace | null}
 */
const patchOf = (wt) => (wt && wt.kind === "patch" ? wt : null);
/**
 * How the files of a work its rebase left marked come in (the Hunter's of 10-28: an apply of it after a restart, or once
 * its task went to another worker, wrote the markers unsaid): with git's conflict markers, as the developer's own "both"
 * is said — where the file comes in at all.
 * @template {import("../../adapters/git/worktree.js").Came[] | undefined} T
 * @param {T} came @param {readonly string[]} marks @returns {T}
 */
export const withRebaseMarks = (came, marks) => {
  if (!came || !marks.length) return came;
  const set = new Set(marks);
  return /** @type {T} */ (came.map((c) => (set.has(c.path) && (c.how === "took" || c.how === "merged" || c.how === "replaced") ? { ...c, how: /** @type {const} */ ("markers") } : c)));
};
/**
 * The developer's choices for the files that stopped an apply, as a request carries them: a path's choice is kept only
 * where it is one of the three (the apply itself takes only those its kind offers).
 * @param {unknown} raw @returns {Record<string, import("../../adapters/git/worktree.js").ApplyChoice>}
 */
export const choicesOf = (raw) => {
  /** @type {Record<string, import("../../adapters/git/worktree.js").ApplyChoice>} */
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [path, c] of Object.entries(raw).slice(0, 500)) if (path && (c === "yours" || c === "its" || c === "both")) out[path] = c;
  return out;
};
/**
 * The newest apply of a sub-agent's work, as its row shows it: when, how many files, who, how they came in — and the
 * files it left with git's conflict markers that still have them (the Designer's of 10-27: "1 file has conflict
 * markers · Open ↗" until they are gone).
 * @param {WorkState} w
 */
const lastAppliedOf = (w) => {
  const a = w.applied.at(-1);
  if (!a) return null;
  const marked = (a.came?.markers || []).slice(0, 50).filter((p) => stillMarked(w.repo, p));
  // Its reason: Filament's check of the change had failed, and it went in anyway (TG2-D45) — "its check passed" is not
  // said of it (the Hunter's of 10-28).
  return { at: a.at ?? 0, files: a.files ?? 0, by: a.by ?? "", ...(a.reason ? { reason: a.reason } : {}), ...(a.came ? { came: a.came } : {}), ...(a.hand ? { hand: true } : {}), ...(marked.length ? { marked, repo: w.repo } : {}) };
};
/**
 * How long a mark as applied can be undone: a day. A wrong mark is seen within the day it was made; past it the folder
 * has moved on from the change, and an undo would set waiting a change made against a folder that is no more. The
 * session keeps a thread whose mark can be undone beside its newest (sessions/service.js `saveSubagentThread`), and
 * its hold stays in the repository (core/footprint.js) — while the undo lasts, never for good (the owner's of 11-04:
 * 75 threads kept for their marks).
 */
export const MARK_UNDO_MS = 24 * 3600_000;
/** How long an exchange's end waits before it tries again to capture work its first try could not (`closeWork`). */
export const CAPTURE_AGAIN_MS = 1000;
/** How long what a sub-agent changed in its copy on another machine may take to come back: a large change, slowly. */
const BRING_BACK_MS = 60 * 60_000;
/**
 * How long a bring back cut short waits before each next try (`bringBack`): about half an hour in all, the while its copy
 * there is kept for its chat after a turn (services/copies.js `GRACE_MS`). Past them, its next exchange's end tries.
 */
export const BACK_AGAIN_MS = Object.freeze([60_000, 2 * 60_000, 4 * 60_000, 8 * 60_000, 15 * 60_000]);
/**
 * How long a deleted chat's helper whose work could not be captured waits before its capture is tried again, the first
 * time (`saveLater`); each try after waits twice as long as the one before, `SAVE_AGAIN_MAX_MS` at most.
 */
export const SAVE_AGAIN_MS = 60_000;
const SAVE_AGAIN_MAX_MS = 30 * 60_000;
/**
 * A sub-agent's newest apply where it is a mark that can be undone (10-29): marked as applied within MARK_UNDO_MS,
 * nothing of its work captured since, no exchange begun since, and the sub-agent at rest. Null otherwise. It reads a
 * sub-agent or the thread its session keeps of one (the session keeps a thread whose mark can be undone, as one whose
 * work waits).
 * @param {{ status?: string, work?: { base?: string | null, files?: readonly unknown[], applied?: readonly any[] } | null, exchanges?: readonly { startedAt?: number }[] }} t
 * @param {number} [now]
 */
export const markUndoable = (t, now = Date.now()) => {
  const w = t.work;
  const a = w?.applied?.at(-1);
  if (!w || !a?.hand || t.status === "running" || w.files?.length || w.base !== a.hand.head) return null;
  if (now - (Number(a.at) || 0) > MARK_UNDO_MS) return null;
  // An exchange begun at the mark or after it worked from the mark: what it did, or did not, stands on it.
  return (t.exchanges || []).some((x) => (Number(x.startedAt) || 0) >= (Number(a.at) || 0)) ? null : a;
};
/**
 * What `stillMarked` last read of each file, by its path: its size and time, and whether it had the markers. The chat's
 * agents are polled every few seconds for as long as a file an apply marked keeps them, and a file is read again once
 * its size or its time moved — a rewrite that keeps both is not seen.
 * @type {Map<string, { size: number, mtimeMs: number, marked: boolean }>}
 */
const markedReads = new Map();
/** A file of the developer's that still has git's conflict markers in it, as an apply left them. @param {string} repo @param {string} path */
const stillMarked = (repo, path) => {
  const file = join(repo, path);
  try {
    const { size, mtimeMs } = statSync(file);
    const was = markedReads.get(file);
    if (was && was.size === size && was.mtimeMs === mtimeMs) return was.marked;
    const marked = /^<<<<<<< yours\r?$/m.test(readFileSync(file, "utf8"));
    markedReads.set(file, { size, mtimeMs, marked });
    return marked;
  } catch {
    markedReads.delete(file);
    return false;
  }
};
/**
 * @typedef {{ doc: any, sub: any, main: () => string | null | undefined }} ChatReading  a chat as one reading of its
 *   seats takes it (`chatOf`): its settings in force and their `subagents` section, and its main agent's model, read
 *   once where a seat needs it
 */
/**
 * @typedef {object} SavedDelivery  a waiting message as the session keeps it: the accounting stays behind, since the
 *   turn that launched the exchange is gone once the process is
 * @property {string} text
 * @property {string} from
 * @property {string} description
 * @property {"report" | "notice" | "task" | "overrule" | "applied" | "ask" | "check" | "told" | "result" | "shell"} kind
 * @property {number | null} [code]
 * @property {number} [ask]
 * @property {number} [exchange]
 * @property {string} [task]
 * @property {string} [state]
 * @property {boolean} [sent]
 * @property {boolean} [wrote]
 * @property {import("../turn-tree.js").Writes} [writes]
 * @property {boolean} [seal]
 * @property {string} [subject]
 * @property {string} [sender]
 * @property {"team" | "flow" | "chat" | "steer" | "agent"} [via]
 * @property {number} [envelope]
 * @property {boolean} [wakes]
 * @property {"check" | "command" | "merge" | "card"} [about]
 * @property {boolean} [fresh]
 */
/**
 * @typedef {object} HeldReport  a report kept aside for the developer, as the session keeps it: the words the main agent
 *   reads if they send it on after the registry forgot the sub-agent (no follow-up hint — a restart forgets it)
 * @property {string} agentId
 * @property {number} exchange
 * @property {string} description
 * @property {string} text
 */
/**
 * @typedef {object} SavedExchange  an exchange as a session keeps it: what was said and the figures — the work between
 *   is in its run's log
 * @property {string} prompt
 * @property {string} description
 * @property {SubagentOrigin} by
 * @property {string | null} runId
 * @property {string} [mirror]  one on another machine: its run here (`Exchange.mirror`)
 * @property {string} status
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {Exchange["delivery"]} delivery
 * @property {string[]} [pictures]
 * @property {string[]} [files]
 * @property {Exchange["handed"]} [handed]
 * @property {Exchange["caughtUp"]} [caughtUp]
 * @property {"restart" | "let-go"} [fresh]
 * @property {string} [why]
 * @property {number} [bounce]
 * @property {number} [folder]
 * @property {Drew[]} [drew]
 * @property {Made[]} [made]
 * @property {Exchange["moved"]} [moved]
 * @property {SentIn} [sentIn]
 * @property {{ report: string, error: string | null, ms: number, rounds: number, toolCalls: number, tokensIn: number, tokensOut: number, spentUsd: number, wrote: boolean, stoppedBy?: string | null, failure?: import("../../core/failure.js").Failure | null, fromLog?: boolean, held?: AgentHeld } | null} outcome
 *   null while it runs: found so after a restart, it was cut
 */
/**
 * @typedef {{ pooled: true, named: boolean, skipped: { model: string, why: string }[] }} SeatOf  a model that came
 *   from the session's pool (HarnessV4_Tasks E15 step 8): whether a row of the list named it — false for the row
 *   that is the main agent's model — and the rows ahead of it that were passed because their model could not run
 */
/**
 * A card's models, first choice first, as a launch reads them: a card from before the list — or one that names its
 * model alone, its list left empty — names one model or none.
 * @param {any} c @returns {string[]}
 */
const modelsOfCard = (c) => (Array.isArray(c?.models) && c.models.length ? c.models : c?.model ? [c.model] : []).map(poolName).filter(Boolean);
/**
 * A card's models as its session kept them, or null. @param {any} v @returns {CardModels | null}
 */
const modelsKept = (v) => {
  if (!v || !Array.isArray(v.list) || v.list.length < 2) return null;
  /** @param {any} x */
  const pair = (x) => ({ model: String(x?.model || ""), why: String(x?.why || "") });
  return {
    list: v.list.map(String),
    passed: (Array.isArray(v.passed) ? v.passed : []).map(pair),
    failed: (Array.isArray(v.failed) ? v.failed : []).map((x) => ({ ...pair(x), exchange: Number(x?.exchange) || 0 })),
    effort: String(v.effort || "model"),
    asked: v.asked === true,
    // The effort picked over its rows' and each row's own, as its launch kept them (the review of e5e7a75a0): a run
    // given back after a restart moves at its next row's too. One kept before them has none.
    ...(v.named !== undefined ? { named: typeof v.named === "string" && v.named ? v.named : null } : {}),
    ...(v.efforts && typeof v.efforts === "object" && !Array.isArray(v.efforts) ? { efforts: Object.fromEntries(Object.entries(v.efforts).filter(([k, e]) => k && typeof e === "string").map(([k, e]) => [k, String(e)])) } : {}),
    // The model its list's nameless row stood for at its launch (the review of 3664a7358): its lead's, for a worker.
    ...(typeof v.main === "string" && v.main ? { main: v.main } : {}),
  };
};
/** The kinds of call that act on nothing outside their run (core/tool-vocab.js): a read, a search, a listing, the web's, its own checklist. */
const LOOK_KINDS = new Set(["read", "search", "list", "web", "web-fetch", "web-search", "todo"]);
/** Calls that load what an agent reads and act on nothing: a skill, the tools held back. */
const LOADS = new Set(["skill", "Skill", "ToolSearch"]);
/** Memory's tools that only read it (the review of 7cd60efc5): a search, a session's material, the past sessions. */
const MEMORY_READS = /^filament_(recall|load|sessions|memory_(search|load|sessions|grep))$/;
/**
 * Whether a call that ended may have changed something outside its run, so that its run is never sent anew on another
 * model (the review of 3664a7358): anything but a read — `SIDE_BY_SIDE`'s, an MCP tool its server vouches for (`reads`),
 * a coding agent's by its name's kind, memory's —, its own checklist, a skill or tools loaded, and the commands of a
 * read-only agent of Filament's own loop, whose gate runs a command only where its checker reads it as looking. A coding
 * agent's are its own to allow, never held to that (the review of 7cd60efc5). A call refused, declined, vetoed or never
 * run did nothing.
 * @param {{ may: string, engine: string }} sa @param {any} e  its tool-end
 */
const actedBy = (sa, e) => {
  if (e.refused || e.declined || e.vetoed || e.notRun) return false;
  const name = String(e.name || "");
  if (SIDE_BY_SIDE.has(name) || e.reads === true || LOADS.has(name) || MEMORY_READS.test(name)) return false;
  const kind = kindOfName(name) || String(e.card?.kind || "");
  return !LOOK_KINDS.has(kind) && !(sa.may === "read" && sa.engine !== "acp" && kind.startsWith("shell"));
};
/**
 * @typedef {{ list: string[], passed: { model: string, why: string }[], failed: { model: string, why: string, exchange: number }[], effort: string, asked: boolean, named?: string | null, efforts?: Record<string, string>, main?: string }} CardModels
 *   the rows a sub-agent runs on one of (the owner's priority list of 10-19; every list since the owner's plan of 11-05:
 *   its card's — this chat's rows for it, else its card's —, a team's rows, the chat's list): the list, first choice
 *   first; those its launch passed, each with why; those its provider failed it on, by exchange, each with why — its
 *   run went on to the next. `effort`, `asked`: the effort it runs at now, and whether its launch named it. `named`: the
 *   effort picked over every row's — its launch's, its team's for the member, its Brief's for the crew — else null;
 *   `efforts`: each row's own, by model. A move reads them for the row it goes on to (the review of 11-05); a run kept
 *   from before them moves at `effort`. `main`: the model the list's nameless row stood for at its launch.
 */
/**
 * @typedef {{ level: string | null, wanted: string | null, levels: string[] | null, spelled: boolean }} SubagentEffort
 *   the effort a sub-agent runs at (HarnessV4_Tasks E23-D5): `level`, the one its requests carry — none where its model
 *   takes none, or none was wanted; `wanted`, its launch's or its session's (`model`: none); `levels`, those its model
 *   takes, null where it takes none; `spelled`, its name spells its level, kept since its launch asked for none
 */
/**
 * @typedef {object} SavedThread  a sub-agent as its session keeps it across a restart (HarnessV4_Tasks E15 step 5,
 *   BW-10): who it is — its card as it stood at its launch — what it was shown by kind and size, where it last looked
 *   at its session, its worktree's state, each exchange, and its conversation as its last exchange left it (10-26).
 *   Given back with its conversation whole, its next message goes on in it; without — a restart cut an exchange, or a
 *   message of it is kept no more — its next message starts a fresh agent that reads what was said
 * @property {string} id
 * @property {SubagentOrigin} origin
 * @property {boolean} [heard]  your agent started it on a card your message named, one the session's list does not
 *   hold (U13 revised: "sent by your agent — you named it")
 * @property {boolean} [second]  a second look (HarnessV4_Space_Plan S3b): Filament started it on a move that asks,
 *   the Reviewer reading it for the person — no row in the chat's transcript, never a card's own thread
 * @property {string} [weighs]  a fork that weighed the person's message aside (the owner's forked steer of 11-04), by
 *   the message's id: no row in the chat's transcript, never a card's own thread
 * @property {"read" | "copy" | "edit"} may
 * @property {boolean} asked
 * @property {CardOf} card
 * @property {TeamOf | null} team
 * @property {string} model
 * @property {SeatOf | null} [seat]
 * @property {CardModels | null} [models]
 * @property {SubagentEffort | null} [effort]
 * @property {string | null} [wire]
 * @property {"side" | "workers"} [list]
 * @property {import("../../core/pool.js").PoolRow[]} [crew]  a team's worker's rows (the review of 3664a7358)
 * @property {string} description
 * @property {string} cwd
 * @property {import("./prompt.js").PermissionMode | null} mode
 * @property {string} view
 * @property {boolean} running
 * @property {string | null} changes
 * @property {string | null} start
 * @property {Subagent["seen"]} seen
 * @property {boolean} memory
 * @property {boolean} deliver
 * @property {boolean} aside
 * @property {string} status
 * @property {number} startedAt
 * @property {string | null} shares
 * @property {string | null} [noCopy]
 * @property {boolean} cut  a restart cut its newest exchange
 * @property {any} thinking  the thinking its launch named (a copy of the main agent ran on that agent's, and keeps none)
 * @property {{ kind: Opening["kind"], count: number, chars: number, text?: string, model?: string, exchange?: number }[]} opening  the blocks its
 *   first message opened with, and the brief a fresh start's message opened with (`exchange`): the kind, the count and
 *   the size of each — and of memory's brief its conversation opens with, the words and the model it was written for,
 *   which a run that goes on to a model Memory settings exclude is sent without (`forModel`)
 * @property {{ repo: string, base: string, head: string | null, files: import("../../adapters/git/worktree.js").ChangedFile[], applied: Applied[], undone?: string, kind?: "patch", copy?: { kind: "clone" | "sparse", paths: string[] }, there?: true, left?: { path: string, why: string }[], dest?: string } | null} work
 * @property {SavedExchange[]} exchanges
 * @property {number} [questions]  how many questions it had asked (TG2-D42): given back, it numbers its next after them
 * @property {import("./grants.js").Grants} [grants]  what its brief and its card let it run without anyone's answer (TG2-D44): given
 *   back, its next message in a worktree of its own runs on them again
 * @property {Subagent["checked"]} [checked]  what Filament's check last saw of its work (TG2-D45): given back, an apply of
 *   a change it saw fail still needs a reason
 * @property {Subagent["folderRed"]} [folderRed]  the folder's check that undid its lead's apply of the change that waits
 *   (TG2-D55): given back, an apply of it again still needs a reason
 * @property {Subagent["folderUndone"]} [folderUndone]  the folder's check that undid its lead's last apply (TG2-D55):
 *   given back, a reason may still carry the change
 * @property {Omit<Attempt, "stopped">} [attempt]  which attempt at its brief it was (TG2-D53): given back, a dropped one
 *   still takes no follow-up, and a report that waited for its group still reaches its lead
 * @property {any[] | null} [convo]  its conversation as its last exchange left it — its calls and what they returned
 *   with its messages — the session keeping each message once, by its hash; null where it is not there whole
 * @property {string} [task]  a graph task's worker, kept while its change waits for the developer's Apply (10-28): the
 *   task it did
 * @property {string} [hunts]  a Hunter: the graph task it hunted bugs in (UX9), which that task's box counts after a
 *   restart too
 * @property {Hunted} [hunted]  that task as the graph held it at the launch (11-02): its report names it after a
 *   restart, and a task its finding names hangs off it
 * @property {import("./remote-agents.js").RemoteChat} [remote]  one launched on another machine (the remote-agents plan's
 *   s-launch): its chat there, which a follow-up goes on in after a restart too
 */
/**
 * @typedef {object} Hunted  the graph task a Hunter was fired from, as the graph held it at the launch (11-02)
 * @property {string} name  its name, which the hunt's report names it by
 * @property {number} graph  the start of the graph that held it: a task of another graph is not that one
 */
/**
 * @typedef {object} Attempt  one of two or three workers its lead launched at once on one brief (HarnessV3-TaskGraph-v2
 *   TG2-D53): the first whose check passes is the lead's worker
 * @property {string} group  the launch's first attempt's id, which every attempt of it carries
 * @property {number} n  which attempt, from 1
 * @property {number} of  how many the launch made
 * @property {boolean} won  its check passed first: it is its lead's worker
 * @property {string | null} dropped  its work was dropped: the winner's id, or `refused` where its launch was
 * @property {boolean} [stopped]  Filament stopped it as another won, for the winner's line; never kept
 */
/**
 * @typedef {object} Mark  the developer's sub-agent in the session's transcript: sent off, or its report back — and,
 *   never drawn as a row of its own, a kept report the developer sent on ("sent"), which its arrival row reads after
 *   the registry has forgotten the sub-agent, and an answer the developer overruled ("overruled", HarnessV4_Tasks E15
 *   step 3), which that answer's card reads
 * @property {"dispatch" | "arrival" | "sent" | "overruled"} event
 * @property {string} agentId
 * @property {number} exchange  which exchange (0 the launch, then each follow-up)
 * @property {string} description
 * @property {number} at
 * @property {string} [model]
 * @property {string} [view]
 * @property {string} [may]  a dispatch's: what it may do (agent-cards.js CARD_MAY)
 * @property {boolean} [memory]
 * @property {boolean} [pause]  it holds the running turn until it reports
 * @property {boolean} [inform]
 * @property {boolean} [deliver]  its report goes to the main agent by itself
 * @property {string} [words]  an "overruled" mark's: the first line of what the developer wrote
 * @property {boolean} [followUp]
 * @property {string} [status]  how the exchange ended
 * @property {number} [ms]
 * @property {number} [rounds]
 * @property {number} [toolCalls]
 * @property {"auto" | "held"} [delivery]  the report went to the main agent, or waits for the developer to send it
 * @property {number} [changes]  files its worktree changed that wait to be applied
 * @property {string} [handed]  the change it was handed as a patch, as the launch named it: `running`, `turn`,
 *   `uncommitted` or `since:<ref>` — and, on its arrival, `handedFiles`: how many files that was
 * @property {number} [handedFiles]
 * @property {string} [error]
 * @property {{ id: string, name: string }} [machine]  the machine one launched on another machine works on
 * @property {{ tag: string, name: string }} [card]  the card it runs as (HarnessV4_Tasks E15)
 * @property {boolean} [asked]  it was asked by its tag: its marks carry what the chat's card shows after the registry
 *   forgot it — the question, and at its end the answer whole with its figures (AG-19)
 * @property {string} [question]
 * @property {string[]} [pictures]  the pictures the question carried, by name
 * @property {string} [answer]
 * @property {number} [tokensIn]
 * @property {number} [tokensOut]
 * @property {number} [spentUsd]
 */
/**
 * @typedef {object} CacheSnapshot  the main agent's newest request, while the provider may still cache its prefix
 * @property {any} body  the request as sent, with its reply appended once the turn is over (a fork's base)
 * @property {Record<string, string>} headers  a fork's headers: the tick's quiet memory, the developer's lineage
 * @property {number} sentAt  when the request went out (a cache hit renews the provider's timer from then)
 * @property {number} ttlMs  the cache lifetime the request's markers asked for
 * @property {boolean | null} cached  its reply read or wrote the provider's cache (null: its usage is not known)
 * @property {number} tokens  the prompt it carried
 * @property {number} [reply]  the tokens its reply wrote, its thinking among them: a fork copies the reply after the prompt
 */
/**
 * @typedef {object} LaunchParent  the turn whose `agent` call launched a sub-agent
 * @property {LiveTurn} live
 * @property {string} toolUseId  every event relayed to the turn's run carries it as `parent`
 * @property {(evt: any) => void} emit  the turn's timeline (the loop stamps the launching round)
 * @property {AbortSignal | null} signal  the turn's hang-up (a foreground sub-agent dies with it)
 * @property {AbortSignal | null} [stopSignal]  the turn's stop from the harness: a foreground sub-agent is stopped
 *   through its own run — it ends "stopped" in its words, its report kept — never cut off (BUG-08)
 * @property {number} [round]  the round its call was made in, where that is not the turn's round now (`LeadCall`)
 */
/**
 * @typedef {object} LeadCall  a team's launch as its lead's call names it, plain JSON (HarnessV3-AtHome AH-O10)
 * @property {string} runId  the lead's turn
 * @property {string} callId  the call
 * @property {number} [round]  the round the call was made in, where the turn has moved on since: a coding agent's order
 *   the developer approved after its call had answered (HarnessV3-ACP AC6-7)
 */
/**
 * @typedef {object} LaunchSpec
 * @property {SubagentOrigin} origin
 * @property {string} chainId  the launching session
 * @property {string} prompt  the task
 * @property {string} [description]  three to five words for the cards; the task's first line when missing
 * @property {string} [worker]  the worker card a launch runs as, by its tag (services/agent-cards.js): missing,
 *   Builder — `builder` and `reviewer` are whoever holds those places in the session (AG-80). A team's worker is its role's
 *   card, and a launch that names `as` leaves this out
 * @property {string} [may]  what it may do in this launch, where lower than its card says: `read`, or `copy` (AG-8)
 * @property {string} [model]  empty: a team's worker's the one its team names for the member where it names one; else its
 *   card's, else the first free seat of its list: a team's worker's its team's own models where it names any, every
 *   other one's — and a graph task's — `subagents.pool` (U13-D14)
 * @property {string | null} [effort]  the effort it runs at (E23-D5): one of SUBAGENT_EFFORTS, `model` for none;
 *   missing, the main agent's (`model.effort`, the owner's word of 11-05). It runs at the highest level its model takes
 *   at or below it
 * @property {{ model: string, effort?: string | null }[]} [among]  an agent's launch that named a model of the list the
 *   person set (the owner's of 11-19): the rows of it that serve that model, in the list's order — run as a card's
 *   models are, the first with room at its row's effort, a failure moving down them; `model` is left for the words
 * @property {string | null} [chose]  the launch's words on its choice of model (core/model-choice.js `Choice.note`) —
 *   who else serves it, a provider passed over — which its answer says; "" where it named a model with nothing to add
 * @property {string} [view]  a SUBAGENT_VIEWS name; missing: its card's. `fork` copies the main
 *   agent's request as it stands — its model (a different `model` is refused), system prompt, tools, thinking and
 *   every message — so the provider reads that prefix from its cache
 * @property {boolean} [warm]  it starts as a fork where the main agent's cache is warm, a fork pays (`forkPays`) and
 *   the main agent's model has a free seat — else as `view` says (Catch me up, the owner's of 11-05). A launch that
 *   names a model or an effort is never one
 * @property {boolean} [running]  it is also shown the turn running at its launch, from that turn's run log
 *   (HarnessV4_Tasks E13-1, BW-6); with no turn running, nothing is said of one
 * @property {string | null} [changes]  it is also shown a change as a patch (BW-5; changes-view.js): `running`, what
 *   the turn running now has changed so far; `turn`, the last finished turn's; `uncommitted`, everything uncommitted
 *   in the session's folder; `since:<ref>`, everything since a commit, tag or branch. Missing: what its card says
 * @property {string | null} [start]  the start that filled its fields (services/subagent-starts.js), for the surfaces
 * @property {"message"} [since]  of the session's finished turns it is shown only those since the developer's last
 *   message (`SubagentContext.sinceMessage`): Catch me up's
 * @property {boolean} [background]  the launcher does not wait (an agent's launch; the developer's always run so)
 * @property {boolean} [deliver]  the report goes to the session's loop when it ends (default: a background launch
 *   by the agent, and every launch by the developer). A developer's launch with `false` stays aside: the report is
 *   theirs until they `send` it (`/subagent wait=on` answers with the report itself, the same way)
 * @property {boolean} [pause]  the developer's: the turn running at the launch waits for this report before its next
 *   round (nothing runs: nothing to hold). Needs `deliver`
 * @property {boolean} [inform]  the developer's: the running loop hears at once what was launched and why. Needs `deliver`
 * @property {string} [cwd]  default: the session's folder
 * @property {boolean} [worktree]  one that edits works in its own git worktree; missing: the session's
 *   `subagents.worktree`. One that runs in a copy always has one: only the developer's `false` gives it the folder
 * @property {"auto" | "patch" | "worktree" | "folder"} [workspace]  where one that edits works, over the session's
 *   `subagents.workspace` (workspace-kind.js): Auto, a patch workspace, a worktree, or the session's folder
 * @property {import("./prompt.js").PermissionMode | null} [mode]  a mode its runs keep (the launching request named one);
 *   none: each call follows the session's mode as it stands (HarnessV3-AtHome AH-F1)
 * @property {string} [parentModel]  the launching loop's model — a coding agent's too, whose launch takes its model as
 *   the loop's does: a card's "Same as the main agent" and the pool's nameless row are the agent's own model, on its own
 *   account (the owner's of 11-06, where AG-238 had kept a coding agent's helper to a named row)
 * @property {any} [thinking]  the launching loop's thinking parameter
 * @property {LaunchParent | null} [parent]
 * @property {string | null} [requestId]  the record that launched it (a command's), for the lineage
 * @property {WorkerOf | null} [team]  a team's worker: its team, its role, its card, the team's own line for it, and the
 *   model and effort the team runs it on — each taken where the launch names none
 * @property {readonly { tag: string }[] | null} [roster]  a lead's ask: its team's members, whom a refusal's words name
 * @property {boolean} [said]  the session's agent names a saved agent the developer's newest message names in plain
 *   words (`saved_agent`): it may launch it though its session does not name it
 * @property {string} [as]  a saved agent asked by its tag (HarnessV4_Tasks E15, AG-79): the launch runs as that card —
 *   what it sees, its model, what it may do and how it thinks are the card's, each field the launch names itself
 *   winning — and its answer goes back to whoever asked: a developer's stays with them unless `deliver` says
 *   otherwise
 * @property {string} [why]  a start by itself (`origin: "self"`): why it started, in a line — the turn that ended, the
 *   clock, a sign — which its exchange keeps, and which its card in the chat says in the question's place
 * @property {boolean} [second]  a start by itself that is a second look (HarnessV4_Space_Plan S3b, `origin: "self"`):
 *   it leaves no mark in the chat
 * @property {string} [weighs]  a start by itself that is a fork weighing the person's message, by its id, aside from
 *   the running turn it forks (the owner's forked steer of 11-04, `origin: "self"`, view fork): its task is the
 *   message, under the steer fork's note, and it leaves no mark in the chat, as a second look
 * @property {{ name: string, mediaType: string, data: string }[]} [images]  the pictures that go with the task, after
 *   its words (HarnessV4_Tasks E15 step 2): sent as they are — no model's abilities are guessed — and a provider's
 *   refusal of them is the exchange's failure, in its words, remembered for that model (`refusedPictures`)
 * @property {{ name: string, text: string }[]} [attachedFiles]  the text files the main agent attached (`attach`,
 *   attach.js), each a block after the task's words and ahead of its pictures, by the name it gave
 * @property {{ of: string, files: number, diff: string, inFolder?: boolean } | null} [review]  a reviewer's: the change, not applied yet, it
 *   reads ahead of its brief
 * @property {LeadCall | null} [lead]  a team's launch: the lead's turn and its call — the registry finds the turn, in
 *   place of `parent`
 * @property {{ id: string, review: boolean } | null} [task]  a task of the session's task graph, launched by its runner
 *   (HarnessV3-TaskGraph G2) — its work, or, `review`, the reading of its change (G3-3): the prompt is its brief, it is
 *   never a fork, and its end goes to the runner, never to the main agent
 * @property {import("../../core/signs.js").WorkerFiles | null} [files]  what its task says of its files — a brief's
 *   files and what not to touch, a graph task's writes: a write outside them is a sign its lead's look names
 *   (HarnessV3-TaskGraph-v2 TG2-D15)
 * @property {import("./grants.js").Grants | null} [grants]  a team's worker: what its brief lets it run without anyone's
 *   answer, in a worktree of its own (HarnessV3-TaskGraph-v2 TG2-D44) — refused at the launch where one names the
 *   developer's folder or a rule of the session's speaks for it
 * @property {boolean} [planReview]  a team's worker whose lead reviews its plan before it changes anything
 *   (HarnessV3-TaskGraph-v2 TG2-D50): its launch's run starts held, where its lead reads along
 * @property {{ n: number, of: number, group: string | null }} [attempt]  a team's worker that is one attempt of several
 *   at its brief (TG2-D53, `attempts`): which, of how many, and the group's id — none for the first, which names it
 * @property {string | null} [batch]  the launches asked with it across passes — one round's agent calls — which share
 *   one snapshot of the folder (Phase 0 of the owner's 11-09 plan for big repos); else those of its pass (`passBatch`)
 * @property {import("../../core/pool.js").PoolRow[] | null} [rows]  a team's worker: the models its team runs its
 *   workers on, in order (team_v2_plan TV2-D8, `teamRows`) — its list's rows, before its card's models and the
 *   chat's own list (U13-D8)
 * @property {boolean} [waits]  a lead's worker — or a flow's box (`origin: "flow"`, FL-D20), or a graph task's worker or
 *   reader (`task`): where the seats or the slots are all taken it waits for room, its card saying for
 *   what, in the place of a refusal (team_v2_plan §5.7)
 * @property {string | null} [hunts]  the graph task a Hunter hunts bugs in, by its id (HarnessV4_DesignPass_Plan UX9): the
 *   Plan view's Hunt bugs names it, so the task's box says who was fired from it
 * @property {boolean} [dry]  only whether it would go: its refusal, or ok with the model it would run on and whether it
 *   would have a copy of its own (`dry`) — nothing made, nothing taken (the card for sub-agents that change files asks it)
 */
/**
 * @typedef {object} CardOf  the saved agent a sub-agent runs as (HarnessV4_Tasks E15), as it stood at the launch
 * @property {string} tag
 * @property {string} name
 * @property {string} thinks  the card's own paragraph, in the sub-agent's instructions
 * @property {string} may  what the card lets it do; its launch may have lowered that (`Subagent.may`)
 * @property {string[]} [toolsOff]  the tools the card goes without (HarnessV4_ShippedAgents_Plan SA2), where it goes
 *   without any
 */
/**
 * @typedef {object} TeamOf  the team a worker works for (HarnessV3-AtHome P2)
 * @property {string} key
 * @property {string} name
 * @property {string} role  the member it is, by its id: its card's tag, or the name the team gives that seat
 * @property {string | null} [place]  the shipped worker its card is or was copied from: the glyph its card wears
 * @property {string} words  the team's words for that member, in the worker's prompt
 * @property {string} [seat]  the name the team gives that member's seat, where it gives one: what the worker is called
 * @property {string} [model]  the model the team runs that member on, where it names one: a new launch of it runs there
 * @property {string} [effort]  the effort the team runs that member at, where it names one
 * @property {string} [check]  its team's check (the plan's p6), where the team names one and the member changes files:
 *   given as its brief's check is (grants.js `withTeamCheck`)
 */
/**
 * @typedef {TeamOf & { card?: string }} WorkerOf  a team's worker as its launch names it (core/roster.js `workerOf`): its
 *   card's tag, which it runs as, where the team names the seat — else its role is its card's tag
 */
/**
 * A worker's team as a worker keeps it, its seat's name, the team's model and effort for it and its team's check only
 * where it has them.
 * @param {TeamOf} t @returns {TeamOf}
 */
const teamKept = (t) => ({ key: t.key, name: t.name, role: t.role, place: t.place ?? null, words: String(t.words || ""), ...(t.seat ? { seat: String(t.seat) } : {}), ...(t.model ? { model: String(t.model) } : {}), ...(t.effort ? { effort: String(t.effort) } : {}), ...(t.check ? { check: String(t.check) } : {}) });
/**
 * @typedef {{ tag: string, card?: string, own?: { model?: string } }} TeamModelsOf  a team's member as the models its lead's
 *   line names read it: its id, its card (core/roster.js `memberCard`), and the model the team names for it
 */
/**
 * @typedef {object} Outcome  how one exchange with a sub-agent ended
 * @property {string} status  the loop's word ("done", "budget-stopped", "stopped", "aborted", "failed")
 * @property {boolean} ok
 * @property {string} report  its final words
 * @property {string | null} error
 * @property {number} ms
 * @property {number} rounds
 * @property {number} toolCalls
 * @property {number} tokensIn
 * @property {number} tokensOut
 * @property {number} spentUsd
 * @property {string[]} roundIds  its model calls
 * @property {boolean} wrote  its hands changed the working tree
 * @property {boolean} [commands]  it ran a command, which may write anywhere: the round that hears of it reads what
 *   changed meanwhile apart (HarnessV4_Git_Plan GWC-13)
 * @property {string | null} stoppedBy  who stopped it, when a stop ended it: the developer's harness, its team's lead, or
 *   the session's agent with its agent tool (`agentStop`)
 * @property {import("../../core/task-graph.js").TaskReport | null} taskReport  what a graph task's sub-agent reported
 * @property {import("../../core/failure.js").Failure | null} [failure]  why it failed, in one shape (HarnessV3-FailurePoints
 *   §5.2); `error` says it in one line
 * @property {string[]} [unread]  a worker whose lead reads along: the lead's messages it ended without reading, in
 *   their words (HarnessV3-TaskGraph-v2 TG2-D16) — its report says them
 * @property {boolean} [readAlong]  its lead read along with this exchange: the report names the read of its change
 * @property {import("./check.js").CheckOutcome} [check]  a worker whose brief gave a check: how Filament's run of it went
 *   once the worker reported, or why it did not run (TG2-D45) — the report says it
 * @property {string} [unchecked]  a worker whose report says its work was checked where no command ran after its last
 *   change, and Filament ran no check: what Filament saw, in a look's words (core/watch.js `uncheckedAt`)
 * @property {boolean} [fromLog]  it ended before it reported (a restart, a crash, its loop's throw, a failure before its
 *   last round said anything): `report` is what its run's log shows it had written and called (core/run-work.js
 *   `cutReportOfRun`), said as such (the transcript audit, 2026-10-23)
 * @property {AgentHeld} [held]  a coding agent's: what its context held as the exchange ended
 * @property {string} [agentModel]  a coding agent's: the model its agent says answered the exchange
 * @property {OtherModel} [otherModel]  a coding agent's: that model, where it is not the one the sub-agent was launched on
 */
/**
 * The model that answered a coding agent's exchange where it is another than the one asked for (app/acp-turn.js
 * `weighModel`): `chosen` as sent to the agent, `answered` as the agent said it.
 * @typedef {{ chosen: string, answered: string }} OtherModel
 */
/** An outcome's `agentModel` and `otherModel` as kept or handed over: nothing where it names none. @param {any} v @returns {{ agentModel?: string, otherModel?: OtherModel }} */
const answeredKept = (v) => ({
  ...(v?.agentModel ? { agentModel: String(v.agentModel) } : {}),
  ...(v?.otherModel?.chosen && v?.otherModel?.answered ? { otherModel: { chosen: String(v.otherModel.chosen), answered: String(v.otherModel.answered) } } : {}),
});
/**
 * What a coding agent's context held as a sub-agent's exchange ended, as the agent counted it (its record's
 * `context.last`), and the window it named, where it named one: what its next message is weighed against its line by
 * (acp-turn.js `exchangesGiveWay`).
 * @typedef {{ tokens: number, window: number | null, estimated?: true }} AgentHeld
 */
/** An outcome's `held` as a session kept it: nothing where it kept none. @param {any} v @returns {{ held?: AgentHeld }} */
const heldKept = (v) => (Number(v?.tokens) > 0 ? { held: { tokens: Number(v.tokens), window: Number(v.window) > 0 ? Number(v.window) : null, ...(v.estimated === true ? { estimated: /** @type {const} */ (true) } : {}) } } : {});
/**
 * @typedef {object} HostFinish  what turn.js reports when a sub-agent's run ends
 * @property {string} status
 * @property {string | null} error
 * @property {string} report
 * @property {any[] | null} convo  the whole conversation, for a follow-up
 * @property {number} rounds
 * @property {number} toolCalls
 * @property {number} tokensIn
 * @property {number} tokensOut
 * @property {number} spentUsd
 * @property {string[]} roundIds
 * @property {string | null} [stoppedBy]  who stopped the run, when a stop ended it (its loop's `stoppedBy`)
 * @property {import("../../core/task-graph.js").TaskReport | null} [taskReport]  a graph task's sub-agent's report
 * @property {import("../../core/failure.js").Failure | null} [failure]  why its run failed, when it did
 * @property {AgentHeld | null} [held]  a coding agent's run: what its context held as it ended
 * @property {string | null} [agentModel]  a coding agent's run: the model its agent says answered
 * @property {OtherModel | null} [otherModel]  a coding agent's run: both names where that is not the model it asked for
 * @property {any[]} [start]  a coding agent's run whose earlier exchanges gave way before its prompt went (acp-turn.js
 *   `exchangesGiveWay`): the messages it went from — a fresh session's seed — which a next try of the exchange goes
 *   from too
 */
/**
 * @typedef {object} Progress  how a running exchange goes, from its run's events (HarnessV3-AtHome AH-O5): what a team's
 *   lead's watch lists, and the team view's cards read
 * @property {number} round  the round its loop is in (0 before its first)
 * @property {{ name: string, args: string } | null} tool  its newest tool call
 * @property {{ tokens: number, window: number | null, usable: number | null, estimated?: true } | null} context  what its
 *   newest round sent — a coding agent's: what its agent counts its context holds (`estimated`: Filament's count, where
 *   the agent says none) — against its model's window and its compaction line, the tokens at which room is made in
 *   the middle of its work (null where nothing says: an agent that takes no line makes room at a point of its own)
 * @property {{ round: number, at: number, how: string }[]} compactions  each compaction of its work, and how it was made
 * @property {string} words  the head of its newest words, on one line
 * @property {RunningCall | null} call  the model call its round is making, while it runs (HarnessV3-FailurePoints §5.1)
 * @property {string | null} wait  a model call's wait, in its loop's words: for a slot at its provider, to try again
 * @property {number | null} spent  what its own model calls have cost so far, in USD — null while none is priced
 * @property {(import("./loop.js").AskedCall & { n: number }) | LeadAsking | null} asking  the call that waits for the
 *   developer's answer (a team's worker): the question, the always-allow waiting for its shape, a command whole and as
 *   it runs (HarnessV3-Views V6-9), and its number among the worker's questions — ask 1, ask 2, over its whole life —
 *   which an answer names (HarnessV3-TaskGraph-v2 TG2-D42); or its question to its lead (TG2-D49), which is its lead's
 * @property {{ kind: string, round: number, words: string }[]} [signs]  a worker whose lead reads along: its signs
 *   since its lead's last look (HarnessV3-TaskGraph-v2 TG2-D22)
 * @property {{ read: number, unread: number }} [lead]  the same worker: how many of its lead's messages it has read,
 *   and not yet
 * @property {{ command: string, began: number } | null} check  Filament's check of its report, while it runs: the command
 *   it runs, and since when (TG2-D45)
 * @property {{ command: string, n: number, folder?: boolean } | null} bounce  this exchange is Filament's return of the
 *   worker, its check having failed: on which command, and the first time or the second — or, `folder`, the folder's
 *   check after its lead applied its change (TG2-D55)
 * @property {boolean} [held]  its changes and commands wait for its lead's review of its plan (HarnessV3-TaskGraph-v2
 *   TG2-D50): from its launch's start until its lead's go, or 3 minutes after its plan with no answer
 */
/**
 * @typedef {object} LeadAsking  a worker's question to its lead, as its progress carries it (HarnessV3-TaskGraph-v2
 *   TG2-D49): its lead's to answer, never the developer's to allow — no call waits on it, and a switch answers none
 * @property {"lead"} to
 * @property {"ask_lead"} tool
 * @property {""} args  no call's arguments: what reads a waiting call's reads none
 * @property {string} question
 * @property {string[]} options  the ways it sees, its pick first (none where it gave none)
 * @property {number} n  its number among the worker's questions (TG2-D42)
 * @property {number} at  when it asked, on the registry's clock: how long it has waited runs from there — a plan's 3
 *   minutes too
 * @property {boolean} plan  it is its plan, sent while its lead reviews it (TG2-D50): a go lets its changes run
 */
/**
 * @typedef {object} LeadAsk  a worker's question to its lead, open, or ended with its end not yet read (TG2-D49)
 * @property {number} n
 * @property {string} question
 * @property {string[]} options
 * @property {boolean} plan  it is the worker's plan, sent for its lead's review
 * @property {number} at
 * @property {"answered" | "none" | "stopped" | null} done  how it ended — answered; no answer, its lead's turn having
 *   ended or, for a plan, its 3 minutes passed (TG2-D58); its stop — or null while it waits
 * @property {{ text: string, by: "lead" | "developer", go: boolean } | null} answer  `go`: its plan's go, said by a field (never read from the words)
 * @property {Set<() => void>} wake  the call that waits for its end, told when it comes
 */
/**
 * @typedef {{ ok: true, n: number, how: "answered", text: string, by: "lead" | "developer", options: string[], plan: boolean, go?: boolean, held?: true }
 *   | { ok: true, n: number, how: "none" | "stopped", options: string[], plan: boolean, held?: true }
 *   | { ok: true, n: number, how: "later", waited: number, options: string[], plan: boolean, held?: true }
 *   | { ok: false, error: string }} LeadAnswer  how a worker's question to its lead came back (TG2-D49): answered — by its
 *   lead, or the developer, whoever was first — no answer, its lead's turn having ended (TG2-D58) or, for its plan, its 3
 *   minutes passed; its stop; or, for a coding agent's call that may hold only so long, not yet, after `waited` ms; or
 *   refused, in words. Its plan's answer (TG2-D50) says whether it was a go, which lets its changes run; `held`: a
 *   question of a worker whose plan is still to come
 */
/**
 * @typedef {object} RunningCall  a running model call, as a worker's progress keeps it: whose round, when it began, the
 *   characters streamed of each kind, and when the newest came (null before any) — a stuck call reads as one
 * @property {number} round
 * @property {number} began
 * @property {number} thinking
 * @property {number} text
 * @property {number | null} lastAt
 */
/**
 * @typedef {object} Exchange  one task or follow-up and how it went
 * @property {string} prompt
 * @property {string} description  what it was asked, in a line (`lineOf`): a row names a sub-agent by its newest
 *   exchange's, so a follow-up's task shows (HarnessV3-Launch RD-D5)
 * @property {SubagentOrigin} by  who started it (a follow-up may come from someone other than the launcher)
 * @property {string | null} runId  the host request's id (its run in the run log)
 * @property {string} [mirror]  one on another machine: the run here that shows its turn there (`mirrorRun`) — never
 *   `runId`, which a stop or a message steers into
 * @property {string} status
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {Outcome | null} outcome
 * @property {"tool" | "auto" | "held" | "sent" | "task" | "back" | "attempt" | "dropped" | "flow" | "weighed" | null} delivery  where the report
 *   went once it ended: the agent call's result, the main agent by itself, nowhere yet (the developer's to send), sent on
 *   by the developer, to the task graph's runner (a graph task's), back to the worker, by Filament, its check having
 *   failed (TG2-D45) — or, an attempt at a brief (TG2-D53), waiting for the others' ends, or nowhere: another won — or
 *   to the flow it is a box of, whose runner hands it on (HarnessV4_Flow_Plan F2) — or to the turn whose person's
 *   message it weighed, whose steer-fork.js reads its verdict (`weighs`): never to the main agent
 * @property {number} [bounce]  Filament sent the worker back with this exchange, its check having failed: the first time
 *   or the second (TG2-D45). Its report answers the task that many exchanges back
 * @property {number} [folder]  Filament sent the worker back with this exchange, the folder's check having failed with its
 *   change once its lead applied it: the first time or the second (TG2-D55). Its report answers the task before it
 * @property {string[]} [pictures]  the pictures its message carried, by name
 * @property {string[]} [files]  the text files the main agent attached to its message (`attach`), by the names it gave
 * @property {{ source: string, files: number | null, note?: string }} [handed]  the change its message carried as a
 *   patch, as it was named, how many files that was (null until the message is composed), and why it held none
 * @property {{ turns: number, rounds: number, tokens: number } | null} [caughtUp]  what a follow-up's message carried
 *   of the session since its sub-agent last looked (BW-7): the turns finished, the running turn's rounds, and the
 *   block's size in estimated tokens
 * @property {"restart" | "let-go"} [fresh]  a fresh agent took the thread up with this exchange, and why its own
 *   conversation was gone (BW-10): Filament restarted, or the registry had let it go
 * @property {string} [why]  why it started by itself (`LaunchSpec.why`)
 * @property {Drew[]} [drew]  the pictures it drew in this exchange, in the order drawn (HarnessV4_Visuals_Plan VS-D50)
 * @property {Made[]} [made]  the artifacts it published in this exchange, each once at its newest version, in the
 *   order first published (HarnessV4_Artifacts_Plan AFC-100)
 * @property {{ model: string, why: string, runId: string | null }[]} [moved]  the models of its card its provider failed
 *   it on in this exchange, in order, each with why and its run: the message went on to the next (`CardModels`)
 * @property {SentIn} [sentIn]  the turn that sent it and the round of that turn, where a turn's call did: the agents one
 *   reply sent stand side by side in the picture of the main agent's own work (HarnessV4_OneAgent_Plan L47)
 */
/**
 * @typedef {{ run: string, round: number | null }} SentIn  a turn's run, and its round where the turn counts rounds (a
 *   coding agent's may not)
 */
/**
 * @typedef {{ id: string, title: string, bytes: number, turn?: number, session?: true }} Drew  a picture a helper drew,
 *   as the card that launched or asked it lists it: where it is kept — the turn that launched it by its number, or its
 *   session (VS-D48) — which a page reads it back from
 * @typedef {{ name: string, v: number, title: string, address: string }} Made  an artifact a helper published: its
 *   name, the version, its title then, and its address at the port Filament listened on
 * @typedef {{ id: string, title: string, bytes: number, by: string, task: string, at: number }} PictureOf  one picture as
 *   an agent opens it: who drew it, in answer to what (its exchange's task), and when
 * @typedef {{ found: (PictureOf & { code: string }) | null, gone: PictureOf | null, older: PictureOf[], names: PictureOf[] }} Picture
 *   a picture asked for by its name or its id (HarnessV4_DesignPass_Plan UX1): `found`, the newest of that name, whole;
 *   `gone`, one listed whose code is no longer kept; `older`, the others of that name; `names`, with none found, the
 *   session's pictures, newest first
 */
/**
 * @typedef {object} Subagent
 * @property {string} id
 * @property {string} chainId
 * @property {SubagentOrigin} origin
 * @property {boolean} [heard]  your agent started it on a card your message named, one the session's list does not
 *   hold (U13 revised: "sent by your agent — you named it")
 * @property {boolean} [second]  a second look (HarnessV4_Space_Plan S3b): Filament started it on a move that asks,
 *   the Reviewer reading it for the person — no row in the chat's transcript, never a card's own thread
 * @property {string} [weighs]  a fork that weighs the person's message aside (the owner's forked steer of 11-04), by the
 *   message's id: no row in the chat's transcript, never a card's own thread
 * @property {"read" | "copy" | "edit"} may  what it may do (AG-7): read only; run in its own copy of the project,
 *   nothing kept; edit — in its own copy where it has one, applied by whoever called it
 * @property {boolean} asked  it was asked by its tag (AG-79): it answers whoever asked, as the chat's card — one agent's
 *   answer that whoever asked weighs, and memory does not learn from it; what it may do is its card's level, or lower
 * @property {"loop" | "acp"} engine  what runs it (HarnessV3-AtHome AH-O10): Filament's agent loop, or the coding agent
 *   its model names (HarnessV3-ACP AC6-1), in an agent session of its own
 * @property {TeamOf | null} team  a team's worker, or null
 * @property {CardOf} card  the saved agent it runs as: Builder where its launch named none
 * @property {{ id: string, review: boolean } | null} task  the graph task it does (HarnessV3-TaskGraph G2) — or whose
 *   change it reviews (G3-3) — or null
 * @property {string | null} [taskWas]  given back after a restart, the graph task it did, whose change waited for the
 *   developer's Apply (10-28): its thread names it, and it takes no follow-up — the graph is done with it
 * @property {string | null} [hunts]  the graph task it hunts bugs in, where its launch named one (UX9)
 * @property {Hunted} [hunted]  that task as the session's graph held it at the launch (11-02): missing where the launch
 *   named none, or no graph was there to read
 * @property {string[]} [taskCheck]  a graph task's worker: its task's own check, as its runner gave it at its launch and
 *   as the task stood when its planner sent it back — none where the task has none (HarnessV3-TaskGraph-v2 TG2-D63)
 * @property {string[] | null} [taken]  the commands its done report named, taken as its task's check where the task had
 *   none (TG2-D63): once — a later report's change nothing — and handed to the graph with its end
 * @property {string} model
 * @property {SeatOf | null} seat  how it came by its model: from the session's pool, with the rows it passed; null
 *   where its launch or its card named the model, for a fork, and for one that started by itself
 * @property {CardModels | null} [models]  its card's models, where the card names more than one and its launch named
 *   none: the one it runs on is among them
 * @property {SubagentEffort | null} effort  the effort it runs at (HarnessV4_Tasks E23-D5); null for a fork, which runs
 *   as the main agent's request does
 * @property {string | null} wire  the name its requests carry where its effort changes it (`kimi/kimi-k3-high`, Cursor's
 *   `cursor/grok-4.7-high`); null: its model's own
 * @property {"side" | "workers"} list  the session's list its seat counts in (E23-D6): a team's worker's and a graph
 *   task's the workers', every other one's the side's — one and the same where the session sets no workers
 * @property {string | null} [slot]  its model's slot across Filament (core/slots.js `slotKey`), null where its model
 *   lands nowhere or it started by itself
 * @property {{ since: number, why: string, rows: import("../../core/pool.js").PoolRow[] | null } | null} [waiting]
 * @property {import("../../core/pool.js").PoolRow[] | null} [crew]  the rows a team's worker took its model from where its
 *   team names models or a Brief picked one (U13-D8): a new launch of it runs there too
 *   a lead's worker launched while there was no room (team_v2_plan §5.7): since when it waits, why at its launch, and
 *   what its room is read against — it takes no seat until it starts
 * @property {string | null} [chose]  its launch's words on its choice of model, said in the launch's answer; null where
 *   the launch named none. Never kept
 * @property {string} description
 * @property {string} cwd  the folder it works in — on its machine, for one launched on another (`remote`)
 * @property {import("./remote-agents.js").RemoteChat} [remote]  one launched on another machine (the remote-agents plan's
 *   s-launch): the machine, the folder there and its chat there, which each of its exchanges is a turn of
 * @property {import("../../core/signs.js").WorkerFiles | null} files  what its task says of its files, when it says
 * @property {import("./grants.js").Grants | null} grants  what its brief and its card let it run without anyone's answer
 *   — only where it works in a worktree of its own (`hostOf`), and kept with its thread (HarnessV3-TaskGraph-v2 TG2-D44,
 *   AG-267)
 * @property {boolean} planReview  its lead reviews its plan before its launch's run changes anything (TG2-D50)
 * @property {import("./prompt.js").PermissionMode | null} mode  the mode its launch fixed, null when its calls follow the
 *   session's
 * @property {string} view
 * @property {boolean} running  its launch asked for the turn running then
 * @property {string | null} changes  the change its launch asked for as a patch (`LaunchSpec.changes`), or none
 * @property {string | null} start  the start that filled its launch's fields, when one did
 * @property {"message" | null} [since]  its launch showed it the session since the developer's last message alone
 * @property {{ turn: number, run: string | null, event: number, waiting: number | null } | null} seen  what it was last
 *   shown of its session: the newest finished turn, of the turn running then (its run) the newest event of its log,
 *   and the question that waited then, by when it began to. Null where it was shown nothing: a follow-up then carries
 *   nothing either (BW-7)
 * @property {boolean} memory
 * @property {boolean} background
 * @property {boolean} deliver  the running exchange's report goes to the main agent when it ends
 * @property {boolean} aside  the developer keeps its reports to themselves (their follow-ups too) until they send one
 * @property {boolean} [cutByRestart]  Filament cut it as it stopped (BUG-26): its end and its notice say so
 * @property {boolean} [rebaseDue]  its graph task's change was sent back to rebase, and it has not gone on with it yet
 *   (the Designer's of 10-27, built 10-28): its work, marked, is no Apply's until it has
 * @property {"restart" | "let-go" | null} restored  its session's record gave it back, and why its own conversation
 *   is gone — Filament restarted, or the registry had let it go: its next message starts a fresh agent that reads what
 *   was said (BW-10). Null while it holds its conversation
 * @property {"restart" | "let-go" | null} [back]  its session's record gave it back to this process, and why — with its
 *   conversation or without (10-26): its work is read from the repository once (`reconcileWork`), and a run an
 *   earlier process left open is no run of this one's
 * @property {string | null} pausing  the turn (its run id) the running exchange holds until it reports
 * @property {any} thinking
 * @property {string | null} requestId
 * @property {string} status  "running", or how the newest exchange ended
 * @property {number} startedAt
 * @property {Exchange[]} exchanges
 * @property {Opening[]} opening  the context its first message opened with, then the brief each fresh start's message
 *   opened with (`exchange`, `afresh`)
 * @property {any[]} convo  the conversation so far
 * @property {WorkState | null} work  its own worktree, when it has one
 * @property {string | null} shares  why a writing sub-agent works in the session's folder after all (no repository, …)
 * @property {string | null} [noCopy]  why its copy could not be made in a repository: it never ran, in its copy or in
 *   the session's folder (HarnessV4_Worktrees_Plan W1)
 * @property {{ kind: "patch" | "worktree", rule: number, moving: Promise<void> | null, noted: boolean, setting?: "auto" | "patch" | "worktree" | "folder", paths?: string[] } | null} [workspace]
 *   where its launch said it works (workspace-kind.js): a patch or a worktree, by which rule; `moving`, its patch's move to
 *   a worktree under way; `noted`, its card's launch is counted for rule 10 (`noteMove`); `setting`, the chat's or the
 *   launch's, and `paths`, what its launch names (`launchPaths`): what the kind of its worktree is chosen by (`copyFor`)
 * @property {ForkBase | null} fork  a fork's copy of the main agent's request furniture (view `fork`)
 * @property {Promise<Outcome> | null} settled  the running exchange (never rejects)
 * @property {Promise<boolean>} [tree]  whether its launch's exchange works in a copy of its own, once its first message
 *   knows (`launch`'s `tree`): a task its follow-up names while it still opens one says so then
 * @property {number} questions  how many questions it has asked over its life, follow-ups included: its next is ask
 *   questions + 1 (HarnessV3-TaskGraph-v2 TG2-D42)
 * @property {{ command: string, exit: number | null, head: string | null } | null} checked  what Filament's check last
 *   saw of its work (TG2-D45): the command it failed on (else its last), with its exit, and the work it ran on — where
 *   that work still waits to be applied and the check failed, the apply needs a reason
 * @property {{ command: string, exit: number | null, head: string } | null} folderRed  the folder's check that undid its
 *   lead's apply, where the change did not go back to it (HarnessV3-TaskGraph-v2 TG2-D55): the command, its exit, and the
 *   work it ran on — while that work waits, an apply of it again needs a reason. Its next exchange ends it
 * @property {{ command: string, exit: number | null } | null} folderUndone  the folder's check that undid its lead's
 *   apply since one stood, sent back or not (TG2-D55): the lead's reason may carry the change over it — it never needs
 *   one for that. An apply that stands ends it
 * @property {number} folderBacks  how often the folder's check sent its change back to it since its last apply stood:
 *   twice at most
 * @property {Attempt | null} [attempt]  one of several workers launched at once on its brief (TG2-D53), or none
 * @property {{ parent: LaunchParent | null, finished: HostFinish | null, wrote: boolean, acted?: boolean, toolCalls: number, abort: AbortController, messages: any[] | null, detached: "report" | "aside" | null, unhook: (() => void) | null, onDetach: ((how: "report" | "aside" | "away") => void) | null, progress: Progress, window: { window: number | null, usable: number | null } | null, held: { text: string, from: string }[], asking: { settle: (answer: import("./loop.js").AskAnswer | null) => void, n: number, lead?: true, remote?: string, kind?: "permission" | "question", options?: string[], words?: false } | null, leadAsk: LeadAsk | null, planHeld: boolean, stoppedBy: string | null, shells: Map<string, string>, ran: { command: string, exit: number | null }[], progressAt: number, progressDue: boolean, look: import("./looks.js").Mark | null, unwatch: (() => void) | null, watch: import("../../core/watch.js").WatchState | null, convo?: any[] | null } | null} run
 *   `detached`: the developer freed the launching call from it (BUG-12 Detach); `unhook` lets go of the launching turn's
 *   stop and hang-up; `onDetach` answers a foreground launch's waiting call — sent to the background by the developer,
 *   or `away`: its machine does not answer, and nobody knows when it will (`remoteTurn`)
 *   `convo`: its loop's conversation as it goes, from turn.js (`runConvo`): its edit cards read their changes there
 *   `messages`: what the exchange composed — a fork's host runs on exactly these
 *   `progress`: how its run goes, from its events; `window`: its run's context window, as its loop measured it;
 *   `held`: messages sent before its run existed, steered into the run once it does; `asking`: the developer's answer
 *   its call waits for, or (`lead`) its lead's to its question — the person's press alone, for what its chat on another
 *   machine asks there (`remote`, that machine's name; s-asks); `leadAsk`: its question to its lead (TG2-D49), from
 *   when it asked until its end is read; `planHeld`: its changes and commands wait for its lead's review of its plan
 *   (TG2-D50); `stoppedBy`: whose stop cut its request, when no run of it could take the stop;
 *   `shells`: its commands still running, by call; `ran`: the commands it ran to their end, with their exits — a graph
 *   task's record, read from its run's events, never from its words; `progressAt`: when its progress last reached the
 *   events feed, and `progressDue`: a later send of it is set; `look`: what its lead has seen of this run, when its
 *   lead reads along (looks.js), and `unwatch` lets go of the run log's events that feed it; `watch`: a team's worker's
 *   — what its run wrote and ran, as a turn's watch reads them (core/watch.js): for a report that says it checked its
 *   work (TG2-D45) — a graph task's has its graph's check — and a command it failed a third time, which sends it to its
 *   lead (TG2-D59)
 */
/**
 * @typedef {object} ForkBase  what a fork keeps of the main agent's request, so each of its rounds sends the same
 *   system prompt, tools and thinking — the prefix the provider already caches
 * @property {any} system
 * @property {readonly any[]} tools
 * @property {any} thinking
 * @property {number} maxTokens
 * @property {"turn" | "kept"} from  the running turn's request as it stood, or the last turn's while Filament kept it
 * @property {number} messages  how many messages of the main agent's conversation it copied
 */
/**
 * @typedef {object} Opening  one block of context a sub-agent's first message opens with, ahead of its task
 * @property {"view" | "running" | "waiting" | "changes" | "brief" | "fork" | "review"} kind  the session's conversation
 *   under the chosen view, the turn running at the launch, the question its turn waited on the developer with then, a
 *   change as a patch, memory's brief for the task, a reviewer's change to read, or — a fork — the main agent's whole
 *   conversation, said in a line (the fork read it as it was sent)
 * @property {string} text  what the sub-agent read
 * @property {number} count  the completed turns the view renders, the running turn's rounds, 1 for a question that
 *   waited, the patch's files, the brief's memory lines, the change's files, or the messages a fork copied
 * @property {number} [chars]  the size of what it read, where the words are kept no more (a thread its session gave back,
 *   a brief its conversation opens with no more)
 * @property {string} [model]  a brief's: the model it was written for, as its calls sent it (`sentModel`)
 * @property {number} [exchange]  a brief a fresh start's message opened with (`afresh`): that exchange — never shown as
 *   its launch's context
 */
/**
 * @typedef {object} Delivery  a message for a session's loop from the sub-agent machinery
 * @property {string} text  what the model reads
 * @property {string} from  the sub-agent's id
 * @property {string} description  its name on the cards
 * @property {"report" | "notice" | "task" | "overrule" | "applied" | "ask" | "check" | "told" | "result" | "shell"} kind  a report, the developer's launch
 *   announced (`inform`), a graph task's end in the graph's words (HarnessV3-TaskGraph G2-7), the developer overruling a
 *   saved agent's answer — whose, and to which question: their own words travel as their message — their apply of a
 *   sub-agent's changes: which files changed under the session's agent (BW-8) — a worker's question to its lead, which
 *   waits for its answer (HarnessV3-TaskGraph-v2 TG2-D58): the lead's door says it once, where no look of the lead's
 *   shows the worker — what came of the folder's check after a lead's apply, where its call answered before the
 *   verdict (TG2-D55) — the developer's own words to one of its sub-agents, past it (HarnessV4_Tasks decision 10) — or
 *   a result from outside the registry, handed in (`hand`): a team's beside the session, a flow's end
 *   (HarnessV4_Envelopes_Plan EN4) — `from` its team's chat or its flow — or a background command's end, whole
 *   (`commandEnd`, HarnessV4_Background_Plan BG-D2): `from` its shell, `description` its command, `code` its exit code
 * @property {number | null} [code]  a `shell`'s exit code
 * @property {number} [ask]  the question's number, which the lead's answer names (an `ask`'s)
 * @property {string} [task]  the graph task a `task` message tells of
 * @property {string} [state]  how that task stands now it ended: done, failed, or waiting again (stopped)
 * @property {number} [exchange]  the exchange it reports, or a launch's (0) it announces: the turn that carries it
 *   names it, so the session's row says which turn took it (absent on a message kept before Filament recorded it)
 * @property {boolean} [sent]  a report the developer kept aside, then sent on
 * @property {Launched[]} spends  what the exchanges it tells of spent, each with the run that launched it: the turn
 *   that takes it counts those it launched, in this run or in a half of it before a pause (the bug report's L10)
 * @property {boolean} wrote
 * @property {import("../turn-tree.js").Writes} [writes]  the files it wrote in the folder it shares with the session,
 *   or that went into it by its apply: the turn that takes it records them as the helper's (HarnessV4_Git_Plan GWC-13)
 * @property {boolean} [seal]  another agent's result, which reaches a loop that works sealed (HarnessV4_Envelopes_Plan
 *   EN-D4): a background sub-agent's report, a saved agent's answer, a team's worker's, a team's or a flow's result
 *   handed in — never the developer's own Send, a paused launch's report, a drift warning, a question, a notice or
 *   the graph's words
 * @property {string} [handed]  a result handed in, while the turn it went to may still end before it reads it: its
 *   sender's way back (`hand`), never kept through a restart
 * @property {"team" | "flow" | "chat" | "steer" | "agent"} [via]  who handed a result in: a team beside the session, a
 *   flow, or a letter (`letter`) — another chat's, the fork's that weighed the person's message aside (the owner's
 *   forked steer of 11-04), or a sub-agent's to the agent that launched it — `from` its chat, its flow, the fork or the
 *   sub-agent, which the page opens (HarnessV4_Envelopes_Plan EN5)
 * @property {string} [subject]  what it is about in a line, its sender's own (`Subject:`) or Filament's (EN-D3)
 * @property {string} [sender]  who sent it, in the envelope's words
 * @property {number} [envelope]  its number among the session's envelopes, once sealed: the order they arrived in
 * @property {boolean} [wakes]  a report or a result for the agent now that came while no turn ran — not one kept for the
 *   developer's next message: the chat goes on by itself to read it (`reportsDue`, the owner's of 10-28). A graph
 *   task's end its runner says wakes (the owner's of 11-02) comes so too
 * @property {"check" | "command" | "merge" | "card"} [about]  what a graph's word is about, which the wake and the wait
 *   it ends say (sessions/wake.js `wakeLineFor`, the nudge map of 11-10): a check's verdict, the end of a command task
 *   Filament ran, an apply's verdict, or the person's answer to the side-by-side card; none for a worker's end, said as
 *   another agent's report
 * @property {boolean} [held]  a graph task's end told while the graph's other workers still work (the owner's of 11-02):
 *   it wakes nothing — no wait of a running turn, no chat — and rides the wake their last end brings (`wake`)
 * @property {boolean} [fresh]  a letter sealed while no turn of its chat read it (`letter`, a turn's close): the agent is
 *   told of it once — the next turn's start lists it and draws its card (`fresh`), else its next step says it (`take`)
 */
/**
 * @typedef {object} Launched  what one exchange spent, and the run of the turn that launched it
 * @property {string} launchedBy
 * @property {number} spentUsd
 * @property {number} toolCalls
 * @property {string[]} roundIds
 */
/**
 * @typedef {Omit<Delivery, "spends" | "kind"> & { kind: Delivery["kind"] | "look" | "envelope", look?: import("./looks.js").LookMeta, spentUsd: number, toolCalls: number, roundIds: string[], opened?: boolean }} Taken  a message as
 *   the turn that takes it reads it: the spend, calls and model calls of the exchanges that turn launched. `look`: a
 *   look at the turn's running workers (HarnessV3-TaskGraph-v2 §12) — made as it is taken, the last of a take, with
 *   what it showed (`look`); it is no delivery, and never waits in an inbox or a queue. `envelope`: a result taken
 *   sealed (HarnessV4_Envelopes_Plan EN1) — its text is the envelope's line, its spend counted as it is taken; `opened`:
 *   a sealed one opened, whose spend its sealing counted
 */
/**
 * @typedef {{ n: number, from: string, description: string, sender: string, subject: string, via?: "team" | "flow" | "chat" | "steer" | "agent" }} Envelope
 *   a sealed result, as its line and the list of the sealed ones name it; `via`: a team's, a flow's, another chat's,
 *   the fork's that weighed the person's message, or a sub-agent's letter
 */
/** @typedef {{ id: string, to: string, title: string, subject: string, reply: boolean }} LetterSent  a letter that went, as its sender's timeline says it */
/**
 * @typedef {object} LiveTurn  a session's running loop, as the registry sees it
 * @property {string} runId
 * @property {Set<string>} runs  the turn's runs: this one, and each half of it before a pause
 * @property {Delivery[]} inbox  reports waiting for the loop's next round
 * @property {Set<string>} own  the background sub-agents this turn launched
 * @property {(() => { body: any, headers: Record<string, string>, tokens?: number | null } | null) | null} fork  the loop's
 *   request as it stands, and what it carries as the loop weighs it on its line's scale, a window known or not
 *   (`tokens`, null where the loop weighs none; `forkWeight`)
 * @property {(() => CacheSnapshot | null) | null} cache  its newest completed request, and when it went out
 * @property {((evt: any) => void) | null} emit  an event on the turn's timeline, at the round it is in
 * @property {boolean} lead  a team's lead runs it: it follows up on its sub-agents with worker
 * @property {number} launched  how many the turn launched, whatever launched them — its team's tools, its questions to
 *   saved agents, its task graph — kept by the turn, so a worker the registry lets go is still counted
 * @property {(() => number) | null} round  the round the loop is in
 * @property {boolean} closed
 * @property {Set<(what?: string) => void>} wake  a waiting loop's arrival hooks: called when a delivery lands in
 *   `inbox` — with what it is where that is no report: "told", "notice", "letter", or what a graph's word is about
 *   (`cameOf`) — and, with "look", when a look at its workers is due
 * @property {ReturnType<typeof createLooks> | null} looks  its looks at its running workers, when its lead reads along
 * @property {((sa: Subagent) => import("./looks.js").Watched) | null} watched  a running worker as its looks read it
 * @property {() => boolean | null} opens  whether its agent opens envelopes now — it has the envelope tool: another
 *   agent's result and another chat's letter reach it sealed only then; null while the turn does not know yet (a coding
 *   agent's, before its bridge says)
 */
/**
 * @typedef {{ queue: Delivery[], sealed: Delivery[], envelopes: number, turn: LiveTurn | null, paused: boolean, warm: CacheSnapshot | null, warmTimer: ReturnType<typeof setTimeout> | null, folder: string[], checks: Set<{ done: Promise<void>, abort: AbortController }>, said: Set<string>, backs: Map<string, () => void>, after: (() => void)[], opens?: boolean }} ChainState
 *   one session as the registry keeps it (`chains`)
 */
/**
 * @typedef {object} Inbox  what the running loop reads at its decision points
 * @property {(o?: { seal?: boolean, end?: boolean }) => Taken[]} take  reports that arrived, in order — none once Filament
 *   is stopping: the loop's next round could make no call, so they wait on the session for its next turn. `seal`: the
 *   loop is at work, so another agent's result goes sealed, as its envelope's line (HarnessV4_Envelopes_Plan EN-D1),
 *   where the session's `subagents.envelopes` says so; without it — a loop that waits — the sealed ones open first,
 *   oldest first, then what arrived. `end`: the loop is at its turn's end, working no more — nothing is sealed, and the
 *   sealed ones open only ahead of another agent's result that came. Another chat's letter is the agent's to open
 *   whenever it chooses: where its agent opens envelopes it is sealed at any take, waiting or at the end too, and no
 *   take opens it; a letter sealed while no turn read it and not yet told (`fresh`) is said here
 * @property {(o?: { count?: number, all?: boolean }) => Taken[]} open  the oldest sealed envelopes, whole, in the order
 *   they arrived (EN-D2): `count` of them (1), or `all`
 * @property {(key: string) => Picture} [picture]  a picture one of the session's agents drew, by its name or its id
 *   (HarnessV4_DesignPass_Plan UX1): its code whole, or the pictures there are
 * @property {() => Envelope[]} sealed  the session's sealed envelopes, oldest first
 * @property {(listed: readonly number[]) => Envelope[]} fresh  of the envelopes the turn's start listed (`listed`, their
 *   numbers), the letters sealed while no turn read them: told now, so no take says them again — each one's card is
 *   drawn with that list
 * @property {() => number} waitOpens  how many sealed envelopes a wait opens: every one but the letters its agent keeps
 *   sealed
 * @property {(input: import("../letters.js").LetterInput) => { ok: boolean, text: string, sent?: LetterSent } | null} [letter]
 *   a letter of the session's agent to another chat, or its answer to one (letters.js): sent, or refused in words; null
 *   where Filament carries no letters
 * @property {() => boolean} [seals]  whether the session takes others' results sealed while its agent works now
 *   (`subagents.envelopes`, EN-D8)
 * @property {() => Promise<void> | null} hold  the developer's paused launches still running: the next round waits
 * @property {() => Promise<void> | null} owed  what the turn may not end before: its own background launches, the
 *   developer's paused ones, what its session's task graph owes it (HarnessV3-TaskGraph G2-7), the folder's checks
 *   after its lead's applies (HarnessV3-TaskGraph-v2 TG2-D55), and a flow its main agent drives In place (OA4)
 * @property {() => string | null} [owedWhy]  what its wait waits for, as the page says it: its own sub-agents by name,
 *   the folder's checks, the flow it drives; null for a lead, or where only the graph is owed — the wait says
 *   sub-agents
 * @property {() => Promise<string | void>} arrival  resolves when a delivery is waiting (at once when one already is)
 *   and takes nothing — a wait on sub-agents ends on the first report instead of the last (BUG-12). With "look" when
 *   what woke it is a look that is due, "told" or "letter" where all that waits is the developer's words to one of
 *   its sub-agents or letters, "notice" for Filament's own word, what a graph's word is about (`about`), "mixed" for
 *   several kinds
 * @property {() => string | undefined} [came]  what waits now, in `arrival`'s words: what a wait its owed work let go of
 *   says came (the nudge map of 11-10)
 * @property {boolean} reads  the turn's lead reads along with its workers: a take may end with a look
 * @property {import("./looks.js").Crewed} [who]  whom its looks show, in its own word: a lead's workers, or the sub-agents
 *   of the agent's task graph
 * @property {() => boolean} due  whether a look is due now
 * @property {() => void} look  asks for a look with the next take, whatever is new: the lead's wait is over
 * @property {() => number | null} pace  the seconds between looks as the session says them now (0: whenever something
 *   is new); null where the lead reads nothing along (TG2-D48)
 * @property {(taken: Taken[]) => void} back  messages a take handed out that the turn never gave its model — a coding
 *   agent's turn that ended first (HarnessV4_Tasks B12): in the inbox again, ahead of what came since, so the
 *   turn's close hands them to whoever reads the session next; what they spent stays counted on the turn that took
 *   them. A look among them puts its marks back, so the next look shows that part again
 * @property {() => string[]} [own]  the sub-agents the turn launched or followed up on in the background, oldest
 *   first: a lead's workers of the turn, whom Filament names after its agent compacted (HarnessV3-TaskGraph-v2 TG2-D56)
 * @property {() => string[]} [coming]  the sub-agents whose report waits here, not taken yet: what Filament tells a lead
 *   of its team after a compaction leaves those reports to the take that follows it, so none is said twice (TG2-D56)
 * @property {() => number} [held]  how many of the graph's ends wait here held for its other workers (the owner's of
 *   11-02): no arrival, yet the next take carries them
 */
/**
 * @typedef {object} ToolLaunch  one `agent` call, as the loop hands it over
 * @property {string} id  the call's tool_use id
 * @property {any} input  description, prompt, subagent_type, run_in_background, agent_id, context
 * @property {(evt: any) => void} emit  the turn's timeline (the loop stamps the round)
 * @property {AbortSignal | null} signal  the turn's hang-up
 * @property {AbortSignal | null} [stopSignal]  the turn's stop from the harness
 * @property {number} [withinMs]  how long the call may wait for a foreground launch, where its caller is cut off past
 *   that (a coding agent's call, HarnessV4_Tasks E12 step 2): a launch that takes longer runs on in the background, the
 *   call says so, and its report comes as a message
 * @property {boolean} [coder]  a coding agent's own call of Filament's tool: it waits for the report unless it asks to
 *   run in the background, and its launch may name a task of its graph
 * @property {number | null} [batch]  the round the loop made the call in: its agent calls run side by side, and their
 *   launches share one snapshot of the folder (Phase 0 of the owner's 11-09 plan for big repos)
 */
/**
 * @typedef {object} ToolResult
 * @property {boolean} ok
 * @property {string} text  the tool result the model reads
 * @property {number} spentUsd
 * @property {number} toolCalls
 * @property {string[]} roundIds
 * @property {boolean} wrote
 * @property {import("../turn-tree.js").Writes} [writes]  as a Delivery's: the files the helper wrote in the folder it
 *   shares with the session, or that its apply put there
 * @property {string} note  the record's sentence
 */
/**
 * The loop's door behind `agent` — and, for a team's lead, behind `worker` too: turn.js wraps the team's tools in both.
 * `watch`: a team's lead's list of its workers still running, which its `wait` answers with (HarnessV3-AtHome AH-O5).
 * @typedef {{ run: (o: ToolLaunch) => Promise<ToolResult>, worker?: (o: ToolLaunch) => Promise<ToolResult>, watch?: () => string }} Subagents
 */

/**
 * @typedef {{ own: string[], runs: string[], launched?: number }} TurnSoFar  what a pause hands its resume: the background
 *   launches the turn made, its runs, and — a lead's — how many it launched in all (`LiveTurn.launched`)
 */

/**
 * A message as the turn that takes it reads it (the bug report's L10): the spend, calls and model calls of the
 * exchanges that turn launched — in any of its runs — and none of another's.
 * @param {Delivery} d @param {ReadonlySet<string>} runs @returns {Taken}
 */
const counted = ({ spends, ...d }, runs) => {
  const ours = spends.filter((s) => runs.has(s.launchedBy));
  return { ...d, spentUsd: ours.reduce((n, s) => n + s.spentUsd, 0), toolCalls: ours.reduce((n, s) => n + s.toolCalls, 0), roundIds: ours.flatMap((s) => s.roundIds) };
};

const newId = () => `sa_${randomBytes(4).toString("hex")}`;
/**
 * The model a sub-agent's calls go out on, as sent: a coding agent's by its name, the loop's as `agent/<model>` — its
 * wire name where the effort it runs at changes the name (`kimi/kimi-k3-high`). Memory settings that exclude it leave its
 * brief and its report out too (memory's `subagentLeftOut`). @param {{ engine?: string | null, wire?: string | null, model: string }} sa
 */
const sentModel = (sa) => (sa.engine === "acp" ? sa.wire || sa.model : `agent/${sa.wire || sa.model}`);
/**
 * A picture a helper drew, from its run's `visual` event or a kept thread's record (HarnessV4_Visuals_Plan VS-D50):
 * its id, title, size and where it is kept. Null for anything that names no picture.
 * @param {any} v @returns {Drew | null}
 */
const drewOne = (v) => {
  const id = String(v?.id ?? "");
  if (!id) return null;
  const where = v.session === true ? { session: /** @type {true} */ (true) } : Number.isInteger(v.turn) && v.turn > 0 ? { turn: Number(v.turn) } : null;
  return where ? { id, title: String(v.title ?? ""), bytes: Number(v.bytes) || 0, ...where } : null;
};
/** A kept thread's pictures, each read as `drewOne` reads it. @param {unknown} list @returns {Drew[]} */
const drewOf = (list) => (Array.isArray(list) ? list.map(drewOne).filter((d) => d != null) : []);
/** A picture's size in a report's words. @param {number} bytes */
const sizeOf = (bytes) => (bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024).toLocaleString("en-US")} KB`);
/**
 * The line a helper's report ends with where it drew (VS-D52): what the agent that asked reads of its pictures — their
 * names, never the pictures. Where it can open one (`opens`: its envelope tool, HarnessV4_DesignPass_Plan UX1, UX-D3),
 * each one's size too, and how: by its name, its code whole — so it reads the one it needs, and no other. `who` drew
 * them: a team's result says "The team", a flow's end "Its boxes".
 * @param {Pick<Drew, "title" | "bytes">[] | undefined} drew @param {boolean} [opens] @param {string} [who]
 */
export const drewLine = (drew, opens = false, who = "It") => {
  if (!drew?.length) return "";
  if (!opens) return `${who} drew ${drew.map((d) => d.title).join(", ")}, shown to the developer.`;
  const one = drew.length === 1;
  const list = drew.map((d) => `${d.title} (${sizeOf(d.bytes)})`).join(", ");
  return `${who} drew ${one ? list : `${drew.length} pictures: ${list}`}, shown to the developer. ${one ? "It waits" : "They wait"} sealed for you: open ${one ? "it" : "the one you need"} with Filament's envelope tool, {"picture": "${one ? drew[0].title : "<its name>"}"}, to read its code whole.`;
};
/** An artifact a helper published, as its run said it — or as a kept thread holds it — or null. @param {any} e @returns {Made | null} */
const madeOne = (e) => {
  const name = String(e?.name ?? "");
  const v = Number(e?.v);
  return isArtifactName(name) && Number.isInteger(v) && v > 0 ? { name, v, title: String(e.title ?? "") || name, address: String(e.address ?? "") } : null;
};
/** A kept thread's artifacts, each read as `madeOne` reads it. @param {unknown} list @returns {Made[]} */
const madeOf = (list) => (Array.isArray(list) ? list.map(madeOne).filter((m) => m != null) : []);
/** The reply that sent an exchange, as a launch or a kept thread says it, or null. @param {any} v @returns {SentIn | null} */
const sentInOf = (v) => (v && typeof v.run === "string" && v.run ? { run: v.run, round: Number.isInteger(v.round) && v.round >= 0 ? v.round : null } : null);
/**
 * The reply of the turn that launches an exchange (HarnessV4_OneAgent_Plan L47): its run, and its round — a lead's call
 * names its own, else the turn's now. None where no turn's call launched it.
 * @param {LaunchParent | null} parent @returns {SentIn | null}
 */
const sentInBy = (parent) => (parent ? sentInOf({ run: parent.live.runId, round: Number.isInteger(parent.round) ? parent.round : parent.live.round?.() ?? null }) : null);
/** The fields of the agent tool that name a sub-agent's model and its effort (HarnessV4_Tasks E23): a launch's alone. */
const MODEL_FIELDS = Object.freeze(["model", "provider", "effort"]);
/** A kept effort as a sub-agent holds it, or null where the record holds none that reads. @param {any} e @returns {SubagentEffort | null} */
const effortKept = (e) =>
  e && typeof e === "object"
    ? { level: typeof e.level === "string" ? e.level : null, wanted: typeof e.wanted === "string" ? e.wanted : null, levels: Array.isArray(e.levels) ? e.levels.map(String) : null, spelled: e.spelled === true }
    : null;
/**
 * The line a helper's report ends with where it published (AFC-100): what the agent that asked reads of what it made
 * and where — never the page. Where it can read one (`reads`: its artifact tool, HarnessV4_DesignPass_Plan UX-D5), how.
 * @param {Made[] | undefined} made @param {boolean} [reads]
 */
export const madeLine = (made, reads = false) => {
  if (!made?.length) return "";
  const line = `It made ${made.map((m) => `${m.title} (v${m.v})${m.address ? ` at ${m.address}` : ""}`).join("; ")}, shown to the developer.`;
  if (!reads) return line;
  return made.length === 1
    ? `${line} Read it with Filament's artifact tool, {"action": "read", "id": "${made[0].name}"}.`
    : `${line} Read one with Filament's artifact tool, {"action": "read", "id": "<its name>"} — their names: ${made.map((m) => m.name).join(", ")}.`;
};
/**
 * A task in a line, for the cards and rows: the description it came with, else its (trimmed) prompt's first line —
 * one rule for a launch's and a follow-up's. @param {unknown} description @param {string} prompt
 */
const lineOf = (description, prompt) => clip(String(description || "").trim() || prompt.split("\n")[0], 60);
/**
 * How a run ended, in a line: a stop names whose it was (`by`, its `stoppedBy`), as its run's last line did (`whoseStop`):
 * its lead's, the agent's own, Filament's, else the developer's. @param {string} status @param {string | null} [by]
 */
const endedWord = (status, by = null) => (status === "done" ? "finished" : status === "stopped" ? `was stopped by ${whoseStop(by).who}` : ENDED[/** @type {keyof typeof ENDED} */ (status)] || status);
/**
 * Whether the stop that ended a run was asked for by the one who hears of its end: its team's lead (the worker tool's
 * stop), or the session's agent (the agent tool's `stop`, ag-stop) — it "was stopped as you asked", never "by the
 * developer". @param {{ stoppedBy?: string | null } | null | undefined} o
 */
const askedStop = (o) => o?.stoppedBy === "lead" || o?.stoppedBy === "agent";
/**
 * What a stop of the agent tool's cannot carry (ag-stop): every field of a launch, a follow-up, an apply or a list, in
 * the order the tool gives them. Its call's own line (`description`) and `run_in_background` say nothing to refuse.
 */
const STOP_ALONE = Object.freeze(["prompt", "subagent_type", "saved_agent", ...MODEL_FIELDS, "apply_changes", "overlap", "mark_applied", "sync", "task", "context", "changes", "list_models", "machine", "cwd", "list_machines"]);
/**
 * How a run's compaction was made, in the words of the lead's watch: the loop's recovery from a provider's refusal, the
 * developer's Compact, or the compaction line — with the model that wrote the summary when the event names one.
 * @param {any} e  the loop's compaction event
 */
const compactionHow = (e) =>
  e.why === "overflow-refusal"
    ? "after its provider refused a round for size"
    : [e.manual ? "on the developer's request" : "", e.by ? `summarized by ${e.by}` : ""].filter(Boolean).join(", ") || "at its compaction line";
/** @param {any} json */
const textOf = (json) => (Array.isArray(json?.content) ? json.content.filter((b) => b?.type === "text").map((b) => String(b.text || "")).join("\n").trim() : "");
/** @typedef {{ input: number, cacheRead: number, cacheWrite: number, output: number }} TokenUsage */
/** The provider's token counts on an Anthropic-format reply — a fork's proof of what it read from the cache. @param {any} json @returns {TokenUsage | null} */
const usageOf = (json) => {
  const u = json?.usage;
  return u ? { input: Number(u.input_tokens) || 0, cacheRead: Number(u.cache_read_input_tokens) || 0, cacheWrite: Number(u.cache_creation_input_tokens) || 0, output: Number(u.output_tokens) || 0 } : null;
};
/**
 * What the rewriting model is asked: a brief for the sub-agent the developer is about to launch — read-only or not,
 * with the view it will get — opening with a title line for the cards.
 * @param {string} task @param {{ readOnly: boolean, view: string }} o
 */
const enhanceInstruction = (task, { readOnly, view }) => {
  if (view === "fork")
    return `The developer is about to hand the task below to a fork of you: a sub-agent that starts from this whole conversation as it stands, with your tools${readOnly ? ", read-only — it can read and search, never change a file" : ""}. It knows everything you know here, so the brief need not retell it: say exactly what to do, what is in and out of scope, and what to report back. Reply in this form, with nothing before it: a first line "Title: " and three to six words naming the task, then the brief. Do not call any tool.\n\nThe developer's task:\n${task}`;
  const means = VIEW_MEANS[/** @type {keyof typeof VIEW_MEANS} */ (view)];
  return `The developer is about to hand the task below to a sub-agent: a fresh agent with your tools in this project${readOnly ? ", read-only — it can read and search, never change a file" : ""}, which sees nothing of this conversation${means ? ` except a ${view} rendering of it (${means})` : ""}. Rewrite the task as a complete, self-contained brief from what you know here — the goal, the files and places that matter, constraints, what is already done or ruled out, and exactly what to report back. Reply in this form, with nothing before it: a first line "Title: " and three to six words naming the task, then the brief. Do not call any tool.\n\nThe developer's task:\n${task}`;
};
/** The rewrite's first line names the task ("Title: …"); the rest is the brief. A reply without one is all brief. @param {string} text */
const splitTitle = (text) => {
  const whole = String(text || "").trim();
  const [first, ...rest] = whole.split("\n");
  const m = /^title\s*:\s*(.+)$/i.exec(first.replace(/[*_`#]/g, "").trim());
  const brief = rest.join("\n").trim();
  return m && brief ? { title: clip(m[1].replace(/^["“']+|["”']+$/g, "").trim(), 60) || null, brief } : { title: null, brief: whole };
};
/** A settled wait on every exchange in the list, or null when none runs. @param {Subagent[]} list */
const waitAll = (list) => {
  const running = list.map((s) => s.settled).filter((p) => p != null);
  return running.length ? Promise.all(running).then(() => undefined) : null;
};
/** A change list in a sentence: how many files, the lines, the first names. @param {readonly { path: string, added: number, removed: number }[]} files */
const filesLine = (files) => {
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return `${files.length} file${files.length === 1 ? "" : "s"} (+${added} −${removed}) — ${files.slice(0, 8).map((f) => pathWords(f.path)).join(", ")}${files.length > 8 ? `, and ${files.length - 8} more` : ""}`;
};
/** How many of the files that stayed in a copy on another machine a sentence names for each reason. */
const LEFT_NAMED = 5;
/**
 * What stayed in a sub-agent's copy on another machine in a sentence: by why, each with how many and their names, the
 * first `LEFT_NAMED` — "a secret's file by its name: 1 (.env.local); larger than 100 MB: 2 (a.bin, b.bin)". Names and
 * reasons as that machine said them (`wordsThere`), never what a file holds.
 * @param {readonly { path: string, why: string }[]} left
 */
export const leftLine = (left) => {
  /** @type {Map<string, string[]>} */
  const by = new Map();
  for (const l of left) by.set(l.why, [...(by.get(l.why) || []), l.path]);
  return [...by].map(([why, paths]) => `${wordsThere(why, 200)}: ${paths.length} (${paths.slice(0, LEFT_NAMED).map((p) => wordsThere(p, 200)).join(", ")}${paths.length > LEFT_NAMED ? `, and ${paths.length - LEFT_NAMED} more` : ""})`).join("; ");
};
/**
 * What a copy with no dependency folder linked into it says of them (the owner's of 11-10: a copy of a worktree with no
 * node_modules of its own had none linked, silently, and its sub-agent was told they were).
 */
const NO_DEPENDENCIES =
  "Folders git ignores are not in the copy, and no dependency folder is linked into it: neither the project nor its repository's main checkout has a node_modules or virtualenv that git ignores, so a command that needs one fails here.";
/** The same at the end of the output of a change's own check that failed alike in the copies of the folder (`failedAlike`). */
const NO_DEPENDENCIES_CHECKED =
  "[Filament: no dependency folder is linked into this copy of your folder: neither it nor its repository's main checkout has a node_modules or virtualenv that git ignores.]";
/** A link Filament made in a copy, in words: its place in the copy, and the folder it links to. @param {string} dest @param {string} link */
const linkWords = (dest, link) => {
  let to = "";
  try {
    to = resolve(readlinkSync(link).replace(/^\\\\\?\\/, ""));
  } catch {}
  const at = relative(dest, link).replace(/\\/g, "/");
  return to ? `${at} (linked to ${to})` : at;
};
/**
 * The developer's dependency folders a patch workspace reads where they are (patch-hands.js `dependencyOf`): those at the
 * project's top and at the session folder's place. @param {{ repo: string, rel?: string }} ws
 */
const readInPlace = (ws) =>
  [...new Set(["", ws.rel || ""])]
    .flatMap((rel) => DEPENDENCY_DIRS.map((name) => join(ws.repo, rel, name)))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
/**
 * What a copy holds of the folders git ignores — the dependency folders Filament linked into it, each with the folder
 * it links to; a patch workspace's, which links none, those it reads where they are (`readInPlace`); or that it has
 * none (`NO_DEPENDENCIES`) — and where its git history stands: the close of every worktree note. Its HEAD is Filament's
 * commit of the folder where the folder held uncommitted changes (the owner's list of 11-08: a builder read
 * `git show HEAD:` for the repository's last commit and got the folder's newer file).
 * @param {{ kind?: string, repo: string, rel?: string, dest: string, linked: readonly string[] } | null} [wt]  none: as
 *   one with none linked
 */
const copyHolds = (wt = null) => {
  const links = wt?.linked || [];
  const read = wt?.kind === "patch" ? readInPlace(wt) : [];
  const deps = read.length
    ? `Folders git ignores are not in the copy, except the project's own dependency folders, read where they are: ${listed(read)}. Use them, never install into them.`
    : wt && links.length
      ? `Folders git ignores are not in the copy, except the dependency folders Filament linked into it: ${listed(links.map((l) => linkWords(wt.dest, l)))}. Use them, never install into them: they are the project's own.`
      : NO_DEPENDENCIES;
  return `${deps} Filament's own commits of the copy may sit on the repository's last commit, each starting "Filament:": git log shows where the repository's own begin.`;
};
/**
 * What a sub-agent in its own worktree reads ahead of its task; `who` applies its work.
 * @param {string} who @param {string} [holds]  what its copy holds (`copyHolds`)
 */
const workNote = (who, holds = copyHolds()) =>
  `[Filament: you work in your own git worktree — a copy of the project as it stood when you were launched, uncommitted changes included — not in the developer's folder. Nothing you change reaches their folder until ${who} or the developer applies your work, so name every file you changed in your report. ${holds}]`;
const WORK_NOTE = workNote("the main agent");
const WORKER_WORK_NOTE = workNote("the team's lead");
/**
 * What a graph task's sub-agent in its own worktree reads ahead of its brief — a team's worker's too: Filament merges
 * its work as it reports, after its review when the task has one (G3-3). @param {string} [holds]
 */
const taskWorkNote = (holds = copyHolds()) =>
  `[Filament: you work in your own git worktree — a copy of the project as it stood when you were launched, uncommitted changes included — not in the developer's folder. Filament merges your change into their folder when you report your task done with its check passed — once a reviewer has read it, when your brief says one does. ${holds}]`;
const TASK_WORK_NOTE = taskWorkNote();
/** What a sub-agent that runs in a copy and keeps nothing reads ahead of its task (HarnessV4_Tasks E15 step 4, AG-7). @param {string} [holds] */
const copyNote = (holds = copyHolds()) =>
  `[Filament: you work in your own copy of the project — a git worktree of it as it stood when you were launched, uncommitted changes included — not in the developer's folder. Run and change what you need there: the copy is removed when you report, and nothing you changed in it is kept, so your report carries what you found. ${holds}]`;
const COPY_NOTE = copyNote();
/**
 * The worktree note a sub-agent reads, its copy's dependency folders named (`copyHolds`): a copy's that keeps nothing
 * (`copy`), a graph task's (`task`), a team's worker's (`team`), else one whose work the main agent applies.
 * @param {{ work: { wt: Parameters<typeof copyHolds>[0] } | null }} sa @param {{ copy: boolean, task: boolean, team: boolean }} o
 */
const workNoteOf = (sa, { copy, task, team }) => {
  const holds = copyHolds(sa.work?.wt || null);
  return copy ? copyNote(holds) : task ? taskWorkNote(holds) : workNote(team ? "the team's lead" : "the main agent", holds);
};
/**
 * Whether a builder's copy holds the files Git LFS keeps as their pointers (Phase 0 of the owner's 11-09 plan for big
 * repos): a worktree's may; a patch's holds them whole, copied up through git's filters.
 * @param {import("../../adapters/git/worktree.js").TaskWorktree | import("../../adapters/git/patch.js").PatchWorkspace | null | undefined} wt
 */
const holdsPointers = (wt) => !!wt && "lfs" in wt && wt.lfs === "pointers";
/** Whether its pointers are files its commit keeps in Git LFS, to be said to it. @param {Parameters<typeof holdsPointers>[0]} wt */
const saysPointers = (wt) => !!wt && "pointers" in wt && !!wt.pointers;
/**
 * Said after the worktree note where the copy holds the files Git LFS keeps as their pointers (Phase 0 of the owner's
 * 11-09 plan for big repos): what they are, and that a command needing them fetches them first. `reads`: its read tool
 * is the loop's, which fetches the file a pointer stands for (a coding agent's own does not).
 * @param {boolean} reads
 */
const lfsNote = (reads) =>
  `[Filament: the files this repository keeps in Git LFS are their pointers in your copy — a few lines each, starting "version https://git-lfs.github.com/spec/v1" — not their content.${reads ? " The read tool fetches one as it reads it." : ""} Before a command that needs such files, run git lfs pull --include <path> in the copy.]`;
/** The same ahead of a follow-up: its last copy went with its report. */
const COPY_AGAIN_NOTE = "[Filament: the copy of the project you worked in was removed when you reported, with what you changed in it. You work in a fresh copy now, of the project as it stands.]";
/**
 * The same ahead of a follow-up to one that edits, nothing of whose work waited — applied, marked so, discarded, or no
 * change — and whose last commit git no longer holds (the owner's of 11-09, its review): it starts from the folder,
 * which has that work where it was applied.
 */
const LET_GO_NOTE = "[Filament: the copy you worked in last has been let go, with git's record of it — nothing of it waited to be applied. You work in a fresh copy now, of the project as it stands, which holds whatever of your work was applied.]";
/**
 * A fork's worktree note names the folder: its system prompt is the main agent's, which names the developer's.
 * @param {string} workdir @param {boolean} [kept]  false: it runs in a copy that keeps nothing
 * @param {string} [holds]  what its copy holds (`copyHolds`)
 */
const forkWorkNote = (workdir, kept = true, holds = copyHolds()) =>
  `[Filament: you work in your own git worktree, ${workdir} — a copy of the project as it stood when you were launched, uncommitted changes included. The conversation above worked in the developer's folder; you don't: use paths relative to your working folder. ${kept ? "Nothing you change reaches the developer's folder until your work is applied, so name every file you changed in your report." : "The copy is removed when you report, and nothing you changed in it is kept, so your report carries what you found."} ${holds}]`;
/**
 * What a coding agent in its own worktree reads after that note: both folders by name, and how one maps to the
 * other. Its own tools take full paths, and what it is shown of the session it was launched from names files in the
 * developer's folder: one that changed a file there changed it past the apply (HarnessV3-TaskGraph-v2 V2-0b's drive,
 * §12.18). The session's switch refuses such a change (`agent-permits.js`, `confine`); this says where its work goes.
 * @param {string} workdir @param {string} folder  the developer's folder, which the worktree copies
 */
const agentWorkNote = (workdir, folder) =>
  `[Filament: your worktree is ${workdir}. It holds the project's files at the same paths as the developer's folder, ${folder}: where the conversation above or your brief names a file there, the one you read, change and run things on is at the same path under your worktree. Your own tools take full paths: a change to a file outside your worktree is refused (the system temp folder aside, for scratch files of your own), and so is a read or a command in the developer's folder.]`;
/**
 * Filament's note of what a worker's brief, or its card (AG-267), lets it run without anyone's answer
 * (HarnessV3-TaskGraph-v2 TG2-D44): only in a worktree of its own, where its grants hold — none, or [the note].
 * A graph task's worker under the session's agent hears of its task, and of the agent (V2-1); a team's worker given its
 * team's check, of its team (the plan's p6).
 * @param {{ grants: import("./grants.js").Grants | null, work: { wt: unknown } | null, task: { id: string } | null, team: { check?: string } | null }} sa
 */
const grantsNoted = (sa) => (sa.grants && sa.work?.wt ? [grantsNote(sa.grants, { task: !!sa.task, agent: !!sa.task && !sa.team, team: sa.team?.check ?? null })] : []);
/**
 * Filament's note to a worker whose lead reviews its plan (HarnessV3-TaskGraph-v2 TG2-D50), right ahead of its brief:
 * what to send, and what waits for its lead's go.
 */
const PLAN_REVIEW_NOTE =
  "[Filament: your lead reviews your plan before you change anything. Read what you need, then send your plan with ask_lead's plan: the files you will change, the steps in order, and how you will prove it done. A question you have goes in question, as always: your plan still waits after its answer. Until your lead answers go to your plan, your changes and commands are refused, and your reads run. Your lead's other words to your plan are its corrections: follow them, and send the plan again. With no answer 3 minutes after you sent it, go on with your plan.]";
/**
 * What a report says of the messages its sub-agent never read, to the one that sent them — its lead, or the agent that
 * planned its task (HarnessV3-TaskGraph-v2 TG2-D16, TG2-D32). "" for none.
 * @param {readonly string[] | undefined} unread
 */
export const unreadWords = (unread) =>
  unread?.length
    ? `\n\nIt ended without reading ${unread.length === 1 ? "your message" : `${unread.length} messages of yours`}, so neither its work nor this report takes ${unread.length === 1 ? "it" : "them"} into account:\n${unread.map((t) => `- ${t}`).join("\n")}`
    : "";
/**
 * What a fork reads ahead of its task: the conversation above is its own, and from here on it is a sub-agent — the main
 * agent's rule to plan, in the system prompt it shares, not its own (the bug hunt of 11-08).
 */
export const FORK_NOTE =
  "[Filament: from here on you are a sub-agent — a fork of the agent whose conversation is above, launched for the task below. Work on that task alone, with your tools, until it is done. Your final message is your report, the only thing whoever launched you sees: what you found or changed (files with paths, and line numbers where useful), what you verified, and what is left. Start it with one line, \"Subject: \" and what you found or did in under 20 words: whoever launched you may read that line before the rest. ask, plan and agent are not yours to call: nobody can answer you mid-task, the checklist and the rule to plan are the main agent's, and a sub-agent launches none of its own. A follow-up may come later in this same conversation.]";
/** The same for a task of the main agent's graph that starts as its fork (the owner's words of 10-26): it ends with report. */
export const TASK_FORK_NOTE =
  "[Filament: from here on you are a sub-agent — a fork of the agent whose conversation is above, which planned its work as a task graph and gave you one of its tasks, below. Work on that task alone, with your tools, until it is done, and end it with the report tool, as the task says: your report is what the graph and its planner read. ask, plan, tasks and agent are not yours to call: nobody can answer you mid-task, the checklist and the graph are the main agent's, and a sub-agent launches none of its own. Your task may come back to you in this same conversation, with what to change.]";
/**
 * What a fork that weighs the person's message reads ahead of it (the owner's forked steer of 11-04): the message came
 * while the agent worked, and the fork sorts it — a correction of the work at hand goes on to the agent; a question it
 * answers for the person; more work it plans as tasks the agent takes on when it chooses, with a letter. Its last
 * message starts with its verdict, which Filament reads (steer-fork.js).
 */
export const STEER_FORK_NOTE = `[Filament: from here on you are a fork of the agent whose conversation is above. While it works, the person sent it the message below, and Filament gave the message to you first, so that the agent can go on undisturbed: it works on, and does not see you. Weigh the message and do what it needs — but nothing that would make the agent's work diverge: change no file, and run nothing that changes anything; read and search as you need. ask, plan, tasks, agent and envelope are not yours to call. Your final message is the only thing Filament reads, and it starts with your verdict, in one of three forms:

Verdict: correction
— the message corrects or redirects the work the agent is doing now: stop that, do it another way, the file is elsewhere, not that one. Write that line alone, at once, calling no tool: Filament hands the message to the agent at its next step, as the person wrote it.

Verdict: question
— the message asks something. Find the answer, reading what you need, then write it under that line, for the person: Filament shows it under their message. Where the answer changes what the agent should do, end with a line "Letter:" and what the agent should know: Filament gives it to the agent sealed, to open when it reaches a stopping point.

Verdict: work
— the message asks for more work, now or later. Do none of it: plan it as tasks of the agent's task graph, in a \`\`\`json block under that line — a list of tasks, each {"id", "name", "needs", "writes", "acceptance"}, its needs among these tasks or the graph's own — or {"goal", "tasks"} where the agent has no graph yet. Then a line "Letter:" and what the agent needs to know to take them on. Filament adds the tasks to the agent's graph as proposed, none started, and gives it the letter sealed, to open when it reaches a stopping point.]`;
/** A fork's answer to its own launching call, and to the main agent's other calls still running at the fork. */
/**
 * The line a fork is weighed against, a fork launched by name and a graph task's alike: `sideLineOf` the window it
 * keeps, the compactor's assumed one (`ASSUMED_WINDOW`) where no window is known.
 * @param {number | null | undefined} window  the fork's model's window, in tokens; 0 or null with none known
 */
export const forkLineOf = (window) => sideLineOf(window || ASSUMED_WINDOW);
/**
 * Whether a task of the main agent's graph starts as its fork now (the owner's words of 10-26): its newest request read
 * from the provider's cache or wrote to it, that cache's lifetime not past, and the request with its reply — which the
 * fork copies, thinking and all — at most half the fork's own line: a fork starts with all of it and works in what is
 * left before that line.
 * @param {{ cached: boolean | null, tokens: number, reply?: number, sentAt: number, ttlMs: number } | null} snap  the
 *   turn's cache snapshot, else the last turn's kept one (`keptFork`)
 * @param {number} line  the fork's compaction line (`forkLineOf` the turn's window)
 * @param {number} at  now
 */
export const forkPays = (snap, line, at) => !!snap && snap.cached === true && at < snap.sentAt + snap.ttlMs && line > 0 && snap.tokens + (Number(snap.reply) || 0) <= line / 2;
/**
 * What a fork of a running turn carries: the larger of its newest request's count — `counted`, as its provider counted
 * it with its reply — and the loop's conversation as it stands (`now`, on the loop's line's scale, a window known or
 * not; null where the loop weighs none). Each lags the other: the count is rounds behind the conversation the fork
 * copies, a result added since; the conversation is the smaller just after a fold, the count the request before it.
 * Weighed so, no fork past the line starts. @param {number} counted @param {number | null | undefined} now
 */
export const forkWeight = (counted, now) => Math.max(counted, now ?? 0);
const FORK_OWN_CALL = "(this call launched you: your task follows)";
const FORK_OTHER_CALL = "(still running in the main agent — not yours to wait for)";
/**
 * The list a graph task under the session's agent reads (the owner's word of 10-26): the one row that stands for the main
 * agent's model, so the planner's own model does its side-by-side work. @type {import("../../core/pool.js").PoolRow[]}
 */
const PLANNER_ROWS = [{ model: "", seats: Infinity }];
const SUBAGENT_ID = /^sa_[0-9a-f]{8}$/;
/** The words, the tests and the Prompts page share: what a sub-agent reads beyond its system prompt. */
/** What a follow-up of one that never ran is told: its copy failed, so it has no context to go on in. */
const NEVER_RAN = "It never ran: launch it again, without agent_id, once its copy can be made.";

export const SUBAGENT_NOTES = Object.freeze({ worktree: WORK_NOTE, workerWorktree: WORKER_WORK_NOTE, taskWorktree: TASK_WORK_NOTE, copy: COPY_NOTE, copyAgain: COPY_AGAIN_NOTE, fork: FORK_NOTE, steerFork: STEER_FORK_NOTE, forkWorktree: forkWorkNote("<its worktree folder>"), agentWorktree: agentWorkNote, forkOwnCall: FORK_OWN_CALL, forkOtherCall: FORK_OTHER_CALL, planReview: PLAN_REVIEW_NOTE });

/**
 * A sub-agent's change as a reviewer reads it (HarnessV3-AtHome P2, HarnessV3-TaskGraph G3-3): the diff of its work,
 * not applied yet, after `note` — its head when it runs past what a view carries.
 * @param {{ of: string, files: number, diff: string }} r @param {string} note
 */
export const changeBlock = ({ of, files, diff }, note) => {
  const d = String(diff || "").replace(/\n+$/, "");
  const text = d.length > VIEW_CHARS ? `${d.slice(0, VIEW_CHARS)}\n…[Filament: the rest of the diff is left out]` : d;
  return `<change of="${of}" files="${files}">\n${note}\n\n${text}\n</change>`;
};
/** What a reviewer's folder holds beside a change it reads: the files as they were before it. @param {string} of */
export const changeNote = (of) => `The change ${of} made in its own git worktree, not applied yet: the folder you work in holds these files as they were before it.`;
/**
 * What a reviewer reads of a change made in the folder itself (HarnessV3-FailurePoints §8 item 2): the files its write
 * and edit calls named, there already, with no diff.
 * @param {string} of
 */
export const folderNote = (of) => `The files ${of} wrote in the folder you work in, which holds its change already. No git records it, so there is no diff: read each file whole.`;
/** A change made in the folder itself, as a reviewer reads it: its files, one per line. @param {readonly string[]} paths */
export const folderList = (paths) => paths.map((p) => `- ${p}`).join("\n");

/**
 * The change a reviewer reads ahead of its brief (HarnessV3-AtHome P2): a builder's or a tester's, marked as
 * background.
 * @param {{ of: string, files: number, diff: string, inFolder?: boolean }} r @returns {Opening}
 */
const reviewOpening = (r) => ({ kind: "review", count: r.files, text: changeBlock(r, `${r.inFolder ? folderNote(r.of) : changeNote(r.of)} Background only — your task follows.`) });

/**
 * The files an apply put into the session's folder, as the round it landed in records them: the helper's own
 * (HarnessV4_Git_Plan GWC-15) — none it kept as the folder had them. None where nothing went in.
 * @param {string} by @param {ApplyResult} a @returns {import("../turn-tree.js").Writes | undefined}
 */
export const appliedWrites = (by, a) => {
  const went = a.ok ? wentIn(a) : [];
  return a.ok && went.length ? { by, paths: went.map((f) => resolve(a.repo, f.path)) } : undefined;
};
/** The paths of an apply's files that came in `how`. @param {{ came?: import("../../adapters/git/worktree.js").Came[] }} a @param {import("../../adapters/git/worktree.js").CameIn} how */
const cameAs = (a, how) => (a.came || []).filter((c) => c.how === how).map((c) => c.path);
/** An apply's files but those it kept as the folder had them. @param {Extract<ApplyResult, { ok: true }>} a */
const wentIn = (a) => {
  const kept = new Set(cameAs(a, "kept"));
  return kept.size ? a.files.filter((f) => !kept.has(f.path)) : a.files;
};
/** A path as a shell reads it in a command line: quoted where it holds anything but plain characters. @param {string} p */
const shellPath = (p) => (/^[\w./@+-]+$/.test(p) ? p : JSON.stringify(p));
/**
 * What an apply's answer adds where the agent's `overlap` met files its change overlapped (11-09): those written with
 * git's conflict markers, for it to resolve — or that came with the markers a rebase left in them —, and those kept as
 * the folder had them, its change to them set aside, and how to read it (`aside`).
 * @param {Extract<ApplyResult, { ok: true }>} a
 */
const overlapTail = (a) => {
  const marked = cameAs(a, "markers").map(pathWords);
  const kept = cameAs(a, "kept");
  const m = marked.length;
  const markers = m ? ` Git's conflict markers stand in ${marked.join(", ")}: "<<<<<<< yours" over your lines, "=======", then its down to ">>>>>>> its change". Resolve ${m === 1 ? "it" : "each"} so it keeps what both meant, and leave no marker.` : "";
  if (!kept.length) return markers;
  const them = kept.length === 1 ? "it" : "them";
  const named = kept.length > 8 ? `${kept.slice(0, 8).map(pathWords).join(", ")} and ${kept.length - 8} more` : kept.map(pathWords).join(", ");
  // Its commits are held as a mark's are, so the read holds for the hold's days or until its next apply or mark.
  const read = a.aside ? `: git diff ${a.aside.base} ${a.aside.head}${kept.length > 8 ? "" : ` -- ${kept.map((p) => unnoticed(shellPath(p))).join(" ")}`} in your folder shows it, for ${Math.round(MARK_KEPT_MS / 86_400_000)} days or until this sub-agent's next apply` : "";
  return `${markers} Kept your version of ${named}, its change to ${them} set aside${read}.`;
};
/**
 * The ways on an apply refused where its change overlapped edits in the folder, as its refusal names them: the ones it
 * takes (`takes`), with `tool` — and, for the session's agent, its change brought in by hand and marked as applied,
 * where it is no task graph's (`graph`).
 * @param {string} target @param {readonly Overlap[]} takes @param {"agent" | "worker"} tool @param {boolean} [graph]
 */
const overlapWays = (target, takes, tool, graph = false) => {
  if (!takes.includes("markers")) return ` To go on, call ${tool} again with agent_id "${target}", apply_changes: true and overlap: "send_back": it redoes its change on your folder as it stands, and reports again.`;
  // A task graph's change is no mark's: the graph reads it as merged once it is applied. A copy's on another machine
  // takes no send_back (THERE_OVERLAPS).
  const back = takes.includes("send_back") ? `; "send_back" has it redo its change on your folder as it stands` : "";
  return ` To go on, call ${tool} again with agent_id "${target}", apply_changes: true and overlap: "markers" applies it all, those files with git's conflict markers for you to resolve; "mine" applies the rest and keeps your version of those files, its change to them set aside${back}.${tool === "agent" && !graph ? ` Or bring its change in by hand, then call agent with agent_id "${target}" and mark_applied: true.` : ""}`;
};
/**
 * What came of sending a refused apply's change back to rebase (`sentBack`): a task graph's (`graph`, 11-09) said as
 * the merge's — by Filament itself, which time of two, or as asked.
 * @param {string} target @param {NonNullable<Extract<ApplyResult, { ok: false }>["sentBack"]>} b @param {boolean} [graph]
 */
const sentBackLine = (target, b, graph = false) => {
  if (!b.ok) return ` It was not sent back: ${b.error}.`;
  const marked = b.marked.length ? `, git's conflict markers in its copy of ${b.marked.join(", ")} for it to resolve` : "";
  const left = b.left.length ? `; not brought onto it: ${b.left.map((c) => `${c.path} (${c.why})`).join("; ")}` : "";
  const sent = graph ? `Sent back to redo on the folder, ${b.n ? `${b.n} of ${MERGE_RETURNS}` : "as you asked"}` : "Sent back";
  return ` ${sent}: sub-agent ${target} redoes its change on your folder as it stands now${marked}${left}. Its report reaches you as a message, and its work waits for your apply again.`;
};
/** A message's or a result's `writes`, where there are any. @param {import("../turn-tree.js").Writes | undefined} w */
const withWrites = (w) => (w ? { writes: w } : {});

/**
 * What a call that applies a sub-agent's work answers — the agent's `agent_id` with `apply_changes`, a team's lead's
 * `worker`: applied, applied only in part, or nothing. A lead's apply says what came of Filament's check of the folder
 * with it (HarnessV3-TaskGraph-v2 TG2-D55): it passed, or failed before too; it failed and stands for the lead's reason;
 * the apply was undone, or would not be; no check ran; it still runs; or the apply waits behind the check of the one
 * before it. `over`: the lead's reason, in the record's words, which end its line. Where the agent's `overlap` met
 * files its change overlapped, the answer names them (`overlapTail`); a refusal where it overlapped edits in the folder
 * names the ways on it takes, with `tool` (`overlapWays`), or what came of sending it back (`sentBack`): a task graph's
 * merge sends it back by itself (11-09), and its words say which time.
 * @param {string} target @param {ApplyResult} a @param {{ over?: string | null, tool?: "agent" | "worker", overlap?: Overlap | null }} [o] @returns {ToolResult}
 */
export function appliedResult(target, a, { over = null, tool = "agent" } = {}) {
  const c = a.check || null;
  const none = { spentUsd: 0, toolCalls: 0, roundIds: [] };
  if (c?.kind === "waiting") return { ok: true, text: waitingText(target, c.behind, !!c.writing), ...none, wrote: false, note: `agent: sub-agent ${target}'s changes wait to be applied${c.behind ? `, behind ${c.writing ? "the apply" : "the folder's check"} of ${c.behind}'s` : ""}` };
  if (c?.kind === "undone") return { ok: false, text: undoneText(target, c), ...none, wrote: false, note: undoneNote(target, c) };
  if (a.ok) {
    const n = a.files.length;
    const went = wentIn(a);
    const kept = n - went.length;
    const marked = cameAs(a, "markers").length;
    const asked = `${marked ? `, ${marked} with conflict markers` : ""}${kept ? `, ${kept} kept as the folder had ${kept === 1 ? "it" : "them"}` : ""}`;
    const note = `agent: applied sub-agent ${target}'s changes (${n} file${n === 1 ? "" : "s"}${asked})${over ? ` ${over}` : c ? folderCheckNote(c) : ""}`;
    const into = went.length || !kept ? ` to your folder: ${filesLine(went)}.` : " with nothing written.";
    const text = c?.kind === "stuck" ? stuckText(target, c) : `Applied the changes of sub-agent ${target}${into}${overlapTail(a)}${c ? ` ${folderTail(c)}` : ""}`;
    // Recorded already — by the call that answered as it went in — it is not recorded again.
    const writes = a.recorded ? undefined : appliedWrites(target, a);
    // Every file kept as the folder had it: nothing was written.
    return { ok: true, text, ...none, wrote: !a.recorded && !(kept && !went.length), ...withWrites(writes), note };
  }
  if (a.partial) return { ok: false, text: `${a.error}.`, ...none, wrote: true, note: `agent: sub-agent ${target}'s changes applied only in part (${clip(a.error, 120)})` };
  // Where its change overlapped edits in the folder — a file a write would not take stops it too, with no kind.
  const overlapped = !!a.conflicts?.some((x) => x.kind);
  const on = !overlapped ? "" : a.sentBack ? sentBackLine(target, a.sentBack, !!a.graph) : "";
  const ways = !overlapped || a.sentBack?.ok || !a.takes?.length ? "" : overlapWays(target, a.takes, tool, !!a.graph);
  return { ok: false, text: `Nothing applied: ${a.error}. Your folder is as it was.${on}${ways}`, ...none, wrote: false, note: `agent: sub-agent ${target}'s changes not applied${a.sentBack?.ok ? ", sent back to rebase" : ""} (${clip(a.error, 120)})` };
}

/**
 * What the agent's `agent_id` with `mark_applied` answers (10-29): the sub-agent's work marked as applied — in the
 * folder already, nothing written — or why it was not.
 * @param {string} target @param {{ ok: true, files: import("../../adapters/git/worktree.js").ChangedFile[] } | { ok: false, error: string }} m
 * @returns {ToolResult}
 */
const markedResult = (target, m) => {
  const none = { spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false };
  if (!m.ok) return { ok: false, text: `Not marked: ${m.error}.`, ...none, note: `agent: sub-agent ${target}'s changes not marked as applied (${clip(m.error, 120)})` };
  const n = m.files.length;
  return { ok: true, text: `Marked the changes of sub-agent ${target} as applied: ${filesLine(m.files)}. Nothing of it waits now, and nothing was written; the developer sees the mark, and can undo it.`, ...none, note: `agent: marked sub-agent ${target}'s changes as applied (${n} file${n === 1 ? "" : "s"})` };
};

/**
 * The newest user message gets `text` as a block of its own; a conversation ending on the assistant gets a new user
 * message. Returns a new array (the messages it reuses are not changed).
 * @param {any[]} convo @param {string} text
 */
function withUserText(convo, text) {
  const out = convo.slice();
  const last = out.at(-1);
  if (last?.role === "user") {
    const content = Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content ?? "") }];
    out[out.length - 1] = { ...last, content: [...content, { type: "text", text }] };
  } else out.push({ role: "user", content: [{ type: "text", text }] });
  return out;
}

/**
 * The blocks of a sub-agent's user messages, in order: what its chat on another machine reads, and counts (`held`).
 * @param {any[]} messages
 */
const userBlocks = (messages) => messages.flatMap((m) => (m?.role !== "user" ? [] : Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }]));

/**
 * What of a sub-agent's messages its chat on another machine has not read: the blocks of its user messages past the
 * `held` it read — all of them, its brief and task with them, until a turn of it began there; a follow-up's words, with
 * those of a turn refused before it began. Where it read them all — a retry of the question its turn failed on —, its
 * last user message again, whole. Words, and pictures or documents carried whole, the blocks that machine takes from
 * another's agents (http/admin/remote.js `plainBlock`).
 * @param {any[]} messages  this exchange's @param {number} held
 */
function remoteContent(messages, held) {
  const all = userBlocks(messages);
  const last = messages.findLast((m) => m?.role === "user");
  const unread = all.length > held ? all.slice(held) : userBlocks(last ? [last] : []);
  return unread.filter((b) => b?.type === "text" || ((b?.type === "image" || b?.type === "document") && b.source?.type === "base64"));
}

/**
 * Why a chat another machine's agents started — or one up its line — sends no sub-agent to a machine of this Filament's
 * and lists none: those agents would work there as this Filament's own.
 */
export const AGENTS_CHAT_MACHINES =
  "this chat was started by another machine's agents: a sub-agent goes to a machine of this Filament's, and its machines are listed, only from a chat of this machine's person — leave machine and list_machines out";
/**
 * Why Filament runs no command of a chat another machine's agents started on its own (`agentsAsk`), as a planner's
 * refusal begins: their commands ask first here, and a command task or a check has nobody to ask.
 */
export const AGENTS_ASK =
  "another machine's agents started this chat, and their commands here ask first (\"Without asking\" is off on their machine's card in this machine's Settings › Remote access › Machines)";

/**
 * Why the agent's call may not send its sub-agent to another machine, in words; "" where it may: a follow-up goes on
 * where its launch ran, and what stays on this machine stays — a saved agent, a graph task's helper, a provider of this
 * machine's, a view of this chat or a fork of its request. @param {any} input @param {string} followed
 */
const remoteRefusal = (input, followed) => {
  const view = String(input?.context ?? "").trim();
  if (followed) return "a follow-up goes on where its launch ran — leave machine out";
  if (String(input?.saved_agent ?? "").trim()) return "a saved agent runs on this machine — leave saved_agent out, or machine";
  if (String(input?.task ?? "").trim()) return "a graph task's helper works on this machine — leave task out, or machine";
  if (String(input?.provider ?? "").trim()) return "provider names one of this machine's providers — name the model as that machine lists it (list_models with machine), and leave provider out";
  if (view && view !== "none") return `a sub-agent on another machine starts from its brief alone: ${view === "fork" ? "a fork copies this chat's request" : "a view of this chat"} stays on this machine — leave context out`;
  return "";
};

/** How much of a command asked to run on another machine its ask here shows, whole for any command a person reads. */
const ASKED_COMMAND_THERE = 20_000;
/**
 * The events of a turn on another machine that its run here carries (`mirrorRun`): what its rounds are drawn from —
 * its words, its calls and their output, its plan, its state, its compactions, its hooks, a budget's stop, an output
 * cut, its coding agent's notices and Filament's notes.
 */
const MIRRORED = new Set(["round-start", "round-thinking", "round-text", "tool-start", "tool-output", "tool-end", "tool-errors", "plan", "turn-state", "compacting", "compaction", "notice", "agent-notice", "budget", "output-cut", "hook", "hooks", "window", "held"]);
/**
 * How the events of a turn on another machine read in its run here (`mirrorRun`), one after another: those it carries
 * (`MIRRORED`), else null. Its blocks of words go on from those an earlier run there of the same exchange left (an
 * answer's resumed turn, the turn a follow-up's settled pause resumed): as a new run there begins, the block open here
 * ends (`endBlock`), and each of its rounds says where its own begin (`blocksBefore`) counted from the blocks held here
 * then (`held`). A run whose rounds start again from 1 is numbered on from the last round shown, so two runs there never
 * share one round here (the review of s2e); a resumed turn's, which go on from its paused round, keep theirs.
 * @param {{ endBlock: () => void, held: () => number }} words
 * @returns {(e: any) => any}
 */
export function mirrorEvents({ endBlock, held }) {
  /** The run there its events come from now, the blocks held here before its own, and what its rounds move by here. */
  let there = /** @type {string | null} */ (null);
  let base = 0;
  let rounds = 0;
  /** Whether that run's first round is still to come; the last round shown here. */
  let fresh = false;
  let last = 0;
  return (e) => {
    if (!e || typeof e !== "object") return null;
    const from = e.runId ? String(e.runId) : null;
    if (from && from !== there) {
      if (there) endBlock();
      there = from;
      base = held();
      fresh = true;
    }
    if (!MIRRORED.has(e.type)) return null;
    if (fresh && Number.isInteger(e.round)) {
      fresh = false;
      rounds = e.round > last ? 0 : last;
    }
    const round = Number.isInteger(e.round) ? e.round + rounds : null;
    if (round != null) last = Math.max(last, round);
    return {
      ...e,
      ...(round != null ? { round } : {}),
      ...(e.type === "round-start" && Number.isInteger(e.blocksBefore) ? { blocksBefore: e.blocksBefore + base } : {}),
    };
  };
}
/**
 * What a sub-agent's chat on another machine asks the person there, as its ask here (`ask`, the remote-agents plan's
 * s-asks): its words name the machine and who asks there — its chat, its coding agent, a sub-agent of it —, a command
 * whole and redacted, line by line as it would run, a question's choices by their words.
 * @param {string} machine @param {import("./remote-agents.js").RemoteAsk} a
 */
export const remoteAsked = (machine, a) => {
  // Each of its words that machine's, opening no notice of Filament's on the card (core/notices.js; the xf-words hunt's).
  // Each within bounds too, as long as no card here draws (the swarm's review of 11-10).
  const who = a.from === "chat" ? "it" : a.from === "coding-agent" ? "its coding agent" : `its sub-agent ${thereWord(a.from, NAME_THERE)}`;
  const tool = thereWord(a.tool || "a tool", NAME_THERE);
  const question = thereWord(redactSecrets(String(a.question || "").trim()));
  // The command keeps its line breaks: the person allows what they read, and a second command on a line of its own
  // must not read as the end of the first (the security re-read of 11-11). Its short line on the card is one line.
  const command = a.command ? unnoticed(cut(redactSecrets(String(a.command)), ASKED_COMMAND_THERE)) : "";
  const permission = a.kind === "permission";
  const options = permission ? [] : (Array.isArray(a.options) ? a.options : []).map((o) => thereWord(o?.label, NAME_THERE * 2));
  return {
    tool,
    args: clip(command, 160),
    question: permission ? `On ${machine}, ${who} asks to run ${tool}${question ? `: ${question}` : ""}` : `On ${machine}, ${who} asks: ${question}`,
    ...(command ? { command } : {}),
    machine,
    kind: /** @type {"permission" | "question"} */ (permission ? "permission" : "question"),
    ...(options.length ? { options } : {}),
    // A question there that takes its choices alone (its `words` false): no words of the person's are offered for it.
    ...(!permission && a.words === false ? { words: false } : {}),
  };
};

/** What a retry of an exchange that had begun its work says ahead of the question (the owner's word of 10-24). */
export const RETRY_HEAD = "[Filament: your last answer failed before it ended, and the person asks you again. Go on from what you did.]";
/**
 * Whether the conversation's newest message is the person's, holding `text`, with no answer after it: the question of
 * an exchange that failed before its agent said a word. @param {any[]} convo @param {string} text
 */
function unanswered(convo, text) {
  const last = convo.at(-1);
  if (last?.role !== "user" || !text) return false;
  const blocks = Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content ?? "") }];
  return blocks.some((/** @type {any} */ b) => b?.type === "text" && String(b.text).includes(text));
}

/**
 * The fork's messages: the loop's conversation as it stands, with the instruction as the newest user text. A reply
 * whose tool calls are still running gets a result per call saying so, so the conversation stays well-formed and
 * every byte before the instruction is the loop's own — the provider reads that prefix from its cache. `own` names
 * the call that launched a fork sub-agent, answered with `ownText`; the others get `others`.
 * @param {any[]} convo @param {string} instruction
 * @param {{ own?: string | null, ownText?: string, others?: string }} [o]
 */
export function forkMessages(convo, instruction, { own = null, ownText = FORK_OWN_CALL, others = "(still running — its result is not needed for this reply)" } = {}) {
  const last = convo.at(-1);
  if (last?.role === "assistant" && Array.isArray(last.content)) {
    const pending = last.content.filter((b) => b?.type === "tool_use");
    if (pending.length)
      return [
        ...convo,
        {
          role: "user",
          content: [
            ...pending.map((b) => ({ type: "tool_result", tool_use_id: b.id, content: own && b.id === own ? ownText : others })),
            { type: "text", text: instruction },
          ],
        },
      ];
  }
  return withUserText(convo, instruction);
}

/** Whether words are a fork's own instruction (`forkMessages`): they open with a fork's note. @param {string} text */
export const opensForkTask = (text) => [FORK_NOTE, TASK_FORK_NOTE, STEER_FORK_NOTE].some((note) => String(text ?? "").startsWith(note));

/**
 * Where a fork's own task stands in its conversation (`forkMessages`): the message its instruction joined after the
 * `opens` messages of the main agent it carries — the newest of them where that was a user message, else the one after —
 * taken only where words of it open with a fork's own note (`opensForkTask`), whatever came after them in the message
 * (the loop's note of a reply cut at its ceiling rides the newest message). -1 where it stands there no more: an
 * earlier give-way's start (turn.js `exchangesGiveWay`) took the main agent's messages' place.
 * @param {any[]} convo @param {number} opens
 */
export function forkTaskAt(convo, opens) {
  if (!(opens > 0)) return -1;
  const at = convo[opens - 1]?.role === "user" ? opens - 1 : opens;
  const m = convo[at];
  const words = m?.role === "user" && Array.isArray(m.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "text") : [];
  return words.some((/** @type {any} */ b) => opensForkTask(b.text)) ? at : -1;
}

/** The statuses a provider refuses a request's content with — what a model that reads no pictures answers one with. */
const PICTURE_REFUSALS = new Set([400, 415, 422]);

/**
 * `messages` with the pictures after the last message's words: the task's own message, a fork's instruction included.
 * @param {any[]} messages @param {{ mediaType: string, data: string }[]} pictures
 */
export function withPictures(messages, pictures) {
  const last = messages.at(-1);
  if (!pictures.length || last?.role !== "user") return messages;
  const content = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...(last.content || [])];
  return [...messages.slice(0, -1), { ...last, content: [...content, ...pictures.map((p) => imageBlock(p.mediaType, p.data))] }];
}

/**
 * `messages` with each text file the main agent attached after the last message's words, ahead of its pictures
 * (attach.js `fileBlocks`). @param {any[]} messages @param {{ name: string, text: string }[]} files
 */
export function withFiles(messages, files) {
  const last = messages.at(-1);
  if (!files.length || last?.role !== "user") return messages;
  const content = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...(last.content || [])];
  return [...messages.slice(0, -1), { ...last, content: [...content, ...fileBlocks(files)] }];
}

/**
 * A message's composer with what the main agent attached after its words — its text files, then its pictures — in
 * whichever way it composes (a follow-up's every path, a launch on another machine); itself where nothing is attached.
 * @template {(...a: any[]) => Promise<any[]>} C @param {C} compose @param {import("./attach.js").Attached | null | undefined} attached
 * @returns {C}
 */
const attachedTo = (compose, attached) => (!attached ? compose : /** @type {C} */ (async (/** @type {any[]} */ ...a) => withPictures(withFiles(await compose(...a), attached.files), attached.images)));

/**
 * @param {{ config: () => any, log: (level: string, msg: string) => void, events: { publish: (topic: string, evt: any) => void },
 *   runs: { steer: (runId: string, msg: { kind?: string, text?: string, from?: string }) => any,
 *     events?: (runId: string, o?: { since?: number, limit?: number }) => { events: any[] } | null,
 *     subscribe?: (runId: string, fn: (evt: any) => void) => () => void,
 *     startRun?: (o: { id: string, kind?: string, title?: string | null, parentId?: string | null, meta?: any }) => any,
 *     endRun?: (runId: string, o?: { status?: string }) => any,
 *     closeOnDisk?: (runId: string, end: { status: string }) => boolean } | null,
 *   liveWords?: import("../../services/live-words.js").LiveWords | null,
 *   context?: SubagentContext | null, call?: ReturnType<typeof createInternalCall> | null, now?: () => number,
 *   later?: (fn: () => void, ms: number) => void,
 *   runCheck?: (command: string, o: { root: string, signal: AbortSignal }) => Promise<{ exit: number | null, output: string, stopped: boolean }>,
 *   selfBase?: () => string, machines?: import("../../services/machines/index.js").Machines | null, cli?: string, sendsFile?: string | null,
 *   remoteWait?: (ms: number, signal: AbortSignal) => Promise<void>, keptChars?: number, dataDir?: string | null }} deps
 *   `call` replaces the front door (tests); `context` is late-bound (`setContext`) because the sessions it reads are
 *   built after the loop that launches from them. `later` runs a function once that many ms have passed (tests hold
 *   it). `runCheck` runs one command of a worker's check in its worktree (TG2-D45): in bash, with no clock of its own.
 *   `selfBase`: where Filament reaches itself now, the front door's address (AppDeps). `machines`: the machines this
 *   Filament is paired with (services/machines), where a launch's `machine` sends its sub-agent (remote-agents.js).
 *   `cli`: Filament's command line as an agent's shell runs it (environment.js `cliCommand`), which a sparse copy's
 *   helper widens it with. `sendsFile`: where the projects each machine was sent a copy of with the person's yes are
 *   kept (remote-agents.js `sendsKept`), so a project's first copy to a machine alone is asked. `remoteWait`: the
 *   pause between two reads of a sub-agent's turn on another machine (remote-agents.js `wait`; tests shorten it).
 *   `keptChars`: the ended conversations' budget (`KEPT_CHARS`; tests hold it to their own). `dataDir`: Filament's data
 *   folder, which a call's `attach` never reads from (attach.js). `liveWords`: where a running turn's words are held
 *   (services/live-words.js), a turn on another machine's among them (`mirrorRun`).
 */
export function createSubagentRegistry({ config, log, events, runs, liveWords = null, context = null, call = null, now = Date.now, later = (fn, ms) => void setTimeout(fn, ms).unref?.(), runCheck = (command, { root, signal }) => runOwnCommand(command, { root, signal, redact: redactSecrets }), selfBase = undefined, machines = null, cli = cliCommand(), sendsFile = null, remoteWait = undefined, keptChars = KEPT_CHARS, dataDir = null }) {
  const post = call || createInternalCall({ config, log, ...(selfBase ? { selfBase } : {}) });
  // The other machines' side of a sub-agent launched there (the remote-agents plan's s-launch).
  const remote = createRemoteAgents({ machines, ...(remoteWait ? { wait: remoteWait } : {}) });
  /** The projects each machine was sent a copy of with the person's yes (cp-place). */
  const sent = sendsKept(sendsFile);
  /**
   * The first message of each sub-agent on another machine whose copy there is not made yet (cp-place), by its id: a
   * launch stopped or refused while its copy went, which its follow-up makes, then says, ahead of its own words. It
   * holds what the launch attached, and goes with its record (`prune`, `forget`).
   * @type {Map<string, (signal: AbortSignal) => Promise<any[]>>}
   */
  const unplaced = new Map();
  /** The registry as it is handed out, once made: a run on another machine relays its events through it (`remoteTurn`). @type {any} */
  let registryApi = null;
  /** @type {SubagentContext | null} */
  let ctx = context;
  /** @type {Map<string, Subagent>} */
  const subs = new Map();
  /** A sub-agent's kept conversation's size in characters, by the array itself (`census`). @type {WeakMap<object, number>} */
  const convoSizes = new WeakMap();
  /** What a provider said when it refused a request that carried pictures, by model (HarnessV4_Tasks E15 AG-20): the
   *  evidence the page warns from before a picture is sent, held until that model takes one. In memory: a restart
   *  forgets it, and the next refusal says it again. @type {Map<string, string>} */
  const pictureRefusals = new Map();
  /** Filament is stopping (`shutdown`): no running turn's loop takes a delivery any more. */
  let stopping = false;
  /**
   * Per session: deliveries waiting for its next turn, its running turn, and its newest request once that turn is
   * over — kept while the provider may still cache it (dropped when its lifetime runs out), for Enhance. `paused`: its
   * last turn let go of its door on a pause (a lead's question or permission), so its resume comes, and a worker's
   * question waits for it (HarnessV3-TaskGraph-v2 TG2-D58). `folder`: the commands that passed in the folder's check
   * after its lead's applies, which guard the next (TG2-D55) — in memory: a restart forgets them; `checks`: its lead's
   * applies still in line or checked, each with its end and the hand that cuts it. `said`: the saved agents the
   * developer's newest message names in plain words — the session's agent may ask or send them though its session does
   * not name them (`heard`). `sealed`: the results its loop took sealed and has not opened, oldest first, each with its
   * number — kept with the queue through a restart (HarnessV4_Envelopes_Plan EN1); `envelopes`: the newest number given.
   * `backs`: the ways back of the results handed into its running turn (`hand`, EN4), by their key. `after`: what waits
   * for its running turn to end — a side run's launches (10-28) — run once it does, never on a pause. `opens`: whether
   * its agent opened envelopes at its last turn's close (`LiveTurn.opens`) — in memory: unknown until a turn closes.
   * @type {Map<string, ChainState>}
   */
  const chains = new Map();
  /** The turn that launched each sub-agent's newest exchange (an agent's launch), for the delivery's accounting. @type {Map<string, string>} */
  const lastParentRun = new Map();
  /**
   * What an earlier process left waiting for the session: its reports and its graph tasks' ends. A launch notice is
   * dropped — the sub-agent it announces died with that process, so its report will never come — and so is a worker's
   * question to its lead (TG2-D58): the run that waited for its answer died too; and so are the developer's words to
   * a sub-agent (decision 10), which died before it read them.
   * @param {string} id @returns {Delivery[]}
   */
  const restored = (id) => {
    try {
      const kept = ctx?.loadQueue?.(id) || [];
      // Filament's own notices — a flow's start, or the word of a flow the agent drives (HarnessV4_OneAgent_Plan OA3, OA4) —
      // are no sub-agent's (no `from`): they keep, as a team's or a flow's result handed in does (EN4). A sub-agent's
      // launch notice goes with it.
      const reports = kept.filter((d) => d.kind === "report" || d.kind === "result" || d.kind === "shell" || d.kind === "task" || d.kind === "applied" || d.kind === "check" || (d.kind === "notice" && !d.from));
      if (kept.length > reports.length) log("info", `sub-agents: session ${id}: ${kept.length - reports.length} launch notice(s), question(s) or message(s) to them from before the restart dropped — their sub-agents are gone`);
      return reports.map((d) => ({ text: d.text, from: d.from, description: d.description, kind: d.kind, ...(d.kind === "shell" ? { code: d.code ?? null } : {}), ...(d.task ? { task: d.task } : {}), ...(d.state ? { state: d.state } : {}), ...exchangeOf(d), ...(d.sent ? { sent: true } : {}), ...envelopeOf(d), ...owedOf(d), spends: [], wrote: !!d.wrote, ...withWrites(d.writes) }));
    } catch (/** @type {any} */ e) {
      log("warn", `sub-agents: session ${id}: the messages kept from before the restart could not be read (${e.message})`);
      return [];
    }
  };
  /** The names a chat keeps from its newest message (`keepHeard`). @param {string} id @returns {string[]} */
  const heardKept = (id) => {
    try {
      const v = ctx?.heardKept?.(id);
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };
  /** @param {string} id */
  const chainState = (id) => {
    let c = chains.get(id);
    // The names the developer's newest message gave come back from the chat after a restart (the bug round of 10-23).
    if (!c) {
      const kept = restored(id);
      // What its loop took sealed before the restart stays sealed, in its order (HarnessV4_Envelopes_Plan EN1).
      const sealed = kept.filter((d) => d.envelope);
      const envelopes = sealed.reduce((n, d) => Math.max(n, Number(d.envelope) || 0), 0);
      chains.set(id, (c = { queue: kept.filter((d) => !d.envelope), sealed, envelopes, turn: null, paused: false, warm: null, warmTimer: null, folder: [], checks: new Set(), said: new Set(heardKept(id)), backs: new Map(), after: [] }));
    }
    return c;
  };
  /**
   * The session's messages its loop has not read — the queue and a running turn's inbox — kept on the session, so a
   * restart delivers them with the next turn instead of losing them.
   * @param {string} chainId
   */
  const persist = (chainId) => {
    const c = chains.get(chainId);
    if (!c || !ctx?.saveQueue) return;
    const unread = [...c.queue, ...(c.turn && !c.turn.closed ? c.turn.inbox : []), ...c.sealed];
    try {
      ctx.saveQueue(chainId, unread.map((d) => ({ text: d.text, from: d.from, description: d.description, kind: d.kind, ...(d.kind === "shell" ? { code: d.code ?? null } : {}), ...(d.task ? { task: d.task } : {}), ...(d.state ? { state: d.state } : {}), ...exchangeOf(d), ...(d.sent ? { sent: true } : {}), ...envelopeOf(d), ...owedOf(d), ...(d.wrote ? { wrote: true } : {}), ...withWrites(d.writes) })));
    } catch (/** @type {any} */ e) {
      log("warn", `sub-agents: session ${chainId}: its waiting messages could not be kept for a restart (${e.message})`);
    }
  };

  /** Per session: the reports kept aside for the developer, as the session keeps them (loaded once). @type {Map<string, HeldReport[]>} */
  const helds = new Map();
  /** @param {string} chainId @returns {HeldReport[]} */
  const heldOf = (chainId) => {
    let list = helds.get(chainId);
    if (!list) {
      try {
        list = (ctx?.loadHeld?.(chainId) || []).filter((h) => h && h.agentId && h.text);
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agents: session ${chainId}: the reports kept for the developer could not be read (${e.message})`);
        list = [];
      }
      helds.set(chainId, list);
    }
    return list;
  };
  /** @param {string} chainId @param {HeldReport[]} list */
  const saveHelds = (chainId, list) => {
    helds.set(chainId, list);
    try {
      ctx?.saveHeld?.(chainId, list);
    } catch (/** @type {any} */ e) {
      log("warn", `sub-agents: session ${chainId}: the reports kept for the developer could not be saved for a restart (${e.message})`);
    }
  };
  /** Deleted chats a turn of which still ran: what the registry kept for each goes as that turn closes. @type {Set<string>} */
  const goneChats = new Set();
  /** A deleted chat's entries let go: its state (its warm request's timer cleared) and the reports kept aside for it. @param {string} chainId */
  const dropChat = (chainId) => {
    const c = chains.get(chainId);
    if (c?.warmTimer) clearTimeout(c.warmTimer);
    // Its cards first: a waiting one's decline tells the agent, which would make the chat's state anew after its delete.
    holds.drop(chainId);
    chains.delete(chainId);
    helds.delete(chainId);
    goneChats.delete(chainId);
  };
  /** @param {string} chainId @param {HeldReport} h */
  const keepHeld = (chainId, h) => {
    const list = heldOf(chainId).filter((x) => !(x.agentId === h.agentId && x.exchange === h.exchange));
    list.push(h);
    saveHelds(chainId, list.slice(-MAX_HELD));
  };
  /** @param {string} chainId @param {string} agentId @param {number} exchange */
  const dropHeld = (chainId, agentId, exchange) => {
    const list = heldOf(chainId);
    const rest = list.filter((x) => !(x.agentId === agentId && x.exchange === exchange));
    if (rest.length !== list.length) saveHelds(chainId, rest);
  };

  /** Sessions whose kept threads have joined the registry. @type {Set<string>} */
  const recalled = new Set();
  /** Sub-agents the registry let go while their session keeps them: given back, they say so, never "a restart". @type {Set<string>} */
  const letGo = new Set();
  /** A sub-agent as its session keeps it (BW-10). @param {Subagent} sa @returns {SavedThread} */
  const frozen = (sa) => ({
    id: sa.id,
    origin: sa.origin,
    ...(sa.heard ? { heard: true } : {}),
    ...(sa.second ? { second: true } : {}),
    ...(sa.weighs ? { weighs: sa.weighs } : {}),
    may: sa.may,
    asked: sa.asked,
    card: { tag: sa.card.tag, name: sa.card.name, thinks: sa.card.thinks, may: sa.card.may, ...(sa.card.toolsOff?.length ? { toolsOff: [...sa.card.toolsOff] } : {}) },
    team: sa.team ? teamKept(sa.team) : null,
    model: sa.model,
    seat: sa.seat,
    ...(sa.models ? { models: sa.models } : {}),
    ...(sa.effort ? { effort: sa.effort } : {}),
    ...(sa.wire ? { wire: sa.wire } : {}),
    list: sa.list,
    ...(sa.crew?.length ? { crew: sa.crew } : {}),
    description: sa.description,
    cwd: sa.cwd,
    mode: sa.mode,
    view: sa.view,
    running: sa.running,
    changes: sa.changes,
    start: sa.start,
    seen: sa.seen,
    memory: sa.memory,
    deliver: sa.deliver,
    aside: sa.aside,
    status: sa.status,
    startedAt: sa.startedAt,
    shares: sa.shares,
    ...(sa.noCopy ? { noCopy: sa.noCopy } : {}),
    cut: !!sa.cutByRestart,
    thinking: sa.fork ? null : sa.thinking,
    // Memory's brief keeps its words and the model it was written for while its conversation opens with it: a run that
    // goes on to a model Memory settings exclude sends it the thread without them, after a restart too (`forModel`). A
    // fresh start's keeps its exchange.
    opening: sa.opening.map((b) => ({ kind: b.kind, count: b.count, chars: b.chars ?? b.text.length, ...(b.exchange ? { exchange: b.exchange } : {}), ...(b.kind === "brief" ? { text: b.text, ...(b.model ? { model: b.model } : {}) } : {}) })),
    // Its copy's folder too: after a restart its parked copy is its version still, where it is its own (`copyOf`).
    work: sa.work ? { repo: sa.work.repo, base: sa.work.base, head: sa.work.head, files: sa.work.files.slice(0, 200), applied: sa.work.applied, ...(sa.work.undone ? { undone: sa.work.undone } : {}), ...(sa.work.kind ? { kind: sa.work.kind } : {}), ...(sa.work.copy ? { copy: sa.work.copy } : {}), ...(sa.work.there ? { there: true } : {}), ...(sa.work.left?.length ? { left: sa.work.left.slice(0, 200) } : {}), ...(sa.work.wt?.dest || sa.work.dest ? { dest: String(sa.work.wt?.dest || sa.work.dest) } : {}) } : null,
    exchanges: sa.exchanges.map((x) => ({
      prompt: x.prompt,
      description: x.description,
      by: x.by,
      runId: x.runId,
      ...(x.mirror ? { mirror: x.mirror } : {}),
      status: x.status,
      startedAt: x.startedAt,
      endedAt: x.endedAt,
      delivery: x.delivery,
      ...(x.pictures?.length ? { pictures: x.pictures } : {}),
      ...(x.files?.length ? { files: x.files } : {}),
      ...(x.handed ? { handed: x.handed } : {}),
      ...(x.caughtUp ? { caughtUp: x.caughtUp } : {}),
      ...(x.fresh ? { fresh: x.fresh } : {}),
      ...(x.why ? { why: x.why } : {}),
      ...(x.bounce ? { bounce: x.bounce } : {}),
      ...(x.folder ? { folder: x.folder } : {}),
      ...(x.drew?.length ? { drew: x.drew } : {}),
      ...(x.made?.length ? { made: x.made } : {}),
      ...(x.moved?.length ? { moved: x.moved } : {}),
      ...(x.sentIn ? { sentIn: x.sentIn } : {}),
      outcome: x.outcome
        ? { report: x.outcome.report, error: x.outcome.error, ms: x.outcome.ms, rounds: x.outcome.rounds, toolCalls: x.outcome.toolCalls, tokensIn: x.outcome.tokensIn, tokensOut: x.outcome.tokensOut, spentUsd: x.outcome.spentUsd, wrote: x.outcome.wrote, stoppedBy: x.outcome.stoppedBy ?? null, ...(x.outcome.failure ? { failure: x.outcome.failure } : {}), ...(x.outcome.fromLog ? { fromLog: true } : {}), ...(x.outcome.held ? { held: x.outcome.held } : {}), ...answeredKept(x.outcome) }
        : null,
    })),
    ...(sa.questions ? { questions: sa.questions } : {}),
    ...(sa.grants ? { grants: sa.grants } : {}),
    ...(sa.checked ? { checked: sa.checked } : {}),
    ...(sa.folderRed ? { folderRed: sa.folderRed } : {}),
    ...(sa.folderUndone ? { folderUndone: sa.folderUndone } : {}),
    ...(sa.attempt ? { attempt: attemptOf(sa.attempt) } : {}),
    ...(sa.task || sa.taskWas ? { task: sa.task?.id || String(sa.taskWas) } : {}),
    ...(sa.hunts ? { hunts: sa.hunts } : {}),
    ...(sa.hunted ? { hunted: sa.hunted } : {}),
    // Its conversation, for its next message after a restart (10-26) — never a copy of the main agent's: that one was
    // the main agent's request, its tools and its thinking, and given back it runs as its card, reading what was said.
    ...(sa.convo.length && !sa.fork && sa.view !== "fork" ? { convo: sa.convo } : {}),
    ...(sa.remote ? { remote: { ...sa.remote, machine: { ...sa.remote.machine } } } : {}),
  });
  /** Graph workers whose threads the session keeps: kept once their change waited for the developer's Apply. @type {Set<string>} */
  const keptWorkers = new Set();
  /**
   * The graph task each coding agent's helper was launched for, by `chainId\ntask` (the Hunter's of 10-28: two launches
   * could name one task, the second while the first's copy was being made): its id — null while its launch goes on.
   * @type {Map<string, string | null>}
   */
  const helping = new Map();
  /**
   * The session keeps the sub-agent's thread as it stands now. A graph task's record is its graph — but a worker whose
   * change waits for the developer's Apply is kept too, as a helper's is, so its work stays in Changes after a restart
   * (the owner's of 10-28), and kept as it moves on after.
   * @param {Subagent} sa
   */
  const keep = (sa) => {
    if (!ctx?.saveThread) return;
    if (sa.task && !keptWorkers.has(sa.id)) {
      if (!ctx.waitsForYou?.(sa.chainId, sa.id)) return;
      keptWorkers.add(sa.id);
    }
    try {
      ctx.saveThread(sa.chainId, frozen(sa), MAX_THREADS);
    } catch (/** @type {any} */ e) {
      log("warn", `sub-agent ${sa.id}: its thread could not be kept for a restart (${e?.message || e})`);
    }
  };
  /**
   * A thread its session kept, as the registry holds a sub-agent: ended, with its conversation where the session kept
   * it whole. An exchange the record left running was cut with the process that ran it — a crash said nothing of it —
   * and ends so here.
   * @param {string} chainId @param {SavedThread} t @param {"restart" | "let-go"} why @returns {Subagent}
   */
  const thawed = (chainId, t, why) => {
    /** @type {Exchange[]} */
    const exchanges = (Array.isArray(t.exchanges) ? t.exchanges : []).map((x) => ({
      prompt: String(x.prompt || ""),
      description: String(x.description || ""),
      by: x.by,
      runId: x.runId || null,
      ...(typeof x.mirror === "string" && x.mirror ? { mirror: x.mirror } : {}),
      status: x.outcome ? String(x.status) : "aborted",
      startedAt: Number(x.startedAt) || 0,
      endedAt: x.endedAt ?? null,
      delivery: x.outcome ? x.delivery : t.deliver ? "auto" : "held",
      ...(x.pictures?.length ? { pictures: x.pictures } : {}),
      ...(x.files?.length ? { files: x.files } : {}),
      ...(x.handed ? { handed: x.handed } : {}),
      ...(x.caughtUp ? { caughtUp: x.caughtUp } : {}),
      ...(x.fresh ? { fresh: x.fresh } : {}),
      ...(x.why ? { why: String(x.why) } : {}),
      ...(Number(x.bounce) > 0 ? { bounce: Number(x.bounce) } : {}),
      ...(Number(x.folder) > 0 ? { folder: Number(x.folder) } : {}),
      ...(drewOf(x.drew).length ? { drew: drewOf(x.drew) } : {}),
      ...(madeOf(x.made).length ? { made: madeOf(x.made) } : {}),
      ...(Array.isArray(x.moved) && x.moved.length ? { moved: x.moved.map((m) => ({ model: String(m?.model || ""), why: String(m?.why || ""), runId: m?.runId ? String(m.runId) : null })) } : {}),
      ...(sentInOf(x.sentIn) ? { sentIn: /** @type {SentIn} */ (sentInOf(x.sentIn)) } : {}),
      outcome: x.outcome
        ? { status: String(x.status), ok: x.status === "done", report: String(x.outcome.report || ""), error: x.outcome.error ?? null, ms: Number(x.outcome.ms) || 0, rounds: Number(x.outcome.rounds) || 0, toolCalls: Number(x.outcome.toolCalls) || 0, tokensIn: Number(x.outcome.tokensIn) || 0, tokensOut: Number(x.outcome.tokensOut) || 0, spentUsd: Number(x.outcome.spentUsd) || 0, roundIds: [], wrote: !!x.outcome.wrote, stoppedBy: x.outcome.stoppedBy ?? null, taskReport: null, ...(x.outcome.failure ? { failure: x.outcome.failure } : {}), ...(x.outcome.fromLog ? { fromLog: true } : {}), ...heldKept(x.outcome.held), ...answeredKept(x.outcome) }
        : { status: "aborted", ok: false, report: "", error: CUT_BY_RESTART, ms: 0, rounds: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, spentUsd: 0, roundIds: [], wrote: false, stoppedBy: null, taskReport: null },
    }));
    const unfinished = (Array.isArray(t.exchanges) ? t.exchanges : []).some((x) => !x.outcome);
    // Its conversation, where its session kept it whole and its newest exchange ended as its own: its next message goes
    // on in it (10-26). One a restart cut, or a message of which is kept no more, starts fresh from what was said.
    const convo = !unfinished && !t.cut && Array.isArray(t.convo) && t.convo.length ? t.convo : null;
    return {
      id: t.id,
      chainId,
      origin: t.origin,
      ...(t.heard === true ? { heard: true } : {}),
      ...(t.second === true ? { second: true } : {}),
      ...(typeof t.weighs === "string" && t.weighs ? { weighs: t.weighs } : {}),
      may: t.may,
      asked: !!t.asked,
      engine: ctx?.agentOf?.(t.model) ? "acp" : "loop",
      team: t.team ? teamKept(t.team) : null,
      // A follow-up goes without the tools its launch went without (SA2), after a restart too.
      card: { tag: t.card.tag, name: t.card.name, thinks: String(t.card.thinks || ""), may: t.card.may, ...(Array.isArray(t.card.toolsOff) && t.card.toolsOff.length ? { toolsOff: CARD_TOOLS.filter((g) => t.card.toolsOff?.includes(g)) } : {}) },
      // A graph task's worker given back is the graph's no longer: its thread names the task, its work waits in Changes.
      task: null,
      taskWas: typeof t.task === "string" && t.task ? t.task : null,
      // A Hunter's task, which that task's box counts after the restart too (UX9).
      ...(typeof t.hunts === "string" && TASK_ID.test(t.hunts) ? { hunts: t.hunts } : {}),
      // …and that task as the graph held it, which its report and a task its finding names go by (11-02).
      ...(typeof t.hunts === "string" && TASK_ID.test(t.hunts) && typeof t.hunted?.name === "string" && Number.isFinite(t.hunted.graph) ? { hunted: { name: t.hunted.name, graph: Number(t.hunted.graph) } } : {}),
      model: t.model,
      // A follow-up runs on the model and the effort its launch gave it (E23-D5), after a restart too.
      effort: effortKept(t.effort),
      wire: typeof t.wire === "string" && t.wire ? t.wire : null,
      list: t.list === "workers" ? "workers" : "side",
      // A team's worker goes on down its team's rows after a restart too (the review of 3664a7358).
      crew: Array.isArray(t.crew) && t.crew.length ? t.crew.filter((r) => r && typeof r.model === "string").map((r) => ({ model: r.model, ...(typeof r.effort === "string" && r.effort ? { effort: r.effort } : {}) })) : null,
      seat: t.seat ? { pooled: true, named: t.seat.named === true, skipped: (Array.isArray(t.seat.skipped) ? t.seat.skipped : []).map((k) => ({ model: String(k.model), why: String(k.why) })) } : null,
      models: modelsKept(t.models),
      description: t.description,
      cwd: t.cwd,
      files: null,
      grants: t.grants ? withCardRuns(t.grants.card, grantsOf({ check: t.grants.check, may_run: t.grants.mayRun })) : null,
      // Its launch's run is gone: its next message is a follow-up, which no plan's review holds.
      planReview: false,
      mode: t.mode || null,
      view: t.view,
      running: !!t.running,
      changes: t.changes || null,
      start: t.start || null,
      seen: t.seen || null,
      memory: true,
      background: true,
      deliver: !!t.deliver,
      aside: !!t.aside,
      cutByRestart: unfinished || !!t.cut,
      restored: convo ? null : why,
      back: why,
      pausing: null,
      thinking: t.thinking || null,
      requestId: null,
      status: unfinished ? "aborted" : t.status,
      startedAt: Number(t.startedAt) || 0,
      exchanges,
      opening: (Array.isArray(t.opening) ? t.opening : []).map((b) => ({ kind: b.kind, count: Number(b.count) || 0, text: b.kind === "brief" && typeof b.text === "string" ? b.text : "", chars: Number(b.chars) || 0, ...(b.kind === "brief" && typeof b.model === "string" ? { model: b.model } : {}), ...(Number(b.exchange) > 0 ? { exchange: Number(b.exchange) } : {}) })),
      convo: convo || [],
      // Its parked copy's folder, where it is its own still (the review of d65a984a9: after a restart the Changes page
      // offered none) — a patch's while its record stands, a copy's while its record names it.
      work: t.work ? { repo: t.work.repo, base: t.work.base, head: t.work.head || null, wt: null, files: Array.isArray(t.work.files) ? t.work.files : [], applied: Array.isArray(t.work.applied) ? t.work.applied : [], error: null, ...(typeof t.work.undone === "string" ? { undone: t.work.undone } : {}), ...(t.work.kind === "patch" ? { kind: /** @type {const} */ ("patch") } : {}), ...(t.work.there === true && t.remote ? { there: /** @type {const} */ (true) } : {}), ...(t.work.there === true && t.remote && Array.isArray(t.work.left) && t.work.left.length ? { left: t.work.left.slice(0, 200).map((/** @type {any} */ l) => ({ path: String(l?.path ?? ""), why: String(l?.why ?? "") })) } : {}), ...(t.work.copy?.kind === "clone" || t.work.copy?.kind === "sparse" ? { copy: { kind: /** @type {"clone" | "sparse"} */ (t.work.copy.kind), paths: Array.isArray(t.work.copy.paths) ? t.work.copy.paths.map(String) : [] } } : {}), ...(typeof t.work.dest === "string" && (t.work.kind === "patch" ? patchHeldBy : copyHeldBy)(t.work.dest, t.id) ? { dest: t.work.dest } : {}) } : null,
      shares: t.shares || null,
      noCopy: t.noCopy || null,
      fork: null,
      settled: null,
      questions: Math.max(0, Math.floor(Number(t.questions) || 0)),
      checked: t.checked ? { command: String(t.checked.command || ""), exit: typeof t.checked.exit === "number" ? t.checked.exit : null, head: t.checked.head || null } : null,
      folderRed: t.folderRed?.head ? { command: String(t.folderRed.command || ""), exit: typeof t.folderRed.exit === "number" ? t.folderRed.exit : null, head: String(t.folderRed.head) } : null,
      folderUndone: t.folderUndone?.command ? { command: String(t.folderUndone.command), exit: typeof t.folderUndone.exit === "number" ? t.folderUndone.exit : null } : null,
      folderBacks: 0,
      attempt: t.attempt?.group ? { group: String(t.attempt.group), n: Number(t.attempt.n) || 1, of: Number(t.attempt.of) || 1, won: t.attempt.won === true, dropped: t.attempt.dropped ? String(t.attempt.dropped) : null } : null,
      run: null,
      // One on another machine goes on in its chat there — from what of its conversation here that chat read, where
      // that is kept (`held`), and from its next message alone where it is not.
      ...(t.remote?.machine?.id && typeof t.remote.cwd === "string" ? { remote: { machine: { id: String(t.remote.machine.id), name: String(t.remote.machine.name || t.remote.machine.id) }, cwd: t.remote.cwd, chat: t.remote.chat ? String(t.remote.chat) : null, model: t.remote.model ? String(t.remote.model) : null, effort: t.remote.effort ? String(t.remote.effort) : null, ...(PERMISSION_MODES.includes(/** @type {any} */ (t.remote.fixed)) ? { fixed: t.remote.fixed } : {}), ...(PERMISSION_MODES.includes(/** @type {any} */ (t.remote.mode)) ? { mode: t.remote.mode } : {}), ...(t.remote.modeless === true ? { modeless: true } : {}), ...(t.remote.stopOwed === true ? { stopOwed: true } : {}), ...(t.remote.prefer ? { prefer: String(t.remote.prefer) } : {}), ...(t.remote.unnamed === true ? { unnamed: true } : {}), ...(t.remote.pick ? { pick: String(t.remote.pick) } : {}), ...(t.remote.copy?.id ? { copy: { id: String(t.remote.copy.id), project: String(t.remote.copy.project || ""), commit: String(t.remote.copy.commit || ""), ...(Number(t.remote.copy.keeps) > 0 ? { keeps: Number(t.remote.copy.keeps) } : {}) } } : {}), run: t.remote.run ? String(t.remote.run) : null, held: !convo ? 0 : Number.isInteger(t.remote.held) ? Number(t.remote.held) : t.remote.chat ? userBlocks(convo).length : 0 } } : {}),
    };
  };
  /** Sessions whose kept threads could not be read, by id: when — they are read again RECALL_AGAIN_MS after. @type {Map<string, number>} */
  const unread = new Map();
  /**
   * The session's kept threads join the registry, once: each sub-agent it holds no more — after a restart, or let go
   * past its newest — is there again for the surfaces, a Send, an Apply and a next message (BW-10). Threads that could
   * not be read are read again at a call RECALL_AGAIN_MS after, the failure said once: the stop a turn on another
   * machine is owed goes then (the xf-words2 hunt's). → false where they could not be read, now or a moment ago.
   * @param {string} chainId
   */
  const recall = (chainId) => {
    const id = String(chainId || "");
    if (!id || recalled.has(id) || !ctx?.loadThreads) return true;
    const failed = unread.get(id);
    if (failed !== undefined && now() - failed < RECALL_AGAIN_MS) return false;
    recalled.add(id);
    /** @type {SavedThread[]} */
    let kept = [];
    try {
      // One the registry holds already is passed over as it is read: its texts and its conversation are not decoded.
      kept = ctx.loadThreads(id, (agentId) => subs.has(agentId)) || [];
    } catch (/** @type {any} */ e) {
      recalled.delete(id);
      unread.set(id, now());
      if (failed === undefined) log("warn", `sub-agents: session ${id}: the threads it kept could not be read (${e?.message || e}); read again in ${RECALL_AGAIN_MS / 1000}s`);
      return false;
    }
    unread.delete(id);
    let working = false;
    for (const t of kept) {
      if (!t?.id || !t.card || subs.has(t.id)) continue;
      const sa = thawed(id, t, letGo.has(t.id) ? "let-go" : "restart");
      subs.set(t.id, sa);
      letGo.delete(t.id);
      // One on another machine a restart here cut goes on there: its turn there is stopped, and what it changed in its
      // copy there by then is brought here (cp-back), as its exchange's end would have.
      if (sa.remote && (Array.isArray(t.exchanges) ? t.exchanges : []).some((x) => !x.outcome)) {
        stopCut(sa);
        // Its run here, left open by the stop that cut it, ends as its exchange did (`mirrorRun`).
        const shown = sa.exchanges.at(-1)?.mirror;
        if (shown) runs?.closeOnDisk?.(shown, { status: "aborted" });
        if (sa.work?.there) void (cutStops.get(sa.id) || Promise.resolve()).then(() => bringBack(sa)).then(() => changed(sa));
      }
      // A stop its turn there was owed before this start, kept with its thread, goes now: its turn may have run on there
      // all the while. What its copy holds is brought once the stop reached (`bringOnce`).
      else if (sa.remote?.stopOwed) void (sa.work?.there ? bringBack(sa).then(() => changed(sa)) : sendOwed(sa));
      // What a restart cut in its copy is read onto its refs, and its work from them (HarnessV4_Worktrees_Plan W3).
      if (sa.work) void reconcileWork(sa);
      working ||= !!sa.work;
    }
    // Work brought into the folder while Filament was down no longer waits.
    if (working) settleWaiting(id);
    // What came back whole is held to the registry's budget at once, not at the next exchange's end: after a restart the
    // threads each chat kept came back with every conversation (Fable 5.2's review of 11-17). In place only — a thread
    // let go of whole here would be read back at the next call.
    if (kept.length)
      try {
        prune(null, false);
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agents: session ${id}: the conversations read back were held to no budget (${e?.message || e})`);
      }
    return true;
  };

  /** Sub-agents and checks whose copy is in use — being taken, or an answer or a check runs in it: a reconcile or a trim of the copies spares them. @type {Set<string>} */
  const treeIds = new Set();
  /**
   * The sub-agents whose work could not be captured at an exchange's end, nor on a second try (the owner's of 11-09):
   * each copy stays in use, its work in it alone — with its chat, its folder, why and since when, for Filament's
   * footprint and Still open to say (`failedCaptures`). @type {Map<string, { id: string, chainId: string, repo: string, dest: string, error: string, at: number }>}
   */
  const unsaved = new Map();
  /**
   * Chats deleted in this process (the owner's of 11-09): a helper of one at work as it went lets go of what it kept
   * once its exchange ends (`closeWork`). @type {Set<string>}
   */
  const deletedChats = new Set();
  /**
   * A deleted chat's helpers whose work could not be captured, by id: how long the next try of its capture waits, and
   * whether one is set (`saveLater`). @type {Map<string, { wait: number, set: boolean }>}
   */
  const savesLater = new Map();
  /**
   * A deleted chat's helper whose work could not be captured has its capture tried again later (the review of 11-09): no
   * exchange of its comes to keep its work, and its copy stays in use, that work in it alone, until it is kept on its
   * refs — then `closeWork` gives the copy back and lets it go with the rest of its chat's (`letGoChatWork`). One try
   * set at a time, each waiting twice as long as the one before, `SAVE_AGAIN_MAX_MS` at most.
   * @param {Subagent} sa
   */
  const saveLater = (sa) => {
    const s = savesLater.get(sa.id) || { wait: SAVE_AGAIN_MS, set: false };
    if (s.set) return;
    savesLater.set(sa.id, { wait: Math.min(s.wait * 2, SAVE_AGAIN_MAX_MS), set: true });
    later(() => {
      const next = savesLater.get(sa.id);
      if (next) next.set = false;
      if (!unsaved.has(sa.id) || subs.get(sa.id) !== sa) return void savesLater.delete(sa.id);
      // One at work again keeps its work as that exchange ends.
      if (sa.status !== "running") void closeWork(sa).catch(() => null);
    }, s.wait);
  };
  /**
   * A deleted chat's helpers let go of what they kept (the owner's of 11-09): each one's copy goes — its work is on its
   * refs already —, and its refs go where nothing of its work waits; what waits stays, cheap, found by worktree.js
   * `waitingTaskWork`. Its helpers: those named, else those the registry holds and those whose threads the chat kept
   * (`ctx.goneHelpers`); its repositories: their folders, and every folder Filament knows where a helper is not held
   * here (`ctx.folders`). A copy in use stays — its exchange's end lets it go. In the background; failures logged.
   * @param {string} chainId @param {Subagent[]} [only]
   */
  const letGoChatWork = async (chainId, only) => {
    try {
      const mine = only || [...subs.values()].filter((sa) => sa.chainId === chainId);
      const ids = [...new Set([...mine.map((sa) => sa.id), ...(only ? [] : ctx?.goneHelpers?.(chainId) || [])])];
      if (!ids.length) return;
      const held = new Set(mine.map((sa) => sa.id));
      // One on another machine keeps its refs in the repository its copy was sent from, its own folder being there.
      const folders = [...mine.map((sa) => String((sa.work?.there ? sa.work.repo : sa.cwd) || "")), ...(ids.some((id) => !held.has(id)) ? ctx?.folders?.() || [] : [])];
      const r = await letGoHelpers(folders, ids, { keep: () => new Set(treeIds) });
      for (const f of r.failed) log("warn", `sub-agents: deleted chat ${chainId}: what its helpers kept in ${f.folder} could not all be let go (${f.error})`);
      if (r.gone.length || r.stayed.length || r.waiting.length)
        log("info", `sub-agents: deleted chat ${chainId}: ${r.gone.length} helper cop${r.gone.length === 1 ? "y" : "ies"} let go${r.stayed.length ? `, ${r.stayed.length} kept (${r.stayed.map((s) => `${s.id}: ${s.why}`).join("; ")})` : ""}${r.waiting.length ? `; work that waits stays on the refs of ${r.waiting.map((w) => `${w.id} in ${w.repo}`).join(", ")}` : ""}`);
    } catch (/** @type {any} */ e) {
      log("warn", `sub-agents: deleted chat ${chainId}: what its helpers kept could not be let go (${e?.message || e})`);
    }
  };
  /** Restored sub-agents whose work was read against the repository, each once. @type {Map<string, Promise<void>>} */
  const reconciled = new Map();
  /**
   * A sub-agent kept from before a restart reads its work from the repository once (HarnessV4_Worktrees_Plan W3): what
   * an exchange the restart cut left in its copy goes onto its refs first (`pruneTaskWorktrees`), and its work is what
   * the refs say — the thread kept on disk may stand a capture behind them. Where something else of Filament's holds
   * its copy as it is put right — the start's sweep, another copy's taking, which keep what it holds on its refs — the
   * refs are read once that is over (`untilCopyFree`, the owner's of 11-09, its review: read before, its follow-up reset
   * the copy to the capture behind and wrote that back on its refs, and its apply brought that in).
   * @param {Subagent} sa
   */
  const reconcileWork = (sa) => {
    if (!sa.back || !sa.work || sa.work.wt) return Promise.resolve();
    let p = reconciled.get(sa.id);
    if (!p) {
      p = (async () => {
        // One whose copy is on another machine has none here: its refs alone, in its own repository.
        const there = !!sa.work?.there;
        if (!there) {
          await pruneTaskWorktrees(sa.cwd, treeIds).catch(() => 0);
          await untilCopyFree(sa.cwd, sa.id).catch(() => {});
        }
        const w = sa.work;
        const refs = await taskRefs(there && w ? w.repo : sa.cwd, sa.id).catch(() => null);
        if (!w || w.wt || !refs || (refs.base === w.base && refs.head === (w.head || w.base))) return;
        w.base = refs.base;
        w.head = refs.head;
        w.files = await changedFiles(refs.repo, refs.base, refs.head).catch(() => w.files);
        changed(sa);
      })().catch(() => {});
      reconciled.set(sa.id, p);
    }
    return p;
  };
  /** The loop's folder rule, for a worktree's place. @param {string} p */
  const allowedFolder = (p) => !ctx?.folderProblem?.(p);
  /**
   * Of which kind a sub-agent's worktree is made, as it gets one — at its launch or as its patch moves (workspace-kind.js
   * `copyKind`, the owner's plan of 11-09 for big repos): read of its repository and drive (`copyFacts`) — nothing read
   * where the setting is Worktree, a full one whatever the repository —, the setting its launch had (one kept from
   * before a restart: the chat's now). A sparse one's cone holds the paths its launch named, in the session's folder.
   * @param {Subagent} sa
   * @returns {Promise<{ kind: "worktree" | "clone" | "sparse", paths: string[] }>}
   */
  const copyFor = async (sa) => {
    const setting = sa.workspace?.setting ?? workspaceSetting(settingsOf(sa.chainId).sub);
    const facts = setting === "worktree" ? null : await copyFacts(sa.cwd).catch(() => null);
    const k = copyKind({ setting, may: sa.may, ...facts });
    if (k.kind !== "worktree") log("info", `sub-agent ${sa.id}: its worktree is ${k.kind === "clone" ? "a clone" : "sparse"} (${k.why})`);
    return { kind: k.kind, paths: k.kind === "sparse" ? (sa.workspace?.paths || []).map((p) => resolve(sa.cwd, p)) : [] };
  };
  /** What its work keeps of its copy's kind, for its next exchange's copy: nothing for a full one. @param {{ kind: "worktree" | "clone" | "sparse", paths: string[] }} c */
  const keptCopy = (c) => (c.kind === "worktree" ? {} : { copy: { kind: c.kind, paths: c.paths } });
  /**
   * Said after the worktree note where its copy is sparse (the owner's plan of 11-09 for big repos), as Phase 0's LFS
   * line is: the folders it holds, and Filament's command that brings in another — none, or [the note].
   * @param {Subagent} sa
   */
  const sparseNoted = (sa) => {
    const wt = sa.work?.wt;
    return wt && wt.kind === "sparse" && "cone" in wt && wt.cone?.length ? [`[Filament: ${sparseWords(wt.cone, cli)}]`] : [];
  };
  /**
   * A writing sub-agent's worktree, opened at its launch. Where the folder has none to give — no repository, none with
   * a commit, no git — it shares the session's folder, and `shares` says why; where the copy failed in a repository
   * (HarnessV4_Worktrees_Plan W1) `noCopy` says why, and it does not run. `signal`: its exchange's stop. `batch`: the
   * launches asked with it, which share one snapshot of the folder (worktree.js `openTaskWorktree`).
   * @param {Subagent} sa @param {AbortSignal | null} [signal] @param {string | null} [batch]
   * @returns {Promise<"none" | "failed" | null>}  why there is no worktree; null: there is one
   */
  const openWork = async (sa, signal = null, batch = null) => {
    treeIds.add(sa.id);
    sa.shares = null;
    sa.noCopy = null;
    /** @type {"none" | "failed" | null} */
    let missed = null;
    try {
      const ws = sa.workspace;
      // A card whose newest launches in this repository each moved to a worktree soon starts in one (rule 10).
      if (ws?.kind === "patch" && ws.rule === 11) {
        const home = await taskWorktreePath(sa.cwd, "").catch(() => null);
        const k = home ? workspaceKind({ may: "edit", setting: "auto", engine: "loop", moves: movesOf(home, sa.card.tag) }) : null;
        if (k?.kind === "worktree") Object.assign(ws, { kind: k.kind, rule: k.rule });
      }
      const copy = ws?.kind === "patch" ? null : await copyFor(sa);
      const o = !copy ? await openPatch(sa.cwd, { id: sa.id, allowed: allowedFolder, signal, batch }) : await openTaskWorktree(sa.cwd, { id: sa.id, allowed: allowedFolder, signal, keep: treeIds, batch, kind: copy.kind, paths: copy.paths });
      if (o.ok) sa.work = { repo: o.wt.repo, base: o.wt.base, head: null, wt: o.wt, dest: o.wt.dest, files: [], applied: [], error: null, ...(!copy ? { kind: /** @type {const} */ ("patch") } : keptCopy(copy)) };
      else {
        missed = o.kind;
        if (o.kind === "none") sa.shares = o.error;
        else sa.noCopy = o.error;
      }
    } catch (/** @type {any} */ e) {
      missed = "failed";
      sa.noCopy = String(e?.message || e);
    }
    if (!sa.work) treeIds.delete(sa.id);
    return missed;
  };
  /**
   * Filament's own check of a patch's work (TG2-D45, TG2-D63): a patch has no checkout, so the check runs in a copy of
   * its capture taken for it, as the folder's check after a lead's apply runs in one (`openCheckTree`), given back free.
   * @param {Subagent} sa @param {string} head @param {(workdir: string) => Promise<import("./check.js").CheckOutcome>} check
   * @returns {Promise<import("./check.js").CheckOutcome>}
   */
  const checkInCopy = async (sa, head, check) => {
    const o = await openCheckTree(sa.cwd, { id: `${sa.id}-check`, commit: head, allowed: allowedFolder, keep: treeIds });
    if (!o.ok) return { ran: false, words: `Filament could not run its check: no copy of its work could be made (${o.error})` };
    try {
      return await check(o.wt.workdir);
    } finally {
      await releaseTaskWorktree(o.wt, "free").catch(() => {});
    }
  };
  /**
   * A launch of a card in a patch counted for rule 10 (workspace-kind.js): how many calls it made before its workspace
   * moved to a worktree, null where it has not — counted so at an exchange's end, and again in its place once it moves,
   * on a later exchange or after a restart (the review of d65a984a9: a move after the first exchange was never counted).
   * In the repository's records of patches, by its id, in the background.
   * @param {Subagent} sa @param {number | null} calls
   */
  const noteLaunch = (sa, calls) => {
    const ws = sa.workspace;
    if (!ws || ws.noted) return;
    if (calls != null) ws.noted = true;
    void taskWorktreePath(sa.cwd, "")
      .then((home) => home && noteMove(home, sa.card.tag, calls, sa.id))
      .catch(() => {});
  };
  /**
   * A builder's patch workspace moves to a worktree at the same place (the owner's plan of 11-09): `why`, what needs a
   * checkout — "command", "language server", "hook" — said back to the call it runs for. One move at a time; once it
   * moved, there is nothing to move. Its work is captured first, so a move that fails loses nothing: the overlay stays
   * where it was. The words the call's result carries, or why it could not move.
   * @param {Subagent} sa @param {string} why
   * @returns {Promise<{ ok: true, said: string | null } | { ok: false, error: string }>}
   */
  const movePatch = (sa, why) => {
    const ws = sa.workspace;
    if (!ws) return Promise.resolve({ ok: true, said: null });
    if (ws.moving) return ws.moving.then(() => (patchOf(sa.work?.wt) ? movePatch(sa, why) : { ok: /** @type {const} */ (true), said: null }));
    const w = sa.work;
    const patch = patchOf(w?.wt);
    if (!w || !patch) return Promise.resolve({ ok: true, said: null });
    // The calls it made before it needed a checkout, across its exchanges.
    const calls = sa.exchanges.reduce((n, x) => n + (x.outcome?.toolCalls || 0), 0) + (sa.run?.toolCalls ?? 0);
    /** @type {Promise<{ ok: true, said: string | null } | { ok: false, error: string }>} */
    const moved = (async () => {
      // Of the kind Auto chooses (`copyFor`): a sparse one's cone holds what the patch read beside what its launch named.
      const copy = await copyFor(sa);
      const r = await promotePatch(patch, sa.cwd, { id: sa.id, previous: w.head, base: w.base, allowed: allowedFolder, keep: treeIds, signal: sa.run?.abort.signal || null, kind: copy.kind, paths: copy.paths });
      if (!r.ok) {
        log("warn", `sub-agent ${sa.id}: its patch workspace could not move to a worktree for a ${why} (${r.error})`);
        return { ok: false, error: r.error };
      }
      w.wt = r.wt;
      w.dest = r.wt.dest;
      w.head = r.head;
      w.files = r.files;
      delete w.kind;
      Object.assign(w, keptCopy(copy));
      ws.kind = "worktree";
      unsettle(sa);
      changed(sa);
      noteLaunch(sa, calls);
      log("info", `sub-agent ${sa.id}: its patch workspace moved to a worktree for a ${why}`);
      const n = r.files.length;
      const sparse = r.wt.kind === "sparse" && r.wt.cone ? ` ${sparseWords(r.wt.cone, cli)}` : "";
      return { ok: true, said: `[Filament: your workspace became a git worktree at the same folder, with ${n ? `your ${n} changed file${n === 1 ? "" : "s"}` : "nothing changed yet"}; the ${why} ran there.${sparse}]` };
    })();
    ws.moving = moved.then(() => {});
    void ws.moving.finally(() => {
      if (sa.workspace === ws) ws.moving = null;
    });
    return moved;
  };
  /**
   * A patch workspace as the host's file tools reach it (adapters/tools/patch-hands.js `PatchHold`): the workspace while
   * it is one, the wait for a move under way, and the move.
   * @param {Subagent} sa @returns {import("../../adapters/tools/patch-hands.js").PatchHold}
   */
  const patchHold = (sa) => ({
    now: () => patchOf(sa.work?.wt),
    settled: async () => {
      await sa.workspace?.moving;
    },
    move: (why) => movePatch(sa, why),
  });
  /**
   * What a sub-agent started in the background that still runs in its copy as the copy goes back free (the bug hunt of
   * 11-08): stopped first, since the next taker resets that folder and works in it — and the session's agent told of
   * each with its next turn, as of the person's Stop of one (commands.js `stopByPerson`), for its end never comes.
   * @param {Subagent} sa @param {string} dest  its copy's folder
   */
  const stopCommandsIn = async (sa, dest) => {
    const agent = `subagent:${sa.id}`;
    for (const [session, list] of runningShells()) {
      for (const s of list) {
        const rel = relative(dest, s.cwd);
        if (s.agent !== agent || rel.startsWith("..") || isAbsolute(rel)) continue;
        const owner = { session, agent };
        try {
          await stopShell(s.id, owner);
        } catch (/** @type {any} */ e) {
          log("info", `sub-agent ${sa.id}: its background command ${s.id} could not be stopped as its copy went back (${e?.message || e})`);
          continue;
        }
        const command = clip(s.command, 200);
        tellLater(owner, { id: s.id, command, code: null, text: `[Filament: background command ${s.id} (\`${command}\`), started by sub-agent ${sa.id}, was stopped after ${durationWords(now() - s.startedAt)}: its run was over, and its copy of the project went back for the next one to use.]` }, { wake: false });
      }
    }
  };
  /** The bring backs a cut set to try again (`bringBack`), by sub-agent: each one's timer. @type {Map<string, ReturnType<typeof setTimeout>>} */
  const backsAgain = new Map();
  /** Each sub-agent's newest bring back, counted (`bringBack`). @type {Map<string, number>} */
  const backSeq = new Map();
  /** Each sub-agent's bring back under way, the next waiting on it (`bringBack`). @type {Map<string, Promise<void>>} */
  const backing = new Map();
  /**
   * What a sub-agent on another machine changed in its copy there, brought here as its work (cp-back): captured there on
   * the copy sent and taken into its repository (remote-agents.js `takeBack`) without what this repository holds of it
   * (its newest capture), under a clock of its own, not its exchange's stop, so a stopped one's change comes back too.
   * One at a time a sub-agent: two would each let the other's capture go there. Its work then waits from where it
   * stands (an apply meanwhile moves `base` on, and its files are read from there), kept on its refs; refused there, it
   * waits as it did, the trouble said (`error`, `gone` where its copy there went with it). Cut short (that machine away,
   * its store busy a moment), it is tried again after each of `BACK_AGAIN_MS` while it does not run, whose end brings it
   * anyway. A thread let go meanwhile keeps nothing of it.
   * @param {Subagent} sa @param {number} [again]  the tries after a cut so far
   */
  const bringBack = (sa, again = 0) => {
    const next = (backing.get(sa.id) || Promise.resolve()).then(() => bringOnce(sa, again));
    backing.set(sa.id, next);
    void next.finally(() => backing.get(sa.id) === next && backing.delete(sa.id));
    return next;
  };
  /** @param {Subagent} sa @param {number} again */
  const bringOnce = async (sa, again) => {
    const w = sa.work;
    const r = sa.remote;
    if (!w?.there || !r?.copy || !r.chat || subs.get(sa.id) !== sa) return;
    clearTimeout(backsAgain.get(sa.id));
    backsAgain.delete(sa.id);
    const seq = (backSeq.get(sa.id) || 0) + 1;
    backSeq.set(sa.id, seq);
    const newest = () => backSeq.get(sa.id) === seq && sa.work === w && subs.get(sa.id) === sa;
    try {
      // A stop its turn there is owed goes first (`sendOwed`): until it reaches that machine the turn may still run in
      // the copy, and what is read from it then is half its work, said as all of it (the review of 11-11).
      const owed = await sendOwed(sa);
      if (owed) throw Object.assign(new Error(`nothing is brought here from its copy on ${r.machine.name} yet: its turn there may still run, as the stop it is owed did not reach ${r.machine.name} (${owed}) — its copy is read once that stop has`), { kind: "cut" });
      if (!newest()) return;
      const got = await remote.takeBack(r.machine.id, { copy: r.copy.id, chat: r.chat, repo: w.repo, base: r.copy.commit, haves: w.head ? [w.head] : [], signal: AbortSignal.timeout(BRING_BACK_MS) });
      /** @type {import("../../adapters/git/worktree.js").ChangedFile[]} */
      let files = [];
      let from = "";
      while (from !== w.base) {
        if (!newest()) return;
        from = w.base;
        files = await changedFiles(w.repo, from, got.commit);
      }
      if (!newest()) return;
      w.head = got.commit;
      w.files = files;
      w.error = null;
      delete w.gone;
      // What stayed in its copy is its work's too, said with it: "changed nothing" is false where a file it made there
      // was left there (the review of 11-11).
      if (got.left.length) w.left = got.left.map((l) => ({ path: String(l.path), why: String(l.why) }));
      else delete w.left;
      await holdCopyCommit(w.repo, sa.id, r.copy.commit, w.base).catch(() => false);
      if (files.length) await keepTaskWork(w.repo, sa.id, { base: w.base, head: got.commit });
      else await dropTaskRefs(w.repo, sa.id).catch(() => false);
      unsettle(sa);
    } catch (/** @type {any} */ e) {
      if (!newest()) return;
      w.error = String(e?.message || e);
      if (e?.kind === "gone") w.gone = true;
      else delete w.gone;
      log("warn", `sub-agent ${sa.id}: what it changed on ${r.machine.name} did not come back (${w.error})`);
      if (e?.kind !== "cut" || again >= BACK_AGAIN_MS.length) return;
      const timer = setTimeout(() => {
        backsAgain.delete(sa.id);
        if (subs.get(sa.id) !== sa || sa.status === "running" || sa.work !== w) return;
        void bringBack(sa, again + 1).then(() => changed(sa));
      }, BACK_AGAIN_MS[again]);
      timer.unref?.();
      backsAgain.set(sa.id, timer);
    } finally {
      // Its chat was deleted meanwhile: what it brought back goes now, as the delete let go of the rest — work that
      // waits stays on its refs.
      if (deletedChats.has(sa.chainId)) void letGoChatWork(sa.chainId, [sa]);
    }
  };
  /**
   * An exchange ended: its work is captured and its copy parked (HarnessV4_Worktrees_Plan W3) — kept as it stands for
   * its next question, which resets it in place, unless a later agent or check took it or the cap let it go meanwhile;
   * the work lives in the commit either way. Work that could not be captured keeps its copy in use, so nothing is lost.
   * `check`: Filament's run of the worker's check (HarnessV3-TaskGraph-v2 TG2-D45), given the copy's folder — after the
   * capture, so nothing it writes enters the change, and before the copy is given back, whatever it found.
   * @param {Subagent} sa @param {((workdir: string) => Promise<import("./check.js").CheckOutcome>) | null} [check]
   * @returns {Promise<import("./check.js").CheckOutcome | null>}  what the check found: null where it did not run
   */
  const closeWork = async (sa, check = null) => {
    // A move to a worktree under way ends first: its work is in one place or the other, never half.
    await sa.workspace?.moving;
    const w = sa.work;
    if (w?.there) {
      await bringBack(sa);
      return null;
    }
    if (!w?.wt) return null;
    const patch = patchOf(w.wt);
    // One that runs in a copy keeps nothing (AG-7): its copy is given back free, whatever it changed there the next
    // taker's to clean away, its base's ref goes, and no work waits.
    if (sa.may === "copy") {
      await stopCommandsIn(sa, w.wt.dest);
      if (patch) await dropPatch(patch).catch((/** @type {any} */ e) => log("info", `sub-agent ${sa.id}: its workspace could not be let go (${e?.message || e})`));
      else await releaseTaskWorktree(/** @type {import("../../adapters/git/worktree.js").TaskWorktree} */ (w.wt), "free").catch((/** @type {any} */ e) => log("info", `sub-agent ${sa.id}: its copy could not be given back (${e?.message || e})`));
      await dropTaskRefs(w.repo, sa.id).catch(() => false);
      sa.work = null;
      unsettle(sa);
      treeIds.delete(sa.id);
      return null;
    }
    const wt = /** @type {import("../../adapters/git/worktree.js").TaskWorktree} */ (w.wt);
    const capture = () => (patch ? capturePatch(patch, { id: sa.id, previous: w.head, base: w.base }) : captureTaskWork(wt, { id: sa.id, previous: w.head, base: w.base })).catch((/** @type {any} */ e) => ({ ok: /** @type {const} */ (false), error: String(e?.message || e) }));
    let cap = await capture();
    // Tried once more after a moment (the owner's of 11-09): a ref another git held for that moment, a file a program
    // was writing, keeps its copy in use no longer than that — kept on its refs, the copy is given back and its thread
    // can be deleted, where until then both waited for a restart.
    if (!cap.ok) {
      log("warn", `sub-agent ${sa.id}: its work could not be captured (${cap.error}); trying once more`);
      await new Promise((r) => setTimeout(r, CAPTURE_AGAIN_MS));
      cap = await capture();
    }
    if (!cap.ok) {
      // Kept as it is, in use: nothing takes, resets or trims it, and what it holds is said (`failedCaptures`, its
      // record's `unsaved`) — its next exchange's end, or the next start, keeps it on its refs.
      w.error = cap.error;
      if (patch) markPatchUnsaved(patch, cap.error);
      else markUnsaved(wt, cap.error);
      unsaved.set(sa.id, { id: sa.id, chainId: sa.chainId, repo: w.repo, dest: wt.dest, error: cap.error, at: unsaved.get(sa.id)?.at || now() });
      log("warn", `sub-agent ${sa.id}: its work could not be captured on a second try either (${cap.error}); its worktree stays at ${wt.dest}, in use, until its work is kept`);
      // Its chat is deleted: no next exchange comes, so its capture is tried again later.
      if (deletedChats.has(sa.chainId)) saveLater(sa);
      return null;
    }
    unsaved.delete(sa.id);
    savesLater.delete(sa.id);
    w.head = cap.head;
    w.files = cap.files;
    w.error = null;
    unsettle(sa);
    // Its refs hold its commits only while its work waits to be applied.
    if (!cap.files.length) await dropTaskRefs(w.repo, sa.id).catch(() => false);
    // A patch has no checkout to run a check in, and a sparse copy holds its cone alone (the owner's plan of 11-09 for big
    // repos): Filament's own check runs in a whole copy of its capture, as a folder's does.
    const found = check ? await (patch || wt.kind === "sparse" ? checkInCopy(sa, cap.head, check) : check(wt.workdir)) : null;
    if (patch) {
      // Its folder holds its version of every file that waits, as a worktree's does: "Open its version" opens it there.
      if (cap.files.length) await holdWork(patch, cap.files).catch((/** @type {any} */ e) => log("info", `sub-agent ${sa.id}: its changed files could not all be copied into its workspace (${e?.message || e})`));
      parkPatch(patch);
      // Its card's launch counts for rule 10: it has not needed a worktree so far.
      noteLaunch(sa, null);
    } else await releaseTaskWorktree(wt, "parked").catch((/** @type {any} */ e) => log("info", `sub-agent ${sa.id}: its copy could not be given back (${e?.message || e})`));
    w.wt = null;
    treeIds.delete(sa.id);
    // Its chat was deleted while it worked: what it kept goes now, as the delete let go of the rest (`letGoChatWork`).
    if (deletedChats.has(sa.chainId)) void letGoChatWork(sa.chainId, [sa]);
    return found;
  };
  /**
   * A parked patch's folder holds its work as it waits now, as its exchange's end leaves it (`closeWork`): laid over its
   * newest work — a send back moved it on its refs (the review of d65a984a9: "Open its version" showed its change from
   * before the rebase, unmarked, until its next exchange, which started without its waiting files) —, its waiting files
   * copied up, parked again. Its next exchange goes on in it as it stands. One that could not is laid so at that
   * exchange's start.
   * @param {Subagent} sa
   */
  const layPatch = async (sa) => {
    const w = sa.work;
    if (!w || w.wt || w.kind !== "patch") return;
    const o = await revivePatch(sa.cwd, { id: sa.id, base: w.base, head: w.head || w.base, allowed: allowedFolder }).catch((/** @type {any} */ e) => ({ ok: /** @type {const} */ (false), error: String(e?.message || e) }));
    if (!o.ok) return log("info", `sub-agent ${sa.id}: its workspace could not be laid over its work as it waits now (${o.error})`);
    if (w.files.length) await holdWork(o.wt, w.files).catch((/** @type {any} */ e) => log("info", `sub-agent ${sa.id}: its changed files could not all be copied into its workspace (${e?.message || e})`));
    parkPatch(o.wt);
    w.dest = o.wt.dest;
  };
  /**
   * One that runs in a copy where none can be made (AG-85): it never falls to the session's folder, since only the
   * developer can let it do more than its card says.
   * @param {Subagent} sa @param {boolean} developer  who reads the refusal
   */
  const noCopy = (sa, developer) =>
    `${sa.card.name} runs in its own copy of the project, and this folder has none to give: ${sa.shares || sa.noCopy}. ${developer ? "Launch it read only, or let it work in the session's folder" : `A Reviewer can still read here; only the developer can let ${sa.card.name} work in the session's folder`}`;
  /**
   * One that edits whose copy failed in a repository (HarnessV4_Worktrees_Plan W1, WT-D3): it never falls to the
   * session's folder — the developer gives it that, by switching its own copy off.
   * @param {Subagent} sa @param {boolean} developer  who reads the refusal
   */
  const copyFailedWords = (sa, developer) =>
    `${sa.card.name} edits in its own copy of the project, and its copy could not be made: ${sa.noCopy}. ${developer ? "Launch it read only, or let it work in the session's folder: set “Where they edit” to Session folder for this chat" : "Ask it read only, or tell the developer: only they can let it work in the session's folder"}`;
  /**
   * A follow-up works where the sub-agent's work is: its parked copy, reset to its newest work where it stands, or a
   * copy taken for it (HarnessV4_Worktrees_Plan W3); its refs stand while it works, so what a restart cuts of this
   * exchange is kept. One that runs in a copy gets a fresh one — the last went with its report — and the answer says so.
   * Its exchange's stop stops the copy's making, as a launch's does (the copies hunt of 10-23: a Stop waited out the
   * checkout of a big repository). A capture of its copy kept on its refs while it was taken (`reviveTaskWorktree`'s
   * `head`) is its newest work from then on. Where nothing of its work waits — applied, marked so, discarded, or no
   * change — and git has pruned its last commit, nothing holding it any more (its refs gone with what waited, a mark's
   * hold past `MARK_KEPT_MS`, its copy let go), it works in a fresh copy of the folder as it stands, and is told so,
   * where checking out what is gone failed its follow-up (the owner's of 11-09, its review).
   * @param {Subagent} sa @param {boolean} [developer]  who reads a refusal
   * @returns {Promise<string | null>}  what it is told of a fresh copy opened for it (`COPY_AGAIN_NOTE`, `LET_GO_NOTE`); null: none was
   */
  const reopenWork = async (sa, developer = false) => {
    const signal = sa.run?.abort.signal || null;
    // One on another machine works there, in its copy or the folder named: never in a copy here. Its commits are held
    // again while it works, what waits on its refs.
    if (sa.remote) {
      const w = sa.work;
      if (w?.there && sa.remote.copy) {
        await holdCopyCommit(w.repo, sa.id, sa.remote.copy.commit, w.base).catch(() => false);
        if (w.files.length && w.head) await keepTaskWork(w.repo, sa.id, { base: w.base, head: w.head }).catch(() => false);
      }
      return null;
    }
    if (sa.may === "copy" && !sa.work) {
      await openWork(sa, signal);
      if (!sa.work) throw new Error(noCopy(sa, developer));
      return COPY_AGAIN_NOTE;
    }
    // One that edits whose copy failed never ran (W1): a follow-up does not run it in the session's folder either.
    if (!sa.work && sa.noCopy) throw new Error(`${copyFailedWords(sa, developer)}. ${NEVER_RAN}`);
    if (!sa.work || sa.work.wt) return null;
    await reconcileWork(sa);
    const w = sa.work;
    if (!w || w.wt) return null;
    treeIds.add(sa.id);
    const at = w.head || w.base;
    // A patch revives as a patch — its record, where a restart lost the thread's word of it —, a worktree as a worktree.
    const home = w.kind === "patch" ? null : await taskWorktreePath(sa.cwd, "").catch(() => null);
    if (home && patchRecorded(home, sa.id)) w.kind = "patch";
    // Its copy as its last was made (`copy`): a parked sparse one is reset where it stands, its cone kept, never checked
    // out whole in its place.
    const kind = w.copy?.kind ?? "worktree";
    const paths = w.copy?.paths ?? [];
    if (!w.files.length && !(await snapshotExists(w.repo, at).catch(() => true))) {
      const o = w.kind === "patch" ? await openPatch(sa.cwd, { id: sa.id, allowed: allowedFolder, signal }) : await openTaskWorktree(sa.cwd, { id: sa.id, allowed: allowedFolder, signal, keep: treeIds, kind, paths });
      if (!o.ok) {
        treeIds.delete(sa.id);
        throw new Error(`its worktree could not be made again (${o.error})`);
      }
      Object.assign(w, { repo: o.wt.repo, base: o.wt.base, head: null, wt: o.wt, dest: o.wt.dest, files: [], error: null });
      unsettle(sa);
      changed(sa);
      log("info", `sub-agent ${sa.id}: its last commit (${at.slice(0, 8)}), nothing of it waiting, is gone from the repository; it goes on in a fresh copy of the folder as it stands`);
      return LET_GO_NOTE;
    }
    const revived = w.kind === "patch" ? await revivePatch(sa.cwd, { id: sa.id, base: w.base, head: at, allowed: allowedFolder }) : await reviveTaskWorktree(sa.cwd, { id: sa.id, base: w.base, head: at, allowed: allowedFolder, keep: treeIds, signal, kind, paths });
    // A patch's revive puts it at its head; a worktree's answers where a capture moved it on meanwhile.
    const back = revived.ok ? { ...revived, head: "head" in revived ? revived.head : at } : revived;
    // Kept from before a restart: a move of it counts for rule 10 still, in its launch's place.
    if (w.kind === "patch" && !sa.workspace) sa.workspace = { kind: "patch", rule: 11, moving: null, noted: false };
    if (!back.ok) {
      treeIds.delete(sa.id);
      throw new Error(`its worktree could not be checked out again (${back.error})`);
    }
    w.wt = back.wt;
    w.dest = back.wt.dest;
    if (back.head !== at) {
      w.head = back.head;
      w.files = await changedFiles(w.repo, w.base, w.head).catch(() => w.files);
      unsettle(sa);
      changed(sa);
      log("info", `sub-agent ${sa.id}: what its copy held was kept on its refs as it was taken (${back.head.slice(0, 8)}); it goes on from there`);
    }
    if (!(await keepTaskWork(w.repo, sa.id, { base: w.base, head: w.head || w.base }).catch(() => false))) log("info", `sub-agent ${sa.id}: git would not keep its refs while it works`);
    return null;
  };
  /**
   * What the launcher reads where the change it named held nothing: why. `hint`: the launch is answered inside the turn
   * that made it, where the last finished turn's change most often stood for that turn's own — the result names it.
   * @param {Subagent} sa @param {boolean} [hint]
   */
  const handedNone = (sa, hint = false) => {
    const h = sa.exchanges.at(-1)?.handed;
    return h?.note ? `\n\n[Filament: no change was handed to it as a patch — ${h.note}.${hint && h.source === "turn" ? ' What this turn has changed so far is changes: "running".' : ""}]` : "";
  };
  /**
   * What the main agent reads about the work, after the report. `reads`: a lead that reads along is told it can read
   * the change before it applies it (TG2-D17).
   * @param {Subagent} sa @param {{ reads?: boolean }} [o]
   */
  const workText = (sa, { reads = false } = {}) => {
    // One on another machine changed that machine's folder alone (the remote-agents plan's s-launch): a folder that
    // machine may have named, said in its words (`wordsThere`); in a copy made for it, what it changed comes back here
    // as its work (cp-back), applied as a local one's is but for a rebase, which does not reach that copy.
    if (sa.remote && !sa.remote.cwd) return `\n\nIts copy on ${sa.remote.machine.name} was not made: nothing of it is there.`;
    const tw = sa.work;
    if (sa.remote?.copy && tw?.there) {
      const at = `It worked on ${sa.remote.machine.name}, in its own copy of ${wordsThere(sa.remote.copy.project, 120)} there`;
      if (tw.error && tw.gone) return `\n\n${at}, and what it changed did not come back here (${wordsThere(tw.error, 300)}): its copy there is gone, and what it changed with it.`;
      // How long that machine keeps it, as it said when the copy was made: in the copy, then as what it keeps of the
      // copy once a newer launch takes it. One that said none keeps it only while the copy is this sub-agent's.
      const keeps = sa.remote.copy.keeps ? `it stays on ${sa.remote.machine.name}, kept there ${keptWords(sa.remote.copy.keeps)} from its last turn or the last try to bring it` : "it stays in that copy";
      if (tw.error) return `\n\n${at}, and what it changed did not come back here (${wordsThere(tw.error, 300)}): ${keeps}, ${backsAgain.has(sa.id) ? "and is tried again in a while, and as its next exchange ends" : "and its next exchange's end tries again"}.`;
      // What the bring back left there, by why, count and name: never "changed nothing" over a file it made there.
      const stays = tw.left?.length ? `What it made or changed there that stays in that copy, not brought here: ${leftLine(tw.left)}.` : "";
      if (!tw.files.length) return tw.applied.length ? (stays ? `\n\n${stays}` : "") : stays ? `\n\n${at}, and nothing it changed came back here. ${stays}` : `\n\n${at}, and changed nothing.`;
      const tool = followTool(sa);
      return `\n\n${at}, and what it changed came back here, not into your folder yet: ${filesLine(tw.files)}. To apply it, call ${tool} with agent_id "${sa.id}" and apply_changes: true — a file you changed meanwhile is merged with yours; where changes overlap, overlap says what happens ("markers" or "mine"), and left out nothing is applied.${reads ? ` To read it first, call ${tool} with agent_id "${sa.id}" and show_changes: true.` : ""} The developer can apply it too.${stays ? ` ${stays}` : ""}`;
    }
    if (sa.remote?.copy) return `\n\nIt worked on ${sa.remote.machine.name}, in its own copy of ${wordsThere(sa.remote.copy.project, 120)} there (${wordsThere(sa.remote.cwd, 200)}): what it changed stays in that copy, not in your folder.`;
    if (sa.remote) return `\n\nIt worked on ${sa.remote.machine.name}, in ${wordsThere(sa.remote.cwd, 200)}: what it changed is there, not in your folder — have it commit its own change alone, on a branch of its own, and push that branch, then fetch it here.`;
    const w = sa.work;
    if (!w) return sa.may === "copy" && !sa.shares ? "\n\nIt ran in its own copy of the project, given back now: nothing it changed there is in your folder, or kept." : "";
    if (w.error) return `\n\nIt worked in its own git worktree, and its work could not be captured (${w.error}); the folder is kept at ${w.wt?.workdir || "(gone)"}.`;
    if (!w.files.length) return w.applied.length ? "" : "\n\nIt worked in its own git worktree and changed nothing.";
    const tool = followTool(sa);
    // What overlaps edits in the folder: the agent's way on, by overlap (11-09) — a lead's, checked, sends it back alone.
    const overlap = tool === "worker" ? `nothing is applied unless overlap: "send_back" sends it back to redo it,` : `overlap says what happens ("markers", "mine" or "send_back"), and left out nothing is applied`;
    return `\n\nIt worked in its own git worktree, so its changes are not in your folder yet: ${filesLine(w.files)}. To apply them, call ${tool} with agent_id "${sa.id}" and apply_changes: true — a file you changed meanwhile is merged with yours; where changes overlap, ${overlap} and you hear which files.${reads ? ` To read them first, call ${tool} with agent_id "${sa.id}" and show_changes: true.` : ""} The developer can apply them too.`;
  };
  /**
   * Where a sub-agent's pending work is: its worktree state while the registry knows it, else the repository's refs
   * (after a restart). Null with the reason when there is none to reach.
   * @param {string} id @param {string} chainId
   * @returns {Promise<{ ok: true, sa: Subagent | null, repo: string, base: string, head: string } | { ok: false, error: string }>}
   */
  const workOf = async (id, chainId) => {
    recall(chainId);
    const sa = subs.get(id) || null;
    if (sa && sa.chainId !== chainId) return { ok: false, error: `no sub-agent ${id} in this session` };
    if (!sa && !SUBAGENT_ID.test(id)) return { ok: false, error: `"${id}" is not a sub-agent's id (sa_ and eight hex digits)` };
    if (sa && !sa.work && sa.noCopy) return { ok: false, error: `sub-agent ${id} never ran: its copy of the project could not be made (${sa.noCopy})` };
    if (sa && !sa.work && sa.remote) return { ok: false, error: sa.may === "read" ? `sub-agent ${id} was read-only: it changed nothing` : `sub-agent ${id} worked on ${sa.remote.machine.name}${sa.remote.copy ? ", in its own copy there" : ""}: what it changed is there, and nothing of it came here` };
    if (sa && !sa.work) return { ok: false, error: sa.may === "read" ? `sub-agent ${id} was read-only: it changed nothing` : sa.may === "copy" ? (sa.shares ? `sub-agent ${id} never ran: no copy of the project could be made for it (${sa.shares})` : `sub-agent ${id} ran in its own copy of the project, and nothing it changed there was kept`) : `sub-agent ${id} worked in the session's folder${sa.shares ? ` (no worktree: ${sa.shares})` : ""}, so its changes are there already` };
    if (sa?.work) {
      await reconcileWork(sa);
      if (sa.work) return { ok: true, sa, repo: sa.work.repo, base: sa.work.base, head: sa.work.head || sa.work.base };
    }
    const folder = ctx?.session(chainId)?.cwd || "";
    // What a restart cut in its copy goes onto its refs first (HarnessV4_Worktrees_Plan W3) — by this reconcile, or by
    // the one that holds its copy now, which is waited for (`reconcileWork`).
    if (folder) {
      await pruneTaskWorktrees(folder, treeIds).catch(() => 0);
      await untilCopyFree(folder, id).catch(() => {});
    }
    const refs = folder ? await taskRefs(folder, id) : null;
    return refs ? { ok: true, sa: null, ...refs } : { ok: false, error: `no work of sub-agent ${id} waits in this session's repository` };
  };
  /** Accepts in flight, one per sub-agent: a second ask waits for the first's answer. @type {Map<string, Promise<any>>} */
  const applying = new Map();
  /**
   * A mark as applied, or its undo, in flight, one per sub-agent; and a rebase in flight. An apply, a mark or a rebase
   * asked while another of them runs on the same sub-agent is refused — each moves the same work — and so is a follow-up
   * while a mark or its undo runs.
   * @type {Map<string, Promise<any>>}
   */
  const marking = new Map();
  /**
   * The marks in `marking` that are Filament's own, work found in the folder whole (`settleFound`): an apply or a mark
   * asked meanwhile waits for it and is then read as it stands, never refused for it.
   * @type {Set<string>}
   */
  const settling = new Set();
  /** @type {Set<string>} */
  const rebasing = new Set();
  /**
   * Applies into one repository run one after another — the agent's side-by-side calls may accept two sub-agents'
   * work at once, and two plans read against the same file would overwrite each other instead of merging.
   * @type {Map<string, Promise<void>>}
   */
  const repoTurns = new Map();
  /**
   * A repository's turn by its real path — as Windows compares one, any case — so one reached through a junction, or
   * named by a caller outside the registry (Run on's bring back), shares the turn. @param {string} repo
   */
  const repoTurnKey = (repo) => {
    let real = repo;
    try {
      real = realpathSync.native(repo);
    } catch {}
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  /** @template T @param {string} repo @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inRepo = (repo, fn) => {
    const key = repoTurnKey(repo);
    const next = (repoTurns.get(key) || Promise.resolve()).then(fn);
    const tail = next.then(() => {}, () => {});
    repoTurns.set(key, tail);
    tail.then(() => {
      if (repoTurns.get(key) === tail) repoTurns.delete(key);
    });
    return next;
  };
  /**
   * Filament's own reads of waiting work against each repository (`settleRead`), by their stops, each with its
   * sub-agent's slot: whoever comes to write there in its turn goes ahead of them (`inRepoAhead`).
   * @type {Map<string, Map<AbortController, string>>}
   */
  const settleStops = new Map();
  /**
   * Filament's own reads of waiting work against the repository stopped (`inRepoAhead`) — but the one of the slot `but`
   * names. @param {string} repo @param {string | null} [but]
   */
  const stopSettles = (repo, but = null) => {
    for (const [stop, slot] of settleStops.get(repoTurnKey(repo)) || []) if (slot !== but) stop.abort();
  };
  /**
   * A write that waits for a sub-agent's work to be found and marked (`settling`): the reads beside that mark in its
   * repository stop, so its turn there comes at once, not after theirs (the review of 11-03).
   * @param {string} slot
   */
  const aheadOfMark = (slot) => {
    // A mark that has the repository's turn already has nothing ahead of it: the reads behind it wait, unstopped.
    if (markInTurn.has(slot)) return;
    for (const [repo, stops] of settleStops) if ([...stops.values()].includes(slot)) stopSettles(repo, slot);
  };
  /** The slots whose mark of work found whole has the repository's turn now (`settleRead`). @type {Set<string>} */
  const markInTurn = new Set();
  /** Filament's own read for one sub-agent stopped: a follow-up goes ahead of its mark (`followUp`). @param {string} slot */
  const stopOwnRead = (slot) => {
    for (const stops of settleStops.values()) for (const [stop, of] of stops) if (of === slot) stop.abort();
  };
  /**
   * `fn` in the repository's turn (`inRepo`), ahead of Filament's own reads of waiting work there (the reviews of 11-02):
   * an Apply behind such a read waits it out, seconds on a big folder, and one beside it fails where git holds the
   * developer's files — on Windows a file git reads cannot be deleted or replaced meanwhile. So the read in the turn is
   * stopped, its git ended, and the turn is `fn`'s once that git is gone; one waiting for the turn gives it up. Each
   * reads once more after (`settleFound`). For every write there alone — an apply, its undo, a mark, its undo, a rebase,
   * a lead's apply and its undo: a read beside a read holds nothing the other needs, and a dry run asked every 15 s
   * while the Agents band shows would stop every read longer than that (the review of 11-03).
   * @template T @param {string} repo @param {() => Promise<T>} fn @returns {Promise<T>}
   */
  const inRepoAhead = (repo, fn) => {
    stopSettles(repo);
    return inRepo(repo, fn);
  };
  /** The session's turn that runs now (a closed one is on its way out). @param {string} chainId */
  const liveTurnOf = (chainId) => {
    const t = chains.get(chainId)?.turn || null;
    return t && !t.closed ? t : null;
  };
  /**
   * The lead's turn, as a team's call names it (HarnessV3-AtHome AH-O10): the team's tools hand plain JSON — the turn's
   * run and the call — and the registry finds the turn itself. The worker's events land on the lead's timeline at the
   * round the call was made in, as the loop stamps an agent call's: the call's own where it names one, else the
   * turn's now. Null when that turn is not the session's running one.
   * @param {string} chainId @param {LeadCall} lead @returns {LaunchParent | null}
   */
  const leadParent = (chainId, lead) => {
    const live = liveTurnOf(chainId);
    if (!live || live.runId !== lead.runId) return null;
    const at = lead.round ?? live.round?.() ?? 0;
    return { live, toolUseId: lead.callId, emit: (e) => live.emit?.({ ...e, round: at }), signal: null, stopSignal: null, round: at };
  };
  /**
   * The lead's turn a launch is counted by (the plan's p6), or null: the lead's turn the launch runs under — a worker, attempts, a saved agent it asks — or, for a task of the session's graph, the lead's turn that
   * runs as it launches. The developer's own launches and one that starts by itself count against none.
   * @param {string} chainId @param {LaunchSpec} spec @param {LaunchParent | null} parent @returns {LiveTurn | null}
   */
  const countedBy = (chainId, spec, parent) => {
    if (spec.origin !== "agent") return null;
    const live = parent ? parent.live : spec.task ? liveTurnOf(chainId) : null;
    return live?.lead ? live : null;
  };
  /**
   * The tool the session's loop follows up on a sub-agent with, as its report and its work's words name it: a team's
   * lead has worker, a coding agent agent. The turn running now says which; with none, the sub-agent's own kind does —
   * a worker's report waits for a lead.
   * @param {Subagent} sa
   */
  const followTool = (sa) => {
    const t = liveTurnOf(sa.chainId);
    return (t ? t.lead : !!sa.team) ? "worker" : "agent";
  };
  /**
   * What a fork starts from: the request of the turn launching it, as it stands (the agent's own launch), else the
   * session's running turn's, else its last turn's newest request while Filament keeps it — the provider's cache
   * lifetime. Refused in words when there is none. `tokens`: what the fork carries, weighed as a graph task's fork is
   * (`forkWeight`) — the newest request's prompt and reply as its provider counted them, else the request estimated;
   * of a running turn, the larger of that and its conversation as it stands, as its loop weighs it for its own line.
   * @param {string} chainId @param {LaunchParent | null} parent
   * @returns {{ ok: true, body: any, from: "turn" | "kept", tokens: number } | { ok: false, error: string }}
   */
  const forkSource = (chainId, parent) => {
    const live = parent && !parent.live.closed ? parent.live : liveTurnOf(chainId);
    const weigh = (/** @type {CacheSnapshot | null} */ snap, /** @type {any} */ body) => (snap?.tokens ? snap.tokens + (Number(snap.reply) || 0) : estimateBodyTokens(body, "request"));
    const asItStands = live?.fork?.() || null;
    if (asItStands) return { ok: true, body: asItStands.body, from: "turn", tokens: forkWeight(weigh(live?.cache?.() || null, asItStands.body), asItStands.tokens) };
    const kept = chains.get(chainId)?.warm || null;
    if (kept && now() < kept.sentAt + kept.ttlMs) return { ok: true, body: kept.body, from: "kept", tokens: weigh(kept, kept.body) };
    return {
      ok: false,
      error: live
        ? "the main agent's turn has sent no request yet, so there is nothing to fork — launch it once the turn's first round is out"
        : "a fork copies the main agent's newest request, which Filament holds only while a turn runs and for the provider's cache lifetime after it (5 minutes, or an hour where the chat's cache lifetime or its route's rule says 1 hour) — send a turn first, or choose folded: every turn folded to its words, with one line per tool call",
    };
  };
  /**
   * What a launch that starts as a live copy while the cache is warm forks (Catch me up, the owner's of 11-05): the
   * fork's source where its request was read from the provider's cache or wrote to it, that cache's lifetime not past,
   * the fork would carry at most half its line (`forkPays`), and the main agent's model has a free seat in the pool —
   * else null, and it starts as its view says.
   * @param {string} chainId @param {LaunchParent | null} parent @param {any} doc  the session's settings
   * @returns {{ ok: true, body: any, from: "turn" | "kept", tokens: number } | null}
   */
  const warmFork = (chainId, parent, doc) => {
    const live = parent && !parent.live.closed ? parent.live : liveTurnOf(chainId);
    const snap = live ? live.cache?.() || null : chains.get(chainId)?.warm || null;
    if (snap?.cached !== true || now() >= snap.sentAt + snap.ttlMs) return null;
    const src = forkSource(chainId, parent);
    if (!src.ok) return null;
    const model = String(src.body?.model || "");
    if (!forkPays({ ...snap, tokens: src.tokens, reply: 0 }, forkLineOf(sessionWindowFor(config(), model, doc?.model?.window).tokens), now())) return null;
    const s = seatsOfList(chainId, model, listIn(chainId, "side")).find((x) => x.key === seatKey(model));
    return s && !s.problem && seatFree(s) ? src : null;
  };

  /**
   * The messages of the main agent's request as it stands, for the context window's view (the owner's words of 10-19):
   * the turn launching it, else the session's running turn — Filament's loop's, whose request is Filament's to read. Null
   * where none runs, or where the turn sends no request of Filament's (a coding agent's own chat).
   * @param {string} chainId @param {LaunchParent | null} [parent]
   * @returns {any[] | null}
   */
  const liveMessages = (chainId, parent = null) => {
    const live = parent && !parent.live.closed ? parent.live : liveTurnOf(chainId);
    const body = live?.fork?.()?.body;
    return Array.isArray(body?.messages) ? body.messages : null;
  };

  /** The session's `subagents` section, resolved over the global config (a chain without a session: the global alone). @param {string} chainId */
  const settingsOf = (chainId) => {
    const doc = (chainId && ctx?.settings(chainId)) || resolveSettings({ global: globalLayer(config()) }).effective;
    return { doc, sub: doc?.subagents || {} };
  };

  /**
   * The team that leads a session now, by its key, as its settings say it (`engine.mode`, with `engine.team` its key or
   * its name as written); null where its agent answers — every chat's but a team's own while Settings › Experimental's
   * Teams switch is off (core/teams-on.js `leadingTeams`).
   * @param {string} chainId
   */
  const leadsNow = (chainId) => {
    const e = sessionEngineOf(settingsOf(chainId).doc);
    if (e.mode !== "team") return null;
    return teamsOn(config()) || ctx?.session(chainId)?.kind === "team" ? teamKey(e.team) : null;
  };

  /**
   * Each exchange's prompt as its card shows it — its secrets redacted, then cut to the card — kept with the exchange
   * while its prompt is the one it was made from: the list is polled every few seconds while an agent runs, and the
   * redaction runs its patterns over the whole prompt. @type {WeakMap<Exchange, { prompt: string, card: string }>}
   */
  const cardPrompts = new WeakMap();
  /** @param {Exchange} x */
  const cardPrompt = (x) => {
    const was = cardPrompts.get(x);
    if (was && was.prompt === x.prompt) return was.card;
    const card = cut(redactSecrets(x.prompt), CARD_CHARS);
    cardPrompts.set(x, { prompt: x.prompt, card });
    return card;
  };
  /**
   * A sub-agent for the surfaces. The list's form clips each prompt and report for the cards; the whole form (one
   * sub-agent's viewer) carries them entire, with the context its first message opened with. `head`: the page's list,
   * each clipped to HEAD_CHARS, and an exchange whose words were clipped says so (`promptHead`, `reportHead`: a head, not the whole — never `subagent-end`'s `reportCut`, a cut at CARD_CHARS).
   * @param {Subagent} sa @param {{ whole?: boolean, leads?: string | null, head?: boolean }} [o]  `leads`: the team that
   *   leads its session now (`leadsNow`), read once for a list
   */
  const publicOf = (sa, { whole = false, leads = leadsNow(sa.chainId), head = false } = {}) => {
    const last = sa.exchanges.at(-1) || null;
    const chars = whole ? Infinity : head ? HEAD_CHARS : CARD_CHARS;
    return {
      id: sa.id,
      chainId: sa.chainId,
      origin: sa.origin,
      ...(sa.heard ? { heard: true } : {}),
      ...(sa.second ? { second: true } : {}),
      ...(sa.weighs ? { weighs: sa.weighs } : {}),
      may: sa.may,
      asked: sa.asked,
      engine: sa.engine,
      // `charge`: its team leads its session now — a change of its that waits is its lead's to apply, which Now files
      // under the lead; a team's worker left behind when the chat went back to its agent has none.
      team: sa.team ? { key: sa.team.key, name: sa.team.name, role: sa.team.role, place: sa.team.place ?? null, ...(sa.team.seat ? { seat: sa.team.seat } : {}), ...(leads && (leads === sa.team.key || leads === teamKey(sa.team.name)) ? { charge: /** @type {const} */ (true) } : {}) } : null,
      card: { tag: sa.card.tag, name: sa.card.name },
      // The graph task it does — or did, given back after a restart with its change waiting (10-28).
      task: sa.task ? sa.task.id : sa.taskWas || null,
      review: !!sa.task?.review,
      // A Hunter's graph task (UX9): its box on the Plan page counts the Hunters fired from it.
      ...(sa.hunts ? { hunts: sa.hunts } : {}),
      // One launched on another machine (the remote-agents plan's s-launch): the machine it works on, its folder and its
      // chat there — its card says "on <machine>".
      ...(sa.remote ? { machine: { ...sa.remote.machine }, remote: { cwd: sa.remote.cwd, chat: sa.remote.chat, run: sa.remote.run ?? null, ...(sa.remote.copy ? { copy: { ...sa.remote.copy } } : {}) } } : {}),
      model: sa.model,
      // The provider its model runs on, by the name the Providers page gives it: its header says it (the owner's words
      // of 10-26: "which provider this agent is from").
      provider: sa.remote ? null : ctx?.modelFacts?.(sa.model)?.at?.name ?? null,
      seat: sa.seat,
      // Its card's models, where it runs on one of a list (the owner's 10-19 list): those passed and those failed.
      models: sa.models ? { list: [...sa.models.list], passed: sa.models.passed.map((p) => ({ ...p })), failed: sa.models.failed.map((f) => ({ ...f })) } : null,
      // The effort it runs at, where one applies, and the list its seat counts in (HarnessV4_Tasks E23).
      effort: sa.effort?.level ?? null,
      list: sa.list,
      // A lead's worker waiting for room (team_v2_plan §5.7): since when, and for what now.
      waiting: sa.status === "running" && sa.waiting ? { since: sa.waiting.since, words: waitingWords(sa) } : null,
      description: sa.description,
      view: sa.view,
      running: sa.running,
      changes: sa.changes,
      start: sa.start,
      memory: sa.memory,
      background: sa.background,
      // Whether it holds the session's running turn now — the words "the main agent waits for it" read this.
      pause: sa.status === "running" && sa.pausing != null && liveTurnOf(sa.chainId)?.runId === sa.pausing,
      aside: sa.aside,
      // Its graph task's change was sent back to rebase, and it goes on with it at its planner's turn (10-28).
      ...(rebaseDue(sa) ? { rebaseDue: true } : {}),
      // Its session's record gave it back: its next message starts a fresh agent, and why (BW-10).
      restored: sa.restored,
      // Detached by the developer from the call that waited on it (BUG-12): where its report goes — "report" (to the
      // main agent) or "aside" (kept for the developer) — while it runs; null otherwise.
      detached: sa.run?.detached || null,
      // Its own worktree: what waits to be applied (base→its newest work), how often work was applied, whether the
      // folder is open now. `shares` says why one that edits works in the session's folder after all; one that runs
      // in a copy never does, and has no work to show.
      work: sa.work
        ? {
            // Its copy is on another machine, its change brought back here (cp-back): no folder of its version here.
            ...(sa.work.there ? { there: /** @type {const} */ (true) } : {}),
            // What stayed in that copy and was not brought here, each with why: names, never what a file holds.
            ...(sa.work.left?.length ? { left: sa.work.left.slice(0, 200).map((l) => ({ ...l })) } : {}),
            pending: sa.work.files.length,
            // Which work waits, as one word: a rebase or a follow-up may leave the same counts (the Hunter's of 10-28:
            // the band's dry run was keyed on the counts, and stayed as it was).
            sig: `${sa.work.base.slice(0, 12)}:${(sa.work.head || "").slice(0, 12)}`,
            added: sa.work.files.reduce((n, f) => n + f.added, 0),
            removed: sa.work.files.reduce((n, f) => n + f.removed, 0),
            files: sa.work.files.slice(0, 200).map((f) => ({ path: f.path, status: f.status, added: f.added, removed: f.removed, binary: f.binary })),
            applied: sa.work.applied.length,
            // When its newest apply was, and how many files it brought: the Changes pane's "applied 14:02 · 3 files".
            // Who applied it and how its files came in: "applied 14:08 by you · 3 files, 1 merged with your edits". A
            // mark as applied that can be undone says so (`undo`).
            lastApplied: sa.work.applied.length ? { ...lastAppliedOf(sa.work), ...(markUndoable(sa, now()) ? { undo: true } : {}) } : null,
            open: !!sa.work.wt,
            // Where its copy is — a git worktree with no branch of its own, which the Changes pane and the branch
            // button, showing the chat's folder, do not list (the owner's words of 10-26: "What copy?").
            folder: copyOf(sa),
            ...(sa.work.error ? { error: sa.work.error } : {}),
          }
        : null,
      shares: sa.may === "copy" ? null : sa.shares,
      ...(sa.noCopy ? { noCopy: sa.noCopy } : {}),
      status: sa.status,
      // How its running exchange goes (the lead's watch, the team view's cards); null once it reported.
      progress: sa.status === "running" && sa.run ? structuredClone(sa.run.progress) : null,
      // How many questions it has asked over its life: an answer names one by its number (TG2-D42).
      questions: sa.questions,
      // What Filament's check saw of the change that waits to be applied: a red one's apply needs a reason (TG2-D45).
      checked: checkOfWork(sa),
      // The folder's check that undid its lead's apply of that change: its apply again needs a reason too (TG2-D55).
      folderRed: folderRedOf(sa),
      // The folder's check that undid its lead's last apply of the change that waits, sent back since or not: a reason
      // may carry it (TG2-D55).
      folderUndone: sa.work?.files.length ? sa.folderUndone : null,
      // Which attempt at its brief it is (TG2-D53): the Team view folds the others under the winner's card.
      attempt: sa.attempt ? attemptOf(sa.attempt) : null,
      startedAt: sa.startedAt,
      endedAt: last?.endedAt ?? null,
      runId: last?.runId ?? null,
      exchanges: sa.exchanges.map((x) => ({
        // A head is the card's own words cut again: the same as the whole prompt cut there.
        prompt: whole ? redactSecrets(x.prompt) : head ? cut(cardPrompt(x), HEAD_CHARS) : cardPrompt(x),
        ...(head && cardPrompt(x).length > HEAD_CHARS ? { promptHead: true } : {}),
        ...(head && x.outcome && x.outcome.report.length > HEAD_CHARS ? { reportHead: true } : {}),
        description: x.description,
        by: x.by,
        runId: x.runId,
        // One on another machine: its run here, which its conversation follows (`mirrorRun`).
        ...(x.mirror ? { mirror: x.mirror } : {}),
        status: x.status,
        startedAt: x.startedAt,
        endedAt: x.endedAt,
        delivery: x.delivery,
        ...(x.pictures?.length ? { pictures: x.pictures } : {}),
        ...(x.files?.length ? { files: x.files } : {}),
        ...(x.handed ? { handed: x.handed } : {}),
        ...(x.caughtUp ? { caughtUp: x.caughtUp } : {}),
        ...(x.fresh ? { fresh: x.fresh } : {}),
        ...(x.why ? { why: x.why } : {}),
        ...(x.bounce ? { bounce: x.bounce } : {}),
        ...(x.folder ? { folder: x.folder } : {}),
        // What it drew in this exchange (HarnessV4_Visuals_Plan VS-D50): the card that launched or asked it lists them.
        ...(x.drew?.length ? { drew: x.drew } : {}),
        // …and what it published (HarnessV4_Artifacts_Plan AFC-100): the card names each, and opens it.
        ...(x.made?.length ? { made: x.made } : {}),
        // The models of its card its provider failed it on in this exchange, before the one it ended on.
        ...(x.moved?.length ? { moved: x.moved.map((m) => ({ ...m })) } : {}),
        // The reply that sent it (HarnessV4_OneAgent_Plan L47): the picture of the main agent's own work groups by it.
        ...(x.sentIn ? { sentIn: { ...x.sentIn } } : {}),
        // An exchange that failed says why in one shape (HarnessV3-FailurePoints §5.2), for the surfaces to show.
        ...(x.outcome
          ? { report: cut(x.outcome.report, chars), error: x.outcome.error, rounds: x.outcome.rounds, toolCalls: x.outcome.toolCalls, tokensIn: x.outcome.tokensIn, tokensOut: x.outcome.tokensOut, spentUsd: x.outcome.spentUsd, ms: x.outcome.ms, ...(x.outcome.fromLog ? { fromLog: true } : {}), ...(x.outcome.failure ? { failure: x.outcome.failure } : {}), ...answeredKept(x.outcome) }
          : {}),
      })),
      // The context its first message opened with: a brief a fresh start's message opened with is that exchange's.
      ...(whole ? { opening: sa.opening.filter((b) => !b.exchange).map((b) => ({ kind: b.kind, count: b.count, text: redactSecrets(b.text), ...(b.chars != null ? { chars: b.chars } : {}) })) } : {}),
    };
  };

  /**
   * The ended sub-agents idle the longest go once the registry holds more than it keeps; a running one always stays,
   * and so does one its session's task graph will still ask for (the bug report's L9), and the one whose exchange just
   * ended (`ended`). One its session keeps comes back from there, its conversation gone (`recall`). Past `KEPT_CHARS`
   * of ended conversations that may go, those idle the longest let theirs go in place, as one given back without it does
   * (`restored`): what a graph will ask for again counts for nothing against it, nor does what stays whatever it holds
   * (Fable 5.2's review of 11-17: counted, a graph's held conversations let every other go).
   * @param {string | null} [ended]  the sub-agent whose exchange just ended
   * @param {boolean} [whole]  whether a sub-agent past the newest MAX_KEPT goes whole: not as threads are read back
   */
  const prune = (ended = null, whole = true) => {
    /** An ended sub-agent's conversation, characters (the census's count, kept by the array). @param {Subagent} sa */
    const charsOf = (sa) => {
      if (sa.status === "running" || !Array.isArray(sa.convo) || !sa.convo.length) return 0;
      let n = convoSizes.get(sa.convo);
      if (n == null) convoSizes.set(sa.convo, (n = convoChars(sa.convo)));
      return n;
    };
    let chars = 0;
    for (const sa of subs.values()) chars += charsOf(sa);
    const room = () => (!whole || subs.size <= MAX_KEPT) && chars <= keptChars;
    if (room()) return;
    /** Each chat's graph's word, read once for this prune. @type {Map<string, ((agentId: string) => boolean) | undefined>} */
    const graphs = new Map();
    /** @param {string} chainId */
    const holdsIn = (chainId) => {
      if (!graphs.has(chainId)) graphs.set(chainId, ctx?.holds?.(chainId));
      return graphs.get(chainId);
    };
    /** When it last ended: the one idle the longest goes first. @param {Subagent} sa */
    const idleSince = (sa) => Number(sa.exchanges.at(-1)?.endedAt) || Number(sa.startedAt) || 0;
    const may = [...subs].filter(([id, sa]) => id !== ended && sa.status !== "running" && !holdsIn(sa.chainId)?.(id)).sort((a, b) => idleSince(a[1]) - idleSince(b[1]));
    chars = 0;
    for (const [, sa] of may) chars += charsOf(sa);
    for (const [id, sa] of may) {
      if (room()) break;
      chars -= charsOf(sa);
      if (!whole || subs.size <= MAX_KEPT) {
        // Its record stays, its conversation goes: its next message starts fresh from what was said. One on another
        // machine goes on in its chat there, which holds it: its next message is sent there whole.
        if (!charsOf(sa)) continue;
        sa.convo = [];
        if (sa.remote) sa.remote.held = 0;
        else sa.restored = "let-go";
        continue;
      }
      subs.delete(id);
      lastParentRun.delete(id);
      unplaced.delete(id);
      if (!sa.task && ctx?.loadThreads) {
        letGo.add(id);
        recalled.delete(sa.chainId);
      }
    }
  };

  /**
   * The bus hears every change to a sub-agent's state, so a surface redraws without polling, and its session keeps its
   * thread as it stands (BW-10).
   * @param {Subagent} sa
   */
  const changed = (sa) => {
    keep(sa);
    events.publish("subagents", { type: "subagent", chainId: sa.chainId, id: sa.id, status: sa.status, runId: sa.exchanges.at(-1)?.runId ?? null });
  };

  /** An event on the launching turn's run, while that turn still runs. @param {Subagent} sa @param {any} evt */
  const toParent = (sa, evt) => {
    const p = sa.run?.parent;
    if (p && !p.live.closed) p.emit({ ...evt, parent: p.toolUseId });
  };
  /**
   * A sub-agent's question that waits for the person, opened or settled (the remote desk of 11-22): said on the events
   * feed by its chat and its id as the chat's asks name it (http/admin/sessions.js `subagentAsk`) — whether or not its
   * lead's turn still runs to carry its `subagent-ask` —, so another machine's desk reads the chat's asks again at once.
   * @param {Subagent} sa @param {number} n  its number among the sub-agent's questions @param {boolean} open
   */
  const askSaid = (sa, n, open) => events.publish("turns", { type: "ask", chainId: sa.chainId, id: `${sa.id}.${n}`, open });
  /**
   * A running sub-agent's progress moved: onto the events feed (HarnessV3-Views V3) — the Team view's cards, a graph
   * task's live line. At once when the last went out PROGRESS_MS ago or more, else once that long has passed, as it
   * stands then: a busy run sends one each PROGRESS_MS, and its newest always goes. An exchange that ended sends none.
   * @param {Subagent} sa
   */
  const progressed = (sa) => {
    const run = sa.run;
    if (!run || run.progressDue) return;
    const send = () => {
      run.progressDue = false;
      if (sa.run !== run) return;
      run.progressAt = now();
      events.publish("subagents", { type: "subagent-progress", chainId: sa.chainId, id: sa.id, ...(sa.task ? { task: sa.task.id, ...(sa.task.review ? { review: true } : {}) } : {}), progress: structuredClone(run.progress) });
    };
    const wait = run.progressAt + PROGRESS_MS - now();
    if (wait <= 0) return send();
    run.progressDue = true;
    later(send, wait);
  };
  /**
   * A team's worker whose same command failed a third time is sent to its lead (HarnessV3-TaskGraph-v2 TG2-D59): Filament's
   * note on its run, read at its next step — once per command, as its watch says that sign once — where its lead's turn
   * runs, or is paused for its resume, so a question would reach it.
   * @param {Subagent} sa @param {string} command
   */
  const stuck = (sa, command) => {
    const c = chainState(sa.chainId);
    const runId = sa.exchanges.at(-1)?.runId;
    if ((!c.turn && !c.paused) || !runId || !runs) return;
    const steered = runs.steer(runId, { kind: "note", text: stuckWords(command), from: FILAMENT });
    if (!steered.ok) log("warn", `sub-agent ${sa.id}: Filament's word that it is stuck on \`${clip(command, 80)}\` did not reach its run (${steered.error})`);
  };

  /**
   * A worker's question at its session's door that its lead has not taken yet leaves it (HarnessV3-TaskGraph-v2
   * TG2-D58): it was answered — the developer was first — or it ended, and its lead is not asked a settled question.
   * @param {Subagent} sa @param {number} n  its number
   */
  const unasked = (sa, n) => {
    const c = chains.get(sa.chainId);
    if (!c) return;
    const other = (/** @type {Delivery} */ d) => !(d.kind === "ask" && d.from === sa.id && d.ask === n);
    const before = c.queue.length + (c.turn?.inbox.length ?? 0);
    c.queue = c.queue.filter(other);
    if (c.turn) c.turn.inbox = c.turn.inbox.filter(other);
    if (c.queue.length + (c.turn?.inbox.length ?? 0) < before) persist(sa.chainId);
  };
  /**
   * A worker's question to its lead ends (HarnessV3-TaskGraph-v2 TG2-D49): answered — by its lead or the developer,
   * whichever was first — no answer, its lead's turn having ended or, for its plan, its 3 minutes passed (TG2-D58), or
   * its stop. Once: what comes after finds it settled. Its lead's timeline hears it, and the call that waits for it
   * reads it at once; else the worker's next call, which names it.
   * @param {Subagent} sa @param {NonNullable<Subagent["run"]>} run @param {LeadAsk} q
   * @param {"answered" | "none" | "stopped"} how @param {import("./loop.js").AskAnswer | null} [a]
   */
  const endLead = (sa, run, q, how, a = null) => {
    if (q.done) return;
    q.done = how;
    if (a) q.answer = { text: a.text, by: a.by === "lead" ? "lead" : "developer", go: a.go === true };
    run.asking = null;
    run.progress.asking = null;
    askSaid(sa, q.n, false);
    unasked(sa, q.n);
    // Its plan's go — its lead's or the developer's, `go: true`, never read from their words — or no answer in its 3
    // minutes lets its changes run (TG2-D50). Other words are corrections: the hold stays, for its plan again.
    if (q.plan && (how === "none" || q.answer?.go === true)) {
      run.planHeld = false;
      run.progress.held = false;
    }
    toParent(sa, { type: "subagent-ask-end", agentId: sa.id, to: "lead", answered: how === "answered", ...(q.answer ? { by: q.answer.by, words: q.answer.text } : {}), ...(q.plan ? { plan: true } : {}) });
    changed(sa);
    progressed(sa);
    for (const fn of [...q.wake]) fn();
  };
  /**
   * A worker's question as its lead's door says it (HarnessV3-TaskGraph-v2 TG2-D58): who asks, by the number its answer
   * names, its words and its options, its pick first — and how to answer it. @param {Subagent} sa @param {LeadAsk} q
   */
  const askedText = (sa, q) =>
    `[Filament: your ${sa.team?.role || "worker"} ${sa.id} ("${sa.description}"${sa.attempt ? `, attempt ${sa.attempt.n} of ${sa.attempt.of}` : ""}) asks you (ask ${q.n}), and waits for your answer:\n${q.question}${q.options.length ? `\nIts options, its pick first: ${q.options.join(" · ")}` : ""}\n\nAnswer it with worker: agent_id "${sa.id}", ask ${q.n} and answer.]`;
  /**
   * A question's end, as the worker reads it. `held`: a question of a worker whose plan is still to come (TG2-D50) — its
   * changes wait on, which its words say. @param {LeadAsk} q @param {NonNullable<Subagent["run"]>} run @returns {LeadAnswer}
   */
  const leadEnd = (q, run) => {
    const of = { n: q.n, options: q.options, plan: q.plan, ...(!q.plan && run.planHeld ? { held: /** @type {const} */ (true) } : {}) };
    if (q.done === "answered" && q.answer) return { ok: true, ...of, how: "answered", text: q.answer.text, by: q.answer.by, ...(q.plan ? { go: q.answer.go === true } : {}) };
    return { ok: true, ...of, how: q.done === "none" ? "none" : "stopped" };
  };
  /**
   * The worker's call waits for its question's end, and reads it — then the question is the worker's no more. A call that
   * may hold only so long (`withinMs`, a coding agent's) answers "later" then, the question still open; the signal —
   * the loop's stop, the call's hang-up — is its stop.
   * @param {Subagent} sa @param {NonNullable<Subagent["run"]>} run @param {LeadAsk} q
   * @param {{ withinMs: number, signal: AbortSignal | null }} o
   * @returns {Promise<LeadAnswer>}
   */
  const waitLead = (sa, run, q, { withinMs, signal }) =>
    new Promise((resolve) => {
      let over = false;
      /** @param {LeadAnswer} r */
      const end = (r) => {
        if (over) return;
        over = true;
        q.wake.delete(read);
        signal?.removeEventListener("abort", onAbort);
        resolve(r);
      };
      const read = () => {
        if (run.leadAsk === q) run.leadAsk = null;
        end(leadEnd(q, run));
      };
      const onAbort = () => endLead(sa, run, q, "stopped");
      if (q.done) return read();
      q.wake.add(read);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      if (withinMs > 0) later(() => end({ ok: true, n: q.n, how: "later", waited: now() - q.at, options: q.options, plan: q.plan }), withinMs);
    });

  /** The edit and write calls of a sub-agent's conversation by id, read once for its length (`callChange`): its live
   *  one grows as it works. @type {WeakMap<any[], { n: number, calls: Map<string, { name: string, input: any }> }>} */
  const convoEdits = new WeakMap();
  /** @param {any[]} convo */
  const editsOf = (convo) => {
    const had = convoEdits.get(convo);
    if (had && had.n === convo.length) return had.calls;
    /** @type {Map<string, { name: string, input: any }>} */
    const calls = new Map();
    for (const c of toolsOfTurn(convo, wireFormatOf(convo) ?? "anthropic")) {
      const kind = kindOfName(c.name);
      if (c.id && (kind === "write" || kind === "edit" || kind === "edit-many")) calls.set(String(c.id), { name: c.name, input: c.input });
    }
    convoEdits.set(convo, { n: convo.length, calls });
    return calls;
  };
  /**
   * A run's events after its event `from`, from the oldest its log holds where that is 0: page by page, so a long run's
   * newest are never cut. A lead's looks read only what a worker's log gained since the last (looks.js).
   * @param {string | null} runId @param {number} [from]
   */
  const runEvents = (runId, from = 0) => {
    /** @type {any[]} */
    let out = [];
    if (!runId || !runs?.events) return out;
    for (let since = from; ; ) {
      const page = runs.events(runId, { since, limit: RUN_PAGE })?.events || [];
      out = out.concat(page);
      if (page.length < RUN_PAGE) return out;
      since = Number(page[page.length - 1].n) || since + page.length;
    }
  };
  /**
   * The messages of its lead's a worker's run ended without reading (TG2-D16), in their words: those steered into its
   * run that its loop never read, and those held for a run that never came. Known only where the lead reads along: the
   * worker's mark counts what its run read.
   * @param {NonNullable<Subagent["run"]>} run @param {string | null | undefined} runId
   */
  const unreadOf = (run, runId) => {
    const m = run.look;
    if (!m) return [];
    const held = run.held.filter((h) => ownMessage(h.from)).map((h) => h.text);
    if (!m.lead.unread || !runId) return held;
    const queued = runEvents(runId)
      .filter((e) => e.type === "steer" && e.kind === "note" && ownMessage(e.from) && m.sent.has(String(e.id)))
      .map((e) => String(e.text || ""));
    return [...queued, ...held];
  };
  /**
   * What a worker's progress says of its lead's reading (TG2-D22): its signs since the lead's last look, and the
   * lead's messages it has read and not yet. → whether either moved.
   * @param {NonNullable<Subagent["run"]>} run
   */
  const readInto = (run) => {
    const m = run.look;
    if (!m) return false;
    const p = run.progress;
    const signs = m.fresh.map((s) => ({ kind: s.kind, round: s.round, words: s.words }));
    const same = p.lead?.read === m.lead.read && p.lead?.unread === m.lead.unread && JSON.stringify(p.signs || []) === JSON.stringify(signs);
    p.signs = signs;
    p.lead = { read: m.lead.read, unread: m.lead.unread };
    return !same;
  };

  /**
   * Into the session's running turn, else its queue for the next turn. `wait`: the queue even while a turn runs — it is
   * for the developer's next message (BW-8), whose turn opens with the queue, or whose note hands it to the running
   * turn (`release`).
   * @param {string} chainId @param {Delivery} d @param {{ wait?: boolean }} [opts]
   */
  const enqueue = (chainId, d, { wait = false } = {}) => {
    const c = chainState(chainId);
    if (c.turn && !wait) {
      c.turn.inbox.push(d);
      // A loop waiting on its sub-agents hears this one at once, and whether it is a report, the developer's words to
      // one of them (decision 10), Filament's own notice (a flow's word, HarnessV4_OneAgent_Plan OA4), or a letter
      // (`letter`), which its wait says — and what a graph's word is about (`about`). A graph task's end held for the
      // graph's other workers wakes no wait (the owner's of 11-02).
      if (!d.held) for (const w of [...c.turn.wake]) w(cameOf(d));
    } else {
      // Another agent's result for the agent now, with no turn of it running: the chat goes on by itself to read it, as
      // it does when a background command ends (the owner's of 10-28) — and a graph task's end its runner says wakes
      // (11-02). One kept for the developer's next message waits for it, as does one held for the graph's other
      // workers. Each waits behind those before it, kept on the session (`persist`) until a turn carries it: however many
      // come, none is let go for another.
      const wakes = !wait && !d.held && (d.kind === "report" || d.kind === "result" || (d.kind === "task" && d.wakes === true));
      c.queue.push(wakes ? { ...d, wakes: true } : d);
      persist(chainId);
      if (wakes)
        try {
          ctx?.reportWaits?.(chainId);
        } catch (/** @type {any} */ e) {
          log("warn", `sub-agents: session ${chainId}'s chat was not woken for a report (${e?.message || e}); its next turn carries it`);
        }
      return;
    }
    persist(chainId);
  };

  /**
   * The launches held for the person's yes while Parallelize tasks is off (app/agent/held-launch.js, the owner's of
   * 11-14): each chat's card on the events feed for every page, its answer told to the chat's agent as Filament's notice,
   * which wakes its wait. Its clock is cancellable on the registry's own `later`, which a test drives.
   */
  const holds = createHolds({
    now,
    later: (fn, ms) => {
      let on = true;
      later(() => on && fn(), ms);
      return { off: () => (on = false) };
    },
    cancel: (h) => h?.off?.(),
    publish: (h) => events.publish("subagents", { type: "held", chainId: h.chainId, hold: h }),
    tell: (chainId, text) => enqueue(chainId, { text, from: "", description: "the card for sub-agents that change files", kind: "notice", spends: [], wrote: false }),
    // Parallelize tasks turned on while a card waited: the person's yes to every launch, which its clock then starts.
    consented: (chainId) => ctx?.holdsWriters?.(chainId) !== true,
    warn: (e) => log("warn", `sub-agents: the card for sub-agents that change files: ${String(/** @type {any} */ (e)?.message || e)}`),
  });
  /**
   * A turn as the cards know it: by its first request, which a turn paused and resumed keeps among its runs.
   * @param {{ runId: string, runs: Set<string> }} live
   */
  const turnKey = (live) => String(live.runs.values().next().value ?? live.runId);
  /** A request's turn by `turnKey`, where the chat's live turn holds it. @param {string} chainId @param {string} runId */
  const heldTurn = (chainId, runId) => {
    const live = chains.get(chainId)?.turn;
    return live && live.runs.has(runId) ? turnKey(live) : runId;
  };

  /**
   * The workers whose batch is over (the plan's p6): its merged findings went to their lead with its last report, or it
   * had none to merge. A later report of one is said as itself, and a later wave of their role is a batch of its own.
   * @type {WeakSet<Subagent>}
   */
  const settled = new WeakSet();
  /**
   * A worker's newest report that ends with a findings list — the outcome it ends with (`o`) first — else its
   * newest: a follow-up whose answer holds no list keeps what it found before. @param {Subagent} s @param {Outcome | null} o
   */
  const listedReport = (s, o) => {
    const reports = [...(o ? [String(o.report || "")] : []), ...s.exchanges.filter((x) => x.outcome).map((x) => String(x.outcome?.report || "")).reverse()];
    return reports.find((t) => findingsOf(t)) ?? reports[0] ?? "";
  };
  /**
   * The findings of a lead's workers of one role, merged for it once (the plan's p6: core/beside.js `mergeFindings`):
   * a batch is the workers of `sa`'s role its lead's run launched that no batch before took — a worker's run is the one
   * its first exchange was sent in. When `sa`, whose outcome is `o`, is the last of its batch to report, the batch is
   * over; where two or more of them ended a hunt's list, Filament's words with the merged list, each finding "found by
   * N" where N of them reported it — a check's verdicts are never merged — else "". A report after its batch is over
   * carries none. An absolute path is read from the folders they worked in.
   * @param {Subagent} sa @param {Outcome} o
   */
  const mergedFor = (sa, o) => {
    const run = sa.exchanges[0]?.sentIn?.run;
    if (!sa.team || sa.origin !== "agent" || !run || settled.has(sa)) return "";
    const role = sa.team.role;
    const batch = [...subs.values()].filter((s) => s.chainId === sa.chainId && s.team?.role === role && s.exchanges[0]?.sentIn?.run === run && !settled.has(s));
    if (batch.some((s) => s !== sa && s.status === "running")) return "";
    for (const s of batch) settled.add(s);
    const reports = batch.map((s) => ({ by: s.id, text: listedReport(s, s === sa ? o : null) }));
    const roots = [...new Set(batch.flatMap((s) => [s.cwd, s.work?.wt?.workdir || ""]).filter(Boolean))];
    const m = mergeFindings(reports, { roots });
    return m.workers >= 2 ? mergedWords({ role, workers: m.workers, items: m.items }) : "";
  };

  /**
   * A report for the session's loop. Its spend and calls go with the run that launched the exchange — none with the
   * developer's own launch, nor with a report they send on later (`late`, which says so) — and count on the turn that
   * takes it only when that turn launched it. It supersedes its own launch notice still waiting to be read: the report
   * carries the task too. `wait`: it goes with the developer's next message, never into the turn running now.
   * `told`: the session's switch passes it on, not the developer's own Send (`deliveryText`). `line`: Filament's word on
   * the attempts at its brief, after the report, and `also`: those other attempts, whose spend goes with it (TG2-D53).
   * @param {Subagent} sa @param {Outcome} o @param {string} prompt
   * @param {{ exchange: number, late?: boolean, wait?: boolean, told?: boolean, line?: string, also?: Subagent[] }} opts
   */
  const deliver = (sa, o, prompt, { exchange, late = false, wait = false, told = false, line = "", also = [] }) => {
    const turn = liveTurnOf(sa.chainId);
    const launchedBy = late ? null : lastParentRun.get(sa.id) || null;
    const self = selfOf(sa.exchanges[exchange], told);
    const merged = late || self ? "" : mergedFor(sa, o);
    const text = `${deliveryText(sa, o, prompt, { late, self })}${line ? `\n\n${line}` : ""}${merged ? `\n\n${merged}` : ""}`;
    // Another agent's result may reach a loop at work sealed (HarnessV4_Envelopes_Plan EN-D4): never what the developer
    // sends on themselves (EN-D9), one that started by itself — a drift warning, or passed on by the developer — nor a
    // paused launch's report, which its turn waits for.
    const seal = !late && !self && !(sa.pausing != null && turn?.runId === sa.pausing);
    // A subject from another machine's report is said in Filament's envelope line: in that machine's words (`wordsThere`).
    const subject = sa.remote ? wordsThere(subjectOf(o.report), SUBJECT_CHARS) : subjectOf(o.report);
    const sealing = seal ? { seal: true, subject: subject || subjectFallback(o), sender: senderOf(sa) } : {};
    const unread = (/** @type {Delivery} */ d) => !(d.from === sa.id && d.kind === "notice");
    const c = chainState(sa.chainId);
    c.queue = c.queue.filter(unread);
    if (turn) turn.inbox = turn.inbox.filter(unread);
    // The exchanges Filament sent the worker back with are this report's too (TG2-D45): the spend of each goes with it.
    const back = sa.exchanges[exchange]?.bounce || 0;
    const others = also.flatMap((s) => /** @type {Outcome[]} */ (s.exchanges.map((x) => x.outcome).filter(Boolean)));
    const ends = [.../** @type {Outcome[]} */ (sa.exchanges.slice(Math.max(0, exchange - back), exchange).map((x) => x.outcome).filter(Boolean)), o, ...others];
    const wrote = ends.some((x) => x.wrote);
    const writes = wrote ? writesOf(sa, ends) : undefined;
    enqueue(sa.chainId, { text, from: sa.id, description: sa.description, kind: "report", exchange, ...(late ? { sent: true } : {}), ...sealing, spends: launchedBy ? ends.map((x) => ({ launchedBy, spentUsd: x.spentUsd, toolCalls: x.toolCalls, roundIds: x.roundIds })) : [], wrote, ...withWrites(writes) }, { wait });
  };
  /** Whether a loop at work in this session takes others' results sealed (`subagents.envelopes`, EN-D8). @param {string} chainId */
  const sealsOn = (chainId) => String(settingsOf(chainId).sub?.envelopes || "sealed") !== "whole";
  /** Whether a message is another agent's result a loop at work takes sealed: a report, or a result handed in (EN4). @param {Delivery} d */
  const sealable = (d) => !!d.seal && (d.kind === "report" || d.kind === "result");
  /**
   * Why letters do not go between a sub-agent and the session's agent (letters.js, the owner's of 11-04); "" where they
   * do. They go only with one whose report comes to that agent — never the person's own kept aside, one that started by
   * itself, a second look (`aside`), nor the fork that weighs a message aside, whose agent works on undisturbed
   * (`weighs`) — and never while that agent waits for its report, reading nothing before it (`waits`).
   * @param {Subagent} sa @returns {"" | "weighs" | "aside" | "waits"}
   */
  const letterBar = (sa) => {
    if (sa.weighs) return "weighs";
    // One in the foreground, whose report is the call's result, or one the developer launched to hold the turn: its agent
    // waits for its report.
    if (sa.status === "running" && (!sa.background || (sa.pausing != null && liveTurnOf(sa.chainId)?.runId === sa.pausing))) return "waits";
    if (!(sa.task || (sa.deliver && !sa.aside && sa.origin !== "self" && !sa.second && sa.run?.detached !== "aside"))) return "aside";
    return "";
  };
  /** Why a sub-agent's own letter does not go, in its words (`letterBar`). */
  const LETTER_BAR_WORDS = Object.freeze({
    weighs: "the agent works on undisturbed while you weigh the person's message — what it should know goes in your final message's Letter: line.",
    aside: "your report goes to the developer, not to an agent that launched you — put what you would write in your report.",
    waits: "the agent that launched you waits for your report now and reads nothing before it — put what you would write in your report.",
  });
  /** Whether a message is a letter (`letter`): another chat's, a fork's that weighed the person's message, or a sub-agent's. @param {Delivery} d */
  const isLetter = (d) => d.via === "chat" || d.via === "steer" || d.via === "agent";
  /**
   * What a message ends a running turn's wait with, which its words say (loop.js `waitWords`): the developer's words to
   * a sub-agent ("told"), Filament's own word ("notice"), a letter, what a graph's word is about (`about`, the nudge map
   * of 11-10) — undefined for a report. @param {Delivery} d @returns {string | undefined}
   */
  const cameOf = (d) => (d.kind === "told" ? "told" : d.kind === "notice" ? "notice" : isLetter(d) ? "letter" : d.about);
  /**
   * Whether a session's letters wait sealed for its agent to open (the owner's of 11-04): it takes results sealed, and
   * its agent opens envelopes — its turn's word now, else what its last turn said. Read only where a letter came or
   * waits, so a take with none reads no setting.
   * @param {string} chainId @param {ChainState} c @param {readonly Delivery[]} [due]
   */
  const keepsLetters = (chainId, c, due = []) => (due.some(isLetter) || c.sealed.some(isLetter)) && sealsOn(chainId) && (c.turn && !c.turn.closed ? c.turn.opens() === true : c.opens !== false);
  /**
   * A letter no turn reads now — none runs, or the one that ran closed before taking it — kept for its chat: where its
   * letters wait sealed (`keepsLetters`), among its envelopes, `fresh` until its agent is told, and the chat woken to open
   * it when it chooses (`lettersDue`); else whole in its queue, waking it as a report does. → where it went.
   * @param {string} chainId @param {ChainState} c @param {Delivery} d @returns {"sealed" | "queue"}
   */
  const shelveLetter = (chainId, c, d) => {
    if (!keepsLetters(chainId, c, [d])) {
      enqueue(chainId, d);
      return "queue";
    }
    c.sealed.push({ ...d, envelope: ++c.envelopes, wakes: true, fresh: true });
    persist(chainId);
    envelopesMoved(chainId);
    try {
      ctx?.reportWaits?.(chainId);
    } catch (/** @type {any} */ e) {
      log("warn", `sub-agents: session ${chainId}'s chat was not woken for a letter (${e?.message || e}); its next turn lists it`);
    }
    return "sealed";
  };
  /** The items of a list `which` picks, taken out of it in their order. @template T @param {T[]} list @param {(x: T) => boolean} which */
  const pullOut = (list, which) => {
    const out = list.filter(which);
    if (out.length) list.splice(0, list.length, ...list.filter((x) => !which(x)));
    return out;
  };
  /** The key of the next result handed in (`hand`). */
  let handedSeq = 0;
  /** The session's sealed envelopes moved — one sealed, opened, or sealed again: the page's cards read them again (EN5). @param {string} chainId */
  const envelopesMoved = (chainId) => events.publish("subagents", { type: "subagent-envelopes", chainId });
  /** A sealed result as its line and the list name it. @param {Delivery} d @returns {Envelope} */
  const envelopeView = (d) => ({
    n: Number(d.envelope) || 0,
    from: d.from,
    description: d.description,
    sender: d.sender || `sub-agent ${d.from} ("${d.description}")`,
    subject: d.subject || "it wrote no subject line",
    ...(d.via ? { via: d.via } : {}),
  });
  /**
   * Who sent a result, in its envelope's words: whose it is to the loop that reads it. @param {Subagent} sa
   */
  const senderOf = (sa) =>
    sa.asked
      ? `${sa.card.name} (${sa.id}), one of the developer's saved agents, whom ${sa.origin === "agent" ? "you" : "the developer"} asked`
      : sa.team
        ? `your ${sa.team.role} ${sa.id} ("${sa.description}")`
        : sa.origin === "agent"
          ? `your background sub-agent ${sa.id} ("${sa.description}")`
          : `the developer's sub-agent ${sa.id} ("${sa.description}"), which ran alongside you`;
  /**
   * Filament's subject for a result whose sender wrote none (EN-D3): how it ended, so the line still says something.
   * @param {Outcome} o
   */
  const subjectFallback = (o) => {
    const how = askedStop(o) ? "was stopped as you asked" : `${endedWord(o.status, o.stoppedBy)}${o.error ? ` (${cut(unnoticed(o.error), 120)})` : ""}`;
    return o.fromLog ? `it ${how} before it sent a report; inside is what its run's log shows of its work` : `it wrote no subject line; it ${how}`;
  };

  /**
   * How the session's loop goes on with a sub-agent whose own conversation is gone while its session keeps its thread
   * (BW-10), or nothing where none is kept — a graph task's, or no session to keep it.
   * @param {Subagent | null} sa
   */
  /**
   * Its conversation once an exchange ends: its run's, else what it was sent; and where its run's log stands for its
   * report (`fromLog`), those words as its answer, so a follow-up goes on from what it had done.
   * @param {HostFinish | null} fin @param {any[]} messages @param {Outcome} o
   */
  const convoOf = (fin, messages, o) => fin?.convo || (o.fromLog && messages.at(-1)?.role === "user" ? [...messages, { role: "assistant", content: [{ type: "text", text: o.report }] }] : messages);
  const freshHint = (sa) => (sa && !sa.task && ctx?.saveThread ? ` To go on with it, call ${followTool(sa)} with agent_id "${sa.id}": it starts fresh there, and reads what was said in its thread.` : "");
  /**
   * A sub-agent cut by a restart, in the words its session's loop reads (BUG-26): said as such, with the task. A
   * graceful stop cut it (its report so far may come too), or the next start found its run never ended (a crash).
   * `again`: how to go on with it, where its session keeps its thread; with none, it can only be launched anew.
   * @param {{ id: string, description: string }} sa @param {{ rounds?: number, report?: string, fromLog?: boolean }} o @param {string} prompt
   * @param {string} [report]  the report so far, with what waits in its worktree
   * @param {string} [again]
   */
  const restartText = (sa, o, prompt, report = "", again = "") =>
    `[Filament: sub-agent ${sa.id} ("${sa.description}") was cut by a Filament restart before it finished${o.rounds ? `, after ${o.rounds} round${o.rounds === 1 ? "" : "s"}` : ""}. ${o.fromLog ? "What its run's log shows of its work is below; the rest is lost" : "What it had not reported is lost"}${again ? `.${again}` : "; launch it anew if its task is still needed."}${prompt ? ` Its task:\n${cut(prompt, 600)}` : ""}${o.report ? `\n\n${o.fromLog ? "Before the cut" : "What it reported before the cut"}:\n${report}` : ""}]`;

  /**
   * What a delivery says of an exchange that started by itself, or null for one somebody asked.
   * @param {Exchange | undefined} ex @param {boolean} [told]
   */
  const selfOf = (ex, told = false) => (ex?.by === "self" ? { why: ex.why ?? null, told } : null);
  /** What a report says of the lead's messages its worker never read. @param {string[] | undefined} unread */
  const unreadText = unreadWords;
  /**
   * What a worker's report says after its words of Filament's check — how its run went, or why there was none — and, where
   * it says it checked its work and Filament saw no command run after its last change, what Filament saw (TG2-D45).
   * @param {Outcome} o
   */
  const checkedText = (o) => [o.check ? checkWords(o.check) : "", o.unchecked ? `Filament saw: it ${o.unchecked}.` : ""].filter(Boolean).map((s) => `\n\n${s}`).join("");
  /** Whether a session's agent can open a picture by its name: Filament reads them back, and its envelope tool is on. @param {string} chainId */
  const picturesOpen = (chainId) => !!ctx?.visualCode && (settingsOf(chainId).doc?.loop?.tools || {}).envelope !== false;
  /**
   * What a report says after its words of what its exchange showed the developer: the pictures it drew, by their titles
   * (HarnessV4_Visuals_Plan VS-D52), and the artifacts it published, by their titles and addresses (AFC-100) — never
   * the pictures or the pages; where the session's agent can open them, how (HarnessV4_DesignPass_Plan UX1).
   * @param {Subagent} sa @param {Outcome} o
   */
  const shownText = (sa, o) => {
    const ex = sa.exchanges.find((x) => x.outcome === o) || sa.exchanges.at(-1);
    const tools = settingsOf(sa.chainId).doc?.loop?.tools || {};
    return [drewLine(ex?.drew, picturesOpen(sa.chainId)), madeLine(ex?.made, tools.artifact !== false)].filter(Boolean).map((line) => `\n\n${line}`).join("");
  };
  /** A picture as an agent opens it, by the one who drew it. @param {Subagent} sa @param {Exchange} x @param {Drew} d @returns {PictureOf} */
  const pictureView = (sa, x, d) => ({ id: d.id, title: d.title, bytes: d.bytes, by: `${sa.card?.name || "a sub-agent"} (${sa.id})`, task: String(x.description || ""), at: Number(x.startedAt) || 0 });
  /**
   * A picture one of the session's agents drew, by its name or its id (HarnessV4_DesignPass_Plan UX1, UX-D6): the newest
   * of that name, its code read from where it is kept — its turn, or the session; a team's beside it, its team's chat —
   * and the older ones of that name; with none, the session's pictures, newest first. A thread deleted takes its
   * pictures with it, and a team's chat deleted takes its own.
   * @param {string} chainId @param {string} key @returns {Picture}
   */
  const pictureOf = (chainId, key) => {
    recall(chainId);
    const want = String(key || "").trim().replace(/^["']|["']$/g, "");
    /** @type {{ d: Drew, view: PictureOf, at: number, i: number, chain: string }[]} */
    const all = [
      ...[...subs.values()]
        .filter((s) => s.chainId === chainId)
        .flatMap((sa) => sa.exchanges.flatMap((x) => (x.drew || []).map((d, i) => ({ d, view: pictureView(sa, x, d), at: Number(x.startedAt) || 0, i, chain: chainId })))),
      ...(ctx?.besidePictures?.(chainId) || []).map((p, i) => ({ d: p.d, view: { id: p.d.id, title: p.d.title, bytes: p.d.bytes, by: p.by, task: p.task, at: p.at }, at: p.at, i, chain: p.chain })),
    ].sort((a, b) => b.at - a.at || b.i - a.i);
    const named = all.filter((p) => p.d.id === want || p.d.title === want || p.d.title.toLowerCase() === want.toLowerCase());
    const top = named.find((p) => p.d.id === want) || named[0] || null;
    const older = named.filter((p) => p !== top).map((p) => p.view);
    if (!top) return { found: null, gone: null, older: [], names: all.map((p) => p.view) };
    const code = ctx?.visualCode?.(top.chain, top.d) ?? null;
    return typeof code === "string" ? { found: { ...top.view, code }, gone: null, older, names: [] } : { found: null, gone: top.view, older, names: [] };
  };
  /**
   * A launch of the same member again — a worker's role, or the session's agent's own kind — in words for its lead
   * (TG2-D54): on its card's model, where the card names one, else on the pool's next row that can run, a provider that
   * cannot serve skipped; or once one can, where none can now. Why each row cannot is the pool's to say: here the
   * provider's cause is said already.
   * @param {Subagent} sa
   */
  const againWords = (sa) => `launch its ${sa.team ? "brief" : "task"} again ${freshWords(sa)}`;
  /**
   * Where a new launch of the same member would run (TG2-D54), after "as a new …" — or when one can: on the model its
   * team names for that member, where it names one; else on its team's models, where its team names them or a Brief
   * picked one (U13-D8); else on its card's model, where the card names one; else on the pool's next row that can run.
   * A graph task's choices say it after "send it back to a new …" (V2-1, `ProviderEnd.fresh`).
   * @param {Subagent} sa
   */
  const freshWords = (sa) => {
    const who = sa.team ? sa.team.role : "sub-agent";
    const seat = poolName(sa.team?.model);
    if (seat) return ctx?.modelProblem(seat) ? `once the model its team names for it, ${seat}, can run` : `as a new ${who}, which runs on the model its team names for it, ${seat}`;
    if (sa.crew?.length) {
      const t = takeSeat(seatsOfList(sa.chainId, null, listIn(sa.chainId, "workers", null, sa.crew)), { key: seatKey });
      return t.ok ? `as a new ${who}, which its team's models put on ${t.model} now` : `once one of its team's models (${listed(sa.crew.map((r) => r.model))}) can run`;
    }
    const models = modelsOfCard(cardOf(sa.card.tag));
    const own = models.find((m) => !ctx?.modelProblem(m)) || "";
    if (models.length > 1) return own ? `as a new ${who}, which runs on its card's first model that can, ${own}` : `once one of its card's models (${listed(models)}) can run`;
    if (models.length) return own ? `as a new ${who}, which runs on its card's model, ${own}` : `once its card's model, ${models[0]}, can run`;
    const l = listIn(sa.chainId, sa.list);
    const t = takeSeat(seatsOfList(sa.chainId, null, l), { key: seatKey });
    return t.ok ? `as a new ${who}, which ${listName(l.which)} puts on ${t.model} now` : `once a model of ${listName(l.which)} can run (none can now)`;
  };
  /**
   * How a run that ended on its provider is said (HarnessV3-TaskGraph-v2 TG2-D54): the provider; the cause in its own
   * words; whether it was tried again and what the pool does (`tried`, after the cause); whether it is a wall — the
   * provider cannot serve the account — and, for a model its provider refuses this account, what to tell the developer.
   * Null for a run that ended any other way.
   * @param {Subagent} sa @param {Outcome} o
   * @returns {{ p: string, cause: string, tried: string, wall: boolean, tell: string | null } | null}
   */
  const providerOf = (sa, o) => {
    const f = o.failure;
    const c = f?.cause;
    if (o.ok || !f || !c || o.stoppedBy || sa.cutByRestart) return null;
    const p = c.provider || "its provider";
    const said = String(f.said || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const status = f.status ? ` (HTTP ${f.status})` : "";
    const cause = `${causeWords(c.kind, p)}${said ? ` — "${said}"${status}` : status}`;
    const wall = c.kind === "out" || c.kind === "account";
    // A model its provider refuses this account meets the same refusal on every try, a follow-up's and a launch's on
    // it too, and the pool does not know it: only the developer can put another model in its place.
    if (c.kind === "model") {
      // Whose choice the model was: the team's for this member, where it ran on that; its card's; else the pool's.
      const seat = poolName(sa.team?.model);
      const names = seat && seatKey(seat) === seatKey(sa.model) ? `the ${sa.team?.name} team's ${sa.team?.role}` : poolName(cardOf(sa.card.tag)?.model) ? `its card (${sa.card.tag})` : "the session's pool";
      return { p, cause, wall, tried: `. It was not tried again: every try of ${sa.model} meets the same refusal.`, tell: `Tell the developer: ${names} needs a model ${p} serves this account in place of ${sa.model}.` };
    }
    const hold = c.kind === "out" ? `for ${holdWords(Math.max(60_000, (c.resets != null && c.resets > f.at ? c.resets : f.at + OUT_HOLD_MS) - f.at))}` : "until the developer fixes it in Settings";
    const tried = wall
      ? `. It was not tried again, and the pool skips ${p} ${hold}.`
      : f.tries && f.tries > 1
        ? ` — through ${f.tries} tries${f.began != null && f.at - f.began >= 10_000 ? ` over ${durationWords(f.at - f.began)}` : ""}.`
        : ".";
    return { p, cause, wall, tried, tell: null };
  };
  /**
   * A run that ended on its provider, in the one line its lead reads (HarnessV3-TaskGraph-v2 TG2-D54), in the report's
   * place — the brief is not repeated: the cause in the provider's own words, whether it was tried again and what the
   * pool does, where its work is, and the lead's three choices — or, for a model its provider refuses this account,
   * what to tell the developer. Null for a run that ended any other way.
   * @param {Subagent} sa @param {Outcome} o @returns {string | null}
   */
  const providerText = (sa, o) => {
    const x = providerOf(sa, o);
    if (!x) return null;
    const w = sa.work;
    const work = w?.files.length ? ` Its work so far is in its worktree: ${filesLine(w.files)}.` : w && !w.error ? " It had changed nothing yet." : !w && o.wrote ? " What it changed so far is in your folder." : "";
    const role = sa.team ? sa.team.role : "background sub-agent";
    const head = `[Filament: your ${role} ${sa.id} ("${sa.description}") stopped on its provider, not on its task: ${x.cause}`;
    if (x.tell) return `${head}${x.tried}${work} ${x.tell}]`;
    const again = againWords(sa);
    const follow = `follow it up with ${followTool(sa)} ${x.wall ? `once ${x.p} serves again` : "in a few minutes"}, keeping its conversation${w ? " and its worktree" : ""}`;
    const choices = x.wall ? `${again}; ${follow}` : `${follow}; ${again}`;
    return `${head}${x.tried}${work} You can ${choices}; or leave it, and tell the developer.]`;
  };
  /**
   * A graph task's worker that stopped on its provider, as its end hands it to the graph (V2-1, TG2-D3 in TG2-D54's
   * words): the cause and whether it was tried again, when its worker can go on, where a new one would run — its
   * graph's choices say them — and, for a model its provider refuses the account, what to tell the developer. Null
   * for a run that ended any other way.
   * @param {Subagent} sa @param {Outcome} o @returns {import("../../core/task-graph.js").ProviderEnd | null}
   */
  const providerEnd = (sa, o) => {
    const x = providerOf(sa, o);
    if (!x) return null;
    const fresh = freshWords(sa);
    return { said: `${x.cause}${x.tried}`, wall: x.wall, later: x.wall ? `once ${x.p} serves again` : "in a few minutes", fresh: fresh.replace(/^as a new [^,]+, /, ""), tell: x.tell };
  };
  /**
   * What a Hunter's report says of the graph task it was fired from (11-02): that task, by its id and name, and how a
   * finding that holds becomes a task hanging off it. "" for any other sub-agent.
   * @param {Subagent} sa
   */
  const huntText = (sa) =>
    sa.hunts
      ? `\n\nSent from task ${sa.hunts}${sa.hunted ? ` "${sa.hunted.name}"` : ""} of your task graph. A task for a finding that holds: tasks add with found_by "${sa.id}" — it hangs off ${sa.hunts} on the Plan, marked as this hunt's finding.`
      : "";
  /**
   * The words a report reaches the session's loop in. `forgotten`: sent on after the registry forgot the sub-agent (a
   * restart), so no follow-up hint. `self`: the exchange started by itself (HarnessV4_Tasks E15, AG-263) — why it
   * did, and who passes it on: the session's switch (`told`: "Tell the main agent when it drifts") or the developer.
   * It is said as what the agent wrote by itself: nobody asked it, and Filament's own words to it are not a question
   * of the developer's to quote. A Hunter's report names the graph task it was fired from (`huntText`).
   * @param {Subagent} sa @param {Outcome} o @param {string} prompt
   * @param {{ late?: boolean, forgotten?: boolean, self?: { why: string | null, told: boolean } | null }} [opts]
   */
  const deliveryText = (sa, o, prompt, { late = false, forgotten = false, self = null } = {}) => {
    const turn = liveTurnOf(sa.chainId);
    // A worker its lead stopped — its loop ended on the stop, or its request was cut before a run took it: the report
    // reaches that lead, who asked for the stop. So does one the agent stopped itself, with its agent tool (`askedStop`).
    const how = askedStop(o) ? "was stopped as you asked" : `${endedWord(o.status, o.stoppedBy)}${o.error ? ` (${o.error})` : ""}`;
    const report = `${reportIn(sa, o, "(no report)")}${shownText(sa, o)}${checkedText(o)}${workText(sa, { reads: !!o.readAlong })}${handedNone(sa)}${unreadText(o.unread)}`;
    const again = forgotten ? "" : sa.restored ? freshHint(sa) : ` To ask it more in the same context, call ${followTool(sa)} with agent_id "${sa.id}".`;
    const restart = sa.cutByRestart && o.status !== "done" ? restartText(sa, o, prompt, report, freshHint(sa)) : null;
    const hunt = huntText(sa);
    if (self && !restart) {
      const passed = self.told ? "this session is set to tell you when it finds the turn drifting or stuck" : "the developer is passing you what it wrote";
      const unread = self.told ? " Nobody asked it, and the developer may not have read it." : "";
      return `[Filament: ${sa.card.name}, one of the developer's saved agents, started by itself, and ${passed} (${sa.id}; it ${how}).${self.why ? ` Why it started: ${self.why}.` : ""}${unread}\n\n${sa.card.name}'s answer:\n${report}\n\nWeigh it against what the developer asked of you.]`;
    }
    return (
      restart ??
      (sa.origin === "agent" && !late && sa.asked
        ? // An answer the session's agent asked for in the background: whose it is, and what it is worth.
          `[Filament: ${sa.card.name} (${sa.id}), one of the developer's saved agents, whom you asked, ${how}. You asked:\n${cut(prompt, 600)}\n\n${sa.card.name}'s answer:\n${report}\n\n${ADVICE_WORTH}${turn?.lead ? "" : again}]`
        : sa.origin === "agent" && !late
        ? // One that stopped on its provider says so in one line, with its lead's choices (TG2-D54).
          providerText(sa, o) ?? `[Filament: your ${sa.team ? sa.team.role : "background sub-agent"} ${sa.id} ("${sa.description}") ${how}. You asked it:\n${cut(prompt, 600)}\n\nIts report:\n${report}\n\n${again.trim()}]`
          : late && sa.asked
          ? // An agent the developer asked by its tag (AG-79, OA1): whose answer it is, with what waits to be applied.
            `[Filament: the developer asked ${sa.card.name}, one of their saved agents, and is passing you its answer (${sa.id}; it ${how}). They asked it:\n${prompt}\n\n${sa.card.name}'s answer:\n${report}\n\nWeigh it against your own work and don't redo what it covered.${again}${hunt}]`
          : late
          ? `[Filament: the developer is passing you the report of sub-agent ${sa.id} ("${sa.description}"), which ran on the side and ${how}. The task it was given:\n${prompt}\n\nIts report:\n${report}\n\nWeigh it against your own work and don't redo what it covered.${again}${hunt}]`
          : sa.pausing != null && turn?.runId === sa.pausing
            ? `[Filament: the developer paused your work while their sub-agent ${sa.id} ("${sa.description}") ran; it ${how}, and you continue now. The developer's task for it:\n${prompt}\n\nIts report — a result in the middle of your turn; take it into account before your next step:\n${report}\n\n${again.trim()}${hunt}]`
            : `[Filament: the developer ran sub-agent ${sa.id} ("${sa.description}") alongside you; it ${how}. The developer's task for it:\n${prompt}\n\nIts report:\n${report}\n\nWeigh it against your own work and don't redo what it covered.${again}${hunt}]`)
    );
  };

  /**
   * The developer's sub-agent in the session's transcript — sent off, or its report back: an event on the running
   * turn's timeline (at the round it is in), else a mark recorded between the session's turns, which the bus
   * announces so an open transcript draws it at once. A saved agent the developer asked is always the session's mark
   * (AG-26): its card stands under the turn that ran when they asked, where that turn's work folds away at its end,
   * and the turn's own record holds nothing of a question the main agent never heard.
   * @param {Subagent} sa @param {"dispatch" | "arrival"} event @param {Partial<Mark>} fields
   */
  const mark = (sa, event, fields) => {
    // One on another machine names it, so its row says where once the registry has forgotten it (a transcript opened again).
    const base = { agentId: sa.id, exchange: sa.exchanges.length - 1, description: sa.description, card: { tag: sa.card.tag, name: sa.card.name }, ...(sa.remote ? { machine: { id: sa.remote.machine.id, name: sa.remote.machine.name } } : {}), ...fields };
    const turn = sa.asked ? null : liveTurnOf(sa.chainId);
    if (turn?.emit) return void turn.emit({ type: `subagent-${event}`, ...base });
    const stored = ctx?.mark(sa.chainId, { event, at: now(), ...base }) ?? null;
    if (stored) events.publish("subagents", { type: "subagent-mark", chainId: sa.chainId, mark: stored });
  };

  /**
   * What the mark of an agent asked by its tag carries beside any sub-agent's (AG-19): that it was asked, and the
   * question whole — so the chat's card reads the same once the registry has forgotten the sub-agent. Nothing for one
   * that was launched. One that started by itself (`why`) says why it started in the question's place, and that
   * nobody asked (`self`).
   * @param {Subagent} sa @param {string} question @param {string | null} [why] @returns {Partial<Mark>}
   */
  const askedOf = (sa, question, why = null) => {
    if (!sa.asked) return {};
    const pictures = sa.exchanges.at(-1)?.pictures || [];
    return { asked: true, question: why || question, ...(why ? { self: true } : {}), ...(pictures.length ? { pictures } : {}) };
  };

  /** @param {Subagent} sa @param {string} prompt */
  const informText = (sa, prompt) =>
    `[Filament: the developer launched sub-agent ${sa.id} ("${sa.description}") to run alongside you. Its task:\n${prompt}\n\nIts report will reach you as a message like this one when it finishes. Don't start the same work yourself or launch a sub-agent for it; carry on with the rest.]`;

  /**
   * What a sub-agent's first message opens with: the session's conversation under the chosen view, then memory's brief
   * for its task and the hands it may use (HarnessV3-Memory M7-1), marked as background, so the task below stays the
   * instruction.
   * @param {Subagent} sa @param {string} prompt
   */
  const openingOf = async (sa, prompt, { view = sa.view, changes = sa.changes } = {}) => {
    /** @type {Opening[]} */
    const parts = [];
    const strategy = SUBAGENT_VIEWS[/** @type {keyof typeof SUBAGENT_VIEWS} */ (view)] || null;
    // A fork read the main agent's request as it stood: of the turn running then, it is shown no more — only marked.
    const forked = view === "fork";
    // The context window holds the turn running now itself (the owner's words of 10-19).
    const windowed = view === WINDOW_VIEW && !!ctx?.windowView;
    if ((strategy || forked || windowed || sa.running || changes) && ctx) {
      try {
        const after = sa.since === "message" && strategy ? Number(ctx.sinceMessage?.(sa.chainId)) || 0 : 0;
        const w = windowed && ctx.windowView ? await ctx.windowView(sa.chainId, { messages: liveMessages(sa.chainId, sa.run?.parent || null), model: sa.model }) : null;
        const v = windowed && !changes ? null : await ctx.view(sa.chainId, strategy, { running: forked ? sa.fork?.from === "turn" : !windowed && sa.running, changes, ...(after ? { after } : {}) });
        if (w?.text) parts.push({ kind: "view", count: w.turns, text: windowBlock(w) });
        if (strategy && v?.text) {
          const text = v.text.length > VIEW_CHARS ? `…[Filament: the older part of the conversation is left out]\n${v.text.slice(-VIEW_CHARS)}` : v.text;
          parts.push({ kind: "view", count: v.turns, text: `<conversation view="${view}" turns="${v.turns}">\nThe session you were launched from, as Filament renders its ${v.turns} completed turn${v.turns === 1 ? "" : "s"} (${view} view) from its last compaction on. Background only — your task follows.\n\n${text}\n</conversation>` });
        }
        if (v?.running?.text && !forked) parts.push({ kind: "running", count: v.running.rounds, text: runningBlock(v.running) });
        // A turn that stopped to ask the developer runs no more and has not ended: one shown the session's turns, or
        // the turn in flight, is told it waits.
        const waits = w ? w.waiting : v?.waiting;
        if (waits && (strategy || windowed || sa.running) && !forked) parts.push({ kind: "waiting", count: 1, text: waitingBlock(waits) });
        if (v?.changes?.refused) throw new NoSuchRange(String(v.changes.note));
        if (v?.changes) parts.push({ kind: "changes", count: v.changes.files, text: changesBlock(v.changes) });
        const ex = sa.exchanges.at(-1);
        if (ex?.handed && changes) Object.assign(ex.handed, { files: v?.changes?.files ?? 0 }, v?.changes?.note ? { note: String(v.changes.note) } : {});
        // What it has now seen of its session: a later message to it carries only what came after (BW-7). One shown
        // nothing of the session's turns keeps no mark, and is told nothing later.
        if (w) sa.seen = { turn: w.turn, run: w.mark.run, event: w.mark.event, waiting: w.waiting?.at ?? null };
        else if (v && (strategy || forked || sa.running)) sa.seen = { turn: Number(v.turn) || 0, run: v.running?.run ?? null, event: Number(v.running?.event) || 0, waiting: v.waiting?.at ?? null };
      } catch (/** @type {any} */ e) {
        if (e instanceof NoSuchRange) throw e;
        log("warn", `sub-agent ${sa.id}: no conversation view (${e.message})`);
      }
    }
    // Another machine's agents' chat runs with memory off while it runs fenced (no Full control, as it stands), and so
    // does each sub-agent of it, restored after a restart too.
    if (sa.memory && ctx && ctx.agentsFenced?.(sa.chainId) !== true) {
      try {
        const projectId = ctx.session(sa.chainId)?.projectId || null;
        const tools = handsIn(sa.may === "read" ? "read-only" : sa.mode || permissionMode(settingsOf(sa.chainId).doc?.loop?.permissions));
        const b = await ctx.brief({ chainId: sa.chainId, projectId, launchedBy: sa.run?.parent?.live.runId || (sa.task ? sa.requestId : null), task: prompt, tools, model: sentModel(sa) });
        if (b?.text) parts.push({ kind: "brief", count: b.count, text: `<memory>\n${b.text}\n</memory>`, model: sentModel(sa) });
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agent ${sa.id}: no memory brief (${e.message})`);
      }
    }
    return parts;
  };
  /**
   * A sub-agent's messages as the model its calls go out on reads them: as composed, except where that is not the model
   * its brief was written for — a card's next model its run went on to (`movesOn`) — and Memory settings leave the
   * sub-agent's work out on it (`context.leftOut`): then without the brief, in its first message and in every exchange
   * after on that model. Its block goes; a fork's instruction, which joins the brief's words, keeps the rest of its words.
   * @param {Subagent} sa @param {any[]} messages
   */
  const forModel = (sa, messages) => {
    // The brief its conversation opens with: the one whose words are kept (`afresh` takes an earlier one's away).
    const brief = sa.opening?.find((b) => b.kind === "brief" && b.text);
    if (!brief || (brief.model ?? sentModel(sa)) === sentModel(sa) || !ctx?.leftOut?.(sa.chainId, sentModel(sa))) return messages;
    const text = brief.text;
    /** @param {any} b */
    const without = (b) => (b?.type !== "text" || typeof b.text !== "string" || !b.text.includes(text) ? [b] : b.text === text ? [] : [{ ...b, text: b.text.split(`${text}\n\n`).join("") }]);
    return messages.map((m) => (m?.role === "user" && Array.isArray(m.content) ? { ...m, content: m.content.flatMap(without) } : m));
  };
  /**
   * The standing notes a sub-agent's first message carried ahead of its task (`compose`), as they stand now: memory's
   * brief — the one its conversation opens with, left out where `forModel` sends its model none —, its work's note,
   * where its worktree is for a coding agent (`agentWorkNote`), and what its grants let it run. A fresh session of its
   * agent that takes its conversation up from a summary is told them again ahead of it (acp-turn.js
   * `exchangesGiveWay`); the view of its session, the turn that ran, a fork's start and its plan's review were that
   * first message's alone, and the summary carries what they said.
   * @param {Subagent} sa @returns {string[]}
   */
  const standingNotes = (sa) => {
    const brief = sa.opening?.find((b) => b.kind === "brief" && b.text);
    const briefed = !!brief && ((brief.model ?? sentModel(sa)) === sentModel(sa) || !ctx?.leftOut?.(sa.chainId, sentModel(sa)));
    const note = sa.work ? workNoteOf(sa, { copy: sa.may === "copy", task: !!sa.task, team: !!sa.team }) : null;
    return [...(briefed ? [brief.text] : []), ...(note ? [note] : []), ...(sa.engine === "acp" && sa.work?.wt?.workdir ? [agentWorkNote(sa.work.wt.workdir, sa.cwd)] : []), ...grantsNoted(sa)];
  };

  /**
   * Whether Filament runs a worker's check as its exchange ends (HarnessV3-TaskGraph-v2 TG2-D45): a team's worker that
   * edits, whose brief gave a check and whose run reported done — or a graph task's worker whose task has a check and
   * whose task report says done (V2-1) — in a worktree of its own, in a session that is not read-only, where no rule of
   * the session's speaks for a command of it. → the commands, or the words its report says instead (a graph task's in
   * its graph's words); null where nothing is said: no check, a run that ended otherwise, Filament stopping.
   * @param {Subagent} sa @param {HostFinish | null} fin
   * @returns {{ commands: string[] } | { not: string } | null}
   */
  const checkPlan = (sa, fin) => {
    const commands = sa.grants?.check || [];
    const task = !!sa.task && !sa.task.review;
    if (!commands.length || !(sa.team || task) || (sa.task && !task) || sa.may !== "edit" || fin?.status !== "done" || stopping) return null;
    if (task && fin.taskReport?.status !== "done") return null;
    const words = task ? TASK_NOT_CHECKED : CHECK_NOT_RUN;
    if (!sa.work?.wt) return { not: words.shared };
    const { doc } = settingsOf(sa.chainId);
    if ((sa.mode || permissionMode(doc?.loop?.permissions)) === "read-only") return { not: words.readOnly };
    if (ctx?.agentsAsk?.(sa.chainId)) return { not: words.agents };
    const ruled = (task ? taskRuled : checkRuled)(commands, rulesFrom(doc));
    return ruled ? { not: ruled } : { commands };
  };
  /**
   * A writing graph task's worker whose task has no check of its own, reporting done with the commands it checked its
   * work with (HarnessV3-TaskGraph-v2 TG2-D63): they become its check — run as one now (`checkPlan`), granted in its
   * worktree, and handed to the graph with its end — once: a later report's change nothing. Its team's check (the plan's
   * p6) is no check of its task's: it, and what the folder's check added (V2-2), stay beside them.
   * @param {Subagent} sa @param {HostFinish | null} fin
   */
  const takeChecked = (sa, fin) => {
    const named = fin?.taskReport?.checked || [];
    if (!named.length || !sa.task || sa.task.review || sa.may !== "edit" || sa.taskCheck?.length || sa.taken || stopping) return;
    if (fin?.status !== "done" || fin.taskReport?.status !== "done") return;
    sa.taken = [...named];
    sa.grants = { check: [...new Set([...named, ...(sa.grants?.check || [])])], mayRun: sa.grants?.mayRun || [], ...(sa.grants?.card ? { card: sa.grants.card } : {}) };
  };
  /**
   * Filament runs a worker's check in its worktree (TG2-D45): one command after another, stopping at the first that
   * fails, with no clock of its own — the worker's stop, the turn's and a hang-up end it (`run.abort`). Its progress says
   * which command runs, since when, for the watch and the Team view.
   * @param {Subagent} sa @param {NonNullable<Subagent["run"]>} run @param {string[]} commands @param {string} workdir
   * @param {number} bounces  how often it had gone back to the worker before
   * @returns {Promise<import("./check.js").CheckOutcome>}
   */
  const runChecks = async (sa, run, commands, workdir, bounces) => {
    /** @type {import("./check.js").CheckRun[]} */
    const done = [];
    const signal = run.abort.signal;
    for (const command of commands) {
      if (signal.aborted) break;
      // Its run is over: what runs now is the check, and no model call.
      Object.assign(run.progress, { call: null, wait: null, check: { command, began: now() } });
      progressed(sa);
      const one = () => runOne(command, workdir, signal);
      // A graph task's red command runs once more (V2-1): red then green is flaky, and its task goes on.
      const r = sa.task ? await runAgain(await one(), one) : await one();
      done.push(r);
      if (r.stopped || r.exit !== 0) break;
    }
    run.progress.check = null;
    // A stop between two commands leaves the rest unrun, every one before it passed.
    const cut = done.length < commands.length && done.every((r) => r.exit === 0);
    return { ran: true, commands, runs: done, bounces, stopped: done.some((r) => r.stopped) || cut };
  };
  /**
   * One command of a check, as Filament ran it in `root`: its exit — none where a stop ended it, which `signal` gives — how
   * long it took, and the end of what it printed.
   * @param {string} command @param {string} root @param {AbortSignal} signal
   * @returns {Promise<import("./check.js").CheckRun>}
   */
  const runOne = async (command, root, signal) => {
    const began = now();
    const r = await runCheck(command, { root, signal }).catch((/** @type {any} */ e) => ({ exit: null, output: String(e?.message || e), stopped: false }));
    const stopped = !!r.stopped;
    return { command, exit: stopped ? null : r.exit, ms: now() - began, output: String(r.output ?? ""), stopped };
  };
  /**
   * A graph task's command that failed, run once more where it ran (HarnessV3-TaskGraph-v2 V2-1): the second run is its
   * verdict — red then green is flaky — and the first is kept with it (`first`), the end of what it printed too: a
   * flaky verdict says what failed (the owner's of 11-06: one told without it could not be looked into). One that
   * passed, or a stop ended, stands as it ran, its `first` null.
   * @param {import("./check.js").CheckRun} r @param {() => Promise<import("./check.js").CheckRun>} again
   * @returns {Promise<import("./check.js").CheckRun>}
   */
  const runAgain = async (r, again) => (r.stopped || r.exit === 0 ? { ...r, first: null } : { ...(await again()), first: { exit: r.exit, ms: r.ms, output: r.output } });
  /** The place a check of the folder runs in, named for its session: two sessions on one repository each have their own. @param {string} chainId @param {string} id */
  const checkTreeId = (chainId, id) => `${id}-${String(chainId).replace(/[^\w-]/g, "").slice(0, 24)}`;
  /**
   * Filament's check of a session's folder as it stands (HarnessV3-TaskGraph-v2 V2-1, TG2-D1): of a task of the agent's
   * own it marked done, or of a closed graph's tasks (`all`). The folder is captured as a commit under no ref — its
   * uncommitted work in it, nothing of the folder, its index or its refs changed — and checked out in a worktree of
   * Filament's, where each command runs in order: what a command writes stays in that copy, given back after. A red one
   * runs once more there (`runAgain`); the check stops at the first that stays red unless `all` runs every one. No clock
   * of its own: `signal` cuts it. Not run, and why — the session read-only, a rule of the session's that came since the
   * call gave the check, a folder outside git — in the task's words.
   * @param {string} chainId @param {readonly string[]} commands
   * @param {{ signal?: AbortSignal, id: string, all?: boolean, mode?: import("./prompt.js").PermissionMode | null }} o  `mode`: the running turn's, where its request fixed one
   * @returns {Promise<import("./check.js").CheckOutcome>}
   */
  const checkFolder = async (chainId, commands, { signal = new AbortController().signal, id, all = false, mode = null }) => {
    const { doc } = settingsOf(chainId);
    if ((mode || permissionMode(doc?.loop?.permissions)) === "read-only") return { ran: false, words: TASK_NOT_CHECKED.readOnly };
    if (ctx?.agentsAsk?.(chainId)) return { ran: false, words: TASK_NOT_CHECKED.agents };
    const ruled = taskRuled(commands, rulesFrom(doc));
    if (ruled) return { ran: false, words: ruled };
    const cwd = String(ctx?.session(chainId)?.cwd || "").trim();
    if (!cwd) return { ran: false, words: TASK_NOT_CHECKED.failed("the session names no folder") };
    const snap = await folderSnapshot(cwd, { name: `check-${id}` });
    if (!snap.ok) return { ran: false, words: /not a git repository/.test(snap.error) ? TASK_NOT_CHECKED.git : TASK_NOT_CHECKED.failed(snap.error) };
    const key = checkTreeId(chainId, id);
    treeIds.add(key);
    const o = await openCheckTree(cwd, { id: key, commit: snap.commit, allowed: allowedFolder, keep: treeIds });
    if (!o.ok) {
      treeIds.delete(key);
      return { ran: false, words: TASK_NOT_CHECKED.failed(o.error) };
    }
    const list = [...commands];
    /** @type {import("./check.js").CheckRun[]} */
    const runs = [];
    try {
      for (const command of list) {
        if (signal.aborted) break;
        const one = () => runOne(command, o.wt.workdir, signal);
        const r = await runAgain(await one(), one);
        runs.push(r);
        if (r.stopped || (r.exit !== 0 && !all)) break;
      }
    } finally {
      await releaseTaskWorktree(o.wt, "free").catch((/** @type {any} */ e) => log("info", `session ${chainId}: the check's copy could not be given back (${e?.message || e})`));
      treeIds.delete(key);
    }
    // A stop between two commands leaves the rest unrun.
    const cut = signal.aborted || runs.some((r) => r.stopped);
    return { ran: true, commands: list, runs, bounces: 0, stopped: cut };
  };
  /**
   * One run of a command task (HarnessV3-TaskGraph-v2 V2-3) in `root`: its commands in order, up to the first that does
   * not pass — by its exit, or by its failure where it is inverted (TG2-D67) — or a stop ended. Said by the command that
   * ended it, with the run's whole time.
   * @param {{ item: string | null, steps: import("../../core/task-graph.js").CommandStep[] }} run @param {string} root @param {AbortSignal} signal
   * @returns {Promise<import("../../core/task-graph.js").CommandRun>}
   */
  const runItem = async (run, root, signal) => {
    const began = now();
    /** @type {import("../../core/task-graph.js").CommandRun} */
    let last = { item: run.item, command: "", invert: false, exit: 0, ms: 0, passed: true, output: "", stopped: false };
    for (const step of run.steps) {
      const r = await runOne(step.command, root, signal);
      last = { item: run.item, command: step.command, invert: step.invert, exit: r.exit, ms: 0, passed: commandPassed(r.exit, step.invert), output: r.output, stopped: r.stopped };
      if (!last.passed || r.stopped) break;
    }
    return { ...last, ms: now() - began };
  };
  /**
   * A command task's runs (HarnessV3-TaskGraph-v2 V2-3, TG2-D4): the folder captured once, as a commit under no ref —
   * its uncommitted work in it, nothing of the folder changed — and checked out on up to `lanes` lanes, each a worktree
   * of Filament's with its dependency folders linked. The lanes take the runs in item order, each going back to the
   * snapshot between two (`resetLane`), and each run that ends goes to `progress`. No clock: `signal` cuts every lane,
   * and a run it cut is marked stopped. The lanes' copies are given back after. Not run, and why — the session
   * read-only, a rule of the session's that came since the call gave the commands, a folder outside git, no lane that
   * could be made or kept — in the task's words.
   * @param {string} chainId @param {readonly { item: string | null, steps: import("../../core/task-graph.js").CommandStep[] }[]} runs
   * @param {{ signal?: AbortSignal, id: string, lanes?: number, mode?: import("./prompt.js").PermissionMode | null, progress?: (run: import("../../core/task-graph.js").CommandRun) => void }} o
   * @returns {Promise<{ ran: true, runs: import("../../core/task-graph.js").CommandRun[], of: number, lanes: number, ms: number, stopped: boolean } | { ran: false, words: string }>}
   */
  const runCommands = async (chainId, runs, { signal = new AbortController().signal, id, lanes = 1, mode = null, progress = () => {} }) => {
    const { doc } = settingsOf(chainId);
    if ((mode || permissionMode(doc?.loop?.permissions)) === "read-only") return { ran: false, words: TASK_NOT_RUN.readOnly };
    if (ctx?.agentsAsk?.(chainId)) return { ran: false, words: TASK_NOT_RUN.agents };
    const ruled = taskRuled([...new Set(runs.flatMap((r) => r.steps.map((st) => st.command)))], rulesFrom(doc));
    if (ruled) return { ran: false, words: ruled };
    const cwd = String(ctx?.session(chainId)?.cwd || "").trim();
    if (!cwd) return { ran: false, words: TASK_NOT_RUN.failed("the session names no folder") };
    const snap = await folderSnapshot(cwd, { name: `cmd-${id}` });
    if (!snap.ok) return { ran: false, words: /not a git repository/.test(snap.error) ? TASK_NOT_RUN.git : TASK_NOT_RUN.failed(snap.error) };
    const began = now();
    /** @type {(import("../../core/task-graph.js").CommandRun | null)[]} */
    const ended = runs.map(() => null);
    let next = 0;
    let opened = 0;
    /** @type {string[]} */
    const errors = [];
    /** One lane: a worktree of the snapshot, which takes the next run while any is left. @param {number} n */
    const lane = async (n) => {
      const key = checkTreeId(chainId, `${id}-${n}`);
      treeIds.add(key);
      const o = await openCheckTree(cwd, { id: key, commit: snap.commit, allowed: allowedFolder, keep: treeIds });
      if (!o.ok) {
        treeIds.delete(key);
        errors.push(o.error);
        return;
      }
      opened += 1;
      try {
        for (let first = true; !signal.aborted && next < runs.length; first = false) {
          // A lane that cannot go back to the snapshot takes no more: the other lanes take what is left.
          const back = first ? { ok: true } : await resetLane(o.wt, snap.commit);
          if (!back.ok) {
            errors.push(/** @type {any} */ (back).error);
            break;
          }
          if (signal.aborted || next >= runs.length) break;
          const k = next++;
          const run = await runItem(runs[k], o.wt.workdir, signal);
          ended[k] = run;
          if (!run.stopped) progress(run);
        }
      } finally {
        await releaseTaskWorktree(o.wt, "free").catch((/** @type {any} */ e) => log("info", `session ${chainId}: a lane's copy could not be given back (${e?.message || e})`));
        treeIds.delete(key);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, runs.length)) }, (_, n) => lane(n)));
    const done = /** @type {import("../../core/task-graph.js").CommandRun[]} */ (ended.filter(Boolean));
    // Runs left with no lane to take them, and no stop that cut them: the lanes could not be made or kept.
    if (!signal.aborted && done.length < runs.length) return { ran: false, words: TASK_NOT_RUN.failed(errors[0] || "its lanes ended early") };
    return { ran: true, runs: done, of: runs.length, lanes: opened, ms: now() - began, stopped: signal.aborted };
  };
  /**
   * Why a command task's run cannot be kept in this session (HarnessV3-TaskGraph-v2 V2-3), in the words its planner
   * reads — or null: each command as Filament runs it, its item filled in (`runRefusal`) — and never in a read-only
   * session, where Filament runs none.
   * @param {string} chainId @param {readonly string[]} commands @param {{ mode?: import("./prompt.js").PermissionMode | null }} [o]
   */
  const runProblem = (chainId, commands, { mode = null } = {}) => {
    const { doc } = settingsOf(chainId);
    if ((mode || permissionMode(doc?.loop?.permissions)) === "read-only") return "this session is read-only, so Filament runs no command in it: leave the command task out";
    if (ctx?.agentsAsk?.(chainId)) return `${AGENTS_ASK}, and a command task cannot ask: leave the command task out, and run its commands with bash, which asks`;
    const cwd = String(ctx?.session(chainId)?.cwd || "").trim();
    return runRefusal(commands, { folder: cwd, names: (c) => !!cwd && namesOutside(c, cwd, null), rules: rulesFrom(doc) });
  };
  /**
   * What keeps a graph task's check from being kept in this session (HarnessV3-TaskGraph-v2 V2-1) — or null: read as a
   * brief's check is (TG2-D44) — never an install, a step that cannot be undone, parts that hide a failure, the
   * developer's folder named, or a command a deny or an ask rule of the session's speaks for — and never in a read-only
   * session, where Filament runs none.
   * @param {string} chainId @param {readonly string[]} commands @param {{ mode?: import("./prompt.js").PermissionMode | null }} [o]
   * @returns {import("./grants.js").CheckBar | null}
   */
  const checkBar = (chainId, commands, { mode = null } = {}) => {
    const { doc } = settingsOf(chainId);
    if ((mode || permissionMode(doc?.loop?.permissions)) === "read-only") return { readOnly: true };
    if (ctx?.agentsAsk?.(chainId)) return { shape: `${AGENTS_ASK}, and a check cannot ask: leave check out` };
    const shape = checkCommandsProblem(commands);
    if (shape) return { shape };
    const cwd = String(ctx?.session(chainId)?.cwd || "").trim();
    const hit = grantsHit({ check: [...commands], mayRun: [] }, { names: (c) => !!cwd && namesOutside(c, cwd, null), rules: rulesFrom(doc) });
    return hit ? { hit, folder: cwd } : null;
  };
  /**
   * Why a graph task's check cannot be kept in this session (`checkBar`), in the words the planner reads — or null.
   * @param {string} chainId @param {readonly string[]} commands @param {{ mode?: import("./prompt.js").PermissionMode | null }} [o]
   */
  const checkProblem = (chainId, commands, o = {}) => {
    const bar = checkBar(chainId, commands, o);
    if (!bar) return null;
    if ("readOnly" in bar) return "this session is read-only, so Filament runs no check in it: leave check out";
    if ("shape" in bar) return bar.shape;
    return refusalWords(bar.hit, { folder: bar.folder, lift: "a check", runs: "Filament runs it in a copy of the folder" });
  };
  /**
   * Why the commands a graph task's worker's report names in checked cannot be its task's check (HarnessV3-TaskGraph-v2
   * TG2-D63), in the words its report call's error says — or null: read as a task's check is (`checkProblem`), save in a
   * read-only session, where Filament runs no check and its end says so. Its session's, whatever its task: the call does
   * not say which of the session's workers made it.
   * @param {string} chainId @param {readonly string[]} commands
   */
  const checkedProblem = (chainId, commands) => {
    const { doc } = settingsOf(chainId);
    const cwd = String(ctx?.session(chainId)?.cwd || "").trim();
    return checkedRefusal(commands, { folder: cwd, names: (c) => !!cwd && namesOutside(c, cwd, null), rules: rulesFrom(doc) });
  };
  /**
   * What Filament's check saw of the change that waits to be applied — none where it ran on none, on another, or nothing
   * waits (TG2-D45): a red one's apply needs a reason.
   * @param {Subagent} sa
   */
  const checkOfWork = (sa) => (sa.checked && sa.work?.files.length && sa.checked.head === sa.work.head ? { command: sa.checked.command, exit: sa.checked.exit } : null);
  /**
   * The folder's check that undid its lead's apply of the change that waits (TG2-D55): an apply of it again needs a
   * reason. None where nothing waits, or the work moved on since.
   * @param {Subagent} sa
   */
  const folderRedOf = (sa) => (sa.folderRed && sa.work?.files.length && sa.folderRed.head === sa.work.head ? { command: sa.folderRed.command, exit: sa.folderRed.exit } : null);
  /**
   * The task an exchange's report answers: its own — a return's is the exchange Filament sent the worker back from, its
   * check having failed (TG2-D45) or the folder's after its lead's apply (TG2-D55), and so on back.
   * @param {Subagent} sa @param {number} i @returns {string}
   */
  const taskOf = (sa, i) => {
    const x = sa.exchanges[i];
    if (!x) return "";
    const back = x.bounce || (x.folder ? 1 : 0);
    return back && sa.exchanges[i - back] ? taskOf(sa, i - back) : x.prompt;
  };

  // ---- several attempts at one brief (HarnessV3-TaskGraph-v2 TG2-D53) ------------------------------------------------

  /** A running sub-agent stopped, as `from`: a stop steered into its run, else — no run of it takes one — its abort. @param {Subagent} sa @param {string} from */
  const stopRun = (sa, from) => {
    if (!sa.run) return;
    const runId = sa.exchanges.at(-1)?.runId;
    // A run that reported takes no stop: what runs now is Filament's check of it (TG2-D45), which the abort ends.
    const steered = runId && runs && !sa.run.finished ? runs.steer(runId, { kind: "stop", text: "", from }) : null;
    if (!steered?.ok) {
      sa.run.stoppedBy = from;
      sa.run.abort.abort();
    }
  };
  /** The attempts at one brief, in their order: its launch's group in its session. @param {Subagent} sa @returns {Subagent[]} */
  const groupOf = (sa) => {
    const g = sa.attempt?.group;
    return g ? [...subs.values()].filter((s) => s.chainId === sa.chainId && s.attempt?.group === g).sort((a, b) => Number(a.attempt?.n) - Number(b.attempt?.n)) : [sa];
  };
  /** The attempt of its group whose check passed first, or null. @param {Subagent} sa */
  const winnerOf = (sa) => groupOf(sa).find((s) => s.attempt?.won) || null;
  /** An attempt, as its lead's words name it: attempt 2 of 3 at "…". @param {Subagent} sa */
  const attemptAt = (sa) => `attempt ${sa.attempt?.n} of ${sa.attempt?.of} at "${sa.description}"`;
  /**
   * Why a dropped attempt takes no follow-up, and no apply (`apply`), in words that name the winner — or null for one
   * not dropped. @param {Subagent} sa @param {boolean} [apply]
   */
  const droppedWords = (sa, apply = false) => {
    const by = sa.attempt?.dropped;
    if (!by) return null;
    if (by === ATTEMPT_REFUSED) return `${sa.id} was ${attemptAt(sa)}, whose launch was refused: launch the brief again`;
    return `${sa.id} was ${attemptAt(sa)}, which ${by} won: its work was dropped — ${apply ? `apply ${by}'s change` : `follow up on ${by}`}`;
  };
  /**
   * A dropped attempt's work goes: its refs, and what waited of it — its worktree went with its exchange's end. Its
   * thread says so.
   * @param {Subagent} sa
   */
  const dropWork = async (sa) => {
    const w = sa.work;
    if (w) {
      await dropTaskRefs(w.repo, sa.id).catch(() => false);
      w.files = [];
      w.head = null;
      unsettle(sa);
    }
    sa.checked = null;
    sa.folderRed = null;
    changed(sa);
  };
  /**
   * How an attempt that ended before another won had ended, in the winner's line: its check's failure, its lead's stop,
   * its own failure. @param {Subagent} s
   */
  const endedWords = (s) => {
    const o = s.exchanges.at(-1)?.outcome;
    if (askedStop(o)) return `${s.id} was stopped as you asked`;
    if (o?.ok && s.checked && s.checked.exit !== 0) return `${s.id}'s check had failed (\`${s.checked.command}\`, ${s.checked.exit === null ? "no exit code" : `exit ${s.checked.exit}`})`;
    if (o?.status === "failed") return `${s.id} had failed${o.error ? ` (${clip(String(o.error), 160)})` : ""}`;
    if (o?.status === "aborted") return `${s.id} had been cut off`;
    return `${s.id} had ended`;
  };
  /**
   * An attempt's check passed first: it is its lead's worker. Filament stops the others at once — a running one, one in
   * its check, one waiting for its lead's answer — waits for each to end, and drops their work. → the line its report
   * ends with: how long the win took, and what came of each other attempt.
   * @param {Subagent} sa @returns {Promise<string>}
   */
  const winWith = async (sa) => {
    const a = /** @type {Attempt} */ (sa.attempt);
    a.won = true;
    const group = groupOf(sa);
    const others = group.filter((s) => s !== sa);
    for (const s of others) {
      const b = /** @type {Attempt} */ (s.attempt);
      b.dropped = sa.id;
      if (s.status === "running" && s.run) {
        b.stopped = true;
        stopRun(s, FILAMENT);
      }
    }
    changed(sa);
    await Promise.all(others.map((s) => s.settled).filter((p) => p != null));
    const ms = now() - Math.min(...group.map((s) => s.startedAt));
    const stopped = others.filter((s) => s.attempt?.stopped).map((s) => s.id);
    const said = [...others.filter((s) => !s.attempt?.stopped).map(endedWords), ...(stopped.length ? [`${listed(stopped)} ${stopped.length === 1 ? "was" : "were"} stopped`] : [])];
    for (const s of others) await dropWork(s);
    return `[Filament: ${a.of} attempts at "${sa.description}": ${sa.id}'s check passed first, after ${durationWords(ms)}. ${listed(said)}; ${others.length === 1 ? "its" : "their"} work is dropped.]`;
  };
  /** What a report that waited for its group says once none passed. @param {Subagent} sa */
  const noneLine = (sa) => `[Filament: ${attemptAt(sa)} — none of the ${sa.attempt?.of} passed its check, so each report reaches you: apply a change with reason, follow one up, or brief the task again.]`;
  /**
   * Each report of a group that waited goes to its lead now, the attempts in their order, each with the line that none
   * passed. @param {Subagent[]} group
   */
  const heldGo = (group) => {
    for (const s of group)
      s.exchanges.forEach((x, i) => {
        if (x.delivery !== "attempt" || !x.outcome) return;
        x.delivery = "auto";
        deliver(s, x.outcome, taskOf(s, i), { exchange: i, line: noneLine(s) });
        changed(s);
      });
  };
  /**
   * An attempt's exchange ended where any other's report would reach its lead. The winner's goes with its line and every
   * attempt's spend; a dropped one's never comes, and its work goes. One that did not pass waits while another runs —
   * with the last, every one that waited goes. Filament stopping holds nothing back.
   * @param {Subagent} sa @param {Exchange} ex @param {Outcome} o @param {string} quoted
   * @param {{ line: string | null, lost: boolean }} how
   */
  const attemptEnded = async (sa, ex, o, quoted, { line, lost }) => {
    const i = sa.exchanges.indexOf(ex);
    const group = groupOf(sa);
    if (line) return deliver(sa, o, quoted, { exchange: i, line, also: group.filter((s) => s !== sa) });
    if (lost) {
      ex.delivery = "dropped";
      return dropWork(sa);
    }
    ex.delivery = "attempt";
    if (!stopping && group.some((s) => s !== sa && s.status === "running")) return changed(sa);
    heldGo(group);
  };
  /**
   * Why `n` attempts cannot each take a seat now (TG2-D53), in the pool's words — or null: the session's limit, then the
   * member's model, a seat taken for each in turn. A pool that lends none is the first launch's to say.
   * @param {string} chainId @param {LaunchSpec} spec @param {number} n
   */
  const roomFor = (chainId, spec, n) => {
    const main = spec.parentModel || null;
    const card = spec.team ? cardOf(spec.team.card ?? spec.team.role) : null;
    const want = poolName(spec.model) || poolName(spec.team?.model) || poolName(card?.model);
    const { max, running, seats: rows, which } = ceilingOf(chainId, main, "workers", spec.team && spec.rows?.length ? spec.rows : null, want);
    if (max && max - running < n) return `attempts ${n} need ${n} seats at once, and ${listName(which)} has ${Math.max(0, max - running)} free now: launch fewer, or wait for a worker to report`;
    const seats = rows.map((s) => ({ ...s }));
    for (let k = 0; k < n; k++) {
      const t = takeSeat(seats, { want, who: want ? card?.name || "" : "", key: seatKey, of: seatsOfWords(which) });
      if (!t.ok) return `attempts ${n} need ${n} seats at once: ${t.error}`;
      const s = seats.find((x) => x.key === seatKey(t.model));
      if (s) {
        s.running += 1;
        // Its model's slots across Filament count it too (team_v2_plan TV2-D8).
        if (s.shared) s.shared = { ...s.shared, running: s.shared.running + 1 };
      }
    }
    return null;
  };

  /**
   * A sub-agent's turn on another machine as a run here (s2e): its conversation here follows it as it follows one of
   * this machine's — its rounds' events and its words as they stream, its thinking with them —, and its exchange names it
   * (`mirror`), never as `runId`, which a stop and a message steer into. Its run carries what draws its rounds alone
   * (`MIRRORED`): its asks are its card's (`ask`), and its messages, pictures and own agents are that machine's; two
   * runs there of one exchange read on from each other (`mirrorEvents`). No chat of this machine's is named in it, so
   * no chat here reads as working for it. Null where this Filament keeps no runs (tests).
   * @param {Subagent} sa
   */
  const mirrorRun = (sa) => {
    const ex = sa.exchanges.at(-1);
    const rem = sa.remote;
    if (!ex || !rem || !runs?.startRun || !runs.endRun) return null;
    const id = `rsa-${randomBytes(6).toString("hex")}`;
    runs.startRun({ id, kind: "remote-subagent", title: `${sa.card.name} ${sa.id} on ${rem.machine.name}`, parentId: sa.run?.parent?.live.runId || null, meta: { subagent: sa.id, card: sa.card.tag, machine: rem.machine.name } });
    liveWords?.start(id);
    ex.mirror = id;
    changed(sa);
    const mirror = mirrorEvents({ endBlock: () => liveWords?.endBlock(id), held: () => liveWords?.blocks(id).length ?? 0 });
    let ended = false;
    return {
      /** @param {any} e  an event of its run there */
      event(e) {
        if (ended) return;
        const shown = mirror(e);
        if (shown) events.publish(`run:${id}`, shown);
      },
      words: liveWords
        ? {
            piece: (/** @type {"text" | "thinking"} */ type, /** @type {string} */ text) => void (!ended && liveWords.piece(id, type, text)),
            endBlock: () => void (!ended && liveWords.endBlock(id)),
          }
        : null,
      /** Its turn there ended, as its exchange says. @param {string} status */
      end(status) {
        if (ended) return;
        ended = true;
        runs.endRun?.(id, { status });
        liveWords?.end(id);
      },
    };
  };

  /**
   * A sub-agent's exchange on another machine (the remote-agents plan's s-launch): what of its messages its chat there
   * has not read goes to it as a turn (`remoteContent`), whose events reach its card here as a host's do (`relay`), and
   * whose end is its host's finish — its conversation here its messages and the report's words, which a follow-up goes
   * on from. Once its run began there, the chat there read all it was sent (`held`), and its chat and run are kept at
   * once: a restart here stops that turn there (`stopCut`), whose stop is through before the next turn goes. What it
   * wrote is on that machine, never in this chat's folder. What its chat there asks the person is its ask here, as a
   * local one's (`ask`, the remote-agents plan's s-asks), in words that name the machine (`remoteAsked`); the person's
   * press answers it there — Allow or Deny, or a question's choice or their words to it.
   * @param {Subagent} sa @param {any[]} messages @param {AbortSignal} signal @returns {Promise<HostFinish>}
   */
  const remoteTurn = async (sa, messages, signal) => {
    const rem = /** @type {import("./remote-agents.js").RemoteChat} */ (sa.remote);
    const had = rem.chat;
    await cutStops.get(sa.id);
    const sent = userBlocks(messages).length;
    let began = false;
    const shown = mirrorRun(sa);
    /** @param {any} e */
    const onEvent = (e) => {
      if (!began && rem.run) {
        began = true;
        rem.held = sent;
        changed(sa);
      }
      shown?.event(e);
      registryApi?.relay(sa.id, e);
    };
    /** @param {import("./remote-agents.js").RemoteAsk} ask @param {AbortSignal} asked @returns {Promise<import("./remote-agents.js").RemoteAnswer | null>} */
    const onAsk = async (ask, asked) => {
      const a = registryApi ? await registryApi.ask(sa.id, remoteAsked(rem.machine.name, ask), { signal: asked }) : null;
      if (!a) return null;
      if (ask.kind === "permission") return { allow: a.allow === true, words: a.text };
      // A choice goes there as that machine's own id for it, in the order its card showed them.
      const there = a.choice ? ask.options?.[Number(a.choice) - 1]?.id : null;
      return there ? { choice: String(there) } : { words: a.text };
    };
    /**
     * Its machine has not answered for a while (remote-agents.js `UNREACHABLE_AFTER_MS`), or answers again: its turn
     * there is not ended by that, nor stopped, and nothing is brought from its copy while it lasts (the review of
     * 11-11). Its state says so in the owner's words; the agent that launched it is told, with what happens next — a
     * call that waits on it is answered now, and its turn waits on it no more, since nobody knows when that machine
     * answers; its report reaches it as a message whenever it comes.
     * @param {{ ms: number, why: string } | null} away
     */
    const onAway = (away) => {
      const run = sa.run;
      if (!run) return;
      const said = unreachableWords(rem.machine.name);
      /** @param {string} text @returns {Delivery} */
      const notice = (text) => ({ text, from: sa.id, description: sa.description, kind: "notice", exchange: Math.max(0, sa.exchanges.length - 1), spends: [], wrote: false });
      if (away) {
        run.progress.wait = said;
        /** @type {{ ms: number, why: string, notice: Delivery | null }} */
        const state = { ...away, notice: null };
        awayNow.set(sa.id, state);
        const waiter = run.onDetach ? runsOn(sa, run, true) : null;
        run.parent?.live.own.delete(sa.id);
        if (waiter) waiter("away");
        else if (sa.deliver) enqueue(sa.chainId, (state.notice = notice(awayText(sa, away))));
      } else {
        const was = awayNow.get(sa.id)?.notice ?? null;
        awayNow.delete(sa.id);
        if (run.progress.wait === said) run.progress.wait = null;
        // Its notice not read yet says what holds no more: it goes, and nothing is said of a gap its launcher never
        // heard of. One that was read is followed by this word.
        const c = chainState(sa.chainId);
        const turn = liveTurnOf(sa.chainId);
        const unread = !!was && (c.queue.includes(was) || !!turn?.inbox.includes(was));
        if (unread) {
          c.queue = c.queue.filter((d) => d !== was);
          if (turn) turn.inbox = turn.inbox.filter((d) => d !== was);
          persist(sa.chainId);
        } else if (sa.deliver) enqueue(sa.chainId, notice(`[Filament: ${rem.machine.name} answers again. Sub-agent ${sa.id} ("${sa.description}") was not stopped: its turn there is followed again from where it stood, or said as it ended there. Its report still comes as a message.]`));
      }
      // Its card says the same (`progress.wait`, the line a model call's wait is said on).
      progressed(sa);
      changed(sa);
    };
    try {
      // Its chat there is kept the moment it is made: a restart here before its run began finds it, and stops it there.
      // The sending chat's mode as this message goes, where its launch fixed none (the owner's of 11-10).
      const mode = rem.fixed || permissionMode(settingsOf(sa.chainId).doc?.loop?.permissions);
      const fin = await remote.turn(rem, { content: remoteContent(messages, rem.held ?? 0), signal, title: sa.description, mode, onEvent, onAsk, onChat: () => changed(sa), onAway, words: shown?.words ?? null });
      if (sa.run) sa.run.wrote = false;
      if (rem.model) sa.model = rem.model;
      shown?.end(fin.status);
      return { ...fin, convo: fin.status === "done" ? [...messages, { role: "assistant", content: [{ type: "text", text: fin.report || "(no words)" }] }] : messages };
    } finally {
      // One that threw ended too, in its exchange's words: aborted, where its stop ended it.
      shown?.end(signal.aborted ? "aborted" : "failed");
      awayNow.delete(sa.id);
      if (rem.run) rem.held = sent;
      if (!had && rem.chat) changed(sa);
    }
  };
  /**
   * The sub-agents on other machines whose machine does not answer now (`remoteTurn`'s `onAway`), by id: for how long it
   * had not when that was said, what the last read said, and the notice that said it to their launcher, where one went.
   * @type {Map<string, { ms: number, why: string, notice: Delivery | null }>}
   */
  const awayNow = new Map();
  /**
   * What the agent that launched a sub-agent on another machine reads once that machine has not answered for a while
   * (`onAway`): its state in the owner's words, that nothing was stopped or brought back, and what happens next.
   * @param {Subagent} sa @param {{ ms: number, why: string }} away
   */
  const awayText = (sa, away) => {
    const name = sa.remote?.machine.name || "its machine";
    return `[Filament: sub-agent ${sa.id} ("${sa.description}") is ${unreachableWords(name)}. ${name} has not answered Filament for ${durationWords(away.ms)}${away.why ? ` (${wordsThere(away.why, 200)})` : ""}. Filament has not stopped it there and has brought nothing back from it: what it does there meanwhile is not known here. Filament asks ${name} again every ${durationWords(UNREACHABLE_AGAIN_MS)}; once ${name} answers, its turn is followed again from where it stood, or said as it ended there, and its report reaches you as a message from Filament then. This turn does not wait for it: carry on, or end your turn. Don't launch its task again on ${name} meanwhile. The developer can stop it here: a stop that cannot reach ${name} is sent again before anything else is asked of its chat there.]`;
  };
  /**
   * The stop a sub-agent's turn on another machine is owed — one that could not be known to land there (`stopOwed`) —
   * sent again: owed no more once it reaches that machine. Its next message waits for it to be through, as for a
   * restart's stop (`cutStops`): a stop still on its way would else land on the turn that message starts.
   * → why it did not reach, or null. @param {Subagent} sa @returns {Promise<string | null>}
   */
  const sendOwed = (sa) => {
    const rem = sa.remote;
    if (!rem?.stopOwed || !rem.chat) return Promise.resolve(null);
    const sent = remote.stop(rem).then((why) => {
      if (!why && rem.stopOwed) {
        delete rem.stopOwed;
        changed(sa);
      }
      return why;
    });
    const through = sent.then(() => {});
    cutStops.set(sa.id, through);
    void through.finally(() => cutStops.get(sa.id) === through && cutStops.delete(sa.id));
    return sent;
  };
  /** The stops sent to the turns there of sub-agents on other machines a restart here cut, by id (`stopCut`). @type {Map<string, Promise<void>>} */
  const cutStops = new Map();
  /**
   * A sub-agent on another machine whose turn a restart here cut: its turn there goes on else, and refuses its next
   * message as busy. It is sent a stop there, as best it can be, and its exchange's end says so — or that it could
   * not be, and may still run there: that stop is owed then (`stopOwed`, kept with its thread, so another restart
   * owes it still), and goes before its next message and before anything is brought from its copy (the review of
   * 11-11). @param {Subagent} sa
   */
  const stopCut = (sa) => {
    const rem = /** @type {import("./remote-agents.js").RemoteChat} */ (sa.remote);
    const out = sa.exchanges.at(-1)?.outcome;
    if (!out || !rem.chat) return;
    out.error = `${CUT_BY_RESTART}: its turn on ${rem.machine.name} was sent a stop there`;
    // Kept either way: its exchange's end, saved, is what the next start reads — a stop that reached is not sent again.
    const sent = remote.stop(rem).then((why) => {
      if (why) {
        out.error = `${CUT_BY_RESTART}, and its turn on ${rem.machine.name} could not be stopped (${why}): it may still run there, and is sent a stop again before anything else is asked of its chat`;
        rem.stopOwed = true;
      }
      changed(sa);
    });
    cutStops.set(sa.id, sent);
    void sent.finally(() => cutStops.delete(sa.id));
  };
  /**
   * Whether a project's first copy may go to another machine (cp-place): asked on the sub-agent's card in the chat that
   * launched it, as what its chat there asks is (`ask`): the machine, the project, how many files and bytes go, which of
   * them are in no commit of the project — the first six named —, and what stays here and why. The
   * person's press of Allow alone sends it; their words, a stop or no answer send nothing.
   * @param {Subagent} sa @param {import("./remote-agents.js").SendAsk} o @param {AbortSignal} signal @returns {Promise<boolean>}
   */
  const askSend = async (sa, o, signal) => {
    const held = o.left.length ? ` What stays here: ${o.left.slice(0, 6).map((l) => `${l.path} (${l.why})`).join("; ")}${o.left.length > 6 ? `; and ${o.left.length - 6} more` : ""}.` : "";
    const loose = o.untracked.length ? ` ${o.untracked.length} of them ${o.untracked.length === 1 ? "is" : "are"} in no commit here: ${o.untracked.slice(0, 6).join(", ")}${o.untracked.length > 6 ? `, and ${o.untracked.length - 6} more` : ""}.` : "";
    const size = o.bytes >= 1024 ** 2 ? `${(o.bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(o.bytes / 1024))} KB`;
    // Its line names what stays here too, which its question says why of.
    const kept = o.left.length ? `; kept here: ${o.left.slice(0, 3).map((l) => l.path).join(", ")}${o.left.length > 3 ? ` and ${o.left.length - 3} more` : ""}` : "";
    const q = { tool: SEND_COPY, verb: "wants to send", args: `a copy of ${o.project} to ${o.machine}: ${o.files} files, ${size}${kept}`, question: `Send a copy of ${o.project} to ${o.machine} for this sub-agent to work in? ${o.files} files, ${size} as a bundle.${loose}${held} Asked once for this project and machine: later launches send what changed.`, machine: o.machine, kind: /** @type {const} */ ("permission") };
    const a = registryApi ? await registryApi.ask(sa.id, q, { signal }) : null;
    return a?.allow === true;
  };
  /**
   * One exchange: the host request, and everything that follows its end. Resolves (never rejects) with the outcome.
   * The exchange exists from the call — a stop, a pause and the launcher's wait see it while `compose` still builds
   * its messages (a launch's view and brief take a moment); a stop meanwhile means the request is never sent.
   * `pictures`: the names of the pictures its message carries, and `files` of the text files the main agent attached.
   * `handed`: the change it carries as a patch, as named.
   * `fresh`: a fresh agent takes the thread up with it, and why (BW-10). `why`: why it started by itself, and `look`:
   * it watches — no mark in the chat, and its answer is read for a verdict (`LaunchSpec`). `bounce`: Filament sends the
   * worker back with it, its check having failed on that command, the first time or the second (TG2-D45); `folder`: the
   * same for the folder's check after its lead applied its change (TG2-D55).
   * @param {Subagent} sa @param {(signal: AbortSignal) => Promise<any[]>} compose  given the exchange's stop
   * @param {{ prompt: string, description: string, by: SubagentOrigin, parent: LaunchParent | null, pictures?: string[], files?: string[], handed?: string | null, fresh?: "restart" | "let-go" | null, why?: string | null, bounce?: { command: string, n: number } | null, folder?: { command: string, n: number } | null }} o
   */
  const exchange = (sa, compose, { prompt, description, by, parent, pictures = [], files = [], handed = null, fresh = null, why = null, bounce = null, folder = null }) => {
    const sentIn = sentInBy(parent);
    /** @type {Exchange} */
    const ex = { prompt, description, by, runId: null, status: "running", startedAt: now(), endedAt: null, outcome: null, delivery: null, ...(sentIn ? { sentIn } : {}), ...(pictures.length ? { pictures } : {}), ...(files.length ? { files } : {}), ...(handed ? { handed: { source: handed, files: null } } : {}), ...(fresh ? { fresh } : {}), ...(why ? { why } : {}), ...(bounce ? { bounce: bounce.n } : {}), ...(folder ? { folder: folder.n } : {}) };
    sa.exchanges.push(ex);
    sa.status = "running";
    // A mark before it can be undone no more (`markUndoable`): what it held goes now, whatever this exchange comes to.
    if (sa.work?.applied.at(-1)?.hand) void dropMarkHold(sa.work.repo, sa.id).catch(() => false);
    // A restart's cut was an earlier exchange's: this one ends in its own words.
    sa.cutByRestart = false;
    // Its work moves on: the folder's verdict on it is over, and its lead's next apply is checked again (TG2-D55).
    sa.folderRed = null;
    if (parent) lastParentRun.set(sa.id, parent.live.runId);
    else lastParentRun.delete(sa.id);
    // The launching turn does not end before a background launch of its own reports.
    if (parent && sa.background) parent.live.own.add(sa.id);
    const abort = new AbortController();
    sa.run = { parent, finished: null, wrote: false, acted: false, toolCalls: 0, abort, messages: null, detached: null, unhook: null, onDetach: null, progress: { round: 0, tool: null, context: null, compactions: [], words: "", call: null, wait: null, spent: null, asking: null, check: null, bounce: bounce ?? (folder ? { ...folder, folder: true } : null) }, window: null, held: [], asking: null, leadAsk: null, planHeld: false, stoppedBy: null, shells: new Map(), ran: [], progressAt: -Infinity, progressDue: false, look: null, unwatch: null, watch: sa.team ? newWatchState() : null };
    const run = sa.run;
    // A worker that starts under a lead reading along is read from its first event (HarnessV3-TaskGraph-v2 §12): said
    // once, as its exchange begins, so its prompt and its lead's looks agree for the whole of it. So is a graph task's
    // sub-agent under the session's agent (TG2-D20) — never a helper the agent launched itself, nor the developer's.
    // An attempt at a brief tried several times at once never is (TG2-D53): three trails of one task would fill its lead's
    // window; its questions reach its lead as messages.
    if ((sa.team || sa.task) && !sa.attempt && liveTurnOf(sa.chainId)?.looks) {
      run.look = newMark();
      readInto(run);
    }
    // Its lead reviews its plan first (TG2-D50): its launch's run starts held, where its lead reads along — the plan it
    // sends reaches its lead's looks. A follow-up is never held.
    if (sa.planReview && run.look && sa.exchanges.length === 1) {
      run.planHeld = true;
      run.progress.held = true;
    }
    const onHangUp = () => abort.abort();
    parent?.signal?.addEventListener("abort", onHangUp, { once: true });
    // The turn's stop (not its hang-up) reaches a foreground sub-agent as a stop of its own (BUG-08): its loop cuts
    // what it runs and ends in its words, the report so far kept — never "cut off". Before its run exists, the
    // request is cut, as the developer's own Stop on it does.
    const onParentStop = () => {
      const runId = ex.runId;
      // A run that reported takes no stop: what runs now is Filament's check of it (TG2-D45), which the abort ends.
      const steered = runId && runs && !run.finished ? runs.steer(runId, { kind: "stop", text: "", from: "harness" }) : null;
      if (!steered?.ok) abort.abort();
    };
    if (parent?.stopSignal?.aborted) onParentStop();
    else parent?.stopSignal?.addEventListener("abort", onParentStop, { once: true });
    // A detached run (BUG-12) no longer stops or hangs up with the turn that launched it.
    run.unhook = () => {
      parent?.signal?.removeEventListener("abort", onHangUp);
      parent?.stopSignal?.removeEventListener("abort", onParentStop);
    };
    changed(sa);
    toParent(sa, { type: "subagent-start", agentId: sa.id, description: sa.description, agent: sa.card.tag, model: sa.model, ...(sa.team ? { team: sa.team.key, role: sa.team.role, ...(sa.team.seat ? { seat: sa.team.seat } : {}) } : {}), card: { tag: sa.card.tag, name: sa.card.name }, ...(sa.asked ? { asked: true } : {}), ...(ex.handed ? { handed: ex.handed.source } : {}), ...(by === "agent" && (pictures.length || files.length) ? { attached: { files: files.map((n) => cut(n, ATTACHED_NAME_CHARS)), pictures: pictures.map((n) => cut(n, ATTACHED_NAME_CHARS)) } } : {}), prompt: cut(redactSecrets(prompt), CARD_CHARS), ...(sa.background ? { background: true } : {}), ...(sa.exchanges.length > 1 ? { followUp: true } : {}), exchange: sa.exchanges.length - 1 });
    sa.settled = (async () => {
      /** @type {any[]} */
      let messages = [];
      /** @type {import("../internal-call.js").InternalCallResult | null} */
      let r = null;
      /** @type {any} */
      let thrown = null;
      try {
        messages = await compose(abort.signal);
        run.messages = messages;
        // The request names the session's folder — its project, which memory keys on — even when the run works in a
        // worktree: the host takes that folder from `hostOf`, so a worktree never becomes a project of its own. It
        // names a mode only when one is fixed (read-only for one that only reads, a launch's): otherwise the run's
        // calls follow the session's mode as it stands, a switch included (HarnessV3-AtHome AH-F1).
        const fixed = sa.may === "read" ? "read-only" : sa.mode;
        const headers = {
          [CHAIN_HEADER]: sa.chainId,
          "x-filament-cwd": sa.cwd,
          "x-filament-memory": "tools",
          ...(fixed ? { "x-filament-permissions": fixed } : {}),
          "x-filament-subagent-of": parent?.live.runId || sa.requestId || "owner",
          "x-filament-subagent": sa.id,
        };
        // A sub-agent on another machine runs there (remote-agents.js): its message goes to its chat there as a turn,
        // which ends as a host's run does here (`remoteTurn`). Every other one is a request of Filament's own,
        // streamed so the host's heartbeats keep the connection alive through a long run; the words themselves are
        // on the host's run, where the viewer reads them. A coding agent's is the agent's own turn, under its own name.
        // Its name carries its effort where its launch set one (HarnessV4_Tasks E23-D5). A run its provider failed goes
        // on to its card's next model, the same message sent there anew (`movesOn`) — its brief left out where Memory
        // settings exclude that model (`forModel`).
        if (sa.remote) {
          if (!abort.signal.aborted) run.finished = await remoteTurn(sa, messages, abort.signal);
        } else {
          for (;;) {
            const sent = forModel(sa, messages);
            const body = sa.engine === "acp" ? { model: sentModel(sa), messages: sent } : { model: sentModel(sa), messages: sent, ...(sa.thinking ? { thinking: sa.thinking } : {}) };
            if (!abort.signal.aborted) r = await post({ body, headers, signal: abort.signal, onDelta: () => {} });
            // Its earlier exchanges gave way in the try its provider failed (`HostFinish.start`): the next model goes on from
            // the seed they left, its session let go of, and makes no summary again.
            const from = run.finished?.start || null;
            if (!movesOn(sa, run, abort.signal)) break;
            if (from) messages = run.messages = from;
          }
        }
      } catch (e) {
        thrown = e;
      }
      // A question to its lead still open as its run ended — a coding agent's it did not call again — ends with it
      // (TG2-D49), and one whose end it never read goes.
      if (run.leadAsk) endLead(sa, run, run.leadAsk, "stopped");
      run.leadAsk = null;
      const fin = run.finished;
      // Filament runs the check a worker's brief gave once it reported done (HarnessV3-TaskGraph-v2 TG2-D45), in its
      // worktree: the turn's stop and its hang-up reach it as they reach the run. A writing graph task with no check takes
      // the commands its report named as its check first (TG2-D63).
      takeChecked(sa, fin);
      const plan = checkPlan(sa, fin);
      const where = sa.work?.wt?.workdir || sa.cwd;
      const commands = plan && "commands" in plan ? plan.commands : null;
      // Its work is captured before anyone hears how it went: the report says what waits to be applied.
      const ran = await closeWork(sa, commands ? (workdir) => runChecks(sa, run, commands, workdir, bounce?.n ?? 0) : null);
      /** @type {import("./check.js").CheckOutcome | null} */
      const checked = plan && "not" in plan ? { ran: false, words: plan.not } : commands ? ran || { ran: false, words: (sa.task ? TASK_NOT_CHECKED : CHECK_NOT_RUN).uncaptured } : null;
      parent?.signal?.removeEventListener("abort", onHangUp);
      parent?.stopSignal?.removeEventListener("abort", onParentStop);
      const ms = now() - ex.startedAt;
      /** @type {Outcome} */
      const o = fin
        ? { status: fin.status, ok: fin.status === "done", report: fin.report, error: fin.error, ms, rounds: fin.rounds, toolCalls: fin.toolCalls, tokensIn: fin.tokensIn, tokensOut: fin.tokensOut, spentUsd: fin.spentUsd, roundIds: fin.roundIds, wrote: run.wrote, commands: run.ran.length > 0, stoppedBy: fin.stoppedBy ?? run.stoppedBy, taskReport: fin.taskReport ?? null, ...(fin.failure ? { failure: fin.failure } : {}), ...(fin.held ? { held: fin.held } : {}), ...answeredKept(fin) }
        : (() => {
            // The host never reported: it refused before its loop ran (its words are the reply), or the call failed.
            const said = r?.ok ? textOf(r.json) : "";
            const error = abort.signal.aborted ? "stopped before it finished" : said ? "refused before it started" : thrown ? String(thrown?.message || thrown) : r?.json?.error?.message || `HTTP ${r?.status ?? 0}`;
            return { status: abort.signal.aborted ? "aborted" : "failed", ok: false, report: said, error, ms, rounds: 0, toolCalls: run.toolCalls, tokensIn: 0, tokensOut: 0, spentUsd: 0, roundIds: [], wrote: run.wrote, commands: run.ran.length > 0, stoppedBy: run.stoppedBy, taskReport: null };
          })();
      // Filament cut it as it stopped: that is its end, whatever the cut call said (a hang-up, a refusal) (BUG-26).
      // A host that finished its work as the cut landed keeps its "done" (the round's code review).
      if (sa.cutByRestart && o.status !== "done") Object.assign(o, { status: "aborted", ok: false, error: CUT_BY_RESTART });
      // One that ended before it reported (its loop threw, its provider failed before its last round said anything, a
      // stop cut it mid-round) left what it did in its run's log: that stands for its report, said as such, so its
      // work is not lost with its run (the transcript audit, 2026-10-23).
      if (!o.ok && !String(o.report || "").trim()) {
        const logged = cutReportOfRun(runEvents(ex.runId));
        if (logged) Object.assign(o, { report: logged, fromLog: true });
      }
      // What its provider did with the pictures is the evidence the next question is warned from (AG-20): a request
      // refused before the model wrote a word says so, with the way on; one that ended done clears the model's name.
      if (pictures.length) {
        const refused = !o.ok && !o.tokensOut && PICTURE_REFUSALS.has(Number(o.failure?.status));
        if (o.ok) pictureRefusals.delete(sa.model);
        else if (refused) {
          const said = String(o.failure?.said || o.error || "").slice(0, 200);
          pictureRefusals.set(sa.model, said);
          const them = pictures.length === 1 ? "the picture" : `the ${pictures.length} pictures`;
          o.error = `${sa.model}'s provider refused the request with ${them}: "${said}" — ${sa.asked ? `put a model that reads pictures on ${sa.card.name}'s card` : "launch it on a model that reads pictures"}, or ask without ${pictures.length === 1 ? "it" : "them"}`;
        }
      }
      // A message of its lead's it ended without reading: the report says so, or the lead takes the work for one that
      // heard it.
      const missed = unreadOf(run, ex.runId);
      if (missed.length) o.unread = missed;
      if (run.look) o.readAlong = true;
      if (checked) o.check = checked;
      // A worker's "tested" where no command ran after its last change, and Filament ran no check: what Filament saw.
      const sign = o.ok && run.watch && !checked?.ran ? uncheckedAt({ ...run.watch, lastWrite: inFolder(where, run.watch.lastWrite) }, o.report) : null;
      if (sign) o.unchecked = sign.words;
      ex.outcome = o;
      ex.status = o.status;
      ex.endedAt = now();
      // A red check goes back to the worker by itself, twice at most, while its lead hears nothing (TG2-D45): it goes on
      // in the context it has, in its worktree checked out again, as the next exchange. Nothing of this one's end is
      // told — its report is not delivered, and the launching turn still waits on the same promise.
      const failed = checked ? failedRun(checked) : null;
      const n = (bounce?.n ?? 0) + 1;
      if (failed && checked?.ran && n <= CHECK_RETURNS && !stopping && !abort.signal.aborted && !parent?.live.closed && !sa.attempt?.dropped) {
        const back = await reopenWork(sa).then(
          () => true,
          (/** @type {any} */ e) => void log("warn", `sub-agent ${sa.id}: Filament's check failed, and it could not go back to work (${e?.message || e})`),
        );
        // Another attempt at its brief won meanwhile (TG2-D53): it goes back no more, and its worktree goes again.
        if (back && sa.attempt?.dropped) await closeWork(sa).catch(() => null);
        else if (back) {
          ex.delivery = "back";
          sa.convo = convoOf(fin, messages, o);
          run.unwatch?.();
          run.unwatch = null;
          // Commands its report named are its check now, and the words say so (TG2-D63).
          const named = !!sa.taken && checked.commands.every((c) => /** @type {string[]} */ (sa.taken).includes(c));
          const text = bounceText(checked, n, { task: !!sa.task, agent: !!sa.task && !sa.team, named });
          return await exchange(sa, async () => withUserText(sa.convo, text), { prompt: text, description: ex.description, by, parent, bounce: { command: failed.command, n } });
        }
      }
      const quoted = taskOf(sa, sa.exchanges.indexOf(ex));
      // A foreground run's report is its call's answer ("tool") — unless the developer detached it: then it reached
      // the main agent as a message ("auto") or stays theirs to send on ("held"). A graph task's end is its runner's,
      // and a flow's box's its flow's: neither waits aside for a Send.
      // A fork that weighed the person's message ends to its turn alone, which reads its verdict.
      ex.delivery = sa.weighs ? "weighed" : sa.task ? "task" : sa.origin === "flow" && !sa.deliver ? "flow" : sa.deliver ? "auto" : parent && !run.detached ? "tool" : "held";
      // A report kept aside outlives a restart: the session keeps the words a later Send passes on.
      if (ex.delivery === "held") keepHeld(sa.chainId, { agentId: sa.id, exchange: sa.exchanges.indexOf(ex), description: sa.description, text: deliveryText(sa, o, quoted, { late: true, forgotten: true, self: selfOf(ex) }) });
      // What Filament's check saw stays with the work it ran on: an apply of a red one needs a reason. A stop leaves the
      // work as unchecked as it was.
      if (checked?.ran && !checked.stopped) sa.checked = { command: (failed || checked.runs[checked.runs.length - 1]).command, exit: failed ? failed.exit : 0, head: sa.work?.head ?? null };
      sa.status = o.status;
      // Its slot is free: a worker that waits for one may start (team_v2_plan §5.7).
      pumpSlots();
      sa.convo = convoOf(fin, messages, o);
      // It holds a conversation of its own again.
      if (ex.fresh && sa.convo.length) sa.restored = null;
      // What it found reaches memory, which reads it off the request path (HarnessV3-Memory M7-2): an exchange that
      // ended done, with its report — a graph task's, what its report says it did; never a stopped, failed or cut one.
      // A follow-up's conversation holds the earlier exchanges' calls too, unless they gave way to its own summary at
      // its line (turn.js `exchangesGiveWay`): its report may rest on what they read.
      // An answer of an agent asked by its tag never does: it is one agent's view, held by whoever asked. Learned, its guesses would stand
      // as the project's facts, and reach the main agent and the next lead though nobody sent them (V4-D296). Nor
      // does a report whose check Filament saw fail (TG2-D45): what it says it did is what the check refutes. Nor one of an
      // attempt another won, whose work is dropped (TG2-D53) — `lost`; the first attempt whose check passed is `won`.
      const lost = !!sa.attempt && (!!sa.attempt.dropped || !!winnerOf(sa));
      const won = !!sa.attempt && !lost && sa.deliver && o.ok && !!checked?.ran && !checked.stopped && !failed;
      const found = o.taskReport ? o.taskReport.did : o.report;
      // Nor a fork's verdict on the person's message, which is Filament's to read and nobody's finding.
      if (o.ok && !failed && !lost && !sa.asked && !sa.weighs && String(found || "").trim() && ctx?.reported)
        try {
          ctx.reported({ chainId: sa.chainId, launchedBy: parent?.live.runId || (sa.task ? sa.requestId : null), agentId: sa.id, agentType: sa.card.tag, model: sa.model, sentModel: sentModel(sa), task: quoted, report: found, calls: callLog(fin?.convo) });
        } catch (/** @type {any} */ e) {
          log("warn", `sub-agent ${sa.id}: its report did not reach memory (${e?.message || e})`);
        }
      toParent(sa, { type: "subagent-end", agentId: sa.id, ...(ex.moved?.length ? { model: sa.model } : {}), status: o.status, ok: o.ok, ms: o.ms, rounds: o.rounds, toolCalls: o.toolCalls, tokensIn: o.tokensIn, tokensOut: o.tokensOut, spentUsd: Math.round(o.spentUsd * 1e6) / 1e6, ...(o.report ? { report: cut(o.report, CARD_CHARS) } : {}), ...(String(o.report || "").length > CARD_CHARS ? { reportCut: true } : {}), ...(o.error ? { error: cut(String(o.error), 300) } : {}), ...(o.failure?.head ? { failure: { head: o.failure.head, more: o.failure.more || "" } } : {}) });
      // The winner stops the other attempts and waits for their ends while it still counts as running for its lead's
      // turn, which owes its report (TG2-D53).
      const line = won ? await winWith(sa) : null;
      run.unwatch?.();
      run.unwatch = null;
      sa.run = null;
      sa.settled = null;
      changed(sa);
      if (sa.deliver) {
        if (sa.attempt) await attemptEnded(sa, ex, o, quoted, { line, lost });
        else deliver(sa, o, quoted, { exchange: sa.exchanges.indexOf(ex) });
      }
      // The developer's report back, in the transcript. A command that waited answered with the report itself.
      // A launch of the agent's the developer detached and took over reports to them too: without the mark, its report
      // waited unseen behind the sub-agent's window (the UI/UX review, 2026-09-30).
      if (by === "owner" || (by === "self" && !sa.second && !sa.weighs) || (by === "command" && sa.deliver) || run.detached === "aside")
        mark(sa, "arrival", { status: o.status, ms: o.ms, rounds: o.rounds, toolCalls: o.toolCalls, delivery: sa.deliver ? "auto" : "held", ...(sa.asked ? { ...askedOf(sa, quoted, why), model: sa.model, answer: o.report || "", tokensIn: o.tokensIn, tokensOut: o.tokensOut, spentUsd: Math.round(o.spentUsd * 1e6) / 1e6 } : {}), ...(sa.work?.files.length ? { changes: sa.work.files.length } : {}), ...(ex.handed ? { handed: ex.handed.source, handedFiles: ex.handed.files ?? 0 } : {}), ...(o.error ? { error: cut(String(o.error), 400) } : {}) });
      // A graph that cannot be read keeps every sub-agent it may hold, and the end still reaches the runner.
      try {
        prune(sa.id);
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agents: the registry let none go past the newest ${MAX_KEPT}, nor any conversation past its ${keptChars / 1e6}M characters (${e?.message || e})`);
      }
      // The graph's runner hears every end — a slot frees — and a task's with what Filament saw: its worktree's change,
      // the commands it ran to their end, its report. The exchanges Filament sent its worker back with are the task's too
      // (V2-1): their spend, calls and rounds go with its end.
      try {
        const at = sa.exchanges.indexOf(ex);
        const ends = [.../** @type {Outcome[]} */ (sa.exchanges.slice(Math.max(0, at - (ex.bounce || 0)), at).map((x) => x.outcome).filter(Boolean)), o];
        const ended = { exchange: at, description: String(ex.description || sa.description || ""), ok: !!o.ok, status: String(o.status || ""), report: String(o.report || o.error || "").slice(0, 400), helper: !!(sa.second || sa.weighs) };
        ctx?.exchangeEnded?.({ chainId: sa.chainId, agentId: sa.id, task: sa.task ? { id: sa.task.id, review: sa.task.review, exchange: at, launchedBy: sa.requestId, unread: o.unread || [], ...taskEndOf(sa, o, run, ends) } : null, ended });
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agent ${sa.id}: the task graph did not hear its end (${e?.message || e})`);
      }
      return o;
    })();
    return sa.settled;
  };

  /**
   * What a helper that shares the session's folder wrote there, for the round of the session's turn that hears of it
   * (HarnessV4_Git_Plan GWC-13): the files its calls named, and whether the exchanges it reports (`ends`) ran commands.
   * None for one in a worktree of its own, whose work is a copy until it is applied (`appliedWrites`).
   * @param {Subagent} sa @param {readonly Outcome[]} ends @returns {import("../turn-tree.js").Writes | undefined}
   */
  const writesOf = (sa, ends) => {
    if (sa.work) return undefined;
    const paths = pathsWritten(sa.convo).map((p) => resolve(sa.cwd, p));
    const command = ends.some((x) => !!x.commands);
    return paths.length || command ? { by: sa.id, paths, ...(command ? { command } : {}) } : undefined;
  };
  /** A path a call named, relative to the folder: as the folder's own files are named, when it is one. @param {string} cwd @param {string} p */
  const inFolder = (cwd, p) => {
    const r = relative(cwd, resolve(cwd, p));
    return r && !isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`) ? r.split(sep).join("/") : p;
  };
  /**
   * A graph task's end as its runner reads it (HarnessV3-TaskGraph G2-4): how the run ended and its report beside what
   * Filament saw — its worktree's change (none when it had no worktree), whether it worked in the session's folder, the
   * commands it ran with their exits, its tool calls, the files its calls wrote in the session's folder, and whether a
   * restart cut it — and (V2-1) Filament's check of it, the provider it stopped on, and the spend of `ends`, each exchange
   * of the task's: the last and those Filament sent its worker back from; and (TG2-D63) the commands its report named
   * that became its task's check.
   * @param {Subagent} sa @param {Outcome} o @param {NonNullable<Subagent["run"]>} run @param {readonly Outcome[]} ends
   * @returns {import("../../core/task-graph.js").TaskEnd & { toolCalls: number, roundIds: string[] }}
   */
  const taskEndOf = (sa, o, run, ends) => ({
    agent: sa.id,
    status: o.status,
    stoppedBy: o.stoppedBy,
    error: o.error,
    report: o.taskReport,
    words: o.report,
    files: sa.work ? sa.work.files.map(({ path, added, removed }) => ({ path, added, removed })) : [],
    shared: sa.may === "edit" && !sa.work,
    wrote: ends.some((x) => x.wrote),
    workError: sa.work?.error ?? null,
    ran: run.ran,
    calls: callLines(sa.convo),
    written: sa.work ? [] : pathsWritten(sa.convo).map((p) => inFolder(sa.cwd, p)),
    ...withWrites(ends.some((x) => x.wrote) ? writesOf(sa, ends) : undefined),
    spentUsd: Math.round(ends.reduce((s, x) => s + (Number(x.spentUsd) || 0), 0) * 1e6) / 1e6,
    toolCalls: ends.reduce((s, x) => s + (Number(x.toolCalls) || 0), 0),
    roundIds: ends.flatMap((x) => x.roundIds || []),
    ms: ends.reduce((s, x) => s + (Number(x.ms) || 0), 0),
    cut: !!sa.cutByRestart,
    check: o.check ?? null,
    ...(sa.taken ? { taken: [...sa.taken] } : {}),
    provider: providerEnd(sa, o),
  });

  /**
   * The session's newest request is kept while the provider may still cache it, and let go when that lifetime is
   * over (a snapshot holds a whole conversation). A cache hit renews the lifetime from the hit, so a fork that read
   * it keeps it longer.
   * @param {string} chainId @param {CacheSnapshot} snap
   */
  const keepWarm = (chainId, snap) => {
    const c = chainState(chainId);
    if (c.warmTimer) clearTimeout(c.warmTimer);
    c.warm = snap;
    c.warmTimer = setTimeout(() => {
      c.warm = null;
      c.warmTimer = null;
      events.publish("subagents", { type: "subagent-cache", chainId });
    }, Math.max(0, snap.sentAt + snap.ttlMs - now()));
    c.warmTimer.unref?.();
  };
  /** The kept request let go before its lifetime is over. @param {string} chainId */
  const letGoWarm = (chainId) => {
    const c = chains.get(chainId);
    if (!c?.warm) return;
    if (c.warmTimer) clearTimeout(c.warmTimer);
    c.warm = null;
    c.warmTimer = null;
  };
  /**
   * The last turn's newest request, kept, as a task of the graph forks it: only where its tools carry report, which the
   * task ends with — a request from before the graph was on has none. Null otherwise. @param {string} chainId
   * @returns {CacheSnapshot | null}
   */
  const keptForTasks = (chainId) => {
    const kept = chains.get(String(chainId || ""))?.warm || null;
    return kept && Array.isArray(kept.body?.tools) && kept.body.tools.some((/** @type {any} */ t) => t?.name === "report") ? kept : null;
  };

  /**
   * Whether a sub-agent takes a slot of its model's now: it runs, and somebody started it. One that started by itself
   * takes none (HarnessV4_Tasks E15 step 7, AG-203): the session's agent is never refused a helper because one
   * was looking.
   * @param {Subagent} s @param {string} chainId
   */
  const seated = (s, chainId) => s.chainId === chainId && s.status === "running" && s.origin !== "self" && !s.waiting && !s.remote;
  /** What two names of one model share: the name less Filament's `agent/` and its effort suffix. @param {string} m */
  const seatKey = (m) => parseModelSuffix(poolName(m), config()?.rules).base.toLowerCase();
  /**
   * The main agent's effort, which an agent that names none inherits (the owner's word of 11-05): its chat's setting,
   * else the level its model's name spells — a family whose ids spell their levels, or Filament's suffix — else none
   * ("model"). The review of 11-05: the setting alone missed the name's. Inherited, it keeps a level another model's
   * name spells; its setting, on the main agent's own model (`on`, the very name in any case, less Filament's `agent/`), is
   * `asked`, as the setting beats the name on the wire — a name past it that spells a level keeps it (the review of 11-05).
   * @param {any} doc  the chat's effective settings @param {string | null | undefined} name  its main agent's model
   * @param {string | null} [on]  the model the agent runs on
   * @returns {{ level: string, asked: boolean }}
   */
  const mainEffortIn = (doc, name, on = null) => {
    const set = mainEffortOf(doc);
    if (set !== "model") return { level: set, asked: !!on && !!name && poolName(on).toLowerCase() === poolName(name).toLowerCase() };
    const e = name && ctx?.effortOf ? ctx.effortOf(String(name), null, false) : null;
    return { level: e?.spelled && e.level ? e.level : set, asked: false };
  };
  /**
   * A chat's own rows for one card or one team's part (the owner's plan of 11-05: `subagents.byCard`, `byTeam`), read as
   * a card's models are: their names in order — "" the main agent's model, `main` — and the efforts they say, a model's
   * the first of its rows says, as the chat's list (`seatsOf`); null where it sets none.
   * @param {unknown} rows @param {string | null | undefined} main
   * @returns {{ models: string[], efforts: Record<string, string> } | null}
   */
  const chatRowsOf = (rows, main) => {
    if (!Array.isArray(rows) || poolProblem(rows)) return null;
    /** @type {string[]} */
    const models = [];
    /** @type {Record<string, string>} */
    const efforts = {};
    for (const r of rows) {
      const m = poolName(r.model) || poolName(main);
      if (!m) continue;
      const had = models.find((x) => x.toLowerCase() === m.toLowerCase());
      if (!had) models.push(m);
      if (r.effort && !efforts[had || m]) efforts[had || m] = String(r.effort);
    }
    return models.length ? { models, efforts } : null;
  };
  /** A chat's own rows for a card, as its settings hold them. @param {any} doc @param {string} tag @returns {unknown} */
  const byCardIn = (doc, tag) => {
    const v = doc?.subagents?.byCard;
    return v && !byCardProblem(v) ? v[tag] : null;
  };
  /** A chat's own rows for a team's lead or its workers. @param {any} doc @param {string} key @param {"lead" | "workers"} part @returns {unknown} */
  const byTeamIn = (doc, key, part) => {
    const v = doc?.subagents?.byTeam;
    return v && !byTeamProblem(v) ? v[key]?.[part] : null;
  };
  /**
   * A chat as one reading of its seats takes it: its settings (`settingsOf`), and its main agent's model, read the first
   * time something asks. A ceiling reads the chat's list and its models' slots, and a poll of the chat's agents its limit
   * and its next seat — each part from the one reading, not a resolution of its own.
   * @param {string} chainId
   * @returns {ChatReading}
   */
  const chatOf = (chainId) => {
    const { doc, sub } = settingsOf(chainId);
    /** @type {{ model: string | null | undefined } | null} */
    let main = null;
    return { doc, sub, main: () => (main ??= { model: ctx?.session(chainId)?.model }).model };
  };
  /**
   * One of a session's lists as a launch reads it (HarnessV4_Tasks E23-D6): its rows, and the agents that take a seat
   * of it now. A team's own models (`team`, team_v2_plan TV2-D8), read for its workers before the chat's list (U13-D8),
   * or `rows`, an edit not saved yet; else the chat's list, every agent of the chat counting in it — the crews have no
   * list of their own (U13-D14, 10-20 after the build). `chat`: the chat as the reading took it, which its seats read on.
   * @param {string} chainId @param {"side" | "workers"} list @param {unknown} [rows]
   * @param {import("../../core/pool.js").PoolRow[] | null} [team] @param {ChatReading} [chat]
   * @returns {{ which: "side" | "workers", rows: import("../../core/pool.js").PoolRow[], counted: Subagent[], chat: ChatReading }}
   */
  const listIn = (chainId, list, rows = null, team = null, chat = chatOf(chainId)) => {
    const teamOwn = list === "workers" && rows == null && team?.length ? team : null;
    const split = !!teamOwn || (list === "workers" && rows != null);
    const which = list === "workers" && split ? "workers" : "side";
    // The list is an order (U13-D15): what holds a row back is its model's slots across Filament, nothing of the chat's.
    const got = poolOf(rows ?? teamOwn ?? chat.sub.pool);
    return {
      which,
      rows: got,
      counted: [...subs.values()].filter((s) => seated(s, chainId) && (split && s.list === "workers" ? "workers" : "side") === which),
      chat,
    };
  };
  /**
   * A session's list as a launch reads it (HarnessV4_Tasks E15 step 8): each row with what it lends now and how many
   * agents that take a seat of that list run on its model. `main`: the main agent's model — the launcher's where a
   * launch names it, else the session's — which a row that names no model stands for.
   * `rows`: a list read in the stored one's place — an edit not saved yet, for its editor. `list`: "workers" for a
   * team's worker, whose team's own models come first (`listIn`).
   * @param {string} chainId @param {string | null} [main] @param {unknown} [rows] @param {"side" | "workers"} [list]
   */
  const seatsIn = (chainId, main = null, rows = null, list = "side") => seatsOfList(chainId, main, listIn(chainId, list, rows));
  /**
   * The seat a launch that names no model would take of a list's seats, for a page to name before the launch: its
   * model, and whether it is the row that stands for the main agent's. Null where no seat is free or no row can run.
   * @param {import("../../core/pool.js").Seat[]} seats @returns {{ model: string, own: boolean } | null}
   */
  const nextSeatOf = (seats) => {
    const taken = takeSeat(seats);
    return taken.ok ? { model: taken.model, own: seats.find((s) => s.model === taken.model)?.own === true } : null;
  };
  /** @param {string} chainId @param {string | null} main @param {ReturnType<typeof listIn>} l */
  const seatsOfList = (chainId, main, l) =>
    seatsOf(l.rows, {
      main: poolName(main || l.chat.main()),
      facts: factsOf,
      running: (k) => l.counted.filter((s) => seatKey(s.model) === k).length,
      key: seatKey,
    });
  /**
   * A model's facts as a seat reads them, with its slots across Filament (team_v2_plan TV2-D8).
   * @param {string} m @returns {import("../../core/pool.js").ModelFacts}
   */
  const factsOf = (m) => {
    const f = ctx?.modelFacts?.(m) || { problem: ctx?.modelProblem(m) || null, limit: null };
    return { problem: f.problem, limit: f.limit, shared: slotNow(m, f) };
  };
  /**
   * A model's slots now (core/slots.js): where its name lands, the number set there or the default, cut to a ceiling
   * its provider showed, and how many agents run on it across every chat. Null where its name lands nowhere.
   * @param {string} m @param {any} [f]  its facts, read already
   * @returns {import("../../core/slots.js").Slot | null}
   */
  const slotNow = (m, f = ctx?.modelFacts?.(m)) => {
    const at = f?.at;
    if (!at) return null;
    const s = slotOf(slotsOf(config()?.agentLoop?.subagents?.slots), at, { seen: f.seen || null, running: 0 });
    s.running = slotRunning(s.key);
    return s;
  };
  /** How many agents hold a slot of a model now, across every chat: running, started by somebody, not waiting. @param {string} key */
  const slotRunning = (key) => {
    let n = 0;
    for (const s of subs.values()) if (s.slot === key && s.status === "running" && s.origin !== "self" && !s.waiting) n++;
    return n;
  };
  /**
   * Why a model has no room for one more agent now, or null: a seat of the list where the list holds it, a slot across
   * Filament. @param {string} m @param {import("../../core/pool.js").Seat[]} seats
   */
  const roomProblem = (m, seats) => {
    const t = takeSeat(seats, { want: m, key: seatKey });
    if (!t.ok) return t.error.replace(`${poolName(m)}: `, "").replace(/\s*Wait for one to finish\.?$/, "").replace(/\.$/, "");
    const sl = slotNow(m);
    return sl && !slotFree(sl) ? slotsBusy(sl) : null;
  };
  /**
   * A card's model of its list, first choice first (the owner's words of 10-19: "a priority list … with fallback when a
   * slot isn't free or the model fails"): the first that can run and has room now, with the ones before it, each with
   * why. A lead's worker that waits for room waits on the first that can run. None: the refusal says each one's why.
   * One that started by itself takes no seat, so only whether a model can run counts for it.
   * @param {string} name @param {string[]} models @param {import("../../core/pool.js").Seat[]} seats
   * @param {{ unseated: boolean, waits: boolean }} o
   * @returns {{ ok: true, model: string, passed: { model: string, why: string }[] } | { ok: false, error: string }}
   */
  const pickCardModel = (name, models, seats, { unseated, waits }) => {
    /** @type {{ model: string, why: string }[]} */
    const passed = [];
    for (const m of models) {
      const why = ctx?.modelProblem(m) || (unseated ? null : roomProblem(m, seats));
      if (!why) return { ok: true, model: m, passed };
      passed.push({ model: m, why });
    }
    const first = waits ? models.find((m) => !ctx?.modelProblem(m)) : undefined;
    if (first) return { ok: true, model: first, passed: passed.slice(0, models.indexOf(first)) };
    const room = passed.every((p) => !ctx?.modelProblem(p.model));
    return { ok: false, error: `${name} runs on ${listed(models)}, first choice first, and none of them can take it now: ${passed.map((p) => `${p.model} — ${p.why}`).join("; ")}.${room ? " Wait for one to finish." : ""}` };
  };
  /**
   * The row of its list a sub-agent goes on to where its provider fails it now (the owner's priority list of 10-19, every
   * list since their plan of 11-05), or null: the first it was not failed on in this exchange that can run and has room
   * — a team's worker's room its team's rows' (`sa.crew`), else the list it took its seat from. None for a fork, one of
   * several launched at once (TG2-D53), one cut by a restart, nor while Filament stops or the turn that launched it has
   * closed. A coding agent's turn takes Filament's loop's place, and the other way round, only where it works in no
   * worktree: the note that tells a coding agent where its copy is was written, or left out, with its message.
   * `movesOn` and a run's host (`rateMovesOn`) both ask it (the review of e5e7a75a0): a 429 on its first call goes
   * untried only where a row will take the run.
   * @param {Subagent} sa @returns {{ model: string, named: boolean | null } | null}
   */
  const nextRow = (sa) => {
    const m = sa.models;
    if (!m || sa.fork || sa.attempt || sa.cutByRestart || stopping || sa.run?.parent?.live.closed) return null;
    const at = sa.exchanges.length - 1;
    const seats = seatsOfList(sa.chainId, m.main || null, sa.crew?.length ? listIn(sa.chainId, "workers", null, sa.crew) : listIn(sa.chainId, sa.list));
    const acp = sa.engine === "acp";
    const next = m.list.find((x) => {
      if (seatKey(x) === seatKey(sa.model) || m.failed.some((f) => f.exchange === at && seatKey(f.model) === seatKey(x))) return false;
      if (sa.work && !!ctx?.agentOf?.(x) !== acp) return false;
      return !ctx?.modelProblem(x) && !roomProblem(x, seats);
    });
    return next ? { model: next, named: seats.find((s) => s.key === seatKey(next))?.named ?? null } : null;
  };
  /**
   * The model a run its provider failed goes on to (`nextRow`), or null: a run whose list names more than one, which its
   * provider ended — never one stopped, cut, or that ran a call that may have acted (`actedBy`: a write, an edit, a
   * command, an MCP server's tool, the browser's — the reviews of e5e7a75a0 and 3664a7358), whose message sent anew
   * would do it twice.
   * The failed model is kept with why (`CardModels.failed`, `Exchange.moved`) where the run goes on.
   * The run is ready for the next try when one is given: its end is cleared, and its model, effort, slot and seat are
   * the next one's.
   * @param {Subagent} sa @param {any} run @param {AbortSignal} signal @returns {string | null}
   */
  const movesOn = (sa, run, signal) => {
    const m = sa.models;
    const fin = run.finished;
    const ex = sa.exchanges.at(-1);
    if (!m || !ex || !fin || fin.status === "done" || !fin.failure?.cause || fin.stoppedBy || run.stoppedBy || run.acted) return null;
    if (signal.aborted) return null;
    const row = nextRow(sa);
    if (!row) return null;
    const next = row.model;
    const at = sa.exchanges.length - 1;
    const said = providerOf(sa, /** @type {any} */ ({ ok: false, failure: fin.failure, stoppedBy: null }));
    const why = said ? said.cause : String(fin.error || "its provider failed");
    (ex.moved ??= []).push({ model: sa.model, why, runId: ex.runId });
    m.failed.push({ model: sa.model, why, exchange: at });
    // Its effort there: the one picked over every row's, else that row's own, else the main agent's on that model (the
    // review of 11-05); a run kept from before its launch kept them (`modelsKept`) moves at its own.
    const doc = m.named !== undefined ? settingsOf(sa.chainId).doc : null;
    const level = m.named !== undefined ? m.named || m.efforts?.[next] || null : null;
    const inherited = doc && !level ? mainEffortIn(doc, doc?.model?.name || ctx?.session(sa.chainId)?.model, next) : null;
    const wanted = doc ? level || inherited?.level || "model" : m.effort;
    const asked = doc ? !!level || !!inherited?.asked : m.asked;
    const ran = ctx?.effortOf ? ctx.effortOf(next, wanted === "model" ? null : wanted, asked) : null;
    log("info", `sub-agent ${sa.id}: ${sa.model} failed (${why}); it goes on to its list's next model, ${next}`);
    m.effort = wanted;
    sa.model = next;
    sa.effort = ran ? { level: ran.level, wanted, levels: ran.levels, spelled: ran.spelled } : null;
    sa.wire = ran && ran.wire !== next ? ran.wire : null;
    sa.slot = slotNow(next)?.key ?? null;
    sa.engine = ctx?.agentOf?.(next) ? "acp" : "loop";
    // Its seat is the row it goes on to: one its list names, or not; the rows its launch passed are behind it.
    if (sa.seat) sa.seat = { ...sa.seat, named: row.named ?? sa.seat.named, skipped: [] };
    run.finished = null;
    run.toolCalls = 0;
    changed(sa);
    toParent(sa, { type: "subagent-moved", agentId: sa.id, exchange: at, model: next, from: ex.moved.at(-1)?.model, why });
    return next;
  };
  /**
   * The workers waiting for room (team_v2_plan §5.7), first come first: each starts once its model's slots and its
   * chat's list have room. By id, each with its start.
   * @type {Map<string, () => void>}
   */
  const waiters = new Map();
  /** The look again while workers wait: a provider's lower ceiling lifts with time, and a setting may change. */
  let waitLook = /** @type {ReturnType<typeof setInterval> | null} */ (null);
  /** Whether a waiting worker has its room now. @param {Subagent} sa */
  const hasRoom = (sa) => {
    const w = sa.waiting;
    if (!w) return true;
    if (!slotFree(slotNow(sa.model))) return false;
    const c = ceilingOf(sa.chainId, null, sa.list, w.rows, sa.model);
    return c.running < c.max && takeSeat(c.seats, { want: sa.model, key: seatKey }).ok;
  };
  /** What a waiting worker waits for now, in words: its model's slots where they are what is busy, else why it waited. @param {Subagent} sa */
  const waitingWords = (sa) => {
    const s = slotNow(sa.model);
    return s && !slotFree(s) ? `${sa.model}, ${slotWords(s, now())}` : String(sa.waiting?.why || "").replace(/\s*Wait for one to (?:finish|report)\.?\s*$/, "").replace(/\.$/, "");
  };
  /** Start each waiting worker that has its room now, in the order they came; look again while any waits. */
  const pumpSlots = () => {
    for (const [id, go] of [...waiters]) {
      const sa = subs.get(id);
      if (!sa || sa.status !== "running") waiters.delete(id);
      else if (hasRoom(sa)) go();
    }
    if (waiters.size && !waitLook) {
      waitLook = setInterval(pumpSlots, SLOT_LOOK_MS);
      waitLook.unref?.();
    } else if (!waiters.size && waitLook) {
      clearInterval(waitLook);
      waitLook = null;
    }
  };
  /**
   * A waiting worker's start: resolved once it has its room, refused by a stop meanwhile, which ends it as a stop
   * before it started.
   * @param {Subagent} sa @returns {Promise<void>}
   */
  const turnFor = (sa) =>
    new Promise((resolve, reject) => {
      const signal = sa.run?.abort.signal;
      const stop = () => {
        waiters.delete(sa.id);
        reject(Object.assign(new Error("stopped while it waited for a slot"), { name: "AbortError" }));
      };
      if (signal?.aborted) return stop();
      signal?.addEventListener("abort", stop, { once: true });
      waiters.set(sa.id, () => {
        signal?.removeEventListener("abort", stop);
        waiters.delete(sa.id);
        sa.waiting = null;
        changed(sa);
        resolve();
      });
      pumpSlots();
    });
  /**
   * What a launch or a going on that waits for its room (§5.7) answers of it, null for one that starts at once: what it
   * waits for, in words, and `room`, which settles as the wait ends — true once it has its room and starts (`had`),
   * false where its exchange ended first, a stop while it waited (`endsWith`).
   * @param {Subagent} sa
   * @returns {{ words: string, room: Promise<boolean>, had: () => void, endsWith: (done: Promise<unknown>) => void } | null}
   */
  const roomOf = (sa) => {
    if (!sa.waiting) return null;
    /** @type {(had: boolean) => void} */
    let settle = () => {};
    const room = new Promise((resolve) => (settle = resolve));
    return { words: waitingWords(sa), room, had: () => settle(true), endsWith: (done) => void done.then(() => settle(false), () => settle(false)) };
  };
  /**
   * How many exchanges a session may run at once on one of its lists — what its rows lend now, Infinity where a row's
   * model has no limit (the owner's word of 11-05: no number per chat) — how many run, and the rows.
   * @param {string} chainId @param {string | null} [main] @param {"side" | "workers"} [list]
   * @param {import("../../core/pool.js").PoolRow[] | null} [team]  a team's own models (`listIn`)
   * @param {string | readonly string[]} [also]  the model a launch would run on, or the models several would (`outsideTotal`)
   * @param {ChatReading} [reading]  the chat as the asker read it already
   */
  const ceilingOf = (chainId, main = null, list = "side", team = null, also = /** @type {string | readonly string[]} */ (""), reading = chatOf(chainId)) => {
    const l = listIn(chainId, list, null, team, reading);
    const seats = seatsOfList(chainId, main, l);
    const max = poolTotal(seats) + outsideTotal(chainId, main, l, seats, also);
    return { max, running: l.counted.length, seats, which: l.which, counted: l.counted };
  };
  /**
   * What the models a list does not hold lend (the owner's of 10-29: Hunters on GLM-5.3 stopped at the four of the
   * chat's one model, though GLM-5.3 took 16): each that an agent counted in the list runs on, and `also`, the one a
   * launch would run on (or the models several would), each as a row of its own would — so an agent there is held by
   * its model's slots, never by the room of the list's models.
   * @param {string} chainId @param {string | null} main @param {ReturnType<typeof listIn>} l
   * @param {import("../../core/pool.js").Seat[]} seats  the list's @param {string | readonly string[]} also
   */
  const outsideTotal = (chainId, main, l, seats, also) => {
    const keys = new Set(seats.map((s) => s.key));
    /** @type {import("../../core/pool.js").PoolRow[]} */
    const rows = [];
    for (const m of [...l.counted.map((s) => s.model), ...(typeof also === "string" ? [also] : also)]) {
      const name = poolName(m);
      if (!name || keys.has(seatKey(name))) continue;
      keys.add(seatKey(name));
      rows.push({ model: name, seats: Infinity });
    }
    return rows.length ? poolTotal(seatsOfList(chainId, main, { ...l, rows })) : 0;
  };
  /** A list's name in a refusal's words: a team's own models, else the pool. @param {"side" | "workers"} which */
  const listName = (which) => (which === "workers" ? "your team's models" : "the pool");
  /** The same as a seat's refusal says it (core/pool.js `takeSeat`). @param {"side" | "workers"} which */
  const seatsOfWords = (which) => (which === "workers" ? "your team's models" : "this session's pool");
  /**
   * The model an agent that takes no seat runs on where neither its launch nor its card names one (one that started
   * by itself, AG-239; Enhance): the pool's first row that can run — with the effort it says (the review of 11-05) —,
   * else the main agent's.
   * @param {string} chainId @param {string | null} [main] @returns {{ model: string, effort: string | null }}
   */
  const unseatedSeat = (chainId, main = null) => {
    const s = seatsIn(chainId, main).find((x) => x.model && !x.problem);
    return s ? { model: s.model, effort: s.effort } : { model: poolName(main || ctx?.session(chainId)?.model), effort: null };
  };
  /** @param {string} chainId @param {string | null} [main] */
  const unseatedModel = (chainId, main = null) => unseatedSeat(chainId, main).model;
  /**
   * Why a session may not start another exchange now, or null: the limit, and what to do — wait (V4-D284). `agent`:
   * the session's agent reads it, so it waits for a report, and the refusal says which of the running ones are the
   * developer's own, whose answers never come to it (AG-49). The developer reads the other: they wait for one to finish.
   * A pool none of whose models can run an agent says that, each with why. A model that lends fewer seats for a
   * while is named after the limit, so the count's change has its reason.
   * `also`: the model the launch runs on, where it is known (`outsideTotal`).
   * @param {string} chainId @param {boolean} [agent] @param {string | null} [main]
   */
  const ceilingProblem = (chainId, agent = false, main = null, list = /** @type {"side" | "workers"} */ ("side"), team = /** @type {import("../../core/pool.js").PoolRow[] | null} */ (null), also = "") => {
    const { max, running, seats, counted } = ceilingOf(chainId, main, list, team, also);
    if (running < max) return null;
    if (!max) {
      const none = takeSeat(seats, { key: seatKey });
      if (!none.ok) return none.error;
    }
    const theirs = agent ? counted.filter((s) => s.aside).length : 0;
    return `The limit is ${max} at once, and ${running} ${running === 1 ? "is" : "are"} running${theirs ? `, ${theirs} of them the developer's own` : ""}. Wait for one to ${agent && !theirs ? "report" : "finish"}.${poolNote(seats, now())}`;
  };
  /**
   * Why a sub-agent cannot go on now though the session has room, or null: it goes on on its own model, and that
   * model's seats in the session's pool are all taken (HarnessV4_Tasks E15 step 8, case 8).
   * @param {Subagent} sa
   */
  const seatProblem = (sa) => {
    const t = takeSeat(seatsIn(sa.chainId, null, null, sa.list), { want: sa.model, who: sa.card.name, key: seatKey });
    return t.ok ? null : t.error;
  };
  /**
   * The count a launch's result ends with (V4-D284): how many run, and how many wait for a slot — no "of" and no room
   * left, as Filament caps nothing of its own (the owner's word of 11-05). `live`: the turn that reads it — its own foreground launches are left out, since its reply's results are read only
   * once each of them has answered (AG-48).
   * `list`: the one the reader launches on — a team's lead's, its workers' (HarnessV4_Tasks E23-D6).
   * @param {string} chainId @param {LiveTurn | null} [live] @param {"side" | "workers"} [list]
   */
  const standingOf = (chainId, live = null, list = "side") => {
    const { counted } = ceilingOf(chainId, null, list);
    const running = counted.filter((s) => !(live && !s.background && s.run?.parent?.live === live)).length;
    // Who waits for a slot of its model (§5.7).
    const waiting = [...subs.values()].filter((s) => s.chainId === chainId && s.status === "running" && s.waiting).length;
    return `${running} running${waiting ? `, ${waiting} waiting for a slot` : ""}.`;
  };
  /**
   * The saved agents a session's main agent may ask (its `subagents.ask`, HarnessV4_Tasks E15 step 3): those of the
   * list whose card exists, in the list's order, each once.
   * @param {string} chainId @returns {import("./tools.js").Askable[]}
   */
  const asksOf = (chainId) =>
    askablesOf(settingsOf(chainId).sub.ask, (tag) => {
      const c = ctx?.card?.(tag);
      return reachable(chainId, c) ? c : null;
    });
  /**
   * Whether a card may be asked in a session: a plugin's agent (HarnessV4_SpacesPlugins_Plan B3) only where its plugin
   * is on; every other card anywhere.
   * @param {string} chainId @param {import("../../services/agent-cards.js").AgentCard | null | undefined} c
   */
  const reachable = (chainId, c) => !c?.plugin || (ctx?.settings?.(chainId)?.plugins?.on || []).some((/** @type {any} */ p) => p?.id === c.plugin);
  /**
   * The saved agent an agent's call names in `saved_agent` (the owner's words of 10-19: "the main agent spawns these
   * when asked in plain words"), by its tag or its name — or null where the call names none. Refused in words: one
   * nobody made, one that starts by itself, and one the developer's newest message does not name, unless the session
   * names it for its agent already.
   * @param {string} chainId @param {unknown} text @returns {import("../../services/agent-cards.js").AgentCard | null}
   */
  const savedNamed = (chainId, text) => {
    const t = String(text ?? "").trim().replace(/^@/, "");
    if (!t) return null;
    const all = ctx?.cards?.() || [];
    const card = all.find((c) => c.tag === t.toLowerCase()) || all.find((c) => c.name.toLowerCase() === t.toLowerCase()) || null;
    if (!card) throw new Error(`there is no saved agent “${t}” — the developer's agents are on ${agentsPage(config())}; give its name or tag as their message says it`);
    if (card.partOf) throw new Error(partOfWords(card));
    if (!reachable(chainId, card)) throw new Error(`${card.name} comes with the plugin ${card.plugin}, which is not on in this chat — the developer turns it on on its sheet in Library › Plugins & Connectors, or in the Space`);
    if (asksOf(chainId).some((a) => a.tag === card.tag) || chainState(chainId).said.has(card.tag)) return card;
    throw new Error(`the developer's newest message does not name ${card.name}: use it where their message asks for it by its name — or they let you use it on your own, on ${agentsPage(config())}`);
  };
  /** What a coding agent reads when it asks for a fork: there is no request of Filament's to copy. */
  const NO_FORK = `a fork copies Filament's own request to its model, and your session has none — leave context out, or choose ${Object.keys(SUBAGENT_VIEWS)
    .filter((v) => v !== "fork")
    .join(", ")}`;
  /** A card by its tag: the store's — yours and the shipped ones — or, where no store is wired, a shipped one. @param {string} tag */
  const cardOf = (tag) => ctx?.card?.(tag) || shippedCard(tag);
  /** What a card that may not do everything is said to do, where a call asks it for more. */
  const MAY_ONLY = Object.freeze({ read: "only reads", copy: "runs in its own copy of the project and keeps nothing" });
  /**
   * What an agent reads when the kind it names is neither a worker it may launch nor an agent it may ask (AG-50).
   * @param {string} kind @param {readonly import("./tools.js").Askable[]} named
   * @param {readonly { tag: string }[] | null} [roster]  a team's lead asks: its team's members
   */
  const notAskable = (kind, named, roster = null) => {
    const kinds = launchKinds(named);
    const asks = kinds.named;
    const tags = (roster || []).map((m) => m.tag).join(", ");
    const own = !roster ? `launch a ${kinds.own.map((o) => o.tag).join(" or a ")} sub-agent` : isShippedRoster(roster) ? `launch a worker in a role (${tags})` : `launch one of your team's workers (${tags})`;
    // A card Filament does not ship, where no card of the person's holds its tag, says first which card does its work.
    const folded = cardOf(String(kind).toLowerCase()) ? null : foldedCard(kind);
    const was = folded ? `${folded.name} is now part of ${folded.into}. ` : "";
    return asks.length
      ? `${was}\`${kind}\` is not one you may ask. This session's agent may ask: ${asks.map((a) => `\`${a.tag}\` (${a.name})`).join(", ")} — or ${own}.`
      : `${was}\`${kind}\` names nothing you can launch: the developer named no saved agent this session's agent may ask. You can ${own}.`;
  };

  /**
   * The model a launch names as a person says it, at the provider it names (HarnessV4_Tasks E23-D1 to D3): the name as
   * Filament routes it, with the launch's words on the choice, or why it cannot run. Where nothing matches names, a name
   * runs as given. `prefer`: the account first where several serve it.
   * `within`: a list's rows alone — with no choice of Filament's to ask, a row named as it is written.
   * @param {string} name @param {string | null} provider @param {string | null} [prefer] @param {readonly string[] | null} [within]
   * @returns {Promise<import("../../core/model-choice.js").Choice>}
   */
  const chooseModel = async (name, provider, prefer = null, within = null) => {
    if (ctx?.chooseModel) return ctx.chooseModel(name, provider, prefer, within);
    if (!within) return { ok: true, model: poolName(name), upstream: "", note: "" };
    const row = within.find((m) => m.toLowerCase() === poolName(name).toLowerCase());
    return row ? { ok: true, model: row, upstream: "", note: "", rows: [row] } : { ok: false, error: `"${name}" is none of the list's models`, off: true };
  };
  /**
   * The account a model named alone runs on first (the owner's of 11-06): the coding agent's the chat's agent runs on —
   * the model it launches from (`model`), else its chat's — where it serves the model named; null where that is no
   * coding agent's.
   * @param {{ model?: string | null, chainId?: string | null }} at @returns {string | null}
   */
  const preferFor = (at) => {
    const main = String(at.model || (at.chainId ? ctx?.session?.(at.chainId)?.model : "") || "");
    return main ? ctx?.agentOf?.(main) || null : null;
  };
  /**
   * A launch's own fields for the model and the effort a launcher names (E23): `model` and `chose` where it names a
   * model or a provider, `effort` where it names one — or why that model cannot run, in the choice's words. Every
   * launcher reads its names through it: the agent tool in each seat, `/subagent`. `prefer`: the account the chat's agent
   * runs on, first where several serve the model named and no provider is (the owner's of 11-06).
   * @param {{ model?: unknown, provider?: unknown, effort?: unknown }} input @param {string | null} [prefer]
   * @returns {Promise<{ ok: true, fields: { model?: string, chose?: string, effort?: string } } | { ok: false, error: string }>}
   */
  const choice = async (input, prefer = null) => {
    const said = String(input?.model ?? "").trim();
    const at = String(input?.provider ?? "").trim();
    const effort = String(input?.effort ?? "").trim();
    /** @type {{ model?: string, chose?: string, effort?: string }} */
    const fields = effort ? { effort } : {};
    if (!said && !at) return { ok: true, fields };
    const c = await chooseModel(said, at || null, prefer);
    return c.ok ? { ok: true, fields: { ...fields, model: c.model, chose: c.note } } : { ok: false, error: c.error };
  };
  /**
   * The list a card's launch that names no model runs from, where the person set it (the owner's of 11-19: "when i
   * explicitly already setup an order along with account and effort then why the id was even needed and passed"): this
   * chat's rows for the card, else the card's own models, else this chat's list for agents — set in this chat, its
   * project or Settings; never Filament's own (the main agent's model alone, `DEFAULT_POOL`), nor one whose source is
   * not known. Each row by its model — the nameless one's the main agent's, `main` — at the effort its first row says;
   * `words`, the list as an agent is told it. Null where the person set none.
   * @param {string} chainId @param {any} card @param {string | null} main
   * @returns {{ rows: { model: string, effort: string | null }[], words: string } | null}
   */
  const boundListOf = (chainId, card, main) => {
    const { doc, sub } = settingsOf(chainId);
    /** @param {{ models: string[], efforts: Record<string, string> } | null} l @param {string} words */
    const of = (l, words) => (l?.models.length ? { rows: l.models.map((m) => ({ model: m, effort: l.efforts[m] || null })), words } : null);
    const own = card ? of(chatRowsOf(byCardIn(doc, card.tag), main), `this chat's models for ${card.name}`) : null;
    if (own) return own;
    const models = card ? modelsOfCard(card) : [];
    if (models.length) return of({ models, efforts: card.efforts || {} }, `${card.name}'s card`);
    const from = ctx?.settingFrom?.(chainId, "subagents.pool") ?? null;
    if (from !== "session" && from !== "project" && from !== "global") return null;
    // A list kept as Filament's own default is — the main agent's model alone, at no effort of its own — says nothing
    // the person chose (the review of 11-19: the list's editor can write it so).
    const rows = Array.isArray(sub.pool) ? sub.pool : [];
    if (rows.length === 1 && !poolName(rows[0]?.model) && !rows[0]?.effort) return null;
    return of(chatRowsOf(sub.pool, main), "this chat's list for agents");
  };
  /**
   * An agent's own launch's fields (the owner's of 11-19): where the person set the list it runs from (`boundListOf`),
   * a model or provider it names picks rows of that list alone — matched within them, the first that can run and the
   * others that serve that model behind it (`among`), at their effort. Where the person set an effort on those rows, it
   * is theirs: one named that is it says nothing, and another is refused (the review of 11-19: a named effort rode the
   * rows that set none). A model off the list is refused in words that say the list. Where the person set none, `choice`.
   * @param {string} chainId @param {any} input @param {{ card: any, model: string | null }} at
   * @returns {Promise<{ ok: true, fields: { model?: string, chose?: string, effort?: string, among?: { model: string, effort: string | null }[] } } | { ok: false, error: string }>}
   */
  const agentChoice = async (chainId, input, { card, model }) => {
    const bound = boundListOf(chainId, card, model);
    if (!bound) return choice(input, preferFor({ model, chainId }));
    const said = String(input?.model ?? "").trim();
    const at = String(input?.provider ?? "").trim();
    const effort = String(input?.effort ?? "").trim().toLowerCase();
    const list = `${bound.words}, which the person set: ${bound.rows.map((r) => `${r.model}${r.effort ? ` at ${r.effort}` : ""}`).join(", then ")}`;
    let rows = bound.rows;
    /** @type {{ model?: string, chose?: string, among?: { model: string, effort: string | null }[] }} */
    let named = {};
    if (said || at) {
      const c = await chooseModel(said, at || null, null, bound.rows.map((r) => r.model));
      if (!c.ok) return { ok: false, error: c.off ? `${said ? `"${said}"` : at} is not on ${list}. Leave model out to run on it; a model off the list is the person's to add` : c.error };
      // In the choice's order: those that can run first, the rest kept behind for the fallback.
      rows = (c.rows || [c.model]).flatMap((m) => bound.rows.filter((r) => r.model.toLowerCase() === m.toLowerCase()).slice(0, 1));
      named = { model: c.model, chose: c.note, among: rows };
    }
    const theirs = [...new Set(rows.map((r) => r.effort).filter(Boolean))];
    if (effort && theirs.length) {
      if (theirs.length === 1 && theirs[0] === effort) return { ok: true, fields: named };
      return { ok: false, error: theirs.length === 1 ? `effort ${effort} is not the person's: ${list}. Leave effort out` : `each row runs at the effort the person set for it: ${list}. Leave effort out` };
    }
    return { ok: true, fields: { ...(effort ? { effort } : {}), ...named } };
  };
  /**
   * A model's room in the chat's list, in words, for the list a launcher reads (E23-D4): "on the chat's list, 3 of 4
   * free" — its slots across Filament, cut to what its provider takes now; "" where the list does not name it.
   * @param {string} chainId @returns {(model: string) => string}
   */
  const seatWordsOf = (chainId) => {
    const seats = seatsIn(chainId, null, null, "side");
    return (model) => {
      const s = seats.find((x) => x.key === seatKey(model));
      if (!s) return "";
      // A model with no limit set and none shown by its provider: nothing holds it.
      const of = s.shared ? Math.min(s.lent, s.shared.cap) : s.lent;
      if (!s.problem && !Number.isFinite(of)) return "on the chat's list";
      const free = Math.max(0, Math.min(s.lent - s.running, s.shared ? s.shared.cap - s.shared.running : Infinity));
      return `on the chat's list, ${free} of ${of} free`;
    };
  };
  /**
   * The models a sub-agent can run on, as a launcher reads them (E23-D4), each with its seats in the session's lists.
   * @param {string} chainId @param {{ model?: string | null, provider?: string | null }} ask
   */
  const modelsText = async (chainId, ask) => (ctx?.modelList ? ctx.modelList(ask, seatWordsOf(chainId)) : "Filament cannot list its models here: name the model as Filament lists it.");
  /** The batch of the launches asked in this synchronous pass, while it lasts (`passBatch`). */
  let pass = "";
  /**
   * The batch of the launches asked in this synchronous pass (Phase 0 of the owner's 11-09 plan for big repos): attempts
   * and a task graph's side run launch several at once, which share one snapshot of the folder (worktree.js
   * `openTaskWorktree`). A pass ends with the code that asked, before anything else runs.
   */
  const passBatch = () => {
    if (!pass) {
      pass = `pass-${randomBytes(6).toString("hex")}`;
      queueMicrotask(() => (pass = ""));
    }
    return pass;
  };

  /**
   * Launch a sub-agent. Refused in words when the task is empty, the model cannot run one, or the session already runs
   * as many as it allows. It answers at once, so a launcher marks what it launched in the same step — the graph's runner
   * marks its task running before anything else can start it again. `tree`: whether it works in a worktree of its own,
   * known a moment later, once its first message is made — a folder with no repository to copy has it share the folder
   * after all (`shares`). `waiting` and `room`: one that waits for its room (`waits`) — what it waits for, and when it
   * has it (`roomOf`). `unchecked`: a team's member that changes files went without its team's check, which this session
   * does not let Filament run — the check, and why, in its lead's words (the plan's p6, grants.js `teamCheckWhy`).
   * `workspace`: where its launch chose it works (workspace-kind.js, 11-09) — "none" for one that changes nothing.
   * @param {LaunchSpec} spec
   * @returns {{ ok: true, id: string, done: Promise<Outcome>, tree: Promise<boolean>, workspace?: "none" | "folder" | "patch" | "worktree", waiting?: string, room?: Promise<boolean>, unchecked?: { check: string, why: string }, dry?: { model: string, ownTree: boolean } } | { ok: false, error: string }}
   */
  function launch(spec) {
    const chainId = String(spec.chainId || "");
    const parent = spec.lead ? leadParent(chainId, spec.lead) : spec.parent || null;
    if (spec.lead && !parent) return { ok: false, error: `the lead's turn ${spec.lead.runId} is not running in this session` };
    // The lead's turn this launch is counted by (the plan's p6): a team has no total of launches since 11-05.
    const counts = countedBy(chainId, spec, parent);
    const prompt = String(spec.prompt || "").trim();
    if (!prompt) return { ok: false, error: "a sub-agent needs a task — the whole of it, since it sees nothing of your conversation unless a view is given" };
    const hunts = spec.hunts == null || spec.hunts === "" ? null : String(spec.hunts).trim();
    if (hunts !== null && !TASK_ID.test(hunts)) return { ok: false, error: `hunts names the graph task a bug hunt looks in, by its id like t1 — not "${hunts}"` };
    // The task it is fired from, as the session's graph holds it (11-02): its report names it, and a task its finding
    // names hangs off it. A graph that holds no such task, or holds it not done, fires none — the runner says why.
    const hunted = hunts !== null && ctx?.huntedTask ? ctx.huntedTask(chainId, hunts) : null;
    if (hunted && "error" in hunted) return { ok: false, error: hunted.error };
    const { sub, doc } = settingsOf(chainId);
    const session = ctx?.session(chainId) || null;
    const team = spec.team || null;
    const task = spec.task || null;
    const developer = spec.origin !== "agent";
    // Everything launched runs as a card (HarnessV4_Tasks E15): the card says what it sees, the model it runs on, what
    // it may do and how it thinks, each field the launch names itself winning. Asked by its tag (`as`), it answers
    // whoever asked (AG-79); else it is a worker — a team's member by its role, the one the launch names, or Builder —
    // and `builder` and `reviewer` are whoever holds those places in the session (AG-80).
    const named = asksOf(chainId);
    const tag = String(spec.as ?? "").trim().replace(/^@/, "").toLowerCase();
    // A saved agent the developer's newest message names in plain words (`heard`, the owner's 10-19 list), where the
    // agent's call names it so (`saved_agent`): asked or sent as its card says, its session naming it or not.
    const heardOf = spec.said === true && spec.origin === "agent" && !spec.lead ? chainState(chainId).said : null;
    // The session's agent calls only the agents its session names (V4-D288), and so does a team's lead, as its tool
    // lists them beside its own crew.
    if (tag && !developer && !heardOf?.has(tag) && !named.some((a) => a.tag === tag)) return { ok: false, error: notAskable(tag, named, spec.roster) };
    const word = String(spec.worker ?? "").trim().replace(/^@/, "").toLowerCase();
    // A team's member runs as its card, whatever the id its lead names it by.
    const workerTag = tag ? null : team ? (team.card ?? team.role) : (workerFor(named, word) ?? (developer || heardOf?.has(word) ? word : null));
    if (!tag && workerTag == null) return { ok: false, error: named.some((a) => a.tag === word) ? `\`${word}\` is asked by its tag (\`as\`), not launched in Builder's or Reviewer's place` : notAskable(word, named, spec.roster) };
    const card = cardOf(tag || String(workerTag));
    if (!card) {
      const gone = tag || String(workerTag);
      const folded = foldedWords(gone, (into) => `launch ${into} in its place`);
      return { ok: false, error: folded ? `there is no agent \`@${gone}\` — ${folded}` : tag ? `there is no agent \`@${tag}\` — ${agentsPage(config())} lists them` : `there is no worker \`${word}\` — Library › Agents and teams lists them` };
    }
    // A team's own Lead is its team's (OA-D4): its team starts it, never a launch by its tag or in a worker's place.
    if (card.partOf && !team) return { ok: false, error: partOfWords(card) };
    const asked = !!tag;
    if (asked && spec.start) return { ok: false, error: `a launch names a start or an agent, not both: ${card.name}'s card says what it sees and may do` };
    // One kind of agent (HarnessV4_OneAgent_Plan OA1): what it may do is its card's level, the only limit. A call may
    // lower it, never raise it (AG-8); a question gets an answer because it is a question, not by a rule.
    const mayAsked = spec.may == null || spec.may === "" ? null : String(spec.may);
    const may = /** @type {Subagent["may"]} */ (mayAsked ?? card.may);
    if (!mayLower(card.may, may))
      return { ok: false, error: CARD_MAY.includes(may) ? `${card.name} ${/** @type {Record<string, string>} */ (MAY_ONLY)[card.may]}, as its card says` : `may must be one of ${CARD_MAY.join(", ")}` };
    // What it sees is its launch's choice, else its card's: nothing of the session unless one asks. A team's worker
    // starts from its brief: never a fork. A graph task under the session's agent starts as one where its runner asks
    // (the owner's words of 10-26: the planner's conversation, read from the provider's cache). Any other agent may start
    // as one where its launch says so (one kind of agent, OA1): its card's words ride ahead of its task.
    const views = Object.keys(SUBAGENT_VIEWS).filter((v) => !team || v !== "fork");
    if (team && spec.view === "fork")
      return { ok: false, error: `a worker cannot be a fork: it starts from its brief — leave context out, or choose ${views.slice(0, -1).join(", ")} or ${views.at(-1)}` };
    // One that starts as a live copy while the cache is warm (Catch me up) is a fork only where one pays now.
    const warm = spec.warm === true && !team && !spec.model && !spec.effort ? warmFork(chainId, parent, doc) : null;
    const view = warm ? "fork" : String(spec.view ?? card.sees.view);
    if (!views.includes(view)) return { ok: false, error: `view must be one of ${views.join(", ")}` };
    // A fork copies the main agent's request as it stands, and its model with it: the cache it reads is that model's.
    const base = warm || (view === "fork" ? forkSource(chainId, parent) : null);
    if (base && !base.ok) return { ok: false, error: base.error };
    const forkBody = base && base.ok ? base.body : null;
    const forkFrom = base && base.ok ? base.from : "turn";
    // The effort it runs at (HarnessV4_Tasks E23-D5): the launch's, else its row's, else the main agent's (11-05).
    // A fork runs as the main agent's request does, its effort with it: one asked at the level that request went at forks
    // all the same (the review of a8e034ded: a side run's pick of it lost its task the fork) — the level its model's name
    // spells, as the turn sent it, else the main agent's (the review of 5b35e53aa: the chat's setting may have moved since).
    const effortAsked = spec.effort == null || String(spec.effort).trim() === "" ? null : String(spec.effort).trim().toLowerCase();
    if (effortAsked && !SUBAGENT_EFFORTS.includes(effortAsked)) return { ok: false, error: `effort must be one of ${SUBAGENT_EFFORTS.join(", ")}` };
    const forkLevel = () => {
      const sent = forkBody && ctx?.effortOf ? ctx.effortOf(String(forkBody.model || ""), null, false) : null;
      return sent?.spelled && sent.level ? sent.level : mainEffortIn(doc, doc?.model?.name || session?.model || forkBody?.model).level;
    };
    if (effortAsked && forkBody && effortAsked !== forkLevel()) return { ok: false, error: "a fork runs as the main agent's request does, its effort with it — leave effort out, or choose another view" };
    // Its list (E23-D6): a team's worker and a graph task take their seats from the workers', every other one from the pool
    // — a graph task under the session's agent on the planner's own model alone (`ownRows` below).
    const list = team || task ? "workers" : "side";
    // A model the agent named of the list the person set (the owner's of 11-19): the rows that serve it, run as a card's
    // models are below — the first with room, at its row's effort, a failure moving down them.
    const among = !team && !task && Array.isArray(spec.among) ? spec.among.map((r) => ({ model: poolName(r?.model), effort: r?.effort ? String(r.effort) : null })).filter((r) => r.model) : [];
    const wanted = among.length ? "" : poolName(spec.model);
    // Its model: the launch's, else its card's, else the first free seat of the session's pool (AG-233). A fork's is
    // the main agent's, whose seat it takes (AG-237). One that started by itself takes no seat (AG-203, AG-239).
    const forkModel = forkBody ? String(forkBody.model || "") : "";
    if (forkBody && wanted && seatKey(wanted) !== seatKey(forkModel)) return { ok: false, error: `a fork runs on the main agent's model (${forkModel}), whose cache it reads — leave the model out, or choose another view` };
    // A fork carries the main agent's conversation into every round of its own, so it starts only where that is at most
    // half its own line (`forkLineOf` the window it keeps, the assumed one where none is known), as a graph task's fork
    // is weighed (`forkPays`).
    if (base?.ok) {
      const forkLine = forkLineOf(sessionWindowFor(config(), forkModel, doc?.model?.window).tokens);
      if (base.tokens > forkLine / 2)
        return { ok: false, error: `the main agent's conversation is ${base.tokens.toLocaleString()} tokens, past half a fork's ${forkLine.toLocaleString()}-token compaction line: a fork would carry all of it into every round and compact almost at once — choose folded or none, and put what it needs in the task` };
    }
    const main = forkModel || spec.parentModel || null;
    const unseated = spec.origin === "self";
    // A second look (S3b) is Filament's start too: on a move that asks, for the person who answers it. So is a fork
    // that weighs the person's message aside (the owner's forked steer of 11-04).
    const second = unseated && spec.second === true;
    const weighs = unseated && forkBody && typeof spec.weighs === "string" && spec.weighs ? spec.weighs : null;
    // A team that names its workers' models runs them there, in order (team_v2_plan TV2-D8).
    const teamRows = team && Array.isArray(spec.rows) && spec.rows.length ? spec.rows : null;
    // The model the team runs this member on, where its launch names none: before the team's models and its card's.
    const memberModel = team && !wanted && !forkModel ? poolName(team.model) : "";
    // A graph task under the session's agent, and its review, run on the planner's own model (the owner's word of 10-26:
    // the agent that planned the work does it side by side, never a model of the chat's list or of a card): its one row
    // stands for the main agent's model, its room that model's slots. A team's crew keeps its team's models.
    const ownRows = teamRows || (task && !team ? PLANNER_ROWS : null);
    // A lead's worker waits for room where another launch is refused (§5.7): why, where it waits. So does a flow's box,
    // which never fails for want of a seat (HarnessV4_Flow_Plan FL-D20), and a graph task's worker or its reader, whose
    // task waits with it rather than failing (the bug hunt of 10-30, SUB-3).
    const waits = spec.waits === true && (!!team || !!task || spec.origin === "flow") && !unseated && !forkBody;
    const inList = unseated ? null : listIn(chainId, list, null, ownRows);
    const seats = inList ? seatsOfList(chainId, main, inList) : [];
    // A card's models, first choice first (the owner's list of 10-19): the first that can run and has room now, the ones
    // before it passed with why. One model is the card's as ever: its refusals below say why it cannot. A team's own
    // models, or a Brief's pick, come before a member's card (U13-D8); the model the team names for the member before
    // either, as one model.
    // This chat's own rows for its card (the owner's plan of 11-05), in its place: where its launch, its team and a Brief
    // name none. A model its launch names that the list holds runs at that row's effort (the review of 11-05). A row that
    // names none is the main agent's model — a coding agent's too (the owner's of 11-06).
    const chatCard = forkModel || memberModel || ownRows || among.length ? null : chatRowsOf(byCardIn(doc, card.tag), spec.parentModel || doc?.model?.name || session?.model);
    const amongList = among.length ? { models: among.map((r) => r.model), efforts: Object.fromEntries(among.flatMap((r) => (r.effort ? [[r.model, r.effort]] : []))) } : null;
    const cardList = forkModel || memberModel || ownRows ? null : amongList || chatCard || { models: modelsOfCard(card), efforts: /** @type {Record<string, string>} */ (card?.efforts || {}) };
    const cardModels = forkModel || wanted ? [] : memberModel ? [memberModel] : cardList?.models || [];
    const picked = cardModels.length > 1 ? pickCardModel(among.length ? "The model named" : card.name, cardModels, seats, { unseated, waits }) : null;
    if (picked && !picked.ok) return { ok: false, error: picked.error };
    const own = forkModel || wanted || (picked?.ok ? picked.model : "") || cardModels[0] || "";
    /** @type {string | null} */
    let busy = null;
    if (!own && !unseated) {
      const full = ceilingProblem(chainId, spec.origin === "agent", main, list, ownRows);
      if (full && !waits) return { ok: false, error: full };
      busy = full;
    }
    if (forkBody && !unseated) {
      const s = seats.find((x) => x.key === seatKey(forkModel));
      if (!s) return { ok: false, error: `a fork runs on the main agent's model (${forkModel}), and this session's pool gives it no seat — add it to the pool, or choose another view` };
      if (!s.problem && !seatFree(s))
        return { ok: false, error: `a fork runs on the main agent's model (${forkModel}), and ${s.running < s.lent ? slotsBusy(/** @type {import("../../core/slots.js").Slot} */ (s.shared)) : `${s.running} ${s.running === 1 ? "runs" : "run"} on it, as many as it takes at once now`} — wait for one to finish, or choose another view` };
    }
    // One that takes no seat runs on its list's first row that can run, at that row's effort.
    const freeRow = unseated && !own ? unseatedSeat(chainId, main) : null;
    let taken = unseated
      ? { ok: /** @type {const} */ (true), model: own || freeRow?.model || "", pooled: false, skipped: /** @type {{ model: string, why: string }[]} */ ([]) }
      : forkBody
        ? { ok: /** @type {const} */ (true), model: forkModel, pooled: false, skipped: [] }
        : takeSeat(seats, { want: own, who: wanted || among.length ? "" : card.name, key: seatKey, of: seatsOfWords(inList?.which ?? "side") });
    // Every seat taken: a lead's worker waits on the model it named, else the first row that can run.
    if (!taken.ok && waits) {
      const on = waitSeat(seats, { want: own, key: seatKey });
      if (on) {
        busy ||= taken.error;
        taken = { ok: true, model: on, pooled: seats.some((s) => s.key === seatKey(on)), skipped: [] };
      }
    }
    if (!taken.ok) return { ok: false, error: taken.error };
    const model = taken.model;
    if (!model) return { ok: false, error: `no model to run the sub-agent on: name one, or give the session's pool a model (subagents.pool)` };
    const problem = ctx?.modelProblem(model) || null;
    if (problem)
      return {
        ok: false,
        error: memberModel
          ? `${team?.role} cannot run on "${model}": ${problem} — its team names that model for it (Library › Agents and teams)`
          : among.length
            ? `the sub-agent cannot run on "${model}": ${problem} — the model named, on the list the person set`
          : cardModels.length && chatCard
            ? `${card.name} cannot run on "${model}": ${problem} — this chat names that model for it (its Agents tab)`
            : cardModels.length
            ? `${card.name} cannot run on "${model}": ${problem} — its card names that model (${agentsPage(config())})`
            : `the sub-agent cannot run on "${model}": ${problem}`,
      };
    // Each model at the highest level it takes at or below the one wanted, on its name as a session's own effort goes;
    // a name that spells its level keeps it where nobody asked for one. A team's worker whose launch names none runs at
    // the effort its team names for the member, else what its Brief picked for the crew (`engine.teamEffort`): the
    // person asked for either. Then the effort of the row of its list it took, where the row says one — the person's
    // too (the owner's word of 11-05: "model · account · effort"). Nothing named: the main agent's effort.
    const listed = forkBody || !cardList ? null : cardList.models.find((m) => m.toLowerCase() === model.toLowerCase()) || (cardModels.length ? cardList.models.find((m) => seatKey(m) === seatKey(model)) : null) || null;
    const rowEffort = forkBody ? null : listed ? cardList?.efforts[listed] || null : cardModels.length ? null : freeRow ? freeRow.effort : seats.find((s) => s.key === seatKey(model))?.effort || null;
    const effortNamed = effortAsked || (team ? team.effort || teamEffortOf(doc) : null) || null;
    const effortPicked = effortNamed || rowEffort;
    // The rows it goes on down where its provider fails it (the owner's plan of 11-05: fallback down the rows): its
    // card's list, else the rows of the list it took its seat from — a team's, the chat's —, each with its effort; never
    // where its launch named the model, a member's own, a fork or one that took no seat.
    const moveList = forkBody || wanted || memberModel || unseated ? [] : cardModels.length ? cardModels : seats.filter((s) => s.model).map((s) => s.model);
    // The model its list's nameless row stood for as it took its seat, kept for a move (the review of 7cd60efc5): the
    // chat's model may change before a follow-up's.
    const nameless = poolName(main || inList?.chat.main());
    /** @type {Record<string, string>} */
    const moveEfforts = cardModels.length ? { ...(cardList?.efforts || {}) } : Object.fromEntries(seats.filter((s) => s.model && s.effort).map((s) => [s.model, String(s.effort)]));
    const inherited = effortPicked ? null : mainEffortIn(doc, doc?.model?.name || session?.model, model);
    const effortWanted = effortPicked || inherited?.level || "model";
    const ran = forkBody || !ctx?.effortOf ? null : ctx.effortOf(model, effortWanted === "model" ? null : effortWanted, !!effortPicked || !!inherited?.asked);
    const cwd = String(spec.cwd || session?.cwd || "").trim();
    if (!cwd) return { ok: false, error: "no working folder for the sub-agent: the session names none" };
    // A worker's grants hold in its worktree, where its commands run on the same files at the same paths: one that names
    // the developer's folder would reach past it, and a rule of the session's is never lifted by a brief (TG2-D44). Its
    // card's own commands go beside its brief's, whoever called it (AG-267); a call never checks them against the
    // session's rules, which still win at each command. A graph task's check is granted so too (V2-1): read as its
    // tasks call was (`checkProblem`), and a rule that came since keeps Filament from running it (`checkPlan`). A team's
    // check (the plan's p6) joins the check of a member that changes files — a lead's launch and a graph task's alike —
    // where the session lets Filament run it, read as a graph task's check is (`checkBar`); where not, the member goes
    // without it, and the launch's answer says why in its lead's words (`unchecked`).
    const teamAsked = team?.check && may === "edit" ? team.check : null;
    const teamBar = teamAsked ? checkBar(chainId, [teamAsked], { mode: spec.mode || null }) : null;
    const teamCheck = teamAsked && !teamBar ? teamAsked : null;
    const brief = (team || task) && (spec.grants || teamCheck) ? withTeamCheck(spec.grants || null, teamCheck) : null;
    const ungranted = brief && !task ? grantsRefusal(brief, { folder: cwd, names: (c) => namesOutside(c, cwd, null), rules: rulesFrom(doc) }) : null;
    if (ungranted) return { ok: false, error: ungranted };
    const grants = withCardRuns(card.mayRun, brief);
    const handed = changeSource(spec.changes === undefined ? card.sees.changes : spec.changes);
    if (!handed.ok) return { ok: false, error: handed.error };
    const changes = handed.source;
    const background = developer || spec.background === true;
    // A graph task's end is its runner's to tell, in the graph's words.
    // A saved agent the developer asked answers them: its answer stays with them until they send it on.
    // A fork that weighs the person's message ends to the turn that started it (`weighs`), as a task's does to its runner.
    const deliverIt = task || weighs ? false : (spec.deliver ?? (developer ? !asked : background));
    // Holding the main agent, or telling it now, is for a report that will reach it.
    if (developer && !deliverIt && spec.pause) return { ok: false, error: "pause holds the main agent's turn for the report, so the report must go to the main agent — a sub-agent kept aside cannot pause it" };
    if (developer && !deliverIt && spec.inform) return { ok: false, error: "inform tells the main agent a report is coming, so the report must go to the main agent — a sub-agent kept aside has nothing to announce" };
    const full = unseated || busy ? null : ceilingProblem(chainId, spec.origin === "agent", main, list, ownRows, model);
    if (full && !waits) return { ok: false, error: full };
    busy ||= full;
    // Its model's slots across Filament (team_v2_plan TV2-D8): a model its list does not hold, a fork's and a card's own
    // take one too. One that started by itself takes none (AG-203).
    const slot = unseated ? null : slotNow(model);
    if (!busy && slot && !slotFree(slot)) {
      const why = `${model}: ${slotsBusy(slot)}. Wait for one to finish.`;
      if (!waits) return { ok: false, error: why };
      busy = why;
    }
    // What it may do says where it works (AG-7). One that edits works in its own git worktree unless the launch or the
    // session says otherwise. One that runs in a copy always has one: only the developer can give it their folder
    // instead (AG-85), and there it edits — more than its card says, on their word.
    const inFolder = may === "copy" && developer && spec.worktree === false;
    const level = inFolder ? "edit" : may;
    // Of which kind its own is (the owner's plan of 11-09 for big repos): a patch — no checkout — for a builder on
    // Filament's loop, a worktree where it runs commands from the start or its agent runs its own tools (workspace-kind.js).
    const engine = ctx?.agentOf?.(model) ? "acp" : "loop";
    const chatSays = workspaceSetting(sub);
    const setting = WORKSPACES.includes(String(spec.workspace)) ? /** @type {"auto" | "patch" | "worktree" | "folder"} */ (spec.workspace) : spec.worktree === false ? "folder" : spec.worktree === true && chatSays === "folder" ? "auto" : chatSays;
    const runsCommands = !!(grants && (grants.check?.length || grants.mayRun?.length || grants.card?.length));
    const fileHooks = ["read", "write", "edit"].some((t) => hooksFor(doc, "pre-tool", { tool: t }).length || hooksFor(doc, "post-tool", { tool: t }).length);
    // The session's MCP servers its turn starts in its folder (agent/turn.js): one with a command runs on this computer.
    const localMcp = !card.toolsOff?.includes("mcp") && (Array.isArray(doc?.plugins?.mcp) ? doc.plugins.mcp : []).some((m) => m && !mcpServerProblem(m) && !m.url);
    const chosen = workspaceKind({ may: level, inFolder, setting, engine, checked: runsCommands, attempt: !!(team && spec.attempt), hooks: fileHooks, localMcp });
    const ownTree = chosen.kind === "patch" || chosen.kind === "worktree";
    // Only asked whether it would go: every refusal above said, nothing made or taken.
    if (spec.dry === true) return { ok: true, id: "", done: new Promise(() => {}), tree: Promise.resolve(ownTree), dry: { model, ownTree } };
    /** @type {Subagent} */
    const sa = {
      id: newId(),
      chainId,
      origin: spec.origin,
      // Your agent sent it on a card your message named, not one the session's list holds.
      ...(heardOf?.has(card.tag) && !named.some((a) => a.tag === card.tag) ? { heard: true } : {}),
      ...(second ? { second: true } : {}),
      ...(weighs ? { weighs } : {}),
      may: level,
      asked,
      engine,
      // What the kind of its worktree is chosen by, once it gets one (`copyFor`): the setting, and the paths its launch names.
      workspace: ownTree ? { kind: /** @type {"patch" | "worktree"} */ (chosen.kind), rule: chosen.rule, moving: null, noted: false, setting, paths: launchPaths({ writes: spec.files?.writes, files: spec.files?.files, brief: prompt }) } : null,
      team: team ? teamKept({ ...team, check: teamCheck || undefined }) : null,
      card: { tag: card.tag, name: card.name, thinks: card.thinks, may: card.may, ...(card.toolsOff?.length ? { toolsOff: [...card.toolsOff] } : {}) },
      task: task ? { id: task.id, review: task.review } : null,
      ...(hunts ? { hunts, ...(hunted ? { hunted: { name: hunted.name, graph: hunted.graph } } : {}) } : {}),
      // A graph task's worker is launched with its task's check granted (V2-1), or none (TG2-D63) — its task's own, kept
      // apart from its team's, which stays on its team.
      ...(task ? { taskCheck: [...(spec.grants?.check || [])], taken: null } : {}),
      model,
      seat: !own && taken.pooled ? { pooled: true, named: seats.some((s) => s.named && s.key === seatKey(model)), skipped: taken.skipped } : null,
      models: moveList.length > 1 ? { list: moveList, passed: picked?.ok ? picked.passed : cardModels.length ? [] : taken.skipped || [], failed: [], effort: effortWanted, asked: !!effortAsked, named: effortNamed, efforts: moveEfforts, ...(nameless ? { main: nameless } : {}) } : null,
      effort: ran ? { level: ran.level, wanted: effortWanted, levels: ran.levels, spelled: ran.spelled } : null,
      wire: ran && ran.wire !== model ? ran.wire : null,
      list,
      slot: slot?.key ?? null,
      waiting: busy ? { since: now(), why: busy, rows: teamRows } : null,
      crew: teamRows,
      chose: spec.chose == null ? null : String(spec.chose),
      description: lineOf(spec.description, prompt),
      cwd,
      files: spec.files || null,
      grants,
      planReview: !!team && spec.planReview === true,
      mode: spec.mode || null,
      view,
      running: (spec.running ?? card.sees.running) === true,
      changes,
      start: spec.start ? String(spec.start) : null,
      since: spec.since === "message" ? "message" : null,
      seen: null,
      // Memory's brief opens every sub-agent's task where the chat's memory is on: no switch turns it off (the owner's
      // of 11-09, "memory system is core"); another machine's agents' chat runs with memory off while it runs fenced,
      // and so does each sub-agent of it (the f-fence2 hunt's).
      memory: ctx?.agentsFenced?.(chainId) !== true,
      background,
      deliver: deliverIt,
      aside: developer && !deliverIt,
      restored: null,
      // Only a turn running now can be held; with none, there is nothing to pause and the report opens the next one.
      pausing: developer && spec.pause ? liveTurnOf(chainId)?.runId || null : null,
      thinking: forkBody ? forkBody.thinking || null : spec.thinking || null,
      requestId: spec.requestId || null,
      status: "running",
      startedAt: now(),
      exchanges: [],
      opening: [],
      convo: [],
      work: null,
      shares: null,
      fork: forkBody
        ? { system: forkBody.system, tools: Array.isArray(forkBody.tools) ? forkBody.tools : [], thinking: forkBody.thinking || null, maxTokens: Number(forkBody.max_tokens) || 0, from: forkFrom, messages: Array.isArray(forkBody.messages) ? forkBody.messages.length : 0 }
        : null,
      settled: null,
      questions: 0,
      checked: null,
      folderRed: null,
      folderUndone: null,
      folderBacks: 0,
      // One of several workers on its brief at once (TG2-D53): the first of them names the group.
      attempt: team && spec.attempt ? { group: spec.attempt.group || "", n: spec.attempt.n, of: spec.attempt.of, won: false, dropped: null } : null,
      run: null,
    };
    if (sa.attempt && !sa.attempt.group) sa.attempt.group = sa.id;
    subs.set(sa.id, sa);
    if (counts) counts.launched += 1;
    // A launch is its sub-agent's first exchange.
    if (developer && spec.inform) enqueue(chainId, { text: informText(sa, prompt), from: sa.id, description: sa.description, kind: "notice", exchange: 0, spends: [], wrote: false });
    // Whether it works in a worktree of its own, once its first message knows: a launch's answer says what its brief's
    // grants do (TG2-D44), and a folder that is no repository has none to give.
    /** @type {(own: boolean) => void} */
    let treeKnown = () => {};
    const tree = new Promise((resolve) => (treeKnown = resolve));
    sa.tree = tree;
    // One that waits for its room: whether it came by it and starts, or its exchange ended first (`roomOf`).
    const wait = roomOf(sa);
    const batch = spec.batch ? String(spec.batch) : passBatch();
    const compose = async () => {
      // Its room first, where it waits for it (team_v2_plan §5.7): its worktree is made, and its first message, once it starts.
      if (sa.waiting) await turnFor(sa);
      wait?.had();
      const missed = ownTree ? await openWork(sa, sa.run?.abort.signal || null, batch) : null;
      treeKnown(!!sa.work?.wt);
      // An attempt never works in the developer's folder beside the others (TG2-D53): its launch checked there is a
      // repository to copy; where its copy could not be made all the same, it is dropped, and says nothing.
      if (sa.attempt && !sa.work) {
        sa.attempt.dropped = ATTEMPT_REFUSED;
        throw new Error(`attempts need a worktree each, and this one could not be made (${sa.shares || sa.noCopy || "no repository"})`);
      }
      if (level === "copy" && !sa.work) throw new Error(noCopy(sa, developer));
      if (missed === "failed") throw new Error(copyFailedWords(sa, developer));
      sa.opening = await openingOf(sa, prompt);
      if (spec.review) sa.opening.push(reviewOpening(spec.review));
      if (forkBody) {
        // The main agent's conversation byte for byte, then one user text: the note, the worktree's, the brief, the task.
        const n = sa.fork?.messages || 0;
        const opened = sa.opening.map((b) => b.text);
        // A fork weighing the person's message reads its own note, and its task is the message, ahead of nothing of a card's.
        const note = weighs ? STEER_FORK_NOTE : task ? TASK_FORK_NOTE : FORK_NOTE;
        sa.opening.unshift({ kind: "fork", count: n, text: `Forked from the main agent's ${forkFrom === "turn" ? "running turn" : "last turn"}: its system prompt, tools, thinking and all ${n} message${n === 1 ? "" : "s"} as they were sent, then:\n\n${note}` });
        // A fork's instructions are the main agent's own: the words of the card it runs as ride here, ahead of its task,
        // and a graph task's granted check as a brief's start says it.
        const instruction = weighs ? [note, ...opened, prompt].join("\n\n") : [note, ...(sa.work?.wt ? [forkWorkNote(sa.work.wt.workdir, level !== "copy", copyHolds(sa.work.wt))] : []), ...(saysPointers(sa.work?.wt) ? [lfsNote(true)] : []), ...sparseNoted(sa), ...grantsNoted(sa), ...(card.thinks ? [card.thinks] : []), ...opened, prompt].join("\n\n");
        return forkMessages(forkBody.messages || [], instruction, { own: spec.parent?.toolUseId || null, others: FORK_OTHER_CALL });
      }
      // A saved agent the session's agent asked is told who asks: the question is not the developer's.
      const said = asked && !developer ? `${ASKED_BY_AGENT}\n\n${prompt}` : prompt;
      // Its lead reviews its plan (TG2-D50): Filament's note goes right ahead of its brief, where its run starts held.
      const plan = sa.run?.planHeld ? [{ type: "text", text: PLAN_REVIEW_NOTE }] : [];
      return [{ role: "user", content: [...sa.opening.map((b) => ({ type: "text", text: b.text })), ...(sa.work ? [{ type: "text", text: workNoteOf(sa, { copy: level === "copy", task: !!task, team: !!team }) }] : []), ...(saysPointers(sa.work?.wt) ? [{ type: "text", text: lfsNote(sa.engine !== "acp") }] : []), ...sparseNoted(sa).map((text) => ({ type: "text", text })), ...(sa.engine === "acp" && sa.work?.wt?.workdir ? [{ type: "text", text: agentWorkNote(sa.work.wt.workdir, sa.cwd) }] : []), ...grantsNoted(sa).map((text) => ({ type: "text", text })), ...plan, { type: "text", text: said }] }];
    };
    const pictures = Array.isArray(spec.images) ? spec.images : [];
    const files = Array.isArray(spec.attachedFiles) ? spec.attachedFiles : [];
    const why = spec.origin === "self" ? String(spec.why || "").trim() || null : null;
    const done = exchange(sa, async () => withPictures(withFiles(await compose(), files), pictures), { prompt, description: sa.description, by: spec.origin, parent, pictures: pictures.map((p) => p.name), files: files.map((f) => f.name), handed: changes, why });
    // Its first message is made at once; an exchange that ends without it knowing had none (a launch never waits on it).
    void done.then(() => treeKnown(false));
    wait?.endsWith(done);
    if (spec.origin === "owner" || (spec.origin === "self" && !second && !weighs))
      mark(sa, "dispatch", { model, ...(sa.effort?.level ? { effort: sa.effort.level } : {}), view, may: level, memory: sa.memory, pause: sa.pausing != null, inform: !!spec.inform, deliver: deliverIt, ...(changes ? { handed: changes } : {}), ...askedOf(sa, prompt, why) });
    // Where it works, as its launch chose (11-09): a graph task keeps it, its forecast read from it.
    return { ok: true, id: sa.id, done, tree, workspace: chosen.kind, ...(wait ? { waiting: wait.words, room: wait.room } : {}), ...(teamAsked && teamBar ? { unchecked: { check: teamAsked, why: teamCheckWhy(teamBar) } } : {}) };
  }

  /**
   * The agent's launch on another machine (the remote-agents plan's s-launch): its sub-agent works in a chat there, as
   * that machine's own agent — its models, its tools —, in the folder `place` found (remote-agents.js). It is
   * kept with the local ones — listed, waited on, followed up, stopped —, takes no seat or slot of this machine's and no
   * worktree here, and is told nothing of this chat but where it runs (`whereWords`), the patch its launch asks for
   * (`changes`), its task and what the main agent attached (`attached`). This machine's memory stays here. Its chat there runs in this chat's mode as each message
   * goes — the launching turn's own where it fixed one (`mode`), read-only for a kind that reads —, as far as that
   * machine's grants let it, and on this chat's model (`prefer`) where neither the launch nor that machine names one and
   * it answers there (the owner's of 11-10).
   * @param {{ chainId: string, prompt: string, description?: string, worker: string, place: import("./remote-agents.js").RemotePlace,
   *   model?: string | null, effort?: string | null, mode?: string | null, prefer?: string | null, changes?: string | null, background: boolean, parent: LaunchParent | null,
   *   attached?: import("./attach.js").Attached | null }} spec
   * @returns {{ ok: true, id: string, done: Promise<Outcome>, tree: Promise<boolean> } | { ok: false, error: string }}
   *   `tree`: whether it works in a worktree of its own here, as a launch's says — never
   */
  function launchRemote(spec) {
    const chainId = String(spec.chainId || "");
    const parent = spec.parent || null;
    const prompt = String(spec.prompt || "").trim();
    if (!prompt) return { ok: false, error: "a sub-agent needs a task — the whole of it, since it sees nothing of your conversation" };
    const card = cardOf(spec.worker);
    if (!card) return { ok: false, error: `there is no worker \`${spec.worker}\` — ${agentsPage(config())} lists them` };
    const handed = changeSource(spec.changes);
    if (!handed.ok) return { ok: false, error: handed.error };
    const effort = spec.effort ? String(spec.effort).trim().toLowerCase() : null;
    if (effort && !SUBAGENT_EFFORTS.includes(effort)) return { ok: false, error: `effort must be one of ${SUBAGENT_EFFORTS.join(", ")}` };
    const model = spec.model ? String(spec.model).trim() : null;
    const p = spec.place;
    // A team's lead's turn counts its launches (`countedBy`).
    const counts = parent?.live.lead ? parent.live : null;
    /** @type {Subagent} */
    const sa = {
      id: newId(),
      chainId,
      origin: "agent",
      may: card.may,
      asked: false,
      engine: "loop",
      team: null,
      card: { tag: card.tag, name: card.name, thinks: card.thinks, may: card.may },
      task: null,
      // The model its chat there runs on: the one named, else that chat's own — that machine's default, else one that
      // answers there —, said once it starts. The machine is said beside it wherever this is, so these words name none.
      model: model || "its machine's default",
      seat: null,
      models: null,
      effort: effort ? { level: effort, wanted: effort, levels: null, spelled: false } : null,
      wire: null,
      list: "side",
      slot: null,
      waiting: null,
      crew: null,
      chose: null,
      description: lineOf(spec.description, prompt),
      cwd: p.cwd,
      files: null,
      grants: null,
      planReview: false,
      mode: null,
      view: "none",
      running: false,
      changes: handed.source,
      start: null,
      seen: null,
      memory: false,
      background: spec.background,
      deliver: spec.background,
      aside: false,
      restored: null,
      pausing: null,
      thinking: null,
      requestId: null,
      status: "running",
      startedAt: now(),
      exchanges: [],
      opening: [],
      convo: [],
      work: null,
      shares: null,
      fork: null,
      settled: null,
      questions: 0,
      checked: null,
      folderRed: null,
      folderUndone: null,
      folderBacks: 0,
      attempt: null,
      run: null,
      // A kind that reads runs read-only there as here; else the launching turn's own mode, where it fixed one.
      remote: { machine: { ...p.machine }, cwd: p.cwd, chat: null, model, effort, fixed: card.may === "read" ? "read-only" : spec.mode || null, prefer: spec.prefer ?? null },
    };
    subs.set(sa.id, sa);
    if (counts) counts.launched += 1;
    /** Where it runs: its copy's place once made, kept for a first message composed again (the swarm's review of 11-10). */
    let at = p;
    /** @param {AbortSignal} signal */
    const compose = async (signal) => {
      // A copy of its own there (cp-place): sent and checked out as its first message goes, under its own stop; a
      // project's first copy to that machine on the person's press on its card (`askSend`).
      const placed = at.pending ? await remote.copyPlace(at, { ask: (o) => askSend(sa, o, signal), sent, signal }) : at;
      if (placed !== at) {
        at = placed;
        const r = /** @type {import("./remote-agents.js").RemoteChat} */ (sa.remote);
        sa.cwd = placed.cwd;
        r.cwd = placed.cwd;
        if (placed.copy) r.copy = { id: placed.copy.id, project: placed.copy.project, commit: placed.copy.commit, ...(placed.copy.keeps ? { keeps: placed.copy.keeps } : {}) };
        // What one that edits changes there comes back as a local sub-agent's work does (cp-back), measured from the copy
        // sent, whose commit is held here: none where that machine sends nothing back (a Filament there from before),
        // or git would not hold it.
        if (placed.copy?.back && sa.may === "edit" && placed.copy.repo && (await holdCopyCommit(placed.copy.repo, sa.id, placed.copy.commit).catch(() => false)))
          sa.work = { repo: placed.copy.repo, base: placed.copy.commit, head: null, wt: null, dest: null, files: [], applied: [], error: null, there: true };
        changed(sa);
      }
      // The patch its launch asks for, read here as a local sub-agent's is: this chat's view of it (`openingOf`).
      sa.opening = handed.source ? await openingOf(sa, prompt) : [];
      const where = remote.whereWords(placed, { changes: sa.opening.some((b) => b.kind === "changes" && b.count > 0), back: !!sa.work?.there });
      unplaced.delete(sa.id);
      return [{ role: "user", content: [{ type: "text", text: where }, ...sa.opening.map((b) => ({ type: "text", text: b.text })), { type: "text", text: prompt }] }];
    };
    // What the main agent attached goes with its first message, made again by a follow-up where its copy there was not.
    const attached = spec.attached || null;
    const first = attachedTo(compose, attached);
    if (p.pending) unplaced.set(sa.id, first);
    const done = exchange(sa, first, { prompt, description: sa.description, by: "agent", parent, handed: handed.source, pictures: attached?.images.map((i) => i.name) || [], files: attached?.files.map((f) => f.name) || [] });
    return { ok: true, id: sa.id, done, tree: Promise.resolve(false) };
  }

  /**
   * What a sub-agent's session did since it last looked, as a block for its next message, or null: it was shown
   * nothing of the session, or nothing happened. Its mark moves, and its running exchange says what it carried, so
   * nothing is said twice.
   * @param {Subagent} sa
   */
  const sinceOf = async (sa) => {
    if (!sa.seen || !ctx) return null;
    try {
      const v = await ctx.view(sa.chainId, "fold", { after: sa.seen.turn, running: { run: sa.seen.run, event: sa.seen.event } });
      if (!v) return null;
      const r = v.running?.text ? v.running : null;
      // A question that waits is said once: the one it was told of at its last look is not said again.
      const w = v.waiting && v.waiting.at !== sa.seen.waiting ? v.waiting : null;
      sa.seen = { turn: Number(v.turn) || sa.seen.turn, run: v.running?.run ?? null, event: Number(v.running?.event) || 0, waiting: v.waiting?.at ?? null };
      if (!v.text && !r && !w) return null;
      const text = sinceBlock({ turns: v.turns, text: v.text.length > VIEW_CHARS ? `…[Filament: the older part is left out]\n${v.text.slice(-VIEW_CHARS)}` : v.text }, r, w);
      const ex = sa.exchanges.at(-1);
      if (ex) ex.caughtUp = { turns: v.turns, rounds: r ? r.rounds : 0, tokens: estimateTokens(text) };
      return text;
    } catch (/** @type {any} */ e) {
      log("warn", `sub-agent ${sa.id}: no catch-up for its follow-up (${e.message})`);
      return null;
    }
  };

  /**
   * A change as a block for a follow-up's message, with its running exchange told how many files that was; null
   * where the session's view could not be read.
   * @param {Subagent} sa @param {string} source
   */
  const handedOf = async (sa, source) => {
    try {
      const c = (await ctx?.view(sa.chainId, null, { changes: source }))?.changes || null;
      if (c?.refused) throw new NoSuchRange(String(c.note));
      const ex = sa.exchanges.at(-1);
      if (ex?.handed) Object.assign(ex.handed, { files: c?.files ?? 0 }, c?.note ? { note: String(c.note) } : {});
      return c ? changesBlock(c) : null;
    } catch (/** @type {any} */ e) {
      if (e instanceof NoSuchRange) throw e;
      log("warn", `sub-agent ${sa.id}: no change for its follow-up (${e.message})`);
      return null;
    }
  };

  /**
   * What a fresh agent reads of the thread it takes up (BW-10): each earlier message to it and its answer, in order —
   * the conversation it had, its calls and what they returned, is gone.
   * @param {Subagent} sa @param {"restart" | "let-go"} why
   */
  const threadBlock = (sa, why) => {
    const earlier = sa.exchanges.slice(0, -1);
    const said = earlier
      .map((x, i) => {
        const o = x.outcome;
        // A stop says whose it was (`endedWord`).
        const how = o ? `${endedWord(o.status, o.stoppedBy)}${o.error ? ` (${o.error})` : ""}` : "did not end";
        const answer = o?.ok ? (o.report ? `Your answer:\n${o.report}` : "Your answer was empty.") : `Your work on it ${how}${o?.report ? `. What you had said by then:\n${o.report}` : "."}`;
        // Files attached to it went with that message alone: their names, so it can read them again itself.
        const files = x.files?.length ? `\n\n(Attached to it, kept no more: ${x.files.join(", ")}.)` : "";
        return `Message ${i + 1}, from ${x.by === "agent" ? "the session's main agent" : x.by === "self" ? "Filament, as you started by yourself" : "the developer"}:\n${x.prompt || "(its words are kept no more)"}${files}\n\n${answer}`;
      })
      .join("\n\n");
    const body = said.length > VIEW_CHARS ? `…[Filament: the older part of the thread is left out]\n${said.slice(-VIEW_CHARS)}` : said;
    const lost = why === "restart" ? "Filament restarted since you last worked in this thread" : "Filament holds the conversation you had in this thread no more";
    return `<thread messages="${earlier.length}">\n${lost}: the calls you made then and what they returned are gone, and you start fresh. What was said is below — each message to you, and your answer. Read again what you need. Background only — the new message follows.\n\n${body}\n</thread>`;
  };

  /**
   * A fresh agent's first message in a thread its session gave back (BW-10): the session as its card says, as it
   * stands now — one that began as a copy of the main agent cannot be copied again, and reads it folded — then what
   * was said in the thread, its worktree's note, a change handed with the message, and
   * the message. The change its launch was handed is not handed again.
   * @param {Subagent} sa @param {string} text
   * @param {{ why: "restart" | "let-go", asker: SubagentOrigin, handed: string | null }} o
   */
  const afresh = async (sa, text, { why, asker, handed }) => {
    const opening = await openingOf(sa, text, { view: sa.view === "fork" ? "folded" : sa.view, changes: null });
    // Its conversation opens with this brief now, written for the model it starts on: the one a model it goes on to is
    // sent without (`forModel`). It is this exchange's, never its launch's context; an earlier brief keeps its place and
    // its size, its words gone with the conversation it opened.
    const at = sa.exchanges.length - 1;
    sa.opening = [
      ...sa.opening.map((b) => (b.kind === "brief" ? { kind: b.kind, count: b.count, text: "", chars: b.chars ?? b.text.length, ...(b.exchange ? { exchange: b.exchange } : {}) } : b)),
      ...opening.filter((b) => b.kind === "brief").map((b) => ({ ...b, exchange: at })),
    ];
    const patch = handed ? await handedOf(sa, handed) : null;
    const note = sa.work ? workNoteOf(sa, { copy: sa.may === "copy", task: false, team: !!sa.team }) : null;
    const said = sa.asked && asker === "agent" ? `${ASKED_BY_AGENT}\n\n${text}` : text;
    const blocks = [...opening.map((b) => b.text), threadBlock(sa, why), ...(note ? [note] : []), ...grantsNoted(sa), ...(patch ? [patch] : []), said];
    return [{ role: "user", content: blocks.map((t) => ({ type: "text", text: t })) }];
  };

  /**
   * Continue a sub-agent's conversation with another message — "check again" in the context it already has. `by`
   * says who asks: the agent (`parent` is its call), the developer from the harness (`owner`) or a command. A
   * follow-up never holds the main agent; the developer's report goes where their launch sent it unless they say.
   * `description`: the task in a line, as the agent's call names it (the sub-agent keeps its own name). `lead`: a team's
   * lead asks, as plain JSON — its turn and its call — in place of `parent` (HarnessV3-AtHome AH-O10). `correction`: the
   * lead says the work it follows up on fell short (HarnessV3-Memory M7-D50); `marked` is how many outcomes memory
   * marked for it — none when that task never ran, or memory kept no outcome of it. `changes`: a change handed to it
   * as a patch ahead of the message (`LaunchSpec.changes`) — "check again", with what was changed since. `why`: its
   * next start by itself (`by: "self"`), as a launch's. `folder`: Filament sends a worker back
   * with it, the folder's check having failed on that command with its change once its lead applied it (TG2-D55).
   * `again`: the developer's Retry on a thread that failed (the owner's word of 10-24) — its question asked again in
   * that thread where `prompt` is empty, from where its conversation stands. `synced`: Filament's note of the folder
   * brought into its worktree first (`syncWork`), ahead of the message. `moved`: the follow-up of the move of its work
   * onto the folder, which holds it meanwhile. `dry`: only whether it would go — its refusal, or ok with no exchange.
   * `attached`: what the main agent attached (`attach`, attach.js), after the message's words.
   * @param {string} id
   * @param {{ prompt: string, chainId: string, by?: SubagentOrigin, parent?: LaunchParent | null, lead?: LeadCall | null, background?: boolean, deliver?: boolean, description?: string, correction?: boolean, changes?: string | null, why?: string | null, folder?: { command: string, n: number } | null, again?: boolean, synced?: string | null, moved?: boolean, dry?: boolean, attached?: import("./attach.js").Attached | null }} o
   * @returns {{ ok: true, id: string, done: Promise<Outcome>, marked: number } | { ok: false, error: string }}
   */
  function followUp(id, { prompt, chainId, by = "owner", parent: given = null, lead = null, background, deliver: deliverIt, description, correction = false, changes = null, why: started = null, folder = null, again: retry = false, synced = null, moved = false, dry = false, attached = null }) {
    const parent = lead ? leadParent(String(chainId || ""), lead) : given;
    if (lead && !parent) return { ok: false, error: `the lead's turn ${lead.runId} is not running in this session` };
    recall(String(chainId || ""));
    const sa = subs.get(String(id || ""));
    // A retry (`again`, the owner's word of 10-24: Retry goes on with the thread that failed, never a new one): the
    // question of the exchange that failed, unless another is given.
    const failedLast = !!sa && (sa.status === "failed" || sa.status === "aborted");
    const text = String(prompt || (retry && failedLast ? sa?.exchanges.at(-1)?.prompt : "") || "").trim();
    if (!sa || sa.chainId !== String(chainId || "")) return { ok: false, error: noSuchSubagent(id) };
    if (sa.task) return { ok: false, error: `sub-agent ${sa.id} does task ${sa.task.id} of the task graph, and its report ends it — to have it change its work, failed or ready, send it back: tasks start with its id and a note, and it goes on where it stopped` };
    // Its change is its planner's to apply, or the developer's: each is told their own way to it.
    const theirs = by === "owner" ? "yours in Changes, or its planner's" : `yours, with agent_id "${sa.id}" and apply_changes: true, or the developer's in Changes`;
    if (sa.taskWas) return { ok: false, error: `sub-agent ${sa.id} did task ${sa.taskWas} of the task graph before Filament restarted: its change waits for its apply — ${theirs} — and a new worker takes the task if it starts again` };
    // One kept from a card Filament does not ship (a restart rebuilds it from what it was saved as): its thread stays to
    // read, and the card that does its work goes on with it in a launch of its own — none where its card went whole.
    const folded = cardOf(sa.card.tag) ? null : foldedWords(sa.card.tag, (into) => `launch ${into} to go on with its work`) ?? retiredWords(sa.card.tag);
    if (folded) return { ok: false, error: `sub-agent ${sa.id} ran as ${sa.card.name}, which is gone — ${folded}; its thread stays to read` };
    // A mark, or its undo, moves the work it would go on from (`marking`). Filament's own mark of work found whole
    // (`settling`), which nobody asked for, steps aside instead: the follow-up goes ahead (below).
    const slot = `${sa.chainId}\n${sa.id}`;
    const ownMark = settling.has(slot) ? marking.get(slot) : null;
    if (marking.has(slot) && !ownMark) return { ok: false, error: `sub-agent ${sa.id}'s work is being marked as applied now: ask it again once that is done` };
    // Its work being moved onto the folder (`rebase`, `syncWork`) holds its worktree: only the move's own follow-up
    // (`moved`) goes on from it, else it would reopen the work from where it stood before.
    if (rebasing.has(slot) && !moved) return { ok: false, error: `sub-agent ${sa.id}'s work is being moved onto your folder now: ask it again once that is done` };
    // An attempt another won has no work to go on with (TG2-D53).
    const dropped = droppedWords(sa);
    if (dropped) return { ok: false, error: dropped };
    if (sa.status === "running") return { ok: false, error: `sub-agent ${sa.id} is still working; its report comes first` };
    if (retry && !failedLast) return { ok: false, error: `sub-agent ${sa.id} did not fail, so there is nothing to retry: follow it up instead` };
    if (!text) return { ok: false, error: "a follow-up needs a message" };
    // Its copy there never made, and what would make it gone with a restart: no folder there to go on in.
    if (sa.remote && !sa.remote.cwd && !unplaced.has(sa.id)) return { ok: false, error: `sub-agent ${sa.id}'s copy on ${sa.remote.machine.name} was never made, and Filament has restarted since: launch it again` };
    const handed = changeSource(changes);
    if (!handed.ok) return { ok: false, error: handed.error };
    // One whose model cannot run now — its provider cannot serve this account, above all (HarnessV3-TaskGraph-v2
    // TG2-D54) — is refused at once, with why and what to do instead: its first round would fail there.
    // One on another machine runs on that machine's models, and takes no seat here.
    const cannot = by === "self" || sa.remote ? null : ctx?.modelProblem(sa.model) || null;
    if (cannot) {
      const again = againWords(sa);
      return { ok: false, error: `${sa.team ? `${sa.team.role} ${sa.id}` : `sub-agent ${sa.id}`} runs on ${sa.model}, and ${cannot}. ${again.charAt(0).toUpperCase()}${again.slice(1)}, or follow it up once it can run.` };
    }
    const full = by === "self" || sa.remote ? null : ceilingProblem(sa.chainId, !!parent, null, sa.list, null, sa.model) || seatProblem(sa);
    if (full) return { ok: false, error: full };
    // Only asked whether it would go (`dry`): a sync asks before it moves anything (`syncWork`).
    if (dry) return { ok: true, id: sa.id, done: /** @type {any} */ (null), marked: 0 };
    // The lead's correction: memory counts the task of the exchange it follows up on — by its run's request — as
    // corrected by the lead. An exchange whose run never started made no request to count.
    const fellShort = correction ? sa.exchanges.at(-1)?.runId : null;
    let marked = 0;
    if (fellShort && ctx?.corrected)
      try {
        marked = Number(ctx.corrected({ chainId: sa.chainId, request: fellShort })) || 0;
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agent ${sa.id}: the lead's correction did not reach memory (${e?.message || e})`);
      }
    const asker = parent ? "agent" : by;
    const bg = parent ? background === true : true;
    sa.background = bg;
    sa.deliver = deliverIt ?? (parent ? bg : !sa.aside);
    sa.pausing = null;
    const convo = sa.convo;
    // Its session's record gave it back: a fresh agent takes the thread up, from what was said (BW-10). One on another
    // machine never does: its chat there holds its conversation.
    const why = sa.remote ? null : sa.restored;
    // Filament's own mark under way: its read stops, and the mark — which reads the sub-agent at work now and marks
    // nothing — is over before the work is reopened from where it left it; the other reads ahead of it in its
    // repository's turn stop too, so that comes at once (`aheadOfMark`).
    if (ownMark) {
      aheadOfMark(slot);
      stopOwnRead(slot);
    }
    const done = exchange(
      sa,
      // What the main agent attached follows its words, whichever way the message is made (`attachedTo`).
      attachedTo(async (/** @type {AbortSignal} */ signal) => {
        if (ownMark) await ownMark.catch(() => null);
        // One on another machine whose copy there was never made — its launch stopped or refused while it went —: made
        // now, its first message ahead of these words, unless they are that message's own task asked again.
        const first = unplaced.get(sa.id);
        if (first) {
          const opening = await first(signal);
          return retry && text === sa.exchanges[0]?.prompt ? opening : withUserText(opening, text);
        }
        const copy = await reopenWork(sa, asker !== "agent");
        if (why) return afresh(sa, text, { why, asker, handed: handed.source });
        // A retry goes on from where the failed exchange left the conversation: its question, still unanswered there,
        // is asked as it stands — never said twice; one it had begun working on hears that it is asked again.
        if (retry) return unanswered(convo, text) ? (copy ? withUserText(convo, copy) : convo) : withUserText(copy ? withUserText(convo, copy) : convo, `${RETRY_HEAD}\n\n${text}`);
        // The developer's next message to one that was shown the session carries what happened since (BW-7). The main
        // agent's own follow-up says what it wants said: nothing is added to it — save to a saved agent, which reads
        // the session itself, whoever asks (AG-51).
        const since = asker === "agent" && !sa.asked ? null : await sinceOf(sa);
        const patch = handed.source ? await handedOf(sa, handed.source) : null;
        const before = [...(copy ? [copy] : []), ...(synced ? [synced] : []), ...(since ? [since] : []), ...(patch ? [patch] : [])];
        return withUserText(before.reduce(withUserText, convo), text);
      }, attached),
      { prompt: text, description: lineOf(description, text), by: asker, parent, pictures: attached?.images.map((i) => i.name) || [], files: attached?.files.map((f) => f.name) || [], handed: handed.source, fresh: why, why: asker === "self" ? started : null, folder },
    );
    if (asker === "owner" || asker === "self")
      mark(sa, "dispatch", { model: sa.model, view: sa.view, may: sa.may, memory: sa.memory, deliver: sa.deliver, followUp: true, ...(handed.source ? { handed: handed.source } : {}), ...askedOf(sa, text, asker === "self" ? started : null) });
    return { ok: true, id: sa.id, done, marked };
  }

  /**
   * Why a graph task's worker has no conversation to go on in, or null where it has one: one it let go (`prune`), or
   * one a restart took. Sent back, a worker goes on in the conversation it had — a fresh one would read the task's
   * next step alone, as though it were the whole of it (Fable 5.2's review of 11-17). One on another machine has its
   * chat there.
   * @param {Subagent} sa
   */
  const convoGone = (sa) =>
    sa.remote || !sa.restored ? null : sa.restored === "let-go" ? "Filament let its conversation go to keep its memory bounded" : "Filament restarted since it ran, and its conversation went with it";

  /**
   * Why a graph task's sub-agent can't go on with its task, sent back (HarnessV3-FailurePoints §6 item 4), or null when
   * it can: Filament holds it — no restart keeps one — and the model it ran on can still run an agent (AG-243): it
   * goes on on its own model, whatever a new worker would be given.
   * @param {string} id @param {string} chainId
   */
  function resumable(id, chainId) {
    const sa = subs.get(String(id || ""));
    if (!sa || sa.chainId !== String(chainId || "")) return "Filament restarted since it ran, and its conversation went with it";
    if (!sa.task) return "it does no task of the task graph";
    if (sa.status === "running") return "it is still working";
    const gone = convoGone(sa);
    if (gone) return gone;
    const problem = ctx?.modelProblem(sa.model) || null;
    return problem ? `it ran on ${sa.model}, which cannot run an agent now (${problem})` : null;
  }

  /**
   * The registry's word on the Hunter a graph task's `found_by` names (11-02): its id, its name as shown, the task it was
   * fired from and the start of the graph that held it (null where its launch read none) — or, where the id names no
   * hunt of this chat's fired from a task, what it is instead, in words. A thread the session kept is read back first.
   * @param {string} id @param {string} chainId
   * @returns {{ agent: string, name: string, task: string, graph: number | null } | { error: string }}
   */
  function huntOf(id, chainId) {
    const chain = String(chainId || "");
    recall(chain);
    const sa = subs.get(String(id || ""));
    if (!sa || sa.chainId !== chain) return { error: `${noSuchSubagent(id)} — found_by names a bug hunt sent from a task on the Plan, by the id its report gives` };
    if (!sa.hunts) {
      const what = sa.task ? `the ${sa.task.review ? "reviewer" : "worker"} of task ${sa.task.id}` : sa.taskWas ? `the worker that did task ${sa.taskWas}` : `${sa.card.name}'s run "${sa.description}"`;
      return { error: `${sa.id} is ${what}, sent from no task on the Plan — found_by names a bug hunt sent from one` };
    }
    return { agent: sa.id, name: sa.card.name, task: sa.hunts, graph: sa.hunted ? sa.hunted.graph : null };
  }

  /**
   * The graph's runner goes on with a graph task's sub-agent (HarnessV3-TaskGraph G3-3), in the conversation it has:
   * its worker, with the changes its review asked for, or sent back with what failed (HarnessV3-FailurePoints §6
   * item 2), or its reviewer, with the change to read again. Like its launch, its end is the runner's; `requestId` is
   * the turn it runs for now — its lineage, and whose spend it is — none where no turn runs: a change the folder's check
   * sent back goes back all the same (the bug report of 11-10). `check`: its task's check as the task stands now,
   * where its planner sent it back (HarnessV3-TaskGraph-v2 TG2-D63) — the planner may have changed it since, or the
   * commands its report named are the task's: Filament runs that when it reports, and with none its next report's commands
   * are taken. What the folder's check added (V2-2) stays beside it, and so does its team's (the plan's p6). `waits`:
   * where it has no room now, it waits for its room as a lead's worker does (§5.7) rather than being refused — what it
   * waits for, and when it has it, in the answer (`roomOf`).
   * @param {string} id @param {{ chainId: string, prompt: string, requestId: string | null, check?: readonly string[], waits?: boolean }} o
   * @returns {{ ok: true, id: string, done: Promise<Outcome>, waiting?: string, room?: Promise<boolean> } | { ok: false, error: string }}
   */
  function resumeTask(id, { chainId, prompt, requestId, check, waits = false }) {
    const sa = subs.get(String(id || ""));
    if (!sa || sa.chainId !== String(chainId || "")) return { ok: false, error: noSuchSubagent(id) };
    if (!sa.task) return { ok: false, error: `sub-agent ${sa.id} does no task of the task graph` };
    if (sa.status === "running") return { ok: false, error: `sub-agent ${sa.id} is still working` };
    const gone = convoGone(sa);
    if (gone) return { ok: false, error: `sub-agent ${sa.id} can't go on with its task: ${gone}` };
    const full = ceilingProblem(sa.chainId, true, null, sa.list, null, sa.model) || seatProblem(sa);
    if (full && !waits) return { ok: false, error: full };
    sa.waiting = full ? { since: now(), why: full, rows: sa.crew ?? null } : null;
    if (check) {
      // Its task's own check and the commands its report named go as the task stands now; its team's check (the plan's
      // p6), kept on its team where its launch gave it, stays beside them.
      const was = new Set([...(sa.taskCheck || []), ...(sa.taken || [])]);
      const list = [...new Set([...check, ...(sa.grants?.check || []).filter((c) => !was.has(c)), ...(sa.team?.check ? [sa.team.check] : [])])];
      const g = sa.grants;
      sa.grants = list.length || g?.mayRun.length || g?.card ? { check: list, mayRun: g?.mayRun || [], ...(g?.card ? { card: g.card } : {}) } : null;
      sa.taskCheck = [...check];
      sa.taken = null;
    }
    sa.requestId = requestId;
    // Sent back to rebase, it goes on with it now.
    delete sa.rebaseDue;
    const messages = withUserText(sa.convo, prompt);
    const wait = roomOf(sa);
    const done = exchange(
      sa,
      async () => {
        // Its room first, where it waits for it: its copy is taken up again once it goes on.
        if (sa.waiting) await turnFor(sa);
        wait?.had();
        await reopenWork(sa);
        return messages;
      },
      { prompt, description: sa.description, by: "agent", parent: null },
    );
    wait?.endsWith(done);
    return { ok: true, id: sa.id, done, ...(wait ? { waiting: wait.words, room: wait.room } : {}) };
  }

  /**
   * The developer passes a report they kept aside on to the main agent. `when` (BW-8): "now" — into its running turn
   * at the next round, else with the session's next turn; "next" — with the developer's next message, which a turn
   * running now never reads by itself (`release`). `n` names the exchange (the newest by default). `told`: the
   * session's switch sends it, for an agent that started by itself (`deliveryText`).
   * @param {string} id @param {string} chainId @param {number} [n] @param {{ when?: "now" | "next", told?: boolean }} [opts]
   * @returns {{ ok: true, into: "turn" | "queue" } | { ok: false, error: string }}
   */
  function send(id, chainId, n = -1, { when = "now", told = false } = {}) {
    recall(String(chainId || ""));
    const wait = when === "next";
    const sa = subs.get(String(id || ""));
    if (!sa) return sendKept(String(id || ""), String(chainId || ""), n, wait);
    if (sa.chainId !== String(chainId || "")) return { ok: false, error: noSuchSubagent(id) };
    const ex = sa.exchanges.at(n);
    if (!ex) return { ok: false, error: `sub-agent ${sa.id} has no exchange ${n}` };
    if (!ex.outcome) return { ok: false, error: `sub-agent ${sa.id} is still working; its report comes first` };
    if (ex.delivery === "sent" || ex.delivery === "auto") return { ok: false, error: `that report of ${sa.id} is already with the main agent` };
    if (ex.delivery === "tool") return { ok: false, error: `that report of ${sa.id} was the agent's own call's answer` };
    if (ex.delivery === "task") return { ok: false, error: `that report of ${sa.id} ended task ${sa.task?.id} of the task graph, and the agent heard it as it ended` };
    if (ex.delivery === "back") return { ok: false, error: `that report of ${sa.id} went back to it: Filament's check of its change failed, and the report it gave after that is the one to send` };
    if (ex.delivery === "weighed") return { ok: false, error: `that report of ${sa.id} weighed your message for the agent, and Filament acted on it: the answer, the tasks or the letter are what it made of it` };
    ex.delivery = "sent";
    dropHeld(sa.chainId, sa.id, sa.exchanges.indexOf(ex));
    deliver(sa, ex.outcome, taskOf(sa, sa.exchanges.indexOf(ex)), { exchange: sa.exchanges.indexOf(ex), late: true, wait, told });
    // Kept on the session whether a turn runs or not: the arrival row says "sent" after a restart too.
    ctx?.mark(sa.chainId, { event: "sent", at: now(), agentId: sa.id, exchange: sa.exchanges.indexOf(ex), description: sa.description });
    changed(sa);
    return { ok: true, into: !wait && liveTurnOf(sa.chainId) ? "turn" : "queue" };
  }

  /**
   * The developer's note went into the session's running turn: what waited for their next message goes with it, and
   * the turn reads both at its next step. Only a `send` with "next" leaves anything on the queue while a turn runs.
   * @param {string} chainId
   * @returns {number}  how many messages went
   */
  function release(chainId) {
    const c = chains.get(chainId);
    const live = liveTurnOf(chainId);
    if (!c || !live || !c.queue.length) return 0;
    const waiting = c.queue.splice(0);
    live.inbox.push(...waiting);
    for (const w of [...live.wake]) w();
    return waiting.length;
  }

  /**
   * The developer overrules what saved agents answered the session's agent (HarnessV4_Tasks E15 step 3, L-27): for
   * each answer, the message that tells the agent whose answer the developer's words stand over, and to which
   * question. Their words travel as their own message. Nothing is queued or recorded here: a turn that carries the
   * messages records them once it can no longer be refused (`overruled`). `list` names each answer by its agent and
   * exchange; `name` and `question` are the page's, read only where the registry holds that agent no longer (a
   * restart).
   * @param {string} chainId @param {unknown} list
   * @returns {Delivery[]}
   */
  function overruleFrames(chainId, list) {
    /** @type {Delivery[]} */
    const out = [];
    recall(chainId);
    for (const o of Array.isArray(list) ? list.slice(0, MAX_OVERRULED) : []) {
      const id = String(o?.agentId ?? "").trim();
      const sa = subs.get(id);
      if (!id || (sa && sa.chainId !== chainId) || out.some((d) => d.from === id && d.exchange === (Number(o?.exchange) || 0))) continue;
      const exchange = Number(o?.exchange) || 0;
      const ex = sa?.exchanges[exchange] || null;
      const name = sa?.card?.name || clip(String(o?.name ?? "").trim(), 40) || "a saved agent";
      const question = String(ex?.prompt ?? o?.question ?? "").trim();
      const said = String(ex?.outcome?.report ?? "").split("\n").map((l) => l.trim()).find(Boolean) || "";
      out.push({
        text: [
          `[Filament: the developer overrules ${name}'s answer${question ? " to your question:" : "."}`,
          ...(question ? [cut(question, 600)] : []),
          ...(said ? [`(${name} answered: ${clip(said, 200)})`] : []),
          `Their own words reach you with this, as their message, and stand over ${name}'s advice.]`,
        ].join("\n"),
        from: id,
        description: name,
        kind: "overrule",
        exchange,
        spends: [],
        wrote: false,
      });
    }
    return out;
  }
  /**
   * The overrule went out with the developer's words: each answer's card reads it from the session, now and after a
   * restart. `words`: what the developer wrote, whose first line the card shows.
   * @param {string} chainId @param {readonly Delivery[]} frames @param {string} words
   */
  function overruled(chainId, frames, words) {
    const line = clip(String(words || "").split("\n").map((l) => l.trim()).find(Boolean) || "", 200);
    for (const d of frames) {
      const stored = ctx?.mark(chainId, { event: "overruled", at: now(), agentId: d.from, exchange: Number(d.exchange) || 0, description: d.description, words: line }) ?? null;
      if (stored) events.publish("subagents", { type: "subagent-mark", chainId, mark: stored });
    }
  }
  /**
   * An overrule whose words go into a turn that runs, or that a waiting question's answer resumes: the messages join
   * what that turn reads next, and are recorded.
   * @param {string} chainId @param {unknown} list @param {string} words
   * @returns {number}  how many answers it overrules
   */
  function overrule(chainId, list, words) {
    const frames = overruleFrames(chainId, list);
    for (const d of frames) enqueue(chainId, d);
    overruled(chainId, frames, words);
    return frames.length;
  }

  /**
   * The saved agents a developer's message to the main agent names with an `@` past its start, which the page found
   * (HarnessV4_OneAgent_Plan OA2): each card once, in the message's order — none started; the main agent is told to use
   * them (core/messages.js `useLine`). A tag no card holds, or a team's own Lead's (OA-D4), is the message's own text.
   * @param {unknown} tags @returns {{ tag: string, name: string }[]}
   */
  function usesOf(tags) {
    /** @type {{ tag: string, name: string }[]} */
    const out = [];
    for (const t of Array.isArray(tags) ? tags : []) {
      const tag = String(t ?? "").trim().replace(/^@/, "").toLowerCase();
      const card = tag ? cardOf(tag) : null;
      if (card && !card.partOf && !out.some((a) => a.tag === card.tag)) out.push({ tag: card.tag, name: card.name });
    }
    return out;
  }
  /**
   * The saved agents the session's main agent used since a moment (HarnessV4_OneAgent_Plan OA-D12): each card it
   * launched or followed up on itself — not a team's lead, not the developer — with an exchange begun since then. Their
   * tags: what a turn's line on an agent it was named and did not use reads.
   * @param {string} chainId @param {number} since @returns {Set<string>}
   */
  function usedSince(chainId, since) {
    /** @type {Set<string>} */
    const out = new Set();
    for (const sa of subs.values())
      if (sa.chainId === chainId && !sa.team && sa.exchanges.some((x) => x.by === "agent" && Number(x.startedAt) >= since)) out.add(sa.card.tag);
    return out;
  }

  /**
   * Send on a report the session kept for the developer after the registry forgot its sub-agent (a restart): the kept
   * words go to the main agent as the registry's own send would put them, and the arrival row reads "sent".
   * @param {string} id @param {string} chainId @param {number} n  the exchange; -1 is that sub-agent's newest kept one
   * @param {boolean} wait  with the developer's next message, never into the turn running now
   * @returns {{ ok: true, into: "turn" | "queue" } | { ok: false, error: string }}
   */
  function sendKept(id, chainId, n, wait) {
    const mine = heldOf(chainId).filter((h) => h.agentId === id);
    const h = n < 0 ? mine.at(-1) : mine.find((x) => x.exchange === n);
    if (!h) return { ok: false, error: `${noSuchSubagent(id)} and no report of it is kept for you` };
    dropHeld(chainId, id, h.exchange);
    enqueue(chainId, { text: h.text, from: id, description: h.description, kind: "report", exchange: h.exchange, sent: true, spends: [], wrote: false }, { wait });
    ctx?.mark(chainId, { event: "sent", at: now(), agentId: id, exchange: h.exchange, description: h.description });
    return { ok: true, into: !wait && liveTurnOf(chainId) ? "turn" : "queue" };
  }

  /**
   * The developer applied a sub-agent's changes (HarnessV4_Tasks E15 step 5, BW-8): one line for the session's agent —
   * which files changed under it — read at its running turn's next step, else with the developer's next message,
   * and kept across a restart as a report is. Without it the agent edits a file as it remembers it, over the change.
   * `marked`: the files they chose to take with git's conflict markers in them (the Designer's of 10-27), theirs to
   * resolve: the agent leaves those alone.
   * @param {string} id @param {string} description @param {readonly { path: string }[]} files @param {readonly string[]} [marked]
   */
  const appliedText = (id, description, files, marked = []) => {
    const n = files.length;
    const named = files.slice(0, MAX_APPLIED_NAMED).map((f) => f.path).join(", ");
    const m = marked.length;
    const markers = m ? ` ${marked.slice(0, MAX_APPLIED_NAMED).join(", ")}${m > MAX_APPLIED_NAMED ? `, and ${m - MAX_APPLIED_NAMED} more,` : ""} ${m === 1 ? "has" : "have"} git's conflict markers in ${m === 1 ? "it" : "them"} — their edits and the sub-agent's, both — for the developer to resolve: leave ${m === 1 ? "that file" : "those files"} alone unless they ask you to.` : "";
    return `[Filament: the developer applied the changes of sub-agent ${id}${description ? ` ("${description}")` : ""} to your folder: ${n} file${n === 1 ? "" : "s"} changed under you — ${named}${n > MAX_APPLIED_NAMED ? `, and ${n - MAX_APPLIED_NAMED} more` : ""}. What you read of ${n === 1 ? "it" : "them"} before may be out of date: read again before you edit.${markers}]`;
  };

  /**
   * The work an apply takes: a sub-agent's change that waits — or why there is none to take.
   * @param {string} key @param {string} chain
   * @returns {Promise<{ ok: true, w: { sa: Subagent | null, repo: string, base: string, head: string } } | { ok: false, error: string }>}
   */
  const waitingWork = async (key, chain) => {
    // An attempt another won: its work was dropped (TG2-D53).
    const known = subs.get(key);
    const dropped = known && known.chainId === chain ? droppedWords(known, true) : null;
    if (dropped) return { ok: false, error: dropped };
    if (subs.get(key)?.status === "running") return { ok: false, error: `sub-agent ${key} is still working; apply its changes once it reports` };
    if (known && known.chainId === chain && rebaseDue(known)) return { ok: false, error: `sub-agent ${key} was sent back to rebase: its work waits again once it has redone it` };
    const w = await workOf(key, chain);
    if (!w.ok) return w;
    if (w.base === w.head) return { ok: false, error: noneWaits(key, w.sa) };
    return { ok: true, w };
  };
  /**
   * Why nothing of a sub-agent's work waits, in words: where its newest apply is a mark, whose mark — an Apply refused
   * after it would otherwise read as if nothing had ever waited.
   * @param {string} key @param {Subagent | null} sa
   */
  const noneWaits = (key, sa) => {
    const a = sa?.work?.applied.at(-1);
    if (a?.hand && a.by === "found") return `sub-agent ${key}'s changes were found in the folder already, brought in another way: nothing of them waits`;
    return a?.hand ? `sub-agent ${key}'s changes were marked as applied by ${a.by === "agent" ? "the session's agent" : "the developer"}: nothing of them waits` : `sub-agent ${key} has no changes waiting to be applied`;
  };
  /**
   * A sub-agent's work went in: its base moves to it, nothing of it waits, and the apply is kept — who, how many files,
   * and the reason where one came with it. → the apply as kept, which an undo takes back (TG2-D55); none where the
   * registry holds no work of it.
   * @param {Subagent | null} sa @param {string} head @param {number} files @param {string} by
   * @param {{ reason?: string | null, came?: import("../../adapters/git/worktree.js").Came[], hand?: Applied["hand"] }} [o]
   *   `came`: how its files came in; `hand`: it was marked as applied, what waited kept for the mark's undo
   */
  const appliedTo = (sa, head, files, by, { reason = null, came, hand } = {}) => {
    if (!sa?.work) return null;
    /** @type {Applied} */
    const entry = { at: now(), files, by, ...(reason ? { reason } : {}), ...(came ? { came: cameCount(came) } : {}), ...(hand ? { hand } : {}) };
    sa.work.base = head;
    sa.work.files = [];
    // Its copy on another machine: what comes back next is measured from here, held while nothing else holds it.
    if (sa.work.there && sa.remote?.copy) void holdCopyCommit(sa.work.repo, sa.id, sa.remote.copy.commit, head).catch(() => false);
    unsettle(sa);
    sa.work.applied.push(entry);
    changed(sa);
    return entry;
  };
  /**
   * What an apply wrote, told (`appliedWrote`, 10-29): its files but those the developer kept as theirs or that came in
   * the same — for Changes to keep under the sub-agent's name until committed. Awaited inside the apply's hold on the
   * repository, before the apply says itself — its row's event, its answer —, on whose word the Changes tab reads again:
   * told after, that read found its files no one's (found reviewing the Changes tab, 10-29). It never fails an apply.
   * @param {string} chain @param {string} key @param {string} repo
   * @param {readonly import("../../adapters/git/worktree.js").ChangedFile[]} files
   * @param {readonly import("../../adapters/git/worktree.js").Came[] | undefined} came
   */
  const wroteBy = async (chain, key, repo, files, came) => {
    const not = new Set((came || []).filter((c) => c.how === "kept" || c.how === "same").map((c) => c.path));
    const paths = files.map((f) => f.path).filter((p) => !not.has(p));
    if (!paths.length) return;
    try {
      await ctx?.appliedWrote?.({ chainId: chain, agentId: key, repo, paths });
    } catch {}
  };

  /**
   * Accept a sub-agent's work: its pending changes, from its worktree into the session's folder — merged three ways
   * where the folder changed meanwhile, and all or nothing. `by` says who accepted (owner, command, agent). It works
   * after a restart too, from the repository's refs, once the registry has forgotten the sub-agent. `reason`: why a
   * change Filament's check saw fail goes in anyway, kept with the apply (HarnessV3-TaskGraph-v2 TG2-D45) — or the
   * folder's check after the lead's apply before (TG2-D55). `lead`: a team's lead applies, and Filament checks the folder
   * with the change (`leadApply`); the call hears the verdict within `holdMs`, else how the apply stands then.
   * `choices`: the developer's, by path, for files that overlapped theirs — kept as theirs, taken as its, or both with
   * git's markers (the Designer's of 10-27, built 10-28). `overlap`: the agent's for every file that overlapped the
   * folder's edits (the owner's of 11-09) — "markers" or "mine" as those choices are made, its change to the files kept
   * as the folder had them held for reading (`aside`); "send_back", the change sent back to rebase once the apply is
   * refused (`backOver`), its follow-up the agent's — `parent`, its call — or the lead's. A task graph's merge takes
   * the agent's three — a lead's, checked, send_back alone — and with none sends it back by itself (`mergeBack`).
   * @param {string} id @param {string} chainId @param {string} [by]
   * @param {{ reason?: string | null, lead?: LeadCall | null, holdMs?: number, choices?: Readonly<Record<string, import("../../adapters/git/worktree.js").ApplyChoice>>, overlap?: Overlap | null, parent?: LaunchParent | null }} [o]
   * @returns {Promise<ApplyResult>}
   */
  function apply(id, chainId, by = "owner", { reason = null, lead = null, holdMs = 0, choices = {}, overlap = null, parent = null } = {}) {
    const key = String(id || "").trim().toLowerCase();
    const chain = String(chainId || "");
    const slot = `${chain}\n${key}`;
    // The agent's apply — a lead's too — of a graph task's change that waits for it (the owner's of 11-02): the graph's
    // checked merge, the call answered once the change is in the folder (`taskApplied`). Asked before the graph hears of
    // it (`askOpen`), so nothing else writes the same work meanwhile; asked already, this call hears that apply. Not while
    // the developer's own apply, mark or rebase of it runs: those answer as they do below. One the graph could not take
    // — it threw — opens nothing, and its call says so: what was asked is let go, so nothing waits on it.
    if (by === "agent" && !applying.has(slot) && !marking.has(slot) && !rebasing.has(slot)) {
      const was = asked.get(slot);
      if (was) return was.opened.then((o) => ("cycle" in o ? landedOf(o.cycle) : o.error));
      const a = askOpen(slot, chain);
      /** @type {ReturnType<NonNullable<SubagentContext["taskApply"]>> | null} */
      let graph;
      try {
        graph = ctx?.taskApply?.({ chainId: chain, agentId: key, reason }) ?? null;
      } catch (/** @type {any} */ e) {
        /** @type {ApplyResult} */
        const failed = { ok: false, error: `the apply failed (${String(e?.message || e)})` };
        a.open({ error: failed });
        return Promise.resolve(failed);
      }
      if (!graph?.ok) a.open({ error: { ok: false, error: graph && !graph.ok ? graph.error : "no task of the graph's waits on it" } });
      if (graph) return graph.ok ? taskApplied(key, chain, slot, { reason, stands: graph.stands, overlap, team: !!lead }, a) : Promise.resolve({ ok: false, error: graph.error });
    }
    // Its send_back goes with its cycle, on the verdict, which may come after the call has answered (`openCycle`).
    if (lead) return leadApply(key, chain, slot, { reason, lead, holdMs, back: overlap === "send_back" }).catch((/** @type {any} */ e) => /** @type {ApplyResult} */ ({ ok: false, error: `the apply failed (${String(e?.message || e)})` }));
    // A checked apply of it is asked or runs — the planner's, the graph's merge: this one is refused, and that one's end
    // says what came of it.
    if (cycles.has(slot) || asked.has(slot)) return Promise.resolve({ ok: false, error: `sub-agent ${key}'s work is being applied now, and the folder checked with it — its end comes as a message` });
    const inFlight = applying.get(slot);
    if (inFlight) return inFlight;
    const settle = settling.has(slot) ? marking.get(slot) : null;
    if (settle) {
      aheadOfMark(slot);
      return settle.then(() => apply(id, chainId, by, { reason, lead, holdMs, choices, overlap, parent }));
    }
    if (marking.has(slot)) return Promise.resolve({ ok: false, error: `sub-agent ${key}'s work is being marked as applied now` });
    if (rebasing.has(slot)) return Promise.resolve({ ok: false, error: rebasingWords(key) });
    const merge = overlap === "send_back" ? null : overlap;
    /** @returns {Promise<ApplyResult>} */
    const accept = async () => {
      const got = await waitingWork(key, chain);
      if (!got.ok) return got;
      const w = got.w;
      /** @type {{ base: string, head: string } | null} */
      let aside = null;
      const r = await inRepoAhead(w.repo, async () => {
        const marks = await rebaseMarks(w.repo, w.head, w.base);
        const out = await applyTaskWork(w.repo, { base: w.base, head: w.head }, { choices, overlap: merge });
        // Its change to the files kept as the folder had them stays readable: its commits held as a mark's are, for as
        // long, where they would otherwise go with its refs.
        if (out.ok && merge && out.came.some((c) => c.how === "kept")) aside = { base: w.base, head: w.head };
        if (out.ok && !(await (aside ? holdMarkedWork(w.repo, key, aside) : dropTaskRefs(w.repo, key)))) await markApplied(w.repo, key, w.head);
        if (out.ok) await wroteBy(chain, key, w.repo, out.files, out.came);
        return out.ok ? { ...out, came: withRebaseMarks(out.came, marks) } : out;
      });
      // The agent's own refused apply names its ways on (`overlapWays`); the developer has theirs in Changes.
      if (!r.ok) return by === "agent" ? { ...notApplied(r), takes: w.sa?.work?.there ? THERE_OVERLAPS : OVERLAPS } : notApplied(r);
      // The developer's own apply: the session's agent hears which files changed under it — none they kept as theirs —
      // and leaves alone those they took with markers, or that came with the markers a rebase left in it (the
      // Hunter's of 10-28). Its own apply it made itself, a command's answer stands in the chat it reads, and the graph
      // tells its merges.
      const kept = new Set((r.came || []).filter((c) => c.how === "kept").map((c) => c.path));
      const under = r.files.filter((f) => !kept.has(f.path));
      const marked = (r.came || []).filter((c) => c.how === "markers").map((c) => c.path);
      appliedTo(w.sa, w.head, r.files.length, by, { reason, came: r.came });
      ctx?.workApplied?.({ chainId: chain, agentId: key, files: r.files, marked, repo: w.repo });
      if (by === "owner" && under.length) enqueue(chain, { text: appliedText(key, w.sa?.description || "", under, marked), from: key, description: w.sa?.description || key, kind: "applied", spends: [], wrote: false });
      return { ok: true, files: r.files, came: r.came, repo: w.repo, ...(aside ? { aside } : {}) };
    };
    const p = accept()
      .catch((/** @type {any} */ e) => /** @type {ApplyResult} */ ({ ok: false, error: `the apply failed (${String(e?.message || e)})` }))
      .finally(() => applying.delete(slot));
    applying.set(slot, p);
    return overlap === "send_back" ? p.then((r) => backOver(r, key, chain, { parent })) : p;
  }

  /**
   * The agent's send_back (the owner's of 11-09): an apply refused where its change overlapped edits in the folder goes
   * back to its sub-agent to redo on the folder as it stands (`rebase`), as the developer's Send back does — its follow-up
   * the agent's, `parent` its call, or `lead`'s, so its report comes back as any report does. Only where the apply takes
   * it (`takes`); any other answer stands as it is. Asked once the apply has let its sub-agent's work go.
   * @param {ApplyResult} r @param {string} key @param {string} chain @param {{ parent?: LaunchParent | null, lead?: LeadCall | null }} o
   * @returns {Promise<ApplyResult>}
   */
  const backOver = async (r, key, chain, { parent = null, lead = null }) => {
    if (r.ok || r.partial || !r.takes?.includes("send_back") || !r.conflicts?.some((c) => c.kind)) return r;
    const back = await rebase(key, chain, { by: "agent", parent, lead });
    return { ...r, sentBack: back.ok ? { ok: true, marked: back.marked, left: back.left } : { ok: false, error: back.error } };
  };
  /**
   * A task graph's merge refused where its change overlapped the folder's edits (the owner's of 11-09: tasks may overlap
   * on files, their conflicts resolved at merge as a team does): with no way of its planner's, or its send_back, its
   * change goes back to its worker to redo on the folder as it stands — the graph's to allow, by Filament itself twice
   * at most (`rebaseTask`) — from inside the merge's apply, so the planner's call hears it. Its refusal names the ways on
   * its planner's apply takes (`takes`: a lead's, send_back alone). Nothing of it is written into the folder. Any other
   * answer, or work no graph task's, stands as it is.
   * @param {ApplyResult} r @param {string} key @param {string} chain @param {{ overlap: Overlap | null, team: boolean }} o
   * @returns {Promise<ApplyResult>}
   */
  const mergeBack = async (r, key, chain, { overlap, team }) => {
    if (r.ok || r.partial || !r.conflicts?.some((c) => c.kind)) return r;
    const sa = subs.get(key);
    if (sa && !sa.task && !sa.taskWas) return r;
    const why = r.conflicts.map((c) => `${c.path}: ${c.why}`).join("; ");
    const back = await redo(key, chain, { by: "agent", merge: { asked: overlap === "send_back", why, team } });
    const sentBack = back.ok ? { ok: /** @type {const} */ (true), marked: back.marked, left: back.left, ...(back.n ? { n: back.n } : {}) } : { ok: /** @type {const} */ (false), error: back.error };
    return { ...r, takes: team ? LEAD_OVERLAPS : OVERLAPS, graph: true, sentBack };
  };

  /** @typedef {{ ok: true, files: import("../../adapters/git/worktree.js").ChangedFile[], repo: string } | { ok: false, error: string }} MarkResult */
  /**
   * One mark as applied, or its undo, at a time on a sub-agent's work, and never beside its apply: `act` runs in the
   * sub-agent's slot, a failure under it said in `failed`'s words; `own`, Filament's own (`settling`).
   * @param {string} key @param {string} chain @param {() => Promise<MarkResult>} act @param {string} failed @param {boolean} [own]
   * @returns {Promise<MarkResult>}
   */
  const marked = (key, chain, act, failed, own = false) => {
    const slot = `${chain}\n${key}`;
    if (applying.has(slot)) return Promise.resolve({ ok: false, error: `sub-agent ${key}'s work is being applied now` });
    const settle = settling.has(slot) ? marking.get(slot) : null;
    if (settle) {
      aheadOfMark(slot);
      return settle.then(() => marked(key, chain, act, failed, own));
    }
    if (marking.has(slot)) return Promise.resolve({ ok: false, error: `sub-agent ${key}'s work is being marked as applied now` });
    if (rebasing.has(slot)) return Promise.resolve({ ok: false, error: rebasingWords(key) });
    const p = act()
      .catch((/** @type {any} */ e) => /** @type {MarkResult} */ ({ ok: false, error: `${failed} (${String(e?.message || e)})` }))
      .finally(() => {
        marking.delete(slot);
        settling.delete(slot);
      });
    marking.set(slot, p);
    if (own) settling.add(slot);
    return p;
  };

  /**
   * Mark a sub-agent's waiting work as applied (10-29): its change came into the folder another way — its apply refused
   * where it overlapped the developer's edits, and brought in by hand — and the developer, or the session's agent, says
   * so. Nothing is written. Its refs go as an apply's do, so nothing of it waits after a restart either — its commits
   * held under refs of their own while the mark can be undone (`holdMarkedWork`) — and the mark is kept as an apply by
   * `by` with what waited, which its undo (`unmarkTaken`) makes wait again. The work is read again and moved under the
   * repository's lock, as a lead's apply reads it: one applied first leaves nothing to mark. A task of the task graph is
   * the graph's, which reads its change as merged once it is applied: its work is marked only where its graph's word
   * (`taskMark`) says the mark can end it — its change waits for an apply — and the graph is told then, as the developer's
   * Apply tells it (`workApplied`; the bug report of 11-10: a change its planner brought in by hand left its task merging
   * for good). With no graph to ask it is not marked, nor one given back after a restart. Work a restart kept on its
   * refs alone has no thread to keep a mark in, and work in a copy still open has its refs to keep it: neither is marked.
   * @param {string} id @param {string} chainId @param {string} [by]
   * @returns {Promise<MarkResult>}
   */
  function markTaken(id, chainId, by = "owner") {
    const key = String(id || "").trim().toLowerCase();
    const chain = String(chainId || "");
    return marked(key, chain, async () => {
      const first = await waitingWork(key, chain);
      if (!first.ok) return first;
      return inRepoAhead(first.w.repo, async () => {
        const got = await waitingWork(key, chain);
        if (!got.ok) return got;
        const { sa, repo, base, head } = got.w;
        if (!sa?.work) return { ok: false, error: `Filament restarted since sub-agent ${key} ran, and its conversation, where a mark is kept, went with it: apply its work with your choices — Keep yours where your folder has it already` };
        // Its graph's word, where it has one (the bug report of 11-10): a change that waits for its apply is marked, and
        // its task ends as an apply's would — told below.
        const word = sa.task || sa.taskWas ? ctx?.taskMark?.({ chainId: chain, agentId: key }) : null;
        if (word) return { ok: false, error: `sub-agent ${key} ${sa.task ? "does" : "did"} task ${sa.task?.id ?? sa.taskWas} of the task graph, and it can't be marked as applied now: ${word}` };
        if (word === undefined && sa.task) return { ok: false, error: `sub-agent ${key} does task ${sa.task.id} of the task graph, which reads its change as merged once it is applied: apply it, or drop the task` };
        if (word === undefined && sa.taskWas) return { ok: false, error: `sub-agent ${key} did task ${sa.taskWas} of the task graph before Filament restarted, and the graph reads its change as merged once it is applied: apply it with your choices — Keep yours where your folder has it already` };
        // Its refs are what keeps an open copy's work, should Filament stop before it is captured again.
        if (sa.work.wt) return { ok: false, error: `sub-agent ${key}'s copy is still open${sa.work.error ? ` (its work could not be captured: ${sa.work.error})` : ""}` };
        // Read from git: the thread a restart gives back keeps the first 200 of its files.
        const files = await changedFiles(repo, base, head);
        if (!(await holdMarkedWork(repo, key, { base, head }))) return { ok: false, error: "git would not keep the mark: its work waits as it did" };
        appliedTo(sa, head, files.length, by, { hand: { base, head } });
        if (sa.task || sa.taskWas) ctx?.workApplied?.({ chainId: chain, agentId: key, files, repo });
        return { ok: true, files, repo };
      });
    }, "it could not be marked as applied");
  }

  /**
   * What each sub-agent's last read of its waiting work against the folder stood on, and found (`settleFound`); gone
   * once nothing of its work waits (`appliedTo`).
   * @type {WeakMap<Subagent, import("../../adapters/git/worktree.js").ApplyStamp>}
   */
  const settledOn = new WeakMap();
  /** How many times each sub-agent's read so far was let go (`unsettle`): a read begun before keeps nothing. @type {WeakMap<Subagent, number>} */
  const unsettled = new WeakMap();
  /**
   * What a sub-agent's last read stood on goes (`settledOn`), and so does whatever a read in flight would keep: nothing
   * of its work waits as it was read any more — applied, marked, found, dropped, redone, captured anew or gone.
   * @param {Subagent} sa
   */
  const unsettle = (sa) => {
    settledOn.delete(sa);
    unsettled.set(sa, (unsettled.get(sa) || 0) + 1);
  };
  /**
   * A sub-agent's waiting work found in the folder already (the owner's of 10-30: a helper's work brought in with git or
   * by hand, never applied nor marked, kept every alert of it up): each of its files is as it left it, or holds its
   * change beside edits of the developer's own — its apply would write nothing, and nothing stops it. Kept as a mark is,
   * by Filament (`found`), nothing written and its undo kept. Work with a file that differs still waits: whether the
   * folder went past it or against it is the developer's to say. Never a task of the graph's — its apply tells the graph
   * —, nor work a mark would not take (`markTaken`), nor one a mark, an apply or a rebase moves now. It is read in the
   * repository's turn (`inRepo`) holding nothing of the sub-agent's, so a follow-up asked meanwhile goes ahead — during
   * its mark too: the mark's read stops, and a mark that finds the sub-agent at work marks nothing (`followUp`); and
   * whoever comes to write in that turn — an Apply, a mark, a rebase — goes ahead of it (`inRepoAhead`), where a dry run
   * or a Compare waits for it: the read is stopped, its git ended, and it reads once more after (`again`). Found whole, it
   * is held as a mark is — an Apply, a mark or a rebase asked then waits for it (`settling`), the other reads in its
   * repository stopped (`aheadOfMark`) — and read again in the repository's turn, its mark made in that
   * same turn: a read where nothing the one before it read moved since answers as that one did and starts no git
   * (`foundWhole`), so the read again costs no git where nothing moved, and reads the folder where it did — its stop
   * cuts that read, never the mark. Work whose mark was undone waits on the developer's word (`WorkState.undone`). Work
   * let go of while it was read — applied, dropped, redone, captured anew (`unsettle`) — is read once more too: what
   * waits now, if anything. True where it was found.
   * @param {string} key @param {string} chain @returns {Promise<boolean | typeof SETTLE_AGAIN>}
   */
  const settleRead = async (key, chain) => {
    const sa = subs.get(key);
    if (!sa?.work || sa.chainId !== chain || !sa.work.files.length || sa.status === "running" || sa.task || sa.taskWas || sa.work.wt || sa.work.undone === sa.work.head) return false;
    const was = unsettled.get(sa) || 0;
    const stop = new AbortController();
    /** @param {{ repo: string, base: string, head: string }} w */
    const whole = async ({ repo, base, head }) => {
      const r = await foundWhole(repo, { base, head }, { since: settledOn.get(sa) || null, signal: stop.signal });
      if ((unsettled.get(sa) || 0) !== was) return null;
      if (r.stamp) settledOn.set(sa, r.stamp);
      else settledOn.delete(sa);
      return r.whole;
    };
    let repo = "";
    try {
      const first = await waitingWork(key, chain);
      if (!first.ok) return false;
      repo = repoTurnKey(first.w.repo);
      settleStops.set(repo, (settleStops.get(repo) || new Map()).set(stop, `${chain}\n${key}`));
      const found = await inRepo(repo, async () => {
        stop.signal.throwIfAborted();
        return whole(first.w);
      }).catch(() => null);
      if (stop.signal.aborted || (unsettled.get(sa) || 0) !== was) return SETTLE_AGAIN;
      if (!found) return false;
      const slot = `${chain}\n${key}`;
      /** The mark, made in the repository's turn. @returns {Promise<MarkResult>} */
      const markNow = async () => {
        const got = await waitingWork(key, chain);
        if (!got.ok) return got;
        const { sa: s, repo: at, base, head } = got.w;
        if (!s?.work || s.task || s.taskWas || s.work.wt || s.work.undone === head) return { ok: false, error: "not a work a mark takes" };
        const p = await whole(got.w);
        if (!p) return { ok: false, error: "not in the folder whole" };
        // A follow-up that came meanwhile — its stop of this read, its run the sub-agent's — goes ahead: the work it
        // is at is not marked. A read that stood on the one before it starts no git, and its stop goes unseen in it
        // (the review of 11-03): it is looked at here, before anything is written.
        const overtaken = () => stop.signal.aborted || s.status === "running";
        if (overtaken()) return { ok: false, error: "a follow-up went ahead of the mark" };
        if (!(await holdMarkedWork(at, key, { base, head }))) {
          log("warn", `sub-agents: ${key}'s work is in the folder already, but git would not keep it as found: it waits`);
          return { ok: false, error: "git would not keep the mark" };
        }
        // One that came while git kept the mark: the work waits again, on its refs, as it did; the mark is not made.
        if (overtaken()) {
          if (!(await unholdMarkedWork(at, key, { base, head }))) log("warn", `sub-agents: ${key}'s work was overtaken by a follow-up as it was marked found, and git would not keep it waiting again`);
          return { ok: false, error: "a follow-up went ahead of the mark" };
        }
        appliedTo(s, head, p.files.length, "found", { hand: { base, head }, came: p.came });
        log("info", `sub-agents: ${key}'s work is in the folder already (${p.files.length} file${p.files.length === 1 ? "" : "s"}): it no longer waits`);
        return { ok: true, files: p.files, repo: at };
      };
      const r = await marked(key, chain, async () => {
        const again = await waitingWork(key, chain);
        if (!again.ok) return again;
        return inRepo(again.w.repo, async () => {
          stop.signal.throwIfAborted();
          // Its turn now: a write that waits for it stops nothing more (`aheadOfMark`).
          markInTurn.add(slot);
          try {
            return await markNow();
          } finally {
            markInTurn.delete(slot);
          }
        });
      }, "it could not be read", true);
      if (r.ok) return true;
      return stop.signal.aborted || (unsettled.get(sa) || 0) !== was ? SETTLE_AGAIN : false;
    } catch {
      return stop.signal.aborted ? SETTLE_AGAIN : false;
    } finally {
      const stops = settleStops.get(repo);
      stops?.delete(stop);
      if (stops && !stops.size) settleStops.delete(repo);
    }
  };
  /** What a read stopped, or whose work was let go of while it read, answers: it reads once more (`settleRead`). */
  const SETTLE_AGAIN = Symbol("again");
  /** The least time between two of a sub-agent's reads of its waiting work, one after the other (`settleFound`). */
  const SETTLE_AGAIN_MS = 1_000;
  /** @typedef {{ done: Promise<boolean>, resolve: (found: boolean) => void, person: boolean }} SettleAsk  asks a read answers together */
  /** @param {boolean} person @returns {SettleAsk} */
  const settleAsk = (person) => {
    /** @type {(found: boolean) => void} */
    let resolve = () => {};
    const done = new Promise((r) => (resolve = r));
    return { done, resolve, person };
  };
  /**
   * Each sub-agent's reads of its waiting work in turn (`settleFound`): `next`, the asks the read to come answers — the
   * ones that came since the last began. @type {Map<string, { next: SettleAsk | null }>}
   */
  const settles = new Map();
  /**
   * A sub-agent's waiting work read against the folder, and kept as found where it is there whole (`settleRead`), one
   * read at a time and none sooner than SETTLE_AGAIN_MS after the last: a turn's end, a read of the Agents list, a dry
   * run that asks while one runs, or that short while after it, is answered by the one after — however many ask
   * meanwhile, one more. One that would begin while the chat's turn runs does not, unless the person asked (the Agents
   * list, a dry run): its asks are answered false, and the turn's end asks again. A read stopped, or whose work was let
   * go of meanwhile, reads once more for its asks. Every ask is answered, as its read ends: true where it found it.
   * @param {string} key @param {string} chain @param {{ person?: boolean }} [o]  `person`: the person asked
   * @returns {Promise<boolean>}
   */
  const settleFound = (key, chain, { person = false } = {}) => {
    const slot = `${chain}\n${key}`;
    const line = settles.get(slot);
    if (line) {
      line.next ||= settleAsk(false);
      line.next.person ||= person;
      return line.next.done;
    }
    const first = settleAsk(person);
    /** @type {{ next: SettleAsk | null }} */
    const me = { next: null };
    settles.set(slot, me);
    void (async () => {
      for (let ask = /** @type {SettleAsk | null} */ (first); ask; ask = me.next) {
        // Every ask up to now rides on this read; those that come while it reads, or a while after, on the next.
        me.next = null;
        if (!ask.person && liveTurnOf(chain)) ask.resolve(false);
        else {
          const got = await settleRead(key, chain).catch(() => false);
          if (got === SETTLE_AGAIN) {
            me.next ||= settleAsk(false);
            me.next.person ||= ask.person;
            void me.next.done.then(ask.resolve);
          } else ask.resolve(got === true);
        }
        await new Promise((r) => later(() => r(undefined), SETTLE_AGAIN_MS));
      }
      settles.delete(slot);
    })();
    return first.done;
  };

  /**
   * What a session's turn ending ends: a worker's question to its lead, which waited through a pause for its resume to
   * read — no answer comes now, and the worker goes on with its pick (TG2-D58) — and the folder's checks still running,
   * whose applies stand unchecked, which the session's next turn hears (TG2-D55). A plan keeps its own 3 minutes.
   * @param {string} chainId @param {NonNullable<ReturnType<typeof chains.get>>} c
   */
  const endAsks = (chainId, c) => {
    for (const s of subs.values()) if (s.chainId === chainId && s.status === "running" && s.run?.leadAsk && !s.run.leadAsk.done && !s.run.leadAsk.plan) endLead(s, s.run, s.run.leadAsk, "none");
    for (const k of c.checks) k.abort.abort();
  };
  /**
   * What waited for a session's turn to end goes, once no turn of it is open: a side run's launches (10-28), each copy
   * from its finished edits; and work its agent may have brought into the folder itself, with git or by hand, is read —
   * what is there whole no longer waits (`settleFound`, one read at a time: turns that end while one runs cost one more).
   * The ways back of the results it was handed are let go.
   * @param {string} chainId @param {NonNullable<ReturnType<typeof chains.get>>} c
   */
  const turnOver = (chainId, c) => {
    c.backs.clear();
    for (const go of c.after.splice(0))
      try {
        go();
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agents: session ${chainId}: what waited for its turn's end failed (${e?.message || e})`);
      }
    for (const s of subs.values()) if (s.chainId === chainId && s.work?.files.length) void settleFound(s.id, chainId);
  };
  /** When each session's waiting work was last read against its folder outside a turn's end (`settleWaiting`). @type {Map<string, number>} */
  const settledAt = new Map();
  /**
   * A session's waiting work read against its folder while no turn of it runs, at most once in `SETTLE_EVERY_MS`: what
   * is there whole no longer waits (`settleFound`). Its threads read back after a restart, and every read of its list,
   * ask it — work brought into the folder while no turn ran waited otherwise until the next one ended. Its callers go
   * on without it; it says, once its reads are over, how many sub-agents' waiting work it asked to be read — a read
   * finds what it finds, and may find nothing to read (`settleRead`). `person`: the person asked, by reading the list.
   * @param {string} chainId @param {{ person?: boolean }} [o] @returns {Promise<number>}
   */
  const settleWaiting = (chainId, { person = false } = {}) => {
    const id = String(chainId || "");
    if (!id || liveTurnOf(id) || now() - (settledAt.get(id) ?? -Infinity) < SETTLE_EVERY_MS) return Promise.resolve(0);
    settledAt.set(id, now());
    /** @type {Promise<boolean>[]} */
    const reads = [];
    for (const s of subs.values()) if (s.chainId === id && s.work?.files.length) reads.push(settleFound(s.id, id, { person }));
    return Promise.all(reads).then((r) => r.length);
  };

  /**
   * Undo a mark as applied (10-29): the work it marked waits again, as it did — its refs written again from the mark's
   * hold, so after a restart too — while nothing moved since (`markUndoable`): the mark is the sub-agent's newest apply,
   * nothing was captured and no exchange begun since, and the sub-agent is at rest. The folder is not touched: the mark wrote nothing.
   * @param {string} id @param {string} chainId
   * @returns {Promise<MarkResult>}
   */
  function unmarkTaken(id, chainId) {
    const key = String(id || "").trim().toLowerCase();
    const chain = String(chainId || "");
    return marked(key, chain, async () => {
      recall(chain);
      const sa = subs.get(key);
      if (!sa || sa.chainId !== chain) return { ok: false, error: `no sub-agent ${key} in this session` };
      await reconcileWork(sa);
      const w = sa.work;
      if (!w || !markUndoable(sa, now())) return { ok: false, error: noUndoWords(sa) };
      return inRepoAhead(w.repo, async () => {
        const a = markUndoable(sa, now());
        if (!a?.hand) return { ok: false, error: noUndoWords(sa) };
        const { base, head } = a.hand;
        const files = await changedFiles(w.repo, base, head);
        if (!(await unholdMarkedWork(w.repo, key, { base, head }))) return { ok: false, error: "git would not keep its work again" };
        w.base = base;
        w.head = head;
        w.files = files;
        w.applied = w.applied.filter((x) => x !== a);
        w.undone = head;
        changed(sa);
        return { ok: true, files, repo: w.repo };
      });
    }, "its mark could not be undone");
  }
  /** Why a sub-agent's newest apply is no mark that can be undone, in words. @param {Subagent} sa */
  const noUndoWords = (sa) => {
    const a = sa.work?.applied.at(-1);
    if (!a?.hand) return `sub-agent ${sa.id}'s newest apply is no mark as applied: there is none to undo`;
    if (sa.status === "running") return `sub-agent ${sa.id} is working: undo its mark once it reports`;
    if (now() - (Number(a.at) || 0) > MARK_UNDO_MS) return `sub-agent ${sa.id}'s change was marked as applied more than a day ago: its mark can be undone no more`;
    return `sub-agent ${sa.id} has worked since its change was marked as applied, and what it did since waits on its own`;
  };

  /**
   * What an apply of a sub-agent's work would do now, nothing written (the Designer's of 10-27, on the owner's "what does
   * that apply button even do behind the scene"): how each file would come in, and the files that would stop it. The
   * apply checks all again when pressed. `choices`: the developer's so far, for the files that would stop it (the
   * Designer's of 10-27): the effect line of Apply with my choices. Each file that stops it says its kind and the
   * choices that kind offers. Git failing under it is said in words (the Hunter's of 10-28: it threw, a 500).
   * @param {string} id @param {string} chainId @param {{ choices?: Readonly<Record<string, import("../../adapters/git/worktree.js").ApplyChoice>> }} [o]
   * @returns {Promise<{ ok: true, repo: string, folder: string | null, files: number, came: import("../../adapters/git/worktree.js").Came[], conflicts: (import("../../adapters/git/worktree.js").ApplyConflict & { choices: readonly import("../../adapters/git/worktree.js").ApplyChoice[] })[] } | { ok: false, error: string }>}
   */
  async function preview(id, chainId, { choices = {} } = {}) {
    const key = String(id || "").trim().toLowerCase();
    try {
      const got = await waitingWork(key, String(chainId || ""));
      if (!got.ok) return got;
      const w = got.w;
      const r = await inRepo(w.repo, async () => {
        const marks = await rebaseMarks(w.repo, w.head, w.base);
        const out = await previewApply(w.repo, { base: w.base, head: w.head }, { choices });
        return { ...out, came: withRebaseMarks(out.came, marks) };
      });
      const conflicts = r.conflicts.map((c) => ({ ...c, choices: CHOICES[c.kind || "unread"] }));
      // Found in the folder whole, as it is read: it stops waiting (`settleFound`, which reads it again under its lock).
      if (!Object.keys(choices).length && r.files.length && !conflicts.length && r.came.every((c) => c.how === "same")) void settleFound(key, String(chainId || ""), { person: true });
      return { ok: true, repo: w.repo, folder: w.sa ? copyOf(w.sa) : null, files: r.files.length, came: r.came, conflicts };
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `Filament could not work out what an apply would do (${String(e?.message || e)})` };
    }
  }

  /**
   * One file of a sub-agent's waiting work as Compare shows it (the Designer's of 10-27): what stops it, and each
   * overlap — at its line in the developer's file, their lines over its own, the lines at its start.
   * @param {string} id @param {string} chainId @param {string} path
   */
  async function compare(id, chainId, path) {
    const key = String(id || "").trim().toLowerCase();
    try {
      const got = await waitingWork(key, String(chainId || ""));
      if (!got.ok) return got;
      const w = got.w;
      const r = await inRepo(w.repo, () => compareApply(w.repo, { base: w.base, head: w.head }, String(path || "")));
      return r.ok ? { ...r, repo: w.repo, folder: w.sa ? copyOf(w.sa) : null } : r;
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `Filament could not compare it (${String(e?.message || e)})` };
    }
  }

  /** What the sub-agent reads of a file its rebase could not bring in, by kind: from its side. @type {Record<string, string>} */
  const LEFT_WORDS = {
    deleted: "you deleted it; the developer changed it since",
    gone: "you changed it; the developer deleted it since",
    added: "you both added a file there",
    binary: "a binary file both you and the developer changed",
    place: "a folder, a file or a link of the developer's stands in its way",
    unread: "git could not bring it in",
  };
  /** The same, sent back by the agent that launched it or its lead (11-09): the folder's, never the developer's. @type {Record<string, string>} */
  const LEFT_WORDS_FOLDER = {
    deleted: "you deleted it; it was changed in the folder since",
    gone: "you changed it; it was deleted from the folder since",
    added: "a file was added there in the folder too",
    binary: "a binary file changed both by you and in the folder",
    place: "a folder, a file or a link in the folder stands in its way",
    unread: "git could not bring it in",
  };
  /**
   * What a sub-agent sent back to rebase reads (the Designer's of 10-27): its copy holds the developer's folder now,
   * with its change brought in again — the overlaps marked for it to resolve, and what could not come named. Sent back
   * by the agent that launched it, or its lead (`lead`, the owner's of 11-09), it reads who, and the folder as theirs;
   * by Filament itself (`own`), its task's merge having overlapped the folder's edits, it reads that.
   * @param {{ marked: string[], left: import("../../adapters/git/worktree.js").ApplyConflict[] }} r @param {SubagentOrigin} [by] @param {boolean} [lead] @param {boolean} [own]
   */
  const rebaseText = ({ marked, left }, by = "owner", lead = false, own = false) => {
    const dev = by === "owner";
    const parts = [
      dev
        ? "[Filament: the developer sent your work back to rebase: their folder changed since you started, and your change overlapped their edits. Your copy holds their folder as it stands now, with your change brought onto it again."
        : own
          ? "[Filament: your change did not merge: the folder changed since you started, and your change overlapped edits made there, so Filament sent your work back to redo on the folder as it stands. Your copy holds the folder as it stands now, with your change brought onto it again."
          : `[Filament: ${lead ? "your lead" : "the agent that launched you"} sent your work back to rebase: the folder changed since you started, and your change overlapped edits made there. Your copy holds the folder as it stands now, with your change brought onto it again.`,
    ];
    if (marked.length) parts.push(`Where your lines and theirs overlap, git's conflict markers stand in ${marked.join(", ")}: "<<<<<<< yours" over ${dev ? "the developer's" : "the folder's"} lines, "=======", then yours down to ">>>>>>> its change". Resolve each so it keeps what both meant, leave no marker, and check that it works.`);
    if (left.length) parts.push(`Not brought in, and as ${dev ? "the developer has" : "the folder has"} ${left.length === 1 ? "it" : "them"}: ${left.map((c) => `${c.path} (${(dev ? LEFT_WORDS : LEFT_WORDS_FOLDER)[c.kind || "unread"]})`).join("; ")} — redo what still matters there.`);
    parts.push(`Then report again: your work waits for ${dev ? "their" : "its"} apply once more.]`);
    return parts.join(" ");
  };

  /**
   * Whether a sub-agent sent back to rebase is still to go on with it: while its graph task waits for it to (the
   * Hunter's of 10-28) — a task that failed, went to another worker or was dropped leaves its work no longer due, the
   * developer's to apply, its marked files said so (`withRebaseMarks`), or to send back again.
   * @param {Subagent} sa
   */
  function rebaseDue(sa) {
    return !!sa.rebaseDue && (ctx?.rebaseWaits?.(sa.chainId, sa.id) ?? true);
  }

  /**
   * Send a sub-agent's waiting work back to rebase (the Designer's of 10-27, the first of a conflict's actions): its
   * change redone on the developer's folder as it stands now — a fresh base, its change brought onto it, the overlaps
   * marked — and it goes on in a follow-up, one more run on its model, to resolve them; its work then waits again. A
   * graph task's goes back the way the graph sends tasks back (`ctx.rebaseTask`). Where it cannot go on now, its work
   * waits as it did. `by`: who sends it — the developer, or the agent's send_back (11-09), whose follow-up is the
   * agent's call (`parent`) or its lead's (`lead`), in the background, so its report comes back as any report does.
   * @param {string} id @param {string} chainId @param {{ by?: SubagentOrigin, parent?: LaunchParent | null, lead?: LeadCall | null }} [o]
   * @returns {Promise<{ ok: true, id: string, marked: string[], left: import("../../adapters/git/worktree.js").ApplyConflict[], files: number, task: string | null } | { ok: false, error: string }>}
   */
  async function rebase(id, chainId, { by = "owner", parent = null, lead = null } = {}) {
    const key = String(id || "").trim().toLowerCase();
    const chain = String(chainId || "");
    const slot = `${chain}\n${key}`;
    if (applying.get(slot) || cycles.has(slot) || asked.has(slot)) return { ok: false, error: `sub-agent ${key}'s work is being applied now` };
    // Filament's own mark of work found whole is waited for, as an apply waits for it: then it says what is left.
    const settle = settling.has(slot) ? marking.get(slot) : null;
    if (settle) {
      aheadOfMark(slot);
      return settle.then(() => rebase(id, chainId, { by, parent, lead }));
    }
    if (marking.has(slot)) return { ok: false, error: `sub-agent ${key}'s work is being marked as applied now` };
    return redo(key, chain, { by, parent, lead });
  }
  /**
   * The move of `rebase`, once nothing else holds the work: its change redone on the folder as it stands, and its
   * sub-agent sent on with it — a graph task's by its graph. `merge`: the graph's merge of it overlapped the folder's
   * edits (the owner's of 11-09) and sends it back from inside its apply — the graph's to allow, by Filament itself
   * twice at most, its words Filament's own where it chose (`asked` false); `team`, a lead plans it.
   * @param {string} key @param {string} chain
   * @param {{ by?: SubagentOrigin, parent?: LaunchParent | null, lead?: LeadCall | null, merge?: (import("../../core/task-graph.js").MergeBack & { team: boolean }) | null }} o
   * @returns {Promise<{ ok: true, id: string, marked: string[], left: import("../../adapters/git/worktree.js").ApplyConflict[], files: number, task: string | null, n?: number } | { ok: false, error: string }>}
   */
  const redo = async (key, chain, { by = "owner", parent = null, lead = null, merge = null }) => {
    const slot = `${chain}\n${key}`;
    if (rebasing.has(slot)) return { ok: false, error: rebasingWords(key) };
    rebasing.add(slot);
    try {
      const got = await waitingWork(key, chain);
      if (!got.ok) return got;
      const { sa, repo, base, head } = got.w;
      if (!sa?.work) return { ok: false, error: `Filament restarted since sub-agent ${key} ran, and its conversation went with it: apply its work with your choices, or ask an agent to redo it` };
      if (sa.work.wt) return { ok: false, error: `sub-agent ${key}'s copy is still open${sa.work.error ? ` (its work could not be captured: ${sa.work.error})` : ""}` };
      if (sa.work.there) return { ok: false, error: `sub-agent ${key} works on ${sa.remote?.machine.name || "another machine"}, in its own copy there, which a rebase here does not reach: apply its change with markers, or keep your version (mine), or ask it in a follow-up to redo what overlaps` };
      const rebaseTask = ctx?.rebaseTask;
      if (sa.task && !rebaseTask) return { ok: false, error: `sub-agent ${key} does task ${sa.task.id} of the task graph, and the graph cannot send it back here` };
      const work = sa.work;
      const was = { base: work.base, head: work.head, files: work.files };
      const r = await inRepoAhead(repo, () => rebaseTaskWork(repo, key, { base, head }));
      if (!r.ok) return { ok: false, error: `its change could not be redone on your folder (${r.error})` };
      /** Its work waits as it did, on its refs too, and in its patch's folder. */
      const asItWas = async () => {
        work.base = was.base;
        work.head = was.head;
        work.files = was.files;
        await keepTaskWork(repo, key, { base: was.base, head: was.head || was.base }).catch(() => false);
        await layPatch(sa);
      };
      if (!r.files.length) {
        await asItWas();
        return { ok: false, error: `nothing of sub-agent ${key}'s change comes onto your folder as it is now — ${r.left.map((c) => `${c.path}: ${c.why}`).join("; ") || "your folder has it all already"}` };
      }
      work.base = r.base;
      work.head = r.head;
      work.files = r.files;
      // Its patch's folder holds its rebased change at once, markers and all.
      await layPatch(sa);
      unsettle(sa);
      const brief = rebaseText(r, by, !!lead || !!merge?.team, !!merge && !merge.asked);
      // A graph task's goes on when the graph starts it — now where its planner's turn runs, else at the next: until
      // then its marked work is no Apply's. Set first: the graph may start it at once.
      if (sa.task) sa.rebaseDue = true;
      const asks = by === "owner" ? { description: "Rebase its change on your folder" } : { description: "Rebase its change on the folder", parent, lead, background: true };
      const sent = merge ? { merge: { asked: merge.asked, why: merge.why } } : {};
      const back = sa.task && rebaseTask ? rebaseTask({ chainId: chain, agentId: key, taskId: sa.task.id, note: brief, ...sent }) : followUp(key, { prompt: brief, chainId: chain, by, ...asks, moved: true });
      if (!back.ok) {
        delete sa.rebaseDue;
        await asItWas();
        return { ok: false, error: back.error };
      }
      changed(sa);
      return { ok: true, id: key, marked: r.marked, left: r.left, files: r.files.length, task: sa.task?.id || null, ...("n" in back && back.n ? { n: back.n } : {}) };
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `the rebase failed (${String(e?.message || e)})` };
    } finally {
      rebasing.delete(slot);
    }
  };
  /** @param {string} key */
  const rebasingWords = (key) => `sub-agent ${key}'s change is being sent back to rebase now`;

  /**
   * The folder as it stands now brought into a sub-agent's worktree ahead of a follow-up (the owner's list of 11-08,
   * `sync`): its change redone on a fresh snapshot of the folder (`rebaseTaskWork`) where it comes on whole, the edits
   * made there since its launch under it. Where a file overlaps, or cannot come on, nothing moves and the call names
   * it; one with no change of its own just gets the fresh snapshot. A copy that keeps nothing is opened fresh at each
   * follow-up anyway, and one with no worktree works in the folder: nothing to bring. The follow-up (`go`, handed
   * Filament's note of what came in, or null where nothing was brought) starts while the move still holds the work, so
   * no other follow-up reopens it from where it stood; refused there, the work goes back as it was. Filament's own
   * mark of work found whole is waited for, as a rebase waits for it.
   * @template {{ ok: boolean, error?: string }} R
   * @param {string} id @param {string} chainId @param {(note: string | null) => R} go
   * @returns {Promise<R | { ok: false, error: string }>}
   */
  async function syncWork(id, chainId, go) {
    const key = String(id || "").trim().toLowerCase();
    const chain = String(chainId || "");
    const slot = `${chain}\n${key}`;
    const sa = subs.get(key);
    if (!sa || sa.chainId !== chain) return { ok: false, error: noSuchSubagent(key) };
    if (sa.task) return { ok: false, error: `sub-agent ${key} does task ${sa.task.id} of the task graph: send it back with tasks instead, leaving sync out` };
    if (sa.status === "running") return { ok: false, error: `sub-agent ${key} is still working; its report comes first` };
    // One on another machine works in its clone there, or a copy made for it, with no worktree here to bring this folder
    // into.
    if (sa.remote?.copy) return { ok: false, error: `sub-agent ${key} works on ${sa.remote.machine.name}, in its own copy there: sync brings this folder into a worktree here, and it has none. Leave sync out, and hand it your changes with changes` };
    if (sa.remote) return { ok: false, error: `sub-agent ${key} works on ${sa.remote.machine.name}, in its clone there: sync brings this folder into a worktree here, and it has none. Leave sync out and tell it in your prompt to pull there, or hand it your changes with changes` };
    if (sa.may === "copy" || !sa.work) return go(null);
    if (applying.get(slot) || cycles.has(slot) || asked.has(slot)) return { ok: false, error: `sub-agent ${key}'s work is being applied now` };
    const settle = settling.has(slot) ? marking.get(slot) : null;
    if (settle) {
      aheadOfMark(slot);
      return settle.then(() => syncWork(id, chainId, go));
    }
    if (marking.has(slot)) return { ok: false, error: `sub-agent ${key}'s work is being marked as applied now` };
    if (rebasing.has(slot)) return { ok: false, error: rebasingWords(key) };
    rebasing.add(slot);
    try {
      await reconcileWork(sa);
      const work = sa.work;
      if (!work) return go(null);
      if (work.wt) return { ok: false, error: `sub-agent ${key}'s copy is still open${work.error ? ` (its work could not be captured: ${work.error})` : ""}` };
      const repo = work.repo;
      const head = work.head || work.base;
      const marks = head === work.base ? [] : await rebaseMarks(repo, head, work.base);
      if (marks.length) return { ok: false, error: `sub-agent ${key}'s change still holds git's conflict markers in ${marks.join(", ")}: follow it up without sync to have it resolve them` };
      const was = { base: work.base, head: work.head, files: work.files };
      /** Its work as it was, on its refs too: a refusal moves nothing. */
      const asItWas = async () => {
        work.base = was.base;
        work.head = was.head;
        work.files = was.files;
        await keepTaskWork(repo, key, { base: was.base, head }).catch(() => false);
      };
      const r = await inRepoAhead(repo, () => rebaseTaskWork(repo, key, { base: was.base, head }));
      if (!r.ok) {
        await asItWas();
        return { ok: false, error: `your folder could not be brought into its worktree (${r.error})` };
      }
      if (r.marked.length || r.left.length || sa.status === "running" || work.wt) {
        await asItWas();
        if (sa.status === "running" || work.wt) return { ok: false, error: `sub-agent ${key} started working meanwhile: nothing was synced` };
        const why = [...r.marked.map((p) => `${p} (your edits and its change overlap)`), ...r.left.map((c) => `${c.path} (${c.why})`)];
        return { ok: false, error: `nothing was synced and it did not start: ${why.join("; ")}. Follow it up without sync, or apply its change first` };
      }
      const came = (await changedFiles(repo, was.base, r.base).catch(() => [])).map((f) => f.path);
      work.base = r.base;
      work.head = r.head;
      work.files = r.files;
      const went = go(syncedNote(came));
      if (!went.ok) {
        await asItWas();
        return went;
      }
      unsettle(sa);
      changed(sa);
      return went;
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `the sync failed (${String(e?.message || e)})` };
    } finally {
      rebasing.delete(slot);
    }
  }
  /**
   * What a sub-agent whose worktree took the folder in reads ahead of its follow-up. @param {string[]} came
   */
  const syncedNote = (came) =>
    `[Filament: the developer's folder as it stands now came into your worktree before this message, your change kept on top of it${came.length ? `: ${came.length} file${came.length === 1 ? "" : "s"} came in (${came.slice(0, 20).join(", ")}${came.length > 20 ? `, and ${came.length - 20} more` : ""})` : "; nothing in it had changed"}.]`;

  // ---- the folder's check after a lead's apply (HarnessV3-TaskGraph-v2 TG2-D55) ---------------------------------------

  /** The end of the newest lead's apply in line, by repository: the next waits for it. @type {Map<string, Promise<void>>} */
  const leadLines = new Map();
  /** Whose apply's turn in line it is now, by repository, and how it stands: what an apply behind it says it waits for. @type {Map<string, Cycle["state"]>} */
  const leadAhead = new Map();
  /**
   * What an apply that waits in line behind another's says of it (`waiting`): whose it is, and whether it is still going
   * into the folder, or in and being checked. Nobody's where the folder is free, its own turn come. @param {string} repo
   * @returns {Extract<import("./check.js").FolderCheck, { kind: "waiting" }>}
   */
  const waitingBehind = (repo) => {
    const a = leadAhead.get(repo) ?? null;
    return { kind: "waiting", behind: a ? a.key : null, ...(a ? { writing: !a.files } : {}) };
  };
  /** A lead's apply in flight, by its session and sub-agent: an apply of the same change again joins it. @type {Map<string, Cycle>} */
  const cycles = new Map();

  /**
   * A team lead's apply of a worker's change: applied and the folder checked, in line behind the lead's apply before it
   * into the repository (`checkedApply`). The call hears the verdict where it comes within `holdMs`; else how the apply
   * stands then — its check runs, or it waits in line — and the verdict reaches the lead's door once, as a message. An
   * apply of the same change while one is in flight joins it. `back`: the lead's send_back, on the verdict (`openCycle`)
   * — a call that joins adds its own.
   * @param {string} key @param {string} chain @param {string} slot @param {{ reason: string | null, lead: LeadCall, holdMs: number, back: boolean }} o
   * @returns {Promise<ApplyResult>}
   */
  const leadApply = async (key, chain, slot, { reason, lead, holdMs, back }) => {
    let cycle = cycles.get(slot);
    if (!cycle) {
      const got = await waitingWork(key, chain);
      if (!got.ok) return got;
      // A call of the same apply may have opened it meanwhile.
      cycle = cycles.get(slot) || openCycle(key, chain, slot, got.w.repo, { reason, lead });
    }
    if (back) cycle.state.back = true;
    return heard(cycle, holdMs);
  };
  /**
   * A lead's apply joins its repository's line and runs once the one ahead of it has its verdict: what comes of it is
   * `verdict`, which reaches the lead's door where a call answered before it. Its session's turn owes it, and a turn
   * that ends — or Filament stopping — cuts it (`abort`). The task graph's merge (`lead` null, V2-2) joins the same line,
   * but is its runner's: no turn owes it here, nor cuts it, and it waits out the one ahead of it whatever comes — its
   * runner's stop cuts its own check. `stands`: its planner asked it in as it stood, so it stands whatever the folder's
   * check finds — red said, never undone. `overlap`, `team`: the graph's merge, its planner's way on the files where
   * its change overlaps the folder's edits, and whether a lead plans it (11-09) — with none, or send_back, it goes back
   * to its worker to redo on the folder (`mergeBack`).
   * @param {string} key @param {string} chain @param {string} slot @param {string} repo @param {{ reason: string | null, lead: LeadCall | null, stands?: boolean, overlap?: Overlap | null, team?: boolean }} o
   * @returns {Cycle}
   */
  const openCycle = (key, chain, slot, repo, { reason, lead, stands = false, overlap = null, team = false }) => {
    const c = chainState(chain);
    const abort = new AbortController();
    /** @type {() => void} */
    let land = () => {};
    /** @type {Promise<void>} */
    const landed = new Promise((resolve) => (land = () => resolve()));
    /** @type {Cycle["state"]} */
    const state = { key, repo, started: false, files: null, came: null, aside: null, command: null, began: now(), done: null, answered: null, landed, land, callers: 0, told: false, carried: false, back: false };
    const ahead = leadLines.get(repo) || null;
    /** @type {() => void} */
    let free = () => {};
    /** @type {Promise<void>} */
    const ours = new Promise((resolve) => (free = () => resolve()));
    // The next in line waits for this one and every one ahead of it, whatever cut this one short.
    const line = Promise.all([ahead, ours]).then(() => {});
    leadLines.set(repo, line);
    line.then(() => {
      if (leadLines.get(repo) === line) leadLines.delete(repo);
    });
    /** @type {{ done: Promise<void>, abort: AbortController }} */
    const entry = { done: Promise.resolve(), abort };
    /** @type {Promise<ApplyResult>} */
    const verdict = (async () => {
      try {
        if (ahead) await (lead ? Promise.race([ahead, abortOf(abort.signal)]) : ahead);
        if (lead && abort.signal.aborted) return /** @type {ApplyResult} */ ({ ok: false, error: "the turn that applied it ended while it waited behind the folder's check of the apply before it" });
        state.started = true;
        leadAhead.set(repo, state);
        const r = await checkedApply(key, chain, state, abort.signal, { reason, lead, stands, overlap });
        return lead ? r : await mergeBack(r, key, chain, { overlap, team });
      } catch (/** @type {any} */ e) {
        return /** @type {ApplyResult} */ ({ ok: false, error: `the apply failed (${String(e?.message || e)})` });
      } finally {
        if (leadAhead.get(repo) === state) leadAhead.delete(repo);
        free();
      }
    })().then(async (was) => {
      cycles.delete(slot);
      // The lead's send_back, once the cycle has let its worker's work go — so the send-back may move it — and before
      // anyone hears the verdict, which says what came of it.
      const r = lead && state.back ? await backOver(was, key, chain, { lead }) : was;
      state.done = r;
      c.checks.delete(entry);
      if (state.answered) tellLate(key, chain, r, state.answered);
      return r;
    });
    entry.done = verdict.then(() => {});
    if (lead) c.checks.add(entry);
    /** @type {Cycle} */
    const cycle = { verdict, state, abort };
    cycles.set(slot, cycle);
    return cycle;
  };
  /**
   * What a call of a lead's apply answers: the verdict where it comes within `holdMs` — a call after one that was told
   * it comes as a message hears that at once — else how the apply stands: its check runs, or it waits in line.
   * @param {Cycle} cycle @param {number} holdMs @returns {Promise<ApplyResult>}
   */
  const heard = async (cycle, holdMs) => {
    const s = cycle.state;
    if (!s.answered) {
      /** @type {Promise<null>} */
      const held = new Promise((resolve) => later(() => resolve(null), holdMs));
      const v = await Promise.race([cycle.verdict, held]);
      if (v) return v;
      // The verdict came as the hold ran out: it is this call's answer, and no message.
      if (s.done) return s.done;
    }
    if (s.files) {
      s.answered ??= "late";
      return { ok: true, files: s.files, repo: s.repo, check: { kind: "late", command: s.command || "", ms: now() - s.began } };
    }
    s.answered ??= "waiting";
    return { ok: true, files: [], repo: s.repo, check: s.started ? { kind: "waiting", behind: null } : waitingBehind(s.repo) };
  };
  /**
   * What came of a lead's apply whose call answered before it, at the lead's door once: into its running turn, else for
   * the session's next — kept across a restart as a report is. It wrote where the folder changed after the call
   * answered: an undo, or an apply that waited in line.
   * @param {string} key @param {string} chain @param {ApplyResult} r @param {"late" | "waiting"} answered
   */
  const tellLate = (key, chain, r, answered) => {
    const sa = subs.get(key) || null;
    const who = sa ? `${sa.team ? sa.team.role : "sub-agent"} ${key} ("${sa.description}")` : `sub-agent ${key}`;
    const wrote = r.check?.kind === "undone" || (answered === "waiting" && (r.ok || !!r.partial));
    const writes = answered === "waiting" ? appliedWrites(key, r) : undefined;
    enqueue(chain, { text: `[Filament: what came of your apply of ${who}: ${appliedResult(key, r, { tool: "worker" }).text}]`, from: key, description: sa?.description || key, kind: "check", spends: [], wrote, ...withWrites(writes) });
  };

  /**
   * A lead's apply, checked, once its turn in line came. Its commands, each once: the change's own check where it passed
   * on this very work, the commands that passed in the folder's check after the lead's earlier applies — the session's
   * list, forgotten on a restart — and the session's `loop.verify.afterEdits`; one a rule of the session's refuses or
   * asks for first is not run, and said. With none to run, it goes in as any apply does. Else the folder is captured
   * just before the apply and just after it, as commits under no ref, and the commands run on the one after
   * (`folderRuns`). Then: it passed, or the folder was red on it already, or it stands red for the lead's reason — what
   * passed joins the list, what failed leaves it; or the apply broke one and is undone, the change waiting again
   * rebased onto the folder — from the folder before the apply to the folder after it — and going back to its worker
   * (`sendBack`); or the undo would not come through cleanly, and it stands red. The task graph's merge (`lead` null,
   * V2-2) is checked the same way, in a merge's words: a change it undid goes back by its runner (`taskBack`). One its
   * planner asked in as it stood (`stands`) stands red as a reason over the folder's red does, its reds said.
   * @param {string} key @param {string} chain @param {Cycle["state"]} state @param {AbortSignal} signal
   * `overlap`: the graph's merge takes its planner's markers or mine (11-09) — git's markers in the files that overlap
   * the folder's edits, which no check is run on, or the folder's version of them kept, its change to them held aside.
   * @param {{ reason: string | null, lead: LeadCall | null, stands?: boolean, overlap?: Overlap | null }} o @returns {Promise<ApplyResult>}
   */
  const checkedApply = async (key, chain, state, signal, { reason, lead, stands: asItStood = false, overlap = null }) => {
    const c = chainState(chain);
    const { doc } = settingsOf(chain);
    const afterEdits = String(doc?.loop?.verify?.afterEdits ?? "").trim();
    const repo = state.repo;
    const not = lead ? FOLDER_NOT_CHECKED : MERGE_NOT_CHECKED;
    // Its send_back, or none, sends it back once refused (`mergeBack`).
    const way = !lead && (overlap === "markers" || overlap === "mine") ? overlap : null;
    const step = await inRepoAhead(repo, async () => {
      const got = await waitingWork(key, chain);
      if (!got.ok) return { r: /** @type {ApplyResult} */ (got) };
      const { sa, base, head } = got.w;
      // Its own check counts where it passed on this work; a reason over the folder's red adds the command it failed on —
      // the red of the undo it waits after, or of the last since an apply of it stood, where its own check did not fail.
      const own = sa?.grants?.check.length && sa.checked?.exit === 0 && sa.checked.head === head ? sa.grants.check : [];
      const mine = sa ? checkOfWork(sa) : null;
      const red = sa ? folderRedOf(sa) || (mine && mine.exit !== 0 ? null : sa.folderUndone) : null;
      const over = asItStood || (!!reason && !!red);
      const guards = new Set([...c.folder, ...(afterEdits ? [afterEdits] : [])]);
      const ruled = folderRuled([...new Set([...own, ...(over && red ? [red.command] : []), ...guards])], rulesFrom(doc), { merge: !lead });
      const plan = { ...ruled, own: new Set(own), guards, over };
      // A rebase's markers its worker left in (the Hunter's of 10-28): a merge or a lead's apply took them in as clean
      // lines, the task done. They are the developer's to bring in, from Changes, or its worker's to resolve.
      const marks = await rebaseMarks(repo, head, base);
      if (marks.length) return { r: /** @type {ApplyResult} */ ({ ok: false, error: `its change still holds the conflict markers its rebase left in ${listed(marks.slice(0, 5))}${marks.length > 5 ? ` and ${marks.length - 5} more` : ""} — they are resolved first, by its ${lead ? "worker" : "sub-agent"} or by the developer in Changes` }) };
      const before = ruled.run.length ? await folderSnapshot(repo, { name: `check-${key}-before` }) : null;
      const out = await applyTaskWork(repo, { base, head }, { overlap: way });
      // A lead's apply that overlaps the folder's edits goes back to its worker (`backOver`): checked, nothing of it goes
      // in half-merged. The graph's merge, with no way of its planner's, goes back the graph's way (`mergeBack`).
      if (!out.ok) return { r: lead ? { ...notApplied(out), takes: LEAD_OVERLAPS } : notApplied(out) };
      // Its change to the files kept as the folder had them stays readable: its commits held as a mark's are, as a plain
      // apply's with mine are.
      const aside = way && out.came.some((x) => x.how === "kept") ? { base, head } : null;
      if (!(await (aside ? holdMarkedWork(repo, key, aside) : dropTaskRefs(repo, key)))) await markApplied(repo, key, head);
      await wroteBy(chain, key, repo, out.files, out.came);
      const entry = appliedTo(sa, head, out.files.length, lead ? "agent" : "graph", { reason, came: out.came });
      const after = before?.ok ? await folderSnapshot(repo, { name: `check-${key}-after` }) : before;
      // Where the folder's version of some files was kept, its own check passed on a change that is not all in: it counts
      // as broken only where it passed before the apply, as a guard does.
      return { r: null, files: out.files, came: out.came, aside, sa, entry, plan: aside ? { ...plan, own: new Set() } : plan, before, after, cwd: sa?.cwd || ctx?.session(chain)?.cwd || repo };
    });
    if (step.r) return step.r;
    const { files, came, aside, sa, entry, plan, before, after, cwd } = step;
    state.files = files;
    // How each file came, where its planner's way took some (11-09): its answer names them, and the graph its task.
    if (way) Object.assign(state, { came, aside });
    // A planner's call that waits as it goes in answers with what it wrote (`landedOf`); the verdict then carries none.
    state.told = state.callers > 0;
    state.land();
    const into = { files, repo, ...(way ? { came } : {}), ...(aside ? { aside } : {}) };
    /** @param {string} words @returns {ApplyResult} */
    const unchecked = (words) => ({ ok: true, ...into, check: { kind: "not", words } });
    // Git's markers its planner asked for stand in the folder for it to resolve: a check would fail on them alone.
    const marked = came.filter((x) => x.how === "markers").map((x) => x.path);
    if (marked.length) return unchecked(`Git's conflict markers stand in ${listed(marked.slice(0, 10))}${marked.length > 10 ? ` and ${marked.length - 10} more` : ""}, for you to resolve: Filament did not check the folder with them in it.`);
    if (!before || !after) return plan.none ? unchecked(plan.none) : { ok: true, ...into };
    if (!before.ok || !after.ok) return unchecked(not.failed(!before.ok ? before.error : !after.ok ? after.error : ""));
    state.began = now();
    state.command = plan.run[0];
    const ran = await folderRuns(key, cwd, { before: before.commit, after: after.commit }, plan, state, signal);
    if ("cut" in ran) return unchecked(not.cut);
    if ("error" in ran) return unchecked(not.failed(ran.error));
    const { runs, broke } = ran;
    const reds = new Set(runs.filter((r) => r.after.exit !== 0).map((r) => r.command));
    /** An apply that stands: what passed guards the next, what failed does not, and afterEdits is read each time. */
    const stands = () => {
      c.folder = [...new Set([...c.folder, ...runs.filter((r) => r.after.exit === 0).map((r) => r.command)])].filter((x) => x !== afterEdits && !reds.has(x));
      if (sa) {
        sa.folderBacks = 0;
        sa.folderRed = null;
        sa.folderUndone = null;
        changed(sa);
      }
    };
    if (!broke) {
      stands();
      return { ok: true, ...into, check: { kind: !reds.size ? "passed" : plan.over ? "reason" : "red", runs, ruled: plan.ruled } };
    }
    const undo = await inRepoAhead(repo, () => applyTaskWork(repo, { base: after.commit, head: before.commit }));
    if (!undo.ok) {
      stands();
      return { ok: true, ...into, check: { kind: "stuck", runs, ruled: plan.ruled, broke, conflicts: undo.conflicts, ...(undo.stuck ? { stuck: undo.stuck } : {}) } };
    }
    if (!(await keepTaskWork(repo, key, { base: before.commit, head: after.commit }))) log("warn", `sub-agent ${key}: its undone change waits, and git would not keep it for a restart`);
    if (sa?.work) {
      sa.work.base = before.commit;
      sa.work.head = after.commit;
      sa.work.files = await changedFiles(repo, before.commit, after.commit).catch(() => files);
      sa.work.applied = sa.work.applied.filter((x) => x !== entry);
    }
    // What its own check saw was the work before the undo: the change that waits is checked by none until its worker
    // reports again, whatever id its snapshot came to — two snapshots of one folder in one second are one commit.
    if (sa?.checked) sa.checked = { ...sa.checked, head: null };
    const back = lead ? sendBack(sa, broke, lead, chain) : taskBack(sa, broke);
    if (sa) {
      sa.folderUndone = { command: broke.command, exit: broke.after.exit };
      if (!("n" in back)) sa.folderRed = { command: broke.command, exit: broke.after.exit, head: after.commit };
      changed(sa);
    }
    return { ok: false, error: `the folder's check failed with it, and the ${lead ? "apply" : "merge"} was undone`, check: { kind: "undone", runs, ruled: plan.ruled, broke, back } };
  };
  /**
   * The folder's check of a lead's apply: each command in a worktree of the folder after it, in order. A red one runs in
   * a worktree of the folder before the apply too — opened at the first that needs it — save where the lead's reason
   * lets the reds stand. One the apply broke stops the check: one that guarded the folder and passes before the apply,
   * or the change's own, which passed in its worktree, unless it fails the same way before the apply (`failedAlike`:
   * the folder's or its environment's failure, the owner's of 11-10). One red already does not. Both copies are given
   * back before the verdict.
   * @param {string} key @param {string} cwd  the session's folder, whose counterpart the commands run in
   * @param {{ before: string, after: string }} at
   * @param {{ run: string[], own: Set<string>, guards: Set<string>, over: boolean }} plan
   * @param {Cycle["state"]} state @param {AbortSignal} signal
   * @returns {Promise<{ runs: import("./check.js").FolderRun[], broke: import("./check.js").FolderRun | null } | { cut: true } | { error: string }>}
   */
  const folderRuns = async (key, cwd, at, plan, state, signal) => {
    /** @type {Map<string, import("../../adapters/git/worktree.js").TaskWorktree>} */
    const open = new Map();
    /** @param {"before" | "after"} which */
    const tree = async (which) => {
      const id = `${key}-${which === "after" ? "check" : "before"}`;
      const had = open.get(id);
      if (had) return had;
      treeIds.add(id);
      const o = await openCheckTree(cwd, { id, commit: at[which], allowed: allowedFolder, keep: treeIds });
      if (!o.ok) {
        treeIds.delete(id);
        throw new Error(`a worktree of the folder ${which} the apply could not be made: ${o.error}`);
      }
      open.set(id, o.wt);
      return o.wt;
    };
    /** @param {string} command @param {string} root @returns {Promise<import("./check.js").CheckRun>} */
    const one = async (command, root) => {
      const began = now();
      const r = await runCheck(command, { root, signal }).catch((/** @type {any} */ e) => ({ exit: null, output: String(e?.message || e), stopped: false }));
      const stopped = !!r.stopped || signal.aborted;
      return { command, exit: stopped ? null : r.exit, ms: now() - began, output: String(r.output ?? ""), stopped };
    };
    try {
      if (signal.aborted) return { cut: true };
      const after = await tree("after");
      /** @type {import("./check.js").FolderRun[]} */
      const runs = [];
      for (const command of plan.run) {
        if (signal.aborted) return { cut: true };
        state.command = command;
        const a = await one(command, after.workdir);
        if (a.stopped) return { cut: true };
        const own = plan.own.has(command) && !plan.guards.has(command);
        if (a.exit === 0 || plan.over) {
          runs.push({ command, after: a, before: null, own });
          continue;
        }
        const was = await tree("before");
        const b = await one(command, was.workdir);
        if (b.stopped) return { cut: true };
        // The change's own failing the same way without it is the environment's failure: where the copy has no dependency
        // folder linked, its output ends saying so (the owner's of 11-10).
        const alike = own && failedAlike(a, after.dest, b, was.dest);
        const run = { command, after: alike && !after.linked.length ? { ...a, output: `${a.output.replace(/\s+$/, "")}\n${NO_DEPENDENCIES_CHECKED}` } : a, before: b, own };
        runs.push(run);
        if ((own && !alike) || b.exit === 0) return { runs, broke: run };
      }
      return { runs, broke: null };
    } catch (/** @type {any} */ e) {
      return { error: String(e?.message || e) };
    } finally {
      for (const [id, wt] of open) {
        await releaseTaskWorktree(wt, "free").catch((/** @type {any} */ e) => log("info", `sub-agent ${key}: the folder's check copy could not be given back (${e?.message || e})`));
        treeIds.delete(id);
      }
    }
  };
  /**
   * A change the folder's check undid goes back to its worker, in the context it has: its worktree is the folder with its
   * change in it, the command joins its check — which it may run without asking, as its brief's own — and the note
   * gives the command and its output. Twice at most for one change; never where it cannot: Filament forgot it, or
   * restarted since it ran, Filament is stopping, or the turn that applied it is over.
   * @param {Subagent | null} sa @param {import("./check.js").FolderRun} broke @param {LeadCall} lead @param {string} chain
   * @returns {{ n: number } | { twice: true } | { why: string }}
   */
  const sendBack = (sa, broke, lead, chain) => {
    if (!sa) return { why: "Filament restarted since it ran, and its conversation went with it" };
    const n = sa.folderBacks + 1;
    if (n > CHECK_RETURNS) return { twice: true };
    if (sa.restored) return { why: sa.restored === "let-go" ? "Filament let its conversation go to keep its memory bounded" : "its conversation went with a restart of Filament" };
    if (stopping) return { why: "Filament is stopping" };
    if (!leadParent(chain, lead)) return { why: "the turn that applied it has ended" };
    const grants = sa.grants;
    sa.grants = { check: [...new Set([...(grants?.check || []), broke.command])], mayRun: grants?.mayRun || [], ...(grants?.card ? { card: grants.card } : {}) };
    const f = followUp(sa.id, { prompt: folderBackText(broke, n), chainId: chain, lead, background: true, description: sa.description, folder: { command: broke.command, n } });
    if (!f.ok) {
      sa.grants = grants;
      return { why: f.error };
    }
    sa.folderBacks = n;
    return { n };
  };
  /**
   * A graph task's change the folder's check undid (HarnessV3-TaskGraph-v2 V2-2): whether it may go back to its worker
   * — its runner sends it, as a review's asked changes go, with the note in the task's words — and which time this is;
   * the command joins its check, which it runs when it reports. Twice at most; never where it cannot: Filament forgot it,
   * or restarted since it ran, or is stopping.
   * @param {Subagent | null} sa @param {import("./check.js").FolderRun} broke
   * @returns {{ n: number } | { twice: true } | { why: string }}
   */
  const taskBack = (sa, broke) => {
    if (!sa) return { why: "Filament restarted since it ran, and its conversation went with it" };
    const n = sa.folderBacks + 1;
    if (n > CHECK_RETURNS) return { twice: true };
    if (sa.restored) return { why: sa.restored === "let-go" ? "Filament let its conversation go to keep its memory bounded" : "its conversation went with a restart of Filament" };
    if (stopping) return { why: "Filament is stopping" };
    const grants = sa.grants;
    sa.grants = { check: [...new Set([...(grants?.check || []), broke.command])], mayRun: grants?.mayRun || [], ...(grants?.card ? { card: grants.card } : {}) };
    sa.folderBacks = n;
    return { n };
  };

  /**
   * @typedef {object} Asked  a planner's apply of a graph task's change, from its call until its graph's merge takes it
   *   up (`mergeTask`): `opened`, the apply as its call opened it — or what it answered, where nothing went to open —
   *   which that merge joins rather than opening one of its own; `cycle`, the one opened, once it is
   * @property {string} chain
   * @property {Promise<{ cycle: Cycle } | { error: ApplyResult }>} opened
   * @property {Cycle | null} cycle
   * @property {(o: { cycle: Cycle } | { error: ApplyResult }) => void} open
   */
  /**
   * The planners' applies of graph tasks' changes (the owner's of 11-02), by their session and sub-agent: each from its
   * call — before the graph hears of it, so nothing else of the developer's writes the same work meanwhile — until its
   * graph's merge takes it up. @type {Map<string, Asked>}
   */
  const asked = new Map();
  /** A planner's apply of `slot`'s change, asked now: its graph's merge waits for it to open. @param {string} slot @param {string} chain @returns {Asked} */
  const askOpen = (slot, chain) => {
    /** @type {Asked["open"]} */
    let open = () => {};
    /** @type {Asked} */
    const a = { chain, cycle: null, opened: new Promise((resolve) => (open = resolve)), open: () => {} };
    a.open = (o) => {
      if ("cycle" in o) a.cycle = o.cycle;
      else if (asked.get(slot) === a) asked.delete(slot);
      open(o);
    };
    asked.set(slot, a);
    return a;
  };
  /**
   * The planner's apply of a graph task's change that waits for it (the owner's of 11-02): the graph's merge, checked as
   * a lead's apply is (`checkedApply`) in the repository's line — opened here, its graph's merge joining it (`asked`), or
   * joined where a lead's merge of it runs already. `stands`: its planner asked it in as it stood. The call answers once
   * the change is in the folder, or would not go in — at once where it waits in line behind another's apply
   * (`landedOf`); what comes of the folder's check is the task's end, which its graph tells. `overlap`, `team`: the
   * planner's way on the files where its change overlaps the folder's edits, and whether a lead plans it (11-09).
   * @param {string} key @param {string} chain @param {string} slot @param {{ reason: string | null, stands: boolean, overlap?: Overlap | null, team?: boolean }} o
   * @param {Asked} a @returns {Promise<ApplyResult>}
   */
  const taskApplied = async (key, chain, slot, { reason, stands, overlap = null, team = false }, a) => {
    try {
      let cycle = cycles.get(slot);
      let own = false;
      if (!cycle) {
        const got = await waitingWork(key, chain);
        cycle = cycles.get(slot);
        if (!cycle) {
          if (!got.ok) {
            a.open({ error: got });
            return got;
          }
          cycle = openCycle(key, chain, slot, got.w.repo, { reason, lead: null, stands, overlap, team });
          own = true;
        }
      }
      a.open({ cycle });
      // A merge of it runs already — a lead's — which its graph has in hand: this call hears that one, and keeps nothing.
      if (!own && asked.get(slot) === a) asked.delete(slot);
      return await landedOf(cycle);
    } catch (/** @type {any} */ e) {
      /** @type {ApplyResult} */
      const r = { ok: false, error: `the apply failed (${String(e?.message || e)})` };
      if (!a.cycle) a.open({ error: r });
      return r;
    }
  };
  /**
   * What a planner's apply of a graph task's change answers (the owner's of 11-02): at once, that it waits in line behind
   * another's apply, and how that one stands; else, once the change is in the folder, that its check runs (`late`) — or
   * the verdict, where it came with it: the change would not go in, or nothing was to run. The call never waits on the
   * check, and marks nothing answered: the verdict is its task's end, which its graph tells. What it wrote goes with
   * the one call that waited as it went in; any other answer says it, recorded already or to be with the end.
   * @param {Cycle} cycle @returns {Promise<ApplyResult>}
   */
  const landedOf = async (cycle) => {
    const s = cycle.state;
    if (!s.started && !s.done) return { ok: true, files: [], repo: s.repo, check: waitingBehind(s.repo) };
    const waits = !s.files && !s.done;
    if (waits) s.callers += 1;
    await Promise.race([cycle.verdict, s.landed]);
    // In, with no command to run: its verdict follows at once.
    if (!s.done && !s.command) await cycle.verdict;
    /** @type {ApplyResult} */
    const r = s.done || { ok: true, files: s.files || [], ...(s.came ? { came: s.came } : {}), repo: s.repo, ...(s.aside ? { aside: s.aside } : {}), check: { kind: "late", command: s.command || "", ms: now() - s.began } };
    const carries = waits && s.told && !s.carried;
    if (carries) s.carried = true;
    return carries || !r.ok ? r : { ...r, recorded: true };
  };
  /** The graph's merges whose check runs, by their session and sub-agent: Filament stopping cuts each (V2-2). @type {Map<string, AbortController>} */
  const merges = new Map();
  /**
   * The task graph's merge of a worker's change (HarnessV3-TaskGraph-v2 V2-2, TG2-D2): applied and the folder checked as
   * a lead's apply is (`checkedApply`), in the same line for its repository — but its runner's own: no call is held, no
   * turn's end cuts it, and a change undone does not go back by itself: the verdict says whether it may (`back`), and
   * the runner sends it. `reason`: a lead's merge of it as it stands; `stands`: its planner asked it in as it stood;
   * `signal`: the developer's stop, or Filament stopping — the merge stands, unchecked. One its planner's apply asked is
   * that apply, joined as its call opened it — or answered with what that call answered, where nothing went to open — and
   * a merge of the same change while one runs joins it. What it wrote is `recorded` where that call answered with it.
   * @param {string} id @param {string} chainId @param {{ reason?: string | null, stands?: boolean, signal?: AbortSignal }} [o]
   * @returns {Promise<ApplyResult>}
   */
  async function mergeTask(id, chainId, { reason = null, stands = false, signal } = {}) {
    const key = String(id || "").trim().toLowerCase();
    const chain = String(chainId || "");
    const slot = `${chain}\n${key}`;
    try {
      const a = asked.get(slot);
      /** @type {Cycle | undefined} */
      let cycle;
      if (a) {
        const o = await a.opened;
        if (asked.get(slot) === a) asked.delete(slot);
        if ("error" in o) return o.error;
        cycle = o.cycle;
      } else cycle = cycles.get(slot);
      if (!cycle) {
        const got = await waitingWork(key, chain);
        const meanwhile = cycles.get(slot);
        if (meanwhile) cycle = meanwhile;
        else if (!got.ok) return got;
        else cycle = openCycle(key, chain, slot, got.w.repo, { reason, lead: null, stands });
      }
      // Its planner's apply that joined this one keeps nothing now: this merge has it in hand.
      if (asked.get(slot)?.cycle === cycle) asked.delete(slot);
      const abort = cycle.abort;
      if (signal) {
        if (signal.aborted) abort.abort();
        else signal.addEventListener("abort", () => abort.abort(), { once: true });
      }
      if (stopping) abort.abort();
      merges.set(slot, abort);
      const v = await cycle.verdict.finally(() => {
        if (merges.get(slot) === abort) merges.delete(slot);
      });
      return v.ok && cycle.state.told ? { ...v, recorded: true } : v;
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `the merge failed (${String(e?.message || e)})` };
    }
  }
  /**
   * The developer's Stop of a session's graph (V2-2): the folder's check of each of its merges is cut — the one running,
   * and each its planner's apply opened that its graph has not taken up yet — so each stands, unchecked, and says so.
   * @param {string} chainId
   */
  const cutMerges = (chainId) => {
    const chain = String(chainId || "");
    for (const [slot, abort] of merges) if (slot.startsWith(`${chain}\n`)) abort.abort();
    for (const a of asked.values()) if (a.chain === chain) a.cycle?.abort.abort();
  };
  /**
   * Commands that passed on the session's folder join the folder's check (V2-2): the next apply or merge into it runs
   * them — a task of the planner's own whose check passed in a copy of the folder. Forgotten on a restart, as the rest of
   * the list is. @param {string} chainId @param {readonly string[]} commands
   */
  const guard = (chainId, commands) => {
    const c = chainState(String(chainId || ""));
    c.folder = [...new Set([...c.folder, ...commands.map((x) => String(x).trim()).filter(Boolean)])];
  };

  /**
   * A sub-agent's pending work for a surface: its files with their line counts and the diff.
   * @param {string} id @param {string} chainId
   * @returns {Promise<{ ok: true, files: import("../../adapters/git/worktree.js").ChangedFile[], diff: string, applied: number } | { ok: false, error: string }>}
   */
  async function changes(id, chainId) {
    const key = String(id || "").trim().toLowerCase();
    try {
      const w = await workOf(key, String(chainId || ""));
      if (!w.ok) return w;
      const files = w.sa?.work ? w.sa.work.files : await changedFiles(w.repo, w.base, w.head);
      return { ok: true, files, diff: await diffTaskWork(w.repo, w.base, w.head), applied: w.sa?.work?.applied.length || 0 };
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `its changes could not be read (${String(e?.message || e)})` };
    }
  }

  /**
   * How warm the main agent's cache is for this session — the newest request of its running turn, else of its last
   * one — which decides whether Enhance forks it. "uncached": its reply read and wrote nothing from the provider's
   * cache (a prefix too small to cache, or a provider that does not), so a fork would pay the whole conversation.
   * `thinking` is the kept request's thinking budget: a fork keeps it (or misses the cache), so a reply's room must
   * clear it — the compactor's preview asks.
   * @param {string} chainId
   */
  const cacheOf = (chainId) => {
    const live = liveTurnOf(chainId);
    const snap = live?.cache?.() || chains.get(chainId)?.warm || null;
    // Whether a fork has a request to copy now: the running turn's, else the last turn's while it is kept.
    const forkable = live ? !!live.fork : !!chains.get(chainId)?.warm;
    if (!snap) return { state: /** @type {"warm" | "cold" | "uncached" | "none"} */ ("none"), running: !!live, leftMs: 0, ttlMs: 0, tokens: 0, model: null, thinking: null, forkable };
    const leftMs = Math.max(0, snap.sentAt + snap.ttlMs - now());
    const state = snap.cached !== true ? "uncached" : leftMs > 0 ? "warm" : "cold";
    return { state: /** @type {"warm" | "cold" | "uncached" | "none"} */ (state), running: !!live, leftMs, ttlMs: snap.ttlMs, tokens: snap.tokens, model: String(snap.body?.model || "") || null, thinking: Number(snap.body?.thinking?.budget_tokens) || null, forkable };
  };

  /** Two model names for the same model, the suffixes aside (effort, fast) — the provider caches per model. @param {string} a @param {string} b */
  const sameModel = (a, b) => {
    const base = (/** @type {string} */ m) => parseModelSuffix(String(m || "").replace(/^agent\//, ""), config()?.rules).base.toLowerCase();
    return !!a && !!b && base(a) === base(b);
  };
  /**
   * One request forked from the main agent's newest one while the provider still caches its prefix: the same model,
   * system prompt, tools, thinking and messages, byte for byte, with `instruction` as the newest user text — so the
   * whole conversation is read at the cache's price. Nothing of the fork joins the conversation; it books on the
   * session under the developer's name. Enhance and the compactor's summary both go through this one door. Null when
   * nothing warm is there to fork (no request kept, a reply that read and wrote no cache, the lifetime over), or when
   * `model` names another model than the one whose cache it would read. `endsWith` is the text the forked
   * conversation's newest reply must carry — a caller that needs the fork to hold a conversation through a known turn
   * (the compactor: another window may have run turns since this request went out) names that turn's answer, and a
   * conversation that ends elsewhere is not forked. A reply with no text answers `text: ""`. With `window` the reply's
   * `max_tokens` is the most the model can write, fitted to what the window leaves after the forked request (the
   * composer's fit rule; a fork is Filament's own call, so the client's own cap is not its: HarnessV3-FailurePoints §13).
   * Near the compaction line the kept request's whole allowance is a pair the provider refuses. Too little
   * room — under `minTokens`, or not above the kept thinking budget, which
   * the fork must not change or it misses the cache — declines the fork (null). `stream` streams the reply, so a
   * long one keeps its connection alive. `textOnly`: the caller wants words, not work — a reply that calls a tool
   * (with some words before it or none) is a failure, not an answer; the compactor's summary asks it (a fork of the
   * loop's request carries its tools, and "do not call a tool" is asked, not forced). `forkFor` says what the fork is
   * for (`compaction`): Traffic lists it under that source rather than as the developer's sub-agent. `retry`: a
   * provider busy for a moment is tried again, as the loop's rounds are (HarnessV3-AtHome AH-F4), each wait logged and
   * `signal` ending it — the compactor's fork asks it; Enhance, a click the developer waits on, is tried once. `job`
   * names the compaction the fork is part of, for its progress (HarnessV3-FailurePoints §5.1 item 3). The call has no
   * clock (§4 A): `signal` ends it.
   * @param {string} chainId @param {string} instruction
   * @param {{ model?: string | null, signal?: AbortSignal | null, endsWith?: string | null, window?: number, minTokens?: number, stream?: boolean, textOnly?: boolean, forkFor?: "compaction" | null, retry?: boolean, job?: string | null }} [o]
   * @returns {Promise<{ ok: true, text: string, usage: TokenUsage | null, requestId: string | null } | { ok: false, error: string } | null>}
   */
  const forkCall = async (chainId, instruction, { model = null, signal = null, endsWith = null, window = 0, minTokens = 0, stream = false, textOnly = false, forkFor = null, retry = false, job = null } = {}) => {
    const live = liveTurnOf(chainId);
    const liveSnap = live?.cache?.() || null;
    const snap = liveSnap || chains.get(chainId)?.warm || null;
    const warm = !!snap && snap.cached === true && now() < snap.sentAt + snap.ttlMs;
    const source = !warm ? null : liveSnap ? live?.fork?.() || null : snap;
    if (!source) return null;
    if (model && !sameModel(source.body?.model, model)) return null;
    if (endsWith != null) {
      // The reply as it went out begins with the archived answer.
      const want = String(endsWith).trim();
      const lastReply = [...(source.body?.messages || [])].reverse().find((/** @type {any} */ m) => m?.role === "assistant");
      if (!want || !textOf(lastReply).startsWith(want)) return null;
    }
    const body = { ...source.body, messages: forkMessages(source.body.messages, instruction) };
    if (window > 0) {
      const fitted = fittedMaxTokens({ window, request: estimateBodyTokens(body), cap: outputCeiling(config(), source.body.model), floor: minTokens || 1024, thinking: Number(source.body.thinking?.budget_tokens) || 0 });
      if (fitted == null) return null;
      body.max_tokens = fitted;
    }
    let sentAt = now();
    /** @type {{ r: import("../internal-call.js").InternalCallResult, tries: number, tooLong?: string }} */
    let got;
    try {
      got = await withRetries(
        () => {
          sentAt = now();
          const headers = { ...source.headers, ...(forkFor ? { "x-filament-fork": forkFor } : {}), ...(job ? { "x-filament-job": job } : {}) };
          return post({ body, headers, signal, ...(stream ? { onDelta: () => {} } : {}) });
        },
        { tries: retry ? RETRY_TRIES : 1, signal, onWait: (w) => (w ? log("info", `subagents: the ${forkFor ? `${forkFor} ` : ""}fork of ${chainId}: ${w.words}`) : undefined) },
      );
    } catch (/** @type {any} */ e) {
      return { ok: false, error: e.message };
    }
    const r = got.r;
    if (!r.ok) return { ok: false, error: `${got.tooLong ? `${got.tooLong} — ` : ""}${r.json?.error?.message || `HTTP ${r.status}`}${got.tries > 1 ? ` (after ${got.tries} tries)` : ""}` };
    const usage = usageOf(r.json);
    // A read renews the provider's lifetime for the prefix: the last turn's request stays warm from the fork on —
    // unless a turn ran while the fork was out, and the session keeps that turn's newer request now.
    if (!liveSnap && snap && usage?.cacheRead && chains.get(chainId)?.warm === snap) keepWarm(chainId, { ...snap, sentAt });
    if (textOnly && Array.isArray(r.json?.content) && r.json.content.some((/** @type {any} */ b) => b?.type === "tool_use"))
      return { ok: false, error: "the fork called a tool instead of answering" };
    return { ok: true, text: textOf(r.json), usage, requestId: r.id };
  };

  /**
   * What the agent that followed up reads where a fresh agent took the thread up with its message (BW-10), or nothing.
   * @param {Subagent} sa
   */
  const freshNote = (sa) => {
    const why = sa.exchanges.at(-1)?.fresh;
    return why ? ` It started fresh for this message, from what was said in its thread: ${why === "restart" ? "Filament restarted since it last worked" : "Filament held its conversation no more"}.` : "";
  };
  /**
   * What a launch's answer says of the model it runs on (HarnessV4_Tasks E23-D2, D5), where there is something to say —
   * the launch named its model, or a level applies: " on kimi/kimi-k3 at high (its highest; max asked)". "" otherwise.
   * @param {Subagent} sa
   */
  const modelWords = (sa) => {
    // One on another machine says where, and the model it runs on there where its launch named one.
    if (sa.remote) return ` on ${sa.remote.machine.name}${sa.remote.model ? ` (${sa.model}${sa.effort?.level ? ` at ${sa.effort.level}` : ""})` : ""}`;
    const e = sa.effort;
    const named = sa.chose != null;
    if (!named && !e?.level) return "";
    const why = !e?.level || !e.wanted || e.wanted === e.level || e.wanted === "model" ? "" : e.spelled ? ` (its name's; ${e.wanted} asked)` : e.levels && e.level === e.levels.at(-1) ? ` (its highest; ${e.wanted} asked)` : ` (the nearest below it takes; ${e.wanted} asked)`;
    const at = e?.level ? ` at ${e.level}${why}` : e && !e.levels && e.wanted !== "model" ? " at its own effort (it has no effort setting)" : "";
    return ` on ${sa.model}${at}`;
  };
  /**
   * The launch's words on its choice of model, as a sentence after the launch's own, or "": and where its launch passed
   * rows of its list for the one it runs on, which and why (the owner's plan of 11-05: fallback down the rows) — said
   * of its launch alone, before it went on to another row or was followed up (the review of e5e7a75a0).
   * @param {Subagent} sa
   */
  const choseWords = (sa) => {
    const passed = sa.exchanges.length <= 1 && !sa.exchanges[0]?.moved?.length ? sa.models?.passed || [] : [];
    const rows = passed.length ? ` It runs on ${sa.model}: ${passed.map((p) => `${p.model} could not take it — ${String(p.why).replace(/\.$/, "")}`).join("; ")}.` : "";
    return `${sa.chose ? ` ${sa.chose}` : ""}${rows}`;
  };
  /**
   * What a launch's answer says where its model's last turns at its upstream were answered by another model, or "":
   * what its agent counted them under (services/token-calib.js `countedAs`), where that cannot be the model it is
   * launched on (core/answering-model.js `answeredAs`). Its report says it again where this one is too.
   * @param {Subagent} sa
   */
  const answeredBefore = (sa) => {
    const at = sa.remote ? null : ctx?.modelFacts?.(sa.model)?.at;
    const was = at ? countedAs(at.upstream, at.model) : null;
    return at && was && answeredAs(at.model, was) === "different" ? ` Its last turns there were answered by ${was}, not ${at.model}: expect ${was}'s work.` : "";
  };
  /** Every launch's result ends with the session's count (`standingOf`). @param {Subagent} sa @param {string} followed @param {LiveTurn} live */
  const launchedText = (sa, followed, live) =>
    `${followed ? `${sa.asked ? `${sa.card.name} (${sa.id})` : `Sub-agent ${sa.id}`} took your follow-up` : sa.asked ? `Asked ${sa.card.name} (${sa.id})${modelWords(sa)}` : `Launched sub-agent ${sa.id} ("${sa.description}")${modelWords(sa)}`} in the background.${followed ? "" : `${choseWords(sa)}${answeredBefore(sa)}`}${freshNote(sa)} Keep working: its ${sa.asked ? "answer" : "report"} arrives as a message when it finishes, and this turn does not end before it does. To wait for it, call wait — never sleep or poll. To talk to it again later, call agent with agent_id "${sa.id}". ${standingOf(sa.chainId, live)}`;
  /**
   * What a follow-up to a sub-agent at work answers (the owner's of 11-09): sent as a message, read at its next step —
   * after the developer's answer where a call of its waits for one (TG2-D36). @param {Subagent} sa
   * @param {{ asking?: string | null, ask?: number | null }} m
   */
  const sentText = (sa, m) =>
    `Sent to ${sa.asked ? `${sa.card.name} (${sa.id})` : `sub-agent ${sa.id}`} as a message: ${m.asking ? `it waits for the developer's answer on a ${m.asking} call (ask ${m.ask}) now, and reads it at its next step after that answer` : "it reads it at its next step, while it works"}. Its ${sa.asked ? "answer" : "report"} still comes when it finishes.`;
  /** What the launching call answers when the developer sends its sub-agent to the background (Run in background, once Detach). @param {Subagent} sa @param {"report" | "aside"} how @param {LiveTurn} live */
  const detachedText = (sa, how, live) =>
    how === "report"
      ? `[Filament: the developer sent sub-agent ${sa.id} ("${sa.description}") to the background, freeing this call: it keeps running, and its report arrives as a message when it finishes — keep working meanwhile (to wait for it, call wait, never sleep or poll), and don't redo its task. To ask it more later, call agent with agent_id "${sa.id}". ${standingOf(sa.chainId, live)}]`
      : `[Filament: the developer sent sub-agent ${sa.id} ("${sa.description}") to the background and took its report: it keeps running, and its report goes to the developer, not to you. Carry on without it, and don't redo its task unless the developer asks. ${standingOf(sa.chainId, live)}]`;

  /** What a launching call answers when its sub-agent outlasts the time the call may wait (`withinMs`, AG-68). @param {Subagent} sa @param {LiveTurn} live */
  const outlastedText = (sa, live) =>
    sa.asked
      ? `[Filament: ${sa.card.name} (${sa.id}) is still thinking, longer than one of your calls may wait: it runs on, and its answer reaches you as a message from Filament. Don't ask it again. Your turn does not end before it answers: carry on, call wait, or end your turn when only waiting is left. To ask it more later, call agent with agent_id "${sa.id}". ${standingOf(sa.chainId, live)}]`
      : `[Filament: sub-agent ${sa.id} ("${sa.description}") is still working, longer than one of your calls may wait: it runs on in the background, and its report reaches you as a message from Filament. Don't launch its task again. Your turn does not end before it reports: carry on, call wait, or end your turn when only waiting is left. To ask it more later, call agent with agent_id "${sa.id}". ${standingOf(sa.chainId, live)}]`;

  /**
   * A foreground run goes on as a background launch: it no longer stops or hangs up with the turn that launched it, and
   * what waited on it in its launching call is let go. `report`: its report reaches its launcher as a message, which
   * the launching turn waits for as for any background launch of its own; else it is kept for the developer.
   * @param {Subagent} sa @param {NonNullable<Subagent["run"]>} run @param {boolean} report
   * @returns {((how: "report" | "aside" | "away") => void) | null}  the launching call's waiter
   */
  const runsOn = (sa, run, report) => {
    run.unhook?.();
    sa.background = true;
    sa.deliver = report;
    if (report) run.parent?.live.own.add(sa.id);
    else sa.aside = true;
    const waiter = run.onDetach;
    run.onDetach = null;
    return waiter;
  };

  /**
   * The developer frees the main agent from a foreground sub-agent (BUG-12 Detach): it runs on as a background launch
   * and its launching call answers now. With `report`, its report reaches the main agent as a message when it finishes
   * (the turn does not end before it, as for any background launch of the turn's own); without, it is kept for the
   * developer, who may send it on. Either way it no longer stops or hangs up with the turn.
   * @param {string} id @param {{ report?: boolean }} [o]
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  function detach(id, { report = true } = {}) {
    const sa = subs.get(String(id || ""));
    if (!sa) return { ok: false, error: `no sub-agent ${id} is running` };
    const run = sa.run;
    if (sa.status !== "running" || !run) return { ok: false, error: `sub-agent ${sa.id} is not running` };
    if (sa.background || !run.onDetach) return { ok: false, error: `sub-agent ${sa.id} already runs in the background — the main agent is not waiting on it` };
    run.detached = report ? "report" : "aside";
    runsOn(sa, run, !!report)?.(run.detached);
    toParent(sa, { type: "subagent-detached", agentId: sa.id, report: !!report });
    changed(sa);
    return { ok: true };
  }

  /**
   * A foreground launch's result: the report, then Filament's line, which ends with the session's count. One the agent
   * stopped itself while this call waited (`agentStop`) says so, as its report by a message does.
   * @param {Subagent} sa @param {Outcome} o @param {LiveTurn} live
   */
  const resultText = (sa, o, live) => {
    const count = standingOf(sa.chainId, live);
    // One whose copy could not be made never ran: it has no context to ask more in.
    const never = !sa.work && !!sa.noCopy;
    const how = askedStop(o) ? "was stopped as you asked" : `${endedWord(o.status, o.stoppedBy)}${o.error ? ` — ${o.error}` : ""}`;
    if (sa.asked) {
      // A saved agent's answer (HarnessV4_Tasks E15 step 3): whose view it is, and what it is worth.
      const tail = `\n\n[Filament: ${sa.card.name} (${sa.id})${modelWords(sa)} answered.${choseWords(sa)}${freshNote(sa)} ${ADVICE_WORTH} ${never ? NEVER_RAN : `To ask it more in the same thread, call agent with agent_id "${sa.id}".`} ${count}]`;
      return o.ok
        ? `${otherModelLine(o)}${o.report || `(${sa.card.name} finished without an answer)`}${shownText(sa, o)}${workText(sa)}${handedNone(sa, true)}${tail}`
        : `[Filament: ${sa.card.name} ${how}; what it wrote is below]\n${reportOf(o, "(no answer)")}${shownText(sa, o)}${workText(sa)}${handedNone(sa, true)}${tail}`;
    }
    const tail = `\n\n[Filament: sub-agent ${sa.id}${modelWords(sa)} — ${never ? NEVER_RAN : `to ask it more in the same context, call agent with agent_id "${sa.id}".`}${choseWords(sa)}${freshNote(sa)} ${count}]`;
    return o.ok
      ? `${reportIn(sa, o, "(the sub-agent finished without a report)")}${shownText(sa, o)}${workText(sa)}${handedNone(sa, true)}${tail}`
      : `[Filament: the sub-agent ${how}; what it reported is below]\n${reportIn(sa, o, "(no report)")}${shownText(sa, o)}${workText(sa)}${handedNone(sa, true)}${tail}`;
  };

  /**
   * The agent stops a sub-agent itself (ag-stop, the owner's of 11-11: "main agent needs the ability to stop the agent
   * without asking them to stop"): the agent tool's `stop` with agent_id, the loop's and a coding agent's. A stop into
   * its run as the agent's (`stopRun`), as the developer's Stop is — it is sent no message, its request is cut where no
   * run of it takes a stop yet, and one on another machine stops there —, and its end says whose stop it was
   * (`askedStop`). Refused in words, thrown as the tool's other refusals are: no agent_id; anything a stop cannot carry
   * (`STOP_ALONE`); none by that id in this session; one that is not the agent's to stop — Filament started it by
   * itself for the developer, or it is a flow's box, whose end is its flow's —; one that runs no more, with how it
   * ended. → the call's answer: where its report so far goes, as its exchange's end will send it.
   * @param {string} chainId @param {any} input
   */
  const agentStop = (chainId, input) => {
    const id = String(input?.agent_id || "").trim();
    if (!id) throw new Error("stop needs agent_id: the sub-agent to stop");
    // What says nothing is no field given: a blank, a false.
    const held = STOP_ALONE.filter((k) => (typeof input[k] === "boolean" ? input[k] : input[k] != null && String(input[k]).trim() !== ""));
    if (held.length) throw new Error(`a stop stops the sub-agent and nothing more — leave ${listed(held)} out: it is sent no words, and a follow-up or an apply is a call of its own once it stopped`);
    // A thread the session kept is read back first, as a follow-up's is: one from before a restart runs no more.
    recall(chainId);
    const sa = subs.get(id);
    if (!sa || sa.chainId !== chainId) throw new Error(noSuchSubagent(id));
    const who = sa.asked ? `${sa.card.name} (${sa.id})` : `sub-agent ${sa.id}`;
    if (sa.origin === "self") throw new Error(`${who} started by itself, for the developer: it is theirs to stop, not yours`);
    if (sa.origin === "flow") throw new Error(`${who} is a box of a flow, and its end is its flow's: it is the developer's to stop — or yours with the flow tool (box, do: stop) where you drive that flow in place`);
    const run = sa.run;
    if (sa.status !== "running" || !run) {
      const o = sa.exchanges.at(-1)?.outcome;
      const how = askedStop(o) ? "was stopped as you asked" : endedWord(o?.status || sa.status, o?.stoppedBy);
      // A graph task's takes no follow-up: its task is the tasks tool's to start again.
      const on = sa.task ? `It does task ${sa.task.id} of your task graph, which the tasks tool starts again` : `To take it up again, follow it up: agent_id "${sa.id}" with a prompt`;
      throw new Error(`${who} is not running — it ${how}: there is nothing to stop. ${on}`);
    }
    // Where its report so far goes, read as its exchange's end reads it (`ex.delivery`).
    const what = sa.asked ? "answer" : "report";
    const goes = sa.task
      ? `${sa.task.review ? `It reads the change of task ${sa.task.id} of your task graph: the review` : `It works on task ${sa.task.id} of your task graph: the task`} waits again, and Filament's message on its end says how it goes on.`
      : `Its ${what} so far ${sa.deliver ? "arrives as a message" : run.parent && !run.detached ? "comes as its launching call's result" : "stays the developer's, who may send it on to you"}. To take it up again in the context it has, call agent with agent_id "${sa.id}" and a prompt.`;
    stopRun(sa, "agent");
    return { ok: true, text: `Stopping ${who} now, with no message sent to it. ${goes}`, spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: `agent: stopped ${sa.asked ? `${sa.card.name}, a saved agent (${sa.id}, ${sa.model})` : `sub-agent ${sa.id} (${sa.card.name}, ${sa.model})`}${sa.remote ? ` on ${sa.remote.machine.name}` : ""}` };
  };

  /**
   * A message to a running sub-agent, as `from` (a worker's lead): a note in its run's mailbox, which its loop reads
   * at its next step. One sent before its run exists is held, and steered into the run once it does. Refused in words
   * when it runs no more or says nothing. Its words go whole, whatever their length. `asking`: the tool whose call
   * waits for the developer's answer now — its next step comes only after that answer, which the sender is told —
   * and `ask`, that question's number (TG2-D42); `lead`: what waits is its question to its lead (TG2-D49).
   * @param {string} id @param {{ chainId: string, text: string, from: string }} m
   * @returns {{ ok: true, asking?: string | null, ask?: number | null, lead?: boolean } | { ok: false, error: string }}
   */
  function message(id, { chainId, text, from }) {
    const sa = subs.get(String(id || ""));
    if (!sa || sa.chainId !== String(chainId || "")) return { ok: false, error: noSuchSubagent(id) };
    const run = sa.run;
    if (!run) return { ok: false, error: `sub-agent ${sa.id} is not running` };
    // One on another machine runs its turn there, which no note of this machine's reaches.
    if (sa.remote) return { ok: false, error: `sub-agent ${sa.id} runs on ${sa.remote.machine.name}; it takes words when its turn ends: send them as a follow-up, with agent_id "${sa.id}"` };
    // Its run reported, and Filament runs its check (TG2-D45): no run of it reads a message now.
    if (run.progress.check) {
      const who = `${sa.team ? sa.team.role : "sub-agent"} ${sa.id}`;
      return { ok: false, error: `${who} has reported, and Filament runs its check now: if the check fails, ${who} goes back to work, where a message reaches it — your watch says so — and else its report arrives once the check ends` };
    }
    if (!runs) return { ok: false, error: "Filament keeps no run log here, so a running sub-agent cannot be reached" };
    const body = String(text || "").trim();
    if (!body) return { ok: false, error: "a message needs words" };
    const runId = sa.exchanges.at(-1)?.runId;
    if (!runId) {
      run.held.push({ text: body, from });
      return { ok: true };
    }
    const steered = runs.steer(runId, { kind: "note", text: body, from });
    const asking = run.progress.asking;
    return steered.ok ? { ok: true, asking: asking?.tool || null, ask: asking?.n ?? null, lead: !!asking && "to" in asking } : { ok: false, error: steered.error };
  }
  /**
   * The session's agent's line on the developer's words to one of its sub-agents (HarnessV4_Tasks decision 10): whom
   * they told, their words whole (B3), and that it reads them at its next step, so the agent need not pass them on.
   * @param {Subagent} sa @param {string} words
   */
  const toldText = (sa, words) =>
    `[Filament: the developer wrote to your ${sa.team ? sa.team.role : "sub-agent"} ${sa.id}${sa.description ? ` ("${sa.description}")` : ""} directly, past you:\n${words}\n\nIt reads that at its next step as their own message, so you need not pass it on: weigh it in what you tell ${sa.id} from now on.]`;

  return (registryApi = {
    /** @param {SubagentContext} c */
    setContext(c) {
      ctx = c;
    },
    launch,
    apply,
    markTaken,
    unmarkTaken,
    settleWaiting,
    preview,
    compare,
    rebase,
    mergeTask,
    cutMerges,
    guard,
    changes,
    followUp,
    checkFolder,
    runCommands,
    runProblem,
    checkProblem,
    checkedProblem,
    release,
    resumable,
    huntOf,
    resumeTask,
    /**
     * A graph worker's change came to wait for its apply (the graph runner's, 10-28, 11-02): its session keeps its
     * thread from now, so its work stays in Changes, and its apply open, after a restart. @param {string} id @param {string} chainId
     */
    keepWork(id, chainId) {
      const sa = subs.get(String(id || ""));
      if (sa && sa.chainId === String(chainId || "")) keep(sa);
    },
    send,
    detach,
    cacheOf,
    /** What the registry holds, for the server's memory census (services/memory-log.js `registryCensus`). */
    census: () => registryCensus(/** @type {Iterable<any>} */ (subs.values()), convoSizes),
    /**
     * The last turn's newest request, kept while the provider may cache it, as a task of the graph forks it from a turn
     * that has sent nothing yet (the bug hunt of 10-26: tasks waiting as a turn opens started from their briefs): only on
     * the turn's own model, so the task runs on the planner's, and only where its tools carry report, which the task ends
     * with — a request from before the graph was on has none. Null otherwise.
     * @param {string} chainId @param {string} model
     * @returns {CacheSnapshot | null}
     */
    keptFork: (chainId, model) => {
      const kept = keptForTasks(chainId);
      return kept && String(kept.body?.model || "") === String(model || "") ? kept : null;
    },
    /**
     * Whether a task of the chat's graph starts as a fork of its main agent while no turn of it runs (Phase 5: the
     * developer's side run, launched now or at the turn's end): the last turn's newest request it keeps, weighed as a
     * running turn's tasks are (`forkPays`), against a fork's line on that request's model. A chat whose main agent is a
     * coding agent sends no request of Filament's to fork: never.
     * @param {string} chainId
     */
    forkPays: (chainId) => {
      const { doc } = settingsOf(chainId);
      if (ctx?.agentOf?.(String(doc?.model?.name || ""))) return false;
      const kept = keptForTasks(chainId);
      if (!kept) return false;
      return forkPays(kept, forkLineOf(sessionWindowFor(config(), String(kept.body?.model || ""), doc?.model?.window).tokens), now());
    },
    liveMessages,
    forkCall,
    /**
     * A session's running loop opens its door here: the launcher behind its `agent` tool, the inbox it reads at every
     * round, and `close` when the turn ends (reports still waiting move to the session's queue; its newest request is
     * kept for Enhance while the provider may still cache it). `fork` and `cache` are the loop's request as it stands
     * and its newest completed one — `fork` null where the turn sends no request of Filament's (a coding agent's own
     * chat): its launches are never a fork; `emit` puts an event on the turn's timeline. `lead`: a team's lead runs the turn
     * (HarnessV3-AtHome P2) — its workers launch through the team's tools, and its reports name worker; `round`: the
     * round its loop is in, which a team's launch is stamped with. `owes`: what else the turn may not end before — the
     * task graph's sub-agents while they run or merge (HarnessV3-TaskGraph G2-7). `before`: what a pause handed its
     * resume (`close`'s) — the background launches the turn made before it, the resumed turn's own as they were
     * (HarnessV3-Views V6-17), and its runs so far, whose launches this turn's inbox counts as its own (the bug
     * report's L10).
     * @param {{ chainId: string, runId: string, cwd: string, mode: import("./prompt.js").PermissionMode | null, model: string, thinking: any,
     *   fork: LiveTurn["fork"], cache?: LiveTurn["cache"], emit?: LiveTurn["emit"], lead?: boolean,
     *   round?: LiveTurn["round"], owes?: (() => Promise<void> | null) | null, before?: TurnSoFar | null,
     *   looks?: { seconds: () => number, lean?: boolean, who?: import("./looks.js").Crewed, head: (sa: { progress: Progress }, at: number) => string[] } | null,
     *   opens?: (() => boolean | null) | null, attach?: (() => import("./attach.js").AttachFrom) | null }} t
     *   `attach`: where its agent's `attach` reads from, asked at each call — where its main agent may read and how
     *   its text is redacted, the person's pictures of this turn, its folders (attach.js); none where the turn takes none.
     *   `looks`: the turn's lead reads along with its workers (HarnessV3-TaskGraph-v2 §12) — the pace as the session
     *   says it now, whether each look is the new part only (a lead that keeps its own conversation), whom it shows in
     *   its reader's word (`who`: a lead's workers, or the sub-agents of the agent's task graph), and how a
     *   worker stands now in a look's head line. `opens`: whether its agent opens envelopes now (`LiveTurn.opens`), so
     *   by default; what it says last is the chat's word on letters while no turn runs
     * @returns {{ subagents: Subagents, inbox: Inbox, close: (o?: { paused?: boolean }) => TurnSoFar }}  `close` gives the
     *   turn's own background launches and its runs, which a pause hands to its resume; `paused`: it lets go on a pause,
     *   whose resume reads what its workers ask meanwhile (HarnessV3-TaskGraph-v2 TG2-D58)
     */
    openTurn({ chainId, runId, cwd, mode, model, thinking, fork, cache = null, emit = null, lead = false, round = null, owes = null, before = null, looks: reading = null, opens = null, attach: attachFrom = null }) {
      const c = chainState(chainId);
      /** @type {LiveTurn} */
      const live = { runId, runs: new Set([...(before?.runs || []), runId]), inbox: c.queue.splice(0), own: new Set(before?.own || []), fork, cache, emit, lead, launched: Number(before?.launched) || 0, round, closed: false, wake: new Set(), looks: null, watched: null, opens: opens || (() => true) };
      c.turn = live;
      // A turn going on after its pause: its card's clock starts over (held-launch.js `pause`).
      if (before) holds.pause(chainId, turnKey(live), false);
      // A letter sealed while no turn ran woke the chat for this turn: it wakes nothing more. It is still `fresh` — this
      // turn tells the agent of it, at its start or at its next step.
      const woke = c.sealed.filter((d) => d.wakes);
      for (const d of woke) delete d.wakes;
      if (woke.length) persist(chainId);
      events.publish("subagents", { type: "subagent-cache", chainId });
      const ofChain = () => [...subs.values()].filter((s) => s.chainId === chainId && s.status === "running");
      /** What waits in the turn's inbox unheld, as its wait says it (`cameOf`): one kind, "mixed" for several. */
      const cameHere = () => {
        const kinds = new Set(live.inbox.filter((d) => !d.held).map(cameOf));
        return kinds.size > 1 ? "mixed" : [...kinds][0];
      };
      if (reading && runs?.events && runs.subscribe) {
        live.watched = (sa) => ({
          id: sa.id,
          role: sa.team?.role || "sub-agent",
          description: sa.description,
          task: sa.task ? sa.task.id : null,
          run: sa.exchanges.at(-1)?.runId ?? null,
          head: sa.run ? reading.head({ progress: sa.run.progress }, now()) : [],
          mark: sa.run?.look || newMark(),
        });
        live.looks = createLooks({
          now,
          later,
          seconds: reading.seconds,
          lean: reading.lean === true,
          who: reading.who || "workers",
          // The team's workers that run now and are read from their start, oldest first.
          workers: () => (live.closed || !live.watched ? [] : ofChain().filter((s) => (s.team || s.task) && s.run?.look).map(live.watched)),
          eventsOf: runEvents,
          wake: () => {
            for (const w of [...live.wake]) w("look");
          },
        });
      }
      /** The workers whose progress a look just changed: their signs are shown, or back. @param {import("./looks.js").LookMeta} meta */
      const lookMoved = (meta) => {
        for (const w of meta.workers) {
          const sa = subs.get(w.id);
          if (sa?.run && readInto(sa.run)) progressed(sa);
        }
      };
      return {
        subagents: {
          async run({ id, input, emit, signal, stopSignal = null, withinMs = 0, coder = false, batch = null }) {
            // What the call attaches (`attach`, attach.js: the owner's of 11-17) goes with a launch or a follow-up alone.
            const attaching = input?.attach != null && !(Array.isArray(input.attach) && !input.attach.length);
            const withoutAttach = /** @type {const} */ (["stop", "apply_changes", "mark_applied", "list_models", "list_machines"]).filter((k) => input?.[k] === true);
            if (attaching && withoutAttach.length) throw new Error(`attach goes with a launch or a follow-up: leave it out of a call with ${withoutAttach.join(", ")}`);
            // The agent stops a sub-agent itself, instead of a launch or a follow-up (the owner's of 11-11): a stop into
            // its run, and nothing else with it — read first, so that no field beside it is taken for another call's.
            if (input?.stop === true) return agentStop(chainId, input);
            // The models a sub-agent can run on (HarnessV4_Tasks E23-D4): a call's answer, never the tool's text — with
            // `machine`, the ones that answer on that machine (the remote-agents plan's s-launch).
            const on = String(input?.machine ?? "").trim();
            // A chat another machine's agents started, or one up its line, sends nothing to a machine of this Filament's,
            // whatever its tool offers: refused before anything is asked there.
            if ((on || input?.list_machines === true) && ctx?.agentsChat?.(chainId)) throw new Error(AGENTS_CHAT_MACHINES);
            if (input?.list_models === true) {
              const narrow = { model: input?.model ?? null, provider: input?.provider ?? null };
              const text = on ? await remote.modelsText(on, narrow) : await modelsText(chainId, narrow);
              // Both lists asked in one call: the machines after the models.
              const machinesToo = input?.list_machines === true ? await remote.machinesText({ folder: cwd }) : null;
              const note = on ? `agent: listed the models that answer on ${on}` : "agent: listed the models a sub-agent can run on";
              return { ok: true, text: machinesToo ? `${text}\n\n${machinesToo}` : text, spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: machinesToo ? `${note}, and the machines` : note };
            }
            // The machines a sub-agent can run on, the same way: each kept for this Filament's agents, whether it answers,
            // what it has to work with and its clones of this chat's project.
            if (input?.list_machines === true) {
              const text = await remote.machinesText({ folder: cwd });
              return { ok: true, text, spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: "agent: listed the machines a sub-agent can run on" };
            }
            // The agent accepts a sub-agent's work: its worktree's changes into this folder, instead of a follow-up — or
            // says they are in it already, brought in by hand (10-29).
            // Its word on the files where the change overlaps edits in the folder (the owner's of 11-09): an apply's alone.
            const overlap = input?.overlap == null || input.overlap === "" ? null : String(input.overlap);
            if (overlap && input?.apply_changes !== true) throw new Error("overlap goes with apply_changes: what to do with the files where its change overlaps yours");
            if (overlap && !OVERLAPS.includes(/** @type {Overlap} */ (overlap))) throw new Error(`overlap is "markers", "mine" or "send_back", not ${JSON.stringify(overlap)}`);
            if (input?.apply_changes === true || input?.mark_applied === true) {
              const target = String(input?.agent_id || "").trim();
              const applies = input?.apply_changes === true;
              if (applies && input?.mark_applied === true) throw new Error("apply_changes or mark_applied, not both: an apply writes its changes into your folder, a mark says they are in it already");
              if (!target) throw new Error(applies ? "apply_changes needs agent_id: the sub-agent whose changes to apply" : "mark_applied needs agent_id: the sub-agent whose changes are in your folder already");
              // One on another machine changed that machine's folder: nothing of it is here to apply or mark — but what one
              // changed in its own copy there, which came back here (cp-back).
              const there = subs.get(target);
              if (there?.remote && there.chainId === chainId && !there.work?.there)
                throw new Error(there.remote.copy ? `sub-agent ${target}'s changes are in its own copy on ${there.remote.machine.name}, and nothing of them came here` : `sub-agent ${target}'s changes are on ${there.remote.machine.name}: have it commit its own change alone, on a branch of its own, and push that branch, then fetch it here`);
              if (there?.work?.there && there.chainId === chainId && overlap === "send_back") throw new Error(`sub-agent ${target} works on ${there.remote?.machine.name || "another machine"}, in its own copy there, which send_back does not reach: overlap is "markers" or "mine" for it`);
              const reason = String(input?.reason ?? "").trim() || null;
              if (!applies) return markedResult(target, await markTaken(target, chainId, "agent"));
              const way = /** @type {Overlap | null} */ (overlap);
              // Sent back, it goes on in the background under this call, as any follow-up of the agent's does.
              const parent = way === "send_back" ? { live, toolUseId: id, emit, signal: null, stopSignal: null } : null;
              return appliedResult(target, await apply(target, chainId, "agent", { reason, overlap: way, parent }), { overlap: way });
            }
            // The loop's launch runs in the background unless it asks to wait for the report (the owner's word of 10-27:
            // "priority should be to run the agent in background"); a coding agent's waits unless it says otherwise.
            const background = coder ? input?.run_in_background === true : input?.run_in_background !== false;
            /** @type {LaunchParent} */
            const parent = { live, toolUseId: id, emit, signal: background ? null : signal, stopSignal: background ? null : stopSignal };
            const followed = String(input?.agent_id || "").trim();
            // A launch on another machine (the remote-agents plan's s-launch) is refused in words before anything starts
            // where it asks for what stays here (`remoteRefusal`); its machine and folder are found at its launch.
            const refused = on ? remoteRefusal(input, followed) : "";
            if (refused) throw new Error(refused);
            // The kind: Builder with none named, or Reviewer — the main agent's own two, whose call's context applies — or
            // the tag of a saved agent the session names (AG-6), which runs as its card says, so the call's own context
            // does not apply (AG-51). An unknown word is refused at the launch, in words.
            // A saved agent the developer's newest message names (`saved_agent`, the owner's 10-19 list): by its name or
            // tag, in the kind's place — Builder's or Reviewer's place where it holds one, else asked by its tag.
            const savedCard = followed || on ? null : savedNamed(chainId, input?.saved_agent);
            const said = savedCard ? savedCard.tag : String(input?.subagent_type ?? "").trim().replace(/^@/, "");
            const kind = said.toLowerCase();
            const named = asksOf(chainId);
            const own = workerFor(named, kind) != null;
            // A word that is neither of its own two nor a tag the session names is refused in the agent's own word (AG-50).
            if (!followed && !savedCard && !own && !named.some((a) => a.tag === kind)) throw new Error(notAskable(said, named));
            if (on && !own) throw new Error(`a sub-agent on another machine runs as one of your own kinds, never \`${said}\`: leave subagent_type out, or name one of them`);
            // A turn with no request of Filament's has nothing to fork: a fork asked for is refused in words.
            if (!live.fork && !followed && own && input?.context === "fork") throw new Error(NO_FORK);
            const view = input?.context;
            // The change it hands over as a patch (L-43): named, it wins over what a card says it sees.
            const handed = String(input?.changes ?? "").trim();
            // Its model as named — as a person says it, at the provider named (E23-D1 to D3) — and its effort (D5). A
            // follow-up runs on its own, and a fork as the main agent's request does: naming either is refused in words.
            const naming = MODEL_FIELDS.filter((k) => input?.[k] != null && String(input[k]).trim() !== "");
            if (followed && naming.length) throw new Error(`a follow-up runs on the model and the effort its launch gave it — leave ${listed(naming)} out, or launch a new sub-agent`);
            if (!followed && view === "fork" && naming.length) throw new Error(`a fork runs as the main agent's request does, its model and effort with it — leave ${listed(naming)} out, or choose another context`);
            // A model several accounts serve runs on the one the chat's agent runs on, where it is one of them; where the
            // person set the list its card runs from, on that list alone, at its efforts (the owner's of 11-19).
            const chosen = followed || on ? null : await agentChoice(chainId, input, { card: cardOf(own ? String(workerFor(named, kind)) : kind), model: model || null });
            if (chosen && !chosen.ok) throw new Error(chosen.error);
            // The graph task a coding agent's launch is for (10-28), or its follow-up's (11-09): refused in words before
            // anything starts.
            const taskId = coder ? String(input?.task ?? "").trim().toLowerCase() : "";
            const taskWhy = taskId ? (ctx?.taskHelper ? ctx.taskHelper.refusal(chainId, taskId) : "this Filament keeps no task graph here: leave task out") : null;
            if (taskWhy) throw new Error(taskWhy);
            // One helper a task at a time: another still at work on it, or launching, refuses this one; the one at work on
            // it may be followed up naming it.
            const helpKey = taskId ? `${chainId}\n${taskId}` : "";
            if (helpKey && helping.has(helpKey) && !(followed && helping.get(helpKey) === followed)) {
              const holder = helping.get(helpKey);
              const at = holder ? subs.get(holder) : null;
              if (!holder) throw new Error(`another launch is taking ${taskId} now — wait for it, or leave task out`);
              if (at?.status === "running") throw new Error(`${holder} works on ${taskId} already — follow up with it (agent_id ${holder}), or leave task out`);
              helping.delete(helpKey);
            }
            /**
             * A follow-up's task keeps who works on it now, its box saying so — whether in a copy of its own once that is
             * known: one still opening its copy has no work yet (`tree`). @param {Subagent} sa
             */
            const tookTask = (sa) => {
              if (!helpKey) return;
              helping.set(helpKey, sa.id);
              /** @param {boolean} copy */
              const took = (copy) => ctx?.taskHelper?.took(chainId, taskId, { agent: sa.id, model: sa.model, copy, at: now() });
              if (sa.work || !sa.tree) took(!!sa.work);
              else void sa.tree.then(took);
            };
            // A follow-up to one at work goes as a message, read at its next step, as a lead's worker tool sends one (the
            // owner's of 11-09): its run goes on, and its report comes as it would have.
            const busy = followed ? subs.get(followed) : null;
            if (busy && busy.chainId === chainId && busy.status === "running") {
              // One helper on one task at a time: a message read while it works stays with the task it holds, still open.
              const holds = taskId ? [...helping].find(([k, v]) => v === busy.id && k !== helpKey && k.startsWith(`${chainId}\n`) && !ctx?.taskHelper?.refusal(chainId, k.slice(chainId.length + 1))) : null;
              if (holds) {
                const other = holds[0].slice(chainId.length + 1);
                throw new Error(`sub-agent ${busy.id} works on ${other} now: a message to it while it works stays with ${other} — name ${other} or leave task out, and launch another helper for ${taskId}`);
              }
              // One on another machine reads no message of this one's: its follow-up waits for its report.
              if (busy.remote) throw new Error(`sub-agent ${busy.id} is still working on ${busy.remote.machine.name}, which no message of this machine's reaches: its report comes first, then follow up with agent_id "${busy.id}"`);
              const held = [...(input?.sync === true ? ["sync"] : []), ...(handed ? ["changes"] : []), ...(attaching ? ["attach"] : [])];
              if (held.length) throw new Error(`sub-agent ${busy.id} is still working, so your follow-up goes as a message read at its next step: leave ${listed(held)} out, or send ${held.length === 1 ? "it" : "them"} once it reported`);
              const m = message(busy.id, { chainId, text: String(input?.prompt ?? ""), from: "agent" });
              if (!m.ok) throw new Error(m.error);
              tookTask(busy);
              return { ok: true, text: sentText(busy, m), spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: `agent: a message to ${busy.asked ? `${busy.card.name} (${busy.id}, ` : `sub-agent ${busy.id} (`}${busy.model}), read at its next step` };
            }
            // The folder as it stands now into its worktree first (the owner's list of 11-08): its follow-up is asked
            // whether it would go before anything moves, and starts inside the move; refused, nothing moves.
            if (input?.sync === true && !followed) throw new Error("sync needs agent_id: the sub-agent whose worktree takes your folder in");
            // Read once, here, and refused whole before anything starts — a held launch carries them as read now.
            if (attaching && !attachFrom) throw new Error("attach is not taken in this turn: name the files' paths in your prompt for it to read with its own tools");
            const attached = attaching && attachFrom ? await attachments(input.attach, { ...attachFrom(), dataDir }) : null;
            /** @param {string} text */
            const saidWith = (text) => (attached ? `${text}\n\n${attached.said}` : text);
            /** @param {{ synced?: string | null, moved?: boolean, dry?: boolean }} [more] */
            const follow = (more = {}) => followUp(followed, { prompt: input?.prompt, chainId, parent, background, description: input?.description, changes: handed || null, attached, ...more });
            if (followed && input?.sync === true) {
              const would = follow({ dry: true });
              if (!would.ok) throw new Error(would.error);
            }
            /**
             * The launch made: at the call, or at the person's Accept of the card that held it, then in the background,
             * its report a message. Its task's box says who works on it.
             * @param {boolean} bg @param {LaunchParent} par
             */
            /** What `launch` is asked, here or at the card's Accept. @param {boolean} bg @param {LaunchParent | null} par */
            const asked = (bg, par) => ({ origin: /** @type {const} */ ("agent"), chainId, prompt: input?.prompt, description: input?.description, ...(own ? { worker: kind, view } : { as: kind }), ...(savedCard ? { said: true } : {}), ...(handed ? { changes: handed } : {}), ...(chosen?.ok ? chosen.fields : {}), ...(attached ? { images: attached.images, attachedFiles: attached.files } : {}), background: bg, cwd, mode, parentModel: model, thinking, parent: par, ...(batch != null ? { batch: `${runId}:${batch}` } : {}) });
            const startNow = async (bg, par) => {
              if (helpKey) helping.set(helpKey, null);
              const r = await (async () => {
                try {
                  return followed
                    ? input?.sync === true
                      ? await syncWork(followed, chainId, (note) => follow({ synced: note, moved: true }))
                      : follow()
                    : on
                      ? launchRemote({ chainId, prompt: input?.prompt, description: input?.description, worker: String(workerFor(named, kind)), place: await remote.place(on, { cwd: String(input?.cwd ?? input?.folder ?? "").trim() || null, folder: cwd, copy: true }), model: input?.model ?? null, effort: input?.effort ?? null, mode, prefer: model || null, changes: handed || null, background: bg, parent: par, attached })
                      : await launch(asked(bg, par));
                } catch (e) {
                  if (helpKey) helping.delete(helpKey);
                  throw e;
                }
              })();
              if (helpKey) {
                if (r.ok) helping.set(helpKey, r.id);
                else helping.delete(helpKey);
              }
              if (!r.ok) throw new Error(r.error);
              const sa = /** @type {Subagent} */ (subs.get(r.id));
              // Its box says who works on it once its first message knows whether it has its own copy; a follow-up's at once.
              if (taskId && "tree" in r) void r.tree.then((copy) => ctx?.taskHelper?.took(chainId, taskId, { agent: sa.id, model: sa.model, copy, at: now() }));
              else if (taskId) tookTask(sa);
              return { r, sa };
            };
            // Parallelize tasks off (the owner's of 11-14): a sub-agent the chat's agent launches that may change files
            // waits for the person's yes on a card (held-launch.js), and the call answers at once that it is held — the
            // agent goes on with a piece of its own, or waits. Never held: a follow-up, a saved agent the person's newest
            // message names (their word is the yes), a lead's worker, one that only reads and one that works in a copy it
            // keeps nothing of. The card, unanswered, starts it by itself wherever it would work, as an Accept does (the
            // owner's choice of 11-14), where a model is known; else it stays the agent's (`declines`). A launch that
            // would be refused is refused now, never held: asked first whether it would go, which also says the model it
            // runs on and whether it has a copy of its own, which the card shows.
            const writer = (own ? cardOf(String(workerFor(named, kind)))?.may : named.find((a) => a.tag === kind)?.may) ?? "edit";
            if (!followed && !savedCard && !lead && writer !== "read" && writer !== "copy" && ctx?.holdsWriters?.(chainId) === true) {
              if (holds.refusing(chainId, turnKey(live))) throw new Error(ONE_AT_A_TIME_WORDS);
              const would = on ? null : launch({ ...asked(true, null), dry: true });
              if (would && !would.ok) throw new Error(would.error);
              // Its task is taken from here, before the folder's read lets another call in: a second launch for it, at once
              // or while the card holds this one, is refused as one launching. Let go where it is not held after all.
              if (helpKey) helping.set(helpKey, null);
              const letGo = () => {
                if (helpKey && helping.get(helpKey) === null) helping.delete(helpKey);
              };
              // Its own copy: a worktree or a patch in a repository with a commit — else it shares the folder after all (`openWork`).
              const copy = !!would?.ok && !!would.dry?.ownTree && (await repoOf(cwd).then((x) => !!x?.repo && !!x?.head, () => false));
              // The turn ended while the folder was read: no card outlives it.
              if (live.closed) {
                letGo();
                throw new Error("Not started: the turn ended");
              }
              const runsOn = String((would?.ok && would.dry?.model) || (chosen?.ok && chosen.fields?.model) || input?.model || model || "");
              const where = on ? "machine" : copy ? "copy" : "folder";
              // Another machine picks its own model where none is named.
              const declines = !on && !runsOn ? "no model is named for it" : "";
              const description = clip(String(input?.description || input?.prompt || "a sub-agent").trim(), 120);
              const h = holds.hold(chainId, {
                runId: turnKey(live),
                turn: ctx?.newestTurn?.(chainId) ?? null,
                view: { description, kind: own ? String(workerFor(named, kind)) : kind, model: runsOn, where, ...(on ? { machine: on } : {}), ...(attached ? { attached: { files: attached.files.map((f) => f.name), pictures: attached.images.map((p) => p.name) } } : {}), declines },
                // Under its turn as it runs now: one paused and gone on since it was held is one turn (`turnKey`) in a new
                // live self, which stays open for its report and draws its events.
                start: async () => {
                  const now_ = liveTurnOf(chainId);
                  const parent = now_ && now_ !== live && turnKey(now_) === turnKey(live) ? { live: now_, toolUseId: id, emit: (/** @type {any} */ e) => now_.emit?.({ ...e, round: now_.round?.() ?? 0 }), signal: null, stopSignal: null } : { live, toolUseId: id, emit, signal: null, stopSignal: null };
                  return [(await startNow(true, parent)).sa.id];
                },
                declined: letGo,
              });
              const beside = h.launches.length - 1;
              return { ok: true, text: saidWith(heldWords(declines)), spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: `agent: held “${description}” for the person's yes on a card (Parallelize tasks is off)${beside ? `, beside ${beside} more` : ""}` };
            }
            const { r, sa } = await startNow(background, parent);
            const noted = `agent: ${followed ? "a follow-up to" : sa.asked ? "asked" : "launched"} ${sa.asked ? `${sa.card.name}, a saved agent (${sa.id}, ${sa.model}` : `sub-agent ${sa.id} (${sa.card.name}, ${sa.model}`}${sa.view !== "none" ? `, ${sa.view} view` : ""})${sa.remote ? ` on ${sa.remote.machine.name}` : ""}${background ? " in the background" : ""}`;
            if (background) return { ok: true, text: saidWith(launchedText(sa, followed, live)), spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: noted };
            // The developer may free the main agent from this run (Detach, BUG-12): the call answers now and the
            // sub-agent runs on — its report as a message later, or kept for the developer.
            /** @type {Promise<"report" | "aside" | "away">} */
            const detached = new Promise((resolve) => {
              if (sa.run) sa.run.onDetach = resolve;
            });
            /** @type {NodeJS.Timeout | undefined} */
            let timer;
            /** @type {Promise<"late"> | null} */
            const late =
              withinMs > 0
                ? new Promise((resolve) => {
                    timer = setTimeout(resolve, withinMs, "late");
                    timer.unref?.();
                  })
                : null;
            /** @type {() => Promise<{ o: Outcome | null, how: "report" | "aside" | "away" | "late" | null }>} */
            const settled = () => Promise.race([r.done.then((o) => ({ o, how: null })), detached.then((how) => ({ o: null, how }))]);
            let first = await (late ? Promise.race([settled(), late.then((how) => ({ o: null, how }))]) : settled());
            clearTimeout(timer);
            // The call may wait no longer (AG-68): the sub-agent runs on as a background launch of this turn's own. One
            // that ended, or that the developer detached, in the same moment answers as it would have.
            if (first.how === "late") {
              const run = sa.run;
              if (run?.onDetach) {
                runsOn(sa, run, true);
                changed(sa);
                return { ok: true, text: saidWith(outlastedText(sa, live)), spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: `${noted} — longer than its call may wait: it runs on, and its ${sa.asked ? "answer" : "report"} comes as a message` };
              }
              first = await settled();
            }
            // Its machine does not answer (`remoteTurn`): the call waits no longer on a machine nobody knows the return of.
            if (first.how === "away") return { ok: true, text: saidWith(awayText(sa, awayNow.get(sa.id) || { ms: UNREACHABLE_AFTER_MS, why: "" })), spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: `${noted} — ${unreachableWords(sa.remote?.machine.name || "its machine")}: its call waits no longer, and its report comes as a message` };
            if (first.how === "report" || first.how === "aside") return { ok: true, text: saidWith(detachedText(sa, first.how, live)), spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false, note: `${noted} — detached by the developer (${first.how === "report" ? "its report comes as a message" : "its report stays the developer's"})` };
            const o = /** @type {Outcome} */ (first.o);
            const writes = o.wrote ? writesOf(sa, [o]) : undefined;
            // The record's line says whose stop it was (`endedWord`), a lead's as its team's.
            return { ok: o.ok, text: saidWith(resultText(sa, o, live)), spentUsd: o.spentUsd, toolCalls: o.toolCalls, roundIds: o.roundIds, wrote: o.wrote, ...withWrites(writes), note: `${noted} — ${o.stoppedBy === "lead" ? "was stopped by its team's lead" : endedWord(o.status, o.stoppedBy)} after ${o.rounds} round${o.rounds === 1 ? "" : "s"}, ${o.toolCalls} tool call${o.toolCalls === 1 ? "" : "s"}` };
          },
        },
        inbox: {
          take: ({ seal = false, end = false } = {}) => {
            if (stopping) return [];
            const due = live.inbox.splice(0);
            // HarnessV4_Envelopes_Plan EN-D1: a loop at work takes another agent's result sealed, where its session says
            // so; a loop that waits has nothing to be pulled from, so what it left sealed opens first, oldest first. At
            // its turn's end (`end`) it works no more: a result that came is opened, the sealed ones ahead of it in their
            // order — and with none, they stay sealed for the turn's reminder (EN-D5). The session's word on sealing is
            // read only where something came or waits sealed: with neither, nothing is sealed or opened either way, and
            // this runs at every tool round of the turn.
            const sealing = seal && !end && (due.length > 0 || c.sealed.length > 0) && sealsOn(chainId) && live.opens() === true;
            // Another chat's letter is its agent's to open when it chooses (the owner's of 11-04): where it opens
            // envelopes, a letter is sealed at any take — as it waits, at its turn's end — and none opens it.
            const keeps = keepsLetters(chainId, c, due);
            const seals = (/** @type {Delivery} */ d) => sealable(d) && (sealing || (keeps && isLetter(d)));
            // An agent that opens no envelopes takes every one sealed whole, at its turn's end too (EN-D10): a letter
            // sealed while no turn ran, as the chat's last agent opened them, would else wait for it ever after.
            const opening = !sealing && (live.opens() === false || !end || due.some((d) => sealable(d) && !seals(d)));
            const opened = opening ? pullOut(c.sealed, (d) => !(keeps && isLetter(d))) : [];
            /** @type {Taken[]} */
            const out = opened.map((d) => ({ ...counted(d, live.runs), opened: true }));
            /** @type {Delivery[]} */
            const sealedNow = [];
            // A letter sealed while no turn read it, which the turn's start did not list (a pause's resume): said now.
            for (const d of c.sealed)
              if (d.fresh) {
                delete d.fresh;
                sealedNow.push(d);
                out.push({ ...counted(d, live.runs), kind: "envelope", envelope: d.envelope, text: "" });
              }
            for (const d of due) {
              if (!seals(d)) {
                out.push(counted(d, live.runs));
                continue;
              }
              // Its spend is counted as it is taken, by the turn that launched it; the envelope keeps none. Nor the wake of
              // the message it was (the nudge map of 11-10): a report that woke the chat, sealed here, read as a letter
              // still owed its wake once the turn ended — the next wake said "a letter … waits sealed" of it.
              const { wakes: _woke, ...was } = d;
              const kept = { ...was, envelope: ++c.envelopes, spends: [] };
              c.sealed.push(kept);
              sealedNow.push(kept);
              out.push({ ...counted(d, live.runs), kind: "envelope", envelope: kept.envelope, text: "" });
            }
            for (const t of out) if (t.kind === "envelope") t.text = envelopeLine(envelopeView(/** @type {Delivery} */ (sealedNow.find((d) => d.envelope === t.envelope))), c.sealed.length);
            if (due.length || opened.length || sealedNow.length) persist(chainId);
            if (sealedNow.length || opened.length) envelopesMoved(chainId);
            // A look at the workers still running rides behind the reports: one that reported is not in it (TG2-D14).
            const look = live.looks?.due() ? live.looks.take() : null;
            if (look) {
              lookMoved(look.meta);
              out.push({ kind: "look", text: look.text, look: look.meta, from: "", description: "", spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false });
            }
            return out;
          },
          back: (taken) => {
            // A look is no delivery: its marks go back, and nothing of it waits.
            for (const t of taken)
              if (t.kind === "look" && t.look && live.looks) {
                live.looks.back(t.look);
                lookMoved(t.look);
              }
            // An envelope's line that never reached the model leaves it sealed, where it is: the next turn lists it
            // (EN-D6). One opened and never read is sealed again, in its place at the front.
            const strip = (/** @type {Taken} */ { spentUsd, toolCalls, roundIds, look, opened, ...d }) => /** @type {Delivery} */ ({ ...d, spends: [] });
            const reopened = taken.filter((t) => t.opened).map(strip);
            const kept = taken.filter((t) => t.kind !== "look" && t.kind !== "envelope" && !t.opened).map(strip);
            if (!kept.length && !reopened.length) return;
            if (reopened.length) c.sealed.unshift(...reopened);
            live.inbox.unshift(...kept);
            persist(chainId);
            if (reopened.length) envelopesMoved(chainId);
          },
          open: ({ count = 1, all = false } = {}) => {
            const n = all ? c.sealed.length : Math.max(1, Math.floor(Number(count) || 1));
            const out = c.sealed.splice(0, n);
            if (out.length) persist(chainId);
            if (out.length) envelopesMoved(chainId);
            return out.map((d) => ({ ...counted(d, live.runs), opened: true }));
          },
          picture: (key) => pictureOf(chainId, key),
          sealed: () => c.sealed.map(envelopeView),
          waitOpens: () => {
            const keeps = keepsLetters(chainId, c);
            return c.sealed.filter((d) => !(keeps && isLetter(d))).length;
          },
          fresh: (listed) => {
            const told = c.sealed.filter((d) => d.fresh && listed.includes(Number(d.envelope)));
            for (const d of told) delete d.fresh;
            if (told.length) persist(chainId);
            return told.map(envelopeView);
          },
          letter: (input) => ctx?.sendLetter?.(chainId, input) ?? null,
          seals: () => sealsOn(chainId),
          reads: !!live.looks,
          own: () => [...live.own],
          coming: () => [...new Set(live.inbox.filter((d) => d.kind === "report").map((d) => d.from))],
          held: () => live.inbox.filter((d) => d.held).length,
          who: reading?.who || "workers",
          due: () => !stopping && !!live.looks?.due(),
          look: () => live.looks?.ask(),
          pace: () => (live.looks && reading ? reading.seconds() : null),
          hold: () => waitAll(ofChain().filter((s) => s.pausing === runId)),
          owed: () => {
            const own = waitAll(ofChain().filter((s) => s.pausing === runId || (live.own.has(s.id) && s.background)));
            const graph = owes?.() || null;
            // The folder's checks after its lead's applies: their verdicts come to this door (TG2-D55).
            const checks = c.checks.size ? Promise.all([...c.checks].map((k) => k.done)).then(() => {}) : null;
            // A flow the main agent drives In place (OA4): the turn stays open until it ends; each of its words wakes it.
            const flow = lead ? null : ctx?.flowOwes?.(chainId) || null;
            // A card holding its launches for the person's yes: the turn stays open for its answer, and what it starts.
            const held = lead ? null : holds.owed(chainId);
            const all = [own, graph, checks, flow, held].filter((p) => p != null);
            return all.length > 1 ? Promise.all(all).then(() => {}) : all[0] || null;
          },
          // What the turn waits for, as the page says it (the owner's of 11-04: "it should be mentioned … why the turn is
          // currently blocked"): its own sub-agents by name, the folder's checks, the flow it drives. Null for a lead —
          // its turn names its workers — and where only the graph's work is owed.
          owedWhy: () => {
            if (lead) return null;
            const own = ofChain().filter((s) => s.pausing === runId || (live.own.has(s.id) && s.background));
            const names = own.map((s) => `“${clip(String(s.description || s.id), 60)}”`);
            const parts = [
              own.length === 1 ? `its sub-agent ${names[0]} to report` : own.length ? `its ${own.length} sub-agents ${listed(names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} more`] : names)} to report` : null,
              c.checks.size ? "the folder's checks" : null,
              ctx?.flowDriven?.(chainId) ? "the flow it drives" : null,
              holds.waiting(chainId) ? "your answer on the card for sub-agents that change files" : null,
            ].filter((p) => p != null);
            return parts.length ? `waiting for ${listed(parts)}` : null;
          },
          came: () => cameHere(),
          // What waits held for the graph's other workers is no arrival (the owner's of 11-02): their last end, or the
          // graph going quiet, brings it.
          arrival: () =>
            live.inbox.some((d) => !d.held)
              ? Promise.resolve(cameHere())
              : !stopping && live.looks?.due()
                ? Promise.resolve("look")
                : new Promise((resolve) => {
                    const w = (/** @type {string | undefined} */ what) => {
                      live.wake.delete(w);
                      resolve(what);
                    };
                    live.wake.add(w);
                  }),
        },
        close({ paused = false } = {}) {
          // The newest request, read before the turn lets go: Enhance forks it while the provider may still cache it.
          const warm = live.cache?.() || null;
          // A worker's question to its lead (TG2-D58) waits through a pause, for its resume to read; once its lead's turn
          // ends, no answer comes, and the worker goes on with its pick — before what this turn never read goes on, so no
          // question reaches a turn after it. A turn that ends all the same — a stop, a hang-up — ends the folder's checks
          // still running (TG2-D55); a pause's resume waits for them.
          if (!paused && c.turn === live) endAsks(chainId, c);
          // A card still waiting as its turn ends starts nothing (its agent hears so at its next turn), and the turn's
          // One at a time is let go with it. A pause's resume keeps it.
          if (!paused) holds.stop(chainId, turnKey(live));
          else holds.pause(chainId, turnKey(live), true);
          live.closed = true;
          if (c.turn === live) {
            c.turn = null;
            c.paused = paused;
            // Whether its agent opens envelopes, as the turn ends: the chat's word on letters until its next turn — where
            // the turn came to know it.
            const opens = live.opens();
            if (opens != null) c.opens = opens;
          }
          for (const w of [...live.wake]) w(); // nothing waits on a closed turn's inbox
          // What this turn never read goes to whoever reads the session next: a turn that took it, else its queue. A
          // result handed in goes back to its sender, which sends it as a turn of its own once the chat is free (EN4);
          // a pause's resume reads it. A letter is kept for the chat as one that came while no turn ran (`shelveLetter`).
          for (const d of live.inbox.splice(0)) {
            if (isLetter(d)) {
              shelveLetter(chainId, c, d);
              continue;
            }
            const back = !paused && d.handed ? c.backs.get(d.handed) : null;
            if (!back) {
              enqueue(chainId, d);
              continue;
            }
            c.backs.delete(/** @type {string} */ (d.handed));
            try {
              back();
            } catch (/** @type {any} */ e) {
              log("warn", `sub-agents: session ${chainId}: a result its turn never read could not go back to its sender (${e?.message || e}); it waits for the next turn`);
              enqueue(chainId, d);
            }
          }
          // Its newest request is kept first: a side run's task that waited for the turn's end forks from it. A turn that
          // sent no request of Filament's (a coding agent's, one ended before its first) lets the older one go: a fork
          // of it would miss this turn.
          if (warm) keepWarm(chainId, warm);
          else letGoWarm(chainId);
          // What waited for the turn's end goes now (`turnOver`).
          if (!paused && !c.turn) turnOver(chainId, c);
          events.publish("subagents", { type: "subagent-cache", chainId });
          // Its chat was deleted while it ran: what the registry kept for it goes with the turn.
          if (!paused && !c.turn && goneChats.has(chainId)) dropChat(chainId);
          return { own: [...live.own], runs: [...live.runs], ...(live.lead ? { launched: live.launched } : {}) };
        },
      };
    },
    /**
     * The messages a session's next turn opens with (the harness puts their text in the turn's message). They stay
     * queued until `ackQueued` — a turn refused before it is sent leaves them for the next one.
     * @param {string} chainId @returns {readonly Delivery[]}
     */
    peekQueued: (chainId) => [...chainState(chainId).queue],
    /**
     * The session's sealed envelopes, oldest first (HarnessV4_Envelopes_Plan EN1): what its loop took sealed and has
     * not opened. @param {string} chainId @returns {Envelope[]}
     */
    envelopes: (chainId) => chainState(chainId).sealed.map(envelopeView),
    /**
     * A picture one of the session's agents drew, by its name or its id (HarnessV4_DesignPass_Plan UX1).
     * @param {string} chainId @param {string} key @returns {Picture}
     */
    picture: (chainId, key) => pictureOf(chainId, key),
    /**
     * The line another agent's result ends with where its agents drew — a team's beside the session, a flow's end — as a
     * helper's report says it (`drewLine`): their names and sizes, and how the session's agent opens one where it can.
     * @param {string} chainId @param {Pick<Drew, "title" | "bytes">[] | undefined} drew @param {string} who
     */
    drewWords: (chainId, drew, who) => drewLine(drew, picturesOpen(chainId), who),
    /**
     * Another agent's result from outside the registry — a team's beside the session, a flow's end
     * (HarnessV4_Envelopes_Plan EN4) — into the session's running turn, as a sub-agent's report goes: sealed while its
     * agent works, opened while it waits, never a note of Filament's (EN-D11). `ok` false where no turn of the session's
     * reads Filament's inbox now: its sender reaches the chat its own way. `sealed`: the session takes results sealed
     * (EN-D8). `back`: the turn ended before it read it — its sender sends it as a turn of its own.
     * @param {string} chainId
     * @param {{ id: string, text: string, description: string, sender: string, subject: string, via?: "team" | "flow" | null, back?: (() => void) | null }} r
     *   `via`: a team's or a flow's, which the page's card opens (EN5)
     * @returns {{ ok: boolean, sealed: boolean }}
     */
    hand(chainId, { id, text, description, sender, subject, via = null, back = null }) {
      const chain = String(chainId || "");
      if (stopping || !liveTurnOf(chain)) return { ok: false, sealed: false };
      const c = chainState(chain);
      const handed = `${id}#${++handedSeq}`;
      if (back) c.backs.set(handed, back);
      enqueue(chain, { text: String(text), from: String(id), description: String(description), kind: "result", seal: true, subject: String(subject), sender: String(sender), ...(via === "team" || via === "flow" ? { via } : {}), handed, spends: [], wrote: false });
      // An agent that opens no envelopes takes it whole; one whose turn does not know yet is taken as one that does.
      return { ok: true, sealed: sealsOn(chain) && c.turn?.opens() !== false };
    },
    /**
     * A letter from another chat (letters.js, the owner's of 11-04): into the session's running turn, whose takes seal it
     * whenever its agent opens envelopes — at work, waiting or at its end — or, with no turn running, kept for the chat
     * (`shelveLetter`): sealed among its envelopes and the chat woken to open it when its agent chooses (`lettersDue`);
     * whole in its queue where the session takes results whole or its agent opens no envelopes, waking it as a report
     * does. → where it went. `via` "steer": the letter of the fork that weighed the person's message aside, to the
     * agent it forked from (the owner's forked steer of 11-04); "agent": a sub-agent's of the session's to the agent
     * that launched it (`subLetter`). Each goes as another chat's does.
     * @param {string} chainId
     * @param {{ text: string, from: string, description: string, sender: string, subject: string, via?: "chat" | "steer" | "agent" }} r
     *   `from`: the sender's chat, the fork, or the sub-agent
     * @returns {{ ok: boolean, at: "turn" | "sealed" | "queue" | null }}
     */
    letter(chainId, { text, from, description, sender, subject, via = "chat" }) {
      const chain = String(chainId || "");
      if (stopping || !chain) return { ok: false, at: null };
      const c = chainState(chain);
      /** @type {Delivery} */
      const d = { text: String(text), from: String(from), description: String(description), kind: "result", seal: true, subject: String(subject), sender: String(sender), via: via === "steer" || via === "agent" ? via : "chat", spends: [], wrote: false };
      if (liveTurnOf(chain)) {
        enqueue(chain, d);
        return { ok: true, at: "turn" };
      }
      return { ok: true, at: shelveLetter(chain, c, d) };
    },
    /**
     * A sub-agent's envelope tool writing a letter, or answering one (letters.js, the owner's of 11-04: "main agent and
     * sub agent can talk to each other"): sent as its session's, written by it — to the agent that launched it, or back
     * to it. Refused in words where Filament knows it no more or sends no letters. `waits`: its own loop's call, which
     * can wait for the reply (letters.js `waiting`).
     * @param {string} id @param {import("../letters.js").LetterInput} input @param {{ waits?: boolean }} [o]
     * @returns {{ ok: boolean, text: string, sent?: LetterSent, waiting?: import("../letters.js").ReplyWait }}
     */
    subLetter(id, input, { waits = false } = {}) {
      const sa = subs.get(String(id || ""));
      if (!sa) return { ok: false, text: `Not sent: ${noSuchSubagent(id)}.` };
      const bar = letterBar(sa);
      if (bar) return { ok: false, text: `Not sent: ${LETTER_BAR_WORDS[bar]}` };
      return ctx?.sendLetter?.(sa.chainId, input, { agent: sa.id, waits }) ?? { ok: false, text: "Not sent: this Filament sends no letters." };
    },
    /**
     * Why letters do not go between a sub-agent and the session's agent now (`letterBar`); "" where they do, or for none
     * of that id. @param {string} id
     */
    letterBar: (id) => {
      const sa = subs.get(String(id || ""));
      return sa ? letterBar(sa) : "";
    },
    /**
     * A background command's end (HarnessV4_Background_Plan BG-D2, BG-D3) into the session's running turn, whole — never
     * sealed, whatever the session's switch says: the agent that started it almost always needs its output, and an
     * envelope would only add a round trip. `ok` false where no turn of the session's reads Filament's inbox now; `back`:
     * the turn ended before it read it — its caller tells it another way (BG-D4).
     * @param {string} chainId
     * @param {{ id: string, command: string, code: number | null, text: string, back?: (() => void) | null }} r  `id`: its shell
     * @returns {{ ok: boolean }}
     */
    commandEnd(chainId, { id, command, code, text, back = null }) {
      const chain = String(chainId || "");
      if (stopping || !liveTurnOf(chain)) return { ok: false };
      const c = chainState(chain);
      const handed = `${id}#${++handedSeq}`;
      if (back) c.backs.set(handed, back);
      enqueue(chain, { text: String(text), from: String(id), description: String(command), kind: "shell", code: code ?? null, handed, spends: [], wrote: false });
      return { ok: true };
    },
    /**
     * The turn that carries these messages went out: exactly they leave the queue — one superseded meanwhile (a
     * report replaced its launch notice) is already gone, and whatever arrived since stays for the next turn.
     * @param {string} chainId @param {readonly Delivery[]} sent
     */
    ackQueued: (chainId, sent) => {
      const c = chains.get(chainId);
      if (!c || !sent.length) return;
      c.queue = c.queue.filter((d) => !sent.includes(d));
      persist(chainId);
    },
    /**
     * The letters a turn's start is about to take as told (`openTurn`, the inbox's `fresh`): each one sealed that still
     * wakes the chat or is not yet told, by its envelope's number, as it stands — what `backQueued` puts back should the
     * turn fail before its model does any work. @param {string} chainId
     * @returns {{ n: number, wakes: boolean, fresh: boolean }[]}
     */
    lettersOwed: (chainId) =>
      chainState(chainId)
        .sealed.filter((d) => (d.wakes === true || d.fresh === true) && isLetter(d))
        .map((d) => ({ n: Number(d.envelope), wakes: d.wakes === true, fresh: d.fresh === true })),
    /**
     * The turn that carried these messages failed before its model did any work, so the model's history keeps nothing
     * of it (sessions/shapes.js `modelTurnsOf`; the owner's of 11-11: "delivery is at least once"): they wait again,
     * untold, ahead of what came since — each as it waited, the wake it owed with it, and once however often it is
     * given back —, kept on the session for a restart. A worker's question is not asked again: it ended with the turn
     * (`endAsks`), and no answer comes. The letters its start took as told (`lettersOwed`) and that still wait sealed
     * wake the chat and are told again. It wakes nothing: the waker tries again at its time (sessions/wake.js `ended`).
     * @param {string} chainId @param {readonly Delivery[]} sent @param {readonly { n: number, wakes: boolean, fresh: boolean }[]} [letters]
     */
    backQueued: (chainId, sent, letters = []) => {
      const c = chains.get(chainId);
      if (!c) return;
      const back = sent.filter((d) => d.kind !== "ask" && !c.queue.includes(d));
      c.queue = [...back, ...c.queue];
      let owed = 0;
      for (const l of letters) {
        const d = c.sealed.find((x) => Number(x.envelope) === l.n && isLetter(x));
        if (!d) continue;
        if (l.wakes) d.wakes = true;
        if (l.fresh) d.fresh = true;
        owed += 1;
      }
      if (back.length || owed) persist(chainId);
    },
    /** How many reports wait for the session's next turn. @param {string} chainId */
    queued: (chainId) => chainState(chainId).queue.length,
    /**
     * How many of the chat's agents hold a seat now, every list together, for a side run of the graph's tasks (10-28) —
     * with the chat's folder, and whether its editing sub-agents work in their own copies by default ("Their own worktree
     * for edits"), for the sheet to say — as a launch reads the chat's setting (`workspaceSetting`): subagents.workspace,
     * else subagents.worktree (the review of g1). No number caps the chat (the owner's word of 11-05). @param {string} chainId
     */
    room: (chainId) => ({ running: [...subs.values()].filter((s) => seated(s, chainId)).length, cwd: String(ctx?.session(chainId)?.cwd || ""), worktree: workspaceSetting(settingsOf(chainId).sub) !== "folder" }),
    /** The chat's cards for sub-agents that change files (held-launch.js): the one waiting and the newest answered. @param {string} chainId */
    held: (chainId) => holds.list(chainId),
    /**
     * The person's answer on a card: Accept starts what it holds, One at a time keeps it with the agent; Always accept in
     * this chat is an Accept said so (the chat's own Parallelize tasks is the route's to switch on).
     * @param {string} chainId @param {string} id @param {"accept" | "decline" | "always"} said
     */
    answerHeld: (chainId, id, said) => holds.answer(chainId, id, said === "accept" || said === "always" ? "accept" : "decline", "person", { always: said === "always" }),
    /**
     * A launch the task graph would make, held on the chat's card as the agent's own are (graph-runner.js): `start` makes
     * it at the Accept, `declined` hears it never will. Returns the card as it stands.
     * @param {string} chainId @param {{ runId: string, view: Omit<import("./held-launch.js").HeldLaunch, "n">, start: () => Promise<string[]> | string[], declined?: (by: "person" | "timeout" | "stop") => void }} e
     */
    holdTask: (chainId, e) => holds.hold(chainId, { ...e, runId: heldTurn(chainId, e.runId), turn: ctx?.newestTurn?.(chainId) ?? null }),
    /**
     * A request's turn as the cards for sub-agents that change files key it: the chat's live turn's first request where
     * that turn holds it — a turn paused and resumed is one. @param {string} chainId @param {string} runId
     */
    heldTurn,
    /** Whether the person chose One at a time on a card of the turn this request is in. @param {string} chainId @param {string} runId */
    heldRefusing: (chainId, runId) => holds.refusing(chainId, heldTurn(chainId, runId)),
    /** Whether the session's turn runs now. @param {string} chainId */
    turnRuns: (chainId) => !!liveTurnOf(chainId),
    /**
     * `fn` in the repository's turn, ahead of Filament's own reads of waiting work there: a write into a folder from
     * outside the registry — Run on's bring back (app/remote-work.js) — never beside an Apply's, nor beside another.
     */
    inRepoAhead,
    /**
     * Whether the session's turn is open: it runs, or it paused on a question that waits for the person's answer — a
     * pause is no end, so a side run set for the turn's end waits for the end of the answer's turn. @param {string} chainId
     */
    turnOpen: (chainId) => !!liveTurnOf(chainId) || !!ctx?.asking?.(chainId),
    /**
     * Whether a report or a result waits in the session's queue for its agent now, one that came while no turn ran: the
     * chat goes on by itself to read it (the waker's, sessions/wake.js; the owner's of 10-28). @param {string} chainId
     */
    reportsDue: (chainId) => chainState(chainId).queue.some((d) => d.wakes === true),
    /**
     * What the messages that wake the chat are about, each kind once, in the order they came (the nudge map of 11-10):
     * "report" for another agent's report or result, else a graph's word's `about` — the wake says which. A graph task's
     * end held for its other workers rides the wake another brings (`held`), so it counts once one wakes.
     * @param {string} chainId @returns {string[]}
     */
    dueKinds: (chainId) => {
      const q = chainState(chainId).queue;
      return q.some((d) => d.wakes === true) ? [...new Set(q.filter((d) => d.wakes === true || d.held === true).map((d) => d.about || "report"))] : [];
    },
    /**
     * Whether a letter that came while no turn ran waits sealed for the session's agent (`letter`): the chat goes on by
     * itself to open it, as it does for a report. Only a letter really still sealed says so (the nudge map of 11-10: the
     * wake said a letter waited sealed where none did). @param {string} chainId
     */
    lettersDue: (chainId) => chainState(chainId).sealed.some((d) => d.wakes === true && isLetter(d)),
    /**
     * Run `go` once the session's turn ends — at once where none is open: a side run's launches that wait for the
     * planner's finished edits (10-28). A pause is no end: what is asked while its question waits goes at the end of the
     * answer's turn, or once the question is let go (`pauseLetGo`). @param {string} chainId @param {() => void} go
     */
    afterTurn: (chainId, go) => {
      if (!liveTurnOf(chainId) && !ctx?.asking?.(chainId)) return go();
      chainState(chainId).after.push(go);
    },
    /**
     * The question the session's turn paused on was let go unanswered — the person went on with a coding agent, or a
     * rewind took the turn that asked away: that turn is over, and what its end ends, and what waited for it, goes now.
     * Nothing while a turn runs, whose own end does it. @param {string} chainId
     */
    pauseLetGo: (chainId) => {
      const c = chains.get(chainId);
      if (!c || c.turn) return;
      c.paused = false;
      endAsks(chainId, c);
      // Its card, waiting or starting what it held, starts nothing more: the turn that held it is over.
      holds.stop(chainId, null);
      turnOver(chainId, c);
      if (goneChats.has(chainId)) dropChat(chainId);
    },
    /**
     * A list's limit and how many of it run now (`{ max, running }`). `also`: the models launches about to start would run
     * on — one outside the list lends its own room to them (`outsideTotal`).
     * @param {string} chainId @param {"side" | "workers"} [list] @param {readonly string[]} [also]
     */
    limit: (chainId, list = "side", also = []) => {
      const { max, running } = ceilingOf(chainId, null, list, null, also);
      return { max, running };
    },
    /**
     * Who holds Builder's or Reviewer's place in a session — its copy, where the session names one — as a launch by a tag
     * asks it (Catch me up: the bug round of 10-23). @param {string} chainId @param {string} word
     */
    inPlaceOf: (chainId, word) => workerFor(asksOf(chainId), word) ?? String(word),
    /**
     * The seat a launch that names no model would take now (AG-260), for a page to name before the launch: its model,
     * and whether it is the row that stands for the main agent's. Null where no seat is free or no row can run.
     * @param {string} chainId @returns {{ model: string, own: boolean } | null}
     */
    nextSeat: (chainId) => nextSeatOf(seatsIn(chainId, null, null, "side")),
    /**
     * `limit` and `nextSeat` together, as the chat's Sub Agents tab polls them: from one reading of its settings and its
     * main agent's model — the side list's seats `limit` reads are those a launch that names no model takes. `max` is
     * Infinity where a row's model has no limit, null as JSON says it.
     * @param {string} chainId
     */
    seatsNow: (chainId) => {
      const reading = chatOf(chainId);
      const { max, running, seats } = ceilingOf(chainId, null, "side", null, [], reading);
      return { limit: { max, running }, nextSeat: nextSeatOf(seats) };
    },
    /**
     * The session's pool as its editor shows it (HarnessV4_Tasks E15 step 8): each row with its seats, what it lends
     * now, its limit, how many run on it, and why it cannot run. `main`: the main agent's model, for a session that
     * names none yet; `rows`: a pool not saved yet, read in the session's place ("" for no session: a new task's).
     * `list`: the workers' (HarnessV4_Tasks E23-D6), which reads the pool where the session sets none.
     * @param {string} chainId @param {string | null} [main] @param {unknown} [rows] @param {"side" | "workers"} [list]
     */
    pool: (chainId, main = null, rows = null, list = "side") => seatsIn(chainId, main, rows, list),
    /**
     * Whether a launch that names this model would start now (step 8, AG-241: one agent asked on several models
     * starts on all of them, or on none): the model can run an agent, and its seat is free.
     * @param {string} chainId @param {string} model @returns {{ ok: true } | { ok: false, error: string }}
     */
    seat: (chainId, model) => {
      const name = poolName(model);
      const problem = ctx?.modelProblem(name) || null;
      if (problem) return { ok: false, error: `the sub-agent cannot run on "${name}": ${problem}` };
      const taken = takeSeat(seatsIn(chainId), { want: name, key: seatKey });
      return taken.ok ? { ok: true } : { ok: false, error: taken.error };
    },
    /**
     * The count a launch's result ends with, for a launcher outside a turn's own door (a team's tools): of the list it
     * launched on — a worker's, the workers'.
     * @param {string} chainId @param {"side" | "workers"} [list]
     */
    standing: (chainId, list = "side") => standingOf(chainId, null, list),
    /**
     * A launcher's model and effort as named (`choice`), a model several accounts serve on the account `at` runs on
     * first: a lead's model, else its chat's (the owner's of 11-06).
     * @param {{ model?: unknown, provider?: unknown, effort?: unknown }} input @param {{ model?: string | null, chainId?: string | null }} [at]
     */
    choice: (input, at = {}) => choice(input, preferFor(at)),
    /** The models a sub-agent can run on, as a launcher reads them (E23-D4). @param {string} chainId @param {{ model?: string | null, provider?: string | null }} ask */
    models: modelsText,
    /**
     * What a launch's answer says of its sub-agent's model (E23-D2, D5): `on`, " on <model> at <level>" after its name,
     * and `chose`, the launch's words on its choice as a sentence of their own — each "" where there is nothing to say.
     * @param {string} id @returns {{ on: string, chose: string }}
     */
    launchWords: (id) => {
      const sa = subs.get(String(id || ""));
      return sa ? { on: modelWords(sa), chose: choseWords(sa) } : { on: "", chose: "" };
    },
    /** The saved agents the session's main agent may ask: its tool lists them. */
    asks: asksOf,
    /**
     * Builder and Reviewer where what they may do is set on them and the session names no other in their place
     * (HarnessV4_ShippedAgents_Plan SA1): the agent tool says each one's level as it stands. @param {string} chainId
     */
    places: (chainId) => placesOf(asksOf(chainId), (tag) => ctx?.card?.(tag)),
    /**
     * What a session gives its coding agent of Filament's sub-agents (HarnessV4_Tasks E12 step 2): the saved agents it may
     * ask, and where Builder and Reviewer are set. A launch's model is read at the launch, the agent's own last (the
     * owner's of 11-06). The loop's tool switches (`loop.tools`) are the loop's: a coding agent never reads them.
     * @param {string} chainId @returns {import("./tools.js").LaunchOffer}
     */
    offer: (chainId) => {
      const asks = asksOf(chainId);
      const places = placesOf(asks, (tag) => ctx?.card?.(tag));
      return { asks, ...(places.length ? { places } : {}) };
    },
    /** The same for a list of tags no session holds yet (a draft's). @param {unknown} tags */
    askables: (tags) => askablesOf(tags, (tag) => ctx?.card?.(tag)),
    /** And its Builder and Reviewer, as `places` says. @param {readonly import("./tools.js").Askable[]} asks */
    placesFor: (asks) => placesOf(asks, (tag) => ctx?.card?.(tag)),
    /**
     * The developer's message, read for the saved agents it names in plain words (the owner's 10-19 list): its session's
     * agent may ask or send them while it is their newest — a message of theirs replaces the names, a note into the
     * running turn (`add`) adds its own. Their tags.
     * @param {string} chainId @param {unknown} text @param {{ add?: boolean }} [o] @returns {string[]}
     */
    heard(chainId, text, { add = false } = {}) {
      const c = chainState(String(chainId || ""));
      const all = ctx?.cards?.() || [];
      // Every card's name and every team's may hold another's: a card of yours called Hunter in a team called "Bug Hunter".
      // A plugin's agent is heard only in a chat where its plugin is on (B3).
      const tags = cardsNamedIn(text, all.filter((x) => !x.partOf && reachable(String(chainId || ""), x)), [...all.map((x) => x.name), ...(ctx?.teamNames?.() || [])]);
      c.said = add ? new Set([...c.said, ...tags]) : new Set(tags);
      // Kept on the chat: a turn a restart cut goes on by itself, and its agent may still use whom they named.
      try {
        ctx?.keepHeard?.(String(chainId || ""), [...c.said]);
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agents: session ${chainId}: the agents its message named were not kept (${e?.message || e})`);
      }
      return tags;
    },
    /**
     * The models a team's members run on when its lead launches them, as `launch` resolves them (HarnessV3-TaskGraph-v2
     * TG2-D47, §13.12) — what the lead's lines name: each member's card's model, which every launch of it runs on, else
     * none, and the session's pool, whose first free seat from the top such a member takes at its launch — the row
     * that names no model being the lead's. `sub`: a draft's `subagents`, where no session holds them yet.
     * `team`: the team's own models (`teamRows`), its workers' list before their cards and the chat's own (U13-D8).
     * A member the team names a model for runs on that one, before the team's models and its card's; the chat's own rows
     * for a member's card (`subagents.byCard`) before its card's model — "" the lead's (the review of 11-05).
     * @param {string | null} chainId @param {readonly TeamModelsOf[]} members @param {string | null | undefined} leadModel @param {any} [sub]
     * @param {import("../../core/pool.js").PoolRow[] | null} [team]
     * @returns {import("./prompt.js").TeamModels}
     */
    modelsOf: (chainId, members, leadModel, sub = undefined, team = null) => {
      const doc = sub ? { subagents: sub } : chainId ? settingsOf(String(chainId)).doc : null;
      /** @param {TeamModelsOf} m */
      const chatFirst = (m) => chatRowsOf(byCardIn(doc, memberCard(m)), leadModel)?.models[0] || null;
      return {
        members: members.map((m) => ({ tag: m.tag, model: poolName(m.own?.model) || (team?.length ? null : chatFirst(m) || poolName(cardOf(memberCard(m))?.model) || null) })),
      // The list its workers run on: its team's own models, else a draft's list where it sets one, else the chat's.
        pool: seatsOfList(String(chainId || ""), leadModel || null, listIn(String(chainId || ""), "workers", sub ? sub.pool ?? null : null, team)).map((s) => ({ model: s.model, seats: s.seats })),
      };
    },
    /**
     * A team's own models for its workers, in order (team_v2_plan TV2-D8): each as a person says it, read as a launch
     * reads a name, as rows of its workers' list — one that cannot run now left out; null where it names none, or none
     * of them runs; each with how hard its worker thinks on it where the team says (`efforts`). In a chat whose Brief
     * picked its workers' model (`engine.teamWorkers`, U13-D8), that one alone, where it can run; else the chat's own rows
     * for the team's workers (`subagents.byTeam`, the owner's plan of 11-05) where one of them runs — "" the chat's model.
     * @param {{ key?: string, models?: readonly string[] | null, efforts?: Readonly<Record<string, string>> | null } | null} team @param {string | null} [chainId]
     * @returns {Promise<import("../../core/pool.js").PoolRow[] | null>}
     */
    async teamRows(team, chainId = null) {
      const doc = chainId ? settingsOf(String(chainId)).doc : null;
      const pick = doc ? teamWorkersOf(doc) : null;
      const picked = pick ? await chooseModel(pick, null) : null;
      if (picked?.ok) return [{ model: picked.model, seats: Infinity }];
      /** @type {import("../../core/pool.js").PoolRow[]} */
      const rows = [];
      // Each model once, at the first effort its rows say (`seatsOf`).
      /** @param {string} model @param {unknown} effort */
      const add = (model, effort) => {
        const had = rows.find((x) => seatKey(x.model) === seatKey(model));
        if (!had) rows.push({ model, ...(effort ? { effort: String(effort) } : {}), seats: Infinity });
        else if (!had.effort && effort) had.effort = String(effort);
      };
      const own = doc && team?.key ? byTeamIn(doc, String(team.key), "workers") : null;
      for (const r of Array.isArray(own) && !poolProblem(own) ? own : []) {
        const name = poolName(r.model);
        const c = name ? await chooseModel(name, null) : { ok: true, model: String(doc?.model?.name || ctx?.session(String(chainId))?.model || "") };
        if (c.ok && c.model) add(c.model, r.effort);
      }
      if (rows.length) return rows;
      for (const name of Array.isArray(team?.models) ? team.models : []) {
        const c = await chooseModel(String(name), null);
        if (c.ok) add(c.model, team?.efforts?.[String(name)]);
      }
      return rows.length ? rows : null;
    },
    /**
     * A card's models, first choice first, as a person names them (a team's lead beside a chat runs on them after its
     * team's, U13-D11); none for a card that names none, or no card.
     * @param {unknown} tag @returns {string[]}
     */
    cardModels: (tag) => modelsOfCard(cardOf(String(tag ?? ""))),
    /** How hard a card's agent thinks on each of its models, by name, where it says. @param {unknown} tag @returns {Record<string, string>} */
    cardEfforts: (tag) => ({ ...(cardOf(String(tag ?? ""))?.efforts || {}) }),
    /**
     * A chat's main agent's effort, which its agents inherit (`mainEffortIn`), for an agent on `on`: a team beside it runs
     * its lead there.
     * @param {string} chainId @param {string | null} [on] @returns {{ level: string, asked: boolean }}
     */
    mainEffort: (chainId, on = null) => {
      const { doc } = settingsOf(String(chainId));
      return mainEffortIn(doc, doc?.model?.name || ctx?.session(String(chainId))?.model, on);
    },
    /**
     * A model as a person names it ("Claude Opus 5.5"), read as a launch reads a name: its id, or null where it cannot
     * run now — a team's lead's model beside a chat (team_v2_plan §9 Q10). @param {string} name @returns {Promise<string | null>}
     */
    async modelNamed(name) {
      const c = await chooseModel(String(name || ""), null);
      return c.ok ? c.model : null;
    },
    /**
     * A model as a person names it, read as a launch reads a name: its id, or why it cannot run now — what a team
     * beside's fire card says of each model its team names (team_v2_plan §9 Q10). `provider`: who serves it, where the
     * main agent's team tool names one, as a launch's `provider`.
     * @param {string} name @param {string | null} [provider] @returns {Promise<{ model: string | null, why: string }>}
     */
    async modelChoice(name, provider = null) {
      const c = /** @type {any} */ (await chooseModel(String(name || ""), provider || null));
      if (!c.ok) return { model: null, why: String(c.error || "it cannot run now") };
      const problem = ctx?.modelProblem(c.model) || null;
      return problem ? { model: null, why: problem } : { model: c.model, why: "" };
    },
    /**
     * Who holds each model's slots now, across every chat (team_v2_plan TV2-D8): by slot, each agent's chat and team —
     * and those that wait for one. For each model's row under its provider in Settings, and the Teams tab's room.
     * @returns {Map<string, { chainId: string, model: string, team: string | null, waiting: boolean }[]>}
     */
    slotUse() {
      /** @type {Map<string, { chainId: string, model: string, team: string | null, waiting: boolean }[]>} */
      const out = new Map();
      for (const s of subs.values()) {
        if (!s.slot || s.status !== "running" || s.origin === "self") continue;
        const list = out.get(s.slot) || [];
        list.push({ chainId: s.chainId, model: s.model, team: s.team?.name ?? null, waiting: !!s.waiting });
        out.set(s.slot, list);
      }
      return out;
    },
    /** A model's slots now, as a launch reads them; null where its name lands nowhere. @param {string} model */
    slotOf: (model) => slotNow(poolName(model)),
    /** Look for room for the workers that wait: a setting changed. */
    pumpSlots,
    overruleFrames,
    overruled,
    overrule,
    usesOf,
    usedSince,
    /** The models whose provider refused a request that carried pictures, each with what it said (AG-20). */
    refusedPictures: () => [...pictureRefusals].map(([model, said]) => ({ model, said })),
    /**
     * How many more exchanges the session may start now on a list, by what its rows lend — launches that name no model,
     * which take a row of it: the room a model outside the list lends is its own launches' (`outsideTotal`). `main`:
     * the planner's own model, which a graph task under the session's agent runs on (`launch`'s `ownRows`) — the room
     * is that model's then.
     * @param {string} chainId @param {"side" | "workers"} [list] @param {string | null} [main]
     */
    slots: (chainId, list = "side", main = null) => {
      const { max, running, seats } = main ? ceilingOf(chainId, main, list, PLANNER_ROWS) : ceilingOf(chainId, null, list);
      return Math.max(0, Math.min(max - running, poolRoom(seats)));
    },
    /**
     * A graph task's end in the graph's words (HarnessV3-TaskGraph G2-7), for the session's loop: into its running turn,
     * else with its next turn — kept across a restart like a report. What each exchange of its work spent goes with
     * the run that launched it, and counts on the turn that reads it only when that turn launched it.
     * @param {string} chainId @param {Omit<Delivery, "kind">} d
     */
    tell: (chainId, d) => enqueue(chainId, { ...d, kind: "task" }),
    /**
     * The graph's workers are done, and ends of theirs told while others still worked wait unheard (the graph runner's,
     * the owner's of 11-02): a running turn's wait hears them now; with none running, the chat goes on by itself to read
     * them, as it does a report. Nothing where none waits held. @param {string} chainId
     */
    wake: (chainId) => {
      const id = String(chainId || "");
      const c = chainState(id);
      const held = [...(c.turn ? c.turn.inbox : c.queue)].filter((d) => d.held);
      if (!held.length) return;
      for (const d of held) {
        delete d.held;
        if (!c.turn) d.wakes = true;
      }
      persist(id);
      if (c.turn) {
        for (const w of [...c.turn.wake]) w();
        return;
      }
      try {
        ctx?.reportWaits?.(id);
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agents: session ${id}'s chat was not woken for its task graph (${e?.message || e}); its next turn carries it`);
      }
    },
    /**
     * A notice of Filament's own to the session's main agent — a flow the person started beside its chat
     * (HarnessV4_OneAgent_Plan OA-D8) — into its running turn, else with its next message: it wakes nothing.
     * @param {string} chainId @param {{ text: string, description: string }} d
     */
    notice: (chainId, d) => enqueue(chainId, { text: d.text, from: "", description: d.description, kind: "notice", spends: [], wrote: false }),
    /**
     * The turn that carried these messages is recorded (its `carried`): a page showing the session rewrites the rows
     * that waited for it, as a reload would read them.
     * @param {string} chainId @param {number} turn @param {readonly { agentId: string, exchange: number, kind: string }[]} carried
     */
    carried: (chainId, turn, carried) => events.publish("subagents", { type: "subagent-carried", chainId, turn, carried }),
    /**
     * The session's sub-agents, the newest first: those the registry holds, and the threads the session kept (BW-10).
     * `head`: each exchange's words as the page's list carries them (`publicOf`).
     * @param {string} chainId @param {{ head?: boolean }} [o]
     */
    list: (chainId, { head = false } = {}) => {
      recall(chainId);
      const leads = leadsNow(chainId);
      return [...subs.values()].filter((s) => s.chainId === chainId).map((s) => publicOf(s, { leads, head })).reverse();
    },
    /**
     * A session's sub-agents still open for its main agent, the oldest first, as a summary's "still open" says them
     * (still-open.js): those working whose report comes to it — one whose question waits for the person's answer says
     * so —, those whose work waits for it to apply, and those whose newest exchange failed or was cut off since `since`,
     * the chat's newest summary (one before it is in it) — never by a stop, nor a team's worker, whose lead hears it in
     * its team's words (as the page's Now says a failure, lib/now.js `agentFailure`). Not the developer's own — kept
     * aside, its report and its work theirs —, nor a graph task's, which the graph's own words carry, ready ones with
     * them, nor one that starts by itself; an attempt another won has no work. `workers` false: nor a team's worker, where
     * its lead hears its team in words of its own. Its kept threads join the registry first.
     * @param {string} chainId @param {{ since?: number, workers?: boolean }} [o] @returns {import("./still-open.js").OpenAgent[]}
     */
    openWork: (chainId, { since = 0, workers = true } = {}) => {
      const id = String(chainId || "");
      recall(id);
      const mine = (/** @type {Subagent} */ s) => s.chainId === id && s.origin !== "self" && !s.aside && !s.task && !s.taskWas && (workers || !s.team);
      const working = (/** @type {Subagent} */ s) => s.status === "running" && s.deliver && s.run?.detached !== "aside";
      const waiting = (/** @type {Subagent} */ s) => s.status !== "running" && !!s.work?.files.length && !droppedWords(s, true);
      const failed = (/** @type {Subagent} */ s) => {
        const last = s.exchanges.at(-1);
        return (s.status === "failed" || s.status === "aborted") && !s.team && !last?.outcome?.stoppedBy && (Number(last?.endedAt) || 0) >= since;
      };
      return [...subs.values()]
        .filter((s) => mine(s) && (working(s) || waiting(s) || failed(s)))
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((s) => {
          const running = s.status === "running";
          const files = running || !waiting(s) ? 0 : s.work?.files.length ?? 0;
          return {
            id: s.id,
            description: s.description,
            running,
            files,
            ...(running && s.run?.asking && !s.run.asking.lead ? { asks: true } : {}),
            ...(!running && !files && failed(s) ? { failed: String(s.exchanges.at(-1)?.outcome?.failure?.said || s.exchanges.at(-1)?.outcome?.error || "") } : {}),
          };
        });
    },
    /**
     * How many of a session's sub-agents work now whose end comes to its main agent, and wakes it where no turn of it
     * runs (sessions/stretch.js): those whose report comes to it — not the person's own kept aside, nor one that started
     * by itself — and a graph's tasks, whose ends its runner tells it. The still-open list (`openWork`) leaves a graph's
     * tasks to the graph's own words; here they count, as their end wakes the chat all the same.
     * @param {string} chainId
     */
    wakingWork: (chainId) => {
      const id = String(chainId || "");
      let n = 0;
      for (const s of subs.values()) if (s.chainId === id && s.status === "running" && (!!s.task || (s.deliver && !s.aside && s.origin !== "self" && s.run?.detached !== "aside"))) n++;
      return n;
    },
    /** The session's kept threads join the registry: before a sub-agent is asked for by its id alone. @param {string} chainId */
    recall,
    /** @param {string} id */
    get: (id) => {
      const sa = subs.get(String(id || ""));
      return sa ? publicOf(sa) : null;
    },
    /** One sub-agent whole: every prompt and report entire, and the context it was handed. @param {string} id */
    detail: (id) => {
      const sa = subs.get(String(id || ""));
      return sa ? publicOf(sa, { whole: true }) : null;
    },
    /**
     * The model a card's agent that Filament starts in a chat on the person's ask — a dashboard button's second look or
     * check — runs on where the person names none, and why, as `launch` would take it: said before anything starts, so
     * the person sees it and may choose another (the owner's word of 10-31). Its card's first model that can run (its
     * first, where none can: the person is told it cannot), else the first of the chat's list that can, else the chat's
     * own. Null: no such card, or no model at all.
     * @param {string} chainId @param {string} tag @returns {{ model: string, why: string } | null}
     */
    selfModel: (chainId, tag) => {
      const card = cardOf(String(tag || ""));
      if (!card) return null;
      const models = modelsOfCard(card);
      if (models.length) return { model: models.find((m) => !ctx?.modelProblem(m)) || models[0], why: `the ${card.name}'s card names it` };
      const seat = seatsIn(String(chainId || "")).find((s) => s.model && !s.problem);
      if (seat) return { model: seat.model, why: seat.own ? "that chat's own model" : "the first of that chat's models for its agents that can run" };
      const own = poolName(ctx?.session(String(chainId || ""))?.model);
      return own ? { model: own, why: "that chat's own model" } : null;
    },
    /** The whole report of an exchange for a surface, secrets redacted (the views clip it; the model reads it as written). @param {string} id @param {number} [n] */
    report: (id, n = -1) => {
      const report = subs.get(String(id || ""))?.exchanges.at(n)?.outcome?.report;
      return report == null ? null : redactSecrets(report);
    },
    /** Wait for a sub-agent's running exchange (null when none runs). @param {string} id */
    settled: (id) => subs.get(String(id || ""))?.settled || null,
    /** How many sub-agents work now, every session's: the ones a stop would cut (`shutdown`), which an idle-only stop waits for. */
    running: () => [...subs.values()].filter((sa) => sa.status === "running" && sa.run).length,
    /** The sessions whose sub-agents work now: no worktree they work in is removed (HarnessV4_Git_Plan GW-D39). */
    atWork: () => [...new Set([...subs.values()].filter((sa) => sa.status === "running" && sa.run).map((sa) => String(sa.chainId)))],
    /**
     * What the registry knows of the sub-agents a repository's refs and copies name, for Filament's footprint there (the
     * footprint plan): each one it holds, or whose thread a chat keeps (`threadsNamed`), with that chat, whether it works
     * now, whether its copy is in use, whether its chat's task graph still asks for it, whether its work waits to be
     * applied, and whether its mark as applied can still be undone. Read only — no kept thread joins the registry for it.
     * One no chat knows is left out.
     * @param {readonly string[]} ids
     * @returns {Map<string, { chainId: string, running: boolean, inUse: boolean, held: boolean, waits: boolean, undo: boolean }>}
     */
    known(ids) {
      /** Each chat's graph's word, read once. @type {Map<string, ((agentId: string) => boolean) | undefined>} */
      const graphs = new Map();
      /** @param {string} chainId @param {string} id */
      const held = (chainId, id) => {
        if (!graphs.has(chainId)) graphs.set(chainId, ctx?.holds?.(chainId));
        return !!graphs.get(chainId)?.(id);
      };
      /** @type {Map<string, { chainId: string, running: boolean, inUse: boolean, held: boolean, waits: boolean, undo: boolean }>} */
      const out = new Map();
      for (const id of ids) {
        const sa = subs.get(id);
        if (sa) out.set(id, { chainId: sa.chainId, running: sa.status === "running", inUse: treeIds.has(id), held: held(sa.chainId, id), waits: !!sa.work?.files.length, undo: !!markUndoable(sa, now()) });
      }
      const rest = ids.filter((id) => !subs.has(id));
      for (const { chainId, thread: t } of rest.length ? ctx?.threadsNamed?.(rest) || [] : []) {
        const id = String(t?.id || "");
        if (!id || out.has(id)) continue;
        out.set(id, { chainId, running: t.status === "running", inUse: treeIds.has(id), held: held(chainId, id), waits: Array.isArray(t.work?.files) && t.work.files.length > 0, undo: !!markUndoable(t, now()) });
      }
      return out;
    },
    /** The copies the sub-agents and Filament's checks use now, by name: a Clean up never takes one. */
    treesInUse: () => [...treeIds],
    /**
     * Filament is stopping (a restart): cut every running sub-agent now, while the drain still lets each one end and
     * its notice be kept for its session's next turn — rather than dying mid-call when the drain's cap runs out, its
     * run "unknown" and nobody told (BUG-26). Every one reports to its session, the agent's foreground ones too: the
     * turn that waited on them is ending with the process. No running turn's loop takes a message from here on: its
     * next round could make no call — the draining Filament refuses it — and would lose what it carried, so what lands
     * waits on the session for its next turn.
     * @returns {number} how many were cut
     */
    shutdown() {
      stopping = true;
      // The cards' clocks stop: a card unanswered as Filament stops starts nothing.
      holds.close();
      // The folder's checks after a lead's applies end too: each apply stands unchecked, said with its session's next turn.
      for (const c of chains.values()) for (const k of c.checks) k.abort.abort();
      // And the graph's merges' checks: each merge stands unchecked, said by its runner (V2-2) — those its planner's
      // apply opened and its runner has not taken up yet too.
      for (const abort of merges.values()) abort.abort();
      for (const a of asked.values()) a.cycle?.abort.abort();
      let n = 0;
      for (const sa of subs.values()) {
        if (sa.status !== "running" || !sa.run) continue;
        sa.cutByRestart = true;
        // One the developer kept aside stays theirs: its cut report is held for them, as they chose. A graph task's
        // cut end is its runner's.
        if (!sa.task && !sa.aside && sa.run.detached !== "aside") sa.deliver = true;
        sa.run.abort.abort();
        n += 1;
      }
      if (n) log("info", `sub-agents: Filament is stopping — ${n} running sub-agent${n === 1 ? "" : "s"} cut; each session hears of it with its next turn`);
      return n;
    },
    /**
     * The chats that keep a thread of a sub-agent on another machine whose exchange an earlier process left open (a
     * crash, a stop that never ran): each joins the registry now, as it does once opened, so each such turn there is sent
     * its stop as Filament starts (`recall`, `stopCut`) — none runs on there until someone opens its chat here. One whose
     * threads could not be read is read again RECALL_AGAIN_MS after, RECALL_TRIES times in all, its chat opened or not.
     * @param {Iterable<string>} chainIds
     */
    recallCut(chainIds) {
      /** @param {string[]} ids @param {number} left */
      const read = (ids, left) => {
        const failed = ids.filter((id) => !recall(id));
        if (failed.length && left > 1) later(() => read(failed, left - 1), RECALL_AGAIN_MS);
      };
      read([...chainIds].map((id) => String(id || "")).filter(Boolean), RECALL_TRIES);
    },
    /**
     * A sub-agent run an earlier process left open — it died with that process, unannounced (BUG-26's crash case; a
     * graceful stop cuts and reports them itself). Its session hears it once, in a restart's words: the main agent
     * with its next turn, unless the developer kept its reports for themselves; the developer's own launch gets its
     * arrival row too. Nothing for a session that is gone, or one already told (a notice already waiting).
     * @param {{ runId: string, chainId: string | null, brief: any, agentId?: string | null, rounds?: number }} o
     * @returns {boolean} whether the session was told
     */
    orphaned({ runId, chainId, brief, agentId = null, rounds = 0 }) {
      const chain = String(chainId || "");
      const b = brief && typeof brief === "object" ? brief : {};
      const id = String(b.agentId || agentId || "");
      // A graph task's run is its graph's: the runner fails what a restart cut, as it starts (HarnessV3-TaskGraph G2-9).
      // One this process runs is no orphan; its thread as the session kept it is.
      if (!chain || !id || b.graphTask || (subs.has(id) && !subs.get(id)?.back) || !ctx?.session(chain)) return false;
      recall(chain);
      const exchange = Number.isInteger(b.exchange) ? b.exchange : 0;
      // A graceful stop that cut it already left the notice, and only its run's end was lost.
      const told = (/** @type {string} */ t) => t.startsWith(`[Filament: sub-agent ${id} (`) && t.includes("was cut by a Filament restart");
      const c = chainState(chain);
      if ([...c.queue, ...c.sealed].some((d) => d.from === id && told(d.text)) || heldOf(chain).some((h) => h.agentId === id && h.exchange === exchange)) return false;
      const description = String(b.description || id);
      // What it had done stands in its run's log (the transcript audit, 2026-10-23): its session reads it with the notice.
      const words = cutReportOfRun(runEvents(runId));
      const text = restartText({ id, description }, { rounds, report: words, fromLog: !!words }, String(b.task || ""), words ? `${LOGGED_REPORT}\n\n${words}` : "", freshHint(subs.get(id) || null));
      const kept = b.deliver === false;
      if (kept) keepHeld(chain, { agentId: id, exchange, description, text });
      else {
        // Its end is a result like any other: it may reach a loop at work sealed (HarnessV4_Envelopes_Plan EN-D4).
        const subject = `it was cut by a Filament restart before it finished${words ? "; inside is what its run's log shows of its work" : ""}`;
        enqueue(chain, { text, from: id, description, kind: "report", exchange, seal: true, subject, sender: `sub-agent ${id} ("${description}")`, spends: [], wrote: false });
      }
      // An attempt cut with its process (TG2-D53): the reports of its group that waited for it go now, none having won.
      const thawedSa = subs.get(id);
      if (thawedSa?.attempt && !winnerOf(thawedSa)) heldGo(groupOf(thawedSa));
      if (kept || b.by === "owner" || b.by === "command") {
        const stored = ctx.mark(chain, { event: "arrival", at: now(), agentId: id, exchange, description, status: "aborted", ms: 0, rounds, toolCalls: 0, delivery: kept ? "held" : "auto", error: "Filament stopped before it finished" });
        if (stored) events.publish("subagents", { type: "subagent-mark", chainId: chain, mark: stored });
      }
      log("info", `sub-agents: ${id} (run ${runId}) was left running when Filament last stopped; session ${chain} hears it ${kept ? "as a report kept for the developer" : "with its next turn"}`);
      return true;
    },
    /**
     * Stop a running sub-agent: a stop steer on its run, as `from` — the developer's harness, or a worker's lead — so
     * its stop signal cuts what it runs at once and its loop ends in its words, the report so far kept; before its run
     * exists, the request is cut.
     * @param {string} id @param {{ from?: string }} [o]
     */
    stop(id, { from = "harness" } = {}) {
      const sa = subs.get(String(id || ""));
      if (!sa || sa.status !== "running" || !sa.run) return { ok: false, error: "that sub-agent is not running" };
      stopRun(sa, from);
      return { ok: true };
    },
    /**
     * A chat deleted (memory's `onSessionsDeleted`, the bug hunt of 10-30's SUB-6): what the registry keeps for it goes
     * — the messages waiting for its next turn, its sealed results, its newest request kept warm and that request's
     * timer, and the reports kept aside for the person —, at once where no turn of it runs, else as that turn closes.
     * Its sub-agents at work stop; they stay, ended ones until `prune`, as any chat's do; what they kept in the repositories goes in the
     * background (`letGoChatWork`, the owner's of 11-09): their copies, and their refs where nothing of their work waits.
     * One whose work could not be captured has its capture tried now, and later while it fails (`saveLater`): its copy
     * goes once its work is kept. → that letting go, which never fails: the caller need not wait for it.
     * @param {string} chainId
     * @returns {Promise<void>}
     */
    forgetChat(chainId) {
      const id = String(chainId || "");
      if (chains.get(id)?.turn) goneChats.add(id);
      else dropChat(id);
      deletedChats.add(id);
      // What works for it stops, here or on another machine (its turn there sent a stop), as its background commands do:
      // nothing works on for a chat that is gone (the swarm's review of 11-10).
      for (const sa of subs.values()) if (sa.chainId === id && sa.status === "running" && sa.run) stopRun(sa, "filament");
      for (const sa of subs.values()) if (sa.chainId === id && unsaved.has(sa.id) && sa.status !== "running") void closeWork(sa).catch(() => null);
      return letGoChatWork(id);
    },
    /**
     * The sub-agents whose work could not be captured, nor kept on a second try (the owner's of 11-09): each one's copy
     * stays in use with its work in it alone — its chat, its folder, why and since when — for Filament's footprint and
     * Still open to say.
     * @returns {{ id: string, chainId: string, repo: string, dest: string, error: string, at: number }[]}
     */
    failedCaptures: () => [...unsaved.values()].map((u) => ({ ...u })),
    /** The folders the registry's sub-agents work from, each once: what a sweep of the copies reads besides the projects'. */
    folders: () => [...new Set([...subs.values()].map((sa) => String((sa.work?.there ? sa.work.repo : sa.cwd) || "")).filter(Boolean))],
    /**
     * The marks' holds past `MARK_KEPT_MS` go, in each repository the folders are in (the owner's of 11-09): until then
     * one stayed until its helper worked again, which may be never. When a mark was made is its hold's reflog
     * (worktree.js `markHolds`), else what the helper's thread says of its newest apply; one whose time neither says
     * stays. Never one whose helper works, whose copy is in use, or whose mark can still be undone. How many went.
     * @param {readonly string[]} folders
     */
    async expireMarks(folders) {
      let gone = 0;
      const { repos } = await reposOf(folders);
      for (const r of repos) {
        const read = await markHolds(r.repo).catch(() => null);
        if (!read?.ok) continue;
        const unknown = read.holds.filter((h) => !subs.has(h.id)).map((h) => h.id);
        /** The threads chats keep of the helpers the registry does not hold, by id. @type {Map<string, any>} */
        const threads = new Map((unknown.length ? ctx?.threadsNamed?.(unknown) || [] : []).map((/** @type {any} */ t) => [String(t?.thread?.id || ""), t.thread]));
        for (const h of read.holds) {
          const sa = subs.get(h.id) || threads.get(h.id) || null;
          if (sa && (sa.status === "running" || treeIds.has(h.id) || markUndoable(sa, now()))) continue;
          const a = sa?.work?.applied?.at(-1);
          const at = h.at ?? (a?.hand ? Number(a.at) || null : null);
          if (at == null || now() - at <= MARK_KEPT_MS) continue;
          if (await dropMarkHold(r.repo, h.id).catch(() => false)) gone++;
        }
      }
      if (gone) log("info", `sub-agents: ${gone} mark${gone === 1 ? "" : "s"} as applied older than ${Math.round(MARK_KEPT_MS / 86_400_000)} days let go of what ${gone === 1 ? "it" : "they"} held`);
      return gone;
    },
    /**
     * A thread the person deletes from the Agents tab (the owner's ask of 10-23: "right click threads in Agents tab and
     * be able to delete those for cleanup"), or with the flow it ran in: it leaves the registry and the session's kept
     * threads, with the reports kept aside for the person and the work its copy left waiting in the repository's refs.
     * A report already on its way to the main agent still goes. Refused while it works, while its copy is in use, and
     * while the chat's task graph still asks for it. `files`: how many changed files went with it, not applied.
     * @param {string} id @param {string} chainId
     * @returns {Promise<{ ok: true, files: number } | { ok: false, status: number, error: string }>}
     */
    async forget(id, chainId) {
      recall(chainId);
      const sa = subs.get(String(id || ""));
      if (!sa || sa.chainId !== chainId) return { ok: false, status: 404, error: "no such sub-agent in this session" };
      if (sa.status === "running") return { ok: false, status: 409, error: "it is at work: stop it first" };
      if (treeIds.has(sa.id)) return { ok: false, status: 409, error: "its copy of the project is still in use" };
      if (ctx?.holds?.(chainId)?.(sa.id)) return { ok: false, status: 409, error: "the chat's task graph still asks for it" };
      const work = sa.work;
      const files = work?.files?.length || 0;
      subs.delete(sa.id);
      lastParentRun.delete(sa.id);
      letGo.delete(sa.id);
      unsaved.delete(sa.id);
      unplaced.delete(sa.id);
      const held = heldOf(chainId);
      const rest = held.filter((h) => h.agentId !== sa.id);
      if (rest.length !== held.length) saveHelds(chainId, rest);
      try {
        ctx?.forgetThread?.(chainId, sa.id);
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agent ${sa.id}: its kept thread could not be let go (${e?.message || e})`);
      }
      if (work) await dropTaskRefs(work.repo, sa.id).catch(() => false);
      if (work?.there) await dropCopyCommit(work.repo, sa.id).catch(() => false);
      clearTimeout(backsAgain.get(sa.id));
      backsAgain.delete(sa.id);
      events.publish("subagents", { type: "subagent", chainId, id: sa.id, status: "deleted", runId: null });
      log("info", `sub-agent ${sa.id} of ${chainId} deleted${files ? `, with ${files} changed files not applied` : ""}`);
      return { ok: true, files };
    },
    /**
     * A team's brief launched as `n` workers at once (HarnessV3-TaskGraph-v2 TG2-D53), each in a worktree and a seat of
     * its own, the first whose check passes its lead's worker — or why not, nothing launched: a check Filament can run in
     * a session that is not read-only, a repository to copy for each, and a seat for each now. A brief the launch itself
     * refuses (a rule over its check, TG2-D44) is refused at the first.
     * @param {LaunchSpec} spec @param {number} n
     * @returns {Promise<{ ok: true, ids: string[] } | { ok: false, error: string }>}
     */
    async attempts(spec, n) {
      const chainId = String(spec.chainId || "");
      const { sub, doc } = settingsOf(chainId);
      if ((spec.mode || permissionMode(doc?.loop?.permissions)) === "read-only") return { ok: false, error: "attempts need a check Filament can run, and the session is read-only" };
      if ((spec.worktree ?? sub.worktree) === false) return { ok: false, error: "attempts need a worktree each, and this session's sub-agents share its folder (subagents.worktree is off): launch one worker" };
      const cwd = String(spec.cwd || ctx?.session(chainId)?.cwd || "").trim();
      /** @type {{ repo: string | null, head?: string | null, error?: string }} */
      const found = cwd ? await repoOf(cwd).catch((/** @type {any} */ e) => ({ repo: null, error: String(e?.message || e) })) : { repo: null, error: "the session names no folder" };
      if (!found.repo || !found.head) return { ok: false, error: `attempts need a worktree each, and this folder has none to give (${found.repo ? "the repository has no commit yet" : found.error}): launch one worker` };
      const room = roomFor(chainId, spec, n);
      if (room) return { ok: false, error: room };
      /** @type {string[]} */
      const ids = [];
      for (let k = 1; k <= n; k++) {
        const r = launch({ ...spec, attempt: { n: k, of: n, group: ids[0] || null } });
        if (r.ok) {
          ids.push(r.id);
          continue;
        }
        // A seat taken between the count and the launch: those launched go, and say nothing.
        for (const id of ids) {
          const s = subs.get(id);
          if (!s?.attempt) continue;
          s.attempt.dropped = ATTEMPT_REFUSED;
          stopRun(s, FILAMENT);
        }
        return { ok: false, error: k === 1 ? r.error : `attempts ${n} need ${n} seats at once: ${r.error}` };
      }
      return { ok: true, ids };
    },
    message,
    /**
     * The developer's own words to one running sub-agent, past whoever launched it (HarnessV4_Tasks decision 10): a
     * note its run reads at its next step as their message — the page's own steers' `from` — and a line for the
     * session's agent, a team's lead or the agent whose sub-agent it is, read at its running turn's next step, else
     * with its next turn: whom they told what, so it knows, and need not pass it on. Refused in words as `message`
     * refuses, and then the agent hears nothing. `told`: where the agent's line went — into its running turn, or
     * waiting for its next.
     * @param {string} id @param {{ chainId: string, text: string }} m
     * One the developer launched or asked themselves is theirs alone (`told` null): nobody launched it for them to tell
     * (the transcript audit, 2026-10-23: any agent at work takes their words now, as the main agent does).
     * @returns {{ ok: true, asking?: string | null, ask?: number | null, lead?: boolean, told: "turn" | "queue" | null } | { ok: false, error: string }}
     */
    developerMessage(id, { chainId, text }) {
      const out = message(id, { chainId, text, from: "harness" });
      if (!out.ok) return out;
      const sa = /** @type {Subagent} */ (subs.get(String(id || "")));
      if (!sa.team && !sa.task && sa.origin !== "agent") return { ...out, told: null };
      enqueue(sa.chainId, { text: toldText(sa, String(text || "").trim()), from: sa.id, description: sa.description, kind: "told", spends: [], wrote: false });
      return { ...out, told: liveTurnOf(sa.chainId) ? "turn" : "queue" };
    },
    /**
     * One running worker's rounds whole, for its lead that asked (`show_trail`, HarnessV3-TaskGraph-v2 TG2-D14): from
     * the round named, or from its start. It moves no mark, so the lead's next look still shows what is new.
     * @param {string} id @param {string} chainId @param {{ fromRound?: number }} [o]
     * @returns {{ ok: true, text: string, note: string } | { ok: false, error: string }}
     */
    trail(id, chainId, { fromRound = 0 } = {}) {
      const sa = subs.get(String(id || ""));
      if (!sa || sa.chainId !== String(chainId || "")) return { ok: false, error: noSuchSubagent(id) };
      const live = liveTurnOf(sa.chainId);
      if (!sa.run?.look || !live?.looks || !live.watched) return { ok: false, error: `${sa.id} is not read along with: its trail is on its own page` };
      const w = live.watched(sa);
      if (!w.run) return { ok: false, error: `${sa.id} is starting: its run has no round yet` };
      const from = Math.max(0, Math.floor(Number(fromRound) || 0));
      return { ok: true, text: live.looks.trail(w, from), note: from > 1 ? `from round ${from}` : "from its start" };
    },
    /**
     * What a worker has changed, for its lead that asked (`show_changes`, TG2-D17). While it runs: its worktree as it
     * stands against where it started — the files and the patch. Once it reported: the change that waits to be
     * applied, as its end captured it, so a lead reads it before it applies (the live drive of 2026-10-12: a lead
     * asked, was refused, and applied on the report alone); applied, it is in the lead's folder. One that works in
     * the session's folder has no git to measure it: the files its calls wrote, as its run log names them. One that
     * only reads changes nothing.
     * @param {string} id @param {string} chainId
     * @returns {Promise<{ ok: true, text: string, note: string } | { ok: false, error: string }>}
     */
    async changesSoFar(id, chainId) {
      const sa = subs.get(String(id || ""));
      if (!sa || sa.chainId !== String(chainId || "")) return { ok: false, error: noSuchSubagent(id) };
      const who = { id: sa.id, role: sa.team?.role || "sub-agent" };
      // Where Filament keeps the reader's conversation the newest change alone stays whole in it, and its head says so;
      // a coding agent in the lead's seat keeps its own (TG2-D28).
      const replaced = !liveTurnOf(sa.chainId)?.looks?.lean;
      if (sa.may === "read") return { ok: true, text: `${who.role} ${sa.id} changes nothing: it only reads.`, note: "it only reads" };
      if (!sa.run && sa.work) {
        if (!sa.work.files.length && sa.work.applied.length) return { ok: true, text: `The change of ${who.role} ${sa.id} is applied: it is in your folder, where your own tools read it.`, note: "applied already" };
        const kept = await changes(sa.id, chainId);
        if (!kept.ok) return { ok: false, error: kept.error };
        return { ok: true, text: patchWords(who, kept, { reported: true, replaced }), note: `${kept.files.length} file${kept.files.length === 1 ? "" : "s"}, as it reported` };
      }
      const w = sa.work;
      if (!w?.wt) {
        const wrote = [...new Set(runEvents(sa.exchanges.at(-1)?.runId ?? null).filter((e) => e?.type === "tool-start" && (e.card?.kind === "write" || e.card?.kind === "edit")).map((e) => String(e.card?.subject || e.args || "")).filter(Boolean))];
        return { ok: true, text: wroteWords(who, { paths: wrote, why: sa.shares || "" }, { replaced }), note: `it works in the session's folder: ${wrote.length} file${wrote.length === 1 ? "" : "s"} written` };
      }
      try {
        const pw = patchOf(w.wt);
        const c = pw ? await patchSoFar(pw, { id: sa.id, previous: w.head }) : await taskWorkSoFar(/** @type {import("../../adapters/git/worktree.js").TaskWorktree} */ (w.wt), { id: sa.id, previous: w.head });
        if (!c.ok) return { ok: false, error: `its change could not be read just now (${c.error}) — ask again` };
        return { ok: true, text: patchWords(who, c, { replaced }), note: `${c.files.length} file${c.files.length === 1 ? "" : "s"}` };
      } catch (/** @type {any} */ e) {
        return { ok: false, error: `its change could not be read just now (${String(e?.message || e)}) — ask again` };
      }
    },
    /**
     * A team's worker asks the developer (HarnessV3-AtHome P2 step 4), and so does a sub-agent they launched themselves
     * (HarnessV4_Tasks E15 step 5, AG-165): its call waits in place for the answer, which settles with it. The question
     * rides its progress — with the always-allow waiting for the call's shape, and its number among the sub-agent's
     * questions (TG2-D42) — and, for a worker, its lead's timeline; `answer` settles it, and the signal — its stop, its
     * run's hang-up — lets it go: null, no answer.
     * What a sub-agent on another machine's chat there asks the person is asked here the same way (the remote-agents
     * plan's s-asks, `remoteTurn`): `machine` names that machine, `kind` and `options` a question's choices; the person's
     * press alone answers it (`answer`), and a signal let go as answered there (remote-agents.js `ANSWERED_THERE`) says so.
     * `verb`: what its card says it wants, where its tool is no call's (a project's copy sent there: "wants to send").
     * @param {string} id @param {import("./loop.js").AskedCall & { machine?: string, kind?: "permission" | "question", options?: string[], words?: boolean, verb?: string }} q
     * @param {{ signal?: AbortSignal | null }} [o]
     * @returns {Promise<import("./loop.js").AskAnswer | null>}
     */
    ask(id, q, { signal = null } = {}) {
      const sa = subs.get(String(id || ""));
      const run = sa?.run;
      if (!sa || !run || signal?.aborted) return Promise.resolve(null);
      // Its question to its lead waits (TG2-D49): one question at a time, so Filament answers this one not now, and it takes
      // no number.
      const open = run.leadAsk && !run.leadAsk.done ? run.leadAsk : null;
      if (open) return Promise.resolve({ text: `Not now: your question to your lead (ask ${open.n}) waits for its answer — run this once it is answered.`, by: /** @type {const} */ ("filament") });
      return new Promise((resolve) => {
        const onAbort = () => settle(null);
        /** @param {import("./loop.js").AskAnswer | null} answer */
        const settle = (answer) => {
          signal?.removeEventListener("abort", onAbort);
          run.asking = null;
          run.progress.asking = null;
          askSaid(sa, n, false);
          const there = answer == null && signal?.reason === ANSWERED_THERE ? { there: q.machine } : {};
          toParent(sa, { type: "subagent-ask-end", agentId: sa.id, answered: answer != null, ...(answer?.by ? { by: answer.by, allowed: answer.allow === true, words: answer.text } : {}), ...there });
          changed(sa);
          progressed(sa);
          resolve(answer);
        };
        sa.questions += 1;
        const n = sa.questions;
        run.asking = { settle, n, ...(q.machine ? { remote: q.machine, kind: q.kind || "permission", options: q.options || [], ...(q.words === false ? { words: false } : {}) } : {}) };
        run.progress.asking = { ...q, n };
        askSaid(sa, n, true);
        signal?.addEventListener("abort", onAbort, { once: true });
        const where = q.machine ? { machine: q.machine, kind: q.kind || "permission", ...(q.options?.length ? { options: q.options } : {}) } : {};
        toParent(sa, { type: "subagent-ask", agentId: sa.id, tool: q.tool, args: q.args, question: q.question, ask: n, ...where });
        changed(sa);
        progressed(sa);
      });
    },
    /**
     * The developer's answer to a worker's waiting call, from its session: their press (`allow`) runs the call — never
     * their words —, and without it the words answer it.
     * Their permission switch answers it too (`modeSwitch`, HarnessV3-AtHome AH-F1): the call is judged again under the
     * mode now in force, as the session's own waiting call is. Its lead answers it too (`by: "lead"`,
     * HarnessV3-TaskGraph-v2 TG2-D41): whichever answer comes first settles it, and the one after hears it waits no more.
     * `n`: the number of the question it answers (TG2-D42) — settled, or never asked, the answer settles nothing and
     * says which waits now, so a yes meant for one call never runs the next. Without it, it answers what waits. A
     * worker's question to its lead (TG2-D49) takes its lead's words or the developer's alike, and no switch: it asks
     * for no permission.
     * `go`: its plan's go (TG2-D50), where the question is its plan. A question its chat on another machine asks there
     * (s-asks) is answered by one of its choices (`choice`, its number from 1, the choice's own words its answer) or the
     * person's words, never a press of Allow (the s-asks hunt's).
     * @param {string} id @param {string} chainId @param {string} text @param {{ allow?: boolean, go?: boolean, modeSwitch?: boolean, by?: "lead" | null, n?: number | null, choice?: string | null }} [o]
     * @returns {{ ok: true, tool: string } | { ok: false, error: string }}
     */
    answer(id, chainId, text, { allow = false, go = false, modeSwitch = false, by = null, n = null, choice = null } = {}) {
      const sa = subs.get(String(id || ""));
      if (!sa || sa.chainId !== String(chainId || "")) return { ok: false, error: `no sub-agent ${id} in this session` };
      const asking = sa.run?.asking;
      const who = `${sa.team ? sa.team.role : "sub-agent"} ${sa.id}`;
      if (!asking) return { ok: false, error: `${who} is not waiting for an answer${n != null && n >= 1 && n <= sa.questions ? `: ask ${n} is settled` : ""}` };
      if (n != null && n !== asking.n) return { ok: false, error: n < asking.n ? `${who}'s ask ${n} is settled: it waits on ask ${asking.n} now` : `${who} has asked no ask ${n}: it waits on ask ${asking.n}` };
      if (asking.lead && modeSwitch) return { ok: false, error: `${who} asks its lead a question (ask ${asking.n}), not for a permission: a switch answers none` };
      // What its chat on another machine asks there goes there on the person's press alone (s-asks): this machine is the
      // boundary, as its agents' device may press Allow there. No lead answers it, nor a switch of this chat's mode — that
      // machine's own mode asked it.
      if (asking.remote && by) return { ok: false, error: `${who} asks on ${asking.remote} (ask ${asking.n}): that is the person's to answer, by their press — not its lead's` };
      // The press names the ask its card showed: one there lapses and the next shows in a moment, and a press with no
      // number would settle whichever waits now.
      if (asking.remote && n == null && !modeSwitch) return { ok: false, error: `${who} asks on ${asking.remote} (ask ${asking.n}): a press answers the ask its card showed, by its number, and this one named none — answer ask ${asking.n} on its card` };
      if (asking.remote && modeSwitch) return { ok: false, error: `${who} asks on ${asking.remote} (ask ${asking.n}), whose own mode asked it: a switch of this chat's mode answers none — the person's press of Allow or Deny does` };
      const question = asking.remote && asking.kind === "question";
      const choices = question ? asking.options || [] : [];
      if (question && allow) return { ok: false, error: `${who} asks a question on ${asking.remote} (ask ${asking.n}): ${choices.length ? "one of its choices answers it, or the person's words" : "the person's words answer it"} — Allow answers no question` };
      // A choice of any other ask is its words alone, as its answer said them.
      const picked = choice == null || !question ? null : choices[Number(choice) - 1] ?? null;
      if (question && choice == null && asking.words === false) return { ok: false, error: `${who}'s question (ask ${asking.n}) takes one of its choices alone, 1 to ${choices.length}: words answer it not` };
      if (choice != null && question && (picked == null || String(Number(choice)) !== String(choice))) return { ok: false, error: `${who}'s question (ask ${asking.n}) has ${choices.length ? `choices 1 to ${choices.length}` : "no choices: the person's words answer it"} — no choice ${choice}` };
      const words = picked ?? String(text ?? "").trim();
      if (!words) return { ok: false, error: question ? "an answer needs one of its choices or the person's words" : "an answer needs words: what to do instead, or the press of Allow with any words" };
      const tool = String(sa.run?.progress.asking?.tool || "");
      asking.settle({ text: words, modeSwitch, ...(allow && !asking.lead ? { allow: true } : {}), ...(go && asking.lead ? { go: true } : {}), ...(by ? { by } : {}), ...(picked != null ? { choice: String(choice) } : {}) });
      return { ok: true, tool };
    },
    /**
     * A team's worker asks its lead (HarnessV3-TaskGraph-v2 TG2-D49, TG2-D58): a choice its brief does not settle, or a
     * problem it is stuck on — whether its lead reads along or not. The question takes its next number (TG2-D42), rides
     * its progress as its lead's to answer, and reaches its lead's timeline and its own run (`emit`) — a sign there, so a
     * look of its lead's at it is due at once; where no look shows it, its lead's door says it, once: now, or at the
     * resume of a turn that paused. It waits for its answer — its lead's or the developer's — with no clock:
     * until it comes, its stop, or its lead's turn's end, which leaves it unanswered, and the worker goes on with its
     * pick. With no turn of its lead's running, nor one to resume, it is refused in words: nobody would read it.
     * `withinMs`: a coding agent's call, which may hold only so long — then "later", the question still open, and its
     * next call names it by its number (`q` null, `n`); an answer that came between two calls waits for the next. The
     * signal — the loop's stop, the call's hang-up — stops the question. One question at a time, a call's that waits for
     * an answer included: a second is refused in words. `q.plan`: it is the worker's plan, sent while its lead reviews it
     * (TG2-D50) — the one ask a go lets its changes run on, and the one with a clock: no answer in ASK_LEAD_SECONDS from
     * when it was sent, across a coding agent's calls, and it goes on with its plan; with no review going on it is
     * refused. Whatever else it asks while held is a question, and the hold stays.
     * @param {string} id @param {{ question: string, options?: string[], plan?: boolean } | null} q
     * @param {{ n?: number | null, withinMs?: number, signal?: AbortSignal | null, emit?: ((e: any) => void) | null }} [o]
     * @returns {Promise<LeadAnswer>}
     */
    async askLead(id, q, { n = null, withinMs = 0, signal = null, emit = null } = {}) {
      const sa = subs.get(String(id || ""));
      const run = sa?.run;
      if (!sa || !run) return { ok: false, error: "your run has ended: no question reaches your lead now" };
      if (!sa.team) return { ok: false, error: "you have no lead to ask: say what you are unsure of in your report, and go on" };
      const open = run.leadAsk;
      if (!q) {
        const asked = n != null && n >= 1 && n <= sa.questions;
        if (!open) return { ok: false, error: `${asked ? `ask ${n} is settled` : `you asked no ask ${n}`}: you have no question waiting now` };
        if (n !== open.n) return { ok: false, error: `${asked ? `ask ${n} is settled` : `you asked no ask ${n}`}: your question waiting is ask ${open.n}` };
        return waitLead(sa, run, open, { withinMs, signal });
      }
      // A plan goes to its lead's review alone (TG2-D50): with none going on — never asked for, or its go come already —
      // no go is there for it to wait on.
      if (q.plan && !run.planHeld) return { ok: false, error: "your lead does not review your plan now — it never asked to, or its go came already: ask a question in question, or say your plan in your report" };
      if (open?.done === "answered") return { ok: false, error: `your lead answered ask ${open.n}: call ask_lead with ask ${open.n} alone to read its answer` };
      if (open && !open.done) return { ok: false, error: `your question waiting is ask ${open.n}: call ask_lead with ask ${open.n} alone to go on waiting for its answer` };
      if (run.asking) return { ok: false, error: `a call of yours waits for an answer now (ask ${run.asking.n}): ask your lead once it is settled` };
      // A question goes to its lead's turn, running or to resume (TG2-D58); a plan goes to a lead that reads along with
      // it, and keeps its 3 minutes.
      const c = chainState(sa.chainId);
      if (!q.plan && !c.turn && !c.paused) return { ok: false, error: "your lead's turn has ended, so no question reaches it now: go on with what you judge best, and say in your report what you would have asked" };
      sa.questions += 1;
      // While its changes wait for its lead's review (TG2-D50), its plan is what it sends as one: a go to that lets them
      // run. A question then is a question, its answer no go nor no go, and the hold stays.
      /** @type {LeadAsk} */
      const asked = { n: sa.questions, question: q.question, options: [...(q.options || [])], plan: q.plan === true, at: now(), done: null, answer: null, wake: new Set() };
      run.leadAsk = asked;
      run.asking = { n: asked.n, lead: true, settle: (a) => endLead(sa, run, asked, "answered", a) };
      run.progress.asking = { to: "lead", tool: "ask_lead", args: "", question: asked.question, options: asked.options, n: asked.n, at: asked.at, plan: asked.plan };
      askSaid(sa, asked.n, true);
      // Its number rides the events as `ask`, the field an answer names it by: the run log numbers every event `n`.
      const options = asked.options.length ? { options: asked.options } : {};
      const plan = asked.plan ? { plan: true } : {};
      emit?.({ type: "ask", kind: "lead", tool: "ask_lead", question: asked.question, ...options, waits: true, ask: asked.n, ...plan });
      toParent(sa, { type: "subagent-ask", agentId: sa.id, tool: "ask_lead", to: "lead", question: asked.question, ...options, ask: asked.n, ...plan });
      // Where no look of its lead's shows it, its lead's door says it, once (TG2-D58).
      if (!run.look && !asked.plan) enqueue(sa.chainId, { text: askedText(sa, asked), from: sa.id, description: sa.description, kind: "ask", ask: asked.n, spends: [], wrote: false });
      if (asked.plan) later(() => endLead(sa, run, asked, "none"), ASK_LEAD_SECONDS * 1000);
      changed(sa);
      progressed(sa);
      return waitLead(sa, run, asked, { withinMs, signal });
    },
    /**
     * Its changes and commands wait for its lead's review of its plan now (HarnessV3-TaskGraph-v2 TG2-D50): what its
     * loop's gate and its coding agent's switch ask before each call. False once its run has ended. @param {string} id
     */
    planHeld(id) {
      return !!subs.get(String(id || ""))?.run?.planHeld;
    },
    /**
     * Rewrite a task for a sub-agent with the main agent's context. While the provider still caches the main agent's
     * newest request — its running turn's, or its last turn's for a while after — that request is forked as it
     * stands: the same model, system prompt, tools, thinking and memory, the instruction as the newest user text, so
     * the provider reads the whole prefix from its cache (the answer's usage says how much), and nothing of the fork
     * joins the conversation. Its cost books on the session, like the developer's own sub-agents. With the cache
     * cold, the pool's first model that can run reads the conversation folded instead. The rewrite knows what the sub-agent will be —
     * read-only or not, the view it gets — and opens with a title for its cards. `signal`: the page that asked hung up.
     * @param {{ chainId: string, prompt: string, readOnly?: boolean, view?: string, signal?: AbortSignal | null }} o
     * @returns {Promise<{ ok: true, text: string, title: string | null, how: "fork" | "view", requestId: string | null, usage: TokenUsage | null } | { ok: false, error: string }>}
     */
    async enhance({ chainId, prompt, readOnly = false, view = "none", signal = null }) {
      const task = String(prompt || "").trim();
      if (!task) return { ok: false, error: "nothing to enhance: write the task first" };
      const instruction = enhanceInstruction(task, { readOnly, view });
      /** @type {{ text: string, usage: TokenUsage | null, requestId: string | null }} */
      let got;
      /** @type {"fork" | "view"} */
      let how = "fork";
      const forked = await forkCall(chainId, instruction, { signal });
      if (forked) {
        if (!forked.ok) return { ok: false, error: `the rewrite failed: ${forked.error}` };
        got = forked;
      } else {
        how = "view";
        const model = unseatedModel(chainId);
        if (!model) return { ok: false, error: "no model to enhance with: give the session's pool a model (subagents.pool), or the session one" };
        /** @type {import("../internal-call.js").InternalCallResult} */
        let r;
        try {
          const v = ctx ? await ctx.view(chainId, "fold").catch(() => null) : null;
          const background = v?.text ? `<conversation view="folded">\n${v.text.slice(-VIEW_CHARS)}\n</conversation>\n\n` : "";
          const ask = { model, system: ENHANCE_SYSTEM, messages: [{ role: "user", content: `${background}${instruction}` }] };
          // The most the model can write, inside its window (HarnessV3-FailurePoints §13).
          r = await post({ body: { ...ask, max_tokens: callRoom(config(), model, estimateBodyTokens(ask)) }, headers: { "user-agent": "filament-subagent/0.1", "x-filament-subagent-of": "owner" }, signal });
        } catch (/** @type {any} */ e) {
          return { ok: false, error: `the rewrite failed: ${e.message}` };
        }
        if (!r.ok) return { ok: false, error: `the rewrite failed: ${r.json?.error?.message || `HTTP ${r.status}`}` };
        got = { text: textOf(r.json), usage: usageOf(r.json), requestId: r.id };
      }
      if (!got.text) return { ok: false, error: "the model answered without a rewrite (it may have called a tool instead)" };
      const { title, brief } = splitTitle(got.text);
      return { ok: true, text: brief, title, how, requestId: got.requestId, usage: got.usage };
    },
    // ---- host mode: turn.js serving a sub-agent's request -------------------------------------------------------
    /**
     * What the host needs of a running sub-agent, or null when the id names none. A fork's host runs on the main
     * agent's system prompt, tools and thinking, and on the messages composed here — not the request's copy, which
     * the pipeline may have reshaped on the way in: the byte-identical prefix is the fork's whole point. `workdir`
     * is where the run works when it has its own worktree (the request itself names the session's folder). `card`:
     * the saved agent it runs as, which its prompt is written from, and `readOnly`: it only reads and its card's words
     * do not say so — a lead's, a card with none, a launch that lowered the card — so Filament's read-only line does.
     * `team`: a worker's team, role and the team's own line for it.
     * @param {string} id
     */
    hostOf(id) {
      const sa = subs.get(String(id || ""));
      if (!sa?.run) return null;
      // `opens`: how many of the main agent's messages its conversation opens with (`forkTaskAt`).
      const fork = sa.fork && sa.run.messages ? { system: sa.fork.system, tools: sa.fork.tools, thinking: sa.fork.thinking, maxTokens: sa.fork.maxTokens, messages: sa.run.messages, opens: Number(sa.fork.messages) || 0 } : null;
      const ex = sa.exchanges.at(-1);
      // What a restart notice needs once this process is gone (BUG-26's crash case): the host writes it on its run's
      // start, and the next start reads it there for a run that never ended.
      const brief = { agentId: sa.id, exchange: sa.exchanges.length - 1, description: sa.description, task: cut(ex?.prompt || "", 600), by: ex?.by || "owner", deliver: !!sa.deliver, ...(sa.task ? { graphTask: sa.task.id } : {}) };
      // Who answers a call the session's switch asks about. A team's worker and a sub-agent the developer launched
      // themselves ask them, where the session's page can answer: a harness session's. One the session's agent
      // launched has that agent to run the call itself, and in another client's session nobody can answer. Nor is
      // anyone asked for a message that started by itself (`self`, HarnessV4_Tasks E15 AG-262): nobody called it and
      // nobody watches its thread, so a wait there holds its finished work back for as long as nobody looks. What
      // the developer writes into that thread afterwards is their message, and theirs to answer.
      const self = ex?.by === "self";
      const asks = !self && (!!sa.team || sa.origin !== "agent") && ctx?.session(sa.chainId)?.client === "harness";
      const readOnly = sa.may === "read" && (!sa.card.thinks || sa.card.may !== "read" || !SAYS_READS.test(sa.card.thinks));
      // Its lead reads along with it: its prompt says so (`supervise`, HarnessV3-TaskGraph-v2 TG2-D18). A team's worker
      // may ask its lead, whether it reads along or not (`askLead`, TG2-D49, TG2-D58) — a graph task's sub-agent under the
      // session's agent has its planner's notes, which answer no question. What its brief lets it run without anyone's
      // answer holds in a worktree of its own alone (`grants`, TG2-D44). `planHeld`: its run starts with its changes
      // waiting for its lead's review of its plan (TG2-D50) — what holds them asks `planHeld(id)` before each call, as the
      // hold ends mid-run.
      const workdir = sa.work?.wt?.workdir || null;
      // `second`: a second look or a check (S3b, S5d) — its run says so, for the left bar. `held`: what a coding agent's
      // context held as the newest exchange before this one that says it ended (`AgentHeld`) — one stopped or refused
      // before its prompt reached the agent says nothing, and its session holds what the one before left —, which a
      // follow-up is weighed against its line by; `notes`: what a fresh session of its agent is told again ahead of a
      // summary (`standingNotes`).
      const held = sa.exchanges.slice(0, -1).findLast((x) => x.outcome?.held)?.outcome?.held ?? null;
      // `rateMovesOn`: another row of its list it would go on to now (`nextRow`), so a 429 on its first call is that
      // row's turn, untried again (the owner's plan of 11-05).
      const rateMovesOn = !!nextRow(sa);
      // A builder's copy holds the files Git LFS keeps as their pointers (Phase 0 of the owner's 11-09 plan for big
      // repos): its read fetches one it opens, in the copy it works in at the time — read at each call, as a patch moves
      // to a worktree of pointers mid-turn (the review of d65a984a9: its reads after the move showed the pointer). A
      // patch's own read fetches through its overlay (patch-hands.js).
      const fetchLfs = holdsPointers(sa.work?.wt) || patchOf(sa.work?.wt) ? (/** @type {string} */ abs) => (sa.work?.wt && holdsPointers(sa.work.wt) ? fetchLfsFile(sa.work.wt.dest, abs) : Promise.resolve({ ok: /** @type {const} */ (false), lfs: false, error: "" })) : null;
      // `workspace`: a builder's patch workspace (adapters/git/patch.js) as its file tools reach it, and its move to a
      // worktree for what needs a checkout — at the same `workdir`, before and after.
      const workspace = sa.work?.kind === "patch" ? patchHold(sa) : null;
      // `widen`: its sparse copy brings in the folder of a file its read, write or edit reaches outside its cone (the
      // owner's plan of 11-09 for big repos) — its copy read at each call, as a patch may move to a sparse one mid-run.
      const widen = sa.work
        ? async (/** @type {string} */ abs, /** @type {AbortSignal | null} */ signal) => {
            const wt = sa.work?.wt;
            const r = wt ? relative(wt.dest, abs) : "";
            if (!wt || wt.kind !== "sparse" || !r || isAbsolute(r) || r === ".." || r.startsWith(`..${sep}`)) return "";
            const w = await widenFor(abs, { signal });
            return w ? widenedWords(w, cli) : "";
          }
        : null;
      return { id: sa.id, ...(fetchLfs ? { fetchLfs } : {}), ...(workspace ? { workspace } : {}), ...(widen ? { widen } : {}), card: { tag: sa.card.tag, name: sa.card.name, thinks: sa.card.thinks, asked: sa.asked, ...(sa.card.toolsOff?.length ? { toolsOff: [...sa.card.toolsOff] } : {}) }, may: sa.may, readOnly, team: sa.team, task: sa.task, fork, workdir, folder: sa.cwd, brief, asks, self, supervise: !!sa.run.look, askLead: !!sa.team, grants: workdir ? sa.grants : null, planHeld: !!sa.run.planHeld, held, notes: standingNotes(sa), ...(rateMovesOn ? { rateMovesOn: true } : {}), ...(sa.second ? { second: true } : {}), ...(sa.weighs ? { weighs: sa.weighs } : {}) };
    },
    /**
     * The host's run exists: what its lead said before it did reaches it now, and the launching turn's run names it
     * (`subagent-run`) — once that turn hears no more of the sub-agent and this registry holds it no longer, its own
     * run's log is where its end is read (HarnessV4_Tasks U1).
     * @param {string} id @param {string} runId
     */
    attach(id, runId) {
      const sa = subs.get(String(id || ""));
      const run = sa?.run;
      const ex = run ? sa.exchanges.at(-1) : null;
      if (!sa || !run || !ex) return;
      ex.runId = runId;
      toParent(sa, { type: "subagent-run", agentId: sa.id, exchange: sa.exchanges.length - 1, run: runId });
      // Its lead reads along (HarnessV3-TaskGraph-v2 §12): each event of its run, as the log numbers it, is noted on
      // its mark — its signs, the messages it was sent and has read, whether its trail gained something — and its
      // lead's turn is rung when that makes a look due. Ahead of the held messages, which are its first events.
      const mark = run.look;
      if (mark && runs?.subscribe) {
        run.unwatch?.();
        run.unwatch = runs.subscribe(runId, (e) => {
          if (sa.run !== run || !noted(mark, e, sa.files)) return;
          if (readInto(run)) progressed(sa);
          liveTurnOf(sa.chainId)?.looks?.ring();
        });
      }
      for (const m of run.held.splice(0)) {
        const steered = runs?.steer(runId, { kind: "note", text: m.text, from: m.from });
        if (!steered?.ok) log("warn", `sub-agent ${sa.id}: a message held for its run did not reach it (${steered?.error || "no run log"})`);
      }
      changed(sa);
    },
    /**
     * One of the host loop's events: tool calls reach the launching turn's card; writes and calls are counted, and the
     * commands run to their end are kept with their exits, each as its call's event names it (`args`: redacted and
     * clipped — a call's input never leaves the loop); and the run's progress — its round, newest tool, window,
     * compactions and newest words — is kept for the lead's watch, and reaches the events feed as it changes
     * (`progressed`): the Team view's cards, and a graph task's live line (HarnessV3-TaskGraph G2-10), never kept in
     * the graph. A team's worker whose same command fails a third time is sent to its lead (`stuck`,
     * HarnessV3-TaskGraph-v2 TG2-D59), in either seat.
     * @param {string} id @param {any} e
     */
    relay(id, e) {
      const sa = subs.get(String(id || ""));
      const run = sa?.run;
      if (!sa || !run) return;
      const p = run.progress;
      let moved = false;
      if (run.watch) for (const s of watchStep(run.watch, e)) if (s.kind === "failing" && s.command !== undefined) stuck(sa, s.command);
      if (e?.type === "tool-start") {
        run.toolCalls++;
        p.tool = sa.remote ? { name: thereWord(e.name, NAME_THERE), args: thereWord(e.args) } : { name: String(e.name || ""), args: String(e.args || "") };
        moved = true;
        if (FOREGROUND_SHELLS.has(e.name)) run.shells.set(String(e.id), sa.remote ? thereWord(e.args) : String(e.args ?? ""));
        // One on another machine's: in words, and never movable — its call is no run of this machine's to send aside.
        if (sa.remote) toParent(sa, { type: "subagent-tool-start", id: thereWord(e.id, NAME_THERE), name: thereWord(e.name, NAME_THERE), args: thereWord(e.args), ...(e.card ? { card: cardThere(e.card) } : {}) });
        else toParent(sa, { type: "subagent-tool-start", id: e.id, name: e.name, args: e.args, ...(e.card ? { card: e.card } : {}), ...(e.movable ? { movable: true } : {}) });
      } else if (e?.type === "tool-end") {
        // A write of its loop's hands, or one a coding agent's call says it made (agent-run.js `writes`): Claude's Edit,
        // a write through an MCP server's tool.
        if (e.ok && (WRITING_HANDS.has(e.name) || e.writes === true)) run.wrote = true;
        // A call that ran and may have acted (`actedBy`): its run is never sent anew.
        if (actedBy(sa, e)) run.acted = true;
        const command = run.shells.get(String(e.id));
        if (command !== undefined) {
          run.shells.delete(String(e.id));
          // A command refused, declined or never run has no end of its own; one that ran has its exit, or none (a timeout).
          if (!e.refused && !e.declined && !e.notRun) run.ran.push({ command, exit: typeof e.exitCode === "number" ? e.exitCode : null });
        }
        toParent(sa, { ...(sa.remote ? toolEndThere(e) : e), type: "subagent-tool-end" });
      } else if (e?.type === "tool-errors") {
        if (!sa.remote) toParent(sa, { ...e, type: "subagent-tool-errors" });
      } else if (e?.type === "visual") {
        // A picture it drew (HarnessV4_Visuals_Plan VS-D50): the exchange lists it, in the order drawn, for the card
        // that launched or asked it — and keeps it when the session keeps the thread (`changed` keeps it). One drawn on
        // another machine is kept there: its id names nothing of this machine's.
        const d = sa.remote ? null : drewOne(e);
        const ex = sa.exchanges.at(-1);
        if (d && ex) {
          ex.drew = [...(ex.drew || []).filter((x) => x.id !== d.id), d];
          changed(sa);
        }
      } else if (e?.type === "artifact") {
        // An artifact it published (HarnessV4_Artifacts_Plan AFC-100): the exchange lists each once, at its newest
        // version, for the card that launched or asked it and its report — kept when the session keeps the thread. One
        // published on another machine is that machine's: its name opens nothing of this machine's.
        const m = sa.remote ? null : madeOne(e);
        const ex = sa.exchanges.at(-1);
        if (m && ex) {
          const had = (ex.made || []).findIndex((x) => x.name === m.name);
          ex.made = had < 0 ? [...(ex.made || []), m] : (ex.made || []).map((x, i) => (i === had ? m : x));
          changed(sa);
        }
      } else if (e?.type === "window") run.window = { window: Number(e.window) || null, usable: Number(e.usable) || null };
      else if (e?.type === "held") {
        // A coding agent's own count of what its context holds as it works (agent-run.js `onUsage`; Filament's estimate
        // where the agent says none), against the window it names, else the one its run said, and the line its run said
        // its agent makes room at (acp-turn.js `sideSaid`): what its card's gauge reads (the owner's of 11-12), as a
        // loop's round says its own below.
        if (Number(e.tokens) > 0) {
          p.context = { tokens: Number(e.tokens), window: Number(e.window) > 0 ? Number(e.window) : (run.window?.window ?? null), usable: run.window?.usable ?? null, ...(e.exact === false ? { estimated: /** @type {const} */ (true) } : {}) };
          moved = true;
        }
      } else if (e?.type === "round-start") {
        p.round = Number(e.round) || p.round;
        if (Number(e.context) > 0) p.context = { tokens: Number(e.context), window: run.window?.window ?? null, usable: run.window?.usable ?? null };
        // The round's model call starts: what streams of it is counted (`streamed`) until its reply is in.
        p.call = { round: p.round, began: now(), thinking: 0, text: 0, lastAt: null };
        moved = true;
      } else if (e?.type === "round-text") {
        // Its reply is in (its thinking and its text are said after the call): no call runs.
        p.words = sa.remote ? unnoticed(clip(e.text, WORDS_CHARS)) : clip(e.text, WORDS_CHARS);
        p.call = null;
        moved = true;
      } else if (e?.type === "round-thinking") {
        p.call = null;
        moved = true;
      } else if (e?.type === "turn-state") {
        // A model call's wait — for a slot at its provider, to try again — is said in its loop's words while it lasts (a
        // question to the developer is `asking`). Out of planning for anything else — its tools, a question, its end —
        // the round's call is over.
        const callWaits = e.to === "waiting" && (e.retry || e.queue);
        p.wait = callWaits ? String(e.why || "waiting") : null;
        if (!callWaits && e.to !== "planning") p.call = null;
        moved = true;
      } else if (e?.type === "compacting") {
        // Its work is being compacted: the summarizer runs, not the round's call.
        p.call = null;
        moved = true;
      }
      // A compaction that folded nothing — the line standing down, a Compact with too little to fold — is none.
      else if (e?.type === "compaction" && !e.stoodDown && !e.result) {
        p.compactions.push({ round: Number(e.round) || p.round, at: now(), how: compactionHow(e) });
        moved = true;
      }
      if (moved) progressed(sa);
    },
    /**
     * What the host's run has spent so far, its own model calls priced as each comes back (HarnessV3-Views V3): it
     * joins the run's progress, for the Team view's cards.
     * @param {string} id @param {number | null} usd
     */
    spent(id, usd) {
      const sa = subs.get(String(id || ""));
      if (!sa?.run || sa.run.progress.spent === usd) return;
      sa.run.progress.spent = usd;
      progressed(sa);
    },
    /** The registry's clock: what a running call's age is read against, as its start was stamped. */
    now: () => now(),
    /** Whether a lead can read along with its workers here: Filament keeps the run log their trails are read from. */
    readsRuns: () => !!(runs?.events && runs.subscribe),
    /**
     * The host's model call streamed `chars` of `kind` (HarnessV3-FailurePoints §5.1 item 1): its progress counts them
     * and when the newest came, for the lead's watch and the Team view. Words after the call (Filament's closing lines)
     * are not the call's, and none is counted.
     * @param {string} id @param {"text" | "thinking"} kind @param {number} chars
     */
    streamed(id, kind, chars) {
      const sa = subs.get(String(id || ""));
      const c = sa?.run?.progress.call;
      if (!sa || !c || !(chars > 0)) return;
      c[kind] += chars;
      c.lastAt = now();
      progressed(sa);
    },
    /** The host's run ended (before its reply goes out). @param {string} id @param {HostFinish} fin */
    /**
     * Its loop's conversation as it goes (turn.js hands it over as its run begins): its edit cards read their changes
     * there while it runs (the transcript audit, 2026-10-23).
     * @param {string} id @param {any[]} convo
     */
    runConvo(id, convo) {
      const sa = subs.get(String(id || ""));
      if (sa?.run) sa.run.convo = convo;
    },
    /**
     * One edit or write call's change as the call made it, for its card in the agent's thread (the transcript audit,
     * 2026-10-23; a turn's own card reads HarnessV4_Four_Plan E22's): from the call's input in its conversation, its
     * loop's while it runs, else the one it keeps. `why` as a turn's: "later" for a call its running loop has not
     * written yet, "absent" for one its conversation does not hold (a restart forgot it), "none" for one whose input
     * holds no change.
     * @param {string} id @param {string} chainId @param {string} callId
     * @returns {{ ok: true, change: { id: string, file: string, patch: string, added: number, removed: number, wrote: boolean, every: boolean, omitted: number } } | { ok: false, error: string, why: "later" | "absent" | "none" }}
     */
    callChange(id, chainId, callId) {
      const sa = subs.get(String(id || "").trim().toLowerCase());
      if (!sa || sa.chainId !== String(chainId || "")) return { ok: false, error: noSuchSubagent(id), why: "absent" };
      const want = String(callId || "");
      for (const convo of [sa.run?.convo, sa.convo]) {
        const call = Array.isArray(convo) ? editsOf(convo).get(want) : null;
        if (!call) continue;
        const made = madeChange(call.name, call.input);
        return made ? { ok: true, change: { id: want, ...made } } : { ok: false, error: "this call's record holds no change", why: "none" };
      }
      return { ok: false, error: "its conversation does not hold this call", why: sa.status === "running" ? "later" : "absent" };
    },
    finish(id, fin) {
      const sa = subs.get(String(id || ""));
      if (sa?.run) sa.run.finished = fin;
    },
  });
}

/** @typedef {ReturnType<typeof createSubagentRegistry>} SubagentRegistry */
