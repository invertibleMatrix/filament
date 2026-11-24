// @ts-check
// The D1 agent loop (plan WP-F): one model with Filament's hands, run server-side behind the model name
// `agent/<model>`. The tick is decide → act → observe: one model call per tick, the tools it asked for run in order,
// their results are appended, and the conversation — the whole state — is resent on the next tick. Budgets are
// events, never silent stops; a permission or a question pauses the turn and the developer's next message resumes
// it — except in a team's worker and a sub-agent the developer launched, whose call waits in place for their answer
// (`asker`, HarnessV3-AtHome P2);
// a message typed while the loop works is delivered at the next round boundary, never mid-tool. The exceptions to
// "in order": a reply's consecutive `agent` calls run side by side — each is a whole sub-agent run (subagents.js), and
// running several at once is the point of them — and so do its consecutive reads, as Claude Code runs them (`onlyReads`,
// at most READS_AT_ONCE together); their results go back in the reply's order. A background sub-agent's report, and one the
// developer's sub-agent sends, arrive through the inbox before a round; the turn does not end while its own
// background sub-agents still run. A round whose provider was busy for a moment is tried again, its waits said on the
// stream and the record (retry.js, HarnessV3-AtHome AH-F4).
//
// A team's lead that reads along with its workers (HarnessV3-TaskGraph-v2 §12) is shown a look at them through the
// same inbox, behind the reports. Its conversation keeps only the newest (looks.js `tidyLooks`, before each model
// call): the one before becomes a line, a wait it answered a look with leaves with its answer — the round still
// counts — and what the turn hands the session holds none.
//
// This module is the loop alone: no HTTP, no records. `turn.js` wires it to a request, the run log and the reply.
import { resolve } from "node:path";
import { redactSecrets } from "../../core/redact.js";
import { isMemoryTool, MEMORY_TOOLS_OFF } from "../memory-tools.js";
import { gate, ruled, isLoopTool, argSummary, shownCommand, shownChange, commandReason, readOnlyRefusal, unattendedAsk, NOBODY_ANSWERS, askOf, askText, plainSleepSeconds, leadAnswerWords, leadQuestionOf, stepsTaskOf, changesOrRuns, changesWhatFailed, ENVELOPE, FOREGROUND_SHELLS, PLAN_HELD, SLEEP_REFUSAL, SLEEP_REFUSAL_REASON, SLEEP_REFUSE_SECONDS, WAIT_DEFAULT_SECONDS, WAIT_MAX_SECONDS } from "./tools.js";
import { dismissAnswer, dismisses, envelopeAnswer, openedText, otherThanDismiss, pictureAnswer, sealedListText, sealedReminder, writesLetter } from "./envelopes.js";
import { compose, READERS } from "./checkpoint.js";
import { cardOf } from "../../core/tool-vocab.js";
import { editsSaid } from "../../core/call-place.js";
import { inBrief, withoutArtifactFiles } from "../../core/messages.js";
import { SHOW_VISUAL, VISUAL_GUIDE, showVisual, visualEvent, visualGuide, visualWriting } from "./visuals.js";
import { ARTIFACT, ARTIFACTS_OFF, artifactCall, pinnedFor } from "./artifacts.js";
import { SPACE, SPACE_OFF, spaceRun } from "./space.js";
import { PRESS_FENCED, PRESS_MOVED, PRESS_READ_ONLY, appToolStandIn, pressFieldsOf, pressSaid, pressStandIn } from "./space-dashboard.js";
import { spaceFields } from "../../core/space.js";
import { BESIDE_OFF, BESIDE_TEAM, besideCall } from "./beside-tool.js";
import { FLOW_NAME, FLOW_OFF, flowCall } from "./flow-tool.js";
import { THREAD, THREAD_OFF, folderVerdict, threadAskWords, threadCall } from "./thread-tool.js";
import { CRAFT_NAME, CRAFT_OFF, craftCall } from "./craft-tool.js";
import { COME_BACK, comeBackCall } from "./come-back.js";
import { MCP_RESOURCES } from "./mcp-resources.js";
import { BROWSER, actingSite, browserGate } from "./browser-tool.js";
import { LSP, errorsOfDiagnostics } from "./lsp-tool.js";
import { createBlockWeights, estimateBodyTokens, everyNamed, namedCopies } from "../../core/tokens.js";
import { MediaResult, picturesIn } from "../../core/media.js";
import { detectOverflow } from "../../core/autofit.js";
import { earlierRounds, roundsHead, roundsLead, roundsSummaryOf } from "../sessions/compaction.js";
import { blockFiles, filesWorked, foldedLetters, livePlan, loadedSkills, planIn, touchedFiles, unshown } from "../sessions/reattach.js";
import { clearResults } from "../sessions/shapes.js";
import { ruleFor, describeRule, denialText, asItRuns, asksFirst } from "./rules.js";
import { AGENTS_CHAT_THERE, CWD_HERE, ENDED_THERE, NOT_OFFERED_THERE, READ_ONLY_THERE, onMachine, thereForm, thereReply } from "./remote-commands.js";
import { ANSWERED_THERE } from "./remote-agents.js";
import { answerWords, checkAnswer } from "../../adapters/agents/asks.js";
import { grantFor, grantedBy } from "./grants.js";
import { alwaysWords, keepsFor, keptFor } from "./chat-always.js";
import { FILAMENT_FOLDER_WORDS, climbsOut, filamentFolderNamed, namesOutside, strayOf, strayWhy, strayWords } from "../agent-permits.js";
import { describeHook, hookLabel } from "./hooks.js";
import { createNowIn } from "../now-in.js";
import { isHandTool, isCommandHand, guardResult, safeEnv } from "../../adapters/tools/hands.js";
import { fileKey, landingOf } from "../../adapters/tools/fs-fence.js";
import { SHELL, POWERSHELL } from "../../adapters/tools/shell.js";
import { readOnlyCommand } from "../../adapters/tools/read-only-commands.js";
import { readOnlyPowerShell } from "../../adapters/tools/read-only-powershell.js";
import { isWebTool } from "../../adapters/tools/web-hands.js";
import { isMcpTool } from "../../adapters/tools/mcp-client.js";
import { MCP_DOOR, unwrapDoor } from "../../core/mcp-door.js";
import { offerText } from "../../services/memory/permissions.js";
import { RETRY_TRIES, causeOf, withRetries } from "../../core/retry.js";
import { isFinal } from "../../core/provider-cause.js";
import { FILAMENT, holdsLook, lookOf, paceWords, tidyLooks, whoseStop, withoutLooks } from "./looks.js";
import { REPORT_ASK, REPORT_IN, readReport, stepsRefused } from "../../core/task-graph.js";
import { headChars } from "../../core/text.js";
import { failureLine, keptRounds, saidOf, worded } from "../../core/failure.js";
import { changedSecond, driftChanged, failedAgain, failingLine, newDriftState, outsideLine } from "../../core/drift.js";
import { PIN_STOPPED } from "../../core/web-pins.js";
import { WATCHER, guideBlocks, isGuideBlock } from "../../core/watchers.js";

/** What the gate answers a call of another machine's agents' chat that names Filament's data folder (s0d): no yes or mode lets it run. */
const FOLDER_REFUSAL = `Not run: ${FILAMENT_FOLDER_WORDS}.`;
/** Why the record says it was refused. */
const FOLDER_NOTE = "it names Filament's data folder, which another machine's agents never touch";

/** @typedef {import("./prompt.js").PermissionMode} PermissionMode */
/**
 * @typedef {object} LoopSink  the client-visible reply as it is built, one text block per model call (plan §4.5)
 * @property {(text: string) => void} text  a text delta of the current model call
 * @property {(text: string) => void} thinking  a thinking delta of the current model call
 * @property {(signature: string) => void} signThinking  the provider's signature for this call's thinking, once assembled
 * @property {() => void} endBlock  the model call is over: the open block closes so the next call opens a new one
 * @property {() => number} count  how many reply blocks exist so far, for the round-start's placement anchor
 */
/**
 * @typedef {{ itemId: number | null, tool: string, shape: string }} Offer  an always-allow offered to the developer
 *   (WP-L) for a call's shape, from its first ask (HarnessV4_Tasks E3): with the inferred permission item a yes
 *   brought to the threshold, which the page's Always allow confirms (HarnessV3-Views V3), or none yet, which it makes
 * @typedef {{ text: string, allow?: boolean, go?: boolean, modeSwitch?: boolean, by?: "lead" | "filament", choice?: string }} AskAnswer  the developer's answer to a
 *   worker's waiting call: their words, which run it only with their press (`allow`: never read from the words), or their permission switch (`modeSwitch`, HarnessV3-AtHome AH-F1), which has the
 *   call judged again — or its lead's words (`by`, HarnessV3-TaskGraph-v2 TG2-D41), whose yes is never the developer's
 *   learned one — or Filament's not now, nobody asked: the worker's question to its lead waits (TG2-D49). `choice`: the number of
 *   the choice, from 1, that answers a question another machine's chat asks (the s-asks hunt's), its words the choice's
 */
/**
 * @typedef {object} AskedCall  a call that waits in place for the developer — a team's worker's (HarnessV3-AtHome P2),
 *   or a sub-agent's they launched themselves — as its asker holds it and the page shows it
 * @property {string} tool
 * @property {string} args  its arguments on one line, cut (`argSummary`)
 * @property {string} question  the words it asks in, for a client that draws no card
 * @property {Offer} [offer]  the always-allow waiting for the call's shape (HarnessV3-Views V3)
 * @property {string} [command]  a command whole, redacted (HarnessV3-Views V6-9)
 * @property {string} [runs]  the command as it runs, when a leading `cd` into its own folder was left out (V6-9)
 * @property {string} [reason]  why it asks, apart from the command (V6-9)
 * @property {true} [always]  its agent offers only to always allow it: a yes lets that agent run calls like it for the
 *   rest of its session
 */
/**
 * @typedef {object} PausedTurn  the state parked while the developer answers
 * @property {"ask" | "permission"} kind
 * @property {any[]} convo  the conversation up to and including the assistant reply that asked
 * @property {any[]} results  tool_results already produced for that reply, in the order they came back
 * @property {any} pending  the tool_use waiting on the answer
 * @property {any[]} remaining  the reply's tool_uses after the pending one, not yet run
 * @property {number} round  rounds used so far
 * @property {any[] | null} plan  the last published checklist
 * @property {string} root  the working folder the turn was parked in — the answer continues there
 * @property {string} readerModel  the reader behind delegate_read at the time, "" when it was not offered
 * @property {any[]} [heard]  steering notes read before the pause and not yet delivered to the model
 * @property {number} [baseLen]  how many of `convo`'s messages were the client's; the rest is the turn's work
 * @property {number} [workFrom]  where the resumed turn's own work starts in `convo`: the reply whose tool calls were
 *   waiting (the archive keeps everything before it under the turn that asked)
 * @property {string[]} [subagentWrote]  the waiting reply's agent calls whose sub-agent wrote, so the resumed round is
 *   snapshotted like a write's
 * @property {boolean} [wrote]  the turn wrote to the working tree before it paused: its end runs what a write calls for
 *   (`loop.verify.afterEdits`)
 * @property {string[]} [unread]  the files it wrote and had not read back: its end still asks for them
 *   (`loop.verify.readBackBeforeDone`)
 * @property {string[]} [changed]  the files its writes and edits changed before it paused, the first two: the resumed
 *   turn counts on from them, and says `UNPLANNED_LINE` once a turn, a pause between
 * @property {string} [review]  a review rule asked (HarnessV4_Space_Plan SG-D13), as `describeRule` says it
 * @property {import("../second-look.js").LookRef} [look]  its second look: the Reviewer's run, or why there is none
 * @property {import("../../services/memory/outcomes.js").Spent | null} [spent]  what the turn spent before it paused
 *   (M7-D48): its resume's outcome adds it in
 * @property {Record<string, string> | null} [treeFrom]  where each place the turn snapshotted stood when it paused, by
 *   place — as it began, or its newest snapshot: the resumed turn's changes start there (turn-tree.js)
 * @property {import("../turn-tree.js").Waiting | null} [treeWaiting]  what its failed snapshots left to name when it
 *   paused: the resumed turn's next snapshot of each such place names it
 * @property {string} [question]  the words the reply ended with, the question or the permission asked — what a page
 *   that loads while the turn waits names on its card
 * @property {Offer} [offer]  a permission's always-allow waiting for the call's shape, as the page and a reload read it
 * @property {import("./chat-always.js").Keeps} [keeps]  where the project offers none: what "Always allow in this chat"
 *   would keep of the command that asks (d-allow), as the page and a reload read it
 * @property {string} [reason]  why a permission asks, apart from its command: the card says it beside the command
 *   (HarnessV3-Views V6-9)
 * @property {boolean} [supervise]  the turn's lead read along with its workers: its resume keeps that, as it keeps its
 *   tools and prompt (HarnessV3-TaskGraph-v2 TG2-D21)
 */
/**
 * @typedef {object} LoopNotice  Filament's note at the end of a reply, for clients that draw no card (HarnessV3-Launch
 *   LD-D7): `kind` says which — a question (`ask`), a permission, a developer's stop, the output ceiling, the
 *   compaction line under `ask`, the window — and `text` is the block's words, exactly
 * @property {"ask" | "permission" | "stop" | "output" | "compaction" | "window"} kind
 * @property {string} text
 * @property {boolean} [quoted]  a stop that came with the developer's words: the note quotes them
 */
/**
 * What the loop's fold asks its summarizer: the transcript of the rounds it folds (the argument), and — for a writer
 * that can read the live conversation itself (turn.js's fork of the warm cache) — that conversation as it stands,
 * with the keeper of what its blocks weigh (`weights`) and the one that names each block the rounds send (`sending`),
 * how many newest rounds stay, which rounds the summary stands for, and which door asked: the compaction line, or the
 * overflow recovery after a refusal for size (whose conversation is too big to send again as it is). A fork that waits
 * to try again (HarnessV3-AtHome AH-F4) tells `onWait` of each wait, one that waits for a slot at its provider tells
 * `onQueue` (AH-F5), and `signal` (a stop, the hang-up) ends either.
 * @typedef {{ convo: any[], weights?: import("../../core/tokens.js").BlockWeights | null, sending?: import("../../core/tokens.js").BlockWeights | null, keep: number, fromRound: number, toRound: number, door: "line" | "overflow" | "manual", signal?: AbortSignal | null, onWait?: (w: import("../../core/retry.js").Wait | null) => void, onQueue?: (q: import("../../services/call-waits.js").QueueNews | null) => void }} CompactAsk
 */
/**
 * What the loop asks of the hand that makes room in the whole chat (`compact.earlier`, HarnessV4_Tasks C33): `ahead`,
 * the messages ahead of the turn's own, which give way; the door that asked — the compaction line, or the overflow
 * recovery after a refusal for size (whose conversation is too big to read again as it is); and `signal`, `onWait` and
 * `onQueue` as a fold's (`CompactAsk`). The session's hand composes the session again from its archive and reads none
 * of it; a sub-agent's summarizes `ahead`. The start a hand returns is one the turn's message follows as it followed
 * `ahead`: where `ahead` ends with a reply whose calls that message answers, the start ends with those calls.
 * @typedef {{ ahead: any[], door: "line" | "overflow", signal?: AbortSignal | null, onWait?: (w: import("../../core/retry.js").Wait | null) => void, onQueue?: (q: import("../../services/call-waits.js").QueueNews | null) => void }} EarlierAsk
 */
/**
 * @typedef {object} LoopArgs
 * @property {string} model  the backing model (an ordinary route name)
 * @property {any[]} messages  the client's conversation, Anthropic-shaped
 * @property {import("../../core/tokens.js").BlockWeights | null} [weights]  what the conversation's blocks weigh, as
 *   the keeper that weighed them keeps it — a session's turn's, the sessions' keeper (`namedCopies`)
 * @property {string} system  the assembled system prompt (client's + the loop's)
 * @property {readonly any[]} tools  the frozen toolset for this configuration
 * @property {() => PermissionMode} modeNow  the permission mode in force, asked at each call (HarnessV3-AtHome AH-F1):
 *   the mode the request fixed, else the session's as it stands — a switch reaches the next call, a resume's included
 * @property {string} root  the working folder the hands are confined to
 * @property {readonly string[]} [added]  the folders added to it that read, grep, glob and a command that only reads
 *   reach too (`loop.addedFolders`, HarnessV4_Overnight_Plan OV-D22), as they passed for this turn
 * @property {string} readerModel  the reader behind delegate_read, "" when it is not offered (parked with a pause)
 * @property {number} maxTokens  the per-call output ceiling
 * @property {{ type: string, budget_tokens: number } | null} [thinking]  the request's thinking parameter (the composer's clamp of `model.thinking.budget`), on every round's call
 * @property {{ usable: number, window: number, target: number, source: "operator" | "agent" | "endpoint" | "builtin" | "session" | null, fixed: number, factor?: number | null, thinking?: "all" | "signed" | "none", media?: ((messages: any[]) => (block: any) => string | null) | null, self?: boolean, earlier?: ((o: EarlierAsk) => Promise<{ history: any[], fromTurn: number, toTurn: number, method: string, note: string } | { error: string }>) | null, summarize: (transcript: string, o: CompactAsk) => Promise<{ text: string, by: string, fork?: boolean }>, reattach?: ((o: { files: string[], plan: { text: string, status: string }[] | null, graph: string | null, room?: number | null, letters?: { id: string, from: string, subject: string, turn?: number }[], skills?: string[] | null }) => { text: string, files: { path: string, shown: boolean }[], plan: boolean, graph: boolean, open?: number }) | null } | null} [compact]
 *   the mid-turn compaction (§6.8): `usable` is the token budget the live conversation must fit
 *   (0 = window unknown, the machinery stands down), `target` where a fold aims to land
 *   (40% of the window, in tokens; 0 = window unknown), `window` the hard context window itself (0 = unknown)
 *   with the `source` the number came from, `fixed` the system prompt + tool schemas in tokens — constant for the
 *   whole turn, counted so the line measures what actually goes on the wire, `thinking` which of the conversation's
 *   thinking blocks the lane's upstream is sent (TG2-D81; "all" when unsaid), `summarize` is the summarizer (the session's compaction model, else the
 *   loop's own model), `earlier` makes room in the whole chat (HarnessV4_Tasks C33: the messages ahead of the turn's
 *   own give way and come back as the start the hand returns — a session's own turn has its earlier turns give way by
 *   the session's own method, a sub-agent's follow-up its earlier exchanges by its own model; a sub-agent's launch has
 *   none), and `reattach` writes what comes back after a fold's summary (HarnessV3-AtHome AH-D9 b): the
 *   files, read from the loop's folder under the session's rules and redaction and within `room` tokens (half of what
 *   the fold freed), the plan, and the task graph while it has open tasks
 * @property {(args: { body: any, weights?: import("../../core/tokens.js").BlockWeights | null, onDelta?: ((d: { kind: "text" | "thinking" | "signature", text: string }) => void) | null, onCall?: ((c: { id: string, name: string, text: string }) => void) | null, signal?: AbortSignal | null, onQueue?: ((q: import("../../services/call-waits.js").QueueNews | null) => void) | null, onMemory?: ((c: import("../../services/call-waits.js").MemoryCall) => void) | null }) => Promise<{ ok: boolean, status: number, json: any, id: string | null, upstream?: string | null, retryAfter?: number | null, shouldRetry?: boolean | null }>} call
 *   one model call through Filament's own front door; a failure names its provider and what that provider asks of
 *   another try (internal-call.js), which the round's retries read (retry.js); `onQueue` hears the call wait for a
 *   slot at its provider, and get it (HarnessV3-AtHome AH-F5); `onCall` hears each tool call as the model writes it,
 *   which the round asks for only while show_visual is offered (VS-D11); `onMemory` hears each memory call Filament ran
 *   inside the call, which its reply never carries (the owner's of 10-29)
 * @property {(requestId: string | null) => number} costOf  what a finished call cost, from its record
 * @property {((requestId: string | null) => number | null) | null} [writingOf]  the time a finished call was writing its
 *   reply (ms), from its record (services/daily-usage.js writingMs); null where too short to rate
 * @property {((requestId: string | null) => boolean) | null} [cacheSaidOf]  whether a finished call's usage said its
 *   cache numbers, from its record (core/cache-facts.js `cacheSaid`): one that said none is no `round-cache`
 * @property {(name: string, input: any, opts: { root: string, signal?: AbortSignal | null, onOutput?: ((text: string) => void) | null, movable?: ((move: () => { id: string } | null) => () => void) | null, onMoved?: ((m: { id: string, timedOut: boolean }) => void) | null, mayAct?: ((site: string, page: string) => boolean) | null, mayLook?: ((page: string) => boolean) | null, outside?: boolean, afterWrite?: boolean, remote?: ((input: any) => Promise<{ id: string, s: any }>) | null }) => Promise<string | MediaResult>} runHand  a hand's words, or words with an image beside them (HarnessV3-Tools TL-D17);
 *   `outside`: a write outside the chat's folder the developer said yes to (HarnessV4_SpacesPlugins_Plan A2b), past the fence;
 *   `movable` hands a running command's way to the background on (HarnessV4_Four_Plan E21); `mayAct`, a browser
 *   batch's later steps judged on the page each acts on, as its call was (HarnessV4_Browser_Plan BR2); `remote`,
 *   bash_background's start on another machine (`machines`)
 * @property {{ apply: (input: any) => { ok: true, text: string, view: any, changed: boolean, media?: any[], more?: Promise<string> } | { ok: false, error: string }, open: () => string | null, hasOpen?: (() => boolean) | null, begin?: (() => string | null) | null, where?: ((o?: { back?: boolean }) => string | null) | null, onTask?: (() => string | null) | null, ownWork?: (() => string | null) | null, outside?: ((file: string, folder: string) => { path: string, tasks: { id: string, name: string, writes: string[] }[] } | null) | null, soFar?: ((input: any) => Promise<string | null>) | null, plan?: ((items: { text: string, status: string }[], task?: string) => { text: string, view: any, changed: boolean, more?: Promise<string> }) | null, stepsRefusal?: ((task: string) => string | null) | null } | null} [graph]
 *   the session's task graph (HarnessV3-TaskGraph), behind the `tasks` tool: `apply` runs one
 *   call against it and keeps what changed — the words the model reads, the view the page draws, or the refusal's
 *   words, and `more`, what git read of what its done tasks changed (E41 P2 case 11), to wait for — `open` is the graph
 *   as it comes back after a summary (null with nothing open), `begin` the turn begun — its running tasks a turn on (E41 P2 case 13) —
 *   and where the agent stands, for the turn's first request (E41 P1; null with nothing open), `where` the same after a
 *   summary (`back`), `onTask` the line behind what lands while a task of the agent's own runs (E41 P1 case 7; null
 *   with none), and `ownWork` the agent's own running tasks, which a wait with no sub-agent running names (E41 P5's
 *   measure; null with none); `plan` puts the agent's checklist on it, and `stepsRefusal` says why a checklist may not
 *   name a task as the one its items are the steps of (null where it may), both null for a lead's; null when it is off
 * @property {import("./visuals.js").FileVisual | null} [visuals]  where a visual the agent draws is kept, whole, on the turn
 *   it was drawn in (HarnessV4_Visuals_Plan VS-D9) — null where nothing would show it, and show_visual is not offered
 * @property {{ store: import("../../services/artifacts.js").ArtifactStore, at: import("./artifacts.js").ArtifactAt } | null} [artifacts]
 *   the artifacts' store and where this run's calls stand (HarnessV4_Artifacts_Plan E18) — null where the run makes
 *   none, and `artifact` is not offered
 * @property {import("./space.js").SpaceAt | null} [space]  where this run's calls to its project's Space stand
 *   (proposal_ux §4.14) — null for a chat of no project, and `space` is not offered
 * @property {import("./beside-tool.js").BesideAt | null} [beside]  where this run's calls to fire teams beside its chat
 *   stand (team_v2_plan §5.5) — null where it fires none, and `team` is not offered
 * @property {import("./flow-tool.js").FlowAt | null} [flow]  where this run's calls to draw a flow beside its chat stand
 *   (HarnessV4_OneAgent_Plan OA3) — null where it draws none, and `flow` is not offered
 * @property {import("./thread-tool.js").ThreadAt | null} [thread]  where this run's calls to start a thread of its chat
 *   stand (app/threads.js) — null where it starts none, and `thread` is not offered
 * @property {{ chain: string, deps: import("./craft-tool.js").CraftDeps } | null} [craft]  where this run's calls to craft
 *   its chat's skill stand (agent/craft-tool.js) — null outside a crafter chat, and `craft` is not offered
 * @property {{ session: string } | null} [comeBack]  the chat this run's agent may come back to later (agent/come-back.js)
 *   — null for a sub-agent, a lead, or a client's own conversation, and `come_back` is not offered
 * @property {{ page: () => string, allowed: (site: string) => boolean, allow: (site: string, lead?: boolean) => void, team?: import("../browser/registry.js").TeamOf | null } | null} [browser]
 *   the chat's browser while `browser` is offered (HarnessV4_Browser_Plan BR2): the page it shows now, which the rules
 *   and the gate read, and the sites this agent may act on — those the developer said yes to for this chat (BR-D6), and
 *   a team's worker's (`team`, which its question names) those its lead said yes to for its team; `allow` keeps a yes,
 *   `lead` a lead's — null where it is not
 * @property {((paths: string[], question: string, opts: { root: string, signal?: AbortSignal | null }) => Promise<{ text: string, requestId: string | null }>) | null} delegateRead
 *   the cheap-model reader behind `delegate_read`, or null when it is not offered; `signal` is the round's cut (the
 *   client's hang-up and the developer's stop), so a Stop ends the reader's call too
 * @property {import("./subagents.js").Subagents | null} [subagents]  the launcher behind `agent` — and a team's lead's
 *   `worker` — or null when it is not offered (a sub-agent's own run gets none)
 * @property {import("./subagents.js").Inbox | null} [inbox]  sub-agents' reports for this turn: read before every
 *   round, and waited on before the turn may end
 * @property {((input: import("../letters.js").LetterInput) => { ok: boolean, text: string, sent?: import("./subagents.js").LetterSent, waiting?: import("../letters.js").ReplyWait } | null) | null} [letter]
 *   a sub-agent's own run, which has no inbox: its envelope tool's letter to the agent that launched it, or its answer
 *   to that agent's letter (subagents.js `subLetter`, the owner's of 11-04) — one with `wait` gives `waiting`, which
 *   the call waits on (`replyWait`)
 * @property {((ids: readonly unknown[]) => { dismissed: string[], unknown: string[] }) | null} [dismiss]  the chat's main
 *   agent's envelope tool's `dismiss` (agent/still-open.js): lines of what is still open that no longer hold, by their
 *   ids, left out of the list until what they name changes — null for a sub-agent, which has no list to dismiss from
 * @property {(() => import("../../adapters/tools/hands.js").ShellExit[]) | null} [shellNews]  the background shells
 *   of this agent that exited unseen, taken once each (HarnessV3-Tools TL-D24): told as the turn begins (HarnessV4_Tasks
 *   C11), at each round boundary, and as a summary of the conversation is written, never waited on
 * @property {(() => Promise<string> | string) | null} [fileNews]  the note on the files this agent read that changed since, each told once
 *   (agent/stale.js, the owner's word of 10-27): with the turn's first request and at each round boundary, as Claude
 *   Code tells them; "" when none did
 * @property {(() => string) | null} [openNews]  what is still open, where something the agent was told of ended or
 *   changed since it heard it (agent/still-open.js): with the turn's first request; "" when nothing did
 * @property {(() => { text: string, heard: () => void } | null) | null} [openWaited]  what is still open, where a change
 *   waited long in the turn with nothing said of it (agent/still-open.js `waited`): asked at each call, said on its
 *   result, and `heard` as it is; null where none waited so
 * @property {string | null} [openNote]  the record's note for what `openNews` said, where it is not a change: a compaction
 *   since, with nothing open, said with recall's list of the turns (the review of 11-08)
 * @property {boolean} [switched]  the chat moved to the loop for this turn: what `openNews` says is the handover, which
 *   carries where the agent stands on its task graph (sw-loop)
 * @property {((where: "head" | "tail", text: string) => void) | null} [saidAt]  each block the turn's start puts on the
 *   model's copy of the person's message — ahead of it, or after it —, in the order put: the turn keeps them, and every
 *   later turn puts them back on that message, so what the provider cached stays what is sent (agent/turn-said.js)
 * @property {((worked: { path: string, how: "read" | "write" | "edit" }[], told: { has: (head: string) => boolean, add: (head: string) => void }) => { text: string, told: import("./instructions.js").FolderTold[], left: string[] }) | null} [folderNews]
 *   the instruction files of the folders below the chat's that a round read, edited or wrote in, each told once while
 *   the conversation holds it (agent/instructions.js `folderInstructions`, the Designer's answer of 10-27)
 * @property {((path: string, o: { signal: AbortSignal }) => Promise<string>) | null} [problemsOf]  what the language
 *   server that serves a file says of its problems once the agent wrote or edited it, as the lsp tool's diagnostics says
 *   it (the owner's LSP of 11-04): its errors ride the call's result, or its next step (`errorsAfter`); `signal` ends the
 *   ask — a stop, the hang-up, the turn's end
 * @property {(() => string) | null} [movedNews]  what a builder's patch workspace said as it moved to a worktree for a
 *   call — its command, its hook, the language server after its write (adapters/git/patch.js, the owner's plan of 11-09)
 *   —, taken once, for that call's result; "" when it did not move
 * @property {((path: string, signal: AbortSignal | null) => Promise<string>) | null} [widen]  a helper's sparse copy
 *   brings in the folder of the file a read, a write or an edit reaches outside its cone (adapters/git/worktree.js
 *   `widenFor`, the owner's plan of 11-09 for big repos): the words for the call's result, "" where nothing came in
 * @property {(() => string | null) | null} [shellDue]  what of those waits to be told, taking none — "exit", "lines" (a
 *   watch's), "wake" (the time it set to come back) or "mixed", else null: it ends a wait
 *   on sub-agents (the `wait` tool, the turn's end), as a report does
 * @property {(() => { id: string, command: string }[]) | null} [shellsWaited]  the agent's own background commands that
 *   still run: its wait waits for them as for its sub-agents, their ends coming in by `shellDue` (the gap of 11-10, f6's
 *   follow-up: with only `npm install` running, a wait answered at once that nothing ran)
 * @property {boolean} [lead]  the turn is a team's lead's: its checkpoints are a lead's (checkpoint.js `READERS`)
 * @property {(() => { id: string, command: string }[]) | null} [shellsRunning]  a sub-agent's own background commands
 *   that still run: said once each as its turn would end (`shellsReminder`, the friction of 11-09), since their ends go
 *   to whoever launched it once its run is over — null for an agent whose chat a command's end wakes
 * @property {((convo: any[], round: () => number, weigh: () => number) => void) | null} [expose]  hands the live
 *   conversation and the round counter over once — for a fork of the loop's request as it stands (the spawn widget's
 *   Enhance) and for the developer's sub-agent marks on the turn's timeline, and by a sub-agent's own run to its
 *   registry, where its edit cards read their changes; the loop never reads anything back from them. `weigh`: what the
 *   request as it stands carries, on the scale of the loop's own line, a window known or not — a fork is weighed by
 *   the conversation it copies, not by the newest request's count, rounds behind it
 * @property {false | import("./tools.js").Unanswered} [unattended]  a sub-agent's run, a team's worker's, or that
 *   of an agent that started by itself: nobody can answer,
 *   so a call the gate or a rule would ask about is refused in words instead of pausing — unless `asker` can answer
 * @property {{ start: (about: import("../../core/second-look.js").LookAbout) => import("../second-look.js").LookRef, stop: (look: import("../second-look.js").LookRef) => void } | null} [secondLook]
 *   a review rule's second look (HarnessV4_Space_Plan S3b): the Reviewer starts on the call that asks, in this chat, and
 *   stops once it is answered
 * @property {((q: AskedCall, signal: AbortSignal) => Promise<AskAnswer | null>) | null} [asker]
 *   a team's worker in a session whose page can answer (HarnessV3-AtHome P2): a call the gate or a rule would ask about
 *   waits in place for the developer's answer, which this resolves with — null when the wait ended unanswered (its
 *   stop, the hang-up: the signal). The question carries the always-allow waiting for the call's shape (`offer`).
 * @property {{ start: (input: any, o: { root: string, ask: import("./remote-commands.js").AskHere, rule?: string | null, signal?: AbortSignal | null, mode?: string | null }) => Promise<{ id: string, s: any }>, answer: (id: string, o: { check: (answer: any) => string, signal: AbortSignal }) => Promise<any>, agentsChat?: boolean } | null} [machines]
 *   a chat's own agent where this Filament keeps a machine for its agents (the remote-agents plan's c-tools): its
 *   bash_background's `machine` starts the command there (`start`, remote-commands.js), judged there in this run's
 *   mode as the call is made (`mode`), and an ask there — or this
 *   chat's rule that asks first (`rule`) — waits on this run's card for the person's press (`answer`, the run's
 *   `awaitAnswer`); `agentsChat`: the chat was started by another
 *   machine's agents, which may answer its asks — no command of it runs on another machine
 * @property {boolean} [agentsChat]  the chat was started by another machine's agents, whether or not this Filament
 *   keeps a machine: Filament's own command line is no read for its commands (tools/read-only-commands.js `NOT_THEIRS`)
 * @property {((q: { question: string, options: string[] }, o: { signal: AbortSignal | null, emit: (e: any) => void }) => Promise<import("./subagents.js").LeadAnswer>) | null} [askLead]
 *   a team's worker (HarnessV3-TaskGraph-v2 TG2-D49, TG2-D58), behind its `ask_lead`: the question waits for its lead's
 *   answer — until its lead's turn ends, a plan 3 minutes at most; the round's cut (a stop, the hang-up) ends it — and
 *   `emit` puts it on the run, where it is a sign
 * @property {((commands: readonly string[]) => string | null) | null} [checkedVet]  a graph task's sub-agent
 *   (HarnessV3-TaskGraph-v2 TG2-D63): why the commands its report names in checked cannot be its task's check, in the
 *   words its call's error says — or null
 * @property {(() => boolean) | null} [planHeld]  a worker whose lead reviews its plan (TG2-D50): while this says so, its
 *   changes and commands are refused in Filament's words — its brief's grants among them — and its reads run. Asked at
 *   each call, as its lead's go ends it mid-turn
 * @property {Readonly<Record<string, string>> | null} [notCallable]  offered tools this run may not call (a fork carries
 *   the main agent's tool set byte for byte): a call is answered with its words, never run or asked about
 * @property {((pictures: { mediaType: string, data: string }[]) => void) | null} [steerPictures]  the pictures the
 *   developer's messages into the turn carry, told as they are heard, whether or not this turn's provider takes them: a
 *   sub-agent's `attach` hands them on as `picture N` (attach.js)
 * @property {{ read: (pick?: (m: any) => boolean) => any[], unheard?: (msgs: any[]) => void, stopSignal?: AbortSignal | null, forceSignal?: AbortSignal | null, next?: () => Promise<void>, peek?: (pick: (m: any) => boolean) => any, movable?: (callId: string, move: () => { id: string } | null) => () => void, weighed?: () => Promise<void> | null, unweigh?: (why: string) => number } | null} mailbox  the run's steering mailbox (messages typed while the loop works);
 *   its `stopSignal` aborts the moment a stop lands, and cuts the round's in-flight work; `forceSignal` aborts on a
 *   Force stop, and the turn ends at once, whatever the loop is waiting on; `next` wakes a wait on sub-agents when a
 *   message is queued, without reading it; `movable` holds a running command's way to the background under its
 *   call's id, for the developer's Background (HarnessV4_Four_Plan E21)
 * @property {{ allowed: (name: string, input: any) => boolean, recordAllow: (name: string, input: any) => { shape: { shape: string, text: string, tool: string }, count: number, offered: any | null } | null, offered: (name: string, input: any) => Offer | null } | null} permissions
 *   the learned permissions (WP-L): a confirmed rule lets a call through without asking; every allow is counted and,
 *   at the threshold, offered; `offered` is the offer still waiting for a call's shape, which the call's question
 *   carries
 * @property {readonly import("./rules.js").Rule[]} [rules]  `loop.rules` and `privacy.bashDeny` in force (HarnessV2 §5.2), judged before the gate
 * @property {boolean} [rateMovesOn]  a sub-agent's run with another row of its list to go on to (the owner's plan of
 *   11-05: fallback down the rows): a 429 on its first round's call is its answer, untried again, so it goes on there
 * @property {{ list: import("./grants.js").Grants, folder: string, holds?: () => boolean } | null} [grants]  a team's
 *   worker in its own worktree (`root`): what its brief lets it run without anyone's answer (HarnessV3-TaskGraph-v2
 *   TG2-D44), and the developer's folder that worktree copies, which a granted command may not reach. `holds`, asked at
 *   each call: whether the grants lift an ask now — false while another machine's agents' device may not run without
 *   asking here, so their worker's commands ask as any other's
 * @property {(() => import("./chat-always.js").Kept[]) | null} [alwaysRun]  the commands the chat keeps always allowed
 *   (d-allow, chat-always.js), read from its meta at each call: handed to the chat's own seat alone — its agent, or a
 *   team's lead in charge of it —, where a command they cover runs without asking and an ask for a command the project
 *   offers no always-allow for carries what a press would keep (`keeps`). None for a sub-agent, a worker or a chat
 *   another machine's agents started
 * @property {{ folder: string } | null} [fence]  a team's worker in its own worktree (`root`): the developer's folder
 *   that worktree copies. It is held to its worktree as a coding agent's worker is (HarnessV3-TaskGraph-v2 TG2-D38,
 *   TG2-D39), in every mode: a change outside it, a read or a search of the developer's folder outside it, and a
 *   command that reaches the developer's folder are refused in Filament's words, before anything else is asked — under
 *   Auto its hands are not fenced, and its change would land past its lead's apply and the folder's check (TG2-D55)
 * @property {import("./hooks.js").LoopHooks | null} [hooks]  the session's hooks (§5.6): pre-tool, post-tool, turn-end, and the read-back judgement
 * @property {((name: string, input: any) => { id: string, kind: string, line: string }[]) | null} [reminders]  memory at the
 *   moment of action (HarnessV3-Memory M5-3, M5-5): the pitfalls a call walks into and the open threads on the files it
 *   touches, each a line that rides on its result
 * @property {((event: any) => void) | null} [observe]  memory's observation bus (M5-4): told what each call that ran did
 * @property {ReadonlySet<string>} [mcpReadOnly]  the offered MCP tools whose servers vouch for them as read-only (§5.7): they run free; the others are judged like commands
 * @property {ReadonlySet<string>} [acts]  a routine's run's connections' tools it calls without asking, in any mode
 *   (HarnessV4_SpacesPlugins_Plan A2c): the gate lets them run, and the rules judge them after
 * @property {import("../../core/mcp-door.js").DoorIndex | null} [mcpDoor]  the session's MCP tools the mcp tool reaches (E49): a
 *   call through it runs as the server's own tool's call — judged, ruled, hooked, recorded and carded as that tool —
 *   while the reply the conversation keeps holds the call as the model made it
 * @property {import("../turn-tree.js").TurnTree | null} tree  the turn's working-tree snapshots (WP-J.2): the places a
 *   writing hand is about to write in, before it runs, and after a round that wrote, what each agent changed
 *   (HarnessV4_Git_Plan step 1); null when the folder is not watched
 * @property {boolean} [saysPlace]  the run says where the agent works now, as its calls run (`place`,
 *   HarnessV4_Git_Plan §11): a chat's own turn, not a helper's
 * @property {(evt: any) => void} onEvent  the run's timeline
 * @property {number} [previewChars]  characters of each tool result carried on its `tool-end` event (0: none)
 * @property {((pictures: ({ data: string } | { path: string })[]) => { images: any[], notKept: { count: number, why: string } | null }) | null} [keepImages]
 *   the run log's keeper of the pictures a call handed the model (HarnessV4_Tasks U9): its `tool-end` names what it kept
 * @property {LoopSink} sink
 * @property {AbortSignal | null} signal  the client's hang-up
 * @property {{ paused: PausedTurn, answer: string, allow?: boolean, modeSwitch?: boolean } | null} resume  a paused turn and the
 *   developer's answer; `allow`: their press of Allow (or a client's /allow), the one way a waiting permission runs —
 *   any other answer refuses it in their words; `modeSwitch`: the answer is the permission switch itself, so a waiting
 *   permission is judged again under the mode now in force (AH-F1)
 */
