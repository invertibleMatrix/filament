// @ts-check
// HarnessV3-TaskGraph G2: the runner behind each session's task graph. The graph lives on the session's chain
// (`meta.graph`, TG-D7), and every change to it goes through here: the planner's tasks calls — the agent's, or a team's
// lead's (G3) — and what Filament does by itself. It starts the tasks' work as their needs are done and slots free, only
// while a turn of the session runs (G2-3): under the agent a sub-agent or an explorer, under a lead the team's
// worker of the task's role (G3-2). Before new work it runs the reviews that wait — a reviewer reads a change, and the
// changes it asks go back to the task's sub-agent (G3-3). A writer's change it never writes into the folder by itself
// (the owner's of 11-02): ready, it waits in its copy for its apply — the planner's call (`applyAsked`), which merges it
// here, one at a time in graph order (G2-5), or the developer's Apply (`applied`) — and the tasks that need it wait. It
// tells the planner each end in the graph's words, into its running turn or with its next, once the work that may start
// next has started (G2-7); a worker's end while others of the graph still work waits for theirs, so the planner wakes
// once for them all, and the verdict of an apply it asked wakes it at once. Each change goes out on the bus (topic "graph", with the
// graph's rev) for the pages that draw it. The developer's Stop holds the graph and stops its sub-agents (G2-8); a
// restart fails what it cut, and while Filament stops nothing new starts (G2-9).
//
// A task's check (HarnessV3-TaskGraph-v2 V2-1): the registry vets its commands as the call is read, and a worker's
// task is launched with its check granted — the registry runs it once the worker reports. The planner's own task, marked
// done, is checked here: the registry runs its check in a copy of the folder, in the background, and the verdict is told
// — the session's turn owes it meanwhile. A close runs every distinct check of its done tasks once more, told too.
//
// The gate (HarnessV3-TaskGraph-v2 V2-2, TG2-D2): a worker's change, once applied, merges through the registry's checked
// merge — the folder checked with it as a lead's apply is (TG2-D55) — and a merge that broke the folder's check is undone: its
// change goes back to its worker as a job (`gate`), as a review's asked changes do, twice at most. The planner's own
// task whose check passed adds its commands to the folder's check. The developer's Stop cuts a gate that runs.
//
// Command tasks (HarnessV3-TaskGraph-v2 V2-3, TG2-D4): no model does them. A ready one takes lanes, not model slots —
// as many as it has runs, of the lanes Filament has free (half the machine's cores, TG2-D65, shared by every session) —
// and the registry runs its commands in copies of the folder in the background, the turn owing it meanwhile. Its
// progress is kept as it goes, at most every two seconds, and its end is told. The developer's Stop sets it aside; a
// drop or a close cuts it and keeps nothing; Filament stopping fails it.
//
// The agent's checklist (HarnessV3-TaskGraph-v2 V2-5, TG2-D8): each plan call of the session's agent puts its items on
// the graph as tasks of its own (`plan`), kept and followed as a tasks call is — except that it lets go of no stop.
//
// Memory's open threads (HarnessV4_GraphThreads E28): a task may name the thread it finishes, checked by memory's word
// (`threads.of`) as the call is read. Each keep of the graph closes the threads of the tasks it made done
// (`threads.close`, with each one's summary), and what came of each close is kept on its task and drawn.
//
// What is kept behind the graph (HarnessV4_TaskNotes_Plan E33): a keep or a read goes to the graph's notes
// (graph-notes.js) — it changes nothing in the graph and lets go of no stop — and the graph's words and its page mark
// what each task keeps.
//
// The developer's side run (the Designer's of 10-27, built 10-28): the Plan page's sheet gives the planner's own ready
// tasks to sub-agents — all or none — launched here at once or once the planner's turn ends, with no turn of its own
// needed, so a coding agent's chat runs them too. The graph claims them, the planner is told in a note added to its
// turn, and their ends come back as any graph task's do, a change waiting in its copy for its apply. On the planner's own
// model each starts as the planner's fork where that pays, as its own tasks do. The side-by-side card (Phase 5) offers
// the same run in the transcript: the agent puts it, with its tasks tool's `parallel` (the owner's of 11-10: never
// Filament by itself), its Accept is the side run, its Ignore lets it go (`ignoreOffer`). Unanswered for 60 seconds it
// answers itself (`answerCard`, the plan of 11-14): a timer here, set as it is kept and again as Filament starts.
//
// A Hunter fired from a task (the owner's of 11-02): its launch reads the task here (`huntedTask`) — a done one — and a
// task its finding names (`found_by`) is checked by the registry's word on the hunt (`registry.huntOf`) as the call is
// read.
import { availableParallelism } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { COMMAND, MERGED_TWICE, cardGone, carriedAway, carriedGraph, carryRefusal, findText, endHeard, idleHeard, endSaid, fromHeard, planGo, rollUp, waitedOn, ignoredNote, offerIgnored, sideOfferOf, sideTimeoutWhy, sideTimedNote, helperRefusal, helperTook, rebaseRefusal, sentToRebase, sideApplied, waitsForYou, sideBack, sideBackNote, sideNote, sidePending, sideRun as claimSide, agentsAtWork, agentsToStop, applyAsked, applyPlan, proposeTasks, applyTasks, asMeant, meantWords, WHERE_ROOM, whereText, briefText, busy, changedText, changeOf, checked, checkingIds, checkpointKept, closeChecked, closeChecksText, closeRuns, commandEnded, commandProgress, commandRuns, commandStarted, endText, fixLaunched, fixText, gateBackText, gateLaunched, gateOf, gateStepRefused, gateUndone, graphView, hold, holdsAgent, jobs, launched, launchRefused, markRefusal, mergeNext, onTaskText, outsideHeard, outsideOwnWrites, ownWorkText, openGraphText, hasOpenTasks, release, restartCut, resumed, resumeRefused, resumeText, reviewAgainText, reviewBrief, reviewEnded, reviewLaunched, reviewStepRefused, runsAs, slotEnded, slotWaited, spanClosed, spanOpened, startedText, stepsRefused, stepsTask, taskEnded, taskMergeFailed, taskMerged, threadEnded, threadsToClose, turnBegun, leftIdle, uncommittedRead } from "../../core/task-graph.js";
import { reviewerOf, workerOf } from "../../core/roster.js";
import { READERS, compose, tickText } from "./checkpoint.js";
import { uncheckedWords } from "./grants.js";
import { leftOutWords } from "../../services/memory/goal.js";
import { appliedWrites, changeBlock, changeNote, folderList, folderNote, unreadWords } from "./subagents.js";
import { repoOf } from "../../adapters/git/snapshot.js";

/**
 * @typedef {import("../../core/task-graph.js").Graph} Graph
 * @typedef {import("../../core/task-graph.js").Task} Task
 * @typedef {import("../../core/task-graph.js").Crew} Crew
 * @typedef {object} GraphTurn  the session's turn that runs now: the graph's work starts in its
 *   folder, under its mode, on its model — and only while one runs
 * @property {string} runId
 * @property {string} cwd
 * @property {import("./prompt.js").PermissionMode | null} mode  a mode its request fixed, else none: each call follows
 *   the session's
 * @property {string} model
 * @property {any} thinking
 * @property {{ key: string, name: string, members: readonly import("../../core/roster.js").Member[], check?: string | null } | null} team  the
 *   team whose lead runs the turn: the graph's work starts as its workers, each a member of the team with the team's
 *   own line for it (G3-2) — one that changes files given the team's check, where it names one (the plan's p6)
 * @property {(() => boolean) | null} [forkable]  whether a task may start as a fork of the turn now (the owner's words of
 *   10-26): the provider still holds its newest request, at most half its line. None under a lead
 * @typedef {import("../../core/task-graph.js").TaskEnd & { id: string, review: boolean, exchange: number, toolCalls: number, roundIds: string[], launchedBy: string | null, unread?: string[] }} GraphTaskEnd
 *   a graph task's end as the registry tells it: what Filament saw, whether it read the task's change, what its turn
 *   counts, and — where its planner reads along — the planner's messages it ended without reading
 * @typedef {{ agent: string, exchange: number, spentUsd: number, toolCalls: number, roundIds: string[], launchedBy: string | null }} Spend
 *   what one exchange of a task's work counts on the turn that launched it, while that turn runs
 * @typedef {object} Folders  git on the folder a task of the planner's own runs in (HarnessV4_TaskGraphPlus_Plan E41 P2
 *   case 11), read-only: `snapshot` the folder as it stands — the commit that holds its tree, kept by no ref — or why it
 *   cannot be (no repository); `between` the files that differ from one such commit to another, as git names them in
 *   the repository; `uncommitted` the files uncommitted in the repository a folder belongs to, as git names them from
 *   its top — what of a merged task's change is still uncommitted (11-09); `brought` the files HEAD's move in a span
 *   brought in as another's: each a commit of another's touched — none of HEAD's reflog entries in the span wrote it (a
 *   merge, a fast-forward or a rebase brought it in, whenever it was made); with no reflog, off HEAD's first-parent
 *   line, or committed before the span began (FabeleHelper's of 11-10) —, that no commit HEAD wrote in the span touched,
 *   and that the folder holds, in the snapshot the span closed on (`held`), as a commit it was brought to holds it
 * @property {(folder: string) => Promise<{ ok: true, repo: string, commit: string, head?: string | null } | { ok: false, error: string }>} snapshot
 * @property {(repo: string, from: string, to: string) => Promise<{ ok: true, files: string[] } | { ok: false, error: string }>} between
 * @property {(repo: string, from: string, to: string, before: number, held: string) => Promise<{ ok: true, files: string[] } | { ok: false, error: string }>} [brought]
 * @property {(folder: string) => Promise<{ ok: true, repo: string, files: string[] } | { ok: false, error: string }>} [uncommitted]
 * @typedef {{ ok: true, text: string, view: any, changed: boolean, media?: any[], more?: Promise<string> } | { ok: false, error: string }} Answer
 *   a tasks call's answer: its words and the view the page draws, or the refusal's words. `more`: the words git's read
 *   of what a done's tasks changed adds to them (E41 P2 case 11), which the caller waits for before it answers
 */

/**
 * Where a side run's sub-agent works, as a launch says it (10-28): its own copy is the registry's default for an editing
 * one; the developer's folder is asked. @param {{ folder: "copy" | "yours" }} side
 */
const sideWhere = (side) => (side.folder === "yours" ? { worktree: false } : { worktree: true });

/** What a thread a task cannot name says while memory is not there (E28). */
const NO_MEMORY = "memory is off for this session, so no thread of it can go on the graph";
/** How long a merge pass the session could not keep waits before it is tried again, the first time (`mergeLater`). */
export const MERGE_RETRY_MS = 2000;
/** How many times a merge pass the session could not keep is tried again before its turn's waits go. */
const MERGE_TRIES = 5;

/**
 * Memory's word for the runner on the threads a session's tasks finish (HarnessV4_GraphThreads E28), through the memory
 * port as the model's, in the session: `of` reads the thread a task names — one of the session's project, open — and
 * `close` closes it at the task's done, the user's own asked about. Memory off, each says so in words; so does each in
 * a chat Memory settings leave out (`chatLeftOut`), where memory does nothing: no thread's words reach it, and none is
 * closed from it.
 * @param {{ archive?: any, scope: (o: { role: string, project?: string | null, chain?: string | null }) => any, chatLeftOut?: (chainId: string) => string | null }} memory  the memory service
 * @returns {NonNullable<Parameters<typeof createGraphRunner>[0]["threads"]>}
 */
export function memoryThreads(memory) {
  /** @param {string} chainId */
  const scopeOf = (chainId) => {
    const project = memory.archive?.chainHead(chainId)?.project_id ?? null;
    return { project, scope: memory.scope({ role: "model", project, chain: chainId }) };
  };
  /** Memory leaving the chat out, as a sentence starts it, or null. @param {string} chainId */
  const leftOut = (chainId) => {
    const why = memory.chatLeftOut?.(chainId) ?? null;
    return why ? leftOutWords(why) : null;
  };
  return {
    of: (chainId, id) => {
      const out = leftOut(chainId);
      if (out) return { error: `${out}, so no thread of memory's goes on its graph` };
      /** @type {any} */
      let r;
      let project = null;
      try {
        const s = scopeOf(chainId);
        project = s.project;
        r = s.scope.thread(id);
      } catch {
        return { error: NO_MEMORY };
      }
      if ("error" in r) return { error: String(r.error) };
      if (r.project !== null && r.project !== project) return { error: `memory's thread ${r.id} is another project's: a task here finishes a thread of this session's project` };
      return { id: r.id, text: r.text, own: r.own };
    },
    close: async (chainId, id, because) => {
      const out = leftOut(chainId);
      if (out) return { how: "not", words: `${out}: memory closes no thread from it` };
      const r = await scopeOf(chainId).scope.close(id, { because });
      return r.ok === false ? { how: "not", words: String(r.error || "memory refused it") } : r.asked ? { how: "asked", words: String(r.asked) } : r.already ? { how: "already", words: "" } : { how: "closed", words: "" };
    },
  };
}

/**
 * @param {{
 *   archive: { metaOf: (chainId: string, keys: readonly string[]) => Record<string, any> | null, mergeMeta: (chainId: string, patch: Record<string, any>) => any, openGraphs: () => { id: string, graph: Graph }[], newestTurnN?: (chainId: string) => number },
 *   registry: Pick<import("./subagents.js").SubagentRegistry,
 *     "launch" | "resumable" | "resumeTask" | "changes" | "slots" | "tell" | "stop" | "mergeTask" | "guard" | "message" | "changesSoFar" | "checkFolder" | "checkProblem" | "runCommands" | "runProblem" | "huntOf"> &
 *     Partial<Pick<import("./subagents.js").SubagentRegistry, "room" | "turnOpen" | "afterTurn" | "notice" | "keepWork" | "wake" | "cutMerges" | "forkPays" | "get" | "atWork" | "holdTask" | "heldTurn" | "heldRefusing">>,
 *   events: { publish: (topic: string, e: any) => void, subscribe?: (topic: string, fn: (e: any) => void) => () => void },
 *   crew: (chainId: string) => Crew,
 *   log: (level: string, msg: string) => void,
 *   now?: () => number,
 *   lanes?: number,
 *   threads?: { of: (chainId: string, id: string) => ReturnType<import("../../core/task-graph.js").ThreadOf>, close: (chainId: string, id: string, because: string) => Promise<{ how: import("../../core/task-graph.js").ThreadEnd["how"], words: string }> } | null,
 *   notes?: import("./graph-notes.js").GraphNotes | null,
 *   folders?: Folders | null,
 *   mergeRetryMs?: number,
 *   offerPlan?: ((chainId: string, offer: import("../../core/task-graph.js").PlanOffer) => void) | null,
 *   onCheckEnd?: ((chainId: string) => void) | null,
 *   onGraphKept?: ((chainId: string, was: Graph | null, next: Graph) => void) | null,
 *   parallel?: (chainId: string) => boolean,
 *   holdsWriters?: ((chainId: string) => boolean) | null,
 *   alsoOpen?: ((chainId: string, skip: ReadonlySet<string>, said: Set<string>) => string) | null,
 *   personAt?: ((chainId: string) => number | null) | null,
 *   chatModel?: ((chainId: string) => string | null) | null,
 * }} deps  `onCheckEnd`: a check of the session's ended — what keeps its chat's work stretch going is weighed again (the
 *   owner's of 11-06: a check running counts). `onGraphKept`: a change kept, with the graph before it — the watchers' tasks
 *   done or blocked, and a turn's tasks marked done (app/watchers/events.js, the plan of 11-11).  `holdsWriters`: whether a new task for a sub-agent that changes files waits on the chat's card for the person's yes (Parallelize tasks off, the owner's of 11-14; the server's alone). `chatModel`: the chat's own model, as its settings name it, which a side-by-side card in a chat with no turn of the graph's (a coding agent's) runs its tasks on — none where Filament reads none.  `parallel`: Parallelize tasks, on in Settings › Experimental or for the chat alone (its card's Always accept in this
 *   chat, the owner's of 11-16) — the person's consent to the agent starting the tasks that can run at once on sub-agents itself (the owner's of 11-09):
 *   read at each call, its tasks answers say to run them now, and the agent's suggestion on a card is refused — it
 *   starts them itself (the owner's of 11-10); what was ignored on one before is held back no more (the review of
 *   11-09). Off by default. Its switch on, heard on the bus's config topic where `events` subscribes, lets go of the
 *   deadline of every card that stands (`letCardsWait`). `alsoOpen`: what else is open in the chat beside its graph, the graph's own sub-agents
 *   (`skip`) left out (still-open.js `alsoOpenWords`), said after a call that ended a task of the planner's own (the
 *   owner's of 11-10), what an answer of the turn said already (`said`, which it adds to) not again — none where
 *   Filament keeps no such list. `personAt`: when the person last wrote in the chat (service.js `personWrote`), which
 *   the words of a graph come to all done weigh: what they asked since it began (the owner's of 11-10) — none, its goal alone.
 *   `threads`: memory's word on a thread a task names, and its close (E28) — none where memory is not there.
 *   `notes`: what is kept behind the graph and its tasks (E33) — none where Filament keeps no notes.
 *   `folders`: git on the folder a task of the planner's own runs in (E41 P2 case 11) — none where Filament reads none.
 *   `crew`: who plans the session's graph while no turn runs — a team's lead while a team answers it, else the agent.
 *   `lanes`: how many command runs Filament runs at once, every session's together (V2-3) — half the machine's cores, at
 *   least one. `mergeRetryMs`: how long a merge pass the session could not keep waits to be tried again, the first time
 *   (`MERGE_RETRY_MS`). `offerPlan`: the session's mark of a plan offered under the person's turn that runs (the owner's
 *   plan mode of 11-06) — it throws its refusal in words; none where no card can be drawn
 */