/**
 * @typedef {object} LoopResult
 * @property {"done" | "paused" | "budget-stopped" | "stopped" | "aborted" | "failed"} status
 * @property {string | null} error
 * @property {import("../../core/failure.js").Failure | null} [failure]  why a failed turn failed, in one shape
 *   (HarnessV3-FailurePoints §5.2); `error` says it in one line
 * @property {PausedTurn | null} pause
 * @property {string} [stoppedBy]  who stopped the turn when a developer's stop ended it (the steer's `from`, e.g.
 *   "harness") — unset for the loop's own stops (the compaction line under `ask`, the window), which are no one's
 * @property {boolean} [forced]  a Force stop ended the turn: it did not wait for the loop's next step
 * @property {LoopNotice | null} [notice]  the note the reply ended with, when it ended on one
 * @property {{ rounds: number, toolCalls: number, learnedRuns: number, ruleRuns: number, denied: number, firstIn: number, firstCacheRead: number, firstCacheWrite: number, firstCacheSaid: boolean, totalIn: number, totalOut: number, spentUsd: number, roundIds: string[], textBlocks: number, contextTokens: number | null }} totals
 *   `firstCacheSaid`: round one's usage said its cache numbers (`cacheSaidOf`).
 *   `totalIn`: every round's input as its provider counted it — uncached, read from its cache and written to it.
 *   `contextTokens`: the conversation's final size on the line's scale (furniture included, null when no window
 *   was ever known) — what the caller stamps onto the record so the pipe's estimate is the turn's end state,
 *   not its start. `spentUsd`, `roundIds` and `toolCalls` count the turn's sub-agents too.
 * @property {string[]} notes  the record's sentences
 * @property {{ file: string, as: string, how: string }[]} [foldersTold]  the folders' instruction files told as the
 *   agent worked there (`folderNews`), each with the file it worked on and how
 * @property {import("./hooks.js").HookOutcome[]} hooks  every hook that ran this turn, in order
 * @property {any[]} work  the turn's trajectory beyond the client's messages: each round's assistant tool calls and
 *   their tool results, in order (HarnessV2 D7) — what the archive keeps as the turn's work
 * @property {any[]} [history]  the messages ahead of the turn's own as they stand once the earlier turns gave way in
 *   it (`compactEarlier`); unset where they did not. A caller that keeps the conversation itself — a sub-agent's run,
 *   whose next follow-up sends it on — keeps this start, the turn's message after it
 * @property {any[]} final  the text blocks of the reply that closed the turn (no tool round followed it), then
 *   Filament's closing lines and its note, each a block — the turn's final beside its work; an earlier round's text is
 *   in the work
 * @property {import("../../core/task-graph.js").TaskReport | null} [report]  a run offered the report tool — a graph
 *   task's sub-agent's (HarnessV3-TaskGraph G2-4): the report it gave, the latest when it gave several, or null when
 *   it gave none
 */

export const STEERING_HEAD = "Message from the developer, relayed by Filament";
/** A team's worker hears its lead's messages apart from the developer's, in their own block (HarnessV3-AtHome P2). */
export const LEAD_HEAD = "Message from your team's lead, relayed by Filament";
/**
 * The same for a sub-agent, from the session's agent that launched it: a graph task's planner (HarnessV3-TaskGraph-v2
 * TG2-D20), and the letters of the agent that launched any other (letters.js, the owner's of 11-04).
 */
export const AGENT_HEAD = "Message from the main agent, relayed by Filament";
/**
 * The head of Filament's own block of words to a worker (`FILAMENT`, looks.js) — a stuck one sent to its lead
 * (HarnessV3-TaskGraph-v2 TG2-D59), why a call of a coding agent's was refused: neither the developer's nor its lead's.
 */
export const FILAMENT_HEAD = "Word from Filament, which runs this session and answers your permission requests";
export { FILAMENT };
/**
 * What the `wait` tool answers, after how long it waited, where what ended it is no report (the nudge map of 11-10: each
 * of these said "a sub-agent reported"): what a graph's word is about (subagents.js `cameOf`), or several kinds at once.
 * @type {Readonly<Record<string, string>>}
 */
const CAME_WORDS = Object.freeze({
  check: "a check's verdict came. It follows as a message.",
  command: "a command task of your plan ended. Its end follows as a message.",
  merge: "an apply's verdict came — whether a task's change went into the folder. It follows as a message.",
  card: "the person answered the card that suggested tasks to run side by side. Their answer follows as a message.",
  mixed: "more than one thing came for you. They follow as messages.",
});
/**
 * What the `wait` tool answers when word of the agent's own background work came while it waited, by what came: a
 * command's end, lines a watch caught, the time it set to come back (the Hunters' find of 10-27: a watch's lines were
 * said to be an end). `subs`: sub-agents of its are still owed — a wait on its commands alone names none (the gap of
 * 11-10). @param {string} took @param {string | null | undefined} kind @param {boolean} [subs]
 */
const SHELL_ENDED = (took, kind, subs = true) => {
  /** @param {string} s */
  const rest = (s) => (subs ? `${s}; your sub-agents are still running.` : `${s}.`);
  return kind === "lines"
    ? `Waited ${took}: a background command you watch printed lines you watch for. They follow; the command is still running${subs ? ", and your sub-agents are too" : ""}.`
    : kind === "wake"
      ? `Waited ${took}: the time you set to come back has come. ${rest("Your note follows")}`
      : kind === "idle"
        ? `Waited ${took}: Filament checked in on a background command of yours that still runs. ${rest("Its word follows")}`
        : kind === "mixed"
        ? `Waited ${took}: word of your background work came — a command's end, lines you watch for or the time you set. ${rest("It follows")}`
        : `Waited ${took}: a background command of yours ended. ${rest("Its exit follows")}`;
};
/**
 * What a sub-agent hears as its turn would end with background commands of its own still running (the friction of
 * 11-09: a builder ended with its tests going): which, and where their results go. @param {readonly { id: string, command: string }[]} list
 */
export const shellsReminder = (list) =>
  `[Filament: commands you started in the background still run: ${list.map((s) => `${s.id} (${headChars(s.command.replace(/\s+/g, " ").trim(), 80)})`).join(", ")}. Each one's result comes to you at your next step once it ends, while you work: wait for it with bash_output (its id, with until or wait), or stop it with bash_kill if you no longer need it. End your turn now and their results go to whoever launched you, unread by you.]`;
const PLAN_STATUSES = new Set(["pending", "doing", "done", "blocked"]);
/** How much of a person's message or a sub-agent's report the mid-turn summary is written from: words, not bulk. */
const REPORT_CHARS = 8000;
/**
 * How many cards a command on another machine has put up in this process (`askThere`): each card's id its own, never
 * the model's call id, which a provider may give again in a later round — a late press on an old card settles nothing.
 */
let thereCards = 0;
/** How often a round's calls' input is said as the model writes it (ms): `round-writing`, the speed gauge's count. */
const WRITING_MS = 500;
/** The calls whose result is a sub-agent's report: the foreground launch, the envelope opened. */
const REPORTING_CALLS = new Set(["agent", "envelope"]);
/** Whether a note in the work is someone's words — a message relayed, a sub-agent's report — rather than Filament's
 *  own line. @param {string} s */
const saysWords = (s) => s.startsWith(STEERING_HEAD) || s.startsWith(LEAD_HEAD) || s.startsWith(AGENT_HEAD) || isGuideBlock(s) || s.includes("\n\nIts report:\n");
/** The hands that can change the working tree: a round in which one ran is snapshotted. */
export const WRITING_HANDS = new Set(["write", "edit", "bash", "bash_background", "powershell"]);
/** How long the result of a write or an edit waits for the errors the language server finds in its file (the owner's
 *  LSP of 11-04): what it finds after that rides the agent's next step. */
const ERRORS_WAIT_MS = 3000;
/** The most of a file's errors one result or step lists: the lsp tool's diagnostics lists them all. */
const ERRORS_SHOWN = 20;
/** An error's words without its place, which a write above it moves: what tells one error from another. @param {string} line */
const errorWhat = (line) => line.replace(/^.+?:\d+:\d+: /, "");
/** A file's errors as its write's or edit's card shows them, every one counted, the first ERRORS_SHOWN listed. @param {string[]} lines */
const errorsCarded = (lines) => ({ errors: lines.length, lines: lines.slice(0, ERRORS_SHOWN) });
/**
 * A file's errors as the agent reads them: found as its write or edit was answered, or after — then each as the lsp
 * tool says it, the first ERRORS_SHOWN of them. Where the turn told it the file's errors before (`before`, their words),
 * only those it was not told are listed, the rest counted, and errors gone whole are said in a line (the owner's of
 * 11-04: keep LSP's tokens in mind). Its words, "" where there is nothing to say, and the errors it lists.
 * @param {string[]} lines @param {string} path  as the agent named it @param {string} how  write or edit @param {boolean} later
 * @param {string[] | undefined} before
 * @returns {{ text: string, listed: string[] }}
 */
const errorsWords = (lines, path, how, later, before) => {
  const verb = `The language server ${later ? "found" : "finds"}`;
  const where = later ? ` after your ${how}'s result was written` : "";
  /** @param {number} n @param {string} [kind] */
  const count = (n, kind = "") => (n === 1 ? (kind ? `a ${kind} error` : "an error") : `${n} ${kind ? `${kind} ` : ""}errors`);
  /** @param {string[]} list */
  const shown = (list) => `${list.slice(0, ERRORS_SHOWN).join("\n")}${list.length > ERRORS_SHOWN ? `\n[${list.length - ERRORS_SHOWN} more: the lsp tool's diagnostics lists them all]` : ""}`;
  if (!before) return lines.length ? { text: `${verb} ${count(lines.length)} in ${path}${where}:\n${shown(lines)}`, listed: lines } : { text: "", listed: [] };
  if (!lines.length) return { text: before.length ? `${verb} no errors in ${path}${where ? `${where}:` : " now:"} ${before.length === 1 ? "the one it found before is gone" : `the ${before.length} it found before are gone`}.` : "", listed: [] };
  const left = [...before];
  const fresh = lines.filter((l) => {
    const i = left.indexOf(errorWhat(l));
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
  const kept = lines.length - fresh.length;
  const remain = kept === 1 ? "one it found before remains" : `${kept} it found before remain`;
  if (!fresh.length) return { text: `${verb} no new error in ${path}${where}: ${remain}.`, listed: [] };
  return { text: `${verb} ${count(fresh.length, "new")} in ${path}${where}${kept ? ` — ${remain}` : ""}:\n${shown(fresh)}`, listed: fresh };
};

/**
 * One client-visible turn of the agent loop. A Force stop (the mailbox's `forceSignal`, HarnessV3-FixRound F2 item
 * 13) ends it at once: what the loop holds so far is the turn — the finished rounds, the round's finished calls with
 * their results, the rest answered as cut — whatever it was waiting on (a hook, a reader, a compaction, a snapshot)
 * that a Stop cannot cut. What the loop still does after that is muted: no event, no byte, and its result is dropped.
 * @param {LoopArgs} a
 * @returns {Promise<LoopResult>}
 */
export function runAgentTurn(a) {
  const force = a.mailbox?.forceSignal || null;
  /** @type {{ forced: boolean, end: (() => LoopResult) | null, fail: ((e: any) => LoopResult) | null }} */
  const ctl = { forced: false, end: null, fail: null };
  // A throw the loop did not turn into an end itself fails the turn on what it holds (`ctl.fail`), keeping its work;
  // one before the loop holds anything flies, and the caller says it.
  const flow = loopTurn(a, ctl).catch((/** @type {any} */ e) => {
    if (ctl.forced || !ctl.fail) throw e;
    return ctl.fail(e);
  });
  if (!force) return flow;
  return new Promise((resolve, reject) => {
    let settled = false;
    const onForce = () => {
      if (settled || !ctl.end) return;
      settled = true;
      resolve(ctl.end());
    };
    force.addEventListener("abort", onForce, { once: true });
    flow.then(
      (r) => {
        force.removeEventListener("abort", onForce);
        if (settled) return;
        settled = true;
        resolve(r);
      },
      (e) => {
        force.removeEventListener("abort", onForce);
        if (settled) return;
        settled = true;
        reject(e);
      },
    );
    if (force.aborted) onForce();
  });
}

/**
 * The loop itself; `ctl` is its Force stop: `end` builds the turn from what it holds, then `forced` mutes the rest;
 * `fail` builds a failed turn from what it holds, after a throw.
 * @param {LoopArgs} a @param {{ forced: boolean, end: (() => LoopResult) | null, fail: ((e: any) => LoopResult) | null }} ctl
 * @returns {Promise<LoopResult>}
 */
async function loopTurn(a, ctl) {
  const { lead = false, model, tools, modeNow, root, added = [], readerModel, maxTokens, thinking: thinkingParam = null, call, costOf, writingOf = null, cacheSaidOf = null, runHand, delegateRead, subagents = null, inbox = null, letter = null, dismiss = null, shellNews = null, fileNews = null, openNews = null, openWaited = null, folderNews = null, problemsOf = null, movedNews = null, widen = null, shellDue = null, shellsWaited = null, shellsRunning = null, unattended = false, asker = null, machines = null, askLead = null, checkedVet = null, planHeld = null, notCallable = null, steerPictures = null, mailbox, permissions, rules = [], rateMovesOn = false, grants = null, fence = null, hooks = null, reminders = null, observe = null, mcpReadOnly = new Set(), mcpDoor = null, acts = new Set(), tree, saysPlace = false, onEvent, signal } = a;
  // After a Force stop the reply is closed: the loop's later writes land nowhere.
  /** @type {LoopArgs["sink"]} */
  const sink = {
    text: (t) => { if (!ctl.forced) a.sink.text(t); },
    thinking: (t) => { if (!ctl.forced) a.sink.thinking(t); },
    signThinking: (t) => { if (!ctl.forced) a.sink.signThinking(t); },
    endBlock: () => { if (!ctl.forced) a.sink.endBlock(); },
    count: () => a.sink.count(),
  };
  const previewChars = Math.max(0, Math.floor(Number(a.previewChars) || 0));
  /** The preview is what a viewer shows without the whole result: the head of what the model got, the cut marked; null
   *  where events carry none. @param {string} out */
  const previewOf = (out) => (previewChars > 0 ? (out.length > previewChars ? `${out.slice(0, previewChars)}\n…[Filament: preview cut at ${previewChars} of ${out.length} characters]` : out) : null);
  const keepImages = typeof a.keepImages === "function" ? a.keepImages : null;
  const offered = new Set(tools.map((t) => t.name));
  // A graph task's sub-agent is offered report (HarnessV3-TaskGraph G2-4): its run ends with one, which its result
  // carries, and it is asked for one once as it would end without. One that carries it refused in words — the main
  // agent whose forks inherit it, a fork that does no task — reports nothing (tools.js `REPORT_NOT_YOURS`).
  /** Whether the run offers a tool: in its set, or an MCP tool that loads on demand, through the mcp tool (E49). @param {string} name */
  const isOffered = (name) => offered.has(name) || (offered.has(MCP_DOOR) && !!mcpDoor?.byName.has(name));
  const reports = offered.has("report") && !notCallable?.report;
  /** @type {import("../../core/task-graph.js").TaskReport | null} */
  let taskReport = null;
  let reportAsked = false;
  /** @type {string[]} */
  const notes = [];
  /** The folders' instruction files told this turn, for its record. @type {{ file: string, as: string, how: string }[]} */
  const foldersTold = [];
  // The folder notes the conversation holds (`folderNews`): each looked for in it once, then known — until a
  // compaction or a clearing changes what it holds.
  const toldHere = new Set();
  const folderTold = {
    has: (/** @type {string} */ head) => toldHere.has(head) || (convoHolds(convo, head) && !!toldHere.add(head)),
    add: (/** @type {string} */ head) => void toldHere.add(head),
  };
  /** @type {string[]} */
  const roundIds = [];
  let firstIn = 0,
    firstCacheRead = 0,
    firstCacheWrite = 0,
    firstCacheSaid = false,
    totalIn = 0,
    totalOut = 0,
    spent = 0,
    toolCalls = 0;
  let round = a.resume ? a.resume.paused.round : 0;
  /** The turn's lead reads along with its workers (HarnessV3-TaskGraph-v2 §12): a look at them rides the inbox, and its wait says so. */
  const reads = !!inbox?.reads;
  /** Whom it reads along with, and what the record calls the reader: a team's lead and its workers, or the agent and its graph's sub-agents (V2-0c). */
  const crew = inbox?.who || "workers";
  const reader = crew === "workers" ? "the lead" : "the agent";
  /** What this loop can take, for its checkpoints (checkpoint.js): a team's lead, a sub-agent, the envelope tool. @type {import("./checkpoint.js").Reader} */
  const checkpointReader = { ...READERS.loop, lead, worker: !!shellsRunning, envelopes: !!inbox?.sealed };
  /** The look the conversation was last given, until the model has answered it. @type {import("./subagents.js").Taken | null} */
  let unheard = null;
  /** The conversation was given a look, and should hold one while workers run. */
  let lookHeld = false;
  /** The looks the turn was shown, and how many of them became a line. */
  let looksTaken = 0;
  let looksLined = 0;
  /** The agent waited — its wait, or the developer's paused launch — so the next take opens what is sealed and what
   *  arrived, oldest first (HarnessV4_Envelopes_Plan EN-D1); a take at work seals another agent's result. */
  let openNext = false;
  /** The turn's end said once what was still sealed (EN-D5): it may end the next time. */
  let reminded = false;
  /** The background commands a turn's end said still ran, by id: each is said once (`shellsReminder`). */
  const shellsSaid = new Set();
  let textBlocks = 0; // this reply's text blocks: a resumed turn is a new reply to the client
  /** The model wrote some of this reply's text, a cut round's included: a closing note points the reader up at it only
   *  then (HarnessV3-Launch LD-D7 — "what was finished is above" over nothing at all was untrue). */
  let replied = false;
  let learnedRuns = 0;
  let ruleRuns = 0,
    denied = 0;
  /** @type {import("./hooks.js").HookOutcome[]} */
  const hookOutcomes = [];
  /** Files written or edited this turn, by the call number that wrote them; reads after the write clear the debt. A
   *  resumed turn starts with the debt its pause left, as written before its first call (the bug report's H7: the
   *  read-back and the hooks a write calls for forgot what the turn wrote before it paused). @type {Map<string, number>} */
  const written = new Map((a.resume?.paused.unread || []).map((p) => [p, 0]));
  /** @type {Map<string, number>} */
  const readAt = new Map();
  /** The files the turn's writes and edits changed, as the hands resolve them (`fileKey`), until there are two: the
   *  second is where `UNPLANNED_LINE` is judged, once a turn. @type {Set<string>} */
  const changedFiles = new Set(a.resume?.paused.changed || []);
  /** The turn's drift watch (core/drift.js): the command that failed in a row with nothing changed between. */
  const drift = newDriftState();
  /** The files written or edited whose result was written before the language server spoke of them, by file: as the
   *  agent named it, the call (its name, id and round), and its errors once they come (`errorsAfter`) — null where it
   *  said nothing of them. A later write of the file stands for it.
   *  @type {Map<string, { path: string, how: string, id: string, round: number, lines: string[] | null | undefined }>} */
  const errorsDue = new Map();
  /** The errors the turn told the agent a file holds, by file, as it was told them last: their words (`errorWhat`).
   *  @type {Map<string, string[]>} */
  const errorsTold = new Map();
  /** A file's errors in words (`errorsWords`), kept as the agent's latest of them. @param {string} key @param {string[]} lines @param {string} path @param {string} how @param {boolean} later */
  const errorsTelling = (key, lines, path, how, later) => {
    const before = errorsTold.get(key);
    errorsTold.set(key, lines.map(errorWhat));
    return errorsWords(lines, path, how, later, before);
  };
  /** Ends the language server's checks still waiting as the turn ends: what they find would come after its last step. */
  const errorsOver = new AbortController();
  let wroteThisTurn = a.resume?.paused.wrote === true;
  /** The agent calls whose sub-agent wrote to the working tree: their round is snapshotted like a write's. @type {Set<string>} */
  const subagentWrote = new Set(a.resume?.paused.subagentWrote || []);
  /** A delivered report's sub-agent wrote since the last snapshot: one is taken as it is delivered. */
  let deliveredWrites = false;
  /** The files helpers wrote in the folder they share with the turn, by the call that ran them and as their reports
   *  came, for the round's record (HarnessV4_Git_Plan GWC-13). */
  /** @type {Map<string, import("../turn-tree.js").Writes>} */
  const helperWrites = new Map();
  /** @type {import("../turn-tree.js").Writes[]} */
  let deliveredList = [];
  /** The round's commands that ran: what changed while they did is set apart under its own words (GW-D2). */
  /** @type {Set<string>} */
  const ranCommands = new Set();
  /** Each place's failure to snapshot, said once a turn, and once more where its snapshot then ran past its time. @type {Set<string>} */
  const treeTold = new Set();
  let turnEndRounds = 0;
  /** Sentences Filament adds at the very end of the reply, before the status line (an offer made this turn). @type {string[]} */
  const closing = [];
  /** A reply with no tool call as the conversation keeps it when the turn goes one more round after it. A model can end
   *  a round with nothing, and an empty assistant message, or an empty text block, is refused on the next request ("all
   *  messages must have non-empty content"): kept as a line that says so, as Claude Code keeps one. @param {any[]} content */
  const keptReply = (content) => {
    const kept = (content || []).filter((b) => !(b?.type === "text" && !b.text));
    return kept.length ? kept : [{ type: "text", text: "(no content)" }];
  };
  /** The newest reply's text while it is not in `convo`: it closes the turn unless a tool round moves it into the work. @type {any[]} */
  let closingReply = [];
  /** The round's cut (`cutHere`) while its model call is in flight: a Force stop keeps what the call had streamed, as
   *  a stop's cut does (the bug report's L3). @type {(() => void) | null} */
  let inFlight = null;
  /** @type {any[] | null} */
  let plan = a.resume ? a.resume.paused.plan : null;
  let state = "idle";
  // Every tool event carries its card (D8) — the same `{ kind, title, subject }` the transcript's archived tools
  // read, computed once at the call's start from its input and joined back by id, so start and end agree whatever
  // vocabulary the name speaks. The input never rides the event out; the card says all it needs.
  /** @type {Map<string, any>} */
  const cards = new Map();
  /** The calls started and not yet ended, for a Force stop to answer as cut. @type {Map<string, { name: string, at: number }>} */
  const openCalls = new Map();
  const emit = (evt) => {
    if (ctl.forced) return; // force-stopped: what the loop still does is no one's to see
    try {
      let e = evt;
      if (e?.type === "tool-start") {
        const card = e.name ? cardOf(e.name, e.input ?? null) : null;
        if (e.id != null && card) cards.set(String(e.id), card);
        e = { ...e, ...(card ? { card } : {}) };
        delete e.input;
      } else if (e?.type === "tool-end" && e.id != null && cards.has(String(e.id))) {
        e = { ...e, card: cards.get(String(e.id)) };
      }
      if (e?.type === "tool-start" && e.id != null) openCalls.set(String(e.id), { name: String(e.name || ""), at: Date.now() });
      else if (e?.type === "tool-end" && e.id != null) openCalls.delete(String(e.id));
      onEvent(e);
    } catch {}
  };
  // Where the agent works now: each call placed as it runs, from the folder it starts in, the chat's (GW-D64).
  const nowIn = saysPlace && root ? createNowIn({ root, publish: emit, fresh: true }) : null;
  /** @param {string} to @param {string} why @param {Record<string, unknown> | null} [more]  what the state carries beside its why: a wait's `retry`; `woke`, said even where the state stands */
  const go = (to, why, more = null) => {
    if (to === state && !more?.woke) return;
    emit({ type: "turn-state", from: state, to, why, ...(more || {}) });
    state = to;
  };
  /**
   * A model call's waits, said where the developer looks: a wait between tries (`retry`, HarnessV3-AtHome AH-F4) and a
   * wait for a slot at its provider (`queue`, AH-F5). While one lasts it is the turn's state, which the page draws
   * beside the timer, and it is a line of the record; the next try, or the slot, puts the state back as it was.
   * @param {string} what the call, for the record ("round 3")
   * @returns {{ retry: (w: import("../../core/retry.js").Wait | null) => void, queue: (q: import("../../services/call-waits.js").QueueNews | null) => void }}
   */
  const saidWaits = (what) => {
    const was = state;
    return {
      retry: (w) => {
        if (!w) return go(was, `${what}: trying again`);
        notes.push(`agent: ${what}: ${w.words}`);
        go("waiting", w.words, { retry: { upstream: w.r.upstream ?? null, status: w.r.status, waitMs: w.waitMs, next: w.next, of: RETRY_TRIES } });
      },
      queue: (q) => {
        if (!q) return go(was, `${what}: has its slot`);
        notes.push(`agent: ${what}: ${q.words}`);
        go("waiting", q.words, { queue: { upstream: q.upstream, model: q.model, cap: q.cap, holders: q.holders } });
      },
    };
  };
  /**
   * The turn's end and its status. Filament's closing lines (an offer made this turn) are a text block of the reply, and
   * its note — what a client that draws no card reads of a question, a permission, a stop or a rail — is the reply's
   * last block, marked (`notice`, HarnessV3-Launch LD-D7) so a page that draws the card for it leaves the copy out.
   * Every client and the archive keep the text: the model reads next turn how this one ended.
   * @param {LoopResult["status"]} status @param {LoopNotice | null} [note] @param {string | null} [error]
   * @param {import("../../core/failure.js").Failure | null} [failure]  a failed turn's failure, `error` its line
   */
  const endWith = (status, note = null, error = null, failure = null) => {
    errorsOver.abort();
    const closed = closing.splice(0).join("\n");
    if (closed) {
      sink.text(closed);
      sink.endBlock();
      textBlocks++;
    }
    if (note) {
      // Ahead of the words, so a page reading the run's events beside the reply knows the block before it lands.
      emit({ type: "notice", kind: note.kind, text: note.text, ...(note.quoted ? { quoted: true } : {}) });
      sink.text(note.text);
      sink.endBlock();
      textBlocks++;
    }
    go(status, error || note?.text || status);
    // A look the model never answered — its call failed, or the turn ended first — puts its marks back: the next look
    // shows that part again (TG2-D15).
    if (unheard) {
      inbox?.back?.([unheard]);
      unheard = null;
    }
    if (looksTaken) notes.push(`agent: ${reader} was shown ${looksTaken} look${looksTaken === 1 ? "" : "s"} at its ${crew}; its conversation kept the newest whole while they ran${looksLined ? `, ${looksLined} older one${looksLined === 1 ? "" : "s"} as a line` : ""}${gone.size ? `, and ${gone.size} round${gone.size === 1 ? "" : "s"} in which it only waited left it` : ""} — what the session keeps of the turn holds none`);
    return {
      status,
      error,
      ...(failure ? { failure } : {}),
      pause: null,
      notice: note,
      totals: { rounds: round, toolCalls, learnedRuns, ruleRuns, denied, firstIn, firstCacheRead, firstCacheWrite, firstCacheSaid, totalIn, totalOut, spentUsd: spent, roundIds, textBlocks, contextTokens: contextTokens() },
      notes,
      ...(foldersTold.length ? { foldersTold } : {}),
      hooks: hookOutcomes,
      // What the session keeps of the turn holds no look (TG2-D24): the reports are what its later turns read. A
      // paused turn's own conversation, parked for its resume, keeps the one it holds.
      work: reads ? withoutLooks(convo.slice(workFrom)) : convo.slice(workFrom),
      ...(gaveWay ? { history: convo.slice(0, baseLen - 1) } : {}),
      final: [...closingReply, ...[closed, note?.text].filter(Boolean).map((text) => ({ type: "text", text }))],
      ...(reports ? { report: taskReport } : {}),
    };
  };
  /** Where a note sends the reader for what the turn did: up to the reply's text when the model wrote some, else the
   *  words say none was written. @param {string} what */
  const above = (what) => (replied ? `${what} is above` : "no reply had been written yet");
  /** The reply reached its output ceiling (`max_tokens`): what was finished stays, the next message continues it.
   *  @param {"output"} which @param {number} at @param {number} limit @param {string} line */
  const budgetStop = (which, at, limit, line) => {
    emit({ type: "budget", which, at, limit });
    notes.push(`agent: ${which} budget reached (${at} of ${limit})`);
    return endWith("budget-stopped", { kind: which, text: line });
  };
  const aborted = () => !!signal?.aborted;
  // A stop from the harness (a `stop` steer) cuts the round's in-flight work at once — the model call, a running
  // command, a foreground sub-agent — instead of waiting for a decision point that a long command or a held stream
  // never reaches (2026-09-30: a 600 s command ran out its own timeout under a stop). The client's hang-up stays
  // `signal`; the stop's message stays in the mailbox, so the turn ends `stopped` in its words, never as a hang-up.
  const stopSignal = mailbox?.stopSignal || null;
  const cut = signal && stopSignal ? AbortSignal.any([signal, stopSignal]) : stopSignal || signal;
  const stopCut = () => !!stopSignal?.aborted;
  /** The developer's Compact during this turn (a `compact` steer, BUG-21): taken off the messages as they are read, and
   *  acted on at the top of the next round — never delivered to the model as a note. @type {any} */
  let compactAsked = null;
  /** @param {any[]} list */
  const sieve = (list) => list.filter((m) => {
    if (m?.kind !== "compact") return true;
    compactAsked = m;
    return false;
  });
  /** What the developer sent since the last read. With a stop among it, only the stop is taken: the turn ends on it,
   *  and a note or a Compact that came with it stays in the mailbox, so the run's end marks it unread — instead of
   *  reading "heard" or "taken up" when neither happened (the code and UI/UX reviews, 2026-09-30). */
  const readMail = () => {
    if (!mailbox) return [];
    const stops = mailbox.read((m) => m.kind === "stop");
    return stops.length ? stops : mailbox.read();
  };
  /** The turn pauses: the question is the reply's last text block, the state waits for the answer with its words.
   *  @param {PausedTurn} pause @param {string} question */
  const pauseWith = (pause, question) => ({ ...endWith("paused", question ? { kind: pause.kind, text: question } : null), pause: { ...pause, question } });

  const convo = a.resume ? a.resume.paused.convo : a.messages.map((m) => structuredClone(m));
  // What each block of it weighs, kept for the turn: it is measured two or three times a round. Every rewrite of the
  // conversation puts new blocks and messages where the old ones were and changes none in place, so a block's weight
  // stays its own (`createBlockWeights`). A copy of a block the request's keeper weighed is weighed by it (`namedCopies`):
  // a session's turn starts on a history the composition weighed.
  const weights = a.resume ? createBlockWeights() : namedCopies(a.weights, a.messages, convo);
  // Every round sends the conversation through Filament's own front door, read back there as a copy: each block it
  // sends goes by a name, and what the round's reply is weighed against is weighed once a block (`everyNamed`). The
  // fold's fork sends the same blocks by the same names.
  const sending = everyNamed(weights);
  a.expose?.(convo, () => round, () => weighNow());
  // Where the client's messages end and the turn's own work begins (a resumed turn remembers its own line).
  // Both move together when the earlier turns give way in the middle of the turn (`compactEarlier`).
  let baseLen = a.resume ? (a.resume.paused.baseLen ?? a.resume.paused.convo.length) : convo.length;
  let workFrom = a.resume ? (a.resume.paused.workFrom ?? baseLen) : baseLen;

  /**
   * The gate's verdict under the rules that cover the call (`ruled`), with the record's line when a rule reaches only
   * part of a command.
   * @param {ReturnType<typeof gate>} g @param {ReturnType<typeof ruleFor>} hit @param {string} name @param {any} input
   * @param {typeof readsOnly} [reads]
   */
  const judge = (g, hit, name, input, reads = readsOnly) => {
    const v = ruled(g, hit, name, input, root, isCommandHand(name) ? (c) => !!reads(c, name)?.ok : null);
    if (v.note) notes.push(`agent: ${v.note}`);
    return v;
  };
  /**
   * Whether a command only reads, read as its hand will run it: this turn's folder and the folders added to it, the
   * hand's shell — bash's, or the powershell hand's PowerShell (HarnessV4_Tasks C10) — and its environment
   * (HarnessV3-Launch LD-D11); and when not, why, which the gate says (HarnessV3-AtHome AH-F2).
   * @param {string} command @param {string} [name]  the hand: `bash`, or `powershell`
   */
  const readsOnly = (command, name = "bash") =>
    name === "powershell" ? readOnlyPowerShell(command, { root, program: POWERSHELL?.file ?? null, env: safeEnv(), reads: added, agentsDevice: a.agentsChat === true }) : readOnlyCommand(command, { root, shell: SHELL, env: safeEnv(), reads: added, agentsDevice: a.agentsChat === true });
  /**
   * `readsOnly` for one call's judgement, each command read once: its fence, its gate and a review rule each ask it of
   * the same command, and a reading looks at the disk (each path it names, PowerShell's folders walked).
   */
  const readsOnce = () => {
    /** @type {Map<string, ReturnType<typeof readsOnly>>} */
    const seen = new Map();
    return (/** @type {string} */ command, name = "bash") => {
      const key = `${name}\n${command}`;
      if (!seen.has(key)) seen.set(key, readsOnly(command, name));
      return /** @type {ReturnType<typeof readsOnly>} */ (seen.get(key));
    };
  };
  /** Where this turn's commands start, for the rules: a `cd` into this folder takes a command nowhere
   *  (HarnessV3-TaskGraph G2-14). */
  const here = { root, shell: SHELL.kind };
  /** What the rules read of a call: a browser call's page beside its input (HarnessV4_Browser_Plan BR-D7). @param {any} u */
  const subjectOf = (u) => (u.name === BROWSER ? { ...(u.input || {}), page: a.browser?.page() || "" } : u.input);
  /** The presses the developer said yes to, by call: what each runs, as asked (SA-D4). @type {Map<string, string>} */
  const pressYes = new Map();
  /** The writes outside the chat's folder the developer said yes to, by call: each passes the fence alone (A2b). @type {Set<string>} */
  const outsideYes = new Set();
  /**
   * The thread calls whose folder is settled, by call: the chat's mode ran it unasked, or the developer said yes
   * (`asked`) — to that start alone, never a write's yes, and counted towards no always-allow.
   * @type {Map<string, { asked: boolean }>}
   */
  const threadFolder = new Map();
  /**
   * The call the gate, the rules and the record judge for a call: a dashboard's button the agent presses through the
   * space tool (HarnessV4_AgentsSpace_Plan SA-D4) is judged as its command — or its connection's tool — would be, with
   * the button's words; any other call as itself. A press that may not run now (a draft, paused, a stale row) is the
   * space tool's to refuse, in its words.
   * A thread started in a folder that is not the chat's own (app/threads.js `asks`) is judged as a write there (`thread`,
   * the folder): refused read-only or by a deny rule, asked where that write asks — and, in a folder no project holds
   * yet (`fresh`), where it would run unasked too, Full access aside (thread-tool.js `folderVerdict`) —, as a coding
   * agent's call of it is (thread-tool.js `folderAskOf`).
   * @param {any} u @returns {{ name: string, input: any, press?: true, thread?: string, fresh?: boolean }}
   */
  const judgedAs = (u) => {
    if (u.name === THREAD && a.thread) {
      const at = a.thread.asks?.(u.input) ?? null;
      return at ? { name: "write", input: { path: at.folder, content: "" }, thread: at.folder, fresh: at.fresh } : u;
    }
    if (u.name !== SPACE || !a.space) return u;
    // A dashboard's press, or an app's action run with "do" (the Space Apps plan of 10-29), read as a dashboard's.
    const f = pressFieldsOf(spaceFields(u.input));
    if (!f) return u;
    // An app's tool (the owner's of 11-05), as its command with the tool's words — first, as the space tool runs a call
    // that names one (found by the review of 11-05: a press refused here let a tool's call through unjudged).
    const s = appToolStandIn(f, a.space) ?? pressStandIn(f, a.space);
    return s?.ok ? { ...s.call, press: true } : u;
  };
  /**
   * The gate's verdict on a call before the rules: the browser's own (BR-D6) — it looks freely and acts per site —
   * every other tool's from `gate`.
   * @param {PermissionMode} mode @param {any} u @param {((name: string, input: any) => boolean) | null} learned
   * @param {typeof readsOnly} [reads]
   * @returns {ReturnType<typeof gate>}
   */
  const gateOf = (mode, u, learned, reads = readsOnly) => {
    // Another machine's agents' chat without Full control never touches Filament's data folder, in any mode (s0d).
    if (a.agentsChat === true && filamentFolderNamed(u, root)) return { verdict: /** @type {const} */ ("refuse"), text: FOLDER_REFUSAL };
    if (u.name === BROWSER) return browserGate(mode, u.input, { page: a.browser?.page() || "", allowed: (site) => !!a.browser?.allowed(site), team: a.browser?.team || null });
    const g = gate(mode, u.name, u.input, learned, kindOf(u.name), reads, root);
    // A routine's run acts through the connections' tools the person switched it on with, read-only or not (A2c); the
    // rules still judge it after: a deny refuses, an ask asks.
    return g.verdict !== "run" && isMcpTool(u.name) && acts.has(u.name) ? { verdict: "run" } : g;
  };
  /**
   * Whether a browser batch's later step may act on a site, judged as its own call would be now — the mode, the
   * developer's yes for the chat, and the rules on the page it acts on. A step it may not is not run, and the call's
   * words say to call it alone, which asks.
   * @param {string} site @param {string} page
   */
  const browserMayAct = (site, page) => {
    const step = { action: "click", page };
    const v = ruled(browserGate(modeHere(), step, { page, allowed: (s) => !!a.browser?.allowed(s) }), ruleFor(rules, BROWSER, step, here), BROWSER, step);
    return v.verdict === "run";
  };
  /**
   * Whether this session's rules let the browser read a page it landed on (the bug round of 10-23): a deny rule naming
   * its site holds in the call that landed there, not only from the next one.
   * @param {string} page
   */
  const browserMayLook = (page) => ruleFor(rules, BROWSER, { action: "snapshot", page }, here)?.verdict !== "deny";
  /**
   * The grants a team's worker's brief, or a card, gives that cover a command it runs in its own worktree
   * (HarnessV3-TaskGraph-v2 TG2-D44, AG-267), or null: none for a call that is no command, and none for one that
   * reaches the developer's folder, by its path or by climbing out of the worktree.
   * @param {any} u @param {typeof readsOnly} [reads]
   */
  const grantOf = (u, reads = readsOnly) =>
    grants && grants.holds?.() !== false && isCommandHand(u.name)
      ? grantFor(grants.list, String(u.input?.command ?? ""), u.name, {
          at: here,
          readsOnly: (part) => reads(part, u.name),
          outside: (command) => namesOutside(command, grants.folder, root) || climbsOut(command, grants.folder, root, root),
        })
      : null;
  /**
   * The commands the chat keeps always allowed (d-allow, chat-always.js `keptFor`) that cover a command its own seat
   * runs, or null: none for a call that is no command, nor for a seat the turn handed none (`alwaysRun`).
   * @param {any} u @param {typeof readsOnly} [reads]
   */
  const keptRun = (u, reads = readsOnly) => {
    const kept = a.alwaysRun && isCommandHand(u.name) ? a.alwaysRun() : null;
    return kept?.length ? keptFor(kept, String(u.input?.command ?? ""), u.name, { at: here, readsOnly: (part) => reads(part, u.name) }) : null;
  };
  /**
   * What a call of a worker in its own worktree would do outside it (`fence`, `strayOf`), or null: a delegated read is
   * each of its files read.
   * @param {any} u @param {{ folder: string }} f @param {typeof readsOnly} [reads]
   * @returns {import("../agent-permits.js").Stray | null}
   */
  const strayed = (u, f, reads = readsOnly) => {
    const at = { root, worktree: root, folder: f.folder, readsOnly: reads };
    if (u.name !== "delegate_read") return strayOf(u, at);
    for (const path of Array.isArray(u.input?.paths) ? u.input.paths : []) {
      const out = strayOf({ name: "read", input: { path: String(path) } }, at);
      if (out) return out;
    }
    return null;
  };
  /** An MCP tool's nature for the gate: `read` when its server vouches for it as read-only. @param {string} name */
  const kindOf = (name) => (isMcpTool(name) ? (mcpReadOnly.has(name) ? "read" : "mutate") : undefined);
  /**
   * Whether a call that runs is a command that could have made a commit, which its start says (`command`) for the
   * commit watch (app/watchers/commits.js): a foreground shell's command the gate does not read as only reading, a
   * dashboard's button or an app's tool pressed — one the person kept as a tool that reads aside —, an MCP tool its
   * server does not vouch for. A command started in the background is none here: its time is the hands' to say, for
   * as long as it runs.
   * @param {any} u
   */
  const commands = (u) => {
    try {
      const s = judgedAs(u);
      if (isMcpTool(s.name)) return kindOf(s.name) !== "read";
      if (!FOREGROUND_SHELLS.has(s.name)) return false;
      if (s.input?.press) return !(s.input.press.tool === true && s.input.press.effect === "reads");
      return !readsOnly(String(s.input?.command ?? ""), s.name).ok;
    } catch {
      return true;
    }
  };
  /**
   * The files a call that runs says it writes as it starts (`edits`), for the keeper of a chat's own times
   * (app/watchers/own-times.js): a file hand's file, absolute, as the hands land it — `true` where its input names
   * none, or its path is past what a start carries (`editsSaid`). Null for a call that writes no file: a command's
   * while is `commands`' to say, and whatever it wrote is not known as it starts.
   * @param {any} u @returns {string[] | true | null}
   */
  const editsOf = (u) => {
    if (!WRITING_HANDS.has(u.name) || isCommandHand(u.name)) return null;
    try {
      const path = String(u.input?.path || u.input?.file_path || "");
      return path ? editsSaid([landingOf(root, path)]) : true;
    } catch {
      return true;
    }
  };
  /** The mode the newest judged call ran under; the turn began under the one in force at its start. */
  let modeSeen = modeNow();
  /**
   * The mode in force for the call about to be judged (HarnessV3-AtHome AH-F1): asked at each call, so a switch made
   * while the turn works reaches its next call. A change is said on the record once.
   */
  const modeHere = () => {
    const m = modeNow();
    if (m !== modeSeen) notes.push(`agent: the permission mode is ${m} now (it was ${modeSeen})`);
    modeSeen = m;
    return m;
  };
  /** The note for a call that ran on rules. @param {string} name @param {import("./rules.js").Rule} rule @param {import("./rules.js").Rule[]} [rules] */
  const ranOnRules = (name, rule, rules) => {
    const named = (rules && rules.length > 1 ? rules : [rule]).map(describeRule);
    return `agent: ${name} ran on the rule${named.length > 1 ? "s" : ""} ${named.join(" and ")}`;
  };
  /** A call answered without running: the model gets the words, the page a refused card. @param {any} u @param {string} text @param {string | null} rule */
  const refusedCall = (u, text, rule) => {
    emit({ type: "tool-start", round, name: u.name, args: argSummary(u.name, u.input), id: u.id, input: u.input });
    emit({ type: "tool-end", round, name: u.name, ok: false, ms: 0, id: u.id, chars: 0, refused: true, ...(rule ? { rule } : {}) });
    return errResult(u.id, text);
  };
  /** A call the developer's answer did not run: the model gets the words, the page a declined card. @param {any} u @param {string} text */
  const declinedCall = (u, text) => {
    emit({ type: "tool-start", round, name: u.name, args: argSummary(u.name, u.input), id: u.id, input: u.input });
    emit({ type: "tool-end", round, name: u.name, ok: false, ms: 0, id: u.id, chars: 0, declined: true });
    return errResult(u.id, text);
  };
  /**
   * What happens to one call before it runs: answered at once (`result`: not a loop tool, refused, not offered), a
   * pause for the developer (`pause`), a wait in place for their answer (`ask`: a team's worker's question), or cleared
   * to run (`run`: true when it runs on a learned permission).
   * @param {any} u
   * @param {import("../second-look.js").LookRef | null} [kept]  the second look that already reads this call (a switch
   *   judged it again while it waited): a review rule asks with it, and starts none
   * @param {string | null} [unstartable]  a thread call's: why its start is refused whatever the developer answers
   *   (thread-tool.js `refusal`) — it runs to that refusal, and nobody is asked for its folder
   * @returns {{ result: any } | { pause: { kind: PausedTurn["kind"], question: string, offer?: Offer, keeps?: import("./chat-always.js").Keeps, reason?: string, review?: string, look?: import("../second-look.js").LookRef } } | { ask: Shown & { question: string, review?: string, look?: import("../second-look.js").LookRef } } | { run: boolean }}
   */
  const admit = (u, kept = null, unstartable = null) => {
    // A call of memory's own tools reaches the loop only where the request offered none of them (the request runs them
    // where it did): said so, in the words the request says it in where the tick carried the recall tool alone.
    if (!isLoopTool(u.name)) return { result: errResult(u.id, isMemoryTool(u.name) ? MEMORY_TOOLS_OFF : "That tool is not available here; use the tools you were given or answer in text.") };
    if (notCallable && Object.hasOwn(notCallable, u.name)) {
      notes.push(`agent: ${u.name} refused in words — the run carries it so its tools stay the bytes the provider caches (a fork's copy of the main agent's, or the main agent's own report beside its graph), and may not call it`);
      return { result: refusedCall(u, notCallable[u.name], null) };
    }
    // A command on another machine (the remote-agents plan's c-tools): offered to a chat's own agent where this Filament
    // keeps a machine for its agents. This chat's mode is a ceiling — read-only, or a deny rule, refuses it here —, then
    // judges it there (runOne's `mode`), capped by that machine's grants, and an ask there waits on this run's card (`askThere`). An ask or a review
    // rule of this chat asks on that card first (runOne's `rule`), before anything is sent there. Where machine is
    // offered, cwd without it is refused; elsewhere it is no field of the tool's, and goes unread.
    if (u.name === "bash_background" && !onMachine(u.input) && machines && !machines.agentsChat && isOffered(u.name) && u.input?.cwd != null && String(u.input.cwd).trim()) {
      notes.push(`agent: ${u.name} refused — cwd with no machine`);
      return { result: refusedCall(u, CWD_HERE, null) };
    }
    if (u.name === "bash_background" && onMachine(u.input)) {
      const why = !machines || !isOffered(u.name) ? NOT_OFFERED_THERE : machines.agentsChat ? AGENTS_CHAT_THERE : modeHere() === "read-only" ? READ_ONLY_THERE : null;
      if (why) {
        notes.push(`agent: ${u.name} on ${onMachine(u.input)} refused — ${why.replace(/^Not run: /, "")}`);
        return { result: refusedCall(u, why, null) };
      }
      const hit = ruleFor(rules, u.name, subjectOf(u), here);
      if (hit?.verdict === "deny") {
        denied++;
        notes.push(`agent: ${u.name} on ${onMachine(u.input)} refused by the rule ${describeRule(hit.rule)}`);
        return { result: refusedCall(u, denialText(u.name, hit.rule, hit.subject), describeRule(hit.rule)) };
      }
      return { run: false };
    }
    const reads = readsOnce();
    // A worker in its own worktree stays in it whatever the mode (`fence`), ahead of its plan's review, the rules, the
    // gate and its brief's grants — as a coding agent's worker does, in the same words.
    const stray = fence ? strayed(u, fence, reads) : null;
    if (stray && fence) {
      notes.push(`agent: ${u.name} refused — ${strayWhy(stray, root, fence.folder)}`);
      return { result: refusedCall(u, strayWords(stray, root, fence.folder), null) };
    }
    // A dashboard's button pressed is judged as its command (SA-D4); a press runs in the project's folder, never a
    // worker's own worktree, so a worker held to its worktree presses none.
    const s = judgedAs(u);
    if (s.press && fence) {
      notes.push(`agent: ${u.name} refused — a dashboard's button runs in the project's folder, outside the worktree it works in`);
      return { result: refusedCall(u, pressSaid(PRESS_FENCED, s.input), null) };
    }
    // Its changes and commands wait for its lead's review of its plan (HarnessV3-TaskGraph-v2 TG2-D50), ahead of the
    // rules, the gate and its brief's grants, which let none of them run meanwhile; its reads run.
    if (planHeld?.() && changesOrRuns(s.name, kindOf(s.name), s.input)) {
      notes.push(`agent: ${u.name} refused — its plan waits for its lead's review (plan_review)`);
      return { result: refusedCall(u, PLAN_HELD, null) };
    }
    // A command that only sleeps while a background sub-agent runs is refused (runOne says why) — before the gate, so
    // nobody is asked about a call whose yes would not run it.
    if (FOREGROUND_SHELLS.has(s.name) && (plainSleepSeconds(s.input?.command) ?? 0) >= SLEEP_REFUSE_SECONDS && inbox?.owed?.()) {
      emit({ type: "tool-start", round, name: u.name, args: argSummary(u.name, u.input), id: u.id, input: u.input });
      emit({ type: "tool-end", round, name: u.name, ok: false, ms: 0, id: u.id, chars: SLEEP_REFUSAL.length, refused: true, reason: SLEEP_REFUSAL_REASON });
      return { result: errResult(u.id, SLEEP_REFUSAL) };
    }
    const hit = ruleFor(rules, s.name, subjectOf(s), here);
    const mode = modeHere();
    const verdict = judge(gateOf(mode, s, permissions ? permissions.allowed : null, reads), hit, s.name, s.input, reads);
    // A thread's folder asks in the thread's words, never a write's (`judgedAs`): where that write asks, and for a
    // folder no project holds yet where it would run unasked too, Full access aside (`folderVerdict`).
    const threadAsks = !!s.thread && folderVerdict(s.fresh === true, verdict.verdict, mode) === "ask";
    const judged = threadAsks
      ? /** @type {typeof verdict} */ ({ ...(verdict.verdict === "ask" ? verdict : {}), verdict: "ask", question: threadAskWords(u.input, String(s.thread), s.fresh === true) })
      : verdict;
    // An ask runs where the worker's brief grants the command (TG2-D44) — never one an ask rule speaks for, whether or
    // not the gate asked too: a deny rule and read-only have refused by now. A press is no command of the worktree's, and
    // a link the guard asks about is no grant's (agent/link-guard.js). The chat's own seat runs what the chat keeps
    // always allowed (d-allow), lifted exactly where a grant lifts.
    const lifts = judged.verdict === "ask" && !("links" in judged && judged.links) && !asksFirst(hit) && !s.press;
    const granted = lifts ? grantOf(u, reads) : null;
    const chats = lifts && !granted ? keptRun(u, reads) : null;
    /** @type {typeof judged} */
    const g = granted ? { verdict: "run", grant: granted } : chats ? { verdict: "run", kept: chats } : judged;
    if (g.verdict === "refuse") {
      const ours = g.text === FOLDER_REFUSAL;
      notes.push(g.rule ? `agent: ${u.name} refused by the rule ${describeRule(g.rule)}` : ours ? `agent: ${u.name} refused — ${FOLDER_NOTE}` : `agent: ${u.name} refused (${mode} mode)`);
      if (g.rule) denied++;
      return { result: refusedCall(u, s.press && !g.rule && !ours ? pressSaid(PRESS_READ_ONLY, s.input) : g.text, g.rule ? describeRule(g.rule) : null) };
    }
    // A loop tool the session did not offer — switched off by `loop.tools`, a web hand it did not switch on — is
    // answered, never run or asked about: the offered set is the contract. (Read-only's missing hands are refused
    // above, in the gate's words.)
    if (!isOffered(u.name)) {
      notes.push(`agent: ${u.name} was called but is not offered in this session`);
      return { result: errResult(u.id, "That tool is not available here; use the tools you were given or answer in text.") };
    }
    if (g.verdict === "run" && g.learned) {
      learnedRuns++;
      notes.push(`agent: ${u.name} ran on a learned permission`);
    }
    if (g.verdict === "run" && g.readOnly) notes.push(`agent: ${u.name} ran without asking — it only reads`);
    if (g.verdict === "run" && g.grant && grants) notes.push(`agent: ${u.name} ran on ${grantedBy(grants.list, g.grant)}`);
    if (g.verdict === "run" && g.kept) notes.push(`agent: ${u.name} ran on ${alwaysWords(g.kept)}`);
    if (g.verdict === "run" && g.rule) {
      ruleRuns++;
      notes.push(ranOnRules(u.name, g.rule, g.rules));
    }
    if (g.verdict === "ask" && s.thread && unstartable) {
      notes.push(`agent: ${u.name} not asked about — its start is refused whatever the answer (${unstartable})`);
      return { run: false };
    }
    if (g.verdict === "ask") {
      // A review rule (HarnessV4_Space_Plan SG-D13) asks with a second look first, and offers no Always allow.
      const review = g.review && g.rule ? describeRule(g.rule) : null;
      if (asker) return { ask: { question: g.question, ...shownOf(u, g), ...(review ? { review, look: kept || lookAt(u, g) } : {}) } };
      if (unattended) {
        notes.push(`agent: ${u.name} refused — it needs approval, and ${NOBODY_ANSWERS[unattended]}`);
        return { result: refusedCall(u, unattendedAsk(s.press ? (s.input?.press?.tool ? "running an app's tool" : "pressing a dashboard's button") : u.name, g.why, unattended), g.rule ? describeRule(g.rule) : null) };
      }
      const offer = review ? null : offerFor(u);
      const shown = shownOf(u, g);
      // One always-row a card (d-allow): where the project offers none for the call's shape, the chat's own — what a
      // press would keep of the command, for the chat's own seat.
      const mine = !offer && !review && a.alwaysRun ? a.alwaysRun() : null;
      const keeps = mine ? keepsFor(s, g, hit, { kept: mine, shown: shown.command ?? null, at: here, readsOnly: (part) => reads(part, s.name) }) : null;
      const look = review ? kept || lookAt(u, g) : null;
      emit({ type: "ask", round, kind: "permission", tool: u.name, question: g.question, ...shown, ...(offer ? { offer } : {}), ...(keeps ? { keeps } : {}), ...(review ? { review } : {}), ...(look ? { look } : {}) });
      notes.push(`agent: paused for permission to ${u.name}${review ? `, with a second look (the rule ${review})` : ""}`);
      return { pause: { kind: "permission", question: g.question, ...(shown.reason ? { reason: shown.reason } : {}), ...(offer ? { offer } : {}), ...(keeps ? { keeps } : {}), ...(review ? { review } : {}), ...(look ? { look } : {}) } };
    }
    if (u.name === "ask") {
      // The harness draws the question and its choices apart (TL-D11); the reply lists the choices for any client.
      const q = askOf(u.input);
      emit({ type: "ask", round, kind: "question", tool: "ask", question: q.question, ...(q.options.length ? { options: q.options } : {}) });
      notes.push(`agent: paused on a question to the developer${q.options.length ? ` (${q.options.length} choices)` : ""}`);
      return { pause: { kind: "ask", question: askText(q) } };
    }
    // A thread's folder the mode runs unasked: settled, with nobody's yes.
    if (s.thread) threadFolder.set(String(u.id), { asked: false });
    return { run: g.verdict === "run" && !!g.learned };
  };
  /**
   * Whether a call only reads, so that it may run beside the reads next to it in its reply (`runTools`): a file read,
   * search or listing, a fetch or a search of the web, a read delegated to the reader model, an MCP tool its server
   * vouches for as read-only. @param {any} u
   */
  const onlyReads = (u) => SIDE_BY_SIDE.has(u.name) || kindOf(u.name) === "read";
  /**
   * Run the tools of one reply in order — except that consecutive `agent` calls run side by side, each a whole
   * sub-agent, and so do consecutive reads (`onlyReads`), up to READS_AT_ONCE. Results come in the order the calls end,
   * and take the reply's order where they are sent
   * (`inReplyOrder`). Returns them, or a pause when a call needs the developer: the calls admitted before it (a
   * concurrent batch included) finish first, the rest wait with the pause.
   * @param {any[]} uses @param {any[]} results @param {number} from
   * @returns {Promise<{ results: any[], pause: PausedTurn | null, question?: string, stop: boolean, cut?: boolean }>}
   *   `cut`: a stop from the harness landed — the calls not started are answered "Not run", and the turn ends stopped
   */
  /**
   * The calls a stop came before: each answered "Not run", and drawn live as a reload draws it — a Stopped stub,
   * counted as the archive counts it (HarnessV3-FixRound F2 item 12; they used to be missing until a reload). `text`:
   * the words, the hang-up's when that came before them.
   * @param {any[]} uses @param {string} [text]
   */
  const notRun = (uses, text = NOT_RUN) =>
    uses.map((u) => {
      emit({ type: "tool-start", round, name: u.name, args: argSummary(u.name, u.input), id: u.id, input: u.input });
      emit({ type: "tool-end", round, name: u.name, ok: false, ms: 0, id: u.id, chars: 0, stopped: true, notRun: true });
      return errResult(u.id, text);
    });
  /**
   * The developer's answer to a call that asked. Their press (`allow`, never read from their words) runs it under the
   * document as it stands now — a deny added while
   * the question waited, the session gone read-only, or the tool switched off since, wins over the yes, and the result
   * says so, so the model does not read it as a whim. Anything else answers it "Not run", in their words. A yes counts
   * towards the learned permission; its offer becomes a closing line of the reply where the developer reads the reply
   * (`offerLine`) — a worker's reply is its lead's to read, so its offer is the page's alone. A worker's lead answers
   * as the developer does (`by`, HarnessV3-TaskGraph-v2 TG2-D41), in its own name, and its yes is no learned one. Nor is
   * a yes to a review rule's ask (`review`, HarnessV4_Space_Plan SG-D13): its card offers no Always allow, so its yes
   * counts towards none — five force-pushes allowed would otherwise offer every `git push`.
   * A dashboard's button pressed (SA-D4) is judged as its command again, and runs only where what it runs now is what
   * was asked (`asked`, the question): a row read again while the question waited may fill it otherwise.
   * @param {any} p @param {string} answer @param {{ allow: boolean, offerLine: boolean, by?: "lead", review?: boolean, asked?: string }} o
   */
  const answered = async (p, answer, { allow, offerLine, by, review = false, asked = "" }) => {
    const who = by === "lead" ? "your lead" : "the developer";
    const whose = by === "lead" ? "its lead" : "the developer";
    if (!allow) {
      notes.push(`agent: ${whose} declined ${p.name}`);
      return declinedCall(p, `Not run: ${who} declined — "${String(answer || "").slice(0, 1500)}". Weigh that before proposing it again.`);
    }
    const s = judgedAs(p);
    if (s.press && asked && !asked.includes(String(s.input?.press?.runs ?? ""))) {
      notes.push(`agent: ${whose} allowed ${p.name}, but the row changed while it waited: what the button runs now was not asked`);
      return refusedCall(p, pressSaid(PRESS_MOVED, s.input), null);
    }
    const hit = ruleFor(rules, s.name, subjectOf(s));
    const g = gateOf(modeHere(), s, null);
    if (hit?.verdict === "deny") {
      denied++;
      notes.push(`agent: ${whose} allowed ${p.name}, but the rule ${describeRule(hit.rule)} refuses it now`);
      emit({ type: "tool-start", round, name: p.name, args: argSummary(p.name, p.input), id: p.id, input: p.input });
      emit({ type: "tool-end", round, name: p.name, ok: false, ms: 0, id: p.id, chars: 0, refused: true, rule: describeRule(hit.rule) });
      return errResult(p.id, denialText(p.name, hit.rule, hit.subject, `Not run: ${who} said yes, but`));
    }
    if (g.verdict === "refuse" && g.text === FOLDER_REFUSAL) {
      notes.push(`agent: ${whose} allowed ${p.name}, but ${FOLDER_NOTE}`);
      return refusedCall(p, g.text.replace(/^Not run: /, `Not run: ${who} said yes, but `), null);
    }
    if (g.verdict === "refuse") {
      notes.push(`agent: ${whose} allowed ${p.name}, but this session is read-only now`);
      if (p.name === BROWSER) return refusedCall(p, g.text.replace(/^Not run: /, `Not run: ${who} said yes, but `), null);
      if (s.press) return refusedCall(p, pressSaid(PRESS_READ_ONLY, s.input).replace(/^Not (pressed|run): /, (_, w) => `Not ${w}: ${who} said yes, but `), null);
      return refusedCall(p, by === "lead" ? readOnlyRefusal(p.name, { why: g.why }).replace(/^Not run: /, "Not run: your lead said yes, but ") : readOnlyRefusal(p.name, { yes: true, why: g.why }), null);
    }
    if (!isOffered(p.name)) {
      notes.push(`agent: ${whose} allowed ${p.name}, but it is no longer offered in this session`);
      return errResult(p.id, `Not run: ${who} said yes, but that tool is no longer available here; use the tools you were given or answer in text.`);
    }
    notes.push(`agent: ${whose} allowed ${p.name}`);
    // A yes to a press is a yes to what it runs now, and to this call alone (SA-D4).
    if (s.press) pressYes.set(String(p.id), String(s.input?.press?.runs ?? ""));
    // A yes to acting on a site in the browser holds for the chat (HarnessV4_Browser_Plan BR-D6); the pane's ⋯ takes it back.
    // A lead's holds for its team's workers alone: an AI's yes is none for the chat's other agents (the bug hunt of 10-30,
    // LOOP-2).
    const site = p.name === BROWSER && a.browser ? actingSite(p.input, a.browser.page()) : "";
    if (site && a.browser) {
      a.browser.allow(site, by === "lead");
      notes.push(by === "lead" ? `agent: the browser may act on ${site} for the rest of this chat, for its team's workers — its lead said yes` : `agent: the browser may act on ${site} for the rest of this chat`);
    }
    // A yes to a thread's folder is a yes to that start alone (`threadFolder`): no write's, and never learned.
    if (s.thread) {
      threadFolder.set(String(p.id), { asked: true });
      notes.push(`agent: ${whose} allowed a thread in ${s.thread}, this once`);
      return runOne(p);
    }
    // A yes to a write outside the chat's folder is a yes to that write alone, and is never learned
    // (HarnessV4_SpacesPlugins_Plan A2b).
    if (g.verdict === "ask" && "outside" in g && g.outside) {
      outsideYes.add(String(p.id));
      notes.push(`agent: ${whose} allowed a write outside this chat's folder, this once`);
      return runOne(p);
    }
    if (by === "lead") return runOne(p);
    if (review) {
      notes.push(`agent: a yes to a review rule's ask counts towards no always-allow`);
      return runOne(p);
    }
    const learned = permissions ? permissions.recordAllow(s.name, s.input) : null;
    if (learned?.offered) {
      emit({ type: "permission-offer", round, tool: s.name, shape: learned.shape.shape, count: learned.count, itemId: learned.offered.id });
      notes.push(`agent: an always-allow for "${learned.shape.text}" was offered (memory item ${learned.offered.id}, inferred)`);
      if (offerLine) closing.push(`(Filament: ${offerText(learned.shape, learned.count)})`);
    }
    return runOne(p);
  };
  /**
   * A review rule's second look at a call (HarnessV4_Space_Plan S3b): the Reviewer starts on it in this chat, told the
   * command whole and why it asks; where it cannot, why, which the card says.
   * @param {any} u @param {{ rule?: import("./rules.js").Rule, why?: string }} g
   * @returns {import("../second-look.js").LookRef}
   */
  const lookAt = (u, g) => {
    if (!a.secondLook) return { error: "this chat runs no agents of Filament's" };
    // A press's look reads the button's command (SA-D4).
    const c = judgedAs(u);
    const command = shownCommand(c.name, c.input) || `${c.name} ${argSummary(c.name, c.input)}`;
    return a.secondLook.start({ command, folder: root, why: `the rule ${g.rule ? describeRule(g.rule) : "review"} asks for a second look${g.why ? `, and ${g.why}` : ""}` });
  };
  /** A second look that may still read, stopped: its call is answered. @param {import("../second-look.js").LookRef | null | undefined} look */
  const endLook = (look) => {
    if (look && "agent" in look) a.secondLook?.stop(look);
  };
  /**
   * The always-allow still waiting for a call's shape (HarnessV3-Views V3): its question carries it. None for a
   * thread's folder, whose yes is that start's alone. @param {any} u
   */
  const offerFor = (u) => {
    const c = judgedAs(u);
    return c.thread ? null : permissions?.offered(c.name, c.input) || null;
  };
  /** @typedef {{ command?: string, reason?: string, changes?: import("../../core/types.js").FileChange[] }} Shown */
  /**
   * What a card shows of a call that asks, beside the question's words (HarnessV3-Views V6-9): a command whole — the
   * question cuts it at 160 characters — and why it asks, apart from it; a change to a file as its diff (HarnessV3-ACP,
   * AC3's drive D5).
   * @param {any} u @param {{ why?: string }} g  the gate's verdict
   * @returns {Shown}
   */
  const shownOf = (u, g) => {
    // A press shows the button's command whole (SA-D4).
    const c = judgedAs(u);
    const command = shownCommand(c.name, c.input);
    const reason = command ? commandReason(c.name, g.why) : null;
    const change = shownChange(c.name, c.input, root);
    return { ...(command ? { command } : {}), ...(reason ? { reason } : {}), ...(change ? { changes: [change] } : {}) };
  };
  /**
   * A team's worker's call that asks (HarnessV3-AtHome P2): it waits in place for the developer's answer — the run's
   * state says what it waits on, and no pause ends the run — then the answer runs it or answers it. The wait ends
   * unanswered on the run's stop or its hang-up: the call is not run, and the turn ends on the stop. A permission
   * switch answers it as it answers the session's own waiting call (AH-F1): the call is judged again under the mode
   * now in force. A worker asks no questions and gives no orders, so it is answered, asks again, or runs. A command is
   * shown whole, and as it runs: a worker's cd into its own worktree first takes it nowhere (HarnessV3-Views V6-9).
   * @param {any} u @param {Shown & { question: string, review?: string, look?: import("../second-look.js").LookRef }} ask
   * @returns {Promise<any>}
   */
  const askInPlace = async (u, { question, command, reason, changes, review, look }) => {
    const args = argSummary(u.name, u.input);
    // A review rule asks with its second look, and never offers Always allow (SG-D13).
    const offer = review ? null : offerFor(u);
    const runs = command ? asItRuns(command, u.name, here) : "";
    const shown = { ...(command ? { command } : {}), ...(runs && runs !== command ? { runs } : {}), ...(reason ? { reason } : {}), ...(changes?.length ? { changes } : {}), ...(review ? { review } : {}), ...(look ? { look } : {}) };
    emit({ type: "ask", round, kind: "permission", tool: u.name, question, ...shown, waits: true, ...(offer ? { offer } : {}) });
    notes.push(`agent: ${u.name} waited for the developer's answer`);
    const was = state;
    go("waiting", `the developer's answer — may it run ${u.name} \`${args}\`?`);
    const answer = await /** @type {NonNullable<typeof asker>} */ (asker)({ tool: u.name, args, question, ...shown, ...(offer ? { offer } : {}) }, cut || new AbortController().signal);
    go(was, answer == null ? "no answer: the wait was cut" : answer.modeSwitch ? "the developer switched the mode" : answer.by === "lead" ? "its lead answered" : answer.by === "filament" ? "Filament answered: not now" : "the developer answered");
    if (!answer?.modeSwitch) endLook(look);
    if (answer == null) return notRun([u])[0];
    if (answer.by === "filament") return refusedCall(u, answer.text, null);
    if (!answer.modeSwitch) return answered(u, answer.text, { allow: answer.allow === true, offerLine: false, review: !!review, asked: question, ...(answer.by ? { by: answer.by } : {}) });
    notes.push(`agent: the developer switched the mode to ${modeNow()} while ${u.name} waited — judged again under it`);
    const v = admit(u, look || null);
    if (!("ask" in v)) endLook(look);
    return "result" in v ? v.result : "ask" in v ? askInPlace(u, v.ask) : runOne(u, "run" in v && v.run);
  };
  /**
   * A command on another machine whose mode asks there, or a rule of this chat that asks first (`q.rule`) (the
   * remote-agents plan's c-tools): the call waits in place, on a permission card in this chat that names the machine and
   * the command (remote-commands.js `thereForm`), for the person's press. This chat's mode answers nothing there: a
   * switch while it waits waits on — but to read-only, which denies it. The run's stop, or the start's own end (`gone`:
   * answered there, `ANSWERED_THERE`, or its stream gone), ends the wait unanswered (null).
   * @param {any} u @param {import("./remote-commands.js").ThereAsk} q @param {AbortSignal} gone
   * @returns {Promise<{ allow: boolean, words: string } | null>}
   */
  /** This chat's ask or review rule that speaks for a command on another machine, as describeRule says it, or null. @param {any} u */
  const thereRule = (u) => {
    const hit = ruleFor(rules, u.name, subjectOf(u), here);
    return asksFirst(hit) ? describeRule(/** @type {any} */ (hit).rule) : null;
  };
  const askThere = async (u, q, gone) => {
    const there = /** @type {NonNullable<typeof machines>} */ (machines);
    const id = `there-${++thereCards}`;
    const form = thereForm(q, { tool: u.name, call: String(u.id) });
    emit({ type: "ask", round, kind: "permission", id, call: String(u.id), form, waits: true });
    const was = state;
    go("waiting", `the developer's answer — may ${u.name} run on ${q.machine}?`);
    const ends = cut ? AbortSignal.any([cut, gone]) : gone;
    /** @type {any} */
    let answer = null;
    /** @type {{ allow: boolean, words: string } | null} */
    let reply = null;
    for (;;) {
      answer = await there.answer(id, { check: (x) => checkAnswer(form, x), signal: ends });
      const r = thereReply(answer);
      if (r !== "switched") {
        reply = r;
        break;
      }
      if (modeHere() !== "read-only") continue;
      reply = { allow: false, words: "" };
      answer = { outcome: "answered", answers: { permission: { chosen: ["deny"] } }, reason: "this chat is read-only now" };
      break;
    }
    // Settled on that machine — allowed there by its own person or the device that started it, or its exec ended there:
    // the card leaves this chat, saying so.
    const elsewhere = reply || !gone.aborted ? "" : gone.reason === ANSWERED_THERE ? "answered" : gone.reason === ENDED_THERE ? "ended" : "";
    emit({ type: "ask-end", round, id, call: String(u.id), outcome: answer?.outcome ?? "cancelled", words: elsewhere ? [`${elsewhere === "answered" ? "Answered" : "Ended"} on ${q.machine}`] : answerWords(form, answer), ...(elsewhere ? { there: q.machine } : {}) });
    go(was, elsewhere ? `${elsewhere} on ${q.machine}` : !reply ? "no answer: the wait was cut" : reply.allow ? `the developer allowed it on ${q.machine}` : `the developer denied it on ${q.machine}`);
    notes.push(`agent: ${u.name} asked on ${q.machine} (${q.rule ? `the rule ${q.rule} here` : `${q.mode} mode there`}) — ${elsewhere ? `${elsewhere} on ${q.machine}` : !reply ? "no answer, the wait was cut" : reply.allow ? "the developer allowed it" : "the developer denied it"}`);
    return reply;
  };
  const runTools = async (uses, results, from) => {
    roundResults = results;
    // The reply's calls as this run takes them: one whose pre-tool hooks ran in a batch cut short goes on as they left it.
    const calls = [...uses];
    let i = from;
    while (i < calls.length) {
      // Every tool_use keeps its result, or the archived trajectory (and the next turn's history, a sub-agent's
      // follow-up's) carries an open call its provider refuses (the bug report's P5: a hang-up left them open).
      if (aborted()) {
        results.push(...notRun(calls.slice(i), NOT_RUN_GONE));
        return { results, pause: null, stop: true };
      }
      if (stopCut()) {
        results.push(...notRun(calls.slice(i)));
        return { results, pause: null, stop: false, cut: true };
      }
      let end = i + 1;
      if (calls[i].name === "agent") while (end < calls.length && calls[end].name === "agent") end++;
      // A reply's consecutive reads run side by side too, as Claude Code runs them — up to READS_AT_ONCE (the owner's
      // word of 10-27: "It reads one file at a time. Make it work like claude to read in batches"); a call that changes
      // or runs something waits for them, and the ones after it for it.
      else if (onlyReads(calls[i])) while (end < calls.length && end - i < READS_AT_ONCE && onlyReads(calls[end])) end++;
      // The batch's pre-tool hooks run side by side, as its calls do, and once for a call (`hooksRan`): each call is
      // judged in the reply's order once its own and those before it have run — the call as its hooks leave it is what
      // the rules, the gate and the developer judge, and what runs. Each is awaited in its turn below; one that fails
      // before then is not left unheard meanwhile.
      const pre = calls.slice(i, end).map((u) => (preHooked(u) && !u.hooksRan ? hooked(u) : Promise.resolve({ call: u })));
      for (const p of pre) p.catch(() => {});
      // Each result joins the round's as it comes back, not when the batch's last one does: a Force stop while others
      // run keeps the calls that finished (the bug report's H6).
      /** @type {Promise<any>[]} */
      const running = [];
      /** @type {{ at: number, call: any, kind: PausedTurn["kind"], question: string, offer?: Offer, keeps?: import("./chat-always.js").Keeps, reason?: string } | null} */
      let paused = null;
      /** Where the batch was cut short: the calls from here on wait for a later pass, or the pause. */
      let cut = end;
      for (let k = i; k < end; k++) {
        const h = await pre[k - i];
        if ("result" in h) {
          running.push(Promise.resolve(h.result).then((r) => void results.push(r)));
          // A stop that landed while the hooks ran: this call and the rest are not run.
          if (h.stop) {
            cut = k + 1;
            break;
          }
          continue;
        }
        const u = h.call;
        // Why a thread's start is refused whatever the developer answers (its limit, its model, a thread's own),
        // read before `admit` would ask them for its folder: one that cannot be read leaves the asking to `admit`.
        const unstartable = u.name === THREAD && a.thread?.refusal ? await a.thread.refusal(u.input).catch(() => null) : null;
        const v = admit(u, null, unstartable);
        if ("pause" in v) {
          paused = { at: k, call: u, ...v.pause };
          cut = k + 1;
          break;
        }
        // A call that waits in place for an answer (a worker's, a sub-agent's) ends the batch: one question at a time —
        // a worker's question has one place to wait in (the Hunter's find of 10-27: two reads that asked at once took
        // the same place, and the first never came back). The reads after it wait for its answer.
        if ("ask" in v) {
          running.push(askInPlace(u, v.ask).then((r) => void results.push(r)));
          cut = k + 1;
          break;
        }
        const one = "result" in v ? Promise.resolve(v.result) : runOne(u, v.run);
        running.push(one.then((r) => void results.push(r)));
      }
      // The batch's calls past the cut ran their hooks with it: one they answered — a block, a refusal, a stop's Not run
      // — has its result, and one they let through waits as they left it, its hooks not to run again.
      /** @type {any[]} */
      const left = [];
      for (let k = cut; k < end; k++) {
        const h = await pre[k - i];
        if ("result" in h) results.push(h.result);
        else left.push(preHooked(calls[k]) && !calls[k].hooksRan ? { ...h.call, hooksRan: true } : h.call);
      }
      calls.splice(cut, end - cut, ...left);
      await Promise.all(running);
      if (paused) return { results, pause: parkedFor(paused, paused.call, calls.slice(paused.at + 1), results), question: paused.question, stop: false };
      i = cut;
    }
    return { results, pause: null, stop: false, cut: stopCut() };
  };
  /**
   * The state parked while the developer answers. The folder and the reader are pinned with it: the answer continues
   * the turn the question was asked in, whatever the next request's headers or the settings say. The mode is not: the
   * resumed turn runs under the one in force (HarnessV3-AtHome AH-F1).
   * @param {PausedTurn["kind"]} kind @param {any} pending @param {any[]} remaining @param {any[]} results
   * @returns {PausedTurn}
   */
  // `workFrom` points at the reply that is waiting: its tool results land after the answer, so that reply and what
  // follows belong to the resumed turn. A message the developer typed while the round's tools ran is taken now and
  // parked with the notes heard before them, to ride with the answer's results: left in the mailbox, the run's end
  // would mark it unread and the model would never see it. A stop, a veto or a Compact stays there, and is said unread.
  // A note a fork still weighs aside goes with them unweighed: the fork ends with the turn.
  const parked = (kind, pending, remaining, results) => {
    mailbox?.unweigh?.("the turn paused for your answer before its fork weighed it");
    if (mailbox) heard = [...heard, ...mailbox.read((m) => m.kind === "note")];
    return { kind, convo, results, pending, remaining, round, plan, root, readerModel, heard, baseLen, workFrom: convo.length - 1, subagentWrote: [...subagentWrote], wrote: wroteThisTurn, unread: unreadWrites(), changed: [...changedFiles], supervise: reads };
  };
  /**
   * The pause `admit` asked for, parked: a permission's always-allow (HarnessV3-Views V3) or the chat's own (d-allow),
   * the reason it asks (V6-9), and a review rule's second look (HarnessV4_Space_Plan S3b) ride it.
   * @param {{ kind: PausedTurn["kind"], offer?: Offer, keeps?: import("./chat-always.js").Keeps, reason?: string, review?: string, look?: import("../second-look.js").LookRef }} pause @param {any} pending @param {any[]} remaining @param {any[]} results
   * @returns {PausedTurn}
   */
  const parkedFor = (pause, pending, remaining, results) => ({ ...parked(pause.kind, pending, remaining, results), ...(pause.offer ? { offer: pause.offer } : {}), ...(pause.keeps ? { keeps: pause.keeps } : {}), ...(pause.reason ? { reason: pause.reason } : {}), ...(pause.review ? { review: pause.review } : {}), ...(pause.look ? { look: pause.look } : {}) });
  /** Steering notes read at a decision point and owed to the model at the next boundary — parked with a pause. @type {any[]} */
  let heard = [];
  /** The newest round's results so far (`runTools` fills it): what a Force stop keeps of the round. @type {any[]} */
  let roundResults = [];
  /** One hook's outcome onto the run, the notes and the result. @param {import("./hooks.js").HookOutcome} o */
  const noteHook = (o) => {
    hookOutcomes.push(o);
    emit({ type: "hook", round, on: o.on, ...(o.tool ? { tool: o.tool } : {}), command: o.command, ms: o.ms, exit: o.exit, verdict: o.verdict, ...(o.note ? { note: o.note.slice(0, 1000) } : {}), ...(o.args ? { rewrote: true } : {}), ...(o.timedOut ? { timedOut: true } : {}), ...(o.builtin ? { builtin: o.builtin } : {}), ...(o.plugin ? { plugin: o.plugin } : {}) });
    notes.push(`hook: ${describeHook(o)}`);
  };
  /** The files written this turn and not read back since. */
  const unreadWrites = () => [...written.entries()].filter(([p, at]) => (readAt.get(p) ?? -1) < at).map(([p]) => p);
  // ---- the compaction line, mid-turn (§6.8 for the loop) ----------------------------------------------------------------
  // The work's rounds as text for the summarizer: what was said, what was called, what came back — capped per
  // piece, because the transcript's job is to carry decisions and state, not bulk. An earlier fold's summary is the
  // one piece kept whole (a summary's own size bounds it): it already IS the compressed form of older rounds, and
  // re-cutting it would lose facts the next summary is supposed to carry forward. It is said for what it is, without
  // its lead's word to the model that continues (HarnessV3-AtHome AH-D9 c). Each round goes by its number in the turn.
  // Words are not bulk: a message from the developer, the lead or the planner, and a sub-agent's report — delivered, or
  // the result of the call that ran it or opened its envelope — are what a summary is for, and go up to REPORT_CHARS.
  /** @param {number} from @param {number} to indices into `convo` @param {number} first the round `from` opens */
  const transcriptOfWork = (from, to, first) => {
    /** @type {string[]} */
    const lines = [];
    /** The calls these rounds made, by id: a result is cut by what made it. @type {Map<string, string>} */
    const callNames = new Map();
    let r = first - 1;
    for (let i = from; i < to; i++) {
      const m = convo[i];
      const blocks = Array.isArray(m?.content) ? m.content : [{ type: "text", text: String(m?.content ?? "") }];
      if (m?.role === "assistant") {
        r = roundAfter(r + 1, 0);
        const said = blocks.filter((b) => b?.type === "text").map((b) => b.text).join(" ").trim();
        lines.push(`## Round ${r}` + (said ? `\nAssistant: ${said.slice(0, 2000)}` : ""));
        for (const b of blocks)
          if (b?.type === "tool_use") {
            callNames.set(String(b.id), String(b.name));
            lines.push(`Tool call ${b.name}: ${JSON.stringify(b.input ?? {}).slice(0, 300)}`);
          }
      } else {
        for (const b of blocks) {
          if (b?.type === "tool_result") {
            const t = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((/** @type {any} */ x) => x?.text ?? "").join(" ") : "";
            const words = REPORTING_CALLS.has(callNames.get(String(b.tool_use_id)) || "");
            lines.push(`Result${b.is_error ? " (error)" : ""}: ${String(t).slice(0, words ? REPORT_CHARS : 1000)}`);
          } else if (b?.type === "text" && String(b.text).trim()) {
            const s = String(b.text);
            // What came back after an earlier summary is no work of these rounds: it comes back again after this one.
            if (blockFiles(s) !== null) continue;
            // A look at the lead's workers is no work of these rounds either: the next look brings the picture back.
            if (lookOf(s) !== null) continue;
            const earlier = roundsSummaryOf(s);
            lines.push(earlier !== null ? earlierRounds(earlier) : `Note: ${s.slice(0, saysWords(s) ? REPORT_CHARS : 500)}`);
          }
        }
      }
    }
    return lines.join("\n");
  };
  /** The round the work opens with: a resumed turn's work starts at the reply that asked, round `paused.round`. */
  const workFirst = a.resume ? a.resume.paused.round : 1;
  /**
   * The rounds that left the conversation, by number (HarnessV3-TaskGraph-v2 TG2-D24: a wait a lead answered a look
   * with, and that wait's answer). They still count — in the turn's rounds, its spend, its run log — and wherever the
   * rounds the conversation holds are numbered, they are stepped over.
   * @type {Set<number>}
   */
  const gone = new Set();
  /** The number of the round `k` rounds after `first`, among those the conversation still holds. @param {number} first @param {number} k */
  const roundAfter = (first, k) => {
    let n = first;
    while (gone.has(n)) n++;
    for (let i = 0; i < k; i++) {
      n++;
      while (gone.has(n)) n++;
    }
    return n;
  };
  /** The oldest round of the work still whole: the next fold takes the rounds from it on. */
  let firstWhole = workFirst;
  /** This run folded: its head (`roundsHead`) opens the work, the model's line and the summary, and is no round. */
  let headed = false;
  /** The conversation's estimated size after the last compaction: where it landed, which the next fold at the line
   * measures the turn's growth from. */
  let lastCompactAfter = 0;
  /** Set when a fold at the line left the conversation at or past the line: folding again this turn can only repeat
   * that (the history's bulk sits beneath the summary head, out of this turn's reach) — the next message's compaction
   * takes the whole history instead of a summarizer call per round. The window's own fold is not stood down. */
  let compactStoodDown = false;
  /** The earlier turns gave way in this turn, or were asked to (HarnessV4_Tasks C33): once a turn. */
  let earlierTried = false;
  /** They gave way: the turn's result says where its conversation starts now (`history`). */
  let gaveWay = false;
  /** One overflow recovery per turn: a round the provider refused for size is cleared, compacted and retried once. */
  let overflowRetried = false;
  /** A round refused for a thinking block bound to an earlier form of the conversation is sent again once, without them. */
  let unboundRetried = false;
  /** Set by the image recovery (HarnessV3-Tools TL-D17): the line that stands in for every image a tool shows for the
   * rest of the turn. Once it is set no tool result carries an image, and no picture the developer sends into the
   * turn is sent as one, so the recovery cannot run twice. `refusedSaid`: the provider's words of that refusal. */
  let imagesRefused = "";
  let refusedSaid = "";
  /** The steering messages whose pictures the conversation holds (their ids): the ones a refusal takes back. */
  const pictured = [];
  /** Set once a round's max_tokens was clamped to what remains of the window, so the clamp is said in words once. */
  let capNoted = false;
  /** The room the round's model call last asked for (`roundCap`): what a reply that stops at max_tokens was cut at. */
  let capAsked = maxTokens;
  /** A reply cut at its ceiling whose round ran nothing (HarnessV3-TaskGraph-v2 TG2-D62): its round and its cut. Another
   *  such cut in the very next round ends the turn; a round between them starts the count again.
   *  @type {{ round: number, cut: ReturnType<typeof cutReply> } | null} */
  let idleCut = null;
  /**
   * Compact the turn's oldest work rounds into one summary block — the composer's line compaction,
   * applied mid-turn — leaving the last `keepRecent` rounds raw. One deliberate prefix rewrite: the provider's
   * cache rebuilds from the summary on; the alternative is the turn dying on the provider's size limit. Returns
   * "compacted"; "little" when too few rounds exist to compact under this keepRecent (the caller may retry with
   * a smaller keep); "empty" when the summarizer came back with nothing (no retry — the transcript only grows, a
   * second call would cost the same stall for the same nothing); "cut" when a stop or the hang-up came while it wrote
   * — a fork waiting to try again (AH-F4) — and the caller ends the turn.
   * `keepRecent` 0: every round of the work folds, its newest results too — a side agent's own compaction (`self`).
   * @param {number} keepRecent @param {any} compactArg the loop's compaction config
   * @param {"line" | "overflow" | "manual"} [door] who asked: the compaction line, the overflow recovery, or the developer
   *   (a `compact` steer — the harness's Compact during a running turn, BUG-21)
   * @returns {Promise<"compacted" | "little" | "empty" | "cut">}
   */
  const compactWork = async (keepRecent, compactArg, door = "line") => {
    // The rounds are the replies after this run's head: its line stands for rounds folded already (the bug report's
    // L1). They are numbered from the work's first round, not read off the loop's counter, which runs a round ahead at
    // the overflow door, and the first is no round 1 in a resumed turn's work (L2).
    const opens = [];
    for (let i = headed ? workFrom + 2 : workFrom; i < convo.length; i++) if (convo[i]?.role === "assistant") opens.push(i);
    if (opens.length <= keepRecent || !opens.length) return "little";
    const upTo = keepRecent > 0 ? opens[opens.length - keepRecent] : convo.length;
    const fromRound = firstWhole;
    const toRound = roundAfter(fromRound, opens.length - keepRecent - 1);
    emit({ type: "compacting", round });
    // Its pre-compact hooks are told first, as Claude's PreCompact is: they block nothing.
    if (hooks?.preCompact) for (const o of await hooks.preCompact(door === "manual" ? "manual" : "auto", round)) noteHook(o);
    const said = saidWaits(`compacting rounds ${fromRound}–${toRound}`);
    const got = await compactArg.summarize(transcriptOfWork(headed ? workFrom + 1 : workFrom, upTo, fromRound), { convo, weights, sending, keep: keepRecent, fromRound, toRound, door, signal: cut, onWait: said.retry, onQueue: said.queue });
    const summary = String(got?.text || "").trim();
    if (!summary && (aborted() || stopCut())) return "cut";
    if (!summary) return "empty";
    const before = weighConvo(convo, compactArg, weights);
    // What comes back after the summary (HarnessV3-AtHome AH-D9 b), read once the summary is written: the files the
    // folded rounds read, wrote or edited, newest first, then those an earlier fold's block brought back — less what
    // the kept rounds show — the turn's plan while it is live, unless a kept round shows it, and the task graph while it
    // has open tasks; last, what is still open — the commands running, the sub-agents working or waiting — and the
    // letters the folded rounds opened that asked no reply, with those an earlier fold named (`foldedLetters`). The
    // overflow recovery brings back only those and the names of the skills the folded rounds loaded: its conversation
    // is the one the provider just refused for size, and those few lines are what the agent cannot read again.
    const folded = convo.slice(workFrom, upTo);
    const kept = convo.slice(upTo);
    const carried = folded.flatMap((m) => (m?.role === "user" && Array.isArray(m.content) ? m.content.flatMap((b) => (b?.type === "text" ? blockFiles(b.text) || [] : [])) : []));
    const letters = foldedLetters(folded, convo.slice(workFrom));
    // The skills the folded rounds loaded, whose text went with them, by name, once — not one the kept rounds loaded again.
    const keptSkills = new Set(loadedSkills(kept).map((name) => name.toLowerCase()));
    const skills = [...new Map(loadedSkills(folded).filter((name) => !keptSkills.has(name.toLowerCase())).map((name) => [name.toLowerCase(), name])).values()];
    const lead = roundsLead(workFirst, toRound, summary);
    // What the fold frees before anything comes back: the folded rounds' weight less the summary's. The files take at
    // most half of it. Rounds that only read files would otherwise get those same files back whole, and the fold would
    // free nothing: 83,999 → 83,952 tokens in the live drive of 2026-10-11, after which the loop stood down and the turn
    // ran past its line for the rest of its rounds. A file past that room is named, to be read again if it is needed.
    const freed = Math.max(0, weighConvo(folded, compactArg, weights, convo) - weighConvo(roundsHead(lead, null), compactArg, weights));
    const whole = door !== "overflow";
    // The envelopes still sealed (HarnessV4_Envelopes_Plan EN-D6): a line each after the summary, whatever the door —
    // the fold may have taken the lines the agent was given.
    const sealedNow = inbox?.sealed?.() || [];
    // The checkpoint of a compaction (checkpoint.js `compose`): what comes back, then the sealed envelopes.
    const backNow = compose("after-compact", checkpointReader, {
      back: compactArg.reattach
        ? { files: whole ? unshown([...touchedFiles(folded), ...carried], kept) : [], plan: whole && !planIn(kept) ? livePlan(plan) : null, graph: whole && a.graph ? a.graph.open() : null, open: null, letters, ended: null, skills: skills.length ? skills : null }
        : null,
      sealed: sealedNow.length ? sealedListText(sealedNow) : "",
    });
    const parts = backNow.blocks.find((b) => b.id === "back")?.back;
    const back = parts && compactArg.reattach ? compactArg.reattach({ files: parts.files, plan: parts.plan, graph: parts.graph, room: whole ? Math.floor(freed / 2) : 0, letters: parts.letters, skills: parts.skills }) : null;
    const comesBack = [back?.text || "", backNow.blocks.find((b) => b.id === "sealed")?.text || ""].filter(Boolean).join("\n\n");
    // The summary stands for every round of the work up to `toRound`: an earlier fold's summary is in it.
    convo.splice(workFrom, upTo - workFrom, ...roundsHead(lead, comesBack || null));
    toldHere.clear();
    // The kept rounds' thinking was bound to the rounds the summary took: it cannot go back (seen live 10-25).
    const unbound = unbindThinking(convo, workFrom);
    headed = true;
    firstWhole = toRound + 1;
    const after = weighConvo(convo, compactArg, weights);
    const shown = back ? back.files.filter((f) => f.shown).length : 0;
    notes.push(`agent: compacted rounds ${fromRound}–${toRound} of this turn ${door === "manual" ? "on the developer's request" : "at the compaction line"}${got.by ? `, summarized by ${got.by}` : ""}${shown ? `, ${shown} file${shown === 1 ? "" : "s"} brought back after it` : ""}${unbound ? `, ${unboundWords(unbound)} of the kept rounds left out` : ""} (${before.toLocaleString()} → ${after.toLocaleString()} tokens estimated); the model's prompt cache starts over once from the summary`);
    const attached = back?.text || sealedNow.length ? { shown, named: back ? back.files.length - shown : 0, plan: !!back?.plan, ...(back?.graph ? { graph: true } : {}), ...(back?.open ? { open: back.open } : {}), ...(sealedNow.length ? { envelopes: sealedNow.map((e) => e.n) } : {}) } : null;
    // The summary goes on the run's log too: a reader beside the turn starts from it (core/run-work.js `newestCompaction`).
    emit({ type: "compaction", round, fromRound, toRound, tokensBefore: before, tokensAfter: after, summary, ...(got.by ? { by: got.by } : {}), ...(got.fork ? { fork: true } : {}), ...(door === "manual" ? { manual: true } : {}), ...(attached ? { attached } : {}) });
    return "compacted";
  };
  /**
   * The turn's work folded at a door: the newest three rounds kept whole, else the newest one — or, for a side agent
   * (`self`, the owner's word of 10-25: "they should use the usual compaction every model uses and that is self model
   * compaction"), every round of it, in a summary its own model writes.
   * @param {any} c  the loop's compaction config @param {"line" | "overflow" | "manual"} door
   */
  const foldWork = async (c, door) => {
    let done = await compactWork(c?.self ? 0 : 3, c, door);
    if (done === "little" && !c?.self) done = await compactWork(1, c, door);
    if (done === "compacted" || done === "empty") tellAfterSummary();
    return done;
  };
  /** What a round's request will carry, on the lane's scale: the fixed furniture (system prompt + tool schemas,
   * constant all turn) plus the live conversation. One measure for the line, the recovery and the stamp — so
   * every judgment compares like with like. */
  const measureConvo = (c) => (c?.fixed || 0) + weighConvo(convo, c, weights);
  /**
   * Whether the earlier turns are the bigger part of the conversation, and may give way now (HarnessV4_Tasks C33):
   * a turn whose hand makes that room — the session's own turn, a sub-agent's follow-up (`compact.earlier`); once a
   * turn; never a turn that goes on after a pause, whose conversation holds the paused turn's own work ahead of its
   * line. Weighed as the line weighs: every message ahead of the turn's own against the turn's steps — none yet at a
   * turn's first round, so there the earlier turns are the bigger part whenever the line is reached.
   * @param {any} c  the loop's compaction config
   */
  const earlierIsBigger = (c) => {
    if (typeof c?.earlier !== "function" || earlierTried || a.resume || baseLen < 2) return false;
    return weighConvo(convo.slice(0, baseLen - 1), c, weights, convo) > weighConvo(convo.slice(workFrom), c, weights, convo);
  };
  /**
   * Room in the whole chat (HarnessV4_Tasks C33): the earlier turns give way, by the hand's own way — the session's
   * method and writer, or a sub-agent's own model over its earlier exchanges — and the start of the conversation, every
   * message ahead of this turn's own, is swapped for the start the hand returns. The turn's message and its steps stay
   * as they are. One deliberate prefix rewrite, as a fold of the steps is: the provider's cache rebuilds from it once.
   * → "compacted"; "none" where nothing was made (every earlier turn already under a summary, or the method failed with
   * no fold to fall back on), said in a note and on the run; "cut" when a stop or the hang-up came while it ran, and
   * the caller ends the turn.
   * A side agent's (`self`) are its earlier exchanges: its events say so (`exchanges`), and its notes.
   * @param {any} c  the loop's compaction config @param {"line" | "overflow"} door  who asked
   * @returns {Promise<"compacted" | "none" | "cut">}
   */
  const compactEarlier = async (c, door) => {
    earlierTried = true;
    const of = c.self ? { exchanges: true } : {};
    emit({ type: "compacting", round, earlier: true, ...of });
    if (hooks?.preCompact) for (const o of await hooks.preCompact("auto", round)) noteHook(o);
    const before = measureConvo(c);
    const said = saidWaits(`${earlierWords(c)} giving way`);
    /** @type {any} */
    let got;
    try {
      got = await c.earlier({ ahead: convo.slice(0, baseLen - 1), door, signal: cut, onWait: said.retry, onQueue: said.queue });
    } catch (/** @type {any} */ e) {
      got = { error: String(e?.message || e) };
    }
    if (aborted() || stopCut()) return "cut";
    if (!got || got.error || !Array.isArray(got.history)) {
      const why = String(got?.error || "nothing came back").slice(0, 300);
      notes.push(`agent: the conversation is at its line and ${earlierWords(c)} are the bigger part of it, but they could not give way (${why}); this turn's own steps are summarized instead, where they can be`);
      emit({ type: "compaction", round, earlier: true, ...of, result: "none", error: why });
      tellAfterSummary();
      return "none";
    }
    const moved = got.history.length - (baseLen - 1);
    convo.splice(0, baseLen - 1, ...got.history.map((/** @type {any} */ m) => structuredClone(m)));
    toldHere.clear();
    baseLen += moved;
    workFrom += moved;
    gaveWay = true;
    // Every reply's thinking was bound to the earlier turns as they were.
    const unbound = unbindThinking(convo, 0);
    const after = measureConvo(c);
    notes.push(`agent: ${String(got.note || "compaction: the earlier turns gave way").replace(/^compaction: /, "")} — in the middle of this turn, whose own steps stay whole${unbound ? `, ${unboundWords(unbound)} left out` : ""} (the request ≈${before.toLocaleString()} → ≈${after.toLocaleString()} tokens estimated); the model's prompt cache starts over once from there`);
    emit({ type: "compaction", round, earlier: true, ...of, fromTurn: Number(got.fromTurn) || 0, toTurn: Number(got.toTurn) || 0, method: String(got.method || ""), tokensBefore: before, tokensAfter: after });
    tellAfterSummary();
    return "compacted";
  };
  /** What gives way ahead of the turn's own messages, in the record's words. @param {any} c  the loop's compaction config */
  const earlierWords = (c) => (c?.self ? "its earlier exchanges" : "the earlier turns");
  /**
   * What ended while a summary was written — a fold of the turn's rounds, or the earlier turns giving way — told now,
   * on the newest message, before the round that follows is sent: the summary may say a command runs that ended as it
   * wrote, and what comes back after it names only what runs still. On the model's copy of the person's message where
   * the turn has no work of its own yet, as the turn's first request tells what waited.
   */
  const tellAfterSummary = () => {
    const last = convo.at(-1);
    if (last?.role !== "user") return;
    const into = Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content ?? "") }];
    if (!tellShells(into, "after the summary")) return;
    last.content = into;
  };
  /** The end-of-turn figure the caller stamps onto the record (null when no window was ever known). */
  const contextTokens = () =>
    a.compact && (a.compact.usable > 0 || a.compact.window > 0) ? measureConvo(a.compact) : null;
  /** What the request as it stands carries, on the line's scale, whether or not a window is known: what a fork of it
   *  copies (`expose`), weighed against the fork's own line. */
  const weighNow = () => measureConvo(a.compact);
  /**
   * What refuses a call a pre-tool hook rewrote as it refuses any call, in words that say the hook rewrote it: a worker's
   * fence, and the session's read-only mode. → the refusal's words, which follow the rewrite's, and its why for the
   * record; null where neither refuses it. A deny rule speaks for itself in the hooks' step.
   * @param {any} u @param {any} input  the call's input as the hook rewrote it @returns {{ text: string, why: string } | null}
   */
  const rewriteRefused = (u, input) => {
    const c = { ...u, input };
    const reads = readsOnce();
    const stray = fence ? strayed(c, fence, reads) : null;
    if (stray && fence) return { text: strayWords(stray, root, fence.folder), why: ` — ${strayWhy(stray, root, fence.folder)},` };
    const mode = modeHere();
    const g = gateOf(mode, c, null, reads);
    return g.verdict === "refuse" ? { text: g.text.replace(/^Not run: /, ""), why: g.text === FOLDER_REFUSAL ? ` — ${FOLDER_NOTE},` : ` (${mode} mode)` } : null;
  };
  /** Whether the session's pre-tool hooks (§5.6) see a call: a hand's, a web hand's, an MCP tool's. @param {any} u */
  const preHooked = (u) => !!hooks && (isHandTool(u.name) || isWebTool(u.name) || isMcpTool(u.name));
  /**
   * A call as its pre-tool hooks leave it (§5.6), before anything judges it: the first block answers it, and a rewrite
   * replaces its input, so the rules, the gate and the developer judge the call that runs — an ask rule, or the mode,
   * asks about the rewrite as it would about any call (the bug hunt of 10-30, PERM-5). A rewrite a deny rule, a
   * worker's fence or read-only refuses is answered in words that say a hook rewrote it, and a stop that lands while
   * the hooks run comes before the call (`stop`): it does not act (the bug report's L5). The hooks run once for a call:
   * the call they leave is the one asked about, parked and run.
   * @param {any} u @returns {Promise<{ call: any } | { result: any, stop?: true }>}
   */
  const hooked = async (u) => {
    const started = Date.now();
    let input = u.input || {};
    /** @type {import("./hooks.js").HookOutcome | null} */
    let blocked = null;
    for (const o of await /** @type {import("./hooks.js").LoopHooks} */ (hooks).pre(u.name, input, round)) {
      noteHook(o);
      if (o.verdict === "block") {
        blocked = o;
        break;
      }
      if (o.args) input = o.args;
    }
    /** The call answered without running, its card refused. @param {string} text @param {{ hook?: string, rule?: string }} [why] */
    const refused = (text, why = {}) => {
      toolCalls++;
      emit({ type: "tool-start", round, name: u.name, args: argSummary(u.name, u.input), id: u.id, input: u.input });
      emit({ type: "tool-end", round, name: u.name, ok: false, ms: Date.now() - started, id: u.id, chars: text.length, refused: true, ...why });
      return { result: errResult(u.id, text) };
    };
    if (blocked) return refused(`Not run: the pre-tool hook ${hookLabel(blocked)} blocked ${u.name}${blocked.note ? ` — ${blocked.note}` : ""}. Take that into account before proposing it again.`, { hook: blocked.command });
    const rewrote = input !== (u.input || {});
    // A rewrite is a new call: the rules judge it again, and a deny stands over the hook.
    const rewritten = rewrote ? ruleFor(rules, u.name, input) : null;
    if (rewritten?.verdict === "deny") {
      denied++;
      notes.push(`agent: ${u.name} refused by the rule ${describeRule(rewritten.rule)} after a pre-tool hook rewrote it`);
      return refused(denialText(u.name, rewritten.rule, rewritten.subject, "Not run: a pre-tool hook rewrote the call, and"), { rule: describeRule(rewritten.rule) });
    }
    // A worker's fence and read-only judge it again too.
    const refusedAgain = rewrote ? rewriteRefused(u, input) : null;
    if (refusedAgain) {
      notes.push(`agent: ${u.name} refused${refusedAgain.why} after a pre-tool hook rewrote it`);
      return refused(`Not run: a pre-tool hook rewrote the call, and ${refusedAgain.text}`);
    }
    if (stopCut()) return { result: notRun([u])[0], stop: true };
    return { call: rewrote ? { ...u, input } : u };
  };
  /**
   * The errors the language server that serves a file finds in it once the agent wrote or edited it (the owner's LSP of
   * 11-04), asked as the agent's own lsp tool asks (`problemsOf`) — where it is offered, and no rule of the session's
   * asks first or refuses it: the file's diagnostics, their errors alone. The result waits ERRORS_WAIT_MS for them at
   * most, a stop or the hang-up ends the wait at once, and what the server says after that rides the next step
   * (`errorsLater`). The words for the result, or "", and the errors for its card (`errorsCarded`), where there are any.
   * @param {string} how  write or edit @param {any} input @param {{ id: string, round: number }} call
   * @returns {Promise<{ text: string, card: { errors: number, lines: string[] } | null }>}
   */
  const errorsAfter = async (how, input, call) => {
    const none = { text: "", card: null };
    const path = String(input?.path || input?.file_path || "");
    if (!problemsOf || !path || !isOffered(LSP) || notCallable?.[LSP]) return none;
    const hit = ruleFor(rules, LSP, { action: "diagnostics", path }, here);
    if (hit?.verdict === "deny" || asksFirst(hit)) return none;
    const key = resolve(root, path);
    // What an earlier write of the file was still owed is of a text that is gone.
    errorsDue.delete(key);
    const ends = cut ? AbortSignal.any([cut, errorsOver.signal]) : errorsOver.signal;
    // Its errors; null where it said nothing of the file's problems — no word in time, no server — which tells no error gone.
    const asked = Promise.resolve()
      .then(() => problemsOf(path, { signal: ends }))
      .then(
        (said) => errorsOfDiagnostics(String(said)),
        () => null,
      );
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** @type {() => void} */
    let onEnd = () => {};
    /** The wait over with no word: its time up, or a stop, the hang-up or the turn's end. @type {Promise<undefined>} */
    const over = new Promise((res) => {
      timer = setTimeout(res, ERRORS_WAIT_MS, undefined);
      onEnd = () => res(undefined);
      if (ends.aborted) onEnd();
      else ends.addEventListener("abort", onEnd, { once: true });
    });
    const lines = await Promise.race([asked, over]);
    clearTimeout(timer);
    ends.removeEventListener("abort", onEnd);
    if (lines === undefined) {
      if (ends.aborted) return none;
      /** @type {{ path: string, how: string, id: string, round: number, lines: string[] | null | undefined }} */
      const due = { path, how, id: call.id, round: call.round, lines: undefined };
      errorsDue.set(key, due);
      void asked.then((l) => (due.lines = l));
      return none;
    }
    if (!lines) return none;
    if (lines.length) notes.push(`agent: the language server found ${lines.length} error${lines.length === 1 ? "" : "s"} in ${path} after the ${how} — said with its result`);
    return { text: errorsTelling(key, lines, path, how, false).text, card: lines.length ? errorsCarded(lines) : null };
  };
  /**
   * The errors the language server found in a file after its write's or edit's result was written, each file's once:
   * the words for the next step, and whether they list an error — what alone is worth a step of its own at the turn's
   * end, where an end of errors is not. The card of the call they followed shows them (`tool-errors`).
   */
  const errorsLater = () => {
    /** @type {string[]} */
    const said = [];
    /** @type {string[]} */
    const files = [];
    let listed = false;
    for (const [key, due] of errorsDue) {
      if (due.lines === undefined) continue;
      errorsDue.delete(key);
      if (!due.lines) continue;
      if (due.lines.length) emit({ type: "tool-errors", round: due.round, id: due.id, lsp: errorsCarded(due.lines) });
      const words = errorsTelling(key, due.lines, due.path, due.how, true);
      if (!words.text) continue;
      said.push(words.text);
      if (words.listed.length) listed = true;
      if (due.lines.length) files.push(due.path);
    }
    if (files.length) notes.push(`agent: the language server found errors in ${files.join(", ")} after the call's result was written — said at the next step`);
    return { text: said.join("\n\n"), listed };
  };
  /**
   * Whether the write or the edit that changed `path` changed the turn's second file with neither a checklist nor a task
   * graph to keep its steps (`UNPLANNED_LINE`, the owner's of 11-09) — judged on counts and state, never on a message's
   * words. Only an agent that may call both the plan tool and the tasks tool is asked: a sub-agent, a graph task's, a
   * worker and a fork have no checklist of their own. None is asked where the turn kept a checklist, where the
   * conversation holds one still open, or where the graph has open tasks — the main agent's checklist is on it; one
   * left open with all done holds no work (`hasOpen`: what comes back of it after a summary says that one too).
   * @param {string} path  as the call named it
   */
  const unplannedAt = (path) => {
    if (!path || !changedSecond(changedFiles, fileKey(root, path))) return false;
    return offered.has("plan") && offered.has("tasks") && !notCallable?.plan && !notCallable?.tasks && !plan && !livePlan(planIn(convo)) && !(a.graph?.hasOpen ? a.graph.hasOpen() : a.graph?.open());
  };
  /** One tool call that passed the gate. @param {any} u @param {boolean} [learnedNow]  it runs on a learned permission */
  const runOne = async (u, learnedNow = false) => {
    toolCalls++;
    const started = Date.now();
    // A foreground command the developer may send to the background while it runs (HarnessV4_Four_Plan E21).
    const hold = FOREGROUND_SHELLS.has(u.name) ? mailbox?.movable || null : null;
    const edits = editsOf(u);
    emit({ type: "tool-start", round, name: u.name, args: argSummary(u.name, u.input), id: u.id, input: u.input, ...(hold ? { movable: true } : {}), ...(commands(u) ? { command: true } : {}), ...(edits ? { edits } : {}) });
    void nowIn?.saw(round, { id: u.id, name: u.name, input: u.input });
    let out = "";
    /** The images the tool showed, beside its words in the tool_result (TL-D17). @type {any[]} */
    let media = [];
    let ok = true;
    let requestId = null;
    /** @type {number | null} */
    let exitCode = null;
    /** The background shell the developer sent the command to, once they did. @type {string | null} */
    let movedTo = null;
    // Who sent it there: the developer's press, or its timeout (hands.js `runCommand`, the owner's of 11-05).
    let movedBy = "you";
    /** What its sparse copy said as it brought a folder in for the call (`widen`). */
    let widened = "";
    // The input as the pre-tool hooks leave it (`hooked`): the call judged is the call that runs.
    const input = u.input || {};
    // A command on another machine (`machines`) writes nothing here: no snapshot before it, and no change after.
    const there = u.name === "bash_background" && !!onMachine(input) && !!machines;
    /** A stop that landed while the call waited on the snapshot before it comes before the call: it does not act (the
     *  bug report's L5: a write admitted before the stop landed after it). */
    const stoppedFirst = () => {
      emit({ type: "tool-end", round, name: u.name, ok: false, ms: Date.now() - started, id: u.id, chars: 0, stopped: true, notRun: true });
      return errResult(u.id, NOT_RUN);
    };
    // A command that only sleeps while a background sub-agent runs delays the report it waits for (R5: five 4-minute
    // sleeps in one turn, a report read 2.5 minutes after it landed). It is answered in words, pointing at wait.
    if (FOREGROUND_SHELLS.has(u.name) && (plainSleepSeconds(input?.command) ?? 0) >= SLEEP_REFUSE_SECONDS && inbox?.owed?.()) {
      out = SLEEP_REFUSAL;
      emit({ type: "tool-end", round, name: u.name, ok: false, ms: Date.now() - started, id: u.id, chars: out.length, refused: true, reason: SLEEP_REFUSAL_REASON });
      return errResult(u.id, out);
    }
    try {
      if (u.name === "plan") {
        const items = Array.isArray(u.input?.items) ? u.input.items : null;
        if (!items) throw new Error("plan needs items: [{ text, status }]");
        const list = items.map((it) => ({
          text: String(it?.text || ""),
          status: PLAN_STATUSES.has(String(it?.status)) ? String(it.status) : "pending",
        }));
        // A list that names its task (`task`) is refused before anything is drawn where it names none of the agent's own
        // at work — or where its checklist is on no graph, a lead's.
        const task = stepsTaskOf(u.input);
        const refused = task ? (a.graph?.stepsRefusal ? a.graph.stepsRefusal(task) : stepsRefused()) : null;
        if (refused) throw new Error(refused);
        plan = list;
        emit({ type: "plan", round, items: list });
        out = `Plan recorded: ${list.length} item${list.length === 1 ? "" : "s"} (${list.filter((p) => p.status === "done").length} done).`;
        // With the session's graph on, the agent's checklist is on it (HarnessV3-TaskGraph-v2 V2-5): its words follow,
        // and the page hears the graph it changed.
        const onGraph = a.graph?.plan ? (task ? a.graph.plan(list, task) : a.graph.plan(list)) : null;
        if (onGraph?.changed && onGraph.view) emit({ type: "graph", round, graph: onGraph.view });
        if (onGraph?.text) out = `${out} ${onGraph.text}`;
        // What the folder changed while the tasks it ended ran (E41 P2 case 11), once git has read it.
        const changedWords = onGraph?.more ? await onGraph.more : "";
        if (changedWords) out = `${out}\n${changedWords}`;
      } else if (u.name === "tasks") {
        // Offered only while the session's graph is on, so the graph is there; a refusal is the call's error, in its
        // words, and the page hears each change.
        const graph = /** @type {NonNullable<LoopArgs["graph"]>} */ (a.graph);
        const r = graph.apply(u.input);
        if (!r.ok) throw new Error(r.error);
        if (r.changed) emit({ type: "graph", round, graph: r.view });
        // What the folder changed while a task it marked done ran (E41 P2 case 11), once git has read it.
        const changedWords = r.more ? await r.more : "";
        // An agent that reads along is shown, with one task, what its sub-agent has changed so far (TG2-D33).
        const more = graph.soFar ? await graph.soFar(u.input) : null;
        const said = changedWords ? `${r.text}\n${changedWords}` : r.text;
        out = more ? `${said}\n\n${more}` : said;
        // An image kept behind a task, read (HarnessV4_TaskNotes_Plan E33), rides beside the words as a hand's does.
        if (r.media?.length) {
          if (imagesRefused) out += `\n${imagesRefused}`;
          else media = r.media;
        }
      } else if (u.name === "report") {
        // Offered only to a graph task's sub-agent; a report that does not read is the call's error, in its words — and so
        // is one whose checked the registry refuses (HarnessV3-TaskGraph-v2 TG2-D63).
        const r = readReport(u.input);
        if (!r.ok) throw new Error(r.error);
        const refused = r.report.checked && checkedVet ? checkedVet(r.report.checked) : null;
        if (refused) throw new Error(refused);
        taskReport = r.report;
        out = REPORT_IN;
      } else if (u.name === "ask_lead") {
        // Offered only to a team's worker (HarnessV3-TaskGraph-v2 TG2-D49, TG2-D58), so it has a lead: the call waits in
        // place for its answer — until its lead's turn ends, or a plan's 3 minutes; the round's cut ends it — while the
        // run says what it waits on. A question that does not read, or one refused, is the call's error, in its words.
        const v = leadQuestionOf(input);
        if (!v.ok) throw new Error(v.error);
        const at = round;
        const was = state;
        go("waiting", "its lead's answer to its question");
        const r = await /** @type {NonNullable<typeof askLead>} */ (askLead)(/** @type {NonNullable<typeof v.q>} */ (v.q), { signal: cut, emit: (e) => emit({ ...e, round: at }) });
        go(was, !r.ok ? "its question was refused" : r.how === "answered" ? `${r.by === "lead" ? "its lead" : "the developer"} answered` : r.how === "none" ? "no answer from its lead" : "no answer: the wait was cut");
        if (!r.ok) throw new Error(r.error);
        out = leadAnswerWords(r);
        notes.push(`agent: ask_lead — ${r.how === "answered" ? `${r.by === "lead" ? "its lead" : "the developer"} answered` : r.how === "none" ? (r.plan ? "no answer from its lead in 3 minutes" : "no answer: its lead's turn ended") : "stopped while it waited for its lead"} (ask ${r.n})`);
      } else if (u.name === VISUAL_GUIDE) {
        const r = visualGuide(u.input);
        if (!r.ok) throw new Error(r.error);
        out = r.text;
      } else if (u.name === SHOW_VISUAL) {
        // Kept whole on its turn, or on its session (VS-D48), then the page is told it is there and where
        // (HarnessV4_Visuals_Plan VS-D9): it draws it from what was kept, live and after a reload alike.
        const at = { id: String(u.id), round };
        const r = showVisual(u.input, at, a.visuals ?? null);
        if (!r.ok) throw new Error(r.error);
        emit(visualEvent(at, r));
        out = r.text;
      } else if (u.name === ARTIFACT) {
        // A page kept apart from the chat (HarnessV4_Artifacts_Plan E18); a version it publishes is said on the run.
        if (!a.artifacts) throw new Error(ARTIFACTS_OFF);
        // What a publish's page names from the library hosts is fetched first, for the version to keep (vendor on publish);
        // the round's cut ends the fetching, and a publish stopped so is not made.
        const pinned = await pinnedFor(u.input, a.artifacts.at, a.artifacts.store, cut);
        if (pinned && cut?.aborted) throw new Error(PIN_STOPPED);
        const r = artifactCall(u.input, { ...a.artifacts.at, pinned }, a.artifacts.store, String(u.id));
        if (!r.ok) throw new Error(r.error);
        if (r.event) emit({ ...r.event, round, id: String(u.id) });
        out = r.text;
      } else if (u.name === SPACE) {
        // The project's Space (proposal_ux §4.14): its store tells an open Space of each change.
        if (!a.space) throw new Error(SPACE_OFF);
        // A press runs as its button's command is judged now (SA-D4): where the gate runs it, or where the developer said
        // yes to this call and it runs what they were asked; the round's stop stops it.
        const id = String(u.id);
        const judgeNow = async (/** @type {{ name: string, input: any }} */ call) => {
          // A press or a tool runs in the project's folder: never for a worker held to its worktree, nor while its plan
          // waits for its lead's review — whatever its call's admission read it as.
          if (call.input?.press && fence) return { ok: /** @type {const} */ (false), error: pressSaid(PRESS_FENCED, call.input) };
          if (call.input?.press && planHeld?.()) return { ok: /** @type {const} */ (false), error: PLAN_HELD };
          const v = judge(gateOf(modeHere(), call, permissions ? permissions.allowed : null), ruleFor(rules, call.name, subjectOf(call), here), call.name, call.input);
          if (v.verdict === "run") return { ok: /** @type {const} */ (true) };
          if (v.verdict === "ask" && pressYes.get(id) === String(call.input?.press?.runs ?? "")) return { ok: /** @type {const} */ (true) };
          if (v.verdict === "refuse") return { ok: /** @type {const} */ (false), error: v.rule || v.text === FOLDER_REFUSAL ? v.text : pressSaid(PRESS_READ_ONLY, call.input) };
          return { ok: /** @type {const} */ (false), error: "it asks the developer first, and they were not asked about it as it runs now: call it again" };
        };
        const r = await spaceRun(u.input, { ...a.space, judge: judgeNow, signal: cut || null });
        if (!r.ok) throw new Error(r.error);
        // A routine or a watcher it proposed or changed is said under the call: the chat's card switches it on.
        if (r.event) emit({ ...r.event, round, id });
        out = r.text;
      } else if (u.name === BESIDE_TEAM) {
        // A team beside the chat (team_v2_plan §5.5): fired, or how those beside it stand — never a result.
        if (!a.beside) throw new Error(BESIDE_OFF);
        const r = await besideCall(u.input, a.beside, undefined, { mode: modeNow });
        if (!r.ok) throw new Error(r.error);
        out = r.text;
      } else if (u.name === FLOW_NAME) {
        // A flow beside the chat (HarnessV4_OneAgent_Plan OA3): drawn after /flow, changed, or read — never started.
        if (!a.flow) throw new Error(FLOW_OFF);
        const r = await flowCall(u.input, a.flow);
        if (!r.ok) throw new Error(r.error);
        out = r.text;
      } else if (u.name === THREAD) {
        // A thread of the chat (app/threads.js): a chat of its own, linked to this one, its first message the brief.
        if (!a.thread) throw new Error(THREAD_OFF);
        // A folder that is not the chat's own was judged before the call ran (`admit`, `answered`): the mode's run or
        // the developer's yes is what its start reads (`threadFolder`). One judged by neither starts nowhere. A turn
        // held to reading starts a thread that reads only (`mode`).
        const r = await threadCall(u.input, a.thread, {
          folder: async () => {
            const settled = threadFolder.get(String(u.id));
            if (!settled) throw new Error("the developer was not asked for it: call the tool again");
            return settled;
          },
          mode: modeNow,
        });
        if (!r.ok) throw new Error(r.error);
        out = r.text;
      } else if (u.name === CRAFT_NAME) {
        // The skill a crafter chat crafts (agent/craft-tool.js): made, its books added, looked in, written.
        if (!a.craft) throw new Error(CRAFT_OFF);
        const r = await craftCall(u.input, a.craft);
        if (!r.ok) throw new Error(r.error);
        out = r.text;
      } else if (u.name === COME_BACK) {
        // The chat's come-back (agent/come-back.js): set, replaced or dropped — its turn comes later, by itself.
        const r = comeBackCall(u.input, a.comeBack ?? null);
        if (!r.ok) throw new Error(r.error);
        out = r.text;
      } else if (u.name === "delegate_read") {
        if (!delegateRead) throw new Error("delegated reads are not available in this session");
        const paths = Array.isArray(u.input?.paths) ? u.input.paths.map(String) : [];
        if (!paths.length) throw new Error("delegate_read needs paths");
        // The reader's call takes the stop like every other call of the round (F4 item 21c, decision 13).
        const r = await delegateRead(paths, String(u.input?.question || ""), { root, signal: cut });
        out = r.text;
        requestId = r.requestId;
        spent += costOf(requestId);
      } else if (u.name === "wait") {
        out = await waitForSubagents(input?.seconds);
        // The agent waits, so nothing would be pulled from its work: what is sealed opens with the next step, oldest
        // first, after it what arrived (HarnessV4_Envelopes_Plan case 6) — another chat's letter stays sealed for it.
        openNext = true;
        const still = inbox?.waitOpens?.() || 0;
        if (still) out += ` ${still === 1 ? "The envelope still sealed follows" : `The ${still} envelopes still sealed follow`}, opened, oldest first.`;
      } else if (u.name === ENVELOPE && dismisses(input)) {
        // Lines of what is still open that no longer hold, by their ids (the owner's of 11-09): a call of their own.
        if (!dismiss) throw new Error("this agent has no list of what is still open to dismiss from: only the chat's main agent has one");
        const r = dismiss(input.dismiss);
        out = dismissAnswer(r, otherThanDismiss(input));
        notes.push(`agent: dismissed from what is still open — ${r.dismissed.length ? r.dismissed.join(", ") : "none"}${r.unknown.length ? `; not open now: ${r.unknown.join(", ")}` : ""}`);
      } else if (u.name === ENVELOPE && writesLetter(input)) {
        // A letter to another chat or to a sub-agent of its own — a sub-agent's to the agent that launched it — or an
        // answer to one (letters.js, the owner's of 11-04): sent, or refused in words.
        const r = (inbox ? inbox.letter?.(input) : letter?.(input)) ?? null;
        if (!r) throw new Error("this session sends no letters");
        out = r.text;
        if (r.sent) emit({ type: "letter-sent", round, letter: r.sent.id, to: r.sent.to, title: r.sent.title, subject: r.sent.subject, reply: r.sent.reply, answer: input?.answer != null && String(input.answer).trim() !== "", id: String(u.id) });
        notes.push(r.sent ? `agent: letter ${r.sent.id} to ${r.sent.title} (${r.sent.to})` : `agent: a letter not sent — ${r.text}`);
        // A sub-agent's letter that waits for its reply (letters.js `waiting`): the call waits with it.
        const waiting = /** @type {{ waiting?: import("../letters.js").ReplyWait }} */ (r).waiting;
        if (waiting) {
          const w = await replyWait(waiting);
          out += w.words;
          notes.push(`agent: ${w.note}`);
        }
      } else if (u.name === ENVELOPE && typeof input?.picture === "string" && input.picture.trim()) {
        // A picture another agent drew, by its name (HarnessV4_DesignPass_Plan UX1): its code whole; the sealed results
        // stay sealed.
        if (!inbox?.picture) throw new Error("no other agent's picture reaches this agent: it has no envelopes");
        const p = inbox.picture(input.picture);
        out = pictureAnswer(input.picture, p, input?.all === true || Number(input?.count) > 0);
        notes.push(p.found ? `agent: picture ${p.found.title} (${p.found.id}) opened` : `agent: no picture "${input.picture}" to open`);
      } else if (u.name === ENVELOPE) {
        // The agent's own pick of when (EN-D2): the oldest sealed ones, whole, in the order they arrived.
        if (!inbox?.open) throw new Error("no other agent's result reaches this agent sealed: it has no envelopes");
        const opened = inbox.open({ count: input?.count, all: input?.all === true });
        out = envelopeAnswer(opened, inbox.sealed().length);
        for (const d of opened) {
          emit({ type: "envelope-opened", round, envelope: d.envelope, agentId: d.from, description: d.description, sender: d.sender || "", ...(d.via ? { via: d.via } : {}), by: "tool", id: String(u.id) });
          emit({ type: "subagent-report", round, agentId: d.from, description: d.description, kind: d.kind, envelope: d.envelope });
        }
        if (opened.length) notes.push(`agent: envelope opened ${opened.map((d) => d.envelope).join(", ")}`);
      } else if (u.name === "agent" || u.name === "worker") {
        // A team's lead follows up on its workers through the same door (HarnessV3-AtHome P2).
        const go = u.name === "worker" ? subagents?.worker : subagents?.run;
        if (!go) throw new Error("sub-agents are not available in this session");
        // The sub-agent inherits this turn's hang-up when it runs in the foreground. Its events keep the launching
        // round, however late a background one reports.
        const at = round;
        // One that shares the folder writes there as it runs, and an apply puts a helper's change there: the places as
        // they stand before it starts, the way a command's are taken (HarnessV4_Git_Plan GWC-13).
        if (tree) {
          await tree.before(round, { command: true, signal }).catch((/** @type {any} */ e) => notes.push(`agent: no snapshot before ${u.name} (${String(e?.message || e).slice(0, 160)})`));
          if (stopCut()) return stoppedFirst();
        }
        const r = await go({
          id: String(u.id),
          input: u.input,
          emit: (e) => emit({ ...e, round: at }),
          signal, // the client's hang-up: a foreground sub-agent dies with this turn
          stopSignal, // the harness's stop: a foreground sub-agent is stopped through its own run, its report kept (BUG-08)
          batch: at, // the round's agent calls run side by side, and share one snapshot of the folder (Phase 0 of 11-09)
        });
        out = r.text;
        ok = r.ok;
        spent += r.spentUsd;
        toolCalls += r.toolCalls;
        roundIds.push(...r.roundIds);
        notes.push(r.note);
        if (r.wrote) {
          wroteThisTurn = true;
          subagentWrote.add(String(u.id));
        }
        if (r.writes) helperWrites.set(String(u.id), r.writes);
      } else {
        // A command's output streams into the chat as it runs (the owner's ask): chunks buffer here and flush at
        // most every 250 ms as one tool-output event, so a chatty build cannot flood the event log.
        let live = "";
        let liveTimer = null;
        const flushLive = () => {
          liveTimer = null;
          if (live) {
            emit({ type: "tool-output", round, id: u.id, text: live });
            live = "";
          }
        };
        // A helper's sparse copy brings in the folder of the file it reads or writes outside its cone (the owner's plan of
        // 11-09 for big repos): a read finds the file, an edit its text — and first, so the snapshot below takes the
        // folder as it came in, never the file as absent.
        const reach = widen && (u.name === "read" || u.name === "write" || u.name === "edit") ? String(input?.path || input?.file_path || "") : "";
        if (reach && widen) widened = await widen(resolve(root, reach), signal).catch(() => "");
        // The places it is about to write in, as they stand before it runs (HarnessV4_Git_Plan GWC-11, GW-D4).
        if (tree && WRITING_HANDS.has(u.name) && !there) {
          const command = isCommandHand(u.name);
          const path = command ? "" : String(input?.path || input?.file_path || "");
          await tree.before(round, { paths: path ? [resolve(root, path)] : [], command, signal }).catch((/** @type {any} */ e) => notes.push(`agent: no snapshot before ${u.name} (${String(e?.message || e).slice(0, 160)})`));
          // The snapshot hears the hang-up, not the stop: one cut short would leave its place unsnapshotted for the rest
          // of the turn, the round's earlier writes with it. A stop that landed while it ran is heard here instead.
          if (stopCut()) return stoppedFirst();
          if (command) ranCommands.add(String(u.id));
        }
        try {
          const got = await runHand(u.name, input, {
            root, signal: cut,
            onOutput: FOREGROUND_SHELLS.has(u.name) || u.name === "bash_output" ? (/** @type {string} */ d) => {
              live = (live + d).slice(-4000);
              if (!liveTimer) liveTimer = setTimeout(flushLive, 250);
            } : null,
            movable: hold ? (move) => hold(String(u.id), move) : null,
            // Every move is heard, the press's and the timeout's: the card says it runs on, never "exit 0".
            onMoved: (m) => {
              movedTo = m.id;
              movedBy = m.timedOut ? "timeout" : "you";
            },
            ...(u.name === BROWSER ? { mayAct: browserMayAct, mayLook: browserMayLook } : {}),
            ...(outsideYes.has(String(u.id)) ? { outside: true } : {}),
            ...(there && machines ? { remote: (/** @type {any} */ given) => machines.start(given, { root, signal: cut || null, rule: thereRule(u), ask: (q, gone) => askThere(u, q, gone), mode: modeNow() }) } : {}),
          });
          // Every step below works on the words; the images ride beside them — unless this turn's provider already
          // refused images, when the words say so instead.
          if (got instanceof MediaResult) {
            out = got.text;
            if (imagesRefused) out += `\n${imagesRefused}`;
            else media = got.media;
          } else out = String(got);
        } finally {
          if (liveTimer) clearTimeout(liveTimer);
          flushLive();
        }
        if (FOREGROUND_SHELLS.has(u.name) && !movedTo) exitCode = 0;
      }
    } catch (/** @type {any} */ e) {
      out = `Error: ${e.message}`;
      ok = false;
      if (FOREGROUND_SHELLS.has(u.name) && typeof e?.exitCode === "number") exitCode = e.exitCode;
    }
    // A call the developer's stop cut is no failure: its card says so, softly (BUG-09). A command that failed on its
    // own just as the stop landed reads stopped too — the stop is what the developer did, and the output is kept.
    const stoppedHere = !ok && stopCut();
    // What the call did, told to memory's observers (HarnessV3-Memory M5-4) as it ended, before a hook's note or its
    // withholding: a call the stop cut says nothing about the call.
    if (observe && !stoppedHere) observe({ type: "tool.result", id: String(u.id), round, tool: u.name, input: inBrief(u.name, input), ok, exitCode, error: ok ? null : withoutArtifactFiles(out).slice(0, 2000), ...(movedTo ? { background: true } : {}) });
    if (ok && WRITING_HANDS.has(u.name) && !there) wroteThisTurn = true;
    if (ok && (u.name === "write" || u.name === "edit")) written.set(String(input.path || input.file_path || ""), toolCalls);
    // The file counted as the hand left it: a post-tool hook that withholds the result does not undo the change.
    const unplanned = ok && (u.name === "write" || u.name === "edit") && unplannedAt(String(input.path || input.file_path || ""));
    if (ok && u.name === "read") readAt.set(String(input.path || input.file_path || ""), toolCalls);
    // A command that failed in a row with nothing changed between (core/drift.js, d-fails). One sent to the background or
    // cut by the stop ran to no end of its own; it, anything else that changes or runs, and a sub-agent's change applied
    // or a task's merged, start the count again.
    let failing = "";
    if (FOREGROUND_SHELLS.has(u.name) && !movedTo && !stoppedHere && exitCode != null) {
      if (failedAgain(drift, input.command, exitCode !== 0)) failing = String(input.command);
    } else if (changesWhatFailed(u.name, kindOf(u.name), input)) driftChanged(drift);
    // A file it changed outside every open task's writes, while tasks of its own that named writes run (d-writes): each
    // such task told once. A merge's or an apply's files come by no write of its own.
    const strayed = ok && (u.name === "write" || u.name === "edit") && !there ? a.graph?.outside?.(String(input.path || input.file_path || ""), root) || null : null;
    // The last guard over the result's size (the sources cut themselves to the budget), before any hook's note rides on it.
    out = guardResult(out);
    // Post-tool hooks: a note rides along with the result, a block withholds it.
    if (hooks && (isHandTool(u.name) || isWebTool(u.name) || isMcpTool(u.name))) {
      for (const o of await hooks.post(u.name, input, out, ok, round)) {
        noteHook(o);
        if (o.verdict === "block") {
          out = `Result withheld by the post-tool hook ${hookLabel(o)}${o.note ? `: ${o.note}` : ""}.`;
          ok = false;
          media = [];
          break;
        }
        if (o.note) out += `\n\n[hook ${o.plugin ? hookLabel(o) : o.command}: ${o.note}]`;
      }
    }
    // The errors the language server finds in the file as the write or the edit — and a hook that formats it — left it.
    const errors = ok && (u.name === "write" || u.name === "edit") ? await errorsAfter(u.name, input, { id: u.id, round }) : null;
    if (errors?.text) out += `\n\n${errors.text}`;
    // A patch workspace that moved to a worktree for this call — its command, a hook, the language server — says so here.
    const moved = movedNews?.() || "";
    if (moved) out += `\n\n${moved}`;
    if (widened) out += `\n\n${widened}`;
    // At the call (checkpoint.js "action", as a coding agent's at its next step): memory at the moment of action
    // (HarnessV3-Memory M5-3, M5-5) — a pitfall the call walked into, or an open thread on a file it touched — rides on its
    // result, after the hooks' notes, so the model reads it before its next step; then the unplanned line, last on the
    // newest result, where the model reads it before its next step: the prompt and the messages before it keep the bytes
    // the provider cached; then a command that failed again with nothing changed, or a file changed outside the writes.
    // Ahead of them all, what is still open where a change waited long in the turn with nothing said of it, once.
    const reminded = reminders && (isHandTool(u.name) || isWebTool(u.name) || isMcpTool(u.name)) ? reminders(u.name, input) : [];
    const drifted = [failing ? failingLine(failing, "loop") : "", strayed ? outsideLine(strayed, "loop") : ""].filter(Boolean).join("\n\n");
    const waited = openWaited?.() || null;
    const atCall = compose("action", checkpointReader, { open: waited?.text || "", memory: reminded.map((p) => p.line).join("\n\n"), unplanned: unplanned ? UNPLANNED_LINE : "", drift: drifted });
    for (const b of atCall.blocks) out += `\n\n${b.text}`;
    if (waited) {
      waited.heard();
      notes.push(`agent: what is still open, said on ${u.name}'s result — a sub-agent's change waited long in the turn with nothing said of it`);
    }
    if (reminded.length)
      notes.push(`agent: memory reminded ${u.name}'s result of ${reminded.map((p) => `${p.id} (${p.kind === "thread" ? "an open thread on a file it touched" : "a pitfall the call walked into"})`).join(", ")}`);
    if (unplanned) notes.push(`agent: ${u.name} changed a second file with neither a checklist nor a task graph — Filament asked for one on its result`);
    if (failing) notes.push(`agent: \`${failing}\` failed a third time in a row, and nothing Filament saw changed between them — Filament said so on its result`);
    if (strayed) notes.push(`agent: ${u.name} changed ${strayed.path} outside every open task's writes while on ${strayed.tasks.map((t) => t.id).join(", ")} — Filament said so on its result`);
    const preview = previewOf(out);
    // The pictures the model got, kept beside the run files so the call's card shows them (HarnessV4_Tasks U9): named on
    // the event, never their bytes. A withheld result handed none.
    const kept = media.length && keepImages ? keepImages(picturesIn(media)) : null;
    emit({
      type: "tool-end",
      round,
      name: u.name,
      ok,
      ms: Date.now() - started,
      id: u.id,
      chars: out.length,
      ...(preview != null ? { preview } : {}),
      ...(exitCode != null ? { exitCode } : {}),
      ...(requestId ? { requestId } : {}),
      ...(learnedNow ? { learned: true } : {}),
      ...(stoppedHere ? { stopped: true } : {}),
      ...(movedTo ? { background: movedTo, ...(movedBy === "timeout" ? { movedBy } : {}) } : {}),
      // An MCP tool its server vouches for as read-only: a sub-agent's run that called it acted on nothing (subagents.js
      // `actedBy`).
      ...(kindOf(u.name) === "read" ? { reads: true } : {}),
      ...(reminded.length ? { memory: reminded.map((p) => p.id) } : {}),
      ...(kept?.images.length ? { images: kept.images } : {}),
      ...(kept?.notKept ? { imagesNotKept: kept.notKept } : {}),
      ...(errors?.card ? { lsp: errors.card } : {}),
    });
    return { type: "tool_result", tool_use_id: u.id, content: media.length ? [{ type: "text", text: out }, ...media] : out, ...(ok ? {} : { is_error: true }) };
  };
  /**
   * Before a reply's tools run: what the developer typed while the model was deciding. A stop ends the turn here, a
   * veto refuses this round's tool calls before any runs — the mailbox's contract, "refuse what the loop just
   * proposed" — and notes wait for the boundary, where they ride with the results.
   * @returns {{ stop: any, veto: any, notes: any[] }}
   */
  const preflight = () => {
    const heard = sieve(readMail());
    return {
      stop: heard.find((m) => m.kind === "stop") || null,
      veto: heard.find((m) => m.kind === "veto") || null,
      notes: heard.filter((m) => m.kind === "note"),
    };
  };
  /** The round's tool calls refused on a veto: each gets the objection as its result, none runs. @param {any[]} uses @param {any} veto */
  const vetoRound = (uses, veto) => {
    const text = String(veto.text || "").slice(0, 1500);
    emit({ type: "vetoed", round, tasks: uses.length, text });
    notes.push(`agent: the developer vetoed round ${round}'s ${uses.length} tool call${uses.length === 1 ? "" : "s"} before any ran`);
    return uses.map((u) => {
      emit({ type: "tool-start", round, name: u.name, args: argSummary(u.name, u.input), id: u.id, input: u.input });
      emit({ type: "tool-end", round, name: u.name, ok: false, ms: 0, id: u.id, chars: 0, vetoed: true });
      return errResult(u.id, `Not run: the developer objected before it ran${text ? ` — "${text}"` : ""}. Weigh that before proposing it again.`);
    });
  };
  /** The round whose landings the line of the task they came during followed (E41 P1 case 7): once a round. */
  let onTaskRound = -1;
  /**
   * What landed while a task of the agent's own runs — an envelope's line, a message — is followed by the line that says
   * which task, and how to take it up first (E36 case 6): once a round, nothing paused. Not its own background shells'
   * news, which it started for its work (FabeleHelper's of 11-10).
   * @param {any[]} into
   */
  const sayOnTask = (into) => {
    const line = onTaskLine();
    if (line) into.push({ type: "text", text: line });
  };
  /** The line `sayOnTask` says, marked said this round: "" where the round said it, or nothing of the agent's own runs. */
  const onTaskLine = () => {
    if (onTaskRound === round || !a.graph?.onTask) return "";
    const line = a.graph.onTask();
    if (!line) return "";
    onTaskRound = round;
    notes.push("agent: what landed came while a task of the agent's own ran — Filament said which, and how to take it up first");
    return line;
  };
  /**
   * After the tools: what the developer said meanwhile (and any notes heard before them) rides with the results, or
   * stops the turn. A veto arriving now is an objection to work already done, said as such.
   * @param {any[]} results @param {any[]} earlier @param {string} [after]  what a veto heard now came after: the tools, or a reply with none
   */
  const boundary = async (results, earlier = [], after = "the tools had run") => {
    const heard = sieve([...earlier, ...readMail()]);
    const stop = heard.find((m) => m.kind === "stop");
    if (stop) {
      // What was heard before and was to ride these results never reaches the model: said so, not left "read".
      mailbox?.unheard?.(heard.filter((m) => m.kind !== "stop"));
      return { stop };
    }
    // Background shells of this agent that exited unseen (TL-D24): a line each, with the round's results. A stop above
    // leaves them untold, for the session's next turn.
    tellShells(results, "at the round boundary");
    // The files it read that changed meanwhile — a command of its own, the developer, a formatter: told with the results.
    const changed = fileNews ? await fileNews() : "";
    if (changed) {
      results.push({ type: "text", text: changed });
      notes.push("agent: files it read changed since — told at the round boundary");
    }
    // A folder below the chat's that this round read, edited or wrote in tells its instruction files, once while the
    // conversation holds them, as Claude Code tells a subfolder's CLAUDE.md (the Designer's answer of 10-27).
    const reply = convo.at(-1);
    const worked = folderNews && reply?.role === "assistant" ? filesWorked(reply, results) : [];
    const folders = worked.length && folderNews ? folderNews(worked, folderTold) : null;
    if (folders?.text) {
      results.push({ type: "text", text: folders.text });
      for (const t of folders.told) foldersTold.push({ file: t.file, as: t.as, how: t.how });
      notes.push(`agent: ${[folders.told.length ? `${folders.told.map((t) => `${t.file} (as it ${t.how === "read" ? "read" : t.how === "edit" ? "edited" : "wrote"} ${t.as})`).join(", ")} told at the round boundary` : "", folders.left.length ? `${folders.left.join(", ")} named, past the room for them` : ""].filter(Boolean).join("; ")}`);
      if (folders.told.length) emit({ type: "instructions-told", round, files: folders.told.map(({ file, as, how, chars, truncated, text }) => ({ file, as, how, chars, ...(truncated ? { truncated } : {}), text })) });
    }
    if (heard.length) {
      // A team's lead's messages to its worker are its lead's, said apart from the developer's; and so are the session's
      // agent's to a sub-agent — of its task graph, or a letter — and Filament's own (TG2-D59).
      const lead = heard.filter((m) => m.from === "lead");
      const planner = heard.filter((m) => m.from === "agent");
      const shim = heard.filter((m) => m.from === FILAMENT);
      // A watcher's guidance to this chat (app/watchers/guidance.js) is a reviewer's, never the developer's: each
      // watcher's under a heading of its own, with how to weigh it.
      const guided = heard.filter((m) => m.from === WATCHER);
      const developer = heard.filter((m) => m.from !== "lead" && m.from !== "agent" && m.from !== FILAMENT && m.from !== WATCHER);
      // The pictures the developer sent with a message follow the messages, in the order sent: each line says how
      // many are its own, so the model knows which words a picture came with. Once this turn's provider has refused
      // a request with images (`imagesRefused`), a picture is not sent: its line says so, and so does the run.
      const carried = developer.filter((m) => m.images?.length);
      const count = carried.reduce((n, m) => n + m.images.length, 0);
      const pictures = imagesRefused ? [] : carried.flatMap((m) => m.images);
      if (count) steerPictures?.(carried.flatMap((m) => m.images));
      notes.push(`agent: ${heard.length} steering message(s) delivered at the round boundary${lead.length ? ` (${lead.length} from the team's lead)` : ""}${planner.length ? ` (${planner.length} from the main agent)` : ""}${shim.length ? ` (${shim.length} from Filament)` : ""}${guided.length ? ` (${guided.length} a watcher's guidance)` : ""}${!count ? "" : imagesRefused ? `, ${count === 1 ? "its picture" : `their ${count} pictures`} not sent (the provider refused images this turn)` : `, with ${count} picture${count === 1 ? "" : "s"}`}`);
      /** @param {any} m */
      const withPictures = (m) => {
        if (!m.images?.length) return m.text;
        const where = imagesRefused ? "not sent: this turn's provider refused a request with images" : `after these messages${count > m.images.length ? ", in the order sent" : ""}`;
        return `${m.text || "(no words)"} [with ${m.images.length === 1 ? "a picture" : `${m.images.length} pictures`}, ${where}]`;
      };
      for (const [head, list] of /** @type {const} */ ([[STEERING_HEAD, developer], [LEAD_HEAD, lead], [AGENT_HEAD, planner], [FILAMENT_HEAD, shim]]))
        if (list.length)
          results.push({
            type: "text",
            text: `${head} (${list.length} message${list.length === 1 ? "" : "s"}). Acknowledge what you heard in your next reply before acting on it:\n${list
              .map((m) => (m.kind === "veto" ? `- (objection, arrived after ${after}) ${withPictures(m)}` : `- ${withPictures(m)}`))
              .join("\n")}`,
          });
      for (const text of guideBlocks(guided)) results.push({ type: "text", text });
      for (const p of pictures) results.push({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } });
      if (carried.length && imagesRefused) emit({ type: "steer-pictures", round, ids: carried.map((m) => m.id), refused: refusedSaid });
      else pictured.push(...carried.map((m) => m.id));
      // What follows them (checkpoint.js "note", as a coding agent's follow its note): which task of its own the agent is
      // on, and how to take what came up first.
      for (const b of compose("note", checkpointReader, { onTask: onTaskLine() }).blocks) results.push({ type: "text", text: String(b.text) });
    }
    return { stop: null };
  };
  /**
   * The shells' news for this agent (TL-D24), taken now — the exits, the lines a watch caught, the time it set, the
   * person's Cancel of that: a line each, in one block on `into`, said on the record as told `when`, the exits drawn as
   * the shells' row. Answers whether any came. @param {any[]} into @param {string} when
   */
  const tellShells = (into, when) => {
    const exits = shellNews ? shellNews() : [];
    if (!exits.length) return false;
    into.push({ type: "text", text: exits.map((x) => x.text).join("\n") });
    notes.push(`agent: ${toldWords(exits)} told ${when}`);
    const ended = exits.filter((x) => (x.kind || "exit") === "exit");
    if (ended.length) emit({ type: "shell-exit", round, shells: ended.map(({ id, command, code }) => ({ id, command, code })) });
    return true;
  };
  /**
   * Sub-agents' reports that arrived, into a user message of the turn's own work: each its own text block, its spend,
   * calls and model calls counted here when this turn launched it. `seal`: the loop is at work, so another agent's
   * result comes as its envelope's line (HarnessV4_Envelopes_Plan EN-D1); without it the loop waited, and what is
   * sealed opens first, oldest first, then what arrived. `end`: the turn would end — a result that came is opened, the
   * sealed ones ahead of it; with none they stay sealed.
   * @param {any[]} into @param {{ seal?: boolean, end?: boolean }} [o] @returns {number} how many were delivered
   */
  const takeInbox = (into, { seal = true, end = false } = {}) => {
    const due = inbox ? inbox.take({ seal, end }) : [];
    let sealedNow = 0;
    let openedNow = 0;
    for (const d of due) {
      into.push({ type: "text", text: d.opened ? openedText(d) : d.text });
      // A result sealed (EN2): its line is what the model reads; what it spent is counted now, and what it wrote is in
      // the folder already. Its report waits with the session until the agent opens it.
      if (d.kind === "envelope") {
        sealedNow++;
        spent += d.spentUsd;
        toolCalls += d.toolCalls;
        roundIds.push(...d.roundIds);
        if (d.wrote) {
          wroteThisTurn = true;
          deliveredWrites = true;
        }
        if (d.writes) deliveredList.push(d.writes);
        // Its number goes as `envelope`: the run log numbers each event `n`.
        emit({ type: "envelope-sealed", round, envelope: d.envelope, agentId: d.from, description: d.description, sender: d.sender || "", subject: d.subject || "", ...(d.via ? { via: d.via } : {}) });
        continue;
      }
      // One opened as the loop waited: its sealing counted what it spent and wrote.
      if (d.opened) {
        openedNow++;
        emit({ type: "envelope-opened", round, envelope: d.envelope, agentId: d.from, description: d.description, sender: d.sender || "", ...(d.via ? { via: d.via } : {}), by: "wait" });
        emit({ type: "subagent-report", round, agentId: d.from, description: d.description, kind: d.kind, envelope: d.envelope });
        continue;
      }
      // A look at the lead's workers (HarnessV3-TaskGraph-v2 §12): no report — it is said on the run with what it
      // showed, so a page rebuilds it from the workers' own logs (TG2-D22), and it is the model's to answer.
      if (d.kind === "look") {
        unheard = d;
        lookHeld = true;
        looksTaken++;
        emit({ type: "look", round, workers: d.look?.workers || [], tokens: d.look?.tokens || 0 });
        continue;
      }
      // A worker's question to its lead (TG2-D58) is no report: its lead's timeline has it from when it was asked.
      if (d.kind === "ask") continue;
      // A coding agent's background command that ended after the chat moved to Filament's loop (HarnessV4_Background_Plan
      // BG-D10): the shells' row.
      if (d.kind === "shell") {
        emit({ type: "shell-exit", round, shells: [{ id: d.from, command: d.description, code: d.code ?? null }] });
        continue;
      }
      spent += d.spentUsd;
      toolCalls += d.toolCalls;
      roundIds.push(...d.roundIds);
      if (d.wrote) {
        wroteThisTurn = true;
        deliveredWrites = true;
      }
      if (d.writes) deliveredList.push(d.writes);
      emit({ type: "subagent-report", round, agentId: d.from, description: d.description, kind: d.kind, ...(d.task ? { task: d.task, state: d.state } : {}), ...(d.sent ? { sent: true } : {}) });
    }
    const said = due.filter((d) => d.kind !== "look" && d.kind !== "envelope" && !d.opened).length;
    if (said) notes.push(`agent: ${said} sub-agent message${said === 1 ? "" : "s"} delivered before round ${round + 1}`);
    if (sealedNow) notes.push(`agent: ${sealedNow} result${sealedNow === 1 ? "" : "s"} sealed before round ${round + 1}: ${sealedNow === 1 ? "its line" : "their lines"} delivered, ${sealedNow === 1 ? "its report waits" : "their reports wait"} for the envelope tool`);
    if (openedNow) notes.push(`agent: ${openedNow} sealed result${openedNow === 1 ? "" : "s"} opened before round ${round + 1}, as the agent waited`);
    if (sealedNow) sayOnTask(into);
    return due.length;
  };
  /**
   * The lead's conversation before its next model call (TG2-D24): only the newest look whole, and a wait it answered a
   * look with gone with its answer — its round is remembered as one that left.
   */
  const tidy = () => {
    if (!reads) return;
    const was = convo.slice();
    const t = tidyLooks(convo, { from: baseLen, own: workFrom });
    unbindThinking(convo, firstChange(was, convo));
    looksLined += t.lined;
    for (let k = 0, n = round; k < t.left && n >= workFirst; k++, n--) {
      while (gone.has(n) && n > workFirst) n--;
      gone.add(n);
    }
    if (t.left) notes.push(`agent: ${t.left} round${t.left === 1 ? "" : "s"} in which ${reader} only waited left its conversation before round ${round + 1} — the newest look at its ${crew} stands where the one before stood`);
  };
  /**
   * A fold of the turn's rounds took the look the lead's conversation held (TG2-D24): the read that follows brings one,
   * whether or not a worker moved, so the lead's picture of its workers is never only a summary's.
   */
  const lookAgain = () => {
    if (!reads || !lookHeld || holdsLook(convo, baseLen)) return;
    lookHeld = false;
    inbox?.look?.();
    notes.push(`agent: a fold of this turn's rounds took the look the lead's conversation held; a new one was asked for before round ${round + 1}`);
  };
  /**
   * Wait on sub-agents — the developer's paused launch, or the turn's own background ones before it may end. The wait
   * ends as soon as there is something for the model (BUG-12: it used to hold every report and every message until the
   * last sub-agent settled): a message the developer typed, and — unless `reports` is off, as for the developer's paused
   * launch, which holds the round on purpose — the first report that lands. The model hears it on its own round and
   * decides what to do while the rest run; the turn still may not end before its own launches report. The hang-up,
   * and a stop end the wait and the turn. The inbox and the mailbox are raced without being read: what
   * wakes the wait is taken by the caller, so nothing is drained and then dropped.
   * @param {Promise<void>} p @param {string} why @param {{ reports?: boolean }} [o]
   * @returns {Promise<LoopResult | null>} the turn's end when the wait ended it, else null — the caller delivers what came
   */
  const waitOut = async (p, why, { reports = true } = {}) => {
    go("waiting", why);
    emit({ type: "waiting", round, why });
    const settled = p.then(() => "settled");
    /** @type {Promise<string> | null} */
    let landed = null;
    /** @type {Promise<string> | null} */
    let told = null;
    for (;;) {
      if (reports && !landed && inbox?.arrival) landed = inbox.arrival().then((what) => (what === "look" ? "look" : "report"));
      if (!told && mailbox?.next) told = mailbox.next().then(() => "message");
      const got = await Promise.race([settled, ...(landed ? [landed] : []), ...(told ? [told] : []), new Promise((res) => setTimeout(res, 1000, "tick").unref?.())]);
      if (got === "settled") return null;
      if (aborted()) return endWith("aborted", null, "the client disconnected");
      // A stop ends the wait, its message read or not: a Force stop's end took it (the bug report's L4: the forced turn
      // waited on, then ran its turn-end hooks).
      if (stopCut()) return stopHere();
      if (got === "message") told = null; // re-armed next time round: a compact steer is taken off below and the wait goes on
      const heardNow = sieve(readMail());
      const stop = heardNow.find((m) => m.kind === "stop");
      if (stop) return stopped(stop);
      if (heardNow.length) {
        heard.push(...heardNow);
        return null;
      }
      if (got === "report") return null;
      // A background command of the agent's own ended: the caller tells it, as it delivers a report (the 1 s tick looks).
      if (reports && shellDue?.()) return null;
      // A look that was due woke the wait: the caller reads it — unless it is due no more (its worker ended, and its
      // report is on its way), and the wait goes on.
      if (got === "look") {
        landed = null;
        if (inbox?.due?.()) return null;
      }
    }
  };
  /**
   * The `wait` tool (HarnessV3-Responsiveness R5): the model's own pause for its background sub-agents. It returns the
   * moment there is something for the model — a report lands, the last launch settles, the developer types — or the
   * stop, the hang-up or the time limit comes. Like `waitOut` it reads nothing: the report rides the next round
   * (`takeInbox`) and a message the boundary, as after any other tool. A team's lead's wait answers with its watch too:
   * the workers still running, and how each goes (HarnessV3-AtHome AH-O5) — where the lead reads along, only after a
   * wait that ran out of time with no look due: else a look shows them (HarnessV3-TaskGraph-v2 TG2-D48).
   * @param {unknown} seconds @returns {Promise<string>}
   */
  const waitForSubagents = async (seconds) => {
    const { said, lines } = await waitWords(seconds);
    const watch = lines ? subagents?.watch?.() || "" : "";
    return watch ? `${said}\n\n${watch}` : said;
  };
  /**
   * A sub-agent's wait in its letter's call for the reply (letters.js `waiting`): the reply, which is the call's result —
   * or, as a message comes, the stop or the hang-up, or the seconds pass, the wait ends and the reply goes into the run
   * as it would have, read at the next step. A message already waiting ends it at once. The words the result gains, and
   * the record's note.
   * @param {import("../letters.js").ReplyWait} w @returns {Promise<{ words: string, note: string }>}
   */
  const replyWait = async (w) => {
    const t0 = Date.now();
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** @type {(() => void) | null} */
    let offStop = null;
    /** @type {{ text: string } | string} */
    let got =
      heard.length || mailbox?.peek?.((m) => m.kind !== "compact")
        ? "message"
        : await Promise.race([
            w.reply.then((text) => ({ text })),
            new Promise((res) => {
              timer = setTimeout(res, w.seconds * 1000, "time");
              timer.unref?.();
            }),
            ...(mailbox?.next ? [mailbox.next().then(() => "message")] : []),
            ...(cut
              ? [
                  new Promise((res) => {
                    if (cut.aborted) return res("stopped");
                    const on = () => res("stopped");
                    cut.addEventListener("abort", on, { once: true });
                    offStop = () => cut.removeEventListener("abort", on);
                  }),
                ]
              : []),
          ]);
    clearTimeout(timer);
    /** @type {() => void} */ (offStop || (() => {}))();
    // The reply taken as the wait ended otherwise is the reply still.
    if (typeof got === "string" && !w.cancel()) got = { text: await w.reply };
    const took = `${Math.round((Date.now() - t0) / 1000)} s`;
    if (typeof got !== "string") return { words: ` You waited for its reply, which came after ${took}:\n\n${got.text}`, note: `the reply to letter ${w.id} came as its call waited (${took})` };
    const after = "its reply reaches you whole at your next step once it comes";
    // A Compact is no message the model is given: it is done before the next step.
    const told = got === "message" && (heard.length || mailbox?.peek?.((m) => m.kind !== "compact"));
    const why =
      got === "message"
        ? told
          ? `a message came for you after ${took}, and follows`
          : `the developer asked to compact the conversation after ${took}, which is done before your next step`
        : got === "stopped"
          ? "the turn is being stopped"
          : `no reply came within ${w.seconds} s — carry on`;
    return { words: ` You waited for its reply: ${why}; ${after}.`, note: `letter ${w.id}'s wait for its reply ended: ${got} (${took})` };
  };
  /**
   * What the wait itself answers: what ended it, and after how long — and whether the workers' lines go with it.
   * @param {unknown} seconds @returns {Promise<{ said: string, lines: boolean }>}
   */
  const waitWords = async (seconds) => {
    /** @param {string} said @param {boolean} [lines] */
    const as = (said, lines = !reads) => ({ said, lines });
    const owed = inbox?.owed?.() || null;
    // Its own background commands are waited for as its sub-agents are, an end that waits untold among them (the gap of
    // 11-10, f6's follow-up). Its own tasks that run are named: no sub-agent does them (E41 P5's measure).
    const shells = owed ? [] : shellsWaited?.() || [];
    if (!owed && !shells.length && !shellDue?.()) {
      const own = a.graph?.ownWork?.() || "";
      return as(`Nothing to wait for: no sub-agent you launched in the background is still running, and none of your background commands runs.${own ? ` ${own}` : ""} Any report or result that already arrived comes with your next step.`);
    }
    // A message the developer typed while the model decided to wait was read as the round began (`preflight`), and
    // rides the round's results: the wait is over before it starts (HarnessV3-Views V6-16).
    if (heard.length) return as("Waited 0 s: the developer sent a message. It follows.");
    // A background command of its own that ended is something for the model as a report is: it ends the wait, its
    // exit riding the round's results (the boundary tells it). Its exit is looked for each second.
    const dueNow = shellDue?.();
    if (dueNow) return as(SHELL_ENDED("0 s", dueNow, !!owed));
    const asked = Number(seconds) > 0 ? Math.min(WAIT_MAX_SECONDS, Number(seconds)) : WAIT_DEFAULT_SECONDS;
    const limitMs = asked * 1000;
    const t0 = Date.now();
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** The stop's listener, taken off once the wait is over. @type {{ off: (() => void) | null }} */
    const onStop = { off: null };
    /** @type {NodeJS.Timeout | undefined} */
    let looks;
    const got = await Promise.race([
      ...(owed ? [owed.then(() => "settled")] : []),
      ...(inbox?.arrival ? [inbox.arrival().then((what) => (what && CAME_WORDS[what] ? what : what === "look" || what === "told" || what === "notice" || what === "letter" ? what : "report"))] : []),
      ...(mailbox?.next ? [mailbox.next().then(() => "message")] : []),
      new Promise((res) => {
        timer = setTimeout(res, limitMs, "time");
        timer.unref?.();
      }),
      ...(shellDue
        ? [
            new Promise((res) => {
              looks = setInterval(() => shellDue() && res("shell"), 1000);
              looks.unref?.();
            }),
          ]
        : []),
      ...(cut
        ? [
            new Promise((res) => {
              if (cut.aborted) return res("stopped");
              const on = () => res("stopped");
              cut.addEventListener("abort", on, { once: true });
              onStop.off = () => cut.removeEventListener("abort", on);
            }),
          ]
        : []),
    ]);
    clearTimeout(timer);
    clearInterval(looks);
    onStop.off?.();
    const took = `${Math.round((Date.now() - t0) / 1000)} s`;
    // A lead that reads along is shown its workers when a report, a message or a look ends its wait (HarnessV3-TaskGraph-v2
    // §12.7). One that only ran out of time is shown a look where one is due — on a sign, or at the pace — and else
    // their lines, a worker each (TG2-D48).
    if (reads && got !== "time") inbox?.look?.();
    if (got === "look") return as(`Waited ${took}: your ${crew} moved. A look follows as a message.`);
    // What came says itself (the nudge map of 11-10: a check's verdict, a command task's end, an apply's verdict and the
    // card's answer all ended the wait as "a sub-agent reported") — and so does what waits as the work it owed let go.
    const came = got === "settled" ? inbox?.came?.() || "report" : got;
    if (CAME_WORDS[came]) return as(`Waited ${took}: ${CAME_WORDS[came]}`);
    if (came === "report") return as(`Waited ${took}: a sub-agent reported. Its report follows as a message.`);
    // The developer's own words to one of them, past the lead (HarnessV4_Tasks decision 10): no report.
    if (came === "told") return as(`Waited ${took}: the developer wrote to one of your ${crew} directly. What they wrote follows as a message.`);
    // Another chat's letter, or the one of the fork that weighed the developer's message (the owner's of 11-04): its
    // envelope's line, or the letter whole where this agent opens no envelopes, says whose.
    if (came === "letter") return as(`Waited ${took}: a letter came. It follows as a message.`);
    // A Compact is no message the model is given: it is done before the next step, and the wait says so.
    if (got === "message" && !mailbox?.peek?.((m) => m.kind !== "compact")) return as(`Waited ${took}: the developer asked to compact the conversation. It is compacted before your next step.`);
    if (got === "message") return as(`Waited ${took}: the developer sent a message. It follows.`);
    if (got === "shell") return as(SHELL_ENDED(took, shellDue?.(), !!owed));
    // Filament's own word — of a flow the agent drives In place (HarnessV4_OneAgent_Plan OA4), or a flow's start.
    if (came === "notice") return as(`Waited ${took}: word from Filament came. It follows as a message.`);
    if (got === "stopped") return as(`Waited ${took}: the turn is being stopped.`);
    // Ends of the graph's tasks that nothing waits on came meanwhile, held for its other workers: they ride this step.
    const held = inbox?.held?.() || 0;
    if (held) return as(`Waited ${took}: ${held === 1 ? "a task of your graph ended" : `${held} tasks of your graph ended`} while its other ${crew} still run — ${held === 1 ? "its end follows" : "their ends follow"} as a message. Filament wakes you once the rest are done, or as soon as one ends that another task waits on.`);
    if (reads) return inbox?.due?.() ? as(`Waited ${took}: no report yet. A look follows as a message.`) : as(`Waited ${took}: no report yet, and no look is due — Filament shows you one ${paceWords(inbox?.pace?.())}.`, true);
    if (!owed) return as(`Waited ${took} and nothing arrived; ${shells.length === 1 ? `your background command ${shells[0].id} is` : "your background commands are"} still running. Call wait again, or carry on with other work — a result reaches you the moment its command ends.`);
    return as(`Waited ${took} and nothing arrived; the sub-agents are still running. Call wait again, or carry on with other work — a report reaches you the moment it lands.`);
  };
  /** A developer's stop ends the turn in its words, and says whose it was (BUG-07: the archive stamps the turn
   *  stopped, the page draws it so, the queue waits). @param {{ text?: string, from?: string }} m @returns {LoopResult} */
  const stopped = (m, forced = false) => {
    // Heard but never delivered (notes waiting for the next boundary) and a Compact not yet run: the stop ends the
    // turn first, so their bubbles say so ("The run ended before reading this", "The turn ended before it compacted").
    const undone = [...heard, ...(compactAsked ? [compactAsked] : [])];
    heard = [];
    compactAsked = null;
    mailbox?.unheard?.(undone);
    return stoppedResult(m, forced);
  };
  /**
   * The stop says whose it was: the developer's; or — a task that was another's to end — a team's worker's lead's, the
   * agent's whose task graph dropped the task (HarnessV3-TaskGraph G2), or Filament's own (`whoseStop`).
   * @param {{ text?: string, from?: string }} m @param {boolean} [forced] @returns {LoopResult}
   */
  const stoppedResult = (m, forced = false) => {
    const { who, what } = whoseStop(m.from);
    return {
      ...endWith("stopped", {
        kind: "stop",
        text: `(Filament: ${who} ${forced ? "force-stopped" : "stopped"} this ${what} after ${toolCalls} tool call${toolCalls === 1 ? "" : "s"}${m.text ? ` — "${String(m.text).slice(0, 400)}"` : ""}; ${above("what was finished")}.)`,
        ...(m.text ? { quoted: true } : {}),
      }),
      stoppedBy: String(m.from || "harness"),
    };
  };
  /** The turn ends on the stop that cut its in-flight work, in the stop's words (still in the mailbox: no decision
   *  point read them). */
  const stopHere = () => stopped(readMail().find((m) => m.kind === "stop") || { text: "" });
  /** The turn's end when the hang-up or a stop cut what it waited on between rounds: a compaction's summary. */
  const endCut = () => (aborted() ? endWith("aborted", null, "the client disconnected") : stopHere());
  /**
   * After a round in which a writing hand ran (write, edit, or a command — a command may write anything): each place
   * it wrote in goes onto a hidden ref, so a fork at this turn can rewind the files with the conversation, and the
   * round's record says what each agent changed there (HarnessV4_Git_Plan step 1) — one `snapshot` event per agent and
   * place. A place with no git is said once per turn and never blocks the loop. The round's calls are read off the
   * reply itself (the newest assistant message), so a round that paused on a permission and resumed in a later request
   * still counts the write that ran before the pause. The git calls get one call's timeout and the client's hang-up;
   * after a hang-up (`final`) the writes that already landed are still worth their snapshot, so that one runs on a
   * short leash of its own, no signal.
   * @param {any[]} results @param {{ final?: boolean }} [o]
   */
  const snapshotRound = async (results, { final = false } = {}) => {
    if (!tree) return;
    const last = convo[convo.length - 1];
    const uses = last?.role === "assistant" && Array.isArray(last.content) ? last.content.filter((b) => b?.type === "tool_use") : [];
    const okIds = new Set(results.filter((r) => r?.type === "tool_result" && !r.is_error).map((r) => r.tool_use_id));
    // A sub-agent's writes landed whatever its run ended as, so its call counts even when that ended in an error — and
    // a background one's count when its report is delivered.
    if (!deliveredWrites && !uses.some((u) => (WRITING_HANDS.has(u.name) && okIds.has(u.id)) || subagentWrote.has(String(u.id)))) return;
    deliveredWrites = false;
    const own = uses
      .filter((u) => (u.name === "write" || u.name === "edit") && okIds.has(u.id))
      .map((u) => String(u.input?.path || u.input?.file_path || ""))
      .filter(Boolean)
      .map((p) => resolve(root, p));
    // A command that failed may have written too; one that never ran (refused, declined) did not.
    const command = uses.some((u) => isCommandHand(u.name) && (ranCommands.has(String(u.id)) || okIds.has(u.id)));
    const writes = [...uses.map((u) => helperWrites.get(String(u.id))).filter((w) => !!w), ...deliveredList];
    deliveredList = [];
    ranCommands.clear();
    try {
      const t = await tree.take(round, { own, command, writes: /** @type {import("../turn-tree.js").Writes[]} */ (writes), ...(final ? { timeoutMs: 30_000, signal: null } : { signal }) });
      for (const e of t.errors) {
        const told = e.timedOut ? `${e.place}\ttimed out` : e.place;
        if (treeTold.has(told)) continue;
        treeTold.add(told);
        notes.push(`agent: no working-tree snapshot of ${e.place} (${e.error})`);
      }
      const refOf = new Map(t.snapshots.map((s) => [s.place, s.ref]));
      for (const row of t.rows) emit({ type: "snapshot", ...row, ref: refOf.get(row.place) || null });
      if (t.snapshots.length) notes.push(`agent: working tree snapshotted after round ${round} (${t.snapshots.map((s) => s.ref).join(", ")})`);
    } catch (/** @type {any} */ e) {
      notes.push(`agent: no working-tree snapshot (${String(e?.message || e).slice(0, 160)})`);
    }
  };

  /**
   * The newest reply's calls answered on what the loop holds: the results that came back kept, a call still running
   * answered as cut (`cutText`), one never started as Not run — the archive never holds an open tool_use.
   * @param {string} cutText @param {boolean} stopped  a stop cut the running calls, not a failure
   */
  const answerOpen = (cutText, stopped) => {
    const last = convo.at(-1);
    const uses = last?.role === "assistant" && Array.isArray(last.content) ? last.content.filter((b) => b?.type === "tool_use").map((u) => unwrapDoor(u, mcpDoor)) : [];
    if (!uses.length) return;
    const got = new Map(roundResults.map((r) => [r?.tool_use_id, r]));
    convo.push({
      role: "user",
      content: uses.map((u) => {
        if (got.has(u.id)) return got.get(u.id);
        const running = openCalls.get(String(u.id));
        if (!running) return notRun([u])[0];
        emit({ type: "tool-end", round, name: u.name, ok: false, ms: Date.now() - running.at, id: u.id, chars: 0, ...(stopped ? { stopped: true } : {}) });
        return errResult(u.id, cutText);
      }),
    });
  };
  // A Force stop: the turn ends on what the loop holds, its open calls answered.
  ctl.end = () => {
    answerOpen(FORCE_CUT, true);
    const waitingOn = state;
    const m = readMail().find((x) => x.kind === "stop") || { text: "", from: "harness" };
    notes.push(`agent: the developer force-stopped the turn while it was ${waitingOn} — it did not wait for the loop's next step`);
    // A model call in flight is cut as a stop cuts it: what it had streamed is the reply (the bug report's L3).
    if (inFlight) inFlight();
    else sink.endBlock();
    const out = { ...stopped(m, true), forced: true };
    ctl.forced = true;
    return out;
  };
  // A throw the loop did not end on itself — a fault in Filament's own code — fails the turn on what the loop holds, as a
  // Force stop ends it: its work kept, its open calls answered (HarnessV3-FailurePoints §6 item 1).
  ctl.fail = (e) => {
    if (aborted()) return endWith("aborted", null, "the client disconnected");
    answerOpen(FAILED_CUT, false);
    if (inFlight) inFlight();
    else sink.endBlock();
    const { said, code } = saidOf(e);
    const failure = worded({ what: "Filament's agent loop", where: null, said, code, status: null, tries: null, began: null, at: Date.now(), streamed: null, kept: keptRounds(round), next: null });
    notes.push(`agent: the loop failed in round ${round} (${said.slice(0, 120)})`);
    return endWith("failed", null, failureLine(failure), failure);
  };
  // Resume: the parked reply's pending tool gets the developer's answer as its result — a question's answer as text,
  // a permission as the tool running (or a refusal in their words) — and the reply's remaining tools run now.
  if (a.resume) {
    const { paused, answer, allow = false, modeSwitch = false } = a.resume;
    go("acting", "resumed");
    const results = [...paused.results];
    // What came back before the pause is the round's as much as what runs now: a Force stop keeps it (the bug report's
    // H6: the calls answered before the pause were archived Not run).
    roundResults = results;
    // Steering notes read before the pause: owed to the model at the next boundary, or parked again with a new pause.
    heard = [...(paused.heard || [])];
    /** The parked reply's calls that run now. */
    const toRun = paused.remaining;
    if (paused.kind === "ask") {
      results.push({ type: "tool_result", tool_use_id: paused.pending.id, content: answer || "(no answer)" });
      notes.push("agent: resumed with the developer's answer");
    } else if (modeSwitch) {
      // The answer is the permission switch itself (HarnessV3-AtHome AH-F1): the waiting call is judged again under the
      // mode now in force, as a call asked for now is — it runs, is refused in the gate's words, or asks again.
      const p = paused.pending;
      notes.push(`agent: the developer switched the mode to ${modeNow()} while ${p.name} waited — judged again under it`);
      const v = admit(p, paused.look || null);
      if (!("pause" in v)) endLook(paused.look);
      if ("pause" in v) return pauseWith(parkedFor(v.pause, p, paused.remaining, results), v.pause.question);
      results.push("result" in v ? v.result : "ask" in v ? await askInPlace(p, v.ask) : await runOne(p, v.run));
    } else {
      endLook(paused.look);
      results.push(await answered(paused.pending, answer, { allow, offerLine: true, review: !!paused.review, asked: paused.question || "" }));
    }
    const pre = preflight();
    if (pre.stop) {
      // The answered call's result and a "Not run" for the rest close the parked reply, so the archived trajectory
      // never carries an open tool_use.
      convo.push({ role: "user", content: inReplyOrder(convo.at(-1), [...results, ...notRun(toRun)]) });
      return stopped(pre.stop);
    }
    heard = [...heard, ...pre.notes];
    const rest = pre.veto
      ? { results: [...results, ...vetoRound(toRun, pre.veto)], pause: null, question: "", stop: false }
      : await runTools(toRun, results, 0);
    if (rest.stop) {
      await snapshotRound(rest.results, { final: true });
      convo.push({ role: "user", content: inReplyOrder(convo.at(-1), rest.results) });
      return endWith("aborted", null, "the client disconnected");
    }
    if (rest.cut) {
      await snapshotRound(rest.results);
      convo.push({ role: "user", content: inReplyOrder(convo.at(-1), rest.results) });
      return stopHere();
    }
    if (rest.pause) return pauseWith(rest.pause, rest.question || "");
    go("observing", "results appended");
    await snapshotRound(rest.results);
    const b = await boundary(rest.results, heard);
    heard = [];
    convo.push({ role: "user", content: inReplyOrder(convo.at(-1), rest.results) });
    if (b.stop) return stopped(b.stop);
  }

  // The pipe's live event, once per turn: which window this turn runs against (null = unknown, the same
  // convention the record's stamp uses), where the number came from, how much of it is usable and what the
  // fixed furniture costs — the ground truth for every "why does the meter say unknown" question a surface may
  // want to answer while the turn runs.
  if (a.compact)
    emit({ type: "window", window: a.compact.window || null, source: a.compact.source ?? null, usable: a.compact.usable || null, fixed: a.compact.fixed || 0 });

  // Background shells of this agent that exited unseen before the turn began (HarnessV4_Tasks C11): told with its
  // first request, ahead of the message that began it, as a harness session's typed message carries them — the
  // sessions service tells its own before the turn, so none waits here then. A client of the proxy sends its own
  // message alone, and its turn heard of an exit at its first round boundary: the model answered a round without it,
  // and a turn that called no tool never heard. The lines ride the model's copy of that message, as memory's do; the
  // client's own history never holds them. A turn resumed with an answer tells them at its next round boundary.
  const began = convo.at(-1);
  // The turn's checkpoint (checkpoint.js `compose`, the owner's of 11-10: the coding agents hear the same, in the same
  // order): what stands is read once, in this order, and the composer says which blocks the turn opens with and where.
  const opening = !a.resume && convo.length === workFrom && began?.role === "user";
  const exits = opening && shellNews ? shellNews() : [];
  // The files it read that changed since it last saw them — between turns, the developer's work as a rule: told after
  // the message that began the turn, on the model's copy, as Claude Code tells them.
  const changedSince = opening && fileNews ? await fileNews() : "";
  // What is still open, where something the agent was told of ended or changed since it heard it (the owner's plan of
  // 11-02, Phase 4): after the message that began the turn, on the model's copy, as the changed files are.
  const openSince = opening && openNews ? openNews() : "";
  // Envelopes still sealed from before (HarnessV4_Envelopes_Plan case 12, EN-D6): the turn opens with the developer's
  // message, then a line each — none opened for it. They ride the model's copy of that message, as the exits do.
  const stillSealed = opening && inbox?.sealed ? inbox.sealed() : [];
  // Where the agent stands on its task graph (HarnessV4_TaskGraphPlus_Plan E41 P1, cases 1–2): the turn opens with it
  // after the developer's message — its working memory, never asked for — riding the model's copy, as the envelopes do,
  // never the system prompt: the provider's cache stays as it was (GX-D2).
  // A request whose summary's head brought it back just now (case 3) says it once: an earlier message holds it already.
  // Asked for once a turn, here: the turn begun counts on each running task of the agent's own (E41 P2 case 13). What a
  // summary's head says is read before that count, as the summary said it (where-drift: the count moved the words).
  const whereWas = opening && a.graph?.begin ? a.graph.where?.({ back: true }) || null : null;
  const whereNow = opening && a.graph?.begin ? a.graph.begin() : null;
  const whereBack = whereNow ? whereWas : null;
  /** @param {any} m */
  const holdsWhere = (m) => (Array.isArray(m?.content) ? m.content : [{ type: "text", text: String(m?.content ?? "") }]).some((/** @type {any} */ b) => b?.type === "text" && typeof b.text === "string" && (b.text.includes(/** @type {string} */ (whereNow)) || (!!whereBack && b.text.includes(whereBack))));
  const whereHeld = !a.switched && !!whereNow && convo.slice(0, -1).some(holdsWhere);
  // A move to the loop (`switched`) is the switch's moment, as a coding agent's (acp-turn.js): what stands goes as the
  // handover, where it stands in it as the turn's start says it, and no word of where it stands beside it (sw-loop).
  const exitsText = exits.map((x) => x.text).join("\n");
  const newsFact = changedSince ? { text: changedSince, names: "" } : null;
  const sealedFact = stillSealed.length ? sealedListText(stillSealed) : "";
  const turnStart = a.switched
    ? compose("switch", checkpointReader, { exits: exitsText, fileNews: newsFact, handover: openSince, sealed: sealedFact })
    : compose("turn-start", checkpointReader, { exits: exitsText, fileNews: newsFact, open: openSince, sealed: sealedFact, where: whereNow || "", whereHeld });
  for (const b of turnStart.blocks) {
    const text = String(b.text);
    const content = Array.isArray(began.content) ? began.content : [{ type: "text", text: String(began.content ?? "") }];
    // The exits ride ahead of the message, as a harness session's typed message carries them; the rest after it.
    began.content = b.id === "shell-exits" ? [{ type: "text", text }, ...content] : [...content, { type: "text", text }];
    a.saidAt?.(b.id === "shell-exits" ? "head" : "tail", text);
    if (b.id === "shell-exits") {
      notes.push(`agent: ${toldWords(exits)} told with the turn's first request`);
      const ended = exits.filter((x) => (x.kind || "exit") === "exit");
      if (ended.length) emit({ type: "shell-exit", round: round + 1, shells: ended.map(({ id, command, code }) => ({ id, command, code })) });
    } else if (b.id === "file-news") notes.push("agent: files it read changed since — told with the turn's first request");
    else if (b.id === "still-open" || b.id === "handover") notes.push(a.openNote || "agent: what is still open changed since the agent was told — said with the turn's first request");
    else if (b.id === "sealed") {
      notes.push(`agent: ${stillSealed.length} envelope${stillSealed.length === 1 ? "" : "s"} still sealed, listed with the turn's first request`);
      // A letter that came while no turn ran is told here for the first time: its card, as one sealed in the turn; the
      // others are listed again.
      const fresh = inbox?.fresh?.(stillSealed.map((e) => e.n)) || [];
      for (const e of fresh) emit({ type: "envelope-sealed", round: round + 1, envelope: e.n, agentId: e.from, description: e.description, sender: e.sender, subject: e.subject, ...(e.via ? { via: e.via } : {}) });
      const again = stillSealed.filter((e) => !fresh.some((f) => f.n === e.n)).map((e) => e.n);
      if (again.length) emit({ type: "envelope-list", round: round + 1, envelopes: again, at: "start" });
    } else if (b.id === "where") notes.push("agent: where the agent stands on its task graph, with the turn's first request");
  }
  if (whereHeld) notes.push("agent: where the agent stands on its task graph came back with the summary at the head of this request — not said again with its first request");

  for (;;) {
    if (aborted()) return endWith("aborted", null, "the client disconnected");
    if (stopCut()) return stopHere();
    // Sub-agents: the developer's paused launch holds the round until it reports. Whatever arrived rides the newest
    // message of the turn's own work — never the client's message, which the archive holds as it was sent — so a
    // report waiting at round one rides the next boundary, or the turn's end.
    if (inbox) {
      const held = inbox.hold();
      if (held) {
        const ended = await waitOut(held, "the developer's sub-agent is running; the turn waits for its report", { reports: false });
        if (ended) return ended;
        openNext = true;
      }
      const last = convo.at(-1);
      if (convo.length > workFrom && last?.role === "user" && Array.isArray(last.content)) {
        lookAgain();
        // At work, another agent's result comes sealed; after a wait it comes opened (EN-D1).
        takeInbox(last.content, { seal: !openNext });
        openNext = false;
        // What a report says its sub-agent wrote landed before the next round's hands: its record is taken now.
        if (deliveredWrites) await snapshotRound([]);
        if (heard.length) {
          const b = await boundary(last.content, heard);
          heard = [];
          if (b.stop) return stopped(b.stop);
        }
      }
      tidy();
    }
    // The errors the language server found in a file after its write's or edit's result was written ride the next step,
    // on the newest message of the turn's own work (the owner's LSP of 11-04).
    if (errorsDue.size) {
      const last = convo.at(-1);
      if (convo.length > workFrom && last?.role === "user" && Array.isArray(last.content)) {
        const later = errorsLater();
        if (later.text) last.content.push({ type: "text", text: later.text });
      }
    }
    // The developer asked to compact while the turn runs (BUG-21): the turn's older rounds fold into one summary now,
    // by the line's own machinery — the newest rounds stay whole (three, else one). What it could not do is said,
    // never silently deferred.
    if (compactAsked) {
      compactAsked = null;
      const cm = a.compact;
      const done = cm && typeof cm.summarize === "function" && convo.length > workFrom + 1
        ? await foldWork(cm, "manual")
        : "little";
      if (done === "cut") return endCut();
      if (done === "compacted") lastCompactAfter = measureConvo(cm);
      else {
        notes.push(done === "empty"
          ? "agent: the developer asked to compact; the summarizer came back empty, so nothing was summarized"
          : "agent: the developer asked to compact; this turn has too little finished work to summarize yet (the newest round stays whole)");
        emit({ type: "compaction", round, manual: true, result: done });
      }
    }
    // The compaction line: measured before every round, so the request that goes out is the one that fits — and the
    // measure counts the fixed furniture (system prompt + tool schemas) that rides every request, not just the
    // conversation. Compaction is BEST-EFFORT up to the window: the estimate is the class-weighted local one, so
    // a turn over the line with too little to compact (or still over after compacting) still goes out;
    // the provider is the final judge of size, and a premature stop on an estimate would kill turns that fit.
    // Past the window itself there is nothing left to try — the turn stops in words rather than upload a request
    // the provider must refuse.
    // A fold reaches this turn's rounds only: the earlier turns sit beneath it. So at the line it is asked for once,
    // and again only once the turn has grown, since the last fold landed, by the room a compaction is for — from
    // where a fold aims to land (`target`, 40% of the window) up to the line, and half the line where a line set
    // near or under the target leaves less. And a fold that leaves the conversation at or past the line stands the
    // line down for the rest of the turn: what holds it there is the earlier turns, and the next message's
    // compaction takes the whole history. Without both, a turn that begins just under its line on a long history
    // folds one round every round: ten summarizer calls in thirteen rounds, each landing within a round's size of
    // the line, in the live drive of 2026-10-12. At the window itself a fold is asked for whatever the line's guards
    // say: the alternative is the turn ending there. A turn that is running makes room by itself whatever `context.compaction.mode` says: that
    // asks of a message, before it is sent (HarnessV4_Tasks C26).
    // The bigger part gives way first (HarnessV4_Tasks C33): where the earlier turns weigh more than this turn's own
    // steps, they are compacted by the hand's way — the session's own method, a sub-agent's own model over its earlier
    // exchanges — once a turn, and never a question, before a fold is asked of the work the turn is doing. At a turn's
    // first round it has no steps yet, so a follow-up that starts past its line makes its room there, before its call.
    // After it the rule above stands: no fold until the turn has grown by the room a compaction is for, unless the
    // conversation is past the window itself.
    // The line as it stands this round, read once: the session's document is resolved for each reading of it.
    const comp = a.compact ? { ...a.compact } : null;
    let convoTokens = comp && (comp.usable > 0 || comp.window > 0) ? measureConvo(comp) : 0;
    let compactRan = false;
    const room = comp ? Math.max(comp.usable - comp.target, Math.floor(comp.usable / 2)) : 0;
    const lineAt = (/** @type {number} */ tokens) => ({
      atLine: !!comp && comp.usable > 0 && !compactStoodDown && tokens >= comp.usable && (lastCompactAfter === 0 || tokens >= lastCompactAfter + room),
      atWindow: !!comp && comp.window > 0 && tokens > comp.window,
    });
    let { atLine, atWindow } = lineAt(convoTokens);
    if (comp && (atLine || atWindow) && earlierIsBigger(comp)) {
      const made = await compactEarlier(comp, "line");
      if (made === "cut") return endCut();
      if (made === "compacted") {
        compactRan = true;
        convoTokens = measureConvo(comp);
        lastCompactAfter = convoTokens;
        ({ atLine, atWindow } = lineAt(convoTokens));
      }
    }
    if (comp && convo.length > workFrom + 1 && (atLine || atWindow)) {
      compactRan = true;
      const second = await foldWork(comp, "line");
      if (second === "cut") return endCut();
      if (second === "compacted") {
        const after = measureConvo(comp);
        lastCompactAfter = after;
        if (comp.usable > 0 && after >= comp.usable && !compactStoodDown) {
          compactStoodDown = true;
          notes.push(`agent: folding this turn's rounds left the conversation at ≈${after.toLocaleString()} tokens, still past the ${comp.usable.toLocaleString()}-token compaction line (the rest is the earlier turns', out of this turn's reach); standing down for the rest of this turn — the next message makes room in the whole session`);
          emit({ type: "compaction", round, stoodDown: true });
        }
      }
      else if (second === "little") notes.push("agent: the conversation passed the estimated compaction line with too little to summarize; the request went out as it was");
      else notes.push("agent: the conversation passed the estimated compaction line and the summarizer came back empty; the request went out as it was");
    }
    // The hard window, independent of the line branch's guards and measured FRESH — a compaction may have just
    // brought the request back under it, and stopping on the pre-compaction figure would kill a turn that now
    // fits while naming a size that no longer exists.
    // What this round sends, measured once: the pre-compaction figure unless a compaction just ran. It rides the
    // round-start, so the meter shows the loop's own measure while the turn runs (BUG-20) — not the previous turn
    // plus every block streamed since.
    const heldNow = comp && (comp.usable > 0 || comp.window > 0) ? (compactRan ? measureConvo(comp) : convoTokens) : 0;
    if (comp && comp.window > 0 && heldNow > comp.window) {
      const overBy = heldNow;
      notes.push(`agent: stopped before round ${round + 1} — the request (≈${overBy.toLocaleString()} tokens with the system prompt and tools) cannot fit the ${comp.window.toLocaleString()}-token window even after compaction`);
      return endWith("stopped", {
        kind: "window",
        text: `(Filament: the turn reached the ${comp.window.toLocaleString()}-token context window and compaction cannot make the request fit (≈${overBy.toLocaleString()} tokens with the system prompt and tools); ${above("the work so far")}. Run /autofit to summarize the oldest turns into one, then send again — or send a smaller message, fold the earlier turns from the compaction card (/compaction), or switch to a model with a larger window.)`,
      });
    }
    round++;
    go("planning", `round ${round}`);
    // `blocksBefore` says how many reply blocks precede this round's own output — the page anchors the round's cards
    // between them and the next round's blocks, the order the wire spoke them in.
    emit({ type: "round-start", round, blocksBefore: sink.count(), ...(heldNow > 0 ? { context: heldNow } : {}) });
    let thinking = "";
    let text = "";
    // A visual is said while the model writes it (VS-D11): its title, its lines, its size so far.
    const drawing = offered.has(SHOW_VISUAL) ? visualWriting((news) => emit({ type: "visual-writing", round, ...news })) : null;
    // The input of the calls this round writes, counted as the model writes it (a file's whole text, an edit's): the
    // speed gauge's writing all the same (the owner's word of 10-27), said as it grows, at most every WRITING_MS — what
    // grew since is said once that time is up, and the rest as the call ends (`sayCalls`): pieces that come in one burst
    // are said whole (the Hunter's report of 10-27). A try asked again adds to the round's count, never starts it over:
    // what the broken try wrote was writing, and a count that went down would hold the gauge still.
    const callsWritten = { chars: 0, said: 0, at: 0 };
    /** The time set to say what grew since, while one is. @type {ReturnType<typeof setTimeout> | null} */
    let callsLater = null;
    const sayCalls = () => {
      if (callsLater) clearTimeout(callsLater);
      callsLater = null;
      if (callsWritten.chars <= callsWritten.said) return;
      callsWritten.at = Date.now();
      callsWritten.said = callsWritten.chars;
      emit({ type: "round-writing", round, chars: callsWritten.chars });
    };
    /** @param {import("../internal-call.js").CallPiece} c */
    const callWriting = (c) => {
      // The round's first piece opens the window, not says itself: a burst that ends within it is said whole, at the
      // call's end (the Hunter's find of 10-27: its first characters flashed first).
      if (!callsWritten.at && c.text) callsWritten.at = Date.now();
      callsWritten.chars += c.text.length;
      const wait = WRITING_MS - (Date.now() - callsWritten.at);
      if (wait <= 0) sayCalls();
      else if (!callsLater && callsWritten.chars > callsWritten.said) {
        callsLater = setTimeout(sayCalls, wait);
        callsLater.unref?.();
      }
    };
    /**
     * A memory call Filament ran inside the round's model call (the owner's of 10-29): the reply never carries it, so the
     * round says it as a call, begun and ended as it ran — what it was asked on its card, what came back as its preview,
     * redacted as a memory card's words are. It is not one of the loop's calls: no tally of those counts it.
     * @param {import("../../services/call-waits.js").MemoryCall} c
     */
    const memoryRan = (c) => {
      const out = redactSecrets(String(c.output ?? ""));
      const preview = previewOf(out);
      emit({ type: "tool-start", round, name: c.name, args: argSummary(c.name, c.input), id: c.id, input: c.input });
      emit({ type: "tool-end", round, name: c.name, ok: c.ok, ms: c.ms, id: c.id, chars: out.length, ...(preview != null ? { preview } : {}) });
    };
    /** The reply's room for one round: max_tokens clamped to what remains of the window after the request's own
     * input — the composer's own rule, applied per round because the compaction line is a percentage of the full
     * window. Without it a round near the line would ask for output the window cannot hold and spend the
     * overflow recovery on a refusal the clamp prevents. Floored at the reply floor (1,024) so the clamp never
     * makes a round unsendable — and never over max_tokens itself: a client that asked for less than the floor gets
     * what it asked for (TG2-D62's tests found the floor raising 50 to 1,024). Measured fresh at call time, so a
     * folded retry clamps against the smaller convo. */
    const roundCap = () => {
      if (!comp || !(comp.window > 0)) return maxTokens;
      const held = measureConvo(comp);
      const room = comp.window - held;
      if (room <= 0) return maxTokens;
      const cap = Math.min(maxTokens, Math.max(1024, room));
      if (cap < maxTokens && !capNoted) {
        capNoted = true;
        notes.push(`agent: max_tokens ${maxTokens.toLocaleString()} clamped to ${cap.toLocaleString()} — the request is ≈${held.toLocaleString()} of the ${comp.window.toLocaleString()}-token window`);
      }
      return cap;
    };
    /**
     * One round's model call: the system prompt, the conversation and the tools, the reply's room clamped (`roundCap`).
     * @param {(q: import("../../services/call-waits.js").QueueNews | null) => void} onQueue  its wait for a slot, said
     */
    const callRound = (onQueue) => {
      const cap = roundCap();
      capAsked = cap;
      // The provider wants the thinking budget under max_tokens: a clamp below the budget drops thinking for the
      // round rather than send a pair it must refuse.
      const think = thinkingParam && Number(thinkingParam.budget_tokens) >= cap ? null : thinkingParam;
      return call({
        // A model that takes no tools gets no tools field at all (HarnessV4_Tasks E4): some refuse even an empty one.
        body: { model, max_tokens: cap, ...(think ? { thinking: think } : {}), system: a.system, messages: convo, ...(tools.length ? { tools } : {}) },
        weights: sending,
        signal: cut,
        onQueue,
        onMemory: memoryRan,
        onCall: (c) => {
          drawing?.piece(c);
          callWriting(c);
        },
        onDelta: (d) => {
          if (d.kind === "thinking") {
            thinking += d.text;
            sink.thinking(d.text);
          } else if (d.kind === "signature") sink.signThinking(d.text);
          else {
            text += d.text;
            if (d.text) replied = true;
            sink.text(d.text);
          }
        },
      });
    };
    /**
     * A round whose stream broke part-way, asked again (HarnessV3-FailurePoints FP-D6): what it had streamed leaves the
     * round, so its result, the conversation and the archive hold the next try's answer — a model call has no side
     * effects. The client already has the words: they stay on its page, closed off by a line that says the stream broke
     * there (`BROKE_LINE`). Returns what was dropped, in words.
     */
    const dropBroken = () => {
      const dropped = [thinking ? `${thinking.length.toLocaleString()} characters of thinking` : "", text ? `${text.length.toLocaleString()} characters of text` : ""].filter(Boolean).join(" and ");
      sink.endBlock();
      if (text) textBlocks++;
      sink.text(BROKE_LINE);
      sink.endBlock();
      textBlocks++;
      thinking = "";
      text = "";
      return dropped;
    };
    /**
     * The round's call, tried again while its provider is busy for a moment and nothing of the round has streamed
     * (HarnessV3-AtHome AH-F4), and when its stream broke part-way on the provider's side — a dropped connection, a
     * 5xx, an overload; never a 4xx, which is the request's own fault (FP-D6, `dropBroken`). Each wait is said
     * (`saidWaits`), its waits for a slot too (AH-F5); a stop or the hang-up ends it, and the last failure is the
     * answer. While it is in flight a Force stop cuts it as a stop does (`inFlight`).
     */
    const callTrying = async () => {
      const said = saidWaits(`round ${round}`);
      inFlight = cutHere;
      try {
        return await withRetries(
          async () => {
            /** @type {Awaited<ReturnType<typeof callRound>>} */
            let sent;
            try {
              sent = await callRound(said.queue);
            } finally {
              // What its calls wrote since they were last said is said as the call ends, before the round's count.
              sayCalls();
            }
            if (sent.id) roundIds.push(sent.id);
            return sent;
          },
          {
            signal: cut,
            again: (r) => !(rateMovesOn && round === 1 && r.status === 429) && ((thinking === "" && text === "") || r.status >= 500),
            onWait: (w) => {
              if (w) drawing?.drop();
              said.retry(w && (thinking || text) ? { ...w, words: `${w.words}; what it had streamed (${dropBroken()}) is dropped` } : w);
            },
          },
        );
      } finally {
        inFlight = null;
      }
    };
    /**
     * The round a stop cut: its open block closes, and the words it had streamed are the reply, ahead of
     * the note — the developer read them, so the archive and the next turn's model keep them too (HarnessV3-Launch F27:
     * the note alone said "what was finished is above" over words the archive had lost). Its thinking, cut before its
     * signature, is not kept.
     */
    const cutHere = () => {
      sink.endBlock();
      closingReply = text ? [{ type: "text", text }] : [];
    };
    /**
     * A model call's failure classified for the turn: the turn's result when the call's death IS the turn's end
     * (the client gone; the harness's stop), null when the error should fly — an ordinary failure fails the turn
     * at its own site, with its own words, as the provider gave them. One classification,
     * shared by the first call and the overflow retry.
     * @param {any} e
     */
    const classified = (e) => {
      if (aborted()) return endWith("aborted", null, "the client disconnected");
      // The harness's stop cut the call: what streamed stays on the page, and the turn ends stopped in its words.
      if (stopCut()) {
        cutHere();
        return stopHere();
      }
      return null;
    };
    /**
     * The round's call failed — the provider's error answer, or a throw (a network break, Filament's own time limit):
     * the turn ends failed in one shape (HarnessV3-FailurePoints §5.2), keeping its work (§6 item 1). What it had
     * streamed is the reply, as a stop's is. `cause`: what the failure says of its provider (HarnessV3-TaskGraph-v2
     * TG2-D54) — a wall's, or a model's its provider refuses this account, was not tried again, and its words and the
     * record say so.
     * @param {{ said: string, code?: string | null, status?: number | null, tries?: number | null, upstream?: string | null, cause?: import("../../core/provider-cause.js").Cause | null }} f
     */
    const failedRound = ({ said, code = null, status = null, tries = null, upstream = null, cause = null }) => {
      cutHere();
      const failure = worded({ what: `round ${round}'s model call`, where: upstream && !model.startsWith(`${upstream}/`) ? `${model} at ${upstream}` : model, said, code, status, tries, began: callBegan, at: Date.now(), streamed: { thinking: thinking.length, text: text.length }, kept: keptRounds(round), next: null, ...(cause ? { cause: { kind: cause.kind, provider: upstream, resets: cause.resets } } : {}) });
      const wall = isFinal(cause) ? `${upstream || "its provider"}: ${cause?.kind}, not tried again — ` : "";
      notes.push(`agent: round ${round} failed${tries && tries > 1 ? ` after ${tries} tries` : ""} (${wall}${String(said).slice(0, 120)})`);
      return endWith("failed", null, failureLine(failure), failure);
    };
    /** A round's call that threw, said in words. @param {any} e */
    const thrown = (e) => failedRound(saidOf(e));
    const callBegan = Date.now();
    /** @type {Awaited<ReturnType<typeof callTrying>>} */
    let got;
    try {
      got = await callTrying();
    } catch (/** @type {any} */ e) {
      return classified(e) || thrown(e);
    }
    let r = got.r;
    let j = r.json;
    if (aborted()) return endWith("aborted", null, "the client disconnected");
    // A call the stop cut that answered instead of throwing, or a wait to try again it cut; a reply that came back
    // whole goes on to preflight(), which stops the turn before any of its tools run.
    if (stopCut() && (!r.ok || !j || !Array.isArray(j.content))) {
      cutHere();
      return stopHere();
    }
    if (!r.ok || !j || !Array.isArray(j.content)) {
      sink.endBlock();
      let failure = j?.error?.message || `HTTP ${r.status}`;
      /** The round sent again after a recovery: null to go on with what the retry left in `r`, `j` and `failure`
       * (the surfaced failure is the one the retry met), or the turn's end when the hang-up or the stop cut it. */
      const sendAgain = async () => {
        try {
          got = await callTrying();
        } catch (/** @type {any} */ e2) {
          return classified(e2) || thrown(e2);
        }
        r = got.r;
        j = r.json;
        const ended = got.cut ? classified(null) : null;
        if (ended) return ended;
        if (!r.ok || !j || !Array.isArray(j.content)) failure = j?.error?.message || `HTTP ${r.status}`;
        return null;
      };
      // Image recovery (TL-D17): a provider that refuses images (a text-only model) refuses the whole round with a
      // 400-class error. When the round carries images the turn's work put there — a tool's result, or a picture the
      // developer sent while the turn ran — and nothing streamed, they are withdrawn, each replaced by a line quoting
      // the refusal, and the round is sent once more: the work goes on, and nothing kept of the turn holds an image
      // its model refuses. No model's abilities are guessed: the provider's refusal of this request is the evidence.
      // A size refusal is the overflow door's.
      if (thinking === "" && text === "" && IMAGE_REFUSALS.has(Number(r.status)) && !detectOverflow(failure)) {
        const line = `[the image was not sent: the provider refused the request with it: "${String(failure).slice(0, 200)}"]`;
        const was = convo.slice();
        const { n: withdrawn, sent } = withdrawImages(convo, line);
        unbindThinking(convo, firstChange(was, convo));
        if (withdrawn) {
          imagesRefused = line;
          refusedSaid = String(failure).slice(0, 200);
          const whose = !sent ? " from tool results" : sent === withdrawn ? " the developer sent while the turn ran" : ` (${sent} of them the developer's, sent while the turn ran)`;
          notes.push(`agent: round ${round} was refused with ${withdrawn} image${withdrawn === 1 ? "" : "s"}${whose} (${String(failure).slice(0, 120)}) — retrying once without ${withdrawn === 1 ? "it" : "them"}; the turn's later images are sent as words`);
          if (sent && pictured.length) emit({ type: "steer-pictures", round, ids: pictured.splice(0), refused: refusedSaid });
          const ended = await sendAgain();
          if (ended) return ended;
        }
      }
      // Overflow recovery, the loop's own — the loop is the client of its own rounds, so this is the one
      // window manager for the conversation: a round the provider refused for size is cleared (old tool
      // results), compacted (the oldest work rounds fold into one summary) and retried once. Only when nothing
      // of the round streamed — a refusal arrives before the first delta — so the transcript stays truthful.
      if (a.compact && !overflowRetried && thinking === "" && text === "" && detectOverflow(failure)) {
        overflowRetried = true;
        // A side agent clears no results: it compacts by itself, all of its work in one summary.
        const cleared = a.compact.self ? { cleared: 0, messages: convo } : clearResults(convo, { keepRecent: 5 });
        if (cleared.cleared) {
          const was = convo.slice();
          convo.splice(0, convo.length, ...cleared.messages);
          toldHere.clear();
          unbindThinking(convo, firstChange(was, convo));
        }
        // The same order as at the line (HarnessV4_Tasks C33): the earlier turns first where they are the bigger
        // part; the steps fold too unless that brought the conversation back under its line.
        const made = earlierIsBigger(a.compact) ? await compactEarlier(a.compact, "overflow") : "none";
        if (made === "cut") return endCut();
        const under = made === "compacted" && a.compact.usable > 0 && measureConvo(a.compact) < a.compact.usable;
        const second = under ? "little" : await foldWork(a.compact, "overflow");
        if (second === "cut") return endCut();
        lastCompactAfter = measureConvo(a.compact);
        const folded = second === "compacted";
        notes.push(`agent: round ${round} was refused for size (${failure.slice(0, 120)}) — retrying once${cleared.cleared ? `, after clearing ${cleared.cleared} old tool result${cleared.cleared === 1 ? "" : "s"}` : ""}${made === "compacted" ? `, after ${earlierWords(a.compact)} gave way` : ""}${folded ? " and summarizing the oldest rounds into one" : ""} (≈${lastCompactAfter.toLocaleString()} tokens estimated)`);
        emit({ type: "compaction", round, why: "overflow-refusal", cleared: cleared.cleared, folded });
        const ended = await sendAgain();
        if (ended) return ended;
      }
      // A thinking block the provider says is bound to another conversation (seen live 10-25: "Invalid `signature` in
      // `thinking` block. The block is bound to a different conversation"): something before it changed since it was
      // made, by a way the loop does not know of. Nothing streamed: the conversation's thinking blocks leave — the
      // provider's own advice — and the round is sent once more.
      if (!unboundRetried && thinking === "" && text === "" && (!r.ok || !j) && STALE_THINKING.test(String(failure))) {
        unboundRetried = true;
        const n = unbindThinking(convo, 0);
        if (n) {
          notes.push(`agent: round ${round} was refused for a thinking block bound to an earlier form of the conversation (${String(failure).slice(0, 120)}) — retrying once without its ${unboundWords(n)}`);
          const ended = await sendAgain();
          if (ended) return ended;
        }
      }
      if (!r.ok || !j || !Array.isArray(j.content))
        // The tries it took, and a Retry-After it did not wait out, are said with the provider's words (AH-F4), and
        // what they say of the provider with them (TG2-D54).
        return failedRound({ said: `${got.tooLong ? `${got.tooLong} — ` : ""}${failure}`, status: r.status, tries: got.tries, upstream: r.upstream ?? null, cause: causeOf(r) });
    }
    // The assembled reply is the truth for the transcript: a streaming upstream delivered the same bytes as deltas, a
    // JSON one delivered nothing until now. Whatever the deltas missed is written into the open block before it
    // closes; deltas the assembled text does not start with (never seen; guarded anyway) are followed by the whole
    // assembled text in a block of its own rather than a spliced tail.
    const fullText = j.content.filter((b) => b?.type === "text").map((b) => b.text).join("");
    const fullThinking = j.content.filter((b) => b?.type === "thinking").map((b) => b.thinking).join("");
    const signature = j.content.find((b) => b?.type === "thinking" && b.signature)?.signature || null;
    if (fullThinking !== thinking) {
      if (fullThinking.startsWith(thinking)) sink.thinking(fullThinking.slice(thinking.length));
      else {
        sink.endBlock();
        sink.thinking(fullThinking);
      }
    }
    if (signature) sink.signThinking(signature);
    if (fullText !== text) {
      if (fullText.startsWith(text)) sink.text(fullText.slice(text.length));
      else {
        sink.endBlock();
        sink.text(fullText);
      }
    }
    sink.endBlock();
    if (fullText) replied = true;
    closingReply = fullText ? [{ type: "text", text: fullText }] : [];
    const u = j.usage || {};
    const inTok = Number(u.input_tokens) || 0;
    const readTok = Number(u.cache_read_input_tokens) || 0;
    const wroteTok = Number(u.cache_creation_input_tokens) || 0;
    // Round one's prompt is the request the client actually sent — its cache columns belong on the parent record
    // (the meter, the tray and traffic read the parent, and without these an agent turn reads as "no cache ever").
    // "Nothing captured yet", not "!firstIn": a fully-cached round one reports input_tokens 0 with cache_read > 0,
    // and keying on input alone would drop the cache or capture a later round as "first".
    // Whether the round's usage carried its cache counts, as its record says: the reply's usage here is Filament's own
    // translation, which writes a 0 where the provider said nothing. One that read or wrote any said them by that, and
    // a loop given no such reader takes the figures.
    const saidCache = cacheSaidOf ? readTok + wroteTok > 0 || cacheSaidOf(r.id) : true;
    if (!firstIn && !firstCacheRead && !firstCacheWrite) {
      firstIn = inTok;
      firstCacheRead = readTok;
      firstCacheWrite = wroteTok;
      firstCacheSaid = saidCache;
    }
    // The round's prompt as its provider counted it: the Cache instrument's last request from now on, where its usage
    // said its cache numbers.
    if (saidCache && inTok + readTok + wroteTok > 0) emit({ type: "round-cache", round, input: inTok, cacheRead: readTok, cacheWrite: wroteTok });
    // Everything the model was sent this round: what it read from or wrote to the provider's cache with the uncached
    // input, as a turn's record and a coding agent's sub-agent count theirs.
    totalIn += inTok + readTok + wroteTok;
    totalOut += Number(u.output_tokens) || 0;
    spent += costOf(r.id);
    // What the round wrote as its provider counted it — its thinking and its calls' input too, which the stream shows
    // little or nothing of — and the time it wrote: the speed gauge's figure round by round.
    if (Number(u.output_tokens) > 0) emit({ type: "round-written", round, output: Number(u.output_tokens), ms: writingOf?.(r.id) ?? null });
    if (fullThinking) emit({ type: "round-thinking", round, thinking: fullThinking });
    if (fullText) {
      emit({ type: "round-text", round, text: fullText, block: textBlocks });
      textBlocks++;
    }
    // A reply cut at its ceiling (HarnessV3-TaskGraph-v2 TG2-D62) goes on by itself, as Claude Code's does: what was
    // finished stays and its calls run, the model hears what was cut, and the reply says where. A cut whose round ran
    // nothing, straight after another such cut, ends the turn: the model did not fit its next step in one reply.
    let cutSaid = "";
    if (j.stop_reason === "max_tokens") {
      const c = cutReply(j.content);
      const ran = c.kept.filter((b) => b?.type === "tool_use").length;
      if (!ran && idleCut?.round === round - 1) return budgetStop("output", capAsked, maxTokens, twiceCutLine(idleCut.cut, c, capAsked, maxTokens, replied));
      if (c.part === "call" && c.tool === SHOW_VISUAL && c.id) drawing?.drop(c.id);
      emit({ type: "output-cut", round, at: capAsked, limit: maxTokens, by: capAsked < maxTokens ? "window" : "ceiling", part: c.part, ...(c.tool ? { tool: c.tool } : {}), ...(c.chars ? { chars: c.chars } : {}), ran });
      notes.push(`agent: round ${round}'s reply was cut at ${cutAtWords(capAsked, maxTokens)}${capAsked < maxTokens ? "," : ""} ${cutPartShort(c)} — Filament went on`);
      sink.endBlock();
      sink.text(cutLine(capAsked < maxTokens));
      sink.endBlock();
      textBlocks++;
      j = { ...j, content: c.kept };
      cutSaid = cutNote(c, capAsked, maxTokens, ran);
      idleCut = ran ? null : { round, cut: c };
    }
    // A call through the mcp tool runs as the server's own tool's (E49); the conversation keeps the reply as made.
    const uses = j.content.filter((b) => b?.type === "tool_use").map((u) => unwrapDoor(u, mcpDoor));
    // The model has read the look it was given.
    unheard = null;
    if (cutSaid && !uses.length) {
      // Nothing of the cut reply runs. Its words join the work where it wrote some; else the note rides the newest
      // message — the turn's own work's, or the model's copy of the client's message when the turn's first reply was
      // cut — so the conversation's roles still alternate.
      const last = convo.at(-1);
      const note = { type: "text", text: cutSaid };
      if (j.content.some((b) => b?.type === "text" && b.text)) convo.push({ role: "assistant", content: j.content }, { role: "user", content: [note] });
      else if (last?.role === "user") last.content = [...(Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content ?? "") }]), note];
      else convo.push({ role: "user", content: [note] });
      closingReply = [];
      go("acting", "the reply was cut at its ceiling");
      continue;
    }
    if (!uses.length) {
      // A note of the person's that a fork weighs aside (the owner's forked steer of 11-04): the turn does not end before
      // its verdict — a correction reads below, as a note that came late; a letter the fork wrote rides the inbox.
      const weighing = mailbox?.weighed?.() || null;
      if (weighing) {
        const ended = await waitOut(weighing, "weighing your message aside", { reports: false });
        if (ended) return ended;
      }
      // Sub-agents: the turn does not end while its own background launches (or the developer's paused one) still
      // run. Their reports — and any that arrived meanwhile — reach the model as one more message, and the turn goes on.
      if (inbox) {
        const owed = inbox.owed();
        // The loop waited at its turn's end for its own agents: what is sealed opens, oldest first, then what came
        // (HarnessV4_Envelopes_Plan case 7). With nothing to wait for it works no more either: a result that came as
        // its last reply was written is opened, the sealed ones ahead of it — and with none, they stay sealed for the
        // reminder, which rides with whatever else came (EN-D5).
        let waited = false;
        if (owed) {
          const ended = await waitOut(owed, inbox.owedWhy?.() || "waiting for sub-agents to report");
          if (ended) return ended;
          waited = true;
        }
        /** @type {any[]} */
        const content = [];
        if (takeInbox(content, { seal: false, end: !waited }) || heard.length || (waited && !!shellDue?.())) {
          if (deliveredWrites) await snapshotRound([]);
          const b = await boundary(content, heard);
          heard = [];
          if (b.stop) return stopped(b.stop);
          if (!reminded && !waited) {
            const r = sealedReminder(inbox.sealed?.() || []);
            if (r) {
              reminded = true;
              content.push({ type: "text", text: r });
              emit({ type: "envelope-reminder", round, envelopes: (inbox.sealed?.() || []).map((e) => e.n) });
            }
          }
          convo.push({ role: "assistant", content: keptReply(j.content) });
          closingReply = [];
          convo.push({ role: "user", content });
          // The turn had ended on this reply: the page shows it outside the work (`woke`, the owner's of 11-05), as it does
          // every reply the turn went on past below — never one cut at its ceiling, which ended nothing.
          go("acting", "sub-agent reports", { woke: true });
          continue;
        }
      }
      // What the developer typed while this round ran (HarnessV3-CodebasePass decision 3): the model answered without
      // it, and ending here would leave it unread — the message is the developer's turn to speak, so the turn goes one
      // more round with it, in the words the round boundary uses. A Compact stays queued (it acts at a boundary).
      // A note a wait above read where no inbox took it rides with them. One typed while the turn waited for its agents
      // above, and weighed aside since, is waited for here: a correction joins them.
      const weighingLate = mailbox?.weighed?.() || null;
      if (weighingLate) {
        const ended = await waitOut(weighingLate, "weighing your message aside", { reports: false });
        if (ended) return ended;
      }
      const late = [...heard, ...(mailbox ? sieve(mailbox.read((m) => m.kind === "note" || m.kind === "veto")) : [])];
      heard = [];
      if (late.length) {
        /** @type {any[]} */
        const content = [];
        const b = await boundary(content, late, "your reply");
        if (b.stop) return stopped(b.stop);
        convo.push({ role: "assistant", content: keptReply(j.content) });
        closingReply = [];
        convo.push({ role: "user", content });
        go("acting", late.every((m) => m.from === WATCHER) ? "a watcher's guidance" : "the developer's message", { woke: true });
        continue;
      }
      // Errors the language server found in a file the agent wrote or edited, come while the model wrote this reply:
      // ending here would leave them unread, so the turn goes one more step with them — not for words that only say
      // errors it knew of remain or are gone, which ask nothing of it.
      const lateErrors = errorsLater();
      if (lateErrors.listed) {
        convo.push({ role: "assistant", content: keptReply(j.content) });
        closingReply = [];
        convo.push({ role: "user", content: [{ type: "text", text: lateErrors.text }] });
        go("acting", "errors the language server found late", { woke: true });
        continue;
      }
      // Envelopes still sealed as the turn would end (HarnessV4_Envelopes_Plan EN-D5, case 11): said once, and the next
      // end is the agent's — they wait for its next turn, which lists them.
      if (inbox && !reminded) {
        const list = inbox.sealed?.() || [];
        const r = sealedReminder(list);
        if (r) {
          reminded = true;
          convo.push({ role: "assistant", content: keptReply(j.content) });
          closingReply = [];
          convo.push({ role: "user", content: [{ type: "text", text: r }] });
          notes.push(`agent: ${list.length} envelope${list.length === 1 ? " was" : "s were"} still sealed as the turn would end — said once`);
          emit({ type: "envelope-reminder", round, envelopes: list.map((e) => e.n) });
          go("acting", "sealed envelopes", { woke: true });
          continue;
        }
      }
      // A sub-agent's background commands that still run as its turn would end (the friction of 11-09): said once each,
      // and the next end is its own — their ends go to whoever launched it once its run is over.
      const shellsLeft = (shellsRunning?.() || []).filter((s) => !shellsSaid.has(s.id));
      if (shellsLeft.length) {
        for (const s of shellsLeft) shellsSaid.add(s.id);
        convo.push({ role: "assistant", content: keptReply(j.content) });
        closingReply = [];
        convo.push({ role: "user", content: [{ type: "text", text: shellsReminder(shellsLeft) }] });
        notes.push(`agent: background commands still ran as the turn would end (${shellsLeft.map((s) => s.id).join(", ")}) — said once`);
        go("acting", "background commands still running", { woke: true });
        continue;
      }
      // A graph task's sub-agent that would end without its report is asked for it, once: the runner fails a task that
      // ends without one.
      if (reports && !taskReport && !reportAsked) {
        reportAsked = true;
        convo.push({ role: "assistant", content: keptReply(j.content) });
        closingReply = [];
        convo.push({ role: "user", content: [{ type: "text", text: REPORT_ASK }] });
        notes.push("agent: asked for the task's report — the run would have ended without one");
        go("acting", "the task's report", { woke: true });
        continue;
      }
      // Turn-end hooks (§5.6) and the read-back judgement: a block sends the turn back for one more round with the
      // notes as a message — once, so a hook that never passes cannot spin the turn.
      if (hooks && turnEndRounds < 1) {
        // A stop that landed by now comes first: the turn ends stopped, its hooks not run (the bug report's L4).
        if (stopCut()) return stopHere();
        const outcomes = await hooks.turnEnd(round, wroteThisTurn);
        for (const o of outcomes) noteHook(o);
        const blocks = outcomes.filter((o) => o.verdict === "block");
        const unread = hooks.readBackBeforeDone ? unreadWrites() : [];
        if (blocks.length || unread.length) {
          turnEndRounds++;
          convo.push({ role: "assistant", content: keptReply(j.content) });
          closingReply = [];
          const lines = blocks.map((o) => `[Filament ${o.on} hook ${hookLabel(o)}${o.builtin ? ` (${o.builtin})` : ""} → block${o.exit != null ? `, exit ${o.exit}` : ""}]\n${o.note || "(no output)"}`);
          if (unread.length) lines.push(`[Filament: loop.verify.readBackBeforeDone] Read these files back before you finish and confirm they are as intended: ${unread.join(", ")}`);
          convo.push({ role: "user", content: [{ type: "text", text: lines.join("\n\n") }] });
          notes.push(`agent: the turn went back for one more round (${blocks.length} turn-end hook block${blocks.length === 1 ? "" : "s"}${unread.length ? `, ${unread.length} file${unread.length === 1 ? "" : "s"} not read back` : ""})`);
          go("acting", "turn-end hook", { woke: true });
          continue;
        }
      }
      notes.push(`agent: done after ${round} round${round === 1 ? "" : "s"} and ${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`);
      return endWith("done", null);
    }
    convo.push({ role: "assistant", content: j.content });
    closingReply = [];
    go("acting", `${uses.length} tool call${uses.length === 1 ? "" : "s"}`);
    const pre = preflight();
    if (pre.stop) {
      // None of the reply's calls ran; the archived trajectory still answers each tool_use, or the next turn's
      // history would carry an open call.
      convo.push({ role: "user", content: notRun(uses) });
      return stopped(pre.stop);
    }
    heard = [...heard, ...pre.notes];
    const ran = pre.veto ? { results: vetoRound(uses, pre.veto), pause: null, question: "", stop: false } : await runTools(uses, [], 0);
    if (ran.stop) {
      await snapshotRound(ran.results, { final: true });
      convo.push({ role: "user", content: inReplyOrder(convo.at(-1), ran.results) });
      return endWith("aborted", null, "the client disconnected");
    }
    if (ran.cut) {
      await snapshotRound(ran.results);
      convo.push({ role: "user", content: inReplyOrder(convo.at(-1), ran.results) });
      return stopHere();
    }
    if (ran.pause) return pauseWith(ran.pause, ran.question || "");
    go("observing", "results appended");
    await snapshotRound(ran.results);
    // A cut reply's finished calls ran (TG2-D62): what was cut is said after their results.
    if (cutSaid) ran.results.push({ type: "text", text: cutSaid });
    const b = await boundary(ran.results, heard);
    heard = [];
    convo.push({ role: "user", content: inReplyOrder(convo.at(-1), ran.results) });
    if (b.stop) return stopped(b.stop);
  }
}