export function createGraphRunner({ archive, registry, events, crew, log, now = Date.now, lanes = Math.max(1, Math.floor(availableParallelism() / 2)), threads = null, notes = null, folders = null, mergeRetryMs = MERGE_RETRY_MS, offerPlan = null, onCheckEnd = null, onGraphKept = null, parallel = () => false, holdsWriters = null, alsoOpen = null, personAt = null, chatModel = null }) {
  /** The chat's own model, or null; a throw read as none. @param {string} chainId */
  const modelOfChat = (chainId) => {
    try {
      return chatModel?.(chainId) || null;
    } catch {
      return null;
    }
  };
  /** @type {Map<string, GraphTurn>} */
  const turns = new Map();
  /** Sessions with a merge under way: merges go one at a time. @type {Set<string>} */
  const merging = new Set();
  /** What each task's work spent, exchange by exchange, until its end is told: its review and fixes come first. @type {Map<string, Spend[]>} */
  const spends = new Map();
  /** The reviews being started, by session: each reads its task's change first, holding a slot and the turn meanwhile. @type {Map<string, Set<string>>} */
  const starting = new Map();
  /** The planner's messages a task's sub-agents ended without reading, until its end is told (TG2-D32). @type {Map<string, string[]>} */
  const unread = new Map();
  /** The running turns' waits on their sessions' graphs. @type {Map<string, Set<() => void>>} */
  const waiting = new Map();
  /**
   * The checks Filament runs for a session now (V2-1): a task of the planner's own by its id, the close's as "close" —
   * each with its abort, whose reason is the words a cut one's verdict says. @type {Map<string, Map<string, AbortController>>}
   */
  const checks = new Map();
  /** The merge under way of each session, its folder's check cut by the developer's stop or Filament stopping (V2-2). @type {Map<string, AbortController>} */
  const gates = new Map();
  /**
   * The merges whose end the session could not keep, by task, with the worker whose change it was: the folder took the
   * change, so the next pass keeps that end — merged again, the change would find nothing waiting and fail its task.
   * @type {Map<string, { agent: string, r: import("./subagents.js").ApplyResult }>}
   */
  const unkept = new Map();
  /**
   * Of those, the ones told the planner after the last try (`unrecordable`), by task: the graph still shows each merging,
   * and no turn waits on it — nothing of Filament's runs for it — until a pass keeps its end. @type {Set<string>}
   */
  const unrecorded = new Set();
  /**
   * The command tasks Filament runs now, by session (V2-3): each task's abort — whose reason says who cut it: the
   * developer's "stop", a "drop" (or a close), Filament's "shutdown" — and its lanes. @type {Map<string, Map<string, { abort: AbortController, lanes: number }>>}
   */
  const running = new Map();
  /**
   * The git work on each task's spans of running, by task (E41 P2 case 11): each snapshot and read goes after the one
   * before it, so a done waits for the start's snapshot. @type {Map<string, Promise<any>>}
   */
  const spanWork = new Map();
  /**
   * The files merges and applies brought into the folder while a task's span was opening, by task (the review of g3):
   * its snapshot may have read the folder before they came. @type {Map<string, Set<string>>}
   */
  const opening = new Map();
  /**
   * The sessions whose planner was told a worker's end it has not been woken for (the owner's of 11-02): the graph's
   * other workers still worked, so the end rides the wake their last end brings — or `settle`'s, once none works.
   * @type {Set<string>}
   */
  const heldTells = new Set();
  /**
   * The sessions a coding agent plans in, as its tasks calls said (`solo`): a task's end offers it only what its change
   * takes — no by (f5's follow-up, 11-10). Read again at each call; none after a restart until its next.
   * @type {Set<string>}
   */
  const soloChains = new Set();
  /** The sessions whose merge pass could not keep its end, by session: how often in a row, and the try to come (`mergeLater`). @type {Map<string, { n: number, timer: ReturnType<typeof setTimeout> }>} */
  const retried = new Map();
  /**
   * The side-by-side card that stands in each session, by session (the plan of 11-14): its `at`, and the timer that
   * answers it at its deadline (`armCard`). @type {Map<string, { at: number, timer: ReturnType<typeof setTimeout> }>}
   */
  const cardTimers = new Map();
  /**
   * The sessions whose planning turn runs (the owner's plan mode of 11-06) — a /plan's, or its answer's: their tasks
   * calls start nothing, what they change waits for the person's Approve, and their checks are weighed against the
   * session's own mode, not the turn's read-only one. @type {Set<string>}
   */
  const planTurns = new Set();
  /**
   * The mode the session's running turn fixed, for what the runner launches and runs — none while its turn plans: a
   * planning turn is read-only for the planner alone, and the work under way runs under the session's own mode.
   * @param {string} chainId
   */
  const modeIn = (chainId) => (planTurns.has(chainId) ? null : (turns.get(chainId)?.mode ?? null));
  /** The lanes the command tasks of every session hold now (V2-3). */
  let lanesHeld = 0;
  /** Filament is stopping (`shutdown`): nothing starts, and no turn waits on its graph. */
  let stopping = false;

  /**
   * Whether the session's writing sub-agents share its folder (g1): its workspace setting is its folder, as the registry
   * reads it — so none works in a copy of its own. @param {string} chainId
   */
  const sharedIn = (chainId) => registry.room?.(chainId).worktree === false;
  /**
   * Whether a coding agent's helper works on its task now (task-graph.js `HelperAtWork`): the registry's word on its
   * sub-agent — one it no longer knows has ended (the review of d81fdac5e).
   * @type {import("../../core/task-graph.js").HelperAtWork}
   */
  const helping = (agent) => !registry.get || registry.get(agent)?.status === "running";
  /** When the person last wrote in the chat (`personAt`), null where Filament keeps none. @param {string} chainId */
  const personOf = (chainId) => personAt?.(chainId) ?? null;
  /**
   * `sharedIn` for a reader of the graph — the page's view, the turn's-end card —: none where it cannot be read, so the
   * reader goes by the word kept on the graph. @param {string} chainId @returns {boolean | undefined}
   */
  const sharedNow = (chainId) => {
    try {
      return sharedIn(chainId);
    } catch {
      return undefined;
    }
  };
  /** The session's graph as the archive keeps it, or null — its graph alone read out of the chain's meta, which grows
   *  with the chat: every task call, the page's reads and the runner's own ask for it. @param {string} chainId @returns {Graph | null} */
  const get = (chainId) => archive.metaOf(chainId, ["graph"])?.graph || null;
  /** What is kept behind each task of a graph of the session's (E33), for its words and its page. @param {string} chainId @param {Graph | null} graph */
  const keptOf = (chainId, graph) => (notes && graph ? notes.kept(chainId, graph) : null);
  /**
   * The graph as its page draws it, with what each task keeps, under the switch as it is now and where its sub-agents
   * work now. @param {string} chainId @param {Graph} graph
   */
  const viewOf = (chainId, graph) => graphView(graph, keptOf(chainId, graph), { shared: sharedNow(chainId) });
  /**
   * The chat's turn now, as the archive numbers it (11-09): a task added or changed keeps it, so that after a compaction
   * filament_recall brings back what was said then. Null before its first turn, or where the archive numbers none.
   * @param {string} chainId
   */
  const turnOf = (chainId) => {
    try {
      const n = archive.newestTurnN?.(chainId);
      return typeof n === "number" && n > 0 ? n : null;
    } catch {
      return null;
    }
  };
  /** The folder each session's work went into last — a turn's, a merge's — for the reads that come with no turn (11-09). @type {Map<string, string>} */
  const lastFolder = new Map();
  /**
   * The reads of what is uncommitted, numbered as they were asked: each task's newest one that came back, by task (the
   * review of g3). @type {Map<string, number>}
   */
  const readOf = new Map();
  let reads = 0;
  /**
   * What of each merged task's change is still uncommitted in the folder (11-09): one git read — after a merge, an
   * apply, and at a turn's start for the tasks marked — each mark kept where it moved. `ids`: the tasks read for, no
   * other's mark touched. A read asked before one that came back already for a task tells nothing of it: the folder may
   * have been committed between them (the review of g3). Nothing where Filament reads no folders, or no task waits on it.
   * @param {string} chainId @param {string | null | undefined} folder @param {readonly string[]} ids
   */
  const readUncommitted = (chainId, folder, ids) => {
    if (!folders?.uncommitted || !folder || !ids.length) return;
    lastFolder.set(chainId, folder);
    const n = ++reads;
    folders.uncommitted(folder).then(
      (r) => {
        if (!r.ok) return;
        const newer = ids.filter((id) => (readOf.get(key(chainId, id)) ?? 0) < n);
        for (const id of newer) readOf.set(key(chainId, id), n);
        const was = get(chainId);
        const next = newer.length ? uncommittedRead(was, r.files, newer) : null;
        if (next) keep(chainId, next, was);
      },
      (e) => log("warn", `task graph of ${chainId}: what is uncommitted could not be read (${e?.message || e})`),
    );
  };
  /**
   * The words of each running and paused task's newest checkpoint (E41 P1), by id, as the notes behind them hold them:
   * none where Filament keeps no notes. @param {string} chainId @param {Graph} graph @returns {Record<string, string>}
   */
  const checkpointsOf = (chainId, graph) => {
    /** @type {Record<string, string>} */
    const out = {};
    if (!notes?.noteText) return out;
    for (const t of graph.tasks) {
      if (!t.checkpoint || (t.state !== "paused" && t.state !== "running")) continue;
      const words = notes.noteText(chainId, graph, t.id, t.checkpoint.title);
      if (words !== null) out[t.id] = words;
    }
    return out;
  };
  /**
   * Where the planner stands (E41 P1), each running and paused task's checkpoint in it, or null; `again` after a
   * compaction, which says a graph left open with all done whoever heard it at a turn's start. `g`: the graph it reads,
   * the session's as kept unless a turn's start reads it as it would stand (`turnOpening`).
   * @param {string} chainId @param {Crew} planner @param {number} room @param {boolean} [again] @param {Graph | null} [g]
   */
  const whereOf = (chainId, planner, room, again = false, g = get(chainId)) =>
    g ? whereText(g, { crew: planner, checkpoints: checkpointsOf(chainId, g), room, parallel: parallel(chainId), shared: registry.room?.(chainId).worktree === false, helping, personAt: personOf(chainId), again }) : null;
  /** Who keeps a note, as its list says. @param {Crew} planner @param {boolean} solo */
  const keeper = (planner, solo) => (planner !== "agent" ? "the team's lead" : solo ? "the coding agent" : "the agent");
  /** @param {Graph} graph @param {string} id */
  const taskOf = (graph, id) => /** @type {Task} */ (graph.tasks.find((t) => t.id === id));
  /** @param {string} chainId @param {string} id */
  const key = (chainId, id) => `${chainId}\n${id}`;
  /** Who plans the session's graph now: the running turn's planner, else whoever the session's engine names. @param {string} chainId @returns {Crew} */
  const crewOf = (chainId) => {
    const turn = turns.get(chainId);
    return turn ? (turn.team ? turn.team.members : "agent") : crew(chainId);
  };
  /**
   * The registry's word on whether a failed task's last worker can go on with it, sent back (HarnessV3-FailurePoints §6
   * item 4): a new worker's model falls back to the running turn's.
   * @param {string} chainId @returns {import("../../core/task-graph.js").Resumable}
   */
  const resumableIn = (chainId) => (agent) => registry.resumable(agent, chainId);
  /** How many more exchanges the session may start now: its slots, less the reviews being started. @param {string} chainId */
  // Under the session's agent, a graph task runs on the planner's own model (the registry's launch), so its room is that
  // model's; under a lead, its crew's.
  const free = (chainId) => {
    const turn = turns.get(chainId);
    return Math.max(0, registry.slots(chainId, "workers", turn && !turn.team ? turn.model : null) - (starting.get(chainId)?.size || 0));
  };
  /** How many lanes a command task may take now (V2-3): those no session's command task holds. */
  const freeLanes = () => Math.max(0, lanes - lanesHeld);
  /**
   * Keep a change with the session, its rev one on, and send it to the pages; null when it could not be kept (the
   * session is gone). `was`: the graph as the archive keeps it now — the one the caller read and made the change from,
   * nothing written since — else it is read here. Kept, it is kept: what hears of it after — the pages, memory's
   * threads — failing is logged, and never reaches the caller, which goes on from the graph kept.
   * @param {string} chainId @param {Graph} graph @param {Graph | null} [was] @returns {Graph | null}
   */
  const keep = (chainId, graph, was = get(chainId)) => {
    // A step stands as its sub-tasks do (the owner's plan mode of 11-06): whatever ended one — its worker, its check,
    // its merge — moves its step in the same keep.
    const next = { ...(rollUp(graph, now()) || graph), rev: graph.rev + 1 };
    // Where its sub-agents work, kept with it (the review of g1): a show, the Plan, /graph and a compaction's text say
    // where its tasks meet by it, as the answers do. A word that cannot be read leaves the one kept as it was.
    try {
      if (sharedIn(chainId)) next.shared = /** @type {const} */ (true);
      else delete next.shared;
    } catch (/** @type {any} */ e) {
      log("warn", `task graph of ${chainId}: where its sub-agents work could not be read (${e?.message || e})`);
    }
    try {
      if (!archive.mergeMeta(chainId, { graph: next })) return null;
    } catch (/** @type {any} */ e) {
      log("warn", `task graph of ${chainId}: not kept (${e?.message || e})`);
      return null;
    }
    try {
      events.publish("graph", { type: "graph", chainId, rev: next.rev, graph: viewOf(chainId, next) });
    } catch (/** @type {any} */ e) {
      log("warn", `task graph of ${chainId}: kept, and the pages could not be told (${e?.message || e})`);
    }
    try {
      closeThreads(chainId, threadsToClose(was, next));
    } catch (/** @type {any} */ e) {
      log("warn", `task graph of ${chainId}: kept, and memory's threads it closes could not be read (${e?.message || e})`);
    }
    try {
      onGraphKept?.(chainId, was, next);
    } catch (/** @type {any} */ e) {
      log("warn", `task graph of ${chainId}: kept, and the watchers could not be told (${e?.message || e})`);
    }
    armCard(chainId, next);
    return next;
  };
  /** Let go of a session's card timer, where one is set. @param {string} chainId */
  const disarmCard = (chainId) => {
    const had = cardTimers.get(chainId);
    if (!had) return;
    clearTimeout(had.timer);
    cardTimers.delete(chainId);
  };
  /**
   * Set the timer of the card a session's graph stands (the plan of 11-14), which answers it at its deadline — at once
   * where that has passed, as after a restart —, and let go of one whose card stands no more: answered, its tasks moved
   * on, another card in its place. None while Filament stops, nor for a card kept with no deadline.
   * @param {string} chainId @param {Graph | null} graph
   */
  const armCard = (chainId, graph) => {
    const card = stopping ? null : sideOfferOf(graph);
    if (card && cardTimers.get(chainId)?.at === card.at) return;
    disarmCard(chainId);
    if (!card || typeof card.until !== "number") return;
    const timer = setTimeout(() => {
      if (cardTimers.get(chainId)?.timer === timer) cardTimers.delete(chainId);
      answerCard(chainId, card.at).catch((/** @type {any} */ e) => log("warn", `task graph of ${chainId}: its card could not answer itself (${e?.message || e})`));
    }, Math.max(0, card.until - now()));
    timer.unref?.();
    cardTimers.set(chainId, { at: card.at, timer });
  };
  /**
   * The card a session's graph stands, kept with no deadline: it waits for the person's Accept or Ignore alone, and the
   * pages hear it so, their countdown gone. Parallelize tasks on is the person's consent (the owner's of 11-09): no card
   * answers itself then. @param {string} chainId @param {Graph} graph
   */
  const letCardWait = (chainId, graph) => {
    disarmCard(chainId);
    if (!graph.offer || typeof graph.offer.until !== "number") return;
    const { until: _until, onTimeout: _onTimeout, why: _why, ...offer } = graph.offer;
    keep(chainId, { ...graph, offer }, graph);
  };
  /** Parallelize tasks switched on: every card that stands in a chat it is on for waits for the person (`letCardWait`). */
  const letCardsWait = (only = "") => {
    for (const chainId of [...cardTimers.keys()]) {
      if ((only && chainId !== only) || !parallel(chainId)) continue;
      const g = get(chainId);
      if (g) letCardWait(chainId, g);
      else disarmCard(chainId);
    }
  };
  const unhear = events.subscribe?.("config", (e) => {
    if (e?.type === "config-changed") letCardsWait();
  });
  // A chat's own Parallelize tasks switched on — its card's Always accept in this chat — lets its card wait as the
  // switch in Settings does (the review of fe6b8d579): each write of a chat's settings says so.
  const unhearChat = events.subscribe?.("settings", (e) => {
    if (e?.type === "settings" && e.chainId) letCardsWait(String(e.chainId));
  });
  /**
   * The card answers itself at its deadline (the plan of 11-14), where it still stands as it was drawn: it starts its
   * tasks as the person's Accept does — on the model kept with it, else the chat's own as it stands now, each where
   * Accept puts it (ui/harness/lib/side-offer.js `sideFolderOf`): one that writes in its own copy where a git repository
   * with a commit holds the chat's folder and its editing sub-agents work in copies, else in the folder itself, where
   * two that write one file are refused (`sideRun`) and the agent hears why. With no model known its tasks stay the
   * agent's, as the person's Ignore keeps them. The agent hears which, and that no answer came in 60 seconds.
   * Parallelize tasks on since: the card waits for the person (`letCardWait`).
   * @param {string} chainId @param {number} at
   */
  const answerCard = async (chainId, at) => {
    const g = get(chainId);
    if (stopping || !g || cardGone(g, at)) return;
    if (parallel(chainId)) return letCardWait(chainId, g);
    const offer = /** @type {import("../../core/task-graph.js").SideOffer} */ (g.offer);
    // A coding agent's chat runs no turn of the graph's (`attach`): its model is the chat's own.
    const model = offer.model || modelOfChat(chainId);
    const why = sideTimeoutWhy(model);
    if (why) {
      runner.ignoreOffer(chainId, at, { timeout: why });
      return;
    }
    const room = registry.room?.(chainId);
    // A repository with no commit gives no copy: its sub-agents would share the folder (subagents.js `openWork`).
    /** @type {{ repo: string | null, head?: string | null }} */
    const git = room?.cwd ? await repoOf(room.cwd).catch(() => ({ repo: null })) : { repo: null };
    const copies = !!git.repo && !!git.head && room?.worktree === true;
    // The read let the world move: the card may have been answered, or Parallelize tasks switched on, meanwhile.
    const now_ = get(chainId);
    if (stopping || !now_ || cardGone(now_, at)) return;
    if (parallel(chainId)) return letCardWait(chainId, now_);
    const tasks = sideOfferOf(now_)?.tasks || [];
    /** @type {import("../../core/task-graph.js").SidePick[]} */
    const picks = tasks.map((t) => ({ id: t.id, model: /** @type {string} */ (model), folder: t.writes.length && copies ? "copy" : "yours" }));
    const r = runner.sideRun(chainId, picks, { starts: "now", card: at, timeout: true });
    if (r.ok || ("gone" in r && r.gone)) return;
    // Refused: where the card still stands its tasks stay the agent's, as an Ignore keeps them; where its claim went
    // and every launch was refused, they are the agent's again already, and it hears why.
    const refused = `their start was refused (${r.error})`;
    if (!cardGone(get(chainId), at)) runner.ignoreOffer(chainId, at, { timeout: refused });
    else registry.tell(chainId, { text: sideTimedNote(offer.ids, refused), from: "", description: "the task graph", spends: [], wrote: false, wakes: true, about: "card" });
  };
  /**
   * Keep with the session what no page draws and no watcher hears — what a checklist's items said, no task moved
   * (11-10): the graph as it is, its rev as it was, nothing sent. A keep that goes the way every change goes drew the
   * Plan again and told the watchers of a change that was none. False where it could not be kept.
   * @param {string} chainId @param {Graph} graph
   */
  const keepUnsaid = (chainId, graph) => {
    try {
      return !!archive.mergeMeta(chainId, { graph });
    } catch (/** @type {any} */ e) {
      log("warn", `task graph of ${chainId}: not kept (${e?.message || e})`);
      return false;
    }
  };
  /**
   * The threads of memory the tasks a keep made done finish (E28), each closed with its task's summary — the user's own
   * asked about — and what came of it kept on its task. Never waits: a close that fails says why on the task.
   * @param {string} chainId @param {{ task: string, thread: string, because: string }[]} due
   */
  const closeThreads = (chainId, due) => {
    for (const d of due)
      void Promise.resolve()
        .then(() => (threads ? threads.close(chainId, d.thread, d.because) : { how: /** @type {const} */ ("not"), words: "memory is off for this session" }))
        .catch((/** @type {any} */ e) => ({ how: /** @type {const} */ ("not"), words: String(e?.message || e) }))
        .then((end) => {
          log(end.how === "not" ? "warn" : "info", `task graph of ${chainId}: ${d.task} done, memory's thread ${d.thread} ${end.how === "not" ? `not closed (${end.words})` : end.how}`);
          const was = get(chainId);
          const g = threadEnded(was, d.task, d.thread, { how: end.how, words: end.words, at: now() });
          if (g) keep(chainId, g, was);
        });
  };
  /** Memory's word on the thread a task of the session names (E28): the thread, or why it can be none. @param {string} chainId @returns {import("../../core/task-graph.js").ThreadOf} */
  const threadOfIn = (chainId) => (id) => (threads ? threads.of(chainId, id) : { error: NO_MEMORY });
  /** The registry's word on the Hunter a task's found_by names (11-02). @param {string} chainId @returns {import("../../core/task-graph.js").FoundOf} */
  const foundOfIn = (chainId) => (agent) => registry.huntOf(agent, chainId);
  /**
   * The session owes its running turn work while the graph's sub-agents hold some — a task runs, a reviewer reads, or a
   * change merges — while a review is being started, or while work Filament may start waits for a slot
   * that something holds. Nothing, once Filament is stopping; never the developer's own side run, whose reports come to
   * the planner when they come, as its claim told it.
   * @param {string} chainId
   */
  const owing = (chainId) => {
    if (stopping) return false;
    const g = get(chainId);
    const due = jobs(g);
    // A job that waits for what something holds: a model slot, or — a command task's — a lane (V2-3).
    const held = due.some((j) => j.kind !== "command") ? free(chainId) === 0 : false;
    const lanesFull = due.some((j) => j.kind === "command") && freeLanes() === 0;
    return busy(working(chainId, g), { side: false }) || !!starting.get(chainId)?.size || !!checks.get(chainId)?.size || held || lanesFull;
  };
  /**
   * The graph as what waits on its work reads it: without a merge whose end was told and the session's record would not
   * take (`unrecorded`) — nothing runs for it. @param {string} chainId @param {Graph | null} g
   */
  const working = (chainId, g) => (g && unrecorded.size ? { ...g, tasks: g.tasks.filter((t) => !unrecorded.has(key(chainId, t.id))) } : g);
  /**
   * Whether the graph's workers are done for now (the owner's of 11-02): none runs, reads, merges or runs commands — the
   * developer's side run's included — and no review is being started. `g`: the graph as it stands, where the caller has
   * it. @param {string} chainId @param {Graph | null} [g]
   */
  const quiet = (chainId, g = get(chainId)) => !busy(working(chainId, g)) && !starting.get(chainId)?.size;
  /**
   * Let the running turn's waits go once the session owes it nothing — or, `all`, at once. Ends told while the graph's
   * other workers worked wake a chat with no turn of the graph's running once those are done, where no later end did
   * (`heldTells`); a running turn's wait goes as the graph goes quiet, and takes them then.
   * @param {string} chainId @param {boolean} [all]
   */
  const settle = (chainId, all = false) => {
    if (heldTells.has(chainId) && !turns.has(chainId) && quiet(chainId)) {
      heldTells.delete(chainId);
      registry.wake?.(chainId);
    }
    const w = waiting.get(chainId);
    if (!w || (!all && owing(chainId))) return;
    waiting.delete(chainId);
    for (const go of w) go();
  };
  /**
   * Tell the planner how a task ended, in the graph's words: into the running turn, else with the session's next. What
   * each exchange of its work spent goes with the run that launched it: it counts on that turn alone, a pause between
   * included (the registry's inbox, the bug report's L10).
   * `writes`: the files that went into the folder — a merge's, or a worker's who worked there — which the round that
   * hears of it records as its worker's (HarnessV4_Git_Plan GWC-16).
   * `wake` (the owner's of 11-02): "batch", a worker's end — held while the graph's other workers still work, so the
   * planner wakes once for them all, else it wakes the planner, a chat with no turn running too; "now", the verdict of an
   * apply the planner asked, which wakes it so. None: into the running turn as any message, else with the next. An end
   * an open task needs is never held: what waits on it may start, or wants its apply, so it wakes the planner at once,
   * and the ends held before it go with it. A held end says nothing of how the graph stands: by the time it is read the
   * graph has moved, and the end that wakes the planner says it. `unrecorded`: the end, the session's record would not
   * take after so many tries (`unrecordable`) — said so, and not how the graph stands, which the record does not show.
   * `about`: what the end is, which the wake and the wait it ends say (the nudge map of 11-10) — a check's verdict, a
   * command task's end, an apply's verdict; none for a worker's, said as a report.
   * @param {string} chainId @param {Graph} graph @param {string} id @param {boolean} [wrote]
   * @param {import("../turn-tree.js").Writes} [writes] @param {{ wake?: "batch" | "now" | null, unrecorded?: number, about?: "check" | "command" | "merge" }} [o]
   */
  const tell = (chainId, graph, id, wrote = false, writes = undefined, { wake = null, unrecorded: tries = 0, about } = {}) => {
    const t = taskOf(graph, id);
    const spent = spends.get(key(chainId, id)) || [];
    spends.delete(key(chainId, id));
    const own = spent.filter((s) => s.agent === t.agent).at(-1);
    const missed = unread.get(key(chainId, id));
    unread.delete(key(chainId, id));
    const needed = waitedOn(graph, id);
    const held = wake === "batch" && !needed && !quiet(chainId, graph);
    if (held) heldTells.add(chainId);
    else if (wake) heldTells.delete(chainId);
    registry.tell(chainId, {
      ...(held ? { held: true } : wake ? { wakes: true } : {}),
      ...(about ? { about } : {}),
      text: `${endText(graph, id, { crew: crewOf(chainId), now: !held && !tries, unrecorded: tries, solo: soloChains.has(chainId), personAt: personOf(chainId) })}${unreadWords(missed)}`,
      from: own?.agent ?? t.agent ?? "",
      description: `${id}: ${t.name}`,
      task: id,
      state: t.state,
      ...(own ? { exchange: own.exchange } : {}),
      spends: spent.flatMap(({ launchedBy, spentUsd, toolCalls, roundIds }) => (launchedBy ? [{ launchedBy, spentUsd, toolCalls, roundIds }] : [])),
      wrote,
      ...(wrote && writes ? { writes } : {}),
    });
    // Words that said how the work stands weighed a graph come to all done against the ask (`nowWords`): said once — the
    // graph kept read again for its mark only then.
    if (!held && !tries && endSaid(graph)) {
      const cur = get(chainId);
      const weighed = endSaid(cur);
      if (weighed) keep(chainId, weighed, cur);
    }
  };
  /**
   * A call that dropped tasks lets go of what their work spent: no end of theirs is told.
   * @param {string} chainId @param {Graph | null} before @param {Graph | null} after
   */
  const forget = (chainId, before, after) => {
    const was = new Map((before?.tasks || []).map((t) => [t.id, t.state]));
    for (const t of after?.tasks || [])
      if (t.state === "dropped" && was.get(t.id) !== "dropped") {
        spends.delete(key(chainId, t.id));
        unread.delete(key(chainId, t.id));
        unkept.delete(key(chainId, t.id));
        unrecorded.delete(key(chainId, t.id));
      }
  };
  /**
   * Launch a task's sub-agent, or its reader: under the session's agent as a fork of the turn where that pays now (the
   * owner's words of 10-26: the planner's conversation, read from the provider's cache), else — and where the registry
   * refuses the fork, its request gone since — from its brief, on the same model.
   * @param {any} spec @param {boolean} forks  a fork pays now
   */
  const launchTask = (spec, forks) => {
    const forked = forks ? registry.launch({ ...spec, view: "fork" }) : null;
    return forked?.ok ? forked : registry.launch(spec);
  };
  /**
   * Whether a side run's tasks start as forks of their planner now (Phase 5), as the planner's own tasks do: the running
   * turn's word where one runs (`forkable`), else the registry's on the last turn's request it keeps. A coding agent's
   * chat sends no request of Filament's to fork, and a lead's tasks are its workers': their tasks start from their
   * briefs. @param {string} chainId
   */
  const sideForks = (chainId) => {
    const turn = turns.get(chainId);
    if (turn) return !turn.team && !!turn.forkable?.();
    return !!registry.forkPays?.(chainId);
  };
  /**
   * A step Filament gave a worker, or a reader, that waits for a slot (the bug hunt of 10-30, SUB-3): its launch or its
   * going on found none free, so it starts by itself once one is — a stop, or a close that drops its task, stops it as
   * it waits. Its task says so until it has its slot or waits no more. The graph as it is where it starts at once.
   * @param {string} chainId @param {Graph} graph  the graph with the step given @param {string} id
   * @param {{ id: string, waiting?: string, room?: Promise<boolean> }} r @returns {Graph}
   */
  const waitsFor = (chainId, graph, id, r) => {
    if (!graph || !r.waiting || !r.room) return graph;
    void r.room.then(() => {
      const g = get(chainId);
      const next = g && slotEnded(g, id, r.id);
      if (next) keep(chainId, next, g);
    });
    return slotWaited(graph, id, r.id, r.waiting, now()) || graph;
  };
  /**
   * Start what the graph may start now (G2-3, G3-3), as many as the session's slots allow and in the order `jobs`
   * gives: the changes reviews asked of their tasks' sub-agents, the reviews, then tasks — a task sent back with its
   * last worker, which goes on in its own conversation (HarnessV3-FailurePoints §6 item 2), else a new one with its
   * brief, in the running turn's folder, under its mode, on its model; under a lead, as the team's worker of the task's
   * role. A start Filament could not make fails its task, told, and leaves its slot to the next. Nothing starts while no
   * turn runs (G2-3) but what goes back to the worker that has it (`alone`), nor once Filament is stopping.
   * @param {string} chainId @returns {string[]} the tasks started
   */
  /**
   * The graph's tasks the person let start on the card for sub-agents that change files, by `chain\ngraph\ntask` (the
   * graph by its `startedAt`: a new graph's t1 is another task) — each used once, by the start it let go; those on a card
   * now; and those the person kept with the agent on a turn's card, by `chain\ngraph\ntask\nturn` — held again only on
   * a later turn.
   */
  const consented = new Set();
  const onCard = new Set();
  const keptOff = new Set();
  /** A task's key in those. @param {string} chainId @param {Graph} g @param {string} id */
  const cardKey = (chainId, g, id) => `${chainId}\n${g.startedAt}\n${id}`;
  /**
   * A task of the graph put on the chat's card (`holdsWriters`): at the Accept it may start, and starts at once where a
   * slot is free; kept with the agent, its agent hears to take it as its own. The card says where it would work — its own copy only in
   * a repository with a commit, as its sub-agent's launch finds it (subagents.js `openWork`), else the folder —; its
   * clock starts it either way, where the turn names a model.
   * @param {string} chainId @param {any} turn @param {Graph} g @param {string} id @param {Task} t
   */
  const holdOnCard = (chainId, turn, g, id, t) => {
    const k = cardKey(chainId, g, id);
    // The turn as the cards know it: a turn paused and resumed is one (subagents.js `turnKey`).
    const tk = registry.heldTurn?.(chainId, turn.runId) ?? turn.runId;
    if (onCard.has(k) || keptOff.has(`${k}\n${tk}`) || !registry.holdTask) return;
    // The person chose One at a time on this turn's card: the task is the agent's, said once, and no card asks again.
    if (registry.heldRefusing?.(chainId, turn.runId)) {
      keptOff.add(`${k}\n${tk}`);
      registry.tell(chainId, { text: `[Filament: ${id} stays unstarted: the person chose One at a time on this turn's card for sub-agents that change files. Change it to by: you and do it yourself.]`, from: "", description: "the task graph", spends: [], wrote: false });
      return;
    }
    onCard.add(k);
    const room = registry.room?.(chainId);
    const cwd = String(turn.cwd || room?.cwd || "");
    void (cwd && room?.worktree !== false ? repoOf(cwd).then((x) => !!x?.repo && !!x?.head, () => false) : Promise.resolve(false)).then((own) => {
      // Read again once the folder is: the turn ended, the task moved on or the switch went on meanwhile — no card.
      const now_ = get(chainId)?.tasks.find((x) => x.id === id);
      if (turns.get(chainId) !== turn || get(chainId)?.startedAt !== g.startedAt || now_?.state !== "waiting" || now_?.by !== t.by || !holdsWriters?.(chainId)) {
        onCard.delete(k);
        if (!holdsWriters?.(chainId)) dispatch(chainId);
        return;
      }
      try {
        holdOnCardNow(own);
      } catch (/** @type {any} */ e) {
        onCard.delete(k);
        log("warn", `task graph of ${chainId}: ${id} could not be put on the card for sub-agents that change files (${e?.message || e})`);
      }
    });
    /** @param {boolean} own */
    const holdOnCardNow = (own) =>
      registry.holdTask?.(chainId, {
        runId: turn.runId,
        view: { description: `${id}: ${t.name}`, kind: "builder", model: String(turn.model || ""), where: own ? "copy" : "folder", declines: turn.model ? "" : "no model is named for it" },
        // Its sub-agent, started now; none where it still waits with the yes kept — no free slot, or no turn running —,
        // and starts as both come (the card says it waits to start); else what became of it, said as not started.
        start: () => {
          onCard.delete(k);
          consented.add(k);
          dispatch(chainId);
          const now_ = get(chainId)?.tasks.find((x) => x.id === id);
          if (now_?.agent) return [String(now_.agent)];
          // Still a sub-agent's, as it was held (`holdOnCard`'s check): one the agent took as its own meanwhile is not queued.
          if (now_?.state === "waiting" && now_.by === t.by && consented.has(k)) return [];
          if (now_?.state === "waiting" && now_.by !== t.by) {
            consented.delete(k);
            throw new Error("your agent took it as its own meanwhile");
          }
          throw new Error(!now_ ? "it is no task of the graph now" : now_.state === "waiting" ? "it did not start" : `it is ${now_.state} now`);
        },
        declined: (/** @type {"person" | "timeout" | "stop"} */ by) => {
          onCard.delete(k);
          // The turn ended before an answer: the task waits for the next turn's card, nothing said of it.
          if (by === "stop") return;
          keptOff.add(`${k}\n${tk}`);
          registry.tell(chainId, { text: `[Filament: ${id} stays unstarted: the card for sub-agents that change files kept it with you. Change it to by: you and do it yourself.]`, from: "", description: "the task graph", spends: [], wrote: false });
        },
      });
  };
  const dispatch = (chainId) => {
    const turn = turns.get(chainId);
    if (!turn) return alone(chainId);
    const before = get(chainId);
    const all = !stopping && turn && before ? jobs(before).filter((j) => !starting.get(chainId)?.has(j.id)) : [];
    if (!turn || !before || !all.length) return [];
    let room = free(chainId);
    /** @type {Crew} */
    const crewNow = turn.team ? turn.team.members : "agent";
    let graph = before;
    /** @type {string[]} */
    const started = [];
    /** @type {string[]} */
    const refused = [];
    /** What its lead hears of the members that went without its team's check. @type {string[]} */
    const unchecked = [];
    // A command task takes lanes, not a slot (V2-3): as many as it has runs, of those free; one with none waits.
    /** @type {{ id: string, lanes: number }[]} */
    const runs = [];
    for (const job of all.filter((j) => j.kind === "command")) {
      const room = freeLanes();
      if (!room) break;
      const n = Math.min(room, commandRuns(taskOf(graph, job.id)).length);
      const next = commandStarted(graph, job.id, now(), n);
      if (!next) continue;
      graph = next;
      lanesHeld += n;
      runs.push({ id: job.id, lanes: n });
      started.push(job.id);
    }
    const due = all.filter((j) => j.kind !== "command");
    for (const job of due) {
      if (!room) break;
      if (job.kind === "review") {
        review(chainId, job.id);
        room -= 1;
        continue;
      }
      const t = taskOf(graph, job.id);
      // The folder's check undid its merge (V2-2): its worker takes the output (`gateStep`).
      if (job.kind === "gate") {
        const r = gateStep(chainId, graph, job.id, crewNow, turn.runId);
        graph = r.graph;
        if (r.ok) room -= 1;
        else refused.push(job.id);
        continue;
      }
      if (job.kind === "fix") {
        const r = registry.resumeTask(/** @type {string} */ (t.agent), { chainId, prompt: fixText(graph, job.id), requestId: turn.runId, waits: true });
        graph = r.ok ? waitsFor(chainId, /** @type {Graph} */ (fixLaunched(graph, job.id)), job.id, r) : /** @type {Graph} */ (reviewStepRefused(graph, job.id, r.error, now()));
        if (r.ok) room -= 1;
        else refused.push(job.id);
        continue;
      }
      const as = runsAs(t, crewNow);
      // A task another planner's words name, which no member of the team that leads now can take: it fails, told.
      if (as === null) {
        graph = /** @type {Graph} */ (launchRefused(graph, job.id, noMemberWords(turn, t), now(), t.by));
        refused.push(job.id);
        continue;
      }
      // Sent back, its last worker goes on with it — unless another planner leads now, under whom that worker is no
      // worker of the task's role: a new one starts, below. It runs the task's check as it stands now (TG2-D63).
      if (job.kind === "resume" && as === t.ranAs) {
        const r = registry.resumeTask(/** @type {string} */ (t.resume), { chainId, prompt: resumeText(graph, job.id, crewNow), requestId: turn.runId, check: Array.isArray(t.check) ? [...t.check] : [], waits: true });
        graph = r.ok ? waitsFor(chainId, /** @type {Graph} */ (resumed(graph, job.id, now())), job.id, r) : /** @type {Graph} */ (resumeRefused(graph, job.id, r.error, now()));
        if (r.ok) {
          started.push(job.id);
          room -= 1;
        } else refused.push(job.id);
        continue;
      }
      // Parallelize tasks off (the owner's of 11-14): a new task for a sub-agent that changes files waits on the chat's card
      // for the person's yes, as the agent's own launch does (held-launch.js) — Accept starts it here, One at a time
      // leaves it the agent's, told to take it as its own. A team's, an explorer's and the person's side run go as ever.
      const ck = cardKey(chainId, graph, job.id);
      // A task sent back whose worker another planner's crew has no place for starts a new one here too: held alike.
      if ((job.kind === "start" || job.kind === "resume") && !turn.team && !t.side && as !== "explorer" && holdsWriters?.(chainId) && !consented.has(ck)) {
        holdOnCard(chainId, turn, graph, job.id, t);
        continue;
      }
      consented.delete(ck);
      const who = turn.team ? { team: workerOf(turn.team, as) } : { worker: as === "explorer" ? "reviewer" : "builder" };
      // A task with a check is launched with it granted (V2-1, TG2-D44): its worker runs it without asking in its
      // worktree, and Filament runs it once the worker reports.
      const check = Array.isArray(t.check) ? t.check : [];
      // Under the session's agent it runs on the planner's own model (the registry's launch), and starts as its fork where
      // that pays (the owner's words of 10-26), else from its brief (`launchTask`).
      // One of the developer's side run, sent back, runs as they chose it: on their model at their effort, in its own copy
      // or their folder — its model named, as `launchSide` names it, so a fork on the planner's is refused it (the review
      // of 5b35e53aa).
      const spec = { origin: "agent", chainId, prompt: briefText(graph, job.id, crewNow), description: `${job.id}: ${t.name}`, ...who, background: true, cwd: turn.cwd, mode: modeIn(chainId), parentModel: t.side?.model || turn.model, ...(t.side ? { model: t.side.model } : {}), ...(t.side?.effort ? { effort: /** @type {any} */ (t.side.effort) } : {}), thinking: turn.thinking, task: { id: job.id, review: false }, requestId: turn.runId, waits: true, ...(t.side ? sideWhere(t.side) : {}), ...(Array.isArray(t.writes) && t.writes.length ? { files: { writes: [...t.writes] } } : {}), ...(check.length ? { grants: { check: [...check], mayRun: [] } } : {}) };
      const r = launchTask(spec, !turn.team && !!turn.forkable?.());
      if (r.ok) {
        graph = waitsFor(chainId, /** @type {Graph} */ (launched(graph, job.id, r.id, now(), as, r.workspace)), job.id, r);
        started.push(job.id);
        room -= 1;
        // A member that went without its team's check, which the session does not let Filament run (the plan's p6): its
        // lead hears why, as a launch of its own says it.
        if (r.unchecked) unchecked.push(uncheckedWords(r.unchecked, `${job.id}'s ${as} ${r.id}`));
      } else {
        log("warn", `task graph of ${chainId}: ${job.id}'s ${as} could not start (${r.error})`);
        graph = /** @type {Graph} */ (launchRefused(graph, job.id, r.error, now(), as));
        refused.push(job.id);
      }
    }
    const kept = graph !== before ? keep(chainId, graph) : null;
    for (const r of runs) {
      if (kept) runTask(chainId, r.id, r.lanes);
      else lanesHeld -= r.lanes;
    }
    if (kept) for (const id of refused) tell(chainId, kept, id);
    if (kept && unchecked.length) registry.tell(chainId, { text: `[Filament: ${unchecked.join(" ")}]`, from: "", description: "the task graph", spends: [], wrote: false });
    return kept ? started : started.filter((id) => !runs.some((r) => r.id === id));
  };
  /**
   * The folder's check undid a task's merge (V2-2): its worker takes the output, in its own conversation — waiting for a
   * slot where none is free, as each start does (SUB-3) — or, unable to, its task fails, its change waiting in its copy
   * for an apply. `requestId`: the turn it runs for, none where no turn runs (`alone`).
   * @param {string} chainId @param {Graph} graph @param {string} id @param {Crew} crewNow @param {string | null} requestId
   * @returns {{ graph: Graph, ok: boolean }}
   */
  const gateStep = (chainId, graph, id, crewNow, requestId) => {
    const t = taskOf(graph, id);
    const r = registry.resumeTask(/** @type {string} */ (t.agent), { chainId, prompt: gateBackText(graph, id, crewNow), requestId, waits: true });
    return { graph: r.ok ? waitsFor(chainId, /** @type {Graph} */ (gateLaunched(graph, id)), id, r) : /** @type {Graph} */ (gateStepRefused(graph, id, r.error, now())), ok: r.ok };
  };
  /**
   * With no turn running nothing new starts (G2-3), but work that goes back to the worker that has it still goes, as the
   * developer's side run starts with none: a change the folder's check undid (the bug report of 11-10: a coding agent's
   * chat has no turn of Filament's, so the step waited for good — the task merging, its apply, a mark, its start and its
   * done all refused); and, where a coding agent plans, whose chat no turn of Filament's ever runs in, the fix a review
   * asked and a task sent back to its sub-agent — `tasks start` with a note (f5's follow-up, 11-10: it waited for good
   * too). A send-back a new worker would take waits for a turn, as a new task does. One its worker can't take fails its
   * task, told at once. @param {string} chainId @returns {string[]} the tasks sent back that started
   */
  const alone = (chainId) => {
    const before = get(chainId);
    const kinds = soloChains.has(chainId) ? ["gate", "fix", "resume"] : ["gate"];
    const due = !stopping && before ? jobs(before).filter((j) => kinds.includes(j.kind) && !starting.get(chainId)?.has(j.id)) : [];
    if (!before || !due.length) return [];
    const crewNow = crewOf(chainId);
    let room = free(chainId);
    let graph = before;
    /** @type {string[]} */
    const started = [];
    /** @type {string[]} */
    const refused = [];
    for (const job of due) {
      if (!room) break;
      const t = taskOf(graph, job.id);
      if (job.kind === "gate") {
        const r = gateStep(chainId, graph, job.id, crewNow, null);
        graph = r.graph;
        if (r.ok) room -= 1;
        else refused.push(job.id);
        continue;
      }
      if (job.kind === "fix") {
        const r = registry.resumeTask(/** @type {string} */ (t.agent), { chainId, prompt: fixText(graph, job.id), requestId: null, waits: true });
        graph = r.ok ? waitsFor(chainId, /** @type {Graph} */ (fixLaunched(graph, job.id)), job.id, r) : /** @type {Graph} */ (reviewStepRefused(graph, job.id, r.error, now()));
        if (r.ok) room -= 1;
        else refused.push(job.id);
        continue;
      }
      if (runsAs(t, crewNow) !== t.ranAs) continue;
      const r = registry.resumeTask(/** @type {string} */ (t.resume), { chainId, prompt: resumeText(graph, job.id, crewNow), requestId: null, check: Array.isArray(t.check) ? [...t.check] : [], waits: true });
      graph = r.ok ? waitsFor(chainId, /** @type {Graph} */ (resumed(graph, job.id, now())), job.id, r) : /** @type {Graph} */ (resumeRefused(graph, job.id, r.error, now()));
      if (r.ok) {
        started.push(job.id);
        room -= 1;
      } else refused.push(job.id);
    }
    const kept = graph !== before ? keep(chainId, graph) : null;
    if (kept) for (const id of refused) tell(chainId, kept, id, false, undefined, { wake: "now" });
    return kept ? started : [];
  };
  /**
   * Why no worker of the team that leads now can take a task another planner's words name (G3-2): dispatch fails it in
   * these words. @param {Pick<GraphTurn, "team">} turn @param {Task} t
   */
  const noMemberWords = (turn, t) => `no worker of team ${turn.team?.name} ${t.writes.length ? "changes files" : "does a task that changes none"} — give it to a worker (tasks change with by), or drop it`;
  /**
   * Launch the developer's side run's tasks whose launches wait (10-28): each as the sub-agent or explorer it is, on the
   * model they chose and in its own copy or their folder, under the session's mode — no turn of the planner's needed. On
   * the planner's own model it starts as the planner's fork where that pays (`sideForks`), as the planner's own tasks
   * do; else, and where the registry refuses the fork, from its brief. No number caps the chat (the owner's word of
   * 11-05): a model's limit refuses a launch in its own words. A launch refused gives its task back to its planner, as it left it, and the rest go
   * on (the Hunter's of 10-28: it failed the task while the others ran, and the sheet said all had started); `told`, the
   * planner heard of the claim, so it hears of each given back.
   * @param {string} chainId @param {{ told: boolean }} o
   * @returns {{ started: string[], refused: { id: string, why: string }[] }}
   */
  const launchSide = (chainId, { told }) => {
    const before = get(chainId);
    const ids = sidePending(before);
    if (!before || !ids.length) return { started: [], refused: [] };
    const crewNow = crewOf(chainId);
    const forks = sideForks(chainId);
    let graph = before;
    /** @type {string[]} */
    const started = [];
    /** @type {{ id: string, why: string }[]} */
    const refused = [];
    for (const id of ids) {
      const t = taskOf(graph, id);
      const side = /** @type {import("../../core/task-graph.js").SideClaim} */ (t.side);
      const as = runsAs(t, crewNow) === "explorer" ? "explorer" : "sub-agent";
      const check = Array.isArray(t.check) ? t.check : [];
      // A fork runs on the planner's model alone: on another, the registry refuses it, and the task starts from its brief.
      const r = launchTask({ origin: "agent", chainId, prompt: briefText(graph, id, crewNow), description: `${id}: ${t.name}`, worker: as === "explorer" ? "reviewer" : "builder", background: true, parentModel: side.model, model: side.model, ...(side.effort ? { effort: /** @type {any} */ (side.effort) } : {}), task: { id, review: false }, ...sideWhere(side), ...(t.writes.length ? { files: { writes: [...t.writes] } } : {}), ...(check.length ? { grants: { check: [...check], mayRun: [] } } : {}) }, forks);
      if (r.ok) {
        graph = /** @type {Graph} */ (launched(graph, id, r.id, now(), as, r.workspace));
        started.push(id);
      } else refused.push({ id, why: r.error });
    }
    for (const { id, why } of refused) log("warn", `task graph of ${chainId}: the developer's side run of ${id} could not start (${why})`);
    graph = sideBack(graph, refused.map((x) => x.id)) || graph;
    const kept = keep(chainId, graph);
    if (!kept) return { started: [], refused };
    if (told) for (const { id, why } of refused) registry.notice?.(chainId, { text: sideBackNote([id], why), description: "the task graph" });
    return { started, refused };
  };
  /**
   * Run a command task Filament just started (V2-3) on its lanes, in the background: its progress kept at most every two
   * seconds, its end kept and told once what may start next has started — in every session, since its lanes are free
   * again. One a drop or a close cut keeps nothing; the developer's stop sets it aside with what ran; Filament stopping
   * fails it.
   * @param {string} chainId @param {string} id @param {number} n  its lanes
   */
  const runTask = (chainId, id, n) => {
    const t = taskOf(/** @type {Graph} */ (get(chainId)), id);
    const list = commandRuns(t);
    const abort = new AbortController();
    const mine = running.get(chainId) || new Map();
    running.set(chainId, mine.set(id, { abort, lanes: n }));
    let ran = 0;
    let passed = 0;
    let shown = now();
    /** @param {import("../../core/task-graph.js").CommandRun} run */
    const progress = (run) => {
      ran += 1;
      if (run.passed) passed += 1;
      if (now() - shown < 2000) return;
      shown = now();
      const g = get(chainId);
      const next = g && commandProgress(g, id, { ran, passed, of: list.length, lanes: n });
      if (next) keep(chainId, next, g);
    };
    registry
      .runCommands(chainId, list, { signal: abort.signal, id: `cmd-${id}`, lanes: n, mode: modeIn(chainId), progress })
      .catch((/** @type {any} */ e) => /** @type {const} */ ({ ran: false, words: `its commands could not run (${e?.message || e})` }))
      .then((out) => {
        lanesHeld -= n;
        if (mine.get(id)?.abort === abort) mine.delete(id);
        if (!mine.size && running.get(chainId) === mine) running.delete(chainId);
        const why = abort.signal.aborted ? String(abort.signal.reason ?? "") : null;
        try {
          if (why !== "drop") {
            /** @type {import("../../core/task-graph.js").CommandOutcome} */
            const outcome = why === "shutdown" ? { ran: false, words: "Filament stopped as it ran it" } : out.ran ? { ran: true, runs: out.runs, of: out.of, lanes: out.lanes, ms: out.ms, cut: why === "stop" ? "developer" : null } : out;
            const g = get(chainId);
            const r = g && commandEnded(g, id, outcome, now());
            const kept = r && keep(chainId, r.graph, g);
            if (kept) {
              dispatch(chainId);
              tell(chainId, get(chainId) || kept, id, false, undefined, { wake: "batch", about: "command" });
            }
          }
        } catch (/** @type {any} */ e) {
          log("warn", `task graph of ${chainId}: ${id}'s runs were not kept (${e?.message || e})`);
        }
        // Its lanes are free: a command task of another session may take them.
        for (const other of [...turns.keys()]) if (other !== chainId) dispatch(other);
        settle(chainId);
        for (const other of [...waiting.keys()]) if (other !== chainId) settle(other);
      });
  };
  /**
   * The command tasks a call let go of — a drop, or a close — are cut, and keep nothing (V2-3).
   * @param {string} chainId @param {Graph | null} after
   */
  const cutGone = (chainId, after) => {
    for (const [id, r] of running.get(chainId) || []) if (after?.tasks.find((t) => t.id === id)?.state !== "running") r.abort.abort("drop");
  };
  /**
   * Start a task's review (G3-3): its reviewer reads the change its sub-agent made, whole as it stands — in the first
   * round a new reviewer, the team's under a lead and an explorer under the agent; in each round after, the same one
   * again. The change is read first, so the review holds a slot, and the turn, from the start. A review Filament could
   * not start fails its task, told once what may start next has started; one with nothing to start it now — the graph
   * held, no turn — waits.
   * @param {string} chainId @param {string} id
   */
  const review = (chainId, id) => {
    const mine = starting.get(chainId) || new Set();
    starting.set(chainId, mine.add(id));
    /** @returns {Promise<Graph | null>} the graph kept with the task failed, when its review could not start */
    const start = async () => {
      const first = get(chainId);
      const tried = first ? taskOf(first, id)?.report : null;
      const agent = first ? taskOf(first, id)?.agent : null;
      if (!agent) return null;
      // A change made in the folder itself is the files its calls wrote there (HarnessV3-FailurePoints §8 item 2).
      const inFolder = !!tried?.inFolder;
      /** @type {{ ok: true, files: unknown[], diff: string } | { ok: false, error: string }} */
      const c = inFolder ? { ok: true, files: tried.written, diff: folderList(tried.written) } : await registry.changes(agent, chainId);
      const turn = turns.get(chainId);
      const graph = get(chainId);
      const t = graph && taskOf(graph, id);
      if (!turn || !graph || !t || stopping || graph.held || t.state !== "review" || t.step !== "queued" || t.agent !== agent) return null;
      /** @type {Crew} */
      const crewNow = turn.team ? turn.team.members : "agent";
      // Under a lead the team's reviewer reads it; a team that has none has no review step.
      const reader = turn.team ? reviewerOf(turn.team.members) : null;
      /** @type {{ ok: true, id: string, waiting?: string, room?: Promise<boolean> } | { ok: false, error: string }} */
      let r;
      if (!c.ok) r = c;
      else if (turn.team && !reader) r = { ok: false, error: `team ${turn.team.name} has no worker that reviews — merge its change as it stands (tasks merge), or send it back` };
      else if (!c.files.length) r = { ok: false, error: `${agent} has no change waiting to be read` };
      else if (!t.reviews.length)
        // Under the session's agent its reader is the planner's model too, as a fork of it where that pays (10-26), else
        // from its brief — waiting for a slot where none is free (SUB-3), as its later rounds do.
        r = launchTask({ origin: "agent", chainId, prompt: reviewBrief(graph, id, crewNow), description: `${id}: review of ${t.name}`, ...(turn.team && reader ? { team: workerOf(turn.team, reader.tag) } : { worker: "reviewer" }), background: true, cwd: turn.cwd, mode: modeIn(chainId), parentModel: turn.model, thinking: turn.thinking, task: { id, review: true }, review: { of: agent, files: c.files.length, diff: c.diff, inFolder }, requestId: turn.runId, waits: true }, !turn.team && !!turn.forkable?.());
      else r = registry.resumeTask(/** @type {string} */ (t.reviewer), { chainId, prompt: reviewAgainText(graph, id, changeBlock({ of: agent, files: c.files.length, diff: c.diff }, inFolder ? folderNote(agent) : changeNote(agent)), crewNow), requestId: turn.runId, waits: true });
      const reading = r.ok ? reviewLaunched(graph, id, r.id) : null;
      const next = r.ok ? reading && waitsFor(chainId, reading, id, r) : reviewStepRefused(graph, id, r.error, now());
      const kept = next && keep(chainId, next);
      return kept && !r.ok ? kept : null;
    };
    start()
      .catch((/** @type {any} */ e) => {
        log("warn", `task graph of ${chainId}: ${id}'s review did not start (${e?.message || e})`);
        return null;
      })
      .then((failed) => {
        mine.delete(id);
        if (!mine.size && starting.get(chainId) === mine) starting.delete(chainId);
        dispatch(chainId);
        if (failed) tell(chainId, get(chainId) || failed, id);
        settle(chainId);
      });
  };
  /**
   * Merge the changes whose apply was asked, one at a time in graph order (G2-5): the planner's apply of a ready one
   * (`applyAsked`), or a lead's merge of one as it stands with its reason. Each writer's change goes into the session's
   * folder by the apply's three-way merge, all or nothing, and the folder is checked with it (V2-2, the registry's
   * `mergeTask`). Its task is done, with the check's verdict, or fails in the apply's words, and its end is told once the
   * work that may start next has started, waking the planner: the verdict of what it asked. A merge the check undid is
   * told at once, and its change goes back to its worker as the next job; or, unable to go, its task fails, told. One
   * whose change overlapped the folder's edits went back to its worker to redo on the folder as the merge went
   * (`rebaseTask`, the owner's of 11-09), told the same way.
   * @param {string} chainId
   */
  const merge = async (chainId) => {
    if (merging.has(chainId)) return;
    merging.add(chainId);
    let broke = false;
    try {
      for (let id = mergeNext(get(chainId)); id; id = mergeNext(get(chainId))) {
        const t = taskOf(/** @type {Graph} */ (get(chainId)), id);
        const k = key(chainId, id);
        const was = unkept.get(k);
        unkept.delete(k);
        /** @type {import("./subagents.js").ApplyResult} */
        let r;
        if (was && was.agent === t.agent) r = was.r;
        else {
          const abort = new AbortController();
          gates.set(chainId, abort);
          try {
            // One its planner asked in as it stood stands whatever the folder's check finds; a lead's goes by its reason.
            r = await registry.mergeTask(/** @type {string} */ (t.agent), chainId, { reason: t.overruled || null, stands: t.overruledBy === "planner", signal: abort.signal });
          } finally {
            if (gates.get(chainId) === abort) gates.delete(chainId);
          }
        }
        // Sent back from this merge to redo on the folder, its change overlapping the folder's edits (the owner's of
        // 11-09): the graph took it as the merge went (`rebaseTask`), and what that freed has started — told, waking the
        // planner.
        if (!r.ok && r.sentBack?.ok) {
          retried.delete(chainId);
          const g = get(chainId);
          if (g && taskOf(g, id)?.earlier?.sentBy) tell(chainId, g, id, false, undefined, { wake: "now", about: "merge" });
          continue;
        }
        const { undone, next } = mergeEnd(get(chainId), id, r);
        const kept = next && keep(chainId, next);
        if (next && !kept) unkept.set(k, { agent: String(t.agent), r });
        if (!kept) {
          broke = !!next;
          break;
        }
        retried.delete(chainId);
        // Merged, its change waits for a commit in the folder: the Plan says so until it has one (11-09).
        if (r.ok) readUncommitted(chainId, r.repo, [id]);
        if (r.ok) cameIn(chainId, r.files);
        // A change that did not merge waits for an apply still: its worker's thread is kept for a restart (10-28).
        if (waitsForYou(kept, String(t.agent))) registry.keepWork?.(String(t.agent), chainId);
        // Told already, as the session's record would not take it (`unrecordable`): kept now, what it frees starts.
        if (unrecorded.delete(k)) {
          dispatch(chainId);
          continue;
        }
        const { wrote, writes } = mergeWrites(r, String(t.agent));
        // Sent back: the planner hears it before its worker takes it, so the words say where it went.
        if (undone?.state === "back") {
          tell(chainId, kept, id, wrote, writes, { wake: "now", about: "merge" });
          dispatch(chainId);
          continue;
        }
        dispatch(chainId);
        tell(chainId, get(chainId) || kept, id, wrote, writes, { wake: "now", about: "merge" });
      }
    } finally {
      merging.delete(chainId);
      if (broke) mergeLater(chainId);
      settle(chainId);
    }
  };
  /**
   * What a merge's verdict makes of its task (V2-2): undone, and sent back or failed; done — the files its planner's
   * overlap brought in with markers or kept as the folder had them named (11-09); or failed in the apply's words, with
   * why it was not sent back to redo where its change overlapped the folder's edits. `next` null where the graph or the
   * task is gone.
   * @param {Graph | null} g @param {string} id @param {import("./subagents.js").ApplyResult} r
   */
  const mergeEnd = (g, id, r) => {
    const c = r.check && r.check.kind !== "late" && r.check.kind !== "waiting" ? r.check : null;
    const gate = c ? gateOf(c, now()) : null;
    const undone = g && !r.ok && gate?.kind === "undone" ? gateUndone(g, id, gate, now()) : null;
    /** @param {string} how */
    const came = (how) => (r.ok && r.came ? r.came.filter((x) => x.how === how).map((x) => x.path) : []);
    const back = !r.ok && r.sentBack && !r.sentBack.ok ? `; it was not sent back: ${r.sentBack.error}` : "";
    const next = undone ? undone.graph : g && (r.ok ? taskMerged(g, id, r.files, now(), gate, { marked: came("markers"), kept: came("kept") }) : taskMergeFailed(g, id, `${r.error}${back}`, now(), !!r.conflicts?.some((x) => x.kind)));
    return { undone, next };
  };
  /**
   * What a merge's end records of the folder (GWC-16): recorded once — with the planner's call that answered as it went
   * in (`recorded`), else with this end. An undo wrote too.
   * @param {import("./subagents.js").ApplyResult} r @param {string} agent
   */
  const mergeWrites = (r, agent) => {
    const recorded = r.ok && !!r.recorded;
    return { wrote: r.check?.kind === "undone" || (!recorded && (r.ok || !!r.partial)), writes: recorded ? undefined : appliedWrites(agent, r) };
  };
  /**
   * The ends of a session's merges the session's record would not take, after the last try: each is told the planner as
   * its verdict came — merged, sent back or failed — and that the graph still shows it merging, and no turn waits on it
   * (`unrecorded`). Its verdict stays in hand, kept by the pass the graph's next change runs; a restart before then fails
   * the task as cut (G2-9). Each is told once. @param {string} chainId
   */
  const unrecordable = (chainId) => {
    const g = get(chainId);
    for (const [k, was] of unkept) {
      if (!k.startsWith(`${chainId}\n`) || unrecorded.has(k)) continue;
      const id = k.slice(chainId.length + 1);
      const { next } = g?.tasks.some((t) => t.id === id && t.state === "merging") ? mergeEnd(g, id, was.r) : { next: null };
      if (!next) continue;
      unrecorded.add(k);
      const { wrote, writes } = mergeWrites(was.r, was.agent);
      tell(chainId, next, id, wrote, writes, { wake: "now", unrecorded: MERGE_TRIES + 1, about: "merge" });
    }
  };
  /**
   * A merge pass whose end the session could not keep is tried again a while after (`mergeRetryMs`, longer each time),
   * up to `MERGE_TRIES` times: the merges that wait — their verdicts in hand, a planner's applies its pass never took up
   * among them — are taken up then, and the turn that owes them let go. Past that, each verdict in hand is told as it
   * came, and no turn waits on it (`unrecordable`); never once Filament is stopping. @param {string} chainId
   */
  const mergeLater = (chainId) => {
    if (stopping) return;
    const n = (retried.get(chainId)?.n ?? 0) + 1;
    if (n > MERGE_TRIES) {
      retried.delete(chainId);
      log("warn", `task graph of ${chainId}: its merges' ends could not be kept ${MERGE_TRIES} times — told as they came, kept with the graph's next change`);
      unrecordable(chainId);
      settle(chainId);
      return;
    }
    clearTimeout(retried.get(chainId)?.timer);
    const timer = setTimeout(() => mergeWaiting(chainId), mergeRetryMs * n);
    timer.unref?.();
    retried.set(chainId, { n, timer });
  };
  /** Merge what waits, the work going on by itself: a merge under way takes it in turn. @param {string} chainId */
  const mergeWaiting = (chainId) => {
    merge(chainId).catch((/** @type {any} */ e) => log("warn", `task graph of ${chainId}: a merge failed (${e?.message || e})`));
  };

  /**
   * Run one check of a session's in the background (V2-1), held under `key` while it runs — the turn owes it — and hand
   * what it found to `done`: a cut one's (a stop, Filament stopping, the close) as not run, in the abort's words.
   * @param {string} chainId @param {string} key @param {string[]} commands @param {{ id: string, all: boolean }} o
   * @param {(outcome: import("../../core/task-graph.js").CheckOutcome, cut: string | null) => void} done
   */
  const runCheck = (chainId, key, commands, { id, all }, done) => {
    const mine = checks.get(chainId) || new Map();
    if (mine.has(key)) return;
    const abort = new AbortController();
    checks.set(chainId, mine.set(key, abort));
    registry
      .checkFolder(chainId, commands, { signal: abort.signal, id, all, mode: modeIn(chainId) })
      .catch((/** @type {any} */ e) => /** @type {import("../../core/task-graph.js").CheckOutcome} */ ({ ran: false, words: `the check could not run (${e?.message || e})` }))
      .then((outcome) => {
        if (mine.get(key) === abort) mine.delete(key);
        if (!mine.size && checks.get(chainId) === mine) checks.delete(chainId);
        const cut = abort.signal.aborted ? String(abort.signal.reason ?? "a stop cut its check") : null;
        try {
          done(cut ? { ran: false, words: cut } : outcome, cut);
        } catch (/** @type {any} */ e) {
          log("warn", `task graph of ${chainId}: a check's verdict was not kept (${e?.message || e})`);
        }
        settle(chainId);
        try {
          onCheckEnd?.(chainId);
        } catch (/** @type {any} */ e) {
          log("warn", `task graph of ${chainId}: a check's end was not weighed for its chat (${e?.message || e})`);
        }
      });
  };
  /**
   * Check a task of the planner's own it marked done (V2-1): its verdict moves it on — done, or open again — and is told,
   * once what may start next has started. One the close took is the close's to check: nothing is told of it here. A
   * check that passed at once joins the folder's (V2-2): a worker's merge that breaks it is undone.
   * @param {string} chainId @param {string} id
   */
  const verify = (chainId, id) => {
    const t = get(chainId)?.tasks.find((x) => x.id === id);
    if (!t || t.state !== "checking") return;
    runCheck(chainId, id, [...(t.check || [])], { id: `check-${id}`, all: false }, (outcome, cut) => {
      const g = get(chainId);
      const r = g && checked(g, id, outcome, now(), cut ?? undefined);
      const kept = r && keep(chainId, r.graph, g);
      if (!kept) return;
      const v = taskOf(kept, id).verdict;
      if (v?.kind === "passed") registry.guard(chainId, v.runs.map((x) => x.command));
      dispatch(chainId);
      // It wakes the planner, a chat with no turn running too, as a background command's end does (the owner's of 11-06):
      // a check outlives the turn that marked its task done — a coding agent's turn holds for none of it — and its
      // verdict, told with the next message alone, left the chat idle with its next task ready until the person came back.
      tell(chainId, get(chainId) || kept, id, false, undefined, { wake: "now", about: "check" });
    });
  };
  /**
   * A graph just closed (`g`; the session's, by default): each distinct check of its done tasks runs once more on the
   * folder as it stands (V2-1), and what it found is kept with the closed graph and told. A graph started after it
   * since — a checklist that closed it starts one at once (V2-5) — keeps nothing of it, and is told what it found.
   * @param {string} chainId @param {Graph | null} [g]
   */
  const closeRun = (chainId, g = get(chainId)) => {
    const runs = closeRuns(g);
    if (!g?.closed || !runs.length) return;
    const shut = g;
    const at = g.closed.at;
    runCheck(chainId, "close", runs.map((r) => r.command), { id: "check-close", all: true }, (outcome) => {
      const now_ = get(chainId);
      const same = !!now_?.closed && now_.closed.at === at;
      const kept = same ? keep(chainId, closeChecked(/** @type {Graph} */ (now_), outcome, now()), now_) : closeChecked(shut, outcome, now());
      // A check that fails after the close wakes the planner, a chat with no turn running too: later work broke it. All
      // passed, it waits for the next message — the graph is closed, nothing waits on it.
      const red = !!kept?.closed?.checks?.ran && kept.closed.checks.runs.some((/** @type {any} */ r) => r.exit !== 0);
      if (kept) registry.tell(chainId, { text: closeChecksText(kept, crewOf(chainId)), from: "", description: "the task graph", spends: [], wrote: false, about: "check", ...(red ? { wakes: true } : {}) });
    });
  };
  /**
   * What a call started of the checks (V2-1): each task of the planner's own it set checking is checked; a check the
   * close took is let go — the close's run is its check — and a graph it closed runs its checks once more: the
   * session's, or the one a checklist closed as it started another (`closed`, V2-5).
   * @param {string} chainId @param {Graph | null} before @param {Graph | null} after @param {Graph | null} [closed]
   */
  const checksAfter = (chainId, before, after, closed = null) => {
    if (!after) return;
    const mine = checks.get(chainId);
    for (const [key, abort] of mine || [])
      if (key !== "close" && after.tasks.find((t) => t.id === key)?.state !== "checking") abort.abort("the close took it");
    if (closed) closeRun(chainId, closed);
    if (after.closed && !before?.closed) closeRun(chainId);
    else for (const id of checkingIds(after)) verify(chainId, id);
  };
  /**
   * What each chat's answers said else is open this turn (`alsoAfter`), by key: the turn's start forgets it (`begin`).
   * @type {Map<string, Set<string>>}
   */
  const alsoSaid = new Map();
  /**
   * What else is open beside the graph (`alsoOpen`), after a call that ended a task of the planner's own — done, or gone
   * to its check — (the owner's of 11-10: with no compaction to bring Still open back, a drifting agent hears only its
   * tools' answers): "" where none ended, or nothing else is open, or nothing came since an answer of the turn said it.
   * The graph's own sub-agents are its words' to say. A task made done as it was added ended nothing; a lead's call
   * hears none of it, as it hears no Next: the list is the main agent's (the hunt of a-next, sa_16f6bbd4).
   * @param {string} chainId @param {Graph | null} before @param {Graph | null} after @param {Crew} planner
   */
  const alsoAfter = (chainId, before, after, planner) => {
    if (!alsoOpen || !after || Array.isArray(planner)) return "";
    const was = new Map((before?.tasks || []).map((t) => [t.id, t.state]));
    if (!after.tasks.some((t) => t.by === "you" && (t.state === "done" || t.state === "checking") && was.has(t.id) && was.get(t.id) !== t.state)) return "";
    /** @type {Set<string>} */
    const skip = new Set();
    // A helper's while it works: once it ended, its change that waits is the agent's to take up (the review of d81fdac5e).
    for (const t of after.tasks) for (const a of [t.agent, t.reviewer, t.resume, t.helper && helping(t.helper.agent) ? t.helper.agent : null]) if (a) skip.add(a);
    const said = alsoSaid.get(chainId) || new Set();
    alsoSaid.set(chainId, said);
    try {
      return alsoOpen(chainId, skip, said);
    } catch (e) {
      log("warn", `task graph of ${chainId}: what else is open could not be read (${/** @type {any} */ (e)?.message || e})`);
      return "";
    }
  };
  /**
   * What follows a call the graph took, kept (`kept`) over `before`: the sub-agents of the tasks it dropped are
   * stopped, the checks it started run, a change it leaves to merge goes in, and the work that may start now starts —
   * its words after the call's. `edited`: the graph changed; `closed`: a graph a checklist closed as it started another
   * (V2-5).
   * @param {string} chainId @param {Graph | null} before @param {Graph | null} kept @param {string} text
   * @param {boolean} edited @param {Graph | null} [closed]
   * @returns {{ ok: true, text: string, started: string, view: any, changed: boolean }}
   * `started`: the words of what Filament started, which `text` ends with — "" where it started none.
   */
  const settleCall = (chainId, before, kept, text, edited, closed = null) => {
    for (const agent of agentsToStop(before, kept)) registry.stop(agent, { from: "agent" });
    cutGone(chainId, kept);
    forget(chainId, before, kept);
    if (edited) checksAfter(chainId, before, kept, closed);
    // A change the call leaves to merge, the lead's word over a task that fell short (G3-4), goes in now, as one a
    // task's end leaves does (the bug report's H5).
    if (kept && mergeNext(kept)) mergeWaiting(chainId);
    const started = dispatch(chainId);
    settle(chainId);
    const graph = started.length ? get(chainId) : kept;
    const changed = edited || started.length > 0;
    const said = started.length && graph ? startedText(graph, started) : "";
    return { ok: true, text: said ? `${text}\n${said}` : text, started: said, view: changed && graph ? viewOf(chainId, graph) : null, changed };
  };
  /**
   * The registry's word on a check's commands, for this session (V2-1) — or on a command task's run, each with its item
   * filled in (V2-3). @param {string} chainId @returns {import("../../core/task-graph.js").Vet}
   */
  const vetIn = (chainId) => (commands, field = "check") => (field === "run" ? registry.runProblem : registry.checkProblem)(chainId, [...commands], { mode: modeIn(chainId) });

  /**
   * Git work on a task's spans, after the work before it (E41 P2 case 11): what fails says why in the log, and nothing.
   * @template T @param {string} k @param {() => Promise<T>} work @returns {Promise<T | null>}
   */
  const afterSpans = (k, work) => {
    const next = (spanWork.get(k) || Promise.resolve())
      .then(work)
      .catch((/** @type {any} */ e) => {
        log("warn", `task graph: what a task changed could not be read (${e?.message || e})`);
        return null;
      });
    spanWork.set(k, next);
    void next.then(() => {
      if (spanWork.get(k) === next) spanWork.delete(k);
    });
    return next;
  };
  /** A path as git names it in a repository, as the task's folder names it: what its writes are written against. @param {import("../../core/task-graph.js").SpanBase} base @param {string} p */
  const inFolder = (base, p) => relative(base.folder, join(base.repo, p)).split(sep).join("/");
  /**
   * A task of the planner's own began to run (E41 P2 case 11): the folder as git holds it now, kept on the task as its
   * base. A folder that is no repository keeps none, and its task says nothing of what changed.
   * @param {string} chainId @param {string} id @param {string} folder
   */
  const openSpan = (chainId, id, folder) => {
    const k = key(chainId, id);
    // What comes into the folder until its snapshot is kept may be missing from it (the review of g3): kept as brought in.
    if (!opening.has(k)) opening.set(k, new Set());
    return afterSpans(k, async () => {
      try {
        // When it began, before the snapshot: a commit made as it is read is the task's (the review of d81fdac5e).
        const at = now();
        const s = await /** @type {Folders} */ (folders).snapshot(folder);
        if (!s.ok) return void log("info", `task graph of ${chainId}: ${id} runs with no record of what it changes (${s.error})`);
        const g = spanOpened(get(chainId), id, { repo: s.repo, commit: s.commit, folder, head: s.head ?? null, at }, [...(opening.get(k) || [])]);
        if (g) keep(chainId, g);
      } finally {
        opening.delete(k);
      }
    });
  };
  /**
   * A merge or an apply brought `files` into the session's folder (the review of g3): each span of the planner's own
   * still opening keeps them, as `broughtIn` keeps them on one open. @param {string} chainId @param {readonly { path: string }[]} files
   */
  const cameIn = (chainId, files) => {
    for (const [k, got] of opening) if (k.startsWith(key(chainId, ""))) for (const f of files) got.add(f.path);
  };
  /**
   * A span of a task's running ended (E41 P2 case 11) — a pause, or its done: the folder snapshotted again, the files
   * that differ from its base kept on the task, and why git could not tell. Null where it has no base. `last`: the span
   * ends for good though the task still runs — it became a step, whose sub-tasks' spans say what changes from now.
   * `round`: the round the span is of as its close is asked — a start that reopens the task before it is read keeps its
   * files off the new round (the review of g3). Where HEAD moved as it ran, the files a merge, a fast-forward or a
   * rebase brought in — none of HEAD's own commits in the span touched them, and the folder holds them as they came —
   * are another's (FabeleHelper's of 11-10), kept as such.
   * @param {string} chainId @param {string} id @param {boolean} [last] @param {number | null} [round] @returns {Promise<{ error: string | null } | null>}
   */
  const closeSpan = (chainId, id, last = false, round = null) =>
    afterSpans(key(chainId, id), async () => {
      const base = get(chainId)?.tasks.find((t) => t.id === id)?.base;
      if (!base || !folders) return null;
      // A base of the round before the one that closes is not this span's: the round's own start kept none — its
      // snapshot could not be taken — so the base goes, and nothing is read from it or said.
      if (round !== null && base.round !== undefined && base.round < round) {
        const g = spanClosed(get(chainId), id, { files: null, end: null, round });
        if (g) keep(chainId, g);
        return null;
      }
      const at = now();
      const s = await folders.snapshot(base.folder);
      const same = s.ok && s.repo === base.repo;
      const d = same ? await folders.between(base.repo, base.commit, s.commit) : null;
      const error = !s.ok ? s.error : s.repo !== base.repo ? `its folder is in another repository now (${s.repo})` : d && !d.ok ? d.error : null;
      const files = d?.ok ? d.files.map((p) => inFolder(base, p)) : null;
      const head = s.ok ? s.head ?? null : null;
      // Bookkeeping: where git cannot say, nothing is kept as brought in, and the files stand as the task's.
      const moved = same && files?.length && base.head && head && head !== base.head && typeof base.at === "number" && folders.brought ? await folders.brought(base.repo, base.head, head, base.at, s.commit).catch(() => null) : null;
      const brought = moved?.ok ? moved.files.map((p) => inFolder(base, p)).filter((p) => files?.includes(p)) : [];
      const g = spanClosed(get(chainId), id, { files, end: s.ok && !error && !last ? { ...base, commit: s.commit, head, at } : null, round, brought });
      if (g) keep(chainId, g);
      return { error };
    });
  /**
   * The spans a call opened and closed (E41 P2 case 11): each task of the planner's own it started has the folder
   * snapshotted, and each it paused or marked done has what the folder changed since read from git — a done's words,
   * once read. Null where it marked none done, or Filament reads no folders.
   * @param {string} chainId @param {Graph | null} before @param {Graph | null} after @param {string | null} folder
   * @returns {Promise<string> | null}
   */
  const spansAfter = (chainId, before, after, folder) => {
    if (!folders || !after) return null;
    const was = new Map((before?.tasks || []).map((t) => [t.id, t.state]));
    // A step runs and ends as its sub-tasks do (11-06): what the folder changed is theirs, said at their own ends. One
    // freed by dropping its sub-tasks is its planner's own again; one of the planner's own that took sub-tasks while it
    // ran closes the span it opened, what changed so far kept on it.
    /** @param {Graph | null} g */
    const stepsOf = (g) => new Set((g?.tasks || []).filter((t) => t.under && t.state !== "dropped").map((t) => t.under));
    const steps = stepsOf(after);
    const wereSteps = stepsOf(before);
    for (const t of after.tasks) if (steps.has(t.id) && !wereSteps.has(t.id) && t.base) void closeSpan(chainId, t.id, true, t.round ?? 1);
    /** @type {Promise<string>[]} */
    const said = [];
    for (const t of after.tasks) {
      const from = was.get(t.id);
      if (t.by !== "you" || from === t.state || steps.has(t.id)) continue;
      if (t.state === "running" && folder) void openSpan(chainId, t.id, folder);
      else if (from === "running" && (t.state === "paused" || t.state === "done" || t.state === "checking")) {
        const closing = closeSpan(chainId, t.id, false, t.round ?? 1);
        if (t.state !== "paused") said.push(closing.then((r) => (r ? changedText(get(chainId), t.id, r.error, t.round ?? 1) : "")));
      } else if (from === "paused" && (t.state === "done" || t.state === "checking") && t.changed?.length) said.push(Promise.resolve(changedText(after, t.id)));
    }
    return said.length ? Promise.all(said).then((w) => w.filter(Boolean).join("\n")) : null;
  };
  /** The folder a session's call works in: its running turn's, else the one the call came from. @param {string} chainId @param {string | null} cwd */
  const folderFor = (chainId, cwd) => turns.get(chainId)?.cwd || cwd || null;
  /**
   * What a card the agent suggests answers itself by, as it is suggested (the plan of 11-14, core `suggestSide`): the
   * running turn's model, else the chat's own — a coding agent's turn runs none of the graph's. @param {string} chainId
   */
  const cardFacts = (chainId) => ({ model: turns.get(chainId)?.model || modelOfChat(chainId) });

  /**
   * One tasks call as it came, once its slips are read (`apply`, E40): a keep or a read of what is kept behind a task,
   * a note to the one at work on a task, or any other action against the graph.
   * @param {string} chainId @param {unknown} input @param {{ crew: Crew, solo: boolean, reads: boolean, cwd: string | null }} o
   * @returns {Answer}
   */
  const applyAsIs = (chainId, input, { crew: planner, solo, reads, cwd }) => {
    const before = get(chainId);
    const act = /** @type {any} */ (input)?.action;
    const planning = planTurns.has(chainId);
    // A plan offered on a card under the reply (the owner's plan mode of 11-06): the session marks the person's turn.
    if (act === "offer") {
      const r = applyTasks(before, input, { at: now(), crew: planner, solo, reads, planning, helping, personAt: personOf(chainId) });
      if (!r.ok) return r;
      if (!r.offer) return { ok: false, error: "the call could not be read" };
      if (!offerPlan) return { ok: false, error: "This Filament draws no card to offer a plan on: plan in your reply, or go on with the work" };
      try {
        offerPlan(chainId, r.offer);
      } catch (e) {
        return { ok: false, error: String(/** @type {any} */ (e)?.message || e) };
      }
      return { ok: true, text: offeredWords(r.offer), view: null, changed: false };
    }
    if (act === "keep" || act === "read" || act === "find") {
      const r = applyTasks(before, input, { at: now(), crew: planner, solo, reads, helping, personAt: personOf(chainId) });
      if (!r.ok) return r;
      if (!r.notes) return { ok: false, error: "the call could not be read" };
      // A find (11-06): the tasks' own words, then what is kept behind them, the graph as it was.
      if (r.notes.kind === "find" && before) return { ok: true, text: findText(before, r.notes, notes?.on ? notes.hits(chainId, r.notes, before.tasks.map((t) => t.id)) : null), view: null, changed: false };
      const out = notes ? notes.call(chainId, r.notes, keeper(planner, solo)) : { ok: /** @type {const} */ (false), error: "This Filament keeps no notes behind its tasks." };
      if (!out.ok) return out;
      // A keep changed what the graph's page draws: the graph goes out again, its rev one on, so the page takes it. What
      // it kept behind a task is a checkpoint: its turns are counted afresh (E41 P2 case 13).
      const g = out.kept ? get(chainId) : null;
      const n = r.notes;
      const counted = g && n.kind === "keep" && n.task && (n.text || n.files.length || n.picture) ? checkpointKept(g, n.task) : null;
      const drawn = g ? keep(chainId, counted || g) : null;
      return { ok: true, text: out.text, view: drawn ? viewOf(chainId, drawn) : null, changed: !!drawn, ...(out.media?.length ? { media: out.media } : {}) };
    }
    const noting = /** @type {any} */ (input)?.action === "note" ? applyTasks(before, input, { at: now(), crew: planner, solo, reads }) : null;
    if (noting) {
      if (!noting.ok || !noting.note) return noting.ok ? { ok: false, error: "the note could not be read" } : noting;
      const n = noting.note;
      const sent = registry.message(n.agent, { chainId, text: n.text, from: "agent" });
      if (!sent.ok) return { ok: false, error: `the note did not reach ${n.agent}: ${sent.error}` };
      // One that waits for the developer's answer takes no step until it comes: the planner is told, so it does not wait on its note.
      const reads = sent.asking ? `it waits for the developer's answer on a ${sent.asking} call now, and reads your note at its next step after that answer` : "it reads your note at its next step";
      return { ok: true, text: n.review ? `Sent to ${n.agent}, the reviewer reading ${n.id}'s change now: ${reads}.` : `Sent to sub-agent ${n.agent}, at work on ${n.id}: ${reads}. Your next look shows whether it has.`, view: null, changed: false };
    }
    // A planning turn's call lets go of no stop (the review of 11-06): the work the developer stopped stays stopped
    // until the plan is approved, as no start of it may come before.
    const base = planning ? before : release(before, { crew: planner, resumable: resumableIn(chainId) });
    // Parallelize tasks on (11-09): no card asks the person — the answer says to run the set now; off, it says to suggest
    // it on one (11-10). Where the session's sub-agents share its folder, two that write one file meet there, not at a
    // merge (g1).
    const on = parallel(chainId);
    // An add hears what is kept behind the graph — nothing, where notes are kept, is an empty record — so a plan of a few
    // tasks is asked once to keep its design (11-09); the turn it runs in goes on each task it adds or changes.
    const behind = act === "show" ? keptOf(chainId, base) : act === "add" && notes?.on ? keptOf(chainId, base) || {} : null;
    const card = act === "parallel" ? cardFacts(chainId) : {};
    const r = applyTasks(base, input, { at: now(), crew: planner, solo, resumable: resumableIn(chainId), reads, vet: vetIn(chainId), threadOf: threadOfIn(chainId), foundOf: foundOfIn(chainId), kept: behind, parallel: on, planning, shared: sharedIn(chainId), turn: turnOf(chainId), helping, personAt: personOf(chainId), ...card });
    if (!r.ok) return r;
    // A pause's checkpoint is kept behind its task first (E36 case 1): a pause whose words found no place is no pause.
    if (act === "pause" && r.notes) {
      const out = notes ? notes.call(chainId, r.notes, keeper(planner, solo)) : { ok: /** @type {const} */ (false), error: "This Filament keeps no notes behind its tasks, so a checkpoint has nowhere to go: keep the task running" };
      if (!out.ok) return { ok: false, error: `${out.error} — the task is as it was` };
    }
    const edited = r.changed || base !== before;
    const kept = edited ? keep(chainId, /** @type {Graph} */ (r.graph)) : r.graph;
    if (edited && !kept) return { ok: false, error: "the graph could not be kept with the session — it is as it was" };
    const { started: _, ...settled } = settleCall(chainId, before, kept, r.text, edited);
    const out = act === "start" && kept ? { ...settled, text: `${settled.text}${resumedWords(chainId, before, kept)}` } : settled;
    // What the folder changed while its tasks ran (E41 P2 case 11): read from git as each one pauses or is done.
    const more = edited ? spansAfter(chainId, before, kept, folderFor(chainId, cwd)) : null;
    return more ? { ...out, more } : out;
  };
  /**
   * What the planner hears of its offer (11-06): the card under its reply, and that the reply ends now.
   * @param {import("../../core/task-graph.js").PlanOffer} o
   */
  const offeredWords = (o) =>
    `Offered: under your reply, Filament shows the person a card — Plan first (${o.depth} suggested${o.side ? ", its tasks parallelized" : ""}, theirs to change) or Just do it. End your reply now, with a line on why you would plan first; change nothing until they choose.`;
  /** How much of a checkpoint a resume hands back whole (E36 case 4): a long one past it is named, to be read on. */
  const RESUME_ROOM = 20_000;
  /**
   * The checkpoints a start hands back (E36 case 4): each task it started that was paused, its newest checkpoint's words
   * as the note behind it holds them — "" where none was. @param {string} chainId @param {Graph | null} before @param {Graph} after
   */
  const resumedWords = (chainId, before, after) => {
    const was = new Map((before?.tasks || []).map((t) => [t.id, t.state]));
    const back = after.tasks.filter((t) => was.get(t.id) === "paused" && t.state === "running" && t.checkpoint);
    return back
      .map((t) => {
        const c = /** @type {import("../../core/task-graph.js").Checkpoint} */ (t.checkpoint);
        const words = notes?.noteText ? notes.noteText(chainId, after, t.id, c.title) : null;
        if (words === null) return `\n${t.id}'s checkpoint "${c.title}" could not be read back: tasks read with id ${t.id} lists what is kept behind it.`;
        const whole = words.length <= RESUME_ROOM;
        return `\n${t.id}'s checkpoint "${c.title}", as you left it:\n${whole ? words : `${words.slice(0, RESUME_ROOM)} …\n(${words.length.toLocaleString("en-US")} characters in all: tasks read with id ${t.id}, title "${c.title}" and from ${RESUME_ROOM} reads on)`}`;
      })
      .join("");
  };
  /**
   * A turn of the session's begins (E41 P2 case 13), said before it is kept (c-begin): `words`, where the planner stands
   * as the turn's start says it — each running task of its own a turn more, where it has gone a few — and `begun`, which
   * keeps that count, a plan carried from another chat as heard and a graph left open with all done as weighed once more,
   * as the words reach the agent. A coding agent's first prompt that never went out, or went as its own command, carried
   * none of them: nothing is kept. What is still uncommitted is read at once. Null words while the graph has nothing open.
   * @param {string} chainId @param {Crew} planner
   */
  const turnOpening = (chainId, planner) => {
    alsoSaid.delete(chainId);
    const was = get(chainId);
    const words = whereOf(chainId, planner, WHERE_ROOM.turn, false, turnBegun(was, helping) || was);
    // A merged change marked uncommitted is read again: committed since, its mark goes (11-09).
    const marked = (was?.tasks || []).filter((t) => t.uncommitted?.length).map((t) => t.id);
    readUncommitted(chainId, turns.get(chainId)?.cwd || lastFolder.get(chainId), marked);
    let kept = false;
    const begun = () => {
      if (kept) return;
      kept = true;
      const now_ = get(chainId);
      const g = turnBegun(now_, helping);
      if (g) keep(chainId, g, now_);
      // A plan carried from another chat (piece E) says so at the new chat's first turn, whatever kept the graph before
      // it — an Approve, work that started (the review of 58cfe9b31) — and only then.
      const counted = get(chainId);
      const heard = fromHeard(counted);
      if (heard) keep(chainId, heard, counted);
      // A graph left open with all done is weighed against the ask once more, at this start (the owner's of 11-10).
      const left = get(chainId);
      const ended = words ? endHeard(left) : null;
      if (ended) keep(chainId, ended, left);
      // Each task the last turn left idle was said so, once (d-idle).
      const idled = get(chainId);
      const told = words ? idleHeard(idled) : null;
      if (told) keep(chainId, told, idled);
    };
    return { words, begun };
  };

  // Named, so a card that answers itself goes the way the person's Accept and Ignore go (`answerCard`).
  const runner = {
    get,
    /**
     * Whether the session's graph will still ask for each sub-agent (`holdsAgent`): the registry keeps it, ended or not
     * (the bug report's L9). The graph is read once here, and asked of every sub-agent a prune may let go.
     * @param {string} chainId @returns {(agent: string) => boolean}
     */
    holds(chainId) {
      const g = get(chainId);
      return (agent) => holdsAgent(g, agent);
    },
    /**
     * One tasks call against the session's graph — the agent's, or a team's lead's (`crew`, G3). A call Filament takes
     * lets go of the developer's stop, stops the sub-agents of the tasks it dropped, and starts the work that may start
     * now, which its words say. The words the model reads and the view the page draws — or the refusal's words, the
     * graph as it was. `solo`: a coding agent's call, whose tasks are all its own (HarnessV3-ACP AC4-5). `reads`: the
     * agent reads along with its graph's sub-agents (HarnessV3-TaskGraph-v2 TG2-D20) — its note goes to whoever works
     * on the task now, as the agent's, read at that sub-agent's next step; it changes nothing in the graph, and lets go
     * of no stop. A keep or a read of what is kept behind a task (E33) neither: what a keep changed is drawn again, the
     * graph's rev one on, and a read of an image hands it beside the words (`media`).
     * `cwd`: the folder the call came from — what a task it starts runs in where no turn of the session's runs here (a
     * coding agent's chat), so what it changes can be read (E41 P2 case 11). The answer's `more`, where it has one: what
     * git read of what its done tasks changed, its words to follow the answer's.
     * @param {string} chainId @param {unknown} raw @param {{ crew: Crew, solo?: boolean, reads?: boolean, cwd?: string | null }} o
     * @returns {Answer}
     */
    apply(chainId, raw, { crew: planner, solo = false, reads = false, cwd = null }) {
      if (solo) soloChains.add(chainId);
      else soloChains.delete(chainId);
      // The call as it was meant (HarnessV4_TaskGraphEasy_Plan E40): its slips read, and said after its answer.
      const { input, said } = asMeant(raw, { crew: planner, solo, reads });
      const before = get(chainId);
      const r = applyAsIs(chainId, input, { crew: planner, solo, reads, cwd });
      const line = [meantWords(said), r.ok ? alsoAfter(chainId, before, get(chainId), planner) : ""].filter(Boolean).join("\n");
      return !line ? r : r.ok ? { ...r, text: r.text ? `${r.text}\n${line}` : line } : { ...r, error: `${r.error}\n${line}` };
    },
    /**
     * The session's agent's plan call, its checklist on the graph (HarnessV3-TaskGraph-v2 V2-5, TG2-D8): its items go
     * on as tasks of its own, kept and followed as a tasks call is — a done item's check runs, what it made ready
     * starts, and a graph it closed runs its checks once more. A stop holds still: a checklist is no answer to it. The
     * plan is recorded whatever the graph takes: the words say what it took, or why it took none.
     * Its items' moves are spans of their tasks' running as a tasks call's are (E41 P2 case 11): `more`, what git read of
     * what the tasks it ended changed. While a task the agent added runs, a checklist naming none of the graph's tasks is
     * that task's steps (the owner's of 11-11), and the graph keeps which task holds them (`stepsOf`). Its words are a
     * tick's (checkpoint.js "tick"), for the loop's agent and a coding agent alike (the nudge map of 11-10, c-mirror): what
     * moved, at-once, next and how the work stands, then what Filament started and what else is open. `cwd`: the folder
     * the call came from, as `apply`'s. `solo`: a coding agent's list, as `apply`'s: its words offer what its tasks tool
     * takes, which gives no task to a sub-agent. `task`: the task the list names as the one its items are the steps of,
     * which its caller asked `stepsRefusal` of before the list was recorded.
     * @param {string} chainId @param {readonly { text: string, status: string }[]} items @param {{ cwd?: string | null, solo?: boolean, task?: string | null }} [o]
     * @returns {{ text: string, view: any, changed: boolean, more?: Promise<string> }}
     */
    plan(chainId, items, { cwd = null, solo = false, task = null } = {}) {
      const before = get(chainId);
      const r = applyPlan(before, items, { at: now(), crew: "agent", solo, planning: planTurns.has(chainId), turn: turnOf(chainId), helping, personAt: personOf(chainId), task });
      // What its items said, kept though no task moved: the next list is read against it (11-10). Nothing a page draws
      // changed, so none is sent it.
      if (!r.changed && r.remembered && r.graph) keepUnsaid(chainId, r.graph);
      if (!r.changed) return { text: r.text, view: null, changed: false };
      const kept = keep(chainId, /** @type {Graph} */ (r.graph));
      if (!kept) return { text: "Your task graph took none of it: the graph could not be kept with the session — it is as it was.", view: null, changed: false };
      const settled = settleCall(chainId, before, kept, r.text, true, r.closed);
      const parts = r.parts || { answer: r.text, atOnce: "", next: "", now: "" };
      // A checklist on the graph is never a lead's (turn.js, agent-tools.js): its tick hears every block.
      const tick = compose("tick", READERS.loop, { ...parts, started: settled.started, alsoOpen: alsoAfter(chainId, before, kept, "agent") });
      const { view, changed } = settled;
      const text = tickText(tick.blocks);
      const more = spansAfter(chainId, before, kept, folderFor(chainId, cwd));
      return more ? { text, view, changed, more } : { text, view, changed };
    },
    /**
     * Why a checklist may not name this task as the one its items are the steps of (the checklist tool's `task`), or
     * null: one of the agent's own at work is named (core/task-graph.js `stepsTask`). Asked before a list is recorded,
     * so one refused draws nothing. @param {string} chainId @param {string} task @returns {string | null}
     */
    stepsRefusal(chainId, task) {
      const r = stepsTask(get(chainId), task, helping);
      return r.ok ? null : stepsRefused(r.error);
    },
    /**
     * Tasks the fork that weighed the person's message planned for the session's agent (the owner's forked steer of
     * 11-04): added proposed — none starts, nor is offered side by side, until the agent takes it on — and drawn on the
     * Plan as any change is. The ids it added, or why it added none, the graph as it was.
     * @param {string} chainId @param {{ goal?: string, tasks: unknown[] }} input
     * @returns {{ ok: true, ids: string[] } | { ok: false, error: string }}
     */
    propose(chainId, input) {
      const before = get(chainId);
      // Its tasks as they were meant, as a tasks call's are (the review of g3): a name past its limit cut, not refused.
      const meant = /** @type {{ goal?: string, tasks: unknown[] }} */ (asMeant({ action: "add", ...input }, { crew: "agent" }).input);
      const r = proposeTasks(before, { goal: meant.goal, tasks: meant.tasks }, { at: now(), crew: "agent", turn: turnOf(chainId) });
      if (!r.ok) return { ok: false, error: r.error };
      const kept = keep(chainId, /** @type {Graph} */ (r.graph), before);
      if (!kept) return { ok: false, error: "the graph could not be kept with the session" };
      settleCall(chainId, before, kept, "", true);
      const had = new Set((before && !before.closed ? before.tasks : []).map((t) => t.id));
      return { ok: true, ids: kept.tasks.filter((t) => !had.has(t.id)).map((t) => t.id) };
    },
    /**
     * What a show of one task adds for an agent that reads along (TG2-D33): what the task's sub-agent has changed so
     * far while it runs, or the change under review as it left it. Null for any other call, and for a task nobody's
     * change waits on.
     * @param {string} chainId @param {unknown} raw @returns {Promise<string | null>}
     */
    async soFar(chainId, raw) {
      const i = /** @type {any} */ (asMeant(raw, { crew: "agent", reads: true }).input);
      if (i?.action !== "show" || i.id === undefined || i.id === null || i.id === "") return null;
      const agent = changeOf(get(chainId), i.id);
      if (!agent) return null;
      const r = await registry.changesSoFar(agent, chainId);
      return r.ok ? r.text : `What ${agent} has changed could not be read: ${r.error}.`;
    },
    /**
     * The developer's own send-back of a failed task, from the page (HarnessV4_Tasks U1; HarnessV3-FailurePoints §6
     * items 2–3), and their own start of one they stopped (HarnessV4_Tasks B4): the planner's `tasks start` on it,
     * made in their name — its last worker goes on with it, or with `fresh` a new one takes it. The graph's hold
     * stays as it stands (a Stop holds until the planner's next tasks
     * call), the planner is told — into its running turn, else with its next — and the work starts now where a turn
     * runs. `waits` says why it has not started: the graph is held, no turn runs, or its needs and
     * a slot; null once it has. `resumes` names the worker that goes on with it — null when a new one takes it, asked
     * fresh or because its last one can't go on. `again`: it was one they had stopped, started again.
     * @param {string} chainId @param {string} id @param {{ fresh?: boolean }} [o]
     * @returns {{ ok: true, text: string, view: any, waits: "held" | "turn" | "slot" | null, resumes: string | null, again: boolean } | { ok: false, error: string }}
     */
    sendBack(chainId, id, { fresh = false } = {}) {
      const before = get(chainId);
      if (!before || before.closed) return { ok: false, error: "this session has no open task graph" };
      const t = before.tasks.find((x) => x.id === id);
      if (!t) return { ok: false, error: `${id} is no task in the graph` };
      if (t.by === "you") return { ok: false, error: `${id} is the agent's own task: no sub-agent has it to go on with` };
      // A command task the developer's stop set aside stays theirs to run again once a tasks call let go of the stop (V2-3).
      const cut = t.by === COMMAND && t.state === "waiting" && !!t.result?.cut;
      if (t.state !== "failed" && !(t.state === "waiting" && t.stopped) && !cut) return { ok: false, error: `${id} is ${t.state === "review" ? "in review" : t.state}: only a failed task is sent back, and only a stopped one is started again` };
      const r = applyTasks(before, { action: "start", ids: [id], ...(fresh ? { fresh: true } : {}) }, { at: now(), crew: crewOf(chainId), resumable: resumableIn(chainId), parallel: parallel(chainId), helping, personAt: personOf(chainId) });
      if (!r.ok) return r;
      const kept = keep(chainId, /** @type {Graph} */ (r.graph));
      if (!kept) return { ok: false, error: "the graph could not be kept with the session — it is as it was" };
      const goes = taskOf(kept, id).resume;
      const started = dispatch(chainId);
      const graph = get(chainId) || kept;
      registry.tell(chainId, { text: `[Filament: the developer did this themselves, from the page — ${r.text}${started.length ? ` ${startedText(graph, started)}` : ""}]`, from: "", description: "the task graph", spends: [], wrote: false });
      settle(chainId);
      const waits = started.includes(id) ? null : graph.held ? "held" : !turns.has(chainId) ? "turn" : "slot";
      // Started under another planner than the one it ran for, its last worker is none of the task's role: a new one took it.
      const resumes = started.includes(id) && taskOf(graph, id).agent !== goes ? null : goes;
      return { ok: true, text: r.text, view: viewOf(chainId, graph), waits, resumes, again: t.state === "waiting" };
    },
    /**
     * The developer's side run (the Designer's of 10-27, built 10-28): the tasks they picked on the Plan page go to
     * sub-agents of their own — all or none, refused in words where the chat's room has not that many free — each on the
     * model they chose, in its own copy or their folder. The graph claims them at once and the planner is told in a note
     * added to its turn, never rewritten; the launches go now, or — `starts` "turn", while the planner's turn runs or
     * waits on a question it paused on — once it ends, so each copy starts from its finished edits. `started`: the tasks launched now; `later`: they wait for the
     * turn's end; `refused`: those whose launch was refused, each given back to its planner with why. Refused all, the
     * run is refused in their words, the graph as it was and the planner told nothing. `card`: the side-by-side card's
     * Accept, by its `at` — refused where that card stands no more (core `cardGone`). `timeout`: that card answered
     * itself, no answer in 60 seconds (`answerCard`), and the planner hears that.
     * @param {string} chainId @param {readonly import("../../core/task-graph.js").SidePick[]} picks @param {{ starts: "now" | "turn", card?: number, timeout?: boolean }} o
     * @returns {{ ok: true, view: any, started: string[], later: boolean, refused: { id: string, why: string }[] } | { ok: false, error: string, gone?: true }}
     */
    sideRun(chainId, picks, { starts, card, timeout = false }) {
      if (stopping) return { ok: false, error: "Filament is stopping: nothing starts now" };
      const later = starts === "turn" && !!registry.turnOpen?.(chainId);
      const r = claimSide(get(chainId), picks, { at: now(), crew: crewOf(chainId), starts: later ? "turn" : "now", shared: sharedIn(chainId), helping, ...(card !== undefined ? { card } : {}) });
      if (!r.ok) return r;
      const kept = keep(chainId, r.graph);
      if (!kept) return { ok: false, error: "the graph could not be kept with the session — it is as it was" };
      if (later && registry.afterTurn) {
        registry.notice?.(chainId, { text: sideNote(picks.map((p) => p.id), true), description: "the task graph" });
        registry.afterTurn(chainId, () => void launchSide(chainId, { told: true }));
        return { ok: true, view: viewOf(chainId, kept), started: [], later: true, refused: [] };
      }
      // Now: the planner hears of those that started, after their launches. The card's Accept wakes it, a chat with no
      // turn running too, as a check's verdict does (the nudge map of 11-10): the suggestion told it to end its turn, as
      // "an Accept or an Ignore is told to you" (task-graph.js `suggestedWords`), and a notice wakes nothing — it sat
      // idle until the person wrote. The Plan page's sheet promised it nothing: its word waits for the next message.
      const { started, refused } = launchSide(chainId, { told: false });
      if (!started.length) return { ok: false, error: refused.map((x) => `${x.id} could not start: ${x.why}`).join("; ") || "nothing started" };
      if (card != null) registry.tell(chainId, { text: timeout ? sideTimedNote(started) : sideNote(started, false), from: "", description: "the task graph", spends: [], wrote: false, wakes: true, about: "card" });
      else registry.notice?.(chainId, { text: sideNote(started, false), description: "the task graph" });
      return { ok: true, view: viewOf(chainId, get(chainId) || kept), started, later: false, refused };
    },
    /**
     * The developer's Ignore of the card (Phase 5): it goes, and its tasks are the agent's own — never said to it again as
     * ones to run side by side until it suggests them again — while Parallelize tasks is on, it only goes
     * (`offerIgnored`). The agent, told to leave them while the card stood, hears it went (the review of ef73c2a9d).
     * `at` names the card; one that stands no more — another's, its tasks started or changed, its plan reworked — is
     * refused in words. `timeout`: why the card, unanswered for 60 seconds, kept its tasks the agent's (`answerCard`),
     * which the agent hears with it.
     * @param {string} chainId @param {number} at @param {{ timeout?: string }} [o]
     * @returns {{ ok: true, view: any } | { ok: false, error: string }}
     */
    ignoreOffer(chainId, at, { timeout } = {}) {
      const g = get(chainId);
      const on = parallel(chainId);
      const next = offerIgnored(g, at, on);
      if (!next) return { ok: false, error: cardGone(g, at, "nothing ignored") || "that card is gone — nothing ignored" };
      const kept = keep(chainId, next, g);
      if (!kept) return { ok: false, error: "the graph could not be kept with the session — the card stands" };
      // Told by the way that wakes it, as the Accept is (the nudge map of 11-10): it ended its turn for this answer.
      const ids = /** @type {any} */ (g).offer.ids;
      registry.tell(chainId, { text: timeout ? sideTimedNote(ids, timeout) : ignoredNote(ids, on), from: "", description: "the task graph", spends: [], wrote: false, wakes: true, about: "card" });
      return { ok: true, view: viewOf(chainId, kept) };
    },
    /** The side-by-side card that stands in the chat's transcript (Phase 5), as its row draws it, or null. @param {string} chainId */
    offered: (chainId) => sideOfferOf(get(chainId)),
    /**
     * A planning turn runs in the session, or has ended (the owner's plan mode of 11-06): while it runs, its tasks calls
     * start nothing and what they change waits for the person's Approve. @param {string} chainId @param {boolean} on
     */
    planTurn(chainId, on) {
      if (on) planTurns.add(chainId);
      else planTurns.delete(chainId);
    },
    /**
     * Why the chat's plan cannot be carried into a new chat now (piece E), or null. @param {string} chainId
     */
    carryRefusal: (chainId) => carryRefusal(get(chainId)),
    /**
     * The chat's plan carried into a new chat (the owner's plan mode of 11-06, piece E): the new chat takes it — its
     * tasks with their ids, what ran of its planner's own paused —, the notes and files kept behind it are copied there,
     * and it closes here, saying where it went on. Refused in words where `carryRefusal` says why, nothing moved.
     * @param {string} from @param {string} to @param {{ title?: string, toTitle?: string }} [o]  the chats' names, as each
     *   says where the other is
     * @returns {{ ok: true, tasks: number, files: number } | { ok: false, error: string }}
     */
    carry(from, to, { title = "", toTitle = "" } = {}) {
      const g = get(from);
      const why = carryRefusal(g);
      if (why || !g) return { ok: false, error: why || "this chat has no open plan to carry" };
      const at = now();
      /** @type {number} */
      let files;
      try {
        files = notes?.copy ? notes.copy(from, to, g.startedAt) : 0;
      } catch (/** @type {any} */ e) {
        return { ok: false, error: `the notes and files kept behind it could not be copied (${e?.message || e}): the plan stays in this chat` };
      }
      const next = carriedGraph(g, { at, from: { chain: from, title } });
      if (!keep(to, next, g)) return { ok: false, error: "the new chat could not keep the plan: it stays in this chat" };
      keep(from, carriedAway(g, { at, to, title: toTitle }), g);
      return { ok: true, tasks: next.tasks.filter((t) => t.state !== "dropped").length, files };
    },
    /**
     * A coding agent's launch names a task of its own (the Designer's of 10-27, built 10-28): why it may not, asked
     * before the launch — or null.
     * @param {string} chainId @param {string} id
     */
    helperRefusal: (chainId, id) => (planTurns.has(chainId) ? `${id} is a task of the plan, which waits for the person's Approve: start none of it in this turn — launch your helper without a task to read and map, and plan` : helperRefusal(get(chainId), id)),
    /**
     * Once it launched, the task keeps who works on it, its box saying so — and one that waited to start runs from now.
     * @param {string} chainId @param {string} id @param {import("../../core/task-graph.js").TaskHelper} helper
     */
    helperTook(chainId, id, helper) {
      const was = get(chainId);
      // A launch for a task in a later turn is the planner's start of it (the review of c9eb95f24): a plan that waited
      // for the person's Approve goes, as a start lets it go.
      const g = was?.planning && !planTurns.has(chainId) ? planGo(was) : was;
      const next = g && helperTook(g, id, helper);
      if (next) keep(chainId, next, was);
      else if (g !== was && g) keep(chainId, g, was);
    },
    /**
     * The task a Hunter is fired from, as the graph holds it at its launch (11-02): its name and the graph's start, which
     * its hunt keeps so a task its finding names later is that one — or why none is fired, in words: the graph holds no
     * task of that id, or that task is not done. A Hunter hunts bugs in what a done task did, as the Plan offers it.
     * @param {string} chainId @param {string} id @returns {{ name: string, graph: number } | { error: string }}
     */
    huntedTask(chainId, id) {
      const g = get(chainId);
      const t = g?.tasks.find((x) => x.id === id);
      if (!g || !t) return { error: `hunts names ${id}, and this chat's task graph holds no task of that id` };
      if (t.state !== "done") {
        const how = t.state === "failed" ? "failed" : t.state === "dropped" ? "was dropped" : t.state === "review" ? "is in review" : `is ${t.state}`;
        return { error: `hunts names ${id}, which ${how} — a bug hunt looks at what a done task did` };
      }
      return { name: t.name, graph: g.startedAt };
    },
    /**
     * The planner applies a worker's change that waits for it (the owner's of 11-02) — the agent's `apply_changes`, a
     * coding agent's through its agent tool, a lead's through its worker tool, each by the registry's apply: its task
     * merges now, in graph order behind a merge under way (`merge`), the folder checked with it, and its end told with the
     * verdict, waking the planner. One whose change did not merge is tried again. Null where no task of the session's open
     * graph waits on that worker's change: the apply is no graph's. A refusal in words where its task holds that worker
     * for another step, or the graph could not be kept — nothing then is applied. `stands`: the planner — no lead — asked
     * it in as it stood, a failed task's or with a reason, so it stands whatever the folder's check finds.
     * @param {{ chainId: string, agentId: string, reason?: string | null }} o
     * @returns {{ ok: true, id: string, stands: boolean } | { ok: false, error: string } | null}
     */
    applyAsked({ chainId, agentId, reason = null }) {
      const g = get(chainId);
      if (!g || g.closed) return null;
      const r = applyAsked(g, agentId, { reason, by: Array.isArray(crewOf(chainId)) ? "lead" : "planner" });
      if (!r || !r.ok) return r;
      if (r.graph !== g && !keep(chainId, r.graph, g)) return { ok: false, error: "the task graph could not be kept — nothing was applied" };
      mergeWaiting(chainId);
      return { ok: true, id: r.id, stands: taskOf(r.graph, r.id).overruledBy === "planner" };
    },
    /**
     * A sub-agent's work went into the folder by an apply of the developer's own (10-28): where its change waited for
     * its apply, its task is done, unchecked, and its planner told as a merge's is.
     * `marked`: the files it left with git's conflict markers, which the task's summary names (the Hunter's of 10-28).
     * `repo`: the repository it went into, what is still uncommitted read there — a chat with no turn since Filament
     * started too (the review of g3).
     * @param {{ chainId: string, agentId: string, files: readonly { path: string, added: number, removed: number }[], marked?: readonly string[], repo?: string }} o
     */
    applied({ chainId, agentId, files, marked = [], repo }) {
      const g = get(chainId);
      const next = g && sideApplied(g, agentId, files, now(), marked);
      const kept = next && keep(chainId, next, g);
      if (!kept) return;
      cameIn(chainId, files);
      // A ready one, or one whose change did not merge and the developer applied with their choices (10-28). The planner
      // is woken, a chat with no turn running too: the tasks that needed it start with its turn.
      const id = /** @type {Task} */ (kept.tasks.find((x) => x.agent === agentId && x.state === "done")).id;
      dispatch(chainId);
      tell(chainId, get(chainId) || kept, id, false, undefined, { wake: "now", about: "merge" });
      settle(chainId);
      readUncommitted(chainId, repo || turns.get(chainId)?.cwd || lastFolder.get(chainId) || registry.room?.(chainId).cwd, [id]);
    },
    /**
     * Why a mark of a sub-agent's work as applied — brought into the folder by hand — can't end its task now, or null
     * where it can, or where no task of the session's graph waits on that work (the bug report of 11-10): the mark then
     * tells the graph as an apply does (`applied`). @param {string} chainId @param {string} agentId
     */
    markRefusal: (chainId, agentId) => markRefusal(get(chainId), agentId),
    /**
     * The developer sent the change of a task back to rebase (the Designer's of 10-27, built 10-28) — one that did not
     * merge, or a side run's that waited for their Apply: the task goes back as the graph sends tasks back, its worker
     * going on with `note` — now where the planner's turn runs, else at its next one. Refused, the graph as it was, where
     * its worker could not go on with it (the Hunter's of 10-28: the task then failed, or went to a new worker, and the
     * marked work stayed no Apply's); the registry then puts its work back as it was. `merge`: its merge running now
     * overlapped the folder's edits (the owner's of 11-09), and it goes back from that merge — by Filament itself twice
     * at most, its count kept on the task (`n`), or as its planner asked — the merge's end then telling it.
     * @param {{ chainId: string, agentId: string, taskId: string, note: string, merge?: import("../../core/task-graph.js").MergeBack | null }} o
     * @returns {{ ok: true, n?: number } | { ok: false, error: string }}
     */
    rebaseTask({ chainId, agentId, taskId, note, merge = null }) {
      const g = get(chainId);
      if (!g) return { ok: false, error: `task ${taskId} is in no task graph of this chat now` };
      const refused = rebaseRefusal(g, agentId, taskId, crewOf(chainId), merge);
      if (refused === MERGED_TWICE) return { ok: false, error: refused };
      const cannot = refused || registry.resumable(agentId, chainId);
      if (cannot) return { ok: false, error: `${agentId} can't go on with task ${taskId}: ${cannot}` };
      const back = sentToRebase(g, agentId, note, merge);
      if (!back || back.id !== taskId) return { ok: false, error: `task ${taskId} is no longer one whose change waits for you` };
      const kept = keep(chainId, back.graph);
      if (!kept) return { ok: false, error: "the task graph could not be kept" };
      dispatch(chainId);
      settle(chainId);
      return merge && !merge.asked ? { ok: true, n: taskOf(kept, taskId).rebases ?? 1 } : { ok: true };
    },
    /**
     * Whether the graph still waits for `agentId` to go on with a task sent back to it: one sent back to rebase is due
     * only while it does (the Hunter's of 10-28).
     * @param {string} chainId @param {string} agentId
     */
    rebaseWaits: (chainId, agentId) => !!get(chainId)?.tasks.some((t) => t.resume === agentId && t.state === "waiting"),
    /**
     * Whether a graph worker's change waits for an apply (10-28, 11-02): its thread is then kept across a
     * restart, as a helper's is. @param {string} chainId @param {string} agentId
     */
    waitsForYou: (chainId, agentId) => waitsForYou(get(chainId), agentId),
    /**
     * The graph as it comes back after a summary, while it has open tasks, what is kept marked — and where the planner
     * stands, each running and paused task's newest checkpoint in it (E41 P1 case 3); one left open with all done as
     * the ask to weigh and close it alone (FabeleHelper's of 11-10); null otherwise. `starting`: where the planner stands
     * as the turn starting now says it (`where`), for a block that goes with that turn's first prompt in place of it — a
     * coding agent's compaction that nothing said after —, whose going keeps the turn's start (`turnOpening`).
     * @param {string} chainId @param {Crew} planner @param {{ starting?: boolean }} [o]
     */
    open: (chainId, planner, { starting = false } = {}) => {
      const g = get(chainId);
      return openGraphText(g, planner, keptOf(chainId, g), whereOf(chainId, planner, WHERE_ROOM.back, true, starting ? turnBegun(g, helping) || g : g), { done: true });
    },
    /** Whether the graph has a task still open (FabeleHelper's of 11-10: `open` says an all-done graph too). @param {string} chainId */
    hasOpen: (chainId) => hasOpenTasks(get(chainId)),
    /**
     * Where the planner stands now (HarnessV4_TaskGraphPlus_Plan E41 P1): for a turn's start, and after a compaction
     * (`back`), whose checkpoints it gives more of, and a graph left open with all done said again — null while the
     * graph has nothing open. `starting`: as the turn starting now says it (`turnOpening`), each running task of the
     * planner's own a turn more — kept by the turn's start alone, as it goes (sw-quiet: a switch's handover says it).
     * @param {string} chainId @param {Crew} planner @param {{ back?: boolean, starting?: boolean }} [o]
     */
    where: (chainId, planner, { back = false, starting = false } = {}) => {
      const g = get(chainId);
      return whereOf(chainId, planner, back ? WHERE_ROOM.back : WHERE_ROOM.turn, back, starting ? turnBegun(g, helping) || g : g);
    },
    /**
     * A turn of the session's begins (E41 P2 case 13): each running task of the planner's own has run a turn more since
     * its last checkpoint — kept — and where the planner stands, for the turn's start, says it where it has gone a few.
     * Called once a turn, where the loop's first request is made, which carries it; null while the graph has nothing open.
     * @param {string} chainId @param {Crew} planner
     */
    begin(chainId, planner) {
      const o = turnOpening(chainId, planner);
      o.begun();
      return o.words;
    },
    /** A turn's start said before it is kept, for a coding agent's first prompt (`turnOpening`). */
    opening: turnOpening,
    /**
     * The line behind what lands while the planner is on a task of its own (E41 P1 case 7): which task it came during,
     * and how to take it up first. Null where none runs. @param {string} chainId
     */
    onTask: (chainId) => onTaskText(get(chainId), helping),
    /**
     * The planner's own tasks that run, as a wait that finds none of its sub-agents running says them (E41 P5's measure).
     * Null where none runs. `solo`: a coding agent's wait, told what its own tools do with such a task.
     * @param {string} chainId @param {{ solo?: boolean }} [o]
     */
    ownWork: (chainId, { solo = false } = {}) => ownWorkText(get(chainId), helping, solo),
    /**
     * A file the planner itself changed (d-writes): where it lies outside every open task's writes while tasks of its own
     * that named writes run (`outsideOwnWrites`), the file as the writes name it and those tasks, each once (the task
     * keeps that it was told, `outsideHeard`) — null otherwise, and for a file outside the folder. `file`: as its call
     * named it; `folder`: the one it works in, which the writes are written against. `mark`: the tasks count as told now
     * — the loop's line rides the edit's own result; a coding agent's goes at its next step, or never where its turn ends
     * first, so it marks them once it went (`outsideSaid`).
     * @param {string} chainId @param {string} file @param {string} folder @param {{ mark?: boolean }} [o]
     * @returns {{ path: string, tasks: { id: string, name: string, writes: string[] }[] } | null}
     */
    outside: (chainId, file, folder, { mark = true } = {}) => {
      if (!file || !folder) return null;
      const path = relative(folder, resolve(folder, file)).split(sep).join("/");
      if (!path || path === ".." || path.startsWith("../") || isAbsolute(path)) return null;
      const g = get(chainId);
      const tasks = outsideOwnWrites(g, path, helping).filter((t) => !t.outsideTold);
      const told = mark ? outsideHeard(g, tasks.map((t) => t.id)) : null;
      if (told) keep(chainId, told, g);
      return tasks.length ? { path, tasks: tasks.map((t) => ({ id: t.id, name: t.name, writes: [...t.writes] })) } : null;
    },
    /** The line for a file changed outside the writes (`outside`, unmarked) reached the agent: each task it named is told. @param {string} chainId @param {readonly string[]} ids */
    outsideSaid: (chainId, ids) => {
      const g = get(chainId);
      const told = outsideHeard(g, ids);
      if (told) keep(chainId, told, g);
    },
    /** What is kept behind each task of the session's graph now (E33), for a summary's words outside the loop. @param {string} chainId */
    kept: (chainId) => keptOf(chainId, get(chainId)),
    /**
     * The session's graph as its page draws it now — what each task keeps, the switch as it is (the review of 11-09) —,
     * for the session's answer. Null before its first add. @param {string} chainId
     */
    view: (chainId) => {
      const g = get(chainId);
      return g ? viewOf(chainId, g) : null;
    },
    /**
     * A turn of the session runs: the graph's work may start, and what starts is told.
     * @param {string} chainId @param {GraphTurn} turn
     */
    attach(chainId, turn) {
      turns.set(chainId, turn);
      lastFolder.set(chainId, turn.cwd);
      const started = dispatch(chainId);
      const graph = get(chainId);
      if (started.length && graph) registry.tell(chainId, { text: `[${startedText(graph, started)}]`, from: "", description: "the task graph", spends: [], wrote: false });
    },
    /**
     * A turn of the planner's ended on its own, neither stopped nor failed (d-idle): each task of its own still running is
     * marked left idle where nothing is at work that wakes the planner — no sub-agent of the session's, no check or command
     * task Filament runs for it, none of its own commands (`commands`, the caller's word), and no come-back it set
     * (`comeBack`, the caller's word too: come_back has it end its turn) — and said once at the next turn's start ("Where
     * you are"). The loop's and a coding agent's turns alike.
     * @param {string} chainId @param {{ commands?: boolean, comeBack?: boolean }} [o]
     */
    turnEnded(chainId, { commands = false, comeBack = false } = {}) {
      const g = get(chainId);
      if (!g) return;
      const atWork = commands || comeBack || (checks.get(chainId)?.size || 0) > 0 || !!registry.atWork?.().includes(chainId) || g.tasks.some((t) => t.by === COMMAND && t.state === "running");
      const next = leftIdle(g, !atWork, helping);
      if (next) keep(chainId, next, g);
    },
    /** The turn ended: nothing starts until the next one runs, and nothing holds it. @param {string} chainId @param {string} runId */
    detach(chainId, runId) {
      if (turns.get(chainId)?.runId !== runId) return;
      turns.delete(chainId);
      settle(chainId, true);
    },
    /**
     * What the running turn may not end before (G2-7): a promise that settles once the session owes it nothing — its
     * graph's sub-agents hold no work, no review is being started, and nothing waits for a held slot — or null when it
     * owes nothing now.
     * @param {string} chainId @returns {Promise<void> | null}
     */
    /** How many of a session's checks Filament runs now: its chat waits for each verdict (the owner's of 11-06). @param {string} chainId */
    checking: (chainId) => checks.get(chainId)?.size || 0,
    owes(chainId) {
      if (!owing(chainId)) return null;
      return new Promise((resolve) => {
        const w = waiting.get(chainId) || new Set();
        w.add(() => resolve(undefined));
        waiting.set(chainId, w);
      });
    },
    /**
     * An exchange of the registry's ended: a slot is free, and a graph task's end moves its task on — its review, its
     * change ready for its apply, done, failed, or the developer's stop — and is told once the work that may start next
     * has started, so its words say how the graph stands, the planner woken by it where another task waits on it, else
     * once the graph's workers are done (`tell`'s "batch"). A step of the task's review is told only when the developer stopped it: the rest
     * go on by themselves, and what they spent rides the task's end.
     * @param {{ chainId: string, task: GraphTaskEnd | null }} o
     */
    ended({ chainId, task }) {
      const g = task ? get(chainId) : null;
      const r = g && task ? (task.review ? reviewEnded(g, task.id, task, now()) : taskEnded(g, task.id, task, now())) : null;
      const kept = r ? keep(chainId, r.graph, g) : null;
      if (kept && task) {
        const k = key(chainId, task.id);
        if (task.unread?.length) unread.set(k, [...(unread.get(k) || []), ...task.unread]);
        spends.set(k, [...(spends.get(k) || []), { agent: task.agent, exchange: task.exchange, spentUsd: task.spentUsd, toolCalls: task.toolCalls, roundIds: task.roundIds, launchedBy: task.launchedBy }]);
      }
      // A change that waits in its copy for its apply: its worker's thread is kept for a restart (10-28).
      if (kept && task && waitsForYou(kept, task.agent)) registry.keepWork?.(task.agent, chainId);
      dispatch(chainId);
      const told = kept && task && r && (r.state === "done" || r.state === "failed" || r.state === "stopped" || r.state === "yours" || (r.state === "review" && taskOf(kept, task.id).stopped));
      if (told) tell(chainId, get(chainId) || /** @type {Graph} */ (kept), task.id, task.shared && task.wrote, task.writes, { wake: "batch" });
      settle(chainId);
    },
    /**
     * The developer stopped the turn (G2-8): the graph is held — nothing starts until the planner's next tasks call —
     * and the sub-agents at work on its tasks are stopped, its reviewers too: each task waits again with what its
     * sub-agent did, a review is read again. A change that merges is let finish, its folder's check cut (V2-2): it
     * stands, unchecked, said — each the planner applied, the one merging now and those waiting their turn alike.
     * @param {string} chainId
     */
    stop(chainId) {
      // A check Filament runs is cut too (V2-1): its task is done, unchecked, in the stop's words.
      for (const abort of checks.get(chainId)?.values() || []) abort.abort("the developer's stop cut its check");
      // And a command task's runs (V2-3): it waits again, set aside.
      for (const r of running.get(chainId)?.values() || []) r.abort.abort("stop");
      gates.get(chainId)?.abort();
      registry.cutMerges?.(chainId);
      const g = get(chainId);
      if (!g || g.closed) return;
      keep(chainId, hold(g, now()), g);
      // The developer's own side run is no part of the turn they stopped (10-28).
      for (const agent of agentsAtWork(g, { side: false })) registry.stop(agent, { from: "harness" });
    },
    /**
     * Filament starts (G2-9): what a restart cut — a sub-agent's task that ran, was in review, or whose change merged —
     * fails, told with the session's next turn. A card that stood as Filament stopped waits for the person alone, its
     * deadline gone: no turn waits on it now, and nobody may be there to see sub-agents start (the review of 11-14).
     * @returns {number} how many sessions are told
     */
    reconcile() {
      let n = 0;
      for (const { id: chainId, graph } of archive.openGraphs()) {
        const r = restartCut(graph, now());
        const kept = r && keep(chainId, r.graph);
        // Its keep armed the card's clock again: let go of it whichever way it went.
        letCardWait(chainId, kept || graph);
        if (!r || !kept) continue;
        for (const id of r.ids) tell(chainId, kept, id);
        if (r.back.length) registry.notice?.(chainId, { text: sideBackNote(r.back), description: "the task graph" });
        n += 1;
      }
      return n;
    },
    /**
     * Filament is stopping (G2-9): nothing starts any more — a sub-agent launched while it drains could make no call —
     * and no running turn waits on its graph, so it ends without one more round; the tasks the stop cuts fail, told
     * with the session's next turn.
     */
    shutdown() {
      stopping = true;
      for (const mine of checks.values()) for (const abort of mine.values()) abort.abort("Filament stopped as it ran its check");
      for (const mine of running.values()) for (const r of mine.values()) r.abort.abort("shutdown");
      for (const abort of gates.values()) abort.abort();
      for (const chainId of [...waiting.keys()]) settle(chainId);
      // A merge pass that could not keep its end is tried again no more: a restart fails what it left merging (G2-9).
      for (const r of retried.values()) clearTimeout(r.timer);
      retried.clear();
      // A card answers itself no more: it is kept with its deadline, which the next start sets again (`reconcile`).
      for (const chainId of [...cardTimers.keys()]) disarmCard(chainId);
      unhear?.();
      unhearChat?.();
    },
  };
  return runner;
}

/** @typedef {ReturnType<typeof createGraphRunner>} GraphRunner */