/**
 * A round's results in its reply's order: the sub-agents and the reads that ran side by side were answered as each
 * ended, and each result goes back to its call's place; what the boundary added after the results (a message, a
 * shell's exit) stays after them.
 * @param {any} reply  the assistant message whose calls the results answer @param {any[]} results
 */
function inReplyOrder(reply, results) {
  const calls = reply.content.filter((/** @type {any} */ b) => b?.type === "tool_use").map((/** @type {any} */ b) => b.id);
  const answered = results.filter((r) => r?.type === "tool_result").sort((x, y) => calls.indexOf(x.tool_use_id) - calls.indexOf(y.tool_use_id));
  return [...answered, ...results.filter((r) => r?.type !== "tool_result")];
}

/** @param {string} id @param {string} text */
const errResult = (id, text) => ({ type: "tool_result", tool_use_id: id, is_error: true, content: text });

/** The statuses a provider refuses a request's content with — what a text-only model answers an image with. */
const IMAGE_REFUSALS = new Set([400, 415, 422]);
/** The line under what a broken stream had sent, on the client's page: the round is asked again (FP-D6, `dropBroken`). */
const BROKE_LINE = "(Filament: the provider's stream broke off here; the round is asked again.)";

/**
 * A reply that stopped at max_tokens, read (HarnessV3-TaskGraph-v2 TG2-D62): only its last block can be unfinished. A
 * thinking block there is dropped — cut before its signature, it cannot be sent back — and so is a call, whose input
 * is not whole (the stream's reader makes it `{}`); a text block there stays, as the developer read it. `kept` is the
 * reply as it joins the conversation, its finished calls with it; `part` says where the cut came.
 * @param {any[]} content
 * @returns {{ kept: any[], part: "thinking" | "call" | "text" | "nothing", chars: number, tool: string | null, id: string | null }}
 */
export function cutReply(content) {
  const last = content.at(-1);
  if (!last) return { kept: [], part: "nothing", chars: 0, tool: null, id: null };
  if (last.type === "thinking" || last.type === "redacted_thinking") return { kept: content.slice(0, -1), part: "thinking", chars: String(last.thinking ?? "").length, tool: null, id: null };
  if (last.type === "tool_use") return { kept: content.slice(0, -1), part: "call", chars: 0, tool: String(last.name || ""), id: last.id ? String(last.id) : null };
  return { kept: content, part: "text", chars: 0, tool: null, id: null };
}
/**
 * Messages weighed as they go on the wire (HarnessV3-TaskGraph-v2 TG2-D81): on the lane's learned scale, and with only
 * the thinking blocks its upstream is sent (`thinking`, routing.js `thinkingOnWire`). GLM's thinking, which no
 * OpenAI-format request carries, once counted 180K of a 200K window while the provider was sent 10K a call. A picture,
 * PDF or file weighs what the send puts on the wire for it (`media`, pdfs.js `mediaWeights`), decided for the request
 * the messages are part of (`whole`, the conversation itself unless said). `weights`: the turn's own
 * (`createBlockWeights`), so a block is weighed once however often the conversation is.
 * @param {any[]} messages
 * @param {{ factor?: number | null, thinking?: "all" | "signed" | "none", media?: ((messages: any[]) => (block: any) => string | null) | null } | null | undefined} c
 * @param {import("../../core/tokens.js").BlockWeights} weights
 * @param {any[]} [whole]
 */
const weighConvo = (messages, c, weights, whole = messages) => estimateBodyTokens({ messages }, "conversation", c?.factor, { thinking: c?.thinking || "all", weights, media: c?.media ? c.media(whole) : null });
/** What a reply was cut at: the model's own ceiling, or the room its window had left (`roundCap`). @param {number} at @param {number} ceiling */
const cutAtWords = (at, ceiling) => (at < ceiling ? `${at.toLocaleString()} tokens, the room the context window had left` : `the ${at.toLocaleString()}-token output ceiling`);
/** Where a reply was cut, in short. @param {ReturnType<typeof cutReply>} c */
const cutPartShort = (c) => (c.part === "thinking" ? "while thinking" : c.part === "call" ? `while writing its call to ${c.tool}` : c.part === "text" ? "in its text" : "before any of it came back");
/** Where a reply was cut, and what became of that part. @param {ReturnType<typeof cutReply>} c */
const cutPartWords = (c) =>
  c.part === "thinking" ? `while thinking: its ${c.chars.toLocaleString()} characters are not kept` : c.part === "call" ? `while writing its call to ${c.tool}: that call did not run` : c.part === "text" ? "in its text: what was written is kept" : "before any of it came back";
/** The line where a reply was cut, on the client's page. @param {boolean} window */
const cutLine = (window) => `(Filament: the reply was cut here at ${window ? "the room its context window had left" : "its output ceiling"}; Filament goes on.)`;
/**
 * What the model is told of its cut reply, after the results of the calls that ran.
 * @param {ReturnType<typeof cutReply>} c @param {number} at @param {number} ceiling @param {number} ran
 */
const cutNote = (c, at, ceiling, ran) =>
  `[Filament: your reply was cut at ${cutAtWords(at, ceiling)}${at < ceiling ? "," : ""} ${cutPartWords(c)}.${ran ? " Its other calls ran: their results are above." : ""} Go on from where you were. Keep each reply well short of the ceiling: put what you work out into files as you go, and write a long file in parts.]`;
/**
 * The turn's end at a second cut in a row with nothing run between: both said.
 * @param {ReturnType<typeof cutReply>} first @param {ReturnType<typeof cutReply>} second @param {number} at @param {number} ceiling @param {boolean} replied
 */
const twiceCutLine = (first, second, at, ceiling, replied) => {
  const same = first.part === second.part && first.tool === second.tool;
  const where = same ? `${cutPartShort(second)} both times` : `first ${cutPartShort(first)}, then ${cutPartShort(second)}`;
  return `(Filament: the reply was cut at ${cutAtWords(at, ceiling)}${at < ceiling ? "," : ""} twice in a row, ${where}, and nothing ran between: the model did not fit its next step in one reply.${replied ? " What was finished is above." : ""} Send another message to continue; asking for the work in smaller steps helps.)`;
};
/**
 * Every image a turn's work put into the conversation replaced by `line` (TL-D17): those in tool results, and the
 * pictures the developer sent into a running turn — the images of a message that holds Filament's relay of their
 * words (`STEERING_HEAD`). Message by message so nothing shared with the turn's record is changed in place; the
 * attachments of a message the developer began a turn with stay. Returns how many went (`n`), and how many of them
 * were the developer's (`sent`).
 * @param {any[]} convo @param {string} line
 */
function withdrawImages(convo, line) {
  let n = 0;
  let sent = 0;
  for (let i = 0; i < convo.length; i++) {
    const m = convo[i];
    if (m?.role !== "user" || !Array.isArray(m.content)) continue;
    const relayed = m.content.some((/** @type {any} */ b) => b?.type === "text" && typeof b.text === "string" && b.text.startsWith(STEERING_HEAD));
    let changed = false;
    const content = m.content.map((/** @type {any} */ b) => {
      if (relayed && b?.type === "image") {
        changed = true;
        n++;
        sent++;
        return { type: "text", text: line };
      }
      if (b?.type !== "tool_result" || !Array.isArray(b.content) || !b.content.some((/** @type {any} */ x) => x?.type === "image")) return b;
      changed = true;
      return { ...b, content: b.content.map((/** @type {any} */ x) => (x?.type === "image" ? (n++, { type: "text", text: line }) : x)) };
    });
    if (changed) convo[i] = { ...m, content };
  }
  return { n, sent };
}
/** The provider's words for a thinking block whose earlier conversation changed since it was made. */
const STALE_THINKING = /bound to a different conversation|Invalid `signature` in `thinking` block/i;
/** "3 thinking blocks". @param {number} n */
const unboundWords = (n) => `${n} thinking block${n === 1 ? "" : "s"}`;
/**
 * The thinking blocks a rewrite left unable to go back: a provider binds each to the conversation before it as it was
 * when the block was made (seen live 10-25, a sub-agent's round after its fold: "The block is bound to a different
 * conversation"). Every one in a reply from `from` on leaves — where the loop changed what comes before it: a fold, the
 * earlier turns given way, results cleared, an image withdrawn, a look tidied. Message by message, so nothing shared
 * with the turn's record is changed in place; a reply that held only thinking keeps a line, as stripThinking's do.
 * @param {any[]} convo  changed in place @param {number} from  the first message the rewrite changed; -1 for none
 * @returns {number}  how many left
 */
export function unbindThinking(convo, from) {
  if (from < 0) return 0;
  let n = 0;
  for (let i = from; i < convo.length; i++) {
    const m = convo[i];
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    const content = m.content.filter((/** @type {any} */ b) => b?.type !== "thinking" && b?.type !== "redacted_thinking");
    if (content.length === m.content.length) continue;
    n += m.content.length - content.length;
    convo[i] = { ...m, content: content.length ? content : [{ type: "text", text: "(thinking)" }] };
  }
  return n;
}
/**
 * The first message a rewrite changed — the first that is not the one it was —, -1 where none did; past the shorter
 * one where only the end changed. @param {readonly any[]} before @param {readonly any[]} after
 */
export function firstChange(before, after) {
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) if (before[i] !== after[i]) return i;
  return before.length === after.length ? -1 : n;
}
/**
 * What a telling of the shells' news held, for the record's line: the exits, the watched lines, the times the agent
 * set, Filament's check-in on a command that still runs, the person's Cancel of a come-back.
 * @param {readonly { kind?: string }[]} news
 */
const toldWords = (news) => {
  const n = (/** @type {string} */ k) => news.filter((x) => (x.kind || "exit") === k).length;
  const [exits, lines, wakes, idles, cancels] = [n("exit"), n("lines"), n("wake"), n("idle"), n("cancel")];
  return [
    exits ? `${exits} background shell exit${exits === 1 ? "" : "s"}` : "",
    lines ? `the lines ${lines === 1 ? "a watch" : `${lines} watches`} caught` : "",
    wakes ? `the time it set to come back` : "",
    idles ? `Filament's check-in on its running commands` : "",
    cancels ? `the person's Cancel of its come-back` : "",
  ].filter(Boolean).join(", ");
};
/**
 * The calls that only read and run beside each other in a reply (`onlyReads`), MCP tools a server vouches for aside:
 * a sub-agent that called nothing else may be sent anew on another model (subagents.js `movesOn`).
 */
export const SIDE_BY_SIDE = new Set(["read", "grep", "glob", "lsp", "web_fetch", "web_search", "delegate_read", MCP_RESOURCES]);
/** At most this many reads run at once, as Claude Code caps its own; a longer run of them goes in groups. */
export const READS_AT_ONCE = 10;
/** A call the developer's stop came before; the harness reads these exact words after a reload (`stoppedResult`). */
const NOT_RUN = "Not run: the developer stopped the turn before it ran.";
/** A call the client's hang-up came before (the bug report's P5): the harness reads it as Not run too. */
const NOT_RUN_GONE = "Not run: the client disconnected before it ran.";
/** A call a Force stop found running: its result never came back (the harness reads these words as Stopped too). */
const FORCE_CUT = "Stopped: the developer force-stopped the turn while this call ran; its result was not kept.";
const FAILED_CUT = "Not finished: the turn failed while this call ran; its result was not kept.";
/**
 * Filament's line at the end of the result of the call that changed a turn's second file, where the agent keeps neither
 * a checklist nor a task graph (the owner's of 11-09). The prompt's rule asks for one before work of more than one step
 * (prompt.js plan, planOrGraph, planOnGraph), yet glm-5.3 and glm-5.3-flash planned nothing in 7 runs of 16 with it
 * (scripts/tool-text-eval.mjs, the steps probe of 11-08): said where the work shows it, on the newest result, so the
 * system prompt and every earlier message stay what the provider cached.
 */
export const UNPLANNED_LINE = "(Filament: this work has more than one step — you changed a second file, and keep neither a checklist nor a task graph. Before you go on, put its steps on your checklist with the plan tool, or, where the work branches, on your task graph with the tasks tool.)";

/**
 * Whether a conversation's words hold `s`: its messages' text, and the text of the results they carry.
 * @param {readonly any[]} convo @param {string} s
 */
function convoHolds(convo, s) {
  /** @param {any} b */
  const holds = (b) =>
    typeof b === "string" ? b.includes(s)
    : b?.type === "text" ? String(b.text ?? "").includes(s)
    : b?.type === "tool_result" ? (Array.isArray(b.content) ? b.content.some(holds) : String(b.content ?? "").includes(s))
    : false;
  return convo.some((m) => (Array.isArray(m?.content) ? m.content.some(holds) : holds(m?.content)));
}
